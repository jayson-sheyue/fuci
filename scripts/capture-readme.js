'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const shots = ['bar', 'word', 'sentence', 'orb', 'settings', 'en-word'];

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
    win.setContentSize(shot === 'orb' ? 180 : 560, shot === 'orb' ? 180 : 980);
    await win.webContents.executeJavaScript(`resetShot(); location.hash = ${JSON.stringify(shot)}; applyShot();`);
    await wait(shot === 'orb' ? 800 : 300);
    const height = await win.webContents.executeJavaScript(
      'Math.ceil(document.getElementById("shell").getBoundingClientRect().height) + 12',
    );
    const width = shot === 'orb' ? 148 : 536;
    win.setContentSize(width, Math.max(120, height));
    await wait(180);
    const image = await win.capturePage();
    fs.writeFileSync(path.join(dir, `${shot}.png`), image.toPNG());
    console.log('wrote', shot, width, height);
  }
  app.quit();
});
