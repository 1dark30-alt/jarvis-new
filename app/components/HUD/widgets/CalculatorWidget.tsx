'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../../../lib/sfx';

type Op = '+' | '-' | '×' | '÷';

interface HistoryEntry {
  expr: string;
  result: string;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return 'ERR';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) {
    return n.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'e');
  }
  const s = Number(n.toPrecision(12)).toString();
  return s.length > 14 ? n.toExponential(6) : s;
}

function applyOp(a: number, op: Op, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
  }
}

type KeyDef =
  | { label: string; action: string; span?: 1 | 2; tone?: 'accent' | 'op' | 'danger' | 'ghost' }
  | { label: string; digit: string; span?: 1 | 2 };

const KEYS: KeyDef[][] = [
  [
    { label: 'C', action: 'clear', tone: 'danger' },
    { label: '⌫', action: 'back', tone: 'ghost' },
    { label: '%', action: 'percent', tone: 'ghost' },
    { label: '÷', action: '÷', tone: 'op' },
  ],
  [
    { label: '7', digit: '7' },
    { label: '8', digit: '8' },
    { label: '9', digit: '9' },
    { label: '×', action: '×', tone: 'op' },
  ],
  [
    { label: '4', digit: '4' },
    { label: '5', digit: '5' },
    { label: '6', digit: '6' },
    { label: '−', action: '-', tone: 'op' },
  ],
  [
    { label: '1', digit: '1' },
    { label: '2', digit: '2' },
    { label: '3', digit: '3' },
    { label: '+', action: '+', tone: 'op' },
  ],
  [
    { label: '±', action: 'sign', tone: 'ghost' },
    { label: '0', digit: '0' },
    { label: '.', digit: '.' },
    { label: '=', action: 'equals', tone: 'accent' },
  ],
];

