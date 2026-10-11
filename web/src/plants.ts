import * as THREE from 'three';
import { BLOSSOM_COLORS, LEAF_COLORS, TUNING } from './tuning';

// A plant is generated whole as a plan: every branch segment, leaf and blossom with the moment
// (in the plant's own growth clock) it starts to grow. Rendering then reveals the plan over
// time, so the plant grows the way living things do: a tip extends, side shoots sprout from
// where the parent has already reached, leaves unfurl behind the tip, and buds swell and open.

export type PlantKind = 'tree' | 'shrub' | 'flower';

export interface Segment {
  start: THREE.Vector3;
  dir: THREE.Vector3;
  quat: THREE.Quaternion; // rotates +y onto dir
  length: number;
  radius: number;
  birth: number;
  duration: number;
}

export interface Leaf {
  at: THREE.Vector3;
  axis: THREE.Vector3; // the branch direction it unfurls away from
  azimuth: number;
  openAngle: number;
  size: number;
  birth: number;
  color: THREE.Color;
}

export interface Blossom {
  at: THREE.Vector3;
  axis: THREE.Vector3;
  petals: number;
  size: number;
  birth: number; // the bud appears
  color: THREE.Color;
}

export interface PlantPlan {
  kind: PlantKind;
  segments: Segment[];
  leaves: Leaf[];
  blossoms: Blossom[];
  /** Growth-clock time at which everything is fully grown. */
  end: number;
  /** Ground radius inside which landing sparkles feed this plant instead of seeding a new one. */
  footprint: number;
}

interface Shape {
  maxDepth: number;
  childCount: [number, number];
  childAngle: number;
  lengthRatio: number;
  radiusRatio: number;
  subdivisions: number;
  wobble: number;
  tropism: number; // pull towards the sky
  lateralChance: number;
  leafFromDepth: number;
  leavesPerSegment: number;
  leafSize: number;
  blossomChance: number;
  blossomSize: number;
}

const SHAPES: Record<PlantKind, Shape> = {
  tree: {
    maxDepth: 3, childCount: [2, 3], childAngle: 0.62, lengthRatio: 0.72, radiusRatio: 0.66,
    subdivisions: 3, wobble: 0.22, tropism: 0.12, lateralChance: 0.45,
    leafFromDepth: 2, leavesPerSegment: 3, leafSize: 0.32, blossomChance: 0.75, blossomSize: 0.24,
  },
  shrub: {
    maxDepth: 3, childCount: [2, 2], childAngle: 0.55, lengthRatio: 0.7, radiusRatio: 0.7,
    subdivisions: 2, wobble: 0.3, tropism: 0.1, lateralChance: 0.3,
    leafFromDepth: 1, leavesPerSegment: 3, leafSize: 0.24, blossomChance: 0.9, blossomSize: 0.2,
  },
  flower: {
    maxDepth: 0, childCount: [0, 0], childAngle: 0, lengthRatio: 0, radiusRatio: 0,
    subdivisions: 4, wobble: 0.12, tropism: 0.2, lateralChance: 0,
    leafFromDepth: 0, leavesPerSegment: 1, leafSize: 0.3, blossomChance: 1, blossomSize: 0.42,
  },
};

const UP = new THREE.Vector3(0, 1, 0);
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** A direction `angle` radians away from `axis`, turned `azimuth` radians around it. */
export function spread(axis: THREE.Vector3, angle: number, azimuth: number, out = new THREE.Vector3()): THREE.Vector3 {
  const helper = Math.abs(axis.y) < 0.95 ? UP : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  return out
    .copy(axis)
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(u, Math.cos(azimuth) * Math.sin(angle))
    .addScaledVector(v, Math.sin(azimuth) * Math.sin(angle))
    .normalize();
}

