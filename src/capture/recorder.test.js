// Unit tests for the recorder, driven against fake MediaRecorder / canvas / video
// objects. The browser's own encoder cannot be exercised in Node, so what is
// pinned here is everything around it: the support checks, the stream set-up, the
// chunk assembly into one file, the webcam composite geometry, the elapsed-time
// reporting and both failure paths.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRecorder, recordingSupport } from './recorder.js';

/** A MediaRecorder stand-in whose lifecycle the test drives by hand. */
class FakeMediaRecorder {
  static supported = ['video/webm;codecs=vp9', 'video/webm'];

  static isTypeSupported(mime) {
    return FakeMediaRecorder.supported.includes(mime);
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    this.startedWith = null;
    /** @type {FakeMediaRecorder[]} */
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice) {
    this.state = 'recording';
    this.startedWith = timeslice;
    FakeMediaRecorder.current = this;
  }

  stop() {
    this.state = 'inactive';
    if (this.onstop) this.onstop();
  }

  emit(bytes) {
    if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

FakeMediaRecorder.instances = [];
FakeMediaRecorder.current = null;

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { getTracks: () => tracks, tracks };
}

function fakeCanvas({ width = 800, height = 450, withCaptureStream = true } = {}) {
  const canvas = { width, height };
  if (withCaptureStream) {
    canvas.captureStream = (fps) => {
      canvas.capturedAt = fps;
      canvas.stream = fakeStream();
      return canvas.stream;
    };
  }
  return canvas;
}

test('recordingSupport reports each unsupported case', () => {
  const realRecorder = globalThis.MediaRecorder;
  const realDocument = globalThis.document;
  try {
    globalThis.MediaRecorder = FakeMediaRecorder;

    assert.equal(recordingSupport(null).reason, 'no-canvas');

    const noStream = fakeCanvas({ withCaptureStream: false });
    assert.equal(recordingSupport(noStream).reason, 'no-stream');

    delete globalThis.MediaRecorder;
    assert.equal(recordingSupport(fakeCanvas()).reason, 'no-recorder');

    globalThis.MediaRecorder = FakeMediaRecorder;
    FakeMediaRecorder.supported = ['video/nonsense'];
    const noMime = recordingSupport(fakeCanvas());
    assert.equal(noMime.reason, 'no-mime');
    assert.match(noMime.message, /no supported recording format/);

    FakeMediaRecorder.supported = ['video/webm;codecs=vp9', 'video/webm'];
    const ok = recordingSupport(fakeCanvas());
    assert.equal(ok.ok, true);
    assert.equal(ok.mimeType, 'video/webm;codecs=vp9');
  } finally {
    globalThis.MediaRecorder = realRecorder;
    globalThis.document = realDocument;
    FakeMediaRecorder.supported = ['video/webm;codecs=vp9', 'video/webm'];
  }
});

test('a recording collects every chunk and hands back one file', async () => {
  const realRecorder = globalThis.MediaRecorder;
  globalThis.MediaRecorder = FakeMediaRecorder;
  FakeMediaRecorder.instances = [];

  const canvas = fakeCanvas();
  /** @type {object|null} */
  let finished = null;
  const ticks = [];

  const recorder = createRecorder({
    canvas,
    onTick: (elapsed) => ticks.push(elapsed),
    onFinish: (result) => {
      finished = result;
    },
    onError: () => assert.fail('the recording should not fail'),
  });

  const started = recorder.start();
  assert.equal(started.ok, true);
  assert.equal(canvas.capturedAt, 30, 'thirty frames per second are requested');
  assert.equal(recorder.isRecording(), true);

  const media = FakeMediaRecorder.current;
  assert.equal(media.options.mimeType, 'video/webm;codecs=vp9');
  assert.equal(media.startedWith, 1000, 'a one-second timeslice keeps memory bounded');

  media.emit([1, 2, 3]);
  media.emit([4, 5]);

  // The clock is driven by the app loop, so pass a time well past the throttle.
  recorder.tick(performance.now() + 500);
  assert.equal(ticks.length >= 1, true);
  assert.equal(ticks[0] >= 0, true);

  assert.equal(recorder.stop(), true);
  assert.equal(recorder.isRecording(), false);
  assert.equal(canvas.stream.tracks[0].stopped, true, 'the capture track is released');

  assert.ok(finished, 'onFinish fired');
  assert.equal(finished.blob.size, 5, 'the chunks are concatenated');
  assert.equal(finished.mimeType, 'video/webm;codecs=vp9');
  assert.match(finished.filename, /^hologram-.*\.webm$/);
  assert.equal(finished.durationMs >= 0, true);

  globalThis.MediaRecorder = realRecorder;
});

test('a recording with no frames reports an encode failure', () => {
  const realRecorder = globalThis.MediaRecorder;
  globalThis.MediaRecorder = FakeMediaRecorder;
  FakeMediaRecorder.instances = [];

  const errors = [];
  const recorder = createRecorder({
    canvas: fakeCanvas(),
    onFinish: () => assert.fail('there is nothing to finish with'),
    onError: (reason, message) => errors.push({ reason, message }),
  });

  recorder.start();
  recorder.stop();

  assert.equal(errors.length, 1, 'exactly one error');
  assert.equal(errors[0].reason, 'encode');
  assert.match(errors[0].message, /could not encode/);

  globalThis.MediaRecorder = realRecorder;
});

test('start refuses a second recording and an unsupported canvas', () => {
  const realRecorder = globalThis.MediaRecorder;
  globalThis.MediaRecorder = FakeMediaRecorder;
  FakeMediaRecorder.instances = [];

  const recorder = createRecorder({ canvas: fakeCanvas(), onError: () => {} });
  assert.equal(recorder.start().ok, true);
  const second = recorder.start();
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'busy');
  recorder.stop();

  const broken = createRecorder({
    canvas: fakeCanvas({ withCaptureStream: false }),
    onError: () => {},
  });
  const failed = broken.start();
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'no-stream');
  assert.equal(broken.isRecording(), false);

