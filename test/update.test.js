'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isSha,
  offerUpdate,
  offerFromCompare,
  readStamp,
  bundleFromAppPath,
  installSnapshot,
  findSnapshot,
} = require('../src/main/update');

test('an update is offered only when GitHub can fast-forward this install', () => {
  assert.equal(offerUpdate({ remoteAhead: 2, localAhead: 0 }), true);
  assert.equal(offerUpdate({ remoteAhead: 0, localAhead: 0 }), false);
  assert.equal(offerUpdate({ remoteAhead: 0, localAhead: 3 }), false);
  assert.equal(offerUpdate({ remoteAhead: 2, localAhead: 1 }), false);
  assert.equal(offerFromCompare({ ahead_by: 1, behind_by: 0, status: 'ahead' }), true);
  assert.equal(offerFromCompare({ ahead_by: 1, behind_by: 2, status: 'diverged' }), false);
  assert.equal(isSha('a'.repeat(40)), true);
  assert.equal(isSha('main'), false);
});

test('a packaged snapshot replaces program files and keeps the install record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-update-test-'));
  const source = path.join(root, 'fuci-main');
  const appPath = path.join(root, '浮词.app', 'Contents', 'Resources', 'app');
  fs.mkdirSync(path.join(source, 'src', 'main'), { recursive: true });
  fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(source, 'build'), { recursive: true });
  fs.writeFileSync(path.join(source, 'src', 'main', 'index.js'), 'next');
  fs.writeFileSync(path.join(source, 'assets', 'icon.png'), 'icon');
  fs.writeFileSync(path.join(source, 'build', 'entitlements.mac.plist'), '<plist/>');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    version: '1.2.0',
    description: 'next',
    dependencies: { 'google-auth-library': '^12.0.0' },
    devDependencies: { electron: '^44.0.0' },
  }));
  fs.writeFileSync(path.join(source, 'secrets.txt'), 'nope');

  fs.mkdirSync(path.join(appPath, 'src', 'main'), { recursive: true });
  fs.mkdirSync(path.join(appPath, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(appPath, 'src', 'main', 'index.js'), 'old');
  fs.writeFileSync(path.join(appPath, 'src', 'retired.js'), 'gone');
  fs.writeFileSync(path.join(appPath, 'assets', 'icon.png'), 'old-icon');
  fs.writeFileSync(path.join(appPath, 'package.json'), `${JSON.stringify({
    name: 'fuci',
    version: '1.0.0',
    main: 'src/main/index.js',
    dependencies: { 'google-auth-library': '^11.2.0' },
  }, null, 2)}\n`);
  fs.mkdirSync(path.join(appPath, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(appPath, 'node_modules', 'kept.js'), 'stay');
  fs.writeFileSync(path.join(appPath, 'revision.json'), JSON.stringify({
    commit: 'b'.repeat(40),
  }));

  const installed = installSnapshot(source, appPath);
  assert.equal(installed.depsChanged, true);
  assert.equal(fs.readFileSync(path.join(appPath, 'src', 'main', 'index.js'), 'utf8'), 'next');
  assert.equal(fs.existsSync(path.join(appPath, 'src', 'retired.js')), false);
  assert.equal(fs.existsSync(path.join(appPath, 'secrets.txt')), false);
  assert.equal(fs.readFileSync(path.join(appPath, 'node_modules', 'kept.js'), 'utf8'), 'stay');
  const pkg = JSON.parse(fs.readFileSync(path.join(appPath, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['google-auth-library'], '^12.0.0');
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.main, 'src/main/index.js');
  assert.equal(readStamp(appPath), 'b'.repeat(40));
  assert.equal(findSnapshot(root), source);
  assert.equal(bundleFromAppPath(appPath), path.join(root, '浮词.app'));
  fs.rmSync(root, { recursive: true, force: true });
});
