// src/loop.js
// Owns: the single requestAnimationFrame loop. One rAF for the whole app; every
// per-frame system registers a callback here instead of starting its own loop.
//
// Frame-rate independence: callbacks receive `dt` in SECONDS, clamped so that a
// background-tab stall or a debugger pause cannot teleport the animation. All
// smoothing/damping in the app must use `dt` (e.g. alpha = 1 - exp(-rate * dt)),
// never a fixed per-frame factor.

/** Longest frame time we ever report, in seconds (i.e. treat anything slower as 15 fps). */
const MAX_FRAME_DT = 1 / 15;

/** @typedef {(dt: number, elapsed: number) => void} UpdateCallback */

/** @type {Set<UpdateCallback>} */
const updateCallbacks = new Set();

let frameHandle = 0;
let lastTimestamp = 0;
let elapsedSeconds = 0;
let running = false;

/**
 * Register a per-frame update. Returns an unsubscribe function.
 * @param {UpdateCallback} callback
 * @returns {() => boolean}
 */
export function addUpdate(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('loop.addUpdate: callback must be a function');
  }
  updateCallbacks.add(callback);
  return () => updateCallbacks.delete(callback);
}

/**
 * Remove a previously registered update.
 * @param {UpdateCallback} callback
 * @returns {boolean} true if it was registered
 */
export function removeUpdate(callback) {
  return updateCallbacks.delete(callback);
}

/** Number of registered updates (useful for debugging/tests). */
export function updateCount() {
  return updateCallbacks.size;
}

/** True while the loop is scheduled. */
export function isRunning() {
  return running;
}

/** Seconds of loop time accumulated since startLoop() (dt-clamped, not wall clock). */
export function getElapsed() {
  return elapsedSeconds;
}

/**
 * @param {number} timestamp high-resolution time from rAF, in milliseconds
 */
function frame(timestamp) {
  if (!running) return;

  const dt = lastTimestamp === 0 ? 0 : Math.min((timestamp - lastTimestamp) / 1000, MAX_FRAME_DT);
  lastTimestamp = timestamp;
  elapsedSeconds += dt;

  // Snapshot so a callback may add/remove updates during dispatch.
  const callbacks = Array.from(updateCallbacks);
  for (const callback of callbacks) {
    try {
      callback(dt, elapsedSeconds);
    } catch (error) {
      // One bad frame must not cancel the next one. An uncaught throw here
      // used to stop the loop for good: the model froze until a reload.
      console.error('Frame update failed', error);
    }
  }

  frameHandle = requestAnimationFrame(frame);
}

/** Start (or restart) the loop. Idempotent. */
export function startLoop() {
  if (running) return;
  running = true;
  lastTimestamp = 0;
  elapsedSeconds = 0;
  frameHandle = requestAnimationFrame(frame);
}

/** Stop the loop and cancel the pending frame. Idempotent. */
export function stopLoop() {
  if (!running) return;
  running = false;
  lastTimestamp = 0;
  if (frameHandle !== 0) {
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
}
