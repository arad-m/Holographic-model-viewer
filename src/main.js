// src/main.js
// Owns: the application entry point and the only module that knows every
// subsystem. It builds the stage, mounts the camera preview + hand HUD, starts
// the camera and the hand tracker, runs one detection per rendered frame, turns
// landmarks into a GestureState, applies `state.transform` every frame, drives
// the hologram uniforms, and starts the single rAF loop owned by loop.js.
//
// Phase 4 note: four gestures drive the transform - pinch-drag rotates, fist-drag
// pans, two-hand pinch zooms and a held open palm resets the view. Exactly one is
// active at a time (the engine decides), and applyGesture() is the only place a
// gesture delta reaches state.transform. Idle auto-rotation yields to any gesture
// and eases back in about a second after release.
//
// Nothing else starts a requestAnimationFrame loop, renders, or touches #app.

import './styles.css';
import {
  STATE_CHANGED,
  patchSettings,
  patchTool,
  resetSettings,
  resetTool,
  resetTransform,
  setGesture,
  setModel,
  setStatus,
  setToolMode,
  setTransform,
  state,
} from './state.js';
import { TOOL_MODES, shortcutIntent, verticalDragTarget } from './tools/modeState.js';
import { createToolController } from './tools/toolController.js';
import { createModeBar } from './ui/modeBar.js';
import { events } from './events.js';
import { addUpdate, startLoop, stopLoop } from './loop.js';
import { applyTransform, createScene } from './render/scene.js';
import { IDENTITY, angleOf, readQuat, slerp, tumbleTransform } from './render/orientation.js';
import { ModelLoadError, disposeObject, getHologramMaterials, loadModel } from './render/modelLoader.js';
import { updateHologramUniforms } from './render/hologramMaterial.js';
import { attachMouseControls } from './input/mouseControls.js';
import { WebcamError, attachWebcam } from './input/webcam.js';
import { HandTrackerError, createHandTracker } from './input/handTracker.js';
import { demoHandMode, demoHands } from './input/demoHand.js';
import {
  MAX_PAN,
  MAX_SCALE,
  MIN_SCALE,
  createEmptyGestureState,
  createGestureEngine,
  describeActionStatus,
  describeHandStatus,
} from './input/gestures.js';
import { attachFileDrop, createToolbar } from './ui/toolbar.js';
import { createFeedback, createHandHud } from './ui/feedback.js';
import { createGestureFeedback } from './ui/gestureFeedback.js';
import { createSound } from './audio/sound.js';
import { createPresetBar } from './ui/presetBar.js';
import { createSettingsPanel } from './ui/settingsPanel.js';
import {
  HOLOGRAM_PRESETS,
  PRESET_DEFAULT,
  PRESET_IDS,
  applyHologramStyle,
  createHologramStyle,
} from './render/presets.js';
import { loadStoredSettings, saveSettings } from './storage/settings.js';
import { attachSettingsPersistence } from './settings/persistSettings.js';
import {
  deleteModel,
  getModelBlob,
  isIndexedDbAvailable,
  lastStorageError,
  listModels,
  putModel,
  storageErrorMessage,
} from './storage/db.js';
import {
  duplicateIds,
  fileSignature,
  sanitizeRecords,
  sortRecordsNewestFirst,
  toFile,
} from './library/records.js';
import { captureThumbnail } from './library/thumbnail.js';
import { createLibrary } from './ui/library.js';
import { describeCaptureError, formatDuration, screenshotFilename } from './capture/frames.js';
import { captureScreenshot, downloadBlob } from './capture/screenshot.js';
import { createRecorder, recordingSupport } from './capture/recorder.js';
import { FaceTrackerError, createFaceTracker, drawFaceAnchor } from './input/faceTracker.js';
import { PARALLAX_LIMIT, createParallax } from './render/parallax.js';
import {
  createAutoQuality,
  effectivePixelRatio,
  effectScale,
  faceDue,
  findQuality,
  handsDue,
} from './perf/quality.js';
import { createPerfHud } from './ui/perfHud.js';

/** Idle spin, radians per second. Paused while the user drags. */
const AUTO_ROTATE_SPEED = 0.22;
/** How often the debug panel is allowed to touch the DOM, in seconds. */
const DEBUG_INTERVAL_SECONDS = 0.1;
/** Weight of the previous frame time in the FPS average. */
const FPS_SMOOTHING = 0.9;
/** Auto-rotation stays off this long after the gesture releases. */
const AUTO_ROTATE_RESUME_DELAY_MS = 1000;
/** Then it fades back in over this long, so it never snaps on. */
const AUTO_ROTATE_RAMP_SECONDS = 0.8;
/** Exponential rate for the palm-reset snap-back, in 1/s. */
const RESET_EASE_RATE = 9;

const appRoot = document.querySelector('#app');
if (!appRoot) throw new Error('main.js: #app container not found');

// Restore persisted settings FIRST, so every subsystem below is built with the
// user's stored values. The sanitiser drops anything corrupt (bad JSON, wrong
// types, out-of-range numbers, unknown preset ids) and the default survives.
const storedSettings = loadStoredSettings({
  presetIds: PRESET_IDS,
  fallbackPreset: PRESET_DEFAULT,
});
if (Object.keys(storedSettings.values).length > 0) {
  patchSettings(storedSettings.values);
}

const stage = document.createElement('div');
stage.className = 'stage';
appRoot.prepend(stage);

const scene = createScene(stage);

// The eased hologram style. Presets only move shader targets, so switching is safe
// while a model is loaded and while a gesture is mid-drag.
const hologramStyle = createHologramStyle(state.settings.hologramPreset);

// Gesture feedback: 2D overlay + in-scene skeleton + synthesized audio. The
// AudioContext itself is only created on the first click/keypress (see
// ui/gestureFeedback.js), so nothing plays before the user interacts.
const sound = createSound({
  volume: state.settings.soundVolume,
  muted: !state.settings.soundEnabled,
});
const gestureFeedback = createGestureFeedback({
  stage,
  scene: scene.scene,
  sound,
  skeletonVisible: state.settings.showHandSkeleton,
});

const feedback = createFeedback(appRoot);

// Sensor stack (hand status + debug + camera preview), bottom-right corner.
const sensorPanel = document.createElement('aside');
sensorPanel.className = 'sensor';
appRoot.appendChild(sensorPanel);

const handHud = createHandHud(sensorPanel);
const webcam = attachWebcam(sensorPanel, { onEnded: () => handleCameraLost() });

// Saved-model library + capture controls. Both are presentational: main.js owns
// the records, the storage calls and the files that get downloaded.
const libraryPanel = createLibrary(appRoot, {
  onSelect: handleLibrarySelect,
  onDelete: handleLibraryDelete,
  onRetry: refreshLibrary,
  onClose: closeLibrary,
});

