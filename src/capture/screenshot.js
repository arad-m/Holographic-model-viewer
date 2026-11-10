// src/capture/screenshot.js
// Owns: one PNG of the hologram view.
//
// It renders the scene into an offscreen render target and reads the pixels
// back, rather than calling canvas.toDataURL(). Two reasons:
//   1. it never depends on preserveDrawingBuffer (which the viewer does not set),
//   2. a render target keeps its alpha channel even though the on-screen context
//      was created with alpha: false, so a transparent background is possible
//      without rebuilding the renderer.
//
// The DOM (toolbar, panels, overlay canvas, camera preview) is not part of the
// WebGL canvas at all, so a capture never contains any UI.

import { Color, RGBAFormat, UnsignedByteType, WebGLRenderTarget } from 'three';
import { MAX_SCREENSHOT_EDGE, fitCaptureSize } from './frames.js';

/**
 * @typedef {Object} CaptureInput
 * @property {import('three').WebGLRenderer} renderer
 * @property {import('three').Scene} scene
 * @property {import('three').Camera} camera
 * @property {boolean} [transparent] keep the background transparent
 * @property {number} [maxEdge] longest edge, defaults to 4096
 * @property {(() => void)} [prepare] run before the capture render (hide helpers)
 * @property {(() => void)} [cleanup] run after it, even on failure
 */

/**
 * @param {CaptureInput} input
 * @returns {Promise<{ blob: Blob, width: number, height: number }|null>}
 *   null when there is nothing to capture
 */
export async function captureScreenshot({
  renderer,
  scene,
  camera,
  transparent = false,
  maxEdge = MAX_SCREENSHOT_EDGE,
  prepare,
  cleanup,
}) {
  const canvas = renderer?.domElement;
  if (!canvas || !scene || !camera) return null;

  const sourceWidth = canvas.width || canvas.clientWidth || 0;
  const sourceHeight = canvas.height || canvas.clientHeight || 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  const size = fitCaptureSize(sourceWidth, sourceHeight, maxEdge);
  const buffer = new Uint8Array(size.width * size.height * 4);

  const previousTarget = renderer.getRenderTarget();
  const previousClearColor = renderer.getClearColor(new Color());
  const previousClearAlpha = renderer.getClearAlpha();
  const target = new WebGLRenderTarget(size.width, size.height, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });

  try {
    if (typeof prepare === 'function') prepare();

    renderer.setRenderTarget(target);
    renderer.setClearAlpha(transparent ? 0 : 1);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size.width, size.height, buffer);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.setClearAlpha(previousClearAlpha);
    target.dispose();
    if (typeof cleanup === 'function') cleanup();
  }

  const blob = await pixelsToPngBlob(buffer, size.width, size.height, transparent);
  if (!blob) return null;
  return { blob, width: size.width, height: size.height };
}

/**
 * Bottom-up RGBA pixels from the GPU become a top-down PNG.
 *
 * The hologram is drawn with additive blending, so the framebuffer holds
 * premultiplied colour: a faint glow has a small alpha and a proportionally
 * small colour. PNG stores straight alpha, so alpha is divided back out (and
 * clamped) when the background is transparent - otherwise every glow would
 * look washed out on a light backdrop.
 *
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {boolean} transparent
 * @returns {Promise<Blob|null>}
 */
export async function pixelsToPngBlob(pixels, width, height, transparent) {
  if (!pixels || width <= 0 || height <= 0) return null;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const image = context.createImageData(width, height);
  const rowBytes = width * 4;

  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * rowBytes;
    const destination = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 4) {
      const r = pixels[source + x];
      const g = pixels[source + x + 1];
      const b = pixels[source + x + 2];
      const a = pixels[source + x + 3];

      if (!transparent) {
        image.data[destination + x] = r;
        image.data[destination + x + 1] = g;
        image.data[destination + x + 2] = b;
        image.data[destination + x + 3] = 255;
        continue;
      }

      if (a === 0) {
        image.data[destination + x] = 0;
        image.data[destination + x + 1] = 0;
        image.data[destination + x + 2] = 0;
        image.data[destination + x + 3] = 0;
        continue;
      }

      // Un-premultiply, clamped: a bright, faint pixel is a bright pixel.
      const scale = 255 / a;
      image.data[destination + x] = Math.min(255, Math.round(r * scale));
      image.data[destination + x + 1] = Math.min(255, Math.round(g * scale));
      image.data[destination + x + 2] = Math.min(255, Math.round(b * scale));
      image.data[destination + x + 3] = a;
    }
  }

  context.putImageData(image, 0, 0);

  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob ?? null), 'image/png');
  });
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob, filename) {
  if (!blob || typeof document === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
