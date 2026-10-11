import * as THREE from 'three';
import { TUNING } from './tuning';

// Magic orbs float in clusters out on the barren land, and multiplier crystals hang in the air
// here and there. Each cluster and crystal stands under a soft beam of light. The view reaches
// the horizon, so a beam is how you find them from across the meadow.

export type MultiplierKind = 'bloom' | 'wings' | 'thrift' | 'well';

export const MULTIPLIER_INFO: Record<MultiplierKind, { name: string; color: number; blurb: string }> = {
  bloom: { name: 'Bloom', color: 0xff6ec7, blurb: 'every sparkle grows more' },
  wings: { name: 'Wide wings', color: 0x6ef5ff, blurb: 'sparkles spread wider' },
  thrift: { name: 'Thrift', color: 0xffd56e, blurb: 'magic lasts longer' },
  well: { name: 'Deep well', color: 0xb98cff, blurb: 'carry more magic' },
};

export interface Layout {
  clusters: THREE.Vector2[];
  multipliers: { kind: MultiplierKind; at: THREE.Vector3 }[];
}

const ORB_COLOR = new THREE.Color(0xffe9a8);
const ORB_GLOW = 1.6; // above the bloom threshold, so orbs glow
const CRYSTAL_GLOW = 1.5;
const ORB_RADIUS = 0.28;
const CRYSTAL_RADIUS = 0.75;
const BOB = { height: 0.25, speed: 1.4 };
const CRYSTAL_SPIN = 0.9; // radians per second
const BEAM = { radius: 1.2, height: 140, strength: 0.32 };

const beamVertex = /* glsl */ `
  varying float vHeight;
  varying float vRim;
  void main() {
    vHeight = uv.y;
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vRim = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

// Brightest at the ground and down the beam's core, fading upward and towards its edges.
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vHeight;
  varying float vRim;
  void main() {
    float a = pow(1.0 - vHeight, 3.0) * pow(vRim, 2.0) * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

function beam(color: THREE.Color): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(BEAM.radius, BEAM.radius, BEAM.height, 24, 1, true).translate(0, BEAM.height / 2, 0),
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
  return mesh;
}

interface Orb {
  home: THREE.Vector3;
  phase: number;
  respawnAt: number; // 0 while present
}

interface Crystal {
  kind: MultiplierKind;
  mesh: THREE.Mesh;
  beam: THREE.Mesh;
  taken: boolean;
}

export class Pickups {
  readonly group = new THREE.Group();
  private readonly orbs: Orb[] = [];
  private readonly orbMesh: THREE.InstancedMesh;
  private readonly crystals: Crystal[] = [];
  private time = 0;
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();

  constructor(layout: Layout) {
    const o = TUNING.orbs;
    for (const c of layout.clusters) {
      for (let i = 0; i < o.perCluster; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * o.clusterSpread;
        const y = o.heights[0] + Math.random() * (o.heights[1] - o.heights[0]);
        this.orbs.push({ home: new THREE.Vector3(c.x + Math.cos(a) * r, y, c.y + Math.sin(a) * r), phase: Math.random() * 6.3, respawnAt: 0 });
      }
      const b = beam(ORB_COLOR);
      b.position.set(c.x, 0, c.y);
      this.group.add(b);
    }
    this.orbMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(ORB_RADIUS, 2), new THREE.MeshBasicMaterial(), this.orbs.length);
    this.orbMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbMesh.frustumCulled = false;
    const glowing = ORB_COLOR.clone().multiplyScalar(ORB_GLOW);
    this.orbs.forEach((_, i) => this.orbMesh.setColorAt(i, glowing));
    this.group.add(this.orbMesh);

    for (const { kind, at } of layout.multipliers) {
      const color = new THREE.Color(MULTIPLIER_INFO[kind].color);
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(CRYSTAL_RADIUS, 0).scale(0.7, 1.3, 0.7),
        new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(CRYSTAL_GLOW) }),
      );
      mesh.position.copy(at);
      const b = beam(color);
      b.position.set(at.x, 0, at.z);
      this.group.add(mesh, b);
      this.crystals.push({ kind, mesh, beam: b, taken: false });
    }
  }

  /** Moves everything and collects what the bird flies through. */
  update(dt: number, bird: THREE.Vector3, onOrb: (at: THREE.Vector3) => void, onMultiplier: (kind: MultiplierKind, at: THREE.Vector3) => void): void {
    this.time += dt;
    const o = TUNING.orbs;
    this.orbs.forEach((orb, i) => {
      if (orb.respawnAt && this.time >= orb.respawnAt) orb.respawnAt = 0;
      if (orb.respawnAt) {
        this.orbMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        return;
      }
      this.v.copy(orb.home).setY(orb.home.y + Math.sin(this.time * BOB.speed + orb.phase) * BOB.height);
      if (this.v.distanceTo(bird) < o.pickupRadius) {
        orb.respawnAt = this.time + o.respawn;
        onOrb(this.v);
      }
      this.orbMesh.setMatrixAt(i, this.m.makeTranslation(this.v));
    });
    this.orbMesh.instanceMatrix.needsUpdate = true;

    for (const c of this.crystals) {
      if (c.taken) continue;
      c.mesh.rotation.y += CRYSTAL_SPIN * dt;
      if (c.mesh.position.distanceTo(bird) < TUNING.multipliers.pickupRadius) {
        c.taken = true;
        c.mesh.visible = c.beam.visible = false;
        onMultiplier(c.kind, c.mesh.position);
      }
    }
  }
}

/** Orb clusters out beyond the meadow, away from where the blight starts, and crystals placed
 *  to tempt: beyond the orbs (a longer trip), and near the blight (a race). */
export function generateLayout(blightAngle: number): Layout {
  const o = TUNING.orbs;
  const r = TUNING.level.fertileRadius;
  const clusters: THREE.Vector2[] = [];
  const spreadAngle = 1.1; // radians between neighbouring clusters
  for (let i = 0; i < o.clusters; i++) {
    const a = blightAngle + Math.PI + (i - (o.clusters - 1) / 2) * spreadAngle;
    const d = o.clusterDistance[0] + Math.random() * (o.clusterDistance[1] - o.clusterDistance[0]);
    clusters.push(new THREE.Vector2(Math.cos(a) * d, Math.sin(a) * d));
  }
  const height = (o.heights[0] + o.heights[1]) / 2;
  const beyond = (c: THREE.Vector2, extra: number): THREE.Vector3 => {
    const dir = c.clone().normalize();
    return new THREE.Vector3(c.x + dir.x * extra, height, c.y + dir.y * extra);
  };
  const nearBlight = (offset: number, inset: number): THREE.Vector3 =>
    new THREE.Vector3(Math.cos(blightAngle + offset) * (r - inset), height, Math.sin(blightAngle + offset) * (r - inset));
  return {
    clusters,
    multipliers: [
      { kind: 'wings', at: beyond(clusters[0], 18) },
      { kind: 'thrift', at: beyond(clusters[clusters.length - 1], 18) },
      { kind: 'well', at: beyond(clusters[Math.floor(clusters.length / 2)], 24) },
      { kind: 'bloom', at: nearBlight(0.5, 22) },
      { kind: 'bloom', at: nearBlight(-0.5, 22) },
    ],
  };
}