const toolbar = createToolbar(appRoot, {
  onFiles: handleFiles,
  onReset: handleReset,
  onToggleDebug: handleToggleDebug,
  onToggleSkeleton: handleToggleSkeleton,
  onToggleSound: handleToggleSound,
  onVolume: handleVolume,
  onToggleSettings: handleToggleSettings,
  onToggleLibrary: handleToggleLibrary,
  onScreenshot: handleScreenshot,
  onToggleRecord: handleToggleRecord,
});
const fileDrop = attachFileDrop(appRoot, { onFiles: handleFiles });

// Preset bar + settings drawer. Both are presentational: they report intent, and
// main.js applies it, persists it and keeps every control in sync.
const presetBar = createPresetBar(appRoot, {
  presets: HOLOGRAM_PRESETS,
  onSelect: handlePresetSelect,
});
const settingsPanel = createSettingsPanel(appRoot, {
  getSettings: () => state.settings,
  onChange: handleSettingChange,
  onReset: handleResetSettings,
});

// Mode bar + tool controller. The controller owns the slice plane, the baked
// cross-section, the explode parts and the inspector; main only routes its
// callbacks through the state mutators.
const modeBar = createModeBar(appRoot, {
  modes: TOOL_MODES,
  onSelectMode: handleSelectMode,
  onSelectAxis: handleSelectAxis,
  onSlicePosition: handleSlicePosition,
  onExplode: handleExplodeAmount,
});

const tools = createToolController({
  stage,
  camera: scene.camera,
  setSlicePosition: handleSlicePosition,
  setExplodeAmount: handleExplodeAmount,
  setLabel: handleInspectLabel,
});

const mouse = attachMouseControls(scene.renderer.domElement, {
  onVerticalDrag: (deltaPixels) => tools.handleVerticalDrag(deltaPixels, state.tool),
  onHover: (point) => tools.setPointer(point),
  onLeave: () => tools.setPointer(null),
});

// Recording. The stream comes from the WebGL canvas, and the webcam composite (if
// asked for) is drawn from the single loop below - never a second rAF.
const recorder = createRecorder({
  canvas: scene.renderer.domElement,
  getWebcamVideo: () => webcam.video,
  onTick: (elapsedMs) => toolbar.setRecordingElapsed(`REC ${formatDuration(elapsedMs)}`),
  onFinish: handleRecordingFinished,
  onError: (_reason, message) => {
    toolbar.setCapturing(false);
    feedback.toast(message, 'error');
  },
});

// Parallax: the camera nudged by where your head is. The tracker is created
// lazily - only when the feature is switched on - so the 3.7 MB face model is
// never downloaded by someone who does not use it.
const parallax = createParallax();
const perfHud = createPerfHud(appRoot, { onRecalibrate: handleRecalibrate });

/** Quality the renderer is currently running at (the watchdog can lower it). */
let qualityId = state.settings.quality;
/** Last device pixel ratio we handed the renderer, so a monitor move is noticed. */
let lastDevicePixelRatio = window.devicePixelRatio || 1;
/**
 * Hands from the most recent MediaPipe sample. Frames that skip detection reuse
 * this instead of pretending the hands vanished: the landmarks have not moved,
 * so the drag delta stays zero, while a pinch, fist or palm stays latched.
 * @type {Array<{ handedness: string, landmarks: Array<{x:number,y:number,z:number}> }>|null}
 */
let lastDetectedHands = null;
/** Frame-rate watchdog: steps down when the machine cannot hold 30 fps. */
const autoQuality = createAutoQuality({
  thresholdFps: 30,
  seconds: 5,
  startLevel: qualityId,
  onDowngrade: handleQualityDowngrade,
});

/** @type {Awaited<ReturnType<typeof createFaceTracker>>|null} */
let faceTracker = null;
/** 'off' | 'starting' | 'live' | 'error' */
let faceState = 'off';
let lastHandDetectionMs = Number.NaN;
let lastFaceDetectionMs = Number.NaN;
/** True once, after the hand tracker wiped the landmark canvas this frame. */
let handsClearedCanvas = false;
/** Set when the first live face of this parallax session has been announced. */
let faceAnnounced = false;
/**
 * What the debug panel says about the face. Updated from the parallax step and
 * copied into the hand HUD, so the two readouts cannot disagree.
 */
const faceReadout = {
  state: 'off',
  label: 'Parallax off',
  detail: '',
  /** @type {{ x: number, y: number }|null} */
  head: null,
  delegate: '—',
};
let lastPerfSampleMs = 0;
let lastHudMs = 0;
let lastParallaxHudMs = 0;

const gestureEngine = createGestureEngine();

/** @type {Awaited<ReturnType<typeof createHandTracker>>|null} */
let handTracker = null;
/** @type {'off'|'starting'|'live'|'error'} */
let cameraState = 'off';
let debugAccumulator = 0;
/** Set when a model swap must ignore the gesture already computed this frame. */
let blockGesture = false;
/** True after a frame that actually tracked hands, so losing the camera resets once. */
  let handsWereLive = false;
  /** This frame already paid for a full-frame hand search. Skip the face net. */
  let handUsedFullFrame = false;
let smoothedFrameTime = 0;
let lastInferenceMs = 0;
let delegateLabel = '—';
/** 0 = auto-rotation off (grabbing), 1 = fully on. Eased, never toggled hard. */
let autoRotateBlend = 1;
let lastGrabMs = 0;
/** Which action ran last frame, so anchors are captured on transitions only. */
let lastAction = 'none';
/** Scale when the two-hand zoom started; zoomFactor multiplies this. */
let zoomStartScale = 1;
/** Smooth snap-back after an open-palm hold. */
const resetTween = { active: false };

feedback.showHint();
setStatus('idle', '');
handHud.setStatus('camera-off');
handHud.setDebugVisible(state.settings.showDebugOverlay);
toolbar.setDebugActive(state.settings.showDebugOverlay);
toolbar.setSkeletonActive(state.settings.showHandSkeleton);
toolbar.setSoundActive(state.settings.soundEnabled);
toolbar.setVolume(state.settings.soundVolume);
presetBar.setActive(state.settings.hologramPreset);
settingsPanel.sync();
applyLiveSettings();
updateCaptureAvailability();
refreshLibrary();

startCamera();

/* ------------------------------------------------------------ camera --- */

