'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { saveServerSettings, getCachedSetting } from '../../lib/serverSettings';
import { PageHeader } from '../PageHeader';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PrinterInfo {
  deviceId: string;
  name: string;
  model?: string;
}

interface PrinterTelemetry {
  gcode_state?: string;
  subtask_name?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  chamber_temper?: number;
  wifi_signal?: string;
  ams?: { ams?: Array<{ tray: Array<{ id: string; tray_color?: string; tray_id_name?: string; cols?: string[] }> }> };
  ams_status?: string;
  [key: string]: unknown;
}

interface PrintTask {
  id: string | number;
  title?: string;
  deviceName?: string;
  cover?: string;
  status?: number;
  costTime?: number;
  weight?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPrinterImage(name: string): string | null {
  const n = name.toUpperCase();
  if (n.includes('H2D'))              return '/assets/Printers/H2D.png';
  if (n.includes('X1C') || n.includes('CARBON') || n.includes('X1')) return '/assets/Printers/X1C.png';
  if (n.includes('P1S'))              return '/assets/Printers/P1S.png';
  if (n.includes('P1P'))              return '/assets/Printers/P1P.png';
  if (n.includes('A1 MINI') || n.includes('A1MINI')) return '/assets/Printers/A1mini.png';
  if (n.includes('A1'))               return '/assets/Printers/A1.png';
  return null;
}

function statusColor(state?: string): { color: string; rgb: string; label: string } {
  switch ((state ?? '').toUpperCase()) {
    case 'RUNNING': return { color: '#4ade80', rgb: '74,222,128',  label: 'Printing' };
    case 'PAUSE':   return { color: '#facc15', rgb: '250,204,21',  label: 'Paused'   };
    case 'FAILED':  return { color: '#f87171', rgb: '248,113,113', label: 'Failed'   };
    case 'FINISH':  return { color: '#22d3ee', rgb: '34,211,238',  label: 'Finished' };
    case 'IDLE':    return { color: '#94a3b8', rgb: '148,163,184', label: 'Idle'     };
    default:        return { color: '#64748b', rgb: '100,116,139', label: state ?? 'Unknown' };
  }
}

function fmtTime(seconds?: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Setup Wizard ──────────────────────────────────────────────────────────────

function BambuWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<'email' | 'code' | 'connecting'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const sendEmail = async () => {
    if (!email.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/bambu/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json() as { status?: string; error?: string };
      if (data.status === 'code_sent') {
        setStep('code');
      } else       if (data.status === 'authenticated') {
        localStorage.setItem('bambu_email', email.trim());
        saveServerSettings({ bambu_email: email.trim() });
        setStep('connecting');
        setTimeout(onComplete, 1500);
      } else {
        setError(data.error ?? 'Failed to send code');
      }
    } catch (e) { setError(`Network error: ${String(e)}`); }
    finally { setLoading(false); }
  };

  const verifyCode = async () => {
    if (!code.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/bambu/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json() as { success?: boolean; error?: string; tokenExpiration?: number };
      if (data.success) {
        localStorage.setItem('bambu_email', email.trim());
        localStorage.setItem('bambu_token_exp', String(data.tokenExpiration ?? 0));
        saveServerSettings({ bambu_email: email.trim(), bambu_token_exp: String(data.tokenExpiration ?? 0) });
        setStep('connecting');
        setTimeout(onComplete, 1500);
      } else {
        setError(data.error ?? 'Invalid code');
      }
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const CLIP = 'polygon(12px 0%,calc(100% - 12px) 0%,100% 12px,100% calc(100% - 12px),calc(100% - 12px) 100%,12px 100%,0% calc(100% - 12px),0% 12px)';

  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: 'radial-gradient(ellipse at 50% 50%,rgba(34,211,238,0.06) 0%,transparent 70%)' }}>
      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle,rgba(34,211,238,0.18) 1px,transparent 1px)', backgroundSize: '30px 30px' }} />

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-md px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <svg viewBox="0 0 32 32" width="36" height="36" fill="none" stroke="#22d3ee" strokeWidth="1.5">
              <rect x="6" y="10" width="20" height="16" rx="2"/>
              <path d="M10 10V7a6 6 0 0 1 12 0v3"/>
              <circle cx="16" cy="18" r="3" fill="rgba(34,211,238,0.3)"/>
              <path d="M8 6h16"/>
            </svg>
            <h1 className="text-2xl font-bold text-white tracking-wide">3D Printers</h1>
          </div>
          <p className="text-white/50 text-sm font-mono">Connect your Bambu Lab account</p>
        </div>

