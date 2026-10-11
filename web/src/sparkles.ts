import * as THREE from 'three';
import { TUNING } from './tuning';

export interface Emission {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  star: boolean;
  /** Whether landing on the ground seeds or feeds the forest. */
  seeds: boolean;
}

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aStar;
  attribute float aPhase;
  uniform float uTime;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStar;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = mix(1.0, 0.55 + 0.45 * sin(uTime * 9.0 + aPhase), aStar);
    vColor = aColor;
    vAlpha = aAlpha * twinkle;
    vStar = aStar;
    gl_PointSize = aSize * twinkle * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

// A soft round core, plus four thin rays for stars.
const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStar;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = length(p);
    float core = exp(-d * d * 10.0);
    float rays = max(0.0, 1.0 - abs(p.x) * 14.0) * max(0.0, 1.0 - abs(p.y))
               + max(0.0, 1.0 - abs(p.y) * 14.0) * max(0.0, 1.0 - abs(p.x));
    float shape = core + vStar * rays * 0.8;
    if (shape < 0.01) discard;
    gl_FragColor = vec4(vColor * shape * vAlpha * 1.6, 1.0);
  }
`;

/** A fixed pool of glowing points. A dead sparkle has zero alpha and is skipped. */
export class Sparkles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly star: Float32Array;
  private readonly age: Float32Array;
  private readonly landedAt: Float32Array; // age at landing, or -1 while airborne
  private readonly seeds: Uint8Array;
  private readonly alive: Uint8Array;
  private next = 0;
  private time = 0;
  /** Sparkles alive after the last update, for the stats overlay. */
  liveCount = 0;

  constructor(private readonly onLand: (x: number, z: number) => void) {
    const n = TUNING.sparkles.max;
    this.position = new Float32Array(n * 3);
    this.velocity = new Float32Array(n * 3);
    this.color = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.star = new Float32Array(n);
    this.age = new Float32Array(n);
    this.landedAt = new Float32Array(n);
    this.seeds = new Uint8Array(n);
    this.alive = new Uint8Array(n);
    const phase = Float32Array.from({ length: n }, () => Math.random() * Math.PI * 2);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aStar', new THREE.BufferAttribute(this.star, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Point size is in world units; this converts it to pixels for the current viewport. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(e: Emission): void {
    const i = this.next;
    this.next = (this.next + 1) % TUNING.sparkles.max;
    this.position.set([e.position.x, e.position.y, e.position.z], i * 3);
    this.velocity.set([e.velocity.x, e.velocity.y, e.velocity.z], i * 3);
    this.color.set([e.color.r, e.color.g, e.color.b], i * 3);
    this.size[i] = e.star ? TUNING.sparkles.starSize : TUNING.sparkles.size;
    this.star[i] = e.star ? 1 : 0;
    this.alpha[i] = 1;
    this.age[i] = 0;
    this.landedAt[i] = -1;
    this.seeds[i] = e.seeds ? 1 : 0;
    this.alive[i] = 1;
  }

  update(dt: number): void {
    const s = TUNING.sparkles;
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    const dragFactor = Math.exp(-s.drag * dt);
    this.liveCount = 0;
    for (let i = 0; i < s.max; i++) {
      if (!this.alive[i]) continue;
      this.liveCount++;
      this.age[i] += dt;
      const p = i * 3;
      if (this.landedAt[i] >= 0) {
        const glow = 1 - (this.age[i] - this.landedAt[i]) / s.groundGlow;
        this.alpha[i] = Math.max(glow, 0);
        if (glow <= 0) this.kill(i);
        continue;
      }
      this.velocity[p] *= dragFactor;
      this.velocity[p + 2] *= dragFactor;
      this.velocity[p + 1] -= s.gravity * dt;
      this.position[p] += this.velocity[p] * dt;
      this.position[p + 1] += this.velocity[p + 1] * dt;
      this.position[p + 2] += this.velocity[p + 2] * dt;
      if (this.position[p + 1] <= 0) {
        this.position[p + 1] = 0.02;
        this.landedAt[i] = this.age[i];
        if (this.seeds[i]) this.onLand(this.position[p], this.position[p + 2]);
      } else if (this.age[i] > s.life) {
        this.kill(i);
      } else {
        this.alpha[i] = Math.min(1, (s.life - this.age[i]) * 2); // fade over the last half second
      }
    }
    const attrs = this.points.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.aColor.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;
    attrs.aStar.needsUpdate = true;
  }

  private kill(i: number): void {
    this.alive[i] = 0;
    this.alpha[i] = 0;
  }
}
