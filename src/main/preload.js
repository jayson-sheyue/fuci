'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fuci', {
  lookup: (payload) => ipcRenderer.invoke('lookup', payload),
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  setPair: (pair) => ipcRenderer.invoke('settings:pair', pair),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  connectGoogle: (settings) => ipcRenderer.invoke('auth:connect', settings),
  testSettings: (settings) => ipcRenderer.invoke('settings:test', settings),
  pickKeyFile: () => ipcRenderer.invoke('settings:pick-key'),
  setHeight: (height) => ipcRenderer.send('window:height', height),
  setMode: (mode) => ipcRenderer.send('window:mode', mode),
  setIgnoreMouse: (ignore) => ipcRenderer.send('window:ignore-mouse', ignore),
  moveBy: (dx, dy) => ipcRenderer.send('window:move-by', dx, dy),
  setDragging: (active) => ipcRenderer.send('window:dragging', active),
  hideWindow: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  restart: () => ipcRenderer.send('app:restart'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
  cancelLookup: () => ipcRenderer.send('lookup:cancel'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  speak: (payload) => ipcRenderer.invoke('speak', payload),
  onProgress: (handler) => {
    ipcRenderer.on('lookup-progress', (_event, payload) => handler(payload));
  },
  onFocusSearch: (handler) => {
    ipcRenderer.on('focus-search', () => handler());
  },
  onOpenSettings: (handler) => {
    ipcRenderer.on('open-settings', () => handler());
  },
  onUpdateStatus: (handler) => {
    ipcRenderer.on('update-status', (_event, payload) => handler(payload));
  },
});
