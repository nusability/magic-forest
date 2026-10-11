import * as THREE from 'three';
import { NOISE_GLSL } from './glsl';
import { CRYSTAL_COLORS, type CrystalKind } from './crystals';
import type { Status } from './game';

// The game's chrome, drawn in the world rather than over it. Icons only, no text, and every part
// fades back when it has nothing new to say.
//  - A constellation lights up star by star as the forest grows; the last star wins the level.
//  - A small moon is slowly eclipsed as the blight spreads; a full eclipse loses it.
//  - Every crystal held becomes a mote of its colour circling the bird.
//  - When the level ends, a replay glyph appears; a tap starts again.

const HUD_DEPTH = 1; // camera-space distance of the overlay plane (just past the near plane)
const MARGIN = 0.09; // of the half-height, from the screen's edges
const REST_OPACITY = { constellation: 0.45, moon: 0.4 };
const FLASH_SECONDS = 3;
const BLIGHT_FLASH_STEP = 0.03; // of the blight limit; a jump this big brings the moon forward
const DANGER = 0.75; // of the blight limit; past it the moon stays forward and pulses

// A bent line of stars, loosely Aries, in a 1 × 0.5 box.
const CONSTELLATION = [[0, 0.3], [0.17, 0.43], [0.36, 0.47], [0.53, 0.37], [0.68, 0.2], [0.84, 0.1], [1, 0.17]] as const;
const STAR = { size: 0.11, unlit: 0.6, lit: 1.7, color: new THREE.Color(0xfff4d8) };
const LINE_OPACITY = 0.5;

const MOTE = { radius: 0.07, orbit: 1.5, speed: 1.6, bob: 0.25, glow: 1.6, max: 24 };

const starVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const starFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright, uOpacity, uLit;
  varying vec2 vUv;
  // An unlit star is a faint ring, so the shape still to be filled is always readable; a lit
  // one is a bright core with rays. uLit blends between them as the star kindles.
  void main() {
    float d = length(vUv);
    float ring = smoothstep(0.06, 0.0, abs(d - 0.28)) * 0.8;
    float core = exp(-d * d * 18.0);
    float rays = max(0.0, 1.0 - abs(vUv.x) * 18.0) * max(0.0, 1.0 - abs(vUv.y))
               + max(0.0, 1.0 - abs(vUv.y) * 18.0) * max(0.0, 1.0 - abs(vUv.x));
    float shape = mix(ring, core + rays * 0.5, uLit);
    gl_FragColor = vec4(uColor * uBright, shape * uOpacity);
  }
`;

const moonFragment = /* glsl */ `
  ${NOISE_GLSL}
  uniform float uCover, uOpacity, uPulse;
  varying vec2 vUv;
  void main() {
    float r = 0.62;
    float d = length(vUv);
    float disc = smoothstep(r + 0.02, r - 0.02, d);
    vec3 moon = vec3(1.0, 0.96, 0.86) * (0.8 + 0.25 * fbm(vUv * 4.0 + 3.0));
    // The shadow slides in from the left; fully covering at uCover = 1.
    vec2 c = vec2(-2.0 * r * (1.0 - uCover), 0.0);
    float sd = length(vUv - c);
    float shadow = smoothstep(r + 0.02, r - 0.02, sd);
    // Kept under the bloom threshold: it's an icon, not a second moon.
    vec3 col = mix(moon * 0.6, vec3(0.06, 0.015, 0.1), shadow);
    float rim = smoothstep(0.08, 0.0, abs(sd - r)) * disc * uCover;
    col += vec3(0.7, 0.25, 1.0) * rim * (1.0 + uPulse);
    float halo = exp(-max(d - r, 0.0) * 14.0) * (1.0 - disc) * 0.15;
    vec3 haloCol = mix(vec3(1.0, 0.95, 0.85), vec3(0.6, 0.2, 0.9), uCover);
    gl_FragColor = vec4(col * disc + haloCol * halo, (disc + halo) * uOpacity);
  }
