// Jarvis PCM capture worklet — streams Float32 mic samples to the main
// thread in ~100 ms chunks. Downsampling to 16 kHz and PCM16 encoding happen
// on the main thread (see app/lib/geminiLive.ts).
class JarvisPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(128 * 64); // ~85 ms at 96 kHz; grows if needed
    this._fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    if (this._fill + channel.length > this._buffer.length) {
      const grown = new Float32Array(this._buffer.length * 2);
      grown.set(this._buffer);
      this._buffer = grown;
    }
    this._buffer.set(channel, this._fill);
    this._fill += channel.length;
    if (this._fill >= 4800) { // ~100 ms at 48 kHz
      this.port.postMessage(this._buffer.slice(0, this._fill));
      this._fill = 0;
    }
    return true;
  }
}

registerProcessor('jarvis-pcm-capture', JarvisPcmCapture);