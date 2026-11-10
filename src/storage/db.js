// src/storage/db.js
// Owns: the model library's persistence. One IndexedDB database holding two
// object stores:
//
//   models  { id, name, size, type, addedAt, thumbnail }   metadata only
//   blobs   { id, blob }                                   the file itself
//
// Split on purpose: listing the library must never pull megabytes of model data
// into memory, and deleting a model is one transaction across both stores.
//
// Settings do NOT live here - they are in localStorage (storage/settings.js).
//
// Every function degrades instead of throwing: if IndexedDB is missing (private
// mode, blocked, older browser) reads resolve to empty and writes resolve to a
// failure result the UI can explain. Nothing in the app crashes because storage
// is unavailable.

export const DB_NAME = 'holographic-viewer';
export const DB_VERSION = 1;
export const MODEL_STORE = 'models';
export const BLOB_STORE = 'blobs';

/** Longest model name kept in a card. */
export const MAX_NAME_LENGTH = 120;

/** @type {Promise<IDBDatabase|null>|null} */
let connectionPromise = null;
/** @type {unknown} */
let lastOpenError = null;

/**
 * Is IndexedDB even present? Private-mode Firefox and some embedded webviews say
 * no, and touching `indexedDB` can throw in a sandboxed frame.
 * @returns {boolean}
 */
export function isIndexedDbAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Classify a storage failure so the UI can say something useful. Pure: it only
 * reads `name`/`message` off whatever was thrown.
 *
 * @param {unknown} error
 * @returns {'unavailable'|'quota'|'blocked'|'invalid'|'unknown'}
 */
export function describeStorageError(error) {
  if (!error) return 'unknown';
  const name = typeof error === 'object' && error !== null ? String(error.name ?? '') : '';
  const message = typeof error === 'object' && error !== null ? String(error.message ?? '') : '';

  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'quota';
  if (name === 'SecurityError' || name === 'NotAllowedError') return 'blocked';
  if (name === 'InvalidStateError' || name === 'VersionError') return 'unavailable';
  if (name === 'DataError' || name === 'DataCloneError') return 'invalid';
  if (name === 'UnknownError') return 'unknown';
  if (/quota|storage full|disk/i.test(message)) return 'quota';
  return 'unknown';
}

/**
 * A human sentence for a failure code.
 * @param {'unavailable'|'quota'|'blocked'|'invalid'|'unknown'} code
 * @returns {string}
 */
export function storageErrorMessage(code) {
  switch (code) {
    case 'quota':
      return 'Storage is full — delete a saved model and try again.';
    case 'blocked':
      return 'The browser is blocking storage for this page.';
    case 'invalid':
      return 'That file could not be stored.';
    case 'unavailable':
      return 'Saved models are unavailable in this browser.';
    default:
      return 'Could not reach the model library.';
  }
}

/** Open (once) and keep the connection. Resolves to null when unavailable. */
function openDatabase() {
  if (connectionPromise) return connectionPromise;

  connectionPromise = new Promise((resolve) => {
    if (!isIndexedDbAvailable()) {
      lastOpenError = new Error('IndexedDB is not available');
      resolve(null);
      return;
    }

    /** @type {IDBOpenDBRequest} */
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      lastOpenError = error;
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MODEL_STORE)) {
        const store = db.createObjectStore(MODEL_STORE, { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt');
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Another tab wants to upgrade: close so it is not blocked by us.
      db.onversionchange = () => {
        db.close();
        connectionPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      lastOpenError = request.error;
      resolve(null);
    };
    request.onblocked = () => {
      lastOpenError = new Error('IndexedDB upgrade blocked by another tab');
      resolve(null);
    };
  });

  return connectionPromise;
}

/** Diagnostics for the library panel: what went wrong opening the database. */
export function lastStorageError() {
  return lastOpenError;
}

/** Drop the connection (tests, and after `resetLibrary`). */
export function closeDatabase() {
  if (!connectionPromise) return Promise.resolve();
  return connectionPromise.then((db) => {
    connectionPromise = null;
    if (db) {
      try {
        db.close();
      } catch {
        // Closing a dead connection is not an error worth reporting.
      }
    }
  });
}

/**
 * Run `work` inside one transaction and resolve when it completes.
 * @template T
 * @param {string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => T} work
 * @returns {Promise<{ ok: true, value: T } | { ok: false, code: string }>}
 */
async function withTransaction(stores, mode, work) {
  const db = await openDatabase();
  if (!db) return { ok: false, code: 'unavailable' };

  return new Promise((resolve) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      resolve({ ok: false, code: describeStorageError(error) });
      return;
    }

    let pending = null;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, code: describeStorageError(error) });
    };

    // `work` may return a plain value (a write) or a promise of a request result
    // (a read). The transaction completes only after its requests have, so by
    // the time oncomplete fires that promise is already settled - but it still
    // has to be unwrapped, or every read would hand back the promise itself.
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      Promise.resolve(pending).then(
        (value) => resolve({ ok: true, value }),
        (error) => resolve({ ok: false, code: describeStorageError(error) }),
      );
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error);

    try {
      pending = work(tx);
    } catch (error) {
      fail(error);
    }
  });
}

