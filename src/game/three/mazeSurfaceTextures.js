import * as THREE from 'three'
import { createRng } from '../../utils/rng.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  WALL_HEIGHT,
  gridToWorld,
} from '../world/worldCoords.js'
import {
  getTextureAnisotropySyncers,
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'
import {
  buildChunkedLayerNode,
  createMazeChunkLayout,
  getLayerMeshes,
  shouldChunkLayer,
} from './spatialChunking.js'

const surfacePool = new Map()

export const TEXTURE_QUALITY_PRESETS = {
  performance: {
    id: 'performance',
    surfaceAlbedoSize: 128,
    surfaceDataSize: 64,
    capSize: 64,
    atlasSize: 128,
    atlasDataSize: 64,
    propSize: 64,
    ventSize: 64,
    anisotropyCap: 1,
  },
  balanced: {
    id: 'balanced',
    surfaceAlbedoSize: 256,
    surfaceDataSize: 128,
    capSize: 128,
    atlasSize: 256,
    atlasDataSize: 128,
    propSize: 128,
    ventSize: 128,
    anisotropyCap: 4,
  },
  high: {
    id: 'high',
    surfaceAlbedoSize: 512,
    surfaceDataSize: 256,
    capSize: 256,
    atlasSize: 512,
    atlasDataSize: 256,
    propSize: 256,
    ventSize: 256,
    anisotropyCap: 8,
  },
}

export function resolveTextureQualityPreset(qualityPreset = 'high') {
  return typeof qualityPreset === 'string' && qualityPreset in TEXTURE_QUALITY_PRESETS
    ? qualityPreset
    : 'high'
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
  const uWrap = u >= 0 && u < 1 ? u : ((u % 1) + 1) % 1
  const fx = uWrap * periodX
  const fy = periodicY
    ? (v >= 0 && v < 1 ? v : ((v % 1) + 1) % 1) * periodY
    : (v <= 0 ? 0 : v >= 0.9999 ? 0.9999 : v) * periodY

  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)

  const ix0 = x0 < periodX ? x0 : x0 % periodX
  const ix1 = ix0 + 1 < periodX ? ix0 + 1 : 0
  const iy0 = periodicY
    ? (y0 < periodY ? y0 : y0 % periodY)
    : y0 < 0 ? 0 : y0 >= periodY ? periodY - 1 : y0
  const iy1 = periodicY
    ? (iy0 + 1 < periodY ? iy0 + 1 : 0)
    : (iy0 + 1 >= periodY ? periodY - 1 : iy0 + 1)

  const n00 = hash2i(ix0, iy0, seed)
  const n10 = hash2i(ix1, iy0, seed)
  const n01 = hash2i(ix0, iy1, seed)
  const n11 = hash2i(ix1, iy1, seed)

  const nx0 = n00 + (n10 - n00) * sx
  const nx1 = n01 + (n11 - n01) * sx
  return nx0 + (nx1 - nx0) * sy
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
  if (options.qualityPreset) {
    tex.userData = tex.userData || {}
    tex.userData.qualityPreset = options.qualityPreset
  }
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

function sampleGridBilinear(grid, gx, gy, dataMask, periodicY = true) {
  const x0 = Math.floor(gx) & dataMask
  const x1 = (x0 + 1) & dataMask
  const tx = gx - Math.floor(gx)
  let y0
  let y1
  let ty
  if (periodicY) {
    const iy = Math.floor(gy)
    y0 = iy & dataMask
    y1 = (y0 + 1) & dataMask
    ty = gy - iy
  } else {
    const iy = Math.floor(gy)
    y0 = iy < 0 ? 0 : iy > dataMask ? dataMask : iy
    y1 = y0 >= dataMask ? dataMask : y0 + 1
    ty = gy - iy
  }
  const r0 = y0 * (dataMask + 1)
  const r1 = y1 * (dataMask + 1)
  const a = grid[r0 + x0]
  const b = grid[r0 + x1]
  const c = grid[r1 + x0]
  const d = grid[r1 + x1]
  const nx0 = a + (b - a) * tx
  const nx1 = c + (d - c) * tx
  return nx0 + (nx1 - nx0) * ty
}

// Deterministic cellular pinhole/aggregate fleck sampler (survives mipmapping & 256px bump)
function sampleCellPinhole(u, v, gridX, gridY, seedBase, threshold, radiusScale, periodicY = true) {
  const gx = u * gridX
  const gy = v * gridY
  const flX = Math.floor(gx)
  const flY = Math.floor(gy)
  const ix = flX >= 0 && flX < gridX ? flX : ((flX % gridX) + gridX) % gridX
  const iy = periodicY
    ? (flY >= 0 && flY < gridY ? flY : ((flY % gridY) + gridY) % gridY)
    : flY < 0 ? 0 : flY >= gridY ? gridY - 1 : flY
  const fx = gx - flX
  const fy = gy - flY

  const present = hash2i(ix, iy, seedBase)
  if (present < threshold) return 0
  const cx = 0.22 + hash2i(ix, iy, seedBase + 17) * 0.56
  const cy = 0.22 + hash2i(ix, iy, seedBase + 43) * 0.56
  const rad = (0.1 + hash2i(ix, iy, seedBase + 79) * 0.16) * radiusScale
  const dx = fx - cx
  const dy = fy - cy
  const distSq = dx * dx + dy * dy
  if (distSq > rad * rad) return 0
  const dist = Math.sqrt(distSq)
  return (1 - smoothstep(rad * 0.25, rad, dist)) * (0.65 + (present - threshold) * 2.5)
}

/**
 * Generates seamless poured-concrete floor substrate albedo plus
 * matching roughness and bump heightmaps with multi-scale mineral grain,
 * silica/basalt aggregate flecks, air-void pinholes, subtle power-trowel marks,
 * and jittered slab expansion/score joints.
 */
function buildFloorTextures(presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const albedoSize = presetSpec.surfaceAlbedoSize
  const dataSize = presetSpec.surfaceDataSize
  const scale = albedoSize / 512
  const grooveScale = Math.max(0.5, scale)
  const dataMask = dataSize - 1
  const texOpts = {
    anisotropy: presetSpec.anisotropyCap,
    qualityPreset: presetSpec.id,
  }

  const heightHi = new Float32Array(albedoSize * albedoSize)
  const roughHi = new Float32Array(albedoSize * albedoSize)
  const albedoBytes = new Uint8Array(albedoSize * albedoSize * 4)

  // Pre-sample smooth low/mid-frequency FBM at dataSize x dataSize (1/4 CPU cost)
  const macroGrid = new Float32Array(dataSize * dataSize)
  const midGrid = new Float32Array(dataSize * dataSize)
  const fineGrid = new Float32Array(dataSize * dataSize)
  for (let gy = 0; gy < dataSize; gy += 1) {
    const v = gy / dataSize
    const rowOff = gy * dataSize
    for (let gx = 0; gx < dataSize; gx += 1) {
      const u = gx / dataSize
      macroGrid[rowOff + gx] = samplePeriodicFbm(u, v, 4, 4, 101)
      midGrid[rowOff + gx] = samplePeriodicFbm(u, v, 10, 3, 211)
      fineGrid[rowOff + gx] = samplePeriodicFbm(u, v, 28, 3, 307)
    }
  }

  for (let y = 0; y < albedoSize; y += 1) {
    const v = y / albedoSize
    const gyHalf = y * 0.5
    const gRow = (y >> 1) * dataSize
    const vHalf = Math.min(v % 0.5, 0.5 - (v % 0.5)) * albedoSize
    const vQuarter = Math.min(v % 0.25, 0.25 - (v % 0.25)) * albedoSize
    const qV = ((v * 2) % 1) - 0.5

    for (let x = 0; x < albedoSize; x += 1) {
      const u = x / albedoSize
      const idx = y * albedoSize + x
      const gIdx = gRow + (x >> 1)

      const macro = macroGrid[gIdx]
      const midGrain = midGrid[gIdx]
      const fineGrain = sampleGridBilinear(fineGrid, x * 0.5, gyHalf, dataMask, true)
      const gritNoise = samplePeriodicNoise(u, v, 76, 76, 367)

      // Subtle circular power-trowel concrete finishing arc across slab quarters
      const qU = ((u * 2) % 1) - 0.5
      const trowelArc =
        Math.sin(Math.hypot(qU, qV) * Math.PI * 10 + macro * 2.1) *
        0.011 *
        (1 - smoothstep(0.32, 0.48, Math.max(Math.abs(qU), Math.abs(qV))))

      // Cellular mineral aggregate flecks & casting air-void pinholes
      const airVoid = sampleCellPinhole(u, v, 56, 56, 409, 0.88, 0.95, true)
      const microVoid = sampleCellPinhole(u, v, 96, 96, 443, 0.89, 0.9, true)
      const silicaFleck = sampleCellPinhole(u, v, 84, 84, 479, 0.87, 0.85, true)
      const basaltFleck = sampleCellPinhole(u, v, 76, 76, 503, 0.87, 0.9, true)
      const microSpeck = hash2i(x, y, 521) > 0.96 ? 0.28 : 0

      const poreDepth = clamp(airVoid * 0.82 + microVoid * 0.55 + microSpeck * 0.35, 0, 1)

      let lum =
        0.888 +
        (macro - 0.5) * 0.072 +
        (midGrain - 0.5) * 0.056 +
        (fineGrain - 0.5) * 0.062 +
        (gritNoise - 0.5) * 0.044 +
        trowelArc +
        silicaFleck * 0.048 -
        basaltFleck * 0.052 -
        poreDepth * 0.16

      // Architectural slab expansion joints every 1 cell (0.5 UV) + score seams (0.25 UV)
      const jointJitter = ((fineGrain - 0.5) * 0.95 + (gritNoise - 0.5) * 0.45) * scale
      const duPrimary = Math.min(u % 0.5, 0.5 - (u % 0.5)) * albedoSize + jointJitter
      const dvPrimary = vHalf + jointJitter
      const distPrimary = Math.max(0, Math.min(duPrimary, dvPrimary))

      const duSub = Math.min(u % 0.25, 0.25 - (u % 0.25)) * albedoSize + jointJitter * 0.65
      const dvSub = vQuarter + jointJitter * 0.65
      const distSub = Math.max(0, Math.min(duSub, dvSub))

      const jointChip =
        smoothstep(0.73, 0.9, midGrain) *
        (1 - smoothstep(1.8 * grooveScale, 4.4 * grooveScale, distPrimary)) *
        0.55
      const primaryGroove = clamp(
        (1 - smoothstep(1.0 * grooveScale, 2.75 * grooveScale, distPrimary)) *
          (0.76 + midGrain * 0.24) +
          jointChip * 0.45,
        0,
        1
      )
      const primaryBevel =
        smoothstep(2.2 * grooveScale, 3.9 * grooveScale, distPrimary) *
        (1 - smoothstep(3.9 * grooveScale, 6.6 * grooveScale, distPrimary))
      const subGroove =
        (1 - smoothstep(0.55 * grooveScale, 1.75 * grooveScale, distSub)) *
        (0.34 + fineGrain * 0.16)

      const grooveMask = Math.max(primaryGroove, subGroove)
      lum *= 1 - grooveMask * 0.28
      lum += primaryBevel * 0.036

      let heightVal =
        0.65 +
        (macro - 0.5) * 0.08 +
        (midGrain - 0.5) * 0.11 +
        (fineGrain - 0.5) * 0.11 +
        (gritNoise - 0.5) * 0.07 +
        trowelArc * 1.4 +
        silicaFleck * 0.055 -
        basaltFleck * 0.045 -
        poreDepth * 0.34
      heightVal -= grooveMask * 0.36
      heightVal += primaryBevel * 0.05

      // Predominantly matte dry concrete mineral roughness baseline
      let roughVal =
        0.918 +
        (0.5 - macro) * 0.035 +
        (fineGrain - 0.5) * 0.042 +
        poreDepth * 0.06 -
        silicaFleck * 0.03
      roughVal = Math.min(0.99, roughVal + grooveMask * 0.065)

      const mineralTint =
        (midGrain - 0.5) * 0.015 + (silicaFleck - basaltFleck) * 0.011
      heightHi[idx] = clamp(heightVal, 0, 1)
      roughHi[idx] = clamp(roughVal, 0.84, 0.99)

      const p = idx * 4
      albedoBytes[p] = clamp(Math.round((lum + mineralTint) * 255), 0, 255)
      albedoBytes[p + 1] = clamp(Math.round(lum * 255), 0, 255)
      albedoBytes[p + 2] = clamp(Math.round((lum - mineralTint * 0.65) * 255), 0, 255)
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
      const hMean = (heightHi[i00] + heightHi[i10] + heightHi[i01] + heightHi[i11]) * 0.25
      const hMin = Math.min(heightHi[i00], heightHi[i10], heightHi[i01], heightHi[i11])
      const bAvg = clamp(Math.round(lerp(hMean, hMin, 0.28) * 255), 0, 255)
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
    map: createDataTexture(albedoBytes, albedoSize, albedoSize, { ...texOpts, srgb: true }),
    roughnessMap: createDataTexture(roughBytes, dataSize, dataSize, { ...texOpts, srgb: false }),
    bumpMap: createDataTexture(bumpBytes, dataSize, dataSize, { ...texOpts, srgb: false }),
  }
}

/**
 * Generates horizontally seamless precast & board-formed concrete wall
 * substrate maps (mineral sand/stone aggregate grain, realistic air-void pinholes,
 * subtle formwork striations, pour-lift batch differences, and panel joints).
 */
function buildWallTextures(presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const albedoSize = presetSpec.surfaceAlbedoSize
  const dataSize = presetSpec.surfaceDataSize
  const scale = albedoSize / 512
  const grooveScale = Math.max(0.5, scale)
  const dataMask = dataSize - 1
  const texOpts = {
    anisotropy: presetSpec.anisotropyCap,
    qualityPreset: presetSpec.id,
  }

  const heightHi = new Float32Array(albedoSize * albedoSize)
  const roughHi = new Float32Array(albedoSize * albedoSize)
  const albedoBytes = new Uint8Array(albedoSize * albedoSize * 4)

  const macroGrid = new Float32Array(dataSize * dataSize)
  const midGrid = new Float32Array(dataSize * dataSize)
  const fineGrid = new Float32Array(dataSize * dataSize)
  const dataDenom = Math.max(1, dataSize - 1)
  for (let gy = 0; gy < dataSize; gy += 1) {
    const v = gy / dataDenom
    const rowOff = gy * dataSize
    for (let gx = 0; gx < dataSize; gx += 1) {
      const u = gx / dataSize
      macroGrid[rowOff + gx] = samplePeriodicFbm(u, v, 4, 4, 509, false)
      midGrid[rowOff + gx] = samplePeriodicFbm(u, v, 10, 3, 617, false)
      fineGrid[rowOff + gx] = samplePeriodicFbm(u, v, 28, 3, 733, false)
    }
  }

  for (let y = 0; y < albedoSize; y += 1) {
    const v = y / (albedoSize - 1)
    const gyHalf = y * 0.5
    const gRow = Math.min(dataSize - 1, y >> 1) * dataSize
    const liftBand = v < 0.34 ? -0.016 : v < 0.72 ? 0.014 : -0.005
    const dvLowBase = Math.abs(v - 0.34) * albedoSize
    const dvHighBase = Math.abs(v - 0.72) * albedoSize
    const lipBase = Math.min(Math.max(0, (v - 0.34) * albedoSize), Math.max(0, (v - 0.72) * albedoSize))
    const topCapShadow = smoothstep(0.94, 1.0, v)

    for (let x = 0; x < albedoSize; x += 1) {
      const u = x / albedoSize
      const idx = y * albedoSize + x
      const gIdx = gRow + (x >> 1)

      const macro = macroGrid[gIdx]
      const midGrain = midGrid[gIdx]
      const fineGrain = sampleGridBilinear(fineGrid, x * 0.5, gyHalf, dataMask, false)
      const gritNoise = samplePeriodicNoise(u, v, 72, 72, 787, false)

      const boardGrain =
        (Math.sin(v * Math.PI * 22 + macro * 1.45) * 0.5 + 0.5 - 0.5) * 0.018

      const bugHole = sampleCellPinhole(u, v, 56, 48, 823, 0.87, 1.0, false)
      const microVoid = sampleCellPinhole(u, v, 96, 84, 863, 0.89, 0.95, false)
      const lightSilicaFleck = sampleCellPinhole(u, v, 84, 72, 911, 0.88, 0.85, false)
      const darkBasaltFleck = sampleCellPinhole(u, v, 76, 64, 947, 0.88, 0.9, false)

      const poreDepth = clamp(bugHole * 0.85 + microVoid * 0.55, 0, 1)

      let lum =
        0.89 +
        liftBand +
        (macro - 0.5) * 0.068 +
        (midGrain - 0.5) * 0.056 +
        (fineGrain - 0.5) * 0.062 +
        (gritNoise - 0.5) * 0.045 +
        boardGrain +
        lightSilicaFleck * 0.045 -
        darkBasaltFleck * 0.05 -
        poreDepth * 0.16

      const edgeBreak = ((fineGrain - 0.5) * 0.95 + (gritNoise - 0.5) * 0.45) * scale
      const duPanel = Math.max(0, Math.min(u % 0.5, 0.5 - (u % 0.5)) * albedoSize + edgeBreak)
      const vertGroove =
        (1 - smoothstep(0.85 * grooveScale, 2.45 * grooveScale, duPanel)) * (0.72 + midGrain * 0.28)
      const vertHighlight =
        smoothstep(2.1 * grooveScale, 3.6 * grooveScale, duPanel) *
        (1 - smoothstep(3.6 * grooveScale, 5.8 * grooveScale, duPanel))

      const dvNearest = Math.max(0, Math.min(dvLowBase + edgeBreak * 0.8, dvHighBase + edgeBreak * 0.8))
      const horizGroove =
        (1 - smoothstep(0.8 * grooveScale, 2.2 * grooveScale, dvNearest)) * (0.7 + midGrain * 0.3)
      const horizLip =
        smoothstep(1.7 * grooveScale, 3.1 * grooveScale, lipBase) *
        (1 - smoothstep(3.1 * grooveScale, 5.0 * grooveScale, dvNearest))

      const seamGroove = Math.max(vertGroove, horizGroove)
      lum *= 1 - seamGroove * 0.26
      lum += (vertHighlight + horizLip) * 0.036
      lum *= 1 - topCapShadow * 0.11

      const heightVal =
        0.66 +
        (macro - 0.5) * 0.08 +
        (midGrain - 0.5) * 0.11 +
        (fineGrain - 0.5) * 0.11 +
        (gritNoise - 0.5) * 0.07 +
        boardGrain * 1.4 +
        lightSilicaFleck * 0.05 -
        darkBasaltFleck * 0.04 -
        poreDepth * 0.34 -
        seamGroove * 0.36 +
        (vertHighlight + horizLip) * 0.055

      const roughVal =
        0.92 +
        (0.5 - macro) * 0.035 +
        (fineGrain - 0.5) * 0.045 +
        poreDepth * 0.06 +
        seamGroove * 0.06

      const mineralTint = (midGrain - 0.5) * 0.016 + (lightSilicaFleck - darkBasaltFleck) * 0.01
      heightHi[idx] = clamp(heightVal, 0, 1)
      roughHi[idx] = clamp(roughVal, 0.85, 0.99)

      const p = idx * 4
      albedoBytes[p] = clamp(Math.round((lum + mineralTint) * 255), 0, 255)
      albedoBytes[p + 1] = clamp(Math.round(lum * 255), 0, 255)
      albedoBytes[p + 2] = clamp(Math.round((lum - mineralTint * 0.65) * 255), 0, 255)
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
      const hMean = (heightHi[i00] + heightHi[i10] + heightHi[i01] + heightHi[i11]) * 0.25
      const hMin = Math.min(heightHi[i00], heightHi[i10], heightHi[i01], heightHi[i11])
      const bAvg = clamp(Math.round(lerp(hMean, hMin, 0.28) * 255), 0, 255)
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
    map: createDataTexture(albedoBytes, albedoSize, albedoSize, { ...texOpts, srgb: true }),
    roughnessMap: createDataTexture(roughBytes, dataSize, dataSize, { ...texOpts, srgb: false }),
    bumpMap: createDataTexture(bumpBytes, dataSize, dataSize, { ...texOpts, srgb: false }),
  }
}

/**
 * Generates compact precast weathered concrete coping cap textures.
 */
function buildCapTextures(presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const size = presetSpec.capSize
  const texOpts = {
    anisotropy: presetSpec.anisotropyCap,
    qualityPreset: presetSpec.id,
  }
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
    map: createDataTexture(albedoBytes, size, size, { ...texOpts, srgb: true }),
    bumpMap: createDataTexture(bumpBytes, size, size, { ...texOpts, srgb: false }),
  }
}

/**
 * Generates seamless cast-concrete ceiling soffit substrate albedo plus
 * matching roughness and bump maps featuring formwork shutter seams,
 * board-casting grain, concrete flash lips, recessed hanger/tie sockets,
 * silica/basalt aggregate flecks, and casting air-void pinholes.
 */
function buildCeilingTextures(presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const albedoSize = presetSpec.surfaceAlbedoSize
  const dataSize = presetSpec.surfaceDataSize
  const scale = albedoSize / 512
  const grooveScale = Math.max(0.5, scale)
  const texOpts = {
    anisotropy: presetSpec.anisotropyCap,
    qualityPreset: presetSpec.id,
  }

  const heightHi = new Float32Array(albedoSize * albedoSize)
  const roughHi = new Float32Array(albedoSize * albedoSize)
  const albedoBytes = new Uint8Array(albedoSize * albedoSize * 4)

  // Pre-sample smooth low/mid-frequency FBM at dataSize x dataSize (1/4 cost)
  const macroGrid = new Float32Array(dataSize * dataSize)
  const grainGrid = new Float32Array(dataSize * dataSize)
  for (let gy = 0; gy < dataSize; gy += 1) {
    const v = gy / dataSize
    const rowOff = gy * dataSize
    for (let gx = 0; gx < dataSize; gx += 1) {
      const u = gx / dataSize
      macroGrid[rowOff + gx] = samplePeriodicFbm(u, v, 4, 3, 1511)
      grainGrid[rowOff + gx] = samplePeriodicFbm(u, v, 18, 2, 1609)
    }
  }

  const socketMaxDist = 6.2 * grooveScale
  const socketCheckLimit = socketMaxDist + 0.3

  for (let y = 0; y < albedoSize; y += 1) {
    const v = y / albedoSize
    const gy = (y >> 1) * dataSize
    const bv = (v + 0.09) % 0.25
    const dvSocket = Math.abs(bv - 0.125) * albedoSize

    for (let x = 0; x < albedoSize; x += 1) {
      const u = x / albedoSize
      const idx = y * albedoSize + x
      const gIdx = gy + (x >> 1)

      const macro = macroGrid[gIdx]
      const fineGrain = grainGrid[gIdx]
      const gritNoise = hash2i(x, y, 1693)

      const formGrain =
        (Math.sin(u * Math.PI * 26 + macro * 1.6) * 0.5 + 0.5 - 0.5) * 0.016 +
        (Math.sin(v * Math.PI * 12 + fineGrain * 1.1) * 0.5 + 0.5 - 0.5) * 0.009

      const airVoid = sampleCellPinhole(u, v, 56, 56, 1741, 0.88, 0.95, true)
      const silicaFleck = sampleCellPinhole(u, v, 84, 84, 1787, 0.87, 0.88, true)
      const basaltFleck = gritNoise < 0.048 ? 0.55 : 0
      const microSpeck = gritNoise > 0.962 ? 0.26 : 0
      const poreDepth = clamp(airVoid * 0.86 + microSpeck * 0.35, 0, 1)

      let lum =
        0.875 +
        (macro - 0.5) * 0.072 +
        (fineGrain - 0.5) * 0.068 +
        (gritNoise - 0.5) * 0.042 +
        formGrain +
        silicaFleck * 0.044 -
        basaltFleck * 0.048 -
        poreDepth * 0.16

      const jitter = ((fineGrain - 0.5) * 0.9 + (gritNoise - 0.5) * 0.45) * scale
      const duPanel = Math.max(0, Math.min(u % 0.5, 0.5 - (u % 0.5)) * albedoSize + jitter)
      const dvPanel = Math.max(0, Math.min(v % 0.25, 0.25 - (v % 0.25)) * albedoSize + jitter)
      const distSeam = Math.min(duPanel, dvPanel)

      const seamGroove =
        (1 - smoothstep(0.85 * grooveScale, 2.35 * grooveScale, distSeam)) * (0.72 + macro * 0.28)
      const flashLip =
        smoothstep(1.9 * grooveScale, 3.3 * grooveScale, distSeam) *
        (1 - smoothstep(3.3 * grooveScale, 5.4 * grooveScale, distSeam)) *
        (0.45 + fineGrain * 0.55)

      lum *= 1 - seamGroove * 0.26
      lum += flashLip * 0.042

      let socketIndent = 0
      if (dvSocket < socketCheckLimit) {
        const duSocket = Math.min(Math.abs(u - 0.18), Math.abs(u - 0.82)) * albedoSize
        if (duSocket < socketCheckLimit) {
          const dPx = Math.hypot(duSocket, dvSocket)
          if (dPx < socketMaxDist) {
            socketIndent = 1 - smoothstep(1.8 * grooveScale, 5.8 * grooveScale, dPx)
          }
        }
      }
      lum *= 1 - socketIndent * 0.16

      let heightVal =
        0.65 +
        (macro - 0.5) * 0.09 +
        (fineGrain - 0.5) * 0.13 +
        (gritNoise - 0.5) * 0.075 +
        formGrain * 1.45 +
        silicaFleck * 0.05 -
        basaltFleck * 0.045 -
        poreDepth * 0.34 -
        seamGroove * 0.34 +
        flashLip * 0.08 -
        socketIndent * 0.28

      let roughVal =
        0.925 +
        (0.5 - macro) * 0.036 +
        (fineGrain - 0.5) * 0.042 +
        poreDepth * 0.06 +
        seamGroove * 0.05

      const mineralTint = (fineGrain - 0.5) * 0.014 + (silicaFleck - basaltFleck) * 0.01
      heightHi[idx] = clamp(heightVal, 0, 1)
      roughHi[idx] = clamp(roughVal, 0.86, 0.99)

      const p = idx * 4
      albedoBytes[p] = clamp(Math.round((lum + mineralTint) * 255), 0, 255)
      albedoBytes[p + 1] = clamp(Math.round(lum * 255), 0, 255)
      albedoBytes[p + 2] = clamp(Math.round((lum - mineralTint * 0.65) * 255), 0, 255)
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
      const hMean = (heightHi[i00] + heightHi[i10] + heightHi[i01] + heightHi[i11]) * 0.25
      const hMin = Math.min(heightHi[i00], heightHi[i10], heightHi[i01], heightHi[i11])
      const bAvg = clamp(Math.round(lerp(hMean, hMin, 0.28) * 255), 0, 255)
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
    map: createDataTexture(albedoBytes, albedoSize, albedoSize, { ...texOpts, srgb: true }),
    roughnessMap: createDataTexture(roughBytes, dataSize, dataSize, { ...texOpts, srgb: false }),
    bumpMap: createDataTexture(bumpBytes, dataSize, dataSize, { ...texOpts, srgb: false }),
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

export const CONCRETE_SHADER_QUALITY_LEVELS = {
  performance: 0.0,
  balanced: 0.5,
  high: 1.0,
}

export function resolveConcreteShaderDetail(qualityPreset = 'high') {
  return CONCRETE_SHADER_QUALITY_LEVELS[qualityPreset] ?? 1.0
}

/**
 * Updates `uConcreteDetail` uniform on all world-space concrete materials inside
 * a mesh/group or single material without triggering Three.js shader recompilation.
 */
export function syncWorldSpaceConcreteQuality(target, qualityPreset = 'high') {
  if (!target) return 0
  const detail = resolveConcreteShaderDetail(qualityPreset)
  let updated = 0

  const applyToMat = (mat) => {
    const uniforms = mat?.userData?.concreteWeatherUniforms
    if (!uniforms?.uConcreteDetail) return
    uniforms.uConcreteDetail.value = detail
    mat.userData.concreteWeatherQuality =
      qualityPreset in CONCRETE_SHADER_QUALITY_LEVELS ? qualityPreset : 'high'
    updated += 1
  }

  if (target.isMaterial) {
    applyToMat(target)
    return updated
  }

  if (typeof target.traverse === 'function') {
    target.traverse((node) => {
      if (!node?.material) return
      if (Array.isArray(node.material)) {
        for (let i = 0; i < node.material.length; i += 1) {
          applyToMat(node.material[i])
        }
      } else {
        applyToMat(node.material)
      }
    })
  }
  return updated
}

const WORLD_WEATHER_COMMON_GLSL = /* glsl */ `
uniform float uWeatherSeed;
uniform float uConcreteDetail;
varying vec3 vConcreteWorldPos;
varying vec3 vConcreteWorldNormal;

float cHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 cHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
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

vec2 cNoise2v2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 a = cHash22(i);
  vec2 b = cHash22(i + vec2(1.0, 0.0));
  vec2 c = cHash22(i + vec2(0.0, 1.0));
  vec2 d = cHash22(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
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
float concreteWorldHeightDelta = 0.0;
{
  vec3 wN = normalize(vConcreteWorldNormal);
  float isXWall = step(0.5, abs(wN.x));
  float along = mix(vConcreteWorldPos.x, vConcreteWorldPos.z, isXWall);
  float perp = mix(vConcreteWorldPos.z, vConcreteWorldPos.x, isXWall);
  float faceCellId = floor(perp * 0.25 + 0.5);
  float panelBayId = floor(along * 0.25 + 0.5);
  float faceParity = wN.x * 19.7 + wN.z * 37.3 + faceCellId * 23.17;
  vec2 seedOff = vec2(uWeatherSeed * 1.37, uWeatherSeed * 2.91);
  vec2 wUv = vec2(along + faceParity, vConcreteWorldPos.y) + seedOff;

  // 1. Poured concrete batch & lift variation + base sand grain (all presets)
  float liftTier = step(1.04, vConcreteWorldPos.y) + step(2.2, vConcreteWorldPos.y);
  float bayBatch = cHash21(vec2(panelBayId + faceCellId * 0.37, liftTier + uWeatherSeed * 0.13));
  vec2 wWarp = (cNoise2v2(wUv * 0.16 + 1.4) - 0.5) * 1.1;
  vec2 macroCool = cNoise2v2((wUv + wWarp) * vec2(0.14, 0.2));
  float macroBatch = macroCool.x;
  float batchShade = 0.905 + macroBatch * 0.125 + (bayBatch - 0.5) * 0.065;
  float coolWarm = (macroCool.y - 0.5) * 0.06 + (bayBatch - 0.5) * 0.032;
  float fineSand = (cNoise2(wUv * 9.5 + 2.3) - 0.5) * 0.075;
  diffuseColor.rgb *= vec3(batchShade + coolWarm, batchShade + coolWarm * 0.25, batchShade - coolWarm * 0.55);
  diffuseColor.rgb *= 1.0 + fineSand;
  concreteWorldHeightDelta += fineSand * 0.09;

  // 2. Balanced + High weathering layers (patches, erosion, dado paint, fissures, damp)
  if (uConcreteDetail > 0.25) {
    float cornerEdgeMask = 1.0 - smoothstep(0.08, 0.58, abs(fract(along * 0.25 + 0.5) - 0.5) * 4.0);
    float seamProx = 1.0 - smoothstep(0.02, 0.26, min(abs(vConcreteWorldPos.y - 1.04), abs(vConcreteWorldPos.y - 2.2)));
    vec2 zones = cNoise2v2(vec2(wUv.x * 0.105, 3.7));
    float regionWear = smoothstep(0.42, 0.82, zones.x);
    float paintZone = smoothstep(0.58, 0.8, zones.y);
    float altRegion = cNoise2(vec2(wUv.x * 0.11 + 19.7, vConcreteWorldPos.y * 0.16 + 6.1));

    // Old troweled concrete repair patches
    vec2 patchGrid = floor(wUv * vec2(0.48, 0.68));
    float patchChance = step(0.76, cHash21(patchGrid + vec2(4.2, 9.1)));
    vec2 pLocal = fract(wUv * vec2(0.48, 0.68)) - 0.5;
    float pWarp = (cNoise2(wUv * 2.1 + 3.4) - 0.5) * 0.16;
    float pBoxDist = max(abs(pLocal.x), abs(pLocal.y)) + pWarp;
    float patchBody = (1.0 - smoothstep(0.24, 0.29, pBoxDist)) * patchChance;
    float patchRim = smoothstep(0.22, 0.26, pBoxDist) * (1.0 - smoothstep(0.26, 0.31, pBoxDist)) * patchChance;

    float spallNoise = cNoise2((wUv + wWarp * 0.35) * vec2(0.78, 0.98) + vec2(4.1, 8.3));
    float peelNoise = cNoise2(wUv * vec2(1.15, 1.55) + 5.2);
    float microPore = 0.0;
    float stoneSpecks = fineSand * 6.5 + 0.5;
    float trowelSweep = 0.0;

    if (uConcreteDetail > 0.75) {
      vec2 gritPore = cNoise2v2(wUv * 22.0 + 11.1);
      microPore = smoothstep(0.84, 0.96, gritPore.x);
      stoneSpecks = gritPore.x;
      float coarseGrit = (gritPore.y - 0.5) * 0.04;
      diffuseColor.rgb *= 1.0 + coarseGrit - microPore * 0.085;
      concreteRoughDelta += microPore * 0.05;
      concreteWorldHeightDelta += coarseGrit * 0.05 - microPore * 0.022;

      vec2 oct2 = cNoise2v2((wUv + wWarp * 0.35) * vec2(1.62, 2.04) + vec2(11.4, 21.4));
      spallNoise = mix(spallNoise, oct2.x, 0.35);
      peelNoise = mix(peelNoise, oct2.y, 0.35);
      if (patchBody > 0.001) {
        trowelSweep = (cNoise2(vec2(wUv.x * 2.4 + wUv.y * 0.8, wUv.y * 6.5)) - 0.5) * 0.05;
      }
    }

    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.07, 1.08, 1.06) * (1.0 + trowelSweep), patchBody * 0.85);
    diffuseColor.rgb *= 1.0 - patchRim * 0.18;
    concreteRoughDelta -= patchBody * 0.07;
    concreteWorldHeightDelta += patchBody * 0.014 - patchRim * 0.016;

    // Exposed aggregate & surface erosion zones
    float erodeRegion = smoothstep(0.56, 0.8, altRegion) * (0.45 + 0.55 * max(regionWear, cornerEdgeMask * 0.75)) * (1.0 - patchBody);
    float spallThreshold = mix(0.76, 0.63, max(seamProx * 0.6, cornerEdgeMask * 0.7) * erodeRegion);
    float spallCore = smoothstep(spallThreshold, spallThreshold + 0.08, spallNoise) * erodeRegion;
    float spallEdge = smoothstep(spallThreshold - 0.03, spallThreshold, spallNoise) * (1.0 - smoothstep(spallThreshold, spallThreshold + 0.03, spallNoise)) * erodeRegion;
    float aggGrain = mix(0.82, 1.14, smoothstep(0.32, 0.78, stoneSpecks));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.84 * aggGrain, spallCore);
    diffuseColor.rgb += vec3(0.02, 0.022, 0.024) * spallEdge;
    concreteRoughDelta += spallCore * 0.06;
    concreteWorldHeightDelta -= spallCore * (0.026 - (stoneSpecks - 0.5) * 0.022) - spallEdge * 0.014;

    // Faded industrial dado & coating remnants
    float wainscotTop = 1.12 + (zones.x - 0.5) * 0.06;
    float inDado = 1.0 - smoothstep(wainscotTop - 0.02, wainscotTop + 0.02, vConcreteWorldPos.y);
    float upperBand = 1.0 - smoothstep(0.018, 0.045, abs(vConcreteWorldPos.y - 1.02));
    float paintCoverage = max(inDado * 0.85, upperBand * 0.95) * paintZone * (1.0 - patchBody * 0.85);
    float paintFilm = smoothstep(0.48, 0.56, peelNoise) * paintCoverage * (1.0 - spallCore);
    float peelEdge = smoothstep(0.44, 0.49, peelNoise) * (1.0 - smoothstep(0.49, 0.54, peelNoise)) * paintCoverage;
    float isWarmPaint = step(0.52, zones.y);
    vec3 paintTint = mix(vec3(0.95, 1.06, 1.09), vec3(1.13, 1.04, 0.89), isWarmPaint);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * paintTint, paintFilm * 0.52);
    diffuseColor.rgb += vec3(0.015, 0.016, 0.016) * peelEdge * 0.65;
    concreteRoughDelta -= paintFilm * 0.075;
    concreteWorldHeightDelta += paintFilm * 0.01 + peelEdge * 0.008;

    // Branching world-space shrinkage fissures near joints & corners
    float crackZone = smoothstep(0.46, 0.78, altRegion * 0.65 + macroBatch * 0.35) * (0.35 + 0.65 * max(seamProx, cornerEdgeMask));
    float crackRidge = 1.0 - abs(cNoise2((wUv + wWarp * 0.75) * vec2(1.45, 2.05) + vec2(9.1, 2.4)) - 0.5) * 2.0;
    float crackLine = pow(max(0.0, crackRidge), 16.0) * crackZone;
    diffuseColor.rgb *= 1.0 - crackLine * 0.36;
    concreteRoughDelta += crackLine * 0.05;
    concreteWorldHeightDelta -= crackLine * 0.042;

    // Localized moisture & vertical seepage streaks
    vec2 dampReach = cNoise2v2(vec2(wUv.x * 0.52, 5.2));
    float dampHeight = mix(0.11, 0.3, regionWear * 0.65 + cornerEdgeMask * 0.35) + (dampReach.x - 0.5) * 0.09;
    float dampMask = (1.0 - smoothstep(0.01, max(0.05, dampHeight), vConcreteWorldPos.y)) * (0.22 + 0.78 * max(regionWear, cornerEdgeMask * 0.65));
    float tideRim = smoothstep(dampHeight - 0.06, dampHeight, vConcreteWorldPos.y) * (1.0 - smoothstep(dampHeight, dampHeight + 0.05, vConcreteWorldPos.y));
    diffuseColor.rgb *= 1.0 - dampMask * 0.14;
    diffuseColor.rgb += vec3(0.018, 0.02, 0.019) * tideRim * regionWear;
    concreteRoughDelta -= dampMask * 0.07;

    if (uConcreteDetail > 0.75) {
      float leakRegion = smoothstep(0.68, 0.88, zones.x * 0.55 + (1.0 - zones.y) * 0.45);
      float sX = wUv.x * 2.2 + wWarp.x * 0.38;
      float streakCol = pow(max(0.0, cNoise2(vec2(sX, wUv.y * 0.12 + 3.7))), 4.5);
      float capReach = 0.22 + 0.88 * dampReach.y;
      float capLeak = smoothstep(3.04 - capReach, 3.03, vConcreteWorldPos.y) * step(2.05, vConcreteWorldPos.y);
      float upperJointReach = 0.18 + 0.68 * fract(dampReach.x * 2.37 + 0.19);
      float jointUpperLeak = smoothstep(2.2 - upperJointReach, 2.2, vConcreteWorldPos.y) * (1.0 - smoothstep(2.2, 2.23, vConcreteWorldPos.y));
      float lowerJointReach = 0.14 + 0.52 * fract(dampReach.y * 2.71 + 0.41);
      float jointLowerLeak = smoothstep(1.04 - lowerJointReach, 1.04, vConcreteWorldPos.y) * (1.0 - smoothstep(1.04, 1.07, vConcreteWorldPos.y));
      float originWeight = max(capLeak, max(jointUpperLeak * 0.82, jointLowerLeak * 0.72)) * (0.45 + 0.55 * cornerEdgeMask);
      float vertLeak = clamp(originWeight * leakRegion * streakCol, 0.0, 1.0);
      float rustMix = smoothstep(0.45, 0.84, altRegion);
      vec3 streakTint = mix(vec3(0.84, 0.87, 0.9), vec3(0.84, 0.68, 0.56), rustMix);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * streakTint, vertLeak * 0.42);
      concreteRoughDelta -= vertLeak * 0.06;
    }
  }
}
`
  }

  if (mode === 'floor') {
    return /* glsl */ `
#include <color_fragment>
float concreteRoughDelta = 0.0;
float concreteWorldHeightDelta = 0.0;
{
  vec2 seedOff = vec2(uWeatherSeed * 1.37, uWeatherSeed * 2.91);
  vec2 fPos = vConcreteWorldPos.xz + seedOff;

  // Infer wall-junction / corner proximity cleanly from existing baked contact-AO channel
  float wallEdgeMask = 0.0;
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    wallEdgeMask = clamp((0.94 - min(vColor.r, vColor.g)) * 4.5, 0.0, 1.0);
  #endif
  float walkwayMask = 1.0 - wallEdgeMask * 0.85;

  // 1. Poured slab batch variation + base sand grain (all presets)
  float bayIdX = floor(vConcreteWorldPos.x * 0.25 + 0.5);
  float bayIdZ = floor(vConcreteWorldPos.z * 0.25 + 0.5);
  float slabBatch = cHash21(vec2(bayIdX + uWeatherSeed * 0.17, bayIdZ + uWeatherSeed * 0.31));
  vec2 fWarp = (cNoise2v2(fPos * 0.13 + 3.1) - 0.5) * 1.15;
  vec2 macroTemp = cNoise2v2((fPos + fWarp) * 0.15);
  float slabTone = macroTemp.x;
  float shade = 0.905 + slabTone * 0.125 + (slabBatch - 0.5) * 0.055;
  float tempShift = (macroTemp.y - 0.5) * 0.05 + (slabBatch - 0.5) * 0.025;
  float fineSand = (cNoise2(fPos * 9.8 + 4.1) - 0.5) * 0.075;
  diffuseColor.rgb *= vec3(shade + tempShift, shade + tempShift * 0.2, shade - tempShift * 0.6);
  diffuseColor.rgb *= 1.0 + fineSand;
  concreteWorldHeightDelta += fineSand * 0.09;

  // 2. Balanced + High floor wear, patches, spalling, cracks & surface grime
  if (uConcreteDetail > 0.25) {
    float slabSeamDist = min(
      abs(fract(vConcreteWorldPos.x * 0.25 + 0.5) - 0.5),
      abs(fract(vConcreteWorldPos.z * 0.25 + 0.5) - 0.5)
    ) * 4.0;
    float seamProx = 1.0 - smoothstep(0.03, 0.28, slabSeamDist);

    vec2 zones = cNoise2v2(fPos * 0.088 + vec2(3.4, 7.1));
    float regionWear = smoothstep(0.36, 0.82, zones.x);
    float regionDamage = smoothstep(0.45, 0.84, zones.y);
    float regionCoating = smoothstep(0.54, 0.84, 1.0 - zones.x * 0.55 - macroTemp.y * 0.45);

    // Troweled floor repair patches
    vec2 patchGrid = floor(fPos * 0.42);
    vec2 patchPair = cHash22(patchGrid + vec2(6.1, 14.3));
    float patchChance = step(0.77, patchPair.x);
    vec2 pLocal = fract(fPos * 0.42) - 0.5;
    float pWarp = (cNoise2(fPos * 1.9 + 5.7) - 0.5) * 0.16;
    float pBoxDist = max(abs(pLocal.x), abs(pLocal.y)) + pWarp;
    float patchBody = (1.0 - smoothstep(0.22, 0.28, pBoxDist)) * patchChance;
    float patchRim = smoothstep(0.20, 0.25, pBoxDist) * (1.0 - smoothstep(0.25, 0.30, pBoxDist)) * patchChance;
    vec3 patchHue = mix(vec3(1.06, 1.07, 1.04), vec3(0.96, 1.01, 1.05), patchPair.y);
    float trowelSweep = 0.0;

    float spallNoise = cNoise2((fPos + fWarp * 0.4) * 0.86 + vec2(4.7, 9.1));
    float stoneSpecks = fineSand * 6.5 + 0.5;
    float crackRidge = 1.0 - abs(cNoise2((fPos + fWarp * 0.78) * vec2(1.42, 1.78) + vec2(9.1, 2.4)) - 0.5) * 2.0;
    vec2 wearPair = cNoise2v2(fPos * 0.24 + vec2(1.7, 13.5));

    float structCrack = 0.0;
    float dirScuff = 0.45;
    float scratchLine = 0.0;
    float stainField = wearPair.y;
    float peelNoise = wearPair.x;

    if (uConcreteDetail > 0.75) {
      vec2 gritPore = cNoise2v2(fPos * 22.0 + 9.2);
      float microPore = smoothstep(0.84, 0.96, gritPore.x);
      stoneSpecks = gritPore.x;
      float coarseGrit = (gritPore.y - 0.5) * 0.04;
      diffuseColor.rgb *= 1.0 + coarseGrit - microPore * 0.085;
      concreteRoughDelta += microPore * 0.05;
      concreteWorldHeightDelta += coarseGrit * 0.05 - microPore * 0.022;

      vec2 oct2 = cNoise2v2((fPos + fWarp * 0.4) * 1.78 + vec2(12.3, 20.4));
      spallNoise = mix(spallNoise, oct2.x, 0.35);

      float structRidge = 1.0 - abs(cNoise2((fPos + fWarp * 0.95) * vec2(0.68, 0.84) + vec2(21.4, 6.8)) - 0.5) * 2.0;
      structCrack = pow(max(0.0, structRidge), 24.0) * smoothstep(0.58, 0.84, regionDamage) * (0.4 + 0.6 * max(seamProx, wallEdgeMask));

      vec2 scuffScratch = cNoise2v2(vec2(fPos.x * 3.2 + fPos.y * 1.4, fPos.y * 0.65 - fPos.x * 0.3));
      dirScuff = scuffScratch.x;
      float scratchBand = smoothstep(0.7, 0.9, wearPair.x) * walkwayMask;
      scratchLine = pow(max(0.0, 1.0 - abs(scuffScratch.y - 0.5) * 2.0), 14.0) * scratchBand;

      vec2 stainPeel = cNoise2v2((fPos + fWarp * 1.15) * 0.34 + vec2(11.2, 5.4));
      stainField = mix(stainPeel.x, oct2.y, 0.3);
      peelNoise = stainPeel.y;
      if (patchBody > 0.001) {
        trowelSweep = (scuffScratch.x - 0.5) * 0.055;
      }
    }

    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * patchHue * (1.0 + trowelSweep), patchBody * 0.82);
    diffuseColor.rgb *= 1.0 - patchRim * 0.20;
    concreteRoughDelta -= patchBody * 0.06;
    concreteWorldHeightDelta += patchBody * 0.013 - patchRim * 0.017;

    // Chipped concrete & spalled pockets
    float erodeField = regionDamage * (0.4 + 0.6 * max(wallEdgeMask * 0.8, seamProx * 0.75)) * (1.0 - patchBody);
    float spallThresh = mix(0.77, 0.64, max(seamProx * 0.65, wallEdgeMask * 0.65) * erodeField);
    float spallCore = smoothstep(spallThresh, spallThresh + 0.075, spallNoise) * erodeField;
    float spallEdge = smoothstep(spallThresh - 0.03, spallThresh, spallNoise) * (1.0 - smoothstep(spallThresh, spallThresh + 0.03, spallNoise)) * erodeField;
    float aggGrain = mix(0.80, 1.15, smoothstep(0.30, 0.78, stoneSpecks));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.83 * aggGrain, spallCore);
    diffuseColor.rgb += vec3(0.018, 0.02, 0.022) * spallEdge;
    concreteRoughDelta += spallCore * 0.06;
    concreteWorldHeightDelta -= spallCore * (0.026 - (stoneSpecks - 0.5) * 0.024) - spallEdge * 0.014;

    // Hairline & structural fractures
    float crackZone = smoothstep(0.44, 0.76, zones.y * 0.6 + wearPair.x * 0.4) * (0.35 + 0.65 * max(seamProx, wallEdgeMask));
    float hairline = pow(max(0.0, crackRidge), 18.0) * crackZone;
    float totalCrack = clamp(hairline * 0.85 + structCrack, 0.0, 1.0);
    diffuseColor.rgb *= 1.0 - totalCrack * 0.36;
    concreteRoughDelta += totalCrack * 0.05;
    concreteWorldHeightDelta -= totalCrack * 0.044;

    // Foot-traffic abrasion & scratches
    float trafficPatch = smoothstep(0.34, 0.74, wearPair.x) * walkwayMask * (0.45 + 0.55 * regionWear);
    float wearFactor = trafficPatch * (0.4 + 0.6 * dirScuff);
    diffuseColor.rgb *= 1.0 + wearFactor * 0.045 - scratchLine * 0.14;
    concreteRoughDelta -= wearFactor * 0.055;
    concreteWorldHeightDelta -= scratchLine * 0.018;

    // Faded industrial floor paint near boundaries
    float paintCoverage = regionCoating * smoothstep(0.22, 0.78, wallEdgeMask + 0.2 * (1.0 - walkwayMask)) * (1.0 - patchBody * 0.85);
    float paintFilm = smoothstep(0.52, 0.60, peelNoise) * paintCoverage * (1.0 - spallCore);
    float peelEdge = smoothstep(0.48, 0.53, peelNoise) * (1.0 - smoothstep(0.53, 0.58, peelNoise)) * paintCoverage;
    float isOchre = step(0.52, macroTemp.y);
    vec3 paintTint = mix(vec3(0.94, 1.05, 1.08), vec3(1.14, 1.03, 0.84), isOchre);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * paintTint, paintFilm * 0.44);
    diffuseColor.rgb += vec3(0.014, 0.015, 0.015) * peelEdge * 0.6;
    concreteRoughDelta -= paintFilm * 0.065;
    concreteWorldHeightDelta += paintFilm * 0.01 + peelEdge * 0.008;

    // Edge dirt & localized mineral/oil stains
    float edgeDirt = wallEdgeMask * smoothstep(0.32, 0.78, wearPair.y);
    diffuseColor.rgb *= 1.0 - edgeDirt * 0.15;
    concreteRoughDelta += edgeDirt * 0.04;

    if (uConcreteDetail > 0.75) {
      float stainZone = smoothstep(0.66, 0.88, zones.y * 0.55 + wearPair.y * 0.45);
      float edgeBoost = 0.35 + 0.65 * wallEdgeMask;
      float stainCore = smoothstep(0.64, 0.85, stainField) * stainZone * edgeBoost;
      float stainRing = smoothstep(0.61, 0.65, stainField) * (1.0 - smoothstep(0.65, 0.70, stainField)) * stainZone * edgeBoost;
      float stainType = macroTemp.y;
      vec3 stainMult = mix(
        vec3(0.84, 0.86, 0.89),
        mix(vec3(0.88, 0.80, 0.71), vec3(0.79, 0.78, 0.74), smoothstep(0.65, 0.9, stainType)),
        smoothstep(0.3, 0.65, stainType)
      );
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * stainMult, stainCore * 0.46);
      diffuseColor.rgb += vec3(0.014, 0.015, 0.014) * stainRing;
      concreteRoughDelta -= stainCore * 0.06;
    }
  }
}
`
  }

  if (mode === 'ceiling') {
    return /* glsl */ `
#include <color_fragment>
float concreteRoughDelta = 0.0;
float concreteWorldHeightDelta = 0.0;
{
  vec3 wN = normalize(vConcreteWorldNormal);
  vec3 aN = abs(wN);
  vec2 seedOff = vec2(uWeatherSeed * 1.37, uWeatherSeed * 2.91);

  // Triplanar world-space projection so ceiling soffits, girders & columns match seamlessly
  vec2 horizPos = vConcreteWorldPos.xz + seedOff;
  vec2 vertXPos = vec2(vConcreteWorldPos.z + 17.3, vConcreteWorldPos.y) + seedOff;
  vec2 vertZPos = vec2(vConcreteWorldPos.x + 31.7, vConcreteWorldPos.y) + seedOff;
  vec2 cPos = aN.y > 0.55 ? horizPos : (aN.x > 0.55 ? vertXPos : vertZPos);

  // 1. 8m bay pour batch mottling + base sand grain (all presets)
  float bayX = floor(vConcreteWorldPos.x * 0.125 + 0.5);
  float bayZ = floor(vConcreteWorldPos.z * 0.125 + 0.5);
  float pourBatch = cHash21(vec2(bayX + uWeatherSeed * 0.19, bayZ + uWeatherSeed * 0.37));
  vec2 cWarp = (cNoise2v2(cPos * 0.14 + 2.7) - 0.5) * 1.05;
  vec2 macroTemp = cNoise2v2((cPos + cWarp) * 0.15);
  float macroPour = macroTemp.x;
  float batchShade = 0.895 + macroPour * 0.13 + (pourBatch - 0.5) * 0.06;
  float tempShift = (macroTemp.y - 0.5) * 0.05 + (pourBatch - 0.5) * 0.024;
  float fineSand = (cNoise2(cPos * 9.4 + 3.7) - 0.5) * 0.075;
  diffuseColor.rgb *= vec3(batchShade + tempShift, batchShade + tempShift * 0.22, batchShade - tempShift * 0.55);
  diffuseColor.rgb *= 1.0 + fineSand;
  concreteWorldHeightDelta += fineSand * 0.085;

  // 2. Balanced + High ceiling patches, spalling, cracks & seepage
  if (uConcreteDetail > 0.25) {
    float baySeamDist = min(
      abs(fract(vConcreteWorldPos.x * 0.25 + 0.5) - 0.5),
      abs(fract(vConcreteWorldPos.z * 0.25 + 0.5) - 0.5)
    ) * 4.0;
    float seamProx = mix(0.35, 1.0, 1.0 - smoothstep(0.03, 0.26, baySeamDist));
    vec2 zones = cNoise2v2(cPos * 0.095 + 12.4);

    // Troweled mortar repair patches
    vec2 patchGrid = floor(cPos * 0.44);
    float patchChance = step(0.78, cHash21(patchGrid + vec2(8.3, 5.1)));
    vec2 pLocal = fract(cPos * 0.44) - 0.5;
    float pWarp = (cNoise2(cPos * 2.0 + 4.9) - 0.5) * 0.16;
    float pBoxDist = max(abs(pLocal.x), abs(pLocal.y)) + pWarp;
    float patchBody = (1.0 - smoothstep(0.22, 0.28, pBoxDist)) * patchChance;
    float patchRim = smoothstep(0.20, 0.25, pBoxDist) * (1.0 - smoothstep(0.25, 0.30, pBoxDist)) * patchChance;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.07, 1.05), patchBody * 0.78);
    diffuseColor.rgb *= 1.0 - patchRim * 0.18;
    concreteRoughDelta -= patchBody * 0.055;
    concreteWorldHeightDelta += patchBody * 0.012 - patchRim * 0.015;

    float spallNoise = cNoise2((cPos + cWarp * 0.38) * 0.82 + vec2(3.7, 9.5));
    float stoneSpecks = fineSand * 6.5 + 0.5;
    float dampField = 0.0;

    if (uConcreteDetail > 0.75) {
      vec2 gritPore = cNoise2v2(cPos * 21.5 + 8.6);
      float microPore = smoothstep(0.84, 0.96, gritPore.x);
      stoneSpecks = gritPore.x;
      float coarseGrit = (gritPore.y - 0.5) * 0.038;
      diffuseColor.rgb *= 1.0 + coarseGrit - microPore * 0.085;
      concreteRoughDelta += microPore * 0.05;
      concreteWorldHeightDelta += coarseGrit * 0.045 - microPore * 0.022;

      vec2 spallDamp = cNoise2v2((cPos + cWarp * 1.1) * 0.36 + vec2(9.2, 6.1));
      dampField = spallDamp.x;
      spallNoise = mix(spallNoise, spallDamp.y, 0.32);
    }

    // Exposed aggregate & chipped pockets
    float erodeZone = smoothstep(0.55, 0.84, zones.x) * (1.0 - patchBody);
    float spallThresh = mix(0.77, 0.66, seamProx * erodeZone);
    float spallCore = smoothstep(spallThresh, spallThresh + 0.075, spallNoise) * erodeZone;
    float aggGrain = mix(0.82, 1.13, smoothstep(0.32, 0.78, stoneSpecks));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.84 * aggGrain, spallCore);
    concreteRoughDelta += spallCore * 0.06;
    concreteWorldHeightDelta -= spallCore * (0.025 - (stoneSpecks - 0.5) * 0.022);

    // Hairline shrinkage cracks
    float crackZone = smoothstep(0.50, 0.80, zones.y * 0.6 + macroPour * 0.4) * seamProx;
    float crackRidge = 1.0 - abs(cNoise2((cPos + cWarp * 0.72) * vec2(1.38, 1.82) + vec2(7.4, 3.1)) - 0.5) * 2.0;
    float crackLine = pow(max(0.0, crackRidge), 18.0) * crackZone;
    diffuseColor.rgb *= 1.0 - crackLine * 0.34;
    concreteRoughDelta += crackLine * 0.05;
    concreteWorldHeightDelta -= crackLine * 0.04;

    // Sparse localized dried overhead seepage near form seams (High)
    if (uConcreteDetail > 0.75) {
      float dampZone = smoothstep(0.73, 0.91, zones.y);
      float dampCore = smoothstep(0.65, 0.86, dampField) * dampZone * seamProx;
      float dampRing = smoothstep(0.62, 0.66, dampField) * (1.0 - smoothstep(0.66, 0.71, dampField)) * dampZone * seamProx;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.84, 0.86, 0.88), dampCore * 0.42);
      diffuseColor.rgb += vec3(0.015, 0.016, 0.015) * dampRing;
      concreteRoughDelta -= dampCore * 0.05;
    }
  }
}
`
  }

  return /* glsl */ `
#include <color_fragment>
float concreteRoughDelta = 0.0;
{
  vec2 seedOff = vec2(uWeatherSeed * 1.37, uWeatherSeed * 2.91);
  vec2 cPos = vConcreteWorldPos.xz + seedOff;
  float soot = cNoise2(cPos * 0.24 + vec2(4.2, 7.6));
  diffuseColor.rgb *= 0.91 + soot * 0.14;
  concreteRoughDelta += (0.5 - soot) * 0.05;
}
`
}

/**
 * Attaches non-repeating world-space concrete weathering (mineral batch variation,
 * restricted moisture, joint-anchored cracks/spalls, matte roughness relief, and
 * close-up normal perturbation) to a MeshStandardMaterial via onBeforeCompile
 * without adding draw calls or textures.
 */
export function applyWorldSpaceConcreteShader(
  material,
  { mode = 'wall', seed = 0, qualityPreset = 'high' } = {}
) {
  if (!material) return material
  const seedNorm = normalizeWeatherSeed(seed)
  const resolvedQuality =
    qualityPreset in CONCRETE_SHADER_QUALITY_LEVELS ? qualityPreset : 'high'

  material.userData = material.userData || {}
  material.userData.concreteWeatherMode = mode
  material.userData.concreteWeatherQuality = resolvedQuality
  material.userData.concreteWeatherUniforms = {
    uWeatherSeed: { value: seedNorm },
    uConcreteDetail: { value: resolveConcreteShaderDetail(resolvedQuality) },
  }
  material.customProgramCacheKey = () => `maze-concrete-world-v7:${mode}`

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWeatherSeed =
      material.userData.concreteWeatherUniforms.uWeatherSeed
    shader.uniforms.uConcreteDetail =
      material.userData.concreteWeatherUniforms.uConcreteDetail

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
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + concreteRoughDelta, 0.74, 0.99);`
      )

    if (mode === 'wall' || mode === 'floor' || mode === 'ceiling') {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifdef USE_BUMPMAP
  vec2 dConcreteWorld = clamp(
    vec2( dFdx( concreteWorldHeightDelta ), dFdy( concreteWorldHeightDelta ) ),
    vec2( -0.045 ),
    vec2( 0.045 )
  );
  normal = perturbNormalArb( - vViewPosition, normal, dConcreteWorld, faceDirection );
#endif`
      )
    }
  }

  material.needsUpdate = true
  return material
}

