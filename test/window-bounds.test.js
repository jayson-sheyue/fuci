'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WINDOW_WIDTH,
  ORB_WINDOW,
  DEFAULT_BAR_HEIGHT,
  EDGE_PADDING,
  clampBoundsToWorkArea,
  centerBoundsInWorkArea,
  clampDragOriginToDisplays,
  boundsVisible,
} = require('../src/main/window-bounds');

test('clampBoundsToWorkArea rescues windows stuck past left sidebar, top menu bar, right, and bottom edges', () => {
  // Simulate macOS with a 76px left Dock/Stage Manager strip and 32px top menu bar.
  const area = { x: 76, y: 32, width: 1436, height: 950 };

  const stuckLeft = clampBoundsToWorkArea({ x: -320, y: 10, width: WINDOW_WIDTH, height: DEFAULT_BAR_HEIGHT }, area);
  assert.equal(stuckLeft.x, area.x + EDGE_PADDING);
  assert.equal(stuckLeft.y, area.y + EDGE_PADDING);
  assert.equal(stuckLeft.width, WINDOW_WIDTH);
  assert.equal(stuckLeft.height, DEFAULT_BAR_HEIGHT);

  const underLeftDock = clampBoundsToWorkArea({ x: 12, y: 200, width: WINDOW_WIDTH, height: DEFAULT_BAR_HEIGHT }, area);
  assert.equal(underLeftDock.x, area.x + EDGE_PADDING);
  assert.equal(underLeftDock.y, 200);

  const overflowRightBottom = clampBoundsToWorkArea({ x: 1800, y: 1400, width: WINDOW_WIDTH, height: 420 }, area);
  assert.equal(overflowRightBottom.x, area.x + area.width - EDGE_PADDING - WINDOW_WIDTH);
  assert.equal(overflowRightBottom.y, area.y + area.height - EDGE_PADDING - 420);
});

test('centerBoundsInWorkArea places the window at the exact center of the desktop workArea', () => {
  const area = { x: 70, y: 32, width: 1442, height: 950 };
  const centered = centerBoundsInWorkArea(area, WINDOW_WIDTH, DEFAULT_BAR_HEIGHT);
  assert.equal(centered.x, Math.round(area.x + (area.width - WINDOW_WIDTH) / 2));
  assert.equal(centered.y, Math.round(area.y + (area.height - DEFAULT_BAR_HEIGHT) / 2));
  assert.equal(centered.width, WINDOW_WIDTH);
  assert.equal(centered.height, DEFAULT_BAR_HEIGHT);
});

test('clampDragOriginToDisplays blocks dragging into single-display left sidebar while allowing dual-display crossing', () => {
  const single = [{ workArea: { x: 72, y: 28, width: 1440, height: 954 } }];
  const singleClamped = clampDragOriginToDisplays(-200, -40, WINDOW_WIDTH, DEFAULT_BAR_HEIGHT, single);
  assert.equal(singleClamped.x, 72 + EDGE_PADDING);
  assert.equal(singleClamped.y, 28 + EDGE_PADDING);

  const dual = [
    { workArea: { x: -1920, y: 0, width: 1920, height: 1080 } },
    { workArea: { x: 0, y: 28, width: 1512, height: 954 } },
  ];
  const seamCross = clampDragOriginToDisplays(-260, 300, WINDOW_WIDTH, DEFAULT_BAR_HEIGHT, dual);
  assert.equal(seamCross.x, -260);
  assert.equal(seamCross.y, 300);

  const outerLeft = clampDragOriginToDisplays(-2400, 300, ORB_WINDOW, ORB_WINDOW, dual);
  assert.equal(outerLeft.x, -1920 + EDGE_PADDING);
});

test('boundsVisible requires meaningful overlap with a display workArea', () => {
  const displays = [{ workArea: { x: 76, y: 32, width: 1436, height: 950 } }];
  assert.equal(boundsVisible({ x: -460, y: 200, width: WINDOW_WIDTH, height: DEFAULT_BAR_HEIGHT }, displays), false);
  assert.equal(boundsVisible({ x: 300, y: 200, width: WINDOW_WIDTH, height: DEFAULT_BAR_HEIGHT }, displays), true);
});
