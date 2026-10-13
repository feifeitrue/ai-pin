import type { PingId } from './pings';
import type { Platform } from './platform';
import type { HelperStatus, WheelKind } from './protocol';
import type { OverlaySettings, Settings } from './settings';
import type { Selection } from './selection';
import type {CodexChat,CodexConnectionState,CodexReply} from './codexConnection';

export interface Point {
  x: number;
  y: number;
}

/** main → overlay renderer messages. Points are CSS pixels inside that overlay. */
export interface OverlayEvents {
  'overlay:settings': OverlaySettings;
  /** `wheel` names the wheel the gesture belongs to; missing means 'ping' (the site demo leaves it out). */
  'wheel:open': Point & { wheel?: WheelKind; selection?: Selection };
  'wheel:move': Point & { wheel?: WheelKind };
  'wheel:release': Point & { wheel?: WheelKind };
  'wheel:cancel': null;
  'ping:spawn': Point & { id: PingId };
  'toast:show': { title: string; body: string };
  'region:open': {sessionId: number; image: string};
  'region:loading': null;
  'region:pointer': Point & {phase: 'down' | 'move' | 'up'};
  'region:close': null;
}

export type OverlayChannel = keyof OverlayEvents;

export const OVERLAY_CHANNELS: readonly OverlayChannel[] = [
  'overlay:settings', 'wheel:open', 'wheel:move', 'wheel:release', 'wheel:cancel', 'ping:spawn',
  'toast:show',
  'region:open','region:loading','region:pointer','region:close',
];

/** overlay renderer → main: string[] of asset files that failed to load. */
export const OVERLAY_ASSETS = 'overlay:assets';
/** overlay renderer → main: {id, x, y} of a ping the wheel just placed, for AI capture. */
export const OVERLAY_PINGED = 'overlay:pinged';
export const OVERLAY_SELECTION = 'overlay:selection';
export interface AppStatus {
  enabled: boolean;
  helper: HelperStatus;
  /**
   * macOS only: lolPing is in the Accessibility list but the helper still can't read input. That is a stale entry
   * left by an update (ad-hoc signatures change every build): it has to be removed and added again.
   */
  staleAccess?: boolean;
}

export interface About {
  version: string;
  problems: string[];
  limitations: string[];
}

export type SetSettingsResult = { ok: true; settings: Settings } | { ok: false; error: string; settings: Settings };

// SETTINGS_CH lives in its own module so the settings preload can import it without sharing a chunk
// with the overlay preload (a sandboxed preload can only require('electron'), never a sibling file).
export { SETTINGS_CH } from './settingsChannels';

/** window.settingsApi in the settings renderer. */
export interface SettingsApi {
  codexStatus():Promise<CodexConnectionState>;
  codexDiscover():Promise<CodexReply<CodexChat[]>>;
  codexConnect(threadId:string):Promise<CodexReply<CodexConnectionState>>;
  readonly platform: Platform;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<SetSettingsResult>;
  onSettings(cb: (s: Settings) => void): () => void;
  getStatus(): Promise<AppStatus>;
  onStatus(cb: (s: AppStatus) => void): () => void;
  setEnabled(on: boolean): Promise<void>;
  previewPing(id: PingId): Promise<void>;
  getAbout(): Promise<About>;
  openSettingsFolder(): Promise<void>;
  openProjectPage(): Promise<void>;
  retryHelper(): Promise<void>;
  setCapturing(on: boolean): Promise<void>;
  /** macOS: asks for Accessibility access and opens that page of System Settings. */
  openAccessibility(): Promise<void>;
  /** The main process asks to scroll to a section (e.g. tray → Settings). */
  onShowSection(cb: (id: string) => void): () => void;
}
