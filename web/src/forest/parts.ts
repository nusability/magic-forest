import * as THREE from 'three';
import { spread, type Leaf, type PlantKind, type PlantPlan, type Segment } from '../plants';
import { TUNING } from '../tuning';
import { InstanceLayer, type Layout } from './layer';
import { CORE_GLOW, CORE_SHARE, CORE_WHITENING } from './materials';

// How a plant plan becomes instances. Near parts are the plan itself, part for part. Far parts
// keep what reads from afar: the trunk and main limbs, the foliage gathered into a few leaf
// clumps, and every blossom as a glowing point.

export const OPEN_ANGLE: Record<PlantKind, number> = { tree: 1.25, shrub: 1.2, flower: 1.05 };
const WHITE = new THREE.Color(1, 1, 1);

/** Where a plant stands. Written into every one of its instances. */
export interface Placement {
  x: number;
  z: number;
  yaw: number;
  index: number; // texel in the plant state texture
  bark: THREE.Color;
}

const BARK: Layout = { aPlant: 4, aStart: 3, aQuat: 4, aSeg: 4, aEnd: 1, color: 3 };
const LEAVES: Layout = { aPlant: 4, aAt: 3, aAxis: 3, aLeaf: 4, color: 3 };
const PETALS: Layout = { aPlant: 4, aAt: 3, aAxis: 3, aPetal: 4, color: 3 };
const CORES: Layout = { aPlant: 4, aAt: 3, aCore: 2, color: 3 };
const CLUMPS: Layout = { aPlant: 4, aClump: 4, aClumpTime: 2, color: 3 };
// Points are drawn without instancing, and three counts them by `position`, so a blossom's
// plant-space anchor travels under that name.
const BLOSSOMS: Layout = { aPlant: 4, position: 3, aAxis: 3, aBloom: 4, color: 3 };

// Far detail, per kind. A tree's trunk (depth 0) shows at every distance; other segments up to
// `limbDepth` show as limbs within the mid radius. Leaves gather into this many clumps within
// the mid radius, and into fewer, bigger ones beyond.
const FAR_SHAPE: Record<PlantKind, { trunk: boolean; limbDepth: number; midClumps: number; farClumps: number }> = {
  tree: { trunk: true, limbDepth: 1, midClumps: 12, farClumps: 4 },
  shrub: { trunk: false, limbDepth: 1, midClumps: 6, farClumps: 2 },
  flower: { trunk: false, limbDepth: 0, midClumps: 1, farClumps: 0 }, // a flower's few leaves vanish first
};
const KMEANS_ROUNDS = 6;
// A clump's radius covers its leaves' spread plus half a leaf, a little generously, since its
// card is painted with holes.
const CLUMP_COVER = 1.25;
// A clump appears as its first leaves unfurl and is full when most of them have.
const CLUMP_TIMING = { from: 0.1, to: 0.9 };

export interface Materials {
  bark: THREE.Material;
  leaves: THREE.Material;
  petals: THREE.Material;
  cores: THREE.Material;
  trunks: THREE.Material;
  limbs: THREE.Material;
  midClumps: THREE.Material;
  farClumps: THREE.Material;
  blossoms: THREE.Material;
}

export interface Shapes {
  nearBark: THREE.BufferGeometry;
  farBark: THREE.BufferGeometry;
  leaf: THREE.BufferGeometry;
  petal: THREE.BufferGeometry;
  core: THREE.BufferGeometry;
  clump: THREE.BufferGeometry;
}

function setPlant(layer: InstanceLayer, i: number, p: Placement): void {
  layer.set('aPlant', i, p.x, p.z, p.yaw, p.index);
}

function writeSegment(layer: InstanceLayer, seg: Segment, plan: PlantPlan, p: Placement): void {
  const i = layer.add();
  setPlant(layer, i, p);
  layer.set('aStart', i, seg.start.x, seg.start.y, seg.start.z);
  layer.set('aQuat', i, seg.quat.x, seg.quat.y, seg.quat.z, seg.quat.w);
  layer.set('aSeg', i, seg.length, seg.radius, seg.birth, seg.duration);
  layer.set('aEnd', i, plan.end);
  layer.set('color', i, p.bark.r, p.bark.g, p.bark.b);
}

/** A group of layers that are shown, culled and freed together. */
abstract class PartSet {
  protected abstract readonly layers: InstanceLayer[];

  addTo(parent: THREE.Object3D): void {
    for (const l of this.layers) parent.add(l.object);
  }

  include(bounds: THREE.Sphere): void {
    for (const l of this.layers) l.include(bounds);
  }

