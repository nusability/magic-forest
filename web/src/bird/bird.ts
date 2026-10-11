import * as THREE from 'three';
import { TUNING } from '../tuning';
import { bodyGeometry, boneCapsuleGeometry, contourLayout, headContourLayout, headGeometry } from './anatomy';
import {
  BIRD_SCALE,
  EMISSION,
  FLUTTER,
  GLIDE,
  HEAD_MOTION,
  POSTURE,
  STROKE,
  TAIL,
  TURN,
  VANE,
  WING,
} from './constants';
import { contourFeatherGeometry, contourProfile, flightFeatherGeometry, vaneProfile } from './featherGeometry';
import {
  BONE,
  Skeleton,
  createWingPose,
  featherLayout,
  featherMatrix,
  mirrorX,
  poseFeather,
  type FeatherDef,
  type TailPose,
  type WingPose,
} from './plumage';
import { createFeatherMaterial, createSkinMaterial } from './plumageMaterial';

// The hero bird. Flight itself (yaw, altitude, velocity, bank) is the same simple model as
// before, driven by TUNING.flight. On top of it sits a rig: a flap-glide wing stroke with real
// shoulder, elbow and wrist joints, a tail that fans and twists into turns, a body that pitches
// with the climb, and a head that holds its gaze level and looks into the turn.
//
// Draw calls: torso, head, flight feathers, contour feathers, wing-bone capsules.

const WING_BONES = [BONE.humerus, BONE.forearm, BONE.hand] as const;
const WING_BONE_LENGTHS = [WING.humerus, WING.forearm, WING.hand];
const SIDES = [1, -1] as const;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // per-feather phases that never line up

const color = new THREE.Color();
const scratch = new THREE.Matrix4();
const scratchQ = new THREE.Quaternion();
const scratchQ2 = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const posed = new Float32Array(4);

export class Bird {
  readonly root = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  heading = 0; // yaw in radians; 0 flies towards -z
  private yawRate = 0;
  private elapsed = 0;

  private readonly body = new THREE.Group(); // pitches with the climb and bobs with the stroke
  private readonly head: THREE.Mesh;
  private readonly headGeometry: THREE.BufferGeometry;
  private readonly feathers: THREE.InstancedMesh;
  private readonly contours: THREE.InstancedMesh;
  private readonly capsules: THREE.InstancedMesh;
  private readonly uniforms = { uTime: { value: 0 }, uAirspeed: { value: 1 } };

  private readonly defs: FeatherDef[];
  private readonly dyn: THREE.InstancedBufferAttribute;
  private readonly featherCdf: Float32Array;
  private readonly contourMatrices: Float32Array;
  private readonly contourHalfWidths: Float32Array;
  private readonly contourBends: Float32Array;
  private readonly headContourStart: number;
  private readonly headContourLocal: THREE.Matrix4[];

  private readonly skeleton = new Skeleton();
  private readonly wings: [WingPose, WingPose] = [createWingPose(), createWingPose()];
  private readonly tail: TailPose = { fan: TAIL.fanGlide, pitch: TAIL.droop, yaw: 0, twist: 0 };
  private readonly headQuaternion = new THREE.Quaternion();

  // Flap-glide state.
  private phase = 0;
  private intensity = 1; // 0 gliding, 1 full stroke
  private flapping = true;
  private cyclesLeft: number = GLIDE.cyclesMax;
  private glideLeft = 0;
  private pitch = 0;
  private look = 0;

