// src/input/mouseControls.js
// Owns: pointer and wheel input for the transform the hand gestures will later
// drive. Left-drag orbits, right-drag (or shift-drag) pans, wheel zooms within a
// clamp, double-click resets the view.
//
// It writes only through state.js mutators - never by touching `state` fields
// directly - so mouse and gestures share one transform path, and every write is
// `silent` (no 'state:changed' flood while dragging).
//
// It also reports isInteracting(), which the loop uses to pause idle
// auto-rotation while the user is dragging.

import { setTransform, resetTransform, state } from '../state.js';
import { tumbleTransform } from '../render/orientation.js';
import { INERTIA_DAMPING, INERTIA_STOP, MAX_INERTIA_VELOCITY } from './gestures.js';
import { sortPointers, touchDelta } from './touchGestures.js';

/** Radians of rotation per pixel dragged. */
const ROTATE_SPEED = 0.0062;
/** World units of pan per pixel dragged. */
const PAN_SPEED = 0.0042;
/** Zoom exponential rate per wheel pixel. */
const ZOOM_SPEED = 0.0016;

const MIN_SCALE = 0.35;
const MAX_SCALE = 4;
const MAX_PAN = 2.2;
/** Some mice report wheel deltas in lines (deltaMode 1). */
const LINE_HEIGHT_PX = 16;

/**
 * @param {HTMLElement} element the canvas (or any full-size surface)
 * @param {{
 *   onVerticalDrag?: (deltaPixels: number) => boolean,
 *   onHover?: (point: { x: number, y: number }) => void,
 *   onLeave?: () => void,
 * }} [handlers]
 *   onVerticalDrag: offered the vertical part of every left-drag. Returning true
 *   consumes it, so Slice and Explode move instead of pitching the model.
 * @returns {{
 *   isInteracting: () => boolean,
 *   coast: (dt: number) => { pitch: number, yaw: number },
 *   cancelCoast: () => void,
 *   dispose: () => void,
 * }}
 */
