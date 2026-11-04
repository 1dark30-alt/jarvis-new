import { NextRequest, NextResponse } from 'next/server';
import { McpServerManager } from '@/app/lib/mcp/server-manager';
import { GOOGLE_CALENDAR_SERVER_NAME } from '@/app/lib/mcp/dynamic-config';

const DELETE_EVENT_TOOLS = ['delete-event', 'delete_event', 'deleteEvent'];
const LIST_EVENT_TOOLS   = ['list-events',  'list_events',  'listEvents'];

function toMcpIso(date: Date): string {
  const y  = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const dy = String(date.getDate()).padStart(2, '0');
  const h  = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s  = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${dy}T${h}:${mi}:${s}`;
}

export async function DELETE(req: NextRequest) {
  try {
    const { eventId, calendarId = 'primary' } = (await req.json()) as {
      eventId: string;
      calendarId?: string;
    };

    if (!eventId) {
      return NextResponse.json({ error: 'Missing required field: eventId' }, { status: 400 });
    }

    const manager = McpServerManager.getInstance();
    await manager.initialize();

    const server = manager.getServer(GOOGLE_CALENDAR_SERVER_NAME);
    if (!server?.connected) {
      return NextResponse.json({ error: 'Google Calendar MCP not connected' }, { status: 503 });
    }

    const availableNames = server.tools.map((t) => t.name);
    console.log('[delete-event] Available MCP tools:', availableNames.join(', '));

    const toolName = DELETE_EVENT_TOOLS.find((n) => server.tools.some((t) => t.name === n));
    if (!toolName) {
      return NextResponse.json(
        { error: `No delete-event tool found. Available: ${availableNames.join(', ')}` },
        { status: 404 },
      );
    }

    console.log('[delete-event] Deleting eventId:', eventId);
    const result = await manager.callTool(GOOGLE_CALENDAR_SERVER_NAME, toolName, {
      calendarId,
      eventId,
    });

    if (result.isError) {
      const errText = result.content[0]?.text ?? 'MCP tool error';
      console.error('[delete-event] Tool error:', errText);
      return NextResponse.json({ error: errText }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Search events by title text, return the best matching event ID
export async function POST(req: NextRequest) {
  try {
    const { text, date, calendarId = 'primary' } = (await req.json()) as {
      text: string;
      date?: string;
      calendarId?: string;
    };

    if (!text) {
      return NextResponse.json({ error: 'Missing required field: text' }, { status: 400 });
    }

    const manager = McpServerManager.getInstance();
    await manager.initialize();

    const server = manager.getServer(GOOGLE_CALENDAR_SERVER_NAME);
    if (!server?.connected) {
      return NextResponse.json({ error: 'Google Calendar MCP not connected' }, { status: 503 });
    }

    const availableNames = server.tools.map((t) => t.name);

    // 1. Find event by title
    const listToolName = LIST_EVENT_TOOLS.find((n) => server.tools.some((t) => t.name === n));
    if (!listToolName) {
      return NextResponse.json({ error: 'No list-events tool found' }, { status: 404 });
    }

    // Search a 7-day window centred on the target date
    const anchor = date ? new Date(date + 'T00:00:00') : new Date();
    const timeMin = toMcpIso(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 3));
    const timeMax = toMcpIso(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7, 23, 59, 59));

    const listResult = await manager.callTool(GOOGLE_CALENDAR_SERVER_NAME, listToolName, {
      calendarId,
      timeMin,
      timeMax,
      maxResults: 50,
    });

    if (listResult.isError) {
      return NextResponse.json({ error: 'Failed to list events for matching' }, { status: 500 });
    }

    const rawText = listResult.content.map((c) => c.text ?? '').join('\n');
    let events: { id?: string; summary?: string; start?: unknown }[] = [];
    try {
      const parsed = JSON.parse(rawText);
      events = Array.isArray(parsed) ? parsed : (parsed.items ?? parsed.events ?? []);
    } catch { /* could not parse */ }

    const query = text.toLowerCase();
    const match = events.find((ev) =>
      (ev.summary ?? '').toLowerCase().includes(query)
    );

    if (!match?.id) {
      return NextResponse.json({ error: `No event matching "${text}" found near that date.` }, { status: 404 });
    }

    // 2. Delete the matched event
    const deleteToolName = DELETE_EVENT_TOOLS.find((n) => server.tools.some((t) => t.name === n));
    if (!deleteToolName) {
      return NextResponse.json({ error: 'No delete-event tool found' }, { status: 404 });
    }

    console.log('[delete-event] Matched event:', match.summary, 'id:', match.id);
    const deleteResult = await manager.callTool(GOOGLE_CALENDAR_SERVER_NAME, deleteToolName, {
      calendarId,
      eventId: match.id,
    });

    if (deleteResult.isError) {
      const errText = deleteResult.content[0]?.text ?? 'MCP delete error';
      return NextResponse.json({ error: errText }, { status: 500 });
    }

    return NextResponse.json({ success: true, deletedId: match.id, deletedTitle: match.summary });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
