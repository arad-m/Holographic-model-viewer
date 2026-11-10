// src/input/touchGestures.js
// Owns: the arithmetic that turns finger positions into the same three deltas the
// mouse and the hands already produce - rotate, pan, zoom.
//
// It is pure on purpose: no listeners, no DOM, no state import. mouseControls.js
// feeds it the current set of touch pointers and applies what comes back, so the
// touch path shares every clamp and every sign with the mouse path.
//
// The one subtle rule is the transition. Going from one finger to two must not
// produce a delta, because the centroid and the span both "appear" at that
// moment: the first frame after a count change is an anchor, never a movement.

/**
 * @typedef {{ id: number, x: number, y: number }} TouchPointer
 * @typedef {{
 *   kind: 'none'|'rotate'|'pan'|'pinch',
 *   dx: number, dy: number,
 *   zoomFactor: number,
 * }} TouchDelta
 */

/** Below this, a two-finger span ratio is noise rather than a pinch. */
export const MIN_PINCH_SPAN_PX = 24;

/** A delta that changes nothing. */
export function emptyTouchDelta() {
  return { kind: 'none', dx: 0, dy: 0, zoomFactor: 1 };
}

/**
 * Mean position of a pointer set.
 * @param {TouchPointer[]} pointers
 * @returns {{ x: number, y: number }}
 */
export function centroid(pointers) {
  if (!Array.isArray(pointers) || pointers.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const pointer of pointers) {
    x += pointer.x;
    y += pointer.y;
  }
  return { x: x / pointers.length, y: y / pointers.length };
}

/**
 * Mean distance from the centroid: the span a two-finger pinch scales.
 * Using the centroid rather than only the first pair keeps three fingers sane.
 *
 * @param {TouchPointer[]} pointers
 * @returns {number}
 */
export function span(pointers) {
  if (!Array.isArray(pointers) || pointers.length < 2) return 0;
  const centre = centroid(pointers);
  let total = 0;
  for (const pointer of pointers) {
    total += Math.hypot(pointer.x - centre.x, pointer.y - centre.y);
  }
  return total / pointers.length;
}

/**
 * Deltas between two consecutive pointer sets.
 *
 * @param {TouchPointer[]} previous
 * @param {TouchPointer[]} current
 * @returns {TouchDelta}
 */
export function touchDelta(previous, current) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(current) ? current : [];

  // A finger landed or lifted: this frame is the anchor for whatever comes next.
  if (before.length === 0 || after.length === 0) return emptyTouchDelta();
  if (before.length !== after.length) return emptyTouchDelta();

  const from = centroid(before);
  const to = centroid(after);
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (after.length === 1) {
    return { kind: 'rotate', dx, dy, zoomFactor: 1 };
  }

  // Two or more fingers: the centroid drag pans, the span ratio zooms. Both
  // happen at once, which is what makes a two-finger drag with a slight spread
  // feel like one natural movement.
  const spanBefore = span(before);
  const spanAfter = span(after);
  const pinchable = spanBefore >= MIN_PINCH_SPAN_PX && spanAfter >= MIN_PINCH_SPAN_PX;
  const zoomFactor = pinchable ? clamp(spanAfter / spanBefore, 0.5, 2) : 1;
  const moved = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
  const zoomed = Math.abs(zoomFactor - 1) > 0.002;

  if (!moved && !zoomed) return emptyTouchDelta();
  return { kind: 'pinch', dx, dy, zoomFactor };
}

/**
 * Sort pointers by id so "the same finger" is the same entry across frames, no
 * matter what order the browser reports them in.
 * @param {Iterable<TouchPointer>} pointers
 * @returns {TouchPointer[]}
 */
export function sortPointers(pointers) {
  return Array.from(pointers).sort((a, b) => a.id - b.id);
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
