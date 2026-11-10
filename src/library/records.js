// src/library/records.js
// Owns: the pure data rules behind the model library - what a stored record must
// look like, how big it is, when it was added, which records are duplicates, and
// how a stored blob becomes a File again so a library load runs the exact same
// loader path as a fresh upload.
//
// Pure: no IndexedDB, no DOM, no state. Everything here is unit tested.

/** A record name is trimmed to this many characters before display. */
export const MAX_RECORD_NAME = 120;

/** How many duplicates of one file are allowed to accumulate. */
export const MAX_DUPLICATES = 1;

const BYTE_UNITS = Object.freeze(['B', 'KB', 'MB', 'GB']);

/**
 * 0 -> "0 B", 512 -> "512 B", 1536 -> "1.5 KB", 5 MB -> "5 MB".
 * Pure and locale-independent so the tests can pin it.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (value < 1024) return `${Math.round(value)} B`;

  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  // 1.5 rather than 1.50, 12 rather than 12.0
  const rounded = scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/**
 * Relative time for a card, or a plain date once it is a week old.
 *
 * @param {number} addedAt epoch milliseconds
 * @param {number} now epoch milliseconds, injected so this stays pure
 * @returns {string}
 */
export function formatAddedAt(addedAt, now) {
  const stamp = Number.isFinite(addedAt) ? addedAt : 0;
  const current = Number.isFinite(now) ? now : Date.now();
  if (stamp <= 0) return 'unknown date';

  const seconds = Math.max(0, Math.round((current - stamp) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  const month = date.toLocaleString('en-GB', { month: 'short' });
  return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Coerce one stored row into a record, or reject it. Storage is user-writable
 * and survives upgrades, so nothing read back is trusted.
 *
 * @param {unknown} raw
 * @returns {{ id: string, name: string, size: number, type: string, addedAt: number, thumbnail: string|null }|null}
 */
export function sanitizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = /** @type {Record<string, unknown>} */ (raw);

  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!id) return null;

  const rawName = typeof row.name === 'string' ? row.name.trim() : '';
  const name = (rawName || 'untitled').slice(0, MAX_RECORD_NAME);

  const size = Number(row.size);
  const addedAt = Number(row.addedAt);

  return {
    id,
    name,
    size: Number.isFinite(size) && size >= 0 ? Math.round(size) : 0,
    type: typeof row.type === 'string' ? row.type : '',
    addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : 0,
    thumbnail: typeof row.thumbnail === 'string' && row.thumbnail ? row.thumbnail : null,
  };
}

/**
 * Sanitise a list and drop duplicates by id (a re-opened store can report the
 * same record twice if a write was retried).
 * @param {unknown} rows
 * @returns {Array<object>}
 */
export function sanitizeRecords(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const records = [];
  for (const row of rows) {
    const record = sanitizeRecord(row);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return records;
}

/**
 * Newest first, with the id as a tie-breaker so the order never wobbles between
 * renders.
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
export function sortRecordsNewestFirst(records) {
  return [...records].sort((a, b) => {
    const delta = (b?.addedAt ?? 0) - (a?.addedAt ?? 0);
    if (delta !== 0) return delta;
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
}

/**
 * Two uploads of the same file share a name and a byte size.
 * @param {{ name?: unknown, size?: unknown }} input
 * @returns {string}
 */
export function signatureOf({ name, size } = {}) {
  const safeName = String(name ?? '').trim().toLowerCase();
  const safeSize = Number.isFinite(Number(size)) ? Math.round(Number(size)) : 0;
  return `${safeName}::${safeSize}`;
}

/**
 * @param {File} file
 * @returns {string}
 */
export function fileSignature(file) {
  return signatureOf({ name: file?.name, size: file?.size });
}

/**
 * Ids of records that hold the same file as `signature`, excluding `keepId`.
 * Used to keep one entry per file instead of one per upload.
 *
 * @param {Array<object>} records
 * @param {string} signature
 * @param {string} keepId
 * @returns {string[]}
 */
export function duplicateIds(records, signature, keepId) {
  if (!signature) return [];
  return records
    .filter((record) => record && record.id !== keepId)
    .filter((record) => signatureOf(record) === signature)
    .map((record) => record.id);
}

/**
 * Rebuild a File from a stored blob so it can be handed to the same loader a
 * dropped file goes through. `File` is missing in a few old webviews, so fall
 * back to a Blob carrying the same name property.
 *
 * @param {{ name: string, type?: string }} record
 * @param {Blob} blob
 * @returns {File|Blob}
 */
export function toFile(record, blob) {
  const name = record?.name || 'model';
  const type = record?.type || blob?.type || '';
  try {
    if (typeof File === 'function') return new File([blob], name, { type });
  } catch {
    // Fall through: the loader only needs name/size/type and the bytes.
  }
  const copy = blob.slice(0, blob.size, type);
  try {
    Object.defineProperty(copy, 'name', { value: name, configurable: true });
  } catch {
    // Not fatal: the status pill falls back to "model".
  }
  return copy;
}

/**
 * The one-line status of the library, for the panel header and the toast.
 * @param {Array<object>} records
 * @returns {string}
 */
export function librarySummary(records) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) return 'No saved models';
  const total = list.reduce((sum, record) => sum + (Number(record?.size) || 0), 0);
  const count = `${list.length} model${list.length === 1 ? '' : 's'}`;
  return `${count} · ${formatBytes(total)}`;
}
