// The bird's own numbers: anatomy, plumage layout, colour and how the feathers move. Lengths are
// in world units with the bird facing -z, y up and the tail towards +z. The proportions follow a
// small swallow or tanager: a big head, a deep chest, long pointed hands and a forked tail.

export const DEG = Math.PI / 180;

/** Uniform scale on the whole rig, so the chase camera's framing can be matched in one place. */
export const BIRD_SCALE = 1.12;

// --- Body -----------------------------------------------------------------------------------

/**
 * The torso is a tube along z. Each key gives, at a share u of the way from the neck (0) to the
 * vent (1): half-width, height above and depth below the centre line, and the centre line's
 * height. The deep `below` around u = 0.3 is the keel that carries the flight muscles; the
 * front rises into the neck.
 */
export const TORSO = {
  front: -0.5, // z of the neck where the head sits over it
  back: 0.42, // z of the vent, under the tail
  keys: [
    // u,    halfWidth, above, below, centreY
    [0.0, 0.082, 0.08, 0.075, 0.12],
    [0.12, 0.12, 0.11, 0.13, 0.075],
    [0.32, 0.148, 0.13, 0.2, 0.01],
    [0.55, 0.132, 0.115, 0.165, 0.0],
    [0.8, 0.088, 0.08, 0.1, 0.02],
    [1.0, 0.02, 0.02, 0.02, 0.04],
  ],
  // The belly narrows to a soft keel instead of a round tube: an exponent above 1 on the
  // lower half pulls the flanks up and leaves the breastbone as a gentle ridge.
  keelSharpness: 1.35,
  segmentsAlong: 20,
  segmentsAround: 16,
} as const;

/** The legs tuck forwards under the belly in flight, toes curled. */
export const LEGS = {
  hipX: 0.06,
  hipY: -0.07,
  hipZ: 0.1,
  length: 0.11,
  radius: 0.014,
  tuck: 86 * DEG, // swung back from straight down, almost along the belly
  toeLength: 0.045,
  toeSpread: 25 * DEG,
  toeCurl: 135 * DEG, // toes curl forwards and up into a loose fist
  taper: 0.8, // the tarsus thins towards the foot
  toeRadius: 0.7, // of the tarsus radius
  segments: 6,
  toeSegments: 5,
} as const;

export const HEAD = {
  // The neck joint the head pivots about, on top of the torso's front.
  pivot: [0, 0.11, -0.48] as const, // a short, retracted flight neck
  // Head centre relative to the pivot, and its radii (a little longer than wide).
  centre: [0, 0.055, -0.07] as const,
  radii: [0.094, 0.09, 0.118] as const,
  // A gently sloped forehead: the front-top of the sphere is pressed down by this share.
  foreheadFlatten: 0.18,
  widthSegments: 22,
  heightSegments: 16,
  beak: {
    length: 0.115,
    baseHalfWidth: 0.032,
    baseHalfHeight: 0.03,
    droop: 0.012, // the culmen curves down towards the tip
    // Where the beak's base meets the face, relative to the head centre.
    z: -0.095,
    y: -0.012,
    segments: 12,
    rings: 6,
  },
  eye: {
    x: 0.074,
    y: 0.016,
    z: -0.048,
    radius: 0.017,
    glintRadius: 0.0042,
    glintUp: 0.6, // the catchlight sits on the eye's upper, forward, outer surface, facing the moon
    glintForward: 0.8,
    glintSegments: 6,
    segments: 10,
  },
} as const;

// --- Wing skeleton --------------------------------------------------------------------------

/**
 * Right wing, in body space. Bones lie along their local +x; local +z is the trailing edge.
 * `extend` = 1 is the fully spread wing; 0 is folded against the body. The elbow and wrist are
 * coupled in real birds (one muscle drives both), so one `extend` value drives all three angles.
 */
export const WING = {
  shoulder: [0.08, 0.075, -0.14] as const,
  humerus: 0.19,
  forearm: 0.3,
  hand: 0.24,
  // Angles at extend = 1 and extend = 0.
  sweepOpen: 16 * DEG, // humerus swept back from straight out
  sweepFolded: 62 * DEG,
  elbowOpen: 28 * DEG, // forearm swung forwards from the humerus line
  elbowFolded: 142 * DEG,
  wristOpen: 16 * DEG, // hand swung back from the forearm line
  wristFolded: 140 * DEG,
  // Radii of the skin-and-muscle capsule around each bone: the wing's leading edge.
  boneRadius: [0.036, 0.028, 0.02] as const,
  boneFlatten: 0.55, // capsules are flatter than round, like a real wing's cross-section
  capsuleOverlap: 1.15, // capsules run a little past each joint so the leading edge is unbroken
} as const;

