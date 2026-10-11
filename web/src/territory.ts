import * as THREE from 'three';
import { TUNING } from './tuning';

// One grid over the meadow holds the game's ground truth:
//  - claimed: forest you own;
//  - trail: the open line the bird is drawing, not yet closed;
//  - heat: the faint scorch the wisps leave as they pass (drawn only).
// When a trail closes, the classic Qix rule applies: every meadow cell a wisp can still reach
// stays open, and everything else, the trail included, is claimed. The grid is also a texture
// (r = heat, g = claimed and revealed by the bloom wave, b = trail) for the ground and the minimap.

export interface Claimed {
  x: number;
  z: number;
  /** Cells from the trail, so the bloom can travel inward as a wave. */
  depth: number;
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const TRAIL_STEP = 0.4; // world units between samples when rasterising a trail segment
const TEXTURE_INTERVAL = 0.1; // seconds between texture uploads

export class Territory {
  readonly texture: THREE.DataTexture;
  readonly n = TUNING.territory.cells;
  private readonly cellSize = TUNING.territory.fieldSize / TUNING.territory.cells;
  private readonly fertile: Uint8Array;
  private readonly claimed: Uint8Array;
  private readonly revealed: Uint8Array;
  private readonly trail: Int32Array; // order the cell joined the trail, 0 when not on it
  private readonly heat: Float32Array;
  private readonly pixels: Uint8Array;
  private readonly fertileCount: number;
  private claimedCount = 0;
  private trailSteps = 0;
  private sinceUpload = 0;

