// src/audio/sound.test.js
// Exercises the real sound module against a minimal fake Web Audio API, so the
// graph - ambient hum, cue oscillators, zoom tone lifecycle, mute, volume and the
// "no context before a user gesture" rule - is verified without speakers.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSound } from './sound.js';

/* ------------------------------------------------------------- fakes --- */

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.events.push(['set', value, time]);
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value, time) {
    this.events.push(['linear', value, time]);
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value, time) {
    this.events.push(['exp', value, time]);
    this.value = value;
    return this;
  }

  setTargetAtTime(value, time, constant) {
    this.events.push(['target', value, time, constant]);
    this.value = value;
    return this;
  }

  cancelScheduledValues(time) {
    this.events.push(['cancel', time]);
    return this;
  }
}

class FakeNode {
  constructor(context) {
    this.context = context;
    this.outputs = [];
    this.endedListeners = [];
  }

  connect(node) {
    this.outputs.push(node);
    return node;
  }

  disconnect() {
    this.outputs.length = 0;
  }

  addEventListener(type, listener) {
    if (type === 'ended') this.endedListeners.push(listener);
  }

  emitEnded() {
    for (const listener of this.endedListeners) listener();
  }
}

class FakeGain extends FakeNode {
  constructor(context) {
    super(context);
    this.gain = new FakeParam(1);
    context.gains.push(this);
  }
}

class FakeFilter extends FakeNode {
  constructor(context) {
    super(context);
    this.type = 'lowpass';
    this.frequency = new FakeParam(350);
    this.Q = new FakeParam(1);
  }
}

class FakeOscillator extends FakeNode {
  constructor(context) {
    super(context);
    this.type = 'sine';
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.started = false;
    this.stopped = false;
  }

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
  }
}

class FakeContext {
  static instances = [];

  constructor() {
    this.state = 'suspended';
    this.currentTime = 1;
    this.destination = new FakeNode(this);
    this.oscillators = [];
    this.gains = [];
    this.closed = false;
    FakeContext.instances.push(this);
  }

  createGain() {
    return new FakeGain(this);
  }

  createBiquadFilter() {
    return new FakeFilter(this);
  }

  createOscillator() {
    const oscillator = new FakeOscillator(this);
    this.oscillators.push(oscillator);
    return oscillator;
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

/** Install the fakes as `window` for one test. */
function installFakeWindow() {
  FakeContext.instances = [];
  const timers = [];

  globalThis.window = {
    AudioContext: FakeContext,
    setTimeout: (fn) => {
      timers.push(fn);
      fn();
      return timers.length;
    },
  };

  return {
    timers,
    restore() {
      delete globalThis.window;
    },
  };
}

const startedOscillators = (context) => context.oscillators.filter((osc) => osc.started);

/* ------------------------------------------------------------- tests --- */

test('no AudioContext is created before a user gesture', () => {
  const env = installFakeWindow();
  try {
    const sound = createSound();
    sound.playGrab();
    sound.playRelease();
    sound.startZoom();
    sound.updateZoom(1);
    sound.playReset();

    assert.equal(FakeContext.instances.length, 0, 'cues must not create a context');
    assert.equal(sound.isUnlocked(), false);
  } finally {
    env.restore();
  }
});

test('unlock creates the context once and starts the ambient hum', () => {
  const env = installFakeWindow();
  try {
    const sound = createSound();
    sound.unlock();
    sound.unlock();

    assert.equal(FakeContext.instances.length, 1, 'unlock is idempotent');

    const context = FakeContext.instances[0];
    assert.equal(context.state, 'running', 'a suspended context is resumed');

    // Two carriers (55 Hz and 82.5 Hz) plus one slow LFO each for the detune.
    const hum = startedOscillators(context);
    assert.equal(hum.length, 4, 'two hum carriers and their two LFOs');

    const carriers = hum.filter((osc) => osc.frequency.value === 55 || osc.frequency.value === 82.5);
    assert.equal(carriers.length, 2, 'the two carriers are at the expected pitches');
    assert.equal(sound.isUnlocked(), true);
  } finally {
    env.restore();
  }
});

test('a grab after unlock plays exactly one short tone', () => {
  const env = installFakeWindow();
  try {
    const sound = createSound();
    sound.unlock();

    const context = FakeContext.instances[0];
    const before = startedOscillators(context).length;
    sound.playGrab();

    const started = startedOscillators(context);
    assert.equal(started.length, before + 1, 'one oscillator per blip');

    const blip = started[started.length - 1];
    assert.equal(blip.type, 'triangle');
    assert.ok(blip.frequency.events.length >= 2, 'the blip sweeps its frequency');
    assert.equal(blip.stopped, true, 'and is stopped again');
  } finally {
    env.restore();
  }
});

test('mute sets the master gain to zero and volume scales it', () => {
  const env = installFakeWindow();
  try {
    const sound = createSound({ volume: 1 });
    sound.unlock();

    const context = FakeContext.instances[0];
    const master = context.gains[0];

    sound.setMuted(true);
    assert.equal(master.gain.value, 0, 'muted master is silent');

    sound.setMuted(false);
    assert.ok(master.gain.value > 0, 'unmuting restores the level');

    sound.setVolume(0.5);
    const atHalf = master.gain.value;
    sound.setVolume(1);
    assert.ok(master.gain.value > atHalf, 'volume scales the master level');
  } finally {
    env.restore();
  }
});

test('the zoom tone starts once, follows speed and stops once', () => {
  const env = installFakeWindow();
  try {
    const sound = createSound();
    sound.unlock();

    const context = FakeContext.instances[0];
    const before = startedOscillators(context).length;

    sound.startZoom();
    sound.startZoom(); // idempotent: a second start must not stack tones
    const started = startedOscillators(context);
    assert.equal(started.length, before + 1, 'exactly one zoom oscillator');

    const zoom = started[started.length - 1];
    assert.equal(zoom.type, 'sawtooth');
    const restingHz = zoom.frequency.value;

    sound.updateZoom(2.2); // full speed
    assert.ok(zoom.frequency.value > restingHz, 'speed raises the pitch');

    sound.updateZoom(0);
    assert.ok(zoom.frequency.value < restingHz + 1, 'a still hand settles low');

    sound.stopZoom();
    assert.equal(zoom.stopped, true, 'the tone is stopped');
  } finally {
    env.restore();
  }
});

test('muting while zooming stops the tone', () => {
  const env = installFakeWindow();
  try {
    const sound = createSound();
    sound.unlock();

    const context = FakeContext.instances[0];
    const before = startedOscillators(context).length;
    sound.startZoom();
    const zoom = startedOscillators(context)[before];

    sound.setMuted(true);
    assert.equal(zoom.stopped, true);
  } finally {
    env.restore();
  }
});

test('the reset cue plays two notes', () => {
  const env = installFakeWindow();
  try {
    const sound = createSound();
    sound.unlock();

    const context = FakeContext.instances[0];
    const before = startedOscillators(context).length;
    sound.playReset();

    assert.equal(startedOscillators(context).length, before + 2, 'two notes');
  } finally {
    env.restore();
  }
});

test('dispose closes the context and further cues stay silent', () => {
  const env = installFakeWindow();
  try {
    const sound = createSound();
    sound.unlock();

    const context = FakeContext.instances[0];
    sound.dispose();
    assert.equal(context.closed, true);

    const before = startedOscillators(context).length;
    sound.playGrab();
    assert.equal(startedOscillators(context).length, before, 'no sound after dispose');
    assert.equal(FakeContext.instances.length, 1, 'dispose does not create another context');
  } finally {
    env.restore();
  }
});
