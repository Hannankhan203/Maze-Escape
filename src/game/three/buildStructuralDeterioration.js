import * as THREE from 'three'
import { createRng } from '../../utils/rng.js'
import { placeEnvironmentalProps } from '../generation/environmentalPropPlacement.js'
import { placeHazards } from '../generation/hazardPlacement.js'
import { placeHidingSpots } from '../generation/hidingSpotPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE, WALL_HEIGHT, gridToWorld } from '../world/worldCoords.js'
import { getEnvironmentalPropTextureSet } from './buildEnvironmentalProps.js'
import {
  getMazeSurfaceTextureSet,
  resolveTextureQualityPreset,
} from './mazeSurfaceTextures.js'
import { markSharedResource, registerSharedPoolClearer } from './sharedResources.js'
import {
  buildChunkedLayerNode,
  createMazeChunkLayout,
} from './spatialChunking.js'

const WALL_CAP_HEIGHT = 0.14
const CELL_HALF = CELL_SIZE * 0.5 // 2.0m
const PILASTER_SEGMENT_INSET = 0.46
const PILASTER_PLINTH_OUTER_REACH = 0.08
const PILASTER_CLEAR_PAD = 0.06
const MAX_WALL_PROTRUSION = 0.044
const MAX_FLOOR_CHIP_REACH = 0.135

export const DETERIORATION_PROFILES = {
  HAIRLINE_BRANCH_CRACK: 'hairline_branch_crack',
  CHIPPED_EDGE_SPALL: 'chipped_edge_spall',
  SHALLOW_RECESSED_SPALL: 'shallow_recessed_spall',
  DEEP_CAVITY_FRACTURE: 'deep_cavity_fracture',
  EXPOSED_REBAR_BREAK: 'exposed_rebar_break',
}

export const STRUCTURAL_DETERIORATION_PALETTE = {
  spallConcrete: 0x2f405b, // Matches wallBody slate concrete so fractured rims blend naturally
  cavityInterior: 0x182130, // Darkened recessed concrete core / crushed aggregate
  fracturedCrack: 0x0f1520, // Matte shadowed fracture crevice
  exposedRebar: 0x452b20, // Heavily oxidized dark matte reinforcing steel
}

const WALL_FACE_DIRS = [
  { name: 'north', dr: -1, dc: 0, nx: 0, nz: -1, tx: -1, tz: 0, pathSide: 'south' },
  { name: 'south', dr: 1, dc: 0, nx: 0, nz: 1, tx: 1, tz: 0, pathSide: 'north' },
  { name: 'east', dr: 0, dc: 1, nx: 1, nz: 0, tx: 0, tz: -1, pathSide: 'west' },
  { name: 'west', dr: 0, dc: -1, nx: -1, nz: 0, tx: 0, tz: 1, pathSide: 'east' },
]

const QUALITY_DENSITY_SCALE = {
  performance: 0.58,
  balanced: 0.82,
  high: 1.0,
}

const deteriorationMaterialPool = new Map()

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function hash2i(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0
  h = ((h ^ (h >>> 13)) * 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function smoothValueNoise(x, y, seed) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)

  const n00 = hash2i(ix, iy, seed)
  const n10 = hash2i(ix + 1, iy, seed)
  const n01 = hash2i(ix, iy + 1, seed)
  const n11 = hash2i(ix + 1, iy + 1, seed)

  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy)
}

function sampleRegionalDamageField(row, col, rows, cols, seedNum) {
  const u = ((col + 0.5) / Math.max(4, cols)) * 3.1
  const v = ((row + 0.5) / Math.max(4, rows)) * 3.1
  const low = smoothValueNoise(u, v, seedNum + 101)
  const mid = smoothValueNoise(u * 2.1 + 3.7, v * 2.1 + 1.9, seedNum + 317)
  return clamp(low * 0.65 + mid * 0.35, 0, 1)
}

function normalizeSeedNumber(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Math.abs(Math.floor(seed)) % 100000
  }
  const str = String(seed ?? 'maze-deterioration')
  let hash = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 100000
}

function syncMaterialTextures(mat, texBundle) {
  if (!mat || !texBundle) return
  if (
    mat.map !== texBundle.map ||
    mat.roughnessMap !== texBundle.roughnessMap ||
    mat.bumpMap !== texBundle.bumpMap
  ) {
    mat.map = texBundle.map || null
    mat.roughnessMap = texBundle.roughnessMap || null
    mat.bumpMap = texBundle.bumpMap || null
    mat.needsUpdate = true
  }
}

