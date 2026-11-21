import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 60_000;
const MAX_BYTES = 30 * 1024 * 1024;

function pyExe(): string { return process.env.JARVIS_PYTHON || 'python'; }

/**
 * PDF text extraction via pdfplumber — keeps the visual reading order of
 * columnar documents (the standings sheets come out row-perfect).
 * Accepts the raw PDF bytes as the request body.
 */
export async function POST(req: NextRequest) {
  const tmp = path.join(os.tmpdir(), `jarvis-pdf-${Date.now()}.pdf`);
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) return NextResponse.json({ error: 'Empty upload.' }, { status: 400 });
    if (buf.length > MAX_BYTES) return NextResponse.json({ error: 'PDF too large (30 MB limit).' }, { status: 413 });
    fs.writeFileSync(tmp, buf);

    const script = path.join(process.cwd(), 'scripts', 'pdf_text.py');
    const text = await new Promise<string>((resolve) => {
      execFile(pyExe(), [script, tmp], {
        timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 8_000_000, encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      }, (err, stdout) => {
        if (err && !stdout) { resolve(JSON.stringify({ error: String(err).slice(0, 200) })); return; }
        resolve(stdout);
      });
    });
    let parsed: { pages?: number; text?: string; error?: string };
    try { parsed = JSON.parse(text); } catch { return NextResponse.json({ error: `Extraction failed: ${text.slice(0, 200)}` }, { status: 500 }); }
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 500 });
    return NextResponse.json({ ok: true, pages: parsed.pages ?? 0, text: parsed.text ?? '' });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}