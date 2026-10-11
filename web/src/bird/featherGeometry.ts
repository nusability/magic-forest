import * as THREE from 'three';
import { CONTOUR_VANE, VANE } from './constants';

// A feather is drawn once as a unit grid and shaped per instance in the shader. Local frame:
// the shaft runs along +z from 0 (quill) to 1 (tip), the vanes spread along x from -1 (inner
// vane) to +1 (outer vane), and +y is the feather's upper surface. The shader scales x and y by
// each vane's real half-width, so one geometry serves asymmetric primaries and broad coverts.

/** Width of a flight feather's vane at share t along the shaft, 1 at its widest. */
export function vaneProfile(t: number): number {
  const base = VANE.calamus + (1 - VANE.calamus) * THREE.MathUtils.smoothstep(t, 0, VANE.vaneStart);
  const r = Math.max(0, (t - VANE.taperStart) / (1 - VANE.taperStart));
  const tip = Math.sqrt(Math.max(0, 1 - Math.pow(r, VANE.taperSharpness)));
  return base * Math.max(tip, VANE.tipWidth);
}

/** Width of a rounded body contour feather at share t along its shaft. */
export function contourProfile(t: number): number {
  const c = CONTOUR_VANE;
  const base = c.baseWidth + (1 - c.baseWidth) * THREE.MathUtils.smoothstep(t, 0, c.roundStart);
  const r = Math.max(0, (t - c.roundStart) / (1 - c.roundStart));
  return base * Math.max(Math.sqrt(Math.max(0, 1 - r * r)), c.tipWidth);
}

interface VaneSpec {
  rows: readonly number[];
  columns: readonly number[];
  profile: (t: number) => number;
  cup: number;
  ridge: number;
}

function buildVane(spec: VaneSpec): THREE.BufferGeometry {
  const { rows, columns } = spec;
  const positions: number[] = [];
  const feather: number[] = [];
  for (const t of rows) {
    const w = spec.profile(t);
    for (const s of columns) {
      // The cup and the ridge are in half-width units like x, so they scale with the vane.
      const y = -spec.cup * s * s * w + spec.ridge * w * Math.max(0, 1 - Math.abs(s) * 4);
      positions.push(s * w, y, t);
      feather.push(t, s);
    }
  }
  const index: number[] = [];
  const nc = columns.length;
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j;
      const b = a + 1;
      const c = a + nc;
      const d = c + 1;
      // Wound so the face normal is +y, the feather's upper side.
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFeather', new THREE.Float32BufferAttribute(feather, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

export function flightFeatherGeometry(): THREE.BufferGeometry {
  return buildVane({ rows: VANE.rows, columns: VANE.columns, profile: vaneProfile, cup: VANE.cup, ridge: VANE.ridge });
}

export function contourFeatherGeometry(): THREE.BufferGeometry {
  const c = CONTOUR_VANE;
  return buildVane({ rows: c.rows, columns: c.columns, profile: contourProfile, cup: c.cup, ridge: c.ridge });
}
