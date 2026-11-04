/**
 * Jarvis Error Bus
 *
 * Intercepts console.error, window.onerror, and unhandledrejection so every
 * real error from any source (OpenAI Realtime, ElevenLabs, function calls,
 * general app code) is captured in one place and streamed to subscribers.
 *
 * Entries are kept in a module-level array so they survive widget open/close.
 */

export type ErrorLevel = 'error' | 'warn';
export type ErrorSource = 'openai' | 'elevenlabs' | 'function' | 'app' | 'uncaught';

export interface ErrorEntry {
  id: string;
  timestamp: Date;
  level: ErrorLevel;
  source: ErrorSource;
  message: string;
}

const MAX_ENTRIES = 500;
const _entries: ErrorEntry[] = [];
const _listeners = new Set<(entry: ErrorEntry) => void>();

export function getEntries(): ErrorEntry[] {
  return [..._entries];
}

export function clearEntries(): void {
  _entries.length = 0;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('jarvis:error:clear'));
  }
}

/** Subscribe to new error entries. Returns an unsubscribe function. */
export function onError(cb: (entry: ErrorEntry) => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/** Emit a structured error entry to all listeners. */
export function emitError(
  source: ErrorSource,
  message: string,
  level: ErrorLevel = 'error',
): void {
  const entry: ErrorEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date(),
    level,
    source,
    message,
  };
  if (_entries.length >= MAX_ENTRIES) {
    _entries.splice(0, _entries.length - MAX_ENTRIES + 1);
  }
  _entries.push(entry);
  _listeners.forEach((cb) => cb(entry));
}

function detectSource(args: unknown[]): ErrorSource {
  const first = typeof args[0] === 'string' ? args[0].toLowerCase() : '';
  if (
    first.includes('openai') ||
    first.includes('realtime') ||
    first.includes('data channel') ||
    first.includes('audio play') ||
    first.includes('sdp') ||
    first.includes('webrtc')
  ) return 'openai';
  if (first.includes('elevenlabs')) return 'elevenlabs';
  if (
    first.includes('processing message') ||
    first.includes('function call') ||
    first.includes('tool call')
  ) return 'function';
  return 'app';
}

function argsToMessage(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) {
        return a.stack ? `${a.message}\n${a.stack}` : a.message;
      }
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

let _installed = false;

/**
 * Install global error interceptors. Safe to call multiple times — installs
 * only once. Call this from a top-level client component (e.g. JarvisAssistant).
 */
export function installErrorInterceptors(): void {
  if (typeof window === 'undefined' || _installed) return;
  _installed = true;

  // Patch console.error
  const origError = console.error.bind(console);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).error = (...args: unknown[]) => {
    origError(...args);
    emitError(detectSource(args), argsToMessage(args), 'error');
  };

  // Uncaught synchronous JS errors
  window.addEventListener('error', (e: ErrorEvent) => {
    const msg = e.error instanceof Error
      ? (e.error.stack ?? e.error.message)
      : e.message;
    emitError('uncaught', `${msg} (${e.filename}:${e.lineno}:${e.colno})`, 'error');
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const msg =
      e.reason instanceof Error
        ? (e.reason.stack ?? e.reason.message)
        : String(e.reason);
    emitError('uncaught', `Unhandled rejection: ${msg}`, 'error');
  });
}
