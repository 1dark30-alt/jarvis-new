'use client';
import { useState, useEffect } from 'react';
import { getCachedSetting } from '../../../lib/serverSettings';

interface WeatherData {
  temp: number; condition: string; icon: string;
  city: string; wind: number; hi: number; lo: number;
}

export function WeatherHomeWidget() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = getCachedSetting('jarvis_weather_location') || (typeof window !== 'undefined' ? localStorage.getItem('jarvis_weather_location') : null);

    const fetchByCoords = async (lat: number, lon: number) => {
      try {
        const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
        if (res.ok) setData(await res.json());
        else setError('Could not load weather');
      } catch { setError('Weather unavailable'); }
    };

    if (stored) {
      fetch(`/api/geocode?q=${encodeURIComponent(stored)}`)
        .then((r) => r.json())
        .then((d: { lat?: number; lon?: number }) => {
          if (d.lat && d.lon) fetchByCoords(d.lat, d.lon);
          else navigator.geolocation?.getCurrentPosition((p) => fetchByCoords(p.coords.latitude, p.coords.longitude));
        })
        .catch(() => navigator.geolocation?.getCurrentPosition((p) => fetchByCoords(p.coords.latitude, p.coords.longitude)));
    } else {
      navigator.geolocation?.getCurrentPosition(
        (p) => fetchByCoords(p.coords.latitude, p.coords.longitude),
        () => setError('Location not available'),
      );
    }
  }, []);

  if (error) return <div className="flex-1 flex items-center justify-center"><p className="font-mono text-[10px] text-white/25">{error}</p></div>;
  if (!data)  return <div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;

  return (
    <div className="flex items-center gap-4 px-1">
      <img src={data.icon} alt={data.condition} className="w-14 h-14 object-contain shrink-0"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      <div className="flex-1">
        <div className="font-mono text-3xl font-bold text-white leading-none">{Math.round(data.temp)}°</div>
        <div className="font-mono text-xs text-white/70 mt-0.5">{data.condition}</div>
        <div className="font-mono text-[10px] text-white/40 mt-0.5">{data.city}</div>
        <div className="flex gap-3 mt-1.5">
          <span className="font-mono text-[10px] text-white/50">💨 {data.wind} mph</span>
          <span className="font-mono text-[10px] text-white/50">H {Math.round(data.hi)}°</span>
          <span className="font-mono text-[10px] text-white/50">L {Math.round(data.lo)}°</span>
        </div>
      </div>
    </div>
  );
}
