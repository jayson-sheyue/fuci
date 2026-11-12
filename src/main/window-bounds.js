'use strict';

const WINDOW_WIDTH = 520;
const ORB_WINDOW = 116;
const DEFAULT_BAR_HEIGHT = 102;
const MIN_BAR_HEIGHT = 80;
const EDGE_PADDING = 8;

function normalizeHeight(height, areaHeight) {
  const raw = Math.max(MIN_BAR_HEIGHT, Math.round(Number(height) || DEFAULT_BAR_HEIGHT));
  if (!Number.isFinite(areaHeight) || areaHeight <= 0) return raw;
  return Math.min(raw, Math.max(96, Math.round(areaHeight) - 24));
}

function clampBoundsToWorkArea(bounds, area) {
  const nextWidth = Math.max(1, Math.round(Number(bounds?.width) || WINDOW_WIDTH));
  const nextHeight = normalizeHeight(bounds?.height, area?.height);
  if (!area || !Number.isFinite(area.x) || !Number.isFinite(area.y) || !Number.isFinite(area.width) || !Number.isFinite(area.height)) {
    return {
      x: Math.round(Number(bounds?.x) || 0),
      y: Math.round(Number(bounds?.y) || 0),
      width: nextWidth,
      height: nextHeight,
    };
  }
  const padX = area.width >= nextWidth + EDGE_PADDING * 2 ? EDGE_PADDING : 0;
  const padY = area.height >= nextHeight + EDGE_PADDING * 2 ? EDGE_PADDING : 0;
  const minX = Math.round(area.x + padX);
  const maxX = Math.max(minX, Math.round(area.x + area.width - padX - nextWidth));
  const minY = Math.round(area.y + padY);
  const maxY = Math.max(minY, Math.round(area.y + area.height - padY - nextHeight));
  const rawX = Number.isFinite(Number(bounds?.x)) ? Math.round(Number(bounds.x)) : minX;
  const rawY = Number.isFinite(Number(bounds?.y)) ? Math.round(Number(bounds.y)) : minY;
  return {
    x: Math.min(Math.max(rawX, minX), maxX),
    y: Math.min(Math.max(rawY, minY), maxY),
    width: nextWidth,
    height: nextHeight,
  };
}

function centerBoundsInWorkArea(area, width = WINDOW_WIDTH, height = DEFAULT_BAR_HEIGHT) {
  const nextWidth = Math.max(1, Math.round(Number(width) || WINDOW_WIDTH));
  const nextHeight = normalizeHeight(height, area?.height);
  const rawX = Math.round((area?.x || 0) + ((area?.width || nextWidth) - nextWidth) / 2);
  const rawY = Math.round((area?.y || 0) + ((area?.height || nextHeight) - nextHeight) / 2);
  return clampBoundsToWorkArea({
    x: rawX,
    y: rawY,
    width: nextWidth,
    height: nextHeight,
  }, area);
}

function clampDragOriginToDisplays(x, y, width, height, displays) {
  const nextX = Math.round(Number(x) || 0);
  const nextY = Math.round(Number(y) || 0);
  const nextWidth = Math.max(1, Math.round(Number(width) || WINDOW_WIDTH));
  const nextHeight = Math.max(1, Math.round(Number(height) || DEFAULT_BAR_HEIGHT));
  const areas = Array.isArray(displays)
    ? displays.map((d) => d?.workArea).filter((a) => a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.width) && Number.isFinite(a.height))
    : [];
  if (areas.length === 0) return { x: nextX, y: nextY };
  const left = Math.min(...areas.map((a) => a.x));
  const right = Math.max(...areas.map((a) => a.x + a.width));
  const top = Math.min(...areas.map((a) => a.y));
  const bottom = Math.max(...areas.map((a) => a.y + a.height));
  const spanWidth = right - left;
  const spanHeight = bottom - top;
  const padX = spanWidth >= nextWidth + EDGE_PADDING * 2 ? EDGE_PADDING : 0;
  const padY = spanHeight >= nextHeight + EDGE_PADDING * 2 ? EDGE_PADDING : 0;
  const minX = Math.round(left + padX);
  const maxX = Math.max(minX, Math.round(right - padX - nextWidth));
  const minY = Math.round(top + padY);
  const maxY = Math.max(minY, Math.round(bottom - padY - nextHeight));
  return {
    x: Math.min(Math.max(nextX, minX), maxX),
    y: Math.min(Math.max(nextY, minY), maxY),
  };
}

function boundsVisibleInArea(bounds, area) {
  const width = Math.max(80, Math.round(Number(bounds?.width) || WINDOW_WIDTH));
  const height = Math.max(40, Math.round(Number(bounds?.height) || DEFAULT_BAR_HEIGHT));
  return bounds.x < area.x + area.width - 80
    && bounds.x + width > area.x + 80
    && bounds.y < area.y + area.height - 40
    && bounds.y + height > area.y + 40;
}

function boundsVisible(bounds, displays) {
  if (!bounds || !Number.isFinite(Number(bounds.x)) || !Number.isFinite(Number(bounds.y))) return false;
  return Array.isArray(displays) && displays.some((display) => display?.workArea && boundsVisibleInArea(bounds, display.workArea));
}

module.exports = {
  WINDOW_WIDTH,
  ORB_WINDOW,
  DEFAULT_BAR_HEIGHT,
  MIN_BAR_HEIGHT,
  EDGE_PADDING,
  clampBoundsToWorkArea,
  centerBoundsInWorkArea,
  clampDragOriginToDisplays,
  boundsVisibleInArea,
  boundsVisible,
};
