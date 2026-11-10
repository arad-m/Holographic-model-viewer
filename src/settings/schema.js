// src/settings/schema.js
// Owns: the definition of every user-facing setting - its key, label, control
// type, range and default. The settings panel builds itself from this list and
// the persistence layer validates against it, so a slider can never offer a value
// the validator would reject.
//
// Pure data + pure helpers: no DOM, no storage, no state import.

/** Groups, in the order the panel shows them. */
export const SETTINGS_GROUPS = Object.freeze([
  { id: 'gestures', label: 'Gestures' },
  { id: 'hologram', label: 'Hologram' },
  { id: 'performance', label: 'Performance' },
  { id: 'interface', label: 'Interface' },
]);

/**
 * @typedef {Object} NumberSetting
 * @property {string} key
 * @property {string} label
 * @property {'number'} type
 * @property {string} group
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {number} default
 *
 * @typedef {Object} BooleanSetting
 * @property {string} key
 * @property {string} label
 * @property {'boolean'} type
 * @property {string} group
 * @property {boolean} default
 *
 * @typedef {Object} SelectSetting
 * @property {string} key
 * @property {string} label
 * @property {'select'} type
 * @property {string} group
 * @property {ReadonlyArray<{ value: string, label: string }>} options
 * @property {string} default
 */

/** Every editable setting, in panel order. */
export const SETTINGS_SCHEMA = Object.freeze([
  {
    key: 'pinchStartThreshold',
    label: 'Pinch threshold',
    group: 'gestures',
    type: 'number',
    min: 0.1,
    max: 0.45,
    step: 0.01,
    default: 0.25,
  },
  {
    key: 'pinchReleaseThreshold',
    label: 'Pinch release',
    group: 'gestures',
    type: 'number',
    min: 0.15,
    max: 0.6,
    step: 0.01,
    default: 0.4,
  },
  {
    key: 'fistThreshold',
    label: 'Fist curl',
    group: 'gestures',
    type: 'number',
    min: 0.6,
    max: 1.3,
    step: 0.01,
    default: 0.9,
  },
  {
    key: 'gestureRotateSensitivity',
    label: 'Rotation sensitivity',
    group: 'gestures',
    type: 'number',
    min: 0.2,
    max: 3,
    step: 0.1,
    default: 1,
  },
  {
    key: 'panSensitivity',
    label: 'Pan sensitivity',
    group: 'gestures',
    type: 'number',
    min: 0.2,
    max: 3,
    step: 0.1,
    default: 1,
  },
  {
    key: 'landmarkSmoothing',
    label: 'Smoothing',
    group: 'gestures',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: 'hologramIntensity',
    label: 'Hologram intensity',
    group: 'hologram',
    type: 'number',
    min: 0.2,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: 'scanDensity',
    label: 'Scanline density',
    group: 'hologram',
    type: 'number',
    min: 6,
    max: 60,
    step: 1,
    default: 28,
  },
  {
    key: 'flicker',
    label: 'Flicker',
    group: 'hologram',
    type: 'number',
    min: 0,
    max: 0.6,
    step: 0.01,
    default: 0.14,
  },
  {
    key: 'soundVolume',
    label: 'Volume',
    group: 'interface',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.7,
  },
  {
    key: 'showHandSkeleton',
    label: 'Hand skeleton',
    group: 'interface',
    type: 'boolean',
    default: true,
  },
  {
    key: 'showDebugOverlay',
    label: 'Debug overlay',
    group: 'interface',
    type: 'boolean',
    default: true,
  },
  {
    key: 'showWebcam',
    label: 'Camera preview',
    group: 'interface',
    type: 'boolean',
    default: true,
  },
  {
    key: 'transparentScreenshots',
    label: 'Transparent shot',
    group: 'interface',
    type: 'boolean',
    default: false,
  },
  {
    key: 'recordWithWebcam',
    label: 'Record with camera',
    group: 'interface',
    type: 'boolean',
    default: false,
  },
  {
    key: 'quality',
    label: 'Quality',
    group: 'performance',
    type: 'select',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    default: 'medium',
  },
  {
    key: 'autoQuality',
    label: 'Auto quality',
    group: 'performance',
    type: 'boolean',
    default: true,
  },
  {
    key: 'showFps',
    label: 'FPS counter',
    group: 'performance',
    type: 'boolean',
    default: false,
  },
  {
    key: 'parallax',
    label: 'Head parallax',
    group: 'performance',
    type: 'boolean',
    default: false,
  },
  {
    key: 'parallaxStrength',
    label: 'Parallax depth',
    group: 'performance',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
]);

/** Setting keys the panel controls, in schema order. */
export const SCHEMA_KEYS = Object.freeze(SETTINGS_SCHEMA.map((setting) => setting.key));

/** @param {string} key */
export function findSetting(key) {
  return SETTINGS_SCHEMA.find((setting) => setting.key === key) ?? null;
}

/**
 * Coerce one raw value for one schema entry.
 * @param {NumberSetting|BooleanSetting|SelectSetting} setting
 * @param {unknown} raw
 * @returns {{ ok: true, value: number|boolean|string } | { ok: false }}
 */
export function coerceSetting(setting, raw) {
  if (setting.type === 'boolean') {
    if (raw === true || raw === 'true') return { ok: true, value: true };
    if (raw === false || raw === 'false') return { ok: true, value: false };
    return { ok: false };
  }

  // Selects are a closed set: an unknown id is rejected, so the default survives
  // rather than a value that would silently fail to apply.
  if (setting.type === 'select') {
    if (typeof raw !== 'string') return { ok: false };
    return setting.options.some((option) => option.value === raw)
      ? { ok: true, value: raw }
      : { ok: false };
  }

  // Numbers: accept a real number or a numeric string, reject NaN/Infinity/bools.
  let value = Number.NaN;
  if (typeof raw === 'number') value = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false };

  return { ok: true, value: Math.min(Math.max(value, setting.min), setting.max) };
}

/** A fresh object holding every schema default. */
export function schemaDefaults() {
  const values = {};
  for (const setting of SETTINGS_SCHEMA) values[setting.key] = setting.default;
  return values;
}
