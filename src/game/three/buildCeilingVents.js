import * as THREE from 'three'
import { createRng } from '../../utils/rng.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import {
  TEXTURE_QUALITY_PRESETS,
  resolveTextureQualityPreset,
} from './mazeSurfaceTextures.js'
import {
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

const ventPool = new Map()

export const CEILING_VENT_CLEARANCE_MIN_Y = 3.06

export const CEILING_VENT_PALETTE = {
  ductSteel: 0x4b596a, // Aged dull galvanized zinc-steel ducts
  hardwareIron: 0x252e3a, // Dark oxidized flanges, Unistrut hangers & grille louvers
  cavityVoid: 0x05070b, // Deep dark soot interior plenum throat
}

export const GRILLE_DESIGN_TYPES = [
  'double_louver',
  'square_diffuser',
  'linear_slot',
  'damper_hatch',
]

export const GRILLE_CONDITION_STATES = [
  'intact',
  'dusty',
  'damaged',
  'corroded',
]

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

function hash2i(ix, iy, seed = 4111) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

function samplePeriodicNoise(u, v, period, seed) {
  const uWrap = u >= 0 && u < 1 ? u : ((u % 1) + 1) % 1
  const vWrap = v >= 0 && v < 1 ? v : ((v % 1) + 1) % 1
  const fx = uWrap * period
  const fy = vWrap * period
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)

  const ix0 = x0 < period ? x0 : x0 % period
  const ix1 = ix0 + 1 < period ? ix0 + 1 : 0
  const iy0 = y0 < period ? y0 : y0 % period
  const iy1 = iy0 + 1 < period ? iy0 + 1 : 0

  const n00 = hash2i(ix0, iy0, seed)
  const n10 = hash2i(ix1, iy0, seed)
  const n01 = hash2i(ix0, iy1, seed)
  const n11 = hash2i(ix1, iy1, seed)
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy)
}

function samplePeriodicFbm(u, v, basePeriod, octaves, seed) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let freq = basePeriod
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * samplePeriodicNoise(u, v, freq, seed + o * 73)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm : 0.5
}

/**
 * Generates compact, pooled preset-scaled (256/128/64) procedural aged galvanized steel maps:
 * - Spangled zinc crystal patchwork (non-uniform crystalline flakes)
 * - Sheet-metal cross-brake creases & panel crimp seams
 * - Dust accumulation, hairline scratches, and localized warm oxidation/rust streaks
 */
function buildGalvanizedMetalTextureSet(seed = 8421, presetSpec = TEXTURE_QUALITY_PRESETS.high) {
  const size = presetSpec.ventSize
  const panelSeamBand = Math.max(0.022, 1.45 / size)
  const crossBrakeBand = Math.max(0.015, 1.15 / size)
  const pixelCount = size * size
  const albedo = new Uint8Array(pixelCount * 4)
  const rough = new Uint8Array(pixelCount * 4)
  const bump = new Uint8Array(pixelCount * 4)

  // Precompute wrap-around zinc spangle Voronoi nuclei (12x12 tiled cells)
  const cellRes = 12
  const nucleiX = new Float32Array(cellRes * cellRes)
  const nucleiY = new Float32Array(cellRes * cellRes)
  const nucleiTone = new Float32Array(cellRes * cellRes)
  const rng = createRng(seed)

  for (let cy = 0; cy < cellRes; cy += 1) {
    for (let cx = 0; cx < cellRes; cx += 1) {
      const idx = cy * cellRes + cx
      nucleiX[idx] = cx + 0.15 + rng() * 0.7
      nucleiY[idx] = cy + 0.15 + rng() * 0.7
      nucleiTone[idx] = rng()
    }
  }

  for (let py = 0; py < size; py += 1) {
    const v = py / size
    const gy = v * cellRes
    const cy0 = Math.floor(gy)

    for (let px = 0; px < size; px += 1) {
      const u = px / size
      const gx = u * cellRes
      const cx0 = Math.floor(gx)

      // Nearest Voronoi spangle facet (toroidal wrap)
      let bestDist = 999
      let bestTone = 0.5
      let secondDist = 999
      for (let dy = -1; dy <= 1; dy += 1) {
        const wy = ((cy0 + dy) % cellRes + cellRes) % cellRes
        const offY = cy0 + dy - wy
        for (let dx = -1; dx <= 1; dx += 1) {
          const wx = ((cx0 + dx) % cellRes + cellRes) % cellRes
          const offX = cx0 + dx - wx
          const nIdx = wy * cellRes + wx
          const nx = nucleiX[nIdx] + offX
          const ny = nucleiY[nIdx] + offY
          const d = (gx - nx) * (gx - nx) + (gy - ny) * (gy - ny)
          if (d < bestDist) {
            secondDist = bestDist
            bestDist = d
            bestTone = nucleiTone[nIdx]
          } else if (d < secondDist) {
            secondDist = d
          }
        }
      }

      const spangleEdge = clamp((Math.sqrt(secondDist) - Math.sqrt(bestDist)) * 6.0, 0, 1)
      const spangleVal = (bestTone - 0.5) * 0.18 * (0.45 + 0.55 * spangleEdge)

      // Macro oxidation, dust blotches & fine grain
      const macroDust = samplePeriodicFbm(u, v, 3, 3, seed + 17)
      const rustMaskRaw = samplePeriodicFbm(u + 0.21, v + 0.37, 4, 3, seed + 59)
      const microGrain = hash2i(px, py, seed + 101) - 0.5

      // Directional roll-forming grain & faint handling scratches
      const rollGrain = (samplePeriodicNoise(u * 0.5, v * 6.0, 16, seed + 113) - 0.5) * 0.032
      const scratchA = samplePeriodicNoise(u * 1.4 + v * 0.35, v * 0.25, 24, seed + 131)
      const scratchLine = smoothstep(0.84, 0.96, scratchA)

      // Sheet-metal panel lap seam, rivet dimples & cross-brake diagonal crease
      const seamV = Math.min(v, 1 - v)
      const panelSeam = 1 - smoothstep(0.0, panelSeamBand, seamV)
      const rivetRow = smoothstep(0.026, 0.036, seamV) * (1 - smoothstep(0.042, 0.056, seamV))
      const rivetU = Math.abs(((u * 8) % 1) - 0.5)
      const rivetDot = rivetRow * (1 - smoothstep(0.08, 0.2, rivetU))

      const diagA = Math.abs((u - v + 1) % 1 - 0.5)
      const diagB = Math.abs((u + v) % 1 - 0.5)
      const crossBrake =
        (1 - smoothstep(0.0, crossBrakeBand, diagA)) +
        (1 - smoothstep(0.0, crossBrakeBand, diagB))

      // Dust settles heavier in seams and random dull blotches
      const dustAmount = clamp(
        smoothstep(0.48, 0.84, macroDust) * 0.5 + panelSeam * 0.42,
        0,
        0.82
      )
      // Restrained localized iron-oxide staining near crimped seams and water tracks
      const rustAmount = clamp(
        smoothstep(0.68, 0.89, rustMaskRaw + panelSeam * 0.14) * 0.62,
        0,
        0.65
      )

      // Base oxidized zinc gray-slate reflectance
      let lum =
        0.64 +
        spangleVal * 1.12 +
        rollGrain +
        microGrain * 0.04 -
        crossBrake * 0.048 -
        panelSeam * 0.16 +
        rivetDot * 0.07
      lum += scratchLine * 0.08
      lum = lerp(lum, 0.45, dustAmount * 0.52)

      let r = lum * 0.96
      let g = lum * 0.99
      let b = lum * 1.04

      // Subtle rust patina shifts darkened steel slightly toward muted iron oxide
      if (rustAmount > 0.01) {
        r = lerp(r, 0.46, rustAmount * 0.5)
        g = lerp(g, 0.32, rustAmount * 0.54)
        b = lerp(b, 0.23, rustAmount * 0.58)
      }

      // Roughness: weathered zinc [0.55..0.68], raised to [0.76..0.92] under dust/rust
      let roughVal =
        0.61 -
        spangleVal * 0.24 -
        scratchLine * 0.08 +
        dustAmount * 0.24 +
        rustAmount * 0.22 +
        microGrain * 0.04
      roughVal = clamp(roughVal, 0.54, 0.93)

      // Bump height: flat sheet metal with raised cross-brakes, rivet heads, recessed seams & scratch grooves
      let bumpVal =
        0.5 +
        crossBrake * 0.19 +
        rivetDot * 0.22 -
        panelSeam * 0.28 -
        scratchLine * 0.12 -
        rustAmount * 0.08 +
        microGrain * 0.05
      bumpVal = clamp(bumpVal, 0.05, 0.95)

      const off = (py * size + px) * 4
      albedo[off] = Math.round(clamp(r, 0.05, 0.95) * 255)
      albedo[off + 1] = Math.round(clamp(g, 0.05, 0.95) * 255)
      albedo[off + 2] = Math.round(clamp(b, 0.05, 0.95) * 255)
      albedo[off + 3] = 255

      const roughByte = Math.round(roughVal * 255)
      rough[off] = roughByte
      rough[off + 1] = roughByte
      rough[off + 2] = roughByte
      rough[off + 3] = 255

      const bumpByte = Math.round(bumpVal * 255)
      bump[off] = bumpByte
      bump[off + 1] = bumpByte
      bump[off + 2] = bumpByte
      bump[off + 3] = 255
    }
  }

  const makeTex = (data, colorSpace) => {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    tex.colorSpace = colorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = presetSpec.anisotropyCap
    tex.userData.qualityPreset = presetSpec.id
    tex.needsUpdate = true
    return markSharedResource(tex)
  }

  return {
    map: makeTex(albedo, THREE.SRGBColorSpace),
    roughnessMap: makeTex(rough, THREE.NoColorSpace),
    bumpMap: makeTex(bump, THREE.NoColorSpace),
    size,
    qualityPreset: presetSpec.id,
  }
}

