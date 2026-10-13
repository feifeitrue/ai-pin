import { app, Menu, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import { resolveLang, strings, type Strings } from '../shared/i18n';
import { SETTINGS_CH, type About, type AppStatus } from '../shared/ipc';
import { hotkeyLabel } from '../shared/keys';
import { configCommand, type HelperStatus } from '../shared/protocol';
import { overlaySettings, type Settings } from '../shared/settings';
import { registerAppScheme, serveAppScheme } from './appProtocol';
import { AppTray, type TrayMode } from './tray';
import { InputBridge } from './inputBridge';
import { OverlayManager, type SharedPing } from './overlayManager';
import { assetPath, buildResourcePath, helperExePath, IS_MAC, PLATFORM, settingsDir } from './paths';
import { registerSettingsIpc } from './settingsIpc';
import { SettingsStore } from './settingsStore';
import { onSettingsWindowGone, openSettingsWindow, settingsWindow } from './settingsWindow';
import { startCodexNotifications } from './codexNotifications';
import { capturePing } from './aiCapture';
import { AiSendQueue } from './aiSendQueue';
import { CodexConnection, readCodexBinding, type CodexBinding } from './codexConnection';
import { sendImageToCodex } from './codexSend';
import { shouldCapturePing, aiIntentLabel } from '../shared/aiCapture';

const ACCESSIBILITY_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

registerAppScheme();
// Opt-in, isolated notification experiment: no second input hook or shared settings.
const notifyOnly = process.env.LOLPING_CODEX_NOTIFY_ONLY === '1';
if (notifyOnly) app.setPath('userData', join(app.getPath('appData'), 'lolPing-codex-preview'));
if (process.env.AIPIN_DATA_DIR) app.setPath('userData',process.env.AIPIN_DATA_DIR);
app.setAppUserModelId('com.lolping.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettingsWindow());
  app.on('activate', () => openSettingsWindow()); // macOS: opened again from Finder or Launchpad while running
  void app.whenReady().then(start);
}

/** macOS: the app, Edit and Window menus, so Cmd+Q, Cmd+W and the clipboard shortcuts work in the settings window. */
function setMacMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

function start(): void {
  serveAppScheme({
    rendererRoot: process.env.ELECTRON_RENDERER_URL ? null : join(__dirname, '../renderer'), // development pages come from Vite
  });
  if (IS_MAC) {
    app.dock?.hide(); // a menu bar app: the Dock icon only shows while settings are open
    setMacMenu();
  }
  const store = new SettingsStore(settingsDir(), undefined, PLATFORM);
  let settings = store.load();
  if (process.env.LOLPING_CODEX_BINDING && !settings.aiBindingFile) {
    settings = store.update({ aiBindingFile: process.env.LOLPING_CODEX_BINDING });
  }
  const codex=new CodexConnection(store);
  // The language setting, or the system display language when it's 'auto'.
  const text = (): Strings => strings(resolveLang(settings.language, app.getLocale()), PLATFORM);
  let enabled = settings.enabledOnStart;
  let quitting = false; // read by pushStatus: once true, the tray and overlays are gone
  let capturing = false; // the settings page is listening for a key, so the helper must stay suspended

  const overlays = new OverlayManager(overlaySettings(settings));
  overlays.start();
  overlays.setCaptureExcluded(settings.aiMode && !IS_MAC);
  const notifyCodex:Parameters<typeof startCodexNotifications>[1]=(event,pendingCount)=>{
      if (quitting) return;
      if (event.kind === 'needs-input') {
        overlays.previewPing('assist');
        overlays.toast('Codex 需要你协助', event.summary ?? '请回到对应聊天处理');
      } else if (event.kind === 'input-resolved') {
        overlays.toast('Codex 已收到回答', pendingCount ? `还有 ${pendingCount} 个问题待处理` : '待回答提醒已清除');
      } else if (event.kind === 'completed') {
        overlays.previewPing('omw');
        overlays.toast('Codex 本轮已结束', pendingCount ? `仍有 ${pendingCount} 个问题待处理` : '请回到聊天查看结果');
      } else if (event.kind === 'failed' || event.kind === 'interrupted') {
        overlays.previewPing('danger');
        overlays.toast(event.kind === 'failed' ? 'Codex 本轮失败' : 'Codex 本轮已中断', '请回到聊天查看详情');
      } else if (event.kind === 'result-saved') {
        overlays.toast(event.intent === 'note' ? '笔记已保存' : 'AI 处理完成', event.summary ?? '请在接收聊天中查看结果');
      }
      const {summary:_summary,...notice}=event;
      console.log('[codex-notification]', JSON.stringify({ at: new Date().toISOString(), ...notice, pendingCount }));
    };
  let stopCodex=()=>{};
  let notificationBinding='';
  const watchCodex=(file:string)=>{
    if(file===notificationBinding)return;
    stopCodex();notificationBinding=file;
    stopCodex=file?startCodexNotifications(file,notifyCodex):()=>{};
  };
  watchCodex(settings.aiBindingFile);
  void codex.restore().catch(e=>overlays.toast('Codex 连接待恢复',e instanceof Error?e.message:String(e)));
  const bridge = new InputBridge({ command: helperExePath() });
  overlays.on('regionClosed',()=>bridge.send({type:'regionClose'}));

  // macOS Accessibility. Without it the helper can't create its event tap, so it isn't started: a timer waits for
  // the permission instead. `staleAccess`: macOS lists lolPing as allowed, yet the helper still has no access.
  let accessTimer: NodeJS.Timeout | null = null;
  let staleAccess = false;
  const trusted = (): boolean => !IS_MAC || systemPreferences.isTrustedAccessibilityClient(false);
  const stopWaitingForAccess = (): void => {
    if (accessTimer) clearInterval(accessTimer);
    accessTimer = null;
  };
  const waitForAccess = (): void => {
    if (accessTimer) return;
    accessTimer = setInterval(() => {
      if (!trusted()) return;
      stopWaitingForAccess();
      staleAccess = false;
      bridge.retry();
    }, 1500);
    overlays.cancelWheel();
    pushStatus();
  };
  const startHelper = (): void => {
    staleAccess = false;
    if (trusted()) bridge.retry();
    else waitForAccess();
  };

  const helperStatus = (): HelperStatus => (accessTimer ? 'noAccess' : bridge.status);
  const status = (): AppStatus => ({ enabled, helper: helperStatus(), staleAccess });
  const trayMode = (): TrayMode => {
    const h = helperStatus();
    if (h === 'failed' || h === 'noAccess') return h;
    return enabled ? 'on' : 'off';
  };
  const tray = new AppTray(
    assetPath('textures', 'generic_ping.png'),
    {
      openSettings: () => openSettingsWindow(),
      setEnabled: (on) => setEnabled(on),
      retryHelper: startHelper,
      quit: () => app.quit(),
    },
    text(),
    IS_MAC ? { on: buildResourcePath('trayTemplate.png'), off: buildResourcePath('trayOffTemplate.png') } : undefined,
  );
  const aiQueue = new AiSendQueue<SharedPing & { binding: CodexBinding }, Awaited<ReturnType<typeof capturePing>>>({
    capture: capturePing,
    send: async (p, captured) => {
      overlays.toast(`正在发送：${aiIntentLabel(p.id)}`, p.focus ? '分析你框选的画面，发信号位置不改变范围' : '截图包含信号所在屏幕和你指的位置');
      await sendImageToCodex(p.binding, captured.path, captured.instruction);
      overlays.toast(`已发送：${aiIntentLabel(p.id)}`, '请在截图接收聊天中查看处理结果');
      console.log('[codex-image]', JSON.stringify({ ...captured, displayId: p.focus?.frame.display.id ?? p.displayId, signalDisplayId:p.displayId }));
    },
    failed: (_p, error, captured) => {
      console.error('[codex-image-error]', error);
      overlays.toast(captured ? '截图已保存，发送未确认' : '截图失败', error instanceof Error ? error.message : String(error));
    },
  });
  function explainPing(p: SharedPing): void {
    if (!shouldCapturePing(settings.aiMode, enabled, p.id) || notifyOnly) return;
    const binding = settings.aiBindingFile;
    if (!binding) { overlays.toast('Codex 尚未连接', '请在设置中点击连接 Codex'); return; }
    let destination:CodexBinding;
    try{destination=readCodexBinding(binding);if(binding===codex.bindingFile)destination.threadId=settings.aiThreadId;}
    catch{overlays.toast('Codex 尚未连接','请在设置中点击连接 Codex');return;}
    const pending = aiQueue.enqueue({ ...p, binding:destination });
    if (pending > 1) overlays.toast(`已排队：${aiIntentLabel(p.id)}`, `还有 ${pending} 项正在截图或发送`);
  }
  overlays.on('shared', explainPing);

  function pushStatus(): void {
    if (quitting) return;
    tray.set(trayMode(), enabled);
    settingsWindow()?.webContents.send(SETTINGS_CH.statusChanged, status());
  }
  const about = (): About => ({
    version: app.getVersion(),
    problems: [
      ...store.problems,
      ...[...overlays.missingAssets].map((a) => text().missingAsset(a)),
    ],
    limitations: text().limitations,
  });

  function setEnabled(on: boolean): void {
    if (on === enabled) return;
    enabled = on;
    bridge.send(configCommand(store.get(), enabled)); // also refreshes the config re-sent after restarts
    const t = text();
    overlays.toast(on ? t.toastOn : t.toastOff, t.toastToggleHint(hotkeyLabel(store.get().toggleHotkey, PLATFORM)));
    pushStatus();
  }

  bridge.on('event', (ev) => {
    if (ev.type === 'toggled') setEnabled(ev.enabled);
    else if (ev.type === 'ready') {
      // A restarted helper starts unsuspended: re-apply an active key capture.
      if (capturing) bridge.send({ type: 'suspend', on: true });
    } else if (ev.type === 'error') console.warn('[helper]', ev.code ?? '', ev.message);
    else overlays.handle(ev);
  });
  bridge.on('status', (s: HelperStatus) => {
    // A helper that is starting or has stopped can no longer send the cancel that dismisses a wheel left on screen.
    if (s !== 'running') { overlays.cancelWheel(); overlays.cancelRegion(); }
    if (s === 'noAccess') {
      // Allowed but still refused is an entry left over from an earlier build. Otherwise wait for the user to allow it.
      if (trusted()) staleAccess = true;
      else waitForAccess();
      openSettingsWindow();
    }
    pushStatus();
    if (s === 'failed') overlays.toast(text().toastHelperStopped, text().toastHelperStoppedBody);
  });
  bridge.on('log', (line: string) => console.log('[helper]', line));

  store.on('change', (s: Settings) => {
    const previous = settings;
    settings = s;
    watchCodex(s.aiBindingFile);
    bridge.send(configCommand(s, enabled));
    overlays.updateSettings(overlaySettings(s));
    if (s.aiMode !== previous.aiMode) overlays.setCaptureExcluded(s.aiMode && !IS_MAC);
    settingsWindow()?.webContents.send(SETTINGS_CH.changed, s);
    if (s.language !== previous.language) tray.setText(text());
    if (app.isPackaged && s.launchAtStartup !== previous.launchAtStartup) {
      // macOS ignores args, and a Mac launch starts in the menu bar anyway.
      app.setLoginItemSettings(IS_MAC ? { openAtLogin: s.launchAtStartup } : { openAtLogin: s.launchAtStartup, args: ['--hidden'] });
    }
  });

  registerSettingsIpc({
    store,
    codex,
    getStatus: status,
    setEnabled,
    preview: (id) => overlays.previewPing(id),
    about,
    retryHelper: startHelper,
    setCapturing: (on) => {
      capturing = on;
      bridge.send({ type: 'suspend', on });
    },
    openAccessibility: () => {
      systemPreferences.isTrustedAccessibilityClient(true); // adds lolPing to the list and shows the system prompt
      void shell.openExternal(ACCESSIBILITY_PANE);
      if (!trusted()) waitForAccess();
    },
    text,
    platform: PLATFORM,
  });
  // The page can't report that it went away mid-capture (window closed, renderer crashed): release the suspend here.
  onSettingsWindowGone(() => {
    if (!capturing) return;
    capturing = false;
    bridge.send({ type: 'suspend', on: false });
  });

  bridge.send(configCommand(settings, enabled));
  if (notifyOnly) { /* Notification preview must not intercept input. */ }
  else if (trusted()) bridge.start();
  else waitForAccess();
  pushStatus();
  if (IS_MAC) {
    // A menu bar app: open settings only when there is something to do, otherwise point at the menu bar icon.
    if (store.firstRun || !trusted()) openSettingsWindow();
    else overlays.toast(text().toastMenuBar, text().toastMenuBarBody);
  } else if (!process.argv.includes('--hidden')) {
    openSettingsWindow(store.firstRun?'codex':undefined);
  }


  app.on('window-all-closed', () => {
    /* stay running: the overlays are the app */
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    stopCodex();
    event.preventDefault();
    stopWaitingForAccess();
    tray.destroy();
    overlays.destroy();
    void Promise.allSettled([bridge.stop(), store.flush()]).then(() => app.exit(0));
  });
}
