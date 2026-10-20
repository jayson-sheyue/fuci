'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { httpFetch } = require('./http');

const REPO = 'jayson-sheyue/fuci';
const BRANCH = 'main';
const ARCHIVE_URL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;

function isSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || ''));
}

function offerUpdate({ remoteAhead = 0, localAhead = 0 } = {}) {
  return remoteAhead > 0 && localAhead === 0;
}

function offerFromCompare(data) {
  return offerUpdate({
    remoteAhead: Number(data?.ahead_by) || 0,
    localAhead: Number(data?.behind_by) || 0,
  });
}

function commandEnv() {
  const current = process.env.PATH || '';
  return {
    ...process.env,
    PATH: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', current].filter(Boolean).join(':'),
    GIT_TERMINAL_PROMPT: '0',
  };
}

function run(command, args, cwd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd,
      env: commandEnv(),
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || '').trim();
        reject(new Error(detail || '更新没有完成'));
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

function readStamp(appPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(appPath, 'revision.json'), 'utf8'));
    return isSha(raw?.commit) ? String(raw.commit) : '';
  } catch {
    return '';
  }
}

function bundleFromAppPath(appPath) {
  const bundle = path.resolve(appPath, '../../..');
  return bundle.endsWith('.app') ? bundle : '';
}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'fuci',
  };
}

async function fetchCompare(local) {
  const response = await httpFetch(`https://api.github.com/repos/${REPO}/compare/${local}...${BRANCH}`, {
    headers: githubHeaders(),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('没有连上 GitHub');
  return response.json();
}

async function remoteHead() {
  const response = await httpFetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) throw new Error('没有读到 GitHub 上的版本');
  const data = await response.json();
  if (!isSha(data?.sha)) throw new Error('没有读到 GitHub 上的版本');
  return data.sha;
}

async function gitCounts(appPath) {
  await run('git', ['fetch', '--quiet', 'origin', BRANCH], appPath, 30000);
  const remoteAhead = Number((await run('git', ['rev-list', '--count', `HEAD..origin/${BRANCH}`], appPath, 15000)).trim());
  const localAhead = Number((await run('git', ['rev-list', '--count', `origin/${BRANCH}..HEAD`], appPath, 15000)).trim());
  if (!Number.isFinite(remoteAhead) || !Number.isFinite(localAhead)) {
    throw new Error('没有读到 GitHub 上的版本');
  }
  return { remoteAhead, localAhead };
}

async function checkForUpdate(appPath) {
  const root = appPath || process.cwd();
  if (fs.existsSync(path.join(root, '.git'))) {
    try {
      const counts = await gitCounts(root);
      return { available: offerUpdate(counts) };
    } catch {
      // The checkout may not have a remote. Fall through to the commit stamp.
    }
  }
  const local = readStamp(root);
  if (!isSha(local)) return { available: false };
  try {
    const data = await fetchCompare(local);
    return { available: offerFromCompare(data) };
  } catch {
    return { available: false };
  }
}

function readPackage(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

function installSnapshot(sourceRoot, appPath) {
  const src = path.join(sourceRoot, 'src');
  if (!fs.existsSync(path.join(src, 'main', 'index.js'))) {
    throw new Error('更新包里没有浮词的程序文件');
  }
  const assets = path.join(sourceRoot, 'assets');
  if (!fs.existsSync(assets)) throw new Error('更新包里没有资源文件');

  fs.rmSync(path.join(appPath, 'src'), { recursive: true, force: true });
  fs.cpSync(src, path.join(appPath, 'src'), { recursive: true });
  fs.rmSync(path.join(appPath, 'assets'), { recursive: true, force: true });
  fs.cpSync(assets, path.join(appPath, 'assets'), { recursive: true });

  const incoming = readPackage(sourceRoot);
  const currentPath = path.join(appPath, 'package.json');
  const current = readPackage(appPath);
  const nextDependencies = incoming.dependencies || {};
  const depsChanged = JSON.stringify(current.dependencies || {}) !== JSON.stringify(nextDependencies);
  current.version = incoming.version || current.version;
  current.description = incoming.description || current.description;
  current.dependencies = nextDependencies;
  fs.writeFileSync(currentPath, `${JSON.stringify(current, null, 2)}\n`);

  const entitlements = path.join(sourceRoot, 'build', 'entitlements.mac.plist');
  if (fs.existsSync(entitlements)) {
    const dest = path.join(appPath, 'build');
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(entitlements, path.join(dest, 'entitlements.mac.plist'));
  }
  return { depsChanged };
}

function findSnapshot(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (fs.existsSync(path.join(full, 'src', 'main', 'index.js'))) return full;
  }
  throw new Error('没有找到更新内容');
}

async function downloadSnapshot() {
  const response = await httpFetch(ARCHIVE_URL, { headers: { 'User-Agent': 'fuci' } });
  if (!response.ok) throw new Error('没有从 GitHub 下载到最新代码');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 200 || bytes.length > 30 * 1024 * 1024) {
    throw new Error('GitHub 返回的更新包大小不对');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-update-'));
  const archive = path.join(dir, 'source.tar.gz');
  fs.writeFileSync(archive, bytes);
  await run('tar', ['-xzf', archive, '-C', dir], dir, 30000);
  return { dir, snapshot: findSnapshot(dir) };
}

function dependencyKey(pkg) {
  return JSON.stringify({
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
  });
}

async function applyUpdate(appPath) {
  const root = appPath || process.cwd();
  if (fs.existsSync(path.join(root, '.git'))) {
    const before = dependencyKey(readPackage(root));
    try {
      await run('git', ['pull', '--ff-only', '--autostash', 'origin', BRANCH], root);
    } catch (error) {
      if (/fast-forward|diverging|Not possible/i.test(error.message || '')) {
        throw new Error('GitHub 上的版本不能直接快进，更新已停下来。');
      }
      throw error;
    }
    if (dependencyKey(readPackage(root)) !== before) {
      await run('npm', ['install', '--ignore-scripts'], root, 180000);
    }
    return { mode: 'git' };
  }

  const local = readStamp(root);
  if (!isSha(local)) throw new Error('这个安装包没有版本记录，还不能在线更新。');
  const compared = await fetchCompare(local);
  if (!offerFromCompare(compared)) throw new Error('GitHub 上没有可直接安装的新版本。');
  const stamp = await remoteHead();
  const downloaded = await downloadSnapshot();
  try {
    const installed = installSnapshot(downloaded.snapshot, root);
    fs.writeFileSync(path.join(root, 'revision.json'), `${JSON.stringify({
      commit: stamp,
      repo: REPO,
      branch: BRANCH,
    }, null, 2)}\n`);
    if (installed.depsChanged) {
      await run('npm', ['install', '--omit=dev', '--ignore-scripts'], root, 180000);
    }
    const bundle = bundleFromAppPath(root);
    const entitlements = path.join(root, 'build', 'entitlements.mac.plist');
    if (bundle && fs.existsSync(entitlements)) {
      await run('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, bundle], root, 60000);
    }
    return { mode: 'bundle' };
  } finally {
    fs.rmSync(downloaded.dir, { recursive: true, force: true });
  }
}

module.exports = {
  REPO,
  BRANCH,
  isSha,
  offerUpdate,
  offerFromCompare,
  readStamp,
  bundleFromAppPath,
  installSnapshot,
  findSnapshot,
  checkForUpdate,
  applyUpdate,
};
