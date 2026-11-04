import { NextResponse } from 'next/server';
import net from 'net';

export const runtime = 'nodejs';

interface HostResult {
  target: string;
  up: boolean;
  latencyMs: number | null;
}

/** TCP-connect reachability probe for the Host Monitor HUD widget.
 *  GET /api/host-check?targets=1.1.1.1:53,github.com:443 */
function probe(host: string, port: number, timeoutMs = 3000): Promise<HostResult> {
  const target = `${host}:${port}`;
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (up: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ target, up, latencyMs: up ? Date.now() - started : null });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('targets') ?? '1.1.1.1:53,8.8.8.8:53,github.com:443';

  const targets = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => {
      const lastColon = t.lastIndexOf(':');
      if (lastColon === -1) return { host: t, port: 443 };
      const port = parseInt(t.slice(lastColon + 1), 10);
      return isNaN(port)
        ? { host: t, port: 443 }
        : { host: t.slice(0, lastColon), port };
    });

  try {
    const results = await Promise.all(targets.map(({ host, port }) => probe(host, port)));
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
