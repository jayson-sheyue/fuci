'use strict';

const search = document.getElementById('search');
const input = document.getElementById('q');
const hint = document.getElementById('hint');
const clearBtn = document.getElementById('clear');
const busy = document.getElementById('busy');
const gear = document.getElementById('gear');
const langPin = document.getElementById('lang');
const seal = document.getElementById('seal');
const orb = document.getElementById('orb');
const orbFlow = document.getElementById('orb-flow');
const board = document.getElementById('board');
const boardBody = document.getElementById('board-body');
const shell = document.getElementById('shell');

const THEMES = [
  { id: 'sky', key: 'themeSky', swatch: '#007aff' },
  { id: 'bamboo', key: 'themeBamboo', swatch: '#1f8a4c' },
  { id: 'cinnabar', key: 'themeCinnabar', swatch: '#c44536' },
  { id: 'wisteria', key: 'themeWisteria', swatch: '#7b4fd3' },
  { id: 'amber', key: 'themeAmber', swatch: '#c47a12' },
  { id: 'haitang', key: 'themeHaitang', swatch: '#d4537e' },
  { id: 'night', key: 'themeNight', swatch: '#64b5ff' },
];
const UI_LOCALES = [
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
];

const ORB_COLORS = {
  sky: {
    halo: ['rgba(120, 186, 255, 0.55)', 'rgba(80, 160, 255, 0.22)', 'rgba(170, 214, 255, 0.08)'],
    body: ['rgba(210, 232, 255, 0.96)', 'rgba(26, 116, 255, 0.9)', 'rgba(10, 90, 230, 0.45)', 'rgba(140, 196, 255, 0)'],
    blobs: ['#5ac8ff', '#0a84ff', '#64d2ff'],
    light: '#d6ecff',
  },
  bamboo: {
    halo: ['rgba(150, 220, 170, 0.55)', 'rgba(40, 150, 80, 0.22)', 'rgba(180, 230, 190, 0.08)'],
    body: ['rgba(220, 245, 225, 0.96)', 'rgba(31, 138, 76, 0.9)', 'rgba(16, 90, 48, 0.45)', 'rgba(140, 210, 160, 0)'],
    blobs: ['#7ddea0', '#1f8a4c', '#b7f0c8'],
    light: '#e5f8ea',
  },
  cinnabar: {
    halo: ['rgba(240, 160, 140, 0.55)', 'rgba(190, 70, 50, 0.22)', 'rgba(245, 190, 175, 0.08)'],
    body: ['rgba(255, 226, 216, 0.96)', 'rgba(196, 69, 54, 0.9)', 'rgba(130, 36, 28, 0.45)', 'rgba(240, 160, 140, 0)'],
    blobs: ['#f0a090', '#c44536', '#f6cfc4'],
    light: '#ffe8e2',
  },
  wisteria: {
    halo: ['rgba(190, 160, 245, 0.55)', 'rgba(120, 70, 210, 0.22)', 'rgba(210, 190, 245, 0.08)'],
    body: ['rgba(236, 226, 255, 0.96)', 'rgba(123, 79, 211, 0.9)', 'rgba(70, 36, 140, 0.45)', 'rgba(190, 160, 245, 0)'],
    blobs: ['#c4a6f5', '#7b4fd3', '#e4d6ff'],
    light: '#f3ebff',
  },
  amber: {
    halo: ['rgba(240, 196, 110, 0.55)', 'rgba(190, 120, 20, 0.24)', 'rgba(245, 220, 160, 0.08)'],
    body: ['rgba(255, 236, 196, 0.96)', 'rgba(196, 122, 18, 0.9)', 'rgba(120, 72, 8, 0.45)', 'rgba(240, 196, 110, 0)'],
    blobs: ['#f0c46e', '#c47a12', '#ffe3a8'],
    light: '#fff3d6',
  },
  haitang: {
    halo: ['rgba(245, 170, 196, 0.55)', 'rgba(200, 70, 120, 0.22)', 'rgba(250, 200, 216, 0.08)'],
    body: ['rgba(255, 226, 236, 0.96)', 'rgba(212, 83, 126, 0.9)', 'rgba(140, 40, 78, 0.45)', 'rgba(245, 170, 196, 0)'],
    blobs: ['#f5aac4', '#d4537e', '#ffd6e4'],
    light: '#ffe8f0',
  },
  night: {
    halo: ['rgba(140, 196, 255, 0.45)', 'rgba(40, 90, 160, 0.28)', 'rgba(80, 140, 210, 0.08)'],
    body: ['rgba(210, 230, 255, 0.9)', 'rgba(70, 140, 220, 0.85)', 'rgba(16, 48, 96, 0.4)', 'rgba(100, 160, 230, 0)'],
    blobs: ['#9fd0ff', '#3d8adf', '#d6ecff'],
    light: '#e7f3ff',
  },
};

const state = {
  mode: 'idle',
  bootstrap: null,
  result: null,
  auth: { signedIn: false, expired: false, expiresAt: 0 },
  authTimer: 0,
  update: { available: false },
  theme: 'sky',
  locale: 'zh',
};

function locale() {
  return state.locale === 'ja' || state.locale === 'en' ? state.locale : 'zh';
}

function t(key, vars) {
  return window.fuciI18n.t(locale(), key, vars);
}

function paintChrome() {
  document.documentElement.lang = locale() === 'ja' ? 'ja' : locale() === 'en' ? 'en' : 'zh-CN';
  input.placeholder = t('placeholder');
  input.setAttribute('aria-label', t('queryAria'));
  clearBtn.setAttribute('aria-label', t('clear'));
  orb.setAttribute('aria-label', t('orbExpand'));
  orb.title = t('orbExpandTitle');
  seal.setAttribute('aria-label', t('sealDrag'));
  seal.title = t('sealDrag');
  paintUpdate();
  paintPair();
}

let req = 0;
let timer = 0;
let composing = false;
let lastHeight = 0;
let frame = 0;
let orbMode = false;
let sentMode = 'bar';
const history = [];
let historyCursor = 0;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function sameText(a, b) {
  return String(a || '').replace(/\s+/g, '').toLowerCase() === String(b || '').replace(/\s+/g, '').toLowerCase();
}

function reportHeight() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const mode = orbMode ? 'orb' : 'bar';
    const modeChanged = mode !== sentMode;
    if (modeChanged) {
      sentMode = mode;
      window.fuci.setMode(mode);
    }
    if (mode === 'orb') return;
    const height = Math.ceil(shell.getBoundingClientRect().height);
    if (!modeChanged && Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    window.fuci.setHeight(height);
  });
}

function collapseToOrb() {
  if (orbMode) return;
  cancelSealDrag();
  orbMode = true;
  clearTimeout(timer);
  shell.classList.add('is-orb');
  reportHeight();
}

