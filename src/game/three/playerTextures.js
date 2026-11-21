import * as THREE from 'three'
import {
  markSharedResource,
  registerSharedPoolClearer,
  registerTextureAnisotropySyncer,
} from './sharedResources.js'

/**
 * Expanded player character palette preserving every legacy key and exact
 * `coat` hex luminance contract from `buildPlayer.js`.
 */
export const PLAYER_PALETTE = Object.freeze({
  coat: 0x263347, // Must stay above MAZE_MESH_PALETTE.floor luminance
  trousers: 0x182232,
  gear: 0x362e29,
  hardware: 0x64748b,
  mask: 0x1c2636,
  accent: 0x818cf8,
  accentEmissive: 0x6366f1,
  skin: 0xc89577,
  skinShadow: 0xa67358,
  lips: 0x9b6256,
  hair: 0x2b1e16,
  eyesSclera: 0xe6e2da,
  eyesIris: 0x2f4354,
  boots: 0x26201b,
  gloves: 0x2d2520,
  backpack: 0x362e29,
})

/**
 * Calibrated PBR material specifications for Phase 2 character assembly.
 * Each albedo `DataTexture` is authored as a subtle, near-neutral detail multiplier
 * (~0.78–1.04) so pairing it with `spec.color` preserves the exact palette luminance.
 */
export const PLAYER_MATERIAL_SPECS = Object.freeze({
  skin: Object.freeze({
    color: PLAYER_PALETTE.skin,
    textureKey: 'skin',
    roughness: 0.56,
    metalness: 0.0,
    bumpScale: 0.0026,
    envMapIntensity: 0.32,
    sheen: 0.16,
    sheenRoughness: 0.68,
    sheenColor: 0xd99278,
  }),
  lips: Object.freeze({
    color: PLAYER_PALETTE.lips,
    textureKey: 'skin',
    roughness: 0.48,
    metalness: 0.0,
    bumpScale: 0.0022,
    envMapIntensity: 0.34,
    sheen: 0.12,
    sheenRoughness: 0.58,
    sheenColor: 0xc27a6c,
  }),
  hair: Object.freeze({
    color: PLAYER_PALETTE.hair,
    textureKey: 'hair',
    roughness: 0.68,
    metalness: 0.02,
    bumpScale: 0.015,
    envMapIntensity: 0.3,
    sheen: 0.24,
    sheenRoughness: 0.52,
    sheenColor: 0x5c4132,
  }),
  eyesSclera: Object.freeze({
    color: PLAYER_PALETTE.eyesSclera,
    textureKey: null,
    roughness: 0.12,
    metalness: 0.0,
    bumpScale: 0,
    envMapIntensity: 0.62,
    clearcoat: 0.9,
    clearcoatRoughness: 0.06,
  }),
  eyesIris: Object.freeze({
    color: PLAYER_PALETTE.eyesIris,
    textureKey: null,
    roughness: 0.09,
    metalness: 0.04,
    bumpScale: 0,
    envMapIntensity: 0.72,
    clearcoat: 0.95,
    clearcoatRoughness: 0.04,
  }),
  jacket: Object.freeze({
    color: PLAYER_PALETTE.coat,
    textureKey: 'jacket',
    roughness: 0.86,
    metalness: 0.02,
    bumpScale: 0.011,
    envMapIntensity: 0.26,
    sheen: 0.28,
    sheenRoughness: 0.84,
    sheenColor: 0x4e607d,
  }),
  trousers: Object.freeze({
    color: PLAYER_PALETTE.trousers,
    textureKey: 'trousers',
    roughness: 0.89,
    metalness: 0.02,
    bumpScale: 0.01,
    envMapIntensity: 0.24,
    sheen: 0.24,
    sheenRoughness: 0.88,
    sheenColor: 0x3b4961,
  }),
  boots: Object.freeze({
    color: PLAYER_PALETTE.boots,
    textureKey: 'leather',
    roughness: 0.58,
    metalness: 0.06,
    bumpScale: 0.014,
    envMapIntensity: 0.38,
  }),
  gloves: Object.freeze({
    color: PLAYER_PALETTE.gloves,
    textureKey: 'leather',
    roughness: 0.64,
    metalness: 0.05,
    bumpScale: 0.012,
    envMapIntensity: 0.34,
  }),
  backpack: Object.freeze({
    color: PLAYER_PALETTE.backpack,
    textureKey: 'leather',
    roughness: 0.76,
    metalness: 0.04,
    bumpScale: 0.013,
    envMapIntensity: 0.28,
    sheen: 0.14,
    sheenRoughness: 0.82,
    sheenColor: 0x4f443c,
  }),
  hardware: Object.freeze({
    color: PLAYER_PALETTE.hardware,
    textureKey: null,
    roughness: 0.32,
    metalness: 0.82,
    bumpScale: 0,
    envMapIntensity: 0.72,
  }),
})

