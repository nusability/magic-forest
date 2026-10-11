import * as THREE from 'three';
import { NOISE_GLSL } from '../glsl';
import { TUNING } from '../tuning';

// Every forest material animates growth on the GPU. Each instance carries its plant-space part
// (written once) and its plant's index; the vertex shader reads the plant's age from the state
// texture and unfurls, extends, swells and opens the part exactly as the plan describes, with
// the same easings the CPU used. Each material also owns a distance band: an instance outside
// its band collapses to nothing, so every plant shows exactly one level of detail.

const BUD_ANGLE = 0.12; // radians a closed petal or leaf leans out from its axis
const BUD_SHARE = 0.45; // a swollen bud's size as a share of the open blossom
const PETAL_GLOW = { bud: 0.5, open: 1.15 }; // colour multipliers; above 1 feeds the bloom pass
export const CORE_GLOW = 1.8;
export const CORE_SHARE = 0.22;
export const CORE_WHITENING = 0.6; // how far a blossom's core is mixed from its colour to white
const PETAL_HALF_WIDTH = 0.4; // widest point of the petal shape, in petal lengths
// A blossom seen edge-on covers less than one seen face-on, but its cupped petals never
// flatten to nothing: this is its smallest share of the face-on area.
const BLOSSOM_MIN_FACING = 0.35;
// A far blossom never shrinks below this many pixels; it dims instead, so it neither flickers
// out nor turns into an over-bright speck.
const MIN_BLOSSOM_PIXELS = 2;
// A far leaf clump paints leaves this far apart, in world units: about a leaf's width.
const CLUMP_LEAF_SPACING = 0.12;
const CLUMP_LEAF_COVER = 0.8; // share of a clump's cells that hold a leaf; the rest let light through
const CLUMP_LEAF_JITTER = 0.5; // how far a leaf strays from its cell's centre, in cells
const CLUMP_LEAF_ASPECT = [3.2, 1.3] as const; // a leaf is a narrow ellipse...
const CLUMP_LEAF_EXTENT = 0.6; // ...this big (squared, in cells)
const CLUMP_LEAF_TILT = 2.0; // how far each leaf's normal strays from the clump's sphere
const CLUMP_EDGE = { base: 0.62, ragged: 0.38, frequency: 2.3 }; // squared outline radius and its noise
// Per-leaf brightness: real leaves turn every which way, and many show their shaded side.
const CLUMP_SHADE = { min: 0.3, range: 0.7 };

/** Uniforms every forest material shares. */
export interface SharedUniforms {
  uPlantState: { value: THREE.DataTexture };
  uNearRadius: { value: number };
}

/**
 * A distance band [x, y) in world units from the camera to the plant's root. A uniform, so the
 * forest can move the near radius every frame and several materials can share one band.
 */
export type Band = { value: THREE.Vector2 };

