// src/ui/feedback.js
// Owns: what the user is told. The centered empty state ("drop a model"), the
// bottom-left status pill driven by `state.status`, and the toast stack for
// successes and load errors.
//
// Read-only with respect to state: it subscribes to 'state:changed' and renders
// whatever the app (main.js) has already decided.

import { STATE_CHANGED, state } from '../state.js';
import { events } from '../events.js';

const TOAST_LIFETIME_MS = 5200;
const TOAST_LIFETIME_ERROR_MS = 8500;

const ICON_MODEL = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 4.5 27 10.6v10.8L16 27.5 5 21.4V10.6L16 4.5Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 10.6 16 16.7l11-6.1M16 16.7v10.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

const ICON_CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.8 9.6 17.4 19 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ICON_ALERT = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4.8 21 19.6H3L12 4.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.2" r="0.95" fill="currentColor"/></svg>`;

const STATUS_TONE_BY_CODE = {
  idle: 'idle',
  'model-loading': 'busy',
  'model-ready': 'ok',
  'model-error': 'bad',
};

/**
 * @param {HTMLElement} container
 * @returns {{
 *   showHint: () => void,
 *   hideHint: () => void,
 *   toast: (message: string, kind?: 'info'|'ok'|'error') => void,
 *   dispose: () => void,
 * }}
 */
export function createFeedback(container) {
  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  emptyState.innerHTML = `
    <div class="empty-state-card">
      <span class="empty-state-icon">${ICON_MODEL}</span>
      <h1 class="empty-state-title">Drop a 3D model</h1>
      <p class="empty-state-copy">Get a blue hologram of any model, right in the browser.</p>
      <p class="empty-state-formats">.glb &middot; .gltf &middot; .obj &middot; .stl</p>
    </div>
  `;

  const statusPill = document.createElement('div');
  statusPill.className = 'status-pill';
  statusPill.setAttribute('role', 'status');
  statusPill.innerHTML = `<span class="status-dot"></span><span class="status-text"></span>`;

  const toastStack = document.createElement('div');
  toastStack.className = 'toast-stack';
  toastStack.setAttribute('aria-live', 'polite');

  container.append(emptyState, statusPill, toastStack);

  const statusText = statusPill.querySelector('.status-text');
  /** @type {Map<HTMLElement, number>} */
  const toastTimers = new Map();

  function renderStatus() {
    const { code, message } = state.status;
    const tone = STATUS_TONE_BY_CODE[code] ?? 'idle';
    statusPill.dataset.tone = tone;
    statusPill.classList.toggle('is-visible', Boolean(message));
    statusText.textContent = message;
  }

  function onStateChanged({ keys }) {
    if (keys.includes('status')) renderStatus();
  }

  const unsubscribe = events.on(STATE_CHANGED, onStateChanged);
  renderStatus();

  function showHint() {
    emptyState.classList.remove('is-hidden');
  }

  function hideHint() {
    emptyState.classList.add('is-hidden');
  }

  function toast(message, kind = 'info') {
    if (!message) return;

    const toastElement = document.createElement('div');
    toastElement.className = `toast toast-${kind}`;
    toastElement.innerHTML = `
      <span class="toast-icon">${kind === 'error' ? ICON_ALERT : ICON_CHECK}</span>
      <span class="toast-message"></span>
    `;
    toastElement.querySelector('.toast-message').textContent = message;
    toastStack.appendChild(toastElement);

    const lifetime = kind === 'error' ? TOAST_LIFETIME_ERROR_MS : TOAST_LIFETIME_MS;
    const timer = window.setTimeout(() => {
      toastTimers.delete(toastElement);
      toastElement.classList.add('is-leaving');
      window.setTimeout(() => toastElement.remove(), 220);
    }, lifetime);
    toastTimers.set(toastElement, timer);
  }

  return {
    showHint,
    hideHint,
    toast,
    dispose() {
      unsubscribe();
      for (const [element, timer] of toastTimers) {
        window.clearTimeout(timer);
        element.remove();
      }
      toastTimers.clear();
      emptyState.remove();
      statusPill.remove();
      toastStack.remove();
    },
  };
}
/* ----------------------------------------------------------- hand HUD --- */
// Phase 2 adds a second feedback surface: the live hand status ("No hand" /
// "Hand detected" / "Pinching (N hands)") and the debug numbers under the camera
// preview. Same rule as the rest of this module: it renders what main.js hands
// it and owns no state of its own.

