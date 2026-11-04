'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sfx } from '../lib/sfx';
import { verifyPin } from '../lib/pin';

export const LOCK_EVENT = 'jarvis:lock';
export const UNLOCK_EVENT = 'jarvis:unlock';
export const LOCKED_FLAG_KEY = 'jarvis_locked';

/** Read the lock config straight from saved settings so this component works
 *  no matter where it's mounted (page.tsx, above everything). */
function readLockConfig(): { enabled: boolean; pinHash: string; autoMinutes: number } {
  try {
    const raw = localStorage.getItem('jarvis_settings');
    if (!raw) return { enabled: false, pinHash: '', autoMinutes: 0 };
    const s = JSON.parse(raw) as { lockEnabled?: boolean; lockPinHash?: string; lockAutoMinutes?: number };
    return {
      enabled: !!s.lockEnabled && !!s.lockPinHash,
      pinHash: s.lockPinHash ?? '',
      autoMinutes: s.lockAutoMinutes ?? 0,
    };
  } catch {
    return { enabled: false, pinHash: '', autoMinutes: 0 };
  }
}

export function isInterfaceLocked(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(LOCKED_FLAG_KEY) === '1' && readLockConfig().enabled;
}

const PIN_LENGTH = 4;
const RING_RADIUS = 130;          // lock ring radius (px)
const DROP_THRESHOLD = 110;       // px from center that counts as "dropped in"

interface BubbleSpec {
  digit: number;
  angle: number;   // radians
  radius: number;  // distance from center
  floatDur: number;
  floatDelay: number;
}

