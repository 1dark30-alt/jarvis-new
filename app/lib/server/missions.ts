import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chat, chatJson } from './missionBrain';
import { searchDuckDuckGoHtml } from '../ddg-html-search';

/**
 * Missions — long work handed to a background agent while the conversation
 * goes on. Port of Mark 58's `core/missions.py` + `core/tasks/` (research
 * pipeline), rebuilt on jarvis-new's own model proxy and DuckDuckGo search.
 *
 * Research runs through stages the engine enforces, and the model does the
 * thinking inside each one:
 *
 *   PLAN         the question becomes sub-questions and searches, sized to the budget
 *   INVESTIGATE  one sub-question at a time: search, read pages, record findings
 *                with a source and an exact quote
 *   REVIEW       what is thin or single-sourced becomes new sub-questions (≤ 2 cycles)
 *   WRITE        the report is written from the recorded findings — nothing else
 *
 * WHAT IS CHECKED IN CODE, NOT ASKED FOR
 *   Quotes. Every page read is kept. A finding's quote is looked up in the
 *   text of the page it names; one that is not there is marked unverified and
 *   the report is told so. A model cannot invent a supporting sentence and
 *   have it pass.
 *
 *   Citations. Sources are numbered by the runner. A citation to a number
 *   that does not exist is removed, and the source list is appended by the
 *   runner — the model never writes it, so it cannot list a source it did
 *   not use.
 *
 * A crash costs one step, never the mission: step results are persisted as
 * they finish and the loop resumes from where it stopped.
 *
 * Missions never touch the user's computer — no shell, no files outside the
 * mission workspace. Desktop work with an approval gate arrives later.
 */

const MIN_SOURCES_PER_SUB = 2;
const MAX_REVIEW_CYCLES = 2;
const PAGE_CHARS = 40_000;
const MAX_PAGES_PER_SEARCH = 3;

// ── types ────────────────────────────────────────────────────────────────────

export interface Finding {
  text: string;
  quote: string;
  source: number;      // source number (runner-assigned)
  verified: boolean;   // quote was found in the page's text
}

export interface MissionSource {
  n: number;
  url: string;
  title: string;
  text: string;        // kept so quote checks are real, not remembered
}

export interface MissionStep {
  id: string;
  title: string;
  task: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result: string;
}

export type MissionStatus =
  | 'planning' | 'investigating' | 'writing' | 'running'
  | 'done' | 'failed' | 'cancelled';

export interface Mission {
  id: string;
  title: string;
  kind: 'research' | 'general';
  task: string;
  agent: string;
  budgetMinutes: number;
  status: MissionStatus;
  steps: MissionStep[];
  findings: Finding[];
  sources: MissionSource[];
  report?: string;
  minutesUsed?: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface MissionNotice {
  id: string;          // mission id
  kind: 'done' | 'failed';
  title: string;
  summary: string;
}

// ── persistence ──────────────────────────────────────────────────────────────

function storeFile(): string {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Jarvis')
    : path.join(process.env.HOME ?? process.env.USERPROFILE ?? os.tmpdir(), 'Jarvis');
  return path.join(base, 'missions.json');
}

interface Store {
  missions: Mission[];
  notices: MissionNotice[];   // pending announcements, consumed by the client
}

let store: Store | null = null;

function load(): Store {
  if (store) return store;
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as Partial<Store>;
    store = { missions: raw.missions ?? [], notices: raw.notices ?? [] };
  } catch {
    store = { missions: [], notices: [] };
  }
  return store;
}

function save(): void {
  const s = load();
  // Page texts can be large — cap each source's stored text in the journal.
  const slim = {
    ...s,
    missions: s.missions.map((m) => ({
      ...m,
      sources: m.sources.map((src) => ({ ...src, text: src.text.slice(0, PAGE_CHARS) })),
    })),
  };
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(slim, null, 2), 'utf8');
  } catch (e) {
    console.error('[Missions] save failed:', e);
  }
}