export function attachMouseControls(element, handlers = {}) {
  if (!element) throw new Error('attachMouseControls: an element is required');
  const { onVerticalDrag, onHover, onLeave } = handlers;

  /** @type {'rotate'|'pan'|null} */
  let dragMode = null;
  let activePointerId = null;
  let lastX = 0;
  let lastY = 0;

  /** Live touch pointers by pointerId - a separate world from the mouse drag. */
  const touches = new Map();
  /** The pointer set the last touch delta was measured from. */
  let lastTouches = [];
  /** Angular velocity left behind by a rotate drag, in rad/s. */
  let spin = { pitch: 0, yaw: 0 };
  let spinStamp = 0;

  function onPointerDown(event) {
    // Touch gets its own path: one finger rotates, two pinch/zoom and pan. It
    // never shares dragMode with the mouse, so a finger and a mouse cannot fight.
    if (event.pointerType === 'touch') {
      if (touches.size === 0) {
        spin = { pitch: 0, yaw: 0 };
        spinStamp = 0;
      }
      touches.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
      // A new finger is an anchor, not a movement (touchDelta sees the count change).
      lastTouches = sortPointers(touches.values());
      element.setPointerCapture?.(event.pointerId);
      element.classList.add('is-dragging');
      event.preventDefault();
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    dragMode = event.button === 2 || event.shiftKey ? 'pan' : 'rotate';
    if (dragMode === 'rotate') {
      spin = { pitch: 0, yaw: 0 };
      spinStamp = 0;
    }
    activePointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    element.setPointerCapture(activePointerId);
    element.classList.add('is-dragging');
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (event.pointerType === 'touch') {
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
      const current = sortPointers(touches.values());
      applyTouchDelta(touchDelta(lastTouches, current));
      lastTouches = current;
      event.preventDefault();
      return;
    }

    if (!dragMode || event.pointerId !== activePointerId) return;

    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    if (dragMode === 'rotate') {
      // Horizontal always turns the model. The vertical part belongs to the
      // active mode when it wants it (Slice / Explode); otherwise it tumbles.
      const consumed =
        typeof onVerticalDrag === 'function' ? onVerticalDrag(deltaY) === true : false;
      applyTumble(consumed ? 0 : deltaY * ROTATE_SPEED, deltaX * ROTATE_SPEED);
    } else {
      setTransform(
        {
          panX: clamp(state.transform.panX + deltaX * PAN_SPEED, -MAX_PAN, MAX_PAN),
          panY: clamp(state.transform.panY - deltaY * PAN_SPEED, -MAX_PAN, MAX_PAN),
        },
        { silent: true },
      );
    }
  }

  /**
   * Apply one touch delta through the same clamps and signs as the mouse.
   * @param {{ kind: string, dx: number, dy: number, zoomFactor: number }} delta
   */
  function applyTouchDelta(delta) {
    if (!delta || delta.kind === 'none') return;

    if (delta.kind === 'rotate') {
      // One finger behaves like a left-drag: horizontal rotates, and the vertical
      // part goes to Slice / Explode when the active mode wants it.
      const consumed =
        typeof onVerticalDrag === 'function' ? onVerticalDrag(delta.dy) === true : false;
      applyTumble(consumed ? 0 : delta.dy * ROTATE_SPEED, delta.dx * ROTATE_SPEED);
      return;
    }

    // A pinch or a pan is not a flick. Drop any spin the previous finger left.
    spin = { pitch: 0, yaw: 0 };
    spinStamp = 0;

    // Two fingers: the centroid drag pans (same signs as a right-drag) and the
    // span ratio zooms, in one combined gesture.
    if (delta.dx !== 0 || delta.dy !== 0) {
      setTransform(
        {
          panX: clamp(state.transform.panX + delta.dx * PAN_SPEED, -MAX_PAN, MAX_PAN),
          panY: clamp(state.transform.panY - delta.dy * PAN_SPEED, -MAX_PAN, MAX_PAN),
        },
        { silent: true },
      );
    }
    if (delta.zoomFactor !== 1) {
      setTransform(
        { scale: clamp(state.transform.scale * delta.zoomFactor, MIN_SCALE, MAX_SCALE) },
        { silent: true },
      );
    }
  }

  function endDrag(event) {
    const id = event?.pointerId;
    // Touch pointers live in `touches`. Match on the id as well as pointerType:
    // a lostpointercapture that arrives without a type must still drop the finger,
    // or a two-finger pinch keeps a ghost contact and the next move jumps.
    if (event?.pointerType === 'touch' || (id !== undefined && touches.has(id))) {
      if (id !== undefined) {
        touches.delete(id);
        if (element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
      }
      // Lifting one of two fingers re-anchors rather than jumping.
      lastTouches = sortPointers(touches.values());
      if (touches.size === 0) element.classList.remove('is-dragging');
      return;
    }

    if (!dragMode) return;
    if (dragMode === 'pan') spin = { pitch: 0, yaw: 0 };
    dragMode = null;
    if (activePointerId !== null && element.hasPointerCapture?.(activePointerId)) {
      element.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    element.classList.remove('is-dragging');
  }

  function onWheel(event) {
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? LINE_HEIGHT_PX : 1);
    const nextScale = clamp(state.transform.scale * Math.exp(-pixels * ZOOM_SPEED), MIN_SCALE, MAX_SCALE);
    setTransform({ scale: nextScale }, { silent: true });
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  function onDoubleClick() {
    resetTransform();
  }

  /** Report the pointer in normalized 0..1 space, for Inspect's mouse path. */
  function onPointerHover(event) {
    // A finger drag is not a hover. Touch shares this pointermove listener, and
    // dragMode stays null for fingers, so without this guard Inspect would
    // raycast on every touch move.
    if (dragMode || touches.size > 0 || event.pointerType === 'touch') return;
    if (typeof onHover !== 'function') return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onHover({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }

  function onPointerLeave() {
    if (typeof onLeave === 'function') onLeave();
  }

  // Older Safari still pinch-zooms the page on gesture* even with touch-action.
  function blockBrowserGesture(event) {
    event.preventDefault();
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('lostpointercapture', endDrag);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', onContextMenu);
  element.addEventListener('dblclick', onDoubleClick);
  element.addEventListener('pointermove', onPointerHover);
  element.addEventListener('pointerleave', onPointerLeave);
  element.addEventListener('gesturestart', blockBrowserGesture, { passive: false });
  element.addEventListener('gesturechange', blockBrowserGesture, { passive: false });

  /**
   * Fold one screen-space tumble into the orientation and remember its speed
   * so a release can coast instead of stopping dead.
   * @param {number} pitch
   * @param {number} yaw
   */
  function applyTumble(pitch, yaw) {
    if (!pitch && !yaw) return;
    setTransform(tumbleTransform(state.transform, pitch, yaw), { silent: true });
    const now = performance.now();
    const dt = spinStamp > 0 ? (now - spinStamp) / 1000 : 0;
    spinStamp = now;
    if (!(dt >= 0.008 && dt <= 0.08)) {
      if (dt > 0.08) spin = { pitch: 0, yaw: 0 };
      return;
    }
    let pitchRate = pitch / dt;
    let yawRate = yaw / dt;
    const speed = Math.hypot(pitchRate, yawRate);
    if (speed > MAX_INERTIA_VELOCITY) {
      const scale = MAX_INERTIA_VELOCITY / speed;
      pitchRate *= scale;
      yawRate *= scale;
    }
    spin = { pitch: pitchRate, yaw: yawRate };
  }

  return {
    /** True while the pointer or any finger is down - the loop pauses auto-rotation. */
    isInteracting: () => dragMode !== null || touches.size > 0,
    /**
     * Angles to apply this frame after a rotate drag has been released.
     * Zero while a finger or the rotate button is still down.
     * @param {number} dt seconds
     */
    coast(dt) {
      if (dragMode !== null || touches.size > 0) return { pitch: 0, yaw: 0 };
      const step = coastDecay(spin, dt);
      spin = step.velocity;
      return { pitch: step.pitch, yaw: step.yaw };
    },
    cancelCoast() {
      spin = { pitch: 0, yaw: 0 };
      spinStamp = 0;
    },
    dispose() {
      touches.clear();
      lastTouches = [];
      endDrag();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      element.removeEventListener('lostpointercapture', endDrag);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('pointermove', onPointerHover);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('gesturestart', blockBrowserGesture);
      element.removeEventListener('gesturechange', blockBrowserGesture);
    },
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * @param {{ pitch: number, yaw: number }} velocity
 * @param {number} dt
 */
function coastDecay(velocity, dt) {
  const speed = Math.hypot(velocity.pitch, velocity.yaw);
  if (!(dt > 0) || !(speed > INERTIA_STOP)) {
    return { pitch: 0, yaw: 0, velocity: { pitch: 0, yaw: 0 } };
  }
  const decay = Math.exp(-INERTIA_DAMPING * dt);
  const pitch = velocity.pitch * decay;
  const yaw = velocity.yaw * decay;
  const nextSpeed = Math.hypot(pitch, yaw);
  return {
    pitch: velocity.pitch * dt,
    yaw: velocity.yaw * dt,
    velocity: nextSpeed > INERTIA_STOP ? { pitch, yaw } : { pitch: 0, yaw: 0 },
  };
}
