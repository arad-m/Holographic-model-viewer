// src/render/parallax.test.js
// The head-parallax maths and controller, tested without a camera: the easing
// rule, the direction of the offset, the clamp, calibration, sample rejection and
// the return to neutral when the face disappears.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { QUALITY_LEVELS } from '../perf/quality.js';
import {
  FACE_MISS_LIMIT,
  FACE_TIMEOUT_MS,
  HEAD_RANGE_X,
  HEAD_RANGE_Y,
  MAX_SAMPLE_JUMP,
  PARALLAX_LIMIT,
  approach,
  createParallax,
  headToOffset,
  shapeLean,
} from './parallax.js';

/** A neutral pose the tests can offset from. */
const NEUTRAL = { x: 0.5, y: 0.5 };

/**
 * Head positions are fractions of a normalized range, so "exactly the limit" is
 * rarely exact in floating point. Compare within a hair instead.
 * @param {number} actual @param {number} expected
 */
function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

/* ------------------------------------------------------------- approach --- */

test('approach converges on the target without overshooting', () => {
  let value = 0;
  for (let step = 0; step < 200; step += 1) {
    value = approach(value, 1, 9, 1 / 60);
    assert.ok(value <= 1, 'never passes the target');
  }
  assert.equal(value, 1, 'snaps to the exact target once it is close');
});

test('approach is frame-rate independent', () => {
  let at30 = 0;
  for (let step = 0; step < 30; step += 1) at30 = approach(at30, 1, 9, 1 / 30);

  let at60 = 0;
  for (let step = 0; step < 60; step += 1) at60 = approach(at60, 1, 9, 1 / 60);

  // One second of frames either way must land in the same place.
  assert.ok(Math.abs(at30 - at60) < 0.02, `30fps ${at30} vs 60fps ${at60}`);
});

test('approach ignores a zero or missing dt, and tolerates bad input', () => {
  assert.equal(approach(0.2, 1, 9, 0), 0.2);
  assert.equal(approach(0.2, 1, 9, Number.NaN), 0.2);
  assert.equal(approach(0.2, 1, 0, 0.016), 0.2, 'rate 0 means no movement');
  assert.equal(approach(Number.NaN, 0.5, 9, 0.016), 0.5);
  assert.equal(approach(0.5, Number.NaN, 9, 0.016), 0.5);
});

/* -------------------------------------------------------- headToOffset --- */

test('an unmoved head produces no offset', () => {
  const offset = headToOffset(NEUTRAL, NEUTRAL);
  assert.deepEqual(offset, { x: 0, y: 0 });
});

test('the camera moves opposite the head horizontally', () => {
  // Head to the user's right (+x in mirror space): the camera goes left.
  const right = headToOffset({ x: NEUTRAL.x + HEAD_RANGE_X, y: NEUTRAL.y }, NEUTRAL);
  assert.ok(right.x < 0, `expected a negative x, got ${right.x}`);
  assertClose(right.x, -PARALLAX_LIMIT);

  const left = headToOffset({ x: NEUTRAL.x - HEAD_RANGE_X, y: NEUTRAL.y }, NEUTRAL);
  assert.ok(left.x > 0, `expected a positive x, got ${left.x}`);
  assertClose(left.x, PARALLAX_LIMIT);
});

test('leaning up raises the camera', () => {
  const up = headToOffset({ x: NEUTRAL.x, y: NEUTRAL.y + HEAD_RANGE_Y }, NEUTRAL);
  assertClose(up.y, PARALLAX_LIMIT);

  const down = headToOffset({ x: NEUTRAL.x, y: NEUTRAL.y - HEAD_RANGE_Y }, NEUTRAL);
  assertClose(down.y, -PARALLAX_LIMIT);
});

test('a modest lean already produces most of the offset', () => {
  // Half the head range is a small shift in a chair. The curve lifts it past a
  // straight line, which is what makes the view react before a full lean.
  const half = headToOffset({ x: NEUTRAL.x + HEAD_RANGE_X * 0.5, y: NEUTRAL.y }, NEUTRAL);
  assert.ok(Math.abs(half.x) > PARALLAX_LIMIT * 0.5, `half lean was only ${half.x}`);
  assert.ok(Math.abs(half.x) < PARALLAX_LIMIT, 'half a lean does not hit the clamp');
  assert.ok(shapeLean(0) === 0);
  assert.ok(shapeLean(0.001) === 0, 'the dead zone ignores a twitch');
});

