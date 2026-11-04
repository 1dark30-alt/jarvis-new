'use client';

import { useCallback, useEffect, useState } from 'react';
import { sfx } from '../../../lib/sfx';

interface Task { text: string; time?: string; done: boolean }
type TaskStore = Record<string, Task[]>;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadStore(): TaskStore {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem('jarvis_calendar_tasks') ?? '{}') as TaskStore;
  } catch {
    return {};
  }
}

/** Today's task list — shares the same jarvis_calendar_tasks store as the
 *  Calendar page and the calendar_command voice tool. */
export function TodoWidget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState('');

  const reload = useCallback(() => {
    setTasks(loadStore()[todayKey()] ?? []);
  }, []);

  useEffect(() => {
    const boot = window.setTimeout(reload, 0);
    // Calendar page + voice tool both dispatch jarvis:calendar on task changes
    const handler = () => window.setTimeout(reload, 500);
    window.addEventListener('jarvis:calendar', handler);
    const interval = window.setInterval(reload, 15_000);
    return () => {
      window.clearTimeout(boot);
      window.removeEventListener('jarvis:calendar', handler);
      window.clearInterval(interval);
    };
  }, [reload]);

  const persist = (next: Task[]) => {
    const store = loadStore();
    store[todayKey()] = next;
    localStorage.setItem('jarvis_calendar_tasks', JSON.stringify(store));
    setTasks(next);
  };

  const toggle = (i: number) => {
    sfx('click', 0.5);
    persist(tasks.map((t, idx) => idx === i ? { ...t, done: !t.done } : t));
  };

  const remove = (i: number) => {
    sfx('app_close', 0.4);
    persist(tasks.filter((_, idx) => idx !== i));
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    sfx('select', 0.5);
    persist([...tasks, { text, done: false }]);
    setDraft('');
  };

  const remaining = tasks.filter((t) => !t.done).length;

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-widest text-white/35">Today</span>
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--accent-hex, #22d3ee)' }}>
          {remaining} open
        </span>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
        {tasks.length === 0 && (
          <p className="font-mono text-[10px] text-white/25 uppercase tracking-widest text-center mt-6">No tasks logged</p>
        )}
        {tasks.map((t, i) => (
          <div key={i} className="flex items-center gap-2 group py-0.5">
            <button
              onClick={() => toggle(i)}
              className="w-3.5 h-3.5 shrink-0 rounded-sm flex items-center justify-center transition-all"
              style={{
                border: `1px solid ${t.done ? 'var(--accent-hex, #22d3ee)' : 'rgba(255,255,255,0.25)'}`,
                background: t.done ? 'rgba(var(--accent-rgb, 34, 211, 238), 0.25)' : 'transparent',
              }}
            >
              {t.done && (
                <svg viewBox="0 0 10 10" width="7" height="7" fill="none" stroke="var(--accent-hex, #22d3ee)" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M1.5 5.5 4 8l4.5-6" />
                </svg>
              )}
            </button>
            <span className={`font-mono text-[11px] flex-1 truncate ${t.done ? 'text-white/25 line-through' : 'text-white/75'}`}>
              {t.time && <span className="text-white/35 mr-1.5">{t.time}</span>}{t.text}
            </span>
            <button
              onClick={() => remove(i)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-400 shrink-0"
            >
              <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l6 6M8 2l-6 6" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 shrink-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="New task…"
          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 font-mono text-[11px] text-white/80 outline-none focus:border-cyan-500/50 placeholder:text-white/20"
        />
        <button
          onClick={add}
          className="px-2 rounded border font-mono text-[11px] transition-colors"
          style={{
            borderColor: 'rgba(var(--accent-rgb, 34, 211, 238), 0.4)',
            color: 'var(--accent-hex, #22d3ee)',
            background: 'rgba(var(--accent-rgb, 34, 211, 238), 0.08)',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
