import * as THREE from 'three';
import { TUNING } from './tuning';

// The blight and the forest share one grid laid over the meadow. Blight creeps from cell to
// cell over bare meadow. A cell the forest covers can't be taken, so grown forest is a wall.
// Sparkles that land on blight cleanse it a little. The grid is also a texture (r = blight,
// g = forest) that the ground and grass shaders read, so what you see is the simulation.

const BLIGHTED = 0.5; // a cell at or above this counts as taken, and spreads
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export class Blight {
  readonly texture: THREE.DataTexture;
  private readonly n = TUNING.blight.cells;
  private readonly cellSize = TUNING.blight.fieldSize / TUNING.blight.cells;
  private readonly blight: Float32Array;
  private readonly next: Float32Array;
  private readonly forest: Uint8Array;
  private readonly fertile: Uint8Array;
  private readonly pace: Float32Array; // per-cell speed, so the front advances unevenly
  private readonly pixels: Uint8Array;
  private readonly fertileCount: number;
  private sinceTick = 0;
  blightShare = 0;
  forestShare = 0;

  /** isFertile must match the meadow the shaders draw (see FERTILE_GLSL). */
  constructor(isFertile: (x: number, z: number) => boolean, startAngle: number) {
    const cells = this.n * this.n;
    this.blight = new Float32Array(cells);
    this.next = new Float32Array(cells);
    this.forest = new Uint8Array(cells);
    this.fertile = new Uint8Array(cells);
    this.pace = Float32Array.from({ length: cells }, () => 0.5 + Math.random());
    this.pixels = new Uint8Array(cells * 4);
    let count = 0;
    const r = TUNING.level.fertileRadius;
    const start = new THREE.Vector2(Math.cos(startAngle) * r, Math.sin(startAngle) * r);
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const [x, z] = this.centre(i, j);
        if (!isFertile(x, z)) continue;
        const c = j * this.n + i;
        this.fertile[c] = 1;
        count++;
        if (start.distanceTo(new THREE.Vector2(x, z)) < TUNING.blight.startRadius) this.blight[c] = 1;
      }
    }
    if (count === 0) throw new Error('The blight grid found no fertile meadow to cover');
    this.fertileCount = count;
    this.texture = new THREE.DataTexture(this.pixels, this.n, this.n, THREE.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.refresh();
  }

  private centre(i: number, j: number): [number, number] {
    const half = TUNING.blight.fieldSize / 2;
    return [(i + 0.5) * this.cellSize - half, (j + 0.5) * this.cellSize - half];
  }

  private cellAt(x: number, z: number): number {
    const half = TUNING.blight.fieldSize / 2;
    const i = Math.floor((x + half) / this.cellSize);
    const j = Math.floor((z + half) / this.cellSize);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  isBlighted(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return c >= 0 && this.blight[c] >= BLIGHTED;
  }

  cleanse(x: number, z: number, amount: number): void {
    const c = this.cellAt(x, z);
    if (c >= 0) this.blight[c] = Math.max(0, this.blight[c] - amount);
  }

  /** Marks the ground under a grown plant as forest. */
  private cover(x: number, z: number, radius: number): void {
    const reach = Math.ceil(radius / this.cellSize);
    const c0 = this.cellAt(x, z);
    if (c0 < 0) return;
    const i0 = c0 % this.n;
    const j0 = Math.floor(c0 / this.n);
    for (let j = Math.max(0, j0 - reach); j <= Math.min(this.n - 1, j0 + reach); j++) {
      for (let i = Math.max(0, i0 - reach); i <= Math.min(this.n - 1, i0 + reach); i++) {
        const [cx, cz] = this.centre(i, j);
        if ((cx - x) ** 2 + (cz - z) ** 2 <= radius * radius) this.forest[j * this.n + i] = 1;
      }
    }
  }

  /** Advances the blight. Returns true when the grid ticked, so forest cover is re-read. */
  update(dt: number, recover: (cover: (x: number, z: number, r: number) => void) => void): boolean {
    this.sinceTick += dt;
    const tick = TUNING.blight.tick;
    if (this.sinceTick < tick) return false;
    this.sinceTick -= tick;

    this.forest.fill(0);
    recover((x, z, r) => this.cover(x, z, r));

    const gain = TUNING.blight.spreadRate * tick;
    const n = this.n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        let v = this.blight[c];
        if (this.fertile[c] && !this.forest[c] && v < 1) {
          const fed = v >= BLIGHTED || NEIGHBOURS.some(([di, dj]) => {
            const ii = i + di, jj = j + dj;
            return ii >= 0 && jj >= 0 && ii < n && jj < n && this.blight[jj * n + ii] >= BLIGHTED;
          });
          if (fed) v = Math.min(1, v + gain * this.pace[c]);
        }
        this.next[c] = v;
      }
    }
    this.blight.set(this.next);
    this.refresh();
    return true;
  }

  private refresh(): void {
    let blighted = 0;
    let forested = 0;
    for (let c = 0; c < this.blight.length; c++) {
      if (this.fertile[c]) {
        if (this.blight[c] >= BLIGHTED) blighted++;
        else if (this.forest[c]) forested++;
      }
      this.pixels[c * 4] = Math.round(this.blight[c] * 255);
      this.pixels[c * 4 + 1] = this.forest[c] * 255;
    }
    this.blightShare = blighted / this.fertileCount;
    this.forestShare = forested / this.fertileCount;
    this.texture.needsUpdate = true;
  }
}
