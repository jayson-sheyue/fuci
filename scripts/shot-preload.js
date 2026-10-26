'use strict';

const { contextBridge } = require('electron');
const { t } = require('../src/renderer/i18n');

contextBridge.exposeInMainWorld('fuci', {
  translate: (locale, key, vars) => t(locale, key, vars),
  bootstrap: async () => ({
    settings: {
      theme: 'sky',
      uiLocale: 'zh',
      panelOpacity: 0.92,
      target: 'zh-CN',
      pair: 'en-zh',
      projectId: 'demo-project',
      location: 'global',
      model: 'gemini-3.8-flash',
      openAtLogin: false,
    },
    auth: { signedIn: true, expired: false, expiresAt: Date.now() + 46 * 60 * 1000 },
    shortcutLabel: '⌘⇧Space',
    version: '1.3.3',
    update: { available: false },
    maxBoardHeight: 640,
  }),
  updateStatus: async () => ({ available: false }),
  authStatus: async () => ({ signedIn: true, expired: false, expiresAt: Date.now() + 46 * 60 * 1000 }),
  onUpdateStatus: () => {},
  onAuthProgress: () => () => {},
  onProgress: () => {},
  onFocusSearch: () => {},
  onOpenSettings: () => {},
  setHeight: () => {},
  setMode: () => {},
  setIgnoreMouse: () => {},
  moveBy: () => {},
  setDragging: () => {},
  saveSettings: async () => ({ ok: true, settings: {} }),
  quit: () => {},
  restart: () => {},
  cancelLookup: () => {},
  copy: async () => true,
  speak: async () => ({ ok: false }),
  lookup: async () => ({ kind: 'empty' }),
  setPair: async () => ({ ok: true, settings: {} }),
  applyUpdate: async () => ({ ok: false }),
  connectGoogle: async () => ({ ok: false }),
});