function expandFromOrb() {
  if (!orbMode) return;
  orbMode = false;
  shell.classList.remove('is-orb');
  reportHeight();
  if (state.mode !== 'settings') {
    input.focus();
  }
}

function paintUpdate() {
  const available = !!state.update?.available;
  const gearDot = document.getElementById('update-dot');
  const orbDot = document.getElementById('orb-update-dot');
  if (gearDot) gearDot.hidden = !available;
  if (orbDot) orbDot.hidden = !available;
  gear.title = available ? t('updateAvailable') : t('settings');
  gear.setAttribute('aria-label', available ? t('settingsUpdate') : t('settings'));
  const offer = document.getElementById('update-offer');
  if (offer) offer.hidden = !available;
}

function syncChrome() {
  const hasText = input.value.length > 0;
  clearBtn.hidden = !hasText;
  hint.hidden = hasText || state.mode === 'loading' || !hint.textContent;
  busy.hidden = state.mode !== 'loading';
  shell.classList.toggle('is-loading', state.mode === 'loading');
}

function showBoard(html) {
  stopSpeech();
  const wasHidden = board.hidden;
  board.hidden = false;
  boardBody.innerHTML = html;
  bindBoard();
  if (wasHidden) {
    board.classList.remove('rise');
    void board.offsetWidth;
    board.classList.add('rise');
  }
  reportHeight();
}

function hideBoard() {
  stopSpeech();
  board.hidden = true;
  boardBody.innerHTML = '';
  board.classList.remove('rise');
  reportHeight();
}

function directionLabel(result) {
  const names = { en: t('langEn'), ja: t('langJa'), zh: t('langZh'), mix: t('langMix') };
  const from = names[result.sourceLanguage] || result.sourceLanguageLabel || '';
  const to = names[result.targetLanguage];
  const label = !to || to === from ? from : `${from} → ${to}`;
  return result.pinned ? t('pinned', { label }) : label;
}

function formsHtml(forms, lang) {
  if (!forms?.length) return '';
  return `<div class="forms">${forms.map((form) => `
    <div class="form">
      <span>${esc(form.label)}</span>
      <b>${esc(form.form)}</b>
      ${form.reading ? `<i>${esc(form.reading)}</i>` : ''}
      ${speakButton(form.form, lang)}
    </div>
  `).join('')}</div>`;
}

function tokensHtml(tokens) {
  if (!tokens?.length) return '';
  return `<div class="tokens">${tokens.map((token) => `
    <div class="token">
      <b>${esc(token.text)}</b>
      ${token.reading ? `<i>${esc(token.reading)}</i>` : ''}
      ${token.translation ? `<span>${esc(token.translation)}</span>` : ''}
    </div>
  `).join('')}</div>`;
}

function footerText(result) {
  if (result?.translationEngine === 'gemini') {
    return result.kind === 'sentence' ? t('footerGeminiSentence') : t('footerGeminiWord');
  }
  if (result?.kind === 'sentence') return t('footerCloud');
  return t('footerBoth');
}

function phoneticLine(reading) {
  return reading ? `<p class="phonetic">${reading}</p>` : '';
}

const SPEAKER_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 9.2v5.6h3.6L13 19.2V4.8L7.6 9.2H4z" fill="currentColor"/><path d="M16.2 9.2a4.2 4.2 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.4 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function speakButton(text, lang) {
  const value = spokenText(text);
  if (!value || (lang !== 'en' && lang !== 'ja')) return '';
  return `<button type="button" class="speak" data-speak="${esc(value)}" data-lang="${lang}" aria-label="${esc(t('play'))}">${SPEAKER_SVG}</button>`;
}

let speechCtx = null;
let speechSource = null;
let speechToken = 0;

function speechContext() {
  if (!speechCtx) speechCtx = new AudioContext();
  return speechCtx;
}

function stopSpeech() {
  speechToken += 1;
  if (speechSource) {
    try { speechSource.stop(); } catch { /* already stopped */ }
    speechSource = null;
  }
}

function audioBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function showSpeakError(message) {
  let note = boardBody.querySelector('.speak-error');
  if (!note) {
    note = document.createElement('p');
    note.className = 'pending speak-error';
    boardBody.appendChild(note);
  }
  note.textContent = message;
}

async function playSpeech(button) {
  if (button.classList.contains('is-playing')) {
    stopSpeech();
    button.classList.remove('is-playing');
    return;
  }
  const ctx = speechContext();
  const unlocked = ctx.resume();
  const token = ++speechToken;
  if (speechSource) {
    try { speechSource.stop(); } catch { /* already stopped */ }
    speechSource = null;
  }
  document.querySelectorAll('.speak.is-playing').forEach((node) => node.classList.remove('is-playing'));
  button.classList.add('is-playing');
  const result = await window.fuci.speak({
    text: button.getAttribute('data-speak') || '',
    lang: button.getAttribute('data-lang') || '',
  });
  if (!button.isConnected || token !== speechToken) return;
  if (!result?.ok || !result.audio) {
    button.classList.remove('is-playing');
    showSpeakError(result?.message || t('playFailedShort'));
    return;
  }
  try {
    await unlocked;
    const buffer = await ctx.decodeAudioData(audioBuffer(result.audio));
    if (!button.isConnected || token !== speechToken) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    speechSource = source;
    source.onended = () => {
      if (speechSource === source) speechSource = null;
      button.classList.remove('is-playing');
    };
    source.start();
  } catch {
    if (token === speechToken) speechSource = null;
    button.classList.remove('is-playing');
    showSpeakError(t('playFailed'));
  }
}

function dictHtml(result) {
  if (result.dictionaryPending) return `<p class="pending">${esc(t('dictPending'))}</p>`;
  if (result.dictionaryError) return `<p class="pending">${esc(result.dictionaryError)}</p>`;
  const dictionary = result.dictionary;
  if (!dictionary || dictionary.entries.length === 0) {
    return dictionary?.note ? `<p class="pending">${esc(dictionary.note)}</p>` : '';
  }
  const source = result.sourceLanguage;
  const target = result.targetLanguage;
  const speakable = (lang) => lang === 'en' || lang === 'ja';
  const senseCount = dictionary.entries.reduce((sum, entry) => sum + entry.senses.length, 0);
  return dictionary.entries.map((entry) => {
    const senses = entry.senses.map((sense) => {
      const showGloss = senseCount > 1 || !sameText(sense.glossZh, result.translation);
      const glossParts = annotationParts(sense.glossZh, speakable(target) ? sense.glossTargetReading : '', target);
      const gloss = showGloss && sense.glossZh
        ? `<p class="gloss">${glossParts.html}</p>${phoneticLine(glossParts.phonetic)}`
        : '';
      const monoParts = annotationParts(sense.glossMono, speakable(source) ? sense.glossReading : '', source);
      const mono = sense.glossMono
        ? `<p class="mono"><span class="tag">${esc(monoTag(result))}</span>${monoParts.html}</p>${phoneticLine(monoParts.phonetic)}`
        : '';
      const examples = sense.examples.map((example) => {
        const src = annotationParts(example.text, speakable(source) ? example.reading : '', source);
        const tr = annotationParts(example.translation, speakable(target) ? example.translationReading : '', target);
        const srcSpeech = speakButton(example.text, source);
        const trSpeech = speakButton(example.translation, target);
        return `
          <div class="example">
            <div class="example-line">
              <p class="src">${src.html}</p>
              ${srcSpeech}
            </div>
            ${phoneticLine(src.phonetic)}
            ${example.translation ? `<div class="example-line"><p class="tr">${tr.html}</p>${trSpeech}</div>${phoneticLine(tr.phonetic)}` : ''}
          </div>
        `;
      }).join('');
      return `<div class="sense">${gloss}${mono}${examples}</div>`;
    }).join('');
    return `
      <section class="entry">
        <div class="pos"><b>${esc(entry.posZh)}</b><span>${esc(entry.pos)}</span></div>
        ${senses}
      </section>
    `;
  }).join('');
}

