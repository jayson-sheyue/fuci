'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGeminiKey } = require('../src/main/settings');
const { endpoint } = require('../src/main/gemini-gateway');
const { modelUrl, lookup, clearCache } = require('../src/main/gcp');
const { setFetchImplementation } = require('../src/main/http');
const { synthesize, geminiSpeechRequest } = require('../src/main/tts');
const { cacheScope } = require('../src/main/lookup-cache');
for (const source of ['gemini', 'vertex-express']) for (const key of ['AIzaSyntheticKey1234567890', 'AQ.synthetic.auth.key_1234567890']) {
  test(`${source} routes dictionary and TTS independently of the key prefix (${key.slice(0,3)})`, async () => {
    assert.equal(validateGeminiKey(` ${key} `), key);
    const settings = { route: 'gemini', geminiApiKey: key, geminiProvider: source, model: 'gemini-test', ttsModel: 'test-tts', pair: 'en-zh', target: 'zh-CN' };
    assert.equal(modelUrl(settings), endpoint('gemini-test', source));
    const calls = [];
    setFetchImplementation(async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, options, body });
      assert.equal(url, endpoint(body.generationConfig.responseModalities ? 'test-tts' : 'gemini-test', source));
      assert.equal(new URL(url).search, '');
      assert.equal(options.headers['x-goog-api-key'], key);
      assert.equal(options.redirect, 'error');
      assert(body.contents.every(c => c.role === 'user'));
      const parts = body.generationConfig.responseModalities
        ? [{ inlineData: { data: 'AQIDBA==', mimeType: 'audio/L16;rate=24000' } }]
        : [{ text: JSON.stringify({ headword: 'canopy', phonetic: '', entries: [{ pos: 'n.', posZh: '名词', senses: [{ glossZh: '树冠', glossMono: 'A cover of branches.', examples: [] }] }], inflections: [], note: '' }) }];
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts } }] }) };
    });
    clearCache();
    await lookup('canopy', settings);
    const audio = await synthesize('gateway-' + source + '-' + key.slice(0,3), 'en', settings);
    assert(Buffer.from(audio, 'base64').subarray(0,4).toString() === 'RIFF');
    assert.equal(calls.filter(c => c.body.generationConfig.responseSchema).length, 1);
    const speech = calls.filter(c => c.body.generationConfig.responseModalities);
    assert.equal(speech.length, 1);
    assert.deepEqual(speech[0].body.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(speech[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  });
}
test('default stays AI Studio, provider and model cannot inject a host, and cached results distinguish gateways', () => {
  assert(endpoint('models/gemini-test').includes('generativelanguage.googleapis.com/v1beta/models/gemini-test'));
  assert.throws(() => endpoint('test', 'https://other'));
  assert.throws(() => endpoint('../other', 'vertex-express'));
  assert.throws(() => validateGeminiKey('AQ.key\nother'));
  assert.throws(() => validateGeminiKey('x'.repeat(4097)));
  assert.equal(validateGeminiKey('AQ.' + 'x'.repeat(500)).length, 503);
  assert.notEqual(cacheScope({ engine: 'gemini', geminiProvider: 'gemini' }), cacheScope({ engine: 'gemini', geminiProvider: 'vertex-express' }));
  assert(geminiSpeechRequest('hello', 'en').contents.every(c => c.role === 'user'));
});
test('an Express rejection never falls back to another provider or exposes the API key in an upstream error', async () => {
  let calls = 0;
  const key = 'AQ.synthetic-secret';
  setFetchImplementation(async url => { calls++; assert(url.includes('aiplatform.googleapis.com/v1beta1/')); return { ok: false, status: 403, json: async () => ({error:{message:'denied ' + key}}) }; });
  await assert.rejects(() => synthesize('denied-gateway-test', 'en', { route:'gemini', geminiApiKey:key, geminiProvider:'vertex-express', ttsModel:'test-tts' }), e => !e.message.includes(key) && e.status === 403);
  assert.equal(calls,1);
});
