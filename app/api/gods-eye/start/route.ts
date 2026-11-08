import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/**
 * On-demand launcher for the God's Eye View service (Vite dev server on
 * 127.0.0.1:4173), ported from the JARVIS-system plugin's ensure_service().
 *
 * GET  -> service status { ready, occupied }
 * POST -> start the service if needed and wait until it responds
 */

const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;
const APP_NAME = "God's Eye View";

function serviceDir(): string {
  return path.join(process.cwd(), 'services', 'gods-eye-view');
}

function nodeExe(): string {
  return path.join(
    process.cwd(), 'services', '.runtime', 'node-v24.21.0-win-x64', 'node.exe'
  );
}

async function ready(): Promise<boolean> {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(2000) });
    const text = await res.text();
    return res.ok && text.includes(APP_NAME);
  } catch {
    return false;
  }
}

async function portOccupied(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = netConnect({ host: '127.0.0.1', port: PORT, timeout: 1000 });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(true); });
  });
}

export async function GET() {
  return NextResponse.json({ ready: await ready(), url: URL });
}

export async function POST(_req: NextRequest) {
  if (await ready()) {
    return NextResponse.json({ ready: true, url: URL, started: false });
  }

  if (await portOccupied()) {
    return NextResponse.json(
      { ready: false, error: 'Port 4173 is in use by another service; no process was stopped.' },
      { status: 409 }
    );
  }

  const dir = serviceDir();
  const vite = path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(nodeExe()) || !fs.existsSync(vite)) {
    return NextResponse.json(
      { ready: false, error: "The dedicated Node runtime or God's Eye dependencies are missing." },
      { status: 500 }
    );
  }

  // Keep Jarvis/provider credentials out of this independent service —
  // users may configure God's Eye itself via its own .env later.
  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    const example = fs.readFileSync(path.join(dir, '.env.example'), 'utf8');
    for (const line of example.split('\n')) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
      if (m) delete env[m[1]];
    }
  } catch { /* no .env.example — skip scrubbing */ }

  env.HOST = '127.0.0.1';
  env.PORT = String(PORT);
  // Allow the Jarvis UI (dev/prod both served from 127.0.0.1:3000) to frame
  // embed-mode documents, per the viewer's embed-framing policy.
  env.GEV_EMBED_FRAME_ANCESTORS = 'http://127.0.0.1:3000';

  const log = fs.openSync(path.join(dir, 'jarvis-service.log'), 'a');
  const child = spawn(
    nodeExe(),
    [vite, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: dir, env, stdio: ['ignore', log, log], detached: true, windowsHide: true }
  );
  child.unref();
  fs.closeSync(log);

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) {
      return NextResponse.json(
        { ready: false, error: "God's Eye exited during startup. See services/gods-eye-view/jarvis-service.log." },
        { status: 502 }
      );
    }
    if (await ready()) {
      return NextResponse.json({ ready: true, url: URL, started: true });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  return NextResponse.json(
    { ready: false, error: "God's Eye startup exceeded 45 seconds. See jarvis-service.log and retry." },
    { status: 504 }
  );
}