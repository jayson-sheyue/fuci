'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fuci', {
  lookup: (payload) => ipcRenderer.invoke('lookup', payload),
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  setSourcePin: (source) => ipcRenderer.invoke('settings:source-pin', source),
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
});
