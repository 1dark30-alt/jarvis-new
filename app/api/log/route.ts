import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 512 * 1024;

/** Debug log — POST { tag, message } appends to jarvis-debug.log. */
export async function POST(req: NextRequest) {
  try {
    const { tag, message } = (await req.json()) as { tag?: string; message?: string };
    const base = process.env.JARVIS_DATA_DIR || process.cwd();
    const file = path.join(base, 'jarvis-debug.log');
    const line = `[${new Date().toISOString()}] [${tag ?? '?'}] ${String(message ?? '').slice(0, 500)}\n`;
    let existing = '';
    try { existing = fs.readFileSync(file, 'utf8'); if (existing.length > MAX_BYTES) existing = existing.slice(-MAX_BYTES / 2); } catch { /* new file */ }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, existing + line, 'utf8');
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  try {
    return new NextResponse(fs.readFileSync(path.join(base, 'jarvis-debug.log'), 'utf8'), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch {
    return new NextResponse('(empty)', { headers: { 'Content-Type': 'text/plain' } });
  }
}

void os;