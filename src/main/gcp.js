'use strict';

const { classify, fallbackLanguage, languageLabel, pinnedLanguage, resolveLanguage, scriptLanguage } = require('./classify');
const { httpFetch } = require('./http');
const { accessToken } = require('./oauth');
const { firstGloss, sanitizeDictionary, sanitizeTokens } = require('./dictionary');
const { explainGcpError } = require('./errors');
const lookupCache = require('./lookup-cache');

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
  const token = accessToken(settings);
  if (!token) {
    const error = new Error('TOKEN_EXPIRED');
    error.status = 401;
    throw error;
  }
  return token;
}

async function postJson(url, token, projectId, body, signal) {
  throwIfAborted(signal);
  let response;
  try {
    response = await httpFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'x-goog-user-project': projectId,
      },
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
    const error = new Error(data.error?.message || response.statusText || '请求失败');
    error.status = response.status;
    throw error;
  }
  return data;
}

function translationUrl(projectId, method) {
  return `https://translation.googleapis.com/v3/projects/${projectId}/locations/global:${method}`;
}

async function detectLanguage(settings, token, text, signal) {
  const sample = [...text].slice(0, 200).join('');
  const data = await postJson(
    translationUrl(settings.projectId, 'detectLanguage'),
    token,
    settings.projectId,
    { content: sample },
    signal
  );
  return data.languages?.[0]?.languageCode || 'und';
}

function outputLanguage(settings, source) {
  if (source === 'zh') {
    return settings.zhTarget === 'ja'
      ? { code: 'ja', name: '日语' }
      : { code: 'en', name: '英语' };
  }
  return settings.target === 'zh-TW'
    ? { code: 'zh-TW', name: '繁体中文' }
    : { code: 'zh-CN', name: '简体中文' };
}

