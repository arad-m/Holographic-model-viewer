// src/input/gestures.test.js
// Unit tests for the pure gesture functions and the state machine's conflict
// rules. Run with: npm test   (node --test)
//
// Only gestures.js is exercised: no DOM, no Three.js, no MediaPipe, no camera.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVATION_FRAMES,
  FIST_THRESHOLDS,
  PALM_HOLD_MS,
  PALM_THRESHOLDS,
  PAN_GAIN,
  ROTATE_GAIN,
  createGestureEngine,
  describeActionStatus,
  describeHandStatus,
  distance2D,
  fingerExtensions,
  nextFistActive,
  nextPalmActive,
  nextPinchActive,
  resolveAction,
} from './gestures.js';

const FRAME = 1000 / 60;

/**
 * Build a synthetic 21-landmark hand.
 *   pinched -> thumb tip and index tip touch (pinch ratio 0)
 *   fist    -> all four fingertips sit on the palm centre
 *   palm    -> all four fingertips are far from the palm centre
 * x/y is the palm position, so moving it drags the whole hand.
 */
function makeHand({ x = 0.5, y = 0.5, pinched = false, fist = false } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  const tipY = fist ? y - 0.03 : y - 0.45;

  points[0] = { x, y: y + 0.3, z: 0 }; // wrist -> handSize = 0.3
  points[5] = { x: x - 0.06, y, z: 0 };
  points[9] = { x, y, z: 0 };
  points[13] = { x: x + 0.06, y, z: 0 };
  points[17] = { x: x + 0.1, y, z: 0 };
  points[8] = { x, y: tipY, z: 0 };
  points[12] = { x: x + 0.02, y: tipY, z: 0 };
  points[16] = { x: x + 0.01, y: tipY, z: 0 };
  points[20] = { x: x - 0.02, y: tipY, z: 0 };
  points[4] = pinched ? { x, y: tipY, z: 0 } : { x: x - 0.2, y, z: 0 };
  return points;
}

/* ------------------------------------------------------ pinch hysteresis --- */

test('pinch hysteresis starts low and releases high', () => {
  assert.equal(nextPinchActive(false, 0.3), false);
  assert.equal(nextPinchActive(false, 0.24), true);
  assert.equal(nextPinchActive(true, 0.3), true, 'stays latched inside the band');
  assert.equal(nextPinchActive(true, 0.4), true, 'still active at the release edge');
  assert.equal(nextPinchActive(true, 0.41), false);
  assert.equal(nextPinchActive(true, Number.POSITIVE_INFINITY), false);
});

test('pinch hysteresis accepts custom thresholds', () => {
  const custom = { start: 0.35, release: 0.5 };
  assert.equal(nextPinchActive(false, 0.34, custom), true);
  assert.equal(nextPinchActive(false, 0.4, custom), false);
  assert.equal(nextPinchActive(true, 0.48, custom), true);
  assert.equal(nextPinchActive(true, 0.51, custom), false);
});

/* ------------------------------------------------ fist / palm classification --- */

test('a fist needs every fingertip close to the palm', () => {
  const curled = [0.3, 0.4, 0.35, 0.3];
  const oneOut = [0.3, 1.2, 0.35, 0.3];
  assert.equal(nextFistActive(false, curled), true);
  assert.equal(nextFistActive(false, oneOut), false, 'one extended finger is not a fist');
  assert.equal(nextFistActive(false, []), false);
});

test('fist hysteresis holds slightly past the entry threshold', () => {
  const between = [FIST_THRESHOLDS.enter + 0.05, 0.5, 0.5, 0.5];
  assert.equal(nextFistActive(false, between), false, 'does not start in the band');
  assert.equal(nextFistActive(true, between), true, 'but keeps a held fist');
  const pastExit = [FIST_THRESHOLDS.exit + 0.05, 0.5, 0.5, 0.5];
  assert.equal(nextFistActive(true, pastExit), false, 'releases past the exit threshold');
});

test('an open palm needs every fingertip to be extended', () => {
  const open = [1.5, 1.6, 1.5, 1.3];
  const oneCurled = [1.5, 1.0, 1.5, 1.3];
  assert.equal(nextPalmActive(false, open), true);
  assert.equal(nextPalmActive(false, oneCurled), false);
  assert.equal(nextPalmActive(false, []), false);
});

