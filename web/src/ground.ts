import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fertileEdge } from './fertile';
import { FERTILE_GLSL, FIELD_GLSL, NOISE_GLSL } from './glsl';
import { TUNING } from './tuning';

// The ordinary world the magic grows into. A meadow of soil, turf, swaying grass and wild
// bushes, ringed by barren, stony land that stretches to the hills. Nothing here glows except
// where the game paints it: forest ground shimmers teal, and blighted ground turns a dead violet
// and wilts the grass. Grass and bushes live in a tile that repeats forever. Each has a fixed
// world position, but only one tile's worth is drawn, centred ahead of the camera.

const UP = new THREE.Vector3(0, 1, 0);
const COLORS = {
  light: new THREE.Color(0.55, 0.52, 0.7), // moonlight and sky light on flat ground
  blight: new THREE.Color(0x120818),
  blightFront: new THREE.Color(0x9a3cff),
  forestGlow: new THREE.Color(0x2fffc8),
  grassRoot: new THREE.Color(0x1c3320),
  grassTip: new THREE.Color(0x5f8a4c),
  grassDead: new THREE.Color(0x2a2430),
};
const BUSH_EDGE_MARGIN = 1.5; // bushes stop this far inside the meadow's edge

function tilingTexture(base: string, blotches: string[], cracks: number): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable for a ground texture');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // Every mark is drawn at its wrapped copies too, so the texture tiles without seams.
  const wrapped = (draw: (dx: number, dy: number) => void): void => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(dx, dy);
  };
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 4 + Math.random() * 28;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, blotches[i % blotches.length]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    wrapped((dx, dy) => ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2));
  }
  ctx.strokeStyle = 'rgba(10,8,6,0.55)';
  for (let i = 0; i < cracks; i++) {
    const points: [number, number][] = [[Math.random() * size, Math.random() * size]];
    for (let k = 0; k < 6; k++) {
      const [px, py] = points[points.length - 1];
      points.push([px + (Math.random() - 0.5) * 40, py + (Math.random() - 0.5) * 40]);
    }
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    wrapped((dx, dy) => {
      ctx.beginPath();
      points.forEach(([px, py], k) => (k ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
      ctx.stroke();
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A lumpy sphere, smooth (leafy) or faceted (stony). */
function blob(detail: number, lumpiness: number, smooth: boolean): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv');
  // Welded vertices share normals, so the surface shades smoothly; unwelded, it stays faceted.
  geometry = smooth ? mergeVertices(geometry) : geometry;
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const lump = 1 + lumpiness * (Math.sin(v.x * 7.1 + v.y * 3.3) * Math.sin(v.z * 6.7 - v.y * 4.9) + 0.5 * Math.sin(v.x * 17 + v.z * 13));
    pos.setXYZ(i, v.x * lump, v.y * lump, v.z * lump);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const groundVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const groundFragment = /* glsl */ `
  ${NOISE_GLSL}
  ${FERTILE_GLSL}
  ${FIELD_GLSL}
  uniform sampler2D uMeadow, uBarren;
  uniform float uTexTile, uTime;
  uniform vec3 uLight, uBlight, uBlightFront, uForestGlow;
  varying vec3 vWorld;
  void main() {
    vec2 xz = vWorld.xz;
    // Large-scale variation breaks up the texture's repeat over long distances.
    float macro = fbm(xz * 0.015);
    vec3 meadow = texture2D(uMeadow, xz / uTexTile).rgb * (0.7 + 0.6 * macro);
    vec3 barren = texture2D(uBarren, xz / (uTexTile * 1.3)).rgb * (0.65 + 0.7 * fbm(xz * 0.009 + 7.0));
    vec3 col = mix(barren, meadow, fertile(xz));

    vec2 f = field(xz);
    float veins = fbm(xz * 0.8 + uTime * 0.05);
    col = mix(col, uBlight * (0.6 + veins), smoothstep(0.25, 0.7, f.r));
    col *= uLight;
    float front = clamp(1.0 - abs(f.r - 0.5) * 4.0, 0.0, 1.0);
    col += uBlightFront * front * (0.25 + 0.15 * sin(uTime * 2.0 + veins * 6.0));
    col += uForestGlow * f.g * 0.12 * (0.6 + 0.8 * fbm(xz * 0.6 - uTime * 0.08));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const grassVertex = /* glsl */ `
  ${NOISE_GLSL}
  ${FERTILE_GLSL}
  ${FIELD_GLSL}
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
  varying float vBlight;
  void main() {
    // Each blade repeats every uTile units; draw the copy nearest the centre.
    vec2 world = aOffset + uTile * floor((uCenter.xz - aOffset) / uTile + 0.5);
    vec2 f = field(world);
    // Blades shrink to nothing towards the tile's edge, off the meadow, and wilt under blight.
    float fade = 1.0 - smoothstep(uTile * 0.32, uTile * 0.48, distance(world, uCenter.xz));
    float height = aHeight * fade * fertile(world) * (1.0 - 0.7 * f.r);
    float c = cos(aAngle), s = sin(aAngle);
    vec3 p = vec3(position.x * c, position.y * height, position.x * s);
    float wind = sin(uTime * 1.6 + world.x * 0.35 + world.y * 0.22) + 0.5 * sin(uTime * 2.7 + world.y * 0.6);
    p.x += wind * uSway * (1.0 - f.r) * position.y * position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(p.x + world.x, p.y, p.z + world.y, 1.0);
    vHeight = position.y;
    vShade = aShade;
    vBlight = f.r;
  }
`;

const grassFragment = /* glsl */ `
  uniform vec3 uRoot, uTip, uDead;
  varying float vHeight;
  varying float vShade;
  varying float vBlight;
  void main() {
    vec3 col = mix(uRoot, uTip, vHeight) * vShade;
    gl_FragColor = vec4(mix(col, uDead, smoothstep(0.2, 0.7, vBlight)), 1.0);
    #include <colorspace_fragment>
  }
`;

export class Ground {
  readonly group = new THREE.Group();
  private readonly groundMaterial: THREE.ShaderMaterial;
  private readonly grassMaterial: THREE.ShaderMaterial;
  private readonly bushes: THREE.InstancedMesh;
  private readonly bushBlobs: { bush: number; local: THREE.Matrix4 }[] = [];
  private readonly bushOffsets: THREE.Vector2[] = [];
  private readonly bushCount = TUNING.ground.bushes.count;
  private readonly bushAt = new Float32Array(TUNING.ground.bushes.count * 2);
  private readonly bushVisible = new Uint8Array(TUNING.ground.bushes.count);
  private readonly m = new THREE.Matrix4();
  private readonly t = new THREE.Matrix4();

  constructor(field: THREE.Texture) {
    const g = TUNING.ground;
    const shared = {
      uFertileRadius: { value: TUNING.level.fertileRadius },
      uEdgeNoise: { value: TUNING.level.edgeNoise },
      uField: { value: field },
      uFieldSize: { value: TUNING.blight.fieldSize },
      uTime: { value: 0 },
    };

    this.groundMaterial = new THREE.ShaderMaterial({
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      uniforms: {
        ...shared,
        uMeadow: { value: tilingTexture('#26402a', ['#2e4a2c', '#1f3524', '#344d2a', '#3a3a26', '#2a3f33'], 0) },
        uBarren: { value: tilingTexture('#2b2724', ['#35302a', '#211e1b', '#3b342b', '#2a2a2c', '#403a33'], 70) },
        uTexTile: { value: g.textureTile },
        uLight: { value: COLORS.light },
        uBlight: { value: COLORS.blight },
        uBlightFront: { value: COLORS.blightFront },
        uForestGlow: { value: COLORS.forestGlow },
      },
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(g.size, g.size), this.groundMaterial);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    this.grassMaterial = new THREE.ShaderMaterial({
      vertexShader: grassVertex,
      fragmentShader: grassFragment,
      side: THREE.DoubleSide,
      uniforms: {
        ...shared,
        uTime: this.groundMaterial.uniforms.uTime, // one clock for both
        uCenter: { value: new THREE.Vector3() },
        uTile: { value: g.grass.tile },
        uSway: { value: g.grass.sway },
        uRoot: { value: COLORS.grassRoot },
        uTip: { value: COLORS.grassTip },
        uDead: { value: COLORS.grassDead },
      },
    });
    const grass = new THREE.Mesh(this.makeGrassGeometry(), this.grassMaterial);
    grass.frustumCulled = false; // the vertex shader moves every blade, so bounds mean nothing
    this.group.add(grass);

    this.bushes = this.makeBushes();
    this.group.add(this.bushes, this.makeRocks());
  }

  private makeGrassGeometry(): THREE.InstancedBufferGeometry {
    const g = TUNING.ground.grass;
    // A tapered blade: two quads and a tip, in x/y, with y running 0..1 from root to tip.
    const w = g.width / 2;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -w, 0, 0, w, 0, 0, -w * 0.7, 0.45, 0, w * 0.7, 0.45, 0, 0, 1, 0,
    ], 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
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

  private makeBushes(): THREE.InstancedMesh {
    const b = TUNING.ground.bushes;
    const palette = [0x3c6634, 0x4a7a3c, 0x40703a, 0x56843f, 0x355e38].map((c) => new THREE.Color(c));
    for (let bush = 0; bush < b.count; bush++) {
      this.bushOffsets.push(new THREE.Vector2(Math.random() * b.tile, Math.random() * b.tile));
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
        this.bushBlobs.push({ bush, local });
      }
    }
    const mesh = new THREE.InstancedMesh(blob(2, 0.08, true), new THREE.MeshStandardMaterial({ roughness: 0.9 }), this.bushBlobs.length);
    this.bushBlobs.forEach((_, i) => mesh.setColorAt(i, palette[Math.floor(Math.random() * palette.length)]));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Stones scattered over the barren land, fixed in place. */
  private makeRocks(): THREE.InstancedMesh {
    const r = TUNING.ground.rocks;
    const palette = [0x4a443d, 0x3b3833, 0x5a5248, 0x34302c].map((c) => new THREE.Color(c));
    const mesh = new THREE.InstancedMesh(blob(1, 0.15, false), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), r.count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < r.count; i++) {
      let x = 0, z = 0;
      do {
        const a = Math.random() * Math.PI * 2;
        const d = TUNING.level.fertileRadius + Math.random() * (r.outerRadius - TUNING.level.fertileRadius);
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
      } while (Math.hypot(x, z) < fertileEdge(x, z) + r.innerGap);
      // Mostly small stones with the odd boulder.
      const size = r.size * (0.3 + Math.random() ** 3 * 3);
      q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * Math.PI * 2, Math.random()));
      m.compose(new THREE.Vector3(x, size * 0.2, z), q, new THREE.Vector3(size, size * (0.5 + Math.random() * 0.4), size));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, palette[Math.floor(Math.random() * palette.length)]);
    }
    return mesh;
  }

  update(dt: number, center: THREE.Vector3): void {
    this.groundMaterial.uniforms.uTime.value += dt;
    this.grassMaterial.uniforms.uCenter.value.copy(center);

    // Place each bush once (all its blobs share the position), then its blobs.
    const tile = TUNING.ground.bushes.tile;
    for (let bush = 0; bush < this.bushCount; bush++) {
      const offset = this.bushOffsets[bush];
      const x = offset.x + tile * Math.floor((center.x - offset.x) / tile + 0.5);
      const z = offset.y + tile * Math.floor((center.z - offset.y) / tile + 0.5);
      this.bushAt[bush * 2] = x;
      this.bushAt[bush * 2 + 1] = z;
      this.bushVisible[bush] = Math.hypot(x, z) < fertileEdge(x, z) - BUSH_EDGE_MARGIN ? 1 : 0;
    }
    this.bushBlobs.forEach(({ bush, local }, i) => {
      if (this.bushVisible[bush]) this.m.copy(local).premultiply(this.t.makeTranslation(this.bushAt[bush * 2], 0, this.bushAt[bush * 2 + 1]));
      else this.m.makeScale(0, 0, 0);
      this.bushes.setMatrixAt(i, this.m);
    });
    this.bushes.instanceMatrix.needsUpdate = true;
  }
}

