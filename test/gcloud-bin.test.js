'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bundledGcloudPath,
  bundledPythonFor,
  gcloudCandidates,
  launchEnv,
  pythonReleaseSupported,
} = require('../src/main/oauth');

test('the bundled gcloud is preferred over a system install', () => {
  const bundled = bundledGcloudPath();
  assert.match(bundled, /google-cloud-sdk\/bin\/gcloud$/);
  assert.equal(gcloudCandidates()[0], bundled);
});

test('gcloud accepts Python 3.10 through 3.15', () => {
  assert.equal(pythonReleaseSupported(3, 9), false);
  assert.equal(pythonReleaseSupported(3, 10), true);
  assert.equal(pythonReleaseSupported(3, 15), true);
  assert.equal(pythonReleaseSupported(3, 16), false);
});

test('a gcloud that ships with Python is launched with that interpreter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-gcloud-'));
  const bin = path.join(root, 'bin', 'gcloud');
  const python = bundledPythonFor(bin);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(bin, '');
  fs.writeFileSync(python, '');
  const env = launchEnv(bin, { allowPrompt: false });
  assert.equal(env.CLOUDSDK_PYTHON, python);
  assert.equal(env.CLOUDSDK_ROOT_DIR, root);
  assert.equal(env.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal(env.PYTHONPATH, undefined);
  assert.equal(env.PYTHONHOME, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});
