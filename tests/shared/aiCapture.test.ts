import { describe, it, expect } from 'vitest';
import { captureRegion, shouldCapturePing } from '../../src/shared/aiCapture';
import { normalizeSettings, mergeSettings, DEFAULT_SETTINGS } from '../../src/shared/settings';

describe('AI question capture', () => {
  it('captures only the four AI intents when enabled', () => {
    expect(shouldCapturePing(true, true, 'missing')).toBe(true);
    expect(shouldCapturePing(false, true, 'missing')).toBe(false);
    expect(shouldCapturePing(true, false, 'missing')).toBe(false);
    expect(shouldCapturePing(true, true, 'omw')).toBe(false);
    for (const id of ['allin', 'needvision', 'enemyvision', 'assist']) expect(shouldCapturePing(true, true, id)).toBe(true);
    for (const id of ['push', 'danger', 'generic', 'bait']) expect(shouldCapturePing(true, true, id)).toBe(false);
  });
  it('preserves the switch and does not enable it for old or malformed settings', () => {
    expect(normalizeSettings({}).aiMode).toBe(false);
    expect(normalizeSettings({ aiMode: 'true' }).aiMode).toBe(false);
    expect(mergeSettings(DEFAULT_SETTINGS, { aiMode: true }).aiMode).toBe(true);
  });
  it('uses actual bitmap dimensions for scaled monitors', () => {
    const r = captureRegion(800, 450, 1600, 900, 2400, 1350);
    expect(r.point).toEqual({ x: 1200, y: 675 });
    expect(r.cropPoint).toEqual({ x: 320, y: 240 });
  });
  it('keeps the crop and point inside a small bitmap at its bottom-right edge', () => {
    const r = captureRegion(500, 300, 500, 300, 500, 300);
    expect(r.crop).toEqual({ x: 0, y: 0, width: 500, height: 300 });
    expect(r.cropPoint).toEqual({ x: 499, y: 299 });
  });
});
