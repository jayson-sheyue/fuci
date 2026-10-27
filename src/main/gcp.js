'use strict';

const { classify, languageLabel, normalizePair } = require('./classify');
const { httpFetch } = require('./http');
const { accessToken, ensureAccessToken } = require('./oauth');
const { firstGloss, sanitizeDictionary, sanitizeTokens } = require('./dictionary');
const { explainGcpError } = require('./errors');
const lookupCache = require('./lookup-cache');
const { usesApiKey } = require('./settings');
const { tr } = require('../renderer/i18n');

const DICTIONARY_SCHEMA = {
  type: 'object',
  properties: {
    headword: { type: 'string' },
    phonetic: { type: 'string' },
    lemma: { type: 'string' },
    note: { type: 'string' },
    inflections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          form: { type: 'string' },
          reading: { type: 'string' },
        },
        required: ['label', 'form', 'reading'],
      },
    },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pos: { type: 'string' },
          posZh: { type: 'string' },
          senses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                glossZh: { type: 'string' },
                glossMono: { type: 'string' },
                glossReading: { type: 'string' },
                examples: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      translation: { type: 'string' },
                      reading: { type: 'string' },
                    },
                    required: ['text', 'translation', 'reading'],
                  },
                },
              },
              required: ['glossZh', 'glossMono', 'glossReading', 'examples'],
            },
          },
        },
        required: ['pos', 'posZh', 'senses'],
      },
    },
  },
  required: ['headword', 'phonetic', 'lemma', 'note', 'inflections', 'entries'],
};

function clearCache() {
  lookupCache.clear();
}

function configureLookupCache(dir) {
  lookupCache.configure(dir);
}

function flushLookupCache() {
  lookupCache.flush();
}

function clearAuth() {}

