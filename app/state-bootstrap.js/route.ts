import { NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Local state backup for the Bounty Hunter league dashboard (port of the
// Python service's GET /state-bootstrap.js). The dashboard keeps its live
// data in localStorage; this script seeds it from the last saved state.json
// on disk when localStorage is empty (backup recovery after a cleared cache).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dataFile(): string {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Jarvis', 'BountyHunter')
    : path.join(os.homedir(), 'AppData', 'Local', 'Jarvis', 'BountyHunter');
  return path.join(base, 'state.json');
}

export async function GET() {
  let saved: string | null = null;
  try {
    saved = fs.readFileSync(dataFile(), 'utf8');
  } catch {
    saved = null; // no backup yet — first run or cleared data
  }

  const script = saved
    ? `if(!localStorage.getItem('bounty_hunter_state'))localStorage.setItem('bounty_hunter_state',${JSON.stringify(saved)});`
    : '/* local backup recovery */';

  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
