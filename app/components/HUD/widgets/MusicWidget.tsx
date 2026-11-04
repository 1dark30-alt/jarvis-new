'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// ── FFT Grid canvas ────────────────────────────────────────────────────────
const GRID_COLS = 20;
const GRID_ROWS = 6;
const CELL_GAP  = 2;

// Interpolate cyan → blue → purple → pink based on column position (0..1)
function colColor(t: number): [number, number, number] {
  // stops: cyan(0) → blue(0.33) → purple(0.6) → hot-pink(1)
  const stops: [number, [number,number,number]][] = [
    [0.00, [0,   220, 255]],
    [0.25, [30,  120, 255]],
    [0.50, [130, 40,  255]],
    [0.72, [210, 40,  230]],
    [1.00, [255, 10,  110]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function drawFFTGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fft: Uint8Array | null,
  now: number,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.filter = 'blur(6px)';

  const cellW = (w - CELL_GAP * (GRID_COLS + 1)) / GRID_COLS;
  const cellH = (h - CELL_GAP * (GRID_ROWS + 1)) / GRID_ROWS;
  const step  = fft ? Math.floor(fft.length / (GRID_COLS * GRID_ROWS)) : 0;

  for (let col = 0; col < GRID_COLS; col++) {
    const [r, g, b] = colColor(col / (GRID_COLS - 1));

    // One frequency bin per column
    let amp = 0;
    if (fft) {
      const idx = Math.floor(col * fft.length / GRID_COLS);
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += fft[Math.min(idx + k, fft.length - 1)];
      amp = Math.pow(sum / (3 * 255), 0.75) * 2.2;
    }

    for (let row = 0; row < GRID_ROWS; row++) {
      // row 0 = bottom, row GRID_ROWS-1 = top
      // threshold: bottom row lights up first, top row needs more amplitude
      const threshold = (row + 0.5) / GRID_ROWS;
      const idle = 0.03 + 0.015 * Math.sin(now / 1400 + col * 0.5);
      const alpha = amp >= threshold ? Math.min(1, amp - threshold * 0.3 + 0.6) : idle;

      const x = CELL_GAP + col * (cellW + CELL_GAP);
      const y = h - CELL_GAP - (row + 1) * (cellH + CELL_GAP) + CELL_GAP;

      ctx.beginPath();
      ctx.roundRect(x, y, cellW, cellH, 3);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      ctx.fill();
    }
  }
  ctx.restore();
}

async function acquireAudioStream(): Promise<MediaStream | null> {
  const el = window as Window & { electron?: { getAudioSourceId?: () => Promise<string | null> } };

  // 1. Try desktopCapturer system audio (modern Electron constraint format, no `mandatory` wrapper)
  if (el.electron?.getAudioSourceId) {
    try {
      const sourceId = await el.electron.getAudioSourceId();
      if (sourceId) {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: {
            // @ts-expect-error Electron/Chromium non-standard fields
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          },
          video: {
            // @ts-expect-error Electron/Chromium non-standard fields
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            width: 1, height: 1,
          },
        });
        s.getVideoTracks().forEach(t => t.stop());
        // Verify we actually got audio data (macOS sometimes returns a silent track)
        const audioTracks = s.getAudioTracks();
        if (audioTracks.length > 0) {
          console.log('[MusicWidget] Using desktopCapturer audio');
          return s;
        }
        s.getTracks().forEach(t => t.stop());
      }
    } catch (err) {
      console.warn('[MusicWidget] desktopCapturer audio failed, trying mic:', err);
    }
  }

  // 2. Fallback: microphone — always works, picks up music through speakers
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('[MusicWidget] Using microphone audio');
    return s;
  } catch (err) {
    console.warn('[MusicWidget] Microphone fallback failed:', err);
    return null;
  }
}

function useFFTCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let fftData: Uint8Array<ArrayBuffer> | null = null;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let stopped = false;

    const frame = (now: number) => {
      if (stopped) return;
      rafId = requestAnimationFrame(frame);
      if (!canvasRef.current) return;
      if (analyser && fftData) analyser.getByteFrequencyData(fftData);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawFFTGrid(ctx, canvas.width, canvas.height, fftData, now);
    };

    // Start idle animation immediately
    rafId = requestAnimationFrame(frame);

    acquireAudioStream().then((s) => {
      if (stopped || !s) return;
      stream    = s;
      audioCtx  = new AudioContext();
      analyser  = audioCtx.createAnalyser();
      analyser.fftSize              = 2048;
      analyser.smoothingTimeConstant = 0.75;
      fftData   = new Uint8Array(analyser.frequencyBinCount);
      source    = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      source?.disconnect();
      audioCtx?.close();
      stream?.getTracks().forEach(t => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface TrackInfo {
  app: string; title: string; artist: string; album: string;
  artworkUrl: string; position: number; duration: number; isPlaying: boolean;
}

async function fetchNowPlaying(): Promise<TrackInfo | null> {
  try { const r = await fetch('/api/music'); const d = await r.json(); return d.error ? null : d; }
  catch { return null; }
}
async function sendCommand(cmd: string) {
  try { await fetch('/api/music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) }); }
  catch {}
}
function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${(s % 60).toString().padStart(2, '0')}`; }

const DISC = 190; // record diameter px

export function MusicWidget() {
  const [track, setTrack]   = useState<TrackInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotDeg, setRotDeg] = useState(0);
  const rotRef      = useRef(0);
  const rafRef      = useRef<number>(0);
  const lastRef     = useRef<number>(0);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const fftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useFFTCanvas(fftCanvasRef);

  const refresh = useCallback(async () => {
    const d = await fetchNowPlaying(); setTrack(d); setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  useEffect(() => {
    const up = (e: Event) => { const d = (e as CustomEvent<TrackInfo>).detail; if (d) setTrack(d); };
    const re = () => refresh();
    window.addEventListener('jarvis:music:update', up);
    window.addEventListener('jarvis:music:refresh', re);
    return () => { window.removeEventListener('jarvis:music:update', up); window.removeEventListener('jarvis:music:refresh', re); };
  }, [refresh]);

  const isPlaying = track?.isPlaying ?? false;
  useEffect(() => {
    const DEG_PER_MS = 360 / 20000;
    const tick = (ts: number) => {
      if (lastRef.current === 0) lastRef.current = ts;
      if (isPlaying) { rotRef.current = (rotRef.current + (ts - lastRef.current) * DEG_PER_MS) % 360; setRotDeg(rotRef.current); }
      lastRef.current = ts;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); lastRef.current = 0; };
  }, [isPlaying]);

  const handleCmd = async (cmd: string) => {
    await sendCommand(cmd);
    if (['playpause','play','pause'].includes(cmd))
      setTrack(p => p ? { ...p, isPlaying: cmd === 'play' ? true : cmd === 'pause' ? false : !p.isPlaying } : p);
    setTimeout(refresh, 600);
  };

  // Color transitions: 0°=blue@10/pink@2, 180°=swapped
  const BLUE = { r: 0, g: 200, b: 255 };
  const PINK = { r: 255, g: 20,  b: 230 };
  const lp   = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const t    = (1 - Math.cos((((rotDeg % 360) + 360) % 360) * Math.PI / 180)) / 2;
  const c10  = { r: lp(BLUE.r, PINK.r, t), g: lp(BLUE.g, PINK.g, t), b: lp(BLUE.b, PINK.b, t) };
  const c2   = { r: lp(PINK.r, BLUE.r, t), g: lp(PINK.g, BLUE.g, t), b: lp(PINK.b, BLUE.b, t) };

  const progress = track && track.duration > 0 ? Math.min(100, (track.position / track.duration) * 100) : 0;

  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-2">
      <div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
    </div>
  );

  if (!track) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
      <span className="font-mono text-[10px] text-white/25 uppercase tracking-widest">Nothing playing</span>
    </div>
  );

  return (
    <div className="flex flex-col" style={{ gap: 0 }}>
      <style>{`
        @keyframes mw-shimmer  { 0%{opacity:.5} 33%{opacity:.95} 67%{opacity:.95} 100%{opacity:.5} }
        @keyframes mw-shimmer2 { 0%{opacity:.55} 30%{opacity:1} 70%{opacity:1} 100%{opacity:.55} }
      `}</style>

      {/* ── Mini record ── */}
      <div className="flex justify-center" style={{ height: DISC, marginTop: 6 }}>
        <div style={{ width: DISC, height: DISC, position: 'relative' }}>
          {/* Ambient glow */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: `radial-gradient(ellipse at 32% 50%, rgba(${c10.r},${c10.g},${c10.b},0.2) 0%, transparent 55%), radial-gradient(ellipse at 68% 50%, rgba(${c2.r},${c2.g},${c2.b},0.2) 0%, transparent 55%)`,
            filter: 'blur(12px)', transform: 'scale(1.2)',
          }} />

          {/* Circle clip */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden',
            boxShadow: '0 6px 40px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.05)',
          }}>
            {/* Spinning image */}
            <div style={{ position: 'absolute', inset: 0, transform: `rotate(${rotDeg}deg)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/record.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>

            {/* Spinning album art — 50% of record, centered */}
            {track.artworkUrl && (
              <div style={{
                position: 'absolute',
                width: '50%', height: '50%',
                top: '25%', left: '25%',
                borderRadius: '50%',
                overflow: 'hidden',
                transform: `rotate(${rotDeg}deg)`,
                boxShadow: '0 0 0 1.5px rgba(255,255,255,0.12), 0 2px 12px rgba(0,0,0,0.7)',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={track.artworkUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
              </div>
            )}

            {/* Vinyl hole */}
            <div style={{
              position: 'absolute',
              width: 14, height: 14,
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: '#000',
              boxShadow: 'inset 0 1px 3px rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.06)',
              zIndex: 10,
              pointerEvents: 'none',
            }} />

            {/* 10 o'clock reflection */}
            <div style={{
              position: 'absolute', top: '8%', left: '4%',
              width: '58%', height: '34%',
              transform: 'rotate(38deg)', transformOrigin: 'left center',
              background: `radial-gradient(ellipse 75% 38% at 18% 50%, rgba(${c10.r},${c10.g},${c10.b},0.85) 0%, rgba(${c10.r},${c10.g},${c10.b},0.4) 40%, transparent 80%)`,
              filter: 'blur(7px)', animation: 'mw-shimmer 3.9s ease-in-out infinite', pointerEvents: 'none',
            }} />

            {/* 2 o'clock reflection */}
            <div style={{
              position: 'absolute', top: '8%', right: '4%',
              width: '58%', height: '34%',
              transform: 'rotate(-38deg)', transformOrigin: 'right center',
              background: `radial-gradient(ellipse 75% 38% at 82% 50%, rgba(${c2.r},${c2.g},${c2.b},0.85) 0%, rgba(${c2.r},${c2.g},${c2.b},0.4) 40%, transparent 80%)`,
              filter: 'blur(7px)', animation: 'mw-shimmer2 4.65s ease-in-out infinite', pointerEvents: 'none',
            }} />

            {/* Edge vignette */}
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
          </div>
        </div>
      </div>

      {/* ── Control panel — overlaps record bottom ── */}
      <div style={{ marginTop: -85, position: 'relative', zIndex: 10 }}>
        <div className="relative px-4 py-3 flex flex-col gap-2" style={{
          background: 'rgba(0,10,20,0.82)',
          border: '1px solid rgba(34,211,238,0.3)',
          backdropFilter: 'blur(20px)',
          clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))',
          boxShadow: '0 0 18px rgba(34,211,238,0.1)',
        }}>

          {/* FFT canvas — bottom half of panel */}
          <canvas
            ref={fftCanvasRef}
            width={280} height={60}
            className="absolute bottom-0 left-0 right-0 w-full pointer-events-none"
            style={{ height: '50%', opacity: 0.9, mixBlendMode: 'screen' }}
          />

          {/* Cut-corner accent lines */}
          <div className="absolute top-0 right-0 w-[16px] h-[1px] bg-cyan-400/80 origin-right rotate-45 translate-y-[8px] -translate-x-[3px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-[16px] h-[1px] bg-cyan-400/80 origin-left rotate-45 -translate-y-[8px] translate-x-[3px] pointer-events-none" />
          {/* Top cyan glow line */}
          <div className="absolute top-0 left-4 right-4 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg,transparent,rgba(34,211,238,0.6),rgba(180,40,255,0.5),transparent)' }} />

          {/* Track info */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-white text-[14px] font-semibold truncate leading-tight">{track.title}</p>
              <p className="text-[13px] truncate" style={{ color: 'rgba(210,80,255,0.9)' }}>{track.artist}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="w-full h-[2px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#22d3ee,#c840ff)' }} />
            </div>
            <div className="flex justify-between mt-0.5 font-mono text-[10px] text-white/25">
              <span>{fmt(track.position)}</span><span>{fmt(track.duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => handleCmd('volume_down')} className="text-white/30 hover:text-white/60 transition-colors">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/></svg>
            </button>
            <button onClick={() => handleCmd('previous')} className="text-white/50 hover:text-white transition-colors">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
            </button>
            <button onClick={() => handleCmd('playpause')}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105"
              style={{ background: 'linear-gradient(135deg,rgba(34,211,238,0.18),rgba(200,64,255,0.18))', border: '1.5px solid rgba(34,211,238,0.45)', boxShadow: '0 0 14px rgba(34,211,238,0.2)' }}>
              {track.isPlaying
                ? <svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                : <svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M8 5v14l11-7z"/></svg>}
            </button>
            <button onClick={() => handleCmd('next')} className="text-white/50 hover:text-white transition-colors">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 6h2v12h-2zm-3.5 6L4 6v12z"/></svg>
            </button>
            <button onClick={() => handleCmd('volume_up')} className="text-white/30 hover:text-white/60 transition-colors">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
