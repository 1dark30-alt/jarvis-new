'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';
import { sfx } from '../../lib/sfx';
import { notify } from '../../lib/notify';
import { loadServerSettings } from '../../lib/serverSettings';
import {
  SCRAPE_SCRIPTS,
  SCROLL_MORE_SCRIPTS,
  type ScrapeResult,
  type ScrapedComment,
  type SocialPlatformId,
} from '../../lib/social/scripts';

// ── Types ─────────────────────────────────────────────────────────────────────
type PlatformId = SocialPlatformId;

interface Platform {
  id: PlatformId;
  label: string;
  home: string;
  accent: string;
}

interface PendingReply {
  id: string;
  platform: PlatformId;
  author: string;
  comment: string;
  commentKey: string;
  reply: string;
  status: 'generating' | 'ready' | 'error' | 'sending';
  error?: string;
}

const PLATFORMS: Platform[] = [
  { id: 'instagram', label: 'Instagram', home: 'https://www.instagram.com/', accent: '#e1306c' },
  { id: 'tiktok',    label: 'TikTok',    home: 'https://www.tiktok.com/',     accent: '#25f4ee' },
  { id: 'facebook',  label: 'Facebook',  home: 'https://www.facebook.com/',  accent: '#1877f2' },
  { id: 'youtube',   label: 'YouTube',   home: 'https://www.youtube.com/',   accent: '#ff0033' },
];

const ACCENT = '#22d3ee';
const PROMPT_KEY = 'jarvis_social_persona_v2';
const MODEL_KEY = 'jarvis_social_model';
const AUTO_KEY = 'jarvis_social_auto_approve';
const ENABLED_KEY = 'jarvis_social_enabled';
const SORT_KEY = 'jarvis_social_newest_first';
const SEEN_KEY = 'jarvis_social_seen_v2';
const AUTOMATE_KEY = 'jarvis_social_automate_v1';

interface AutomateSettings {
  delayMinSec: number;
  delayMaxSec: number;
  typingMsPerChar: number;
  typingJitterMs: number;
  commentCap: number;
  rescanSec: number;
  skipStickers: boolean;
  humanizeTyping: boolean;
  autoScrollComments: boolean;
  scrollAttempts: number;
}

const DEFAULT_AUTOMATE: AutomateSettings = {
  delayMinSec: 8,
  delayMaxSec: 22,
  typingMsPerChar: 45,
  typingJitterMs: 30,
  commentCap: 25,
  rescanSec: 15,
  skipStickers: true,
  humanizeTyping: true,
  autoScrollComments: true,
  scrollAttempts: 4,
};

function clampNum(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function randomDelayMs(minSec: number, maxSec: number) {
  const lo = Math.max(0, Number(minSec) || 0);
  const hi = Math.max(lo, Number(maxSec) || 0); // never below min
  if (hi <= 0) return 0;
  const sec = lo === hi ? lo : lo + Math.random() * (hi - lo);
  return Math.round(sec * 1000);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const DEFAULT_PERSONA =
  `Write like Kevin typed the reply quickly himself. Be casual, concise, confident, and dry. Prioritize sounding natural over getting another response.
Do not turn every comment into a conversation. Only ask a question when the commenter has a real opinion, suggestion, criticism, technical point, or unclear detail worth expanding.
For jokes, compliments, references, and simple observations, reply with a short acknowledgment or dry continuation. Do not add unrelated questions.
Avoid cheesy wordplay, wholesome banter, forced enthusiasm, generic engagement questions, and phrases like:
"You a fan too?"
"What superhero would you be?"
"I've got my own kind of spark."
"What would you do?"
"Haha, not quite."
"Thanks for the support!"
Examples:
Comment: "Lil bit Spider-Man"
Reply: "Just a little bit."
Comment: "Are you Tony Stark?"
Reply: "Working with a much smaller budget."
Comment: "Bro thinks he's Spider-Man"
Reply: "Let me have this."
Comment: "This is actually sick"
Reply: "Appreciate it."
Comment: "That motor is going to overheat"
Reply: "That's my concern too. Think airflow would be enough?"
Questions must be directly connected to the comment and genuinely useful. Never invent confusion or ask a question solely for engagement.
Keep most replies under 12 words and never exceed 25. Match the commenter's energy. No hashtags, excessive emojis, corporate language, fabricated facts, or unnecessary explanations.
Output only the reply.`;

const DEFAULT_ENABLED: Record<PlatformId, boolean> = {
  instagram: true,
  tiktok: true,
  facebook: false,
  youtube: false,
};

function parseApiKey(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as { apiKey?: string };
    return (parsed.apiKey ?? '').trim();
  } catch {
    return '';
  }
}

/** Same source order as JarvisAssistant: server settings → localStorage → env. */
async function resolveApiKey(): Promise<string> {
  try {
    const server = await loadServerSettings();
    const serverKey = parseApiKey(server.jarvis_settings);
    if (serverKey) {
      // Keep localStorage in sync so sync reads work too
      if (!parseApiKey(localStorage.getItem('jarvis_settings'))) {
        localStorage.setItem('jarvis_settings', server.jarvis_settings!);
      }
      return serverKey;
    }
  } catch { /* fall through */ }

  const localKey = parseApiKey(localStorage.getItem('jarvis_settings'));
  if (localKey) return localKey;

  return (process.env.NEXT_PUBLIC_OPENAI_API_KEY ?? '').trim();
}

function readApiKeySync(): string {
  return parseApiKey(localStorage.getItem('jarvis_settings'))
    || (process.env.NEXT_PUBLIC_OPENAI_API_KEY ?? '').trim();
}

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr.slice(-2000) : []);
  } catch {
    return new Set();
  }
}

function persistSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-2000)));
  } catch { /* ignore */ }
}

