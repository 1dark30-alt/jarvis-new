/**
 * Unified notification bus. Anything in the app (timers, printers, voice
 * tools, HA automations…) can surface a HUD-styled toast by calling
 * notify() — the NotificationLayer component renders the queue.
 */

export type NotifyLevel = 'info' | 'success' | 'warn' | 'error';

export interface JarvisNotification {
  id: string;
  title: string;
  message?: string;
  level: NotifyLevel;
  /** Auto-dismiss after this many ms. 0 = sticky until clicked. */
  duration: number;
  createdAt: number;
}

export const NOTIFY_EVENT = 'jarvis:notify';

export function notify(
  title: string,
  message?: string,
  level: NotifyLevel = 'info',
  duration = 6000,
): void {
  if (typeof window === 'undefined') return;
  const detail: JarvisNotification = {
    id: `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    title,
    message,
    level,
    duration,
    createdAt: Date.now(),
  };
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail }));
}
