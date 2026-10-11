import * as THREE from 'three';
import { generatePlant, type PlantKind, type PlantPlan } from './plants';
import { TUNING } from './tuning';
import { barkGeometry, clumpGeometry, coreGeometry, leafGeometry, petalGeometry } from './forest/geometry';
import {
  barkMaterial, blossomPointMaterial, clumpMaterial, coreMaterial, leafMaterial, petalMaterial, type Band, type SharedUniforms,
} from './forest/materials';
import { FarParts, MidParts, NearParts, type Materials, type Placement, type Shapes } from './forest/parts';
import { newSeed, seededRandom } from './forest/random';
import { PlantStates } from './forest/states';

// The magic forest: thousands of plants that grow the way living things do.
//
// Each plant is stored as little more than its seed, its place and its age. Growth runs on the
// GPU from a texture of ages (see forest/materials.ts). The meadow is cut into chunks of three
// sizes, one per level of detail:
//  - near chunks, close to the camera, regenerate their plants' full plans from the seeds and
//    draw every branch, leaf and petal; they are built a few plants per frame as the camera
//    approaches and freed behind it. How far full detail reaches adapts each frame to a
//    triangle budget, so a sparse meadow shows it far out and a dense forest keeps it close;
//  - mid chunks hold limbs and small leaf clumps, and far chunks trunks, big leaf clumps and
//    blossom points, all written once at seeding. Far chunks are big, since from afar they are
//    all in view anyway and each costs draw calls.
// Each instance knows its distance band, so a plant shows exactly one level of detail, and
// chunks outside the view or outside every band they hold are not drawn at all.

const BARK_COLORS = [0x6b4a7a, 0x5a3f6e, 0x7a5a6a, 0x4f4a78];
const BLOSSOM_RECORD = 7; // floats per pending blossom: open time, world x y z, colour r g b
// Chunk visibility is chosen from the camera's position at update time, before main moves the
// camera for this frame; this covers how far it can move in one (clamped) frame.
const CAMERA_STEP_SLACK = 2;
const LAND_CELL = 4; // side of the cells that find which plant a landing sparkle fell on
// The near radius shrinks at once when detail gets too dense, and grows back this fast (world
// units per second), so plants don't flicker between levels at a boundary that jitters.
const NEAR_RADIUS_GROWTH = 3;

interface Plant {
  index: number;
  seed: number;
  kind: PlantKind;
  x: number;
  z: number;
  yaw: number;
  bark: THREE.Color;
  age: number;
  boost: number;
  end: number;
  footprint: number;
  bounds: THREE.Sphere; // fully grown, world space
  cost: number; // triangles of its full detail
  blossoms: Float32Array | null; // blossoms yet to open, sorted by open time
  nextBlossom: number; // offset of the next one to open
}

class NearChunk {
  readonly plants: Plant[] = [];
  cost = 0; // triangles of its plants' full detail
  readonly box = new THREE.Box3(); // everything its plants draw, fully grown: for culling
  // Its plants' roots. The shaders pick a plant's detail by its root's distance, so the distance
  // to these is what says whether any plant here can show full detail.
  readonly roots = new THREE.Box3();
  parts: NearParts | null = null;
  built = 0; // plants whose full detail is written, in order
  distance = Infinity; // from the camera to the nearest root, at the last update
}

class Chunk<T> {
  readonly box = new THREE.Box3();
  constructor(readonly parts: T) {}
}

/** Square cells over the ground, created on first use. */
class Grid<T> {
  private readonly cells = new Map<string, T>();
  constructor(private readonly size: number, private readonly make: () => T) {}

  at(x: number, z: number): T {
    return this.cell(Math.floor(x / this.size), Math.floor(z / this.size));
  }

  cell(i: number, j: number): T {
    const key = `${i},${j}`;
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, (c = this.make()));
    return c;
  }

  peek(i: number, j: number): T | undefined {
    return this.cells.get(`${i},${j}`);
  }

  values(): IterableIterator<T> {
    return this.cells.values();
  }
}

