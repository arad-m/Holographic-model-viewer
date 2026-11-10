// src/render/modelLoader.js
// Owns: getting a user file into the scene. Picks the parser by extension
// (.glb / .gltf / .obj / .stl), centers the geometry, normalizes it to a fixed
// world size (reported back as `baseScale`), swaps every mesh material for the
// hologram material (plus a faint wireframe shell), and disposes the previous
// model's geometries, materials and textures.
//
// Defensive contract: unsupported types, empty files, files with no mesh
// geometry and parse failures all reject with a ModelLoadError carrying a
// readable message - never a silent empty scene, and never a half-built model
// left in memory.

import { Box3, Group, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  HOLOGRAM_DEFAULTS,
  createHologramMaterial,
  createWireframeOverlayMaterial,
  disposeMaterial,
} from './hologramMaterial.js';

/** File extensions the viewer accepts. */
export const SUPPORTED_EXTENSIONS = Object.freeze(['glb', 'gltf', 'obj', 'stl']);

/** Every model is normalized so its largest dimension equals this many units. */
export const TARGET_SIZE = 1.6;
/** Above this, parsing the file is more likely to freeze the tab than to draw. */
export const MAX_MODEL_BYTES = 80 * 1024 * 1024;
/** Above this, the hologram shader cannot keep an interactive frame rate. */
export const MAX_MODEL_VERTICES = 2_000_000;

/** Key on the wrapper's userData holding { materials, meshCount }. */
export const HOLOGRAM_USER_DATA_KEY = 'hologram';

/** Thrown for anything the user can fix (wrong type, corrupt file). */
export class ModelLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelLoadError';
  }
}

/**
 * @param {File} file
 * @returns {Promise<{ object: Group, baseScale: number, meshCount: number, materials: import('three').Material[] }>}
 */
export async function loadModel(file) {
  if (!file || typeof file.name !== 'string') {
    throw new ModelLoadError('No file was provided.');
  }

  const extension = (file.name.split('.').pop() || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new ModelLoadError(
      `".${extension || '?'}" files are not supported. Use ${SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(', ')}.`,
    );
  }
  if (file.size === 0) {
    throw new ModelLoadError(`"${file.name}" is empty.`);
  }
  if (file.size > MAX_MODEL_BYTES) {
    const limitMb = Math.round(MAX_MODEL_BYTES / (1024 * 1024));
    throw new ModelLoadError(
      `"${file.name}" is too large to open in the browser (${limitMb} MB max).`,
    );
  }

  let root = null;
  try {
    root = await parseModel(file, extension);
    const meshes = collectMeshes(root);
    if (meshes.length === 0) {
      throw new ModelLoadError(`"${file.name}" contains no mesh geometry.`);
    }
    const vertices = countVertices(meshes);
    if (vertices > MAX_MODEL_VERTICES) {
      throw new ModelLoadError(
        `"${file.name}" has too many vertices (${vertices.toLocaleString()}) to draw smoothly.`,
      );
    }
    const materials = applyHologramMaterials(meshes);
    return normalizeModel(root, materials, meshes.length);
  } catch (error) {
    if (root) disposeObject(root);
    throw toModelLoadError(error, file.name, extension);
  }
}

/**
 * Dispose every geometry and material under `root` and detach it from its parent.
 * Safe to call twice and safe on a partially built model.
 * @param {import('three').Object3D|null|undefined} root
 */
export function disposeObject(root) {
  if (!root) return;
  root.traverse((node) => {
    // The wireframe shell and the point cloud share the parent mesh's geometry.
    // Disposing it twice frees a buffer the parent still draws with.
    const sharesGeometry = Boolean(node.userData?.isHologramOverlay || node.userData?.isHologramPoints);
    if (node.geometry && !sharesGeometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) disposeMaterial(material);
    }
  });
  root.removeFromParent();
}

/** Live hologram materials of a loaded model (for per-frame uniform updates). */
export function getHologramMaterials(root) {
  return root?.userData?.[HOLOGRAM_USER_DATA_KEY]?.materials ?? [];
}