async function startCamera() {
  if (cameraState === 'starting' || cameraState === 'live') return;
  cameraState = 'starting';
  handHud.setStatus('starting');

  try {
    await webcam.start();
  } catch (error) {
    cameraState = 'error';
    const isWebcamError = error instanceof WebcamError;
    const message = isWebcamError ? error.message : 'Could not start the camera.';
    webcam.showNotice(isWebcamError ? error.code : 'unknown', message);
    handHud.setStatus('camera-off');
    // The preview card already carries the full message, so the status pill stays
    // short and no toast repeats it.
    setStatus('camera-error', 'Camera unavailable — mouse controls still work.');
    if (!isWebcamError) console.warn('Unexpected camera failure', error);
    setGesture(createEmptyGestureState());
    return;
  }

  try {
    handTracker = await createHandTracker({
      canvas: webcam.canvas,
      onDelegate: (delegate) => {
        delegateLabel = delegate;
      },
    });
    cameraState = 'live';
    handHud.setStatus('no-hand');
    // Parallax may have been enabled before the camera was live (a restored
    // setting, or a quick click): now there is a stream to read.
    if (parallax.isEnabled() && !faceTracker) void ensureFaceTracker();
    setStatus('camera-ready', 'Camera ready — show a hand');
  } catch (error) {
    cameraState = 'error';
    const isTrackerError = error instanceof HandTrackerError;
    const message = isTrackerError ? error.message : 'Could not start hand tracking.';
    webcam.showNotice('tracking', message);
    handHud.setStatus('camera-error');
    setStatus('camera-error', message);
    feedback.toast(`${message} Mouse controls still work.`, 'error');
    if (!isTrackerError) console.warn('Unexpected hand tracker failure', error);
    setGesture(createEmptyGestureState());
  }
}

/**
 * The camera track stopped after a successful start (unplugged, or the OS
 * revoked it). The frozen last frame would otherwise keep looking "ready".
 */
function handleCameraLost() {
  if (cameraState === 'error') return;
  cameraState = 'error';
  releaseLiveGesture();
  lastDetectedHands = null;
  handHud.setStatus('camera-error');
  webcam.showNotice(
    'missing',
    'The camera disconnected. Plug it back in and reload — mouse controls still work.',
  );
  setStatus('camera-error', 'Camera lost — mouse controls still work.');
}

/** Drop pinch anchors, inertia and an in-progress reset so a new model starts clean. */
function releaseLiveGesture() {
  gestureEngine.reset();
  lastAction = 'none';
  zoomStartScale = 1;
  resetTween.active = false;
  blockGesture = true;
  handsWereLive = false;
}

/* -------------------------------------------------------------- model --- */

/**
 * Load one model file. The same path serves a drop, the picker, the library and
 * the ?model= dev hook, so a library load cannot behave differently from an
 * upload.
 *
 * @param {File[]|FileList} files
 * @param {{ save?: boolean }} [options] save:false for a file that is already in
 *   the library (re-saving would only create a duplicate)
 */
async function handleFiles(files, { save = true } = {}) {
  const file = pickModelFile(files);
  if (!file) return;

  if (handLoading()) {
    feedback.toast('Still loading the previous model.', 'info');
    return;
  }

  setLoading(true);
  setStatus('model-loading', `Loading ${file.name}…`);

  try {
    const result = await loadModel(file);
    const previousModel = state.model.object;

    scene.addObject(result.object);
    setModel(result.object, result.baseScale);
    resetTransform();
    // A pinch that was in progress must not keep zooming the model that just arrived.
    releaseLiveGesture();
    // A new model must never inherit a slice offset, an explosion or a label.
    resetToolsForModel();

    if (previousModel) {
      scene.removeObject(previousModel);
      disposeObject(previousModel);
    }

    feedback.hideHint();
    setStatus(
      'model-ready',
      `${file.name} · ${result.meshCount} mesh${result.meshCount === 1 ? '' : 'es'}`,
    );

    // The thumbnail needs a frame that already shows the model, so it is queued
    // here and captured after the next render (see the loop).
    pendingSaveFile = save ? file : null;
  } catch (error) {
    const message = error instanceof ModelLoadError ? error.message : 'Could not load that file.';
    setStatus('model-error', message);
    feedback.toast(message, 'error');
    if (!(error instanceof ModelLoadError)) console.warn('Unexpected model load failure', error);
    if (!state.model.object) feedback.showHint();
  } finally {
    setLoading(false);
    updateCaptureAvailability();
  }
}

let isLoadingModel = false;

function handLoading() {
  return isLoadingModel;
}

function setLoading(busy) {
  isLoadingModel = Boolean(busy);
  toolbar.setBusy(isLoadingModel);
}

function handleReset() {
  resetTransform();
}

function handleToggleDebug() {
  const next = !state.settings.showDebugOverlay;
  patchSettings({ showDebugOverlay: next });
  handHud.setDebugVisible(next);
  toolbar.setDebugActive(next);
}

function handleToggleSkeleton() {
  const next = !state.settings.showHandSkeleton;
  patchSettings({ showHandSkeleton: next });
  gestureFeedback.setSkeletonVisible(next);
  toolbar.setSkeletonActive(next);
}

function handleToggleSound() {
  const next = !state.settings.soundEnabled;
  patchSettings({ soundEnabled: next });
  gestureFeedback.setMuted(!next);
  toolbar.setSoundActive(next);
}

/** @param {number} value 0..1 from the slider */
function handleVolume(value) {
  const next = Math.min(Math.max(Number(value) || 0, 0), 1);
  patchSettings({ soundVolume: next });
  gestureFeedback.setVolume(next);
  toolbar.setVolume(next);
}

/* ----------------------------------------------------------- settings --- */

/**
 * Apply everything a settings change can affect, from ONE place, so the toolbar,
 * the drawer, the skeleton, the camera preview and the hologram can never drift
 * apart - whichever control (or shortcut) made the change.
 */
function applyLiveSettings() {
  gestureFeedback.setSkeletonVisible(state.settings.showHandSkeleton);
  gestureFeedback.setVolume(state.settings.soundVolume);
  gestureFeedback.setMuted(!state.settings.soundEnabled);
  handHud.setDebugVisible(state.settings.showDebugOverlay);
  webcam.element.hidden = !state.settings.showWebcam;

  toolbar.setSkeletonActive(state.settings.showHandSkeleton);
  toolbar.setSoundActive(state.settings.soundEnabled);
  toolbar.setVolume(state.settings.soundVolume);
  toolbar.setDebugActive(state.settings.showDebugOverlay);

  // The preset lives in settings too, so a restored preset is re-applied here.
  if (state.settings.hologramPreset !== hologramStyle.getPresetId()) {
    hologramStyle.setPreset(state.settings.hologramPreset);
  }
  presetBar.setActive(hologramStyle.getPresetId());

  // Phase 9: performance and parallax both live in settings, so one place
  // applies them however they were changed (drawer, reset, auto-downgrade).
  applyQuality(state.settings.quality);
  perfHud.setVisible({ fps: state.settings.showFps, parallax: state.settings.parallax });
  applyParallaxSetting();

  settingsPanel.sync();
}

