import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 20_000;

function pythonExe(): string {
  return process.env.JARVIS_PYTHON || 'python';
}

function readHistory(limit: number): Promise<{ notifications?: { app: string; time: string | null; title: string; body: string }[]; error?: string }> {
  const script = path.join(process.cwd(), 'scripts', 'notifications_history.py');
  return new Promise((resolve) => {
    execFile(pythonExe(), [script, String(limit)], {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 2_000_000,
      encoding: 'utf8',
    }, (err, stdout) => {
      if (err && !stdout) { resolve({ error: String(err).slice(0, 200) }); return; }
      try { resolve(JSON.parse(stdout)); }
      catch { resolve({ error: `unreadable output: ${stdout.slice(0, 120)}` }); }
    });
  });
}

export async function GET(req: NextRequest) {
  const limit = Math.min(80, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 30)));
  const data = await readHistory(limit);
  if (data.error) return NextResponse.json({ notifications: [], error: data.error }, { status: 500 });
  return NextResponse.json({ notifications: data.notifications ?? [] });
}