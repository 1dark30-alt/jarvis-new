import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ error: 'Missing query' }, { status: 400 });

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'JarvisClient/1.0 (personal desktop assistant)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return NextResponse.json({ error: `Nominatim HTTP ${res.status}` }, { status: 502 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
