// src/tools/modeState.test.js
// The rules that decide which mode a key picks and where a vertical drag goes.
// Both are pure, and both are what keeps the hand and mouse paths identical.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MODE,
  MODE_IDS,
  SLICE_AXES,
  TOOL_DEFAULTS,
  TOOL_MODES,
  findMode,
  isSliceAxis,
  isToolMode,
  modeForShortcut,
  shortcutIntent,
  verticalDragTarget,
} from './modeState.js';

test('there are exactly four modes, in toolbar order', () => {
  assert.deepEqual(MODE_IDS, ['orbit', 'slice', 'explode', 'inspect']);
  assert.equal(TOOL_MODES.length, 4);
  assert.equal(DEFAULT_MODE, 'orbit');
});

test('every mode has a unique 1-4 shortcut matching its position', () => {
  const shortcuts = TOOL_MODES.map((mode) => mode.shortcut);
  assert.deepEqual(shortcuts, ['1', '2', '3', '4']);
  assert.equal(new Set(shortcuts).size, shortcuts.length);
  for (const mode of TOOL_MODES) {
    assert.ok(mode.label.length > 0, 'a mode needs a label');
    assert.ok(mode.hint.length > 0, 'a mode needs a hint');
  }
});

test('findMode resolves ids and rejects anything else', () => {
  assert.equal(findMode('slice').id, 'slice');
  assert.equal(findMode('nope'), null);
  assert.equal(findMode(undefined), null);
});

test('a bare digit picks a mode only for 1-4', () => {
  assert.equal(modeForShortcut('1'), 'orbit');
  assert.equal(modeForShortcut('2'), 'slice');
  assert.equal(modeForShortcut('3'), 'explode');
  assert.equal(modeForShortcut('4'), 'inspect');
  assert.equal(modeForShortcut('5'), null);
  assert.equal(modeForShortcut('0'), null);
});

test('vertical drag routing: orbit pitches, slice and explode take it, inspect ignores it', () => {
  assert.equal(verticalDragTarget('orbit'), 'pitch');
  assert.equal(verticalDragTarget('slice'), 'slice');
  assert.equal(verticalDragTarget('explode'), 'explode');
  assert.equal(verticalDragTarget('inspect'), 'none');
  // An unknown mode must fall back to the safe, non-destructive behaviour.
  assert.equal(verticalDragTarget('bogus'), 'pitch');
});

test('guards reject unknown modes and axes', () => {
  assert.equal(isToolMode('slice'), true);
  assert.equal(isToolMode('slice '), false);
  assert.equal(isToolMode(null), false);
  for (const axis of SLICE_AXES) assert.equal(isSliceAxis(axis), true);
  assert.equal(isSliceAxis('w'), false);
});

test('shortcuts: digits 1-4 set the mode, Shift+digit sets a preset', () => {
  assert.deepEqual(shortcutIntent({ code: 'Digit3' }), { kind: 'mode', value: 'explode' });
  assert.deepEqual(shortcutIntent({ code: 'Digit1' }), { kind: 'mode', value: 'orbit' });

  // Shift keeps the presets reachable: the same digits, different intent.
  assert.deepEqual(shortcutIntent({ code: 'Digit1', shiftKey: true }), {
    kind: 'preset',
    value: '1',
  });
  assert.deepEqual(shortcutIntent({ code: 'Digit6', shiftKey: true }), {
    kind: 'preset',
    value: '6',
  });
});

test('shortcuts ignore other keys and every modifier combination', () => {
  assert.equal(shortcutIntent({ code: 'Digit5' }), null, '5 is not a mode');
  assert.equal(shortcutIntent({ code: 'Digit9' }), null);
  assert.equal(shortcutIntent({ code: 'KeyQ' }), null);
  assert.equal(shortcutIntent({ code: 'Numpad1' }), null);
  assert.equal(shortcutIntent({ code: 'Digit2', ctrlKey: true }), null);
  assert.equal(shortcutIntent({ code: 'Digit2', metaKey: true }), null);
  assert.equal(shortcutIntent({ code: 'Digit2', altKey: true }), null);
  assert.equal(shortcutIntent({}), null);
  assert.equal(shortcutIntent(null), null);
});

test('the default tool state is reset-safe', () => {
  assert.equal(TOOL_DEFAULTS.mode, 'orbit');
  assert.equal(TOOL_DEFAULTS.sliceAxis, 'x');
  assert.equal(TOOL_DEFAULTS.slicePosition, 0);
  assert.equal(TOOL_DEFAULTS.explode, 0);
  assert.equal(TOOL_DEFAULTS.inspectLabel, '');
});
