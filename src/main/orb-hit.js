'use strict';

function orbHit(x, y, width, height, hovering) {
  const cx = width / 2;
  const cy = height / 2;
  const enter = Math.min(width, height) / 2 - 6;
  const leave = Math.hypot(width, height) / 2;
  const radius = hovering ? leave : enter;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

module.exports = { orbHit };
