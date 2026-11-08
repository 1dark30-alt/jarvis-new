'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Network Radar — who is on the network and how good the connection is.
 * Devices appear on a live radar (angle by address, radius by recency of
 * the sweep); strangers — MACs never seen before — carry a NEW badge.
 */

interface Device { ip: string; mac: string; vendor: string; isNew: boolean; firstSeen: string | null; lastSeen: string }
interface Quality { gateway: { ip: string; avgMs: number | null; lossPct: number }; internet: { host: string; avgMs: number | null; lossPct: number } }

function hashAngle(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function NetworkRadarPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [subnet, setSubnet] = useState('');
  const [quality, setQuality] = useState<Quality | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sweepAngle, setSweepAngle] = useState(0);

  const scan = useCallback(async () => {
    setScanning(true);
    const sweep = setInterval(() => setSweepAngle((a) => (a + 6) % 360), 40);
    try {
      const d = await fetch('/api/network-radar?op=scan').then((r) => r.json()) as { devices?: Device[]; subnet?: string };
      setDevices(d.devices ?? []);
      setSubnet(d.subnet ?? '');
    } catch { /* ignore */ }
    finally { clearInterval(sweep); setScanning(false); }
  }, []);

  const checkQuality = useCallback(async () => {
    try { setQuality(await fetch('/api/network-radar?op=quality').then((r) => r.json())); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void scan(); void checkQuality(); }, [scan, checkQuality]);

  // Radar geometry: dot angle from a stable hash of the MAC, radius from
  // the last octet (deterministic, spread around the circle).
  const R = 130;
  const dots = devices.map((d) => {
    const last = Number(d.ip.split('.').pop() ?? 1);
    const radius = 30 + (last / 254) * (R - 40);
    const angle = (hashAngle(d.mac) - 90) * Math.PI / 180;
    return { ...d, cx: R + radius * Math.cos(angle), cy: R + radius * Math.sin(angle) };
  });

  return (
    <motion.div
      key="network-radar-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Network Radar"
        onNavigateHome={onNavigateHome}
        accent="cyan"
        right={
          <button
            onClick={() => void scan()}
            disabled={scanning}
            className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-cyan-300 hover:border-cyan-500/30 disabled:opacity-40"
          >
            {scanning ? 'Sweeping…' : 'Rescan'}
          </button>
        }
      />

      <div className="flex-1 min-h-0 flex px-6 py-4 gap-6 overflow-hidden">
        {/* radar */}
        <div className="w-[300px] shrink-0 flex flex-col items-center">
          <svg viewBox="0 0 300 300" className="w-full max-w-[280px]">
            <circle cx="150" cy="150" r={R} fill="rgba(10,20,30,0.5)" stroke="rgba(34,211,238,0.25)" />
            <circle cx="150" cy="150" r={R * 0.66} fill="none" stroke="rgba(34,211,238,0.15)" />
            <circle cx="150" cy="150" r={R * 0.33} fill="none" stroke="rgba(34,211,238,0.15)" />
            <line x1="150" y1={150 - R} x2="150" y2={150 + R} stroke="rgba(34,211,238,0.1)" />
            <line x1={150 - R} y1="150" x2={150 + R} y2="150" stroke="rgba(34,211,238,0.1)" />
            {scanning && (
              <line
                x1="150" y1="150"
                x2={150 + R * Math.cos((sweepAngle - 90) * Math.PI / 180)}
                y2={150 + R * Math.sin((sweepAngle - 90) * Math.PI / 180)}
                stroke="rgba(34,211,238,0.5)" strokeWidth={2}
              />
            )}
            <circle cx="150" cy="150" r="4" fill="#22d3ee" />
            {dots.map((d) => (
              <g key={d.mac}>
                <circle cx={d.cx} cy={d.cy} r={d.isNew ? 6 : 4} fill={d.isNew ? '#fbbf24' : '#34d399'} opacity={0.9}>
                  <title>{`${d.ip} · ${d.vendor}`}</title>
                </circle>
                <circle cx={d.cx} cy={d.cy} r={d.isNew ? 10 : 7} fill="none" stroke={d.isNew ? 'rgba(251,191,36,0.5)' : 'rgba(52,211,153,0.3)'} />
              </g>
            ))}
          </svg>
          <div className="font-mono text-[10px] text-white/35 mt-1">
            {devices.length} device{devices.length === 1 ? '' : 's'} on {subnet || '—'}
          </div>

          {/* quality */}
          <div className="w-full mt-4 rounded-lg p-3 space-y-1.5" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70">Connection</div>
            {quality ? (
              <>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-white/60">Gateway {quality.gateway.ip}</span>
                  <span className={quality.gateway.avgMs ? 'text-white/80' : 'text-red-400'}>
                    {quality.gateway.avgMs !== null ? `${quality.gateway.avgMs} ms` : 'no reply'} · {quality.gateway.lossPct}% loss
                  </span>
                </div>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-white/60">Internet</span>
                  <span className={quality.internet.avgMs ? 'text-white/80' : 'text-red-400'}>
                    {quality.internet.avgMs !== null ? `${quality.internet.avgMs} ms` : 'no reply'} · {quality.internet.lossPct}% loss
                  </span>
                </div>
              </>
            ) : <span className="text-white/30 text-xs">measuring…</span>}
          </div>
        </div>

        {/* device list */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="space-y-1.5">
            {devices.map((d) => (
              <div key={d.mac + d.ip} className="flex items-center gap-3 rounded-md px-3 py-2"
                style={{ background: 'rgba(10,15,20,0.7)', border: d.isNew ? '1px solid rgba(251,191,36,0.35)' : '1px solid rgba(255,255,255,0.06)' }}>
                <span className={`font-mono text-xs ${d.isNew ? 'text-amber-300' : 'text-cyan-300'}`}>{d.ip}</span>
                <span className="font-mono text-[10px] text-white/30">{d.mac}</span>
                <span className="text-xs text-white/60 flex-1 truncate">{d.vendor}</span>
                {d.isNew && <span className="px-1.5 py-0.5 rounded font-mono text-[8px] uppercase tracking-widest bg-amber-500/15 border border-amber-500/40 text-amber-300">new</span>}
              </div>
            ))}
            {!scanning && devices.length === 0 && (
              <p className="text-sm text-white/40">No devices found — run a scan.</p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}