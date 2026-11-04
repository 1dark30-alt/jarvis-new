import { NextRequest, NextResponse } from 'next/server';

// Proxy all Home Assistant REST API requests server-side to avoid CORS and
// to keep the long-lived access token out of client-side network logs.

function normalizeHaUrl(raw: string): string {
  const u = raw.trim().replace(/\/$/, '');
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return `http://${u}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const haUrl  = normalizeHaUrl(searchParams.get('url') ?? '');
  const token  = searchParams.get('token') ?? '';
  const path   = searchParams.get('path')  ?? '/api/states';

  if (!haUrl || !token) {
    return NextResponse.json({ error: 'url and token are required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${haUrl}${path}`, {
      // Forward the client's AbortSignal — if the phone disconnects mid-request
      // (iOS tab kill, navigation, etc.) the outgoing fetch is aborted immediately
      // rather than completing and then throwing ECONNRESET when writing to the
      // now-dead client socket.
      signal: req.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `HA returned ${res.status}: ${text}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ECONNRESET' || (err instanceof Error && err.name === 'AbortError')) {
      return new NextResponse(null, { status: 499 }); // client closed request
    }
    return NextResponse.json({ error: `Failed to reach Home Assistant: ${String(err)}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      url: string;
      token: string;
      domain: string;
      service: string;
      serviceData?: Record<string, unknown>;
    };

    const { url, token, domain, service, serviceData = {} } = body;

    if (!url || !token || !domain || !service) {
      return NextResponse.json({ error: 'url, token, domain, and service are required' }, { status: 400 });
    }

    const haUrl = normalizeHaUrl(url);
    const res = await fetch(`${haUrl}/api/services/${domain}/${service}`, {
      method: 'POST',
      signal: req.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(serviceData),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `HA returned ${res.status}: ${text}` }, { status: res.status });
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, result: data });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ECONNRESET' || (err instanceof Error && err.name === 'AbortError')) {
      return new NextResponse(null, { status: 499 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