test('open-palm hysteresis holds slightly below the entry threshold', () => {
  const between = [PALM_THRESHOLDS.exit + 0.05, 1.4, 1.4, 1.4];
  assert.equal(nextPalmActive(false, between), false, 'does not start in the band');
  assert.equal(nextPalmActive(true, between), true, 'keeps a held palm');
  const belowExit = [PALM_THRESHOLDS.exit - 0.05, 1.4, 1.4, 1.4];
  assert.equal(nextPalmActive(true, belowExit), false, 'releases below the exit threshold');
});

test('finger extensions are roughly 1.5 for an open hand and under 0.9 for a fist', () => {
  const open = fingerExtensions(makeHand({}));
  const fist = fingerExtensions(makeHand({ fist: true }));
  assert.equal(open.length, 4);
  assert.ok(Math.min(...open) > PALM_THRESHOLDS.enter, `open=${open.join(',')}`);
  assert.ok(Math.max(...fist) < FIST_THRESHOLDS.enter, `fist=${fist.join(',')}`);
});

/* ------------------------------------------------------------ priority rules --- */

test('priority: two-hand pinch beats everything', () => {
  assert.equal(resolveAction({ twoHandPinch: true, oneHandPinch: true, fist: true, palm: true }), 'zoom');
});

test('priority: one-hand pinch beats fist and palm', () => {
  assert.equal(resolveAction({ oneHandPinch: true, fist: true, palm: true }), 'rotate');
});

test('priority: fist beats palm', () => {
  assert.equal(resolveAction({ fist: true, palm: true }), 'pan');
});

test('priority: palm only when nothing else is active', () => {
  assert.equal(resolveAction({ palm: true }), 'palm-hold');
  assert.equal(resolveAction({}), 'none');
});

test('two open hands are reported as two hands, not one', () => {
  assert.equal(describeHandStatus({ hands: [{ pinch: { active: false } }] }), 'detected');
  assert.equal(
    describeHandStatus({ hands: [{ pinch: { active: false } }, { pinch: { active: false } }] }),
    'detected-2',
  );
  assert.equal(describeHandStatus({ hands: [] }), 'no-hand');
});

test('action status labels', () => {
  assert.equal(describeActionStatus({ action: 'rotate' }), 'grabbing');
  assert.equal(describeActionStatus({ action: 'zoom' }), 'zooming');
  assert.equal(describeActionStatus({ action: 'pan' }), 'panning');
  assert.equal(describeActionStatus({ action: 'reset' }), 'resetting');
  assert.equal(describeActionStatus({ action: 'none' }), null);
});

/* ------------------------------------------------------- engine behaviour --- */

test('an action needs a few stable frames before it activates', () => {
  const engine = createGestureEngine();
  const hand = () => [{ handedness: 'Right', landmarks: makeHand({ pinched: true }) }];

  for (let frame = 0; frame < ACTIVATION_FRAMES - 1; frame += 1) {
    const state = engine.update(hand(), { smoothing: 0, nowMs: frame * FRAME });
    assert.equal(state.action, 'none', `frame ${frame} should not be active yet`);
  }

  const active = engine.update(hand(), { smoothing: 0, nowMs: (ACTIVATION_FRAMES - 1) * FRAME });
  assert.equal(active.action, 'rotate');
  assert.equal(active.delta.rotY, 0, 'the activation frame only anchors');
});

test('a pinch never reports a fist or a palm', () => {
  const engine = createGestureEngine();
  const state = engine.update([{ handedness: 'Right', landmarks: makeHand({ pinched: true }) }], {
    smoothing: 0,
    nowMs: 0,
  });
  const hand = state.hands[0];
  assert.equal(hand.pinch.active, true);
  assert.equal(hand.fist, false);
  assert.equal(hand.openPalm, false);
});

test('rotate: one pinching hand turns the model, hand right -> +rotY', () => {
  const engine = createGestureEngine();
  let now = 0;
  const step = (x) => {
    const state = engine.update([{ handedness: 'Right', landmarks: makeHand({ x, pinched: true }) }], {
      smoothing: 0,
      nowMs: now,
    });
    now += FRAME;
    return state;
  };

  step(0.3);
  step(0.3);
  const start = step(0.3);
  assert.equal(start.action, 'rotate');
  assert.equal(start.delta.rotY, 0);

  const moved = step(0.4);
  assert.ok(Math.abs(moved.delta.rotY - 0.1 * ROTATE_GAIN) < 1e-9, `rotY=${moved.delta.rotY}`);
  assert.equal(moved.delta.rotX, 0);
});

