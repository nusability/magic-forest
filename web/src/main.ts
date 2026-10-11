import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Hello-world scene: the bird flies forward from behind and sheds sparkles that fall to the
// ground. Drag anywhere to steer. Every number here is a sketch value, not a tuned one.
const TUNING = {
  flightSpeed: 6, // world units per second along -z
  flightHeight: 4,
  steerRange: { x: 6, y: 2 }, // how far a full-screen drag moves the bird
  steerEase: 4, // how quickly the bird follows the finger (1/s)
  flapHz: 2.2,
  sparklesPerSecond: 60,
  sparkleSpread: 0.35,
  sparkleCarry: 0.5, // share of the bird's forward speed a sparkle keeps
  bankPerSpeed: 0.08, // radians of roll per unit of sideways speed
  maxBank: 0.6, // radians
  gravity: 3.5,
  sparkleLife: 3, // seconds before a sparkle that hasn't landed fades out
  maxSparkles: 600,
  bloom: { strength: 0.8, radius: 0.5, threshold: 0.55 },
};

const SPARKLE_COLORS = [0xff7ad9, 0xffd36e, 0x7af0ff, 0xb48cff, 0x9effa1].map((c) => new THREE.Color(c));
const SKY = 0x140b2e;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 20, 70);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
const CAMERA_OFFSET = new THREE.Vector3(0, 2.4, 5.5);

scene.add(new THREE.HemisphereLight(0x8a7bff, 0x1e3b2a, 1.2));
const moon = new THREE.DirectionalLight(0xffe9c4, 1.4);
moon.position.set(-4, 10, 6);
scene.add(moon);

// Ground: a large plane that recentres under the bird so the flight never runs out of land.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x23402f, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

function makeBird(): { root: THREE.Group; wings: THREE.Mesh[] } {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 24, 16).scale(1, 0.9, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x3fb8ff, emissive: 0x1a4dff, emissiveIntensity: 0.2 }),
  );
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.7, 12).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xff5fc8, emissive: 0xff2fa0, emissiveIntensity: 0.3 }),
  );
  tail.position.z = 0.75;
  root.add(body, tail);

  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.quadraticCurveTo(0.6, 0.35, 1.3, 0.1);
  wingShape.quadraticCurveTo(0.7, -0.25, 0, -0.3);
  const wingGeometry = new THREE.ShapeGeometry(wingShape).rotateX(-Math.PI / 2);
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd36e,
    emissive: 0xff9a2f,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
  });
  const wings = [1, -1].map((side) => {
    const wing = new THREE.Mesh(wingGeometry, wingMaterial);
    wing.scale.x = side;
    wing.position.x = side * 0.2;
    root.add(wing);
    return wing;
  });
  return { root, wings };
}

const bird = makeBird();
scene.add(bird.root);

function makeSparkleTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable for the sparkle texture');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Sparkles live in a fixed ring buffer of points. A dead sparkle is parked with zero alpha.
const sparklePositions = new Float32Array(TUNING.maxSparkles * 3);
const sparkleColors = new Float32Array(TUNING.maxSparkles * 3);
const sparkleVelocities = new Float32Array(TUNING.maxSparkles * 3);
const sparkleAge = new Float32Array(TUNING.maxSparkles).fill(Infinity);
const sparkleGeometry = new THREE.BufferGeometry();
sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
sparkleGeometry.setAttribute('color', new THREE.BufferAttribute(sparkleColors, 3));
const sparkles = new THREE.Points(
  sparkleGeometry,
  new THREE.PointsMaterial({
    size: 0.14,
    map: makeSparkleTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
sparkles.frustumCulled = false;
scene.add(sparkles);

let nextSparkle = 0;
let sparkleDebt = 0;

function emitSparkle(from: THREE.Vector3): void {
  const i = nextSparkle;
  nextSparkle = (nextSparkle + 1) % TUNING.maxSparkles;
  sparklePositions.set([from.x, from.y - 0.2, from.z + 0.6], i * 3);
  const s = TUNING.sparkleSpread;
  sparkleVelocities.set(
    // Sparkles keep part of the bird's forward speed, so they drift back into view as they fall.
    [(Math.random() - 0.5) * s * 4, -Math.random() * s, -TUNING.flightSpeed * TUNING.sparkleCarry],
    i * 3,
  );
  const color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
  sparkleColors.set([color.r, color.g, color.b], i * 3);
  sparkleAge[i] = 0;
}

function updateSparkles(dt: number): void {
  for (let i = 0; i < TUNING.maxSparkles; i++) {
    if (sparkleAge[i] === Infinity) continue;
    sparkleAge[i] += dt;
    const p = i * 3;
    sparkleVelocities[p + 1] -= TUNING.gravity * dt;
    sparklePositions[p] += sparkleVelocities[p] * dt;
    sparklePositions[p + 1] += sparkleVelocities[p + 1] * dt;
    sparklePositions[p + 2] += sparkleVelocities[p + 2] * dt;
    const landed = sparklePositions[p + 1] <= 0;
    if (landed || sparkleAge[i] > TUNING.sparkleLife) {
      sparkleAge[i] = Infinity;
      sparkleColors.fill(0, p, p + 3); // additive blending: black is invisible
    }
  }
  sparkleGeometry.attributes.position.needsUpdate = true;
  sparkleGeometry.attributes.color.needsUpdate = true;
}

// Steering: the finger's offset from where it touched down moves the bird's target.
const steer = new THREE.Vector2();
let dragStart: THREE.Vector2 | null = null;
let steerAtStart = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragStart = new THREE.Vector2(e.clientX, e.clientY);
  steerAtStart = steer.clone();
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragStart) return;
  const dx = ((e.clientX - dragStart.x) / window.innerWidth) * 2;
  const dy = ((e.clientY - dragStart.y) / window.innerHeight) * 2;
  steer.set(THREE.MathUtils.clamp(steerAtStart.x + dx, -1, 1), THREE.MathUtils.clamp(steerAtStart.y - dy, -1, 1));
});
const endDrag = (): void => {
  dragStart = null;
};
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  TUNING.bloom.strength,
  TUNING.bloom.radius,
  TUNING.bloom.threshold,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// Frames longer than this (a backgrounded tab) are clamped so nothing teleports.
const MAX_FRAME_SECONDS = 0.1;
const timer = new THREE.Timer();
timer.connect(document); // pauses the delta while the page is hidden
let elapsed = 0;

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), MAX_FRAME_SECONDS);
  elapsed += dt;

  const b = bird.root.position;
  b.z -= TUNING.flightSpeed * dt;
  const follow = 1 - Math.exp(-TUNING.steerEase * dt);
  const targetX = steer.x * TUNING.steerRange.x;
  const targetY = TUNING.flightHeight + steer.y * TUNING.steerRange.y;
  const prevX = b.x;
  b.x += (targetX - b.x) * follow;
  b.y += (targetY - b.y) * follow;
  const lateralSpeed = (b.x - prevX) / Math.max(dt, Number.EPSILON);
  bird.root.rotation.z = THREE.MathUtils.clamp(-lateralSpeed * TUNING.bankPerSpeed, -TUNING.maxBank, TUNING.maxBank); // bank into turns

  const flap = Math.sin(elapsed * Math.PI * 2 * TUNING.flapHz) * 0.6;
  bird.wings[0].rotation.z = flap;
  bird.wings[1].rotation.z = -flap;

  sparkleDebt += TUNING.sparklesPerSecond * dt;
  while (sparkleDebt >= 1) {
    emitSparkle(b);
    sparkleDebt -= 1;
  }
  updateSparkles(dt);

  ground.position.set(b.x, 0, b.z);
  camera.position.copy(b).add(CAMERA_OFFSET);
  camera.lookAt(b.x, b.y - 1.2, b.z - 4);

  composer.render();
});
