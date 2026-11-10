// src/storage/settings.js
// Owns: persisting settings to localStorage and - more importantly - refusing to
// trust what comes back. Every stored value is re-coerced against the schema and
// clamped into range; anything corrupt is dropped and the default survives.
//
// The sanitiser is pure (no storage, no DOM) so it can be unit tested; only the
// three wrappers touch localStorage, and each swallows storage errors so a
// private-mode browser or a full quota can never break the app.

import { SCHEMA_KEYS, SETTINGS_SCHEMA, coerceSetting } from '../settings/schema.js';

/** Storage key. Versioned so a future format change cannot be half-read. */
export const SETTINGS_STORAGE_KEY = 'holographic-viewer:settings:v1';

/** The key holding the selected hologram preset. */
export const PRESET_SETTING_KEY = 'hologramPreset';

/**
 * Validate a parsed object against the schema.
 *
 * @param {unknown} raw whatever JSON.parse produced (or any value at all)
 * @param {{ presetIds: readonly string[], fallbackPreset: string }} options
 * @returns {{ values: Record<string, number|boolean|string>, rejected: string[] }}
 *   `values` holds only keys that validated; `rejected` names the keys dropped.
 */
export function sanitizeStoredSettings(raw, { presetIds, fallbackPreset }) {
  const values = {};
  const rejected = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { values, rejected };
  }

  const record = /** @type {Record<string, unknown>} */ (raw);

  for (const setting of SETTINGS_SCHEMA) {
    if (!(setting.key in record)) continue;
    const result = coerceSetting(setting, record[setting.key]);
    if (result.ok) values[setting.key] = result.value;
    else rejected.push(setting.key);
  }

  if (PRESET_SETTING_KEY in record) {
    const preset = record[PRESET_SETTING_KEY];
    if (typeof preset === 'string' && presetIds.includes(preset)) {
      values[PRESET_SETTING_KEY] = preset;
    } else {
      rejected.push(PRESET_SETTING_KEY);
      values[PRESET_SETTING_KEY] = fallbackPreset;
    }
  }

  return { values, rejected };
}

/**
 * Only the keys we own, so unrelated state never reaches storage.
 * @param {Record<string, unknown>} settings
 * @param {string} preset
 */
export function pickPersistable(settings, preset) {
  const payload = {};
  for (const key of SCHEMA_KEYS) {
    if (key in settings) payload[key] = settings[key];
  }
  payload[PRESET_SETTING_KEY] = preset;
  return payload;
}

/**
 * Read + validate stored settings. Returns {} when there is nothing stored, when
 * storage is unavailable, or when the payload is not even JSON.
 *
 * @param {{ presetIds: readonly string[], fallbackPreset: string }} options
 * @returns {{ values: Record<string, number|boolean|string>, rejected: string[] }}
 */
export function loadStoredSettings({ presetIds, fallbackPreset }) {
  if (typeof localStorage === 'undefined') return { values: {}, rejected: [] };

  let text = null;
  try {
    text = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return { values: {}, rejected: [] };
  }
  if (!text) return { values: {}, rejected: [] };

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Corrupt JSON: keep the defaults rather than throwing on startup.
    return { values: {}, rejected: ['<invalid json>'] };
  }

  return sanitizeStoredSettings(parsed, { presetIds, fallbackPreset });
}

/**
 * @param {Record<string, unknown>} settings
 * @param {string} preset
 * @returns {boolean} true when it was written
 */
export function saveSettings(settings, preset) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(pickPersistable(settings, preset)));
    return true;
  } catch {
    // Quota exceeded / storage disabled. Persistence is a nicety, never a crash.
    return false;
  }
}

/** Forget everything stored. */
export function clearStoredSettings() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // Nothing to do: the next save will simply fail the same way.
  }
}

/** Raw stored text, for diagnostics and tests. */
export function readStoredSettingsText() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return null;
  }
}
