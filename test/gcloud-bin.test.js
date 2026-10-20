'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bundledGcloudPath, gcloudCandidates } = require('../src/main/oauth');

test('the bundled gcloud is preferred over a system install', () => {
  const bundled = bundledGcloudPath();
  assert.match(bundled, /google-cloud-sdk\/bin\/gcloud$/);
  assert.equal(gcloudCandidates()[0], bundled);
});