// ── web helpers ──────────────────────────────────────────────────────────────

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPage(url: string): Promise<{ url: string; title: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JarvisMission/1.0' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html') && !type.includes('text')) return null;
    const raw = (await res.text()).slice(0, 400_000);
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
    const text = htmlToText(raw).slice(0, PAGE_CHARS);
    if (text.length < 200) return null;
    return { url, title: htmlToText(titleMatch?.[1] ?? url).slice(0, 120), text };
  } catch {
    return null;
  }
}

// ── engine ───────────────────────────────────────────────────────────────────

const RUNNING = new Set<string>();

let seq = 0;
function newId(): string {
  seq++;
  return `m${Date.now().toString(36)}${seq.toString(36)}`;
}

export function list(): Mission[] {
  return load().missions;
}

export function get(id: string): Mission | null {
  return load().missions.find((m) => m.id === id) ?? null;
}

export function propose(args: {
  title?: string; task?: string; agent?: string; minutes?: number;
}): { ok: true; mission: Mission } | { ok: false; error: string } {
  const task = (args.task ?? '').trim();
  if (task.length < 8) return { ok: false, error: 'Describe the work in a sentence or more.' };
  const agent = (args.agent ?? 'researcher').toLowerCase();
  const kind: Mission['kind'] = agent === 'researcher' ? 'research' : 'general';
  const minutes = Math.max(2, Math.min(60, Number(args.minutes ?? (kind === 'research' ? 8 : 6))));

  const s = load();
  if (s.missions.filter((m) => !['done', 'failed', 'cancelled'].includes(m.status)).length >= 3) {
    return { ok: false, error: 'There are already three missions in flight. Wait for one to finish or cancel one.' };
  }

  const mission: Mission = {
    id: newId(),
    title: (args.title ?? task).slice(0, 120),
    kind,
    task,
    agent,
    budgetMinutes: minutes,
    status: 'planning',
    steps: [],
    findings: [],
    sources: [],
    createdAt: Date.now(),
  };
  s.missions.unshift(mission);
  if (s.missions.length > 40) s.missions.length = 40;
  save();
  void start(mission.id);
  return { ok: true, mission };
}

export function cancel(id: string): boolean {
  const m = get(id);
  if (!m || ['done', 'failed', 'cancelled'].includes(m.status)) return false;
  m.status = 'cancelled';
  m.finishedAt = Date.now();
  save();
  RUNNING.delete(id);
  return true;
}

/** Pending notifications; consumed only when the assistant can speak. */
export function peekNotices(): MissionNotice[] {
  return load().notices;
}

export function clearNotices(): MissionNotice[] {
  const s = load();
  const out = s.notices;
  s.notices = [];
  if (out.length) save();
  return out;
}

function notice(m: Mission): void {
  const s = load();
  const summary = m.report
    ? m.report.replace(/\s+/g, ' ').slice(0, 400)
    : (m.error ?? 'finished');
  s.notices.push({
    id: m.id,
    kind: m.status === 'done' ? 'done' : 'failed',
    title: m.title,
    summary,
  });
  if (s.notices.length > 10) s.notices.splice(0, s.notices.length - 10);
  save();
}

/** Restart any mission that was mid-flight when the server last stopped. */
export function resumeAll(): void {
  for (const m of load().missions) {
    if (['planning', 'investigating', 'writing', 'running'].includes(m.status) && !RUNNING.has(m.id)) {
      m.status = 'running';
      save();
      void start(m.id);
    }
  }
}

export function start(id: string): void {
  if (RUNNING.has(id)) return;
  RUNNING.add(id);
  void runMission(id).catch((e) => {
    console.error('[Missions] runner crashed:', e);
    const m = get(id);
    if (m && !['done', 'cancelled'].includes(m.status)) {
      m.status = 'failed';
      m.error = String(e).slice(0, 400);
      m.finishedAt = Date.now();
      save();
      notice(m);
    }
  }).finally(() => RUNNING.delete(id));
}

