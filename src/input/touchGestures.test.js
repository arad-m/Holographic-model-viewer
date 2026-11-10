// src/input/touchGestures.test.js
// The pure arithmetic behind touch input: centroid, span, and the delta rule -
// including the one rule that matters most, that a change in finger count is an
// anchor and never a movement.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_PINCH_SPAN_PX,
  centroid,
  emptyTouchDelta,
  sortPointers,
  span,
  touchDelta,
} from './touchGestures.js';

/** @param {number} id @param {number} x @param {number} y */
function pointer(id, x, y) {
  return { id, x, y };
}

/* --------------------------------------------------------------- shape --- */

test('an empty delta changes nothing', () => {
  assert.deepEqual(emptyTouchDelta(), { kind: 'none', dx: 0, dy: 0, zoomFactor: 1 });
});

test('malformed input yields an empty delta rather than throwing', () => {
  assert.deepEqual(touchDelta(undefined, undefined), emptyTouchDelta());
  assert.deepEqual(touchDelta(null, [pointer(1, 0, 0)]), emptyTouchDelta());
  assert.deepEqual(touchDelta([pointer(1, 0, 0)], null), emptyTouchDelta());
});

/* ------------------------------------------------------------ centroid --- */

test('centroid averages the pointer positions', () => {
  assert.deepEqual(centroid([pointer(1, 0, 0)]), { x: 0, y: 0 });
  assert.deepEqual(centroid([pointer(1, 0, 0), pointer(2, 100, 50)]), { x: 50, y: 25 });
  assert.deepEqual(
    centroid([pointer(1, 0, 0), pointer(2, 30, 30), pointer(3, 60, 60)]),
    { x: 30, y: 30 },
  );
});

test('centroid of nothing is the origin, not NaN', () => {
  assert.deepEqual(centroid([]), { x: 0, y: 0 });
  assert.deepEqual(centroid(undefined), { x: 0, y: 0 });
});

/* ---------------------------------------------------------------- span --- */

test('span is the mean distance from the centroid', () => {
  // Two fingers 100px apart: each sits 50px from the centre.
  assert.equal(span([pointer(1, 0, 0), pointer(2, 100, 0)]), 50);
  // Vertical works the same way.
  assert.equal(span([pointer(1, 0, 0), pointer(2, 0, 80)]), 40);
});

test('span of fewer than two fingers is zero', () => {
  assert.equal(span([]), 0);
  assert.equal(span([pointer(1, 10, 10)]), 0);
  assert.equal(span(undefined), 0);
});

/* ----------------------------------------------------------- the deltas --- */

test('one finger dragging produces a rotate delta', () => {
  const delta = touchDelta([pointer(1, 100, 100)], [pointer(1, 130, 90)]);
  assert.equal(delta.kind, 'rotate');
  assert.equal(delta.dx, 30);
  assert.equal(delta.dy, -10);
  assert.equal(delta.zoomFactor, 1);
});

test('two fingers dragging together pan without zooming', () => {
  const delta = touchDelta(
    [pointer(1, 0, 0), pointer(2, 100, 0)],
    [pointer(1, 20, 10), pointer(2, 120, 10)],
  );
  assert.equal(delta.kind, 'pinch');
  assert.equal(delta.dx, 20);
  assert.equal(delta.dy, 10);
  assert.equal(delta.zoomFactor, 1, 'the span did not change');
});

test('two fingers spreading apart zoom in', () => {
  const delta = touchDelta(
    [pointer(1, 0, 0), pointer(2, 100, 0)],
    [pointer(1, -50, 0), pointer(2, 150, 0)],
  );
  assert.equal(delta.kind, 'pinch');
  assert.equal(delta.dx, 0, 'the centroid stayed put');
  assert.ok(delta.zoomFactor > 1, `expected zoom in, got ${delta.zoomFactor}`);
  // Span 50 -> 100 is a clean 2x.
  assert.equal(delta.zoomFactor, 2);
});

test('two fingers closing together zoom out', () => {
  const delta = touchDelta(
    [pointer(1, 0, 0), pointer(2, 100, 0)],
    [pointer(1, 25, 0), pointer(2, 75, 0)],
  );
  assert.equal(delta.kind, 'pinch');
  assert.ok(delta.zoomFactor < 1, `expected zoom out, got ${delta.zoomFactor}`);
  assert.equal(delta.zoomFactor, 0.5);
});

test('the zoom factor is clamped so one wild frame cannot jump the scale', () => {
  const delta = touchDelta(
    [pointer(1, 0, 0), pointer(2, 100, 0)],
    [pointer(1, -500, 0), pointer(2, 500, 0)],
  );
  assert.equal(delta.zoomFactor, 2, 'never more than 2x in one frame');
});

test('a pinch below the minimum span is treated as a pan, not a zoom', () => {
  // 10px apart: under MIN_PINCH_SPAN_PX, so the ratio is noise.
  const before = [pointer(1, 0, 0), pointer(2, 10, 0)];
  const after = [pointer(1, 0, 0), pointer(2, 20, 0)];
  assert.ok(10 < MIN_PINCH_SPAN_PX);

  const delta = touchDelta(before, after);
  assert.equal(delta.zoomFactor, 1, 'no zoom from a tiny span');
});

test('adding a finger is an anchor, not a movement', () => {
  // One finger, then two: the centroid "jumps", which must not be applied.
  const delta = touchDelta([pointer(1, 0, 0)], [pointer(1, 0, 0), pointer(2, 200, 200)]);
  assert.deepEqual(delta, emptyTouchDelta());
});

test('lifting a finger is an anchor, not a movement', () => {
  const delta = touchDelta([pointer(1, 0, 0), pointer(2, 200, 200)], [pointer(1, 0, 0)]);
  assert.deepEqual(delta, emptyTouchDelta());
});

test('three fingers report a pinch, using every pointer', () => {
  const delta = touchDelta(
    [pointer(1, 0, 0), pointer(2, 100, 0), pointer(3, 50, 80)],
    [pointer(1, -20, 0), pointer(2, 120, 0), pointer(3, 50, 80)],
  );
  assert.equal(delta.kind, 'pinch');
  assert.ok(delta.zoomFactor > 1, 'the spread grew');
});

test('a still finger set produces no delta at all', () => {
  const fingers = [pointer(1, 10, 10), pointer(2, 90, 90)];
  assert.deepEqual(touchDelta(fingers, fingers.map((f) => ({ ...f }))), emptyTouchDelta());
});

/* -------------------------------------------------------- sortPointers --- */

test('sortPointers orders by id so a finger keeps its identity', () => {
  const sorted = sortPointers([pointer(3, 0, 0), pointer(1, 5, 5), pointer(2, 9, 9)]);
  assert.deepEqual(sorted.map((p) => p.id), [1, 2, 3]);
});

test('sortPointers accepts any iterable', () => {
  const map = new Map([
    [2, pointer(2, 0, 0)],
    [1, pointer(1, 0, 0)],
  ]);
  assert.deepEqual(sortPointers(map.values()).map((p) => p.id), [1, 2]);
});

test('pointer order does not change the delta', () => {
  const before = [pointer(1, 0, 0), pointer(2, 100, 0)];
  const after = [pointer(1, 10, 5), pointer(2, 110, 5)];

  const forward = touchDelta(before, after);
  const reversed = touchDelta([...before].reverse(), [...after].reverse());

  assert.equal(forward.dx, reversed.dx);
  assert.equal(forward.dy, reversed.dy);
  assert.equal(forward.zoomFactor, reversed.zoomFactor);
});
