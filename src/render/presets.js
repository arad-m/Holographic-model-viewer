// src/render/presets.js
// Owns: the hologram style presets and the eased transition between them.
//
// A preset is a set of shader targets, not a snapshot of the scene: switching
// only moves the numbers, so it is safe while a model is loaded and while a
// gesture is mid-drag (the transform is never touched here).
//
// Transitions ease every numeric target and both colours, so a preset change
// reads as a morph rather than a pop. Structural changes (wireframe-only,
// point-cloud) switch instantly: they are material visibility flags and easing
// them would only flicker.
//
// Pure with respect to app state: the caller passes intensity/scanline/flicker.

import { getHologramMaterials } from './modelLoader.js';
import {
  ensurePointClouds,
  hasPointClouds,
  setPointCloudVisible,
  updatePointCloudMaterials,
} from './pointCloud.js';

/** The preset the app starts on. */
export const PRESET_DEFAULT = 'cyan';

/** How fast a preset transition converges, in 1/s (~0.25 s time constant). */
const TRANSITION_RATE = 6;

/**
 * @typedef {Object} PresetStyle
 * @property {string} color       base colour
 * @property {string} rimColor    rim colour (two-tone presets)
 * @property {number} rimIntensity
 * @property {number} fill
 * @property {number} opacity
 * @property {number} glitch
 * @property {number} scanScale    multiplier on the scanline-density setting
 * @property {number} flickerScale multiplier on the flicker setting
 * @property {boolean} wireframeOnly
 * @property {boolean} pointCloud
 */

/** Every preset, with the keyboard shortcut shown in the UI. */
export const HOLOGRAM_PRESETS = Object.freeze([
  {
    id: 'cyan',
    label: 'Cyan',
    shortcut: '1',
    style: {
      color: '#6fe0ff',
      rimColor: '#6fe0ff',
      rimIntensity: 1.05,
      fill: 0.07,
      opacity: 0.56,
      glitch: 0.5,
      scanScale: 1,
      flickerScale: 1,
      wireframeOnly: false,
      pointCloud: false,
    },
  },
  {
    id: 'orange',
    label: 'Orange',
    shortcut: '2',
    style: {
      color: '#ffa63d',
      rimColor: '#ff6a00',
      rimIntensity: 1.2,
      fill: 0.09,
      opacity: 0.6,
      glitch: 0.55,
      scanScale: 1.1,
      flickerScale: 1,
      wireframeOnly: false,
      pointCloud: false,
    },
  },
  {
    id: 'green',
    label: 'Green',
    shortcut: '3',
    style: {
      color: '#5cffa8',
      rimColor: '#18d97e',
      rimIntensity: 1.1,
      fill: 0.06,
      opacity: 0.54,
      glitch: 0.45,
      scanScale: 0.9,
      flickerScale: 0.9,
      wireframeOnly: false,
      pointCloud: false,
    },
  },
  {
    id: 'ironman',
    label: 'Iron Man',
    shortcut: '4',
    style: {
      color: '#ffc46b',
      rimColor: '#ff2d1f',
      rimIntensity: 1.35,
      fill: 0.12,
      opacity: 0.66,
      glitch: 0.8,
      scanScale: 1.4,
      flickerScale: 1.1,
      wireframeOnly: false,
      pointCloud: false,
    },
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    shortcut: '5',
    style: {
      color: '#8ef0ff',
      rimColor: '#8ef0ff',
      rimIntensity: 0.5,
      fill: 0.05,
      opacity: 0.4,
      glitch: 0.2,
      scanScale: 1,
      flickerScale: 0.6,
      wireframeOnly: true,
      pointCloud: false,
    },
  },
  {
    id: 'points',
    label: 'Points',
    shortcut: '6',
    style: {
      color: '#b9f0ff',
      rimColor: '#7fe0ff',
      rimIntensity: 1.1,
      fill: 0.07,
      opacity: 0.5,
      glitch: 0.3,
      scanScale: 1,
      flickerScale: 0.7,
      wireframeOnly: false,
      pointCloud: true,
    },
  },
]);

/** Preset ids, for validation. */
export const PRESET_IDS = Object.freeze(HOLOGRAM_PRESETS.map((preset) => preset.id));

/**
 * Look a preset up, falling back to the default for anything unknown.
 * @param {string} id
 */
export function findPreset(id) {
  return HOLOGRAM_PRESETS.find((preset) => preset.id === id) ?? HOLOGRAM_PRESETS[0];
}

/**
 * The eased style. `setPreset` moves the targets; `update(dt)` walks the current
 * values towards them; `snapshot()` is what gets applied to materials.
 *
 * @param {string} [initialId]
 */