`;

function overlayMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

function onTop<T extends THREE.Object3D>(o: T): T {
  o.renderOrder = 1000;
  o.frustumCulled = false;
  return o;
}

export class Chrome {
  /** Add to the camera: its children live in camera space. */
  readonly overlay = new THREE.Group();
  /** Add to the scene: motes around the bird. */
  readonly world = new THREE.Group();

  private readonly constellation = new THREE.Group();
  private readonly stars: THREE.ShaderMaterial[] = [];
  private readonly lines: THREE.LineBasicMaterial[] = [];
  private readonly moon: THREE.ShaderMaterial;
  private readonly moonMesh: THREE.Mesh;
  private readonly replay = new THREE.Group();
  private readonly replayMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  private readonly motes: THREE.InstancedMesh;
  private readonly moteKinds: CrystalKind[] = [];

  private lit = 0;
  private constellationFlash = 0;
  private moonFlash = 0;
  private lastFlashBlight = 0;
  private time = 0;
  private readonly m = new THREE.Matrix4();

  constructor() {
    const starGeometry = new THREE.PlaneGeometry(1, 1);
    CONSTELLATION.forEach(([x, y], i) => {
      const material = overlayMaterial(starFragment, {
        uColor: { value: STAR.color },
        uBright: { value: STAR.unlit },
        uLit: { value: 0 },
        uOpacity: { value: REST_OPACITY.constellation },
      });
      const star = onTop(new THREE.Mesh(starGeometry, material));
      star.position.set(x, y, 0);
      star.scale.setScalar(STAR.size * 2.5);
      this.constellation.add(star);
      this.stars.push(material);
      if (i === 0) return;
      const [px, py] = CONSTELLATION[i - 1];
      const line = new THREE.LineBasicMaterial({ color: STAR.color, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
      this.constellation.add(onTop(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(px, py, 0), new THREE.Vector3(x, y, 0)]), line)));
      this.lines.push(line);
    });

    this.moon = overlayMaterial(moonFragment, { uCover: { value: 0 }, uOpacity: { value: REST_OPACITY.moon }, uPulse: { value: 0 } });
    this.moonMesh = onTop(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.moon));

    // A circular arrow: most of a ring, with a head at its open end.
    const arc = Math.PI * 1.6;
    this.replay.add(onTop(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 48, arc), this.replayMaterial)));
    const head = onTop(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.26, 3), this.replayMaterial));
    head.position.set(Math.cos(arc) * 0.5, Math.sin(arc) * 0.5, 0);
    head.rotation.z = arc;
    this.replay.add(head);
    this.replay.visible = false;

    this.overlay.add(this.constellation, this.moonMesh, this.replay);

    this.motes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(MOTE.radius, 1), new THREE.MeshBasicMaterial(), MOTE.max);
    this.motes.count = 0;
    this.motes.frustumCulled = false;
    this.world.add(this.motes);
  }

  /** Places the overlay for the camera's current field of view and aspect. */
  layout(camera: THREE.PerspectiveCamera): void {
    const h = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * HUD_DEPTH;
    const w = h * camera.aspect;
    const m = MARGIN * h;
    const moonSize = h * 0.15;
    this.moonMesh.scale.setScalar(moonSize);
    this.moonMesh.position.set(-w + m + moonSize / 2, h - m - moonSize / 2, -HUD_DEPTH);
    // The constellation takes the rest of the top edge, right of the moon, centred where it fits.
    const left = -w + m + moonSize + m;
    const width = Math.min(w - m - left, h * 0.9);
    this.constellation.scale.setScalar(width);
    this.constellation.position.set(Math.max(left, -width / 2), h - m - width * 0.5, -HUD_DEPTH);
    this.replay.scale.setScalar(h * 0.22);
    this.replay.position.set(0, 0, -HUD_DEPTH);
  }

  addMote(kind: CrystalKind): void {
    if (this.moteKinds.length >= MOTE.max) return;
    this.motes.setColorAt(this.moteKinds.length, new THREE.Color(CRYSTAL_COLORS[kind]).multiplyScalar(MOTE.glow));
    this.moteKinds.push(kind);
    this.motes.count = this.moteKinds.length;
    if (this.motes.instanceColor) this.motes.instanceColor.needsUpdate = true;
  }

  /** forest and blight are shares of the meadow; target and loseAt are the level's limits. */
  update(dt: number, bird: THREE.Vector3, forest: number, target: number, blight: number, loseAt: number, status: Status): void {
    this.time += dt;
    const progress = status === 'won' ? 1 : Math.min(forest / target, 1);
    const n = CONSTELLATION.length;
    const lit = Math.floor(progress * n + 1e-6);
    if (lit > this.lit) this.constellationFlash = FLASH_SECONDS;
    this.lit = lit;
    this.constellationFlash = Math.max(0, this.constellationFlash - dt);

    const won = status === 'won';
    const constellationOpacity = won ? 1 : REST_OPACITY.constellation + (1 - REST_OPACITY.constellation) * Math.min(1, this.constellationFlash);
    this.stars.forEach((s, i) => {
      const pulse = won ? 0.3 * Math.sin(this.time * 4 + i) : 0;
      const kindle = i < lit ? 1 : i === lit ? (progress * n - lit) * 0.5 : 0; // the next star kindles
      s.uniforms.uLit.value = kindle;
      s.uniforms.uBright.value = STAR.unlit + (STAR.lit - STAR.unlit) * kindle + pulse;
      s.uniforms.uOpacity.value = constellationOpacity;
    });
    this.lines.forEach((l, i) => (l.opacity = i + 1 < lit ? LINE_OPACITY * constellationOpacity : 0));

    const cover = status === 'lost' ? 1 : Math.min(blight / loseAt, 1);
    if (cover - this.lastFlashBlight >= BLIGHT_FLASH_STEP) {
      this.lastFlashBlight = cover;
      this.moonFlash = FLASH_SECONDS;
    }
    this.moonFlash = Math.max(0, this.moonFlash - dt);
    const danger = cover >= DANGER || status === 'lost';
    const pulse = danger ? 0.5 + 0.5 * Math.sin(this.time * 5) : 0;
    this.moon.uniforms.uCover.value = cover;
    this.moon.uniforms.uPulse.value = pulse;
    this.moon.uniforms.uOpacity.value = danger ? 1 : REST_OPACITY.moon + (1 - REST_OPACITY.moon) * Math.min(1, this.moonFlash);

    this.replay.visible = status !== 'playing';
    if (this.replay.visible) {
      this.replayMaterial.color.set(won ? 0xffe9a8 : 0xc58cff).multiplyScalar(1.4);
      this.replayMaterial.opacity = 0.6 + 0.4 * Math.sin(this.time * 2.5);
      this.replay.rotation.z = -this.time * 0.6;
    }

    const count = this.moteKinds.length;
    for (let i = 0; i < count; i++) {
      const a = this.time * MOTE.speed + (i / count) * Math.PI * 2;
      this.m.makeTranslation(
        bird.x + Math.cos(a) * MOTE.orbit,
        bird.y + Math.sin(this.time * 2 + i) * MOTE.bob,
        bird.z + Math.sin(a) * MOTE.orbit,
      );
      this.motes.setMatrixAt(i, this.m);
    }
    this.motes.instanceMatrix.needsUpdate = true;
  }
}