export function generatePlant(kind: PlantKind): PlantPlan {
  const shape = SHAPES[kind];
  const g = TUNING.growth;
  const plan: PlantPlan = { kind, segments: [], leaves: [], blossoms: [], end: 0, footprint: 0 };
  const leafColor = new THREE.Color(pick(LEAF_COLORS));
  const blossomColor = new THREE.Color(pick(BLOSSOM_COLORS));

  const addLeaf = (at: THREE.Vector3, axis: THREE.Vector3, birth: number): void => {
    plan.leaves.push({
      at, axis, birth,
      azimuth: rand(0, Math.PI * 2),
      openAngle: rand(0.7, 1.2),
      size: shape.leafSize * rand(0.75, 1.2),
      color: leafColor.clone().offsetHSL(rand(-0.03, 0.03), 0, rand(-0.08, 0.08)),
    });
  };

  const branch = (start: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number, birth: number): void => {
    let p = start.clone();
    let d = dir.clone();
    let t = birth;
    const subLength = length / shape.subdivisions;
    for (let i = 0; i < shape.subdivisions; i++) {
      d = d.clone()
        .add(new THREE.Vector3().randomDirection().multiplyScalar(shape.wobble))
        .addScaledVector(UP, shape.tropism)
        .normalize();
      const duration = subLength / g.extendSpeed;
      const r = radius * (1 - (0.35 * i) / shape.subdivisions);
      plan.segments.push({
        start: p.clone(), dir: d, quat: new THREE.Quaternion().setFromUnitVectors(UP, d),
        length: subLength, radius: r, birth: t, duration,
      });
      if (depth >= shape.leafFromDepth) {
        for (let k = 0; k < shape.leavesPerSegment; k++) {
          const f = rand(0.2, 1);
          addLeaf(p.clone().addScaledVector(d, subLength * f), d, t + duration * f);
        }
      }
      if (depth < shape.maxDepth && i > 0 && Math.random() < shape.lateralChance) {
        const f = rand(0.3, 0.8);
        branch(
          p.clone().addScaledVector(d, subLength * f), spread(d, shape.childAngle * 1.2, rand(0, Math.PI * 2)),
          length * shape.lengthRatio * 0.6, r * shape.radiusRatio * 0.8, depth + 1, t + duration * f,
        );
      }
      p = p.addScaledVector(d, subLength);
      t += duration;
    }
    plan.footprint = Math.max(plan.footprint, Math.hypot(p.x, p.z));

    if (depth < shape.maxDepth) {
      const n = Math.round(rand(shape.childCount[0], shape.childCount[1]));
      const az0 = rand(0, Math.PI * 2);
      for (let k = 0; k < n; k++) {
        const az = az0 + (k / n) * Math.PI * 2 + rand(-0.3, 0.3);
        branch(p, spread(d, shape.childAngle * rand(0.8, 1.2), az), length * shape.lengthRatio,
          radius * shape.radiusRatio, depth + 1, t);
      }
    } else if (Math.random() < shape.blossomChance) {
      plan.blossoms.push({
        at: p.clone(), axis: d, birth: t,
        petals: kind === 'flower' ? 7 : 5,
        size: shape.blossomSize * rand(0.85, 1.15),
        color: blossomColor.clone().offsetHSL(rand(-0.04, 0.04), 0, 0),
      });
    }
  };

  if (kind === 'tree') {
    branch(new THREE.Vector3(), UP, rand(1.2, 1.6), 0.11, 0, 0);
  } else if (kind === 'shrub') {
    const stems = Math.round(rand(3, 5));
    for (let k = 0; k < stems; k++) {
      branch(new THREE.Vector3(), spread(UP, rand(0.25, 0.6), (k / stems) * Math.PI * 2), rand(0.6, 0.9), 0.045, 1, rand(0, 0.4));
    }
  } else {
    branch(new THREE.Vector3(), UP, rand(0.6, 1), 0.025, 0, 0);
    for (let k = 0; k < 3; k++) addLeaf(new THREE.Vector3(), spread(UP, 0.2, k * 2.1), 0.1 * k);
  }

  plan.footprint = Math.max(plan.footprint, 0.6);
  plan.end = Math.max(
    ...plan.segments.map((s) => s.birth + s.duration),
    ...plan.leaves.map((l) => l.birth + g.leafUnfurl),
    ...plan.blossoms.map((b) => b.birth + g.budSwell + g.blossomOpen),
  );
  return plan;
}
