import fs from 'node:fs';
import path from 'node:path';

/**
 * Long-term memory — port of Mark 58's `memory/memory_manager.py`, plus its
 * project workspaces (`actions/project_workspace.py`).
 *
 * WHY THERE ARE TWO VERY DIFFERENT NUMBERS (from the original):
 *   Storage and prompt budget are separate concerns. MEMORY_MAX_CHARS is a
 *   runaway guard, not a feature limit. PROMPT_CORE_CHARS is what actually
 *   rides in the system prompt every session.
 *
 * WHAT RIDES IN THE PROMPT (and why recall works at all):
 *   1. IDENTITY — always, in full. It is small, and it is wrong for the
 *      assistant to have to look up your name.
 *   2. RECENT — the most recently updated entries from every other
 *      category, up to the core budget.
 *   3. AN INDEX — the *keys* of everything else, values omitted.
 *
 *   Point 3 is what makes recall work. A model cannot decide to look
 *   something up if it does not know the thing exists: with only points 1
 *   and 2, "who is Ayse?" would get "I don't know" while ayse_sister sat on
 *   disk unread. The index costs a few hundred characters and turns recall
 *   from a gamble into a lookup.
 *
 * PROJECTS — memory isolated per project; global personal memory always
 * remains available. Only facts the user provided or approved are saved.
 */

export const CATEGORIES = ['identity', 'preferences', 'projects', 'relationships', 'wishes', 'notes'] as const;
export type Category = (typeof CATEGORIES)[number];

const IDENTITY_FIELDS = ['name', 'age', 'birthday', 'city', 'job', 'language', 'school', 'nationality'];

const MEMORY_MAX_CHARS = 200_000;   // runaway guard, not a feature limit
const PROMPT_CORE_CHARS = 900;      // what rides in the prompt every session
const PROMPT_INDEX_CHARS = 420;
const PROMPT_MAX_PER_CATEGORY = 6;  // so forty preferences still keep your sister in the prompt
const MAX_VALUE_LENGTH = 380;

type Entry = { value: string; updated: string; source?: string };
type Facts = Partial<Record<Category, Record<string, Entry>>>;

interface Store {
  global: Facts;
  activeProject: string;
  projects: Record<string, { folder?: string; context?: string; facts: Facts; created: string }>;
}

/** Fresh per-category objects — a shallow copy would make every project
 * share the same category dicts and leak facts across scopes. */
function emptyFacts(): Facts {
  const f: Record<string, Record<string, Entry>> = {};
  for (const c of CATEGORIES) f[c] = {};
  return f as Facts;
}

function dataDir(): string {
  // If an Obsidian vault is configured, the memory file lives INSIDE the
  // vault — LiveSync then shares the same memory (and conversation notes)
  // across every machine that runs Jarvis.
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
    const inner = (typeof raw.jarvis_settings === 'string'
      ? JSON.parse(raw.jarvis_settings)
      : raw.jarvis_settings ?? {}) as Record<string, unknown>;
    const vault = String(inner.obsidian_vault_path ?? '').trim();
    if (vault && fs.existsSync(vault)) return path.join(vault, 'Jarvis Memory');
  } catch { /* fall back */ }
  return process.env.JARVIS_DATA_DIR || process.cwd();
}

function settingsFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-server-settings.json');
}

function storeFile(): string {
  return path.join(dataDir(), 'jarvis-memory.json');
}

let store: Store | null = null;

function load(): Store {
  if (store) return store;
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as Partial<Store>;
    store = {
      global: { ...emptyFacts(), ...(raw.global ?? {}) } as Facts,
      activeProject: raw.activeProject ?? '',
      projects: raw.projects ?? {},
    };
  } catch {
    store = { global: emptyFacts(), activeProject: '', projects: {} };
  }
  return store;
}

function save(): void {
  const s = load();
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.error('[Memory] save failed:', e);
  }
}

function factsFor(project?: string): Facts {
  const s = load();
  if (project) {
    const p = s.projects[project];
    return p ? { ...emptyFacts(), ...p.facts } : emptyFacts();
  }
  return s.global;
}

function allEntries(facts: Facts): { cat: string; key: string; entry: Entry }[] {
  const out: { cat: string; key: string; entry: Entry }[] = [];
  for (const cat of CATEGORIES) {
    const items = facts[cat] ?? {};
    for (const [key, entry] of Object.entries(items)) {
      if (entry && typeof entry.value === 'string') out.push({ cat, key, entry });
    }
  }
  return out;
}

