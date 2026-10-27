'use strict';

const { httpFetch } = require('./http');
const { accessToken, ensureAccessToken } = require('./oauth');
const { usesApiKey } = require('./settings');
const { tr } = require('../renderer/i18n');

const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-tts'];
const GEMINI_TTS_MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-pro-tts',
];
const cache = new Map();

function speechModels(settings) {
  const chosen = String(settings?.ttsModel || '').trim() || TTS_MODELS[0];
  const models = [chosen];
  for (const model of TTS_MODELS) {
    if (!models.includes(model)) models.push(model);
  }
  return models;
}

function geminiSpeechModels(settings) {
  const chosen = String(settings?.ttsModel || '').trim();
  const models = [];
  if (chosen && !TTS_MODELS.includes(chosen)) models.push(chosen);
  if (chosen === 'gemini-2.5-pro-tts' || chosen === 'gemini-2.5-pro-preview-tts') {
    models.push('gemini-2.5-pro-preview-tts', 'gemini-2.5-pro-tts');
  }
  for (const model of GEMINI_TTS_MODELS) {
    if (!models.includes(model)) models.push(model);
  }
  return models;
}

function speechRequest(text, lang, model = TTS_MODELS[0]) {
  const japanese = lang === 'ja';
  return {
    input: {
      prompt: japanese
        ? 'Read the following Japanese aloud in a natural Tokyo accent, like a dictionary recording. Speak only the text.'
        : 'Read the following English aloud in a clear, natural voice, like a dictionary recording. Speak only the text.',
      text,
    },
    voice: {
      languageCode: japanese ? 'ja-JP' : 'en-US',
      name: 'Kore',
      model_name: model,
    },
    audioConfig: { audioEncoding: 'MP3' },
  };
}

function geminiSpeechRequest(text, lang) {
  const japanese = lang === 'ja';
  const prompt = japanese
    ? `Read the following Japanese aloud in a natural Tokyo accent, like a dictionary recording. Speak only the text:\n${text}`
    : `Read the following English aloud in a clear, natural voice, like a dictionary recording. Speak only the text:\n${text}`;
  return {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Kore',
          },
        },
      },
    },
  };
}

function pcmToWavBase64(pcmBase64, sampleRate = 24000) {
  const pcm = Buffer.from(String(pcmBase64 || ''), 'base64');
  const header = Buffer.alloc(44);
  const channels = 1;
  const bitsPerSample = 16;
  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 24000;
  const byteRate = rate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

function ensureDecodableAudio(base64Data, mimeType = '') {
  const raw = Buffer.from(String(base64Data || ''), 'base64');
  const mime = String(mimeType || '').toLowerCase();
  if (raw.length >= 4) {
    const magic = raw.subarray(0, 4).toString('ascii');
    if (magic === 'RIFF' || magic === 'ID3\u0003' || magic === 'ID3\u0004' || magic.startsWith('ID3') || magic === 'OggS') {
      return base64Data;
    }
    if ((mime.includes('mp3') || mime.includes('mpeg')) && raw[0] === 0xff && (raw[1] & 0xe0) === 0xe0) {
      return base64Data;
    }
  }
  const rateMatch = /rate=(\d+)/i.exec(mime);
  const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
  return pcmToWavBase64(base64Data, sampleRate);
}

function unsupportedModel(error) {
  const message = String(error?.message || '');
  return error?.status === 404 || /not supported|unsupported model|model_name|unknown model|was not found|invalid model|modalities|responseModalities/i.test(message);
}

async function synthesizeOnce(settings, token, text, lang, model, signal) {
  for (const sendProject of [true, false]) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (sendProject && settings.projectId) {
      headers['x-goog-user-project'] = settings.projectId;
    }
    const response = await httpFetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers,
      body: JSON.stringify(speechRequest(text, lang, model)),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      if (!data.audioContent) {
        throw Object.assign(new Error(tr('errNoAudio')), { status: 502 });
      }
      return data.audioContent;
    }
    const msg = data.error?.message || response.statusText || tr('errSpeechFail');
    const error = new Error(msg);
    error.status = response.status;
    if (sendProject && (response.status === 403 || response.status === 400)
      && /serviceusage\.services\.use|CONSUMER_INVALID|quota project/i.test(msg)) {
      continue;
    }
    throw error;
  }
  throw Object.assign(new Error(tr('errSpeechFail')), { status: 502 });
}

async function synthesizeGeminiOnce(apiKey, text, lang, model, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await httpFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(geminiSpeechRequest(text, lang)),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || response.statusText || tr('errSpeechFail'));
    error.status = response.status;
    throw error;
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((part) => part?.inlineData?.data)?.inlineData;
  if (!inline?.data) {
    throw Object.assign(new Error(tr('errNoAudio')), { status: 502 });
  }
  return ensureDecodableAudio(inline.data, inline.mimeType);
}

async function synthesizeWithGeminiKey(settings, value, lang, signal) {
  const apiKey = String(settings?.geminiApiKey || '').trim();
  if (!apiKey) {
    throw Object.assign(new Error(tr('errFillKey')), { status: 0 });
  }
  const models = geminiSpeechModels(settings);
  let lastError = null;
  for (const model of models) {
    try {
      return await synthesizeGeminiOnce(apiKey, value, lang, model, signal);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
      if (!unsupportedModel(error)) break;
    }
  }
  throw lastError;
}

async function synthesize(text, lang, settings, signal) {
  const value = String(text || '').trim().slice(0, 800);
  if (!value || (lang !== 'en' && lang !== 'ja')) {
    throw Object.assign(new Error(tr('errSpeechLang')), { status: 0 });
  }
  const useKey = usesApiKey(settings);
  const models = useKey ? geminiSpeechModels(settings) : speechModels(settings);
  const key = `${useKey ? 'gemini' : 'gcp'}\n${models[0]}\n${lang}\n${value}`;
  if (cache.has(key)) return cache.get(key);

  if (useKey) {
    const audio = await synthesizeWithGeminiKey(settings, value, lang, signal);
    cache.set(key, audio);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    return audio;
  }

  if (!settings?.projectId) {
    throw Object.assign(new Error(tr('errNoProjectShort')), { status: 0 });
  }
  const token = (await ensureAccessToken(settings)) || accessToken(settings);
  if (!token) {
    const error = new Error('TOKEN_EXPIRED');
    error.status = 401;
    throw error;
  }

  let lastError = null;
  for (const model of models) {
    try {
      const audio = await synthesizeOnce(settings, token, value, lang, model, signal);
      cache.set(key, audio);
      if (cache.size > 30) cache.delete(cache.keys().next().value);
      return audio;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
      if (!unsupportedModel(error)) break;
    }
  }
  throw lastError;
}

module.exports = {
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
};
