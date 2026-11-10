// src/render/gestureOverlay.js
// Owns: the 2D feedback layer drawn over the stage - a glowing dot per pinch, a
// line between both pinch points while zooming with the current factor on it, a
// progress ring for the open-palm hold, and a crosshair for fist-pan.
//
// It is deliberately a 2D canvas rather than Three.js sprites: crisp text, cheap
// per-frame redraws, and no interaction with the 3D depth buffer.
//
// It reads GestureState and nothing else. The hold progress is measured here from
// how long the engine has reported 'palm-hold'; no gesture rules are duplicated.

import { PALM_HOLD_MS, palmCenter } from '../input/gestures.js';

const HOLOGRAM_RGB = '111, 224, 255';
const ACTIVE_RGB = '78, 242, 176';

/** Fade rate for every element, in 1/s. */
const FADE_RATE = 11;
/** Pinch dot radius, CSS px. */
const DOT_RADIUS = 7;
/** Palm-hold ring radius, CSS px. */
const RING_RADIUS = 34;
/** Crosshair arm length, CSS px. */
const CROSSHAIR_ARM = 16;

/**
 * @param {HTMLElement} container the stage element
 * @returns {{
 *   update: (gestureState: import('../input/gestures.js').GestureState|null, dt: number) => void,
 *   setVisible: (visible: boolean) => void,
 *   dispose: () => void,
 * }}
 */
