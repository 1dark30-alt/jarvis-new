'use client';

/**
 * Client-side timer + reminder engine.
 *
 * Timers   — countdowns ("10 minute timer"). Survive reloads via localStorage.
 * Reminders — fire at an absolute time ("remind me at 3pm"). Also persisted.
 *
 * A single global ticker checks both once a second and fires a jarvis:notify
 * toast + notification SFX when something is due. Components subscribe via
 * the TIMERS_CHANGED event to re-render.
 */

import { notify } from './notify';
import { sfx } from './sfx';

export interface JarvisTimer {
  id: string;
  label: string;
  /** Epoch ms when the timer completes */
  endsAt: number;
  /** Original duration, for the progress ring */
  durationMs: number;
}

export interface JarvisReminder {
  id: string;
  text: string;
  /** Epoch ms when the reminder fires */
  at: number;
}

export const TIMERS_CHANGED = 'jarvis:timers-changed';

const TIMERS_KEY = 'jarvis_timers';
const REMINDERS_KEY = 'jarvis_reminders';

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full / private mode — non-critical */ }
}

function emitChanged(): void {
  window.dispatchEvent(new CustomEvent(TIMERS_CHANGED));
}

export function getTimers(): JarvisTimer[] {
  return loadJSON<JarvisTimer[]>(TIMERS_KEY, []);
}

export function getReminders(): JarvisReminder[] {
  return loadJSON<JarvisReminder[]>(REMINDERS_KEY, []);
}

export function addTimer(durationMs: number, label = 'TIMER'): JarvisTimer {
  const timer: JarvisTimer = {
    id: `t-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
    label,
    endsAt: Date.now() + durationMs,
    durationMs,
  };
  saveJSON(TIMERS_KEY, [...getTimers(), timer]);
  ensureTicker();
  emitChanged();
  return timer;
}

export function cancelTimer(idOrLabel: string): boolean {
  const timers = getTimers();
  const q = idOrLabel.toLowerCase();
  const remaining = timers.filter(
    (t) => t.id !== idOrLabel && !t.label.toLowerCase().includes(q),
  );
  if (remaining.length === timers.length) return false;
  saveJSON(TIMERS_KEY, remaining);
  emitChanged();
  return true;
}

export function addReminder(at: number, text: string): JarvisReminder {
  const reminder: JarvisReminder = {
    id: `r-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
    text,
    at,
  };
  saveJSON(REMINDERS_KEY, [...getReminders(), reminder]);
  ensureTicker();
  emitChanged();
  return reminder;
}

export function cancelReminder(idOrText: string): boolean {
  const reminders = getReminders();
  const q = idOrText.toLowerCase();
  const remaining = reminders.filter(
    (r) => r.id !== idOrText && !r.text.toLowerCase().includes(q),
  );
  if (remaining.length === reminders.length) return false;
  saveJSON(REMINDERS_KEY, remaining);
  emitChanged();
  return true;
}

// ── Global ticker ────────────────────────────────────────────────────────────

let tickerId: number | null = null;

function tick(): void {
  const now = Date.now();

  const timers = getTimers();
  const dueTimers = timers.filter((t) => t.endsAt <= now);
  if (dueTimers.length > 0) {
    saveJSON(TIMERS_KEY, timers.filter((t) => t.endsAt > now));
    for (const t of dueTimers) {
      sfx('notification', 0.8);
      notify(t.label === 'TIMER' ? 'TIMER COMPLETE' : t.label.toUpperCase(), 'Countdown finished.', 'warn', 0);
    }
    emitChanged();
  }

  const reminders = getReminders();
  const dueReminders = reminders.filter((r) => r.at <= now);
  if (dueReminders.length > 0) {
    saveJSON(REMINDERS_KEY, reminders.filter((r) => r.at > now));
    for (const r of dueReminders) {
      sfx('notification', 0.8);
      notify('REMINDER', r.text, 'warn', 0);
    }
    emitChanged();
  }

  if (getTimers().length === 0 && getReminders().length === 0 && tickerId !== null) {
    window.clearInterval(tickerId);
    tickerId = null;
  }
}

export function ensureTicker(): void {
  if (typeof window === 'undefined' || tickerId !== null) return;
  if (getTimers().length === 0 && getReminders().length === 0) return;
  tickerId = window.setInterval(tick, 1000);
}
