import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Market Analyzer — port of Mark 58's `_market_engine.py` + `market_analyzer.py`.
 * Deterministic scenarios and risk calculations; NO order execution — the
 * same line the original draws. Data comes from Yahoo Finance's public chart
 * endpoint (the same source the original used).
 *
 * The position() math is the original's, line for line: risk-per-unit, size
 * from the risk budget, R-multiples, all fees/spread/slippage subtracted.
 */

const INTERVALS: Record<string, string> = {
  '1m': '5d', '2m': '5d', '5m': '5d', '15m': '1mo', '30m': '1mo', '1h': '1mo', '1d': '3mo',
};

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

function num(v: unknown): number | null {
  const f = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(f) ? f : null;
}

interface YahooChart {
  chart?: {
    result?: {
      meta?: { currency?: string; symbol?: string; regularMarketPrice?: number; previousClose?: number };
      timestamp?: number[];
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
    }[];
    error?: unknown;
  };
}

async function fetchChart(symbol: string, interval: string): Promise<{ candles: Candle[]; meta: YahooChart['chart']['result'][0]['meta'] }> {
  const range = INTERVALS[interval] ?? INTERVALS['1d'];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Yahoo returned HTTP ${res.status} for ${symbol}`);
  const data = (await res.json()) as YahooChart;
  const r = data.chart?.result?.[0];
  if (!r || !r.timestamp?.length) throw new Error(`No chart data for ${symbol}`);
  const q = r.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = num(q.open?.[i]); const h = num(q.high?.[i]); const l = num(q.low?.[i]); const c = num(q.close?.[i]);
    if (c === null) continue;
    candles.push({ t: r.timestamp[i] * 1000, o: o ?? c, h: h ?? c, l: l ?? c, c, v: num(q.volume?.[i]) ?? 0 });
  }
  if (!candles.length) throw new Error(`No usable candles for ${symbol}`);
  return { candles, meta: r.meta ?? {} };
}

/** The original's position() — deterministic sizing from the risk budget. */
function position(args: {
  entry: number; stop: number; target: number; balance?: number; riskPct?: number;
  side?: string; feeBps?: number; spread?: number; slippage?: number; multiplier?: number; fx?: number;
}) {
  const entry = num(args.entry); const stop = num(args.stop); const target = num(args.target);
  const balance = num(args.balance ?? 0) ?? 0;
  const riskPct = num(args.riskPct ?? 1) ?? 1;
  const side = (args.side ?? 'LONG').toUpperCase();
  const feeBps = num(args.feeBps ?? 0) ?? 0;
  const spread = num(args.spread ?? 0) ?? 0;
  const slippage = num(args.slippage ?? 0) ?? 0;
  const multiplier = num(args.multiplier ?? 1) ?? 1;
  const fx = num(args.fx ?? 1) ?? 1;

  if (entry === null || stop === null || target === null) throw new Error('Entry, stop and target must be finite numbers.');
  if (min(entry, stop, target, multiplier, 1) <= 0 || balance < 0 || riskPct <= 0 || riskPct > 100 || min(feeBps, spread, slippage) < 0) {
    throw new Error('Invalid prices, balance, risk or costs.');
  }
  if (side !== 'LONG' && side !== 'SHORT') throw new Error('Side must be LONG or SHORT.');

  const direction = side === 'LONG' ? 1 : -1;
  const risk = direction * (entry - stop);
  const reward = direction * (target - entry);
  if (risk <= 0) throw new Error(`Stop is on the wrong side for a ${side}.`);
  if (reward <= 0) throw new Error(`Target is on the wrong side for a ${side}.`);
  const rMultiple = reward / risk;
  const riskMoney = balance * (riskPct / 100);
  const riskPerUnit = Math.abs(risk) * multiplier * fx + (feeBps / 10000) * entry * multiplier * fx + (spread + slippage) * multiplier * fx;
  const size = riskPerUnit > 0 ? Math.floor(riskMoney / riskPerUnit) : 0;
  const cost = size * entry * multiplier * fx;
  const win = size * reward * multiplier * fx - size * (feeBps / 10000) * entry * multiplier * fx;
  const loss = -riskMoney;

  return {
    side, entry, stop, target,
    riskPerUnit: round2(riskPerUnit),
    positionSize: size,
    positionCost: round2(cost),
    riskBudget: round2(riskMoney),
    rMultiple: round2(rMultiple),
    ifTargetHit: round2(win),
    ifStopHit: round2(loss),
    breakevenMovePct: round2(((riskPerUnit / (size * multiplier * fx || 1)) / entry) * 100),
  };
}

function min(...xs: number[]): number { return Math.min(...xs); }
function round2(n: number): number { return Math.round(n * 100) / 100; }

function analyzeCandles(candles: Candle[]) {
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const first = closes[0];
  const sma = (n: number) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) returns.push(closes[i] / closes[i - 1] - 1);
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  // Annualise from the candle count per year implied by the interval spacing.
  const spanMs = candles[candles.length - 1].t - candles[0].t;
  const perCandleMs = spanMs / Math.max(1, candles.length - 1);
  const candlesPerYear = (365 * 24 * 3600 * 1000) / Math.max(60_000, perCandleMs);
  const volatility = Math.sqrt(variance) * Math.sqrt(candlesPerYear);
  return {
    last,
    changePct: first ? round2((last / first - 1) * 100) : null,
    high: round2(Math.max(...candles.map((c) => c.h))),
    low: round2(Math.min(...candles.map((c) => c.l))),
    sma20: sma(20) ? round2(sma(20)!) : null,
    sma50: sma(50) ? round2(sma(50)!) : null,
    volatilityPct: round2(volatility * 100),
    candles: candles.length,
  };
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? 'analyze').toLowerCase();
    const symbol = String(a.symbol ?? '').trim().toUpperCase();
    const interval = String(a.interval ?? '1d');

    switch (op) {
      case 'position': {
        try {
          const p = position({
            entry: num(a.entry)!, stop: num(a.stop)!, target: num(a.target)!,
            balance: num(a.balance ?? 0) ?? 0, riskPct: num(a.riskPct ?? 1) ?? 1,
            side: String(a.side ?? 'LONG'), feeBps: num(a.feeBps ?? 0) ?? 0,
            spread: num(a.spread ?? 0) ?? 0, slippage: num(a.slippage ?? 0) ?? 0,
            multiplier: num(a.multiplier ?? 1) ?? 1, fx: num(a.fx ?? 1) ?? 1,
          });
          return NextResponse.json({ ok: true, position: p });
        } catch (e) {
          return NextResponse.json({ error: String(e).replace('Error: ', '') }, { status: 400 });
        }
      }
      case 'quote':
      case 'analyze': {
        if (!symbol) return NextResponse.json({ error: 'Give a symbol, e.g. AAPL, BTC-USD, THYAO.IS.' }, { status: 400 });
        const { candles, meta } = await fetchChart(symbol, interval);
        const stats = analyzeCandles(candles);
        return NextResponse.json({
          ok: true, symbol, interval, currency: meta.currency ?? '',
          price: meta.regularMarketPrice ?? stats.last,
          ...stats,
          candles: candles.slice(-120).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
        });
      }
      default:
        return NextResponse.json({ error: `Unknown op: ${op}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 250) }, { status: 500 });
  }
}