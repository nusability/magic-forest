import * as THREE from 'three';

// Every plant's live state in one small float texture, one texel per plant:
//   r = age on the plant's growth clock, g = 1 while its near detail is resident.
// The GPU animates growth from it, so a frame uploads a few kilobytes of ages instead of
// rewriting hundreds of thousands of instance matrices.

const WIDTH = 256; // texels per row; rows are added as the forest grows
const INITIAL_ROWS = 16;
const CHANNELS = 2;
// WebGL 2 guarantees textures at least this tall, so the forest holds WIDTH x 2048 = 524,288
// plants on any device: far beyond a level. Past it, reserve() throws rather than drop plants.
const MAX_ROWS = 2048;

export class PlantStates {
  /** Shared by every forest material, so a regrown texture reaches them all at once. */
  readonly uniform: { value: THREE.DataTexture };
  private data: Float32Array;
  private rows = INITIAL_ROWS;
  private dirty = false;

  constructor() {
    this.data = new Float32Array(WIDTH * this.rows * CHANNELS);
    this.uniform = { value: this.makeTexture() };
  }

  get capacity(): number {
    return WIDTH * this.rows;
  }

  /** Makes room for plant `index`, doubling the texture's rows. Fails loudly past the GPU's limit. */
  reserve(index: number): void {
    if (index < this.capacity) return;
    let rows = this.rows;
    while (index >= WIDTH * rows) rows *= 2;
    if (rows > MAX_ROWS) {
      throw new Error(`Forest is full: plant ${index} needs ${rows} state rows, WebGL 2 guarantees ${MAX_ROWS}`);
    }
    const data = new Float32Array(WIDTH * rows * CHANNELS);
    data.set(this.data);
    this.data = data;
    this.rows = rows;
    this.uniform.value.dispose();
    this.uniform.value = this.makeTexture();
  }

  setAge(index: number, age: number): void {
    this.data[index * CHANNELS] = age;
    this.dirty = true;
  }

  setResident(index: number, resident: boolean): void {
    this.data[index * CHANNELS + 1] = resident ? 1 : 0;
    this.dirty = true;
  }

  /** Uploads the texture if anything changed since the last frame. */
  flush(): void {
    if (!this.dirty) return;
    this.uniform.value.needsUpdate = true;
    this.dirty = false;
  }

  private makeTexture(): THREE.DataTexture {
    const texture = new THREE.DataTexture(this.data, WIDTH, this.rows, THREE.RGFormat, THREE.FloatType);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }
}
