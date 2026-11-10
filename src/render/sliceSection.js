// src/render/sliceSection.js
// Owns: the glowing line drawn where the slice plane cuts the model.
//
// The model's triangles are baked ONCE, in the model wrapper's space, when the
// model loads. Each update converts the world-space slice plane into that same
// space and intersects it with the baked triangles, so the outline follows the
// model's rotation and zoom for free - the line is a child of the wrapper.
//
// The clipping itself is done by the GPU (material.clippingPlanes); this module
// only draws the seam. Baking is capped so a huge model cannot stall the frame.

import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Plane,
  Vector3,
} from 'three';
import { sectionSegments } from '../tools/slice.js';

/** Triangles baked for the outline. Beyond this, triangles are sampled. */
export const MAX_SECTION_TRIANGLES = 90000;
/** Vertices the outline buffer can hold (2 per segment). */
const MAX_SECTION_VERTICES = 48000;

const SECTION_COLOR = 0x9df6ff;

/**
 * Flatten every mesh of the model into one triangle soup, in wrapper space.
 * Overlay shells are skipped: they share their parent's geometry.
 *
 * @param {import('three').Object3D} wrapper
 * @param {number} [maxTriangles]
 * @returns {{ positions: Float32Array, triangleCount: number, sampled: boolean }}
 */
export function bakeTriangles(wrapper, maxTriangles = MAX_SECTION_TRIANGLES) {
  if (!wrapper) return { positions: new Float32Array(0), triangleCount: 0, sampled: false };

  wrapper.updateMatrixWorld(true);
  const toWrapper = new Matrix4().copy(wrapper.matrixWorld).invert();

  /** @type {Array<{ geometry: any, matrix: Matrix4 }>} */
  const sources = [];
  let total = 0;

  wrapper.traverse((node) => {
    if (!node.isMesh || node.userData.isHologramOverlay) return;
    const geometry = node.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!position) return;

    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    total += Math.floor(count / 3);

    const matrix = new Matrix4().multiplyMatrices(toWrapper, node.matrixWorld);
    sources.push({ geometry, matrix });
  });

  if (total === 0) return { positions: new Float32Array(0), triangleCount: 0, sampled: false };

  // Sample evenly rather than truncating: half a model still gives a usable
  // outline, the first tenth of it would not.
  const stride = total > maxTriangles ? Math.ceil(total / maxTriangles) : 1;
  const kept = Math.ceil(total / stride);
  const positions = new Float32Array(kept * 9);
  const vertex = new Vector3();
  let write = 0;
  let seen = 0;

  for (const { geometry, matrix } of sources) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;

    for (let corner = 0; corner + 2 < count; corner += 3) {
      seen += 1;
      if (stride > 1 && seen % stride !== 0) continue;
      if (write + 9 > positions.length) break;

      for (let k = 0; k < 3; k += 1) {
        const at = index ? index.getX(corner + k) : corner + k;
        vertex.fromBufferAttribute(position, at).applyMatrix4(matrix);
        positions[write] = vertex.x;
        positions[write + 1] = vertex.y;
        positions[write + 2] = vertex.z;
        write += 3;
      }
    }
  }

  return {
    positions: positions.subarray(0, write),
    triangleCount: Math.floor(write / 9),
    sampled: stride > 1,
  };
}

/**
 * @returns {{
 *   object: LineSegments,
 *   setTriangles: (baked: { positions: Float32Array }) => void,
 *   update: (plane: { normal: { x: number, y: number, z: number }, offset: number }, wrapper: import('three').Object3D) => number,
 *   setVisible: (visible: boolean) => void,
 *   clear: () => void,
 *   dispose: () => void,
 * }}
 */
export function createSliceSection() {
  // Float32BufferAttribute COPIES the array it is given, so the writable buffer
  // has to be the attribute's own array. Writing into a separate Float32Array
  // leaves the geometry collapsed forever - the same trap the hand skeleton hit.
  const attribute = new Float32BufferAttribute(new Float32Array(MAX_SECTION_VERTICES), 3);
  attribute.setUsage(35048 /* DynamicDrawUsage */);
  const buffer = attribute.array;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', attribute);
  geometry.setDrawRange(0, 0);

  const material = new LineBasicMaterial({
    color: SECTION_COLOR,
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });

  const object = new LineSegments(geometry, material);
  object.name = 'hologram-slice-line';
  object.frustumCulled = false;
  object.visible = false;
  object.renderOrder = 2;

  /** @type {Float32Array} */
  let triangles = new Float32Array(0);
  const scratch = [];
  const plane = new Plane();
  const inverse = new Matrix4();

  function setTriangles(baked) {
    triangles = baked?.positions ?? new Float32Array(0);
  }

  /**
   * Recompute the outline for this plane. Returns the segment count so the
   * caller can show it if it wants.
   *
   * @param {{ normal: { x: number, y: number, z: number }, offset: number }} worldPlane
   * @param {import('three').Object3D} wrapper
   */
  function update(worldPlane, wrapper) {
    if (!wrapper || triangles.length === 0) {
      geometry.setDrawRange(0, 0);
      return 0;
    }

    wrapper.updateMatrixWorld(true);
    inverse.copy(wrapper.matrixWorld).invert();

    // The same plane, expressed in wrapper space - the space the baked
    // triangles and this LineSegments both live in.
    plane.normal.set(worldPlane.normal.x, worldPlane.normal.y, worldPlane.normal.z);
    plane.constant = -worldPlane.offset;
    plane.applyMatrix4(inverse);

    const normal = { x: plane.normal.x, y: plane.normal.y, z: plane.normal.z };
    const offset = -plane.constant;
    const segments = sectionSegments(triangles, { normal, offset }, scratch);

    const vertices = Math.min(segments.length, buffer.length);
    for (let i = 0; i < vertices; i += 1) buffer[i] = segments[i];

    attribute.needsUpdate = true;
    geometry.setDrawRange(0, Math.floor(vertices / 3));
    return Math.floor(vertices / 6);
  }

  /** @param {boolean} visible */
  function setVisible(visible) {
    object.visible = Boolean(visible);
  }

  function clear() {
    triangles = new Float32Array(0);
    geometry.setDrawRange(0, 0);
    object.visible = false;
  }

  return {
    object,
    setTriangles,
    update,
    setVisible,
    clear,
    dispose() {
      geometry.dispose();
      material.dispose();
      object.removeFromParent();
    },
  };
}