/** The plant's fully grown reach around its root and its height, from its plan. */
function extent(plan: PlantPlan): { reach: number; height: number } {
  let reach = 0;
  let height = 0;
  const visit = (x: number, y: number, z: number, pad: number): void => {
    reach = Math.max(reach, Math.hypot(x, z) + pad);
    height = Math.max(height, y + pad);
  };
  for (const s of plan.segments) {
    visit(s.start.x, s.start.y, s.start.z, s.radius);
    visit(s.start.x + s.dir.x * s.length, s.start.y + s.dir.y * s.length, s.start.z + s.dir.z * s.length, s.radius);
  }
  for (const l of plan.leaves) visit(l.at.x, l.at.y, l.at.z, l.size);
  for (const b of plan.blossoms) visit(b.at.x, b.at.y, b.at.z, b.size);
  return { reach, height };
}

/** Distance from `p` to the farthest point of `box`. */
function farthest(box: THREE.Box3, p: THREE.Vector3): number {
  return Math.hypot(
    Math.max(p.x - box.min.x, box.max.x - p.x),
    Math.max(p.y - box.min.y, box.max.y - p.y),
    Math.max(p.z - box.min.z, box.max.z - p.z),
  );
}

export class Forest {
  readonly group = new THREE.Group();
  /** The camera the level of detail is chosen for. Set it before the first update. */
  viewer: THREE.Camera | null = null;
  private readonly plants: Plant[] = [];
  private growing: Plant[] = [];
  private readonly states = new PlantStates();
  private readonly materials: Materials;
  private readonly shapes: Shapes;
  private readonly pixelScale = { value: 1 };
  private readonly near = new Grid(TUNING.forest.nearChunk, () => new NearChunk());
  private readonly mid = new Grid(TUNING.forest.midChunk, () => this.newChunk(new MidParts(this.materials, this.shapes)));
  private readonly far = new Grid(TUNING.forest.farChunk,
    () => this.newChunk(new FarParts(this.materials, this.shapes, (renderer) => this.updatePixelScale(renderer))));
  private readonly landCells = new Grid<Plant[]>(LAND_CELL, () => []);
  private maxFootprint = 0;
  // The near radius moves with how dense the forest around the camera is: full detail reaches as
  // far as its triangle budget allows. The bands are shared by every material that uses them.
  private nearRadius: number = TUNING.forest.nearRadius.min;
  private readonly uNearRadius = { value: this.nearRadius };
  private readonly nearBand: Band = { value: new THREE.Vector2(0, this.nearRadius) };
  private readonly midBand: Band = { value: new THREE.Vector2(this.nearRadius, TUNING.forest.midRadius) };
  private readonly beyondBand: Band = { value: new THREE.Vector2(TUNING.forest.midRadius, Infinity) };
  private readonly farBand: Band = { value: new THREE.Vector2(this.nearRadius, Infinity) };
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly partTriangles: { bark: number; leaf: number; petal: number; core: number };
  // Scratch objects, reused every frame.
  private readonly eye = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly drawingBuffer = new THREE.Vector2();

