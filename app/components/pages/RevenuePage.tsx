'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';
import { notify } from '../../lib/notify';

/**
 * League Revenue — three revenue trackers on one screen:
 *
 *   Membership — when players pay their membership fees
 *   Royalties  — 20% of the Basic Weekly fees (editable %)
 *   Investor   — 10% of the Basic Weekly fees minus the Royalty
 *
 * The weekly fees come from the Financial Tracker's sessions (the K column
 * = total collected per week). All data lives in the vault — synced.
 */

interface Week { row: number; date: string; teams: (number | null)[]; total: number | null; deposit: number | null }
interface Session { name: string; weeks: Week[] }
interface MembershipPayment { id: string; player: string; date: string; amount: number; season: string }

type Tab = 'membership' | 'royalties' | 'investor';

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function RevenuePage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [tab, setTab] = useState<Tab>('royalties');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [membership, setMembership] = useState<MembershipPayment[]>([]);
  const [royaltyPct, setRoyaltyPct] = useState(20);
  const [investorPct, setInvestorPct] = useState(10);
  const [newPlayer, setNewPlayer] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    const [rev, trk] = await Promise.all([
      fetch('/api/revenue').then((r) => r.json()) as Promise<{ membership?: MembershipPayment[]; royaltyPct?: number; investorPct?: number }>,
      fetch('/api/tracker').then((r) => r.json()) as Promise<{ sessions?: Session[] }>,
    ]);
    setMembership(rev.membership ?? []);
    setRoyaltyPct(rev.royaltyPct ?? 20);
    setInvestorPct(rev.investorPct ?? 10);
    setSessions(trk.sessions ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const allWeeks = sessions.flatMap((s) => s.weeks.map((w) => ({ ...w, session: s.name })));
  const weeksWithFees = allWeeks.filter((w) => w.total !== null && w.total > 0);

  const totalFees = weeksWithFees.reduce((s, w) => s + (w.total ?? 0), 0);
  const totalRoyalties = totalFees * (royaltyPct / 100);
  const totalInvestor = totalFees * (investorPct / 100);

  const saveMembership = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/revenue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()) as { ok?: boolean; error?: string };
    if (res.error) { notify('Revenue', res.error, 'error'); return; }
    void load();
  };

  return (
    <motion.div
      key="revenue-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="League Revenue"
        onNavigateHome={onNavigateHome}
        accent="cyan"
        right={
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">
            Royalties {royaltyPct}% · Investor {investorPct}%
          </span>
        }
      />

      <div className="px-6 pt-3 flex gap-2 shrink-0">
        {(['membership', 'royalties', 'investor'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest border transition-all ${
              tab === t ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-cyan-300'
            }`}>{t === 'membership' ? 'Membership' : t === 'royalties' ? 'Royalties' : 'Investor'}</button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        {tab === 'membership' && (
          <>
            <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70 mb-1">Add membership payment</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)} placeholder="Player name"
                  className="flex-1 min-w-[140px] bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-white/80" />
                <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                  className="bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-white/80 font-mono" />
                <input type="number" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="0.00"
                  className="w-24 bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-white/80 font-mono text-right" />
                <button onClick={() => {
                  if (!newPlayer.trim() || !newAmount) { notify('Revenue', 'Player and amount are required.', 'warn'); return; }
                  void saveMembership({ op: 'add_membership', player: newPlayer.trim(), amount: Number(newAmount), date: newDate });
                  setNewPlayer(''); setNewAmount('');
                }} className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20">+ Add</button>
              </div>
            </div>
            <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70 mb-2">Membership payments ({membership.length})</div>
              {membership.length === 0 && <p className="text-xs text-white/35">No membership payments logged yet.</p>}
              {membership.map((m) => (
                <div key={m.id} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] text-sm">
                  <span className="font-mono text-[10px] text-white/35 w-24 shrink-0">{m.date}</span>
                  <span className="flex-1 min-w-0 truncate text-white/80">{m.player}</span>
                  <span className="font-mono text-cyan-300">{money(m.amount)}</span>
                  <button onClick={() => void saveMembership({ op: 'remove_membership', id: m.id })}
                    className="px-1 text-white/25 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'royalties' && (
          <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-2">
              Royalties — {royaltyPct}% of the Basic Weekly fees
            </div>
            {weeksWithFees.map((w, i) => {
              const royalty = (w.total ?? 0) * (royaltyPct / 100);
              return (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] text-sm">
                  <span className="font-mono text-[10px] text-white/40 w-24 shrink-0">{w.date.slice(0, 10)}</span>
                  <span className="text-white/30 text-[10px] font-mono">{w.session}</span>
                  <span className="flex-1 text-right font-mono text-white/80">{money(w.total)}</span>
                  <span className="font-mono text-emerald-300 w-24 text-right">{money(royalty)}</span>
                </div>
              );
            })}
            <div className="flex justify-between pt-2 border-t border-white/[0.08] font-mono text-sm">
              <span className="text-white/60">Total royalties</span>
              <span className="text-emerald-300">{money(weeksWithFees.reduce((s, w) => s + (w.total ?? 0) * (royaltyPct / 100), 0))}</span>
            </div>
          </div>
        )}

        {tab === 'investor' && (
          <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-2">
              Investor — {investorPct}% of the Basic Weekly fees minus Royalties
            </div>
            {weeksWithFees.map((w, i) => {
              const total = w.total ?? 0;
              const royalty = total * (royaltyPct / 100);
              const investor = total * (investorPct / 100);
              return (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] text-sm">
                  <span className="font-mono text-[10px] text-white/40 w-24 shrink-0">{w.date.slice(0, 10)}</span>
                  <span className="text-white/30 text-[10px] font-mono">{w.session}</span>
                  <span className="flex-1 text-right font-mono text-white/80">{money(total)}</span>
                  <span className="font-mono text-cyan-300 w-24 text-right">{money(investor)}</span>
                  <span className="font-mono text-white/40 w-20 text-right">{money(royalty)}</span>
                </div>
              );
            })}
            <div className="flex justify-between pt-2 border-t border-white/[0.08] font-mono text-sm">
              <span className="text-white/60">Total investor</span>
              <span className="text-cyan-300">{money(weeksWithFees.reduce((s, w) => s + (w.total ?? 0) * (investorPct / 100), 0))}</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}