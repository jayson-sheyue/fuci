'use strict';

const { httpFetch } = require('./http');
const { accessToken } = require('./oauth');
const { usesApiKey } = require('./settings');
const { tr } = require('../renderer/i18n');

const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-tts'];
const cache = new Map();

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

function unsupportedModel(error) {
  const message = String(error?.message || '');
  return error?.status === 404 || /not supported|unsupported model|model_name|unknown model|was not found|invalid model/i.test(message);
}

async function synthesizeOnce(settings, token, text, lang, model, signal) {
  const response = await httpFetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
      'x-goog-user-project': settings.projectId,
    },
    body: JSON.stringify(speechRequest(text, lang, model)),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || response.statusText || tr('errSpeechFail'));
    error.status = response.status;
    throw error;
  }
  if (!data.audioContent) {
    throw Object.assign(new Error(tr('errNoAudio')), { status: 502 });
  }
  return data.audioContent;
}

async function synthesize(text, lang, settings, signal) {
  const value = String(text || '').trim().slice(0, 800);
  if (!value || (lang !== 'en' && lang !== 'ja')) {
    throw Object.assign(new Error(tr('errSpeechLang')), { status: 0 });
  }
  if (usesApiKey(settings)) {
    throw Object.assign(new Error(tr('errSpeechNeedsGcp')), { status: 0 });
  }
  if (!settings?.projectId) {
    throw Object.assign(new Error(tr('errNoProjectShort')), { status: 0 });
  }
  const token = accessToken(settings);
  if (!token) {
    const error = new Error('TOKEN_EXPIRED');
    error.status = 401;
    throw error;
  }
  const key = `${lang}\n${value}`;
  if (cache.has(key)) return cache.get(key);

  let lastError = null;
  for (const model of TTS_MODELS) {
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
  speechRequest,
  unsupportedModel,
  synthesize,
};