/* -------------------------------------------------------- performance --- */

/**
 * Apply one quality level: pixel ratio, and (indirectly, through the loop) the
 * hand and face detection rates plus the shader effect scale.
 * @param {string} id
 */
function applyQuality(id) {
  const level = findQuality(id);
  qualityId = level.id;
  scene.setPixelRatio(effectivePixelRatio(level.id, window.devicePixelRatio || 1));
  if (autoQuality.current() !== level.id) autoQuality.setLevel(level.id);
  perfHud.setStats(currentFps(), level.label);
}

/** The watchdog decided this machine cannot hold 30 fps. */
function handleQualityDowngrade(from, to) {
  patchSettings({ quality: to });
  // The drawer, the pixel ratio and the HUD all read settings, so one pass keeps
  // them on the level the watchdog just chose.
  applyLiveSettings();
  feedback.toast(
    `Dropped to ${findQuality(to).label} quality — the frame rate was below ${autoQuality.thresholdFps()} fps.`,
    'info',
  );
  console.info(`[perf] quality ${from} -> ${to}`);
}

/**
 * Feed the watchdog and refresh the HUD. Cheap and throttled: the HUD updates at
 * 4 Hz, the watchdog samples the frame rate twice a second.
 * @param {number} nowMs
 */
function updatePerformance(nowMs) {
  // A background tab fires slow frames. Sampling them would step quality down
  // for a stall the user cannot see.
  if (document.hidden) {
    autoQuality.reset();
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  if (Math.abs(dpr - lastDevicePixelRatio) > 0.01) {
    lastDevicePixelRatio = dpr;
    scene.setPixelRatio(effectivePixelRatio(qualityId, dpr));
  }

  if (nowMs - lastPerfSampleMs >= 500) {
    lastPerfSampleMs = nowMs;
    const fps = currentFps();
    if (state.settings.autoQuality) autoQuality.sample(fps, nowMs);
    if (nowMs - lastHudMs >= 250) {
      lastHudMs = nowMs;
      if (state.settings.showFps) perfHud.setStats(fps, findQuality(qualityId).label);
    }
  }
}

/* ----------------------------------------------------------- parallax --- */

/** Turn parallax on or off to match the setting, and re-calibrate on enable. */
function applyParallaxSetting() {
  const wanted = Boolean(state.settings.parallax);
  // Depth is a live slider, so it is applied on every pass - not only on enable.
  parallax.setLimit(PARALLAX_LIMIT * state.settings.parallaxStrength);

  if (wanted === parallax.isEnabled()) {
    if (!wanted) scene.setCameraOffset({ x: 0, y: 0 });
    return;
  }

  parallax.setEnabled(wanted);
  if (wanted) {
    faceAnnounced = false;
    feedback.toast('Head parallax on — hold still for a moment to calibrate.', 'info');
    publishFaceReadout(performance.now());
    perfHud.setParallaxStatus('starting');
    void ensureFaceTracker();
  } else {
    scene.setCameraOffset({ x: 0, y: 0 });
    publishFaceReadout(performance.now());
    perfHud.setParallaxStatus('off');
    drawFaceAnchor(webcam.canvas, webcam.video, null, { canvasCleared: false });
  }
}

/** Create the face tracker the first time parallax is enabled. */
async function ensureFaceTracker() {
  if (faceTracker || faceState === 'starting') return;
  if (!webcam.isReady()) {
    // The camera is the shared one. updateParallax retries once the stream is live.
    return;
  }

  faceState = 'starting';
  perfHud.setParallaxStatus('starting');
  try {
    faceTracker = await createFaceTracker({});
    faceState = 'live';
    lastFaceDetectionMs = Number.NaN;
  } catch (error) {
    faceState = 'error';
    const message =
      error instanceof FaceTrackerError ? error.message : 'Could not start head tracking.';
    patchSettings({ parallax: false });
    parallax.setEnabled(false);
    applyLiveSettings();
    feedback.toast(`${message} Parallax is off.`, 'error');
    if (!(error instanceof FaceTrackerError)) console.warn('Unexpected face tracker failure', error);
  }
}

/** Re-read the current head position as neutral. */
function handleRecalibrate() {
  if (!parallax.isEnabled()) return;
  if (!faceTracker) {
    void ensureFaceTracker();
    return;
  }
  const calibrated = parallax.recalibrate();
  feedback.toast(
    calibrated ? 'Parallax centred on where you are.' : 'Look at the camera, then recalibrate.',
    'info',
  );
}

/**
 * One face sample (when the current quality level allows) plus the eased camera
 * offset. The offset only ever moves the camera - never state.transform - so it
 * cannot affect gesture accuracy.
 * @param {number} dt seconds
 * @param {number} nowMs
 */
function updateParallax(dt, nowMs) {
  if (!parallax.isEnabled()) return;

  // The camera can be enabled before the stream exists (a restored setting, or
  // a click during startup). Keep asking until the tracker actually exists.
  if (!faceTracker && faceState === 'off' && webcam.isReady()) {
    void ensureFaceTracker();
  }

  // Face detection is throttled below the frame rate. Frames that skip it hold
  // the last pose, so the timeout — which is shorter than the Low interval —
  // does not ease the camera home and back on every sample. A null result is a
  // miss; the second one in a row releases the pose.
  const tracking = Boolean(faceTracker) && webcam.isReady();
  // A full-frame hand search already ran this frame. Stacking the face model
  // on top of it is a guaranteed dropped frame, and one held sample is invisible.
  if (tracking && faceDue(qualityId, nowMs, lastFaceDetectionMs) && !handUsedFullFrame) {
    lastFaceDetectionMs = nowMs;
    const detected = faceTracker.detect(webcam.video, nowMs);
    if (detected.delegate) faceReadout.delegate = detected.delegate;
    if (detected.head) parallax.pushSample(detected.head, nowMs);
    else parallax.pushMiss(nowMs);
  } else if (tracking) {
    parallax.hold(nowMs);
  }

  const offset = parallax.update(dt, nowMs);
  scene.setCameraOffset(offset);
  publishFaceReadout(nowMs);

  // The hand tracker clears the preview canvas when it runs. Paint the face
  // crosshair after that, so a recognized face is visible on the camera.
  if (webcam.canvas) {
    drawFaceAnchor(webcam.canvas, webcam.video, faceReadout.head, {
      canvasCleared: handsClearedCanvas,
    });
  }

  if (faceReadout.state === 'recognized' && !faceAnnounced) {
    faceAnnounced = true;
    feedback.toast('Face recognized — lean to look around the model.', 'ok');
  }

  // HUD at 4 Hz. The label itself says whether a face is in frame.
  if (nowMs - lastParallaxHudMs >= 250) {
    lastParallaxHudMs = nowMs;
    const moving = Math.hypot(offset.x, offset.y) > 0.03;
    if (faceReadout.state === 'recognized') {
      perfHud.setParallaxStatus(
        'tracking',
        moving ? 'Face recognized' : 'Face recognized — lean to look around',
      );
    } else if (faceReadout.state === 'starting') {
      perfHud.setParallaxStatus('starting');
    } else {
      perfHud.setParallaxStatus('no-face');
    }
  }
}

/** Fill `faceReadout` from the parallax controller. The debug panel copies it. */
function publishFaceReadout(nowMs) {
  if (!parallax.isEnabled()) {
    faceReadout.state = 'off';
    faceReadout.label = 'Parallax off';
    faceReadout.detail = '';
    faceReadout.head = null;
    return;
  }
  if (cameraState === 'error') {
    faceReadout.state = 'missing';
    faceReadout.label = 'No face';
    faceReadout.detail = 'camera off';
    faceReadout.head = null;
    return;
  }
  if (faceState === 'error') {
    faceReadout.state = 'error';
    faceReadout.label = 'Face tracking failed';
    faceReadout.detail = '';
    faceReadout.head = null;
    return;
  }
  if (faceState === 'starting' || faceState === 'off' || !faceTracker) {
    faceReadout.state = 'starting';
    faceReadout.label = 'Looking for a face';
    faceReadout.detail = '';
    faceReadout.head = null;
    return;
  }

  const snap = parallax.snapshot();
  if (parallax.hasFace(nowMs) && snap.sample) {
    faceReadout.state = 'recognized';
    faceReadout.label = 'Face recognized';
    faceReadout.head = snap.sample;
    faceReadout.detail = `x ${snap.sample.x.toFixed(2)}  y ${snap.sample.y.toFixed(2)}  lean ${snap.x.toFixed(2)}, ${snap.y.toFixed(2)}  ${faceReadout.delegate}`;
    return;
  }

  faceReadout.state = 'missing';
  faceReadout.label = 'No face';
  faceReadout.detail = faceReadout.delegate === '—' ? '' : faceReadout.delegate;
  faceReadout.head = null;
}

/** The face line the debug panel renders. A copy, so the panel cannot mutate it. */
function faceDebugPayload() {
  return {
    state: faceReadout.state,
    label: faceReadout.label,
    detail: faceReadout.detail,
  };
}

/** @param {string} id */
function handlePresetSelect(id) {
  const applied = hologramStyle.setPreset(id);
  patchSettings({ hologramPreset: applied });
  presetBar.setActive(applied);
}

/** @param {string} key @param {number|boolean} value */
function handleSettingChange(key, value) {
  patchSettings({ [key]: value });
  applyLiveSettings();
}

function handleResetSettings() {
  resetSettings();
  hologramStyle.setPreset(state.settings.hologramPreset);
  applyLiveSettings();
  saveSettings(state.settings, hologramStyle.getPresetId());
  feedback.toast('Settings reset to defaults.', 'info');
}

function handleToggleSettings() {
  settingsPanel.toggle();
  toolbar.setSettingsActive(settingsPanel.isOpen());
}

/* ------------------------------------------------------ library + capture --- */

/** Metadata rows currently shown in the panel. */
let libraryRecords = [];
/** Set when a model loaded and its thumbnail still has to be captured. */
let pendingSaveFile = null;

/** Show or hide the panel; refresh the list whenever it opens. */
function handleToggleLibrary() {
  const open = libraryPanel.toggle();
  toolbar.setLibraryActive(open);
  if (open) refreshLibrary();
}

function closeLibrary() {
  libraryPanel.setOpen(false);
  toolbar.setLibraryActive(false);
}

/**
 * Read the library and re-render the panel. Separates "nothing saved" from
 * "storage is broken" by asking the storage layer what happened on open.
 */
async function refreshLibrary() {
  if (!isIndexedDbAvailable()) {
    libraryPanel.refresh([], {
      status: 'unsupported',
      message: 'This browser does not expose local storage for this page.',
    });
    return;
  }

  const rows = await listModels();
  libraryRecords = sortRecordsNewestFirst(sanitizeRecords(rows));
  const failed = libraryRecords.length === 0 && Boolean(lastStorageError());
  libraryPanel.refresh(libraryRecords, failed ? { status: 'error' } : {});
}

/** Load a saved model through the normal loader. */
async function handleLibrarySelect(id) {
  if (!id) return;
  if (handLoading()) {
    feedback.toast('Still loading a model.', 'info');
    return;
  }

  const record = libraryRecords.find((item) => item.id === id) ?? null;
  libraryPanel.setBusy(id);

  const stored = await getModelBlob(id);
  if (!stored.ok) {
    libraryPanel.setBusy(null);
    feedback.toast(storageErrorMessage(stored.code), 'error');
    return;
  }

  const file = toFile(record ?? { name: 'model' }, stored.blob);
  // save:false - it is already in the library.
  await handleFiles([file], { save: false });
  libraryPanel.setBusy(null);

  // On a phone the panel would cover the model it just loaded.
  if (window.innerWidth <= 720) closeLibrary();
}

/** Delete one saved model. */
async function handleLibraryDelete(id) {
  if (!id) return;
  const record = libraryRecords.find((item) => item.id === id) ?? null;
  const deleted = await deleteModel(id);
  if (!deleted) {
    feedback.toast('Could not delete that model.', 'error');
    return;
  }
  feedback.toast(`Deleted ${record?.name ?? 'model'}.`, 'info');
  await refreshLibrary();
}

/** Capture the queued model's thumbnail and store it. Runs after a render. */
function flushPendingSave() {
  if (!pendingSaveFile) return;
  const file = pendingSaveFile;
  pendingSaveFile = null;
  void saveModelToLibrary(file);
}

/**
 * Store an uploaded model with a thumbnail of how it looks now. Keeps one entry
 * per file by dropping older duplicates of the same name and size.
 *
 * @param {File} file
 */
async function saveModelToLibrary(file) {
  if (!isIndexedDbAvailable()) return;

  const thumbnail = captureThumbnail(scene.renderer.domElement);
  const saved = await putModel({
    name: file.name,
    size: file.size,
    type: file.type,
    blob: file,
    thumbnail,
  });

  if (!saved.ok) {
    feedback.toast(storageErrorMessage(saved.code), 'error');
    return;
  }

  const rows = sortRecordsNewestFirst(sanitizeRecords(await listModels()));
  const stale = duplicateIds(rows, fileSignature(file), saved.record.id);
  for (const id of stale) await deleteModel(id);

  libraryRecords = sortRecordsNewestFirst(sanitizeRecords(await listModels()));
  libraryPanel.refresh(libraryRecords);
  // A save that happens silently looks like a save that did not happen.
  feedback.toast(`Saved ${saved.record.name} to the library.`, 'info');
}

/** Keep the three capture buttons honest about what is possible right now. */
function updateCaptureAvailability() {
  const hasModel = Boolean(state.model.object);
  const support = recordingSupport(scene.renderer.domElement);
  toolbar.setCaptureAvailability({
    screenshot: hasModel,
    record: hasModel && support.ok,
    library: isIndexedDbAvailable(),
    // Two different reasons a record is impossible; say the one that applies.
    recordHint: !hasModel ? 'Load a model first' : support.message,
  });
}

/** Save one PNG of the view. */
async function handleScreenshot() {
  if (!state.model.object) {
    feedback.toast('Load a model first.', 'info');
    return;
  }

  toolbar.setScreenshotBusy(true);
  const transparent = Boolean(state.settings.transparentScreenshots);
  const wantedSkeleton = state.settings.showHandSkeleton;

  try {
    const shot = await captureScreenshot({
      renderer: scene.renderer,
      scene: scene.scene,
      camera: scene.camera,
      transparent,
      // Hands are feedback, not part of the model: keep them out of the file.
      prepare: () => gestureFeedback.setSkeletonVisible(false),
      cleanup: () => gestureFeedback.setSkeletonVisible(wantedSkeleton),
    });

    if (!shot) {
      feedback.toast(describeCaptureError('no-canvas'), 'error');
      return;
    }

    downloadBlob(shot.blob, screenshotFilename(new Date()));
    feedback.toast(
      `Saved PNG · ${shot.width}×${shot.height}${transparent ? ' · transparent' : ''}`,
      'info',
    );
  } catch (error) {
    console.warn('Screenshot failed', error);
    feedback.toast('Could not save the screenshot.', 'error');
  } finally {
    toolbar.setScreenshotBusy(false);
  }
}

/** Start or stop a recording. */
function handleToggleRecord() {
  if (recorder.isRecording()) {
    recorder.stop();
    return;
  }

  if (!state.model.object) {
    feedback.toast('Load a model first.', 'info');
    return;
  }

  const started = recorder.start({ includeWebcam: Boolean(state.settings.recordWithWebcam) });
  if (!started.ok) {
    feedback.toast(started.message, 'error');
    return;
  }

  toolbar.setCapturing(true);
  toolbar.setRecordingElapsed('REC 0:00');
  feedback.toast(
    state.settings.recordWithWebcam ? 'Recording with the camera…' : 'Recording…',
    'info',
  );
}

/** The recorder hands over a finished file. */
function handleRecordingFinished({ blob, filename, durationMs }) {
  toolbar.setCapturing(false);
  downloadBlob(blob, filename);
  feedback.toast(`Saved ${formatDuration(durationMs)} of video.`, 'info');
}

/* --------------------------------------------------------------- tools --- */

/** Modes change ONLY here (mode bar) or in handleKeydown. Never from a gesture. */
function handleSelectMode(id) {
  if (id === state.tool.mode) return;

  // Leaving a mode clears the value it owned, so re-entering it starts clean and
  // the explode parts ease home instead of snapping back out.
  if (state.tool.mode === 'slice') patchTool({ slicePosition: 0 });
  if (state.tool.mode === 'explode') patchTool({ explode: 0 });

  setToolMode(id);
  applyToolState();
}

/** @param {string} axis */
function handleSelectAxis(axis) {
  patchTool({ sliceAxis: axis });
  applyToolState();
}

/** @param {number} value -1..1 (slider, mouse drag or gesture) */
function handleSlicePosition(value) {
  patchTool({ slicePosition: value });
  modeBar.setSlicePosition(state.tool.slicePosition);
  tools.applyState(state.tool);
}

/** @param {number} value 0..1 (slider, mouse drag or gesture) */
function handleExplodeAmount(value) {
  patchTool({ explode: value });
  modeBar.setExplode(state.tool.explode);
}

/** @param {string} label the part under the pointer, '' when nothing is hit */
function handleInspectLabel(label) {
  modeBar.setInspectLabel(label);
  patchTool({ inspectLabel: label });
}

/** Push the whole tool state into the bar and the scene, from one place. */
function applyToolState() {
  modeBar.setMode(state.tool.mode);
  modeBar.setSliceAxis(state.tool.sliceAxis);
  modeBar.setSlicePosition(state.tool.slicePosition);
  modeBar.setExplode(state.tool.explode);
  modeBar.setExplodeAvailability(tools.explodeInfo());
  tools.applyState(state.tool);
}

/** Rebuild every tool cache for the model that just loaded (or cleared). */
function resetToolsForModel() {
  tools.setModel(state.model.object);
  resetTool(state.tool.mode);
  modeBar.setInspectLabel('');
  applyToolState();
}

/**
 * Shortcuts: 1-6 pick a preset, S toggles the drawer, Escape closes it. Ignored
 * while typing in a control so a slider or a dialog never eats a keystroke.
 * @param {KeyboardEvent} event
 */
function handleKeydown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const target = event.target;
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
      return;
    }
  }

  if (event.key === 'Escape') {
    if (settingsPanel.isOpen()) {
      settingsPanel.close();
      toolbar.setSettingsActive(false);
    }
    return;
  }

  if (event.key.toLowerCase() === 's') {
    handleToggleSettings();
    return;
  }

  // 1-4 change mode, Shift+1-6 change preset (codes, not keys, because Shift+1
  // reports '!' as the key on most layouts).
  const intent = shortcutIntent(event);
  if (!intent) return;

  if (intent.kind === 'mode') {
    handleSelectMode(intent.value);
    return;
  }

  const preset = HOLOGRAM_PRESETS.find((item) => item.shortcut === intent.value);
  if (preset) handlePresetSelect(preset.id);
}