test('fist-drag pans: hand right -> +panX, hand down -> -panY', () => {
  const engine = createGestureEngine();
  let now = 0;
  const step = (x, y) => {
    const state = engine.update([{ handedness: 'Right', landmarks: makeHand({ x, y, fist: true }) }], {
      smoothing: 0,
      nowMs: now,
    });
    now += FRAME;
    return state;
  };

  step(0.4, 0.5);
  step(0.4, 0.5);
  const start = step(0.4, 0.5);
  assert.equal(start.action, 'pan', 'fist activates after the stability gate');
  assert.ok(Math.abs(start.delta.panX) < 1e-12, 'the first pan frame only anchors');
  assert.ok(Math.abs(start.delta.panY) < 1e-12);

  const moved = step(0.5, 0.55);
  assert.ok(Math.abs(moved.delta.panX - 0.1 * PAN_GAIN) < 1e-9, `panX=${moved.delta.panX}`);
  assert.ok(Math.abs(moved.delta.panY + 0.05 * PAN_GAIN) < 1e-9, `panY=${moved.delta.panY}`);
  assert.equal(moved.delta.rotY, 0, 'a fist must not rotate');
});

test('two-hand pinch zooms relative to the distance at the start', () => {
  const engine = createGestureEngine();
  let now = 0;
  const step = (leftX, rightX) => {
    const state = engine.update(
      [
        { handedness: 'Left', landmarks: makeHand({ x: leftX, pinched: true }) },
        { handedness: 'Right', landmarks: makeHand({ x: rightX, pinched: true }) },
      ],
      { smoothing: 0, nowMs: now },
    );
    now += FRAME;
    return state;
  };

  step(0.4, 0.6);
  step(0.4, 0.6);
  const start = step(0.4, 0.6);
  assert.equal(start.action, 'zoom');
  assert.equal(start.delta.zoomFactor, 1, 'zoom starts at exactly 1');

  const apart = step(0.3, 0.7); // distance 0.2 -> 0.4
  assert.ok(Math.abs(apart.delta.zoomFactor - 2) < 1e-9, `factor=${apart.delta.zoomFactor}`);

  const together = step(0.45, 0.55); // distance 0.1
  assert.ok(Math.abs(together.delta.zoomFactor - 0.5) < 1e-9, `factor=${together.delta.zoomFactor}`);
});

test('zoom re-anchors when the pair of hands changes', () => {
  const engine = createGestureEngine();
  let now = 0;
  const step = (leftX, rightX) => {
    const state = engine.update(
      [
        { handedness: 'Left', landmarks: makeHand({ x: leftX, pinched: true }) },
        { handedness: 'Right', landmarks: makeHand({ x: rightX, pinched: true }) },
      ],
      { smoothing: 0, nowMs: now },
    );
    now += FRAME;
    return state;
  };

  step(0.4, 0.6);
  step(0.4, 0.6);
  step(0.4, 0.6);
  step(0.3, 0.7);

  // One hand drops out. Feed it past the ~150 ms dropout grace, otherwise the
  // carried pose keeps the two-hand zoom alive and it never re-anchors.
  for (let frame = 0; frame < 12; frame += 1) {
    engine.update([{ handedness: 'Left', landmarks: makeHand({ x: 0.3, pinched: true }) }], {
      smoothing: 0,
      nowMs: now,
    });
    now += FRAME;
  }
  step(0.2, 0.8);
  step(0.2, 0.8);
  const reanchored = step(0.2, 0.8);
  assert.equal(reanchored.action, 'zoom');
  assert.equal(reanchored.delta.zoomFactor, 1, 'a new pair starts from 1 again');
});

