// src/capture/frames.js
// Owns: the pure rules behind capture - which container the browser can record,
// what the downloaded files are called, how big a frame may be, and the wording
// for the unsupported cases.
//
// Pure: no canvas, no MediaRecorder, no DOM. Unit tested.

/**
 * Recording containers, best first. VP9 is the smallest, VP8 is the widest
 * supported, WebM without a codec lets the browser choose, and MP4 is the
 * Safari fallback (Safari records H.264 MP4, not WebM).
 */
export const MIME_CANDIDATES = Object.freeze([
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
]);

/** Longest edge of a saved screenshot, in pixels. */
export const MAX_SCREENSHOT_EDGE = 4096;

/** Longest edge of a library thumbnail. */
export const THUMBNAIL_SIZE = 320;

/**
 * First container the browser actually supports.
 *
 * @param {(mime: string) => boolean} isSupported typically
 *   (mime) => MediaRecorder.isTypeSupported(mime)
 * @returns {string|null} null when nothing is supported
 */
export function pickMimeType(isSupported) {
  if (typeof isSupported !== 'function') return null;
  for (const mime of MIME_CANDIDATES) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      // A throwing probe means "not supported" for that entry, not a crash.
    }
  }
  return null;
}

/**
 * File extension for a container string.
 * @param {string} mime
 * @returns {'webm'|'mp4'}
 */
export function extensionForMime(mime) {
  return String(mime ?? '').toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

/**
 * `2026-11-03-2312` — local time, sorts lexically, no colons (Windows).
 * @param {Date} date
 * @returns {string}
 */
export function timestampFor(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    `${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`,
  ].join('-');
}

/**
 * @param {Date} [date]
 * @returns {string} e.g. `hologram-2026-11-03-231200.png`
 */
export function screenshotFilename(date = new Date()) {
  return `hologram-${timestampFor(date)}.png`;
}

/**
 * @param {string} mime
 * @param {Date} [date]
 * @returns {string} e.g. `hologram-2026-11-03-231200.webm`
 */
export function recordingFilename(mime, date = new Date()) {
  return `hologram-${timestampFor(date)}.${extensionForMime(mime)}`;
}

/**
 * `0:07`, `1:42`, `12:05`. Minutes do not roll into hours: a capture that long
 * deserves the full number in one unit.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Scale a frame down to fit `maxEdge`, preserving aspect, never up.
 * Returns integers because canvas dimensions must be integers.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} maxEdge
 * @returns {{ width: number, height: number }}
 */
export function fitCaptureSize(width, height, maxEdge = MAX_SCREENSHOT_EDGE) {
  const w = Number.isFinite(width) ? Math.floor(width) : 0;
  const h = Number.isFinite(height) ? Math.floor(height) : 0;
  const limit = Number.isFinite(maxEdge) && maxEdge > 0 ? Math.floor(maxEdge) : MAX_SCREENSHOT_EDGE;
  if (w <= 0 || h <= 0) return { width: 1, height: 1 };

  const largest = Math.max(w, h);
  if (largest <= limit) return { width: w, height: h };

  const scale = limit / largest;
  return {
    width: Math.max(1, Math.floor(w * scale)),
    height: Math.max(1, Math.floor(h * scale)),
  };
}

/**
 * Why a capture is unavailable, in words a user can act on.
 * @param {'no-canvas'|'no-stream'|'no-recorder'|'no-mime'|'encode'|'unknown'|null} reason
 * @returns {string}
 */
export function describeCaptureError(reason) {
  switch (reason) {
    case 'no-canvas':
      return 'There is no rendered view to capture yet.';
    case 'no-stream':
      return 'This browser cannot capture the canvas.';
    case 'no-recorder':
      return 'This browser cannot record video.';
    case 'no-mime':
      return 'This browser offers no supported recording format.';
    case 'encode':
      return 'Recording failed — the browser could not encode the frames.';
    default:
      return 'Capture failed.';
  }
}