window.addEventListener('keydown', handleKeydown);

// Persist on every settings change, from any source (drawer, toolbar, shortcuts,
// reset). Saving is best-effort: a blocked localStorage must never break the app.
const unsubscribeSettings = attachSettingsPersistence();

/**
 * @param {File[]|FileList|undefined} files
 * @returns {File|null}
 */
function pickModelFile(files) {
  const list = Array.from(files ?? []);
  if (list.length === 0) return null;
  if (list.length > 1) feedback.toast('Loading the first file only.', 'info');
  return list[0];
}

/* --------------------------------------------------------------- loop --- */

const removeUpdate = addUpdate((dt, elapsed) => {
  updateFrameStats(dt);
  const nowMs = performance.now();

  // One detection per rendered frame, then gesture math on the smoothed result.
  const gestureState = pollHands(dt);
  const action = applyGesture(gestureState);
  const resetting = updateResetTween(dt);
  const coasting = applyPointerCoast(dt, resetting);
  gestureFeedback.update(gestureState, dt);
  updateHologramStyle(dt);
  // Tools run after the style pass so the Inspect highlight wins the last write.
  tools.update(dt, state.tool, gestureState);
  updateHandStatus(gestureState, resetting);
  updateModel(dt, elapsed, action !== 'none' || resetting || coasting);

  // Parallax moves the camera only, so it runs after the model is placed and
  // before the frame is drawn - the offset belongs to this frame, not the next.
  updateParallax(dt, nowMs);

  scene.render(elapsed);

  updatePerformance(nowMs);

  // After the frame exists: drive the recorder (and its webcam composite), then
  // take a queued library thumbnail from the pixels just drawn.
  recorder.tick(nowMs);
  flushPendingSave();
});

