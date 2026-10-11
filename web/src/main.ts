import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Bird } from './bird';
import { Forest } from './forest';
import { Sparkles } from './sparkles';
import { SKY, SPARKLE_COLORS, TUNING } from './tuning';

// The bird flies over open ground and sheds sparkles from its whole body. Where they land, the
// forest grows. Drag sideways to turn and up or down to climb or dive; let go to fly straight.

const FOV = 60;
const GROUND_SIZE = 600;
const DRAG_FULL_SCALE = { x: 0.35, y: 0.3 }; // share of the screen a drag must cover for full steer
const BURST_SPEED = { up: 1.6, scatter: 1.2 };
// Frames longer than this (a backgrounded tab) are clamped so nothing teleports.
const MAX_FRAME_SECONDS = 0.1;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 20, 70);

const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight(0x8a7bff, 0x1e3b2a, 1.2));
const moon = new THREE.DirectionalLight(0xffe9c4, 1.4);
moon.position.set(-4, 10, 6);
scene.add(moon);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x23402f, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const bird = new Bird();
scene.add(bird.root);

const sparkleColors = SPARKLE_COLORS.map((c) => new THREE.Color(c));
const randomSparkleColor = (): THREE.Color => sparkleColors[Math.floor(Math.random() * sparkleColors.length)];

const forest = new Forest((at, color) => {
  for (let i = 0; i < TUNING.growth.blossomBurst; i++) {
    sparkles.emit({
      position: at,
      velocity: new THREE.Vector3().randomDirection().multiplyScalar(BURST_SPEED.scatter).setY(BURST_SPEED.up * Math.random()),
      color,
      star: Math.random() < TUNING.sparkles.starShare,
      seeds: false,
    });
  }
});
scene.add(forest.group);

const sparkles = new Sparkles((x, z) => forest.land(x, z));
sparkles.setViewport(renderer.domElement.height, FOV);
scene.add(sparkles.points);

const emitPoint = new THREE.Vector3();
const emitVelocity = new THREE.Vector3();
function emitFromBird(): void {
  const s = TUNING.sparkles;
  bird.randomSurfacePoint(emitPoint);
  emitVelocity.copy(bird.velocity).multiplyScalar(s.carry);
  emitVelocity.addScaledVector(new THREE.Vector3().randomDirection(), s.scatter * Math.random());
  sparkles.emit({
    position: emitPoint,
    velocity: emitVelocity,
    color: randomSparkleColor(),
    star: Math.random() < s.starShare,
    seeds: true,
  });
}

// Steering is the finger's offset from where it touched down; letting go flies straight.
const steer = new THREE.Vector2();
let dragStart: THREE.Vector2 | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragStart = new THREE.Vector2(e.clientX, e.clientY);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragStart) return;
  steer.set(
    THREE.MathUtils.clamp((e.clientX - dragStart.x) / (window.innerWidth * DRAG_FULL_SCALE.x), -1, 1),
    THREE.MathUtils.clamp((dragStart.y - e.clientY) / (window.innerHeight * DRAG_FULL_SCALE.y), -1, 1),
  );
});
const endDrag = (): void => {
  dragStart = null;
  steer.set(0, 0);
};
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const b = TUNING.bloom;
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), b.strength, b.radius, b.threshold));
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  sparkles.setViewport(renderer.domElement.height, FOV);
});

const forward = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
function updateCamera(dt: number, snap: boolean): void {
  const c = TUNING.camera;
  bird.forward(forward);
  cameraTarget.copy(bird.root.position).addScaledVector(forward, -c.behind).setY(bird.root.position.y + c.above);
  if (snap) camera.position.copy(cameraTarget);
  else camera.position.lerp(cameraTarget, 1 - Math.exp(-c.follow * dt));
  lookTarget.copy(bird.root.position).addScaledVector(forward, c.lookAhead);
  lookTarget.y -= c.lookBelow;
  camera.lookAt(lookTarget);
}
updateCamera(0, true);

const timer = new THREE.Timer();
timer.connect(document); // pauses the delta while the page is hidden
let emitDebt = 0;

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), MAX_FRAME_SECONDS);
  if (dt <= 0) return;

  bird.update(dt, steer);
  emitDebt += TUNING.sparkles.perSecond * dt;
  for (; emitDebt >= 1; emitDebt--) emitFromBird();
  sparkles.update(dt);
  forest.update(dt);
  updateCamera(dt, false);
  composer.render();
});
