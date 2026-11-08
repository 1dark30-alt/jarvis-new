import { BreezeSpeaker } from './breeze-speech';
import type { JarvisSettings } from '../components/SettingsModal';

type Message = { role: 'user' | 'assistant'; content: string };
type Callbacks = {
  phase: (phase: string) => void;
  transcript: (role: 'user' | 'jarvis', text: string) => void;
  error: (message: string) => void;
  level: (value: number) => void;
};

/** Half-duplex turns: listen, transcribe, reason, speak, then listen again. */
export class LocalVoice {
  private controller = new AbortController();
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private speaker = new BreezeSpeaker();
  private messages: Message[] = [];
  private busy = false;
  private muted = false;
  private stopped = false;
  private revision = 0;

  constructor(private settings: JarvisSettings, private callbacks: Callbacks) {}

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    this.context = new AudioContext();
    await this.context.resume();
    if (this.stopped) return;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 2048;
    this.context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let started = 0, voiced = 0, lastVoice = 0;
    this.timer = setInterval(() => {
      if (this.stopped || this.busy || this.muted) return;
      if (!this.recorder) {
        this.record(); started = performance.now(); voiced = 0; lastVoice = 0;
      }
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
      this.callbacks.level(Math.min(1, rms * 10));
      const now = performance.now();
      if (rms > 0.015) { voiced += 100; lastVoice = now; }
      if ((voiced >= 200 && now - lastVoice > 1000) || now - started > 30000) {
        const recording = this.recorder;
        if (voiced < 200) { this.revision++; }
        else { this.busy = true; this.callbacks.phase('Transcribing…'); }
        this.recorder = null;
        recording?.stop();
      }
    }, 100);
    this.callbacks.phase('Listening — speak, then pause');
  }

  private record() {
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(this.stream!, mime ? { mimeType: mime } : undefined);
    this.recorder = recorder;
    const chunks: Blob[] = [];
    const revision = this.revision;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (!this.stopped && revision === this.revision && this.busy && !this.muted) {
        void this.respond(new Blob(chunks, { type: recorder.mimeType }), revision);
      }
    };
    recorder.onerror = () => { this.callbacks.error('Microphone recording failed. Reconnect to retry.'); this.stop(); };
    recorder.start();
  }

  private async respond(audio: Blob, revision: number) {
    const signal = this.controller.signal;
    try {
      const form = new FormData(); form.append('audio', audio, 'speech.webm');
      const response = await fetch('/api/stt', { method: 'POST', body: form, signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const text = data.text?.trim();
      if (!text || this.stopped || revision !== this.revision) return;
      this.callbacks.transcript('user', text);
      this.callbacks.phase('Thinking locally…');
      const messages: Message[] = [...this.messages.slice(-18), { role: 'user', content: text }];
      const replyResponse = await fetch('/api/local-llm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ provider: this.settings.localLlmProvider, baseUrl: this.settings.localLlmUrl,
          apiKey: this.settings.localLlmApiKey, model: this.settings.localLlmModel,
          systemPrompt: this.settings.initialPrompt + '\nKeep spoken replies brief. You are in a voice conversation. You cannot execute app tools in this mode.', messages }),
      });
      const reply = await replyResponse.json();
      if (!replyResponse.ok) throw new Error(reply.error);
      if (this.stopped || revision !== this.revision) return;
      this.messages = [...messages, { role: 'assistant', content: reply.reply }];
      this.callbacks.transcript('jarvis', reply.reply);
      this.callbacks.phase('Speaking — microphone paused');
      await this.speaker.speak(reply.reply, this.settings);
    } catch (error) {
      if (!signal.aborted && !this.stopped) this.callbacks.error(String(error));
    } finally {
      if (!this.stopped && revision === this.revision) {
        this.busy = false; this.callbacks.level(0);
        this.callbacks.phase(this.muted ? 'Microphone muted' : 'Listening — speak, then pause');
      }
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.revision++;
    this.controller.abort(); this.controller = new AbortController();
    this.speaker.stop();
    this.recorder?.stop(); this.recorder = null; this.busy = false;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    this.callbacks.level(0);
    this.callbacks.phase(muted ? 'Microphone muted' : 'Listening — speak, then pause');
  }

  stop() {
    this.stopped = true; this.revision++; this.controller.abort(); this.speaker.stop();
    if (this.timer) clearInterval(this.timer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach(track => track.stop());
    void this.context?.close();
    this.callbacks.level(0);
  }
}
