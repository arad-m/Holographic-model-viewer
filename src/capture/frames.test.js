// Unit tests for the pure capture rules: container selection, filenames, the
// duration readout, frame sizing and the unsupported-browser wording.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SCREENSHOT_EDGE,
  describeCaptureError,
  extensionForMime,
  fitCaptureSize,
  formatDuration,
  pickMimeType,
  recordingFilename,
  screenshotFilename,
  timestampFor,
} from './frames.js';

/** A frozen local date so filenames are stable wherever the test runs. */
const FIXED = new Date(2026, 10, 3, 23, 12, 0);

test('pickMimeType prefers the smallest codec the browser supports', () => {
  assert.equal(pickMimeType((mime) => mime === 'video/webm;codecs=vp9'), 'video/webm;codecs=vp9');
  assert.equal(pickMimeType((mime) => mime.includes('vp8')), 'video/webm;codecs=vp8');
  assert.equal(pickMimeType((mime) => mime === 'video/webm'), 'video/webm');
  assert.equal(pickMimeType((mime) => mime.includes('mp4')), 'video/mp4;codecs=avc1.42E01E');
});

test('pickMimeType falls back through the list, best first', () => {
  // A browser that only does plain WebM must not pick VP9 just because it is first.
  const onlyPlainWebm = pickMimeType((mime) => mime === 'video/webm');
  assert.equal(onlyPlainWebm, 'video/webm');

  const everything = pickMimeType(() => true);
  assert.equal(everything, 'video/webm;codecs=vp9');
});

test('pickMimeType returns null when nothing is supported', () => {
  assert.equal(pickMimeType(() => false), null);
  assert.equal(pickMimeType(undefined), null);
  assert.equal(pickMimeType(() => {
    throw new Error('probe exploded');
  }), null);
});

test('extensionForMime follows the container', () => {
  assert.equal(extensionForMime('video/webm;codecs=vp9'), 'webm');
  assert.equal(extensionForMime('video/mp4'), 'mp4');
  assert.equal(extensionForMime(''), 'webm');
  assert.equal(extensionForMime(null), 'webm');
});

test('timestampFor is zero-padded and free of path-hostile characters', () => {
  assert.equal(timestampFor(FIXED), '2026-11-03-231200');
  assert.equal(timestampFor(new Date(2026, 0, 9, 4, 5, 6)), '2026-01-09-040506');
  assert.match(timestampFor(new Date(Number.NaN)), /^\d{4}-\d{2}-\d{2}-\d{6}$/);
});

test('screenshot and recording names carry the right extension', () => {
  assert.equal(screenshotFilename(FIXED), 'hologram-2026-11-03-231200.png');
  assert.equal(recordingFilename('video/webm;codecs=vp9', FIXED), 'hologram-2026-11-03-231200.webm');
  assert.equal(recordingFilename('video/mp4', FIXED), 'hologram-2026-11-03-231200.mp4');
});

test('formatDuration reads as minutes and seconds', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(1_000), '0:01');
  assert.equal(formatDuration(9_400), '0:09');
  assert.equal(formatDuration(61_000), '1:01');
  assert.equal(formatDuration(600_000), '10:00');
  assert.equal(formatDuration(-500), '0:00');
  assert.equal(formatDuration(Number.NaN), '0:00');
});

test('fitCaptureSize keeps the aspect ratio and never upscales', () => {
  assert.deepEqual(fitCaptureSize(800, 600, 4096), { width: 800, height: 600 });
  assert.deepEqual(fitCaptureSize(8000, 4000, 4096), { width: 4096, height: 2048 });
  assert.deepEqual(fitCaptureSize(4000, 8000, 4096), { width: 2048, height: 4096 });
  // An already-small frame is untouched by the default limit.
  assert.deepEqual(fitCaptureSize(390, 560), { width: 390, height: 560 });
});

test('fitCaptureSize survives junk dimensions', () => {
  assert.deepEqual(fitCaptureSize(0, 0), { width: 1, height: 1 });
  assert.deepEqual(fitCaptureSize(Number.NaN, 10), { width: 1, height: 1 });
  assert.deepEqual(fitCaptureSize(600, 400, Number.NaN), { width: 600, height: 400 });
  assert.equal(MAX_SCREENSHOT_EDGE, 4096);
});

test('describeCaptureError names every unsupported case', () => {
  assert.match(describeCaptureError('no-recorder'), /cannot record video/);
  assert.match(describeCaptureError('no-mime'), /no supported recording format/);
  assert.match(describeCaptureError('no-stream'), /cannot capture the canvas/);
  assert.match(describeCaptureError('no-canvas'), /no rendered view/);
  assert.match(describeCaptureError('encode'), /could not encode/);
  assert.match(describeCaptureError(null), /Capture failed/);
  assert.match(describeCaptureError('something else'), /Capture failed/);
});
