import fs from 'node:fs';
import path from 'node:path';

/**
 * The Gemini ladder — TypeScript port of Mark 58's `core/gemini.py` text
 * core (REST rungs; the Live voice path lives in app/lib/geminiLive.ts).
 *
 * WHY A LADDER (from the original): on the free tier it is the TEXT pool
 * that runs out first. When one model's quota is spent the conversation
 * carries on: a rung that answered 429 is skipped for a while and the next
 * one answers. One model a day means one daily limit; a ladder means the
 * sum of them. Order is measured, not assumed — fast lite models at the
 * top, slower and flaky-but-real-quota models at the bottom.
 *
 * TIERS
 *   FAST    short decisions, tool arguments, quick answers
 *   SMART   reasoning, code, reports
 *   SEARCH  grounded search — REST only; it says so rather than silently
 *           returning an answer with no sources behind it
 *
 * PROVIDERS
 *   A rung named "prov:<model>" calls the user's own OpenAI-compatible
 *   endpoint instead of Google's. The provider is tried FIRST when
 *   gemini_provider_first is on, so a paid key can carry the load while the
 *   free Gemini rungs remain as the safety net.
 *
 *   With no Gemini key at all, everything falls through to the local-LLM
 *   brain (missionBrain) — connecting a local model stays a full option.
 */

export const FAST = 'fast';
export const SMART = 'smart';
export const SEARCH = 'search';

const REST_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 60_000;

