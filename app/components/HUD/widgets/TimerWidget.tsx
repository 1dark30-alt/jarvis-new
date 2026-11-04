'use client';

import { useEffect, useState } from 'react';
import { sfx } from '../../../lib/sfx';
import {
  addTimer, cancelTimer, getTimers, JarvisTimer, TIMERS_CHANGED,
  getReminders, cancelReminder, JarvisReminder,
} from '../../../lib/timers';

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function ProgressRing({ fraction }: { fraction: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" width="34" height="34" className="shrink-0 -rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
      <circle
        cx="18" cy="18" r={r} fill="none"
        stroke="var(--accent-hex, #22d3ee)" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - fraction)}
        style={{ filter: 'drop-shadow(0 0 3px var(--accent-hex, #22d3ee))', transition: 'stroke-dashoffset 0.5s linear' }}
      />
    </svg>
  );
}

/** Active countdowns + reminders with quick-start presets. Backed by the
 *  shared timer engine (app/lib/timers.ts) that the set_timer voice tool uses. */
export function TimerWidget() {
  const [timers, setTimers] = useState<JarvisTimer[]>([]);
  const [reminders, setReminders] = useState<JarvisReminder[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const reload = () => { setTimers(getTimers()); setReminders(getReminders()); setNow(Date.now()); };
    const boot = window.setTimeout(reload, 0);
    window.addEventListener(TIMERS_CHANGED, reload);
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => {
      window.clearTimeout(boot);
      window.removeEventListener(TIMERS_CHANGED, reload);
      window.clearInterval(tick);
    };
  }, []);

  const quickStart = (minutes: number) => {
    sfx('select', 0.5);
    addTimer(minutes * 60_000, `${minutes} MIN TIMER`);
  };

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Quick presets */}
      <div className="flex gap-1.5 shrink-0">
        {[1, 5, 10, 30].map((m) => (
          <button
            key={m}
            onClick={() => quickStart(m)}
            className="flex-1 py-1 rounded border font-mono text-[10px] uppercase tracking-wider transition-colors hover:bg-white/5"
            style={{ borderColor: 'rgba(var(--accent-rgb, 34, 211, 238), 0.3)', color: 'var(--accent-hex, #22d3ee)' }}
          >
            {m}m
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-0">
        {timers.length === 0 && reminders.length === 0 && (
          <p className="font-mono text-[10px] text-white/25 uppercase tracking-widest text-center mt-5">
            No active countdowns
          </p>
        )}

        {timers.map((t) => {
          // `now` is always set before any timer rows exist (boot reload)
          const remaining = t.endsAt - now;
          const fraction = t.durationMs > 0 ? Math.max(0, remaining / t.durationMs) : 0;
          return (
            <div key={t.id} className="flex items-center gap-2.5 group">
              <ProgressRing fraction={fraction} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-lg font-bold text-white leading-none">{fmt(remaining)}</div>
                <div className="font-mono text-[8px] text-white/35 uppercase tracking-widest truncate">{t.label}</div>
              </div>
              <button
                onClick={() => { sfx('app_close', 0.4); cancelTimer(t.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-400"
              >
                <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l6 6M8 2l-6 6" />
                </svg>
              </button>
            </div>
          );
        })}

        {reminders.map((r) => (
          <div key={r.id} className="flex items-center gap-2.5 group border-t border-white/5 pt-1.5 first:border-0 first:pt-0">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent-hex, #22d3ee)" strokeWidth="1.6" strokeLinecap="round" className="shrink-0">
              <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" /><path d="M10 20a2 2 0 0 0 4 0" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] text-white/75 truncate">{r.text}</div>
              <div className="font-mono text-[8px] text-white/35 uppercase tracking-widest">
                {new Date(r.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            <button
              onClick={() => { sfx('app_close', 0.4); cancelReminder(r.id); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-400"
            >
              <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l6 6M8 2l-6 6" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
