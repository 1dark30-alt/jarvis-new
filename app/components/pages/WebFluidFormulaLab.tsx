'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { playSfxAwait, sfx, waitMs } from '../../lib/sfx';
import { notify } from '../../lib/notify';
import { WebFluidLiquidSim } from './WebFluidLiquidSim';

const ACCENT = '#22d3ee';
const ACCENT_HOT = '#67e8f9';
const DANGER = '#ef4444';
const OK = '#34d399';

type Phase = 'idle' | 'scanning' | 'ready';

type SimOverlay = {
  title: string;
  color: string;
} | null;

interface Ingredient {
  id: string;
  name: string;
  pct: number;
  step: number;
  min: number;
  max: number;
}

const DEFAULT_INGREDIENTS: Ingredient[] = [
  { id: 'water', name: 'Water', pct: 74.0, step: 0.1, min: 50, max: 90 },
  { id: 'xanthan', name: 'Xanthan Gum', pct: 0.8, step: 0.05, min: 0.1, max: 3 },
  { id: 'salt', name: 'NaCl Salt', pct: 0.35, step: 0.05, min: 0.05, max: 2 },
  { id: 'ipa', name: 'IPA', pct: 24.85, step: 0.1, min: 5, max: 45 },
];

/** Angular HUD panel shell — bump-outs / cut-ins */
const PANEL_CLIP =
  'polygon(14px 0, calc(100% - 28px) 0, 100% 18px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 22px 100%, 0 calc(100% - 22px), 0 28px)';

const PANEL_CLIP_MIRROR =
  'polygon(28px 0, calc(100% - 14px) 0, 100% 28px, 100% calc(100% - 22px), calc(100% - 22px) 100%, 14px 100%, 0 calc(100% - 14px), 0 18px)';

const BTN_CLIP =
  'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)';

const BTN_CLIP_ALT =
  'polygon(0 0, calc(100% - 10px) 0, 100% 100%, 10px 100%)';

function normalizeIngredients(list: Ingredient[]): Ingredient[] {
  const others = list.filter((i) => i.id !== 'water');
  const othersSum = others.reduce((s, i) => s + i.pct, 0);
  return list.map((i) =>
    i.id === 'water'
      ? { ...i, pct: Math.max(i.min, Math.min(i.max, +(100 - othersSum).toFixed(2))) }
      : i,
  );
}

function HudLabel({ children, size = 'sm' }: { children: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'text-[10px] tracking-[0.42em]',
    md: 'text-[12px] tracking-[0.38em]',
    lg: 'text-[14px] tracking-[0.32em]',
  };
  return (
    <div
      className={`font-mono uppercase font-semibold ${sizes[size]}`}
      style={{
        color: ACCENT,
        textShadow: `0 0 12px ${ACCENT}aa, 0 0 28px ${ACCENT}44`,
      }}
    >
      {children}
    </div>
  );
}

function HudPanel({
  children,
  className = '',
  mirror = false,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  mirror?: boolean;
  glow?: boolean;
}) {
  return (
    <div
      className={`relative ${className}`}
      style={{
        clipPath: mirror ? PANEL_CLIP_MIRROR : PANEL_CLIP,
        background: 'linear-gradient(155deg, #041018 0%, #02060c 55%, #050d14 100%)',
        boxShadow: glow
          ? `0 0 40px rgba(34,211,238,0.18), inset 0 0 60px rgba(34,211,238,0.04)`
          : `inset 0 0 40px rgba(34,211,238,0.03)`,
      }}
    >
      {/* edge stroke via inset pseudo-border */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          clipPath: mirror ? PANEL_CLIP_MIRROR : PANEL_CLIP,
          boxShadow: `inset 0 0 0 1px rgba(34,211,238,0.45), inset 0 0 24px rgba(34,211,238,0.08)`,
        }}
      />
      {/* corner ticks */}
      <span className="absolute top-2 left-4 w-5 h-[2px]" style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }} />
      <span className="absolute top-2 right-6 w-3 h-[2px]" style={{ background: ACCENT_HOT }} />
      <span className="absolute bottom-3 right-5 w-6 h-[2px]" style={{ background: ACCENT, opacity: 0.7 }} />
      <div className="relative z-[1] h-full">{children}</div>
    </div>
  );
}

