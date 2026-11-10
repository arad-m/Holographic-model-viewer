// src/input/gestures.js
// Owns: all gesture math and the one gesture state machine. Pure functions plus
// a stateful engine that keeps per-hand memory between frames: One Euro landmark
// smoothing, pinch hysteresis, fist/palm classification, dropout tolerance,
// rotation/pan/zoom anchoring, release inertia and the palm-hold reset timer.
// No DOM, no Three.js, no state mutation, no rAF - so it is unit-testable in Node.
//
// The engine never touches the transform: it reports GestureState.action plus
// GestureState.delta and main.js applies them in one place.
//
// ---------------------------------------------------------------------------
// GestureState contract (the ONLY thing render/ and ui/ may read for gestures)
// ---------------------------------------------------------------------------
// {
//   hands: HandState[],
//   action: 'none' | 'rotate' | 'zoom' | 'pan' | 'reset',
//   delta: { rotX, rotY, panX, panY, zoomFactor, dragX, dragY },
//     dragX/dragY are the raw normalized pinch travel BEFORE the rotate gain, so
//     a mode that wants vertical movement (Slice, Explode) can use it without
//     reverse-engineering rotX. They are 0 whenever the action is not rotate.
//   resetRequested: boolean      // true for exactly one frame
// }
//
// HandState:
// {
//   id: string,
//   handedness: 'Left' | 'Right' | 'Unknown',
//   landmarks: { x, y, z }[],    // 21 points, MIRROR SPACE, smoothed
//   pinch:      { active: boolean, point: { x, y } },
//   pinchRatio: number,
//   fist:       boolean,
//   openPalm:   boolean,
//   indexPoint: { active: boolean, tip: { x, y } },
//   lastSeenMs: number
// }
//
// Action priority (one action at a time, highest wins):
//   1. two-hand pinch   -> 'zoom'
//   2. one-hand pinch   -> 'rotate'
//   3. fist             -> 'pan'
//   4. open-palm hold   -> 'reset' (after PALM_HOLD_MS)
// An action must be stable for ACTIVATION_FRAMES before it activates; it stops
// immediately when it goes away.
//
// Conventions:
//   - MIRROR SPACE: landmark x is flipped (x = 1 - x) exactly once at the input
//     layer (input/handTracker.js). Nothing downstream flips again.
//   - Distances are always normalized by hand size, never raw pixels.
//   - delta values are already scaled by the settings and in the units
//     state.transform uses (radians for rotation, world units for pan,
//     a multiplier for zoom).
// ---------------------------------------------------------------------------

/** MediaPipe Hands landmark indices this app relies on. */
export const LANDMARK = Object.freeze({
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_FINGER_MCP: 5,
  INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9,
  MIDDLE_FINGER_TIP: 12,
  RING_FINGER_MCP: 13,
  RING_FINGER_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
});

/** MediaPipe Hands always reports 21 points per hand. */
export const LANDMARKS_PER_HAND = 21;

/** Every action value `GestureState.action` may take. */
export const GESTURE_ACTIONS = Object.freeze(['none', 'rotate', 'zoom', 'pan', 'reset']);

/** The four fingers used for fist / open-palm classification: [mcp, tip]. */
export const FINGERS = Object.freeze([
  [LANDMARK.INDEX_FINGER_MCP, LANDMARK.INDEX_FINGER_TIP],
  [LANDMARK.MIDDLE_FINGER_MCP, LANDMARK.MIDDLE_FINGER_TIP],
  [LANDMARK.RING_FINGER_MCP, LANDMARK.RING_FINGER_TIP],
  [LANDMARK.PINKY_MCP, LANDMARK.PINKY_TIP],
]);

/**
 * Fist: every fingertip is close to the palm centre, measured in hand sizes.
 * `enter` starts the fist, `exit` releases it - the gap is the hysteresis that
 * stops a fist flapping between frames.
 */
export const FIST_THRESHOLDS = Object.freeze({ enter: 0.9, exit: 1.02 });

/**
 * Exit/enter ratio for the fist. A user-tuned enter threshold keeps this
 * proportional hysteresis, so raising the setting never removes the gap.
 */
export const FIST_HYSTERESIS = FIST_THRESHOLDS.exit / FIST_THRESHOLDS.enter;

/**
 * Open palm: every fingertip is far from the palm centre, again in hand sizes.
 * Entering needs a clearly open hand; holding on needs slightly less.
 */
export const PALM_THRESHOLDS = Object.freeze({ enter: 1.2, exit: 1.08 });