  constructor(private readonly onBlossomOpen: (at: THREE.Vector3, color: THREE.Color) => void) {
    const shared: SharedUniforms = { uPlantState: this.states.uniform, uNearRadius: this.uNearRadius };
    this.materials = {
      bark: barkMaterial(shared, this.nearBand),
      leaves: leafMaterial(shared, this.nearBand),
      petals: petalMaterial(shared, this.nearBand),
      cores: coreMaterial(shared, this.nearBand),
      trunks: barkMaterial(shared, this.farBand),
      limbs: barkMaterial(shared, this.midBand),
      midClumps: clumpMaterial(shared, this.midBand),
      farClumps: clumpMaterial(shared, this.beyondBand),
      blossoms: blossomPointMaterial(shared, this.farBand, this.pixelScale),
    };
    this.shapes = {
      nearBark: barkGeometry(false),
      farBark: barkGeometry(true),
      leaf: leafGeometry(),
      petal: petalGeometry(),
      core: coreGeometry(),
      clump: clumpGeometry(),
    };
    const triangles = (g: THREE.BufferGeometry): number => (g.index ?? g.getAttribute('position')).count / 3;
    this.partTriangles = {
      bark: triangles(this.shapes.nearBark),
      leaf: triangles(this.shapes.leaf),
      petal: triangles(this.shapes.petal),
      core: triangles(this.shapes.core),
    };
  }

  /** Reports every plant grown enough for its ground to count as forest. */
  forEachGrown(minGrowth: number, visit: (x: number, z: number, radius: number) => void): void {
    for (const p of this.plants) if (p.age >= p.end * minGrowth) visit(p.x, p.z, p.footprint);
  }

  get plantCount(): number {
    return this.plants.length;
  }

  /**
   * A seeding sparkle touched the ground: feed the plant it fell on, or maybe start one.
   * `strength` scales both, so a bloom multiplier makes every sparkle count for more.
   */
  land(x: number, z: number, strength: number): void {
    const sd = TUNING.seeding;
    const fed = this.plantAt(x, z);
    if (fed) {
      fed.boost = Math.min(sd.maxBoost, fed.boost + sd.feedBoost * strength);
      return;
    }
    if (Math.random() < sd.chance * strength) this.seed(this.pickKind(), x, z);
  }

  update(dt: number): void {
    if (!this.viewer) throw new Error('Forest needs a viewer camera before it can choose its level of detail');
    this.grow(dt);
    const eye = this.viewer.getWorldPosition(this.eye);
    for (const chunk of this.near.values()) chunk.distance = chunk.roots.distanceToPoint(eye);
    this.fitNearRadius(this.viewer, dt);
    this.buildNear();
    this.cull(eye);
    this.states.flush();
  }

