'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const context = {};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname, '../src/renderer/reading.js'), 'utf8'), context);

test('Japanese kanji readings become ruby', () => {
  const html = context.rubyHtml('今日(きょう)はいい天気(てんき)ですね');
  assert.match(html, /<ruby>今日<rt>きょう<\/rt><\/ruby>/);
  assert.match(html, /<ruby>天気<rt>てんき<\/rt><\/ruby>/);
  assert.match(html, /はいい/);
  assert.equal(context.rubyHtml('やさしい'), '');
});

test('English readings stay on a phonetic line', () => {
  const parts = context.annotationParts('How are you', '/haʊ ɑː juː/', 'en');
  assert.equal(parts.html, 'How are you');
  assert.equal(parts.phonetic, '/haʊ ɑː juː/');
});

test('spoken text drops furigana in parentheses', () => {
  assert.equal(context.spokenText('このシステムは明日(あした)復旧（ふっきゅう）するでしょう。'), 'このシステムは明日復旧するでしょう。');
  assert.equal(context.spokenText('I run daily.'), 'I run daily.');
});

test('Japanese annotation prefers ruby over a second line', () => {
  const parts = context.annotationParts('今日はいい天気ですね', '今日(きょう)はいい天気(てんき)ですね', 'ja');
  assert.match(parts.html, /<ruby>今日<rt>きょう<\/rt><\/ruby>/);
  assert.equal(parts.phonetic, '');
});
