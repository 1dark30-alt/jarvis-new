'use client';

import { useEffect, useState } from 'react';

interface Headline { title: string; link: string }

/** Rotating world-news headlines from the existing /api/news-headlines
 *  route (BBC RSS — free, no key). */
export function HeadlinesWidget() {
  const [items, setItems] = useState<Headline[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/news-headlines');
        const data = await res.json() as { items?: Headline[] };
        if (alive && Array.isArray(data.items)) setItems(data.items.slice(0, 12));
      } catch { /* keep last */ }
    };
    void load();
    const interval = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % items.length), 8000);
    return () => window.clearInterval(t);
  }, [items]);

  if (items === null) {
    return <div className="h-full flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;
  }
  if (items.length === 0) {
    return <div className="h-full flex items-center justify-center"><p className="font-mono text-[10px] text-white/25 uppercase">Feed unavailable</p></div>;
  }

  const current = items[index];
  const nextThree = [1, 2, 3].map((o) => items[(index + o) % items.length]);

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Featured headline */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('jarvis:navigate', { detail: { page: 'news' } }))}
        className="text-left group"
      >
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--accent-hex, #22d3ee)' }} />
          <span className="font-mono text-[8px] uppercase tracking-[0.3em]" style={{ color: 'var(--accent-hex, #22d3ee)' }}>
            Live · {index + 1}/{items.length}
          </span>
        </div>
        <p className="font-mono text-[12px] text-white/85 leading-snug group-hover:text-cyan-300 transition-colors line-clamp-3">
          {current.title}
        </p>
      </button>

      {/* Upcoming */}
      <div className="mt-auto flex flex-col gap-1 border-t border-white/5 pt-1.5">
        {nextThree.map((h, i) => (
          <p key={i} className="font-mono text-[9px] text-white/30 truncate">· {h.title}</p>
        ))}
      </div>
    </div>
  );
}