export function getStructuralDeteriorationMaterials(options = {}) {
  const preset = resolveTextureQualityPreset(options?.qualityPreset)
  const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset: preset })
  const propTexSet = getEnvironmentalPropTextureSet({ qualityPreset: preset })

  let spallConcrete = deteriorationMaterialPool.get(`${preset}:mat:spallConcrete`)
  if (!spallConcrete) {
    spallConcrete = markSharedResource(
      new THREE.MeshStandardMaterial({
        color: STRUCTURAL_DETERIORATION_PALETTE.spallConcrete,
        map: surfaceSet.wall.map,
        roughnessMap: surfaceSet.wall.roughnessMap,
        bumpMap: surfaceSet.wall.bumpMap,
        bumpScale: 0.062,
        roughness: 0.95,
        metalness: 0.015,
        envMapIntensity: 0.36,
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    )
    deteriorationMaterialPool.set(`${preset}:mat:spallConcrete`, spallConcrete)
  } else {
    syncMaterialTextures(spallConcrete, surfaceSet.wall)
  }

  let cavityInterior = deteriorationMaterialPool.get(`${preset}:mat:cavityInterior`)
  if (!cavityInterior) {
    cavityInterior = markSharedResource(
      new THREE.MeshStandardMaterial({
        color: STRUCTURAL_DETERIORATION_PALETTE.cavityInterior,
        map: surfaceSet.wall.map,
        roughnessMap: surfaceSet.wall.roughnessMap,
        bumpMap: surfaceSet.wall.bumpMap,
        bumpScale: 0.072,
        roughness: 0.97,
        metalness: 0.01,
        envMapIntensity: 0.2,
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    )
    deteriorationMaterialPool.set(`${preset}:mat:cavityInterior`, cavityInterior)
  } else {
    syncMaterialTextures(cavityInterior, surfaceSet.wall)
  }

  let fracturedCrack = deteriorationMaterialPool.get(`${preset}:mat:fracturedCrack`)
  if (!fracturedCrack) {
    fracturedCrack = markSharedResource(
      new THREE.MeshStandardMaterial({
        color: STRUCTURAL_DETERIORATION_PALETTE.fracturedCrack,
        roughnessMap: surfaceSet.wall.roughnessMap,
        bumpMap: surfaceSet.wall.bumpMap,
        bumpScale: 0.04,
        roughness: 0.98,
        metalness: 0.0,
        envMapIntensity: 0.14,
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
    )
    deteriorationMaterialPool.set(`${preset}:mat:fracturedCrack`, fracturedCrack)
  } else {
    syncMaterialTextures(fracturedCrack, {
      map: null,
      roughnessMap: surfaceSet.wall.roughnessMap,
      bumpMap: surfaceSet.wall.bumpMap,
    })
  }

  let exposedRebar = deteriorationMaterialPool.get(`${preset}:mat:exposedRebar`)
  if (!exposedRebar) {
    exposedRebar = markSharedResource(
      new THREE.MeshStandardMaterial({
        color: STRUCTURAL_DETERIORATION_PALETTE.exposedRebar,
        map: propTexSet.rustMetal.map,
        roughnessMap: propTexSet.rustMetal.roughnessMap,
        bumpMap: propTexSet.rustMetal.bumpMap,
        bumpScale: 0.042,
        roughness: 0.94,
        metalness: 0.16,
        envMapIntensity: 0.22,
        vertexColors: true,
      })
    )
    deteriorationMaterialPool.set(`${preset}:mat:exposedRebar`, exposedRebar)
  } else {
    syncMaterialTextures(exposedRebar, propTexSet.rustMetal)
  }

  return {
    spallConcrete,
    cavityInterior,
    fracturedCrack,
    exposedRebar,
  }
}

export function disposeStructuralDeteriorationPools() {
  for (const mat of deteriorationMaterialPool.values()) {
    mat?.dispose?.()
  }
  deteriorationMaterialPool.clear()
}

export function getStructuralDeteriorationPoolStats() {
  return {
    materials: deteriorationMaterialPool.size,
  }
}

registerSharedPoolClearer(disposeStructuralDeteriorationPools)

function isWallAt(grid, r, c) {
  const rows = grid.length
  const cols = grid[0]?.length || 0
  return r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] === CELL_TYPES.WALL
}

function isEvenWallNode(grid, r, c) {
  const rows = grid.length
  const cols = grid[0]?.length || 0
  return (
    r >= 0 &&
    r < rows &&
    c >= 0 &&
    c < cols &&
    r % 2 === 0 &&
    c % 2 === 0 &&
    grid[r][c] === CELL_TYPES.WALL
  )
}

/**
 * Computes safe lateral [minT, maxT] range along wall `(wr, wc)` facing `(pr, pc)`
 * strictly clear of pilasters and perpendicular adjacent walls.
 */
function computeWallFaceSafeSpan(grid, wr, wc, pr, pc, dir) {
  let minT = -CELL_HALF
  let maxT = CELL_HALF
  const selfEven = isEvenWallNode(grid, wr, wc)

  for (const sign of [-1, 1]) {
    const sideWallR = wr + sign * dir.tz
    const sideWallC = wc + sign * dir.tx
    const sidePathR = pr + sign * dir.tz
    const sidePathC = pc + sign * dir.tx

    let inset = 0.08
    if (selfEven) {
      inset = Math.max(inset, PILASTER_SEGMENT_INSET + PILASTER_CLEAR_PAD)
    }
    if (isEvenWallNode(grid, sideWallR, sideWallC)) {
      inset = Math.max(inset, PILASTER_PLINTH_OUTER_REACH + PILASTER_CLEAR_PAD)
    }
    if (isWallAt(grid, sidePathR, sidePathC)) {
      inset = Math.max(inset, PILASTER_PLINTH_OUTER_REACH + 0.06)
    }

    if (sign < 0) {
      minT = Math.max(minT, -CELL_HALF + inset)
    } else {
      maxT = Math.min(maxT, CELL_HALF - inset)
    }
  }

  return { minT, maxT }
}

function createGeometryAccumulator() {
  return {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
    vertexCount: 0,
  }
}

function pushVertex(acc, x, y, z, nx, ny, nz, u, v, r, g, b) {
  acc.positions.push(x, y, z)
  acc.normals.push(nx, ny, nz)
  acc.uvs.push(u, v)
  acc.colors.push(r, g, b)
  const idx = acc.vertexCount
  acc.vertexCount += 1
  return idx
}

function addTriangle(acc, ax, ay, az, bx, by, bz, cx, cy, cz, uvA, uvB, uvC, colA, colB, colC, expectedDir = null) {
  const e1x = bx - ax
  const e1y = by - ay
  const e1z = bz - az
  const e2x = cx - ax
  const e2y = cy - ay
  const e2z = cz - az

  let nx = e1y * e2z - e1z * e2y
  let ny = e1z * e2x - e1x * e2z
  let nz = e1x * e2y - e1y * e2x
  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-7) return

  nx /= len
  ny /= len
  nz /= len

  let swapBC = false
  if (expectedDir) {
    const dot = nx * expectedDir.x + ny * expectedDir.y + nz * expectedDir.z
    if (dot < 0) {
      swapBC = true
      nx = -nx
      ny = -ny
      nz = -nz
    }
  }

  if (swapBC) {
    const ia = pushVertex(acc, ax, ay, az, nx, ny, nz, uvA[0], uvA[1], colA[0], colA[1], colA[2])
    const ic = pushVertex(acc, cx, cy, cz, nx, ny, nz, uvC[0], uvC[1], colC[0], colC[1], colC[2])
    const ib = pushVertex(acc, bx, by, bz, nx, ny, nz, uvB[0], uvB[1], colB[0], colB[1], colB[2])
    acc.indices.push(ia, ic, ib)
  } else {
    const ia = pushVertex(acc, ax, ay, az, nx, ny, nz, uvA[0], uvA[1], colA[0], colA[1], colA[2])
    const ib = pushVertex(acc, bx, by, bz, nx, ny, nz, uvB[0], uvB[1], colB[0], colB[1], colB[2])
    const ic = pushVertex(acc, cx, cy, cz, nx, ny, nz, uvC[0], uvC[1], colC[0], colC[1], colC[2])
    acc.indices.push(ia, ib, ic)
  }
}

function addQuad(acc, p0, p1, p2, p3, uv0, uv1, uv2, uv3, c0, c1, c2, c3, expectedDir = null) {
  const ax = p0[0], ay = p0[1], az = p0[2]
  const bx = p1[0], by = p1[1], bz = p1[2]
  const cx = p2[0], cy = p2[1], cz = p2[2]
  const dx = p3[0], dy = p3[1], dz = p3[2]

  // Triangle 1: (p0, p1, p2)
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
  let n1x = e1y * e2z - e1z * e2y
  let n1y = e1z * e2x - e1x * e2z
  let n1z = e1x * e2y - e1y * e2x
  const len1 = Math.hypot(n1x, n1y, n1z)

  // Triangle 2: (p0, p2, p3)
  const f2x = dx - ax, f2y = dy - ay, f2z = dz - az
  let n2x = e2y * f2z - e2z * f2y
  let n2y = e2z * f2x - e2x * f2z
  let n2z = e2x * f2y - e2y * f2x
  const len2 = Math.hypot(n2x, n2y, n2z)

  if (len1 >= 1e-7 && len2 >= 1e-7) {
    n1x /= len1; n1y /= len1; n1z /= len1
    n2x /= len2; n2y /= len2; n2z /= len2

    let flip1 = false
    let flip2 = false
    if (expectedDir) {
      if (n1x * expectedDir.x + n1y * expectedDir.y + n1z * expectedDir.z < 0) {
        flip1 = true
        n1x = -n1x; n1y = -n1y; n1z = -n1z
      }
      if (n2x * expectedDir.x + n2y * expectedDir.y + n2z * expectedDir.z < 0) {
        flip2 = true
        n2x = -n2x; n2y = -n2y; n2z = -n2z
      }
    }

    if (flip1 === flip2) {
      let nx = n1x + n2x
      let ny = n1y + n2y
      let nz = n1z + n2z
      const nLen = Math.hypot(nx, ny, nz)
      if (nLen > 0.25 && n1x * n2x + n1y * n2y + n1z * n2z > 0.2) {
        nx /= nLen; ny /= nLen; nz /= nLen
        const i0 = pushVertex(acc, ax, ay, az, nx, ny, nz, uv0[0], uv0[1], c0[0], c0[1], c0[2])
        const i1 = pushVertex(acc, bx, by, bz, nx, ny, nz, uv1[0], uv1[1], c1[0], c1[1], c1[2])
        const i2 = pushVertex(acc, cx, cy, cz, nx, ny, nz, uv2[0], uv2[1], c2[0], c2[1], c2[2])
        const i3 = pushVertex(acc, dx, dy, dz, nx, ny, nz, uv3[0], uv3[1], c3[0], c3[1], c3[2])
        if (flip1) {
          acc.indices.push(i0, i2, i1, i0, i3, i2)
        } else {
          acc.indices.push(i0, i1, i2, i0, i2, i3)
        }
        return
      }
    }
  }

  addTriangle(acc, ax, ay, az, bx, by, bz, cx, cy, cz, uv0, uv1, uv2, c0, c1, c2, expectedDir)
  addTriangle(acc, ax, ay, az, cx, cy, cz, dx, dy, dz, uv0, uv2, uv3, c0, c2, c3, expectedDir)
}

function createGeometryAccumulatorArray(count) {
  return Array.from({ length: count }, () => createGeometryAccumulator())
}

function mergeGeometryAccumulators(accumulators) {
  const merged = createGeometryAccumulator()
  for (let aIdx = 0; aIdx < accumulators.length; aIdx += 1) {
    const acc = accumulators[aIdx]
    if (!acc || acc.vertexCount === 0 || acc.indices.length === 0) continue
    const baseVertex = merged.vertexCount
    for (let i = 0; i < acc.positions.length; i += 1) {
      merged.positions.push(acc.positions[i])
      merged.normals.push(acc.normals[i])
      merged.colors.push(acc.colors[i])
    }
    for (let i = 0; i < acc.uvs.length; i += 1) {
      merged.uvs.push(acc.uvs[i])
    }
    for (let i = 0; i < acc.indices.length; i += 1) {
      merged.indices.push(baseVertex + acc.indices[i])
    }
    merged.vertexCount += acc.vertexCount
  }
  return merged
}

function buildAccumulatorGeometry(acc) {
  if (!acc || acc.vertexCount === 0 || acc.indices.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(acc.colors, 3))
  const indexArray =
    acc.vertexCount > 65535 ? new Uint32Array(acc.indices) : new Uint16Array(acc.indices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function finalizeChunkedAccumulatorNode(
  accumulators,
  material,
  name,
  layout,
  { castShadow = false, receiveShadow = true } = {}
) {
  let totalIndices = 0
  for (let i = 0; i < accumulators.length; i += 1) {
    totalIndices += accumulators[i]?.indices?.length || 0
  }
  if (totalIndices === 0) return null

  const totalTriangles = Math.floor(totalIndices / 3)
  const shouldChunk =
    layout?.isChunked && totalTriangles >= layout.minTrianglesToChunk

  const chunkEntries = []
  if (shouldChunk) {
    for (let i = 0; i < accumulators.length; i += 1) {
      const geo = buildAccumulatorGeometry(accumulators[i])
      if (geo) {
        chunkEntries.push({ chunkIndex: i, geometry: geo })
      }
    }
  } else {
    const merged = mergeGeometryAccumulators(accumulators)
    const geo = buildAccumulatorGeometry(merged)
    if (geo) {
      chunkEntries.push({ chunkIndex: 0, geometry: geo })
    }
  }

  return buildChunkedLayerNode({
    layerName: name,
    chunkEntries,
    material,
    castShadow,
    receiveShadow,
    layout: shouldChunk ? layout : { ...layout, isChunked: false },
  })
}

function sampleWallCellTone(r, c) {
  const hashA = (((r * 73856093) ^ (c * 19349663)) >>> 0) / 4294967295
  const hashB = (((r * 83492791) ^ (c * 2971215073)) >>> 0) / 4294967295
  const wallTone = 0.89 + hashA * 0.16
  const chromaShift = (hashB - 0.5) * 0.045
  return [
    wallTone + chromaShift,
    wallTone + (hashB > 0.65 ? 0.012 : 0),
    wallTone - chromaShift * 0.6,
  ]
}

function toWorldPoint(wallWorld, dir, t, y, d) {
  const faceDist = CELL_HALF + d
  return [
    wallWorld.x + dir.nx * faceDist + dir.tx * t,
    y,
    wallWorld.z + dir.nz * faceDist + dir.tz * t,
  ]
}

function buildIrregularLoop(rng, centerT, centerY, rx, ry, vertexCount, minT, maxT, minY, maxY, jitter = 0.28) {
  const pts = []
  const phase = rng() * Math.PI * 2
  for (let i = 0; i < vertexCount; i += 1) {
    const angle = (i / vertexCount) * Math.PI * 2 + phase
    const radialScale = 0.72 + rng() * jitter * 1.45
    const t = clamp(centerT + Math.cos(angle) * rx * radialScale, minT, maxT)
    const y = clamp(centerY + Math.sin(angle) * ry * radialScale, minY, maxY)
    pts.push({ t, y, angle })
  }
  return pts
}

/**
 * Emits a beveled jagged spall concrete collar surrounding an inner recessed pocket.
 * Outer skirt anchors back at d=-0.002m inside wall face, peak rim rises to peakDepth,
 * and inner lip slopes cleanly down into the darkened core cavity.
 */
function emitBrokenCollarAndCavity(
  spallAcc,
  cavityAcc,
  wallWorld,
  dir,
  rng,
  wallTone,
  {
    centerT,
    centerY,
    rx,
    ry,
    minT,
    maxT,
    minY,
    maxY,
    peakDepth,
    coreDepth,
    segments = 11,
  }
) {
  const outerLoop = buildIrregularLoop(rng, centerT, centerY, rx, ry, segments, minT, maxT, minY, maxY, 0.26)
  const midLoop = []
  const innerLoop = []
  const backLoop = []

  const avgT = outerLoop.reduce((s, p) => s + p.t, 0) / segments
  const avgY = outerLoop.reduce((s, p) => s + p.y, 0) / segments

  for (let i = 0; i < segments; i += 1) {
    const op = outerLoop[i]
    const midFrac = 0.68 + (rng() - 0.5) * 0.08
    const innerFrac = 0.5 + (rng() - 0.5) * 0.08
    const rimH = clamp(peakDepth * (0.72 + rng() * 0.36), 0.01, MAX_WALL_PROTRUSION)
    const outerLipD = 0.0025

    backLoop.push(toWorldPoint(wallWorld, dir, op.t, op.y, -0.002))
    outerLoop[i].w = toWorldPoint(wallWorld, dir, op.t, op.y, outerLipD)

    const mt = lerp(avgT, op.t, midFrac)
    const my = lerp(avgY, op.y, midFrac)
    midLoop.push({
      t: mt,
      y: my,
      w: toWorldPoint(wallWorld, dir, mt, my, rimH),
    })

    const it = lerp(avgT, op.t, innerFrac)
    const iy = lerp(avgY, op.y, innerFrac)
    innerLoop.push({
      t: it,
      y: iy,
      w: toWorldPoint(wallWorld, dir, it, iy, coreDepth),
    })
  }

  const baseTone = [wallTone[0] * 0.94, wallTone[1] * 0.94, wallTone[2] * 0.95]
  const peakTone = [wallTone[0] * 1.04, wallTone[1] * 1.03, wallTone[2] * 1.02]
  const innerShoulderTone = [wallTone[0] * 0.64, wallTone[1] * 0.65, wallTone[2] * 0.68]
  const coreCenterTone = [0.72, 0.74, 0.78]
  const coreEdgeTone = [0.58, 0.6, 0.64]

  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments
    const oA = outerLoop[i]
    const oB = outerLoop[next]
    const mA = midLoop[i]
    const mB = midLoop[next]
    const iA = innerLoop[i]
    const iB = innerLoop[next]

    // Outward vector radially from pocket center for consistent bevel normal direction
    const radT = (oA.t + oB.t) * 0.5 - avgT
    const radY = (oA.y + oB.y) * 0.5 - avgY
    const outerNormalHint = {
      x: dir.nx * 0.65 + dir.tx * radT,
      y: radY,
      z: dir.nz * 0.65 + dir.tz * radT,
    }
    const innerNormalHint = {
      x: dir.nx * 0.7 - dir.tx * radT,
      y: -radY,
      z: dir.nz * 0.7 - dir.tz * radT,
    }

    // Back anchor skirt (prevents gaps at grazing angles)
    addQuad(
      spallAcc,
      backLoop[i],
      backLoop[next],
      oB.w,
      oA.w,
      [oA.t * 0.45, oA.y * 0.45],
      [oB.t * 0.45, oB.y * 0.45],
      [oB.t * 0.45, oB.y * 0.45],
      [oA.t * 0.45, oA.y * 0.45],
      baseTone,
      baseTone,
      baseTone,
      baseTone,
      outerNormalHint
    )

    // Outer broken concrete slope (outer edge -> jagged ridge)
    addQuad(
      spallAcc,
      oA.w,
      oB.w,
      mB.w,
      mA.w,
      [oA.t * 0.55, oA.y * 0.55],
      [oB.t * 0.55, oB.y * 0.55],
      [mB.t * 0.55, mB.y * 0.55],
      [mA.t * 0.55, mA.y * 0.55],
      baseTone,
      baseTone,
      peakTone,
      peakTone,
      outerNormalHint
    )

    // Inner fractured concrete lip (jagged ridge -> recessed core floor)
    addQuad(
      spallAcc,
      mA.w,
      mB.w,
      iB.w,
      iA.w,
      [mA.t * 0.55, mA.y * 0.55],
      [mB.t * 0.55, mB.y * 0.55],
      [iB.t * 0.55, iB.y * 0.55],
      [iA.t * 0.55, iA.y * 0.55],
      peakTone,
      peakTone,
      innerShoulderTone,
      innerShoulderTone,
      innerNormalHint
    )
  }

  // Darkened inner aggregate core fan
  const centerWorld = toWorldPoint(wallWorld, dir, avgT, avgY, coreDepth - 0.001)
  const wallOutDir = { x: dir.nx, y: 0, z: dir.nz }
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments
    const iA = innerLoop[i]
    const iB = innerLoop[next]
    addTriangle(
      cavityAcc,
      centerWorld[0], centerWorld[1], centerWorld[2],
      iA.w[0], iA.w[1], iA.w[2],
      iB.w[0], iB.w[1], iB.w[2],
      [avgT * 0.65, avgY * 0.65],
      [iA.t * 0.65, iA.y * 0.65],
      [iB.t * 0.65, iB.y * 0.65],
      coreCenterTone,
      coreEdgeTone,
      coreEdgeTone,
      wallOutDir
    )
  }

  // Embed 2-3 small angular aggregate stones inside pocket for tactile flashlight relief
  const noduleCount = 2 + Math.floor(rng() * 2)
  for (let n = 0; n < noduleCount; n += 1) {
    const nt = avgT + (rng() - 0.5) * rx * 0.45
    const ny = avgY + (rng() - 0.5) * ry * 0.45
    const nr = 0.025 + rng() * 0.028
    const nDepth = clamp(coreDepth + 0.004 + rng() * 0.004, coreDepth, peakDepth * 0.6)
    const pL = toWorldPoint(wallWorld, dir, nt - nr, ny - nr * 0.5, coreDepth - 0.001)
    const pR = toWorldPoint(wallWorld, dir, nt + nr, ny - nr * 0.4, coreDepth - 0.001)
    const pT = toWorldPoint(wallWorld, dir, nt + (rng() - 0.5) * nr, ny + nr, coreDepth - 0.001)
    const pPeak = toWorldPoint(wallWorld, dir, nt, ny, nDepth)
    const nTone = [0.85, 0.85, 0.88]
    const nBase = [0.6, 0.62, 0.66]
    addTriangle(cavityAcc, pL[0], pL[1], pL[2], pR[0], pR[1], pR[2], pPeak[0], pPeak[1], pPeak[2], [0, 0], [0.2, 0], [0.1, 0.2], nBase, nBase, nTone, { x: dir.nx, y: -0.4, z: dir.nz })
    addTriangle(cavityAcc, pR[0], pR[1], pR[2], pT[0], pT[1], pT[2], pPeak[0], pPeak[1], pPeak[2], [0.2, 0], [0.1, 0.2], [0.1, 0.1], nBase, nBase, nTone, { x: dir.nx, y: 0.3, z: dir.nz })
    addTriangle(cavityAcc, pT[0], pT[1], pT[2], pL[0], pL[1], pL[2], pPeak[0], pPeak[1], pPeak[2], [0.1, 0.2], [0, 0], [0.1, 0.1], nBase, nBase, nTone, { x: dir.nx, y: 0.3, z: dir.nz })
  }

  return { centerT: avgT, centerY: avgY, innerLoop }
}

/**
 * Emits a branching irregular structural crack chain with tapered V-crevice depth
 * and subtle chipped concrete edges.
 */
function emitCrackChain(
  crackAcc,
  spallAcc,
  wallWorld,
  dir,
  rng,
  wallTone,
  {
    startT,
    startY,
    angle,
    segments,
    stepLen,
    baseHalfW,
    minT,
    maxT,
    minY,
    maxY,
    addChippedShoulder = false,
  }
) {
  let curT = clamp(startT, minT, maxT)
  let curY = clamp(startY, minY, maxY)
  let curAng = angle
  const pts = [{ t: curT, y: curY }]

  for (let i = 0; i < segments; i += 1) {
    curAng += (rng() - 0.5) * 0.72
    curT = clamp(curT + Math.cos(curAng) * stepLen, minT, maxT)
    curY = clamp(curY + Math.sin(curAng) * stepLen, minY, maxY)
    pts.push({ t: curT, y: curY })
  }

  const wallOutDir = { x: dir.nx, y: 0, z: dir.nz }
  const crackToneDark = [0.75, 0.78, 0.82]
  const crackToneEdge = [0.95, 0.96, 1.0]
  const lipTone = [wallTone[0] * 0.96, wallTone[1] * 0.96, wallTone[2] * 0.97]

  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]
    const b = pts[i + 1]
    const dt = b.t - a.t
    const dy = b.y - a.y
    const len = Math.hypot(dt, dy)
    if (len < 1e-4) continue

    const perpT = -dy / len
    const perpY = dt / len

    const tA = i / (pts.length - 1)
    const tB = (i + 1) / (pts.length - 1)
    const wA = baseHalfW * Math.sin(clamp(tA, 0.05, 0.95) * Math.PI)
    const wB = baseHalfW * Math.sin(clamp(tB, 0.05, 0.95) * Math.PI)

    const depthCrevice = 0.0068
    const depthEdge = 0.0032

    const aL = toWorldPoint(wallWorld, dir, a.t - perpT * wA, a.y - perpY * wA, depthEdge)
    const aR = toWorldPoint(wallWorld, dir, a.t + perpT * wA, a.y + perpY * wA, depthEdge)
    const bL = toWorldPoint(wallWorld, dir, b.t - perpT * wB, b.y - perpY * wB, depthEdge)
    const bR = toWorldPoint(wallWorld, dir, b.t + perpT * wB, b.y + perpY * wB, depthEdge)
    const aM = toWorldPoint(wallWorld, dir, a.t, a.y, depthCrevice)
    const bM = toWorldPoint(wallWorld, dir, b.t, b.y, depthCrevice)

    // Left and right fissure flanks
    addQuad(
      crackAcc,
      aL,
      aM,
      bM,
      bL,
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
      crackToneEdge,
      crackToneDark,
      crackToneDark,
      crackToneEdge,
      wallOutDir
    )
    addQuad(
      crackAcc,
      aM,
      aR,
      bR,
      bM,
      [0.5, 0],
      [1, 0],
      [1, 1],
      [0.5, 1],
      crackToneDark,
      crackToneEdge,
      crackToneEdge,
      crackToneDark,
      wallOutDir
    )

    if (addChippedShoulder && i > 0 && i < pts.length - 2 && rng() < 0.45) {
      const side = rng() < 0.5 ? -1 : 1
      const wMax = Math.max(wA, wB)
      const lipT0 = a.t + perpT * side * wMax * 0.85
      const lipY0 = a.y + perpY * side * wMax * 0.85
      const lipT1 = b.t + perpT * side * wMax * 0.85
      const lipY1 = b.y + perpY * side * wMax * 0.85
      const outerT0 = clamp(lipT0 + perpT * side * 0.045, minT, maxT)
      const outerY0 = clamp(lipY0 + perpY * side * 0.045, minY, maxY)
      const outerT1 = clamp(lipT1 + perpT * side * 0.045, minT, maxT)
      const outerY1 = clamp(lipY1 + perpY * side * 0.045, minY, maxY)
      const ridgeD = 0.008 + rng() * 0.005

      addQuad(
        spallAcc,
        toWorldPoint(wallWorld, dir, outerT0, outerY0, -0.001),
        toWorldPoint(wallWorld, dir, outerT1, outerY1, -0.001),
        toWorldPoint(wallWorld, dir, lipT1, lipY1, ridgeD),
        toWorldPoint(wallWorld, dir, lipT0, lipY0, ridgeD),
        [outerT0 * 0.5, outerY0 * 0.5],
        [outerT1 * 0.5, outerY1 * 0.5],
        [lipT1 * 0.5, lipY1 * 0.5],
        [lipT0 * 0.5, lipY0 * 0.5],
        lipTone,
        lipTone,
        lipTone,
        lipTone,
        wallOutDir
      )
    }
  }
}

/**
 * Emits a corroded 6-sided cylindrical rebar rod between two endpoints on the wall face
 * (`pStart -> pEnd`, bowing gently outward to midDepth inside the concrete pocket).
 */
function emitRebarSegment(rebarAcc, p0, p1, radius, sides = 5) {
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  const dz = p1[2] - p0[2]
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-4) return

  const ax = dx / len
  const ay = dy / len
  const az = dz / len

  const upX = Math.abs(ay) < 0.9 ? 0 : 1
  const upY = Math.abs(ay) < 0.9 ? 1 : 0
  const upZ = 0

  let ux = ay * upZ - az * upY
  let uy = az * upX - ax * upZ
  let uz = ax * upY - ay * upX
  const uLen = Math.hypot(ux, uy, uz) || 1
  ux /= uLen
  uy /= uLen
  uz /= uLen

  const vx = ay * uz - az * uy
  const vy = az * ux - ax * uz
  const vz = ax * uy - ay * ux

  const baseIdx = rebarAcc.vertexCount
  for (let i = 0; i <= sides; i += 1) {
    const theta = (i / sides) * Math.PI * 2
    const ct = Math.cos(theta)
    const st = Math.sin(theta)
    const nx = ux * ct + vx * st
    const ny = uy * ct + vy * st
    const nz = uz * ct + vz * st
    const shade = 0.8 + 0.22 * (0.5 + 0.5 * ny)

    pushVertex(
      rebarAcc,
      p0[0] + nx * radius,
      p0[1] + ny * radius,
      p0[2] + nz * radius,
      nx,
      ny,
      nz,
      i / sides,
      0,
      shade,
      shade * 0.94,
      shade * 0.9
    )
    pushVertex(
      rebarAcc,
      p1[0] + nx * radius,
      p1[1] + ny * radius,
      p1[2] + nz * radius,
      nx,
      ny,
      nz,
      i / sides,
      len * 4,
      shade,
      shade * 0.94,
      shade * 0.9
    )
  }

  for (let i = 0; i < sides; i += 1) {
    const a = baseIdx + i * 2
    const b = a + 1
    const c = a + 3
    const d = a + 2
    rebarAcc.indices.push(a, c, b, a, d, c)
  }
}

