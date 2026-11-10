// src/state.js
// Owns: the single shared application state object (the one source of truth)
// and the only sanctioned mutators. No other module keeps mutable application
// data at module scope, and no other module writes to `state` directly.
//
// Every mutator emits 'state:changed' with { keys: string[] } so UI/render code
// can react without polling. One deliberate exception: the per-frame gesture
// state (state.gesture) is written by setGesture() WITHOUT emitting, because it
// updates 30-60x per second; consumers read it straight from the loop.
//
// `status` is { code, message }: a short machine-readable code plus an optional
// human-readable message rendered by ui/feedback.js. Codes are added by later
// phases (e.g. 'idle', 'model-loading', 'model-ready', 'model-error',
// 'camera-error'); Phase 0 only defines the shape and the 'idle' default.

import { events } from './events.js';
import { createEmptyGestureState } from './input/gestures.js';
import { schemaDefaults } from './settings/schema.js';
import { TOOL_DEFAULTS, isSliceAxis, isToolMode } from './tools/modeState.js';
import { clampExplodeAmount, clampSlicePosition } from './tools/slice.js';

/** Event channel emitted after any non-gesture state mutation. */
export const STATE_CHANGED = 'state:changed';

/** The transform fields, in the order they are applied by the renderer. */
export const TRANSFORM_KEYS = Object.freeze([
  'rotX',
  'rotY',
  'qx',
  'qy',
  'qz',
  'qw',
  'panX',
  'panY',
  'scale',
]);

/**
 * Neutral transform: no rotation, no pan, 1x scale.
 * qx..qw are the orientation. rotX/rotY stay at 0; the model no longer
 * stores tilt as two Euler angles, because that locked roll to zero.
 */
export const TRANSFORM_DEFAULTS = Object.freeze({
  rotX: 0,
  rotY: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  panX: 0,
  panY: 0,
  scale: 1,
});

/**
 * Interaction modes. 'mouse' = pointer/keyboard only, 'gesture' = webcam hand
 * tracking drives the transform. Later phases may switch between them.
 */
export const MODES = Object.freeze({ MOUSE: 'mouse', GESTURE: 'gesture' });

