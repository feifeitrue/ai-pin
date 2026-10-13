import {
  DEFAULT_CLICK_PING, TICK_SOUND, allSoundNames, allTextureNames, pingById, pingsFor, soundUrl, textureUrl, type PingDef,
} from '../../shared/pings';
import { DEFAULT_SETTINGS, overlaySettings, type OverlaySettings } from '../../shared/settings';
import { spawnPing } from './pingFx';
import { SoundBank } from './soundBank';
import { showToast } from './toast';
import { Wheel, type WheelItem } from './wheel';
import { SelectionView } from './selection';
import type { Selection } from '../../shared/selection';

const pingLayer = document.getElementById('pings') as HTMLElement;
const toastLayer = document.getElementById('toasts') as HTMLElement;
const pingSvg = document.getElementById('wheel') as unknown as SVGSVGElement;

const sounds = new SoundBank();
const selection = new SelectionView();
let wheelSelection: Selection|undefined;
let settings: OverlaySettings = overlaySettings(DEFAULT_SETTINGS);
const [fallbackPing] = pingsFor([DEFAULT_CLICK_PING]);
const volume = (): number => (settings.muted ? 0 : settings.volume / 100);

const tick = (): void => {
  if (settings.tickSound) sounds.play(TICK_SOUND, volume() * 0.5);
};
const pingWheel = new Wheel(pingSvg, 'PING', textureUrl('generic_ping'), tick);

const pingItem = (p: PingDef): WheelItem => ({ key: p.id, icon: textureUrl(p.icon) });

function applySettings(s: OverlaySettings): void {
  settings = s;
  pingWheel.setItems(pingsFor(s.wheel).map(pingItem));
}
applySettings(settings);

function ping(def: PingDef, x: number, y: number): void {
  spawnPing(pingLayer, def, x, y, { sizePx: settings.pingSizePx, durationS: settings.pingDurationS });
  sounds.play(def.sound, volume());
}

window.overlay.on('overlay:settings', applySettings);
window.overlay.on('region:open', p=>{pingWheel.cancel();selection.open(p.sessionId,p.image);});
window.overlay.on('region:loading', ()=>{pingWheel.cancel();selection.loading();});
window.overlay.on('region:pointer', p=>selection.pointer(p));
window.overlay.on('region:close', ()=>{selection.close();pingWheel.cancel();});
window.overlay.on('wheel:open', (p) => {
  wheelSelection=p.selection;
  pingWheel.open(p.x,p.y);
});
window.overlay.on('wheel:move', (p) => pingWheel.move(p.x, p.y));
window.overlay.on('wheel:release', (p) => {
  const chosen = pingWheel.release(p.x, p.y);
  if (!chosen) return;
  const def = pingById(chosen.key) ?? fallbackPing;
  const focused=wheelSelection;
  ping(def,chosen.x,chosen.y);
  window.overlay.reportPing(def.id,chosen.x,chosen.y,focused);
  wheelSelection=undefined;
  if(focused)selection.close();
});
window.overlay.on('wheel:cancel', () => {
  pingWheel.cancel();
});
window.overlay.on('ping:spawn', (p) => ping(pingById(p.id) ?? fallbackPing, p.x, p.y));
window.overlay.on('toast:show', (t) => showToast(toastLayer, t.title, t.body));

/** Resolves with `label` when the image at `url` doesn't load. */
const probe = (url: string, label: string): Promise<string | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(null);
    img.onerror = () => resolve(label);
    img.src = url;
  });

function checkImages(): Promise<string[]> {
  const pings = allTextureNames().map((name) => probe(textureUrl(name), `textures/${name}.png`));
  return Promise.all(pings).then((r) => r.filter((x): x is string => x !== null));
}

const soundEntries = [
  ...allSoundNames().map((name) => ({ key: name, url: soundUrl(name) })),
];
const assetName = (url: string): string => url.replace(/^(?:\.{1,2}\/)+/, '');

void Promise.all([sounds.load(soundEntries), checkImages()]).then(([missingSounds, missingImages]) => {
  const missing = [...missingSounds.map(assetName), ...missingImages];
  if (missing.length > 0) window.overlay.reportMissingAssets(missing);
});