function clip(text, max) {
  const chars = [...text];
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, max).join(''), truncated: true };
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, num) => String.fromCodePoint(parseInt(num, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

async function getToken(settings) {
  const token = (await ensureAccessToken(settings)) || accessToken(settings);
  if (!token) {
    const error = new Error('TOKEN_EXPIRED');
    error.status = 401;
    throw error;
  }
  return token;
}

async function postJsonOnce(url, token, projectId, body, signal, apiKey, includeUserProject) {
  throwIfAborted(signal);
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (apiKey) {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.Authorization = `Bearer ${token}`;
    if (includeUserProject && projectId) {
      headers['x-goog-user-project'] = projectId;
    }
  }
  let response;
  try {
    response = await httpFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const wrapped = new Error(error.message || 'fetch failed');
    wrapped.status = 0;
    throw wrapped;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || response.statusText || tr('errRequest'));
    error.status = response.status;
    throw error;
  }
  return data;
}

async function postJson(url, token, projectId, body, signal, apiKey) {
  if (apiKey) {
    return postJsonOnce(url, token, projectId, body, signal, apiKey, false);
  }
  const pathHasProject = Boolean(projectId && url.includes(`/projects/${projectId}/`));
  try {
    return await postJsonOnce(url, token, projectId, body, signal, apiKey, !pathHasProject);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const msg = String(error.message || '');
    const quotaProjectError = (error.status === 403 || error.status === 400)
      && /quota project|serviceusage\.services\.use|CONSUMER_INVALID|x-goog-user-project/i.test(msg);
    if (quotaProjectError && projectId) {
      return postJsonOnce(url, token, projectId, body, signal, apiKey, pathHasProject);
    }
    throw error;
  }
}

function translationUrl(projectId, method) {
  return `https://translation.googleapis.com/v3/projects/${projectId}/locations/global:${method}`;
}

function pairEnds(settings) {
  const pair = normalizePair(settings?.pair, settings);
  const [source, target] = pair.split('-');
  return { pair, source, target };
}

function scriptCode(settings) {
  return settings?.target === 'zh-TW' ? 'zh-TW' : 'zh-CN';
}

function apiCode(lang, settings) {
  if (lang === 'zh') return scriptCode(settings);
  return lang === 'ja' ? 'ja' : 'en';
}

function langName(lang, settings) {
  if (lang === 'zh') return scriptCode(settings) === 'zh-TW' ? '繁体中文' : '简体中文';
  return lang === 'ja' ? '日语' : '英语';
}

function readingRule(lang) {
  if (lang === 'en') return '一行国际音标，词之间空格并标重音，整段用斜线包住，例如 /tə ˈstʌdi/';
  if (lang === 'ja') return '假名读音，汉字写成漢字(かな)，假名原样保留';
  return '带声调的汉语拼音，音节之间用空格，例如 xué xí';
}

function outputLanguage(settings) {
  const { target } = pairEnds(settings);
  return { code: apiCode(target, settings), name: langName(target, settings) };
}

async function translateText(settings, token, text, source, signal) {
  const target = outputLanguage(settings);
  const body = {
    contents: [text],
    mimeType: 'text/plain',
    targetLanguageCode: target.code,
    sourceLanguageCode: apiCode(source, settings),
  };
  const data = await postJson(
    translationUrl(settings.projectId, 'translateText'),
    token,
    settings.projectId,
    body,
    signal
  );
  const translated = data.translations?.[0]?.translatedText;
  if (!translated) throw Object.assign(new Error(tr('errNoTranslation')), { status: 502 });
  return decodeEntities(translated);
}

function vertexUrl(settings) {
  const location = settings.location || 'global';
  const model = settings.model || 'gemini-3.8-flash';
  const host = location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${settings.projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function modelUrl(settings) {
  if (!usesApiKey(settings)) return vertexUrl(settings);
  const model = encodeURIComponent(settings.model || 'gemini-3.8-flash');
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function postModel(settings, token, body, signal) {
  if (usesApiKey(settings)) {
    return postJson(modelUrl(settings), '', '', body, signal, settings.geminiApiKey);
  }
  return postJson(vertexUrl(settings), token, settings.projectId, body, signal);
}

function dictionaryPrompt(text, lang, settings) {
  const ends = pairEnds(settings);
  const source = lang || ends.source;
  const target = ends.target;
  const from = langName(source, settings);
  const to = langName(target, settings);
  const inflect = source === 'en' || source === 'ja' ? source : target;
  const glossReading = source === 'en' || source === 'ja'
    ? `glossReading 是 glossMono 的读音：${readingRule(source)}。`
    : 'glossReading 留空字符串。';
  const exampleReading = source === 'en' || source === 'ja'
    ? `reading 是 text 的读音：${readingRule(source)}。`
    : 'reading 留空字符串。';
  return [
    `为词典卡片编写一个词条。输入是${from}的单词、习语或固定短语，译成${to}。`,
    `输入：${JSON.stringify(text)}`,
    `原语言：${from}`,
    `目标语言：${to}`,
    `phonetic：输入词的读音。${readingRule(source)}。`,
    'lemma：词典原形。与输入词面相同时留空字符串。',
    `entries：最多两个词性。pos 用原语言的词典缩写，posZh 用${to}写出词性。`,
    `每个词性最多两个义项。glossZh 用${to}给出该义项的简短译文。glossMono 用${from}解释该义项，一句话。${glossReading}`,
    `每个义项给一句例句：text 用${from}且包含该词，translation 用${to}。${exampleReading}例句用现代日常说法。`,
    `inflections：给出这个词在${langName(inflect, settings)}里的形态变化，最多 6 项。英语动词依次为原形、第三人称单数、现在分词、过去式、过去分词；名词为单数、复数；形容词为原级、比较级、最高级。日语动词依次为辞書形、ます形、て形、た形、ない形。中文没有词形变化时用空数组。label 用${to}，form 用${langName(inflect, settings)}，reading 是 form 的读音。`,
    '只写现代常用义项。不要收入隐语、古义或极冷僻的用法。',
    '如果输入是语序打乱的文字、多个词的组合或非固定搭配，仍需按还原后的本意或字面意思在 entries 中给出目标语译文与释义（不要将 entries 留空），并在 note 中用中文简短说明；只有完全无法识别的纯符号乱码才将 entries 置为空数组。',
    '不要编造明显不存在的读音。专有名词和常见缩写可以收录。',
  ].join('\n');
}

function dictionaryBody(text, lang, settings, { schema, thinking }) {
  const generationConfig = { maxOutputTokens: 4096 };
  if (schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = DICTIONARY_SCHEMA;
  } else {
    generationConfig.responseMimeType = 'application/json';
  }
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
  return {
    contents: [{ role: 'user', parts: [{ text: dictionaryPrompt(text, lang, settings) }] }],
    generationConfig,
  };
}

function candidateText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => part.text && !part.thought).map((part) => part.text).join('');
}

function parseModelJson(text) {
  const trimmed = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw Object.assign(new Error(tr('errBadJson')), { status: 502 });
  }
}

async function defineWord(settings, token, text, lang, signal) {
  const attempts = [
    { schema: true, thinking: true },
    { schema: true, thinking: false },
    { schema: false, thinking: false },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const data = await postModel(settings, token, dictionaryBody(text, lang, settings, attempt), signal);
      const rawText = candidateText(data);
      if (!rawText) {
        const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || '空响应';
        throw Object.assign(new Error(`模型没有返回词条（${reason}）`), { status: 502 });
      }
      return sanitizeDictionary(parseModelJson(rawText), lang);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
      const message = error.message || '';
      const retryable = error.status === 400 && /thinking|schema|responseMime|response_mime|mime/i.test(message);
      if (!retryable) break;
    }
  }
  throw lastError;
}

