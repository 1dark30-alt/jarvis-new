'use client';

import { useEffect, useState } from 'react';

interface HostResult {
  target: string;
  up: boolean;
  latencyMs: number | null;
}

/** Reachability tiles for hosts you care about (router, NAS, servers, WAN).
 *  Uses the local /api/host-check TCP probe — no external services. */
export function UptimeWidget({ config }: { config?: Record<string, unknown> }) {
  const [results, setResults] = useState<HostResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  const targets = typeof config?.hosts === 'string' && config.hosts.trim()
    ? config.hosts
    : '1.1.1.1:53,8.8.8.8:53,github.com:443';

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setChecking(true);
      try {
        const res = await fetch(`/api/host-check?targets=${encodeURIComponent(targets)}`);
        const data = await res.json() as { results?: HostResult[] };
        if (alive && Array.isArray(data.results)) setResults(data.results);
      } catch { /* keep last */ }
      if (alive) setChecking(false);
    };
    void load();
    const interval = window.setInterval(load, 30_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [targets]);

  if (results === null) {
    return <div className="h-full flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;
  }

  const upCount = results.filter((r) => r.up).length;

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center justify-between shrink-0">
        <span className="font-mono text-[9px] uppercase tracking-widest text-white/35">
          {upCount}/{results.length} online
        </span>
        <span
          className={`w-1.5 h-1.5 rounded-full ${checking ? 'animate-pulse' : ''}`}
          style={{ background: upCount === results.length ? '#34d399' : '#f87171' }}
        />
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-0">
        {results.map((r) => (
          <div key={r.target} className="flex items-center gap-2.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background: r.up ? '#34d399' : '#f87171',
                boxShadow: `0 0 8px ${r.up ? 'rgba(52,211,153,0.6)' : 'rgba(248,113,113,0.6)'}`,
              }}
            />
            <span className="font-mono text-[11px] text-white/75 truncate flex-1">{r.target}</span>
            <span className="font-mono text-[10px] shrink-0" style={{ color: r.up ? 'rgba(52,211,153,0.8)' : 'rgba(248,113,113,0.8)' }}>
              {r.up ? `${r.latencyMs}ms` : 'DOWN'}
            </span>
          </div>
        ))}
      </div>

      <p className="font-mono text-[8px] text-white/20 uppercase tracking-widest shrink-0">TCP probe · 30s cycle</p>
    </div>
  );
}
