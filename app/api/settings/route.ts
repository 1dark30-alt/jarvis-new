import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Server-side settings file — persists across clients on the same machine.
// This file holds sensitive credentials (OpenAI key, Home Assistant token,
// Bambu email), so it MUST live in a per-user, writable location — never inside
// the distributable app bundle. In packaged builds Electron passes
// JARVIS_DATA_DIR (the OS per-user app-data dir); in dev we fall back to the
// project root, which is git-ignored.
function getSettingsPath(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-server-settings.json');
}

function readSettings(): Record<string, unknown> {
  try {
    const p = getSettingsPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(data: Record<string, unknown>): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf-8');
}

export async function GET() {
  return NextResponse.json(readSettings());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    // Merge with existing so partial updates (e.g. just HA creds) don't wipe everything
    const existing = readSettings();
    const merged = { ...existing, ...body };
    writeSettings(merged);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
