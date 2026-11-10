// src/render/pointCloud.js
// Owns: the Point-cloud look - one glowing, size-attenuated Points object per
// model mesh, built lazily the first time the preset is used and reused after
// that. Points share the mesh's geometry (no copy, no re-upload) and inherit its
// transform, so they follow the model exactly while it rotates, pans and zooms.
//
// Nothing here reads app state: colour/opacity come in as arguments.

import { AdditiveBlending, CanvasTexture, Points, PointsMaterial } from 'three';

/** Dot size in world units (models are normalized to 1.6 units across). */
const POINT_SIZE = 0.017;

/** One texture for every point cloud in the app. */
let glowTexture = null;

/** @returns {CanvasTexture} */
function sharedGlowTexture() {
  if (glowTexture) return glowTexture;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(210,245,255,0.65)');
  gradient.addColorStop(1, 'rgba(140,225,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  glowTexture = new CanvasTexture(canvas);
  glowTexture.needsUpdate = true;
  // Every point cloud shares this. Disposing a model must not free it.
  glowTexture.userData.shared = true;
  return glowTexture;
}

/**
 * Attach (once) a Points child to every surface mesh and return their materials.
 * @param {import('three').Object3D|null} root
 * @returns {PointsMaterial[]}
 */
export function ensurePointClouds(root) {
  if (!root) return [];
  const materials = [];

  root.traverse((node) => {
    if (!node.isMesh || node.userData?.isHologramOverlay) return;
    if (!node.geometry?.getAttribute?.('position')) return;

    let points = node.userData?.pointsOverlay;
    if (!points) {
      const material = new PointsMaterial({
        color: 0x6fe0ff,
        size: POINT_SIZE,
        sizeAttenuation: true,
        map: sharedGlowTexture(),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      points = new Points(node.geometry, material);
      points.name = `${node.name || 'mesh'}-points`;
      points.userData.isHologramPoints = true;
      points.frustumCulled = false;
      points.raycast = () => {};
      points.visible = false;

      if (!node.userData) node.userData = {};
      node.userData.pointsOverlay = points;
      node.add(points);
    }

    materials.push(/** @type {PointsMaterial} */ (points.material));
  });

  return materials;
}

/**
 * @param {import('three').Object3D|null} root
 * @param {boolean} visible
 */
export function setPointCloudVisible(root, visible) {
  if (!root) return;
  ensurePointClouds(root);
  root.traverse((node) => {
    if (node.userData?.pointsOverlay) node.userData.pointsOverlay.visible = Boolean(visible);
  });
}

/**
 * @param {import('three').Object3D|null} root
 * @param {{ color?: number|string, opacity?: number }} style
 */
export function updatePointCloudMaterials(root, { color, opacity } = {}) {
  if (!root) return;
  for (const material of ensurePointClouds(root)) {
    if (color !== undefined) material.color.set(color);
    if (Number.isFinite(opacity)) material.opacity = Math.min(Math.max(opacity, 0), 1);
  }
}

/**
 * Slice mode must cut the point cloud too, otherwise switching preset while
 * sliced would leave a cloud of dots the plane cannot touch.
 *
 * @param {import('three').Object3D|null} root
 * @param {import('three').Plane[]|null} planes
 */
export function setPointCloudClipping(root, planes) {
  if (!root) return;
  const next = planes && planes.length > 0 ? planes : null;
  for (const material of ensurePointClouds(root)) {
    if (material.clippingPlanes !== next) material.clippingPlanes = next;
  }
}

/** True when the model currently has any point cloud attached. */
export function hasPointClouds(root) {
  let found = false;
  root?.traverse?.((node) => {
    if (node.userData?.pointsOverlay) found = true;
  });
  return found;
}
