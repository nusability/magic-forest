import * as THREE from 'three';
import { NOISE_GLSL } from './glsl';
import { TUNING } from './tuning';

// The night: a deep sky full of stars with the Milky Way across it, a moon, and a ring of hills
// far away so the eye has somewhere to rest. No fog. The hills only take on a little of the sky's
// colour with distance, the way real mountains pale at night.

export const MOON_DIRECTION = new THREE.Vector3(-0.45, 0.42, -0.79).normalize();
const SKY_COLORS = {
  zenith: new THREE.Color(0x05031a),
  horizon: new THREE.Color(0x2b1a55),
  glow: new THREE.Color(0x5a3a82), // the faint band of light just above the horizon
  moon: new THREE.Color(0xfff2d6),
};
const DOME_RADIUS = 4500;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin the dome to the far plane
  }
`;

const skyFragment = /* glsl */ `
  ${NOISE_GLSL}
  uniform vec3 uZenith, uHorizon, uGlow, uMoonColor, uMoonDir;
  uniform float uTime;
  varying vec3 vDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  // One layer of stars: a jittered point in a few cells of a 3D grid laid over the sky.
  float stars(vec3 dir, float scale, float density, float size) {
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    float h = hash13(cell);
    if (h < 1.0 - density) return 0.0;
    vec3 jitter = vec3(hash13(cell + 1.7), hash13(cell + 4.1), hash13(cell + 9.3)) - 0.5;
    float d = length(fract(p) - 0.5 - jitter * 0.6);
    float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    // A star never draws smaller than about a pixel; a smaller one is dimmed instead, so it
    // stays visible on a phone without growing into a blob on a big screen.
    float pixel = length(fwidth(p));
    float radius = max(size, pixel * 1.2);
    return smoothstep(radius, 0.0, d) * (size / radius) * twinkle * (0.5 + 0.8 * hash13(cell + 2.9));
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = max(dir.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.45));
    col += uGlow * exp(-abs(dir.y) * 14.0) * 0.6;

    // The Milky Way: a soft, mottled band along a tilted great circle.
    vec3 bandNormal = normalize(vec3(0.35, 0.55, 0.76));
    float band = exp(-pow(dot(dir, bandNormal) * 4.5, 2.0));
    float dust = fbm(vec2(atan(dir.z, dir.x) * 6.0, dir.y * 9.0));
    col += vec3(0.18, 0.14, 0.32) * band * (0.35 + dust) * smoothstep(-0.05, 0.25, dir.y);

    float horizonFade = smoothstep(0.0, 0.12, dir.y);
    float s = stars(dir, 160.0, 0.11, 0.09) * 1.2
            + stars(dir, 90.0, 0.06, 0.08) * 1.8
            + stars(dir, 300.0, 0.10 + band * 0.25, 0.12) * 0.8;
    col += vec3(0.95, 0.95, 1.0) * s * horizonFade;

    float m = dot(dir, uMoonDir);
    col += uMoonColor * smoothstep(0.9993, 0.9996, m) * 1.6; // the disc, bright enough to bloom
    col += uMoonColor * pow(max(m, 0.0), 220.0) * 0.35; // its halo
    gl_FragColor = vec4(col, 1.0);
  }
`;

const hillsVertex = /* glsl */ `
  varying vec3 vWorld;
  varying float vHeight;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vHeight = position.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const hillsFragment = /* glsl */ `
  ${NOISE_GLSL}
  uniform vec3 uHorizon;
  uniform float uMaxHeight;
  varying vec3 vWorld;
  varying float vHeight;
  void main() {
    float h = vHeight / uMaxHeight;
    // Linear colour: the output pass brightens dark values a lot, so these are very low.
    vec3 rock = mix(vec3(0.003, 0.004, 0.008), vec3(0.012, 0.014, 0.026), h);
    rock *= 0.8 + 0.4 * fbm(vWorld.xz * 0.01 + vWorld.y * 0.02);
    float distance = length(vWorld.xz - cameraPosition.xz);
    float pale = smoothstep(1200.0, 2800.0, distance) * 0.3;
    gl_FragColor = vec4(mix(rock, uHorizon, pale), 1.0);
  }
`;

function hillsGeometry(): THREE.BufferGeometry {
  const { inner, outer, height, segments } = TUNING.view.hills;
  const rings = 5;
  const positions: number[] = [];
  const index: number[] = [];
  // Layered sines give ridgelines with peaks and saddles, highest in the middle rings.
  const ridge = (a: number, t: number): number => {
    const n = Math.sin(a * 7 + 1.3) * 0.35 + Math.sin(a * 17 + t * 3) * 0.2 + Math.sin(a * 41 + 2.1) * 0.08 + Math.sin(a * 3 - t) * 0.3;
    return Math.max(0, (0.55 + n) * Math.sin(Math.PI * t));
  };
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const radius = inner + (outer - inner) * t;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, ridge(a, t) * height, Math.sin(a) * radius);
    }
  }
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < segments; i++) {
      const a = r * row + i;
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: SKY_COLORS.zenith },
        uHorizon: { value: SKY_COLORS.horizon },
        uGlow: { value: SKY_COLORS.glow },
        uMoonColor: { value: SKY_COLORS.moon },
        uMoonDir: { value: MOON_DIRECTION },
        uTime: { value: 0 },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 24), this.material);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;

    const hills = new THREE.Mesh(
      hillsGeometry(),
      new THREE.ShaderMaterial({
        vertexShader: hillsVertex,
        fragmentShader: hillsFragment,
        uniforms: { uHorizon: { value: SKY_COLORS.horizon }, uMaxHeight: { value: TUNING.view.hills.height } },
      }),
    );
    this.group.add(this.dome, hills);
  }

  update(dt: number, cameraPosition: THREE.Vector3): void {
    this.material.uniforms.uTime.value += dt;
    this.dome.position.copy(cameraPosition);
  }
}
