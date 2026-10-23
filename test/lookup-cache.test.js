'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lookup } = require('../src/main/gcp');
const { setFetchImplementation } = require('../src/main/http');
const lookupCache = require('../src/main/lookup-cache');

const settings = {
  projectId: 'demo',
  target: 'zh-CN',
  pair: 'en-zh',
  model: 'gemini-3.8-flash',
  location: 'global',
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-cache-'));
}

test('lookup cache survives restart and skips the network', async () => {
  const dir = tempDir();
  const originalFetch = globalThis.fetch;
  setFetchImplementation(() => {
    throw new Error('should not call the network');
  });
  try {
    lookupCache.configure(dir);
    lookupCache.put(settings, 'word', 'en', 'apple', {
      kind: 'word',
      translation: '苹果',
      dictionary: { headword: 'apple' },
    });
    lookupCache.flush();

    lookupCache.configure(dir);
    const stored = lookupCache.read(settings, 'word', 'en', 'Apple');
    assert.equal(stored.translation, '苹果');
    assert.equal(lookupCache.read(settings, 'word', 'en', 'apple').dictionary.headword, 'apple');
    assert.equal(lookupCache.read({ ...settings, target: 'zh-TW' }, 'word', 'en', 'apple'), null);

    const result = await lookup('Apple', settings, {});
    assert.equal(result.translation, '苹果');
    assert.equal(result.query, 'Apple');
    assert.equal(result.pinned, false);

    await assert.rejects(
      () => lookup('apple', { ...settings, pair: 'ja-zh' }, {}),
      (error) => error.message === 'TOKEN_EXPIRED'
    );

    lookupCache.put(settings, 'word', 'en', '12345', {
      kind: 'word',
      translation: '数字',
    });
    const numbers = await lookup('12345', settings, {});
    assert.equal(numbers.translation, '数字');
    assert.equal(numbers.query, '12345');

    lookupCache.clear();
    assert.equal(lookupCache.read(settings, 'word', 'en', 'apple'), null);
    assert.equal(fs.readFileSync(path.join(dir, 'lookup-cache.json'), 'utf8').includes('apple'), false);
  } finally {
    setFetchImplementation(originalFetch);
    lookupCache.clear();
    lookupCache.configure('');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lookup cache keeps the newest entries', () => {
  const dir = tempDir();
  try {
    lookupCache.configure(dir);
    for (let i = 0; i < lookupCache.MAX_ENTRIES + 1; i += 1) {
      lookupCache.put(settings, 'word', 'en', `word${i}`, { kind: 'word', translation: String(i) });
    }
    assert.equal(lookupCache.read(settings, 'word', 'en', 'word0'), null);
    assert.equal(lookupCache.read(settings, 'word', 'en', `word${lookupCache.MAX_ENTRIES}`).translation, String(lookupCache.MAX_ENTRIES));
  } finally {
    lookupCache.clear();
    lookupCache.configure('');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
