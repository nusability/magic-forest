import * as THREE from 'three';
import { TUNING } from './tuning';

// Crystals hang in the air over the meadow. Each one stands under a soft beam of light, which is
// how you spot it from across the long view. Fly
// through one and its effect lasts the rest of the level, stacking with any others. New crystals
// keep appearing, often out over open meadow where the wisps roam, so each one is a small risk.

export type CrystalKind = 'swift' | 'calm' | 'time';
export const CRYSTAL_KINDS: CrystalKind[] = ['swift', 'calm', 'time'];
export const CRYSTAL_COLORS: Record<CrystalKind, number> = {
  swift: 0xeef4ff, // faster flight
  calm: 0x6ef5ff, // slower wisps
  time: 0xffd56e, // a later dawn
};

const GLOW = 1.5; // above the bloom threshold, so crystals glow
const RADIUS = 0.75;
const SPIN = 0.9; // radians per second
const BOB = { height: 0.3, speed: 1.2 };
const BEAM = { radius: 1.2, height: 140, strength: 0.32 };

const beamVertex = /* glsl */ `
  varying float vHeight;
  varying float vRim;
  varying float vNear;
  void main() {
    vHeight = uv.y;
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vRim = abs(dot(n, normalize(-mv.xyz)));
    // Seen from close by or from inside, a beam would be a wall of light; it fades out instead.
    vec3 axis = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vNear = smoothstep(4.0, 16.0, length(cameraPosition.xz - axis.xz));
    gl_Position = projectionMatrix * mv;
  }
`;

// Brightest at the ground and down the beam's core, fading upward and towards its edges.
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vHeight;
  varying float vRim;
  varying float vNear;
  void main() {
    float a = pow(1.0 - vHeight, 3.0) * pow(vRim, 2.0) * uStrength * vNear;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

const beamGeometry = new THREE.CylinderGeometry(BEAM.radius, BEAM.radius, BEAM.height, 24, 1, true).translate(0, BEAM.height / 2, 0);
const crystalGeometry = new THREE.OctahedronGeometry(RADIUS, 0).scale(0.7, 1.3, 0.7);

interface Crystal {
  kind: CrystalKind;
  home: THREE.Vector3;
  phase: number;
  gem: THREE.Mesh;
  beam: THREE.Mesh;
}

export class Crystals {
  readonly group = new THREE.Group();
  private readonly live: Crystal[] = [];
  private time = 0;
  private sinceSpawn = 0;

  constructor() {
    for (let i = 0; i < TUNING.crystals.initial; i++) this.spawn(CRYSTAL_KINDS[i % CRYSTAL_KINDS.length]);
  }

  private spawn(kind: CrystalKind): void {
    const c = TUNING.crystals;
    const a = Math.random() * Math.PI * 2;
    const d = c.ring[0] + Math.random() * (c.ring[1] - c.ring[0]);
    const home = new THREE.Vector3(Math.cos(a) * d, c.heights[0] + Math.random() * (c.heights[1] - c.heights[0]), Math.sin(a) * d);
    const color = new THREE.Color(CRYSTAL_COLORS[kind]);
    const gem = new THREE.Mesh(crystalGeometry, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(GLOW) }));
    gem.position.copy(home);
    const beam = new THREE.Mesh(
      beamGeometry,
      new THREE.ShaderMaterial({
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        uniforms: { uColor: { value: color }, uStrength: { value: BEAM.strength } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.set(home.x, 0, home.z);
    this.group.add(gem, beam);
    this.live.push({ kind, home, phase: Math.random() * Math.PI * 2, gem, beam });
  }

  /** The crystals currently waiting to be collected. */
  forEachLive(visit: (kind: CrystalKind, at: THREE.Vector3) => void): void {
    for (const c of this.live) visit(c.kind, c.home);
  }

  private remove(c: Crystal): void {
    this.group.remove(c.gem, c.beam);
    (c.gem.material as THREE.Material).dispose();
    (c.beam.material as THREE.Material).dispose();
    this.live.splice(this.live.indexOf(c), 1);
  }

  /** Animates, spawns, and collects whatever the bird flies through. */
  update(dt: number, bird: THREE.Vector3, onCollect: (kind: CrystalKind, at: THREE.Vector3) => void): void {
    this.time += dt;
    this.sinceSpawn += dt;
    if (this.live.length >= TUNING.crystals.max) this.sinceSpawn = 0;
    else if (this.sinceSpawn >= TUNING.crystals.spawnEvery) {
      this.sinceSpawn = 0;
      this.spawn(CRYSTAL_KINDS[Math.floor(Math.random() * CRYSTAL_KINDS.length)]);
    }
    for (const c of [...this.live]) {
      c.gem.rotation.y += SPIN * dt;
      c.gem.position.y = c.home.y + Math.sin(this.time * BOB.speed + c.phase) * BOB.height;
      if (c.gem.position.distanceTo(bird) < TUNING.multipliers.pickupRadius) {
        onCollect(c.kind, c.gem.position.clone());
        this.remove(c);
      }
    }
  }
}
