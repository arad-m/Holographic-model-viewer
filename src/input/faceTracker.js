// src/input/faceTracker.js
// Owns: MediaPipe FaceLandmarker, used only for head position. Same rules as
// handTracker.js - pinned package, self-hosted /wasm and /models assets, VIDEO
// running mode with strictly increasing timestamps, GPU delegate with CPU
// fallback - and the same single mirror flip.
//
// It shares the ONE webcam <video> the hand tracker reads: no second
// getUserMedia call, no second stream, no second camera light.
//
// It reports a head ANCHOR (a stable average of four landmarks) rather than the
// nose alone, so turning your head does not read as moving it, and it never
// touches the preview canvas - face landmarks are not drawn anywhere.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/** Self-hosted, version-locked assets (copied from the installed package). */
export const DEFAULT_WASM_BASE_PATH = '/wasm';
export const DEFAULT_FACE_MODEL_PATH = '/models/face_landmarker.task';

/**
 * Landmarks averaged into the head anchor: both outer eye corners, the nose tip
 * and the chin. Averaging cancels most of a head TURN, which keeps the parallax
 * reading as translation.
 */
const ANCHOR_LANDMARKS = Object.freeze([33, 263, 1, 152]);

/**
 * GPU samples that come back empty before the tracker is rebuilt on CPU.
 * At the medium face rate this is about two seconds of "camera is live, nobody
 * was ever found".
 */
const EMPTY_BEFORE_CPU = 10;

const LANDMARKER_OPTIONS = Object.freeze({
  runningMode: /** @type {const} */ ('VIDEO'),
  numFaces: 1,
  // A little under the hand tracker's 0.5. A face sitting back from the lens
  // was dropping out, and a miss here reads as "parallax does nothing".
  minFaceDetectionConfidence: 0.35,
  minFacePresenceConfidence: 0.35,
  minTrackingConfidence: 0.35,
});

/** Face problem with a readable message for the UI. */
export class FaceTrackerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FaceTrackerError';
  }
}

/**
 * @param {{
 *   wasmBasePath?: string,
 *   modelPath?: string,
 *   onDelegate?: (delegate: 'GPU'|'CPU') => void,
 * }} [options]
 * @returns {Promise<{
 *   detect: (video: HTMLVideoElement, timestampMs: number) => { head: { x: number, y: number }|null, detectionMs: number },
 *   delegate: 'GPU'|'CPU',
 *   dispose: () => void,
 * }>}
 */
export async function createFaceTracker(options = {}) {
  const {
    wasmBasePath = DEFAULT_WASM_BASE_PATH,
    modelPath = DEFAULT_FACE_MODEL_PATH,
    onDelegate,
  } = options;

  let fileset;
  try {
    fileset = await FilesetResolver.forVisionTasks(wasmBasePath);
  } catch (error) {
    throw new FaceTrackerError(`Could not load the face-tracking runtime: ${describe(error)}`);
  }

  let { landmarker, delegate } = await createLandmarker(fileset, modelPath);
  if (typeof onDelegate === 'function') onDelegate(delegate);

  let lastTimestamp = -1;
  let disposed = false;
  let switching = false;
  /** Empty GPU results in a row. Reset the moment a face is seen. */
  let emptyStreak = 0;
  /** Once the GPU has seen a face, walking out of frame must not force a CPU swap. */
  let sawFace = false;

  /**
   * One detection. The caller decides how often to call it - the loop throttles
   * face detection well below the hand rate, because parallax does not need it.
   */
  function detect(video, timestampMs) {
    if (disposed || switching) return { head: null, detectionMs: 0, delegate };
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return { head: null, detectionMs: 0, delegate };
    }

    // STRICTLY increasing timestamps: MediaPipe throws on a repeated one.
    let timestamp = Math.round(Number.isFinite(timestampMs) ? timestampMs : performance.now());
    if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1;
    lastTimestamp = timestamp;

    const startedAt = performance.now();
    let result;
    try {
      result = landmarker.detectForVideo(video, timestamp);
    } catch {
      // A single failed inference is not worth reporting: the next one retries.
      return { head: null, detectionMs: performance.now() - startedAt, delegate };
    }
    const detectionMs = performance.now() - startedAt;
    const head = readHeadAnchor(result);

    if (head) {
      emptyStreak = 0;
      sawFace = true;
    } else {
      emptyStreak += 1;
      // The GPU delegate can come up successfully and then never return a face
      // while the hand tracker is also using the GPU. After a short blind streak
      // that has never seen anyone, rebuild on CPU. A person who was already
      // tracked and then left the frame does not take this path.
      if (delegate === 'GPU' && !sawFace && emptyStreak >= EMPTY_BEFORE_CPU) {
        void fallbackToCpu();
      }
    }

    return { head, detectionMs, delegate };
  }

  async function fallbackToCpu() {
    if (switching || disposed || delegate === 'CPU') return;
    switching = true;
    const previous = landmarker;
    try {
      const next = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
        ...LANDMARKER_OPTIONS,
      });
      if (disposed) {
        try {
          next.close();
        } catch {
          // Already going away.
        }
        return;
      }
      landmarker = next;
      delegate = 'CPU';
      emptyStreak = 0;
      lastTimestamp = -1;
      try {
        previous.close();
      } catch {
        // The GPU graph is abandoned either way.
      }
      if (typeof onDelegate === 'function') onDelegate(delegate);
    } catch {
      // Stay on the GPU graph. The next samples try again via the streak.
      emptyStreak = 0;
    } finally {
      switching = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      landmarker.close();
    } catch {
      // Closing twice is harmless.
    }
  }

  return { detect, delegate, dispose };
}

