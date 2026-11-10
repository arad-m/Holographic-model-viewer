// src/input/handTracker.js
// Owns: MediaPipe Tasks Vision. One HandLandmarker, pinned package version,
// WASM files and model self-hosted from /public so runtime needs no CDN, VIDEO
// running mode with strictly increasing timestamps, GPU delegate with CPU
// fallback, two hands maximum.
//
// This is the ONE place landmarks become MIRROR SPACE: every landmark x is
// flipped (x = 1 - x) exactly once, here. Nothing downstream flips again, and
// the preview <video> is mirrored separately in CSS to match.
//
// It also draws the skeleton onto the preview canvas (it already has the
// mirror-space points), and nothing else about a hand is interpreted here -
// pinch, ids and status belong to gestures.js.

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { imageDetectDue, nextDetectorMode, shouldScanForAnotherHand } from './handAcquire.js';

/** Self-hosted, version-locked assets (copied from the installed package). */
export const DEFAULT_WASM_BASE_PATH = '/wasm';
export const DEFAULT_MODEL_PATH = '/models/hand_landmarker.task';

const MAX_HANDS = 2;
const DETECTION_THRESHOLDS = Object.freeze({
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

/** MediaPipe hand skeleton edges (index pairs into the 21 landmarks). */
const HAND_CONNECTIONS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]);

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;

const SKELETON_COLOR = 'rgba(111, 224, 255, 0.85)';
const JOINT_COLOR = 'rgba(228, 251, 255, 0.9)';
const PINCH_COLOR = 'rgba(78, 242, 176, 0.95)';

/** Tracker problem with a readable message for the UI. */
export class HandTrackerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HandTrackerError';
  }
}

/**
 * Create the landmarker (GPU first, CPU fallback) bound to a preview canvas.
 *
 * @param {{
 *   canvas?: HTMLCanvasElement|null,
 *   wasmBasePath?: string,
 *   modelPath?: string,
 *   onDelegate?: (delegate: 'GPU'|'CPU') => void,
 * }} [options]
 * @returns {Promise<{
 *   detect: (video: HTMLVideoElement, timestampMs: number) => { hands: Array<{ handedness: 'Left'|'Right'|'Unknown', score: number, landmarks: Array<{x:number,y:number,z:number}> }>, detectionMs: number },
 *   delegate: 'GPU'|'CPU',
 *   dispose: () => void,
 * }>}
 */
