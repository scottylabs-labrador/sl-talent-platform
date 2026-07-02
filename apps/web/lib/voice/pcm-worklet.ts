// The AudioWorklet processor source, as a string so TypeScript never type-checks
// the worklet-global symbols (registerProcessor / AudioWorkletProcessor /
// sampleRate). It downsamples the mic input to 16 kHz mono PCM16 and posts each
// chunk as an ArrayBuffer to the main thread. Only used in REAL (Cartesia)
// mode; the simulation demo path never instantiates it.

export const PCM_WORKLET_SOURCE = /* js */ `
class Pcm16DownsampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;
    this._buf = [];
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    const ratio = sampleRate / this.targetRate;
    const outLen = Math.floor(channel.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = channel[Math.floor(i * ratio)] || 0;
      const clamped = Math.max(-1, Math.min(1, s));
      out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}
registerProcessor('pcm16-downsample', Pcm16DownsampleProcessor);
`;
