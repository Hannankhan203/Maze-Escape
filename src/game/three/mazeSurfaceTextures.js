import * as THREE from 'three'
import { createRng } from '../../utils/rng.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  WALL_HEIGHT,
  gridToWorld,
} from '../world/worldCoords.js'
import {
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

const surfacePool = new Map()

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function hash2i(ix, iy, seed = 1337) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

/**
 * Tileable periodic 2D value noise over [0, 1) in both u and v.
 * When periodicY is false, v clamps rather than wrapping vertically.
 */
function samplePeriodicNoise(u, v, periodX, periodY, seed, periodicY = true) {
  const fx = ((u % 1) + 1) % 1 * periodX
  const fy = periodicY
    ? (((v % 1) + 1) % 1) * periodY
    : clamp(v, 0, 0.9999) * periodY

  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)

  const ix0 = ((x0 % periodX) + periodX) % periodX
  const ix1 = (ix0 + 1) % periodX
  const iy0 = periodicY
    ? ((y0 % periodY) + periodY) % periodY
    : clamp(y0, 0, periodY - 1)
  const iy1 = periodicY
    ? (iy0 + 1) % periodY
    : clamp(iy0 + 1, 0, periodY - 1)

  const n00 = hash2i(ix0, iy0, seed)
  const n10 = hash2i(ix1, iy0, seed)
  const n01 = hash2i(ix0, iy1, seed)
  const n11 = hash2i(ix1, iy1, seed)

  const nx0 = lerp(n00, n10, sx)
  const nx1 = lerp(n01, n11, sx)
  return lerp(nx0, nx1, sy)
}

function samplePeriodicFbm(u, v, basePeriod, octaves, seed, periodicY = true) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let freq = basePeriod
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * samplePeriodicNoise(u, v, freq, freq, seed + o * 97, periodicY)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm : 0.5
}

/**
 * Signed distance to a line segment in 2D pixel space.
 */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq <= 1e-6) {
    return Math.hypot(px - ax, py - ay)
  }
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1)
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

function generateCrackChain(rng, startX, startY, angle, steps, stepLen, branchChance) {
  const segs = []
  let x = startX
  let y = startY
  let dir = angle

  for (let i = 0; i < steps; i += 1) {
    dir += (rng() - 0.5) * 0.72
    const len = stepLen * (0.62 + rng() * 0.76)
    const nx = x + Math.cos(dir) * len
    const ny = y + Math.sin(dir) * len
    segs.push([x, y, nx, ny])
    if (i > 0 && i < steps - 1 && rng() < branchChance) {
      const bAngle = dir + (rng() < 0.5 ? 1 : -1) * (0.42 + rng() * 0.62)
      const bSteps = Math.max(2, Math.floor(steps * 0.5))
      segs.push(...generateCrackChain(rng, nx, ny, bAngle, bSteps, stepLen * 0.72, 0))
    }
    x = nx
    y = ny
  }
  return segs
}

function createDataTexture(data, width, height, options = {}) {
  const tex = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  )
  tex.colorSpace = options.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.wrapS = options.wrapS ?? THREE.RepeatWrapping
  tex.wrapT = options.wrapT ?? THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = options.anisotropy ?? 8
  tex.needsUpdate = true
  return markSharedResource(tex)
}

function getPooledSurface(key, factory) {
  let tex = surfacePool.get(key)
  if (!tex) {
    tex = factory()
    surfacePool.set(key, tex)
  }
  return tex
}

/**
 * Generates clean, seamless 512x512 poured-concrete floor substrate albedo plus
 * matching 256x256 roughness and bump heightmaps. All non-uniform stains, cracks,
 * and scuffs are applied externally in world space and via non-repeating overlays
 * so neighboring floor bays never repeat localized patterns.
 */
function buildFloorTextures() {
  const albedoSize = 512
  const dataSize = 256

  const heightHi = new Float32Array(albedoSize * albedoSize)
  const roughHi = new Float32Array(albedoSize * albedoSize)
  const albedoBytes = new Uint8Array(albedoSize * albedoSize * 4)

  for (let y = 0; y < albedoSize; y += 1) {
    const v = y / albedoSize
    for (let x = 0; x < albedoSize; x += 1) {
      const u = x / albedoSize
      const idx = y * albedoSize + x

      const macro = samplePeriodicFbm(u, v, 4, 4, 101)
      const midGrain = samplePeriodicFbm(u, v, 12, 3, 211)
      const grain = samplePeriodicFbm(u, v, 32, 2, 307)

      let lum = 0.88 + (macro - 0.5) * 0.1 + (midGrain - 0.5) * 0.06 + (grain - 0.5) * 0.055

      // Architectural slab expansion joints every 1 cell (0.5 UV) + score seams (0.25 UV)
      // Slightly jittered by mineral grain so seams read like aged poured concrete
      const jointJitter = (grain - 0.5) * 0.85
      const duPrimary = Math.min(u % 0.5, 0.5 - (u % 0.5)) * albedoSize + jointJitter
      const dvPrimary = Math.min(v % 0.5, 0.5 - (v % 0.5)) * albedoSize + jointJitter
      const distPrimary = Math.max(0, Math.min(duPrimary, dvPrimary))

      const duSub = Math.min(u % 0.25, 0.25 - (u % 0.25)) * albedoSize + jointJitter * 0.6
      const dvSub = Math.min(v % 0.25, 0.25 - (v % 0.25)) * albedoSize + jointJitter * 0.6
      const distSub = Math.max(0, Math.min(duSub, dvSub))

      const primaryGroove = 1 - smoothstep(1.0, 2.7, distPrimary)
      const primaryBevel =
        smoothstep(2.3, 4.1, distPrimary) * (1 - smoothstep(4.1, 7.0, distPrimary))
      const subGroove = (1 - smoothstep(0.5, 1.7, distSub)) * 0.42

      const grooveMask = Math.max(primaryGroove, subGroove)
      lum *= 1 - grooveMask * 0.28
      lum += primaryBevel * 0.038

      let heightVal = 0.64 + (macro - 0.5) * 0.11 + (midGrain - 0.5) * 0.08 + (grain - 0.5) * 0.07
      heightVal -= grooveMask * 0.36
      heightVal += primaryBevel * 0.045

      let roughVal = 0.86 + (0.5 - macro) * 0.07 + (grain - 0.5) * 0.06
      roughVal = Math.min(0.98, roughVal + grooveMask * 0.11)

      // Subtle mineral color shift in aggregate without blotchy stamps
      const chromaShift = (midGrain - 0.5) * 0.016
      heightHi[idx] = clamp(heightVal, 0, 1)
      roughHi[idx] = clamp(roughVal, 0.52, 0.99)

      const p = idx * 4
      albedoBytes[p] = clamp(Math.round((lum + chromaShift) * 255), 0, 255)
      albedoBytes[p + 1] = clamp(Math.round(lum * 255), 0, 255)
      albedoBytes[p + 2] = clamp(Math.round((lum - chromaShift * 0.7) * 255), 0, 255)
      albedoBytes[p + 3] = 255
    }
  }

  const roughBytes = new Uint8Array(dataSize * dataSize * 4)
  const bumpBytes = new Uint8Array(dataSize * dataSize * 4)
  for (let y = 0; y < dataSize; y += 1) {
    const sy = y * 2
    for (let x = 0; x < dataSize; x += 1) {
      const sx = x * 2
      const i00 = sy * albedoSize + sx
      const i10 = i00 + 1
      const i01 = i00 + albedoSize
      const i11 = i01 + 1
      const rAvg = clamp(
        Math.round(((roughHi[i00] + roughHi[i10] + roughHi[i01] + roughHi[i11]) * 0.25) * 255),
        0,
        255
      )
      const bAvg = clamp(
        Math.round(((heightHi[i00] + heightHi[i10] + heightHi[i01] + heightHi[i11]) * 0.25) * 255),
        0,
        255
      )
      const p = (y * dataSize + x) * 4
      roughBytes[p] = rAvg
      roughBytes[p + 1] = rAvg
      roughBytes[p + 2] = rAvg
      roughBytes[p + 3] = 255
      bumpBytes[p] = bAvg
      bumpBytes[p + 1] = bAvg
      bumpBytes[p + 2] = bAvg
      bumpBytes[p + 3] = 255
    }
  }

  return {
    map: createDataTexture(albedoBytes, albedoSize, albedoSize, { srgb: true }),
    roughnessMap: createDataTexture(roughBytes, dataSize, dataSize, { srgb: false }),
    bumpMap: createDataTexture(bumpBytes, dataSize, dataSize, { srgb: false }),
  }
}

/**
 * Generates clean horizontally seamless 512x512 precast concrete substrate maps
 * (mineral grain + subtle formwork panel seams). All non-uniform water leaks,
 * rising damp, stains, cracks, scratches, and chipped patches are generated
 * non-periodically in world space and by multi-variant decal overlays so no
 * repeating two-dot pits or rhythmic drip lines ever appear.
 */
