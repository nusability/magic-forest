import * as THREE from 'three';
import {
  ALULA,
  COLOURS,
  COVERT_ROWS,
  CREST,
  FLUTTER,
  HEAD,
  LAYOUT,
  PRIMARIES,
  PRIMARY_COVERTS,
  RESPONSE,
  SCAPULARS,
  SECONDARIES,
  TAIL,
  TERTIALS,
  TURN,
  WING,
  type CovertRow,
  type FeatherColours,
} from './constants';

// The layout of every individually modelled feather and the skeleton that carries it. Each
// feather hangs off a bone at an attachment point and an angle from the bone's axis towards the
// trailing edge; the pose changes those angles per frame (the primaries fan open, coverts lift,
// the tail spreads). Everything is laid out for the right side; the left side is its mirror
// image, built as S·M·S so its matrices keep a positive determinant and the GPU still sees
// front faces as front faces. S·M·S also mirrors the feather's own x, so a left feather's outer
// vane lies on its local -x: the instance attributes carry that handedness to the shader.

export const BONE = { body: 0, head: 1, tail: 2, humerus: 3, forearm: 4, hand: 5 } as const;
export type BoneId = (typeof BONE)[keyof typeof BONE];
const SHARED_BONES = 3; // body, head and tail serve both sides; the wing bones are per side

export type FeatherKind =
  | 'primary'
  | 'primaryCovert'
  | 'alula'
  | 'secondary'
  | 'tertial'
  | 'covert'
  | 'scapular'
  | 'rectrix'
  | 'tailCovert'
  | 'crest';

export interface FeatherDef {
  kind: FeatherKind;
  /** Position within its group, 0 innermost, and the share of the way along the group. */
  index: number;
  along: number;
  side: 1 | -1 | 0;
  bone: BoneId;
  attach: THREE.Vector3;
  angle: number;
  lift: number;
  length: number;
  outer: number;
  inner: number;
  emargination: number;
  sweep: number;
  colours: FeatherColours;
  flutter: number;
}

/** The pose of one wing for this frame, in the right wing's frame. */
export interface WingPose {
  elevation: number; // raised about the body's long axis
  extend: number; // 1 spread, 0 folded
  sweepForward: number;
  aoa: number; // angle of attack of the arm
  handTwist: number; // pronation (negative) or supination (positive) of the hand
  dihedral: number; // the hand's bend up from the forearm's plane
  spread: number; // how far the primaries fan, 0 slotted together, 1 fully open
  load: number; // tip bend of the primaries
  inside: number; // 0..1, how much this is the inside wing of a turn
  alula: number; // 0..1, how far the alula is raised
}

export function createWingPose(): WingPose {
  return { elevation: 0, extend: 1, sweepForward: 0, aoa: 0, handTwist: 0, dihedral: 0, spread: 0, load: 0, inside: 0, alula: 0 };
}

export interface TailPose {
  fan: number; // half-angle of the fan
  pitch: number; // tip down positive
  yaw: number;
  twist: number;
}

const v3 = (a: readonly number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);

