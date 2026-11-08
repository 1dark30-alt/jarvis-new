'use client';

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';
import { notify } from '../../lib/notify';

/**
 * Bounty Hunter — local league dashboard (rosters, weekly bounties, standings
 * and poster exports). The dashboard is a self-contained static app served
 * from /apps/bounty-hunter/; its live data lives in the iframe's localStorage.
 *
 * 💾 Save to vault pulls that state out of the iframe (same origin) and writes
 * a dated markdown note into the Obsidian vault — which LiveSync carries to
 * the laptop and Olares, so the results are never trapped on one machine.
 */
export function BountyHunterPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [saving, setSaving] = useState(false);
  const STATE_FILE = 'BH/bounty-hunter-state.json';

  const vaultPost = (body: Record<string, unknown>) =>
    fetch('/api/obsidian', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json() as Promise<{ ok?: boolean; file?: string; content?: string; error?: string }>);

  /** PUSH: local dashboard state → vault (so the other machine can pull it). */
  const pushToVault = async () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return false;
    const raw = win.localStorage.getItem('bounty_hunter_state');
    if (!raw) { notify('Bounty Hunter', 'Nothing to save yet — the dashboard has no data.', 'warn'); return false; }
    const res = await vaultPost({ op: 'write', file: STATE_FILE, content: raw });
    if (!res.ok) { notify('Bounty Hunter', `State push failed: ${res.error ?? 'unknown'}`, 'error', 10000); return false; }
    return true;
  };

  /** PULL: vault state → dashboard (restores last week's data on this machine). */
  const pullFromVault = async (silent = false): Promise<boolean> => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return false;
    const res = await vaultPost({ op: 'read', file: STATE_FILE });
    if (res.error || !res.content) {
      if (!silent) notify('Bounty Hunter', 'No saved state in the vault yet.', 'warn');
      return false;
    }
    try {
      const stored = JSON.parse(res.content) as { savedAt?: string; state?: unknown };
      const savedAt = stored.savedAt ?? '';
      const localAt = win.localStorage.getItem('bounty_hunter_state_saved') ?? '';
      if (savedAt && savedAt <= localAt && !silent) {
        notify('Bounty Hunter', 'This machine already has the newest state.', 'info');
        return false;
      }
      const state = stored.state !== undefined ? stored.state : JSON.parse(res.content);
      win.localStorage.setItem('bounty_hunter_state', JSON.stringify(state));
      win.localStorage.setItem('bounty_hunter_state_saved', savedAt || new Date().toISOString());
      win.location.reload();
      if (!silent) notify('Bounty Hunter', 'Restored from vault — dashboard reloading.', 'success', 8000);
      return true;
    } catch (e) {
      if (!silent) notify('Bounty Hunter', `Vault state unreadable: ${String(e).slice(0, 100)}`, 'error');
      return false;
    }
  };

  const saveToVault = async () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      const raw = win.localStorage.getItem('bounty_hunter_state');
      if (!raw) {
        // Local empty — pull the other machine's state instead of failing.
        void pullFromVault();
        return;
      }
      const state = JSON.parse(raw) as {
        divisions?: Record<string, { id?: string; name?: string; team?: string }[]>;
        weeks?: {
          weekNumber: number;
          bounties?: { division?: string; target?: { name?: string } | string; status?: string; reward?: number | string }[];
        }[];
      };
      const lines: string[] = [`# Bounty Hunter — ${new Date().toLocaleDateString()}`, ''];

      // Roster ("the list")
      lines.push('## Roster');
      for (const [div, players] of Object.entries(state.divisions ?? {})) {
        lines.push(`### ${div} (${players.length} players)`);
        for (const p of players) {
          lines.push(`- ${p.name ?? 'Unknown'}${p.id ? ` (${p.id})` : ''}${p.team ? ` — ${p.team}` : ''}`);
        }
        lines.push('');
      }

      // Weekly bounty results
      lines.push('## Weeks');
      for (const week of state.weeks ?? []) {
        lines.push(`### Week ${week.weekNumber}`);
        const bounties = week.bounties ?? [];
        if (!bounties.length) lines.push('- No bounties rolled.');
        for (const b of bounties) {
          const target = typeof b.target === 'string' ? b.target : b.target?.name ?? 'Unknown';
          const bits = [`- **${target}**`];
          if (b.division) bits.push(`(${b.division})`);
          if (b.status) bits.push(`— ${b.status}`);
          if (b.reward !== undefined && b.reward !== null && b.reward !== '') bits.push(`· reward ${b.reward}`);
          lines.push(bits.join(' '));
        }
        lines.push('');
      }

      // Also push the live state itself, so the dashboard can be restored
      // on the other machine with everything intact.
      const now = new Date().toISOString();
      await vaultPost({ op: 'write', file: STATE_FILE, content: JSON.stringify({ savedAt: now, state: JSON.parse(raw) }) });
      win.localStorage.setItem('bounty_hunter_state_saved', now);

      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
      const title = `BH Results/${stamp}`;
      const post = (body: Record<string, unknown>) =>
        fetch('/api/obsidian', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.json() as Promise<{ ok?: boolean; file?: string; error?: string }>);

      let res = await post({ op: 'create', title, content: lines.join('\n') });
      if (res.error) res = await post({ op: 'append', file: `${title}.md`, text: lines.join('\n') });

      if (res.ok) {
        setSaving(true);
        notify('Bounty Hunter', `Saved to vault: ${res.file ?? title}`, 'success', 8000);
        setTimeout(() => setSaving(false), 4000);
      } else {
        notify('Bounty Hunter', `Vault save failed: ${res.error ?? 'unknown'}`, 'error', 10000);
      }
    } catch (e) {
      notify('Bounty Hunter', `Could not read the dashboard state: ${String(e).slice(0, 120)}`, 'error', 10000);
    }
  };

  return (
    <motion.div
      key="bounty-hunter-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Bounty Hunter"
        onNavigateHome={onNavigateHome}
        accent="orange"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void saveToVault()}
              className="px-2.5 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
              title="Push roster + bounty results into the vault (synced)"
            >
              {saving ? '✓ Saved to vault' : '💾 Push to vault'}
            </button>
            <button
              onClick={() => void pullFromVault()}
              className="px-2.5 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.12] text-white/60 hover:text-emerald-300 hover:border-emerald-500/40"
              title="Restore the newest state from the vault (e.g. saved on the other machine)"
            >
              ⤓ Pull
            </button>
            <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">
              Local · Vault copy synced
            </span>
          </div>
        }
      />

      <div className="flex-1 min-h-0 relative">
        <iframe
          ref={iframeRef}
          src="/apps/bounty-hunter/index.html"
          title="Bounty Hunter league dashboard"
          className="absolute inset-0 w-full h-full border-0 bg-black"
          allow="clipboard-write"
        />
      </div>
    </motion.div>
  );
}