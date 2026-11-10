// src/ui/toolbar.js
// Owns: every entry point for getting a model in - the top bar with its "Load
// model" button and hidden file input, plus the window-wide drag-and-drop
// overlay. Both call the same `onFiles(File[])` callback; neither knows how a
// model is parsed.
//
// Drag-and-drop lives here (rather than in a new module) because it is the same
// responsibility as the file input: handing files to the app.
//
// It never mutates app state; it only reports intent and reflects busy state.

/** Accepted extensions, shared with modelLoader's support list. */
const ACCEPTED = '.glb,.gltf,.obj,.stl';

const ICON_UPLOAD = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15.5v2.2A2.3 2.3 0 0 0 6.8 20h10.4a2.3 2.3 0 0 0 2.3-2.3v-2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const ICON_RESET = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.8 9.2A7.5 7.5 0 1 1 4.5 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.2 4.6v4.9h4.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ICON_CUBE = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.2 20 8v8l-8 4.8L4 16V8l8-4.8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 8l8 4.8L20 8M12 12.8V20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const ICON_DEBUG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.2 6.5h15.6M4.2 12h9.6M4.2 17.5h13.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="18.4" cy="12" r="1.5" fill="currentColor"/></svg>`;

const ICON_HAND = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 11V5.6a1.4 1.4 0 0 1 2.8 0V11m0 0V4.6a1.4 1.4 0 0 1 2.8 0V11m0 0V6.4a1.4 1.4 0 0 1 2.8 0v7.4a6.2 6.2 0 0 1-6.2 6.2h-.6a5.4 5.4 0 0 1-4.3-2.1l-2.5-3.3a1.4 1.4 0 0 1 2.1-1.8L9 15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ICON_SOUND_ON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 9.5h3l4-3v11l-4-3h-3v-5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 8.6a4.6 4.6 0 0 1 0 6.8M17.4 6.2a8 8 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const ICON_SOUND_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 9.5h3l4-3v11l-4-3h-3v-5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m15.4 9.4 4.6 4.6m0-4.6-4.6 4.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const ICON_SETTINGS = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 0 0-2.6-1.5L14.4 3h-3.6l-.3 2.4a7.6 7.6 0 0 0-2.6 1.5l-2-.8-1.8 3.1L5.8 10.5a7.6 7.6 0 0 0 0 3l-1.7 1.3 1.8 3.1 2-.8a7.6 7.6 0 0 0 2.6 1.5l.3 2.4h3.6l.3-2.4a7.6 7.6 0 0 0 2.6-1.5l2 .8 1.8-3.1-1.7-1.3Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const ICON_LIBRARY = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5.6h4.2v13H4zM9.9 5.6h4.2v13H9.9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m16.4 6.1 3.3 12.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const ICON_CAMERA = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.4 8.6h3l1.5-1.9h6.2l1.5 1.9h3v9.1H4.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12.9" r="2.9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

const ICON_RECORD = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7.4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle class="record-dot" cx="12" cy="12" r="3.6" fill="currentColor"/></svg>`;

const ICON_STOP = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6" fill="currentColor"/></svg>`;

/**
 * @param {HTMLElement} container
 * @param {{
 *   onFiles: (files: File[]) => void,
 *   onReset: () => void,
 *   onToggleDebug?: () => void,
 *   onToggleSkeleton?: () => void,
 *   onToggleSound?: () => void,
 *   onVolume?: (volume: number) => void,
 *   onToggleSettings?: () => void,
 *   onToggleLibrary?: () => void,
 *   onScreenshot?: () => void,
 *   onToggleRecord?: () => void,
 * }} handlers
 * @returns {{
 *   setBusy: (busy: boolean) => void,
 *   setDebugActive: (active: boolean) => void,
 *   setSkeletonActive: (active: boolean) => void,
 *   setSoundActive: (active: boolean) => void,
 *   setVolume: (volume: number) => void,
 *   setSettingsActive: (active: boolean) => void,
 *   setLibraryActive: (active: boolean) => void,
 *   setScreenshotBusy: (busy: boolean) => void,
 *   setCapturing: (active: boolean) => void,
 *   setRecordingElapsed: (text: string) => void,
 *   setCaptureAvailability: (availability: { screenshot?: boolean, record?: boolean, library?: boolean, recordHint?: string }) => void,
 *   dispose: () => void,
 * }}
 */
