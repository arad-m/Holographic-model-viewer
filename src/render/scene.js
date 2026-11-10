// src/render/scene.js
// Owns: the Three.js renderer, scene, camera, the pedestal furniture under the
// model (glowing base ring, faint inner rings, tick marks) and resize handling.
// It is the only module that creates a WebGLRenderer and the only one that calls
// renderer.render().
//
// It never reads raw landmarks or gesture internals: the caller hands it plain
// `state.transform` numbers through applyTransform(), so later phases only have
// to change state.
//
// Units: modelLoader normalizes every model to TARGET_SIZE (1.6 world units
// across), so the camera sits at z = 4.6 looking slightly down at the origin and
// the pedestal ring sits at y = -0.92.

import { readQuat } from './orientation.js';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

const BACKGROUND_COLOR = 0x04060a;
const HOLOGRAM_COLOR = 0x6fe0ff;

const CAMERA_FOV = 40;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;
const CAMERA_POSITION = { x: 0, y: 0.62, z: 4.6 };
const CAMERA_TARGET = { x: 0, y: -0.02, z: 0 };

/**
 * World units that must stay visible: the 1.6-unit model plus air for rotation,
 * and enough height for the pedestal ring. A portrait viewport has a narrower
 * horizontal field of view, so the camera has to back off until this still fits.
 */
const FIT_WIDTH = 2.6;
const FIT_HEIGHT = 2.6;

/** Offset from the look-at point to the resting camera, and its length. */
const BASE_OFFSET = Object.freeze({
  x: CAMERA_POSITION.x - CAMERA_TARGET.x,
  y: CAMERA_POSITION.y - CAMERA_TARGET.y,
  z: CAMERA_POSITION.z - CAMERA_TARGET.z,
});
const BASE_DISTANCE = Math.hypot(BASE_OFFSET.x, BASE_OFFSET.y, BASE_OFFSET.z);

/**
 * Fraction of the parallax offset that the look-at point follows.
 * 0 would keep the hologram dead centre. 1 would slide it without showing a side.
 */
const PARALLAX_LOOK_FOLLOW = 0.4;

/**
 * Distance the camera needs at a given aspect ratio. The vertical field of view
 * is fixed, so the horizontal one shrinks with the aspect: a phone-shaped viewport
 * would crop the model in half without this dolly.
 *
 * Pure, so the framing rule is testable without a renderer.
 *
 * @param {number} aspect width / height
 * @returns {number} distance from the look-at point
 */
export function cameraDistanceFor(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return BASE_DISTANCE;
  const tanHalfV = Math.tan((CAMERA_FOV * Math.PI) / 360);
  const forWidth = FIT_WIDTH / (2 * tanHalfV * aspect);
  const forHeight = FIT_HEIGHT / (2 * tanHalfV);
  // Never move closer than the authored framing, never further than needed.
  return Math.max(forWidth, forHeight, BASE_DISTANCE);
}

const PEDESTAL_Y = -0.92;
const PEDESTAL_RADIUS = 1.62;
const PEDESTAL_TICKS = 60;

const MAX_PIXEL_RATIO = 2;

/**
 * @param {HTMLElement} container element the canvas is appended to
 */
