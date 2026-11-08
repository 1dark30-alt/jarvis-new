import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Routine engine — things the assistant does on its own when a moment comes.
 * Server-side port of Mark 58's `core/routines/engine.py` + `rules.py`.
 *
 * A poll every so often asks each enabled routine one question — is it due,
 * and can it be delivered now — and hands the due ones to the client.
 *
 * TRIGGERS
 *   time     a rule (see below). Due when its next moment has passed.
 *   startup  once per server run, the first time a client reports ready.
 *   idle     when the user has been quiet for N minutes, at most every M.
 *
 * TIME RULES
 *   at 'YYYY-MM-DD HH:MM'          one-off
 *   time 'HH:MM' + days [1..7]     days: 1=Mon … 7=Sun; missing = every day
 *   monthlyDay 1-31 + time         that day of the month
 *   everyMinutes N + between       every N minutes, optionally inside 'HH:MM-HH:MM'
 *
 * DELIVERY, AND WHAT HAPPENS WHEN IT CANNOT HAPPEN NOW
 *   A routine that speaks needs a connected, quiet assistant. When it is due
 *   and that is not true, it waits — but only while it still makes sense:
 *   a fixed reminder is still worth hearing two hours late, a spoken
 *   instruction forty-five minutes late. Past that it is skipped and moved
 *   on to its next time. That is also how a routine that fell due while the
 *   computer was off is handled when the machine comes back.
 *
 * QUIET HOURS
 *   One window, off by default. Routines marked `quiet` — the unprompted ones,
 *   like idle check-ins — are held back inside it. A routine the user set for
 *   an exact time is not: 06:30 inside a 23:00-07:00 window was chosen on
 *   purpose.
 *
 * The engine knows nothing about the client. It talks through the poll:
 *   poll({ready, speaking, idleSeconds}) -> deliveries to speak now
 *   delivered(id) / deliveryFailed(id)   -> what happened to a claimed one
 */

const MAX_ROUTINES = 100;

export type TimeRule = {
  at?: string;            // one-off 'YYYY-MM-DD HH:MM' (or ISO)
  time?: string;          // 'HH:MM'
  days?: number[];        // 1=Mon … 7=Sun
  monthlyDay?: number;    // 1-31
  everyMinutes?: number;
  between?: string;       // 'HH:MM-HH:MM'
};

export type Trigger =
  | { type: 'time'; rule: TimeRule }
  | { type: 'startup' }
  | { type: 'idle'; minutes: number; cooldown: number };

export type RoutineKind = 'say' | 'prompt';

export interface Routine {
  id: string;
  name: string;
  kind: RoutineKind;
  text: string;
  trigger?: Trigger;
  deliver: 'voice' | 'panel' | 'silent';
  quiet: boolean;         // held back during quiet hours
  enabled: boolean;
  createdAt: number;
  lastFiredTs?: number;
  nextTs?: number;
  lastOutcome?: string;
  builtin?: string;
}

export interface Delivery {
  id: string;
  name: string;
  kind: RoutineKind;
  text: string;
  deliver: Routine['deliver'];
}

interface Store {
  quietHours: string;     // '' = off, else 'HH:MM-HH:MM'
  routines: Routine[];
  claimed: Record<string, number>; // id -> claimed timestamp
  startupFiredRun?: string;
}

const STALENESS_MS: Record<RoutineKind, number> = {
  say: 2 * 60 * 60 * 1000,       // a reminder is still worth hearing 2 h late
  prompt: 45 * 60 * 1000,        // a spoken instruction, 45 min late
};

// ── persistence ──────────────────────────────────────────────────────────────

function storeFile(): string {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Jarvis')
    : path.join(os.homedir(), 'AppData', 'Local', 'Jarvis');
  return path.join(base, 'routines.json');
}

let store: Store | null = null;
const RUN_ID = `${process.pid}-${Date.now()}`;

function load(): Store {
  if (store) return store;
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as Partial<Store>;
    store = {
      quietHours: raw.quietHours ?? '',
      routines: Array.isArray(raw.routines) ? raw.routines : [],
      claimed: raw.claimed ?? {},
      startupFiredRun: raw.startupFiredRun,
    };
  } catch {
    store = { quietHours: '', routines: [], claimed: {} };
  }
  // Claims from a previous run are stale by definition.
  store.claimed = {};
  return store;
}

