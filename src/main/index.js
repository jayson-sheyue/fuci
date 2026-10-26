'use strict';

const { app, BrowserWindow, Menu, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, net, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { explainGcpError } = require('./errors');
const { lookup, testConnection, clearAuth, configureLookupCache, flushLookupCache } = require('./gcp');
const { checkForUpdate, applyUpdate } = require('./update');
const { normalizePair } = require('./classify');
const { synthesize } = require('./tts');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const { alignSession, beginLogin, configureSession, sessionStatus } = require('./oauth');
const { setFetchImplementation } = require('./http');
const { orbHit } = require('./orb-hit');
const { normalizeLocale, setLocale, tr } = require('../renderer/i18n');
const { adcExists, effectiveProjectId, load, normalizeTheme, readGcloudProject, save } = require('./settings');

setFetchImplementation((url, options = {}) => net.fetch(url, {
  method: options.method,
  headers: options.headers,
  body: options.body,
  signal: options.signal,
}));

app.setName('浮词');

const WINDOW_WIDTH = 520;
const ORB_WINDOW = 116;
let windowMode = 'bar';
const SHORTCUTS = [
  { accelerator: 'CommandOrControl+Shift+Space', label: '⌘⇧Space' },
  { accelerator: 'CommandOrControl+Shift+D', label: '⌘⇧D' },
];

let win = null;
let tray = null;
let quitting = false;
let shortcutLabel = '';
let lookupJob = null;
let ignoreMouse = false;
let draggingWindow = false;
let orbHovering = false;
let updateState = { available: false };
let updateTimer = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function asset(name) {
  return path.join(__dirname, '../../assets', name);
}

function maxBoardHeight() {
  const area = screen.getPrimaryDisplay().workArea;
  return Math.max(220, Math.min(580, area.height - 180));
}

function defaultOrigin() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + (area.width - WINDOW_WIDTH) / 2),
    y: Math.round(area.y + area.height * 0.16),
  };
}

function boundsVisible(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return bounds.x < area.x + area.width - 80
      && bounds.x + 80 > area.x
      && bounds.y < area.y + area.height - 40
      && bounds.y + 40 > area.y;
  });
}

