import { NextRequest, NextResponse } from 'next/server';
import { McpServerManager } from '@/app/lib/mcp/server-manager';
import { GOOGLE_CALENDAR_SERVER_NAME } from '@/app/lib/mcp/dynamic-config';

const CREATE_EVENT_TOOLS = ['create-event', 'create_event', 'createEvent'];

// Parse a human-readable time string ("3:00 PM", "15:00", "3pm") into 24h {h, m}
function parseTime(timeStr: string): { h: number; m: number } | null {
  const s = timeStr.trim().toLowerCase();

  // HH:MM or H:MM (24-hour)
  const hhmm = s.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
  if (hhmm) {
    let h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    const meridiem = hhmm[3];
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    return { h, m };
  }

  // "3pm" / "3am"
  const simple = s.match(/^(\d{1,2})\s*(am|pm)$/);
  if (simple) {
    let h = parseInt(simple[1], 10);
    if (simple[2] === 'pm' && h < 12) h += 12;
    if (simple[2] === 'am' && h === 12) h = 0;
    return { h, m: 0 };
  }

  return null;
}

// Format a Date as YYYY-MM-DDTHH:mm:ss using LOCAL time components.
// Never use .toISOString() — that converts to UTC, shifting the time by the
// timezone offset (e.g. 5 PM Central → 22:00 UTC → MCP reads it as 10 PM).
function toMcpIso(date: Date): string {
  const y  = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const dy = String(date.getDate()).padStart(2, '0');
  const h  = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s  = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${dy}T${h}:${mi}:${s}`;
}

export interface CreateEventBody {
  summary: string;
  date?: string;       // YYYY-MM-DD; defaults to today
  time?: string;       // human readable start time; omit for all-day
  endTime?: string;    // human readable end time; defaults to start + duration
  duration?: number;   // minutes; default 60
  description?: string;
  location?: string;
  calendarId?: string; // default "primary"
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateEventBody;
    const {
      summary,
      date,
      time,
      endTime,
      duration = 60,
      description,
      location,
      calendarId = 'primary',
    } = body;

    if (!summary) {
      return NextResponse.json({ error: 'Missing required field: summary' }, { status: 400 });
    }

    const manager = McpServerManager.getInstance();
    await manager.initialize();

    const server = manager.getServer(GOOGLE_CALENDAR_SERVER_NAME);
    if (!server?.connected) {
      return NextResponse.json({ error: 'Google Calendar MCP not connected' }, { status: 503 });
    }

    const availableNames = server.tools.map((t) => t.name);
    console.log('[create-event] Available MCP tools:', availableNames.join(', '));

    const toolName = CREATE_EVENT_TOOLS.find((n) => server.tools.some((t) => t.name === n));
    if (!toolName) {
      console.error('[create-event] No create-event tool found. Available:', availableNames);
      return NextResponse.json(
        { error: `No create-event tool found. Available: ${availableNames.join(', ')}` },
        { status: 404 },
      );
    }

    // Log the tool's input schema so we know the exact arg names expected
    const toolDef = server.tools.find((t) => t.name === toolName);
    console.log('[create-event] Using tool:', toolName, 'Schema:', JSON.stringify(toolDef?.inputSchema ?? {}));

    // Build date/time objects
    const today = new Date();
    const dateStr = date ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const [y, mo, d] = dateStr.split('-').map(Number);

    // The MCP tool expects start/end as plain strings:
    //   Timed:   "2026-05-09T15:00:00"
    //   All-day: "2026-05-09"
    let eventStart: string;
    let eventEnd: string;

    const parsed = time ? parseTime(time) : null;

    if (parsed) {
      const startDate = new Date(y, mo - 1, d, parsed.h, parsed.m);
      let endDate: Date;

      if (endTime) {
        const parsedEnd = parseTime(endTime);
        endDate = parsedEnd
          ? new Date(y, mo - 1, d, parsedEnd.h, parsedEnd.m)
          : new Date(startDate.getTime() + duration * 60_000);
      } else {
        endDate = new Date(startDate.getTime() + duration * 60_000);
      }

      eventStart = toMcpIso(startDate); // "2026-05-09T15:00:00"
      eventEnd   = toMcpIso(endDate);
    } else {
      // All-day event — plain date strings
      const nextDay = new Date(y, mo - 1, d + 1);
      const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
      eventStart = dateStr;    // "2026-05-09"
      eventEnd   = nextDayStr; // "2026-05-10"
    }

    const eventArgs: Record<string, unknown> = {
      calendarId,
      summary,
      start: eventStart,
      end: eventEnd,
    };
    if (description) eventArgs.description = description;
    if (location)    eventArgs.location    = location;

    console.log('[create-event] Calling tool with args:', JSON.stringify(eventArgs));
    const result = await manager.callTool(GOOGLE_CALENDAR_SERVER_NAME, toolName, eventArgs);
    console.log('[create-event] Tool result isError:', result.isError, 'Content:', result.content.map(c => c.text).join(' | ').slice(0, 300));

    if (result.isError) {
      const errText = result.content[0]?.text ?? 'MCP tool error';
      console.error('[create-event] Tool error:', errText);
      return NextResponse.json({ error: errText }, { status: 500 });
    }

    const rawText = result.content.map((c) => c.text ?? '').join('\n');
    let created: Record<string, unknown> | null = null;
    try { created = JSON.parse(rawText); } catch { /* response might be plain text */ }

    // Build an optimistic ICalEvent so the UI can insert it instantly without
    // waiting for Google Calendar to index and the next MCP poll.
    const optimistic = {
      id:          `opt-${Date.now()}`,
      title:       summary,
      start:       eventStart,
      end:         eventEnd,
      allDay:      !parsed,
      location:    location ?? '',
      description: description ?? '',
    };

    return NextResponse.json({ success: true, event: created, raw: rawText, optimistic });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
