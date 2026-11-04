'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sfx } from '../lib/sfx';
import { isInterfaceLocked } from './LockScreen';

export interface RadialNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Page id for jarvis:navigate, or a custom action */
  action: () => void;
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  width: 22,
  height: 22,
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const PAGE_ITEMS: { page: string; label: string; icon: React.ReactNode }[] = [
  { page: 'home', label: 'Home', icon: (
    <svg {...ICON_PROPS}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
  ) },
  { page: 'news', label: 'News', icon: (
    <svg {...ICON_PROPS}><rect x="3" y="4" width="15" height="16" rx="1" /><path d="M18 8h3v11a1.5 1.5 0 0 1-3 0z" /><path d="M6 8h9M6 12h9M6 16h6" /></svg>
  ) },
  { page: 'map', label: 'Map', icon: (
    <svg {...ICON_PROPS}><path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 0 1 13 0c0 4.5-6.5 10-6.5 10z" /><circle cx="12" cy="11" r="2.2" /></svg>
  ) },
  { page: 'calendar', label: 'Calendar', icon: (
    <svg {...ICON_PROPS}><rect x="3" y="5" width="18" height="16" rx="1.5" /><path d="M3 9.5h18M8 3v4M16 3v4" /></svg>
  ) },
  { page: 'home-assistant', label: 'Smart Home', icon: (
    <svg {...ICON_PROPS}><path d="M12 3 3 11h2v9h5v-5h4v5h5v-9h2z" /><circle cx="12" cy="11" r="1.4" /></svg>
  ) },
  { page: '3d-printers', label: 'Printers', icon: (
    <svg {...ICON_PROPS}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></svg>
  ) },
  { page: 'music', label: 'Music', icon: (
    <svg {...ICON_PROPS}><circle cx="7" cy="18" r="2.6" /><circle cx="17.5" cy="15.5" r="2.6" /><path d="M9.6 18V6.5l10.5-2.5v11.5" /></svg>
  ) },
  { page: 'spiderman', label: 'Armory', icon: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18" /></svg>
  ) },
  { page: 'manufacturing', label: 'Fabrication', icon: (
    <svg {...ICON_PROPS}><path d="M3 21V10l6 4v-4l6 4V7l6-3v17z" /><path d="M7 17h2M12 17h2M17 17h2" /></svg>
  ) },
  { page: 'webshooter', label: 'Web Lab', icon: (
    <svg {...ICON_PROPS}><rect x="4" y="8" width="16" height="8" rx="2.5" /><circle cx="12" cy="12" r="2" /><path d="M12 4v2M12 18v2M4.5 5.5 6 7M19.5 5.5 18 7" /></svg>
  ) },
  { page: 'social', label: 'Social', icon: (
    <svg {...ICON_PROPS}><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /></svg>
  ) },
  { page: 'audio-test', label: 'Audio Lab', icon: (
    <svg {...ICON_PROPS}><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" /></svg>
  ) },
  { page: 'round-display', label: 'Round HUD', icon: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /></svg>
  ) },
];

/**
 * Global arc-reactor navigation. A small docked reactor button (bottom-left)
 * blooms a full-screen radial menu — every page arranged around a spinning
 * segmented ring, plus lock / settings / ambient shortcuts.
 */
