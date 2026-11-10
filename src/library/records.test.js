// Unit tests for the library's pure data rules: formatting, record validation,
// ordering, duplicate detection and turning a stored blob back into a File.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_RECORD_NAME,
  duplicateIds,
  fileSignature,
  formatAddedAt,
  formatBytes,
  librarySummary,
  sanitizeRecord,
  sanitizeRecords,
  signatureOf,
  sortRecordsNewestFirst,
  toFile,
} from './records.js';

test('formatBytes covers bytes, kilobytes and megabytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-10), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1 MB');
  assert.equal(formatBytes(5.5 * 1024 * 1024), '5.5 MB');
  assert.equal(formatBytes(Number.NaN), '0 B');
});

test('formatAddedAt reads relative for a week, then a date', () => {
  const now = Date.UTC(2026, 10, 4, 12, 0, 0);
  assert.equal(formatAddedAt(now - 5_000, now), 'just now');
  assert.equal(formatAddedAt(now - 70_000, now), 'a minute ago');
  assert.equal(formatAddedAt(now - 5 * 60_000, now), '5 min ago');
  assert.equal(formatAddedAt(now - 3 * 3_600_000, now), '3 hours ago');
  assert.equal(formatAddedAt(now - 26 * 3_600_000, now), 'yesterday');
  assert.equal(formatAddedAt(now - 3 * 86_400_000, now), '3 days ago');
  assert.match(formatAddedAt(now - 40 * 86_400_000, now), /\d{4}$/);
  assert.equal(formatAddedAt(0, now), 'unknown date');
  assert.equal(formatAddedAt(Number.NaN, now), 'unknown date');
});

test('sanitizeRecord rejects junk and normalises the rest', () => {
  assert.equal(sanitizeRecord(null), null);
  assert.equal(sanitizeRecord('nope'), null);
  assert.equal(sanitizeRecord([]), null);
  assert.equal(sanitizeRecord({}), null);
  assert.equal(sanitizeRecord({ id: '   ' }), null);

  const record = sanitizeRecord({
    id: ' abc ',
    name: '  robot.glb  ',
    size: '2048',
    type: 7,
    addedAt: '1700000000000',
    thumbnail: 'data:image/jpeg;base64,AAA',
  });

  assert.deepEqual(record, {
    id: 'abc',
    name: 'robot.glb',
    size: 2048,
    type: '',
    addedAt: 1700000000000,
    thumbnail: 'data:image/jpeg;base64,AAA',
  });
});

test('sanitizeRecord fills gaps and clamps a long name', () => {
  const record = sanitizeRecord({ id: 'x', name: '', size: -5, addedAt: -1, thumbnail: 42 });
  assert.equal(record.name, 'untitled');
  assert.equal(record.size, 0);
  assert.equal(record.addedAt, 0);
  assert.equal(record.thumbnail, null);

  const long = sanitizeRecord({ id: 'y', name: 'a'.repeat(500) });
  assert.equal(long.name.length, MAX_RECORD_NAME);
});

test('sanitizeRecords drops invalid rows and duplicate ids', () => {
  const rows = [
    { id: 'a', name: 'one' },
    { id: 'a', name: 'one again' },
    { id: 'b', name: 'two' },
    null,
    { name: 'no id' },
  ];
  const records = sanitizeRecords(rows);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => record.id),
    ['a', 'b'],
  );
  assert.equal(sanitizeRecords('nope').length, 0);
});

test('sortRecordsNewestFirst orders by date then id, without mutating', () => {
  const input = [
    { id: 'b', addedAt: 100 },
    { id: 'c', addedAt: 300 },
    { id: 'a', addedAt: 100 },
  ];
  const sorted = sortRecordsNewestFirst(input);
  assert.deepEqual(
    sorted.map((record) => record.id),
    ['c', 'a', 'b'],
  );
  assert.equal(input[0].id, 'b', 'the input array keeps its order');
});

test('signatureOf is case-insensitive on the name and rounds the size', () => {
  assert.equal(signatureOf({ name: ' Robot.GLB ', size: 1024.4 }), 'robot.glb::1024');
  assert.equal(signatureOf({ name: 'a', size: 'nonsense' }), 'a::0');
  assert.equal(signatureOf({}), '::0');
  assert.equal(fileSignature({ name: 'knot.glb', size: 42 }), 'knot.glb::42');
});

test('duplicateIds finds the same file and spares the newest record', () => {
  const records = [
    { id: 'new', name: 'knot.glb', size: 42, addedAt: 300 },
    { id: 'old', name: 'knot.glb', size: 42, addedAt: 100 },
    { id: 'other', name: 'torus.stl', size: 42, addedAt: 200 },
  ];
  assert.deepEqual(duplicateIds(records, 'knot.glb::42', 'new'), ['old']);
  assert.deepEqual(duplicateIds(records, '', 'new'), []);
  assert.deepEqual(duplicateIds(records, 'nothing::0', 'new'), []);
});

test('toFile rebuilds a named File with the stored bytes', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'model/gltf-binary' });
  const file = toFile({ name: 'knot.glb', type: 'model/gltf-binary' }, blob);

  assert.equal(file.name, 'knot.glb');
  assert.equal(file.type, 'model/gltf-binary');
  assert.equal(file.size, 3);
});

test('toFile falls back to a name when the record has none', () => {
  const blob = new Blob([new Uint8Array([9])]);
  const file = toFile({}, blob);
  assert.equal(file.name, 'model');
});

test('librarySummary counts models and totals their size', () => {
  assert.equal(librarySummary([]), 'No saved models');
  assert.equal(librarySummary(null), 'No saved models');
  assert.equal(librarySummary([{ size: 1024 }]), '1 model · 1 KB');
  assert.equal(
    librarySummary([{ size: 1024 }, { size: 1024 }, { size: 2048 }]),
    '3 models · 4 KB',
  );
});
