// src/settings/settings.test.js
// The persistence contract, tested without a browser: valid values survive,
// every kind of corrupt value is dropped or clamped, and a broken localStorage
// never throws.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESET_SETTING_KEY,
  SETTINGS_STORAGE_KEY,
  loadStoredSettings,
  pickPersistable,
  sanitizeStoredSettings,
  saveSettings,
} from '../storage/settings.js';
import { SETTINGS_SCHEMA, coerceSetting, schemaDefaults } from './schema.js';
import { patchSettings, resetSettings, setTransform, state } from '../state.js';
import { attachSettingsPersistence } from './persistSettings.js';

const PRESETS = ['cyan', 'orange', 'green', 'ironman', 'wireframe', 'points'];
const OPTIONS = { presetIds: PRESETS, fallbackPreset: 'cyan' };

/** A minimal localStorage, plus install/uninstall helpers. */
function installStorage(initial = null, { throwOnSet = false } = {}) {
  const store = new Map();
  if (initial !== null) store.set(SETTINGS_STORAGE_KEY, initial);

  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      if (throwOnSet) throw new Error('QuotaExceededError');
      store.set(key, String(value));
    },
    removeItem: (key) => store.delete(key),
  };

  return {
    store,
    restore() {
      delete globalThis.localStorage;
    },
  };
}

test('every schema default is a valid value for its own schema entry', () => {
  for (const setting of SETTINGS_SCHEMA) {
    const result = coerceSetting(setting, setting.default);
    assert.equal(result.ok, true, `${setting.key} default must validate`);
    assert.equal(result.value, setting.default);
  }
});

test('valid stored numbers and booleans survive untouched', () => {
  const { values, rejected } = sanitizeStoredSettings(
    { pinchStartThreshold: 0.3, landmarkSmoothing: 0.8, showWebcam: false },
    OPTIONS,
  );

  assert.deepEqual(rejected, []);
  assert.equal(values.pinchStartThreshold, 0.3);
  assert.equal(values.landmarkSmoothing, 0.8);
  assert.equal(values.showWebcam, false);
});

test('out-of-range numbers are clamped into the schema range', () => {
  const { values } = sanitizeStoredSettings(
    { pinchStartThreshold: 99, landmarkSmoothing: -5 },
    OPTIONS,
  );

  const pinch = SETTINGS_SCHEMA.find((setting) => setting.key === 'pinchStartThreshold');
  const smoothing = SETTINGS_SCHEMA.find((setting) => setting.key === 'landmarkSmoothing');

  assert.equal(values.pinchStartThreshold, pinch.max);
  assert.equal(values.landmarkSmoothing, smoothing.min);
});

test('corrupt values are dropped, not coerced into nonsense', () => {
  const { values, rejected } = sanitizeStoredSettings(
    {
      pinchStartThreshold: 'not a number',
      landmarkSmoothing: null,
      scanDensity: Number.NaN,
      flicker: Number.POSITIVE_INFINITY,
      showWebcam: 'yes please',
      unknownSetting: 12,
    },
    OPTIONS,
  );

  assert.equal('pinchStartThreshold' in values, false);
  assert.equal('landmarkSmoothing' in values, false);
  assert.equal('scanDensity' in values, false);
  assert.equal('flicker' in values, false);
  assert.equal('showWebcam' in values, false);
  assert.equal('unknownSetting' in values, false);
  assert.equal(rejected.length, 5);
});

test('numeric strings are accepted (localStorage round-trips), junk strings are not', () => {
  const { values } = sanitizeStoredSettings(
    { pinchStartThreshold: '0.31', landmarkSmoothing: 'x', showWebcam: 'true' },
    OPTIONS,
  );

  assert.equal(values.pinchStartThreshold, 0.31);
  assert.equal('landmarkSmoothing' in values, false);
  assert.equal(values.showWebcam, true);
});

test('quality accepts only the three levels', () => {
  const quality = SETTINGS_SCHEMA.find((setting) => setting.key === 'quality');
  assert.equal(coerceSetting(quality, 'low').value, 'low');
  assert.equal(coerceSetting(quality, 'medium').value, 'medium');
  assert.equal(coerceSetting(quality, 'high').value, 'high');
  assert.equal(coerceSetting(quality, 'ultra').ok, false);
  assert.equal(coerceSetting(quality, 1).ok, false);

  const { values, rejected } = sanitizeStoredSettings({ quality: 'ultra', showFps: 'yes' }, OPTIONS);
  assert.equal('quality' in values, false);
  assert.equal('showFps' in values, false);
  assert.ok(rejected.includes('quality'));
});

test('an unknown preset id falls back to the default preset', () => {
  const { values, rejected } = sanitizeStoredSettings(
    { [PRESET_SETTING_KEY]: 'chartreuse' },
    OPTIONS,
  );

  assert.equal(values[PRESET_SETTING_KEY], 'cyan');
  assert.deepEqual(rejected, [PRESET_SETTING_KEY]);
});

