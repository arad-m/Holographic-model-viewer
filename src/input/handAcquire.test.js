// src/input/handAcquire.test.js
// The second-hand search: when it is allowed to run, and which detector mode
// follows a result.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HAND_SCAN_INTERVAL_MS,
  IMAGE_DETECT_INTERVAL_MS,
  imageDetectDue,
  nextDetectorMode,
  shouldScanForAnotherHand,
} from './handAcquire.js';

test('a search runs only while exactly one hand is tracked', () => {
  assert.equal(shouldScanForAnotherHand(0, 1000, Number.NaN, false), false);
  assert.equal(shouldScanForAnotherHand(1, 1000, Number.NaN, false), true);
  assert.equal(shouldScanForAnotherHand(2, 1000, Number.NaN, false), false);
});

test('a search waits out its interval and never overlaps another', () => {
  assert.equal(shouldScanForAnotherHand(1, 1000, 1000, false), false);
  assert.equal(
    shouldScanForAnotherHand(1, 1000 + HAND_SCAN_INTERVAL_MS, 1000, false),
    true,
  );
  assert.equal(shouldScanForAnotherHand(1, 5000, Number.NaN, true), false, 'one search at a time');
});

test('video mode stays cheap until a search is due, then looks at the whole frame', () => {
  assert.equal(nextDetectorMode('video', 1, false), 'video');
  assert.equal(nextDetectorMode('video', 1, true), 'to-image');
  assert.equal(nextDetectorMode('video', 0, true), 'to-image');
});

test('a full-frame read is skipped until its own interval has elapsed', () => {
  assert.equal(imageDetectDue(1000, Number.NaN), true, 'the first read is due');
  assert.equal(imageDetectDue(1000, 1000), false);
  assert.equal(imageDetectDue(1000 + IMAGE_DETECT_INTERVAL_MS, 1000), true);
  assert.equal(imageDetectDue(Number.NaN, 1000), false);
});

test('image mode keeps both hands live and returns to video tracking once one leaves', () => {
  assert.equal(nextDetectorMode('image', 2, false), 'image');
  assert.equal(nextDetectorMode('image', 2, true), 'image');
  assert.equal(nextDetectorMode('image', 1, false), 'to-video');
  assert.equal(nextDetectorMode('image', 0, false), 'to-video');
});