/**
 * Emits a tiny grounded fallen concrete rubble chip resting strictly on y = 0,
 * tucked immediately against the wall foot (`<= MAX_FLOOR_CHIP_REACH`).
 */
function emitGroundedWallFootChip(spallAcc, wallWorld, dir, rng, wallTone, lateralT, minT, maxT) {
  const rx = 0.032 + rng() * 0.042
  const rd = 0.028 + rng() * 0.032
  const h = 0.018 + rng() * 0.026
  const dCenter = clamp(0.038 + rng() * 0.06, 0.03, MAX_FLOOR_CHIP_REACH - rd)
  const tCenter = clamp(lateralT, minT + rx, maxT - rx)

  const sides = 5
  const botVerts = []
  const topVerts = []
  const phase = rng() * Math.PI * 2
  for (let i = 0; i < sides; i += 1) {
    const ang = phase + (i / sides) * Math.PI * 2
    const radJit = 0.78 + rng() * 0.36
    const dt = Math.cos(ang) * rx * radJit
    const dd = Math.sin(ang) * rd * radJit
    const td = clamp(dCenter + dd, 0.005, MAX_FLOOR_CHIP_REACH)
    botVerts.push(toWorldPoint(wallWorld, dir, tCenter + dt, 0, td))
    topVerts.push(
      toWorldPoint(
        wallWorld,
        dir,
        tCenter + dt * 0.68,
        h * (0.72 + rng() * 0.38),
        clamp(dCenter + dd * 0.68, 0.008, MAX_FLOOR_CHIP_REACH)
      )
    )
  }

  const chipCenterTop = toWorldPoint(wallWorld, dir, tCenter, h * 0.95, dCenter)
  const toneSide = [wallTone[0] * 0.78, wallTone[1] * 0.79, wallTone[2] * 0.82]
  const toneTop = [wallTone[0] * 0.92, wallTone[1] * 0.92, wallTone[2] * 0.94]

  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides
    const outHint = {
      x: (botVerts[i][0] + botVerts[next][0]) * 0.5 - (wallWorld.x + dir.nx * (CELL_HALF + dCenter) + dir.tx * tCenter),
      y: 0.25,
      z: (botVerts[i][2] + botVerts[next][2]) * 0.5 - (wallWorld.z + dir.nz * (CELL_HALF + dCenter) + dir.tz * tCenter),
    }
    addQuad(
      spallAcc,
      botVerts[i],
      botVerts[next],
      topVerts[next],
      topVerts[i],
      [0, 0],
      [0.3, 0],
      [0.3, 0.2],
      [0, 0.2],
      toneSide,
      toneSide,
      toneTop,
      toneTop,
      outHint
    )
    addTriangle(
      spallAcc,
      chipCenterTop[0], chipCenterTop[1], chipCenterTop[2],
      topVerts[i][0], topVerts[i][1], topVerts[i][2],
      topVerts[next][0], topVerts[next][1], topVerts[next][2],
      [0.15, 0.15],
      [0, 0],
      [0.3, 0],
      toneTop,
      toneTop,
      toneTop,
      { x: 0, y: 1, z: 0 }
    )
  }
}

