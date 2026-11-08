'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Developer Mode — local engineering jobs with review and outputs. Port of
 * Mark 58's `core/developer.py`: allowlisted, bounded jobs over the project,
 * plus a static shape-of-the-codebase analysis. No free-form shell here.
 */

interface JobInfo { id: string; label: string }

interface Analysis {
  files: number;
  lines: number;
  byExt: Record<string, number>;
  largest: { name: string; lines: number }[];
}

interface JobResult {
  ok: boolean;
  job: string;
  label?: string;
  code?: number;
  output: string;
  error?: string;
  analysis?: Analysis;
}

export function DevModePage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [cwd, setCwd] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  useEffect(() => {
    fetch('/api/dev-jobs').then((r) => r.json()).then((d: { jobs?: JobInfo[]; cwd?: string }) => {
      setJobs(d.jobs ?? []);
      setCwd(d.cwd ?? '');
    }).catch(() => {});
  }, []);

  const run = useCallback(async (id: string) => {
    setRunning(id);
    setResult(null);
    try {
      const data = await fetch('/api/dev-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: id }),
      }).then((r) => r.json()) as JobResult;
      if (data.analysis) setAnalysis(data.analysis);
      else setResult(data);
    } catch (e) {
      setResult({ ok: false, job: id, output: '', error: String(e) });
    } finally {
      setRunning(null);
    }
  }, []);

  return (
    <motion.div
      key="devmode-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Developer"
        onNavigateHome={onNavigateHome}
        accent="cyan"
        right={<span className="font-mono text-[9px] uppercase tracking-widest text-white/30 max-w-[300px] truncate">{cwd}</span>}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void run('analyze')}
            disabled={running !== null}
            className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest border transition-all bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {running === 'analyze' ? 'Analyzing…' : 'Analyze codebase'}
          </button>
          {jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => void run(j.id)}
              disabled={running !== null}
              className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest border transition-all bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-cyan-300 hover:border-cyan-500/30 disabled:opacity-40"
            >
              {running === j.id ? `${j.label}…` : j.label}
            </button>
          ))}
        </div>

        {analysis && (
          <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70">Codebase</div>
            <div className="font-mono text-xs text-white/60">
              {analysis.files} code files · {analysis.lines.toLocaleString()} lines ·{' '}
              {Object.entries(analysis.byExt).map(([ext, n]) => `${ext} ${n.toLocaleString()}`).join(' · ')}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/30 pt-2">Largest files</div>
            {analysis.largest.map((f) => (
              <div key={f.name} className="flex justify-between font-mono text-[11px]">
                <span className="text-white/60 truncate">{f.name}</span>
                <span className="text-white/35 shrink-0 ml-3">{f.lines.toLocaleString()} lines</span>
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: `1px solid ${result.ok ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}` }}>
            <div className={`font-mono text-[9px] uppercase tracking-[0.3em] mb-2 ${result.ok ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
              {result.label ?? result.job} · {result.ok ? `passed` : `failed (exit ${result.code ?? '?'})`}
            </div>
            {result.error && <p className="text-red-300 text-xs mb-2">{result.error}</p>}
            <pre className="font-mono text-[11px] text-white/70 whitespace-pre-wrap max-h-[50vh] overflow-y-auto">{result.output || '(no output)'}</pre>
          </div>
        )}
      </div>
    </motion.div>
  );
}