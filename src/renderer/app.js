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

const state = {
  mode: 'idle',
  bootstrap: null,
  result: null,
  auth: { signedIn: false, expired: false, expiresAt: 0 },
  authTimer: 0,
};

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
  const names = { en: '英语', ja: '日语', zh: '中文', mix: '混合' };
  const from = names[result.sourceLanguage] || result.sourceLanguageLabel || '';
  const to = names[result.targetLanguage];
  const label = !to || to === from ? from : `${from} → ${to}`;
  return result.pinned ? `指定 · ${label}` : label;
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
    return result.kind === 'sentence'
      ? 'Gemini 译文 · Cloud Translation API 还没在项目里启用'
      : 'Gemini 译文与词条 · Cloud Translation API 还没在项目里启用';
  }
  if (result?.kind === 'sentence') return 'Cloud Translation';
  return 'Cloud Translation 译文 · Gemini 词条';
}

function phoneticLine(reading) {
  return reading ? `<p class="phonetic">${reading}</p>` : '';
}

const SPEAKER_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 9.2v5.6h3.6L13 19.2V4.8L7.6 9.2H4z" fill="currentColor"/><path d="M16.2 9.2a4.2 4.2 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.4 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function speakButton(text, lang) {
  const value = spokenText(text);
  if (!value || (lang !== 'en' && lang !== 'ja')) return '';
  return `<button type="button" class="speak" data-speak="${esc(value)}" data-lang="${lang}" aria-label="播放">${SPEAKER_SVG}</button>`;
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
    showSpeakError(result?.message || '没能播放');
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
    showSpeakError('没能播放语音。');
  }
}