/** Pinch thresholds as a ratio of hand size (start low, release higher). */
export const DEFAULT_PINCH_THRESHOLDS = Object.freeze({ start: 0.25, release: 0.4 });

/** Radians of rotation per normalized unit of pinch-point travel. */
export const ROTATE_GAIN = 5;
/** World units of pan per normalized unit of palm travel (mouse: 0.0042/px). */
export const PAN_GAIN = 3;

/** Transform limits, identical to the mouse controls. */
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 4;
export const MAX_PAN = 2.2;
export const MAX_PITCH = 1.35;

/** How long a pinching hand may vanish before the grab is released. */
export const DROPOUT_GRACE_MS = 150;
/**
 * A gap longer than this (a hidden tab, a stalled camera) is not a drag.
 * The next sample re-anchors, so the model does not inherit the whole jump.
 */
export const STALL_GAP_MS = 250;
/** Inertia decay rate in 1/s (1.6 => about 0.6 s to lose most of a flick). */
export const INERTIA_DAMPING = 1.6;
/** Below this angular speed (rad/s) the throw has faded out. */
export const INERTIA_STOP = 0.015;
/** Hard cap on throw speed so a flick cannot spin the model wildly. */
export const MAX_INERTIA_VELOCITY = 9;

/** Frames a gesture must persist before it activates (~50 ms at 60 fps). */
export const ACTIVATION_FRAMES = 3;
/** How long an open palm must be held before the reset fires. */
export const PALM_HOLD_MS = 1000;

/** Fallback frame length when the caller does not pass a timestamp. */
const FRAME_MS = 1000 / 60;

/** One Euro cutoff range: low strength keeps more of the signal, high smooths. */
const MIN_CUTOFF_LOOSE = 6;
const MIN_CUTOFF_TIGHT = 0.7;
/**
 * Speed coefficient: how quickly the filter opens up while the hand moves.
 * 2.0 keeps the lag during a fast drag around 10% of the travel.
 */
const ONE_EURO_BETA = 2;
const ONE_EURO_D_CUTOFF = 1;

/** Below this hand size (in normalized units) the landmarks are treated as junk. */
const MIN_HAND_SIZE = 1e-4;
/** Smallest usable two-hand distance, so zoom cannot divide by ~0. */
const MIN_TWO_HAND_DISTANCE = 1e-3;

/**
 * @typedef {{ x: number, y: number, z: number }} Landmark
 * @typedef {{ x: number, y: number }} Point2D
 * @typedef {{ active: boolean, point: Point2D }} PinchState
 * @typedef {{ active: boolean, tip: Point2D }} IndexPointState
 * @typedef {Object} HandState
 * @property {string} id
 * @property {'Left'|'Right'|'Unknown'} handedness
 * @property {Landmark[]} landmarks
 * @property {PinchState} pinch
 * @property {number} pinchRatio
 * @property {boolean} fist
 * @property {boolean} openPalm
 * @property {IndexPointState} indexPoint
 * @property {number} lastSeenMs
 * @typedef {Object} GestureDelta
 * @property {number} rotX
 * @property {number} rotY
 * @property {number} panX
 * @property {number} panY
 * @property {number} zoomFactor
 * @property {number} dragX  raw normalized horizontal pinch travel this frame
 * @property {number} dragY  raw normalized vertical pinch travel this frame
 * @typedef {Object} GestureState
 * @property {'none'|'rotate'|'zoom'|'pan'|'reset'} action
 * @property {GestureDelta} delta
 * @property {HandState[]} hands
 * @property {boolean} resetRequested
 */
/** A hand with no detected pose. Safe to read; every flag is false. */
export function createEmptyHandState(handedness = 'Unknown') {
  return {
    id: '',
    handedness,
    landmarks: [],
    pinch: { active: false, point: { x: 0.5, y: 0.5 } },
    pinchRatio: Number.POSITIVE_INFINITY,
    fist: false,
    openPalm: false,
    indexPoint: { active: false, tip: { x: 0.5, y: 0.5 } },
    lastSeenMs: 0,
  };
}

/** A neutral GestureState - "no hands, no action, no movement". */
export function createEmptyGestureState() {
  return {
    hands: [],
    action: 'none',
    delta: { rotX: 0, rotY: 0, panX: 0, panY: 0, zoomFactor: 1, dragX: 0, dragY: 0 },
    resetRequested: false,
  };
}