  flush(): void {
    for (const l of this.layers) l.flush();
  }

  /** Shows or hides every layer; an empty one stays hidden, so it costs nothing per frame. */
  show(visible: boolean): void {
    for (const l of this.layers) l.object.visible = visible && l.size > 0;
  }

  dispose(): void {
    for (const l of this.layers) {
      l.object.removeFromParent();
      l.dispose();
    }
  }
}

/** Full detail: every segment, leaf, petal and blossom core of the plan. */
export class NearParts extends PartSet {
  private readonly bark: InstanceLayer;
  private readonly leaves: InstanceLayer;
  private readonly petals: InstanceLayer;
  private readonly cores: InstanceLayer;
  protected readonly layers: InstanceLayer[];
  private readonly color = new THREE.Color();

  constructor(m: Materials, s: Shapes) {
    super();
    this.bark = new InstanceLayer(s.nearBark, m.bark, BARK);
    this.leaves = new InstanceLayer(s.leaf, m.leaves, LEAVES);
    this.petals = new InstanceLayer(s.petal, m.petals, PETALS);
    this.cores = new InstanceLayer(s.core, m.cores, CORES);
    this.layers = [this.bark, this.leaves, this.petals, this.cores];
  }

  write(plan: PlantPlan, p: Placement): void {
    for (const seg of plan.segments) writeSegment(this.bark, seg, plan, p);
    for (const leaf of plan.leaves) {
      const i = this.leaves.add();
      setPlant(this.leaves, i, p);
      this.leaves.set('aAt', i, leaf.at.x, leaf.at.y, leaf.at.z);
      this.leaves.set('aAxis', i, leaf.axis.x, leaf.axis.y, leaf.axis.z);
      this.leaves.set('aLeaf', i, leaf.azimuth, leaf.openAngle, leaf.size, leaf.birth);
      this.leaves.set('color', i, leaf.color.r, leaf.color.g, leaf.color.b);
    }
    for (const b of plan.blossoms) {
      for (let k = 0; k < b.petals; k++) {
        const i = this.petals.add();
        setPlant(this.petals, i, p);
        this.petals.set('aAt', i, b.at.x, b.at.y, b.at.z);
        this.petals.set('aAxis', i, b.axis.x, b.axis.y, b.axis.z);
        this.petals.set('aPetal', i, (k / b.petals) * Math.PI * 2, OPEN_ANGLE[plan.kind], b.size, b.birth);
        this.petals.set('color', i, b.color.r, b.color.g, b.color.b);
      }
      const i = this.cores.add();
      setPlant(this.cores, i, p);
      this.cores.set('aAt', i, b.at.x, b.at.y, b.at.z);
      this.cores.set('aCore', i, b.size * CORE_SHARE, b.birth);
      const c = this.color.copy(b.color).lerp(WHITE, CORE_WHITENING).multiplyScalar(CORE_GLOW);
      this.cores.set('color', i, c.r, c.g, c.b);
    }
  }
}

interface Clump {
  x: number;
  y: number;
  z: number;
  radius: number;
  birth: number;
  duration: number;
  color: THREE.Color;
}

/** Where an open leaf's middle sits, plant space. */
function leafCentre(leaf: Leaf, out: THREE.Vector3): THREE.Vector3 {
  spread(leaf.axis, leaf.openAngle, leaf.azimuth, out);
  return out.multiplyScalar(leaf.size / 2).add(leaf.at);
}

