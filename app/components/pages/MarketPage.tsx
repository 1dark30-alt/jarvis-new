'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Market — live-ish Yahoo Finance data drawn as candles, with the
 * deterministic engine's stats underneath (SMA, volatility, range).
 * Analysis and position sizing run through the market_analyzer tool.
 */

interface Candle { t: number; o: number; h: number; l: number; c: number }

interface MarketData {
  ok?: boolean;
  symbol?: string;
  interval?: string;
  currency?: string;
  price?: number;
  changePct?: number | null;
  high?: number;
  low?: number;
  sma20?: number | null;
  sma50?: number | null;
  volatilityPct?: number;
  candles?: Candle[];
  error?: string;
}

const INTERVALS = ['5m', '15m', '1h', '1d'] as const;

export function MarketPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [symbol, setSymbol] = useState('AAPL');
  const [input, setInput] = useState('AAPL');
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]>('1d');
  const [data, setData] = useState<MarketData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (sym: string, ivl: string) => {
    setBusy(true);
    try {
      const d = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'analyze', symbol: sym, interval: ivl }),
      }).then((r) => r.json()) as MarketData;
      setData({ ...d, symbol: d.symbol ?? sym, interval: d.interval ?? ivl });
    } catch { setData({ ok: false, symbol: sym, interval: ivl, currency: '', error: 'Could not reach the market service.' }); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(symbol, interval); }, [symbol, interval, load]);

  const candles = data?.candles ?? [];
  const W = 1000, H = 320, PAD = 8;
  const highs = candles.map((c) => c.h), lows = candles.map((c) => c.l);
  const max = highs.length ? Math.max(...highs) : 1;
  const min = lows.length ? Math.min(...lows) : 0;
  const span = max - min || 1;
  const cw = candles.length ? (W - PAD * 2) / candles.length : 0;
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);

  const up = candles.filter((c) => c.c >= c.o).length >= candles.length / 2;

  return (
    <motion.div
      key="market-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Market"
        onNavigateHome={onNavigateHome}
        accent="green"
        right={<span className="font-mono text-[9px] uppercase tracking-widest text-white/30">Yahoo Finance · analysis only, no orders</span>}
      />

      <div className="px-6 py-3 flex items-center gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setSymbol(input.trim().toUpperCase()); }}
          placeholder="Symbol (AAPL, BTC-USD, THYAO.IS…)"
          className="px-3 py-1.5 rounded bg-white/[0.04] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-cyan-500/40 w-64 font-mono"
        />
        <button
          onClick={() => setSymbol(input.trim().toUpperCase())}
          className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-cyan-300 hover:border-cyan-500/30"
        >
          Load
        </button>
        {INTERVALS.map((ivl) => (
          <button
            key={ivl}
            onClick={() => setInterval_(ivl)}
            className={`px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-widest border transition-all ${
              interval === ivl ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'bg-white/[0.04] border-white/[0.08] text-white/45 hover:text-cyan-300'
            }`}
          >
            {ivl}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 px-6 pb-4 overflow-y-auto">
        {busy && <p className="text-cyan-400/70 font-mono text-xs animate-pulse">Loading {symbol}…</p>}
        {!busy && data?.error && <p className="text-red-300 text-sm">{data.error}</p>}
        {!busy && data?.candles && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mb-2">
              <span className="font-mono text-lg text-white">{data.symbol}</span>
              <span className="font-mono text-xl text-cyan-300">{data.price} {data.currency}</span>
              {data.changePct !== null && data.changePct !== undefined && (
                <span className={`font-mono text-sm ${(data.changePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(data.changePct ?? 0) >= 0 ? '▲' : '▼'} {data.changePct}%
                </span>
              )}
              <span className="font-mono text-[10px] text-white/35">
                H {data.high} · L {data.low} · SMA20 {data.sma20 ?? '—'} · SMA50 {data.sma50 ?? '—'} · vol {data.volatilityPct}%
              </span>
            </div>

            <div className="rounded-lg p-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 320 }}>
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="rgba(255,255,255,0.06)" />
                ))}
                {candles.map((c, i) => {
                  const x = PAD + i * cw + cw / 2;
                  const green = c.c >= c.o;
                  const color = green ? '#34d399' : '#f87171';
                  const top = y(Math.max(c.o, c.c));
                  const bot = y(Math.min(c.o, c.c));
                  return (
                    <g key={i}>
                      <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
                      <rect
                        x={x - Math.max(1, cw * 0.32)} width={Math.max(2, cw * 0.64)}
                        y={top} height={Math.max(1, bot - top)} fill={green ? 'rgba(52,211,153,0.75)' : 'rgba(248,113,113,0.75)'} stroke={color}
                      />
                    </g>
                  );
                })}
                {data.sma50 && candles.length >= 50 && (
                  <polyline
                    fill="none" stroke="rgba(250,204,21,0.55)" strokeWidth={1.4}
                    points={candles.slice(-50).map((c, i) => `${PAD + (candles.length - 50 + i) * cw + cw / 2},${y(c.c)}`).join(' ')}
                  />
                )}
              </svg>
              <div className="flex justify-between font-mono text-[9px] text-white/25 px-1">
                <span>{new Date(candles[0].t).toLocaleString([], { month: 'short', day: 'numeric', hour: candles[0].t % 86400000 !== 0 ? '2-digit' : undefined, minute: candles[0].t % 86400000 !== 0 ? '2-digit' : undefined })}</span>
                <span className={up ? 'text-emerald-500/50' : 'text-red-500/50'}>{data.interval} candles · {candles.length}</span>
                <span>{new Date(candles[candles.length - 1].t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}