// 5x7 bitmap font glyphs for subtle industrial & utility stencil marks
const STENCIL_GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01110', '10001', '10000', '01110', '00001', '10001', '01110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  0: ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '10001', '01110'],
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
  const s = size / 512
  const sax = ax * s
  const say = ay * s
  const sbx = bx * s
  const sby = by * s
  const sRadius = s === 1 ? radius : Math.max(0.65, radius * s)
  const margin = Math.max(1, Math.round(4 * s))
  const minX = Math.max(ox + margin, Math.floor(ox + Math.min(sax, sbx) - sRadius - 2))
  const maxX = Math.min(ox + cellSizePx - margin, Math.ceil(ox + Math.max(sax, sbx) + sRadius + 2))
  const minY = Math.max(oy + margin, Math.floor(oy + Math.min(say, sby) - sRadius - 2))
  const maxY = Math.min(oy + cellSizePx - margin, Math.ceil(oy + Math.max(say, sby) + sRadius + 2))

  for (let py = minY; py <= maxY; py += 1) {
    const ly = py - oy
    const v = py / size
    for (let px = minX; px <= maxX; px += 1) {
      const lx = px - ox
      const d = distToSegment(lx, ly, sax, say, sbx, sby)
      if (d > sRadius + 1.8) continue
      const u = px / size
      const wear = samplePeriodicFbm(u * 6, v * 6, 16, 2, wearSeed)
      const stroke = 1 - smoothstep(Math.max(0.15, sRadius * 0.42), sRadius + 1.25, d)
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
  const s = size / 512
  const pad = Math.max(1, Math.round(4 * s))
  const sCellPx = cellPx * s
  const sStartY = startY * s
  let cursorX = startX * s
  for (let chIdx = 0; chIdx < text.length; chIdx += 1) {
    const glyph = STENCIL_GLYPHS[text[chIdx]]
    if (!glyph) {
      cursorX += sCellPx * 4
      continue
    }
    for (let row = 0; row < 7; row += 1) {
      const rowStr = glyph[6 - row]
      for (let col = 0; col < 5; col += 1) {
        if (rowStr[col] !== '1') continue
        const x0 = Math.max(ox + pad, Math.floor(ox + cursorX + col * sCellPx))
        const y0 = Math.max(oy + pad, Math.floor(oy + sStartY + row * sCellPx))
        const x1 = Math.min(ox + cellSizePx - pad, Math.ceil(x0 + sCellPx))
        const y1 = Math.min(ox + cellSizePx - pad, Math.ceil(y0 + sCellPx))
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
    cursorX += sCellPx * 6.0
  }
}

function paintBlotchMask(buf, size, ox, oy, cellSizePx, cx, cy, rx, ry, colorRgb, alpha, seed) {
  const s = size / 512
  const pad = Math.max(1, Math.round(4 * s))
  const scx = cx * s
  const scy = cy * s
  const srx = Math.max(1, rx * s)
  const sry = Math.max(1, ry * s)
  const minX = Math.max(ox + pad, Math.floor(ox + scx - srx * 1.45))
  const maxX = Math.min(ox + cellSizePx - pad, Math.ceil(ox + scx + srx * 1.45))
  const minY = Math.max(oy + pad, Math.floor(oy + scy - sry * 1.45))
  const maxY = Math.min(oy + cellSizePx - pad, Math.ceil(oy + scy + sry * 1.45))

  for (let py = minY; py <= maxY; py += 1) {
    const ly = py - oy
    for (let px = minX; px <= maxX; px += 1) {
      const lx = px - ox
      const u = (lx - scx) / srx
      const v = (ly - scy) / sry
      const metric = Math.hypot(u, v)
      if (metric > 1.38) continue
      const n = samplePeriodicFbm(px / size, py / size, 12, 3, seed)
      const d = metric + (n - 0.5) * 0.62
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
export const WALL_DETAIL_ATLAS_UVS = buildGridAtlasUvs(4, 512, 5)
export const FLOOR_DETAIL_ATLAS_UVS = buildGridAtlasUvs(4, 512, 5)

/**
 * Generates a preset-scaled (512/256/128) 3x3 RGBA atlas of 9 distinct restrained
 * abandoned-facility graffiti and markings (zero mip bleeding across cell borders).
 */
function buildGraffitiAtlasTexture(presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const size = presetSpec.atlasSize
  const cellPx = Math.floor(size / 3)
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

  // Erode all graffiti strokes along concrete grain & micro-flakes so paint looks old and worn
  for (let py = 0; py < size; py += 1) {
    const v = py / size
    for (let px = 0; px < size; px += 1) {
      const p = (py * size + px) * 4
      const a = buf[p + 3]
      if (a === 0) continue
      const u = px / size
      const chipNoise = samplePeriodicFbm(u * 14, v * 14, 16, 2, 2687)
      const poreFlake = hash2i(px, py, 2719)
      if (chipNoise < 0.34 || poreFlake > 0.92) {
        const keep = clamp((chipNoise - 0.16) * 2.2, 0.08, 0.85) * (poreFlake > 0.92 ? 0.25 : 1)
        buf[p + 3] = Math.round(a * keep)
      }
    }
  }

  return createDataTexture(buf, size, size, {
    srgb: true,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    anisotropy: presetSpec.anisotropyCap,
    qualityPreset: presetSpec.id,
  })
}

/**
 * Generates a dedicated preset-scaled 4x4 (16-variant) RGBA wall detail atlas paired with
 * matching bump and roughness atlases: branching cracks, settlement
 * fractures, corner spalls with aggregate, troweled mortar repairs, peeling industrial
 * paint remnants, equipment abrasion, anchor bolt scars, rust bleed, efflorescence,
 * faded safety stripes, utility stencil IDs, honeycomb voids, crazing, scorch, and
 * sparse dried coping mineral traces.
 */
function buildWallDetailAtlasTextures(presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const size = presetSpec.atlasSize
  const dataSize = presetSpec.atlasDataSize
  const cellPx = Math.floor(size / 4)
  const s = size / 512
  const pad = Math.max(1, Math.round(5 * s))

  const colorBuf = new Uint8Array(size * size * 4)
  const heightBuf = new Float32Array(size * size)
  const roughBuf = new Float32Array(size * size)
  heightBuf.fill(0.5)
  roughBuf.fill(0.94)

  const cellOrigin = (idx) => {
    const col = idx % 4
    const rowTop = Math.floor(idx / 4)
    const rowBot = 3 - rowTop
    return { ox: col * cellPx, oy: rowBot * cellPx }
  }

  const blendPixel = (px, py, rgb, alpha, heightDelta, roughTarget) => {
    if (alpha <= 0.01) return
    const idx = py * size + px
    const p = idx * 4
    const prevA = colorBuf[p + 3] / 255
    const outA = clamp(prevA + alpha * (1 - prevA), 0, 1)
    if (outA > 0) {
      const w = alpha / outA
      colorBuf[p] = clamp(Math.round(lerp(colorBuf[p], rgb[0], w)), 0, 255)
      colorBuf[p + 1] = clamp(Math.round(lerp(colorBuf[p + 1], rgb[1], w)), 0, 255)
      colorBuf[p + 2] = clamp(Math.round(lerp(colorBuf[p + 2], rgb[2], w)), 0, 255)
      colorBuf[p + 3] = Math.round(outA * 255)
    }
    heightBuf[idx] = clamp(heightBuf[idx] + heightDelta * alpha, 0, 1)
    roughBuf[idx] = clamp(lerp(roughBuf[idx], roughTarget, clamp(alpha * 1.15, 0, 1)), 0.74, 0.99)
  }

  const stoneRgb = [0, 0, 0]

  const paintStroke = (
    ox,
    oy,
    ax,
    ay,
    bx,
    by,
    radius,
    rgb,
    alpha,
    heightDelta,
    roughTarget,
    seedBase
  ) => {
    const sax = ax * s
    const say = ay * s
    const sbx = bx * s
    const sby = by * s
    const sRadius = s === 1 ? radius : Math.max(0.65, radius * s)
    const minX = Math.max(ox + pad, Math.floor(ox + Math.min(sax, sbx) - sRadius - 2))
    const maxX = Math.min(ox + cellPx - pad, Math.ceil(ox + Math.max(sax, sbx) + sRadius + 2))
    const minY = Math.max(oy + pad, Math.floor(oy + Math.min(say, sby) - sRadius - 2))
    const maxY = Math.min(oy + cellPx - pad, Math.ceil(oy + Math.max(say, sby) + sRadius + 2))

    for (let py = minY; py <= maxY; py += 1) {
      const ly = py - oy
      for (let px = minX; px <= maxX; px += 1) {
        const lx = px - ox
        const d = distToSegment(lx, ly, sax, say, sbx, sby)
        if (d > sRadius + 1.5) continue
        const wear = samplePeriodicFbm((px / size) * 7, (py / size) * 7, 16, 2, seedBase)
        const stroke = 1 - smoothstep(Math.max(0.12, sRadius * 0.38), sRadius + 1.1, d)
        const eroded = stroke * alpha * smoothstep(0.18, 0.72, wear + 0.16)
        blendPixel(px, py, rgb, eroded, heightDelta, roughTarget)
      }
    }
  }

  const paintPatch = (
    ox,
    oy,
    cx,
    cy,
    rx,
    ry,
    rgb,
    alpha,
    heightDelta,
    roughTarget,
    seed,
    options = {}
  ) => {
    const scx = cx * s
    const scy = cy * s
    const srx = Math.max(0.8, rx * s)
    const sry = Math.max(0.8, ry * s)
    const minX = Math.max(ox + pad, Math.floor(ox + scx - srx * 1.4))
    const maxX = Math.min(ox + cellPx - pad, Math.ceil(ox + scx + srx * 1.4))
    const minY = Math.max(oy + pad, Math.floor(oy + scy - sry * 1.4))
    const maxY = Math.min(oy + cellPx - pad, Math.ceil(oy + scy + sry * 1.4))
    const rimRgb = options.rimRgb || null
    const peelHoles = Boolean(options.peelHoles)

    for (let py = minY; py <= maxY; py += 1) {
      const ly = py - oy
      for (let px = minX; px <= maxX; px += 1) {
        const lx = px - ox
        const u = (lx - scx) / srx
        const v = (ly - scy) / sry
        const metric = options.rect ? Math.max(Math.abs(u), Math.abs(v)) : Math.hypot(u, v)
        if (metric > 1.35) continue
        const n = samplePeriodicFbm(px / size, py / size, 12, 3, seed)
        const fine = samplePeriodicNoise(px / size, py / size, 48, 48, seed + 53)
        const d = metric + (n - 0.5) * (options.rect ? 0.34 : 0.56)
        if (d > 1.04) continue

        let body = (1 - smoothstep(0.42, 1.0, d)) * alpha
        if (peelHoles) {
          const holeMask = smoothstep(0.32, 0.52, samplePeriodicFbm((px / size) * 4, (py / size) * 4, 16, 2, seed + 19))
          body *= holeMask
        }
        const fineMod = 0.86 + fine * 0.28
        stoneRgb[0] = clamp(Math.round(rgb[0] * fineMod), 0, 255)
        stoneRgb[1] = clamp(Math.round(rgb[1] * fineMod), 0, 255)
        stoneRgb[2] = clamp(Math.round(rgb[2] * fineMod), 0, 255)
        blendPixel(px, py, stoneRgb, body, heightDelta, roughTarget)

        if (rimRgb && d > 0.72 && d < 0.98) {
          const rimA = Math.sin(((d - 0.72) / 0.26) * Math.PI) * alpha * 0.18
          blendPixel(px, py, rimRgb, rimA, Math.abs(heightDelta) * 0.65, 0.96)
        }
      }
    }
  }

  const paintStenciledCode = (ox, oy, startX, startY, text, scalePx, rgb, alpha, seed) => {
    const sScalePx = scalePx * s
    const sStartY = startY * s
    let cursorX = startX * s
    for (let i = 0; i < text.length; i += 1) {
      const glyph = STENCIL_GLYPHS[text[i]]
      if (!glyph) {
        cursorX += sScalePx * 4
        continue
      }
      for (let row = 0; row < 7; row += 1) {
        const rowStr = glyph[6 - row]
        for (let col = 0; col < 5; col += 1) {
          if (rowStr[col] !== '1') continue
          const x0 = Math.max(ox + pad, Math.floor(ox + cursorX + col * sScalePx))
          const y0 = Math.max(oy + pad, Math.floor(oy + sStartY + row * sScalePx))
          const x1 = Math.min(ox + cellPx - pad, Math.ceil(x0 + sScalePx))
          const y1 = Math.min(oy + cellPx - pad, Math.ceil(y0 + sScalePx))
          for (let py = y0; py < y1; py += 1) {
            for (let px = x0; px < x1; px += 1) {
              const wear = samplePeriodicFbm((px / size) * 9, (py / size) * 9, 16, 2, seed)
              const a = alpha * smoothstep(0.28, 0.74, wear + 0.08)
              blendPixel(px, py, rgb, a, 0.06, 0.87)
            }
          }
        }
      }
      cursorX += sScalePx * 6
    }
  }

  const rng = createRng('lumen-vault-wall-details-v4')
  const darkCrack = [20, 26, 36]
  const paleLime = [92, 104, 120]
  const spallInterior = [34, 42, 56]
  const mortarLight = [84, 96, 112]
  const ochrePaint = [98, 78, 50]
  const dadoSlatePaint = [56, 76, 88]
  const oxideRust = [88, 48, 36]
  const carbonSoot = [22, 26, 34]

  const drawCrack = (idx, segs, halfW, alpha, seedBase) => {
    const { ox, oy } = cellOrigin(idx)
    for (let i = 0; i < segs.length; i += 1) {
      const [ax, ay, bx, by] = segs[i]
      paintStroke(ox, oy, ax + 1.1, ay + 1.0, bx + 1.1, by + 1.0, halfW * 0.9, paleLime, alpha * 0.14, 0.08, 0.96, seedBase + i)
      paintStroke(ox, oy, ax, ay, bx, by, halfW, darkCrack, alpha, -0.34, 0.98, seedBase + i * 3)
    }
  }

  // 0: Branching structural hairline crack
  drawCrack(
    0,
    [
      ...generateCrackChain(rng, 24, 34, 0.45, 7, 12, 0.48),
      ...generateCrackChain(rng, 58, 66, -0.4, 5, 10, 0.35),
    ],
    1.15,
    0.82,
    4100
  )

  // 1: Vertical settlement crack & chipped lip
  drawCrack(
    1,
    [
      ...generateCrackChain(rng, 60, 14, 1.54, 8, 13, 0.42),
      ...generateCrackChain(rng, 64, 58, 1.08, 4, 10, 0.2),
    ],
    1.4,
    0.85,
    4200
  )

  // 2: Chipped concrete cavity exposing multi-tone crushed aggregate
  {
    const { ox, oy } = cellOrigin(2)
    paintPatch(ox, oy, 64, 66, 30, 22, spallInterior, 0.8, -0.26, 0.98, 4301, { rimRgb: paleLime })
    for (let i = 0; i < 11; i += 1) {
      const gx = 46 + rng() * 36
      const gy = 52 + rng() * 26
      const tone = i % 2 === 0 ? [78, 88, 102] : [26, 32, 42]
      paintPatch(ox, oy, gx, gy, 3.2 + rng() * 3.0, 2.5 + rng() * 2.5, tone, 0.68, 0.14, 0.96, 4310 + i)
    }
  }

  // 3: Old troweled concrete mortar repair patch
  {
    const { ox, oy } = cellOrigin(3)
    paintPatch(ox, oy, 64, 64, 38, 28, mortarLight, 0.6, 0.14, 0.87, 4401, {
      rect: true,
      rimRgb: darkCrack,
    })
    paintStroke(ox, oy, 30, 52, 92, 58, 2.4, [96, 106, 120], 0.24, 0.05, 0.86, 4420)
    paintStroke(ox, oy, 34, 72, 96, 76, 2.2, [74, 84, 98], 0.28, -0.04, 0.88, 4425)
  }

  // 4: Chipped & peeling industrial ochre paint remnant
  {
    const { ox, oy } = cellOrigin(4)
    paintPatch(ox, oy, 64, 64, 36, 24, ochrePaint, 0.68, 0.11, 0.87, 4501, {
      rect: true,
      peelHoles: true,
      rimRgb: paleLime,
    })
  }

  // 5: Partially detached weathered slate-teal dado paint remnant
  {
    const { ox, oy } = cellOrigin(5)
    paintPatch(ox, oy, 64, 64, 40, 20, dadoSlatePaint, 0.72, 0.1, 0.88, 4601, {
      rect: true,
      peelHoles: true,
      rimRgb: paleLime,
    })
    paintStroke(ox, oy, 26, 62, 102, 68, 1.4, paleLime, 0.22, -0.08, 0.96, 4620)
  }

  // 6: Diagonal heavy equipment / cart impact scrapes
  {
    const { ox, oy } = cellOrigin(6)
    const scrapes = [
      [18, 44, 104, 64, 1.35, 0.68],
      [26, 56, 110, 82, 1.05, 0.6],
      [18, 70, 96, 92, 1.3, 0.64],
      [42, 34, 102, 52, 0.85, 0.5],
    ]
    for (let i = 0; i < scrapes.length; i += 1) {
      const [ax, ay, bx, by, r, a] = scrapes[i]
      paintStroke(ox, oy, ax, ay, bx, by, r, darkCrack, a, -0.16, 0.96, 4700 + i)
      paintStroke(ox, oy, ax, ay + 1.4, bx, by + 1.4, r * 0.75, paleLime, a * 0.18, 0.05, 0.97, 4720 + i)
    }
  }

  // 7: Electrical / pipe fixture anchor scars & drilled mounting holes
  {
    const { ox, oy } = cellOrigin(7)
    paintPatch(ox, oy, 64, 64, 24, 18, spallInterior, 0.34, 0.04, 0.95, 4801)
    const bolts = [
      [48, 74, false],
      [80, 74, true],
      [64, 50, false],
    ]
    for (let i = 0; i < bolts.length; i += 1) {
      const [bx, by, rusty] = bolts[i]
      paintPatch(ox, oy, bx, by, 7, 7, paleLime, 0.24, 0.08, 0.95, 4810 + i)
      if (rusty) {
        paintPatch(ox, oy, bx, by - 9, 6, 11, oxideRust, 0.5, 0.02, 0.93, 4820 + i)
      }
      paintPatch(ox, oy, bx, by, 3.6, 3.6, darkCrack, 0.9, -0.34, 0.98, 4830 + i)
    }
  }

  // 8: Corroded iron-oxide rust bleed below upper bracket scar
  {
    const { ox, oy } = cellOrigin(8)
    paintPatch(ox, oy, 64, 98, 9, 6, darkCrack, 0.86, -0.22, 0.97, 4901)
    paintPatch(ox, oy, 64, 90, 12, 8, oxideRust, 0.62, 0.03, 0.92, 4907)
    paintStroke(ox, oy, 62, 94, 60, 32, 2.2, oxideRust, 0.56, 0.01, 0.92, 4915)
    paintStroke(ox, oy, 68, 92, 71, 44, 1.4, oxideRust, 0.46, 0.01, 0.93, 4921)
  }

  // 9: Chalky mineral efflorescence around horizontal mortar seam
  {
    const { ox, oy } = cellOrigin(9)
    paintPatch(ox, oy, 64, 64, 36, 18, paleLime, 0.36, 0.06, 0.98, 5001)
    drawCrack(9, generateCrackChain(rng, 22, 64, 0.02, 7, 13, 0.25), 1.1, 0.68, 5020)
  }

  // 10: Faded worn diagonal industrial hazard stripe remnant
  {
    const { ox, oy } = cellOrigin(10)
    for (let i = 0; i < 4; i += 1) {
      const bx = 22 + i * 21
      paintStroke(ox, oy, bx, 40, bx + 20, 88, 3.4, i % 2 === 0 ? ochrePaint : carbonSoot, 0.58, 0.08, 0.88, 5100 + i)
    }
  }

  // 11: Eroded utility / valve identification stencil ("A-4")
  {
    const { ox, oy } = cellOrigin(11)
    paintPatch(ox, oy, 64, 64, 34, 18, [40, 48, 62], 0.28, -0.02, 0.94, 5201)
    paintStenciledCode(ox, oy, 28, 50, 'A-4', 3.8, paleLime, 0.54, 5211)
  }

  // 12: Casting honeycomb void cluster exposing rough interior stone
  {
    const { ox, oy } = cellOrigin(12)
    paintPatch(ox, oy, 64, 64, 28, 22, spallInterior, 0.5, -0.14, 0.98, 5301)
    for (let i = 0; i < 9; i += 1) {
      const vx = 42 + rng() * 44
      const vy = 46 + rng() * 36
      paintPatch(ox, oy, vx, vy, 3 + rng() * 4.5, 2.5 + rng() * 3.5, darkCrack, 0.8, -0.28, 0.98, 5310 + i)
    }
  }

  // 13: Crazed map-cracking network on aged skim coat
  {
    const segs = [
      ...generateCrackChain(rng, 30, 42, 0.32, 6, 12, 0.6),
      ...generateCrackChain(rng, 52, 86, -0.75, 5, 11, 0.55),
      ...generateCrackChain(rng, 78, 52, 2.1, 4, 11, 0.45),
    ]
    drawCrack(13, segs, 0.95, 0.72, 5400)
  }

  // 14: Dry electrical arc / carbon soot scorch near junction scar
  {
    const { ox, oy } = cellOrigin(14)
    paintPatch(ox, oy, 64, 72, 24, 30, carbonSoot, 0.6, 0.02, 0.98, 5501)
    paintPatch(ox, oy, 64, 50, 7, 7, darkCrack, 0.86, -0.26, 0.98, 5511)
  }

  // 15: Sparse dried lime / mineral seepage trace from upper coping joint
  {
    const { ox, oy } = cellOrigin(15)
    paintStroke(ox, oy, 56, 114, 58, 30, 2.6, paleLime, 0.3, 0.04, 0.96, 5601)
    paintStroke(ox, oy, 68, 114, 66, 46, 2.0, [74, 68, 62], 0.42, 0.01, 0.91, 5611)
    paintStroke(ox, oy, 48, 112, 49, 64, 1.5, paleLime, 0.24, 0.03, 0.96, 5621)
  }

  // Downsample 512px height/roughness buffers to 256px linear maps
  const bumpBytes = new Uint8Array(dataSize * dataSize * 4)
  const roughBytes = new Uint8Array(dataSize * dataSize * 4)
  for (let y = 0; y < dataSize; y += 1) {
    const sy = y * 2
    for (let x = 0; x < dataSize; x += 1) {
      const sx = x * 2
      const i00 = sy * size + sx
      const i10 = i00 + 1
      const i01 = i00 + size
      const i11 = i01 + 1
      const hAvg = clamp(
        Math.round(((heightBuf[i00] + heightBuf[i10] + heightBuf[i01] + heightBuf[i11]) * 0.25) * 255),
        0,
        255
      )
      const rAvg = clamp(
        Math.round(((roughBuf[i00] + roughBuf[i10] + roughBuf[i01] + roughBuf[i11]) * 0.25) * 255),
        0,
        255
      )
      const p = (y * dataSize + x) * 4
      bumpBytes[p] = hAvg
      bumpBytes[p + 1] = hAvg
      bumpBytes[p + 2] = hAvg
      bumpBytes[p + 3] = 255
      roughBytes[p] = rAvg
      roughBytes[p + 1] = rAvg
      roughBytes[p + 2] = rAvg
      roughBytes[p + 3] = 255
    }
  }

  return {
    map: createDataTexture(colorBuf, size, size, {
      srgb: true,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: presetSpec.anisotropyCap,
      qualityPreset: presetSpec.id,
    }),
    bumpMap: createDataTexture(bumpBytes, dataSize, dataSize, {
      srgb: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: presetSpec.anisotropyCap,
      qualityPreset: presetSpec.id,
    }),
    roughnessMap: createDataTexture(roughBytes, dataSize, dataSize, {
      srgb: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: presetSpec.anisotropyCap,
      qualityPreset: presetSpec.id,
    }),
  }
}

/**
 * Generates a dedicated preset-scaled 4x4 (16-variant) RGBA floor detail atlas paired
 * with matching bump and roughness atlases: irregular hairline cracks,
 * structural slab fractures, exposed-aggregate spalls, troweled cement repairs,
 * resurfacing skim patches, directional boot scuffs, dragged-crate gouges,
 * edge/corner dirt buildup, dried oil stains, rust rings, dried water/mineral
 * rings, worn yellow safety lines, abraded floor bay stencils, peeling floor
 * epoxy coating, impact star cracks, and pitted map-crazing.
 */
function buildFloorDetailAtlasTextures(presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const size = presetSpec.atlasSize
  const dataSize = presetSpec.atlasDataSize
  const cellPx = Math.floor(size / 4)
  const s = size / 512
  const pad = Math.max(1, Math.round(5 * s))

  const colorBuf = new Uint8Array(size * size * 4)
  const heightBuf = new Float32Array(size * size)
  const roughBuf = new Float32Array(size * size)
  heightBuf.fill(0.5)
  roughBuf.fill(0.94)

  const cellOrigin = (idx) => {
    const col = idx % 4
    const rowTop = Math.floor(idx / 4)
    const rowBot = 3 - rowTop
    return { ox: col * cellPx, oy: rowBot * cellPx }
  }

  const blendPixel = (px, py, rgb, alpha, heightDelta, roughTarget) => {
    if (alpha <= 0.01) return
    const idx = py * size + px
    const p = idx * 4
    const prevA = colorBuf[p + 3] / 255
    const outA = clamp(prevA + alpha * (1 - prevA), 0, 1)
    if (outA > 0) {
      const w = alpha / outA
      colorBuf[p] = clamp(Math.round(lerp(colorBuf[p], rgb[0], w)), 0, 255)
      colorBuf[p + 1] = clamp(Math.round(lerp(colorBuf[p + 1], rgb[1], w)), 0, 255)
      colorBuf[p + 2] = clamp(Math.round(lerp(colorBuf[p + 2], rgb[2], w)), 0, 255)
      colorBuf[p + 3] = Math.round(outA * 255)
    }
    heightBuf[idx] = clamp(heightBuf[idx] + heightDelta * alpha, 0, 1)
    roughBuf[idx] = clamp(lerp(roughBuf[idx], roughTarget, clamp(alpha * 1.15, 0, 1)), 0.76, 0.99)
  }

  const stoneRgb = [0, 0, 0]

  const paintStroke = (
    ox,
    oy,
    ax,
    ay,
    bx,
    by,
    radius,
    rgb,
    alpha,
    heightDelta,
    roughTarget,
    seedBase
  ) => {
    const sax = ax * s
    const say = ay * s
    const sbx = bx * s
    const sby = by * s
    const sRadius = s === 1 ? radius : Math.max(0.65, radius * s)
    const minX = Math.max(ox + pad, Math.floor(ox + Math.min(sax, sbx) - sRadius - 2))
    const maxX = Math.min(ox + cellPx - pad, Math.ceil(ox + Math.max(sax, sbx) + sRadius + 2))
    const minY = Math.max(oy + pad, Math.floor(oy + Math.min(say, sby) - sRadius - 2))
    const maxY = Math.min(oy + cellPx - pad, Math.ceil(oy + Math.max(say, sby) + sRadius + 2))

    for (let py = minY; py <= maxY; py += 1) {
      const ly = py - oy
      for (let px = minX; px <= maxX; px += 1) {
        const lx = px - ox
        const d = distToSegment(lx, ly, sax, say, sbx, sby)
        if (d > sRadius + 1.5) continue
        const wear = samplePeriodicFbm((px / size) * 7, (py / size) * 7, 16, 2, seedBase)
        const stroke = 1 - smoothstep(Math.max(0.12, sRadius * 0.38), sRadius + 1.1, d)
        const eroded = stroke * alpha * smoothstep(0.18, 0.72, wear + 0.16)
        blendPixel(px, py, rgb, eroded, heightDelta, roughTarget)
      }
    }
  }

  const paintPatch = (
    ox,
    oy,
    cx,
    cy,
    rx,
    ry,
    rgb,
    alpha,
    heightDelta,
    roughTarget,
    seed,
    options = {}
  ) => {
    const scx = cx * s
    const scy = cy * s
    const srx = Math.max(0.8, rx * s)
    const sry = Math.max(0.8, ry * s)
    const minX = Math.max(ox + pad, Math.floor(ox + scx - srx * 1.4))
    const maxX = Math.min(ox + cellPx - pad, Math.ceil(ox + scx + srx * 1.4))
    const minY = Math.max(oy + pad, Math.floor(oy + scy - sry * 1.4))
    const maxY = Math.min(oy + cellPx - pad, Math.ceil(oy + scy + sry * 1.4))
    const rimRgb = options.rimRgb || null
    const peelHoles = Boolean(options.peelHoles)
    const ringOnly = Boolean(options.ringOnly)

    for (let py = minY; py <= maxY; py += 1) {
      const ly = py - oy
      for (let px = minX; px <= maxX; px += 1) {
        const lx = px - ox
        const u = (lx - scx) / srx
        const v = (ly - scy) / sry
        const metric = options.rect ? Math.max(Math.abs(u), Math.abs(v)) : Math.hypot(u, v)
        if (metric > 1.35) continue
        const n = samplePeriodicFbm(px / size, py / size, 12, 3, seed)
        const fine = samplePeriodicNoise(px / size, py / size, 48, 48, seed + 53)
        const d = metric + (n - 0.5) * (options.rect ? 0.34 : 0.54)
        if (d > 1.04) continue

        let body = ringOnly
          ? smoothstep(0.56, 0.78, d) * (1 - smoothstep(0.84, 1.02, d)) * alpha
          : (1 - smoothstep(0.42, 1.0, d)) * alpha
        if (peelHoles) {
          const holeMask = smoothstep(
            0.34,
            0.54,
            samplePeriodicFbm((px / size) * 4, (py / size) * 4, 16, 2, seed + 19)
          )
          body *= holeMask
        }
        const fineMod = 0.86 + fine * 0.28
        stoneRgb[0] = clamp(Math.round(rgb[0] * fineMod), 0, 255)
        stoneRgb[1] = clamp(Math.round(rgb[1] * fineMod), 0, 255)
        stoneRgb[2] = clamp(Math.round(rgb[2] * fineMod), 0, 255)
        blendPixel(px, py, stoneRgb, body, heightDelta, roughTarget)

        if (rimRgb && d > 0.72 && d < 0.98) {
          const rimA = Math.sin(((d - 0.72) / 0.26) * Math.PI) * alpha * 0.18
          blendPixel(px, py, rimRgb, rimA, Math.abs(heightDelta) * 0.65, 0.96)
        }
      }
    }
  }

  const paintStenciledCode = (ox, oy, startX, startY, text, scalePx, rgb, alpha, seed) => {
    const sScalePx = scalePx * s
    const sStartY = startY * s
    let cursorX = startX * s
    for (let i = 0; i < text.length; i += 1) {
      const glyph = STENCIL_GLYPHS[text[i]]
      if (!glyph) {
        cursorX += sScalePx * 4
        continue
      }
      for (let row = 0; row < 7; row += 1) {
        const rowStr = glyph[6 - row]
        for (let col = 0; col < 5; col += 1) {
          if (rowStr[col] !== '1') continue
          const x0 = Math.max(ox + pad, Math.floor(ox + cursorX + col * sScalePx))
          const y0 = Math.max(oy + pad, Math.floor(oy + sStartY + row * sScalePx))
          const x1 = Math.min(ox + cellPx - pad, Math.ceil(x0 + sScalePx))
          const y1 = Math.min(oy + cellPx - pad, Math.ceil(y0 + sScalePx))
          for (let py = y0; py < y1; py += 1) {
            for (let px = x0; px < x1; px += 1) {
              const wear = samplePeriodicFbm((px / size) * 9, (py / size) * 9, 16, 2, seed)
              const a = alpha * smoothstep(0.28, 0.74, wear + 0.08)
              blendPixel(px, py, rgb, a, 0.05, 0.89)
            }
          }
        }
      }
      cursorX += sScalePx * 6
    }
  }

  const rng = createRng('lumen-vault-floor-details-v5')
  const darkCrack = [18, 24, 34]
  const paleMineral = [82, 94, 112]
  const spallInterior = [32, 40, 54]
  const mortarPatch = [76, 88, 104]
  const skimPatch = [68, 78, 94]
  const scuffDark = [24, 30, 40]
  const oilAmberDark = [48, 42, 34]
  const oilCore = [30, 30, 35]
  const oxideRust = [84, 46, 36]
  const safetyOchre = [98, 76, 46]
  const epoxySlate = [52, 74, 86]
  const edgeDirt = [30, 34, 42]

  const drawCrack = (idx, segs, halfW, alpha, seedBase) => {
    const { ox, oy } = cellOrigin(idx)
    for (let i = 0; i < segs.length; i += 1) {
      const [ax, ay, bx, by] = segs[i]
      paintStroke(ox, oy, ax + 1.1, ay + 1.0, bx + 1.1, by + 1.0, halfW * 0.9, paleMineral, alpha * 0.14, 0.08, 0.96, seedBase + i)
      paintStroke(ox, oy, ax, ay, bx, by, halfW, darkCrack, alpha, -0.35, 0.98, seedBase + i * 3)
    }
  }

  // 0: Irregular branching hairline shrinkage cracks
  drawCrack(
    0,
    [
      ...generateCrackChain(rng, 20, 42, 0.38, 7, 13, 0.48),
      ...generateCrackChain(rng, 58, 74, -0.45, 5, 11, 0.36),
    ],
    1.1,
    0.8,
    6100
  )

  // 1: Larger structural slab fracture with chipped edge pockets
  {
    const { ox, oy } = cellOrigin(1)
    const mainSegs = [
      ...generateCrackChain(rng, 16, 58, 0.14, 8, 13, 0.44),
      ...generateCrackChain(rng, 60, 62, -0.62, 4, 10, 0.25),
    ]
    drawCrack(1, mainSegs, 1.65, 0.86, 6200)
    paintPatch(ox, oy, 54, 62, 9, 6, spallInterior, 0.72, -0.24, 0.98, 6231, { rimRgb: paleMineral })
    paintPatch(ox, oy, 86, 66, 7, 5, spallInterior, 0.68, -0.22, 0.98, 6239)
  }

  // 2: Chipped floor spall cavity exposing multi-tone crushed aggregate
  {
    const { ox, oy } = cellOrigin(2)
    paintPatch(ox, oy, 64, 64, 31, 24, spallInterior, 0.8, -0.28, 0.98, 6301, { rimRgb: paleMineral })
    for (let i = 0; i < 12; i += 1) {
      const gx = 44 + rng() * 40
      const gy = 48 + rng() * 32
      const tone = i % 2 === 0 ? [74, 84, 98] : [26, 32, 42]
      paintPatch(ox, oy, gx, gy, 3.0 + rng() * 3.0, 2.5 + rng() * 2.5, tone, 0.72, 0.15, 0.96, 6310 + i)
    }
  }

  // 3: Old troweled cement repair patch (angular mortar fill + recessed perimeter seam)
  {
    const { ox, oy } = cellOrigin(3)
    paintPatch(ox, oy, 64, 64, 38, 28, mortarPatch, 0.58, 0.14, 0.88, 6401, {
      rect: true,
      rimRgb: darkCrack,
    })
    paintStroke(ox, oy, 30, 52, 94, 57, 2.2, [88, 98, 114], 0.24, 0.05, 0.87, 6420)
    paintStroke(ox, oy, 32, 74, 96, 78, 2.0, [68, 78, 92], 0.28, -0.04, 0.89, 6425)
  }

  // 4: Resurfacing skim coat patch with uneven coloration & feathered worn edges
  {
    const { ox, oy } = cellOrigin(4)
    paintPatch(ox, oy, 64, 64, 36, 26, skimPatch, 0.54, 0.09, 0.89, 6501, {
      peelHoles: true,
      rimRgb: paleMineral,
    })
    paintPatch(ox, oy, 56, 60, 18, 14, mortarPatch, 0.3, 0.04, 0.88, 6515)
  }

  // 5: Directional foot-traffic abrasion & curved boot/heel scuff cluster (aligned along X)
  {
    const { ox, oy } = cellOrigin(5)
    paintPatch(ox, oy, 64, 64, 38, 20, scuffDark, 0.34, -0.03, 0.84, 6601)
    const scuffs = [
      [18, 52, 56, 56, 98, 66],
      [24, 72, 64, 76, 108, 84],
      [34, 42, 72, 46, 102, 54],
      [20, 82, 54, 86, 86, 92],
    ]
    for (let i = 0; i < scuffs.length; i += 1) {
      const [x0, y0, x1, y1, x2, y2] = scuffs[i]
      paintStroke(ox, oy, x0, y0, x1, y1, 2.1, scuffDark, 0.56, -0.04, 0.83, 6610 + i)
      paintStroke(ox, oy, x1, y1, x2, y2, 1.7, scuffDark, 0.48, -0.03, 0.84, 6620 + i)
    }
  }

  // 6: Heavy dragged-object / crate scrape gouges (aligned along X)
  {
    const { ox, oy } = cellOrigin(6)
    const scrapes = [
      [14, 46, 108, 54, 1.45, 0.72],
      [18, 60, 114, 68, 1.15, 0.64],
      [16, 76, 104, 82, 1.4, 0.68],
      [32, 36, 98, 42, 0.9, 0.52],
    ]
    for (let i = 0; i < scrapes.length; i += 1) {
      const [ax, ay, bx, by, r, a] = scrapes[i]
      paintStroke(ox, oy, ax, ay, bx, by, r, darkCrack, a, -0.22, 0.96, 6700 + i)
      paintStroke(ox, oy, ax, ay + 1.5, bx, by + 1.5, r * 0.75, paleMineral, a * 0.18, 0.06, 0.97, 6720 + i)
    }
  }

  // 7: Localized wall-base / corner dirt & fine grit accumulation
  {
    const { ox, oy } = cellOrigin(7)
    paintPatch(ox, oy, 64, 64, 38, 28, edgeDirt, 0.5, 0.04, 0.97, 6801)
    paintPatch(ox, oy, 52, 58, 22, 15, [42, 48, 58], 0.4, 0.03, 0.96, 6813)
    for (let i = 0; i < 10; i += 1) {
      const gx = 34 + rng() * 58
      const gy = 40 + rng() * 48
      paintPatch(ox, oy, gx, gy, 2.2 + rng() * 2.5, 2.0 + rng() * 2.0, paleMineral, 0.28, 0.06, 0.96, 6825 + i)
    }
  }

  // 8: Dried industrial oil / hydraulic grease stain (dry matte-satin, never mirror-glossy)
  {
    const { ox, oy } = cellOrigin(8)
    paintPatch(ox, oy, 64, 64, 34, 25, oilAmberDark, 0.52, 0.01, 0.84, 6901)
    paintPatch(ox, oy, 60, 62, 20, 15, oilCore, 0.56, 0.01, 0.81, 6909)
    paintPatch(ox, oy, 74, 70, 14, 10, oilAmberDark, 0.4, 0.01, 0.85, 6917)
  }

  // 9: Corroded iron-oxide rust ring & removed floor-stanchion anchor pit
  {
    const { ox, oy } = cellOrigin(9)
    paintPatch(ox, oy, 64, 64, 30, 28, oxideRust, 0.58, 0.03, 0.93, 7001, {
      ringOnly: true,
      rimRgb: [64, 38, 30],
    })
    paintPatch(ox, oy, 64, 64, 9, 8, darkCrack, 0.82, -0.26, 0.98, 7011)
    paintPatch(ox, oy, 76, 54, 10, 7, oxideRust, 0.42, 0.02, 0.94, 7019)
  }

  // 10: Dried water puddle ring & chalky mineral/calcium tide deposit (dry matte)
  {
    const { ox, oy } = cellOrigin(10)
    paintPatch(ox, oy, 64, 64, 34, 26, [38, 46, 58], 0.32, -0.01, 0.89, 7101)
    paintPatch(ox, oy, 64, 64, 35, 27, paleMineral, 0.34, 0.04, 0.96, 7111, {
      ringOnly: true,
    })
  }

  // 11: Faded, chipped yellow/ochre safety line remnant (aligned along X)
  {
    const { ox, oy } = cellOrigin(11)
    paintPatch(ox, oy, 64, 64, 44, 11, safetyOchre, 0.68, 0.08, 0.88, 7201, {
      rect: true,
      peelHoles: true,
      rimRgb: paleMineral,
    })
    paintStroke(ox, oy, 26, 54, 96, 72, 1.5, scuffDark, 0.48, -0.04, 0.86, 7219)
  }

  // 12: Heavily abraded industrial floor bay stencil ("B-04") + datum line
  {
    const { ox, oy } = cellOrigin(12)
    paintPatch(ox, oy, 64, 64, 38, 22, [38, 46, 60], 0.26, -0.01, 0.93, 7301)
    paintStenciledCode(ox, oy, 18, 52, 'B-04', 3.6, paleMineral, 0.52, 7311)
    paintStroke(ox, oy, 20, 44, 106, 44, 1.6, safetyOchre, 0.44, 0.05, 0.88, 7321)
  }

  // 13: Peeling slate-teal epoxy floor coating remnant
  {
    const { ox, oy } = cellOrigin(13)
    paintPatch(ox, oy, 64, 64, 38, 26, epoxySlate, 0.68, 0.1, 0.86, 7401, {
      rect: true,
      peelHoles: true,
      rimRgb: paleMineral,
    })
  }

  // 14: Impact star fracture & crushed central tool-drop pit
  {
    const { ox, oy } = cellOrigin(14)
    const cx = 64
    const cy = 64
    const segs = []
    for (let a = 0; a < 5; a += 1) {
      const ang = (a / 5) * Math.PI * 2 + (rng() - 0.5) * 0.45
      segs.push(...generateCrackChain(rng, cx, cy, ang, 4, 11, 0.28))
    }
    drawCrack(14, segs, 1.15, 0.8, 7500)
    paintPatch(ox, oy, cx, cy, 9, 8, darkCrack, 0.84, -0.32, 0.98, 7550, { rimRgb: paleMineral })
  }

  // 15: Crazed map-cracking network & pitted mineral salt erosion
  {
    const { ox, oy } = cellOrigin(15)
    paintPatch(ox, oy, 64, 64, 34, 22, paleMineral, 0.3, 0.04, 0.97, 7601)
    const segs = [
      ...generateCrackChain(rng, 28, 44, 0.3, 6, 11, 0.6),
      ...generateCrackChain(rng, 48, 84, -0.72, 5, 10, 0.55),
      ...generateCrackChain(rng, 78, 50, 2.05, 4, 10, 0.45),
    ]
    drawCrack(15, segs, 0.95, 0.72, 7620)
  }

  // Downsample 512px height/roughness buffers to 256px linear maps
  const bumpBytes = new Uint8Array(dataSize * dataSize * 4)
  const roughBytes = new Uint8Array(dataSize * dataSize * 4)
  for (let y = 0; y < dataSize; y += 1) {
    const sy = y * 2
    for (let x = 0; x < dataSize; x += 1) {
      const sx = x * 2
      const i00 = sy * size + sx
      const i10 = i00 + 1
      const i01 = i00 + size
      const i11 = i01 + 1
      const hMean = (heightBuf[i00] + heightBuf[i10] + heightBuf[i01] + heightBuf[i11]) * 0.25
      const hMin = Math.min(heightBuf[i00], heightBuf[i10], heightBuf[i01], heightBuf[i11])
      const hAvg = clamp(Math.round(lerp(hMean, hMin, 0.25) * 255), 0, 255)
      const rAvg = clamp(
        Math.round(((roughBuf[i00] + roughBuf[i10] + roughBuf[i01] + roughBuf[i11]) * 0.25) * 255),
        0,
        255
      )
      const p = (y * dataSize + x) * 4
      bumpBytes[p] = hAvg
      bumpBytes[p + 1] = hAvg
      bumpBytes[p + 2] = hAvg
      bumpBytes[p + 3] = 255
      roughBytes[p] = rAvg
      roughBytes[p + 1] = rAvg
      roughBytes[p + 2] = rAvg
      roughBytes[p + 3] = 255
    }
  }

  return {
    map: createDataTexture(colorBuf, size, size, {
      srgb: true,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: presetSpec.anisotropyCap,
      qualityPreset: presetSpec.id,
    }),
    bumpMap: createDataTexture(bumpBytes, dataSize, dataSize, {
      srgb: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: presetSpec.anisotropyCap,
      qualityPreset: presetSpec.id,
    }),
    roughnessMap: createDataTexture(roughBytes, dataSize, dataSize, {
      srgb: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: presetSpec.anisotropyCap,
      qualityPreset: presetSpec.id,
    }),
  }
}

export function getMazeSurfaceTextureSet(options = {}) {
  const preset = resolveTextureQualityPreset(options?.qualityPreset)
  const presetSpec = TEXTURE_QUALITY_PRESETS[preset]

  const floor = getPooledSurface(`${preset}:floor:set`, () => buildFloorTextures(presetSpec))
  const wall = getPooledSurface(`${preset}:wall:set`, () => buildWallTextures(presetSpec))
  const cap = getPooledSurface(`${preset}:cap:set`, () => buildCapTextures(presetSpec))
  const ceiling = getPooledSurface(`${preset}:ceiling:set`, () => buildCeilingTextures(presetSpec))
  const graffitiAtlas = getPooledSurface(`${preset}:graffiti:atlas`, () =>
    buildGraffitiAtlasTexture(presetSpec)
  )
  const wallDetail = getPooledSurface(`${preset}:wallDetail:set`, () =>
    buildWallDetailAtlasTextures(presetSpec)
  )
  const floorDetail = getPooledSurface(`${preset}:floorDetail:set`, () =>
    buildFloorDetailAtlasTextures(presetSpec)
  )

  const graffitiMaterial = getPooledSurface(`${preset}:graffiti:mat`, () =>
    markSharedResource(
      new THREE.MeshStandardMaterial({
        map: graffitiAtlas,
        vertexColors: true,
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        roughness: 0.95,
        metalness: 0.01,
        envMapIntensity: 0.32,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    )
  )

  const wallDetailMaterial = getPooledSurface(`${preset}:wallDetail:mat`, () =>
    markSharedResource(
      new THREE.MeshStandardMaterial({
        map: wallDetail.map,
        bumpMap: wallDetail.bumpMap,
        bumpScale: 0.052,
        roughnessMap: wallDetail.roughnessMap,
        roughness: 1.0,
        metalness: 0.015,
        envMapIntensity: 0.32,
        vertexColors: true,
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    )
  )

  const floorDetailMaterial = getPooledSurface(`${preset}:floorDetail:mat`, () => {
    const mat = new THREE.MeshStandardMaterial({
      map: floorDetail.map,
      bumpMap: floorDetail.bumpMap,
      bumpScale: 0.05,
      roughnessMap: floorDetail.roughnessMap,
      roughness: 1.0,
      metalness: 0.015,
      envMapIntensity: 0.3,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    mat.userData.atlasGridSize = 4
    mat.userData.qualityPreset = preset
    return markSharedResource(mat)
  })

  return {
    qualityPreset: preset,
    floor,
    wall,
    cap,
    ceiling,
    graffitiAtlas,
    graffitiMaterial,
    wallDetailAtlas: wallDetail.map,
    wallDetailBumpAtlas: wallDetail.bumpMap,
    wallDetailRoughnessAtlas: wallDetail.roughnessMap,
    wallDetailMaterial,
    floorDetailAtlas: floorDetail.map,
    floorDetailBumpAtlas: floorDetail.bumpMap,
    floorDetailRoughnessAtlas: floorDetail.roughnessMap,
    floorDetailMaterial,
  }
}

function syncMaterialSurfaceBundle(mat, bundle, includeRoughness = true) {
  if (!mat || !bundle) return
  let changed = false
  if (mat.map !== bundle.map) {
    mat.map = bundle.map
    changed = true
  }
  if (includeRoughness && bundle.roughnessMap && mat.roughnessMap !== bundle.roughnessMap) {
    mat.roughnessMap = bundle.roughnessMap
    changed = true
  }
  if (bundle.bumpMap && mat.bumpMap !== bundle.bumpMap) {
    mat.bumpMap = bundle.bumpMap
    changed = true
  }
  if (changed) {
    mat.needsUpdate = true
  }
}

/**
 * Rebinds concrete substrate maps and decal atlas materials on an existing maze group
 * when `qualityPreset` changes live, without rebuilding geometry or disposing shared pools.
 */
export function syncMazeGroupSurfaceTextures(mazeGroup, qualityPreset = 'high') {
  if (!mazeGroup) return null
  const preset = resolveTextureQualityPreset(qualityPreset)
  const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset: preset })
  const ud = mazeGroup.userData || {}

  syncMaterialSurfaceBundle(ud.floorMat, surfaceSet.floor, true)
  syncMaterialSurfaceBundle(ud.wallMat, surfaceSet.wall, true)
  syncMaterialSurfaceBundle(ud.capMat, surfaceSet.cap, false)
  syncMaterialSurfaceBundle(ud.ceilingMat, surfaceSet.ceiling, true)
  syncMaterialSurfaceBundle(ud.beamMat, surfaceSet.ceiling, true)
  syncMaterialSurfaceBundle(ud.pillarMat, surfaceSet.ceiling, true)

  const floorImp = ud.floorImperfectionsMesh || mazeGroup.getObjectByName?.('maze-floor-imperfections')
  for (const mesh of getLayerMeshes(floorImp)) {
    if (mesh.material !== surfaceSet.floorDetailMaterial) {
      mesh.material = surfaceSet.floorDetailMaterial
    }
  }

  const wallImp = ud.wallImperfectionsMesh || mazeGroup.getObjectByName?.('maze-walls-imperfections')
  for (const mesh of getLayerMeshes(wallImp)) {
    if (mesh.material !== surfaceSet.wallDetailMaterial) {
      mesh.material = surfaceSet.wallDetailMaterial
    }
  }

  const ceilingImp =
    ud.ceilingImperfectionsMesh || mazeGroup.getObjectByName?.('maze-ceiling-imperfections')
  for (const mesh of getLayerMeshes(ceilingImp)) {
    if (mesh.material !== surfaceSet.wallDetailMaterial) {
      mesh.material = surfaceSet.wallDetailMaterial
    }
  }

  const graffitiMesh = ud.graffitiMesh || mazeGroup.getObjectByName?.('maze-walls-graffiti')
  for (const mesh of getLayerMeshes(graffitiMesh)) {
    if (mesh.material !== surfaceSet.graffitiMaterial) {
      mesh.material = surfaceSet.graffitiMaterial
    }
  }

  return surfaceSet
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
    if (!tex || !tex.isTexture) return
    const spec =
      TEXTURE_QUALITY_PRESETS[tex.userData?.qualityPreset] || TEXTURE_QUALITY_PRESETS.high
    const targetAniso = spec.id === 'high' ? maxAniso : Math.min(maxAniso, spec.anisotropyCap)
    if (tex.anisotropy !== targetAniso) {
      tex.anisotropy = targetAniso
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

  for (const syncFn of getTextureAnisotropySyncers()) {
    syncFn(updateTex)
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
export function applyFloorGeometrySurfaceDetails(
  floorGeo,
  maze,
  floorWidth,
  floorDepth,
  offsetX = 0,
  offsetZ = 0
) {
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
    const vx = posAttr.getX(i) + offsetX
    const vy = posAttr.getY(i)
    const vz = posAttr.getZ(i) + offsetZ
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
      const geoSeed = Math.round(normalizeWeatherSeed(maze?.seed ?? maze?.id ?? 0) * 97) + 2309
      const macroVar =
        (samplePeriodicFbm(fx / 11.5, fz / 11.5, 4, 2, geoSeed, false) - 0.5) * 0.13
      shade = clamp(1.0 - aoDrop + macroVar, 0.74, 1.07)
      warmShift = (hash2i(Math.round(fx * 2), Math.round(fz * 2), geoSeed + 194) - 0.5) * 0.03
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

function buildQuadBufferGeometry(count, positions, normals, uvs, colors) {
  const indices = createIndexBufferArray(count * 4, count * 6)
  for (let i = 0; i < count; i += 1) {
    const vBase = i * 4
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
  return geometry
}

function buildChunkedDecalLayerNode({
  maze,
  layerName,
  count,
  positions,
  normals,
  uvs,
  colors,
  variantIndices,
  quadChunkIndices,
  material,
}) {
  const chunkLayout = createMazeChunkLayout(maze)
  const chunkCounts = new Uint32Array(chunkLayout.totalChunks)
  let occupiedChunks = 0
  if (chunkLayout.isChunked && quadChunkIndices) {
    for (let i = 0; i < count; i += 1) {
      const cIdx = quadChunkIndices[i]
      if (chunkCounts[cIdx] === 0) {
        occupiedChunks += 1
      }
      chunkCounts[cIdx] += 1
    }
  }

  const useChunks = shouldChunkLayer({
    layout: chunkLayout,
    triangleCount: count * 2,
    occupiedChunks,
    forceWhenMultiChunk: true,
  })

  const chunkEntries = []
  if (!useChunks) {
    chunkEntries.push({
      chunkIndex: 0,
      geometry: buildQuadBufferGeometry(count, positions, normals, uvs, colors),
    })
  } else {
    const subBuffers = new Array(chunkLayout.totalChunks)
    const cursors = new Uint32Array(chunkLayout.totalChunks)
    for (let cIdx = 0; cIdx < chunkLayout.totalChunks; cIdx += 1) {
      const n = chunkCounts[cIdx]
      if (n === 0) continue
      subBuffers[cIdx] = {
        pos: new Float32Array(n * 4 * 3),
        norm: new Float32Array(n * 4 * 3),
        uv: new Float32Array(n * 4 * 2),
        col: new Float32Array(n * 4 * 4),
        variants: new Uint8Array(n),
      }
    }

    for (let i = 0; i < count; i += 1) {
      const cIdx = quadChunkIndices[i]
      const buf = subBuffers[cIdx]
      const q = cursors[cIdx]
      cursors[cIdx] = q + 1
      buf.pos.set(positions.subarray(i * 12, i * 12 + 12), q * 12)
      buf.norm.set(normals.subarray(i * 12, i * 12 + 12), q * 12)
      buf.uv.set(uvs.subarray(i * 8, i * 8 + 8), q * 8)
      buf.col.set(colors.subarray(i * 16, i * 16 + 16), q * 16)
      buf.variants[q] = variantIndices[i]
    }

    for (let cIdx = 0; cIdx < chunkLayout.totalChunks; cIdx += 1) {
      const n = chunkCounts[cIdx]
      if (n === 0) continue
      const buf = subBuffers[cIdx]
      chunkEntries.push({
        chunkIndex: cIdx,
        geometry: buildQuadBufferGeometry(n, buf.pos, buf.norm, buf.uv, buf.col),
        variants: buf.variants,
        decalCount: n,
      })
    }
  }

  const node = buildChunkedLayerNode({
    layerName,
    chunkEntries,
    material,
    castShadow: false,
    receiveShadow: true,
    layout: useChunks ? chunkLayout : { ...chunkLayout, isChunked: false },
  })
  if (node) {
    node.userData = {
      ...(node.userData || {}),
      decalCount: count,
      variantIndices,
    }
    if (useChunks) {
      const meshes = getLayerMeshes(node)
      for (let i = 0; i < meshes.length; i += 1) {
        meshes[i].userData = {
          ...(meshes[i].userData || {}),
          decalCount: chunkEntries[i].decalCount,
          variantIndices: chunkEntries[i].variants,
        }
      }
    }
  }
  return node
}

/**
 * Selects well-spaced exposed interior corridor wall faces and merges selective
 * weathered graffiti decals (using all 9 variants in shuffled non-repeating
 * cycles + varied RGBA opacity/fade) into a static or chunked decal layer.
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

  const targetCount = clamp(Math.round(candidates.length * 0.032), 2, 12)
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

  const chunkLayout = createMazeChunkLayout(maze)
  const count = chosen.length
  const positions = new Float32Array(count * 4 * 3)
  const normals = new Float32Array(count * 4 * 3)
  const uvs = new Float32Array(count * 4 * 2)
  const colors = new Float32Array(count * 4 * 4)
  const variantIndices = new Uint8Array(count)
  const quadChunkIndices = new Uint16Array(count)

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
    quadChunkIndices[i] = chunkLayout.getChunkIndex(world.x, world.z)

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

    const tintTone = 0.82 + rng() * 0.16
    const opacity = 0.54 + rng() * 0.28
    writeQuadRgba(colors, vBase * 4, tintTone, tintTone * 0.98, tintTone * 0.95, opacity)
  }

  return buildChunkedDecalLayerNode({
    maze,
    layerName: 'maze-walls-graffiti',
    count,
    positions,
    normals,
    uvs,
    colors,
    variantIndices,
    quadChunkIndices,
    material: graffitiMaterial,
  })
}

// Wall detail pools (16 archetypes grouped by corridor zone character)
const WALL_ZONE_POOLS = {
  cleanAged: [0, 3, 2, 12],
  structural: [0, 1, 2, 12, 13],
  industrialWear: [4, 5, 6, 10, 11],
  fixtureRepair: [3, 7, 8, 11, 14],
  mineralExposure: [1, 2, 8, 9, 15],
}
const WALL_CORNER_POOL = [0, 1, 2, 6, 12, 13]
// Variants safe to flip vertically (never invert gravity rust/drips, readable text, or chevrons)
const WALL_VERT_FLIP_SAFE = new Set([0, 2, 3, 4, 5, 6, 7, 9, 12, 13, 14])
// Variants safe to flip horizontally (never mirror stenciled utility IDs)
const WALL_HORIZ_FLIP_SAFE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15])

// Dedicated 4x4 floor detail pools (16 floor-specific archetypes grouped by zone character)
const FLOOR_ZONE_POOLS = {
  cleanDry: [0, 3, 4, 5, 15],
  heavyTraffic: [0, 3, 5, 6, 11, 12, 13],
  structuralWear: [0, 1, 2, 3, 4, 14, 15],
  utilitySpill: [2, 5, 6, 7, 8, 9, 10, 11],
}
const FLOOR_EDGE_POOL = [1, 2, 7, 8, 9, 10, 13, 15]
const FLOOR_CORNER_POOL = [1, 2, 3, 5, 6, 7, 9, 14]
const FLOOR_ENTRANCE_POOL = [3, 4, 5, 6, 11, 12, 13]
// Stencil bay text (#12) stays unmirrored for legibility
const FLOOR_HORIZ_FLIP_SAFE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15])
const FLOOR_VERT_FLIP_SAFE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15])
const FLOOR_DIRECTIONAL_VARIANTS = new Set([5, 6, 11, 12])

function pickAntiRepeatVariant(pool, rng, forbiddenSet, usageCounts = null) {
  const allowed = []
  for (let i = 0; i < pool.length; i += 1) {
    if (!forbiddenSet.has(pool[i])) {
      allowed.push(pool[i])
    }
  }
  const source = allowed.length > 0 ? allowed : pool
  if (!usageCounts || source.length <= 1) {
    return source[Math.floor(rng() * source.length)]
  }
  let minCount = Infinity
  for (let i = 0; i < source.length; i += 1) {
    const c = usageCounts.get(source[i]) || 0
    if (c < minCount) minCount = c
  }
  const leastUsed = []
  for (let i = 0; i < source.length; i += 1) {
    if ((usageCounts.get(source[i]) || 0) <= minCount + 1) {
      leastUsed.push(source[i])
    }
  }
  const pickFrom = leastUsed.length > 0 ? leastUsed : source
  return pickFrom[Math.floor(rng() * pickFrom.length)]
}

function sampleRegionalWear(row, col, rows, cols, seedNum) {
  const u = (col + 0.5) / Math.max(4, cols)
  const v = (row + 0.5) / Math.max(4, rows)
  return samplePeriodicFbm(u * 2.4, v * 2.4, 4, 2, seedNum, false)
}

function sampleFloorZoneArchetype(row, col, rows, cols, seedA, seedB) {
  const u = (col + 0.5) / Math.max(4, cols)
  const v = (row + 0.5) / Math.max(4, rows)
  const a = samplePeriodicFbm(u * 1.95, v * 1.95, 4, 2, seedA, false)
  const b = samplePeriodicFbm(u * 2.25 + 0.31, v * 2.25 + 0.17, 4, 2, seedB, false)
  if (a < 0.43 && b < 0.52) return 'cleanDry'
  if (a >= 0.43 && b < 0.55) return 'heavyTraffic'
  if (a < 0.54 && b >= 0.52) return 'structuralWear'
  return 'utilitySpill'
}

function sampleWallZoneArchetype(row, col, rows, cols, seedA, seedB) {
  const u = (col + 0.5) / Math.max(4, cols)
  const v = (row + 0.5) / Math.max(4, rows)
  const a = samplePeriodicFbm(u * 1.9, v * 1.9, 4, 2, seedA, false)
  const b = samplePeriodicFbm(u * 2.2 + 0.37, v * 2.2 + 0.19, 4, 2, seedB, false)
  if (a < 0.42 && b < 0.54) return 'cleanAged'
  if (a >= 0.58 && b < 0.48) return 'structural'
  if (a < 0.5 && b >= 0.54) return 'industrialWear'
  if (a >= 0.5 && b >= 0.52 && b < 0.72) return 'fixtureRepair'
  return 'mineralExposure'
}

/**
 * Places 16 distinct architectural concrete details (hairline/settlement cracks,
 * aggregate spalls, mortar repair patches, peeling industrial paint, equipment scrapes,
 * mounting-bolt scars, rust bleed, efflorescence, hazard remnants, utility IDs,
 * honeycomb voids, crazing, scorch, and sparse coping traces) across exposed walls
 * with coherent regional personalities and strict anti-neighbor non-repetition.
 */
export function buildWallImperfectionMesh(
  maze,
  wallDetailMaterial,
  bodyHeight = WALL_HEIGHT - 0.14
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !wallDetailMaterial) {
    return null
  }

  const rows = grid.length
  const cols = grid[0]?.length || 0
  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-wall-detail-v4`)
  const seedNum = Math.round(normalizeWeatherSeed(maze.seed ?? maze.id ?? 'maze') * 131)
  const zoneSeedA = seedNum + 401
  const zoneSeedB = seedNum + 853
  const placements = []
  const cellVariantHistory = new Map()

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] !== CELL_TYPES.WALL) continue

      let exposedCount = 0
      for (let f = 0; f < FACE_DIRS.length; f += 1) {
        const nr = r + FACE_DIRS[f].dr
        const nc = c + FACE_DIRS[f].dc
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === CELL_TYPES.PATH) {
          exposedCount += 1
        }
      }
      if (exposedCount === 0) continue

      const isCornerOrEnd = exposedCount >= 2
      const zoneType = sampleWallZoneArchetype(r, c, rows, cols, zoneSeedA, zoneSeedB)
      const regionalWear = sampleRegionalWear(r, c, rows, cols, zoneSeedA + 77)
      const baseChance =
        zoneType === 'cleanAged'
          ? isCornerOrEnd
            ? 0.16
            : 0.08
          : isCornerOrEnd
            ? 0.28
            : 0.16
      const faceChance = clamp(baseChance + (regionalWear - 0.45) * 0.22, 0.06, 0.4)

      for (let f = 0; f < FACE_DIRS.length; f += 1) {
        const dir = FACE_DIRS[f]
        const nr = r + dir.dr
        const nc = c + dir.dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        if (grid[nr][nc] !== CELL_TYPES.PATH) continue

        if (rng() > faceChance) continue

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

        const useCornerPool = isCornerOrEnd && rng() < 0.48
        const pool = useCornerPool ? WALL_CORNER_POOL : WALL_ZONE_POOLS[zoneType]
        const variant = pickAntiRepeatVariant(pool, rng, forbidden)

        // Proportion scale cleanly by detail category
        let scaleW = 0.46 + rng() * 0.58
        let scaleH = 0.42 + rng() * 0.54
        if (variant === 3 || variant === 4 || variant === 5 || variant === 10) {
          scaleW = 0.64 + rng() * 0.68
          scaleH = 0.4 + rng() * 0.42
        } else if (variant === 7 || variant === 11 || variant === 14) {
          scaleW = 0.34 + rng() * 0.34
          scaleH = 0.32 + rng() * 0.3
        } else if (variant === 1 || variant === 8 || variant === 15) {
          scaleW = 0.34 + rng() * 0.34
          scaleH = 0.62 + rng() * 0.55
        }

        const halfW = Math.min(CELL_SIZE * 0.36, scaleW)
        const halfH = Math.min(bodyHeight * 0.36, scaleH)
        const maxShift = Math.max(0.1, CELL_SIZE * 0.44 - halfW)

        let lateralShift = (rng() * 2 - 1) * maxShift
        if ((variant === 2 || variant === 12 || variant === 1) && (isCornerOrEnd || rng() < 0.52)) {
          const edgeSign = rng() < 0.5 ? -1 : 1
          lateralShift = edgeSign * lerp(maxShift * 0.42, maxShift, rng())
        }

        const minY = halfH + 0.14
        const maxY = Math.max(minY + 0.05, bodyHeight - halfH - 0.14)
        let centerY = lerp(minY, maxY, rng())

        if (variant === 15) {
          // Coping-seam mineral seepage trace anchored high near cap lip
          centerY = lerp(Math.max(minY, bodyHeight - halfH - 0.42), maxY, rng())
        } else if (variant === 9) {
          // Efflorescence anchored near lower junction or formwork joint
          centerY = rng() < 0.65 ? lerp(minY, Math.min(maxY, 0.72), rng()) : clamp(2.15 + (rng() - 0.5) * 0.25, minY, maxY)
        } else if (variant === 7 || variant === 8 || variant === 11 || variant === 14) {
          // Conduit / mounting scars & utility markings sit at realistic chest-to-head height
          centerY = clamp(1.28 + rng() * 0.78, minY, maxY)
        } else if (variant === 4 || variant === 5 || variant === 6 || variant === 10) {
          // Dado paint remnants, hazard trim & equipment scrapes sit in lower-mid belt
          centerY = clamp(0.55 + rng() * 0.76, minY, maxY)
        } else if (variant === 0 || variant === 1 || variant === 2 || variant === 13) {
          // Cracks & spalls anchor at base junction or horizontal formwork seams
          const pick = rng()
          if (pick < 0.38) centerY = lerp(minY, Math.min(maxY, minY + 0.42), rng())
          else if (pick < 0.74) centerY = clamp(1.04 + (rng() - 0.5) * 0.26, minY, maxY)
          else centerY = clamp(2.2 + (rng() - 0.5) * 0.26, minY, maxY)
        }

        const tilt =
          variant === 8 || variant === 15 || variant === 11 || variant === 10
            ? (rng() - 0.5) * 0.08
            : variant === 3 || variant === 4 || variant === 5 || variant === 9
              ? (rng() - 0.5) * 0.24
              : (rng() - 0.5) * Math.PI * 0.65

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
          flipU: WALL_HORIZ_FLIP_SAFE.has(variant) && rng() < 0.5,
          flipV: WALL_VERT_FLIP_SAFE.has(variant) && rng() < 0.5,
          tint: 0.8 + rng() * 0.16,
          warmth: (rng() - 0.5) * 0.05,
          alpha: 0.3 + rng() * 0.32,
        })

        const key = `${r},${c}`
        const existing = cellVariantHistory.get(key)
        if (existing) {
          existing.push(variant)
        } else {
          cellVariantHistory.set(key, [variant])
        }
      }
    }
  }

  if (placements.length === 0) {
    return null
  }

  const chunkLayout = createMazeChunkLayout(maze)
  const count = placements.length
  const positions = new Float32Array(count * 4 * 3)
  const normals = new Float32Array(count * 4 * 3)
  const uvs = new Float32Array(count * 4 * 2)
  const colors = new Float32Array(count * 4 * 4)
  const variantIndices = new Uint8Array(count)
  const quadChunkIndices = new Uint16Array(count)

  // Sits cleanly outside wall body (+0.006m) and strictly beneath graffiti (+0.014m)
  const wallOffset = CELL_SIZE / 2 + 0.006

  for (let i = 0; i < count; i += 1) {
    const p = placements[i]
    const world = gridToWorld(p.r, p.c, maze)
    if (!world) continue

    variantIndices[i] = p.variant
    const cx = world.x + p.dir.nx * wallOffset + p.dir.tx * p.lateralShift
    const cz = world.z + p.dir.nz * wallOffset + p.dir.tz * p.lateralShift
    quadChunkIndices[i] = chunkLayout.getChunkIndex(world.x, world.z)
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

    writeQuadUvs(uvs, vBase * 2, WALL_DETAIL_ATLAS_UVS[p.variant], p.flipU, p.flipV)
    writeQuadRgba(
      colors,
      vBase * 4,
      clamp(p.tint + p.warmth, 0.74, 1.04),
      clamp(p.tint, 0.74, 1.04),
      clamp(p.tint - p.warmth * 0.6, 0.74, 1.04),
      p.alpha
    )
  }

  return buildChunkedDecalLayerNode({
    maze,
    layerName: 'maze-walls-imperfections',
    count,
    positions,
    normals,
    uvs,
    colors,
    variantIndices,
    quadChunkIndices,
    material: wallDetailMaterial,
  })
}

/**
 * Places 16 distinct horizontal concrete floor details (hairline cracks, structural
 * fractures, exposed-aggregate spalls, cement repairs, skim patches, directional boot
 * scuffs, dragged-crate scrapes, edge dirt, dried oil stains, rust rings, occasional
 * dried water/mineral rings, worn safety lines, bay stencils, peeling floor coatings,
 * impact stars, and crazing) with regional zone coherence, wall/corner/entrance wear
 * awareness, and strict 2-cell anti-neighbor non-repetition while keeping most
 * walking surfaces clean and dry matte concrete.
 */
export function buildFloorImperfectionMesh(maze, floorDetailMaterial) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !floorDetailMaterial) {
    return null
  }

  const atlasUvs = FLOOR_DETAIL_ATLAS_UVS

  const rows = grid.length
  const cols = grid[0]?.length || 0
  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-floor-detail-v5`)
  const seedNum = Math.round(normalizeWeatherSeed(maze.seed ?? maze.id ?? 'maze') * 157) + 911
  const zoneSeedA = seedNum + 313
  const zoneSeedB = seedNum + 787
  const placements = []
  const cellVariantHistory = new Map()
  const variantCounts = new Map()

  const isSpecialCell = (r, c) =>
    (maze.start && maze.start.row === r && maze.start.col === c) ||
    (maze.exit && maze.exit.row === r && maze.exit.col === c)

  const isNearEntranceOrExit = (r, c) => {
    const ds = maze.start
      ? Math.abs(maze.start.row - r) + Math.abs(maze.start.col - c)
      : 99
    const de = maze.exit
      ? Math.abs(maze.exit.row - r) + Math.abs(maze.exit.col - c)
      : 99
    return ds <= 2 || de <= 2
  }

  const isPathAt = (r, c) =>
    r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === CELL_TYPES.PATH

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH || isSpecialCell(r, c)) continue

      const nOpen = isPathAt(r - 1, c)
      const sOpen = isPathAt(r + 1, c)
      const eOpen = isPathAt(r, c + 1)
      const wOpen = isPathAt(r, c - 1)
      const openCount = (nOpen ? 1 : 0) + (sOpen ? 1 : 0) + (eOpen ? 1 : 0) + (wOpen ? 1 : 0)
      const isStraightNS = openCount === 2 && nOpen && sOpen
      const isStraightEW = openCount === 2 && eOpen && wOpen
      const isStraight = isStraightNS || isStraightEW
      const isCornerOrJunction = openCount >= 3 || (openCount === 2 && !isStraight)
      const hasAdjacentWall = openCount < 4
      const nearThreshold = isNearEntranceOrExit(r, c)

      const zoneType = sampleFloorZoneArchetype(r, c, rows, cols, zoneSeedA, zoneSeedB)
      const regionalWear = sampleRegionalWear(r, c, rows, cols, zoneSeedA + 67)
      const baseChance =
        zoneType === 'cleanDry'
          ? isCornerOrJunction
            ? 0.21
            : 0.11
          : isCornerOrJunction || nearThreshold
            ? 0.30
            : 0.17
      const chance = clamp(baseChance + (regionalWear - 0.45) * 0.22, 0.08, 0.35)

      if (rng() > chance) continue

      const forbidden = new Set()
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          if (dr === 0 && dc === 0) continue
          if (Math.abs(dr) + Math.abs(dc) > 2 && (Math.abs(dr) > 1 || Math.abs(dc) > 1)) continue
          const prevList = cellVariantHistory.get(`${r + dr},${c + dc}`)
          if (prevList) {
            for (let k = 0; k < prevList.length; k += 1) {
              forbidden.add(prevList[k])
            }
          }
        }
      }

      const nearEdgeRoll = hasAdjacentWall && rng() < 0.36
      let pool
      if (nearThreshold && rng() < 0.58) {
        pool = FLOOR_ENTRANCE_POOL
      } else if (nearEdgeRoll) {
        pool = FLOOR_EDGE_POOL
      } else if (isCornerOrJunction && rng() < 0.45) {
        pool = FLOOR_CORNER_POOL
      } else {
        pool = FLOOR_ZONE_POOLS[zoneType]
      }

      // Keep damp/water ring (#10) as an occasional accent, never dominant
      const dampCount = variantCounts.get(10) || 0
      if (dampCount >= 1 && dampCount / (placements.length + 1) > 0.12) {
        forbidden.add(10)
      }

      const variant = pickAntiRepeatVariant(pool, rng, forbidden, variantCounts)

      // Proportion dimensions cleanly by floor detail category
      let halfW = 0.56 + rng() * 0.62
      let halfD = 0.48 + rng() * 0.56
      if (variant === 5 || variant === 6) {
        halfW = 0.66 + rng() * 0.66
        halfD = 0.38 + rng() * 0.38
      } else if (variant === 11 || variant === 12) {
        halfW = 0.52 + rng() * 0.48
        halfD = 0.32 + rng() * 0.34
      } else if (variant === 3 || variant === 4 || variant === 13) {
        halfW = 0.62 + rng() * 0.68
        halfD = 0.52 + rng() * 0.56
      } else if (variant === 2 || variant === 9 || variant === 14) {
        halfW = 0.42 + rng() * 0.42
        halfD = 0.40 + rng() * 0.40
      }

      const radiusBound = Math.hypot(halfW, halfD)
      const maxShift = Math.max(0.08, CELL_SIZE * 0.47 - radiusBound * 0.65)
      let shiftX = (rng() * 2 - 1) * maxShift * 0.65
      let shiftZ = (rng() * 2 - 1) * maxShift * 0.65

      // Push edge dirt, stains, and boundary cracks softly toward adjacent walls
      const edgeAligned =
        nearEdgeRoll || variant === 7 || variant === 8 || variant === 9 || variant === 10
      if (edgeAligned && hasAdjacentWall) {
        if (!wOpen) shiftX = -lerp(maxShift * 0.42, maxShift, rng())
        else if (!eOpen) shiftX = lerp(maxShift * 0.42, maxShift, rng())
        if (!nOpen) shiftZ = -lerp(maxShift * 0.42, maxShift, rng())
        else if (!sOpen) shiftZ = lerp(maxShift * 0.42, maxShift, rng())
      }

      // Align directional wear, drag gouges & safety markings along straight hallway axis
      let rot = rng() * Math.PI * 2
      if (FLOOR_DIRECTIONAL_VARIANTS.has(variant)) {
        if (isStraightNS) {
          rot = (rng() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5) + (rng() - 0.5) * 0.28
        } else if (isStraightEW) {
          rot = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.28
        } else if (variant === 12) {
          // Keep stencil floor IDs cardinal-oriented for realistic facility stenciling
          rot = Math.floor(rng() * 4) * (Math.PI * 0.5) + (rng() - 0.5) * 0.14
        }
      }

      const canFlipU = FLOOR_HORIZ_FLIP_SAFE.has(variant)
      const canFlipV = FLOOR_VERT_FLIP_SAFE.has(variant)

      placements.push({
        r,
        c,
        variant,
        halfW,
        halfD,
        shiftX,
        shiftZ,
        rot,
        flipU: canFlipU && rng() < 0.5,
        flipV: canFlipV && rng() < 0.5,
        tint: 0.76 + rng() * 0.18,
        warmth: (rng() - 0.5) * 0.05,
        alpha: 0.22 + rng() * 0.3,
      })

      cellVariantHistory.set(`${r},${c}`, [variant])
      variantCounts.set(variant, (variantCounts.get(variant) || 0) + 1)
    }
  }

  if (placements.length === 0) {
    return null
  }

  const chunkLayout = createMazeChunkLayout(maze)
  const count = placements.length
  const positions = new Float32Array(count * 4 * 3)
  const normals = new Float32Array(count * 4 * 3)
  const uvs = new Float32Array(count * 4 * 2)
  const colors = new Float32Array(count * 4 * 4)
  const variantIndices = new Uint8Array(count)
  const quadChunkIndices = new Uint16Array(count)

  // Sits slightly above floor slab (y=0) and below marker bases (y=0.06)
  const yFloorDecal = 0.0045

  for (let i = 0; i < count; i += 1) {
    const p = placements[i]
    const world = gridToWorld(p.r, p.c, maze)
    if (!world) continue

    variantIndices[i] = p.variant
    const cx = world.x + p.shiftX
    const cz = world.z + p.shiftZ
    quadChunkIndices[i] = chunkLayout.getChunkIndex(world.x, world.z)
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

    writeQuadUvs(uvs, vBase * 2, atlasUvs[p.variant], p.flipU, p.flipV)
    writeQuadRgba(
      colors,
      vBase * 4,
      clamp(p.tint + p.warmth, 0.68, 1.05),
      clamp(p.tint, 0.68, 1.05),
      clamp(p.tint - p.warmth * 0.6, 0.68, 1.05),
      p.alpha
    )
  }

  return buildChunkedDecalLayerNode({
    maze,
    layerName: 'maze-floor-imperfections',
    count,
    positions,
    normals,
    uvs,
    colors,
    variantIndices,
    quadChunkIndices,
    material: floorDetailMaterial,
  })
}

// Ceiling-appropriate architectural variants from the 4x4 concrete detail atlas:
// hairline cracks (0), aggregate spall cavities (2), troweled mortar repairs (3),
// anchor/hanger socket scars (7), chalky efflorescence (9), honeycomb voids (12),
// shrinkage map-crazing (13), electrical junction scorch (14). Zero footprints/drips.
const CEILING_SOFFIT_POOLS = {
  cleanCast: [0, 3, 12, 13],
  anchorUtility: [3, 7, 12, 14],
  weatheredSeam: [0, 2, 9, 12, 13],
}

/**
 * Places sparse, ceiling-appropriate concrete soffit imperfections (formwork repair
 * patches, exposed-aggregate honeycomb pockets, overhead hanger scars, efflorescence,
 * hairline crazing, and dry junction scorch) facing strictly downward (-Y) inside
 * open ceiling bays with 2-cell anti-neighbor non-repetition. Reuses the pooled
 * wallDetailMaterial so zero extra textures are allocated.
 */
export function buildCeilingImperfectionMesh(
  maze,
  wallDetailMaterial,
  { soffitY = 3.6 } = {}
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !wallDetailMaterial) {
    return null
  }

  const rows = grid.length
  const cols = grid[0]?.length || 0
  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-ceiling-detail-v1`)
  const seedNum = Math.round(normalizeWeatherSeed(maze.seed ?? maze.id ?? 'maze') * 179) + 1409
  const zoneSeedA = seedNum + 271
  const zoneSeedB = seedNum + 643
  const placements = []
  const cellVariantHistory = new Map()
  const variantCounts = new Map()

  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue

      const regionalWear = sampleRegionalWear(r, c, rows, cols, zoneSeedA + 53)
      const zoneRoll = sampleRegionalWear(r, c, rows, cols, zoneSeedB + 97)
      const chance = clamp(0.11 + (regionalWear - 0.45) * 0.16, 0.07, 0.22)
      if (rng() > chance) continue

      const forbidden = new Set()
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          if (dr === 0 && dc === 0) continue
          if (Math.abs(dr) + Math.abs(dc) > 2 && (Math.abs(dr) > 1 || Math.abs(dc) > 1)) continue
          const prevList = cellVariantHistory.get(`${r + dr},${c + dc}`)
          if (prevList) {
            for (let k = 0; k < prevList.length; k += 1) {
              forbidden.add(prevList[k])
            }
          }
        }
      }

      const pool =
        zoneRoll < 0.36
          ? CEILING_SOFFIT_POOLS.cleanCast
          : zoneRoll < 0.68
            ? CEILING_SOFFIT_POOLS.weatheredSeam
            : CEILING_SOFFIT_POOLS.anchorUtility

      const variant = pickAntiRepeatVariant(pool, rng, forbidden, variantCounts)

      // Keep quads well inside each 4m coffer bay clear of girder soffit ribs
      let halfW = 0.5 + rng() * 0.44
      let halfD = 0.46 + rng() * 0.4
      if (variant === 7 || variant === 14) {
        halfW = 0.38 + rng() * 0.28
        halfD = 0.38 + rng() * 0.28
      } else if (variant === 3 || variant === 9) {
        halfW = 0.58 + rng() * 0.44
        halfD = 0.44 + rng() * 0.38
      }

      const maxShift = Math.max(0.08, CELL_SIZE * 0.38 - Math.hypot(halfW, halfD) * 0.5)
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
        tint: 0.8 + rng() * 0.18,
        warmth: (rng() - 0.5) * 0.05,
        alpha: 0.24 + rng() * 0.3,
      })

      cellVariantHistory.set(`${r},${c}`, [variant])
      variantCounts.set(variant, (variantCounts.get(variant) || 0) + 1)
    }
  }

  if (placements.length === 0) {
    return null
  }

  const chunkLayout = createMazeChunkLayout(maze)
  const count = placements.length
  const positions = new Float32Array(count * 4 * 3)
  const normals = new Float32Array(count * 4 * 3)
  const uvs = new Float32Array(count * 4 * 2)
  const colors = new Float32Array(count * 4 * 4)
  const variantIndices = new Uint8Array(count)
  const quadChunkIndices = new Uint16Array(count)

  // Offset slightly beneath ceiling soffit (-Y) to prevent Z-fighting
  const yCeilingDecal = soffitY - 0.008

  for (let i = 0; i < count; i += 1) {
    const p = placements[i]
    const world = gridToWorld(p.r, p.c, maze)
    if (!world) continue

    variantIndices[i] = p.variant
    const cx = world.x + p.shiftX
    const cz = world.z + p.shiftZ
    quadChunkIndices[i] = chunkLayout.getChunkIndex(world.x, world.z)
    const cosR = Math.cos(p.rot)
    const sinR = Math.sin(p.rot)

    // Corners ordered (-hw,-hd), (+hw,-hd), (+hw,+hd), (-hw,+hd) so e1 x e2 = (0, -1, 0) downward
    const corners = [
      [-p.halfW, -p.halfD],
      [p.halfW, -p.halfD],
      [p.halfW, p.halfD],
      [-p.halfW, p.halfD],
    ]

    const vBase = i * 4
    for (let k = 0; k < 4; k += 1) {
      const [lx, lz] = corners[k]
      const rx = lx * cosR - lz * sinR
      const rz = lx * sinR + lz * cosR
      const vIdx = (vBase + k) * 3
      positions[vIdx] = cx + rx
      positions[vIdx + 1] = yCeilingDecal
      positions[vIdx + 2] = cz + rz
      normals[vIdx] = 0
      normals[vIdx + 1] = -1
      normals[vIdx + 2] = 0
    }

    writeQuadUvs(uvs, vBase * 2, WALL_DETAIL_ATLAS_UVS[p.variant], p.flipU, p.flipV)
    writeQuadRgba(
      colors,
      vBase * 4,
      clamp(p.tint + p.warmth, 0.7, 1.02),
      clamp(p.tint, 0.7, 1.02),
      clamp(p.tint - p.warmth * 0.6, 0.7, 1.02),
      p.alpha
    )
  }

  return buildChunkedDecalLayerNode({
    maze,
    layerName: 'maze-ceiling-imperfections',
    count,
    positions,
    normals,
    uvs,
    colors,
    variantIndices,
    quadChunkIndices,
    material: wallDetailMaterial,
  })
}
