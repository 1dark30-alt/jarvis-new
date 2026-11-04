import { NextResponse } from 'next/server';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Module-level session cache — lives for the lifetime of the Next.js server process
let yahooSession: { crumb: string; cookie: string; expiry: number } | null = null;

function extractCookies(response: Response): string {
  // Node 18+ Headers may expose getSetCookie() returning individual Set-Cookie strings
  const hdrs = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof hdrs.getSetCookie === 'function') {
    return hdrs
      .getSetCookie()
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }
  // Fallback: parse combined Set-Cookie header (multiple cookies separated by ", name=")
  const combined = response.headers.get('set-cookie') ?? '';
  return combined
    .split(/,\s*(?=[a-zA-Z0-9_\-]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function getYahooSession(): Promise<{ crumb: string; cookie: string } | null> {
  if (yahooSession && Date.now() < yahooSession.expiry) return yahooSession;

  try {
    // Step 1: visit Yahoo consent page to obtain session cookies
    const consentRes = await fetch('https://fc.yahoo.com/v1/test/acwf', {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
    });
    const cookie = extractCookies(consentRes);

    // Step 2: exchange session cookies for a crumb token
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: cookie },
    });
    const crumb = (await crumbRes.text()).trim();

    // Crumb should be a short alphanumeric token; reject HTML error pages
    if (!crumb || crumb.length > 30 || crumb.startsWith('<')) return null;

    yahooSession = { crumb, cookie, expiry: Date.now() + 50 * 60 * 1000 };
    return yahooSession;
  } catch {
    return null;
  }
}

function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr;
  const out: number[] = [];
  const step = arr.length / target;
  for (let i = 0; i < target; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseQuote(symbol: string, data: any) {
  const result = data?.chart?.result?.[0];
  if (!result?.meta) {
    return { symbol, error: data?.chart?.error?.description ?? 'No data' };
  }
  const meta = result.meta;
  const price: number = meta.regularMarketPrice ?? 0;
  const prevClose: number = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const change = price - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;

  const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const validCloses = rawCloses.filter((v): v is number => v !== null && !isNaN(v));
  const sparkline = downsample(validCloses, 32);

  return {
    symbol,
    price: parseFloat(price.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(2)),
    up: change >= 0,
    sparkline,
  };
}

async function fetchSymbol(
  symbol: string,
  crumbSuffix: string,
  cookieHeader: string
) {
  const opts = {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      ...(cookieHeader && { Cookie: cookieHeader }),
    },
  };
  const encoded = encodeURIComponent(symbol);
  const base = `?interval=5m&range=1d${crumbSuffix}`;

  let res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}${base}`,
    opts
  );
  if (!res.ok) {
    res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}${base}`,
      opts
    );
  }
  if (!res.ok) return { symbol, error: `HTTP ${res.status}` };
  return parseQuote(symbol, await res.json());
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get('symbols') ?? 'AAPL,TSLA,NVDA,MSFT,AMZN,META,GOOGL';

  const symbolList = symbols
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 14);

  const session = await getYahooSession();
  const crumbSuffix = session ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
  const cookieHeader = session?.cookie ?? '';

  try {
    const quotes = await Promise.all(
      symbolList.map((sym) => fetchSymbol(sym, crumbSuffix, cookieHeader))
    );
    return NextResponse.json({ quotes });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
