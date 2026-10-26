'use strict';

const { spawn, spawnSync, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tr } = require('../renderer/i18n');

const GCLOUD_ARCHIVE = 'https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-589.0.0-darwin-arm.tar.gz';
const PYTHON_ARCHIVE = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261021/cpython-3.12.15+20261021-aarch64-apple-darwin-install_only_stripped.tar.gz';
const PYTHON_BYTES = 25017408;
const SDK_BYTES = 54172111;
const PYTHON_WEIGHT = 24;
const SDK_WEIGHT = 54;

let readyRuntime = null;
let systemPython = '';
let systemPythonChecked = false;

function pythonBinarySupported(bin) {
  if (!bin || !fs.existsSync(bin)) return false;
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

function systemPythonPath() {
  if (systemPythonChecked) return systemPython;
  systemPythonChecked = true;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const winBins = [];
    for (const ver of ['314', '313', '312', '311', '310']) {
      winBins.push(path.join(localAppData, 'Programs', 'Python', `Python${ver}`, 'python.exe'));
      winBins.push(path.join('C:\\', `Python${ver}`, 'python.exe'));
    }
    try {
      const found = execFileSync('where.exe', ['python.exe'], { encoding: 'utf8', timeout: 3000, windowsHide: true })
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.includes('WindowsApps'));
      winBins.push(...found);
    } catch { /* ignore */ }
    systemPython = winBins.find((bin) => pythonBinarySupported(bin)) || '';
    return systemPython;
  }
  const versions = ['3.14', '3.13', '3.12', '3.11', '3.10'];
  const bins = [];
  for (const version of versions) {
    bins.push(`/opt/homebrew/bin/python${version}`);
    bins.push(`/usr/local/bin/python${version}`);
    bins.push(`/Library/Frameworks/Python.framework/Versions/${version}/bin/python3`);
  }
  bins.push('/opt/homebrew/bin/python3', '/usr/local/bin/python3');
  systemPython = bins.find((bin) => pythonBinarySupported(bin)) || '';
  return systemPython;
}

function pythonBeside(gcloudBin) {
  if (process.platform === 'win32') {
    const bundledWin = path.resolve(path.dirname(gcloudBin), '../platform/bundledpython/python.exe');
    if (fs.existsSync(bundledWin)) return bundledWin;
    return path.resolve(path.dirname(gcloudBin), '../platform/fuci-python/python.exe');
  }
  return path.resolve(path.dirname(gcloudBin), '../platform/fuci-python/bin/python3');
}

function runtimeRoot(home) {
  const defaultBase = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '浮词')
    : path.join(os.homedir(), 'Library', 'Application Support', '浮词');
  const base = home || defaultBase;
  return path.join(base, 'runtime');
}

function managedPaths(root) {
  if (process.platform === 'win32') {
    return {
      bin: path.join(root, 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
      python: path.join(root, 'python', 'python.exe'),
    };
  }
  return {
    bin: path.join(root, 'google-cloud-sdk', 'bin', 'gcloud'),
    python: path.join(root, 'python', 'bin', 'python3'),
  };
}

function whichGcloud() {
  if (process.platform === 'win32') {
    try {
      const found = execFileSync('where.exe', ['gcloud.cmd'], {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
      }).split(/\r?\n/)[0]?.trim();
      if (found && fs.existsSync(found)) return found;
    } catch {
      return '';
    }
    return '';
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

function localBins() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    return [
      path.resolve(__dirname, '../../google-cloud-sdk/bin/gcloud.cmd'),
      process.env.GCLOUD_BIN,
      path.join(localAppData, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
      path.join(pf86, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
      path.join(pf, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
      path.join(home, 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
      whichGcloud(),
    ].filter(Boolean).filter((bin, index, all) => fs.existsSync(bin) && all.indexOf(bin) === index);
  }
  return [
    path.resolve(__dirname, '../../google-cloud-sdk/bin/gcloud'),
    process.env.GCLOUD_BIN,
    path.join(home, 'google-cloud-sdk/bin/gcloud'),
    '/opt/homebrew/bin/gcloud',
    '/usr/local/bin/gcloud',
    '/opt/homebrew/share/google-cloud-sdk/bin/gcloud',
    '/usr/local/share/google-cloud-sdk/bin/gcloud',
    whichGcloud(),
  ].filter(Boolean).filter((bin, index, all) => fs.existsSync(bin) && all.indexOf(bin) === index);
}

function firstWorking(entries, probe) {
  for (const entry of entries) {
    if (!entry?.python) continue;
    if (probe(entry)) return entry;
  }
  return null;
}

function localEntries(bins) {
  const fallback = systemPythonPath();
  return bins.map((bin) => {
    const beside = pythonBeside(bin);
    const python = pythonBinarySupported(beside) ? beside : fallback;
    return { bin, python };
  });
}

function gcloudWorks(bin, python) {
  if (!bin || !python || !fs.existsSync(bin) || !pythonBinarySupported(python)) return false;
  const isWin = process.platform === 'win32';
  const result = spawnSync(bin, ['--version'], {
    encoding: 'utf8',
    timeout: 30000,
    ...(isWin ? { shell: true, windowsHide: true } : {}),
    env: {
      ...process.env,
      PATH: isWin ? `${path.dirname(bin)};${process.env.PATH || ''}` : `${path.dirname(bin)}:/usr/bin:/bin`,
      HOME: process.env.HOME || os.homedir(),
      CLOUDSDK_PYTHON: python,
      CLOUDSDK_ROOT_DIR: path.resolve(path.dirname(bin), '..'),
      CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: '1',
      CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  return result.status === 0 && /Google Cloud SDK/.test(result.stdout || '');
}

function execFileAsync(file, args, timeout, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, ...options }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || stdout || error.message || '').trim()));
      else resolve(String(stdout || ''));
    });
  });
}