export function createScene(container) {
  if (!container) throw new Error('createScene: a container element is required');

  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(BACKGROUND_COLOR, 1);
  // Slice mode clips per material (material.clippingPlanes), which the renderer
  // only honours when local clipping is switched on.
  renderer.localClippingEnabled = true;
  renderer.domElement.classList.add('stage-canvas');
  container.appendChild(renderer.domElement);

  const scene = new Scene();

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
  camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);

  const pedestal = createPedestal();
  scene.add(pedestal.group);

  /** Framing multiplier from the last resize (portrait backs the camera off). */
  let framingScale = 1;
  /** Parallax offset in world units, added on top of the framing position. */
  let cameraOffset = { x: 0, y: 0 };

  /**
   * Place the camera from the framing rule plus the current parallax offset.
   *
   * The camera moves the full offset. The look-at point follows only part of the
   * way, so two things happen at once: the viewing angle changes (you see the
   * side of the model) and the hologram slides in the frame. Following all the
   * way would be a pan. Following none of the way keeps the model glued to the
   * centre, and a small orbit then looks like nothing on a dark stage.
   *
   * Both are scaled by the framing distance. On a tall phone the camera has
   * backed away, and an unscaled nudge would shrink to a smaller angle.
   */
  function placeCamera() {
    const shift = framingScale;
    camera.position.set(
      CAMERA_TARGET.x + BASE_OFFSET.x * shift + cameraOffset.x * shift,
      CAMERA_TARGET.y + BASE_OFFSET.y * shift + cameraOffset.y * shift,
      CAMERA_TARGET.z + BASE_OFFSET.z * shift,
    );
    camera.lookAt(
      CAMERA_TARGET.x + cameraOffset.x * PARALLAX_LOOK_FOLLOW * shift,
      CAMERA_TARGET.y + cameraOffset.y * PARALLAX_LOOK_FOLLOW * shift,
      CAMERA_TARGET.z,
    );
  }

  let resizeRetry = false;

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    // A hidden or mid-layout stage reports 0. Try once on the next frame so a
    // resize that lands during that moment is not stuck at the old aspect.
    if (width === 0 || height === 0) {
      if (!resizeRetry) {
        resizeRetry = true;
        requestAnimationFrame(() => {
          resizeRetry = false;
          resize();
        });
      }
      return;
    }
    camera.aspect = width / height;

    // Keep the authored framing on landscape screens; on portrait ones back off
    // along the same sight line until the model still fits across.
    framingScale = cameraDistanceFor(camera.aspect) / BASE_DISTANCE;
    placeCamera();

    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  /**
   * Parallax: nudge the viewpoint without touching the framing rule.
   * @param {{ x: number, y: number }} offset world units, already clamped
   */
  function setCameraOffset(offset) {
    const x = Number.isFinite(offset?.x) ? offset.x : 0;
    const y = Number.isFinite(offset?.y) ? offset.y : 0;
    if (x === cameraOffset.x && y === cameraOffset.y) return;
    cameraOffset = { x, y };
    placeCamera();
  }

  /**
   * Quality: how many device pixels one CSS pixel is worth.
   * @param {number} ratio
   */
  function setPixelRatio(ratio) {
    const next = Math.min(Math.max(Number.isFinite(ratio) ? ratio : 1, 0.5), MAX_PIXEL_RATIO);
    if (Math.abs(renderer.getPixelRatio() - next) < 0.001) return;
    renderer.setPixelRatio(next);
    resize();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  // Orientation changes and the mobile browser chrome resize the visual
  // viewport. The observer catches a container size change; these catch the
  // cases where the container's box lags a frame behind the viewport.
  const onViewportChange = () => resize();
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  window.visualViewport?.addEventListener('resize', onViewportChange);

  const canvas = renderer.domElement;
  const onContextLost = (event) => {
    // Without preventDefault the browser will not fire contextrestored.
    event.preventDefault();
  };
  const onContextRestored = () => resize();
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  resize();
  renderer.render(scene, camera);

  /**
   * Draw one frame. `elapsed` is seconds of loop time and drives the pedestal
   * pulse only.
   * @param {number} elapsed
   */
  function render(elapsed = 0) {
    pedestal.update(elapsed);
    renderer.render(scene, camera);
  }

  function addObject(object) {
    if (object) scene.add(object);
  }

  function removeObject(object) {
    if (object && object.parent === scene) scene.remove(object);
  }

  function dispose() {
    resizeObserver.disconnect();
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('orientationchange', onViewportChange);
    window.visualViewport?.removeEventListener('resize', onViewportChange);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    pedestal.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    renderer,
    scene,
    camera,
    addObject,
    removeObject,
    render,
    resize,
    setCameraOffset,
    setPixelRatio,
    dispose,
  };
}

/**
 * Write `state.transform` onto a loaded model: the single place transform values
 * become three.js properties.
 *
 * @param {import('three').Object3D|null} object
 * @param {{ qx?: number, qy?: number, qz?: number, qw?: number, panX: number, panY: number, scale: number }} transform
 * @param {number} [baseScale] loader-normalized scale from state.model.baseScale
 */
export function applyTransform(object, transform, baseScale = 1) {
  if (!object || !transform) return;
  const orientation = readQuat(transform);
  object.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
  object.position.set(transform.panX, transform.panY, 0);
  object.scale.setScalar(baseScale * transform.scale);
}

/** Base ring, two faint inner rings and tick marks, all additive line work. */
function createPedestal() {
  const color = new Color(HOLOGRAM_COLOR);
  const group = new Group();
  group.position.y = PEDESTAL_Y;

  const brightMaterial = new LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.46,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const faintMaterial = new LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.15,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  const outerSegments = [];
  pushCircleSegments(outerSegments, PEDESTAL_RADIUS, 180);
  for (let index = 0; index < PEDESTAL_TICKS; index += 1) {
    const angle = (index / PEDESTAL_TICKS) * Math.PI * 2;
    const isMajor = index % 5 === 0;
    const inner = PEDESTAL_RADIUS + 0.05;
    const outer = PEDESTAL_RADIUS + (isMajor ? 0.24 : 0.11);
    outerSegments.push(Math.cos(angle) * inner, 0, Math.sin(angle) * inner);
    outerSegments.push(Math.cos(angle) * outer, 0, Math.sin(angle) * outer);
  }

  const faintSegments = [];
  pushCircleSegments(faintSegments, PEDESTAL_RADIUS * 0.66, 128);
  pushCircleSegments(faintSegments, PEDESTAL_RADIUS * 0.34, 96);

  const bright = new LineSegments(makeGeometry(outerSegments), brightMaterial);
  const faint = new LineSegments(makeGeometry(faintSegments), faintMaterial);
  group.add(bright, faint);

  function update(elapsed) {
    brightMaterial.opacity = 0.42 + 0.1 * Math.sin(elapsed * 1.7);
  }

  function dispose() {
    bright.geometry.dispose();
    faint.geometry.dispose();
    brightMaterial.dispose();
    faintMaterial.dispose();
  }

  return { group, update, dispose };
}

/**
 * Append line-segment pairs approximating a circle on the XZ plane.
 * @param {number[]} target
 * @param {number} radius
 * @param {number} segments
 */
function pushCircleSegments(target, radius, segments) {
  for (let index = 0; index < segments; index += 1) {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    target.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius);
    target.push(Math.cos(a1) * radius, 0, Math.sin(a1) * radius);
  }
}

/** @param {number[]} values */
function makeGeometry(values) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(values, 3));
  return geometry;
}
