'use client';

import { useRef, useEffect } from 'react';

interface Props {
  fftData: number[];
  status: 'idle' | 'listening' | 'active' | 'error';
}

export function ArcReactorVisualizer({ fftData, status }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const fftRef = useRef(fftData);
  const statusRef = useRef(status);

  useEffect(() => { fftRef.current = fftData; }, [fftData]);
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    const getAccent = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-rgb').trim() || '34, 211, 238';

    // Seeded pseudo-random (deterministic per bar index so noise is smooth)
    const hash = (n: number) => {
      let x = Math.sin(n) * 43758.5453123;
      return x - Math.floor(x);
    };

    // ── Horizontal glow spectrum ─────────────────────────────────────────────
    // Like the shader: audio = pow(audio, 3.5) gives dramatic non-linear shaping.
    // Per-bar noise oscillates each column independently at different speeds,
    // mimicking the organic flutter of the shader's audio hash randomisation.
    const drawAuraSpectrum = (
      cx: number, cy: number,
      size: number, rgb: string, active: boolean, t: number
    ) => {
      const fft = fftRef.current;
      const n = fft.length;
      if (n === 0) return;

      const BARS     = 140;
      const halfSpan = size * 0.42;
      const maxH     = active ? size * 0.52 : size * 0.055;
      const barW     = (halfSpan * 2) / BARS;
      const alpha    = active ? 0.65 : 0.12;
      const glowBlur = active ? 26 : 10;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cx * 2, cy * 2);
      ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
      ctx.clip('evenodd');

      for (let i = 0; i < BARS; i++) {
        const tBar = i / (BARS - 1);
        const x    = cx - halfSpan + tBar * halfSpan * 2;

        // Circle silhouette: full height in middle, tapers to zero at edges
        const xNorm      = (x - cx) / halfSpan;
        const radialFade = Math.sqrt(Math.max(0, 1 - xNorm * xNorm));

        // FFT bin — use lower half of spectrum (voice-friendly range)
        const bin    = Math.min(Math.floor(tBar * (n * 0.75)), n - 1);
        // Shader-style power shaping: pow(audio, 3.5) — punches highs, silences noise floor
        const shaped = Math.pow(fft[bin], 2.8);

        // Per-bar organic flutter: three overlapping sine waves at different speeds
        // mimics the irregular shimmer of the shader's hash-based randomisation
        const noise =
          0.72 +
          0.12 * Math.sin(t * (1.1 + hash(i * 0.3) * 2.2) + hash(i * 1.7) * 6.28) +
          0.10 * Math.sin(t * (2.3 + hash(i * 0.7) * 1.8) + hash(i * 3.1) * 6.28) +
          0.06 * Math.sin(t * (4.1 + hash(i * 1.3) * 3.5) + hash(i * 5.9) * 6.28);

        const amp = shaped * maxH * radialFade * noise;
        if (amp < 1) continue;

        const grad = ctx.createLinearGradient(x, cy - amp, x, cy + amp);
        const peak = alpha * radialFade;
        grad.addColorStop(0,    `rgba(${rgb}, 0)`);
        grad.addColorStop(0.20, `rgba(${rgb}, ${peak * 0.45})`);
        grad.addColorStop(0.50, `rgba(${rgb}, ${peak})`);
        grad.addColorStop(0.80, `rgba(${rgb}, ${peak * 0.45})`);
        grad.addColorStop(1,    `rgba(${rgb}, 0)`);

        ctx.shadowBlur  = glowBlur * radialFade;
        ctx.shadowColor = `rgba(${rgb}, 0.8)`;
        ctx.fillStyle   = grad;
        ctx.fillRect(x - barW * 1.1, cy - amp, barW * 2.2, amp * 2);
      }

      ctx.shadowBlur = 0;
      ctx.restore();
    };

    // ── Segmented arc reactor ring ──────────────────────────────────────────
    const drawRing = (
      cx: number, cy: number,
      outerR: number, innerR: number,
      segments: number, gapFrac: number,
      rotation: number,
      rgb: string, alpha: number, glowBlur: number
    ) => {
      const step    = (Math.PI * 2) / segments;
      const drawArc = step * (1 - gapFrac);
      ctx.shadowBlur  = glowBlur;
      ctx.shadowColor = `rgba(${rgb}, 0.9)`;
      ctx.fillStyle   = `rgba(${rgb}, ${alpha})`;
      for (let i = 0; i < segments; i++) {
        const a0 = i * step + rotation;
        const a1 = a0 + drawArc;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, a0, a1);
        ctx.arc(cx, cy, innerR, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);

      const css = canvas.getBoundingClientRect();
      const w   = css.width;
      const h   = css.height;
      const cx  = w / 2;
      const cy  = h / 2;
      const size = Math.min(w, h);
      const rgb  = getAccent();
      const active = statusRef.current === 'active';
      const t      = now * 0.001;

      ctx.clearRect(0, 0, w, h);

      // ── 1. Aura spectrum — horizontal glow, drawn BEHIND rings ──────────────
      drawAuraSpectrum(cx, cy, size, rgb, active, t);

      // ── 2. Outer segmented ring (48 tiles, slow CW) ─────────────────────────
      drawRing(cx, cy,
        size * 0.325, size * 0.285,
        48, 0.18, t * 0.25,
        rgb, active ? 0.85 : 0.28, active ? 14 : 5);

      // ── 3. Middle segmented ring (12 tiles, CCW) ────────────────────────────
      drawRing(cx, cy,
        size * 0.25, size * 0.225,
        12, 0.22, -t * 0.18,
        rgb, active ? 0.7 : 0.2, active ? 10 : 4);

      // ── 4. Inner accent ring (3 arcs, fast CW) ──────────────────────────────
      drawRing(cx, cy,
        size * 0.195, size * 0.18,
        3, 0.35, t * 0.55,
        rgb, active ? 0.55 : 0.15, active ? 8 : 3);

      // ── 5. Central orb glow ─────────────────────────────────────────────────
      const orbR    = size * 0.16;
      const orbGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
      const peak    = active ? 0.35 : 0.08;
      orbGrad.addColorStop(0,   `rgba(${rgb}, ${peak})`);
      orbGrad.addColorStop(0.5, `rgba(${rgb}, ${peak * 0.4})`);
      orbGrad.addColorStop(1,   `rgba(${rgb}, 0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx.fillStyle = orbGrad;
      ctx.fill();
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: 'block' }}
    />
  );
}
