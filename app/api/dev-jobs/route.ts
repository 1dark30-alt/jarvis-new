import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Developer Mode — local engineering jobs with review and outputs, port of
 * Mark 58's `core/developer.py`. Jobs are allowlisted and bounded: no free-form
 * shell here (the assistant already has run_shell_command for that); this is
 * the structured, reviewable path.
 */

const MAX_OUTPUT_CHARS = 8000;

interface Job {
  id: string;
  label: string;
  cmd: string;
  args: string[];
  timeoutMs: number;
}

function jobs(cwd: string): Job[] {
  const isWin = process.platform === 'win32';
  // Node refuses to spawn .cmd shims directly (spawn EINVAL) — npm jobs go
  // through cmd.exe; typecheck runs tsc directly under node.
  const npm = (cmd: string) => isWin
    ? { cmd: 'cmd.exe', args: ['/d', '/s', '/c', cmd] }
    : { cmd: 'npm', args: cmd.split(' ') };
  const tscBin = path.join(cwd, 'node_modules', 'typescript', 'bin', 'tsc');
  const build = npm('npm run build');
  const deps = npm('npm ls --depth=0');
  return [
    { id: 'typecheck', label: 'TypeScript check', cmd: 'node', args: [tscBin, '--noEmit'], timeoutMs: 180_000 },
    { id: 'build', label: 'Next.js build', cmd: build.cmd, args: build.args, timeoutMs: 600_000 },
    { id: 'deps', label: 'Dependency list', cmd: deps.cmd, args: deps.args, timeoutMs: 60_000 },
    { id: 'git_status', label: 'Git status', cmd: 'git', args: ['status', '--porcelain'], timeoutMs: 15_000 },
    { id: 'git_log', label: 'Recent commits', cmd: 'git', args: ['log', '--oneline', '-15'], timeoutMs: 15_000 },
    { id: 'git_diff', label: 'Diff stat (unstaged)', cmd: 'git', args: ['diff', '--stat'], timeoutMs: 15_000 },
  ];
}

function runJob(job: Job, cwd: string): Promise<{ ok: boolean; output: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(job.cmd, job.args, {
      cwd,
      timeout: job.timeoutMs,
      windowsHide: true,
      maxBuffer: 2_000_000,
      env: { ...process.env, PATH: `${process.env.Path ?? process.env.PATH}` },
    }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : (err ? 1 : 0);
      const out = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
      resolve({
        ok: !err,
        code: err ? code : 0,
        output: out.length > MAX_OUTPUT_CHARS ? out.slice(-MAX_OUTPUT_CHARS) : out,
      });
    });
  });
}

/** Static analysis of the codebase — Mark's `analyze`: the shape of the project. */
function analyze(cwd: string): { files: number; lines: number; byExt: Record<string, number>; largest: { name: string; lines: number }[] } {
  const skip = new Set(['node_modules', '.next', '.git', 'dist', 'out', 'dist-electron', 'services', 'public']);
  const byExt: Record<string, number> = {};
  const largest: { name: string; lines: number }[] = [];
  let files = 0;
  let lines = 0;

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(full); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!['.ts', '.tsx', '.js', '.mjs', '.css', '.py'].includes(ext)) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const n = content.split('\n').length;
        files++;
        lines += n;
        byExt[ext] = (byExt[ext] ?? 0) + n;
        largest.push({ name: path.relative(cwd, full), lines: n });
      } catch { /* unreadable */ }
    }
  };
  walk(cwd);
  largest.sort((a, b) => b.lines - a.lines);
  return { files, lines, byExt, largest: largest.slice(0, 12) };
}

export async function GET() {
  const cwd = process.cwd();
  return NextResponse.json({
    cwd,
    jobs: jobs(cwd).map((j) => ({ id: j.id, label: j.label })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { job, argument } = (await req.json()) as { job?: string; argument?: string };
    const cwd = process.cwd();
    void argument;

    if (job === 'analyze') {
      return NextResponse.json({ ok: true, job, analysis: analyze(cwd) });
    }

    const found = jobs(cwd).find((j) => j.id === job);
    if (!found) {
      return NextResponse.json({ error: `Unknown job. Available: analyze, ${jobs(cwd).map((j) => j.id).join(', ')}` }, { status: 400 });
    }
    const result = await runJob(found, cwd);
    return NextResponse.json({ ok: result.ok, job: found.id, label: found.label, code: result.code, output: result.output });
  } catch (err) {
    console.error('[dev-jobs]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}