function createWindow() {
  const settings = load(app.getPath('userData'));
  const origin = settings.bounds && boundsVisible(settings.bounds) ? settings.bounds : defaultOrigin();
  win = new BrowserWindow({
    x: origin.x,
    y: origin.y,
    width: WINDOW_WIDTH,
    height: 96,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    roundedCorners: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'floating');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  let moveTimer = null;
  win.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const bounds = win.getBounds();
      save(app.getPath('userData'), { bounds: { x: bounds.x, y: bounds.y } });
    }, 250);
  });

  win.once('ready-to-show', () => {
    win.showInactive();
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (!boundsVisible(win.getBounds())) {
    const origin = defaultOrigin();
    win.setBounds({ ...win.getBounds(), x: origin.x, y: origin.y });
  }
  win.show();
  win.focus();
  app.focus({ steal: true });
  win.webContents.send('focus-search');
}

function hideWindow() {
  if (!win || win.isDestroyed()) return;
  win.hide();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  for (const item of SHORTCUTS) {
    if (globalShortcut.register(item.accelerator, toggleWindow)) {
      shortcutLabel = item.label;
      return;
    }
  }
  shortcutLabel = '';
}

function buildMenu() {
  const template = [
    {
      label: '浮词',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: tr('menuSettings'),
          accelerator: 'Command+,',
          click: () => {
            showWindow();
            win.webContents.send('open-settings');
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: tr('menuWindow'),
      submenu: [
        { label: shortcutLabel ? tr('menuShowSearch', { shortcut: shortcutLabel }) : tr('menuShow'), click: showWindow },
        { label: tr('menuHide'), click: hideWindow },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray() {
  const image = nativeImage.createFromPath(asset('trayTemplate.png'));
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('浮词');
  const refresh = () => {
    const settings = load(app.getPath('userData'));
    const project = effectiveProjectId(settings) || tr('trayUnset');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: tr('trayShow'), click: showWindow },
      { label: tr('trayProject', { project }), enabled: false },
      { type: 'separator' },
      {
        label: tr('trayLogin'),
        type: 'checkbox',
        checked: settings.openAtLogin,
        click: (item) => {
          const next = save(app.getPath('userData'), { openAtLogin: item.checked });
          applyLogin(next.openAtLogin);
          refresh();
        },
      },
      { type: 'separator' },
      { label: tr('trayQuit'), click: () => app.quit() },
    ]));
  };
  refresh();
  tray.on('click', toggleWindow);
  tray.refreshMenu = refresh;
}

function applyLogin(openAtLogin) {
  app.setLoginItemSettings({ openAtLogin: !!openAtLogin, openAsHidden: false });
}

function refreshLocaleChrome() {
  setLocale(load(app.getPath('userData')).uiLocale);
  app.setAboutPanelOptions({
    applicationName: '浮词',
    applicationVersion: clientVersion(),
    credits: tr('aboutCredits'),
  });
  buildMenu();
  tray?.refreshMenu?.();
}

function currentSettings() {
  const stored = load(app.getPath('userData'));
  return { ...stored, projectId: effectiveProjectId(stored) };
}

function normalizeForm(input) {
  const projectId = String(input?.projectId || '').trim();
  const location = String(input?.location || 'global').trim() || 'global';
  const model = String(input?.model || 'gemini-3.8-flash').trim() || 'gemini-3.8-flash';
  const target = input?.target === 'zh-TW' ? 'zh-TW' : 'zh-CN';
  const openAtLogin = !!input?.openAtLogin;
  const panelOpacity = clampPanelOpacity(input?.panelOpacity);
  const theme = normalizeTheme(input?.theme);
  const uiLocale = normalizeLocale(input?.uiLocale);
  if (/\s/.test(projectId)) throw new Error(tr('errProjectSpace'));
  if (!/^[a-z0-9-]{1,40}$/i.test(location)) throw new Error(tr('errLocation'));
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(model)) throw new Error(tr('errModel'));
  return { projectId, location, model, oauthClientId: '', oauthClientSecret: '', target, openAtLogin, panelOpacity, theme, uiLocale };
}

function clampPanelOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.88;
  return Math.min(1, Math.max(0.4, Math.round(number * 100) / 100));
}

function clientVersion() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    if (raw.version) return String(raw.version);
  } catch {
    /* The bundle version still covers a packaged app whose package.json cannot be read. */
  }
  return app.getVersion();
}

function publicSettings(settings) {
  return {
    projectId: settings.projectId || '',
    location: settings.location || 'global',
    model: settings.model || 'gemini-3.8-flash',
    target: settings.target === 'zh-TW' ? 'zh-TW' : 'zh-CN',
    pair: normalizePair(settings.pair, settings),
    openAtLogin: !!settings.openAtLogin,
    panelOpacity: clampPanelOpacity(settings.panelOpacity),
    theme: normalizeTheme(settings.theme),
    uiLocale: normalizeLocale(settings.uiLocale),
  };
}

function publishUpdate(status) {
  updateState = { available: !!status?.available };
  if (win && !win.isDestroyed()) win.webContents.send('update-status', updateState);
}

async function refreshUpdate() {
  try {
    publishUpdate(await checkForUpdate(app.getAppPath()));
  } catch {
    publishUpdate({ available: false });
  }
}