export function createGestureOverlay(container) {
  const canvas = document.createElement('canvas');
  canvas.className = 'gesture-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const context = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let visible = true;

  /** Eased alphas per element. */
  const alpha = { pinch: 0, zoom: 0, hold: 0, fist: 0 };
  let holdMs = 0;
  /** Last painted state, used while a layer fades out. */
  let last = emptyFrame();

  /**
   * Keep the backing store in step with the stage. Re-checked every frame from
   * getBoundingClientRect(), because a size read once at construction can be
   * stale (the stage may not be laid out yet) and then every point lands in the
   * wrong place.
   * @returns {boolean} false when the stage has no size yet
   */
  function syncSize() {
    const rect = container.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.round(rect.width);
    const nextHeight = Math.round(rect.height);
    if (nextWidth === 0 || nextHeight === 0) return false;

    if (nextWidth === width && nextHeight === height && ratio === pixelRatio) return true;

    width = nextWidth;
    height = nextHeight;
    pixelRatio = ratio;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return true;
  }

  syncSize();

  /**
   * @param {import('../input/gestures.js').GestureState|null} gestureState
   * @param {number} dt seconds
   */
  function update(gestureState, dt) {
    if (!syncSize()) return;

    const hands = gestureState?.hands ?? [];
    const action = gestureState?.action ?? 'none';
    const pinching = hands.filter((hand) => hand?.pinch?.active);

    const fistHand = hands.find((hand) => hand?.fist) ?? null;
    const palmHand = hands.find((hand) => hand?.openPalm) ?? null;

    if (action === 'palm-hold') holdMs = Math.min(PALM_HOLD_MS, holdMs + dt * 1000);
    else holdMs = 0;

    last = {
      pinches: pinching.map((hand) => ({ ...hand.pinch.point })),
      zoom: pinching.length >= 2
        ? { from: { ...pinching[0].pinch.point }, to: { ...pinching[1].pinch.point }, factor: gestureState?.delta?.zoomFactor ?? 1 }
        : null,
      hold: palmHand ? { at: palmCenter(palmHand.landmarks), progress: Math.min(1, holdMs / PALM_HOLD_MS) } : null,
      fist: fistHand ? { at: palmCenter(fistHand.landmarks) } : null,
    };

    const step = 1 - Math.exp(-FADE_RATE * dt);
    const toward = (current, target) => current + (target - current) * step;

    alpha.pinch = toward(alpha.pinch, visible && last.pinches.length > 0 ? 1 : 0);
    alpha.zoom = toward(alpha.zoom, visible && last.zoom ? 1 : 0);
    alpha.hold = toward(alpha.hold, visible && last.hold ? 1 : 0);
    alpha.fist = toward(alpha.fist, visible && last.fist ? 1 : 0);

    draw();
  }

  function draw() {
    if (!context || width === 0) return;
    context.clearRect(0, 0, width, height);

    if (alpha.zoom > 0.01 && last.zoom) drawZoom(last.zoom, alpha.zoom);
    if (alpha.hold > 0.01 && last.hold) drawHold(last.hold, alpha.hold);
    if (alpha.fist > 0.01 && last.fist) drawFist(last.fist, alpha.fist);
    if (alpha.pinch > 0.01) {
      for (const point of last.pinches) drawPinchDot(point, alpha.pinch);
    }
  }

  /** @param {{x:number,y:number}} point @param {number} a */
  function drawPinchDot(point, a) {
    const x = point.x * width;
    const y = point.y * height;
    const colour = `rgba(${ACTIVE_RGB}, ${a})`;

    context.save();
    context.shadowColor = `rgba(${ACTIVE_RGB}, ${a * 0.9})`;
    context.shadowBlur = 18;

    context.beginPath();
    context.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
    context.fillStyle = colour;
    context.fill();

    // Outer ring, so the dot reads even over a bright model.
    context.beginPath();
    context.arc(x, y, DOT_RADIUS + 5, 0, Math.PI * 2);
    context.strokeStyle = `rgba(${ACTIVE_RGB}, ${a * 0.55})`;
    context.lineWidth = 1.4;
    context.stroke();
    context.restore();
  }

  /** @param {{from:{x:number,y:number}, to:{x:number,y:number}, factor:number}} zoom @param {number} a */
  function drawZoom(zoom, a) {
    const x1 = zoom.from.x * width;
    const y1 = zoom.from.y * height;
    const x2 = zoom.to.x * width;
    const y2 = zoom.to.y * height;

    context.save();
    context.shadowColor = `rgba(${HOLOGRAM_RGB}, ${a * 0.7})`;
    context.shadowBlur = 14;

    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.strokeStyle = `rgba(${HOLOGRAM_RGB}, ${a * 0.85})`;
    context.lineWidth = 2;
    context.setLineDash([7, 6]);
    context.stroke();
    context.setLineDash([]);

    // End caps.
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      context.beginPath();
      context.arc(x, y, DOT_RADIUS - 1, 0, Math.PI * 2);
      context.fillStyle = `rgba(${HOLOGRAM_RGB}, ${a})`;
      context.fill();
    }

    const label = `${zoom.factor.toFixed(2)}x`;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    context.font = '600 13px ui-monospace, "Cascadia Mono", monospace';
    const padding = 7;
    const textWidth = context.measureText(label).width;

    context.beginPath();
    roundRect(context, midX - textWidth / 2 - padding, midY - 12, textWidth + padding * 2, 24, 8);
    context.fillStyle = `rgba(6, 12, 20, ${a * 0.85})`;
    context.fill();
    context.strokeStyle = `rgba(${HOLOGRAM_RGB}, ${a * 0.5})`;
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = `rgba(228, 251, 255, ${a})`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, midX, midY);
    context.restore();
  }

  /** @param {{at:{x:number,y:number}, progress:number}} hold @param {number} a */
  function drawHold(hold, a) {
    const x = hold.at.x * width;
    const y = hold.at.y * height;
    const start = -Math.PI / 2;

    context.save();
    context.shadowColor = `rgba(${HOLOGRAM_RGB}, ${a * 0.8})`;
    context.shadowBlur = 16;

    // Track.
    context.beginPath();
    context.arc(x, y, RING_RADIUS, 0, Math.PI * 2);
    context.strokeStyle = `rgba(${HOLOGRAM_RGB}, ${a * 0.22})`;
    context.lineWidth = 3;
    context.stroke();

    // Progress arc.
    if (hold.progress > 0) {
      context.beginPath();
      context.arc(x, y, RING_RADIUS, start, start + Math.PI * 2 * hold.progress);
      context.strokeStyle = `rgba(${ACTIVE_RGB}, ${a})`;
      context.lineWidth = 3;
      context.lineCap = 'round';
      context.stroke();
    }

    // Centre dot so the ring is anchored to something.
    context.beginPath();
    context.arc(x, y, 3, 0, Math.PI * 2);
    context.fillStyle = `rgba(${HOLOGRAM_RGB}, ${a * 0.9})`;
    context.fill();
    context.restore();
  }

  /** @param {{at:{x:number,y:number}}} fist @param {number} a */
  function drawFist(fist, a) {
    const x = fist.at.x * width;
    const y = fist.at.y * height;
    const arm = CROSSHAIR_ARM;

    context.save();
    context.shadowColor = `rgba(${HOLOGRAM_RGB}, ${a * 0.8})`;
    context.shadowBlur = 12;
    context.strokeStyle = `rgba(${HOLOGRAM_RGB}, ${a})`;
    context.lineWidth = 2;
    context.lineCap = 'round';

    // Four arrows pointing outwards: "this moves the model around".
    const arrows = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of arrows) {
      const inner = 6;
      context.beginPath();
      context.moveTo(x + dx * inner, y + dy * inner);
      context.lineTo(x + dx * (inner + arm), y + dy * (inner + arm));
      context.stroke();

      // Arrow head.
      const tipX = x + dx * (inner + arm);
      const tipY = y + dy * (inner + arm);
      const head = 5;
      context.beginPath();
      if (dx !== 0) {
        context.moveTo(tipX - dx * head, tipY - head);
        context.lineTo(tipX, tipY);
        context.lineTo(tipX - dx * head, tipY + head);
      } else {
        context.moveTo(tipX - head, tipY - dy * head);
        context.lineTo(tipX, tipY);
        context.lineTo(tipX + head, tipY - dy * head);
      }
      context.stroke();
    }

    context.beginPath();
    context.arc(x, y, 3.5, 0, Math.PI * 2);
    context.fillStyle = `rgba(${HOLOGRAM_RGB}, ${a})`;
    context.fill();
    context.restore();
  }

  function setVisible(next) {
    visible = Boolean(next);
    canvas.style.opacity = visible ? '1' : '0';
  }

  function dispose() {
    canvas.remove();
  }

  return { update, setVisible, dispose };
}

/** An empty frame, so the first fade-out has nothing stale to draw. */
function emptyFrame() {
  return { pinches: [], zoom: null, hold: null, fist: null };
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r
 */
function roundRect(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}
