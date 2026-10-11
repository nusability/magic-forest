// Every sketch number in one place, so play-testing changes one file. None of these are tuned
// yet; the ones that survive play go into the spec's Tuned Numbers.
export const TUNING = {
  flight: {
    speed: 4.5, // world units per second
    baseHeight: 4.5,
    heightRange: 2, // a full vertical drag moves the target altitude by this much
    maxYawRate: 1.3, // radians per second at a full sideways drag
    steerEase: 3, // how quickly yaw rate and altitude follow the finger (1/s)
    bankPerYawRate: 0.45, // radians of roll per radian/s of turning
    flapHz: 2.2,
    flapAmplitude: 0.6, // radians
  },
  camera: {
    behind: 5.5,
    above: 2.4,
    lookAhead: 4,
    lookBelow: 1.2,
    follow: 4, // 1/s
  },
  sparkles: {
    perSecond: 90,
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
    feedBoost: 0.18, // growth-rate boost a sparkle gives the plant it lands on
    maxBoost: 3,
    boostDecay: 1.5, // seconds (time constant)
    kinds: { tree: 0.35, shrub: 0.35, flower: 0.3 },
  },
  growth: {
    extendSpeed: 1.4, // world units of branch per second of plant growth
    leafUnfurl: 0.9, // seconds
    budSwell: 0.6,
    blossomOpen: 1.3,
    blossomBurst: 6, // sparkles a blossom releases when it opens
  },
  forest: {
    maxSegments: 30000,
    maxLeaves: 50000,
    maxPetals: 40000,
    maxCores: 8000,
  },
  bloom: { strength: 0.7, radius: 0.4, threshold: 0.75 },
} as const;

export const SPARKLE_COLORS = [0xff7ad9, 0xffd36e, 0x7af0ff, 0xb48cff, 0x9effa1];
export const BLOSSOM_COLORS = [0xff6ec7, 0xffd56e, 0x6ef5ff, 0xb98cff, 0xff8a6e, 0xd9a8ff];
export const LEAF_COLORS = [0x3fd9a0, 0x7affc1, 0x2fae6a, 0x3fb7c9, 0x8fe06a];
export const SKY = 0x140b2e;
