// src/audio/cues.js
// Owns: the rule for WHEN a cue fires. Pure and DOM-free so it can be unit
// tested: give it the previous and current gesture action, get the list of cues
// that should play this frame.
//
// This is what makes a cue fire exactly once per event: it compares two frames,
// so holding a pinch for 300 frames yields one 'grab' on the first frame and
// nothing after it.

/** Every cue the app can play. */
export const CUE = Object.freeze({
  GRAB: 'grab',
  RELEASE: 'release',
  ZOOM_START: 'zoom-start',
  ZOOM_STOP: 'zoom-stop',
  RESET: 'reset',
});

/**
 * Cues for this frame, derived only from the action transition.
 *
 * @param {string} previousAction action on the previous frame ('none' initially)
 * @param {string} action action on this frame
 * @param {boolean} [resetRequested] the engine's one-frame reset pulse
 * @returns {string[]} zero or more cues, in the order they should play
 */
export function diffCues(previousAction, action, resetRequested = false) {
  const cues = [];

  if (action === 'rotate' && previousAction !== 'rotate') cues.push(CUE.GRAB);
  if (previousAction === 'rotate' && action !== 'rotate') cues.push(CUE.RELEASE);

  if (action === 'zoom' && previousAction !== 'zoom') cues.push(CUE.ZOOM_START);
  if (previousAction === 'zoom' && action !== 'zoom') cues.push(CUE.ZOOM_STOP);

  // The reset is a one-frame pulse from the engine, so it cannot repeat.
  if (resetRequested) cues.push(CUE.RESET);

  return cues;
}