        <div className="p-6" style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.25)', clipPath: CLIP, backdropFilter: 'blur(12px)' }}>
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {(['email', 'code', 'connecting'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
                  style={{ background: step === s ? '#22d3ee' : ((['email','code','connecting'].indexOf(step)) > i ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.08)'), color: step === s ? '#000' : step === 'connecting' && s !== 'connecting' ? '#22d3ee' : 'rgba(255,255,255,0.4)' }}>
                  {i + 1}
                </div>
                {i < 2 && <div className="w-8 h-px" style={{ background: (['email','code','connecting'].indexOf(step)) > i ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.1)' }} />}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {step === 'email' && (
              <motion.div key="email" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div>
                  <label className="font-mono text-[11px] text-white/50 uppercase tracking-wider block mb-1.5">Bambu Lab Email</label>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendEmail()}
                    placeholder="you@example.com"
                    className="w-full bg-transparent px-3 py-2.5 text-white text-sm font-mono placeholder-white/20 focus:outline-none"
                    style={{ border: '1px solid rgba(34,211,238,0.3)', borderRadius: 6, background: 'rgba(0,0,0,0.3)' }}
                    autoFocus />
                </div>
                {error && <p className="text-red-400 text-xs font-mono">{error}</p>}
                <button onClick={sendEmail} disabled={loading || !email.trim()}
                  className="w-full py-2.5 font-mono text-sm font-bold uppercase tracking-widest transition-all disabled:opacity-40"
                  style={{ background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.5)', color: '#22d3ee', borderRadius: 6 }}>
                  {loading ? 'Sending…' : 'Send Verification Code'}
                </button>
              </motion.div>
            )}

            {step === 'code' && (
              <motion.div key="code" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <p className="text-white/60 text-xs font-mono text-center">Check <span className="text-cyan-400">{email}</span> for a 6-digit code</p>
                <div>
                  <label className="font-mono text-[11px] text-white/50 uppercase tracking-wider block mb-1.5">Verification Code</label>
                  <input
                    type="text" value={code} onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && verifyCode()}
                    placeholder="123456" maxLength={8}
                    className="w-full bg-transparent px-3 py-2.5 text-white text-xl font-mono text-center placeholder-white/20 tracking-widest focus:outline-none"
                    style={{ border: '1px solid rgba(34,211,238,0.3)', borderRadius: 6, background: 'rgba(0,0,0,0.3)' }}
                    autoFocus />
                </div>
                {error && <p className="text-red-400 text-xs font-mono">{error}</p>}
                <button onClick={verifyCode} disabled={loading || !code.trim()}
                  className="w-full py-2.5 font-mono text-sm font-bold uppercase tracking-widest transition-all disabled:opacity-40"
                  style={{ background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.5)', color: '#22d3ee', borderRadius: 6 }}>
                  {loading ? 'Verifying…' : 'Verify & Connect'}
                </button>
                <button onClick={() => { setStep('email'); setError(''); setCode(''); }}
                  className="w-full py-1.5 font-mono text-xs text-white/40 hover:text-white/60 transition-colors">
                  ← Use different email
                </button>
              </motion.div>
            )}

            {step === 'connecting' && (
              <motion.div key="connecting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-6 flex flex-col items-center gap-4">
                <motion.div className="w-12 h-12 rounded-full border-2 border-cyan-400 border-t-transparent" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
                <p className="font-mono text-sm text-white/60">Connecting to Bambu Cloud…</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

// ── AMS Filament display ───────────────────────────────────────────────────────

function AMSSlots({ ams }: { ams: PrinterTelemetry['ams'] }) {
  if (!ams?.ams?.[0]?.tray?.length) return null;
  const trays = ams.ams[0].tray;
  return (
    <div className="mt-3">
      <div className="font-mono text-[9px] uppercase tracking-widest text-white/30 mb-1.5">AMS Filaments</div>
      <div className="flex gap-2">
        {trays.map((t) => {
          const code = t.tray_color || (t.cols?.[0]) || '808080';
          const hex = code.length >= 6 ? `#${code.slice(0, 6)}` : '#808080';
          return (
            <div key={t.id} className="flex flex-col items-center gap-1">
              <div className="w-5 h-5 rounded-full border border-white/20 shadow" style={{ background: hex }} />
              <span className="font-mono text-[8px] text-white/30">{t.tray_id_name ?? t.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Printer Card ──────────────────────────────────────────────────────────────

function PrinterCard({ printer, telemetry, onCommand }: {
  printer: PrinterInfo;
  telemetry: PrinterTelemetry;
  onCommand: (deviceId: string, cmd: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sc = statusColor(telemetry.gcode_state);
  const isActive = ['RUNNING', 'PAUSE'].includes((telemetry.gcode_state ?? '').toUpperCase());
  const isRunning = (telemetry.gcode_state ?? '').toUpperCase() === 'RUNNING';
  const isPaused  = (telemetry.gcode_state ?? '').toUpperCase() === 'PAUSE';
  const pct = telemetry.mc_percent ?? 0;
  const img = getPrinterImage(printer.name);

  return (
    <motion.div layout
      className="relative flex flex-col"
      style={{ background: `rgba(${sc.rgb},0.05)`, border: `1px solid rgba(${sc.rgb},0.3)`, borderRadius: 12, overflow: 'hidden', boxShadow: `0 0 24px rgba(${sc.rgb},0.12)` }}>

      {/* Top glow line */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `rgba(${sc.rgb},0.6)` }} />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start gap-4">
          {/* Printer image */}
          <div className="shrink-0 w-40 h-40 flex items-center justify-center">
            {img
              ? <img src={img} alt={printer.name} className="w-40 h-40 object-contain drop-shadow-lg" style={{ filter: `drop-shadow(0 0 14px rgba(${sc.rgb},0.5))` }} />
              : <svg viewBox="0 0 48 48" width="80" height="80" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"><rect x="8" y="14" width="32" height="24" rx="3"/><path d="M14 14V9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5"/><circle cx="24" cy="26" r="5"/><path d="M12 38h24"/></svg>
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-white truncate">{printer.name}</h3>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full shrink-0"
                style={{ background: `rgba(${sc.rgb},0.12)`, border: `1px solid rgba(${sc.rgb},0.3)` }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: sc.color, boxShadow: `0 0 4px ${sc.color}`, ...(isRunning ? { animation: 'pulse 1.5s infinite' } : {}) }} />
                <span className="font-mono text-[10px] font-semibold" style={{ color: sc.color }}>{sc.label}</span>
              </div>
            </div>
            {printer.model && <p className="font-mono text-[11px] text-white/35 mb-2">{printer.model}</p>}
            {telemetry.subtask_name && telemetry.subtask_name !== '-' && (
              <p className="text-sm text-white/70 truncate mb-2">{telemetry.subtask_name}</p>
            )}

            {/* Progress bar */}
            {isActive || pct > 0 ? (
              <div className="mb-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-mono text-[10px] text-white/40">Progress</span>
                  <span className="font-mono text-sm font-bold" style={{ color: sc.color }}>{pct}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, rgba(${sc.rgb},0.6), ${sc.color})` }}
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
                </div>
                {telemetry.mc_remaining_time != null && (
                  <p className="font-mono text-[10px] text-white/30 mt-1">~{fmtTime(telemetry.mc_remaining_time)} remaining</p>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Temps row */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            { label: 'Nozzle', actual: telemetry.nozzle_temper, target: telemetry.nozzle_target_temper },
            { label: 'Bed',    actual: telemetry.bed_temper,    target: telemetry.bed_target_temper    },
            { label: 'Chamber', actual: telemetry.chamber_temper, target: undefined                   },
          ].map(({ label, actual, target }) => (
            <div key={label} className="flex flex-col items-center py-2 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <span className="font-mono text-[9px] text-white/35 uppercase tracking-wider mb-0.5">{label}</span>
              <span className="font-mono text-base font-bold text-white">{actual != null ? `${Math.round(actual as number)}°` : '—'}</span>
              {target != null && <span className="font-mono text-[9px] text-white/25">/{Math.round(target as number)}°</span>}
            </div>
          ))}
        </div>

        {/* Controls */}
        {isActive && (
          <div className="flex gap-2 mt-4">
            <button onClick={() => onCommand(printer.deviceId, isPaused ? 'resume' : 'pause')}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-mono text-xs font-semibold uppercase tracking-wider transition-all hover:brightness-125"
              style={{ background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)', color: '#facc15' }}>
              {isPaused
                ? <><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M4 3l10 5-10 5z"/></svg>Resume</>
                : <><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="3" y="3" width="3.5" height="10" rx="1"/><rect x="9.5" y="3" width="3.5" height="10" rx="1"/></svg>Pause</>
              }
            </button>
            <button onClick={() => onCommand(printer.deviceId, 'stop')}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-mono text-xs font-semibold uppercase tracking-wider transition-all hover:brightness-125"
              style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>
              Stop
            </button>
          </div>
        )}

        {/* Expand toggle */}
        <button onClick={() => setExpanded(!expanded)}
          className="w-full mt-3 py-1 font-mono text-[9px] uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors flex items-center justify-center gap-1">
          {expanded ? '▲ Less' : '▼ More'} details
        </button>
      </div>

      {/* Expanded section */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <div className="p-5 pt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Serial', value: printer.deviceId },
                  { label: 'WiFi Signal', value: telemetry.wifi_signal ?? '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="font-mono text-[9px] text-white/30 uppercase tracking-wider mb-0.5">{label}</div>
                    <div className="font-mono text-xs text-white/70 truncate">{String(value)}</div>
                  </div>
                ))}
              </div>
              <AMSSlots ams={telemetry.ams} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Print History Card ────────────────────────────────────────────────────────

function TaskCard({ task }: { task: PrintTask }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
      {task.cover && (
        <div className="h-32 overflow-hidden">
          <img src={task.cover} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-white truncate mb-1">{task.title ?? 'Untitled'}</h3>
        <p className="font-mono text-[10px] text-white/40">{task.deviceName}</p>
        <div className="flex items-center gap-2 mt-2">
          <span className="font-mono text-[9px] px-2 py-0.5 rounded-full"
            style={{ background: task.status === 2 ? 'rgba(34,211,238,0.1)' : 'rgba(255,255,255,0.05)', color: task.status === 2 ? '#22d3ee' : 'rgba(255,255,255,0.35)', border: `1px solid ${task.status === 2 ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.1)'}` }}>
            {task.status === 1 ? 'Active' : task.status === 2 ? 'Done' : 'Unknown'}
          </span>
          {task.costTime != null && (
            <span className="font-mono text-[9px] text-white/30">{fmtTime(task.costTime)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface Props { onNavigateHome: () => void }

export function PrinterPage({ onNavigateHome }: Props) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [printers, setPrinters]           = useState<PrinterInfo[]>([]);
  const [telemetry, setTelemetry]         = useState<Record<string, PrinterTelemetry>>({});
  const [tasks, setTasks]                 = useState<PrintTask[]>([]);
  const [tab, setTab]                     = useState<'dashboard' | 'history'>('dashboard');
  const [mqttConnected, setMqttConnected] = useState(false);
  const [clock, setClock]                 = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  const checkStatus = useCallback(async () => {
    const res = await fetch('/api/bambu/status');
    const data = await res.json() as { authenticated?: boolean; mqttConnected?: boolean };
    setAuthenticated(data.authenticated ?? false);
    setMqttConnected(data.mqttConnected ?? false);
    return data.authenticated ?? false;
  }, []);

  const fetchPrinters = useCallback(async () => {
    try {
      const res = await fetch('/api/bambu/printers');
      if (res.ok) setPrinters(await res.json() as PrinterInfo[]);
    } catch {}
  }, []);

  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await fetch('/api/bambu/telemetry');
      if (res.ok) setTelemetry(await res.json() as Record<string, PrinterTelemetry>);
    } catch {}
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/bambu/tasks');
      if (res.ok) {
        const d = await res.json() as { tasks?: PrintTask[] };
        setTasks(d.tasks ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    checkStatus().then((auth) => {
      if (auth) {
        fetchPrinters();
        fetchTelemetry();
      }
    });
  }, [checkStatus, fetchPrinters, fetchTelemetry]);

  // Poll telemetry every 3s when authenticated
  useEffect(() => {
    if (authenticated) {
      pollRef.current = setInterval(() => { fetchTelemetry(); checkStatus(); }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [authenticated, fetchTelemetry, checkStatus]);

  const sendCommand = async (deviceId: string, cmd: string) => {
    await fetch('/api/bambu/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, command: cmd }),
    });
    setTimeout(fetchTelemetry, 500);
  };

  const handleWizardComplete = async () => {
    await checkStatus();
    await fetchPrinters();
    await fetchTelemetry();
  };

  const activePrinters = printers.filter((p) => {
    const s = (telemetry[p.deviceId]?.gcode_state ?? '').toUpperCase();
    return s === 'RUNNING' || s === 'PAUSE';
  });

  const pageContent = () => {
  // ── Loading state ──────────────────────────────────────────────────────────
  if (authenticated === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div className="w-10 h-10 rounded-full border-2 border-cyan-400 border-t-transparent"
          animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
      </div>
    );
  }

  // ── Not authenticated — wizard ─────────────────────────────────────────────
  if (!authenticated) {
    return (
      <>
        <PageHeader title="3D Printers" onNavigateHome={onNavigateHome} right={<span className="font-mono text-xs text-white/30">{clock}</span>} />
        <BambuWizard onComplete={handleWizardComplete} />
      </>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <>

      <PageHeader
        title="3D Printers"
        onNavigateHome={onNavigateHome}
        right={
          <>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${mqttConnected ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
              <span className="font-mono text-[10px]" style={{ color: mqttConnected ? '#4ade80' : 'rgba(255,255,255,0.3)' }}>
                {mqttConnected ? 'Cloud Connected' : 'Connecting…'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)' }}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="#22d3ee" strokeWidth="1.5"><rect x="2" y="5" width="12" height="8" rx="1.5"/><path d="M5 5V4a3 3 0 0 1 6 0v1"/></svg>
              <span className="font-mono text-[10px] text-cyan-400">{printers.length} printer{printers.length !== 1 ? 's' : ''}</span>
            </div>
            {activePrinters.length > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.3)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-[10px] text-emerald-400">{activePrinters.length} printing</span>
              </div>
            )}
            <span className="font-mono text-xs text-white/30">{clock}</span>
          </>
        }
      />

      {/* Tab bar */}
      <div className="relative z-10 flex items-center gap-1 px-6 py-2 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {(['dashboard', 'history'] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); if (t === 'history') fetchTasks(); }}
            className="px-4 py-1.5 font-mono text-xs uppercase tracking-widest rounded-md transition-all"
            style={tab === t
              ? { background: 'rgba(34,211,238,0.12)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)' }
              : { background: 'transparent', color: 'rgba(255,255,255,0.35)', border: '1px solid transparent' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto px-6 py-6 scrollbar-hide">
        <AnimatePresence mode="wait">
          {tab === 'dashboard' && (
            <motion.div key="dash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {printers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="rgba(34,211,238,0.3)" strokeWidth="1.2">
                    <rect x="10" y="16" width="28" height="20" rx="3"/><path d="M16 16V11a8 8 0 0 1 16 0v5"/><circle cx="24" cy="26" r="4"/>
                  </svg>
                  <p className="font-mono text-sm text-white/30">No printers found</p>
                  <p className="font-mono text-[11px] text-white/20">Make sure your Bambu Cloud account has printers registered</p>
                  <button onClick={fetchPrinters} className="font-mono text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-400/30 px-4 py-1.5 rounded-md transition-colors">Refresh</button>
                </div>
              ) : (
                <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
                  {printers.map((p) => (
                    <PrinterCard key={p.deviceId} printer={p} telemetry={telemetry[p.deviceId] ?? {}} onCommand={sendCommand} />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'history' && (
            <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <p className="font-mono text-sm text-white/30">No print history found</p>
                </div>
              ) : (
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                  {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom status bar */}
      <div className="relative z-10 flex items-center justify-between px-6 py-2 shrink-0" style={{ borderTop: '1px solid rgba(34,211,238,0.08)', background: 'rgba(0,0,0,0.4)' }}>
        <span className="font-mono text-[9px] uppercase tracking-widest text-white/20">Jarvis · 3D Print Monitor</span>
        <button onClick={() => { setAuthenticated(false); fetch('/api/bambu/status', { method: 'DELETE' }); }}
          className="font-mono text-[9px] text-white/20 hover:text-red-400/70 transition-colors uppercase tracking-widest">
          Disconnect
        </button>
      </div>
    </>
  );
  }; // end pageContent

  return (
    <motion.div
      className="fixed inset-0 z-[50] overflow-hidden flex flex-col"
      style={{ background: '#030811' }}
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}>

      {/* Grid background */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle,rgba(34,211,238,0.12) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 50%,transparent 40%,rgba(3,8,17,0.9) 100%)' }} />
      {/* Scan line */}
      <motion.div className="absolute left-0 right-0 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg,transparent,rgba(34,211,238,0.15),transparent)', zIndex: 1 }}
        animate={{ top: ['-2%', '102%'] }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }} />
      {/* HUD corners */}
      {['top-0 left-0 border-t-2 border-l-2','top-0 right-0 border-t-2 border-r-2','bottom-0 left-0 border-b-2 border-l-2','bottom-0 right-0 border-b-2 border-r-2'].map((cls, i) => (
        <div key={i} className={`absolute w-6 h-6 pointer-events-none ${cls}`} style={{ borderColor: 'rgba(34,211,238,0.4)' }} />
      ))}

      {pageContent()}
    </motion.div>
  );
}
