'use client';

import { useEffect, useRef, useState } from 'react';

interface Line {
  role: 'user' | 'jarvis';
  text: string;
  at: number;
}

// Module-level buffer so the log survives the widget being closed/reopened
const buffer: Line[] = [];

/** Live conversation log. JarvisAssistant dispatches jarvis:transcript events
 *  for both the user's speech and Jarvis's replies. */
export function TranscriptWidget() {
  const [lines, setLines] = useState<Line[]>([...buffer]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ role?: string; text?: string }>).detail;
      if (!detail?.text?.trim()) return;
      const line: Line = {
        role: detail.role === 'user' ? 'user' : 'jarvis',
        text: detail.text.trim(),
        at: Date.now(),
      };
      buffer.push(line);
      if (buffer.length > 80) buffer.splice(0, buffer.length - 80);
      setLines([...buffer]);
    };
    window.addEventListener('jarvis:transcript', handler);
    return () => window.removeEventListener('jarvis:transcript', handler);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto flex flex-col gap-2 pr-1">
      {lines.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest">Awaiting comms</p>
          <p className="font-mono text-[8px] text-white/15 uppercase tracking-widest">Conversation will appear here</p>
        </div>
      )}
      {lines.map((l, i) => (
        <div key={`${l.at}-${i}`} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span
              className="font-mono text-[8px] font-bold uppercase tracking-[0.25em]"
              style={{ color: l.role === 'jarvis' ? 'var(--accent-hex, #22d3ee)' : 'rgba(255,255,255,0.45)' }}
            >
              {l.role === 'jarvis' ? 'Jarvis' : 'You'}
            </span>
            <span className="font-mono text-[7px] text-white/20">
              {new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <p className={`font-mono text-[11px] leading-snug ${l.role === 'jarvis' ? 'text-white/80' : 'text-white/50'}`}>
            {l.text}
          </p>
        </div>
      ))}
    </div>
  );
}
