import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNING } from './tuning';

// The ordinary meadow the magic grows into: a mottled soil-and-turf floor, swaying grass, and
// wild bushes. None of it glows, so the forest stands out against it. Grass and bushes live in
// a tile that repeats forever. Each one has a fixed world position, so they stay put as the
// bird flies over them, but only one tile's worth is ever drawn, centred on the camera.

const UP = new THREE.Vector3(0, 1, 0);

function groundTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable for the ground texture');
  ctx.fillStyle = '#26402a';
  ctx.fillRect(0, 0, size, size);
  const blotches = ['#2e4a2c', '#1f3524', '#344d2a', '#3a3a26', '#2a3f33'];
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 4 + Math.random() * 28;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, blotches[i % blotches.length]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    // Draw each blotch at its wrapped copies too, so the texture tiles without seams.
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A sphere with a lumpy surface, so a cluster of them reads as foliage rather than stone. */
function leafyBlob(): THREE.BufferGeometry {
  // Welded, so normals are shared across faces and the lumps shade smoothly.
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const lump = 1 + 0.12 * Math.sin(v.x * 7.1 + v.y * 3.3) * Math.sin(v.z * 6.7 - v.y * 4.9) + 0.06 * Math.sin(v.x * 17 + v.z * 13);
    pos.setXYZ(i, v.x * lump, v.y * lump, v.z * lump);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const grassVertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec2 aOffset;
  attribute float aHeight;
  attribute float aAngle;
  attribute float aShade;
  uniform vec3 uCenter;
  uniform float uTile;
  uniform float uTime;
  uniform float uSway;
  varying float vHeight;
  varying float vShade;
  void main() {
    // Each blade repeats every uTile units; draw the copy nearest the camera.
    vec2 world = aOffset + uTile * floor((uCenter.xz - aOffset) / uTile + 0.5);
    float c = cos(aAngle), s = sin(aAngle);
    vec3 p = vec3(position.x * c, position.y * aHeight, position.x * s);
    float wind = sin(uTime * 1.6 + world.x * 0.35 + world.y * 0.22) + 0.5 * sin(uTime * 2.7 + world.y * 0.6);
    p.x += wind * uSway * position.y * position.y;
    vec4 mvPosition = viewMatrix * vec4(p.x + world.x, p.y, p.z + world.y, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vHeight = position.y;
    vShade = aShade;
    #include <fog_vertex>
  }
`;

const grassFragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uRoot;
  uniform vec3 uTip;
  varying float vHeight;
  varying float vShade;
  void main() {
    gl_FragColor = vec4(mix(uRoot, uTip, vHeight) * vShade, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class Ground {
  readonly group = new THREE.Group();
  private readonly grassMaterial: THREE.ShaderMaterial;
  private readonly bushes: THREE.InstancedMesh;
  private readonly bushBlobs: { offset: THREE.Vector2; local: THREE.Matrix4 }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly t = new THREE.Matrix4();

  constructor() {
    const g = TUNING.ground;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(g.size, g.size),
      new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    const map = (floor.material as THREE.MeshStandardMaterial).map;
    if (!map) throw new Error('Ground texture missing');
    map.repeat.setScalar(g.size / g.textureTile);
    this.group.add(floor);

    this.grassMaterial = this.makeGrassMaterial();
    const grass = new THREE.Mesh(this.makeGrassGeometry(), this.grassMaterial);
    grass.frustumCulled = false; // the vertex shader moves every blade, so bounds mean nothing
    this.group.add(grass);

    this.bushes = this.makeBushes();
    this.group.add(this.bushes);
  }

  private makeGrassGeometry(): THREE.InstancedBufferGeometry {
    const g = TUNING.ground.grass;
    // A tapered blade: two quads and a tip, in x/y, with y running 0..1 from root to tip.
    const w = g.width / 2;
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([
      -w, 0, 0, w, 0, 0, -w * 0.7, 0.45, 0, w * 0.7, 0.45, 0, 0, 1, 0,
    ], 3));
    blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = blade.index;
    geometry.setAttribute('position', blade.getAttribute('position'));
    const n = g.count;
    const offset = new Float32Array(n * 2);
    const height = new Float32Array(n);
    const angle = new Float32Array(n);
    const shade = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Clumped rather than uniform: real grass grows in tufts with bare patches between.
      const clump = Math.floor(Math.random() * g.clumps);
      const cx = ((clump * 0.618034) % 1) * g.tile;
      const cz = ((clump * 0.414214) % 1) * g.tile;
      const r = Math.random() ** 0.5 * g.clumpRadius;
      const a = Math.random() * Math.PI * 2;
      offset[i * 2] = cx + Math.cos(a) * r;
      offset[i * 2 + 1] = cz + Math.sin(a) * r;
      height[i] = g.height * (0.5 + Math.random());
      angle[i] = Math.random() * Math.PI;
      shade[i] = 0.7 + Math.random() * 0.5;
    }
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 2));
    geometry.setAttribute('aHeight', new THREE.InstancedBufferAttribute(height, 1));
    geometry.setAttribute('aAngle', new THREE.InstancedBufferAttribute(angle, 1));
    geometry.setAttribute('aShade', new THREE.InstancedBufferAttribute(shade, 1));
    geometry.instanceCount = n;
    return geometry;
  }

  private makeGrassMaterial(): THREE.ShaderMaterial {
    const g = TUNING.ground.grass;
    return new THREE.ShaderMaterial({
      vertexShader: grassVertex,
      fragmentShader: grassFragment,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uCenter: { value: new THREE.Vector3() },
          uTile: { value: g.tile },
          uTime: { value: 0 },
          uSway: { value: g.sway },
          uRoot: { value: new THREE.Color(0x1c3320) },
          uTip: { value: new THREE.Color(0x5f8a4c) },
        },
      ]),
    });
  }

  private makeBushes(): THREE.InstancedMesh {
    const b = TUNING.ground.bushes;
    const palette = [0x3c6634, 0x4a7a3c, 0x40703a, 0x56843f, 0x355e38].map((c) => new THREE.Color(c));
    for (let i = 0; i < b.count; i++) {
      const offset = new THREE.Vector2(Math.random() * b.tile, Math.random() * b.tile);
      const size = b.size * (0.5 + Math.random());
      const blobs = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < blobs; k++) {
        const r = size * (0.45 + Math.random() * 0.4);
        const a = Math.random() * Math.PI * 2;
        const d = size * 0.45 * Math.random();
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * d, r * 0.55, Math.sin(a) * d),
          new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI),
          new THREE.Vector3(r, r * (0.6 + Math.random() * 0.3), r),
        );
        this.bushBlobs.push({ offset, local });
      }
    }
    const mesh = new THREE.InstancedMesh(
      leafyBlob(),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      this.bushBlobs.length,
    );
    this.bushBlobs.forEach((_, i) => mesh.setColorAt(i, palette[Math.floor(Math.random() * palette.length)]));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  }

  update(dt: number, center: THREE.Vector3): void {
    const u = this.grassMaterial.uniforms;
    u.uTime.value += dt;
    u.uCenter.value.copy(center);

    const tile = TUNING.ground.bushes.tile;
    this.bushBlobs.forEach(({ offset, local }, i) => {
      const x = offset.x + tile * Math.floor((center.x - offset.x) / tile + 0.5);
      const z = offset.y + tile * Math.floor((center.z - offset.y) / tile + 0.5);
      this.m.copy(local).premultiply(this.t.makeTranslation(x, 0, z));
      this.bushes.setMatrixAt(i, this.m);
    });
    this.bushes.instanceMatrix.needsUpdate = true;
  }
}
