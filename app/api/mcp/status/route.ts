import { NextResponse } from 'next/server';
import { McpServerManager } from '@/app/lib/mcp/server-manager';

export async function GET() {
  try {
    const manager = McpServerManager.getInstance();
    await manager.initialize();
    const servers = manager.getServerStatus();
    const tools = manager.listTools();
    return NextResponse.json({
      servers,
      totalTools: tools.length,
      connectedCount: servers.filter((s) => s.connected).length,
      serverCount: servers.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
