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

  const saveToVault = async () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      const raw = win.localStorage.getItem('bounty_hunter_state');
      if (!raw) {
        notify('Bounty Hunter', 'Nothing to save yet — the dashboard has no data.', 'warn');
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
              title="Save roster + bounty results into the Obsidian vault (synced)"
            >
              {saving ? '✓ Saved to vault' : '💾 Save to vault'}
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