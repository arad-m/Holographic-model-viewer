// src/input/webcam.js
// Owns: the camera. getUserMedia lifecycle, the <video> element MediaPipe reads
// from, the mirrored small preview (video + landmark canvas overlay) and the
// readiness check (video.readyState >= 2).
//
// Only this module calls getUserMedia. The preview is mirrored in CSS on the
// <video> only; the landmark canvas is NOT mirrored because handTracker already
// outputs mirror-space coordinates. No landmark maths happens here.
//
// Failure is never fatal: every camera problem is reported as a WebcamError with
// a readable message, the notice is drawn inside the preview, and the rest of the
// app (mouse controls, model) keeps working.

/** Video constraints: modest resolution keeps inference fast on laptops. */
const CAMERA_CONSTRAINTS = Object.freeze({
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 720 },
    height: { ideal: 540 },
    frameRate: { ideal: 30, max: 30 },
  },
});

/** HTMLMediaElement.HAVE_CURRENT_DATA - the first state with a usable frame. */
const VIDEO_READY_STATE = 2;
const START_TIMEOUT_MS = 10000;
/**
 * How long to wait for an answer to the permission prompt. A dismissed prompt
 * leaves getUserMedia pending forever, which would freeze the HUD on
 * "Starting camera…" with no way out.
 */
const PROMPT_TIMEOUT_MS = 20000;

/** Camera problem with a machine-readable code plus a user-facing message. */
export class WebcamError extends Error {
  /**
   * @param {'unsupported'|'denied'|'missing'|'busy'|'timeout'|'unknown'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'WebcamError';
    this.code = code;
  }
}

/**
 * True once the element has at least one decoded frame.
 * @param {HTMLVideoElement|null|undefined} video
 */
export function isVideoReady(video) {
  return Boolean(video) && video.readyState >= VIDEO_READY_STATE && video.videoWidth > 0;
}

/**
 * Build the preview and its controller. The <video> is created here and never
 * appended anywhere else.
 *
 * @param {HTMLElement} container where the preview card is mounted
 * @param {{ onEnded?: () => void }} [options] onEnded fires when the live track
 *   stops on its own (unplugged, permission revoked). An intentional stop() does not.
 * @returns {{
 *   video: HTMLVideoElement,
 *   canvas: HTMLCanvasElement,
 *   element: HTMLElement,
 *   start: () => Promise<HTMLVideoElement>,
 *   stop: () => void,
 *   isReady: () => boolean,
 *   showNotice: (code: string, message: string) => void,
 *   clearNotice: () => void,
 *   dispose: () => void,
 * }}
 */
export function attachWebcam(container, { onEnded } = {}) {
  if (!container) throw new Error('attachWebcam: a container element is required');

  const element = document.createElement('div');
  element.className = 'webcam';

  const video = document.createElement('video');
  video.className = 'webcam-video';
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('aria-label', 'Mirrored camera preview');

  const canvas = document.createElement('canvas');
  canvas.className = 'webcam-landmarks';

  const notice = document.createElement('p');
  notice.className = 'webcam-notice';
  notice.hidden = true;

  element.append(video, canvas, notice);
  container.appendChild(element);

  /** @type {MediaStream|null} */
  let stream = null;
  let starting = false;
  /** True while stop() is tearing the stream down, so 'ended' is not a surprise. */
  let stopping = false;

  function tracksLive() {
    if (!stream) return false;
    return stream.getVideoTracks().some((track) => track.readyState === 'live');
  }

  function handleTrackEnded() {
    if (stopping || !stream) return;
    stop();
    if (typeof onEnded === 'function') onEnded();
  }

  function watchTracks(nextStream) {
    for (const track of nextStream.getVideoTracks()) {
      track.addEventListener('ended', handleTrackEnded);
    }
  }

  function onVisible() {
    if (document.visibilityState !== 'visible' || !stream) return;
    const playResult = video.play?.();
    if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
  }

  function showNotice(code, message) {
    notice.hidden = false;
    notice.textContent = message;
    notice.dataset.code = code;
    element.classList.add('has-notice');
  }

  function clearNotice() {
    notice.hidden = true;
    notice.textContent = '';
    element.classList.remove('has-notice');
  }

  async function start() {
    if (stream && isVideoReady(video)) return video;
    if (starting) return video;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new WebcamError('unsupported', 'This browser does not expose a camera API.');
    }

    starting = true;
    clearNotice();

    try {
      const nextStream = await withTimeout(
        navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS),
        PROMPT_TIMEOUT_MS,
        () =>
          new WebcamError(
            'timeout',
            'No answer to the camera permission prompt. Allow it in the address bar and reload — mouse controls still work.',
          ),
      );
      stream = nextStream;
      watchTracks(nextStream);
      video.srcObject = nextStream;
      await waitForFirstFrame(video);
      element.classList.add('is-live');
      return video;
    } catch (error) {
      stop();
      throw translateCameraError(error);
    } finally {
      starting = false;
    }
  }

  function stop() {
    stopping = true;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.removeEventListener('ended', handleTrackEnded);
        track.stop();
      }
      stream = null;
    }
    video.srcObject = null;
    element.classList.remove('is-live');
    stopping = false;
  }

  document.addEventListener('visibilitychange', onVisible);

  return {
    video,
    canvas,
    element,
    start,
    stop,
    isReady: () => isVideoReady(video) && tracksLive(),
    showNotice,
    clearNotice,
    dispose() {
      document.removeEventListener('visibilitychange', onVisible);
      stop();
      element.remove();
    },
  };
}

/**
 * Reject with `errorFactory()` if `promise` has not settled within `timeoutMs`.
 * A late success is released immediately so the camera light cannot stay on.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {() => Error} errorFactory
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs, errorFactory) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(errorFactory());
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) {
          const lateStream = /** @type {{ getTracks?: () => MediaStreamTrack[] }} */ (value);
          for (const track of lateStream.getTracks?.() ?? []) track.stop();
          return;
        }
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Resolve when the element has decoded a frame, reject on timeout.
 * @param {HTMLVideoElement} video
 */
function waitForFirstFrame(video, timeoutMs = START_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (isVideoReady(video)) {
      resolve();
      return;
    }

    const finish = (error) => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoaded);
      if (error) reject(error);
      else resolve();
    };

    const onLoaded = () => {
      if (isVideoReady(video)) finish();
    };

    const timer = setTimeout(
      () => finish(new WebcamError('timeout', 'The camera did not start in time. Try again.')),
      timeoutMs,
    );

    video.addEventListener('loadeddata', onLoaded);
    // Muted autoplay is normally allowed; if a policy blocks it, the
    // 'loadeddata' listener above still fires once data arrives.
    const playResult = video.play?.();
    if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
  });
}

/**
 * Map a getUserMedia / playback failure onto a WebcamError with advice.
 * @param {unknown} error
 */
function translateCameraError(error) {
  const name = /** @type {{ name?: string }} */ (error)?.name ?? '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new WebcamError(
      'denied',
      'Camera permission was blocked. Allow it in the address bar and reload — mouse controls still work.',
    );
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new WebcamError('missing', 'No camera found. Plug one in — mouse controls still work.');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new WebcamError(
      'busy',
      'The camera is in use by another app. Close it and reload — mouse controls still work.',
    );
  }
  if (error instanceof WebcamError) return error;

  const detail = error instanceof Error ? error.message : String(error);
  return new WebcamError('unknown', `Could not start the camera: ${detail}`);
}