/** Futuristic HUD calculator — expression trail, glowing keys, keyboard input. */
export function CalculatorWidget() {
  const [display, setDisplay] = useState('0');
  const [expr, setExpr] = useState('');
  const [pending, setPending] = useState<{ a: number; op: Op } | null>(null);
  const [fresh, setFresh] = useState(true); // next digit replaces display
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [flash, setFlash] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const pushHistory = useCallback((e: string, result: string) => {
    setHistory((prev) => [{ expr: e, result }, ...prev].slice(0, 6));
  }, []);

  const inputDigit = useCallback((d: string) => {
    sfx('click', 0.18, 1.15);
    setDisplay((cur) => {
      if (fresh) {
        setFresh(false);
        return d === '.' ? '0.' : d;
      }
      if (d === '.' && cur.includes('.')) return cur;
      if (cur === '0' && d !== '.') return d;
      if (cur.replace(/^-/, '').length >= 14) return cur;
      return cur + d;
    });
  }, [fresh]);

  const doEquals = useCallback(() => {
    if (!pending) return;
    const b = parseFloat(display);
    const result = applyOp(pending.a, pending.op, b);
    const out = formatNum(result);
    const full = `${formatNum(pending.a)} ${pending.op} ${formatNum(b)}`;
    sfx(Number.isFinite(result) ? 'select' : 'error', Number.isFinite(result) ? 0.45 : 0.5);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    setExpr(full);
    setDisplay(out);
    setPending(null);
    setFresh(true);
    if (Number.isFinite(result)) pushHistory(full, out);
  }, [display, pending, pushHistory]);

  const pressOp = useCallback((op: Op) => {
    sfx('click', 0.22, 0.95);
    const cur = parseFloat(display);
    if (pending && !fresh) {
      const result = applyOp(pending.a, pending.op, cur);
      const out = formatNum(result);
      setDisplay(out);
      setPending({ a: Number.isFinite(result) ? result : 0, op });
      setExpr(`${out} ${op}`);
    } else {
      setPending({ a: cur, op });
      setExpr(`${formatNum(cur)} ${op}`);
    }
    setFresh(true);
  }, [display, fresh, pending]);

  const handleAction = useCallback((action: string) => {
    switch (action) {
      case 'clear':
        sfx('app_close', 0.35);
        setDisplay('0');
        setExpr('');
        setPending(null);
        setFresh(true);
        break;
      case 'back':
        sfx('click', 0.15, 0.85);
        if (fresh) return;
        setDisplay((cur) => {
          const next = cur.length <= 1 || (cur.length === 2 && cur.startsWith('-')) ? '0' : cur.slice(0, -1);
          if (next === '0') setFresh(true);
          return next;
        });
        break;
      case 'percent': {
        sfx('click', 0.2, 1.05);
        const n = parseFloat(display) / 100;
        setDisplay(formatNum(n));
        setFresh(true);
        break;
      }
      case 'sign':
        sfx('click', 0.18, 1.1);
        setDisplay((cur) => {
          if (cur === '0' || cur === 'ERR') return cur;
          return cur.startsWith('-') ? cur.slice(1) : `-${cur}`;
        });
        break;
      case 'equals':
        doEquals();
        break;
      case '+':
      case '-':
      case '×':
      case '÷':
        pressOp(action);
        break;
    }
  }, [display, doEquals, fresh, pressOp]);

  // Keyboard support when the widget (or a child) has focus
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!el.contains(document.activeElement) && document.activeElement !== el) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key >= '0' && e.key <= '9') inputDigit(e.key);
      else if (e.key === '.') inputDigit('.');
      else if (e.key === '+') handleAction('+');
      else if (e.key === '-') handleAction('-');
      else if (e.key === '*' || e.key === 'x' || e.key === 'X') handleAction('×');
      else if (e.key === '/') handleAction('÷');
      else if (e.key === 'Enter' || e.key === '=') handleAction('equals');
      else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') handleAction('clear');
      else if (e.key === 'Backspace') handleAction('back');
      else if (e.key === '%') handleAction('percent');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handleAction, inputDigit]);

  const toneStyle = (tone?: 'accent' | 'op' | 'danger' | 'ghost') => {
    switch (tone) {
      case 'accent':
        return {
          background: 'rgba(var(--accent-rgb, 34, 211, 238), 0.22)',
          borderColor: 'var(--accent-hex, #22d3ee)',
          color: 'var(--accent-hex, #22d3ee)',
          boxShadow: '0 0 14px rgba(var(--accent-rgb, 34, 211, 238), 0.35)',
        };
      case 'op':
        return {
          background: 'rgba(var(--accent-rgb, 34, 211, 238), 0.08)',
          borderColor: 'rgba(var(--accent-rgb, 34, 211, 238), 0.45)',
          color: 'var(--accent-hex, #22d3ee)',
        };
      case 'danger':
        return {
          background: 'rgba(255, 80, 80, 0.1)',
          borderColor: 'rgba(255, 100, 100, 0.45)',
          color: '#ff6b6b',
        };
      case 'ghost':
        return {
          background: 'rgba(255,255,255,0.04)',
          borderColor: 'rgba(255,255,255,0.14)',
          color: 'rgba(255,255,255,0.7)',
        };
      default:
        return {
          background: 'rgba(255,255,255,0.03)',
          borderColor: 'rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.92)',
        };
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="flex flex-col h-full min-h-0 outline-none select-none"
      onPointerDown={(e) => { e.stopPropagation(); rootRef.current?.focus(); }}
    >
      {/* Display */}
      <div
        className="relative shrink-0 mb-2 px-3 py-2.5 overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, rgba(6,18,32,0.95), rgba(4,12,24,0.9))',
          border: '1px solid rgba(var(--accent-rgb, 34, 211, 238), 0.28)',
          boxShadow: flash
            ? '0 0 22px rgba(var(--accent-rgb, 34, 211, 238), 0.45), inset 0 0 18px rgba(var(--accent-rgb, 34, 211, 238), 0.12)'
            : 'inset 0 0 18px rgba(var(--accent-rgb, 34, 211, 238), 0.06)',
          clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
          transition: 'box-shadow 0.15s ease',
        }}
      >
        {/* Corner ticks */}
        <span className="absolute top-1 left-3 w-3 h-px bg-[var(--accent-hex,#22d3ee)]/50" />
        <span className="absolute top-1 right-3 w-3 h-px bg-[var(--accent-hex,#22d3ee)]/50" />
        <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-white/30 truncate min-h-[14px]">
          {expr || 'COMPUTE'}
        </div>
        <div
          className="font-mono text-2xl font-bold tabular-nums tracking-wider text-right truncate mt-0.5"
          style={{
            color: display === 'ERR' ? '#ff6b6b' : 'var(--accent-hex, #22d3ee)',
            textShadow: display === 'ERR' ? '0 0 10px #ff6b6b88' : '0 0 14px rgba(var(--accent-rgb, 34, 211, 238), 0.55)',
          }}
        >
          {display}
        </div>
      </div>

      {/* History strip */}
      {history.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto shrink-0 mb-2 pb-0.5 scrollbar-none">
          {history.map((h, i) => (
            <button
              key={`${h.expr}-${i}`}
              type="button"
              onClick={() => {
                sfx('select', 0.3);
                setDisplay(h.result);
                setExpr(h.expr);
                setPending(null);
                setFresh(true);
              }}
              className="shrink-0 px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors hover:bg-white/5"
              style={{
                border: '1px solid rgba(var(--accent-rgb, 34, 211, 238), 0.2)',
                color: 'rgba(255,255,255,0.45)',
                clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
              }}
              title={`${h.expr} = ${h.result}`}
            >
              <span className="text-white/25">{h.expr}</span>
              <span className="mx-1 text-[var(--accent-hex,#22d3ee)]/70">=</span>
              <span style={{ color: 'var(--accent-hex, #22d3ee)' }}>{h.result}</span>
            </button>
          ))}
        </div>
      )}

      {/* Keypad */}
      <div className="flex-1 grid grid-rows-5 gap-1.5 min-h-0">
        {KEYS.map((row, ri) => (
          <div key={ri} className="grid grid-cols-4 gap-1.5 min-h-0">
            {row.map((key) => {
              const tone = 'tone' in key ? key.tone : undefined;
              const style = toneStyle(tone);
              return (
                <button
                  key={key.label}
                  type="button"
                  onClick={() => {
                    if ('digit' in key) inputDigit(key.digit);
                    else handleAction(key.action);
                  }}
                  className="relative font-mono text-sm font-semibold tracking-wider transition-transform active:scale-[0.96] hover:brightness-125 min-h-0"
                  style={{
                    ...style,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    clipPath: 'polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%)',
                  }}
                >
                  {key.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