export function createHologramStyle(initialId = PRESET_DEFAULT) {
  const initial = findPreset(initialId).style;

  /** @type {Record<string, number>} */
  const current = {
    rimIntensity: initial.rimIntensity,
    fill: initial.fill,
    opacity: initial.opacity,
    glitch: initial.glitch,
    scanScale: initial.scanScale,
    flickerScale: initial.flickerScale,
  };

  /** @type {Record<string, number>} */
  const target = { ...current };

  // Colours live as three components so they can be lerped without allocating.
  const currentColor = hexToRgb(initial.color);
  const targetColor = { ...currentColor };
  const currentRim = hexToRgb(initial.rimColor);
  const targetRim = { ...currentRim };

  let presetId = findPreset(initialId).id;
  let wireframeOnly = initial.wireframeOnly;
  let pointCloud = initial.pointCloud;

  /**
   * @param {string} id
   * @param {{ instant?: boolean }} [options]
   * @returns {string} the preset actually applied (falls back to the default)
   */
  function setPreset(id, { instant = false } = {}) {
    const preset = findPreset(id);
    presetId = preset.id;

    const style = preset.style;
    target.rimIntensity = style.rimIntensity;
    target.fill = style.fill;
    target.opacity = style.opacity;
    target.glitch = style.glitch;
    target.scanScale = style.scanScale;
    target.flickerScale = style.flickerScale;

    Object.assign(targetColor, hexToRgb(style.color));
    Object.assign(targetRim, hexToRgb(style.rimColor));

    // Structural flags cannot be interpolated meaningfully.
    wireframeOnly = style.wireframeOnly;
    pointCloud = style.pointCloud;

    if (instant) {
      Object.assign(current, target);
      Object.assign(currentColor, targetColor);
      Object.assign(currentRim, targetRim);
    }

    return presetId;
  }

  /** @param {number} dt seconds */
  function update(dt) {
    const step = 1 - Math.exp(-TRANSITION_RATE * Math.max(0, dt));
    for (const key of Object.keys(current)) {
      current[key] += (target[key] - current[key]) * step;
    }
    for (const key of ['r', 'g', 'b']) {
      currentColor[key] += (targetColor[key] - currentColor[key]) * step;
      currentRim[key] += (targetRim[key] - currentRim[key]) * step;
    }
  }

  /** @returns {PresetStyle} a plain object safe to hand to the renderer */
  function snapshot() {
    return {
      color: rgbToHex(currentColor),
      rimColor: rgbToHex(currentRim),
      rimIntensity: current.rimIntensity,
      fill: current.fill,
      opacity: current.opacity,
      glitch: current.glitch,
      scanScale: current.scanScale,
      flickerScale: current.flickerScale,
      wireframeOnly,
      pointCloud,
    };
  }

  return {
    setPreset,
    update,
    snapshot,
    getPresetId: () => presetId,
    isTransitioning: () =>
      Math.abs(target.opacity - current.opacity) > 0.002 ||
      Math.abs(targetColor.r - currentColor.r) > 0.002,
  };
}

/**
 * Push a snapshot onto every live material of a model, plus the structural flags.
 *
 * Setting `material.visible` (rather than `mesh.visible`) is deliberate: the
 * wireframe overlay is a CHILD of the surface mesh, so hiding the mesh would hide
 * the overlay too.
 *
 * @param {import('three').Object3D|null} root
 * @param {PresetStyle} style
 * @param {{ intensity?: number, scanDensity?: number, flicker?: number }} [settings]
 */
export function applyHologramStyle(root, style, settings = {}) {
  if (!root || !style) return;

  const intensity = clamp01to2(settings.intensity ?? 1);
  const scanDensity = Number.isFinite(settings.scanDensity) ? settings.scanDensity : 28;
  const flicker = Number.isFinite(settings.flicker) ? settings.flicker : 0.14;

  for (const material of getHologramMaterials(root)) {
    const uniforms = material?.uniforms;
    if (!uniforms) continue;

    const isWireframeShell = material.name === 'HologramWireframe';

    uniforms.uColor?.value.set(style.color);
    uniforms.uRimColor?.value.set(style.rimColor);
    if (uniforms.uRimIntensity) {
      uniforms.uRimIntensity.value = style.rimIntensity * intensity;
    }
    if (uniforms.uFill) uniforms.uFill.value = style.fill * intensity;
    if (uniforms.uOpacity) {
      // The shell keeps its own (much lower) base opacity, scaled the same way.
      uniforms.uOpacity.value = isWireframeShell
        ? Math.min(1, 0.14 * intensity)
        : style.opacity * intensity;
    }
    if (uniforms.uGlitch) uniforms.uGlitch.value = style.glitch;
    if (uniforms.uScanDensity) {
      uniforms.uScanDensity.value = scanDensity * style.scanScale * (isWireframeShell ? 0.5 : 1);
    }
    if (uniforms.uFlicker) {
      uniforms.uFlicker.value = flicker * style.flickerScale * (isWireframeShell ? 0.5 : 1);
    }
  }

  root.traverse((node) => {
    if (!node.isMesh) return;

    if (node.userData?.isHologramOverlay) {
      // The shell is a child mesh: toggle it at mesh level.
      node.visible = !style.pointCloud;
      return;
    }

    // Surface: hide via the material so children (the shell) still render.
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material) material.visible = !(style.wireframeOnly || style.pointCloud);
    }
  });

  if (style.pointCloud) {
    ensurePointClouds(root);
    setPointCloudVisible(root, true);
    updatePointCloudMaterials(root, {
      color: style.color,
      opacity: Math.min(1, 0.9 * intensity),
    });
  } else if (hasPointClouds(root)) {
    setPointCloudVisible(root, false);
  }
}

/* ------------------------------------------------------------ helpers --- */

/** @param {number} value */
function clamp01to2(value) {
  return Math.min(Math.max(value, 0.2), 2);
}

/**
 * @param {string} hex "#rrggbb" (a leading # is optional)
 * @returns {{ r: number, g: number, b: number }} components in 0..1
 */
export function hexToRgb(hex) {
  const text = String(hex).replace('#', '').trim();
  const full =
    text.length === 3
      ? text
          .split('')
          .map((char) => char + char)
          .join('')
      : text;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return { r: 1, g: 1, b: 1 };
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

/**
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {string} "#rrggbb"
 */
export function rgbToHex({ r, g, b }) {
  const toByte = (value) => Math.round(Math.min(Math.max(value, 0), 1) * 255);
  const hex = (value) => toByte(value).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
