'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { explainGcpError } = require('../src/main/errors');

test('credential and API setup failures point back to settings', () => {
  const missing = explainGcpError(new Error('TOKEN_EXPIRED'));
  assert.equal(missing.needsSetup, true);
  assert.match(missing.message, /一键登录/);

  const disabled = explainGcpError({ status: 403, message: 'Cloud Translation API has not been used in project 1 before or it is disabled' });
  assert.equal(disabled.needsSetup, true);
  assert.match(disabled.message, /Cloud Translation API/);

  const speech = explainGcpError({ status: 403, message: 'Cloud Text-to-Speech API has not been used in project 1 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/texttospeech.googleapis.com/overview' });
  assert.equal(speech.needsSetup, true);
  assert.match(speech.message, /Cloud Text-to-Speech API/);

  const key = explainGcpError({ status: 400, message: 'API key not valid. Please pass a valid API key.' });
  assert.equal(key.needsSetup, true);
  assert.match(key.message, /AI Studio API Key/);
});
