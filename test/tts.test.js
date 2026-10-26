'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TTS_MODELS, speechModels, speechRequest, unsupportedModel } = require('../src/main/tts');

test('speech uses the most natural Gemini voice for English and Japanese', () => {
  assert.deepEqual(TTS_MODELS, ['gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-tts']);
  const english = speechRequest('ephemeral', 'en');
  assert.equal(english.voice.languageCode, 'en-US');
  assert.equal(english.voice.name, 'Kore');
  assert.equal(english.voice.model_name, 'gemini-3.1-flash-tts-preview');
  assert.equal(english.audioConfig.audioEncoding, 'MP3');
  assert.equal(english.input.text, 'ephemeral');

  const japanese = speechRequest('やさしい', 'ja', TTS_MODELS[1]);
  assert.equal(japanese.voice.languageCode, 'ja-JP');
  assert.equal(japanese.voice.model_name, 'gemini-2.5-pro-tts');
  assert.equal(unsupportedModel({ status: 400, message: "The model 'gemini-3.8-flash-tts' is not supported." }), true);
  assert.equal(unsupportedModel({ status: 403, message: 'permission denied' }), false);
  assert.deepEqual(speechModels({}), TTS_MODELS);
  assert.deepEqual(speechModels({ ttsModel: 'gemini-2.5-pro-tts' }), ['gemini-2.5-pro-tts', 'gemini-3.1-flash-tts-preview']);
  assert.deepEqual(speechModels({ ttsModel: 'my-new-tts' }), ['my-new-tts', ...TTS_MODELS]);
});