const quantile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** Gathers leaves into at most `k` clumps with a few rounds of k-means, seeded evenly along the plan. */
export function clumpLeaves(leaves: Leaf[], k: number): Clump[] {
  if (k === 0 || leaves.length === 0) return [];
  const points = leaves.map((l) => leafCentre(l, new THREE.Vector3()));
  const n = Math.min(k, points.length);
  // The plan lists leaves branch by branch, so evenly spaced picks start spread over the crown.
  const centres = Array.from({ length: n }, (_, i) => points[Math.floor(((i + 0.5) * points.length) / n)].clone());
  const owner = new Int32Array(points.length);
  for (let round = 0; round < KMEANS_ROUNDS; round++) {
    points.forEach((pt, i) => {
      let best = 0;
      for (let c = 1; c < n; c++) if (pt.distanceToSquared(centres[c]) < pt.distanceToSquared(centres[best])) best = c;
      owner[i] = best;
    });
    const counts = new Array<number>(n).fill(0);
    for (const c of centres) c.set(0, 0, 0);
    points.forEach((pt, i) => {
      centres[owner[i]].add(pt);
      counts[owner[i]]++;
    });
    centres.forEach((c, i) => counts[i] && c.divideScalar(counts[i]));
  }
  const unfurl = TUNING.growth.leafUnfurl;
  const groups = centres.map(() => ({ spreadSq: 0, size: 0, color: new THREE.Color(0, 0, 0), births: [] as number[] }));
  leaves.forEach((leaf, i) => {
    const g = groups[owner[i]];
    g.spreadSq += points[i].distanceToSquared(centres[owner[i]]);
    g.size += leaf.size;
    g.color.add(leaf.color);
    g.births.push(leaf.birth);
  });
  const clumps: Clump[] = [];
  groups.forEach((g, c) => {
    const count = g.births.length;
    if (count === 0) return;
    g.births.sort((x, y) => x - y);
    const birth = quantile(g.births, CLUMP_TIMING.from);
    clumps.push({
      x: centres[c].x, y: centres[c].y, z: centres[c].z,
      radius: CLUMP_COVER * (Math.sqrt(g.spreadSq / count) + g.size / count / 2),
      birth,
      duration: quantile(g.births, CLUMP_TIMING.to) + unfurl - birth,
      color: g.color.multiplyScalar(1 / count),
    });
  });
  return clumps;
}

function writeClumps(layer: InstanceLayer, clumps: Clump[], p: Placement): void {
  for (const c of clumps) {
    const i = layer.add();
    setPlant(layer, i, p);
    layer.set('aClump', i, c.x, c.y, c.z, c.radius);
    layer.set('aClumpTime', i, c.birth, c.duration);
    layer.set('color', i, c.color.r, c.color.g, c.color.b);
  }
}

/** Mid-distance detail: the limbs and small leaf clumps. Only drawn within the mid radius. */
export class MidParts extends PartSet {
  private readonly limbs: InstanceLayer;
  private readonly clumps: InstanceLayer;
  protected readonly layers: InstanceLayer[];

  constructor(m: Materials, s: Shapes) {
    super();
    this.limbs = new InstanceLayer(s.farBark, m.limbs, BARK);
    this.clumps = new InstanceLayer(s.clump, m.midClumps, CLUMPS);
    this.layers = [this.limbs, this.clumps];
  }

  write(plan: PlantPlan, p: Placement): void {
    const shape = FAR_SHAPE[plan.kind];
    for (const seg of plan.segments) {
      if (seg.depth <= shape.limbDepth && !(shape.trunk && seg.depth === 0)) writeSegment(this.limbs, seg, plan, p);
    }
    writeClumps(this.clumps, clumpLeaves(plan.leaves, shape.midClumps), p);
  }
}

/** What every plant shows from afar: its trunk, a few big leaf clumps and its blossoms. */
export class FarParts extends PartSet {
  private readonly trunks: InstanceLayer;
  private readonly clumps: InstanceLayer;
  private readonly blossoms: InstanceLayer;
  protected readonly layers: InstanceLayer[];

  constructor(m: Materials, s: Shapes, pixelScale: (renderer: THREE.WebGLRenderer) => void) {
    super();
    this.trunks = new InstanceLayer(s.farBark, m.trunks, BARK);
    this.clumps = new InstanceLayer(s.clump, m.farClumps, CLUMPS);
    this.blossoms = new InstanceLayer(null, m.blossoms, BLOSSOMS);
    this.blossoms.object.onBeforeRender = (renderer) => pixelScale(renderer);
    this.layers = [this.trunks, this.clumps, this.blossoms];
  }

  /** Trunks and blossoms show at every distance past near; the big clumps only past the mid radius. */
  showUpTo(farthest: number, midRadius: number): void {
    this.show(true);
    this.clumps.object.visible &&= farthest >= midRadius;
  }

  write(plan: PlantPlan, p: Placement): void {
    const shape = FAR_SHAPE[plan.kind];
    if (shape.trunk) for (const seg of plan.segments) if (seg.depth === 0) writeSegment(this.trunks, seg, plan, p);
    writeClumps(this.clumps, clumpLeaves(plan.leaves, shape.farClumps), p);
    for (const b of plan.blossoms) {
      const i = this.blossoms.add();
      setPlant(this.blossoms, i, p);
      this.blossoms.set('position', i, b.at.x, b.at.y, b.at.z);
      this.blossoms.set('aAxis', i, b.axis.x, b.axis.y, b.axis.z);
      this.blossoms.set('aBloom', i, b.size, b.birth, b.petals, OPEN_ANGLE[plan.kind]);
      this.blossoms.set('color', i, b.color.r, b.color.g, b.color.b);
    }
  }
}
