import * as THREE from 'three'

export const ELEVATOR_SHAFT_CONFIG = {
  cutoutHalfSpan: 1.54, // 3.08m x 3.08m opening cleanly inside +/-1.61m coffer bay
  soffitY: 3.6,
  slabTopY: 4.42,
  startShaftTopY: 22.8, // ~19.2m vertical interior above ceiling soffit
  exitShaftTopY: 25.4, // ~21.8m vertical interior above ceiling soffit
  wallOuterHalfSpan: 1.78, // sits strictly above 3.60m soffit, never encroaching corridors
  depthFadeStartY: 4.15,
  depthFadeEndStartY: 16.8,
  depthFadeEndExitY: 22.2,
}

export const ELEVATOR_SHAFT_PALETTE = {
  startConcrete: 0x171f2b,
  startRustedSteel: 0x4f2e21,
  startDarkIron: 0x181e27,
  startCable: 0x222730,
  startRebar: 0x5f3828,
  exitConcrete: 0x223044,
  exitSteel: 0x3b4d63,
  exitDarkTrim: 0x1a2433,
  exitCable: 0x303a47,
  exitConduit: 0x45586e,
  darkCrown: 0x030508,
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function smoothstepUnit(t) {
  const u = clamp(t, 0, 1)
  return u * u * (3 - 2 * u)
}

/**
 * Computes normalized vertical depth brightness factor [minVis .. 1.0] for shaft geometry.
 * Remains full brightness at & below soffit fade start so lower framing stays clearly lit,
 * then decays progressively into abyssal darkness near the upper shaft cap.
 */
export function computeShaftDepthVisibility(
  y,
  fadeStartY = ELEVATOR_SHAFT_CONFIG.depthFadeStartY,
  fadeEndY = ELEVATOR_SHAFT_CONFIG.depthFadeEndExitY,
  minVis = 0.015
) {
  const norm = clamp((y - fadeStartY) / Math.max(0.5, fadeEndY - fadeStartY), 0, 1)
  const falloff = Math.pow(1 - smoothstepUnit(norm), 1.65)
  return Math.max(minVis, falloff)
}

const VERTEX_Y_HOOK = /* glsl */ `
#include <project_vertex>
vec4 shaftWorldPos = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  shaftWorldPos = batchingMatrix * shaftWorldPos;
#endif
#ifdef USE_INSTANCING
  shaftWorldPos = instanceMatrix * shaftWorldPos;
#endif
shaftWorldPos = modelMatrix * shaftWorldPos;
vShaftWorldY = shaftWorldPos.y;
`

/**
 * Applies GPU depth-based vertical darkening to any shaft or moving cab MeshStandardMaterial
 * so all direct, ambient, hemisphere, directional, and specular contributions decay
 * monotonically into cavernous darkness near the top of the shaft.
 */
export function applyShaftDepthDarknessShader(
  material,
  {
    fadeStartY = ELEVATOR_SHAFT_CONFIG.depthFadeStartY,
    fadeEndY = ELEVATOR_SHAFT_CONFIG.depthFadeEndExitY,
    minVis = 0.01,
    tintHex = ELEVATOR_SHAFT_PALETTE.darkCrown,
    baseBrightness = 1.0,
  } = {}
) {
  if (!material) return material

  const darkTint = new THREE.Color(tintHex)
  const uniforms = {
    uShaftFadeStartY: { value: fadeStartY },
    uShaftFadeEndY: { value: fadeEndY },
    uShaftMinVis: { value: minVis },
    uShaftDarkTint: { value: new THREE.Vector3(darkTint.r, darkTint.g, darkTint.b) },
    uShaftBaseBrightness: { value: baseBrightness },
  }

  material.userData.shaftDepthUniforms = uniforms
  material.userData.shaftDepthConfig = {
    fadeStartY,
    fadeEndY,
    minVis,
    baseBrightness,
  }

  const prevCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prevCompile === 'function') {
      prevCompile(shader, renderer)
    }
    shader.uniforms.uShaftFadeStartY = uniforms.uShaftFadeStartY
    shader.uniforms.uShaftFadeEndY = uniforms.uShaftFadeEndY
    shader.uniforms.uShaftMinVis = uniforms.uShaftMinVis
    shader.uniforms.uShaftDarkTint = uniforms.uShaftDarkTint
    shader.uniforms.uShaftBaseBrightness = uniforms.uShaftBaseBrightness

    shader.vertexShader = `varying float vShaftWorldY;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      VERTEX_Y_HOOK
    )

    shader.fragmentShader =
      `varying float vShaftWorldY;
uniform float uShaftFadeStartY;
uniform float uShaftFadeEndY;
uniform float uShaftMinVis;
uniform vec3 uShaftDarkTint;
uniform float uShaftBaseBrightness;
` +
      shader.fragmentShader
        .replace(
          '#include <tonemapping_fragment>',
          /* glsl */ `
float shaftNorm = clamp((vShaftWorldY - uShaftFadeStartY) / max(0.5, uShaftFadeEndY - uShaftFadeStartY), 0.0, 1.0);
float shaftSmooth = shaftNorm * shaftNorm * (3.0 - 2.0 * shaftNorm);
float shaftVis = max(uShaftMinVis, pow(max(0.0, 1.0 - shaftSmooth), 1.75));
vec3 shaftBaseLit = gl_FragColor.rgb * uShaftBaseBrightness;
gl_FragColor.rgb = mix(uShaftDarkTint, shaftBaseLit, shaftVis);
#include <tonemapping_fragment>
`
        )
        .replace(
          '#include <fog_fragment>',
          /* glsl */ `
#include <fog_fragment>
float shaftUpperSuppress = smoothstep(0.55, 0.96, shaftNorm);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uShaftDarkTint, shaftUpperSuppress * 0.9);
`
        )
  }

  material.customProgramCacheKey = () => 'elevator-shaft-depth-v2'
  material.needsUpdate = true
  return material
}
