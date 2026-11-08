'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Missions — long work running in the background while the conversation goes
 * on. Shows every mission's status and budget, the full cited report when it
 * is done, and a cancel for missions still in flight.
 */

interface MissionSummary {
  id: string;
  title: string;
  kind: string;
  agent: string;
  status: string;
  budgetMinutes: number;
  minutesUsed?: number;
  createdAt: number;
  finishedAt?: number;
  findings: number;
  sources: number;
  verified: number;
  error?: string;
}

interface MissionDetail extends Omit<MissionSummary, 'sources' | 'findings' | 'verified'> {
  task: string;
  report?: string;
  steps?: { id: string; title: string; status: string; result: string }[];
  sources?: { n: number; url: string; title: string }[];
  findings?: number;
  verified?: number;
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  investigating: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
  writing: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
  running: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
  done: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  failed: 'text-red-300 border-red-500/40 bg-red-500/10',
  cancelled: 'text-white/40 border-white/20 bg-white/5',
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MissionsPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [detail, setDetail] = useState<MissionDetail | null>(null);

  const detailIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetch('/api/missions').then((r) => r.json()) as { missions?: MissionSummary[] };
      setMissions(data.missions ?? []);
      // Keep an open detail live (running missions update in place).
      const id = detailIdRef.current;
      if (id) {
        const d = await fetch(`/api/missions?id=${encodeURIComponent(id)}`).then((r) => r.json()) as { mission?: MissionDetail };
        setDetail(d.mission ?? null);
      }
    } catch { /* ignore */ }
  }, []);

  const openDetail = useCallback(async (id: string) => {
    detailIdRef.current = id;
    try {
      const data = await fetch(`/api/missions?id=${encodeURIComponent(id)}`).then((r) => r.json()) as { mission?: MissionDetail };
      setDetail(data.mission ?? null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const closeDetail = useCallback(() => {
    detailIdRef.current = null;
    setDetail(null);
  }, []);

  const cancel = async (id: string) => {
    await fetch('/api/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'cancel', id }),
    });
    void refresh();
  };

  const active = missions.filter((m) => !['done', 'failed', 'cancelled'].includes(m.status));
  const finished = missions.filter((m) => ['done', 'failed', 'cancelled'].includes(m.status));

  return (
    <motion.div
      key="missions-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Missions"
        onNavigateHome={onNavigateHome}
        accent="cyan"
        right={
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">
            Background agents · never touch your computer
          </span>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        {detail ? (
          <div>
            <button
              onClick={closeDetail}
              className="mb-4 font-mono text-[10px] uppercase tracking-widest text-white/40 hover:text-cyan-300 transition-colors"
            >
              ← All missions
            </button>
            <div className="flex items-center gap-3 mb-2">
              <span className={`px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-widest border ${STATUS_COLORS[detail.status] ?? STATUS_COLORS.cancelled}`}>
                {detail.status}
              </span>
              <span className="font-mono text-[10px] text-white/40">
                {detail.agent} · {detail.minutesUsed !== undefined ? `${detail.minutesUsed.toFixed(1)} min used` : `${detail.budgetMinutes} min budget`}
              </span>
            </div>
            <h2 className="text-lg font-semibold mb-1">{detail.title}</h2>
            <p className="text-sm text-white/50 mb-4">{detail.task}</p>

            {detail.steps && detail.steps.length > 0 && (
              <div className="mb-4">
                <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70 mb-2">Plan</div>
                <div className="space-y-1">
                  {detail.steps.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 text-xs">
                      <span className={`font-mono text-[9px] uppercase w-20 shrink-0 ${
                        s.status === 'done' ? 'text-emerald-400' : s.status === 'running' ? 'text-cyan-300' : s.status === 'skipped' ? 'text-white/30' : s.status === 'failed' ? 'text-red-400' : 'text-white/40'
                      }`}>{s.status}</span>
                      <span className="text-white/70 truncate">{s.title}</span>
                      <span className="text-white/30 font-mono text-[10px] shrink-0">{s.result}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.report ? (
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-2">Report</div>
                <div className="rounded-lg p-4 text-sm leading-relaxed text-white/80 whitespace-pre-wrap"
                  style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
                  {detail.report}
                </div>
              </div>
            ) : (
              <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400/60 animate-pulse">
                working — {detail.findings ?? 0} findings · {detail.verified ?? 0} verified · {(detail.sources ?? []).length} pages read
              </div>
            )}

            {detail.error && <p className="text-red-300 text-sm mt-3">{detail.error}</p>}
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <div className="mb-5">
                <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70 mb-2">In flight</div>
                <div className="space-y-2">
                  {active.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg px-4 py-3"
                      style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
                      <span className={`px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-widest border shrink-0 ${STATUS_COLORS[m.status] ?? STATUS_COLORS.cancelled}`}>
                        {m.status}
                      </span>
                      <button onClick={() => void openDetail(m.id)} className="flex-1 text-left min-w-0">
                        <div className="text-sm truncate hover:text-cyan-300 transition-colors">{m.title}</div>
                        <div className="font-mono text-[9px] text-white/30">
                          {m.agent} · started {fmtTime(m.createdAt)} · {m.findings} findings
                        </div>
                      </button>
                      <button
                        onClick={() => void cancel(m.id)}
                        className="px-2.5 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.08] text-white/45 hover:text-red-300 hover:border-red-500/30 transition-all shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/30 mb-2">Finished</div>
            {finished.length === 0 ? (
              <p className="text-sm text-white/40">
                No missions yet. Ask Jarvis: &ldquo;research this in the background for ten minutes…&rdquo;
              </p>
            ) : (
              <div className="space-y-2">
                {finished.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg px-4 py-3"
                    style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className={`px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-widest border shrink-0 ${STATUS_COLORS[m.status] ?? STATUS_COLORS.cancelled}`}>
                      {m.status}
                    </span>
                    <button onClick={() => void openDetail(m.id)} className="flex-1 text-left min-w-0">
                      <div className="text-sm truncate hover:text-cyan-300 transition-colors">{m.title}</div>
                      <div className="font-mono text-[9px] text-white/30">
                        {m.kind} · {m.verified}/{m.findings} verified findings · {m.sources} sources
                        {m.minutesUsed !== undefined && ` · ${m.minutesUsed.toFixed(1)} min`}
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}