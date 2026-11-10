// src/render/parallax.js
// Owns: the camera nudge that makes the hologram react to where your head is.
//
// The camera moves OPPOSITE the head, so leaning right reveals the model's left
// side: that is what reads as depth. The offset is large enough that a normal
// lean is obvious, and it is clamped, so a bad face sample can never throw the
// framing off screen. scene.js follows only part of the offset with the look-at
// point, so the hologram also slides instead of staying glued to the centre.
//
// Everything here is pure numbers and easing: no DOM, no MediaPipe, no Three.js.
// input/faceTracker.js produces the samples, scene.setCameraOffset applies the
// result, and main.js runs update() once per frame with the loop's dt.
//
// Two rules keep it from fighting the gestures:
//   1. The offset only ever moves the camera, never state.transform, so hand
//      tracking accuracy is untouched.
//   2. With no face (or no sample for FACE_TIMEOUT_MS) the offset eases back to
//      neutral instead of snapping, and a sample that jumps wildly is dropped.

/**
 * Largest camera offset, in world units. The camera sits about 4.6 units away,
 * so 1.05 is roughly 13 degrees of orbit: enough to see around a 1.6-unit model.
 * A smaller cap (the old 0.34) was only a couple of degrees, which a centred
 * look-at hides completely.
 */
export const PARALLAX_LIMIT = 1.05;
/**
 * Normalized head travel that produces the full offset. A lean of about a tenth
 * of the frame is a normal shift in a chair; the old 0.22 range asked for a
 * much bigger move before the view reacted.
 */
export const HEAD_RANGE_X = 0.1;
export const HEAD_RANGE_Y = 0.08;
/** Head travel inside this (normalized) is treated as sitting still. */
export const PARALLAX_DEADZONE = 0.012;
/** Easing rate toward the sampled offset, in 1/s. */
export const PARALLAX_SMOOTHING = 14;
/** Easing rate back to neutral when no face is visible, in 1/s. */
export const PARALLAX_RETURN_RATE = 3.2;
/**
 * Silence longer than this counts as "no face".
 *
 * The live loop does not rely on this alone. Low quality only samples the face
 * every 500 ms, which is longer than this window, so main.js calls hold() on
 * the frames it skips. One empty detection is ignored; the second calls
 * markLost() and the offset eases home without waiting out this timer.
 */
export const FACE_TIMEOUT_MS = 400;
/** Empty detections in a row before the face is treated as gone. */
export const FACE_MISS_LIMIT = 2;
/** Samples further than this from the last one are treated as a tracking glitch. */
export const MAX_SAMPLE_JUMP = 0.4;

/**
 * Frame-rate independent exponential approach.
 * `alpha = 1 - exp(-rate * dt)` is the whole trick: the same code takes the same
 * time to converge at 30 fps and at 144 fps.
 *
 * @param {number} current
 * @param {number} target
 * @param {number} rate 1/s
 * @param {number} dt seconds
 * @returns {number}
 */
export function approach(current, target, rate, dt) {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target)) return current;
  if (!(dt > 0) || !(rate > 0)) return current;
  const alpha = 1 - Math.exp(-rate * dt);
  const next = current + (target - current) * alpha;
  // Snap when the remaining distance is invisible, so values actually reach 0.
  return Math.abs(target - next) < 1e-4 ? target : next;
}

/**
 * Camera offset for one head position.
 *
 * The head is in mirror space (see input/faceTracker.js): +x is the side the user
 * sees on their own right. The camera moves the other way, which is what makes
 * leaning feel like looking around the model rather than pushing it.
 *
 * @param {{ x: number, y: number }} head
 * @param {{ x: number, y: number }} neutral
 * @param {{ limit?: number }} [options]
 * @returns {{ x: number, y: number }} world-unit camera offset
 */
