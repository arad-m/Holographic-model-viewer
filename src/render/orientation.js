// src/render/orientation.js
// Owns: free orientation of the model. Pure quaternion math, no Three.js.
//
// The old transform stored two Euler angles and left roll at 0. Horizontal
// drag therefore always spun the same upright axis, and vertical drag could
// not carry the model past a fixed tilt. A screen-space tumble compounds:
// drag right spins around the view's up, drag down around the view's right,
// and doing both (in either order) can face the model any direction.

/** No rotation. */
export const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/**
 * @param {{ qx?: number, qy?: number, qz?: number, qw?: number }|null|undefined} transform
 * @returns {{ x: number, y: number, z: number, w: number }}
 */
export function readQuat(transform) {
  const x = Number.isFinite(transform?.qx) ? transform.qx : 0;
  const y = Number.isFinite(transform?.qy) ? transform.qy : 0;
  const z = Number.isFinite(transform?.qz) ? transform.qz : 0;
  const w = Number.isFinite(transform?.qw) ? transform.qw : 1;
  return normalize({ x, y, z, w });
}

/**
 * @param {{ x: number, y: number, z: number, w: number }} q
 * @returns {{ qx: number, qy: number, qz: number, qw: number }}
 */
export function quatPatch(q) {
  return { qx: q.x, qy: q.y, qz: q.z, qw: q.w };
}

/**
 * Screen-space tumble. `pitch` is about the view's right axis (old rotX sign),
 * `yaw` about the view's up axis (old rotY sign). Premultiplying keeps those
 * axes on the screen, so a later sideways drag is not stuck to the model's
 * original upright.
 *
 * @param {{ x: number, y: number, z: number, w: number }} q
 * @param {number} pitch radians
 * @param {number} yaw radians
 */
export function tumble(q, pitch, yaw) {
  const dp = Number.isFinite(pitch) ? pitch : 0;
  const dy = Number.isFinite(yaw) ? yaw : 0;
  if (dp === 0 && dy === 0) return q;
  const delta = multiply(fromAxisAngle(0, 1, 0, dy), fromAxisAngle(1, 0, 0, dp));
  return normalize(multiply(delta, q));
}

/**
 * @param {{ qx?: number, qy?: number, qz?: number, qw?: number }} transform
 * @param {number} pitch
 * @param {number} yaw
 */
export function tumbleTransform(transform, pitch, yaw) {
  return quatPatch(tumble(readQuat(transform), pitch, yaw));
}

/**
 * Shortest-path blend. `t` is 0 at `a` and 1 at `b`.
 * @param {{ x: number, y: number, z: number, w: number }} a
 * @param {{ x: number, y: number, z: number, w: number }} b
 * @param {number} t
 */
export function slerp(a, b, t) {
  const amount = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.9995) {
    return normalize({
      x: a.x + (bx - a.x) * amount,
      y: a.y + (by - a.y) * amount,
      z: a.z + (bz - a.z) * amount,
      w: a.w + (bw - a.w) * amount,
    });
  }
  const theta = Math.acos(Math.min(1, cos));
  const sin = Math.sin(theta);
  const w1 = Math.sin((1 - amount) * theta) / sin;
  const w2 = Math.sin(amount * theta) / sin;
  return {
    x: a.x * w1 + bx * w2,
    y: a.y * w1 + by * w2,
    z: a.z * w1 + bz * w2,
    w: a.w * w1 + bw * w2,
  };
}

/** Radians away from no rotation. */
export function angleOf(q) {
  const w = Math.min(1, Math.abs(q.w));
  return 2 * Math.acos(w);
}

/**
 * One coast step. The returned angles are what to apply this frame; `velocity`
 * is the slowed rate for the next one. Below `stop` rad/s the throw is done.
 *
 * @param {{ pitch: number, yaw: number }} velocity rad/s
 * @param {number} dt seconds
 * @param {number} damping 1/s
 * @param {number} stop rad/s
 */
export function coastStep(velocity, dt, damping, stop) {
  const pitchRate = Number.isFinite(velocity?.pitch) ? velocity.pitch : 0;
  const yawRate = Number.isFinite(velocity?.yaw) ? velocity.yaw : 0;
  const speed = Math.hypot(pitchRate, yawRate);
  if (!(dt > 0) || !(speed > stop)) {
    return { pitch: 0, yaw: 0, velocity: { pitch: 0, yaw: 0 } };
  }
  const decay = Math.exp(-damping * dt);
  const nextPitch = pitchRate * decay;
  const nextYaw = yawRate * decay;
  const nextSpeed = Math.hypot(nextPitch, nextYaw);
  return {
    pitch: pitchRate * dt,
    yaw: yawRate * dt,
    velocity: nextSpeed > stop ? { pitch: nextPitch, yaw: nextYaw } : { pitch: 0, yaw: 0 },
  };
}

/**
 * @param {{ x: number, y: number, z: number, w: number }} q
 * @param {{ x: number, y: number, z: number }} v
 */
export function rotateVector(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

/** @param {{ x: number, y: number, z: number, w: number }} q */
function normalize(q) {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < 1e-8) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

function fromAxisAngle(ax, ay, az, angle) {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(half) };
}

function multiply(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
