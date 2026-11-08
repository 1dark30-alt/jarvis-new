export interface BreezeSettings {
  ttsProvider?: 'native' | 'olares';
  ttsRouterUrl?: string;
  ttsRouterApiKey?: string;
  ttsModel?: string;
  ttsVoice?: string;
  localLlmProvider?: string;
  localLlmUrl?: string;
  localLlmApiKey?: string;
}

export function breezePayload(settings: BreezeSettings, text: string) {
  return {
    provider: 'olares', text,
    baseUrl: settings.ttsRouterUrl || (settings.localLlmProvider === 'olares' ? settings.localLlmUrl : ''),
    apiKey: settings.ttsRouterApiKey || (settings.localLlmProvider === 'olares' ? settings.localLlmApiKey : ''),
    model: settings.ttsModel || 'default-tts',
    voice: settings.ttsVoice || undefined,
  };
}

/** One cancellable queue per conversation; interruption also cancels pending synthesis. */
export class BreezeSpeaker {
  private controller = new AbortController();
  private queue: Promise<void> = Promise.resolve();
  private audio: HTMLAudioElement | null = null;
  private release: (() => void) | null = null;

  stop() {
    this.controller.abort();
    this.audio?.pause();
    this.release?.();
    this.controller = new AbortController();
    this.queue = Promise.resolve();
  }

  speak(text: string, settings: BreezeSettings): Promise<void> {
    const signal = this.controller.signal;
    const job = this.queue.then(async () => {
      // Keep requests within the speech route's limit, preserving word boundaries.
      const chunks = text.match(/[\s\S]{1,3500}(?:\s|$)|[\s\S]{1,3500}/g) ?? [];
      for (const chunk of chunks) {
        if (signal.aborted) return;
        const response = await fetch('/api/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(breezePayload(settings, chunk)), signal,
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Breeze TTS failed (${response.status})`);
        }
        const blob = await response.blob();
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.audio = audio;
        try {
          await new Promise<void>((resolve, reject) => {
            this.release = resolve;
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error('Could not play Breeze audio.'));
            audio.play().catch(reject);
          });
        } finally {
          audio.pause();
          URL.revokeObjectURL(url);
          if (this.audio === audio) { this.audio = null; this.release = null; }
        }
      }
    }).catch(error => { if (!signal.aborted) throw error; });
    this.queue = job.catch(() => {});
    return job;
  }
}
