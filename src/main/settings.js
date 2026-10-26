'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const THEME_IDS = ['sky', 'bamboo', 'cinnabar', 'wisteria', 'amber', 'haitang', 'night'];

function normalizeTheme(value) {
  return THEME_IDS.includes(value) ? value : 'sky';
}

const DEFAULTS = {
  projectId: '',
  geminiApiKey: '',
  keyFile: '',
  oauthClientId: '',
  oauthClientSecret: '',
  location: 'global',
  route: 'auto',
  model: 'gemini-3.8-flash',
  ttsModel: 'gemini-3.1-flash-tts-preview',
  target: 'zh-CN',
  zhTarget: 'en',
  sourcePin: '',
  panelOpacity: 0.88,
  theme: 'sky',
  uiLocale: 'zh',
  openAtLogin: false,
  bounds: null,
};

function settingsPath(userData) {
  return path.join(userData, 'settings.json');
}

function load(userData) {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(userData), 'utf8'));
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(userData, patch) {
  const next = { ...load(userData), ...patch };
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(settingsPath(userData), JSON.stringify(next, null, 2));
  return next;
}

function gcloudConfigDir() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    const winDir = path.join(process.env.APPDATA, 'gcloud');
    if (fs.existsSync(winDir)) return winDir;
  }
  return path.join(os.homedir(), '.config', 'gcloud');
}

function readGcloudProject() {
  try {
    const root = gcloudConfigDir();
    const activePath = path.join(root, 'active_config');
    let name = 'default';
    if (fs.existsSync(activePath)) {
      name = fs.readFileSync(activePath, 'utf8').trim() || 'default';
    }
    const conf = path.join(root, 'configurations', `config_${name}`);
    if (!fs.existsSync(conf)) return '';
    const match = fs.readFileSync(conf, 'utf8').match(/^project\s*=\s*(\S+)/m);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function adcExists() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  return fs.existsSync(path.join(gcloudConfigDir(), 'application_default_credentials.json'));
}

function effectiveProjectId(settings) {
  return String(settings.projectId || '').trim() || readGcloudProject();
}

function geminiApiKey(settings) {
  return String(settings?.geminiApiKey || '').trim();
}

function normalizeRoute(value) {
  return value === 'gcp' || value === 'gemini' ? value : 'auto';
}

function engineMode(settings) {
  const route = normalizeRoute(settings?.route);
  if (route === 'gcp') return 'gcp';
  if (route === 'gemini') return 'gemini';
  if (String(settings?.projectId || '').trim()) return 'gcp';
  if (geminiApiKey(settings)) return 'gemini';
  return 'gcp';
}

function usesApiKey(settings) {
  return engineMode(settings) === 'gemini';
}

function validateGeminiKey(value) {
  const apiKey = String(value ?? '').trim();
  if (!apiKey) return '';
  if (/\s/.test(apiKey) || apiKey.length > 200 || !/^[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw Object.assign(new Error('BAD_GEMINI_KEY'), { code: 'BAD_GEMINI_KEY' });
  }
  return apiKey;
}

module.exports = {
  DEFAULTS,
  THEME_IDS,
  normalizeTheme,
  load,
  save,
  readGcloudProject,
  adcExists,
  effectiveProjectId,
  geminiApiKey,
  normalizeRoute,
  engineMode,
  usesApiKey,
  validateGeminiKey,
};
