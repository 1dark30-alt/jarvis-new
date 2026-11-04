'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HomeAssistantWizard } from '../wizards/HomeAssistantWizard';
import { loadServerSettings } from '../../lib/serverSettings';
import { PageHeader } from '../PageHeader';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface HAEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    device_class?: string;
    brightness?: number;
    current_temperature?: number;
    temperature?: number;
    unit_of_measurement?: string;
    media_title?: string;
    media_artist?: string;
    volume_level?: number;
    source?: string;
    source_list?: string[];
    supported_features?: number;
    icon?: string;
  };
  last_changed: string;
}

interface WeatherData {
  temperature: number;
  windspeed: number;
  condition: string;
  icon: string;
  isDay: boolean;
  city: string;
  state: string;
  high: number | null;
  low: number | null;
}

type NavView = 'dashboard' | 'devices' | 'rooms' | 'automations' | 'security' | 'network';

// ── Constants ──────────────────────────────────────────────────────────────────

const CLIP_SM = 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))';
const CLIP_MD = 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))';
const CLIP_LG = 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))';

// Entities to hide from general views
function shouldHide(e: HAEntity): boolean {
  const id = e.entity_id.toLowerCase();
  if (id.startsWith('sensor.sun_'))        return true;
  if (id.includes('backup'))               return true;
  if (id.includes('external_ip'))          return true;
  if (id.includes('active_app_id'))        return true;
  return false;
}

function getFriendlyName(e: HAEntity): string {
  return e.attributes.friendly_name ?? e.entity_id.replace(/_/g, ' ').replace(/^[^.]+\./, '');
}

function isMediaOn(e: HAEntity): boolean {
  return !['off', 'unavailable', 'unknown'].includes(e.state);
}

function loadHAConfig() {
  if (typeof window === 'undefined') return { url: '', token: '' };
  return { url: localStorage.getItem('jarvis_ha_url') ?? '', token: localStorage.getItem('jarvis_ha_token') ?? '' };
}

// ── Panel Shell ────────────────────────────────────────────────────────────────

function Panel({ title, accent = '#22d3ee', accentRgb = '34,211,238', titleColor, children, className = '', headerRight }: {
  title: string;
  accent?: string;
  accentRgb?: string;
  titleColor?: string;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
}) {
  const textColor = titleColor ?? 'rgba(255,255,255,0.88)';
  return (
    <div className={`relative flex flex-col ${className}`}
      style={{ clipPath: CLIP_LG, background: 'rgba(34,211,238,0.03)', border: `1px solid rgba(${accentRgb},0.22)`, backdropFilter: 'blur(12px)', boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 24px rgba(${accentRgb},0.04)` }}>
      {/* Top glow line */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, rgba(${accentRgb},0.6), transparent)` }} />
      {/* Corner cuts */}
      <div className="absolute top-0 right-0 w-4 h-4 pointer-events-none">
        <div className="absolute top-0 right-0 w-3 h-px" style={{ background: accent, opacity: 0.7 }} />
        <div className="absolute top-0 right-0 h-3 w-px" style={{ background: accent, opacity: 0.7 }} />
      </div>
      <div className="absolute bottom-0 left-0 w-4 h-4 pointer-events-none">
        <div className="absolute bottom-0 left-0 w-3 h-px" style={{ background: accent, opacity: 0.4 }} />
        <div className="absolute bottom-0 left-0 h-3 w-px" style={{ background: accent, opacity: 0.4 }} />
      </div>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: `rgba(${accentRgb},0.1)` }}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-sm" style={{ background: `rgba(${accentRgb},0.7)` }} />
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] font-semibold" style={{ color: textColor }}>{title}</span>
        </div>
        {headerRight}
      </div>
      {/* Body */}
      <div className="flex-1 flex flex-col p-4">{children}</div>
    </div>
  );
}

// ── Home Overview Panel ────────────────────────────────────────────────────────

