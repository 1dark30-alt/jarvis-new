import { NextRequest, NextResponse } from 'next/server';
import { McpServerManager } from '@/app/lib/mcp/server-manager';
import { GOOGLE_CALENDAR_SERVER_NAME, JARVIS_DATA_DIR } from '@/app/lib/mcp/dynamic-config';
import { getGoogleServiceEnvForServerName } from '@/app/lib/mcp/google-service-runtime';
import fs from 'fs';
import os from 'os';

// GET /api/mcp/dynamic — Check if Google Calendar MCP is configured
export async function GET() {
  try {
    const manager = McpServerManager.getInstance();
    await manager.initialize();

    const configured = manager.hasServer(GOOGLE_CALENDAR_SERVER_NAME);
    const server = manager.getServer(GOOGLE_CALENDAR_SERVER_NAME);

    return NextResponse.json({
      configured,
      connected: server?.connected ?? false,
      tools: server?.tools?.length ?? 0,
      serverInfo: server?.serverInfo ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// POST /api/mcp/dynamic — Register and start a new MCP server
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, command, args, env } = body as {
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };

    if (!name || !command) {
      return NextResponse.json(
        { error: 'Missing required fields: name and command' },
        { status: 400 },
      );
    }

    const manager = McpServerManager.getInstance();
    await manager.initialize();

    // Merge caller-supplied env with server-specific defaults
    const googleServiceEnv = getGoogleServiceEnvForServerName(name);
    const mergedEnv: Record<string, string> = { ...(googleServiceEnv ?? {}), ...(env ?? {}) };

    // For google-calendar: ensure token/config directories are writable.
    // macOS often lacks ~/.config so we redirect XDG_CONFIG_HOME to ~/.jarvis
    // which we already own and create. This puts tokens at
    // ~/.jarvis/google-calendar-mcp/tokens.json
    if (name === GOOGLE_CALENDAR_SERVER_NAME) {
      if (!mergedEnv['XDG_CONFIG_HOME']) {
        if (!fs.existsSync(JARVIS_DATA_DIR)) {
          fs.mkdirSync(JARVIS_DATA_DIR, { recursive: true });
        }
        mergedEnv['XDG_CONFIG_HOME'] = JARVIS_DATA_DIR;
      }
      // Also ensure HOME is set correctly (Electron can sometimes override it)
      if (!mergedEnv['HOME']) {
        mergedEnv['HOME'] = os.homedir();
      }
    }

    await manager.addServerConfig(name, {
      command,
      args: args ?? [],
      env: mergedEnv,
    });

    return NextResponse.json({
      success: true,
      message: `MCP server "${name}" registered and started`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// DELETE /api/mcp/dynamic — Remove a dynamically registered MCP server
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json(
        { error: 'Missing required query parameter: name' },
        { status: 400 },
      );
    }

    const manager = McpServerManager.getInstance();
    await manager.initialize();
    await manager.removeServer(name);

    return NextResponse.json({
      success: true,
      message: `MCP server "${name}" removed`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