// --- Feather layout -------------------------------------------------------------------------

/** Ten primaries along the hand, innermost (P1) first. Swallow-like: P9 is longest. */
export const PRIMARIES = {
  lengths: [0.31, 0.33, 0.36, 0.4, 0.44, 0.48, 0.52, 0.555, 0.57, 0.54],
  attachU: [0.03, 0.13, 0.23, 0.33, 0.43, 0.53, 0.63, 0.74, 0.86, 0.97],
  // Angle from the hand's axis towards the trailing edge, innermost to outermost.
  openInner: 90 * DEG,
  openOuter: 3 * DEG,
  closedInner: 74 * DEG,
  closedOuter: 38 * DEG,
  outerVane: 0.011, // narrow leading vane, the asymmetry that makes a primary an aerofoil
  innerVane: 0.026,
  // The outer four primaries narrow sharply past the middle (emargination), opening slots
  // between the tips when the hand is spread.
  emargination: [0, 0, 0, 0, 0, 0, 0.35, 0.55, 0.6, 0.55],
  sweep: 0.03, // the shaft curves back towards the tip
  lift: 2 * DEG,
  layer: 0.004, // each outer primary lies slightly over the next inner one
} as const;

export const SECONDARIES = {
  count: 10,
  lengthWrist: 0.235,
  lengthElbow: 0.215,
  angleWrist: 86 * DEG,
  angleElbow: 104 * DEG,
  outerVane: 0.022,
  innerVane: 0.032,
  sweep: 0.012,
  lift: 1 * DEG,
  attachZ: 0.012,
} as const;

export const TERTIALS = {
  attachU: [0.97, 0.8, 0.62],
  lengths: [0.24, 0.215, 0.18],
  angles: [108 * DEG, 116 * DEG, 126 * DEG],
  halfWidth: 0.034,
  lift: 3 * DEG,
  layer: 0.006,
} as const;

/** One row of coverts along one bone; the rows overlap like roof tiles, front row on top. */
export interface CovertRow {
  bone: 'humerus' | 'forearm' | 'hand';
  from: number;
  to: number;
  count: number;
  length: number;
  halfWidth: number;
  angleFrom: number;
  angleTo: number;
  attachZ: number;
  layer: number; // height above the bone line
  lift: number;
}

export const COVERT_ROWS: Record<'greater' | 'median' | 'lesser' | 'lesserArm' | 'marginal', CovertRow> = {
  greater: { bone: 'forearm', from: 0.98, to: 0.04, count: 10, length: 0.115, halfWidth: 0.034, angleFrom: 86 * DEG, angleTo: 102 * DEG, attachZ: -0.004, layer: 0.012, lift: 2 * DEG },
  median: { bone: 'forearm', from: 0.95, to: 0.05, count: 9, length: 0.085, halfWidth: 0.03, angleFrom: 84 * DEG, angleTo: 100 * DEG, attachZ: -0.02, layer: 0.019, lift: 2.5 * DEG },
  lesser: { bone: 'forearm', from: 0.97, to: 0.03, count: 9, length: 0.065, halfWidth: 0.026, angleFrom: 80 * DEG, angleTo: 96 * DEG, attachZ: -0.036, layer: 0.026, lift: 3 * DEG },
  lesserArm: { bone: 'humerus', from: 0.95, to: 0.2, count: 5, length: 0.08, halfWidth: 0.03, angleFrom: 96 * DEG, angleTo: 110 * DEG, attachZ: -0.03, layer: 0.03, lift: 3 * DEG },
  marginal: { bone: 'hand', from: 0.12, to: 0.78, count: 5, length: 0.07, halfWidth: 0.022, angleFrom: 60 * DEG, angleTo: 40 * DEG, attachZ: -0.024, layer: 0.022, lift: 2 * DEG },
};

