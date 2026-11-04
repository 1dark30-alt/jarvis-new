'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { notify, NOTIFY_EVENT, JarvisNotification } from '../lib/notify';
import { ensureTicker } from '../lib/timers';

const LEVEL_COLORS: Record<JarvisNotification['level'], { accent: string; glow: string }> = {
  info:    { accent: '#22d3ee', glow: 'rgba(34,211,238,0.35)' },
  success: { accent: '#34d399', glow: 'rgba(52,211,153,0.35)' },
  warn:    { accent: '#fbbf24', glow: 'rgba(251,191,36,0.35)' },
  error:   { accent: '#f87171', glow: 'rgba(248,113,113,0.35)' },
};

/**
 * HUD-styled toast queue anchored top-right. Fed by the jarvis:notify event
 * (see app/lib/notify.ts). Also boots the timer/reminder ticker so pending
 * countdowns survive a page reload.
 */
export function NotificationLayer() {
  const [items, setItems] = useState<JarvisNotification[]>([]);
  // null until the first status arrives, so we only toast on actual changes
  const touchConnectedRef = useRef<boolean | null>(null);

  // USB touch-screen plug/unplug toasts (Electron only)
  useEffect(() => {
    const el = window.electron;
    if (!el?.onTouchInputStatus) return;

    const report = (status: { connected: boolean; product?: string; permissionDenied?: boolean }) => {
      const prev = touchConnectedRef.current;
      touchConnectedRef.current = status.connected;
      if (status.permissionDenied) {
        notify(
          'Touch screen blocked',
          `${status.product ?? 'Touch panel'} detected, but macOS needs the Input Monitoring permission. Enable Jarvis in System Settings → Privacy & Security → Input Monitoring, then replug the panel.`,
          'warn',
          12000,
        );
        return;
      }
      if (status.connected && prev !== true) {
        notify('Touch screen connected', `${status.product ?? 'Touch panel'} is now controlling the interface.`, 'success');
      } else if (!status.connected && prev === true) {
        notify('Touch screen disconnected', `${status.product ?? 'Touch panel'} was unplugged.`, 'warn');
      }
    };

    const unsubscribe = el.onTouchInputStatus(report);
    // Panel may have connected before this page finished loading
    el.getTouchInputStatus?.().then((status) => {
      if (touchConnectedRef.current === null) report(status);
    }).catch(() => { /* not fatal */ });

    return unsubscribe;
  }, []);

  useEffect(() => {
    // Resume any timers/reminders that were pending before a reload
    ensureTicker();

    const handler = (e: Event) => {
      const n = (e as CustomEvent<JarvisNotification>).detail;
      if (!n?.id) return;
      setItems((prev) => [...prev.slice(-4), n]);
      if (n.duration > 0) {
        window.setTimeout(() => {
          setItems((prev) => prev.filter((x) => x.id !== n.id));
        }, n.duration);
      }
    };
    window.addEventListener(NOTIFY_EVENT, handler);
    return () => window.removeEventListener(NOTIFY_EVENT, handler);
  }, []);

  const dismiss = (id: string) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="fixed top-4 right-4 z-[80] flex flex-col gap-2 pointer-events-none items-end">
      <AnimatePresence>
        {items.map((n) => {
          const c = LEVEL_COLORS[n.level] ?? LEVEL_COLORS.info;
          return (
            <motion.button
              key={n.id}
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={() => dismiss(n.id)}
              className="pointer-events-auto text-left w-[300px] bg-black/85 backdrop-blur-md border overflow-hidden"
              style={{
                borderColor: `${c.accent}55`,
                boxShadow: `0 0 18px ${c.glow}`,
                clipPath: 'polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px))',
              }}
            >
              <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: `${c.accent}22`, background: `${c.accent}0d` }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: c.accent, boxShadow: `0 0 6px ${c.accent}` }} />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] truncate" style={{ color: c.accent }}>
                  {n.title}
                </span>
                <span className="ml-auto font-mono text-[9px] text-white/25 uppercase">
                  {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {n.message && (
                <p className="px-3 py-2 font-mono text-[11px] text-white/70 leading-snug">
                  {n.message}
                </p>
              )}
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
