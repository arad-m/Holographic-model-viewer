// src/render/presets.test.js
// The preset table and the eased transition, tested without a renderer: ids,
// fallbacks, colour maths, and the guarantee that easing converges on the target
// without overshooting or flickering.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOLOGRAM_PRESETS,
  PRESET_DEFAULT,
  PRESET_IDS,
  createHologramStyle,
  findPreset,
  hexToRgb,
  rgbToHex,
} from './presets.js';

test('the six presets exist and the default is one of them', () => {
  assert.deepEqual([...PRESET_IDS], ['cyan', 'orange', 'green', 'ironman', 'wireframe', 'points']);
  assert.equal(PRESET_DEFAULT, 'cyan');
  assert.ok(PRESET_IDS.includes(PRESET_DEFAULT));

  for (const preset of HOLOGRAM_PRESETS) {
    assert.ok(preset.label, `${preset.id} needs a label`);
    assert.match(preset.shortcut, /^[1-6]$/, `${preset.id} needs a digit shortcut`);
    assert.match(preset.style.color, /^#[0-9a-f]{6}$/i, `${preset.id} needs a hex colour`);
  }
});

test('shortcuts are unique so a keypress can never be ambiguous', () => {
  const shortcuts = HOLOGRAM_PRESETS.map((preset) => preset.shortcut);
  assert.equal(new Set(shortcuts).size, shortcuts.length);
});

test('an unknown preset id falls back to the default instead of throwing', () => {
  assert.equal(findPreset('does-not-exist').id, 'cyan');
  assert.equal(findPreset(undefined).id, 'cyan');

  const style = createHologramStyle('nonsense');
  assert.equal(style.getPresetId(), 'cyan');
});

test('the structural presets are flagged', () => {
  assert.equal(findPreset('wireframe').style.wireframeOnly, true);
  assert.equal(findPreset('points').style.pointCloud, true);
  assert.equal(findPreset('cyan').style.wireframeOnly, false);
  assert.equal(findPreset('cyan').style.pointCloud, false);
});

test('colour conversions round trip', () => {
  assert.deepEqual(hexToRgb('#ff8000'), { r: 1, g: 128 / 255, b: 0 });
  assert.equal(rgbToHex(hexToRgb('#ff8000')), '#ff8000');
  assert.equal(rgbToHex({ r: 2, g: -1, b: 0.5 }), '#ff0080', 'components are clamped');
  assert.equal(rgbToHex(hexToRgb('not-a-colour')), '#ffffff', 'junk falls back to white');
});

test('switching preset moves the target and easing converges on it', () => {
  const style = createHologramStyle('cyan');
  const from = style.snapshot();

  style.setPreset('ironman');
  assert.equal(style.getPresetId(), 'ironman');
  assert.equal(style.isTransitioning(), true);

  // ~1 second of frames: the exponential has long settled.
  for (let frame = 0; frame < 60; frame += 1) style.update(1 / 60);

  const to = style.snapshot();
  const target = findPreset('ironman').style;

  assert.equal(style.isTransitioning(), false);
  assert.equal(to.color, target.color);
  assert.ok(Math.abs(to.opacity - target.opacity) < 0.01);
  assert.ok(Math.abs(to.rimIntensity - target.rimIntensity) < 0.01);
  assert.notEqual(to.color, from.color);
});

test('easing is monotonic and never overshoots the target', () => {
  const style = createHologramStyle('cyan');
  const start = style.snapshot().opacity;
  const target = findPreset('ironman').style.opacity;

  let previous = start;
  for (let frame = 0; frame < 40; frame += 1) {
    style.update(1 / 60);
    const current = style.snapshot().opacity;
    const movedTowardsTarget = target > previous ? current >= previous - 1e-9 : current <= previous + 1e-9;
    assert.ok(movedTowardsTarget, 'opacity must move towards the target, never away');
    const overshot = target > start ? current > target + 1e-6 : current < target - 1e-6;
    assert.equal(overshot, false, 'opacity must not overshoot');
    previous = current;
  }
});

test('an instant switch applies immediately', () => {
  const style = createHologramStyle('cyan');
  style.setPreset('green', { instant: true });

  const snapshot = style.snapshot();
  assert.equal(snapshot.color, findPreset('green').style.color);
  assert.equal(style.isTransitioning(), false);
});

test('structural flags switch immediately, even while colours still ease', () => {
  const style = createHologramStyle('cyan');
  style.setPreset('points');

  // No update() call at all: the flag is already live, which is what stops the
  // model from rendering points one frame too late.
  assert.equal(style.snapshot().pointCloud, true);

  style.setPreset('cyan');
  assert.equal(style.snapshot().pointCloud, false);
});

test('update ignores zero and negative dt without producing NaN', () => {
  const style = createHologramStyle('cyan');
  style.setPreset('orange');
  style.update(0);
  style.update(-1);

  const snapshot = style.snapshot();
  assert.match(snapshot.color, /^#[0-9a-f]{6}$/i);
  assert.ok(Number.isFinite(snapshot.opacity));
});
