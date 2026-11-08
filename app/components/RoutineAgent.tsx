'use client';

import { useEffect, useRef } from 'react';
import { notify } from '../lib/notify';

/**
 * RoutineAgent — the client side of the routine engine (Mark 58's
 * `core/routines/engine.py` host interface, adapted).
 *
 * Polls /api/routines on a steady heartbeat, reporting whether the assistant
 * is connected, whether it is already speaking, and how long the user has
 * been quiet. The engine answers with the routines that are due and
 * deliverable right now; this component speaks them via `jarvis:announce`
 * (the same channel the HUD uses) and raises a toast for each delivery.
 *
 * A fixed reminder ('say') is spoken as the user wrote it. An instruction
 * ('prompt') is fed to the assistant as a user message, so it carries the
 * instruction out with its tools when the moment comes.
 */

const POLL_MS = 20_000;
const BUSY_MS = 9_000; // assume the announcement occupies Jarvis this long

type Delivery = {
  id: string;
  name: string;
  kind: 'say' | 'prompt';
  text: string;
  deliver: 'voice' | 'panel' | 'silent';
};

export function RoutineAgent() {
  const connectedRef = useRef(false);
  const busyUntilRef = useRef(0);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const touch = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('pointermove', touch, { passive: true });
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch, { passive: true });
    window.addEventListener('jarvis:transcript', touch);
    return () => {
      window.removeEventListener('pointermove', touch);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      window.removeEventListener('jarvis:transcript', touch);
    };
  }, []);

  useEffect(() => {
    const onVoiceState = (e: Event) => {
      connectedRef.current = Boolean((e as CustomEvent<{ connected?: boolean }>).detail?.connected);
    };
    window.addEventListener('jarvis:voice-state', onVoiceState);

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const pollOnce = async () => {
      if (stopped) return;
      try {
        const res = await fetch('/api/routines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op: 'poll',
            ready: connectedRef.current,
            speaking: Date.now() < busyUntilRef.current,
            idleSeconds: Math.floor((Date.now() - lastActivityRef.current) / 1000),
          }),
        });
        const data = await res.json() as { deliveries?: Delivery[] };
        // Mission completions ride the same heartbeat — announced when the
        // assistant is actually connected, with a toast either way.
        if (connectedRef.current) {
          void fetch('/api/missions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op: 'poll', ready: true }),
          }).then(async (mres) => {
            const mdata = await mres.json() as { notices?: { id: string; kind: string; title: string; summary: string }[] };
            const notices = mdata.notices ?? [];
            if (!notices.length) return;
            for (const n of notices) {
              notify(
                n.kind === 'done' ? 'Mission complete' : 'Mission failed',
                `${n.title} — ${n.summary.slice(0, 180)}`, n.kind === 'done' ? 'success' : 'error', 15_000
              );
            }
            const done = notices.find((n) => n.kind === 'done');
            if (done) {
              busyUntilRef.current = Date.now() + BUSY_MS;
              window.dispatchEvent(new CustomEvent('jarvis:announce', {
                detail: { text: `The mission "${done.title}" is complete. Brief summary: ${done.summary.slice(0, 300)}` },
              }));
            }
            void fetch('/api/missions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ op: 'ack' }),
            });
          }).catch(() => {});
        }
        for (const d of data.deliveries ?? []) {
          if (d.deliver === 'silent') {
            void ack(d.id, true);
            continue;
          }
          notify(
            d.kind === 'prompt' ? 'Routine' : 'Reminder',
            d.text,
            'info',
            12_000
          );
          if (d.deliver === 'voice') {
            // Let the assistant speak it — same channel the HUD uses.
            busyUntilRef.current = Date.now() + BUSY_MS;
            window.dispatchEvent(new CustomEvent('jarvis:announce', { detail: { text: d.text } }));
            // Acknowledge after the assumed delivery window.
            setTimeout(() => { if (!stopped) void ack(d.id, true); }, BUSY_MS);
          } else {
            void ack(d.id, true);
          }
        }
      } catch {
        /* server unreachable — try again next tick */
      }
      if (!stopped) timer = setTimeout(pollOnce, POLL_MS);
    };

    const ack = async (id: string, ok: boolean) => {
      try {
        await fetch('/api/routines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: ok ? 'delivered' : 'failed', id }),
        });
      } catch { /* best effort */ }
    };

    // First poll after a short delay so the voice state event has landed.
    timer = setTimeout(pollOnce, 5_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('jarvis:voice-state', onVoiceState);
    };
  }, []);

  return null;
}