function monoTag(result) {
  if (result.sourceLanguage === 'ja') return t('jaJa');
  if (result.sourceLanguage === 'zh') return t('glossTag');
  return t('enEn');
}

function renderResult(result) {
  state.mode = 'result';
  state.result = result;
  syncChrome();
  const head = result.dictionary?.headword || result.query;
  const headRuby = result.sourceLanguage === 'ja' ? rubyHtml(result.dictionary?.phonetic || '') : '';
  const phonetic = !headRuby && result.dictionary?.phonetic
    ? `<p class="phonetic">${esc(result.dictionary.phonetic)}</p>`
    : '';
  const lemma = result.dictionary?.lemma && !sameText(result.dictionary.lemma, head)
    ? `<p class="lemma">${esc(t('lemma', { word: result.dictionary.lemma }))}</p>`
    : '';
  const longHead = [...head].length > 18 ? ' long' : '';
  const longTranslation = [...String(result.translation || '')].length > 42 ? ' long' : '';
  const truncated = result.truncated ? `<p class="pending">${esc(t('truncated'))}</p>` : '';
  const sourceNote = annotationParts(result.query, result.reading, result.sourceLanguage);
  const targetNote = annotationParts(result.translation, result.translationReading, result.targetLanguage);
  if (result.kind === 'sentence') {
    showBoard(`
      <div class="kicker"><strong>${esc(t('sentence'))}</strong><span>${esc(directionLabel(result))}</span></div>
      <div class="example-line">
        <p class="original">${sourceNote.html}</p>
        ${speakButton(result.query, result.sourceLanguage)}
      </div>
      ${phoneticLine(sourceNote.phonetic)}
      <div class="translation-row">
        <div class="translation-block">
          <div class="example-line">
            <p class="translation${longTranslation}">${targetNote.html}</p>
            ${speakButton(result.translation, result.targetLanguage)}
          </div>
          ${phoneticLine(targetNote.phonetic)}
        </div>
        <button type="button" class="copy" data-copy="${esc(result.translation)}">${esc(t('copy'))}</button>
      </div>
      ${tokensHtml(result.tokens)}
      ${truncated}
      ${result.translationNote ? `<p class="pending">${esc(result.translationNote)}</p>` : ''}
      <p class="foot">${footerText(result)}</p>
    `);
    return;
  }
  const formLang = result.sourceLanguage === 'en' || result.sourceLanguage === 'ja'
    ? result.sourceLanguage
    : result.targetLanguage;
  showBoard(`
    <div class="kicker"><strong>${esc(t('word'))}</strong><span>${esc(directionLabel(result))}</span></div>
    <div class="head-row">
      <h1 class="head${longHead}">${headRuby || esc(head)}</h1>
      ${speakButton(head, result.sourceLanguage)}
    </div>
    ${phonetic}
    ${lemma}
    <div class="translation-row">
      <div class="translation-block">
        <div class="example-line">
          <p class="translation${longTranslation}">${targetNote.html}</p>
          ${speakButton(result.translation, result.targetLanguage)}
        </div>
        ${phoneticLine(targetNote.phonetic)}
      </div>
      <button type="button" class="copy" data-copy="${esc(result.translation)}">${esc(t('copy'))}</button>
    </div>
    ${formsHtml(result.dictionary?.inflections, formLang)}
    <div class="rule"></div>
    ${dictHtml(result)}
    ${truncated}
    ${result.translationNote ? `<p class="pending">${esc(result.translationNote)}</p>` : ''}
    <p class="foot">${footerText(result)}</p>
  `);
}

function renderLoading() {
  state.mode = 'loading';
  syncChrome();
  showBoard(`
    <div class="skeleton" aria-hidden="true">
      <div class="bar w40"></div>
      <div class="bar w70"></div>
      <div class="bar w90"></div>
    </div>
  `);
}

function renderNotice(result) {
  state.mode = 'notice';
  state.result = result;
  syncChrome();
  showBoard(`<p class="notice">${esc(result.message)}</p>`);
}

function renderError(result) {
  state.mode = 'error';
  state.result = result;
  syncChrome();
  const setup = result.needsSetup
    ? `<div class="actions"><button type="button" class="primary" data-settings>${esc(t('openSettings'))}</button></div>`
    : '';
  const detail = result.detail ? `<p class="detail">${esc(result.detail)}</p>` : '';
  showBoard(`<p class="notice">${esc(result.message)}</p>${detail}${setup}`);
}

function showIdle() {
  state.mode = 'idle';
  state.result = null;
  syncChrome();
  hideBoard();
}

function remember(text) {
  if (history[history.length - 1] === text) {
    historyCursor = history.length;
    return;
  }
  history.push(text);
  if (history.length > 20) history.shift();
  historyCursor = history.length;
}

function applyFinal(result) {
  if (!result || result.kind === 'aborted' || result.kind === 'empty') return;
  if (result.kind === 'error') return renderError(result);
  if (result.kind === 'setup') return openSettings(result.message);
  if (result.kind === 'notice') return renderNotice(result);
  if (result.kind === 'word' || result.kind === 'sentence') return renderResult(result);
}

async function run(text) {
  const id = ++req;
  remember(text);
  renderLoading();
  try {
    const result = await window.fuci.lookup({ id, text });
    if (id !== req) return;
    applyFinal(result);
  } catch (error) {
    if (id !== req) return;
    renderError({ message: t('queryFailed'), detail: error.message || '' });
  }
}

function schedule() {
  clearTimeout(timer);
  syncChrome();
  if (composing) return;
  const text = input.value.trim();
  if (!text) {
    req += 1;
    window.fuci.cancelLookup();
    showIdle();
    return;
  }
  timer = setTimeout(() => run(text), 320);
}