  constructor() {
    this.root.rotation.order = 'YXZ'; // yaw, then roll about the bird's own axis
    this.root.position.y = TUNING.flight.baseHeight;
    this.root.add(this.body);
    this.body.scale.setScalar(BIRD_SCALE);

    const skin = createSkinMaterial();
    const featherMaterial = createFeatherMaterial(this.uniforms, false);

    const torso = new THREE.Mesh(bodyGeometry(), skin);
    this.headGeometry = headGeometry();
    this.head = new THREE.Mesh(this.headGeometry, skin);
    this.head.matrixAutoUpdate = false;

    // Flight feathers, coverts, scapulars, tail and crest: one instanced draw.
    this.defs = featherLayout();
    const n = this.defs.length;
    const flight = flightFeatherGeometry();
    const colA = new Float32Array(n * 4);
    const colB = new Float32Array(n * 3);
    const tip = new Float32Array(n * 4);
    const shape = new Float32Array(n * 4);
    this.featherCdf = new Float32Array(n);
    let area = 0;
    this.defs.forEach((d, i) => {
      color.setHex(d.colours.base).toArray(colA, i * 4);
      colA[i * 4 + 3] = i * GOLDEN_ANGLE;
      color.setHex(d.colours.tip).toArray(colB, i * 3);
      color.setHex(d.colours.accent).toArray(tip, i * 4);
      tip[i * 4 + 3] = d.colours.glow;
      shape.set([d.outer * (d.side === -1 ? -1 : 1), d.inner, d.emargination, d.sweep], i * 4);
      area += d.length * (d.outer + d.inner);
      this.featherCdf[i] = area;
    });
    for (let i = 0; i < n; i++) this.featherCdf[i] /= area;
    flight.setAttribute('aColA', new THREE.InstancedBufferAttribute(colA, 4));
    flight.setAttribute('aColB', new THREE.InstancedBufferAttribute(colB, 3));
    flight.setAttribute('aTip', new THREE.InstancedBufferAttribute(tip, 4));
    flight.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
    this.dyn = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    this.dyn.setUsage(THREE.DynamicDrawUsage);
    flight.setAttribute('aDyn', this.dyn);
    this.feathers = new THREE.InstancedMesh(flight, featherMaterial, n);
    this.feathers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Body contour feathers never move against the torso, so they are laid once. The head's
    // follow the head: their pivot-space matrices are kept and re-posed each frame.
    const bodyLayout = contourLayout();
    const headLayout = headContourLayout();
    this.headContourStart = bodyLayout.length;
    this.headContourLocal = headLayout.map((c) => c.matrix.clone());
    const layout = [...bodyLayout, ...headLayout];
    const m = layout.length;
    const contour = contourFeatherGeometry();
    const cA = new Float32Array(m * 4);
    const cB = new Float32Array(m * 3);
    const cTip = new Float32Array(m * 4);
    const cShape = new Float32Array(m * 4);
    const cDyn = new Float32Array(m * 2);
    this.contours = new THREE.InstancedMesh(contour, createFeatherMaterial(this.uniforms, true), m);
    this.contours.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // the head's subset moves
    this.contourMatrices = this.contours.instanceMatrix.array as Float32Array;
    this.contourHalfWidths = new Float32Array(m);
    this.contourBends = new Float32Array(m);
    layout.forEach((c, i) => {
      this.contours.setMatrixAt(i, c.matrix);
      c.base.toArray(cA, i * 4);
      cA[i * 4 + 3] = i * GOLDEN_ANGLE;
      c.tip.toArray(cB, i * 3);
      c.tip.toArray(cTip, i * 4);
      cShape.set([c.halfWidth, c.halfWidth, 0, 0], i * 4);
      cDyn[i * 2] = c.bend;
      cDyn[i * 2 + 1] = FLUTTER.contour;
      this.contourHalfWidths[i] = c.halfWidth;
      this.contourBends[i] = c.bend;
    });
    contour.setAttribute('aColA', new THREE.InstancedBufferAttribute(cA, 4));
    contour.setAttribute('aColB', new THREE.InstancedBufferAttribute(cB, 3));
    contour.setAttribute('aTip', new THREE.InstancedBufferAttribute(cTip, 4));
    contour.setAttribute('aShape', new THREE.InstancedBufferAttribute(cShape, 4));
    contour.setAttribute('aDyn', new THREE.InstancedBufferAttribute(cDyn, 2));

    this.capsules = new THREE.InstancedMesh(boneCapsuleGeometry(), skin, WING_BONES.length * SIDES.length);
    this.capsules.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // The rig moves every part each frame; bounds computed at rest would cull a raised wing.
    for (const mesh of [torso, this.head, this.feathers, this.contours, this.capsules]) {
      mesh.frustumCulled = false;
      this.body.add(mesh);
    }
    this.pose(0, 0, 0, 1);
    this.root.updateMatrixWorld(true);
  }

