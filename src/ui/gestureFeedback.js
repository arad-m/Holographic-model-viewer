// src/ui/gestureFeedback.js
// Owns: the glue between GestureState and everything the user sees/hears for a
// gesture. It is the ONLY place that decides when a cue fires, which is what
// guarantees one blip per grab rather than one per frame.
//
// Composition: 2D overlay (render/gestureOverlay) + in-scene skeleton
// (render/handSkeleton) + audio (audio/sound). No gesture logic lives here: it
// reads `action`, `delta.zoomFactor`, `resetRequested` and the hands.

import { createHandSkeleton } from '../render/handSkeleton.js';
import { createGestureOverlay } from '../render/gestureOverlay.js';
import { CUE, diffCues } from '../audio/cues.js';

/**
 * @param {{
 *   stage: HTMLElement,
 *   scene: import('three').Scene,
 *   sound: ReturnType<typeof import('../audio/sound.js').createSound>,
 *   skeletonVisible?: boolean,
 * }} options
 * @returns {{
 *   update: (gestureState: import('../input/gestures.js').GestureState|null, dt: number) => void,
 *   setSkeletonVisible: (visible: boolean) => void,
 *   isSkeletonVisible: () => boolean,
 *   setMuted: (muted: boolean) => void,
 *   setVolume: (volume: number) => void,
 *   dispose: () => void,
 * }}
 */
export function createGestureFeedback({ stage, scene, sound, skeletonVisible = true }) {
  const overlay = createGestureOverlay(stage);
  const skeleton = createHandSkeleton(scene);
  skeleton.setVisible(skeletonVisible);

  /** Action on the previous frame - the edge detector for every cue. */
  let previousAction = 'none';
  /** Zoom factor on the previous frame, for the zoom tone's pitch. */
  let previousZoomFactor = 1;

  // The AudioContext may only start inside a real user gesture.
  const unlock = () => sound.unlock();
  const unlockOptions = { once: true, passive: true };
  window.addEventListener('pointerdown', unlock, unlockOptions);
  window.addEventListener('keydown', unlock, unlockOptions);

  /**
   * @param {import('../input/gestures.js').GestureState|null} gestureState
   * @param {number} dt seconds
   */
  function update(gestureState, dt) {
    const action = gestureState?.action ?? 'none';
    const zoomFactor = gestureState?.delta?.zoomFactor ?? 1;

    overlay.update(gestureState, dt);
    skeleton.update(gestureState?.hands ?? [], dt);

    // One cue per transition (see audio/cues.js - the rule is unit tested).
    const cues = diffCues(previousAction, action, Boolean(gestureState?.resetRequested));
    for (const cue of cues) playCue(cue);

    // The zoom tone is the only continuous sound: follow its speed.
    if (action === 'zoom' && dt > 1e-4) {
      sound.updateZoom((zoomFactor - previousZoomFactor) / dt);
    }

    previousAction = action;
    previousZoomFactor = action === 'zoom' ? zoomFactor : 1;
  }

  /** @param {string} cue value from CUE */
  function playCue(cue) {
    switch (cue) {
      case CUE.GRAB:
        sound.playGrab();
        break;
      case CUE.RELEASE:
        sound.playRelease();
        break;
      case CUE.ZOOM_START:
        sound.startZoom();
        break;
      case CUE.ZOOM_STOP:
        sound.stopZoom();
        break;
      case CUE.RESET:
        sound.playReset();
        break;
      default:
        break;
    }
  }

  function setSkeletonVisible(next) {
    skeleton.setVisible(next);
  }

  function setMuted(next) {
    sound.setMuted(next);
  }

  function setVolume(next) {
    sound.setVolume(next);
  }

  function dispose() {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    overlay.dispose();
    skeleton.dispose();
  }

  return {
    update,
    setSkeletonVisible,
    isSkeletonVisible: () => skeleton.isVisible(),
    setMuted,
    setVolume,
    dispose,
  };
}
