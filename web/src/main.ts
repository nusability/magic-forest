import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Bird } from './bird';
import { Chrome } from './chrome';
import { CRYSTAL_COLORS, Crystals } from './crystals';
import { isFertile } from './fertile';
import { Forest } from './forest';
import { Game } from './game';
import { Ground } from './ground';
import { MOON_DIRECTION, Sky } from './sky';
import { Sparkles } from './sparkles';
import { Stats } from './stats';
import { type Claimed, Territory } from './territory';
import { Trail } from './trail';
import { Wisps } from './wisps';
import { SPARKLE_COLORS, TUNING } from './tuning';

// One level, played like Qix. Flying low over open meadow, the bird draws a glowing trail. Close
// it (back into your forest, across itself, or out over the meadow's edge) and everything the
// blight wisps can't reach is claimed and blooms into forest in a wave. A wisp touching the open
// trail shatters it and costs night. Grow the forest over most of the meadow before dawn.
// Crystals: Swift (faster bird), Calm (slower wisps), Time (later dawn). Drag sideways to turn
// and up or down to climb or dive; letting go flies straight and holds altitude. Climbing above
// the drawing height lets the open trail fizzle out. When the level ends, tap to play again.

const FOV = 65;
const DRAG_FULL_SCALE = { x: 0.35, y: 0.3 }; // share of the screen a drag must cover for full steer
const BURST_SPEED = { up: 1.6, scatter: 1.2 };
const WISP_COLOR = 0x9a3cff;
const SHATTER_BURST = 30;
const BLOOM_BURST = 2; // sparkles each plant in a bloom wave releases as it starts
const MOON_DISTANCE = 100; // only the direction matters for a directional light
const DOUBLE_TAP_MS = 350;
const REPLAY_DELAY_S = 1.5; // so a tap still in progress at the end doesn't restart at once
// Frames longer than this (a backgrounded tab) are clamped so nothing teleports.
const MAX_FRAME_SECONDS = 0.1;

// iOS Safari ignores user-scalable=no and touch-action for some gestures (pinch, double-tap,
// long-press selection), so those are cancelled at the source as well.
for (const type of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu', 'selectstart']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = performance.now();
  if (now - lastTouchEnd < DOUBLE_TAP_MS) e.preventDefault(); // the second tap of a double-tap would zoom
  lastTouchEnd = now;
}, { passive: false });

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.info.autoReset = false; // the composer renders several passes; count the whole frame
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, TUNING.view.far);
scene.add(camera); // the chrome overlay rides on it

scene.add(new THREE.HemisphereLight(0x8a7bff, 0x1e3b2a, 1.2));
const moon = new THREE.DirectionalLight(0xffe9c4, 1.4);
moon.position.copy(MOON_DIRECTION).multiplyScalar(MOON_DISTANCE);
scene.add(moon);

const sky = new Sky();
scene.add(sky.group);

const territory = new Territory(isFertile);
const ground = new Ground(territory.texture);
scene.add(ground.group);
const groundCenter = new THREE.Vector3();

const game = new Game();
const chrome = new Chrome(territory.texture);
camera.add(chrome.overlay);
scene.add(chrome.world);
chrome.layout(camera);
const stats = new Stats();

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
forest.viewer = camera; // the forest picks each plant's level of detail for this camera

// Sparkles that land on your own forest feed it and fill its gaps; elsewhere they only glow.
const sparkles = new Sparkles((x, z, vigour) => {
  if (territory.isClaimed(x, z)) forest.land(x, z, vigour);
});
sparkles.setViewport(renderer.domElement.height, FOV);
scene.add(sparkles.points);

const crystals = new Crystals();
scene.add(crystals.group);

const trail = new Trail();
scene.add(trail.mesh);
const wisps = new Wisps(territory, bird.root.position);
scene.add(wisps.group);

// The bloom wave: claimed cells turn to forest ground, and some start a plant, in order of their
// distance from the trail that enclosed them.
const wave: { x: number; z: number; at: number; plant: boolean }[] = [];
let clock = 0;
const alwaysSeed = 1 / TUNING.seeding.chance; // a strength at which land() always seeds open ground
function bloom(cells: Claimed[]): void {
  for (const c of cells) {
    wave.push({ x: c.x, z: c.z, at: clock + c.depth * TUNING.territory.waveDelay, plant: Math.random() < TUNING.territory.plantDensity });
  }
  wave.sort((a, b) => a.at - b.at);
}
function advanceWave(): void {
  let due = 0;
  while (due < wave.length && wave[due].at <= clock) {
    const { x, z, plant } = wave[due++];
    territory.reveal(x, z);
    if (plant) {
      forest.land(x, z, alwaysSeed);
      burst(new THREE.Vector3(x, 0.3, z), randomSparkleColor(), BLOOM_BURST);
    }
  }
  wave.splice(0, due);
}
bloom(territory.claimDisc(0, 0, TUNING.level.startGrove));

