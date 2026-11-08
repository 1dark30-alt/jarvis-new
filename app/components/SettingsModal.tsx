'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FUNCTION_REGISTRY, JarvisFunction } from '../lib/functions';
import { sfx } from '../lib/sfx';
import { hashPin, verifyPin } from '../lib/pin';
import type { BreezeSettings } from '../lib/breeze-speech';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: JarvisSettings) => void;
  initialSettings: JarvisSettings;
  dynamicFunctions?: JarvisFunction[];
}

export type JarvisTheme = 'arc-reactor' | 'midnight' | 'crimson' | 'matrix' | 'custom';
export type JarvisGrid = 'off' | 'small' | 'medium' | 'large';
export type JarvisVisualizer = 'frequency-ring' | 'arc-reactor' | 'sphere-nodes' | 'quarter-rings' | 'original';
export type JarvisLogo = 'logo' | 'logo2';
export type JarvisPosition = 'center' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

export type RealtimeModel = 'gpt-realtime-2' | 'gpt-realtime-1.5' | 'gpt-realtime-mini';
export type LocalLlmProvider = 'ollama' | 'olares' | 'olares-shared';

export interface JarvisSettings extends BreezeSettings {
  apiMode: 'openai' | 'elevenlabs' | 'local' | 'gemini';
  apiKey: string;
  /** Gemini API key — drives the Gemini Live voice engine and the server-side
   *  text ladder (Mark 58's fallback ladder). Blank = server brain uses the
   *  configured local model instead. */
  geminiApiKey?: string;
  /** Optional OpenAI-compatible provider tried before/after the Gemini rungs
   *  (Mark 58's "prov:" rungs). */
  geminiProviderUrl?: string;
  geminiProviderKey?: string;
  geminiProviderFirst?: boolean;
  /** Plaid — bank connections for the Finance screen. */
  plaidClientId?: string;
  plaidSecret?: string;
  plaidEnv?: 'sandbox' | 'development' | 'production';
  realtimeModel?: RealtimeModel;
  localLlmUrl?: string;
  localLlmModel?: string;
  localLlmProvider?: LocalLlmProvider;
  localLlmApiKey?: string;
  elevenLabsAgentId?: string;
  elevenLabsFirstMessage?: string;
  /** ElevenLabs xi-api-key — required for TTS / MP3 export in Audio Lab */
  elevenLabsApiKey?: string;
  voice: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';
  initialPrompt: string;
  enabledFunctions: string[];
  wakeWordEnabled?: boolean;
  wakeWordSensitivity?: number;  // 0.0 to 1.0, default 0.5
  theme: JarvisTheme;
  grid: JarvisGrid;
  visualizer: JarvisVisualizer;
  logo: JarvisLogo;
  position: JarvisPosition;
  /** Full path to shell (cmd.exe, PowerShell, /bin/zsh). Empty = auto-detect. */
  shellPathOverride?: string;
  /** Full path to python.exe for Computer Use. Empty = bundled binary or PATH. */
  pythonPathOverride?: string;
  /** Lock screen (Settings → Security) */
  lockEnabled?: boolean;
  /** Salted hash of the 4-digit PIN — never the raw PIN */
  lockPinHash?: string;
  /** Auto-lock after N minutes of inactivity. 0 = never. */
  lockAutoMinutes?: number;
  /** Enter ambient standby after N idle minutes. 0 = never. */
  ambientAutoMinutes?: number;
  /** Accent hex color used when theme === 'custom' */
  customAccent?: string;
  /** Skip the homescreen startup intro animation */
  disableIntroAnimation?: boolean;
}

const VISUALIZERS: { id: JarvisVisualizer; name: string; desc: string }[] = [
  { id: 'frequency-ring', name: 'Frequency Ring', desc: 'FFT bars radiating from the logo rings' },
  { id: 'arc-reactor',    name: 'Arc Reactor',    desc: 'Polar wave + segmented reactor rings' },
  {
    id: 'sphere-nodes',
    name: 'Sphere Nodes',
    desc: '3D orbiting nodes + FFT glitch; logo built from particles',
  },
  {
    id: 'quarter-rings',
    name: 'Quarter Rings',
    desc: 'Sporadic quarter-arc rings orbiting the logo with oscillating spin',
  },
  {
    id: 'original',
    name: 'Original',
    desc: 'Multi-layer HUD — tick rings, bump-outs, slot rings, yellow pendulum arc, sweep hand',
  },
];

const LOGOS: { id: JarvisLogo; name: string; src: string }[] = [
  { id: 'logo',  name: 'Classic',  src: '/assets/logo.png'  },
  { id: 'logo2', name: 'Variant',  src: '/assets/logo2.png' },
];