async function parseModel(file, extension) {
  if (extension === 'obj') {
    return new OBJLoader().parse(await file.text());
  }

  if (extension === 'stl') {
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    if (!geometry.getAttribute('position')) {
      throw new ModelLoadError('That .stl file contains no triangles.');
    }
    const group = new Group();
    group.add(new Mesh(geometry));
    return group;
  }

  // glb: binary container; gltf: JSON, which may point at external files.
  const source = extension === 'glb' ? await file.arrayBuffer() : await file.text();
  return parseGltf(source);
}

/** @param {ArrayBuffer|string} source */
function parseGltf(source) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      source,
      '',
      (gltf) => {
        if (gltf?.scene) resolve(gltf.scene);
        else reject(new ModelLoadError('That glTF file contains no scene.'));
      },
      (error) => reject(new ModelLoadError(error?.message || 'glTF parse error.')),
    );
  });
}

/** @param {import('three').Mesh[]} meshes */
function countVertices(meshes) {
  let count = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry?.getAttribute?.('position');
    if (position) count += position.count;
  }
  return count;
}

/** @param {import('three').Object3D} root */
function collectMeshes(root) {
  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh && node.geometry?.getAttribute('position')) meshes.push(node);
  });
  return meshes;
}

/**
 * Replace each mesh's source materials with the hologram shader and add the
 * optional wireframe shell as a child mesh sharing the same geometry.
 * @param {Mesh[]} meshes
 */
function applyHologramMaterials(meshes) {
  const materials = [];

  for (const mesh of meshes) {
    const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of originals) disposeMaterial(material);

    const hologramMaterial = createHologramMaterial();
    mesh.material = hologramMaterial;
    materials.push(hologramMaterial);

    if (HOLOGRAM_DEFAULTS.wireframe) {
      const overlayMaterial = createWireframeOverlayMaterial();
      const overlay = new Mesh(mesh.geometry, overlayMaterial);
      overlay.name = `${mesh.name || 'mesh'}-wireframe`;
      overlay.userData.isHologramOverlay = true;
      overlay.raycast = () => {};
      mesh.add(overlay);
      materials.push(overlayMaterial);
    }
  }

  return materials;
}

/**
 * Center the model and scale it so its largest dimension is TARGET_SIZE.
 * The wrapper is what applyTransform() drives, so rotation happens about the
 * model's own center.
 */
function normalizeModel(root, materials, meshCount) {
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    throw new ModelLoadError('That model has no measurable size.');
  }

  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const largestDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
    throw new ModelLoadError('That model has zero size.');
  }

  const centered = new Group();
  centered.add(root);
  centered.position.copy(center).multiplyScalar(-1);

  const wrapper = new Group();
  wrapper.name = 'hologram-model';
  wrapper.rotation.order = 'YXZ';
  wrapper.add(centered);
  wrapper.userData[HOLOGRAM_USER_DATA_KEY] = { materials, meshCount };

  return { object: wrapper, baseScale: TARGET_SIZE / largestDimension, meshCount, materials };
}

function toModelLoadError(error, fileName, extension) {
  const isGltf = extension === 'glb' || extension === 'gltf';
  const externalHint =
    extension === 'gltf'
      ? ' If it references external .bin or texture files, export it as a single .glb instead.'
      : '';
  const reason = error?.message || String(error);

  // A JSON/parse failure on a glb/gltf means the file itself is malformed. It can
  // arrive either wrapped (our parseGltf rejection) or raw from the loader, so
  // this test runs before the instanceof check. Report it plainly instead of
  // leaking the parser's token dump.
  if (isGltf && /json|token|unexpected|end of data|gltf/i.test(reason)) {
    return new ModelLoadError(
      `"${fileName}" is not a valid ${extension.toUpperCase()} model.${externalHint}`,
    );
  }

  if (error instanceof ModelLoadError) return new ModelLoadError(`${reason}${externalHint}`);
  return new ModelLoadError(`Could not read "${fileName}": ${reason}`);
}
