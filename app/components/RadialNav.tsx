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
  { page: 'bounty-hunter', label: 'Bounty Hunter', icon: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
  ) },
  { page: 'wildcard-draw', label: 'Wildcard Draw', icon: (
    <svg {...ICON_PROPS}><rect x="3" y="5" width="10" height="14" rx="1.5" /><path d="M13 4.5 19 6l-3.2 13.2" /><path d="M6 9h4M6 12.5h4" /></svg>
  ) },
  { page: 'gods-eye', label: "God's Eye", icon: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="3" /><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /></svg>
  ) },
  { page: 'disk-map', label: 'Disk Map', icon: (
    <svg {...ICON_PROPS}><rect x="3" y="3" width="11" height="11" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="10" width="7" height="11" /><rect x="3" y="14" width="11" height="7" /></svg>
  ) },
  { page: 'build-guide', label: 'Build Guide', icon: (
    <svg {...ICON_PROPS}><path d="M14 3v18M3 8h8M3 16h8M17 8h4M17 16h4" /><circle cx="12" cy="8" r="0" /><path d="M11 6.5 14 8l-3 1.5zM11 14.5 14 16l-3 1.5z" /></svg>
  ) },
  { page: 'missions', label: 'Missions', icon: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></svg>
  ) },
  { page: 'memory', label: 'Memory', icon: (
    <svg {...ICON_PROPS}><path d="M12 5a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V8a3 3 0 0 0-3-3z" /><path d="M7 9a5 5 0 0 1 10 0M4.5 11a7.5 7.5 0 0 1 15 0" /></svg>
  ) },
  { page: 'health', label: 'Health', icon: (
    <svg {...ICON_PROPS}><path d="M12 21s-7.5-4.6-9.5-9A5.4 5.4 0 0 1 12 6.2 5.4 5.4 0 0 1 21.5 12c-2 4.4-9.5 9-9.5 9z" /><path d="M6 12h4l2-4 3 7 1.5-3H18" /></svg>
  ) },
  { page: 'dev-mode', label: 'Developer', icon: (
    <svg {...ICON_PROPS}><path d="M8 6 3 12l5 6M16 6l5 6-5 6M13 5l-2 14" /></svg>
  ) },
  { page: 'market', label: 'Market', icon: (
    <svg {...ICON_PROPS}><path d="M4 20V10M10 20V4M16 20v-8M22 20V8" /><path d="M3 20h20" /></svg>
  ) },
  { page: 'network-radar', label: 'Network', icon: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="16.5" cy="7.5" r="1.3" fill="currentColor" /><circle cx="7" cy="16" r="1.3" fill="currentColor" /></svg>
  ) },
  { page: 'finance', label: 'Finance', icon: (
    <svg {...ICON_PROPS}><path d="M3 8h18v10H3z" /><path d="M3 11h18M7 15h4" /></svg>
  ) },
  { page: 'scoresheets', label: 'Scoresheets', icon: (
    <svg {...ICON_PROPS}><path d="M5 3h10l4 4v14H5z" /><path d="M9 12h6M9 16h6M9 8h3" /></svg>
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

  // Ring layout: work tools on the inner ring, personal + system on the
  // outer ring. The display order follows these two lists.
  const RING_INNER = [
    'home', 'calendar', 'bounty-hunter', 'scoresheets', 'finance', 'market',
    'missions', 'home-assistant', '3d-printers', 'manufacturing',
    'network-radar', 'health', 'disk-map',
  ];
  const RING_OUTER = [
    'news', 'map', 'music', 'social', 'audio-test', 'round-display',
    'spiderman', 'webshooter', 'wildcard-draw', 'gods-eye', 'memory',
    'developer', 'lock', 'ambient', 'settings',
  ];
  const RING_ORDER = [...RING_INNER, ...RING_OUTER];

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

  // Two rings: work tools on the inner circle, personal + system on the
  // outer one — a single ring can't hold this many items without labels
  // colliding.
  const orderedActions = RING_ORDER.map((id) => actions.find((a) => a.id === id)).filter(
    (a): a is RadialNavItem => Boolean(a),
  );
  const RADIUS_INNER = 168;
  const RADIUS_OUTER = 280;
  const firstRingCount = RING_INNER.length;
  const ringFor = (i: number) => (i < firstRingCount ? 0 : 1);
  const ringRadius = (ring: number) => (ring === 0 ? RADIUS_INNER : RADIUS_OUTER);
  const ringSize = RADIUS_OUTER * 2 + 170;

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
            <div className="relative" style={{ width: ringSize, height: ringSize }} onClick={(e) => e.stopPropagation()}>
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

              {/* Items on the two rings */}
              {orderedActions.map((item, i) => {
                const ring = ringFor(i);
                const inRing = ring === 0 ? i : i - firstRingCount;
                const ringCount = ring === 0 ? firstRingCount : actions.length - firstRingCount;
                const angle = (inRing / ringCount) * Math.PI * 2 - Math.PI / 2;
                const radius = ringRadius(ring);
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                const active = item.id === currentPage;
                return (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, x: 0, y: 0 }}
                    animate={{ opacity: 1, x, y }}
                    exit={{ opacity: 0, x: 0, y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 26, delay: i * 0.018 }}
                    onClick={item.action}
                    className="absolute left-1/2 top-1/2 -ml-8 -mt-8 flex flex-col items-center gap-1.5 group"
                    style={{ width: 72 }}
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
