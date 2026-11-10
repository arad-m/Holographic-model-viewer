// src/render/hologramMaterial.js
// Owns: the hologram look. Builds the ShaderMaterial (fresnel rim, scrolling
// horizontal scanlines, flicker, occasional glitch jitter, additive blending)
// and the optional faint wireframe overlay material, and exposes the per-frame
// uniform update. Replaces a loaded model's materials, so it also owns disposing
// them.
//
// Pure with respect to app state: uniforms go in, nothing here reads `state`,
// the DOM or raw landmarks.
//
// Exposed uniforms (all drivable from later phases):
//   uColor, uRimPower, uRimIntensity, uScanDensity, uScanSpeed, uFlicker,
//   uGlitch, uOpacity, uFill, uTime

import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three';

/** Default hologram look. Blue-cyan, additive, transparent, depth-write off. */
export const HOLOGRAM_DEFAULTS = Object.freeze({
  color: 0x6fe0ff,
  // rimColor tints the fresnel rim only, which is what makes a two-tone preset
  // (gold body, red silhouette) possible from one shader.
  rimColor: 0x6fe0ff,
  rimPower: 2.6,
  rimIntensity: 1.05,
  scanDensity: 28,
  scanSpeed: 1.4,
  flicker: 0.14,
  glitch: 0.5,
  opacity: 0.56,
  fill: 0.07,
  wireframe: true,
  wireframeOpacity: 0.07,
});

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uGlitch;

  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  // Slice mode clips on the GPU. The chunks below are three.js's own, so the
  // uniforms, defines and varying names all match what the renderer injects.
  #include <clipping_planes_pars_vertex>

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    vec3 displaced = position;

    // Glitch: short-lived horizontal displacement of a few horizontal slices.
    float slice = floor(position.y * 14.0);
    float frame = floor(uTime * 9.0);
    float burst = step(0.90, hash11(slice * 0.37 + frame * 1.91)) * uGlitch;
    displaced.x += (hash11(slice + frame * 7.3) - 0.5) * 0.075 * burst;

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewPosition = mvPosition.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    vWorldPosition = (modelMatrix * vec4(displaced, 1.0)).xyz;

    gl_Position = projectionMatrix * mvPosition;

    // The chunk reads mvPosition, so it must come after it exists.
    #include <clipping_planes_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uRimColor;
  uniform float uRimPower;
  uniform float uRimIntensity;
  uniform float uScanDensity;
  uniform float uScanSpeed;
  uniform float uFlicker;
  uniform float uGlitch;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uTime;

  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  #include <clipping_planes_pars_fragment>

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    // Discard everything the slice plane removes, before any shading work.
    #include <clipping_planes_fragment>

    vec3 normal = normalize(vViewNormal);
    vec3 viewDir = normalize(-vViewPosition);
    float facing = clamp(abs(dot(normal, viewDir)), 0.0, 1.0);

    // Fresnel rim: bright silhouette, hollow centre.
    float rim = pow(1.0 - facing, uRimPower) * uRimIntensity;

    // Scanlines locked to the model so they slide as it rotates. Thin and
    // dim by design: stacked additive edges otherwise clip to white.
    float scanPhase = vWorldPosition.y * uScanDensity - uTime * uScanSpeed;
    float scan = pow(0.5 + 0.5 * sin(scanPhase), 16.0) * 0.9;

    // Flicker: gentle breathing plus a rare full-surface dropout.
    float flicker = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 23.0));
    float dropout = step(0.995, hash12(vec2(floor(uTime * 12.0), 3.7))) * uGlitch;

    // Glitch bands: a few bright rows that jump between frames.
    float row = floor(vWorldPosition.y * 90.0);
    float glitchRow = step(0.94, hash12(vec2(row, floor(uTime * 11.0)))) * uGlitch;

    vec3 surfaceColor = mix(uColor, uRimColor, clamp(rim * 0.9, 0.0, 1.0));
    vec3 color = surfaceColor * (uFill + rim + scan + glitchRow * 1.6);
    float alpha = clamp(uOpacity * (0.22 + rim + scan * 0.8 + glitchRow), 0.0, 1.0);
    alpha *= flicker * (1.0 - dropout * 0.65);

    gl_FragColor = vec4(color * flicker, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * @param {Partial<typeof HOLOGRAM_DEFAULTS>} [options]
 * @returns {ShaderMaterial}
 */
export function createHologramMaterial(options = {}) {
  const config = { ...HOLOGRAM_DEFAULTS, ...options };

  return new ShaderMaterial({
    name: 'HologramMaterial',
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: new Color(config.color) },
      uRimColor: { value: new Color(config.rimColor) },
      uRimPower: { value: config.rimPower },
      uRimIntensity: { value: config.rimIntensity },
      uScanDensity: { value: config.scanDensity },
      uScanSpeed: { value: config.scanSpeed },
      uFlicker: { value: config.flicker },
      uGlitch: { value: config.glitch },
      uOpacity: { value: config.opacity },
      uFill: { value: config.fill },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/**
 * The faint wireframe shell drawn over the hologram surface.
 * @param {Partial<typeof HOLOGRAM_DEFAULTS>} [options]
 */
export function createWireframeOverlayMaterial(options = {}) {
  const config = { ...HOLOGRAM_DEFAULTS, ...options };

  return new ShaderMaterial({
    name: 'HologramWireframe',
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uColor: { value: new Color(config.color) },
      uRimColor: { value: new Color(config.rimColor) },
      uRimPower: { value: 1.0 },
      uRimIntensity: { value: 0.0 },
      uScanDensity: { value: config.scanDensity * 0.5 },
      uScanSpeed: { value: config.scanSpeed },
      uFlicker: { value: config.flicker * 0.5 },
      uGlitch: { value: config.glitch * 0.35 },
      uOpacity: { value: config.wireframeOpacity },
      uFill: { value: 0.22 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    wireframe: true,
  });
}

/**
 * Advance the time uniform; called once per frame for every live material.
 * @param {ShaderMaterial} material
 * @param {{ time: number }} clock
 */
export function updateHologramUniforms(material, { time }) {
  if (!material || !material.uniforms || !material.uniforms.uTime) return;
  material.uniforms.uTime.value = time;
}

/**
 * Change exposed knobs on an existing material (settings panel, presets, ...).
 * @param {ShaderMaterial} material
 * @param {{ color?: number|string, rimColor?: number|string, rimPower?: number,
 *           rimIntensity?: number, scanDensity?: number, flicker?: number }} patch
 */
export function applyHologramOptions(material, patch) {
  if (!material || !material.uniforms || !patch) return;
  const uniforms = material.uniforms;
  if (patch.color !== undefined && uniforms.uColor) uniforms.uColor.value.set(patch.color);
  if (patch.rimColor !== undefined && uniforms.uRimColor) uniforms.uRimColor.value.set(patch.rimColor);
  if (Number.isFinite(patch.rimPower) && uniforms.uRimPower) uniforms.uRimPower.value = patch.rimPower;
  if (Number.isFinite(patch.rimIntensity) && uniforms.uRimIntensity) {
    uniforms.uRimIntensity.value = patch.rimIntensity;
  }
  if (Number.isFinite(patch.scanDensity) && uniforms.uScanDensity) {
    uniforms.uScanDensity.value = patch.scanDensity;
  }
  if (Number.isFinite(patch.flicker) && uniforms.uFlicker) uniforms.uFlicker.value = patch.flicker;
}

/**
 * Set the world-space clipping planes for a material (Slice mode). Passing null
 * or an empty array turns clipping off again.
 *
 * three.js recompiles the shader when the PLANE COUNT changes, so callers keep
 * one stable Plane and one stable array: updating the plane in place costs
 * nothing, while pushing or splicing would recompile every material.
 *
 * @param {import('three').Material|null|undefined} material
 * @param {import('three').Plane[]|null} planes
 */
export function setClippingPlanes(material, planes) {
  if (!material) return;
  const next = planes && planes.length > 0 ? planes : null;
  if (material.clippingPlanes === next) return;
  material.clippingPlanes = next;
}

/**
 * Dispose a material and any textures it references. Safe on null.
 * @param {import('three').Material|null|undefined} material
 */
export function disposeMaterial(material) {
  if (!material || typeof material.dispose !== 'function') return;
  for (const value of Object.values(material)) {
    if (value && value.isTexture && !value.userData?.shared && typeof value.dispose === 'function') {
      value.dispose();
    }
  }
  material.dispose();
}
