// GLSL shared by several shaders, so the meadow's edge is computed identically wherever it is
// drawn (the soil, the grass) and the noise looks the same everywhere.
export const NOISE_GLSL = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * valueNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

/** 1 inside the meadow, 0 on barren land, with a ragged edge. Needs NOISE_GLSL. */
export const FERTILE_GLSL = /* glsl */ `
  uniform float uFertileRadius;
  uniform float uEdgeNoise;
  float fertile(vec2 xz) {
    float edge = uFertileRadius + (fbm(xz * 0.06) - 0.5) * 2.0 * uEdgeNoise;
    return 1.0 - smoothstep(edge - 1.5, edge + 1.5, length(xz));
  }
`;

/** Samples the blight/forest field texture: r = blight, g = forest. Needs NOISE_GLSL. */
export const FIELD_GLSL = /* glsl */ `
  uniform sampler2D uField;
  uniform float uFieldSize;
  vec2 field(vec2 xz) {
    vec2 uv = xz / uFieldSize + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(0.0);
    return texture2D(uField, uv).rg;
  }
`;
