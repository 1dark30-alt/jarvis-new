'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

interface TrackInfo {
  app: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  position: number;
  duration: number;
  isPlaying: boolean;
}

async function fetchNowPlaying(): Promise<TrackInfo | null> {
  try {
    const res = await fetch('/api/music');
    const data = await res.json();
    if (data.error) return null;
    return data as TrackInfo;
  } catch { return null; }
}

async function sendCommand(command: string, value?: number) {
  try {
    await fetch('/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, value }),
    });
  } catch {}
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props { onNavigateHome: () => void }

export function MusicPage({ onNavigateHome }: Props) {
  const [track, setTrack]   = useState<TrackInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // rotation angle (degrees) accumulated while playing
  const rotRef      = useRef(0);
  const rafRef      = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [rotDeg, setRotDeg] = useState(0);

  const refresh = useCallback(async () => {
    const data = await fetchNowPlaying();
    setTrack(data);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); pollRef.current = setInterval(refresh, 6000); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [refresh]);

  useEffect(() => {
    const onUpdate  = (e: Event) => { const d = (e as CustomEvent<TrackInfo>).detail; if (d) setTrack(d); };
    const onRefresh = () => refresh();
    window.addEventListener('jarvis:music:update', onUpdate);
    window.addEventListener('jarvis:music:refresh', onRefresh);
    return () => { window.removeEventListener('jarvis:music:update', onUpdate); window.removeEventListener('jarvis:music:refresh', onRefresh); };
  }, [refresh]);

  // Smooth rotation RAF — 33 RPM ≈ 0.198 deg/frame @60fps (we use 20s full turn = 18°/s)
  const isPlaying = track?.isPlaying ?? false;
  useEffect(() => {
    const DEG_PER_MS = 360 / 20000; // 20s per revolution

    const tick = (ts: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = ts;
      if (isPlaying) {
        const delta = ts - lastTimeRef.current;
        rotRef.current = (rotRef.current + delta * DEG_PER_MS) % 360;
        setRotDeg(rotRef.current);
      }
      lastTimeRef.current = ts;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); lastTimeRef.current = 0; };
  }, [isPlaying]);

  const handleCommand = async (cmd: string) => {
    await sendCommand(cmd);
    if (cmd === 'playpause' || cmd === 'play' || cmd === 'pause') {
      setTrack(prev => prev ? { ...prev, isPlaying: cmd === 'play' ? true : cmd === 'pause' ? false : !prev.isPlaying } : prev);
    }
    setTimeout(refresh, 600);
  };

  const progress = track && track.duration > 0 ? Math.min(100, (track.position / track.duration) * 100) : 0;

  // Reflection color transitions: 0°=blue@10/pink@2, 180°=pink@10/blue@2
  const BLUE = { r: 0,   g: 200, b: 255 };
  const PINK = { r: 255, g: 20,  b: 230 };
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const t = (1 - Math.cos((((rotDeg % 360) + 360) % 360) * Math.PI / 180)) / 2;
  const c10 = { r: lerp(BLUE.r, PINK.r, t), g: lerp(BLUE.g, PINK.g, t), b: lerp(BLUE.b, PINK.b, t) };
  const c2  = { r: lerp(PINK.r, BLUE.r, t), g: lerp(PINK.g, BLUE.g, t), b: lerp(PINK.b, BLUE.b, t) };

  return (
    <motion.div
      className="fixed inset-0 z-[50] overflow-hidden flex flex-col"
      style={{ background: '#030811' }}
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* CSS for shimmer keyframes */}
      <style>{`
        @keyframes shimmer-glow {
          0%,100% { opacity: 0.55; }
          50%      { opacity: 1.0;  }
        }
        @keyframes shimmer-glow2 {
          0%,100% { opacity: 0.6;  }
          50%      { opacity: 0.95; }
        }
        @keyframes scanline-music {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
      `}</style>

      {/* Dot grid background */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'radial-gradient(circle, rgba(34,211,238,0.18) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }} />

      {/* Scan line */}
      <div className="absolute inset-x-0 h-px pointer-events-none z-[2]"
        style={{ background: 'linear-gradient(90deg,transparent,rgba(34,211,238,0.35),transparent)', animation: 'scanline-music 7s linear infinite' }} />

      {/* HUD corner brackets */}
      {[['top-3 left-3','border-t border-l'],['top-3 right-3','border-t border-r'],['bottom-3 left-3','border-b border-l'],['bottom-3 right-3','border-b border-r']].map(([pos, border]) => (
        <div key={pos} className={`absolute ${pos} w-6 h-6 ${border} border-cyan-400/40 pointer-events-none`} />
      ))}

      <PageHeader title="Music" onNavigateHome={onNavigateHome} />

      {/* Main content */}
      <div className="flex-1 relative overflow-hidden">

          {/* ── Record: centered, fixed top ── */}
          <div className="absolute pointer-events-none" style={{ width: 520, height: 520, top: 20, left: '50%', transform: 'translateX(-50%)' }}>

            {/* Wide ambient glow behind the record */}
            <div className="absolute inset-0 pointer-events-none" style={{
              borderRadius: '50%',
              background: 'radial-gradient(ellipse at 32% 50%, rgba(0,140,255,0.18) 0%, transparent 55%), radial-gradient(ellipse at 68% 50%, rgba(255,0,180,0.18) 0%, transparent 55%)',
              filter: 'blur(28px)',
              transform: 'scale(1.15)',
            }} />

            {/* Spinning record — clipped circle */}
            <div className="absolute inset-0 rounded-full overflow-hidden"
              style={{ boxShadow: '0 12px 80px rgba(0,0,0,0.9), 0 0 0 1.5px rgba(255,255,255,0.05)' }}>

              {/* Record image — rotates */}
              <div className="absolute inset-0" style={{ transform: `rotate(${rotDeg}deg)` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/record.png" alt="record" className="w-full h-full object-cover" />
              </div>

              {/* ── Reflection at 10 o'clock — FIXED, color transitions blue↔pink ── */}
              <div className="absolute pointer-events-none" style={{
                top: '8%', left: '4%',
                width: '58%', height: '34%',
                transform: 'rotate(38deg)',
                transformOrigin: 'left center',
                background: `radial-gradient(ellipse 75% 38% at 18% 50%, rgba(${c10.r},${c10.g},${c10.b},0.85) 0%, rgba(${c10.r},${c10.g},${c10.b},0.4) 40%, transparent 80%)`,
                filter: 'blur(14px)',
                animation: 'shimmer-glow 2.6s ease-in-out infinite',
              }} />

              {/* ── Reflection at 2 o'clock — FIXED, color transitions pink↔blue ── */}
              <div className="absolute pointer-events-none" style={{
                top: '8%', right: '4%',
                width: '58%', height: '34%',
                transform: 'rotate(-38deg)',
                transformOrigin: 'right center',
                background: `radial-gradient(ellipse 75% 38% at 82% 50%, rgba(${c2.r},${c2.g},${c2.b},0.85) 0%, rgba(${c2.r},${c2.g},${c2.b},0.4) 40%, transparent 80%)`,
                filter: 'blur(14px)',
                animation: 'shimmer-glow2 3.1s ease-in-out infinite',
              }} />

              {/* Edge vignette */}
              <div className="absolute inset-0 pointer-events-none rounded-full"
                style={{ boxShadow: 'inset 0 0 90px rgba(0,0,0,0.55)' }} />
            </div>
          </div>

          {/* ── Panel: top = record_top(20) + record_size(520) - overlap(280) = 260px ── */}
          <div className="absolute z-10" style={{ top: 310, left: '50%', transform: 'translateX(-50%)', width: 520 }}>
          <div className="relative rounded-2xl px-8 py-7 flex flex-col gap-5" style={{
            background: 'rgba(3,8,17,0.25)',
            border: '1px solid rgba(34,211,238,0.18)',
            backdropFilter: 'blur(32px)',
            boxShadow: '0 -24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}>
            {/* Top glow line */}
            <div className="absolute top-0 left-8 right-8 h-px rounded-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(34,211,238,0.5), rgba(220,40,220,0.5), transparent)' }} />

            {loading && (
              <div className="flex items-center justify-center py-6 gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin" />
                <span className="font-mono text-xs text-white/30 uppercase tracking-widest">Connecting…</span>
              </div>
            )}

            {!loading && !track && (
              <div className="flex flex-col items-center justify-center py-6 gap-3">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20">
                  <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <span className="font-mono text-xs text-white/25 uppercase tracking-widest">Nothing playing</span>
              </div>
            )}

            {!loading && track && (
              <>
                {/* Track info */}
                <div className="flex items-center gap-4">
                  {/* Album art */}
                  <div className="shrink-0 w-14 h-14 rounded-lg overflow-hidden relative"
                    style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}>
                    {track.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={track.artworkUrl} alt="art" className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20">
                          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                        </svg>
                      </div>
                    )}
                    {/* Playing bars */}
                    {track.isPlaying && (
                      <div className="absolute bottom-0 inset-x-0 flex justify-center gap-[2px] pb-1">
                        {[0,1,2].map(i => (
                          <div key={i} className="w-[3px] rounded-full bg-cyan-400"
                            style={{ height: '8px', animation: 'music-bar 0.8s ease-in-out infinite', animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm leading-tight truncate">{track.title}</p>
                    <p className="text-[13px] truncate mt-0.5" style={{ color: 'rgba(220,100,255,0.9)' }}>{track.artist}</p>
                    <p className="text-white/35 text-xs truncate mt-0.5">{track.album}</p>
                  </div>

                  {/* App badge */}
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest px-2 py-1 rounded"
                    style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', color: 'rgba(34,211,238,0.7)' }}>
                    {track.app}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="flex flex-col gap-1.5">
                  <div className="relative w-full h-1 rounded-full overflow-hidden cursor-pointer group"
                    style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #22d3ee, #c840ff)' }} />
                    {/* Glow dot at tip */}
                    <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ left: `calc(${progress}% - 5px)`, background: '#fff', boxShadow: '0 0 6px #22d3ee' }} />
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-white/25">
                    <span>{formatTime(track.position)}</span>
                    <span>{formatTime(track.duration)}</span>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-center gap-6">
                  {/* Volume down */}
                  <button onClick={() => handleCommand('volume_down')}
                    className="text-white/30 hover:text-white/70 transition-colors">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <line x1="23" y1="9" x2="17" y2="15"/>
                    </svg>
                  </button>

                  {/* Previous */}
                  <button onClick={() => handleCommand('previous')}
                    className="text-white/50 hover:text-white transition-colors">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
                    </svg>
                  </button>

                  {/* Play/Pause */}
                  <button onClick={() => handleCommand('playpause')}
                    className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105"
                    style={{
                      background: 'linear-gradient(135deg, rgba(34,211,238,0.2), rgba(200,64,255,0.2))',
                      border: '1.5px solid rgba(34,211,238,0.5)',
                      boxShadow: '0 0 24px rgba(34,211,238,0.25), 0 0 24px rgba(200,64,255,0.2)',
                    }}>
                    {track.isPlaying ? (
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    )}
                  </button>

                  {/* Next */}
                  <button onClick={() => handleCommand('next')}
                    className="text-white/50 hover:text-white transition-colors">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M16 6h2v12h-2zm-3.5 6L4 6v12z"/>
                    </svg>
                  </button>

                  {/* Volume up */}
                  <button onClick={() => handleCommand('volume_up')}
                    className="text-white/30 hover:text-white/70 transition-colors">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>{/* end panel wrapper */}
      </div>{/* end flex-1 outer */}
    </motion.div>
  );
}
