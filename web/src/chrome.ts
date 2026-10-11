import * as THREE from 'three';
import { CRYSTAL_COLORS, type CrystalKind } from './crystals';
import type { Status } from './game';
import { FERTILE_GLSL, FIELD_GLSL, NOISE_GLSL } from './glsl';
import { TUNING } from './tuning';

// The game's chrome, drawn in the world rather than over it. Icons only, no text, and every part
// fades back when it has nothing new to say.
//  - A round minimap, turned so that ahead of the bird is up: the meadow, the blight (violet),
//    the forest (teal), the crystals (dots in their colours) and the bird (an arrow).
//  - Around it, a wreath that blossoms bud by bud as the forest grows; the last blossom wins.
//  - As the blight nears its limit, the map's rim pulses violet.
//  - Every crystal held is a mote of its colour circling the bird.
//  - When the level ends, a replay glyph appears; a tap starts again.

const HUD_DEPTH = 1; // camera-space distance of the overlay plane (just past the near plane)
const MARGIN = 0.07; // of the half-height, from the screen's edges
const MAP = {
  size: 0.62, // diameter, as a share of the half-height
  maxWidthShare: 0.8, // never wider than this share of the half-width (narrow phones)
  worldRadius: 100, // world units from the meadow's centre to the map's rim
  disc: 0.78, // the map's radius inside the quad; the wreath sits outside it
};
const WREATH_BLOSSOMS = 12;
const MAX_CRYSTAL_DOTS = 8; // must match the shader's array size
const REST_OPACITY = 0.6;
const FLASH_SECONDS = 2.5;
const BLIGHT_FLASH_STEP = 0.03; // of the blight limit; a jump this big brings the map forward
const DANGER = 0.75; // of the blight limit; past it the rim pulses and the map stays forward

