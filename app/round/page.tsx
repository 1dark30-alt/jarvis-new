'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Settings {
  elevenLabsAgentId?: string;
  elevenLabsFirstMessage?: string;
  initialPrompt?: string;
}

type Status = 'idle' | 'listening' | 'active' | 'error';

// ─── Ring definitions ─────────────────────────────────────────────────────────
// rFrac = base radius as fraction of min(w,h)
// ampScale = px to expand per unit amplitude (at dpr=1)
// speed = deg/s rotation
// lw = line width (logical px)
// alpha = base opacity (multiplied by glow factor at runtime)

const RINGS = [
  { rFrac: 0.38, ampScale: 55,  speed:  18,  lw: 1.5, alpha: 0.55 },
  { rFrac: 0.44, ampScale: 40,  speed: -11,  lw: 1.0, alpha: 0.35 },
  { rFrac: 0.48, ampScale: 75,  speed:   7,  lw: 2.0, alpha: 0.70 },
  { rFrac: 0.52, ampScale: 28,  speed: -25,  lw: 0.8, alpha: 0.25 },
] as const;

// ─── Inner component (needs ConversationProvider context) ─────────────────────

function RoundDisplay() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError]   = useState<string | null>(null);
  const [showUI, setShowUI] = useState(true);

  const statusRef = useRef<Status>('idle');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const rotRef    = useRef<number[]>(RINGS.map(() => 0));
  const ampRef    = useRef<number>(0);
  const lastTRef  = useRef<number>(0);
  const uiTimerRef= useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { statusRef.current = status; }, [status]);

  // ── ElevenLabs SDK ──────────────────────────────────────────────────────────

  const conv = useConversation({
    onConnect:    () => { setStatus('active'); setError(null); },
    onDisconnect: () => { if (statusRef.current !== 'idle') setStatus('idle'); },
    onError:      (e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setError(msg);
    },
  });

  // ── Canvas draw loop ────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx)   { rafRef.current = requestAnimationFrame(draw); return; }

    const now = performance.now();
    const dt  = Math.min((now - (lastTRef.current || now)) / 1000, 0.05);
    lastTRef.current = now;

    // Amplitude: use SDK volume when active, decay to 0 otherwise
    let rawAmp = 0;
    if (statusRef.current === 'active') {
      rawAmp = conv.getOutputVolume();
    }
    const target = Math.min(rawAmp * 1.4, 1);
    ampRef.current += (target - ampRef.current) * (target > ampRef.current ? 0.45 : 0.07);
    const amp = ampRef.current;

    // Advance ring rotations (speed up slightly with amplitude)
    for (let i = 0; i < RINGS.length; i++) {
      const spd = RINGS[i].speed * (1 + amp * 0.6);
      rotRef.current[i] = (rotRef.current[i] + spd * dt) % 360;
    }

    // Sync canvas resolution to display size
    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.offsetWidth  * dpr;
    const h   = canvas.offsetHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }

    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;
    const minDim = Math.min(canvas.width, canvas.height);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const st = statusRef.current;
    const baseGlow = st === 'active' ? 0.5 + amp * 0.5 : st === 'listening' ? 0.22 : 0.13;

    // Draw segmented rings
    const SEGS     = 8;
    const GAP_FRAC = 0.12;
    const segArc   = (Math.PI * 2) / SEGS;
    const gapArc   = segArc * GAP_FRAC;
    const fillArc  = segArc - gapArc;

    for (let i = 0; i < RINGS.length; i++) {
      const ring   = RINGS[i];
      const r      = minDim * ring.rFrac + amp * ring.ampScale * dpr;
      const alpha  = ring.alpha * baseGlow;
      const rotRad = (rotRef.current[i] * Math.PI) / 180;

      // Main segments
      ctx.lineWidth = ring.lw * dpr;
      ctx.strokeStyle = `rgba(0,212,255,${alpha})`;
      for (let s = 0; s < SEGS; s++) {
        const a = rotRad + s * segArc;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a, a + fillArc);
        ctx.stroke();
      }

      // Glow halo — only when speaking, skipped when quiet (saves ~50% GPU)
      if (st === 'active' && amp > 0.08) {
        ctx.lineWidth   = ring.lw * dpr * 5;
        ctx.strokeStyle = `rgba(0,212,255,${alpha * 0.22})`;
        for (let s = 0; s < SEGS; s++) {
          const a = rotRad + s * segArc;
          ctx.beginPath();
          ctx.arc(cx, cy, r, a, a + fillArc);
          ctx.stroke();
        }
      }
    }

    // Center dot
    const dotR = minDim * 0.025 * (1 + amp * 0.55);
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,212,255,${0.28 + amp * 0.72})`;
    ctx.fill();

    rafRef.current = requestAnimationFrame(draw);
  }, [conv]); // conv ref is stable across renders

  useEffect(() => {
    lastTRef.current = performance.now();
    rafRef.current   = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // ── Connect / Disconnect ────────────────────────────────────────────────────

  async function loadSettings(): Promise<Settings> {
    // 1. Try server settings first (shared across all LAN clients)
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json() as { jarvis_settings?: string };
        if (data.jarvis_settings) {
          const parsed = JSON.parse(data.jarvis_settings) as Settings;
          // Back-fill localStorage so future loads are instant
          localStorage.setItem('jarvis_settings', data.jarvis_settings);
          return parsed;
        }
      }
    } catch { /* fall through to localStorage */ }

    // 2. Fall back to localStorage
    try {
      const raw = localStorage.getItem('jarvis_settings');
      if (raw) return JSON.parse(raw) as Settings;
    } catch { /* ignore */ }

    return {};
  }

  async function connect() {
    setStatus('listening');
    setError(null);
    ampRef.current = 0;

    const s = await loadSettings();

    const agentId = s.elevenLabsAgentId?.trim();
    if (!agentId) {
      setStatus('error');
      setError('No ElevenLabs Agent ID — save Settings in the main Jarvis app first.');
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const overrideAgent: Record<string, unknown> = {};
      if (s.initialPrompt)                  overrideAgent.prompt       = { prompt: s.initialPrompt };
      if (s.elevenLabsFirstMessage?.trim()) overrideAgent.firstMessage = s.elevenLabsFirstMessage.trim();
      const overrides = Object.keys(overrideAgent).length > 0 ? { agent: overrideAgent } : undefined;

      await conv.startSession({
        agentId,
        connectionType: 'websocket',
        ...(overrides && { overrides }),
      });
    } catch (e) {
      console.error('[Round] ElevenLabs connect error', e);
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function disconnect() {
    try { conv.endSession(); } catch { /* already ended */ }
    ampRef.current = 0;
    setStatus('idle');
    setError(null);
  }

  // Auto-connect on mount
  useEffect(() => {
    void connect();
    return () => { try { conv.endSession(); } catch { /* ignore */ } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI auto-hide ────────────────────────────────────────────────────────────

  const resetUITimer = useCallback(() => {
    setShowUI(true);
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    uiTimerRef.current = setTimeout(() => setShowUI(false), 3000);
  }, []);

  useEffect(() => {
    resetUITimer();
    return () => { if (uiTimerRef.current) clearTimeout(uiTimerRef.current); };
  }, [resetUITimer]);

  // ── Fullscreen ──────────────────────────────────────────────────────────────

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // ── Tap handler ─────────────────────────────────────────────────────────────

  function handleTap() {
    resetUITimer();
    if (status === 'active' || status === 'listening') {
      disconnect();
    } else {
      void connect();
    }
  }

  // ── Status colour ───────────────────────────────────────────────────────────

  const dotColor =
    status === 'active'    ? '#22d3ee' :
    status === 'listening' ? '#facc15' :
    status === 'error'     ? '#f87171' : '#6b7280';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden"
      onPointerDown={resetUITimer}
      onTouchStart={resetUITimer}
    >
      {/* Canvas fills the screen — tap to toggle connect/disconnect */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onClick={handleTap}
        style={{ touchAction: 'none' }}
      />

      {/* Fullscreen button — always visible, bottom right, easy tap target */}
      <button
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-11 h-11 rounded-full"
        style={{ background: 'rgba(0,212,255,0.10)', border: '1px solid rgba(0,212,255,0.25)' }}
        onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
        aria-label="Toggle fullscreen"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,212,255,0.8)"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>

      {/* Status indicator — bottom left */}
      <div
        className="fixed bottom-6 left-6 flex items-center gap-2 transition-opacity duration-500 pointer-events-none"
        style={{ opacity: showUI ? 1 : 0 }}
      >
        <div
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: dotColor,
            boxShadow: `0 0 6px ${dotColor}`,
            animation: status === 'active' || status === 'listening'
              ? 'jarvis-pulse 1.5s ease-in-out infinite' : 'none',
          }}
        />
        <span className="text-[10px] uppercase tracking-widest font-mono select-none"
          style={{ color: dotColor }}>
          {status === 'idle' ? 'offline' : status}
        </span>
      </div>

      {/* Error message — top center, auto-hides */}
      {error && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 max-w-[80vw] text-center text-[10px] text-red-400/80 font-mono leading-relaxed transition-opacity duration-500 pointer-events-none"
          style={{ opacity: showUI ? 1 : 0 }}
        >
          {error}
        </div>
      )}

      {/* Tap-to-activate hint — only when idle */}
      {status === 'idle' && showUI && (
        <p className="fixed bottom-16 left-1/2 -translate-x-1/2 text-[9px] text-white/25 uppercase tracking-widest font-mono pointer-events-none select-none">
          tap to activate
        </p>
      )}

      <style>{`
        @keyframes jarvis-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  );
}

// ─── Page export (provides ConversationProvider context) ─────────────────────

export default function RoundPage() {
  return (
    <ConversationProvider>
      <RoundDisplay />
    </ConversationProvider>
  );
}