const POSITIONS: { id: JarvisPosition; label: string; icon: string }[] = [
  { id: 'top-left',     label: 'Top Left',     icon: '↖' },
  { id: 'top-right',    label: 'Top Right',    icon: '↗' },
  { id: 'center',       label: 'Center',       icon: '⊙' },
  { id: 'bottom-left',  label: 'Bottom Left',  icon: '↙' },
  { id: 'bottom-right', label: 'Bottom Right', icon: '↘' },
];

type Tab = 'jarvis' | 'abilities' | 'ui' | 'security' | 'system';

const THEMES: { id: JarvisTheme; name: string; accent: string; glow: string }[] = [
  { id: 'arc-reactor', name: 'Arc Reactor', accent: '#22d3ee', glow: 'rgba(34,211,238,0.4)' },
  { id: 'midnight',    name: 'Midnight',    accent: '#a855f7', glow: 'rgba(168,85,247,0.4)'  },
  { id: 'crimson',     name: 'Crimson',     accent: '#ef4444', glow: 'rgba(239,68,68,0.4)'   },
  { id: 'matrix',      name: 'Matrix',      accent: '#22c55e', glow: 'rgba(34,197,94,0.4)'   },
  { id: 'custom',      name: 'Custom',      accent: '#f59e0b', glow: 'rgba(245,158,11,0.4)'  },
];

const GRID_OPTIONS: { id: JarvisGrid; label: string }[] = [
  { id: 'off',    label: 'Off'    },
  { id: 'small',  label: 'Small'  },
  { id: 'medium', label: 'Medium' },
  { id: 'large',  label: 'Large'  },
];

