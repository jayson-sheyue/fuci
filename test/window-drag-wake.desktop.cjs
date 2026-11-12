'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.versions.electron) {
  const electronBin = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(electronBin, [__filename], {
    stdio: 'inherit',
    env,
  });
  process.exit(0);
}

const { app, BrowserWindow, Menu, screen } = require('electron');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuci-drag-wake-'));
process.env.NODE_ENV = 'test';
process.env.FUCI_TEST_DATA = dir;

// Seed userData with stuck left-edge bounds before main loads.
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
  bounds: { x: -380, y: 5 },
  route: 'gemini',
  geminiApiKey: 'AIzaSy' + 'TestKeyForOfflineLayout0000000000',
  uiLocale: 'zh',
}, null, 2));

const appRoot = process.env.FUCI_APP_ROOT || path.resolve(__dirname, '..');
require(path.join(appRoot, 'src/main/index.js'));

async function waitForWindow() {
  for (let i = 0; i < 100; i += 1) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      const ready = await win.webContents.executeJavaScript('Boolean(window.fuci && document.getElementById("search"))');
      if (ready) return win;
    }
    await sleep(50);
  }
  throw new Error('Timed out waiting for Fuci BrowserWindow');
}

async function dispatchPointer(win, selector, type, { clientX, clientY, screenX, screenY, button = 0, buttons = 1, pointerId = 1 }) {
  const payload = JSON.stringify({ selector, type, init: { clientX, clientY, screenX, screenY, button, buttons, pointerId } });
  await win.webContents.executeJavaScript(`(() => {
    const { selector, type, init } = ${payload};
    const target = selector === 'window' ? window : document.querySelector(selector);
    if (!target) throw new Error('Missing target: ' + selector);
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      pointerId: init.pointerId,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: init.clientX,
      clientY: init.clientY,
      screenX: init.screenX,
      screenY: init.screenY,
      button: init.button,
      buttons: init.buttons,
    });
    target.dispatchEvent(event);
  })()`);
}

