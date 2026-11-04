import { NextRequest, NextResponse } from 'next/server';

const BAMBU_API = 'https://api.bambulab.com';

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return { _raw: text }; }
}

export async function POST(req: NextRequest) {
  const { email } = await req.json() as { email?: string };
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

  try {
    // Skip the login probe entirely — just go straight to sending the email code.
    // Bambu's email-code flow doesn't require a prior login probe.
    const codeRes = await fetch(`${BAMBU_API}/v1/user-service/user/sendemail/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, type: 'codeLogin' }),
    });
    const codeText = await codeRes.text();
    console.log('[Bambu send-code] status:', codeRes.status, 'body:', codeText);

    if (codeRes.ok) {
      return NextResponse.json({ status: 'code_sent' });
    }

    // If direct code send failed, try the login probe first
    const authRes = await fetch(`${BAMBU_API}/v1/user-service/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: email, password: '', apiError: '' }),
    });
    const authData = await safeJson(authRes);
    console.log('[Bambu login probe] status:', authRes.status, 'body:', JSON.stringify(authData));

    if (authData.loginType === 'verifyCode') {
      const codeRes2 = await fetch(`${BAMBU_API}/v1/user-service/user/sendemail/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, type: 'codeLogin' }),
      });
      const codeText2 = await codeRes2.text();
      if (!codeRes2.ok) return NextResponse.json({ error: `Failed to send code: ${codeText2}` }, { status: 500 });
      return NextResponse.json({ status: 'code_sent' });
    }

    if (authData.success && authData.accessToken) {
      return NextResponse.json({ status: 'authenticated', token: authData });
    }

    return NextResponse.json(
      { error: `Bambu code request failed (${codeRes.status}): ${codeText}` },
      { status: 403 }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