export const PLAYER_TEXTURE_KEYS = Object.freeze([
  'skin',
  'hair',
  'jacket',
  'trousers',
  'leather',
])

/**
 * Quality-scaled texture dimensions matching Maze Escape's performance tiers.
 * At 64px (`performance`), all 5 texture trios occupy ~240 KB total;
 * at 128px (`balanced`), ~960 KB; at 256px (`high`), ~3.75 MB.
 */
export const PLAYER_TEXTURE_QUALITY_PRESETS = Object.freeze({
  performance: Object.freeze({
    id: 'performance',
    albedoSize: 64,
    detailSize: 64,
    anisotropyCap: 1,
  }),
  balanced: Object.freeze({
    id: 'balanced',
    albedoSize: 128,
    detailSize: 128,
    anisotropyCap: 4,
  }),
  high: Object.freeze({
    id: 'high',
    albedoSize: 256,
    detailSize: 256,
    anisotropyCap: 8,
  }),
})

const playerTexturePool = new Map()
const presetOwners = new Map()

function getOrCreatePresetOwnerSet(preset) {
  let owners = presetOwners.get(preset)
  if (!owners) {
    owners = new Set()
    presetOwners.set(preset, owners)
  }
  return owners
}

function disposeTextureBundle(bundle) {
  if (!bundle) return
  for (let i = 0; i < PLAYER_TEXTURE_KEYS.length; i += 1) {
    const entry = bundle[PLAYER_TEXTURE_KEYS[i]]
    if (!entry) continue
    entry.map?.dispose?.()
    entry.bumpMap?.dispose?.()
    entry.roughnessMap?.dispose?.()
  }
}

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

function hash2i(ix, iy, seed = 4219) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

function samplePeriodicNoise(u, v, periodX, periodY, seed) {
  const uWrap = u >= 0 && u < 1 ? u : ((u % 1) + 1) % 1
  const vWrap = v >= 0 && v < 1 ? v : ((v % 1) + 1) % 1
  const fx = uWrap * periodX
  const fy = vWrap * periodY
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)

  const ix0 = x0 < periodX ? x0 : x0 % periodX
  const ix1 = ix0 + 1 < periodX ? ix0 + 1 : 0
  const iy0 = y0 < periodY ? y0 : y0 % periodY
  const iy1 = iy0 + 1 < periodY ? iy0 + 1 : 0

  const n00 = hash2i(ix0, iy0, seed)
  const n10 = hash2i(ix1, iy0, seed)
  const n01 = hash2i(ix0, iy1, seed)
  const n11 = hash2i(ix1, iy1, seed)
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy)
}

function samplePeriodicFbm(u, v, basePeriod, octaves, seed, periodYScale = 1) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let freq = basePeriod
  for (let o = 0; o < octaves; o += 1) {
    const py = Math.max(1, Math.round(freq * periodYScale))
    sum += amp * samplePeriodicNoise(u, v, freq, py, seed + o * 97)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm : 0.5
}

function writeRgbTexel(buf, offset, r, g, b) {
  buf[offset] = Math.round(clamp(r, 0.04, 1.0) * 255)
  buf[offset + 1] = Math.round(clamp(g, 0.04, 1.0) * 255)
  buf[offset + 2] = Math.round(clamp(b, 0.04, 1.0) * 255)
  buf[offset + 3] = 255
}

function writeScalarTexel(buf, offset, val) {
  const byte = Math.round(clamp(val, 0.04, 0.99) * 255)
  buf[offset] = byte
  buf[offset + 1] = byte
  buf[offset + 2] = byte
  buf[offset + 3] = 255
}

function createPlayerDataTexture(bytes, width, height, srgb, presetSpec) {
  const tex = new THREE.DataTexture(
    bytes,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  )
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = presetSpec.anisotropyCap
  tex.userData = {
    ...(tex.userData || {}),
    isPlayerTexture: true,
    qualityPreset: presetSpec.id,
  }
  tex.needsUpdate = true
  return markSharedResource(tex)
}

