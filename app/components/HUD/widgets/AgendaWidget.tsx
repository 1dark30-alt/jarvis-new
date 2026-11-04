'use client';

import { useEffect, useState } from 'react';

interface AgendaItem {
  title: string;
  start: string;
  allDay: boolean;
  source: 'gcal' | 'local';
}

/** Next few days of calendar events — Google Calendar via MCP when connected,
 *  iCal feed fallback, plus local Jarvis tasks. */
export function AgendaWidget() {
  const [items, setItems] = useState<AgendaItem[] | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const collected: AgendaItem[] = [];

      // Local tasks for the next 5 days
      try {
        const store = JSON.parse(localStorage.getItem('jarvis_calendar_tasks') ?? '{}') as
          Record<string, { text: string; time?: string; done: boolean }[]>;
        for (let i = 0; i < 5; i++) {
          const d = new Date(); d.setDate(d.getDate() + i);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          for (const t of (store[key] ?? []).filter((t) => !t.done)) {
            collected.push({ title: t.text, start: `${key}T${t.time ?? '09:00'}`, allDay: !t.time, source: 'local' });
          }
        }
      } catch { /* ignore */ }

      // Google Calendar via MCP, fall back to iCal
      try {
        const statusRes = await fetch('/api/mcp/dynamic');
        const status = await statusRes.json() as { connected?: boolean };
        if (status.connected) {
          const now = new Date();
          const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          const timeMax = new Date(now.getTime() + 5 * 86400_000).toISOString();
          const res = await fetch(`/api/mcp/calendar-events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=20`);
          const data = await res.json() as { events?: { title: string; start: string; allDay: boolean }[] };
          if (res.ok && Array.isArray(data.events)) {
            collected.push(...data.events.map((e) => ({ ...e, source: 'gcal' as const })));
          }
        } else {
          const icalUrl = localStorage.getItem('jarvis_ical_url');
          if (icalUrl) {
            const res = await fetch(`/api/ical?url=${encodeURIComponent(icalUrl)}`);
            const data = await res.json() as { events?: { title: string; start: string; allDay: boolean }[] };
            collected.push(...(data.events ?? []).map((e) => ({ ...e, source: 'gcal' as const })));
          }
        }
      } catch { /* ignore */ }

      if (!alive) return;
      const now = Date.now();
      const upcoming = collected
        .filter((e) => {
          const t = new Date(e.start).getTime();
          return !isNaN(t) && t > now - 3600_000 && t < now + 5 * 86400_000;
        })
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
        .slice(0, 6);
      setItems(upcoming);
    };

    void load();
    const interval = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);

  if (items === null) {
    return <div className="flex-1 h-full flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;
  }

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1">
        <p className="font-mono text-[11px] text-white/40 uppercase tracking-widest">Schedule clear</p>
        <p className="font-mono text-[9px] text-white/20 uppercase tracking-widest">Next 5 days</p>
      </div>
    );
  }

  const fmt = (e: AgendaItem) => {
    const d = new Date(e.start);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const tomorrow = new Date(today.getTime() + 86400_000);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const day = isToday ? 'TODAY' : isTomorrow ? 'TMRW' : d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
    const time = e.allDay ? 'ALL DAY' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return { day, time };
  };

  return (
    <div className="flex flex-col gap-1.5 h-full">
      {items.map((e, i) => {
        const { day, time } = fmt(e);
        return (
          <div key={i} className="flex items-center gap-2.5 py-1 border-b border-white/5 last:border-0">
            <div className="flex flex-col items-center w-11 shrink-0">
              <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: 'var(--accent-hex, #22d3ee)' }}>{day}</span>
              <span className="font-mono text-[8px] text-white/35">{time}</span>
            </div>
            <div className="w-px h-6 shrink-0" style={{ background: 'rgba(var(--accent-rgb, 34, 211, 238), 0.3)' }} />
            <span className="font-mono text-[11px] text-white/75 truncate flex-1">{e.title}</span>
            {e.source === 'local' && (
              <span className="font-mono text-[7px] text-white/25 uppercase border border-white/10 rounded px-1 shrink-0">task</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
