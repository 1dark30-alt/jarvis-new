'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { STLLoader } from 'three-stdlib';
import { AnimatePresence, animate, motion } from 'framer-motion';
import * as THREE from 'three';
import { PageHeader } from '../PageHeader';
import { sfx } from '../../lib/sfx';
import { notify } from '../../lib/notify';
import { ACCESSORIES } from './SpidermanPage';
import { filterQuadrant, type Quad } from './WebshooterPage';

// ── Types & catalogs ──────────────────────────────────────────────────────────
export interface BuildPart {
  file: string;
  /** Strip stray triangles outside this base quadrant (multi-cart exports) */
  quad?: Quad;
  /** Re-seat onto the first part: centered, sunk into its top channel */
  align?: 'center-top';
  /** Slide forward out the front (armed / extended trigger position) */
  extended?: boolean;
}

export interface BuildModel {
  file: string;
  name: string;
  sub: string;
  /** Optional multi-part assembly (STLs sharing one coordinate space) */
  parts?: BuildPart[];
}

interface Machine {
  id: string;
  name: string;
  type: string;
  img: string;
}

const MACHINES: Machine[] = [
  { id: 'x1c',     name: 'X1 Carbon',   type: 'FDM · Bambu Lab',      img: '/assets/Printers/X1C.png' },
  { id: 'h2d',     name: 'H2D',         type: 'FDM · Bambu Lab',      img: '/assets/Printers/H2D.png' },
  { id: 'p1s',     name: 'P1S',         type: 'FDM · Bambu Lab',      img: '/assets/Printers/P1S.png' },
  { id: 'p1p',     name: 'P1P',         type: 'FDM · Bambu Lab',      img: '/assets/Printers/P1P.png' },
  { id: 'a1',      name: 'A1',          type: 'FDM · Bambu Lab',      img: '/assets/Printers/A1.png' },
  { id: 'a1mini',  name: 'A1 Mini',     type: 'FDM · Bambu Lab',      img: '/assets/Printers/A1mini.png' },
  { id: 'form4l',  name: 'Form 4L',     type: 'Resin SLA · Formlabs', img: '/assets/ResinPrinter/Form 4L.png' },
  { id: 'f1ultra', name: 'F1 Ultra',    type: 'Laser · xTool',        img: '/assets/Laser/F1 Ultra.png' },
  { id: 'carvera', name: 'Carvera Air', type: 'CNC Mill · Makera',    img: '/assets/CNC/Carvera Air.png' },
];

const ACCENT = '#22d3ee';
const ACCENT_DIM = 'rgba(34,211,238,';

/** Per-machine overlay tweaks for the spinning model inside the machine image.
 *  `topPct` is the CSS `top` of the model (50 = centered). `boost` scales lights. */
const MACHINE_OVERLAY: Record<string, { topPct: number; boost: number }> = {
  carvera: { topPct: 65, boost: 1.8 }, // 15% below center so it sits on the bed
};
const DEFAULT_OVERLAY = { topPct: 50, boost: 1 };

// Each job gets a random estimate between 1h and 5h55m
function randomBuildDurationMs(): number {
  const minutes = 60 + Math.floor(Math.random() * (355 - 60 + 1));
  return minutes * 60_000;
}

function spokenDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hPart = h > 0 ? `${h} hour${h === 1 ? '' : 's'}` : '';
  const mPart = m > 0 ? `${m} minute${m === 1 ? '' : 's'}` : '';
  return [hPart, mPart].filter(Boolean).join(' ') || 'a moment';
}
const WHEEL_SPACING = 170; // px between machine centers on the selection wheel

interface BuildJob {
  machine: Machine;
  model: BuildModel;
  startedAt: number;
  endsAt: number;
}

// Survives page navigation: the countdown keeps running while the user is
// elsewhere and is restored when they come back.
let ACTIVE_JOB: BuildJob | null = null;

