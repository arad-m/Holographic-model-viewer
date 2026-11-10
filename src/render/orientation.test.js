import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY,
  angleOf,
  coastStep,
  rotateVector,
  tumble,
} from './orientation.js';

const UP = Object.freeze({ x: 0, y: 1, z: 0 });

test('a tilt past the old pitch limit turns the model over', () => {
  const q = tumble(IDENTITY, 2.5, 0);
  const up = rotateVector(q, UP);
  assert.ok(up.y < 0, `up.y was ${up.y}`);
});

test('after a tilt, a sideways turn moves a new axis', () => {
  const tilted = tumble(IDENTITY, 1, 0);
  const before = rotateVector(tilted, UP);
  const turned = tumble(tilted, 0, 1);
  const after = rotateVector(turned, UP);
  assert.ok(Math.abs(before.x) < 1e-6, 'a pure tilt stays in the vertical plane');
  assert.ok(Math.abs(after.x) > 0.2, `sideways after a tilt should roll, x was ${after.x}`);
});

test('a coast slows every frame and then sits still', () => {
  let velocity = { pitch: 2, yaw: -1 };
  let travelled = 0;
  let steps = 0;
  for (let i = 0; i < 240 && (velocity.pitch !== 0 || velocity.yaw !== 0); i += 1) {
    const step = coastStep(velocity, 1 / 60, 1.6, 0.015);
    travelled += Math.hypot(step.pitch, step.yaw);
    const nextSpeed = Math.hypot(step.velocity.pitch, step.velocity.yaw);
    const prevSpeed = Math.hypot(velocity.pitch, velocity.yaw);
    if (nextSpeed > 0) assert.ok(nextSpeed < prevSpeed, 'the throw must fade, not hold speed');
    velocity = step.velocity;
    steps += 1;
  }
  assert.ok(travelled > 0.4, 'the release actually carries the model');
  assert.ok(steps > 20, 'it does not die on the first frame');
  assert.equal(velocity.pitch, 0);
  assert.equal(velocity.yaw, 0);
  assert.equal(angleOf(IDENTITY), 0);
});