function buildSurfaceBuffers(surfaceKey, presetSpec) {
  const albedoSize = presetSpec.albedoSize
  const detailSize = presetSpec.detailSize
  const albedo = new Uint8Array(albedoSize * albedoSize * 4)
  const bump = new Uint8Array(detailSize * detailSize * 4)
  const rough = new Uint8Array(detailSize * detailSize * 4)

  const sampleSurface = (u, v, px, py, sizeHint) => {
    const micro = hash2i(px, py, 7919) - 0.5

    if (surfaceKey === 'skin') {
      // Natural human dermis: subtle hemoglobin warmth, melanin undertone & fine directional skin lines
      const undertone = samplePeriodicFbm(u, v, 4, 3, 1103)
      const capillary = samplePeriodicFbm(u + 0.19, v + 0.37, 6, 2, 1129)
      const warmth = samplePeriodicFbm(u + 0.23, v + 0.41, 3, 2, 1151)
      const creaseDiag = Math.sin((u * 14 + v * 9 + undertone * 1.4) * Math.PI * 2) * 0.5 + 0.5
      const microGrain = samplePeriodicNoise(
        u,
        v,
        Math.max(14, Math.round(sizeHint * 0.3)),
        Math.max(14, Math.round(sizeHint * 0.3)),
        1181
      )
      const poreFreq = Math.max(20, Math.round(sizeHint * 0.44))
      const poreNoise = samplePeriodicNoise(u + 0.07, v + 0.13, poreFreq, poreFreq, 1193)
      const poreIndent = smoothstep(0.76, 0.97, poreNoise)

      const baseLum =
        0.972 +
        (undertone - 0.5) * 0.048 +
        (microGrain - 0.5) * 0.02 -
        poreIndent * 0.02 +
        micro * 0.005
      const flush = (warmth - 0.5) * 0.055 + (capillary - 0.5) * 0.032
      const r = baseLum * (1.012 + flush)
      const g = baseLum * (0.986 - flush * 0.32)
      const b = baseLum * (0.954 - flush * 0.78)

      const bumpVal = clamp(
        0.52 - poreIndent * 0.15 + (microGrain - 0.5) * 0.065 + (creaseDiag - 0.5) * 0.035 + micro * 0.014,
        0.28,
        0.72
      )
      const roughVal = clamp(
        0.56 + (undertone - 0.5) * 0.065 + poreIndent * 0.045 - (warmth - 0.5) * 0.045 + micro * 0.012,
        0.46,
        0.68
      )
      return { r, g, b, bumpVal, roughVal }
    }

    if (surfaceKey === 'hair') {
      // Multi-scale layered hair fibers with natural clumping and subtle root-to-tip sheen
      const strandWarp = samplePeriodicFbm(u, v * 0.35, 3, 2, 2113) * 0.065
      const strandFreq = Math.max(22, Math.round(sizeHint * 0.34))
      const primaryStrand =
        Math.sin((u * strandFreq + strandWarp * 8.0) * Math.PI * 2) * 0.5 + 0.5
      const fineStrand = samplePeriodicNoise(
        u + strandWarp * 0.28,
        v * 0.1,
        Math.max(30, Math.round(sizeHint * 0.54)),
        5,
        2153
      )
      const bundleShade = samplePeriodicNoise(
        u + strandWarp * 0.18,
        v * 0.18,
        Math.max(9, Math.round(sizeHint * 0.14)),
        4,
        2179
      )
      const tonalWave = samplePeriodicFbm(u + 0.17, v + 0.31, 4, 2, 2207)
      const specularBand = Math.exp(-Math.pow((v - 0.52 + (strandWarp - 0.03) * 1.4) / 0.24, 2))

      const lum =
        0.905 +
        (primaryStrand - 0.5) * 0.15 +
        (fineStrand - 0.5) * 0.15 +
        (bundleShade - 0.5) * 0.13 +
        (tonalWave - 0.5) * 0.075 +
        specularBand * 0.045 +
        micro * 0.016
      const r = lum * 1.048
      const g = lum * 0.98
      const b = lum * 0.908

      const bumpVal = clamp(
        0.5 + (primaryStrand - 0.5) * 0.3 + (fineStrand - 0.5) * 0.25 + (bundleShade - 0.5) * 0.14 + micro * 0.02,
        0.14,
        0.88
      )
      const roughVal = clamp(
        0.72 - (primaryStrand - 0.5) * 0.11 - specularBand * 0.08 + (bundleShade - 0.5) * 0.06 + micro * 0.015,
        0.54,
        0.84
      )
      return { r, g, b, bumpVal, roughVal }
    }

    if (surfaceKey === 'jacket') {
      // Tailored 2x2 diagonal explorer twill + subtle ripstop thread reinforcement
      const twillFreq = Math.max(16, Math.round(sizeHint * 0.28))
      const ripstopPeriod = Math.max(4, Math.round(twillFreq / 4))
      const twillDiag =
        Math.sin(((u + v) * twillFreq) * Math.PI * 2) * 0.5 + 0.5
      const crossThread =
        Math.sin(((u - v) * twillFreq) * Math.PI * 2) * 0.5 + 0.5
      const weave = lerp(twillDiag, crossThread, 0.24)
      const ripU = smoothstep(0.92, 1.0, Math.abs(Math.cos(u * ripstopPeriod * Math.PI)))
      const ripV = smoothstep(0.92, 1.0, Math.abs(Math.cos(v * ripstopPeriod * Math.PI)))
      const ripGrid = Math.max(ripU, ripV)
      const wearFbm = samplePeriodicFbm(u, v, 3, 3, 3109)

      const lum =
        0.954 +
        (weave - 0.5) * 0.075 +
        ripGrid * 0.042 +
        (wearFbm - 0.5) * 0.052 +
        micro * 0.01
      const r = lum * 0.976
      const g = lum * 0.993
      const b = lum * 1.018

      const bumpVal = clamp(
        0.5 + (weave - 0.5) * 0.25 + ripGrid * 0.14 + (wearFbm - 0.5) * 0.035 + micro * 0.016,
        0.2,
        0.82
      )
      const roughVal = clamp(
        0.86 - (weave - 0.5) * 0.05 + (wearFbm - 0.5) * 0.035 + micro * 0.012,
        0.76,
        0.94
      )
      return { r, g, b, bumpVal, roughVal }
    }

    if (surfaceKey === 'trousers') {
      // Brushed field cargo cotton canvas
      const weaveFreq = Math.max(16, Math.round(sizeHint * 0.27))
      const warp = Math.sin(u * weaveFreq * Math.PI * 2) * 0.5 + 0.5
      const weft = Math.sin(v * weaveFreq * Math.PI * 2) * 0.5 + 0.5
      const canvas = warp * 0.52 + weft * 0.48
      const brushed = samplePeriodicFbm(u, v, 4, 3, 4127)
      const sheenPatina = smoothstep(0.58, 0.9, samplePeriodicFbm(u + 0.37, v + 0.19, 3, 2, 4177))

      const lum =
        0.946 +
        (canvas - 0.5) * 0.072 +
        (brushed - 0.5) * 0.062 +
        sheenPatina * 0.032 +
        micro * 0.01
      const r = lum * 1.005
      const g = lum * 1.0
      const b = lum * 0.986

      const bumpVal = clamp(
        0.5 + (canvas - 0.5) * 0.22 + (brushed - 0.5) * 0.055 + micro * 0.016,
        0.22,
        0.8
      )
      const roughVal = clamp(
        0.89 + sheenPatina * 0.03 + (brushed - 0.5) * 0.035 + micro * 0.012,
        0.81,
        0.96
      )
      return { r, g, b, bumpVal, roughVal }
    }

    // surfaceKey === 'leather' (supple tumbled leather for boots, gloves & straps)
    const grainPeriod = Math.max(11, Math.round(sizeHint * 0.2))
    const pebbleA = samplePeriodicNoise(u, v, grainPeriod, grainPeriod, 5101)
    const pebbleB = samplePeriodicNoise(
      u + 0.21,
      v + 0.37,
      Math.round(grainPeriod * 1.6),
      Math.round(grainPeriod * 1.6),
      5147
    )
    const pebble = smoothstep(0.24, 0.78, pebbleA * 0.6 + pebbleB * 0.4)
    const crease = samplePeriodicFbm(u, v, 4, 3, 5189)
    const burnish = smoothstep(
      0.8,
      0.97,
      samplePeriodicNoise(u * 1.15 + v * 0.25, v * 0.4, 14, 14, 5231)
    )

    const lum =
      0.925 +
      (pebble - 0.5) * 0.105 +
      (crease - 0.5) * 0.07 +
      burnish * 0.065 +
      micro * 0.012
    const r = lum * (1.032 + burnish * 0.032)
    const g = lum * (0.992 + burnish * 0.015)
    const b = lum * 0.935

    const bumpVal = clamp(
      0.5 + (pebble - 0.5) * 0.32 + (crease - 0.5) * 0.1 - burnish * 0.06 + micro * 0.018,
      0.16,
      0.86
    )
    const roughVal = clamp(
      0.64 - (pebble - 0.5) * 0.1 - burnish * 0.11 + (crease - 0.5) * 0.065 + micro * 0.014,
      0.44,
      0.81
    )
    return { r, g, b, bumpVal, roughVal }
  }

  for (let py = 0; py < albedoSize; py += 1) {
    const v = py / albedoSize
    for (let px = 0; px < albedoSize; px += 1) {
      const u = px / albedoSize
      const off = (py * albedoSize + px) * 4
      const s = sampleSurface(u, v, px, py, albedoSize)
      writeRgbTexel(albedo, off, s.r, s.g, s.b)
      if (detailSize === albedoSize) {
        writeScalarTexel(bump, off, s.bumpVal)
        writeScalarTexel(rough, off, s.roughVal)
      }
    }
  }

  if (detailSize !== albedoSize) {
    for (let py = 0; py < detailSize; py += 1) {
      const v = py / detailSize
      for (let px = 0; px < detailSize; px += 1) {
        const u = px / detailSize
        const off = (py * detailSize + px) * 4
        const s = sampleSurface(u, v, px, py, detailSize)
        writeScalarTexel(bump, off, s.bumpVal)
        writeScalarTexel(rough, off, s.roughVal)
      }
    }
  }

  return { albedo, bump, rough }
}