// ── Spinning, auto-fit 3D model (GLB or STL) ─────────────────────────────────
function FittedSpin({ object }: { object: THREE.Object3D }) {
  const spin = useRef<THREE.Group>(null);

  const { scale, offset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    return {
      scale: 2.1 / maxDim,
      offset: [-center.x, -center.y, -center.z] as const,
    };
  }, [object]);

  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += delta * 0.7;
  });

  return (
    <group ref={spin}>
      <group scale={scale}>
        <group position={offset}>
          <primitive object={object} />
        </group>
      </group>
    </group>
  );
}

function GltfSpin({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  // Clone so this canvas never steals the object from another mounted view
  // (e.g. the armory or a second viewer during transition overlap).
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <FittedSpin object={cloned} />;
}

const STL_MATERIAL_PROPS = { color: '#b8bcc4', metalness: 0.25, roughness: 0.45 } as const;

function StlSpin({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  const object = useMemo(() => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(STL_MATERIAL_PROPS));
    mesh.rotation.x = -Math.PI / 2; // STL exports are commonly Z-up
    group.add(mesh);
    return group;
  }, [geometry]);
  return <FittedSpin object={object} />;
}

// Multi-part STL assembly: every part is modeled in the same coordinate space,
// so rendering them together reproduces the assembled unit
function AssemblySpin({ parts }: { parts: BuildPart[] }) {
  const geoms = useLoader(STLLoader, parts.map((p) => p.file));
  const object = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial(STL_MATERIAL_PROPS);
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2;
    geoms[0].computeBoundingBox();
    const baseBB = geoms[0].boundingBox!;
    geoms.forEach((g, i) => {
      const quad = parts[i].quad;
      const geom = quad ? filterQuadrant(g, quad) : g;
      const mesh = new THREE.Mesh(geom, mat);
      if (parts[i].align === 'center-top') {
        geom.computeBoundingBox();
        const pb = geom.boundingBox!;
        const baseSize = baseBB.getSize(new THREE.Vector3());
        // Same forward travel as the designer when Manual Detonation is armed
        const extendY = parts[i].extended
          ? Math.max(baseSize.x, baseSize.y, baseSize.z) * 0.48
          : 0;
        mesh.position.set(
          (baseBB.min.x + baseBB.max.x) / 2 - (pb.min.x + pb.max.x) / 2,
          (baseBB.min.y + baseBB.max.y) / 2 - (pb.min.y + pb.max.y) / 2 + extendY,
          baseBB.max.z - pb.max.z - 7, // match designer: sit in the channel
        );
      }
      inner.add(mesh);
    });
    group.add(inner);
    return group;
  }, [geoms, parts]);
  return <FittedSpin object={object} />;
}

function ModelCanvas({ model, boost = 1 }: { model: BuildModel; boost?: number }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0.6, 3.4], fov: 42 }} gl={{ alpha: true, antialias: true }} style={{ background: 'transparent' }}>
      <ambientLight intensity={0.9 * boost} color="#8ab4d8" />
      <directionalLight position={[4, 6, 5]} intensity={1.8 * boost} color="#e8f4ff" />
      <directionalLight position={[-5, 2, -3]} intensity={1.2 * boost} color={ACCENT} />
      <Suspense fallback={null}>
        {model.parts && model.parts.length > 0
          ? <AssemblySpin parts={model.parts} />
          : model.file.toLowerCase().endsWith('.stl')
            ? <StlSpin url={model.file} />
            : <GltfSpin url={model.file} />}
      </Suspense>
    </Canvas>
  );
}

// ── Countdown helpers ─────────────────────────────────────────────────────────
function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────
interface Props {
  onNavigateHome: () => void;
  /** Model handed over by the armory BUILD button (null = pick one here) */
  initialModel?: BuildModel | null;
}

