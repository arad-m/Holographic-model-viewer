// src/perf/quality.test.js
// The quality levels and the auto-downgrade watchdog, tested with no renderer:
// level lookup, the next step down, pixel ratios, detection rates, and the exact
// conditions under which the watchdog does - and does not - drop a level.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_QUALITY,
  MAX_PIXEL_RATIO,
  QUALITY_IDS,
  QUALITY_LEVELS,
  createAutoQuality,
  effectScale,
  effectivePixelRatio,
  faceDue,
  findQuality,
  handsDue,
  nextQualityDown,
} from './quality.js';

/* --------------------------------------------------------------- levels --- */

test('the levels are ordered cheapest first', () => {
  assert.deepEqual([...QUALITY_IDS], ['low', 'medium', 'high']);

  const [low, medium, high] = QUALITY_LEVELS;
  assert.ok(low.pixelRatio < medium.pixelRatio, 'pixel ratio rises');
  assert.ok(medium.pixelRatio < high.pixelRatio);
  assert.ok(low.handIntervalMs > medium.handIntervalMs, 'hand rate rises');
  assert.ok(medium.handIntervalMs > high.handIntervalMs);
  assert.equal(high.handIntervalMs, 0, 'high detects every frame');
  assert.ok(low.faceIntervalMs > medium.faceIntervalMs, 'face rate rises');
  assert.ok(low.effects < high.effects, 'effects scale rises');
});

test('every level is frozen and labelled', () => {
  for (const level of QUALITY_LEVELS) {
    assert.ok(Object.isFrozen(level));
    assert.equal(typeof level.label, 'string');
    assert.ok(level.label.length > 0);
    assert.equal(typeof level.description, 'string');
  }
});

test('findQuality falls back to the default for an unknown id', () => {
  assert.equal(findQuality('high').id, 'high');
  assert.equal(findQuality(DEFAULT_QUALITY).id, DEFAULT_QUALITY);
  assert.equal(findQuality('ultra').id, DEFAULT_QUALITY);
  assert.equal(findQuality(undefined).id, DEFAULT_QUALITY);
  assert.equal(findQuality(null).id, DEFAULT_QUALITY);
});

test('nextQualityDown walks to Low and then stops', () => {
  assert.equal(nextQualityDown('high'), 'medium');
  assert.equal(nextQualityDown('medium'), 'low');
  assert.equal(nextQualityDown('low'), null);
  assert.equal(nextQualityDown('nonsense'), null, 'an unknown id is already the bottom');
});

/* ---------------------------------------------------------- pixel ratio --- */

test('the pixel ratio never exceeds the level or the device', () => {
  assert.equal(effectivePixelRatio('high', 3), MAX_PIXEL_RATIO);
  assert.equal(effectivePixelRatio('high', 2), 2);
  assert.equal(effectivePixelRatio('medium', 3), 1.5);
  assert.equal(effectivePixelRatio('low', 3), 1);
});

test('a 1x display never gets a boosted ratio', () => {
  assert.equal(effectivePixelRatio('high', 1), 1);
  assert.equal(effectivePixelRatio('medium', 1), 1);
  assert.equal(effectivePixelRatio('low', 1), 1);
});

test('a missing or broken devicePixelRatio is treated as 1', () => {
  assert.equal(effectivePixelRatio('high', undefined), 1);
  assert.equal(effectivePixelRatio('high', 0), 1);
  assert.equal(effectivePixelRatio('high', Number.NaN), 1);
  assert.equal(effectivePixelRatio('medium', -2), 1);
});

test('effectScale follows the level', () => {
  assert.ok(effectScale('low') < effectScale('medium'));
  assert.ok(effectScale('medium') < effectScale('high'));
  assert.equal(effectScale('high'), 1);
});

/* ------------------------------------------------------- detection rates --- */

test('handsDue always allows the first detection', () => {
  for (const id of QUALITY_IDS) {
    assert.equal(handsDue(id, 1000, Number.NaN), true, id);
  }
});

test('handsDue gates detection by the level interval', () => {
  // High detects every frame, medium every 33ms, low every 66ms.
  assert.equal(handsDue('high', 1016, 1000), true);
  assert.equal(handsDue('medium', 1016, 1000), false);
  assert.equal(handsDue('medium', 1033, 1000), true);
  assert.equal(handsDue('low', 1016, 1000), false);
  assert.equal(handsDue('low', 1066, 1000), true);
});

test('faceDue is a far cheaper rate than hands', () => {
  // 100ms after the last sample: hands are due, and only High samples the face.
  assert.equal(handsDue('low', 1100, 1000), true);
  assert.equal(faceDue('high', 1100, 1000), true);
  assert.equal(faceDue('medium', 1100, 1000), false);
  assert.equal(faceDue('medium', 1180, 1000), true);
  assert.equal(faceDue('low', 1500, 1000), true);
  assert.equal(faceDue('low', 1200, 1000), false);
});

test('faceDue always allows the first detection', () => {
  for (const id of QUALITY_IDS) {
    assert.equal(faceDue(id, 0, Number.NaN), true, id);
  }
});