/** Runaway guard — trims the oldest entries if a bug writes in a loop. */
function trim(facts: Facts): string[] {
  const dropped: string[] = [];
  const size = () => JSON.stringify(facts).length;
  if (size() <= MEMORY_MAX_CHARS) return dropped;
  const entries = allEntries(facts).sort((a, b) => a.entry.updated.localeCompare(b.entry.updated));
  for (const { cat, key } of entries) {
    if (size() <= MEMORY_MAX_CHARS) break;
    delete facts[cat as Category]![key];
    dropped.push(`${cat}/${key}`);
  }
  return dropped;
}

/** Save a fact. Returns a spoken-style result. */
export function remember(args: {
  key: string; value: string; category?: string; project?: string; source?: string;
}): string {
  const key = args.key.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 60);
  const value = args.value.trim().slice(0, MAX_VALUE_LENGTH);
  if (!key || !value) return 'Remember needs both a short key and the fact itself.';
  const cat = (CATEGORIES.includes(args.category as Category) ? args.category : 'notes') as Category;

  const s = load();
  const facts = factsFor(args.project || s.activeProject || undefined);
  const now = new Date().toISOString();
  const existing = facts[cat]?.[key];
  facts[cat]![key] = { value, updated: now, source: args.source ?? 'conversation' };
  const dropped = trim(facts);

  if (args.project && s.projects[args.project]) {
    s.projects[args.project].facts = facts;
  } else if (!args.project && s.activeProject && s.projects[s.activeProject]) {
    // Default remember goes to the ACTIVE PROJECT (isolated), like Mark.
    s.projects[s.activeProject].facts = facts;
  } else {
    s.global = facts;
  }
  save();

  const where = args.project || s.activeProject ? `project "${args.project || s.activeProject}"` : 'personal memory';
  const verb = existing ? 'updated' : 'saved';
  let msg = `${verb} ${cat}/${key} in ${where}.`;
  if (dropped.length) msg += ` Memory guard dropped the oldest entries: ${dropped.slice(0, 3).join(', ')}.`;
  return msg;
}

export function forget(key: string, category?: string, project?: string): string {
  const s = load();
  const facts = factsFor(project || s.activeProject || undefined);
  const k = key.trim().toLowerCase().replace(/\s+/g, '_');
  let removed = 0;
  for (const cat of CATEGORIES) {
    if (category && cat !== category) continue;
    const items = facts[cat];
    if (items && k in items) { delete items[k]; removed++; }
  }
  if (!removed) return `I have nothing stored under "${key}".`;
  if (project && s.projects[project]) s.projects[project].facts = facts;
  else if (!project && s.activeProject && s.projects[s.activeProject]) s.projects[s.activeProject].facts = facts;
  else s.global = facts;
  save();
  return `Forgot ${removed} entr${removed === 1 ? 'y' : 'ies'} under "${k}".`;
}

