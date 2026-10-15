'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDictionary, sanitizeTokens, firstGloss } = require('../src/main/dictionary');

test('dictionary payload is trimmed to a card-sized entry', () => {
  const result = sanitizeDictionary({
    headword: ' run ',
    phonetic: ' /rʌn/ ',
    lemma: 'run',
    note: '',
    entries: [
      null,
      {
        pos: 'v.',
        posZh: '动词',
        senses: [
          {
            glossZh: '跑',
            glossMono: 'to move quickly on foot',
            examples: [
              { text: 'I run daily.', translation: '我每天跑步。' },
              { text: 'They run a shop.', translation: '他们经营一家店。' },
              { text: 'extra', translation: '多余' },
            ],
          },
          { glossZh: '', glossMono: '', examples: [] },
        ],
      },
    ],
  }, 'en');

  assert.equal(result.headword, 'run');
  assert.equal(result.phonetic, '/rʌn/');
  assert.equal(result.monoLabel, '英英');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].senses.length, 1);
  assert.equal(result.entries[0].senses[0].examples.length, 2);
  assert.equal(result.entries[0].senses[0].examples[0].reading, '');
  assert.equal(result.entries[0].senses[0].glossReading, '');
  assert.equal(firstGloss(result), '跑');
});

test('Japanese entries are marked 日日', () => {
  const result = sanitizeDictionary({
    headword: 'やさしい',
    phonetic: 'やさしい',
    entries: [{ pos: 'adj.', posZh: '形容词', senses: [{ glossZh: '温柔', glossMono: '他人にやさしく接する' }] }],
  }, 'ja');
  assert.equal(result.monoLabel, '日日');
});

test('Chinese entries keep a Chinese gloss label', () => {
  const result = sanitizeDictionary({
    headword: '学习',
    phonetic: 'xué xí',
    entries: [{ pos: '动', posZh: '动词', senses: [{ glossZh: 'to study', glossMono: '掌握知识或技能' }] }],
  }, 'zh');
  assert.equal(result.monoLabel, '释义');
  assert.equal(firstGloss(result), 'to study');
});

test('English and Japanese readings stay on the card', () => {
  const result = sanitizeDictionary({
    headword: 'run',
    phonetic: '/rʌn/',
    entries: [{
      pos: 'v.',
      posZh: '动词',
      senses: [{
        glossZh: '跑',
        glossMono: 'to move quickly on foot',
        glossReading: '/tə muːv ˈkwɪkli/',
        examples: [{ text: 'I run daily.', translation: '我每天跑步。', reading: '/aɪ rʌn ˈdeɪli/' }],
      }],
    }],
  }, 'en');
  assert.equal(result.entries[0].senses[0].glossReading, '/tə muːv ˈkwɪkli/');
  assert.equal(result.entries[0].senses[0].examples[0].reading, '/aɪ rʌn ˈdeɪli/');
});

test('word cards keep inflection forms and sentences keep a token breakdown', () => {
  const card = sanitizeDictionary({
    headword: 'run',
    phonetic: '/rʌn/',
    inflections: [
      { label: '过去式', form: 'ran', reading: '/ræn/' },
      { label: '', form: '', reading: '' },
    ],
    entries: [{ pos: 'v.', posZh: '动词', senses: [{ glossZh: '跑', glossMono: 'to run' }] }],
  }, 'en');
  assert.equal(card.inflections.length, 1);
  assert.equal(card.inflections[0].label, '过去式');
  assert.equal(card.inflections[0].form, 'ran');

  const tokens = sanitizeTokens({
    tokens: [
      { text: 'run', reading: '/rʌn/', translation: '跑' },
      { text: '', reading: '', translation: '' },
    ],
  });
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].translation, '跑');
});