  globalThis.MediaRecorder = realRecorder;
});

test('the webcam composite draws the view and an inset, and stops both', () => {
  const realRecorder = globalThis.MediaRecorder;
  const realDocument = globalThis.document;
  globalThis.MediaRecorder = FakeMediaRecorder;
  FakeMediaRecorder.instances = [];

  /** @type {any[]} */
  const drawCalls = [];
  /** @type {any[]} */
  const strokeRects = [];
  const compositeContext = {
    strokeStyle: '',
    lineWidth: 0,
    drawImage: (...args) => drawCalls.push(args),
    strokeRect: (...args) => strokeRects.push(args),
    save: () => {},
    restore: () => {},
  };

  globalThis.document = {
    createElement: () => {
      const canvas = fakeCanvas({ width: 800, height: 450 });
      canvas.getContext = () => compositeContext;
      return canvas;
    },
  };

  const video = { readyState: 2, videoWidth: 320, videoHeight: 240 };
  const source = fakeCanvas({ width: 800, height: 450 });
  const errors = [];
  let finished = null;
  const recorder = createRecorder({
    canvas: source,
    getWebcamVideo: () => video,
    onFinish: (result) => {
      finished = result;
    },
    onError: (reason, message) => errors.push({ reason, message }),
  });

  assert.equal(recorder.start({ includeWebcam: true }).ok, true);
  assert.equal(recorder.isComposite(), true);
  assert.equal(recorder.usesWebcam(), true);

  // One composited frame is two draws: the hologram, then the webcam inset.
  // It is drawn once when the recording starts, before any tick.
  assert.equal(drawCalls.length, 2);
  assert.deepEqual(drawCalls[0], [source, 0, 0, 800, 450]);
  assert.deepEqual(drawCalls[1], [video, 604, 298, 176, 132]);
  assert.deepEqual(strokeRects[0], [604, 298, 176, 132]);

  // A tick keeps the composite fresh, at the same geometry.
  recorder.tick(performance.now() + 400);
  assert.equal(drawCalls.length, 4);
  assert.deepEqual(drawCalls[2], [source, 0, 0, 800, 450]);
  assert.deepEqual(drawCalls[3], [video, 604, 298, 176, 132]);
  assert.equal(strokeRects.length, 2);

  // One encoded chunk, as a real browser would deliver each timeslice.
  FakeMediaRecorder.current.emit([1, 2, 3, 4]);
  recorder.stop();

  assert.deepEqual(errors, [], 'the composite recording completes');
  assert.equal(finished.blob.size, 4);
  assert.match(finished.filename, /\.webm$/);
  assert.equal(recorder.isComposite(), false, 'the composite is released on stop');

  globalThis.MediaRecorder = realRecorder;
  globalThis.document = realDocument;
});

test('a webcam that is not ready yet is skipped, not drawn as garbage', () => {
  const realRecorder = globalThis.MediaRecorder;
  const realDocument = globalThis.document;
  globalThis.MediaRecorder = FakeMediaRecorder;
  FakeMediaRecorder.instances = [];

  const drawCalls = [];
  globalThis.document = {
    createElement: () => {
      const canvas = fakeCanvas({ width: 400, height: 300 });
      canvas.getContext = () => ({
        strokeStyle: '',
        lineWidth: 0,
        drawImage: (...args) => drawCalls.push(args),
        strokeRect: () => {},
        save: () => {},
        restore: () => {},
      });
      return canvas;
    },
  };

  const recorder = createRecorder({
    canvas: fakeCanvas({ width: 400, height: 300 }),
    getWebcamVideo: () => ({ readyState: 0, videoWidth: 0, videoHeight: 0 }),
    onError: () => {},
  });

  recorder.start({ includeWebcam: true });
  // Only the hologram itself, no inset.
  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0].length, 5);
  recorder.stop();

  globalThis.MediaRecorder = realRecorder;
  globalThis.document = realDocument;
});

test('dispose stops a running recorder without delivering a file', () => {
  const realRecorder = globalThis.MediaRecorder;
  globalThis.MediaRecorder = FakeMediaRecorder;
  FakeMediaRecorder.instances = [];

  let finished = false;
  const canvas = fakeCanvas();
  const recorder = createRecorder({
    canvas,
    onFinish: () => {
      finished = true;
    },
    onError: () => {},
  });

  recorder.start();
  FakeMediaRecorder.current.emit([1, 2]);
  recorder.dispose();

  assert.equal(finished, false, 'teardown never pretends a recording completed');
  assert.equal(recorder.isRecording(), false);
  assert.equal(canvas.stream.tracks[0].stopped, true);

  globalThis.MediaRecorder = realRecorder;
});