// ── Placeholder pane (real Chromium view is composited by Electron main) ─────
function BrowserPane({
  platform,
  hostRef,
  isElectron,
  enabled,
}: {
  platform: Platform;
  hostRef: (el: HTMLDivElement | null) => void;
  isElectron: boolean;
  enabled: boolean;
}) {
  const [urlDraft, setUrlDraft] = useState(platform.home);

  useEffect(() => {
    if (!isElectron) return;
    const tick = window.setInterval(() => {
      void window.electron?.socialGetUrl?.(platform.id).then((r) => {
        if (r?.success && r.url) setUrlDraft(r.url);
      });
    }, 1500);
    return () => window.clearInterval(tick);
  }, [isElectron, platform.id]);

  const navigate = (url: string) => {
    let next = url.trim();
    if (!next) return;
    if (!/^https?:\/\//i.test(next)) next = `https://${next}`;
    setUrlDraft(next);
    sfx('click', 0.25);
    void window.electron?.socialNavigate?.(platform.id, next);
  };

  return (
    <div
      className="relative flex flex-col h-full min-h-0 min-w-0 overflow-hidden"
      style={{
        background: '#040a14',
        border: `1px solid ${enabled ? `${platform.accent}44` : 'rgba(255,255,255,0.06)'}`,
        boxShadow: enabled ? `0 0 24px ${platform.accent}18` : 'none',
        opacity: enabled ? 1 : 0.45,
      }}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5 shrink-0 z-10"
        style={{ background: '#0a121c', borderBottom: `1px solid ${platform.accent}33` }}
      >
        <span
          className="font-mono text-[9px] uppercase tracking-[0.25em] shrink-0"
          style={{ color: enabled ? platform.accent : 'rgba(255,255,255,0.3)' }}
        >
          {platform.label}
          {!enabled && <span className="ml-1 text-white/25">off</span>}
        </span>
        <input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(urlDraft); }}
          className="flex-1 min-w-0 bg-black/40 px-2 py-0.5 font-mono text-[10px] text-white/70 outline-none"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          spellCheck={false}
        />
        <button type="button" onClick={() => navigate(urlDraft)} className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 text-white/50 hover:text-white">Go</button>
        <button type="button" onClick={() => { void window.electron?.socialReload?.(platform.id); sfx('click', 0.2); }} className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 text-white/50 hover:text-white">↻</button>
        <button type="button" onClick={() => { void window.electron?.socialHome?.(platform.id); sfx('click', 0.2); }} className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 text-white/50 hover:text-white">⌂</button>
      </div>

      <div
        ref={hostRef}
        className="relative flex-1 min-h-0"
        style={{ background: isElectron ? '#000' : '#040a14' }}
      >
        {!isElectron && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: platform.accent }}>
              Electron Required
            </p>
            <p className="font-mono text-[10px] text-white/40 leading-relaxed">
              Quit and relaunch with <span className="text-white/70">npm run dev</span> so Electron recompiles.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Approval modal ────────────────────────────────────────────────────────────