test('the offset is clamped, however far the head travels', () => {
  const wild = headToOffset({ x: 40, y: -40 }, NEUTRAL);
  assertClose(wild.x, -PARALLAX_LIMIT);
  assertClose(wild.y, -PARALLAX_LIMIT);

  const tiny = headToOffset({ x: 5, y: 5 }, NEUTRAL, { limit: 0.1 });
  assert.equal(tiny.x, -0.1);
  assert.equal(tiny.y, 0.1);
});

test('a missing head or neutral position cannot produce NaN', () => {
  // A missing head reads as the origin, which IS a real offset from a neutral
  // in the middle of the frame - so the assertion is "finite and clamped", not
  // "zero". A zero offset only follows when head and neutral agree.
  const noHead = headToOffset(null, NEUTRAL);
  assert.ok(Number.isFinite(noHead.x) && Number.isFinite(noHead.y));
  assert.ok(Math.abs(noHead.x) <= PARALLAX_LIMIT);

  const noNeutral = headToOffset({ x: 0.7, y: 0.6 }, null);
  assert.deepEqual(noNeutral, { x: 0, y: 0 }, 'neutral falls back to the head itself');

  const junk = headToOffset({ x: Number.NaN, y: Number.NaN }, NEUTRAL);
  assert.ok(Number.isFinite(junk.x) && Number.isFinite(junk.y), 'never NaN');
  assert.ok(Math.abs(junk.x) <= PARALLAX_LIMIT);
  assert.ok(Math.abs(junk.y) <= PARALLAX_LIMIT);
});

/* ----------------------------------------------------------- controller --- */

test('a disabled parallax never moves the camera', () => {
  const parallax = createParallax();
  assert.equal(parallax.isEnabled(), false);
  assert.equal(parallax.pushSample({ x: 0.9, y: 0.2 }, 0), false, 'samples are ignored');
  assert.deepEqual(parallax.update(1 / 60, 0), { x: 0, y: 0 });
});

test('enabling calibrates on the first sample, so the view does not jump', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);

  // The first sample anywhere becomes neutral.
  parallax.pushSample({ x: 0.72, y: 0.31 }, 1000);
  assert.equal(parallax.snapshot().needsCalibration, false);
  assert.deepEqual(parallax.snapshot().neutral, { x: 0.72, y: 0.31 });

  let offset = { x: 0, y: 0 };
  for (let step = 0; step < 60; step += 1) offset = parallax.update(1 / 60, 1000);

  assert.ok(Math.abs(offset.x) < 1e-6, 'no horizontal movement at the neutral pose');
  assert.ok(Math.abs(offset.y) < 1e-6, 'no vertical movement at the neutral pose');
});

test('a head movement eases the camera the opposite way', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);

  // Move the head to the user's right, past the sample-jump guard in steps.
  const target = NEUTRAL.x + HEAD_RANGE_X;
  let now = 0;
  for (let step = 1; step <= 10; step += 1) {
    now += 16;
    parallax.pushSample({ x: NEUTRAL.x + (target - NEUTRAL.x) * (step / 10), y: NEUTRAL.y }, now);
  }

  // Keep holding the pose: a face sample older than FACE_TIMEOUT_MS counts as
  // "no face" and the offset would ease back home while we watched it.
  const held = { x: target, y: NEUTRAL.y };
  let offset = { x: 0, y: 0 };
  for (let step = 0; step < 120; step += 1) {
    now += 16;
    parallax.pushSample(held, now);
    offset = parallax.update(1 / 60, now);
  }

  assert.ok(offset.x < -0.2, `camera should be left of neutral, got ${offset.x}`);
  assert.ok(offset.x >= -PARALLAX_LIMIT, 'but never beyond the clamp');
});

test('a wild sample is rejected instead of lurching the view', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);

  const accepted = parallax.pushSample(
    { x: NEUTRAL.x + MAX_SAMPLE_JUMP + 0.2, y: NEUTRAL.y },
    16,
  );
  assert.equal(accepted, false, 'the jump is treated as a tracking glitch');
  assert.deepEqual(parallax.snapshot().sample, NEUTRAL, 'the last good pose is kept');
});

test('recalibrate re-reads the current pose as neutral', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);
  parallax.pushSample({ x: NEUTRAL.x + 0.1, y: NEUTRAL.y }, 16);

  assert.equal(parallax.recalibrate(), true);
  assert.deepEqual(parallax.snapshot().neutral, { x: NEUTRAL.x + 0.1, y: NEUTRAL.y });

  let offset = { x: 0, y: 0 };
  let now = 16;
  for (let step = 0; step < 60; step += 1) {
    now += 16;
    offset = parallax.update(1 / 60, now);
  }
  assert.ok(Math.abs(offset.x) < 1e-6, 'the new neutral holds the camera still');
});

