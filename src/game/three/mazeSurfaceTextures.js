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

/**
 * Draws a tile-wrapped anti-aliased dark scratch/crack path onto scalar buffers.
 */
function stampCrackSegments(
  albedoMod,
  heightBuf,
  roughBuf,
  size,
  segments,
  halfWidthPx,
  darkness,
  depthDrop,
  wrapX = true,
  wrapY = true
) {
  for (let s = 0; s < segments.length; s += 1) {
    const [x0, y0, x1, y1] = segments[s]
    const minX = Math.floor(Math.min(x0, x1) - halfWidthPx - 2)
    const maxX = Math.ceil(Math.max(x0, x1) + halfWidthPx + 2)
    const minY = Math.floor(Math.min(y0, y1) - halfWidthPx - 2)
    const maxY = Math.ceil(Math.max(y0, y1) + halfWidthPx + 2)

    for (let py = minY; py <= maxY; py += 1) {
      if (!wrapY && (py < 0 || py >= size)) continue
      const wy = ((py % size) + size) % size
      for (let px = minX; px <= maxX; px += 1) {
        if (!wrapX && (px < 0 || px >= size)) continue
        const wx = ((px % size) + size) % size
        const d = distToSegment(px, py, x0, y0, x1, y1)
        const falloff = 1 - smoothstep(0, halfWidthPx + 0.85, d)
        if (falloff <= 0.001) continue
        const idx = wy * size + wx
        albedoMod[idx] = Math.min(albedoMod[idx], 1 - falloff * darkness)
        heightBuf[idx] = Math.max(0, heightBuf[idx] - falloff * depthDrop)
        roughBuf[idx] = Math.min(1, roughBuf[idx] + falloff * 0.14)
      }
    }
  }
}

