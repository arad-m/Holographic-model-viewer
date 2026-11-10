// src/render/scene.test.js
// The camera framing rule, tested without a renderer. The bug this guards against
// is a portrait viewport (a phone) cropping the model because the vertical field
// of view is fixed and the horizontal one shrinks with the aspect ratio.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { cameraDistanceFor } from './scene.js';

const CAMERA_FOV = 40;
const FIT_WIDTH = 2.6;
const FIT_HEIGHT = 2.6;

/** Visible width at `distance` for a given aspect (perspective camera). */
function visibleWidth(distance, aspect) {
  return 2 * distance * Math.tan((CAMERA_FOV * Math.PI) / 360) * aspect;
}

function visibleHeight(distance) {
  return 2 * distance * Math.tan((CAMERA_FOV * Math.PI) / 360);
}

test('landscape viewports keep the authored framing', () => {
  const wide = cameraDistanceFor(16 / 9);
  const square = cameraDistanceFor(1);

  assert.ok(Math.abs(wide - square) < 1e-9, 'aspect >= 1 must not move the camera');
  assert.ok(visibleWidth(wide, 16 / 9) > FIT_WIDTH);
  assert.ok(visibleHeight(wide) > FIT_HEIGHT);
});

test('portrait viewports back the camera off until the model still fits across', () => {
  for (const aspect of [0.9, 0.75, 0.56, 0.5, 0.42]) {
    const distance = cameraDistanceFor(aspect);
    assert.ok(
      visibleWidth(distance, aspect) >= FIT_WIDTH - 1e-9,
      `aspect ${aspect} must still show ${FIT_WIDTH} units across`,
    );
    assert.ok(visibleHeight(distance) >= FIT_HEIGHT - 1e-9);
  }
});

test('a 390x760 phone viewport is not cropped', () => {
  const aspect = 390 / 760;
  const distance = cameraDistanceFor(aspect);

  // The model is normalized to 1.6 units, so its rotated diagonal can reach ~2.26.
  assert.ok(visibleWidth(distance, aspect) >= 2.3, 'the rotated model must fit');
  assert.ok(distance > cameraDistanceFor(1), 'a phone needs a longer dolly than a square');
});

test('distance grows monotonically as the viewport narrows', () => {
  const aspects = [2, 1.5, 1, 0.9, 0.8, 0.6, 0.5, 0.4];
  let previous = 0;
  for (const aspect of aspects) {
    const distance = cameraDistanceFor(aspect);
    assert.ok(distance >= previous - 1e-9, `distance must not shrink at aspect ${aspect}`);
    previous = distance;
  }
});

test('junk aspect ratios fall back to the authored framing', () => {
  const base = cameraDistanceFor(1);
  for (const aspect of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
    assert.equal(cameraDistanceFor(aspect), base);
  }
});