function bindBoard() {
  boardBody.onclick = (event) => {
    const speak = event.target.closest('[data-speak]');
    if (speak) {
      playSpeech(speak);
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      window.fuci.copy(copy.getAttribute('data-copy') || '');
      copy.textContent = t('copied');
      setTimeout(() => {
        if (copy.isConnected) copy.textContent = t('copy');
      }, 1200);
      return;
    }
    if (event.target.closest('[data-settings]')) openSettings();
  };
}

function fieldValue(id) {
  return document.getElementById(id)?.value || '';
}

function stopAuthClock() {
  clearInterval(state.authTimer);
  state.authTimer = 0;
}

function formatRemaining(expiresAt) {
  const ms = Number(expiresAt) - Date.now();
  if (ms <= 0) return t('expired');
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function paintAuthClock() {
  const clock = document.getElementById('token-clock');
  if (!clock) return;
  const auth = state.auth || {};
  if (auth.signedIn && auth.expiresAt > Date.now()) {
    clock.className = 'token-clock live';
    clock.textContent = formatRemaining(auth.expiresAt);
    return;
  }
  clock.className = auth.expired || auth.signedIn ? 'token-clock dead' : 'token-clock';
  clock.textContent = auth.expired || auth.signedIn ? t('expired') : t('signedOut');
}

function startAuthClock() {
  stopAuthClock();
  paintAuthClock();
  state.authTimer = setInterval(async () => {
    if (state.mode !== 'settings') {
      stopAuthClock();
      return;
    }
    try {
      state.auth = await window.fuci.authStatus();
    } catch {
      state.auth = { signedIn: false, expired: true, expiresAt: 0 };
    }
    paintAuthClock();
  }, 1000);
}

function openSettings(message) {
  const boot = state.bootstrap || { settings: {}, shortcutLabel: '' };
  const settings = boot.settings || {};
  const versionText = String(boot.version || '').trim();
  const meta = [versionText ? t('version', { version: versionText }) : '', boot.shortcutLabel || ''].filter(Boolean).join(' · ');
  const opacity = opacityPercent(settings.panelOpacity);
  state.mode = 'settings';
  state.auth = boot.auth || state.auth;
  syncChrome();
  showBoard(`
    <div class="kicker"><strong>${esc(t('settings'))}</strong><span class="meta">${esc(meta)}</span></div>
    <div id="update-offer" class="update-offer" hidden>
      <span class="update-dot"></span>
      <span>${esc(t('updateAvailable'))}</span>
      <button type="button" class="primary" id="apply-update">${esc(t('update'))}</button>
    </div>
    <div class="field"><span>${esc(t('uiLanguage'))}</span>
      <div class="locales" role="listbox" aria-label="${esc(t('uiLanguage'))}">
        ${UI_LOCALES.map((item) => `<button type="button" class="locale-choice${locale() === item.id ? ' is-selected' : ''}" data-locale="${item.id}" role="option" aria-selected="${locale() === item.id ? 'true' : 'false'}">${esc(item.label)}</button>`).join('')}
      </div>
      <p class="ui-hint">${esc(t('uiHint'))}</p>
    </div>
    <p class="notice">${esc(t('notice'))}</p>
    <label class="field"><span>${esc(t('projectId'))}</span>
      <input id="project-id" spellcheck="false" autocapitalize="off" placeholder="my-gcp-project" value="${esc(settings.projectId || '')}" />
    </label>
    <label class="field"><span>${esc(t('locationLabel'))}</span>
      <input id="location" spellcheck="false" value="${esc(settings.location || 'global')}" />
    </label>
    <label class="field"><span>${esc(t('modelId'))}</span>
      <input id="model" spellcheck="false" value="${esc(settings.model || 'gemini-3.8-flash')}" />
    </label>
    <div class="auth-row">
      <button type="button" class="primary" id="connect-google">${esc(t('connect'))}</button>
      <span id="token-clock" class="token-clock">${esc(t('signedOut'))}</span>
    </div>
    <label class="field"><span>${esc(t('opacity'))} <b id="opacity-readout">${opacity}%</b></span>
      <input id="panel-opacity" type="range" min="40" max="100" step="1" value="${opacity}" />
    </label>
    <div class="field"><span>${esc(t('theme'))}</span>
      <div class="themes" role="listbox" aria-label="${esc(t('theme'))}">
        ${THEMES.map((theme) => `<button type="button" class="theme-swatch${themeId(settings.theme) === theme.id ? ' is-selected' : ''}" data-theme="${theme.id}" style="--swatch:${theme.swatch}" role="option" aria-selected="${themeId(settings.theme) === theme.id ? 'true' : 'false'}" aria-label="${esc(t(theme.key))}">${esc(t(theme.key))}</button>`).join('')}
      </div>
    </div>
    <label class="field"><span>${esc(t('scriptLabel'))}</span>
      <select id="target">
        <option value="zh-CN" ${settings.target !== 'zh-TW' ? 'selected' : ''}>${esc(t('simplified'))}</option>
        <option value="zh-TW" ${settings.target === 'zh-TW' ? 'selected' : ''}>${esc(t('traditional'))}</option>
      </select>
    </label>
    <label class="check"><input id="login-item" type="checkbox" ${settings.openAtLogin ? 'checked' : ''} /><span>${esc(t('launchAtLogin'))}</span></label>
    <pre class="help">${esc(t('help'))}</pre>
    <div class="actions">
      <button type="button" class="ghost" id="quit-app">${esc(t('quit'))}</button>
      <button type="button" class="ghost" id="restart-app">${esc(t('restart'))}</button>
      <button type="button" class="ghost" id="close-settings">${esc(t('done'))}</button>
    </div>
    <p id="settings-status" class="status ${message ? 'bad' : ''}">${esc(message || '')}</p>
  `);
  startAuthClock();
  const opacityInput = document.getElementById('panel-opacity');
  opacityInput.addEventListener('input', () => {
    const opacity = Number(opacityInput.value) / 100;
    applyPanelOpacity(opacity);
    document.getElementById('opacity-readout').textContent = `${opacityInput.value}%`;
  });
  opacityInput.addEventListener('change', async () => {
    const saved = await window.fuci.saveSettings(readSettingsForm());
    if (saved.ok) state.bootstrap.settings = saved.settings;
  });
  document.querySelectorAll('.theme-swatch').forEach((button) => {
    button.addEventListener('click', async () => {
      applyTheme(button.getAttribute('data-theme'));
      document.querySelectorAll('.theme-swatch').forEach((node) => {
        const selected = node === button;
        node.classList.toggle('is-selected', selected);
        node.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      const saved = await window.fuci.saveSettings(readSettingsForm());
      if (saved.ok) state.bootstrap.settings = saved.settings;
    });
  });
  document.querySelectorAll('.locale-choice').forEach((button) => {
    button.addEventListener('click', async () => {
      const next = button.getAttribute('data-locale');
      if (!next || next === locale()) return;
      state.locale = next;
      paintChrome();
      const saved = await window.fuci.saveSettings(readSettingsForm());
      if (saved.ok) {
        state.bootstrap.settings = saved.settings;
        state.locale = saved.settings.uiLocale || next;
      }
      openSettings();
    });
  });

  let leaving = false;
  async function saveAndLeave(action) {
    if (leaving) return;
    leaving = true;
    const status = document.getElementById('settings-status');
    const saved = await window.fuci.saveSettings(readSettingsForm());
    if (!saved.ok) {
      leaving = false;
      status.className = 'status bad';
      status.textContent = saved.message || t('saveFailed');
      reportHeight();
      return;
    }
    state.bootstrap.settings = saved.settings;
    if (saved.auth) state.auth = saved.auth;
    action();
  }
  paintUpdate();
  document.getElementById('apply-update').onclick = async () => {
    const button = document.getElementById('apply-update');
    const status = document.getElementById('settings-status');
    button.disabled = true;
    button.textContent = t('updating');
    status.className = 'status';
    status.textContent = t('updatingDetail');
    reportHeight();
    const saved = await window.fuci.saveSettings(readSettingsForm());
    if (!saved.ok) {
      button.disabled = false;
      button.textContent = t('update');
      status.className = 'status bad';
      status.textContent = saved.message || t('saveFailed');
      reportHeight();
      return;
    }
    state.bootstrap.settings = saved.settings;
    const result = await window.fuci.applyUpdate();
    if (!result?.ok) {
      button.disabled = false;
      button.textContent = t('update');
      status.className = 'status bad';
      status.textContent = result?.message || t('updateFailed');
      reportHeight();
    }
  };
  document.getElementById('quit-app').onclick = () => saveAndLeave(() => window.fuci.quit());
  document.getElementById('restart-app').onclick = () => saveAndLeave(() => window.fuci.restart());
  document.getElementById('close-settings').onclick = async () => {
    const status = document.getElementById('settings-status');
    const saved = await window.fuci.saveSettings(readSettingsForm());
    if (!saved.ok) {
      status.className = 'status bad';
      status.textContent = saved.message || t('saveFailed');
      reportHeight();
      return;
    }
    const previous = state.bootstrap.settings || {};
    const languageChanged = previous.target !== saved.settings.target;
    state.bootstrap.settings = saved.settings;
    if (saved.auth) state.auth = saved.auth;
    stopAuthClock();
    const query = input.value.trim();
    if (languageChanged && query) run(query);
    else if (state.result && (state.result.kind === 'word' || state.result.kind === 'sentence')) renderResult(state.result);
    else showIdle();
  };
  document.getElementById('connect-google').onclick = async () => {
    const button = document.getElementById('connect-google');
    const status = document.getElementById('settings-status');
    const form = readSettingsForm();
    button.disabled = true;
    status.className = 'status';
    status.textContent = t('connecting');
    const connected = await window.fuci.connectGoogle(form);
    button.disabled = false;
    if (connected.settings) state.bootstrap.settings = connected.settings;
    if (connected.auth) {
      state.auth = connected.auth;
      state.bootstrap.auth = connected.auth;
    }
    paintAuthClock();
    status.className = connected.ok ? 'status ok' : 'status bad';
    status.textContent = connected.ok ? t('connected') : (connected.message || t('errLogin'));
    reportHeight();
  };
}

const PAIRS = ['en-zh', 'en-ja', 'ja-zh', 'ja-en', 'zh-en', 'zh-ja'];
const PAIR_LABEL = {
  'en-zh': 'pairEnZh',
  'en-ja': 'pairEnJa',
  'ja-zh': 'pairJaZh',
  'ja-en': 'pairJaEn',
  'zh-en': 'pairZhEn',
  'zh-ja': 'pairZhJa',
};
const PAIR_LANG = { en: 'langEn', ja: 'langJa', zh: 'langZh' };

function currentPair() {
  const value = state.bootstrap?.settings?.pair;
  return PAIRS.includes(value) ? value : 'en-zh';
}

function paintPair() {
  const pair = currentPair();
  const label = t(PAIR_LABEL[pair]);
  const [from, to] = pair.split('-');
  langPin.textContent = label;
  langPin.classList.add('is-pinned');
  langPin.title = t('pairTitle', { from: t(PAIR_LANG[from]), to: t(PAIR_LANG[to]) });
  langPin.setAttribute('aria-label', t('pairAria', { label }));
}

function opacityPercent(value) {
  const number = Number(value);
  const opacity = Number.isFinite(number) ? Math.min(1, Math.max(0.4, number)) : 0.88;
  return Math.round(opacity * 100);
}

function applyPanelOpacity(value) {
  document.documentElement.style.setProperty('--panel', String(opacityPercent(value) / 100));
}

function themeId(value) {
  return THEMES.some((theme) => theme.id === value) ? value : 'sky';
}

function applyTheme(value) {
  const id = themeId(value);
  state.theme = id;
  document.documentElement.dataset.theme = id;
  if (state.bootstrap?.settings) state.bootstrap.settings.theme = id;
}

function readSettingsForm() {
  return {
    projectId: fieldValue('project-id').trim(),
    target: fieldValue('target'),
    model: fieldValue('model').trim(),
    location: fieldValue('location').trim(),
    openAtLogin: document.getElementById('login-item').checked,
    panelOpacity: Number(fieldValue('panel-opacity')) / 100,
    theme: themeId(state.theme),
    uiLocale: locale(),
  };
}

langPin.addEventListener('click', async () => {
  const next = PAIRS[(PAIRS.indexOf(currentPair()) + 1) % PAIRS.length];
  const saved = await window.fuci.setPair(next);
  if (!state.bootstrap) state.bootstrap = { settings: {} };
  if (saved?.settings) state.bootstrap.settings = saved.settings;
  else state.bootstrap.settings = { ...state.bootstrap.settings, pair: next };
  paintPair();
  const text = input.value.trim();
  if (text && state.mode !== 'settings' && !composing) {
    clearTimeout(timer);
    run(text);
  }
});

search.addEventListener('submit', (event) => {
  event.preventDefault();
  if (composing) return;
  clearTimeout(timer);
  const text = input.value.trim();
  if (text) run(text);
});

input.addEventListener('compositionstart', () => {
  composing = true;
  clearTimeout(timer);
});
input.addEventListener('compositionend', () => {
  composing = false;
  schedule();
});
input.addEventListener('input', () => {
  if (!composing) schedule();
});
input.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  if (!history.length) return;
  event.preventDefault();
  if (event.key === 'ArrowUp') historyCursor = Math.max(0, historyCursor - 1);
  else historyCursor = Math.min(history.length, historyCursor + 1);
  input.value = historyCursor >= history.length ? '' : history[historyCursor];
  syncChrome();
});

function trackDrag(target, enabled) {
  let drag = null;
  const end = (event) => {
    if (!drag) return;
    if (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    const pointerId = drag.pointerId;
    drag = null;
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    window.fuci.setDragging(false);
  };
  target.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.buttons & 1) === 0 || !enabled()) return;
    drag = { x: event.screenX, y: event.screenY, moved: false, pointerId: event.pointerId };
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if ((event.buttons & 1) === 0) {
      end(event);
      return;
    }
    const dx = event.screenX - drag.x;
    const dy = event.screenY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      window.fuci.setDragging(true);
    }
    drag.x = event.screenX;
    drag.y = event.screenY;
    window.fuci.moveBy(dx, dy);
  });
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  return end;
}

