// src/render/inspect.test.js
// Only the naming rule is tested here: raycasting needs WebGL and a DOM. Naming
// matters because most model files leave mesh names empty, and the label has to
// read sensibly instead of showing nothing.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_LABEL_LENGTH, partLabel } from './inspect.js';

test('a named mesh shows its own name', () => {
  assert.equal(partLabel('Fuselage', 0, 4), 'Fuselage');
  assert.equal(partLabel('  Wing  ', 1, 4), 'Wing', 'surrounding space is trimmed');
});

test('an unnamed single-mesh model is just "Model"', () => {
  assert.equal(partLabel('', 0, 1), 'Model');
  assert.equal(partLabel(undefined, 0, 1), 'Model');
  assert.equal(partLabel(null, 0, 1), 'Model');
  assert.equal(partLabel('   ', 0, 1), 'Model', 'whitespace counts as unnamed');
});

test('unnamed parts in a multi-mesh model are numbered 1-based', () => {
  assert.equal(partLabel('', 0, 3), 'Part 1 of 3');
  assert.equal(partLabel('', 2, 3), 'Part 3 of 3');
  assert.equal(partLabel(undefined, 1, 5), 'Part 2 of 5');
});

test('an out-of-range index cannot produce "Part 9 of 3"', () => {
  assert.equal(partLabel('', 7, 3), 'Part 3 of 3');
  assert.equal(partLabel('', -4, 3), 'Part 1 of 3');
});

test('a nonsense part count degrades to the single-part label', () => {
  assert.equal(partLabel('', 0, 0), 'Model');
  assert.equal(partLabel('', 0, Number.NaN), 'Model');
});

test('a very long name is cut to the label limit', () => {
  const longName = 'x'.repeat(200);
  const label = partLabel(longName, 0, 2);
  assert.equal(label.length, MAX_LABEL_LENGTH);
  assert.ok(label.startsWith('xxx'));
});

test('non-string names are treated as unnamed', () => {
  assert.equal(partLabel(42, 0, 2), 'Part 1 of 2');
  assert.equal(partLabel({}, 1, 2), 'Part 2 of 2');
});
