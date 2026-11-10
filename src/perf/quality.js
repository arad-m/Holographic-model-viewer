// src/perf/quality.js
// Owns: the three quality levels and the rule that steps down when the machine
// cannot keep up.
//
// A level bundles the four things that actually cost frames - the renderer's
// pixel ratio, how often hands are detected, how often the face is detected, and
// how heavy the shader effects are - so "Low / Medium / High" means one decision
// instead of four sliders that can contradict each other.
//
// Pure: no DOM, no renderer, no MediaPipe. main.js applies a level; this module
// decides what a level is and when to drop to the next one.

/** Levels, cheapest first, so stepping down is just an index move. */
export const QUALITY_LEVELS = Object.freeze([
  Object.freeze({
    id: 'low',
    label: 'Low',
    /** Multiplier on devicePixelRatio, capped by MAX_PIXEL_RATIO. */
    pixelRatio: 1,
    /** Minimum gap between hand detections, ms. */
    handIntervalMs: 66,
    /** Minimum gap between face detections, ms. */
    faceIntervalMs: 500,
    /** Multiplier on flicker / glitch depth. */
    effects: 0.4,
    description: '1x pixels, hands at 15 Hz, face at 2 Hz, minimal effects',
  }),
  Object.freeze({
    id: 'medium',
    label: 'Medium',
    pixelRatio: 1.5,
    handIntervalMs: 33,
    faceIntervalMs: 180,
    effects: 0.75,
    description: '1.5x pixels, hands at 30 Hz, face at about 6 Hz',
  }),
  Object.freeze({
    id: 'high',
    label: 'High',
    pixelRatio: 2,
    handIntervalMs: 0,
    faceIntervalMs: 100,
    effects: 1,
    description: '2x pixels, hands every frame, face at 10 Hz',
  }),
]);

/** Never render above this, whatever the device claims. */
export const MAX_PIXEL_RATIO = 2;

export const DEFAULT_QUALITY = 'medium';

/** Ids, cheapest first. */
export const QUALITY_IDS = Object.freeze(QUALITY_LEVELS.map((level) => level.id));

/**
 * @param {string} id
 * @returns {(typeof QUALITY_LEVELS)[number]}
 */
export function findQuality(id) {
  return QUALITY_LEVELS.find((level) => level.id === id) ?? findQuality(DEFAULT_QUALITY);
}

/**
 * The next level down, or null when already at the bottom.
 * @param {string} id
 * @returns {string|null}
 */
export function nextQualityDown(id) {
  const index = QUALITY_IDS.indexOf(id);
  if (index <= 0) return null;
  return QUALITY_IDS[index - 1];
}

/**
 * Pixel ratio to hand the renderer.
 * @param {string} id
 * @param {number} [devicePixelRatio]
 * @returns {number}
 */
export function effectivePixelRatio(id, devicePixelRatio = 1) {
  const level = findQuality(id);
  const device = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(device, MAX_PIXEL_RATIO, level.pixelRatio);
}

/**
 * Should this frame run a hand detection?
 * @param {string} id
 * @param {number} nowMs
 * @param {number} lastDetectionMs
 * @returns {boolean}
 */
export function handsDue(id, nowMs, lastDetectionMs) {
  const level = findQuality(id);
  if (level.handIntervalMs <= 0) return true;
  if (!Number.isFinite(lastDetectionMs)) return true;
  return nowMs - lastDetectionMs >= level.handIntervalMs;
}

/**
 * Should this frame run a face detection? Faces are always far cheaper-rate
 * than hands: parallax needs a position, not a per-frame one.
 * @param {string} id
 * @param {number} nowMs
 * @param {number} lastDetectionMs
 * @returns {boolean}
 */
export function faceDue(id, nowMs, lastDetectionMs) {
  const level = findQuality(id);
  if (!Number.isFinite(lastDetectionMs)) return true;
  return nowMs - lastDetectionMs >= level.faceIntervalMs;
}

/** How strongly flicker and glitch are applied at this level (0..1). */
export function effectScale(id) {
  return findQuality(id).effects;
}

/**
 * The auto-downgrade watchdog.
 *
 * It exists because the honest answer to "will this run at 60 fps on this
 * machine" is "nobody knows until it tries". Rather than guess from the device,
 * watch the measured frame rate: if it stays under `thresholdFps` for a full
 * `seconds` window, step one level down. It only ever steps down - climbing back
 * up on a momentary spike would flap - and it stops at Low.
 *
 * @param {{
 *   thresholdFps?: number,
 *   seconds?: number,
 *   startLevel?: string,
 *   onDowngrade?: (from: string, to: string, fps: number) => void,
 * }} [options]
 */
export function createAutoQuality(options = {}) {
  const thresholdFps = Number.isFinite(options.thresholdFps) ? options.thresholdFps : 30;
  const windowMs = (Number.isFinite(options.seconds) ? options.seconds : 5) * 1000;
  const onDowngrade = typeof options.onDowngrade === 'function' ? options.onDowngrade : null;

  let level = options.startLevel && QUALITY_IDS.includes(options.startLevel)
    ? options.startLevel
    : DEFAULT_QUALITY;
  /**
   * When the current run of low readings started, or null when the frame rate is
   * healthy. Deliberately null rather than 0: performance.now() legitimately
   * returns 0 at page load, and a 0 sentinel would throw that first reading away.
   * @type {number|null}
   */
  let lowSince = null;
  let lastFps = 0;

  /**
   * Feed one frame-rate reading.
   * @param {number} fps
   * @param {number} nowMs
   * @returns {{ downgraded: boolean, level: string }}
   */
  function sample(fps, nowMs) {
    if (!Number.isFinite(fps) || fps <= 0) return { downgraded: false, level };
    lastFps = fps;

    if (fps >= thresholdFps) {
      lowSince = null;
      return { downgraded: false, level };
    }

    if (lowSince === null) {
      lowSince = Number.isFinite(nowMs) ? nowMs : 0;
      return { downgraded: false, level };
    }

    const elapsed = (Number.isFinite(nowMs) ? nowMs : 0) - lowSince;
    if (elapsed < windowMs) return { downgraded: false, level };

    const next = nextQualityDown(level);
    if (!next) {
      // Already at the bottom: stop holding the window open, so the check costs
      // nothing more until the frame rate recovers.
      lowSince = null;
      return { downgraded: false, level };
    }

    const from = level;
    level = next;
    lowSince = null;
    if (onDowngrade) onDowngrade(from, next, fps);
    return { downgraded: true, level };
  }

  return {
    sample,
    current: () => level,
    /** A manual pick always wins over the watchdog's history. */
    setLevel(next) {
      const wanted = QUALITY_IDS.includes(next) ? next : level;
      level = wanted;
      lowSince = null;
      return level;
    },
    reset() {
      lowSince = null;
    },
    lastFps: () => lastFps,
    thresholdFps: () => thresholdFps,
  };
}