const cancelSealDrag = trackDrag(seal, () => !orbMode);
trackDrag(orb, () => orbMode);
seal.addEventListener('dblclick', (event) => {
  event.preventDefault();
  collapseToOrb();
});
orb.addEventListener('dblclick', (event) => {
  event.preventDefault();
  if (!orbMode) return;
  expandFromOrb();
});

clearBtn.addEventListener('click', () => {
  input.value = '';
  req += 1;
  window.fuci.cancelLookup();
  showIdle();
  input.focus();
});

gear.addEventListener('click', () => {
  if (state.mode === 'settings') {
    if (state.result && (state.result.kind === 'word' || state.result.kind === 'sentence')) renderResult(state.result);
    else showIdle();
    return;
  }
  openSettings();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (state.mode === 'settings') {
    if (state.result && (state.result.kind === 'word' || state.result.kind === 'sentence')) renderResult(state.result);
    else showIdle();
    return;
  }
  if (!board.hidden) {
    clearTimeout(timer);
    req += 1;
    window.fuci.cancelLookup();
    showIdle();
    return;
  }
  collapseToOrb();
});

window.fuci.onProgress(({ id, result }) => {
  if (id !== req || !result) return;
  if (result.kind === 'word') renderResult(result);
});

window.fuci.onFocusSearch(() => {
  expandFromOrb();
  if (state.mode === 'settings') return;
  input.focus();
  input.select();
});

