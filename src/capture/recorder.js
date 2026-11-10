// src/capture/recorder.js
// Owns: recording the hologram view to a downloadable video.
//
// The stream comes from `canvas.captureStream(30)` on the WebGL canvas, so what is
// recorded is exactly what is on screen - no re-rendering, no extra draw calls.
// With "include camera preview" ticked, the frames are first composited with the
// webcam video onto a 2D canvas and that canvas is streamed instead; the composite
// is drawn from the app's single animation loop (tick), never from a second rAF.
//
// Every unsupported case is reported as a reason code, not an exception.

import { describeCaptureError, pickMimeType, recordingFilename } from './frames.js';

/** Frames per second requested from captureStream. */
const CAPTURE_FPS = 30;

/** How often the UI is allowed to update the elapsed time, in ms. */
const TICK_INTERVAL_MS = 200;

/** Webcam inset width as a fraction of the frame. */
const WEBCAM_WIDTH_RATIO = 0.22;
/** Inset margin as a fraction of the frame. */
const WEBCAM_MARGIN_RATIO = 0.025;
/** Never let the inset get smaller than this, in pixels. */
const WEBCAM_MIN_WIDTH = 120;

/**
 * Can this browser record the canvas at all?
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ ok: boolean, reason: string|null, message: string, mimeType: string|null }}
 */
export function recordingSupport(canvas) {
  if (!canvas) {
    return {
      ok: false,
      reason: 'no-canvas',
      message: describeCaptureError('no-canvas'),
      mimeType: null,
    };
  }

  if (typeof MediaRecorder === 'undefined') {
    return {
      ok: false,
      reason: 'no-recorder',
      message: describeCaptureError('no-recorder'),
      mimeType: null,
    };
  }

  if (typeof canvas.captureStream !== 'function') {
    return {
      ok: false,
      reason: 'no-stream',
      message: describeCaptureError('no-stream'),
      mimeType: null,
    };
  }

  const mimeType = pickMimeType((mime) => MediaRecorder.isTypeSupported(mime));
  if (!mimeType) {
    return {
      ok: false,
      reason: 'no-mime',
      message: describeCaptureError('no-mime'),
      mimeType: null,
    };
  }

  return { ok: true, reason: null, message: '', mimeType };
}

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   getWebcamVideo?: () => HTMLVideoElement|null,
 *   onTick?: (elapsedMs: number) => void,
 *   onFinish?: (result: { blob: Blob, mimeType: string, durationMs: number, filename: string }) => void,
 *   onError?: (reason: string, message: string) => void,
 * }} options
 */
