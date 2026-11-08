import { NextRequest, NextResponse } from 'next/server';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * APA Scoresheets — the user's league scoresheet toolkit as a Jarvis screen.
 *
 * The engine is their own apa_toolkit.py (copied into scripts/ with the
 * nexus-entry.enabled marker): it splits the weekly combined scoresheets PDF
 * per team, red-lines the two teams' copies against the league rules, attaches
 * a reconciliation page, and — in this copy — flattens matches into the rows
 * the APA Nexus portal asks for, typed via the F9 hotkey helper.
 *
 * The league folder is a per-user setting (apa_league_folder).
 */

const PY_EXE = process.env.JARVIS_PYTHON || 'python';
const TOOLKIT = path.join(process.cwd(), 'scripts', 'apa_toolkit.py');
const HELPER = path.join(process.cwd(), 'scripts', 'apa_nexus_helper.py');

function settingsFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-server-settings.json');
}

function readLeagueFolder(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
    const inner = (typeof raw.jarvis_settings === 'string'
      ? JSON.parse(raw.jarvis_settings)
      : raw.jarvis_settings ?? {}) as Record<string, unknown>;
    return String(inner.apa_league_folder ?? '').trim();
  } catch {
    return '';
  }
}

function writeLeagueFolder(p: string): void {
  const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
  const inner = (typeof raw.jarvis_settings === 'string'
    ? JSON.parse(raw.jarvis_settings)
    : raw.jarvis_settings ?? {}) as Record<string, unknown>;
  inner.apa_league_folder = p;
  raw.jarvis_settings = JSON.stringify(inner);
  fs.writeFileSync(settingsFile(), JSON.stringify(raw, null, 2), 'utf8');
}

function runToolkit(args: string[], timeoutMs = 300_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(PY_EXE, [TOOLKIT, ...args], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4_000_000,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
      const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ code: err ? code : 0, output: out.slice(-6000) });
    });
  });
}

function weekFolders(league: string): { name: string; division: string }[] {
  const out: { name: string; division: string }[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (/^week \d+$/i.test(e.name)) {
        out.push({ name: path.relative(league, full), division: path.relative(league, path.dirname(full)) });
      } else if (depth < 3) {
        walk(full, depth + 1);
      }
    }
  };
  walk(league, 0);
  return out;
}

export async function GET(req: NextRequest) {
  const op = req.nextUrl.searchParams.get('op') ?? 'config';
  const league = readLeagueFolder();

  if (op === 'nexus_state') {
    const base = process.env.JARVIS_DATA_DIR || process.cwd();
    const stateFile = path.join(base, 'apa-nexus-state.json');
    try {
      return NextResponse.json(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
    } catch {
      return NextResponse.json({ running: false });
    }
  }

  if (!league || !fs.existsSync(league)) {
    return NextResponse.json({ configured: false, league: league || null, message: league ? 'League folder no longer exists — set it again.' : 'No league folder configured.' });
  }

  if (op === 'weeks') {
    return NextResponse.json({ configured: true, league, weeks: weekFolders(league) });
  }

  return NextResponse.json({ configured: true, league });
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();

    switch (op) {
      case 'set_league': {
        const p = path.resolve(String(a.leagueFolder ?? '').trim());
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
          return NextResponse.json({ error: `No such folder: ${p}` }, { status: 400 });
        }
        writeLeagueFolder(p);
        return NextResponse.json({ ok: true, league: p, weeks: weekFolders(p) });
      }

      case 'process': {
        const league = readLeagueFolder();
        if (!league) return NextResponse.json({ error: 'Set the league folder first.' }, { status: 400 });
        const pdf = path.resolve(String(a.pdfPath ?? '').trim());
        if (!fs.existsSync(pdf)) return NextResponse.json({ error: `No such file: ${pdf}` }, { status: 404 });
        const result = await runToolkit(['--cli', pdf, league]);
        return NextResponse.json({ ok: result.code === 0, output: result.output, code: result.code });
      }

      case 'nexus_start': {
        const league = readLeagueFolder();
        if (!league) return NextResponse.json({ error: 'Set the league folder first.' }, { status: 400 });
        const weekName = String(a.weekFolder ?? '');
        const matchIndex = Number(a.matchIndex ?? 0);
        const child = spawn(PY_EXE, [HELPER, league, weekName, String(matchIndex)], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.unref();
        // The helper needs a few seconds (Python + PDF parsing) before its
        // first state write — poll until it's ready or it reports an error.
        const base = process.env.JARVIS_DATA_DIR || process.cwd();
        const stateFile = path.join(base, 'apa-nexus-state.json');
        for (let waited = 0; waited < 15_000; waited += 500) {
          await new Promise((r) => setTimeout(r, 500));
          try {
            const st = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
              running?: boolean; error?: string; rows?: unknown[];
            };
            if (st.error) return NextResponse.json({ error: st.error }, { status: 400 });
            if (st.running && (st.rows?.length ?? 0) > 0) {
              return NextResponse.json({ ok: true, state: st });
            }
          } catch { /* not written yet — keep polling */ }
        }
        return NextResponse.json({ ok: true, message: 'Helper starting…' });
      }

      case 'nexus_stop': {
        // The helper quits on Ctrl+F12; from the page we just mark the state.
        const base = process.env.JARVIS_DATA_DIR || process.cwd();
        try {
          const st = JSON.parse(fs.readFileSync(path.join(base, 'apa-nexus-state.json'), 'utf8'));
          st.running = false;
          st.message = 'Stopped from the page (the helper exits on its next hotkey press).';
          fs.writeFileSync(path.join(base, 'apa-nexus-state.json'), JSON.stringify(st, null, 1));
        } catch { /* no state yet */ }
        execFile('taskkill', ['/F', '/IM', 'python.exe', '/FI', `WINDOWTITLE eq apa-nexus*`], { windowsHide: true }, () => {});
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown op: ${op || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[apa]', err);
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}