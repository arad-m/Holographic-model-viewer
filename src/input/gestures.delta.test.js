// src/input/gestures.delta.test.js
// Phase 7 added two fields to GestureState.delta: dragX / dragY, the raw pinch
// travel before the rotate gain. Slice and Explode consume the vertical part, so
// the contract has to be exact - and range so has the index fingertip Inspect
// points with.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LANDMARK,
  ROTATE_GAIN,
  createEmptyGestureState,
  createGestureEngine,
} from './gestures.js';

const FRAME_MS = 1000 / 60;

/**
 * A hand whose thumb and index tips are 0.02 apart, so it reads as pinching.
 * Offsets move the whole hand, which is what a drag does.
 *
 * @param {number} offsetX
 * @param {number} offsetY
 */
function pinchingHand(offsetX = 0, offsetY = 0) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5 + offsetX, y: 0.7 + offsetY, z: 0 }));
  landmarks[LANDMARK.WRIST] = { x: 0.5 + offsetX, y: 0.8 + offsetY, z: 0 };
  landmarks[LANDMARK.MIDDLE_FINGER_MCP] = { x: 0.5 + offsetX, y: 0.7 + offsetY, z: 0 };

  // Hand size is 0.1, and the tips are 0.02 apart: ratio 0.2, well under start.
  landmarks[LANDMARK.THUMB_TIP] = { x: 0.49 + offsetX, y: 0.62 + offsetY, z: 0 };
  landmarks[LANDMARK.INDEX_FINGER_TIP] = { x: 0.51 + offsetX, y: 0.62 + offsetY, z: 0 };

  landmarks[LANDMARK.INDEX_FINGER_MCP] = { x: 0.52 + offsetX, y: 0.66 + offsetY, z: 0 };
  landmarks[LANDMARK.MIDDLE_FINGER_TIP] = { x: 0.52 + offsetX, y: 0.6 + offsetY, z: 0 };
  landmarks[LANDMARK.RING_FINGER_MCP] = { x: 0.54 + offsetX, y: 0.66 + offsetY, z: 0 };
  landmarks[LANDMARK.RING_FINGER_TIP] = { x: 0.54 + offsetX, y: 0.6 + offsetY, z: 0 };
  landmarks[LANDMARK.PINKY_MCP] = { x: 0.56 + offsetX, y: 0.67 + offsetY, z: 0 };
  landmarks[LANDMARK.PINKY_TIP] = { x: 0.56 + offsetX, y: 0.62 + offsetY, z: 0 };

  return { handedness: 'Right', landmarks };
}

/** Feed frames until the gesture is active, then return the last state. */
function activate(engine, clock, offsetX = 0, offsetY = 0) {
  let state = null;
  for (let i = 0; i < 4; i += 1) {
    clock.now += FRAME_MS;
    state = engine.update([pinchingHand(offsetX, offsetY)], {
      nowMs: clock.now,
      smoothing: 0,
    });
  }
  return state;
}

test('a neutral GestureState carries zeroed drag travel', () => {
  const empty = createEmptyGestureState();
  assert.equal(empty.delta.dragX, 0);
  assert.equal(empty.delta.dragY, 0);
});

test('a vertical pinch drag reports raw travel and the matching pitch', () => {
  const engine = createGestureEngine();
  const clock = { now: 0 };

  activate(engine, clock);
  assert.equal(engine.update([pinchingHand()], { nowMs: clock.now, smoothing: 0 }).action, 'rotate');

  // Move the hand down by 0.05 in one frame.
  clock.now += FRAME_MS;
  const state = engine.update([pinchingHand(0, 0.05)], { nowMs: clock.now, smoothing: 0 });

  assert.equal(state.action, 'rotate');
  assert.ok(Math.abs(state.delta.dragY - 0.05) < 1e-6, 'dragY is the hand travel itself');
  assert.ok(Math.abs(state.delta.dragX) < 1e-6);
  assert.ok(
    Math.abs(state.delta.rotX - 0.05 * ROTATE_GAIN) < 1e-6,
    'rotX is still derived from the same travel',
  );
});

