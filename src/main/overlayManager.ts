import { BrowserWindow, ipcMain, screen, type Display, type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import {
  OVERLAY_ASSETS, OVERLAY_PINGED, OVERLAY_SELECTION, type OverlayChannel, type OverlayEvents,
} from '../shared/ipc';
import { isPingId, type PingId } from '../shared/pings';
import type { HelperEvent, WheelKind } from '../shared/protocol';
import type { OverlaySettings } from '../shared/settings';
import { physicalToLocal, type DisplayMap } from './coords';
import { IS_MAC, loadPage, preloadPath } from './paths';
import { captureDisplay, type FrozenFrame } from './aiCapture';
import { validRect, type Rect, type Selection } from '../shared/selection';

/** A user ping in overlay-local CSS pixels, used by AI capture. */
export interface SharedPing {
  id: PingId;
  displayId: number;
  x: number;
  y: number;
  focus?: {sessionId: number; frame: FrozenFrame; rect: Rect};
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One transparent, click-through window per display. Only user input emits shared. */
export class OverlayManager extends EventEmitter {
  readonly missingAssets = new Set<string>();
  private readonly windows = new Map<number, BrowserWindow>();
  private maps: DisplayMap[] = [];
  private wheelDisplay: number | null = null;
  private wheelKind: WheelKind = 'ping';
  private captureExcluded = false;
  private regionSerial = 0;
  private region: {id:number;displayId:number;frame?:FrozenFrame;rect?:Rect} | null = null;

  constructor(private settings: OverlaySettings) {
    super();
  }

  start(): void {
    ipcMain.on(OVERLAY_SELECTION,(event,raw:Selection|null)=>{
      const s=this.region;
      if(!s?.frame || !raw || raw.sessionId!==s.id || this.displayOf(event.sender)!==s.displayId)return;
      s.rect=validRect(raw.rect,s.frame.display.bounds.width,s.frame.display.bounds.height)?{...raw.rect}:undefined;
    });
    ipcMain.on(OVERLAY_ASSETS, (_event, missing: unknown) => {
      if (!Array.isArray(missing)) return;
      for (const m of missing) if (typeof m === 'string') this.missingAssets.add(m);
    });
    ipcMain.on(OVERLAY_PINGED, (event, raw: unknown) => {
      const p = raw as { id?: unknown; x?: unknown; y?: unknown; selection?: Selection } | null;
      if (!p || !isPingId(p.id) || !isNum(p.x) || !isNum(p.y)) return;
      const displayId = this.displayOf(event.sender);
      if (displayId === undefined) return;
      if(p.selection || this.region) {
        const s=this.region, selected=p.selection;
        if(!s?.frame || !s.rect || !selected || selected.sessionId!==s.id || !validRect(selected.rect,s.frame.display.bounds.width,s.frame.display.bounds.height)) return;
        if(['x','y','width','height'].some(k=>selected.rect[k as keyof Rect]!==s.rect![k as keyof Rect]))return;
        const rect={...selected.rect};
        this.emit('shared',{id:p.id,displayId,x:p.x,y:p.y,
          focus:{sessionId:s.id,frame:s.frame,rect}} satisfies SharedPing);
        this.cancelRegion();
      } else this.emit('shared', { id: p.id, displayId, x: p.x, y: p.y } satisfies SharedPing);
    });
    this.rebuild();
    screen.on('display-added', () => this.rebuild());
    screen.on('display-removed', () => this.rebuild());
    screen.on('display-metrics-changed', () => this.rebuild());
  }

  updateSettings(s: OverlaySettings): void {
    this.settings = s;
    for (const id of this.windows.keys()) this.send(id, 'overlay:settings', s);
  }

  handle(ev: HelperEvent): void {
    switch (ev.type) {
      case 'regionOpen': {
        const p=physicalToLocal(ev.x,ev.y,this.maps);
        if(p) void this.beginRegion(p.displayId);
        break;
      }
      case 'regionCancel': this.cancelRegion(); break;
      case 'regionDown':
      case 'regionMove':
      case 'regionUp': {
        if(!this.region?.frame) break;
        if(ev.type==='regionDown')this.region.rect=undefined;
        const p=physicalToLocal(ev.x,ev.y,this.maps,this.region.displayId);
        if(p) this.send(this.region.displayId,'region:pointer',{x:p.x,y:p.y,phase:ev.type==='regionDown'?'down':ev.type==='regionMove'?'move':'up'});
        break;
      }
      case 'wheelOpen': {
        const p = physicalToLocal(ev.x, ev.y, this.maps);
        if (!p) return;
        if(this.region && (!this.region.frame || !this.region.rect)) {
          this.toast('请先完成框选','框选完成后，可以在任意位置用 Alt 轮盘发信号');
          return;
        }
        this.wheelDisplay = p.displayId;
        this.wheelKind = ev.wheel;
        this.send(p.displayId, 'wheel:open', { x: p.x, y: p.y, wheel: ev.wheel,
          ...(this.region?.rect?{selection:{sessionId:this.region.id,rect:{...this.region.rect}}}:{}) });
        break;
      }
      case 'wheelMove':
      case 'wheelRelease': {
        if (this.wheelDisplay === null) return;
        const p = physicalToLocal(ev.x, ev.y, this.maps, this.wheelDisplay);
        if (!p) return;
        this.send(p.displayId, ev.type === 'wheelMove' ? 'wheel:move' : 'wheel:release', { x: p.x, y: p.y, wheel: this.wheelKind });
        if (ev.type === 'wheelRelease') this.wheelDisplay = null;
        break;
      }
      case 'click': {
        const p = physicalToLocal(ev.x, ev.y, this.maps);
        if (!p) break;
        this.send(p.displayId, 'ping:spawn', { id: this.settings.clickPingId, x: p.x, y: p.y });
        this.emit('shared', { id: this.settings.clickPingId, displayId: p.displayId, x: p.x, y: p.y } satisfies SharedPing);
        break;
      }
      case 'cancel':
        this.cancelWheel();
        break;
      default:
        break;
    }
  }

  previewPing(id: PingId): void {
    const d = screen.getPrimaryDisplay();
    this.send(d.id, 'ping:spawn', { id, x: d.bounds.width / 2, y: d.bounds.height / 2 });
  }

  toast(title: string, body: string): void {
    this.send(screen.getPrimaryDisplay().id, 'toast:show', { title, body });
  }

  /** Win11 excludes these surfaces from capture without interrupting their display/audio. */
  setCaptureExcluded(excluded: boolean): void {
    this.captureExcluded = excluded;
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.setContentProtection(excluded);
  }

  destroy(): void {
    this.cancelRegion();
    for (const w of this.windows.values()) if (!w.isDestroyed()) w.destroy();
    this.windows.clear();
  }

  /** Dismisses a wheel that is on screen, if any. Also used when the helper stops: its cancel would never arrive. */
  cancelWheel(): void {
    if (this.wheelDisplay === null) return;
    this.send(this.wheelDisplay, 'wheel:cancel', null);
    this.wheelDisplay = null;
  }

  cancelRegion(): void {
    if(!this.region) return;
    this.send(this.region.displayId,'region:close',null);
    this.windows.get(this.region.displayId)?.setIgnoreMouseEvents(true);
    this.region=null;
    this.cancelWheel();
    this.emit('regionClosed');
  }

  private async beginRegion(displayId:number): Promise<void> {
    if(this.region) {this.send(this.region.displayId,'region:close',null);this.windows.get(this.region.displayId)?.setIgnoreMouseEvents(true);}
    this.cancelWheel();
    // Do not emit regionClosed for a replacement: the incoming gesture owns the helper now.
    const session={id:++this.regionSerial,displayId,frame:undefined as FrozenFrame|undefined};
    this.region=session;
    this.windows.get(displayId)?.setIgnoreMouseEvents(false);
    this.send(displayId,'region:loading',null);
    try {
      const frame=await captureDisplay(displayId);
      if(this.region!==session) return;
      session.frame=frame;
      this.windows.get(displayId)?.setIgnoreMouseEvents(false);
      this.send(displayId,'region:open',{sessionId:session.id,image:frame.image.toDataURL()});
    } catch(error) {
      if(this.region!==session) return;
      this.cancelRegion();
      this.toast('无法进入框选',error instanceof Error?error.message:String(error));
    }
  }

  private displayOf(sender: WebContents): number | undefined {
    const win = BrowserWindow.fromWebContents(sender);
    return [...this.windows].find(([, w]) => w === win)?.[0];
  }

  private rebuild(): void {
    this.cancelRegion();
    this.cancelWheel();
    const displays = screen.getAllDisplays();
    // The macOS helper already reports points in Electron's DIP space; dipToScreenRect only exists on Windows.
    this.maps = displays.map((d) => IS_MAC
      ? { id: d.id, dip: d.bounds, phys: d.bounds, scale: 1 }
      : { id: d.id, dip: d.bounds, phys: screen.dipToScreenRect(null, d.bounds), scale: d.scaleFactor });
    for (const [id, win] of this.windows) {
      if (!displays.some((d) => d.id === id)) {
        win.destroy();
        this.windows.delete(id);
      }
    }
    for (const d of displays) {
      const win = this.windows.get(d.id);
      if (win) win.setBounds(d.bounds);
      else this.windows.set(d.id, this.createWindow(d));
    }
  }

  private createWindow(d: Display): BrowserWindow {
    const win = new BrowserWindow({
      ...d.bounds,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      enableLargerThanScreen: true, // also stops macOS pushing the window below the menu bar
      show: false,
      type: IS_MAC ? 'panel' : 'toolbar', // a macOS panel can float over full-screen apps
      webPreferences: {
        preload: preloadPath('overlay'),
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false,
      },
    });
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(this.captureExcluded);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.webContents.on('did-finish-load', () => win.webContents.send('overlay:settings', this.settings));
    win.once('ready-to-show', () => {
      win.showInactive();
      win.setBounds(d.bounds); // re-apply: mixed-DPI setups can size the first frame wrong
    });
    void loadPage(win, 'overlay');
    return win;
  }

  private send<C extends OverlayChannel>(displayId: number, channel: C, payload: OverlayEvents[C]): void {
    const w = this.windows.get(displayId);
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}