function resolveGameplayExclusions(maze, options = {}) {
  const hazards = Array.isArray(options.hazards)
    ? options.hazards
    : Array.isArray(maze?.hazards)
      ? maze.hazards
      : placeHazards(maze)

  const hidingSpots = Array.isArray(options.hidingSpots)
    ? options.hidingSpots
    : Array.isArray(maze?.hidingSpots)
      ? maze.hidingSpots
      : placeHidingSpots(maze, { hazards })

  return { hazards, hidingSpots }
}

/**
 * Resolves a set of `wr,wc,faceName` wall faces that should remain unobstructed
 * by structural 3D deterioration (start/exit thresholds, hiding spots, wall props).
 */
function buildProtectedWallFaceSet(maze, options = {}, resolved = null) {
  const protectedFaces = new Set()
  const grid = maze?.grid
  if (!Array.isArray(grid)) return protectedFaces

  const addAllFacesAroundPathCell = (r, c) => {
    for (let i = 0; i < WALL_FACE_DIRS.length; i += 1) {
      const d = WALL_FACE_DIRS[i]
      // Neighbor wall cell (wr, wc) sits at (r - d.dr, c - d.dc) and faces `d.name` toward (r, c)
      protectedFaces.add(`${r - d.dr},${c - d.dc},${d.name}`)
    }
  }

  if (maze.start) {
    addAllFacesAroundPathCell(maze.start.row, maze.start.col)
  }
  if (maze.exit) {
    addAllFacesAroundPathCell(maze.exit.row, maze.exit.col)
  }

  const { hazards, hidingSpots } = resolved || resolveGameplayExclusions(maze, options)
  if (Array.isArray(hidingSpots)) {
    for (let i = 0; i < hidingSpots.length; i += 1) {
      const hs = hidingSpots[i]
      if (Number.isInteger(hs?.row) && Number.isInteger(hs?.col)) {
        addAllFacesAroundPathCell(hs.row, hs.col)
      }
    }
  }

  const props = Array.isArray(options.props)
    ? options.props
    : Array.isArray(options.placedProps)
      ? options.placedProps
      : placeEnvironmentalProps(maze, {
          hazards,
          hidingSpots,
          collectibles: options.collectibles,
          keycards: options.keycards,
          excludedCells: options.excludedCells,
          density: options.propDensity,
          count: options.propCount,
        })
  if (Array.isArray(props)) {
    for (let i = 0; i < props.length; i += 1) {
      const prop = props[i]
      if (!Number.isInteger(prop?.row) || !Number.isInteger(prop?.col) || !prop.wallSide) {
        continue
      }
      const matchDir = WALL_FACE_DIRS.find((d) => d.pathSide === prop.wallSide)
      if (matchDir) {
        protectedFaces.add(`${prop.row - matchDir.dr},${prop.col - matchDir.dc},${matchDir.name}`)
      }
    }
  }

  return protectedFaces
}