function wingFeathers(): FeatherDef[] {
  const defs: FeatherDef[] = [];
  const add = (d: Omit<FeatherDef, 'side'>): void => {
    defs.push({ ...d, side: 1 });
  };
  const p = PRIMARIES;
  for (let i = 0; i < p.lengths.length; i++) {
    const along = i / (p.lengths.length - 1);
    add({
      kind: 'primary', index: i, along, bone: BONE.hand,
      attach: new THREE.Vector3(p.attachU[i] * WING.hand, i * p.layer, 0),
      angle: 0, lift: p.lift, length: p.lengths[i], outer: p.outerVane, inner: p.innerVane,
      emargination: p.emargination[i], sweep: p.sweep, colours: COLOURS.primary, flutter: FLUTTER.primary,
    });
    const pc = PRIMARY_COVERTS;
    add({
      kind: 'primaryCovert', index: i, along, bone: BONE.hand,
      attach: new THREE.Vector3(p.attachU[i] * WING.hand, pc.layer + i * p.layer, pc.attachZ),
      angle: 0, lift: pc.lift, length: p.lengths[i] * pc.lengthShare, outer: pc.halfWidth * LAYOUT.primaryCovertVane, inner: pc.halfWidth,
      emargination: 0, sweep: 0, colours: COLOURS.primaryCovert, flutter: FLUTTER.covert,
    });
  }
  const s = SECONDARIES;
  for (let i = 0; i < s.count; i++) {
    const along = i / (s.count - 1);
    // S1 sits at the wrist, S10 at the elbow; each inner secondary lies over its outer neighbour.
    add({
      kind: 'secondary', index: i, along, bone: BONE.forearm,
      attach: new THREE.Vector3(THREE.MathUtils.lerp(LAYOUT.secondaryFrom, LAYOUT.secondaryTo, along) * WING.forearm, along * LAYOUT.secondaryStack, s.attachZ),
      angle: THREE.MathUtils.lerp(s.angleWrist, s.angleElbow, along), lift: s.lift,
      length: THREE.MathUtils.lerp(s.lengthWrist, s.lengthElbow, along), outer: s.outerVane, inner: s.innerVane,
      emargination: 0, sweep: s.sweep, colours: COLOURS.secondary, flutter: FLUTTER.secondary,
    });
  }
  const t = TERTIALS;
  for (let i = 0; i < t.lengths.length; i++) {
    add({
      kind: 'tertial', index: i, along: i / (t.lengths.length - 1), bone: BONE.humerus,
      attach: new THREE.Vector3(t.attachU[i] * WING.humerus, LAYOUT.tertialHeight + i * t.layer, LAYOUT.tertialAttachZ),
      angle: t.angles[i], lift: t.lift, length: t.lengths[i], outer: t.halfWidth * LAYOUT.tertialVane, inner: t.halfWidth,
      emargination: 0, sweep: 0, colours: COLOURS.tertial, flutter: FLUTTER.secondary,
    });
  }
  const boneLength = { humerus: WING.humerus, forearm: WING.forearm, hand: WING.hand };
  const rowColours: Record<keyof typeof COVERT_ROWS, FeatherColours> = {
    greater: COLOURS.greater,
    median: COLOURS.median,
    lesser: COLOURS.lesser,
    lesserArm: COLOURS.lesser,
    marginal: COLOURS.lesser,
  };
  for (const name of Object.keys(COVERT_ROWS) as (keyof typeof COVERT_ROWS)[]) {
    const row: CovertRow = COVERT_ROWS[name];
    for (let i = 0; i < row.count; i++) {
      const along = i / Math.max(1, row.count - 1);
      add({
        kind: 'covert', index: i, along, bone: BONE[row.bone],
        attach: new THREE.Vector3(THREE.MathUtils.lerp(row.from, row.to, along) * boneLength[row.bone], row.layer + along * LAYOUT.rowStack, row.attachZ),
        angle: THREE.MathUtils.lerp(row.angleFrom, row.angleTo, along), lift: row.lift, length: row.length,
        outer: row.halfWidth * LAYOUT.covertVane, inner: row.halfWidth, emargination: 0, sweep: 0, colours: rowColours[name], flutter: FLUTTER.covert,
      });
    }
  }
  const a = ALULA;
  for (let i = 0; i < a.lengths.length; i++) {
    add({
      kind: 'alula', index: i, along: i / (a.lengths.length - 1), bone: BONE.hand,
      attach: new THREE.Vector3(a.attachU * WING.hand, a.layer - i * LAYOUT.alulaStack, a.attachZ + i * LAYOUT.alulaStep),
      angle: a.angles[i], lift: a.lift, length: a.lengths[i], outer: a.halfWidth * LAYOUT.alulaVane, inner: a.halfWidth,
      emargination: 0, sweep: 0, colours: COLOURS.alula, flutter: FLUTTER.covert,
    });
  }
  const sc = SCAPULARS;
  const from = v3(sc.from);
  const to = v3(sc.to);
  for (let i = 0; i < sc.count; i++) {
    const along = i / (sc.count - 1);
    add({
      kind: 'scapular', index: i, along, bone: BONE.body,
      attach: from.clone().lerp(to, along).setY(THREE.MathUtils.lerp(sc.from[1], sc.to[1], along) + i * LAYOUT.rowStack),
      angle: THREE.MathUtils.lerp(sc.angleFrom, sc.angleTo, along), lift: sc.lift,
      length: THREE.MathUtils.lerp(sc.lengthFrom, sc.lengthTo, along), outer: sc.halfWidth, inner: sc.halfWidth,
      emargination: 0, sweep: 0, colours: COLOURS.scapular, flutter: FLUTTER.covert,
    });
  }
  return defs;
}

