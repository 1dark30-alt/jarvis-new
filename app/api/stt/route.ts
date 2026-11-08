import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const runtime = 'nodejs';
const run = promisify(execFile);

export async function POST(req: NextRequest) {
  let directory: string | undefined;
  try {
    const form = await req.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || !audio.size || audio.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Provide an audio recording between 1 byte and 10 MB.' }, { status: 400 });
    }
    directory = await mkdtemp(path.join(tmpdir(), 'jarvis-stt-'));
    const input = path.join(directory, 'recording.audio');
    await writeFile(input, Buffer.from(await audio.arrayBuffer()));
    const { stdout } = await run(process.env.JARVIS_STT_PYTHON || 'python',
      [path.join(process.cwd(), 'scripts', 'transcribe_local.py'), input], {
        windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024, signal: req.signal,
      });
    const result = JSON.parse(stdout.trim());
    if (typeof result.text !== 'string') throw new Error('Invalid transcription output');
    return NextResponse.json({ text: result.text });
  } catch (error) {
    console.error('[local-stt]', error instanceof Error ? error.message : 'Transcription failed');
    return NextResponse.json({ error: 'Local Whisper transcription failed. Check Python, faster-whisper, and the downloaded base.en model.' }, { status: 502 });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
