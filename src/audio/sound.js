// src/audio/sound.js
// Owns: all audio feedback. Everything is synthesized with Web Audio - no asset
// files, nothing to download - and the AudioContext is created only after a real
// user gesture (browsers block audio until then).
//
// Cues are edge-triggered: main.js calls playGrab() once per grab, never per
// frame, so a held pinch cannot produce a repeating blip. The zoom tone is the
// one continuous sound: startZoom() on entry, updateZoom(speed) while it runs,
// stopZoom() on exit.
//
// Never throws if WebAudio is missing or blocked; it just stays silent.

/** Master level is scaled by this, so the max volume is still comfortable. */
const MASTER_LEVEL = 0.9;
/** Ambient hum level (very quiet on purpose: it sits under everything). */
const HUM_LEVEL = 0.05;
/** Zoom tone level. */
const ZOOM_LEVEL = 0.07;
/** Zoom tone frequency range, Hz, mapped from zoom speed. */
const ZOOM_MIN_HZ = 150;
const ZOOM_MAX_HZ = 620;
/** Zoom speed (factor change per second) that maps to ZOOM_MAX_HZ. */
const ZOOM_SPEED_REFERENCE = 2.2;

/**
 * @param {{ volume?: number, muted?: boolean }} [options]
 * @returns {{
 *   unlock: () => void,
 *   isUnlocked: () => boolean,
 *   setMuted: (muted: boolean) => void,
 *   setVolume: (volume: number) => void,
 *   playGrab: () => void,
 *   playRelease: () => void,
 *   startZoom: () => void,
 *   updateZoom: (speed: number) => void,
 *   stopZoom: () => void,
 *   playReset: () => void,
 *   dispose: () => void,
 * }}
 */
export function createSound(options = {}) {
  const initialVolume = clamp(options.volume ?? 0.7, 0, 1);
  let volume = initialVolume;
  let muted = options.muted ?? false;

  /** @type {AudioContext|null} */
  let context = null;
  /** @type {GainNode|null} */
  let master = null;
  /** @type {OscillatorNode[]} */
  let humOscillators = [];
  /** @type {OscillatorNode|null} */
  let zoomOscillator = null;
  /** @type {GainNode|null} */
  let zoomGain = null;
  let zoomActive = false;
  let disposed = false;

  function masterLevel() {
    return muted ? 0 : volume * MASTER_LEVEL;
  }

  /**
   * Create the context and the ambient hum. Called from a user gesture; safe to
   * call repeatedly.
   */
  function unlock() {
    if (disposed) return;
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {});
      return;
    }

    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return;

    try {
      context = new Ctor();
    } catch {
      context = null;
      return;
    }

    master = context.createGain();
    master.gain.value = masterLevel();
    master.connect(context.destination);

    startHum();
    if (context.state === 'suspended') context.resume().catch(() => {});
  }

  /** A low two-oscillator drone through a lowpass, always running once unlocked. */
  function startHum() {
    if (!context || !master) return;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    filter.Q.value = 0.6;

    const humGain = context.createGain();
    humGain.gain.value = HUM_LEVEL;
    filter.connect(humGain);
    humGain.connect(master);

    humOscillators = [55, 82.5].map((hz, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = hz;
      // Slight detune so the two tones beat gently instead of sitting dead flat.
      oscillator.detune.value = index === 0 ? -4 : 5;

      const lfo = context.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.07 + index * 0.03;
      const lfoGain = context.createGain();
      lfoGain.gain.value = 1.6;
      lfo.connect(lfoGain);
      lfoGain.connect(oscillator.detune);

      oscillator.connect(filter);
      oscillator.start();
      lfo.start();
      return oscillator;
    });
  }

  /**
   * One short enveloped tone.
   * @param {{ from: number, to: number, duration: number, level: number, type?: OscillatorType }} spec
   */
  function blip({ from, to, duration, level, type = 'sine' }) {
    if (!context || !master || muted) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + Math.min(0.02, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);

    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    });
  }

  // NOTE: no cue may create the AudioContext. Only unlock() may, and that runs
  // from a real pointer/key gesture. A cue before then stays silent - otherwise
  // every cue would spam "AudioContext was not allowed to start".
  /** Bright, short: "you have the model". */
  function playGrab() {
    blip({ from: 520, to: 780, duration: 0.1, level: 0.22, type: 'triangle' });
  }

  /** Softer and lower: "let go". */
  function playRelease() {
    blip({ from: 420, to: 290, duration: 0.16, level: 0.12, type: 'sine' });
  }

  /** Start the continuous zoom tone (idempotent). */
  function startZoom() {
    if (!context || !master || zoomActive) return;

    zoomActive = true;
    zoomOscillator = context.createOscillator();
    zoomOscillator.type = 'sawtooth';
    zoomOscillator.frequency.value = ZOOM_MIN_HZ;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;

    zoomGain = context.createGain();
    zoomGain.gain.setValueAtTime(0.0001, context.currentTime);
    zoomGain.gain.exponentialRampToValueAtTime(ZOOM_LEVEL, context.currentTime + 0.06);

    zoomOscillator.connect(filter);
    filter.connect(zoomGain);
    zoomGain.connect(master);
    zoomOscillator.start();
  }

  /**
   * Follow the zoom speed: fast spreading hands raise the pitch, still hands
   * settle to the bottom of the range.
   * @param {number} speed factor change per second (absolute)
   */
  function updateZoom(speed) {
    if (!context || !zoomOscillator || !zoomActive) return;
    const amount = clamp(Math.abs(speed) / ZOOM_SPEED_REFERENCE, 0, 1);
    const hz = ZOOM_MIN_HZ + (ZOOM_MAX_HZ - ZOOM_MIN_HZ) * amount;
    zoomOscillator.frequency.setTargetAtTime(hz, context.currentTime, 0.06);
  }

  /** Fade the zoom tone out and tear it down. */
  function stopZoom() {
    if (!context || !zoomActive) return;
    zoomActive = false;

    const oscillator = zoomOscillator;
    const gain = zoomGain;
    zoomOscillator = null;
    zoomGain = null;
    if (!oscillator || !gain) return;

    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.stop(now + 0.16);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    });
  }

  /** Two rising notes: "back to the start". */
  function playReset() {
    blip({ from: 523.25, to: 523.25, duration: 0.1, level: 0.18, type: 'sine' });
    window.setTimeout(() => {
      blip({ from: 783.99, to: 783.99, duration: 0.16, level: 0.16, type: 'sine' });
    }, 110);
  }

  function setMuted(next) {
    muted = Boolean(next);
    if (master && context) {
      master.gain.setTargetAtTime(masterLevel(), context.currentTime, 0.03);
    }
    if (muted) stopZoom();
  }

  function setVolume(next) {
    volume = clamp(Number.isFinite(next) ? next : volume, 0, 1);
    if (master && context) {
      master.gain.setTargetAtTime(masterLevel(), context.currentTime, 0.03);
    }
  }

  function dispose() {
    disposed = true;
    stopZoom();
    for (const oscillator of humOscillators) {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch {
        // Already stopped - nothing to do.
      }
    }
    humOscillators = [];
    if (context) {
      context.close().catch(() => {});
      context = null;
    }
    master = null;
  }

  return {
    unlock,
    isUnlocked: () => Boolean(context),
    setMuted,
    setVolume,
    playGrab,
    playRelease,
    startZoom,
    updateZoom,
    stopZoom,
    playReset,
    dispose,
  };
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
