// src/render/explodeModel.js
// Owns: applying Explode mode to a loaded model. It caches, per mesh, the exact
// position it had when the model was collected plus the direction it should
// travel in, and writes `original + direction * amount * EXPLODE_DISTANCE`.
//
// Amount 0 writes the cached original back untouched, so a model always returns
// to exactly where it started - no drift, no accumulated float error.
//
// Directions are computed in the model wrapper's space (via the inverse of the
// wrapper's world matrix), so rotating the model never changes which way a part
// flies. The offset is then converted into each mesh's parent space, so nested
// groups and the loader's own scaling behave correctly.

import { Matrix4, Vector3 } from 'three';
import { EXPLODE_DISTANCE, directionFromCenter } from '../tools/explode.js';

/**
 * @param {import('three').Object3D} wrapper the model wrapper (transform owner)
 * @returns {{
 *   parts: number,
 *   separable: boolean,
 *   apply: (amount: number) => void,
 *   restore: () => void,
 *   dispose: () => void,
 * }}
 */
export function createExplodeModel(wrapper) {
  if (!wrapper) throw new Error('createExplodeModel: a model wrapper is required');

  wrapper.updateMatrixWorld(true);
  const toWrapper = new Matrix4().copy(wrapper.matrixWorld).invert();
  const center = new Vector3();
  const worldCenter = new Vector3();

  /** @type {Array<{ mesh: any, original: Vector3, delta: Vector3 }>} */
  const parts = [];
  let index = 0;

  wrapper.traverse((node) => {
    // The wireframe shell and the point cloud share their parent mesh's geometry
    // and must ride along with it, not be exploded separately.
    if (!node.isMesh || node.userData.isHologramOverlay) return;
    if (!node.geometry) return;

    node.updateWorldMatrix(true, false);
    worldCenter.set(0, 0, 0);
    const box = node.geometry.boundingBox ?? node.geometry.computeBoundingBox();
    if (node.geometry.boundingBox) {
      worldCenter.copy(node.geometry.boundingBox.getCenter(new Vector3()));
      worldCenter.applyMatrix4(node.matrixWorld);
    } else if (box) {
      worldCenter.copy(box.getCenter(new Vector3())).applyMatrix4(node.matrixWorld);
    } else {
      worldCenter.copy(node.getWorldPosition(new Vector3()));
    }

    center.copy(worldCenter).applyMatrix4(toWrapper);
    const direction = directionFromCenter(center, index);

    // Convert the wrapper-space direction into this mesh's parent space once,
    // so every frame is a single multiply-add.
    const parentInverse = new Matrix4().copy(node.parent?.matrixWorld ?? wrapper.matrixWorld).invert();
    parentInverse.elements[12] = 0;
    parentInverse.elements[13] = 0;
    parentInverse.elements[14] = 0;
    const delta = new Vector3(direction.x, direction.y, direction.z).applyMatrix4(parentInverse);

    parts.push({
      mesh: node,
      original: node.position.clone(),
      delta,
    });
    index += 1;
  });

  /**
   * @param {number} amount 0..1
   */
  function apply(amount) {
    const clamped = Number.isFinite(amount) ? Math.min(Math.max(amount, 0), 1) : 0;
    const scale = clamped * EXPLODE_DISTANCE;
    for (const part of parts) {
      if (scale === 0) {
        part.mesh.position.copy(part.original);
        continue;
      }
      part.mesh.position.set(
        part.original.x + part.delta.x * scale,
        part.original.y + part.delta.y * scale,
        part.original.z + part.delta.z * scale,
      );
    }
  }

  /** Write every cached position back exactly. */
  function restore() {
    for (const part of parts) part.mesh.position.copy(part.original);
  }

  return {
    parts: parts.length,
    separable: parts.length >= 2,
    apply,
    restore,
    dispose() {
      parts.length = 0;
    },
  };
}
