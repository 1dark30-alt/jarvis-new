'use client';

import { useEffect, useState } from 'react';

interface IndexQuote {
  symbol: string;
  label: string;
  price?: number;
  changePct?: number;
  up?: boolean;
}

const INDICES = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'NASDAQ' },
  { symbol: '^DJI',  label: 'DOW' },
  { symbol: '^VIX',  label: 'VIX' },
  { symbol: 'BTC-USD', label: 'BTC' },
  { symbol: 'GC=F',  label: 'GOLD' },
  { symbol: 'CL=F',  label: 'OIL' },
];

export function MarketIndicesBar() {
  const [quotes, setQuotes] = useState<IndexQuote[]>([]);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const symbols = INDICES.map((i) => i.symbol).join(',');

    async function fetchIndices() {
      try {
        const res = await fetch(`/api/stock-quote?symbols=${encodeURIComponent(symbols)}`);
        const data = (await res.json()) as {
          quotes?: { symbol: string; price?: number; changePct?: number; up?: boolean }[];
        };
        if (data.quotes) {
          setQuotes(
            data.quotes.map((q) => ({
              ...q,
              label: INDICES.find((i) => i.symbol === q.symbol)?.label ?? q.symbol,
            }))
          );
        }
      } catch {
        // silent
      }
    }

    fetchIndices();
    const stockInterval = setInterval(fetchIndices, 60_000);

    function tick() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
      setDate(
        now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      );
    }
    tick();
    const clockInterval = setInterval(tick, 1000);

    return () => {
      clearInterval(stockInterval);
      clearInterval(clockInterval);
    };
  }, []);

  function formatIndexPrice(price: number, symbol: string): string {
    if (symbol === 'BTC-USD') {
      return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    }
    if (symbol === 'GC=F' || symbol === 'CL=F') {
      return `$${price.toFixed(2)}`;
    }
    if (price >= 10000) {
      return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return (
    <div className="flex items-center bg-black/60 border-b border-cyan-500/10 px-4 h-9 shrink-0 overflow-hidden gap-0">
      {quotes.map((q, i) => (
        <div key={q.symbol} className="flex items-center shrink-0">
          {i > 0 && <div className="w-px h-3 bg-white/8 mx-3" />}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-white/35 uppercase tracking-wider">
              {q.label}
            </span>
            {q.price !== undefined && (
              <span className="text-[10px] font-mono text-white/65 tabular-nums">
                {formatIndexPrice(q.price, q.symbol)}
              </span>
            )}
            {q.changePct !== undefined && (
              <span
                className={`text-[9px] font-mono font-semibold tabular-nums ${
                  q.up ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {q.up ? '▲' : '▼'}{Math.abs(q.changePct).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      ))}

      {/* Live clock pushed to the right */}
      <div className="ml-auto flex items-center gap-3 shrink-0">
        <div className="text-[9px] font-mono text-white/25 uppercase tracking-wider">{date}</div>
        <div className="text-[10px] font-mono text-white/40 tabular-nums">{time}</div>
      </div>
    </div>
  );
}