test('a horizontal pinch drag reports dragX and turns the model', () => {
  const engine = createGestureEngine();
  const clock = { now: 0 };

  activate(engine, clock);
  clock.now += FRAME_MS;
  const state = engine.update([pinchingHand(0.04, 0)], { nowMs: clock.now, smoothing: 0 });

  assert.ok(Math.abs(state.delta.dragX - 0.04) < 1e-6);
  assert.ok(Math.abs(state.delta.dragY) < 1e-6);
  assert.ok(Math.abs(state.delta.rotY - 0.04 * ROTATE_GAIN) < 1e-6);
});

test('the index fingertip is reported, not the pinch midpoint', () => {
  const engine = createGestureEngine();
  const clock = { now: 0 };
  const state = activate(engine, clock);

  const hand = state.hands[0];
  assert.equal(hand.indexPoint.active, true);
  assert.ok(Math.abs(hand.indexPoint.tip.x - 0.51) < 1e-6, 'index tip, not the thumb');
  assert.ok(Math.abs(hand.indexPoint.tip.y - 0.62) < 1e-6);
  // The pinch point really is somewhere else, so the two cannot be confused.
  assert.ok(Math.abs(hand.pinch.point.x - 0.5) < 1e-6);
});

test('repeating the same hand pose does not repeat the last drag', () => {
  const engine = createGestureEngine();
  const clock = { now: 0 };

  activate(engine, clock);
  clock.now += FRAME_MS;
  const moved = engine.update([pinchingHand(0.04, 0)], { nowMs: clock.now, smoothing: 0 });
  assert.ok(Math.abs(moved.delta.rotY) > 0, 'the first move turns the model');

  // A quality level that skips detection re-feeds this exact sample. The grab
  // must stay latched, and the delta must be zero so the turn is not applied twice.
  clock.now += FRAME_MS;
  const held = engine.update([pinchingHand(0.04, 0)], { nowMs: clock.now, smoothing: 0 });
  assert.equal(held.action, 'rotate');
  assert.equal(held.hands.length, 1);
  assert.equal(held.delta.rotX, 0);
  assert.equal(held.delta.rotY, 0);
  assert.equal(held.delta.dragX, 0);
  assert.equal(held.delta.dragY, 0);
});

test('no drag travel is reported while nothing is pinching', () => {
  const engine = createGestureEngine();
  const clock = { now: 0 };
  const openHand = pinchingHand();
  // Push the thumb far away so this is not a pinch.
  openHand.landmarks[LANDMARK.THUMB_TIP] = { x: 0.2, y: 0.5, z: 0 };

  clock.now += FRAME_MS;
  const state = engine.update([openHand], { nowMs: clock.now, smoothing: 0 });

  assert.notEqual(state.action, 'rotate');
  assert.equal(state.delta.dragX, 0);
  assert.equal(state.delta.dragY, 0);
});

test('a hidden-tab gap re-anchors instead of flinging the model', () => {
  const engine = createGestureEngine();
  const clock = { now: 0 };
  activate(engine, clock);

  // A second later the hand is on the other side of the frame. That is a stall,
  // not a drag across the whole picture.
  clock.now += 1000;
  const state = engine.update([pinchingHand(0.4, 0)], { nowMs: clock.now, smoothing: 0 });

  assert.equal(state.action, 'rotate');
  assert.ok(Math.abs(state.delta.dragX) < 1e-6, `dragX was ${state.delta.dragX}`);
  assert.ok(Math.abs(state.delta.rotY) < 1e-6, `rotY was ${state.delta.rotY}`);
});

test('a hand that leaves and comes back does not apply the gap as a drag', () => {
  const engine = createGestureEngine();
  const clock = { now: 0 };
  activate(engine, clock);

  clock.now += FRAME_MS;
  engine.update([], { nowMs: clock.now, smoothing: 0 });

  clock.now += FRAME_MS;
  const back = engine.update([pinchingHand(0.3, 0)], { nowMs: clock.now, smoothing: 0 });

  assert.ok(Math.abs(back.delta.dragX) < 1e-6, `dragX was ${back.delta.dragX}`);
  assert.ok(Math.abs(back.delta.rotY) < 1e-6, `rotY was ${back.delta.rotY}`);
});
