// src/tools/slice.test.js
// The slice plane and the cross-section maths, checked against a real cube where
// the right answer is known exactly: a 2x2x2 cube cut through its middle has a
// perimeter of 8, built from 8 segments of length 1.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SLICE_POSITION,
  MIN_SLICE_POSITION,
  SLICE_RANGE,
  clampExplodeAmount,
  clampSlicePosition,
  normalForAxis,
  sectionSegments,
  signedDistance,
  slicePlane,
} from './slice.js';

/** A 2x2x2 cube centred on the origin, as a flat triangle soup. */
function cubeTriangles() {
  const v = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const faces = [
    [4, 5, 6], [4, 6, 7],
    [1, 0, 3], [1, 3, 2],
    [0, 4, 7], [0, 7, 3],
    [5, 1, 2], [5, 2, 6],
    [7, 6, 2], [7, 2, 3],
    [0, 1, 5], [0, 5, 4],
  ];
  const out = [];
  for (const face of faces) {
    for (const index of face) out.push(v[index][0], v[index][1], v[index][2]);
  }
  return out;
}

function totalLength(segments) {
  let sum = 0;
  for (let i = 0; i < segments.length; i += 6) {
    sum += Math.hypot(
      segments[i + 3] - segments[i],
      segments[i + 4] - segments[i + 1],
      segments[i + 5] - segments[i + 2],
    );
  }
  return sum;
}

test('axis normals are unit vectors and a bad axis falls back to X', () => {
  assert.deepEqual(normalForAxis('x'), { x: 1, y: 0, z: 0 });
  assert.deepEqual(normalForAxis('y'), { x: 0, y: 1, z: 0 });
  assert.deepEqual(normalForAxis('z'), { x: 0, y: 0, z: 1 });
  assert.deepEqual(normalForAxis('nope'), { x: 1, y: 0, z: 0 });
});

test('a slice plane maps -1..1 onto the model half-extent', () => {
  assert.equal(slicePlane('y', 0).offset, 0);
  assert.ok(Math.abs(slicePlane('y', 1).offset - SLICE_RANGE) < 1e-12);
  assert.ok(Math.abs(slicePlane('y', -1).offset + SLICE_RANGE) < 1e-12);
  // Out of range input is clamped, not trusted.
  assert.ok(Math.abs(slicePlane('y', 9).offset - SLICE_RANGE) < 1e-12);
  assert.equal(slicePlane('y', Number.NaN).offset, 0);
  assert.equal(slicePlane('y', 0).position, 0);
});

test('signed distance is positive on the visible side of the plane', () => {
  const plane = slicePlane('y', 0);
  assert.ok(signedDistance(plane, { x: 0, y: 0.5, z: 0 }) > 0);
  assert.ok(signedDistance(plane, { x: 0, y: -0.5, z: 0 }) < 0);
  assert.equal(signedDistance(plane, { x: 0, y: 0, z: 0 }), 0);

  // A position of 0.5 puts the plane at 0.5 * SLICE_RANGE, not at 0.5 units.
  const shifted = slicePlane('y', 0.5);
  assert.ok(Math.abs(signedDistance(shifted, { x: 0, y: 0.5 * SLICE_RANGE, z: 0 })) < 1e-12);
  assert.ok(signedDistance(shifted, { x: 0, y: 0.5 * SLICE_RANGE + 0.1, z: 0 }) > 0);
});

test('a cube cut through the middle gives 8 segments of total length 8', () => {
  const cube = cubeTriangles();

  for (const axis of ['x', 'y', 'z']) {
    const segments = sectionSegments(cube, slicePlane(axis, 0));
    assert.equal(segments.length / 6, 8, `${axis} cut should have 8 segments`);
    assert.ok(Math.abs(totalLength(segments) - 8) < 1e-6, `${axis} perimeter should be 8`);

    // Every endpoint must sit ON the plane.
    for (let i = 0; i < segments.length; i += 3) {
      const point = { x: segments[i], y: segments[i + 1], z: segments[i + 2] };
      assert.ok(Math.abs(signedDistance(slicePlane(axis, 0), point)) < 1e-6);
    }
  }
});

test('an off-centre cut still lands on the plane', () => {
  const cube = cubeTriangles();
  const plane = slicePlane('x', 0.5 / SLICE_RANGE);
  const segments = sectionSegments(cube, plane);

  assert.ok(segments.length > 0, 'a cut inside the cube must produce a seam');
  for (let i = 0; i < segments.length; i += 3) {
    const point = { x: segments[i], y: segments[i + 1], z: segments[i + 2] };
    assert.ok(Math.abs(signedDistance(plane, point)) < 1e-6);
    assert.ok(Math.abs(point.x - 0.5) < 1e-6);
  }
});

test('a plane outside the model cuts nothing', () => {
  const cube = cubeTriangles();
  // Explicit planes well past the cube: SLICE_RANGE (0.85) is inside this cube,
  // because the cube is 2 units wide and the app's models are 1.6.
  assert.deepEqual(sectionSegments(cube, { normal: { x: 0, y: 1, z: 0 }, offset: 5 }), []);
  assert.deepEqual(sectionSegments(cube, { normal: { x: 1, y: 0, z: 0 }, offset: -5 }), []);
  assert.deepEqual(sectionSegments(cube, { normal: { x: 0, y: 0, z: 1 }, offset: 1.5 }), []);
});

test('a triangle lying in the plane produces no zero-length segment', () => {
  const flat = [0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.deepEqual(sectionSegments(flat, slicePlane('y', 0)), []);
});

test('empty and malformed geometry is safe', () => {
  const plane = slicePlane('y', 0);
  assert.deepEqual(sectionSegments([], plane), []);
  assert.deepEqual(sectionSegments(null, plane), []);
  assert.deepEqual(sectionSegments([0, 1], plane), []);
});

test('the output array is reused, not appended to', () => {
  const target = [9, 9, 9, 9, 9, 9];
  const first = sectionSegments(cubeTriangles(), slicePlane('y', 0), target);
  assert.equal(first, target, 'the same array comes back');
  assert.equal(first.length, 48);

  const miss = { normal: { x: 0, y: 1, z: 0 }, offset: 9 };
  const second = sectionSegments(cubeTriangles(), miss, target);
  assert.equal(second.length, 0, 'a miss clears the previous seam');
});

test('positions and amounts clamp to their ranges', () => {
  assert.equal(clampSlicePosition(0.4), 0.4);
  assert.equal(clampSlicePosition(4), MAX_SLICE_POSITION);
  assert.equal(clampSlicePosition(-4), MIN_SLICE_POSITION);
  assert.equal(clampSlicePosition(Number.NaN), 0);

  assert.equal(clampExplodeAmount(0.3), 0.3);
  assert.equal(clampExplodeAmount(9), 1);
  assert.equal(clampExplodeAmount(-9), 0);
  assert.equal(clampExplodeAmount(Number.POSITIVE_INFINITY), 0);
});