/**
 * Resolves a graphics quality preset string to a valid key in
 * `PLAYER_TEXTURE_QUALITY_PRESETS` (`'performance' | 'balanced' | 'high'`).
 */
export function resolvePlayerTextureQualityPreset(qualityPreset = 'high') {
  return typeof qualityPreset === 'string' &&
    qualityPreset in PLAYER_TEXTURE_QUALITY_PRESETS
    ? qualityPreset
    : 'high'
}

/**
 * Generates or retrieves the pooled procedural `DataTexture` bundle for all
 * player character surfaces (`skin`, `hair`, `jacket`, `trousers`, `leather`)
 * at the requested quality preset.
 *
 * Works deterministically in headless Node.js environments (no DOM/Canvas/WebGL).
 *
 * @param {object} [options]
 * @param {'performance'|'balanced'|'high'} [options.qualityPreset='high']
 * @returns {{
 *   qualityPreset: 'performance'|'balanced'|'high',
 *   presetSpec: { id: string, albedoSize: number, detailSize: number, anisotropyCap: number },
 *   skin: { map: THREE.DataTexture, bumpMap: THREE.DataTexture, roughnessMap: THREE.DataTexture },
 *   hair: { map: THREE.DataTexture, bumpMap: THREE.DataTexture, roughnessMap: THREE.DataTexture },
 *   jacket: { map: THREE.DataTexture, bumpMap: THREE.DataTexture, roughnessMap: THREE.DataTexture },
 *   trousers: { map: THREE.DataTexture, bumpMap: THREE.DataTexture, roughnessMap: THREE.DataTexture },
 *   leather: { map: THREE.DataTexture, bumpMap: THREE.DataTexture, roughnessMap: THREE.DataTexture },
 * }}
 */