/**
 * True when `landmarks` looks like a full MediaPipe hand with finite numbers.
 * @param {unknown} landmarks
 * @returns {boolean}
 */
export function isValidHand(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < LANDMARKS_PER_HAND) return false;
  return landmarks.every(
    (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y),
  );
}

/** Euclidean distance in the normalized image plane (z is ignored: it is noisy). */
export function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Hand size: wrist to middle-finger MCP. Everything gesture-related is divided
 * by this, so the maths works at any distance from the camera.
 */
export function handSize(landmarks) {
  if (!isValidHand(landmarks)) return 0;
  return distance2D(landmarks[LANDMARK.WRIST], landmarks[LANDMARK.MIDDLE_FINGER_MCP]);
}

/**
 * Thumb-tip to index-tip distance divided by hand size.
 * Returns Infinity for unusable landmarks, which reads as "not pinching".
 */
export function pinchRatio(landmarks) {
  const size = handSize(landmarks);
  if (size < MIN_HAND_SIZE) return Number.POSITIVE_INFINITY;
  return distance2D(landmarks[LANDMARK.THUMB_TIP], landmarks[LANDMARK.INDEX_FINGER_TIP]) / size;
}

/**
 * Pure hysteresis step for the pinch: one boolean in, one boolean out.
 * @param {boolean} wasActive
 * @param {number} ratio
 * @param {{ start?: number, release?: number }} [thresholds]
 */
export function nextPinchActive(wasActive, ratio, thresholds = DEFAULT_PINCH_THRESHOLDS) {
  const start = Number.isFinite(thresholds.start) ? thresholds.start : DEFAULT_PINCH_THRESHOLDS.start;
  const release = Number.isFinite(thresholds.release)
    ? thresholds.release
    : DEFAULT_PINCH_THRESHOLDS.release;
  if (!Number.isFinite(ratio)) return false;
  return wasActive ? ratio <= release : ratio <= start;
}

/** Midpoint between thumb tip and index tip, the point a pinch "grabs". */
export function pinchPoint(landmarks) {
  if (!isValidHand(landmarks)) return { x: 0.5, y: 0.5 };
  const thumb = landmarks[LANDMARK.THUMB_TIP];
  const index = landmarks[LANDMARK.INDEX_FINGER_TIP];
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
}

/** Centre of the palm: mean of the four MCP knuckles. */
export function palmCenter(landmarks) {
  if (!isValidHand(landmarks)) return { x: 0.5, y: 0.5 };
  let x = 0;
  let y = 0;
  for (const [mcp] of FINGERS) {
    x += landmarks[mcp].x;
    y += landmarks[mcp].y;
  }
  return { x: x / FINGERS.length, y: y / FINGERS.length };
}

/**
 * One ratio per finger: distance(fingertip, palm centre) / hand size.
 * Extended: roughly 1.2..1.8. Curled into a fist: roughly 0.4..0.7.
 * Returns [] for unusable landmarks so callers fall through to "neutral".
 *
 * @param {Landmark[]} landmarks
 * @returns {number[]} four ratios, index..pinky
 */
export function fingerExtensions(landmarks) {
  const size = handSize(landmarks);
  if (size < MIN_HAND_SIZE) return [];
  const centre = palmCenter(landmarks);
  return FINGERS.map(([, tip]) => distance2D(landmarks[tip], centre) / size);
}

/**
 * Fist with hysteresis: active once EVERY finger is inside `enter`; stays active
 * until one finger passes `exit` (needs all four, so a pinch - where the index
 * stays out - can never be mistaken for a fist).
 *
 * @param {boolean} wasFist
 * @param {number[]} extensions
 */
export function nextFistActive(wasFist, extensions, thresholds = FIST_THRESHOLDS) {
  if (!extensions || extensions.length === 0) return false;
  const enter = Number.isFinite(thresholds.enter) ? thresholds.enter : FIST_THRESHOLDS.enter;
  const exit = Number.isFinite(thresholds.exit) ? thresholds.exit : enter * FIST_HYSTERESIS;
  const furthest = Math.max(...extensions);
  return wasFist ? furthest <= exit : furthest <= enter;
}

/**
 * Open palm with hysteresis: active once EVERY finger is past `enter`; stays
 * active until one drops below `exit`.
 *
 * @param {boolean} wasPalm
 * @param {number[]} extensions
 */
export function nextPalmActive(wasPalm, extensions) {
  if (!extensions || extensions.length === 0) return false;
  const closest = Math.min(...extensions);
  return wasPalm ? closest >= PALM_THRESHOLDS.exit : closest >= PALM_THRESHOLDS.enter;
}

