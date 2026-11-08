import { NextRequest, NextResponse } from 'next/server';
import { McpServerManager } from '@/app/lib/mcp/server-manager';
import { GOOGLE_CALENDAR_SERVER_NAME } from '@/app/lib/mcp/dynamic-config';
import type { ICalEvent } from '@/app/api/ical/route';

// MCP tool expects ISO 8601 without milliseconds and without trailing Z
// e.g. "2026-01-01T00:00:00" not "2026-01-01T00:00:00.000Z"
function toMcpIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

// Common tool names used by different Google Calendar MCP implementations
const LIST_EVENT_TOOLS = [
  'list-events',
  'list_events',
  'listEvents',
  'get-events',
  'get_events',
];

interface GCalEvent {
  id?: string;
  summary?: string;
  title?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string } | string;
  end?: { dateTime?: string; date?: string } | string;
}

function normalizeEvent(ev: GCalEvent): ICalEvent {
  const rawStart = ev.start;
  const rawEnd   = ev.end;

  let startIso = '';
  let endIso   = '';
  let allDay    = false;

  // Preserve the original timezone-aware datetime string rather than converting
  // to UTC — groupByDate slices the first 10 chars for the date key, so
  // converting to UTC would shift overnight events to the wrong day.
  if (typeof rawStart === 'string') {
    startIso = rawStart;
  } else if (rawStart?.dateTime) {
    startIso = rawStart.dateTime; // keep original offset, e.g. "2026-05-09T21:00:00-05:00"
  } else if (rawStart?.date) {
    startIso = `${rawStart.date}T00:00:00`; // all-day: no Z so slice(0,10) is always correct
    allDay = true;
  }

  if (typeof rawEnd === 'string') {
    endIso = rawEnd;
  } else if (rawEnd?.dateTime) {
    endIso = rawEnd.dateTime;
  } else if (rawEnd?.date) {
    endIso = `${rawEnd.date}T00:00:00`;
  }

  return {
    id:          ev.id ?? Math.random().toString(36),
    title:       ev.summary ?? ev.title ?? '(No title)',
    start:       startIso,
    end:         endIso || startIso,
    allDay,
    description: ev.description || undefined,
    location:    ev.location   || undefined,
  };
}

function parseEventsFromText(text: string): GCalEvent[] {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as GCalEvent[];
    // Some MCP servers wrap in { events: [...] } or { items: [...] }
    if (parsed.events) return parsed.events as GCalEvent[];
    if (parsed.items)  return parsed.items  as GCalEvent[];
  } catch { /* fall through */ }

  // Try to extract a JSON array from mixed text
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]) as GCalEvent[];
    } catch { /* ignore */ }
  }

  return [];
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const now      = new Date();
  // Normalise whatever the client sends — strip ms+Z so it matches the MCP-required
  // format "2026-01-01T00:00:00" (ISO 8601 without fractional seconds or timezone suffix)
  const rawMin   = searchParams.get('timeMin')  ?? new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const rawMax   = searchParams.get('timeMax')  ?? new Date(now.getFullYear(), now.getMonth() + 4, 0).toISOString();
  const timeMin  = toMcpIso(new Date(rawMin));
  const timeMax  = toMcpIso(new Date(rawMax));
  const maxResults = parseInt(searchParams.get('maxResults') ?? '250', 10);

  try {
    const manager = McpServerManager.getInstance();
    await manager.initialize();

    const server = manager.getServer(GOOGLE_CALENDAR_SERVER_NAME);
    if (!server?.connected) {
      return NextResponse.json(
        { error: 'Google Calendar MCP not connected', events: [] },
        { status: 503 },
      );
    }

    // Discover which list-events tool this implementation uses
    const toolName = LIST_EVENT_TOOLS.find((name) =>
      server.tools.some((t) => t.name === name),
    );

    if (!toolName) {
      console.error(
        '[calendar-events] No list-events tool found. Available tools:',
        server.tools.map((t) => t.name),
      );
      return NextResponse.json(
        {
          error: `No list-events tool found. Available: ${server.tools.map((t) => t.name).join(', ')}`,
          events: [],
        },
        { status: 404 },
      );
    }

    // All calendars across all connected accounts (multi-account server).
    let calendars: { id: string; summary: string; backgroundColor?: string; primary?: boolean }[] = [];
    if (server.tools.some((t) => t.name === 'list-calendars')) {
      const calResult = await manager.callTool(GOOGLE_CALENDAR_SERVER_NAME, 'list-calendars', {});
      try {
        const parsed = JSON.parse(calResult.content.map((c) => c.text ?? '').join('\n'));
        const list = Array.isArray(parsed) ? parsed : parsed.calendars ?? [];
        calendars = list.map((c: { id?: string; summary?: string; backgroundColor?: string; primary?: boolean }) => ({
          id: String(c.id ?? c.summary ?? ''),
          summary: String(c.summary ?? c.id ?? ''),
          backgroundColor: c.backgroundColor,
          primary: Boolean(c.primary),
        }));
      } catch { /* fall back to primary below */ }
    }
    if (!calendars.length) {
      calendars = [{ id: 'primary', summary: 'Primary', primary: true }];
    }

    // Which calendars to fetch: the client's selection, or all of them.
    const requested = searchParams.get('calendarIds');
    const selected = requested
      ? calendars.filter((c) => requested.split(',').includes(c.id))
      : calendars;
    const fetchTargets = selected.length ? selected : calendars;

    const events: (ICalEvent & { calendarColor?: string; calendarSummary?: string })[] = [];
    const failed: string[] = [];

    for (const cal of fetchTargets) {
      const result = await manager.callTool(GOOGLE_CALENDAR_SERVER_NAME, toolName, {
        timeMin,
        timeMax,
        maxResults,
        calendarId: cal.id,
        singleEvents: true,
        orderBy: 'startTime',
      });

      if (result.isError) { failed.push(cal.summary); continue; }

      const rawText = result.content.map((c) => c.text ?? '').join('\n');
      const rawEvents = parseEventsFromText(rawText);
      for (const ev of rawEvents.map(normalizeEvent).filter((e) => e.start)) {
        events.push({
          ...ev,
          calendarColor: cal.backgroundColor,
          calendarSummary: cal.summary,
        });
      }
    }

    // Sort merged events chronologically so day-grouping reads naturally.
    events.sort((a, b) => a.start.localeCompare(b.start));

    return NextResponse.json({
      events,
      toolUsed: toolName,
      calendars,
      failedCalendars: failed,
    });
  } catch (err) {
    console.error('[calendar-events] Error:', err);
    return NextResponse.json(
      { error: String(err), events: [] },
      { status: 500 },
    );
  }
}
