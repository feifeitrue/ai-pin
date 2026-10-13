import { contextBridge, ipcRenderer } from 'electron';
import {
  OVERLAY_ASSETS, OVERLAY_CHANNELS, OVERLAY_PINGED, OVERLAY_SELECTION, type OverlayChannel, type OverlayEvents,
} from '../shared/ipc';
import type { PingId } from '../shared/pings';
import type { Selection } from '../shared/selection';

const api = {
  on<C extends OverlayChannel>(channel: C, cb: (payload: OverlayEvents[C]) => void): void {
    if (!OVERLAY_CHANNELS.includes(channel)) throw new Error(`unknown overlay channel: ${channel}`);
    ipcRenderer.on(channel, (_event, payload: OverlayEvents[C]) => cb(payload));
  },
  reportMissingAssets(names: string[]): void {
    ipcRenderer.send(OVERLAY_ASSETS, names);
  },
  /** A wheel ping was placed here (CSS px in this overlay). */
  reportPing(id: PingId, x: number, y: number, selection?: Selection): void {
    ipcRenderer.send(OVERLAY_PINGED, { id, x, y, selection });
  },
  setSelection(selection: Selection): void {ipcRenderer.send(OVERLAY_SELECTION,selection);},
};

contextBridge.exposeInMainWorld('overlay', api);

export type OverlayApi = typeof api;
