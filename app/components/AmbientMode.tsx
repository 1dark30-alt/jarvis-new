'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

function readAmbientConfig(): { autoMinutes: number } {
  try {
    const raw = localStorage.getItem('jarvis_settings');
    if (!raw) return { autoMinutes: 0 };
    const s = JSON.parse(raw) as { ambientAutoMinutes?: number };
    return { autoMinutes: s.ambientAutoMinutes ?? 0 };
  } catch {
    return { autoMinutes: 0 };
  }
}

/**
 * Screensaver-style standby view: dimmed screen, oversized clock inside a
 * slow-breathing reactor ring. Enters via the jarvis:ambient event (radial
 * nav, palette, voice) or automatically after the configured idle timeout.
 * Any input exits.
 */
export function AmbientMode() {
  const [active, setActive] = useState(false);
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    const enter = () => { setTime(new Date()); setActive(true); };
    const leave = () => setActive(false);
    window.addEventListener('jarvis:ambient', enter);
    window.addEventListener('jarvis:ambient-exit', leave);
    return () => {
      window.removeEventListener('jarvis:ambient', enter);
      window.removeEventListener('jarvis:ambient-exit', leave);
    };
  }, []);

  // Idle auto-entry
  useEffect(() => {
    let idleTimer: number | null = null;
    const arm = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      const { autoMinutes } = readAmbientConfig();
      if (!autoMinutes || autoMinutes <= 0) return;
      idleTimer = window.setTimeout(() => { setTime(new Date()); setActive(true); }, autoMinutes * 60_000);
    };
    const events: (keyof WindowEventMap)[] = ['pointermove', 'pointerdown', 'keydown', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, arm, { passive: true }));
    arm();
    return () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, arm));
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [active]);

  // Any interaction exits (registered only while active, on a delay so the
  // triggering click doesn't immediately dismiss it)
  useEffect(() => {
    if (!active) return;
    let armed = false;
    const armTimer = window.setTimeout(() => { armed = true; }, 400);
    const exit = () => { if (armed) setActive(false); };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'pointermove'];
    events.forEach((ev) => window.addEventListener(ev, exit, { passive: true }));
    return () => {
      window.clearTimeout(armTimer);
      events.forEach((ev) => window.removeEventListener(ev, exit));
    };
  }, [active]);

  const hours = time ? time.getHours().toString().padStart(2, '0') : '00';
  const minutes = time ? time.getMinutes().toString().padStart(2, '0') : '00';

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          transition={{ duration: 1.2 }}
          className="fixed inset-0 z-[85] bg-black flex items-center justify-center cursor-none"
        >
          {/* Breathing reactor ring */}
          <motion.svg
            viewBox="0 0 100 100"
            className="absolute w-[70vmin] h-[70vmin]"
            animate={{ opacity: [0.25, 0.5, 0.25], scale: [1, 1.02, 1] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <g style={{ transformOrigin: '50% 50%' }} className="animate-[spin_90s_linear_infinite]">
              {Array.from({ length: 60 }, (_, i) => (
                <rect key={i} x="49.75" y="4" width="0.5" height="2.5"
                  fill="var(--accent-hex, #22d3ee)" opacity="0.6"
                  transform={`rotate(${i * 6} 50 50)`} />
              ))}
            </g>
            <circle cx="50" cy="50" r="41" fill="none" stroke="var(--accent-hex, #22d3ee)" strokeOpacity="0.3" strokeWidth="0.25" />
          </motion.svg>

          <div className="relative flex flex-col items-center pointer-events-none">
            <div className="font-mono font-bold text-white tracking-wider" style={{ fontSize: 'min(18vw, 160px)', textShadow: '0 0 40px rgba(var(--accent-rgb, 34, 211, 238), 0.35)' }}>
              {hours}:{minutes}
            </div>
            <div className="font-mono text-[12px] uppercase tracking-[0.5em] text-white/30 mt-2">
              {time?.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.4em] mt-8" style={{ color: 'rgba(var(--accent-rgb, 34, 211, 238), 0.4)' }}>
              Standby — systems nominal
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
