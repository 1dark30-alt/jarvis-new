'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { saveServerSettings } from '../../lib/serverSettings';

interface Props {
  onComplete: (url: string, token: string) => void;
  onSkip: () => void;
}

const STEPS = ['Connection', 'Access Token', 'Verify'];

const stepVariants = {
  enter:  { opacity: 0, y: 16, filter: 'blur(6px)' },
  center: { opacity: 1, y: 0,  filter: 'blur(0px)' },
  exit:   { opacity: 0, y: -16, filter: 'blur(6px)' },
};

export function HomeAssistantWizard({ onComplete, onSkip }: Props) {
  const [step, setStep]     = useState(0);
  const [url, setUrl]       = useState('');
  const [token, setToken]   = useState('');
  const [testing, setTesting]   = useState(false);
  const [testError, setTestError] = useState('');
  const [deviceCount, setDeviceCount] = useState(0);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => { setStep((s) => Math.max(s - 1, 0)); setTestError(''); };

  const testConnection = async () => {
    setTesting(true);
    setTestError('');
    try {
      const cleanUrl = url.trim().replace(/\/$/, '');
      const res = await fetch(
        `/api/home-assistant?url=${encodeURIComponent(cleanUrl)}&token=${encodeURIComponent(token.trim())}&path=/api/states`
      );
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setTestError(err.error ?? `HTTP ${res.status}`);
        return;
      }
      const states = await res.json() as unknown[];
      setDeviceCount(Array.isArray(states) ? states.length : 0);
      next();
    } catch (e) {
      setTestError(`Could not reach Home Assistant: ${String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const handleComplete = () => {
    const haUrl   = url.trim().replace(/\/$/, '');
    const haToken = token.trim();
    localStorage.setItem('jarvis_ha_url',   haUrl);
    localStorage.setItem('jarvis_ha_token', haToken);
    saveServerSettings({ jarvis_ha_url: haUrl, jarvis_ha_token: haToken });
    onComplete(haUrl, haToken);
  };

  return (
    <motion.div
      className="fixed inset-0 bg-[#050810] z-[60] flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* HUD corners */}
      {['top-0 left-0 border-t-2 border-l-2','top-0 right-0 border-t-2 border-r-2',
        'bottom-0 left-0 border-b-2 border-l-2','bottom-0 right-0 border-b-2 border-r-2'].map((cls, i) => (
        <div key={i} className={`absolute w-8 h-8 ${cls} border-orange-500/20 pointer-events-none z-10 m-3`} />
      ))}

      <div className="w-full max-w-lg px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="text-2xl">🏠</div>
          <div>
            <div className="text-white font-mono text-base font-semibold">Home Assistant Setup</div>
            <div className="text-white/30 text-[10px] font-mono uppercase tracking-widest mt-0.5">
              Connect Jarvis to your smart home
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 ${i <= step ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-mono transition-all
                  ${i < step ? 'bg-orange-500/30 border-orange-500/60 text-orange-300'
                    : i === step ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                    : 'border-white/20 text-white/30'}`}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-[9px] font-mono uppercase tracking-wider hidden sm:block
                  ${i === step ? 'text-orange-300' : 'text-white/30'}`}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-px ${i < step ? 'bg-orange-500/40' : 'bg-white/10'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-7 min-h-[260px] flex flex-col">
          <AnimatePresence mode="wait">

            {/* Step 0 — URL */}
            {step === 0 && (
              <motion.div key="s0" variants={stepVariants} initial="enter" animate="center" exit="exit"
                transition={{ duration: 0.2 }} className="flex flex-col flex-1">
                <div className="text-white font-mono text-sm font-semibold mb-1">Home Assistant URL</div>
                <div className="text-white/40 text-[10px] font-mono mb-5 leading-relaxed">
                  Enter the address of your Home Assistant server. This is usually your local IP or hostname on port 8123.
                </div>

                <div className="space-y-3 mb-5">
                  <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-1.5">
                    <div className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Common formats</div>
                    {['http://homeassistant.local:8123', 'http://192.168.1.100:8123', 'https://your-ha.duckdns.org'].map((ex) => (
                      <button key={ex} onClick={() => setUrl(ex)}
                        className="w-full text-left text-[10px] font-mono text-cyan-400/60 hover:text-cyan-300 transition-colors py-0.5">
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://homeassistant.local:8123"
                  className="w-full h-10 px-3 bg-white/[0.04] border border-white/[0.10] rounded-lg text-[12px] text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-orange-500/50 transition-colors mb-auto"
                />

                <div className="flex justify-between mt-5 pt-4 border-t border-white/[0.05]">
                  <button onClick={onSkip} className="text-[10px] font-mono text-white/25 hover:text-white/50 transition-colors">
                    Skip for now
                  </button>
                  <button
                    onClick={next}
                    disabled={!url.trim()}
                    className="px-5 py-2 text-[10px] font-mono bg-orange-500/15 text-orange-300 border border-orange-500/35 rounded hover:bg-orange-500/25 transition-colors uppercase tracking-wider disabled:opacity-30"
                  >
                    Next →
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 1 — Token */}
            {step === 1 && (
              <motion.div key="s1" variants={stepVariants} initial="enter" animate="center" exit="exit"
                transition={{ duration: 0.2 }} className="flex flex-col flex-1">
                <div className="text-white font-mono text-sm font-semibold mb-1">Long-Lived Access Token</div>
                <div className="text-white/40 text-[10px] font-mono mb-4 leading-relaxed">
                  Create a token in Home Assistant and paste it here. The token is stored locally and only sent to your HA server.
                </div>

                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-1.5 mb-4">
                  <div className="text-[9px] font-mono text-white/40 uppercase tracking-widest mb-2">How to create a token</div>
                  {[
                    ['1', 'Open Home Assistant in your browser'],
                    ['2', 'Click your profile icon (bottom-left)'],
                    ['3', 'Scroll to "Long-Lived Access Tokens"'],
                    ['4', 'Click "Create Token", give it a name'],
                    ['5', 'Copy the token and paste it below'],
                  ].map(([n, t]) => (
                    <div key={n} className="flex gap-2 text-[10px] font-mono text-white/35">
                      <span className="text-orange-400/50 shrink-0">{n}.</span>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>

                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your long-lived access token…"
                  className="w-full h-10 px-3 bg-white/[0.04] border border-white/[0.10] rounded-lg text-[12px] text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-orange-500/50 transition-colors mb-auto"
                />

                {testError && (
                  <div className="mt-3 text-[10px] font-mono text-red-400/80 bg-red-500/[0.08] border border-red-500/20 rounded px-3 py-2">
                    {testError}
                  </div>
                )}

                <div className="flex justify-between mt-5 pt-4 border-t border-white/[0.05]">
                  <button onClick={back} className="text-[10px] font-mono text-white/25 hover:text-white/50 transition-colors">
                    ← Back
                  </button>
                  <button
                    onClick={testConnection}
                    disabled={!token.trim() || testing}
                    className="px-5 py-2 text-[10px] font-mono bg-orange-500/15 text-orange-300 border border-orange-500/35 rounded hover:bg-orange-500/25 transition-colors uppercase tracking-wider disabled:opacity-40"
                  >
                    {testing ? 'Connecting…' : 'Test Connection →'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 2 — Success */}
            {step === 2 && (
              <motion.div key="s2" variants={stepVariants} initial="enter" animate="center" exit="exit"
                transition={{ duration: 0.2 }} className="flex flex-col flex-1 items-center justify-center text-center gap-4">
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-2xl">
                  ✓
                </div>
                <div>
                  <div className="text-white font-mono text-sm font-semibold mb-1">Connected!</div>
                  <div className="text-white/40 text-[10px] font-mono">
                    Found <span className="text-orange-300">{deviceCount}</span> entities in your Home Assistant.
                  </div>
                  <div className="text-white/25 text-[10px] font-mono mt-1">{url.trim()}</div>
                </div>

                <button
                  onClick={handleComplete}
                  className="mt-3 px-6 py-2.5 text-[11px] font-mono bg-orange-500/20 text-orange-300 border border-orange-500/40 rounded-lg hover:bg-orange-500/30 transition-colors uppercase tracking-wider"
                >
                  Open Smart Home →
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
