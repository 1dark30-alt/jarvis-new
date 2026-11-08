// The /web subpath guarantees the browser build (WebSocket transport) — the
// package's default export can resolve to the Node build inside Electron.
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai/web';

/**
 * Gemini Live — a streaming voice session on the Gemini Live API, so Jarvis
 * can speak and listen through the same engine Mark 58 was built around —
 * while OpenAI Realtime, ElevenLabs and the local voice remain selectable in
 * Settings.
 *
 * The binary-framed BidiGenerateContent protocol is handled by the official
 * @google/genai SDK; this module owns the ladder, the audio, and the tools.
 *
 * Voice model ladder: the conversation's own model and careful fallbacks —
 * Live models are not interchangeable, so the list is short and only holds
 * models verified to exist on the key (ListModels), not guesses.
 *
 * THE USER'S CONVERSATION OUTRANKS EVERY SIDE CALL — same rule as Mark 58:
 * this module never touches the text ladder's quota pool, and one session at
 * a time is all the voice needs.
 */

const VOICE = 'Charon'; // steady, JARVIS-like

export const LIVE_MODEL_LADDER = [
  'gemini-3.1-flash-live-preview',
  'gemini-3.8-live',
  'gemini-3.8-live-extended-thinking',
];

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: unknown; // OpenAI-style schema, converted to Gemini's uppercase form
}

export interface GeminiLiveCallbacks {
  onStatus: (status: 'connecting' | 'active' | 'idle' | 'error') => void;
  onTranscript: (role: 'user' | 'jarvis', text: string) => void;
  onLevel: (value: number) => void;
  onError: (message: string) => void;
  onClosed: () => void;
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ result: unknown; imageBase64?: string }>;
}

export class GeminiLive {
  private session: Session | null = null;
  private ctx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private playHead = 0;
  private stopped = false;
  private modelIdx = 0;
  // SELF-ECHO GUARD (Mark 58): the mic goes quiet while Jarvis is speaking —
  // without it, a speaker loud enough to beat echo cancellation makes the
  // assistant answer itself, forever. The gate opens the moment the playback
  // head runs dry (+ a small tail), so barge-in still works.
  private micGateUntil = 0;

  constructor(
    private apiKey: string,
    private systemPrompt: string,
    private tools: ToolDeclaration[],
    private cb: GeminiLiveCallbacks,
  ) {}

  async start(): Promise<void> {
    this.cb.onStatus('connecting');
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    try { this.session?.close(); } catch { /* already gone */ }
    this.session = null;
    this.stopAudio();
  }

