// src/input/handAcquire.js
// Owns: when to spend a full-frame search on a second hand.
//
// MediaPipe's video mode only runs the palm detector when tracking fails. Once
// one hand is locked, a second hand can stand in frame and never be found.
// The fix is a separate full-frame detector (never flipping the live tracker's
// mode — that rebuild stalls the frame), used for a short search, then kept
// while both hands stay up, and dropped once one leaves.
// Pure, so the rule can be tested without a camera.

/** How often to look for a second hand while video mode is tracking just one. */
export const HAND_SCAN_INTERVAL_MS = 700;

/**
 * Minimum gap between full-frame detections while both hands are already held.
 * Video tracking of one hand stays every frame; this only limits the expensive
 * detector, so the hologram is not waiting on it 60 times a second.
 */
export const IMAGE_DETECT_INTERVAL_MS = 64;

/**
 * @param {number} handCount
 * @param {number} nowMs
 * @param {number} lastScanMs NaN until the first search
 * @param {boolean} pending a search is already running
 * @param {number} [intervalMs]
 * @returns {boolean}
 */
export function shouldScanForAnotherHand(handCount, nowMs, lastScanMs, pending, intervalMs = HAND_SCAN_INTERVAL_MS) {
  if (pending) return false;
  // Zero hands already re-runs palm detection. Two hands are already found.
  if (handCount !== 1) return false;
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(intervalMs) || intervalMs < 0) return false;
  if (!Number.isFinite(lastScanMs)) return true;
  return nowMs - lastScanMs >= intervalMs;
}

/**
 * Whether a full-frame detection is allowed to run again.
 * A missing last time means "never ran", so the first one is due.
 * @param {number} nowMs
 * @param {number} lastDetectMs
 * @param {number} [intervalMs]
 * @returns {boolean}
 */
export function imageDetectDue(nowMs, lastDetectMs, intervalMs = IMAGE_DETECT_INTERVAL_MS) {
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(lastDetectMs)) return true;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return true;
  return nowMs - lastDetectMs >= intervalMs;
}

/**
 * Which detector mode the next frame should use.
 *
 * `image` runs the palm detector and can see every hand, every call.
 * `video` is the cheap tracker and is blind to a hand it did not start with.
 * `to-image` / `to-video` are the one-shot switches.
 *
 * @param {'video'|'image'} mode
 * @param {number} handCount hands the most recent detection returned
 * @param {boolean} scanDue the interval above has elapsed
 * @returns {'video'|'image'|'to-image'|'to-video'}
 */
export function nextDetectorMode(mode, handCount, scanDue) {
  if (mode === 'image') {
    // Stay on the full-frame detector while both hands are up so the second
    // one cannot be dropped the moment video tracking resumes. One hand, or
    // none, means the expensive search is no longer paying for itself.
    return handCount >= 2 ? 'image' : 'to-video';
  }
  return scanDue ? 'to-image' : 'video';
}
