import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSettingsIpc, type SettingsIpcDeps } from '../../src/main/settingsIpc';
import { SettingsStore } from '../../src/main/settingsStore';
import { strings } from '../../src/shared/i18n';
import { SETTINGS_CH } from '../../src/shared/ipc';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  opened: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => h.handlers.set(channel, fn) },
  globalShortcut: { register: () => true, unregister: () => undefined },
  shell: { openExternal: async (url: string) => void h.opened.push(url) },
  net: {},
  protocol: {},
}));

let store: SettingsStore;
const call = (channel: string, ...args: unknown[]): Promise<unknown> => Promise.resolve(h.handlers.get(channel)!({}, ...args));

beforeEach(() => {
  h.handlers.clear();
  h.opened.length = 0;
  const dir = mkdtempSync(join(tmpdir(), 'lolping-ipc-'));
  store = new SettingsStore(dir, 60_000);
  store.load();
  registerWith();
});

function registerWith(): void {
  h.handlers.clear();
  registerSettingsIpc({
    store, text: () => strings('en'), platform: 'win',
  } as unknown as SettingsIpcDeps);
}

describe('settings IPC', () => {

  it('setSettings treats a patch that is not an object as no change', async () => {
    expect(await call(SETTINGS_CH.set, null)).toMatchObject({ ok: true, settings: { volume: store.get().volume } });
  });
});


it('has no room, emote or updater IPC and only accepts current settings', async () => {
  expect([...h.handlers.keys()].filter(k => /room|emote|update/i.test(k))).toEqual([]);
  expect(await call(SETTINGS_CH.set, {volume: 12, customEmotes: [], autoUpdateCheck:true}))
    .toMatchObject({ok:true, settings:{volume:12}});
  expect(store.get()).not.toHaveProperty('customEmotes');
});