export function headToOffset(head, neutral, { limit = PARALLAX_LIMIT } = {}) {
  const headX = Number.isFinite(head?.x) ? head.x : 0;
  const headY = Number.isFinite(head?.y) ? head.y : 0;
  const neutralX = Number.isFinite(neutral?.x) ? neutral.x : headX;
  const neutralY = Number.isFinite(neutral?.y) ? neutral.y : headY;

  const normalizedX = (headX - neutralX) / HEAD_RANGE_X;
  const normalizedY = (headY - neutralY) / HEAD_RANGE_Y;

  // Opposite the head on X (lean right, see the model's left side). Same
  // direction on Y (lean up, the camera rises and you look down at the model).
  // The zero cases are explicit so an unmoved head yields exactly 0, not -0.
  const leanedX = shapeLean(normalizedX);
  const leanedY = shapeLean(normalizedY);
  const x = leanedX === 0 ? 0 : clamp(-leanedX * limit, -limit, limit);
  const y = leanedY === 0 ? 0 : clamp(leanedY * limit, -limit, limit);
  return { x, y };
}

/**
 * Map a normalized lean (-inf..inf, 1 = a full normal lean) onto -1..1.
 * Full travel still reaches 1, so the clamp tests stay exact. The power lifts
 * the middle: half a lean is already most of the offset, which is what makes a
 * small shift in the chair visible.
 * @param {number} normalized
 * @returns {number}
 */
export function shapeLean(normalized) {
  if (!Number.isFinite(normalized)) return 0;
  const magnitude = Math.abs(normalized);
  if (magnitude <= PARALLAX_DEADZONE) return 0;
  const scaled = Math.min((magnitude - PARALLAX_DEADZONE) / (1 - PARALLAX_DEADZONE), 1);
  return Math.sign(normalized) * scaled ** 0.7;
}

/**
 * The controller. One per app.
 *
 * @param {{ limit?: number, smoothing?: number, returnRate?: number }} [options]
 */
