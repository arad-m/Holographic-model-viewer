// src/library/thumbnail.js
// Owns: turning the live WebGL canvas into a small square preview for a library
// card.
//
// It reads the canvas that is already on screen - no second render, no render
// target - because a thumbnail only has to look like the model did when it was
// loaded. The frame is centre-cropped to a square (cards are square) and encoded
// as JPEG, which is ~10x smaller than PNG for a glowing gradient.
//
// Returns null instead of throwing: a thumbnail is a nicety, never a reason to
// fail a model load.

import { THUMBNAIL_SIZE } from '../capture/frames.js';

/** JPEG quality for card previews: small enough to store, sharp enough to read. */
export const THUMBNAIL_QUALITY = 0.72;

/**
 * @param {HTMLCanvasElement|null} sourceCanvas
 * @param {{ size?: number, quality?: number }} [options]
 * @returns {string|null} a data URL, or null when the canvas has no pixels
 */
export function captureThumbnail(sourceCanvas, { size = THUMBNAIL_SIZE, quality = THUMBNAIL_QUALITY } = {}) {
  if (!sourceCanvas) return null;

  const sourceWidth = sourceCanvas.width || 0;
  const sourceHeight = sourceCanvas.height || 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  if (typeof document === 'undefined') return null;

  const edge = Math.max(16, Math.round(Number.isFinite(size) ? size : THUMBNAIL_SIZE));
  const side = Math.min(sourceWidth, sourceHeight);
  const sourceX = Math.floor((sourceWidth - side) / 2);
  const sourceY = Math.floor((sourceHeight - side) / 2);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(sourceCanvas, sourceX, sourceY, side, side, 0, 0, edge, edge);

    return canvas.toDataURL('image/jpeg', quality);
  } catch (error) {
    // A lost context or a blocked encoder: no thumbnail, no failure.
    console.warn('Could not capture a thumbnail', error);
    return null;
  }
}