export function getGalvanizedMetalTextureSet(options = {}) {
  const preset = resolveTextureQualityPreset(options?.qualityPreset)
  const presetSpec = TEXTURE_QUALITY_PRESETS[preset]
  const poolKey = `${preset}:galvanized:set`
  let set = ventPool.get(poolKey)
  if (!set) {
    set = buildGalvanizedMetalTextureSet(8421, presetSpec)
    ventPool.set(poolKey, set)
  }
  return set
}

export function disposeCeilingVentPools() {
  for (const entry of ventPool.values()) {
    if (!entry) continue
    entry.map?.dispose?.()
    entry.roughnessMap?.dispose?.()
    entry.bumpMap?.dispose?.()
  }
  ventPool.clear()
}

export function getCeilingVentPoolStats() {
  return {
    entries: ventPool.size,
  }
}

registerSharedPoolClearer(disposeCeilingVentPools)

/**
 * Builds an indexed BufferGeometry directly from axis-aligned or rotated box specs:
 * `{ cx, cy, cz, sx, sy, sz, rx?, ry?, rz?, r?, g?, b? }`
 * Supports angled louvers, bent damaged fins, and 45-degree offset transitions cleanly.
 */
function buildMergedOrientedBoxesGeometry(boxes, tileUnits = 2.0) {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return null
  }

  const count = boxes.length
  const vertCount = count * 24
  const idxCount = count * 36

  const positions = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const colors = new Float32Array(vertCount * 3)
  const indices = vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount)

  let vCursor = 0
  let iCursor = 0
  const invTile = 1 / tileUnits

  for (let bIdx = 0; bIdx < count; bIdx += 1) {
    const b = boxes[bIdx]
    const hx = b.sx * 0.5
    const hy = b.sy * 0.5
    const hz = b.sz * 0.5
    const cx = b.cx
    const cy = b.cy
    const cz = b.cz
    const rx = b.rx || 0
    const ry = b.ry || 0
    const rz = b.rz || 0

    const cr = b.r ?? 1
    const cg = b.g ?? 1
    const cb = b.b ?? 1

    let m00 = 1, m01 = 0, m02 = 0
    let m10 = 0, m11 = 1, m12 = 0
    let m20 = 0, m21 = 0, m22 = 1

    const rotated = rx !== 0 || ry !== 0 || rz !== 0
    if (rotated) {
      // Intrinsic XYZ rotation matrix = Rx * Ry * Rz
      const ax = Math.cos(rx), bx = Math.sin(rx)
      const ay = Math.cos(ry), by = Math.sin(ry)
      const az = Math.cos(rz), bz = Math.sin(rz)
      const ae = ax * az
      const af = ax * bz
      const be = bx * az
      const bf = bx * bz

      m00 = ay * az
      m01 = -ay * bz
      m02 = by

      m10 = af + be * by
      m11 = ae - bf * by
      m12 = -bx * ay

      m20 = bf - ae * by
      m21 = be + af * by
      m22 = ax * ay
    }

    const writeQuad = (
      x0, y0, z0, u0, v0,
      x1, y1, z1, u1, v1,
      x2, y2, z2, u2, v2,
      x3, y3, z3, u3, v3,
      lnx, lny, lnz,
      shade
    ) => {
      const base = vCursor
      const nx = rotated ? m00 * lnx + m01 * lny + m02 * lnz : lnx
      const ny = rotated ? m10 * lnx + m11 * lny + m12 * lnz : lny
      const nz = rotated ? m20 * lnx + m21 * lny + m22 * lnz : lnz

      const pts = [
        [x0, y0, z0, u0, v0],
        [x1, y1, z1, u1, v1],
        [x2, y2, z2, u2, v2],
        [x3, y3, z3, u3, v3],
      ]
      const fr = cr * shade
      const fg = cg * shade
      const fb = cb * shade

      for (let k = 0; k < 4; k += 1) {
        const lx = pts[k][0]
        const ly = pts[k][1]
        const lz = pts[k][2]
        const p = (base + k) * 3
        const up = (base + k) * 2

        if (rotated) {
          positions[p] = cx + m00 * lx + m01 * ly + m02 * lz
          positions[p + 1] = cy + m10 * lx + m11 * ly + m12 * lz
          positions[p + 2] = cz + m20 * lx + m21 * ly + m22 * lz
        } else {
          positions[p] = cx + lx
          positions[p + 1] = cy + ly
          positions[p + 2] = cz + lz
        }

        normals[p] = nx
        normals[p + 1] = ny
        normals[p + 2] = nz
        colors[p] = fr
        colors[p + 1] = fg
        colors[p + 2] = fb
        uvs[up] = pts[k][3]
        uvs[up + 1] = pts[k][4]
      }

      indices[iCursor] = base
      indices[iCursor + 1] = base + 1
      indices[iCursor + 2] = base + 2
      indices[iCursor + 3] = base
      indices[iCursor + 4] = base + 2
      indices[iCursor + 5] = base + 3
      vCursor += 4
      iCursor += 6
    }

    const sxT = b.sx * invTile
    const syT = b.sy * invTile
    const szT = b.sz * invTile

    // +Y Top (CCW normal +Y)
    writeQuad(
      -hx, hy, hz, 0, szT,
      hx, hy, hz, sxT, szT,
      hx, hy, -hz, sxT, 0,
      -hx, hy, -hz, 0, 0,
      0, 1, 0,
      0.88
    )
    // -Y Underside (CCW normal -Y)
    writeQuad(
      -hx, -hy, -hz, 0, 0,
      hx, -hy, -hz, sxT, 0,
      hx, -hy, hz, sxT, szT,
      -hx, -hy, hz, 0, szT,
      0, -1, 0,
      0.94
    )
    // +Z Front
    writeQuad(
      -hx, -hy, hz, 0, 0,
      hx, -hy, hz, sxT, 0,
      hx, hy, hz, sxT, syT,
      -hx, hy, hz, 0, syT,
      0, 0, 1,
      1.0
    )
    // -Z Back
    writeQuad(
      hx, -hy, -hz, sxT, 0,
      -hx, -hy, -hz, 0, 0,
      -hx, hy, -hz, 0, syT,
      hx, hy, -hz, sxT, syT,
      0, 0, -1,
      1.0
    )
    // +X Right
    writeQuad(
      hx, -hy, hz, szT, 0,
      hx, -hy, -hz, 0, 0,
      hx, hy, -hz, 0, syT,
      hx, hy, hz, szT, syT,
      1, 0, 0,
      0.96
    )
    // -X Left
    writeQuad(
      -hx, -hy, -hz, 0, 0,
      -hx, -hy, hz, szT, 0,
      -hx, hy, hz, szT, syT,
      -hx, hy, -hz, 0, syT,
      -1, 0, 0,
      0.96
    )
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function selectEvenLines(lines, targetCount, rng) {
  if (lines.length === 0) return []
  const count = Math.min(lines.length, Math.max(1, targetCount))
  if (count === lines.length) return lines.slice()

  // Pick evenly spread structural girder axes with slight deterministic jitter
  const selected = []
  const step = lines.length / count
  const used = new Set()
  for (let i = 0; i < count; i += 1) {
    let idx = Math.floor((i + 0.5) * step + (rng() - 0.5) * 0.45)
    idx = clamp(idx, 0, lines.length - 1)
    while (used.has(idx) && idx < lines.length - 1) idx += 1
    while (used.has(idx) && idx > 0) idx -= 1
    if (!used.has(idx)) {
      used.add(idx)
      selected.push(lines[idx])
    }
  }
  return selected.sort((a, b) => a - b)
}

/**
 * Emits flanged sheet-metal drive-cleat joints & steel trapeze hanger brackets
 * anchoring an X-axis or Z-axis duct up to the concrete soffit / rib underside.
 */
function emitDuctRunWithSupports({
  axis, // 'x' or 'z'
  start,
  end,
  fixedCoord,
  yBottom,
  width,
  height,
  soffitY,
  supportTopY,
  ribBottomY = 3.38,
  oddRowZs = null,
  ribHalf = 0.21,
  rng,
  ductBoxes,
  hardwareBoxes,
  tintDuct,
  addJointFlanges = true,
  addHangers = true,
}) {
  const len = end - start
  if (len <= 0.08) return

  const cy = yBottom + height * 0.5
  const yTop = yBottom + height
  const centerAlong = (start + end) * 0.5

  if (axis === 'x') {
    ductBoxes.push({
      cx: centerAlong,
      cy,
      cz: fixedCoord,
      sx: len,
      sy: height,
      sz: width,
      r: tintDuct[0],
      g: tintDuct[1],
      b: tintDuct[2],
    })
  } else {
    ductBoxes.push({
      cx: fixedCoord,
      cy,
      cz: centerAlong,
      sx: width,
      sy: height,
      sz: len,
      r: tintDuct[0],
      g: tintDuct[1],
      b: tintDuct[2],
    })
  }

  const canPlaceSoffitAnchorAtZ = (zPos, halfSize = 0.036) => {
    if (!Array.isArray(oddRowZs) || (supportTopY ?? soffitY) <= ribBottomY + 0.01) {
      return true
    }
    for (let k = 0; k < oddRowZs.length; k += 1) {
      if (Math.abs(zPos - oddRowZs[k].z) < ribHalf + halfSize + 0.02) {
        return false
      }
    }
    return true
  }

  // Intermediate standing-seam drive-cleat flange collars & trapeze steel hangers
  const jointStep = 2.35
  const joints = Math.floor(len / jointStep)
  if (addJointFlanges && joints >= 1) {
    for (let j = 1; j <= joints; j += 1) {
      const posAlong = start + (len * j) / (joints + 1)
      const flangeThick = 0.044
      const flangeOver = 0.052
      const rShift = (rng() - 0.5) * 0.06

      // Bolted flange rim wrapping around duct section with corner gusset clips
      if (axis === 'x') {
        hardwareBoxes.push({
          cx: posAlong,
          cy,
          cz: fixedCoord,
          sx: flangeThick,
          sy: height + flangeOver,
          sz: width + flangeOver,
          r: 0.92 + rShift,
          g: 0.92,
          b: 0.92 - rShift,
        })
        hardwareBoxes.push({
          cx: posAlong,
          cy,
          cz: fixedCoord,
          sx: flangeThick + 0.022,
          sy: height + flangeOver * 0.55,
          sz: width + flangeOver * 0.55,
          r: 0.84,
          g: 0.84,
          b: 0.86,
        })
      } else {
        hardwareBoxes.push({
          cx: fixedCoord,
          cy,
          cz: posAlong,
          sx: width + flangeOver,
          sy: height + flangeOver,
          sz: flangeThick,
          r: 0.92 + rShift,
          g: 0.92,
          b: 0.92 - rShift,
        })
        hardwareBoxes.push({
          cx: fixedCoord,
          cy,
          cz: posAlong,
          sx: width + flangeOver * 0.55,
          sy: height + flangeOver * 0.55,
          sz: flangeThick + 0.022,
          r: 0.84,
          g: 0.84,
          b: 0.86,
        })
      }

      // Steel trapeze angle-iron cradle, twin threaded rods & soffit anchor foot plates
      if (addHangers && (j % 2 === 1 || joints <= 2)) {
        const strapY = Math.max(CEILING_VENT_CLEARANCE_MIN_Y, yBottom - 0.024)
        const rodTop = supportTopY ?? soffitY
        const rodH = rodTop - strapY
        if (rodH > 0.04) {
          const halfSpan = width * 0.5 + 0.055
          const rodCy = strapY + rodH * 0.5
          const plateY = rodTop - 0.007

          if (axis === 'x') {
            hardwareBoxes.push({
              cx: posAlong,
              cy: strapY,
              cz: fixedCoord,
              sx: 0.055,
              sy: 0.03,
              sz: width + 0.14,
              r: 0.85,
              g: 0.85,
              b: 0.86,
            })
            hardwareBoxes.push(
              {
                cx: posAlong,
                cy: rodCy,
                cz: fixedCoord - halfSpan,
                sx: 0.022,
                sy: rodH,
                sz: 0.022,
                r: 0.8,
                g: 0.8,
                b: 0.82,
              },
              {
                cx: posAlong,
                cy: rodCy,
                cz: fixedCoord + halfSpan,
                sx: 0.022,
                sy: rodH,
                sz: 0.022,
                r: 0.8,
                g: 0.8,
                b: 0.82,
              }
            )
            if (canPlaceSoffitAnchorAtZ(fixedCoord - halfSpan)) {
              hardwareBoxes.push({
                cx: posAlong,
                cy: plateY,
                cz: fixedCoord - halfSpan,
                sx: 0.068,
                sy: 0.014,
                sz: 0.068,
                r: 0.78,
                g: 0.78,
                b: 0.8,
              })
            }
            if (canPlaceSoffitAnchorAtZ(fixedCoord + halfSpan)) {
              hardwareBoxes.push({
                cx: posAlong,
                cy: plateY,
                cz: fixedCoord + halfSpan,
                sx: 0.068,
                sy: 0.014,
                sz: 0.068,
                r: 0.78,
                g: 0.78,
                b: 0.8,
              })
            }
          } else {
            hardwareBoxes.push({
              cx: fixedCoord,
              cy: strapY,
              cz: posAlong,
              sx: width + 0.14,
              sy: 0.03,
              sz: 0.055,
              r: 0.85,
              g: 0.85,
              b: 0.86,
            })
            hardwareBoxes.push(
              {
                cx: fixedCoord - halfSpan,
                cy: rodCy,
                cz: posAlong,
                sx: 0.022,
                sy: rodH,
                sz: 0.022,
                r: 0.8,
                g: 0.8,
                b: 0.82,
              },
              {
                cx: fixedCoord + halfSpan,
                cy: rodCy,
                cz: posAlong,
                sx: 0.022,
                sy: rodH,
                sz: 0.022,
                r: 0.8,
                g: 0.8,
                b: 0.82,
              }
            )
            if (canPlaceSoffitAnchorAtZ(posAlong)) {
              hardwareBoxes.push(
                {
                  cx: fixedCoord - halfSpan,
                  cy: plateY,
                  cz: posAlong,
                  sx: 0.068,
                  sy: 0.014,
                  sz: 0.068,
                  r: 0.78,
                  g: 0.78,
                  b: 0.8,
                },
                {
                  cx: fixedCoord + halfSpan,
                  cy: plateY,
                  cz: posAlong,
                  sx: 0.068,
                  sy: 0.014,
                  sz: 0.068,
                  r: 0.78,
                  g: 0.78,
                  b: 0.8,
                }
              )
            }
          }
        }
      }
    }
  } else if (addHangers && len > 0.7 && yTop < soffitY - 0.02) {
    // Short branch/drop run gets a single center trapeze hanger
    const strapY = Math.max(CEILING_VENT_CLEARANCE_MIN_Y, yBottom - 0.024)
    const rodTop = supportTopY ?? soffitY
    const rodH = rodTop - strapY
    if (rodH > 0.04) {
      const halfSpan = width * 0.5 + 0.045
      const rodCy = strapY + rodH * 0.5
      const plateY = rodTop - 0.007
      if (axis === 'x') {
        hardwareBoxes.push(
          { cx: centerAlong, cy: strapY, cz: fixedCoord, sx: 0.048, sy: 0.028, sz: width + 0.11, r: 0.84, g: 0.84, b: 0.85 },
          { cx: centerAlong, cy: rodCy, cz: fixedCoord - halfSpan, sx: 0.022, sy: rodH, sz: 0.022, r: 0.8, g: 0.8, b: 0.82 },
          { cx: centerAlong, cy: rodCy, cz: fixedCoord + halfSpan, sx: 0.022, sy: rodH, sz: 0.022, r: 0.8, g: 0.8, b: 0.82 }
        )
        if (canPlaceSoffitAnchorAtZ(fixedCoord - halfSpan)) {
          hardwareBoxes.push({ cx: centerAlong, cy: plateY, cz: fixedCoord - halfSpan, sx: 0.064, sy: 0.014, sz: 0.064, r: 0.78, g: 0.78, b: 0.8 })
        }
        if (canPlaceSoffitAnchorAtZ(fixedCoord + halfSpan)) {
          hardwareBoxes.push({ cx: centerAlong, cy: plateY, cz: fixedCoord + halfSpan, sx: 0.064, sy: 0.014, sz: 0.064, r: 0.78, g: 0.78, b: 0.8 })
        }
      } else {
        hardwareBoxes.push(
          { cx: fixedCoord, cy: strapY, cz: centerAlong, sx: width + 0.11, sy: 0.028, sz: 0.048, r: 0.84, g: 0.84, b: 0.85 },
          { cx: fixedCoord - halfSpan, cy: rodCy, cz: centerAlong, sx: 0.022, sy: rodH, sz: 0.022, r: 0.8, g: 0.8, b: 0.82 },
          { cx: fixedCoord + halfSpan, cy: rodCy, cz: centerAlong, sx: 0.022, sy: rodH, sz: 0.022, r: 0.8, g: 0.8, b: 0.82 }
        )
        if (canPlaceSoffitAnchorAtZ(centerAlong)) {
          hardwareBoxes.push(
            { cx: fixedCoord - halfSpan, cy: plateY, cz: centerAlong, sx: 0.064, sy: 0.014, sz: 0.064, r: 0.78, g: 0.78, b: 0.8 },
            { cx: fixedCoord + halfSpan, cy: plateY, cz: centerAlong, sx: 0.064, sy: 0.014, sz: 0.064, r: 0.78, g: 0.78, b: 0.8 }
          )
        }
      }
    }
  }
}

/**
 * Emits a stepped bolted steel sleeve escutcheon collar mounted flush on a concrete beam
 * or perimeter spandrel face so duct penetration looks structurally sealed with zero intersection.
 */
function emitBeamSleeveCollar({
  axis,
  facePos,
  outwardNormal, // -1 or +1 pointing into bay
  fixedCoord,
  yBottom,
  width,
  height,
  hardwareBoxes,
}) {
  const depth = 0.052
  const escutcheonDepth = 0.018
  const escutcheonHeight = height + 0.1
  const cxOuter = facePos + outwardNormal * (escutcheonDepth * 0.5)
  const cxSleeve = facePos + outwardNormal * (depth * 0.5)
  const cy = yBottom + height * 0.5
  if (axis === 'x') {
    hardwareBoxes.push(
      {
        cx: cxOuter,
        cy,
        cz: fixedCoord,
        sx: escutcheonDepth,
        sy: escutcheonHeight,
        sz: width + 0.125,
        r: 0.76,
        g: 0.77,
        b: 0.79,
      },
      {
        cx: cxSleeve,
        cy,
        cz: fixedCoord,
        sx: depth,
        sy: height + 0.065,
        sz: width + 0.065,
        r: 0.85,
        g: 0.85,
        b: 0.87,
      }
    )
  } else {
    hardwareBoxes.push(
      {
        cx: fixedCoord,
        cy,
        cz: cxOuter,
        sx: width + 0.125,
        sy: escutcheonHeight,
        sz: escutcheonDepth,
        r: 0.76,
        g: 0.77,
        b: 0.79,
      },
      {
        cx: fixedCoord,
        cy,
        cz: cxSleeve,
        sx: width + 0.065,
        sy: height + 0.065,
        sz: depth,
        r: 0.85,
        g: 0.85,
        b: 0.87,
      }
    )
  }
}

/**
 * Emits a distinct ceiling grille / register (frame, dark recessed throat, louver blades)
 * matching one of 4 architectural designs and 4 weathering/damage conditions,
 * seated flush onto the bottom of its vertical branch plenum drop.
 */
function emitCeilingVentAssembly({
  cx,
  cz,
  frameBottomY,
  plenumTopY,
  designType,
  condition,
  yaw90,
  rng,
  ductBoxes,
  hardwareBoxes,
  cavityBoxes,
  ventMetadata,
  cellRow,
  cellCol,
  connectedTrunkId,
}) {
  // Base dimensions before optional 90-deg hallway orientation swap
  let baseSx = 0.92
  let baseSz = 0.54
  let bladeCount = 6
  if (designType === 'square_diffuser') {
    baseSx = 0.54
    baseSz = 0.54
    bladeCount = 5
  } else if (designType === 'linear_slot') {
    baseSx = 1.04
    baseSz = 0.36
    bladeCount = 3
  } else if (designType === 'damper_hatch') {
    baseSx = 0.78
    baseSz = 0.48
    bladeCount = 5
  }

  const sx = yaw90 ? baseSz : baseSx
  const sz = yaw90 ? baseSx : baseSz

  // Ensure vertical clearance strictly >= 3.06m
  const safeFrameBottomY = Math.max(CEILING_VENT_CLEARANCE_MIN_Y + 0.02, frameBottomY)
  const frameH = 0.04
  const plenumH = Math.max(0.04, plenumTopY - (safeFrameBottomY + frameH))
  const plenumBottomY = safeFrameBottomY + frameH

  // Condition-based weathering tint (subtle industrial patina, never cartoonishly orange)
  const isCorroded = condition === 'corroded'
  const isDamaged = condition === 'damaged'
  const isDusty = condition === 'dusty'
  const frameTint = isCorroded
    ? [0.85, 0.78, 0.72]
    : isDusty
      ? [0.77, 0.76, 0.74]
      : isDamaged
        ? [0.84, 0.81, 0.78]
        : [0.92, 0.92, 0.94]

  // 1. Galvanized upper plenum boot connecting directly upward to branch duct / soffit
  ductBoxes.push({
    cx,
    cy: plenumBottomY + plenumH * 0.5,
    cz,
    sx: Math.max(0.28, sx - 0.07),
    sy: plenumH,
    sz: Math.max(0.26, sz - 0.07),
    r: isCorroded ? 0.87 : 0.92,
    g: isCorroded ? 0.83 : 0.91,
    b: isCorroded ? 0.79 : 0.9,
  })

  // 2. Deep dark matte plenum cavity box recessed safely above louver blades (prevents Z-fighting)
  const cavityH = Math.min(0.14, Math.max(0.03, plenumH * 0.78))
  cavityBoxes.push({
    cx,
    cy: safeFrameBottomY + 0.022 + cavityH * 0.5,
    cz,
    sx: Math.max(0.2, sx - 0.115),
    sy: cavityH,
    sz: Math.max(0.2, sz - 0.115),
  })

  // 3. Flanged outer perimeter frame (4 rim strips leaving central louver throat OPEN!)
  const rimThick = 0.048
  const rimCy = safeFrameBottomY + frameH * 0.5
  const frameSag = isDamaged || isCorroded ? (rng() - 0.5) * 0.03 : 0

  hardwareBoxes.push(
    {
      cx,
      cy: rimCy,
      cz: cz - sz * 0.5 + rimThick * 0.5,
      sx,
      sy: frameH,
      sz: rimThick,
      rx: frameSag * 0.4,
      r: frameTint[0],
      g: frameTint[1],
      b: frameTint[2],
    },
    {
      cx,
      cy: rimCy,
      cz: cz + sz * 0.5 - rimThick * 0.5,
      sx,
      sy: frameH,
      sz: rimThick,
      rx: -frameSag * 0.4,
      r: frameTint[0],
      g: frameTint[1],
      b: frameTint[2],
    },
    {
      cx: cx - sx * 0.5 + rimThick * 0.5,
      cy: rimCy,
      cz,
      sx: rimThick,
      sy: frameH,
      sz: sz - rimThick * 2,
      r: frameTint[0],
      g: frameTint[1],
      b: frameTint[2],
    },
    {
      cx: cx + sx * 0.5 - rimThick * 0.5,
      cy: rimCy,
      cz,
      sx: rimThick,
      sy: frameH,
      sz: sz - rimThick * 2,
      r: frameTint[0],
      g: frameTint[1],
      b: frameTint[2],
    }
  )

  // Corner mounting fastener tabs / screw bosses on frame corners
  const cornerX = sx * 0.5 - 0.026
  const cornerZ = sz * 0.5 - 0.026
  for (const sxSign of [-1, 1]) {
    for (const szSign of [-1, 1]) {
      hardwareBoxes.push({
        cx: cx + sxSign * cornerX,
        cy: safeFrameBottomY + 0.008,
        cz: cz + szSign * cornerZ,
        sx: 0.024,
        sy: 0.012,
        sz: 0.024,
        r: 0.82,
        g: 0.83,
        b: 0.85,
      })
    }
  }

  // Optional center structural mullion bar for double-louver or damper hatch
  if (designType === 'double_louver' || designType === 'damper_hatch') {
    hardwareBoxes.push({
      cx,
      cy: rimCy + 0.004,
      cz,
      sx: yaw90 ? sx - rimThick * 2 : 0.026,
      sy: frameH * 0.85,
      sz: yaw90 ? 0.026 : sz - rimThick * 2,
      r: frameTint[0] * 0.94,
      g: frameTint[1] * 0.94,
      b: frameTint[2] * 0.94,
    })
  }

  // Damper balancing lever tab & housing quadrant protruding slightly from rim side on damper_hatch
  if (designType === 'damper_hatch') {
    hardwareBoxes.push({
      cx: cx + (yaw90 ? 0 : sx * 0.5 + 0.02),
      cy: rimCy + 0.02,
      cz: cz + (yaw90 ? sz * 0.5 + 0.02 : 0),
      sx: yaw90 ? 0.078 : 0.036,
      sy: 0.022,
      sz: yaw90 ? 0.036 : 0.078,
      ry: 0.35,
      r: 0.86,
      g: 0.78,
      b: 0.71,
    })
  }

  // 4. Individual angled louver blades (with missing/bent blades on damaged & corroded vents)
  const innerSx = sx - rimThick * 2 - 0.01
  const innerSz = sz - rimThick * 2 - 0.01
  const spanAlongBlades = yaw90 ? innerSz : innerSx
  const missingIndexA =
    isDamaged || isCorroded ? Math.floor(rng() * bladeCount) : -1
  const missingIndexB =
    isCorroded && bladeCount >= 3
      ? (missingIndexA + 1) % bladeCount
      : isDamaged && rng() < 0.45
        ? Math.floor(rng() * bladeCount)
        : -1

  let renderedBlades = 0
  let missingBlades = 0

  for (let b = 0; b < bladeCount; b += 1) {
    if (b === missingIndexA || b === missingIndexB) {
      missingBlades += 1
      continue
    }

    const t = (b + 0.5) / bladeCount - 0.5
    const offset = t * spanAlongBlades
    const isBent =
      (isDamaged || isCorroded) &&
      (Math.abs(b - missingIndexA) === 1 || rng() < 0.32)

    const basePitch = designType === 'square_diffuser' ? (t < 0 ? 0.52 : -0.52) : 0.56
    const bendPitch = isBent ? (rng() - 0.5) * 0.45 : 0
    const bendSkew = isBent ? (rng() - 0.5) * 0.16 : 0
    const dropSag = isBent ? -0.014 : 0

    const bladeR = isBent && isCorroded ? 0.92 : frameTint[0] * (isDusty ? 0.92 : 1.0)
    const bladeG = isBent && isCorroded ? 0.7 : frameTint[1]
    const bladeB = isBent && isCorroded ? 0.58 : frameTint[2]

    if (yaw90) {
      hardwareBoxes.push({
        cx,
        cy: rimCy + 0.002 + dropSag,
        cz: cz + offset,
        sx: innerSx * (isBent && isCorroded ? 0.86 : 1),
        sy: 0.012,
        sz: 0.048,
        rx: basePitch + bendPitch,
        ry: bendSkew,
        rz: isBent ? (rng() - 0.5) * 0.14 : 0,
        r: bladeR,
        g: bladeG,
        b: bladeB,
      })
    } else {
      hardwareBoxes.push({
        cx: cx + offset,
        cy: rimCy + 0.002 + dropSag,
        cz,
        sx: 0.048,
        sy: 0.012,
        sz: innerSz * (isBent && isCorroded ? 0.86 : 1),
        rx: isBent ? (rng() - 0.5) * 0.14 : 0,
        ry: bendSkew,
        rz: basePitch + bendPitch,
        r: bladeR,
        g: bladeG,
        b: bladeB,
      })
    }
    renderedBlades += 1
  }

  ventMetadata.push({
    cellRow,
    cellCol,
    cx,
    cz,
    sx,
    sz,
    frameBottomY: safeFrameBottomY,
    plenumTopY,
    designType,
    condition,
    renderedBlades,
    missingBlades,
    connectedTrunkId,
    connectedToDuct: true,
  })
}

/**
 * Builds low-profile rectangular industrial ventilation ducts, joints/flanges,
 * steel hangers, beam-sleeve collars, elbows, reducers, and varied damaged/intact
 * ceiling vents integrated strictly into the upper concrete ceiling bays (>= 3.06m).
 */
export function buildCeilingVents(
  maze,
  {
    soffitY = 3.6,
    beamBottomY = 3.04,
    beamWidth = 0.78,
    ribBottomY = 3.38,
    ribWidth = 0.42,
    worldSeed = 0,
    qualityPreset = 'high',
  } = {}
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return null
  }
  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) {
    return null
  }

  const topLeft = gridToWorld(0, 0, maze)
  const bottomRight = gridToWorld(rows - 1, cols - 1, maze)
  if (!topLeft || !bottomRight) {
    return null
  }

  const seed = ((Number(worldSeed) || 0) * 2654435761 + rows * 37 + cols * 91) >>> 0
  const rng = createRng(seed)

  const floorWidth = cols * CELL_SIZE
  const floorDepth = rows * CELL_SIZE
  const centerX = (topLeft.x + bottomRight.x) * 0.5
  const centerZ = (topLeft.z + bottomRight.z) * 0.5

  // Inner clear limits inside perimeter spandrels (exact match to buildMazeCeiling.js)
  const innerSpanX = floorWidth - 0.7
  const innerSpanZ = floorDepth - 0.7
  const innerMinX = centerX - innerSpanX * 0.5
  const innerMaxX = centerX + innerSpanX * 0.5
  const innerMinZ = centerZ - innerSpanZ * 0.5
  const innerMaxZ = centerZ + innerSpanZ * 0.5

  const beamHalf = beamWidth * 0.5 // 0.39m
  const ribHalf = ribWidth * 0.5 // 0.21m

  const evenRowZs = []
  for (let r = 2; r <= rows - 3; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (wp) evenRowZs.push(wp.z)
  }

  const evenColXs = []
  for (let c = 2; c <= cols - 3; c += 2) {
    const wp = gridToWorld(0, c, maze)
    if (wp) evenColXs.push(wp.x)
  }

  const oddRowZs = []
  for (let r = 1; r <= rows - 2; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (wp) oddRowZs.push({ r, z: wp.z })
  }

  // Span intervals between perpendicular even girders (strictly outside concrete girders)
  const xBaySpans = []
  {
    let cur = innerMinX
    for (let i = 0; i < evenColXs.length; i += 1) {
      xBaySpans.push([cur, evenColXs[i] - beamHalf, true, true])
      cur = evenColXs[i] + beamHalf
    }
    xBaySpans.push([cur, innerMaxX, evenColXs.length > 0, true])
  }

  const zBaySpans = []
  {
    let cur = innerMinZ
    for (let i = 0; i < evenRowZs.length; i += 1) {
      zBaySpans.push([cur, evenRowZs[i] - beamHalf, i > 0, true])
      cur = evenRowZs[i] + beamHalf
    }
    zBaySpans.push([cur, innerMaxZ, evenRowZs.length > 0, true])
  }

  const ductBoxes = []
  const hardwareBoxes = []
  const cavityBoxes = []
  const ventMetadata = []

  // Helper: check if an X-range stays strictly clear of all even-node drop panels (evenColX ± 0.83)
  // X-trunks sit at y = 3.12..3.35 (< 3.36 dropPanelBottom AND < 3.38 ribBottom), so zero overlap!
  const mainTrunkBottomY = Math.max(CEILING_VENT_CLEARANCE_MIN_Y + 0.05, beamBottomY + 0.08) // 3.12m
  const mainTrunkH = 0.23 // 3.12 .. 3.35m (strictly below 3.36m drop panel & 3.38m Z-ribs!)
  const mainTrunkW = 0.52

  // -------------------------------------------------------------------------
  // 1. Primary East-West HVAC Main Trunks Running Along Girder Flanks
  // -------------------------------------------------------------------------
  const trunkTargetCount =
    rows <= 11 ? 2 : rows <= 15 ? 3 : rows <= 21 ? 4 : 5
  const chosenEvenRowZs = selectEvenLines(evenRowZs, trunkTargetCount, rng)
  const xTrunks = []

  for (let tIdx = 0; tIdx < chosenEvenRowZs.length; tIdx += 1) {
    const girderZ = chosenEvenRowZs[tIdx]
    // Alternate flank side (-1 North vs +1 South of concrete girder)
    const side = (tIdx % 2 === 0 ? 1 : -1) * (rng() < 0.2 ? -1 : 1)
    const trunkZ = girderZ + side * (beamHalf + 0.28 + mainTrunkW * 0.5) // beamHalf + 0.54 = girder ± 0.93m
    const trunkId = `x-trunk-${tIdx}`
    const tint = [
      0.92 + (rng() - 0.5) * 0.08,
      0.92 + (rng() - 0.5) * 0.06,
      0.94 + (rng() - 0.5) * 0.06,
    ]

    xTrunks.push({
      id: trunkId,
      girderZ,
      side,
      z: trunkZ,
      yBottom: mainTrunkBottomY,
      yTop: mainTrunkBottomY + mainTrunkH,
      height: mainTrunkH,
      width: mainTrunkW,
    })

    // Emit bay-segmented continuous trunk spans with girder sleeve collars & cantilever brackets
    for (let s = 0; s < xBaySpans.length; s += 1) {
      const [xA, xB] = xBaySpans[s]
      emitDuctRunWithSupports({
        axis: 'x',
        start: xA,
        end: xB,
        fixedCoord: trunkZ,
        yBottom: mainTrunkBottomY,
        width: mainTrunkW,
        height: mainTrunkH,
        soffitY,
        supportTopY: soffitY,
        ribBottomY,
        oddRowZs,
        ribHalf,
        rng,
        ductBoxes,
        hardwareBoxes,
        tintDuct: tint,
      })

      // Flush bolted steel sleeve collars against both bay boundary faces (spandrel or girder)
      emitBeamSleeveCollar({
        axis: 'x',
        facePos: xA,
        outwardNormal: 1,
        fixedCoord: trunkZ,
        yBottom: mainTrunkBottomY,
        width: mainTrunkW,
        height: mainTrunkH,
        hardwareBoxes,
      })
      emitBeamSleeveCollar({
        axis: 'x',
        facePos: xB,
        outwardNormal: -1,
        fixedCoord: trunkZ,
        yBottom: mainTrunkBottomY,
        width: mainTrunkW,
        height: mainTrunkH,
        hardwareBoxes,
      })

      // Lateral steel cantilever angle brackets tying duct side back to concrete girder web
      const webFaceZ = girderZ + side * beamHalf
      const bracketLen = Math.abs(trunkZ - side * (mainTrunkW * 0.5) - webFaceZ)
      const bracketMidZ = webFaceZ + side * (bracketLen * 0.5)
      if (bracketLen > 0.05) {
        const spanMidX = (xA + xB) * 0.5
        hardwareBoxes.push({
          cx: spanMidX,
          cy: mainTrunkBottomY + mainTrunkH * 0.5,
          cz: bracketMidZ,
          sx: 0.06,
          sy: 0.05,
          sz: bracketLen,
          r: 0.82,
          g: 0.82,
          b: 0.85,
        })
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Secondary North-South Collector Trunks with Stepped Under-Rib Offsets
  // -------------------------------------------------------------------------
  const colTargetCount =
    cols <= 11 ? 1 : cols <= 15 ? 2 : cols <= 21 ? 3 : 4
  const chosenEvenColXs = selectEvenLines(evenColXs, colTargetCount, rng)
  const zTrunkW = 0.44
  const zTrunkH = 0.22
  const zTrunks = []

  for (let cIdx = 0; cIdx < chosenEvenColXs.length; cIdx += 1) {
    const girderX = chosenEvenColXs[cIdx]
    const side = cIdx % 2 === 0 ? -1 : 1
    const trunkX = girderX + side * (beamHalf + 0.28 + zTrunkW * 0.5)
    const trunkId = `z-trunk-${cIdx}`
    const tint = [
      0.9 + (rng() - 0.5) * 0.08,
      0.91 + (rng() - 0.5) * 0.06,
      0.93 + (rng() - 0.5) * 0.06,
    ]
    zTrunks.push({ id: trunkId, x: trunkX, width: zTrunkW })

    for (let s = 0; s < zBaySpans.length; s += 1) {
      const [zA, zB] = zBaySpans[s]
      // Check if an oddRowZ secondary coffer rib (y=3.38..3.60) crosses inside this bay
      const ribInBay = oddRowZs.find((rz) => rz.z > zA + 0.5 && rz.z < zB - 0.5)

      if (!ribInBay) {
        emitDuctRunWithSupports({
          axis: 'z',
          start: zA,
          end: zB,
          fixedCoord: trunkX,
          yBottom: 3.12,
          width: zTrunkW,
          height: zTrunkH,
          soffitY,
          supportTopY: soffitY,
          ribBottomY,
          oddRowZs,
          ribHalf,
          rng,
          ductBoxes,
          hardwareBoxes,
          tintDuct: tint,
        })
      } else {
        // Low sleeve entry passing cleanly below drop panels (y = 3.12..3.34m < 3.36m drop panel bottom)
        // then rising in open sub-coffer, stepping cleanly under oddRowZ rib (y = 3.11..3.33m < 3.38m rib)
        const dropZoneZ0 = zA + 0.56 // 0.39 + 0.56 = 0.95m > 0.83m drop panel
        const dropZoneZ1 = zB - 0.56
        const ribClearZ0 = ribInBay.z - (ribHalf + 0.12)
        const ribClearZ1 = ribInBay.z + (ribHalf + 0.12)
        const rampLen = 0.24

        // North beam exit low run (under drop panel)
        emitDuctRunWithSupports({
          axis: 'z',
          start: zA,
          end: Math.min(ribClearZ0, dropZoneZ0),
          fixedCoord: trunkX,
          yBottom: 3.12,
          width: zTrunkW,
          height: zTrunkH,
          soffitY,
          supportTopY: soffitY,
          ribBottomY,
          oddRowZs,
          ribHalf,
          rng,
          ductBoxes,
          hardwareBoxes,
          tintDuct: tint,
          addJointFlanges: false,
          addHangers: true,
        })

        // High mid-coffer run (between drop panel and rib) if sufficient room
        const highN0 = dropZoneZ0 + rampLen
        const highN1 = ribClearZ0 - rampLen
        if (highN1 > highN0 + 0.35) {
          ductBoxes.push({
            cx: trunkX,
            cy: 3.17 + zTrunkH * 0.5,
            cz: (dropZoneZ0 + highN0) * 0.5,
            sx: zTrunkW,
            sy: zTrunkH * 0.94,
            sz: Math.hypot(rampLen, 0.1),
            rx: -0.36,
            r: tint[0] * 0.96,
            g: tint[1] * 0.96,
            b: tint[2] * 0.96,
          })
          emitDuctRunWithSupports({
            axis: 'z',
            start: highN0,
            end: highN1,
            fixedCoord: trunkX,
            yBottom: 3.22,
            width: zTrunkW,
            height: zTrunkH,
            soffitY,
            supportTopY: soffitY,
            ribBottomY,
            oddRowZs,
            ribHalf,
            rng,
            ductBoxes,
            hardwareBoxes,
            tintDuct: tint,
          })
          ductBoxes.push({
            cx: trunkX,
            cy: 3.165 + zTrunkH * 0.5,
            cz: (highN1 + ribClearZ0) * 0.5,
            sx: zTrunkW,
            sy: zTrunkH * 0.94,
            sz: Math.hypot(rampLen, 0.11),
            rx: 0.37,
            r: tint[0] * 0.95,
            g: tint[1] * 0.95,
            b: tint[2] * 0.95,
          })
        } else {
          emitDuctRunWithSupports({
            axis: 'z',
            start: dropZoneZ0,
            end: ribClearZ0,
            fixedCoord: trunkX,
            yBottom: 3.12,
            width: zTrunkW,
            height: zTrunkH,
            soffitY,
            supportTopY: soffitY,
            ribBottomY,
            oddRowZs,
            ribHalf,
            rng,
            ductBoxes,
            hardwareBoxes,
            tintDuct: tint,
          })
        }

        // Under-rib low pass section (y = 3.11 .. 3.33m, strictly below ribBottomY = 3.38m)
        emitDuctRunWithSupports({
          axis: 'z',
          start: ribClearZ0,
          end: ribClearZ1,
          fixedCoord: trunkX,
          yBottom: 3.11,
          width: zTrunkW,
          height: zTrunkH,
          soffitY,
          supportTopY: ribBottomY,
          ribBottomY,
          oddRowZs,
          ribHalf,
          rng,
          ductBoxes,
          hardwareBoxes,
          tintDuct: tint,
          addJointFlanges: false,
          addHangers: true,
        })

        // High South sub-coffer & low beam entry under drop panel
        const highS0 = ribClearZ1 + rampLen
        const highS1 = dropZoneZ1 - rampLen
        if (highS1 > highS0 + 0.35) {
          ductBoxes.push({
            cx: trunkX,
            cy: 3.165 + zTrunkH * 0.5,
            cz: (ribClearZ1 + highS0) * 0.5,
            sx: zTrunkW,
            sy: zTrunkH * 0.94,
            sz: Math.hypot(rampLen, 0.11),
            rx: -0.37,
            r: tint[0] * 0.95,
            g: tint[1] * 0.95,
            b: tint[2] * 0.95,
          })
          emitDuctRunWithSupports({
            axis: 'z',
            start: highS0,
            end: highS1,
            fixedCoord: trunkX,
            yBottom: 3.22,
            width: zTrunkW,
            height: zTrunkH,
            soffitY,
            supportTopY: soffitY,
            ribBottomY,
            oddRowZs,
            ribHalf,
            rng,
            ductBoxes,
            hardwareBoxes,
            tintDuct: tint,
          })
          ductBoxes.push({
            cx: trunkX,
            cy: 3.17 + zTrunkH * 0.5,
            cz: (highS1 + dropZoneZ1) * 0.5,
            sx: zTrunkW,
            sy: zTrunkH * 0.94,
            sz: Math.hypot(rampLen, 0.1),
            rx: 0.36,
            r: tint[0] * 0.96,
            g: tint[1] * 0.96,
            b: tint[2] * 0.96,
          })
        } else {
          emitDuctRunWithSupports({
            axis: 'z',
            start: ribClearZ1,
            end: dropZoneZ1,
            fixedCoord: trunkX,
            yBottom: 3.12,
            width: zTrunkW,
            height: zTrunkH,
            soffitY,
            supportTopY: soffitY,
            ribBottomY,
            oddRowZs,
            ribHalf,
            rng,
            ductBoxes,
            hardwareBoxes,
            tintDuct: tint,
          })
        }

        emitDuctRunWithSupports({
          axis: 'z',
          start: Math.max(ribClearZ1, dropZoneZ1),
          end: zB,
          fixedCoord: trunkX,
          yBottom: 3.12,
          width: zTrunkW,
          height: zTrunkH,
          soffitY,
          supportTopY: soffitY,
          ribBottomY,
          oddRowZs,
          ribHalf,
          rng,
          ductBoxes,
          hardwareBoxes,
          tintDuct: tint,
          addJointFlanges: false,
          addHangers: true,
        })
      }

      emitBeamSleeveCollar({
        axis: 'z',
        facePos: zA,
        outwardNormal: 1,
        fixedCoord: trunkX,
        yBottom: 3.12,
        width: zTrunkW,
        height: zTrunkH,
        hardwareBoxes,
      })
      emitBeamSleeveCollar({
        axis: 'z',
        facePos: zB,
        outwardNormal: -1,
        fixedCoord: trunkX,
        yBottom: 3.12,
        width: zTrunkW,
        height: zTrunkH,
        hardwareBoxes,
      })

      // Tie Z-trunk intersections with X-trunks via stepped flanged cross-plenum manifold + corner gussets
      for (let xIdx = 0; xIdx < xTrunks.length; xIdx += 1) {
        const xt = xTrunks[xIdx]
        if (xt.z >= zA + 0.35 && xt.z <= zB - 0.35) {
          const crossCy = 3.235
          // Central plenum saddle box
          ductBoxes.push({
            cx: trunkX,
            cy: crossCy,
            cz: xt.z,
            sx: zTrunkW + 0.04,
            sy: mainTrunkH + 0.025,
            sz: xt.width + 0.04,
            r: 0.9,
            g: 0.9,
            b: 0.92,
          })
          // Upper and lower bolted manifold lip flanges + four angle gussets
          hardwareBoxes.push(
            {
              cx: trunkX,
              cy: crossCy + mainTrunkH * 0.5 + 0.014,
              cz: xt.z,
              sx: zTrunkW + 0.095,
              sy: 0.022,
              sz: xt.width + 0.095,
              r: 0.84,
              g: 0.84,
              b: 0.86,
            },
            {
              cx: trunkX,
              cy: crossCy - mainTrunkH * 0.5 - 0.014,
              cz: xt.z,
              sx: zTrunkW + 0.095,
              sy: 0.022,
              sz: xt.width + 0.095,
              r: 0.84,
              g: 0.84,
              b: 0.86,
            }
          )
          for (const gxSign of [-1, 1]) {
            for (const gzSign of [-1, 1]) {
              hardwareBoxes.push({
                cx: trunkX + gxSign * (zTrunkW * 0.5 + 0.025),
                cy: crossCy,
                cz: xt.z + gzSign * (xt.width * 0.5 + 0.025),
                sx: 0.042,
                sy: mainTrunkH + 0.04,
                sz: 0.042,
                r: 0.78,
                g: 0.79,
                b: 0.81,
              })
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Branch Takeoffs, Concentric Reducers, Elbows & Connected Ceiling Vents
  // -------------------------------------------------------------------------
  const placedCells = new Set()
  const branchWidth = 0.32
  const branchHeight = 0.2
  const branchBottomY = 3.16 // y = 3.16 .. 3.36m (strictly below 3.36m/3.38m concrete & >= 3.06m floor!)

  const maxVentsPerTrunk =
    cols <= 11 ? 4 : cols <= 15 ? 5 : cols <= 21 ? 6 : 8

  for (let tIdx = 0; tIdx < xTrunks.length; tIdx += 1) {
    const trunk = xTrunks[tIdx]
    const candidates = []

    for (let r = 1; r <= rows - 2; r += 2) {
      const wpRow = gridToWorld(r, 1, maze)
      if (!wpRow) continue
      const dzRow = wpRow.z - trunk.z
      if (Math.sign(dzRow) !== trunk.side || Math.abs(dzRow) > 3.55) {
        continue
      }

      for (let c = 1; c <= cols - 2; c += 2) {
        if (grid[r][c] !== CELL_TYPES.PATH) continue
        const wpCell = gridToWorld(r, c, maze)
        if (!wpCell) continue
        const tooCloseToZTrunk = zTrunks.some((zt) => Math.abs(zt.x - wpCell.x) < 1.25)
        if (tooCloseToZTrunk) continue

        const key = `${r},${c}`
        if (placedCells.has(key)) continue
        candidates.push({ r, c, x: wpCell.x, rowZ: wpRow.z })
      }
    }

    let placedOnTrunk = 0
    for (let i = 0; i < candidates.length && placedOnTrunk < maxVentsPerTrunk; i += 1) {
      const cand = candidates[i]
      if (i % 2 === 1 && candidates.length > maxVentsPerTrunk && rng() < 0.7) {
        continue
      }
      if (rng() < 0.16 && placedOnTrunk > 0) continue

      placedCells.add(`${cand.r},${cand.c}`)
      placedOnTrunk += 1

      // Center vent directly overhead inside the walkable PATH corridor cell's open concrete sub-coffer
      // (1.08m short of oddRowZ rib = 2.92m from girder, well inside [2.0m..3.79m] clear coffer zone)
      const ventCenterZ = cand.rowZ - trunk.side * (1.08 + (rng() - 0.5) * 0.08)
      const useLBranch = rng() < 0.38
      const xOffset = useLBranch ? (rng() < 0.5 ? -0.64 : 0.64) : (rng() - 0.5) * 0.22
      const ventCenterX = clamp(
        cand.x + xOffset,
        cand.x - 1.1,
        cand.x + 1.1
      )
      const takeoffX = cand.x

      // 3a. T-takeoff collar & stepped concentric reducer on main trunk
      const trunkEdgeZ = trunk.z + trunk.side * (trunk.width * 0.5)
      hardwareBoxes.push({
        cx: takeoffX,
        cy: mainTrunkBottomY + mainTrunkH * 0.5,
        cz: trunkEdgeZ + trunk.side * 0.02,
        sx: branchWidth + 0.08,
        sy: branchHeight + 0.06,
        sz: 0.05,
        r: 0.84,
        g: 0.83,
        b: 0.83,
      })

      const reducerLen = 0.14
      const zStart = trunkEdgeZ + trunk.side * 0.03
      const zEnd = ventCenterZ
      const zMin = Math.min(zStart, zEnd)
      const zMax = Math.max(zStart, zEnd)

      ductBoxes.push({
        cx: takeoffX,
        cy: branchBottomY + branchHeight * 0.5,
        cz: zStart + trunk.side * (reducerLen * 0.5),
        sx: branchWidth + 0.06,
        sy: branchHeight + 0.03,
        sz: reducerLen,
        r: 0.89,
        g: 0.89,
        b: 0.9,
      })

      // 3b. Straight Z-branch leg from trunk to vent Z
      if (zMax - zMin > 0.08) {
        emitDuctRunWithSupports({
          axis: 'z',
          start: zMin,
          end: zMax,
          fixedCoord: takeoffX,
          yBottom: branchBottomY,
          width: branchWidth,
          height: branchHeight,
          soffitY,
          supportTopY: soffitY,
          rng,
          ductBoxes,
          hardwareBoxes,
          tintDuct: [0.91, 0.9, 0.9],
          addJointFlanges: false,
          addHangers: false,
        })
      }

      // 3c. Optional 90-deg mitered elbow + short X-branch leg
      if (useLBranch && Math.abs(ventCenterX - takeoffX) > 0.12) {
        const elbowR = 0.04
        hardwareBoxes.push({
          cx: takeoffX,
          cy: branchBottomY + branchHeight * 0.5,
          cz: ventCenterZ,
          sx: branchWidth + elbowR,
          sy: branchHeight + elbowR,
          sz: branchWidth + elbowR,
          r: 0.85,
          g: 0.84,
          b: 0.84,
        })
        const x0 = Math.min(takeoffX, ventCenterX)
        const x1 = Math.max(takeoffX, ventCenterX)
        emitDuctRunWithSupports({
          axis: 'x',
          start: x0,
          end: x1,
          fixedCoord: ventCenterZ,
          yBottom: branchBottomY,
          width: branchWidth,
          height: branchHeight,
          soffitY,
          supportTopY: soffitY,
          rng,
          ductBoxes,
          hardwareBoxes,
          tintDuct: [0.9, 0.9, 0.91],
          addJointFlanges: false,
          addHangers: true,
        })
      }

      // 3d. Select grille design & weathering condition
      const designType =
        GRILLE_DESIGN_TYPES[(placedOnTrunk + tIdx + Math.floor(rng() * 4)) % GRILLE_DESIGN_TYPES.length]
      const condRoll = rng()
      const condition =
        condRoll < 0.28
          ? 'intact'
          : condRoll < 0.54
            ? 'dusty'
            : condRoll < 0.79
              ? 'damaged'
              : 'corroded'

      const isFlushCofferGrille = (cand.r + cand.c + tIdx) % 2 === 0
      // Keep rotated long grilles (yaw90) on branch-underside mounts (<= 3.36m) so they never touch oddRowZ ribs!
      const allowYaw90 = !isFlushCofferGrille || designType === 'square_diffuser'
      const yaw90 = allowYaw90 && useLBranch && designType !== 'square_diffuser'

      const frameBottomY = isFlushCofferGrille ? 3.5 : 3.115
      const plenumTopY = isFlushCofferGrille ? soffitY : branchBottomY + 0.04

      if (isFlushCofferGrille) {
        const riserBottom = branchBottomY
        const riserTop = frameBottomY + 0.05
        ductBoxes.push({
          cx: ventCenterX,
          cy: (riserBottom + riserTop) * 0.5,
          cz: ventCenterZ,
          sx: branchWidth + 0.04,
          sy: riserTop - riserBottom,
          sz: branchWidth + 0.04,
          r: 0.89,
          g: 0.89,
          b: 0.89,
        })
        // Stepped plenum takeoff collar at branch & soffit transition collar above coffer grille
        hardwareBoxes.push(
          {
            cx: ventCenterX,
            cy: branchBottomY + branchHeight * 0.5,
            cz: ventCenterZ,
            sx: branchWidth + 0.08,
            sy: branchHeight + 0.046,
            sz: branchWidth + 0.08,
            r: 0.83,
            g: 0.82,
            b: 0.83,
          },
          {
            cx: ventCenterX,
            cy: frameBottomY + 0.056,
            cz: ventCenterZ,
            sx: branchWidth + 0.11,
            sy: 0.024,
            sz: branchWidth + 0.11,
            r: 0.8,
            g: 0.8,
            b: 0.82,
          }
        )
      }

      emitCeilingVentAssembly({
        cx: ventCenterX,
        cz: ventCenterZ,
        frameBottomY,
        plenumTopY,
        designType,
        condition,
        yaw90,
        rng,
        ductBoxes,
        hardwareBoxes,
        cavityBoxes,
        ventMetadata,
        cellRow: cand.r,
        cellCol: cand.c,
        connectedTrunkId: trunk.id,
      })
    }
  }

  // Fallback guarantee for ultra-narrow grids (if no vents placed above, mount at least 1 connected vent on first trunk)
  if (ventMetadata.length === 0 && xTrunks.length > 0) {
    const trunk = xTrunks[0]
    const fallbackRow = Math.min(rows - 2, Math.max(1, 1))
    const fallbackCol = Math.min(cols - 2, Math.max(1, 1))
    const wp = gridToWorld(fallbackRow, fallbackCol, maze)
    if (wp) {
      const ventCenterZ = trunk.girderZ + trunk.side * 1.36
      emitDuctRunWithSupports({
        axis: 'z',
        start: Math.min(trunk.z, ventCenterZ),
        end: Math.max(trunk.z, ventCenterZ),
        fixedCoord: wp.x,
        yBottom: branchBottomY,
        width: branchWidth,
        height: branchHeight,
        soffitY,
        supportTopY: soffitY,
        rng,
        ductBoxes,
        hardwareBoxes,
        tintDuct: [0.91, 0.9, 0.9],
      })
      emitCeilingVentAssembly({
        cx: wp.x,
        cz: ventCenterZ,
        frameBottomY: 3.115,
        plenumTopY: branchBottomY + 0.04,
        designType: 'double_louver',
        condition: 'damaged',
        yaw90: false,
        rng,
        ductBoxes,
        hardwareBoxes,
        cavityBoxes,
        ventMetadata,
        cellRow: fallbackRow,
        cellCol: fallbackCol,
        connectedTrunkId: trunk.id,
      })
    }
  }

  if (ductBoxes.length === 0) {
    return null
  }

  const metalTex = getGalvanizedMetalTextureSet({ qualityPreset })

  const ductMat = new THREE.MeshStandardMaterial({
    color: CEILING_VENT_PALETTE.ductSteel,
    map: metalTex.map,
    roughnessMap: metalTex.roughnessMap,
    bumpMap: metalTex.bumpMap,
    bumpScale: 0.026,
    roughness: 0.82,
    metalness: 0.60,
    envMapIntensity: 0.56,
    vertexColors: true,
  })

  const hardwareMat = new THREE.MeshStandardMaterial({
    color: CEILING_VENT_PALETTE.hardwareIron,
    map: metalTex.map,
    roughnessMap: metalTex.roughnessMap,
    bumpMap: metalTex.bumpMap,
    bumpScale: 0.028,
    roughness: 0.91,
    metalness: 0.36,
    envMapIntensity: 0.36,
    vertexColors: true,
  })

  const cavityMat = new THREE.MeshStandardMaterial({
    color: CEILING_VENT_PALETTE.cavityVoid,
    roughness: 0.98,
    metalness: 0.04,
    envMapIntensity: 0.06,
  })

  const ventGroup = new THREE.Group()
  ventGroup.name = 'maze-ceiling-vents-group'

  const ductGeo = buildMergedOrientedBoxesGeometry(ductBoxes, 2.0)
  let ductMesh = null
  if (ductGeo) {
    ductMesh = new THREE.Mesh(ductGeo, ductMat)
    ductMesh.name = 'maze-ceiling-ducts'
    ductMesh.castShadow = true
    ductMesh.receiveShadow = true
    ventGroup.add(ductMesh)
  }

  const hardwareGeo = buildMergedOrientedBoxesGeometry(hardwareBoxes, 1.5)
  let ductHardwareMesh = null
  if (hardwareGeo) {
    ductHardwareMesh = new THREE.Mesh(hardwareGeo, hardwareMat)
    ductHardwareMesh.name = 'maze-ceiling-duct-hardware'
    // Small hanger rods, soffit plates, flanges & grille blades contribute negligible visible shadow silhouette
    ductHardwareMesh.castShadow = false
    ductHardwareMesh.receiveShadow = true
    ventGroup.add(ductHardwareMesh)
  }

  const cavityGeo = buildMergedOrientedBoxesGeometry(cavityBoxes, 1.5)
  let ventCavityMesh = null
  if (cavityGeo) {
    ventCavityMesh = new THREE.Mesh(cavityGeo, cavityMat)
    ventCavityMesh.name = 'maze-ceiling-vent-cavities'
    ventCavityMesh.castShadow = false
    ventCavityMesh.receiveShadow = false
    ventGroup.add(ventCavityMesh)
  }

  ventGroup.userData = {
    isMazeCeilingVents: true,
    ductMesh,
    ductHardwareMesh,
    ventCavityMesh,
    ductMat,
    hardwareMat,
    cavityMat,
    trunkCount: xTrunks.length + zTrunks.length,
    xTrunkCount: xTrunks.length,
    zTrunkCount: zTrunks.length,
    ductBoxCount: ductBoxes.length,
    hardwareBoxCount: hardwareBoxes.length,
    ventCount: ventMetadata.length,
    ventMetadata,
    ductTrunks: [...xTrunks, ...zTrunks],
  }

  return ventGroup
}

export function syncCeilingVentsQuality(ventsGroup, qualityPreset = 'high') {
  if (!ventsGroup) return false
  const metalTex = getGalvanizedMetalTextureSet({ qualityPreset })
  const ud = ventsGroup.userData || {}
  for (const mat of [ud.ductMat, ud.hardwareMat]) {
    if (!mat) continue
    if (
      mat.map !== metalTex.map ||
      mat.roughnessMap !== metalTex.roughnessMap ||
      mat.bumpMap !== metalTex.bumpMap
    ) {
      mat.map = metalTex.map
      mat.roughnessMap = metalTex.roughnessMap
      mat.bumpMap = metalTex.bumpMap
      mat.needsUpdate = true
    }
  }
  return true
}
