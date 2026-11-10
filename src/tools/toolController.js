// src/tools/toolController.js
// Owns: the live side of Orbit / Slice / Explode / Inspect. It holds the slice
// plane, the baked cross-section, the explode parts and the inspector, and it is
// the only place tool state turns into scene changes.
//
// It never writes app state: slice position, explode amount and the inspect
// label go back through the callbacks main.js passes in, which route them through
// the sanctioned state mutators. Mode switching itself is main.js's job.
//
// Everything is rebuilt from scratch when a model loads, so a new model can
// never inherit a stale plane, offset or label.

import { Plane, Vector3 } from 'three';
import { verticalDragTarget } from './modeState.js';
import { slicePlane } from './slice.js';
import { bakeTriangles, createSliceSection } from '../render/sliceSection.js';
import { createExplodeModel } from '../render/explodeModel.js';
import { createInspector } from '../render/inspect.js';
import { setClippingPlanes } from '../render/hologramMaterial.js';
import { getHologramMaterials } from '../render/modelLoader.js';
import { setPointCloudClipping } from '../render/pointCloud.js';

/** Slice position per normalized unit of vertical hand travel. */
export const SLICE_DRAG_GAIN = 1.6;
/** Explosion amount per normalized unit of vertical hand travel. */
export const EXPLODE_DRAG_GAIN = 1.2;
/** The same two, per pixel of mouse drag. */
const SLICE_PIXEL_GAIN = 0.0022;
const EXPLODE_PIXEL_GAIN = 0.0016;
/** How fast the rendered explosion catches up with its target, in 1/s. */
const EXPLODE_EASE_RATE = 12;
/** Below this difference the explosion is snapped, restoring exact positions. */
const EXPLODE_SNAP = 0.002;

/**
 * @param {{
 *   stage: HTMLElement,
 *   camera: import('three').Camera,
 *   setSlicePosition: (value: number) => void,
 *   setExplodeAmount: (value: number) => void,
 *   setLabel: (label: string) => void,
 * }} options
 */