const COMMON_VERTEX = /* glsl */ `
  uniform sampler2D uPlantState;
  uniform float uNearRadius;
  uniform vec2 uBand;
  attribute vec4 aPlant; // root x, root z, yaw, state index

  vec3 fAt;     // the part's anchor, plant space
  vec4 fQuat;   // its orientation, plant space
  vec3 fScale;  // its size; zero hides it
  float fGlow = 1.0;

  vec2 plantState() {
    int i = int(aPlant.w + 0.5);
    int width = textureSize(uPlantState, 0).x;
    return texelFetch(uPlantState, ivec2(i % width, i / width), 0).rg;
  }

  // 1 when this instance's band holds its plant. A plant whose near detail is not resident yet
  // counts as standing at the near radius, so the far version stands in until detail arrives.
  float inBand(float resident) {
    vec3 root = (modelMatrix * vec4(aPlant.x, 0.0, aPlant.y, 1.0)).xyz;
    float d = distance(cameraPosition, root);
    d = resident > 0.5 ? d : max(d, uNearRadius);
    return step(uBand.x, d) * (1.0 - step(uBand.y, d));
  }

  vec3 yawed(vec3 v) {
    float c = cos(aPlant.z), s = sin(aPlant.z);
    return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
  }
  vec3 plantToForest(vec3 p) { return yawed(p) + vec3(aPlant.x, 0.0, aPlant.y); }

  vec3 quatRotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  vec4 quatMul(vec4 a, vec4 b) { return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
  vec4 quatAroundUp(float angle) { return vec4(0.0, sin(angle * 0.5), 0.0, cos(angle * 0.5)); }
  // Rotates +y onto d, as THREE.Quaternion.setFromUnitVectors(UP, d) does.
  vec4 quatFromUp(vec3 d) {
    float r = 1.0 + d.y;
    return r < 1e-6 ? vec4(0.0, 0.0, 1.0, 0.0) : normalize(vec4(d.z, 0.0, -d.x, r));
  }
  // A direction angle radians away from axis, turned azimuth radians around it (plants.ts spread).
  vec3 spread(vec3 axis, float angle, float azimuth) {
    vec3 helper = abs(axis.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 u = normalize(cross(axis, helper));
    vec3 v = cross(axis, u);
    return normalize(axis * cos(angle) + u * cos(azimuth) * sin(angle) + v * sin(azimuth) * sin(angle));
  }

  float smoothEase(float x) { return x * x * (3.0 - 2.0 * x); }
  float easeOutCubic(float x) { float y = 1.0 - x; return 1.0 - y * y * y; }
  float easeOutBack(float x) { float y = x - 1.0; return 1.0 + 2.2 * y * y * y + 1.2 * y * y; }

  // A blossom t seconds after its bud appeared: x = swell, y = open, both 0..1.
  vec2 blossomPhase(float t) {
    return vec2(clamp(t / ${f(TUNING.growth.budSwell)}, 0.0, 1.0),
                easeOutCubic(clamp((t - ${f(TUNING.growth.budSwell)}) / ${f(TUNING.growth.blossomOpen)}, 0.0, 1.0)));
  }
  float blossomSize(vec2 phase) { return ${f(BUD_SHARE)} * smoothEase(phase.x) + ${f(1 - BUD_SHARE)} * phase.y; }
`;

/** A float literal for GLSL. */
function f(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : `${x}`;
}

// Per-kind placement: each sets fAt, fQuat, fScale (and fGlow) from the plant's state.
const SEGMENT = /* glsl */ `
  attribute vec3 aStart;
  attribute vec4 aQuat;
  attribute vec4 aSeg; // length, radius, birth, duration
  attribute float aEnd; // the plant's full-grown age
  void place() {
    vec2 state = plantState();
    float grown = clamp((state.x - aSeg.z) / aSeg.w, 0.0, 1.0);
    float r = aSeg.y * (0.5 + 0.5 * clamp(state.x / aEnd, 0.0, 1.0)); // branches thicken as the plant grows
    fAt = aStart;
    fQuat = aQuat;
    fScale = vec3(r, aSeg.x * grown, r) * step(1e-6, grown) * inBand(state.y);
  }
`;

const LEAF = /* glsl */ `
  attribute vec3 aAt;
  attribute vec3 aAxis;
  attribute vec4 aLeaf; // azimuth, open angle, size, birth
  void place() {
    vec2 state = plantState();
    float u = clamp((state.x - aLeaf.w) / ${f(TUNING.growth.leafUnfurl)}, 0.0, 1.0);
    vec3 dir = spread(aAxis, ${f(BUD_ANGLE)} + (aLeaf.y - ${f(BUD_ANGLE)}) * smoothEase(u), aLeaf.x);
    fAt = aAt;
    fQuat = quatMul(quatFromUp(dir), quatAroundUp(aLeaf.x));
    fScale = vec3(aLeaf.z * easeOutBack(u)) * step(1e-6, u) * inBand(state.y);
  }
`;

