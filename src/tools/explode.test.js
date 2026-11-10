// src/tools/explode.test.js
// Explode must be reversible and readable: amount 0 puts every part exactly back,
// every direction is a unit vector, and a part sitting dead centre still moves.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPLODE_DISTANCE,
  clampExplodeAmount,
  directionFromCenter,
  explodeOffset,
  fallbackDirection,
  hasSeparableParts,
} from './explode.js';

/** @param {{ x: number, y: number, z: number }} v */
function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

test('a fallback direction is always a unit vector', () => {
  for (let index = 0; index < 6; index += 1) {
    const direction = fallbackDirection(index);
    assert.ok(Math.abs(length(direction) - 1) < 1e-9, `index ${index} must be normalized`);
    assert.ok(Number.isFinite(direction.x + direction.y + direction.z));
  }
  // Different parts must not stack on top of each other.
  assert.notDeepEqual(fallbackDirection(0), fallbackDirection(1));
});

test('a part travels along its own direction from the centre', () => {
  const direction = directionFromCenter({ x: 0, y: 2, z: 0 });
  assert.ok(Math.abs(direction.y - 1) < 1e-9);
  assert.ok(Math.abs(direction.x) < 1e-12);
  assert.ok(Math.abs(length(direction) - 1) < 1e-9);

  const diagonal = directionFromCenter({ x: 1, y: 1, z: 1 });
  assert.ok(Math.abs(length(diagonal) - 1) < 1e-9, 'diagonals are normalized too');
});

test('a centred part, or a broken one, falls back instead of standing still', () => {
  const centred = directionFromCenter({ x: 0, y: 0, z: 0 }, 3);
  assert.ok(Math.abs(length(centred) - 1) < 1e-9);
  assert.deepEqual(centred, fallbackDirection(3));

  const broken = directionFromCenter({ x: Number.NaN, y: 0, z: 0 }, 2);
  assert.deepEqual(broken, fallbackDirection(2));

  assert.deepEqual(directionFromCenter(null, 1), fallbackDirection(1));
});

test('amount 0 produces exactly zero, so a restore is bit-for-bit', () => {
  const offset = explodeOffset({ x: 0.4, y: 0.2, z: -0.1 }, 0);
  assert.deepEqual(offset, { x: 0, y: 0, z: 0 });
  assert.equal(Object.is(offset.x, 0), true);
});

test('amount 1 travels exactly EXPLODE_DISTANCE, and half travels half', () => {
  const full = explodeOffset({ x: 0, y: 0.5, z: 0 }, 1);
  assert.ok(Math.abs(length(full) - EXPLODE_DISTANCE) < 1e-9);

  const half = explodeOffset({ x: 0, y: 0.5, z: 0 }, 0.5);
  assert.ok(Math.abs(length(half) - EXPLODE_DISTANCE / 2) < 1e-9);

  // Same direction at both amounts.
  assert.ok(Math.abs(half.y / full.y - 0.5) < 1e-9);
});

test('out-of-range amounts clamp instead of overshooting', () => {
  const clampedHigh = explodeOffset({ x: 0, y: 1, z: 0 }, 5);
  assert.ok(Math.abs(length(clampedHigh) - EXPLODE_DISTANCE) < 1e-9);

  assert.deepEqual(explodeOffset({ x: 0, y: 1, z: 0 }, -1), { x: 0, y: 0, z: 0 });
  assert.deepEqual(explodeOffset({ x: 0, y: 1, z: 0 }, Number.NaN), { x: 0, y: 0, z: 0 });
});

test('clamping is shared with the slider', () => {
  assert.equal(clampExplodeAmount(0.25), 0.25);
  assert.equal(clampExplodeAmount(1.5), 1);
  assert.equal(clampExplodeAmount(-0.5), 0);
  assert.equal(clampExplodeAmount('0.5'), 0);
});

test('a model needs at least two parts to be worth exploding', () => {
  assert.equal(hasSeparableParts([{ x: 0, y: 0, z: 0 }]), false);
  assert.equal(hasSeparableParts([]), false);
  assert.equal(hasSeparableParts(null), false);
  assert.equal(hasSeparableParts([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]), true);
});
