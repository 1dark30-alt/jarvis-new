'use client';

import { useEffect, useState } from 'react';

interface Headline {
  title: string;
}

export function TopStories() {
  const [stories, setStories] = useState<Headline[]>([]);

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch('/api/news-headlines');
        const data = (await res.json()) as { items?: Headline[] };
        if (data.items?.length) setStories(data.items.slice(0, 10));
      } catch {
        // silent
      }
    }
    fetch_();
    const iv = setInterval(fetch_, 120_000);
    return () => clearInterval(iv);
  }, []);

  if (stories.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[10px] font-mono text-white/20 uppercase tracking-widest">
        Loading…
      </div>
    );
  }

  // Duplicate list for seamless vertical loop
  const items = [...stories, ...stories];
  const duration = `${stories.length * 4}s`;

  return (
    <div className="relative overflow-hidden h-full">
      {/* Top fade */}
      <div className="absolute top-0 left-0 right-0 h-5 bg-gradient-to-b from-black/80 to-transparent z-10 pointer-events-none" />
      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-5 bg-gradient-to-t from-black/80 to-transparent z-10 pointer-events-none" />

      <div
        style={{ animation: `scroll-up ${duration} linear infinite`, willChange: 'transform' }}
      >
        {items.map((s, i) => (
          <div
            key={i}
            className="flex items-start gap-2 py-2.5 border-b border-white/[0.05] last:border-0"
          >
            <span className="text-[8px] text-cyan-400/40 mt-0.5 shrink-0 select-none">◆</span>
            <p className="text-[11px] font-mono text-white/60 leading-snug">
              {s.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
