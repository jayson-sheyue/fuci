'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { THEME_IDS, normalizeTheme } = require('../src/main/settings');

test('settings accept the seven preset themes', () => {
  assert.deepEqual(THEME_IDS, ['sky', 'bamboo', 'cinnabar', 'wisteria', 'amber', 'haitang', 'night']);
  assert.equal(normalizeTheme('night'), 'night');
  assert.equal(normalizeTheme('haitang'), 'haitang');
  assert.equal(normalizeTheme(''), 'sky');
  assert.equal(normalizeTheme('neon'), 'sky');
});
