'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ErrorEntry,
  ErrorSource,
  clearEntries,
  getEntries,
  onError,
} from '../../../lib/errorBus';

const SOURCE_LABELS: Record<ErrorSource, string> = {
  openai:    'OPENAI  ',
  elevenlabs:'ELEVENLABS',
  function:  'FUNCTION',
  app:       'APP     ',
  uncaught:  'UNCAUGHT',
};

const SOURCE_COLORS: Record<ErrorSource, string> = {
  openai:    'text-cyan-400',
  elevenlabs:'text-purple-400',
  function:  'text-amber-400',
  app:       'text-slate-400',
  uncaught:  'text-red-400',
};

function Timestamp({ date }: { date: Date }) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return (
    <span className="text-white/30 select-none shrink-0">
      {h}:{m}:{s}.{ms}
    </span>
  );
}

function EntryRow({ entry }: { entry: ErrorEntry }) {
  const lines = entry.message.split('\n');
  return (
    <div className="flex gap-2 font-mono text-[11px] leading-[1.55] py-[2px] border-b border-white/5 last:border-0">
      <Timestamp date={entry.timestamp} />
      <span className={`shrink-0 ${SOURCE_COLORS[entry.source]}`}>
        [{SOURCE_LABELS[entry.source]}]
      </span>
      <span className="text-white/80 break-all whitespace-pre-wrap min-w-0">
        {lines.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {line}
          </span>
        ))}
      </span>
    </div>
  );
}

export function TerminalWidget() {
  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Load existing entries on mount
  useEffect(() => {
    setEntries(getEntries());
  }, []);

  // Subscribe to new errors
  useEffect(() => {
    const unsub = onError((entry) => {
      setEntries((prev) => [...prev, entry]);
    });

    const onClear = () => setEntries([]);
    window.addEventListener('jarvis:error:clear', onClear);

    return () => {
      unsub();
      window.removeEventListener('jarvis:error:clear', onClear);
    };
  }, []);

  // Auto-scroll to bottom when new entries arrive, unless paused
  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, paused]);

  function handleCopy() {
    const text = entries
      .map((e) => {
        const h = e.timestamp.getHours().toString().padStart(2, '0');
        const m = e.timestamp.getMinutes().toString().padStart(2, '0');
        const s = e.timestamp.getSeconds().toString().padStart(2, '0');
        return `${h}:${m}:${s} [${SOURCE_LABELS[e.source].trim()}] ${e.message}`;
      })
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleClear() {
    clearEntries();
  }

  return (
    <div className="flex flex-col h-full text-white select-text">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-cyan-500/20 bg-black/40 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-white/40 tracking-widest">
            {entries.length} ENTRIES
          </span>
          {/* Legend */}
          <div className="flex items-center gap-2">
            {(Object.keys(SOURCE_LABELS) as ErrorSource[]).map((src) => (
              <span key={src} className={`text-[9px] font-mono ${SOURCE_COLORS[src]}`}>
                {src.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            title={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
            className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
              paused
                ? 'border-amber-500/60 text-amber-400 bg-amber-900/20'
                : 'border-white/10 text-white/40 hover:text-white/70 hover:border-white/30'
            }`}
          >
            {paused ? 'PAUSED' : 'PAUSE'}
          </button>
          <button
            onClick={handleCopy}
            title="Copy all to clipboard"
            className="text-[10px] font-mono px-2 py-0.5 rounded border border-white/10 text-white/40 hover:text-cyan-300 hover:border-cyan-500/50 transition-colors"
          >
            {copied ? 'COPIED!' : 'COPY'}
          </button>
          <button
            onClick={handleClear}
            title="Clear terminal"
            className="text-[10px] font-mono px-2 py-0.5 rounded border border-white/10 text-white/40 hover:text-red-400 hover:border-red-500/50 transition-colors"
          >
            CLR
          </button>
        </div>
      </div>

      {/* Log area */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 bg-black/60 font-mono scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
        onClick={(e) => e.stopPropagation()}
        onWheel={() => setPaused(true)}
      >
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span className="text-[11px] tracking-widest">NO ERRORS — ALL SYSTEMS NOMINAL</span>
          </div>
        ) : (
          <>
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}
