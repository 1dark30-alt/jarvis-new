import { NextRequest, NextResponse } from 'next/server';

export interface ICalEvent {
  id: string;
  title: string;
  start: string;       // ISO string
  end: string;         // ISO string
  allDay: boolean;
  description?: string;
  location?: string;
}

// Parse a DTSTART/DTEND value into an ISO string
function parseICalDate(value: string, params: string): string {
  // All-day: VALUE=DATE → YYYYMMDD
  if (params.includes('VALUE=DATE') || /^\d{8}$/.test(value)) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }
  // UTC: ends with Z → YYYYMMDDTHHmmssZ
  if (value.endsWith('Z')) {
    const y  = value.slice(0, 4);
    const mo = value.slice(4, 6);
    const d  = value.slice(6, 8);
    const h  = value.slice(9, 11);
    const mi = value.slice(11, 13);
    const s  = value.slice(13, 15);
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
  }
  // Local with TZID — treat as-is converted to Date
  const y  = value.slice(0, 4);
  const mo = value.slice(4, 6);
  const d  = value.slice(6, 8);
  const h  = value.slice(9, 11);
  const mi = value.slice(11, 13);
  const s  = value.slice(13, 15);
  // Parse as local then return ISO
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).toISOString();
}

function unfoldLines(raw: string): string {
  // iCal line-folding: CRLF + whitespace = continuation
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseICalFeed(text: string): ICalEvent[] {
  const lines = unfoldLines(text).split(/\r?\n/);
  const events: ICalEvent[] = [];
  let inEvent = false;
  let current: Record<string, string> = {};
  let currentParams: Record<string, string> = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; current = {}; currentParams = {}; continue; }
    if (line === 'END:VEVENT') {
      inEvent = false;
      const start = current['DTSTART'] ? parseICalDate(current['DTSTART'], currentParams['DTSTART'] ?? '') : '';
      const end   = current['DTEND']   ? parseICalDate(current['DTEND'],   currentParams['DTEND']   ?? '') : start;
      const allDay = !!(currentParams['DTSTART']?.includes('VALUE=DATE') || /^\d{8}$/.test(current['DTSTART'] ?? ''));
      events.push({
        id:          current['UID'] ?? Math.random().toString(36),
        title:       current['SUMMARY'] ?? '(No title)',
        start,
        end,
        allDay,
        description: current['DESCRIPTION']?.replace(/\\n/g, '\n').replace(/\\,/g, ',') || undefined,
        location:    current['LOCATION']?.replace(/\\,/g, ',') || undefined,
      });
      continue;
    }
    if (!inEvent) continue;

    // Split property name+params from value
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const keyFull = line.slice(0, colonIdx);
    const value   = line.slice(colonIdx + 1);
    const semiIdx = keyFull.indexOf(';');
    const key     = semiIdx === -1 ? keyFull : keyFull.slice(0, semiIdx);
    const params  = semiIdx === -1 ? '' : keyFull.slice(semiIdx + 1);

    current[key]       = value;
    currentParams[key] = params;
  }

  return events;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing url param' }, { status: 400 });

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'JarvisClient/1.0' },
      next: { revalidate: 300 }, // cache 5 min
    });
    if (!res.ok) return NextResponse.json({ error: `Fetch failed: ${res.status}` }, { status: 502 });

    const text   = await res.text();
    const events = parseICalFeed(text);
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