export function SettingsModal({ isOpen, onClose, onSave, initialSettings, dynamicFunctions = [] }: SettingsModalProps) {
  const [settings, setSettings] = useState<JarvisSettings>(initialSettings);
  const [activeTab, setActiveTab] = useState<Tab>('jarvis');
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagOutput, setDiagOutput] = useState<string | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  // PIN entry fields for Settings → Security
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinMessage, setPinMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSettings(initialSettings);
      setActiveTab('jarvis');
      setDiagOutput(null);
      setDiagError(null);
      setPinCurrent('');
      setPinNew('');
      setPinConfirm('');
      setPinMessage(null);
    }
  }, [isOpen, initialSettings]);

  function applyPin() {
    const hasExisting = !!settings.lockPinHash;
    if (hasExisting && !verifyPin(pinCurrent, settings.lockPinHash)) {
      sfx('error', 0.5);
      setPinMessage({ ok: false, text: 'Current PIN is incorrect.' });
      return;
    }
    if (!/^\d{4}$/.test(pinNew)) {
      sfx('error', 0.5);
      setPinMessage({ ok: false, text: 'PIN must be exactly 4 digits.' });
      return;
    }
    if (pinNew !== pinConfirm) {
      sfx('error', 0.5);
      setPinMessage({ ok: false, text: 'PINs do not match.' });
      return;
    }
    sfx('select_confirm', 0.6);
    setSettings({ ...settings, lockPinHash: hashPin(pinNew) });
    setPinCurrent('');
    setPinNew('');
    setPinConfirm('');
    setPinMessage({ ok: true, text: hasExisting ? 'PIN updated. Save configuration to apply.' : 'PIN set. Save configuration to apply.' });
  }

  async function runDiagnostics() {
    sfx('click_sfx', 0.5);
    setDiagLoading(true);
    setDiagError(null);
    setDiagOutput(null);
    try {
      const res = await fetch('/api/system-diagnostics');
      if (!res.ok) {
        setDiagError(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setDiagOutput(JSON.stringify(data, null, 2));
    } catch (e) {
      setDiagError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiagLoading(false);
    }
  }

  if (!isOpen) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'jarvis',    label: 'Jarvis'     },
    { id: 'abilities', label: 'Abilities'  },
    { id: 'ui',        label: 'UI'         },
    { id: 'security',  label: 'Security'   },
    { id: 'system',    label: 'System'     },
  ];

  const panelMaxWidth = activeTab === 'system' ? 'max-w-2xl' : 'max-w-md';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className={`w-full ${panelMaxWidth} bg-black/90 border border-cyan-500/50 rounded-lg shadow-[0_0_30px_rgba(34,211,238,0.2)] overflow-hidden`}
        style={{ boxShadow: `0 0 30px var(--accent-glow)` }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-cyan-500/30 bg-cyan-950/30 flex items-center justify-between">
          <h2 className="text-xl font-bold text-cyan-400 tracking-wider">SYSTEM CONFIGURATION</h2>
          <button onClick={onClose} className="text-cyan-500 hover:text-cyan-300">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-cyan-500/20 bg-cyan-950/10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { sfx('switch_interface', 0.5, 2); setActiveTab(tab.id); }}
              className={`flex-1 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'text-cyan-300 border-b-2 border-cyan-400 bg-cyan-950/30'
                  : 'text-cyan-600 hover:text-cyan-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={`p-6 space-y-6 overflow-y-auto ${activeTab === 'system' ? 'max-h-[65vh]' : 'max-h-[55vh]'}`}>

          {/* Jarvis Tab */}
          {activeTab === 'jarvis' && (
            <>
              {/* API Mode switcher */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Engine</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['openai', 'elevenlabs', 'gemini', 'local'] as const).map((mode) => {
                    const active = (settings.apiMode ?? 'openai') === mode;
                    const labels = { openai: 'OpenAI Realtime', elevenlabs: 'ElevenLabs', gemini: 'Gemini Live', local: 'Local voice' };
                    const descs  = { openai: 'GPT Realtime 2 via WebRTC', elevenlabs: 'Jarvis Agent via WebRTC', gemini: 'Gemini Live voice — the Mark 58 engine', local: 'Whisper + local LLM + Breeze' };
                    return (
                      <button
                        key={mode}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, apiMode: mode, ...(mode === 'local' ? { ttsProvider: 'olares' as const } : {}) }); }}
                        className={`flex flex-col items-start px-3 py-2.5 border rounded text-left transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                        }`}
                      >
                        <span className={`text-xs font-bold uppercase tracking-wide ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                          {labels[mode]}
                        </span>
                        <span className="text-[10px] text-white/30 mt-0.5">{descs[mode]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-cyan-500/10">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest" htmlFor="tts-provider">Speech Output</label>
                <select id="tts-provider" value={settings.ttsProvider ?? 'native'} onChange={e => setSettings({ ...settings, ttsProvider: e.target.value as 'native' | 'olares' })} className="w-full bg-black border border-cyan-500/30 rounded px-3 py-2 text-cyan-100">
                  <option value="native">Voice engine default</option>
                  <option value="olares">Breeze TTS · Olares Router</option>
                </select>
                {settings.ttsProvider === 'olares' && <>
                  <p className="text-xs text-cyan-600">Local voice uses Whisper on this PC, your Local Model Service for replies, and Breeze for speech. Speak, then pause for a reply; the microphone pauses while Jarvis thinks and speaks. App tools and photo input are currently available in the other voice engines.</p>
                  {([
                    ['ttsRouterUrl', 'Router Base URL', 'https://router.your-domain.olares.com/v1'],
                    ['ttsRouterApiKey', 'Router API key', 'Leave blank to reuse your Olares Local Model Service key'],
                    ['ttsModel', 'Speech model', 'default-tts'],
                    ['ttsVoice', 'Voice (default: English male)', 'en-m'],
                  ] as const).map(([key, label, placeholder]) => <label key={key} className="block text-xs text-cyan-600">{label}
                    <input type={key === 'ttsRouterApiKey' ? 'password' : 'text'} value={settings[key] ?? ''} placeholder={placeholder} onChange={e => setSettings({ ...settings, [key]: e.target.value })} className="mt-1 w-full bg-black/40 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100" />
                  </label>)}
                  <p className="text-xs text-cyan-700">Choose Breeze as Router’s default TTS model to use default-tts, or paste its exact model name. Voices include en-m, en-f, zh-m, zh-f, and saved voice IDs. Blank connection fields reuse Olares Local Model Service settings. Test speech in Audio Lab.</p>
                </>}
              </div>

              {/* Wake Word Configuration */}
              <div className="space-y-3 pt-2 border-t border-cyan-500/10">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Wake Word</label>
                  <button
                    onClick={() => {
                      const next = !settings.wakeWordEnabled;
                      sfx('switch_interface', 0.5, 2);
                      setSettings({ ...settings, wakeWordEnabled: next });
                    }}
                    className={`relative w-10 h-5 rounded-full transition-all ${
                      settings.wakeWordEnabled ? 'bg-cyan-500' : 'bg-cyan-900/50 border border-cyan-500/30'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        settings.wakeWordEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[10px] text-cyan-700 leading-tight">
                  When enabled, saying &quot;Jarvis&quot; will activate the assistant using local wake word detection.
                </p>
                
                {settings.wakeWordEnabled && (
                  <div className="space-y-3 pl-2 border-l border-cyan-500/20">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-cyan-600 uppercase tracking-widest">
                        Sensitivity: {settings.wakeWordSensitivity?.toFixed(2) ?? '0.50'}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={settings.wakeWordSensitivity ?? 0.5}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setSettings({ ...settings, wakeWordSensitivity: val });
                        }}
                        className="w-full accent-cyan-500"
                      />
                      <div className="flex justify-between text-[10px] text-cyan-700">
                        <span>Less sensitive</span>
                        <span>More sensitive</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Gemini Live fields */}
              {(settings.apiMode ?? 'openai') === 'gemini' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Gemini API Key</label>
                  <input
                    type="password"
                    value={settings.geminiApiKey ?? ''}
                    onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
                    placeholder="AIza..."
                    className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                  />
                  <p className="text-[10px] text-cyan-700 leading-tight">
                    Streams live voice through Gemini (Mark 58&apos;s voice engine) with all your Jarvis tools.
                    The same key powers the server-side text ladder for missions and background work.
                  </p>
                </div>
              )}

              {/* Plaid — bank connections (Finance screen) */}
              <div className="space-y-2 pt-2 border-t border-cyan-500/10">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Plaid · Banking (Finance screen)</label>
                <input
                  type="text"
                  value={settings.plaidClientId ?? ''}
                  onChange={(e) => setSettings({ ...settings, plaidClientId: e.target.value })}
                  placeholder="Plaid client_id (from dashboard.plaid.com)"
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 font-mono text-sm"
                />
                <input
                  type="password"
                  value={settings.plaidSecret ?? ''}
                  onChange={(e) => setSettings({ ...settings, plaidSecret: e.target.value })}
                  placeholder="Plaid secret"
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 font-mono text-sm"
                />
                <select
                  value={settings.plaidEnv ?? 'sandbox'}
                  onChange={(e) => setSettings({ ...settings, plaidEnv: e.target.value as 'sandbox' | 'development' | 'production' })}
                  className="w-full bg-black border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 text-sm"
                >
                  <option value="sandbox">Sandbox (fake banks — test the flow)</option>
                  <option value="development">Development (real banks, limited)</option>
                  <option value="production">Production (real banks, full access)</option>
                </select>
                <p className="text-[10px] text-cyan-700 leading-tight">
                  Connect each bank on the Finance screen and label it business or personal.
                  Google Pay purchases show up automatically — they post to the underlying bank card.
                </p>
              </div>

              {/* Gemini text ladder — server brain (independent of voice mode) */}
              <div className="space-y-2 pt-2 border-t border-cyan-500/10">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Gemini Text Ladder (server brain)</label>
                <input
                  type="password"
                  value={settings.geminiApiKey ?? ''}
                  onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
                  placeholder="Gemini API key (optional — missions then run on the ladder)"
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 font-mono text-sm"
                />
                <input
                  type="text"
                  value={settings.geminiProviderUrl ?? ''}
                  onChange={(e) => setSettings({ ...settings, geminiProviderUrl: e.target.value })}
                  placeholder="Optional OpenAI-compatible provider URL (https://…/v1)"
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 font-mono text-sm"
                />
                <div className="flex items-center gap-3">
                  <input
                    type="password"
                    value={settings.geminiProviderKey ?? ''}
                    onChange={(e) => setSettings({ ...settings, geminiProviderKey: e.target.value })}
                    placeholder="Provider API key"
                    className="flex-1 bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 font-mono text-sm"
                  />
                  <label className="flex items-center gap-2 text-[10px] text-cyan-600 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={settings.geminiProviderFirst ?? false}
                      onChange={(e) => setSettings({ ...settings, geminiProviderFirst: e.target.checked })}
                      className="accent-cyan-500"
                    />
                    Provider first
                  </label>
                </div>
                <p className="text-[10px] text-cyan-700 leading-tight">
                  Missions and background agents call this ladder first (fast lite models, then heavier
                  ones; a rung out of quota steps aside for a while). Blank key = they run on your local
                  model below. The provider URL (Mark 58&apos;s "prov:" rungs) rides before or after the
                  Gemini models per the toggle.
                </p>
              </div>

              {/* OpenAI fields */}
              {(settings.apiMode ?? 'openai') === 'openai' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">OpenAI API Key</label>
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                  />
                </div>
              )}

              {(settings.apiMode ?? 'openai') === 'openai' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Realtime Model</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: 'gpt-realtime-2',    label: 'Realtime 2',    desc: 'Reasoning' },
                      { id: 'gpt-realtime-1.5',  label: 'Realtime 1.5',  desc: 'Best voice' },
                      { id: 'gpt-realtime-mini', label: 'Realtime Mini', desc: 'Cost-efficient' },
                    ] as { id: RealtimeModel; label: string; desc: string }[]).map((m) => {
                      const active = (settings.realtimeModel ?? 'gpt-realtime-2') === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => { sfx('select', 0.5); setSettings({ ...settings, realtimeModel: m.id }); }}
                          className={`flex flex-col items-center px-2 py-2 border rounded text-xs transition-all ${
                            active
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                              : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                          }`}
                        >
                          <span className="font-bold uppercase tracking-wide">{m.label}</span>
                          <span className="text-[10px] opacity-70 mt-0.5">{m.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ElevenLabs fields */}
              {(settings.apiMode ?? 'openai') === 'elevenlabs' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Agent ID</label>
                    <input
                      type="text"
                      value={settings.elevenLabsAgentId ?? ''}
                      onChange={(e) => setSettings({ ...settings, elevenLabsAgentId: e.target.value })}
                      placeholder="agent_..."
                      className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                    />
                    <p className="text-xs text-cyan-700">Found in your ElevenLabs agent dashboard.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
                      API Key <span className="text-cyan-700 normal-case font-normal">(for Audio Lab TTS / MP3)</span>
                    </label>
                    <input
                      type="password"
                      value={settings.elevenLabsApiKey ?? ''}
                      onChange={(e) => setSettings({ ...settings, elevenLabsApiKey: e.target.value })}
                      placeholder="xi-..."
                      className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                    />
                    <p className="text-xs text-cyan-700">
                      Required to generate downloadable speech from your agent&apos;s voice. Live conversation still works with Agent ID alone.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">First Message <span className="text-cyan-700 normal-case font-normal">(optional override)</span></label>
                    <input
                      type="text"
                      value={settings.elevenLabsFirstMessage ?? ''}
                      onChange={(e) => setSettings({ ...settings, elevenLabsFirstMessage: e.target.value })}
                      placeholder="Good evening, sir. All systems online."
                      className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm"
                    />
                    <p className="text-xs text-cyan-700">Leave empty to use the agent&apos;s default greeting.</p>
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-3 border-t border-cyan-500/20">
                <div>
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Local LLM Chat</label>
                  <p className="text-[10px] text-cyan-700 mt-1">Connect to Ollama, Olares Router, or an Olares shared model endpoint. Used for Local Chat and the Local voice engine.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-cyan-600 uppercase tracking-widest">Local Model Service</label>
                  <select
                    value={settings.localLlmProvider ?? 'ollama'}
                    onChange={(e) => {
                      const provider = e.target.value as LocalLlmProvider;
                      const previousProvider = settings.localLlmProvider ?? 'ollama';
                      setSettings({
                        ...settings,
                        localLlmProvider: provider,
                        localLlmUrl: previousProvider === provider ? settings.localLlmUrl : (provider === 'ollama' ? 'http://127.0.0.1:11434' : provider === 'olares-shared' ? 'http://3a77b15d.shared.olares.com/v1' : ''),
                        localLlmModel: previousProvider === provider ? settings.localLlmModel : '',
                      });
                    }}
                    className="w-full bg-cyan-950/50 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 text-sm focus:outline-none focus:border-cyan-400"
                  >
                    <option value="ollama">Ollama on this computer</option>
                    <option value="olares">Olares Router</option>
                    <option value="olares-shared">Olares shared model endpoint</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-cyan-600 uppercase tracking-widest">{settings.localLlmProvider === 'olares' ? 'Olares Router Base URL' : settings.localLlmProvider === 'olares-shared' ? 'Olares shared endpoint' : 'Ollama Address'}</label>
                  <input
                    type="text"
                    value={settings.localLlmUrl ?? (settings.localLlmProvider === 'olares' ? '' : settings.localLlmProvider === 'olares-shared' ? 'http://3a77b15d.shared.olares.com/v1' : 'http://127.0.0.1:11434')}
                    onChange={(e) => setSettings({ ...settings, localLlmUrl: e.target.value })}
                    placeholder={settings.localLlmProvider === 'olares' ? 'https://router.<your-olares-domain>/v1' : settings.localLlmProvider === 'olares-shared' ? 'http://<route-id>.shared.olares.com/v1' : 'http://127.0.0.1:11434'}
                    className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
                  />
                </div>
                {settings.localLlmProvider === 'olares' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyan-600 uppercase tracking-widest">Olares Router API Key</label>
                    <input
                      type="password"
                      value={settings.localLlmApiKey ?? ''}
                      onChange={(e) => setSettings({ ...settings, localLlmApiKey: e.target.value })}
                      placeholder="Create a key in Router → API keys"
                      autoComplete="new-password"
                      className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
                    />
                    <p className="text-[10px] text-cyan-700">Choose the Devices in LAN Base URL in Router. On the same LAN, enable LarePass Host mappings or local DNS so the URL resolves to Olares locally. Set Router&apos;s default chat model to local before using <code>default-chat</code>.</p>
                  </div>
                )}
                {settings.localLlmProvider === 'olares-shared' && <p className="text-[10px] text-cyan-700">Shared endpoints use an OpenAI-compatible API. This PC must be able to resolve and reach the Olares shared hostname.</p>}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-cyan-600 uppercase tracking-widest">Model Name</label>
                  <input
                    type="text"
                    value={settings.localLlmModel ?? ''}
                    onChange={(e) => setSettings({ ...settings, localLlmModel: e.target.value })}
                    placeholder="For example: llama3.2"
                    className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm"
                  />
                </div>
                <a
                  href="/local-chat"
                  className="inline-flex px-3 py-2 border border-cyan-500/40 rounded text-cyan-300 text-xs font-bold uppercase tracking-wider hover:bg-cyan-500/10"
                >
                  Open Local Chat →
                </a>
              </div>

              {/* Voice Interface — OpenAI only */}
              {(settings.apiMode ?? 'openai') === 'openai' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Interface</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const).map((voice) => (
                      <button
                        key={voice}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, voice }); }}
                        className={`px-3 py-2 border rounded text-sm uppercase tracking-wide transition-all ${
                          settings.voice === voice
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                        }`}
                      >
                        {voice}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Visualizer</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {VISUALIZERS.map((v) => {
                    const active = settings.visualizer === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, visualizer: v.id }); }}
                        className={`flex flex-col items-start px-3 py-2.5 border rounded text-left transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                        }`}
                      >
                        <span className={`text-xs font-bold uppercase tracking-wide ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                          {v.name}
                        </span>
                        <span className="text-[10px] text-white/30 mt-0.5 leading-tight">{v.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Center Logo</label>
                <div className="grid grid-cols-2 gap-2">
                  {LOGOS.map((l) => {
                    const active = (settings.logo ?? 'logo') === l.id;
                    return (
                      <button
                        key={l.id}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, logo: l.id }); }}
                        className={`flex flex-col items-center gap-2 px-3 py-3 border rounded transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={l.src} alt={l.name} className="w-24 h-24 object-contain opacity-90" />
                        <span className={`text-xs font-bold uppercase tracking-wide ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                          {l.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Position</label>
                <div className="grid grid-cols-3 gap-2">
                  {POSITIONS.map((p) => {
                    const active = (settings.position ?? 'center') === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, position: p.id }); }}
                        className={`flex flex-col items-center gap-1 px-2 py-2.5 border rounded transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                        } ${p.id === 'center' ? 'col-start-2' : ''}`}
                      >
                        <span className={`text-base leading-none ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>{p.icon}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wide leading-tight text-center ${active ? 'text-cyan-300' : 'text-cyan-600'}`}>
                          {p.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Initial Protocol (Prompt)</label>
                <textarea
                  value={settings.initialPrompt}
                  onChange={(e) => setSettings({ ...settings, initialPrompt: e.target.value })}
                  rows={4}
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.3)] transition-all font-mono text-sm resize-none"
                />
              </div>
            </>
          )}

          {/* Abilities Tab */}
          {activeTab === 'abilities' && (
            <div className="space-y-3">
              <p className="text-xs text-cyan-600">
                Enable modules to give Jarvis access to real-time data and actions.
              </p>
              <div className="space-y-2">
                {FUNCTION_REGISTRY.map((fn) => {
                  const enabled = settings.enabledFunctions.includes(fn.name);
                  return (
                    <div
                      key={fn.name}
                      className="flex items-center justify-between px-4 py-3 rounded border border-cyan-500/20 bg-cyan-950/10"
                    >
                      <div>
                        <p className="text-sm text-cyan-300 font-semibold">{fn.label}</p>
                        <p className="text-xs text-cyan-600 mt-0.5">{fn.description}</p>
                      </div>
                      <button
                        onClick={() => {
                          sfx('click_sfx', 0.5);
                          setSettings({
                            ...settings,
                            enabledFunctions: enabled
                              ? settings.enabledFunctions.filter((n) => n !== fn.name)
                              : [...settings.enabledFunctions, fn.name],
                          });
                        }}
                        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ml-4 ${
                          enabled ? 'bg-cyan-500' : 'bg-cyan-900/60'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>

              {dynamicFunctions.length > 0 && (
                <>
                  <div className="mt-4 mb-2 border-t border-cyan-500/20 pt-4">
                    <p className="text-xs font-bold text-cyan-500 uppercase tracking-widest">MCP &amp; Skills</p>
                    <p className="text-[10px] text-cyan-700 mt-1">External tools loaded from configuration.</p>
                  </div>
                  {dynamicFunctions.map((fn) => {
                    const enabled = settings.enabledFunctions.includes(fn.name);
                    const isMcp = fn.description.includes('MCP');
                    return (
                      <div key={fn.name} className="flex items-center justify-between px-4 py-3 rounded border border-cyan-500/20 bg-cyan-950/10">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-cyan-300 font-semibold">{fn.label}</p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-500 border border-cyan-500/30 uppercase font-mono">
                              {isMcp ? 'MCP' : 'Skill'}
                            </span>
                          </div>
                          <p className="text-xs text-cyan-600 mt-0.5 truncate">{fn.description}</p>
                        </div>
                        <button
                          onClick={() => {
                            sfx('click_sfx', 0.5);
                            setSettings({
                              ...settings,
                              enabledFunctions: enabled
                                ? settings.enabledFunctions.filter((n) => n !== fn.name)
                                : [...settings.enabledFunctions, fn.name],
                            });
                          }}
                          className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ml-4 ${
                            enabled ? 'bg-cyan-500' : 'bg-cyan-900/60'
                          }`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* Security — lock screen + PIN */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              {/* Enable toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Lock Screen</label>
                  <button
                    onClick={() => {
                      if (!settings.lockPinHash && !settings.lockEnabled) {
                        sfx('error', 0.4);
                        setPinMessage({ ok: false, text: 'Set a PIN below before enabling the lock.' });
                        return;
                      }
                      sfx('switch_interface', 0.5, 2);
                      setSettings({ ...settings, lockEnabled: !settings.lockEnabled });
                    }}
                    className={`relative w-10 h-5 rounded-full transition-all ${
                      settings.lockEnabled ? 'bg-cyan-500' : 'bg-cyan-900/50 border border-cyan-500/30'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        settings.lockEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[10px] text-cyan-700 leading-tight">
                  A futuristic PIN lock — drag the floating number bubbles into the reactor ring to unlock.
                  Jarvis can lock the interface by voice (&quot;lock it down&quot;) via the Lock Interface ability, but
                  unlocking always requires the PIN on screen.
                </p>
              </div>

              {/* PIN set / reset */}
              <div className="space-y-3 pt-2 border-t border-cyan-500/10">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
                  {settings.lockPinHash ? 'Reset PIN' : 'Set PIN'}
                </label>
                {settings.lockPinHash && (
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinCurrent}
                    onChange={(e) => setPinCurrent(e.target.value.replace(/\D/g, ''))}
                    placeholder="Current PIN"
                    className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm tracking-[0.5em]"
                  />
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinNew}
                    onChange={(e) => setPinNew(e.target.value.replace(/\D/g, ''))}
                    placeholder="New 4-digit PIN"
                    className="bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm tracking-[0.5em]"
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinConfirm}
                    onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
                    placeholder="Confirm PIN"
                    className="bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm tracking-[0.5em]"
                  />
                </div>
                <button
                  onClick={applyPin}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
                >
                  {settings.lockPinHash ? 'Update PIN' : 'Set PIN'}
                </button>
                {pinMessage && (
                  <p className={`text-xs font-mono ${pinMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>{pinMessage.text}</p>
                )}
              </div>

              {/* Auto-lock */}
              <div className="space-y-2 pt-2 border-t border-cyan-500/10">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
                  Auto-lock after inactivity
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[0, 1, 5, 15, 30].map((m) => {
                    const active = (settings.lockAutoMinutes ?? 0) === m;
                    return (
                      <button
                        key={m}
                        onClick={() => { sfx('click_sfx', 0.4); setSettings({ ...settings, lockAutoMinutes: m }); }}
                        className={`px-2 py-2 border rounded text-xs uppercase tracking-wide transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                            : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50'
                        }`}
                      >
                        {m === 0 ? 'Off' : `${m}m`}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-cyan-700">Requires the lock screen to be enabled with a PIN.</p>
              </div>
            </div>
          )}

          {/* System — terminal & computer use diagnostics / overrides */}
          {activeTab === 'system' && (
            <div className="space-y-5">
              <p className="text-xs text-cyan-600 leading-relaxed">
                Jarvis usually detects your shell and Python automatically. Use overrides only if Terminal or Computer Use
                fail after a restart. Run diagnostics and share the JSON if you need support.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
                  Shell path override
                </label>
                <input
                  type="text"
                  value={settings.shellPathOverride ?? ''}
                  onChange={(e) => setSettings({ ...settings, shellPathOverride: e.target.value })}
                  placeholder="Auto — e.g. C:\Windows\System32\cmd.exe or /bin/zsh"
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-xs"
                />
                <p className="text-[10px] text-cyan-700">
                  Windows: <span className="text-cyan-500">cmd.exe</span> or <span className="text-cyan-500">powershell.exe</span>.
                  macOS: e.g. <span className="text-cyan-500">/bin/zsh</span>. Leave empty for default.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">
                  Python for Computer Use
                </label>
                <input
                  type="text"
                  value={settings.pythonPathOverride ?? ''}
                  onChange={(e) => setSettings({ ...settings, pythonPathOverride: e.target.value })}
                  placeholder="Auto — e.g. C:\Users\you\AppData\Local\Programs\Python\Python312\python.exe"
                  className="w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-xs"
                />
                <p className="text-[10px] text-cyan-700">
                  Forces <span className="text-cyan-500">computer_use.py</span> to run with this interpreter. Overrides the bundled
                  helper binary if set (useful for debugging). Leave empty when the bundled <span className="text-cyan-500">.exe</span> works.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void runDiagnostics()}
                  disabled={diagLoading}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  {diagLoading ? 'Running…' : 'Run system diagnostics'}
                </button>
                {diagError && (
                  <p className="text-xs text-red-400 font-mono">{diagError}</p>
                )}
                {diagOutput && (
                  <pre className="text-[10px] leading-snug text-cyan-200/90 bg-black/50 border border-cyan-500/20 rounded p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre">
                    {diagOutput}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* UI Tab */}
          {activeTab === 'ui' && (
            <div className="space-y-7">

              {/* Theme */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Theme</label>
                <div className="grid grid-cols-2 gap-3">
                  {THEMES.map((theme) => {
                    const active = settings.theme === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => { sfx('select', 0.5); setSettings({ ...settings, theme: theme.id }); }}
                        className={`relative flex items-center gap-3 px-4 py-3 rounded border transition-all text-left ${
                          active
                            ? 'border-white/30 bg-white/5'
                            : 'border-white/10 bg-transparent hover:border-white/20'
                        }`}
                        style={active ? { boxShadow: `0 0 12px ${theme.glow}` } : {}}
                      >
                        {/* Color swatch */}
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: theme.accent,
                            boxShadow: `0 0 8px ${theme.glow}`,
                          }}
                        />
                        <span className={`text-sm font-semibold tracking-wide ${active ? 'text-white' : 'text-white/50'}`}>
                          {theme.name}
                        </span>
                        {active && (
                          <span className="absolute top-1.5 right-2 text-[10px] text-white/40 font-mono uppercase">
                            Active
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Custom accent picker */}
                {settings.theme === 'custom' && (
                  <div className="flex items-center gap-3 pl-1 pt-1">
                    <input
                      type="color"
                      value={settings.customAccent ?? '#f59e0b'}
                      onChange={(e) => setSettings({ ...settings, customAccent: e.target.value })}
                      className="w-9 h-9 rounded cursor-pointer bg-transparent border border-white/20 p-0.5"
                    />
                    <div>
                      <p className="text-xs text-white/70 font-mono">{(settings.customAccent ?? '#f59e0b').toUpperCase()}</p>
                      <p className="text-[10px] text-cyan-700">Pick any accent color for the interface glow.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Startup intro */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Startup Intro</label>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-white/70">Disable intro animation</p>
                    <p className="text-[10px] text-cyan-700 mt-0.5">
                      Skip the boot sequence on homescreen startup. Takes effect next session.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      sfx('click_sfx', 0.4);
                      setSettings({ ...settings, disableIntroAnimation: !settings.disableIntroAnimation });
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                      settings.disableIntroAnimation
                        ? 'bg-cyan-500'
                        : 'bg-cyan-900/50 border border-cyan-500/30'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                        settings.disableIntroAnimation ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Setup guide replay */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Setup Guide</label>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-white/70">Replay first-run wizard</p>
                    <p className="text-[10px] text-cyan-700 mt-0.5">
                      Walk through voice engine setup, location, and the quick-reference guide again.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      sfx('select', 0.5);
                      onClose();
                      window.dispatchEvent(new Event('jarvis:show-onboarding'));
                    }}
                    className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded text-cyan-300 uppercase tracking-wider font-bold text-xs transition-all shrink-0"
                  >
                    Replay
                  </button>
                </div>
              </div>

              {/* Ambient standby */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Ambient Standby After Idle</label>
                <div className="grid grid-cols-5 gap-2">
                  {[0, 2, 5, 10, 30].map((m) => {
                    const active = (settings.ambientAutoMinutes ?? 0) === m;
                    return (
                      <button
                        key={m}
                        onClick={() => { sfx('click_sfx', 0.4); setSettings({ ...settings, ambientAutoMinutes: m }); }}
                        className={`px-2 py-2 border rounded text-xs uppercase tracking-wide transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                            : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                        }`}
                      >
                        {m === 0 ? 'Off' : `${m}m`}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-cyan-700">
                  After the idle timeout, Jarvis dims to a full-screen standby clock. Any input wakes it.
                </p>
              </div>

              {/* Grid */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Background Grid</label>
                <div className="grid grid-cols-4 gap-2">
                  {GRID_OPTIONS.map((opt) => {
                    const active = settings.grid === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => { sfx('click_sfx', 0.4); setSettings({ ...settings, grid: opt.id }); }}
                        className={`px-3 py-2 border rounded text-xs uppercase tracking-wide transition-all ${
                          active
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                            : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:border-cyan-500/50 hover:text-cyan-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-cyan-500/30 bg-cyan-950/30 flex justify-end gap-3">
          <button
            onClick={() => { sfx('click', 0.5); onClose(); }}
            className="px-4 py-2 text-sm text-cyan-500 hover:text-cyan-300 transition-colors uppercase tracking-wider"
          >
            Cancel
          </button>
          <button
            onClick={() => { sfx('select_confirm', 0.6); onSave(settings); }}
            className="px-6 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded text-cyan-300 uppercase tracking-wider font-bold shadow-[0_0_15px_rgba(34,211,238,0.1)] hover:shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all"
          >
            Save Configuration
          </button>
        </div>
      </motion.div>
    </div>
  );
}
