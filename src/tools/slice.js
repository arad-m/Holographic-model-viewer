// src/tools/slice.js
// Owns: the maths behind Slice mode. A slice is an axis-aligned plane plus a
// signed distance, and the visible cut is the set of segments where that plane
// crosses the model's triangles.
//
// Pure: no three.js, no DOM. The renderer converts these plain objects into
// THREE.Plane / BufferGeometry in src/render/sliceSection.js.

/**
 * How far from the centre a slice can travel, in world units. The loader
 * normalizes every model to 1.6 units across, so +/-0.85 always brackets it and
 * a little air either side means "nothing is cut" is reachable at both ends.
 */
export const SLICE_RANGE = 0.85;

/** Slice positions are normalized to -1..1 in state; clamp at the ends. */
export const MIN_SLICE_POSITION = -1;
export const MAX_SLICE_POSITION = 1;

/**
 * Unit normal for an axis. Any other value falls back to X, so a corrupt
 * attribute can never produce a zero-length normal.
 * @param {string} axis
 * @returns {{ x: number, y: number, z: number }}
 */
export function normalForAxis(axis) {
  if (axis === 'y') return { x: 0, y: 1, z: 0 };
  if (axis === 'z') return { x: 0, y: 0, z: 1 };
  return { x: 1, y: 0, z: 0 };
}

/**
 * Build the slice plane. `offset` is world units along the normal from the
 * model centre: the set of points where dot(normal, p) - offset = 0.
 *
 * Note this is NOT three.js's Plane form (dot(n, p) + constant = 0); the
 * renderer negates `offset` when it builds one, in a single place.
 *
 * @param {string} axis 'x' | 'y' | 'z'
 * @param {number} position -1..1
 * @returns {{ normal: { x: number, y: number, z: number }, offset: number, position: number }}
 */
export function slicePlane(axis, position) {
  const clamped = Number.isFinite(position)
    ? Math.min(Math.max(position, MIN_SLICE_POSITION), MAX_SLICE_POSITION)
    : 0;
  return { normal: normalForAxis(axis), offset: clamped * SLICE_RANGE, position: clamped };
}

/**
 * Signed distance from a point to the plane. Positive means "in front of" (the
 * side the normal points at), which is the side that stays visible.
 *
 * @param {{ normal: { x: number, y: number, z: number }, offset: number }} plane
 * @param {{ x: number, y: number, z: number }} point
 */
export function signedDistance(plane, point) {
  return (
    plane.normal.x * point.x +
    plane.normal.y * point.y +
    plane.normal.z * point.z -
    plane.offset
  );
}

/**
 * Where a plane crosses a triangle soup. Triangles are 9 floats each (x,y,z per
 * corner, no index) because they are baked once when a model loads.
 *
 * Returns a flat list of segment endpoints: [x1,y1,z1,x2,y2,z2, ...]. A triangle
 * that only touches the plane at a corner contributes nothing (it would be a
 * zero-length segment and shows up as a dot in the middle of the model).
 *
 * @param {Float32Array|number[]} triangles
 * @param {{ normal: { x: number, y: number, z: number }, offset: number }} plane
 * @param {number[]} [target] reused output array
 * @returns {number[]} the flat segment list
 */
export function sectionSegments(triangles, plane, target = []) {
  const out = target;
  out.length = 0;
  if (!triangles || triangles.length < 9) return out;

  const { normal, offset } = plane;
  const nx = normal.x;
  const ny = normal.y;
  const nz = normal.z;
  const triangleCount = Math.floor(triangles.length / 9);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = triangle * 9;

    const ax = triangles[base];
    const ay = triangles[base + 1];
    const az = triangles[base + 2];
    const bx = triangles[base + 3];
    const by = triangles[base + 4];
    const bz = triangles[base + 5];
    const cx = triangles[base + 6];
    const cy = triangles[base + 7];
    const cz = triangles[base + 8];

    const da = nx * ax + ny * ay + nz * az - offset;
    const db = nx * bx + ny * by + nz * bz - offset;
    const dc = nx * cx + ny * cy + nz * cz - offset;

    const aIn = da < 0;
    const bIn = db < 0;
    const cIn = dc < 0;
    // Entirely inside or entirely outside: nothing to cut.
    if (aIn === bIn && bIn === cIn) continue;

    let found = 0;
    let p1x = 0;
    let p1y = 0;
    let p1z = 0;
    let p2x = 0;
    let p2y = 0;
    let p2z = 0;

    // The three edges, visited in order so the output is deterministic.
    for (let edge = 0; edge < 3; edge += 1) {
      let d0;
      let d1;
      let x0;
      let y0;
      let z0;
      let x1;
      let y1;
      let z1;

      if (edge === 0) {
        d0 = da; d1 = db;
        x0 = ax; y0 = ay; z0 = az;
        x1 = bx; y1 = by; z1 = bz;
      } else if (edge === 1) {
        d0 = db; d1 = dc;
        x0 = bx; y0 = by; z0 = bz;
        x1 = cx; y1 = cy; z1 = cz;
      } else {
        d0 = dc; d1 = da;
        x0 = cx; y0 = cy; z0 = cz;
        x1 = ax; y1 = ay; z1 = az;
      }

      if ((d0 < 0) === (d1 < 0)) continue;

      const denominator = d0 - d1;
      const t = Math.abs(denominator) > 1e-9 ? d0 / denominator : 0;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      const pz = z0 + (z1 - z0) * t;

      if (found === 0) {
        p1x = px; p1y = py; p1z = pz;
        found = 1;
      } else if (found === 1) {
        p2x = px; p2y = py; p2z = pz;
        found = 2;
      }
    }

    if (found !== 2) continue;
    const lengthSq =
      (p2x - p1x) ** 2 + (p2y - p1y) ** 2 + (p2z - p1z) ** 2;
    if (lengthSq < 1e-12) continue;

    out.push(p1x, p1y, p1z, p2x, p2y, p2z);
  }

  return out;
}

/**
 * Clamp a slice position coming from a slider or a drag.
 * @param {number} value
 */
export function clampSlicePosition(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, MIN_SLICE_POSITION), MAX_SLICE_POSITION);
}

/**
 * Clamp an explode amount coming from a slider or a drag.
 * @param {number} value
 */
export function clampExplodeAmount(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}