/** Primary coverts sit over each primary's base and follow its spread. */
export const PRIMARY_COVERTS = {
  lengthShare: 0.3, // of the primary they cover
  halfWidth: 0.026,
  attachZ: -0.004,
  layer: 0.014,
  lift: 2 * DEG,
  spreadShare: 0.8, // they fan a little less than the primaries beneath them
} as const;

/** The alula: three small feathers on the thumb that lift at low speed and when climbing. */
export const ALULA = {
  lengths: [0.1, 0.085, 0.065],
  angles: [-6 * DEG, 4 * DEG, 14 * DEG],
  attachU: 0.06,
  attachZ: -0.03,
  halfWidth: 0.016,
  layer: 0.024,
  lift: 2 * DEG,
  raised: 14 * DEG,
} as const;

/** Scapulars cover the shoulder and the gap between the back and the wing. */
export const SCAPULARS = {
  count: 6,
  // Attachment line on the back, from the front-inner to the back-outer feather.
  from: [0.035, 0.155, -0.24] as const,
  to: [0.105, 0.12, -0.04] as const,
  lengthFrom: 0.15,
  lengthTo: 0.22,
  angleFrom: 98 * DEG, // in the body's plane, from +x towards the tail
  angleTo: 106 * DEG,
  halfWidth: 0.04,
  lift: 3 * DEG,
  // Share of the humerus's elevation the scapulars follow, so they open with the upstroke.
  followWing: 0.3,
} as const;

/**
 * Tail: six rectrices on each side fan from the pygostyle. The outer pair is longest, a shallow
 * fork that reads clearly from behind.
 */
export const TAIL = {
  base: [0, 0.055, 0.34] as const,
  lengths: [0.4, 0.41, 0.43, 0.46, 0.51, 0.58],
  outerVane: [0.026, 0.022, 0.019, 0.016, 0.013, 0.01],
  innerVane: [0.026, 0.028, 0.029, 0.03, 0.03, 0.028],
  fanClosed: 9 * DEG, // half-angle of the fan, centre to outermost shaft
  fanOpen: 42 * DEG,
  fanGlide: 18 * DEG,
  droop: 6 * DEG, // the tail hangs slightly below the body line in level flight
  cup: 2.5 * DEG, // outer feathers sit a little lower: the fan is a shallow dome
  layer: 0.003,
  coverts: {
    count: 4,
    lengths: [0.27, 0.25, 0.23, 0.19],
    halfWidths: [0.045, 0.042, 0.04, 0.036],
    fanShare: 0.6, // of the rectrices' fan
    // Relative to the tail base: far enough forward that the rump feathers overlap their quills.
    attach: [0.012, 0.03, -0.13] as const,
    spacing: 0.016,
    layer: 0.02,
    lift: 3 * DEG,
  },
} as const;

/** A small crest of three glowing plumes swept back off the crown, the bird's magic flourish. */
export const CREST = {
  lengths: [0.15, 0.19, 0.15],
  halfWidths: [0.014, 0.017, 0.014],
  // Relative to the head centre: on the crown, behind the forehead.
  attach: [
    [-0.012, 0.088, 0.0],
    [0, 0.094, 0.012],
    [0.012, 0.088, 0.0],
  ] as const,
  lift: [12 * DEG, 16 * DEG, 12 * DEG],
  splay: [-14 * DEG, 0, 14 * DEG], // the outer plumes fan sideways (negative is to the left)
} as const;

/** Small layout details shared by the feather rows. Heights stack each feather over its neighbour. */
export const LAYOUT = {
  covertVane: 0.85, // a covert's outer vane is a little narrower than its inner one
  primaryCovertVane: 0.8,
  alulaVane: 0.6, // the alula is a miniature primary, strongly asymmetric
  tertialVane: 0.85,
  tailCovertVane: 0.85,
  secondaryFrom: 0.98, // S1 at the wrist to S10 at the elbow, as shares of the forearm
  secondaryTo: 0.04,
  secondaryStack: 0.006, // each inner secondary lies over its outer neighbour
  rowStack: 0.004,
  tertialHeight: 0.008,
  tertialAttachZ: 0.01,
  alulaStack: 0.003,
  alulaStep: 0.006,
  rectrixSpacing: 0.007, // quills side by side on the pygostyle
  tailCovertStack: 0.003,
  tailCovertStep: 0.01,
} as const;

