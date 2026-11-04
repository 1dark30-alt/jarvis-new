/**
 * Shared helper for reading / writing server-side settings.
 *
 * All sensitive keys (OpenAI, ElevenLabs, HA token, etc.) live in a JSON
 * file on the *server* machine so every client that connects — including
 * tablets and phones on the LAN — inherits them automatically.
 *
 * Usage:
 *   const settings = await loadServerSettings();
 *   await saveServerSettings({ jarvis_ha_url: 'http://...' });
 *
 * For synchronous reads (widget helpers etc.), use `getCachedSetting(key)`.
 * The cache is populated on first `loadServerSettings()` call.
 */

export type ServerSettings = {
  // Jarvis core
  jarvis_settings?: string;        // JSON-serialised JarvisSettings object

  // Home Assistant
  jarvis_ha_url?: string;
  jarvis_ha_token?: string;

  // Weather
  jarvis_weather_location?: string;
  jarvis_weather_lat?: string;
  jarvis_weather_lon?: string;

  // iCal / Calendar
  jarvis_ical_url?: string;

  // Bambu Lab
  bambu_email?: string;
  bambu_token_exp?: string;

  // News
  jarvis_news_settings?: string;   // JSON-serialised NewsSettings object
};

// ── In-memory cache so widgets can read settings synchronously after boot ──
let _cache: ServerSettings = {};
let _loaded = false;

export function getCachedSetting(key: keyof ServerSettings): string {
  const fromCache = _cache[key];
  if (fromCache) return fromCache;
  // Fall back to localStorage (host machine backwards-compat)
  if (typeof window !== 'undefined') {
    return localStorage.getItem(key) ?? '';
  }
  return '';
}

export async function loadServerSettings(): Promise<ServerSettings> {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (!res.ok) return _cache;
    const data = (await res.json()) as ServerSettings;
    _cache = data;
    _loaded = true;
    // Back-fill localStorage so the host machine benefits from server settings too
    if (typeof window !== 'undefined') {
      const syncKeys: (keyof ServerSettings)[] = [
        'jarvis_settings',
        'jarvis_ha_url', 'jarvis_ha_token',
        'jarvis_weather_location', 'jarvis_weather_lat', 'jarvis_weather_lon',
        'jarvis_ical_url', 'bambu_email', 'bambu_token_exp',
      ];
      for (const k of syncKeys) {
        if (data[k] && !localStorage.getItem(k)) {
          localStorage.setItem(k, data[k]!);
        }
      }
    }
    return data;
  } catch {
    return _cache;
  }
}

export function isServerSettingsLoaded(): boolean { return _loaded; }

export async function saveServerSettings(patch: Partial<ServerSettings>): Promise<void> {
  // Update cache immediately so subsequent getCachedSetting calls see the new value
  _cache = { ..._cache, ...patch };
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch (e) {
    console.error('[serverSettings] save failed:', e);
  }
}

/** Read one key — falls back to localStorage for backwards-compat on the host machine. */
export function getLocalOrServer(
  serverSettings: ServerSettings,
  key: keyof ServerSettings,
  localStorageKey?: string,
): string {
  const fromServer = serverSettings[key];
  if (fromServer) return fromServer;
  if (typeof window !== 'undefined') {
    return localStorage.getItem(localStorageKey ?? key) ?? '';
  }
  return '';
}
