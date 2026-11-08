'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';
import type { JarvisSettings } from '../SettingsModal';
import { breezePayload } from '../../lib/breeze-speech';

type Provider = 'openai' | 'elevenlabs' | 'olares';

const OPENAI_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'sage', 'shimmer', 'verse', 'marin', 'cedar',
] as const;

interface Props {
  onNavigateHome: () => void;
}

function loadSettings(): Partial<JarvisSettings> {
  try {
    const raw = localStorage.getItem('jarvis_settings');
    if (raw) return JSON.parse(raw) as JarvisSettings;
  } catch { /* ignore */ }
  return {};
}

function slugifyFilename(text: string): string {
  const base = text
    .slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `jarvis-${base || 'speech'}.mp3`;
}

export function AudioTestPage({ onNavigateHome }: Props) {
  const settings = useMemo(() => loadSettings(), []);
  const [provider, setProvider] = useState<Provider>(
    settings.ttsProvider === 'olares' || settings.apiMode === 'local'
      ? 'olares'
      : settings.apiMode === 'elevenlabs' || settings.apiMode === 'gemini'
        ? (settings.apiMode as Provider)
        : 'openai'
  );
  const [text, setText] = useState(
    'Good evening, sir. All systems are online and ready for your command.'
  );
  const [voice, setVoice] = useState<string>(settings.voice ?? 'echo');
  const [elVoiceId, setElVoiceId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Resolve ElevenLabs agent voice when switching to that provider
  useEffect(() => {
    if (provider !== 'elevenlabs') return;
    const apiKey = settings.elevenLabsApiKey;
    const agentId = settings.elevenLabsAgentId;
    if (!apiKey || !agentId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'resolve-voice',
            elevenLabsApiKey: apiKey,
            elevenLabsAgentId: agentId,
          }),
        });
        const data = await res.json();
        if (!cancelled && data.voiceId) setElVoiceId(data.voiceId);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [provider, settings]);

  // Revoke object URLs on change/unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const synthesize = useCallback(async (): Promise<Blob | null> => {
    setError(null);
    setStatus(null);
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Enter something for Jarvis to say.');
      return null;
    }

    const payload =
      provider === 'olares' ? breezePayload(settings, trimmed) : provider === 'openai'
        ? {
            provider: 'openai' as const,
            text: trimmed,
            voice,
            apiKey: settings.apiKey ?? '',
            openaiModel: 'gpt-4o-mini-tts',
          }
        : {
            provider: 'elevenlabs' as const,
            text: trimmed,
            elevenLabsApiKey: settings.elevenLabsApiKey ?? '',
            elevenLabsAgentId: settings.elevenLabsAgentId ?? '',
            elevenLabsVoiceId: elVoiceId || undefined,
            elevenLabsModel: 'eleven_multilingual_v2',
          };

    if (provider === 'openai' && !payload.apiKey) {
      setError('OpenAI API key missing — add it in Settings.');
      return null;
    }
    if (provider === 'elevenlabs' && !settings.elevenLabsApiKey) {
      setError(
        'ElevenLabs API key missing — add it in Settings → Voice Engine (needed for TTS / MP3 export). The Agent ID alone cannot generate downloadable audio.'
      );
      return null;
    }

    setBusy(true);
    setStatus(provider === 'olares' ? 'Synthesizing with Breeze via Olares Router…' : provider === 'openai' ? 'Synthesizing with OpenAI…' : 'Synthesizing with ElevenLabs…');
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          if (data.error) msg = data.error;
        } catch { /* ignore */ }
        setError(msg);
        setStatus(null);
        return null;
      }

      const blob = await res.blob();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setLastBlob(blob);
      setStatus(`Ready · ${(blob.size / 1024).toFixed(1)} KB`);
      return blob;
    } catch (e) {
      setError(String(e));
      setStatus(null);
      return null;
    } finally {
      setBusy(false);
    }
  }, [text, provider, voice, settings, elVoiceId, audioUrl]);

  const onSpeak = useCallback(async () => {
    const blob = lastBlob && !busy ? lastBlob : await synthesize();
    if (!blob) return;
    // If we reused the last blob, ensure audio element has the url
    const url = audioUrl ?? URL.createObjectURL(blob);
    if (!audioUrl) {
      setAudioUrl(url);
      setLastBlob(blob);
    }
    // Small delay so the audio element picks up a freshly set src
    requestAnimationFrame(() => {
      const el = audioRef.current;
      if (!el) return;
      el.src = url;
      el.play().catch(() => setError('Playback blocked — tap Speak again.'));
    });
  }, [lastBlob, busy, synthesize, audioUrl]);

  const onGenerate = useCallback(async () => {
    setLastBlob(null);
    await synthesize();
  }, [synthesize]);

  const onDownload = useCallback(async () => {
    let blob = lastBlob;
    if (!blob) blob = await synthesize();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slugifyFilename(text).replace(/\.mp3$/, blob.type.includes('wav') ? '.wav' : blob.type.includes('ogg') ? '.ogg' : '.mp3');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus(`Saved ${a.download}`);
  }, [lastBlob, synthesize, text]);

  const charCount = text.length;
  const accent = provider === 'openai' ? '#22d3ee' : '#a78bfa';

  return (
    <motion.div
      className="fixed inset-0 z-[50] overflow-hidden flex flex-col"
      style={{ background: '#020814' }}
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(34,211,238,0.12) 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(167,139,250,0.10) 0%, transparent 50%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(34,211,238,0.15) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      <PageHeader title="Audio Lab" onNavigateHome={onNavigateHome} accent="cyan" />

      <div className="relative flex-1 flex items-center justify-center px-6 pb-10 overflow-y-auto">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          {/* Engine switch */}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
              Voice Engine
            </span>
            <div className="flex gap-2">
              {([
                { id: 'openai' as const, label: 'OpenAI' },
                { id: 'elevenlabs' as const, label: 'ElevenLabs' },
                { id: 'olares' as const, label: 'Breeze · Olares' },
              ]).map((opt) => {
                const active = provider === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setProvider(opt.id);
                      setLastBlob(null);
                      setError(null);
                      setStatus(null);
                    }}
                    className="flex-1 py-2.5 font-mono text-[11px] uppercase tracking-widest rounded-lg transition-all"
                    style={{
                      color: active ? '#fff' : 'rgba(255,255,255,0.35)',
                      background: active ? `${accent}22` : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? accent : 'rgba(255,255,255,0.1)'}`,
                      boxShadow: active ? `0 0 20px ${accent}33` : 'none',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="font-mono text-[10px] text-white/30 leading-relaxed">
              {provider === 'olares' ? 'Uses the speech model and Router connection configured in Settings → Speech Output.' : provider === 'openai'
                ? `Uses your OpenAI key and the "${voice}" voice from Settings.`
                : 'Uses your ElevenLabs API key + Agent voice (exact TTS, downloadable as MP3).'}
            </p>
          </div>

          {/* OpenAI voice picker */}
          {provider === 'openai' && (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
                Voice
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {OPENAI_VOICES.map((v) => {
                  const active = voice === v;
                  return (
                    <button
                      key={v}
                      onClick={() => {
                        setVoice(v);
                        setLastBlob(null);
                      }}
                      className="py-1.5 font-mono text-[10px] uppercase tracking-wider rounded transition-all"
                      style={{
                        color: active ? '#fff' : 'rgba(255,255,255,0.35)',
                        background: active ? 'rgba(34,211,238,0.2)' : 'transparent',
                        border: `1px solid ${active ? '#22d3ee' : 'rgba(255,255,255,0.08)'}`,
                      }}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ElevenLabs voice status */}
          {provider === 'elevenlabs' && (
            <div
              className="rounded-lg px-3 py-2.5 font-mono text-[10px] uppercase tracking-widest"
              style={{
                background: 'rgba(167,139,250,0.08)',
                border: '1px solid rgba(167,139,250,0.25)',
                color: 'rgba(216,180,254,0.85)',
              }}
            >
              Agent {settings.elevenLabsAgentId ? settings.elevenLabsAgentId.slice(0, 22) + '…' : '(not set)'}
              {elVoiceId ? ` · voice ${elVoiceId.slice(0, 12)}…` : ' · resolving voice…'}
            </div>
          )}

          {/* Script */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-baseline">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
                Script
              </span>
              <span
                className="font-mono text-[10px]"
                style={{ color: charCount > 4000 ? '#f87171' : 'rgba(255,255,255,0.3)' }}
              >
                {charCount} / 4096
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setLastBlob(null);
              }}
              rows={6}
              maxLength={4096}
              placeholder="Type what you want Jarvis to say…"
              className="w-full resize-y rounded-xl px-4 py-3 text-sm text-white/90 leading-relaxed focus:outline-none transition-shadow"
              style={{
                background: 'rgba(2,12,28,0.85)',
                border: `1px solid ${accent}44`,
                boxShadow: `inset 0 0 30px rgba(0,0,0,0.4)`,
                minHeight: 140,
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onGenerate}
              disabled={busy}
              className="flex-1 min-w-[120px] py-3 font-mono text-[11px] uppercase tracking-widest rounded-lg transition-all disabled:opacity-40"
              style={{
                color: '#fff',
                background: `${accent}33`,
                border: `1px solid ${accent}`,
              }}
            >
              {busy ? 'Working…' : 'Generate'}
            </button>
            <button
              onClick={onSpeak}
              disabled={busy}
              className="flex-1 min-w-[120px] py-3 font-mono text-[11px] uppercase tracking-widest rounded-lg transition-all disabled:opacity-40"
              style={{
                color: accent,
                background: 'transparent',
                border: `1px solid ${accent}88`,
              }}
            >
              Speak
            </button>
            <button
              onClick={onDownload}
              disabled={busy}
              className="flex-1 min-w-[120px] py-3 font-mono text-[11px] uppercase tracking-widest rounded-lg transition-all disabled:opacity-40"
              style={{
                color: '#fff',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.18)',
              }}
            >
              Save MP3
            </button>
          </div>

          {/* Player + status */}
          {audioUrl && (
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              className="w-full h-10 rounded-lg"
              style={{ filter: 'hue-rotate(160deg) brightness(0.9)' }}
            />
          )}

          {(status || error) && (
            <p
              className="font-mono text-[11px] tracking-wide"
              style={{ color: error ? '#f87171' : 'rgba(255,255,255,0.45)' }}
            >
              {error ?? status}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
