'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Finance — bank data via Plaid: accounts and balances for every connected
 * bank (labelled business or personal), where the spending is going by
 * category, detected subscriptions, and the raw transaction list.
 *
 * Bank connections are made through Plaid's official Link widget, launched
 * from here. Connection tokens never leave this machine except to Plaid.
 */

interface Item { itemId: string; institution: string; label: 'business' | 'personal'; createdAt: string }
interface Account { itemId: string; institution: string; label: string; accountId: string; name: string; mask: string; type: string; subtype: string; balance: number | null }
interface Txn { date: string; name: string; amount: number; category: string; label: string; institution: string; pending: boolean }
interface Summary {
  ok?: boolean; days?: number;
  totalSpent?: number;
  spendingByCategory?: { category: string; total: number }[];
  split?: { business: number; personal: number };
  subscriptions?: { merchant: string; amount: number; occurrences: number; cadence: string; lastDate: string; nextEstimate: string | null }[];
  transactionCount?: number;
  failed?: string[];
  error?: string;
}

const money = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

declare global {
  interface Window {
    Plaid?: {
      create: (cfg: {
        token: string;
        onSuccess: (publicToken: string, metadata: { institution?: { name?: string } }) => void;
        onExit?: (err: unknown) => void;
        env?: string;
      }) => { open: () => void; destroy?: () => void };
    };
  }
}

type Tab = 'overview' | 'transactions' | 'connections';