function save() {
  const s = load();
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.error('[Routines] save failed:', e);
  }
}

// ── time rules ───────────────────────────────────────────────────────────────

function parseHM(hm: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/** Next fire timestamp (ms) for a time rule, strictly after `afterMs`. */
export function nextForRule(rule: TimeRule, afterMs: number): number | null {
  const now = new Date(afterMs);

  if (rule.at) {
    // One-off. Accepts 'YYYY-MM-DD HH:MM' and ISO strings.
    const t = Date.parse(rule.at.includes('T') ? rule.at : rule.at.replace(' ', 'T'));
    return Number.isNaN(t) ? null : t;
  }

  if (rule.everyMinutes) {
    const every = Math.max(1, rule.everyMinutes) * 60_000;
    // Optional active window 'HH:MM-HH:MM' — outside it, next fire is window start.
    if (rule.between) {
      const [a, b] = rule.between.split('-').map((s) => parseHM(s.trim()));
      if (a && b) {
        const startMin = a.h * 60 + a.m;
        const endMin = b.h * 60 + b.m;
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const inWindow = startMin <= endMin
          ? nowMin >= startMin && nowMin < endMin
          : nowMin >= startMin || nowMin < endMin;
        if (inWindow) return afterMs + every;
        // next window start (possibly tomorrow)
        const next = new Date(afterMs);
        next.setHours(a.h, a.m, 0, 0);
        if (next.getTime() <= afterMs) next.setDate(next.getDate() + 1);
        return next.getTime();
      }
    }
    return afterMs + every;
  }

  const hm = parseHM(rule.time ?? '');
  if (!hm) return null;

  const atDayTime = (base: Date): number => {
    const d = new Date(base);
    d.setHours(hm.h, hm.m, 0, 0);
    return d.getTime();
  };

  if (rule.monthlyDay) {
    const day = Math.min(31, Math.max(1, rule.monthlyDay));
    for (let add = 0; add < 60; add++) {
      const d = new Date(afterMs);
      d.setDate(d.getDate() + add);
      if (d.getDate() !== day) continue;
      const t = atDayTime(d);
      if (t > afterMs) return t;
    }
    return null;
  }

  if (rule.days && rule.days.length) {
    const days = new Set(rule.days.map((n) => ((n - 1) % 7))); // 1=Mon → JS 0=Mon? JS: 0=Sun
    // Convert: our 1=Mon..7=Sun → JS getDay(): Mon=1..Sat=6, Sun=0.
    const jsDays = new Set(rule.days.map((n) => (n % 7))); // 1→1(Mon) … 6→6(Sat), 7→0(Sun)
    void days;
    for (let add = 0; add < 8; add++) {
      const d = new Date(afterMs);
      d.setDate(d.getDate() + add);
      if (!jsDays.has(d.getDay())) continue;
      const t = atDayTime(d);
      if (t > afterMs) return t;
    }
    return null;
  }

  const t = atDayTime(now);
  return t > afterMs ? t : atDayTime(new Date(afterMs + 86_400_000));
}

// ── quiet hours ──────────────────────────────────────────────────────────────

export function inQuietHours(s: Store, nowMs: number): boolean {
  if (!s.quietHours) return false;
  const [a, b] = s.quietHours.split('-').map((x) => parseHM(x.trim()));
  if (!a || !b) return false;
  const d = new Date(nowMs);
  const cur = d.getHours() * 60 + d.getMinutes();
  const start = a.h * 60 + a.m;
  const end = b.h * 60 + b.m;
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

// ── engine operations ────────────────────────────────────────────────────────

let seq = 0;
function newId(): string {
  seq++;
  return `r${Date.now().toString(36)}${seq.toString(36)}`;
}

function mk(name: string, kind: RoutineKind, text: string, trigger: Trigger, opts?: Partial<Routine>): Routine {
  const now = Date.now();
  return {
    id: newId(),
    name: name || text.slice(0, 60) || 'routine',
    kind,
    text,
    trigger,
    deliver: opts?.deliver ?? 'voice',
    quiet: opts?.quiet ?? false,
    enabled: opts?.enabled ?? true,
    createdAt: now,
    builtin: opts?.builtin,
    ...(trigger.type === 'time' ? { nextTs: nextForRule(trigger.rule, now) ?? undefined } : {}),
  };
}

export function list(): Routine[] {
  return load().routines;
}

export function add(args: {
  name?: string; kind?: string; text?: string;
  trigger?: Trigger; deliver?: string; quiet?: boolean;
}): { ok: true; routine: Routine } | { ok: false; error: string } {
  const kind = (args.kind ?? '').toLowerCase();
  if (kind !== 'say' && kind !== 'prompt') {
    return { ok: false, error: "kind must be 'say' (speak a fixed reminder) or 'prompt' (carry out an instruction when the time comes). Background tasks ('task') arrive with the Missions phase." };
  }
  if (!args.trigger) return { ok: false, error: "say when: at, time (+ days), monthly_day, every_minutes, or on = startup | idle" };
  if (!args.text?.trim()) return { ok: false, error: 'text is required (the words to say, or the instruction to carry out)' };

  const s = load();
  if (s.routines.length >= MAX_ROUTINES) return { ok: false, error: 'routine store is full (100)' };
  const r = mk(
    args.name ?? '', kind as RoutineKind, args.text.trim(), args.trigger,
    { deliver: (args.deliver as Routine['deliver']) ?? 'voice', quiet: args.quiet ?? false }
  );
  s.routines.push(r);
  save();
  return { ok: true, routine: r };
}

export function update(id: string, fields: Partial<Routine> & { trigger?: Trigger }): Routine | null {
  const s = load();
  const r = s.routines.find((x) => x.id === id || x.builtin === id);
  if (!r) return null;
  if (fields.trigger) {
    r.trigger = fields.trigger;
    if (fields.trigger.type === 'time') {
      r.nextTs = nextForRule(fields.trigger.rule, Date.now()) ?? undefined;
    } else {
      delete r.nextTs;
    }
  }
  if (fields.name !== undefined) r.name = fields.name;
  if (fields.text !== undefined) r.text = fields.text;
  if (fields.deliver !== undefined) r.deliver = fields.deliver;
  if (fields.quiet !== undefined) r.quiet = fields.quiet;
  if (fields.enabled !== undefined) {
    r.enabled = fields.enabled;
    if (fields.enabled) {
      // Re-arming: next from now, never in the past.
      if (r.trigger?.type === 'time') r.nextTs = nextForRule(r.trigger.rule, Date.now()) ?? undefined;
    }
  }
  save();
  return r;
}

export function remove(id: string): boolean {
  const s = load();
  const before = s.routines.length;
  s.routines = s.routines.filter((x) => x.id !== id && x.builtin !== id);
  save();
  return s.routines.length < before;
}

export function quietHours(): string {
  return load().quietHours;
}

export function setQuietHours(v: string): string {
  const s = load();
  const value = v.trim();
  if (value) {
    const [a, b] = value.split('-').map((x) => parseHM(x.trim()));
    if (!a || !b) return '';
  }
  s.quietHours = value;
  save();
  return s.quietHours;
}

/** Run a routine immediately, bypassing its schedule (still respects nothing else). */
export function runNow(id: string): Delivery | null {
  const s = load();
  const r = s.routines.find((x) => x.id === id || x.builtin === id);
  if (!r || !r.enabled) return null;
  r.lastFiredTs = Date.now();
  if (r.trigger?.type === 'time') r.nextTs = nextForRule(r.trigger.rule, Date.now()) ?? undefined;
  save();
  return { id: r.id, name: r.name, kind: r.kind, text: r.text, deliver: r.deliver };
}

function reschedule(r: Routine, nowMs: number) {
  r.lastFiredTs = nowMs;
  if (r.trigger?.type === 'time') {
    const next = nextForRule(r.trigger.rule, nowMs) ?? nextForRule(r.trigger.rule, nowMs + 60_000);
    r.nextTs = next ?? undefined;
  }
}

/**
 * The tick. `state` describes the client that is polling. Returns the
 * deliveries that can be spoken right now (they are claimed until the
 * client reports delivered/failed or the claim times out).
 */
export function poll(state: { ready: boolean; speaking: boolean; idleSeconds: number }): {
  deliveries: Delivery[];
  quietHours: string;
} {
  const s = load();
  const now = Date.now();
  const deliveries: Delivery[] = [];
  const quiet = inQuietHours(s, now);

  // Expire stale claims — the client claimed but never reported back.
  for (const [id, ts] of Object.entries(s.claimed)) {
    if (now - ts > 90_000) delete s.claimed[id];
  }

  for (const r of s.routines) {
    if (!r.enabled) continue;
    if (r.id in s.claimed) continue;

    const trig = r.trigger;

    // Is it due?
    let due = false;
    if (trig?.type === 'time') {
      due = r.nextTs !== undefined && r.nextTs <= now;
    } else if (trig?.type === 'startup') {
      due = s.startupFiredRun !== RUN_ID && state.ready;
    } else if (trig?.type === 'idle') {
      const cooldown = Math.max(1, trig.cooldown || 20) * 60_000;
      due = state.idleSeconds >= trig.minutes && (!r.lastFiredTs || now - r.lastFiredTs >= cooldown);
    }
    if (!due) continue;

    // Quiet hours hold back only the unprompted ones.
    if (quiet && r.quiet) {
      r.lastOutcome = 'held: quiet hours';
      continue;
    }

    // Can it be delivered now? If not, wait — but only while it still makes sense.
    const needsVoice = r.deliver !== 'silent';
    if (needsVoice && (!state.ready || state.speaking)) {
      const fired = r.nextTs ?? r.lastFiredTs ?? now;
      if (now - fired > STALENESS_MS[r.kind]) {
        r.lastOutcome = 'skipped: no one was listening in time';
        reschedule(r, now);
      }
      continue;
    }

    // Claim and reschedule.
    reschedule(r, now);
    if (trig?.type === 'startup') s.startupFiredRun = RUN_ID;
    s.claimed[r.id] = now;
    r.lastOutcome = 'delivering';
    deliveries.push({ id: r.id, name: r.name, kind: r.kind, text: r.text, deliver: r.deliver });
  }

  save();
  return { deliveries, quietHours: s.quietHours };
}

export function delivered(id: string, ok: boolean): void {
  const s = load();
  delete s.claimed[id];
  const r = s.routines.find((x) => x.id === id);
  if (r) r.lastOutcome = ok ? 'delivered' : 'delivery failed';
  save();
}

/** Built-in routine blueprints (Mark's briefing / checkin / news_watch). */
export const BUILTINS: Record<string, Omit<Routine, 'id' | 'createdAt'>> = {
  briefing: {
    name: 'Morning briefing', kind: 'prompt',
    text: 'Give me the morning briefing — weather, today\'s schedule, headlines and markets.',
    trigger: { type: 'time', rule: { time: '07:30' } },
    deliver: 'voice', quiet: false, enabled: false, builtin: 'briefing',
  },
  checkin: {
    name: 'Unprompted check-in', kind: 'prompt',
    text: 'Check in briefly — anything I should know or follow up on?',
    trigger: { type: 'idle', minutes: 90, cooldown: 240 },
    deliver: 'voice', quiet: true, enabled: false, builtin: 'checkin',
  },
  news_watch: {
    name: 'News watch', kind: 'prompt',
    text: 'Check the watched news topics and report anything new worth knowing.',
    trigger: { type: 'time', rule: { everyMinutes: 120 } },
    deliver: 'voice', quiet: true, enabled: false, builtin: 'news_watch',
  },
};

export function ensureBuiltin(key: string): Routine | null {
  const s = load();
  const existing = s.routines.find((x) => x.builtin === key);
  if (existing) return existing;
  const bp = BUILTINS[key];
  if (!bp) return null;
  const r: Routine = { ...bp, id: newId(), createdAt: Date.now() };
  if (r.trigger?.type === 'time') {
    r.nextTs = nextForRule(r.trigger.rule, Date.now()) ?? undefined;
  }
  s.routines.push(r);
  save();
  return r;
}