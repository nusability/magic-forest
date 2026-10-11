import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Bird } from './bird';
import { Blight } from './blight';
import { isFertile } from './fertile';
import { Forest } from './forest';
import { Game } from './game';
import { Ground } from './ground';
import { Hud } from './hud';
import { Pickups, generateLayout } from './pickups';
import { MOON_DIRECTION, Sky } from './sky';
import { Sparkles } from './sparkles';
import { SPARKLE_COLORS, TUNING } from './tuning';

// One level. The bird gathers magic from orb clusters out on the barren land and pours it out as
// sparkles while over the meadow. Where they land the forest grows, and grown forest holds back
// a blight creeping across the meadow. Multiplier crystals make every trip count for more.
// Drag sideways to turn and up or down to climb or dive; let go to fly straight.

const FOV = 60;
const DRAG_FULL_SCALE = { x: 0.35, y: 0.3 }; // share of the screen a drag must cover for full steer
const BURST_SPEED = { up: 1.6, scatter: 1.2 };
const MOON_DISTANCE = 100; // only the direction matters for a directional light
// Frames longer than this (a backgrounded tab) are clamped so nothing teleports.
const MAX_FRAME_SECONDS = 0.1;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.info.autoReset = false; // the composer renders several passes; count the whole frame
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, TUNING.view.far);

scene.add(new THREE.HemisphereLight(0x8a7bff, 0x1e3b2a, 1.2));
const moon = new THREE.DirectionalLight(0xffe9c4, 1.4);
moon.position.copy(MOON_DIRECTION).multiplyScalar(MOON_DISTANCE);
scene.add(moon);

const sky = new Sky();
scene.add(sky.group);

const blightAngle = Math.random() * Math.PI * 2;
const blight = new Blight(isFertile, blightAngle);
const ground = new Ground(blight.texture);
scene.add(ground.group);
const groundCenter = new THREE.Vector3();

const game = new Game();
const hud = new Hud();

const bird = new Bird();
scene.add(bird.root);

const sparkleColors = SPARKLE_COLORS.map((c) => new THREE.Color(c));
const randomSparkleColor = (): THREE.Color => sparkleColors[Math.floor(Math.random() * sparkleColors.length)];

function burst(at: THREE.Vector3, color: THREE.Color, count: number): void {
  for (let i = 0; i < count; i++) {
    sparkles.emit({
      position: at,
      velocity: new THREE.Vector3().randomDirection().multiplyScalar(BURST_SPEED.scatter).setY(BURST_SPEED.up * Math.random()),
      color,
      star: Math.random() < TUNING.sparkles.starShare,
      seeds: false,
    });
  }
}

const forest = new Forest((at, color) => burst(at, color, TUNING.growth.blossomBurst));
scene.add(forest.group);

const sparkles = new Sparkles((x, z) => {
  if (blight.isBlighted(x, z)) blight.cleanse(x, z, TUNING.blight.cleansePerSparkle);
  else if (isFertile(x, z)) forest.land(x, z, game.bloom);
});
sparkles.setViewport(renderer.domElement.height, FOV);
scene.add(sparkles.points);

const pickups = new Pickups(generateLayout(blightAngle));
scene.add(pickups.group);
const orbColor = new THREE.Color(0xffe9a8);

const emitPoint = new THREE.Vector3();
const emitVelocity = new THREE.Vector3();
function emitFromBird(): void {
  const s = TUNING.sparkles;
  bird.randomSurfacePoint(emitPoint);
  emitVelocity.copy(bird.velocity).multiplyScalar(s.carry);
  emitVelocity.addScaledVector(new THREE.Vector3().randomDirection(), s.scatter * game.spread * Math.random());
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
  renderer.info.reset();

  bird.update(dt, steer);
  const p = bird.root.position;
  const overMeadow = isFertile(p.x, p.z);
  const sowing = overMeadow && game.sow(dt);
  if (sowing) {
    emitDebt += TUNING.sparkles.perSecond * dt;
    for (; emitDebt >= 1; emitDebt--) emitFromBird();
  }
  pickups.update(
    dt, p,
    (at) => {
      game.gather(TUNING.orbs.value);
      burst(at, orbColor, TUNING.growth.blossomBurst);
    },
    (kind, at) => {
      game.collect(kind);
      hud.multiplierToast(kind);
      burst(at, orbColor, TUNING.growth.blossomBurst * 3);
    },
  );
  sparkles.update(dt);
  forest.update(dt);
  if (game.status === 'playing') {
    blight.update(dt, (cover) => forest.forEachGrown(TUNING.blight.coverAt, cover));
    game.judge(blight.forestShare, blight.blightShare);
  }
  updateCamera(dt, false);
  sky.update(dt, camera.position);
  ground.update(dt, groundCenter.copy(camera.position).addScaledVector(forward, TUNING.ground.lookAhead));
  hud.update(game, blight.forestShare, blight.blightShare, sowing, overMeadow);
  composer.render();
  hud.frame(dt, { renderer, plants: forest.plantCount, sparkles: sparkles.liveCount });
});