const LADDERS: Record<string, string[]> = {
  [FAST]: [
    'gemini-3.5-flash-lite', 'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite', 'gemini-3.5-flash',
    'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-flash-latest',
    'gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-flash',
  ],
  [SMART]: [
    'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.6-flash',
    'gemini-flash-latest', 'gemini-3.7-flash',
    'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite',
    'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  ],
  [SEARCH]: [
    'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash',
    'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  ],
};

// Cooldowns: a rung that answered 429 stays out of quota for a while.
const COOLDOWN_SECONDS = 300;        // 429 — out of quota
const GONE_SECONDS = 6 * 60 * 60;    // 404 — model not available to this key
const UNAVAILABLE_SECONDS = 30 * 60; // 5xx — service trouble
const cooldown = new Map<string, number>();
const gone = new Set<string>();

export interface GeminiConfig {
  contents: string;             // the user-side prompt text
  system?: string;
  json?: boolean;               // ask for application/json output
  images?: { mimeType: string; data: string }[]; // base64, for screen/photo calls
  timeoutMs?: number;
}

export interface GeminiResult {
  text: string;
  model: string;                // the rung that answered
  grounding?: { title: string; uri: string }[]; // SEARCH tier only
}

// ── settings ─────────────────────────────────────────────────────────────────

interface ProviderCfg { url: string; key: string; first: boolean }

function settingsFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-server-settings.json');
}

function readJarvisSettings(): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
    return JSON.parse(String(raw.jarvis_settings ?? '{}')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function geminiKey(): string {
  const s = readJarvisSettings();
  const fromSettings = String(s.geminiApiKey ?? '').trim();
  if (fromSettings) return fromSettings;
  return (process.env.GEMINI_API_KEY ?? '').trim();
}

function providerCfg(): ProviderCfg | null {
  const s = readJarvisSettings();
  const url = String(s.geminiProviderUrl ?? '').trim();
  const key = String(s.geminiProviderKey ?? '').trim();
  if (!url) return null;
  return { url: url.replace(/\/$/, ''), key, first: Boolean(s.geminiProviderFirst) };
}

// ── cooldowns ────────────────────────────────────────────────────────────────

function cool(model: string, seconds: number): void {
  cooldown.set(model, Date.now() + seconds * 1000);
}

function cooling(model: string): boolean {
  const until = cooldown.get(model);
  if (!until) return false;
  if (Date.now() > until) { cooldown.delete(model); return false; }
  return true;
}

export function isQuotaError(err: string): boolean { return /429|quota|RESOURCE_EXHAUSTED/i.test(err); }
export function isGoneError(err: string): boolean { return /404|not found|no longer available/i.test(err); }
export function isUnavailableError(err: string): boolean { return /50[03]|unavailable|overloaded/i.test(err); }

function usableRungs(ladder: string[]): string[] {
  return ladder.filter((m) => !gone.has(m) && !cooling(m));
}

// ── the calls ────────────────────────────────────────────────────────────────

async function geminiRest(model: string, cfg: GeminiConfig, key: string, timeoutMs: number): Promise<GeminiResult> {
  const parts: Record<string, unknown>[] = [{ text: cfg.contents }];
  for (const img of cfg.images ?? []) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      ...(cfg.json ? { responseMimeType: 'application/json' } : {}),
      maxOutputTokens: 4096,
    },
    ...(cfg.system ? { systemInstruction: { parts: [{ text: cfg.system }] } } : {}),
  };

  const res = await fetch(`${REST_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundChunks?: { retrievedContent?: { title?: string; uri?: string } }[] }[] }[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string };
  };

  if (!res.ok || data.error) {
    throw new Error(String(data.error?.message ?? `HTTP ${res.status}`));
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new Error('empty answer');
  const grounding = cand?.groundingMetadata
    ?.map((g) => g.groundChunks ?? [])
    .flat()
    .map((c) => ({ title: c.retrievedContent?.title ?? '', uri: c.retrievedContent?.uri ?? '' }))
    .filter((c) => c.uri) ?? undefined;
  return { text, model, grounding };
}

/** One OpenAI-compatible provider rung ("prov:<model>"). */
async function providerCall(model: string, cfg: GeminiConfig, prov: ProviderCfg, timeoutMs: number): Promise<GeminiResult> {
  const messages: { role: string; content: unknown }[] = [];
  if (cfg.system) messages.push({ role: 'system', content: cfg.system });
  const content: unknown[] = [{ type: 'text', text: cfg.contents }];
  for (const img of cfg.images ?? []) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
  }
  messages.push({ role: 'user', content: content.length === 1 ? cfg.contents : content });

  const res = await fetch(`${prov.url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(prov.key ? { Authorization: `Bearer ${prov.key}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string } | string;
  };
  if (!res.ok || data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? `HTTP ${res.status}`);
  }
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('empty answer');
  return { text, model: `prov:${model}` };
}

// ── public API ───────────────────────────────────────────────────────────────

export function ladderFor(tier: string, key: string, prov: ProviderCfg | null): string[] {
  const base = LADDERS[tier] ?? LADDERS[FAST];
  const providerRungs = base.map((m) => `prov:${m}`);
  // Provider first: a paid key carries the load, Gemini rungs are the net.
  // Otherwise: Gemini first, provider as the fallback behind it.
  if (prov?.first) return [...providerRungs, ...base];
  return [...base, ...providerRungs];
}

/** The ladder call. Falls through rungs; throws only when everything is out. */
export async function callGemini(cfg: GeminiConfig, tier: string = FAST): Promise<GeminiResult> {
  const key = geminiKey();
  const prov = providerCfg();
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!key && !prov) {
    // No Gemini, no provider — the caller decides the local fallback.
    throw new Error('NO_GEMINI_KEY');
  }

  const errors: string[] = [];
  for (const rung of ladderFor(tier, key, prov)) {
    if (rung.startsWith('prov:')) {
      if (!prov) continue;
      const model = rung.slice(5);
      try {
        return await providerCall(model, cfg, prov, timeoutMs);
      } catch (e) {
        const err = String(e);
        errors.push(`${model}: ${err.slice(0, 120)}`);
        if (isQuotaError(err)) cool(rung, COOLDOWN_SECONDS);
        else if (isGoneError(err)) cool(rung, GONE_SECONDS);
        else cool(rung, UNAVAILABLE_SECONDS);
        continue;
      }
    }
    try {
      return await geminiRest(rung, cfg, key, timeoutMs);
    } catch (e) {
      const err = String(e);
      errors.push(`${rung}: ${err.slice(0, 120)}`);
      if (isQuotaError(err)) cool(rung, COOLDOWN_SECONDS);
      else if (isGoneError(err)) { gone.add(rung); }
      else if (isUnavailableError(err)) cool(rung, UNAVAILABLE_SECONDS);
      continue;
    }
  }
  throw new Error(`Every model on the ${tier} ladder failed: ${errors.join(' | ')}`);
}

/** Convenience: plain text answer. */
export async function geminiText(prompt: string, tier: string = FAST, system?: string, images?: GeminiConfig['images'], timeoutMs?: number): Promise<string> {
  return (await callGemini({ contents: prompt, system, images, timeoutMs }, tier)).text;
}

/** Convenience: JSON answer with one repair round. */
export async function geminiJson<T>(prompt: string, tier: string = FAST, system?: string, timeoutMs?: number): Promise<T> {
  const ask = (extra?: string) =>
    callGemini({ contents: extra ? `${prompt}\n\n${extra}` : prompt, system, json: true, timeoutMs }, tier);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask(attempt ? 'Your previous answer was not valid JSON. Return ONLY the JSON object.' : undefined);
    const cleaned = raw.text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { /* retry */ }
    }
  }
  throw new Error('The model could not produce a valid JSON answer.');
}

/** Is the Gemini side configured at all? (drives fallbacks elsewhere) */
export function geminiAvailable(): boolean {
  return Boolean(geminiKey() || providerCfg());
}