import { NextRequest, NextResponse } from 'next/server';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pythonExe } from '@/app/lib/server/python-exe';

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


/** Folders inside the league folder that are NOT season folders. */
const NON_SEASON_DIRS = new Set([
  'combine scoresheets', 'jarvis memory', 'bh', 'bh results',
  'conversations', 'apa', 'attachments', 'downloads',
]);
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
  writeSettingsValue('apa_league_folder', p);
}

/** Per-user drop folder for fresh combined scoresheets PDFs (e.g. a synced
 * vault folder). Takes precedence over the auto-detected sibling folder. */
function readDropFolder(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
    const inner = (typeof raw.jarvis_settings === 'string'
      ? JSON.parse(raw.jarvis_settings)
      : raw.jarvis_settings ?? {}) as Record<string, unknown>;
    return String(inner.apa_drop_folder ?? '').trim();
  } catch {
    return '';
  }
}

function writeDropFolder(p: string): void {
  writeSettingsValue('apa_drop_folder', p);
}

function writeSettingsValue(key: string, value: string): void {
  const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
  const inner = (typeof raw.jarvis_settings === 'string'
    ? JSON.parse(raw.jarvis_settings)
    : raw.jarvis_settings ?? {}) as Record<string, unknown>;
  inner[key] = value;
  raw.jarvis_settings = JSON.stringify(inner);
  fs.writeFileSync(settingsFile(), JSON.stringify(raw, null, 2), 'utf8');
}