export function RadialNav({ currentPage }: { currentPage: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('jarvis:navigate', close);
    return () => window.removeEventListener('jarvis:navigate', close);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const navigate = (page: string) => {
    sfx('select', 0.5);
    window.dispatchEvent(new CustomEvent('jarvis:navigate', { detail: { page } }));
    setOpen(false);
  };

  const actions: RadialNavItem[] = [
    ...PAGE_ITEMS.map((it) => ({
      id: it.page,
      label: it.label,
      icon: it.icon,
      action: () => navigate(it.page),
    })),
    {
      id: 'lock',
      label: 'Lock',
      icon: (
        <svg {...ICON_PROPS}><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></svg>
      ),
      action: () => {
        setOpen(false);
        window.dispatchEvent(new CustomEvent('jarvis:lock'));
      },
    },
    {
      id: 'ambient',
      label: 'Ambient',
      icon: (
        <svg {...ICON_PROPS}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" /></svg>
      ),
      action: () => {
        setOpen(false);
        window.dispatchEvent(new CustomEvent('jarvis:ambient'));
      },
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg {...ICON_PROPS}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" /></svg>
      ),
      action: () => {
        setOpen(false);
        window.dispatchEvent(new CustomEvent('jarvis:open-settings'));
      },
    },
  ];

  const RADIUS = 190;
  const count = actions.length;

  return (
    <>
      {/* Docked reactor toggle */}
      <button
        onClick={() => {
          if (isInterfaceLocked()) return;
          sfx(open ? 'app_close' : 'sfx_settings_open', 0.4);
          setOpen((o) => !o);
        }}
        className="fixed bottom-5 left-5 z-[70] group pointer-events-auto"
        title="Navigation (arc reactor)"
      >
        <span className="relative flex items-center justify-center w-12 h-12">
          <svg viewBox="0 0 48 48" className="absolute inset-0 animate-[spin_14s_linear_infinite] opacity-70 group-hover:opacity-100 transition-opacity">
            {Array.from({ length: 12 }, (_, i) => (
              <rect key={i} x="23" y="2" width="2" height="6" rx="1"
                fill="var(--accent-hex, #22d3ee)"
                transform={`rotate(${i * 30} 24 24)`} />
            ))}
          </svg>
          <svg viewBox="0 0 48 48" className="absolute inset-0">
            <circle cx="24" cy="24" r="13" fill="none" stroke="var(--accent-hex, #22d3ee)" strokeOpacity="0.5" strokeWidth="1" />
            <circle cx="24" cy="24" r="6" fill="var(--accent-hex, #22d3ee)" fillOpacity={open ? 0.5 : 0.22}
              style={{ filter: 'drop-shadow(0 0 6px var(--accent-hex, #22d3ee))', transition: 'fill-opacity 0.3s' }} />
          </svg>
        </span>
      </button>

      {/* Full-screen radial menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[65] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
            onClick={() => setOpen(false)}
          >
            <div className="relative" style={{ width: RADIUS * 2 + 140, height: RADIUS * 2 + 140 }} onClick={(e) => e.stopPropagation()}>
              {/* Spinning segmented reactor ring */}
              <motion.svg
                className="absolute inset-0 pointer-events-none"
                viewBox="0 0 100 100"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.7, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              >
                <g style={{ transformOrigin: '50% 50%' }} className="animate-[spin_50s_linear_infinite]">
                  {Array.from({ length: 60 }, (_, i) => (
                    <rect key={i} x="49.7" y="9.5" width="0.6" height="2.4"
                      fill="var(--accent-hex, #22d3ee)" opacity="0.45"
                      transform={`rotate(${i * 6} 50 50)`} />
                  ))}
                </g>
                <circle cx="50" cy="50" r="37" fill="none" stroke="var(--accent-hex, #22d3ee)" strokeOpacity="0.25" strokeWidth="0.3" />
                <circle cx="50" cy="50" r="43.5" fill="none" stroke="var(--accent-hex, #22d3ee)" strokeOpacity="0.15" strokeWidth="0.3" />
              </motion.svg>

              {/* Center label */}
              <motion.div
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.5em] text-white/40">Jarvis</span>
                <span className="font-mono text-[13px] uppercase tracking-[0.35em] mt-1" style={{ color: 'var(--accent-hex, #22d3ee)' }}>
                  Navigation
                </span>
              </motion.div>

              {/* Items around the ring */}
              {actions.map((item, i) => {
                const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
                const x = Math.cos(angle) * RADIUS;
                const y = Math.sin(angle) * RADIUS;
                const active = item.id === currentPage;
                return (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, x: 0, y: 0 }}
                    animate={{ opacity: 1, x, y }}
                    exit={{ opacity: 0, x: 0, y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 26, delay: i * 0.022 }}
                    onClick={item.action}
                    className="absolute left-1/2 top-1/2 -ml-8 -mt-8 flex flex-col items-center gap-1.5 group"
                    style={{ width: 64 }}
                  >
                    <span
                      className="flex items-center justify-center w-14 h-14 rounded-full transition-all group-hover:scale-110"
                      style={{
                        color: active ? '#000' : 'var(--accent-hex, #22d3ee)',
                        background: active ? 'var(--accent-hex, #22d3ee)' : 'rgba(0,0,0,0.65)',
                        border: '1px solid rgba(var(--accent-rgb, 34, 211, 238), 0.55)',
                        boxShadow: active
                          ? '0 0 24px rgba(var(--accent-rgb, 34, 211, 238), 0.7)'
                          : '0 0 12px rgba(var(--accent-rgb, 34, 211, 238), 0.25)',
                      }}
                    >
                      {item.icon}
                    </span>
                    <span
                      className="font-mono text-[9px] uppercase tracking-widest whitespace-nowrap transition-colors"
                      style={{ color: active ? 'var(--accent-hex, #22d3ee)' : 'rgba(255,255,255,0.45)' }}
                    >
                      {item.label}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