/** @param {import('@mediapipe/tasks-vision').WasmFileset} fileset @param {string} modelPath */
async function createLandmarker(fileset, modelPath) {
  try {
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
      ...LANDMARKER_OPTIONS,
    });
    return { landmarker, delegate: /** @type {const} */ ('GPU') };
  } catch (gpuError) {
    try {
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
        ...LANDMARKER_OPTIONS,
      });
      return { landmarker, delegate: /** @type {const} */ ('CPU') };
    } catch (cpuError) {
      throw new FaceTrackerError(
        `Could not load the face model (${describe(gpuError)} / ${describe(cpuError)}).`,
      );
    }
  }
}

/**
 * Head position in MIRROR space, the same convention handTracker uses: x is
 * flipped once here, so +x is the side the user sees on their own right.
 *
 * @param {any} result raw FaceLandmarkerResult
 * @returns {{ x: number, y: number }|null}
 */
export function readHeadAnchor(result) {
  const landmarks = result?.faceLandmarks?.[0];
  if (!Array.isArray(landmarks) || landmarks.length === 0) return null;

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const index of ANCHOR_LANDMARKS) {
    const point = landmarks[index];
    if (!point) continue;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    sumX += point.x;
    sumY += point.y;
    count += 1;
  }
  if (count === 0) return null;

  return { x: 1 - sumX / count, y: sumY / count };
}

/** Last crosshair, so a frame that did not clear the canvas can erase just it. */
const faceMarker = { x: 0, y: 0, r: 0, active: false };

/**
 * Draw a crosshair on the landmark canvas at the head anchor.
 * Coordinates are already in mirror space, same as the hand skeleton, so this
 * lines up with the mirrored preview without flipping the canvas.
 *
 * Pass `canvasCleared: true` when the hand tracker just wiped the canvas.
 * Otherwise the previous crosshair is erased first, so it does not smear.
 *
 * @param {HTMLCanvasElement|null|undefined} canvas
 * @param {HTMLVideoElement|null|undefined} video
 * @param {{ x: number, y: number }|null} head
 * @param {{ canvasCleared?: boolean }} [options]
 */
export function drawFaceAnchor(canvas, video, head, { canvasCleared = false } = {}) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;

  const width = video?.videoWidth || canvas.width;
  const height = video?.videoHeight || canvas.height;
  if (!width || !height) return;

  if (!canvasCleared && faceMarker.active) {
    const pad = faceMarker.r + 3;
    context.clearRect(faceMarker.x - pad, faceMarker.y - pad, pad * 2, pad * 2);
    faceMarker.active = false;
  }

  if (!head || !Number.isFinite(head.x) || !Number.isFinite(head.y)) return;

  const x = head.x * width;
  const y = head.y * height;
  const radius = Math.max(12, width / 42);

  context.save();
  context.strokeStyle = '#7dffc4';
  context.fillStyle = '#7dffc4';
  context.lineWidth = Math.max(2, width / 360);
  context.lineCap = 'round';
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(x - radius * 1.7, y);
  context.lineTo(x - radius * 0.45, y);
  context.moveTo(x + radius * 0.45, y);
  context.lineTo(x + radius * 1.7, y);
  context.moveTo(x, y - radius * 1.7);
  context.lineTo(x, y - radius * 0.45);
  context.moveTo(x, y + radius * 0.45);
  context.lineTo(x, y + radius * 1.7);
  context.stroke();
  context.beginPath();
  context.arc(x, y, Math.max(2, radius * 0.16), 0, Math.PI * 2);
  context.fill();
  context.restore();

  faceMarker.x = x;
  faceMarker.y = y;
  faceMarker.r = radius * 1.9;
  faceMarker.active = true;
}

/** @param {unknown} error */
function describe(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