/** How strongly each feather group answers the pose. */
export const RESPONSE = {
  primaryLoadInner: 0.4, // inner primaries are short and bend less than the outer ones
  flutterInner: 0.5, // flutter grows from this share at the innermost feather of a group
  rectrixFlutterInner: 0.6,
  secondaryLoad: 0.4,
  primaryCovertInside: 0.5, // in a turn, the coverts lift most and the flight feathers least
  secondaryInside: 0.6,
  tertialInside: 0.4,
} as const;

/** Body contour feathers: overlapping rounded scales over the torso. */
export const CONTOUR = {
  rows: 19,
  uFrom: 0.03,
  uTo: 0.96,
  spacing: 0.07, // around the body, in world units
  minPerRow: 5, // even the thin neck and rump get a closed ring
  lengthPerRadius: 0.95, // bigger feathers where the body is thicker
  lengthMin: 0.105,
  lengthMax: 0.16,
  widthShare: 0.46, // half-width as a share of length
  lift: 6 * DEG, // tips stand off the skin just enough to read as feathers, not as scales
  sink: 0.008, // bases sit just under the skin
} as const;

/** Small contour feathers over the crown, nape and cheeks; the face around the eyes stays smooth. */
export const HEAD_CONTOUR = {
  rows: 11,
  fromFront: 38 * DEG, // angle from the beak axis where the feathering starts
  toFront: 150 * DEG, // further back the head sits over the neck
  spacing: 0.022,
  minPerRow: 4,
  length: 0.058,
  halfWidth: 0.016,
  eyeClearance: 0.026, // no feather bases this close to an eye
  lift: 3 * DEG,
  sink: 0.0015, // shallower than the body's: the head's skin curves tightly under small feathers
} as const;

// --- Feather geometry -----------------------------------------------------------------------

export const VANE = {
  // Shares of length along the shaft for the flight-feather grid; denser towards the tip, where
  // the outline curves and the flutter bends most.
  rows: [0, 0.07, 0.17, 0.3, 0.43, 0.56, 0.67, 0.77, 0.86, 0.93, 1],
  columns: [-1, -0.55, 0, 0.55, 1],
  calamus: 0.12, // width of the bare quill at the base, as a share of the vane
  vaneStart: 0.16, // the vane reaches full width this far along
  taperStart: 0.55,
  taperSharpness: 2.2,
  tipWidth: 0.08, // a rounded, not needle-sharp, tip
  emarginationFrom: 0.42, // the notch in an outer primary's leading vane, as shares of length
  emarginationTo: 0.62,
  cup: 0.22, // vanes curve down to their edges, as a share of half-width
  ridge: 0.1, // the rachis stands proud of the vanes
} as const;

export const CONTOUR_VANE = {
  rows: [0, 0.3, 0.62, 0.86, 1],
  columns: [-1, -0.5, 0, 0.5, 1],
  baseWidth: 0.45,
  roundStart: 0.45,
  tipWidth: 0.12,
  cup: 0.35,
  ridge: 0.05,
} as const;

// --- Colour ---------------------------------------------------------------------------------

/** sRGB colours. Saturated hues keep albedo luminance under the bloom threshold. */
export const PALETTE = {
  teal: 0x13cfbd,
  turquoise: 0x1ebfff,
  azure: 0x2d72ff,
  indigo: 0x4a3af0,
  violet: 0x8b3cf5,
  magenta: 0xdc34c8,
  rose: 0xff4c94,
  gold: 0xffbe3c,
  ivory: 0xffe8b0,
  night: 0x0a0718,
  white: 0xffffff,
} as const;

/** Per feather group: base colour, tip colour, accent colour at the very tip and its glow. */
export interface FeatherColours {
  base: number;
  tip: number;
  accent: number;
  glow: number;
}

