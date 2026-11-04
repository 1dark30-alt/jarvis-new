'use client';

import React from 'react';

interface PageHeaderProps {
  /** Short page title, displayed as "JARVIS · TITLE" */
  title: string;
  onNavigateHome: () => void;
  /** Accent colour for the pulse dot. Defaults to cyan. */
  accent?: 'cyan' | 'green' | 'orange' | 'red';
  /** Optional content rendered on the right side of the header */
  right?: React.ReactNode;
}

export function PageHeader({ title, onNavigateHome, accent = 'cyan', right }: PageHeaderProps) {
  const dotColor = {
    cyan:   'bg-cyan-400',
    green:  'bg-emerald-400',
    orange: 'bg-orange-400',
    red:    'bg-red-400',
  }[accent];

  const labelColor = {
    cyan:   '#22d3ee',
    green:  '#34d399',
    orange: '#fb923c',
    red:    '#f87171',
  }[accent];

  return (
    <div
      className="relative z-10 flex items-center justify-between px-6 py-3 shrink-0"
      style={{
        background: 'rgba(2,4,10,0.88)',
        borderBottom: '1px solid rgba(34,211,238,0.1)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      {/* Left: back button + title */}
      <div className="flex items-center gap-4">
        <button
          onClick={onNavigateHome}
          className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-white/35 hover:text-cyan-400 transition-colors"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Home
        </button>

        <div className="w-px h-4 bg-white/10" />

        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${dotColor}`} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: labelColor }}>
            Jarvis
          </span>
          <span className="font-mono text-[10px] text-white/25 uppercase tracking-widest">· {title}</span>
        </div>
      </div>

      {/* Right: caller-supplied controls */}
      {right && (
        <div className="flex items-center gap-3">
          {right}
        </div>
      )}
    </div>
  );
}