  /** The earliest-seeded plant whose footprint holds the point, as sparkles always fed. */
  private plantAt(x: number, z: number): Plant | null {
    const ci = Math.floor(x / LAND_CELL);
    const cj = Math.floor(z / LAND_CELL);
    const ring = Math.ceil(this.maxFootprint / LAND_CELL);
    let hit: Plant | null = null;
    for (let i = ci - ring; i <= ci + ring; i++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        for (const p of this.landCells.peek(i, j) ?? []) {
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < p.footprint ** 2 && (!hit || p.index < hit.index)) hit = p;
        }
      }
    }
    return hit;
  }

  private pickKind(): PlantKind {
    let r = Math.random();
    for (const [kind, share] of Object.entries(TUNING.seeding.kinds) as [PlantKind, number][]) {
      if ((r -= share) < 0) return kind;
    }
    return 'tree'; // only reached through float rounding when r lands on the sum of shares
  }

  private seed(kind: PlantKind, x: number, z: number): void {
    const index = this.plants.length;
    this.states.reserve(index);
    const seed = newSeed();
    const plan = generatePlant(kind, seededRandom(seed));
    const yaw = Math.random() * Math.PI * 2;
    const { reach, height } = extent(plan);
    const chunk = this.near.at(x, z);
    const plant: Plant = {
      index, seed, kind, x, z, yaw,
      bark: new THREE.Color(BARK_COLORS[Math.floor(Math.random() * BARK_COLORS.length)]),
      age: 0,
      boost: 0,
      end: plan.end,
      footprint: plan.footprint,
      bounds: new THREE.Sphere(new THREE.Vector3(x, height / 2, z), Math.hypot(reach, height / 2)),
      cost: this.costOf(plan),
      blossoms: this.blossomEvents(plan, x, z, yaw),
      nextBlossom: 0,
    };
    this.plants.push(plant);
    this.growing.push(plant);
    this.states.setAge(index, 0);
    this.states.setResident(index, false);

    const min = new THREE.Vector3(x - reach, 0, z - reach);
    const max = new THREE.Vector3(x + reach, height, z + reach);
    for (const c of [this.mid.at(x, z), this.far.at(x, z)]) {
      c.parts.write(plan, this.placement(plant));
      c.parts.include(plant.bounds);
      c.parts.flush();
      c.box.expandByPoint(min).expandByPoint(max);
    }

    chunk.plants.push(plant);
    chunk.cost += plant.cost;
    chunk.roots.expandByPoint(this.v.set(x, 0, z));
    chunk.box.expandByPoint(min).expandByPoint(max);
    // Sown into detail that is already resident: write it now, since the plan is at hand.
    if (chunk.parts && chunk.built === chunk.plants.length - 1) {
      this.writeNear(chunk, plant, plan);
      chunk.parts.flush();
    }

    this.landCells.at(x, z).push(plant);
    this.maxFootprint = Math.max(this.maxFootprint, plant.footprint);
  }

  private costOf(plan: PlantPlan): number {
    const t = this.partTriangles;
    const petals = plan.blossoms.reduce((n, b) => n + b.petals, 0);
    return plan.segments.length * t.bark + plan.leaves.length * t.leaf + petals * t.petal + plan.blossoms.length * t.core;
  }

  /**
   * Picks the largest near radius whose drawn full detail fits the triangle budget: a sparse
   * meadow shows full detail far out, a dense forest keeps it close. Detail is drawn chunk by
   * chunk, so it counts whole chunks in view, nearest first, as the renderer will draw them.
   */
  private fitNearRadius(viewer: THREE.Camera, dt: number): void {
    const f = TUNING.forest;
    const { min, max } = f.nearRadius;
    this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(viewer.projectionMatrix, viewer.matrixWorldInverse));
    const inView = [...this.near.values()]
      .filter((c) => c.distance < max + CAMERA_STEP_SLACK && this.frustum.intersectsBox(c.box))
      .sort((a, b) => a.distance - b.distance);
    let target: number = max;
    let total = 0;
    for (const chunk of inView) {
      total += chunk.cost;
      if (total > f.nearBudget) {
        // Leave this chunk out: chunks show only within the radius plus the slack.
        target = Math.max(min, Math.min(max, chunk.distance - CAMERA_STEP_SLACK));
        break;
      }
    }
    this.nearRadius = Math.min(target, this.nearRadius + NEAR_RADIUS_GROWTH * dt);
    this.uNearRadius.value = this.nearRadius;
    this.nearBand.value.y = this.midBand.value.x = this.farBand.value.x = this.nearRadius;
  }

  private placement(p: Plant): Placement {
    return { x: p.x, z: p.z, yaw: p.yaw, index: p.index, bark: p.bark };
  }

  /** The moments the plant's blossoms open, with where (world) and in which colour. */
  private blossomEvents(plan: PlantPlan, x: number, z: number, yaw: number): Float32Array | null {
    if (plan.blossoms.length === 0) return null;
    const turn = new THREE.Quaternion().setFromAxisAngle(this.v.set(0, 1, 0), yaw);
    const events = [...plan.blossoms].sort((a, b) => a.birth - b.birth);
    const out = new Float32Array(events.length * BLOSSOM_RECORD);
    events.forEach((b, i) => {
      const at = b.at.clone().applyQuaternion(turn);
      out.set([b.birth + TUNING.growth.budSwell, at.x + x, at.y, at.z + z, b.color.r, b.color.g, b.color.b], i * BLOSSOM_RECORD);
    });
    return out;
  }

  private grow(dt: number): void {
    const decay = Math.exp(-dt / TUNING.seeding.boostDecay);
    for (const p of this.growing) {
      p.boost *= decay;
      p.age = Math.min(p.age + dt * (1 + p.boost), p.end);
      this.states.setAge(p.index, p.age);
      this.openBlossoms(p);
    }
    this.growing = this.growing.filter((p) => p.age < p.end);
  }

  private openBlossoms(p: Plant): void {
    const b = p.blossoms;
    if (!b) return;
    for (; p.nextBlossom < b.length && b[p.nextBlossom] <= p.age; p.nextBlossom += BLOSSOM_RECORD) {
      const o = p.nextBlossom;
      this.onBlossomOpen(this.v.set(b[o + 1], b[o + 2], b[o + 3]), this.color.setRGB(b[o + 4], b[o + 5], b[o + 6]));
    }
    if (p.nextBlossom >= b.length) p.blossoms = null;
  }

  private writeNear(chunk: NearChunk, p: Plant, plan: PlantPlan): void {
    if (!chunk.parts) throw new Error('Near detail written to a chunk that is not resident');
    chunk.parts.write(plan, this.placement(p));
    chunk.parts.include(p.bounds);
    chunk.built++;
    this.states.setResident(p.index, true);
  }

  /**
   * Builds full detail for the chunks the camera is nearing, closest first, within a per-frame
   * time budget, and frees it behind the camera. Until a plant's detail is written its far
   * version stands in, so a slow build is never a hole.
   */
  private buildNear(): void {
    const f = TUNING.forest;
    const want = this.nearRadius + f.prefetch;
    const drop = want + f.evictMargin;
    const queue: NearChunk[] = [];
    for (const chunk of this.near.values()) {
      if (chunk.parts && chunk.distance > drop) this.evict(chunk);
      else if (chunk.distance < want && chunk.built < chunk.plants.length) queue.push(chunk);
    }
    queue.sort((a, b) => a.distance - b.distance);
    const start = performance.now();
    let wrote = false;
    for (const chunk of queue) {
      if (!chunk.parts) {
        chunk.parts = new NearParts(this.materials, this.shapes);
        chunk.parts.addTo(this.group);
      }
      // At least one plant per frame, so detail always arrives however slow the device.
      while (chunk.built < chunk.plants.length && (!wrote || performance.now() - start < f.buildBudgetMs)) {
        const p = chunk.plants[chunk.built];
        this.writeNear(chunk, p, generatePlant(p.kind, seededRandom(p.seed)));
        wrote = true;
      }
      chunk.parts.flush();
      if (chunk.built < chunk.plants.length) return;
    }
  }

  private evict(chunk: NearChunk): void {
    chunk.parts?.dispose();
    chunk.parts = null;
    for (let i = 0; i < chunk.built; i++) this.states.setResident(chunk.plants[i].index, false);
    chunk.built = 0;
  }

  /** Hides chunks whose plants are all outside the distance bands of what they draw. */
  private cull(eye: THREE.Vector3): void {
    const f = TUNING.forest;
    for (const chunk of this.near.values()) {
      chunk.parts?.show(chunk.distance < this.nearRadius + CAMERA_STEP_SLACK);
    }
    for (const chunk of this.mid.values()) chunk.parts.show(chunk.box.distanceToPoint(eye) < f.midRadius + CAMERA_STEP_SLACK);
    for (const chunk of this.far.values()) chunk.parts.showUpTo(farthest(chunk.box, eye) + CAMERA_STEP_SLACK, f.midRadius);
  }

  private newChunk<T extends MidParts | FarParts>(parts: T): Chunk<T> {
    parts.addTo(this.group);
    return new Chunk(parts);
  }

  /** Blossom points are sized in pixels of whatever target the scene is being drawn into. */
  private updatePixelScale(renderer: THREE.WebGLRenderer): void {
    const target = renderer.getRenderTarget();
    this.pixelScale.value = (target ? target.height : renderer.getDrawingBufferSize(this.drawingBuffer).y) / 2;
  }
}