function downloadFile(url, dest, onChunk) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/curl', ['-fL', '--retry', '3', '--retry-delay', '2', '-o', dest, url]);
    let stderr = '';
    const timer = setInterval(() => {
      try { onChunk(fs.statSync(dest).size, 0); } catch { /* the file is not open yet */ }
    }, 300);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearInterval(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearInterval(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || tr('errPython')));
    });
  });
}

async function placeTree(extracted, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(extracted, dest);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.cpSync(extracted, dest, { recursive: true });
  }
  try {
    execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest], { stdio: 'ignore' });
  } catch {
    /* curl did not mark the archive */
  }
}

async function downloadTree(url, root, folderName, expectedBytes, onChunk) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-runtime-'));
  const archive = path.join(stage, 'archive.tar.gz');
  try {
    await downloadFile(url, archive, (received) => onChunk(received, expectedBytes));
    await execFileAsync('/usr/bin/tar', ['-xzf', archive, '-C', stage], 120000);
    const extracted = path.join(stage, folderName);
    if (!fs.existsSync(extracted)) throw new Error(tr('errPython'));
    await placeTree(extracted, path.join(root, folderName));
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

async function runInstaller(root, pythonBin) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-gcloud-config-'));
  try {
    await execFileAsync('/bin/bash', [
      path.join(root, 'google-cloud-sdk', 'install.sh'),
      '--quiet',
      '--usage-reporting', 'false',
      '--path-update', 'false',
      '--command-completion', 'false',
    ], 180000, {
      cwd: root,
      env: {
        ...process.env,
        CLOUDSDK_PYTHON: pythonBin,
        CLOUDSDK_CONFIG: config,
        CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
      },
    });
  } finally {
    fs.rmSync(config, { recursive: true, force: true });
  }
}

async function installManaged(root, onProgress) {
  if (process.platform === 'win32') {
    throw new Error(tr('errNoGcloud'));
  }
  fs.mkdirSync(root, { recursive: true });
  const managed = managedPaths(root);
  let completed = 0;
  const total = PYTHON_WEIGHT + SDK_WEIGHT;
  const report = (portion) => {
    const percent = Math.max(1, Math.min(99, Math.round((completed + portion) / total * 100)));
    onProgress?.({ percent });
  };
  if (!pythonBinarySupported(managed.python)) {
    await downloadTree(PYTHON_ARCHIVE, root, 'python', PYTHON_BYTES, (received, fileTotal) => {
      report((fileTotal ? received / fileTotal : 0) * PYTHON_WEIGHT);
    });
  }
  completed += PYTHON_WEIGHT;
  report(0);
  if (!fs.existsSync(managed.bin)) {
    await downloadTree(GCLOUD_ARCHIVE, root, 'google-cloud-sdk', SDK_BYTES, (received, fileTotal) => {
      report((fileTotal ? received / fileTotal : 0) * SDK_WEIGHT);
    });
  }
  onProgress?.({ percent: 100 });
  if (!gcloudWorks(managed.bin, managed.python)) await runInstaller(root, managed.python);
  if (!gcloudWorks(managed.bin, managed.python)) throw new Error(tr('errPython'));
  return managed;
}

async function ensureRuntime({ onProgress, home, candidates } = {}) {
  const root = runtimeRoot(home);
  if (readyRuntime && readyRuntime.root === root && fs.existsSync(readyRuntime.bin) && pythonBinarySupported(readyRuntime.python)) {
    return readyRuntime;
  }
  const bins = candidates || localBins();
  const managed = managedPaths(root);
  const entries = localEntries(bins);
  if (fs.existsSync(managed.bin)) entries.push(managed);
  const found = firstWorking(entries, (entry) => gcloudWorks(entry.bin, entry.python));
  const chosen = found || await installManaged(root, onProgress);
  readyRuntime = { ...chosen, root };
  return readyRuntime;
}

module.exports = {
  ensureRuntime,
  firstWorking,
  gcloudWorks,
  pythonBinarySupported,
};