function translationDisabled(error) {
  return /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured|translate\.googleapis\.com|cloudtranslate\./i.test(error?.message || '');
}

function sameReadingText(a, b) {
  return String(a || '').replace(/\s+/g, '').toLowerCase() === String(b || '').replace(/\s+/g, '').toLowerCase();
}

function tidyReading(raw, lang) {
  let value = String(raw || '').replace(/^["“「『]|["”」』]$/g, '').trim();
  value = value.replace(/^(读音|假名|音标|IPA)\s*[:：]\s*/, '');
  const line = value.split('\n').map((item) => item.trim()).filter(Boolean)[0] || '';
  if (!line) return '';
  if (lang === 'en') {
    const wrapped = line.match(/\/[^/\n]{1,1200}\//);
    if (wrapped) return wrapped[0];
    return `/${line.replace(/^\/+|\/+$/g, '')}/`;
  }
  return line;
}

async function pronounce(settings, token, text, lang, signal) {
  const value = String(text || '').trim();
  if (!value || (lang !== 'en' && lang !== 'ja')) return '';
  const prompt = lang === 'ja'
    ? `给下面的日语标注假名。汉字写成漢字(かな)，假名、标点和空格原样保留。只输出标注后的文本，不要翻译或解释。\n\n${value}`
    : `给下面的英语标注国际音标。只输出一行音标，词与词之间用空格，保留重音，整行用斜线包住。不要翻译或解释。\n\n${value}`;
  let lastError = null;
  for (const thinking of [true, false]) {
    const generationConfig = { maxOutputTokens: 2048 };
    if (thinking) generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
    try {
      const data = await postModel(settings, token, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }, signal);
      const reading = tidyReading(candidateText(data), lang);
      if (!reading) throw Object.assign(new Error(tr('errNoReading')), { status: 502 });
      return reading;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
      if (!(error.status === 400 && /thinking/i.test(error.message || ''))) break;
    }
  }
  if (lastError?.name === 'AbortError') throw lastError;
  return '';
}

function canSpeak(lang) {
  return lang === 'en' || lang === 'ja';
}

async function fillReadings(settings, token, dictionary, source, target, signal) {
  if (!dictionary) return;
  const jobs = [];
  for (const entry of dictionary.entries || []) {
    for (const sense of entry.senses || []) {
      if (canSpeak(source) && !sense.glossReading) {
        jobs.push(pronounce(settings, token, sense.glossMono, source, signal).then((reading) => {
          sense.glossReading = reading;
        }));
      }
      if (canSpeak(target) && !sense.glossTargetReading) {
        jobs.push(pronounce(settings, token, sense.glossZh, target, signal).then((reading) => {
          sense.glossTargetReading = reading;
        }));
      }
      for (const example of sense.examples || []) {
        if (canSpeak(source) && !example.reading) {
          jobs.push(pronounce(settings, token, example.text, source, signal).then((reading) => {
            example.reading = reading;
          }));
        }
        if (canSpeak(target) && !example.translationReading) {
          jobs.push(pronounce(settings, token, example.translation, target, signal).then((reading) => {
            example.translationReading = reading;
          }));
        }
      }
    }
  }
  if (canSpeak(source) && !dictionary.phonetic) {
    jobs.push(pronounce(settings, token, dictionary.headword, source, signal).then((reading) => {
      dictionary.phonetic = reading;
    }));
  }
  await Promise.all(jobs);
}

async function geminiTranslate(settings, token, text, source, signal) {
  const target = outputLanguage(settings);
  const prompt = `把下面的文本翻译成${target.name}。如果输入语序打乱、包含错别字或是非固定搭配，请还原其最可能表达的本意或按字面意思直接翻译，绝不要拒绝翻译或解释原因。只输出译文本身，不要加引号或解释。\n\n${text}`;
  let lastError = null;
  for (const thinking of [true, false]) {
    const generationConfig = { maxOutputTokens: 2048 };
    if (thinking) generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
    try {
      const data = await postModel(settings, token, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }, signal);
      const translated = candidateText(data).replace(/^["“「『]|["”」』]$/g, '').trim();
      if (!translated) throw Object.assign(new Error(tr('errNoModelText')), { status: 502 });
      return translated;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
      if (!(error.status === 400 && /thinking/i.test(error.message || ''))) break;
    }
  }
  throw lastError;
}