test('the higher-priority gesture wins when hands disagree', () => {
  const engine = createGestureEngine();
  let now = 0;
  const feed = () => {
    const state = engine.update(
      [
        { handedness: 'Right', landmarks: makeHand({ x: 0.3, pinched: true }) },
        { handedness: 'Left', landmarks: makeHand({ x: 0.75, fist: true }) },
      ],
      { smoothing: 0, nowMs: now },
    );
    now += FRAME;
    return state;
  };

  feed();
  feed();
  const state = feed();
  assert.equal(state.action, 'rotate', 'one-hand pinch outranks a fist');
  assert.equal(state.hands.find((hand) => hand.fist)?.fist, true);
});

test('held open palm requests exactly one reset, and needs a re-arm', () => {
  const engine = createGestureEngine();
  let now = 0;
  let requests = 0;

  const holdPalmFor = (durationMs) => {
    const end = now + durationMs;
    while (now < end) {
      const state = engine.update([{ handedness: 'Right', landmarks: makeHand({}) }], {
        smoothing: 0,
        nowMs: now,
      });
      if (state.resetRequested) requests += 1;
      now += FRAME;
    }
  };

  holdPalmFor(PALM_HOLD_MS + 300);
  assert.equal(requests, 1, `expected one reset while the palm stays open, got ${requests}`);

  // Still holding the palm: it must not fire again without being dropped.
  holdPalmFor(600);
  assert.equal(requests, 1, 'no repeat while the palm is still held');

  // Dropping the palm for a moment re-arms it.
  for (let frame = 0; frame < 6; frame += 1) {
    engine.update([{ handedness: 'Right', landmarks: makeHand({ x: 0.5, y: 0.5, fist: true }) }], {
      smoothing: 0,
      nowMs: now,
    });
    now += FRAME;
  }
  holdPalmFor(PALM_HOLD_MS + 300);
  assert.equal(requests, 2, 'a dropped and re-held palm fires again');
});

test('closing the palm early cancels the pending reset', () => {
  const engine = createGestureEngine();
  let now = 0;
  let requests = 0;

  const feed = (hand, frames) => {
    for (let frame = 0; frame < frames; frame += 1) {
      const state = engine.update([{ handedness: 'Right', landmarks: hand }], {
        smoothing: 0,
        nowMs: now,
      });
      if (state.resetRequested) requests += 1;
      now += FRAME;
    }
  };

  feed(makeHand({}), 30); // ~0.5 s of open palm
  feed(makeHand({ fist: true }), 30); // closes before the second is up
  feed(makeHand({}), 40); // reopens, but the timer restarted

  assert.equal(requests, 0, 'an interrupted hold must not reset');
});

test('switching from rotate to pan never produces a jump', () => {
  const engine = createGestureEngine();
  let now = 0;

  const rotate = engine.update([{ handedness: 'Right', landmarks: makeHand({ x: 0.3, pinched: true }) }], {
    smoothing: 0,
    nowMs: now,
  });
  now += FRAME;
  engine.update([{ handedness: 'Right', landmarks: makeHand({ x: 0.3, pinched: true }) }], {
    smoothing: 0,
    nowMs: now,
  });
  now += FRAME;
  engine.update([{ handedness: 'Right', landmarks: makeHand({ x: 0.3, pinched: true }) }], {
    smoothing: 0,
    nowMs: now,
  });
  now += FRAME;
  assert.equal(rotate.action, 'none');

  // The hand becomes a fist somewhere else on screen.
  const frames = [];
  for (let frame = 0; frame < ACTIVATION_FRAMES + 1; frame += 1) {
    frames.push(
      engine.update([{ handedness: 'Right', landmarks: makeHand({ x: 0.7, y: 0.6, fist: true }) }], {
        smoothing: 0,
        nowMs: now,
      }),
    );
    now += FRAME;
  }

  const panStart = frames[ACTIVATION_FRAMES - 1];
  assert.equal(panStart.action, 'pan');
  assert.ok(Math.abs(panStart.delta.panX) < 1e-12, 'the first pan frame only anchors');
  assert.ok(Math.abs(panStart.delta.panY) < 1e-12);
  assert.equal(frames[0].delta.rotY, 0, 'deactivation carries no rotation');
});

test('two pinch points apart and together map to zoom in and out', () => {
  const near = distance2D({ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 });
  const far = distance2D({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 });
  assert.ok(Math.abs(near - 0.2) < 1e-9);
  assert.ok(Math.abs(far - 0.6) < 1e-9);
  assert.ok(far / near > 1, 'apart zooms in');
});