export function createRecorder({ canvas, getWebcamVideo, onTick, onFinish, onError }) {
  /** @type {MediaRecorder|null} */
  let recorder = null;
  /** @type {MediaRecorderOptions} */
  let recorderOptions = {};
  /** @type {Blob[]} */
  let chunks = [];
  /** @type {MediaStream|null} */
  let stream = null;
  /** @type {HTMLCanvasElement|null} */
  let compositeCanvas = null;
  /** @type {CanvasRenderingContext2D|null} */
  let compositeContext = null;
  let includeWebcam = false;
  let startedAt = 0;
  let lastTickEmit = 0;
  let running = false;
  let mimeType = '';

  function isRecording() {
    return running;
  }

  function elapsedMs(nowMs = performance.now()) {
    return running ? Math.max(0, nowMs - startedAt) : 0;
  }

  function stopStream() {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // A dead track is fine.
      }
    }
    stream = null;
  }

  function disposeComposite() {
    compositeCanvas = null;
    compositeContext = null;
  }

  /**
   * Draw the hologram plus the webcam inset onto the composite canvas. Called
   * from the app loop while recording.
   */
  function drawCompositeFrame() {
    if (!compositeContext || !compositeCanvas) return;
    const width = compositeCanvas.width;
    const height = compositeCanvas.height;
    if (width <= 0 || height <= 0) return;

    // The hologram first, at full size.
    compositeContext.drawImage(canvas, 0, 0, width, height);

    const video = typeof getWebcamVideo === 'function' ? getWebcamVideo() : null;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    const insetWidth = Math.max(WEBCAM_MIN_WIDTH, Math.round(width * WEBCAM_WIDTH_RATIO));
    const insetHeight = Math.round((insetWidth * video.videoHeight) / video.videoWidth);
    const margin = Math.round(width * WEBCAM_MARGIN_RATIO);
    const x = width - insetWidth - margin;
    const y = height - insetHeight - margin;

    compositeContext.save();
    compositeContext.strokeStyle = 'rgba(111, 224, 255, 0.75)';
    compositeContext.lineWidth = Math.max(1, Math.round(width / 640));
    compositeContext.drawImage(video, x, y, insetWidth, insetHeight);
    compositeContext.strokeRect(x, y, insetWidth, insetHeight);
    compositeContext.restore();
  }

  function buildCompositeSize() {
    return {
      width: Math.max(2, canvas.width || canvas.clientWidth || 2),
      height: Math.max(2, canvas.height || canvas.clientHeight || 2),
    };
  }

  function handleStop() {
    const durationMs = elapsedMs(performance.now());
    running = false;
    stopStream();
    disposeComposite();

    const recordedMime = mimeType;
    const blob = chunks.length > 0 ? new Blob(chunks, { type: recordedMime }) : null;
    chunks = [];
    mimeType = '';
    recorder = null;
    recorderOptions = {};

    if (!blob || blob.size === 0) {
      if (typeof onError === 'function') onError('encode', describeCaptureError('encode'));
      return;
    }

    if (typeof onFinish === 'function') {
      onFinish({
        blob,
        mimeType: recordedMime,
        durationMs,
        filename: recordingFilename(recordedMime),
      });
    }
  }

  /**
   * @param {{ includeWebcam?: boolean }} [options]
   * @returns {{ ok: boolean, reason: string|null, message: string }}
   */
  function start({ includeWebcam: withWebcam = false } = {}) {
    if (running) return { ok: false, reason: 'busy', message: 'Already recording.' };

    const support = recordingSupport(canvas);
    if (!support.ok) {
      if (typeof onError === 'function') onError(support.reason, support.message);
      return { ok: false, reason: support.reason, message: support.message };
    }

    includeWebcam = Boolean(withWebcam);
    chunks = [];
    mimeType = support.mimeType;

    try {
      if (includeWebcam) {
        const size = buildCompositeSize();
        compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = size.width;
        compositeCanvas.height = size.height;
        compositeContext = compositeCanvas.getContext('2d');
        if (!compositeContext) throw new Error('No 2D context for the recording composite');
        drawCompositeFrame();
        stream = compositeCanvas.captureStream(CAPTURE_FPS);
      } else {
        stream = canvas.captureStream(CAPTURE_FPS);
      }
    } catch (error) {
      stopStream();
      disposeComposite();
      const reason = describeCaptureError('no-stream');
      if (typeof onError === 'function') onError('no-stream', reason);
      console.warn('Could not start the capture stream', error);
      return { ok: false, reason: 'no-stream', message: reason };
    }

    recorderOptions = { mimeType, videoBitsPerSecond: 8_000_000 };
    try {
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch {
      // Some builds reject the bitrate/codec pair: retry with the bare mime.
      try {
        recorderOptions = { mimeType };
        recorder = new MediaRecorder(stream, recorderOptions);
      } catch (error) {
        stopStream();
        disposeComposite();
        if (typeof onError === 'function') onError('no-recorder', describeCaptureError('encode'));
        console.warn('MediaRecorder could not be created', error);
        return { ok: false, reason: 'no-recorder', message: describeCaptureError('no-recorder') };
      }
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      console.warn('MediaRecorder error', event?.error ?? event);
    };
    recorder.onstop = handleStop;

    startedAt = performance.now();
    lastTickEmit = startedAt;
    running = true;

    try {
      // A timeslice keeps memory bounded and gives ondataavailable regular work.
      recorder.start(1000);
    } catch (error) {
      running = false;
      stopStream();
      disposeComposite();
      if (typeof onError === 'function') onError('encode', describeCaptureError('encode'));
      console.warn('MediaRecorder could not start', error);
      running = false;
      return { ok: false, reason: 'encode', message: describeCaptureError('encode') };
    }

    return { ok: true, reason: null, message: '' };
  }

  /** Stop and let `onFinish` deliver the file. Safe to call when idle. */
  function stop() {
    if (!running || !recorder) return false;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      handleStop();
    }
    return true;
  }

  /**
   * Drive the recorder from the app's single loop: keeps the webcam composite
   * up to date and reports elapsed time to the UI.
   * @param {number} nowMs
   */
  function tick(nowMs) {
    if (!running) return;
    if (compositeContext) drawCompositeFrame();

    if (nowMs - lastTickEmit < TICK_INTERVAL_MS) return;
    lastTickEmit = nowMs;
    if (typeof onTick === 'function') onTick(elapsedMs(nowMs));
  }

  function dispose() {
    if (running) {
      try {
        if (recorder && recorder.state !== 'inactive') {
          recorder.onstop = null;
          recorder.stop();
        }
      } catch {
        // Nothing to salvage on teardown.
      }
    }
    running = false;
    chunks = [];
    stopStream();
    disposeComposite();
    recorder = null;
  }

  return {
    start,
    stop,
    tick,
    dispose,
    isRecording,
    elapsedMs,
    getMimeType: () => mimeType,
    isComposite: () => Boolean(compositeContext),
    usesWebcam: () => includeWebcam,
  };
}
