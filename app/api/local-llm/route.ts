import { NextRequest, NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
type Provider = 'ollama' | 'olares' | 'olares-shared';

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (isIP(normalized) === 4) {
    const parts = normalized.split('.').map(Number);
    const [a, b] = parts;
    return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254;
  }
  return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:') && isPrivateIp(normalized.slice(7));
}

async function getProviderUrl(provider: Provider, value: unknown): Promise<URL> {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_OLLAMA_URL;
  const url = new URL(raw);
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (provider === 'ollama') {
    if (url.protocol !== 'http:' || !localHosts.has(url.hostname.toLowerCase())) {
      throw new Error('For safety, Ollama must use http://localhost, 127.0.0.1, or [::1].');
    }
  } else if (provider === 'olares') {
    const localOlaresHost = url.protocol === 'http:' && url.hostname.toLowerCase().endsWith('.olares.local');
    if (url.protocol !== 'https:' && !localOlaresHost) {
      throw new Error('Olares Router must use the HTTPS Devices in LAN URL, or an HTTP .olares.local URL while on the same LAN.');
    }
    const addresses = isIP(url.hostname)
      ? [{ address: url.hostname }]
      : await lookup(url.hostname, { all: true }).catch(() => []);
    const officialRouterHost = /^router\.[a-z0-9.-]+\.olares\.com$/i.test(url.hostname);
    if ((localOlaresHost && (addresses.length === 0 || addresses.some(({ address }) => !isPrivateIp(address)))) ||
      (!localOlaresHost && !officialRouterHost && (addresses.length === 0 || addresses.some(({ address }) => !isPrivateIp(address))))) {
      throw new Error('For safety, Olares Router must resolve to a private LAN/VPN address or use an HTTPS Olares Router domain.');
    }
  } else if (provider === 'olares-shared') {
    if (url.protocol !== 'http:' || !/^[a-z0-9-]+\.shared\.olares\.com$/i.test(url.hostname)) {
      throw new Error('Olares shared endpoints must use the HTTP URL ending in .shared.olares.com copied from Olares Settings.');
    }
    const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
    if (addresses.length === 0) {
      throw new Error('Olares shared endpoint did not resolve from this PC. Connect through Olares/LarePass or verify the Shared entrance URL in Olares Settings.');
    }
  } else {
    throw new Error('Unsupported local model provider.');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function getProvider(value: unknown): Provider {
  return value === 'olares' || value === 'olares-shared' ? value : 'ollama';
}

function authHeaders(provider: Provider, apiKey: unknown): Record<string, string> {
  if (provider !== 'olares') return {};
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) throw new Error('Enter a Router API key in Jarvis Settings.');
  return { Authorization: `Bearer ${key}` };
}

function ollamaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes('For safety') || message.includes('Enter a Router API key') ? 400 : 502;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const provider = getProvider(req.nextUrl.searchParams.get('provider'));
    if (provider !== 'ollama') {
      return NextResponse.json({ error: 'Olares model discovery requires a Router API key. Use POST.' }, { status: 400 });
    }
    const base = await getProviderUrl(provider, req.nextUrl.searchParams.get('baseUrl'));
    const response = await fetch(new URL(`${base.href.replace(/\/$/, '')}/api/tags`), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      redirect: 'manual',
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Ollama returned HTTP ${response.status}.` }, { status: 502 });
    }
    const data = await response.json() as { models?: Array<{ name?: string; size?: number; remote_model?: string; remote_host?: string }> };
    const models = (data.models ?? [])
      .filter((model) => !model.remote_model && !model.remote_host && !model.name?.endsWith(':cloud'))
      .sort((a, b) => (a.size ?? Number.MAX_SAFE_INTEGER) - (b.size ?? Number.MAX_SAFE_INTEGER))
      .map((model) => model.name)
      .filter((name): name is string => !!name);
    return NextResponse.json({ models });
  } catch (error) {
    return ollamaError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action?: unknown;
      provider?: unknown;
      baseUrl?: unknown;
      apiKey?: unknown;
      model?: unknown;
      systemPrompt?: unknown;
      messages?: unknown;
    };
    const provider = getProvider(body.provider);
    const base = await getProviderUrl(provider, body.baseUrl);
    const headers = { 'Content-Type': 'application/json', ...authHeaders(provider, body.apiKey) };
    if (body.action === 'models') {
      const response = await fetch(new URL(`${base.href.replace(/\/$/, '')}/${provider === 'ollama' ? 'api/tags' : 'models'}`), {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        redirect: 'manual',
      });
      if (!response.ok) {
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          return NextResponse.json({ error: 'Olares redirected the API call to sign-in. On the same LAN, enable LarePass Host mappings or local DNS so this Router hostname resolves to the Olares LAN IP; also verify the Router API key.' }, { status: 502 });
        }
        return NextResponse.json({ error: `Model lookup returned HTTP ${response.status}. Check the Base URL and Router API key.` }, { status: 502 });
      }
      const data = await response.json() as {
        models?: Array<{ name?: string; size?: number; remote_model?: string; remote_host?: string }>;
        data?: Array<{ id?: string }>;
      };
      if (provider !== 'ollama') {
        const models = Array.from(new Set([
          'default-chat',
          ...(data.data ?? []).map((model) => model.id).filter((id): id is string => !!id && id.startsWith('Olares/')),
        ]));
        return NextResponse.json({ models });
      }
      const models = (data.models ?? [])
        .filter((model) => !model.remote_model && !model.remote_host && !model.name?.endsWith(':cloud'))
        .sort((a, b) => (a.size ?? Number.MAX_SAFE_INTEGER) - (b.size ?? Number.MAX_SAFE_INTEGER))
        .map((model) => model.name)
        .filter((name): name is string => !!name);
      return NextResponse.json({ models });
    }
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model || model.length > 200) {
      return NextResponse.json({ error: 'Choose a valid Ollama model name in Settings.' }, { status: 400 });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 40) {
      return NextResponse.json({ error: 'A conversation with 1 to 40 messages is required.' }, { status: 400 });
    }
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = body.messages.map((item) => {
      const message = item as { role?: unknown; content?: unknown };
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
        throw new Error('Conversation messages must have user or assistant roles and text content.');
      }
      return { role: message.role, content: message.content.slice(0, 12000) };
    });
    const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim().slice(0, 12000) : '';
    if (systemPrompt) messages.unshift({ role: 'system', content: systemPrompt });

    const openAiCompatible = provider !== 'ollama';
    const endpoint = openAiCompatible ? 'chat/completions' : 'api/chat';
    const payload = openAiCompatible
      ? { model, messages, stream: false }
      : { model, messages, stream: false };
    const response = await fetch(new URL(`${base.href.replace(/\/$/, '')}/${endpoint}`), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000),
      redirect: 'manual',
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        return NextResponse.json({ error: 'Olares redirected the API call to sign-in. On the same LAN, enable LarePass Host mappings or local DNS so this Router hostname resolves to the Olares LAN IP; also verify the Router API key.' }, { status: 502 });
      }
      return NextResponse.json({ error: `${provider === 'ollama' ? 'Ollama' : provider === 'olares' ? 'Olares Router' : 'Olares shared endpoint'} returned HTTP ${response.status}: ${detail}` }, { status: 502 });
    }
    const data = await response.json() as {
      message?: { content?: string };
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    const content = provider !== 'ollama' ? data.choices?.[0]?.message?.content : data.message?.content;
    const reply = (typeof content === 'string' ? content : content?.map((part) => part.text ?? '').join(''))?.trim();
    if (!reply) return NextResponse.json({ error: 'The model returned an empty response.' }, { status: 502 });
    return NextResponse.json({ reply });
  } catch (error) {
    return ollamaError(error);
  }
}