function tailFeathers(): FeatherDef[] {
  const defs: FeatherDef[] = [];
  const n = TAIL.lengths.length;
  for (let i = 0; i < n; i++) {
    // Central pair on top, each outer pair a little lower: from behind the fan reads as layered.
    defs.push({
      kind: 'rectrix', index: i, along: i / (n - 1), side: 1, bone: BONE.tail,
      attach: new THREE.Vector3((i + 0.5) * LAYOUT.rectrixSpacing, -i * TAIL.layer, 0),
      angle: 0, lift: 0, length: TAIL.lengths[i], outer: TAIL.outerVane[i], inner: TAIL.innerVane[i],
      emargination: 0, sweep: 0, colours: COLOURS.rectrix, flutter: FLUTTER.tail,
    });
  }
  const c = TAIL.coverts;
  for (let i = 0; i < c.count; i++) {
    defs.push({
      kind: 'tailCovert', index: i, along: i / (c.count - 1), side: 1, bone: BONE.tail,
      attach: new THREE.Vector3(c.attach[0] + i * c.spacing, c.attach[1] + (c.count - i) * LAYOUT.tailCovertStack, c.attach[2] - i * LAYOUT.tailCovertStep),
      angle: 0, lift: c.lift, length: c.lengths[i], outer: c.halfWidths[i] * LAYOUT.tailCovertVane, inner: c.halfWidths[i],
      emargination: 0, sweep: 0, colours: COLOURS.tailCovert, flutter: FLUTTER.covert,
    });
  }
  return defs;
}

function crestFeathers(): FeatherDef[] {
  return CREST.lengths.map((length, i) => ({
    kind: 'crest' as const, index: i, along: i / (CREST.lengths.length - 1), side: 0 as const, bone: BONE.head,
    attach: v3(CREST.attach[i]).add(v3(HEAD.centre)),
    // The angle grows towards -x, so a left (negative) splay increases it.
    angle: Math.PI / 2 - CREST.splay[i], lift: CREST.lift[i], length, outer: CREST.halfWidths[i], inner: CREST.halfWidths[i],
    emargination: 0, sweep: 0, colours: COLOURS.crest, flutter: FLUTTER.crest,
  }));
}

/** Every feather, right side then its mirror, then the unpaired crest. */
export function featherLayout(): FeatherDef[] {
  const right = [...wingFeathers(), ...tailFeathers()];
  const left = right.map((d) => ({ ...d, side: -1 as const }));
  return [...right, ...left, ...crestFeathers()];
}

// --- Per-frame posing ------------------------------------------------------------------------

const MIRROR_ROW_COL = [1, 2, 3, 4, 8, 12]; // elements of S·M·S that change sign (column-major)

/** M → S·M·S with S = diag(-1, 1, 1): the mirror image across the body's midplane. */
export function mirrorX(m: THREE.Matrix4): THREE.Matrix4 {
  const e = m.elements;
  for (const i of MIRROR_ROW_COL) e[i] = -e[i];
  return m;
}

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const local = new THREE.Matrix4();
const pos = new THREE.Vector3();
const unit = new THREE.Vector3(1, 1, 1);

function boneStep(out: THREE.Matrix4, parent: THREE.Matrix4, length: number, x: number, y: number, z: number, order: THREE.EulerOrder): void {
  euler.set(x, y, z, order);
  quat.setFromEuler(euler);
  local.compose(pos.set(length, 0, 0), quat, unit);
  out.multiplyMatrices(parent, local);
}

/** Bone matrices in body space: body, head, tail, then humerus, forearm, hand for each side. */
export class Skeleton {
  /** Indexed [side][bone]: side 0 is the right-hand frame, side 1 the left wing's own pose. */
  readonly bones: THREE.Matrix4[][] = [0, 1].map(() => Array.from({ length: 6 }, () => new THREE.Matrix4()));
  private readonly shoulder = v3(WING.shoulder);
  private readonly tailBase = v3(TAIL.base);
  private readonly headPivot = v3(HEAD.pivot);

  poseShared(headQuaternion: THREE.Quaternion, headOffsetY: number, tail: TailPose): void {
    const right = this.bones[0];
    const left = this.bones[1];
    right[BONE.body].identity();
    right[BONE.head].compose(pos.copy(this.headPivot).setY(this.headPivot.y + headOffsetY), headQuaternion, unit);
    euler.set(tail.pitch, tail.yaw, tail.twist, 'YXZ');
    right[BONE.tail].compose(this.tailBase, quat.setFromEuler(euler), unit);
    // The left side reads shared bones through the mirror, so S·(B'·L)·S = B·(S·L·S).
    for (let b = 0; b < SHARED_BONES; b++) mirrorX(left[b].copy(right[b]));
  }

