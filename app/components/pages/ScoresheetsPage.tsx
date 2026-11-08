'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * APA Scoresheets — the league operator's toolkit as a Jarvis screen.
 *
 * 1. FILE      the weekly combined Digital Scoresheets PDF, split per team
 * 2. RED LINE  both teams' copies reconciled against the league rules
 * 3. NEXUS     the match flattened into rows and typed into the APA Nexus
 *              portal with F9 — one press types Player #, IN, DS and Wins
 *              into whatever field has focus, then tabs to the next row.
 *
 * The engine is the user's own apa_toolkit.py (with the nexus-entry.enabled
 * marker), driven headless from scripts/.
 */

interface WeekFolder { name: string; division: string }

interface NexusRow {
  match: number; seat: number; member: string; name: string; SL: string;
  IN: string; DS: string; Wins: string; PTS: string;
  reconciled: boolean; exceptions: string[];
}

interface NexusState {
  running?: boolean; teams?: string; week?: string;
  rows?: NexusRow[]; idx?: number; lastTyped?: { match: number; member: string; name: string } | null;
  message?: string; error?: string;
}

export function ScoresheetsPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [league, setLeague] = useState('');
  const [leagueInput, setLeagueInput] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [weeks, setWeeks] = useState<WeekFolder[]>([]);
  const [pdfPath, setPdfPath] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processLog, setProcessLog] = useState('');
  const [pdfList, setPdfList] = useState<{ name: string; path: string; mtime: number }[]>([]);
  const [selectedPdf, setSelectedPdf] = useState('');
  const [season, setSeason] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('jarvis_apa_season') || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
  });
  const [legacyDivisions, setLegacyDivisions] = useState<string[]>([]);
  const [weekSel, setWeekSel] = useState('');
  const [matchSel, setMatchSel] = useState(0);
  const [nexus, setNexus] = useState<NexusState | null>(null);
  const [error, setError] = useState('');
  const helperRunningRef = useRef(false);

  const loadConfig = useCallback(async () => {
    const d = await fetch('/api/apa').then((r) => r.json()) as {
      configured?: boolean; league?: string; weeks?: WeekFolder[]; message?: string;
      legacyDivisions?: string[]; seasons?: string[];
    };
    setConfigured(Boolean(d.configured));
    setLeague(d.league ?? '');
    setLeagueInput(d.league ?? '');
    setWeeks(d.weeks ?? []);
    setLegacyDivisions(d.legacyDivisions ?? []);
    if (!d.configured && d.message) setError(d.message);
    const p = await fetch('/api/apa?op=list_pdfs').then((r) => r.json()) as { pdfs?: { name: string; path: string; mtime: number }[] };
    setPdfList(p.pdfs ?? []);
    if (!selectedPdf && (p.pdfs ?? []).length) setSelectedPdf(p.pdfs![0].path);
  }, [selectedPdf]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  // Live mirror of the helper state while it runs.
  useEffect(() => {
    if (!helperRunningRef.current) return;
    const t = setInterval(async () => {
      const d = await fetch('/api/apa?op=nexus_state').then((r) => r.json()) as NexusState;
      setNexus(d);
      if (d.running === false) helperRunningRef.current = false;
    }, 1000);
    return () => clearInterval(t);
  }, [nexus?.running]);

  const saveLeague = async () => {
    setError('');
    const d = await fetch('/api/apa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'set_league', leagueFolder: leagueInput }),
    }).then((r) => r.json()) as { ok?: boolean; league?: string; weeks?: WeekFolder[]; error?: string };
    if (d.error) { setError(d.error); return; }
    setLeague(d.league ?? '');
    setWeeks(d.weeks ?? []);
    setConfigured(true);
  };

  const process = async () => {
    if (!pdfPath.trim()) { setError('Give the path to the combined scoresheets PDF.'); return; }
    setProcessing(true);
    setProcessLog('');
    setError('');
    try {
      const d = await fetch('/api/apa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'process', pdfPath, season }),
      }).then((r) => r.json()) as { ok?: boolean; output?: string; error?: string };
      if (d.error) setError(d.error);
      setProcessLog(d.output ?? d.error ?? '');
      void loadConfig();
    } finally {
      setProcessing(false);
    }
  };

  const migrate = async () => {
    setError('');
    const d = await fetch('/api/apa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'migrate', season }),
    }).then((r) => r.json()) as { moved?: string[]; error?: string };
    if (d.error) { setError(d.error); return; }
    void loadConfig();
  };

  const startHelper = async () => {
    setError('');
    const d = await fetch('/api/apa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'nexus_start', weekFolder: weekSel, matchIndex: matchSel }),
    }).then((r) => r.json()) as { ok?: boolean; error?: string; state?: NexusState };
    if (d.error) { setError(d.error); return; }
    helperRunningRef.current = true;
    setNexus(d.state ?? { running: true });
  };

  const rows = nexus?.rows ?? [];
  const idx = nexus?.idx ?? 0;

  return (
    <motion.div
      key="scoresheets-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="APA Scoresheets"
        onNavigateHome={onNavigateHome}
        accent="cyan"
        right={<span className="font-mono text-[9px] uppercase tracking-widest text-white/30 max-w-[280px] truncate">{league || 'no league folder'}</span>}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        {error && <p className="text-[11px] text-red-300 font-mono">{error}</p>}

        {/* league folder */}
        <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
          <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70">League folder</div>
          <div className="flex gap-2">
            <input
              value={leagueInput}
              onChange={(e) => setLeagueInput(e.target.value)}
              placeholder="C:\APA\My League"
              className="flex-1 bg-black/40 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 font-mono text-xs"
            />
            <button onClick={() => void saveLeague()}
              className="px-3 py-2 rounded font-mono text-[10px] uppercase tracking-widest bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20">
              Save
            </button>
          </div>
        </div>

        {/* legacy layout migration */}
        {legacyDivisions.length > 0 && (
          <div className="rounded-lg p-4 flex items-center justify-between gap-4" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)' }}>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-amber-300 mb-1">Season layout</div>
              <p className="text-xs text-white/60">
                {legacyDivisions.join(', ')} sit at the league root. Move them into season <span className="font-mono text-amber-300">{season}</span>?
              </p>
            </div>
            <button
              onClick={() => void migrate()}
              className="px-3 py-2 rounded font-mono text-[10px] uppercase tracking-widest bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 shrink-0"
            >
              Move into {season}
            </button>
          </div>
        )}

        {/* process PDF */}
        <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
          <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70">1 · Pick &amp; process the weekly scoresheets PDF</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">Season</span>
            <input
              value={season}
              onChange={(e) => { setSeason(e.target.value); localStorage.setItem('jarvis_apa_season', e.target.value); }}
              className="bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100 font-mono text-xs w-36"
            />
            <span className="text-[10px] text-white/25 font-mono">{'files go to <league>\\<season>\\<division>\\Week N'}</span>
          </div>
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {pdfList.length === 0 && <p className="text-xs text-white/35">No PDFs found in Downloads or the league folder.</p>}
            {pdfList.map((p) => (
              <button key={p.path}
                onClick={() => { setSelectedPdf(p.path); setPdfPath(p.path); }}
                className={`w-full flex items-center gap-3 text-left px-3 py-2 rounded border transition-all ${
                  selectedPdf === p.path
                    ? 'bg-cyan-500/15 border-cyan-500/40'
                    : 'bg-white/[0.03] border-white/[0.06] hover:border-cyan-500/30'
                }`}>
                <span className="text-cyan-400/70 text-xs">📄</span>
                <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-white/75">{p.name}</span>
                <span className="font-mono text-[9px] text-white/25 shrink-0">{new Date(p.mtime).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={pdfPath}
              onChange={(e) => setPdfPath(e.target.value)}
              placeholder="…or paste a full path"
              className="flex-1 bg-black/40 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 font-mono text-xs"
            />
            <button onClick={() => void process()} disabled={processing || !configured || !(selectedPdf || pdfPath).trim()}
              className="px-3 py-2 rounded font-mono text-[10px] uppercase tracking-widest bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40 shrink-0">
              {processing ? 'Working…' : 'Process'}
            </button>
          </div>
          {processLog && (
            <pre className="font-mono text-[11px] text-white/60 whitespace-pre-wrap max-h-40 overflow-y-auto">{processLog}</pre>
          )}
        </div>

        {/* nexus helper */}
        <div className="rounded-lg p-4 space-y-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(250,204,21,0.15)' }}>
          <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-amber-400/70">2 · Type into Nexus</div>

          {weeks.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <select value={weekSel} onChange={(e) => { setWeekSel(e.target.value); setMatchSel(0); }}
                className="bg-black/40 border border-amber-500/30 rounded px-2 py-1.5 text-amber-100 text-xs">
                <option value="">Choose week…</option>
                {weeks.map((w) => <option key={w.name} value={w.name}>{w.division} — {w.name}</option>)}
              </select>
              <div className="text-[10px] text-white/30 font-mono self-center">
                {weekSel ? `matches red-lined in ${weekSel}` : 'pick a week folder'}
              </div>
            </div>
          )}
          {weeks.length === 0 && configured && (
            <p className="text-xs text-white/35">No Week folders in the league folder yet — process a PDF first.</p>
          )}

          {weekSel && (
            <div className="flex flex-wrap gap-1.5">
              {rows.map((r, i) => (
                <button key={i}
                  onClick={() => setMatchSel(nexus?.week === weekSel ? i : i)}
                  className={`px-2 py-1 rounded font-mono text-[10px] border transition-all ${
                    nexus && nexus.week === weekSel && i === nexus.idx
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                      : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-amber-200'
                  } ${r.exceptions.length ? 'border-red-500/40' : ''}`}
                  title={r.exceptions.length ? r.exceptions.join(', ') : `${r.name} — S/L ${r.SL}`}
                >
                  M{r.match} · {r.name.slice(0, 12)}{r.reconciled ? ' *' : ''}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => void startHelper()}
              disabled={!weekSel}
              className="px-4 py-2 rounded font-mono text-[10px] uppercase tracking-widest bg-amber-500/10 border border-amber-500/40 text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
            >
              ▶ Start F9 helper
            </button>
            {nexus?.running && <span className="font-mono text-[10px] text-amber-300 animate-pulse">{nexus.message}</span>}
            {!nexus?.running && nexus?.message && <span className="font-mono text-[10px] text-white/40">{nexus.message}</span>}
          </div>

          {nexus?.running && rows.length > 0 && (
            <div className="rounded-lg p-3 font-mono text-[11px] space-y-0.5" style={{ background: 'rgba(0,0,0,0.4)' }}>
              {rows.map((r, i) => (
                <div key={i} className={i === idx ? 'text-amber-300' : i < idx ? 'text-white/25' : 'text-white/60'}>
                  {i === idx ? '▶' : i < idx ? '✓' : ' '} M{r.match} seat {r.seat} · {r.name.slice(0, 18).padEnd(18)} · IN {String(r.IN).padStart(3)} · DS {String(r.DS).padStart(3)} · W {String(r.Wins).padStart(2)}
                  {r.exceptions.length ? <span className="text-red-400"> ⚠ {r.exceptions.join(', ')}</span> : r.reconciled ? <span className="text-amber-500/70"> *reconciled</span> : ''}
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-white/30 leading-relaxed">
            Click into the <span className="text-amber-300">Player #</span> box for the highlighted row in Nexus,
            then press <span className="font-mono text-amber-300">F9</span> — each press types Player #, IN, DS and Wins
            and tabs to the next row. <span className="font-mono">Ctrl+F9</span> skips a row,{' '}
            <span className="font-mono">Ctrl+F12</span> quits. Red ⚠ rows need something typed by hand
            (8-on-break, break-and-run, missing skill level).
          </p>
        </div>
      </div>
    </motion.div>
  );
}