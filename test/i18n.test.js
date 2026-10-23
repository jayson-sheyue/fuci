'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogs, normalizeLocale, setLocale, t } = require('../src/renderer/i18n');
const { explainGcpError } = require('../src/main/errors');

test('Chinese, Japanese, and English share the same interface strings', () => {
  const zh = Object.keys(catalogs.zh).sort();
  assert.deepEqual(Object.keys(catalogs.ja).sort(), zh);
  assert.deepEqual(Object.keys(catalogs.en).sort(), zh);
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('ja-JP'), 'ja');
  assert.equal(normalizeLocale(''), 'zh');
  assert.equal(t('en', 'word'), 'Word');
  assert.equal(t('ja', 'sentence'), '文');
  assert.equal(t('zh', 'lemma', { word: 'go' }), '原形 go');
});

test('setup errors follow the selected interface language', () => {
  setLocale('en');
  const missing = explainGcpError(new Error('TOKEN_EXPIRED'));
  assert.match(missing.message, /Connect again in Settings/);
  setLocale('zh');
  assert.match(explainGcpError(new Error('TOKEN_EXPIRED')).message, /一键登录/);
});