function runToolkit(args: string[], timeoutMs = 300_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(pythonExe(), [TOOLKIT, ...args], {
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

/** Candidate PDFs to process: drop folder + Downloads + league folder root. */
function listPdfCandidates(league: string, drop = ''): { name: string; path: string; mtime: number }[] {
  const folders = [
    // The configured drop folder for fresh combined scoresheets (e.g. a
    // synced vault folder) takes precedence…
    drop,
    // …then the auto-detected sibling folder next to the league folder…
    path.dirname(league) ? path.join(path.dirname(league), 'combine scoresheets') : '',
    // …then Downloads and the league folder root.
    path.join(os.homedir(), 'Downloads'),
    ...(league && fs.existsSync(league) ? [league] : []),
  ].filter(Boolean);
  const seen = new Set<string>();
  const out: { name: string; path: string; mtime: number }[] = [];
  for (const dir of folders) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.pdf')) continue;
      const full = path.join(dir, e.name);
      if (seen.has(full.toLowerCase())) continue;
      seen.add(full.toLowerCase());
      try {
        out.push({ name: e.name, path: full, mtime: fs.statSync(full).mtimeMs });
      } catch { /* skip */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 25);
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

  const dropFolder = readDropFolder();

  if (!league || !fs.existsSync(league)) {
    return NextResponse.json({ configured: false, league: league || null, dropFolder, message: league ? 'League folder no longer exists — set it again.' : 'No league folder configured.' });
  }

  if (op === 'weeks') {
    return NextResponse.json({ configured: true, league, dropFolder, weeks: weekFolders(league) });
  }

  if (op === 'list_pdfs') {
    return NextResponse.json({ ok: true, league, dropFolder, pdfs: listPdfCandidates(league, dropFolder) });
  }

  // Default: everything the page needs on load — weeks AND the legacy-layout
  // check (division folders sitting at the league root, pre-season layout).
  let legacyDivisions: string[] = [];
  let seasons: string[] = [];
  try {
    const rootEntries = fs.readdirSync(league, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const e of rootEntries) {
      if (NON_SEASON_DIRS.has(e.name.toLowerCase())) continue;
      const kids = fs.readdirSync(path.join(league, e.name), { withFileTypes: true });
      if (kids.some((k) => /^week \d+$/i.test(k.name))) legacyDivisions.push(e.name);
      else seasons.push(e.name);
    }
  } catch { /* league folder unreadable */ }

  return NextResponse.json({
    configured: true,
    league,
    dropFolder,
    weeks: weekFolders(league),
    seasons,
    legacyDivisions,
  });
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

      case 'set_drop_folder': {
        const p = path.resolve(String(a.dropFolder ?? '').trim());
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
          return NextResponse.json({ error: `No such folder: ${p}` }, { status: 400 });
        }
        writeDropFolder(p);
        const leagueNow = readLeagueFolder();
        return NextResponse.json({ ok: true, dropFolder: p, pdfs: listPdfCandidates(leagueNow, p) });
      }

      case 'process': {
        const league = readLeagueFolder();
        if (!league) return NextResponse.json({ error: 'Set the league folder first.' }, { status: 400 });
        const pdf = path.resolve(String(a.pdfPath ?? '').trim());
        if (!fs.existsSync(pdf)) return NextResponse.json({ error: `No such file: ${pdf}` }, { status: 404 });
        // Sheets file into <league>\<season>\<Division>\Week N.
        const season = String(a.season ?? '').trim() || String(new Date().getFullYear());
        const seasonRoot = path.join(league, season);
        fs.mkdirSync(seasonRoot, { recursive: true });
        const result = await runToolkit(['--cli', pdf, seasonRoot]);
        return NextResponse.json({ ok: result.code === 0, output: result.output, code: result.code, season });
      }

      case 'migrate': {
        // One-time move: legacy <league>\<Division>\Week N folders into
        // <league>\<season>\<Division>\Week N.
        const league = readLeagueFolder();
        if (!league) return NextResponse.json({ error: 'Set the league folder first.' }, { status: 400 });
        const season = String(a.season ?? '').trim() || String(new Date().getFullYear());
        const seasonRoot = path.join(league, season);
        fs.mkdirSync(seasonRoot, { recursive: true });
        const moved: string[] = [];
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(league, { withFileTypes: true }); } catch (e) {
          return NextResponse.json({ error: String(e) }, { status: 500 });
        }
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (NON_SEASON_DIRS.has(e.name.toLowerCase())) continue;
          const div = path.join(league, e.name);
          // Only legacy division folders — ones that directly hold Week dirs.
          let kids: fs.Dirent[];
          try { kids = fs.readdirSync(div, { withFileTypes: true }); } catch { continue; }
          if (!kids.some((k) => /^week \d+$/i.test(k.name))) continue;
          fs.renameSync(div, path.join(seasonRoot, e.name));
          moved.push(e.name);
        }
        return NextResponse.json({ ok: true, moved, season });
      }

      case 'nexus_matches': {
        const league = readLeagueFolder();
        if (!league) return NextResponse.json({ error: 'Set the league folder first.' }, { status: 400 });
        const weekName = String(a.weekFolder ?? '');
        if (!weekName) return NextResponse.json({ error: 'Pick a week first.' }, { status: 400 });
        const matches = await new Promise<{ matches?: { index: number; teams: string; matchCount: number }[]; error?: string }>((resolve) => {
          execFile(pythonExe(), [HELPER, '--list', league, weekName], {
            timeout: 120_000,
            windowsHide: true,
            maxBuffer: 2_000_000,
            encoding: 'utf8',
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          }, (err, stdout) => {
            if (err && !stdout) { resolve({ error: String(err).slice(0, 200) }); return; }
            try { resolve(JSON.parse(stdout)); }
            catch { resolve({ error: `unreadable output: ${String(stdout).slice(0, 120)}` }); }
          });
        });
        if (matches.error) return NextResponse.json({ error: matches.error }, { status: 400 });
        return NextResponse.json({ ok: true, matches: matches.matches ?? [] });
      }

      case 'nexus_start': {
        const league = readLeagueFolder();
        if (!league) return NextResponse.json({ error: 'Set the league folder first.' }, { status: 400 });
        const weekName = String(a.weekFolder ?? '');
        const matchIndex = Number(a.matchIndex ?? 0);
        // Kill any stale helper instances first — each one holds a global
        // hotkey, and six zombies exhaust every key on the ladder.
        await new Promise<void>((resolve) => {
          execFile('powershell.exe', ['-NoProfile', '-Command',
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'apa_nexus_helper' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
            { timeout: 10_000, windowsHide: true }, () => resolve());
        });
        const child = spawn(pythonExe(), [HELPER, league, weekName, String(matchIndex)], {
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
        // Actually kill the helper — marking the state is not enough, the
        // process holds a global hotkey until it exits.
        await new Promise<void>((resolve) => {
          execFile('powershell.exe', ['-NoProfile', '-Command',
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'apa_nexus_helper' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
            { timeout: 10_000, windowsHide: true }, () => resolve());
        });
        const base = process.env.JARVIS_DATA_DIR || process.cwd();
        try {
          const st = JSON.parse(fs.readFileSync(path.join(base, 'apa-nexus-state.json'), 'utf8'));
          st.running = false;
          st.message = 'Helper stopped.';
          fs.writeFileSync(path.join(base, 'apa-nexus-state.json'), JSON.stringify(st, null, 1));
        } catch { /* no state yet */ }
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