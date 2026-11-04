'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sfx } from '../lib/sfx';
import { loadServerSettings, saveServerSettings } from '../lib/serverSettings';

const DONE_KEY = 'jarvis_onboarding_done';
export const SHOW_ONBOARDING_EVENT = 'jarvis:show-onboarding';

type Step = 'welcome' | 'engine' | 'location' | 'tour';

/**
 * First-run setup. Shown once when no voice engine is configured — walks
 * through picking OpenAI/ElevenLabs, entering credentials, and setting a
 * weather location, then reloads so the app boots with the new settings.
 * Can also be reopened later via the Settings UI (replay mode).
 */
export function OnboardingWizard() {
  const [visible, setVisible] = useState(false);
  const [replay, setReplay] = useState(false);
  const [step, setStep] = useState<Step>('welcome');
  const [mode, setMode] = useState<'openai' | 'elevenlabs'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [agentId, setAgentId] = useState('');
  const [location, setLocation] = useState('');

  const openWizard = (asReplay: boolean) => {
    try {
      const raw = localStorage.getItem('jarvis_settings');
      if (raw) {
        const s = JSON.parse(raw) as {
          apiMode?: 'openai' | 'elevenlabs';
          apiKey?: string;
          elevenLabsAgentId?: string;
        };
        if (s.apiMode === 'openai' || s.apiMode === 'elevenlabs') setMode(s.apiMode);
        else if (s.elevenLabsAgentId?.trim()) setMode('elevenlabs');
      }
      const loc = localStorage.getItem('jarvis_weather_location');
      if (loc) setLocation(loc);
    } catch { /* leave defaults */ }
    setApiKey('');
    setAgentId('');
    setStep('welcome');
    setReplay(asReplay);
    setVisible(true);
  };

  useEffect(() => {
    (async () => {
      try {
        if (localStorage.getItem(DONE_KEY)) return;
        // Configured already (either locally or via the server settings file)?
        const server = await loadServerSettings();
        const raw = server.jarvis_settings ?? localStorage.getItem('jarvis_settings');
        if (raw) {
          const s = JSON.parse(raw) as { apiKey?: string; elevenLabsAgentId?: string };
          if (s.apiKey?.trim() || s.elevenLabsAgentId?.trim()) {
            localStorage.setItem(DONE_KEY, '1');
            return;
          }
        }
        openWizard(false);
      } catch {
        openWizard(false);
      }
    })();
  }, []);

  useEffect(() => {
    const handler = () => openWizard(true);
    window.addEventListener(SHOW_ONBOARDING_EVENT, handler);
    return () => window.removeEventListener(SHOW_ONBOARDING_EVENT, handler);
  }, []);

  const finish = async (skipped: boolean) => {
    sfx('select_confirm', 0.6);
    localStorage.setItem(DONE_KEY, '1');

    const enteredKey = mode === 'openai' && !!apiKey.trim();
    const enteredAgent = mode === 'elevenlabs' && !!agentId.trim();
    const enteredLocation = !!location.trim();
    const changed = enteredKey || enteredAgent || enteredLocation;

    if (!skipped && (!replay || changed)) {
      try {
        // Merge onto whatever partial settings already exist
        const raw = localStorage.getItem('jarvis_settings');
        const existing = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        const updated = {
          ...existing,
          apiMode: mode,
          ...(enteredKey ? { apiKey: apiKey.trim() } : {}),
          ...(enteredAgent ? { elevenLabsAgentId: agentId.trim() } : {}),
        };
        const serialised = JSON.stringify(updated);
        localStorage.setItem('jarvis_settings', serialised);

        const patch: Record<string, string> = { jarvis_settings: serialised };
        if (enteredLocation) {
          localStorage.setItem('jarvis_weather_location', location.trim());
          patch.jarvis_weather_location = location.trim();
        }
        await saveServerSettings(patch);
      } catch { /* settings modal remains available */ }
    }

    setVisible(false);
    // First-run: reload so JarvisAssistant boots with fresh credentials.
    // Replay: only reload if the user actually entered new values.
    if (!skipped && (!replay || changed)) {
      window.setTimeout(() => window.location.reload(), 250);
    }
  };

  const next = (to: Step) => { sfx('switch_interface', 0.4, 2); setStep(to); };

  if (!visible) return null;

  const inputClass = 'w-full bg-cyan-950/20 border border-cyan-500/30 rounded px-3 py-2 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono text-sm';
  const primaryBtn = 'px-6 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded text-cyan-300 uppercase tracking-wider font-bold text-sm transition-all';
  const ghostBtn = 'px-4 py-2 text-sm text-cyan-600 hover:text-cyan-400 transition-colors uppercase tracking-wider';

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-black/90 border border-cyan-500/50 rounded-lg overflow-hidden"
        style={{ boxShadow: '0 0 40px rgba(34,211,238,0.2)' }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-cyan-500/30 bg-cyan-950/30 flex items-center justify-between">
          <h2 className="text-lg font-bold text-cyan-400 tracking-wider">SYSTEM INITIALIZATION</h2>
          <div className="flex gap-1.5">
            {(['welcome', 'engine', 'location', 'tour'] as Step[]).map((s) => (
              <span key={s} className="w-1.5 h-1.5 rounded-full" style={{ background: s === step ? '#22d3ee' : 'rgba(255,255,255,0.15)' }} />
            ))}
          </div>
        </div>

        <div className="p-6 min-h-[280px]">
          <AnimatePresence mode="wait">
            {step === 'welcome' && (
              <motion.div key="welcome" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <p className="text-cyan-300 font-mono text-sm leading-relaxed">
                  Good evening. I&apos;m Jarvis — your voice-controlled desktop assistant.
                </p>
                <p className="text-white/50 font-mono text-xs leading-relaxed">
                  This one-time setup connects a voice engine and sets your location. Everything can be changed
                  later in Settings. You&apos;ll need either an OpenAI API key or an ElevenLabs agent.
                </p>
                <ul className="text-white/40 font-mono text-xs space-y-1.5 pl-1">
                  <li>· Voice conversations with tool control</li>
                  <li>· HUD widgets — weather, markets, timers, radar, ISS tracking</li>
                  <li>· Smart home, 3D printers, maps, calendar, music</li>
                  <li>· PIN lock screen, layouts, briefings, and more</li>
                </ul>
              </motion.div>
            )}

            {step === 'engine' && (
              <motion.div key="engine" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Voice Engine</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['openai', 'elevenlabs'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { sfx('select', 0.5); setMode(m); }}
                      className={`flex flex-col items-start px-3 py-2.5 border rounded text-left transition-all ${
                        mode === m ? 'bg-cyan-500/20 border-cyan-400' : 'bg-transparent border-cyan-500/20 hover:border-cyan-500/50'
                      }`}
                    >
                      <span className={`text-xs font-bold uppercase ${mode === m ? 'text-cyan-300' : 'text-cyan-600'}`}>
                        {m === 'openai' ? 'OpenAI Realtime' : 'ElevenLabs'}
                      </span>
                      <span className="text-[10px] text-white/30 mt-0.5">
                        {m === 'openai' ? 'GPT Realtime via WebRTC' : 'Conversational agent'}
                      </span>
                    </button>
                  ))}
                </div>
                {mode === 'openai' ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">OpenAI API Key</label>
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className={inputClass} />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">ElevenLabs Agent ID</label>
                    <input type="text" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent_..." className={inputClass} />
                    <p className="text-[10px] text-cyan-700">Import the tool definitions from the elevenlabs-tools folder into your agent.</p>
                  </div>
                )}
              </motion.div>
            )}

            {step === 'location' && (
              <motion.div key="location" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Weather Location</label>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Boston, MA" className={inputClass} />
                <p className="text-[10px] text-cyan-700 leading-relaxed">
                  Used by the weather widgets, radar, and briefings. Leave blank to use browser geolocation instead.
                </p>
              </motion.div>
            )}

            {step === 'tour' && (
              <motion.div key="tour" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <label className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Quick Reference</label>
                {[
                  ['Arc reactor (bottom-left)', 'Radial navigation to every page'],
                  ['⌘K / Ctrl+K', 'Command palette — pages, widgets, actions'],
                  ['Say "Jarvis…"', 'Voice control once connected (wake word optional)'],
                  ['Settings → Security', 'Enable the PIN lock screen'],
                  ['"Morning briefing"', 'Weather, schedule, news, and markets in one go'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-start gap-3 px-3 py-2 rounded border border-cyan-500/15 bg-cyan-950/10">
                    <span className="font-mono text-[11px] text-cyan-300 font-bold w-40 shrink-0">{k}</span>
                    <span className="font-mono text-[11px] text-white/45">{v}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-cyan-500/30 bg-cyan-950/30 flex justify-between">
          <button onClick={() => void finish(true)} className={ghostBtn}>
            {replay ? 'Close' : 'Skip setup'}
          </button>
          <div className="flex gap-3">
            {step === 'welcome'  && <button onClick={() => next('engine')} className={primaryBtn}>Begin</button>}
            {step === 'engine'   && <button onClick={() => next('location')} className={primaryBtn}>Continue</button>}
            {step === 'location' && <button onClick={() => next('tour')} className={primaryBtn}>Continue</button>}
            {step === 'tour'     && <button onClick={() => void finish(false)} className={primaryBtn}>Engage Systems</button>}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
