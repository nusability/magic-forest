import * as THREE from 'three';
import type { Territory } from './territory';
import { TUNING } from './tuning';

// Blight wisps: dark, violet-rimmed orbs that glide in straight lines over the open meadow and
// bounce off forest and the meadow's edge, as in Qix. They scorch the grass faintly where they
// pass. One touching the bird's open trail shatters it. Straight lines make them readable from
// above, so a player can plan a loop around them.

const CORE_RADIUS = 0.45;
const HALO_SIZE = 3.2;
const BOB = { height: 0.35, speed: 1.7 };
const COLORS = { core: new THREE.Color(0x0a0410), halo: new THREE.Color(0x9a3cff) };
const MAX_SPAWN_TRIES = 200;

const haloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    // A camera-facing quad: offset in view space around the wisp's centre.
    vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * (centre + vec4(position.xy, 0.0, 0.0));
  }
`;

const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float d = length(vUv);
    float ring = exp(-pow((d - 0.32) * 7.0, 2.0));
    float glow = exp(-d * 3.5) * 0.5;
    float flicker = 0.85 + 0.15 * sin(uTime * 7.0 + d * 12.0);
    gl_FragColor = vec4(uColor * (ring + glow) * flicker, 1.0);
  }
`;

interface Wisp {
  at: THREE.Vector3;
  velocity: THREE.Vector2;
  phase: number;
  core: THREE.Mesh;
  halo: THREE.Mesh;
}

export class Wisps {
  readonly group = new THREE.Group();
  private readonly live: Wisp[] = [];
  private readonly coreGeometry = new THREE.IcosahedronGeometry(CORE_RADIUS, 2);
  private readonly coreMaterial = new THREE.MeshBasicMaterial({ color: COLORS.core });
  private readonly haloGeometry = new THREE.PlaneGeometry(HALO_SIZE, HALO_SIZE);
  private readonly haloMaterial = new THREE.ShaderMaterial({
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
    uniforms: { uColor: { value: COLORS.halo }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private sinceAdd = 0;

  constructor(private readonly territory: Territory, bird: THREE.Vector3) {
    for (let i = 0; i < TUNING.wisps.count; i++) this.spawn(bird);
  }

  get positions(): THREE.Vector3[] {
    return this.live.map((w) => w.at);
  }

  private spawn(bird: THREE.Vector3): void {
    for (let tries = 0; tries < MAX_SPAWN_TRIES; tries++) {
      const r = TUNING.level.fertileRadius * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.territory.isOpen(this.territory.cellAt(x, z))) continue;
      if (Math.hypot(x - bird.x, z - bird.z) < TUNING.wisps.minSpawnDistance) continue;
      const heading = Math.random() * Math.PI * 2;
      const core = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
      const halo = new THREE.Mesh(this.haloGeometry, this.haloMaterial);
      halo.frustumCulled = false;
      this.group.add(core, halo);
      this.live.push({
        at: new THREE.Vector3(x, TUNING.wisps.hover, z),
        velocity: new THREE.Vector2(Math.cos(heading), Math.sin(heading)),
        phase: Math.random() * Math.PI * 2,
        core,
        halo,
      });
      return;
    }
    // The meadow is nearly all forest: no room for another wisp, which is fine.
  }

  /** Moves the wisps; calls onTrailHit when one touches the open trail. */
  update(dt: number, time: number, speedFactor: number, bird: THREE.Vector3, onTrailHit: (at: THREE.Vector3) => void): void {
    const w = TUNING.wisps;
    this.haloMaterial.uniforms.uTime.value = time;
    this.sinceAdd += dt;
    if (this.sinceAdd >= w.addEvery && this.live.length < w.max) {
      this.sinceAdd = 0;
      this.spawn(bird);
    }
    const t = this.territory;
    const step = w.speed * speedFactor * dt;
    for (const wisp of this.live) {
      const { at, velocity } = wisp;
      // Bounce: reflect whichever axis would carry it off open meadow.
      if (!t.isOpen(t.cellAt(at.x + velocity.x * step, at.z))) velocity.x = -velocity.x;
      if (!t.isOpen(t.cellAt(at.x, at.z + velocity.y * step))) velocity.y = -velocity.y;
      if (t.isOpen(t.cellAt(at.x + velocity.x * step, at.z + velocity.y * step))) {
        at.x += velocity.x * step;
        at.z += velocity.y * step;
      }
      at.y = w.hover + Math.sin(time * BOB.speed + wisp.phase) * BOB.height;
      wisp.core.position.copy(at);
      wisp.halo.position.copy(at);
      t.scorch(at.x, at.z);
      if (t.onTrail(at.x, at.z)) onTrailHit(at);
    }
  }
}