function buildWallTextures() {
  const albedoSize = 512
  const dataSize = 256

  const heightHi = new Float32Array(albedoSize * albedoSize)
  const roughHi = new Float32Array(albedoSize * albedoSize)
  const albedoBytes = new Uint8Array(albedoSize * albedoSize * 4)

  for (let y = 0; y < albedoSize; y += 1) {
    // DataTexture y=0 maps to floor bottom (v=0), y=size-1 maps to cap top (v=1)
    const v = y / (albedoSize - 1)
    for (let x = 0; x < albedoSize; x += 1) {
      const u = x / albedoSize
      const idx = y * albedoSize + x

      const macro = samplePeriodicFbm(u, v, 4, 4, 509, false)
      const midGrain = samplePeriodicFbm(u, v, 10, 3, 617, false)
      const grain = samplePeriodicFbm(u, v, 28, 2, 733, false)

      let lum = 0.89 + (macro - 0.5) * 0.08 + (midGrain - 0.5) * 0.055 + (grain - 0.5) * 0.05

      // Precast concrete panel joints (vertical at u=0.0, 0.5; horizontal formwork at v=0.34, 0.72)
      // Modulated gently by grain so seams feel naturally cast rather than stamped
      const edgeBreak = (grain - 0.5) * 0.7
      const duPanel = Math.max(0, Math.min(u % 0.5, 0.5 - (u % 0.5)) * albedoSize + edgeBreak)
      const vertGroove = (1 - smoothstep(0.9, 2.5, duPanel)) * (0.72 + midGrain * 0.28)
      const vertHighlight =
        smoothstep(2.2, 3.7, duPanel) * (1 - smoothstep(3.7, 6.0, duPanel))

      const dvLow = Math.abs(v - 0.34) * albedoSize + edgeBreak * 0.8
      const dvHigh = Math.abs(v - 0.72) * albedoSize + edgeBreak * 0.8
      const dvNearest = Math.max(0, Math.min(dvLow, dvHigh))
      const horizGroove = (1 - smoothstep(0.8, 2.2, dvNearest)) * (0.7 + midGrain * 0.3)
      const horizLip =
        smoothstep(
          1.7,
          3.1,
          Math.min(
            Math.max(0, (v - 0.34) * albedoSize),
            Math.max(0, (v - 0.72) * albedoSize)
          )
        ) *
        (1 - smoothstep(3.1, 5.0, dvNearest))

      const seamGroove = Math.max(vertGroove, horizGroove)
      lum *= 1 - seamGroove * 0.26
      lum += (vertHighlight + horizLip) * 0.032

      // Soft ambient darkening right at ceiling coping cap lip
      const topCapShadow = smoothstep(0.93, 1.0, v)
      lum *= 1 - topCapShadow * 0.14

      const heightVal =
        0.65 +
        (macro - 0.5) * 0.09 +
        (midGrain - 0.5) * 0.08 +
        (grain - 0.5) * 0.07 -
        seamGroove * 0.34 +
        (vertHighlight + horizLip) * 0.045

      const roughVal =
        0.85 +
        (0.5 - macro) * 0.06 +
        (grain - 0.5) * 0.06 +
        seamGroove * 0.11

      const mineralTint = (midGrain - 0.5) * 0.015
      heightHi[idx] = clamp(heightVal, 0, 1)
      roughHi[idx] = clamp(roughVal, 0.56, 0.99)

      const p = idx * 4
      albedoBytes[p] = clamp(Math.round((lum + mineralTint) * 255), 0, 255)
      albedoBytes[p + 1] = clamp(Math.round(lum * 255), 0, 255)
      albedoBytes[p + 2] = clamp(Math.round((lum - mineralTint * 0.6) * 255), 0, 255)
      albedoBytes[p + 3] = 255
    }
  }

  const roughBytes = new Uint8Array(dataSize * dataSize * 4)
  const bumpBytes = new Uint8Array(dataSize * dataSize * 4)
  for (let y = 0; y < dataSize; y += 1) {
    const sy = y * 2
    for (let x = 0; x < dataSize; x += 1) {
      const sx = x * 2
      const i00 = sy * albedoSize + sx
      const i10 = i00 + 1
      const i01 = i00 + albedoSize
      const i11 = i01 + 1
      const rAvg = clamp(
        Math.round(((roughHi[i00] + roughHi[i10] + roughHi[i01] + roughHi[i11]) * 0.25) * 255),
        0,
        255
      )
      const bAvg = clamp(
        Math.round(((heightHi[i00] + heightHi[i10] + heightHi[i01] + heightHi[i11]) * 0.25) * 255),
        0,
        255
      )
      const p = (y * dataSize + x) * 4
      roughBytes[p] = rAvg
      roughBytes[p + 1] = rAvg
      roughBytes[p + 2] = rAvg
      roughBytes[p + 3] = 255
      bumpBytes[p] = bAvg
      bumpBytes[p + 1] = bAvg
      bumpBytes[p + 2] = bAvg
      bumpBytes[p + 3] = 255
    }
  }

  return {
    map: createDataTexture(albedoBytes, albedoSize, albedoSize, { srgb: true }),
    roughnessMap: createDataTexture(roughBytes, dataSize, dataSize, { srgb: false }),
    bumpMap: createDataTexture(bumpBytes, dataSize, dataSize, { srgb: false }),
  }
}

/**
 * Generates compact 256x256 precast weathered concrete coping cap textures.
 */
function buildCapTextures() {
  const size = 256
  const albedoBytes = new Uint8Array(size * size * 4)
  const bumpBytes = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const macro = samplePeriodicFbm(u, v, 4, 3, 1201)
      const grain = samplePeriodicFbm(u, v, 24, 2, 1409)
      const edgeDist = Math.min(u, 1 - u, v, 1 - v)
      const edgeWear = (1 - smoothstep(0.02, 0.14, edgeDist)) * (0.35 + grain * 0.65)
      const lum = clamp(
        0.92 + (macro - 0.5) * 0.14 + (grain - 0.5) * 0.08 - edgeWear * 0.2,
        0.4,
        1.0
      )
      const bump = clamp(
        0.65 + (macro - 0.5) * 0.18 + (grain - 0.5) * 0.16 - edgeWear * 0.28,
        0,
        1
      )
      const p = (y * size + x) * 4
      const c = Math.round(lum * 255)
      const b = Math.round(bump * 255)
      albedoBytes[p] = c
      albedoBytes[p + 1] = c
      albedoBytes[p + 2] = c
      albedoBytes[p + 3] = 255
      bumpBytes[p] = b
      bumpBytes[p + 1] = b
      bumpBytes[p + 2] = b
      bumpBytes[p + 3] = 255
    }
  }

  return {
    map: createDataTexture(albedoBytes, size, size, { srgb: true }),
    bumpMap: createDataTexture(bumpBytes, size, size, { srgb: false }),
  }
}

/**
 * Computes normalized deterministic seed value in [0..97) for GLSL world weathering.
 */
export function normalizeWeatherSeed(seedInput) {
  const str = String(seedInput ?? 'maze-default')
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 9700) / 100
}

const WORLD_WEATHER_COMMON_GLSL = /* glsl */ `
uniform float uWeatherSeed;
varying vec3 vConcreteWorldPos;
varying vec3 vConcreteWorldNormal;

float cHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float cNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cHash21(i);
  float b = cHash21(i + vec2(1.0, 0.0));
  float c = cHash21(i + vec2(0.0, 1.0));
  float d = cHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cFbm2(vec2 p) {
  float v = 0.0;
  v += 0.62 * cNoise2(p);
  v += 0.38 * cNoise2(p * 2.07 + vec2(7.3, 13.1));
  return v;
}

float cFbm3(vec2 p) {
  float v = 0.0;
  v += 0.54 * cNoise2(p);
  v += 0.30 * cNoise2(p * 2.03 + vec2(5.7, 11.3));
  v += 0.16 * cNoise2(p * 4.11 + vec2(17.1, 3.9));
  return v;
}
`

const WORLD_WEATHER_VERTEX_POS_GLSL = /* glsl */ `
#include <project_vertex>
vec4 concreteWorldPos = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  concreteWorldPos = batchingMatrix * concreteWorldPos;
#endif
#ifdef USE_INSTANCING
  concreteWorldPos = instanceMatrix * concreteWorldPos;
#endif
concreteWorldPos = modelMatrix * concreteWorldPos;
vConcreteWorldPos = concreteWorldPos.xyz;

vec3 concreteWorldNorm = objectNormal;
#ifdef USE_BATCHING
  concreteWorldNorm = mat3( batchingMatrix ) * concreteWorldNorm;
#endif
#ifdef USE_INSTANCING
  concreteWorldNorm = mat3( instanceMatrix ) * concreteWorldNorm;
#endif
vConcreteWorldNormal = normalize( mat3( modelMatrix ) * concreteWorldNorm );
`

