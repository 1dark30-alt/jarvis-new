'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';
import { notify } from '../../lib/notify';

/**
 * Financial Tracker — the league finance workbook as a live Jarvis screen.
 *
 * Weekly team counts (× the Players-Fund rates) fund the players fund; the
 * actual bank deposit and the Players-Fund expenses are tracked alongside.
 * Everything is edited here and written back into the real .xlsx in the
 * vault — synced to the laptop and Olares, formulas and formatting intact.
 */

interface Rate { label: string; players: number | null; basic: number | null }
interface Week {
  row: number; date: string; invoice: string;
  teams: (number | null)[]; funds: (number | null)[]; total: number | null; deposit: number | null;
}
interface Expense { row: number; date: string; amount: number | null; description: string }
interface Fee { row: number; label: string; value: number | null }
interface Session { name: string; rates: Rate[]; weeks: Week[]; expenses: Expense[]; fees: Fee[]; grandTotal: { row: number; value: number | null } | null }
interface TrackerData { file: string; year: string; lo: string; extras: { name: string; rows: string[][] }[]; sessions: Session[] }

const TEAM_HEADERS = ['8B Teams', 'Teams 2', 'Teams 3', 'Teams 4'];
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function TrackerPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    const d = await fetch('/api/tracker').then((r) => r.json()) as TrackerData & { configured?: boolean; message?: string; error?: string };
    if (d.error || d.message) { setError(d.error ?? d.message ?? ''); setData(null); return; }
    setData(d);
    if (!sessionName && d.sessions.length) setSessionName(d.sessions[0].name);
  }, [sessionName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const session = data?.sessions.find((s) => s.name === sessionName) ?? null;
  const extra = data?.extras.find((e) => e.name === sessionName) ?? null;

  const update = (mut: (s: Session) => void) => {
    if (!data || !session) return;
    const next: TrackerData = { ...data, sessions: data.sessions.map((s) => (s.name === session.name ? { ...s } : s)) };
    const ns = next.sessions.find((s) => s.name === session.name)!;
    mut(ns);
    setData(next);
    setDirty(true);
  };

  const save = async () => {
    if (!data || !session) return;
    setSaving(true);
    setMessage('');
    const res = await fetch('/api/tracker', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'save',
        rates: data.sessions.flatMap((s) => s.rates.map((r) => ({ session: s.name, ...r }))),
        weeks: data.sessions.flatMap((s) => s.weeks.map((w) => ({ session: s.name, row: w.row, teams: w.teams, deposit: w.deposit }))),
        expenses: data.sessions.map((s) => ({ session: s.name, rows: s.expenses.map((e) => ({ date: e.date, amount: e.amount, description: e.description })) })),
        fees: data.sessions.flatMap((s) => s.fees.map((f) => ({ session: s.name, row: f.row, value: f.value }))),
      }),
    }).then((r) => r.json()) as { ok?: boolean; error?: string };
    setSaving(false);
    if (res.error) { setMessage('Save failed: ' + res.error); return; }
    setDirty(false);
    setMessage('Saved to the vault workbook — synced to the laptop.');
    setTimeout(() => setMessage(''), 6000);
  };

  const download = async () => {
    const res = await fetch('/api/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'download' }) });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Financial Tracker.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  if (error && !data) {
    return (
      <motion.div key="tracker-page" className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
        initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }} animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
        exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }} transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}>
        <PageHeader title="Financial Tracker" onNavigateHome={onNavigateHome} accent="green" />
        <div className="flex-1 flex items-center justify-center px-6">
          <p className="text-sm text-white/50 text-center max-w-md">{error}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="tracker-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Financial Tracker"
        onNavigateHome={onNavigateHome}
        accent="green"
        right={
          <div className="flex items-center gap-2">
            {dirty && <span className="font-mono text-[9px] uppercase tracking-widest text-amber-400">unsaved</span>}
            <button onClick={() => void download()}
              className="px-2.5 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.12] text-white/60 hover:text-emerald-300 hover:border-emerald-500/40">
              ⤓ Export xlsx
            </button>
            <button onClick={() => void save()} disabled={saving || !dirty}
              className="px-3 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40">
              {saving ? 'Saving…' : '💾 Save to workbook'}
            </button>
          </div>
        }
      />

      {message && <p className="px-6 pt-2 text-[11px] font-mono text-emerald-300">{message}</p>}

      <div className="px-6 pt-3 flex flex-wrap gap-2 shrink-0">
        {data?.sessions.map((s) => (
          <button key={s.name} onClick={() => setSessionName(s.name)}
            className={`px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest border transition-all ${
              sessionName === s.name ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-emerald-300'
            }`}>{s.name}</button>
        ))}
        {data?.extras.map((e) => (
          <button key={e.name} onClick={() => setSessionName(e.name)}
            className={`px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest border transition-all ${
              sessionName === e.name ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-cyan-300'
            }`}>{e.name} <span className="text-[8px] text-white/25">view</span></button>
        ))}
        {data && <span className="font-mono text-[10px] text-white/25 self-center ml-2">{data.year} · {data.lo}</span>}
      </div>

      {session && (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {/* rates */}
          <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70">Fund rates</div>
            {session.rates.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={r.label} onChange={(e) => update((s) => { s.rates[i].label = e.target.value; })}
                  className="flex-1 bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-white/80" />
                <input type="number" value={r.players ?? ''} onChange={(e) => update((s) => { s.rates[i].players = e.target.value === '' ? null : Number(e.target.value); })}
                  className="w-24 bg-black/40 border border-cyan-500/30 rounded px-2 py-1.5 text-xs text-cyan-100 font-mono" title="Players Fund rate" />
                <input type="number" value={r.basic ?? ''} onChange={(e) => update((s) => { s.rates[i].basic = e.target.value === '' ? null : Number(e.target.value); })}
                  className="w-24 bg-black/40 border border-cyan-500/30 rounded px-2 py-1.5 text-xs text-cyan-100 font-mono" title="Basic Weekly rate" />
              </div>
            ))}
          </div>

          {/* weeks */}
          <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-2">Weekly funds</div>
            <div className="grid grid-cols-[110px_110px_repeat(4,80px)_repeat(4,90px)_100px_100px] gap-x-2 font-mono text-[8px] uppercase tracking-widest text-white/30 mb-1">
              <span>Play ends</span><span>Invoice billed</span>{TEAM_HEADERS.map((h) => <span key={h} className="text-center">teams</span>)}
              <span className="text-center">fund 1</span><span className="text-center">fund 2</span>
              <span className="text-center">fund 3</span><span className="text-center">fund 4</span>
              <span className="text-center">collected</span><span className="text-center">deposit</span>
            </div>
            {session.weeks.map((w, wi) => {
              const computed = w.teams.map((t, i) => {
                const rate = session.rates[i]?.players ?? null;
                return t !== null && rate ? t * rate : (w.funds[i] ?? null);
              });
              const total = computed.reduce((a, b) => a + (b ?? 0), 0) || null;
              return (
                <div key={w.row} className="grid grid-cols-[110px_110px_repeat(4,80px)_repeat(4,90px)_100px_100px] gap-x-2 items-center py-0.5 border-b border-white/[0.04]">
                  <span className="font-mono text-[10px] text-white/60">{new Date(w.date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  <span className="font-mono text-[10px] text-white/45">{w.invoice ? new Date(w.invoice + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
                  {w.teams.map((t, ti) => (
                    <input key={ti} type="number" value={t ?? ''} onChange={(e) => update((s) => {
                      const v = e.target.value === '' ? null : Number(e.target.value);
                      s.weeks[wi].teams[ti] = v === null ? null : Number(v);
                    })} className="bg-black/40 border border-white/[0.08] rounded px-1 py-1 text-center text-[11px] text-white/80 font-mono" />
                  ))}
                  {computed.map((f, fi) => (
                    <span key={fi} className="text-center font-mono text-[11px] text-emerald-300/80">{f !== null ? '$' + f.toFixed(0) : '—'}</span>
                  ))}
                  <span className="text-center font-mono text-[11px] text-white/85">{total !== null ? '$' + total.toFixed(0) : '—'}</span>
                  <input type="number" value={w.deposit ?? ''} onChange={(e) => update((s) => {
                    s.weeks[wi].deposit = e.target.value === '' ? null : Number(e.target.value);
                  })} className="bg-black/40 border border-white/[0.08] rounded px-1 py-1 text-center text-[11px] text-white/80 font-mono" />
                </div>
              );
            })}
          </div>

          {/* workbook totals — the Balance Sheet etc., read-only */}
          {data.extras.length > 0 && (
            <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-2">Workbook totals (from the workbook's own formulas)</div>
              {data.extras.map((sheet) => (
                <div key={sheet.name} className="mb-3">
                  <div className="font-mono text-[10px] text-cyan-300/80 mb-1">{sheet.name}</div>
                  <div className="font-mono text-[11px] leading-relaxed text-white/65">
                    {sheet.rows.filter((r) => r.some((c) => c)).map((r, i) => (
                      <div key={i}>{r.filter((c) => c).join('   ')}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* entry fees collected (below the totals) */}
          {session.fees.length > 0 && (
            <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="flex justify-between items-center">
                <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70">Entry fees collected</div>
                <div className="font-mono text-[11px] text-emerald-300">
                  Grand total: {money(session.fees.reduce((s, f) => s + (f.value ?? 0), 0))}
                </div>
              </div>
              {session.fees.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-xs text-white/75">{f.label.replace(' Entry Fees Collected', '')}</span>
                  <input type="number" value={f.value ?? ''} onChange={(e2) => update((s) => {
                    const fee = s.fees[i];
                    fee.value = e2.target.value === '' ? null : Number(e2.target.value);
                  })} placeholder="0.00"
                    className="w-28 bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-white/80 font-mono text-right" />
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1 border-t border-white/[0.06]">
                <span className="flex-1 font-mono text-xs text-white/85">Grand Total Collected</span>
                <span className="font-mono text-emerald-300">{money(session.fees.reduce((s, f) => s + (f.value ?? 0), 0))}</span>
              </div>
            </div>
          )}

          {/* session totals */}
          {(() => {
            const totalCollected = session.weeks.reduce((s, w) => s + (w.total ?? 0), 0);
            const totalDeposit = session.weeks.reduce((s, w) => s + (w.deposit ?? 0), 0);
            const totalExpenses = session.expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
            return (
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg p-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-white/35 mb-1">Collected</div>
                  <div className="font-mono text-base text-white">{money(totalCollected)}</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-white/35 mb-1">Deposited</div>
                  <div className="font-mono text-base text-white">{money(totalDeposit)}</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-white/35 mb-1">Expenses</div>
                  <div className="font-mono text-base text-white">{money(totalExpenses)}</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-white/35 mb-1">Players Fund balance</div>
                  <div className="font-mono text-base text-emerald-300">{money(totalDeposit - totalExpenses)}</div>
                </div>
              </div>
            );
          })()}

          {/* expenses */}
          <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
            <div className="flex justify-between items-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70">Players Fund expenses</div>
              <button onClick={() => update((s) => { s.expenses.push({ row: 0, date: new Date().toISOString().slice(0, 10), amount: null, description: '' }); })}
                className="px-2 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-emerald-300">+ Add expense</button>
            </div>
            {session.expenses.map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="date" value={e.date} onChange={(e2) => update((s) => { s.expenses[i].date = e2.target.value; })}
                  className="bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-white/80 font-mono" />
                <input type="number" value={e.amount ?? ''} onChange={(e2) => update((s) => { s.expenses[i].amount = e2.target.value === '' ? null : Number(e2.target.value); })}
                  placeholder="0.00" className="w-28 bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-white/80 font-mono text-right" />
                <input value={e.description} onChange={(e2) => update((s) => { s.expenses[i].description = e2.target.value; })}
                  placeholder="Description" className="flex-1 bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-[11px] text-white/80" />
                <button onClick={() => update((s) => { s.expenses.splice(i, 1); })}
                  className="px-2 py-1 rounded text-white/25 hover:text-red-300 text-xs">✕</button>
              </div>
            ))}
            {session.expenses.length > 0 && (
              <div className="flex justify-end font-mono text-[11px] text-white/70 pt-1">
                total expenses: {money(session.expenses.reduce((s, e) => s + (e.amount ?? 0), 0))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Read-only workbook sheets — Balance Sheet / Budget / Singles Boards */}
      {extra && (
        <div className="flex-1 min-h-0 overflow-hidden px-6 pb-4 flex flex-col">
          <div className="font-mono text-[10px] text-cyan-300/80 mb-2 shrink-0">
            {extra.name} — read-only (edit in the workbook)
          </div>
          <div className="flex-1 min-h-0 overflow-auto rounded-lg" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
            <table className="border-collapse font-mono text-[10px] whitespace-nowrap">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[#0d151c] px-2 py-1 text-white/30 border-r border-b border-white/[0.08]">#</th>
                  {extra.rows[0]?.map((_, ci) => (
                    <th key={ci} className="bg-[#0d151c] px-2 py-1 text-white/30 border-r border-b border-white/[0.08] text-left">
                      {String.fromCharCode(65 + ci)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {extra.rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-white/[0.03]">
                    <td className="sticky left-0 bg-[#0d151c] px-2 py-1 text-white/30 border-r border-b border-white/[0.06]">{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2 py-1 text-white/70 border-r border-b border-white/[0.05] max-w-[220px] truncate" title={cell}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}
