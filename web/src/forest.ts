import * as THREE from 'three';
import { generatePlant, spread, type PlantKind, type PlantPlan } from './plants';
import { TUNING } from './tuning';

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const BARK_COLORS = [0x6b4a7a, 0x5a3f6e, 0x7a5a6a, 0x4f4a78];
const BUD_ANGLE = 0.12; // radians a closed petal leans out from the blossom's axis
const BUD_SHARE = 0.45; // a swollen bud's size as a share of the open blossom
const PETAL_GLOW = { bud: 0.5, open: 1.15 }; // colour multipliers; above 1 feeds the bloom pass
const CORE_GLOW = 1.8;
const CORE_SHARE = 0.22;
const OPEN_ANGLE: Record<PlantKind, number> = { tree: 1.25, shrub: 1.2, flower: 1.05 };

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
const smooth = (x: number): number => x * x * (3 - 2 * x);
const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;
const easeOutBack = (x: number): number => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

/** One InstancedMesh with a bump allocator. Plants are never freed in the sketch. */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  private used = 0;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.colors = this.mesh.instanceColor.array as Float32Array;
  }

  fits(n: number): boolean {
    return this.used + n <= this.capacity;
  }

  alloc(n: number): number {
    if (!this.fits(n)) throw new Error(`Pool overflow: ${this.used} + ${n} > ${this.capacity}`);
    const base = this.used;
    this.used += n;
    this.mesh.count = this.used;
    for (let i = base; i < this.used; i++) ZERO.toArray(this.matrices, i * 16);
    return base;
  }

  setMatrix(i: number, m: THREE.Matrix4): void {
    m.toArray(this.matrices, i * 16);
  }

  setColor(i: number, c: THREE.Color, intensity = 1): void {
    this.colors[i * 3] = c.r * intensity;
    this.colors[i * 3 + 1] = c.g * intensity;
    this.colors[i * 3 + 2] = c.b * intensity;
  }

  markDirty(base: number, n: number): void {
    if (n === 0) return;
    this.mesh.instanceMatrix.addUpdateRange(base * 16, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    const colors = this.mesh.instanceColor;
    if (!colors) throw new Error('Pool mesh lost its instance colours');
    colors.addUpdateRange(base * 3, n * 3);
    colors.needsUpdate = true;
  }
}

interface Plant {
  plan: PlantPlan;
  x: number;
  z: number;
  transform: THREE.Matrix4; // plant space -> world
  age: number;
  boost: number;
  segBase: number;
  leafBase: number;
  petalBase: number;
  coreBase: number;
  petalCount: number;
}

function cuppedShape(shape: THREE.Shape, cup: number): THREE.BufferGeometry {
  const geometry = new THREE.ShapeGeometry(shape, 6);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, -cup * pos.getX(i) ** 2);
  geometry.computeVertexNormals();
  return geometry;
}

function leafGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.38, 0.4, 0, 1);
  s.quadraticCurveTo(-0.38, 0.4, 0, 0);
  return cuppedShape(s, 0.9);
}

function petalGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.5, 0.3, 0.42, 0.95, 0, 1);
  s.bezierCurveTo(-0.42, 0.95, -0.5, 0.3, 0, 0);
  return cuppedShape(s, 1.2);
}

export class Forest {
  readonly group = new THREE.Group();
  private readonly segments: Pool;
  private readonly leaves: Pool;
  private readonly petals: Pool;
  private readonly cores: Pool;
  private readonly plants: Plant[] = [];
  private growing: Plant[] = [];
  private warnedFull = false;
  // Scratch objects, reused every frame.
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly white = new THREE.Color(1, 1, 1);