window.fuci.onOpenSettings(() => openSettings());

document.fonts?.ready?.then(() => reportHeight());

function startOrbFlow() {
  const ctx = orbFlow.getContext('2d');
  const css = 104;
  const cx = css / 2;
  const cy = css / 2;
  let t = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    orbFlow.width = Math.round(css * dpr);
    orbFlow.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const blob = (x, y, radius, inner, outer, alpha) => {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, inner);
    glow.addColorStop(0.55, outer);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  const draw = () => {
    t += shell.classList.contains('is-loading') ? 0.05 : 0.02;
    ctx.clearRect(0, 0, css, css);
    ctx.save();
    const palette = ORB_COLORS[state.theme] || ORB_COLORS.sky;
    const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 52);
    halo.addColorStop(0, palette.halo[0]);
    halo.addColorStop(0.55, palette.halo[1]);
    halo.addColorStop(0.82, palette.halo[2]);
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, css, css);
    const body = ctx.createRadialGradient(cx - 4, cy - 6, 2, cx, cy, 40);
    body.addColorStop(0, palette.body[0]);
    body.addColorStop(0.46, palette.body[1]);
    body.addColorStop(0.78, palette.body[2]);
    body.addColorStop(1, palette.body[3]);
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, css, css);

    ctx.filter = 'blur(11px)';
    const blues = [
      { speed: 1.15, phase: 0.2, rx: 18, ry: 14, radius: 24, color: palette.blobs[0] },
      { speed: -0.86, phase: 2.1, rx: 16, ry: 20, radius: 22, color: palette.blobs[1] },
      { speed: 0.62, phase: 4.0, rx: 12, ry: 16, radius: 20, color: palette.blobs[2] },
    ];
    blues.forEach((item) => {
      const angle = t * item.speed + item.phase;
      blob(
        cx + Math.cos(angle) * item.rx,
        cy + Math.sin(angle * 1.35) * item.ry,
        item.radius + Math.sin(angle * 2) * 4,
        item.color,
        item.color,
        0.72,
      );
    });

    ctx.globalCompositeOperation = 'screen';
    const lights = [
      { speed: 1.7, phase: 0.4, rx: 22, ry: 15, radius: 15 },
      { speed: -1.25, phase: 2.4, rx: 17, ry: 23, radius: 13 },
      { speed: 2.15, phase: 1.1, rx: 24, ry: 9, radius: 11 },
      { speed: -0.74, phase: 3.6, rx: 10, ry: 18, radius: 16 },
    ];
    lights.forEach((item) => {
      const angle = t * item.speed + item.phase;
      blob(
        cx + Math.cos(angle) * item.rx,
        cy + Math.sin(angle * 1.2) * item.ry,
        item.radius + Math.sin(angle * 3) * 3,
        '#ffffff',
        palette.light,
        0.82,
      );
    });

    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    const sweep = t * 0.85;
    const hx = cx + Math.cos(sweep) * 13 - 6;
    const hy = cy + Math.sin(sweep) * 11 - 8;
    const shine = ctx.createRadialGradient(hx, hy, 0, hx + 2, hy + 2, 16);
    shine.addColorStop(0, 'rgba(255,255,255,0.72)');
    shine.addColorStop(0.38, 'rgba(255,255,255,0.16)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(hx, hy, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(cx, cy, 0, cx, cy, 52);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(0.42, 'rgba(255,255,255,0.94)');
    mask.addColorStop(0.64, 'rgba(255,255,255,0.62)');
    mask.addColorStop(0.8, 'rgba(255,255,255,0.22)');
    mask.addColorStop(0.92, 'rgba(255,255,255,0.05)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, css, css);
    ctx.restore();
    requestAnimationFrame(draw);
  };
  draw();
}

startOrbFlow();

window.fuci.onUpdateStatus((status) => {
  state.update = status || { available: false };
  paintUpdate();
  reportHeight();
});

window.fuci.updateStatus().then((status) => {
  state.update = status || { available: false };
  paintUpdate();
}).catch(() => {});