const HAND_STATUS_LABEL = Object.freeze({
  'camera-off': 'Camera off',
  starting: 'Starting camera…',
  'no-hand': 'No hand',
  detected: 'Hand detected',
  'detected-2': '2 hands',
  'pinching-1': 'Pinching (1 hand)',
  'pinching-2': 'Pinching (2 hands)',
  'camera-error': 'Camera unavailable',
  grabbing: 'Grabbing',
  zooming: 'Zooming',
  panning: 'Panning',
  resetting: 'Resetting',
});

const HAND_STATUS_TONE = Object.freeze({
  'camera-off': 'idle',
  starting: 'busy',
  'no-hand': 'idle',
  detected: 'ok',
  'detected-2': 'ok',
  'pinching-1': 'pinch',
  'pinching-2': 'pinch',
  'camera-error': 'bad',
  grabbing: 'pinch',
  zooming: 'pinch',
  panning: 'pinch',
  resetting: 'busy',
});

/** Short, fixed-width decimal for the debug panel. */
function formatRatio(ratio) {
  return Number.isFinite(ratio) ? ratio.toFixed(3) : '—';
}

/**
 * The preview-adjacent HUD: hand status line plus the optional debug panel.
 * @param {HTMLElement} container
 */
export function createHandHud(container) {
  const element = document.createElement('div');
  element.className = 'hand-hud';
  element.innerHTML = `
    <div class="hand-status">
      <span class="hand-status-dot"></span>
      <span class="hand-status-text"></span>
    </div>
    <div class="hand-debug" hidden>
      <div class="hand-debug-head">
        <span class="hand-debug-title">tracking</span>
        <span class="hand-debug-meta"></span>
      </div>
      <div class="hand-debug-face" data-state="off">
        <span class="hand-debug-face-label">Parallax off</span>
        <span class="hand-debug-face-detail"></span>
      </div>
      <div class="hand-debug-rows"></div>
    </div>
  `;
  container.appendChild(element);

  const statusElement = element.querySelector('.hand-status');
  const statusText = element.querySelector('.hand-status-text');
  const debugElement = element.querySelector('.hand-debug');
  const debugMeta = element.querySelector('.hand-debug-meta');
  const debugRows = element.querySelector('.hand-debug-rows');
  const faceLine = element.querySelector('.hand-debug-face');
  const faceLabel = element.querySelector('.hand-debug-face-label');
  const faceDetail = element.querySelector('.hand-debug-face-detail');

  let currentStatus = '';

  function setStatus(code) {
    if (code === currentStatus) return;
    currentStatus = code;
    const label = HAND_STATUS_LABEL[code] ?? code;
    statusElement.dataset.tone = HAND_STATUS_TONE[code] ?? 'idle';
    statusText.textContent = label;
  }

  /**
   * @param {{
   *   hands: Array<{ id: string, handedness: string, pinchRatio: number, active: boolean }>,
   *   fps: number,
   *   inferenceMs: number,
   *   delegate: string,
   *   face?: { state?: string, label?: string, detail?: string },
   * }} payload
   */
  function setDebug(payload) {
    if (!payload || debugElement.hidden) return;

    const { hands = [], fps = 0, inferenceMs = 0, delegate = '—', face = null } = payload;
    debugMeta.textContent = `${Math.round(fps)} fps · ${inferenceMs.toFixed(1)} ms · ${delegate}`;

    if (face) {
      faceLine.dataset.state = face.state || 'off';
      faceLabel.textContent = face.label || 'Parallax off';
      faceDetail.textContent = face.detail || '';
    }

    if (hands.length === 0) {
      debugRows.innerHTML = '<div class="hand-debug-row is-empty"><span>no hands</span></div>';
      return;
    }

    debugRows.innerHTML = hands
      .map((hand) => {
        const state = hand.active ? 'PINCH' : hand.fist ? 'FIST' : hand.openPalm ? 'PALM' : 'open';
        return `<div class="hand-debug-row${hand.active ? ' is-pinching' : ''}">
          <span class="hand-debug-name"></span>
          <span class="hand-debug-ratio">${formatRatio(hand.pinchRatio)}</span>
          <span class="hand-debug-state">${state}</span>
        </div>`;
      })
      .join('');

    // Fill the names through textContent so a hand id can never inject markup.
    const nameNodes = debugRows.querySelectorAll('.hand-debug-name');
    hands.forEach((hand, index) => {
      if (nameNodes[index]) nameNodes[index].textContent = `${hand.handedness} ${hand.id}`;
    });
  }

  function setDebugVisible(visible) {
    debugElement.hidden = !visible;
  }

  function setVisible(visible) {
    element.hidden = !visible;
  }

  return {
    setStatus,
    setDebug,
    setDebugVisible,
    setVisible,
    dispose() {
      element.remove();
    },
  };
}