  constructor(private readonly onBlossomOpen: (at: THREE.Vector3, color: THREE.Color) => void) {
    const f = TUNING.forest;
    this.segments = new Pool(
      new THREE.CylinderGeometry(0.75, 1, 1, 6, 1, true).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.85, emissive: 0x2a1240, emissiveIntensity: 0.6 }),
      f.maxSegments,
    );
    this.leaves = new Pool(
      leafGeometry(),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, emissive: 0x145a44, emissiveIntensity: 0.9 }),
      f.maxLeaves,
    );
    this.petals = new Pool(petalGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), f.maxPetals);
    this.cores = new Pool(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial(), f.maxCores);
    for (const pool of [this.segments, this.leaves, this.petals, this.cores]) this.group.add(pool.mesh);
  }

  get plantCount(): number {
    return this.plants.length;
  }

  /** A seeding sparkle touched the ground: feed the plant it fell on, or maybe start one. */
  land(x: number, z: number): void {
    const sd = TUNING.seeding;
    for (const p of this.plants) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < p.plan.footprint ** 2) {
        p.boost = Math.min(sd.maxBoost, p.boost + sd.feedBoost);
        return;
      }
    }
    if (Math.random() < sd.chance) this.seed(this.pickKind(), x, z);
  }

  private pickKind(): PlantKind {
    let r = Math.random();
    for (const [kind, share] of Object.entries(TUNING.seeding.kinds) as [PlantKind, number][]) {
      if ((r -= share) < 0) return kind;
    }
    return 'tree'; // only reached through float rounding when r lands on the sum of shares
  }

  private seed(kind: PlantKind, x: number, z: number): void {
    const plan = generatePlant(kind);
    const petalCount = plan.blossoms.reduce((n, b) => n + b.petals, 0);
    const fits = this.segments.fits(plan.segments.length) && this.leaves.fits(plan.leaves.length)
      && this.petals.fits(petalCount) && this.cores.fits(plan.blossoms.length);
    if (!fits) {
      if (!this.warnedFull) console.warn(`Forest is full at ${this.plants.length} plants; no more seeding.`);
      this.warnedFull = true;
      return;
    }
    const plant: Plant = {
      plan, x, z, petalCount,
      transform: new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2),
        new THREE.Vector3(1, 1, 1),
      ),
      age: 0,
      boost: 0,
      segBase: this.segments.alloc(plan.segments.length),
      leafBase: this.leaves.alloc(plan.leaves.length),
      petalBase: this.petals.alloc(petalCount),
      coreBase: this.cores.alloc(plan.blossoms.length),
    };
    const bark = new THREE.Color(BARK_COLORS[Math.floor(Math.random() * BARK_COLORS.length)]);
    plan.segments.forEach((_, i) => this.segments.setColor(plant.segBase + i, bark));
    plan.leaves.forEach((l, i) => this.leaves.setColor(plant.leafBase + i, l.color));
    this.plants.push(plant);
    this.growing.push(plant);
  }

  update(dt: number): void {
    const decay = Math.exp(-dt / TUNING.seeding.boostDecay);
    for (const p of this.growing) {
      p.boost *= decay;
      const prevAge = p.age;
      p.age = Math.min(p.age + dt * (1 + p.boost), p.plan.end);
      this.write(p, prevAge);
    }
    this.growing = this.growing.filter((p) => p.age < p.plan.end);
  }

  private place(pool: Pool, i: number, p: Plant, at: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3): void {
    this.m.compose(at, q, s).premultiply(p.transform);
    pool.setMatrix(i, this.m);
  }

  private write(p: Plant, prevAge: number): void {
    const g = TUNING.growth;
    const { plan, age } = p;
    const thicken = 0.5 + 0.5 * clamp01(age / plan.end);

    plan.segments.forEach((seg, i) => {
      const grown = clamp01((age - seg.birth) / seg.duration);
      if (grown <= 0) return;
      const r = seg.radius * thicken;
      this.place(this.segments, p.segBase + i, p, seg.start, seg.quat, this.s.set(r, seg.length * grown, r));
    });

    plan.leaves.forEach((leaf, i) => {
      const u = clamp01((age - leaf.birth) / g.leafUnfurl);
      if (u <= 0) return;
      spread(leaf.axis, BUD_ANGLE + (leaf.openAngle - BUD_ANGLE) * smooth(u), leaf.azimuth, this.dir);
      this.q.setFromUnitVectors(UP, this.dir).multiply(this.q2.setFromAxisAngle(UP, leaf.azimuth));
      const size = leaf.size * easeOutBack(u);
      this.place(this.leaves, p.leafBase + i, p, leaf.at, this.q, this.s.setScalar(size));
    });

    let petal = p.petalBase;
    plan.blossoms.forEach((b, i) => {
      const t = age - b.birth;
      const firstPetal = petal;
      petal += b.petals;
      if (t <= 0) return;
      const swell = clamp01(t / g.budSwell);
      const open = easeOutCubic(clamp01((t - g.budSwell) / g.blossomOpen));
      const size = b.size * (BUD_SHARE * smooth(swell) + (1 - BUD_SHARE) * open);
      const angle = BUD_ANGLE + (OPEN_ANGLE[plan.kind] - BUD_ANGLE) * open;
      const glow = PETAL_GLOW.bud + (PETAL_GLOW.open - PETAL_GLOW.bud) * open;
      for (let k = 0; k < b.petals; k++) {
        const az = (k / b.petals) * Math.PI * 2;
        spread(b.axis, angle, az, this.dir);
        this.q.setFromUnitVectors(UP, this.dir).multiply(this.q2.setFromAxisAngle(UP, az));
        this.place(this.petals, firstPetal + k, p, b.at, this.q, this.s.setScalar(size));
        this.petals.setColor(firstPetal + k, b.color, glow);
      }
      if (open > 0) {
        this.place(this.cores, p.coreBase + i, p, b.at, this.q.identity(), this.s.setScalar(b.size * CORE_SHARE * open));
        this.cores.setColor(p.coreBase + i, this.color.copy(b.color).lerp(this.white, 0.6), CORE_GLOW);
      }
      if (prevAge - b.birth < g.budSwell && t >= g.budSwell) {
        this.onBlossomOpen(this.v.copy(b.at).applyMatrix4(p.transform), b.color);
      }
    });

    this.segments.markDirty(p.segBase, plan.segments.length);
    this.leaves.markDirty(p.leafBase, plan.leaves.length);
    this.petals.markDirty(p.petalBase, p.petalCount);
    this.cores.markDirty(p.coreBase, plan.blossoms.length);
  }
}