function sampleWord() {
  return {
    kind: 'word',
    query: 'ephemeral',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    translation: '短暂的；转瞬即逝的',
    reading: '/ɪˈfem.ər.əl/',
    dictionary: {
      headword: 'ephemeral',
      phonetic: '/ɪˈfem.ər.əl/',
      lemma: '',
      entries: [{
        pos: 'adj.',
        posZh: '形容词',
        senses: [{
          glossZh: '只持续很短时间的',
          glossMono: 'lasting for a very short time',
          glossReading: '/ˈlɑːstɪŋ fɔːr ə ˈveri ʃɔːt taɪm/',
          examples: [{
            text: 'Social media fame can be ephemeral.',
            translation: '社交媒体上的名气可能转瞬即逝。',
            reading: '/ˈsəʊʃl ˈmiːdiə feɪm kən bi ɪˈfem.ər.əl/',
          }],
        }],
      }],
      inflections: [
        { label: '原级', form: 'ephemeral' },
        { label: '比较级', form: 'more ephemeral' },
        { label: '最高级', form: 'most ephemeral' },
      ],
    },
  };
}

function sampleSentence() {
  return {
    kind: 'sentence',
    query: 'Could you speak a little more slowly?',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    translation: '能说得再慢一点吗？',
    reading: '/kʊd ju spiːk ə ˈlɪtl mɔː ˈsləʊli/',
    translationReading: 'néng shuō de zài màn yì diǎn ma',
    tokens: [
      { text: 'Could', reading: '/kʊd/', translation: '能够' },
      { text: 'you', reading: '/ju/', translation: '你' },
      { text: 'speak', reading: '/spiːk/', translation: '说' },
      { text: 'slowly', reading: '/ˈsləʊli/', translation: '慢地' },
    ],
  };
}

function sampleJaZhWord() {
  return {
    kind: 'word',
    query: '優しい',
    sourceLanguage: 'ja',
    targetLanguage: 'zh',
    translation: '温柔的；亲切的',
    dictionary: {
      headword: '優しい',
      phonetic: '優(やさ)しい',
      lemma: '',
      entries: [{
        pos: '形',
        posZh: '形容词',
        senses: [{
          glossZh: '待人温柔、体贴',
          glossMono: '相手を思いやる気持ちがある。',
          glossReading: '相手(あいて)を思(おも)いやる気持(きも)ちがある。',
          examples: [{
            text: '彼女はとても優しい。',
            translation: '她非常温柔。',
            reading: '彼女(かのじょ)はとても優(やさ)しい。',
          }],
        }],
      }],
      inflections: [
        { label: '基本形', form: '優しい', reading: '優(やさ)しい' },
        { label: '过去', form: '優しかった', reading: '優(やさ)しかった' },
        { label: '否定', form: '優しくない', reading: '優(やさ)しくない' },
      ],
    },
  };
}

function sampleZhEnWord() {
  return {
    kind: 'word',
    query: '学习',
    sourceLanguage: 'zh',
    targetLanguage: 'en',
    translation: 'to study',
    translationReading: '/tə ˈstʌdi/',
    dictionary: {
      headword: '学习',
      phonetic: 'xué xí',
      lemma: '',
      entries: [{
        pos: '动',
        posZh: 'verb',
        senses: [{
          glossZh: 'to study; to learn',
          glossTargetReading: '/tə ˈstʌdi/',
          glossMono: '通过阅读或练习掌握知识。',
          examples: [{
            text: '她每天晚上学习日语。',
            translation: 'She studies Japanese every evening.',
            translationReading: '/ʃi ˈstʌdiz ˌdʒæpəˈniːz ˈevri ˈiːvnɪŋ/',
          }],
        }],
      }],
      inflections: [
        { label: 'base', form: 'study', reading: '/ˈstʌdi/' },
        { label: '-s', form: 'studies', reading: '/ˈstʌdiz/' },
        { label: '-ing', form: 'studying', reading: '/ˈstʌdiɪŋ/' },
        { label: '-ed', form: 'studied', reading: '/ˈstʌdid/' },
      ],
    },
  };
}

function sampleJaEnWord() {
  return {
    kind: 'word',
    query: '優しい',
    sourceLanguage: 'ja',
    targetLanguage: 'en',
    translation: 'kind; gentle',
    translationReading: '/kaɪnd/',
    dictionary: {
      headword: '優しい',
      phonetic: '優(やさ)しい',
      lemma: '',
      entries: [{
        pos: '形',
        posZh: 'i-adjective',
        senses: [{
          glossZh: 'kind and gentle toward others',
          glossTargetReading: '/kaɪnd ənd ˈdʒentl/',
          glossMono: '相手を思いやる気持ちがある。',
          glossReading: '相手(あいて)を思(おも)いやる気持(きも)ちがある。',
          examples: [{
            text: '彼女はとても優しい。',
            reading: '彼女(かのじょ)はとても優(やさ)しい。',
            translation: 'She is very kind.',
            translationReading: '/ʃi ɪz ˈveri kaɪnd/',
          }],
        }],
      }],
      inflections: [
        { label: 'plain', form: '優しい', reading: '優(やさ)しい' },
        { label: 'past', form: '優しかった', reading: '優(やさ)しかった' },
        { label: 'negative', form: '優しくない', reading: '優(やさ)しくない' },
      ],
    },
  };
}

function sampleZhJaWord() {
  return {
    kind: 'word',
    query: '学习',
    sourceLanguage: 'zh',
    targetLanguage: 'ja',
    translation: '勉強する',
    translationReading: '勉強(べんきょう)する',
    dictionary: {
      headword: '学习',
      phonetic: 'xué xí',
      lemma: '',
      entries: [{
        pos: '动',
        posZh: '動詞',
        senses: [{
          glossZh: '学習する、勉強する',
          glossTargetReading: '学習(がくしゅう)する、勉強(べんきょう)する',
          glossMono: '通过阅读或练习掌握知识。',
          examples: [{
            text: '她每天晚上学习日语。',
            translation: '彼女は毎晩日本語を勉強する。',
            translationReading: '彼女(かのじょ)は毎晩(まいばん)日本語(にほんご)を勉強(べんきょう)する。',
          }],
        }],
      }],
      inflections: [
        { label: '辞書形', form: '勉強する', reading: '勉強(べんきょう)する' },
        { label: 'ます形', form: '勉強します', reading: '勉強(べんきょう)します' },
        { label: 'て形', form: '勉強して', reading: '勉強(べんきょう)して' },
      ],
    },
  };
}

function sampleEnJaWord() {
  return {
    kind: 'word',
    query: 'study',
    sourceLanguage: 'en',
    targetLanguage: 'ja',
    translation: '勉強する',
    translationReading: '勉強(べんきょう)する',
    dictionary: {
      headword: 'study',
      phonetic: '/ˈstʌdi/',
      lemma: '',
      entries: [{
        pos: 'v.',
        posZh: '動詞',
        senses: [{
          glossZh: '学習する、勉強する',
          glossTargetReading: '学習(がくしゅう)する、勉強(べんきょう)する',
          glossMono: 'to learn by reading or practice',
          glossReading: '/tə lɜːn baɪ ˈriːdɪŋ ɔː ˈpræktɪs/',
          examples: [{
            text: 'She studies Japanese every evening.',
            reading: '/ʃi ˈstʌdiz ˌdʒæpəˈniːz ˈevri ˈiːvnɪŋ/',
            translation: '彼女は毎晩日本語を勉強する。',
            translationReading: '彼女(かのじょ)は毎晩(まいばん)日本語(にほんご)を勉強(べんきょう)する。',
          }],
        }],
      }],
      inflections: [
        { label: '原形', form: 'study', reading: '/ˈstʌdi/' },
        { label: '三単', form: 'studies', reading: '/ˈstʌdiz/' },
        { label: '過去', form: 'studied', reading: '/ˈstʌdid/' },
      ],
    },
  };
}

