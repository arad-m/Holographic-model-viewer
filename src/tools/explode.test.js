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
  fallbackDirection,
} from './explode.js';
import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { createExplodeModel } from '../render/explodeModel.js';

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

test('clamping is shared with the slider', () => {
  assert.equal(clampExplodeAmount(0.25), 0.25);
  assert.equal(clampExplodeAmount(1.5), 1);
  assert.equal(clampExplodeAmount(-0.5), 0);
  assert.equal(clampExplodeAmount('0.5'), 0);
});

test('createExplodeModel moves each part EXPLODE_DISTANCE outward and back exactly', () => {
  const wrapper = new Group();
  const left = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
  const right = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
  left.position.set(-1, 0.3, 0);
  right.position.set(1, 0.3, 0);
  wrapper.add(left, right);

  const exploded = createExplodeModel(wrapper);
  assert.equal(exploded.separable, true);

  exploded.apply(1);
  const moved = right.position.clone().sub(new Vector3(1, 0.3, 0));
  assert.ok(Math.abs(moved.length() - EXPLODE_DISTANCE) < 1e-9);
  assert.ok(left.position.x < -1 && right.position.x > 1, 'parts fly apart');

  exploded.apply(0.5);
  assert.ok(Math.abs(right.position.clone().sub(new Vector3(1, 0.3, 0)).length() - EXPLODE_DISTANCE / 2) < 1e-9);

  exploded.apply(5);
  assert.ok(Math.abs(right.position.clone().sub(new Vector3(1, 0.3, 0)).length() - EXPLODE_DISTANCE) < 1e-9);

  for (const amount of [0, -1, Number.NaN]) {
    exploded.apply(amount);
    assert.deepEqual(right.position.toArray(), [1, 0.3, 0], `amount ${amount} restores exactly`);
  }
});

test('a single mesh is not worth exploding', () => {
  const wrapper = new Group();
  wrapper.add(new Mesh(new BoxGeometry(1, 1, 1)));
  assert.equal(createExplodeModel(wrapper).separable, false);
});
