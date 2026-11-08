'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sfx } from '../lib/sfx';
import { isInterfaceLocked } from './LockScreen';

interface Command {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void;
}

function dispatch(name: string, detail?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

const PAGES: { page: string; label: string }[] = [
  { page: 'home', label: 'Home' },
  { page: 'news', label: 'News Feed' },
  { page: 'map', label: 'Map' },
  { page: 'calendar', label: 'Calendar' },
  { page: 'home-assistant', label: 'Smart Home' },
  { page: '3d-printers', label: '3D Printers' },
  { page: 'music', label: 'Music Player' },
  { page: 'spiderman', label: 'Suit Armory' },
  { page: 'manufacturing', label: 'Fabrication Bay' },
  { page: 'webshooter', label: 'Webshooter Designer' },
  { page: 'social', label: 'Social Command' },
  { page: 'audio-test', label: 'Audio Lab' },
  { page: 'round-display', label: 'Round Display' },
  { page: 'bounty-hunter', label: 'Bounty Hunter' },
  { page: 'wildcard-draw', label: 'Wildcard Draw' },
  { page: 'gods-eye', label: "God's Eye" },
  { page: 'disk-map', label: 'Disk Map' },
  { page: 'build-guide', label: 'Build Guide' },
  { page: 'missions', label: 'Missions' },
  { page: 'memory', label: 'Memory' },
  { page: 'health', label: 'Health' },
  { page: 'dev-mode', label: 'Developer' },
  { page: 'market', label: 'Market' },
  { page: 'network-radar', label: 'Network Radar' },
];

const WIDGETS: { widget: string; label: string }[] = [
  { widget: 'clock', label: 'Clock' },
  { widget: 'system', label: 'System Status' },
  { widget: 'network', label: 'Network Traffic' },
  { widget: 'map', label: 'Mini Map' },
  { widget: 'suit', label: 'MK.2 Armor' },
  { widget: 'music', label: 'Now Playing' },
  { widget: 'terminal', label: 'Error Terminal' },
  { widget: 'weather-home', label: 'Weather' },
  { widget: 'weather-radar', label: 'Weather Radar' },
  { widget: 'agenda', label: 'Agenda' },
  { widget: 'stocks', label: 'Stocks Ticker' },
  { widget: 'headlines', label: 'News Headlines' },
  { widget: 'timer', label: 'Timers' },
  { widget: 'todo', label: 'Task List' },
  { widget: 'camera-feed', label: 'Camera Feed' },
  { widget: 'uptime', label: 'Host Monitor' },
  { widget: 'orbit', label: 'Orbital Tracker' },
  { widget: 'calculator', label: 'Calculator' },
];

/**
 * Cmd+K / Ctrl+K quick launcher. Fuzzy-searches pages, HUD widgets, and
 * system actions, reusing the same window events the voice tools dispatch.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isInterfaceLocked()) return;
        sfx('sfx_settings_open', 0.35);
        setOpen((o) => !o);
        setQuery('');
        setSelected(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const commands: Command[] = useMemo(() => [
    ...PAGES.map((p) => ({
      id: `page-${p.page}`,
      label: `Go to ${p.label}`,
      hint: 'PAGE',
      keywords: `navigate open page ${p.label} ${p.page}`,
      run: () => dispatch('jarvis:navigate', { page: p.page }),
    })),
    ...WIDGETS.map((w) => ({
      id: `widget-${w.widget}`,
      label: `Open ${w.label} widget`,
      hint: 'WIDGET',
      keywords: `widget hud add show ${w.label} ${w.widget}`,
      run: () => dispatch('jarvis:hud', { command: 'open', widget: w.widget }),
    })),
    {
      id: 'act-lock',
      label: 'Lock interface',
      hint: 'SYSTEM',
      keywords: 'lock pin secure lockdown',
      run: () => dispatch('jarvis:lock'),
    },
    {
      id: 'act-ambient',
      label: 'Ambient mode',
      hint: 'SYSTEM',
      keywords: 'ambient screensaver idle clock standby',
      run: () => dispatch('jarvis:ambient'),
    },
    {
      id: 'act-settings',
      label: 'Open settings',
      hint: 'SYSTEM',
      keywords: 'settings configuration preferences setup',
      run: () => dispatch('jarvis:open-settings'),
    },
    {
      id: 'act-hud-clear',
      label: 'Clear all HUD widgets',
      hint: 'HUD',
      keywords: 'clear remove close widgets hud',
      run: () => dispatch('jarvis:hud', { command: 'clear' }),
    },
    {
      id: 'act-hud-reset',
      label: 'Reset HUD to default layout',
      hint: 'HUD',
      keywords: 'reset default layout widgets hud',
      run: () => dispatch('jarvis:hud', { command: 'reset' }),
    },
    {
      id: 'act-layout-save',
      label: 'Save current HUD layout as preset…',
      hint: 'HUD',
      keywords: 'save layout preset workspace',
      run: () => {
        const name = window.prompt('Preset name (e.g. "workshop"):');
        if (name?.trim()) dispatch('jarvis:hud', { command: 'save_layout', layout_name: name.trim() });
      },
    },
    {
      id: 'act-fullscreen',
      label: 'Toggle fullscreen',
      hint: 'SYSTEM',
      keywords: 'fullscreen maximize window',
      run: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      },
    },
  ], []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q),
    );
  }, [commands, query]);

  const runCommand = (cmd: Command) => {
    sfx('select', 0.5);
    setOpen(false);
    cmd.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[75] flex items-start justify-center pt-[18vh]"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-lg bg-black/90 border border-cyan-500/40 overflow-hidden"
            style={{
              boxShadow: '0 0 40px var(--accent-glow, rgba(34,211,238,0.3))',
              clipPath: 'polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px))',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-cyan-500/20 bg-cyan-950/20">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--accent-hex, #22d3ee)" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
                  if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
                  if (e.key === 'Enter' && filtered[selected]) runCommand(filtered[selected]);
                }}
                placeholder="Type a command — pages, widgets, actions…"
                className="flex-1 bg-transparent outline-none font-mono text-sm text-cyan-100 placeholder:text-white/25"
              />
              <span className="font-mono text-[9px] text-white/25 uppercase tracking-widest border border-white/10 rounded px-1.5 py-0.5">ESC</span>
            </div>

            <div className="max-h-[45vh] overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="px-4 py-6 text-center font-mono text-[11px] text-white/30 uppercase tracking-widest">No matching commands</p>
              )}
              {filtered.map((cmd, i) => (
                <button
                  key={cmd.id}
                  onClick={() => runCommand(cmd)}
                  onMouseEnter={() => setSelected(i)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors"
                  style={{ background: i === selected ? 'rgba(var(--accent-rgb, 34, 211, 238), 0.12)' : 'transparent' }}
                >
                  <span className={`font-mono text-[12px] ${i === selected ? 'text-cyan-300' : 'text-white/60'}`}>
                    {cmd.label}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-white/25">{cmd.hint}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
