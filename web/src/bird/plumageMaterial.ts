import * as THREE from 'three';
import { FLUTTER, SHADING, VANE } from './constants';

// Two flavours of one look, both built on MeshStandardMaterial so the scene's moon, sky light
// and fog apply unchanged:
// - feathers: instanced unit vanes, shaped, bent and fluttered per instance in the vertex
//   shader, coloured with a base-to-tip gradient, barbs and a pale rachis in the fragment shader;
// - skin: vertex-coloured body, head and wing bones, with an emissive channel for the eye's glint.
// Both add a view-angle iridescent rim, the structural colour of real feathers, which also lifts
// the bird's silhouette off the dark sky.

const f = (n: number): string => n.toFixed(5);

const RIM_GLSL = /* glsl */ `
  {
    vec3 viewDir = normalize(vViewPosition);
    float fres = pow(1.0 - abs(dot(normal, viewDir)), ${f(SHADING.rimPower)});
    // A cosine rainbow (channels a third of a turn apart) whose hue slides with the view angle.
    vec3 iri = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + fres * ${f(SHADING.iridescenceSpread)} + plumageHue));
    totalEmissiveRadiance += mix(diffuseColor.rgb, iri * ${f(SHADING.rimTint)}, ${f(SHADING.rimRainbow)}) * fres * uRim;
  }
`;

function baseMaterial(side: THREE.Side, vertexColors: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    roughness: SHADING.roughness,
    metalness: SHADING.metalness,
    side,
    vertexColors,
  });
}

export interface FeatherUniforms {
  uTime: THREE.IUniform<number>;
  uAirspeed: THREE.IUniform<number>;
}

/** `soft` is for body contour feathers: plush, with gentle scalloping instead of crisp vanes. */
export function createFeatherMaterial(uniforms: FeatherUniforms, soft: boolean): THREE.MeshStandardMaterial {
  const material = baseMaterial(THREE.DoubleSide, false);
  const baseShade = soft ? SHADING.softBaseShade : SHADING.baseShade;
  const edgeShade = soft ? SHADING.softEdgeShade : SHADING.edgeShade;
  const barbContrast = soft ? SHADING.softBarbContrast : SHADING.barbContrast;
  const rachisLighten = soft ? SHADING.softRachis : SHADING.rachisLighten;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uAirspeed = uniforms.uAirspeed;
    shader.uniforms.uRim = { value: SHADING.rim };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec2 aFeather;   // t along the shaft, s across (outer vane positive)
        attribute vec4 aColA;      // base colour, and a per-feather phase
        attribute vec3 aColB;      // tip colour
        attribute vec4 aTip;       // accent colour at the very tip, and its glow
        attribute vec4 aShape;     // ±outer half-width (sign is handedness), inner half-width, emargination, sweep
        attribute vec2 aDyn;       // bend at the tip, flutter amplitude (per frame)
        uniform float uTime;
        uniform float uAirspeed;
        varying vec2 vFeather;
        varying vec4 vColA;
        varying vec3 vColB;
        varying vec4 vTip;
        float featherWidth;
        float featherHand;
        float featherFlutter;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
        {
          float t = aFeather.x;
          // A left-side feather is a mirror image, so its outer vane lies on local -x.
          featherHand = sign(aShape.x);
          float outer = step(0.0, aFeather.y * featherHand);
          // Emarginated primaries narrow on the outer vane past mid-length.
          float notch = smoothstep(${f(VANE.emarginationFrom)}, ${f(VANE.emarginationTo)}, t);
          featherWidth = mix(aShape.y, abs(aShape.x), outer) * (1.0 - outer * aShape.z * notch);
          featherFlutter = uAirspeed * aDyn.y * sin(uTime * ${f(FLUTTER.rate)} + aColA.w + t * ${f(FLUTTER.wave)});
          // x and y scale by the half-width; the bend lifts y along the shaft.
          vec3 n = normalize(vec3(objectNormal.xy, objectNormal.z * max(featherWidth, 1e-4)));
          n.z -= 2.0 * t * (aDyn.x + featherFlutter) * n.y;
          objectNormal = normalize(n);
          vFeather = aFeather;
          vColA = aColA;
          vColB = aColB;
          vTip = aTip;
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          float t = aFeather.x;
          transformed.xy *= featherWidth;
          transformed.x += featherHand * aShape.w * t * t;
          transformed.y += (aDyn.x + featherFlutter * (1.0 + aFeather.y * ${f(FLUTTER.twist)})) * t * t;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uRim;
        varying vec2 vFeather;
        varying vec4 vColA;
        varying vec3 vColB;
        varying vec4 vTip;
        float plumageHue;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          float t = vFeather.x;
          float s = vFeather.y;
          float tip = smoothstep(${f(SHADING.tipStart)}, 1.0, t);
          vec3 col = mix(vColA.rgb, vColB, smoothstep(${f(SHADING.gradientFrom)}, ${f(SHADING.gradientTo)}, t));
          col = mix(col, vTip.rgb, tip);
          // Barbs run out from the rachis and towards the tip.
          float barb = 0.5 + 0.5 * sin((t * ${f(SHADING.barbs)} - abs(s) * ${f(SHADING.barbSlant)}) * 6.28318);
          col *= 1.0 - ${f(barbContrast)} * barb;
          float rachis = 1.0 - smoothstep(${f(SHADING.rachisWidth)} * 0.5, ${f(SHADING.rachisWidth)}, abs(s));
          // The quill is pale and fades out towards the tip, where the rachis thins.
          col = mix(col, min(vColB * ${f(SHADING.rachisTint[0])} + ${f(SHADING.rachisTint[1])}, vec3(${f(SHADING.rachisTint[2])})), rachis * ${f(rachisLighten)} * (1.0 - ${f(SHADING.rachisFade)} * t));
          col *= mix(${f(baseShade)}, 1.0, smoothstep(0.0, ${f(SHADING.baseShadeEnd)}, t));
          col *= mix(1.0, ${f(edgeShade)}, smoothstep(${f(SHADING.edgeShadeStart)}, 1.0, abs(s)));
          diffuseColor.rgb = col;
          plumageHue = vColA.w * ${f(SHADING.huePerFeather)};
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        ${RIM_GLSL}
        totalEmissiveRadiance += vTip.rgb * vTip.a * smoothstep(${f(SHADING.tipStart)}, 1.0, vFeather.x);`,
      );
  };
  material.customProgramCacheKey = () => (soft ? 'bird-feather-soft' : 'bird-feather');
  return material;
}

export function createSkinMaterial(): THREE.MeshStandardMaterial {
  const material = baseMaterial(THREE.FrontSide, true);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: SHADING.rim };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;\nvarying float vGlow;\nconst float plumageHue = 0.0;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${RIM_GLSL}\ntotalEmissiveRadiance += vColor.rgb * vGlow;`,
      );
  };
  material.customProgramCacheKey = () => 'bird-skin';
  return material;
}