function dictHtml(result) {
  if (result.dictionaryPending) return '<p class="pending">正在整理音标、词性和例句…</p>';
  if (result.dictionaryError) return `<p class="pending">${esc(result.dictionaryError)}</p>`;
  const dictionary = result.dictionary;
  if (!dictionary || dictionary.entries.length === 0) {
    return dictionary?.note ? `<p class="pending">${esc(dictionary.note)}</p>` : '';
  }
  const foreign = result.sourceLanguage === 'zh' ? result.targetLanguage : result.sourceLanguage;
  const senseCount = dictionary.entries.reduce((sum, entry) => sum + entry.senses.length, 0);
  return dictionary.entries.map((entry) => {
    const senses = entry.senses.map((sense) => {
      const showGloss = senseCount > 1 || !sameText(sense.glossZh, result.translation);
      const glossParts = annotationParts(sense.glossZh, result.sourceLanguage === 'zh' ? sense.glossReading : '', foreign);
      const gloss = showGloss && sense.glossZh
        ? `<p class="gloss">${result.sourceLanguage === 'zh' ? glossParts.html : esc(sense.glossZh)}</p>${result.sourceLanguage === 'zh' ? phoneticLine(glossParts.phonetic) : ''}`
        : '';
      const monoParts = annotationParts(sense.glossMono, result.sourceLanguage === 'zh' ? '' : sense.glossReading, result.sourceLanguage);
      const mono = sense.glossMono
        ? `<p class="mono"><span class="tag">${esc(dictionary.monoLabel)}</span>${result.sourceLanguage === 'zh' ? esc(sense.glossMono) : monoParts.html}</p>${result.sourceLanguage === 'zh' ? '' : phoneticLine(monoParts.phonetic)}`
        : '';
      const examples = sense.examples.map((example) => {
        const src = result.sourceLanguage === 'zh'
          ? { html: esc(example.text), phonetic: '' }
          : annotationParts(example.text, example.reading, result.sourceLanguage);
        const tr = result.sourceLanguage === 'zh'
          ? annotationParts(example.translation, example.reading, result.targetLanguage)
          : { html: esc(example.translation), phonetic: '' };
        const srcSpeech = result.sourceLanguage === 'zh' ? '' : speakButton(example.text, result.sourceLanguage);
        const trSpeech = result.sourceLanguage === 'zh' ? speakButton(example.translation, result.targetLanguage) : '';
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
    ? `<p class="lemma">原形 ${esc(result.dictionary.lemma)}</p>`
    : '';
  const longHead = [...head].length > 18 ? ' long' : '';
  const longTranslation = [...String(result.translation || '')].length > 42 ? ' long' : '';
  const truncated = result.truncated ? '<p class="pending">句子较长，只处理了前 800 字。</p>' : '';
  const sourceNote = annotationParts(result.query, result.reading, result.sourceLanguage);
  const targetNote = annotationParts(result.translation, result.translationReading, result.targetLanguage);
  if (result.kind === 'sentence') {
    showBoard(`
      <div class="kicker"><strong>句子</strong><span>${esc(directionLabel(result))}</span></div>
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
        <button type="button" class="copy" data-copy="${esc(result.translation)}">复制</button>
      </div>
      ${tokensHtml(result.tokens)}
      ${truncated}
      ${result.translationNote ? `<p class="pending">${esc(result.translationNote)}</p>` : ''}
      <p class="foot">${footerText(result)}</p>
    `);
    return;
  }
  const formLang = result.sourceLanguage === 'zh' ? result.targetLanguage : result.sourceLanguage;
  showBoard(`
    <div class="kicker"><strong>单词</strong><span>${esc(directionLabel(result))}</span></div>
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
      <button type="button" class="copy" data-copy="${esc(result.translation)}">复制</button>
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
    ? '<div class="actions"><button type="button" class="primary" data-settings>打开设置</button></div>'
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
    const result = await window.fuci.lookup({ id, text, source: sourcePin() });
    if (id !== req) return;
    applyFinal(result);
  } catch (error) {
    if (id !== req) return;
    renderError({ message: '查询没有完成', detail: error.message || '' });
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
      copy.textContent = '已复制';
      setTimeout(() => {
        if (copy.isConnected) copy.textContent = '复制';
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
  if (ms <= 0) return '已失效';
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
  clock.textContent = auth.expired || auth.signedIn ? '已失效' : '未登录';
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
  state.mode = 'settings';
  state.auth = boot.auth || state.auth;
  syncChrome();
  showBoard(`
    <div class="kicker"><strong>设置</strong><span>${esc(boot.shortcutLabel || '')}</span></div>
    <p class="notice">填写项目、区域和模型。一键链接会执行 gcloud auth print-access-token；如果还没登录，会自动打开浏览器登录 Google 账号。令牌大约 1 小时有效，过期后需要再点一次。英语和日语译成所选中文；中文单词和句子译成英语或日语。</p>
    <label class="field"><span>项目 ID</span>
      <input id="project-id" spellcheck="false" autocapitalize="off" placeholder="my-gcp-project" value="${esc(settings.projectId || '')}" />
    </label>
    <label class="field"><span>Location</span>
      <input id="location" spellcheck="false" value="${esc(settings.location || 'global')}" />
    </label>
    <label class="field"><span>模型 ID</span>
      <input id="model" spellcheck="false" value="${esc(settings.model || 'gemini-3.8-flash')}" />
    </label>
    <div class="auth-row">
      <button type="button" class="primary" id="connect-google">一键链接</button>
      <span id="token-clock" class="token-clock">未登录</span>
    </div>
    <label class="field"><span>面板不透明度 <b id="opacity-readout">${opacityPercent(settings.panelOpacity)}%</b></span>
      <input id="panel-opacity" type="range" min="40" max="100" step="1" value="${opacityPercent(settings.panelOpacity)}" />
    </label>
    <label class="field"><span>外文译成</span>
      <select id="target">
        <option value="zh-CN" ${settings.target !== 'zh-TW' ? 'selected' : ''}>简体中文</option>
        <option value="zh-TW" ${settings.target === 'zh-TW' ? 'selected' : ''}>繁体中文</option>
      </select>
    </label>
    <label class="field"><span>中文译成</span>
      <select id="zh-target">
        <option value="en" ${settings.zhTarget !== 'ja' ? 'selected' : ''}>英语</option>
        <option value="ja" ${settings.zhTarget === 'ja' ? 'selected' : ''}>日语</option>
      </select>
    </label>
    <label class="check"><input id="login-item" type="checkbox" ${settings.openAtLogin ? 'checked' : ''} /><span>登录 macOS 时启动浮词。</span></label>
    <pre class="help">使用本机 gcloud 的登录状态。账号需要能调用该项目的 Cloud Translation 和 Vertex AI。</pre>
    <div class="actions">
      <button type="button" class="ghost" id="close-settings">完成</button>
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

  document.getElementById('close-settings').onclick = async () => {
    const status = document.getElementById('settings-status');
    const saved = await window.fuci.saveSettings(readSettingsForm());
    if (!saved.ok) {
      status.className = 'status bad';
      status.textContent = saved.message || '没能保存设置';
      reportHeight();
      return;
    }
    const previous = state.bootstrap.settings || {};
    const languageChanged = previous.target !== saved.settings.target || previous.zhTarget !== saved.settings.zhTarget;
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
    status.textContent = '正在通过 gcloud 获取访问令牌。如果还没登录，浏览器会自动打开。';
    const connected = await window.fuci.connectGoogle(form);
    button.disabled = false;
    if (connected.settings) state.bootstrap.settings = connected.settings;
    if (connected.auth) {
      state.auth = connected.auth;
      state.bootstrap.auth = connected.auth;
    }
    paintAuthClock();
    status.className = connected.ok ? 'status ok' : 'status bad';
    status.textContent = connected.ok ? '已登录。右侧是访问令牌剩余时间，失效后请再点一键链接。' : (connected.message || '登录没有完成');
    reportHeight();
  };
}

const SOURCE_PINS = ['', 'zh', 'ja', 'en'];
const SOURCE_PIN_LABEL = { '': '自动', zh: '中文', ja: '日语', en: '英语' };
const SOURCE_PIN_TITLE = {
  '': '自动识别。两边相同的汉字（如中国人）按中文查',
  zh: '指定按中文查',
  ja: '指定按日语查',
  en: '指定按英语查',
};

function sourcePin() {
  const value = state.bootstrap?.settings?.sourcePin;
  return value === 'zh' || value === 'ja' || value === 'en' ? value : '';
}

function paintSourcePin() {
  const pin = sourcePin();
  langPin.textContent = SOURCE_PIN_LABEL[pin];
  langPin.classList.toggle('is-pinned', Boolean(pin));
  langPin.title = SOURCE_PIN_TITLE[pin];
  langPin.setAttribute('aria-label', `查询语言：${SOURCE_PIN_LABEL[pin]}`);
}

function opacityPercent(value) {
  const number = Number(value);
  const opacity = Number.isFinite(number) ? Math.min(1, Math.max(0.4, number)) : 0.88;
  return Math.round(opacity * 100);
}

function applyPanelOpacity(value) {
  document.documentElement.style.setProperty('--panel', String(opacityPercent(value) / 100));
}

function readSettingsForm() {
  return {
    projectId: fieldValue('project-id').trim(),
    target: fieldValue('target'),
    model: fieldValue('model').trim(),
    location: fieldValue('location').trim(),
    zhTarget: fieldValue('zh-target'),
    openAtLogin: document.getElementById('login-item').checked,
    panelOpacity: Number(fieldValue('panel-opacity')) / 100,
  };
}

langPin.addEventListener('click', async () => {
  const order = SOURCE_PINS;
  const next = order[(order.indexOf(sourcePin()) + 1) % order.length];
  const saved = await window.fuci.setSourcePin(next);
  if (!state.bootstrap) state.bootstrap = { settings: {} };
  if (saved?.settings) state.bootstrap.settings = saved.settings;
  else state.bootstrap.settings = { ...state.bootstrap.settings, sourcePin: next };
  paintSourcePin();
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
  target.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !enabled()) return;
    drag = { x: event.screenX, y: event.screenY, moved: false, pointerId: event.pointerId };
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
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
  const end = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    window.fuci.setDragging(false);
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

trackDrag(seal, () => !orbMode);
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
    const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 52);
    halo.addColorStop(0, 'rgba(120, 186, 255, 0.55)');
    halo.addColorStop(0.55, 'rgba(80, 160, 255, 0.22)');
    halo.addColorStop(0.82, 'rgba(170, 214, 255, 0.08)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, css, css);
    const body = ctx.createRadialGradient(cx - 4, cy - 6, 2, cx, cy, 40);
    body.addColorStop(0, 'rgba(210, 232, 255, 0.96)');
    body.addColorStop(0.46, 'rgba(26, 116, 255, 0.9)');
    body.addColorStop(0.78, 'rgba(10, 90, 230, 0.45)');
    body.addColorStop(1, 'rgba(140, 196, 255, 0)');
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, css, css);

    ctx.filter = 'blur(11px)';
    const blues = [
      { speed: 1.15, phase: 0.2, rx: 18, ry: 14, radius: 24, color: '#5ac8ff' },
      { speed: -0.86, phase: 2.1, rx: 16, ry: 20, radius: 22, color: '#0a84ff' },
      { speed: 0.62, phase: 4.0, rx: 12, ry: 16, radius: 20, color: '#64d2ff' },
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
        '#d6ecff',
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

window.fuci.bootstrap().then((boot) => {
  state.bootstrap = boot;
  state.auth = boot.auth || state.auth;
  applyPanelOpacity(boot.settings?.panelOpacity);
  paintSourcePin();
  hint.textContent = boot.shortcutLabel || '';
  hint.hidden = !boot.shortcutLabel;
  if (boot.maxBoardHeight) boardBody.style.maxHeight = `${boot.maxBoardHeight}px`;
  if (!boot.auth?.signedIn) {
    openSettings(boot.auth?.expired
      ? '访问令牌已失效，请重新一键登录。'
      : '填写项目 ID、Location 和模型 ID，然后点一键链接。');
  } else reportHeight();
});
