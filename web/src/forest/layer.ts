import * as THREE from 'three';

// A growable set of instances of one shape, drawn in one call. Each instance's data is written
// once, when its plant is seeded or its chunk is built; the shaders animate it from there.
// Capacity doubles on demand, so a layer never silently refuses an instance.

/** Per-instance float attributes: name -> components. */
export type Layout = Readonly<Record<string, number>>;

const INITIAL_CAPACITY = 64;

export class InstanceLayer {
  readonly object: THREE.Mesh | THREE.Points;
  private geometry: THREE.BufferGeometry;
  private arrays = new Map<string, Float32Array>();
  private capacity = 0;
  private count = 0;
  private flushed = 0; // instances already uploaded
  private readonly bounds = new THREE.Sphere();

  /**
   * `base` is the shape each instance draws; `null` draws each instance as a single point,
   * which needs no instancing at all.
   */
  constructor(private readonly base: THREE.BufferGeometry | null, material: THREE.Material, private readonly layout: Layout) {
    this.geometry = this.makeGeometry(INITIAL_CAPACITY);
    this.object = base ? new THREE.Mesh(this.geometry, material) : new THREE.Points(this.geometry, material);
    // Each layer holds one chunk, so three's own frustum test against `bounds` is the culling.
    this.object.matrixAutoUpdate = false;
  }

  get size(): number {
    return this.count;
  }

  /** Reserves the next instance and returns its index. Write its attributes with `set`. */
  add(): number {
    if (this.count === this.capacity) this.grow();
    return this.count++;
  }

  set(name: string, i: number, a: number, b = 0, c = 0, d = 0): void {
    const array = this.arrays.get(name);
    if (!array) throw new Error(`Forest layer has no attribute ${name}`);
    const n = this.layout[name];
    const o = i * n;
    array[o] = a;
    if (n > 1) array[o + 1] = b;
    if (n > 2) array[o + 2] = c;
    if (n > 3) array[o + 3] = d;
  }

  /** Grows the culling sphere to hold `sphere`. */
  include(sphere: THREE.Sphere): void {
    if (this.bounds.isEmpty()) this.bounds.copy(sphere);
    else this.bounds.union(sphere);
    this.geometry.boundingSphere = this.bounds.clone();
  }

  /** Uploads the instances added since the last flush. */
  flush(): void {
    if (this.flushed === this.count) return;
    for (const [name, n] of Object.entries(this.layout)) {
      const attribute = this.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.addUpdateRange(this.flushed * n, (this.count - this.flushed) * n);
      attribute.needsUpdate = true;
    }
    this.flushed = this.count;
    this.setDrawCount();
  }

  dispose(): void {
    this.geometry.dispose();
  }

  private grow(): void {
    const capacity = this.capacity * 2;
    const old = this.geometry;
    this.geometry = this.makeGeometry(capacity);
    this.object.geometry = this.geometry;
    // Fresh buffers upload whole on first use, so instances already flushed stay drawn.
    old.dispose();
  }

  private makeGeometry(capacity: number): THREE.BufferGeometry {
    const geometry = this.base ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
    if (this.base) {
      // Copies, not shared references: disposing this geometry frees its GPU buffers.
      const index = this.base.getIndex();
      if (index) geometry.setIndex(index.clone());
      for (const [name, attribute] of Object.entries(this.base.attributes)) geometry.setAttribute(name, attribute.clone());
    }
    for (const [name, n] of Object.entries(this.layout)) {
      const array = new Float32Array(capacity * n);
      const old = this.arrays.get(name);
      if (old) array.set(old);
      this.arrays.set(name, array);
      geometry.setAttribute(name, this.base ? new THREE.InstancedBufferAttribute(array, n) : new THREE.BufferAttribute(array, n));
    }
    this.capacity = capacity;
    // Set even while empty, so three never derives bounds from the instance-less base shape.
    geometry.boundingSphere = this.bounds.clone();
    this.geometry = geometry;
    this.setDrawCount();
    return geometry;
  }

  private setDrawCount(): void {
    const drawn = this.flushed;
    if (this.geometry instanceof THREE.InstancedBufferGeometry) this.geometry.instanceCount = drawn;
    else this.geometry.setDrawRange(0, drawn);
  }
}
