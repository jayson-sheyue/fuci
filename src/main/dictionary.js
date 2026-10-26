'use strict';

function clean(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeInflections(raw) {
  const forms = [];
  const source = Array.isArray(raw) ? raw : [];
  for (const item of source) {
    if (forms.length >= 6) break;
    if (!item || typeof item !== 'object') continue;
    const form = clean(item.form, 80);
    if (!form) continue;
    forms.push({
      label: clean(item.label, 24) || '形式',
      form,
      reading: clean(item.reading, 120),
    });
  }
  return forms;
}

function sanitizeTokens(raw) {
  const tokens = [];
  const source = Array.isArray(raw?.tokens) ? raw.tokens : [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const text = clean(item.text, 40);
    if (!text) continue;
    tokens.push({
      text,
      reading: clean(item.reading, 80),
      translation: clean(item.translation, 40),
    });
  }
  return tokens;
}

function sanitizeDictionary(raw, lang) {
  if (!raw || typeof raw !== 'object') return null;
  const entries = [];
  const source = Array.isArray(raw.entries) ? raw.entries : [];
  for (const entry of source) {
    if (entries.length >= 2) break;
    if (!entry || typeof entry !== 'object') continue;
    const senses = [];
    const rawSenses = Array.isArray(entry.senses) ? entry.senses : [];
    for (const sense of rawSenses) {
      if (senses.length >= 2) break;
      if (!sense || typeof sense !== 'object') continue;
      const examples = [];
      const rawExamples = Array.isArray(sense.examples) ? sense.examples : [];
      for (const example of rawExamples) {
        if (examples.length >= 2) break;
        if (!example || typeof example !== 'object') continue;
        const text = clean(example.text, 280);
        const translation = clean(example.translation, 280);
        const reading = clean(example.reading, 500);
        if (text) examples.push({ text, translation, reading });
      }
      const glossZh = clean(sense.glossZh, 180);
      const glossMono = clean(sense.glossMono, 280);
      const glossReading = clean(sense.glossReading, 500);
      if (!glossZh && !glossMono && examples.length === 0) continue;
      senses.push({ glossZh, glossMono, glossReading, examples });
    }
    if (senses.length === 0) continue;
    entries.push({
      pos: clean(entry.pos, 24) || '—',
      posZh: clean(entry.posZh, 24) || '释义',
      senses,
    });
  }

  return {
    headword: clean(raw.headword, 80),
    phonetic: clean(raw.phonetic, 80),
    lemma: clean(raw.lemma, 80),
    note: clean(raw.note, 200),
    inflections: sanitizeInflections(raw.inflections),
    entries,
    monoLabel: lang === 'zh' ? '释义' : lang === 'ja' ? '日日' : '英英',
  };
}

function firstGloss(dictionary) {
  const sense = dictionary?.entries?.[0]?.senses?.[0];
  return sense?.glossZh || '';
}

module.exports = {
  sanitizeDictionary,
  sanitizeTokens,
  firstGloss,
};