function randomBubbles(): BubbleSpec[] {
  // 10 digits spread around the circle with jittered angles and radii so the
  // arrangement is different every time (also thwarts pattern-watching)
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
  return digits.map((digit, i) => ({
    digit,
    angle: (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.35,
    radius: RING_RADIUS + 90 + Math.random() * 80,
    floatDur: 3 + Math.random() * 2.5,
    floatDelay: Math.random() * 2,
  }));
}

/**
 * Futuristic PIN lock. A large lock glyph sits inside an arc-reactor style
 * ring; number bubbles float around it on tether lines. Drag a bubble into
 * the ring to enter that digit — the lock flashes the number and one of the
 * four dots below fills in. Wrong PIN scatters the bubbles and shakes.
 */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [bubbles, setBubbles] = useState<BubbleSpec[]>([]);
  const [entered, setEntered] = useState<number[]>([]);
  const [flashDigit, setFlashDigit] = useState<number | null>(null);
  const [shake, setShake] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [unlocking, setUnlocking] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);
  const flashTimeout = useRef<number | null>(null);
  const enteredRef = useRef<number[]>([]);

  useEffect(() => {
    enteredRef.current = entered;
  }, [entered]);

  useEffect(() => {
    // Deferred so the bubbles animate in after the backdrop appears
    const t = window.setTimeout(() => setBubbles(randomBubbles()), 50);
    return () => {
      window.clearTimeout(t);
      if (flashTimeout.current) window.clearTimeout(flashTimeout.current);
    };
  }, []);

  const registerDigit = useCallback((digit: number) => {
    if (unlocking) return;
    const current = enteredRef.current;
    if (current.length >= PIN_LENGTH) return;
    sfx('click', 0.6);
    setFlashDigit(digit);
    if (flashTimeout.current) window.clearTimeout(flashTimeout.current);
    flashTimeout.current = window.setTimeout(() => setFlashDigit(null), 650);

    const next = [...current, digit];
    setEntered(next);

    if (next.length === PIN_LENGTH) {
      const { pinHash } = readLockConfig();
      window.setTimeout(() => {
        if (verifyPin(next.join(''), pinHash)) {
          sfx('select_confirm', 0.7);
          setUnlocking(true);
          window.setTimeout(onUnlock, 700);
        } else {
          sfx('error', 0.6);
          setShake((s) => s + 1);
          setFailCount((f) => f + 1);
          setEntered([]);
          setBubbles(randomBubbles());
        }
      }, 350);
    }
  }, [onUnlock, unlocking]);

  // Keyboard entry as a fallback for people who don't want to drag
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) registerDigit(parseInt(e.key, 10));
      if (e.key === 'Backspace') setEntered((prev) => prev.slice(0, -1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [registerDigit]);

  const intruder = failCount >= 3;
  const accent = intruder ? '#f87171' : '#22d3ee';

  const ringSegments = useMemo(() => Array.from({ length: 48 }, (_, i) => (i / 48) * 360), []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.45 } }}
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden select-none"
      style={{
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      {/* Status line */}
      <div className="absolute top-8 inset-x-0 flex flex-col items-center gap-1 pointer-events-none">
        <span className="font-mono text-[11px] uppercase tracking-[0.5em]" style={{ color: accent }}>
          {intruder ? 'Unauthorized access detected' : 'Interface locked'}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/25">
          {intruder ? `${failCount} failed attempts logged` : 'Drag a number into the reactor to enter your PIN'}
        </span>
      </div>

      {/* Center assembly — shakes on wrong PIN */}
      <motion.div
        key={shake}
        ref={centerRef}
        initial={shake > 0 ? { x: 0 } : false}
        animate={shake > 0 ? { x: [0, -14, 12, -8, 6, 0] } : {}}
        transition={{ duration: 0.45 }}
        className="relative flex items-center justify-center"
        style={{ width: RING_RADIUS * 2, height: RING_RADIUS * 2 }}
      >
        {/* Tether lines + bubbles live in an oversized layer around the ring */}
        <div className="absolute left-1/2 top-1/2 pointer-events-none" style={{ width: 0, height: 0 }}>
          <svg
            className="absolute overflow-visible"
            style={{ left: 0, top: 0 }}
            width="1" height="1"
          >
            {bubbles.map((b) => {
              const x1 = Math.cos(b.angle) * RING_RADIUS;
              const y1 = Math.sin(b.angle) * RING_RADIUS;
              const x2 = Math.cos(b.angle) * b.radius;
              const y2 = Math.sin(b.angle) * b.radius;
              return (
                <line
                  key={`line-${b.digit}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={accent} strokeOpacity="0.25" strokeWidth="1"
                  strokeDasharray="3 5"
                />
              );
            })}
          </svg>

          {bubbles.map((b) => (
            <NumberBubble
              key={`bubble-${b.digit}-${shake}`}
              spec={b}
              accent={accent}
              disabled={unlocking}
              onDrop={registerDigit}
              getCenter={() => {
                const rect = centerRef.current?.getBoundingClientRect();
                return rect
                  ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                  : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
              }}
            />
          ))}
        </div>

        {/* Segmented reactor ring */}
        <motion.svg
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${RING_RADIUS * 2} ${RING_RADIUS * 2}`}
          animate={{ rotate: unlocking ? 180 : 360 }}
          transition={unlocking
            ? { duration: 0.7, ease: 'easeInOut' }
            : { duration: 40, repeat: Infinity, ease: 'linear' }}
        >
          {ringSegments.map((deg) => (
            <rect
              key={deg}
              x={RING_RADIUS - 1}
              y={2}
              width={2}
              height={10}
              fill={accent}
              opacity={0.55}
              transform={`rotate(${deg} ${RING_RADIUS} ${RING_RADIUS})`}
            />
          ))}
          <circle cx={RING_RADIUS} cy={RING_RADIUS} r={RING_RADIUS - 18} fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="1" />
          <circle cx={RING_RADIUS} cy={RING_RADIUS} r={RING_RADIUS - 24} fill="none" stroke={accent} strokeOpacity="0.12" strokeWidth="8" />
        </motion.svg>

        {/* Glow */}
        <div
          className="absolute inset-6 rounded-full pointer-events-none"
          style={{ boxShadow: `0 0 60px ${accent}33, inset 0 0 60px ${accent}1a` }}
        />

        {/* Lock glyph / flashed digit */}
        <AnimatePresence mode="wait">
          {flashDigit !== null ? (
            <motion.span
              key={`digit-${flashDigit}-${entered.length}`}
              initial={{ opacity: 0, scale: 1.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.2 }}
              className="font-mono font-bold pointer-events-none"
              style={{ fontSize: 96, color: accent, textShadow: `0 0 30px ${accent}` }}
            >
              {flashDigit}
            </motion.span>
          ) : (
            <motion.svg
              key={unlocking ? 'unlocked' : 'locked'}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              viewBox="0 0 24 24" width="88" height="88" fill="none"
              stroke={unlocking ? '#34d399' : accent} strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 14px ${unlocking ? '#34d399' : accent})` }}
              className="pointer-events-none"
            >
              <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
              {unlocking
                ? <path d="M8 10.5V7a4 4 0 0 1 7.5-1.9" />
                : <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />}
              <circle cx="12" cy="15" r="1.4" fill={unlocking ? '#34d399' : accent} stroke="none" />
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.div>

      {/* PIN dots */}
      <div className="absolute bottom-[18%] inset-x-0 flex items-center justify-center gap-5 pointer-events-none">
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const filled = i < entered.length;
          return (
            <motion.div
              key={i}
              animate={filled ? { scale: [1, 1.4, 1] } : { scale: 1 }}
              transition={{ duration: 0.25 }}
              className="rounded-full"
              style={{
                width: 12,
                height: 12,
                background: filled ? accent : 'transparent',
                border: `1px solid ${filled ? accent : 'rgba(255,255,255,0.25)'}`,
                boxShadow: filled ? `0 0 12px ${accent}` : 'none',
              }}
            />
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Individual draggable number bubble ───────────────────────────────────────

function NumberBubble({
  spec, accent, disabled, onDrop, getCenter,
}: {
  spec: BubbleSpec;
  accent: string;
  disabled: boolean;
  onDrop: (digit: number) => void;
  getCenter: () => { x: number; y: number };
}) {
  const anchorX = Math.cos(spec.angle) * spec.radius;
  const anchorY = Math.sin(spec.angle) * spec.radius;
  const [dragging, setDragging] = useState(false);

  return (
    // Outer layer: anchor position + gentle idle float
    <motion.div
      className="absolute pointer-events-none"
      style={{ left: anchorX - 26, top: anchorY - 26 }}
      animate={dragging ? { x: 0, y: 0 } : { x: [0, 6, -4, 0], y: [0, -6, 5, 0] }}
      transition={{ duration: spec.floatDur, delay: spec.floatDelay, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Inner layer: the draggable bubble; springs back after release */}
      <motion.div
        drag={!disabled}
        dragSnapToOrigin
        dragMomentum={false}
        dragElastic={0.12}
        whileDrag={{ scale: 1.25, zIndex: 10 }}
        whileHover={{ scale: 1.1 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={(_e, info) => {
          setDragging(false);
          const center = getCenter();
          const dist = Math.hypot(info.point.x - center.x, info.point.y - center.y);
          if (dist < DROP_THRESHOLD) onDrop(spec.digit);
        }}
        className="pointer-events-auto flex items-center justify-center rounded-full cursor-grab active:cursor-grabbing font-mono font-bold"
        style={{
          width: 52,
          height: 52,
          fontSize: 20,
          color: accent,
          background: 'rgba(0,0,0,0.7)',
          border: `1px solid ${accent}88`,
          boxShadow: `0 0 16px ${accent}44, inset 0 0 12px ${accent}22`,
          textShadow: `0 0 8px ${accent}`,
        }}
      >
        {spec.digit}
      </motion.div>
    </motion.div>
  );
}

/**
 * Controller that owns lock state. Mount once in page.tsx above everything.
 * Listens for jarvis:lock / jarvis:unlock events, persists across reloads,
 * and auto-locks after the configured idle timeout.
 */
export function LockController() {
  const [locked, setLocked] = useState(false);

  // Restore lock state after hydration + subscribe to lock/unlock events
  useEffect(() => {
    const restore = window.setTimeout(() => {
      if (isInterfaceLocked()) setLocked(true);
    }, 0);

    const lockHandler = () => {
      if (!readLockConfig().enabled) return;
      localStorage.setItem(LOCKED_FLAG_KEY, '1');
      sfx('switch_interface', 0.6);
      setLocked(true);
    };
    const unlockHandler = () => {
      localStorage.removeItem(LOCKED_FLAG_KEY);
      setLocked(false);
    };
    window.addEventListener(LOCK_EVENT, lockHandler);
    window.addEventListener(UNLOCK_EVENT, unlockHandler);
    return () => {
      window.clearTimeout(restore);
      window.removeEventListener(LOCK_EVENT, lockHandler);
      window.removeEventListener(UNLOCK_EVENT, unlockHandler);
    };
  }, []);

  // Auto-lock on idle
  useEffect(() => {
    let idleTimer: number | null = null;

    const arm = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      const { enabled, autoMinutes } = readLockConfig();
      if (!enabled || !autoMinutes || autoMinutes <= 0) return;
      idleTimer = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(LOCK_EVENT));
      }, autoMinutes * 60_000);
    };

    const events: (keyof WindowEventMap)[] = ['pointermove', 'pointerdown', 'keydown', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, arm, { passive: true }));
    arm();
    return () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, arm));
    };
  }, [locked]);

  const unlock = () => {
    localStorage.removeItem(LOCKED_FLAG_KEY);
    setLocked(false);
  };

  return (
    <AnimatePresence>
      {locked && <LockScreen key="lockscreen" onUnlock={unlock} />}
    </AnimatePresence>
  );
}