/**
 * The priority resolver: exactly one action comes out, highest priority wins.
 * Pure, so the conflict rules are testable without any geometry.
 *
 * @param {{ twoHandPinch?: boolean, oneHandPinch?: boolean, fist?: boolean, palm?: boolean }} signals
 * @returns {'zoom'|'rotate'|'pan'|'palm-hold'|'none'}
 */
export function resolveAction(signals = {}) {
  if (signals.twoHandPinch) return 'zoom';
  if (signals.oneHandPinch) return 'rotate';
  if (signals.fist) return 'pan';
  if (signals.palm) return 'palm-hold';
  return 'none';
}

/**
 * Coarse status label for the HUD, derived from a GestureState.
 * @param {GestureState|null|undefined} gestureState
 * @returns {'no-hand'|'detected'|'detected-2'|'pinching-1'|'pinching-2'}
 */
export function describeHandStatus(gestureState) {
  const hands = gestureState?.hands ?? [];
  if (hands.length === 0) return 'no-hand';
  const pinching = hands.filter((hand) => hand?.pinch?.active).length;
  if (pinching >= 2) return 'pinching-2';
  if (pinching === 1) return 'pinching-1';
  if (hands.length >= 2) return 'detected-2';
  return 'detected';
}

/**
 * Status label for the active action, or null when nothing is active.
 * @param {GestureState|null|undefined} gestureState
 * @returns {'grabbing'|'zooming'|'panning'|'resetting'|null}
 */
export function describeActionStatus(gestureState) {
  switch (gestureState?.action) {
    case 'rotate':
      return 'grabbing';
    case 'zoom':
      return 'zooming';
    case 'pan':
      return 'panning';
    case 'reset':
      return 'resetting';
    default:
      return null;
  }
}
/* ----------------------------------------------------------- engine --- */

/**
 * @typedef {{ active: boolean, handId: string|null, lastPoint: Point2D, velocity: { rotX: number, rotY: number }, reanchor: boolean }} DragState
 */

/** @returns {DragState} */
function createDragState() {
  return {
    active: false,
    handId: null,
    lastPoint: { x: 0, y: 0 },
    velocity: { rotX: 0, rotY: 0 },
    reanchor: false,
  };
}

/** Cap a throw so a flick cannot spin the model wildly. */
function clampInertia(velocity) {
  const speed = Math.hypot(velocity.rotX, velocity.rotY);
  if (!Number.isFinite(speed) || speed <= MAX_INERTIA_VELOCITY) {
    return { rotX: velocity.rotX || 0, rotY: velocity.rotY || 0 };
  }
  const scale = MAX_INERTIA_VELOCITY / speed;
  return { rotX: velocity.rotX * scale, rotY: velocity.rotY * scale };
}

/**
 * Keep hand ids unique within a frame: handedness first, then a frame index and
 * a counter if MediaPipe reports the same handedness twice.
 */
function assignHandId(handedness, index, usedIds) {
  const base = handedness || 'Unknown';
  let id = base;
  if (usedIds.has(id)) id = `${base}#${index}`;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}#${index}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

/**
 * The gesture state machine.
 *
 * Pipeline per frame: smooth -> pinch hysteresis -> fist/palm classification ->
 * dropout carry -> priority resolver (+ stability gate) -> per-action maths.
 * Exactly one action can be active, and every action re-anchors on entry, so
 * switching between gestures can never jump the model.
 *
 * Call `update()` at most once per rendered frame and pass `nowMs`; the same
 * timestamp drives the One Euro filters, the drag velocities, the inertia decay
 * and the palm-hold timer, so everything is frame-rate independent.
 *
 * @returns {{
 *   update: (hands: Array<{ handedness?: string, landmarks?: unknown }>, options?: {
 *     start?: number, release?: number, sensitivity?: number, smoothing?: number,
 *     panSensitivity?: number, dropoutMs?: number, nowMs?: number,
 *   }) => GestureState,
 *   reset: () => void,
 *   cancelInertia: () => void,
 * }}
 */