  poseWing(sideIndex: 0 | 1, w: WingPose): void {
    const bones = this.bones[sideIndex];
    const ext = THREE.MathUtils.clamp(w.extend, 0, 1);
    const sweep = THREE.MathUtils.lerp(WING.sweepFolded, WING.sweepOpen, ext) - w.sweepForward;
    const elbow = THREE.MathUtils.lerp(WING.elbowFolded, WING.elbowOpen, ext);
    const wrist = THREE.MathUtils.lerp(WING.wristFolded, WING.wristOpen, ext);
    euler.set(w.aoa, -sweep, w.elevation, 'ZYX');
    bones[BONE.humerus].compose(this.shoulder, quat.setFromEuler(euler), unit);
    boneStep(bones[BONE.forearm], bones[BONE.humerus], WING.humerus, 0, elbow, 0, 'YXZ');
    boneStep(bones[BONE.hand], bones[BONE.forearm], WING.forearm, w.handTwist, -wrist, w.dihedral, 'YZX');
  }
}

/** Per-frame angle, lift and bend of one feather, written into `out` = [angle, lift, bend, flutterScale]. */
export function poseFeather(d: FeatherDef, wing: WingPose, tail: TailPose, out: Float32Array): void {
  let angle = d.angle;
  let lift = d.lift;
  let bend = 0;
  let flutter = 1;
  const insideLift = wing.inside * TURN.insideLift;
  switch (d.kind) {
    case 'primary':
    case 'primaryCovert': {
      const p = PRIMARIES;
      const share = d.kind === 'primary' ? 1 : PRIMARY_COVERTS.spreadShare;
      const spread = THREE.MathUtils.clamp(wing.spread, 0, 1) * share;
      const open = THREE.MathUtils.lerp(p.openInner, p.openOuter, d.along);
      const closed = THREE.MathUtils.lerp(p.closedInner, p.closedOuter, d.along);
      angle = THREE.MathUtils.lerp(closed, open, spread);
      if (d.kind === 'primary') {
        bend = wing.load * THREE.MathUtils.lerp(RESPONSE.primaryLoadInner, 1, d.along) + wing.inside * TURN.insideBend * (1 - d.along);
        flutter = RESPONSE.flutterInner + d.along;
      } else lift += insideLift * RESPONSE.primaryCovertInside;
      break;
    }
    case 'secondary':
      lift += insideLift * RESPONSE.secondaryInside;
      bend = wing.load * RESPONSE.secondaryLoad + wing.inside * TURN.insideBend;
      break;
    case 'tertial':
      lift += insideLift * RESPONSE.tertialInside;
      break;
    case 'covert':
      lift += insideLift;
      break;
    case 'alula':
      lift += wing.alula * ALULA.raised;
      break;
    case 'scapular':
      lift += Math.max(0, wing.elevation) * SCAPULARS.followWing;
      break;
    case 'rectrix': {
      // Shafts sit at the middle of equal slices of the fan, so the two halves meet at the centre.
      const theta = tail.fan * ((d.index + 0.5) / TAIL.lengths.length);
      angle = Math.PI / 2 - theta;
      lift = -TAIL.cup * d.along;
      flutter = RESPONSE.rectrixFlutterInner + d.along;
      break;
    }
    case 'tailCovert': {
      const theta = tail.fan * TAIL.coverts.fanShare * ((d.index + 0.5) / TAIL.coverts.count);
      angle = Math.PI / 2 - theta;
      break;
    }
    case 'crest':
      break;
  }
  out[0] = angle;
  out[1] = lift;
  out[2] = bend;
  out[3] = flutter;
}

/** The matrix of one feather from its bone, angle and lift: B · T(attach) · Ry · Rx · S(1, 1, L). */
export function featherMatrix(out: THREE.Matrix4, bone: THREE.Matrix4, d: FeatherDef, angle: number, lift: number): THREE.Matrix4 {
  euler.set(-lift, Math.PI / 2 - angle, 0, 'YXZ');
  quat.setFromEuler(euler);
  local.compose(d.attach, quat, pos.set(1, 1, d.length));
  out.multiplyMatrices(bone, local);
  if (d.side === -1) mirrorX(out);
  return out;
}
