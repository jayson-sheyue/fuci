#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const electronDir = path.join(ROOT, 'node_modules', 'electron');
const { extract } = require(require.resolve('@electron-internal/extract-zip', { paths: [electronDir] }));
const electronPkg = require(path.join(electronDir, 'package.json'));
const checksums = require(path.join(electronDir, 'checksums.json'));
const pkg = require(path.join(ROOT, 'package.json'));

const KEEP_LOCALES = new Set(['en-US.pak', 'en-GB.pak', 'zh-CN.pak', 'zh-TW.pak', 'ja.pak']);

function readCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : '';
  } catch {
    return '';
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function ensureWinElectronZip(electronVersion) {
  const zipName = `electron-v${electronVersion}-win32-x64.zip`;
  const expectedSha = checksums[zipName];
  const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'electron', 'fuci-win32-x64');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachedZip = path.join(cacheDir, zipName);

  if (fs.existsSync(cachedZip) && (!expectedSha || sha256File(cachedZip) === expectedSha)) {
    return cachedZip;
  }

  const url = `https://github.com/electron/electron/releases/download/v${electronVersion}/${zipName}`;
  console.log(`正在下载 ${zipName}...`);
  execFileSync('/usr/bin/curl', ['-fL', '--retry', '3', '--retry-delay', '2', '-o', cachedZip, url], {
    stdio: 'inherit',
  });

  if (expectedSha) {
    const actualSha = sha256File(cachedZip);
    if (actualSha !== expectedSha) {
      fs.rmSync(cachedZip, { force: true });
      throw new Error(`SHA-256 校验未通过: 期望 ${expectedSha}, 实际 ${actualSha}`);
    }
  }
  return cachedZip;
}

function normalizeTree(rootDir, stamp = new Date()) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.name === '.DS_Store' || entry.name.startsWith('._')) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      normalizeTree(fullPath, stamp);
      fs.chmodSync(fullPath, 0o755);
      fs.utimesSync(fullPath, stamp, stamp);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const isExec = ext === '.exe' || ext === '.dll' || ext === '.cmd' || ext === '.bat';
      fs.chmodSync(fullPath, isExec ? 0o755 : 0o644);
      fs.utimesSync(fullPath, stamp, stamp);
    }
  }
  fs.chmodSync(rootDir, 0o755);
  fs.utimesSync(rootDir, stamp, stamp);
}

function createCleanWindowsZip(bundleDir, outZip) {
  const pyScript = [
    'import os, sys, time, zipfile',
    'bundle_dir, out_zip = sys.argv[1], sys.argv[2]',
    'parent_dir = os.path.dirname(bundle_dir)',
    'now_tuple = time.localtime()[:6]',
    'with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:',
    '    for root, dirs, files in os.walk(bundle_dir):',
    '        dirs[:] = sorted(d for d in dirs if not d.startswith("._") and d != ".DS_Store")',
    '        files = sorted(f for f in files if not f.startswith("._") and f != ".DS_Store")',
    '        for f in files:',
    '            full_path = os.path.join(root, f)',
    '            rel_path = os.path.relpath(full_path, parent_dir).replace(os.sep, "/")',
    '            zi = zipfile.ZipInfo(rel_path, now_tuple)',
    '            zi.compress_type = zipfile.ZIP_DEFLATED',
    '            zi.create_system = 3',
    '            ext = os.path.splitext(f)[1].lower()',
    '            mode = 0o100755 if ext in (".exe", ".dll", ".cmd", ".bat") else 0o100644',
    '            zi.external_attr = (mode << 16)',
    '            with open(full_path, "rb") as src, zf.open(zi, "w") as dst:',
    '                while True:',
    '                    chunk = src.read(1024 * 1024)',
    '                    if not chunk:',
    '                        break',
    '                    dst.write(chunk)',
  ].join('\n');
  execFileSync('python3', ['-c', pyScript, bundleDir, outZip], { stdio: 'inherit' });
}

async function main() {
  const version = pkg.version;
  const electronVersion = electronPkg.version;
  console.log(`正在准备 Electron ${electronVersion} (win32-x64) 运行时...`);
  const zipPath = ensureWinElectronZip(electronVersion);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-win-'));
  const bundleDir = path.join(tempRoot, 'Fuci-win32-x64');
  fs.mkdirSync(bundleDir, { recursive: true });

  try {
    console.log('正在组装 Fuci-win32-x64...');
    await extract(zipPath, { dir: bundleDir });

    const defaultAsar = path.join(bundleDir, 'resources', 'default_app.asar');
    fs.rmSync(defaultAsar, { force: true });

    const appDir = path.join(bundleDir, 'resources', 'app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.cpSync(path.join(ROOT, 'src'), path.join(appDir, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'assets'), path.join(appDir, 'assets'), { recursive: true });

    fs.writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify({
      name: pkg.name,
      productName: pkg.productName,
      version: pkg.version,
      private: true,
      description: pkg.description,
      main: pkg.main,
      dependencies: pkg.dependencies,
    }, null, 2)}\n`);

    const commit = readCommit();
    if (commit) {
      fs.writeFileSync(path.join(appDir, 'revision.json'), `${JSON.stringify({
        commit,
        repo: 'jayson-sheyue/fuci',
        branch: 'main',
      }, null, 2)}\n`);
    }

    const localesDir = path.join(bundleDir, 'locales');
    if (fs.existsSync(localesDir)) {
      for (const file of fs.readdirSync(localesDir)) {
        if (!KEEP_LOCALES.has(file)) {
          fs.rmSync(path.join(localesDir, file), { force: true });
        }
      }
    }

    const electronExe = path.join(bundleDir, 'electron.exe');
    const fuciExe = path.join(bundleDir, 'Fuci.exe');
    if (fs.existsSync(electronExe)) {
      fs.renameSync(electronExe, fuciExe);
    }

    try {
      execFileSync('/usr/bin/xattr', ['-cr', bundleDir], { stdio: 'ignore' });
    } catch {
      /* ignore if xattr is unavailable */
    }
    normalizeTree(bundleDir);

    const distDir = path.join(ROOT, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const outZip = path.join(distDir, `fuci-${version}-win-x64.zip`);
    fs.rmSync(outZip, { force: true });

    console.log('正在压缩 Windows 免安装版...');
    createCleanWindowsZip(bundleDir, outZip);

    console.log('已生成');
    console.log(`  ${outZip}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
