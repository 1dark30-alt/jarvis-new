'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Health — the machine and service panel that needs no model call: CPU,
 * memory, disks, and whether the brains and stores are actually alive.
 * Port of Mark 58's platform_health philosophy: "the assistant does not
 * answer" has a first place to look.
 */

interface Health {
  machine: { cpuLoad: number; cores: number; memUsed: number; memTotal: number; uptimeSeconds: number; platform: string; hostname: string; serverUptimeSeconds: number };
  disks: { drive: string; total: number; free: number }[];
  services: {
    geminiLadder: { ok: boolean; detail: string };
    localModel: { configured: boolean; reachable: boolean };
    stores: { name: string; ok: boolean; detail: string }[];
  };
}

function fmt(b: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = b;
  for (const u of units) {
    if (v < 1024 || u === 'TB') return `${v.toFixed(v < 10 ? 1 : 0)} ${u}`;
    v /= 1024;
  }
  return `${v} TB`;
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function Gauge({ label, value, warnAt = 0.85 }: { label: string; value: number; warnAt?: number }) {
  const pct = Math.min(1, Math.max(0, value));
  const color = pct >= warnAt ? 'bg-red-400' : pct >= warnAt * 0.7 ? 'bg-amber-400' : 'bg-cyan-400';
  return (
    <div>
      <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest text-white/45 mb-1">
        <span>{label}</span><span>{(pct * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

export function HealthPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);

  const refresh = useCallback(async () => {
    try { setHealth(await fetch('/api/health').then((r) => r.json())); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <motion.div
      key="health-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Health"
        onNavigateHome={onNavigateHome}
        accent="green"
        right={<span className="font-mono text-[9px] uppercase tracking-widest text-white/30">{health?.machine.hostname} · refreshes live</span>}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-5">
        {!health ? (
          <p className="text-sm text-white/40 animate-pulse">Reading the machine…</p>
        ) : (
          <>
            <div className="rounded-lg p-4 space-y-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70">Machine</div>
              <Gauge label={`CPU · ${health.machine.cores} cores`} value={health.machine.cpuLoad} />
              <Gauge label={`Memory · ${fmt(health.machine.memTotal)}`} value={health.machine.memUsed / health.machine.memTotal} />
              {health.disks.map((d) => (
                <Gauge key={d.drive} label={`Disk ${d.drive} · ${fmt(d.total)}`} value={d.total ? (d.total - d.free) / d.total : 0} />
              ))}
              <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-white/35 pt-1">
                <span>{health.machine.platform}</span>
                <span>machine up {fmtUptime(health.machine.uptimeSeconds)}</span>
                <span>jarvis up {fmtUptime(health.machine.serverUptimeSeconds)}</span>
              </div>
            </div>

            <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70">Services</div>
              <div className="flex items-center gap-3 text-sm">
                <span className={`w-2 h-2 rounded-full ${health.services.geminiLadder.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-white/75">Gemini text ladder</span>
                <span className="text-white/40 text-xs">{health.services.geminiLadder.detail}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className={`w-2 h-2 rounded-full ${health.services.localModel.reachable ? 'bg-emerald-400' : health.services.localModel.configured ? 'bg-red-400' : 'bg-white/25'}`} />
                <span className="text-white/75">Local model</span>
                <span className="text-white/40 text-xs">
                  {!health.services.localModel.configured ? 'not configured'
                    : health.services.localModel.reachable ? 'reachable' : 'configured but unreachable'}
                </span>
              </div>
            </div>

            <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70">Data stores</div>
              {health.services.stores.map((s) => (
                <div key={s.name} className="flex items-center gap-3 text-sm">
                  <span className={`w-2 h-2 rounded-full ${s.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="font-mono text-xs text-white/70">{s.name}</span>
                  <span className="text-white/35 text-xs">{s.detail}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}