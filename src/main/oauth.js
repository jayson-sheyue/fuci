'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { httpFetch } = require('./http');
const { tr } = require('../renderer/i18n');

let userData = '';
let session = null;
let expired = false;
let pending = false;

function sessionFile() {
  return path.join(userData, 'session.json');
}

function configureSession(dir) {
  userData = dir;
  session = null;
  expired = false;
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    if (!raw || raw.source !== 'gcloud' || typeof raw.accessToken !== 'string' || !raw.expiresAt) {
      fs.rmSync(sessionFile(), { force: true });
      return;
    }
    if (Date.now() >= Number(raw.expiresAt)) {
      expired = true;
      fs.rmSync(sessionFile(), { force: true });
      return;
    }
    session = {
      accessToken: raw.accessToken,
      expiresAt: Number(raw.expiresAt),
      projectId: String(raw.projectId || ''),
      source: 'gcloud',
    };
  } catch {
    session = null;
  }
}

function writeSession() {
  if (!userData || !session) return;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(sessionFile(), JSON.stringify({
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    projectId: session.projectId,
    source: 'gcloud',
  }), { mode: 0o600 });
}

function dropSession(markExpired) {
  session = null;
  if (markExpired) expired = true;
  if (userData) {
    try { fs.rmSync(sessionFile(), { force: true }); } catch { /* already gone */ }
  }
}

function alignSession(settings) {
  if (!session) return;
  if (session.projectId !== String(settings?.projectId || '')) dropSession(true);
}

function sessionStatus() {
  if (session && Date.now() >= session.expiresAt) dropSession(true);
  if (!session) return { signedIn: false, expired, expiresAt: 0 };
  return { signedIn: true, expired: false, expiresAt: session.expiresAt };
}

function accessToken(settings) {
  alignSession(settings);
  const status = sessionStatus();
  return status.signedIn ? session.accessToken : '';
}

function bundledGcloudPath() {
  return path.resolve(__dirname, '../../google-cloud-sdk/bin/gcloud');
}

function bundledPythonFor(gcloudBin) {
  return path.resolve(path.dirname(gcloudBin), '../platform/fuci-python/bin/python3');
}

function pythonReleaseSupported(major, minor) {
  return major === 3 && minor >= 10 && minor <= 15;
}

