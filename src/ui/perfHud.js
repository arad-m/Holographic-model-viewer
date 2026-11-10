// src/ui/perfHud.js
// Owns: the small performance readout - measured frame rate, the active quality
// level, and (when parallax is on) its status plus a Recalibrate button.
//
// Presentational only: it renders what it is told and reports the one intent it
// has (recalibrate). main.js owns the numbers, the quality decision and the
// calibration itself.

const RECALIBRATE_LABEL = 'Recalibrate';

/**
 * @param {HTMLElement} container
 * @param {{ onRecalibrate?: () => void }} [handlers]
 */
export function createPerfHud(container, { onRecalibrate } = {}) {
  const element = document.createElement('div');
  element.className = 'perf-hud';
  element.hidden = true;

  const fpsRow = document.createElement('div');
  fpsRow.className = 'perf-fps';

  const fpsValue = document.createElement('span');
  fpsValue.className = 'perf-fps-value';
  fpsValue.textContent = '—';

  const fpsUnit = document.createElement('span');
  fpsUnit.className = 'perf-fps-unit';
  fpsUnit.textContent = 'fps';

  const qualityValue = document.createElement('span');
  qualityValue.className = 'perf-quality';

  fpsRow.append(fpsValue, fpsUnit, qualityValue);

  const parallaxRow = document.createElement('div');
  parallaxRow.className = 'perf-parallax';
  parallaxRow.hidden = true;

  const parallaxStatus = document.createElement('span');
  parallaxStatus.className = 'perf-parallax-status';
  parallaxStatus.textContent = 'Parallax off';

  const recalibrateButton = document.createElement('button');
  recalibrateButton.type = 'button';
  recalibrateButton.className = 'perf-recalibrate';
  recalibrateButton.textContent = RECALIBRATE_LABEL;
  recalibrateButton.title = 'Treat where you are sitting now as neutral';

  parallaxRow.append(parallaxStatus, recalibrateButton);
  element.append(fpsRow, parallaxRow);
  container.appendChild(element);

  let showFps = false;
  let showParallax = false;

  function refreshVisibility() {
    element.hidden = !showFps && !showParallax;
    fpsRow.hidden = !showFps;
    parallaxRow.hidden = !showParallax;
  }

  function handleRecalibrate() {
    if (typeof onRecalibrate === 'function') onRecalibrate();
  }
  recalibrateButton.addEventListener('click', handleRecalibrate);

  return {
    /** @param {number} fps @param {string} [qualityLabel] */
    setStats(fps, qualityLabel = '') {
      const rounded = Number.isFinite(fps) ? Math.round(fps) : 0;
      // A slow machine can otherwise show a 4-digit frame rate for one frame.
      fpsValue.textContent = String(Math.min(Math.max(rounded, 0), 999));
      qualityValue.textContent = qualityLabel;
      fpsRow.dataset.level = qualityLabel.toLowerCase();
    },
    /** @param {'off'|'no-face'|'tracking'|'starting'} status @param {string} [detail] */
    setParallaxStatus(status, detail = '') {
      if (status === 'tracking') {
        parallaxStatus.textContent = detail || 'Face recognized';
        parallaxRow.dataset.status = 'tracking';
        return;
      }
      if (status === 'starting') {
        parallaxStatus.textContent = 'Looking for a face…';
        parallaxRow.dataset.status = 'no-face';
        return;
      }
      if (status === 'no-face') {
        parallaxStatus.textContent = 'No face';
        parallaxRow.dataset.status = 'no-face';
        return;
      }
      parallaxStatus.textContent = 'Parallax off';
      parallaxRow.dataset.status = 'off';
    },
    /** @param {{ fps?: boolean, parallax?: boolean }} visibility */
    setVisible({ fps = false, parallax = false } = {}) {
      showFps = Boolean(fps);
      showParallax = Boolean(parallax);
      refreshVisibility();
    },
    element,
    dispose() {
      recalibrateButton.removeEventListener('click', handleRecalibrate);
      element.remove();
    },
  };
}
