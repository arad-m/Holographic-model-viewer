// src/render/inspect.js
// Owns: Inspect mode. A normalized screen point (an index fingertip, or the
// mouse) is raycast into the scene; the first real mesh under it is highlighted
// and named by a small floating label.
//
// The highlight is re-applied every frame on purpose: the preset/style pass
// rewrites the same uniforms, so the inspector has to win the last write. When
// the pointer leaves the model, the label hides and the boost is removed.

import { Raycaster, Vector2, Vector3 } from 'three';
import { applyHologramOptions } from './hologramMaterial.js';

/** Rim values used while a part is highlighted. */
const HIGHLIGHT_RIM_INTENSITY = 2.6;
const HIGHLIGHT_RIM_POWER = 1.15;
const HIGHLIGHT_RIM_COLOR = 0xeafcff;

/** Longest name shown in the label before CSS ellipsis takes over. */
export const MAX_LABEL_LENGTH = 64;

/**
 * Name a hit mesh. Files rarely name their meshes, so the fallback has to read
 * well: a single unnamed part is "Model", several are "Part 2 of 5".
 *
 * @param {string|undefined|null} name
 * @param {number} index zero-based
 * @param {number} total
 * @returns {string}
 */
export function partLabel(name, index, total) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length > 0) return trimmed.slice(0, MAX_LABEL_LENGTH);
  const count = Number.isFinite(total) && total > 0 ? Math.floor(total) : 1;
  if (count <= 1) return 'Model';
  const position = Math.min(Math.max(Math.floor(index) + 1, 1), count);
  return `Part ${position} of ${count}`;
}

/**
 * @param {{ stage: HTMLElement, camera: import('three').Camera }} options
 * @returns {{
 *   setModel: (object: import('three').Object3D|null) => void,
 *   setPointer: (point: { x: number, y: number }|null) => void,
 *   update: () => string,
 *   clear: () => void,
 *   label: HTMLElement,
 *   dispose: () => void,
 * }}
 */
export function createInspector({ stage, camera }) {
  const label = document.createElement('div');
  label.className = 'inspect-label';
  label.hidden = true;
  stage.appendChild(label);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const projected = new Vector3();

  /** @type {import('three').Object3D|null} */
  let model = null;
  /** @type {{ x: number, y: number }|null} */
  let point = null;
  /** @type {any} */
  let highlighted = null;
  /** @type {{ rimIntensity: number, rimPower: number }|null} */
  let saved = null;

  function restoreHighlight() {
    if (!highlighted || !saved) return;
    applyHologramOptions(highlighted.material, {
      rimIntensity: saved.rimIntensity,
      rimPower: saved.rimPower,
      rimColor: undefined,
    });
    highlighted = null;
    saved = null;
  }

  function hideLabel() {
    label.hidden = true;
    label.textContent = '';
  }

  /**
   * @param {import('three').Object3D|null} object
   */
  function setModel(object) {
    restoreHighlight();
    hideLabel();
    model = object ?? null;
  }

  /**
   * @param {{ x: number, y: number }|null} next normalized 0..1, top-left origin
   */
  function setPointer(next) {
    if (!next || !Number.isFinite(next.x) || !Number.isFinite(next.y)) {
      point = null;
      return;
    }
    point = { x: Math.min(Math.max(next.x, 0), 1), y: Math.min(Math.max(next.y, 0), 1) };
  }

  /** Meshes that can be inspected, in traversal order (stable numbering). */
  function meshes() {
    const list = [];
    model?.traverse((node) => {
      if (node.isMesh && !node.userData.isHologramOverlay && node.geometry) list.push(node);
    });
    return list;
  }

  /**
   * Raycast, highlight and move the label. Returns the current label text, or
   * '' when nothing is hit, so the caller can mirror it into the UI.
   * @returns {string}
   */
  function update() {
    if (!model || !point) {
      restoreHighlight();
      hideLabel();
      return '';
    }

    pointer.set(point.x * 2 - 1, -(point.y * 2 - 1));
    raycaster.setFromCamera(pointer, camera);

    const list = meshes();
    const hits = raycaster.intersectObject(model, true);
    const hit = hits.find(
      (entry) => entry.object?.isMesh && !entry.object.userData.isHologramOverlay,
    );

    if (!hit) {
      restoreHighlight();
      hideLabel();
      return '';
    }

    if (highlighted !== hit.object) {
      restoreHighlight();
      highlighted = hit.object;
      const uniforms = highlighted.material?.uniforms;
      saved = {
        rimIntensity: Number(uniforms?.uRimIntensity?.value ?? 0),
        rimPower: Number(uniforms?.uRimPower?.value ?? 0),
      };
    }

    applyHologramOptions(hit.object.material, {
      rimIntensity: HIGHLIGHT_RIM_INTENSITY,
      rimPower: HIGHLIGHT_RIM_POWER,
      rimColor: HIGHLIGHT_RIM_COLOR,
    });

    const name = partLabel(hit.object.name, list.indexOf(hit.object), list.length);

    // Project the hit point to screen space for the label.
    projected.copy(hit.point).project(camera);
    const rect = stage.getBoundingClientRect();
    const x = ((projected.x + 1) / 2) * rect.width;
    const y = ((1 - projected.y) / 2) * rect.height;

    label.hidden = false;
    label.textContent = name;
    label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -140%)`;
    return name;
  }

  function clear() {
    point = null;
    restoreHighlight();
    hideLabel();
  }

  return {
    setModel,
    setPointer,
    update,
    clear,
    label,
    dispose() {
      restoreHighlight();
      model = null;
      label.remove();
    },
  };
}