function registerIpc() {
  ipcMain.handle('bootstrap', () => {
    const stored = load(app.getPath('userData'));
    return {
      settings: publicSettings(stored),
      auth: sessionStatus(),
      gcloudProject: readGcloudProject(),
      adcFound: adcExists(),
      shortcutLabel,
      version: clientVersion(),
      maxBoardHeight: maxBoardHeight(),
      update: updateState,
    };
  });

  ipcMain.handle('update:status', () => updateState);

  ipcMain.handle('update:apply', async () => {
    try {
      await applyUpdate(app.getAppPath());
      setImmediate(() => {
        app.relaunch();
        app.quit();
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || tr('errUpdate') };
    }
  });

  ipcMain.handle('settings:save', (_event, input) => {
    try {
      const next = save(app.getPath('userData'), normalizeForm(input));
      applyLogin(next.openAtLogin);
      alignSession(next);
      clearAuth();
      refreshLocaleChrome();
      return { ok: true, settings: publicSettings(next), auth: sessionStatus() };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  ipcMain.handle('settings:test', async (_event, input) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const next = save(app.getPath('userData'), normalizeForm(input));
      applyLogin(next.openAtLogin);
      alignSession(next);
      clearAuth();
      refreshLocaleChrome();
      const message = await testConnection(currentSettings(), controller.signal);
      return { ok: true, message };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { ok: false, message: tr('errTestTimeout'), detail: '' };
      }
      const explained = explainGcpError(error);
      const prefix = error.phase === 'dictionary' ? tr('errDictPrefix') : '';
      return {
        ok: false,
        message: prefix ? `${prefix}${explained.message}` : explained.message,
        detail: explained.detail,
        needsSetup: explained.needsSetup,
      };
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle('auth:status', () => sessionStatus());

  ipcMain.handle('auth:connect', async (_event, input) => {
    try {
      const next = save(app.getPath('userData'), normalizeForm(input));
      applyLogin(next.openAtLogin);
      alignSession(next);
      refreshLocaleChrome();
      const auth = await beginLogin(next, {
        onProgress: (payload) => {
          if (win && !win.isDestroyed()) win.webContents.send('auth-progress', payload);
        },
      });
      return { ok: true, auth, settings: publicSettings(next) };
    } catch (error) {
      return { ok: false, message: error.message || tr('errLogin'), auth: sessionStatus() };
    }
  });

  ipcMain.handle('settings:pick-key', async () => {
    if (win && !win.isDestroyed()) {
      ignoreMouse = false;
      win.setIgnoreMouseEvents(false);
    }
    const result = await dialog.showOpenDialog(win, {
      title: tr('pickKey'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return '';
    return result.filePaths[0];
  });

  ipcMain.handle('speak', async (_event, payload) => {
    try {
      const audio = await synthesize(payload?.text, payload?.lang, currentSettings());
      return { ok: true, audio };
    } catch (error) {
      if (error.name === 'AbortError') return { ok: false, message: tr('errPlayCancel') };
      const explained = explainGcpError(error);
      return { ok: false, message: explained.message };
    }
  });

  ipcMain.handle('settings:pair', (_event, pair) => {
    const next = save(app.getPath('userData'), { pair: normalizePair(pair) });
    return { ok: true, settings: publicSettings(next) };
  });

  ipcMain.handle('lookup', async (event, payload) => {
    const text = typeof payload?.text === 'string' ? payload.text : '';
    const id = payload?.id;
    if (lookupJob) {
      lookupJob.reason = 'replace';
      lookupJob.controller.abort();
    }
    const controller = new AbortController();
    lookupJob = { id, controller, reason: '' };
    const timer = setTimeout(() => {
      if (lookupJob?.id !== id) return;
      lookupJob.reason = 'timeout';
      lookupJob.controller.abort();
    }, 45000);
    try {
      return await lookup(text, currentSettings(), {
        signal: controller.signal,
        onProgress: (result) => {
          if (lookupJob?.id !== id || !win || win.isDestroyed()) return;
          event.sender.send('lookup-progress', { id, result });
        },
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        if (lookupJob?.id === id && lookupJob.reason === 'timeout') {
          return { kind: 'error', message: tr('errLookupTimeout') };
        }
        return { kind: 'aborted' };
      }
      const explained = explainGcpError(error);
      return { kind: 'error', ...explained };
    } finally {
      clearTimeout(timer);
      if (lookupJob?.id === id) lookupJob = null;
    }
  });

  ipcMain.handle('copy', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  function placeWindow(width, height, animate) {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds).workArea;
    const nextWidth = Math.round(width);
    const nextHeight = Math.min(Math.round(height), Math.max(96, display.height - 24));
    let x = bounds.x;
    let y = bounds.y;
    if (x + nextWidth > display.x + display.width - 8) {
      x = Math.max(display.x + 8, display.x + display.width - 8 - nextWidth);
    }
    if (y + nextHeight > display.y + display.height - 8) {
      y = Math.max(display.y + 8, display.y + display.height - 8 - nextHeight);
    }
    if (bounds.x === x && bounds.y === y && bounds.width === nextWidth && bounds.height === nextHeight) return;
    win.setBounds({ x, y, width: nextWidth, height: nextHeight }, animate);
  }

  ipcMain.on('window:mode', (_event, mode) => {
    const next = mode === 'orb' ? 'orb' : 'bar';
    if (next === windowMode) return;
    windowMode = next;
    if (next === 'orb') placeWindow(ORB_WINDOW, ORB_WINDOW, true);
  });

  ipcMain.on('window:height', (_event, height) => {
    if (windowMode === 'orb') return;
    const requested = Math.round(Number(height) || 96);
    const nextHeight = Math.max(requested, 80);
    placeWindow(WINDOW_WIDTH, nextHeight, false);
  });

  function cursorHitsWidget() {
    if (!win || win.isDestroyed() || !win.isVisible()) {
      orbHovering = false;
      return false;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;
    if (windowMode === 'orb') {
      orbHovering = orbHit(x, y, bounds.width, bounds.height, orbHovering);
      return orbHovering;
    }
    orbHovering = false;
    const onCapsule = x >= 12 && x <= bounds.width - 12 && y >= 16 && y <= 82;
    const onBoard = bounds.height > 110 && x >= 12 && x <= bounds.width - 12 && y >= 76 && y <= bounds.height - 10;
    return onCapsule || onBoard;
  }

  function syncMousePassthrough() {
    if (!win || win.isDestroyed()) return;
    const ignore = draggingWindow ? false : !cursorHitsWidget();
    if (ignore === ignoreMouse) return;
    ignoreMouse = ignore;
    win.setIgnoreMouseEvents(ignore, { forward: true });
  }

  ipcMain.on('window:ignore-mouse', () => {
    syncMousePassthrough();
  });

  ipcMain.on('window:move-by', (_event, dx, dy) => {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const dxNum = Number(dx);
    const dyNum = Number(dy);
    win.setPosition(
      Math.round(bounds.x + (Number.isFinite(dxNum) ? dxNum : 0)),
      Math.round(bounds.y + (Number.isFinite(dyNum) ? dyNum : 0)),
    );
  });

  ipcMain.on('window:dragging', (_event, active) => {
    draggingWindow = !!active;
    syncMousePassthrough();
  });

  ipcMain.on('window:hide', () => hideWindow());

  ipcMain.on('app:quit', () => app.quit());

  ipcMain.on('app:restart', () => {
    app.relaunch();
    app.quit();
  });

  ipcMain.on('lookup:cancel', () => {
    if (!lookupJob) return;
    lookupJob.reason = 'cancel';
    lookupJob.controller.abort();
  });

  setInterval(() => {
    if (quitting) return;
    syncMousePassthrough();
  }, 32);
}

app.on('second-instance', () => showWindow());
app.on('activate', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
  flushLookupCache();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
if (gotLock) app.whenReady().then(() => {
  const icon = nativeImage.createFromPath(asset('icon.png'));
  if (process.platform === 'darwin' && app.dock && !icon.isEmpty()) app.dock.setIcon(icon);
  refreshLocaleChrome();
  configureSession(app.getPath('userData'));
  configureLookupCache(app.getPath('userData'));
  alignSession(load(app.getPath('userData')));
  createWindow();
  registerShortcut();
  buildMenu();
  buildTray();
  registerIpc();
  refreshUpdate();
  updateTimer = setInterval(() => {
    if (!quitting) refreshUpdate();
  }, 6 * 60 * 60 * 1000);
  if (updateTimer.unref) updateTimer.unref();
  const stored = load(app.getPath('userData'));
  if (stored.openAtLogin) applyLogin(true);
});