const PETAL = /* glsl */ `
  attribute vec3 aAt;
  attribute vec3 aAxis;
  attribute vec4 aPetal; // azimuth, open angle, blossom size, bud birth
  void place() {
    vec2 state = plantState();
    float t = state.x - aPetal.w;
    vec2 phase = blossomPhase(t);
    vec3 dir = spread(aAxis, ${f(BUD_ANGLE)} + (aPetal.y - ${f(BUD_ANGLE)}) * phase.y, aPetal.x);
    fAt = aAt;
    fQuat = quatMul(quatFromUp(dir), quatAroundUp(aPetal.x));
    fScale = vec3(aPetal.z * blossomSize(phase)) * step(1e-6, t) * inBand(state.y);
    fGlow = mix(${f(PETAL_GLOW.bud)}, ${f(PETAL_GLOW.open)}, phase.y);
  }
`;

const CORE = /* glsl */ `
  attribute vec3 aAt;
  attribute vec2 aCore; // core size when open, bud birth
  void place() {
    vec2 state = plantState();
    float open = blossomPhase(state.x - aCore.y).y;
    fAt = aAt;
    fQuat = vec4(0.0, 0.0, 0.0, 1.0);
    fScale = vec3(aCore.x * open) * inBand(state.y);
  }
`;

const CLUMP = /* glsl */ `
  attribute vec4 aClump; // centre xyz, radius
  attribute vec2 aClumpTime; // birth, duration
  varying vec3 vClump; // canvas xy in -1..1, z = the clump's radius
  varying float vClumpSeed;
  void place() {
    vec2 state = plantState();
    float u = clamp((state.x - aClumpTime.x) / aClumpTime.y, 0.0, 1.0);
    fAt = aClump.xyz;
    fQuat = vec4(0.0, 0.0, 0.0, 1.0);
    // Covered area grows with the share of its leaves out, so the radius grows as its root.
    fScale = vec3(aClump.w * sqrt(smoothEase(u)) * inBand(state.y));
    vClump = vec3(position.xy, aClump.w);
    vClumpSeed = fract(aPlant.w * 0.618034 + aClump.x * 3.7 + aClump.z * 5.3);
  }
`;

function replaceOnce(source: string, token: string, replacement: string): string {
  const at = source.indexOf(token);
  if (at < 0 || source.indexOf(token, at + token.length) >= 0) {
    throw new Error(`Forest shader patch expects exactly one "${token}"`);
  }
  return source.slice(0, at) + replacement + source.slice(at + token.length);
}

interface Patch {
  key: string;
  vertex: string; // declares attributes and place()
  project?: string; // replaces project_vertex
  fragmentPars?: string;
  fragmentColor?: string; // runs after color_fragment
  fragmentNormal?: string; // replaces normal_fragment_begin
}

function patch<T extends THREE.Material>(material: T, shared: SharedUniforms, band: Band, p: Patch): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uBand: band });
    let v = shader.vertexShader;
    v = replaceOnce(v, '#include <common>', `#include <common>\n${COMMON_VERTEX}\n${p.vertex}`);
    v = replaceOnce(v, 'void main() {', 'void main() {\n  place();');
    v = replaceOnce(v, '#include <beginnormal_vertex>',
      'vec3 objectNormal = yawed(quatRotate(fQuat, normal / max(fScale, vec3(1e-6))));');
    v = replaceOnce(v, '#include <begin_vertex>', 'vec3 transformed = plantToForest(fAt + quatRotate(fQuat, position * fScale));');
    v = replaceOnce(v, '#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb *= fGlow;');
    if (p.project) v = replaceOnce(v, '#include <project_vertex>', p.project);
    shader.vertexShader = v;
    let fr = shader.fragmentShader;
    if (p.fragmentPars) fr = replaceOnce(fr, '#include <common>', `#include <common>\n${p.fragmentPars}`);
    if (p.fragmentColor) fr = replaceOnce(fr, '#include <color_fragment>', `#include <color_fragment>\n${p.fragmentColor}`);
    if (p.fragmentNormal) fr = replaceOnce(fr, '#include <normal_fragment_begin>', p.fragmentNormal);
    shader.fragmentShader = fr;
  };
  // Materials that share a patch share a program; bands are uniforms, so they may differ.
  material.customProgramCacheKey = () => p.key;
  return material;
}