async function translateText(settings, token, text, source, signal) {
  const target = outputLanguage(settings, source);
  const body = {
    contents: [text],
    mimeType: 'text/plain',
    targetLanguageCode: target.code,
  };
  if (source === 'zh') {
    body.sourceLanguageCode = settings.target === 'zh-TW' ? 'zh-TW' : 'zh-CN';
  } else if (source && source !== 'und' && source !== 'mix') {
    body.sourceLanguageCode = source;
  }
  const data = await postJson(
    translationUrl(settings.projectId, 'translateText'),
    token,
    settings.projectId,
    body,
    signal
  );
  const translated = data.translations?.[0]?.translatedText;
  if (!translated) throw Object.assign(new Error('翻译接口没有返回内容'), { status: 502 });
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

function dictionaryPrompt(text, lang, settings) {
  const chinese = settings.target === 'zh-TW' ? '繁体中文' : '简体中文';
  if (lang === 'zh') {
    const foreign = outputLanguage(settings, 'zh').name;
    return [
      '为词典卡片编写一个中文词条，并译成目标语言。输入是中文单词、成语或固定短语。',
      `输入：${JSON.stringify(text)}`,
      `目标语言：${foreign}`,
      `中文变体：${chinese}`,
      'phonetic：汉语拼音，带声调，音节之间用空格，例如 xué xí。不要注音符号，不要汉字。',
      'lemma：词典原形。与输入词面相同时留空字符串。',
      'entries：最多两个词性。pos 用简称（名、动、形、副、量、成语），posZh 用完整中文词性。',
      `每个词性最多两个义项。glossZh 用${foreign}给出该义项的简短译文。glossReading 是 glossZh 的读音：英语用一行国际音标，词之间空格并标重音，例如 /tə ˈstʌdi/；日语把汉字写成漢字(かな)，假名原样保留。glossMono 用指定中文解释该义项，一句话。`,
      `每个义项给一句例句：text 用指定中文且包含该词，translation 用${foreign}。reading 是 translation 的读音，规则与 glossReading 相同。例句用现代日常说法。`,
      'inflections：给出目标语言译词的形态变化，最多 6 项。英语动词依次为原形、第三人称单数、现在分词、过去式、过去分词；英语名词为单数、复数；英语形容词为原级、比较级、最高级。日语动词依次为辞書形、ます形、て形、た形、ない形。label 用中文，form 用目标语言，reading 是 form 的读音。没有词形变化时用空数组。',
      '只写现代常用义项。不要收入隐语、古义或极冷僻的用法。',
      '如果输入不是真实存在的词或短语，entries 使用空数组，note 用中文说明；否则 note 为空字符串。',
      '不要编造明显不存在的读音。专有名词和常见缩写可以收录。',
    ].join('\n');
  }
  const language = lang === 'ja' ? '日语' : '英语';
  return [
    '为词典卡片编写一个词条。输入是英语或日语的单词、习语或固定短语。',
    `输入：${JSON.stringify(text)}`,
    `语言：${language}`,
    `中文变体：${chinese}`,
    'phonetic：英语必须是国际音标 IPA，两侧加斜线并标注重音，例如 /ɪˈfem.ər.əl/。日语必须是平假名读音，例如 やさしい，不要罗马字。',
    'lemma：词典原形。与输入词面相同时留空字符串。',
    'entries：最多两个词性。pos 用词典缩写（n. v. adj. adv. phr. pron. conj. 等），posZh 用中文词性。',
    '每个词性最多两个义项。glossZh 用指定中文，简短。glossMono 用词条原语言解释该义项（英语词条用英语，日语词条用日语），一句话。glossReading 是 glossMono 的读音：英语用一行国际音标，例如 /tə muːv ˈkwɪkli ɒn fʊt/；日语把汉字写成漢字(かな)。',
    '每个义项给一句例句：text 用原语言且包含该词，translation 用指定中文。reading 是 text 的读音，规则与 glossReading 相同。例句用现代日常说法。',
    'inflections：给出这个词的形态变化，最多 6 项。英语动词依次为原形、第三人称单数、现在分词、过去式、过去分词；名词为单数、复数；形容词为原级、比较级、最高级。日语动词依次为辞書形、ます形、て形、た形、ない形。label 用中文，form 用词条原语言，reading 是 form 的读音。没有词形变化时用空数组。',
    '只写现代常用义项。不要收入隐语、古义或极冷僻的用法。',
    '如果输入不是真实存在的词或短语，entries 使用空数组，note 用中文说明；否则 note 为空字符串。',
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
    throw Object.assign(new Error('词条返回的不是有效 JSON'), { status: 502 });
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
      const data = await postJson(
        vertexUrl(settings),
        token,
        settings.projectId,
        dictionaryBody(text, lang, settings, attempt),
        signal
      );
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
  return /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured|translate\.googleapis\.com/i.test(error?.message || '');
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
      const data = await postJson(vertexUrl(settings), token, settings.projectId, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }, signal);
      const reading = tidyReading(candidateText(data), lang);
      if (!reading) throw Object.assign(new Error('模型没有返回读音'), { status: 502 });
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

async function fillReadings(settings, token, dictionary, lang, targetLanguage, signal) {
  if (!dictionary) return;
  const jobs = [];
  const glossLang = lang === 'zh' ? targetLanguage : lang;
  for (const entry of dictionary.entries || []) {
    for (const sense of entry.senses || []) {
      if (!sense.glossReading) {
        const gloss = lang === 'zh' ? sense.glossZh : sense.glossMono;
        jobs.push(pronounce(settings, token, gloss, glossLang, signal).then((reading) => {
          sense.glossReading = reading;
        }));
      }
      for (const example of sense.examples || []) {
        if (example.reading) continue;
        const sample = lang === 'zh' ? example.translation : example.text;
        const sampleLang = lang === 'zh' ? targetLanguage : lang;
        jobs.push(pronounce(settings, token, sample, sampleLang, signal).then((reading) => {
          example.reading = reading;
        }));
      }
    }
  }
  if ((lang === 'en' || lang === 'ja') && !dictionary.phonetic) {
    jobs.push(pronounce(settings, token, dictionary.headword, lang, signal).then((reading) => {
      dictionary.phonetic = reading;
    }));
  }
  await Promise.all(jobs);
}

async function geminiTranslate(settings, token, text, source, signal) {
  const target = outputLanguage(settings, source);
  const prompt = `把下面的文本翻译成${target.name}。只输出译文本身，不要加引号或解释。\n\n${text}`;
  let lastError = null;
  for (const thinking of [true, false]) {
    const generationConfig = { maxOutputTokens: 2048 };
    if (thinking) generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
    try {
      const data = await postJson(vertexUrl(settings), token, settings.projectId, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }, signal);
      const translated = candidateText(data).replace(/^["“「『]|["”」』]$/g, '').trim();
      if (!translated) throw Object.assign(new Error('模型没有返回译文'), { status: 502 });
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
    if (error.name === 'AbortError' || !translationDisabled(error)) throw error;
    const translation = await geminiTranslate(settings, token, text, source, signal);
    return { translation, translationEngine: 'gemini' };
  }
}

function offlineLanguage(text, forced) {
  if (forced) return forced;
  const lang = fallbackLanguage(text);
  return lang === 'und' ? '' : lang;
}

function recall(settings, text, forced) {
  const lang = offlineLanguage(text, forced);
  if (!lang) return lookupCache.find(settings, text);
  const kind = lang === 'en' || lang === 'ja' || lang === 'zh' ? classify(text, lang) : 'sentence';
  return lookupCache.read(settings, kind, lang, text);
}

function remember(settings, kind, lang, text, value) {
  lookupCache.put(settings, kind, lang, text, value);
}

async function analyzeSentence(settings, token, text, lang, signal) {
  const gloss = lang === 'zh'
    ? outputLanguage(settings, 'zh').name
    : (settings.target === 'zh-TW' ? '繁体中文' : '简体中文');
  const prompt = [
    '把句子拆成逐词释义，保持原句顺序，最多 24 个词。',
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
    const generationConfig = { maxOutputTokens: 4096, responseMimeType: 'application/json' };
    if (attempt.schema) generationConfig.responseSchema = schema;
    if (attempt.thinking) generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
    try {
      const data = await postJson(vertexUrl(settings), token, settings.projectId, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }, signal);
      const rawText = candidateText(data);
      if (!rawText) throw Object.assign(new Error('模型没有返回逐词释义'), { status: 502 });
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

async function lookup(text, settings, { signal, onProgress, source } = {}) {
  const original = String(text || '').trim();
  if (!original) return { kind: 'empty' };
  if (!settings.projectId) {
    return {
      kind: 'setup',
      message: '还没有 GCP 项目 ID。请在设置里填写，或先用 gcloud config set project 选中项目。',
    };
  }

  const clipped = clip(original, 800);
  const forced = pinnedLanguage(source);
  const cached = recall(settings, clipped.text, forced);
  if (cached) return { ...cached, query: original, truncated: clipped.truncated, pinned: Boolean(forced) };

  const token = await getToken(settings);
  const hinted = forced || scriptLanguage(clipped.text);
  let lang = hinted;
  if (!forced && !lang) {
    try {
      lang = resolveLanguage(clipped.text, await detectLanguage(settings, token, clipped.text, signal));
    } catch (error) {
      if (error.name === 'AbortError' || !translationDisabled(error)) throw error;
      lang = fallbackLanguage(clipped.text);
    }
  }
  throwIfAborted(signal);

  const kind = lang === 'en' || lang === 'ja' || lang === 'zh' ? classify(clipped.text, lang) : 'sentence';

  const targetLanguage = lang === 'zh' ? (settings.zhTarget === 'ja' ? 'ja' : 'en') : 'zh';
  const base = {
    query: original,
    sourceLanguage: lang,
    sourceLanguageLabel: languageLabel(lang),
    targetLanguage,
    truncated: clipped.truncated,
    pinned: Boolean(forced),
  };

  if (kind !== 'word') {
    const sourceReading = (lang === 'en' || lang === 'ja')
      ? pronounce(settings, token, clipped.text, lang, signal)
      : Promise.resolve('');
    const analysis = analyzeSentence(settings, token, clipped.text, lang, signal).catch((error) => {
      if (error.name === 'AbortError') throw error;
      return [];
    });
    const translated = await translateOrFallback(settings, token, clipped.text, lang, signal);
    const translationReading = lang === 'zh'
      ? await pronounce(settings, token, translated.translation, targetLanguage, signal)
      : '';
    const reading = await sourceReading;
    const tokens = await analysis;
    const result = { ...base, kind: 'sentence', ...translated, reading, translationReading, tokens };
    const readingReady = (!(lang === 'en' || lang === 'ja') || reading) && (lang !== 'zh' || translationReading);
    if (translated.translationEngine === 'cloud-translation' && readingReady && tokens.length) {
      remember(settings, kind, lang, clipped.text, result);
    }
    return result;
  }

  const translationPromise = translateText(settings, token, clipped.text, lang, signal)
    .then((translation) => ({ translation }))
    .catch((error) => ({ translationError: error }));
  const dictionaryPromise = defineWord(settings, token, clipped.text, lang, signal)
    .then((dictionary) => ({ dictionary }))
    .catch((error) => ({ dictionaryError: error }));

  const translated = await translationPromise;
  throwIfAborted(signal);
  let translation = translated.translation || '';
  const translationReadingPromise = (lang === 'zh' && translation)
    ? pronounce(settings, token, translation, targetLanguage, signal)
    : Promise.resolve('');
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
  const dictionary = defined.dictionary || null;
  let translationEngine = translated.translation ? 'cloud-translation' : 'gemini';
  let translationNote = '';
  if (!translation) {
    translation = firstGloss(dictionary);
    if (translated.translationError && !translationDisabled(translated.translationError)) {
      translationNote = explainGcpError(translated.translationError).message;
      translationEngine = 'cloud-translation';
    }
  }
  if (!translation && !dictionary) {
    throw translated.translationError || defined.dictionaryError || new Error('没有查到结果');
  }

  await fillReadings(settings, token, dictionary, lang, targetLanguage, signal);
  let translationReading = await translationReadingPromise;
  const firstSense = dictionary?.entries?.[0]?.senses?.[0];
  if (lang === 'zh' && !translationReading && firstSense?.glossReading && (!translated.translation || sameReadingText(firstSense.glossZh, translation))) {
    translationReading = firstSense.glossReading;
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
    dictionaryError: defined.dictionaryError ? explainGcpError(defined.dictionaryError).message : '',
  };
  if (!defined.dictionaryError) remember(settings, kind, lang, clipped.text, result);
  return result;
}

async function testConnection(settings, signal) {
  if (!settings.projectId) {
    throw Object.assign(new Error('请填写 GCP 项目 ID'), { status: 0 });
  }
  const token = await getToken(settings);
  let translationReady = false;
  try {
    await translateText(settings, token, 'hello', 'en', signal);
    translationReady = true;
  } catch (error) {
    if (error.name === 'AbortError' || !translationDisabled(error)) {
      error.phase = 'translation';
      throw error;
    }
  }
  try {
    await defineWord(settings, token, 'hello', 'en', signal);
  } catch (error) {
    error.phase = 'dictionary';
    throw error;
  }
  if (!translationReady) {
    return 'Vertex AI 可用。Cloud Translation API 还没启用，句子会先由 Gemini 翻译；启用后会自动改走翻译接口。';
  }
  return 'Cloud Translation 和 Vertex AI 都可以用。';
}

module.exports = {
  lookup,
  testConnection,
  clearCache,
  clearAuth,
  configureLookupCache,
  flushLookupCache,
  decodeEntities,
};
