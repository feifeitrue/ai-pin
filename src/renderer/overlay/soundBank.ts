/** Safety ceiling: more overlapping sounds than this are skipped (the ping still shows). */
export const MAX_VOICES = 8;
export const MAX_SYNC_WAIT_MS = 120;

/** Estimate the short lead-in once, without trimming or altering the sound. */
export function audibleOffset(buffer: AudioBuffer): number {
  const step = Math.max(1, Math.round(buffer.sampleRate * 0.005));
  const limit = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.15));
  for (let i = 0; i < limit; i += step) {
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      const end = Math.min(i + step, buffer.length);
      let energy = 0;
      for (let j = i; j < end; j++) energy += data[j] * data[j];
      if (energy / (end - i) >= 0.0001) return i / buffer.sampleRate;
    }
  }
  return 0;
}

/** Pre-decoded Web Audio buffers: HTMLAudioElement per play added audible latency in the prototype. */
export class SoundBank {
  private readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private readonly buffers = new Map<string, AudioBuffer>();
  private voices = 0;
  private readonly offsets = new Map<string, number>();
  private waking: Promise<boolean> | null = null;

  /** Wake during loading/wheel opening; no silent loop or recurring timer. */
  warm(): Promise<boolean> {
    if (this.ctx.state === 'running') return Promise.resolve(true);
    if (this.ctx.state === 'closed') return Promise.resolve(false);
    return this.waking ??= this.ctx.resume().then(() => this.ctx.state === 'running', () => false)
      .finally(() => { this.waking = null; });
  }

  /** Decodes every sound up front, each under its key. Resolves with the URLs that failed to load. */
  async load(entries: readonly { key: string; url: string }[]): Promise<string[]> {
    const results = await Promise.all(
      entries.map(async ({ key, url }) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(key, buffer);
          this.offsets.set(key, audibleOffset(buffer));
          return null;
        } catch {
          return url;
        }
      }),
    );
    void this.warm();
    return results.filter((r): r is string => r !== null);
  }

  play(key: string, volume01: number, visual?: () => void): void {
    let shown = false;
    const show = () => { if (!shown) { shown = true; visual?.(); } };
    const buffer = this.buffers.get(key);
    if (!buffer || volume01 <= 0 || this.voices >= MAX_VOICES) { show(); return; }
    const deadline = performance.now() + MAX_SYNC_WAIT_MS;
    const start = () => {
      if (this.voices >= MAX_VOICES || this.ctx.state !== 'running') { show(); return; }
      const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      src.buffer = buffer; gain.gain.value = volume01;
      src.connect(gain).connect(this.ctx.destination);
      this.voices++;
      const release = () => { this.voices--; src.disconnect(); gain.disconnect(); };
      src.onended = release;
      const when = this.ctx.currentTime;
      try { src.start(when); } catch { release(); show(); return; }
      if (!visual) return;
      const now = performance.now();
      let delay = ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
      const stamp = this.ctx.getOutputTimestamp?.();
      if (stamp && typeof stamp.performanceTime === 'number' && typeof stamp.contextTime === 'number' &&
        stamp.performanceTime > 0 && now - stamp.performanceTime < 1000 &&
        when >= stamp.contextTime && when - stamp.contextTime < 1) {
        delay = stamp.performanceTime + (when - stamp.contextTime) * 1000 - now;
      }
      delay += (this.offsets.get(key) || 0) * 1000;
      const wait = Math.max(0, Math.min(delay, deadline - now));
      if (wait > 0) setTimeout(show, wait); else show();
    };
    if (this.ctx.state === 'running') { start(); return; }
    // A broken device must neither hold the local animation nor play stale pings later.
    let expired = false;
    const timer = setTimeout(() => { expired = true; show(); }, MAX_SYNC_WAIT_MS);
    void this.warm().then(ready => {
      clearTimeout(timer);
      if (expired) return;
      if (ready) start(); else show();
    });
  }
}
