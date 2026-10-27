'use strict';

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { ensureRuntime } = require('./gcloud-setup');
const { httpFetch } = require('./http');
const { tr } = require('../renderer/i18n');

const OAUTH_CLIENT_ID = '32555940559.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = 'ZmssLNjJy2998hD4CTg2ejr2';
const OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/accounts.reauth',
].join(' ');

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
    const refreshToken = typeof raw.refreshToken === 'string' ? raw.refreshToken : '';
    if (Date.now() >= Number(raw.expiresAt) && !refreshToken) {
      expired = true;
      fs.rmSync(sessionFile(), { force: true });
      return;
    }
    session = {
      accessToken: raw.accessToken,
      refreshToken,
      expiresAt: Number(raw.expiresAt),
      projectId: String(raw.projectId || ''),
      source: 'gcloud',
    };
    if (Date.now() >= session.expiresAt) expired = true;
  } catch {
    session = null;
  }
}

function writeSession() {
  if (!userData || !session) return;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(sessionFile(), JSON.stringify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || '',
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
  if (session && Date.now() >= session.expiresAt) {
    if (!session.refreshToken) dropSession(true);
    else expired = true;
  }
  if (!session || Date.now() >= session.expiresAt) return { signedIn: false, expired, expiresAt: 0 };
  return { signedIn: true, expired: false, expiresAt: session.expiresAt };
}

function accessToken(settings) {
  alignSession(settings);
  const status = sessionStatus();
  return status.signedIn ? session.accessToken : '';
}

function bundledGcloudPath() {
  return path.resolve(__dirname, '../../google-cloud-sdk/bin', process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud');
}

function bundledPythonFor(gcloudBin) {
  if (process.platform === 'win32') {
    const bundledWin = path.resolve(path.dirname(gcloudBin), '../platform/bundledpython/python.exe');
    if (fs.existsSync(bundledWin)) return bundledWin;
    return path.resolve(path.dirname(gcloudBin), '../platform/fuci-python/python.exe');
  }
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
  const bins = [];
  if (process.env.CLOUDSDK_PYTHON) bins.push(process.env.CLOUDSDK_PYTHON);
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    for (const ver of ['314', '313', '312', '311', '310']) {
      bins.push(path.join(localAppData, 'Programs', 'Python', `Python${ver}`, 'python.exe'));
      bins.push(path.join('C:\\', `Python${ver}`, 'python.exe'));
    }
    return bins;
  }
  const versions = ['3.14', '3.13', '3.12', '3.11', '3.10'];
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

function launchEnv(bin, { allowPrompt, python } = {}) {
  const env = {
    ...process.env,
    PATH: `${path.dirname(bin)}${path.delimiter}${process.env.PATH || ''}`,
    CLOUDSDK_ROOT_DIR: path.resolve(path.dirname(bin), '..'),
    CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: '1',
    CLOUDSDK_CORE_DISABLE_PROMPTS: allowPrompt ? '0' : '1',
  };
  const chosen = python || pythonForGcloud(bin);
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  if (!chosen) {
    if (env.CLOUDSDK_PYTHON && !pythonBinarySupported(env.CLOUDSDK_PYTHON)) delete env.CLOUDSDK_PYTHON;
    return env;
  }
  env.CLOUDSDK_PYTHON = chosen;
  env.PYTHONDONTWRITEBYTECODE = '1';
  return env;
}

function gcloudCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    return [
      bundledGcloudPath(),
      process.env.GCLOUD_BIN,
      path.join(localAppData, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
      path.join(pf86, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
      path.join(pf, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
      path.join(home, 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
    ].filter(Boolean);
  }
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

let customBrowserOpener = null;

function setBrowserOpener(fn) {
  customBrowserOpener = typeof fn === 'function' ? fn : null;
}

async function openExternalBrowser(url) {
  if (customBrowserOpener) {
    await customBrowserOpener(url);
    return true;
  }
  try {
    const electron = require('electron');
    if (electron?.shell?.openExternal) {
      await electron.shell.openExternal(url);
      return true;
    }
  } catch {
    /* non-Electron environment */
  }
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return true;
    }
    if (process.platform === 'win32') {
      const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function runGcloud(args, { timeoutMs, allowPrompt, onProgress }) {
  let runtime;
  try {
    runtime = await ensureRuntime({ onProgress, home: userData });
  } catch (error) {
    return { code: -1, stdout: '', stderr: error.message || tr('errPython') };
  }
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const rootDir = path.resolve(path.dirname(runtime.bin), '..');
    const gcloudPy = path.join(rootDir, 'lib', 'gcloud.py');
    const useDirectPy = isWin && runtime.python && fs.existsSync(gcloudPy);
    const cmd = useDirectPy ? runtime.python : (isWin && runtime.bin.includes(' ') ? `"${runtime.bin}"` : runtime.bin);
    const cmdArgs = useDirectPy ? [gcloudPy, ...args] : args;
    const child = spawn(cmd, cmdArgs, {
      env: launchEnv(runtime.bin, { allowPrompt, python: runtime.python }),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(isWin ? { windowsHide: true, ...(useDirectPy ? {} : { shell: true }) } : {}),
    });
    let stdout = '';
    let stderr = '';
    let openedUrl = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: -1, stdout: '', stderr: tr('errGcloudTimeout') });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (allowPrompt && !openedUrl) {
        const match = stderr.match(/https:\/\/accounts\.google\.com\/[^\s"']+/);
        if (match) {
          openedUrl = true;
          openExternalBrowser(match[0]);
        }
      }
    });
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

async function tryQuickGcloudToken() {
  const isWin = process.platform === 'win32';
  const runtimeCandidates = [];
  if (userData) {
    runtimeCandidates.push(path.join(userData, 'runtime', 'google-cloud-sdk', 'bin', isWin ? 'gcloud.cmd' : 'gcloud'));
  }
  runtimeCandidates.push(...gcloudCandidates());
  const bin = runtimeCandidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!bin) return null;
  const python = pythonForGcloud(bin);
  if (!python) return null;
  return new Promise((resolve) => {
    const rootDir = path.resolve(path.dirname(bin), '..');
    const gcloudPy = path.join(rootDir, 'lib', 'gcloud.py');
    const useDirectPy = isWin && fs.existsSync(gcloudPy);
    const args = ['auth', 'print-access-token', '--quiet'];
    const cmd = useDirectPy ? python : (isWin && bin.includes(' ') ? `"${bin}"` : bin);
    const cmdArgs = useDirectPy ? [gcloudPy, ...args] : args;
    const child = spawn(cmd, cmdArgs, {
      env: {
        ...launchEnv(bin, { allowPrompt: false, python }),
        CLOUDSDK_AUTH_DISABLE_REAUTH: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(isWin ? { windowsHide: true, ...(useDirectPy ? {} : { shell: true }) } : {}),
    });
    let stdout = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      resolve(null);
    }, 3000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const token = stdout.trim();
      if (code === 0 && token && /^ya29\./.test(token) && !/\s/.test(token)) {
        resolve(token);
      } else {
        resolve(null);
      }
    });
  });
}

async function printAccessToken(hooks) {
  const result = await runGcloud(['auth', 'print-access-token'], {
    timeoutMs: 30000,
    allowPrompt: false,
    onProgress: hooks?.onProgress,
  });
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

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) return null;
  try {
    const response = await httpFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) return null;
    const seconds = Number(data.expires_in) || 3600;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + Math.max(30, seconds - 15) * 1000,
    };
  } catch {
    return null;
  }
}

