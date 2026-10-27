'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, fallbackLanguage, normalizePair, pinnedLanguage, resolveLanguage, scriptLanguage } = require('../src/main/classify');

test('script hints skip mixed and kanji-only text', () => {
  assert.equal(scriptLanguage('ephemeral'), 'en');
  assert.equal(scriptLanguage('take off'), 'en');
  assert.equal(scriptLanguage('やさしい'), 'ja');
  assert.equal(scriptLanguage('カタカナ'), 'ja');
  assert.equal(scriptLanguage('勉強'), null);
  assert.equal(scriptLanguage('hello世界'), null);
});

test('shared kanji stays Chinese and Japanese glyph forms stay Japanese', () => {
  assert.equal(resolveLanguage('猫', 'zh'), 'zh');
  assert.equal(resolveLanguage('苹果', 'ja'), 'zh');
  assert.equal(resolveLanguage('学习', 'ja'), 'zh');
  assert.equal(resolveLanguage('時', 'zh'), 'ja');
  assert.equal(resolveLanguage('時', 'ja'), 'ja');
  assert.equal(resolveLanguage('勉強', 'zh'), 'ja');
  assert.equal(resolveLanguage('東京', 'zh'), 'ja');
  assert.equal(resolveLanguage('経済', 'zh'), 'ja');
  assert.equal(resolveLanguage('やさしい', 'zh'), 'ja');
  assert.equal(resolveLanguage('私は学生です', 'zh'), 'ja');
  assert.equal(fallbackLanguage('時'), 'ja');
  assert.equal(resolveLanguage('中国人', 'ja'), 'zh');
  assert.equal(fallbackLanguage('中国人'), 'zh');
  assert.equal(pinnedLanguage('ja'), 'ja');
  assert.equal(pinnedLanguage('auto'), '');
  assert.equal(normalizePair('ja-en'), 'ja-en');
  assert.equal(normalizePair('', { sourcePin: 'zh', zhTarget: 'ja' }), 'zh-ja');
  assert.equal(normalizePair('', { sourcePin: 'ja' }), 'ja-zh');
  assert.equal(normalizePair('auto'), 'en-zh');
});

test('simplified Chinese and pronouns are not looked up as Japanese', () => {
  assert.equal(resolveLanguage('你好', 'ja'), 'zh');
  assert.equal(resolveLanguage('我爱你', 'zh'), 'zh');
  assert.equal(resolveLanguage('这个', 'zh'), 'zh');
  assert.equal(resolveLanguage('学习', 'zh'), 'zh');
  assert.equal(resolveLanguage('hello世界', 'zh'), 'mix');
  assert.equal(fallbackLanguage('猫'), 'zh');
  assert.equal(fallbackLanguage('你好'), 'zh');
  assert.equal(fallbackLanguage('ephemeral'), 'en');
});

test('words and sentences are split for the two result layouts', () => {
  assert.equal(classify('ephemeral', 'en'), 'word');
  assert.equal(classify('take off', 'en'), 'word');
  assert.equal(classify('New York', 'en'), 'word');
  assert.equal(classify('state of the art', 'en'), 'word');
  assert.equal(classify('how are you', 'en'), 'sentence');
  assert.equal(classify('I love you', 'en'), 'sentence');
  assert.equal(classify('He runs', 'en'), 'sentence');
  assert.equal(classify('The early bird catches the worm.', 'en'), 'sentence');
  assert.equal(classify('やさしい', 'ja'), 'word');
  assert.equal(classify('猫', 'ja'), 'word');
  assert.equal(classify('こんにちは', 'ja'), 'word');
  assert.equal(classify('私は学生です', 'ja'), 'sentence');
  assert.equal(classify('今日はいい天気ですね', 'ja'), 'sentence');
  assert.equal(classify('ありがとうございます', 'ja'), 'sentence');
});

test('Chinese words and sentences take the outbound path', () => {
  assert.equal(classify('学习', 'zh'), 'word');
  assert.equal(classify('苹果', 'zh'), 'word');
  assert.equal(classify('人工智能', 'zh'), 'word');
  assert.equal(classify('可持续发展', 'zh'), 'word');
  assert.equal(classify('我爱你', 'zh'), 'sentence');
  assert.equal(classify('苹果我吃', 'zh'), 'sentence');
  assert.equal(classify('乱序中文测试一串', 'zh'), 'sentence');
  assert.equal(classify('今天天气真好', 'zh'), 'sentence');
  assert.equal(classify('你好吗', 'zh'), 'sentence');
  assert.equal(classify('这是一个苹果。', 'zh'), 'sentence');
});
