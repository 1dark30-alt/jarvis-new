/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useMemo, useState } from 'react';

type JarvisLogo = 'logo' | 'logo2';

interface DesktopOverlayVisualProps {
  initialLogo: JarvisLogo;
  initiallyMuted: boolean;
}

const FFT_BARS = 64;

export function DesktopOverlayVisual({
  initialLogo,
  initiallyMuted,
}: DesktopOverlayVisualProps) {
  const [muted, setMuted] = useState(initiallyMuted);
  const bars = useMemo(() => Array.from({ length: FFT_BARS }), []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'arc-reactor');
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron?.onDesktopPanelMuted?.((nextMuted) => {
      setMuted(nextMuted);
    });
    return () => unsubscribe?.();
  }, []);

  return (
    <>
      <main className="desktop-overlay-root">
        <section className={`desktop-stage ${muted ? 'is-muted' : ''}`} aria-hidden="true">
          <img className="desktop-ring desktop-ring-outer" src="/assets/ring2.png" alt="" draggable={false} />

          <svg className="desktop-bars" viewBox="0 0 400 400" aria-hidden="true">
            {bars.map((_, index) => {
              const angle = (index / FFT_BARS) * Math.PI * 2;
              const radius = 180;
              const centerX = 200;
              const centerY = 200;
              const x = centerX + Math.cos(angle) * radius;
              const y = centerY + Math.sin(angle) * radius;
              const rotation = (angle * 180) / Math.PI + 90;
              return (
                <g key={index} transform={`translate(${x}, ${y}) rotate(${rotation})`}>
                  <rect
                    x={-2.5}
                    y={-8}
                    width={5}
                    height={16}
                    fill="var(--accent-hex)"
                    opacity={0.2 + (index % 6) * 0.08}
                    rx={2.5}
                  />
                </g>
              );
            })}
          </svg>

          <img className="desktop-ring desktop-ring-inner" src="/assets/ring1.png" alt="" draggable={false} />
          <img className="desktop-logo" src={`/assets/${initialLogo}.png`} alt="Jarvis Logo" draggable={false} />
        </section>
      </main>
    </>
  );
}
