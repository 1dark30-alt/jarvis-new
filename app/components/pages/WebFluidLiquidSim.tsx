'use client';

import { useEffect, useRef } from 'react';

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  wobble: number;
  wobbleSpeed: number;
  life: number;
}

/**
 * Invisible beaker silhouette filled with animated liquid + rising bubbles.
 * `fill` is 0..1. Canvas is transparent outside the liquid.
 */
export function WebFluidLiquidSim({
  fill,
  className = '',
}: {
  fill: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fillRef = useRef(fill);
  const bubblesRef = useRef<Bubble[]>([]);
  const tRef = useRef(0);

  useEffect(() => {
    fillRef.current = fill;
  }, [fill]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let running = true;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const beakerPath = (w: number, h: number) => {
      // Invisible beaker — anchored near the bottom of the window
      const bw = Math.min(w * 0.38, 220);
      const bh = Math.min(h * 0.58, 320);
      const cx = w / 2;
      const bottom = h * 0.94;
      const top = bottom - bh;
      const topHalf = bw * 0.42;
      const botHalf = bw * 0.5;
      const path = new Path2D();
      path.moveTo(cx - topHalf, top);
      path.lineTo(cx + topHalf, top);
      path.lineTo(cx + botHalf, bottom - 12);
      path.quadraticCurveTo(cx + botHalf, bottom, cx + botHalf - 10, bottom);
      path.lineTo(cx - botHalf + 10, bottom);
      path.quadraticCurveTo(cx - botHalf, bottom, cx - botHalf, bottom - 12);
      path.closePath();
      return { path, cx, top, bottom, topHalf, botHalf, bw, bh };
    };

    const spawnBubble = (geom: ReturnType<typeof beakerPath>, surfaceY: number) => {
      const depth = Math.max(0.05, (surfaceY - geom.top) / (geom.bottom - geom.top));
      const halfAt = geom.topHalf + (geom.botHalf - geom.topHalf) * depth;
      bubblesRef.current.push({
        x: geom.cx + (Math.random() - 0.5) * halfAt * 1.5,
        y: geom.bottom - 8 - Math.random() * 20,
        r: 1.5 + Math.random() * 4.5,
        vy: -(0.35 + Math.random() * 0.9),
        vx: (Math.random() - 0.5) * 0.35,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 2 + Math.random() * 3,
        life: 1,
      });
    };

    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      tRef.current += dt;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const level = Math.max(0, Math.min(1, fillRef.current));
      if (level < 0.01) {
        bubblesRef.current = [];
        raf = requestAnimationFrame(tick);
        return;
      }

      const geom = beakerPath(w, h);
      const liquidTop = geom.bottom - (geom.bottom - geom.top) * level * 0.92;

      // Clip to beaker
      ctx.save();
      ctx.clip(geom.path);

      // Liquid body
      const grad = ctx.createLinearGradient(0, liquidTop, 0, geom.bottom);
      grad.addColorStop(0, 'rgba(56, 220, 255, 0.55)');
      grad.addColorStop(0.45, 'rgba(14, 165, 233, 0.62)');
      grad.addColorStop(1, 'rgba(8, 80, 120, 0.85)');

      // Wavy surface
      const waveAmp = 3.5 + Math.sin(tRef.current * 2.1) * 1.2;
      ctx.beginPath();
      const leftX = geom.cx - geom.botHalf;
      const rightX = geom.cx + geom.botHalf;
      ctx.moveTo(leftX, geom.bottom);
      ctx.lineTo(leftX, liquidTop);
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const px = leftX + ((rightX - leftX) * i) / steps;
        const wy =
          liquidTop +
          Math.sin(tRef.current * 3.2 + i * 0.55) * waveAmp +
          Math.sin(tRef.current * 5.1 + i * 0.9) * (waveAmp * 0.35);
        ctx.lineTo(px, wy);
      }
      ctx.lineTo(rightX, geom.bottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Surface highlight
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = leftX + ((rightX - leftX) * i) / steps;
        const wy =
          liquidTop +
          Math.sin(tRef.current * 3.2 + i * 0.55) * waveAmp +
          Math.sin(tRef.current * 5.1 + i * 0.9) * (waveAmp * 0.35);
        if (i === 0) ctx.moveTo(px, wy);
        else ctx.lineTo(px, wy);
      }
      ctx.strokeStyle = 'rgba(186, 245, 255, 0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Soft caustic shimmer
      ctx.globalAlpha = 0.12;
      for (let i = 0; i < 5; i++) {
        const yy = liquidTop + 20 + i * 28 + Math.sin(tRef.current * 1.5 + i) * 6;
        ctx.beginPath();
        ctx.ellipse(geom.cx + Math.sin(tRef.current + i) * 18, yy, geom.bw * 0.28, 6, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#a5f3fc';
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Bubbles
      if (level > 0.15 && bubblesRef.current.length < 42 && Math.random() < 0.45) {
        spawnBubble(geom, liquidTop);
      }

      const next: Bubble[] = [];
      for (const b of bubblesRef.current) {
        b.wobble += b.wobbleSpeed * dt;
        b.x += b.vx + Math.sin(b.wobble) * 0.4;
        b.y += b.vy * (60 * dt);
        b.vy *= 0.998;
        if (b.y < liquidTop + 4) {
          b.life -= dt * 2.5;
        }
        if (b.life <= 0 || b.y < liquidTop - 8) continue;

        const alpha = Math.min(0.85, b.life);
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(224, 255, 255, ${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.55})`;
        ctx.fill();
        next.push(b);
      }
      bubblesRef.current = next;

      ctx.restore();

      // Very faint beaker rim (nearly invisible — just grounds the liquid)
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke(geom.path);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 ${className}`}
      aria-hidden
    />
  );
}
