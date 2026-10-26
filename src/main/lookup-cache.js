'use strict';

const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 400;
const VERSION = 3;

const entries = new Map();
let filePath = '';
let dirty = false;
let timer = null;

function scopeParts(settings) {
  return [
    settings.projectId || '',
    settings.pair || '',
    settings.target || '',
    settings.model || '',
    settings.location || '',
  ];
}

function cacheScope(settings) {
  return JSON.stringify(scopeParts(settings));
}

function entryKey(settings, kind, lang, text) {
  const normalized = lang === 'en' ? text.toLowerCase() : text;
  return {
    key: JSON.stringify([...scopeParts(settings), kind, lang, normalized]),
    normalized,
  };
}

function clone(value) {
  return structuredClone(value);
}

function trim() {
  while (entries.size > MAX_ENTRIES) {
    entries.delete(entries.keys().next().value);
  }
}

function serialize() {
  const list = [];
  for (const [key, item] of entries) {
    list.push({ key, scope: item.scope, text: item.text, value: item.value });
  }
  return JSON.stringify({ version: VERSION, entries: list });
}

function load() {
  entries.clear();
  if (!filePath) return;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || raw.version !== VERSION || !Array.isArray(raw.entries)) return;
    for (const item of raw.entries) {
      if (!item || typeof item.key !== 'string' || !item.value || typeof item.value !== 'object') continue;
      entries.set(item.key, {
        scope: String(item.scope || ''),
        text: String(item.text || ''),
        value: item.value,
      });
    }
    trim();
  } catch {
    entries.clear();
  }
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (!filePath || !dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, serialize());
    fs.renameSync(tmp, filePath);
  } catch {
    dirty = true;
  }
}

function schedule() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}

function configure(dir) {
  flush();
  filePath = dir ? path.join(dir, 'lookup-cache.json') : '';
  dirty = false;
  load();
}

function touch(key) {
  const item = entries.get(key);
  if (!item) return null;
  entries.delete(key);
  entries.set(key, item);
  schedule();
  return clone(item.value);
}

function read(settings, kind, lang, text) {
  return touch(entryKey(settings, kind, lang, text).key);
}

function find(settings, text) {
  const scope = cacheScope(settings);
  const needle = String(text || '').toLowerCase();
  let matchKey = '';
  for (const [key, item] of entries) {
    if (item.scope !== scope) continue;
    if (item.text.toLowerCase() !== needle) continue;
    matchKey = key;
  }
  return matchKey ? touch(matchKey) : null;
}

function put(settings, kind, lang, text, value) {
  const { key, normalized } = entryKey(settings, kind, lang, text);
  if (entries.has(key)) entries.delete(key);
  entries.set(key, {
    scope: cacheScope(settings),
    text: normalized,
    value: clone(value),
  });
  trim();
  schedule();
}

function clear() {
  entries.clear();
  dirty = true;
  flush();
}

module.exports = {
  MAX_ENTRIES,
  cacheScope,
  configure,
  flush,
  read,
  find,
  put,
  clear,
};
