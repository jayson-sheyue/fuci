'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setFetchImplementation } = require('../src/main/http');
const {
  TTS_MODELS,
  GEMINI_TTS_MODELS,
  speechModels,
  geminiSpeechModels,
  speechRequest,
  geminiSpeechRequest,
  pcmToWavBase64,
  ensureDecodableAudio,
  unsupportedModel,
  synthesize,
} = require('../src/main/tts');

test('speech uses the most natural Gemini voice for English and Japanese', () => {
  assert.deepEqual(TTS_MODELS, ['gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-tts']);
  assert.ok(GEMINI_TTS_MODELS.includes('gemini-2.5-flash-preview-tts'));
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
  assert.equal(geminiSpeechModels({})[0], 'gemini-2.5-flash-preview-tts');
  assert.equal(geminiSpeechModels({ ttsModel: 'gemini-2.5-pro-tts' })[0], 'gemini-2.5-pro-preview-tts');
});

test('AI Studio lite mode synthesizes speech via Gemini AUDIO modality and wraps L16 PCM as WAV', async () => {
  const req = geminiSpeechRequest('resilient', 'en');
  assert.deepEqual(req.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(req.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');

  const fakePcm = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]).toString('base64');
  const wavB64 = ensureDecodableAudio(fakePcm, 'audio/L16;codec=pcm;rate=24000');
  const wavBuf = Buffer.from(wavB64, 'base64');
  assert.equal(wavBuf.length, 44 + 8);
  assert.equal(wavBuf.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wavBuf.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wavBuf.readUInt32LE(24), 24000);
  assert.equal(wavBuf.readUInt32LE(40), 8);
  assert.equal(ensureDecodableAudio(wavB64, 'audio/wav'), wavB64);

  const calls = [];
  setFetchImplementation(async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (calls.length === 1) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: { message: 'Model was not found' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/L16;codec=pcm;rate=24000',
                    data: fakePcm,
                  },
                },
              ],
            },
          },
        ],
      }),
    };
  });

  const audio = await synthesize('resilient', 'en', {
    engine: 'gemini',
    geminiApiKey: 'AIzaSyTestKey1234567890',
    ttsModel: 'gemini-3.1-flash-tts-preview',
  });
  assert.equal(audio, pcmToWavBase64(fakePcm, 24000));
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash-preview-tts:generateContent/);
  assert.match(calls[1].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.1-flash-tts-preview:generateContent/);
  assert.equal(calls[1].headers['x-goog-api-key'], 'AIzaSyTestKey1234567890');
});

test('Windows gcloud tar extractor skips symlinks and platform/gsutil without failing', () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { WIN_TAR_EXTRACT_PY } = require('../src/main/gcloud-setup');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-tar-test-'));
  const archive = path.join(tmp, 'archive.tar.gz');
  const stage = path.join(tmp, 'stage');
  fs.mkdirSync(stage, { recursive: true });
  try {
    const buildTarPy = [
      'import io, sys, tarfile',
      'with tarfile.open(sys.argv[1], "w:gz") as tf:',
      '  def add_file(name, data):',
      '    info = tarfile.TarInfo(name)',
      '    raw = data.encode("utf-8")',
      '    info.size = len(raw)',
      '    tf.addfile(info, io.BytesIO(raw))',
      '  add_file("google-cloud-sdk/lib/gcloud.py", "print(1)")',
      '  add_file("google-cloud-sdk/platform/gsutil/third_party/funcsigs/docs/index.rst", "skip me")',
      '  sym = tarfile.TarInfo("google-cloud-sdk/bin/gsutil")',
      '  sym.type = tarfile.SYMTYPE',
      '  sym.linkname = "../platform/gsutil/gsutil"',
      '  tf.addfile(sym)',
    ].join('\n');
    execFileSync('python3', ['-c', buildTarPy, archive]);
    execFileSync('python3', ['-c', WIN_TAR_EXTRACT_PY, archive, stage]);
    assert.equal(fs.existsSync(path.join(stage, 'google-cloud-sdk', 'lib', 'gcloud.py')), true);
    assert.equal(fs.existsSync(path.join(stage, 'google-cloud-sdk', 'platform', 'gsutil')), false);
    assert.equal(fs.existsSync(path.join(stage, 'google-cloud-sdk', 'bin', 'gsutil')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
