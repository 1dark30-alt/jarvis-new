import { NextRequest, NextResponse } from 'next/server';
import { McpServerManager } from '@/app/lib/mcp/server-manager';

export async function GET() {
  try {
    const manager = McpServerManager.getInstance();
    await manager.initialize();
    const tools = manager.listTools();
    const servers = manager.getServerStatus();
    return NextResponse.json({ tools, servers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { server, tool, arguments: args } = body as {
      server?: string;
      tool?: string;
      arguments?: Record<string, unknown>;
    };

    if (!server || !tool) {
      return NextResponse.json(
        { error: 'Missing required fields: server and tool' },
        { status: 400 },
      );
    }

    const manager = McpServerManager.getInstance();
    await manager.initialize();
    const result = await manager.callTool(server, tool, args ?? {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