test('a known preset id is kept', () => {
  const { values, rejected } = sanitizeStoredSettings({ [PRESET_SETTING_KEY]: 'ironman' }, OPTIONS);
  assert.equal(values[PRESET_SETTING_KEY], 'ironman');
  assert.deepEqual(rejected, []);
});

test('non-object payloads are ignored entirely', () => {
  for (const payload of [null, undefined, 42, 'settings', [], true]) {
    const { values } = sanitizeStoredSettings(payload, OPTIONS);
    assert.deepEqual(values, {}, `payload ${String(payload)} must be ignored`);
  }
});

test('only schema keys and the preset are persisted', () => {
  const settings = { ...schemaDefaults(), rotateSensitivity: 2, tempInternalFlag: true };
  const payload = pickPersistable(settings, 'green');

  assert.equal(payload[PRESET_SETTING_KEY], 'green');
  assert.equal(payload.pinchStartThreshold, settings.pinchStartThreshold);
  assert.equal('tempInternalFlag' in payload, false);
});

test('a save/load round trip restores exactly what was saved', () => {
  const env = installStorage();
  try {
    const settings = { ...schemaDefaults(), landmarkSmoothing: 0.85, showHandSkeleton: false };
    assert.equal(saveSettings(settings, 'points'), true);

    const { values } = loadStoredSettings(OPTIONS);
    assert.equal(values.landmarkSmoothing, 0.85);
    assert.equal(values.showHandSkeleton, false);
    assert.equal(values[PRESET_SETTING_KEY], 'points');
  } finally {
    env.restore();
  }
});

test('corrupt JSON in storage yields defaults instead of throwing', () => {
  const env = installStorage('{ this is not json');
  try {
    const { values, rejected } = loadStoredSettings(OPTIONS);
    assert.deepEqual(values, {});
    assert.deepEqual(rejected, ['<invalid json>']);
  } finally {
    env.restore();
  }
});

test('a quota error on save is swallowed', () => {
  const env = installStorage(null, { throwOnSet: true });
  try {
    assert.equal(saveSettings(schemaDefaults(), 'cyan'), false);
  } finally {
    env.restore();
  }
});

test('no localStorage at all is survivable', () => {
  assert.deepEqual(loadStoredSettings(OPTIONS).values, {});
  assert.equal(saveSettings(schemaDefaults(), 'cyan'), false);
});
test('the REAL persistence wiring writes a settings change to storage', () => {
  const env = installStorage();
  const detach = attachSettingsPersistence();
  try {
    patchSettings({ landmarkSmoothing: 0.95, hologramPreset: 'green' });

    const raw = env.store.get(SETTINGS_STORAGE_KEY);
    assert.ok(raw, 'a settings change must reach storage');

    const payload = JSON.parse(raw);
    assert.equal(payload.landmarkSmoothing, 0.95);
    assert.equal(payload[PRESET_SETTING_KEY], 'green');

    // ...and it survives the round trip through the validator.
    const { values } = loadStoredSettings(OPTIONS);
    assert.equal(values.landmarkSmoothing, 0.95);
    assert.equal(values[PRESET_SETTING_KEY], 'green');
  } finally {
    detach();
    resetSettings();
    env.restore();
  }
});

test('a state change that is not a settings change never touches storage', () => {
  const env = installStorage();
  const detach = attachSettingsPersistence();
  try {
    setTransform({ rotY: 0.5, scale: 1.2 });
    assert.equal(env.store.has(SETTINGS_STORAGE_KEY), false, 'transform writes must not persist');
  } finally {
    detach();
    env.restore();
  }
});

test('detaching the wiring stops further writes', () => {
  const env = installStorage();
  const detach = attachSettingsPersistence();
  detach();
  try {
    patchSettings({ scanDensity: 40 });
    assert.equal(env.store.has(SETTINGS_STORAGE_KEY), false);
  } finally {
    resetSettings();
    env.restore();
  }
});

test('a corrupted store still boots: bad values are dropped, the preset falls back', () => {
  const env = installStorage('{"pinchStartThreshold":"abc","hologramPreset":42,"scanDensity":null}');
  try {
    const { values, rejected } = loadStoredSettings(OPTIONS);

    assert.equal('pinchStartThreshold' in values, false);
    assert.equal('scanDensity' in values, false);
    assert.equal(values[PRESET_SETTING_KEY], 'cyan', 'an invalid preset falls back');
    assert.equal(rejected.length, 3);

    // Applying only the valid subset must leave the app usable.
    patchSettings(values);
    assert.ok(Number.isFinite(state.settings.pinchStartThreshold));
    assert.equal(state.settings.hologramPreset, 'cyan');
  } finally {
    resetSettings();
    env.restore();
  }
});
