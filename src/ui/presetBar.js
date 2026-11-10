// src/ui/presetBar.js
// Owns: the hologram preset buttons - a swatch in the preset's own colour, its
// name, and the keyboard shortcut. Presentational only: it reports the chosen id
// and reflects the active one, never touching materials or state.

/**
 * @param {HTMLElement} container
 * @param {{
 *   presets: Array<{ id: string, label: string, shortcut: string, style: { color: string } }>,
 *   onSelect: (id: string) => void,
 * }} options
 * @returns {{
 *   setActive: (id: string) => void,
 *   element: HTMLElement,
 *   dispose: () => void,
 * }}
 */
export function createPresetBar(container, { presets, onSelect }) {
  const element = document.createElement('div');
  element.className = 'preset-bar';
  element.setAttribute('aria-label', 'Hologram presets');

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();

  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-button';
    button.dataset.preset = preset.id;
    button.setAttribute('aria-pressed', 'false');
    // Presets live behind Shift now: the bare digits belong to the tool modes.
    button.title = `${preset.label} (Shift+${preset.shortcut})`;

    const swatch = document.createElement('span');
    swatch.className = 'preset-swatch';
    swatch.style.background = preset.style.color;
    swatch.style.boxShadow = `0 0 10px ${preset.style.color}`;

    const label = document.createElement('span');
    label.className = 'preset-label';
    label.textContent = preset.label;

    const key = document.createElement('span');
    key.className = 'preset-key';
    key.textContent = `⇧${preset.shortcut}`;

    button.append(swatch, label, key);
    button.addEventListener('click', () => onSelect(preset.id));

    buttons.set(preset.id, button);
    element.appendChild(button);
  }

  container.appendChild(element);

  return {
    /** @param {string} id */
    setActive(id) {
      for (const [presetId, button] of buttons) {
        button.setAttribute('aria-pressed', presetId === id ? 'true' : 'false');
      }
    },
    element,
    dispose() {
      element.remove();
    },
  };
}