  /** Tear the capture chain down — nothing may send into a dead session. */
  private stopAudio(): void {
    try { this.worklet?.disconnect(); } catch { /* ignore */ }
    this.worklet = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const model = LIVE_MODEL_LADDER[this.modelIdx];
    if (!model) {
      this.cb.onStatus('error');
      this.cb.onError('Every Live model on the ladder refused the connection. Check the Gemini API key in Settings.');
      return;
    }

    const ai = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { apiVersion: 'v1beta' } });

    let settled = false;
    const failToNext = (why: string) => {
      if (this.stopped || settled) return;
      settled = true;
      console.warn(`[GeminiLive] ${model}: ${why} — trying the next rung`);
      this.cb.onError(`Gemini Live (${model}): ${why} — trying the next model on the ladder…`);
      try { this.session?.close(); } catch { /* ignore */ }
      this.session = null;
      this.modelIdx++;
      void this.connect();
    };
    // If setup never completes, the rung is dead — do not hang on it.
    const setupTimer = setTimeout(() => failToNext('no setupComplete within 12 s'), 12_000);
    void setupTimer;

    try {
      this.session = await ai.live.connect({
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: this.systemPrompt,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          ...(this.tools.length && {
            tools: [{ functionDeclarations: this.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: upperTypes(t.parameters) as Record<string, unknown>,
            })) }],
          }),
        },
        callbacks: {
          onopen: () => console.log(`[GeminiLive] socket open — ${model}`),
          onmessage: (msg: LiveServerMessage) => {
            if (!this.sessionEstablished) clearTimeout(setupTimer);
            this.onMessage(msg);
          },
          onerror: (e: ErrorEvent | Error) => {
            console.error('[GeminiLive] socket error:', String((e as ErrorEvent)?.message ?? e));
            failToNext(String((e as ErrorEvent)?.message ?? e));
          },
          onclose: (e: CloseEvent | { reason?: string; code?: number }) => {
            if (this.stopped) return;
            const reason = (e as CloseEvent)?.reason ?? '';
            console.warn(`[GeminiLive] session closed (code ${(e as CloseEvent)?.code ?? '?'}) — reason: ${reason || '(none)'}`);
            if (!this.sessionEstablished) failToNext(reason || 'closed before setup completed');
            else {
              // The session is dead — kill the mic chain immediately so no
              // further send can hit the closing/closed socket.
              this.session = null;
              this.stopAudio();
              this.cb.onStatus('idle');
              this.cb.onClosed();
            }
          },
        },
      });
    } catch (e) {
      failToNext(String((e as Error)?.message ?? e));
    }
  }

  private sessionEstablished = false;

  private onMessage(msg: LiveServerMessage): void {
    if (this.stopped) return;
    if (msg.setupComplete) {
      this.sessionEstablished = true;
      console.log('[GeminiLive] setup complete — mic opening');
      this.cb.onStatus('active');
      void this.startMic().catch((e) => {
        this.cb.onError(`Microphone could not start: ${String(e)}`);
      });
      return;
    }
    if (msg.toolCall?.functionCalls?.length) {
      void this.handleToolCalls(msg.toolCall.functionCalls);
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) {
      this.stopPlayback();
      // The user just cut in — open the mic immediately.
      this.micGateUntil = 0;
    }
    if (sc.inputTranscription?.text) this.cb.onTranscript('user', sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.cb.onTranscript('jarvis', sc.outputTranscription.text);
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.text) this.cb.onTranscript('jarvis', part.text);
      const inline = part.inlineData;
      if (inline?.data) this.playAudio(inline.data, inline.mimeType ?? 'audio/pcm;rate=24000');
    }
  }

  // ── mic capture ────────────────────────────────────────────────────────────
  private async startMic(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(this.stream);
    await this.ctx.audioWorklet.addModule('/worklets/jarvis-pcm.js');
    this.worklet = new AudioWorkletNode(this.ctx, 'jarvis-pcm-capture');
    this.worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.stopped || !this.session) return;
      this.cb.onLevel(Math.min(1, rms(e.data) * 8));
      // The echo gate: while Jarvis's voice is on the speakers, mic samples
      // are dropped before they ever reach the model.
      if (this.ctx!.currentTime < this.micGateUntil) return;
      const pcm16 = floatTo16kPcm16(e.data, this.ctx!.sampleRate);
      try {
        // NB: the server rejects the older `media`/mediaChunks field — the mic
        // must ride the current `audio` field (verified against the live API).
        this.session.sendRealtimeInput({
          audio: { data: bytesToBase64(pcm16), mimeType: 'audio/pcm;rate=16000' },
        });
      } catch { /* session mid-close — the next tick retries or stops */ }
    };
    source.connect(this.worklet);
    // The worklet is a dead end on purpose — the mic never reaches the
    // speakers directly, so the assistant never hears itself twice.
  }

  // ── playback ───────────────────────────────────────────────────────────────
  private stopPlayback(): void {
    if (!this.ctx) return;
    this.playHead = this.ctx.currentTime;
  }

  private playAudio(base64: string, mimeType: string): void {
    if (!this.ctx) return;
    const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
    const bytes = base64ToBytes(base64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = this.ctx.createBuffer(1, samples.length, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    // Sequential queue — chunks arrive in speaking order.
    const start = Math.max(this.playHead, this.ctx.currentTime + 0.02);
    src.start(start);
    this.playHead = start + buffer.duration;
    // Extend the echo gate across everything scheduled so far, plus a tail.
    this.micGateUntil = this.playHead + 0.35;
  }

  // ── tools ──────────────────────────────────────────────────────────────────
  private async handleToolCalls(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]): Promise<void> {
    if (!this.session) return;
    const responses: { id?: string; name?: string; response: Record<string, unknown> }[] = [];
    for (const call of calls) {
      const name = call.name ?? '';
      try {
        const { result, imageBase64 } = await this.cb.callTool(name, call.args ?? {});
        const text = imageBase64
          ? { ...(result as Record<string, unknown>), note: 'An image was captured and shown on the HUD.' }
          : result;
        responses.push({ id: call.id, name, response: { result: text } });
      } catch (e) {
        responses.push({ id: call.id, name, response: { error: String(e) } });
      }
    }
    try {
      this.session?.sendToolResponse({ functionResponses: responses });
    } catch { /* session gone */ }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** OpenAI-style schema → Gemini schema: UPPERCASE types, no additionalProperties. */
function upperTypes(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(upperTypes);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'additionalProperties' || k === 'strict') continue;
    if (k === 'type' && typeof v === 'string') { out.type = v.toUpperCase(); continue; }
    if ((k === 'items' || k === 'properties') && v && typeof v === 'object') { out[k] = upperTypes(v); continue; }
    out[k] = upperTypes(v);
  }
  return out;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** Float32 at the context rate → 16 kHz mono PCM16. */
function floatTo16kPcm16(input: Float32Array, fromRate: number): Uint8Array {
  const ratio = fromRate / 16000;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const idx = Math.floor(i * ratio);
    let sample = input[idx] ?? 0;
    sample = Math.max(-1, Math.min(1, sample));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}