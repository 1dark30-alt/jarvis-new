import fs from 'node:fs';
import path from 'node:path';
import { callGemini, geminiAvailable, FAST, SMART } from './geminiLadder';

/**
 * The mission brain — server-side text LLM access for background agents.
 * Reuses jarvis-new's existing model configuration: whichever provider the
 * assistant already runs on (OpenAI-compatible local router or Ollama) is
 * called through the same safety-checked /api/local-llm proxy, so missions
 * never need credentials of their own and never see them.
 */

const SELF_ORIGIN = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

interface BrainConfig {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

function readServerSettings(): Record<string, unknown> {
  // Same file the /api/settings route owns — credentials live per-user, never
  // in the app bundle.
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  try {
    const p = path.join(base, 'jarvis-server-settings.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getBrain(): Promise<BrainConfig | null> {
  const settings = readServerSettings();
  let s: Record<string, unknown> = {};
  try {
    s = JSON.parse(String(settings.jarvis_settings ?? '{}')) as Record<string, unknown>;
  } catch { /* defaults */ }

  const model = String(s.localLlmModel ?? '').trim();
  const apiMode = String(s.apiMode ?? '').trim();
  const provider = String(s.localLlmProvider ?? 'ollama').trim() || 'ollama';

  if (apiMode === 'local' && model) {
    return { provider, baseUrl: String(s.localLlmUrl ?? ''), apiKey: String(s.localLlmApiKey ?? ''), model };
  }
  if (model) {
    // A local model is configured even in openai mode — missions prefer it
    // over spending the realtime key, and fall back is handled by the caller.
    return { provider, baseUrl: String(s.localLlmUrl ?? ''), apiKey: String(s.localLlmApiKey ?? ''), model };
  }
  return null;
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

/** One chat completion. Returns text, or throws with a readable error.
 * The Gemini ladder answers first when it is configured; the local model is
 * the fallback (and the only brain when no Gemini key is set). */
export async function chat(
  messages: ChatMessage[],
  systemPrompt: string,
  opts: { timeoutMs?: number; maxTokens?: number; tier?: 'fast' | 'smart' } = {}
): Promise<string> {
  if (geminiAvailable()) {
    try {
      const prompt = messages.map((m) => (m.role === 'assistant' ? `Previous answer:\n${m.content}` : m.content)).join('\n\n');
      return (await callGemini({ contents: prompt, system: systemPrompt, timeoutMs: opts.timeoutMs }, opts.tier === 'smart' ? SMART : FAST)).text;
    } catch (e) {
      if (String(e).includes('NO_GEMINI_KEY')) throw e;
      console.warn('[Brain] Gemini ladder fell through, using the local model:', String(e).slice(0, 160));
    }
  }

  const brain = await getBrain();
  if (!brain) throw new Error('No model is configured for background agents. Set a local model in Settings.');

  const res = await fetch(`${SELF_ORIGIN}/api/local-llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: brain.provider,
      baseUrl: brain.baseUrl,
      apiKey: brain.apiKey,
      model: brain.model,
      systemPrompt,
      messages,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  const data = (await res.json()) as {
    reply?: string;
    content?: string;
    text?: string;
    response?: string;
    message?: { content?: string };
    choices?: { message?: { content?: string } }[];
    error?: string;
  };
  if (!res.ok || data.error) {
    throw new Error(String(data.error ?? `model call failed (HTTP ${res.status})`));
  }
  const text = data.reply ?? data.content ?? data.text ?? data.response
    ?? data.message?.content ?? data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('The model returned an empty answer.');
  return text;
}

/** Chat that must answer with a JSON object. One repair round is attempted. */
export async function chatJson<T>(
  messages: ChatMessage[],
  systemPrompt: string,
  opts: { timeoutMs?: number; tier?: 'fast' | 'smart' } = {}
): Promise<T> {
  const ask = async (extra?: string): Promise<string> => {
    const msgs: ChatMessage[] = [...messages];
    if (extra) msgs.push({ role: 'user', content: extra });
    return chat(msgs, systemPrompt + '\nAnswer with a single JSON object and nothing else.', opts);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask(attempt ? 'Your previous answer was not valid JSON. Return ONLY the JSON object.' : undefined);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch { /* retry */ }
    }
  }
  throw new Error('The model could not produce a valid JSON plan.');
}