function generateCrackChain(rng, startX, startY, angle, steps, stepLen, branchChance) {
  const segs = []
  let x = startX
  let y = startY
  let dir = angle

  for (let i = 0; i < steps; i += 1) {
    dir += (rng() - 0.5) * 0.65
    const len = stepLen * (0.65 + rng() * 0.7)
    const nx = x + Math.cos(dir) * len
    const ny = y + Math.sin(dir) * len
    segs.push([x, y, nx, ny])
    if (i > 1 && i < steps - 1 && rng() < branchChance) {
      const bAngle = dir + (rng() < 0.5 ? 1 : -1) * (0.45 + rng() * 0.55)
      const bSteps = Math.max(2, Math.floor(steps * 0.45))
      segs.push(...generateCrackChain(rng, nx, ny, bAngle, bSteps, stepLen * 0.75, 0))
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
 * Generates seamless 512x512 industrial concrete floor albedo plus matching
 * 256x256 roughness and bump heightmaps spanning a 2x2 grid-cell module (8m x 8m).
 */
function buildFloorTextures() {
  const albedoSize = 512
  const dataSize = 256
  const rng = createRng('lumen-vault-floor-concrete-v1')

  const albedoMod = new Float32Array(albedoSize * albedoSize).fill(1)
  const heightHi = new Float32Array(albedoSize * albedoSize).fill(0.62)
  const roughHi = new Float32Array(albedoSize * albedoSize).fill(0.88)

  // Subtle organic stains (damp oil/water patches)
  const stains = []
  for (let i = 0; i < 5; i += 1) {
    const rx = 0.07 + rng() * 0.08
    const ry = 0.06 + rng() * 0.08
    const rot = rng() * Math.PI * 2
    stains.push({
      cx: rng(),
      cy: rng(),
      rx,
      ry,
      ca: Math.cos(rot),
      sa: Math.sin(rot),
      maxBound: Math.max(rx, ry) * 1.5,
      dark: 0.14 + rng() * 0.1,
      dampRoughDrop: 0.18 + rng() * 0.1,
      warmTint: rng() < 0.45 ? 1 : -1,
    })
  }

  // Worn traffic sheen zones across slab centers
  const scuffClusters = []
  for (let i = 0; i < 7; i += 1) {
    const cx = (0.18 + rng() * 0.64) * albedoSize
    const cy = (0.18 + rng() * 0.64) * albedoSize
    const ang = rng() * Math.PI
    const len = 18 + rng() * 26
    scuffClusters.push([
      cx - Math.cos(ang) * len * 0.5,
      cy - Math.sin(ang) * len * 0.5,
      cx + Math.cos(ang) * len * 0.5,
      cy + Math.sin(ang) * len * 0.5,
    ])
  }

  // Hairline concrete cracks anchored near expansion joints
  const crackSegs = [
    ...generateCrackChain(rng, 256, 256, 0.55, 8, 12, 0.35),
    ...generateCrackChain(rng, 12, 130, -0.35, 7, 11, 0.3),
    ...generateCrackChain(rng, 390, 8, 1.35, 6, 10, 0.25),
    ...generateCrackChain(rng, 130, 384, -1.2, 6, 10, 0.25),
  ]

  stampCrackSegments(albedoMod, heightHi, roughHi, albedoSize, crackSegs, 0.8, 0.28, 0.32)
  stampCrackSegments(albedoMod, heightHi, roughHi, albedoSize, scuffClusters, 1.8, 0.09, 0.04)

  const albedoBytes = new Uint8Array(albedoSize * albedoSize * 4)

  for (let y = 0; y < albedoSize; y += 1) {
    const v = y / albedoSize
    for (let x = 0; x < albedoSize; x += 1) {
      const u = x / albedoSize
      const idx = y * albedoSize + x

      // Smooth poured-concrete base fBm + subtle fine mineral grain
      const macro = samplePeriodicFbm(u, v, 4, 4, 101)
      const grain = samplePeriodicFbm(u, v, 32, 2, 307)
      let lum = 0.87 + (macro - 0.5) * 0.14 + (grain - 0.5) * 0.065
      let rTint = 0
      let gTint = 0
      let bTint = 0

      // Expansion joints every 1 cell (0.5 in 2x2 UV) + subtle score lines (0.25)
      const duPrimary = Math.min(u % 0.5, 0.5 - (u % 0.5))
      const dvPrimary = Math.min(v % 0.5, 0.5 - (v % 0.5))
      const distPrimary = Math.min(duPrimary, dvPrimary) * albedoSize

      const duSub = Math.min(u % 0.25, 0.25 - (u % 0.25))
      const dvSub = Math.min(v % 0.25, 0.25 - (v % 0.25))
      const distSub = Math.min(duSub, dvSub) * albedoSize

      const primaryGroove = 1 - smoothstep(1.1, 2.8, distPrimary)
      const primaryBevel = smoothstep(2.4, 4.2, distPrimary) * (1 - smoothstep(4.2, 7.2, distPrimary))
      const subGroove = (1 - smoothstep(0.6, 1.8, distSub)) * 0.45

      const grooveMask = Math.max(primaryGroove, subGroove)
      lum *= 1 - grooveMask * 0.28
      lum += primaryBevel * 0.04

      let heightVal = heightHi[idx] + (macro - 0.5) * 0.12 + (grain - 0.5) * 0.08
      heightVal -= grooveMask * 0.34
      heightVal += primaryBevel * 0.04

      let roughVal = roughHi[idx] + (0.5 - macro) * 0.08 + (grain - 0.5) * 0.06
      roughVal = Math.min(0.98, roughVal + grooveMask * 0.1)

      // Organic damp stains & mineral discoloration rings
      for (let s = 0; s < stains.length; s += 1) {
        const st = stains[s]
        let dx = u - st.cx
        if (dx > 0.5) dx -= 1
        if (dx < -0.5) dx += 1
        if (Math.abs(dx) > st.maxBound) continue
        let dy = v - st.cy
        if (dy > 0.5) dy -= 1
        if (dy < -0.5) dy += 1
        if (Math.abs(dy) > st.maxBound) continue
        const lx = (dx * st.ca - dy * st.sa) / st.rx
        const ly = (dx * st.sa + dy * st.ca) / st.ry
        const warp = (macro - 0.5) * 0.55 + (grain - 0.5) * 0.22
        const dist = Math.hypot(lx, ly) + warp
        if (dist < 1.15) {
          const core = 1 - smoothstep(0.2, 1.0, dist)
          const ring = smoothstep(0.65, 0.9, dist) * (1 - smoothstep(0.9, 1.12, dist))
          lum *= 1 - core * st.dark
          lum += ring * 0.032
          roughVal -= core * st.dampRoughDrop
          if (st.warmTint > 0) {
            rTint += core * 0.038
            gTint += core * 0.014
            bTint -= core * 0.022
          } else {
            rTint -= core * 0.015
            gTint += core * 0.012
            bTint += core * 0.015
          }
        }
      }

      // Worn walkway center polish (subtle roughness drop inside open slab bays)
      const slabCenterWear =
        smoothstep(10, 48, distPrimary) * (0.06 + (1 - macro) * 0.05)
      roughVal -= slabCenterWear
      lum += slabCenterWear * 0.14

      lum *= albedoMod[idx]
      heightHi[idx] = clamp(heightVal, 0, 1)
      roughHi[idx] = clamp(roughVal, 0.48, 0.99)

      const p = idx * 4
      albedoBytes[p] = clamp(Math.round((lum + rTint) * 255), 0, 255)
      albedoBytes[p + 1] = clamp(Math.round((lum + gTint) * 255), 0, 255)
      albedoBytes[p + 2] = clamp(Math.round((lum + bTint) * 255), 0, 255)
      albedoBytes[p + 3] = 255
    }
  }

  // Downsample high-res bump/roughness cleanly to 256x256 (2x2 box average)
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
 * Generates horizontally seamless 512x512 concrete facility wall albedo
 * (panel seams, form-tie sockets, rust drips, rising damp, worn dado, scratches)
 * plus matching 256x256 roughness and bump heightmaps.
 */
function buildWallTextures() {
  const albedoSize = 512
  const dataSize = 256
  const rng = createRng('lumen-vault-wall-concrete-v1')

  const albedoMod = new Float32Array(albedoSize * albedoSize).fill(1)
  const heightHi = new Float32Array(albedoSize * albedoSize).fill(0.64)
  const roughHi = new Float32Array(albedoSize * albedoSize).fill(0.86)

  // Restrained hairline cracks near joints + scratches around corridor chest height
  const wallMarks = [
    ...generateCrackChain(rng, 256, 336, 0.9, 6, 11, 0.35),
    ...generateCrackChain(rng, 10, 174, -0.45, 5, 10, 0.25),
    ...generateCrackChain(rng, 342, 180, -1.9, 5, 9, 0.2),
  ]
  const wallScratches = []
  for (let i = 0; i < 12; i += 1) {
    const sx = (0.08 + rng() * 0.84) * albedoSize
    const sy = (0.34 + rng() * 0.36) * albedoSize
    const ang = (rng() - 0.5) * 0.55
    const len = 14 + rng() * 28
    wallScratches.push([sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len])
  }

  stampCrackSegments(
    albedoMod,
    heightHi,
    roughHi,
    albedoSize,
    wallMarks,
    0.85,
    0.26,
    0.3,
    true,
    false
  )
  stampCrackSegments(
    albedoMod,
    heightHi,
    roughHi,
    albedoSize,
    wallScratches,
    0.65,
    0.14,
    0.12,
    true,
    false
  )

  // Form-tie sockets (x in [0..1], y in [0..1] where y=0 is floor, y=1 is wall top)
  const tieAnchors = [
    { u: 0.14, v: 0.26, dripLen: 0.22, rust: 0.9 },
    { u: 0.36, v: 0.26, dripLen: 0.12, rust: 0.5 },
    { u: 0.64, v: 0.26, dripLen: 0.19, rust: 0.85 },
    { u: 0.86, v: 0.26, dripLen: 0.1, rust: 0.4 },
    { u: 0.14, v: 0.62, dripLen: 0.26, rust: 1.0 },
    { u: 0.36, v: 0.62, dripLen: 0.14, rust: 0.55 },
    { u: 0.64, v: 0.62, dripLen: 0.2, rust: 0.75 },
    { u: 0.86, v: 0.62, dripLen: 0.28, rust: 0.95 },
  ]

  // Upper condensation water-runoff drip columns
  const dripColumns = []
  for (let i = 0; i < 14; i += 1) {
    dripColumns.push({
      u: (i + 0.25 + rng() * 0.5) / 14,
      width: 0.008 + rng() * 0.014,
      length: 0.16 + rng() * 0.28,
      strength: 0.12 + rng() * 0.14,
    })
  }

  const albedoBytes = new Uint8Array(albedoSize * albedoSize * 4)

  for (let y = 0; y < albedoSize; y += 1) {
    // Note: DataTexture y=0 is bottom (uv.y = 0) and y=size-1 is top (uv.y = 1)
    const v = y / (albedoSize - 1)
    for (let x = 0; x < albedoSize; x += 1) {
      const u = x / albedoSize
      const idx = y * albedoSize + x

      const macro = samplePeriodicFbm(u, v, 4, 4, 509, false)
      const grain = samplePeriodicFbm(u, v, 24, 2, 733, false)
      const streakNoise = samplePeriodicFbm(u * 2, v * 0.35, 16, 2, 911, false)

      let lum = 0.89 + (macro - 0.5) * 0.13 + (grain - 0.5) * 0.07
      let rTint = 0
      let gTint = 0
      let bTint = 0

      // Vertical precast panel joints every 2m (u = 0.0 and u = 0.5)
      const duPanel = Math.min(u % 0.5, 0.5 - (u % 0.5)) * albedoSize
      const vertGroove = 1 - smoothstep(1.0, 2.7, duPanel)
      const vertHighlight =
        smoothstep(2.3, 3.8, duPanel) * (1 - smoothstep(3.8, 6.2, duPanel))

      // Horizontal formwork seams at v = 0.34 and v = 0.72
      const dvLow = Math.abs(v - 0.34) * albedoSize
      const dvHigh = Math.abs(v - 0.72) * albedoSize
      const dvNearest = Math.min(dvLow, dvHigh)
      const horizGroove = 1 - smoothstep(0.9, 2.4, dvNearest)
      const horizLip =
        smoothstep(1.8, 3.2, Math.min(Math.max(0, (v - 0.34) * albedoSize), Math.max(0, (v - 0.72) * albedoSize))) *
        (1 - smoothstep(3.2, 5.2, dvNearest))

      const seamGroove = Math.max(vertGroove, horizGroove)
      lum *= 1 - seamGroove * 0.3
      lum += (vertHighlight + horizLip) * 0.038

      // Subtle weathered dado / industrial lower wall course (below v=0.34)
      if (v < 0.34) {
        const edgeWear = smoothstep(0.325, 0.34, v)
        const chipMask = smoothstep(0.38, 0.68, grain)
        lum *= 1 - (0.055 - edgeWear * 0.02 * chipMask)
      }
      // Faint weathered industrial stripe at v = 0.315..0.335 (muted slate-ochre)
      const stripeDist = Math.abs(v - 0.322)
      if (stripeDist < 0.015) {
        const stripeAlpha =
          (1 - smoothstep(0.008, 0.015, stripeDist)) *
          smoothstep(0.32, 0.66, macro * 0.6 + grain * 0.4) *
          0.42
        rTint += stripeAlpha * 0.09
        gTint += stripeAlpha * 0.06
        bTint -= stripeAlpha * 0.03
        lum *= 1 - stripeAlpha * 0.14
      }

      // Rising damp & floor splash grime along bottom edge
      const dampHeight = 0.17 + (macro - 0.5) * 0.09 + (streakNoise - 0.5) * 0.04
      const risingDamp = 1 - smoothstep(0.01, dampHeight, v)
      lum *= 1 - risingDamp * 0.28
      gTint += risingDamp * 0.012
      bTint -= risingDamp * 0.01

      // Top grime under coping cap + vertical condensation drips
      const topShadow = smoothstep(0.88, 1.0, v)
      lum *= 1 - topShadow * 0.18

      let dripVal = 0
      if (v > 0.54) {
        for (let d = 0; d < dripColumns.length; d += 1) {
          const col = dripColumns[d]
          if (v <= 1 - col.length) continue
          let dx = Math.abs(u - col.u)
          if (dx > 0.5) dx = 1 - dx
          if (dx < col.width * 1.4) {
            const lat = 1 - smoothstep(col.width * 0.3, col.width * 1.2, dx)
            const vertFade = smoothstep(1 - col.length, 0.98, v)
            dripVal = Math.max(dripVal, lat * vertFade * col.strength)
          }
        }
      }
      lum *= 1 - dripVal

      // Form-tie recessed anchor dimples + subtle vertical oxidized rust streaks
      let heightOffset = 0
      let roughOffset = 0
      for (let t = 0; t < tieAnchors.length; t += 1) {
        const tie = tieAnchors[t]
        let dx = u - tie.u
        if (dx > 0.5) dx -= 1
        if (dx < -0.5) dx += 1
        if (Math.abs(dx) > 0.018) continue
        const dy = v - tie.v
        if (dy > 0.018 || dy < -tie.dripLen) continue
        const radPx = Math.hypot(dx * albedoSize, dy * albedoSize)
        if (radPx < 7.5) {
          const pit = 1 - smoothstep(1.8, 5.2, radPx)
          const rim = smoothstep(4.2, 5.8, radPx) * (1 - smoothstep(5.8, 7.5, radPx))
          lum *= 1 - pit * 0.46
          lum += rim * 0.04
          heightOffset -= pit * 0.36
          roughOffset += pit * 0.12
        }
        // Downward oxidized rust streak from tie socket
        if (dy < 0) {
          const xDist = Math.abs(dx) * albedoSize
          const dripW = 1.6 + (-dy / tie.dripLen) * 2.2
          if (xDist < dripW + 1.5) {
            const streak =
              (1 - smoothstep(0.4, dripW + 1.2, xDist)) *
              (1 - smoothstep(0, tie.dripLen, -dy)) *
              tie.rust *
              (0.55 + grain * 0.45)
            lum *= 1 - streak * 0.24
            rTint += streak * 0.11
            gTint += streak * 0.03
            bTint -= streak * 0.04
          }
        }
      }

      let heightVal =
        heightHi[idx] +
        (macro - 0.5) * 0.1 +
        (grain - 0.5) * 0.08 -
        seamGroove * 0.35 +
        (vertHighlight + horizLip) * 0.05 +
        heightOffset

      let roughVal =
        roughHi[idx] +
        (0.5 - macro) * 0.08 +
        (grain - 0.5) * 0.06 +
        seamGroove * 0.1 -
        risingDamp * 0.14 -
        dripVal * 0.18 +
        roughOffset

      lum *= albedoMod[idx]
      heightHi[idx] = clamp(heightVal, 0, 1)
      roughHi[idx] = clamp(roughVal, 0.54, 0.99)

      const p = idx * 4
      albedoBytes[p] = clamp(Math.round((lum + rTint) * 255), 0, 255)
      albedoBytes[p + 1] = clamp(Math.round((lum + gTint) * 255), 0, 255)
      albedoBytes[p + 2] = clamp(Math.round((lum + bTint) * 255), 0, 255)
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

// 5x7 crisp bitmap font glyphs for subtle industrial stencil marks
const STENCIL_GLYPHS = {
  S: ['01110', '10001', '10000', '01110', '00001', '10001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  0: ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
}

function paintAlphaStroke(buf, size, ox, oy, qSize, ax, ay, bx, by, radius, colorRgb, alpha) {
  const minX = Math.max(ox + 6, Math.floor(ox + Math.min(ax, bx) - radius - 2))
  const maxX = Math.min(ox + qSize - 6, Math.ceil(ox + Math.max(ax, bx) + radius + 2))
  const minY = Math.max(oy + 6, Math.floor(oy + Math.min(ay, by) - radius - 2))
  const maxY = Math.min(oy + qSize - 6, Math.ceil(oy + Math.max(ay, by) + radius + 2))

  for (let py = minY; py <= maxY; py += 1) {
    const ly = py - oy
    for (let px = minX; px <= maxX; px += 1) {
      const lx = px - ox
      const d = distToSegment(lx, ly, ax, ay, bx, by)
      if (d > radius + 2) continue
      const u = px / size
      const v = py / size
      const wear = samplePeriodicFbm(u * 6, v * 6, 16, 2, 1811)
      const stroke = 1 - smoothstep(Math.max(0.2, radius * 0.45), radius + 1.4, d)
      const erodedAlpha = stroke * alpha * smoothstep(0.24, 0.72, wear + 0.14)
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

function paintStencilText(buf, size, ox, oy, qSize, startX, startY, text, cellPx, colorRgb, alpha) {
  let cursorX = startX
  for (let chIdx = 0; chIdx < text.length; chIdx += 1) {
    const glyph = STENCIL_GLYPHS[text[chIdx]]
    if (!glyph) {
      cursorX += cellPx * 4
      continue
    }
    for (let row = 0; row < 7; row += 1) {
      // Flip bitmap row vertically so DataTexture y-up orientation renders right-side up
      const rowStr = glyph[6 - row]
      for (let col = 0; col < 5; col += 1) {
        if (rowStr[col] !== '1') continue
        const x0 = Math.max(ox + 6, Math.floor(ox + cursorX + col * cellPx))
        const y0 = Math.max(oy + 6, Math.floor(oy + startY + row * cellPx))
        const x1 = Math.min(ox + qSize - 6, Math.ceil(x0 + cellPx))
        const y1 = Math.min(oy + qSize - 6, Math.ceil(y0 + cellPx))
        for (let py = y0; py < y1; py += 1) {
          for (let px = x0; px < x1; px += 1) {
            const wear = samplePeriodicFbm((px / size) * 8, (py / size) * 8, 16, 2, 1999)
            const a = alpha * smoothstep(0.28, 0.72, wear + 0.1)
            const p = (py * size + px) * 4
            buf[p] = colorRgb[0]
            buf[p + 1] = colorRgb[1]
            buf[p + 2] = colorRgb[2]
            buf[p + 3] = Math.max(buf[p + 3], Math.round(a * 255))
          }
        }
      }
    }
    cursorX += cellPx * 6.2
  }
}

/**
 * Generates a 512x512 2x2 RGBA atlas of restrained, dark-muted abandoned-facility
 * graffiti and markings (quadrants cleanly padded so mipmapping never bleeds).
 */
function buildGraffitiAtlasTexture() {
  const size = 512
  const qSize = 256
  const buf = new Uint8Array(size * size * 4)

  // Q0 (top-left: ox=0, oy=256): Muted industrial sector stencil "S-04" + worn hazard frame
  {
    const ox = 0
    const oy = qSize
    const ochre = [132, 108, 78]
    const darkRust = [92, 54, 48]
    paintStencilText(buf, size, ox, oy, qSize, 42, 118, 'S-04', 7.2, ochre, 0.66)
    paintAlphaStroke(buf, size, ox, oy, qSize, 30, 96, 224, 96, 2.2, ochre, 0.45)
    paintAlphaStroke(buf, size, ox, oy, qSize, 30, 184, 224, 184, 2.2, ochre, 0.42)
    paintAlphaStroke(buf, size, ox, oy, qSize, 30, 96, 30, 120, 2.2, ochre, 0.44)
    paintAlphaStroke(buf, size, ox, oy, qSize, 224, 160, 224, 184, 2.2, ochre, 0.44)
    paintAlphaStroke(buf, size, ox, oy, qSize, 166, 76, 212, 198, 2.8, darkRust, 0.42)
  }

  // Q1 (top-right: ox=256, oy=256): Scratched tally marks & claw/blade gouges
  {
    const ox = qSize
    const oy = qSize
    const chalk = [152, 164, 182]
    const shadowSlate = [36, 44, 58]
    const baseTallies = [38, 52, 66, 80, 112, 126, 140, 154, 184, 198, 212]
    for (let i = 0; i < baseTallies.length; i += 1) {
      const x = baseTallies[i]
      const jitter = ((i * 7) % 5) - 2
      paintAlphaStroke(buf, size, ox, oy, qSize, x, 134 + jitter, x + 2, 182 - jitter, 2.1, chalk, 0.62)
    }
    paintAlphaStroke(buf, size, ox, oy, qSize, 32, 144, 88, 174, 2.5, chalk, 0.65)
    paintAlphaStroke(buf, size, ox, oy, qSize, 106, 142, 162, 176, 2.5, chalk, 0.63)
    for (let i = 0; i < 6; i += 1) {
      const x = 58 + i * 16
      paintAlphaStroke(buf, size, ox, oy, qSize, x, 74, x + 4, 112, 1.9, chalk, 0.56)
    }
    paintAlphaStroke(buf, size, ox, oy, qSize, 52, 82, 110, 106, 2.2, chalk, 0.58)
    paintAlphaStroke(buf, size, ox, oy, qSize, 164, 62, 224, 118, 1.6, shadowSlate, 0.45)
  }

  // Q2 (bottom-left: ox=0, oy=0): Crossed warning arrow (muted dried rust)
  {
    const ox = 0
    const oy = 0
    const driedRust = [118, 58, 54]
    const soot = [38, 44, 54]
    paintAlphaStroke(buf, size, ox, oy, qSize, 42, 128, 196, 132, 4.4, driedRust, 0.68)
    paintAlphaStroke(buf, size, ox, oy, qSize, 152, 88, 200, 132, 4.2, driedRust, 0.68)
    paintAlphaStroke(buf, size, ox, oy, qSize, 152, 174, 200, 132, 4.2, driedRust, 0.68)
    paintAlphaStroke(buf, size, ox, oy, qSize, 74, 78, 144, 182, 3.4, soot, 0.62)
    paintAlphaStroke(buf, size, ox, oy, qSize, 146, 76, 78, 182, 3.4, soot, 0.62)
  }

  // Q3 (bottom-right: ox=256, oy=0): Soot smear + faint caution ring & X
  {
    const ox = qSize
    const oy = 0
    const ash = [126, 136, 150]
    const soot = [34, 42, 54]
    // Subtle soot smudge
    for (let ly = 44; ly < 212; ly += 1) {
      for (let lx = 44; lx < 212; lx += 1) {
        const d = Math.hypot((lx - 128) / 72, (ly - 128) / 64)
        if (d > 1) continue
        const n = samplePeriodicFbm(lx / 128, ly / 128, 8, 2, 2111)
        const smudgeA = (1 - smoothstep(0.25, 1.0, d)) * 0.46 * smoothstep(0.32, 0.72, n)
        if (smudgeA > 0.01) {
          const p = ((oy + ly) * size + (ox + lx)) * 4
          buf[p] = soot[0]
          buf[p + 1] = soot[1]
          buf[p + 2] = soot[2]
          buf[p + 3] = Math.round(smudgeA * 255)
        }
      }
    }
    const steps = 16
    for (let i = 0; i < steps; i += 1) {
      const a0 = (i / steps) * Math.PI * 2
      const a1 = ((i + 1) / steps) * Math.PI * 2
      paintAlphaStroke(
        buf,
        size,
        ox,
        oy,
        qSize,
        128 + Math.cos(a0) * 56,
        128 + Math.sin(a0) * 56,
        128 + Math.cos(a1) * 56,
        128 + Math.sin(a1) * 56,
        2.5,
        ash,
        0.54
      )
    }
    paintAlphaStroke(buf, size, ox, oy, qSize, 92, 92, 164, 164, 2.8, ash, 0.56)
    paintAlphaStroke(buf, size, ox, oy, qSize, 164, 92, 92, 164, 2.8, ash, 0.56)
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

  const graffitiMaterial = getPooledSurface('graffiti:mat', () =>
    markSharedResource(
      new THREE.MeshStandardMaterial({
        map: graffitiAtlas,
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

  return {
    floor,
    wall,
    cap,
    graffitiAtlas,
    graffitiMaterial,
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

    // Contact AO around wall perimeters + low-frequency macro weathering on top face
    let shade = 0.96
    let warmShift = 0
    if (ny > 0.5) {
      const fx = (vx - originX) / CELL_SIZE
      const fz = (vz - originZ) / CELL_SIZE
      const col = Math.floor(clamp(fx, 0, cols - 1e-4))
      const row = Math.floor(clamp(fz, 0, rows - 1e-4))
      const fracX = fx - col
      const fracZ = fz - row

      // Check proximity to neighboring walls for soft perimeter grounding
      let wallProximity = 0
      if (fracX < 0.08 && isWallAt(row, col - 1)) wallProximity += 1
      if (fracX > 0.92 && isWallAt(row, col + 1)) wallProximity += 1
      if (fracZ < 0.08 && isWallAt(row - 1, col)) wallProximity += 1
      if (fracZ > 0.92 && isWallAt(row + 1, col)) wallProximity += 1

      // Diagonal corner check when vertex sits near a grid corner
      if (fracX < 0.08 && fracZ < 0.08 && isWallAt(row - 1, col - 1)) wallProximity += 0.5
      if (fracX > 0.92 && fracZ < 0.08 && isWallAt(row - 1, col + 1)) wallProximity += 0.5
      if (fracX < 0.08 && fracZ > 0.92 && isWallAt(row + 1, col - 1)) wallProximity += 0.5
      if (fracX > 0.92 && fracZ > 0.92 && isWallAt(row + 1, col + 1)) wallProximity += 0.5

      const aoDrop = Math.min(0.24, wallProximity * 0.095)
      const macroVar =
        (samplePeriodicFbm(fx / 7.5, fz / 7.5, 4, 2, 2309, true) - 0.5) * 0.14
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

const QUADRANT_UVS = [
  [0.015, 0.515, 0.485, 0.985], // Q0 (top-left)
  [0.515, 0.515, 0.985, 0.985], // Q1 (top-right)
  [0.015, 0.015, 0.485, 0.485], // Q2 (bottom-left)
  [0.515, 0.015, 0.985, 0.485], // Q3 (bottom-right)
]

/**
 * Selects well-spaced exposed interior corridor wall faces and merges selective
 * weathered graffiti decals into a single static draw-call Mesh.
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

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-graffiti-v1`)
  // Shuffle deterministically
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = tmp
  }

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
  const indices = new Uint16Array(count * 6)

  const wallOffset = CELL_SIZE / 2 + 0.012

  for (let i = 0; i < count; i += 1) {
    const { r, c, dir } = chosen[i]
    const world = gridToWorld(r, c, maze)
    if (!world) continue

    const qIdx = Math.floor(rng() * QUADRANT_UVS.length)
    const [u0, v0, u1, v1] = QUADRANT_UVS[qIdx]

    const halfW = (0.72 + rng() * 0.34) * 0.95
    const halfH = Math.min(bodyHeight * 0.34, halfW * (0.72 + rng() * 0.24))
    const centerY = clamp(bodyHeight * (0.45 + rng() * 0.14), halfH + 0.28, bodyHeight - halfH - 0.18)
    const lateralShift = (rng() - 0.5) * 0.55
    const tilt = (rng() - 0.5) * 0.09

    const cx = world.x + dir.nx * wallOffset + dir.tx * lateralShift
    const cz = world.z + dir.nz * wallOffset + dir.tz * lateralShift

    const cosT = Math.cos(tilt)
    const sinT = Math.sin(tilt)

    // Quad local corners: (-hw, -hh), (+hw, -hh), (+hw, +hh), (-hw, +hh)
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

    const uvBase = vBase * 2
    uvs[uvBase] = u0
    uvs[uvBase + 1] = v0
    uvs[uvBase + 2] = u1
    uvs[uvBase + 3] = v0
    uvs[uvBase + 4] = u1
    uvs[uvBase + 5] = v1
    uvs[uvBase + 6] = u0
    uvs[uvBase + 7] = v1

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
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const mesh = new THREE.Mesh(geometry, graffitiMaterial)
  mesh.name = 'maze-walls-graffiti'
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.userData = {
    decalCount: count,
  }
  return mesh
}
