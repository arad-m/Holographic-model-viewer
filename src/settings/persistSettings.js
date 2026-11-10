// src/settings/persistSettings.js
// Owns: keeping localStorage in step with `state.settings`. One subscription, so
// every write path (drawer, toolbar, shortcuts, reset) persists without each of
// them remembering to.
//
// It lives in its own module so the wiring itself can be tested: attach it to the
// real state module in a Node test and a settings change must reach storage.

import { STATE_CHANGED, state } from '../state.js';
import { events } from '../events.js';
import { saveSettings } from '../storage/settings.js';

/**
 * Subscribe and persist on every settings change.
 * @returns {() => void} unsubscribe
 */
export function attachSettingsPersistence() {
  return events.on(STATE_CHANGED, ({ keys } = {}) => {
    if (!Array.isArray(keys) || !keys.includes('settings')) return;
    saveSettings(state.settings, state.settings.hologramPreset);
  });
}
