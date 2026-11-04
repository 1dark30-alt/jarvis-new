import { NextResponse } from 'next/server';
import { isTokenValid, getToken } from '@/app/lib/bambu/mqtt-manager';

const BAMBU_API = 'https://api.bambulab.com';

export async function GET() {
  if (!isTokenValid()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const token = getToken()!;
    const res = await fetch(`${BAMBU_API}/v1/user-service/my/tasks`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) return NextResponse.json({ error: `Bambu API ${res.status}` }, { status: res.status });
    const data = await res.json() as { hits?: unknown[]; total?: number };
    return NextResponse.json({ tasks: data.hits ?? [], total: data.total ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
