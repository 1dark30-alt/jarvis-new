'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadServerSettings, saveServerSettings } from '../lib/serverSettings';

type Message = { role: 'user' | 'assistant'; content: string };
type SavedJarvisSettings = {
  localLlmProvider?: 'ollama' | 'olares' | 'olares-shared';
  localLlmUrl?: string;
  localLlmModel?: string;
  localLlmApiKey?: string;
  initialPrompt?: string;
  [key: string]: unknown;
};

const DEFAULT_URL = 'http://127.0.0.1:11434';

export default function LocalChatPage() {
  const [settings, setSettings] = useState<SavedJarvisSettings>({ localLlmUrl: DEFAULT_URL });
  const [models, setModels] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState('Connect to Ollama to load installed models.');
  const [error, setError] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const server = await loadServerSettings();
      let raw = server.jarvis_settings ?? localStorage.getItem('jarvis_settings');
      if (!raw) { setSettingsLoaded(true); return; }
      try {
        const saved = JSON.parse(raw) as SavedJarvisSettings;
        setSettings({
          ...saved,
          localLlmUrl: saved.localLlmUrl || (saved.localLlmProvider === 'olares' ? '' : saved.localLlmProvider === 'olares-shared' ? 'http://3a77b15d.shared.olares.com/v1' : DEFAULT_URL),
        });
      } catch {
        setError('Could not read Jarvis settings. Open Settings and save your local model address.');
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, loading]);

  async function saveLocalSettings(next: SavedJarvisSettings) {
    setSettings(next);
    localStorage.setItem('jarvis_settings', JSON.stringify(next));
    await saveServerSettings({ jarvis_settings: JSON.stringify(next) });
  }

  async function loadModels() {
    setError('');
    if (settings.localLlmProvider !== 'ollama' && !settings.localLlmUrl?.trim()) {
      setModelStatus(settings.localLlmProvider === 'olares' ? 'Set the Olares Router Base URL and API key in Jarvis Settings.' : 'Set the Olares shared endpoint URL in Jarvis Settings.');
      return;
    }
    setModelStatus(settings.localLlmProvider === 'ollama' ? 'Checking Ollama…' : 'Checking Olares model endpoint…');
    try {
      const response = await fetch('/api/local-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'models',
          provider: settings.localLlmProvider ?? 'ollama',
          baseUrl: settings.localLlmUrl || DEFAULT_URL,
          apiKey: settings.localLlmApiKey,
        }),
      });
      const data = await response.json() as { models?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      const available = data.models ?? [];
      setModels(available);
      if (available.length === 0) {
        setModelStatus(settings.localLlmProvider === 'ollama' ? 'Ollama is running, but no models are installed. Run “ollama pull llama3.2”.' : 'The Olares endpoint returned no models.');
        return;
      }
      setModelStatus(`${available.length} model${available.length === 1 ? '' : 's'} available from ${settings.localLlmProvider === 'ollama' ? 'Ollama' : settings.localLlmProvider === 'olares' ? 'Olares Router' : 'Olares shared endpoint'}.`);
      const selected = settings.localLlmModel && available.includes(settings.localLlmModel)
        ? settings.localLlmModel
        : available[0];
      if (selected !== settings.localLlmModel) {
        await saveLocalSettings({ ...settings, localLlmModel: selected });
      }
    } catch (err) {
      setModels([]);
      setModelStatus('');
      setError(`${err instanceof Error ? err.message : String(err)} ${settings.localLlmProvider === 'ollama' ? 'Make sure Ollama is installed and running.' : settings.localLlmProvider === 'olares' ? 'Check the Devices in LAN URL and Router API key in Jarvis Settings.' : 'Check Olares access and confirm the Shared entrance URL.'}`);
    }
  }

  useEffect(() => {
    if (settingsLoaded && (settings.localLlmUrl || settings.localLlmProvider !== 'ollama')) void loadModels();
    // Load once after the saved server settings are read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.localLlmUrl, settingsLoaded]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/local-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.localLlmProvider ?? 'ollama',
          baseUrl: settings.localLlmUrl || DEFAULT_URL,
          apiKey: settings.localLlmApiKey,
          model: settings.localLlmModel,
          systemPrompt: settings.initialPrompt,
          messages: nextMessages,
        }),
      });
      const data = await response.json() as { reply?: string; error?: string };
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      setMessages([...nextMessages, { role: 'assistant', content: data.reply ?? '' }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#030a10] text-cyan-100 flex flex-col">
      <header className="border-b border-cyan-500/30 bg-cyan-950/20 px-5 py-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] text-cyan-500">JARVIS · PRIVATE MODE</div>
          <h1 className="text-xl font-semibold text-cyan-100 mt-1">Local Model Chat</h1>
        </div>
        <Link href="/" className="text-xs uppercase tracking-wider text-cyan-400 hover:text-white">← Home</Link>
      </header>

      <section className="w-full max-w-4xl mx-auto flex-1 flex flex-col px-4 py-5 min-h-0">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            aria-label="Ollama address"
            value={settings.localLlmUrl ?? DEFAULT_URL}
            onChange={(event) => setSettings({ ...settings, localLlmUrl: event.target.value })}
            onBlur={() => void saveLocalSettings(settings)}
            className="min-w-56 flex-1 bg-black/40 border border-cyan-500/30 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-cyan-400"
          />
          <select
            aria-label="Local model"
            value={settings.localLlmModel ?? ''}
            onChange={(event) => void saveLocalSettings({ ...settings, localLlmModel: event.target.value })}
            className="min-w-48 bg-black/60 border border-cyan-500/30 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-400"
          >
            {models.length === 0 && <option value="">No models loaded</option>}
            {models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
          <button onClick={() => void loadModels()} className="px-3 py-2 rounded border border-cyan-500/30 text-xs uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/10">Refresh</button>
        </div>
        <p className="text-[11px] text-cyan-700 mb-4">{modelStatus} Prompts are sent to {settings.localLlmProvider === 'ollama' ? 'your local Ollama server' : settings.localLlmProvider === 'olares' ? 'your Olares Router' : 'your Olares shared model endpoint'}.</p>

        <div className="flex-1 min-h-[40vh] overflow-y-auto rounded-lg border border-cyan-500/20 bg-black/30 p-4 space-y-4">
          {messages.length === 0 && (
            <div className="h-full min-h-48 flex flex-col items-center justify-center text-center text-cyan-700">
              <div className="text-4xl mb-3">◉</div>
              <p className="text-sm text-cyan-500">Your conversation stays on this machine.</p>
              <p className="text-xs mt-2">Install Ollama, then run <code className="text-cyan-300">ollama pull llama3.2</code> if you need a model.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`max-w-[90%] rounded-lg px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed ${message.role === 'user' ? 'ml-auto bg-cyan-950/60 border border-cyan-500/30 text-cyan-100' : 'mr-auto bg-slate-900/80 border border-slate-700 text-slate-100'}`}>
              <div className="text-[10px] uppercase tracking-widest opacity-50 mb-1">{message.role === 'user' ? 'You' : 'Jarvis · Local'}</div>
              {message.content}
            </div>
          ))}
          {loading && <div className="text-xs text-cyan-500 animate-pulse">Local model is thinking…</div>}
          <div ref={bottomRef} />
        </div>

        {error && <div role="alert" className="mt-3 rounded border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>}
        <form onSubmit={sendMessage} className="mt-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
            placeholder="Message your local model…"
            rows={2}
            className="flex-1 resize-y min-h-12 max-h-40 bg-black/40 border border-cyan-500/30 rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-cyan-400 placeholder:text-cyan-900"
          />
          <button disabled={loading || !settings.localLlmModel} className="h-12 px-5 rounded-lg bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 text-xs font-bold uppercase tracking-widest disabled:opacity-40 hover:bg-cyan-500/30">Send</button>
        </form>
      </section>
    </main>
  );
}