export function createGestureEngine() {
  /** @type {Map<string, boolean>} */
  let pinchByHandId = new Map();
  /** @type {Map<string, { fist: boolean, palm: boolean }>} */
  let poseByHandId = new Map();
  /** @type {Map<string, HandSmoother>} one filter bank per hand id */
  let smootherByHandId = new Map();
  /** @type {Map<string, HandState>} hands carried through a short dropout */
  let carriedHands = new Map();

  /** @type {'none'|'rotate'|'zoom'|'pan'|'reset'} */
  let action = 'none';
  /** @type {'zoom'|'rotate'|'pan'|'palm-hold'|'none'} */
  let pending = 'none';
  let pendingFrames = 0;
  let resetArmed = true;
  let holdStartMs = 0;

  /** @type {DragState} */ let rotateDrag = createDragState();
  /** @type {DragState} */ let panDrag = createDragState();
  let zoomStartDistance = 0;
  let zoomHandKey = '';
  /** @type {{ rotX: number, rotY: number }} radians per second */
  let inertia = { rotX: 0, rotY: 0 };
  let lastNowMs = 0;

  function reset() {
    pinchByHandId = new Map();
    poseByHandId = new Map();
    smootherByHandId = new Map();
    carriedHands = new Map();
    action = 'none';
    pending = 'none';
    pendingFrames = 0;
    resetArmed = true;
    holdStartMs = 0;
    rotateDrag = createDragState();
    panDrag = createDragState();
    zoomStartDistance = 0;
    zoomHandKey = '';
    inertia = { rotX: 0, rotY: 0 };
    lastNowMs = 0;
  }

  /** Stop the throw immediately (used when the pitch clamp is hit). */
  function cancelInertia() {
    inertia = { rotX: 0, rotY: 0 };
    rotateDrag.velocity = { rotX: 0, rotY: 0 };
  }

  /** Drop an action's anchors, handing a rotate gesture's speed to inertia. */
  function endAction(previous) {
    if (previous === 'rotate') inertia = clampInertia(rotateDrag.velocity);
    rotateDrag = createDragState();
    panDrag = createDragState();
    zoomStartDistance = 0;
    zoomHandKey = '';
    holdStartMs = 0;
  }

  /**
   * Anchor a freshly activated action. Every branch only records a start point:
   * the first frame of any gesture produces zero movement.
   */
  function beginAction(next, pinching, fistHand, nowMs) {
    inertia = { rotX: 0, rotY: 0 };

    if (next === 'rotate' && pinching[0]) {
      const point = pinching[0].pinch.point;
      rotateDrag = {
        active: true,
        handId: pinching[0].id,
        lastPoint: { x: point.x, y: point.y },
        velocity: { rotX: 0, rotY: 0 },
        reanchor: false,
      };
      return;
    }

    if (next === 'zoom' && pinching.length >= 2) {
      zoomStartDistance = distance2D(pinching[0].pinch.point, pinching[1].pinch.point);
      zoomHandKey = `${pinching[0].id}|${pinching[1].id}`;
      return;
    }

    if (next === 'pan' && fistHand) {
      const centre = palmCenter(fistHand.landmarks);
      panDrag = {
        active: true,
        handId: fistHand.id,
        lastPoint: { x: centre.x, y: centre.y },
        velocity: { rotX: 0, rotY: 0 },
        reanchor: false,
      };
      return;
    }

    if (next === 'palm-hold') holdStartMs = nowMs;
  }

  function update(hands, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : lastNowMs + FRAME_MS;
    const gapMs = lastNowMs > 0 ? nowMs - lastNowMs : 0;
    // A hidden tab or a frozen camera shows up as one huge gap. Clamping dt
    // keeps the maths finite, but the hand will have moved in that gap: treat
    // it as a new grab instead of one enormous drag.
    const stalled = gapMs > STALL_GAP_MS;
    const dt = lastNowMs > 0 ? clamp(gapMs / 1000, 0, 0.1) : FRAME_MS / 1000;
    lastNowMs = nowMs;

    if (stalled) {
      smootherByHandId = new Map();
      carriedHands = new Map();
      inertia = { rotX: 0, rotY: 0 };
      rotateDrag.reanchor = true;
      panDrag.reanchor = true;
      zoomStartDistance = 0;
    }

    const thresholds = {
      start: Number.isFinite(options.start) ? options.start : DEFAULT_PINCH_THRESHOLDS.start,
      release: Number.isFinite(options.release)
        ? options.release
        : DEFAULT_PINCH_THRESHOLDS.release,
    };
    const smoothing = clamp(Number.isFinite(options.smoothing) ? options.smoothing : 0.5, 0, 1);
    const sensitivity = clamp(
      Number.isFinite(options.sensitivity) ? options.sensitivity : 1,
      0.1,
      4,
    );
    const panSensitivity = clamp(
      Number.isFinite(options.panSensitivity) ? options.panSensitivity : 1,
      0.1,
      4,
    );
    const dropoutMs = Number.isFinite(options.dropoutMs) ? options.dropoutMs : DROPOUT_GRACE_MS;
    // The fist threshold is user-tunable; the release threshold follows it so the
    // hysteresis gap scales with the setting instead of collapsing.
    const fistEnter = clamp(
      Number.isFinite(options.fistThreshold) ? options.fistThreshold : FIST_THRESHOLDS.enter,
      0.4,
      1.6,
    );
    const fistThresholds = { enter: fistEnter, exit: fistEnter * FIST_HYSTERESIS };

    const timeSeconds = nowMs / 1000;

    /** @type {HandState[]} */
    const handStates = [];
    const nextPinch = new Map();
    const nextPose = new Map();
    const nextSmoothers = new Map();
    const usedIds = new Set();
    const inputHands = Array.isArray(hands) ? hands : [];

    // 1. Smooth, then classify. Pinch wins over fist/palm, and a pinching hand is
    // never reported as a fist or a palm, so a pinch can never trigger either.
    for (let index = 0; index < inputHands.length; index += 1) {
      const hand = inputHands[index];
      if (!isValidHand(hand?.landmarks)) continue;

      const handedness =
        hand.handedness === 'Left' || hand.handedness === 'Right' ? hand.handedness : 'Unknown';
      const id = assignHandId(handedness, index, usedIds);

      const smoother = smootherByHandId.get(id) ?? createHandSmoother(hand.landmarks.length);
      const landmarks = smoothLandmarks(smoother, hand.landmarks, timeSeconds, smoothing);
      nextSmoothers.set(id, smoother);

      const ratio = pinchRatio(landmarks);
      const pinching = nextPinchActive(pinchByHandId.get(id) ?? false, ratio, thresholds);
      nextPinch.set(id, pinching);

      const extensions = fingerExtensions(landmarks);
      const previousPose = poseByHandId.get(id) ?? { fist: false, palm: false };
      const fist = !pinching && nextFistActive(previousPose.fist, extensions, fistThresholds);
      const palm = !pinching && !fist && nextPalmActive(previousPose.palm, extensions);
      nextPose.set(id, { fist, palm });

      const point = pinchPoint(landmarks);
      handStates.push({
        id,
        handedness,
        landmarks,
        pinch: { active: pinching, point },
        pinchRatio: ratio,
        fist,
        openPalm: palm,
        // The index fingertip is what Inspect mode points with; it is available
        // whether or not the hand is pinching.
        indexPoint: {
          active: true,
          tip: {
            x: landmarks[LANDMARK.INDEX_FINGER_TIP].x,
            y: landmarks[LANDMARK.INDEX_FINGER_TIP].y,
          },
        },
        lastSeenMs: nowMs,
      });
    }

    // 2. Dropout tolerance for pinching hands: carry the last pose for ~150 ms so
    // a fast move cannot drop a grab. Carried poses never feed the drag maths.
    const seenIds = new Set(handStates.map((hand) => hand.id));
    /** @type {Set<string>} */
    const carriedIds = new Set();
    const freshHandedness = new Set(handStates.map((hand) => hand.handedness));
    for (const [id, previous] of carriedHands) {
      if (seenIds.has(id)) continue;
      if (!previous.pinch.active) continue;
      if (nowMs - previous.lastSeenMs > dropoutMs) continue;
      // The same hand coming back under a new id is not a second hand. Carrying
      // the old one as well is what turned a flicker into a false zoom.
      if (freshHandedness.has(previous.handedness)) continue;

      handStates.push(previous);
      carriedIds.add(id);
      nextPinch.set(id, true);
      const smoother = smootherByHandId.get(id);
      if (smoother) nextSmoothers.set(id, smoother);
    }

    const nextCarried = new Map();
    for (const hand of handStates) nextCarried.set(hand.id, hand);

    pinchByHandId = nextPinch;
    poseByHandId = nextPose;
    smootherByHandId = nextSmoothers;
    carriedHands = nextCarried;

    // 3. Priority resolution with a stability gate.
    const pinching = handStates.filter((hand) => hand.pinch.active);
    const fistHand = handStates.find((hand) => hand.fist);
    const palmHand = handStates.find((hand) => hand.openPalm);
    const candidate = resolveAction({
      twoHandPinch: pinching.length >= 2,
      oneHandPinch: pinching.length === 1,
      fist: Boolean(fistHand),
      palm: Boolean(palmHand),
    });

    if (candidate === pending) pendingFrames += 1;
    else {
      pending = candidate;
      pendingFrames = 1;
    }

    // The palm reset re-arms only once the palm has been dropped.
    if (candidate !== 'palm-hold' && action !== 'reset') resetArmed = true;

    const isAlive = (current) => {
      if (current === 'rotate') return pinching.length === 1;
      if (current === 'zoom') return pinching.length >= 2;
      if (current === 'pan') return Boolean(fistHand);
      // The palm hold lives only while the palm stays open and the reset is armed.
      if (current === 'palm-hold') return Boolean(palmHand) && resetArmed;
      return false;
    };

    // An action stops the moment its own signal disappears - no lag on release.
    if (action !== 'none' && action !== 'reset' && !isAlive(action)) {
      endAction(action);
      action = 'none';
    }

    // ...but starting one (or switching to another) needs ACTIVATION_FRAMES.
    if (action === 'none' && candidate !== 'none' && pendingFrames >= ACTIVATION_FRAMES) {
      action = candidate;
      beginAction(action, pinching, fistHand, nowMs);
    }

    // 4. Per-action maths. Only the active action writes a delta.
    let rotX = 0;
    let rotY = 0;
    let panX = 0;
    let panY = 0;
    let zoomFactor = 1;
    let dragX = 0;
    let dragY = 0;
    let resetRequested = false;

    if (action === 'rotate' && pinching.length === 1) {
      const hand = pinching[0];
      const point = hand.pinch.point;
      const isStale = carriedIds.has(hand.id);
      const needsAnchor =
        !rotateDrag.active || rotateDrag.handId !== hand.id || rotateDrag.reanchor || isStale;

      if (needsAnchor) {
        rotateDrag = {
          active: true,
          handId: hand.id,
          lastPoint: { x: point.x, y: point.y },
          velocity: { rotX: 0, rotY: 0 },
          reanchor: isStale,
        };
      } else {
        const dx = point.x - rotateDrag.lastPoint.x;
        const dy = point.y - rotateDrag.lastPoint.y;
        dragX = dx;
        dragY = dy;
        rotY = dx * ROTATE_GAIN * sensitivity;
        rotX = dy * ROTATE_GAIN * sensitivity;
        rotateDrag.lastPoint = { x: point.x, y: point.y };
        if (dt > 1e-4) rotateDrag.velocity = { rotX: rotX / dt, rotY: rotY / dt };
      }
    } else if (action === 'zoom' && pinching.length >= 2) {
      const key = `${pinching[0].id}|${pinching[1].id}`;
      const current = distance2D(pinching[0].pinch.point, pinching[1].pinch.point);

      // A different pair of hands (or a lost anchor) re-anchors: factor stays 1.
      if (key !== zoomHandKey || zoomStartDistance <= MIN_TWO_HAND_DISTANCE) {
        zoomHandKey = key;
        zoomStartDistance = current;
      } else if (current > MIN_TWO_HAND_DISTANCE) {
        zoomFactor = clamp(current / zoomStartDistance, 0.2, 5);
      }
    } else if (action === 'pan' && fistHand) {
      const centre = palmCenter(fistHand.landmarks);
      const isStale = carriedIds.has(fistHand.id);
      const needsAnchor =
        !panDrag.active || panDrag.handId !== fistHand.id || panDrag.reanchor || isStale;

      if (needsAnchor) {
        panDrag = {
          active: true,
          handId: fistHand.id,
          lastPoint: { x: centre.x, y: centre.y },
          velocity: { rotX: 0, rotY: 0 },
          reanchor: isStale,
        };
      } else {
        // Same sense as the mouse: hand right -> panX +, hand down -> panY -.
        panX = (centre.x - panDrag.lastPoint.x) * PAN_GAIN * panSensitivity;
        panY = -(centre.y - panDrag.lastPoint.y) * PAN_GAIN * panSensitivity;
        panDrag.lastPoint = { x: centre.x, y: centre.y };
      }
    } else if (action === 'palm-hold') {
      if (holdStartMs === 0) holdStartMs = nowMs;
      if (resetArmed && nowMs - holdStartMs >= PALM_HOLD_MS) {
        action = 'reset';
        resetRequested = true;
        resetArmed = false;
        holdStartMs = 0;
      }
    } else if (action === 'reset') {
      // The pulse was emitted on the frame it fired; here we only retire it, so
      // a held palm cannot fire twice.
      endAction('reset');
      action = 'none';
    }

    // 5. Release inertia, only while no other action owns the transform.
    if (action === 'none') {
      rotX = inertia.rotX * dt;
      rotY = inertia.rotY * dt;
      const decay = Math.exp(-INERTIA_DAMPING * dt);
      inertia = { rotX: inertia.rotX * decay, rotY: inertia.rotY * decay };
      if (Math.hypot(inertia.rotX, inertia.rotY) < INERTIA_STOP) {
        inertia = { rotX: 0, rotY: 0 };
      }
    } else if (action !== 'rotate') {
      inertia = { rotX: 0, rotY: 0 };
    }

    return {
      hands: handStates,
      action,
      delta: { rotX, rotY, panX, panY, zoomFactor, dragX, dragY },
      resetRequested,
    };
  }

  return { update, reset, cancelInertia };
}
/* -------------------------------------------------------- smoothing --- */

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * One Euro filter on a single scalar stream.
 *
 * Why One Euro rather than a plain EMA: an EMA strong enough to kill landmark
 * jitter (needed, or the model trembles while holding still) adds visible lag
 * during a fast drag. One Euro varies its cutoff with the signal's speed - heavy
 * smoothing at rest, almost none while moving - which is exactly the trade-off
 * these gestures need. `minCutoff` is what the smoothing setting maps to.
 *
 * @param {{ minCutoff: number, beta: number, dCutoff: number }} options
 */
