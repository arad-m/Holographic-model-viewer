// src/ui/modeBar.js
// Owns: the mode bar (Orbit / Slice / Explode / Inspect) and the small control
// panel that changes shape with the mode - axis buttons plus a position slider
// for Slice, an amount slider and a notice for Explode, a part readout for
// Inspect.
//
// Presentational only: it reports intent through callbacks and renders whatever
// it is told. The same controls are the mouse/touch alternative for every mode,
// so each mode works without hand tracking.

/**
 * @param {HTMLElement} container
 * @param {{
 *   modes: Array<{ id: string, label: string, shortcut: string, hint: string }>,
 *   onSelectMode: (id: string) => void,
 *   onSelectAxis: (axis: string) => void,
 *   onSlicePosition: (value: number) => void,
 *   onExplode: (value: number) => void,
 * }} handlers
 */
export function createModeBar(
  container,
  { modes, onSelectMode, onSelectAxis, onSlicePosition, onExplode },
) {
  const element = document.createElement('div');
  element.className = 'mode-bar';
  element.setAttribute('aria-label', 'Interaction mode');

  const buttons = modes
    .map(
      (mode) => `
      <button type="button" class="mode-button" data-mode="${mode.id}" aria-pressed="false" title="${mode.label} (${mode.shortcut})">
        <span class="mode-key">${mode.shortcut}</span>
        <span class="mode-name">${mode.label}</span>
      </button>`,
    )
    .join('');

  const axes = ['x', 'y', 'z']
    .map(
      (axis) =>
        `<button type="button" class="axis-button" data-axis="${axis}" aria-pressed="false">${axis.toUpperCase()}</button>`,
    )
    .join('');

  element.innerHTML = `
    <div class="mode-buttons" role="group" aria-label="Modes">${buttons}</div>
    <div class="mode-panel">
      <span class="mode-hint" data-role="hint"></span>
      <div class="mode-controls" data-panel="slice" hidden>
        <div class="axis-group" role="group" aria-label="Slice axis">${axes}</div>
        <input type="range" class="mode-range" data-role="slice-range" min="-1" max="1" step="0.01" value="0" aria-label="Slice position" />
        <span class="mode-value" data-role="slice-value">0.00</span>
      </div>
      <div class="mode-controls" data-panel="explode" hidden>
        <input type="range" class="mode-range" data-role="explode-range" min="0" max="1" step="0.01" value="0" aria-label="Explosion amount" />
        <span class="mode-value" data-role="explode-value">0%</span>
        <span class="mode-notice" data-role="notice" hidden></span>
      </div>
      <div class="mode-controls" data-panel="inspect" hidden>
        <span class="mode-part" data-role="part"></span>
      </div>
    </div>
  `;

  const modeButtons = Array.from(element.querySelectorAll('[data-mode]'));
  const axisButtons = Array.from(element.querySelectorAll('[data-axis]'));
  const hint = element.querySelector('[data-role="hint"]');
  const panels = new Map(
    Array.from(element.querySelectorAll('[data-panel]')).map((panel) => [
      panel.dataset.panel,
      panel,
    ]),
  );
  const sliceRange = element.querySelector('[data-role="slice-range"]');
  const sliceValue = element.querySelector('[data-role="slice-value"]');
  const explodeRange = element.querySelector('[data-role="explode-range"]');
  const explodeValue = element.querySelector('[data-role="explode-value"]');
  const notice = element.querySelector('[data-role="notice"]');
  const part = element.querySelector('[data-role="part"]');

  let currentMode = 'orbit';

  function renderPanels() {
    for (const [id, panel] of panels) panel.hidden = id !== currentMode;
    const mode = modes.find((item) => item.id === currentMode);
    hint.textContent = mode?.hint ?? '';
    // Orbit has a hint but no controls. On narrow screens the hint is hidden, so
    // flag it: otherwise an empty capsule sits under the buttons for nothing.
    element.classList.toggle('is-quiet', currentMode === 'orbit');
  }

  function handleModeClick(event) {
    const id = event.currentTarget.dataset.mode;
    if (id) onSelectMode(id);
  }

  function handleAxisClick(event) {
    const axis = event.currentTarget.dataset.axis;
    if (axis) onSelectAxis(axis);
  }

  function handleSliceInput() {
    onSlicePosition(Number(sliceRange.value));
  }

  function handleExplodeInput() {
    onExplode(Number(explodeRange.value));
  }

  for (const button of modeButtons) button.addEventListener('click', handleModeClick);
  for (const button of axisButtons) button.addEventListener('click', handleAxisClick);
  sliceRange.addEventListener('input', handleSliceInput);
  explodeRange.addEventListener('input', handleExplodeInput);

  container.appendChild(element);
  renderPanels();

  return {
    /** @param {string} id */
    setMode(id) {
      currentMode = id;
      for (const button of modeButtons) {
        button.setAttribute('aria-pressed', button.dataset.mode === id ? 'true' : 'false');
      }
      renderPanels();
    },
    /** @param {string} axis */
    setSliceAxis(axis) {
      for (const button of axisButtons) {
        button.setAttribute('aria-pressed', button.dataset.axis === axis ? 'true' : 'false');
      }
    },
    /** @param {number} value -1..1 */
    setSlicePosition(value) {
      const safe = Number.isFinite(value) ? value : 0;
      sliceRange.value = String(safe);
      sliceValue.textContent = safe.toFixed(2);
    },
    /** @param {number} value 0..1 */
    setExplode(value) {
      const safe = Number.isFinite(value) ? value : 0;
      explodeRange.value = String(safe);
      explodeValue.textContent = `${Math.round(safe * 100)}%`;
    },
    /**
     * Explode needs more than one part. When it does not have them the slider is
     * disabled and the notice explains why, instead of silently doing nothing.
     *
     * @param {{ separable: boolean, parts: number }} info
     */
    setExplodeAvailability({ separable, parts }) {
      explodeRange.disabled = !separable;
      if (separable) {
        notice.hidden = true;
        notice.textContent = '';
        return;
      }
      notice.hidden = false;
      notice.textContent =
        parts <= 1 ? 'Single mesh — nothing to separate' : 'Load a model to explode it';
    },
    /** @param {string} text */
    setInspectLabel(text) {
      const label = typeof text === 'string' ? text : '';
      part.textContent = label;
      part.classList.toggle('is-empty', label.length === 0);
    },
    element,
    dispose() {
      for (const button of modeButtons) button.removeEventListener('click', handleModeClick);
      for (const button of axisButtons) button.removeEventListener('click', handleAxisClick);
      sliceRange.removeEventListener('input', handleSliceInput);
      explodeRange.removeEventListener('input', handleExplodeInput);
      element.remove();
    },
  };
}