async function translateOrFallback(settings, token, text, source, signal) {
  try {
    const translation = await translateText(settings, token, text, source, signal);
    return { translation, translationEngine: 'cloud-translation' };
  } catch (error) {
    if (!translationDisabled(error)) throw error;
    const translation = await geminiTranslate(settings, token, text, source, signal);
    return { translation, translationEngine: 'gemini' };
  }
}

function remember(settings, kind, lang, text, value) {
  lookupCache.put(settings, kind, lang, text, value);
}

async function analyzeSentence(settings, token, text, lang, signal) {
  const gloss = langName(pairEnds(settings).target, settings);
  const prompt = [
    '把句子拆成逐词释义，保持原句顺序，每个词都要出现，不要停在句子中途。',
    '中文按词拆开，不要按字。英语按单词，保留冠词和助动词。日语按词，助词单独成项。',
    `每个词的 translation 用${gloss}写一个简短释义。`,
    'reading：英语用一行国际音标；日语用假名，含汉字时写成漢字(かな)；中文用带声调的拼音。没有读音就留空字符串。',
    '只返回 JSON：{"tokens":[{"text":"","reading":"","translation":""}]}',
    `句子：${JSON.stringify(text)}`,
  ].join('\n');
  const schema = {
    type: 'object',
    properties: {
      tokens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            reading: { type: 'string' },
            translation: { type: 'string' },
          },
          required: ['text', 'reading', 'translation'],
        },
      },
    },
    required: ['tokens'],
  };
  let lastError = null;
  for (const attempt of [
    { schema: true, thinking: true },
    { schema: true, thinking: false },
    { schema: false, thinking: false },
  ]) {
    const generationConfig = { maxOutputTokens: 8192, responseMimeType: 'application/json' };
    if (attempt.schema) generationConfig.responseSchema = schema;
    if (attempt.thinking) generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
    try {
      const data = await postModel(settings, token, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }, signal);
      const rawText = candidateText(data);
      if (!rawText) throw Object.assign(new Error(tr('errNoTokens')), { status: 502 });
      return sanitizeTokens(parseModelJson(rawText));
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
      const retryable = error.status === 400 && /thinking|schema|responseMime|response_mime|mime/i.test(error.message || '');
      if (!retryable) break;
    }
  }
  throw lastError;
}

