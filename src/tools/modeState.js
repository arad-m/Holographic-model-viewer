// src/tools/modeState.js
// Owns: the definition of the four interactive modes and the rules that route a
// vertical drag or a number key to the right place. Pure data + pure helpers: no
// DOM, no three.js, no state import, so the routing is unit-testable.
//
// Modes are changed ONLY by the mode bar or the 1-4 keys. A gesture can never
// switch modes - it only feeds whichever mode is already active.

/**
 * The four modes, in toolbar order. `shortcut` is the bare digit key; presets
 * keep their own digits behind Shift so the two sets cannot collide.
 */
export const TOOL_MODES = Object.freeze([
  {
    id: 'orbit',
    label: 'Orbit',
    shortcut: '1',
    hint: 'Drag or pinch to rotate',
  },
  {
    id: 'slice',
    label: 'Slice',
    shortcut: '2',
    hint: 'Drag up or down to move the cut',
  },
  {
    id: 'explode',
    label: 'Explode',
    shortcut: '3',
    hint: 'Drag up or down to separate the parts',
  },
  {
    id: 'inspect',
    label: 'Inspect',
    shortcut: '4',
    hint: 'Point at a part to name it',
  },
]);

/** Every valid mode id, in toolbar order. */
export const MODE_IDS = Object.freeze(TOOL_MODES.map((mode) => mode.id));

/** The mode the app starts in. */
export const DEFAULT_MODE = 'orbit';

/** Valid clipping axes for Slice. */
export const SLICE_AXES = Object.freeze(['x', 'y', 'z']);

/**
 * Everything the tools own, reset as one unit when the mode changes or a new
 * model is loaded. Kept in state.tool (not settings) because it is view state,
 * not a preference.
 */
export const TOOL_DEFAULTS = Object.freeze({
  mode: DEFAULT_MODE,
  sliceAxis: 'x',
  slicePosition: 0,
  explode: 0,
  inspectLabel: '',
});

/** @param {unknown} value */
export function isToolMode(value) {
  return typeof value === 'string' && MODE_IDS.includes(value);
}

/** @param {unknown} value */
export function isSliceAxis(value) {
  return typeof value === 'string' && SLICE_AXES.includes(value);
}

/**
 * @param {string} id
 * @returns {(typeof TOOL_MODES)[number]|null}
 */
export function findMode(id) {
  return TOOL_MODES.find((mode) => mode.id === id) ?? null;
}

/**
 * Mode id for a bare digit shortcut ('2' -> 'slice'), or null.
 * @param {string} shortcut
 */
export function modeForShortcut(shortcut) {
  const mode = TOOL_MODES.find((item) => item.shortcut === shortcut);
  return mode ? mode.id : null;
}

/**
 * Where a vertical drag goes in this mode. This single rule is what keeps the
 * hand and mouse paths consistent: Orbit pitches the model, Slice and Explode
 * move their own value, Inspect ignores vertical movement entirely.
 *
 * @param {string} mode
 * @returns {'pitch'|'slice'|'explode'|'none'}
 */
export function verticalDragTarget(mode) {
  if (mode === 'slice') return 'slice';
  if (mode === 'explode') return 'explode';
  if (mode === 'inspect') return 'none';
  return 'pitch';
}

/**
 * Map one raw keydown to an intent. `code` is used rather than `key` because
 * Shift+1 reports '!' as the key on most layouts.
 *
 * @param {{ code?: string, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean }} event
 * @returns {{ kind: 'mode', value: string } | { kind: 'preset', value: string } | null}
 */
export function shortcutIntent(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
  const match = /^Digit([1-9])$/.exec(event.code ?? '');
  if (!match) return null;
  const digit = match[1];

  if (event.shiftKey) return { kind: 'preset', value: digit };
  const mode = modeForShortcut(digit);
  return mode ? { kind: 'mode', value: mode } : null;
}