function sampleZhEnSentence() {
  return {
    kind: 'sentence',
    query: '今天的会议改到三点。',
    sourceLanguage: 'zh',
    targetLanguage: 'en',
    translation: "Today's meeting has been moved to three.",
    reading: 'jīn tiān de huì yì gǎi dào sān diǎn',
    translationReading: '/təˈdeɪz ˈmiːtɪŋ həz bɪn muːvd tə θriː/',
    tokens: [
      { text: '今天', reading: 'jīn tiān', translation: 'today' },
      { text: '会议', reading: 'huì yì', translation: 'meeting' },
      { text: '改到', reading: 'gǎi dào', translation: 'moved to' },
      { text: '三点', reading: 'sān diǎn', translation: "three o'clock" },
    ],
  };
}

function sampleEnJaSentence() {
  return {
    kind: 'sentence',
    query: 'The coffee here is a little strong.',
    sourceLanguage: 'en',
    targetLanguage: 'ja',
    translation: 'ここのコーヒーは少し濃いです。',
    reading: '/ðə ˈkɒfi hɪər ɪz ə ˈlɪtl strɒŋ/',
    translationReading: 'ここのコーヒーは少(すこ)し濃(こ)いです。',
    tokens: [
      { text: 'coffee', reading: '/ˈkɒfi/', translation: 'コーヒー' },
      { text: 'here', reading: '/hɪər/', translation: 'ここ' },
      { text: 'a little', reading: '/ə ˈlɪtl/', translation: '少し' },
      { text: 'strong', reading: '/strɒŋ/', translation: '濃い' },
    ],
  };
}

const LOOKUP_SHOTS = {
  word: { pair: 'en-zh', query: 'ephemeral', sample: sampleWord },
  sentence: { pair: 'en-zh', query: 'Could you speak a little more slowly?', sample: sampleSentence },
  'word-ja': { pair: 'ja-zh', query: '優しい', sample: sampleJaZhWord },
  'en-ui-word': { pair: 'en-zh', query: 'ephemeral', sample: sampleWord },
  'en-zh-word': { pair: 'zh-en', query: '学习', sample: sampleZhEnWord },
  'en-ja-word': { pair: 'ja-en', query: '優しい', sample: sampleJaEnWord },
  'en-sentence': { pair: 'zh-en', query: '今天的会议改到三点。', sample: sampleZhEnSentence },
  'ja-zh-word': { pair: 'zh-ja', query: '学习', sample: sampleZhJaWord },
  'ja-en-word': { pair: 'en-ja', query: 'study', sample: sampleEnJaWord },
  'ja-sentence': { pair: 'en-ja', query: 'The coffee here is a little strong.', sample: sampleEnJaSentence },
};

function resetShot() {
  if (orbMode) {
    orbMode = false;
    shell.classList.remove('is-orb');
  }
  input.value = '';
  state.locale = 'zh';
  if (state.bootstrap?.settings) {
    state.bootstrap.settings.uiLocale = 'zh';
    state.bootstrap.settings.theme = 'sky';
    state.bootstrap.settings.panelOpacity = 0.92;
    state.bootstrap.settings.pair = 'en-zh';
  }
  applyTheme('sky');
  applyPanelOpacity(0.92);
  paintChrome();
  hideBoard();
}

function shotLocale(shot) {
  if (shot === 'en' || shot.startsWith('en-')) return 'en';
  if (shot === 'ja' || shot.startsWith('ja-')) return 'ja';
  return 'zh';
}

function shotKind(shot) {
  if (shot === 'en' || shot === 'ja') return 'settings';
  if (shot.startsWith('en-') || shot.startsWith('ja-')) return shot.slice(3);
  return shot;
}

function applyShot() {
  const shot = (location.hash || '').replace(/^#/, '');
  if (!shot) return;
  const lang = shotLocale(shot);
  const kind = shotKind(shot);
  const lookup = LOOKUP_SHOTS[shot];
  const pair = lookup?.pair || (lang === 'en' ? 'zh-en' : lang === 'ja' ? 'zh-ja' : 'en-zh');
  state.locale = lang;
  if (state.bootstrap?.settings) {
    state.bootstrap.settings.uiLocale = lang;
    state.bootstrap.settings.pair = pair;
  }
  paintChrome();
  if (lookup) {
    input.value = lookup.query;
    syncChrome();
    renderResult(lookup.sample());
    return;
  }
  if (kind === 'look') {
    if (state.bootstrap?.settings) {
      state.bootstrap.settings.theme = 'night';
      state.bootstrap.settings.panelOpacity = 0.64;
    }
    applyTheme('night');
    applyPanelOpacity(0.64);
    openSettings();
    document.querySelector('.locales')?.closest('.field')?.remove();
    document.querySelector('.notice')?.remove();
    for (const id of ['project-id', 'location', 'model']) {
      document.getElementById(id)?.closest('.field')?.remove();
    }
    document.querySelector('.auth-row')?.remove();
    document.querySelector('.help')?.remove();
    document.querySelector('.check')?.remove();
    document.querySelector('.actions')?.remove();
    document.getElementById('settings-status')?.remove();
    return;
  }
  if (kind === 'settings') {
    openSettings();
    return;
  }
  if (kind === 'orb') collapseToOrb();
}

window.fuci.bootstrap().then((boot) => {
  state.bootstrap = boot;
  state.auth = boot.auth || state.auth;
  state.update = boot.update || state.update;
  paintUpdate();
  state.locale = boot.settings?.uiLocale === 'ja' || boot.settings?.uiLocale === 'en' ? boot.settings.uiLocale : 'zh';
  applyTheme(boot.settings?.theme);
  applyPanelOpacity(boot.settings?.panelOpacity);
  paintChrome();
  hint.textContent = boot.shortcutLabel || '';
  hint.hidden = !boot.shortcutLabel;
  if (boot.maxBoardHeight) boardBody.style.maxHeight = `${boot.maxBoardHeight}px`;
  if (!boot.auth?.signedIn) {
    openSettings(boot.auth?.expired ? t('setupExpired') : t('setupFresh'));
  } else reportHeight();
  applyShot();
});
