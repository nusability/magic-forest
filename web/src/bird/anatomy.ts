import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONTOUR, CONTOUR_COLOURS, GLOW, HEAD, HEAD_CONTOUR, LEGS, PAINT, SKIN_COLOURS, TORSO } from './constants';

// The bird's solid parts: torso with neck and tucked legs, head with beak and eyes, and the
// capsule that gives each wing bone its leading edge. All are vertex-coloured for the skin
// material and carry an `aGlow` attribute for the few emissive accents.

const color = new THREE.Color();

/** Catmull-Rom through the torso keys, so the outline has no kinks at the keys. */
function torsoKey(column: number, u: number): number {
  const keys = TORSO.keys;
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const span = k2[0] - k1[0];
  const t = THREE.MathUtils.clamp((u - k1[0]) / span, 0, 1);
  const m1 = ((k2[column] - k0[column]) / Math.max(k2[0] - k0[0], 1e-6)) * span;
  const m2 = ((k3[column] - k1[column]) / Math.max(k3[0] - k1[0], 1e-6)) * span;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * k1[column] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[column] + (t3 - t2) * m2;
}

const KEY_HALF_WIDTH = 1;
const KEY_ABOVE = 2;
const KEY_BELOW = 3;
const KEY_CENTRE_Y = 4;

/** A point on the torso: u from neck (0) to vent (1), v around (0 is the right flank, π/2 the back). */
export function torsoPoint(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  const s = Math.sin(v);
  const y = s >= 0 ? s * torsoKey(KEY_ABOVE, u) : -Math.pow(-s, TORSO.keelSharpness) * torsoKey(KEY_BELOW, u);
  return out.set(
    Math.cos(v) * torsoKey(KEY_HALF_WIDTH, u),
    torsoKey(KEY_CENTRE_Y, u) + y,
    THREE.MathUtils.lerp(TORSO.front, TORSO.back, u),
  );
}

function setSkin(geometry: THREE.BufferGeometry, paint: (p: THREE.Vector3, out: THREE.Color) => number): THREE.BufferGeometry {
  geometry.deleteAttribute('uv');
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const glow = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    glow[i] = paint(p, color);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  return geometry;
}

const back = new THREE.Color(SKIN_COLOURS.torsoBack);
const belly = new THREE.Color(SKIN_COLOURS.torsoBelly);

function torsoGeometry(): THREE.BufferGeometry {
  const nu = TORSO.segmentsAlong;
  const nv = TORSO.segmentsAround;
  const positions: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j < nv; j++) {
      torsoPoint(i / nu, (j / nv) * Math.PI * 2, p);
      positions.push(p.x, p.y, p.z);
    }
  }
  // Cap centres close the neck (inside the head) and the vent (under the tail).
  const capFront = positions.length / 3;
  torsoPoint(0, 0, p);
  positions.push(0, torsoKey(KEY_CENTRE_Y, 0), p.z);
  const capBack = capFront + 1;
  torsoPoint(1, 0, p);
  positions.push(0, torsoKey(KEY_CENTRE_Y, 1), p.z);

  const index: number[] = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * nv + j;
      const b = i * nv + ((j + 1) % nv);
      const c = a + nv;
      const d = b + nv;
      index.push(a, b, c, b, d, c);
    }
  }
  for (let j = 0; j < nv; j++) {
    index.push(capFront, (j + 1) % nv, j);
    index.push(capBack, nu * nv + j, nu * nv + ((j + 1) % nv));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return setSkin(geometry, (q, out) => {
    const up = THREE.MathUtils.smoothstep(q.y, -PAINT.torsoBand, PAINT.torsoBand);
    out.copy(belly).lerp(back, up);
    return 0;
  });
}

function legsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const tarsus = new THREE.CylinderGeometry(LEGS.radius, LEGS.radius * LEGS.taper, LEGS.length, LEGS.segments, 1);
    // Hang it from the hip, then swing it back so the foot tucks under the belly.
    tarsus.translate(0, -LEGS.length / 2, 0).rotateX(-LEGS.tuck).translate(side * LEGS.hipX, LEGS.hipY, LEGS.hipZ);
    parts.push(tarsus);
    const ankle = new THREE.Vector3(0, -LEGS.length, 0)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), -LEGS.tuck)
      .add(new THREE.Vector3(side * LEGS.hipX, LEGS.hipY, LEGS.hipZ));
    for (const spread of [-1, 0, 1]) {
      const toe = new THREE.ConeGeometry(LEGS.radius * LEGS.toeRadius, LEGS.toeLength, LEGS.toeSegments, 1);
      toe.translate(0, LEGS.toeLength / 2, 0).rotateX(-LEGS.toeCurl).rotateY(spread * LEGS.toeSpread).translate(ankle.x, ankle.y, ankle.z);
      parts.push(toe);
    }
  }
  const legColor = new THREE.Color(SKIN_COLOURS.legs);
  return setSkin(mergeGeometries(parts.map((g) => g.toNonIndexed())), (_q, out) => {
    out.copy(legColor);
    return 0;
  });
}

export function bodyGeometry(): THREE.BufferGeometry {
  return mergeGeometries([torsoGeometry().toNonIndexed(), legsGeometry()]);
}

const crown = new THREE.Color(SKIN_COLOURS.crown);
const face = new THREE.Color(SKIN_COLOURS.face);
const throat = new THREE.Color(SKIN_COLOURS.throat);

/** Crown above, face around the eyes, throat below; skin and head feathers share it. */
function paintHead(q: THREE.Vector3, out: THREE.Color): THREE.Color {
  const h = (q.y - HEAD.centre[1]) / HEAD.radii[1];
  out.copy(face).lerp(crown, THREE.MathUtils.smoothstep(h, PAINT.crownFrom, PAINT.crownTo));
  return out.lerp(throat, THREE.MathUtils.smoothstep(-h, PAINT.throatFrom, PAINT.throatTo));
}

const skullRadii = new THREE.Vector3(...HEAD.radii);

/** A unit-sphere direction to the skull's surface, relative to the head centre. */
function skullPoint(p: THREE.Vector3): THREE.Vector3 {
  // Press the front of the crown down into a sloping forehead that runs into the beak.
  if (p.y > 0 && p.z < 0) p.y *= 1 - HEAD.foreheadFlatten * -p.z;
  return p.multiply(skullRadii);
}

/** The head in pivot space: the pivot is the neck joint it turns about. */
export function headGeometry(): THREE.BufferGeometry {
  const [cx, cy, cz] = HEAD.centre;
  const skull = new THREE.SphereGeometry(1, HEAD.widthSegments, HEAD.heightSegments);
  const pos = skull.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    skullPoint(p.fromBufferAttribute(pos, i));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  skull.computeVertexNormals();
  skull.translate(cx, cy, cz);
  setSkin(skull, (q, out) => (paintHead(q, out), 0));

  const parts = [skull.toNonIndexed(), beakGeometry().toNonIndexed()];
  const eyeColor = new THREE.Color(SKIN_COLOURS.eye);
  const glintColor = new THREE.Color(SKIN_COLOURS.glint);
  const e = HEAD.eye;
  for (const side of [1, -1]) {
    const eye = new THREE.SphereGeometry(e.radius, e.segments, e.segments / 2);
    eye.translate(cx + side * e.x, cy + e.y, cz + e.z);
    parts.push(setSkin(eye, (_q, out) => (out.copy(eyeColor), 0)).toNonIndexed());
    const glint = new THREE.SphereGeometry(e.glintRadius, e.glintSegments, e.glintSegments / 2);
    const outward = new THREE.Vector3(side, e.glintUp, -e.glintForward).normalize().multiplyScalar(e.radius);
    glint.translate(cx + side * e.x + outward.x, cy + e.y + outward.y, cz + e.z + outward.z);
    parts.push(setSkin(glint, (_q, out) => (out.copy(glintColor), GLOW.glint)).toNonIndexed());
  }
  return mergeGeometries(parts);
}

