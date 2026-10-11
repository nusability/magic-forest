// Every sketch number in one place, so play-testing changes one file. None of these are tuned
// yet; the ones that survive play go into the spec's Tuned Numbers.
export const TUNING = {
  flight: {
    speed: 8, // world units per second, before swift crystals
    baseHeight: 4.5,
    heightRange: 2, // a full vertical drag moves the target altitude by this much
    maxYawRate: 1.7, // radians per second at a full sideways drag
    steerEase: 3, // how quickly yaw rate and altitude follow the finger (1/s)
    bankPerYawRate: 0.45, // radians of roll per radian/s of turning
    flapHz: 2.2,
    flapAmplitude: 0.6, // radians
  },
  camera: {
    behind: 5.5,
    above: 2.4,
    lookAhead: 4,
    lookBelow: 0.6,
    follow: 5, // 1/s
  },
  sparkles: {
    perSecond: 30, // at the start; flow crystals raise it
    starShare: 0.18, // share of emitted sparkles that are big twinkling stars
    max: 2000,
    carry: 0.85, // share of the bird's velocity a sparkle keeps when it leaves the bird
    scatter: 0.6, // random outward speed
    gravity: 3,
    drag: 0.6, // 1/s, so sparkles drift rather than drop
    size: 0.12,
    starSize: 0.28,
    life: 4, // seconds before a sparkle that never landed fades out
    groundGlow: 0.7, // seconds a landed sparkle glows on the ground
  },
  seeding: {
    chance: 0.35, // chance a sparkle landing on open ground seeds a plant
    feedBoost: 0.08, // growth-rate boost a sparkle gives the plant it lands on
    maxBoost: 1, // at most double speed, so growth is still there to watch after a turn
    boostDecay: 1.5, // seconds (time constant)
    kinds: { tree: 0.35, shrub: 0.35, flower: 0.3 },
  },
  growth: {
    // Slow enough that a plant sown on one pass is still growing when you turn back to it:
    // a tree takes about 15 s from sprout to full bloom.
    extendSpeed: 0.45, // world units of branch per second of plant growth
    leafUnfurl: 2.5, // seconds
    budSwell: 1.8,
    blossomOpen: 3.5,
    blossomBurst: 6, // sparkles a blossom releases when it opens
  },
  forest: {
    maxSegments: 80000,
    maxLeaves: 120000,
    maxPetals: 90000,
    maxCores: 18000,
  },
  ground: {
    size: 8000, // big enough that its edge sits behind the distant hills
    textureTile: 12, // world units one repeat of the soil texture covers
    // Grass and bushes are drawn in one tile centred this far ahead of the camera.
    lookAhead: 20,
    grass: { tile: 60, count: 40000, clumps: 1600, clumpRadius: 0.9, height: 0.35, width: 0.06, sway: 0.06 },
    bushes: { tile: 70, count: 110, size: 0.75 },
    rocks: { count: 700, innerGap: 3, outerRadius: 450, size: 0.6 },
  },
  view: {
    far: 5000,
    hills: { inner: 1500, outer: 2400, height: 170, segments: 320 },
  },
  level: {
    fertileRadius: 60, // the meadow the magic can take root in; beyond it lies barren land
    edgeNoise: 5, // how ragged the meadow's edge is, in world units
    target: 0.22, // share of the meadow that must be forest to win
    loseAt: 0.6, // share of the meadow the blight must take to lose
  },
  multipliers: {
    pickupRadius: 2.2,
    flow: 1.4, // sparkles per second
    bloom: 1.4, // seeding and feeding strength of each sparkle
    wings: 1.4, // sparkle spread
    swift: 1.15, // flight speed
  },
  crystals: {
    initial: 6,
    max: 6, // live at once
    spawnEvery: 14, // seconds between new crystals while below max
    ring: [15, 85], // distance from the meadow's centre; the far ones sit out over barren land
    heights: [3, 6.5],
  },
  blight: {
    fieldSize: 160, // world units the blight grid covers, centred on the meadow
    cells: 128,
    tick: 0.2, // seconds between spread steps
    spreadRate: 0.3, // blight gained per second by a cell with a blighted neighbour
    startRadius: 9,
    cleansePerSparkle: 0.12,
    coverAt: 0.35, // growth a plant needs before its ground counts as forest
  },
  bloom: { strength: 0.7, radius: 0.4, threshold: 0.75 },
} as const;

export const SPARKLE_COLORS = [0xff7ad9, 0xffd36e, 0x7af0ff, 0xb48cff, 0x9effa1];
export const BLOSSOM_COLORS = [0xff6ec7, 0xffd56e, 0x6ef5ff, 0xb98cff, 0xff8a6e, 0xd9a8ff];
export const LEAF_COLORS = [0x3fd9a0, 0x7affc1, 0x2fae6a, 0x3fb7c9, 0x8fe06a];