export function createOneEuroAxis({ minCutoff, beta, dCutoff }) {
  let valuePrev = 0;
  let derivativePrev = 0;
  let timePrev = null;
  let primed = false;

  const alpha = (cutoff, dt) => {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  };

  return {
    /** @param {number} value @param {number} timeSeconds */
    filter(value, timeSeconds) {
      if (!primed || timePrev === null) {
        primed = true;
        timePrev = timeSeconds;
        valuePrev = value;
        derivativePrev = 0;
        return value;
      }

      const dt = Math.max(1e-3, timeSeconds - timePrev);
      timePrev = timeSeconds;

      const derivative = (value - valuePrev) / dt;
      const derivativeHat =
        derivativePrev + alpha(dCutoff, dt) * (derivative - derivativePrev);
      const cutoff = minCutoff + beta * Math.abs(derivativeHat);
      const valueHat = valuePrev + alpha(cutoff, dt) * (value - valuePrev);

      valuePrev = valueHat;
      derivativePrev = derivativeHat;
      return valueHat;
    },
  };
}

/** @typedef {{ filters: Array<{ x: ReturnType<typeof createOneEuroAxis>, y: ReturnType<typeof createOneEuroAxis>, z: ReturnType<typeof createOneEuroAxis> }> }} HandSmoother */

