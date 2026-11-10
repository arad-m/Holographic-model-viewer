// src/audio/cues.test.js
// The cue rule is the reason a sound fires once per event instead of once per
// frame, so it is tested directly: feed frame-by-frame actions, count the cues.
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { CUE, diffCues } from './cues.js';

/** Walk a list of per-frame actions through the gate, collecting every cue. */
function runFrames(actions, { resetOnFrame = -1 } = {}) {
  let previous = 'none';
  const cues = [];
  actions.forEach((action, index) => {
    for (const cue of diffCues(previous, action, index === resetOnFrame)) cues.push(cue);
    previous = action;
  });
  return cues;
}

test('no cues while idle', () => {
  assert.deepEqual(runFrames(Array(30).fill('none')), []);
});

test('a grab blips exactly once, no matter how long it is held', () => {
  const cues = runFrames(['none', 'rotate', ...Array(300).fill('rotate'), 'none']);
  assert.deepEqual(cues, [CUE.GRAB, CUE.RELEASE]);
});

test('grab and release are edge triggered, not level triggered', () => {
  assert.deepEqual(diffCues('none', 'rotate'), [CUE.GRAB]);
  assert.deepEqual(diffCues('rotate', 'rotate'), []);
  assert.deepEqual(diffCues('rotate', 'none'), [CUE.RELEASE]);
  assert.deepEqual(diffCues('none', 'none'), []);
});

test('zoom starts and stops its tone once per zoom', () => {
  const cues = runFrames(['none', 'zoom', ...Array(120).fill('zoom'), 'none']);
  assert.deepEqual(cues, [CUE.ZOOM_START, CUE.ZOOM_STOP]);
});

test('switching rotate -> zoom releases, starts the tone, and never re-grabs', () => {
  const cues = runFrames(['none', 'rotate', 'zoom', 'zoom', 'none']);
  assert.deepEqual(cues, [CUE.GRAB, CUE.RELEASE, CUE.ZOOM_START, CUE.ZOOM_STOP]);
});

test('the reset pulse fires once and only on its own frame', () => {
  const cues = runFrames(Array(20).fill('none'), { resetOnFrame: 7 });
  assert.deepEqual(cues, [CUE.RESET]);
});

test('panning and palm holds are silent in themselves', () => {
  const cues = runFrames(['pan', 'pan', 'palm-hold', 'palm-hold', 'none']);
  assert.deepEqual(cues, [], 'pan writes no cue until the palm-hold reset fires');
});

test('a noisy grab/hold/release cycle produces one pair per cycle', () => {
  const cues = runFrames([
    'none', 'rotate', 'rotate', 'none', 'none', 'rotate', 'rotate', 'none',
  ]);
  assert.deepEqual(cues, [CUE.GRAB, CUE.RELEASE, CUE.GRAB, CUE.RELEASE]);
});