function buildProtectedFloorFootCellSet(maze, options = {}, resolved = null) {
  const occupied = new Set()
  const mark = (r, c) => {
    if (Number.isInteger(r) && Number.isInteger(c)) {
      occupied.add(`${r},${c}`)
    }
  }
  const markList = (list) => {
    if (!Array.isArray(list)) return
    for (let i = 0; i < list.length; i += 1) {
      mark(list[i]?.row, list[i]?.col)
    }
  }

  if (maze.start) mark(maze.start.row, maze.start.col)
  if (maze.exit) mark(maze.exit.row, maze.exit.col)

  const { hazards, hidingSpots } = resolved || resolveGameplayExclusions(maze, options)
  markList(hazards)
  markList(hidingSpots)

  const collectibles = options.collectibles ?? maze.collectibles
  if (Array.isArray(collectibles)) {
    markList(collectibles)
  } else if (collectibles && typeof collectibles === 'object') {
    markList(collectibles.coins)
    markList(collectibles.powerUps)
  }

  markList(options.keycards ?? maze.keycards)
  markList(options.excludedCells)

  return occupied
}

/**
 * Builds deterministic, restrained, facility-integrated structural concrete deterioration
 * merged into 4 static BufferGeometry meshes inside a single THREE.Group:
 *  1. `deterioration-concrete-spall` (broken spall collars, chipped edge plates, foot rubble)
 *  2. `deterioration-cavity-core` (darkened recessed aggregate cores)
 *  3. `deterioration-crack-fissures` (branching matte hairline/settlement crevices)
 *  4. `deterioration-exposed-rebar` (sparse corroded rebar nested inside deep breaks)
 */
