'use strict';

const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const clips = [
  {
    file: 'docs/lookup.gif',
    locale: 'zh',
    pair: 'en-zh',
    query: 'ephemeral',
    sample: 'sampleWord',
    article: '<p>The sentence stayed where it was.</p><p>Its fame was <em>ephemeral</em>, gone by morning, and there was no reason to open another window.</p><p>She kept reading the next line.</p>',
  },
  {
    file: 'docs/en/lookup.gif',
    locale: 'en',
    pair: 'zh-en',
    query: '学习',
    sample: 'sampleZhEnWord',
    article: '<p>她没有打开浏览器。</p><p>这一页里的「<em>学习</em>」让她停了一下，目光还在原来的那一行。</p><p>查完，她继续往下读。</p>',
  },
  {
    file: 'docs/ja/lookup.gif',
    locale: 'ja',
    pair: 'zh-ja',
    query: '学习',
    sample: 'sampleZhJaWord',
    article: '<p>她把窗口留在这一页。</p><p>只想知道「<em>学习</em>」是什么意思，不想再打开一个网页。</p><p>查完以后，还停在原来的句子上。</p>',
  },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function page(win, code) {
  const result = await win.webContents.executeJavaScript(`try { ${code}\n'ok'; } catch (error) { error.stack || String(error); }`);
  if (result !== 'ok') throw new Error(result);
}

function prefixes(text) {
  const chars = [...text];
  return chars.map((_, index) => chars.slice(0, index + 1).join(''));
}

function encodeGif(frames, dest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-gif-'));
  const manifest = frames.map((frame, index) => {
    const file = path.join(dir, `${String(index).padStart(3, '0')}.png`);
    fs.writeFileSync(file, frame.png);
    return { file, duration: frame.duration };
  });
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(manifest));
  const script = `
from PIL import Image
import json
manifest = json.load(open(${JSON.stringify(path.join(dir, 'frames.json'))}))
frames = [Image.open(item['file']).convert('RGB').quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for item in manifest]
frames[0].save(${JSON.stringify(dest)}, save_all=True, append_images=frames[1:], duration=[item['duration'] for item in manifest], loop=0, optimize=True, disposal=2)
print(frames[0].size)
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..');
  const win = new BrowserWindow({
    width: 640,
    height: 560,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#f7f4ee',
    webPreferences: {
      preload: path.join(__dirname, 'shot-preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  await win.loadFile(path.join(root, 'src/renderer/index.html'));
  await wait(400);
  win.setContentSize(640, 560);
  const setupError = await win.webContents.executeJavaScript(`
    try {
      document.documentElement.style.background = '#f7f4ee';
      document.body.style.background = '#f7f4ee';
      const shellEl = document.getElementById('shell');
      shellEl.style.position = 'relative';
      shellEl.style.zIndex = '1';
      const page = document.createElement('div');
      page.id = 'readme-page';
      page.style.position = 'fixed';
      page.style.inset = '0';
      page.style.zIndex = '0';
      page.style.padding = '118px 40px 32px';
      page.style.background = '#f7f4ee';
      page.style.color = '#2c2a26';
      page.style.font = '18px/1.75 Palatino, Songti SC, serif';
      document.body.prepend(page);
      'ok';
    } catch (error) {
      error.stack || error.message;
    }
  `);
  if (setupError !== 'ok') throw new Error(setupError);

  for (const clip of clips) {
    const frames = [];
    const snap = async (duration) => {
      await wait(40);
      const image = await win.capturePage();
      frames.push({ png: image.toPNG(), duration });
    };
    await page(win, `
      resetShot();
      state.locale = ${JSON.stringify(clip.locale)};
      state.bootstrap.settings.uiLocale = state.locale;
      state.bootstrap.settings.pair = ${JSON.stringify(clip.pair)};
      state.bootstrap.settings.panelOpacity = 0.94;
      applyPanelOpacity(0.94);
      paintChrome();
      const page = document.getElementById('readme-page');
      page.innerHTML = ${JSON.stringify(clip.article)};
      page.querySelectorAll('em').forEach((mark) => {
        mark.style.background = '#ffe08a';
        mark.style.fontStyle = 'normal';
        mark.style.padding = '0 3px';
        mark.style.borderRadius = '3px';
      });
      input.value = '';
      syncChrome();
      hideBoard();
    `);
    await wait(420);
    await snap(700);
    await snap(500);
    for (const partial of prefixes(clip.query)) {
      await page(win, `
        input.value = ${JSON.stringify(partial)};
        syncChrome();
      `);
      await snap([...clip.query].length > 4 ? 80 : 180);
    }
    await snap(360);
    await page(win, `
      renderResult(${clip.sample}());
      document.getElementById('board-body').style.maxHeight = '248px';
      document.getElementById('board-body').style.overflow = 'hidden';
    `);
    await wait(180);
    await snap(700);
    await snap(900);
    await page(win, `
      input.value = '';
      syncChrome();
      hideBoard();
      collapseToOrb();
    `);
    await wait(700);
    await snap(1200);
    const dest = path.join(root, clip.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    encodeGif(frames, dest);
    const size = fs.statSync(dest).size;
    console.log('wrote', clip.file, frames.length, 'frames', Math.round(size / 1024), 'KB');
  }
  app.quit();
});
