'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';
import { notify } from '../../lib/notify';

interface Week { row: number; date: string; teams: (number | null)[]; total: number | null; deposit: number | null }
interface Session { name: string; weeks: Week[]; rates?: { label: string; players: number | null; basic: number | null }[] }
interface MembershipPayment { id: string; player: string; date: string; amount: number; season: string }
interface InvestorPayment { id: string; date: string; amount: number; note: string }

type Tab = 'membership' | 'royalties' | 'investor';

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function RevenuePage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [tab, setTab] = useState<Tab>('royalties');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [membership, setMembership] = useState<MembershipPayment[]>([]);
  const [investorPayments, setInvestorPayments] = useState<InvestorPayment[]>([]);
  const [royaltyPct, setRoyaltyPct] = useState(20);
  const [investorPct, setInvestorPct] = useState(10);
  const [basicRate, setBasicRate] = useState(25);
  const [newPlayer, setNewPlayer] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [investorPayDate, setInvestorPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [investorPayAmount, setInvestorPayAmount] = useState('');
  const [investorPayNote, setInvestorPayNote] = useState('');

  const load = useCallback(async () => {
    const [rev, trk] = await Promise.all([
      fetch('/api/revenue').then((r) => r.json()) as Promise<{ membership?: MembershipPayment[]; investorPayments?: InvestorPayment[]; royaltyPct?: number; investorPct?: number }>,
      fetch('/api/tracker').then((r) => r.json()) as Promise<{ sessions?: Session[] }>,
    ]);
    setMembership(rev.membership ?? []);
    setInvestorPayments(rev.investorPayments ?? []);
    setRoyaltyPct(rev.royaltyPct ?? 20);
    setInvestorPct(rev.investorPct ?? 10);
    setSessions(trk.sessions ?? []);
    for (const s of trk.sessions ?? []) {
      const rate = s.rates?.find((r) => r.basic !== null);
      if (rate?.basic) { setBasicRate(rate.basic); break; }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const allWeeks = sessions.flatMap((s) => s.weeks.map((w) => ({ ...w, session: s.name })));
  const activeWeeks = allWeeks.filter((w) => w.teams.some((t) => t !== null));
  const basicWeekly = activeWeeks.map((w) => {
    const teams = w.teams.find((t) => t !== null) ?? 0;
    return { ...w, basicFees: teams * basicRate };
  });
  const totalBasic = basicWeekly.reduce((s, w) => s + w.basicFees, 0);
  const totalRoyalty = totalBasic * (royaltyPct / 100);
  const totalInvestorAccrued = (totalBasic - totalRoyalty) * (investorPct / 100);
  const totalPaidAllTime = investorPayments.reduce((s, p) => s + p.amount, 0);
  const accrued = totalInvestorAccrued - totalPaidAllTime;

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
        right={<span className="font-mono text-[9px] uppercase tracking-widest text-white/30">Basic {money(basicRate)}/team · Royalty {royaltyPct}% · Investor {investorPct}%</span>}
      />
      <div className="px-6 pt-3 flex gap-2 shrink-0">
        {(['royalties', 'investor', 'membership'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest border transition-all ${
              tab === t ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-cyan-300'
            }`}>{t === 'royalties' ? 'Royalties' : t === 'investor' ? 'Investor' : 'Membership'}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        {tab === 'royalties' && (
          <div className="rounded-lg p-4 space-y-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
            <div className="flex items-center justify-between">
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70">Royalties — {royaltyPct}% of Basic Weekly fees</div>
              <div className="font-mono text-sm text-emerald-300">{money(basicWeekly.reduce((s, w) => s + w.basicFees * (royaltyPct / 100), 0))} total</div>
            </div>
            {basicWeekly.map((w, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] text-sm">
                <span className="font-mono text-[10px] text-white/40 w-24 shrink-0">{w.date.slice(0, 10)}</span>
                <span className="text-white/30 text-[10px] font-mono">{w.session}</span>
                <span className="flex-1 text-right font-mono text-white/80">{money(w.basicFees)}</span>
                <span className="font-mono text-emerald-300 w-20 text-right">{money(w.basicFees * (royaltyPct / 100))}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-white/[0.08] font-mono text-sm">
              <span className="text-white/60">Total royalties</span>
              <span className="text-emerald-300">{money(basicWeekly.reduce((s, w) => s + w.basicFees * (royaltyPct / 100), 0))}</span>
            </div>
          </div>
        )}
        {tab === 'investor' && (
          <div className="rounded-lg p-4 space-y-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}>
            <div className="flex items-center justify-between">
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70">Investor — {investorPct}% of Basic Weekly fees minus Royalties</div>
              <div className="font-mono text-sm text-cyan-300">{money(accrued)} accrued</div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg p-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <div className="font-mono text-[9px] uppercase tracking-widest text-white/35 mb-1">Accrued</div>
                <div className="font-mono text-base text-white">{money(totalInvestorAccrued)}</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <div className="font-mono text-[9px] uppercase tracking-widest text-white/35 mb-1">Paid</div>
                <div className="font-mono text-base text-white">{money(totalPaidAllTime)}</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <div className="font-mono text-[9px] uppercase tracking-widest text-white/35 mb-1">Outstanding</div>
                <div className={`font-mono text-base ${accrued > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{money(accrued)}</div>
              </div>
            </div>
            <div className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70">Monthly investor payment</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" value={investorPayDate} onChange={(e) => setInvestorPayDate(e.target.value)}
                  className="bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-white/80 font-mono" />
                <input type="number" value={investorPayAmount} onChange={(e) => setInvestorPayAmount(e.target.value)} placeholder="0.00"
                  className="w-28 bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-white/80 font-mono text-right" />
                <input value={investorPayNote} onChange={(e) => setInvestorPayNote(e.target.value)} placeholder="Note (e.g. Nov 2026 payment)"
                  className="flex-1 min-w-[160px] bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-xs text-white/80" />
                <button onClick={() => {
                  const amt = Number(investorPayAmount);
                  if (!amt || amt <= 0) { notify('Revenue', 'Enter a payment amount.', 'warn'); return; }
                  void fetch('/api/revenue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'pay_investor', amount: amt, date: investorPayDate, note: investorPayNote.trim() }) });
                  setInvestorPayAmount(''); setInvestorPayNote('');
                  void load();
                }} className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20">+ Record payment</button>
                {accrued > 0 && (
                  <button onClick={() => setInvestorPayAmount(accrued.toFixed(2))}
                    className="px-2 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-cyan-300">Fill outstanding ({money(accrued)})</button>
                )}
              </div>
            </div>
            <div className="rounded-lg p-3" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70 mb-2">Payment history ({investorPayments.length})</div>
              {investorPayments.length === 0 && <p className="text-xs text-white/35">No investor payments recorded yet.</p>}
              {investorPayments.map((p) => (
                <div key={p.id ?? p.date + String(p.amount)} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] text-sm">
                  <span className="font-mono text-[10px] text-white/35 w-24 shrink-0">{p.date.slice(0, 10)}</span>
                  <span className="flex-1 min-w-0 truncate text-white/60 text-xs">{p.note || '—'}</span>
                  <span className="font-mono text-cyan-300">{money(p.amount)}</span>
                  <button onClick={() => {
                    void fetch('/api/revenue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'remove_investor_payment', id: p.id }) });
                    void load();
                  }} className="text-white/25 hover:text-red-400 text-xs" title="Remove">✕</button>
                </div>
              ))}
            </div>
            {basicWeekly.map((w, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] text-sm">
                <span className="font-mono text-[10px] text-white/40 w-24 shrink-0">{w.date.slice(0, 10)}</span>
                <span className="text-white/30 text-[10px] font-mono">{w.session}</span>
                <span className="flex-1 text-right font-mono text-white/80">{money(w.basicFees)}</span>
                <span className="font-mono text-cyan-300 w-20 text-right">{money(w.basicFees * (investorPct / 100))}</span>
                <span className="font-mono text-white/40 w-20 text-right">{money(w.basicFees * (royaltyPct / 100))} royalty</span>
              </div>
            ))}
          </div>
        )}
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
                  void fetch('/api/revenue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'add_membership', player: newPlayer.trim(), amount: Number(newAmount), date: newDate }) });
                  setNewPlayer(''); setNewAmount('');
                  void load();
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
                  <button onClick={() => {
                    void fetch('/api/revenue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'remove_membership', id: m.id }) });
                    void load();
                  }} className="text-white/25 hover:text-red-400 text-xs" title="Remove">✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}