/** A conical seed-eater's beak, slightly decurved, with a pale gold tip. */
function beakGeometry(): THREE.BufferGeometry {
  const b = HEAD.beak;
  const [cx, cy, cz] = HEAD.centre;
  const positions: number[] = [];
  for (let r = 0; r <= b.rings; r++) {
    const t = r / b.rings;
    const taper = 1 - t;
    const z = cz + b.z - t * b.length;
    const yc = cy + b.y - b.droop * t * t;
    for (let j = 0; j < b.segments; j++) {
      const a = (j / b.segments) * Math.PI * 2;
      positions.push(cx + Math.cos(a) * b.baseHalfWidth * taper, yc + Math.sin(a) * b.baseHalfHeight * taper, z);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < b.rings; r++) {
    for (let j = 0; j < b.segments; j++) {
      const a = r * b.segments + j;
      const n = r * b.segments + ((j + 1) % b.segments);
      index.push(a, a + b.segments, n, n, a + b.segments, n + b.segments);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const ivory = new THREE.Color(SKIN_COLOURS.beak);
  const gold = new THREE.Color(SKIN_COLOURS.beakTip);
  return setSkin(geometry, (q, out) => {
    const t = (cz + b.z - q.z) / b.length;
    out.copy(ivory).lerp(gold, t);
    return GLOW.beakTip * t;
  });
}

/** A unit ellipsoid along +x for a wing bone's capsule; instances stretch it bone by bone. */
export function boneCapsuleGeometry(): THREE.BufferGeometry {
  const c = new THREE.Color(SKIN_COLOURS.wingBone);
  return setSkin(new THREE.SphereGeometry(1, 12, 8), (_q, out) => (out.copy(c), 0));
}

export interface ContourFeather {
  matrix: THREE.Matrix4;
  halfWidth: number;
  /** How far the tip curls down to follow the skin; a flat feather on a round body sticks out. */
  bend: number;
  base: THREE.Color;
  tip: THREE.Color;
}

const white = new THREE.Color(1, 1, 1);

/**
 * One contour feather lying on a surface at p with outward normal n, its shaft along the
 * surface towards `back` and its tip lifted off the skin like a roof tile. `tipOnSkin` is the
 * surface point one feather length further along, which sets how far the feather must curl.
 */
function layFeather(p: THREE.Vector3, back: THREE.Vector3, n: THREE.Vector3, tipOnSkin: THREE.Vector3, length: number, halfWidth: number, lift: number, sink: number, base: THREE.Color): ContourFeather {
  const shaft = back.clone().addScaledVector(n, -n.dot(back)).normalize();
  const z = shaft.clone().multiplyScalar(Math.cos(lift)).addScaledVector(n, Math.sin(lift));
  const y = n.clone().multiplyScalar(Math.cos(lift)).addScaledVector(shaft, -Math.sin(lift));
  const x = new THREE.Vector3().crossVectors(y, z);
  const matrix = new THREE.Matrix4().makeBasis(x, y, z.multiplyScalar(length));
  matrix.setPosition(p.clone().addScaledVector(n, -sink));
  const bend = Math.min(0, tipOnSkin.clone().sub(p).dot(n));
  return { matrix, halfWidth, bend, base, tip: base.clone().lerp(white, CONTOUR_COLOURS.tipLighten) };
}

/** Overlapping rows of body feathers over the torso, tips pointing back. */
export function contourLayout(): ContourFeather[] {
  const c = CONTOUR;
  const cc = CONTOUR_COLOURS;
  const backFront = new THREE.Color(cc.backFront);
  const backMid = new THREE.Color(cc.backMid);
  const backRear = new THREE.Color(cc.backRear);
  const bellyFront = new THREE.Color(cc.bellyFront);
  const bellyRear = new THREE.Color(cc.bellyRear);
  const out: ContourFeather[] = [];
  const p = new THREE.Vector3();
  const pu = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const n = new THREE.Vector3();
  const du = 1e-3;
  for (let r = 0; r < c.rows; r++) {
    const u = THREE.MathUtils.lerp(c.uFrom, c.uTo, r / (c.rows - 1));
    const meanRadius = (torsoKey(KEY_HALF_WIDTH, u) + (torsoKey(KEY_ABOVE, u) + torsoKey(KEY_BELOW, u)) / 2) / 2;
    const count = Math.max(c.minPerRow, Math.round((Math.PI * 2 * meanRadius) / c.spacing));
    const length = THREE.MathUtils.clamp(meanRadius * c.lengthPerRadius, c.lengthMin, c.lengthMax);
    for (let k = 0; k < count; k++) {
      // Alternate rows are offset by half a step so each feather covers the seam behind it.
      const v = ((k + (r % 2) * 0.5) / count) * Math.PI * 2;
      torsoPoint(u, v, p);
      torsoPoint(u + du, v, pu).sub(torsoPoint(u - du, v, tmp));
      torsoPoint(u, v + du, pv).sub(torsoPoint(u, v - du, tmp));
      n.crossVectors(pv, pu).normalize();
      const upness = THREE.MathUtils.smoothstep(Math.sin(v), -PAINT.flankBand, PAINT.flankBand);
      const m = PAINT.backMid;
      const backColour = u < m ? backFront.clone().lerp(backMid, u / m) : backMid.clone().lerp(backRear, (u - m) / (1 - m));
      const base = bellyFront.clone().lerp(bellyRear, u).lerp(backColour, upness);
      const uTip = Math.min(1, u + (length / pu.length()) * 2 * du);
      out.push(layFeather(p, pu, n, torsoPoint(uTip, v, tip), length, length * c.widthShare, c.lift, c.sink, base));
    }
  }
  return out;
}

/** Contour feathers over the head, in the head's pivot space, painted like the skull beneath. */
export function headContourLayout(): ContourFeather[] {
  const h = HEAD_CONTOUR;
  const [cx, cy, cz] = HEAD.centre;
  const [rx, ry, rz] = HEAD.radii;
  const centre = new THREE.Vector3(cx, cy, cz);
  const eyes = [1, -1].map((side) => new THREE.Vector3(cx + side * HEAD.eye.x, cy + HEAD.eye.y, cz + HEAD.eye.z));
  const out: ContourFeather[] = [];
  const point = (theta: number, psi: number, target: THREE.Vector3): THREE.Vector3 =>
    // theta from the beak axis (-z), psi around it with 0 on the right.
    skullPoint(target.set(Math.sin(theta) * Math.cos(psi), Math.sin(theta) * Math.sin(psi), -Math.cos(theta))).add(centre);
  const p = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const n = new THREE.Vector3();
  const dTheta = 1e-3;
  for (let r = 0; r < h.rows; r++) {
    const theta = THREE.MathUtils.lerp(h.fromFront, h.toFront, r / (h.rows - 1));
    const ring = Math.PI * 2 * Math.sin(theta) * (rx + ry) * 0.5;
    const count = Math.max(h.minPerRow, Math.round(ring / h.spacing));
    for (let k = 0; k < count; k++) {
      const psi = ((k + (r % 2) * 0.5) / count) * Math.PI * 2;
      point(theta, psi, p);
      if (eyes.some((e) => e.distanceTo(p) < h.eyeClearance)) continue;
      point(theta + dTheta, psi, ahead).sub(p);
      n.set((p.x - cx) / (rx * rx), (p.y - cy) / (ry * ry), (p.z - cz) / (rz * rz)).normalize();
      point(theta + (h.length / ahead.length()) * dTheta, psi, tip);
      out.push(layFeather(p, ahead, n, tip, h.length, h.halfWidth, h.lift, h.sink, paintHead(p, new THREE.Color())));
    }
  }
  return out;
}