function HomeOverviewPanel({ entities }: { entities: HAEntity[] }) {
  const total   = entities.length;
  const active  = entities.filter((e) => ['on','playing','idle','open','unlocked','home'].includes(e.state)).length;
  const pct     = total > 0 ? active / total : 0;
  const r       = 54;
  const circ    = 2 * Math.PI * r;
  const dash    = circ * 0.75;
  const offset  = dash - dash * pct;
  const rot     = -225;

  return (
    <Panel title="Home Overview" accent="#22d3ee" accentRgb="34,211,238" className="h-full">
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        {/* Gauge */}
        <div className="relative">
          <svg width="140" height="140" viewBox="0 0 140 140">
            {/* BG arc */}
            <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(34,211,238,0.08)"
              strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={0}
              transform={`rotate(${rot} 70 70)`} />
            {/* Active arc */}
            <circle cx="70" cy="70" r={r} fill="none" stroke="#22d3ee"
              strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={offset}
              transform={`rotate(${rot} 70 70)`}
              style={{ filter: 'drop-shadow(0 0 6px rgba(34,211,238,0.8))' }} />
            {/* Glow arc */}
            <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(34,211,238,0.2)"
              strokeWidth="14" strokeLinecap="round"
              strokeDasharray={`${dash * pct} ${circ}`}
              strokeDashoffset={-(dash * (1 - pct))}
              transform={`rotate(${rot} 70 70)`} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center mt-2">
            <div className="font-mono text-2xl font-bold text-white">{active}<span className="text-white/30 text-base">/{total}</span></div>
            <div className="font-mono text-[8px] uppercase tracking-widest text-white/30 mt-0.5">Active Devices</div>
          </div>
        </div>
        {/* Stats row */}
        <div className="grid grid-cols-2 gap-2 w-full">
          {[['Active', active, '#22d3ee'], ['Idle', total - active, 'rgba(255,255,255,0.2)']].map(([label, val, color]) => (
            <div key={String(label)} className="text-center py-2 rounded" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="font-mono text-lg font-semibold" style={{ color: color as string }}>{val as number}</div>
              <div className="font-mono text-[8px] uppercase tracking-widest text-white/25">{label as string}</div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ── TV Panel ───────────────────────────────────────────────────────────────────

// Brand styles for known streaming services (matched case-insensitively)
const STREAMING_BRANDS: Record<string, { bg: string; color: string; label: string; weight: string; style: string }> = {
  'netflix':   { bg: '#E50914', color: '#fff',    label: 'NETFLIX', weight: '800', style: 'italic' },
  'hulu':      { bg: '#1CE783', color: '#0a0a0a', label: 'hulu',    weight: '700', style: 'normal' },
  'disney+':   { bg: '#113CCF', color: '#fff',    label: 'Disney+', weight: '600', style: 'normal' },
  'disney':    { bg: '#113CCF', color: '#fff',    label: 'Disney+', weight: '600', style: 'normal' },
  'youtube':   { bg: '#FF0000', color: '#fff',    label: 'YouTube', weight: '700', style: 'normal' },
  'amazon':    { bg: '#FF9900', color: '#000',    label: 'Prime',   weight: '700', style: 'normal' },
  'max':       { bg: '#002BE7', color: '#fff',    label: 'Max',     weight: '700', style: 'normal' },
  'peacock':   { bg: '#1a1a2e', color: '#fff',    label: 'Peacock', weight: '600', style: 'normal' },
  'apple tv':  { bg: '#1c1c1e', color: '#fff',    label: 'Apple TV',weight: '600', style: 'normal' },
  'espn':      { bg: '#CC0000', color: '#fff',    label: 'ESPN',    weight: '700', style: 'italic' },
  'paramount': { bg: '#0064FF', color: '#fff',    label: 'Param+',  weight: '600', style: 'normal' },
};

function getStreamingBrand(source: string) {
  const key = source.toLowerCase();
  return Object.entries(STREAMING_BRANDS).find(([k]) => key.includes(k))?.[1] ?? null;
}

function TVPanel({ entities, onCallService }: {
  entities: HAEntity[];
  onCallService: (domain: string, service: string, entityId: string, data?: Record<string, unknown>) => void;
}) {
  const tv        = entities.find((e) => e.entity_id.startsWith('media_player.'));
  const activeApp = entities.find((e) => e.entity_id.toLowerCase().includes('active_app') && !e.entity_id.includes('_id'));
  const tvOn      = tv ? isMediaOn(tv) : false;
  const appName   = activeApp?.state ?? tv?.attributes.media_title ?? 'Home';

  // Volume: sync from HA entity (0–1 float), default 28
  const haVolPct = tv?.attributes.volume_level != null ? Math.round(tv.attributes.volume_level * 100) : null;
  const [volume, setVolume] = useState(haVolPct ?? 28);
  useEffect(() => { if (haVolPct != null) setVolume(haVolPct); }, [haVolPct]);

  // Source: use real HA attribute, fall back to local optimistic state
  const haSource = tv?.attributes.source as string | undefined;
  const rawSourceList = (tv?.attributes.source_list as string[] | undefined) ?? ['HDMI 1', 'HDMI 2'];

  // Preferred order shown first, rest appended after
  const PREFERRED = ['Home', 'HDMI 1', 'Netflix', 'Hulu', 'Disney+'];
  const sourceList = [
    ...PREFERRED.filter((p) => rawSourceList.some((s) => s.toLowerCase() === p.toLowerCase())),
    ...rawSourceList.filter((s) => !PREFERRED.some((p) => p.toLowerCase() === s.toLowerCase())),
  ];
  const [selectedInput, setSelectedInput] = useState(haSource ?? 'HDMI 1');
  useEffect(() => { if (haSource) setSelectedInput(haSource); }, [haSource]);

  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const scrollSources = (dir: 'left' | 'right') => {
    const el = sourceScrollRef.current;
    if (!el) return;
    // scroll exactly one full page (5 visible buttons)
    el.scrollBy({ left: dir === 'right' ? el.clientWidth + 6 : -(el.clientWidth + 6), behavior: 'smooth' });
  };

  const selectSource = (source: string) => {
    setSelectedInput(source);
    onCallService('media_player', 'select_source', tv!.entity_id, { source });
  };

  if (!tv) return (
    <Panel title="TV – Living Room" accent="#22d3ee" accentRgb="34,211,238" titleColor="white" className="h-full">
      <div className="flex-1 flex items-center justify-center">
        <span className="text-white/20 font-mono text-xs uppercase tracking-widest">No media player found</span>
      </div>
    </Panel>
  );

  return (
    <Panel title={`TV – ${getFriendlyName(tv)}`} accent="#22d3ee" accentRgb="34,211,238" titleColor="white" className="h-full">
      <div className="flex flex-col gap-4 flex-1 min-h-0">

        {/* ── Row 1: TV drawing (left) + power button (right) ──────── */}
        <div className="flex items-center justify-between gap-4">

          {/* TV SVG on the left */}
          <div className="flex items-end gap-3">
            <svg viewBox="0 0 180 116" width="180" height="116" style={{ overflow: 'visible', flexShrink: 0 }}>
              <rect x="1" y="1" width="178" height="100" rx="6"
                fill={tvOn ? 'rgba(10,18,30,0.95)' : 'rgba(5,6,10,0.9)'}
                stroke="white" strokeWidth="2.5" />
              {tvOn && (
                <rect x="7" y="7" width="166" height="88" rx="4"
                  fill="rgba(34,211,238,0.03)" stroke="rgba(34,211,238,0.12)" strokeWidth="1" />
              )}
              {tvOn && (
                <text x="90" y="56" textAnchor="middle" fill="rgba(255,255,255,0.22)"
                  fontSize="10" fontFamily="monospace" letterSpacing="2">
                  {appName.toUpperCase()}
                </text>
              )}
              <rect x="78" y="101" width="24" height="8" rx="1.5" fill="white" fillOpacity="0.6" />
              <rect x="56" y="109" width="68" height="5" rx="2.5" fill="white" fillOpacity="0.4" />
            </svg>

            {/* Status dot next to TV */}
            <div className="flex flex-col items-center gap-1 pb-6">
              <div className="w-2.5 h-2.5 rounded-full transition-all duration-500"
                style={{
                  background: tvOn ? '#22d3ee' : 'rgba(255,255,255,0.15)',
                  boxShadow: tvOn ? '0 0 10px #22d3ee, 0 0 20px rgba(34,211,238,0.35)' : 'none',
                }} />
              <span className="font-mono text-[10px] font-bold tracking-widest"
                style={{ color: tvOn ? '#22d3ee' : 'rgba(255,255,255,0.2)' }}>
                {tvOn ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          {/* Power button on the right */}
          <button
            onClick={() => onCallService('media_player', tvOn ? 'turn_off' : 'turn_on', tv.entity_id)}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shrink-0"
            style={{
              background: tvOn ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.05)',
              border: `2.5px solid ${tvOn ? '#22d3ee' : 'rgba(255,255,255,0.2)'}`,
              boxShadow: tvOn ? '0 0 30px rgba(34,211,238,0.4), inset 0 0 16px rgba(34,211,238,0.08)' : 'none',
            }}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none"
              stroke={tvOn ? '#22d3ee' : 'rgba(255,255,255,0.35)'}
              strokeWidth="2" strokeLinecap="round">
              <path d="M12 2v6" />
              <path d="M6.3 4.3a9 9 0 1 0 11.4 0" />
            </svg>
          </button>
        </div>

        {/* ── Row 2: INPUT label + current input name ────────────── */}
        <div>
          <div className="font-mono text-[8px] uppercase tracking-widest text-white/30 mb-0.5">Input</div>
          <div className="font-mono text-lg font-bold text-white leading-none">{selectedInput}</div>
        </div>

        {/* ── Row 3: Scrollable source row — shows ~4.5 at a time ──────── */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => scrollSources('left')}
            className="shrink-0 w-6 h-8 flex items-center justify-center rounded-md text-white/35 hover:text-white/80 transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <svg viewBox="0 0 8 12" width="7" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 1L2 6l4 5" />
            </svg>
          </button>

          {/* overflow:hidden + min-w-0 so flex-1 is actually constrained */}
          <div ref={sourceScrollRef} className="flex gap-1.5 flex-1 min-w-0"
            style={{ overflow: 'hidden' }}>
            {sourceList.map((src, idx) => {
              const brand    = getStreamingBrand(src);
              const isActive = selectedInput === src;
              const isHdmi   = src.toUpperCase().startsWith('HDMI');
              /* each button is exactly 1/5 of the visible container width */
              const btnStyle: React.CSSProperties = { width: 'calc(20% - 4.8px)', flexShrink: 0 };
              if (brand) {
                return (
                  <button key={`${src}-${idx}`} onClick={() => selectSource(src)}
                    className="h-8 flex items-center justify-center rounded-md transition-all hover:brightness-110"
                    style={{ ...btnStyle, background: brand.bg,
                      outline: isActive ? '2px solid rgba(255,255,255,0.75)' : 'none', outlineOffset: 1 }}>
                    <span className="font-mono text-[8px] leading-none select-none truncate px-1"
                      style={{ color: brand.color, fontWeight: brand.weight, fontStyle: brand.style as 'italic' | 'normal' }}>
                      {brand.label}
                    </span>
                  </button>
                );
              }
                return (
                <button key={`${src}-${idx}`} onClick={() => selectSource(src)}
                  className="h-8 flex items-center justify-center font-mono font-semibold uppercase tracking-wide transition-all rounded-md"
                  style={{ ...btnStyle, fontSize: isHdmi ? 9 : 7,
                    background: isActive ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isActive ? 'rgba(34,211,238,0.55)' : 'rgba(255,255,255,0.12)'}`,
                    color: isActive ? '#22d3ee' : 'rgba(255,255,255,0.6)',
                    boxShadow: isActive ? '0 0 8px rgba(34,211,238,0.2)' : 'none' }}>
                  <span className="truncate px-1">{src}</span>
                </button>
              );
            })}
          </div>

          <button onClick={() => scrollSources('right')}
            className="shrink-0 w-6 h-8 flex items-center justify-center rounded-md text-white/35 hover:text-white/80 transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <svg viewBox="0 0 8 12" width="7" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 1l4 5-4 5" />
            </svg>
          </button>
        </div>

        {/* ── Row 4: Volume ─────────────────────────────────────────── */}
        <div className="mt-auto">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-sm uppercase tracking-widest text-white/50">Volume</span>
            <span className="text-white/35 text-xs">🔊</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Big volume number on the left */}
            <span className="font-mono text-2xl font-bold text-white w-9 text-right shrink-0 leading-none">{volume}</span>

            {/* Draggable slider */}
            {/* Slider track + ball — 24px tall hit area, track and ball both centered */}
            <div className="relative flex-1 cursor-grab active:cursor-grabbing" style={{ height: 24 }}
              onMouseDown={(e) => {
                const track = e.currentTarget;
                const move = (ev: MouseEvent) => {
                  const rect = track.getBoundingClientRect();
                  const pct = Math.round(Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * 100);
                  setVolume(pct);
                };
                const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
                move(e.nativeEvent);
              }}>
              {/* Track bg */}
              <div className="absolute left-0 right-0 rounded-full" style={{ height: 6, top: 9, background: 'rgba(255,255,255,0.1)' }}>
                {/* Fill */}
                <div className="absolute left-0 top-0 bottom-0 rounded-full"
                  style={{ width: `${volume}%`, background: 'linear-gradient(90deg, rgba(34,211,238,0.6), #22d3ee)' }} />
              </div>
              {/* Ball — top: 9px centers a 20px ball (9 + 10 = 19 ≈ center of 24px) → top: 9 - (20-6)/2 = 9-7 = 2 */}
              <div className="absolute w-5 h-5 rounded-full pointer-events-none"
                style={{
                  top: 2,
                  left: `calc(${volume}% - 10px)`,
                  background: '#22d3ee',
                  boxShadow: '0 0 0 2px rgba(255,255,255,0.3), 0 0 14px rgba(34,211,238,0.7)',
                }} />
            </div>

            <button
              onClick={() => { setVolume((v) => Math.max(0, v - 1)); onCallService('media_player', 'volume_down', tv.entity_id); }}
              className="w-8 h-8 flex items-center justify-center font-bold text-white transition-all hover:brightness-125 rounded-md shrink-0"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
              −
            </button>
            <button
              onClick={() => { setVolume((v) => Math.min(100, v + 1)); onCallService('media_player', 'volume_up', tv.entity_id); }}
              className="w-8 h-8 flex items-center justify-center font-bold text-white transition-all hover:brightness-125 rounded-md shrink-0"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
              +
            </button>
          </div>
        </div>

      </div>
    </Panel>
  );
}

// ── Weather Panel ──────────────────────────────────────────────────────────────

async function geocodeCity(query: string): Promise<{ lat: number; lon: number; display: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'JarvisClient/1.0' } });
    const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
    if (!data.length) return null;
    const parts = data[0].display_name.split(',');
    const display = parts.slice(0, 2).join(',').trim();
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display };
  } catch { return null; }
}

function WeatherPanel() {
  const [weather,     setWeather]     = useState<WeatherData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [configuring, setConfiguring] = useState(false);
  const [cityInput,   setCityInput]   = useState('');
  const [geoError,    setGeoError]    = useState('');
  const [geoLoading,  setGeoLoading]  = useState(false);

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
      if (res.ok) setWeather(await res.json() as WeatherData);
    } finally { setLoading(false); }
  }, []);

  // On mount: try saved coords first, then geolocation
  useEffect(() => {
    const savedLat = localStorage.getItem('jarvis_weather_lat');
    const savedLon = localStorage.getItem('jarvis_weather_lon');
    if (savedLat && savedLon) {
      fetchWeather(parseFloat(savedLat), parseFloat(savedLon));
      return;
    }
    if (!navigator.geolocation) { setLoading(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
      () => setLoading(false),
      { timeout: 8000 }
    );
  }, [fetchWeather]);

  const handleCitySubmit = async () => {
    if (!cityInput.trim()) return;
    setGeoLoading(true);
    setGeoError('');
    const result = await geocodeCity(cityInput.trim());
    setGeoLoading(false);
    if (!result) { setGeoError('Location not found'); return; }
    localStorage.setItem('jarvis_weather_lat', String(result.lat));
    localStorage.setItem('jarvis_weather_lon', String(result.lon));
    setConfiguring(false);
    setCityInput('');
    fetchWeather(result.lat, result.lon);
  };

  const handleUseGeo = () => {
    localStorage.removeItem('jarvis_weather_lat');
    localStorage.removeItem('jarvis_weather_lon');
    setConfiguring(false);
    setLoading(true);
    if (!navigator.geolocation) { setLoading(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
      () => setLoading(false),
      { timeout: 8000 }
    );
  };

  return (
    <Panel title="Weather" accent="#22d3ee" accentRgb="34,211,238" className=""
      headerRight={
        <button onClick={() => { setConfiguring((c) => !c); setGeoError(''); }}
          className="w-5 h-5 flex items-center justify-center rounded transition-all hover:text-cyan-300"
          style={{ color: configuring ? '#22d3ee' : 'rgba(255,255,255,0.25)' }}
          title="Configure location">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            <path d="M8 5a3 3 0 1 0 0 6A3 3 0 0 0 8 5zm0 4.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
            <path d="M9.4 1H6.6l-.4 1.5a5.5 5.5 0 0 0-1.1.64L3.6 2.6 1.6 4.6l.54 1.46A5.5 5.5 0 0 0 1.5 7.2v1.6c0 .38.05.75.14 1.1L.6 11.4l2 2 1.5-.54c.35.23.72.43 1.1.58L5.6 15h2.8l.4-1.56c.38-.15.75-.35 1.1-.58l1.5.54 2-2-.54-1.5c.09-.35.14-.72.14-1.1V7.2a5.5 5.5 0 0 0-.64-1.14L14.4 4.6l-2-2-1.46.54A5.5 5.5 0 0 0 9.8 2.5L9.4 1z"/>
          </svg>
        </button>
      }>
      {configuring ? (
        /* ── Config mode ── */
        <div className="flex flex-col gap-2 flex-1 justify-center">
          <div className="font-mono text-[8px] uppercase tracking-widest text-white/30 mb-1">Set Location</div>
          <input
            type="text"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCitySubmit()}
            placeholder="City, State or Zip…"
            autoFocus
            className="w-full px-2 py-1.5 font-mono text-[10px] text-white bg-transparent outline-none"
            style={{ border: '1px solid rgba(34,211,238,0.35)', clipPath: CLIP_SM,
              background: 'rgba(34,211,238,0.05)' }}
          />
          {geoError && <div className="font-mono text-[8px] text-red-400/70">{geoError}</div>}
          <button onClick={handleCitySubmit} disabled={geoLoading}
            className="w-full py-1.5 font-mono text-[9px] uppercase tracking-wider text-white transition-all"
            style={{ clipPath: CLIP_SM, background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.4)' }}>
            {geoLoading ? 'Searching…' : 'Apply'}
          </button>
          <button onClick={handleUseGeo}
            className="w-full py-1 font-mono text-[8px] uppercase tracking-wider transition-all"
            style={{ color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.1)', clipPath: CLIP_SM }}>
            Use my location
          </button>
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-white/20 font-mono text-[9px] animate-pulse uppercase tracking-widest">Locating…</span>
        </div>
      ) : !weather ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-white/20 font-mono text-[9px] uppercase tracking-widest text-center">Location unavailable</span>
          <button onClick={() => setConfiguring(true)}
            className="font-mono text-[8px] uppercase tracking-wider px-2 py-1 transition-all"
            style={{ color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)', clipPath: CLIP_SM }}>
            Set Location
          </button>
        </div>
      ) : (
        /* ── Compact weather display ── */
        <div className="flex flex-col gap-1.5">
          {/* Icon + temp row */}
          <div className="flex items-center gap-3">
            <img src={weather.icon} alt={weather.condition} className="w-14 h-14 object-contain shrink-0" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-3xl font-bold text-white leading-none">{weather.temperature}°</span>
                <span className="font-mono text-xs text-white/35">F</span>
              </div>
              <div className="font-mono text-xs uppercase tracking-wide mt-0.5 text-white">{weather.condition}</div>
              <div className="font-mono text-[10px] text-white/40 truncate mt-0.5">
                {weather.city}{weather.state ? `, ${weather.state}` : ''}
              </div>
            </div>
          </div>
          {/* Stats as plain text */}
          <div className="font-mono text-[11px] text-white/60 flex gap-3 mt-1">
            <span>💨 {weather.windspeed} mph</span>
            {weather.high != null && <span>H {weather.high}°</span>}
            {weather.low  != null && <span>L {weather.low}°</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Printer Panel ──────────────────────────────────────────────────────────────

function PrinterPanel({ entities }: { entities: HAEntity[] }) {
  const inks = entities.filter((e) => e.entity_id.toLowerCase().includes('ink') && e.attributes.unit_of_measurement === '%');
  const printer = entities.find((e) => e.entity_id.toLowerCase().includes('hp_deskjet') && !e.entity_id.toLowerCase().includes('ink'));

  const getInkColor = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('black')) return { color: '#e2e8f0', glow: '226,232,240', bar: 'linear-gradient(90deg, #94a3b8, #e2e8f0)' };
    if (n.includes('tri') || n.includes('color')) return { color: '#22d3ee', glow: '34,211,238', bar: 'linear-gradient(90deg, #3b82f6, #22d3ee, #f59e0b)' };
    return { color: '#c084fc', glow: '192,132,252', bar: 'linear-gradient(90deg, #c084fc, #818cf8)' };
  };

  return (
    <Panel title="Printer" accent="#22d3ee" accentRgb="34,211,238" className="h-full"
      headerRight={
        printer && <span className="font-mono text-[8px] uppercase tracking-wider text-white/30 capitalize">{printer.state}</span>
      }>
      <div className="flex flex-col flex-1 gap-3">
        {/* Printer name */}
        {printer && (
          <div className="font-mono text-[9px] text-white/25 truncate">
            {getFriendlyName(printer)}
          </div>
        )}

        {inks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-white/20 font-mono text-[10px] uppercase tracking-widest">No ink sensors</span>
          </div>
        ) : (
          /* Bars: grow to fill remaining height, columns are equal width */
          <div className="flex flex-1 gap-4" style={{ minHeight: 0 }}>
            {inks.map((ink) => {
              const pct      = Math.max(0, Math.min(100, parseFloat(ink.state) || 0));
              const name     = getFriendlyName(ink);
              const inkLabel = name.toLowerCase().includes('black') ? 'Black' : name.toLowerCase().includes('tri') ? 'Color' : name;
              const style    = getInkColor(name);
              const warn     = pct < 20;
              return (
                <div key={ink.entity_id} className="flex flex-col items-center gap-2 flex-1">
                  {/* Percentage */}
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs font-semibold" style={{ color: warn ? '#f87171' : style.color }}>
                      {pct}%
                    </span>
                    {warn && <span className="text-red-400 text-[10px]">⚠</span>}
                  </div>

                  {/* Bar — grows to fill available height */}
                  <div className="relative w-full flex-1 rounded overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', minHeight: 0 }}>
                    <motion.div
                      className="absolute bottom-0 left-0 right-0"
                      initial={{ height: 0 }}
                      animate={{ height: `${pct}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                      style={{
                        background: warn
                          ? 'linear-gradient(0deg, #ef4444, #f87171)'
                          : style.bar.replace('90deg', '0deg'),
                        boxShadow: warn
                          ? '0 0 12px rgba(239,68,68,0.5)'
                          : `0 0 12px rgba(${style.glow},0.45)`,
                      }}
                    />
                    {[25, 50, 75].map((m) => (
                      <div key={m} className="absolute left-0 right-0 h-px pointer-events-none"
                        style={{ bottom: `${m}%`, background: 'rgba(255,255,255,0.07)' }} />
                    ))}
                  </div>

                  {/* Warning ping */}
                  {warn && (
                    <div className="w-2 h-2 rounded-full bg-red-400 animate-ping shrink-0"
                      style={{ filter: 'drop-shadow(0 0 4px rgba(239,68,68,0.8))' }} />
                  )}

                  {/* Label */}
                  <span className="font-mono text-[8px] uppercase tracking-widest text-white/30 shrink-0">{inkLabel}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── Network Bar (horizontal, bottom-spanning) ─────────────────────────────────

function NetworkBar({ entities }: { entities: HAEntity[] }) {
  const dl  = entities.find((e) => e.entity_id.toLowerCase().includes('download_speed'));
  const ul  = entities.find((e) => e.entity_id.toLowerCase().includes('upload_speed'));
  const wan = entities.find((e) => e.entity_id.toLowerCase().includes('wan_status'));
  const fmt = (e: HAEntity | undefined) => ({ val: e?.state ?? '—', unit: e?.attributes.unit_of_measurement ?? '' });
  const { val: dlVal, unit: dlUnit } = fmt(dl);
  const { val: ulVal, unit: ulUnit } = fmt(ul);
  const connected = wan?.state === 'on';

  return (
    <div className="relative flex items-center gap-8 px-5 py-3"
      style={{ background: 'rgba(34,211,238,0.03)', border: '1px solid rgba(34,211,238,0.15)', backdropFilter: 'blur(10px)', clipPath: CLIP_LG }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(34,211,238,0.5), transparent)' }} />

      {/* WAN */}
      <div className="flex items-center gap-2 shrink-0">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: connected ? '#4ade80' : 'rgba(255,255,255,0.3)' }}>
          {connected ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="w-px h-6 bg-white/10 shrink-0" />

      {/* Download */}
      <div className="flex items-center gap-3 flex-1">
        <div className="flex items-center gap-1.5 shrink-0">
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 2v8M3 7l4 4 4-4" /><path d="M2 12h10" />
          </svg>
          <span className="font-mono text-[9px] text-white/35 uppercase tracking-widest">DL</span>
          <span className="font-mono text-xs font-semibold" style={{ color: '#22d3ee' }}>{dlVal} <span className="text-[8px] text-white/30">{dlUnit}</span></span>
        </div>
        <div className="flex gap-0.5 items-end h-6 flex-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <motion.div key={i} className="flex-1 rounded-sm"
              style={{ background: 'rgba(34,211,238,0.2)', minHeight: 2 }}
              animate={{ height: [2, Math.random() * 18 + 2, 2] }}
              transition={{ duration: 1.2 + Math.random(), repeat: Infinity, ease: 'easeInOut', delay: i * 0.06 }} />
          ))}
        </div>
      </div>

      <div className="w-px h-6 bg-white/10 shrink-0" />

      {/* Upload */}
      <div className="flex items-center gap-3 flex-1">
        <div className="flex items-center gap-1.5 shrink-0">
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 10V2M3 5l4-4 4 4" /><path d="M2 12h10" />
          </svg>
          <span className="font-mono text-[9px] text-white/35 uppercase tracking-widest">UL</span>
          <span className="font-mono text-xs font-semibold" style={{ color: '#60a5fa' }}>{ulVal} <span className="text-[8px] text-white/30">{ulUnit}</span></span>
        </div>
        <div className="flex gap-0.5 items-end h-6 flex-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <motion.div key={i} className="flex-1 rounded-sm"
              style={{ background: 'rgba(96,165,250,0.2)', minHeight: 2 }}
              animate={{ height: [2, Math.random() * 18 + 2, 2] }}
              transition={{ duration: 1.4 + Math.random(), repeat: Infinity, ease: 'easeInOut', delay: i * 0.06 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Quick Actions Panel ────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  {
    label: 'All Off',
    icon: (
      <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v9" />
        <path d="M8.5 5.5A8 8 0 1 0 15.5 5.5" />
      </svg>
    ),
  },
  {
    label: 'Movie Mode',
    icon: (
      <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 8.5h20M7 5v3.5M12 5v3.5M17 5v3.5M7 15.5V19M12 15.5V19M17 15.5V19" />
      </svg>
    ),
  },
  {
    label: 'Night Mode',
    icon: (
      <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
      </svg>
    ),
  },
  {
    label: 'Good Morning',
    icon: (
      <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
      </svg>
    ),
  },
];

function QuickActionsPanel() {
  return (
    <Panel title="Quick Actions" accent="#22d3ee" accentRgb="34,211,238" className="h-full">
      <div className="grid grid-cols-2 gap-2 flex-1">
        {QUICK_ACTIONS.map(({ label, icon }) => (
          <button key={label}
            className="flex flex-col items-center justify-center gap-3 py-3 transition-all active:scale-95 group relative"
            style={{
              background: 'rgba(34,211,238,0.07)',
              border: '1px solid rgba(34,211,238,0.35)',
              clipPath: 'polygon(10px 0%, calc(100% - 10px) 0%, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0% calc(100% - 10px), 0% 10px)',
              color: 'rgba(34,211,238,0.9)',
              boxShadow: '0 0 14px rgba(34,211,238,0.15), inset 0 0 14px rgba(34,211,238,0.05)',
            }}>
            <span className="transition-all group-hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.9)]">
              {icon}
            </span>
            <span className="font-mono text-sm uppercase tracking-wider font-semibold text-white/80">{label}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

// ── Security Panel (Dummy) ─────────────────────────────────────────────────────

// ── Security Widget (compact dashboard tile) ───────────────────────────────

function SecurityWidget() {
  return (
    <Panel title="Security" accent="#22d3ee" accentRgb="34,211,238">
      <div className="flex items-center gap-4">
        {/* Icon */}
        <img src="/assets/Secure.png" alt="Security" className="w-12 h-12 object-contain shrink-0" />

        {/* Status text */}
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-sm font-semibold text-white leading-none">Home</span>
          <span className="font-mono text-xl font-bold leading-none" style={{ color: '#22d3ee' }}>SECURE</span>
        </div>
      </div>

      {/* No alerts box */}
      <div className="mt-3 px-3 py-2 rounded-md font-mono text-[10px] uppercase tracking-widest text-white/45 text-center"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        No Alerts
      </div>
    </Panel>
  );
}

// ── Security Panel (full sidebar view) ────────────────────────────────────

function SecurityPanel() {
  const [armed, setArmed] = useState(false);
  const events = [
    { time: '09:42', msg: 'Front door — motion detected', type: 'info' },
    { time: '09:15', msg: 'System armed — Away mode', type: 'ok' },
    { time: '08:31', msg: 'Garage door opened', type: 'info' },
  ];

  return (
    <Panel title="Security" accent="#22d3ee" accentRgb="34,211,238" className="h-full"
      headerRight={
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${armed ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
          <span className="font-mono text-[8px] uppercase tracking-wider" style={{ color: armed ? '#4ade80' : '#f87171' }}>
            {armed ? 'Secured' : 'Disarmed'}
          </span>
        </div>
      }>
      <div className="flex flex-col gap-3 flex-1">
        {/* Arm / Disarm */}
        <div className="flex gap-2">
          <button onClick={() => setArmed(true)}
            className="flex-1 py-2 font-mono text-[9px] uppercase tracking-wider transition-all"
            style={{ clipPath: CLIP_SM, background: armed ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${armed ? 'rgba(34,211,238,0.4)' : 'rgba(255,255,255,0.08)'}`, color: armed ? '#22d3ee' : 'rgba(255,255,255,0.35)' }}>
            Arm
          </button>
          <button onClick={() => setArmed(false)}
            className="flex-1 py-2 font-mono text-[9px] uppercase tracking-wider transition-all"
            style={{ clipPath: CLIP_SM, background: !armed ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)', border: `1px solid ${!armed ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'}`, color: !armed ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)' }}>
            Disarm
          </button>
        </div>
        {/* Cameras */}
        <div className="grid grid-cols-2 gap-1.5">
          {['Front Door', 'Garage', 'Back Yard', 'Driveway'].map((cam) => (
            <div key={cam} className="relative flex items-center justify-center rounded aspect-video"
              style={{ background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.12)' }}>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-lg opacity-30">📷</span>
                <span className="font-mono text-[7px] text-white/20 uppercase tracking-widest">{cam}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Event log */}
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {events.map((ev, i) => (
            <div key={i} className="flex items-start gap-2 py-1.5 px-2 rounded"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="font-mono text-[8px] text-white/25 shrink-0 mt-0.5">{ev.time}</span>
              <span className="font-mono text-[9px]" style={{ color: ev.type === 'ok' ? '#4ade80' : 'rgba(255,255,255,0.4)' }}>{ev.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ── Network Panel ───────────────────────────────────────────────────────────────

function NetworkPanel({ entities }: { entities: HAEntity[] }) {
  const dl  = entities.find((e) => e.entity_id.toLowerCase().includes('download_speed'));
  const ul  = entities.find((e) => e.entity_id.toLowerCase().includes('upload_speed'));
  const wan = entities.find((e) => e.entity_id.toLowerCase().includes('wan_status'));
  const fmt = (e: HAEntity | undefined) => ({ val: e?.state ?? '—', unit: e?.attributes.unit_of_measurement ?? '' });
  const { val: dlVal, unit: dlUnit } = fmt(dl);
  const { val: ulVal, unit: ulUnit } = fmt(ul);
  const connected = wan?.state === 'on';

  return (
    <Panel title="Network" accent="#22d3ee" accentRgb="34,211,238" className="h-full"
      headerRight={
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-white/20'}`} />
          <span className="font-mono text-[8px] uppercase tracking-wider" style={{ color: connected ? '#4ade80' : 'rgba(255,255,255,0.3)' }}>
            {connected ? 'Online' : 'Offline'}
          </span>
        </div>
      }>
      <div className="flex flex-col gap-4 flex-1">
        <div className="flex items-center gap-6 py-2 px-3 rounded"
          style={{ background: 'rgba(34,211,238,0.03)', border: '1px solid rgba(34,211,238,0.1)' }}>
          <div className="flex flex-col gap-1 flex-1">
            <span className="font-mono text-[8px] text-white/30 uppercase tracking-widest">Download</span>
            <span className="font-mono text-sm font-semibold" style={{ color: '#22d3ee' }}>{dlVal} <span className="text-[9px] text-white/30">{dlUnit}</span></span>
          </div>
          <div className="w-px h-10 bg-white/10" />
          <div className="flex flex-col gap-1 flex-1">
            <span className="font-mono text-[8px] text-white/30 uppercase tracking-widest">Upload</span>
            <span className="font-mono text-sm font-semibold" style={{ color: '#60a5fa' }}>{ulVal} <span className="text-[9px] text-white/30">{ulUnit}</span></span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ── Devices Panel ──────────────────────────────────────────────────────────────

function SmallDeviceRow({ entity, onToggle }: { entity: HAEntity; onToggle: () => void }) {
  const on = ['on', 'playing', 'idle', 'open', 'home'].includes(entity.state);
  const domain = entity.entity_id.split('.')[0];
  const accent = domain === 'light' ? { color: '#f59e0b', rgb: '245,158,11' } : { color: '#22c55e', rgb: '34,197,94' };
  const bPct = entity.attributes.brightness != null ? Math.round((entity.attributes.brightness / 255) * 100) : null;

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded group"
      style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${on ? `rgba(${accent.rgb},0.12)` : 'rgba(255,255,255,0.05)'}` }}>
      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: on ? accent.color : 'rgba(255,255,255,0.15)' }} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] truncate" style={{ color: on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)' }}>
          {getFriendlyName(entity)}
        </div>
        {bPct !== null && on && (
          <div className="h-0.5 mt-1 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', width: '100%' }}>
            <div className="h-full rounded-full" style={{ width: `${bPct}%`, background: '#f59e0b' }} />
          </div>
        )}
      </div>
      {/* Toggle */}
      <button onClick={onToggle}
        className="relative shrink-0 transition-all duration-200"
        style={{
          width: 36, height: 20,
          borderRadius: 999,
          background: on ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.07)',
          border: `1.5px solid ${on ? 'rgba(96,165,250,0.7)' : 'rgba(255,255,255,0.15)'}`,
          boxShadow: on ? '0 0 8px rgba(59,130,246,0.4)' : 'none',
        }}>
        <span className="absolute top-[2px] transition-all duration-200"
          style={{
            width: 14, height: 14,
            borderRadius: '50%',
            left: on ? 18 : 2,
            background: on ? '#60a5fa' : 'rgba(255,255,255,0.3)',
            boxShadow: on ? '0 0 6px rgba(96,165,250,0.8)' : 'none',
          }} />
      </button>
    </div>
  );
}

function DevicesPanel({ entities, onCallService }: {
  entities: HAEntity[];
  onCallService: (domain: string, service: string, entityId: string) => void;
}) {
  const devices = entities.filter((e) => ['light', 'switch', 'fan'].includes(e.entity_id.split('.')[0]));
  const onCount = devices.filter((e) => ['on', 'idle'].includes(e.state)).length;

  return (
    <Panel title="Smart Devices" accent="#22d3ee" accentRgb="34,211,238" className="h-full"
      headerRight={<span className="font-mono text-[8px] text-cyan-400/60 uppercase tracking-wider">{onCount}/{devices.length} on</span>}>
      <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 scrollbar-hide">
        {devices.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-white/20 font-mono text-[10px] uppercase tracking-widest">No devices</span>
          </div>
        ) : devices.map((e) => (
          <SmallDeviceRow key={e.entity_id} entity={e}
            onToggle={() => {
              const on = ['on', 'idle'].includes(e.state);
              onCallService(e.entity_id.split('.')[0], on ? 'turn_off' : 'turn_on', e.entity_id);
            }} />
        ))}
      </div>
    </Panel>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

const NAV_SVGs: Record<NavView, React.ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="7" height="7" rx="1" />
      <rect x="11" y="2" width="7" height="7" rx="1" />
      <rect x="2" y="11" width="7" height="7" rx="1" />
      <rect x="11" y="11" width="7" height="7" rx="1" />
    </svg>
  ),
  devices: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M14.36 5.64l-1.42 1.42M5.64 14.36l-1.42 1.42" />
    </svg>
  ),
  rooms: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 10L10 3l8 7" />
      <path d="M4 9v8h4v-4h4v4h4V9" />
    </svg>
  ),
  automations: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2L5 11h6l-2 7 6-9h-6l2-7z" />
    </svg>
  ),
  security: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2L3 5v5c0 4.4 3 8.1 7 9 4-0.9 7-4.6 7-9V5l-7-3z" />
      <path d="M7 10l2 2 4-4" />
    </svg>
  ),
  network: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="M7 10a3 3 0 0 1 6 0" />
      <path d="M4 10a6 6 0 0 1 12 0" />
      <path d="M1 10a9 9 0 0 1 18 0" />
    </svg>
  ),
};

const NAV_LABELS: Record<NavView, string> = {
  dashboard:   'Dashboard',
  devices:     'Devices',
  rooms:       'Rooms',
  automations: 'Automations',
  security:    'Security',
  network:     'Network',
};

const SIDEBAR_VIEWS: NavView[] = ['dashboard', 'devices', 'rooms', 'automations', 'security'];

function Sidebar({ view, setView }: { view: NavView; setView: (v: NavView) => void }) {
  return (
    <div className="relative z-10 w-44 shrink-0 flex flex-col pt-5 pb-6 gap-1 border-r px-3"
      style={{ background: 'rgba(2,4,10,0.7)', borderColor: 'rgba(34,211,238,0.07)' }}>
      {SIDEBAR_VIEWS.map((v) => {
        const active = view === v;
        return (
          <button key={v} onClick={() => setView(v)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-md transition-all duration-200"
            style={{
              background: active ? 'rgba(34,211,238,0.1)' : 'transparent',
              border: `1px solid ${active ? 'rgba(34,211,238,0.3)' : 'transparent'}`,
              color: active ? '#22d3ee' : 'rgba(255,255,255,0.5)',
              boxShadow: active ? '0 0 16px rgba(34,211,238,0.15)' : 'none',
            }}>
            <span className="shrink-0 flex items-center justify-center" style={{ width: 22, height: 22 }}>
              {NAV_SVGs[v]}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-wider leading-none">{NAV_LABELS[v]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── All Devices View (grid) ────────────────────────────────────────────────────

const CONTROLLABLE_DOMAINS = ['light', 'switch', 'fan', 'cover', 'lock', 'media_player', 'climate'];

const DOMAIN_META: Record<string, { label: string; color: string; rgb: string; icon: React.ReactNode }> = {
  light: {
    label: 'Lights', color: '#f59e0b', rgb: '245,158,11',
    icon: <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 2a6 6 0 0 1 3 11.2V15a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-1.8A6 6 0 0 1 10 2z"/><path d="M8 17h4"/></svg>,
  },
  switch: {
    label: 'Switches', color: '#22c55e', rgb: '34,197,94',
    icon: <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="7" width="14" height="6" rx="3"/><circle cx="13" cy="10" r="2" fill="currentColor" stroke="none" opacity="0.5"/></svg>,
  },
  climate: {
    label: 'Climate', color: '#22d3ee', rgb: '34,211,238',
    icon: <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 2v16M6.3 5.3l7.4 9.4M13.7 5.3l-7.4 9.4"/><circle cx="10" cy="10" r="2"/></svg>,
  },
  fan: {
    label: 'Fans', color: '#60a5fa', rgb: '96,165,250',
    icon: <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="1.5"/><path d="M10 8.5C10 5 8 3 6 4s-1 5 2 5"/><path d="M11.5 10c3.5 0 5.5-2 4.5-4s-5-1-5 2"/><path d="M10 11.5c0 3.5 2 5.5 4 4.5s1-5-2-5"/><path d="M8.5 10c-3.5 0-5.5 2-4.5 4s5 1 5-2"/></svg>,
  },
  cover: {
    label: 'Covers', color: '#fb923c', rgb: '251,146,60',
    icon: <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 7h14M3 10h14M3 13h14"/><rect x="3" y="4" width="14" height="12" rx="1"/></svg>,
  },
  media_player: {
    label: 'Media', color: '#c084fc', rgb: '192,132,252',
    icon: <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="16" height="10" rx="2"/><path d="M8 14v2M12 14v2M6 16h8"/><path d="M8 9l5-3v6z" fill="currentColor" opacity="0.5" stroke="none"/></svg>,
  },
  lock: {
    label: 'Locks', color: '#f87171', rgb: '248,113,113',
    icon: <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="9" width="10" height="8" rx="2"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/></svg>,
  },
};

function DeviceCard({ entity, domain, onCallService, onSetBrightness }: {
  entity: HAEntity;
  domain: string;
  onCallService: (domain: string, service: string, entityId: string, data?: Record<string, unknown>) => void;
  onSetBrightness: (entity: HAEntity, pct: number) => void;
}) {
  const meta = DOMAIN_META[domain] ?? { color: '#94a3b8', rgb: '148,163,184', label: domain, icon: null };
  const on = ['on', 'playing', 'idle', 'open', 'unlocked', 'home'].includes(entity.state);
  const unavailable = ['unavailable', 'unknown'].includes(entity.state);
  const name = getFriendlyName(entity);
  const bPct = entity.attributes.brightness != null ? Math.round((entity.attributes.brightness / 255) * 100) : null;
  const temp = entity.attributes.current_temperature != null ? `${entity.attributes.current_temperature}°` : null;

  return (
    <div className="relative flex flex-col gap-3 p-4 transition-all cursor-default"
      style={{
        background: on ? `rgba(${meta.rgb},0.1)` : 'rgba(255,255,255,0.05)',
        border: `1px solid ${on ? `rgba(${meta.rgb},0.5)` : 'rgba(255,255,255,0.18)'}`,
        borderRadius: 10,
        boxShadow: on ? `0 0 22px rgba(${meta.rgb},0.18), inset 0 0 10px rgba(${meta.rgb},0.04)` : '0 0 0 1px rgba(255,255,255,0.04)',
        opacity: unavailable ? 0.45 : 1,
      }}>
      {/* Top bar accent */}
      <div className="absolute top-0 left-4 right-4 h-px rounded-full transition-all"
        style={{ background: on ? `rgba(${meta.rgb},0.8)` : 'rgba(255,255,255,0.12)' }} />

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {/* Domain icon bubble */}
          <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
            style={{ background: on ? `rgba(${meta.rgb},0.2)` : 'rgba(255,255,255,0.08)', color: on ? meta.color : 'rgba(255,255,255,0.55)' }}>
            {meta.icon}
          </div>
          <div>
            <div className="font-sans text-sm font-semibold leading-tight truncate max-w-[130px]"
              style={{ color: on ? '#fff' : 'rgba(255,255,255,0.7)' }}>{name}</div>
            <div className="font-mono text-[11px] leading-none mt-0.5 capitalize"
              style={{ color: on ? meta.color : 'rgba(255,255,255,0.4)' }}>
              {temp ?? (on ? entity.state : unavailable ? 'unavailable' : 'off')}
            </div>
          </div>
        </div>

        {/* Toggle */}
        <button
          disabled={unavailable}
          onClick={() => onCallService(domain, on ? 'turn_off' : 'turn_on', entity.entity_id)}
          className="relative shrink-0 w-10 h-5 rounded-full transition-all duration-200 focus:outline-none"
          style={{ background: on ? `rgba(${meta.rgb},0.4)` : 'rgba(255,255,255,0.12)', border: `1px solid ${on ? `rgba(${meta.rgb},0.8)` : 'rgba(255,255,255,0.25)'}` }}>
          <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 shadow"
            style={{ left: on ? '21px' : '2px', background: on ? meta.color : 'rgba(255,255,255,0.6)', boxShadow: on ? `0 0 8px ${meta.color}` : 'none' }} />
        </button>
      </div>

      {/* Brightness bar for lights */}
      {domain === 'light' && bPct !== null && on && (
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2"><circle cx="6" cy="6" r="2"/><path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.6 2.6l.7.7M8.7 8.7l.7.7M8.7 3.3l-.7.7M3.3 8.7l-.7.7"/></svg>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${bPct}%`, background: meta.color }} />
          </div>
          <span className="font-mono text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.6)' }}>{bPct}%</span>
          <input type="range" min="0" max="100" value={bPct} className="sr-only"
            onChange={(e) => onSetBrightness(entity, parseInt(e.target.value, 10))} />
        </div>
      )}
    </div>
  );
}

function AllDevicesView({ entities, onCallService, onSetBrightness }: {
  entities: HAEntity[];
  onCallService: (domain: string, service: string, entityId: string, data?: Record<string, unknown>) => void;
  onSetBrightness: (entity: HAEntity, pct: number) => void;
}) {
  const controllable = entities.filter((e) => {
    const domain = e.entity_id.split('.')[0];
    return CONTROLLABLE_DOMAINS.includes(domain) && !shouldHide(e);
  });

  const groups = controllable.reduce<Record<string, HAEntity[]>>((acc, e) => {
    const d = e.entity_id.split('.')[0];
    (acc[d] ??= []).push(e);
    return acc;
  }, {});

  const orderedDomains = CONTROLLABLE_DOMAINS.filter((d) => groups[d]?.length);

  if (orderedDomains.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/20 font-mono text-xs">
        No controllable devices found
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 scrollbar-hide" style={{ background: 'rgba(0,10,20,0.5)' }}>
      {orderedDomains.map((domain) => {
        const meta = DOMAIN_META[domain] ?? { label: domain, color: '#94a3b8', rgb: '148,163,184', icon: null };
        const domainEntities = groups[domain];
        const activeCount = domainEntities.filter((e) => ['on','playing','idle','open','unlocked','home'].includes(e.state)).length;

        return (
          <div key={domain}>
            {/* Section header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-7 h-7 rounded-md"
                style={{ background: `rgba(${meta.rgb},0.18)`, color: meta.color }}>
                {meta.icon}
              </div>
              <span className="font-sans text-base font-bold tracking-wide" style={{ color: '#fff' }}>{meta.label}</span>
              <div className="flex-1 h-px" style={{ background: `rgba(${meta.rgb},0.25)` }} />
              <span className="font-mono text-xs px-2.5 py-0.5 rounded-full font-semibold"
                style={{ background: `rgba(${meta.rgb},0.15)`, color: meta.color, border: `1px solid rgba(${meta.rgb},0.4)` }}>
                {activeCount} / {domainEntities.length} on
              </span>
            </div>

            {/* Device cards */}
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              {domainEntities.map((entity) => (
                <DeviceCard key={entity.entity_id} entity={entity} domain={domain}
                  onCallService={onCallService} onSetBrightness={onSetBrightness} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

interface Props { onNavigateHome: () => void; }

export function HomeAssistantPage({ onNavigateHome }: Props) {
  const [haUrl,   setHaUrl]   = useState('');
  const [haToken, setHaToken] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [entities,   setEntities]   = useState<HAEntity[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [navView, setNavView]       = useState<NavView>('dashboard');
  const [clock,   setClock]         = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clock tick
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const fetchEntities = useCallback(async (url: string, token: string) => {
    if (!url || !token) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/home-assistant?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}&path=/api/states`);
      if (!res.ok) { const d = await res.json() as { error?: string }; setError(d.error ?? `HTTP ${res.status}`); return; }
      setEntities(await res.json() as HAEntity[]);
    } catch (e) { setError(`Could not reach HA: ${String(e)}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadServerSettings().then((srv) => {
      const url   = srv.jarvis_ha_url   || loadHAConfig().url;
      const token = srv.jarvis_ha_token || loadHAConfig().token;
      // Back-fill localStorage so the host machine also benefits
      if (srv.jarvis_ha_url)   localStorage.setItem('jarvis_ha_url',   srv.jarvis_ha_url);
      if (srv.jarvis_ha_token) localStorage.setItem('jarvis_ha_token', srv.jarvis_ha_token);
      if (url && token) { setHaUrl(url); setHaToken(token); fetchEntities(url, token); }
      else setShowWizard(true);
    });
  }, [fetchEntities]);

  useEffect(() => {
    if (!haUrl || !haToken) return;
    pollRef.current = setInterval(() => fetchEntities(haUrl, haToken), 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [haUrl, haToken, fetchEntities]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const { entityId, domain, service, serviceData } = detail;
      if (!entityId) return;
      await callService(domain, service, entityId, serviceData ?? {});
    };
    window.addEventListener('jarvis:home-assistant', handler);
    return () => window.removeEventListener('jarvis:home-assistant', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haUrl, haToken]);

  const callService = async (domain: string, service: string, entityId: string, serviceData: Record<string, unknown> = {}) => {
    if (!haUrl || !haToken) return;
    setLoadingIds((p) => new Set(p).add(entityId));
    try {
      await fetch('/api/home-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: haUrl, token: haToken, domain, service, serviceData: { entity_id: entityId, ...serviceData } }),
      });
      setEntities((prev) => prev.map((e) => {
        if (e.entity_id !== entityId) return e;
        if (service === 'turn_on')       return { ...e, state: 'on',  attributes: { ...e.attributes, ...serviceData } };
        if (service === 'turn_off')      return { ...e, state: 'off' };
        if (service === 'toggle')        return { ...e, state: ['on','idle','playing'].includes(e.state) ? 'off' : 'on' };
        if (service === 'select_source') return { ...e, attributes: { ...e.attributes, source: serviceData.source as string } };
        return e;
      }));
      setTimeout(() => fetchEntities(haUrl, haToken), 1500);
    } finally { setLoadingIds((p) => { const n = new Set(p); n.delete(entityId); return n; }); }
  };

  const handleSetBrightness = useCallback((entity: HAEntity, pct: number) => {
    callService('light', 'turn_on', entity.entity_id, { brightness: Math.round((pct / 100) * 255) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haUrl, haToken]);

  const handleWizardComplete = (url: string, token: string) => {
    setHaUrl(url); setHaToken(token); setShowWizard(false); fetchEntities(url, token);
  };

  const onCount  = entities.filter((e) => ['on','playing','idle','open'].includes(e.state)).length;
  const allCount = entities.length;
  const today    = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <AnimatePresence mode="wait">
      {showWizard ? (
        <HomeAssistantWizard key="ha-wizard" onComplete={handleWizardComplete} onSkip={() => setShowWizard(false)} />
      ) : (
        <motion.div key="ha-page" className="fixed inset-0 z-[50] overflow-hidden flex flex-col"
          style={{ background: '#020408' }}
          initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
          animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
          exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
          transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}>

          {/* Grid background */}
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(34,211,238,0.12) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,0.12) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 90% 90% at 50% 50%,transparent 40%,rgba(2,4,8,0.45) 100%)' }} />

          {/* Slow scan line */}
          <motion.div className="absolute left-0 right-0 h-px pointer-events-none z-10"
            style={{ background: 'linear-gradient(90deg,transparent,rgba(34,211,238,0.12),transparent)' }}
            animate={{ top: ['0%', '100%'] }} transition={{ duration: 10, repeat: Infinity, ease: 'linear' }} />

          {/* HUD corners */}
          {['top-0 left-0 border-t-2 border-l-2','top-0 right-0 border-t-2 border-r-2','bottom-0 left-0 border-b-2 border-l-2','bottom-0 right-0 border-b-2 border-r-2'].map((cls, i) => (
            <div key={i} className={`absolute w-10 h-10 ${cls} border-orange-500/25 pointer-events-none z-20 m-3`} />
          ))}

          {/* ── Top bar ──────────────────────────────────────────────────────── */}
          <PageHeader
            title="Home Control"
            onNavigateHome={onNavigateHome}
            accent="orange"
            right={
              <>
                {loading && <span className="font-mono text-[8px] text-white/20 animate-pulse uppercase tracking-wider">Syncing…</span>}
                {error   && <span className="font-mono text-[8px] text-red-400/60 max-w-xs truncate">{error}</span>}
                {haUrl && (
                  <button onClick={() => setShowWizard(true)}
                    className="flex items-center gap-1.5 px-3 h-6 font-mono text-[8px] uppercase tracking-wider rounded"
                    style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)', color: '#4ade80' }}>
                    <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                    {onCount} active · {allCount} total
                  </button>
                )}
                <div className="text-right">
                  <div className="font-mono text-sm font-bold text-white leading-none">{clock}</div>
                  <div className="font-mono text-[8px] text-cyan-400/60 uppercase tracking-widest mt-0.5">{today.split(',')[0]}, {today.split(',')[1]?.trim()}</div>
                </div>
              </>
            }
          />

          {/* ── Body ─────────────────────────────────────────────────────────── */}
          <div className="relative z-10 flex flex-1 min-h-0">
            <Sidebar view={navView} setView={setNavView} />

            {/* Main content */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <AnimatePresence mode="wait">

                {/* Dashboard view */}
                {navView === 'dashboard' && (
                  <motion.div key="dash" className="h-full overflow-y-auto p-5 scrollbar-hide"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <div className="grid gap-4 h-full"
                      style={{ gridTemplateColumns: '220px 1fr 1fr 220px', gridTemplateRows: 'minmax(240px,1fr) minmax(240px,1fr) auto', gridTemplateAreas: '"overview tv tv rightcol" "devices printer quickactions rightcol" "netbar netbar netbar ."' }}>
                      <div style={{ gridArea: 'overview' }}>
                        <HomeOverviewPanel entities={entities} />
                      </div>
                      <div style={{ gridArea: 'tv' }}>
                        <TVPanel entities={entities} onCallService={callService} />
                      </div>
                      {/* Right column: Weather stacked above Security */}
                      <div style={{ gridArea: 'rightcol' }} className="flex flex-col gap-4">
                        <WeatherPanel />
                        <SecurityWidget />
                      </div>
                      <div style={{ gridArea: 'devices' }}>
                        <DevicesPanel entities={entities} onCallService={callService} />
                      </div>
                      <div style={{ gridArea: 'printer' }}>
                        <PrinterPanel entities={entities} />
                      </div>
                      <div style={{ gridArea: 'quickactions' }}>
                        <QuickActionsPanel />
                      </div>
                      <div style={{ gridArea: 'netbar' }}>
                        <NetworkBar entities={entities} />
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Devices view */}
                {navView === 'devices' && (
                  <motion.div key="devices" className="h-full flex flex-col"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <AllDevicesView entities={entities} onCallService={callService} onSetBrightness={handleSetBrightness} />
                  </motion.div>
                )}

                {/* Security view */}
                {navView === 'security' && (
                  <motion.div key="sec" className="h-full p-5"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <div className="grid grid-cols-2 gap-4 h-full">
                      <SecurityPanel />
                      <Panel title="Alert Log" accent="#22d3ee" accentRgb="34,211,238" className="h-full">
                        <div className="flex-1 flex items-center justify-center">
                          <div className="text-center">
                            <div className="text-3xl mb-2 opacity-20">🛡</div>
                            <div className="font-mono text-[10px] text-white/20 uppercase tracking-widest">All Systems Clear</div>
                          </div>
                        </div>
                      </Panel>
                    </div>
                  </motion.div>
                )}

                {/* Network view */}
                {navView === 'network' && (
                  <motion.div key="net" className="h-full p-5"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <div className="grid grid-cols-2 gap-4 h-full">
                      <NetworkPanel entities={entities} />
                      <Panel title="Connected Devices" accent="#22d3ee" accentRgb="34,211,238" className="h-full">
                        <div className="flex flex-col gap-2 flex-1">
                          {entities.filter((e) => e.entity_id.includes('cgm') || e.entity_id.includes('wan')).map((e) => (
                            <div key={e.entity_id} className="flex items-center justify-between py-1.5 px-2 rounded"
                              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <span className="font-mono text-[9px] text-white/50 truncate">{getFriendlyName(e)}</span>
                              <span className="font-mono text-[9px] ml-2 shrink-0" style={{ color: e.state === 'on' ? '#4ade80' : 'rgba(255,255,255,0.3)' }}>{e.state}</span>
                            </div>
                          ))}
                        </div>
                      </Panel>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>
          </div>

          {/* ── Bottom status bar ─────────────────────────────────────────────── */}
          <div className="relative z-10 flex items-center justify-between px-6 py-2 shrink-0 border-t"
            style={{ background: 'rgba(2,4,10,0.85)', borderColor: 'rgba(34,211,238,0.05)', backdropFilter: 'blur(8px)' }}>
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-[8px] text-emerald-400/70 uppercase tracking-widest">All Systems Operational</span>
            </div>
            <div className="flex items-center gap-5">
              <div className="font-mono text-[8px] text-white/20 uppercase tracking-widest">
                Network · <span className="text-emerald-400/60">Stable</span>
              </div>
              <div className="font-mono text-[8px] text-white/15 uppercase tracking-widest">
                {haUrl ? new URL(haUrl).hostname : '—'}
              </div>
            </div>
          </div>

        </motion.div>
      )}
    </AnimatePresence>
  );
}
