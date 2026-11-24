/** scrcpy raw audio: 48 kHz, stereo, signed 16-bit little endian. */
export class PcmPlayer {
  private readonly context = new AudioContext({ sampleRate: 48_000 });
  private readonly gain = this.context.createGain();
  private next = 0;
  private closed = false;

  constructor(onPlaying: (playing: boolean) => void) {
    this.gain.connect(this.context.destination);
    this.context.onstatechange = () => onPlaying(this.context.state === "running" && this.gain.gain.value > 0);
    onPlaying(this.context.state === "running");
  }

  async play() {
    if (this.closed) return;
    this.gain.gain.value = 1;
    await this.context.resume();
    this.context.dispatchEvent(new Event("statechange"));
  }

  mute() {
    this.gain.gain.value = 0;
  }

  push(pcm: Uint8Array) {
    if (this.closed || this.context.state !== "running" || this.gain.gain.value === 0 || pcm.byteLength % 4 !== 0 || !pcm.byteLength) return;
    const now = this.context.currentTime;
    // Bound queued sound so a slow page never builds an ever-growing delay.
    if (this.next > now + 0.2) return;
    const frames = pcm.byteLength / 4;
    const buffer = this.context.createBuffer(2, frames, 48_000);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame++) {
        samples[frame] = view.getInt16(frame * 4 + channel * 2, true) / 32768;
      }
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => source.disconnect();
    const start = Math.max(now + 0.02, this.next);
    source.start(start);
    this.next = start + buffer.duration;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.context.onstatechange = null;
    this.gain.disconnect();
    void this.context.close().catch(() => {});
  }
}