startLoop();

/**
 * The ONE place a gesture delta reaches the transform. Each action owns its own
 * axis of the transform, so rotate / pan / zoom can never fight each other:
 *   rotate -> screen-space tumble,  pan -> panX/panY (clamped),  zoom -> scale.
 * Pitch is not clamped: the orientation is a quaternion, so a drag can roll
 * the model any direction. The gesture engine's release throw is what keeps
 * spinning after the hand lets go, fading out rather than stopping dead.
 *
 * @param {import('./input/gestures.js').GestureState|null} gestureState
 * @returns {'none'|'rotate'|'zoom'|'pan'|'reset'} the action that ran this frame
 */
function applyGesture(gestureState) {
  if (blockGesture) {
    blockGesture = false;
    lastAction = 'none';
    return 'none';
  }

  const action = gestureState?.action ?? 'none';
  const delta = gestureState?.delta;

  if (gestureState?.resetRequested) startResetTween();

  // Anchors are captured on the transition, never mid-gesture.
  if (action !== lastAction) {
    if (action === 'zoom') zoomStartScale = state.transform.scale;
    if (action !== 'none') resetTween.active = false; // grabbing cancels the snap-back
    lastAction = action;
  }

  if (action !== 'none') {
    lastGrabMs = performance.now();
    autoRotateBlend = 0;
  }

  if (!delta) return action;

  // Vertical travel belongs to the active mode when it wants it: Slice and
  // Explode move their own value, Inspect ignores it, Orbit pitches the model.
  // Horizontal rotation happens in every mode, so a pinch-drag always turns it.
  const verticalTarget = verticalDragTarget(state.tool.mode);
  if (delta.dragY !== 0) tools.applyGestureVertical(delta.dragY, state.tool);

  const pitch = verticalTarget === 'pitch' ? delta.rotX : 0;
  const yaw = delta.rotY;
  if (pitch !== 0 || yaw !== 0) {
    // A hand throw and a pointer flick must not both keep spinning.
    mouse.cancelCoast();
    setTransform(tumbleTransform(state.transform, pitch, yaw), { silent: true });
  }

  if (action === 'pan' && (delta.panX !== 0 || delta.panY !== 0)) {
    setTransform(
      {
        panX: Math.max(-MAX_PAN, Math.min(MAX_PAN, state.transform.panX + delta.panX)),
        panY: Math.max(-MAX_PAN, Math.min(MAX_PAN, state.transform.panY + delta.panY)),
      },
      { silent: true },
    );
  }

  if (action === 'zoom' && delta.zoomFactor !== 1) {
    const next = zoomStartScale * delta.zoomFactor;
    setTransform({ scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, next)) }, { silent: true });
  }

  return action;
}