export function createParallax(options = {}) {
  /** Mutable: the "Parallax depth" slider adjusts it while the feature is on. */
  let limit = Number.isFinite(options.limit)
    ? Math.min(options.limit, PARALLAX_LIMIT)
    : PARALLAX_LIMIT;
  const smoothing = Number.isFinite(options.smoothing) ? options.smoothing : PARALLAX_SMOOTHING;
  const returnRate = Number.isFinite(options.returnRate)
    ? options.returnRate
    : PARALLAX_RETURN_RATE;

  let enabled = false;
  /** Camera offset actually applied, eased frame by frame. */
  let current = { x: 0, y: 0 };
  /** Latest accepted head sample, in mirror space. */
  let sample = null;
  let lastSampleAt = 0;
  /** Neutral head position; null until the first sample after a calibration. */
  let neutral = null;
  let needsCalibration = true;
  /** Consecutive detections that found no face. Reset by an accepted sample. */
  let misses = 0;
  /** Two misses, or an explicit loss: ease home even if a sample is still "fresh". */
  let faceLost = false;

  /**
   * Record a head position. Called only when the face tracker produced one.
   * @param {{ x: number, y: number }} head mirror-space, normalized 0..1
   * @param {number} nowMs
   * @returns {boolean} true when the sample was accepted
   */
  function pushSample(head, nowMs = 0) {
    if (!enabled) return false;
    const x = Number(head?.x);
    const y = Number(head?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    // A wild jump is a tracking glitch, not a head movement: drop it and keep the
    // last good pose, so the view never lurches.
    if (sample && Math.hypot(x - sample.x, y - sample.y) > MAX_SAMPLE_JUMP) {
      lastSampleAt = Number.isFinite(nowMs) ? nowMs : lastSampleAt;
      return false;
    }

    sample = { x, y };
    lastSampleAt = Number.isFinite(nowMs) ? nowMs : lastSampleAt;
    misses = 0;
    faceLost = false;

    // Calibrating on the first sample after enabling means "where you already are
    // sitting" is neutral, so turning the feature on never moves the view.
    if (needsCalibration) {
      neutral = { ...sample };
      needsCalibration = false;
    }
    return true;
  }

  /**
   * A detection ran and found nothing. The first miss is ignored (a blink, or
   * one failed inference) so the view does not pulse. The second releases.
   * @param {number} [nowMs]
   * @returns {number} consecutive misses, or 0 when the feature is off
   */
  function pushMiss() {
    if (!enabled) return 0;
    misses += 1;
    if (misses >= FACE_MISS_LIMIT) faceLost = true;
    return misses;
  }

  /**
   * The detector was throttled this frame, not blind. Keep the last accepted
   * pose fresh so a 2 Hz face rate does not look like the face left.
   * @param {number} nowMs
   * @returns {boolean}
   */
  function hold(nowMs) {
    if (!enabled || !sample || faceLost) return false;
    if (!Number.isFinite(nowMs)) return false;
    lastSampleAt = nowMs;
    return true;
  }

  /** Re-read the current head position as neutral. */
  function recalibrate() {
    if (sample) {
      neutral = { ...sample };
      needsCalibration = false;
      return true;
    }
    // No face yet: the next sample becomes neutral.
    needsCalibration = true;
    neutral = null;
    return false;
  }

  /** Forget the face entirely (tracker stopped, camera off). */
  function clearSample() {
    sample = null;
    lastSampleAt = 0;
    misses = 0;
    faceLost = false;
  }

  /**
   * Change how far the camera may lean. Clamped to the module maximum so a bad
   * setting can never push the framing off screen.
   * @param {number} next world units
   * @returns {number} the limit actually in force
   */
  function setLimit(next) {
    if (!Number.isFinite(next)) return limit;
    limit = Math.min(Math.max(next, 0), PARALLAX_LIMIT);
    return limit;
  }

  /**
   * Advance the easing and report the offset to apply.
   * @param {number} dt seconds
   * @param {number} nowMs
   * @returns {{ x: number, y: number }}
   */
  function update(dt, nowMs = 0) {
    if (!enabled) {
      current = { x: 0, y: 0 };
      return current;
    }

    // nowMs <= 0 is the "no clock" case the tests use: a stored sample counts.
    const timedOut = nowMs > 0 && nowMs - lastSampleAt > FACE_TIMEOUT_MS;
    const fresh = sample !== null && !faceLost && !timedOut;

    const target = fresh && neutral ? headToOffset(sample, neutral, { limit }) : { x: 0, y: 0 };
    current = {
      x: approach(current.x, target.x, fresh ? smoothing : returnRate, dt),
      y: approach(current.y, target.y, fresh ? smoothing : returnRate, dt),
    };
    return current;
  }

  /**
   * Turn the feature on or off. Enabling always re-calibrates, so the view does
   * not jump at the moment it is switched on.
   * @param {boolean} next
   */
  function setEnabled(next) {
    const wanted = Boolean(next);
    if (wanted === enabled) return enabled;
    enabled = wanted;
    if (enabled) {
      recalibrate();
    } else {
      current = { x: 0, y: 0 };
      clearSample();
    }
    return enabled;
  }

  return {
    pushSample,
    pushMiss,
    hold,
    recalibrate,
    clearSample,
    setLimit,
    update,
    setEnabled,
    isEnabled: () => enabled,
    /**
     * True when the view is currently driven by a live face.
     * Pass `nowMs` to treat a sample older than FACE_TIMEOUT_MS as gone, which
     * is what the HUD should say while the camera eases home.
     * @param {number} [nowMs]
     */
    hasFace(nowMs) {
      if (!enabled || !sample || faceLost) return false;
      if (!Number.isFinite(nowMs)) return true;
      return nowMs - lastSampleAt <= FACE_TIMEOUT_MS;
    },
    /** Cheap state snapshot for the HUD and for tests. */
    snapshot: () => ({
      enabled,
      x: current.x,
      y: current.y,
      neutral: neutral ? { ...neutral } : null,
      sample: sample ? { ...sample } : null,
      needsCalibration,
      limit,
    }),
  };
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
