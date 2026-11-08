'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';
import {
  layout, kindColor, COLORS, BADGE_R, LEGEND_H,
  type DiagramPlan,
} from '../../lib/buildDiagram';

/**
 * Build Guide — connection diagrams for electronics builds, drawn from a
 * structured plan, never from an image model. Port of the JARVIS-system
 * build_guide diagram engine.
 *
 * Every label on the diagram is a label the model committed to in text —
 * the renderer places it, it never invents a pin. Hover a build step to
 * highlight the wires it mentions (matched by the wire numbers).
 */

const PLAN_KEY = 'jarvis_build_guide_plan';

const FONTS: Record<string, string> = {
  title: '600 22px ui-monospace, monospace',
  name: '600 15px ui-monospace, monospace',
  detail: '12px ui-monospace, monospace',
  pin: '13px ui-monospace, monospace',
  badge: '600 11px ui-monospace, monospace',
  legend: '13px ui-monospace, monospace',
};

export function BuildGuidePage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [plan, setPlan] = useState<DiagramPlan | null>(null);
  const [hoverStep, setHoverStep] = useState<number | null>(null);
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const load = () => {
      try {
        const raw = sessionStorage.getItem(PLAN_KEY);
        if (raw) setPlan(JSON.parse(raw));
      } catch { /* ignore */ }
    };
    load();
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as DiagramPlan | undefined;
      if (detail) setPlan(detail);
    };
    window.addEventListener('jarvis:build-guide', onEvent);
    return () => window.removeEventListener('jarvis:build-guide', onEvent);
  }, []);

  const geo = useMemo(() => {
    if (!plan?.components?.length || !plan?.connections?.length) return null;
    let ctx = measureRef.current;
    if (!ctx && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      ctx = c.getContext('2d');
      measureRef.current = ctx;
    }
    const measure = (text: string, role: string): number => {
      if (ctx) {
        ctx.font = FONTS[role] ?? FONTS.pin;
        return ctx.measureText(text).width;
      }
      return text.length * 7.5;
    };
    return layout(plan, measure);
  }, [plan]);

  const highlightSet = useMemo(() => {
    if (hoverStep === null || !plan?.connections?.length) return null;
    return new Set(
      plan.connections
        .filter((w) => (w.n ?? 0) === hoverStep)
        .map((_, i) => String(i + 1))
    );
  }, [hoverStep, plan]);

  const legendWords = useMemo(() => {
    const used = new Set((plan?.connections ?? []).map((w) => w.kind || 'signal'));
    const defaults: Record<string, string> = {
      power: 'power', ground: 'ground', signal: 'signal', data: 'data',
      analog: 'analog', mechanical: 'mechanical', other: 'other',
    };
    return [...used].map((k) => ({ kind: k, word: plan?.legend?.[k] || defaults[k] || k }));
  }, [plan]);

  if (!geo || !plan) {
    return (
      <motion.div
        key="build-guide-page"
        className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
        initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
        animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
        exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
        transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
      >
        <PageHeader title="Build Guide" onNavigateHome={onNavigateHome} accent="green" />
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md text-center px-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-400/70 mb-4">
              ◉ Awaiting build plan
            </div>
            <p className="text-white/60 text-sm leading-relaxed">
              Ask Jarvis to plan a build — &ldquo;Jarvis, how do I wire an Arduino to a servo?&rdquo; —
              and the connection diagram will be drawn here, with numbered wires matching the
              build steps. Every pin on the diagram comes from the spoken answer; the picture
              adds nothing of its own.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  const sidePanel = (plan.steps?.length ?? 0) > 0;
  const svgW = geo.canvasW;
  const svgH = geo.canvasH;

  return (
    <motion.div
      key="build-guide-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Build Guide"
        onNavigateHome={onNavigateHome}
        accent="green"
        right={
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">
            Drawn from the plan · nothing invented
          </span>
        }
      />

      <div className="flex-1 min-h-0 flex gap-4 px-6 py-4">
        {/* diagram */}
        <div className="flex-1 min-w-0 overflow-auto rounded-lg" style={{ background: COLORS.bg, border: '1px solid rgba(52,211,153,0.15)' }}>
          <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block' }}>
            <rect width={svgW} height={svgH} fill={COLORS.bg} />
            <rect width={svgW} height={svgH} fill={COLORS.grid} opacity={0.35} />
            <text x={36} y={36 + 6} fill={COLORS.text} fontSize={22} fontFamily="ui-monospace, monospace" fontWeight={600}>
              {plan.title || 'BUILD DIAGRAM'}
            </text>

            {/* wires */}
            {geo.wires.map((wire, i) => {
              const dim = highlightSet ? !highlightSet.has(String(wire.n)) : false;
              const d = wire.pts.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
              return (
                <g key={i} opacity={dim ? 0.15 : 1}>
                  <path d={d} fill="none" stroke={wire.color} strokeWidth={highlightSet?.has(String(wire.n)) ? 4.5 : 3} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}

            {/* badges — numbered next to the part each wire leaves */}
            {geo.wires.map((wire, i) => {
              const start = wire.pts[0];
              const box = Object.values(geo.boxes).find((b) => Math.abs((b.x === start.x ? b.x : b.x + b.w) - start.x) < 0.5);
              void box;
              const outward = wire.pts[1].x < start.x ? -1 : wire.pts.length > 2 ? (wire.pts[1].x === start.x ? 0 : 1) : 1;
              const bx = start.x + (outward === 0 ? 0 : outward * (BADGE_R + 8));
              const by = start.y - (outward === 0 ? BADGE_R + 6 : 0);
              const dim = highlightSet ? !highlightSet.has(String(wire.n)) : false;
              return (
                <g key={`b${i}`} opacity={dim ? 0.15 : 1}>
                  <circle cx={bx} cy={by} r={BADGE_R} fill={COLORS.bg} stroke={wire.color} strokeWidth={1.6} />
                  <text x={bx} y={by + 4} textAnchor="middle" fill={wire.color} fontSize={11} fontFamily="ui-monospace, monospace" fontWeight={600}>
                    {wire.n}
                  </text>
                </g>
              );
            })}

            {/* part boxes */}
            {Object.entries(geo.boxes).map(([cid, b]) => {
              const comp = plan.components!.find((c) => c.id === cid)!;
              return (
                <g key={cid}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill={COLORS.boxFill} stroke={COLORS.boxEdge} strokeWidth={1.4} />
                  <line x1={b.x} y1={b.y + 44} x2={b.x + b.w} y2={b.y + 44} stroke={COLORS.boxEdge} strokeWidth={1} />
                  <text x={b.x + 12} y={b.y + 24} fill={COLORS.text} fontSize={15} fontFamily="ui-monospace, monospace" fontWeight={600}>
                    {comp.name || cid}
                  </text>
                  {comp.detail && (
                    <text x={b.x + 12} y={b.y + 40} fill={COLORS.textDim} fontSize={12} fontFamily="ui-monospace, monospace">
                      {comp.detail}
                    </text>
                  )}
                  {/* pin labels */}
                  {(comp.pins ?? []).length === 0 ? null : (comp.pins ?? []).map((pin) => {
                    const lY = geo.pinY[`${cid}|${pin.id}|L`];
                    const rY = geo.pinY[`${cid}|${pin.id}|R`];
                    const label = pin.label || pin.id;
                    return (
                      <g key={pin.id}>
                        {lY !== undefined && (
                          <>
                            <circle cx={b.x} cy={lY} r={2.4} fill={COLORS.pinText} />
                            <text x={b.x + 10} y={lY + 4.5} fill={COLORS.pinText} fontSize={13} fontFamily="ui-monospace, monospace">
                              {label}
                            </text>
                          </>
                        )}
                        {rY !== undefined && (
                          <>
                            <circle cx={b.x + b.w} cy={rY} r={2.4} fill={COLORS.pinText} />
                            <text x={b.x + b.w - 10} y={rY + 4.5} textAnchor="end" fill={COLORS.pinText} fontSize={13} fontFamily="ui-monospace, monospace">
                              {label}
                            </text>
                          </>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* legend */}
            <g transform={`translate(36 ${geo.legendY})`}>
              {legendWords.map((l, i) => {
                const color = kindColor(l.kind, i);
                const x = i * 150;
                return (
                  <g key={l.kind} transform={`translate(${x} ${LEGEND_H / 2})`}>
                    <line x1={0} y1={0} x2={26} y2={0} stroke={color} strokeWidth={3} strokeLinecap="round" />
                    <text x={34} y={4.5} fill={COLORS.textDim} fontSize={13} fontFamily="ui-monospace, monospace">
                      {l.word}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* steps */}
        {sidePanel && (
          <div className="w-80 shrink-0 overflow-y-auto rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-3">Build steps</div>
            <ol className="space-y-2">
              {(plan.steps ?? []).map((step, i) => {
                const n = i + 1;
                const active = hoverStep === n;
                return (
                  <li
                    key={i}
                    onMouseEnter={() => setHoverStep(n)}
                    onMouseLeave={() => setHoverStep(null)}
                    className={`flex gap-3 rounded-md p-2 transition-colors ${active ? 'bg-emerald-500/10' : ''}`}
                  >
                    <span
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-mono text-[11px] font-bold"
                      style={{ border: `1.6px solid ${active ? '#34d399' : COLORS.boxEdge}`, color: active ? '#34d399' : COLORS.textDim }}
                    >
                      {n}
                    </span>
                    <span className="text-[13px] leading-relaxed text-white/75">{step}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </motion.div>
  );
}