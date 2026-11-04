'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface WeatherData {
  tempF: number;
  tempC: number;
  feelsLikeF: number;
  humidity: number;
  windMph: number;
  windDir: string;
  description: string;
  uvIndex: number;
}

export interface SidePanelData {
  label: string;
  fullAddress?: string;
  lat: number;
  lng: number;
}

interface Props {
  data: SidePanelData;
  onClose: () => void;
  onRouteHere: (dest: string) => void;
  onSearchNearby: (query: string) => void;
}

const WEATHER_ICONS: Record<number, string> = {
  113: '☀️', 116: '⛅', 119: '☁️', 122: '☁️', 143: '🌫️',
  176: '🌦️', 179: '🌨️', 182: '🌧️', 185: '🌧️', 200: '⛈️',
  227: '🌨️', 230: '❄️', 248: '🌫️', 260: '🌫️', 263: '🌦️',
  266: '🌦️', 281: '🌧️', 284: '🌧️', 293: '🌦️', 296: '🌦️',
  299: '🌧️', 302: '🌧️', 305: '🌧️', 308: '🌧️', 311: '🌧️',
  314: '🌧️', 317: '🌧️', 320: '❄️', 323: '🌨️', 326: '🌨️',
  329: '🌨️', 332: '❄️', 335: '❄️', 338: '❄️', 350: '🌧️',
  353: '🌦️', 356: '🌧️', 359: '🌧️', 362: '🌧️', 365: '🌧️',
  368: '🌨️', 371: '❄️', 374: '🌧️', 377: '🌧️', 386: '⛈️',
  389: '⛈️', 392: '⛈️', 395: '❄️',
};

export function MapSidePanel({ data, onClose, onRouteHere, onSearchNearby }: Props) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [routeQuery, setRouteQuery] = useState('');
  const [nearbyQuery, setNearbyQuery] = useState('');

  useEffect(() => {
    setWeather(null);
    setLoadingWeather(true);

    fetch(`/api/weather?lat=${data.lat}&lng=${data.lng}`)
      .then((r) => r.json())
      .then((d: WeatherData & { error?: string }) => {
        if (!d.error) setWeather(d);
      })
      .catch(() => {})
      .finally(() => setLoadingWeather(false));
  }, [data.lat, data.lng]);

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      className="absolute top-0 right-0 bottom-0 w-[300px] z-30 flex flex-col bg-black/80 backdrop-blur-md border-l border-cyan-500/20 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-cyan-500/10 shrink-0">
        <div className="flex-1 min-w-0 pr-2">
          <h2 className="text-[13px] font-mono font-bold text-white truncate leading-tight">
            {data.label}
          </h2>
          {data.fullAddress && (
            <p className="text-[10px] font-mono text-white/35 mt-1 leading-snug line-clamp-2">
              {data.fullAddress}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/70 transition-colors shrink-0 text-sm"
        >
          ✕
        </button>
      </div>

      {/* Coordinates */}
      <div className="flex gap-3 px-4 py-2.5 border-b border-white/[0.04] shrink-0">
        <div className="flex-1">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest">Lat</div>
          <div className="text-[11px] font-mono text-white/60 tabular-nums">{data.lat.toFixed(5)}</div>
        </div>
        <div className="flex-1">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest">Lng</div>
          <div className="text-[11px] font-mono text-white/60 tabular-nums">{data.lng.toFixed(5)}</div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* Weather */}
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest mb-2">
            Current Weather
          </div>
          {loadingWeather ? (
            <div className="text-[10px] font-mono text-white/20">Loading…</div>
          ) : weather ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl leading-none">
                  {WEATHER_ICONS[Math.round(weather.feelsLikeF)] ?? '🌡️'}
                </span>
                <div>
                  <div className="text-[18px] font-mono font-bold text-white leading-none">
                    {weather.tempF}°F
                    <span className="text-[11px] text-white/40 ml-1 font-normal">/ {weather.tempC}°C</span>
                  </div>
                  <div className="text-[10px] font-mono text-white/50 mt-0.5">{weather.description}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                {[
                  { label: 'Feels', value: `${weather.feelsLikeF}°F` },
                  { label: 'Humidity', value: `${weather.humidity}%` },
                  { label: 'Wind', value: `${weather.windMph} mph ${weather.windDir}` },
                  { label: 'UV', value: String(weather.uvIndex) },
                ].map((item) => (
                  <div key={item.label} className="bg-white/[0.03] rounded p-1.5 border border-white/[0.05]">
                    <div className="text-[8px] font-mono text-white/30 uppercase">{item.label}</div>
                    <div className="text-[10px] font-mono text-white/65 mt-0.5">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[10px] font-mono text-white/20">Unavailable</div>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest mb-2">
            Get Directions Here
          </div>
          <div className="flex gap-1.5">
            <input
              value={routeQuery}
              onChange={(e) => setRouteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && routeQuery.trim()) {
                  onRouteHere(routeQuery.trim());
                  setRouteQuery('');
                }
              }}
              placeholder="From where?"
              className="flex-1 bg-white/[0.04] border border-white/8 rounded px-2 py-1.5 text-[11px] text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
            />
            <button
              onClick={() => { if (routeQuery.trim()) { onRouteHere(routeQuery.trim()); setRouteQuery(''); } }}
              className="px-2.5 py-1.5 bg-cyan-500/15 border border-cyan-500/30 rounded text-cyan-400 text-[10px] font-mono hover:bg-cyan-500/25 transition-colors"
            >
              Go
            </button>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[8px] font-mono text-white/25 uppercase tracking-widest mb-2">
            Search Nearby
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {['Coffee', 'Restaurants', 'Gas', 'Hotels', 'Hospitals', 'Parking'].map((q) => (
              <button
                key={q}
                onClick={() => onSearchNearby(q)}
                className="px-2 py-1 text-[9px] font-mono text-white/40 border border-white/[0.07] rounded hover:text-cyan-400 hover:border-cyan-500/30 transition-colors uppercase tracking-wide"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={nearbyQuery}
              onChange={(e) => setNearbyQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nearbyQuery.trim()) {
                  onSearchNearby(nearbyQuery.trim());
                  setNearbyQuery('');
                }
              }}
              placeholder="Search nearby…"
              className="flex-1 bg-white/[0.04] border border-white/8 rounded px-2 py-1.5 text-[11px] text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
            />
            <button
              onClick={() => { if (nearbyQuery.trim()) { onSearchNearby(nearbyQuery.trim()); setNearbyQuery(''); } }}
              className="px-2.5 py-1.5 bg-white/[0.04] border border-white/8 rounded text-white/40 text-[10px] font-mono hover:text-cyan-400 hover:border-cyan-500/30 transition-colors"
            >
              →
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