function AngledButton({
  children,
  onClick,
  primary = false,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2.5 px-3 font-mono text-[9px] uppercase tracking-[0.32em] transition-all hover:brightness-125 ${className}`}
      style={{
        clipPath: primary ? BTN_CLIP : BTN_CLIP_ALT,
        color: primary ? '#021018' : ACCENT,
        background: primary
          ? `linear-gradient(90deg, ${ACCENT}, ${ACCENT_HOT})`
          : 'rgba(34,211,238,0.08)',
        boxShadow: primary
          ? `0 0 20px rgba(34,211,238,0.35)`
          : `inset 0 0 0 1px rgba(34,211,238,0.35)`,
        textShadow: primary ? 'none' : `0 0 10px ${ACCENT}66`,
      }}
    >
      {children}
    </button>
  );
}

function FuturisticSlider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="font-mono text-[9px] uppercase tracking-[0.3em]"
          style={{ color: 'rgba(165,243,252,0.7)', textShadow: `0 0 8px ${ACCENT}44` }}
        >
          {label}
        </span>
        <span
          className="font-mono text-[13px] tabular-nums font-bold"
          style={{ color: ACCENT_HOT, textShadow: `0 0 14px ${ACCENT}` }}
        >
          {display}
        </span>
      </div>
      <div className="relative h-2" style={{ clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)' }}>
        <div className="absolute inset-0" style={{ background: 'rgba(34,211,238,0.12)' }} />
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, rgba(34,211,238,0.35), ${ACCENT})`,
            boxShadow: `0 0 12px ${ACCENT}88`,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

function IngredientRow({
  item,
  onChange,
}: {
  item: Ingredient;
  onChange: (pct: number) => void;
}) {
  return (
    <div className="relative py-2.5 pl-3" style={{ borderBottom: '1px solid rgba(34,211,238,0.12)' }}>
      <span
        className="absolute left-0 top-3 bottom-3 w-[2px]"
        style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }}
      />
      <div className="flex items-baseline justify-between mb-1">
        <span
          className="font-mono text-[11px] uppercase tracking-[0.28em] font-semibold"
          style={{ color: '#e0f7fa', textShadow: `0 0 10px ${ACCENT}55` }}
        >
          {item.name}
        </span>
        <span
          className="font-mono text-[14px] tabular-nums font-bold"
          style={{ color: ACCENT, textShadow: `0 0 16px ${ACCENT}` }}
        >
          {item.pct.toFixed(2)}
          <span className="text-[9px] text-cyan-200/40 ml-1">%</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { onChange(Math.max(item.min, +(item.pct - item.step).toFixed(2))); sfx('click', 0.2); }}
          className="w-7 h-7 font-mono text-sm text-cyan-200/60 hover:text-white shrink-0"
          style={{ clipPath: BTN_CLIP_ALT, background: 'rgba(34,211,238,0.1)', boxShadow: 'inset 0 0 0 1px rgba(34,211,238,0.3)' }}
        >
          −
        </button>
        <div className="relative flex-1 h-1.5" style={{ clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)' }}>
          <div className="absolute inset-0 bg-cyan-400/10" />
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${((item.pct - item.min) / (item.max - item.min)) * 100}%`,
              background: ACCENT,
              boxShadow: `0 0 10px ${ACCENT}`,
            }}
          />
          <input
            type="range"
            min={item.min}
            max={item.max}
            step={item.step}
            value={item.pct}
            onChange={(e) => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
        <button
          type="button"
          onClick={() => { onChange(Math.min(item.max, +(item.pct + item.step).toFixed(2))); sfx('click', 0.2); }}
          className="w-7 h-7 font-mono text-sm text-cyan-200/60 hover:text-white shrink-0"
          style={{ clipPath: BTN_CLIP, background: 'rgba(34,211,238,0.1)', boxShadow: 'inset 0 0 0 1px rgba(34,211,238,0.3)' }}
        >
          +
        </button>
      </div>
    </div>
  );
}

function ConductivityMeter({ valueMs }: { valueMs: number }) {
  const uid = useId().replace(/:/g, '');
  const label = valueMs < 1.2 ? 'LOW' : valueMs < 3.2 ? 'MODERATE' : valueMs < 4.2 ? 'ELEVATED' : 'CRITICAL';
  const labelColor = valueMs >= 4.2 ? DANGER : valueMs >= 3.2 ? '#fbbf24' : OK;

  return (
    <HudPanel className="px-3 pt-3 pb-4" glow>
      <HudLabel>Conductivity</HudLabel>
      <div className="relative mx-auto mt-1 w-[220px] h-[150px]">
        <svg viewBox="0 0 220 150" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={`condArc-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0e7490" />
              <stop offset="45%" stopColor={ACCENT} />
              <stop offset="72%" stopColor="#fbbf24" />
              <stop offset="88%" stopColor={DANGER} />
              <stop offset="100%" stopColor="#7f1d1d" />
            </linearGradient>
            <filter id={`glow-${uid}`}>
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* track */}
          <path
            d="M30 120 A80 80 0 1 1 190 120"
            fill="none"
            stroke="rgba(34,211,238,0.12)"
            strokeWidth="14"
            strokeLinecap="butt"
          />
          {/* colored zone arc */}
          <path
            d="M30 120 A80 80 0 1 1 190 120"
            fill="none"
            stroke={`url(#condArc-${uid})`}
            strokeWidth="14"
            strokeLinecap="butt"
            opacity="0.95"
            filter={`url(#glow-${uid})`}
          />
          {/* high-end ticks only — no needle */}
          {[0.86, 0.92, 0.98].map((t, i) => {
            const a = (-135 + t * 270) * (Math.PI / 180);
            const x1 = 110 + Math.cos(a) * 68;
            const y1 = 110 + Math.sin(a) * 68;
            const x2 = 110 + Math.cos(a) * 82;
            const y2 = 110 + Math.sin(a) * 82;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={DANGER} strokeWidth="2" opacity={0.7 + i * 0.1} />;
          })}
        </svg>
        {/* big center readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
          <div
            className="font-mono text-[42px] leading-none font-black tabular-nums"
            style={{
              color: valueMs >= 4.2 ? DANGER : ACCENT_HOT,
              textShadow: `0 0 20px ${valueMs >= 4.2 ? DANGER : ACCENT}, 0 0 40px ${valueMs >= 4.2 ? DANGER : ACCENT}66`,
            }}
          >
            {valueMs.toFixed(2)}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.4em] text-cyan-100/45 mt-1">mS / cm</div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.45em] font-bold mt-1"
            style={{ color: labelColor, textShadow: `0 0 12px ${labelColor}` }}
          >
            {label}
          </div>
        </div>
      </div>
    </HudPanel>
  );
}

/** Benzene-style carbon hexagon lattice for xanthan polysaccharide vibe */
function CarbonHexStructure() {
  const uid = useId().replace(/:/g, '');
  const hex = (cx: number, cy: number, r: number) => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
    });
    return pts.map((p) => p.join(',')).join(' ');
  };

  const rings: { cx: number; cy: number; r: number; label?: string }[] = [
    { cx: 70, cy: 78, r: 28 },
    { cx: 118, cy: 50, r: 28 },
    { cx: 166, cy: 78, r: 28 },
    { cx: 118, cy: 106, r: 28 },
    { cx: 214, cy: 50, r: 22 },
    { cx: 42, cy: 118, r: 18 },
  ];

  return (
    <svg viewBox="0 0 260 150" className="w-full h-36">
      <defs>
        <linearGradient id={`hexFill-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.18" />
          <stop offset="100%" stopColor={ACCENT_HOT} stopOpacity="0.04" />
        </linearGradient>
        <filter id={`hexGlow-${uid}`}>
          <feGaussianBlur stdDeviation="1.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* faint grid */}
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`v${i}`} x1={20 + i * 30} y1={10} x2={20 + i * 30} y2={140} stroke={ACCENT} strokeOpacity="0.04" />
      ))}
      {rings.map((ring, i) => (
        <g key={i} filter={`url(#hexGlow-${uid})`}>
          <polygon
            points={hex(ring.cx, ring.cy, ring.r)}
            fill={`url(#hexFill-${uid})`}
            stroke={ACCENT}
            strokeWidth={i < 4 ? 1.8 : 1.2}
            strokeOpacity={i < 4 ? 0.9 : 0.55}
          />
          {/* carbon vertices */}
          {Array.from({ length: 6 }, (_, vi) => {
            const a = (Math.PI / 180) * (60 * vi - 30);
            const x = ring.cx + ring.r * Math.cos(a);
            const y = ring.cy + ring.r * Math.sin(a);
            return <circle key={vi} cx={x} cy={y} r={i < 4 ? 2.4 : 1.8} fill={ACCENT_HOT} />;
          })}
          {/* inner aromatic circle on primary rings */}
          {i < 4 && (
            <circle cx={ring.cx} cy={ring.cy} r={ring.r * 0.45} fill="none" stroke={ACCENT} strokeOpacity="0.35" strokeDasharray="3 2" />
          )}
        </g>
      ))}
      {/* side-chain O / OH markers */}
      {[
        [90, 28, 'OH'],
        [194, 22, 'O'],
        [236, 72, 'CH₂'],
        [28, 88, 'COO⁻'],
      ].map(([x, y, t], i) => (
        <g key={i}>
          <text
            x={x as number}
            y={y as number}
            fill={ACCENT_HOT}
            fontSize="8"
            fontFamily="monospace"
            fontWeight="700"
            letterSpacing="1"
          >
            {t as string}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * HUD scan window: 45° corners, inward top trapezoid, blur → clear on scan.
 * Fixed size — never reflows.
 */
function ScanWindow({
  phase,
  identified,
  scanY,
  onScan,
  fillLevel,
  simOverlay,
}: {
  phase: Phase;
  identified: boolean;
  scanY: number;
  onScan: () => void;
  fillLevel: number;
  simOverlay: SimOverlay;
}) {
  const uid = useId().replace(/:/g, '');

  // Main viewport — fills most of the viewBox (tight to edges)
  const x = 12;
  const y = 12;
  const w = 576;
  const h = 528;
  const r = x + w;
  const b = y + h;
  const c = 24; // smaller 45° corners

  const cx = x + w / 2;
  const plateLabel = identified ? '250 ML BEAKER' : 'EXPERIMENTAL MIX';

  // Inward trapezoid cut (bumps INTO the square, not outside)
  const plateW = 220;
  const plateH = 28;
  const plateHalf = plateW / 2;
  const plateBottom = y + plateH;
  const plateLeft = cx - plateHalf;
  const plateRight = cx + plateHalf;
  const plateFlare = 12;

  const framePath = [
    `M ${x + c} ${y}`,
    `H ${plateLeft - plateFlare}`,
    // dip inward
    `L ${plateLeft} ${plateBottom}`,
    `H ${plateRight}`,
    `L ${plateRight + plateFlare} ${y}`,
    `H ${r - c}`,
    `L ${r} ${y + c}`,
    `V ${b - c}`,
    `L ${r - c} ${b}`,
    `H ${x + c}`,
    `L ${x} ${b - c}`,
    `V ${y + c}`,
    `L ${x + c} ${y}`,
    'Z',
  ].join(' ');

  // Stronger / brighter frost before click; clears as scan progresses
  const blurAmt =
    phase === 'ready' ? 0 : phase === 'scanning' ? Math.max(0, 18 * (1 - scanY / 100)) : 18;
  const hazeOpacity =
    phase === 'ready' ? 0 : phase === 'scanning' ? Math.max(0, 0.28 * (1 - scanY / 100)) : 0.28;

  return (
    <motion.button
      type="button"
      onClick={onScan}
      disabled={phase === 'scanning' || phase === 'ready'}
      className="relative w-full h-full outline-none min-h-0 flex-1"
      whileHover={phase === 'idle' ? { scale: 1.002 } : undefined}
      whileTap={phase === 'idle' ? { scale: 0.998 } : undefined}
    >
      <svg
        viewBox="0 0 600 552"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
        style={{
          filter: `drop-shadow(0 0 4px ${ACCENT}) drop-shadow(0 0 14px rgba(34,211,238,0.45))`,
        }}
      >
        <defs>
          <filter id={`railGlow-${uid}`} x="-12%" y="-12%" width="124%" height="124%">
            <feGaussianBlur stdDeviation="1.15" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`vpBlur-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={blurAmt} />
          </filter>
          <clipPath id={`vp-${uid}`}>
            <path d={framePath} />
          </clipPath>
        </defs>

        {/* Interior — brighter frost blur until scan clears it */}
        <g clipPath={`url(#vp-${uid})`}>
          <rect x={x} y={y} width={w} height={h} fill="#000000" />
          {hazeOpacity > 0.01 && (
            <>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={`rgba(120,220,255,${hazeOpacity})`}
                filter={`url(#vpBlur-${uid})`}
              />
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={`rgba(255,255,255,${hazeOpacity * 0.35})`}
                filter={`url(#vpBlur-${uid})`}
              />
            </>
          )}
          {phase === 'scanning' && (
            <>
              <rect x={x} y={y} width={w} height={(scanY / 100) * h} fill="#000000" />
              <rect
                x={x + c}
                y={y + (scanY / 100) * h}
                width={w - c * 2}
                height="2"
                fill={ACCENT}
                opacity="0.95"
              />
            </>
          )}
        </g>

        {/* Sharp cyan outline (never blurred) */}
        <path
          d={framePath}
          fill="none"
          stroke={ACCENT}
          strokeWidth="1.7"
          strokeLinejoin="miter"
          strokeLinecap="square"
          filter={`url(#railGlow-${uid})`}
        />

        {/* Label in the inward trapezoid */}
        <text
          x={cx}
          y={y + plateH * 0.68}
          textAnchor="middle"
          fill={identified ? ACCENT_HOT : ACCENT}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="14"
          fontWeight="700"
          letterSpacing="4"
        >
          {plateLabel}
        </text>

        <g stroke={ACCENT} strokeWidth="1.3" fill="none" opacity="0.7" filter={`url(#railGlow-${uid})`}>
          <path d={`M ${x + c + 10} ${y} V ${y + 8}`} />
          <path d={`M ${r - c - 10} ${y} V ${y + 8}`} />
          <path d={`M ${x + c + 10} ${b} V ${b - 8}`} />
          <path d={`M ${r - c - 10} ${b} V ${b - 8}`} />
          <path d={`M ${x} ${y + c + 10} H ${x + 8}`} />
          <path d={`M ${x} ${b - c - 10} H ${x + 8}`} />
          <path d={`M ${r} ${y + c + 10} H ${r - 8}`} />
          <path d={`M ${r} ${b - c - 10} H ${r - 8}`} />
        </g>
      </svg>

      {/* Invisible beaker liquid sim — only after vessel scan */}
      {phase === 'ready' && (
        <div className="absolute inset-[3%] overflow-hidden pointer-events-none">
          <WebFluidLiquidSim fill={fillLevel} />
        </div>
      )}

      {/* Simulation status overlay — title only, no captions */}
      {simOverlay && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 px-4 text-center">
          <div
            className="font-mono font-black uppercase tracking-[0.28em] leading-none"
            style={{
              color: simOverlay.color,
              fontSize:
                simOverlay.title === 'FAILED' || simOverlay.title === 'SUCCESS'
                  ? 'clamp(4.5rem, 12vw, 8.5rem)'
                  : 'clamp(1.5rem, 3.5vw, 2.4rem)',
              textShadow: `0 0 28px ${simOverlay.color}, 0 0 64px ${simOverlay.color}99, 0 0 120px ${simOverlay.color}55`,
            }}
          >
            {simOverlay.title}
          </div>
        </div>
      )}
    </motion.button>
  );
}


export function WebFluidFormulaLab({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [scanY, setScanY] = useState(0);
  const [ingredients, setIngredients] = useState(DEFAULT_INGREDIENTS);
  const [viscosity, setViscosity] = useState(62);
  const [elasticity, setElasticity] = useState(48);
  const [adhesion, setAdhesion] = useState(57);
  const [identified, setIdentified] = useState(false);
  const [fillLevel, setFillLevel] = useState(0);
  const fillLevelRef = useRef(0);
  const [simOverlay, setSimOverlay] = useState<SimOverlay>(null);
  const [testing, setTesting] = useState(false);
  const [stirring, setStirring] = useState(false);
  const testLock = useRef(false);

  const conductivity = useMemo(() => {
    const salt = ingredients.find((i) => i.id === 'salt')?.pct ?? 0.35;
    const ipa = ingredients.find((i) => i.id === 'ipa')?.pct ?? 25;
    return +(0.8 + salt * 2.1 + (100 - ipa) * 0.012 + adhesion * 0.004).toFixed(2);
  }, [ingredients, adhesion]);

  useEffect(() => {
    if (phase !== 'scanning') return;
    let raf = 0;
    const start = performance.now();
    const duration = 2200;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setScanY(t * 100);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setIdentified(true);
        sfx('notification', 0.45);
        window.setTimeout(() => {
          setPhase('ready');
          sfx('select_confirm', 0.4);
        }, 400);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const startScan = () => {
    if (phase !== 'idle') return;
    sfx('select', 0.45);
    setScanY(0);
    setPhase('scanning');
  };

  const animateFillTo = (target: number, ms: number) =>
    new Promise<void>((resolve) => {
      const startFill = fillLevelRef.current;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const next = startFill + (target - startFill) * eased;
        fillLevelRef.current = next;
        setFillLevel(next);
        if (t < 1) requestAnimationFrame(step);
        else {
          fillLevelRef.current = target;
          setFillLevel(target);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });

  /** Ensure React paints overlay before starting voice line */
  const showOverlay = async (overlay: NonNullable<SimOverlay>) => {
    setSimOverlay(overlay);
    await waitMs(80);
  };

  const runFluidTest = async () => {
    if (phase !== 'ready' || testLock.current) return;
    testLock.current = true;
    setTesting(true);
    setStirring(true);
    sfx('select', 0.4);

    try {
      // 1) Simulating web fluid
      await showOverlay({ title: 'SIMULATING...', color: ACCENT_HOT });
      await animateFillTo(0.88, 1600);
      await playSfxAwait('jarvis_simulating_web_fluid', 0.95);

      // 2) Simulating
      await playSfxAwait('jarvis_simulating', 0.95);

      // 3) Failed
      await showOverlay({ title: 'FAILED', color: DANGER });
      sfx('error', 0.35);
      await playSfxAwait('jarvis_failed', 1);
      await waitMs(500);
      await animateFillTo(0, 1100);
      setSimOverlay(null);
      await waitMs(300);

      // 4) Simulating
      await showOverlay({ title: 'SIMULATING...', color: ACCENT_HOT });
      await animateFillTo(0.9, 1400);
      await playSfxAwait('jarvis_simulating', 0.95);

      // 5) Failed
      await showOverlay({ title: 'FAILED', color: DANGER });
      sfx('error', 0.35);
      await playSfxAwait('jarvis_failed', 1);
      await waitMs(500);
      await animateFillTo(0, 1100);
      setSimOverlay(null);
      await waitMs(300);

      // 6) Simulating
      await showOverlay({ title: 'SIMULATING...', color: ACCENT_HOT });
      await animateFillTo(0.92, 1500);
      await playSfxAwait('jarvis_simulating', 0.95);

      // 7) Success web fluid (no standalone success)
      await showOverlay({ title: 'SUCCESS', color: OK });
      await playSfxAwait('jarvis_success_web_fluid', 1);

      // 8) Active ingredients
      await playSfxAwait('jarvis_active_ingredients', 1);
      await waitMs(600);
      notify('Web Fluid Ready', 'Formula V1 passed simulation.', 'success');
    } finally {
      setStirring(false);
      setTesting(false);
      testLock.current = false;
    }
  };

  const setIngredient = (id: string, pct: number) => {
    setIngredients((prev) =>
      normalizeIngredients(prev.map((i) => (i.id === id ? { ...i, pct } : i))),
    );
  };

  const saveFormula = () => {
    try {
      localStorage.setItem(
        'jarvis_web_fluid_formula_v1',
        JSON.stringify({ ingredients, viscosity, elasticity, adhesion, conductivity, savedAt: Date.now() }),
      );
      sfx('select_confirm', 0.5);
      notify('Formula Saved', 'Web Fluid Formula V1 stored locally.', 'success');
    } catch {
      notify('Save Failed', 'Could not write formula to storage.', 'error');
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {/* Fully opaque black lab — no designer bleed-through */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% 0%, rgba(8,47,73,0.45) 0%, transparent 55%),
            radial-gradient(ellipse 60% 40% at 80% 80%, rgba(34,211,238,0.06) 0%, transparent 50%),
            linear-gradient(180deg, #000000 0%, #02060a 40%, #000000 100%)
          `,
        }}
        onClick={onClose}
      />
      {/* subtle scanlines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,211,238,0.4) 3px)',
        }}
      />

      {/* Title */}
      <div className="relative z-10 pt-5 pb-1 text-center pointer-events-none select-none">
        <div className="flex items-center justify-center gap-4">
          <span className="hidden sm:block w-16 h-[1px]" style={{ background: `linear-gradient(90deg, transparent, ${ACCENT})` }} />
          <h1
            className="font-mono text-2xl md:text-4xl font-black uppercase"
            style={{
              color: ACCENT_HOT,
              letterSpacing: '0.42em',
              textShadow: `0 0 20px ${ACCENT}, 0 0 48px ${ACCENT}88, 0 2px 0 #021018`,
            }}
          >
            Web Fluid Formula
          </h1>
          <span className="hidden sm:block w-16 h-[1px]" style={{ background: `linear-gradient(90deg, ${ACCENT}, transparent)` }} />
        </div>
        <div className="mt-2 flex items-center justify-center gap-3">
          <span
            className="font-mono text-[11px] font-bold uppercase px-3 py-0.5"
            style={{
              clipPath: BTN_CLIP,
              color: '#021018',
              background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_HOT})`,
              letterSpacing: '0.35em',
              boxShadow: `0 0 18px ${ACCENT}66`,
            }}
          >
            V1
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.5em]"
            style={{ color: 'rgba(165,243,252,0.45)', textShadow: `0 0 10px ${ACCENT}33` }}
          >
            Experimental Mix · Web Lab
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute top-5 right-5 z-20 font-mono text-[9px] uppercase tracking-[0.35em] px-4 py-2 text-cyan-100/60 hover:text-white"
        style={{
          clipPath: BTN_CLIP,
          background: 'rgba(34,211,238,0.06)',
          boxShadow: 'inset 0 0 0 1px rgba(34,211,238,0.4)',
        }}
      >
        Close Lab
      </button>

      <div
        className="relative z-10 flex-1 flex items-stretch gap-2 px-2 pb-3 min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Ingredients — always present so center never shifts */}
        <aside className="w-[210px] xl:w-[230px] shrink-0 flex flex-col min-h-0">
          <HudPanel className="flex-1 flex flex-col min-h-0 px-4 py-4" glow>
            <HudLabel size="md">Ingredients</HudLabel>
            <div className="flex-1 overflow-y-auto min-h-0 mt-2 pr-1">
              {ingredients.map((item) => (
                <IngredientRow key={item.id} item={item} onChange={(pct) => setIngredient(item.id, pct)} />
              ))}
            </div>
            <div className="flex gap-2 mt-4 shrink-0">
              <AngledButton
                className="flex-1"
                onClick={() => { setIngredients(DEFAULT_INGREDIENTS); sfx('click', 0.25); }}
              >
                Presets
              </AngledButton>
              <AngledButton className="flex-1" primary onClick={saveFormula}>
                Save Formula
              </AngledButton>
            </div>
          </HudPanel>
        </aside>

        {/* Center window — fills remaining space, tight to side panels */}
        <div className="flex-1 flex flex-col items-stretch justify-center min-w-0 gap-2 min-h-0">
          <ScanWindow
            phase={phase}
            identified={identified}
            scanY={scanY}
            onScan={startScan}
            fillLevel={fillLevel}
            simOverlay={simOverlay}
          />

          <div className="w-full shrink-0">
            <HudPanel className="px-5 py-3">
              <HudLabel>Formulation</HudLabel>
              <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 mt-2">
                {ingredients.map((i) => (
                  <div key={i.id} className="flex justify-between font-mono text-[10px]">
                    <span className="uppercase tracking-[0.2em] text-cyan-100/45">{i.name}</span>
                    <span className="font-bold tabular-nums" style={{ color: ACCENT, textShadow: `0 0 8px ${ACCENT}` }}>
                      {i.pct.toFixed(2)}%
                    </span>
                  </div>
                ))}
                <div
                  className="col-span-2 flex justify-between font-mono text-[11px] pt-2 mt-1"
                  style={{ borderTop: '1px solid rgba(34,211,238,0.2)' }}
                >
                  <span className="uppercase tracking-[0.3em] text-cyan-100/40">Total</span>
                  <span className="font-black" style={{ color: OK, textShadow: `0 0 12px ${OK}` }}>
                    {ingredients.reduce((s, i) => s + i.pct, 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            </HudPanel>
          </div>
        </div>

        {/* Right analysis — always present */}
        <aside className="w-[230px] xl:w-[250px] shrink-0 flex flex-col min-h-0 gap-2 overflow-y-auto">
          <HudPanel className="px-4 py-3" mirror glow>
            <HudLabel>Compound Structure</HudLabel>
            <CarbonHexStructure />
            <p
              className="font-mono text-[8px] text-center uppercase tracking-[0.25em] mt-1"
              style={{ color: 'rgba(165,243,252,0.5)', textShadow: `0 0 8px ${ACCENT}33` }}
            >
              (C₃₅H₄₉O₂₉)ₙ · Polysaccharide Xanthan
            </p>
          </HudPanel>

          <HudPanel className="px-4 py-3 flex flex-col gap-1" mirror>
            <HudLabel>Tune Properties</HudLabel>
            <FuturisticSlider
              label="Viscosity"
              value={viscosity}
              display={`${viscosity}%`}
              min={0}
              max={100}
              step={1}
              onChange={setViscosity}
            />
            <FuturisticSlider
              label="Elasticity"
              value={elasticity}
              display={`${elasticity}%`}
              min={0}
              max={100}
              step={1}
              onChange={setElasticity}
            />
            <FuturisticSlider
              label="Adhesion"
              value={adhesion}
              display={`${adhesion}%`}
              min={0}
              max={100}
              step={1}
              onChange={setAdhesion}
            />
          </HudPanel>

          <ConductivityMeter valueMs={conductivity} />

          <HudPanel className="px-4 py-3" mirror>
            <div className="font-mono text-[8px] uppercase tracking-[0.35em] text-cyan-100/40 mb-2">
              Mixture Status
            </div>
            <button
              type="button"
              disabled={phase !== 'ready' || testing}
              onClick={() => { void runFluidTest(); }}
              className="w-full py-3 font-mono text-[12px] font-black uppercase tracking-[0.35em] transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={{
                clipPath: BTN_CLIP,
                color: testing ? ACCENT_HOT : '#021018',
                background: testing
                  ? 'rgba(34,211,238,0.12)'
                  : `linear-gradient(90deg, ${OK}, #6ee7b7)`,
                boxShadow: testing
                  ? `inset 0 0 0 1px ${ACCENT}66, 0 0 18px ${ACCENT}33`
                  : `0 0 22px ${OK}55`,
                textShadow: testing ? `0 0 12px ${ACCENT}` : 'none',
              }}
            >
              {testing ? 'Testing…' : 'Ready to Test'}
            </button>
            <div className="mt-2 font-mono text-[8px] uppercase tracking-[0.28em] text-cyan-100/30">
              Stirring: {stirring ? 'On' : 'Off'} · Temp: 22.3 °C
            </div>
          </HudPanel>
        </aside>
      </div>
    </motion.div>
  );
}