/**
 * Default settings. All are flat so patchSettings() can shallow-merge them.
 *   rotate/zoom/panSensitivity: multipliers applied to gesture deltas.
 *   smoothingRate: exponential damping rate in 1/s. Applied dt-independently as
 *                  alpha = 1 - exp(-smoothingRate * dt). 0 disables smoothing.
 *   showWebcam:    whether the mirrored camera preview is visible.
 *   pinchStartThreshold / pinchReleaseThreshold: pinch hysteresis, as a ratio of
 *                  hand size. Start must be lower than release so a hand resting
 *                  at the boundary cannot flicker between states.
 *   showDebugOverlay: whether the live hand numbers / FPS panel is shown.
 *   landmarkSmoothing: 0..1 strength of the One Euro landmark filter (0 = raw,
 *                  1 = very steady but laggier). See input/gestures.js.
 *   gestureRotateSensitivity: multiplier on pinch-drag rotation (0.1..4).
 *   showHandSkeleton: whether the glowing hand wireframe is drawn in the scene.
 *   soundEnabled:     audio cues on/off (the AudioContext is only created after
 *                     the first click or keypress - browsers require that).
 *   soundVolume:      master level for every cue, 0..1.
 *   fistThreshold:    fist curl threshold (enter); the exit threshold is derived
 *                     from it so the hysteresis stays proportional.
 *   hologramIntensity / scanDensity / flicker: hologram look knobs. Presets
 *                     scale these rather than replacing them.
 *   hologramPreset:   id of the active style preset ('cyan', 'orange', ...).
 *
 * The panel-controlled keys come from settings/schema.js so a default can never
 * drift between the slider, the validator and the state object.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  rotateSensitivity: 1,
  zoomSensitivity: 1,
  smoothingRate: 12,
  soundEnabled: true,
  hologramPreset: 'cyan',
  ...schemaDefaults(),
});

/**
 * @typedef {Object} AppModel
 * @property {any|null} object    THREE.Object3D (or Group) currently shown. `any`
 *                                because three.js is not a dependency until the
 *                                renderer phase lands.
 * @property {number} baseScale   Uniform scale the loader normalized the model to.
 *
 * @typedef {Object} AppTransform
 * @property {number} rotX
 * @property {number} rotY
 * @property {number} qx
 * @property {number} qy
 * @property {number} qz
 * @property {number} qw
 * @property {number} panX
 * @property {number} panY
 * @property {number} scale
 *
 * @typedef {Object} AppSettings
 * @property {number} rotateSensitivity
 * @property {number} zoomSensitivity
 * @property {number} panSensitivity
 * @property {number} smoothingRate
 * @property {boolean} showWebcam
 * @property {number} pinchStartThreshold
 * @property {number} pinchReleaseThreshold
 * @property {boolean} showDebugOverlay
 * @property {number} landmarkSmoothing
 * @property {number} gestureRotateSensitivity
 * @property {boolean} showHandSkeleton
 * @property {boolean} soundEnabled
 * @property {number} soundVolume
 * @property {number} fistThreshold
 * @property {number} hologramIntensity
 * @property {number} scanDensity
 * @property {number} flicker
 * @property {string} hologramPreset
 *
 * @typedef {Object} AppStatus
 * @property {string} code
 * @property {string} message
 *
 * @typedef {Object} AppTool
 * @property {'orbit'|'slice'|'explode'|'inspect'} mode
 * @property {'x'|'y'|'z'} sliceAxis
 * @property {number} slicePosition  -1..1, world offset comes from tools/slice.js
 * @property {number} explode        0..1 explosion amount
 * @property {string} inspectLabel   name of the part under the pointer, '' = none
 *
 * @typedef {Object} AppState
 * @property {AppModel} model
 * @property {AppTransform} transform
 * @property {'mouse'|'gesture'} mode
 * @property {AppSettings} settings
 * @property {AppTool} tool
 * @property {import('./input/gestures.js').GestureState} gesture
 * @property {AppStatus} status
 */

/** @type {AppState} */
export const state = {
  model: { object: null, baseScale: 1 },
  transform: { ...TRANSFORM_DEFAULTS },
  mode: MODES.MOUSE,
  settings: { ...DEFAULT_SETTINGS },
  tool: { ...TOOL_DEFAULTS },
  gesture: createEmptyGestureState(),
  status: { code: 'idle', message: '' },
};

/** @param {string[]} keys */
function notify(keys) {
  events.emit(STATE_CHANGED, { keys });
}

/**
 * Install the model to render (or null to clear it). The caller owns disposal
 * of the previous object; this only stores the reference.
 * @param {any|null} object
 * @param {number} [baseScale]
 */
export function setModel(object, baseScale = 1) {
  state.model.object = object ?? null;
  state.model.baseScale = Number.isFinite(baseScale) && baseScale > 0 ? baseScale : 1;
  notify(['model']);
}

/**
 * Patch one or more transform fields. Unknown or non-finite values are ignored,
 * so a broken gesture can never poison the transform.
 *
 * `silent: true` skips the 'state:changed' emit. Use it for continuous writers
 * (auto-rotate, pointer drag, wheel zoom, and later the gesture stream) that run
 * every frame or every pointer event: they must never flood the event bus.
 *
 * @param {Partial<AppTransform>} patch
 * @param {{ silent?: boolean }} [options]
 */
export function setTransform(patch, options = {}) {
  if (!patch) return;
  let changed = false;
  for (const key of TRANSFORM_KEYS) {
    const value = patch[key];
    if (Number.isFinite(value) && state.transform[key] !== value) {
      state.transform[key] = value;
      changed = true;
    }
  }
  if (changed && !options.silent) notify(['transform']);
}

/** Restore the neutral transform. */
export function resetTransform() {
  Object.assign(state.transform, TRANSFORM_DEFAULTS);
  notify(['transform']);
}

