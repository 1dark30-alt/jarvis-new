'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

interface PrinterTelemetry {
  gcode_state?: string;
  subtask_name?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  nozzle_temper?: number;
  bed_temper?: number;
  nozzle_target_temper?: number;
  bed_target_temper?: number;
}

interface PrinterInfo { deviceId: string; name: string; model?: string }

function getPrinterImage(name: string): string | null {
  const n = name.toUpperCase();
  if (n.includes('H2D'))    return '/assets/Printers/H2D.png';
  if (n.includes('X1C') || n.includes('CARBON') || n.includes('X1')) return '/assets/Printers/X1C.png';
  if (n.includes('P1S'))    return '/assets/Printers/P1S.png';
  if (n.includes('P1P'))    return '/assets/Printers/P1P.png';
  if (n.includes('A1 MINI') || n.includes('A1MINI')) return '/assets/Printers/A1mini.png';
  if (n.includes('A1'))     return '/assets/Printers/A1.png';
  return null;
}

function fmtTime(s?: number) {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function statusColor(state?: string) {
  switch ((state ?? '').toUpperCase()) {
    case 'RUNNING': return { color: '#4ade80', rgb: '74,222,128',  label: 'Printing' };
    case 'PAUSE':   return { color: '#facc15', rgb: '250,204,21',  label: 'Paused'   };
    case 'FAILED':  return { color: '#f87171', rgb: '248,113,113', label: 'Failed'   };
    case 'FINISH':  return { color: '#22d3ee', rgb: '34,211,238',  label: 'Finished' };
    default:        return { color: '#64748b', rgb: '100,116,139', label: state ?? 'Idle' };
  }
}

export function PrinterWidget({ config }: { config?: Record<string, unknown> }) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [telemetry, setTelemetry] = useState<Record<string, PrinterTelemetry>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const targetName = config?.printer_name as string | undefined;

  const fetchData = useCallback(async () => {
    try {
      const [pr, tr] = await Promise.all([fetch('/api/bambu/printers'), fetch('/api/bambu/telemetry')]);
      if (pr.ok) setPrinters(await pr.json());
      if (tr.ok) setTelemetry(await tr.json());
    } catch {}
  }, []);

  useEffect(() => { fetchData(); pollRef.current = setInterval(fetchData, 4000); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [fetchData]);

  const sendCmd = async (deviceId: string, command: string) => {
    await fetch('/api/bambu/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, command }) });
    setTimeout(fetchData, 500);
  };

  // Filter to target printer if specified
  const displayPrinters = targetName
    ? printers.filter((p) => p.name.toLowerCase().includes(targetName.toLowerCase()))
    : printers;

  if (!displayPrinters.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <p className="font-mono text-[10px] text-white/25">
          {printers.length === 0 ? 'Not connected to Bambu Cloud' : `Printer "${targetName}" not found`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {displayPrinters.map((printer) => {
        const t = telemetry[printer.deviceId] ?? {};
        const sc = statusColor(t.gcode_state);
        const isActive = ['RUNNING', 'PAUSE'].includes((t.gcode_state ?? '').toUpperCase());
        const pct = t.mc_percent ?? 0;
        const img = getPrinterImage(printer.name);

        return (
          <div key={printer.deviceId} className="relative p-3 rounded-lg"
            style={{ background: `rgba(${sc.rgb},0.06)`, border: `1px solid rgba(${sc.rgb},0.25)`, boxShadow: `0 0 16px rgba(${sc.rgb},0.08)` }}>
            <div className="absolute top-0 left-4 right-4 h-px rounded-full" style={{ background: `rgba(${sc.rgb},0.5)` }} />

            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
              {img && <img src={img} alt={printer.name} className="w-12 h-12 object-contain" style={{ filter: `drop-shadow(0 0 6px rgba(${sc.rgb},0.4))` }} />}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs font-bold text-white truncate">{printer.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: sc.color }} />
                  <span className="font-mono text-[10px]" style={{ color: sc.color }}>{sc.label}</span>
                </div>
              </div>
            </div>

            {/* Job name */}
            {t.subtask_name && t.subtask_name !== '-' && (
              <p className="font-mono text-[10px] text-white/50 truncate mb-1">{t.subtask_name}</p>
            )}

            {/* Progress */}
            {(isActive || pct > 0) && (
              <div className="mb-2">
                <div className="flex justify-between mb-1">
                  <span className="font-mono text-[9px] text-white/30">Progress</span>
                  <span className="font-mono text-[10px] font-bold" style={{ color: sc.color }}>{pct}% · {fmtTime(t.mc_remaining_time)} left</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <motion.div className="h-full rounded-full" style={{ background: sc.color }}
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
                </div>
              </div>
            )}

            {/* Temps */}
            <div className="flex gap-2 mb-2">
              {[{ label: 'Nozzle', val: t.nozzle_temper, target: t.nozzle_target_temper }, { label: 'Bed', val: t.bed_temper, target: t.bed_target_temper }].map(({ label, val, target }) => (
                <div key={label} className="flex-1 text-center py-1 rounded" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="font-mono text-[8px] text-white/30">{label}</div>
                  <div className="font-mono text-xs font-bold text-white">{val != null ? `${Math.round(val as number)}°` : '—'}</div>
                  {target != null && <div className="font-mono text-[8px] text-white/20">/{Math.round(target as number)}°</div>}
                </div>
              ))}
            </div>

            {/* Controls */}
            {isActive && (
              <div className="flex gap-1.5">
                <button onClick={() => sendCmd(printer.deviceId, t.gcode_state?.toUpperCase() === 'PAUSE' ? 'resume' : 'pause')}
                  className="flex-1 py-1 rounded font-mono text-[9px] font-semibold uppercase transition-all hover:brightness-125"
                  style={{ background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)', color: '#facc15' }}>
                  {t.gcode_state?.toUpperCase() === 'PAUSE' ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button onClick={() => sendCmd(printer.deviceId, 'stop')}
                  className="flex-1 py-1 rounded font-mono text-[9px] font-semibold uppercase transition-all hover:brightness-125"
                  style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
                  ■ Stop
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