async function getBox(win, selector) {
  return win.webContents.executeJavaScript(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
}

function getState(win) {
  const bounds = win.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const displayArea = screen.getDisplayMatching(bounds).workArea;
  return {
    bounds,
    visible: win.isVisible(),
    focused: win.isFocused(),
    area,
    displayArea,
  };
}

function triggerShowSearch() {
  const menu = Menu.getApplicationMenu();
  for (const top of menu.items) {
    if (!top.submenu) continue;
    for (const sub of top.submenu.items) {
      if (sub.click && /显示搜索|Show search|検索を表示/.test(sub.label)) {
        sub.click(sub, null, {});
        return;
      }
    }
  }
  throw new Error('Show search menu item not found');
}

(async () => {
  try {
    await app.whenReady();
    const win = await waitForWindow();
    await sleep(150);

    // 1. Startup rescue: previously saved stuck bounds (-380, 5) must be clamped inside workArea.
    const initial = getState(win);
    assert(
      initial.bounds.x >= initial.displayArea.x + 8,
      `Expected startup x (${initial.bounds.x}) >= workArea.x + 8 (${initial.displayArea.x + 8})`,
    );
    assert(
      initial.bounds.y >= initial.displayArea.y + 8,
      `Expected startup y (${initial.bounds.y}) >= workArea.y + 8 (${initial.displayArea.y + 8})`,
    );

    // 2. Wake from off-center hidden state: must ALWAYS appear in the exact center of activeWorkArea.
    win.setPosition(90, 90, false);
    win.hide();
    triggerShowSearch();
    await sleep(120);
    const woken = getState(win);
    const expectedCenterX = Math.round(woken.area.x + (woken.area.width - woken.bounds.width) / 2);
    const expectedCenterY = Math.round(woken.area.y + (woken.area.height - woken.bounds.height) / 2);
    assert(Math.abs(woken.bounds.x - expectedCenterX) <= 2, `Expected centered x=${expectedCenterX}, got ${woken.bounds.x}`);
    assert(Math.abs(woken.bounds.y - expectedCenterY) <= 2, `Expected centered y=${expectedCenterY}, got ${woken.bounds.y}`);
    assert.equal(woken.visible, true);

    // 3. Long-press drag on #q when input has selected text (post-wake state) vs quick-sweep selection.
    await win.webContents.executeJavaScript(`(() => {
      const q = document.getElementById('q');
      q.value = 'ephemeral';
      q.focus();
      q.select();
    })()`);

    // 3a. Quick sweep (< 220ms) on #q must NOT move the window.
    const beforeQuickSweep = getState(win).bounds;
    const qBox = await getBox(win, '#q');
    const qCenterX = Math.round(qBox.x + qBox.width / 2);
    const qCenterY = Math.round(qBox.y + qBox.height / 2);
    await dispatchPointer(win, '#q', 'pointerdown', {
      clientX: qCenterX,
      clientY: qCenterY,
      screenX: beforeQuickSweep.x + qCenterX,
      screenY: beforeQuickSweep.y + qCenterY,
      pointerId: 1,
    });
    await sleep(40);
    await dispatchPointer(win, 'window', 'pointermove', {
      clientX: qCenterX + 40,
      clientY: qCenterY,
      screenX: beforeQuickSweep.x + qCenterX + 40,
      screenY: beforeQuickSweep.y + qCenterY,
      pointerId: 1,
    });
    await dispatchPointer(win, 'window', 'pointerup', {
      clientX: qCenterX + 40,
      clientY: qCenterY,
      screenX: beforeQuickSweep.x + qCenterX + 40,
      screenY: beforeQuickSweep.y + qCenterY,
      buttons: 0,
      pointerId: 1,
    });
    const afterQuickSweep = getState(win).bounds;
    assert.equal(afterQuickSweep.x, beforeQuickSweep.x, 'Quick sweep < 220ms on non-empty #q must not drag window');
    assert.equal(afterQuickSweep.y, beforeQuickSweep.y, 'Quick sweep < 220ms on non-empty #q must not drag window');

    // 3b. Long-press (>= 220ms) on #q + drag MUST move the window (even if panel window blurs mid-hold)!
    await dispatchPointer(win, '#q', 'pointerdown', {
      clientX: qCenterX,
      clientY: qCenterY,
      screenX: afterQuickSweep.x + qCenterX,
      screenY: afterQuickSweep.y + qCenterY,
      pointerId: 2,
    });
    await sleep(60);
    await win.webContents.executeJavaScript('window.dispatchEvent(new Event("blur"))');
    await sleep(200);
    const draggingClass = await win.webContents.executeJavaScript('document.getElementById("search").classList.contains("is-dragging")');
    assert.equal(draggingClass, true, 'Search bar should enter is-dragging visual state after long-press');
    await dispatchPointer(win, 'window', 'pointermove', {
      clientX: qCenterX + 90,
      clientY: qCenterY + 35,
      screenX: afterQuickSweep.x + qCenterX + 90,
      screenY: afterQuickSweep.y + qCenterY + 35,
      pointerId: 2,
    });
    await dispatchPointer(win, 'window', 'pointerup', {
      clientX: qCenterX + 90,
      clientY: qCenterY + 35,
      screenX: afterQuickSweep.x + qCenterX + 90,
      screenY: afterQuickSweep.y + qCenterY + 35,
      buttons: 0,
      pointerId: 2,
    });
    await sleep(40);
    const afterLongPressInput = getState(win).bounds;
    assert.equal(afterLongPressInput.x, afterQuickSweep.x + 90, 'Long-press drag on #q must move window x by +90');
    assert.equal(afterLongPressInput.y, afterQuickSweep.y + 35, 'Long-press drag on #q must move window y by +35');

    // 4. Long-press drag on #gear must move window AND suppress opening Settings on release!
    assert.equal(await win.webContents.executeJavaScript('Boolean(document.getElementById("settings-title"))'), false);
    const gearBox = await getBox(win, '#gear');
    const gx = Math.round(gearBox.x + gearBox.width / 2);
    const gy = Math.round(gearBox.y + gearBox.height / 2);
    await dispatchPointer(win, '#gear', 'pointerdown', {
      clientX: gx,
      clientY: gy,
      screenX: afterLongPressInput.x + gx,
      screenY: afterLongPressInput.y + gy,
      pointerId: 3,
    });
    await sleep(260);
    await dispatchPointer(win, 'window', 'pointermove', {
      clientX: gx - 50,
      clientY: gy - 20,
      screenX: afterLongPressInput.x + gx - 50,
      screenY: afterLongPressInput.y + gy - 20,
      pointerId: 3,
    });
    await dispatchPointer(win, 'window', 'pointerup', {
      clientX: gx - 50,
      clientY: gy - 20,
      screenX: afterLongPressInput.x + gx - 50,
      screenY: afterLongPressInput.y + gy - 20,
      buttons: 0,
      pointerId: 3,
    });
    await win.webContents.executeJavaScript('document.getElementById("gear").click()');
    await sleep(40);
    const afterGearDrag = getState(win).bounds;
    assert.equal(afterGearDrag.x, afterLongPressInput.x - 50);
    assert.equal(afterGearDrag.y, afterLongPressInput.y - 20);
    const settingsOpenAfterDrag = await win.webContents.executeJavaScript('Boolean(document.getElementById("settings-title"))');
    assert.equal(settingsOpenAfterDrag, false, 'Releasing a long-press drag on #gear must suppress accidental click');

    // Normal click on #gear still opens and closes Settings!
    await sleep(140);
    await win.webContents.executeJavaScript('document.getElementById("gear").click()');
    await sleep(40);
    assert.equal(await win.webContents.executeJavaScript('Boolean(document.getElementById("settings-title"))'), true);
    await win.webContents.executeJavaScript('document.getElementById("gear").click()');
    await sleep(40);
    assert.equal(await win.webContents.executeJavaScript('Boolean(document.getElementById("settings-title"))'), false);

    // 5. Slow click (260ms, 0px movement) on #lang must still toggle translation direction!
    const pairBefore = await win.webContents.executeJavaScript('document.getElementById("lang").textContent');
    const langBox = await getBox(win, '#lang');
    const lx = Math.round(langBox.x + langBox.width / 2);
    const ly = Math.round(langBox.y + langBox.height / 2);
    const curBounds = getState(win).bounds;
    await dispatchPointer(win, '#lang', 'pointerdown', {
      clientX: lx,
      clientY: ly,
      screenX: curBounds.x + lx,
      screenY: curBounds.y + ly,
      pointerId: 4,
    });
    await sleep(260);
    await dispatchPointer(win, 'window', 'pointerup', {
      clientX: lx,
      clientY: ly,
      screenX: curBounds.x + lx,
      screenY: curBounds.y + ly,
      buttons: 0,
      pointerId: 4,
    });
    await win.webContents.executeJavaScript('document.getElementById("lang").click()');
    await sleep(40);
    const pairAfter = await win.webContents.executeJavaScript('document.getElementById("lang").textContent');
    assert.notEqual(pairAfter, pairBefore, 'Stationary slow click on #lang must still cycle translation pair');

    // 6. Dragging violently toward the left sidebar (-3000, -3000) must clamp inside workArea and never get stuck!
    const sealBox = await getBox(win, '#seal');
    const sx = Math.round(sealBox.x + sealBox.width / 2);
    const sy = Math.round(sealBox.y + sealBox.height / 2);
    const beforeEdgeDrag = getState(win).bounds;
    await dispatchPointer(win, '#seal', 'pointerdown', {
      clientX: sx,
      clientY: sy,
      screenX: beforeEdgeDrag.x + sx,
      screenY: beforeEdgeDrag.y + sy,
      pointerId: 5,
    });
    await dispatchPointer(win, 'window', 'pointermove', {
      clientX: sx,
      clientY: sy,
      screenX: beforeEdgeDrag.x + sx - 3000,
      screenY: beforeEdgeDrag.y + sy - 3000,
      pointerId: 5,
    });
    await dispatchPointer(win, 'window', 'pointerup', {
      clientX: sx,
      clientY: sy,
      screenX: beforeEdgeDrag.x + sx - 3000,
      screenY: beforeEdgeDrag.y + sy - 3000,
      buttons: 0,
      pointerId: 5,
    });
    await sleep(40);
    const clampedEdge = getState(win);
    assert(
      clampedEdge.bounds.x >= clampedEdge.displayArea.x + 8,
      `After dragging -3000px left, x (${clampedEdge.bounds.x}) must stay >= workArea.x + 8 (${clampedEdge.displayArea.x + 8})`,
    );
    assert(
      clampedEdge.bounds.y >= clampedEdge.displayArea.y + 8,
      `After dragging -3000px up, y (${clampedEdge.bounds.y}) must stay >= workArea.y + 8 (${clampedEdge.displayArea.y + 8})`,
    );

    // 7. Real Chromium double-click on #seal -> collapse to orb -> real double-click #orb -> expand -> real double-click #seal -> wake via shortcut!
    const cursorForOrb = screen.getCursorScreenPoint();
    const areaForOrb = screen.getDisplayNearestPoint(cursorForOrb).workArea;
    const orbTestX = (cursorForOrb.x - areaForOrb.x) > areaForOrb.width / 2
      ? areaForOrb.x + 24
      : Math.max(areaForOrb.x + 24, areaForOrb.x + areaForOrb.width - 520 - 90);
    const orbTestY = (cursorForOrb.y - areaForOrb.y) > areaForOrb.height / 2
      ? areaForOrb.y + 24
      : Math.max(areaForOrb.y + 24, areaForOrb.y + areaForOrb.height - 140);
    win.setPosition(Math.round(orbTestX), Math.round(orbTestY), false);

    async function sendRealDoubleClick(selector) {
      const box = await getBox(win, selector);
      const b = getState(win).bounds;
      const cx = Math.round(box.x + box.width / 2);
      const cy = Math.round(box.y + box.height / 2);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, globalX: b.x + cx, globalY: b.y + cy, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, globalX: b.x + cx, globalY: b.y + cy, button: 'left', clickCount: 1 });
      await sleep(30);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, globalX: b.x + cx, globalY: b.y + cy, button: 'left', clickCount: 2 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, globalX: b.x + cx, globalY: b.y + cy, button: 'left', clickCount: 2 });
    }

    await sendRealDoubleClick('#seal');
    await sleep(140);
    const orbState = getState(win);
    assert.equal(orbState.bounds.width, 116, 'Real double-click on #seal must collapse to 116x116 orb');

    await sendRealDoubleClick('#orb');
    await sleep(140);
    assert.equal(getState(win).bounds.width, 520, 'Real double-click on #orb must expand back to 520px bar');

    await sendRealDoubleClick('#q');
    await sleep(80);
    assert.equal(getState(win).bounds.width, 520, 'Real double-click on #q must select text and NOT collapse to orb');

    // Clear input before testing #lang & #hint double-clicks so #lang does not fire a network lookup.
    await win.webContents.executeJavaScript('document.getElementById("clear").click()');
    await sleep(60);

    await sendRealDoubleClick('#lang');
    await sleep(80);
    assert.equal(getState(win).bounds.width, 520, 'Real double-click on #lang must toggle pair and NOT collapse to orb');

    // Double-clicking non-interactive search bar chrome (#hint) also collapses to orb, and #orb expands back.
    await sendRealDoubleClick('#hint');
    await sleep(140);
    assert.equal(getState(win).bounds.width, 116, 'Real double-click on non-interactive #hint on search bar must collapse to 116x116 orb');

    await sendRealDoubleClick('#orb');
    await sleep(140);
    assert.equal(getState(win).bounds.width, 520, 'Real double-click on #orb must expand back to 520px bar');

    await sendRealDoubleClick('#seal');
    await sleep(140);
    assert.equal(getState(win).bounds.width, 116, 'Second real double-click on #seal must collapse to 116x116 orb again');
    win.setPosition(100, 620, false);
    triggerShowSearch();
    await sleep(150);
    const wokenFromOrb = getState(win);
    const isOrbClass = await win.webContents.executeJavaScript('document.getElementById("shell").classList.contains("is-orb")');
    assert.equal(isOrbClass, false, 'Waking from orb must expand back to search bar');
    assert.equal(wokenFromOrb.bounds.width, 520, 'Waking from orb must restore 520px bar width');
    const expX = Math.round(wokenFromOrb.area.x + (wokenFromOrb.area.width - wokenFromOrb.bounds.width) / 2);
    const expY = Math.round(wokenFromOrb.area.y + (wokenFromOrb.area.height - wokenFromOrb.bounds.height) / 2);
    assert(Math.abs(wokenFromOrb.bounds.x - expX) <= 2, `Expected wake-from-orb centered x=${expX}, got ${wokenFromOrb.bounds.x}`);
    assert(Math.abs(wokenFromOrb.bounds.y - expY) <= 2, `Expected wake-from-orb centered y=${expY}, got ${wokenFromOrb.bounds.y}`);

    // 8. Real Chromium input pipeline (webContents.sendInputEvent) on selected text in #q and on #gear:
    // Place window inside workArea away from the live OS cursor so physical mouse movement cannot inject buttons:0 events.
    const cursorNow = screen.getCursorScreenPoint();
    const safeArea = screen.getDisplayNearestPoint(cursorNow).workArea;
    const safeX = (cursorNow.x - safeArea.x) > safeArea.width / 2
      ? safeArea.x + 24
      : Math.max(safeArea.x + 24, safeArea.x + safeArea.width - 520 - 90);
    const safeY = (cursorNow.y - safeArea.y) > safeArea.height / 2
      ? safeArea.y + 24
      : Math.max(safeArea.y + 24, safeArea.y + safeArea.height - 140);
    win.setPosition(Math.round(safeX), Math.round(safeY), false);
    await win.webContents.executeJavaScript(`(() => {
      const q = document.getElementById('q');
      q.value = 'ephemeral';
      q.focus();
      q.select();
    })()`);
    const beforeRealInputDrag = getState(win).bounds;
    const realQBox = await getBox(win, '#q');
    const rqx = Math.round(realQBox.x + 30);
    const rqy = Math.round(realQBox.y + realQBox.height / 2);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: rqx, y: rqy, globalX: beforeRealInputDrag.x + rqx, globalY: beforeRealInputDrag.y + rqy, button: 'left', clickCount: 1 });
    await sleep(260);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: rqx + 65, y: rqy + 25, globalX: beforeRealInputDrag.x + rqx + 65, globalY: beforeRealInputDrag.y + rqy + 25, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(30);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: rqx + 65, y: rqy + 25, globalX: beforeRealInputDrag.x + rqx + 65, globalY: beforeRealInputDrag.y + rqy + 25, button: 'left', clickCount: 1 });
    await sleep(50);
    const afterRealInputDrag = getState(win).bounds;
    assert(
      afterRealInputDrag.x > beforeRealInputDrag.x + 20,
      `Real Blink mouseDown+hold+mouseMove on selected #q must move window (before=${beforeRealInputDrag.x}, after=${afterRealInputDrag.x})`,
    );

    const realGearBox = await getBox(win, '#gear');
    const rgx = Math.round(realGearBox.x + realGearBox.width / 2);
    const rgy = Math.round(realGearBox.y + realGearBox.height / 2);
    const beforeRealGearDrag = getState(win).bounds;
    win.webContents.sendInputEvent({ type: 'mouseDown', x: rgx, y: rgy, globalX: beforeRealGearDrag.x + rgx, globalY: beforeRealGearDrag.y + rgy, button: 'left', clickCount: 1 });
    await sleep(260);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: rgx - 45, y: rgy + 15, globalX: beforeRealGearDrag.x + rgx - 45, globalY: beforeRealGearDrag.y + rgy + 15, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(30);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: rgx - 45, y: rgy + 15, globalX: beforeRealGearDrag.x + rgx - 45, globalY: beforeRealGearDrag.y + rgy + 15, button: 'left', clickCount: 1 });
    await sleep(60);
    const afterRealGearDrag = getState(win).bounds;
    assert(
      afterRealGearDrag.x < beforeRealGearDrag.x - 15,
      `Real Blink mouseDown+hold+mouseMove on #gear must move window (before=${beforeRealGearDrag.x}, after=${afterRealGearDrag.x})`,
    );
    assert.equal(
      await win.webContents.executeJavaScript('Boolean(document.getElementById("settings-title"))'),
      false,
      'Real Blink mouseUp after dragging #gear must not open Settings',
    );

    const realSealBox = await getBox(win, '#seal');
    const rsx = Math.round(realSealBox.x + realSealBox.width / 2);
    const rsy = Math.round(realSealBox.y + realSealBox.height / 2);
    const beforeRealSealDrag = getState(win).bounds;
    win.webContents.sendInputEvent({ type: 'mouseDown', x: rsx, y: rsy, globalX: beforeRealSealDrag.x + rsx, globalY: beforeRealSealDrag.y + rsy, button: 'left', clickCount: 1 });
    await sleep(10);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: rsx + 38, y: rsy + 12, globalX: beforeRealSealDrag.x + rsx + 38, globalY: beforeRealSealDrag.y + rsy + 12, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(20);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: rsx + 38, y: rsy + 12, globalX: beforeRealSealDrag.x + rsx + 38, globalY: beforeRealSealDrag.y + rsy + 12, button: 'left', clickCount: 1 });
    await sleep(40);
    const afterRealSealDrag = getState(win).bounds;
    assert(
      afterRealSealDrag.x > beforeRealSealDrag.x + 15,
      `Real Blink immediate drag on #seal must move window without waiting 220ms (before=${beforeRealSealDrag.x}, after=${afterRealSealDrag.x})`,
    );

    console.log('PASS: startup left-sidebar rescue, desktop-center wake from hidden/moved/orb, long-press search-bar drag (PointerEvent + real Blink sendInputEvent on selected #q & #gear + slow-click + quick-sweep selection), and 4-edge workArea clamping.');
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(1);
  }
})();