/** Start the smooth snap-back to the default view. */
function startResetTween() {
  resetTween.active = true;
  lastAction = 'reset';
  gestureEngine.cancelInertia();
  mouse.cancelCoast();
}

/**
 * Ease the orientation back to upright, and pan/scale back to the default,
 * with a frame-rate independent exponential. Then snap to the exact defaults.
 * @returns {boolean} true while the animation is running
 */
function updateResetTween(dt) {
  if (!resetTween.active) return false;

  const alpha = 1 - Math.exp(-RESET_EASE_RATE * dt);
  const orientation = slerp(readQuat(state.transform), IDENTITY, alpha);
  const next = {
    qx: orientation.x,
    qy: orientation.y,
    qz: orientation.z,
    qw: orientation.w,
    panX: state.transform.panX * (1 - alpha),
    panY: state.transform.panY * (1 - alpha),
    scale: 1 + (state.transform.scale - 1) * (1 - alpha),
  };

  const done =
    angleOf(orientation) < 1e-3 &&
    Math.abs(next.panX) < 1e-3 &&
    Math.abs(next.panY) < 1e-3 &&
    Math.abs(next.scale - 1) < 1e-3;

  setTransform(
    done ? { rotX: 0, rotY: 0, qx: 0, qy: 0, qz: 0, qw: 1, panX: 0, panY: 0, scale: 1 } : next,
    { silent: true },
  );
  if (done) resetTween.active = false;
  return true;
}

/**
 * Keep a released mouse or touch drag turning, a little less each frame,
 * until it is effectively still. A hand throw is applied in applyGesture
 * and cancels this, so the two do not add.
 * @param {number} dt
 * @param {boolean} resetting
 * @returns {boolean} true while the coast is still moving the model
 */
function applyPointerCoast(dt, resetting) {
  if (resetting) {
    mouse.cancelCoast();
    return false;
  }
  const step = mouse.coast(dt);
  if (!step.pitch && !step.yaw) return false;
  setTransform(tumbleTransform(state.transform, step.pitch, step.yaw), { silent: true });
  lastGrabMs = performance.now();
  autoRotateBlend = 0;
  return true;
}

/**
 * Hand status: an active action wins over the plain "hand detected" labels, and
 * the reset animation keeps its label until it finishes.
 */
function updateHandStatus(gestureState, resetting) {
  if (resetting) {
    handHud.setStatus('resetting');
    return;
  }
  if (!gestureState) return;

  const actionStatus = describeActionStatus(gestureState);
  handHud.setStatus(actionStatus ?? describeHandStatus(gestureState));
}

/**
 * Auto-rotation eases to 0 the moment a grab starts and back to 1 about a second
 * after it ends, so grabbing never fights the idle spin and releasing is smooth.
 */
function autoRotateFactor(dt, grabbing) {
  if (grabbing) {
    lastGrabMs = performance.now();
    autoRotateBlend = 0;
    return 0;
  }

  const now = performance.now();
  const mayResume = lastGrabMs === 0 || now - lastGrabMs >= AUTO_ROTATE_RESUME_DELAY_MS;
  const target = mayResume ? 1 : 0;
  const step = dt / AUTO_ROTATE_RAMP_SECONDS;
  const change = Math.max(-step, Math.min(step, target - autoRotateBlend));
  autoRotateBlend = Math.max(0, Math.min(1, autoRotateBlend + change));
  return autoRotateBlend;
}

