'use client';

import { useEffect, useRef } from 'react';

export function NetworkGraphWidget() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrame: number;
    const dataPoints: number[] = new Array(50).fill(0);
    let offset = 0;

    const draw = () => {
      if (Math.random() > 0.5) {
        dataPoints.shift();
        dataPoints.push(Math.random() * 0.8 + 0.1);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Grid — keep cyan as structural accent
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < canvas.width; x += 20) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
      }
      for (let y = 0; y < canvas.height; y += 20) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
      }
      ctx.stroke();

      // Graph line — white
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const stepX = canvas.width / (dataPoints.length - 1);
      dataPoints.forEach((point, i) => {
        const x = i * stepX;
        const y = canvas.height - point * canvas.height * 0.8;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Fill — white tinted
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineTo(canvas.width, canvas.height);
      ctx.lineTo(0, canvas.height);
      ctx.fill();

      // Scan line — cyan accent
      offset = (offset + 2) % canvas.width;
      ctx.fillStyle = 'rgba(34, 211, 238, 0.35)';
      ctx.fillRect(offset, 0, 1.5, canvas.height);

      animationFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <div className="w-full h-full flex flex-col gap-2">
      <div className="flex justify-between text-[10px] text-white/60 font-mono">
        <span>IN: <span className="text-white">1.2 MB/s</span></span>
        <span>OUT: <span className="text-white">0.4 MB/s</span></span>
      </div>
      <canvas
        ref={canvasRef}
        width={260}
        height={120}
        className="w-full h-full border border-cyan-500/20 bg-black/20"
      />
    </div>
  );
}
