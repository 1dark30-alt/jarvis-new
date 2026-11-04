'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getCachedSetting } from '../../../lib/serverSettings';

interface HAEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

function loadHA() {
  if (typeof window === 'undefined') return { url: '', token: '' };
  return {
    url:   getCachedSetting('jarvis_ha_url'),
    token: getCachedSetting('jarvis_ha_token'),
  };
}

export function TVWidget() {
  const [tv, setTv] = useState<HAEntity | null>(null);
  const [volume, setVolume] = useState(28);
  const [dragging, setDragging] = useState(false);
  const [sourceOffset, setSourceOffset] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTV = useCallback(async () => {
    const { url, token } = loadHA();
    if (!url || !token) return;
    try {
      const res = await fetch(`/api/home-assistant?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}&path=/api/states`);
      if (!res.ok) return;
      const states = await res.json() as HAEntity[];
      const found = states.find((e) => e.entity_id.startsWith('media_player.'));
      if (found) {
        setTv(found);
        if (found.attributes.volume_level != null) setVolume(Math.round((found.attributes.volume_level as number) * 100));
      }
    } catch {}
  }, []);

  useEffect(() => { fetchTV(); pollRef.current = setInterval(fetchTV, 5000); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [fetchTV]);

  const callService = async (domain: string, service: string, data: Record<string, unknown> = {}) => {
    const { url, token } = loadHA();
    if (!url || !token || !tv) return;
    await fetch('/api/home-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, token, domain, service, entity_id: tv.entity_id, ...data }) });
    setTimeout(fetchTV, 600);
  };

  const isOn = tv && !['off', 'unavailable', 'unknown', 'standby'].includes(tv.state);
  const rawSources = (tv?.attributes.source_list as string[] | undefined) ?? [];
  const PREFERRED = ['Home', 'HDMI 1', 'Netflix', 'Hulu', 'Disney+'];
  const sources = [...PREFERRED.filter((p) => rawSources.some((s) => s.toLowerCase() === p.toLowerCase())),
                   ...rawSources.filter((s) => !PREFERRED.some((p) => p.toLowerCase() === s.toLowerCase()))];
  const currentSource = tv?.attributes.source as string | undefined;

  // Volume slider
  const handleTrackClick = (e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newVol = Math.round(pct * 100);
    setVolume(newVol);
    callService('media_player', 'volume_set', { volume_level: newVol / 100 });
  };

  const visibleSources = sources.slice(sourceOffset, sourceOffset + 4);

  if (!tv) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-mono text-[10px] text-white/25">No TV found in Home Assistant</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-white text-xs font-mono">
      {/* TV drawing + status */}
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 80 56" width="80" height="56" fill="none">
          <rect x="2" y="2" width="76" height="48" rx="4" stroke="rgba(255,255,255,0.7)" strokeWidth="2"/>
          <rect x="8" y="8" width="64" height="36" rx="2" fill="rgba(34,211,238,0.06)" stroke="rgba(34,211,238,0.3)" strokeWidth="1"/>
          <line x1="35" y1="50" x2="30" y2="56" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
          <line x1="45" y1="50" x2="50" y2="56" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
          <line x1="28" y1="56" x2="52" y2="56" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
        </svg>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: isOn ? '#22d3ee' : 'rgba(255,255,255,0.2)', boxShadow: isOn ? '0 0 6px #22d3ee' : 'none' }} />
            <span className="text-[10px]" style={{ color: isOn ? '#22d3ee' : 'rgba(255,255,255,0.4)' }}>{isOn ? 'ON' : 'OFF'}</span>
          </div>
          {currentSource && <span className="text-[9px] text-white/40 truncate max-w-[100px]">{currentSource}</span>}
        </div>
        {/* Power button */}
        <button onClick={() => callService('media_player', isOn ? 'turn_off' : 'turn_on')}
          className="ml-auto w-10 h-10 rounded-full flex items-center justify-center transition-all hover:brightness-125"
          style={{ background: isOn ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.07)', border: `2px solid ${isOn ? '#22d3ee' : 'rgba(255,255,255,0.2)'}`, boxShadow: isOn ? '0 0 12px rgba(34,211,238,0.4)' : 'none' }}>
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke={isOn ? '#22d3ee' : 'rgba(255,255,255,0.5)'} strokeWidth="1.8" strokeLinecap="round">
            <path d="M10 3v6"/><path d="M7 4.8A7 7 0 1 0 13 4.8"/>
          </svg>
        </button>
      </div>

      {/* Source row */}
      <div className="flex items-center gap-1">
        <button onClick={() => setSourceOffset(Math.max(0, sourceOffset - 1))} disabled={sourceOffset === 0}
          className="w-5 h-5 flex items-center justify-center rounded text-white/40 hover:text-white/70 disabled:opacity-20">‹</button>
        <div className="flex gap-1 flex-1 overflow-hidden">
          {visibleSources.map((src, idx) => (
            <button key={`${src}-${idx}`} onClick={() => callService('media_player', 'select_source', { source: src })}
              className="flex-1 py-1 text-[9px] font-semibold uppercase tracking-wider truncate rounded transition-all"
              style={{ background: currentSource === src ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.06)', border: `1px solid ${currentSource === src ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.12)'}`, color: currentSource === src ? '#22d3ee' : 'rgba(255,255,255,0.6)' }}>
              {src}
            </button>
          ))}
        </div>
        <button onClick={() => setSourceOffset(Math.min(sources.length - 4, sourceOffset + 1))} disabled={sourceOffset >= sources.length - 4}
          className="w-5 h-5 flex items-center justify-center rounded text-white/40 hover:text-white/70 disabled:opacity-20">›</button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2">
        <span className="text-base font-bold w-8 text-right" style={{ color: '#22d3ee' }}>{volume}</span>
        <div ref={trackRef} className="flex-1 h-1.5 rounded-full relative cursor-pointer" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={handleTrackClick}>
          <div className="h-full rounded-full" style={{ width: `${volume}%`, background: 'linear-gradient(90deg,rgba(34,211,238,0.5),#22d3ee)' }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white transition-all"
            style={{ left: `calc(${volume}% - 7px)`, background: '#22d3ee', boxShadow: '0 0 6px rgba(34,211,238,0.8)' }} />
        </div>
        <button onClick={() => { const v = Math.max(0, volume - 5); setVolume(v); callService('media_player', 'volume_set', { volume_level: v / 100 }); }}
          className="w-6 h-6 rounded flex items-center justify-center text-white/60 hover:text-white" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>−</button>
        <button onClick={() => { const v = Math.min(100, volume + 5); setVolume(v); callService('media_player', 'volume_set', { volume_level: v / 100 }); }}
          className="w-6 h-6 rounded flex items-center justify-center text-white/60 hover:text-white" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>+</button>
      </div>
    </div>
  );
}