export function createToolbar(
  container,
  {
    onFiles,
    onReset,
    onToggleDebug,
    onToggleSkeleton,
    onToggleSound,
    onVolume,
    onToggleSettings,
    onToggleLibrary,
    onScreenshot,
    onToggleRecord,
  },
) {
  const element = document.createElement('header');
  element.className = 'toolbar';
  element.innerHTML = `
    <div class="toolbar-brand">
      <span class="toolbar-mark">${ICON_CUBE}</span>
      <span class="toolbar-titles">
        <span class="toolbar-title">Holographic Viewer</span>
        <span class="toolbar-subtitle">Runs locally &middot; nothing uploaded</span>
      </span>
    </div>
    <div class="toolbar-actions">
      <button type="button" class="btn btn-primary" data-role="open">
        ${ICON_UPLOAD}<span class="btn-label">Load model</span>
      </button>
      <button type="button" class="btn" data-role="reset">
        ${ICON_RESET}<span class="btn-label">Reset view</span>
      </button>
      <div class="toolbar-capture">
        <button
          type="button"
          class="btn btn-toggle"
          data-role="library"
          aria-pressed="false"
          aria-label="Model library"
          title="Saved models"
        >
          ${ICON_LIBRARY}<span class="btn-label">Library</span>
        </button>
        <button
          type="button"
          class="btn"
          data-role="screenshot"
          aria-label="Save a screenshot"
          title="Save a PNG of the view"
        >
          ${ICON_CAMERA}<span class="btn-label">Shot</span>
        </button>
        <button
          type="button"
          class="btn btn-toggle btn-record"
          data-role="record"
          aria-pressed="false"
        >
          <span class="record-icon-on">${ICON_RECORD}</span><span class="record-icon-off">${ICON_STOP}</span>
          <span class="btn-label" data-role="record-label">Record</span>
        </button>
      </div>
      <button type="button" class="btn btn-toggle" data-role="skeleton" aria-pressed="true">
        ${ICON_HAND}<span class="btn-label">Hands</span>
      </button>
      <div class="toolbar-audio">
        <button type="button" class="btn btn-toggle" data-role="sound" aria-pressed="true">
          <span class="btn-icon-on">${ICON_SOUND_ON}</span><span class="btn-icon-off">${ICON_SOUND_OFF}</span>
          <span class="btn-label">Sound</span>
        </button>
        <input
          type="range"
          class="volume-slider"
          data-role="volume"
          min="0"
          max="1"
          step="0.01"
          value="0.7"
          aria-label="Sound volume"
        />
      </div>
      <button type="button" class="btn btn-toggle" data-role="debug" aria-pressed="true">
        ${ICON_DEBUG}<span class="btn-label">Debug</span>
      </button>
      <button type="button" class="btn btn-toggle" data-role="settings" aria-pressed="false">
        ${ICON_SETTINGS}<span class="btn-label">Settings</span>
      </button>
      <input type="file" accept="${ACCEPTED}" data-role="file" hidden />
    </div>
  `;

  const openButton = element.querySelector('[data-role="open"]');
  const resetButton = element.querySelector('[data-role="reset"]');
  const debugButton = element.querySelector('[data-role="debug"]');
  const skeletonButton = element.querySelector('[data-role="skeleton"]');
  const soundButton = element.querySelector('[data-role="sound"]');
  const volumeSlider = element.querySelector('[data-role="volume"]');
  const settingsButton = element.querySelector('[data-role="settings"]');
  const libraryButton = element.querySelector('[data-role="library"]');
  const screenshotButton = element.querySelector('[data-role="screenshot"]');
  const recordButton = element.querySelector('[data-role="record"]');
  const recordLabel = element.querySelector('[data-role="record-label"]');
  const fileInput = element.querySelector('[data-role="file"]');
  const label = openButton.querySelector('.btn-label');
  const defaultLabel = label.textContent;
  const defaultRecordLabel = recordLabel.textContent;

  function openPicker() {
    if (openButton.disabled) return;
    fileInput.click();
  }

  function handleInputChange() {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    if (files.length > 0) onFiles(files);
  }

  function handleReset() {
    onReset();
  }

  function handleToggleDebug() {
    if (typeof onToggleDebug === 'function') onToggleDebug();
  }

  function handleToggleSkeleton() {
    if (typeof onToggleSkeleton === 'function') onToggleSkeleton();
  }

  function handleToggleSound() {
    if (typeof onToggleSound === 'function') onToggleSound();
  }

  function handleVolume() {
    if (typeof onVolume === 'function') onVolume(Number(volumeSlider.value));
  }

  function handleToggleSettings() {
    if (typeof onToggleSettings === 'function') onToggleSettings();
  }

  function handleToggleLibrary() {
    if (typeof onToggleLibrary === 'function') onToggleLibrary();
  }

  function handleScreenshot() {
    if (typeof onScreenshot === 'function') onScreenshot();
  }

  function handleToggleRecord() {
    if (typeof onToggleRecord === 'function') onToggleRecord();
  }

  openButton.addEventListener('click', openPicker);
  resetButton.addEventListener('click', handleReset);
  debugButton.addEventListener('click', handleToggleDebug);
  skeletonButton.addEventListener('click', handleToggleSkeleton);
  soundButton.addEventListener('click', handleToggleSound);
  volumeSlider.addEventListener('input', handleVolume);
  settingsButton.addEventListener('click', handleToggleSettings);
  libraryButton.addEventListener('click', handleToggleLibrary);
  screenshotButton.addEventListener('click', handleScreenshot);
  recordButton.addEventListener('click', handleToggleRecord);
  fileInput.addEventListener('change', handleInputChange);

  container.appendChild(element);

  return {
    setBusy(busy) {
      openButton.disabled = Boolean(busy);
      openButton.classList.toggle('is-busy', Boolean(busy));
      label.textContent = busy ? 'Loading…' : defaultLabel;
    },
    setDebugActive(active) {
      debugButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
    setSkeletonActive(active) {
      skeletonButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
    setSoundActive(active) {
      soundButton.setAttribute('aria-pressed', active ? 'true' : 'false');
      soundButton.classList.toggle('is-muted', !active);
      volumeSlider.disabled = !active;
    },
    setVolume(volume) {
      const value = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 0.7;
      volumeSlider.value = String(value);
    },
    setSettingsActive(active) {
      settingsButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
    setLibraryActive(active) {
      libraryButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
    setScreenshotBusy(busy) {
      screenshotButton.disabled = Boolean(busy);
      screenshotButton.classList.toggle('is-busy', Boolean(busy));
    },
    setCapturing(active) {
      recordButton.setAttribute('aria-pressed', active ? 'true' : 'false');
      recordButton.classList.toggle('is-recording', Boolean(active));
      if (!active) recordLabel.textContent = defaultRecordLabel;
    },
    setRecordingElapsed(text) {
      recordLabel.textContent = text || defaultRecordLabel;
    },
    setCaptureAvailability({ screenshot = true, record = true, library = true, recordHint = '' } = {}) {
      screenshotButton.disabled = !screenshot;
      screenshotButton.title = screenshot ? 'Save a PNG of the view' : 'Nothing to capture yet';
      recordButton.disabled = !record;
      recordButton.title = record ? 'Record the view to a video file' : recordHint || 'Recording is unavailable';
      recordButton.setAttribute('aria-label', recordButton.title);
      libraryButton.disabled = !library;
    },
    dispose() {
      openButton.removeEventListener('click', openPicker);
      resetButton.removeEventListener('click', handleReset);
      debugButton.removeEventListener('click', handleToggleDebug);
      skeletonButton.removeEventListener('click', handleToggleSkeleton);
      soundButton.removeEventListener('click', handleToggleSound);
      volumeSlider.removeEventListener('input', handleVolume);
      settingsButton.removeEventListener('click', handleToggleSettings);
      libraryButton.removeEventListener('click', handleToggleLibrary);
      screenshotButton.removeEventListener('click', handleScreenshot);
      recordButton.removeEventListener('click', handleToggleRecord);
      fileInput.removeEventListener('change', handleInputChange);
      element.remove();
    },
  };
}

/**
 * Window-wide drag-and-drop. Shows a full-screen drop overlay while files are
 * dragged over the page and hands whatever is dropped to `onFiles` - including
 * unsupported types, so the app can show one clear error instead of nothing.
 *
 * @param {HTMLElement} container
 * @param {{ onFiles: (files: File[]) => void }} handlers
 * @returns {{ dispose: () => void }}
 */
export function attachFileDrop(container, { onFiles }) {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.innerHTML = `
    <div class="drop-overlay-card">
      <span class="drop-overlay-icon">${ICON_UPLOAD}</span>
      <span class="drop-overlay-title">Drop to load</span>
      <span class="drop-overlay-hint">${ACCEPTED.replaceAll(',', '  ')}</span>
    </div>
  `;

  let depth = 0;

  function isFileDrag(event) {
    const types = event.dataTransfer?.types;
    return Boolean(types && Array.from(types).includes('Files'));
  }

  function onDragEnter(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth += 1;
    overlay.classList.add('is-active');
  }

  function onDragOver(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(event) {
    if (!isFileDrag(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.remove('is-active');
  }

  function onDrop(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.classList.remove('is-active');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  }

  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);
  container.appendChild(overlay);

  return {
    dispose() {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      overlay.remove();
    },
  };
}