export function createToolController({
  stage,
  camera,
  setSlicePosition,
  setExplodeAmount,
  setLabel,
}) {
  const sliceSection = createSliceSection();
  const plane = new Plane(new Vector3(1, 0, 0), 0);
  const planes = [plane];
  const inspector = createInspector({ stage, camera });

  /** @type {import('three').Object3D|null} */
  let model = null;
  /** @type {ReturnType<typeof createExplodeModel>|null} */
  let explodeModel = null;
  let explodeCurrent = 0;
  /** @type {{ x: number, y: number }|null} */
  let hoverPoint = null;
  let labelCache = '';

  /**
   * Clipping is per material: the hologram surface, the wireframe shell and the
   * point cloud all have to be cut, or half the look leaks past the plane.
   * @param {boolean} enabled
   */
  function applyClipping(enabled) {
    const target = enabled ? planes : null;
    for (const material of getHologramMaterials(model)) setClippingPlanes(material, target);
    setPointCloudClipping(model, target);
  }

  /**
   * Rebuild every per-model cache. Called on load and on mode entry, so nothing
   * survives a model swap.
   * @param {import('three').Object3D|null} object
   */
  function setModel(object) {
    sliceSection.object.removeFromParent();
    sliceSection.clear();
    // Put parts back before dropping the cache, so a swap mid-explode does not
    // leave the outgoing model permanently offset if anything still holds it.
    explodeModel?.restore();
    explodeModel?.dispose();
    explodeModel = null;
    explodeCurrent = 0;
    inspector.setModel(null);
    model = object ?? null;

    if (!model) {
      applyClipping(false);
      labelCache = '';
      return;
    }

    sliceSection.setTriangles(bakeTriangles(model));
    model.add(sliceSection.object);
    explodeModel = createExplodeModel(model);
    inspector.setModel(model);
    labelCache = '';
    applyClipping(false);
  }

  /**
   * Push the current tool state into the scene: plane orientation, which side is
   * cut, whether the seam is drawn, and whether Inspect is live.
   *
   * @param {{ mode: string, sliceAxis: string, slicePosition: number }} tool
   */
  function applyState(tool) {
    const slicing = tool.mode === 'slice' && Boolean(model);
    const spec = slicePlane(tool.sliceAxis, tool.slicePosition);

    plane.normal.set(spec.normal.x, spec.normal.y, spec.normal.z);
    plane.constant = -spec.offset;
    applyClipping(slicing);
    sliceSection.setVisible(slicing);
    if (slicing) sliceSection.update(spec, model);

    if (tool.mode !== 'inspect') {
      inspector.clear();
      if (labelCache !== '') {
        labelCache = '';
        setLabel('');
      }
    }
  }

  /**
   * Per-frame work: ease the explosion, keep the seam glued to a rotating model,
   * and run the raycast while Inspect is active.
   *
   * @param {number} dt seconds
   * @param {{ mode: string, sliceAxis: string, slicePosition: number, explode: number }} tool
   * @param {import('../input/gestures.js').GestureState|null} gestureState
   */
  function update(dt, tool, gestureState) {
    const target = tool.mode === 'explode' ? tool.explode : 0;
    if (explodeModel) {
      const alpha = 1 - Math.exp(-EXPLODE_EASE_RATE * Math.max(dt, 0));
      explodeCurrent += (target - explodeCurrent) * alpha;
      if (Math.abs(target - explodeCurrent) < EXPLODE_SNAP) explodeCurrent = target;
      explodeModel.apply(explodeCurrent);
    }

    if (!model) return;

    // The seam is drawn in model space, so it must be rebuilt whenever the model
    // has turned. Cheap enough to do every frame while slicing.
    if (tool.mode === 'slice') {
      sliceSection.update(slicePlane(tool.sliceAxis, tool.slicePosition), model);
      return;
    }

    if (tool.mode !== 'inspect') return;

    const tip = gestureState?.hands?.find((hand) => hand?.indexPoint?.active)?.indexPoint?.tip;
    inspector.setPointer(tip ?? hoverPoint);
    const name = inspector.update();
    if (name !== labelCache) {
      labelCache = name;
      setLabel(name);
    }
  }

  /**
   * The mouse alternative for the vertical axis. Returns true when the mode
   * consumed the drag, so the model does not also pitch.
   *
   * @param {number} deltaPixels
   * @param {{ mode: string, slicePosition: number, explode: number }} tool
   */
  function handleVerticalDrag(deltaPixels, tool) {
    const target = verticalDragTarget(tool.mode);
    if (target === 'pitch') return false;
    if (!model) return true;
    if (target === 'slice') {
      setSlicePosition(tool.slicePosition - deltaPixels * SLICE_PIXEL_GAIN);
    } else if (target === 'explode') {
      setExplodeAmount(tool.explode - deltaPixels * EXPLODE_PIXEL_GAIN);
    }
    return true;
  }

  /**
   * The gesture alternative: the same routing, driven by raw pinch travel.
   *
   * @param {number} dragY normalized vertical pinch travel this frame
   * @param {{ mode: string, slicePosition: number, explode: number }} tool
   */
  function applyGestureVertical(dragY, tool) {
    if (!dragY || !model) return;
    const target = verticalDragTarget(tool.mode);
    if (target === 'slice') {
      setSlicePosition(tool.slicePosition - dragY * SLICE_DRAG_GAIN);
    } else if (target === 'explode') {
      setExplodeAmount(tool.explode - dragY * EXPLODE_DRAG_GAIN);
    }
  }

  /** @param {{ x: number, y: number }|null} point */
  function setPointer(point) {
    hoverPoint = point;
  }

  return {
    setModel,
    applyState,
    update,
    handleVerticalDrag,
    applyGestureVertical,
    setPointer,
    /** @returns {{ separable: boolean, parts: number }} */
    explodeInfo() {
      return {
        separable: Boolean(explodeModel?.separable),
        parts: explodeModel?.parts ?? 0,
      };
    },
    get sliceObject() {
      return sliceSection.object;
    },
    dispose() {
      sliceSection.dispose();
      explodeModel?.dispose();
      inspector.dispose();
      sliceSection.object.removeFromParent();
    },
  };
}
