// Every sketch number in one place, so play-testing changes one file. None of these are tuned
// yet; the ones that survive play go into the spec's Tuned Numbers.
export const TUNING = {
  flight: {
    speed: 8, // world units per second, before swift crystals
    startHeight: 10, // high enough to see the loop you're drawing
    minHeight: 2.5,
    maxHeight: 35, // high enough to look out over the whole meadow
    climbRate: 9, // world units per second at a full vertical drag; letting go holds altitude
    maxYawRate: 1.7, // radians per second at a full sideways drag
    steerEase: 3, // how quickly yaw rate and altitude follow the finger (1/s)
    bankPerYawRate: 0.45, // radians of roll per radian/s of turning
    flapHz: 2.2,
    flapAmplitude: 0.6, // radians
  },
  camera: {
    // At the start height the camera looks down onto the meadow at about 45°, so the trail and
    // the loop being closed stay in view around the bird.
    behind: 6,
    above: 6,
    lookAhead: 3,
    lookBelow: 4,
    follow: 5, // 1/s
    // Per unit of altitude above the start height: the camera backs off and its gaze flattens
    // towards the horizon, so climbing becomes an overview of the meadow.
    behindPerHeight: 0.12,
    abovePerHeight: 0.1,
    lookAheadPerHeight: 1.0,
    lookBelowPerHeight: 0.3,
    // The gaze swings into a turn by this many world units per radian/second of turning,
    // towards where the loop you're closing lies.
    lookIntoTurn: 2.5,
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
    // Sparkles weaken as they fall: full strength for this drop, gone by the second. Flying
    // high gives a view but sows nothing.
    fadeDrop: [12, 20],
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
    // Level of detail, by distance from the camera to a plant's root, in world units.
    // Full detail (every branch, leaf and petal) reaches as far as this many of its triangles
    // drawn per frame allow, but always within this range of distances.
    nearBudget: 200000,
    nearRadius: { min: 4, max: 14 }, // the camera rides about 7 above the ground, so 4 can mean none
    midRadius: 24, // limbs and small leaf clumps inside; beyond, trunks, big clumps and blossom points
    nearChunk: 6, // side of the meadow patches whose full detail is built and freed together
    midChunk: 16, // ...whose mid detail is drawn and culled together
    farChunk: 40, // ...and whose far detail is; big, since from afar it is all in view anyway
    prefetch: 6, // full detail is built this far beyond the near radius, before it is needed
    evictMargin: 6, // and freed only this much further out, so it doesn't thrash at the edge
    buildBudgetMs: 3, // time per frame spent regenerating full detail
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
    target: 0.65, // share of the meadow that must be forest before dawn
    startGrove: 7, // radius of the forest you start in, at the meadow's centre
  },
  night: {
    duration: 180, // seconds until dawn, when the magic fades
    dawnFrom: 0.55, // share of the night after which the sky starts to brighten
  },
  territory: {
    fieldSize: 160, // world units the grid covers, centred on the meadow
    cells: 128,
    drawHeight: 14, // the bird draws its trail only below this altitude
    selfCloseSteps: 12, // trail cells before crossing your own trail closes a loop
    waveDelay: 0.05, // seconds per cell of distance from the trail, for the bloom wave
    plantDensity: 0.4, // chance per newly claimed cell that a plant starts there
    shatterPenalty: 8, // seconds of night lost when a wisp breaks your trail
  },
  wisps: {
    count: 3,
    addEvery: 50, // seconds; another wisp joins, up to max
    max: 6,
    speed: 5.5,
    hover: 1.8,
    minSpawnDistance: 25, // from the bird
    heat: 0.45, // the faint scorch a wisp leaves on the ground (and the minimap)
    heatDecay: 1.5, // seconds (time constant)
  },
  multipliers: {
    pickupRadius: 2.2,
    swift: 1.15, // flight speed
    calm: 0.8, // wisp speed
    time: 20, // seconds added to the night
  },
  crystals: {
    initial: 4,
    max: 4, // live at once
    spawnEvery: 18, // seconds between new crystals while below max
    ring: [12, 55], // distance from the meadow's centre
    heights: [2.5, 6],
  },
  bloom: { strength: 0.7, radius: 0.4, threshold: 0.75 },
} as const;

export const SPARKLE_COLORS = [0xff7ad9, 0xffd36e, 0x7af0ff, 0xb48cff, 0x9effa1];
export const BLOSSOM_COLORS = [0xff6ec7, 0xffd56e, 0x6ef5ff, 0xb98cff, 0xff8a6e, 0xd9a8ff];
export const LEAF_COLORS = [0x3fd9a0, 0x7affc1, 0x2fae6a, 0x3fb7c9, 0x8fe06a];