  /** isFertile must match the meadow the shaders draw (see FERTILE_GLSL). */
  constructor(isFertile: (x: number, z: number) => boolean) {
    const cells = this.n * this.n;
    this.fertile = new Uint8Array(cells);
    this.claimed = new Uint8Array(cells);
    this.revealed = new Uint8Array(cells);
    this.trail = new Int32Array(cells);
    this.heat = new Float32Array(cells);
    this.pixels = new Uint8Array(cells * 4);
    let count = 0;
    for (let c = 0; c < cells; c++) {
      const [x, z] = this.centre(c);
      if (isFertile(x, z)) {
        this.fertile[c] = 1;
        count++;
      }
    }
    if (count === 0) throw new Error('The territory grid found no fertile meadow');
    this.fertileCount = count;
    this.texture = new THREE.DataTexture(this.pixels, this.n, this.n, THREE.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
  }

  centre(c: number): [number, number] {
    const half = TUNING.territory.fieldSize / 2;
    return [((c % this.n) + 0.5) * this.cellSize - half, (Math.floor(c / this.n) + 0.5) * this.cellSize - half];
  }

  cellAt(x: number, z: number): number {
    const half = TUNING.territory.fieldSize / 2;
    const i = Math.floor((x + half) / this.cellSize);
    const j = Math.floor((z + half) / this.cellSize);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  get claimedShare(): number {
    return this.claimedCount / this.fertileCount;
  }

  get hasTrail(): boolean {
    return this.trailSteps > 0;
  }

  isFertileCell(c: number): boolean {
    return c >= 0 && this.fertile[c] === 1;
  }

  isClaimed(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return c >= 0 && this.claimed[c] === 1;
  }

  isOpen(c: number): boolean {
    return c >= 0 && this.fertile[c] === 1 && this.claimed[c] === 0;
  }

  onTrail(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return c >= 0 && this.trail[c] > 0;
  }

  /** Claims a disc outright, without a wave (the grove you start in). */
  claimDisc(x: number, z: number, radius: number): Claimed[] {
    const out: Claimed[] = [];
    for (let c = 0; c < this.claimed.length; c++) {
      const [cx, cz] = this.centre(c);
      if (!this.isOpen(c) || Math.hypot(cx - x, cz - z) > radius) continue;
      this.claim(c);
      out.push({ x: cx, z: cz, depth: 0 });
    }
    return out;
  }

  private claim(c: number): void {
    this.claimed[c] = 1;
    this.claimedCount++;
  }

  /** Shows a claimed cell as forest ground; called as the bloom wave reaches it. */
  reveal(x: number, z: number): void {
    const c = this.cellAt(x, z);
    if (c >= 0) this.revealed[c] = 1;
  }

  /**
   * Extends the trail along a segment of open meadow. Returns 'crossed' when it runs into an
   * older part of itself, which closes a loop.
   */
  extendTrail(x0: number, z0: number, x1: number, z1: number): 'ok' | 'crossed' {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / TRAIL_STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const c = this.cellAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (!this.isOpen(c)) continue;
      if (this.trail[c] > 0) {
        if (this.trailSteps - this.trail[c] > TUNING.territory.selfCloseSteps) return 'crossed';
        continue;
      }
      this.trail[c] = ++this.trailSteps;
    }
    return 'ok';
  }

  clearTrail(): void {
    this.trail.fill(0);
    this.trailSteps = 0;
  }

  /**
   * Closes the trail: every open cell that no wisp can reach, and the trail itself, become
   * claimed. Returns them with their distance from the trail.
   */
  close(wisps: THREE.Vector3[]): Claimed[] {
    const n = this.n;
    const walls = (c: number): boolean => this.claimed[c] === 1 || this.trail[c] > 0;
    const reached = new Uint8Array(n * n);
    const queue: number[] = [];
    for (const w of wisps) {
      const c = this.cellAt(w.x, w.z);
      if (c >= 0 && this.fertile[c] && !walls(c) && !reached[c]) {
        reached[c] = 1;
        queue.push(c);
      }
    }
    this.flood(queue, (c) => this.fertile[c] === 1 && !walls(c) && !reached[c], (c) => (reached[c] = 1));

    // Distance from the trail, breadth first, through the cells being claimed.
    const depth = new Int32Array(n * n).fill(-1);
    const front: number[] = [];
    for (let c = 0; c < n * n; c++) {
      if (this.trail[c] > 0 && !this.claimed[c]) {
        depth[c] = 0;
        front.push(c);
      }
    }
    const taking = (c: number): boolean => this.isOpen(c) && !reached[c];
    this.flood(front, (c) => depth[c] < 0 && taking(c) && this.trail[c] === 0, (c, from) => (depth[c] = depth[from] + 1));

    const out: Claimed[] = [];
    for (let c = 0; c < n * n; c++) {
      if (!taking(c)) continue;
      this.claim(c);
      const [x, z] = this.centre(c);
      // A pocket walled off by older forest, not touching this trail, blooms at once.
      out.push({ x, z, depth: Math.max(depth[c], 0) });
    }
    this.clearTrail();
    return out;
  }

  /** Breadth-first flood over 4-neighbours from the queued cells. */
  private flood(queue: number[], enter: (c: number) => boolean, visit: (c: number, from: number) => void): void {
    const n = this.n;
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      const i = c % n;
      const j = Math.floor(c / n);
      for (const [di, dj] of NEIGHBOURS) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const next = jj * n + ii;
        if (!enter(next)) continue;
        visit(next, c);
        queue.push(next);
      }
    }
  }

  scorch(x: number, z: number): void {
    const c = this.cellAt(x, z);
    if (c >= 0) this.heat[c] = TUNING.wisps.heat;
  }

  update(dt: number): void {
    const decay = Math.exp(-dt / TUNING.wisps.heatDecay);
    for (let c = 0; c < this.heat.length; c++) this.heat[c] *= decay;
    this.sinceUpload += dt;
    if (this.sinceUpload < TEXTURE_INTERVAL) return;
    this.sinceUpload = 0;
    for (let c = 0; c < this.heat.length; c++) {
      this.pixels[c * 4] = Math.round(this.heat[c] * 255);
      this.pixels[c * 4 + 1] = this.revealed[c] * 255;
      this.pixels[c * 4 + 2] = this.trail[c] > 0 ? 255 : 0;
    }
    this.texture.needsUpdate = true;
  }
}
