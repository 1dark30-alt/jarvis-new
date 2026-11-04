import { NextRequest, NextResponse } from 'next/server';
import { isTokenValid, getToken, getPrinters, fetchPrintersRest, connectMqtt } from '@/app/lib/bambu/mqtt-manager';

export async function GET(req: NextRequest) {
  // Allow passing token via header for first-load scenarios
  const headerToken = req.headers.get('x-bambu-token');

  if (headerToken) {
    const tokenObj = {
      accessToken: headerToken,
      refreshToken: '',
      tokenExpiration: Date.now() + 3600_000,
    };
    try {
      const printers = await fetchPrintersRest(tokenObj);
      connectMqtt(tokenObj).catch(() => {});
      return NextResponse.json(printers);
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  if (!isTokenValid()) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Return cached list first; if empty, re-fetch
  let printers = getPrinters();
  if (!printers.length) {
    const token = getToken()!;
    try {
      printers = await fetchPrintersRest(token);
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  return NextResponse.json(printers);
}