export function getPlayerTextureSet(options = {}) {
  const preset = resolvePlayerTextureQualityPreset(options?.qualityPreset)
  const presetSpec = PLAYER_TEXTURE_QUALITY_PRESETS[preset]

  let cached = playerTexturePool.get(preset)
  if (!cached) {
    const bundle = {
      qualityPreset: preset,
      presetSpec,
    }
    for (let i = 0; i < PLAYER_TEXTURE_KEYS.length; i += 1) {
      const key = PLAYER_TEXTURE_KEYS[i]
      const { albedo, bump, rough } = buildSurfaceBuffers(key, presetSpec)
      bundle[key] = {
        map: createPlayerDataTexture(
          albedo,
          presetSpec.albedoSize,
          presetSpec.albedoSize,
          true,
          presetSpec
        ),
        bumpMap: createPlayerDataTexture(
          bump,
          presetSpec.detailSize,
          presetSpec.detailSize,
          false,
          presetSpec
        ),
        roughnessMap: createPlayerDataTexture(
          rough,
          presetSpec.detailSize,
          presetSpec.detailSize,
          false,
          presetSpec
        ),
      }
    }
    playerTexturePool.set(preset, bundle)
    cached = bundle
  }

  return cached
}

export function retainPlayerTexturePreset(qualityPreset = 'high', ownerToken = null) {
  const preset = resolvePlayerTextureQualityPreset(qualityPreset)
  if (ownerToken !== null && ownerToken !== undefined) {
    getOrCreatePresetOwnerSet(preset).add(ownerToken)
  }
  return preset
}