function closeTrail(): void {
  bloom(territory.close(wisps.positions));
  trail.clear();
}
function shatterTrail(at: THREE.Vector3): void {
  territory.clearTrail();
  trail.clear();
  game.penalise();
  burst(at, new THREE.Color(WISP_COLOR), SHATTER_BURST);
}

const lastGround = new THREE.Vector2(bird.root.position.x, bird.root.position.z);
/** Draws, closes or drops the trail for this frame's flight. */
function updateTrail(p: THREE.Vector3): void {
  const c = territory.cellAt(p.x, p.z);
  const low = p.y <= TUNING.territory.drawHeight;
  if (territory.hasTrail) {
    if (!low) {
      territory.clearTrail(); // climbing away lets the open trail fizzle out
      trail.clear();
    } else if (!territory.isFertileCell(c) || territory.isClaimed(p.x, p.z)) {
      closeTrail();
    }
  }
  if (low && territory.isOpen(c)) {
    if (!territory.hasTrail) trail.add(lastGround.x, lastGround.y);
    const result = territory.extendTrail(lastGround.x, lastGround.y, p.x, p.z);
    trail.add(p.x, p.z);
    if (result === 'crossed') closeTrail();
  }
  lastGround.set(p.x, p.z);
}

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
let endedFor = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (game.status !== 'playing' && endedFor >= REPLAY_DELAY_S) location.reload();
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
  chrome.layout(camera);
});

const forward = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const right = new THREE.Vector3();
let lastHeading = bird.heading;
let turnLook = 0;
function updateCamera(dt: number, snap: boolean): void {
  const c = TUNING.camera;
  bird.forward(forward);
  const lift = bird.root.position.y - TUNING.flight.startHeight;
  cameraTarget.copy(bird.root.position).addScaledVector(forward, -(c.behind + lift * c.behindPerHeight));
  cameraTarget.y = bird.root.position.y + c.above + lift * c.abovePerHeight;
  if (snap) camera.position.copy(cameraTarget);
  else camera.position.lerp(cameraTarget, 1 - Math.exp(-c.follow * dt));
  const rise = Math.max(lift, 0);
  const turnRate = dt > 0 ? (bird.heading - lastHeading) / dt : 0;
  lastHeading = bird.heading;
  turnLook += (turnRate * c.lookIntoTurn - turnLook) * (1 - Math.exp(-c.follow * dt));
  right.set(-forward.z, 0, forward.x);
  lookTarget.copy(bird.root.position).addScaledVector(forward, c.lookAhead + rise * c.lookAheadPerHeight);
  lookTarget.addScaledVector(right, -turnLook); // heading falls as the bird turns right
  lookTarget.y -= c.lookBelow + rise * c.lookBelowPerHeight;
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

  clock += dt;
  bird.speedFactor = game.speed;
  bird.update(dt, steer);
  const p = bird.root.position;
  emitDebt += TUNING.sparkles.perSecond * dt;
  for (; emitDebt >= 1; emitDebt--) emitFromBird();
  crystals.update(dt, p, (kind, at) => {
    game.collect(kind);
    chrome.addMote(kind);
    burst(at, new THREE.Color(CRYSTAL_COLORS[kind]), TUNING.growth.blossomBurst * 3);
  });
  if (game.status === 'playing') {
    updateTrail(p);
    wisps.update(dt, clock, game.wispSpeed, p, shatterTrail);
    game.update(dt, territory.claimedShare);
  } else {
    endedFor += dt;
  }
  advanceWave();
  territory.update(dt);
  trail.update(clock);
  sparkles.update(dt);
  forest.update(dt);
  updateCamera(dt, false);
  const dawn = THREE.MathUtils.smoothstep(game.night, TUNING.night.dawnFrom, 1);
  sky.setDawn(dawn);
  sky.update(dt, camera.position);
  ground.update(dt, groundCenter.copy(camera.position).addScaledVector(forward, TUNING.ground.lookAhead));
  const progress = game.status === 'won' ? 1 : Math.min(territory.claimedShare / TUNING.level.target, 1);
  chrome.update(dt, p, bird.heading, progress, dawn, game.status, (visit) => {
    crystals.forEachLive((kind, at) => visit(CRYSTAL_COLORS[kind], at));
    for (const w of wisps.positions) visit(WISP_COLOR, w);
  });
  composer.render();
  stats.frame(dt, { renderer, plants: forest.plantCount, sparkles: sparkles.liveCount });
});