export function buildStructuralDeterioration(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return null
  }

  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return null

  const qualityPreset = options.qualityPreset || 'high'
  const densityScale = QUALITY_DENSITY_SCALE[qualityPreset] ?? 1.0
  const bodyHeight = options.bodyHeight ?? Math.max(0.5, WALL_HEIGHT - WALL_CAP_HEIGHT)
  const seed = maze.seed ?? maze.id ?? 'maze'
  const seedNum = normalizeSeedNumber(seed)
  const rng = createRng(`${seed}-structural-deterioration-v1`)

  const resolved = resolveGameplayExclusions(maze, options)
  const protectedFaces = buildProtectedWallFaceSet(maze, options, resolved)
  const protectedFloorCells = buildProtectedFloorFootCellSet(maze, options, resolved)

  const candidates = []
  for (let wr = 0; wr < rows; wr += 1) {
    for (let wc = 0; wc < cols; wc += 1) {
      if (grid[wr][wc] !== CELL_TYPES.WALL) continue

      let exposedCount = 0
      for (let f = 0; f < WALL_FACE_DIRS.length; f += 1) {
        const d = WALL_FACE_DIRS[f]
        const pr = wr + d.dr
        const pc = wc + d.dc
        if (pr > 0 && pr < rows - 1 && pc > 0 && pc < cols - 1 && grid[pr][pc] === CELL_TYPES.PATH) {
          exposedCount += 1
        }
      }
      if (exposedCount === 0) continue

      const stress = sampleRegionalDamageField(wr, wc, rows, cols, seedNum)
      for (let f = 0; f < WALL_FACE_DIRS.length; f += 1) {
        const dir = WALL_FACE_DIRS[f]
        const pr = wr + dir.dr
        const pc = wc + dir.dc
        if (pr <= 0 || pr >= rows - 1 || pc <= 0 || pc >= cols - 1) continue
        if (grid[pr][pc] !== CELL_TYPES.PATH) continue
        if (protectedFaces.has(`${wr},${wc},${dir.name}`)) continue

        const { minT, maxT } = computeWallFaceSafeSpan(grid, wr, wc, pr, pc, dir)
        if (maxT - minT < 0.72) continue

        candidates.push({
          wr,
          wc,
          pr,
          pc,
          dir,
          minT,
          maxT,
          exposedCount,
          stress,
          score: stress * 0.68 + rng() * 0.32,
        })
      }
    }
  }

  if (candidates.length === 0) {
    return null
  }

  // Sort by regional stress + deterministic jitter so older structural wings collect clustered damage
  candidates.sort((a, b) => b.score - a.score)

  const targetCount = clamp(
    Math.round(candidates.length * 0.145 * densityScale),
    Math.min(6, candidates.length),
    Math.round(92 * densityScale)
  )

  const selected = []
  const usedWallFace = new Set()
  const cellDamageCount = new Map()

  for (let i = 0; i < candidates.length && selected.length < targetCount; i += 1) {
    const cand = candidates[i]
    const wallKey = `${cand.wr},${cand.wc}`
    if (usedWallFace.has(wallKey)) continue

    // Prevent cluttering opposite faces of the same narrow corridor cell or tight spacing
    const pathKey = `${cand.pr},${cand.pc}`
    if ((cellDamageCount.get(pathKey) || 0) >= 1) continue

    let tooClose =
      usedWallFace.has(`${cand.wr - 1},${cand.wc}`) ||
      usedWallFace.has(`${cand.wr + 1},${cand.wc}`) ||
      usedWallFace.has(`${cand.wr},${cand.wc - 1}`) ||
      usedWallFace.has(`${cand.wr},${cand.wc + 1}`)
    if (tooClose) continue

    usedWallFace.add(wallKey)
    cellDamageCount.set(pathKey, (cellDamageCount.get(pathKey) || 0) + 1)
    selected.push(cand)
  }

  if (selected.length === 0) {
    return null
  }

  // Ensure varied profile mix with sparse rebar exposure and natural non-repeating cadence
  const profileCounts = {
    [DETERIORATION_PROFILES.HAIRLINE_BRANCH_CRACK]: 0,
    [DETERIORATION_PROFILES.CHIPPED_EDGE_SPALL]: 0,
    [DETERIORATION_PROFILES.SHALLOW_RECESSED_SPALL]: 0,
    [DETERIORATION_PROFILES.DEEP_CAVITY_FRACTURE]: 0,
    [DETERIORATION_PROFILES.EXPOSED_REBAR_BREAK]: 0,
  }

  const chunkLayout = createMazeChunkLayout(maze)
  const spallAccs = createGeometryAccumulatorArray(chunkLayout.totalChunks)
  const cavityAccs = createGeometryAccumulatorArray(chunkLayout.totalChunks)
  const crackAccs = createGeometryAccumulatorArray(chunkLayout.totalChunks)
  const rebarAccs = createGeometryAccumulatorArray(chunkLayout.totalChunks)
  const mats = getStructuralDeteriorationMaterials({ qualityPreset })

  let rubbleChipCount = 0
  let rebarRodCount = 0
  let lastProfile = null

  // Guarantee all 5 profiles appear across small/medium/large/hardcore mazes when sites allow
  const forcedSequence = [
    DETERIORATION_PROFILES.SHALLOW_RECESSED_SPALL,
    DETERIORATION_PROFILES.HAIRLINE_BRANCH_CRACK,
    DETERIORATION_PROFILES.CHIPPED_EDGE_SPALL,
    DETERIORATION_PROFILES.DEEP_CAVITY_FRACTURE,
    DETERIORATION_PROFILES.EXPOSED_REBAR_BREAK,
  ]

  for (let i = 0; i < selected.length; i += 1) {
    const site = selected[i]
    const wallWorld = gridToWorld(site.wr, site.wc, maze)
    if (!wallWorld) continue
    const siteChunkIndex = chunkLayout.getChunkIndex(wallWorld.x, wallWorld.z)
    const spallAcc = spallAccs[siteChunkIndex]
    const cavityAcc = cavityAccs[siteChunkIndex]
    const crackAcc = crackAccs[siteChunkIndex]
    const rebarAcc = rebarAccs[siteChunkIndex]

    let profile
    if (i < forcedSequence.length) {
      profile = forcedSequence[i]
    } else {
      const roll = rng()
      const maxRebar = Math.max(1, Math.floor(selected.length * 0.13))
      if (
        site.stress > 0.56 &&
        profileCounts[DETERIORATION_PROFILES.EXPOSED_REBAR_BREAK] < maxRebar &&
        roll < 0.16 &&
        lastProfile !== DETERIORATION_PROFILES.EXPOSED_REBAR_BREAK
      ) {
        profile = DETERIORATION_PROFILES.EXPOSED_REBAR_BREAK
      } else if (site.stress > 0.5 && roll < 0.34 && lastProfile !== DETERIORATION_PROFILES.DEEP_CAVITY_FRACTURE) {
        profile = DETERIORATION_PROFILES.DEEP_CAVITY_FRACTURE
      } else if (roll < 0.58 && lastProfile !== DETERIORATION_PROFILES.SHALLOW_RECESSED_SPALL) {
        profile = DETERIORATION_PROFILES.SHALLOW_RECESSED_SPALL
      } else if ((site.exposedCount >= 2 || roll < 0.78) && lastProfile !== DETERIORATION_PROFILES.CHIPPED_EDGE_SPALL) {
        profile = DETERIORATION_PROFILES.CHIPPED_EDGE_SPALL
      } else {
        profile = DETERIORATION_PROFILES.HAIRLINE_BRANCH_CRACK
      }
    }

    lastProfile = profile
    profileCounts[profile] += 1

    const wallTone = sampleWallCellTone(site.wr, site.wc)
    const minT = site.minT + 0.04
    const maxT = site.maxT - 0.04
    const spanT = maxT - minT
    const minY = 0.16
    const maxY = bodyHeight - 0.18
    const allowFloorChips = !protectedFloorCells.has(`${site.pr},${site.pc}`)

    if (profile === DETERIORATION_PROFILES.HAIRLINE_BRANCH_CRACK) {
      const baseT = lerp(minT + spanT * 0.2, maxT - spanT * 0.2, rng())
      const baseY = lerp(minY + 0.18, maxY - 0.3, rng())
      const verticalBias = rng() < 0.55 ? Math.PI * 0.5 : 0
      const mainAng = verticalBias + (rng() - 0.5) * 0.55
      emitCrackChain(crackAcc, spallAcc, wallWorld, site.dir, rng, wallTone, {
        startT: baseT,
        startY: baseY,
        angle: mainAng,
        segments: 6 + Math.floor(rng() * 4),
        stepLen: 0.14 + rng() * 0.06,
        baseHalfW: 0.014 + rng() * 0.008,
        minT,
        maxT,
        minY,
        maxY,
        addChippedShoulder: true,
      })
      // Secondary fork crack
      emitCrackChain(crackAcc, spallAcc, wallWorld, site.dir, rng, wallTone, {
        startT: clamp(baseT + (rng() - 0.5) * 0.25, minT, maxT),
        startY: clamp(baseY + (rng() - 0.5) * 0.25, minY, maxY),
        angle: mainAng + (rng() < 0.5 ? 0.8 : -0.8),
        segments: 4 + Math.floor(rng() * 3),
        stepLen: 0.11 + rng() * 0.05,
        baseHalfW: 0.011 + rng() * 0.005,
        minT,
        maxT,
        minY,
        maxY,
        addChippedShoulder: false,
      })
    } else if (profile === DETERIORATION_PROFILES.CHIPPED_EDGE_SPALL) {
      const edgeSide = rng() < 0.5 ? -1 : 1
      const rx = clamp(0.22 + rng() * 0.14, 0.18, spanT * 0.24)
      const ry = 0.24 + rng() * 0.18
      const centerT = edgeSide < 0 ? minT + rx + 0.05 : maxT - rx - 0.05
      const centerY = rng() < 0.55 ? lerp(minY + ry + 0.05, 0.72, rng()) : lerp(0.9, maxY - ry - 0.12, rng())

      emitBrokenCollarAndCavity(spallAcc, cavityAcc, wallWorld, site.dir, rng, wallTone, {
        centerT,
        centerY,
        rx,
        ry,
        minT,
        maxT,
        minY,
        maxY,
        peakDepth: 0.020 + rng() * 0.008,
        coreDepth: 0.0075,
        segments: 7,
      })

      if (allowFloorChips && centerY < 0.88) {
        const chips = 1 + Math.floor(rng() * 2)
        for (let k = 0; k < chips; k += 1) {
          emitGroundedWallFootChip(
            spallAcc,
            wallWorld,
            site.dir,
            rng,
            wallTone,
            centerT + (rng() - 0.5) * rx * 1.1,
            minT,
            maxT
          )
          rubbleChipCount += 1
        }
      }
    } else if (profile === DETERIORATION_PROFILES.SHALLOW_RECESSED_SPALL) {
      const rx = clamp(0.32 + rng() * 0.18, 0.24, spanT * 0.34)
      const ry = 0.22 + rng() * 0.16
      const centerT = lerp(minT + rx + 0.04, maxT - rx - 0.04, rng())
      // Anchor naturally near horizontal formwork seam or lower impact belt
      const seamRoll = rng()
      const targetY = seamRoll < 0.4 ? 0.45 + rng() * 0.35 : seamRoll < 0.78 ? 1.06 + (rng() - 0.5) * 0.24 : 2.1 + (rng() - 0.5) * 0.22
      const centerY = clamp(targetY, minY + ry + 0.04, maxY - ry - 0.04)

      emitBrokenCollarAndCavity(spallAcc, cavityAcc, wallWorld, site.dir, rng, wallTone, {
        centerT,
        centerY,
        rx,
        ry,
        minT,
        maxT,
        minY,
        maxY,
        peakDepth: 0.024 + rng() * 0.008,
        coreDepth: 0.008,
        segments: 9,
      })

      emitCrackChain(crackAcc, spallAcc, wallWorld, site.dir, rng, wallTone, {
        startT: clamp(centerT + (rng() < 0.5 ? -rx * 0.7 : rx * 0.7), minT, maxT),
        startY: centerY,
        angle: (rng() - 0.5) * 0.9,
        segments: 4,
        stepLen: 0.12,
        baseHalfW: 0.012,
        minT,
        maxT,
        minY,
        maxY,
      })
    } else if (profile === DETERIORATION_PROFILES.DEEP_CAVITY_FRACTURE) {
      const rx = clamp(0.4 + rng() * 0.2, 0.28, spanT * 0.4)
      const ry = 0.3 + rng() * 0.18
      const centerT = lerp(minT + rx + 0.04, maxT - rx - 0.04, rng())
      const centerY = clamp(0.75 + rng() * 1.15, minY + ry + 0.06, maxY - ry - 0.06)

      emitBrokenCollarAndCavity(spallAcc, cavityAcc, wallWorld, site.dir, rng, wallTone, {
        centerT,
        centerY,
        rx,
        ry,
        minT,
        maxT,
        minY,
        maxY,
        peakDepth: 0.032 + rng() * 0.009,
        coreDepth: 0.0085,
        segments: 10,
      })

      // Two radiating stress cracks
      for (let cIdx = 0; cIdx < 2; cIdx += 1) {
        const ang = cIdx === 0 ? -0.35 + (rng() - 0.5) * 0.5 : Math.PI + (rng() - 0.5) * 0.5
        emitCrackChain(crackAcc, spallAcc, wallWorld, site.dir, rng, wallTone, {
          startT: clamp(centerT + Math.cos(ang) * rx * 0.78, minT, maxT),
          startY: clamp(centerY + Math.sin(ang) * ry * 0.78, minY, maxY),
          angle: ang,
          segments: 5,
          stepLen: 0.12,
          baseHalfW: 0.015,
          minT,
          maxT,
          minY,
          maxY,
          addChippedShoulder: true,
        })
      }

      if (allowFloorChips) {
        const chips = 1 + Math.floor(rng() * 3)
        for (let k = 0; k < chips; k += 1) {
          emitGroundedWallFootChip(
            spallAcc,
            wallWorld,
            site.dir,
            rng,
            wallTone,
            centerT + (rng() - 0.5) * rx * 1.2,
            minT,
            maxT
          )
          rubbleChipCount += 1
        }
      }
    } else if (profile === DETERIORATION_PROFILES.EXPOSED_REBAR_BREAK) {
      const rx = clamp(0.42 + rng() * 0.18, 0.3, spanT * 0.42)
      const ry = 0.32 + rng() * 0.16
      const centerT = lerp(minT + rx + 0.04, maxT - rx - 0.04, rng())
      const centerY = clamp(0.85 + rng() * 1.0, minY + ry + 0.06, maxY - ry - 0.06)

      emitBrokenCollarAndCavity(spallAcc, cavityAcc, wallWorld, site.dir, rng, wallTone, {
        centerT,
        centerY,
        rx,
        ry,
        minT,
        maxT,
        minY,
        maxY,
        peakDepth: 0.035 + rng() * 0.008,
        coreDepth: 0.0085,
        segments: 10,
      })

      // 2-3 corroded rebar rods recessed inside cavity pocket (never protruding beyond collar rim)
      const horizontal = rng() < 0.45
      const rodCount = 2 + (rng() < 0.35 ? 1 : 0)
      const rodRad = 0.012
      for (let b = 0; b < rodCount; b += 1) {
        const frac = rodCount === 1 ? 0 : (b / (rodCount - 1) - 0.5) * 0.85
        const bendOut = 0.02 + rng() * 0.008
        const anchorD = 0.004
        if (horizontal) {
          const yBar = clamp(centerY + frac * ry * 0.55, minY + 0.06, maxY - 0.06)
          const tL = clamp(centerT - rx * 0.54, minT + 0.04, maxT - 0.04)
          const tR = clamp(centerT + rx * 0.54, minT + 0.04, maxT - 0.04)
          const tMid = lerp(tL, tR, 0.45 + rng() * 0.15)
          const p0 = toWorldPoint(wallWorld, site.dir, tL, yBar, anchorD)
          const pMid = toWorldPoint(wallWorld, site.dir, tMid, yBar + (rng() - 0.5) * 0.025, bendOut)
          const p1 = toWorldPoint(wallWorld, site.dir, tR, yBar, anchorD)
          emitRebarSegment(rebarAcc, p0, pMid, rodRad, 5)
          emitRebarSegment(rebarAcc, pMid, p1, rodRad, 5)
        } else {
          const tBar = clamp(centerT + frac * rx * 0.55, minT + 0.05, maxT - 0.05)
          const yBot = clamp(centerY - ry * 0.56, minY + 0.04, maxY - 0.04)
          const yTop = clamp(centerY + ry * 0.56, minY + 0.04, maxY - 0.04)
          const yMid = lerp(yBot, yTop, 0.45 + rng() * 0.15)
          const p0 = toWorldPoint(wallWorld, site.dir, tBar, yBot, anchorD)
          const pMid = toWorldPoint(wallWorld, site.dir, tBar + (rng() - 0.5) * 0.025, yMid, bendOut)
          const p1 = toWorldPoint(wallWorld, site.dir, tBar, yTop, anchorD)
          emitRebarSegment(rebarAcc, p0, pMid, rodRad, 5)
          emitRebarSegment(rebarAcc, pMid, p1, rodRad, 5)
        }
        rebarRodCount += 1
      }

      if (allowFloorChips) {
        const chips = 1 + Math.floor(rng() * 2)
        for (let k = 0; k < chips; k += 1) {
          emitGroundedWallFootChip(
            spallAcc,
            wallWorld,
            site.dir,
            rng,
            wallTone,
            centerT + (rng() - 0.5) * rx,
            minT,
            maxT
          )
          rubbleChipCount += 1
        }
      }
    }
  }

  const group = new THREE.Group()
  group.name = 'maze-structural-deterioration'

  const cast3dShadows = qualityPreset !== 'performance'
  const spallMesh = finalizeChunkedAccumulatorNode(
    spallAccs,
    mats.spallConcrete,
    'deterioration-concrete-spall',
    chunkLayout,
    { castShadow: cast3dShadows, receiveShadow: true }
  )
  const cavityMesh = finalizeChunkedAccumulatorNode(
    cavityAccs,
    mats.cavityInterior,
    'deterioration-cavity-core',
    chunkLayout,
    { castShadow: false, receiveShadow: true }
  )
  const crackMesh = finalizeChunkedAccumulatorNode(
    crackAccs,
    mats.fracturedCrack,
    'deterioration-crack-fissures',
    chunkLayout,
    { castShadow: false, receiveShadow: true }
  )
  const rebarMesh = finalizeChunkedAccumulatorNode(
    rebarAccs,
    mats.exposedRebar,
    'deterioration-exposed-rebar',
    chunkLayout,
    // Micro-diameter corroded rebar rods sit recessed inside wall cavity pockets
    { castShadow: false, receiveShadow: true }
  )

  const meshNames = []
  for (const m of [spallMesh, cavityMesh, crackMesh, rebarMesh]) {
    if (m) {
      group.add(m)
      meshNames.push(m.name)
    }
  }

  if (group.children.length === 0) {
    return null
  }

  group.userData = {
    totalSites: selected.length,
    profileCounts,
    rubbleChipCount,
    rebarRodCount,
    meshNames,
  }

  return group
}

export function syncStructuralDeteriorationQuality(deteriorationGroup, qualityPreset = 'high') {
  if (!deteriorationGroup) return false
  const mats = getStructuralDeteriorationMaterials({ qualityPreset })
  const byName = {
    'deterioration-concrete-spall': mats.spallConcrete,
    'deterioration-cavity-core': mats.cavityInterior,
    'deterioration-crack-fissures': mats.fracturedCrack,
    'deterioration-exposed-rebar': mats.exposedRebar,
  }
  deteriorationGroup.traverse((node) => {
    if (!node.isMesh) return
    const layerName = node.userData?.layerName || node.name
    const nextMat = byName[layerName]
    if (nextMat && node.material !== nextMat) {
      node.material = nextMat
    }
  })
  return true
}