export function FinancePage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [connectLabel, setConnectLabel] = useState<'business' | 'personal'>('personal');
  const [showSetupBanner, setShowSetupBanner] = useState(false);
  const linkHandlerRef = useRef<{ open: () => void } | null>(null);

  const loadConnections = useCallback(async () => {
    const d = await fetch('/api/plaid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'items' }),
    }).then((r) => r.json()) as { items?: Item[]; error?: string };
    if (d.error) { setError(d.error); return []; }
    setItems(d.items ?? []);
    return d.items ?? [];
  }, []);

  const loadAccounts = useCallback(async () => {
    const d = await fetch('/api/plaid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'accounts' }),
    }).then((r) => r.json()) as { accounts?: Account[]; error?: string };
    setAccounts(d.accounts ?? []);
  }, []);

  const loadData = useCallback(async (d2: number) => {
    setBusy('data');
    setError('');
    try {
      const [sum, tx] = await Promise.all([
        fetch('/api/plaid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'summary', days: d2 }) }).then((r) => r.json()) as Promise<Summary>,
        fetch('/api/plaid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'transactions', days: d2 }) }).then((r) => r.json()) as Promise<{ transactions?: Txn[]; error?: string }>,
      ]);
      setSummary(sum.error ? { error: sum.error } : sum);
      setTxns(tx.transactions ?? []);
      if (tx.error) setError(tx.error);
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshAll = useCallback(async (d2 = days) => {
    setBusy('connections');
    const its = await loadConnections();
    setBusy(null);
    if (its.length) { void loadAccounts(); void loadData(d2); }
  }, [days, loadConnections, loadAccounts, loadData]);

  useEffect(() => { void refreshAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (items.length) void loadData(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Plaid Link ──
  const connectBank = useCallback(async () => {
    setBusy('link');
    setError('');
    try {
      const d = await fetch('/api/plaid', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'link_token' }),
      }).then((r) => r.json()) as { linkToken?: string; error?: string };
      if (d.error || !d.linkToken) {
        setError(d.error ?? 'Could not create a Link token.');
        if ((d.error ?? '').includes('Plaid is not configured')) setShowSetupBanner(true);
        setBusy(null); return;
      }

      await new Promise<void>((resolve, reject) => {
        const existing = document.getElementById('plaid-link-script');
        const launch = () => {
          if (!window.Plaid) { reject(new Error('Plaid Link failed to load.')); return; }
          const handler = window.Plaid.create({
            token: d.linkToken!,
            env: undefined, // the link token itself encodes the environment
            onSuccess: (publicToken, metadata) => {
              void fetch('/api/plaid', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  op: 'exchange', publicToken,
                  institution: metadata.institution?.name ?? 'Bank',
                  label: connectLabel,
                }),
              }).then(() => refreshAll());
            },
            onExit: (err) => { if (err) setError('Link closed before finishing.'); },
          });
          linkHandlerRef.current = handler;
          handler.open();
        };
        if (existing) { launch(); resolve(); return; }
        const s = document.createElement('script');
        s.id = 'plaid-link-script';
        s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        s.onload = () => { launch(); resolve(); };
        s.onerror = () => reject(new Error('Could not load the Plaid Link script (check internet).'));
        document.head.appendChild(s);
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }, [connectLabel, refreshAll]);

  const setLabel = async (itemId: string, label: 'business' | 'personal') => {
    await fetch('/api/plaid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'set_label', itemId, label }) });
    void refreshAll();
  };

  const removeConnection = async (itemId: string) => {
    setBusy(itemId);
    await fetch('/api/plaid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'remove', itemId }) });
    setBusy(null);
    void refreshAll();
  };

  const split = summary?.split;
  const catMax = Math.max(1, ...(summary?.spendingByCategory ?? []).map((c) => c.total));

  return (
    <motion.div
      key="finance-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Finance"
        onNavigateHome={onNavigateHome}
        accent="green"
        right={
          <div className="flex items-center gap-2">
            {[30, 60, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-2 py-1 rounded font-mono text-[9px] uppercase tracking-widest border transition-all ${
                  days === d ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-emerald-300'
                }`}>{d}d</button>
            ))}
            <button onClick={() => void refreshAll()} disabled={busy !== null}
              className="px-2 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-emerald-300 disabled:opacity-40">↳ Sync</button>
          </div>
        }
      />

      {/* tabs */}
      <div className="px-6 pt-3 flex gap-2 shrink-0">
        {(['overview', 'transactions', 'connections'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest border transition-all ${
              tab === t ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-emerald-300'
            }`}>{t}</button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">Connect as</span>
          {(['personal', 'business'] as const).map((l) => (
            <button key={l} onClick={() => setConnectLabel(l)}
              className={`px-2 py-1 rounded font-mono text-[9px] uppercase tracking-widest border transition-all ${
                connectLabel === l ? (l === 'business' ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300') : 'bg-white/[0.04] border-white/[0.08] text-white/40'
              }`}>{l}</button>
          ))}
          <button onClick={() => void connectBank()} disabled={busy !== null}
            className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40">
            {busy === 'link' ? 'Opening…' : '+ Connect bank'}
          </button>
        </div>
      </div>

      {error && <p className="px-6 pt-2 text-[11px] text-red-300 font-mono">{error}</p>}
      {showSetupBanner && (
        <div className="mx-6 mt-2 rounded-lg p-4 flex items-center justify-between gap-4" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)' }}>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-amber-300 mb-1">Plaid credentials missing</div>
            <p className="text-xs text-white/60">
              Get your <span className="font-mono">client_id</span> and <span className="font-mono">secret</span> from dashboard.plaid.com → Team Settings → API keys,
              then paste them into Settings → the Plaid section.
            </p>
          </div>
          <button
            onClick={() => { setShowSetupBanner(false); window.dispatchEvent(new CustomEvent('jarvis:open-settings')); }}
            className="px-3 py-2 rounded font-mono text-[10px] uppercase tracking-widest bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 shrink-0"
          >
            Open Settings
          </button>
        </div>
      )}
      {busy === 'data' && <p className="px-6 pt-2 text-[11px] text-cyan-400/70 font-mono animate-pulse">Pulling bank data…</p>}

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        {items.length === 0 ? (
          <div className="max-w-lg mx-auto text-center pt-16">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-400/70 mb-4">No banks connected</div>
            <p className="text-sm text-white/55 leading-relaxed mb-6">
              Pick <span className="text-emerald-300">personal</span> or <span className="text-cyan-300">business</span> above,
              then connect that bank through Plaid Link. Repeat for the second bank. Spending, subscriptions and the
              business/personal split build themselves from there.
            </p>
          </div>
        ) : tab === 'overview' && summary && !summary.error ? (
          <>
            {/* split + total */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <div className="font-mono text-[9px] uppercase tracking-widest text-white/35 mb-1">Spent · last {summary.days}d</div>
                <div className="text-xl font-mono text-white">{money(summary.totalSpent ?? 0)}</div>
              </div>
              <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <div className="font-mono text-[9px] uppercase tracking-widest text-cyan-400/60 mb-1">Business</div>
                <div className="text-xl font-mono text-cyan-300">{money(split?.business ?? 0)}</div>
              </div>
              <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <div className="font-mono text-[9px] uppercase tracking-widest text-emerald-400/60 mb-1">Personal</div>
                <div className="text-xl font-mono text-emerald-300">{money(split?.personal ?? 0)}</div>
              </div>
            </div>

            {/* categories */}
            <div className="rounded-lg p-4 space-y-2.5" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70">Where the spending is going</div>
              {(summary.spendingByCategory ?? []).slice(0, 12).map((c) => (
                <div key={c.category}>
                  <div className="flex justify-between font-mono text-[11px] mb-1">
                    <span className="text-white/70">{c.category}</span>
                    <span className="text-white/45">{money(c.total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-400/60" style={{ width: `${(c.total / catMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* subscriptions */}
            <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-1">
                Subscriptions detected ({(summary.subscriptions ?? []).length})
              </div>
              {(summary.subscriptions ?? []).length === 0 && <p className="text-xs text-white/35">No recurring charges detected in this window.</p>}
              {(summary.subscriptions ?? []).map((s) => (
                <div key={s.merchant} className="flex items-center gap-3 text-sm border-b border-white/[0.04] pb-2">
                  <span className="flex-1 min-w-0 truncate text-white/80">{s.merchant}</span>
                  <span className="font-mono text-[10px] text-white/30">{s.cadence} · {s.occurrences}× · last {s.lastDate}{s.nextEstimate ? ` · next ~${s.nextEstimate}` : ''}</span>
                  <span className="font-mono text-cyan-300">{money(s.amount)}</span>
                </div>
              ))}
            </div>
          </>
        ) : tab === 'transactions' ? (
          <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
            {txns.length === 0 && <p className="text-xs text-white/35">No transactions in this window.</p>}
            {txns.map((t, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] text-[12px]">
                <span className="font-mono text-white/40 w-20 shrink-0">{t.date}</span>
                <span className="flex-1 min-w-0 truncate text-white/80">{t.name}{t.pending && <span className="text-white/25"> (pending)</span>}</span>
                <span className={`font-mono text-[9px] uppercase w-24 text-right shrink-0 ${t.label === 'business' ? 'text-cyan-400/70' : 'text-emerald-400/70'}`}>{t.label}</span>
                <span className="font-mono text-white/60 w-24 text-right shrink-0">{money(t.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg p-4" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-2">Accounts</div>
              {accounts.length === 0 && <p className="text-xs text-white/35">No accounts yet.</p>}
              {accounts.map((acc) => (
                <div key={acc.accountId} className="flex items-center gap-3 py-1.5 text-sm border-b border-white/[0.04]">
                  <span className={`font-mono text-[9px] uppercase w-20 ${acc.label === 'business' ? 'text-cyan-400/80' : 'text-emerald-400/80'}`}>{acc.label}</span>
                  <span className="flex-1 min-w-0 truncate text-white/75">{acc.name} {acc.mask && <span className="text-white/30">••{acc.mask}</span>}</span>
                  <span className="text-white/30 text-[10px] font-mono">{acc.institution}</span>
                  {acc.balance !== null && <span className="font-mono text-white/85">{money(acc.balance)}</span>}
                </div>
              ))}
            </div>
            <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(52,211,153,0.12)' }}>
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-1">Connections</div>
              {items.map((it) => (
                <div key={it.itemId} className="flex items-center gap-3 text-sm py-1.5 border-b border-white/[0.04]">
                  <span className="flex-1 truncate text-white/80">{it.institution}</span>
                  <button
                    onClick={() => void setLabel(it.itemId, it.label === 'business' ? 'personal' : 'business')}
                    className={`px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-widest border ${
                      it.label === 'business' ? 'border-cyan-500/40 text-cyan-300' : 'border-emerald-500/40 text-emerald-300'
                    }`}
                    title="Toggle business / personal"
                  >
                    {it.label}
                  </button>
                  <button
                    onClick={() => void removeConnection(it.itemId)}
                    className="px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-widest text-white/30 hover:text-red-300"
                    disabled={busy === it.itemId}
                  >Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}