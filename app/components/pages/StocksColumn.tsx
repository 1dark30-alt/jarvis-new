'use client';

import { useEffect, useState } from 'react';

interface StockQuote {
  symbol: string;
  price?: number;
  change?: number;
  changePct?: number;
  up?: boolean;
  sparkline?: number[];
  error?: string;
}

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <div className="w-[80px] h-7" />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const W = 80;
  const H = 28;
  const pad = 2;

  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - pad - ((v - min) / range) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const lastX = W;
  const lastY = H - pad - ((data[data.length - 1] - min) / range) * (H - pad * 2);
  const color = up ? '#4ade80' : '#f87171';

  // Fill area under the line
  const firstPt = `0,${(H - pad - ((data[0] - min) / range) * (H - pad * 2)).toFixed(1)}`;
  const fillPts = `${firstPt} ${pts} ${W},${H} 0,${H}`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polygon
        points={fillPts}
        fill={color}
        opacity={0.08}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

function formatPrice(price: number, symbol: string): string {
  if (symbol.includes('^') || price >= 10000) {
    return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return price.toFixed(2);
}

interface Props {
  symbols: string;
}

export function StocksColumn({ symbols }: Props) {
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchQuotes() {
      try {
        const res = await fetch(`/api/stock-quote?symbols=${encodeURIComponent(symbols)}`);
        const data = (await res.json()) as { quotes?: StockQuote[] };
        if (data.quotes) {
          setQuotes(data.quotes);
          setLastUpdated(new Date());
        }
      } catch {
        // keep stale data
      } finally {
        setLoading(false);
      }
    }

    fetchQuotes();
    const interval = setInterval(fetchQuotes, 30_000);
    return () => clearInterval(interval);
  }, [symbols]);

  if (loading && quotes.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-[10px] font-mono text-white/20 uppercase tracking-widest">
        Loading market data…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {quotes.map((q) => (
        <div
          key={q.symbol}
          className={`rounded border transition-colors overflow-hidden ${
            q.error
              ? 'border-white/5 bg-white/[0.01]'
              : q.up
              ? 'border-green-500/10 bg-green-500/[0.02]'
              : 'border-red-500/10 bg-red-500/[0.02]'
          }`}
        >
          <div className="flex items-start justify-between px-2.5 pt-2 pb-1">
            {/* Left: symbol + price */}
            <div>
              <div className="text-[11px] font-mono font-bold text-white/90 tracking-wider leading-none">
                {q.symbol.replace('^', '')}
              </div>
              {q.price !== undefined && (
                <div className="text-[14px] font-mono font-semibold text-white tabular-nums mt-0.5 leading-none">
                  ${formatPrice(q.price, q.symbol)}
                </div>
              )}
            </div>

            {/* Right: change */}
            {q.error ? (
              <span className="text-[9px] font-mono text-white/20 mt-0.5">unavailable</span>
            ) : (
              <div className={`text-right tabular-nums mt-0.5 ${q.up ? 'text-green-400' : 'text-red-400'}`}>
                <div className="text-[12px] font-mono font-bold leading-none">
                  {q.up ? '+' : ''}{q.changePct?.toFixed(2)}%
                </div>
                <div className="text-[10px] font-mono opacity-60 mt-0.5">
                  {q.up ? '+' : ''}{q.change?.toFixed(2)}
                </div>
              </div>
            )}
          </div>

          {/* Sparkline */}
          {!q.error && q.sparkline && q.sparkline.length > 1 && (
            <div className="px-1.5 pb-1.5">
              <Sparkline data={q.sparkline} up={q.up ?? true} />
            </div>
          )}
        </div>
      ))}

      {lastUpdated && (
        <div className="text-[9px] font-mono text-white/15 text-center py-1.5 uppercase tracking-widest">
          ↻ {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  );
}
