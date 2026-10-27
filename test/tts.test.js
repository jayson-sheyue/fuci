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

test('OAuth PKCE loopback login opens browser immediately and exchanges code for token', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { beginLogin, configureSession, setBrowserOpener } = require('../src/main/oauth');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-oauth-test-'));
  let openedAuthUrl = '';
  try {
    // Seed an active session so beginLogin triggers re-login via browserLoopbackLogin directly
    fs.writeFileSync(path.join(tmp, 'session.json'), JSON.stringify({
      accessToken: 'ya29.existing',
      expiresAt: Date.now() + 60000,
      projectId: 'team-project',
      source: 'gcloud',
    }));
    configureSession(tmp);

    setBrowserOpener(async (authUrl) => {
      openedAuthUrl = authUrl;
      const parsed = new URL(authUrl);
      const redirectUri = parsed.searchParams.get('redirect_uri');
      const state = parsed.searchParams.get('state');
      const callbackUrl = `${redirectUri}?code=mock_auth_code&state=${encodeURIComponent(state)}`;
      await fetch(callbackUrl);
    });

    setFetchImplementation(async (url, options) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('code'), 'mock_auth_code');
      assert.equal(params.get('grant_type'), 'authorization_code');
      assert.ok(params.get('code_verifier'));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'ya29.new_pkce_token',
          refresh_token: '1//mock_refresh_token',
          expires_in: 3600,
        }),
      };
    });

    const status = await beginLogin({ projectId: 'team-project' });
    assert.ok(openedAuthUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
    assert.equal(status.signedIn, true);
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'session.json'), 'utf8'));
    assert.equal(saved.accessToken, 'ya29.new_pkce_token');
    assert.equal(saved.refreshToken, '1//mock_refresh_token');
  } finally {
    setBrowserOpener(null);
    configureSession('');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Full mode avoids sending x-goog-user-project when project ID is in URL path and uses exact configured model', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { configureSession } = require('../src/main/oauth');
  const { lookup, clearCache } = require('../src/main/gcp');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-gcp-full-'));
  try {
    fs.writeFileSync(path.join(tmp, 'session.json'), JSON.stringify({
      accessToken: 'ya29.member_token',
      expiresAt: Date.now() + 60000,
      projectId: 'team-project',
      source: 'gcloud',
    }));
    configureSession(tmp);
    clearCache();

    const calls = [];
    setFetchImplementation(async (url, options) => {
      calls.push({ url, headers: options.headers });
      // Ensure x-goog-user-project is NOT sent when /projects/<id>/ is in the URL
      assert.equal(options.headers['x-goog-user-project'], undefined);

      if (url.includes('translation.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ translations: [{ translatedText: 'Hello world today the weather is great' }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify({ tokens: [{ text: '你好世界', reading: 'nǐ hǎo shì jiè', translation: 'Hello world' }] }) }],
            },
          }],
        }),
      };
    });

    const res = await lookup('你好世界今天天气真好', {
      route: 'gcp',
      projectId: 'team-project',
      pair: 'zh-en',
      model: 'gemini-3.8-flash',
      location: 'global',
    });
    assert.equal(res.kind, 'sentence');
    assert.equal(res.translation, 'Hello world today the weather is great');
    assert.ok(calls.every((c) => !c.url.includes('aiplatform.googleapis.com') || c.url.includes('gemini-3.8-flash')));
  } finally {
    configureSession('');
    clearCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Lite mode dictionaryPrompt instructs Gemini to reconstruct scrambled Chinese into entries without extra hidden calls', async () => {
  const { lookup, clearCache } = require('../src/main/gcp');
  clearCache();

  let callCount = 0;
  setFetchImplementation(async (_url, options) => {
    callCount += 1;
    const body = JSON.parse(options.body);
    const promptText = body.contents?.[0]?.parts?.[0]?.text || '';
    if (promptText.includes('为词典卡片编写一个词条')) {
      assert.match(promptText, /如果输入是语序打乱的文字/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  headword: '果苹吃',
                  phonetic: 'guǒ píng chī',
                  lemma: '吃苹果',
                  note: '按「吃苹果」还原翻译。',
                  inflections: [],
                  entries: [
                    {
                      pos: 'v.',
                      posZh: '动词短语',
                      senses: [
                        {
                          glossZh: 'eat apples',
                          glossMono: '吃苹果',
                          glossReading: '',
                          examples: [],
                        },
                      ],
                    },
                  ],
                }),
              }],
            },
          }],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: '/iːt ˈæpəlz/' }],
          },
        }],
      }),
    };
  });

  const res = await lookup('果苹吃', {
    route: 'gemini',
    geminiApiKey: 'AIzaSyTestKey1234567890',
    pair: 'zh-en',
  });
  assert.equal(res.translation, 'eat apples');
  assert.equal(callCount, 3); // 1 defineWord + target IPA readings (no hidden geminiTranslate)
});
