'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ICalEvent } from '../../api/ical/route';
import { GoogleCalendarWizard } from '../wizards/GoogleCalendarWizard';
import type { GoogleServiceId } from '@/app/lib/google-services';
import { PageHeader } from '../PageHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  text: string;
  done: boolean;
  time?: string;
}

type TaskStore    = Record<string, Task[]>;
type GCalEvents   = Record<string, ICalEvent[]>; // keyed by YYYY-MM-DD

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function dateKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function todayKey() {
  const n = new Date();
  return dateKey(n.getFullYear(), n.getMonth(), n.getDate());
}
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstDayOfMonth(y: number, m: number) { return new Date(y, m, 1).getDay(); }

function loadTasks(): TaskStore {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem('jarvis_calendar_tasks') ?? '{}'); } catch { return {}; }
}
function saveTasks(s: TaskStore) { localStorage.setItem('jarvis_calendar_tasks', JSON.stringify(s)); }

function formatEventTime(ev: ICalEvent): string {
  if (ev.allDay) return 'All day';
  return new Date(ev.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function groupByDate(events: ICalEvent[]): GCalEvents {
  const store: GCalEvents = {};
  for (const ev of events) {
    const key = ev.start.slice(0, 10);
    if (!store[key]) store[key] = [];
    store[key].push(ev);
  }
  return store;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { onNavigateHome: () => void; }

export function CalendarPage({ onNavigateHome }: Props) {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedKey, setSelectedKey] = useState(todayKey());
  const [tasks,   setTasks]   = useState<TaskStore>(loadTasks);
  const [newTask, setNewTask] = useState('');
  const [newTime, setNewTime] = useState('');

  // Google Calendar events state
  const [gcalEvents, setGcalEvents] = useState<GCalEvents>({});
  const [gcalEventsLoading, setGcalEventsLoading] = useState(false);
  const [gcalEventsError, setGcalEventsError] = useState('');
  // Google Calendar MCP wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [gcalConfigured, setGcalConfigured] = useState(false);
  const [gcalTools, setGcalTools] = useState(0);

  // ── Fetch MCP events (Google Calendar via OAuth MCP server) ───────────────

  const fetchMcpEvents = useCallback(async () => {
    setGcalEventsLoading(true);
    setGcalEventsError('');
    try {
      // Fetch a wide window: 1 month back through 4 months forward
      const now     = new Date();
      const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const timeMax = new Date(now.getFullYear(), now.getMonth() + 4, 0, 23, 59, 59).toISOString();

      const res  = await fetch(`/api/mcp/calendar-events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
      const data = await res.json() as { events?: ICalEvent[]; error?: string };
      if (!res.ok || data.error) {
        setGcalEventsError(data.error ?? 'Could not load Google Calendar events.');
        return;
      }
      setGcalEvents(groupByDate(data.events ?? []));
    } catch {
      setGcalEventsError('Could not load Google Calendar events.');
    } finally {
      setGcalEventsLoading(false);
    }
  }, []);

  // Check if Google Calendar MCP is configured on mount
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await fetch('/api/mcp/dynamic');
        const data = await res.json();
        const connected = data.configured && data.connected;
        setGcalConfigured(connected);
        setGcalTools(data.tools ?? 0);
        // Auto-show wizard only if not configured AND user hasn't dismissed it
        if (!data.configured) {
          const skipped = localStorage.getItem('jarvis_gcal_wizard_skipped');
          if (!skipped) {
            setShowWizard(true);
          }
        }
        // If MCP is connected, fetch events from it right away
        if (connected) {
          fetchMcpEvents();
        }
      } catch {
        // API not available, don't show wizard
      }
    };
    checkConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWizardComplete = (connectedServices?: GoogleServiceId[]) => {
    setShowWizard(false);
    if (!connectedServices || connectedServices.includes('calendar')) {
      setGcalConfigured(true);
      fetchMcpEvents();
    }
  };

  const handleWizardSkip = () => {
    setShowWizard(false);
    localStorage.setItem('jarvis_gcal_wizard_skipped', 'true');
  };

  const handleWizardBack = () => {
    setShowWizard(false);
  };

  // ── Jarvis event handler ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const { type, date, text, time, taskId } = detail;

      if (type === 'add_task') {
        const key = date ?? todayKey();
        const task: Task = { id: Date.now().toString(), text: text ?? '', done: false, time: time ?? undefined };
        setTasks((prev) => { const next = { ...prev, [key]: [...(prev[key] ?? []), task] }; saveTasks(next); return next; });
        if (date) {
          const [y, m] = date.split('-').map(Number);
          setViewYear(y); setViewMonth(m - 1); setSelectedKey(date);
        }
      }
      if (type === 'complete_task') {
        const key = date ?? selectedKey;
        setTasks((prev) => {
          const next = { ...prev, [key]: (prev[key] ?? []).map((t) =>
            t.id === taskId || t.text.toLowerCase().includes((text ?? '').toLowerCase())
              ? { ...t, done: true } : t) };
          saveTasks(next); return next;
        });
      }
      if (type === 'clear_tasks') {
        const key = date ?? todayKey();
        setTasks((prev) => { const next = { ...prev, [key]: [] }; saveTasks(next); return next; });
      }
      if (type === 'go_to_date' && date) {
        const [y, m] = date.split('-').map(Number);
        setViewYear(y); setViewMonth(m - 1); setSelectedKey(date);
      }
      if (type === 'add_mcp_event' && detail.event) {
        // Optimistic insert — show the new GCal event immediately
        const ev = detail.event as ICalEvent;
        const key = ev.start.slice(0, 10);
        setGcalEvents((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ev] }));
      }
      if (type === 'remove_mcp_event') {
        // Optimistic filter — strip by ID or title immediately so the UI reacts at once
        const removedId   = detail.eventId as string | undefined;
        const removedText = ((detail.text as string | undefined) ?? '').toLowerCase();
        setGcalEvents((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            next[key] = next[key].filter((ev) => {
              if (removedId && ev.id === removedId) return false;
              if (removedText && ev.title.toLowerCase().includes(removedText)) return false;
              return true;
            });
          }
          return next;
        });
        // Re-fetch immediately — Google's API propagates deletes instantly so the
        // fresh list will not include the deleted event, making the removal permanent.
        fetchMcpEvents();
      }
      if (type === 'refresh_ical') {
        fetchMcpEvents();
      }
    };
    window.addEventListener('jarvis:calendar', handler);
    return () => window.removeEventListener('jarvis:calendar', handler);
  }, [selectedKey, gcalConfigured, fetchMcpEvents]);

  // ── Local task helpers ─────────────────────────────────────────────────────

  const [addingToGcal, setAddingToGcal] = useState(false);

  const addTask = useCallback(async () => {
    const text = newTask.trim(); if (!text) return;

    if (gcalConfigured) {
      // Add to Google Calendar via MCP
      setAddingToGcal(true);
      try {
        const res = await fetch('/api/mcp/create-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: text,
            date:    selectedKey,
            time:    newTime.trim() || undefined,
          }),
        });
        const data = await res.json() as { success?: boolean; error?: string; optimistic?: ICalEvent };
        if (res.ok && data.success) {
          setNewTask(''); setNewTime('');
          // Optimistic insert — show instantly
          if (data.optimistic) {
            const key = data.optimistic.start.slice(0, 10);
            setGcalEvents((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), data.optimistic!] }));
          }
          // Background refresh to replace optimistic with real GCal data
          setTimeout(() => fetchMcpEvents(), 4000);
          return;
        }
        // If MCP create fails, fall through to local
      } catch { /* fall through */ } finally {
        setAddingToGcal(false);
      }
    }

    // Local fallback
    const task: Task = { id: Date.now().toString(), text, done: false, time: newTime.trim() || undefined };
    setTasks((prev) => { const next = { ...prev, [selectedKey]: [...(prev[selectedKey] ?? []), task] }; saveTasks(next); return next; });
    setNewTask(''); setNewTime('');
  }, [newTask, newTime, selectedKey, gcalConfigured, fetchMcpEvents]);

  const toggleTask = useCallback((key: string, id: string) => {
    setTasks((prev) => {
      const next = { ...prev, [key]: (prev[key] ?? []).map((t) => t.id === id ? { ...t, done: !t.done } : t) };
      saveTasks(next); return next;
    });
  }, []);

  const deleteTask = useCallback((key: string, id: string) => {
    setTasks((prev) => { const next = { ...prev, [key]: (prev[key] ?? []).filter((t) => t.id !== id) }; saveTasks(next); return next; });
  }, []);

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  // ── Grid ───────────────────────────────────────────────────────────────────

  const totalDays = daysInMonth(viewYear, viewMonth);
  const startDay  = firstDayOfMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [...Array(startDay).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr          = todayKey();
  const selectedDayTasks  = tasks[selectedKey] ?? [];
  const selectedDayEvents = gcalEvents[selectedKey] ?? [];

  const selectedDate = new Date(
    parseInt(selectedKey.split('-')[0]),
    parseInt(selectedKey.split('-')[1]) - 1,
    parseInt(selectedKey.split('-')[2])
  );
  const selectedLabel = `${DAYS[selectedDate.getDay()]}, ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`;
  const totalItems    = selectedDayTasks.length + selectedDayEvents.length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence mode="wait">
      {showWizard ? (
        <GoogleCalendarWizard
          key="gcal-wizard"
          onComplete={handleWizardComplete}
          onSkip={handleWizardSkip}
          onBack={handleWizardBack}
        />
      ) : (
        <motion.div
          key="calendar-page"
          className="fixed inset-0 bg-[#050810] z-[50] overflow-hidden flex flex-col"
          initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
          animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
          exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
          transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
        >
      {/* HUD corners */}
      {['top-0 left-0 border-t-2 border-l-2','top-0 right-0 border-t-2 border-r-2',
        'bottom-0 left-0 border-b-2 border-l-2','bottom-0 right-0 border-b-2 border-r-2'].map((cls,i) => (
        <div key={i} className={`absolute w-8 h-8 ${cls} border-cyan-500/20 pointer-events-none z-10 m-3`} />
      ))}

      <PageHeader
        title="Calendar"
        onNavigateHome={onNavigateHome}
        right={
          <>
            {gcalEventsLoading && <span className="text-[9px] font-mono text-white/20 animate-pulse">Syncing…</span>}
            {gcalEventsError   && <span className="text-[9px] font-mono text-red-400/60">{gcalEventsError}</span>}
            <button
              onClick={() => setShowWizard(true)}
              className={`flex items-center gap-1.5 px-3 h-7 rounded-lg border text-[9px] font-mono uppercase tracking-wider transition-all
                ${gcalConfigured
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/30 hover:text-white/50 hover:border-white/15'}`}
            >
              <div className={`w-1 h-1 rounded-full ${gcalConfigured ? 'bg-emerald-400' : 'bg-white/20'}`} />
              {gcalConfigured ? 'Google Services' : 'Connect Google'}
            </button>
          </>
        }
      />

      {/* Body */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left: Calendar grid ───────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 p-8 border-r border-white/[0.06]">

          <div className="flex items-center justify-between mb-5">
            <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/[0.08] text-white/30 hover:text-cyan-400 hover:border-cyan-500/30 transition-all text-sm font-mono">‹</button>
            <div className="text-center">
              <div className="text-white font-mono font-semibold text-lg tracking-wide">{MONTHS[viewMonth]}</div>
              <div className="text-white/30 font-mono text-[11px] mt-0.5">{viewYear}</div>
            </div>
            <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/[0.08] text-white/30 hover:text-cyan-400 hover:border-cyan-500/30 transition-all text-sm font-mono">›</button>
          </div>

          <div className="grid grid-cols-7 border-b border-white/[0.08]">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-mono text-white/30 uppercase tracking-widest py-2">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 flex-1 border-l border-t border-white/[0.08]">
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`} className="border-r border-b border-white/[0.08] bg-white/[0.01]" />;
              const key     = dateKey(viewYear, viewMonth, day);
              const isToday = key === todayStr;
              const isSel   = key === selectedKey;
              const localCnt = (tasks[key] ?? []).filter(t => !t.done).length;
              const gcalCnt  = (gcalEvents[key] ?? []).length;

              return (
                <button
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={`relative flex flex-col items-start justify-start p-2 border-r border-b border-white/[0.08] font-mono transition-all min-h-[72px]
                    ${isSel ? 'bg-cyan-500/[0.15]' : isToday ? 'bg-cyan-500/[0.07] hover:bg-cyan-500/[0.13]' : 'hover:bg-white/[0.04]'}`}
                >
                  <span className={`text-xl leading-none mb-1 ${isSel ? 'text-cyan-300 font-bold' : isToday ? 'text-cyan-400 font-bold' : 'text-white/60'}`}>
                    {day}
                  </span>
                  {isToday && !isSel && <div className="w-4 h-[2px] rounded-full bg-cyan-500/60 mb-1" />}
                  <div className="flex gap-0.5 flex-wrap">
                    {Array.from({ length: Math.min(localCnt, 3) }).map((_, j) => (
                      <div key={`l${j}`} className="w-1.5 h-1.5 rounded-full bg-purple-400/60" />
                    ))}
                    {Array.from({ length: Math.min(gcalCnt, 3) }).map((_, j) => (
                      <div key={`g${j}`} className="w-1.5 h-1.5 rounded-full bg-blue-400/70" />
                    ))}
                  </div>
                  {isSel && <div className="absolute inset-0 border-2 border-cyan-500/50 pointer-events-none" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-5 mt-4 pt-4 border-t border-white/[0.04]">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded border border-cyan-500/30 bg-cyan-500/10" />
              <span className="text-[9px] font-mono text-white/20 uppercase tracking-wider">Today</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400/60" />
              <span className="text-[9px] font-mono text-white/20 uppercase tracking-wider">Local tasks</span>
            </div>
            {gcalConfigured && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400/70" />
                <span className="text-[9px] font-mono text-white/20 uppercase tracking-wider">
                  {`Google MCP (${gcalTools} tools)`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Schedule ────────────────────────────────────────────── */}
        <div className="flex flex-col w-[420px] shrink-0 p-8">

          <div className="mb-5">
            <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1">Schedule</div>
            <div className="text-white font-mono text-lg font-semibold">{selectedLabel}</div>
            <div className="text-white/25 text-[10px] font-mono mt-0.5">
              {totalItems === 0 ? 'Nothing scheduled' : `${totalItems} item${totalItems !== 1 ? 's' : ''}`}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 scrollbar-hide">
            <AnimatePresence initial={false}>

              {/* Google Calendar events */}
              {selectedDayEvents.map((ev) => (
                <motion.div
                  key={ev.id}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-start gap-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.06]"
                >
                  <div className="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-blue-400/70" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] font-mono text-blue-400/60 mb-0.5">
                      {formatEventTime(ev)}{ev.location ? ` · ${ev.location}` : ''} · Google
                    </div>
                    <div className="text-[12px] font-mono text-white/75 leading-snug">{ev.title}</div>
                    {ev.description && (
                      <div className="text-[10px] font-mono text-white/30 mt-0.5 line-clamp-2">{ev.description}</div>
                    )}
                  </div>
                </motion.div>
              ))}

              {/* Local tasks */}
              {selectedDayTasks.length === 0 && selectedDayEvents.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center h-32 text-white/15 font-mono text-[11px] uppercase tracking-widest"
                >
                  <div className="text-2xl mb-2 opacity-30">◎</div>
                  Nothing scheduled
                </motion.div>
              ) : (
                selectedDayTasks.map((task) => (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.18 }}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-all group
                      ${task.done ? 'bg-white/[0.02] border-white/[0.04] opacity-50' : 'bg-purple-500/[0.05] border-purple-500/[0.15] hover:border-purple-500/30'}`}
                  >
                    <button
                      onClick={() => toggleTask(selectedKey, task.id)}
                      className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-all
                        ${task.done ? 'bg-purple-500/30 border-purple-500/50 text-purple-400' : 'border-white/20 hover:border-purple-500/50'}`}
                    >
                      {task.done && <span className="text-[8px]">✓</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      {task.time && <div className="text-[9px] font-mono text-purple-400/60 mb-0.5">{task.time}</div>}
                      <div className={`text-[12px] font-mono leading-snug ${task.done ? 'line-through text-white/30' : 'text-white/70'}`}>
                        {task.text}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteTask(selectedKey, task.id)}
                      className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400/70 transition-all text-xs mt-0.5 shrink-0"
                    >✕</button>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>

          {/* Add task / event */}
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            {gcalConfigured && (
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-1 h-1 rounded-full bg-blue-400/60" />
                <span className="text-[8px] font-mono text-blue-400/50 uppercase tracking-widest">
                  Adding to Google Calendar
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <input type="text" value={newTime} onChange={(e) => setNewTime(e.target.value)} placeholder="Time"
                className="w-20 h-9 px-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[11px] text-white font-mono placeholder:text-white/15 focus:outline-none focus:border-cyan-500/40 transition-colors" />
              <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTask()} placeholder={gcalConfigured ? 'Add to Google Calendar…' : 'Add a task…'}
                className="flex-1 h-9 px-3 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[12px] text-white font-mono placeholder:text-white/15 focus:outline-none focus:border-cyan-500/40 transition-colors" />
              <button onClick={addTask} disabled={!newTask.trim() || addingToGcal}
                className="h-9 px-3 bg-cyan-500/15 border border-cyan-500/30 rounded-lg text-cyan-400 text-[11px] font-mono hover:bg-cyan-500/25 transition-colors disabled:opacity-30">
                {addingToGcal ? '…' : '+'}
              </button>
            </div>
          </div>
        </div>
      </div>


    </motion.div>
      )}
    </AnimatePresence>
  );
}
