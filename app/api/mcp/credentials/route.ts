import { NextRequest, NextResponse } from 'next/server';
import {
  GOOGLE_CREDENTIALS_DIR,
  GOOGLE_CREDENTIALS_PATH,
  LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH,
} from '@/app/lib/mcp/dynamic-config';
import fs from 'fs';

const CRED_PATH = GOOGLE_CREDENTIALS_PATH;

function ensureSharedCredentialsDir() {
  if (!fs.existsSync(GOOGLE_CREDENTIALS_DIR)) {
    fs.mkdirSync(GOOGLE_CREDENTIALS_DIR, { recursive: true });
  }
}

function migrateLegacyCalendarCredentials() {
  if (fs.existsSync(CRED_PATH) || !fs.existsSync(LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH)) {
    return;
  }

  ensureSharedCredentialsDir();
  fs.copyFileSync(LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH, CRED_PATH);
}

export async function GET() {
  try {
    migrateLegacyCalendarCredentials();

    if (!fs.existsSync(CRED_PATH)) {
      return NextResponse.json({ exists: false });
    }

    const raw = fs.readFileSync(CRED_PATH, 'utf-8');
    let parsed: Record<string, unknown> | null = null;
    let isValid = false;
    let projectInfo: Record<string, unknown> = {};

    try {
      parsed = JSON.parse(raw);
      const installed = parsed?.installed as Record<string, unknown> | undefined;
      if (installed && installed.client_id && typeof installed.client_id === 'string') {
        isValid = true;
        projectInfo = {
          client_id: (installed.client_id as string).substring(0, 20) + '...',
          project_id: installed.project_id || null,
          auth_uri: installed.auth_uri || null,
        };
      }
    } catch {
      void 0;
    }

    return NextResponse.json({
      exists: true,
      isValid,
      path: CRED_PATH,
      legacyMigrated: fs.existsSync(LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH),
      projectInfo: isValid ? projectInfo : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { content } = body as { content: string };

    if (!content) {
      return NextResponse.json(
        { error: 'Missing credentials content' },
        { status: 400 },
      );
    }

    if (content.length > 1_000_000) {
      return NextResponse.json(
        { error: 'File too large — credentials.json should be under 1MB' },
        { status: 413 },
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON — please upload a valid credentials.json file' },
        { status: 400 },
      );
    }

    const installed = parsed?.installed as Record<string, unknown> | undefined;
    if (!installed || !installed.client_id || !installed.client_secret) {
      return NextResponse.json(
        { error: 'Invalid credentials format — expected a Desktop app OAuth credentials file with "installed" object containing client_id and client_secret' },
        { status: 400 },
      );
    }

    ensureSharedCredentialsDir();

    fs.writeFileSync(CRED_PATH, content, 'utf-8');
    try { fs.chmodSync(CRED_PATH, 0o600); } catch { /* best effort */ }

    return NextResponse.json({
      success: true,
      message: 'Credentials saved successfully',
      projectId: (installed.project_id as string) || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    if (fs.existsSync(CRED_PATH)) {
      fs.unlinkSync(CRED_PATH);
    }
    if (fs.existsSync(LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH)) {
      fs.unlinkSync(LEGACY_GOOGLE_CALENDAR_CREDENTIALS_PATH);
    }
    return NextResponse.json({
      success: true,
      message: 'Credentials removed',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
