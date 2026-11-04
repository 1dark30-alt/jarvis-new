'use client';

import { useEffect, useState } from 'react';

interface Quote {
  symbol: string;
  price?: number;
  change?: number;
  changePct?: number;
  up?: boolean;
  sparkline?: number[];
  error?: string;
}

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * 60},${16 - ((v - min) / range) * 14}`)
    .join(' ');
  const color = up ? '#34d399' : '#f87171';
  return (
    <svg viewBox="0 0 60 18" width="60" height="18" className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" opacity="0.9" />
    </svg>
  );
}

/** Live quotes for a configurable symbol list (Yahoo Finance via the existing
 *  /api/stock-quote route — no API key required). */
export function StocksWidget({ config }: { config?: Record<string, unknown> }) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);

  const symbols = typeof config?.symbols === 'string' && config.symbols.trim()
    ? config.symbols
    : 'AAPL,TSLA,NVDA,MSFT,SPY';

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/stock-quote?symbols=${encodeURIComponent(symbols)}`);
        const data = await res.json() as { quotes?: Quote[] };
        if (alive && Array.isArray(data.quotes)) setQuotes(data.quotes);
      } catch { /* keep last data */ }
    };
    void load();
    const interval = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [symbols]);

  if (quotes === null) {
    return <div className="h-full flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {quotes.map((q) => (
        <div key={q.symbol} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
          <span className="font-mono text-[11px] font-bold text-white/80 w-12 shrink-0">{q.symbol}</span>
          {q.error ? (
            <span className="font-mono text-[9px] text-white/25 flex-1">unavailable</span>
          ) : (
            <>
              <Sparkline data={q.sparkline ?? []} up={!!q.up} />
              <span className="font-mono text-[11px] text-white/70 ml-auto">{q.price?.toFixed(2)}</span>
              <span
                className="font-mono text-[10px] w-14 text-right shrink-0"
                style={{ color: q.up ? '#34d399' : '#f87171' }}
              >
                {q.up ? '▲' : '▼'} {Math.abs(q.changePct ?? 0).toFixed(2)}%
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