export function ManufacturingPage({ onNavigateHome, initialModel }: Props) {
  const [model, setModel] = useState<BuildModel | null>(
    () => ACTIVE_JOB?.model ?? initialModel ?? null,
  );
  const [job, setJob] = useState<BuildJob | null>(() =>
    ACTIVE_JOB && ACTIVE_JOB.endsAt > Date.now() ? ACTIVE_JOB : (ACTIVE_JOB = null),
  );
  const [now, setNow] = useState(() => Date.now());
  const [complete, setComplete] = useState(false);
  // Spin-up phase: machine pulses with "STARTING" before the clock runs
  const [starting, setStarting] = useState(false);
  const startTimer = useRef<number | null>(null);

  // Drag state: ghost chip position + machine currently hovered
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const dragRef = useRef(false);

  // Machine wheel: continuous offset in item units. The machine at
  // wrap(round(offset)) sits in the fixed center-selection circle. Looping is
  // achieved by rendering virtual indices around the offset, wrapped mod N.
  const [wheelOffset, setWheelOffset] = useState(0);
  const wheelOffsetRef = useRef(0);
  const wheelAnim = useRef<{ stop: () => void } | null>(null);
  const wheelDrag = useRef<{ startY: number; startOffset: number } | null>(null);
  const wheelIdle = useRef<number | null>(null);
  const railScrolled = useRef(false);

  // 1 Hz tick while a job runs; completion is detected inside the tick
  useEffect(() => {
    if (!job || starting || complete) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n < job.endsAt) return;
      setComplete(true);
      ACTIVE_JOB = null;
      sfx('notification', 0.7);
      notify('Fabrication complete', `${job.model.name} finished on the ${job.machine.name}.`, 'success', 0);
      window.dispatchEvent(new CustomEvent('jarvis:announce', {
        detail: { text: `Fabrication of the "${job.model.name}" on the ${job.machine.name} just completed. Inform the user briefly.` },
      }));
    }, 1000);
    return () => window.clearInterval(t);
  }, [job, starting, complete]);

  const remaining = job && job.endsAt > 0 ? Math.max(0, job.endsAt - now) : 0;
  const progress = job && job.endsAt > job.startedAt ? 1 - remaining / (job.endsAt - job.startedAt) : 0;
  const overlay = job ? (MACHINE_OVERLAY[job.machine.id] ?? DEFAULT_OVERLAY) : DEFAULT_OVERLAY;

  const startJob = useCallback((machine: Machine) => {
    if (!model) return;
    sfx('select_confirm', 0.7);
    setComplete(false);
    setStarting(true);
    // Placeholder job mounts the overlay; the clock starts after spin-up
    setJob({ machine, model, startedAt: 0, endsAt: 0 });

    startTimer.current = window.setTimeout(() => {
      startTimer.current = null;
      const startedAt = Date.now();
      const durationMs = randomBuildDurationMs();
      const spoken = spokenDuration(durationMs);
      const newJob: BuildJob = { machine, model, startedAt, endsAt: startedAt + durationMs };
      ACTIVE_JOB = newJob;
      setJob(newJob);
      setNow(startedAt);
      setStarting(false);
      window.dispatchEvent(new CustomEvent('jarvis:announce', {
        detail: {
          text:
            `Fabrication of the "${model.name}" just started on the ${machine.name} (${machine.type}). Estimated manufacturing time: ${spoken}. ` +
            `Announce this briefly in character, mentioning the machine by name and the time estimate, e.g. "Fabrication of the ${model.name} is underway on the ${machine.name}, sir. Estimated completion in approximately ${spoken}."`,
        },
      }));
    }, 2800);
  }, [model]);

  const abortJob = useCallback(() => {
    sfx('app_close', 0.5);
    if (startTimer.current !== null) {
      window.clearTimeout(startTimer.current);
      startTimer.current = null;
    }
    ACTIVE_JOB = null;
    setJob(null);
    setStarting(false);
    setComplete(false);
  }, []);

  // Cancel a pending spin-up timer if the page unmounts mid-start
  useEffect(() => () => {
    if (startTimer.current !== null) window.clearTimeout(startTimer.current);
  }, []);

  // ── Pointer-based drag of the model onto a machine ──────────────────────────
  const machineAtPoint = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const id = (el as HTMLElement).dataset?.machineId;
      if (id) return id;
    }
    return null;
  };

  const beginDrag = useCallback((e: React.PointerEvent) => {
    if (!model || job) return;
    e.preventDefault();
    dragRef.current = true;
    setDrag({ x: e.clientX, y: e.clientY });

    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      setDrag({ x: ev.clientX, y: ev.clientY });
      setHoverId(machineAtPoint(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent) => {
      dragRef.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const id = machineAtPoint(ev.clientX, ev.clientY);
      setDrag(null);
      setHoverId(null);
      const machine = MACHINES.find((m) => m.id === id);
      if (machine) startJob(machine);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [model, job, startJob]);

  // ── Looping machine wheel ─────────────────────────────────────────────────────
  const wrapIdx = (i: number) => ((i % MACHINES.length) + MACHINES.length) % MACHINES.length;
  const selVirtual = Math.round(wheelOffset);
  const selectedMachine = MACHINES[wrapIdx(selVirtual)];

  const setWheel = useCallback((v: number) => {
    wheelOffsetRef.current = v;
    setWheelOffset(v);
  }, []);

  const snapWheel = useCallback((target?: number) => {
    const t = target ?? Math.round(wheelOffsetRef.current);
    wheelAnim.current?.stop();
    wheelAnim.current = animate(wheelOffsetRef.current, t, {
      type: 'spring',
      stiffness: 240,
      damping: 30,
      onUpdate: setWheel,
    });
  }, [setWheel]);

  // Soft tick as machines pass through the selection circle
  const prevSel = useRef(0);
  useEffect(() => {
    if (prevSel.current !== selVirtual) {
      prevSel.current = selVirtual;
      sfx('click', 0.25);
    }
  }, [selVirtual]);

  const onRailPointerDown = useCallback((e: React.PointerEvent) => {
    wheelAnim.current?.stop();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    wheelDrag.current = { startY: e.clientY, startOffset: wheelOffsetRef.current };
    railScrolled.current = false;
  }, []);

  const onRailPointerMove = useCallback((e: React.PointerEvent) => {
    const d = wheelDrag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > 6) railScrolled.current = true;
    setWheel(d.startOffset - dy / WHEEL_SPACING);
  }, [setWheel]);

  const onRailPointerUp = useCallback(() => {
    if (!wheelDrag.current) return;
    wheelDrag.current = null;
    snapWheel();
    // railScrolled stays set so the click that fires right after a drag is
    // ignored; it resets on the next pointerdown.
  }, [snapWheel]);

  const onRailWheel = useCallback((e: React.WheelEvent) => {
    wheelAnim.current?.stop();
    setWheel(wheelOffsetRef.current + e.deltaY / 240);
    if (wheelIdle.current !== null) window.clearTimeout(wheelIdle.current);
    wheelIdle.current = window.setTimeout(() => {
      wheelIdle.current = null;
      snapWheel();
    }, 140);
  }, [setWheel, snapWheel]);

  useEffect(() => () => {
    wheelAnim.current?.stop();
    if (wheelIdle.current !== null) window.clearTimeout(wheelIdle.current);
  }, []);

  const R = 46; // countdown ring radius (viewBox units)
  const CIRC = 2 * Math.PI * R;

  return (
    <motion.div
      className="fixed inset-0 z-[50] overflow-hidden flex flex-col"
      style={{ background: '#020814' }}
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <style>{`
        @keyframes scanline-mfg {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes ring-rotate {
          to { transform: rotate(360deg); }
        }
        @keyframes machine-pulse {
          0%, 100% { transform: scale(1);    filter: drop-shadow(0 0 30px ${ACCENT_DIM}0.25)); }
          50%      { transform: scale(1.05); filter: drop-shadow(0 0 70px ${ACCENT_DIM}0.65)); }
        }
      `}</style>

      {/* Ambient haze + dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 50% 95%, rgba(14,80,160,0.30) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 50% 0%, rgba(20,60,120,0.22) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: `radial-gradient(circle, ${ACCENT_DIM}0.13) 1px, transparent 1px)`, backgroundSize: '30px 30px' }}
      />
      <div
        className="absolute inset-x-0 h-px pointer-events-none z-[2]"
        style={{ background: `linear-gradient(90deg,transparent,${ACCENT_DIM}0.3),transparent)`, animation: 'scanline-mfg 9s linear infinite' }}
      />

      {/* HUD corner brackets */}
      {[
        ['top-3 left-3', 'border-t border-l'],
        ['top-3 right-3', 'border-t border-r'],
        ['bottom-3 left-3', 'border-b border-l'],
        ['bottom-3 right-3', 'border-b border-r'],
      ].map(([pos, border]) => (
        <div key={pos} className={`absolute ${pos} w-6 h-6 ${border} pointer-events-none z-[3]`} style={{ borderColor: `${ACCENT_DIM}0.4)` }} />
      ))}

      <PageHeader title="Fabrication Bay" onNavigateHome={onNavigateHome} accent="cyan" />

      {/* ── Build in progress: machine center-stage with countdown ring ── */}
      <AnimatePresence>
        {job && (
          <motion.div
            key="build"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6"
            style={{ background: 'rgba(2,8,20,0.92)', backdropFilter: 'blur(10px)' }}
          >
            <div
              className={`font-mono text-[11px] uppercase tracking-[0.45em] ${starting ? 'animate-pulse' : ''}`}
              style={{ color: ACCENT }}
            >
              {complete ? 'Fabrication Complete' : starting ? 'Machine Starting' : 'Fabrication in Progress'}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40 -mt-4">
              {job.model.name} · {job.machine.name}
            </div>

            {/* Machine grows to center screen */}
            <motion.div
              initial={{ scale: 0.25, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 160, damping: 22 }}
              className="relative"
              style={{ width: 'min(52vh, 44vw)', height: 'min(52vh, 44vw)' }}
            >
              {/* Countdown ring */}
              <svg viewBox="0 0 100 100" className="absolute -inset-6 w-[calc(100%+48px)] h-[calc(100%+48px)]">
                <circle cx="50" cy="50" r={R} fill="none" stroke={`${ACCENT_DIM}0.12)`} strokeWidth="1.4" />
                <circle
                  cx="50" cy="50" r={R} fill="none"
                  stroke={complete ? '#34d399' : ACCENT}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeDasharray={CIRC}
                  strokeDashoffset={CIRC * progress}
                  transform="rotate(-90 50 50)"
                  style={{ filter: `drop-shadow(0 0 6px ${complete ? '#34d399' : ACCENT})`, transition: 'stroke-dashoffset 1s linear' }}
                />
                {/* Rotating tick marks — spin fast while starting, slow while building */}
                {!complete && (
                  <g style={{ transformOrigin: '50% 50%', animation: `ring-rotate ${starting ? 3 : 24}s linear infinite` }}>
                    {Array.from({ length: 24 }, (_, i) => (
                      <rect key={i} x="49.6" y="1.2" width="0.8" height="2.6" fill={ACCENT} opacity={starting ? 0.7 : 0.4} transform={`rotate(${i * 15} 50 50)`} />
                    ))}
                  </g>
                )}
              </svg>

              {/* Machine image — pulses while the machine spins up */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={job.machine.img}
                alt={job.machine.name}
                className="absolute inset-0 w-full h-full object-contain"
                style={
                  starting
                    ? { animation: 'machine-pulse 1.1s ease-in-out infinite' }
                    : { filter: `drop-shadow(0 0 40px ${ACCENT_DIM}0.25))` }
                }
                draggable={false}
              />

              {/* Model shrunk to ~1/4 of the machine image, spinning.
                  Position/lighting are per-machine (see MACHINE_OVERLAY). */}
              <motion.div
                initial={{ scale: 3.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.15 }}
                className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: '25%', height: '25%', top: `${overlay.topPct}%` }}
              >
                <div
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{ background: `radial-gradient(circle, ${ACCENT_DIM}0.18) 0%, transparent 70%)` }}
                />
                <ModelCanvas model={job.model} boost={overlay.boost} />
              </motion.div>
            </motion.div>

            {/* Countdown */}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`font-mono text-4xl font-bold tracking-[0.2em] tabular-nums ${starting ? 'animate-pulse' : ''}`}
                style={{
                  color: complete ? '#34d399' : starting ? ACCENT : '#fff',
                  textShadow: `0 0 24px ${complete ? '#34d399' : ACCENT}66`,
                }}
              >
                {complete ? '00:00:00' : starting ? 'STARTING' : formatRemaining(remaining)}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.4em] text-white/35">
                {complete ? 'Ready for retrieval' : starting ? 'Initializing machine' : 'Remaining'}
              </div>
            </div>

            <button
              onClick={abortJob}
              className="font-mono text-[10px] uppercase tracking-[0.3em] px-6 py-2 transition-colors"
              style={{
                color: complete ? '#34d399' : 'rgba(255,255,255,0.45)',
                border: `1px solid ${complete ? '#34d39966' : 'rgba(255,255,255,0.15)'}`,
                clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
              }}
            >
              {complete ? 'Clear Bay' : '✕ Abort Fabrication'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Selection layout: model left, machines right ── */}
      <div className="flex-1 flex min-h-0 relative z-10">
        {/* Left: chosen model / model picker */}
        <div className="flex-1 flex flex-col min-w-0 p-6">
          {model ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-xl font-bold uppercase tracking-[0.3em] text-white" style={{ textShadow: `0 0 20px ${ACCENT_DIM}0.6)` }}>
                    {model.name}
                  </h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] mt-1" style={{ color: `${ACCENT_DIM}0.6)` }}>
                    {model.sub}
                  </p>
                </div>
                <button
                  onClick={() => { sfx('click', 0.4); setModel(null); }}
                  className="font-mono text-[9px] uppercase tracking-widest text-white/35 hover:text-white transition-colors border border-white/10 px-3 py-1.5"
                >
                  Change Model
                </button>
              </div>

              {/* Draggable 3D viewer */}
              <div
                className="flex-1 relative min-h-0"
                style={{ cursor: job ? 'default' : 'grab', touchAction: 'none' }}
                onPointerDown={beginDrag}
              >
                <ModelCanvas model={model} />
                {/* Podium glow */}
                <div
                  className="absolute left-1/2 bottom-8 -translate-x-1/2 w-56 h-10 pointer-events-none"
                  style={{ background: `radial-gradient(ellipse, ${ACCENT_DIM}0.25) 0%, transparent 70%)` }}
                />
                <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none">
                  <span className="font-mono text-[9px] uppercase tracking-[0.35em] text-white/30 animate-pulse">
                    ⇢ Drag the component onto a machine
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.4em] mb-4" style={{ color: ACCENT }}>
                Select Component
              </h2>
              <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-2">
                {ACCESSORIES.map((a) => (
                  <button
                    key={a.file}
                    onClick={() => { sfx('select', 0.5); setModel(a); }}
                    className="flex items-center justify-between px-4 py-3 text-left transition-all group"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
                    }}
                  >
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/80 group-hover:text-white transition-colors">
                        {a.name}
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/30 mt-0.5">{a.sub}</div>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: ACCENT }}>
                      Load ▸
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right: looping machine selection wheel */}
        <div className="w-96 shrink-0 flex flex-col border-l" style={{ borderColor: `${ACCENT_DIM}0.12)` }}>
          <div className="px-4 py-3 border-b shrink-0" style={{ borderColor: `${ACCENT_DIM}0.12)` }}>
            <span className="font-mono text-[10px] uppercase tracking-[0.35em]" style={{ color: ACCENT }}>
              Machines Available
            </span>
            <span className="block font-mono text-[8px] uppercase tracking-[0.25em] text-white/25 mt-0.5">
              {MACHINES.length} units online · drag to cycle
            </span>
          </div>

          <div
            className="flex-1 relative overflow-hidden select-none"
            style={{ touchAction: 'none' }}
            onPointerDown={onRailPointerDown}
            onPointerMove={onRailPointerMove}
            onPointerUp={onRailPointerUp}
            onPointerCancel={onRailPointerUp}
            onWheel={onRailWheel}
          >
            {/* Fade the wheel out toward the top/bottom edges */}
            <div
              className="absolute inset-0 pointer-events-none z-[5]"
              style={{ background: 'linear-gradient(180deg, #020814 0%, transparent 22%, transparent 78%, #020814 100%)' }}
            />

            {/* Fixed selection circle — machines scroll through it; it is also
                the drop target for the dragged model */}
            <div
              data-machine-id={selectedMachine.id}
              onClick={() => { if (model && !job && !railScrolled.current) startJob(selectedMachine); }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: WHEEL_SPACING + 60,
                height: WHEEL_SPACING + 60,
                border: `1.5px solid ${hoverId === selectedMachine.id ? ACCENT : `${ACCENT_DIM}0.4)`}`,
                boxShadow: hoverId === selectedMachine.id
                  ? `0 0 40px ${ACCENT_DIM}0.5), inset 0 0 40px ${ACCENT_DIM}0.15)`
                  : `0 0 24px ${ACCENT_DIM}0.15), inset 0 0 24px ${ACCENT_DIM}0.06)`,
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            >
              {/* Rotating dashes on the selection ring */}
              <svg viewBox="0 0 100 100" className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] animate-[spin_30s_linear_infinite]">
                {Array.from({ length: 8 }, (_, i) => (
                  <rect key={i} x="49.6" y="0.5" width="0.8" height="4" fill={ACCENT} opacity="0.5" transform={`rotate(${i * 45} 50 50)`} />
                ))}
              </svg>
              {hoverId === selectedMachine.id && (
                <span
                  className="absolute -top-6 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.3em] animate-pulse whitespace-nowrap"
                  style={{ color: ACCENT }}
                >
                  ⌁ Deploy Here
                </span>
              )}
            </div>

            {/* Wheel items: virtual indices around the offset, wrapped mod N */}
            {Array.from({ length: 7 }, (_, n) => Math.floor(wheelOffset) - 3 + n).map((k) => {
              const m = MACHINES[wrapIdx(k)];
              const y = (k - wheelOffset) * WHEEL_SPACING;
              const d = Math.abs(k - wheelOffset);
              const isCenter = k === selVirtual;
              const scale = d < 1 ? 1.18 - 0.4 * d : Math.max(0.66, 0.78 - 0.08 * (d - 1));
              const opacity = Math.max(0, 1 - d * 0.34);
              return (
                <div
                  key={k}
                  data-machine-id={m.id}
                  onClick={() => {
                    if (railScrolled.current) return;
                    if (isCenter) { if (model && !job) startJob(m); }
                    else { sfx('click', 0.3); snapWheel(k); }
                  }}
                  className="absolute left-1/2 top-1/2 flex flex-col items-center"
                  style={{
                    transform: `translate(-50%, calc(-50% + ${y}px)) scale(${scale})`,
                    opacity,
                    cursor: isCenter && model && !job ? 'pointer' : 'grab',
                    zIndex: isCenter ? 4 : 3,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.img}
                    alt={m.name}
                    className="h-36 object-contain pointer-events-none"
                    style={{
                      filter: isCenter
                        ? `drop-shadow(0 0 26px ${ACCENT_DIM}0.5))`
                        : 'drop-shadow(0 4px 12px rgba(0,0,0,0.6)) saturate(0.6)',
                      transition: 'filter 0.25s',
                    }}
                    draggable={false}
                  />
                  <div
                    className="font-mono text-[11px] uppercase tracking-[0.2em] mt-2 transition-colors"
                    style={{ color: isCenter ? ACCENT : 'rgba(255,255,255,0.55)' }}
                  >
                    {m.name}
                  </div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/30">{m.type}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Drag ghost chip following the pointer */}
      {drag && model && (
        <div
          className="fixed z-[60] pointer-events-none flex items-center gap-2 px-4 py-2"
          style={{
            left: drag.x,
            top: drag.y,
            transform: 'translate(-50%, -120%)',
            background: 'rgba(2,8,20,0.9)',
            border: `1px solid ${ACCENT}`,
            boxShadow: `0 0 24px ${ACCENT_DIM}0.5)`,
            clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
          }}
        >
          <span className="w-2 h-2 rounded-full animate-ping" style={{ background: ACCENT }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: ACCENT }}>
            {model.name}
          </span>
        </div>
      )}
    </motion.div>
  );
}
