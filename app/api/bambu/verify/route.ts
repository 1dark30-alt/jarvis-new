import { NextRequest, NextResponse } from 'next/server';
import { setToken, connectMqtt, type BambuToken } from '@/app/lib/bambu/mqtt-manager';

const BAMBU_API = 'https://api.bambulab.com';

export async function POST(req: NextRequest) {
  const { email, code } = await req.json() as { email?: string; code?: string };
  if (!email || !code) return NextResponse.json({ error: 'Email and code required' }, { status: 400 });

  try {
    const res = await fetch(`${BAMBU_API}/v1/user-service/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: email, code }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: txt }, { status: 401 });
    }

    const text = await res.text();
    let data: { accessToken?: string; refreshToken?: string; expiresIn?: number; success?: boolean } = {};
    try { data = JSON.parse(text); } catch { return NextResponse.json({ error: `Invalid response from Bambu: ${text}` }, { status: 500 }); }
    if (!data.accessToken) {
      return NextResponse.json({ error: 'No token returned', raw: data }, { status: 401 });
    }

    const token: BambuToken = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? '',
      tokenExpiration: Date.now() + (data.expiresIn ?? 86400) * 1000,
    };

    setToken(token);

    // Kick off MQTT connection (non-blocking)
    connectMqtt(token).catch((e) => console.error('[Bambu] MQTT connect error:', e));

    return NextResponse.json({ success: true, tokenExpiration: token.tokenExpiration });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
