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
    roughness: 0.62,
    metalness: 0.02,
    bumpScale: 0.004,
    envMapIntensity: 0.35,
  }),
  lips: Object.freeze({
    color: PLAYER_PALETTE.lips,
    textureKey: 'skin',
    roughness: 0.48,
    metalness: 0.02,
    bumpScale: 0.003,
    envMapIntensity: 0.35,
  }),
  hair: Object.freeze({
    color: PLAYER_PALETTE.hair,
    textureKey: 'hair',
    roughness: 0.72,
    metalness: 0.04,
    bumpScale: 0.012,
    envMapIntensity: 0.3,
  }),
  eyesSclera: Object.freeze({
    color: PLAYER_PALETTE.eyesSclera,
    textureKey: null,
    roughness: 0.18,
    metalness: 0.0,
    bumpScale: 0,
    envMapIntensity: 0.5,
  }),
  eyesIris: Object.freeze({
    color: PLAYER_PALETTE.eyesIris,
    textureKey: null,
    roughness: 0.15,
    metalness: 0.05,
    bumpScale: 0,
    envMapIntensity: 0.55,
  }),
  jacket: Object.freeze({
    color: PLAYER_PALETTE.coat,
    textureKey: 'jacket',
    roughness: 0.85,
    metalness: 0.06,
    bumpScale: 0.014,
    envMapIntensity: 0.32,
  }),
  trousers: Object.freeze({
    color: PLAYER_PALETTE.trousers,
    textureKey: 'trousers',
    roughness: 0.9,
    metalness: 0.04,
    bumpScale: 0.012,
    envMapIntensity: 0.28,
  }),
  boots: Object.freeze({
    color: PLAYER_PALETTE.boots,
    textureKey: 'leather',
    roughness: 0.66,
    metalness: 0.1,
    bumpScale: 0.018,
    envMapIntensity: 0.34,
  }),
  gloves: Object.freeze({
    color: PLAYER_PALETTE.gloves,
    textureKey: 'leather',
    roughness: 0.72,
    metalness: 0.08,
    bumpScale: 0.015,
    envMapIntensity: 0.3,
  }),
  backpack: Object.freeze({
    color: PLAYER_PALETTE.backpack,
    textureKey: 'leather',
    roughness: 0.76,
    metalness: 0.08,
    bumpScale: 0.016,
    envMapIntensity: 0.3,
  }),
  hardware: Object.freeze({
    color: PLAYER_PALETTE.hardware,
    textureKey: null,
    roughness: 0.38,
    metalness: 0.7,
    bumpScale: 0,
    envMapIntensity: 0.65,
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
      const mottle = samplePeriodicFbm(u, v, 4, 3, 1103)
      const warmth = samplePeriodicFbm(u + 0.23, v + 0.41, 3, 2, 1151)
      const poreFreq = Math.max(16, Math.round(sizeHint * 0.35))
      const poreNoise = samplePeriodicNoise(u, v, poreFreq, poreFreq, 1193)
      const poreIndent = smoothstep(0.68, 0.94, poreNoise)

      const baseLum = 0.96 + (mottle - 0.5) * 0.08 - poreIndent * 0.04 + micro * 0.015
      const r = baseLum * (1.0 + (warmth - 0.5) * 0.05)
      const g = baseLum * (0.985 - (warmth - 0.5) * 0.025)
      const b = baseLum * (0.965 - (warmth - 0.5) * 0.045)

      const bumpVal = clamp(0.54 - poreIndent * 0.2 + (mottle - 0.5) * 0.06 + micro * 0.03, 0.22, 0.8)
      const roughVal = clamp(0.6 + (mottle - 0.5) * 0.08 + poreIndent * 0.06 + micro * 0.02, 0.5, 0.72)
      return { r, g, b, bumpVal, roughVal }
    }

    if (surfaceKey === 'hair') {
      const strandWarp = samplePeriodicFbm(u, v, 3, 2, 2113) * 0.08
      const strandFreq = Math.max(18, Math.round(sizeHint * 0.28))
      const primaryStrand =
        Math.sin((u * strandFreq + strandWarp * 6) * Math.PI * 2) * 0.5 + 0.5
      const fineStrand = samplePeriodicNoise(
        u + strandWarp * 0.3,
        v * 0.15,
        Math.max(24, Math.round(sizeHint * 0.45)),
        6,
        2153
      )
      const tonalWave = samplePeriodicFbm(u + 0.17, v + 0.31, 4, 2, 2207)

      const lum =
        0.91 +
        (primaryStrand - 0.5) * 0.18 +
        (fineStrand - 0.5) * 0.14 +
        (tonalWave - 0.5) * 0.1 +
        micro * 0.03
      const r = lum * 1.04
      const g = lum * 0.98
      const b = lum * 0.92

      const bumpVal = clamp(
        0.5 + (primaryStrand - 0.5) * 0.34 + (fineStrand - 0.5) * 0.2 + micro * 0.04,
        0.15,
        0.86
      )
      const roughVal = clamp(
        0.72 - (primaryStrand - 0.5) * 0.12 + (tonalWave - 0.5) * 0.06 + micro * 0.02,
        0.56,
        0.84
      )
      return { r, g, b, bumpVal, roughVal }
    }

    if (surfaceKey === 'jacket') {
      // 2x2 diagonal twill + ripstop grid threads
      const twillFreq = Math.max(12, Math.round(sizeHint * 0.25))
      const ripstopPeriod = Math.max(4, Math.round(twillFreq / 4))
      const twillDiag =
        Math.sin(((u + v) * twillFreq) * Math.PI * 2) * 0.5 + 0.5
      const crossThread =
        Math.sin(((u - v) * twillFreq) * Math.PI * 2) * 0.5 + 0.5
      const weave = lerp(twillDiag, crossThread, 0.28)
      const ripU = smoothstep(0.9, 1.0, Math.abs(Math.cos(u * ripstopPeriod * Math.PI)))
      const ripV = smoothstep(0.9, 1.0, Math.abs(Math.cos(v * ripstopPeriod * Math.PI)))
      const ripGrid = Math.max(ripU, ripV)
      const wearFbm = samplePeriodicFbm(u, v, 4, 3, 3109)

      const lum =
        0.94 +
        (weave - 0.5) * 0.1 +
        ripGrid * 0.06 +
        (wearFbm - 0.5) * 0.09 +
        micro * 0.02
      const r = lum * 0.97
      const g = lum * 0.99
      const b = lum * 1.02

      const bumpVal = clamp(
        0.5 + (weave - 0.5) * 0.28 + ripGrid * 0.18 + (wearFbm - 0.5) * 0.06 + micro * 0.03,
        0.18,
        0.85
      )
      const roughVal = clamp(
        0.86 - (weave - 0.5) * 0.06 + (wearFbm - 0.5) * 0.05 + micro * 0.02,
        0.74,
        0.94
      )
      return { r, g, b, bumpVal, roughVal }
    }

    if (surfaceKey === 'trousers') {
      // Heavy brushed cargo cotton warp/weft canvas
      const weaveFreq = Math.max(12, Math.round(sizeHint * 0.24))
      const warp = Math.sin(u * weaveFreq * Math.PI * 2) * 0.5 + 0.5
      const weft = Math.sin(v * weaveFreq * Math.PI * 2) * 0.5 + 0.5
      const canvas = lerp(warp * 0.65 + weft * 0.35, warp * 0.35 + weft * 0.65, 0.5)
      const brushed = samplePeriodicFbm(u, v, 5, 3, 4127)
      const dustWear = smoothstep(0.55, 0.88, samplePeriodicFbm(u + 0.37, v + 0.19, 3, 2, 4177))

      const lum =
        0.93 +
        (canvas - 0.5) * 0.09 +
        (brushed - 0.5) * 0.1 +
        dustWear * 0.05 +
        micro * 0.02
      const r = lum * 1.01
      const g = lum * 1.0
      const b = lum * 0.98

      const bumpVal = clamp(
        0.5 + (canvas - 0.5) * 0.24 + (brushed - 0.5) * 0.08 + micro * 0.03,
        0.2,
        0.82
      )
      const roughVal = clamp(
        0.9 + dustWear * 0.04 + (brushed - 0.5) * 0.04 + micro * 0.02,
        0.82,
        0.97
      )
      return { r, g, b, bumpVal, roughVal }
    }

    // surfaceKey === 'leather' (boots, gloves, backpack straps & body)
    const grainPeriod = Math.max(10, Math.round(sizeHint * 0.16))
    const pebbleA = samplePeriodicNoise(u, v, grainPeriod, grainPeriod, 5101)
    const pebbleB = samplePeriodicNoise(
      u + 0.21,
      v + 0.37,
      Math.round(grainPeriod * 1.5),
      Math.round(grainPeriod * 1.5),
      5147
    )
    const pebble = smoothstep(0.28, 0.78, pebbleA * 0.62 + pebbleB * 0.38)
    const crease = samplePeriodicFbm(u, v, 4, 3, 5189)
    const scuff = smoothstep(
      0.84,
      0.96,
      samplePeriodicNoise(u * 1.3 + v * 0.4, v * 0.35, 18, 18, 5231)
    )

    const lum =
      0.9 +
      (pebble - 0.5) * 0.14 +
      (crease - 0.5) * 0.1 +
      scuff * 0.09 +
      micro * 0.025
    const r = lum * (1.03 + scuff * 0.04)
    const g = lum * (0.99 + scuff * 0.02)
    const b = lum * 0.93

    const bumpVal = clamp(
      0.48 + (pebble - 0.5) * 0.36 + (crease - 0.5) * 0.14 - scuff * 0.1 + micro * 0.03,
      0.14,
      0.88
    )
    const roughVal = clamp(
      0.68 - (pebble - 0.5) * 0.12 - scuff * 0.08 + (crease - 0.5) * 0.08 + micro * 0.02,
      0.48,
      0.84
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
