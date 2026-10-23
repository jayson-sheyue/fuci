'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const shots = [
  'bar', 'word', 'sentence', 'orb', 'settings', 'look',
  'en-bar', 'en-word', 'en-sentence', 'en-orb', 'en-settings', 'en-look',
  'ja-bar', 'ja-word', 'ja-sentence', 'ja-orb', 'ja-settings', 'ja-look',
];

function shotPath(dir, shot) {
  if (shot.startsWith('en-')) return path.join(dir, 'en', `${shot.slice(3)}.png`);
  if (shot.startsWith('ja-')) return path.join(dir, 'ja', `${shot.slice(3)}.png`);
  return path.join(dir, `${shot}.png`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  const dir = path.join(__dirname, '../docs');
  fs.mkdirSync(dir, { recursive: true });
  const win = new BrowserWindow({
    width: 560,
    height: 900,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#e7eef6',
    webPreferences: {
      preload: path.join(__dirname, 'shot-preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  await wait(400);
  for (const shot of shots) {
    const orb = shot === 'orb' || shot.endsWith('-orb');
    win.setContentSize(orb ? 180 : 560, orb ? 180 : 980);
    await win.webContents.executeJavaScript(`resetShot(); location.hash = ${JSON.stringify(shot)}; applyShot();`);
    await wait(orb ? 800 : 300);
    const height = await win.webContents.executeJavaScript(
      'Math.ceil(document.getElementById("shell").getBoundingClientRect().height) + 12',
    );
    const width = orb ? 148 : 536;
    win.setContentSize(width, Math.max(120, height));
    await wait(180);
    const image = await win.capturePage();
    const file = shotPath(dir, shot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    console.log('wrote', path.relative(dir, file), width, height);
  }
  app.quit();
});