  /** steer.x in [-1, 1] turns (right is positive); steer.y in [-1, 1] climbs. */
  update(dt: number, steer: THREE.Vector2): void {
    const f = TUNING.flight;
    this.elapsed += dt;
    const ease = 1 - Math.exp(-f.steerEase * dt);
    this.yawRate += (-steer.x * f.maxYawRate - this.yawRate) * ease;
    this.heading += this.yawRate * dt;

    const p = this.root.position;
    const targetY = f.baseHeight + steer.y * f.heightRange;
    const prevY = p.y;
    p.y += (targetY - p.y) * ease;
    this.velocity.set(-Math.sin(this.heading) * f.speed, (p.y - prevY) / dt, -Math.cos(this.heading) * f.speed);
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;

    this.root.rotation.set(0, this.heading, this.yawRate * f.bankPerYawRate);

    const turn = THREE.MathUtils.clamp(this.yawRate / f.maxYawRate, -1, 1);
    const climb = THREE.MathUtils.clamp(this.velocity.y / POSTURE.fullRate, -1, 1);
    this.pose(dt, turn, climb, this.velocity.length() / f.speed);
    this.root.updateMatrixWorld(true);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  /** A random point on the bird's surface in world space, weighted towards the wings and tail. */
  randomSurfacePoint(out: THREE.Vector3): THREE.Vector3 {
    const r = Math.random();
    if (r < EMISSION.flightFeathers) {
      const i = this.pickFeather(Math.random());
      const d = this.defs[i];
      const t = Math.random();
      const s = Math.random() * 2 - 1;
      const hand = d.side === -1 ? -1 : 1;
      const outer = s * hand >= 0;
      const notch = outer ? 1 - d.emargination * THREE.MathUtils.smoothstep(t, VANE.emarginationFrom, VANE.emarginationTo) : 1;
      const w = (outer ? d.outer : d.inner) * notch * vaneProfile(t);
      out.set(s * w + hand * d.sweep * t * t, this.dyn.getX(i) * t * t, t);
      scratch.fromArray(this.feathers.instanceMatrix.array, i * 16);
      return out.applyMatrix4(scratch).applyMatrix4(this.feathers.matrixWorld);
    }
    if (r < EMISSION.flightFeathers + EMISSION.contour) {
      const i = Math.floor(Math.random() * this.contourHalfWidths.length);
      const t = Math.random();
      out.set((Math.random() * 2 - 1) * this.contourHalfWidths[i] * contourProfile(t), this.contourBends[i] * t * t, t);
      scratch.fromArray(this.contourMatrices, i * 16);
      return out.applyMatrix4(scratch).applyMatrix4(this.contours.matrixWorld);
    }
    const pos = this.headGeometry.getAttribute('position');
    out.fromBufferAttribute(pos, Math.floor(Math.random() * pos.count));
    return out.applyMatrix4(this.head.matrixWorld);
  }

  private pickFeather(u: number): number {
    let lo = 0;
    let hi = this.featherCdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.featherCdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Advances the stroke and lays out every bone and feather for this frame. */
  private pose(dt: number, turn: number, climb: number, airspeed: number): void {
    const f = TUNING.flight;
    const climbUp = Math.max(0, climb);
    const dive = Math.max(0, -climb);
    this.uniforms.uTime.value = this.elapsed;
    this.uniforms.uAirspeed.value = airspeed;

    // Flap-glide: bursts of whole strokes, glides between. Climbing forces flapping and diving
    // forces a glide, so the wing always does what the flight path asks of it.
    const prevPhase = this.phase;
    this.phase = (this.phase + dt * f.flapHz * (1 + STROKE.climbRate * climbUp)) % 1;
    const wrapped = this.phase < prevPhase;
    if (this.flapping) {
      if (wrapped) this.cyclesLeft--;
      if (this.cyclesLeft <= 0 && climb < POSTURE.climbFlap) {
        this.flapping = false;
        this.glideLeft = THREE.MathUtils.randFloat(GLIDE.secondsMin, GLIDE.secondsMax);
      }
    } else {
      this.glideLeft -= dt;
      if ((this.glideLeft <= 0 && climb > POSTURE.diveGlide) || climb >= POSTURE.climbFlap) {
        this.flapping = true;
        this.cyclesLeft = THREE.MathUtils.randInt(GLIDE.cyclesMin, GLIDE.cyclesMax);
        // The stroke is still faded out here, so moving the phase is invisible.
        if (this.intensity < GLIDE.restartBelow) this.phase = GLIDE.restartPhase;
      }
    }
    const strokeTarget = this.flapping && climb > POSTURE.diveGlide ? 1 : 0;
    this.intensity += (strokeTarget - this.intensity) * (1 - Math.exp(-GLIDE.ease * dt));
    const k = this.intensity;

    // The stroke: phase 0 is the top. Downstroke with the wing spread and the hand pronated;
    // upstroke with the wrist folded, the primaries slotted together and the hand supinated.
    const D = STROKE.downShare;
    const down = this.phase < D;
    const a = down ? this.phase / D : (this.phase - D) / (1 - D);
    const theta = down ? Math.PI * a : Math.PI * (1 + a);
    const arc = Math.sin(Math.PI * a);
    const fold = down ? 0 : arc * arc;
    const amplitude = f.flapAmplitude * (1 + STROKE.climbAmplitude * climbUp);

    const glideElevation = THREE.MathUtils.lerp(GLIDE.elevation, POSTURE.diveElevation, dive) + GLIDE.drift * Math.sin(this.elapsed * GLIDE.driftRate);
    const glideExtend = THREE.MathUtils.lerp(GLIDE.extend, POSTURE.diveExtend, dive);
    const glideSpread = THREE.MathUtils.lerp(GLIDE.spread, POSTURE.diveSpread, dive);

    const elevation = THREE.MathUtils.lerp(glideElevation, STROKE.midElevation + amplitude * Math.cos(theta), k);
    const extend = THREE.MathUtils.lerp(glideExtend, 1 - (1 - STROKE.upstrokeExtend) * fold, k);
    const spread = THREE.MathUtils.lerp(glideSpread, 1 - fold, k);
    const handTwist = k * (down ? -STROKE.pronation * arc : STROKE.supination * arc);
    const dihedral = k * STROKE.handDihedral * arc * (down ? 1 : -STROKE.upDihedral);
    const sweepForward = k * STROKE.sweepForward * arc * (down ? 1 : -STROKE.upSweep);
    const load = THREE.MathUtils.lerp(GLIDE.load, down ? STROKE.load * arc : STROKE.upLoad * arc, k);
    const bob = -STROKE.bob * k * Math.cos(theta);

    for (let s = 0; s < 2; s++) {
      const side = SIDES[s];
      const w = this.wings[s];
      // Positive turn is to the left, so the left wing (side -1) is on the inside.
      w.inside = Math.max(0, -turn * side);
      const outside = Math.max(0, turn * side);
      w.elevation = elevation;
      w.extend = extend + outside * TURN.outsideReach - w.inside * TURN.insideFlex;
      w.spread = spread;
      w.handTwist = handTwist;
      w.dihedral = dihedral;
      w.sweepForward = sweepForward;
      w.aoa = STROKE.armAoa;
      w.load = load;
      w.alula = climbUp * POSTURE.alulaClimb;
      this.skeleton.poseWing(s as 0 | 1, w);
    }

    // Body pitches with the flight path; it rises on each downstroke.
    const pitchTarget = THREE.MathUtils.clamp(Math.atan2(this.velocity.y, f.speed) * POSTURE.pitchGain, -POSTURE.pitchMax, POSTURE.pitchMax);
    this.pitch += (pitchTarget - this.pitch) * (1 - Math.exp(-POSTURE.pitchEase * dt));
    this.body.rotation.x = this.pitch;
    this.body.position.y = bob;

    // Tail: narrow while flapping, wider in a glide, fanned wide in turns and climbs, closed in a dive.
    let fan = THREE.MathUtils.lerp(TAIL.fanGlide, TAIL.fanClosed, k);
    fan = THREE.MathUtils.lerp(fan, TAIL.fanOpen, Math.max(Math.abs(turn) * TURN.tailFan, climbUp * POSTURE.climbTailFan));
    this.tail.fan = THREE.MathUtils.lerp(fan, TAIL.fanClosed, dive);
    this.tail.pitch = TAIL.droop + climbUp * POSTURE.tailPitchClimb + dive * POSTURE.tailPitchDive;
    this.tail.yaw = -turn * TURN.tailYaw;
    this.tail.twist = turn * TURN.tailTwist;

    // Head: undo most of the bank and pitch so the gaze stays level, then look into the turn.
    const bank = this.yawRate * f.bankPerYawRate;
    this.look += (turn * HEAD_MOTION.look - this.look) * (1 - Math.exp(-HEAD_MOTION.lookEase * dt));
    scratchQ.setFromEuler(scratchEuler.set(this.pitch, 0, bank, 'ZXY')).invert();
    scratchQ2.setFromEuler(scratchEuler.set(this.pitch * HEAD_MOTION.pitchKeep, this.look, bank * HEAD_MOTION.rollKeep, 'YZX'));
    this.headQuaternion.multiplyQuaternions(scratchQ, scratchQ2);
    this.skeleton.poseShared(this.headQuaternion, -bob * (1 - HEAD_MOTION.bobKeep), this.tail);
    const headBone = this.skeleton.bones[0][BONE.head];
    this.head.matrix.copy(headBone);
    for (let i = 0; i < this.headContourLocal.length; i++) {
      scratch.multiplyMatrices(headBone, this.headContourLocal[i]).toArray(this.contourMatrices, (this.headContourStart + i) * 16);
    }
    this.contours.instanceMatrix.needsUpdate = true;

    // Feathers.
    const matrices = this.feathers.instanceMatrix.array as Float32Array;
    const dyn = this.dyn.array as Float32Array;
    for (let i = 0; i < this.defs.length; i++) {
      const d = this.defs[i];
      const s = d.side === -1 ? 1 : 0;
      poseFeather(d, this.wings[s], this.tail, posed);
      featherMatrix(scratch, this.skeleton.bones[s][d.bone], d, posed[0], posed[1]).toArray(matrices, i * 16);
      dyn[i * 2] = posed[2];
      dyn[i * 2 + 1] = d.flutter * posed[3];
    }
    this.feathers.instanceMatrix.needsUpdate = true;
    this.dyn.needsUpdate = true;

    // Wing-bone capsules: the skin and muscle of the leading edge.
    for (let s = 0; s < 2; s++) {
      for (let b = 0; b < WING_BONES.length; b++) {
        const length = WING_BONE_LENGTHS[b];
        const radius = WING.boneRadius[b];
        scratch.makeScale((length / 2) * WING.capsuleOverlap, radius * WING.boneFlatten, radius).setPosition(length / 2, 0, 0);
        scratch.premultiply(this.skeleton.bones[s][WING_BONES[b]]);
        if (s === 1) mirrorX(scratch);
        scratch.toArray(this.capsules.instanceMatrix.array, (s * WING_BONES.length + b) * 16);
      }
    }
    this.capsules.instanceMatrix.needsUpdate = true;
  }
}
