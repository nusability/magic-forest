import * as THREE from 'three';

// The open trail the bird draws on the meadow: a curtain of light rising from the ground and
// fading upward, shimmering along its length, brightest at the newest end. A ribbon on the
// ground would always be behind the chase camera; a curtain shows whenever you turn back towards
// it, which is when you need it to close the loop. It is the thing a wisp can break.

const HEIGHT = 2.6;
const BASE = 0.05; // just off the ground, so it never z-fights
const MIN_SPACING = 0.6; // world units between recorded points
const MAX_POINTS = 4096;
const COLOR = new THREE.Color(0xfff0c0);

const vertex = /* glsl */ `
  attribute float aAlong;
  varying float vAlong;
  varying float vRise;
  void main() {
    vAlong = aAlong;
    vRise = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime, uLength;
  varying float vAlong;
  varying float vRise;
  void main() {
    float core = pow(1.0 - vRise, 2.2) + 0.6 * exp(-vRise * 30.0); // a bright foot, fading up
    float shimmer = 0.75 + 0.25 * sin(vAlong * 1.3 - uTime * 6.0);
    float fresh = 0.55 + 0.45 * smoothstep(uLength - 30.0, uLength, vAlong);
    gl_FragColor = vec4(uColor * core * shimmer * fresh * 1.3, 1.0);
  }
`;

export class Trail {
  readonly mesh: THREE.Mesh;
  private readonly points: THREE.Vector2[] = [];
  private readonly positions = new Float32Array(MAX_POINTS * 2 * 3);
  private readonly along = new Float32Array(MAX_POINTS * 2);
  private readonly uvs = new Float32Array(MAX_POINTS * 2 * 2);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private length = 0;

  constructor() {
    for (let i = 0; i < MAX_POINTS; i++) this.uvs.set([0, 0, 0, 1], i * 4);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlong', new THREE.BufferAttribute(this.along, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    const index: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    this.geometry.setIndex(index);
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uColor: { value: COLOR }, uTime: { value: 0 }, uLength: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Adds the bird's ground point if it has moved far enough from the last one. */
  add(x: number, z: number): void {
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(x - last.x, z - last.y) < MIN_SPACING) return;
    if (this.points.length >= MAX_POINTS) throw new Error(`Trail longer than ${MAX_POINTS} points`);
    if (last) this.length += Math.hypot(x - last.x, z - last.y);
    this.points.push(new THREE.Vector2(x, z));
    this.rebuildTail();
  }

  /** Appends the newest point's foot and top to the curtain. */
  private rebuildTail(): void {
    const n = this.points.length;
    const p = this.points[n - 1];
    this.positions.set([p.x, BASE, p.y, p.x, BASE + HEIGHT, p.y], (n - 1) * 6);
    this.along[(n - 1) * 2] = this.along[(n - 1) * 2 + 1] = this.length;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlong.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
  }

  clear(): void {
    this.points.length = 0;
    this.length = 0;
    this.geometry.setDrawRange(0, 0);
  }

  get lastPoint(): THREE.Vector2 | undefined {
    return this.points[this.points.length - 1];
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uLength.value = this.length;
  }
}
