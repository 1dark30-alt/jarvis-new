import fs from 'node:fs';
import path from 'node:path';

/**
 * Plaid client — banking data for the Finance screen.
 *
 * Credentials (client_id + secret) are per-machine, in jarvis-server-settings.
 * Connection tokens live in plaid.json (JARVIS_DATA_DIR, gitignored) and never
 * leave the machine except to Plaid itself.
 *
 * Everything is plain JSON POSTs to Plaid's REST API — no SDK.
 */

const API_BASE: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export const PLAID_VERSION = '2020-09-14';

export interface PlaidCreds {
  clientId: string;
  secret: string;
  env: 'sandbox' | 'development' | 'production';
}

interface StoredItem {
  itemId: string;
  accessToken: string;
  institution: string;
  label: 'business' | 'personal';
  createdAt: string;
}

interface PlaidStore {
  items: StoredItem[];
}

function settingsFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-server-settings.json');
}

function dataFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'plaid.json');
}

export function readCreds(): PlaidCreds | null {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
    const s = (typeof raw.jarvis_settings === 'string'
      ? JSON.parse(raw.jarvis_settings)
      : raw.jarvis_settings ?? {}) as Record<string, unknown>;
    const clientId = String(s.plaidClientId ?? '').trim();
    const secret = String(s.plaidSecret ?? '').trim();
    const env = (String(s.plaidEnv ?? 'sandbox').trim() || 'sandbox') as PlaidCreds['env'];
    if (!clientId || !secret) return null;
    if (!API_BASE[env]) return null;
    return { clientId, secret, env };
  } catch {
    return null;
  }
}

function loadStore(): PlaidStore {
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile(), 'utf8')) as Partial<PlaidStore>;
    return { items: Array.isArray(raw.items) ? raw.items : [] };
  } catch {
    return { items: [] };
  }
}

function saveStore(store: PlaidStore): void {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(store, null, 2), 'utf8');
}

/** Low-level Plaid call. Throws with Plaid's error message on failure. */
export async function plaidCall<T = Record<string, unknown>>(
  endpoint: string,
  creds: PlaidCreds,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${API_BASE[creds.env]}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Plaid-Version': PLAID_VERSION },
    body: JSON.stringify({ client_id: creds.clientId, secret: creds.secret, ...body }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON — surface raw */ }
  if (!res.ok || data.error) {
    const e = (data.error ?? {}) as { error_message?: string; error_code?: string; display_message?: string };
    const msg = e.display_message ?? e.error_message ?? `Plaid HTTP ${res.status} — ${text.slice(0, 240)}`;
    throw new Error(`${e.error_code ?? 'PLAID_ERROR'}: ${msg}`);
  }
  return data as T;
}

// ── items ────────────────────────────────────────────────────────────────────

export function listItems(): StoredItem[] {
  return loadStore().items;
}

export function findItem(itemId: string): StoredItem | null {
  return loadStore().items.find((i) => i.itemId === itemId) ?? null;
}

export function addItem(item: StoredItem): void {
  const store = loadStore();
  const existing = store.items.findIndex((i) => i.itemId === item.itemId);
  if (existing >= 0) store.items[existing] = item;
  else store.items.push(item);
  saveStore(store);
}

export function removeItem(itemId: string): boolean {
  const store = loadStore();
  const before = store.items.length;
  store.items = store.items.filter((i) => i.itemId !== itemId);
  saveStore(store);
  return store.items.length < before;
}

export function setItemLabel(itemId: string, label: 'business' | 'personal'): StoredItem | null {
  const store = loadStore();
  const item = store.items.find((i) => i.itemId === itemId);
  if (!item) return null;
  item.label = label;
  saveStore(store);
  return item;
}
