'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import worldMap from '@/elements/world_map.png';

interface IssData { latitude: number; longitude: number; altitude: number; velocity: number }

/** Synodic moon phase: 0 = new, 0.5 = full. Computed locally, no API. */
function moonPhase(date: Date): { fraction: number; label: string } {
  // Reference new moon: 2000-01-06 18:14 UTC
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const days = date.getTime() / 86400000 - ref;
  const phase = ((days % synodic) + synodic) % synodic / synodic;
  const labels = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  const label = labels[Math.floor(((phase + 1 / 16) % 1) * 8)];
  // Illuminated fraction
  const fraction = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  return { fraction, label };
}

/**
 * Orbital tracker: live ISS ground position on the world map
 * (wheretheiss.at — free, no key), plus sunrise/sunset from Open-Meteo and
 * a locally computed moon phase.
 */
export function OrbitWidget() {
  const [iss, setIss] = useState<IssData | null>(null);
  const [sun, setSun] = useState<{ sunrise: string; sunset: string } | null>(null);
  const [moon] = useState(() => moonPhase(new Date()));

  // ISS position every 10s
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
        const data = await res.json() as IssData;
        if (alive && typeof data.latitude === 'number') setIss(data);
      } catch { /* keep last */ }
    };
    void load();
    const interval = window.setInterval(load, 10_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);

  // Sunrise/sunset for user location via Open-Meteo (free, CORS-enabled)
  useEffect(() => {
    let alive = true;
    const fetchSun = async (lat: number, lon: number) => {
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto&forecast_days=1`);
        const data = await res.json() as { daily?: { sunrise?: string[]; sunset?: string[] } };
        const sr = data.daily?.sunrise?.[0];
        const ss = data.daily?.sunset?.[0];
        if (alive && sr && ss) {
          const t = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          setSun({ sunrise: t(sr), sunset: t(ss) });
        }
      } catch { /* leave empty */ }
    };
    navigator.geolocation?.getCurrentPosition(
      (p) => fetchSun(p.coords.latitude, p.coords.longitude),
      () => fetchSun(39.5, -98.35),
    );
    return () => { alive = false; };
  }, []);

  // Equirectangular projection onto the world map image
  const issLeft = iss ? ((iss.longitude + 180) / 360) * 100 : null;
  const issTop = iss ? ((90 - iss.latitude) / 180) * 100 : null;

  return (
    <div className="flex flex-col h-full gap-2">
      {/* ISS ground track */}
      <div className="relative flex-1 min-h-0 overflow-hidden border border-cyan-500/20 bg-cyan-950/20">
        <div className="absolute inset-0 opacity-40 mix-blend-screen">
          <Image src={worldMap} alt="World Map" fill className="object-cover" />
        </div>
        {issLeft !== null && issTop !== null && (
          <div className="absolute z-10" style={{ left: `${issLeft}%`, top: `${issTop}%`, transform: 'translate(-50%, -50%)' }}>
            <div className="relative">
              <div className="absolute -inset-1.5 rounded-full animate-ping" style={{ background: 'rgba(var(--accent-rgb, 34, 211, 238), 0.35)' }} />
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-hex, #22d3ee)', boxShadow: '0 0 10px var(--accent-hex, #22d3ee)' }} />
            </div>
          </div>
        )}
        <div className="absolute top-1 left-1.5 font-mono text-[8px] uppercase tracking-widest" style={{ color: 'var(--accent-hex, #22d3ee)' }}>
          ISS · ZARYA
        </div>
        {iss && (
          <div className="absolute bottom-1 left-1.5 font-mono text-[8px] text-white/50 bg-black/40 px-1 rounded">
            {iss.latitude.toFixed(1)}° {iss.longitude.toFixed(1)}° · {Math.round(iss.velocity).toLocaleString()} km/h
          </div>
        )}
      </div>

      {/* Sun + moon strip */}
      <div className="grid grid-cols-3 gap-1.5 shrink-0">
        <div className="flex flex-col items-center py-1 border border-white/5 rounded bg-white/[0.02]">
          <span className="font-mono text-[7px] uppercase tracking-widest text-white/30">Sunrise</span>
          <span className="font-mono text-[10px] text-amber-200/80">{sun?.sunrise ?? '—'}</span>
        </div>
        <div className="flex flex-col items-center py-1 border border-white/5 rounded bg-white/[0.02]">
          <span className="font-mono text-[7px] uppercase tracking-widest text-white/30">Sunset</span>
          <span className="font-mono text-[10px] text-orange-300/80">{sun?.sunset ?? '—'}</span>
        </div>
        <div className="flex flex-col items-center py-1 border border-white/5 rounded bg-white/[0.02]">
          <span className="font-mono text-[7px] uppercase tracking-widest text-white/30">Moon {Math.round(moon.fraction * 100)}%</span>
          <span className="font-mono text-[9px] text-white/60 truncate max-w-full px-1">{moon.label}</span>
        </div>
      </div>
    </div>
  );
}