test('recalibrate without a face waits for the next sample', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);

  assert.equal(parallax.recalibrate(), false);
  assert.equal(parallax.snapshot().needsCalibration, true);

  parallax.pushSample({ x: 0.3, y: 0.4 }, 0);
  assert.equal(parallax.snapshot().needsCalibration, false);
  assert.deepEqual(parallax.snapshot().neutral, { x: 0.3, y: 0.4 });
});

test('losing the face eases the camera back to neutral', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);
  parallax.pushSample({ x: NEUTRAL.x + HEAD_RANGE_X * 0.9, y: NEUTRAL.y }, 16);

  let now = 16;
  let offset = { x: 0, y: 0 };
  for (let step = 0; step < 30; step += 1) {
    now += 16;
    offset = parallax.update(1 / 60, now);
  }
  assert.ok(offset.x < -0.1, 'the camera moved while the face was visible');

  // No further samples: once the timeout passes, the offset must return to zero.
  now += FACE_TIMEOUT_MS + 100;
  for (let step = 0; step < 300; step += 1) {
    now += 16;
    offset = parallax.update(1 / 60, now);
  }
  assert.equal(offset.x, 0);
  assert.equal(offset.y, 0);
});

test('hasFace reports whether a live face is driving the view', () => {
  const parallax = createParallax();
  assert.equal(parallax.hasFace(), false);

  parallax.setEnabled(true);
  assert.equal(parallax.hasFace(), false, 'enabled but no sample yet');

  parallax.pushSample(NEUTRAL, 1000);
  assert.equal(parallax.hasFace(), true, 'a stored sample counts when no clock is passed');
  assert.equal(parallax.hasFace(1000), true);
  assert.equal(
    parallax.hasFace(1000 + FACE_TIMEOUT_MS + 1),
    false,
    'a sample older than the timeout is no longer a face',
  );

  parallax.clearSample();
  assert.equal(parallax.hasFace(), false);

  parallax.pushSample(NEUTRAL, 0);
  parallax.setEnabled(false);
  assert.equal(parallax.hasFace(), false, 'switched off');
});

test('disabling clears the face and zeroes the offset immediately', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);
  parallax.pushSample({ x: NEUTRAL.x + 0.1, y: NEUTRAL.y }, 16);

  let now = 16;
  for (let step = 0; step < 60; step += 1) {
    now += 16;
    parallax.update(1 / 60, now);
  }

  parallax.setEnabled(false);
  assert.deepEqual(parallax.update(1 / 60, now), { x: 0, y: 0 });
  assert.equal(parallax.snapshot().sample, null);
});

test('setEnabled is idempotent and returns the resulting state', () => {
  const parallax = createParallax();
  assert.equal(parallax.setEnabled(true), true);
  assert.equal(parallax.setEnabled(true), true);
  assert.equal(parallax.setEnabled(false), false);
  assert.equal(parallax.setEnabled(false), false);
});

test('the controller honours a custom limit and smoothing rate', () => {
  const parallax = createParallax({ limit: 0.05, smoothing: 30 });
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);

  let now = 0;
  for (let step = 1; step <= 5; step += 1) {
    now += 16;
    parallax.pushSample({ x: NEUTRAL.x + 0.04 * step, y: NEUTRAL.y }, now);
  }
  for (let step = 0; step < 60; step += 1) {
    now += 16;
    parallax.update(1 / 60, now);
  }

  const snapshot = parallax.snapshot();
  assert.equal(snapshot.limit, 0.05);
  assert.ok(Math.abs(snapshot.x) <= 0.05 + 1e-6, 'clamped to the custom limit');
});

test('setLimit adjusts the depth and clamps it to the module maximum', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);

  // Depth slider at 0.5 -> half the maximum lean.
  assert.equal(parallax.setLimit(PARALLAX_LIMIT * 0.5), PARALLAX_LIMIT * 0.5);
  assert.equal(parallax.snapshot().limit, PARALLAX_LIMIT * 0.5);

  // Asking for more than the maximum is clamped, not honoured.
  assert.equal(parallax.setLimit(10), PARALLAX_LIMIT);

  // Zero is allowed: the feature stays on but the camera does not lean.
  assert.equal(parallax.setLimit(0), 0);

  // Junk is ignored and the previous limit survives.
  const before = parallax.snapshot().limit;
  assert.equal(parallax.setLimit(Number.NaN), before);
  assert.equal(parallax.setLimit(undefined), before);
});