async function lookup(text, settings, { signal, onProgress } = {}) {
  const original = String(text || '').trim();
  if (!original) return { kind: 'empty' };
  const keyMode = usesApiKey(settings);
  if (keyMode && !String(settings.geminiApiKey || '').trim()) {
    return {
      kind: 'setup',
      message: tr('errFillKey'),
    };
  }
  if (!keyMode && !settings.projectId) {
    return {
      kind: 'setup',
      message: tr('errNoProject'),
    };
  }

  const clipped = clip(original, 800);
  const scoped = { ...settings, pair: normalizePair(settings.pair, settings), engine: keyMode ? 'gemini' : 'gcp' };
  const { source: lang, target: targetLanguage } = pairEnds(scoped);
  const kind = classify(clipped.text, lang);
  const cached = lookupCache.read(scoped, kind, lang, clipped.text);
  if (cached) return { ...cached, query: original, truncated: clipped.truncated, pinned: false };

  const token = keyMode ? '' : await getToken(scoped);
  throwIfAborted(signal);

  const base = {
    query: original,
    sourceLanguage: lang,
    sourceLanguageLabel: languageLabel(lang),
    targetLanguage,
    truncated: clipped.truncated,
    pinned: false,
  };

  if (kind !== 'word') {
    const sourceReading = canSpeak(lang)
      ? pronounce(scoped, token, clipped.text, lang, signal)
      : Promise.resolve('');
    const analysis = analyzeSentence(scoped, token, clipped.text, lang, signal).catch((error) => {
      if (error.name === 'AbortError') throw error;
      return [];
    });
    const translated = keyMode
      ? {
        translation: await geminiTranslate(scoped, token, clipped.text, lang, signal),
        translationEngine: 'gemini-key',
      }
      : await translateOrFallback(scoped, token, clipped.text, lang, signal);
    const translationReading = canSpeak(targetLanguage)
      ? await pronounce(scoped, token, translated.translation, targetLanguage, signal)
      : '';
    const reading = await sourceReading;
    const tokens = await analysis;
    const result = { ...base, kind: 'sentence', ...translated, reading, translationReading, tokens };
    const readingReady = (!canSpeak(lang) || reading) && (!canSpeak(targetLanguage) || translationReading);
    const cacheSentence = keyMode
      ? Boolean(translated.translation && tokens.length && readingReady)
      : translated.translationEngine === 'cloud-translation' && readingReady && tokens.length;
    if (cacheSentence) remember(scoped, kind, lang, clipped.text, result);
    return result;
  }

  let translation = '';
  let translationEngine = keyMode ? 'gemini-key' : 'cloud-translation';
  let translationNote = '';
  let dictionary = null;
  let dictionaryError = null;
  let cloudTranslation = '';
  let translationReadingPromise = Promise.resolve('');

  if (keyMode) {
    try {
      dictionary = await defineWord(scoped, token, clipped.text, lang, signal);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      dictionaryError = error;
    }
    throwIfAborted(signal);
    translation = firstGloss(dictionary);
    if (!translation && !dictionary) {
      throw dictionaryError || new Error(tr('errNoResult'));
    }
    if (canSpeak(targetLanguage) && translation) {
      translationReadingPromise = pronounce(scoped, token, translation, targetLanguage, signal);
    }
  } else {
    const translatedPromise = translateText(scoped, token, clipped.text, lang, signal)
      .then((value) => ({ translation: value }))
      .catch((error) => ({ translationError: error }));
    const dictionaryPromise = defineWord(scoped, token, clipped.text, lang, signal)
      .then((value) => ({ dictionary: value }))
      .catch((error) => {
        if (error.name === 'AbortError') throw error;
        return { dictionaryError: error };
      });
    const translated = await translatedPromise;
    throwIfAborted(signal);
    translation = translated.translation || '';
    cloudTranslation = translation;
    if (canSpeak(targetLanguage) && translation) {
      translationReadingPromise = pronounce(scoped, token, translation, targetLanguage, signal);
    }
    if (translation) {
      onProgress?.({
        ...base,
        kind: 'word',
        translation,
        dictionary: null,
        dictionaryPending: true,
      });
    }
    const defined = await dictionaryPromise;
    throwIfAborted(signal);
    dictionary = defined.dictionary || null;
    dictionaryError = defined.dictionaryError || null;
    if (!translation && translated.translationError) {
      if (translationDisabled(translated.translationError)) {
        translation = firstGloss(dictionary);
        translationEngine = 'gemini';
      } else {
        translationNote = explainGcpError(translated.translationError).message;
        translation = firstGloss(dictionary);
      }
    }
    if (translation && !cloudTranslation && canSpeak(targetLanguage)) {
      translationReadingPromise = pronounce(scoped, token, translation, targetLanguage, signal);
    }
    if (!translation && !dictionary) {
      throw dictionaryError || translated.translationError || new Error(tr('errNoResult'));
    }
  }

  await fillReadings(scoped, token, dictionary, lang, targetLanguage, signal);
  let translationReading = await translationReadingPromise;
  const firstSense = dictionary?.entries?.[0]?.senses?.[0];
  if (!translationReading && firstSense?.glossTargetReading && (!cloudTranslation || sameReadingText(firstSense.glossZh, translation))) {
    translationReading = firstSense.glossTargetReading;
  }

  const result = {
    ...base,
    kind: 'word',
    translation,
    translationReading,
    translationEngine,
    translationNote,
    dictionary,
    dictionaryPending: false,
    dictionaryError: dictionaryError ? explainGcpError(dictionaryError).message : '',
  };
  if (!dictionaryError) remember(scoped, kind, lang, clipped.text, result);
  return result;
}

async function testConnection(settings, signal) {
  if (usesApiKey(settings)) {
    if (!String(settings.geminiApiKey || '').trim()) {
      throw Object.assign(new Error(tr('errFillKey')), { status: 0 });
    }
    await geminiTranslate({ ...settings, pair: 'en-zh' }, '', 'hello', 'en', signal);
    return tr('errKeyReady');
  }
  if (!settings.projectId) {
    throw Object.assign(new Error(tr('errFillProject')), { status: 0 });
  }
  const probe = { ...settings, pair: 'en-zh' };
  const token = await getToken(settings);
  let translationReady = false;
  try {
    await translateText(probe, token, 'hello', 'en', signal);
    translationReady = true;
  } catch (error) {
    if (!translationDisabled(error)) {
      error.phase = 'translation';
      throw error;
    }
  }
  try {
    await defineWord(probe, token, 'hello', 'en', signal);
  } catch (error) {
    error.phase = 'dictionary';
    throw error;
  }
  if (!translationReady) {
    return tr('errVertexOnly');
  }
  return tr('errBothReady');
}

module.exports = {
  lookup,
  testConnection,
  modelUrl,
  clearCache,
  clearAuth,
  configureLookupCache,
  flushLookupCache,
  decodeEntities,
};
