import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SoundBank, audibleOffset } from '../../src/renderer/overlay/soundBank';

let ctx: any;
const data = new Float32Array(1000); data.fill(.2, 30);
const buffer = { sampleRate: 1000, length: 1000, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 2; baseLatency = .01; outputLatency = .04; destination = {}; sources: any[] = [];
    constructor() { ctx = this; }
    decodeAudioData = async () => buffer;
    getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
    resume = vi.fn(async () => { this.state = 'running'; });
    createGain = () => ({ gain: { value: 0 }, connect() {}, disconnect() {} });
    createBufferSource = () => { const src = { start: vi.fn(), connect: (g: any) => g, disconnect: vi.fn(), onended: null }; this.sources.push(src); return src; };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function loaded() { const bank = new SoundBank(); await bank.load([{ key: 'ping', url: '/ping.wav' }]); return bank; }

it('measures the audible lead-in without changing the buffer', () => { expect(audibleOffset(buffer)).toBe(.03); expect(data[0]).toBe(0); });
it('starts audio immediately and schedules the visual from device latency plus sound onset', async () => {
  const bank = await loaded(), show = vi.fn(); bank.play('ping', 1, show);
  expect(ctx.sources[0].start).toHaveBeenCalledWith(2); expect(show).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(79); expect(show).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(show).toHaveBeenCalledTimes(1);
});
it('muted and missing sounds leave visual feedback immediate', async () => {
  const bank = await loaded(), show = vi.fn(); bank.play('ping', 0, show); bank.play('missing', 1, show);
  expect(show).toHaveBeenCalledTimes(2); expect(ctx.sources).toHaveLength(0);
});
it('bounds device-delay compensation at 120 ms', async () => {
  const bank = await loaded(), show = vi.fn(); ctx.outputLatency = .8; bank.play('ping', 1, show);
  await vi.advanceTimersByTimeAsync(120); expect(show).toHaveBeenCalledTimes(1);
});
it('a suspended device cannot hang visuals or replay a stale sound after wakeup', async () => {
  const bank = await loaded(), show = vi.fn(); ctx.state = 'suspended';
  let wake!: () => void; ctx.resume = vi.fn(() => new Promise<void>(r => { wake = () => { ctx.state = 'running'; r(); }; }));
  bank.play('ping', 1, show); await vi.advanceTimersByTimeAsync(120); expect(show).toHaveBeenCalledTimes(1);
  wake(); await vi.advanceTimersByTimeAsync(1); expect(ctx.sources).toHaveLength(0); expect(show).toHaveBeenCalledTimes(1);
});
it('voice overflow still shows the ping; ended sources free their slot', async () => {
  const bank = await loaded(); for (let i = 0; i < 8; i++) bank.play('ping', 1);
  const show = vi.fn(); bank.play('ping', 1, show); expect(show).toHaveBeenCalledTimes(1); expect(ctx.sources).toHaveLength(8);
  ctx.sources[0].onended(); bank.play('ping', 1); expect(ctx.sources).toHaveLength(9);
});