test('a smaller limit produces a smaller offset for the same pose', () => {
  const target = NEUTRAL.x + HEAD_RANGE_X;
  const peak = (limit) => {
    const parallax = createParallax({ limit });
    parallax.setEnabled(true);
    parallax.pushSample(NEUTRAL, 0);
    let now = 0;
    let offset = { x: 0, y: 0 };
    for (let step = 0; step < 120; step += 1) {
      now += 16;
      parallax.pushSample({ x: target, y: NEUTRAL.y }, now);
      offset = parallax.update(1 / 60, now);
    }
    return Math.abs(offset.x);
  };

  const shallow = peak(PARALLAX_LIMIT * 0.25);
  const deep = peak(PARALLAX_LIMIT);
  assert.ok(shallow < deep * 0.5, `shallow ${shallow} should be well under deep ${deep}`);
});

test('holding a pose survives the slowest face-detection gap', () => {
  // Low quality samples the face every 500ms, which is longer than FACE_TIMEOUT_MS.
  // Without hold(), the camera would ease home in the gap and jump back on the
  // next sample. That is the jitter the throttle must not produce.
  const slowest = Math.max(...QUALITY_LEVELS.map((level) => level.faceIntervalMs));
  assert.ok(slowest > FACE_TIMEOUT_MS, 'the test only matters while Low is slower than the timeout');

  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);
  const leaned = { x: NEUTRAL.x + 0.1, y: NEUTRAL.y };
  let now = 0;
  for (let step = 0; step < 40; step += 1) {
    now += 16;
    parallax.pushSample(leaned, now);
    parallax.update(1 / 60, now);
  }
  const settled = Math.abs(parallax.snapshot().x);
  assert.ok(settled > 0.05, 'precondition: the camera has leaned');

  const gapStart = now;
  let weakest = settled;
  for (let frame = 0; frame < 40; frame += 1) {
    now = gapStart + ((frame + 1) * slowest) / 40;
    parallax.hold(now);
    weakest = Math.min(weakest, Math.abs(parallax.update(1 / 60, now).x));
  }
  assert.ok(weakest > settled * 0.9, `lean collapsed to ${weakest} across a ${slowest}ms gap`);
  assert.equal(parallax.hasFace(now), true);
});

test('one missed detection keeps the face; a second releases it', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample(NEUTRAL, 0);
  parallax.pushSample({ x: NEUTRAL.x + 0.1, y: NEUTRAL.y }, 20);

  let now = 20;
  for (let step = 0; step < 20; step += 1) {
    now += 16;
    parallax.hold(now);
    parallax.update(1 / 60, now);
  }
  assert.ok(parallax.snapshot().x < -0.01, 'precondition: the camera has leaned');

  assert.equal(parallax.pushMiss(), 1);
  now += 16;
  assert.equal(parallax.hold(now), true, 'a single miss does not release the hold');
  assert.equal(parallax.hasFace(now), true);

  assert.equal(parallax.pushMiss(), FACE_MISS_LIMIT);
  assert.equal(parallax.hold(now), false, 'the second miss releases the pose');
  assert.equal(parallax.hasFace(now), false);

  for (let step = 0; step < 180; step += 1) {
    now += 16;
    parallax.update(1 / 60, now);
  }
  assert.equal(parallax.snapshot().x, 0, 'the camera eases home after the face is lost');
  assert.equal(parallax.snapshot().y, 0);

  // A real sample after the loss starts a new hold, it does not stay released.
  parallax.pushSample({ x: NEUTRAL.x + 0.1, y: NEUTRAL.y }, now);
  assert.equal(parallax.hasFace(now), true);
});

test('hold does nothing while parallax is off or the face was never seen', () => {
  const parallax = createParallax();
  assert.equal(parallax.hold(1000), false);
  assert.equal(parallax.pushMiss(), 0);
  parallax.setEnabled(true);
  assert.equal(parallax.hold(1000), false, 'nothing to hold yet');
});

test('the snapshot is a copy, so callers cannot mutate the controller', () => {
  const parallax = createParallax();
  parallax.setEnabled(true);
  parallax.pushSample({ x: 0.4, y: 0.6 }, 0);

  const snapshot = parallax.snapshot();
  snapshot.neutral.x = 99;
  snapshot.sample.y = 99;

  assert.deepEqual(parallax.snapshot().neutral, { x: 0.4, y: 0.6 });
  assert.deepEqual(parallax.snapshot().sample, { x: 0.4, y: 0.6 });
});