function pythonBinarySupported(bin) {
  try {
    execFileSync(bin, ['-c', 'import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] <= (3, 15) else 1)'], {
      timeout: 3000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function pythonCandidates() {
  const versions = ['3.14', '3.13', '3.12', '3.11', '3.10'];
  const bins = [];
  if (process.env.CLOUDSDK_PYTHON) bins.push(process.env.CLOUDSDK_PYTHON);
  for (const version of versions) {
    bins.push(`/opt/homebrew/bin/python${version}`);
    bins.push(`/usr/local/bin/python${version}`);
    bins.push(`/Library/Frameworks/Python.framework/Versions/${version}/bin/python3`);
  }
  bins.push('/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3');
  return bins;
}

let fallbackPython = '';
let fallbackPythonChecked = false;

function pythonForGcloud(gcloudBin) {
  const shipped = bundledPythonFor(gcloudBin);
  if (fs.existsSync(shipped)) return shipped;
  if (!fallbackPythonChecked) {
    fallbackPythonChecked = true;
    fallbackPython = pythonCandidates().find((bin) => fs.existsSync(bin) && pythonBinarySupported(bin)) || '';
  }
  return fallbackPython;
}

function launchEnv(bin, { allowPrompt }) {
  const env = {
    ...process.env,
    PATH: `${path.dirname(bin)}:${process.env.PATH || ''}`,
    CLOUDSDK_ROOT_DIR: path.resolve(path.dirname(bin), '..'),
    CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: '1',
    CLOUDSDK_CORE_DISABLE_PROMPTS: allowPrompt ? '0' : '1',
  };
  const python = pythonForGcloud(bin);
  if (!python) return env;
  env.CLOUDSDK_PYTHON = python;
  if (python === bundledPythonFor(bin)) {
    env.PYTHONDONTWRITEBYTECODE = '1';
    delete env.PYTHONPATH;
    delete env.PYTHONHOME;
  }
  return env;
}

function gcloudCandidates() {
  const home = os.homedir();
  return [
    bundledGcloudPath(),
    process.env.GCLOUD_BIN,
    path.join(home, 'google-cloud-sdk/bin/gcloud'),
    '/opt/homebrew/bin/gcloud',
    '/usr/local/bin/gcloud',
    '/opt/homebrew/share/google-cloud-sdk/bin/gcloud',
    '/usr/local/share/google-cloud-sdk/bin/gcloud',
  ].filter(Boolean);
}

function findGcloud() {
  for (const candidate of gcloudCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const found = execFileSync('/bin/zsh', ['-lc', 'command -v gcloud'], {
      encoding: 'utf8',
      timeout: 4000,
    }).trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    return '';
  }
  return '';
}

function runGcloud(bin, args, { timeoutMs, allowPrompt }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: launchEnv(bin, { allowPrompt }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: -1, stdout: '', stderr: tr('errGcloudTimeout') });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: error.message || tr('errGcloudStart') });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function safeError(stderr) {
  const text = String(stderr || '')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('WARNING:'));
  return (text[0] || tr('errNoGcloudToken')).slice(0, 180);
}

function needsLogin(stderr) {
  return /auth login|active account|Reauthentication|not logged|no credential|invalid_grant|Please log in|could not be refreshed|There was a problem refreshing/i.test(String(stderr || ''));
}

async function printAccessToken(bin) {
  const result = await runGcloud(bin, ['auth', 'print-access-token'], { timeoutMs: 30000, allowPrompt: false });
  const token = result.stdout.trim();
  if (result.code === 0 && token && !/\s/.test(token)) return { ok: true, value: token };
  return {
    ok: false,
    needsLogin: needsLogin(result.stderr) || result.code !== 0,
    message: safeError(result.stderr),
  };
}

async function expiryFromToken(token) {
  try {
    const response = await httpFetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token }).toString(),
    });
    const data = await response.json().catch(() => ({}));
    const seconds = Number(data.expires_in);
    if (response.ok && seconds > 0) return Date.now() + Math.max(30, seconds - 15) * 1000;
  } catch {
    /* tokeninfo is only used for the countdown */
  }
  return Date.now() + (3600 - 15) * 1000;
}

async function beginLogin(settings) {
  const projectId = String(settings.projectId || '').trim();
  if (!projectId) throw new Error(tr('errNeedProject'));
  if (pending) throw new Error(tr('errLoginPending'));
  const bin = findGcloud();
  if (!bin) throw new Error(tr('errNoGcloud'));
  pending = true;
  try {
    let printed = await printAccessToken(bin);
    if (!printed.ok) {
      const login = await runGcloud(bin, ['auth', 'login', '--brief'], { timeoutMs: 180000, allowPrompt: true });
      if (login.code !== 0) throw new Error(needsLogin(login.stderr) ? tr('errLoginIncomplete') : safeError(login.stderr));
      printed = await printAccessToken(bin);
    }
    if (!printed.ok) throw new Error(printed.message || tr('errNoAccessToken'));
    session = {
      accessToken: printed.value,
      expiresAt: await expiryFromToken(printed.value),
      projectId,
      source: 'gcloud',
    };
    expired = false;
    writeSession();
    return sessionStatus();
  } finally {
    pending = false;
  }
}

module.exports = {
  accessToken,
  alignSession,
  beginLogin,
  bundledGcloudPath,
  bundledPythonFor,
  configureSession,
  gcloudCandidates,
  launchEnv,
  pythonReleaseSupported,
  sessionStatus,
};
