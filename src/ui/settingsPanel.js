// src/ui/settingsPanel.js
// Owns: the collapsible settings drawer. It is generated from settings/schema.js,
// so adding a setting is a one-line change in the schema - the panel never keeps
// its own copy of a value: it reads through `getSettings()` and reports edits
// through `onChange(key, value)`, which applies them live and persists them.
//
// The reset button asks the owner to restore defaults; the panel then re-syncs
// from state, so a reset can never leave a slider showing a stale number.

import { SETTINGS_GROUPS, SETTINGS_SCHEMA } from '../settings/schema.js';

/**
 * @param {HTMLElement} container
 * @param {{
 *   getSettings: () => Record<string, unknown>,
 *   onChange: (key: string, value: number|boolean) => void,
 *   onReset: () => void,
 * }} handlers
 * @returns {{
 *   open: () => void,
 *   close: () => void,
 *   toggle: () => void,
 *   isOpen: () => boolean,
 *   sync: () => void,
 *   element: HTMLElement,
 *   dispose: () => void,
 * }}
 */
export function createSettingsPanel(container, { getSettings, onChange, onReset }) {
  const element = document.createElement('aside');
  element.className = 'settings-panel';
  element.setAttribute('aria-label', 'Settings');
  element.setAttribute('aria-hidden', 'true');

  const head = document.createElement('header');
  head.className = 'settings-head';
  head.innerHTML = `
    <span class="settings-title">Settings</span>
    <button type="button" class="settings-close" aria-label="Close settings">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </button>
  `;

  const body = document.createElement('div');
  body.className = 'settings-body';

  /** @type {Map<string, { input: HTMLInputElement, output: HTMLElement|null, setting: any }>} */
  const controls = new Map();

  for (const group of SETTINGS_GROUPS) {
    const items = SETTINGS_SCHEMA.filter((setting) => setting.group === group.id);
    if (items.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'settings-group';

    const heading = document.createElement('h3');
    heading.className = 'settings-group-title';
    heading.textContent = group.label;
    section.appendChild(heading);

    for (const setting of items) {
      section.appendChild(createControl(setting));
    }

    body.appendChild(section);
  }

  const foot = document.createElement('footer');
  foot.className = 'settings-foot';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn settings-reset';
  resetButton.textContent = 'Reset to defaults';
  foot.appendChild(resetButton);

  element.append(head, body, foot);
  container.appendChild(element);

  /** @param {any} setting */
  function createControl(setting) {
    const row = document.createElement('label');
    row.className = `settings-row settings-row-${setting.type}`;
    row.dataset.key = setting.key;

    const label = document.createElement('span');
    label.className = 'settings-label';
    label.textContent = setting.label;

    if (setting.type === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'settings-check';
      input.dataset.key = setting.key;
      input.addEventListener('change', () => onChange(setting.key, input.checked));
      row.append(label, input);
      controls.set(setting.key, { input, output: null, setting });
      return row;
    }

    if (setting.type === 'select') {
      const input = document.createElement('select');
      input.className = 'settings-select';
      input.dataset.key = setting.key;
      for (const option of setting.options) {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        input.appendChild(element);
      }
      input.addEventListener('change', () => onChange(setting.key, input.value));
      row.append(label, input);
      controls.set(setting.key, { input, output: null, setting });
      return row;
    }

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'settings-range';
    input.dataset.key = setting.key;
    input.min = String(setting.min);
    input.max = String(setting.max);
    input.step = String(setting.step);

    const output = document.createElement('output');
    output.className = 'settings-value';

    input.addEventListener('input', () => {
      const value = Number(input.value);
      output.textContent = formatValue(setting, value);
      onChange(setting.key, value);
    });

    row.append(label, input, output);
    controls.set(setting.key, { input, output, setting });
    return row;
  }

  /** Push state values into the controls (start-up, reset, external changes). */
  function sync() {
    const settings = getSettings() ?? {};
    for (const [key, control] of controls) {
      const value = settings[key];
      if (control.setting.type === 'boolean') {
        control.input.checked = Boolean(value);
        continue;
      }
      if (control.setting.type === 'select') {
        const selected = typeof value === 'string' ? value : control.setting.default;
        control.input.value = selected;
        continue;
      }
      const numeric = Number.isFinite(value) ? value : control.setting.default;
      control.input.value = String(numeric);
      if (control.output) control.output.textContent = formatValue(control.setting, numeric);
    }
  }

  function open() {
    element.classList.add('is-open');
    element.setAttribute('aria-hidden', 'false');
    sync();
  }

  function close() {
    element.classList.remove('is-open');
    element.setAttribute('aria-hidden', 'true');
  }

  function isOpen() {
    return element.classList.contains('is-open');
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  const handleClose = () => close();
  const handleReset = () => {
    onReset();
    sync();
  };

  head.querySelector('.settings-close').addEventListener('click', handleClose);
  resetButton.addEventListener('click', handleReset);

  sync();

  return {
    open,
    close,
    toggle,
    isOpen,
    sync,
    element,
    dispose() {
      head.querySelector('.settings-close')?.removeEventListener('click', handleClose);
      resetButton.removeEventListener('click', handleReset);
      element.remove();
    },
  };
}

/**
 * 2 decimals for fine steps, 1 for tenths, 0 for whole numbers.
 * @param {{ step: number }} setting
 * @param {number} value
 */
function formatValue(setting, value) {
  const decimals = setting.step >= 1 ? 0 : setting.step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}