/** Recency is the cheapest useful relevance signal available without embeddings. */
export function searchMemory(query: string, project?: string, limit = 8): { cat: string; key: string; value: string; updated: string }[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return [];
  const s = load();
  const pools: { scope: string; facts: Facts }[] = [{ scope: 'global', facts: s.global }];
  if (s.activeProject && s.projects[s.activeProject]) {
    pools.push({ scope: s.activeProject, facts: s.projects[s.activeProject].facts });
  }
  if (project && s.projects[project]) pools.push({ scope: project, facts: s.projects[project].facts });

  const scored: { cat: string; key: string; value: string; updated: string; score: number }[] = [];
  for (const { facts } of pools) {
    for (const { cat, key, entry } of allEntries(facts)) {
      const hay = `${cat} ${key} ${entry.value}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += key.includes(t) || cat === t ? 2 : 1;
      if (score) scored.push({ cat, key, value: entry.value, updated: entry.updated, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.updated.localeCompare(a.updated));
  return scored.slice(0, limit).map(({ cat, key, value, updated }) => ({ cat, key, value, updated }));
}

// ── the prompt block ─────────────────────────────────────────────────────────

function coreBlock(name: string, facts: Facts): string {
  const entries = allEntries(facts);
  if (!entries.length) return '';
  const lines: string[] = [];
  let chars = 0;

  // 1. Identity — always, in full.
  const identity = facts.identity ?? {};
  for (const field of IDENTITY_FIELDS) {
    const val = identity[field]?.value;
    if (!val) continue;
    if (field === 'language') {
      lines.push(`Has spoken to you in: ${val} (an observation about the past — always answer in the language of their CURRENT message)`);
    } else {
      lines.push(`${field.charAt(0).toUpperCase() + field.slice(1)}: ${val}`);
    }
  }
  for (const [key, entry] of Object.entries(identity)) {
    if (IDENTITY_FIELDS.includes(key)) continue;
    lines.push(`${key.replace(/_/g, ' ')}: ${entry.value}`);
  }
  chars = lines.join('\n').length;

  // 2. Recent — newest entries from the other categories, within budget.
  const rest = entries
    .filter(({ cat }) => cat !== 'identity')
    .sort((a, b) => b.entry.updated.localeCompare(a.entry.updated));
  const perCat = new Map<string, number>();
  for (const { cat, key, entry } of rest) {
    const n = perCat.get(cat) ?? 0;
    if (n >= PROMPT_MAX_PER_CATEGORY) continue;
    const line = `${cat}: ${key.replace(/_/g, ' ')} — ${entry.value}`;
    if (chars + line.length > PROMPT_CORE_CHARS) break;
    lines.push(line);
    perCat.set(cat, n + 1);
    chars += line.length + 1;
  }

  // 3. An index — the keys of everything else, values omitted.
  const inCore = new Set(lines.map((l) => l.toLowerCase()));
  const indexParts: string[] = [];
  let indexChars = 0;
  for (const { cat, key, entry } of rest) {
    const line = `${cat}/${key}`;
    if (lines.some((l) => l.includes(`${key.replace(/_/g, ' ')} —`))) continue;
    if (indexChars + line.length > PROMPT_INDEX_CHARS) break;
    indexParts.push(line);
    indexChars += line.length + 1;
    void entry;
  }
  if (indexParts.length) lines.push(`ALSO STORED (ask to recall): ${indexParts.join(', ')}`);

  return `\n\n## ${name}\n${lines.join('\n')}`;
}

/** The block appended to the system prompt each session. */
export function promptBlock(): string {
  const s = load();
  let block = coreBlock('WHAT YOU REMEMBER ABOUT THE USER', s.global);
  if (s.activeProject && s.projects[s.activeProject]) {
    const p = s.projects[s.activeProject];
    block += coreBlock(`ACTIVE PROJECT: ${s.activeProject}`, p.facts);
    if (p.context) block += `\nProject context: ${p.context.slice(0, 400)}`;
  }
  return block;
}

// ── projects ─────────────────────────────────────────────────────────────────

export function listProjects(): { active: string; projects: { name: string; context?: string; folder?: string; created: string; facts: number }[] } {
  const s = load();
  return {
    active: s.activeProject,
    projects: Object.entries(s.projects).map(([name, p]) => ({
      name, context: p.context, folder: p.folder, created: p.created,
      facts: allEntries(p.facts).length,
    })),
  };
}

export function createProject(name: string, folder?: string, context?: string): string {
  const clean = name.trim().slice(0, 60);
  if (!clean) return 'Give the project a name.';
  const s = load();
  if (s.projects[clean]) return `Project "${clean}" already exists.`;
  s.projects[clean] = { folder, context, facts: emptyFacts(), created: new Date().toISOString() };
  s.activeProject = clean;
  save();
  return `Project "${clean}" created and active.`;
}

export function selectProject(name: string): string {
  const s = load();
  const clean = name.trim();
  if (!s.projects[clean]) {
    const known = Object.keys(s.projects).join(', ') || 'none yet';
    return `No project called "${clean}". Existing: ${known}.`;
  }
  s.activeProject = clean;
  save();
  return `Active project is now "${clean}". Its facts ride in your context; global memory stays available.`;
}

export function activeProject(): string {
  return load().activeProject;
}

export function deleteProject(name: string): string {
  const s = load();
  if (!s.projects[name]) return `No project called "${name}".`;
  delete s.projects[name];
  if (s.activeProject === name) s.activeProject = '';
  save();
  return `Project "${name}" deleted along with its facts.`;
}

/** Panel data: every fact, when it was learned, and where it lives. */
export function panelData(): {
  global: { cat: string; key: string; value: string; updated: string; source?: string }[];
  activeProject: string;
  projects: ReturnType<typeof listProjects>['projects'];
} {
  const s = load();
  return {
    global: allEntries(s.global)
      .map(({ cat, key, entry }) => ({ cat, key, value: entry.value, updated: entry.updated, source: entry.source }))
      .sort((a, b) => b.updated.localeCompare(a.updated)),
    activeProject: s.activeProject,
    projects: listProjects().projects,
  };
}

export function deleteEntry(cat: string, key: string): boolean {
  const s = load();
  const g = s.global[cat as Category];
  if (g && key in g) { delete g[key]; save(); return true; }
  return false;
}