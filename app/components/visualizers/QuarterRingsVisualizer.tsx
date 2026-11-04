'use client';

import { useRef, useEffect } from 'react';

interface Props {
  fftData: number[];
  status: 'idle' | 'listening' | 'active' | 'error';
}

// Per-ring personality, seeded so it's deterministic but visually unique
interface RingDef {
  radiusFrac: number;   // radius as fraction of half-size
  thickness: number;    // stroke thickness as fraction of half-size
  arcSpan: number;      // arc width in radians (~quarter ring ± variation)
  baseAngle: number;    // initial angular offset
  speed1: number;       // primary oscillation frequency (rad/s)
  speed2: number;       // secondary frequency for non-periodic feel
  phase1: number;       // phase of primary oscillation
  phase2: number;       // phase of secondary oscillation
  amp1: number;         // primary swing amplitude (radians)
  amp2: number;         // secondary swing amplitude
  baseAlpha: number;    // base opacity
  fftBin: number;       // which FFT bin drives this ring's energy
}

// Deterministic hash (Schechter hash variant)
const hash = (n: number): number => {
  const x = Math.sin(n + 1.3) * 43758.5453123;
  return x - Math.floor(x);
};

const NUM_RINGS = 8;

const RINGS: RingDef[] = Array.from({ length: NUM_RINGS }, (_, i) => ({
  // Rings sit outside the static white circle (which is at 0.56) and spread outward
  radiusFrac: 0.62 + hash(i * 3.17) * 0.30,
  // Thin lines — variety adds depth
  thickness:  0.006 + hash(i * 7.31) * 0.016,
  // Each arc is roughly a quarter ring; some slightly bigger/smaller for variety
  arcSpan:    (Math.PI / 2) * (0.65 + hash(i * 2.89) * 0.75),
  // Stagger starting positions around the full circle
  baseAngle:  hash(i * 5.73) * Math.PI * 2,
  // Primary oscillation — slow to moderate, each ring unique
  speed1:     0.12 + hash(i * 4.11) * 0.22,
  // Secondary oscillation at golden-ratio multiple → non-repeating beat
  speed2:     (0.12 + hash(i * 4.11) * 0.22) * 1.6180339887,
  phase1:     hash(i * 1.93) * Math.PI * 2,
  phase2:     hash(i * 9.17) * Math.PI * 2,
  // Primary swing ≈ 120°–200° so they travel well past half-way
  amp1:       Math.PI * (0.65 + hash(i * 6.37) * 0.45),
  // Secondary adds spastic wobble on top of the main swing
  amp2:       Math.PI * (0.08 + hash(i * 2.03) * 0.18),
  baseAlpha:  0.50 + hash(i * 8.71) * 0.50,
  fftBin:     Math.floor(hash(i * 11.3) * 48),
}));

export function QuarterRingsVisualizer({ fftData, status }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const fftRef     = useRef(fftData);
  const statusRef  = useRef(status);

  useEffect(() => { fftRef.current = fftData; }, [fftData]);
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr  = window.devicePixelRatio || 1;
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const getAccent = (): string =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-rgb').trim() || '34, 211, 238';

    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);

      const css  = canvas.getBoundingClientRect();
      const w    = css.width;
      const h    = css.height;
      const cx   = w / 2;
      const cy   = h / 2;
      const size = Math.min(w, h);
      const half = size / 2;
      const rgb  = getAccent();
      const t    = now * 0.001;

      const st      = statusRef.current;
      const active  = st === 'active';
      const listen  = st === 'listening';

      const fft    = fftRef.current;
      const nBins  = Math.max(fft.length, 1);

      // Overall energy drives speed-up and glow when speaking
      let energy = 0;
      for (let i = 0; i < fft.length; i++) energy += fft[i];
      energy = energy / nBins;

      ctx.clearRect(0, 0, w, h);

      // ── Static thin white circle just outside the logo edge ──────────────────
      // Logo div is 55 % of container, so its radius ≈ half * 0.55
      // We place the circle slightly inside that edge so it hugs the image.
      const staticR = half * 0.56;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, staticR, 0, Math.PI * 2);
      ctx.strokeStyle = active
        ? `rgba(255, 255, 255, 0.55)`
        : listen
        ? `rgba(255, 255, 255, 0.35)`
        : `rgba(255, 255, 255, 0.18)`;
      ctx.lineWidth   = 1;
      ctx.shadowBlur  = 0;
      ctx.stroke();
      ctx.restore();

      // ── Quarter rings ─────────────────────────────────────────────────────────
      // Speed multiplier: voice barely nudges the pace
      const speedMult = active  ? 0.85 + energy * 0.2
                      : listen  ? 0.80
                      : 0.65;
      const glowBase  = active  ? 6 : listen ? 3 : 2;

      RINGS.forEach((ring) => {
        const bin      = Math.min(ring.fftBin, fft.length - 1);
        const binVal   = fft[bin] ?? 0;

        // Two-oscillator rotation creates a sporadic, non-periodic feel
        const osc1  = Math.sin(t * ring.speed1 * speedMult + ring.phase1) * ring.amp1;
        const osc2  = Math.sin(t * ring.speed2 * speedMult + ring.phase2) * ring.amp2;
        const angle = ring.baseAngle + osc1 + osc2;

        const r      = half * ring.radiusFrac;
        const thick  = half * ring.thickness;
        // Clamp so inner radius never goes negative
        const outerR = r + thick * 0.5;
        const innerR = Math.max(r - thick * 0.5, 1);

        // Per-ring glow and opacity barely respond to audio
        const glowExtra   = active  ? binVal * 1.5 : 0;
        const alphaBoost  = active  ? binVal * 0.06 : 0;
        const alphaScale  = active  ? 1.0 : listen ? 0.75 : 0.38;
        const alpha       = Math.min(ring.baseAlpha * alphaScale + alphaBoost, 1.0);

        ctx.save();
        ctx.shadowBlur  = glowBase + glowExtra;
        ctx.shadowColor = `rgba(${rgb}, 0.9)`;
        ctx.fillStyle   = `rgba(${rgb}, ${alpha})`;

        const a0 = angle;
        const a1 = angle + ring.arcSpan;

        ctx.beginPath();
        ctx.arc(cx, cy, outerR, a0, a1);
        ctx.arc(cx, cy, innerR, a1, a0, true);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: 'block' }}
    />
  );
}
