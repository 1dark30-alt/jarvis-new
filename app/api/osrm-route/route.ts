import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slng = searchParams.get('slng');
  const slat = searchParams.get('slat');
  const elng = searchParams.get('elng');
  const elat = searchParams.get('elat');

  if (!slng || !slat || !elng || !elat) {
    return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 });
  }

  try {
    // OSRM public demo server — free, no API key required
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${slng},${slat};${elng},${elat}` +
      `?overview=full&geometries=geojson&steps=false`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'JarvisClient/1.0' },
    });
    if (!res.ok) return NextResponse.json({ error: `OSRM HTTP ${res.status}` }, { status: 502 });
    const data = await res.json();

    if (data.code !== 'Ok') {
      return NextResponse.json({ error: data.message ?? 'Route not found' }, { status: 404 });
    }

    const route = data.routes?.[0];
    return NextResponse.json({
      geometry: route?.geometry,           // GeoJSON LineString
      distanceM: route?.distance,          // metres
      durationS: route?.duration,          // seconds
      distanceMi: route ? (route.distance / 1609.34).toFixed(1) : null,
      durationMin: route ? Math.round(route.duration / 60) : null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