function ApprovalCard({
  item,
  autoApprove,
  onSend,
  onSkip,
  onRegen,
  onStop,
}: {
  item: PendingReply;
  autoApprove: boolean;
  onSend: () => void;
  onSkip: () => void;
  onRegen: () => void;
  onStop: () => void;
}) {
  const platform = PLATFORMS.find((p) => p.id === item.platform);
  const busy = item.status === 'generating' || item.status === 'sending';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.96 }}
      className="w-full max-w-lg px-5 py-4"
      style={{
        background: 'linear-gradient(160deg, rgba(6,16,30,0.97), rgba(4,10,20,0.95))',
        border: `1px solid ${platform?.accent ?? ACCENT}66`,
        boxShadow: `0 0 40px ${platform?.accent ?? ACCENT}33`,
        clipPath: 'polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.35em]" style={{ color: platform?.accent ?? ACCENT }}>
          {platform?.label ?? item.platform} · Incoming Comment
        </span>
        <div className="flex items-center gap-2">
          {autoApprove && (
            <span className="font-mono text-[8px] uppercase tracking-wider text-emerald-400/80 animate-pulse">
              Auto-send on
            </span>
          )}
          <button
            type="button"
            onClick={onStop}
            className="font-mono text-[9px] uppercase tracking-[0.2em] px-2 py-1"
            style={{ border: '1px solid #ff6b6b', color: '#ff6b6b', background: 'rgba(255,80,80,0.12)' }}
          >
            Stop Bot
          </button>
        </div>
      </div>

      <div className="mb-3 px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="font-mono text-[9px] text-white/35 uppercase tracking-wider mb-1">@{item.author}</div>
        <p className="font-mono text-[12px] text-white/85 leading-relaxed">{item.comment}</p>
      </div>

      <div className="mb-4 px-3 py-2" style={{ background: 'rgba(34,211,238,0.06)', border: `1px solid ${ACCENT}44` }}>
        <div className="font-mono text-[9px] uppercase tracking-wider mb-1" style={{ color: ACCENT }}>Proposed Reply</div>
        {item.status === 'generating' ? (
          <p className="font-mono text-[12px] text-white/40 animate-pulse">Generating…</p>
        ) : item.status === 'sending' ? (
          <p className="font-mono text-[12px] text-white/40 animate-pulse">Sending…</p>
        ) : item.status === 'error' ? (
          <p className="font-mono text-[12px] text-red-400">{item.error ?? 'Failed'}</p>
        ) : (
          <p className="font-mono text-[12px] text-white leading-relaxed">{item.reply}</p>
        )}
      </div>

      <div className="flex gap-2">
        <button type="button" disabled={item.status !== 'ready'} onClick={onSend} className="flex-1 py-2 font-mono text-[10px] uppercase tracking-[0.3em] disabled:opacity-30" style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: ACCENT }}>Send</button>
        <button type="button" disabled={busy} onClick={onSkip} className="flex-1 py-2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/60 disabled:opacity-30" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>Skip</button>
        <button type="button" disabled={busy} onClick={onRegen} className="flex-1 py-2 font-mono text-[10px] uppercase tracking-[0.3em] disabled:opacity-30" style={{ border: '1px solid rgba(255,200,80,0.4)', color: '#fbbf24' }}>Regenerate</button>
      </div>
      <p className="mt-2 font-mono text-[8px] text-white/25 text-center">
        Skip = next comment · Stop Bot = halt responder
      </p>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function SocialMediaPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const isElectron = typeof window !== 'undefined' && !!window.electron?.isElectron;
  const hosts = useRef<Partial<Record<PlatformId, HTMLDivElement>>>({});

  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [model, setModel] = useState('gpt-4.1-mini');
  const [models, setModels] = useState<string[]>(['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o']);
  const [autoApprove, setAutoApprove] = useState(false);
  const [enabled, setEnabled] = useState<Record<PlatformId, boolean>>(DEFAULT_ENABLED);
  const [newestFirst, setNewestFirst] = useState(true);
  const [automate, setAutomate] = useState<AutomateSettings>(DEFAULT_AUTOMATE);
  const [automateOpen, setAutomateOpen] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [coolLeftSec, setCoolLeftSec] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [queue, setQueue] = useState<PendingReply[]>([]);
  const [broadcastUrl, setBroadcastUrl] = useState('');
  const [viewsReady, setViewsReady] = useState(false);
  const [statusLine, setStatusLine] = useState('Idle');

  const seenIds = useRef(new Set<string>());
  const autoApproveRef = useRef(false);
  const runningRef = useRef(false);
  const queueRef = useRef<PendingReply[]>([]);
  const enabledRef = useRef(enabled);
  const newestFirstRef = useRef(true);
  const automateRef = useRef(automate);
  const sentCountRef = useRef(0);
  const modelRef = useRef(model);
  const personaRef = useRef(persona);
  const apiKeyRef = useRef('');
  const showPanesRef = useRef(true); // false while approval modal covers the UI
  const scanTimer = useRef<number | null>(null);
  const settingsReadyRef = useRef(false);
  const coolingRef = useRef(false);
  const coolEndsAtRef = useRef(0);
  const coolTickRef = useRef<number | null>(null);

  // Start native browser panes + make window opaque so they can paint
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      await window.electron?.setWindowOpaque?.(true);
      if (!window.electron?.socialStart) {
        notify('Electron Rebuild Needed', 'Quit Jarvis fully and run npm run dev again.', 'warn', 8000);
        return;
      }
      const res = await window.electron.socialStart();
      if (cancelled) return;
      if (!res.success) {
        notify('Social Browsers', res.error ?? 'Failed to start panes.', 'error');
        return;
      }
      setViewsReady(true);
    };
    void boot();
    return () => {
      cancelled = true;
      // Drop in-flight queue reservations so they aren't permanently "handled"
      for (const item of queueRef.current) {
        seenIds.current.delete(`${item.platform}:${item.commentKey}`);
      }
      void window.electron?.socialStop?.();
      void window.electron?.setWindowOpaque?.(false);
    };
  }, []);

  // Sync placeholder rects → WebContentsView bounds (hide under approval modal)
  useEffect(() => {
    if (!viewsReady || !isElectron) return;

    const pushBounds = () => {
      const hidePanes = !showPanesRef.current;
      const all: Partial<Record<PlatformId, { x: number; y: number; width: number; height: number }>> = {};
      for (const p of PLATFORMS) {
        if (hidePanes) {
          all[p.id] = { x: 0, y: 0, width: 0, height: 0 };
          continue;
        }
        const el = hosts.current[p.id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        all[p.id] = {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        };
      }
      if (Object.keys(all).length) void window.electron?.socialSetBounds?.(all);
    };

    pushBounds();
    const ro = new ResizeObserver(pushBounds);
    for (const p of PLATFORMS) {
      const el = hosts.current[p.id];
      if (el) ro.observe(el);
    }
    window.addEventListener('resize', pushBounds);
    const poll = window.setInterval(pushBounds, 400);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', pushBounds);
      window.clearInterval(poll);
    };
  }, [viewsReady, isElectron, queue.length, autoApprove]);

  // Load saved controls BEFORE any persist effect can overwrite them with defaults
  useLayoutEffect(() => {
    try {
      const p = localStorage.getItem(PROMPT_KEY);
      if (p) setPersona(p);
      const m = localStorage.getItem(MODEL_KEY);
      if (m) setModel(m);
      setAutoApprove(localStorage.getItem(AUTO_KEY) === '1');
      const en = readJson<Partial<Record<PlatformId, boolean>>>(ENABLED_KEY);
      if (en) setEnabled((prev) => ({ ...prev, ...en }));
      const sort = localStorage.getItem(SORT_KEY);
      if (sort !== null) setNewestFirst(sort !== '0');
      const autoParsed = readJson<Partial<AutomateSettings>>(AUTOMATE_KEY);
      if (autoParsed) {
        const merged = { ...DEFAULT_AUTOMATE, ...autoParsed };
        if (merged.delayMaxSec < merged.delayMinSec) merged.delayMaxSec = merged.delayMinSec;
        setAutomate(merged);
      }
      const open = localStorage.getItem(`${AUTOMATE_KEY}_open`);
      if (open !== null) setAutomateOpen(open === '1');
      seenIds.current = loadSeen();
    } catch { /* ignore */ }
    settingsReadyRef.current = true;
    setSettingsReady(true);
  }, []);

  // Pull OpenAI key (server → local) after mount
  useEffect(() => {
    let cancelled = false;
    void resolveApiKey().then((key) => {
      if (cancelled) return;
      apiKeyRef.current = key;
      if (!key) return;
      void fetch('/api/social/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      })
        .then((res) => res.json())
        .then((data: { models?: string[] }) => {
          if (!cancelled && data.models?.length) setModels(data.models);
        })
        .catch(() => { /* keep defaults */ });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    personaRef.current = persona;
    if (!settingsReady) return;
    localStorage.setItem(PROMPT_KEY, persona);
  }, [persona, settingsReady]);
  useEffect(() => {
    modelRef.current = model;
    if (!settingsReady) return;
    localStorage.setItem(MODEL_KEY, model);
  }, [model, settingsReady]);
  useEffect(() => {
    autoApproveRef.current = autoApprove;
    if (!settingsReady) return;
    localStorage.setItem(AUTO_KEY, autoApprove ? '1' : '0');
  }, [autoApprove, settingsReady]);
  useEffect(() => {
    enabledRef.current = enabled;
    if (!settingsReady) return;
    localStorage.setItem(ENABLED_KEY, JSON.stringify(enabled));
  }, [enabled, settingsReady]);
  useEffect(() => {
    newestFirstRef.current = newestFirst;
    if (!settingsReady) return;
    localStorage.setItem(SORT_KEY, newestFirst ? '1' : '0');
  }, [newestFirst, settingsReady]);
  useEffect(() => {
    automateRef.current = automate;
    if (!settingsReady) return;
    localStorage.setItem(AUTOMATE_KEY, JSON.stringify(automate));
  }, [automate, settingsReady]);
  useEffect(() => {
    if (!settingsReady) return;
    localStorage.setItem(`${AUTOMATE_KEY}_open`, automateOpen ? '1' : '0');
  }, [automateOpen, settingsReady]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { sentCountRef.current = sentCount; }, [sentCount]);
  useEffect(() => {
    // Native WebContentsViews sit above React — hide them so the approval modal is clickable.
    showPanesRef.current = !(queue[0] && !autoApprove && !cooling);
  }, [queue, autoApprove, cooling]);

  const patchAutomate = (patch: Partial<AutomateSettings>) => {
    setAutomate((prev) => {
      const next = { ...prev, ...patch };
      // Keep max >= min so random delay never dips below the minimum
      if (patch.delayMinSec !== undefined && next.delayMaxSec < next.delayMinSec) {
        next.delayMaxSec = next.delayMinSec;
      }
      if (patch.delayMaxSec !== undefined && next.delayMaxSec < next.delayMinSec) {
        next.delayMinSec = next.delayMaxSec;
      }
      try {
        if (settingsReadyRef.current) {
          localStorage.setItem(AUTOMATE_KEY, JSON.stringify(next));
        }
      } catch { /* ignore */ }
      return next;
    });
  };

  const clearCoolTick = () => {
    if (coolTickRef.current) {
      window.clearInterval(coolTickRef.current);
      coolTickRef.current = null;
    }
  };

  const waitInterCommentDelay = async () => {
    // Single-flight: if a cooldown is already running, just wait for it to finish
    if (coolingRef.current && coolEndsAtRef.current > Date.now()) {
      while (coolingRef.current && Date.now() < coolEndsAtRef.current) {
        if (!runningRef.current) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      return;
    }

    const { delayMinSec, delayMaxSec } = automateRef.current;
    const minSec = Math.max(0, Number(delayMinSec) || 0);
    const maxSec = Math.max(minSec, Number(delayMaxSec) || 0);
    const ms = randomDelayMs(minSec, maxSec);
    if (ms <= 0) return;

    coolingRef.current = true;
    setCooling(true);
    const ends = Date.now() + ms;
    coolEndsAtRef.current = ends;
    const totalSec = Math.ceil(ms / 1000);
    setCoolLeftSec(totalSec);
    setStatusLine(`Cooling down ${totalSec}s (${minSec}–${maxSec}s)…`);

    clearCoolTick();
    coolTickRef.current = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((coolEndsAtRef.current - Date.now()) / 1000));
      setCoolLeftSec(left);
      setStatusLine(`Cooling down ${left}s…`);
      if (left <= 0) clearCoolTick();
    }, 250);

    while (Date.now() < ends) {
      if (!runningRef.current) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    clearCoolTick();
    coolingRef.current = false;
    coolEndsAtRef.current = 0;
    setCooling(false);
    setCoolLeftSec(0);
    if (runningRef.current) setStatusLine('Cooldowning for next comment…');
  };

  const getApiKey = async (): Promise<string> => {
    if (apiKeyRef.current) return apiKeyRef.current;
    const key = await resolveApiKey();
    apiKeyRef.current = key;
    return key;
  };

  const setHost = (id: PlatformId) => (el: HTMLDivElement | null) => {
    if (el) hosts.current[id] = el;
    else delete hosts.current[id];
  };

  const markSeen = (platform: PlatformId, commentKey: string, author?: string, comment?: string) => {
    const full = `${platform}:${commentKey}`;
    seenIds.current.add(full);
    // Extra stable keys so slight text/quote differences can't cause a second reply
    if (author && comment) {
      const norm = `${author}::${comment}`.toLowerCase().replace(/["'\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      seenIds.current.add(`${platform}:${norm}`);
      seenIds.current.add(`${platform}:author:${author.toLowerCase()}:${comment.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)}`);
    }
    persistSeen(seenIds.current);
  };

  const broadcast = () => {
    let url = broadcastUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    sfx('select', 0.4);
    void window.electron?.socialNavigateAll?.(url);
    notify('Broadcast', 'Opened URL in all four panes.', 'info');
  };

  const captureAll = async () => {
    if (!window.electron?.socialCaptureHtml) {
      notify('Capture', 'HTML capture needs a rebuilt Electron app.', 'warn');
      return;
    }
    setCapturing(true);
    sfx('select', 0.4);
    let ok = 0;
    for (const p of PLATFORMS) {
      try {
        const snap = await window.electron.socialCaptureHtml(p.id);
        if (!snap.success || !snap.html) continue;
        const res = await fetch('/api/social/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: p.id,
            url: snap.url ?? p.home,
            title: snap.title ?? p.label,
            html: snap.html,
          }),
        });
        const data = await res.json() as { success?: boolean };
        if (data.success) ok += 1;
      } catch (err) {
        console.warn('[social] capture failed', p.id, err);
      }
    }
    setCapturing(false);
    if (ok > 0) {
      sfx('notification', 0.5);
      notify('Structure Captured', `Saved ${ok} HTML snapshot(s) to social-captures/.`, 'success');
    } else {
      notify('Capture Failed', 'Could not read any pane. Log in and open a reel first.', 'error');
    }
  };

  const generateReply = async (item: PendingReply): Promise<PendingReply> => {
    try {
      const apiKey = await getApiKey();
      if (!apiKey) {
        return { ...item, status: 'error', error: 'Missing OpenAI API key. Set it in Settings.' };
      }
      const res = await fetch('/api/social/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          model: modelRef.current,
          persona: personaRef.current,
          platform: item.platform,
          comment: item.comment,
          author: item.author,
        }),
      });
      const data = await res.json() as { success?: boolean; reply?: string; error?: string };
      if (!data.success || !data.reply) {
        return { ...item, status: 'error', error: data.error ?? 'Generation failed' };
      }
      return { ...item, status: 'ready', reply: data.reply };
    } catch (err) {
      return { ...item, status: 'error', error: err instanceof Error ? err.message : 'Network error' };
    }
  };

  const pushPaneBoundsNow = () => {
    const all: Partial<Record<PlatformId, { x: number; y: number; width: number; height: number }>> = {};
    for (const p of PLATFORMS) {
      const el = hosts.current[p.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      all[p.id] = { x: r.left, y: r.top, width: r.width, height: r.height };
    }
    if (Object.keys(all).length) void window.electron?.socialSetBounds?.(all);
  };

  const sendReply = async (item: PendingReply): Promise<{ ok: boolean; alreadyReplied?: boolean; error?: string }> => {
    if (item.platform !== 'instagram' && item.platform !== 'tiktok') {
      notify('Send Failed', `${item.platform} posting is not wired yet.`, 'error');
      return { ok: false };
    }
    if (!window.electron?.socialPostReply) {
      notify('Send Failed', 'Relaunch Jarvis with npm run dev so Electron picks up the new poster.', 'error');
      return { ok: false };
    }
    setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'sending' } : x)));
    // Restore panes so the guest view can receive native keystrokes
    showPanesRef.current = true;
    pushPaneBoundsNow();
    await new Promise((r) => setTimeout(r, 250));
    try {
      const a = automateRef.current;
      const res = await window.electron.socialPostReply(
        item.platform,
        item.author,
        item.comment,
        item.reply,
        {
          typingMsPerChar: a.humanizeTyping ? a.typingMsPerChar : 0,
          typingJitterMs: a.humanizeTyping ? a.typingJitterMs : 0,
        },
      );
      if (!res.success) {
        const alreadyReplied = /already replied/i.test(res.error ?? '');
        if (alreadyReplied) {
          notify('Already Replied', 'Skipped — you already responded to this comment.', 'info', 4000);
          markSeen(item.platform, item.commentKey, item.author, item.comment);
          setQueue((q) => q.filter((x) => x.id !== item.id));
          return { ok: false, alreadyReplied: true, error: res.error };
        }
        notify('Send Failed', res.error ?? 'Could not post reply.', 'error');
        setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'error', error: res.error } : x)));
        return { ok: false, error: res.error };
      }
      setSentCount((n) => n + 1);
      return { ok: true };
    } finally {
      showPanesRef.current = !(queueRef.current[0] && !autoApproveRef.current && !cooling);
    }
  };

  const enqueueComment = async (platform: PlatformId, author: string, comment: string, commentKey: string) => {
    const fullKey = `${platform}:${commentKey}`;
    if (seenIds.current.has(fullKey)) return;
    if (queueRef.current.some((q) => q.platform === platform && q.commentKey === commentKey)) return;
    // Session reserve only — persist on Send/Skip so a refresh doesn't permanently hide comments
    seenIds.current.add(fullKey);

    const draft: PendingReply = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      platform,
      author,
      comment,
      commentKey,
      reply: '',
      status: 'generating',
    };
    setQueue((q) => [...q, draft]);
    sfx('notification', 0.35);

    const ready = await generateReply(draft);
    setQueue((q) => q.map((x) => (x.id === draft.id ? ready : x)));

    if (ready.status === 'ready' && autoApproveRef.current) {
      const result = await sendReply(ready);
      setQueue((q) => q.filter((x) => x.id !== draft.id));
      if (result.ok) {
        markSeen(platform, commentKey, author, comment);
        notify('Auto-sent', `${platform}: ${ready.reply}`, 'success', 4000);
        if (runningRef.current) {
          await waitInterCommentDelay();
          if (runningRef.current) void scanOnce();
        }
      } else if (result.alreadyReplied) {
        // already marked seen inside sendReply
      } else {
        // Allow retry later
        seenIds.current.delete(fullKey);
      }
    }
  };

  const scrapePlatform = async (id: PlatformId): Promise<{ comments: ScrapedComment[]; debug?: ScrapeResult['debug']; error?: string }> => {
    if (!window.electron?.socialExec) return { comments: [] };
    const res = await window.electron.socialExec(id, SCRAPE_SCRIPTS[id]);
    if (!res.success) {
      console.warn('[social] scrape exec failed', id, res.error);
      return { comments: [], error: res.error };
    }
    const data = res.result as ScrapeResult;
    if (data?.error && id !== 'facebook' && id !== 'youtube') {
      console.warn('[social] scrape', id, data.error);
    }
    return {
      comments: Array.isArray(data?.comments) ? data.comments : [],
      debug: data?.debug,
      error: data?.error,
    };
  };

  const scrollForMoreComments = async (id: PlatformId): Promise<{ grew: boolean; before: number; after: number }> => {
    const code = SCROLL_MORE_SCRIPTS[id];
    if (!code || !window.electron?.socialExec) return { grew: false, before: 0, after: 0 };
    const res = await window.electron.socialExec(id, code);
    const data = (res.result ?? {}) as { grew?: boolean; before?: number; after?: number };
    return {
      grew: !!data.grew,
      before: data.before ?? 0,
      after: data.after ?? 0,
    };
  };

  type RankedComment = ScrapedComment & { platform: PlatformId };

  const collectUnreplied = async (): Promise<{
    pooled: RankedComment[];
    rawVisible: number;
    blockedByMemory: number;
    scrapeNotes: string[];
  }> => {
    const pooled: RankedComment[] = [];
    const a = automateRef.current;
    let rawVisible = 0;
    let blockedByMemory = 0;
    const scrapeNotes: string[] = [];

    for (const p of PLATFORMS) {
      if (!enabledRef.current[p.id]) continue;
      try {
        const { comments, debug, error } = await scrapePlatform(p.id);
        rawVisible += debug?.rawFound ?? comments.length;
        if (error) scrapeNotes.push(`${p.label}: ${error}`);
        if (debug && debug.rawFound === 0) {
          scrapeNotes.push(`${p.label}: 0 comment nodes (open the comments panel)`);
        } else if (debug) {
          scrapeNotes.push(`${p.label}: ${debug.rawFound} visible via ${debug.strategy}`);
        }

        for (const c of comments) {
          if (c.isOwn || c.alreadyReplied) continue;
          if (!c.text?.trim() || !c.author?.trim()) continue;
          if (a.skipStickers && /sticker/i.test(c.text)) continue;
          const fullKey = `${p.id}:${c.key}`;
          const altKey = `${p.id}:${c.author}::${c.text}`.toLowerCase().replace(/["'\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
          const authorKey = `${p.id}:author:${c.author.toLowerCase()}:${c.text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)}`;
          if (seenIds.current.has(fullKey) || seenIds.current.has(altKey) || seenIds.current.has(authorKey)) {
            blockedByMemory += 1;
            continue;
          }
          pooled.push({ ...c, platform: p.id });
        }
      } catch (err) {
        console.warn('[social] scrape error', p.id, err);
      }
    }

    pooled.sort((a2, b) =>
      newestFirstRef.current ? a2.ageSeconds - b.ageSeconds : b.ageSeconds - a2.ageSeconds,
    );
    return { pooled, rawVisible, blockedByMemory, scrapeNotes };
  };

  const scanOnce = async () => {
    if (!window.electron?.socialExec) {
      notify('Scan Failed', 'Electron socialExec unavailable — relaunch with npm run dev.', 'error');
      return;
    }
    // One-at-a-time only — never stack a queue of pending replies
    if (queueRef.current.length > 0 || coolingRef.current) return;

    setScanning(true);
    setStatusLine('Grabbing next comment…');

    const a = automateRef.current;

    if (a.commentCap > 0 && sentCountRef.current >= a.commentCap) {
      setScanning(false);
      setStatusLine(`Comment cap reached (${a.commentCap})`);
      notify('Comment Cap', `Reached session cap of ${a.commentCap}. Stopping.`, 'info');
      runningRef.current = false;
      setRunning(false);
      return;
    }

    let { pooled, rawVisible, blockedByMemory, scrapeNotes } = await collectUnreplied();
    let next = pooled[0] ?? null;

    // Auto-scroll the comments panel to lazy-load more when the current view is exhausted
    if (!next && a.autoScrollComments) {
      const attempts = Math.max(1, Math.min(10, a.scrollAttempts || 4));
      for (let i = 0; i < attempts && runningRef.current; i++) {
        setStatusLine(`Loading more comments… (${i + 1}/${attempts})`);
        let grewAny = false;
        for (const p of PLATFORMS) {
          if (!enabledRef.current[p.id]) continue;
          if (!SCROLL_MORE_SCRIPTS[p.id]) continue;
          try {
            const scroll = await scrollForMoreComments(p.id);
            if (scroll.grew) grewAny = true;
            scrapeNotes.push(`${p.label}: scroll ${scroll.before}→${scroll.after}`);
          } catch (err) {
            console.warn('[social] scroll more failed', p.id, err);
          }
        }

        ({ pooled, rawVisible, blockedByMemory, scrapeNotes } = await collectUnreplied());
        next = pooled[0] ?? null;
        if (next) break;
        if (!grewAny) {
          // Nothing new loaded — stop burning attempts
          break;
        }
      }
    }

    setScanning(false);

    if (!next) {
      if (blockedByMemory > 0) {
        setStatusLine(`${blockedByMemory} already handled — scrolled for more, none left`);
        notify(
          'Caught Up',
          `${blockedByMemory} visible comments already handled and no new ones loaded. Scroll manually if needed, or wait for new comments.`,
          'info',
          7000,
        );
      } else if (rawVisible === 0) {
        setStatusLine('No comment nodes found — open comments panel');
        notify(
          'Comments Not Visible',
          scrapeNotes.join(' · ') || 'Open the TikTok/Instagram comments panel on the video, then Start again.',
          'warn',
          8000,
        );
      } else {
        setStatusLine('No unreplied comments in current view');
        notify('Nothing To Reply', scrapeNotes.join(' · ') || 'Only own/already-replied comments in view.', 'info', 6000);
      }
      return;
    }

    setStatusLine(`Replying to @${next.author}…`);
    await enqueueComment(next.platform, next.author, next.text, next.key);
  };

  // Rescan while running whenever the queue is empty
  useEffect(() => {
    if (!running) {
      if (scanTimer.current) {
        window.clearInterval(scanTimer.current);
        scanTimer.current = null;
      }
      return;
    }

    void scanOnce();
    const rescanMs = Math.max(5, automateRef.current.rescanSec) * 1000;
    scanTimer.current = window.setInterval(() => {
      if (!runningRef.current) return;
      if (queueRef.current.length > 0) return;
      if (coolingRef.current) return; // must use ref — state is stale inside this interval
      void scanOnce();
    }, rescanMs);

    return () => {
      if (scanTimer.current) {
        window.clearInterval(scanTimer.current);
        scanTimer.current = null;
      }
      clearCoolTick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/stop only
  }, [running]);

  const injectTestComment = async () => {
    sfx('select', 0.4);
    const samples = [
      { platform: 'instagram' as const, author: 'alex_m', comment: 'This reel is insane 🔥 how did you film that?' },
      { platform: 'tiktok' as const, author: 'maya.codes', comment: 'Wait teach me the transition please!!' },
      { platform: 'youtube' as const, author: 'StudioNine', comment: 'Been waiting for this drop. Absolute cinema.' },
      { platform: 'facebook' as const, author: 'Jordan Lee', comment: 'Sharing this with the whole group chat 😂' },
    ];
    const pick = samples[Math.floor(Math.random() * samples.length)];
    const key = `${pick.author}::${pick.comment}`.slice(0, 180);
    // Allow re-testing: remove from seen
    seenIds.current.delete(`${pick.platform}:${key}`);
    await enqueueComment(pick.platform, pick.author, pick.comment, key);
  };

  const stopBot = () => {
    sfx('app_close', 0.4);
    runningRef.current = false;
    setRunning(false);
    clearCoolTick();
    coolingRef.current = false;
    coolEndsAtRef.current = 0;
    setCooling(false);
    setCoolLeftSec(0);
    // Release reserved (not sent/skipped) comments so they can be offered again later
    for (const item of queueRef.current) {
      seenIds.current.delete(`${item.platform}:${item.commentKey}`);
    }
    persistSeen(seenIds.current);
    setQueue([]);
    setStatusLine('Stopped');
    notify('Responder Stopped', 'Bot halted. Queue cleared.', 'info');
  };

  const toggleRun = () => {
    if (running) {
      stopBot();
      return;
    }

    void (async () => {
      const key = await getApiKey();
      if (!key && !readApiKeySync()) {
        notify('API Key Missing', 'Add your OpenAI key in Settings first.', 'warn');
        return;
      }
      if (!Object.values(enabled).some(Boolean)) {
        notify('No Platforms', 'Enable at least one platform checkbox.', 'warn');
        return;
      }
      if (!window.electron?.socialExec) {
        notify('Electron Rebuild Needed', 'Quit Jarvis and run npm run dev again.', 'warn');
        return;
      }
      sfx('select_confirm', 0.55);
      setSentCount(0);
      sentCountRef.current = 0;
      setRunning(true);
      setStatusLine('Responder armed');
      notify(
        'Responder Running',
        'Scanning enabled platforms for unreplied comments. Approve each reply with Send.',
        'info',
        6000,
      );
    })();
  };

  const active = cooling ? null : (queue[0] ?? null);

  const togglePlatform = (id: PlatformId) => {
    sfx('click', 0.2);
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <motion.div
      className="fixed inset-0 z-[50] overflow-hidden flex flex-col"
      style={{ background: '#020814' }}
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 20% 0%, rgba(34,211,238,0.12) 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 90% 80%, rgba(225,48,108,0.1) 0%, transparent 60%)',
        }}
      />

      <PageHeader title="Social Command" onNavigateHome={onNavigateHome} accent="cyan" />

      <div className="flex-1 flex min-h-0 relative z-10 gap-3 p-3 pt-1 overflow-hidden">
        <div className="flex-[1.65] min-w-0 min-h-0 h-full grid grid-cols-2 grid-rows-2 gap-3 [grid-template-rows:minmax(0,1fr)_minmax(0,1fr)]">
          {PLATFORMS.map((p) => (
            <BrowserPane
              key={p.id}
              platform={p}
              isElectron={isElectron}
              enabled={enabled[p.id]}
              hostRef={setHost(p.id)}
            />
          ))}
        </div>

        <div
          className="w-[340px] shrink-0 flex flex-col min-h-0 border"
          style={{ borderColor: 'rgba(34,211,238,0.15)', background: 'rgba(4,12,24,0.65)' }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(34,211,238,0.12)' }}>
            <div className="font-mono text-[10px] uppercase tracking-[0.4em]" style={{ color: ACCENT }}>
              Comment Engine
            </div>
            <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/30 mt-1">
              {running ? (scanning ? 'Scanning…' : statusLine) : 'Persona · Platforms · Approve Loop'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 flex flex-col gap-3">
            <div>
              <div className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/35 mb-1.5">
                Platforms
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {PLATFORMS.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                    style={{
                      border: `1px solid ${enabled[p.id] ? `${p.accent}66` : 'rgba(255,255,255,0.08)'}`,
                      background: enabled[p.id] ? `${p.accent}14` : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enabled[p.id]}
                      onChange={() => togglePlatform(p.id)}
                      className="accent-cyan-400"
                    />
                    <span className="font-mono text-[10px]" style={{ color: enabled[p.id] ? p.accent : 'rgba(255,255,255,0.4)' }}>
                      {p.label}
                    </span>
                  </label>
                ))}
              </div>
              <p className="font-mono text-[8px] text-white/25 mt-1.5 leading-relaxed">
                Instagram + TikTok scrapers are live. Facebook / YouTube need a comments capture first.
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newestFirst}
                onChange={() => { setNewestFirst((v) => !v); sfx('click', 0.2); }}
                className="accent-cyan-400"
              />
              <span className="font-mono text-[10px] text-white/70">Sort by most recent first</span>
            </label>

            <div>
              <div className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/35 mb-1.5">
                Open URL On All Panes
              </div>
              <div className="flex gap-1.5">
                <input
                  value={broadcastUrl}
                  onChange={(e) => setBroadcastUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') broadcast(); }}
                  placeholder="https://…"
                  className="flex-1 min-w-0 bg-black/40 px-2 py-1.5 font-mono text-[10px] text-white/80 outline-none"
                  style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <button type="button" onClick={broadcast} className="px-2 font-mono text-[9px] uppercase tracking-wider" style={{ border: `1px solid ${ACCENT}66`, color: ACCENT }}>
                  Sync
                </button>
              </div>
            </div>

            <div className="flex flex-col">
              <div className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/35 mb-1.5">
                Reply Persona / Instructions
              </div>
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="h-[110px] resize-none bg-black/40 px-2.5 py-2 font-mono text-[11px] text-white/80 leading-relaxed outline-none"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                spellCheck={false}
              />
            </div>

            <div>
              <div className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/35 mb-1.5">
                OpenAI Model
              </div>
              <select
                value={model}
                onChange={(e) => { setModel(e.target.value); sfx('click', 0.2); }}
                className="w-full bg-black/50 px-2 py-2 font-mono text-[11px] text-white/85 outline-none"
                style={{ border: `1px solid ${ACCENT}44` }}
              >
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void captureAll()}
                disabled={capturing}
                className="flex-1 py-2 font-mono text-[9px] uppercase tracking-[0.25em] disabled:opacity-40"
                style={{ border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)' }}
              >
                {capturing ? 'Capturing…' : 'Capture Structure'}
              </button>
              <button
                type="button"
                onClick={() => void injectTestComment()}
                className="flex-1 py-2 font-mono text-[9px] uppercase tracking-[0.25em]"
                style={{ border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24' }}
              >
                Test Comment
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                seenIds.current = new Set();
                persistSeen(seenIds.current);
                sfx('click', 0.25);
                notify('Memory Cleared', 'Previously skipped/sent comments can be offered again.', 'info');
              }}
              className="py-1.5 font-mono text-[8px] uppercase tracking-[0.25em] text-white/35 hover:text-white/60"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Clear handled memory
            </button>
          </div>

          {/* Automate settings — pinned above Start so it can't get lost in the scroll */}
          <div className="shrink-0 border-t px-3 py-2 max-h-[42%] overflow-y-auto" style={{ borderColor: 'rgba(34,211,238,0.12)' }}>
            <button
              type="button"
              onClick={() => { setAutomateOpen((v) => !v); sfx('click', 0.2); }}
              className="w-full flex items-center justify-between px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.3em]"
              style={{
                color: ACCENT,
                background: 'rgba(34,211,238,0.1)',
                border: `1px solid ${ACCENT}66`,
              }}
            >
              <span>Automate Settings {automateOpen ? '' : `(${automate.delayMinSec}-${automate.delayMaxSec}s · cap ${automate.commentCap || '∞'})`}</span>
              <span className="text-white/50">{automateOpen ? '▾ Hide' : '▸ Show'}</span>
            </button>
            {automateOpen && (
              <div className="mt-2 px-1 flex flex-col gap-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[8px] uppercase tracking-wider text-white/35">Delay min (s)</span>
                      <input
                        type="number"
                        min={0}
                        max={300}
                        value={automate.delayMinSec}
                        onChange={(e) => patchAutomate({ delayMinSec: clampNum(Number(e.target.value), 0, 300) })}
                        className="bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none"
                        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[8px] uppercase tracking-wider text-white/35">Delay max (s)</span>
                      <input
                        type="number"
                        min={automate.delayMinSec}
                        max={600}
                        value={Math.max(automate.delayMaxSec, automate.delayMinSec)}
                        onChange={(e) => patchAutomate({ delayMaxSec: clampNum(Number(e.target.value), automate.delayMinSec, 600) })}
                        className="bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none"
                        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                      />
                    </label>
                  </div>
                  <p className="font-mono text-[8px] text-white/25 -mt-1">
                    Random pause after each send · always ≥ min ({automate.delayMinSec}–{Math.max(automate.delayMaxSec, automate.delayMinSec)}s)
                  </p>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={automate.humanizeTyping}
                    onChange={() => patchAutomate({ humanizeTyping: !automate.humanizeTyping })}
                    className="accent-cyan-400"
                  />
                  <span className="font-mono text-[10px] text-white/70">Humanize send pause</span>
                </label>
                <p className="font-mono text-[8px] text-white/25 -mt-1">
                  Pauses before pasting the full reply (avoids Draft.js gibberish from per-key typing)
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[8px] uppercase tracking-wider text-white/35">Pause ms / char</span>
                    <input
                      type="number"
                      min={0}
                      max={250}
                      disabled={!automate.humanizeTyping}
                      value={automate.typingMsPerChar}
                      onChange={(e) => patchAutomate({ typingMsPerChar: clampNum(Number(e.target.value), 0, 250) })}
                      className="bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none disabled:opacity-40"
                      style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[8px] uppercase tracking-wider text-white/35">Pause jitter</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      disabled={!automate.humanizeTyping}
                      value={automate.typingJitterMs}
                      onChange={(e) => patchAutomate({ typingJitterMs: clampNum(Number(e.target.value), 0, 200) })}
                      className="bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none disabled:opacity-40"
                      style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-white/35">Comment cap</span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={automate.commentCap}
                    onChange={(e) => patchAutomate({ commentCap: clampNum(Number(e.target.value), 0, 500) })}
                    className="bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none"
                    style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                </label>
                <p className="font-mono text-[8px] text-white/25 -mt-1">
                  One comment at a time · Cap 0 = unlimited · session sent: {sentCount}
                </p>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-white/35">Rescan interval (s)</span>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={automate.rescanSec}
                    onChange={(e) => patchAutomate({ rescanSec: clampNum(Number(e.target.value), 5, 300) })}
                    className="bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none"
                    style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={automate.skipStickers}
                    onChange={() => patchAutomate({ skipStickers: !automate.skipStickers })}
                    className="accent-cyan-400"
                  />
                  <span className="font-mono text-[10px] text-white/70">Skip sticker comments</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={automate.autoScrollComments}
                    onChange={() => patchAutomate({ autoScrollComments: !automate.autoScrollComments })}
                    className="accent-cyan-400"
                  />
                  <span className="font-mono text-[10px] text-white/70">Auto-scroll to load more</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-white/35">Scroll attempts</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    disabled={!automate.autoScrollComments}
                    value={automate.scrollAttempts}
                    onChange={(e) => patchAutomate({ scrollAttempts: clampNum(Number(e.target.value), 1, 10) })}
                    className="bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none disabled:opacity-40"
                    style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: 'rgba(34,211,238,0.12)' }}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleRun}
                className="flex-1 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.35em]"
                style={{
                  background: running ? 'rgba(255,80,80,0.15)' : `${ACCENT}22`,
                  border: `1px solid ${running ? '#ff6b6b' : ACCENT}`,
                  color: running ? '#ff6b6b' : ACCENT,
                  boxShadow: running ? '0 0 18px rgba(255,80,80,0.25)' : `0 0 18px ${ACCENT}33`,
                }}
              >
                {running ? 'Stop' : 'Start'}
              </button>
              <button
                type="button"
                onClick={() => { setAutoApprove((v) => !v); sfx('click', 0.25); }}
                className="px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.2em] shrink-0"
                style={{
                  border: `1px solid ${autoApprove ? '#34d399' : 'rgba(255,255,255,0.18)'}`,
                  color: autoApprove ? '#34d399' : 'rgba(255,255,255,0.45)',
                  background: autoApprove ? 'rgba(52,211,153,0.1)' : 'transparent',
                }}
              >
                Auto {autoApprove ? 'On' : 'Off'}
              </button>
            </div>
            {(queue.length > 1 || cooling || sentCount > 0) && (
              <div className="mt-2 font-mono text-[8px] uppercase tracking-wider text-white/30">
                {cooling
                  ? `Cooling ${coolLeftSec}s…`
                  : queue.length > 1
                    ? `${queue.length - 1} more in queue`
                    : null}
                {automate.commentCap > 0 ? ` · ${sentCount}/${automate.commentCap} sent` : sentCount > 0 ? ` · ${sentCount} sent` : ''}
              </div>
            )}
          </div>

          {/* Clearance so compact Jarvis orb (bottom-right) does not cover Start/Auto */}
          <div className="h-36 shrink-0 pointer-events-none" aria-hidden />
        </div>
      </div>

      <AnimatePresence>
        {active && !autoApprove && (
          <motion.div
            key="approve-layer"
            className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
            style={{ background: 'rgba(2,8,20,0.55)', backdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ApprovalCard
              item={active}
              autoApprove={autoApprove}
              onSend={() => {
                void (async () => {
                  sfx('select_confirm', 0.5);
                  const result = await sendReply(active);
                  if (result.ok) {
                    markSeen(active.platform, active.commentKey, active.author, active.comment);
                    notify('Sent', `Reply posted on ${active.platform}.`, 'success', 3500);
                    setQueue((q) => q.filter((x) => x.id !== active.id));
                    if (runningRef.current) {
                      await waitInterCommentDelay();
                      if (runningRef.current) void scanOnce();
                    }
                  } else if (result.alreadyReplied) {
                    // already removed + marked seen in sendReply
                  } else {
                    seenIds.current.delete(`${active.platform}:${active.commentKey}`);
                  }
                })();
              }}
              onSkip={() => {
                sfx('click', 0.3);
                markSeen(active.platform, active.commentKey, active.author, active.comment);
                setQueue((q) => q.filter((x) => x.id !== active.id));
              }}
              onStop={stopBot}
              onRegen={() => {
                void (async () => {
                  sfx('select', 0.35);
                  setQueue((q) => q.map((x) => (x.id === active.id ? { ...x, status: 'generating', reply: '' } : x)));
                  const next = await generateReply({ ...active, status: 'generating', reply: '' });
                  setQueue((q) => q.map((x) => (x.id === active.id ? next : x)));
                })();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