function deadlineOf(m: Mission): number {
  return (m.startedAt ?? Date.now()) + m.budgetMinutes * 60_000;
}

function outOfTime(m: Mission): boolean {
  return Date.now() > deadlineOf(m) - 30_000; // keep 30 s to write
}

// ── research pipeline ────────────────────────────────────────────────────────

async function runResearch(m: Mission): Promise<void> {
  m.startedAt = m.startedAt ?? Date.now();
  m.status = 'planning';
  save();

  const budgetNote = `Time budget: ${m.budgetMinutes} minutes total; spend it deliberately.`;

  // ── PLAN ──
  let subQs: { q: string; searches: string[] }[] = [];
  if (!m.steps.length) {
    const plan = await chatJson<{ sub_questions?: { q?: string; searches?: string[] }[] }>(
      [{ role: 'user', content: `Research task: ${m.task}\n\nBreak this into sub-questions (max 5). For each, give 1-2 concrete web searches that would find authoritative pages.` }],
      `You are a research planner. ${budgetNote} Reply with JSON: {"sub_questions":[{"q":"...","searches":["..."]}]}`,
      { timeoutMs: 60_000 }
    );
    subQs = (plan.sub_questions ?? [])
      .map((sq) => ({ q: String(sq.q ?? '').slice(0, 300), searches: (sq.searches ?? []).map(String).slice(0, 2) }))
      .filter((sq) => sq.q && sq.searches.length)
      .slice(0, 5);
    if (!subQs.length) throw new Error('The planner returned no sub-questions.');
    m.steps = subQs.map((sq, i) => ({
      id: `sq${i + 1}`,
      title: sq.q.slice(0, 80),
      task: sq.q,
      status: 'pending',
      result: '',
    }));
    save();
  } else {
    subQs = m.steps.map((s) => ({ q: s.task, searches: [] }));
  }

  // ── INVESTIGATE ──
  m.status = 'investigating';
  save();
  let sourceN = 0;

  const investigate = async (sq: MissionStep, searches: string[]): Promise<void> => {
    if (sq.status === 'done') return; // a crash costs one step, never the mission
    if (outOfTime(m)) { sq.status = 'skipped'; sq.result = 'skipped: out of time'; save(); return; }
    sq.status = 'running';
    save();

    let read = 0;
    const deadline = deadlineOf(m);
    const queries = searches.length ? searches : [sq.task];
    const usedQuotes: string[] = [];

    for (const query of queries) {
      if (Date.now() > deadline - 60_000) break;
      let results: { title?: string; url?: string }[] = [];
      try {
        results = await searchDuckDuckGoHtml(query, 6) as { title?: string; url?: string }[];
      } catch { continue; }
      for (const r of results.slice(0, MAX_PAGES_PER_SEARCH)) {
        if (Date.now() > deadline - 60_000) break;
        if (!r.url || m.sources.some((s) => s.url === r.url)) continue;
        const page = await fetchPage(r.url);
        if (!page) continue;
        sourceN++;
        const src: MissionSource = { n: sourceN, url: page.url, title: page.title, text: page.text };
        m.sources.push(src);
        read++;

        // Findings from THIS page only, with exact quotes from its text.
        try {
          const out = await chatJson<{ findings?: { text?: string; quote?: string }[] }>(
            [{ role: 'user', content: `Sub-question: ${sq.task}\n\nPAGE "${page.title}" (${page.url}):\n${page.text.slice(0, 12_000)}\n\nExtract 1-4 findings this page supports. Each finding: {"text": one sentence, "quote": an EXACT verbatim sentence copied from the page (15-40 words). If the page supports nothing relevant, return {"findings":[]}. Do not use knowledge that is not on this page.` }],
            'You extract findings with exact verbatim quotes. JSON only.',
            { timeoutMs: 90_000 }
          );
          for (const f of (out.findings ?? []).slice(0, 4)) {
            const quote = String(f.quote ?? '').trim();
            const text = String(f.text ?? '').trim();
            if (!text) continue;
            // CHECKED IN CODE: the quote must exist in the page text.
            const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/["'“”‘’]/g, '');
            const verified = quote.length > 10 && norm(page.text).includes(norm(quote));
            if (verified) usedQuotes.push(quote);
            m.findings.push({ text, quote, source: src.n, verified });
          }
        } catch { /* model hiccup on one page — the mission continues */ }
        save();
      }
    }

    // Depth check: a sub-question declared done after too few pages, with
    // time left, is sent back once to read more.
    if (read < MIN_SOURCES_PER_SUB && Date.now() < deadline - 120_000 && queries.length === 1) {
      sq.status = 'pending';
      save();
      await investigate(sq, [`${sq.task} explained`, sq.task]);
      return;
    }

    sq.status = 'done';
    sq.result = `${read} page(s) read`;
    save();
  };

  for (const step of m.steps) {
    if (outOfTime(m)) { step.status = 'skipped'; step.result = 'skipped: out of time'; continue; }
    const sq = subQs.find((q) => q.q === step.task);
    await investigate(step, sq?.searches ?? []);
  }

  // ── REVIEW (≤ 2 cycles) ──
  m.status = 'running';
  for (let cycle = 0; cycle < MAX_REVIEW_CYCLES; cycle++) {
    if (outOfTime(m)) break;
    const verifiedCount = m.findings.filter((f) => f.verified).length;
    if (verifiedCount >= 6) break;
    const review = await chatJson<{ follow_ups?: { q?: string; searches?: string[] }[] }>(
      [{
        role: 'user',
        content: `Research task: ${m.task}\nSub-questions covered: ${m.steps.map((s) => s.task).join(' | ')}\nVerified findings so far: ${m.findings.filter((f) => f.verified).map((f) => `- ${f.text} [${f.source}]`).join('\n') || 'none'}\n\nWhat is thin, single-sourced or contradictory? Return up to 2 follow-up sub-questions with searches, or {"follow_ups":[]} if coverage is adequate.`,
      }],
      'You review research coverage. JSON only: {"follow_ups":[{"q":"...","searches":["..."]}]}',
      { timeoutMs: 60_000 }
    );
    const extras = (review.follow_ups ?? []).slice(0, 2)
      .map((sq) => ({ q: String(sq.q ?? ''), searches: (sq.searches ?? []).map(String).slice(0, 2) }))
      .filter((sq) => sq.q && sq.searches.length);
    if (!extras.length) break;
    for (const ex of extras) {
      const step: MissionStep = { id: `rev${cycle}${m.steps.length}`, title: ex.q.slice(0, 80), task: ex.q, status: 'pending', result: '' };
      m.steps.push(step);
      if (outOfTime(m)) { step.status = 'skipped'; continue; }
      await investigate(step, ex.searches);
    }
  }

  // ── WRITE ──
  m.status = 'writing';
  save();
  const verified = m.findings.filter((f) => f.verified);
  const unverified = m.findings.filter((f) => !f.verified);
  if (!verified.length && !unverified.length) throw new Error('Nothing could be read for this task — all pages failed.');

  const findingsBlock = [
    ...verified.map((f) => `- ${f.text} [${f.source}] (verified quote: "${f.quote.slice(0, 160)}")`),
    ...unverified.map((f) => `- ${f.text} [${f.source}] (UNVERIFIED — the quote could not be found in the page; state this finding only with that caveat, or omit it)`),
  ].join('\n');

  const report = await chat(
    [{ role: 'user', content: `Research task: ${m.task}\n\nFINDINGS (with source numbers):\n${findingsBlock.slice(0, 30_000)}\n\nWrite the report in the language of the task. Rules: use ONLY these findings; cite every claim with [n]; do not add a source list (the runner appends it); 250-600 words; note where evidence was thin.` }],
    'You write cited research reports strictly from supplied findings.',
    { timeoutMs: 180_000 }
  );

  // Citations are the runner's business: drop references to numbers that
  // do not exist, then append the source list the model never wrote.
  const known = new Set(m.sources.map((s) => s.n));
  const cleaned = report.replace(/\[(\d+)\]/g, (match, n) => (known.has(Number(n)) ? match : ''));
  m.report = cleaned.trim() + '\n\nSOURCES:\n' + m.sources
    .filter((s) => cleaned.includes(`[${s.n}]`))
    .map((s) => `[${s.n}] ${s.title} — ${s.url}`)
    .join('\n');
  m.minutesUsed = (Date.now() - (m.startedAt ?? Date.now())) / 60_000;
  m.status = 'done';
  m.finishedAt = Date.now();
  save();
  notice(m);
}

// ── general agent loop ───────────────────────────────────────────────────────

interface AgentAction {
  action: 'search' | 'fetch' | 'answer';
  query?: string;
  url?: string;
  answer?: string;
}

async function runGeneral(m: Mission): Promise<void> {
  m.startedAt = m.startedAt ?? Date.now();
  m.status = 'running';
  save();

  const deadline = deadlineOf(m);
  const transcript: string[] = [];
  let answer = '';

  for (let turn = 0; turn < 10; turn++) {
    if (Date.now() > deadline - 30_000) break;
    const act = await chatJson<AgentAction>(
      [{
        role: 'user',
        content: `Task: ${m.task}\nTime budget: ${m.budgetMinutes} min.\n\nTOOL RESULTS SO FAR:\n${transcript.join('\n\n').slice(0, 30_000) || '(none yet)'}\n\nDecide the next action: {"action":"search","query":"..."} to search the web, {"action":"fetch","url":"..."} to read a page, or {"action":"answer","answer":"the final result"} when you have enough.`,
      }],
      'You are a capable background agent with web access. Take concrete actions; do not speculate about pages you have not read.',
      { timeoutMs: 90_000 }
    );

    if (act.action === 'answer') {
      answer = String(act.answer ?? '').slice(0, 20_000);
      break;
    }
    if (act.action === 'search') {
      try {
        const results = await searchDuckDuckGoHtml(String(act.query ?? ''), 6) as { title?: string; url?: string }[];
        transcript.push(`SEARCH "${act.query}":\n` + results.map((r) => `- ${r.title ?? ''} ${r.url ?? ''}`).join('\n'));
      } catch {
        transcript.push(`SEARCH "${act.query}": failed`);
      }
    } else if (act.action === 'fetch') {
      const page = await fetchPage(String(act.url ?? ''));
      transcript.push(page ? `PAGE ${page.title} (${page.url}):\n${page.text.slice(0, 6_000)}` : `PAGE ${act.url}: could not be read`);
    }
    save();
  }

  if (!answer) {
    // Budget spent — write what was gathered instead of returning nothing.
    answer = await chat(
      [{ role: 'user', content: `Task: ${m.task}\n\nTOOL RESULTS:\n${transcript.join('\n\n').slice(0, 30_000)}\n\nThe time budget is spent. Write the best result you can from what was gathered.` }],
      'You deliver results from gathered material only.',
      { timeoutMs: 120_000 }
    );
  }

  m.report = answer.trim();
  m.minutesUsed = (Date.now() - (m.startedAt ?? Date.now())) / 60_000;
  m.status = 'done';
  m.finishedAt = Date.now();
  save();
  notice(m);
}

async function runMission(id: string): Promise<void> {
  const m = get(id);
  if (!m) return;
  if (m.kind === 'research') await runResearch(m);
  else await runGeneral(m);
}