import { NextResponse } from 'next/server';
import { GOOGLE_SERVICES } from '@/app/lib/google-services';
import { McpServerManager } from '@/app/lib/mcp/server-manager';
import { GOOGLE_CREDENTIALS_PATH } from '@/app/lib/mcp/dynamic-config';
import { getGoogleServiceRuntime } from '@/app/lib/mcp/google-service-runtime';
import fs from 'fs';

export async function GET() {
  try {
    const manager = McpServerManager.getInstance();
    await manager.initialize();

    const services = GOOGLE_SERVICES.map((service) => {
      const runtime = getGoogleServiceRuntime(service.id);
      const server = manager.getServer(service.serverName);

      return {
        id: service.id,
        label: service.label,
        shortLabel: service.shortLabel,
        serverName: service.serverName,
        configured: manager.hasServer(service.serverName),
        connected: server?.connected ?? false,
        tools: server?.tools?.length ?? 0,
        serverInfo: server?.serverInfo ?? null,
        authenticated: runtime ? fs.existsSync(runtime.tokenPath) : false,
        tokenPath: runtime?.tokenPath ?? null,
      };
    });

    return NextResponse.json({
      hasCredentials: fs.existsSync(GOOGLE_CREDENTIALS_PATH),
      credentialsPath: GOOGLE_CREDENTIALS_PATH,
      services,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
