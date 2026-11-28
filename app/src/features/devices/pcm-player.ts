/** scrcpy raw audio: 48 kHz, stereo, signed 16-bit little endian. */
export class PcmPlayer {
  // Made on the first play(), never before: a running AudioContext makes the
  // desktop window ask the system to block sleep, which can show a password prompt.
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private next = 0;
  private closed = false;

  constructor(private readonly onPlaying: (playing: boolean) => void) {
    if (typeof AudioContext === "undefined") throw new Error("No Web Audio");
    onPlaying(false);
  }

  async play() {
    if (this.closed) return;
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 48_000 });
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
      this.context.onstatechange = () =>
        this.onPlaying(this.context?.state === "running" && (this.gain?.gain.value ?? 0) > 0);
    }
    this.gain!.gain.value = 1;
    await this.context.resume();
    this.onPlaying(this.context.state === "running");
  }

  /** Muting closes the audio output so the window stops blocking sleep. */
  mute() {
    const context = this.context;
    this.context = null;
    this.gain = null;
    this.next = 0;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => {});
    }
    this.onPlaying(false);
  }

  push(pcm: Uint8Array) {
    const { context, gain } = this;
    if (this.closed || !context || !gain || context.state !== "running" || pcm.byteLength % 4 !== 0 || !pcm.byteLength) return;
    const now = context.currentTime;
    // Bound queued sound so a slow page never builds an ever-growing delay.
    if (this.next > now + 0.2) return;
    const frames = pcm.byteLength / 4;
    const buffer = context.createBuffer(2, frames, 48_000);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame++) {
        samples[frame] = view.getInt16(frame * 4 + channel * 2, true) / 32768;
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.onended = () => source.disconnect();
    const start = Math.max(now + 0.02, this.next);
    source.start(start);
    this.next = start + buffer.duration;
  }

  close() {
    if (this.closed) return;
    this.mute();
    this.closed = true;
  }
}
