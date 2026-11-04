'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { sfx, sfxSlide } from '../lib/sfx';
import { useIsMobile } from '../lib/useIsMobile';

type Phase = 'black' | 'scan' | 'assemble' | 'widgets';

const BOOT_LINES = [
  'INITIALIZING NEURAL INTERFACE...',
  'LOADING ENVIRONMENTAL SENSORS...',
  'CALIBRATING THREAT ASSESSMENT...',
  'ESTABLISHING SECURE UPLINK...',
  'J.A.R.V.I.S. ONLINE',
];

export function IntroAnimation({
  onComplete,
  onFadeStart,
}: {
  onComplete: () => void;
  onFadeStart?: () => void;
}) {
  const isMobile = useIsMobile();
  const [phase, setPhase]           = useState<Phase>('black');
  const [visible, setVisible]       = useState(true);
  const [screenW, setScreenW]       = useState(1440);
  const [screenH, setScreenH]       = useState(900);
  const [logoSrc, setLogoSrc]       = useState('/assets/logo.png');
  // Driven at the same rates as JarvisAssistant so they match on cross-fade
  const [ring1Rot, setRing1Rot]     = useState(0);
  const [ring2Rot, setRing2Rot]     = useState(0);
  const lastTimeRef                 = useRef<number>(Date.now());

  useEffect(() => {
    const update = () => { setScreenW(window.innerWidth); setScreenH(window.innerHeight); };
    update();
    window.addEventListener('resize', update);
    try {
      const stored = localStorage.getItem('jarvis_settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.logo === 'logo2') setLogoSrc('/assets/logo2.png');
      }
    } catch { /* use default */ }
    return () => window.removeEventListener('resize', update);
  }, []);

  // Spin rings at the same speed as JarvisAssistant (+40°/s, -20°/s)
  useEffect(() => {
    let raf: number;
    const loop = () => {
      const now = Date.now();
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      setRing1Rot(prev => (prev + 40 * delta) % 360);
      setRing2Rot(prev => (prev - 20 * delta + 360) % 360);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(() => { setPhase('scan');     sfx('select', 0.5); sfx('loading', 0.7); }, 400),
      setTimeout(() => { setPhase('assemble'); sfx('intro2', 0.8); }, 2400),
    ];

    if (isMobile) {
      // Mobile: scan + assemble only, then fade out ~1s after assemble settles
      timers.push(
        setTimeout(() => { setVisible(false); onFadeStart?.(); }, 3800),
        setTimeout(onComplete,                                     3850),
      );
    } else {
      // Desktop: full sequence with widget slide-in
      const WIDGET_START = 4200;
      const STAGGER_MS   = 220;
      const NUM_WIDGETS  = 5;
      timers.push(
        setTimeout(() => { setPhase('widgets'); },              WIDGET_START),
        setTimeout(() => { setVisible(false); onFadeStart?.(); }, 6900),
        setTimeout(onComplete,                                    6950),
      );
      for (let i = 0; i < NUM_WIDGETS; i++) {
        timers.push(setTimeout(() => sfxSlide(0.55), WIDGET_START + i * STAGGER_MS));
      }
    }

    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const cx = screenW / 2;
  const cy = screenH / 2;

  // Must mirror HUDLayer buildDefaultModules() exactly
  const widgets = [
    { label: 'LOCAL TIME',      x: 50,            y: 50,  w: 300, h: 180 },
    { label: 'SYSTEM STATUS',   x: 50,            y: 250, w: 300, h: 250 },
    { label: 'NETWORK TRAFFIC', x: 50,            y: 520, w: 300, h: 200 },
    { label: 'GEO-LOCATION',    x: screenW - 450, y: 50,  w: 400, h: 250 },
    { label: 'MK.2 ARMOR',      x: screenW - 300, y: 320, w: 240, h: 500 },
  ];

  // Static idle bar heights that match the real component (no audio data)
  const FFT_BARS = 64;
  const idleBars = Array.from({ length: FFT_BARS }, (_, i) => {
    const angle = (i / FFT_BARS) * Math.PI * 2;
    const radius = 180;
    const x = 200 + Math.cos(angle) * radius;
    const y = 200 + Math.sin(angle) * radius;
    const barWidth = 5;
    const barHeight = 6; // idle height (no FFT data)
    const rotation = (angle * 180) / Math.PI + 90;
    return { x, y, barWidth, barHeight, rotation };
  });

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="intro"
          className="fixed inset-0 bg-black z-[9999] overflow-hidden"
          exit={{ opacity: 1 }}
          transition={{ duration: 0 }}
        >
          {/* Grid reveal */}
          {phase !== 'black' && (
            <motion.div
              className="absolute inset-x-0 top-0 overflow-hidden"
              initial={{ height: 0 }}
              animate={{ height: '100%' }}
              transition={{ duration: 1.8, ease: 'linear' }}
            >
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `
                    linear-gradient(rgba(34,211,238,0.055) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(34,211,238,0.055) 1px, transparent 1px)
                  `,
                  backgroundSize: '40px 40px',
                  height: '100vh',
                }}
              />
            </motion.div>
          )}

          {/* Scan line */}
          {phase === 'scan' && (
            <motion.div
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                height: 2,
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.5) 15%, rgba(34,211,238,1) 50%, rgba(34,211,238,0.5) 85%, transparent 100%)',
                boxShadow: '0 0 30px 12px rgba(34,211,238,0.3)',
              }}
              initial={{ top: 0 }}
              animate={{ top: '100vh' }}
              transition={{ duration: 1.8, ease: 'linear' }}
            />
          )}

          {/* ── Jarvis center — sized to EXACTLY match the real JarvisAssistant ── */}
          {(phase === 'assemble' || phase === 'widgets') && (
            <div className="absolute inset-0 flex items-center justify-center">
              <style>{`
                @keyframes introBarReveal {
                  from { opacity: 0; transform: scaleY(0); }
                  to   { opacity: 0.15; transform: scaleY(1); }
                }
              `}</style>
              {/*
                Real Jarvis uses: w-[80vw] max-w-[500px] aspect-square
                We replicate that here so the transition is seamless.
              */}
              <div
                className="relative flex items-center justify-center"
                style={{ width: 'min(80vw, 500px)', height: 'min(80vw, 500px)' }}
              >
                {/* Outer ring — wrapper owns rotation; motion.div owns opacity+scale */}
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ transform: `rotate(${ring2Rot}deg)` }}
                >
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 0.85, scale: 1 }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                  >
                    <Image
                      src="/assets/ring2.png"
                      alt="" width={700} height={700}
                      className="w-full h-full object-contain"
                      style={{ filter: 'drop-shadow(0 0 22px rgba(34,211,238,0.65))' }}
                      draggable={false} priority
                    />
                  </motion.div>
                </div>

                {/* FFT ring — bars sweep clockwise one at a time, matching real component geometry */}
                <motion.div
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15, duration: 0.2 }}
                >
                  <svg className="w-2/3 h-2/3" viewBox="0 0 400 400" style={{ overflow: 'visible' }}>
                    {idleBars.map((bar, i) => (
                      <g key={i} transform={`translate(${bar.x}, ${bar.y}) rotate(${bar.rotation})`}>
                        <rect
                          x={-bar.barWidth / 2}
                          y={-bar.barHeight / 2}
                          width={bar.barWidth}
                          height={bar.barHeight}
                          fill="rgba(34,211,238,1)"
                          rx={2.5}
                          style={{
                            transformOrigin: 'center',
                            opacity: 0,
                            animation: 'introBarReveal 0.12s ease forwards',
                            animationDelay: `${0.1 + i * (0.9 / FFT_BARS)}s`,
                          }}
                        />
                      </g>
                    ))}
                  </svg>
                </motion.div>

                {/* Inner ring — wrapper owns rotation; motion.div owns opacity+scale */}
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ transform: `rotate(${ring1Rot}deg)` }}
                >
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 0.9, scale: 1 }}
                    transition={{ delay: 0.25, duration: 0.65, ease: 'easeOut' }}
                  >
                    <Image
                      src="/assets/ring1.png"
                      alt="" width={600} height={600}
                      className="w-4/5 h-4/5 object-contain"
                      style={{ filter: 'drop-shadow(0 0 28px rgba(34,211,238,0.8))' }}
                      draggable={false} priority
                    />
                  </motion.div>
                </div>

                {/* Logo — real uses w-[55%] h-[55%] inside the container */}
                <motion.div
                  className="relative z-10"
                  style={{ width: '55%', height: '55%' }}
                  initial={{ opacity: 0, scale: 0.2 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.55, duration: 0.5, ease: 'easeOut' }}
                >
                  <Image
                    src={logoSrc}
                    alt="Jarvis" fill
                    className="object-contain"
                    draggable={false} priority
                  />
                </motion.div>

                {/* SYSTEM ONLINE label */}
                <motion.div
                  className="absolute flex items-center gap-2.5"
                  style={{ bottom: -52 }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.9, duration: 0.4 }}
                >
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-cyan-400 font-bold text-sm uppercase tracking-[0.35em]">
                    SYSTEM ONLINE
                  </span>
                </motion.div>
              </div>
            </div>
          )}

          {/* Boot log */}
          {(phase === 'assemble' || phase === 'widgets') && (
            <div className="absolute bottom-10 left-10 font-mono space-y-1">
              {BOOT_LINES.map((line, i) => (
                <motion.p
                  key={line}
                  className={`text-xs tracking-widest uppercase ${
                    i === BOOT_LINES.length - 1 ? 'text-cyan-300 font-bold' : 'text-cyan-600'
                  }`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.22, duration: 0.3 }}
                >
                  {'> '}{line}
                </motion.p>
              ))}
            </div>
          )}

          {/* JARVIS watermark */}
          {(phase === 'assemble' || phase === 'widgets') && (
            <motion.div
              className="absolute top-8 right-10 text-right select-none pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.07 }}
              transition={{ delay: 0.8, duration: 0.6 }}
            >
              <p className="text-8xl font-black text-white tracking-[0.4em]">JARVIS</p>
              <p className="text-xs text-white/60 tracking-[0.5em] mt-1">v5.0 — MARK II INTERFACE</p>
            </motion.div>
          )}

          {/* Widget cards flying out from center */}
          {phase === 'widgets' && widgets.map((w, i) => {
            const d = i * 0.22;
            return (
              <motion.div
                key={w.label}
                className="absolute overflow-hidden"
                style={{
                  width: w.w, height: w.h, top: 0, left: 0,
                  background: 'rgba(0,8,16,0.96)',
                  border: '1px solid rgba(34,211,238,0.7)',
                  boxShadow: '0 0 18px 3px rgba(34,211,238,0.35), inset 0 0 30px rgba(34,211,238,0.06)',
                  clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))',
                }}
                initial={{ x: cx - w.w / 2, y: cy - w.h / 2, scale: 0.05, opacity: 0 }}
                animate={{ x: w.x, y: w.y, scale: 1, opacity: 1 }}
                transition={{ delay: d, duration: 0.65, type: 'spring', stiffness: 160, damping: 20 }}
              >
                <div
                  className="flex items-center px-3 gap-2"
                  style={{ height: 30, background: 'rgba(34,211,238,0.12)', borderBottom: '1px solid rgba(34,211,238,0.5)' }}
                >
                  <span className="text-[11px] font-bold text-cyan-300 tracking-widest uppercase truncate">
                    {w.label}
                  </span>
                </div>
                <div className="p-3 space-y-3">
                  {Array.from({ length: Math.min(5, Math.floor((w.h - 70) / 40)) }).map((_, j) => (
                    <div key={j} className="space-y-1.5">
                      <div className="h-[3px] rounded-full overflow-hidden"
                        style={{ background: 'rgba(34,211,238,0.12)' }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: 'rgba(34,211,238,0.75)', boxShadow: '0 0 8px rgba(34,211,238,0.5)' }}
                          initial={{ width: '0%' }}
                          animate={{ width: `${[78, 52, 88, 63, 72][j % 5]}%` }}
                          transition={{ delay: d + 0.3 + j * 0.08, duration: 0.4 }}
                        />
                      </div>
                      {j % 2 === 0 && (
                        <div className="h-[2px] rounded-full overflow-hidden w-3/5"
                          style={{ background: 'rgba(34,211,238,0.08)' }}>
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: 'rgba(34,211,238,0.45)' }}
                            initial={{ width: '0%' }}
                            animate={{ width: '100%' }}
                            transition={{ delay: d + 0.42 + j * 0.06, duration: 0.3 }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