export async function createHandTracker(options = {}) {
  const {
    canvas = null,
    wasmBasePath = DEFAULT_WASM_BASE_PATH,
    modelPath = DEFAULT_MODEL_PATH,
    onDelegate,
  } = options;

  let fileset;
  try {
    fileset = await FilesetResolver.forVisionTasks(wasmBasePath);
  } catch (error) {
    throw new HandTrackerError(`Could not load the hand-tracking runtime: ${describe(error)}`);
  }

  const { landmarker, delegate } = await createLandmarker(fileset, modelPath, 'VIDEO');
  if (typeof onDelegate === 'function') onDelegate(delegate);

  const context = canvas ? canvas.getContext('2d') : null;
  let lastTimestamp = -1;
  let disposed = false;
  /** Last hands published. Kept while a second detector is still loading. */
  let lastHands = [];
  /** 'video' tracks cheaply and is blind to a new hand. 'image' sees every hand. */
  let detectorMode = /** @type {'video'|'image'} */ ('video');
  let lastScanMs = Number.NaN;
  let lastImageDetectMs = Number.NaN;
  /** True while the second detector is being created. detect() must not touch it. */
  let scanPending = false;
  /** Full-frame detector. Created on the first search, so startup stays on video. */
  let imageLandmarker = null;
  let creatingImage = false;
  let imageUnavailable = false;

  /**
   * Run one detection. The caller is responsible for calling this at most once
   * per rendered frame.
   */
  function detect(video, timestampMs) {
    if (disposed) return { hands: [], detectionMs: 0 };
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return { hands: [], detectionMs: 0 };
    }

    // The second detector is still loading. A detect() against it would throw.
    if (scanPending) return { hands: lastHands, detectionMs: 0, fullFrame: false };

    const now = performance.now();

    // Both hands are held on the full-frame detector. Running it every painted
    // frame is what made the hologram stutter, so most frames reuse the last
    // sample and only the render runs.
    if (detectorMode === 'image' && !imageDetectDue(now, lastImageDetectMs)) {
      drawHands(context, canvas, video, lastHands);
      return { hands: lastHands, detectionMs: 0, fullFrame: false };
    }

    const scanDue = detectorMode === 'video'
      && shouldScanForAnotherHand(lastHands.length, now, lastScanMs, scanPending);

    if (scanDue && !imageLandmarker) {
      lastScanMs = now;
      void ensureImageLandmarker(video);
    }

    const startedAt = performance.now();
    let hands;
    let fullFrame = false;
    try {
      if (detectorMode === 'image' && imageLandmarker) {
        hands = toMirrorSpaceHands(imageLandmarker.detect(video));
        lastImageDetectMs = performance.now();
        fullFrame = true;
      } else if (scanDue && imageLandmarker) {
        // One full-frame look on its own detector. The live tracker is left in
        // video mode, so this search does not rebuild the graph.
        lastScanMs = now;
        hands = toMirrorSpaceHands(imageLandmarker.detect(video));
        lastImageDetectMs = performance.now();
        fullFrame = true;
      } else {
        hands = toMirrorSpaceHands(detectVideo(video, timestampMs));
      }
    } catch {
      return { hands: lastHands, detectionMs: performance.now() - startedAt, fullFrame: false };
    }
    const detectionMs = performance.now() - startedAt;
    lastHands = hands;

    const next = nextDetectorMode(detectorMode, hands.length, false);
    if (detectorMode === 'video' && fullFrame && hands.length >= 2) {
      detectorMode = 'image';
    } else if (next === 'to-video') {
      detectorMode = 'video';
    }

    drawHands(context, canvas, video, lastHands);
    return { hands: lastHands, detectionMs, fullFrame };
  }

  /**
   * Video-mode inference with a strictly increasing timestamp.
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs
   */
  function detectVideo(video, timestampMs) {
    let timestamp = Math.round(Number.isFinite(timestampMs) ? timestampMs : performance.now());
    if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1;
    lastTimestamp = timestamp;
    return landmarker.detectForVideo(video, timestamp);
  }

  /**
   * Load the full-frame detector once. It is a second landmarker so the one
   * that tracks the first hand never has its running mode flipped — that flip
   * rebuilds the MediaPipe graph and was the stall every few frames.
   * @param {HTMLVideoElement} video
   */
  async function ensureImageLandmarker(video) {
    if (imageLandmarker || creatingImage || imageUnavailable || disposed) return;
    creatingImage = true;
    scanPending = true;
    try {
      const created = await createLandmarker(fileset, modelPath, 'IMAGE');
      if (disposed) {
        created.landmarker.close();
        return;
      }
      imageLandmarker = created.landmarker;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const found = toMirrorSpaceHands(imageLandmarker.detect(video));
        lastImageDetectMs = performance.now();
        if (found.length >= 2) {
          lastHands = found;
          detectorMode = 'image';
          drawHands(context, canvas, video, lastHands);
        }
      }
    } catch {
      imageUnavailable = true;
    } finally {
      creatingImage = false;
      scanPending = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height);
    try {
      landmarker.close();
    } catch {
      // Closing twice is harmless; nothing to recover here.
    }
    try {
      imageLandmarker?.close();
    } catch {
      // The second detector may never have finished loading.
    }
  }

  return { detect, delegate, dispose };
}

/**
 * @param {import('@mediapipe/tasks-vision').WasmFileset} fileset
 * @param {string} modelPath
 */
async function createLandmarker(fileset, modelPath, runningMode) {
  try {
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
      runningMode,
      numHands: MAX_HANDS,
      ...DETECTION_THRESHOLDS,
    });
    return { landmarker, delegate: /** @type {const} */ ('GPU') };
  } catch (gpuError) {
    try {
      const landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
        runningMode,
        numHands: MAX_HANDS,
        ...DETECTION_THRESHOLDS,
      });
      return { landmarker, delegate: /** @type {const} */ ('CPU') };
    } catch (cpuError) {
      throw new HandTrackerError(
        `Could not load the hand model (${describe(gpuError)} / ${describe(cpuError)}).`,
      );
    }
  }
}