function getConcreteFragmentColorGlsl(mode) {
  if (mode === 'wall') {
    return /* glsl */ `
#include <color_fragment>
float concreteRoughDelta = 0.0;
{
  vec3 wN = normalize(vConcreteWorldNormal);
  float isXWall = step(0.5, abs(wN.x));
  float along = mix(vConcreteWorldPos.x, vConcreteWorldPos.z, isXWall);
  float perp = mix(vConcreteWorldPos.z, vConcreteWorldPos.x, isXWall);
  float faceCellId = floor(perp * 0.25 + 0.5);
  float faceParity = wN.x * 19.7 + wN.z * 37.3 + faceCellId * 23.17;
  vec2 seedOff = vec2(uWeatherSeed * 1.37, uWeatherSeed * 2.91);
  vec2 wUv = vec2(along + faceParity, vConcreteWorldPos.y) + seedOff;

  // 1. Multi-scale mineral pour & soot variation across corridors (non-periodic)
  vec2 wWarp = vec2(cFbm2(wUv * 0.19 + 1.4), cFbm2(wUv * 0.19 + 8.9)) * 1.65;
  float macroBatch = cFbm3((wUv + wWarp) * vec2(0.16, 0.24));
  float batchShade = 0.85 + macroBatch * 0.26;
  float coolWarm = (cNoise2(wUv * vec2(0.11, 0.17) + 14.2) - 0.5) * 0.09;
  diffuseColor.rgb *= vec3(batchShade + coolWarm, batchShade + coolWarm * 0.25, batchShade - coolWarm * 0.55);

  // 2. Non-uniform undulating rising damp & mineral tide rim along corridor bases
  float dampTop = 0.14 + cFbm2(vec2(wUv.x * 0.34, 2.7)) * 0.56;
  float dampMask = 1.0 - smoothstep(0.02, dampTop, vConcreteWorldPos.y);
  float tideRim = smoothstep(dampTop - 0.11, dampTop, vConcreteWorldPos.y) * (1.0 - smoothstep(dampTop, dampTop + 0.07, vConcreteWorldPos.y));
  diffuseColor.rgb *= 1.0 - dampMask * 0.25;
  diffuseColor.rgb += vec3(0.026, 0.029, 0.024) * tideRim;
  concreteRoughDelta -= dampMask * 0.20;

  // 3. Irregular, selective water condensation & rust streaks from cap & upper joints
  float streakGate = smoothstep(0.55, 0.85, cFbm2(vec2(wUv.x * 0.21, 9.4)));
  float sX = wUv.x * 1.85 + cNoise2(wUv * 0.9) * 0.5;
  float streakCol = pow(max(0.0, cNoise2(vec2(sX, wUv.y * 0.16 + 3.7))), 3.3);
  float reach = 0.45 + 2.05 * cNoise2(vec2(wUv.x * 0.44, 5.2));
  float vertLeak = smoothstep(3.06 - reach, 3.04, vConcreteWorldPos.y) * streakGate * streakCol;
  float rustMix = smoothstep(0.45, 0.82, cNoise2(vec2(wUv.x * 0.65, 11.8)));
  vec3 streakTint = mix(vec3(0.68, 0.72, 0.76), vec3(0.82, 0.56, 0.42), rustMix);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * streakTint, vertLeak * 0.62);
  concreteRoughDelta -= vertLeak * 0.22;

  // 4. Irregular chipped / spalled concrete patches & faint weathered paint trace
  float spallNoise = cFbm3((wUv + wWarp * 0.4) * vec2(0.72, 0.92) + vec2(4.1, 8.3));
  float spallCore = smoothstep(0.67, 0.77, spallNoise);
  float spallEdge = smoothstep(0.63, 0.67, spallNoise) * (1.0 - spallCore);
  diffuseColor.rgb *= 1.0 - spallCore * 0.19;
  diffuseColor.rgb += vec3(0.022, 0.024, 0.026) * spallEdge;
  concreteRoughDelta += spallCore * 0.10;

  // Faint discontinuous industrial dado remnant (only on scattered worn bays)
  float bandPresence = smoothstep(0.62, 0.84, cFbm2(vec2(wUv.x * 0.17, 16.5)));
  float bandY = 0.96 + (cNoise2(vec2(wUv.x * 0.25, 1.3)) - 0.5) * 0.05;
  float dadoBand = (1.0 - smoothstep(0.015, 0.055, abs(vConcreteWorldPos.y - bandY))) * bandPresence;
  float dadoErode = smoothstep(0.35, 0.72, cFbm2(wUv * 1.4));
  float dadoMask = dadoBand * dadoErode * 0.28;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.16, 1.06, 0.84), dadoMask);
}
`
  }

  if (mode === 'floor') {
    return /* glsl */ `
#include <color_fragment>
float concreteRoughDelta = 0.0;
{
  vec2 seedOff = vec2(uWeatherSeed * 1.37, uWeatherSeed * 2.91);
  vec2 fPos = vConcreteWorldPos.xz + seedOff;

  // 1. Non-repeating slab pour & aggregate tonal drift across corridors
  vec2 fWarp = vec2(cFbm2(fPos * 0.14 + 3.1), cFbm2(fPos * 0.14 + 9.7)) * 1.9;
  float slabTone = cFbm3((fPos + fWarp) * 0.16);
  float shade = 0.84 + slabTone * 0.27;
  float tempShift = (cNoise2(fPos * 0.12 + 19.3) - 0.5) * 0.08;
  diffuseColor.rgb *= vec3(shade + tempShift, shade + tempShift * 0.2, shade - tempShift * 0.65);

  // 2. Irregular organic damp, oil & mineral stains with faint drying rims
  float stainField = cFbm3((fPos + fWarp * 1.35) * 0.34 + vec2(11.2, 5.4));
  float stainCore = smoothstep(0.58, 0.79, stainField);
  float stainRing = smoothstep(0.55, 0.59, stainField) * (1.0 - smoothstep(0.59, 0.64, stainField));
  float warmStain = smoothstep(0.38, 0.66, cNoise2(fPos * 0.19 + 23.0));
  vec3 stainMult = mix(vec3(0.76, 0.81, 0.87), vec3(0.85, 0.76, 0.66), warmStain);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * stainMult, stainCore * 0.78);
  diffuseColor.rgb += vec3(0.024, 0.025, 0.023) * stainRing;
  concreteRoughDelta -= stainCore * 0.20;

  // 3. Asymmetric traffic wear & directional scuff patina
  float trafficPatch = smoothstep(0.42, 0.74, cFbm2(fPos * 0.26 + vec2(1.7, 13.5)));
  float dirScuff = cNoise2(vec2(fPos.x * 2.4 + fPos.y * 1.2, fPos.y * 0.48 - fPos.x * 0.24));
  float wearFactor = trafficPatch * (0.45 + 0.55 * dirScuff);
  diffuseColor.rgb *= 1.0 + wearFactor * 0.06;
  concreteRoughDelta -= wearFactor * 0.09;
}
`
  }

  return /* glsl */ `
#include <color_fragment>
float concreteRoughDelta = 0.0;
{
  vec2 seedOff = vec2(uWeatherSeed * 1.37, uWeatherSeed * 2.91);
  vec2 cPos = vConcreteWorldPos.xz + seedOff;
  float soot = cFbm2(cPos * 0.28 + vec2(4.2, 7.6));
  diffuseColor.rgb *= 0.86 + soot * 0.22;
  concreteRoughDelta += (0.5 - soot) * 0.08;
}
`
}

/**
 * Attaches non-repeating world-space concrete weathering (discoloration, stains,
 * rising damp, runoff streaks, roughness variation) to a MeshStandardMaterial via
 * onBeforeCompile without adding draw calls or textures.
 */
