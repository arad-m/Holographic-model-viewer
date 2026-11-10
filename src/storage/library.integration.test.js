// End-to-end tests for the model library against a real IndexedDB
// implementation (fake-indexeddb), covering the exact path the UI uses:
// save → list → read the bytes back → delete.
//
// This is what proves "models persist across reloads" without a browser: the
// records live in IndexedDB, so anything that survives a connection close is
// still there for the next page load.

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearModels,
  closeDatabase,
  deleteModel,
  getModelBlob,
  isIndexedDbAvailable,
  listModels,
  putModel,
} from './db.js';

/** @param {number[]} bytes */
function makeFile(bytes, type = 'model/gltf-binary') {
  return new Blob([new Uint8Array(bytes)], { type });
}

async function readBytes(blob) {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

test('the library round-trips a model through IndexedDB', async (t) => {
  assert.equal(isIndexedDbAvailable(), true, 'fake-indexeddb provides an implementation');
  await clearModels();
  t.after(async () => {
    await clearModels();
    await closeDatabase();
  });

  const bytes = [103, 108, 84, 70, 1, 2, 3, 4];
  const saved = await putModel({
    name: 'robot.glb',
    size: bytes.length,
    type: 'model/gltf-binary',
    blob: makeFile(bytes),
    thumbnail: 'data:image/jpeg;base64,AAAA',
  });

  assert.equal(saved.ok, true, 'the save succeeds');
  assert.equal(saved.record.name, 'robot.glb');
  assert.equal(saved.record.size, bytes.length);
  assert.equal(saved.record.addedAt > 0, true);
  assert.equal(typeof saved.record.id, 'string');

  const listed = await listModels();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, saved.record.id);
  assert.equal(listed[0].thumbnail, 'data:image/jpeg;base64,AAAA');
  // The blob lives in its own store: a listing must not carry model bytes.
  assert.equal(listed[0].blob, undefined);

  const stored = await getModelBlob(saved.record.id);
  assert.equal(stored.ok, true);
  assert.equal(stored.blob.type, 'model/gltf-binary');
  assert.deepEqual(await readBytes(stored.blob), bytes, 'the bytes come back unchanged');
});

test('records are listed newest first', async (t) => {
  await clearModels();
  t.after(async () => {
    await clearModels();
    await closeDatabase();
  });

  const first = await putModel({ name: 'one.stl', size: 1, blob: makeFile([1]) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await putModel({ name: 'two.stl', size: 1, blob: makeFile([2]) });

  const listed = await listModels();
  assert.deepEqual(
    listed.map((record) => record.name),
    ['two.stl', 'one.stl'],
  );
  assert.equal(listed[0].id, second.record.id);
  assert.equal(listed[1].id, first.record.id);
});

test('deleting a model removes both its metadata and its bytes', async (t) => {
  await clearModels();
  t.after(async () => {
    await clearModels();
    await closeDatabase();
  });

  const saved = await putModel({ name: 'gone.obj', size: 3, blob: makeFile([1, 2, 3]) });
  assert.equal(await deleteModel(saved.record.id), true);

  assert.deepEqual(await listModels(), []);
  const stored = await getModelBlob(saved.record.id);
  assert.equal(stored.ok, false, 'the bytes are gone too');
  assert.equal(stored.code, 'invalid');
});

test('the library survives a closed connection, like a page reload', async () => {
  await clearModels();
  const saved = await putModel({ name: 'persist.glb', size: 2, blob: makeFile([7, 8]) });
  assert.equal(saved.ok, true);

  // Closing the connection is what a reload effectively does; the next call
  // reopens the same database and must still find the record.
  await closeDatabase();

  const listed = await listModels();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'persist.glb');

  const stored = await getModelBlob(listed[0].id);
  assert.equal(stored.ok, true);
  assert.deepEqual(await readBytes(stored.blob), [7, 8]);

  await clearModels();
  await closeDatabase();
});

test('a deleted model leaves the neighbours alone', async (t) => {
  await clearModels();
  t.after(async () => {
    await clearModels();
    await closeDatabase();
  });

  const keep = await putModel({ name: 'keep.glb', size: 1, blob: makeFile([1]) });
  const drop = await putModel({ name: 'drop.glb', size: 1, blob: makeFile([2]) });

  await deleteModel(drop.record.id);

  const listed = await listModels();
  assert.deepEqual(
    listed.map((record) => record.id),
    [keep.record.id],
  );
  assert.equal((await getModelBlob(keep.record.id)).ok, true);
});

test('clearModels empties everything', async (t) => {
  t.after(closeDatabase);

  await putModel({ name: 'a.glb', size: 1, blob: makeFile([1]) });
  await putModel({ name: 'b.glb', size: 1, blob: makeFile([2]) });
  assert.equal((await listModels()).length >= 2, true);

  assert.equal(await clearModels(), true);
  assert.deepEqual(await listModels(), []);
});
