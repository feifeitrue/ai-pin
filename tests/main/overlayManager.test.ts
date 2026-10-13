import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_PINGED, OVERLAY_SELECTION } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, overlaySettings } from '../../src/shared/settings';

const h = vi.hoisted(() => ({
  windows: [] as Array<{ x: number; webContents: { send: ReturnType<typeof vi.fn> }; setContentProtection: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn> }>,
  handlers: new Map<string, (event: unknown, raw: unknown) => void>(),
  capture: vi.fn(),
}));
vi.mock('../../src/main/aiCapture',()=>({captureDisplay:h.capture}));

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeWindow extends Emitter {
    static fromWebContents(wc: unknown): FakeWindow | null {
      return (h.windows as unknown as FakeWindow[]).find((w) => w.webContents === wc) ?? null;
    }
    x: number;
    webContents = Object.assign(new Emitter(), { send: vi.fn() });
    constructor(opts: { x: number }) {
      super();
      this.x = opts.x;
      h.windows.push(this);
    }
    setIgnoreMouseEvents(): void {}
    setContentProtection = vi.fn();
    hide = vi.fn();
    setAlwaysOnTop(): void {}
    setBounds(): void {}
    showInactive(): void {}
    isDestroyed(): boolean {
      return false;
    }
    destroy(): void {}
  }
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, scaleFactor: 1 },
  ];
  const screen = Object.assign(new Emitter(), {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    dipToScreenRect: (_win: unknown, r: unknown) => r,
  });
  const ipcMain = { on: (channel: string, fn: (event: unknown, raw: unknown) => void) => h.handlers.set(channel, fn) };
  return { BrowserWindow: FakeWindow, ipcMain, screen };
});

vi.mock('../../src/main/paths', () => ({
  IS_MAC: false,
  loadPage: () => Promise.resolve(),
  preloadPath: () => 'preload.js',
}));

type Manager = InstanceType<typeof import('../../src/main/overlayManager').OverlayManager>;
let mgr: Manager;

/** What display 1 (index 0) or display 2 (index 1) was told, minus the settings it gets on load. */
const sent = (i: number): Array<[string, unknown]> =>
  h.windows[i].webContents.send.mock.calls.filter((c) => c[0] !== 'overlay:settings') as Array<[string, unknown]>;

beforeEach(async () => {
  h.windows.length = 0;
  h.handlers.clear();
  h.capture.mockReset();
  vi.resetModules();
  const { OverlayManager } = await import('../../src/main/overlayManager');
  mgr = new OverlayManager(overlaySettings(DEFAULT_SETTINGS));
  mgr.start();
});

describe('OverlayManager wheels', () => {
  it('excludes AI overlays without hiding windows or delaying a ping', () => {
    mgr.setCaptureExcluded(true);
    mgr.previewPing('missing');
    for (const win of h.windows) {
      expect(win.setContentProtection).toHaveBeenLastCalledWith(true);
      expect(win.hide).not.toHaveBeenCalled();
    }
    expect(sent(0)).toContainEqual(['ping:spawn', { id: 'missing', x: 960, y: 540 }]);
    mgr.setCaptureExcluded(false);
    for (const win of h.windows) expect(win.setContentProtection).toHaveBeenLastCalledWith(false);
  });
  it('forwards the open wheel\'s kind with every move and the release', () => {
    mgr.handle({ type: 'wheelOpen', x: 100, y: 200, wheel: 'ping' });
    mgr.handle({ type: 'wheelMove', x: 110, y: 210, wheel: 'ping' });
    mgr.handle({ type: 'wheelRelease', x: 120, y: 220, wheel: 'ping' });
    expect(sent(0)).toEqual([
      ['wheel:open', { x: 100, y: 200, wheel: 'ping' }],
      ['wheel:move', { x: 110, y: 210, wheel: 'ping' }],
      ['wheel:release', { x: 120, y: 220, wheel: 'ping' }],
    ]);
  });

  it('keeps the ping wheel a ping wheel after a previous one', () => {
    mgr.handle({ type: 'wheelOpen', x: 1, y: 1, wheel: 'ping' });
    mgr.handle({ type: 'wheelRelease', x: 1, y: 1, wheel: 'ping' });
    mgr.handle({ type: 'wheelOpen', x: 5, y: 5, wheel: 'ping' });
    mgr.handle({ type: 'wheelMove', x: 6, y: 6, wheel: 'ping' });
    expect(sent(0).slice(2)).toEqual([
      ['wheel:open', { x: 5, y: 5, wheel: 'ping' }],
      ['wheel:move', { x: 6, y: 6, wheel: 'ping' }],
    ]);
  });
});