export const COLOURS: Record<string, FeatherColours> = {
  primary: { base: PALETTE.violet, tip: PALETTE.magenta, accent: PALETTE.gold, glow: 0.9 },
  secondary: { base: PALETTE.indigo, tip: PALETTE.magenta, accent: PALETTE.rose, glow: 0.25 },
  tertial: { base: PALETTE.azure, tip: PALETTE.violet, accent: PALETTE.magenta, glow: 0.1 },
  greater: { base: PALETTE.azure, tip: PALETTE.indigo, accent: PALETTE.violet, glow: 0 },
  median: { base: PALETTE.turquoise, tip: PALETTE.azure, accent: PALETTE.azure, glow: 0 },
  lesser: { base: PALETTE.teal, tip: PALETTE.turquoise, accent: PALETTE.turquoise, glow: 0 },
  primaryCovert: { base: PALETTE.indigo, tip: PALETTE.violet, accent: PALETTE.magenta, glow: 0.1 },
  alula: { base: PALETTE.turquoise, tip: PALETTE.teal, accent: PALETTE.gold, glow: 0.5 },
  scapular: { base: PALETTE.teal, tip: PALETTE.turquoise, accent: PALETTE.azure, glow: 0 },
  rectrix: { base: PALETTE.violet, tip: PALETTE.magenta, accent: PALETTE.gold, glow: 1.0 },
  tailCovert: { base: PALETTE.indigo, tip: PALETTE.violet, accent: PALETTE.magenta, glow: 0.12 },
  crest: { base: PALETTE.turquoise, tip: PALETTE.gold, accent: PALETTE.gold, glow: 1.3 },
};

/** Body contour colours, from the nape (u = 0) to the rump (u = 1), back and belly. */
export const CONTOUR_COLOURS = {
  backFront: PALETTE.teal,
  backMid: PALETTE.azure,
  backRear: PALETTE.violet,
  bellyFront: PALETTE.magenta,
  bellyRear: PALETTE.violet,
  tipLighten: 0.06, // share towards white at each scale's tip, a soft scalloped edge
} as const;

export const SKIN_COLOURS = {
  torsoBack: PALETTE.teal,
  torsoBelly: PALETTE.magenta, // matches the breast feathers, so gaps between them don't show
  crown: PALETTE.teal,
  face: PALETTE.turquoise,
  throat: PALETTE.magenta,
  beak: PALETTE.ivory,
  beakTip: PALETTE.gold,
  eye: PALETTE.night,
  glint: PALETTE.white,
  legs: 0x3a2a55,
  wingBone: PALETTE.turquoise,
} as const;

/** Where one colour gives way to the next on the skin and body feathers. */
export const PAINT = {
  torsoBand: 0.08, // half-height of the soft line where back meets belly on the skin
  crownFrom: 0.1, // shares of the head's height above its centre
  crownTo: 0.7,
  throatFrom: 0.2, // and below it
  throatTo: 0.75,
  flankBand: 0.35, // in sin(v): how quickly the flanks turn from belly to back colour
  backMid: 0.5, // share along the body where the back is purely its middle colour
} as const;

export const GLOW = {
  beakTip: 0.25,
  glint: 1.2, // the eye's catchlight just blooms, a living spark
} as const;

// --- Shading --------------------------------------------------------------------------------

export const SHADING = {
  roughness: 0.42,
  metalness: 0.12,
  rim: 0.34, // strength of the view-angle iridescent rim that lifts the bird off the night sky
  rimPower: 2.6,
  iridescenceSpread: 1.4, // how far the hue travels across the rim
  barbs: 38, // barb lines along a feather
  barbSlant: 2.2, // barbs angle away from the rachis towards the tip
  barbContrast: 0.22,
  rachisWidth: 0.07,
  baseShade: 0.45, // feather bases are shadowed by the feathers lying over them
  edgeShade: 0.72,
  // Body and head contour feathers are plush, not crisp: their scalloping is much softer.
  softBaseShade: 0.78,
  softEdgeShade: 0.92,
  softBarbContrast: 0.08,
  softRachis: 0.15, // a body feather's shaft barely shows through its downy vane
  tipStart: 0.8, // where the accent colour begins
  gradientFrom: 0.08, // base colour holds over the quill, then shades to the tip colour
  gradientTo: 0.9,
  baseShadeEnd: 0.45,
  edgeShadeStart: 0.82,
  rachisLighten: 0.55,
  rachisTint: [1.25, 0.12, 0.9] as const, // pale quill: tip colour × gain + lift, capped
  rachisFade: 0.6, // the rachis thins and fades towards the tip
  rimTint: 0.6, // brightness of the rainbow part of the rim
  rimRainbow: 0.5, // share of rainbow against the feather's own colour in the rim
  huePerFeather: 0.05, // neighbouring feathers' rims are shifted slightly in hue
} as const;

// --- Motion ---------------------------------------------------------------------------------

