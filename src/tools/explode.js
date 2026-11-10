// src/tools/explode.js
// Owns: the maths behind Explode mode. Every mesh moves outward from the model
// centre along the direction of its own centre, by `amount * EXPLODE_DISTANCE`.
//
// Pure: no three.js, no DOM, so the direction and offset rules are unit-testable
// without building a scene. src/render/explodeModel.js applies the result.

/** World units a part travels outward at amount 1 (the model is 1.6 across). */
export const EXPLODE_DISTANCE = 1.15;

/** Below this distance from the centre a mesh has no usable own direction. */
const MIN_DIRECTION_LENGTH = 1e-4;

/**
 * Deterministic fallback direction for a mesh sitting exactly at the centre:
 * spread evenly around a circle, alternating up and down, so even a symmetric
 * model comes apart in a readable way instead of staying put.
 *
 * @param {number} index
 * @returns {{ x: number, y: number, z: number }} unit vector
 */
export function fallbackDirection(index) {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const angle = (safeIndex * 2.399963) % (Math.PI * 2);
  const vertical = safeIndex % 2 === 0 ? 0.34 : -0.34;
  const horizontal = Math.sqrt(1 - vertical * vertical);
  return {
    x: Math.cos(angle) * horizontal,
    y: vertical,
    z: Math.sin(angle) * horizontal,
  };
}

/**
 * The unit direction a part travels in, from its centre relative to the model
 * centre. A part at the centre falls back to `fallbackDirection(index)`.
 *
 * @param {{ x: number, y: number, z: number }} center
 * @param {number} [index]
 * @returns {{ x: number, y: number, z: number }} unit vector
 */
export function directionFromCenter(center, index = 0) {
  if (!center) return fallbackDirection(index);
  const { x, y, z } = center;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallbackDirection(index);
  }
  const length = Math.hypot(x, y, z);
  if (length < MIN_DIRECTION_LENGTH) return fallbackDirection(index);
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * Offset for one part. Amount 0 always returns exactly zero, so the caller can
 * restore the original position bit-for-bit by writing this back.
 *
 * @param {{ x: number, y: number, z: number }} center
 * @param {number} amount 0..1
 * @param {number} [index]
 * @returns {{ x: number, y: number, z: number }}
 */
export function explodeOffset(center, amount, index = 0) {
  const clamped = clampExplodeAmount(amount);
  if (clamped === 0) return { x: 0, y: 0, z: 0 };
  const direction = directionFromCenter(center, index);
  const scale = clamped * EXPLODE_DISTANCE;
  return { x: direction.x * scale, y: direction.y * scale, z: direction.z * scale };
}

/**
 * Clamp an explode amount from a slider or a drag.
 * @param {number} value
 */
export function clampExplodeAmount(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Amount needed to keep "part i" clear of its neighbour, used only to decide
 * whether a model is worth exploding (a single mesh has nothing to separate).
 *
 * @param {{ x: number, y: number, z: number }[]} centers
 * @returns {boolean}
 */
export function hasSeparableParts(centers) {
  return Array.isArray(centers) && centers.length >= 2;
}
