'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Memory Panel — every fact Jarvis has stored about the user, when it was
 * learned, and where it lives. Any entry can be deleted with one click.
 * Port of Mark 58's memory panel + the project workspace view.
 */

interface Entry { cat: string; key: string; value: string; updated: string; source?: string }
interface ProjectInfo { name: string; context?: string; folder?: string; created: string; facts: number }

const CAT_LABELS: Record<string, string> = {
  identity: 'Identity',
  preferences: 'Preferences',
  projects: 'Projects',
  relationships: 'Relationships',
  wishes: 'Wishes',
  notes: 'Notes',
};

export function MemoryPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeProject, setActiveProject] = useState('');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [newProject, setNewProject] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetch('/api/memory').then((r) => r.json()) as {
        global?: Entry[]; activeProject?: string; projects?: ProjectInfo[];
      };
      setEntries(data.global ?? []);
      setActiveProject(data.activeProject ?? '');
      setProjects(data.projects ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    window.dispatchEvent(new Event('jarvis:memory-updated'));
    void load();
  };

  const remove = async (cat: string, key: string) => {
    await post({ op: 'entry_delete', category: cat, key });
  };

  const byCat = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!byCat.has(e.cat)) byCat.set(e.cat, []);
    byCat.get(e.cat)!.push(e);
  }

  return (
    <motion.div
      key="memory-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Memory"
        onNavigateHome={onNavigateHome}
        accent="green"
        right={
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">
            {entries.length} facts · nothing silently forgotten
          </span>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        {/* Projects */}
        <div className="mb-6">
          <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/70 mb-2">Projects</div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {projects.map((p) => (
              <button
                key={p.name}
                onClick={() => void post({ op: 'project_select', name: p.name })}
                className={`px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest border transition-all ${
                  activeProject === p.name
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/45 hover:text-emerald-300 hover:border-emerald-500/30'
                }`}
                title={p.context || `${p.facts} facts`}
              >
                {p.name} · {p.facts}
              </button>
            ))}
            {projects.length === 0 && <span className="text-xs text-white/35">No projects yet.</span>}
          </div>
          <div className="flex gap-2">
            <input
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              placeholder="New project name…"
              className="px-3 py-1.5 rounded bg-white/[0.04] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-emerald-500/40 w-56"
            />
            <button
              onClick={() => { if (newProject.trim()) { void post({ op: 'project_create', name: newProject.trim() }); setNewProject(''); } }}
              className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-white/[0.04] border border-white/[0.08] text-white/45 hover:text-emerald-300 hover:border-emerald-500/30 transition-all"
            >
              Create + select
            </button>
          </div>
          {activeProject && (
            <p className="mt-2 font-mono text-[10px] text-white/35">
              Active: {activeProject} — its facts ride in the session context; global memory stays available.
            </p>
          )}
        </div>

        {/* Facts by category */}
        {[...byCat.entries()].map(([cat, items]) => (
          <div key={cat} className="mb-5">
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-emerald-400/70 mb-2">
              {CAT_LABELS[cat] ?? cat} · {items.length}
            </div>
            <div className="space-y-1.5">
              {items.map((e) => (
                <div key={e.key} className="flex items-start gap-3 rounded-md px-3 py-2"
                  style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[10px] text-cyan-300/80">{e.key.replace(/_/g, ' ')}</div>
                    <div className="text-sm text-white/80">{e.value}</div>
                    <div className="font-mono text-[9px] text-white/25 mt-0.5">
                      learned {new Date(e.updated).toLocaleString()}{e.source ? ` · ${e.source}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => void remove(e.cat, e.key)}
                    title="Forget this"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-white/[0.04] border border-white/[0.08] text-white/30 hover:text-red-300 hover:border-red-500/30 transition-all text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {entries.length === 0 && (
          <p className="text-sm text-white/40">
            Nothing stored yet. Tell Jarvis something about yourself — it saves facts you share and
            carries them into every future session.
          </p>
        )}
      </div>
    </motion.div>
  );
}