import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Local state backup for the Bounty Hunter league dashboard (port of the
// Python service's POST /api/publish). Validates the league database shape
// and writes it to %LOCALAPPDATA%/Jarvis/BountyHunter/state.json.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 10 * 1024 * 1024; // 10 MB, same as the original service

function dataFile(): string {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Jarvis', 'BountyHunter')
    : path.join(os.homedir(), 'AppData', 'Local', 'Jarvis', 'BountyHunter');
  return path.join(base, 'state.json');
}

export async function POST(req: NextRequest) {
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return NextResponse.json(
      { success: false, error: 'Expected application/json.' },
      { status: 415 }
    );
  }

  try {
    const raw = await req.text();
    if (raw.length === 0 || raw.length > LIMIT) {
      return NextResponse.json(
        { success: false, error: 'Payload too large.' },
        { status: 413 }
      );
    }

    const state = JSON.parse(raw) as unknown;
    if (
      typeof state !== 'object' || state === null ||
      typeof (state as Record<string, unknown>).divisions !== 'object' ||
      !Array.isArray((state as Record<string, unknown>).weeks)
    ) {
      throw new Error('Invalid league database');
    }

    const file = dataFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');

    return NextResponse.json({ success: true, saved: file });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Could not validate or save local database.' },
      { status: 400 }
    );
  }
}
