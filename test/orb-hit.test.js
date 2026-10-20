'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { orbHit } = require('../src/main/orb-hit');

test('hover stays on the orb after the cursor leaves the painted circle', () => {
  const size = 116;
  assert.equal(orbHit(58, 58, size, size, false), true);
  assert.equal(orbHit(10, 10, size, size, false), false);
  assert.equal(orbHit(10, 10, size, size, true), true);
  assert.equal(orbHit(-40, 58, size, size, true), false);
});