/** Wrap one request in a promise that rejects with the request's error. */
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * A stable id without depending on `crypto.randomUUID` being present (it is
 * missing on non-secure origins).
 * @returns {string}
 */
export function createId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the manual form.
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `m-${Date.now().toString(36)}-${random}`;
}

/**
 * Save one model.
 *
 * @param {{ name: string, size: number, type?: string, blob: Blob, thumbnail?: string|null }} input
 * @returns {Promise<{ ok: true, record: object } | { ok: false, code: string }>}
 */
export async function putModel({ name, size, type = '', blob, thumbnail = null }) {
  if (!(blob instanceof Blob)) return { ok: false, code: 'invalid' };

  const record = {
    id: createId(),
    name: String(name || 'model').slice(0, MAX_NAME_LENGTH),
    size: Number.isFinite(size) ? Math.max(0, Math.round(size)) : blob.size,
    type: String(type || blob.type || ''),
    addedAt: Date.now(),
    thumbnail: typeof thumbnail === 'string' && thumbnail ? thumbnail : null,
  };

  const result = await withTransaction([MODEL_STORE, BLOB_STORE], 'readwrite', (tx) => {
    tx.objectStore(MODEL_STORE).put(record);
    tx.objectStore(BLOB_STORE).put({ id: record.id, blob });
    return record;
  });

  return result.ok ? { ok: true, record: result.value } : { ok: false, code: result.code };
}

/**
 * Metadata for every saved model, newest first. Never reads the blobs.
 * @returns {Promise<Array<object>>}
 */
export async function listModels() {
  const result = await withTransaction([MODEL_STORE], 'readonly', (tx) =>
    requestResult(tx.objectStore(MODEL_STORE).getAll()),
  );
  if (!result.ok) return [];
  const rows = Array.isArray(result.value) ? result.value : [];
  return rows.sort((a, b) => (b?.addedAt ?? 0) - (a?.addedAt ?? 0));
}

/**
 * The stored file, rebuilt as a File so it can go straight into the same loader
 * a fresh upload uses.
 *
 * @param {string} id
 * @returns {Promise<{ ok: true, blob: Blob } | { ok: false, code: string }>}
 */
export async function getModelBlob(id) {
  if (!id) return { ok: false, code: 'invalid' };
  const result = await withTransaction([BLOB_STORE], 'readonly', (tx) =>
    requestResult(tx.objectStore(BLOB_STORE).get(id)),
  );
  if (!result.ok) return { ok: false, code: result.code };
  const row = result.value;
  if (!row || !(row.blob instanceof Blob)) return { ok: false, code: 'invalid' };
  return { ok: true, blob: row.blob };
}

/**
 * @param {string} id
 * @returns {Promise<boolean>} true when the record is gone
 */
export async function deleteModel(id) {
  if (!id) return false;
  const result = await withTransaction([MODEL_STORE, BLOB_STORE], 'readwrite', (tx) => {
    tx.objectStore(MODEL_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
    return true;
  });
  return result.ok;
}

/** Empty the library. */
export async function clearModels() {
  const result = await withTransaction([MODEL_STORE, BLOB_STORE], 'readwrite', (tx) => {
    tx.objectStore(MODEL_STORE).clear();
    tx.objectStore(BLOB_STORE).clear();
    return true;
  });
  return result.ok;
}
