/**
 * Bambu Lab Cloud MQTT manager — module-level singleton so the connection
 * persists across hot-reloads in Next.js dev and across route invocations.
 * Token is persisted to disk so it survives server restarts.
 */

import fs from 'fs';
import path from 'path';

const BAMBU_API  = 'https://api.bambulab.com';
// The Bambu access token grants full control of the account's printers, so it
// must be stored per-user and never inside the distributable app bundle. In
// packaged builds Electron passes JARVIS_DATA_DIR (the OS per-user app-data
// dir); in dev we fall back to the git-ignored project root.
const DATA_DIR   = process.env.JARVIS_DATA_DIR || process.cwd();
const TOKEN_PATH = path.join(DATA_DIR, '.bambu-token.json');

export interface BambuToken {
  accessToken: string;
  refreshToken: string;
  tokenExpiration: number;
}

export interface PrinterInfo {
  deviceId: string;
  name: string;
  model?: string;
}

// ── Disk persistence ──────────────────────────────────────────────────────────

function loadTokenFromDisk(): BambuToken | null {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
      return JSON.parse(raw) as BambuToken;
    }
  } catch {}
  return null;
}

function saveTokenToDisk(token: BambuToken | null) {
  try {
    if (token) {
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
    } else if (fs.existsSync(TOKEN_PATH)) {
      fs.unlinkSync(TOKEN_PATH);
    }
  } catch (e) {
    console.error('[Bambu] Failed to save token to disk:', e);
  }
}

// ── Global module-level state ─────────────────────────────────────────────────

const g = globalThis as typeof globalThis & {
  _bambuToken?: BambuToken | null;
  _bambuPrinters?: PrinterInfo[];
  _bambuTelemetry?: Record<string, Record<string, unknown>>;
  _bambuMqttConnected?: boolean;
  _bambuMqttClient?: import('mqtt').MqttClient | null;
  _bambuConnecting?: boolean;
  _bambuInitialized?: boolean;
  _bambuLastErrLog?: number;
};

// On first module load, restore token from disk and auto-connect
if (!g._bambuInitialized) {
  g._bambuInitialized   = true;
  g._bambuPrinters      = [];
  g._bambuTelemetry     = {};
  g._bambuMqttConnected = false;
  g._bambuMqttClient    = null;
  g._bambuConnecting    = false;
  g._bambuLastErrLog    = 0;

  const diskToken = loadTokenFromDisk();
  if (diskToken && diskToken.accessToken && diskToken.tokenExpiration > Date.now()) {
    g._bambuToken = diskToken;
    // Kick off MQTT reconnection in background
    import('./mqtt-manager').then(({ connectMqtt }) => {
      connectMqtt(diskToken).catch((e) => console.error('[Bambu] Auto-reconnect failed:', e));
    });
  } else {
    g._bambuToken = null;
  }
}

export const getToken      = (): BambuToken | null => g._bambuToken ?? null;
export const getPrinters   = (): PrinterInfo[]      => g._bambuPrinters ?? [];
export const getTelemetry  = (): Record<string, Record<string, unknown>> => g._bambuTelemetry ?? {};
export const isMqttConnected = (): boolean          => g._bambuMqttConnected ?? false;

export function setToken(t: BambuToken | null) {
  g._bambuToken = t;
  saveTokenToDisk(t);
}

export function isTokenValid(): boolean {
  return !!(g._bambuToken?.accessToken && (g._bambuToken.tokenExpiration ?? 0) > Date.now());
}

// ── Cloud MQTT ────────────────────────────────────────────────────────────────

export async function connectMqtt(token: BambuToken): Promise<void> {
  if (g._bambuMqttConnected && g._bambuMqttClient?.connected) return;
  if (g._bambuConnecting) return;
  g._bambuConnecting = true;

  // Fetch bound printers
  const bindRes = await fetch(`${BAMBU_API}/v1/iot-service/api/user/bind`, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
  });
  if (!bindRes.ok) throw new Error(`Bind failed: ${bindRes.status}`);
  const bindData = await bindRes.json() as { devices?: Array<{ dev_id: string; name: string; dev_product_name?: string }> };
  const printers: PrinterInfo[] = (bindData.devices ?? []).map((d) => ({
    deviceId: d.dev_id,
    name: d.name,
    model: d.dev_product_name,
  }));
  g._bambuPrinters = printers;

  if (!printers.length) return;

  // Resolve MQTT username from preferences
  let username = '';
  try {
    const prefRes = await fetch(`${BAMBU_API}/v1/design-user-service/my/preference`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (prefRes.ok) {
      const pref = await prefRes.json() as { uid?: string | number };
      if (pref.uid) username = `u_${pref.uid}`;
    }
  } catch {}
  if (!username) username = `u_${Math.random().toString(16).slice(2)}`;

  const mqtt = await import('mqtt');
  const brokerUrl = 'mqtts://us.mqtt.bambulab.com:8883';
  const client = mqtt.connect(brokerUrl, {
    clientId: username,
    username,
    password: token.accessToken,
    clean: true,
    reconnectPeriod: 5000,
    protocol: 'mqtts',
  });

  client.on('connect', () => {
    g._bambuMqttConnected = true;
    g._bambuConnecting    = false;
    printers.forEach(({ deviceId }) => {
      client.subscribe(`device/${deviceId}/report`, () => {
        const seq = Date.now().toString();
        client.publish(`device/${deviceId}/request`, JSON.stringify({
          pushing: { sequence_id: seq, command: 'pushall', version: 1, push_target: 1 },
        }));
      });
    });
  });

  client.on('message', (topic: string, buf: Buffer) => {
    try {
      const msg = JSON.parse(buf.toString()) as Record<string, unknown>;
      const id = topic.split('/')[1];
      const update = (msg.print ?? msg) as Record<string, unknown>;
      g._bambuTelemetry![id] = Object.assign({}, g._bambuTelemetry![id] ?? {}, update);
    } catch {}
  });

  client.on('error', (err: Error) => {
    const now = Date.now();
    if ((now - (g._bambuLastErrLog ?? 0)) > 30_000) {
      console.error('[Bambu MQTT]', err.message);
      g._bambuLastErrLog = now;
    }
  });
  client.on('close', () => {
    g._bambuMqttConnected = false;
    g._bambuConnecting    = false;
  });

  g._bambuMqttClient = client;
}

export function sendCommand(deviceId: string, command: 'pause' | 'resume' | 'stop'): boolean {
  const client = g._bambuMqttClient;
  if (!client?.connected) return false;
  const seq = Date.now().toString();
  client.publish(`device/${deviceId}/request`, JSON.stringify({
    print: { sequence_id: seq, command, param: '' },
  }), { qos: 1 });
  return true;
}

export async function fetchPrintersRest(token: BambuToken): Promise<PrinterInfo[]> {
  const res = await fetch(`${BAMBU_API}/v1/iot-service/api/user/bind`, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json() as { devices?: Array<{ dev_id: string; name: string; dev_product_name?: string }> };
  return (data.devices ?? []).map((d) => ({ deviceId: d.dev_id, name: d.name, model: d.dev_product_name }));
}