export function applyWorldSpaceConcreteShader(material, { mode = 'wall', seed = 0 } = {}) {
  if (!material) return material
  const seedNorm = normalizeWeatherSeed(seed)

  material.userData = material.userData || {}
  material.userData.concreteWeatherMode = mode
  material.userData.concreteWeatherUniforms = {
    uWeatherSeed: { value: seedNorm },
  }
  material.customProgramCacheKey = () => `maze-concrete-world-v2:${mode}`

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWeatherSeed = material.userData.concreteWeatherUniforms.uWeatherSeed

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uWeatherSeed;\nvarying vec3 vConcreteWorldPos;\nvarying vec3 vConcreteWorldNormal;`
      )
      .replace('#include <project_vertex>', WORLD_WEATHER_VERTEX_POS_GLSL)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_WEATHER_COMMON_GLSL}`)
      .replace('#include <color_fragment>', getConcreteFragmentColorGlsl(mode))
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + concreteRoughDelta, 0.28, 0.99);`
      )
  }

  material.needsUpdate = true
  return material
}

// 5x7 bitmap font glyphs for subtle industrial stencil marks
const STENCIL_GLYPHS = {
  S: ['01110', '10001', '10000', '01110', '00001', '10001', '01110'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  0: ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
}

function paintAlphaStroke(
  buf,
  size,
  ox,
  oy,
  cellSizePx,
  ax,
  ay,
  bx,
  by,
  radius,
  colorRgb,
  alpha,
  wearSeed = 1811
) {
  const margin = 4
  const minX = Math.max(ox + margin, Math.floor(ox + Math.min(ax, bx) - radius - 2))
  const maxX = Math.min(ox + cellSizePx - margin, Math.ceil(ox + Math.max(ax, bx) + radius + 2))
  const minY = Math.max(oy + margin, Math.floor(oy + Math.min(ay, by) - radius - 2))
  const maxY = Math.min(oy + cellSizePx - margin, Math.ceil(oy + Math.max(ay, by) + radius + 2))

  for (let py = minY; py <= maxY; py += 1) {
    const ly = py - oy
    for (let px = minX; px <= maxX; px += 1) {
      const lx = px - ox
      const d = distToSegment(lx, ly, ax, ay, bx, by)
      if (d > radius + 1.8) continue
      const u = px / size
      const v = py / size
      const wear = samplePeriodicFbm(u * 6, v * 6, 16, 2, wearSeed)
      const stroke = 1 - smoothstep(Math.max(0.15, radius * 0.42), radius + 1.25, d)
      const erodedAlpha = stroke * alpha * smoothstep(0.2, 0.72, wear + 0.15)
      if (erodedAlpha <= 0.01) continue
      const p = (py * size + px) * 4
      const prevA = buf[p + 3] / 255
      const outA = clamp(prevA + erodedAlpha * (1 - prevA), 0, 1)
      if (outA > 0) {
        const blend = erodedAlpha / outA
        buf[p] = clamp(Math.round(lerp(buf[p], colorRgb[0], blend)), 0, 255)
        buf[p + 1] = clamp(Math.round(lerp(buf[p + 1], colorRgb[1], blend)), 0, 255)
        buf[p + 2] = clamp(Math.round(lerp(buf[p + 2], colorRgb[2], blend)), 0, 255)
        buf[p + 3] = Math.round(outA * 255)
      }
    }
  }
}

function paintStencilText(
  buf,
  size,
  ox,
  oy,
  cellSizePx,
  startX,
  startY,
  text,
  cellPx,
  colorRgb,
  alpha
) {
  let cursorX = startX
  for (let chIdx = 0; chIdx < text.length; chIdx += 1) {
    const glyph = STENCIL_GLYPHS[text[chIdx]]
    if (!glyph) {
      cursorX += cellPx * 4
      continue
    }
    for (let row = 0; row < 7; row += 1) {
      const rowStr = glyph[6 - row]
      for (let col = 0; col < 5; col += 1) {
        if (rowStr[col] !== '1') continue
        const x0 = Math.max(ox + 4, Math.floor(ox + cursorX + col * cellPx))
        const y0 = Math.max(oy + 4, Math.floor(oy + startY + row * cellPx))
        const x1 = Math.min(ox + cellSizePx - 4, Math.ceil(x0 + cellPx))
        const y1 = Math.min(oy + cellSizePx - 4, Math.ceil(y0 + cellPx))
        for (let py = y0; py < y1; py += 1) {
          for (let px = x0; px < x1; px += 1) {
            const wear = samplePeriodicFbm((px / size) * 8, (py / size) * 8, 16, 2, 1999)
            const a = alpha * smoothstep(0.26, 0.72, wear + 0.12)
            const p = (py * size + px) * 4
            buf[p] = colorRgb[0]
            buf[p + 1] = colorRgb[1]
            buf[p + 2] = colorRgb[2]
            buf[p + 3] = Math.max(buf[p + 3], Math.round(a * 255))
          }
        }
      }
    }
    cursorX += cellPx * 6.0
  }
}

function paintBlotchMask(buf, size, ox, oy, cellSizePx, cx, cy, rx, ry, colorRgb, alpha, seed) {
  const minX = Math.max(ox + 4, Math.floor(ox + cx - rx * 1.45))
  const maxX = Math.min(ox + cellSizePx - 4, Math.ceil(ox + cx + rx * 1.45))
  const minY = Math.max(oy + 4, Math.floor(oy + cy - ry * 1.45))
  const maxY = Math.min(oy + cellSizePx - 4, Math.ceil(oy + cy + ry * 1.45))

  for (let py = minY; py <= maxY; py += 1) {
    const ly = py - oy
    for (let px = minX; px <= maxX; px += 1) {
      const lx = px - ox
      const u = (lx - cx) / rx
      const v = (ly - cy) / ry
      const n = samplePeriodicFbm(px / size, py / size, 12, 3, seed)
      const d = Math.hypot(u, v) + (n - 0.5) * 0.62
      if (d > 1.05) continue
      const body = (1 - smoothstep(0.28, 1.02, d)) * alpha * smoothstep(0.25, 0.72, n + 0.1)
      if (body <= 0.01) continue
      const p = (py * size + px) * 4
      const prevA = buf[p + 3] / 255
      const outA = clamp(prevA + body * (1 - prevA), 0, 1)
      if (outA > 0) {
        const blend = body / outA
        buf[p] = clamp(Math.round(lerp(buf[p], colorRgb[0], blend)), 0, 255)
        buf[p + 1] = clamp(Math.round(lerp(buf[p + 1], colorRgb[1], blend)), 0, 255)
        buf[p + 2] = clamp(Math.round(lerp(buf[p + 2], colorRgb[2], blend)), 0, 255)
        buf[p + 3] = Math.round(outA * 255)
      }
    }
  }
}

function buildGridAtlasUvs(gridSize = 3, texSize = 512, padPx = 6) {
  const uvs = []
  const cellPx = Math.floor(texSize / gridSize)
  for (let rowTop = 0; rowTop < gridSize; rowTop += 1) {
    const rowBot = gridSize - 1 - rowTop
    for (let col = 0; col < gridSize; col += 1) {
      const px0 = col * cellPx + padPx
      const px1 = (col + 1) * cellPx - padPx
      const py0 = rowBot * cellPx + padPx
      const py1 = (rowBot + 1) * cellPx - padPx
      uvs.push([px0 / texSize, py0 / texSize, px1 / texSize, py1 / texSize])
    }
  }
  return uvs
}

export const GRAFFITI_ATLAS_UVS = buildGridAtlasUvs(3, 512, 6)
export const IMPERFECTION_ATLAS_UVS = buildGridAtlasUvs(3, 512, 6)

/**
 * Generates a 512x512 3x3 RGBA atlas of 9 distinct restrained abandoned-facility
 * graffiti and markings (zero mip bleeding across cell borders).
 */
function buildGraffitiAtlasTexture() {
  const size = 512
  const cellPx = 170
  const buf = new Uint8Array(size * size * 4)

  const cellOrigin = (idx) => {
    const col = idx % 3
    const rowTop = Math.floor(idx / 3)
    const rowBot = 2 - rowTop
    return { ox: col * cellPx, oy: rowBot * cellPx }
  }

  // 0: Sector stencil "S-04" + worn bracket corners
  {
    const { ox, oy } = cellOrigin(0)
    const ochre = [132, 108, 78]
    const darkRust = [92, 54, 48]
    paintStencilText(buf, size, ox, oy, cellPx, 24, 72, 'S-04', 4.8, ochre, 0.68)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 18, 56, 150, 56, 1.5, ochre, 0.45)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 18, 122, 150, 122, 1.5, ochre, 0.42)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 110, 44, 144, 134, 1.9, darkRust, 0.44)
  }

  // 1: Wing stencil "B-12" + smudged datum underline
  {
    const { ox, oy } = cellOrigin(1)
    const slateInk = [142, 154, 170]
    const soot = [38, 44, 54]
    paintStencilText(buf, size, ox, oy, cellPx, 24, 70, 'B-12', 4.8, slateInk, 0.64)
    paintBlotchMask(buf, size, ox, oy, cellPx, 86, 56, 46, 16, soot, 0.34, 2101)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 22, 54, 146, 56, 1.7, slateInk, 0.46)
  }

  // 2: Sector stencil "SEC-2" + crossed slash
  {
    const { ox, oy } = cellOrigin(2)
    const ochre = [128, 102, 72]
    const soot = [36, 42, 52]
    paintStencilText(buf, size, ox, oy, cellPx, 16, 74, 'SEC-2', 3.9, ochre, 0.64)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 24, 124, 144, 54, 2.1, soot, 0.56)
  }

  // 3: Scratched tally marks (asymmetric 5-group clusters)
  {
    const { ox, oy } = cellOrigin(3)
    const chalk = [152, 164, 182]
    const shadowSlate = [36, 44, 58]
    const xs = [26, 36, 46, 56, 78, 88, 98, 108, 130, 140]
    for (let i = 0; i < xs.length; i += 1) {
      const j = ((i * 5) % 5) - 2
      paintAlphaStroke(buf, size, ox, oy, cellPx, xs[i], 88 + j, xs[i] + 2, 124 - j, 1.4, chalk, 0.62)
    }
    paintAlphaStroke(buf, size, ox, oy, cellPx, 20, 96, 62, 118, 1.8, chalk, 0.66)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 72, 95, 114, 118, 1.8, chalk, 0.64)
    for (let i = 0; i < 4; i += 1) {
      const x = 44 + i * 11
      paintAlphaStroke(buf, size, ox, oy, cellPx, x, 46, x + 3, 74, 1.3, chalk, 0.54)
    }
    paintAlphaStroke(buf, size, ox, oy, cellPx, 108, 42, 148, 78, 1.3, shadowSlate, 0.45)
  }

  // 4: Crossed dried-rust directional arrow
  {
    const { ox, oy } = cellOrigin(4)
    const driedRust = [118, 58, 54]
    const soot = [38, 44, 54]
    paintAlphaStroke(buf, size, ox, oy, cellPx, 28, 86, 132, 88, 3.0, driedRust, 0.68)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 102, 58, 134, 88, 2.8, driedRust, 0.68)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 102, 118, 134, 88, 2.8, driedRust, 0.68)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 52, 52, 98, 124, 2.4, soot, 0.62)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 100, 50, 54, 124, 2.4, soot, 0.62)
  }

  // 5: Soot smudge + caution ring & X
  {
    const { ox, oy } = cellOrigin(5)
    const ash = [126, 136, 150]
    const soot = [34, 42, 54]
    paintBlotchMask(buf, size, ox, oy, cellPx, 85, 85, 48, 42, soot, 0.46, 2111)
    const steps = 14
    for (let i = 0; i < steps; i += 1) {
      const a0 = (i / steps) * Math.PI * 2
      const a1 = ((i + 1) / steps) * Math.PI * 2
      paintAlphaStroke(
        buf,
        size,
        ox,
        oy,
        cellPx,
        85 + Math.cos(a0) * 38,
        85 + Math.sin(a0) * 38,
        85 + Math.cos(a1) * 38,
        85 + Math.sin(a1) * 38,
        1.8,
        ash,
        0.54
      )
    }
    paintAlphaStroke(buf, size, ox, oy, cellPx, 60, 60, 110, 110, 2.0, ash, 0.56)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 110, 60, 60, 110, 2.0, ash, 0.56)
  }

  // 6: Pipe/drain zone "W-7" + downward warning chevrons
  {
    const { ox, oy } = cellOrigin(6)
    const ochre = [124, 96, 66]
    const rust = [104, 54, 44]
    paintStencilText(buf, size, ox, oy, cellPx, 40, 102, 'W-7', 4.4, ochre, 0.62)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 52, 82, 85, 58, 2.2, rust, 0.58)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 118, 82, 85, 58, 2.2, rust, 0.58)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 58, 62, 85, 40, 2.0, rust, 0.52)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 112, 62, 85, 40, 2.0, rust, 0.52)
  }

  // 7: Faded industrial hazard stripes (eroded diagonal chevrons)
  {
    const { ox, oy } = cellOrigin(7)
    const ochre = [122, 98, 66]
    const soot = [38, 44, 54]
    for (let i = 0; i < 4; i += 1) {
      const bx = 26 + i * 28
      paintAlphaStroke(buf, size, ox, oy, cellPx, bx, 50, bx + 26, 116, 4.2, i % 2 === 0 ? ochre : soot, 0.54, 2300 + i)
    }
  }

  // 8: Soot smear + "NO" / scratched warning glyph
  {
    const { ox, oy } = cellOrigin(8)
    const soot = [34, 40, 50]
    const chalk = [142, 152, 168]
    paintBlotchMask(buf, size, ox, oy, cellPx, 78, 84, 46, 36, soot, 0.44, 2411)
    paintStencilText(buf, size, ox, oy, cellPx, 48, 86, 'NO', 4.6, chalk, 0.55)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 36, 46, 134, 62, 1.8, chalk, 0.48)
  }

  return createDataTexture(buf, size, size, {
    srgb: true,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })
}

/**
 * Generates a 512x512 3x3 RGBA atlas of 9 distinct non-repeating industrial concrete
 * imperfections (branching fractures, settlement cracks, metal scrapes, spalled
 * cavities, irregular corrosion blotches, curved scuff drags, impact star cracks,
 * blistering efflorescence, angular chisel gouges).
 */
function buildImperfectionAtlasTexture() {
  const size = 512
  const cellPx = 170
  const buf = new Uint8Array(size * size * 4)

  const cellOrigin = (idx) => {
    const col = idx % 3
    const rowTop = Math.floor(idx / 3)
    const rowBot = 2 - rowTop
    return { ox: col * cellPx, oy: rowBot * cellPx }
  }

  const rng = createRng('lumen-vault-imperfections-v2')
  const darkCore = [26, 32, 42]
  const spallRim = [148, 162, 180]
  const rustTint = [94, 58, 44]
  const scuffSoot = [32, 38, 48]

  const drawCrackSet = (idx, segs, halfW, alpha, seedBase) => {
    const { ox, oy } = cellOrigin(idx)
    for (let s = 0; s < segs.length; s += 1) {
      const [ax, ay, bx, by] = segs[s]
      paintAlphaStroke(buf, size, ox, oy, cellPx, ax + 1.4, ay + 1.2, bx + 1.4, by + 1.2, halfW * 0.9, spallRim, alpha * 0.3, seedBase + s)
      paintAlphaStroke(buf, size, ox, oy, cellPx, ax, ay, bx, by, halfW, darkCore, alpha, seedBase + s * 3)
    }
  }

  // 0: Branching structural hairline crack
  {
    const segs = [
      ...generateCrackChain(rng, 32, 38, 0.62, 7, 15, 0.45),
      ...generateCrackChain(rng, 76, 82, -0.35, 5, 13, 0.35),
    ]
    drawCrackSet(0, segs, 1.3, 0.78, 3100)
  }

  // 1: Vertical settlement fracture & edge widening
  {
    const segs = [
      ...generateCrackChain(rng, 78, 18, 1.52, 8, 16, 0.4),
      ...generateCrackChain(rng, 82, 74, 1.12, 4, 12, 0.2),
    ]
    drawCrackSet(1, segs, 1.5, 0.8, 3200)
  }

  // 2: Diagonal metal/crate scrape scratches
  {
    const { ox, oy } = cellOrigin(2)
    paintBlotchMask(buf, size, ox, oy, cellPx, 86, 86, 48, 22, spallRim, 0.24, 3301)
    const scrapes = [
      [26, 56, 138, 86, 1.6, 0.66],
      [34, 72, 146, 108, 1.2, 0.58],
      [22, 92, 122, 120, 1.5, 0.64],
      [56, 44, 132, 68, 0.9, 0.48],
    ]
    for (let i = 0; i < scrapes.length; i += 1) {
      const [ax, ay, bx, by, r, a] = scrapes[i]
      paintAlphaStroke(buf, size, ox, oy, cellPx, ax, ay, bx, by, r, darkCore, a, 3310 + i)
      paintAlphaStroke(buf, size, ox, oy, cellPx, ax, ay + 1.5, bx, by + 1.5, r * 0.7, spallRim, a * 0.35, 3320 + i)
    }
  }

  // 3: Chipped / spalled concrete cavity exposing aggregate
  {
    const { ox, oy } = cellOrigin(3)
    paintBlotchMask(buf, size, ox, oy, cellPx, 84, 88, 38, 28, spallRim, 0.34, 3401)
    paintBlotchMask(buf, size, ox, oy, cellPx, 84, 82, 32, 22, darkCore, 0.74, 3407)
    paintBlotchMask(buf, size, ox, oy, cellPx, 96, 76, 18, 14, scuffSoot, 0.65, 3413)
  }

  // 4: Asymmetric mineral / rust stain blotch with uneven runoff tails
  {
    const { ox, oy } = cellOrigin(4)
    paintBlotchMask(buf, size, ox, oy, cellPx, 78, 102, 34, 24, rustTint, 0.64, 3501)
    paintBlotchMask(buf, size, ox, oy, cellPx, 96, 94, 22, 18, scuffSoot, 0.48, 3509)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 72, 96, 70, 26, 2.2, rustTint, 0.56, 3517)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 98, 92, 96, 42, 1.6, rustTint, 0.48, 3523)
  }

  // 5: Asymmetric curved boot / heavy drag scuff marks (floor wear)
  {
    const { ox, oy } = cellOrigin(5)
    paintBlotchMask(buf, size, ox, oy, cellPx, 80, 82, 42, 22, scuffSoot, 0.42, 3601)
    const arcs = [
      [26, 62, 68, 72, 118, 94],
      [34, 92, 82, 100, 134, 118],
      [48, 48, 92, 58, 128, 76],
    ]
    for (let i = 0; i < arcs.length; i += 1) {
      const [x0, y0, x1, y1, x2, y2] = arcs[i]
      paintAlphaStroke(buf, size, ox, oy, cellPx, x0, y0, x1, y1, 2.6, scuffSoot, 0.58, 3610 + i)
      paintAlphaStroke(buf, size, ox, oy, cellPx, x1, y1, x2, y2, 2.2, scuffSoot, 0.52, 3620 + i)
    }
  }

  // 6: Impact star / spider fracture
  {
    const cx = 74
    const cy = 88
    const segs = []
    for (let a = 0; a < 5; a += 1) {
      const ang = (a / 5) * Math.PI * 2 + (rng() - 0.5) * 0.45
      segs.push(...generateCrackChain(rng, cx, cy, ang, 4, 14, 0.25))
    }
    drawCrackSet(6, segs, 1.2, 0.76, 3700)
    const { ox, oy } = cellOrigin(6)
    paintBlotchMask(buf, size, ox, oy, cellPx, cx, cy, 10, 9, darkCore, 0.72, 3750)
  }

  // 7: Peeling paint / mineral efflorescence blister patch
  {
    const { ox, oy } = cellOrigin(7)
    paintBlotchMask(buf, size, ox, oy, cellPx, 86, 84, 38, 30, spallRim, 0.46, 3801)
    paintBlotchMask(buf, size, ox, oy, cellPx, 78, 80, 26, 18, scuffSoot, 0.56, 3811)
  }

  // 8: Angular mortar gouges & irregular chipped pitting (no symmetric pattern)
  {
    const { ox, oy } = cellOrigin(8)
    paintBlotchMask(buf, size, ox, oy, cellPx, 62, 98, 16, 11, darkCore, 0.68, 3901)
    paintBlotchMask(buf, size, ox, oy, cellPx, 104, 68, 19, 13, scuffSoot, 0.62, 3907)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 36, 48, 86, 72, 2.1, darkCore, 0.7, 3913)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 76, 108, 134, 86, 1.8, darkCore, 0.66, 3919)
    paintAlphaStroke(buf, size, ox, oy, cellPx, 48, 118, 94, 132, 1.5, spallRim, 0.4, 3923)
  }

  return createDataTexture(buf, size, size, {
    srgb: true,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })
}

export function getMazeSurfaceTextureSet() {
  const floor = getPooledSurface('floor:set', buildFloorTextures)
  const wall = getPooledSurface('wall:set', buildWallTextures)
  const cap = getPooledSurface('cap:set', buildCapTextures)
  const graffitiAtlas = getPooledSurface('graffiti:atlas', buildGraffitiAtlasTexture)
  const imperfectionAtlas = getPooledSurface('imperfection:atlas', buildImperfectionAtlasTexture)

  const graffitiMaterial = getPooledSurface('graffiti:mat', () =>
    markSharedResource(
      new THREE.MeshStandardMaterial({
        map: graffitiAtlas,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        roughness: 0.92,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    )
  )

  const imperfectionMaterial = getPooledSurface('imperfection:mat', () =>
    markSharedResource(
      new THREE.MeshStandardMaterial({
        map: imperfectionAtlas,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        roughness: 0.9,
        metalness: 0.03,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    )
  )

  return {
    floor,
    wall,
    cap,
    graffitiAtlas,
    graffitiMaterial,
    imperfectionAtlas,
    imperfectionMaterial,
  }
}

/**
 * Updates texture anisotropy on cached surface maps once a WebGLRenderer is ready.
 */
export function syncMazeSurfaceTextureAnisotropy(renderer) {
  const maxAniso =
    typeof renderer?.capabilities?.getMaxAnisotropy === 'function'
      ? Math.max(1, Math.min(16, renderer.capabilities.getMaxAnisotropy()))
      : null
  if (!maxAniso) return

  const updateTex = (tex) => {
    if (tex && tex.isTexture && tex.anisotropy !== maxAniso) {
      tex.anisotropy = maxAniso
      tex.needsUpdate = true
    }
  }

  for (const entry of surfacePool.values()) {
    if (!entry) continue
    if (entry.isTexture) {
      updateTex(entry)
    } else if (typeof entry === 'object') {
      updateTex(entry.map)
      updateTex(entry.roughnessMap)
      updateTex(entry.bumpMap)
    }
  }
}

export function disposeMazeSurfacePools() {
  for (const entry of surfacePool.values()) {
    if (!entry) continue
    if (typeof entry.dispose === 'function') {
      entry.dispose()
    } else if (typeof entry === 'object') {
      entry.map?.dispose?.()
      entry.roughnessMap?.dispose?.()
      entry.bumpMap?.dispose?.()
    }
  }
  surfacePool.clear()
}

export function getMazeSurfacePoolStats() {
  return {
    entries: surfacePool.size,
  }
}

registerSharedPoolClearer(disposeMazeSurfacePools)

/**
 * Scales floor top/bottom/side UVs to world-meter tiles (2x2 grid cells per repeat)
 * and computes vertex colors for soft wall-base contact AO + subtle facility weathering.
 */
export function applyFloorGeometrySurfaceDetails(floorGeo, maze, floorWidth, floorDepth) {
  const grid = maze?.grid
  const rows = grid?.length || 1
  const cols = grid?.[0]?.length || 1
  const posAttr = floorGeo.attributes.position
  const normAttr = floorGeo.attributes.normal
  const uvAttr = floorGeo.attributes.uv

  if (!posAttr || !uvAttr) return

  const tileCells = 2
  const vertexCount = posAttr.count
  const colors = new Float32Array(vertexCount * 3)
  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2

  const isWallAt = (r, c) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false
    return grid[r][c] === CELL_TYPES.WALL
  }

  for (let i = 0; i < vertexCount; i += 1) {
    const vx = posAttr.getX(i)
    const vy = posAttr.getY(i)
    const vz = posAttr.getZ(i)
    const nx = normAttr ? normAttr.getX(i) : 0
    const ny = normAttr ? normAttr.getY(i) : 0

    // Tile UVs cleanly by world dimensions across top/bottom and side faces
    if (Math.abs(ny) > 0.5) {
      uvAttr.setXY(
        i,
        (vx + floorWidth * 0.5) / (CELL_SIZE * tileCells),
        (vz + floorDepth * 0.5) / (CELL_SIZE * tileCells)
      )
    } else if (Math.abs(nx) > 0.5) {
      uvAttr.setXY(
        i,
        (vz + floorDepth * 0.5) / (CELL_SIZE * tileCells),
        (vy + 0.125) / CELL_SIZE
      )
    } else {
      uvAttr.setXY(
        i,
        (vx + floorWidth * 0.5) / (CELL_SIZE * tileCells),
        (vy + 0.125) / CELL_SIZE
      )
    }

    // Contact AO around wall perimeters + subtle world macro modulation
    let shade = 0.96
    let warmShift = 0
    if (ny > 0.5) {
      const fx = (vx - originX) / CELL_SIZE
      const fz = (vz - originZ) / CELL_SIZE
      const col = Math.floor(clamp(fx, 0, cols - 1e-4))
      const row = Math.floor(clamp(fz, 0, rows - 1e-4))
      const fracX = fx - col
      const fracZ = fz - row

      let wallProximity = 0
      if (fracX < 0.08 && isWallAt(row, col - 1)) wallProximity += 1
      if (fracX > 0.92 && isWallAt(row, col + 1)) wallProximity += 1
      if (fracZ < 0.08 && isWallAt(row - 1, col)) wallProximity += 1
      if (fracZ > 0.92 && isWallAt(row + 1, col)) wallProximity += 1

      if (fracX < 0.08 && fracZ < 0.08 && isWallAt(row - 1, col - 1)) wallProximity += 0.5
      if (fracX > 0.92 && fracZ < 0.08 && isWallAt(row - 1, col + 1)) wallProximity += 0.5
      if (fracX < 0.08 && fracZ > 0.92 && isWallAt(row + 1, col - 1)) wallProximity += 0.5
      if (fracX > 0.92 && fracZ > 0.92 && isWallAt(row + 1, col + 1)) wallProximity += 0.5

      const aoDrop = Math.min(0.24, wallProximity * 0.095)
      const macroVar =
        (samplePeriodicFbm(fx / 11.5, fz / 11.5, 4, 2, 2309, false) - 0.5) * 0.13
      shade = clamp(1.0 - aoDrop + macroVar, 0.74, 1.07)
      warmShift = (hash2i(Math.round(fx * 2), Math.round(fz * 2), 2503) - 0.5) * 0.03
    }

    colors[i * 3] = clamp(shade + warmShift, 0.7, 1.08)
    colors[i * 3 + 1] = clamp(shade, 0.7, 1.08)
    colors[i * 3 + 2] = clamp(shade - warmShift * 0.6, 0.7, 1.08)
  }

  uvAttr.needsUpdate = true
  floorGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

const FACE_DIRS = [
  { dr: -1, dc: 0, nx: 0, nz: -1, tx: -1, tz: 0 }, // North (-Z)
  { dr: 1, dc: 0, nx: 0, nz: 1, tx: 1, tz: 0 }, // South (+Z)
  { dr: 0, dc: 1, nx: 1, nz: 0, tx: 0, tz: -1 }, // East (+X)
  { dr: 0, dc: -1, nx: -1, nz: 0, tx: 0, tz: 1 }, // West (-X)
]

function createIndexBufferArray(vertexCount, indexCount) {
  return vertexCount > 65535
    ? new Uint32Array(indexCount)
    : new Uint16Array(indexCount)
}

function writeQuadUvs(uvs, uvBase, bounds, flipU = false, flipV = false) {
  const [rawU0, rawV0, rawU1, rawV1] = bounds
  const u0 = flipU ? rawU1 : rawU0
  const u1 = flipU ? rawU0 : rawU1
  const v0 = flipV ? rawV1 : rawV0
  const v1 = flipV ? rawV0 : rawV1
  uvs[uvBase] = u0
  uvs[uvBase + 1] = v0
  uvs[uvBase + 2] = u1
  uvs[uvBase + 3] = v0
  uvs[uvBase + 4] = u1
  uvs[uvBase + 5] = v1
  uvs[uvBase + 6] = u0
  uvs[uvBase + 7] = v1
}

function writeQuadRgba(colors, cBase, r, g, b, a) {
  for (let k = 0; k < 4; k += 1) {
    const p = cBase + k * 4
    colors[p] = r
    colors[p + 1] = g
    colors[p + 2] = b
    colors[p + 3] = a
  }
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/**
 * Selects well-spaced exposed interior corridor wall faces and merges selective
 * weathered graffiti decals (using all 9 variants in shuffled non-repeating
 * cycles + varied RGBA opacity/fade) into a single static draw-call Mesh.
 */
export function buildSelectiveGraffitiMesh(maze, graffitiMaterial, bodyHeight = WALL_HEIGHT - 0.14) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !graffitiMaterial) {
    return null
  }

  const rows = grid.length
  const cols = grid[0]?.length || 0
  const candidates = []

  const isSpecialCell = (r, c) =>
    (maze.start && maze.start.row === r && maze.start.col === c) ||
    (maze.exit && maze.exit.row === r && maze.exit.col === c)

  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.WALL) continue
      for (let f = 0; f < FACE_DIRS.length; f += 1) {
        const dir = FACE_DIRS[f]
        const nr = r + dir.dr
        const nc = c + dir.dc
        if (nr <= 0 || nr >= rows - 1 || nc <= 0 || nc >= cols - 1) continue
        if (grid[nr][nc] !== CELL_TYPES.PATH) continue
        if (isSpecialCell(nr, nc)) continue
        candidates.push({ r, c, dir })
      }
    }
  }

  if (candidates.length === 0) {
    return null
  }

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-graffiti-v2`)
  shuffleInPlace(candidates, rng)

  const targetCount = clamp(Math.round(candidates.length * 0.042), 2, 16)
  const chosen = []
  const usedWallCells = new Set()

  for (let i = 0; i < candidates.length && chosen.length < targetCount; i += 1) {
    const cand = candidates[i]
    const wallKey = `${cand.r},${cand.c}`
    if (usedWallCells.has(wallKey)) continue

    let tooClose = false
    for (let j = 0; j < chosen.length; j += 1) {
      const dist = Math.abs(chosen[j].r - cand.r) + Math.abs(chosen[j].c - cand.c)
      if (dist < 4) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    usedWallCells.add(wallKey)
    chosen.push(cand)
  }

  if (chosen.length === 0) {
    return null
  }

  const count = chosen.length
  const positions = new Float32Array(count * 4 * 3)
  const normals = new Float32Array(count * 4 * 3)
  const uvs = new Float32Array(count * 4 * 2)
  const colors = new Float32Array(count * 4 * 4)
  const indices = createIndexBufferArray(count * 4, count * 6)
  const variantIndices = new Uint8Array(count)

  // Cycle through shuffled 9-variant bags so markings never repeat back-to-back
  let variantBag = []
  const nextVariant = () => {
    if (variantBag.length === 0) {
      variantBag = shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7, 8], rng)
    }
    return variantBag.pop()
  }

  const wallOffset = CELL_SIZE / 2 + 0.014

  for (let i = 0; i < count; i += 1) {
    const { r, c, dir } = chosen[i]
    const world = gridToWorld(r, c, maze)
    if (!world) continue

    const qIdx = nextVariant()
    variantIndices[i] = qIdx

    const halfW = (0.64 + rng() * 0.44) * 0.95
    const halfH = Math.min(bodyHeight * 0.34, halfW * (0.68 + rng() * 0.3))
    const centerY = clamp(
      bodyHeight * (0.4 + rng() * 0.22),
      halfH + 0.28,
      bodyHeight - halfH - 0.18
    )
    const lateralShift = (rng() - 0.5) * 0.72
    const tilt = (rng() - 0.5) * 0.11

    const cx = world.x + dir.nx * wallOffset + dir.tx * lateralShift
    const cz = world.z + dir.nz * wallOffset + dir.tz * lateralShift

    const cosT = Math.cos(tilt)
    const sinT = Math.sin(tilt)

    const corners = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ]

    const vBase = i * 4
    for (let k = 0; k < 4; k += 1) {
      const [lx, ly] = corners[k]
      const rx = lx * cosT - ly * sinT
      const ry = lx * sinT + ly * cosT
      const vIdx = (vBase + k) * 3
      positions[vIdx] = cx + dir.tx * rx
      positions[vIdx + 1] = centerY + ry
      positions[vIdx + 2] = cz + dir.tz * rx
      normals[vIdx] = dir.nx
      normals[vIdx + 1] = 0
      normals[vIdx + 2] = dir.nz
    }

    // Flip U only for non-text variants (indices 3..8) so stencils stay readable
    const canFlipU = qIdx >= 3 && rng() < 0.45
    writeQuadUvs(uvs, vBase * 2, GRAFFITI_ATLAS_UVS[qIdx], canFlipU, false)

    const tintTone = 0.84 + rng() * 0.18
    const opacity = 0.66 + rng() * 0.3
    writeQuadRgba(colors, vBase * 4, tintTone, tintTone * 0.98, tintTone * 0.95, opacity)

    const iBase = i * 6
    indices[iBase] = vBase
    indices[iBase + 1] = vBase + 1
    indices[iBase + 2] = vBase + 2
    indices[iBase + 3] = vBase
    indices[iBase + 4] = vBase + 2
    indices[iBase + 5] = vBase + 3
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const mesh = new THREE.Mesh(geometry, graffitiMaterial)
  mesh.name = 'maze-walls-graffiti'
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.userData = {
    decalCount: count,
    variantIndices,
  }
  return mesh
}

