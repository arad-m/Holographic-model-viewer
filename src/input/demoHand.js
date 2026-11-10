// src/input/demoHand.js
// Owns: a DEV-ONLY synthetic hand feed, so the skeleton, the 2D overlay and the
// audio cues can be exercised without a webcam. Enabled with a query parameter:
//
//   ?handdemo=pinch   one pinching hand, moving in a slow circle (rotate)
//   ?handdemo=fist    one fist, moving (pan)
//   ?handdemo=palm     one open palm, held (reset ring, then reset)
//   ?handdemo=two     two pinching hands, breathing apart and together (zoom)
//
// It produces the same shape as handTracker.detect(): an array of
// { handedness, landmarks } with 21 mirror-space points. Nothing here ships in
// the normal path - without the query parameter this module is never called.

const LANDMARKS = 21;

/**
 * @param {'pinch'|'fist'|'palm'|'two'} mode
 * @param {number} nowMs
 * @returns {Array<{ handedness: 'Left'|'Right', landmarks: Array<{x:number,y:number,z:number}> }>}
 */
export function demoHands(mode, nowMs) {
  const t = nowMs / 1000;

  if (mode === 'two') {
    // Breathing apart and together around the centre: zoom in, zoom out.
    const spread = 0.1 + 0.05 * (1 + Math.sin(t * 0.6));
    return [
      { handedness: 'Left', landmarks: buildHand(0.5 - spread, 0.55, 'pinch') },
      { handedness: 'Right', landmarks: buildHand(0.5 + spread, 0.55, 'pinch') },
    ];
  }

  const x = 0.5 + 0.1 * Math.sin(t * 0.7);
  const y = 0.55 + 0.06 * Math.cos(t * 0.9);

  if (mode === 'fist') return [{ handedness: 'Right', landmarks: buildHand(x, y, 'fist') }];
  if (mode === 'palm') return [{ handedness: 'Right', landmarks: buildHand(0.5, 0.55, 'palm') }];
  return [{ handedness: 'Right', landmarks: buildHand(x, y, 'pinch') }];
}

/** True when the dev feed is requested. */
export function demoHandMode() {
  if (typeof window === 'undefined') return '';
  const mode = new URLSearchParams(window.location.search).get('handdemo') ?? '';
  return ['pinch', 'fist', 'palm', 'two'].includes(mode) ? mode : '';
}

/**
 * A synthetic 21-point hand. The geometry matches the shapes the classifier is
 * tuned for: an open hand has every fingertip far from the palm, a fist has them
 * on the palm, and a pinch puts the thumb and index tips in the same place.
 *
 * @param {number} x palm centre
 * @param {number} y palm centre
 * @param {'pinch'|'fist'|'palm'} pose
 */
function buildHand(x, y, pose) {
  const points = Array.from({ length: LANDMARKS }, () => ({ x, y, z: 0 }));
  const fingertipY = pose === 'fist' ? y - 0.03 : y - 0.45;

  points[0] = { x, y: y + 0.3, z: 0 }; // wrist -> hand size 0.3
  points[5] = { x: x - 0.06, y, z: 0 };
  points[9] = { x, y, z: 0 };
  points[13] = { x: x + 0.06, y, z: 0 };
  points[17] = { x: x + 0.1, y, z: 0 };
  points[8] = { x, y: fingertipY, z: 0 };
  points[12] = { x: x + 0.02, y: fingertipY, z: 0 };
  points[16] = { x: x + 0.01, y: fingertipY, z: 0 };
  points[20] = { x: x - 0.02, y: fingertipY, z: 0 };
  points[4] = pose === 'pinch' ? { x, y: fingertipY, z: 0 } : { x: x - 0.2, y, z: 0 };

  return points;
}