export function barkMaterial(shared: SharedUniforms, band: Band): THREE.MeshStandardMaterial {
  return patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: 0x2a1240, emissiveIntensity: 0.6 }),
    shared, band, { key: 'forest-bark', vertex: SEGMENT });
}

const LEAF_LOOK = { roughness: 0.6, emissive: 0x145a44, emissiveIntensity: 0.9 } as const;

export function leafMaterial(shared: SharedUniforms, band: Band): THREE.MeshStandardMaterial {
  return patch(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, ...LEAF_LOOK }),
    shared, band, { key: 'forest-leaf', vertex: LEAF });
}

export function petalMaterial(shared: SharedUniforms, band: Band): THREE.MeshBasicMaterial {
  return patch(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, band, { key: 'forest-petal', vertex: PETAL });
}

export function coreMaterial(shared: SharedUniforms, band: Band): THREE.MeshBasicMaterial {
  return patch(new THREE.MeshBasicMaterial({ vertexColors: true }), shared, band, { key: 'forest-core', vertex: CORE });
}

/**
 * A far leaf clump: a camera-facing card painted with scattered, individually lit leaves and
 * gaps between them, so a distant crown keeps the glittering look of its real leaves.
 */
export function clumpMaterial(shared: SharedUniforms, band: Band): THREE.MeshStandardMaterial {
  return patch(new THREE.MeshStandardMaterial({ vertexColors: true, ...LEAF_LOOK }), shared, band, {
    key: 'forest-clump',
    vertex: CLUMP,
    // The card is spread in view space around the clump's centre, so it always faces the camera.
    project: /* glsl */ `
      vec4 mvPosition = modelViewMatrix * vec4(plantToForest(fAt), 1.0);
      mvPosition.xy += position.xy * fScale.xy;
      gl_Position = projectionMatrix * mvPosition;
    `,
    fragmentPars: /* glsl */ `
      ${NOISE_GLSL}
      varying vec3 vClump;
      varying float vClumpSeed;
      vec3 clumpLeafNormal;
    `,
    fragmentColor: /* glsl */ `
      {
        vec2 q = vClump.xy;
        float edge = ${f(CLUMP_EDGE.base)} + ${f(CLUMP_EDGE.ragged)} * valueNoise(q * ${f(CLUMP_EDGE.frequency)} + vClumpSeed * 17.0);
        float r2 = dot(q, q);
        if (r2 > edge) discard;
        // Leaves sit on a jittered grid in world units; empty cells and the gaps around each
        // leaf are holes the night shows through.
        vec2 p = q * vClump.z / ${f(CLUMP_LEAF_SPACING)} + vClumpSeed * 31.0;
        vec2 cell = floor(p);
        float h = hash12(cell);
        float a = h * 6.2832;
        vec2 jitter = (vec2(hash12(cell + 7.1), hash12(cell + 3.3)) - 0.5) * ${f(CLUMP_LEAF_JITTER)};
        vec2 l = mat2(cos(a), sin(a), -sin(a), cos(a)) * (fract(p) - 0.5 - jitter);
        l *= vec2(${f(CLUMP_LEAF_ASPECT[0])}, ${f(CLUMP_LEAF_ASPECT[1])});
        if (h > ${f(CLUMP_LEAF_COVER)} || dot(l, l) > ${f(CLUMP_LEAF_EXTENT)}) discard;
        vec3 sphere = vec3(q, sqrt(edge - r2));
        vec3 tilt = vec3(hash12(cell + 1.7), hash12(cell + 9.2), 0.5) - 0.5;
        clumpLeafNormal = normalize(sphere + tilt * ${f(CLUMP_LEAF_TILT)});
        diffuseColor.rgb *= ${f(CLUMP_SHADE.min)} + ${f(CLUMP_SHADE.range)} * hash12(cell + 5.9);
      }
    `,
    fragmentNormal: /* glsl */ `
      float faceDirection = 1.0;
      vec3 normal = clumpLeafNormal;
      vec3 nonPerturbedNormal = normal;
    `,
  });
}