/** Ease the preset transition and push it onto the live materials. */
function updateHologramStyle(dt) {
  hologramStyle.update(dt);
  // Low quality calms the animated shader work (flicker and glitch). Scanline
  // density stays the user's setting: it is a look, not a frame-rate lever.
  const scale = effectScale(qualityId);
  const style = hologramStyle.snapshot();
  applyHologramStyle(
    state.model.object,
    { ...style, glitch: style.glitch * scale },
    {
      intensity: state.settings.hologramIntensity,
      scanDensity: state.settings.scanDensity,
      flicker: state.settings.flicker * scale,
    },
  );
}

function updateModel(dt, elapsed, grabbing) {
  const model = state.model;
  if (!model.object) return;

  const spin = autoRotateFactor(dt, grabbing);
  if (!mouse.isInteracting() && spin > 0) {
    setTransform(tumbleTransform(state.transform, 0, AUTO_ROTATE_SPEED * dt * spin), { silent: true });
  }

  applyTransform(model.object, state.transform, model.baseScale);

  const materials = getHologramMaterials(model.object);
  for (const material of materials) {
    updateHologramUniforms(material, { time: elapsed });
  }
}

/**
 * Detect once, feed the engine, publish to state.gesture and the HUD.
 * @returns {import('./input/gestures.js').GestureState|null} null when the
 * camera is off or the video is not ready. A quality skip still returns a
 * gesture, computed from the last sample.
 */
function pollHands(dt) {
  handsClearedCanvas = false;
  handUsedFullFrame = false;
  // Dev feed (?handdemo=pinch|fist|palm|two) replaces the camera entirely, so the
  // skeleton + overlay can be checked without a webcam.
  const demoMode = demoHandMode();
  const tracking = Boolean(demoMode) || Boolean(handTracker && webcam.isReady());

  if (!tracking) {
    if (handsWereLive) releaseLiveGesture();
    lastDetectedHands = null;
    debugAccumulator += dt;
    if (debugAccumulator >= DEBUG_INTERVAL_SECONDS) {
      debugAccumulator = 0;
      handHud.setDebug({
        hands: [],
        fps: currentFps(),
        inferenceMs: 0,
        delegate: delegateLabel,
        face: faceDebugPayload(),
      });
    }
    return null;
  }

  const nowMs = performance.now();
  let hands;
  let detectionMs = 0;
  let ranDetection = false;

  if (demoMode) {
    hands = demoHands(demoMode, nowMs);
    ranDetection = true;
  } else if (!handsDue(qualityId, nowMs, lastHandDetectionMs)) {
    // This frame skips MediaPipe. Gesture math still runs on the last sample:
    // the landmarks have not moved, so the drag delta is zero (a stale delta is
    // not applied again), and a pinch, fist or palm stays latched instead of
    // dropping for one frame and resetting the stability gate.
    hands = lastDetectedHands ?? [];
  } else {
    lastHandDetectionMs = nowMs;
    const detected = handTracker.detect(webcam.video, nowMs);
    hands = detected.hands;
    handUsedFullFrame = Boolean(detected.fullFrame);
    lastDetectedHands = hands;
    detectionMs = detected.detectionMs;
    ranDetection = true;
    handsClearedCanvas = true;
  }

  if (ranDetection) lastInferenceMs = detectionMs;

  // On a skipped frame the clock stays on the last real sample. Advancing it
  // would make the next detection look like a one-frame jerk (the whole gap
  // compressed into 16 ms) and would decay inertia twice.
  const gestureNow =
    !ranDetection && Number.isFinite(lastHandDetectionMs) ? lastHandDetectionMs : nowMs;

  handsWereLive = true;
  const gestureState = gestureEngine.update(hands, {
    start: state.settings.pinchStartThreshold,
    release: state.settings.pinchReleaseThreshold,
    sensitivity: state.settings.gestureRotateSensitivity,
    panSensitivity: state.settings.panSensitivity,
    smoothing: state.settings.landmarkSmoothing,
    fistThreshold: state.settings.fistThreshold,
    nowMs: gestureNow,
  });
  setGesture(gestureState);

  debugAccumulator += dt;
  if (debugAccumulator < DEBUG_INTERVAL_SECONDS) return gestureState;
  debugAccumulator = 0;

  handHud.setDebug({
    hands: gestureState.hands.map((hand) => ({
      id: hand.id,
      handedness: hand.handedness,
      pinchRatio: hand.pinchRatio,
      active: hand.pinch.active,
      fist: hand.fist,
      openPalm: hand.openPalm,
    })),
    fps: currentFps(),
    inferenceMs: lastInferenceMs,
    delegate: delegateLabel,
    face: faceDebugPayload(),
  });

  return gestureState;
}

/** @param {number} dt seconds */
function updateFrameStats(dt) {
  if (!(dt > 0)) return;
  smoothedFrameTime =
    smoothedFrameTime === 0 ? dt : smoothedFrameTime * FPS_SMOOTHING + dt * (1 - FPS_SMOOTHING);
}

function currentFps() {
  return smoothedFrameTime > 0 ? 1 / smoothedFrameTime : 0;
}

/* ----------------------------------------------------------- dev hook --- */

/**
 * Dev aid: `?model=/samples/knot.glb` preloads one or more models through the
 * exact same pipeline as a user upload (repeat the param for a swap test).
 */
async function preloadModelsFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const urls = params.getAll('model');
  // ?savelib=1 stores the preloaded model in the library, so the whole
  // persist → reopen path can be exercised without a file picker.
  const save = params.get('savelib') === '1';
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const blob = await response.blob();
      const name = url.split('/').pop() || 'model.glb';
      await handleFiles([new File([blob], name)], { save });
    } catch (error) {
      feedback.toast(`Could not preload ${url}`, 'error');
      console.warn(`Could not preload ${url}`, error);
    }
  }
}

if (new URLSearchParams(window.location.search).has('model')) {
  preloadModelsFromQuery();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removeUpdate();
    stopLoop();
    if (handTracker) handTracker.dispose();
    if (faceTracker) faceTracker.dispose();
    perfHud.dispose();
    gestureFeedback.dispose();
    sound.dispose();
    webcam.dispose();
    handHud.dispose();
    mouse.dispose();
    unsubscribeSettings();
    window.removeEventListener('keydown', handleKeydown);
    settingsPanel.dispose();
    presetBar.dispose();
    modeBar.dispose();
    tools.dispose();
    recorder.dispose();
    libraryPanel.dispose();
    fileDrop.dispose();
    toolbar.dispose();
    feedback.dispose();
    scene.dispose();
    stage.remove();
    sensorPanel.remove();
  });
}