/**
 * One filter bank per hand (x, y and z for each of the 21 landmarks).
 * @param {number} landmarkCount
 * @returns {HandSmoother}
 */
export function createHandSmoother(landmarkCount = LANDMARKS_PER_HAND) {
  const options = {
    minCutoff: MIN_CUTOFF_LOOSE,
    beta: ONE_EURO_BETA,
    dCutoff: ONE_EURO_D_CUTOFF,
  };
  const filters = Array.from({ length: landmarkCount }, () => ({
    x: createOneEuroAxis(options),
    y: createOneEuroAxis(options),
    z: createOneEuroAxis(options),
  }));
  return { filters };
}

/**
 * Smooth a whole hand. `strength` 0 returns the input untouched (a copy, so the
 * caller can mutate freely); 1 maps to the tightest cutoff.
 *
 * @param {HandSmoother} smoother
 * @param {Landmark[]} landmarks
 * @param {number} timeSeconds
 * @param {number} strength 0..1
 * @returns {Landmark[]}
 */
export function smoothLandmarks(smoother, landmarks, timeSeconds, strength) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) return [];
  const amount = clamp(strength, 0, 1);
  if (amount <= 0) return landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));

  const minCutoff = MIN_CUTOFF_LOOSE - (MIN_CUTOFF_LOOSE - MIN_CUTOFF_TIGHT) * amount;
  if (smoother.filters.length !== landmarks.length) {
    smoother.filters = createHandSmoother(landmarks.length).filters;
  }

  return landmarks.map((point, index) => {
    const bank = smoother.filters[index];
    return {
      x: bank.x.filter(point.x, timeSeconds),
      y: bank.y.filter(point.y, timeSeconds),
      z: bank.z.filter(point.z ?? 0, timeSeconds),
    };
  });
}