/** The wing stroke. Phase 0 is the top of the stroke; the downstroke takes `downShare`. */
export const STROKE = {
  downShare: 0.56,
  midElevation: 6 * DEG, // the stroke is centred a little above horizontal
  upstrokeExtend: 0.42, // wrist folds to this extension at mid-upstroke
  pronation: 14 * DEG, // hand twists leading edge down on the downstroke
  supination: 18 * DEG, // and leading edge up on the upstroke, so it slices through
  armAoa: 4 * DEG,
  sweepForward: 8 * DEG, // the wing reaches forward on the downstroke
  load: 0.035, // tip bend of the primaries under the downstroke's load
  upLoad: -0.012,
  handDihedral: 10 * DEG, // the hand flicks up at the bottom of the stroke
  bob: 0.025, // the body rises on the downstroke
  // The hand lags the arm, so it bends up on the downstroke and less far down on the upstroke;
  // the arm reaches forward on the downstroke and back a little less on the upstroke.
  upDihedral: 0.6,
  upSweep: 0.5,
  climbAmplitude: 0.35, // extra stroke amplitude at full climb
  climbRate: 0.25, // extra flap frequency at full climb
} as const;

/** Flap-glide: bursts of flapping, then a glide on spread wings. */
export const GLIDE = {
  cyclesMin: 3,
  cyclesMax: 6,
  secondsMin: 0.9,
  secondsMax: 2.0,
  ease: 4, // 1/s, how quickly the stroke blends in and out
  restartPhase: 0.82, // a burst starts late in an upstroke, so the first move is a downstroke
  restartBelow: 0.05, // stroke intensity under which the phase can jump unseen
  elevation: 9 * DEG, // a shallow dihedral
  extend: 0.96,
  spread: 0.32,
  load: 0.02,
  driftRate: 1.3, // rad/s of a slow balancing wobble
  drift: 2.5 * DEG,
} as const;

/** How climbing and diving change the posture. `climb` is vertical speed over `fullRate`. */
export const POSTURE = {
  fullRate: 2.2, // world units per second of vertical speed that count as a full climb or dive
  climbFlap: 0.2, // above this climb the bird always flaps
  diveGlide: -0.2, // below this it always glides
  pitchGain: 0.9, // share of the flight-path angle the body pitches by
  pitchMax: 28 * DEG,
  pitchEase: 3, // 1/s
  diveExtend: 0.6, // diving: wings half folded and swept back
  diveElevation: 14 * DEG,
  diveSpread: 0.1,
  climbTailFan: 0.6, // share of the tail's open fan when climbing
  tailPitchClimb: 12 * DEG, // the tail spreads down as an airbrake and lift surface
  tailPitchDive: -6 * DEG,
  alulaClimb: 0.8,
} as const;

/** Turning. `turn` is the yaw rate over its maximum, positive turning left. */
export const TURN = {
  tailFan: 0.55, // share of the open fan at a full turn
  tailTwist: 7 * DEG, // the tail rolls into the turn, on top of the body's bank
  tailYaw: 6 * DEG, // and swings towards the inside, following the curved path
  insideLift: 8 * DEG, // coverts and secondaries on the inside wing lift like spoilers
  insideBend: 0.02,
  insideFlex: 0.08, // the inside wing flexes a little, the outside one reaches
  outsideReach: 0.04,
} as const;

/** The head stabilises its gaze: it cancels most of the body's bank and pitch. */
export const HEAD_MOTION = {
  rollKeep: 0.12, // share of the bank the head still shows
  pitchKeep: 0.15,
  look: 28 * DEG, // yaw into the turn at a full turn
  lookEase: 4, // 1/s
  bobKeep: 0.3, // the head rides out most of the body's bob
} as const;

/** Feathers flutter in the airflow. Amplitudes are at cruising airspeed. */
export const FLUTTER = {
  rate: 2 * Math.PI * 13, // rad/s
  wave: 5, // phase travel along the shaft, a ripple running to the tip
  twist: 0.6, // flutter twists the vane as well as bending it
  primary: 0.009,
  secondary: 0.006,
  tail: 0.008,
  covert: 0.0025,
  contour: 0.0012,
  crest: 0.014,
} as const;

/** Where sparkles leave the bird. Wings and tail shed most, as they sweep the most air. */
export const EMISSION = {
  flightFeathers: 0.74,
  contour: 0.2, // the rest comes from the head
} as const;