async function ensureAccessToken(settings) {
  alignSession(settings);
  if (session && Date.now() < session.expiresAt && session.accessToken) {
    return session.accessToken;
  }
  if (session && session.refreshToken) {
    const refreshed = await refreshAccessToken(session.refreshToken);
    if (refreshed) {
      session = {
        ...session,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      };
      expired = false;
      writeSession();
      return session.accessToken;
    }
    dropSession(true);
  }
  return accessToken(settings);
}

function listenLoopback(handler) {
  const ports = [8085, 8086, 8087, 0];
  return new Promise((resolve, reject) => {
    let index = 0;
    const tryNext = () => {
      if (index >= ports.length) {
        reject(new Error(tr('errLogin')));
        return;
      }
      const port = ports[index++];
      const server = http.createServer(handler);
      server.once('error', () => {
        try { server.close(); } catch { /* ignore */ }
        tryNext();
      });
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        resolve({ server, port: addr.port });
      });
    };
    tryNext();
  });
}

function callbackHtml(success, detail = '') {
  const title = success ? '浮词 · 登录成功' : '浮词 · 登录未完成';
  const heading = success ? 'Google 账号授权成功' : '授权未完成';
  const body = success
    ? '已完成连接，现在可以关闭此浏览器标签页并返回「浮词」开始查词。'
    : (detail || '请返回「浮词」设置页重试。');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI", sans-serif;background:#f7f6f2;color:#1f1f1d;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #e3e1da;border-radius:16px;padding:32px 36px;max-width:420px;text-align:center;box-shadow:0 12px 32px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 10px}p{font-size:14px;color:#5f5e5a;line-height:1.6;margin:0}</style></head>
<body><div class="card"><h1>${heading}</h1><p>${body}</p></div>
${success ? '<script>setTimeout(()=>{try{window.close()}catch(e){}},1200)</script>' : ''}
</body></html>`;
}

async function browserLoopbackLogin() {
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const { server, port } = await listenLoopback((req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://localhost:${port}`);
      if (reqUrl.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      const err = reqUrl.searchParams.get('error');
      const code = reqUrl.searchParams.get('code');
      const returnedState = reqUrl.searchParams.get('state');
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackHtml(false, err));
        rejectCode(new Error(tr('errLoginIncomplete')));
        return;
      }
      if (!code || returnedState !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackHtml(false));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(callbackHtml(true));
      resolveCode(code);
    } catch (error) {
      rejectCode(error);
    }
  });

  const redirectUri = `http://localhost:${port}/`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    response_type: 'code',
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'select_account',
  }).toString()}`;

  const timer = setTimeout(() => {
    rejectCode(new Error(tr('errGcloudTimeout')));
  }, 180000);

  try {
    await openExternalBrowser(authUrl);
    const code = await codePromise;
    const response = await httpFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || tr('errNoAccessToken'));
    }
    const seconds = Number(data.expires_in) || 3600;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresAt: Date.now() + Math.max(30, seconds - 15) * 1000,
    };
  } finally {
    clearTimeout(timer);
    try { server.close(); } catch { /* ignore */ }
  }
}

async function beginLogin(settings) {
  const projectId = String(settings.projectId || '').trim();
  if (!projectId) throw new Error(tr('errNeedProject'));
  if (pending) throw new Error(tr('errLoginPending'));
  pending = true;
  const alreadySignedIn = Boolean(session && Date.now() < session.expiresAt);
  try {
    if (!alreadySignedIn && session?.refreshToken) {
      const refreshed = await refreshAccessToken(session.refreshToken);
      if (refreshed) {
        session = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          projectId,
          source: 'gcloud',
        };
        expired = false;
        writeSession();
        return sessionStatus();
      }
    }

    if (!alreadySignedIn) {
      const quickToken = await tryQuickGcloudToken();
      if (quickToken) {
        session = {
          accessToken: quickToken,
          refreshToken: '',
          expiresAt: await expiryFromToken(quickToken),
          projectId,
          source: 'gcloud',
        };
        expired = false;
        writeSession();
        return sessionStatus();
      }
    }

    const oauthResult = await browserLoopbackLogin();
    session = {
      accessToken: oauthResult.accessToken,
      refreshToken: oauthResult.refreshToken,
      expiresAt: oauthResult.expiresAt,
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
  ensureAccessToken,
  alignSession,
  beginLogin,
  bundledGcloudPath,
  bundledPythonFor,
  configureSession,
  gcloudCandidates,
  launchEnv,
  pythonReleaseSupported,
  sessionStatus,
  setBrowserOpener,
};