// Variants appropriate for walls (exclude index 5 floor boot drags) and floors (all 9)
const WALL_IMPERFECTION_VARIANTS = [0, 1, 2, 3, 4, 6, 7, 8]
const FLOOR_IMPERFECTION_VARIANTS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
// Variants safe to flip vertically without turning runoff/drips upside down
const VERT_FLIP_SAFE = new Set([0, 1, 2, 3, 5, 6, 7, 8])

function pickAntiRepeatVariant(pool, rng, forbiddenSet) {
  const allowed = []
  for (let i = 0; i < pool.length; i += 1) {
    if (!forbiddenSet.has(pool[i])) {
      allowed.push(pool[i])
    }
  }
  const source = allowed.length > 0 ? allowed : pool
  return source[Math.floor(rng() * source.length)]
}

/**
 * Places non-repeating concrete imperfections (branching cracks, scratches,
 * spalls, irregular corrosion, gouges) on exposed interior corridor walls,
 * enforcing anti-neighbor variant checks and per-decal transforms + RGBA fade,
 * merged into a single static draw-call Mesh.
 */
export function buildWallImperfectionMesh(
  maze,
  imperfectionMaterial,
  bodyHeight = WALL_HEIGHT - 0.14
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !imperfectionMaterial) {
    return null
  }

  const rows = grid.length
  const cols = grid[0]?.length || 0
  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-wall-imp-v2`)
  const placements = []
  const cellVariantHistory = new Map()

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] !== CELL_TYPES.WALL) continue
      for (let f = 0; f < FACE_DIRS.length; f += 1) {
        const dir = FACE_DIRS[f]
        const nr = r + dir.dr
        const nc = c + dir.dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        if (grid[nr][nc] !== CELL_TYPES.PATH) continue

        const roll = rng()
        if (roll > 0.44) continue
        const layerCount = roll < 0.11 ? 2 : 1

        // Avoid repeating any variant placed on adjacent wall cells within 2 steps
        const forbidden = new Set()
        for (let dr = -2; dr <= 2; dr += 1) {
          for (let dc = -2; dc <= 2; dc += 1) {
            if (Math.abs(dr) + Math.abs(dc) > 2) continue
            const prevList = cellVariantHistory.get(`${r + dr},${c + dc}`)
            if (prevList) {
              for (let k = 0; k < prevList.length; k += 1) {
                forbidden.add(prevList[k])
              }
            }
          }
        }

        const faceList = []
        for (let layer = 0; layer < layerCount; layer += 1) {
          const variant = pickAntiRepeatVariant(WALL_IMPERFECTION_VARIANTS, rng, forbidden)
          forbidden.add(variant)
          faceList.push(variant)

          const scaleW = 0.45 + rng() * 0.72
          const scaleH = 0.38 + rng() * 0.68
          const halfW = Math.min(CELL_SIZE * 0.36, scaleW)
          const halfH = Math.min(bodyHeight * 0.36, scaleH)
          const maxShift = Math.max(0.1, CELL_SIZE * 0.45 - halfW)
          const lateralShift = (rng() * 2 - 1) * maxShift

          // Place rust drips/peels slightly higher/mid, cracks/spalls anywhere
          const minY = halfH + 0.16
          const maxY = Math.max(minY + 0.05, bodyHeight - halfH - 0.14)
          const centerY = lerp(minY, maxY, variant === 4 ? 0.45 + rng() * 0.45 : rng())
          const tilt =
            variant === 4
              ? (rng() - 0.5) * 0.18
              : variant === 1
                ? (rng() - 0.5) * 0.45
                : (rng() - 0.5) * Math.PI * 0.85

          placements.push({
            r,
            c,
            dir,
            variant,
            halfW,
            halfH,
            centerY,
            lateralShift,
            tilt,
            flipU: rng() < 0.5,
            flipV: VERT_FLIP_SAFE.has(variant) && rng() < 0.5,
            tint: 0.82 + rng() * 0.24,
            warmth: (rng() - 0.5) * 0.08,
            alpha: 0.42 + rng() * 0.44,
          })
        }

        const key = `${r},${c}`
        const existing = cellVariantHistory.get(key)
        if (existing) {
          existing.push(...faceList)
        } else {
          cellVariantHistory.set(key, faceList)
        }
      }
    }
  }

  if (placements.length === 0) {
    return null
  }

  const count = placements.length
  const positions = new Float32Array(count * 4 * 3)
  const normals = new Float32Array(count * 4 * 3)
  const uvs = new Float32Array(count * 4 * 2)
  const colors = new Float32Array(count * 4 * 4)
  const indices = createIndexBufferArray(count * 4, count * 6)
  const variantIndices = new Uint8Array(count)

  // Sits cleanly outside wall body (+0.006m) and strictly beneath graffiti (+0.014m)
  const wallOffset = CELL_SIZE / 2 + 0.006

  for (let i = 0; i < count; i += 1) {
    const p = placements[i]
    const world = gridToWorld(p.r, p.c, maze)
    if (!world) continue

    variantIndices[i] = p.variant
    const cx = world.x + p.dir.nx * wallOffset + p.dir.tx * p.lateralShift
    const cz = world.z + p.dir.nz * wallOffset + p.dir.tz * p.lateralShift
    const cosT = Math.cos(p.tilt)
    const sinT = Math.sin(p.tilt)

    const corners = [
      [-p.halfW, -p.halfH],
      [p.halfW, -p.halfH],
      [p.halfW, p.halfH],
      [-p.halfW, p.halfH],
    ]

    const vBase = i * 4
    for (let k = 0; k < 4; k += 1) {
      const [lx, ly] = corners[k]
      const rx = lx * cosT - ly * sinT
      const ry = lx * sinT + ly * cosT
      const vIdx = (vBase + k) * 3
      positions[vIdx] = cx + p.dir.tx * rx
      positions[vIdx + 1] = p.centerY + ry
      positions[vIdx + 2] = cz + p.dir.tz * rx
      normals[vIdx] = p.dir.nx
      normals[vIdx + 1] = 0
      normals[vIdx + 2] = p.dir.nz
    }

    writeQuadUvs(uvs, vBase * 2, IMPERFECTION_ATLAS_UVS[p.variant], p.flipU, p.flipV)
    writeQuadRgba(
      colors,
      vBase * 4,
      clamp(p.tint + p.warmth, 0.7, 1.08),
      clamp(p.tint, 0.7, 1.08),
      clamp(p.tint - p.warmth * 0.6, 0.7, 1.08),
      p.alpha
    )

    const iBase = i * 6
    indices[iBase] = vBase
    indices[iBase + 1] = vBase + 1
    indices[iBase + 2] = vBase + 2
    indices[iBase + 3] = vBase
    indices[iBase + 4] = vBase + 2
    indices[iBase + 5] = vBase + 3
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const mesh = new THREE.Mesh(geometry, imperfectionMaterial)
  mesh.name = 'maze-walls-imperfections'
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.userData = {
    decalCount: count,
    variantIndices,
  }
  return mesh
}

/**
 * Places non-repeating cracks, scuff arcs, chips, and irregular stains across
 * walkable corridor floor tiles, enforcing anti-neighbor variant uniqueness and
 * full 360-degree orientation variety in a single static draw-call Mesh.
 */
export function buildFloorImperfectionMesh(maze, imperfectionMaterial) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !imperfectionMaterial) {
    return null
  }

  const rows = grid.length
  const cols = grid[0]?.length || 0
  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-floor-imp-v2`)
  const placements = []
  const cellVariantHistory = new Map()

  const isSpecialCell = (r, c) =>
    (maze.start && maze.start.row === r && maze.start.col === c) ||
    (maze.exit && maze.exit.row === r && maze.exit.col === c)

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH || isSpecialCell(r, c)) continue

      const roll = rng()
      if (roll > 0.54) continue
      const layerCount = roll < 0.14 ? 2 : 1

      const forbidden = new Set()
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const prevList = cellVariantHistory.get(`${r + dr},${c + dc}`)
          if (prevList) {
            for (let k = 0; k < prevList.length; k += 1) {
              forbidden.add(prevList[k])
            }
          }
        }
      }

      const cellList = []
      for (let layer = 0; layer < layerCount; layer += 1) {
        const variant = pickAntiRepeatVariant(FLOOR_IMPERFECTION_VARIANTS, rng, forbidden)
        forbidden.add(variant)
        cellList.push(variant)

        const halfW = 0.55 + rng() * 0.85
        const halfD = 0.5 + rng() * 0.85
        const radiusBound = Math.hypot(halfW, halfD)
        const maxShift = Math.max(0.08, CELL_SIZE * 0.48 - radiusBound * 0.65)
        const shiftX = (rng() * 2 - 1) * maxShift
        const shiftZ = (rng() * 2 - 1) * maxShift

        placements.push({
          r,
          c,
          variant,
          halfW,
          halfD,
          shiftX,
          shiftZ,
          rot: rng() * Math.PI * 2,
          flipU: rng() < 0.5,
          flipV: rng() < 0.5,
          tint: 0.78 + rng() * 0.24,
          warmth: (rng() - 0.5) * 0.08,
          alpha: 0.36 + rng() * 0.42,
        })
      }

      cellVariantHistory.set(`${r},${c}`, cellList)
    }
  }

  if (placements.length === 0) {
    return null
  }

  const count = placements.length
  const positions = new Float32Array(count * 4 * 3)
  const normals = new Float32Array(count * 4 * 3)
  const uvs = new Float32Array(count * 4 * 2)
  const colors = new Float32Array(count * 4 * 4)
  const indices = createIndexBufferArray(count * 4, count * 6)
  const variantIndices = new Uint8Array(count)

  // Sits slightly above floor slab (y=0) and below marker bases (y=0.06)
  const yFloorDecal = 0.0045

  for (let i = 0; i < count; i += 1) {
    const p = placements[i]
    const world = gridToWorld(p.r, p.c, maze)
    if (!world) continue

    variantIndices[i] = p.variant
    const cx = world.x + p.shiftX
    const cz = world.z + p.shiftZ
    const cosR = Math.cos(p.rot)
    const sinR = Math.sin(p.rot)

    // Corners ordered (-hw,+hd), (+hw,+hd), (+hw,-hd), (-hw,-hd) so e1 x e2 = (0, +1, 0)
    const corners = [
      [-p.halfW, p.halfD],
      [p.halfW, p.halfD],
      [p.halfW, -p.halfD],
      [-p.halfW, -p.halfD],
    ]

    const vBase = i * 4
    for (let k = 0; k < 4; k += 1) {
      const [lx, lz] = corners[k]
      const rx = lx * cosR - lz * sinR
      const rz = lx * sinR + lz * cosR
      const vIdx = (vBase + k) * 3
      positions[vIdx] = cx + rx
      positions[vIdx + 1] = yFloorDecal
      positions[vIdx + 2] = cz + rz
      normals[vIdx] = 0
      normals[vIdx + 1] = 1
      normals[vIdx + 2] = 0
    }

    writeQuadUvs(uvs, vBase * 2, IMPERFECTION_ATLAS_UVS[p.variant], p.flipU, p.flipV)
    writeQuadRgba(
      colors,
      vBase * 4,
      clamp(p.tint + p.warmth, 0.68, 1.05),
      clamp(p.tint, 0.68, 1.05),
      clamp(p.tint - p.warmth * 0.6, 0.68, 1.05),
      p.alpha
    )

    const iBase = i * 6
    indices[iBase] = vBase
    indices[iBase + 1] = vBase + 1
    indices[iBase + 2] = vBase + 2
    indices[iBase + 3] = vBase
    indices[iBase + 4] = vBase + 2
    indices[iBase + 5] = vBase + 3
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const mesh = new THREE.Mesh(geometry, imperfectionMaterial)
  mesh.name = 'maze-floor-imperfections'
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.userData = {
    decalCount: count,
    variantIndices,
  }
  return mesh
}
