'use client';

import { useEffect, useState } from 'react';
import { getCachedSetting } from '../../../lib/serverSettings';

const ZOOM = 6;
const GRID = 3; // 3×3 tile grid

interface Frame { path: string; time: number }

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}

/**
 * Animated precipitation radar. Basemap tiles from CARTO (dark matter) with
 * RainViewer radar frames looping on top — both free, no API keys.
 */
export function WeatherRadarWidget() {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [error, setError] = useState('');

  // Resolve location: saved weather location → geolocation → continental US
  useEffect(() => {
    const savedLat = parseFloat(getCachedSetting('jarvis_weather_lat') || '');
    const savedLon = parseFloat(getCachedSetting('jarvis_weather_lon') || '');
    if (!isNaN(savedLat) && !isNaN(savedLon)) {
      // Deferred so React doesn't see a synchronous setState inside the effect
      const t = window.setTimeout(() => setCoords({ lat: savedLat, lon: savedLon }), 0);
      return () => window.clearTimeout(t);
    }
    const savedName = getCachedSetting('jarvis_weather_location');
    if (savedName) {
      fetch(`/api/geocode?q=${encodeURIComponent(savedName)}`)
        .then((r) => r.json())
        .then((d: { lat?: number; lon?: number }) => {
          if (d.lat && d.lon) setCoords({ lat: d.lat, lon: d.lon });
          else throw new Error('geocode failed');
        })
        .catch(() => {
          navigator.geolocation?.getCurrentPosition(
            (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
            () => setCoords({ lat: 39.5, lon: -98.35 }),
          );
        });
      return;
    }
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setCoords({ lat: 39.5, lon: -98.35 }),
    );
  }, []);

  // Fetch RainViewer frame list, refresh every 5 minutes
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json() as { radar?: { past?: Frame[] } };
        const past = data.radar?.past ?? [];
        if (alive && past.length > 0) setFrames(past.slice(-6));
        else if (alive && past.length === 0) setError('No radar data');
      } catch {
        if (alive) setError('Radar feed unreachable');
      }
    };
    void load();
    const interval = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);

  // Animate through frames
  useEffect(() => {
    if (frames.length < 2) return;
    const t = window.setInterval(() => setFrameIdx((i) => (i + 1) % frames.length), 700);
    return () => window.clearInterval(t);
  }, [frames.length]);

  if (error) {
    return <div className="h-full flex items-center justify-center"><p className="font-mono text-[10px] text-white/30 uppercase tracking-widest">{error}</p></div>;
  }
  if (!coords || frames.length === 0) {
    return <div className="h-full flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;
  }

  const cx = lonToTileX(coords.lon, ZOOM);
  const cy = latToTileY(coords.lat, ZOOM);
  const baseX = Math.floor(cx) - Math.floor(GRID / 2);
  const baseY = Math.floor(cy) - Math.floor(GRID / 2);
  // Marker position as % across the grid
  const markerLeft = ((cx - baseX) / GRID) * 100;
  const markerTop = ((cy - baseY) / GRID) * 100;
  const frame = frames[frameIdx];

  const tiles: { x: number; y: number }[] = [];
  for (let dy = 0; dy < GRID; dy++) {
    for (let dx = 0; dx < GRID; dx++) {
      tiles.push({ x: baseX + dx, y: baseY + dy });
    }
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      {/* Tile grid — base map + radar overlay per tile */}
      <div
        className="absolute inset-0 grid"
        style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)`, gridTemplateRows: `repeat(${GRID}, 1fr)` }}
      >
        {tiles.map(({ x, y }) => (
          <div key={`${x}-${y}`} className="relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://basemaps.cartocdn.com/dark_nolabels/${ZOOM}/${x}/${y}.png`}
              alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" draggable={false}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://tilecache.rainviewer.com${frame.path}/256/${ZOOM}/${x}/${y}/2/1_1.png`}
              alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false}
            />
          </div>
        ))}
      </div>

      {/* Location marker */}
      <div className="absolute z-10 pointer-events-none" style={{ left: `${markerLeft}%`, top: `${markerTop}%`, transform: 'translate(-50%, -50%)' }}>
        <div className="relative">
          <div className="absolute -inset-1 rounded-full animate-ping" style={{ background: 'rgba(var(--accent-rgb, 34, 211, 238), 0.4)' }} />
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-hex, #22d3ee)', boxShadow: '0 0 8px var(--accent-hex, #22d3ee)' }} />
        </div>
      </div>

      {/* Timestamp + scan overlay */}
      <div className="absolute bottom-1.5 left-2 z-10 font-mono text-[9px] text-white/60 bg-black/50 px-1.5 py-0.5 rounded backdrop-blur-[2px]">
        {new Date(frame.time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </div>
      <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1">
        {frames.map((_, i) => (
          <span key={i} className="w-1 h-1 rounded-full" style={{ background: i === frameIdx ? 'var(--accent-hex, #22d3ee)' : 'rgba(255,255,255,0.2)' }} />
        ))}
      </div>
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(6,182,212,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.06) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
    </div>
  );
}