/* ------------------------------------------------------------- watchdog --- */

test('a healthy frame rate never downgrades', () => {
  const dropped = [];
  const watchdog = createAutoQuality({
    thresholdFps: 30,
    seconds: 5,
    startLevel: 'high',
    onDowngrade: (from, to) => dropped.push([from, to]),
  });

  for (let step = 0; step < 200; step += 1) watchdog.sample(60, step * 100);

  assert.equal(watchdog.current(), 'high');
  assert.deepEqual(dropped, []);
  assert.equal(watchdog.lastFps(), 60);
});

test('a sustained low frame rate drops exactly one level after the window', () => {
  const dropped = [];
  const watchdog = createAutoQuality({
    thresholdFps: 30,
    seconds: 5,
    startLevel: 'high',
    onDowngrade: (from, to, fps) => dropped.push({ from, to, fps }),
  });

  // The first low reading only starts the clock.
  assert.deepEqual(watchdog.sample(20, 0), { downgraded: false, level: 'high' });
  // Still inside the 5s window.
  assert.deepEqual(watchdog.sample(20, 4000), { downgraded: false, level: 'high' });
  // The window has now elapsed.
  assert.deepEqual(watchdog.sample(20, 5000), { downgraded: true, level: 'medium' });

  assert.equal(watchdog.current(), 'medium');
  assert.equal(dropped.length, 1);
  assert.deepEqual(dropped[0], { from: 'high', to: 'medium', fps: 20 });
});

test('the watchdog needs a full window, not just a low reading', () => {
  const watchdog = createAutoQuality({ thresholdFps: 30, seconds: 2, startLevel: 'high' });

  watchdog.sample(10, 0);
  assert.equal(watchdog.sample(10, 1999).downgraded, false, '1.999s is not 2s');
  assert.equal(watchdog.sample(10, 2000).downgraded, true, '2s triggers it');
});

test('a recovery before the window clears the clock', () => {
  const watchdog = createAutoQuality({ thresholdFps: 30, seconds: 2, startLevel: 'high' });

  watchdog.sample(10, 0);
  watchdog.sample(60, 1000); // healthy again
  assert.equal(watchdog.sample(10, 2000).downgraded, false, 'the window restarted');
  assert.equal(watchdog.current(), 'high');
});

test('the watchdog stops at Low and does not keep firing', () => {
  const dropped = [];
  const watchdog = createAutoQuality({
    thresholdFps: 30,
    seconds: 1,
    startLevel: 'high',
    onDowngrade: (from, to) => dropped.push([from, to]),
  });

  let now = 0;
  const fire = () => {
    watchdog.sample(5, now);
    now += 1000;
    return watchdog.sample(5, now);
  };

  assert.equal(fire().level, 'medium');
  assert.equal(fire().level, 'low');
  // At the bottom: no further callbacks, whatever the frame rate does.
  for (let step = 0; step < 10; step += 1) fire();

  assert.equal(watchdog.current(), 'low');
  assert.deepEqual(dropped, [
    ['high', 'medium'],
    ['medium', 'low'],
  ]);
});

test('a non-finite or zero frame rate is ignored', () => {
  const watchdog = createAutoQuality({ thresholdFps: 30, seconds: 1, startLevel: 'high' });

  assert.deepEqual(watchdog.sample(Number.NaN, 0), { downgraded: false, level: 'high' });
  assert.deepEqual(watchdog.sample(0, 1000), { downgraded: false, level: 'high' });
  assert.deepEqual(watchdog.sample(-5, 2000), { downgraded: false, level: 'high' });
  assert.equal(watchdog.lastFps(), 0, 'nothing was recorded');
});

test('a manual pick wins over the watchdog history', () => {
  const watchdog = createAutoQuality({ thresholdFps: 30, seconds: 1, startLevel: 'high' });

  watchdog.sample(5, 0);
  watchdog.sample(5, 1000);
  assert.equal(watchdog.current(), 'medium', 'it dropped');

  assert.equal(watchdog.setLevel('high'), 'high', 'the user takes it back');
  assert.equal(watchdog.current(), 'high');

  // The clock was reset, so one more low reading does not immediately drop it.
  assert.equal(watchdog.sample(5, 1200).downgraded, false);
});

test('setLevel ignores an unknown id', () => {
  const watchdog = createAutoQuality({ startLevel: 'medium' });
  assert.equal(watchdog.setLevel('ultra'), 'medium');
  assert.equal(watchdog.setLevel('low'), 'low');
  assert.equal(watchdog.setLevel(undefined), 'low');
});

test('an unknown starting level falls back to the default', () => {
  const watchdog = createAutoQuality({ startLevel: 'turbo' });
  assert.equal(watchdog.current(), DEFAULT_QUALITY);
});

test('the watchdog reports its own threshold', () => {
  assert.equal(createAutoQuality().thresholdFps(), 30, '30 fps by default');
  assert.equal(createAutoQuality({ thresholdFps: 45 }).thresholdFps(), 45);
  assert.equal(createAutoQuality({ thresholdFps: Number.NaN }).thresholdFps(), 30);
});