it('routes a user click on the secondary display without triggering AI for notifications', () => {
  const user = vi.fn(); mgr.on('shared', user);
  mgr.handle({ type: 'click', x: 2220, y: 400, wheel: 'ping' });
  expect(sent(1)).toEqual([['ping:spawn', {id: DEFAULT_SETTINGS.clickPingId, x: 300, y: 400}]]);
  expect(user).toHaveBeenCalledWith({id: DEFAULT_SETTINGS.clickPingId, displayId: 2, x: 300, y: 400});
  user.mockClear(); mgr.previewPing('assist'); mgr.previewPing('omw');
  expect(user).not.toHaveBeenCalled();
});
it('reports a wheel ping with the originating display and cancels the open wheel', () => {
  const user = vi.fn(); mgr.on('shared', user);
  h.handlers.get(OVERLAY_PINGED)!({sender: h.windows[1].webContents}, {id:'missing', x:40, y:50});
  expect(user).toHaveBeenCalledWith({id:'missing', displayId:2, x:40, y:50});
  mgr.handle({type:'wheelOpen', x:2000, y:300, wheel:'ping'}); mgr.cancelWheel();
  expect(sent(1)).toContainEqual(['wheel:cancel', null]);
});
it('binds a region to its retained frame and rejects stale or out-of-bounds reports', async () => {
 const frame={image:{toDataURL:()=> 'data:image/png;base64,QQ=='},display:{bounds:{width:1920,height:1080}},capturedAt:'A'};
 h.capture.mockResolvedValue(frame);
 mgr.handle({type:'regionOpen',x:100,y:200,wheel:'ping'});await Promise.resolve();
 const opened=sent(0).find(([c])=>c==='region:open')![1] as {sessionId:number};
 const user=vi.fn();mgr.on('shared',user);
 const report=h.handlers.get(OVERLAY_PINGED)!;
 report({sender:h.windows[0].webContents},{id:'missing',x:100,y:100,selection:{sessionId:opened.sessionId,rect:{x:-1,y:0,width:40,height:40}}});
 expect(user).not.toHaveBeenCalled();
 h.handlers.get(OVERLAY_SELECTION)!({sender:h.windows[0].webContents},{sessionId:opened.sessionId,rect:{x:20,y:30,width:400,height:200}});
 report({sender:h.windows[0].webContents},{id:'missing',x:100,y:100,selection:{sessionId:opened.sessionId,rect:{x:20,y:30,width:400,height:200}}});
 expect(user).toHaveBeenCalledWith({id:'missing',displayId:1,x:100,y:100,focus:{sessionId:opened.sessionId,frame,rect:{x:20,y:30,width:400,height:200}}});
 const accepted=user.mock.calls[0][0];
 h.capture.mockResolvedValue({...frame,capturedAt:'B'});mgr.handle({type:'regionOpen',x:100,y:200,wheel:'ping'});await Promise.resolve();
 report({sender:h.windows[0].webContents},{id:'assist',x:100,y:100,selection:{sessionId:opened.sessionId,rect:{x:20,y:30,width:400,height:200}}});
 expect(user).toHaveBeenCalledTimes(1);expect(accepted.focus.frame.capturedAt).toBe('A');
});
it('does not reopen a cancelled region when capture resolves late',async()=>{
 let resolve!:(frame:unknown)=>void;h.capture.mockReturnValue(new Promise(r=>{resolve=r}));
 mgr.handle({type:'regionOpen',x:100,y:200,wheel:'ping'});mgr.handle({type:'regionCancel'});
 resolve({image:{toDataURL:()=> 'old'},display:{bounds:{width:1920,height:1080}}});await Promise.resolve();
 expect(sent(0).filter(([c])=>c==='region:open')).toEqual([]);
});
it('lets the wheel open on another screen while retaining the original selection and mouse point',async()=>{
 const frame={image:{toDataURL:()=> 'data:image/png;base64,QQ=='},display:{id:1,bounds:{width:1920,height:1080}},capturedAt:'A'};
 h.capture.mockResolvedValue(frame);mgr.handle({type:'regionOpen',x:50,y:50,wheel:'ping'});await Promise.resolve();
 const sessionId=(sent(0).find(([c])=>c==='region:open')![1] as {sessionId:number}).sessionId;
 const selection={sessionId,rect:{x:20,y:30,width:400,height:200}};
 h.handlers.get(OVERLAY_SELECTION)!({sender:h.windows[0].webContents},selection);
 mgr.handle({type:'wheelOpen',x:2200,y:450,wheel:'ping'});
 expect(sent(1)).toContainEqual(['wheel:open',{x:280,y:450,wheel:'ping',selection}]);
 const user=vi.fn();mgr.on('shared',user);
 h.handlers.get(OVERLAY_PINGED)!({sender:h.windows[1].webContents},{id:'assist',x:280,y:450,selection});
 expect(user).toHaveBeenCalledWith({id:'assist',displayId:2,x:280,y:450,focus:{sessionId,frame,rect:selection.rect}});
});