/** Add to one finite transform field without emitting (per-frame helper). */
export function addTransformDelta(key, delta) {
  if (!TRANSFORM_KEYS.includes(key) || !Number.isFinite(delta)) return;
  const next = state.transform[key] + delta;
  if (Number.isFinite(next)) state.transform[key] = next;
}

/**
 * Switch interaction mode.
 * @param {'mouse'|'gesture'} mode
 */
export function setMode(mode) {
  if (mode !== MODES.MOUSE && mode !== MODES.GESTURE) {
    throw new RangeError(`setMode: unsupported mode "${mode}"`);
  }
  if (state.mode === mode) return;
  state.mode = mode;
  notify(['mode']);
}

/**
 * Shallow-merge known settings. Unknown keys and wrong types are ignored.
 * @param {Partial<AppSettings>} patch
 */
export function patchSettings(patch) {
  if (!patch) return;
  let changed = false;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in patch)) continue;
    const value = patch[key];
    const expected = typeof DEFAULT_SETTINGS[key];
    if (typeof value !== expected) continue;
    if (expected === 'number' && !Number.isFinite(value)) continue;
    if (state.settings[key] !== value) {
      state.settings[key] = value;
      changed = true;
    }
  }
  if (changed) notify(['settings']);
}

/** Restore default settings. */
export function resetSettings() {
  Object.assign(state.settings, DEFAULT_SETTINGS);
  notify(['settings']);
}

/**
 * Switch tool mode. Called ONLY by the mode bar and the 1-4 keys - a gesture
 * must never change the mode.
 * @param {'orbit'|'slice'|'explode'|'inspect'} mode
 */
export function setToolMode(mode) {
  if (!isToolMode(mode) || state.tool.mode === mode) return;
  state.tool.mode = mode;
  notify(['tool']);
}

/**
 * Patch tool values. Unknown keys, wrong types and non-finite numbers are
 * ignored; the two numeric ranges are clamped here so no caller can set a slice
 * position of 40 by accident.
 *
 * @param {{ sliceAxis?: string, slicePosition?: number, explode?: number, inspectLabel?: string }} patch
 */
export function patchTool(patch) {
  if (!patch) return;
  let changed = false;

  if (isSliceAxis(patch.sliceAxis) && state.tool.sliceAxis !== patch.sliceAxis) {
    state.tool.sliceAxis = patch.sliceAxis;
    changed = true;
  }

  if (Number.isFinite(patch.slicePosition)) {
    const next = clampSlicePosition(patch.slicePosition);
    if (state.tool.slicePosition !== next) {
      state.tool.slicePosition = next;
      changed = true;
    }
  }

  if (Number.isFinite(patch.explode)) {
    const next = clampExplodeAmount(patch.explode);
    if (state.tool.explode !== next) {
      state.tool.explode = next;
      changed = true;
    }
  }

  if (typeof patch.inspectLabel === 'string' && state.tool.inspectLabel !== patch.inspectLabel) {
    state.tool.inspectLabel = patch.inspectLabel;
    changed = true;
  }

  if (changed) notify(['tool']);
}

/**
 * Put every tool value back to its default, keeping the current mode unless a
 * mode is passed. Used when a new model loads.
 * @param {'orbit'|'slice'|'explode'|'inspect'} [mode]
 */
export function resetTool(mode) {
  const keepMode = isToolMode(mode) ? mode : state.tool.mode;
  Object.assign(state.tool, TOOL_DEFAULTS, { mode: keepMode });
  notify(['tool']);
}

/**
 * Store the latest GestureState. High frequency: never emits an event.
 * @param {import('./input/gestures.js').GestureState|null} gestureState
 */
export function setGesture(gestureState) {
  state.gesture = gestureState ?? createEmptyGestureState();
}

/**
 * Set the status shown by the feedback UI.
 * @param {string} code
 * @param {string} [message]
 */
export function setStatus(code, message = '') {
  if (typeof code !== 'string' || code.length === 0) return;
  state.status = { code, message: typeof message === 'string' ? message : '' };
  notify(['status']);
}