export function releasePlayerTexturePreset(ownerToken, qualityPreset = null) {
  if (ownerToken === null || ownerToken === undefined) {
    return 0
  }
  if (qualityPreset !== null && qualityPreset !== undefined) {
    const preset = resolvePlayerTextureQualityPreset(qualityPreset)
    const owners = presetOwners.get(preset)
    if (owners) {
      owners.delete(ownerToken)
      if (owners.size === 0) {
        presetOwners.delete(preset)
      }
      return owners.size
    }
    return 0
  }

  for (const [preset, owners] of presetOwners.entries()) {
    owners.delete(ownerToken)
    if (owners.size === 0) {
      presetOwners.delete(preset)
    }
  }
  return 0
}

export function getPlayerTexturePresetRefCount(qualityPreset = 'high') {
  const preset = resolvePlayerTextureQualityPreset(qualityPreset)
  return presetOwners.get(preset)?.size || 0
}

/**
 * Safely disposes pooled player `DataTexture` instances that are no longer
 * retained by live players, or all pools when `{ force: true }` is passed
 * (used during engine/app shutdown via `disposeAllSharedPools()`).
 * Idempotent across repeated calls and engine resets.
 */
export function disposePlayerTexturePools(options = {}) {
  const force = Boolean(options?.force)

  if (force) {
    for (const bundle of playerTexturePool.values()) {
      disposeTextureBundle(bundle)
    }
    playerTexturePool.clear()
    presetOwners.clear()
    return
  }

  for (const [preset, bundle] of playerTexturePool.entries()) {
    const refCount = presetOwners.get(preset)?.size || 0
    if (refCount > 0) continue
    disposeTextureBundle(bundle)
    playerTexturePool.delete(preset)
    presetOwners.delete(preset)
  }
}

/**
 * Disposes any cached preset bundles that currently have zero active owners
 * and do not match `keepPreset`. Safe during runtime quality transitions.
 */
export function pruneUnusedPlayerTexturePools(keepPreset = null) {
  const resolvedKeep =
    typeof keepPreset === 'string' && keepPreset in PLAYER_TEXTURE_QUALITY_PRESETS
      ? keepPreset
      : null
  let pruned = 0
  for (const [preset, bundle] of playerTexturePool.entries()) {
    if (resolvedKeep && preset === resolvedKeep) continue
    const refCount = presetOwners.get(preset)?.size || 0
    if (refCount > 0) continue
    disposeTextureBundle(bundle)
    playerTexturePool.delete(preset)
    presetOwners.delete(preset)
    pruned += 1
  }
  return pruned
}

/**
 * Returns pool telemetry for tests and diagnostics.
 */
export function getPlayerTexturePoolStats() {
  let textures = 0
  for (const bundle of playerTexturePool.values()) {
    if (!bundle) continue
    for (let i = 0; i < PLAYER_TEXTURE_KEYS.length; i += 1) {
      const entry = bundle[PLAYER_TEXTURE_KEYS[i]]
      if (!entry) continue
      if (entry.map) textures += 1
      if (entry.bumpMap) textures += 1
      if (entry.roughnessMap) textures += 1
    }
  }
  return {
    presetsCached: playerTexturePool.size,
    textures,
  }
}

registerSharedPoolClearer(() => disposePlayerTexturePools({ force: true }))
registerTextureAnisotropySyncer((updateTex) => {
  for (const bundle of playerTexturePool.values()) {
    if (!bundle) continue
    for (let i = 0; i < PLAYER_TEXTURE_KEYS.length; i += 1) {
      const entry = bundle[PLAYER_TEXTURE_KEYS[i]]
      if (!entry) continue
      updateTex(entry.map)
      updateTex(entry.bumpMap)
      updateTex(entry.roughnessMap)
    }
  }
})
