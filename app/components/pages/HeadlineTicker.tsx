'use client';

import { useEffect, useState } from 'react';

interface Headline {
  title: string;
  link: string;
}

export function HeadlineTicker() {
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchHeadlines() {
      try {
        const res = await fetch('/api/news-headlines');
        const data = (await res.json()) as { items?: Headline[]; error?: string };
        if (data.items && data.items.length > 0) {
          setHeadlines(data.items);
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchHeadlines();
    const interval = setInterval(fetchHeadlines, 60_000);
    return () => clearInterval(interval);
  }, []);

  const tickerItems: Headline[] =
    loading
      ? [{ title: 'Loading latest headlines…', link: '' }]
      : error
      ? [{ title: 'Unable to load headlines — check connection', link: '' }]
      : headlines;

  // Duplicate for seamless infinite loop
  const displayItems = [...tickerItems, ...tickerItems];

  const duration = `${Math.max(tickerItems.length * 6, 30)}s`;

  return (
    <div className="relative overflow-hidden bg-black/80 border-b border-cyan-500/20 h-9 flex items-center shrink-0">
      {/* Edge fade left */}
      <div className="absolute left-0 top-0 bottom-0 w-16 z-10 bg-gradient-to-r from-black to-transparent pointer-events-none" />
      {/* Edge fade right */}
      <div className="absolute right-0 top-0 bottom-0 w-16 z-10 bg-gradient-to-l from-black to-transparent pointer-events-none" />

      {/* BBC badge */}
      <div className="absolute left-3 z-20 flex items-center gap-1.5 pointer-events-none">
        <span className="text-[9px] font-mono font-bold text-cyan-400/60 uppercase tracking-widest bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
          LIVE
        </span>
      </div>

      <div
        className="flex whitespace-nowrap pl-24"
        style={{
          animation: `ticker-scroll ${duration} linear infinite`,
          willChange: 'transform',
        }}
      >
        {displayItems.map((item, i) => (
          <span
            key={i}
            className="flex items-center gap-3 pr-10 text-[11px] font-mono text-white/75 uppercase tracking-wide"
          >
            <span className="text-cyan-400/50 text-[8px] select-none">◆</span>
            {item.title}
          </span>
        ))}
      </div>
    </div>
  );
}
