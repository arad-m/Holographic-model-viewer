// src/render/handSkeleton.js
// Owns: the glowing hand wireframe drawn inside the 3D scene, in the hologram
// colour, floating between the camera and the model.
//
// Landmarks arrive in MIRROR SPACE (x already flipped once upstream), so they are
// mapped straight onto a fixed plane in front of the model - no second flip here.
// Each hand gets a stable slot, so two hands never swap meshes mid-track, and a
// lost hand fades out instead of popping.
//
// It reads only HandState from state.gesture: no gesture logic lives here.

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three';

/** Hologram cyan, the same family as the shader. */
const SKELETON_COLOR = 0x6fe0ff;
/** Width of the mapping plane in world units (4:3, matching the camera feed). */
const PLANE_WIDTH = 2.4;
const PLANE_HEIGHT = PLANE_WIDTH * 0.75;
/** Depth of the plane: between the model (z=0) and the camera (z=4.6). */
const PLANE_Z = 1.15;
/** Landmarks per hand. */
const LANDMARKS = 21;
/** MediaPipe's hand bone list, as index pairs into the 21 landmarks. */
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** How fast a hand fades in/out, in 1/s. */
const FADE_RATE = 9;
/** How many hands can be drawn at once. */
const MAX_HANDS = 2;

/**
 * @param {import('three').Scene} scene
 * @param {{ color?: number }} [options]
 * @returns {{
 *   update: (hands: Array<{ id: string, landmarks: Array<{x:number,y:number}> }>, dt: number) => void,
 *   setVisible: (visible: boolean) => void,
 *   isVisible: () => boolean,
 *   dispose: () => void,
 * }}
 */
export function createHandSkeleton(scene, options = {}) {
  const color = options.color ?? SKELETON_COLOR;
  const group = new Group();
  group.name = 'hand-skeleton';
  scene.add(group);

  const glowTexture = createGlowTexture();
  const slots = Array.from({ length: MAX_HANDS }, () => createHandSlot(color, glowTexture));
  for (const slot of slots) group.add(slot.object);

  let visible = true;
  /** @type {Map<string, number>} hand id -> slot index */
  const slotByHandId = new Map();

  /** @param {string} handId */
  function slotFor(handId) {
    if (slotByHandId.has(handId)) return slots[slotByHandId.get(handId)];

    // Take a free slot first, then the one that has faded out the most.
    let chosen = -1;
    for (let index = 0; index < slots.length; index += 1) {
      if (!slots[index].claimed) {
        chosen = index;
        break;
      }
    }
    if (chosen === -1) {
      chosen = 0;
      for (let index = 1; index < slots.length; index += 1) {
        if (slots[index].alpha < slots[chosen].alpha) chosen = index;
      }
      slotByHandId.delete(slots[chosen].handId);
    }

    slots[chosen].claimed = true;
    slots[chosen].handId = handId;
    slotByHandId.set(handId, chosen);
    return slots[chosen];
  }

  /**
   * @param {Array<{ id: string, landmarks: Array<{x:number,y:number}> }>} hands
   * @param {number} dt seconds
   */
  function update(hands, dt) {
    const seen = new Set();

    for (const hand of hands ?? []) {
      if (!Array.isArray(hand?.landmarks) || hand.landmarks.length < LANDMARKS) continue;
      seen.add(hand.id);
      const slot = slotFor(hand.id);
      slot.write(hand.landmarks);
      slot.target = visible ? 1 : 0;
    }

    for (const slot of slots) {
      if (!slot.claimed) continue;
      if (!seen.has(slot.handId)) {
        slot.target = 0;
        // A hand that has fully faded releases its slot for the next one.
        if (slot.alpha <= 0.01) {
          slot.claimed = false;
          slotByHandId.delete(slot.handId);
          slot.handId = '';
        }
      }
      slot.fade(dt);
    }
  }

  /** @param {boolean} next */
  function setVisible(next) {
    visible = Boolean(next);
    group.visible = visible;
    if (!visible) {
      for (const slot of slots) {
        slot.alpha = 0;
        slot.target = 0;
        slot.applyOpacity();
      }
    }
  }

  function dispose() {
    for (const slot of slots) slot.dispose();
    glowTexture.dispose();
    scene.remove(group);
  }

  return { update, setVisible, isVisible: () => visible, dispose };
}

/**
 * One hand: a bright core of points, a faint larger halo, and the bone lines.
 * @param {number} color
 * @param {CanvasTexture} glowTexture
 */
function createHandSlot(color, glowTexture) {
  // One shared position attribute. Float32BufferAttribute COPIES the array it is
  // handed, so points and bones must reference the same attribute instance - and
  // every write must go into that attribute's own array, otherwise the hand stays
  // collapsed at the origin.
  const positionAttribute = new Float32BufferAttribute(new Float32Array(LANDMARKS * 3), 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positionAttribute);

  const boneIndices = [];
  for (const [from, to] of BONES) boneIndices.push(from, to);
  const boneGeometry = new BufferGeometry();
  boneGeometry.setAttribute('position', positionAttribute);
  boneGeometry.setIndex(boneIndices);

  const coreMaterial = new PointsMaterial({
    color,
    size: 13,
    map: glowTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    sizeAttenuation: false,
  });

  const haloMaterial = new PointsMaterial({
    color,
    size: 30,
    map: glowTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    sizeAttenuation: false,
  });

  const boneMaterial = new LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });

  const core = new Points(geometry, coreMaterial);
  const halo = new Points(geometry, haloMaterial);
  const bones = new LineSegments(boneGeometry, boneMaterial);
  core.frustumCulled = false;
  halo.frustumCulled = false;
  bones.frustumCulled = false;

  const object = new Group();
  object.add(bones, halo, core);
  object.visible = false;

  const slot = {
    object,
    handId: '',
    claimed: false,
    alpha: 0,
    target: 0,

    /**
     * Map mirror-space landmarks onto the plane in front of the model.
     * @param {Array<{x:number,y:number}>} landmarks
     */
    write(landmarks) {
      const target = positionAttribute.array;
      for (let index = 0; index < LANDMARKS; index += 1) {
        const point = landmarks[index] ?? { x: 0.5, y: 0.5 };
        const offset = index * 3;
        target[offset] = (point.x - 0.5) * PLANE_WIDTH;
        target[offset + 1] = (0.5 - point.y) * PLANE_HEIGHT;
        target[offset + 2] = PLANE_Z;
      }
      positionAttribute.needsUpdate = true;
    },

    /** @param {number} dt */
    fade(dt) {
      const step = 1 - Math.exp(-FADE_RATE * dt);
      slot.alpha += (slot.target - slot.alpha) * step;
      if (slot.alpha < 0.004) slot.alpha = 0;
      if (slot.alpha > 0.996) slot.alpha = 1;
      slot.applyOpacity();
      object.visible = slot.alpha > 0.01;
    },

    applyOpacity() {
      coreMaterial.opacity = slot.alpha;
      haloMaterial.opacity = slot.alpha * 0.22;
      boneMaterial.opacity = slot.alpha * 0.55;
    },

    dispose() {
      geometry.dispose();
      boneGeometry.dispose();
      coreMaterial.dispose();
      haloMaterial.dispose();
      boneMaterial.dispose();
      object.removeFromParent();
    },
  };

  return slot;
}

/** A soft radial dot, generated once - no image asset needed. */
function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(190,245,255,0.75)');
  gradient.addColorStop(1, 'rgba(120,220,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