const MOTE = { radius: 0.07, orbit: 1.5, speed: 1.6, bob: 0.25, glow: 1.6, max: 24 };

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const mapFragment = /* glsl */ `
  ${NOISE_GLSL}
  ${FERTILE_GLSL}
  ${FIELD_GLSL}
  #define DOTS ${MAX_CRYSTAL_DOTS}
  #define BLOSSOMS ${WREATH_BLOSSOMS}.0
  uniform float uWorldRadius, uDisc, uHeading, uProgress, uDanger, uOpacity, uTime, uWon;
  uniform vec2 uBird;
  uniform vec3 uDots[DOTS];      // x, z, 1 when present
  uniform vec3 uDotColors[DOTS];
  varying vec2 vUv;

  // Map space has ahead of the bird pointing up.
  vec2 forwardDir() { return vec2(-sin(uHeading), -cos(uHeading)); }
  vec2 rightDir() { return vec2(cos(uHeading), -sin(uHeading)); }
  vec2 toMap(vec2 xz) { return vec2(dot(xz, rightDir()), dot(xz, forwardDir())) * (uDisc / uWorldRadius); }
  vec2 toWorld(vec2 m) { return (m.x * rightDir() + m.y * forwardDir()) * (uWorldRadius / uDisc); }

  float blossom(vec2 p, float size) {
    float a = atan(p.y, p.x);
    return smoothstep(0.01, -0.01, length(p) - size * (0.62 + 0.38 * cos(5.0 * a)));
  }

  void main() {
    float r = length(vUv);
    vec4 col = vec4(0.0);

    if (r < uDisc) {
      vec2 xz = toWorld(vUv);
      vec2 f = field(xz);
      float meadow = fertile(xz);
      vec3 c = mix(vec3(0.05, 0.04, 0.07), vec3(0.09, 0.2, 0.12), meadow);
      c = mix(c, vec3(0.15, 0.85, 0.65), f.g * meadow);
      c = mix(c, vec3(0.42, 0.1, 0.66), smoothstep(0.3, 0.6, f.r));
      float edge = smoothstep(uDisc - 0.03, uDisc, r);
      col = vec4(c, 0.78 * (1.0 - edge));

      for (int i = 0; i < DOTS; i++) {
        if (uDots[i].z < 0.5) continue;
        float d = length(vUv - toMap(uDots[i].xy));
        col.rgb = mix(col.rgb, uDotColors[i] * 1.4, smoothstep(0.045, 0.025, d));
        col.a = max(col.a, smoothstep(0.045, 0.025, d));
      }

      // The bird: an arrow pointing up (ahead), where the bird is.
      vec2 p = vUv - toMap(uBird);
      float arrow = step(abs(p.x) * 1.7, 0.06 - (p.y + 0.03)) * step(-0.03, p.y);
      col = mix(col, vec4(1.0, 0.97, 0.9, 1.0), arrow);
    }

    // The rim, which pulses violet as the blight nears its limit.
    float rim = smoothstep(0.012, 0.0, abs(r - uDisc));
    vec3 rimColor = mix(vec3(0.8, 0.85, 1.0), vec3(0.75, 0.3, 1.0), uDanger);
    float rimGlow = rim * (0.35 + uDanger * (0.8 + 0.6 * sin(uTime * 6.0)));
    col.rgb += rimColor * rimGlow;
    col.a = max(col.a, rimGlow);

    // The wreath: a faint vine with a blossom slot every 30°, starting at the top, clockwise.
    float ring = (uDisc + 1.0) * 0.5;
    float vine = smoothstep(0.008, 0.0, abs(r - ring)) * 0.35;
    col.rgb += vec3(0.45, 0.85, 0.6) * vine;
    col.a = max(col.a, vine);
    float turn = mod(atan(vUv.x, vUv.y) + 6.2831853, 6.2831853) / 6.2831853; // 0 at the top
    float k = mod(floor(turn * BLOSSOMS + 0.5), BLOSSOMS);
    float a = k / BLOSSOMS * 6.2831853;
    vec2 centre = ring * vec2(sin(a), cos(a));
    float grow = clamp(uProgress * BLOSSOMS - k, 0.0, 1.0);
    float pulse = uWon * 0.25 * sin(uTime * 4.0 + k);
    float bud = smoothstep(0.022, 0.012, length(vUv - centre)) * 0.5;
    float bloom = blossom(vUv - centre, 0.085 * grow);
    vec3 petal = mix(vec3(1.0, 0.55, 0.85), vec3(1.0, 0.9, 0.6), mod(k, 2.0)) * (1.5 + pulse);
    col.rgb = mix(col.rgb, vec3(0.5, 0.75, 0.6), bud * (1.0 - bloom));
    col.rgb = mix(col.rgb, petal, bloom);
    col.a = max(col.a, max(bud, bloom));

    gl_FragColor = vec4(col.rgb, col.a * uOpacity);
  }
`;

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

  private readonly map: THREE.ShaderMaterial;
  private readonly mapMesh: THREE.Mesh;
  private readonly replay = new THREE.Group();
  private readonly replayMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  private readonly motes: THREE.InstancedMesh;
  private readonly moteKinds: CrystalKind[] = [];
  private readonly dots = Array.from({ length: MAX_CRYSTAL_DOTS }, () => new THREE.Vector3());
  private readonly dotColors = Array.from({ length: MAX_CRYSTAL_DOTS }, () => new THREE.Color());

  private blossoms = 0;
  private crystalCount = 0;
  private flash = 0;
  private lastFlashBlight = 0;
  private time = 0;
  private readonly m = new THREE.Matrix4();

  constructor(field: THREE.Texture) {
    this.map = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: mapFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uField: { value: field },
        uFieldSize: { value: TUNING.blight.fieldSize },
        uFertileRadius: { value: TUNING.level.fertileRadius },
        uEdgeNoise: { value: TUNING.level.edgeNoise },
        uWorldRadius: { value: MAP.worldRadius },
        uDisc: { value: MAP.disc },
        uHeading: { value: 0 },
        uBird: { value: new THREE.Vector2() },
        uDots: { value: this.dots },
        uDotColors: { value: this.dotColors },
        uProgress: { value: 0 },
        uDanger: { value: 0 },
        uWon: { value: 0 },
        uOpacity: { value: REST_OPACITY },
        uTime: { value: 0 },
      },
    });
    this.mapMesh = onTop(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.map));

    // A circular arrow: most of a ring, with a head at its open end.
    const arc = Math.PI * 1.6;
    this.replay.add(onTop(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 48, arc), this.replayMaterial)));
    const head = onTop(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.26, 3), this.replayMaterial));
    head.position.set(Math.cos(arc) * 0.5, Math.sin(arc) * 0.5, 0);
    head.rotation.z = arc;
    this.replay.add(head);
    this.replay.visible = false;

    this.overlay.add(this.mapMesh, this.replay);

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
    const size = Math.min(MAP.size * h, MAP.maxWidthShare * w);
    this.mapMesh.scale.setScalar(size);
    this.mapMesh.position.set(-w + m + size / 2, h - m - size / 2, -HUD_DEPTH);
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

  /**
   * forest and blight are shares of the meadow; target and loseAt are the level's limits.
   * crystals lists what's waiting to be collected.
   */
  update(
    dt: number, bird: THREE.Vector3, heading: number,
    forest: number, target: number, blight: number, loseAt: number, status: Status,
    crystals: (visit: (kind: CrystalKind, at: THREE.Vector3) => void) => void,
  ): void {
    this.time += dt;
    const u = this.map.uniforms;
    const won = status === 'won';
    const progress = won ? 1 : Math.min(forest / target, 1);
    const blossoms = Math.floor(progress * WREATH_BLOSSOMS + 1e-6);
    if (blossoms > this.blossoms) this.flash = FLASH_SECONDS;
    this.blossoms = blossoms;

    const cover = status === 'lost' ? 1 : Math.min(blight / loseAt, 1);
    if (cover - this.lastFlashBlight >= BLIGHT_FLASH_STEP) {
      this.lastFlashBlight = cover;
      this.flash = FLASH_SECONDS;
    }
    const danger = THREE.MathUtils.clamp((cover - DANGER) / (1 - DANGER), 0, 1);

    let count = 0;
    crystals((kind, at) => {
      if (count >= MAX_CRYSTAL_DOTS) return;
      this.dots[count].set(at.x, at.z, 1);
      this.dotColors[count].set(CRYSTAL_COLORS[kind]);
      count++;
    });
    for (let i = count; i < MAX_CRYSTAL_DOTS; i++) this.dots[i].z = 0;
    if (count > this.crystalCount) this.flash = FLASH_SECONDS; // a new crystal appeared
    this.crystalCount = count;

    this.flash = Math.max(0, this.flash - dt);
    const forward = won || danger > 0 || status === 'lost';
    u.uOpacity.value = forward ? 1 : REST_OPACITY + (1 - REST_OPACITY) * Math.min(1, this.flash);
    u.uHeading.value = heading;
    u.uBird.value.set(bird.x, bird.z);
    u.uProgress.value = progress;
    u.uDanger.value = status === 'lost' ? 1 : danger;
    u.uWon.value = won ? 1 : 0;
    u.uTime.value = this.time;

    this.replay.visible = status !== 'playing';
    if (this.replay.visible) {
      this.replayMaterial.color.set(won ? 0xffe9a8 : 0xc58cff).multiplyScalar(1.4);
      this.replayMaterial.opacity = 0.6 + 0.4 * Math.sin(this.time * 2.5);
      this.replay.rotation.z = -this.time * 0.6;
    }

    const motes = this.moteKinds.length;
    for (let i = 0; i < motes; i++) {
      const a = this.time * MOTE.speed + (i / motes) * Math.PI * 2;
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