const BLOSSOM_VERTEX = /* glsl */ `
  ${COMMON_VERTEX}
  attribute vec3 aAxis; // the way the blossom faces, plant space
  attribute vec4 aBloom; // size, bud birth, petal count, open angle
  attribute vec3 color;
  uniform float uPixelScale; // half the render target's height in pixels
  varying vec3 vColor;
  varying vec2 vBloom; // open, petal count
  varying float vCore;  // core radius as a share of the point
  varying float vDim;
  void main() {
    vec2 state = plantState();
    float t = state.x - aBloom.y;
    vec2 phase = blossomPhase(t);
    float size = aBloom.x * blossomSize(phase);
    float angle = ${f(BUD_ANGLE)} + (aBloom.w - ${f(BUD_ANGLE)}) * phase.y;
    // How far the petals reach from the centre, seen face on.
    float reach = size * max(sin(angle), ${f(PETAL_HALF_WIDTH)});
    vec3 at = plantToForest(position);
    vec3 toEye = normalize(cameraPosition - (modelMatrix * vec4(at, 1.0)).xyz);
    float facing = max(abs(dot(normalize(mat3(modelMatrix) * yawed(aAxis)), toEye)), ${f(BLOSSOM_MIN_FACING)});
    vec4 mv = modelViewMatrix * vec4(at, 1.0);
    // A round point of the same area as the blossom's foreshortened outline.
    float pixels = 2.0 * reach * sqrt(facing) * projectionMatrix[1][1] * uPixelScale / -mv.z;
    float shown = step(1e-6, t) * inBand(state.y);
    gl_Position = shown > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); // hidden: outside the clip volume
    gl_PointSize = max(pixels, ${f(MIN_BLOSSOM_PIXELS)});
    float coverage = min(pixels / ${f(MIN_BLOSSOM_PIXELS)}, 1.0);
    vDim = coverage * coverage;
    vColor = color * mix(${f(PETAL_GLOW.bud)}, ${f(PETAL_GLOW.open)}, phase.y);
    vBloom = vec2(phase.y, aBloom.z);
    vCore = ${f(CORE_SHARE)} * phase.y * aBloom.x / max(reach * sqrt(facing), 1e-6);
  }
`;

const BLOSSOM_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vBloom;
  varying float vCore;
  varying float vDim;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    // Closed, a round bud; open, one lobe per petal.
    float lobes = abs(cos(atan(p.y, p.x) * vBloom.y * 0.5));
    float edge = mix(1.0, 0.45 + 0.55 * lobes, vBloom.x);
    if (r > edge) discard;
    vec3 petal = vColor * (0.8 + 0.2 * r / edge);
    vec3 core = mix(vColor, vec3(1.0), ${f(CORE_WHITENING)}) * ${f(CORE_GLOW)};
    gl_FragColor = vec4((r < vCore ? core : petal) * vDim, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Far blossoms: one glowing point each, shaped as a bud or an open flower. */
export function blossomPointMaterial(shared: SharedUniforms, band: Band, pixelScale: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uBand: band, uPixelScale: pixelScale },
    vertexShader: BLOSSOM_VERTEX,
    fragmentShader: BLOSSOM_FRAGMENT,
  });
}
