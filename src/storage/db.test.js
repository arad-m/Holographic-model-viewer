// Unit tests for the storage layer's error handling and its no-IndexedDB path.
// There is no IndexedDB in Node, which is exactly the unsupported-browser case:
// every operation must resolve to a safe value instead of throwing.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearModels,
  closeDatabase,
  createId,
  deleteModel,
  describeStorageError,
  getModelBlob,
  isIndexedDbAvailable,
  isIndexedDbAvailable as supported,
  listModels,
  putModel,
  storageErrorMessage,
} from './db.js';

function errorNamed(name, message = '') {
  const error = new Error(message);
  error.name = name;
  return error;
}

test('describeStorageError maps the browser error names', () => {
  assert.equal(describeStorageError(errorNamed('QuotaExceededError')), 'quota');
  assert.equal(describeStorageError(errorNamed('NS_ERROR_DOM_QUOTA_REACHED')), 'quota');
  assert.equal(describeStorageError(errorNamed('SecurityError')), 'blocked');
  assert.equal(describeStorageError(errorNamed('NotAllowedError')), 'blocked');
  assert.equal(describeStorageError(errorNamed('InvalidStateError')), 'unavailable');
  assert.equal(describeStorageError(errorNamed('VersionError')), 'unavailable');
  assert.equal(describeStorageError(errorNamed('DataCloneError')), 'invalid');
  assert.equal(describeStorageError(errorNamed('UnknownError')), 'unknown');
  assert.equal(describeStorageError(new Error('the storage quota is gone')), 'quota');
  assert.equal(describeStorageError(new Error('something else')), 'unknown');
  assert.equal(describeStorageError(null), 'unknown');
  assert.equal(describeStorageError('a string'), 'unknown');
});

test('storageErrorMessage always returns a sentence', () => {
  for (const code of ['quota', 'blocked', 'invalid', 'unavailable', 'unknown', 'nonsense']) {
    const message = storageErrorMessage(code);
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 10, `${code} produces a readable message`);
  }
  assert.match(storageErrorMessage('quota'), /Storage is full/);
});

test('createId returns distinct, url-safe ids', () => {
  const first = createId();
  const second = createId();
  assert.equal(typeof first, 'string');
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9-]+$/);
});

test('without IndexedDB every read and write degrades safely', async () => {
  assert.equal(isIndexedDbAvailable(), false, 'Node has no IndexedDB');
  assert.equal(supported(), isIndexedDbAvailable());

  assert.deepEqual(await listModels(), []);

  const stored = await getModelBlob('missing');
  assert.equal(stored.ok, false);
  assert.equal(stored.code, 'unavailable');

  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'model/stl' });
  const saved = await putModel({ name: 'knot.stl', size: 3, blob });
  assert.equal(saved.ok, false);
  assert.equal(saved.code, 'unavailable');

  assert.equal(await deleteModel('missing'), false);
  assert.equal(await clearModels(), false);

  // Closing a connection that was never opened is a no-op, not a rejection.
  await closeDatabase();
});

test('putModel rejects a non-blob before touching storage', async () => {
  const saved = await putModel({ name: 'nope.glb', size: 10, blob: 'not a blob' });
  assert.equal(saved.ok, false);
  assert.equal(saved.code, 'invalid');
});

test('getModelBlob and deleteModel reject an empty id', async () => {
  assert.equal((await getModelBlob('')).code, 'invalid');
  assert.equal(await deleteModel(''), false);
});
