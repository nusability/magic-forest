import { TUNING } from './tuning';

// A CPU twin of NOISE_GLSL + FERTILE_GLSL (glsl.ts), so the simulation agrees with the meadow the
// shaders draw. Keep the two in step.

const fract = (x: number): number => x - Math.floor(x);

function hash12(x: number, y: number): number {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

function fbm(x: number, y: number): number {
  let v = 0, amp = 0.5;
  for (let i = 0; i < 4; i++) {
    v += amp * valueNoise(x, y);
    x *= 2.03; y *= 2.03; amp *= 0.5;
  }
  return v;
}

/** The meadow's ragged edge radius in the direction of (x, z). */
export function fertileEdge(x: number, z: number): number {
  const { fertileRadius, edgeNoise } = TUNING.level;
  return fertileRadius + (fbm(x * 0.06, z * 0.06) - 0.5) * 2 * edgeNoise;
}

export function isFertile(x: number, z: number): boolean {
  return Math.hypot(x, z) < fertileEdge(x, z);
}