/**
 * The single x-flip of the whole app, plus handedness correction.
 *
 * MediaPipe decides Left/Right assuming the input image is already mirrored
 * (a selfie view). We feed it the raw, unmirrored camera frame and mirror the
 * coordinates afterwards, so its label is inverted - swap it here.
 *
 * @param {any} result raw HandLandmarkerResult
 */
function toMirrorSpaceHands(result) {
  const hands = [];
  const landmarkSets = result?.landmarks ?? [];
  const handednessSets = result?.handednesses ?? result?.handedness ?? [];

  for (let index = 0; index < landmarkSets.length; index += 1) {
    const raw = landmarkSets[index];
    if (!Array.isArray(raw) || raw.length === 0) continue;

    const landmarks = raw.map((point) => ({
      x: 1 - point.x,
      y: point.y,
      z: point.z ?? 0,
    }));

    const category = handednessSets[index]?.[0];
    hands.push({
      handedness: mirrorHandedness(category?.categoryName),
      score: Number.isFinite(category?.score) ? category.score : 0,
      landmarks,
    });
  }

  return hands;
}

/** @param {string|undefined} categoryName */
function mirrorHandedness(categoryName) {
  if (categoryName === 'Left') return 'Right';
  if (categoryName === 'Right') return 'Left';
  return 'Unknown';
}

/**
 * Draw the skeleton, joints and pinch marker. Coordinates are already in mirror
 * space, and the canvas is not CSS-mirrored, so they map straight across.
 */
function drawHands(context, canvas, video, hands) {
  if (!context || !canvas) return;

  const width = video?.videoWidth || canvas.clientWidth;
  const height = video?.videoHeight || canvas.clientHeight;
  if (!width || !height) return;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  if (!hands.length) return;

  context.lineWidth = Math.max(2, width / 320);
  context.lineCap = 'round';

  for (const hand of hands) {
    const points = hand.landmarks.map((point) => ({ x: point.x * width, y: point.y * height }));

    context.strokeStyle = SKELETON_COLOR;
    context.beginPath();
    for (const [from, to] of HAND_CONNECTIONS) {
      const a = points[from];
      const b = points[to];
      if (!a || !b) continue;
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
    }
    context.stroke();

    context.fillStyle = JOINT_COLOR;
    for (const point of points) {
      context.beginPath();
      context.arc(point.x, point.y, Math.max(1.6, width / 400), 0, Math.PI * 2);
      context.fill();
    }

    // Thumb and index tips: green ring when pinching, plain rings otherwise.
    const thumb = points[THUMB_TIP];
    const index = points[INDEX_TIP];
    if (thumb && index) {
      const pinching = isPinching(thumb, index, points[WRIST]);
      context.strokeStyle = pinching ? PINCH_COLOR : JOINT_COLOR;
      context.lineWidth = Math.max(1.5, width / 400);
      for (const tip of [thumb, index]) {
        context.beginPath();
        context.arc(tip.x, tip.y, Math.max(3, width / 120), 0, Math.PI * 2);
        context.stroke();
      }
      if (pinching) {
        context.beginPath();
        context.moveTo(thumb.x, thumb.y);
        context.lineTo(index.x, index.y);
        context.stroke();
      }
    }
  }
}

/**
 * Visual-only helper: is this pinch tight enough to draw as active? Uses the same
 * hand-size normalization idea, without the engine's hysteresis (the canvas is
 * decoration; the HUD shows the authoritative state).
 */
function isPinching(thumb, index, wrist, scaleHint) {
  const tipDistance = Math.hypot(thumb.x - index.x, thumb.y - index.y);
  const handSpan = wrist ? Math.hypot(wrist.x - thumb.x, wrist.y - thumb.y) : 0;
  const reference = handSpan > 1 ? handSpan : (scaleHint ?? 40);
  return tipDistance / reference < 0.35;
}

/** @param {unknown} error */
function describe(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
