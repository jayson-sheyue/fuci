'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engineMode, usesApiKey, validateGeminiKey } = require('../src/main/settings');
const { modelUrl } = require('../src/main/gcp');

test('a project ID keeps the full GCP path even when a key is saved', () => {
  const settings = { projectId: 'demo', geminiApiKey: 'AIzaSyExampleKey123', model: 'gemini-3.8-flash', location: 'global' };
  assert.equal(engineMode(settings), 'gcp');
  assert.equal(usesApiKey(settings), false);
  assert.match(modelUrl(settings), /aiplatform\.googleapis\.com/);
});

test('an API key alone uses the Gemini API and skips Cloud Translation', () => {
  const settings = { projectId: '', geminiApiKey: 'AIzaSyExampleKey123', model: 'gemini-3.8-flash' };
  assert.equal(engineMode(settings), 'gemini');
  assert.equal(usesApiKey(settings), true);
  assert.equal(
    modelUrl(settings),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
  );
});

test('an explicit route chooses the path when both a project and a key are saved', () => {
  const both = { projectId: 'demo', geminiApiKey: 'AIzaSyExampleKey123', model: 'gemini-3.8-flash', location: 'global' };
  assert.equal(engineMode({ ...both, route: 'auto' }), 'gcp');
  assert.equal(engineMode({ ...both, route: 'gemini' }), 'gemini');
  assert.match(modelUrl({ ...both, route: 'gemini' }), /generativelanguage\.googleapis\.com/);
  assert.equal(usesApiKey({ ...both, route: 'gcp' }), false);
  assert.equal(engineMode({ projectId: '', geminiApiKey: '', route: 'gemini' }), 'gemini');
});

test('a blank setup stays on the GCP path so an existing gcloud project can still be used', () => {
  assert.equal(engineMode({ projectId: '', geminiApiKey: '' }), 'gcp');
  assert.equal(usesApiKey({ projectId: '  ', geminiApiKey: '' }), false);
});

test('the API key is trimmed and rejected when it contains spaces or odd characters', () => {
  assert.equal(validateGeminiKey('  AIzaSyExampleKey123  '), 'AIzaSyExampleKey123');
  assert.equal(validateGeminiKey(''), '');
  assert.throws(() => validateGeminiKey('AIza has space'), { code: 'BAD_GEMINI_KEY' });
  assert.throws(() => validateGeminiKey('AIza/not-a-key'), { code: 'BAD_GEMINI_KEY' });
});
