import * as THREE from 'three'
import { CELL_SIZE } from '../world/worldCoords.js'
import {
  CEILING_COLLAPSE_CONSTANTS,
  ELECTRICAL_WIRING_CONSTANTS,
  FALLING_PIPES_CONSTANTS,
  FLOOR_GRATE_CONSTANTS,
  HAZARD_TYPES,
  STEAM_PIPE_CONSTANTS,
  SUSPENDED_MACHINERY_CONSTANTS,
  VENTILATION_DUCT_CONSTANTS,
  WALL_COLLAPSE_CONSTANTS,
  WATER_TANK_CONSTANTS,
} from '../generation/hazardPlacement.js'
import {
  isSharedResource,
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'
import {
  CEILING_VENT_PALETTE,
  getGalvanizedMetalTextureSet,
} from './buildCeilingVents.js'
import { MAZE_CEILING_CONFIG, MAZE_CEILING_PALETTE } from './buildMazeCeiling.js'
import { STRUCTURAL_DETERIORATION_PALETTE } from './buildStructuralDeterioration.js'
import { getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { getEnvironmentalPropMaterials } from './buildEnvironmentalProps.js'
import { mergeIndexedGeometries } from './geometryOptimization.js'
import { createMazeChunkLayout } from './spatialChunking.js'

function pushChunkedInstancedBatch(
  meshes,
  chunkLayout,
  baseName,
  geometry,
  material,
  chunkMatrices,
  { castShadow = false, receiveShadow = true } = {}
) {
  const nonEmptyChunks = []
  for (let cIdx = 0; cIdx < chunkMatrices.length; cIdx += 1) {
    if (chunkMatrices[cIdx].length > 0) {
      nonEmptyChunks.push({ chunkIndex: cIdx, matrices: chunkMatrices[cIdx] })
    }
  }
  if (nonEmptyChunks.length === 0) return

  const splitAcrossChunks = chunkLayout.isChunked && nonEmptyChunks.length > 1
  for (let i = 0; i < nonEmptyChunks.length; i += 1) {
    const entry = nonEmptyChunks[i]
    const matrices = entry.matrices
    const count = matrices.length
    const chunkMeta = chunkLayout.chunks[entry.chunkIndex]
    const inst = new THREE.InstancedMesh(geometry, material, count)
    inst.name =
      splitAcrossChunks && chunkMeta
        ? `${baseName}-chunk-${chunkMeta.cx}-${chunkMeta.cz}`
        : baseName
    inst.castShadow = Boolean(castShadow)
    inst.receiveShadow = Boolean(receiveShadow)
    inst.frustumCulled = true
    for (let k = 0; k < count; k += 1) {
      inst.setMatrixAt(k, matrices[k])
    }
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingBox()
    inst.computeBoundingSphere()
    inst.userData = {
      layerName: baseName,
      isSpatialChunk: splitAcrossChunks,
      chunkIndex: chunkMeta ? chunkMeta.index : entry.chunkIndex,
      chunkX: chunkMeta ? chunkMeta.cx : 0,
      chunkZ: chunkMeta ? chunkMeta.cz : 0,
      ...(splitAcrossChunks && chunkMeta
        ? {
            chunkBounds: {
              minX: chunkMeta.minX,
              maxX: chunkMeta.maxX,
              minZ: chunkMeta.minZ,
              maxZ: chunkMeta.maxZ,
            },
          }
        : null),
    }
    meshes.push(inst)
  }
}

export const HAZARD_PALETTE = {
  ceilingConcrete: MAZE_CEILING_PALETTE.deck,
  ceilingSpall: STRUCTURAL_DETERIORATION_PALETTE.spallConcrete,
  ceilingCavity: STRUCTURAL_DETERIORATION_PALETTE.cavityInterior,
  ceilingCrack: STRUCTURAL_DETERIORATION_PALETTE.fracturedCrack,
  ceilingRebar: STRUCTURAL_DETERIORATION_PALETTE.exposedRebar,
  ceilingDust: 0x7d8896,
  wiringConduit: 0x4c5868,
  wiringHardware: 0x2b3440,
  wiringCable: 0x1a1f27,
  wiringCopper: 0xc8743a,
  wiringCaution: 0xb48a28,
  wiringSparkWarning: 0xffdf73,
  wiringSparkActive: 0xbae6fd,
  wiringArcActive: 0x93e5ff,
  wiringCharred: 0x1b1d21,
  gratePit: 0x05080e,
  grateSubPipe: 0x151e2b,
  grateCurb: 0x262f3b,
  grateIron: 0x353f4c,
  grateRust: 0x4b2f21,
  grateBolt: 0x5c6773,
  grateDust: 0x8d97a4,
  wallConcrete: STRUCTURAL_DETERIORATION_PALETTE.spallConcrete,
  wallCavity: STRUCTURAL_DETERIORATION_PALETTE.cavityInterior,
  wallCrack: STRUCTURAL_DETERIORATION_PALETTE.fracturedCrack,
  wallRebar: STRUCTURAL_DETERIORATION_PALETTE.exposedRebar,
  wallRubble: 0x2e3f59,
  wallDust: 0x8f9aa8,
  tankSteel: 0x3b4a59,
  tankRust: 0x5c3422,
  tankBracket: 0x2a333e,
  tankPipe: 0x465564,
  tankSeam: 0x151e27,
  waterLeak: 0x67b7d8,
  waterSurge: 0x2b6f8c,
  waterPuddle: 0x1a465c,
  machineryGantry: 0x1e2a3c,
  machineryHousing: 0x3b4856,
  machineryStripe: 0xb58524,
  machineryChain: 0x4d5764,
  machineryRust: 0x563222,
  machineryDust: 0x8a95a3,
  ductGalvanized: CEILING_VENT_PALETTE.ductSteel,
  ductHardware: CEILING_VENT_PALETTE.hardwareIron,
  ductCavity: CEILING_VENT_PALETTE.cavityVoid,
  ductRust: 0x573422,
  ductDust: 0x8e98a4,
}

const hazardGeoPool = new Map()
const hazardMatPool = new Map()

function getPooledGeometry(key, factory) {
  let geo = hazardGeoPool.get(key)
  if (!geo) {
    geo = markSharedResource(factory())
    hazardGeoPool.set(key, geo)
  }
  return geo
}

function getPooledMaterial(key, factory) {
  let mat = hazardMatPool.get(key)
  if (!mat) {
    mat = markSharedResource(factory())
    hazardMatPool.set(key, mat)
  }
  return mat
}

export function disposeHazardPools() {
  for (const geo of hazardGeoPool.values()) {
    geo?.dispose?.()
  }
  hazardGeoPool.clear()

  for (const mat of hazardMatPool.values()) {
    mat?.dispose?.()
  }
  hazardMatPool.clear()
}

export function getHazardPoolStats() {
  return {
    geometries: hazardGeoPool.size,
    materials: hazardMatPool.size,
  }
}

registerSharedPoolClearer(disposeHazardPools)

function createFracturedConcreteGeometry(seed, flatBias = 1) {
  const geo = new THREE.DodecahedronGeometry(0.5, 0)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i += 1) {
    const vx = pos.getX(i)
    const vy = pos.getY(i)
    const vz = pos.getZ(i)
    // Quantize direction key so shared vertices stay watertight
    const kx = Math.round(vx * 100)
    const ky = Math.round(vy * 100)
    const kz = Math.round(vz * 100)
    let h = (kx * 73856093) ^ (ky * 19349663) ^ (kz * 83492791) ^ (seed * 2654435761)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const n = ((h ^ (h >>> 16)) >>> 0) / 4294967295
    const radialScale = 0.84 + n * 0.28
    const yScale = (0.78 + ((n * 1.7) % 1) * 0.34) * flatBias
    pos.setXYZ(i, vx * radialScale, vy * yScale, vz * radialScale)
  }
  geo.computeBoundingBox()
  const bb = geo.boundingBox
  if (bb) {
    const cx = (bb.min.x + bb.max.x) * 0.5
    const cy = (bb.min.y + bb.max.y) * 0.5
    const cz = (bb.min.z + bb.max.z) * 0.5
    const sx = Math.max(1e-4, bb.max.x - bb.min.x)
    const sy = Math.max(1e-4, bb.max.y - bb.min.y)
    const sz = Math.max(1e-4, bb.max.z - bb.min.z)
    geo.translate(-cx, -cy, -cz)
    geo.scale(1 / sx, 1 / sy, 1 / sz)
  }
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

export function computeMinGroundedCenterY(halfX, halfY, halfZ, rx, ry, rz) {
  const sinX = Math.sin(rx)
  const cosX = Math.cos(rx)
  const sinY = Math.sin(ry)
  const cosY = Math.cos(ry)
  const sinZ = Math.sin(rz)
  const cosZ = Math.cos(rz)
  const r21 = Math.abs(cosX * sinZ + sinX * sinY * cosZ)
  const r22 = Math.abs(cosX * cosZ - sinX * sinY * sinZ)
  const r23 = Math.abs(-sinX * cosY)
  return halfX * r21 + halfY * r22 + halfZ * r23 + 0.004
}

function evalFurnitureShelfPoint(lx, ly, lzRel, pitch, roll, pivotX, pivotY, pivotZ, out) {
  const cosP = Math.cos(pitch)
  const sinP = Math.sin(pitch)
  const cosR = Math.cos(roll)
  const sinR = Math.sin(roll)
  const x1 = lx * cosR - ly * sinR
  const y1 = lx * sinR + ly * cosR
  const z1 = lzRel
  out.x = pivotX + x1
  out.y = pivotY + y1 * cosP - z1 * sinP
  out.z = pivotZ + y1 * sinP + z1 * cosP
}

export const ROTTEN_FURNITURE_HANDLING_LIMITS = Object.freeze({
  minDispZ: -3.16,
  maxDispZ: 0.22,
  wallSlideThresholdZ: -0.64,
  clearedThresholdDispZ: -2.95,
})

/**
 * Evaluates the continuous physical pose, 3D pivot transform, and local OBB collision bounds
 * for a collapsed Rotten Furniture Collapse shelving rack at displacement `(dispLocalX, dispLocalZ)`
 * in the hazard's wall-aligned local coordinate system (`localX` along corridor, `localZ` across corridor).
 */
export function computeRottenFurniturePose(params = {}, dispLocalX = 0, dispLocalZ = 0) {
  const pivotX = Number.isFinite(params.pivotX) ? params.pivotX : 0
  const spanHalfW = Number.isFinite(params.spanHalfW) ? params.spanHalfW : 2.6
  const rackHeight = Number.isFinite(params.rackHeight) ? params.rackHeight : 2.94
  const rackDepth = Number.isFinite(params.rackDepth) ? params.rackDepth : 0.46
  const fallenPivotZ = Number.isFinite(params.fallenPivotZ) ? params.fallenPivotZ : -1.26
  const clearedPivotZ = Number.isFinite(params.clearedPivotZ) ? params.clearedPivotZ : -1.52
  const collapsedPitch = Number.isFinite(params.collapsedPitch)
    ? params.collapsedPitch
    : Math.PI * 0.5
  const fallenYaw = Number.isFinite(params.fallenYaw) ? params.fallenYaw : 0.014
  const clearedPitch = Number.isFinite(params.clearedPitch) ? params.clearedPitch : 0.016
  const clearedYaw = Number.isFinite(params.clearedYaw) ? params.clearedYaw : -0.006
  const clearedRoll = Number.isFinite(params.clearedRoll) ? params.clearedRoll : -0.005

  const clampedDispZ = Math.max(
    ROTTEN_FURNITURE_HANDLING_LIMITS.minDispZ,
    Math.min(ROTTEN_FURNITURE_HANDLING_LIMITS.maxDispZ, Number(dispLocalZ) || 0)
  )
  const clampedDispX = Number.isFinite(dispLocalX) ? dispLocalX : 0
  const curPivotX = pivotX + clampedDispX

  let compactionT = 0
  let pitch = collapsedPitch
  let yaw = fallenYaw
  let roll = 0
  let curPivotZ = fallenPivotZ + clampedDispZ

  if (clampedDispZ < ROTTEN_FURNITURE_HANDLING_LIMITS.wallSlideThresholdZ) {
    const wallSpan =
      ROTTEN_FURNITURE_HANDLING_LIMITS.wallSlideThresholdZ -
      ROTTEN_FURNITURE_HANDLING_LIMITS.minDispZ
    compactionT = Math.max(
      0,
      Math.min(
        1,
        (ROTTEN_FURNITURE_HANDLING_LIMITS.wallSlideThresholdZ - clampedDispZ) / wallSpan
      )
    )
    const sinCleared = Math.sin(clearedPitch)
    const sinPitch = Math.max(
      sinCleared,
      Math.min(1, 1 - compactionT * (1 - sinCleared))
    )
    pitch = Math.asin(sinPitch)
    const cosPitch = Math.cos(pitch)
    curPivotZ = -1.9 + (clearedPivotZ - -1.9) * cosPitch
    yaw = fallenYaw + (clearedYaw - fallenYaw) * compactionT
    roll = clearedRoll * compactionT
  }

  const sinP = Math.sin(pitch)
  const cosP = Math.cos(pitch)
  const curPivotY =
    spanHalfW *
      (Math.abs(Math.sin(roll)) * Math.abs(cosP) +
        Math.abs(Math.sin(yaw)) * Math.abs(sinP)) +
    0.005 * Math.sin(Math.max(0, Math.min(Math.PI * 0.5, pitch)))

  const minLocalZ = Math.max(-1.98, curPivotZ - rackDepth * cosP)
  const maxLocalZ = Math.min(1.94, curPivotZ + rackHeight * sinP)
  const centerLocalZ = 0.5 * (minLocalZ + maxLocalZ)
  const halfD = Math.max(0.25, 0.5 * (maxLocalZ - minLocalZ))
  const centerLocalX = curPivotX
  const halfW = spanHalfW
  const minLocalX = centerLocalX - halfW
  const maxLocalX = centerLocalX + halfW
  const pushProgress = Math.max(
    0,
    Math.min(1, -clampedDispZ / -ROTTEN_FURNITURE_HANDLING_LIMITS.minDispZ)
  )
  const gripHeightY = Math.max(0.46, Math.min(1.06, 0.46 + 0.56 * compactionT))
  const corridorClearance = 2.0 - maxLocalZ
  const maxY = curPivotY + rackHeight * cosP + rackDepth * sinP

  return {
    dispLocalX: clampedDispX,
    dispLocalZ: clampedDispZ,
    curPivotX,
    curPivotY,
    curPivotZ,
    pitch,
    yaw,
    roll,
    compactionT,
    pushProgress,
    minLocalX,
    maxLocalX,
    minLocalZ,
    maxLocalZ,
    centerLocalX,
    centerLocalZ,
    halfW,
    halfD,
    gripHeightY,
    corridorClearance,
    maxY,
  }
}

const _wiringArcUp = new THREE.Vector3(0, 1, 0)
const _wiringArcDir = new THREE.Vector3()

function buildMergedWiringParts(parts) {
  const built = []
  for (let i = 0; i < parts.length; i += 1) {
    const [geo, opts = {}] = parts[i]
    if (!geo) continue
    if (opts.rx) geo.rotateX(opts.rx)
    if (opts.ry) geo.rotateY(opts.ry)
    if (opts.rz) geo.rotateZ(opts.rz)
    if (opts.x || opts.y || opts.z) {
      geo.translate(opts.x || 0, opts.y || 0, opts.z || 0)
    }
    if (opts.postRx) geo.rotateX(opts.postRx)
    if (opts.postRy) geo.rotateY(opts.postRy)
    if (opts.postRz) geo.rotateZ(opts.postRz)
    if (opts.postX || opts.postY || opts.postZ) {
      geo.translate(opts.postX || 0, opts.postY || 0, opts.postZ || 0)
    }
    built.push(geo)
  }
  const merged = mergeIndexedGeometries(built)
  for (let i = 0; i < built.length; i += 1) {
    built[i].dispose()
  }
  return merged
}

function mergeGrateBoxSpecs(specs) {
  const parts = []
  for (let i = 0; i < specs.length; i += 1) {
    const s = specs[i]
    const g = new THREE.BoxGeometry(s.sx, s.sy, s.sz)
    if (s.rx || s.ry || s.rz) {
      g.rotateX(s.rx || 0)
      g.rotateY(s.ry || 0)
      g.rotateZ(s.rz || 0)
    }
    g.translate(s.x || 0, s.y || 0, s.z || 0)
    parts.push(g)
  }
  const merged = mergeIndexedGeometries(parts)
  for (let i = 0; i < parts.length; i += 1) {
    parts[i].dispose()
  }
  return merged
}

function getFloorGrateSharedAssets(qualityPreset = 'high') {
  const envMats = getEnvironmentalPropMaterials({ qualityPreset })
  const ix = FLOOR_GRATE_CONSTANTS.pitInnerHalfW // 0.58
  const iz = FLOOR_GRATE_CONSTANTS.pitInnerHalfD // 0.64
  const ox = FLOOR_GRATE_CONSTANTS.frameOuterHalfW // 0.67
  const oz = FLOOR_GRATE_CONSTANTS.frameOuterHalfD // 0.73
  const pitDepth = FLOOR_GRATE_CONSTANTS.pitDepth // 0.68

  const pitMat = getPooledMaterial(
    'grate:pit',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.gratePit,
        roughness: 0.98,
        metalness: 0.02,
      })
  )
  const subPipeMat = getPooledMaterial(
    'grate:subPipe',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.grateSubPipe,
        roughness: 0.86,
        metalness: 0.4,
      })
  )
  const boltMat = envMats.darkSteel

  const wallT = ox - ix // 0.09m concrete shaft lining thickness
  const wallH = pitDepth + 0.028 // 0.708m (-0.710..-0.002)
  const wallCenterY = -0.002 - wallH * 0.5
  const shaftConcreteGeo = getPooledGeometry('grate:shaftConcrete', () =>
    mergeGrateBoxSpecs([
      { x: 0, y: wallCenterY, z: -(iz + wallT * 0.5), sx: ox * 2, sy: wallH, sz: wallT },
      { x: 0, y: wallCenterY, z: iz + wallT * 0.5, sx: ox * 2, sy: wallH, sz: wallT },
      { x: -(ix + wallT * 0.5), y: wallCenterY, z: 0, sx: wallT, sy: wallH, sz: iz * 2 },
      { x: ix + wallT * 0.5, y: wallCenterY, z: 0, sx: wallT, sy: wallH, sz: iz * 2 },
      // Sump concrete foundation slab below -0.68m sump surface
      { x: 0, y: -(pitDepth + 0.018), z: 0, sx: ox * 2, sy: 0.036, sz: oz * 2 },
    ])
  )

  const pitSumpGeo = getPooledGeometry(
    'grate:pitSump',
    () => new THREE.BoxGeometry(ix * 1.98, 0.018, iz * 1.98)
  )

  const subPipeGeo = getPooledGeometry('grate:subPipe', () => {
    const parts = []
    for (const px of [-0.23, 0.23]) {
      const pipe = new THREE.CylinderGeometry(0.036, 0.036, iz * 1.96, 8)
      pipe.rotateX(Math.PI * 0.5)
      pipe.translate(px, -0.56, 0)
      parts.push(pipe)
      for (const fz of [-0.46, 0.46]) {
        const collar = new THREE.CylinderGeometry(0.052, 0.052, 0.035, 8)
        collar.rotateX(Math.PI * 0.5)
        collar.translate(px, -0.56, fz)
        parts.push(collar)
      }
    }
    const crossHeader = new THREE.CylinderGeometry(0.03, 0.03, ix * 1.96, 8)
    crossHeader.rotateZ(Math.PI * 0.5)
    crossHeader.translate(0, -0.44, -0.34)
    parts.push(crossHeader)
    const merged = mergeIndexedGeometries(parts)
    for (let i = 0; i < parts.length; i += 1) parts[i].dispose()
    return merged
  })

  // Flush embedded steel angle-iron frame & lower bearing lip
  const frameW = ox - ix
  const frameD = oz - iz
  const curbFrameGeo = getPooledGeometry('grate:curbFrame', () =>
    mergeGrateBoxSpecs([
      // Top flush perimeter rails (y = -0.002 .. +0.014)
      { x: 0, y: 0.006, z: -(iz + frameD * 0.5), sx: ox * 2, sy: 0.016, sz: frameD },
      { x: 0, y: 0.006, z: iz + frameD * 0.5, sx: ox * 2, sy: 0.016, sz: frameD },
      { x: -(ix + frameW * 0.5), y: 0.006, z: 0, sx: frameW, sy: 0.016, sz: iz * 2 },
      { x: ix + frameW * 0.5, y: 0.006, z: 0, sx: frameW, sy: 0.016, sz: iz * 2 },
      // Inner grate support seat ledge (y = -0.018 .. -0.002)
      { x: 0, y: -0.01, z: -(iz - 0.025), sx: ix * 2, sy: 0.016, sz: 0.05 },
      { x: 0, y: -0.01, z: iz - 0.025, sx: ix * 2, sy: 0.016, sz: 0.05 },
      { x: -(ix - 0.022), y: -0.01, z: 0, sx: 0.044, sy: 0.016, sz: (iz - 0.05) * 2 },
      { x: ix - 0.022, y: -0.01, z: 0, sx: 0.044, sy: 0.016, sz: (iz - 0.05) * 2 },
    ])
  )

  // Single open bar-grating leaf anchored at hinge (0,0,0), extending +X to +0.55m
  const leafSpanX = 0.55
  const leafHalfZ = iz - 0.025 // 0.615m
  const leafSteelGeo = getPooledGeometry('grate:leafSteel', () => {
    const specs = [
      // Hinge side rail
      { x: 0.018, y: 0, z: 0, sx: 0.036, sy: 0.022, sz: leafHalfZ * 2 },
      // Three longitudinal tie rods
      { x: 0.19, y: -0.002, z: 0, sx: 0.018, sy: 0.016, sz: leafHalfZ * 1.98 },
      { x: 0.36, y: -0.002, z: 0, sx: 0.018, sy: 0.016, sz: leafHalfZ * 1.98 },
      { x: 0.534, y: 0, z: 0, sx: 0.03, sy: 0.022, sz: leafHalfZ * 2 },
    ]
    const barZs = [-0.51, -0.34, -0.17, 0, 0.17, 0.34, 0.51]
    for (let i = 0; i < barZs.length; i += 1) {
      specs.push({
        x: leafSpanX * 0.5,
        y: 0,
        z: barZs[i],
        sx: leafSpanX,
        sy: 0.02,
        sz: 0.024,
      })
    }
    return mergeGrateBoxSpecs(specs)
  })

  const seamRustGeo = getPooledGeometry('grate:seamRust', () =>
    mergeGrateBoxSpecs([
      { x: 0.534, y: 0.001, z: 0, sx: 0.034, sy: 0.023, sz: leafHalfZ * 1.92 },
      { x: leafSpanX * 0.5, y: 0.001, z: 0, sx: leafSpanX * 0.96, sy: 0.021, sz: 0.028 },
    ])
  )

  const boltGeo = getPooledGeometry(
    'grate:bolt',
    () => new THREE.CylinderGeometry(0.024, 0.024, 0.018, 6)
  )

  const stubGeo = getPooledGeometry(
    'grate:stub',
    () => new THREE.BoxGeometry(0.15, 0.018, 0.034)
  )

  const fragGeo = getPooledGeometry(
    'grate:frag',
    () => new THREE.BoxGeometry(0.042, 0.018, 0.042)
  )

  const debrisGeo = getPooledGeometry(
    'grate:debris',
    () => new THREE.BoxGeometry(0.11, 0.024, 0.042)
  )

  const coverPlateGeo = getPooledGeometry('grate:coverPlate', () => {
    const coverParts = [
      // Heavy flush trench recovery plate covering full 1.38m x 1.50m curb
      { x: 0, y: 0.012, z: 0, sx: ox * 2 + 0.04, sy: 0.02, sz: oz * 2 + 0.04 },
      // Raised stiffener battens
      { x: 0, y: 0.024, z: -0.38, sx: ox * 1.88, sy: 0.012, sz: 0.05 },
      { x: 0, y: 0.024, z: 0, sx: ox * 1.88, sy: 0.012, sz: 0.05 },
      { x: 0, y: 0.024, z: 0.38, sx: ox * 1.88, sy: 0.012, sz: 0.05 },
    ]
    return mergeGrateBoxSpecs(coverParts)
  })

  const dustGeo = getPooledGeometry(
    'grate:dust',
    () => new THREE.SphereGeometry(0.22, 6, 6)
  )

  return {
    ix,
    iz,
    ox,
    oz,
    pitDepth,
    leafSpanX,
    shaftWallMat: envMats.debrisConcrete,
    curbMat: envMats.darkSteel,
    ironMat: envMats.darkSteel,
    rustMat: envMats.rustyMetal,
    pitMat,
    subPipeMat,
    boltMat,
    shaftConcreteGeo,
    pitSumpGeo,
    subPipeGeo,
    curbFrameGeo,
    leafSteelGeo,
    seamRustGeo,
    boltGeo,
    stubGeo,
    fragGeo,
    debrisGeo,
    coverPlateGeo,
    dustGeo,
  }
}

/**
 * Builds visually matching, structurally solid non-hazard floor drain grates
 * (`maze-floor-grate-decoys`) over real floor/plinth cutouts using instanced
 * shared geometries and facility materials.
 */
export function buildFloorGrateDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getFloorGrateSharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5

  const group = new THREE.Group()
  group.name = FLOOR_GRATE_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const shaftsInst = new THREE.InstancedMesh(assets.shaftConcreteGeo, assets.shaftWallMat, count)
  shaftsInst.name = 'floor-grate-decoy-shafts'
  shaftsInst.castShadow = false
  shaftsInst.receiveShadow = true

  const sumpsInst = new THREE.InstancedMesh(assets.pitSumpGeo, assets.pitMat, count)
  sumpsInst.name = 'floor-grate-decoy-sumps'
  sumpsInst.castShadow = false
  sumpsInst.receiveShadow = true

  const pipesInst = new THREE.InstancedMesh(assets.subPipeGeo, assets.subPipeMat, count)
  pipesInst.name = 'floor-grate-decoy-pipes'
  pipesInst.castShadow = false
  pipesInst.receiveShadow = false

  const curbsInst = new THREE.InstancedMesh(assets.curbFrameGeo, assets.curbMat, count)
  curbsInst.name = 'floor-grate-decoy-curbs'
  curbsInst.castShadow = false
  curbsInst.receiveShadow = true

  const leavesInst = new THREE.InstancedMesh(assets.leafSteelGeo, assets.ironMat, count * 2)
  leavesInst.name = 'floor-grate-decoy-leaves'
  leavesInst.castShadow = false
  leavesInst.receiveShadow = true

  const seamsInst = new THREE.InstancedMesh(assets.seamRustGeo, assets.rustMat, count * 2)
  seamsInst.name = 'floor-grate-decoy-seams'
  seamsInst.castShadow = false
  seamsInst.receiveShadow = true

  const boltsInst = new THREE.InstancedMesh(assets.boltGeo, assets.boltMat, count * 4)
  boltsInst.name = 'floor-grate-decoy-bolts'
  boltsInst.castShadow = false
  boltsInst.receiveShadow = false

  const dummy = new THREE.Object3D()
  const localObj = new THREE.Object3D()
  const parentMat = new THREE.Matrix4()
  const worldMat = new THREE.Matrix4()
  const bx = assets.ox - 0.04
  const bz = assets.oz - 0.04
  const boltCoords = [
    [-bx, 0.019, -bz],
    [bx, 0.019, -bz],
    [-bx, 0.019, bz],
    [bx, 0.019, bz],
  ]

  for (let i = 0; i < count; i += 1) {
    const d = decoys[i]
    const cellX = originX + (d.col + 0.5) * CELL_SIZE
    const cellZ = originZ + (d.row + 0.5) * CELL_SIZE
    const cx = cellX + (Number(d.localPitOffset?.x) || 0)
    const cz = cellZ + (Number(d.localPitOffset?.z) || 0)
    const yaw = Number.isFinite(d.grateYaw) ? d.grateYaw : 0

    dummy.position.set(cx, 0, cz)
    dummy.rotation.set(0, yaw, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    parentMat.copy(dummy.matrix)

    shaftsInst.setMatrixAt(i, parentMat)
    pipesInst.setMatrixAt(i, parentMat)
    curbsInst.setMatrixAt(i, parentMat)

    localObj.position.set(0, -(assets.pitDepth - 0.006), 0)
    localObj.rotation.set(0, 0, 0)
    localObj.scale.set(1, 1, 1)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(parentMat, localObj.matrix)
    sumpsInst.setMatrixAt(i, worldMat)

    // Left leaf at -0.56 (+X span), right leaf at +0.56 (rotated PI around Y -> -X span)
    localObj.position.set(-0.56, 0.009, 0)
    localObj.rotation.set(0, 0, 0)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(parentMat, localObj.matrix)
    leavesInst.setMatrixAt(i * 2, worldMat)
    seamsInst.setMatrixAt(i * 2, worldMat)

    localObj.position.set(0.56, 0.009, 0)
    localObj.rotation.set(0, Math.PI, 0)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(parentMat, localObj.matrix)
    leavesInst.setMatrixAt(i * 2 + 1, worldMat)
    seamsInst.setMatrixAt(i * 2 + 1, worldMat)

    for (let b = 0; b < 4; b += 1) {
      const [lx, ly, lz] = boltCoords[b]
      localObj.position.set(lx, ly, lz)
      localObj.rotation.set(0, 0, 0)
      localObj.updateMatrix()
      worldMat.multiplyMatrices(parentMat, localObj.matrix)
      boltsInst.setMatrixAt(i * 4 + b, worldMat)
    }
  }

  for (const inst of [
    shaftsInst,
    sumpsInst,
    pipesInst,
    curbsInst,
    leavesInst,
    seamsInst,
    boltsInst,
  ]) {
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingBox()
    inst.computeBoundingSphere()
    group.add(inst)
  }

  return group
}

const _slabEuler = new THREE.Euler(0, 0, 0, 'XYZ')
const _slabRotMat = new THREE.Matrix4()
const _ductTargetEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const _ductPivotInvEuler = new THREE.Euler(0, 0, 0, 'XYZ')
const _ductTargetQuat = new THREE.Quaternion()
const _ductPivotInvQuat = new THREE.Quaternion()
const _ductLocalQuat = new THREE.Quaternion()
const _ductLocalEuler = new THREE.Euler(0, 0, 0, 'YXZ')

function computeBoxOrientedExtents(halfX, halfY, halfZ, rx, ry, rz) {
  _slabEuler.set(rx, ry, rz, 'XYZ')
  _slabRotMat.makeRotationFromEuler(_slabEuler)
  const e = _slabRotMat.elements
  return {
    extentX: Math.abs(e[0]) * halfX + Math.abs(e[4]) * halfY + Math.abs(e[8]) * halfZ,
    extentY: Math.abs(e[1]) * halfX + Math.abs(e[5]) * halfY + Math.abs(e[9]) * halfZ,
    extentZ: Math.abs(e[2]) * halfX + Math.abs(e[6]) * halfY + Math.abs(e[10]) * halfZ,
  }
}

const WALL_COLLAPSE_SLAB_LAYOUT = [
  { restX: -0.49, restY: 1.77, idxMat: 0 },
  { restX: 0.49, restY: 1.77, idxMat: 1 },
  { restX: -0.49, restY: 0.67, idxMat: 0 },
  { restX: 0.49, restY: 0.67, idxMat: 1 },
]

const WALL_COLLAPSE_CRACK_LAYOUT = [
  { x: 0.0, y: 0.06, rz: 0.14, sy: 1.12 },
  { x: -0.34, y: 0.34, rz: -0.46, sy: 0.82 },
  { x: 0.36, y: 0.24, rz: 0.44, sy: 0.86 },
  { x: -0.28, y: -0.32, rz: 0.56, sy: 0.74 },
  { x: 0.3, y: -0.28, rz: -0.52, sy: 0.78 },
]

function getWallCollapseSharedAssets(qualityPreset = 'high') {
  const surfaceWall = getMazeSurfaceTextureSet({ qualityPreset }).wall
  const envMats = getEnvironmentalPropMaterials({ qualityPreset })
  const wallZ = -CELL_SIZE * 0.5
  const slabW = WALL_COLLAPSE_CONSTANTS.slabWidth
  const slabH = WALL_COLLAPSE_CONSTANTS.slabHeight
  const slabT = WALL_COLLAPSE_CONSTANTS.slabThickness

  const concreteMat = getPooledMaterial(
    'wall_collapse:concrete',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.wallConcrete,
        map: surfaceWall?.map || null,
        roughnessMap: surfaceWall?.roughnessMap || null,
        bumpMap: surfaceWall?.bumpMap || null,
        bumpScale: 0.056,
        roughness: 0.95,
        metalness: 0.015,
        envMapIntensity: 0.48,
      })
  )
  const cavityMat = getPooledMaterial(
    'wall_collapse:cavity',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.wallCavity,
        roughness: 0.98,
        metalness: 0.01,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
  )
  const crackMat = getPooledMaterial(
    'wall_collapse:crack',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.wallCrack,
        roughness: 0.98,
        metalness: 0.0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
  )
  const rebarMat =
    envMats.rustyMetal ||
    getPooledMaterial(
      'wall_collapse:rebar',
      () =>
        new THREE.MeshStandardMaterial({
          color: HAZARD_PALETTE.wallRebar,
          roughness: 0.88,
          metalness: 0.52,
        })
    )
  const rubbleMat = getPooledMaterial(
    'wall_collapse:rubble',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.wallRubble,
        map: surfaceWall?.map || null,
        roughnessMap: surfaceWall?.roughnessMap || null,
        bumpMap: surfaceWall?.bumpMap || null,
        bumpScale: 0.056,
        roughness: 0.95,
        metalness: 0.015,
        envMapIntensity: 0.48,
      })
  )

  const cavityGeo = getPooledGeometry(
    'wall_collapse:cavityPlane',
    () => new THREE.PlaneGeometry(1.94, 2.24)
  )
  const rimFrameGeo = getPooledGeometry('wall_collapse:rimFrame', () =>
    mergeGrateBoxSpecs([
      // Flush weathered mortar & expansion-joint perimeter collar framing recessed veneer bay (|x| <= 1.05, y in [0, 2.425], z <= wallZ + 0.014)
      { x: -1.01, y: 1.22, z: wallZ + 0.006, sx: 0.08, sy: 2.28, sz: 0.012 },
      { x: 1.01, y: 1.22, z: wallZ + 0.006, sx: 0.08, sy: 2.28, sz: 0.012 },
      { x: 0, y: 2.38, z: wallZ + 0.007, sx: 2.1, sy: 0.09, sz: 0.014 },
      { x: 0, y: 0.06, z: wallZ + 0.006, sx: 2.1, sy: 0.12, sz: 0.012 },
      { x: 0, y: 1.22, z: wallZ + 0.005, sx: 1.92, sy: 0.032, sz: 0.01 },
    ])
  )
  const rebarGeo = getPooledGeometry(
    'wall_collapse:rebar',
    () => new THREE.CylinderGeometry(0.012, 0.012, 1.88, 5)
  )
  const slabGeo = getPooledGeometry(
    'wall_collapse:slab',
    () => new THREE.BoxGeometry(slabW, slabH, slabT)
  )
  const crackGeo = getPooledGeometry(
    'wall_collapse:crackStrip',
    () => new THREE.BoxGeometry(0.008, 0.56, 0.002)
  )
  const warnChipGeo = getPooledGeometry('wall_collapse:warnChip', () =>
    createFracturedConcreteGeometry(701, 0.72)
  )
  const rubbleBlockGeo = getPooledGeometry('wall_collapse:rubbleBlock', () =>
    createFracturedConcreteGeometry(709, 0.65)
  )
  const dustGeo = getPooledGeometry(
    'wall_collapse:dust',
    () => new THREE.SphereGeometry(0.32, 7, 7)
  )

  return {
    wallZ,
    slabW,
    slabH,
    slabT,
    concreteMat,
    cavityMat,
    crackMat,
    rebarMat,
    rubbleMat,
    cavityGeo,
    rimFrameGeo,
    rebarGeo,
    slabGeo,
    crackGeo,
    warnChipGeo,
    rubbleBlockGeo,
    dustGeo,
  }
}

/**
 * Builds visually matching, structurally solid non-hazard wall-deterioration veneer
 * panels (`maze-wall-collapse-decoys`) on unoccupied corridor walls using instanced
 * shared geometries and facility materials.
 */
export function buildWallCollapseDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getWallCollapseSharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5
  const wallZ = assets.wallZ
  const slabRestZ = wallZ + assets.slabT * 0.5

  const group = new THREE.Group()
  group.name = WALL_COLLAPSE_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const rimInst = new THREE.InstancedMesh(assets.rimFrameGeo, assets.concreteMat, count)
  rimInst.name = 'wall-collapse-decoy-rim'
  rimInst.castShadow = false
  rimInst.receiveShadow = true

  const slabsEvenInst = new THREE.InstancedMesh(assets.slabGeo, assets.concreteMat, count * 2)
  slabsEvenInst.name = 'wall-collapse-decoy-slabs-even'
  slabsEvenInst.castShadow = false
  slabsEvenInst.receiveShadow = true

  const slabsOddInst = new THREE.InstancedMesh(assets.slabGeo, assets.rubbleMat, count * 2)
  slabsOddInst.name = 'wall-collapse-decoy-slabs-odd'
  slabsOddInst.castShadow = false
  slabsOddInst.receiveShadow = true

  const cracksPerDecoy = WALL_COLLAPSE_CRACK_LAYOUT.length
  const cracksInst = new THREE.InstancedMesh(
    assets.crackGeo,
    assets.crackMat,
    count * cracksPerDecoy
  )
  cracksInst.name = 'wall-collapse-decoy-cracks'
  cracksInst.castShadow = false
  cracksInst.receiveShadow = false

  const dummy = new THREE.Object3D()
  const localObj = new THREE.Object3D()
  const parentMat = new THREE.Matrix4()
  const worldMat = new THREE.Matrix4()
  const crackBaseZ = wallZ + assets.slabT

  for (let i = 0; i < count; i += 1) {
    const d = decoys[i]
    const cellX = originX + (d.col + 0.5) * CELL_SIZE
    const cellZ = originZ + (d.row + 0.5) * CELL_SIZE
    const yaw = Number.isFinite(d.wallYaw) ? d.wallYaw : 0

    dummy.position.set(cellX, 0, cellZ)
    dummy.rotation.set(0, yaw, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    parentMat.copy(dummy.matrix)

    rimInst.setMatrixAt(i, parentMat)

    let evenCursor = 0
    let oddCursor = 0
    for (let s = 0; s < WALL_COLLAPSE_SLAB_LAYOUT.length; s += 1) {
      const sl = WALL_COLLAPSE_SLAB_LAYOUT[s]
      localObj.position.set(sl.restX, sl.restY, slabRestZ)
      localObj.rotation.set(0, 0, 0)
      localObj.scale.set(1, 1, 1)
      localObj.updateMatrix()
      worldMat.multiplyMatrices(parentMat, localObj.matrix)
      if (s % 2 === 0) {
        slabsEvenInst.setMatrixAt(i * 2 + evenCursor, worldMat)
        evenCursor += 1
      } else {
        slabsOddInst.setMatrixAt(i * 2 + oddCursor, worldMat)
        oddCursor += 1
      }
    }

    for (let c = 0; c < cracksPerDecoy; c += 1) {
      const cs = WALL_COLLAPSE_CRACK_LAYOUT[c]
      localObj.position.set(cs.x * 0.95, 1.22 + cs.y * 0.95, crackBaseZ)
      localObj.rotation.set(0, 0, cs.rz)
      localObj.scale.set(0.95, cs.sy * 0.95, 1)
      localObj.updateMatrix()
      worldMat.multiplyMatrices(parentMat, localObj.matrix)
      cracksInst.setMatrixAt(i * cracksPerDecoy + c, worldMat)
    }
  }

  for (const inst of [rimInst, slabsEvenInst, slabsOddInst, cracksInst]) {
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingBox()
    inst.computeBoundingSphere()
    group.add(inst)
  }

  return group
}

const _wtUp = new THREE.Vector3(0, 1, 0)
const _wtDir = new THREE.Vector3()
const _wtQuat = new THREE.Quaternion()
const _wtMat = new THREE.Matrix4()

function createEndpointAlignedStrut(p0, p1, width, depth) {
  const ax = p0[0]
  const ay = p0[1]
  const az = p0[2]
  const bx = p1[0]
  const by = p1[1]
  const bz = p1[2]
  _wtDir.set(bx - ax, by - ay, bz - az)
  const len = _wtDir.length()
  const geo = new THREE.BoxGeometry(width, Math.max(0.02, len), depth)
  if (len > 1e-5) {
    _wtDir.multiplyScalar(1 / len)
    _wtQuat.setFromUnitVectors(_wtUp, _wtDir)
    _wtMat.makeRotationFromQuaternion(_wtQuat)
    _wtMat.setPosition((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5)
    geo.applyMatrix4(_wtMat)
  } else {
    geo.translate(ax, ay, az)
  }
  return geo
}

function getWaterTankSharedAssets(qualityPreset = 'high') {
  const envMats = getEnvironmentalPropMaterials({ qualityPreset })
  const ceilingAnchorY = WATER_TANK_CONSTANTS.ceilingAnchorY
  const wallZ = -CELL_SIZE * 0.5
  const plateZ = wallZ + 0.03
  const trapezeY = 3.0
  const strapRestY = 2.74

  const steelMat = envMats.darkSteel
  const rustMat = envMats.rustyMetal
  const seamMat = getPooledMaterial(
    'water_tank:seam',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.tankSeam,
        roughness: 0.96,
        metalness: 0.12,
      })
  )
  const decoyLeakMat = getPooledMaterial(
    'water_tank:decoyLeak',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.waterLeak,
        roughness: 0.14,
        metalness: 0.12,
        transparent: true,
        opacity: WATER_TANK_CONSTANTS.decoyDripOpacity,
        depthWrite: false,
      })
  )

  const ceilingRigGeo = getPooledGeometry('water_tank:ceilingRig', () =>
    buildMergedWiringParts([
      // Flush ceiling soffit anchor plates (top at y = 3.60)
      [new THREE.BoxGeometry(0.24, 0.04, 0.24), { x: -0.44, y: ceilingAnchorY - 0.02, z: 0 }],
      [new THREE.BoxGeometry(0.24, 0.04, 0.24), { x: 0.44, y: ceilingAnchorY - 0.02, z: 0 }],
      // Vertical threaded hanger rods from soffit plates to trapeze beam
      [new THREE.CylinderGeometry(0.024, 0.024, 0.58, 6), { x: -0.44, y: 3.29, z: 0 }],
      [new THREE.CylinderGeometry(0.024, 0.024, 0.58, 6), { x: 0.44, y: 3.29, z: 0 }],
      // Horizontal trapeze I-beam strictly below ceiling girders (beamBottomY = 3.04)
      [new THREE.BoxGeometry(1.26, 0.075, 0.16), { x: 0, y: trapezeY, z: 0 }],
      // Overhead strap clevis brackets
      [new THREE.BoxGeometry(0.09, 0.06, 0.12), { x: -0.44, y: trapezeY - 0.045, z: 0 }],
      [new THREE.BoxGeometry(0.09, 0.06, 0.12), { x: 0.44, y: trapezeY - 0.045, z: 0 }],
    ])
  )

  const wallBraceGeo = getPooledGeometry('water_tank:wallBrace', () => {
    const parts = [
      // Lower and upper wall ledger anchor plates flush against wallZ = -2.0
      [new THREE.BoxGeometry(1.12, 0.28, 0.06), { x: 0, y: 2.68, z: plateZ }],
      [new THREE.BoxGeometry(1.12, 0.12, 0.06), { x: 0, y: trapezeY, z: plateZ }],
      // 4 anchor bolts
      [new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), { rx: Math.PI * 0.5, x: -0.44, y: 2.74, z: plateZ + 0.04 }],
      [new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), { rx: Math.PI * 0.5, x: 0.44, y: 2.74, z: plateZ + 0.04 }],
      [new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), { rx: Math.PI * 0.5, x: -0.44, y: 2.6, z: plateZ + 0.04 }],
      [new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), { rx: Math.PI * 0.5, x: 0.44, y: 2.6, z: plateZ + 0.04 }],
    ]
    for (const sx of [-0.44, 0.44]) {
      // Exact endpoint-to-endpoint diagonal knee brace & horizontal tie-back strut
      parts.push([
        createEndpointAlignedStrut(
          [sx, 2.68, plateZ + 0.015],
          [sx, trapezeY, -0.02],
          0.064,
          0.064
        ),
        {},
      ])
      parts.push([
        createEndpointAlignedStrut(
          [sx, trapezeY, plateZ + 0.015],
          [sx, trapezeY, -0.02],
          0.06,
          0.06
        ),
        {},
      ])
    }
    return buildMergedWiringParts(parts)
  })

  const supplyWallSteelGeo = getPooledGeometry('water_tank:supplyWallSteel', () =>
    buildMergedWiringParts([
      // Vertical riser along back wall grounded cleanly on concrete floor
      [new THREE.CylinderGeometry(0.04, 0.04, 2.94, 8), { x: 0.34, y: 1.47, z: wallZ + 0.11 }],
      // Horizontal overhead feed line from back wall riser to tank center
      [new THREE.CylinderGeometry(0.038, 0.038, 1.84, 8), { rx: Math.PI * 0.5, x: 0.34, y: 2.94, z: -0.97 }],
      // Vertical drop stub into tank inlet collar
      [new THREE.CylinderGeometry(0.038, 0.042, 0.1, 8), { x: 0.34, y: 2.89, z: -0.06 }],
    ])
  )

  const supplyWallTrimGeo = getPooledGeometry('water_tank:supplyWallTrim', () =>
    buildMergedWiringParts([
      // Floor escutcheon collar & wall pipe saddle clamps
      [new THREE.CylinderGeometry(0.085, 0.095, 0.035, 8), { x: 0.34, y: 0.018, z: wallZ + 0.11 }],
      [new THREE.BoxGeometry(0.14, 0.045, 0.1), { x: 0.34, y: 0.88, z: wallZ + 0.05 }],
      [new THREE.BoxGeometry(0.14, 0.045, 0.1), { x: 0.34, y: 1.86, z: wallZ + 0.05 }],
      [new THREE.BoxGeometry(0.14, 0.045, 0.1), { x: 0.34, y: 2.78, z: wallZ + 0.05 }],
      // Upper 90-deg flanged elbow + tank union collar
      [new THREE.SphereGeometry(0.056, 8, 6), { x: 0.34, y: 2.94, z: wallZ + 0.11 }],
      [new THREE.CylinderGeometry(0.072, 0.072, 0.04, 8), { x: 0.34, y: 2.85, z: -0.06 }],
      // In-line shutoff gate valve body, bonnet, handwheel & pressure gauge dial
      [new THREE.CylinderGeometry(0.058, 0.058, 0.12, 8), { rx: Math.PI * 0.5, x: 0.34, y: 2.94, z: -0.58 }],
      [new THREE.CylinderGeometry(0.018, 0.018, 0.11, 6), { rz: Math.PI * 0.5, x: 0.4, y: 2.94, z: -0.58 }],
      [new THREE.TorusGeometry(0.09, 0.016, 6, 10), { ry: Math.PI * 0.5, x: 0.46, y: 2.94, z: -0.58 }],
      [new THREE.CylinderGeometry(0.014, 0.014, 0.09, 6), { x: 0.34, y: 3.0, z: -0.4 }],
      [new THREE.CylinderGeometry(0.048, 0.048, 0.03, 10), { rz: Math.PI * 0.5, x: 0.34, y: 3.06, z: -0.4 }],
    ])
  )

  const supplyCeilingSteelGeo = getPooledGeometry('water_tank:supplyCeilingSteel', () =>
    buildMergedWiringParts([
      // Vertical supply riser dropping from ceiling soffit (y = 3.60) down to tank union
      [new THREE.CylinderGeometry(0.04, 0.042, 0.74, 8), { x: 0.34, y: 3.23, z: -0.06 }],
    ])
  )

  const supplyCeilingTrimGeo = getPooledGeometry('water_tank:supplyCeilingTrim', () =>
    buildMergedWiringParts([
      // Ceiling anchor escutcheon flush at soffitY = 3.60 + tank drop union flange
      [new THREE.CylinderGeometry(0.095, 0.105, 0.04, 8), { x: 0.34, y: ceilingAnchorY - 0.02, z: -0.06 }],
      [new THREE.CylinderGeometry(0.072, 0.072, 0.04, 8), { x: 0.34, y: 2.85, z: -0.06 }],
      // In-line shutoff valve + handwheel + pressure gauge on vertical drop
      [new THREE.CylinderGeometry(0.058, 0.058, 0.12, 8), { x: 0.34, y: 3.16, z: -0.06 }],
      [new THREE.CylinderGeometry(0.018, 0.018, 0.1, 6), { rx: Math.PI * 0.5, x: 0.34, y: 3.16, z: 0.0 }],
      [new THREE.TorusGeometry(0.088, 0.016, 6, 10), { x: 0.34, y: 3.16, z: 0.06 }],
      [new THREE.CylinderGeometry(0.014, 0.014, 0.08, 6), { rz: Math.PI * 0.5, x: 0.4, y: 3.28, z: -0.06 }],
      [new THREE.CylinderGeometry(0.046, 0.046, 0.03, 10), { rx: Math.PI * 0.5, x: 0.44, y: 3.28, z: -0.06 }],
    ])
  )

  const lowerStrapGeo = getPooledGeometry(
    'water_tank:lowerStrap',
    () => new THREE.BoxGeometry(0.075, 0.48, 0.026)
  )

  const tankHullGeo = getPooledGeometry('water_tank:tankHull', () =>
    buildMergedWiringParts([
      [new THREE.CylinderGeometry(WATER_TANK_CONSTANTS.tankRadius, WATER_TANK_CONSTANTS.tankRadius, 1.1, 12), { rz: Math.PI * 0.5 }],
      [(() => { const g = new THREE.SphereGeometry(WATER_TANK_CONSTANTS.tankRadius, 10, 8); g.scale(0.32, 1, 1); return g })(), { x: -0.55 }],
      [(() => { const g = new THREE.SphereGeometry(WATER_TANK_CONSTANTS.tankRadius, 10, 8); g.scale(0.32, 1, 1); return g })(), { x: 0.55 }],
    ])
  )

  const tankTrimGeo = getPooledGeometry('water_tank:tankTrim', () =>
    buildMergedWiringParts([
      // Dual circumferential reinforcing girth bands (outer radius 0.415m)
      [new THREE.TorusGeometry(0.398, 0.017, 6, 14), { ry: Math.PI * 0.5, x: -0.44 }],
      [new THREE.TorusGeometry(0.398, 0.017, 6, 14), { ry: Math.PI * 0.5, x: 0.44 }],
      // Top flanged inlet nozzle stub & inspection port handwheel / lower drain cock
      [new THREE.CylinderGeometry(0.044, 0.056, 0.14, 8), { x: 0.34, y: 0.4, z: -0.06 }],
      [new THREE.CylinderGeometry(0.07, 0.07, 0.028, 8), { x: 0.34, y: 0.42, z: -0.06 }],
      [new THREE.TorusGeometry(0.095, 0.016, 6, 10), { x: -0.32, y: 0.1, z: 0.41 }],
      [new THREE.CylinderGeometry(0.022, 0.026, 0.06, 6), { rx: Math.PI * 0.5, x: -0.32, y: -0.18, z: 0.38 }],
    ])
  )

  const rustPatchGeo = getPooledGeometry(
    'water_tank:rustPatch',
    () => new THREE.BoxGeometry(0.62, 0.2, 0.05)
  )
  const seamGeo = getPooledGeometry(
    'water_tank:seamCrack',
    () => new THREE.BoxGeometry(0.52, 0.048, 0.036)
  )
  const dropGeo = getPooledGeometry(
    'water_tank:droplet',
    () => new THREE.SphereGeometry(0.032, 6, 5)
  )
  const streamGeo = getPooledGeometry(
    'water_tank:leakStream',
    () => new THREE.CylinderGeometry(0.011, 0.02, 1.0, 5)
  )
  const debrisGeo = getPooledGeometry(
    'water_tank:debrisFrag',
    () => new THREE.BoxGeometry(0.16, 0.044, 0.09)
  )
  const surgeSheetGeo = getPooledGeometry(
    'water_tank:surgeSheet',
    () => new THREE.PlaneGeometry(1, 1)
  )
  const crestGeo = getPooledGeometry(
    'water_tank:surgeCrest',
    () => new THREE.CylinderGeometry(0.13, 0.18, 1.0, 8, 1, false, 0, Math.PI)
  )
  const sprayGeo = getPooledGeometry(
    'water_tank:sprayDrop',
    () => new THREE.SphereGeometry(0.06, 6, 5)
  )
  const puddleGeo = getPooledGeometry(
    'water_tank:puddleDisc',
    () => new THREE.CircleGeometry(1, 14)
  )

  return {
    ceilingAnchorY,
    strapRestY,
    steelMat,
    rustMat,
    seamMat,
    decoyLeakMat,
    ceilingRigGeo,
    wallBraceGeo,
    supplyWallSteelGeo,
    supplyWallTrimGeo,
    supplyCeilingSteelGeo,
    supplyCeilingTrimGeo,
    lowerStrapGeo,
    tankHullGeo,
    tankTrimGeo,
    rustPatchGeo,
    seamGeo,
    dropGeo,
    streamGeo,
    debrisGeo,
    surgeSheetGeo,
    crestGeo,
    sprayGeo,
    puddleGeo,
  }
}

const _waterTankDecoyDropDummy = new THREE.Object3D()

function computeWaterTankDecoyFallbackHash(row, col, seedVal) {
  let h = ((row | 0) * 73856093) ^ ((col | 0) * 19349663) ^ ((seedVal | 0) * 83492791)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/**
 * Advances deterministic, subtle occasional condensation drips on non-hazardous
 * water tank decoys using zero per-frame heap allocations.
 */
export function stepWaterTankDecoys(decoysGroup, elapsedSec = 0, options = {}) {
  const ud = decoysGroup?.userData
  const decoyDripsInst = ud?.decoyDripsInst
  const dripStates = ud?.dripStates
  if (!decoyDripsInst || !Array.isArray(dripStates) || dripStates.length === 0) {
    return false
  }

  const reducedMotion = Boolean(options?.reducedMotion)
  const duty = WATER_TANK_CONSTANTS.decoyDripDuty || 0.32
  const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : 0
  let dirty = false

  for (let i = 0; i < dripStates.length; i += 1) {
    const st = dripStates[i]
    if (!st) continue

    if (reducedMotion) {
      if (st.lastVisible !== false) {
        _waterTankDecoyDropDummy.position.set(st.worldX, st.startY, st.worldZ)
        _waterTankDecoyDropDummy.rotation.set(0, 0, 0)
        _waterTankDecoyDropDummy.scale.set(1e-5, 1e-5, 1e-5)
        _waterTankDecoyDropDummy.updateMatrix()
        decoyDripsInst.setMatrixAt(i, _waterTankDecoyDropDummy.matrix)
        st.lastVisible = false
        dirty = true
      }
      continue
    }

    const raw = safeElapsed / st.intervalSec + st.phase
    const cycle = raw - Math.floor(raw)
    if (cycle < duty) {
      const u = cycle / duty
      const dropY = Math.max(0.025, st.startY * (1 - u * u))
      const detachScale = Math.min(1, u * 4.5) * (1 - Math.max(0, u - 0.9) * 5)
      if (detachScale > 1e-4) {
        _waterTankDecoyDropDummy.position.set(st.worldX, dropY, st.worldZ)
        _waterTankDecoyDropDummy.rotation.set(0, 0, 0)
        _waterTankDecoyDropDummy.scale.set(
          0.48 * detachScale,
          0.96 * detachScale,
          0.48 * detachScale
        )
        _waterTankDecoyDropDummy.updateMatrix()
        decoyDripsInst.setMatrixAt(i, _waterTankDecoyDropDummy.matrix)
        st.lastVisible = true
        dirty = true
      } else if (st.lastVisible !== false) {
        _waterTankDecoyDropDummy.position.set(st.worldX, st.startY, st.worldZ)
        _waterTankDecoyDropDummy.rotation.set(0, 0, 0)
        _waterTankDecoyDropDummy.scale.set(1e-5, 1e-5, 1e-5)
        _waterTankDecoyDropDummy.updateMatrix()
        decoyDripsInst.setMatrixAt(i, _waterTankDecoyDropDummy.matrix)
        st.lastVisible = false
        dirty = true
      }
    } else if (st.lastVisible !== false) {
      _waterTankDecoyDropDummy.position.set(st.worldX, st.startY, st.worldZ)
      _waterTankDecoyDropDummy.rotation.set(0, 0, 0)
      _waterTankDecoyDropDummy.scale.set(1e-5, 1e-5, 1e-5)
      _waterTankDecoyDropDummy.updateMatrix()
      decoyDripsInst.setMatrixAt(i, _waterTankDecoyDropDummy.matrix)
      st.lastVisible = false
      dirty = true
    }
  }

  if (dirty) {
    decoyDripsInst.instanceMatrix.needsUpdate = true
  }
  return dirty
}

/**
 * Builds visually matching, structurally sound intact overhead industrial water
 * tanks (`maze-water-tank-decoys`) on unoccupied corridor cells using instanced
 * shared geometries and facility materials. Never deals damage or drops.
 */
export function buildWaterTankDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getWaterTankSharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5

  const group = new THREE.Group()
  group.name = WATER_TANK_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const wallBackedDecoys = []
  const ceilingOnlyDecoys = []
  for (let i = 0; i < count; i += 1) {
    if (decoys[i].mountType === 'ceiling_wall_brace') {
      wallBackedDecoys.push(decoys[i])
    } else {
      ceilingOnlyDecoys.push(decoys[i])
    }
  }

  const ceilingRigInst = new THREE.InstancedMesh(assets.ceilingRigGeo, assets.steelMat, count)
  ceilingRigInst.name = 'water-tank-decoy-ceiling-rig'

  const strapsInst = new THREE.InstancedMesh(assets.lowerStrapGeo, assets.rustMat, count * 2)
  strapsInst.name = 'water-tank-decoy-straps'

  const hullInst = new THREE.InstancedMesh(assets.tankHullGeo, assets.steelMat, count)
  hullInst.name = 'water-tank-decoy-hull'

  const trimInst = new THREE.InstancedMesh(assets.tankTrimGeo, assets.rustMat, count)
  trimInst.name = 'water-tank-decoy-trim'

  const rustPatchInst = new THREE.InstancedMesh(assets.rustPatchGeo, assets.rustMat, count)
  rustPatchInst.name = 'water-tank-decoy-rust-patch'

  const seamInst = new THREE.InstancedMesh(assets.seamGeo, assets.seamMat, count)
  seamInst.name = 'water-tank-decoy-seam'

  const decoyDripsInst = new THREE.InstancedMesh(assets.dropGeo, assets.decoyLeakMat, count)
  decoyDripsInst.name = 'water-tank-decoy-drips'
  decoyDripsInst.frustumCulled = false

  const dummy = new THREE.Object3D()
  const localObj = new THREE.Object3D()
  const tankLocalMat = new THREE.Matrix4()
  const mountMat = new THREE.Matrix4()
  const worldMat = new THREE.Matrix4()
  const dripStates = new Array(count)
  const numericSeed =
    typeof maze.seed === 'number'
      ? maze.seed
      : Number.parseInt(String(maze.seed ?? maze.id ?? 1337), 10) || 1337
  const intervalSpan =
    WATER_TANK_CONSTANTS.decoyDripIntervalMaxSec - WATER_TANK_CONSTANTS.decoyDripIntervalMinSec

  const toWorldMat = (d) => {
    const cx = originX + (d.col + 0.5) * CELL_SIZE
    const cz = originZ + (d.row + 0.5) * CELL_SIZE
    dummy.position.set(cx, 0, cz)
    dummy.rotation.set(0, Number.isFinite(d.tankYaw) ? d.tankYaw : 0, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    return dummy.matrix
  }

  for (let i = 0; i < count; i += 1) {
    const d = decoys[i]
    const restY = Number.isFinite(d.tankRestY) ? d.tankRestY : WATER_TANK_CONSTANTS.tankRestY
    const yaw = Number.isFinite(d.tankYaw) ? d.tankYaw : 0
    const cx = originX + (d.col + 0.5) * CELL_SIZE
    const cz = originZ + (d.row + 0.5) * CELL_SIZE
    mountMat.copy(toWorldMat(d))
    ceilingRigInst.setMatrixAt(i, mountMat)

    localObj.position.set(0, restY, 0)
    localObj.rotation.set(0, 0, 0)
    localObj.scale.set(1, 1, 1)
    localObj.updateMatrix()
    tankLocalMat.multiplyMatrices(mountMat, localObj.matrix)
    hullInst.setMatrixAt(i, tankLocalMat)
    trimInst.setMatrixAt(i, tankLocalMat)

    // Matching lower-front corroded weld seam patch & seam line for 100% static parity
    localObj.position.set(-0.08, -0.25, 0.31)
    localObj.rotation.set(0.56, 0, 0)
    localObj.scale.set(1, 1, 1)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(tankLocalMat, localObj.matrix)
    rustPatchInst.setMatrixAt(i, worldMat)

    localObj.position.set(-0.08, -0.285, 0.325)
    localObj.rotation.set(0.56, 0, 0)
    localObj.scale.set(1, 1, 1)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(tankLocalMat, localObj.matrix)
    seamInst.setMatrixAt(i, worldMat)

    const strapX = [-0.44, 0.44]
    for (let s = 0; s < 2; s += 1) {
      localObj.position.set(strapX[s], assets.strapRestY, 0)
      localObj.rotation.set(0, 0, 0)
      localObj.scale.set(1, 1, 1)
      localObj.updateMatrix()
      worldMat.multiplyMatrices(mountMat, localObj.matrix)
      strapsInst.setMatrixAt(i * 2 + s, worldMat)
    }

    const fallbackH1 = computeWaterTankDecoyFallbackHash(d.row, d.col, numericSeed)
    const fallbackH2 = computeWaterTankDecoyFallbackHash(d.row + 17, d.col + 31, numericSeed + 97)
    const intervalSec = Number.isFinite(d.dripIntervalSec)
      ? d.dripIntervalSec
      : WATER_TANK_CONSTANTS.decoyDripIntervalMinSec + fallbackH1 * intervalSpan
    const phase = Number.isFinite(d.dripPhase) ? d.dripPhase : fallbackH2
    const offX = Number.isFinite(d.dripOffsetX) ? d.dripOffsetX : -0.14
    const offZ = Number.isFinite(d.dripOffsetZ) ? d.dripOffsetZ : 0.29
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)

    dripStates[i] = {
      worldX: cx + offX * cosY + offZ * sinY,
      startY: restY - 0.34,
      worldZ: cz - offX * sinY + offZ * cosY,
      intervalSec,
      phase,
      lastVisible: null,
    }
  }

  group.userData.dripStates = dripStates
  group.userData.decoyDripsInst = decoyDripsInst

  const meshes = [ceilingRigInst, strapsInst, hullInst, trimInst, rustPatchInst, seamInst]

  if (wallBackedDecoys.length > 0) {
    const wc = wallBackedDecoys.length
    const braceInst = new THREE.InstancedMesh(assets.wallBraceGeo, assets.rustMat, wc)
    braceInst.name = 'water-tank-decoy-wall-brace'
    const pipeSteelInst = new THREE.InstancedMesh(assets.supplyWallSteelGeo, assets.steelMat, wc)
    pipeSteelInst.name = 'water-tank-decoy-wall-pipe-steel'
    const pipeTrimInst = new THREE.InstancedMesh(assets.supplyWallTrimGeo, assets.rustMat, wc)
    pipeTrimInst.name = 'water-tank-decoy-wall-pipe-trim'
    for (let i = 0; i < wc; i += 1) {
      mountMat.copy(toWorldMat(wallBackedDecoys[i]))
      braceInst.setMatrixAt(i, mountMat)
      pipeSteelInst.setMatrixAt(i, mountMat)
      pipeTrimInst.setMatrixAt(i, mountMat)
    }
    meshes.push(braceInst, pipeSteelInst, pipeTrimInst)
  }

  if (ceilingOnlyDecoys.length > 0) {
    const cc = ceilingOnlyDecoys.length
    const suspSteelInst = new THREE.InstancedMesh(assets.supplyCeilingSteelGeo, assets.steelMat, cc)
    suspSteelInst.name = 'water-tank-decoy-ceiling-pipe-steel'
    const suspTrimInst = new THREE.InstancedMesh(assets.supplyCeilingTrimGeo, assets.rustMat, cc)
    suspTrimInst.name = 'water-tank-decoy-ceiling-pipe-trim'
    for (let i = 0; i < cc; i += 1) {
      mountMat.copy(toWorldMat(ceilingOnlyDecoys[i]))
      suspSteelInst.setMatrixAt(i, mountMat)
      suspTrimInst.setMatrixAt(i, mountMat)
    }
    meshes.push(suspSteelInst, suspTrimInst)
  }

  stepWaterTankDecoys(group, 0)
  decoyDripsInst.castShadow = false
  decoyDripsInst.receiveShadow = false
  decoyDripsInst.computeBoundingBox()
  decoyDripsInst.computeBoundingSphere()
  meshes.push(decoyDripsInst)

  for (let i = 0; i < meshes.length; i += 1) {
    const inst = meshes[i]
    inst.castShadow = false
    inst.receiveShadow = inst !== decoyDripsInst
    inst.instanceMatrix.needsUpdate = true
    if (inst !== decoyDripsInst) {
      inst.computeBoundingBox()
      inst.computeBoundingSphere()
    }
    group.add(inst)
  }

  return group
}

function getSuspendedMachinerySharedAssets(qualityPreset = 'high') {
  const envMats = getEnvironmentalPropMaterials({ qualityPreset })
  const galvTex = getGalvanizedMetalTextureSet(qualityPreset)
  const darkSteelMat = envMats.darkSteel
  const rustMat = envMats.rustyMetal
  const cableMat = getPooledMaterial(
    'suspended_machinery:cable',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.machineryChain,
        roughness: 0.44,
        metalness: 0.84,
        envMapIntensity: 0.72,
      })
  )
  const housingMat = getPooledMaterial(
    'suspended_machinery:housing',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.machineryHousing,
        map: galvTex?.map || null,
        roughnessMap: galvTex?.roughnessMap || null,
        bumpMap: galvTex?.bumpMap || null,
        bumpScale: 0.018,
        roughness: 0.62,
        metalness: 0.66,
        envMapIntensity: 0.62,
      })
  )

  const beamCy = SUSPENDED_MACHINERY_CONSTANTS.gantryBeamCenterY // 2.94
  const beamTopY = SUSPENDED_MACHINERY_CONSTANTS.gantryBeamTopY // 3.03 (< 3.04 beamBottomY)
  const beamBotY = SUSPENDED_MACHINERY_CONSTANTS.gantryBeamBottomY // 2.85
  const pivotY = SUSPENDED_MACHINERY_CONSTANTS.pivotY // 2.86
  const beamH = beamTopY - beamBotY // 0.18
  const girderBotY = MAZE_CEILING_CONFIG.beamBottomY // 3.04
  const girderHalfW = MAZE_CEILING_CONFIG.beamWidth * 0.5 // 0.39
  const ribBotY = MAZE_CEILING_CONFIG.ribBottomY // 3.38
  const ribHalfW = MAZE_CEILING_CONFIG.ribWidth * 0.5 // 0.21

  const buildMonorailGeo = (spanX) =>
    buildMergedWiringParts([
      // Upper flange (top at 3.03 < 3.04 concrete girder)
      [new THREE.BoxGeometry(spanX, 0.042, 0.22), { y: beamTopY - 0.021 }],
      // Central I-beam web
      [new THREE.BoxGeometry(spanX, beamH - 0.084, 0.068), { y: beamCy }],
      // Lower trolley running flange
      [new THREE.BoxGeometry(spanX, 0.042, 0.22), { y: beamBotY + 0.021 }],
      // End trolley stop bumpers on lower flange
      [new THREE.BoxGeometry(0.055, 0.055, 0.23), { x: -(spanX * 0.5 - 0.05), y: beamBotY + 0.04 }],
      [new THREE.BoxGeometry(0.055, 0.055, 0.23), { x: spanX * 0.5 - 0.05, y: beamBotY + 0.04 }],
    ])

  const railWallGeo = getPooledGeometry('suspended_machinery:railWall', () =>
    buildMonorailGeo(CELL_SIZE - 0.06)
  )
  const railCeilGeo = getPooledGeometry('suspended_machinery:railCeil', () =>
    buildMonorailGeo(2.36)
  )

  const halfWallX = CELL_SIZE * 0.5
  const wallCorbelGeo = getPooledGeometry('suspended_machinery:wallCorbel', () => {
    const parts = []
    for (const side of [-1, 1]) {
      const plateX = side * (halfWallX - 0.03)
      // Heavy steel wall-ledger mounting plate flush at corridor wall (+/- 2.00)
      parts.push([
        new THREE.BoxGeometry(0.06, 0.38, 0.28),
        { x: plateX, y: beamCy - 0.05, z: 0 },
      ])
      // Welded horizontal shelf seat beneath I-beam end
      parts.push([
        new THREE.BoxGeometry(0.18, 0.045, 0.26),
        { x: side * (halfWallX - 0.11), y: beamBotY - 0.022, z: 0 },
      ])
      // Diagonal knee-brace strut from ledger base to I-beam underside
      parts.push([
        createEndpointAlignedStrut(
          [side * (halfWallX - 0.05), beamBotY - 0.21, 0],
          [side * (halfWallX - 0.22), beamBotY - 0.01, 0],
          0.055,
          0.12
        ),
        {},
      ])
    }
    return buildMergedWiringParts(parts)
  })

  // 1) Aligned Primary Concrete Girder Saddle Clamps (x = +/- 0.72, grips y=3.04..3.22, |z| <= 0.425 < 0.44 tray)
  const girderSaddleGeo = getPooledGeometry('suspended_machinery:girderSaddle', () => {
    const parts = []
    for (const sx of [-0.72, 0.72]) {
      // Bearing saddle plate spanning flush from monorail top (3.03) to concrete girder soffit (3.04)
      parts.push([
        new THREE.BoxGeometry(0.2, 0.035, girderHalfW * 2 + 0.065),
        { x: sx, y: girderBotY - 0.012, z: 0 },
      ])
      // Vertical clamp cheek straps gripping both sides of 0.78m concrete girder
      for (const sz of [-(girderHalfW + 0.014), girderHalfW + 0.014]) {
        parts.push([
          new THREE.BoxGeometry(0.16, 0.21, 0.026),
          { x: sx, y: girderBotY + 0.085, z: sz },
        ])
        parts.push([
          new THREE.CylinderGeometry(0.018, 0.018, 0.028, 6),
          { rx: Math.PI * 0.5, x: sx, y: girderBotY + 0.14, z: sz + Math.sign(sz) * 0.016 },
        ])
      }
      // Top beam clip gussets clamping onto I-beam flange
      parts.push([
        new THREE.BoxGeometry(0.22, 0.026, 0.25),
        { x: sx, y: beamTopY - 0.005, z: 0 },
      ])
    }
    return buildMergedWiringParts(parts)
  })

  // 2) Aligned Concrete Coffer Rib Hangers (x = +/- 0.72, clamps rib y=3.38, |z| <= 0.238 < 0.305 conduit)
  const ribHangerGeo = getPooledGeometry('suspended_machinery:ribHanger', () => {
    const parts = []
    const dropSpan = ribBotY - beamTopY // 0.35m
    const dropMidY = beamTopY + dropSpan * 0.5
    for (const sx of [-0.72, 0.72]) {
      parts.push([
        new THREE.BoxGeometry(0.18, 0.032, ribHalfW * 2 + 0.05),
        { x: sx, y: ribBotY - 0.012, z: 0 },
      ])
      for (const sz of [-(ribHalfW + 0.012), ribHalfW + 0.012]) {
        parts.push([
          new THREE.BoxGeometry(0.14, 0.13, 0.024),
          { x: sx, y: ribBotY + 0.045, z: sz },
        ])
      }
      // Twin drop-hanger rods & beam clamp plate
      for (const rz of [-0.075, 0.075]) {
        parts.push([
          new THREE.CylinderGeometry(0.02, 0.02, dropSpan + 0.02, 6),
          { x: sx, y: dropMidY, z: rz },
        ])
      }
      parts.push([
        new THREE.BoxGeometry(0.2, 0.028, 0.24),
        { x: sx, y: beamTopY + 0.006, z: 0 },
      ])
    }
    return buildMergedWiringParts(parts)
  })

  // 3) Perpendicular Primary Concrete Girder Saddle (clamps crossing X-girder x in [-0.415, +0.415], clear of trays >= 0.44)
  const crossGirderSaddleGeo = getPooledGeometry('suspended_machinery:crossGirderSaddle', () => {
    const parts = [
      [new THREE.BoxGeometry(girderHalfW * 2 + 0.065, 0.035, 0.24), { x: 0, y: girderBotY - 0.012, z: 0 }],
    ]
    for (const sx of [-(girderHalfW + 0.014), girderHalfW + 0.014]) {
      parts.push([
        new THREE.BoxGeometry(0.026, 0.21, 0.18),
        { x: sx, y: girderBotY + 0.085, z: 0 },
      ])
      parts.push([
        new THREE.CylinderGeometry(0.018, 0.018, 0.028, 6),
        { rz: Math.PI * 0.5, x: sx + Math.sign(sx) * 0.016, y: girderBotY + 0.14, z: 0 },
      ])
      // Twin gussets strictly below y = 3.04 supporting gantry top flange
      parts.push([
        new THREE.BoxGeometry(0.32, 0.028, 0.22),
        { x: Math.sign(sx) * 0.56, y: beamTopY - 0.004, z: 0 },
      ])
    }
    return buildMergedWiringParts(parts)
  })

  // 4) Perpendicular Concrete Coffer Rib Truss (clamps X-rib x in [-0.235, +0.235], braces stay |x| <= 0.48 < 0.55 lights/vents)
  const crossRibTrussGeo = getPooledGeometry('suspended_machinery:crossRibTruss', () => {
    const dropSpan = ribBotY - beamTopY
    const dropMidY = beamTopY + dropSpan * 0.5
    const parts = [
      [new THREE.BoxGeometry(ribHalfW * 2 + 0.05, 0.032, 0.24), { x: 0, y: ribBotY - 0.012, z: 0 }],
      [new THREE.BoxGeometry(0.98, 0.028, 0.22), { x: 0, y: beamTopY + 0.006, z: 0 }],
    ]
    for (const sx of [-(ribHalfW + 0.012), ribHalfW + 0.012]) {
      parts.push([
        new THREE.BoxGeometry(0.024, 0.13, 0.16),
        { x: sx, y: ribBotY + 0.045, z: 0 },
      ])
    }
    for (const sx of [-0.15, 0.15]) {
      for (const rz of [-0.075, 0.075]) {
        parts.push([
          new THREE.CylinderGeometry(0.02, 0.02, dropSpan + 0.02, 6),
          { x: sx, y: dropMidY, z: rz },
        ])
      }
      parts.push([
        createEndpointAlignedStrut(
          [sx, ribBotY - 0.02, 0],
          [Math.sign(sx) * 0.46, beamTopY + 0.01, 0],
          0.042,
          0.07
        ),
        {},
      ])
    }
    return buildMergedWiringParts(parts)
  })

  // Wheeled hoist trolley riding on lower I-beam flange (center pivotY = 2.86, cable exit pin at local y = -0.12)
  const trolleyGeo = getPooledGeometry('suspended_machinery:trolleyAssembly', () => {
    const parts = [
      // Trolley side cheek plates gripping beam lower flange
      [new THREE.BoxGeometry(0.48, 0.14, 0.032), { y: 0.015, z: -0.135 }],
      [new THREE.BoxGeometry(0.48, 0.14, 0.032), { y: 0.015, z: 0.135 }],
      // Top flange rollers
      [new THREE.CylinderGeometry(0.036, 0.036, 0.04, 8), { rx: Math.PI * 0.5, x: -0.16, y: 0.058, z: -0.095 }],
      [new THREE.CylinderGeometry(0.036, 0.036, 0.04, 8), { rx: Math.PI * 0.5, x: 0.16, y: 0.058, z: -0.095 }],
      [new THREE.CylinderGeometry(0.036, 0.036, 0.04, 8), { rx: Math.PI * 0.5, x: -0.16, y: 0.058, z: 0.095 }],
      [new THREE.CylinderGeometry(0.036, 0.036, 0.04, 8), { rx: Math.PI * 0.5, x: 0.16, y: 0.058, z: 0.095 }],
      // Equalizer crossbar & clevis pin bar
      [new THREE.BoxGeometry(0.18, 0.055, 0.52), { y: -0.055, z: 0 }],
      // Grooved hoist sheaves at z = +/- 0.22
      [new THREE.CylinderGeometry(0.072, 0.072, 0.048, 10), { rz: Math.PI * 0.5, y: -0.1, z: -0.22 }],
      [new THREE.CylinderGeometry(0.072, 0.072, 0.048, 10), { rz: Math.PI * 0.5, y: -0.1, z: 0.22 }],
    ]
    return buildMergedWiringParts(parts)
  })

  // Top-pivoted unit hoist cable (extends from y = 0 down to y = -1 along -Y)
  const topCableGeo = getPooledGeometry('suspended_machinery:topCable', () => {
    const g = new THREE.CylinderGeometry(0.018, 0.018, 1.0, 6)
    g.translate(0, -0.5, 0)
    return g
  })

  // Shackle-pivoted snapped lower cable stub (extends from y = 0 up to y = +1 along +Y)
  const stubCableGeo = getPooledGeometry('suspended_machinery:stubCable', () => {
    const g = new THREE.CylinderGeometry(0.017, 0.018, 1.0, 6)
    g.translate(0, 0.5, 0)
    return g
  })

  // Realistic cast-iron AC motor + centrifugal pump / reduction gearbox unit (no yellow bumper!)
  // Tight local bounds: X in [-0.46, +0.46], Y in [-0.265, +0.335], Z in [-0.33, +0.33]
  const unitHousingGeo = getPooledGeometry('suspended_machinery:unitHousing', () =>
    buildMergedWiringParts([
      // Main ribbed AC motor stator barrel
      [new THREE.CylinderGeometry(0.195, 0.195, 0.54, 12), { rz: Math.PI * 0.5, x: 0.11, y: 0.02, z: 0 }],
      // 5 radial cooling ribs along motor stator
      [new THREE.CylinderGeometry(0.222, 0.222, 0.022, 12), { rz: Math.PI * 0.5, x: -0.08, y: 0.02, z: 0 }],
      [new THREE.CylinderGeometry(0.222, 0.222, 0.022, 12), { rz: Math.PI * 0.5, x: 0.01, y: 0.02, z: 0 }],
      [new THREE.CylinderGeometry(0.222, 0.222, 0.022, 12), { rz: Math.PI * 0.5, x: 0.1, y: 0.02, z: 0 }],
      [new THREE.CylinderGeometry(0.222, 0.222, 0.022, 12), { rz: Math.PI * 0.5, x: 0.19, y: 0.02, z: 0 }],
      [new THREE.CylinderGeometry(0.222, 0.222, 0.022, 12), { rz: Math.PI * 0.5, x: 0.28, y: 0.02, z: 0 }],
      // Rear fan cowling endbell cap
      [new THREE.CylinderGeometry(0.185, 0.175, 0.1, 10), { rz: Math.PI * 0.5, x: 0.4, y: 0.02, z: 0 }],
      // Centrifugal pump volute casing
      [new THREE.CylinderGeometry(0.175, 0.175, 0.18, 10), { rx: Math.PI * 0.5, x: -0.34, y: 0.01, z: 0.02 }],
      // Upper cast electrical terminal box
      [new THREE.BoxGeometry(0.16, 0.11, 0.14), { x: 0.12, y: 0.23, z: 0.06 }],
    ])
  )

  const unitSkidGeo = getPooledGeometry('suspended_machinery:unitSkid', () =>
    buildMergedWiringParts([
      // Twin longitudinal steel skid rails (bottom at y = -0.265)
      [new THREE.BoxGeometry(0.9, 0.068, 0.095), { x: 0, y: -0.231, z: -0.255 }],
      [new THREE.BoxGeometry(0.9, 0.068, 0.095), { x: 0, y: -0.231, z: 0.255 }],
      // End & mid skid crossbeams
      [new THREE.BoxGeometry(0.1, 0.062, 0.66), { x: -0.38, y: -0.228, z: 0 }],
      [new THREE.BoxGeometry(0.1, 0.062, 0.66), { x: 0.38, y: -0.228, z: 0 }],
      [new THREE.BoxGeometry(0.09, 0.06, 0.62), { x: 0, y: -0.228, z: 0 }],
      // Motor & pump pedestal mounting feet
      [new THREE.BoxGeometry(0.14, 0.11, 0.42), { x: 0.14, y: -0.145, z: 0 }],
      [new THREE.BoxGeometry(0.16, 0.12, 0.36), { x: -0.31, y: -0.14, z: 0 }],
      // Top spreader frame & welded lifting eye lugs (shackles at z = +/- 0.22, y = 0.26)
      [new THREE.BoxGeometry(0.08, 0.04, 0.52), { x: 0, y: 0.215, z: 0 }],
      [new THREE.BoxGeometry(0.06, 0.075, 0.06), { x: 0, y: 0.235, z: -0.22 }],
      [new THREE.BoxGeometry(0.06, 0.075, 0.06), { x: 0, y: 0.235, z: 0.22 }],
    ])
  )

  const unitTrimGeo = getPooledGeometry('suspended_machinery:unitTrim', () =>
    buildMergedWiringParts([
      // Stepped reduction gearbox & shaft coupling flange collar
      [new THREE.BoxGeometry(0.22, 0.28, 0.34), { x: -0.26, y: -0.01, z: -0.03 }],
      [new THREE.CylinderGeometry(0.14, 0.14, 0.055, 10), { rz: Math.PI * 0.5, x: -0.16, y: 0.02, z: 0 }],
      // Pump flanged discharge riser & blind pipe flange
      [new THREE.CylinderGeometry(0.058, 0.068, 0.16, 8), { x: -0.34, y: 0.15, z: 0.08 }],
      [new THREE.CylinderGeometry(0.095, 0.095, 0.03, 10), { x: -0.34, y: 0.235, z: 0.08 }],
      // Side suction flanged blind plate
      [new THREE.CylinderGeometry(0.085, 0.085, 0.032, 10), { rx: Math.PI * 0.5, x: -0.34, y: 0.01, z: 0.15 }],
      // Terminal conduit elbow
      [new THREE.CylinderGeometry(0.022, 0.022, 0.09, 6), { rz: Math.PI * 0.5, x: 0.22, y: 0.23, z: 0.06 }],
      // Forged top hoist clevis shackles (center y = 0.275, max y = 0.335)
      [new THREE.TorusGeometry(0.048, 0.014, 6, 10), { x: 0, y: 0.275, z: -0.22 }],
      [new THREE.TorusGeometry(0.048, 0.014, 6, 10), { x: 0, y: 0.275, z: 0.22 }],
    ])
  )

  const warnBoltGeo = getPooledGeometry(
    'suspended_machinery:warnBolt',
    () => new THREE.CylinderGeometry(0.024, 0.024, 0.07, 6)
  )
  const impactFragGeo = getPooledGeometry(
    'suspended_machinery:impactFrag',
    () => new THREE.BoxGeometry(0.18, 0.055, 0.12)
  )
  const machDustGeo = getPooledGeometry(
    'suspended_machinery:dust',
    () => new THREE.SphereGeometry(0.26, 7, 6)
  )

  return {
    darkSteelMat,
    rustMat,
    cableMat,
    housingMat,
    beamCy,
    beamTopY,
    beamBotY,
    pivotY,
    railWallGeo,
    railCeilGeo,
    wallCorbelGeo,
    girderSaddleGeo,
    ribHangerGeo,
    crossGirderSaddleGeo,
    crossRibTrussGeo,
    trolleyGeo,
    topCableGeo,
    stubCableGeo,
    unitHousingGeo,
    unitSkidGeo,
    unitTrimGeo,
    warnBoltGeo,
    impactFragGeo,
    machDustGeo,
  }
}

/**
 * Builds visually matching, structurally sound intact overhead industrial gantry
 * machinery decoys (`maze-suspended-machinery-decoys`) mounted directly onto actual
 * ceiling concrete girders/ribs using instanced shared geometries and facility
 * materials. Never deals damage or drops, and contains zero caution paint tells.
 */
export function buildSuspendedMachineryDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getSuspendedMachinerySharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5

  const group = new THREE.Group()
  group.name = SUSPENDED_MACHINERY_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const chunkLayout = createMazeChunkLayout(maze, { maxChunksPerAxis: 2 })
  const makeChunkBuckets = () =>
    Array.from({ length: chunkLayout.totalChunks }, () => [])

  const wallGantryDecoys = []
  const ceilGantryDecoys = []
  const hangerBuckets = {
    girder_saddle: makeChunkBuckets(),
    rib_hanger: makeChunkBuckets(),
    cross_girder_saddle: makeChunkBuckets(),
    cross_rib_truss: makeChunkBuckets(),
  }

  const dummy = new THREE.Object3D()
  const localObj = new THREE.Object3D()
  const mountMat = new THREE.Matrix4()
  const worldMat = new THREE.Matrix4()

  const getChunkAndMat = (d) => {
    const cx = originX + (d.col + 0.5) * CELL_SIZE
    const cz = originZ + (d.row + 0.5) * CELL_SIZE
    dummy.position.set(cx, 0, cz)
    dummy.rotation.set(0, Number.isFinite(d.machineryYaw) ? d.machineryYaw : 0, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    return {
      chunkIdx: chunkLayout.getChunkIndex(cx, cz),
      matrix: dummy.matrix.clone(),
    }
  }

  const wallRailChunks = makeChunkBuckets()
  const wallCorbelChunks = makeChunkBuckets()
  const ceilRailChunks = makeChunkBuckets()
  const trolleyChunks = makeChunkBuckets()
  const cableChunks = makeChunkBuckets()
  const housingChunks = makeChunkBuckets()
  const skidChunks = makeChunkBuckets()
  const trimChunks = makeChunkBuckets()

  const pivotY = assets.pivotY // 2.86
  const sheavePinY = pivotY - 0.12 // 2.74

  for (let i = 0; i < count; i += 1) {
    const d = decoys[i]
    const { chunkIdx, matrix } = getChunkAndMat(d)
    if (d.mountType === 'wall_to_wall_gantry') {
      wallGantryDecoys.push(d)
      wallRailChunks[chunkIdx].push(matrix)
      wallCorbelChunks[chunkIdx].push(matrix)
    } else {
      ceilGantryDecoys.push(d)
      ceilRailChunks[chunkIdx].push(matrix)
    }
    const hKey = hangerBuckets[d.ceilingStructureType] ? d.ceilingStructureType : 'rib_hanger'
    hangerBuckets[hKey][chunkIdx].push(matrix)

    const restY = Number.isFinite(d.machineryRestY)
      ? d.machineryRestY
      : SUSPENDED_MACHINERY_CONSTANTS.machineryRestY
    const cableSpan = Math.max(0.08, sheavePinY - (restY + 0.265))
    mountMat.copy(matrix)

    localObj.rotation.set(0, 0, 0)
    localObj.scale.set(1, 1, 1)

    // Trolley mounted on lower flange
    localObj.position.set(0, pivotY, 0)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(mountMat, localObj.matrix)
    trolleyChunks[chunkIdx].push(worldMat.clone())

    // Dual taut hoist cables spanning exact sheave-to-shackle distance
    localObj.scale.set(1, cableSpan, 1)
    localObj.position.set(0, sheavePinY, -0.22)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(mountMat, localObj.matrix)
    cableChunks[chunkIdx].push(worldMat.clone())

    localObj.position.set(0, sheavePinY, 0.22)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(mountMat, localObj.matrix)
    cableChunks[chunkIdx].push(worldMat.clone())

    // Suspended machinery motor/pump/skid unit
    localObj.scale.set(1, 1, 1)
    localObj.position.set(0, restY, 0)
    localObj.updateMatrix()
    worldMat.multiplyMatrices(mountMat, localObj.matrix)
    const unitMat = worldMat.clone()
    housingChunks[chunkIdx].push(unitMat)
    skidChunks[chunkIdx].push(unitMat)
    trimChunks[chunkIdx].push(unitMat)
  }

  const meshes = []
  if (wallGantryDecoys.length > 0) {
    pushChunkedInstancedBatch(meshes, chunkLayout, 'suspended-machinery-decoy-wall-rails', assets.railWallGeo, assets.darkSteelMat, wallRailChunks, { castShadow: false, receiveShadow: true })
    pushChunkedInstancedBatch(meshes, chunkLayout, 'suspended-machinery-decoy-wall-corbels', assets.wallCorbelGeo, assets.rustMat, wallCorbelChunks, { castShadow: false, receiveShadow: true })
  }
  if (ceilGantryDecoys.length > 0) {
    pushChunkedInstancedBatch(meshes, chunkLayout, 'suspended-machinery-decoy-ceil-rails', assets.railCeilGeo, assets.darkSteelMat, ceilRailChunks, { castShadow: false, receiveShadow: true })
  }

  const hangerGeoMap = {
    girder_saddle: assets.girderSaddleGeo,
    rib_hanger: assets.ribHangerGeo,
    cross_girder_saddle: assets.crossGirderSaddleGeo,
    cross_rib_truss: assets.crossRibTrussGeo,
  }
  for (const [hKey, chunkBuckets] of Object.entries(hangerBuckets)) {
    pushChunkedInstancedBatch(
      meshes,
      chunkLayout,
      `suspended-machinery-decoy-hanger-${hKey}`,
      hangerGeoMap[hKey],
      assets.darkSteelMat,
      chunkBuckets,
      { castShadow: false, receiveShadow: true }
    )
  }

  pushChunkedInstancedBatch(meshes, chunkLayout, 'suspended-machinery-decoy-trolleys', assets.trolleyGeo, assets.darkSteelMat, trolleyChunks, { castShadow: false, receiveShadow: true })
  pushChunkedInstancedBatch(meshes, chunkLayout, 'suspended-machinery-decoy-cables', assets.topCableGeo, assets.cableMat, cableChunks, { castShadow: false, receiveShadow: true })
  pushChunkedInstancedBatch(meshes, chunkLayout, 'suspended-machinery-decoy-housings', assets.unitHousingGeo, assets.housingMat, housingChunks, { castShadow: false, receiveShadow: true })
  pushChunkedInstancedBatch(meshes, chunkLayout, 'suspended-machinery-decoy-skids', assets.unitSkidGeo, assets.darkSteelMat, skidChunks, { castShadow: false, receiveShadow: true })
  pushChunkedInstancedBatch(meshes, chunkLayout, 'suspended-machinery-decoy-trims', assets.unitTrimGeo, assets.rustMat, trimChunks, { castShadow: false, receiveShadow: true })

  for (let i = 0; i < meshes.length; i += 1) {
    group.add(meshes[i])
  }

  return group
}

/**
 * Shared geometries & facility galvanized/iron materials for both hazardous
 * `ventilation_duct_collapse` assemblies and safe intact ceiling duct decoys.
 * Ensures hazardous ducts and decoys share identical dimensions, structure-
 * specific ceiling hangers, and materials with zero visual tells.
 */
function getVentilationDuctSharedAssets(qualityPreset = 'high') {
  void qualityPreset
  const galvMat = getPooledMaterial('duct:galvanized', () => {
    const tex = getGalvanizedMetalTextureSet()
    return new THREE.MeshStandardMaterial({
      color: HAZARD_PALETTE.ductGalvanized,
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      bumpMap: tex.bumpMap,
      bumpScale: 0.026,
      roughness: 0.82,
      metalness: 0.6,
      envMapIntensity: 0.54,
    })
  })
  const hardwareMat = getPooledMaterial('duct:hardware', () => {
    const tex = getGalvanizedMetalTextureSet()
    return new THREE.MeshStandardMaterial({
      color: HAZARD_PALETTE.ductHardware,
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      bumpMap: tex.bumpMap,
      bumpScale: 0.024,
      roughness: 0.9,
      metalness: 0.38,
      envMapIntensity: 0.34,
    })
  })
  const cavityMat = getPooledMaterial(
    'duct:cavity',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.ductCavity,
        roughness: 0.98,
        metalness: 0.04,
        envMapIntensity: 0.06,
      })
  )
  const ductRustMat = getPooledMaterial(
    'duct:rust',
    () =>
      new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.ductRust,
        roughness: 0.93,
        metalness: 0.28,
      })
  )

  const ductWidth = VENTILATION_DUCT_CONSTANTS.ductWidth // 0.66
  const ductHeight = VENTILATION_DUCT_CONSTANTS.ductHeight // 0.28
  const ductLen = VENTILATION_DUCT_CONSTANTS.ductLen // 1.80
  const hangerZ = VENTILATION_DUCT_CONSTANTS.hangerZ // 0.78
  const hangerHalfX = ductWidth * 0.5 + 0.055 // 0.385
  const soffitY = MAZE_CEILING_CONFIG.soffitY // 3.60
  const girderBotY = MAZE_CEILING_CONFIG.beamBottomY // 3.04
  const girderHalfW = MAZE_CEILING_CONFIG.beamWidth * 0.5 // 0.39
  const ribBotY = MAZE_CEILING_CONFIG.ribBottomY // 3.38
  const ribHalfW = MAZE_CEILING_CONFIG.ribWidth * 0.5 // 0.21
  const cradleDropOffset = ductHeight * 0.5 + 0.022 // 0.162

  const mainDuctGeo = getPooledGeometry(
    'duct:main-section',
    () => new THREE.BoxGeometry(ductWidth, ductHeight, ductLen)
  )
  const stubGeo = getPooledGeometry(
    'duct:stub',
    () => new THREE.BoxGeometry(ductWidth, ductHeight, 0.52)
  )
  const flangeGeo = getPooledGeometry(
    'duct:flange',
    () => new THREE.BoxGeometry(ductWidth + 0.06, ductHeight + 0.06, 0.05)
  )
  const throatGeo = getPooledGeometry(
    'duct:throat',
    () => new THREE.BoxGeometry(ductWidth - 0.08, ductHeight - 0.08, 0.024)
  )
  const rustSeamGeo = getPooledGeometry(
    'duct:rust-seam',
    () => new THREE.BoxGeometry(ductWidth + 0.016, ductHeight + 0.016, 0.24)
  )
  const bulkheadCollarGeo = getPooledGeometry(
    'duct:bulkhead-collar',
    () => new THREE.BoxGeometry(ductWidth + 0.16, ductHeight + 0.1, 0.12)
  )
  const bulkheadConnectorGeo = getPooledGeometry(
    'duct:bulkhead-connector',
    () => new THREE.BoxGeometry(ductWidth, ductHeight, 0.48)
  )
  const grilleFrameGeo = getPooledGeometry(
    'duct:grille-frame',
    () => new THREE.BoxGeometry(0.48, 0.025, 0.62)
  )
  const grilleBackGeo = getPooledGeometry(
    'duct:grille-back',
    () => new THREE.BoxGeometry(0.4, 0.016, 0.52)
  )
  const louverGeo = getPooledGeometry(
    'duct:grille-louver',
    () => new THREE.BoxGeometry(0.38, 0.012, 0.026)
  )
  const unitRodGeo = getPooledGeometry(
    'duct:unit-hanger-rod',
    () => new THREE.CylinderGeometry(0.014, 0.014, 1.0, 6)
  )
  const cradleGeo = getPooledGeometry(
    'duct:trapeze-cradle',
    () => new THREE.BoxGeometry(ductWidth + 0.18, 0.034, 0.064)
  )
  const screwGeo = getPooledGeometry(
    'duct:warn-screw',
    () => new THREE.CylinderGeometry(0.016, 0.016, 0.055, 5)
  )
  const ductDustGeo = getPooledGeometry(
    'duct:dust-puff',
    () => new THREE.SphereGeometry(0.19, 6, 5)
  )
  const shardGeo = getPooledGeometry(
    'duct:impact-shard',
    () => new THREE.BoxGeometry(0.22, 0.028, 0.14)
  )

  // Helper returning exact static concrete-mounted ceiling saddle / plate parts
  // in ductMountGroup space (true world Y), tailored to actual concrete beams/ribs.
  const buildRigPartsForStructure = (structType, restY) => {
    const parts = []
    if (structType === 'girder_saddle' || structType === 'girder_intersection') {
      // Twin steel C-saddle clamps embracing parallel concrete girder (|x| <= 0.39, y = 3.04..3.22, |x| <= 0.431 < 0.435 tray)
      for (const hz of [-hangerZ, hangerZ]) {
        parts.push([
          new THREE.BoxGeometry(girderHalfW * 2 + 0.06, 0.03, 0.12),
          { x: 0, y: girderBotY - 0.015, z: hz },
        ])
        for (const sx of [-(girderHalfW + 0.014), girderHalfW + 0.014]) {
          parts.push([
            new THREE.BoxGeometry(0.026, 0.19, 0.1),
            { x: sx, y: girderBotY + 0.08, z: hz },
          ])
          parts.push([
            new THREE.CylinderGeometry(0.016, 0.016, 0.024, 6),
            { rz: Math.PI * 0.5, x: sx + Math.sign(sx) * 0.014, y: girderBotY + 0.13, z: hz },
          ])
        }
      }
    } else if (structType === 'cross_girder_saddle') {
      // Soffit anchor plates at z = +/- 0.78 (outside |z|<=0.39 girder & [0.435,0.715] cable tray)
      for (const hz of [-hangerZ, hangerZ]) {
        for (const sx of [-hangerHalfX, hangerHalfX]) {
          parts.push([
            new THREE.BoxGeometry(0.09, 0.024, 0.09),
            { x: sx, y: soffitY - 0.012, z: hz },
          ])
        }
      }
      // Central X-girder saddle gripping perpendicular concrete beam (|z| <= 0.418 < 0.435 tray)
      parts.push([
        new THREE.BoxGeometry(ductWidth + 0.08, 0.028, girderHalfW * 2 + 0.05),
        { x: 0, y: girderBotY - 0.014, z: 0 },
      ])
      for (const sz of [-(girderHalfW + 0.014), girderHalfW + 0.014]) {
        parts.push([
          new THREE.BoxGeometry(0.16, 0.18, 0.024),
          { x: 0, y: girderBotY + 0.075, z: sz },
        ])
      }
      // Short center tie brackets connecting girder saddle (3.028) cleanly down to center flange (restY + 0.17)
      const tieH = Math.max(0.02, girderBotY - 0.014 - (restY + 0.165))
      const tieCy = restY + 0.165 + tieH * 0.5
      for (const sx of [-(ductWidth * 0.5 + 0.01), ductWidth * 0.5 + 0.01]) {
        parts.push([
          new THREE.BoxGeometry(0.024, tieH, 0.08),
          { x: sx, y: tieCy, z: 0 },
        ])
      }
    } else if (structType === 'rib_hanger') {
      // Soffit plates at +/-0.385 (clean concrete outside |x|<=0.21 rib & +/-0.335 conduits) + rib hugging saddle at y=3.38
      for (const hz of [-hangerZ, hangerZ]) {
        for (const sx of [-hangerHalfX, hangerHalfX]) {
          parts.push([
            new THREE.BoxGeometry(0.09, 0.024, 0.09),
            { x: sx, y: soffitY - 0.012, z: hz },
          ])
        }
        parts.push([
          new THREE.BoxGeometry(hangerHalfX * 2 + 0.06, 0.026, 0.095),
          { x: 0, y: ribBotY - 0.013, z: hz },
        ])
        for (const sx of [-(ribHalfW + 0.012), ribHalfW + 0.012]) {
          parts.push([
            new THREE.BoxGeometry(0.024, 0.13, 0.085),
            { x: sx, y: ribBotY + 0.048, z: hz },
          ])
        }
      }
    } else if (structType === 'cross_rib_truss') {
      // Soffit plates at z = +/-0.78 + center X-rib saddle clamp (|z| <= 0.234 < 0.305 conduits)
      for (const hz of [-hangerZ, hangerZ]) {
        for (const sx of [-hangerHalfX, hangerHalfX]) {
          parts.push([
            new THREE.BoxGeometry(0.09, 0.024, 0.09),
            { x: sx, y: soffitY - 0.012, z: hz },
          ])
        }
      }
      parts.push([
        new THREE.BoxGeometry(ductWidth + 0.08, 0.026, ribHalfW * 2 + 0.045),
        { x: 0, y: ribBotY - 0.013, z: 0 },
      ])
      for (const sz of [-(ribHalfW + 0.012), ribHalfW + 0.012]) {
        parts.push([
          new THREE.BoxGeometry(0.14, 0.13, 0.024),
          { x: 0, y: ribBotY + 0.048, z: sz },
        ])
      }
      const tieH = Math.max(0.02, ribBotY - 0.013 - (restY + 0.165))
      const tieCy = restY + 0.165 + tieH * 0.5
      for (const sx of [-(ductWidth * 0.5 + 0.01), ductWidth * 0.5 + 0.01]) {
        parts.push([
          new THREE.BoxGeometry(0.024, tieH, 0.075),
          { x: sx, y: tieCy, z: 0 },
        ])
      }
    } else {
      // Fallback soffit hanger
      for (const hz of [-hangerZ, hangerZ]) {
        for (const sx of [-hangerHalfX, hangerHalfX]) {
          parts.push([
            new THREE.BoxGeometry(0.09, 0.024, 0.09),
            { x: sx, y: soffitY - 0.012, z: hz },
          ])
        }
      }
    }
    return parts
  }

  const rigGeos = {
    girder_saddle: getPooledGeometry('duct:rig-girder-saddle', () =>
      buildMergedWiringParts(
        buildRigPartsForStructure('girder_saddle', VENTILATION_DUCT_CONSTANTS.ductRestYGirder)
      )
    ),
    girder_intersection: getPooledGeometry('duct:rig-girder-intersection', () =>
      buildMergedWiringParts(
        buildRigPartsForStructure('girder_intersection', VENTILATION_DUCT_CONSTANTS.ductRestYGirder)
      )
    ),
    cross_girder_saddle: getPooledGeometry('duct:rig-cross-girder-saddle', () =>
      buildMergedWiringParts(
        buildRigPartsForStructure('cross_girder_saddle', VENTILATION_DUCT_CONSTANTS.ductRestYGirder)
      )
    ),
    rib_hanger: getPooledGeometry('duct:rig-rib-hanger', () =>
      buildMergedWiringParts(
        buildRigPartsForStructure('rib_hanger', VENTILATION_DUCT_CONSTANTS.ductRestYRib)
      )
    ),
    cross_rib_truss: getPooledGeometry('duct:rig-cross-rib-truss', () =>
      buildMergedWiringParts(
        buildRigPartsForStructure('cross_rib_truss', VENTILATION_DUCT_CONSTANTS.ductRestYRib)
      )
    ),
    soffit_hanger: getPooledGeometry('duct:rig-soffit-hanger', () =>
      buildMergedWiringParts(
        buildRigPartsForStructure('soffit_hanger', VENTILATION_DUCT_CONSTANTS.ductRestYSoffit)
      )
    ),
  }

  // Complete static+trapeze hanger geometries in mount space for InstancedMesh decoys
  const buildDecoyHangerParts = (structType, restY, pivotY) => {
    const hardwareParts = buildRigPartsForStructure(structType, restY)
    const cradleY = restY - cradleDropOffset
    const rodH = Math.max(0.12, pivotY - cradleY)
    const rodCy = pivotY - rodH * 0.5
    // Rear intact trapeze hanger (-hangerZ)
    for (const sx of [-hangerHalfX, hangerHalfX]) {
      hardwareParts.push([
        new THREE.CylinderGeometry(0.014, 0.014, rodH, 6),
        { x: sx, y: rodCy, z: -hangerZ },
      ])
    }
    hardwareParts.push([
      new THREE.BoxGeometry(ductWidth + 0.18, 0.034, 0.064),
      { x: 0, y: cradleY, z: -hangerZ },
    ])
    // Front trapeze hanger (+hangerZ): left rod hardware, right rod + cradle weathered rust (matching hazard exact!)
    hardwareParts.push([
      new THREE.CylinderGeometry(0.014, 0.014, rodH, 6),
      { x: -hangerHalfX, y: rodCy, z: hangerZ },
    ])
    const rustParts = [
      [
        new THREE.CylinderGeometry(0.014, 0.014, rodH, 6),
        { x: hangerHalfX, y: rodCy, z: hangerZ },
      ],
      [
        new THREE.BoxGeometry(ductWidth + 0.18, 0.034, 0.064),
        { x: 0, y: cradleY, z: hangerZ },
      ],
    ]
    return {
      hardwareGeo: buildMergedWiringParts(hardwareParts),
      rustGeo: buildMergedWiringParts(rustParts),
    }
  }

  const decoyHangerConfigs = {
    girder_saddle: [VENTILATION_DUCT_CONSTANTS.ductRestYGirder, 3.035],
    girder_intersection: [VENTILATION_DUCT_CONSTANTS.ductRestYGirder, 3.035],
    cross_girder_saddle: [VENTILATION_DUCT_CONSTANTS.ductRestYGirder, soffitY],
    rib_hanger: [VENTILATION_DUCT_CONSTANTS.ductRestYRib, soffitY],
    cross_rib_truss: [VENTILATION_DUCT_CONSTANTS.ductRestYRib, soffitY],
    soffit_hanger: [VENTILATION_DUCT_CONSTANTS.ductRestYSoffit, soffitY],
  }
  const decoyHangerGeos = {}
  for (const [stKey, [rY, pY]] of Object.entries(decoyHangerConfigs)) {
    const hwKey = `duct:decoy-hanger-hw:${stKey}`
    const rsKey = `duct:decoy-hanger-rs:${stKey}`
    let built = null
    const ensure = () => {
      if (!built) built = buildDecoyHangerParts(stKey, rY, pY)
      return built
    }
    decoyHangerGeos[stKey] = {
      hardwareGeo: getPooledGeometry(hwKey, () => ensure().hardwareGeo),
      rustGeo: getPooledGeometry(rsKey, () => ensure().rustGeo),
    }
  }

  // Merged intact duct assembly geometries for InstancedMesh decoys (origin = ductRestY center)
  const decoyBodyGalvGeo = getPooledGeometry('duct:decoy-body-galv', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(ductWidth, ductHeight, ductLen), { x: 0, y: 0, z: 0 }],
      [new THREE.BoxGeometry(ductWidth, ductHeight, 0.52), { x: 0, y: 0, z: -1.16 }],
      [new THREE.BoxGeometry(ductWidth, ductHeight, 0.52), { x: 0, y: 0, z: 1.16 }],
    ])
  )
  const decoyBodyHardwareGeo = getPooledGeometry('duct:decoy-body-hardware', () => {
    const parts = [
      [new THREE.BoxGeometry(ductWidth + 0.06, ductHeight + 0.06, 0.05), { x: 0, y: 0, z: -0.92 }],
      [new THREE.BoxGeometry(ductWidth + 0.06, ductHeight + 0.06, 0.05), { x: 0, y: 0, z: -0.875 }],
      [new THREE.BoxGeometry(ductWidth + 0.06, ductHeight + 0.06, 0.05), { x: 0, y: 0, z: 0 }],
      [new THREE.BoxGeometry(ductWidth + 0.06, ductHeight + 0.06, 0.05), { x: 0, y: 0, z: 0.92 }],
      [new THREE.BoxGeometry(0.48, 0.025, 0.62), { x: 0, y: -ductHeight * 0.5 - 0.01, z: 0.12 }],
    ]
    for (let lv = 0; lv < 5; lv += 1) {
      parts.push([
        new THREE.BoxGeometry(0.38, 0.012, 0.026),
        { rx: 0.42, x: 0, y: -ductHeight * 0.5 - 0.023, z: -0.08 + lv * 0.1 },
      ])
    }
    return buildMergedWiringParts(parts)
  })
  const decoyBodyRustGeo = getPooledGeometry('duct:decoy-body-rust', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(ductWidth + 0.06, ductHeight + 0.06, 0.05), { x: 0, y: 0, z: 0.875 }],
      [new THREE.BoxGeometry(ductWidth + 0.016, ductHeight + 0.016, 0.24), { x: 0, y: 0, z: 0.62 }],
    ])
  )
  const decoyBodyCavityGeo = getPooledGeometry('duct:decoy-body-cavity', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(ductWidth - 0.08, ductHeight - 0.08, 0.024), { x: 0, y: 0, z: -0.915 }],
      [new THREE.BoxGeometry(ductWidth - 0.08, ductHeight - 0.08, 0.024), { x: 0, y: 0, z: 0.915 }],
      [new THREE.BoxGeometry(0.4, 0.016, 0.52), { x: 0, y: -ductHeight * 0.5 - 0.016, z: 0.12 }],
    ])
  )
  const decoyBulkheadGalvGeo = getPooledGeometry('duct:decoy-bulkhead-galv', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(ductWidth, ductHeight, 0.48), { x: 0, y: 0, z: -1.65 }],
    ])
  )
  const decoyBulkheadHardwareGeo = getPooledGeometry('duct:decoy-bulkhead-hardware', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(ductWidth + 0.16, ductHeight + 0.1, 0.12), { x: 0, y: 0, z: -1.94 }],
    ])
  )

  return {
    galvMat,
    hardwareMat,
    cavityMat,
    ductRustMat,
    ductWidth,
    ductHeight,
    ductLen,
    hangerZ,
    hangerHalfX,
    cradleDropOffset,
    mainDuctGeo,
    stubGeo,
    flangeGeo,
    throatGeo,
    rustSeamGeo,
    bulkheadCollarGeo,
    bulkheadConnectorGeo,
    grilleFrameGeo,
    grilleBackGeo,
    louverGeo,
    unitRodGeo,
    cradleGeo,
    screwGeo,
    ductDustGeo,
    shardGeo,
    rigGeos,
    decoyHangerGeos,
    decoyBodyGalvGeo,
    decoyBodyHardwareGeo,
    decoyBodyRustGeo,
    decoyBodyCavityGeo,
    decoyBulkheadGalvGeo,
    decoyBulkheadHardwareGeo,
  }
}

/**
 * Builds visually matching, structurally sound intact overhead ventilation
 * duct decoys (`maze-ventilation-duct-decoys`) anchored to real ceiling
 * girders, ribs, trusses, and rear wall bulkheads using pooled InstancedMesh
 * layers and shared galvanized facility materials. Never deals damage, drops,
 * or shows visual tells.
 */
export function buildVentilationDuctDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getVentilationDuctSharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5

  const group = new THREE.Group()
  group.name = VENTILATION_DUCT_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const hangerBuckets = {
    girder_saddle: [],
    girder_intersection: [],
    cross_girder_saddle: [],
    rib_hanger: [],
    cross_rib_truss: [],
    soffit_hanger: [],
  }
  const bulkheadDecoys = []

  for (let i = 0; i < count; i += 1) {
    const d = decoys[i]
    const hKey = hangerBuckets[d.ceilingStructureType]
      ? d.ceilingStructureType
      : 'cross_rib_truss'
    hangerBuckets[hKey].push(d)
    if (d.mountType === 'wall_bulkhead_duct') {
      bulkheadDecoys.push(d)
    }
  }

  const dummy = new THREE.Object3D()
  const localObj = new THREE.Object3D()
  const mountMat = new THREE.Matrix4()
  const worldMat = new THREE.Matrix4()

  const toWorldMat = (d) => {
    const cx = originX + (d.col + 0.5) * CELL_SIZE
    const cz = originZ + (d.row + 0.5) * CELL_SIZE
    dummy.position.set(cx, 0, cz)
    dummy.rotation.set(0, Number.isFinite(d.ductYaw) ? d.ductYaw : 0, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    return dummy.matrix
  }

  const meshes = []

  // Per-structure concrete clamps + twin trapeze hangers (ground-level mount origin y = 0)
  for (const [stKey, list] of Object.entries(hangerBuckets)) {
    if (list.length === 0) continue
    const geos = assets.decoyHangerGeos[stKey]
    const hwInst = new THREE.InstancedMesh(geos.hardwareGeo, assets.hardwareMat, list.length)
    hwInst.name = `vent-duct-decoy-hanger-hw-${stKey}`
    const rsInst = new THREE.InstancedMesh(geos.rustGeo, assets.ductRustMat, list.length)
    rsInst.name = `vent-duct-decoy-hanger-rust-${stKey}`
    for (let i = 0; i < list.length; i += 1) {
      mountMat.copy(toWorldMat(list[i]))
      hwInst.setMatrixAt(i, mountMat)
      rsInst.setMatrixAt(i, mountMat)
    }
    meshes.push(hwInst, rsInst)
  }

  // Optional rear wall bulkhead collar & connector for wall-backed runs
  if (bulkheadDecoys.length > 0) {
    const bc = bulkheadDecoys.length
    const bhGalvInst = new THREE.InstancedMesh(
      assets.decoyBulkheadGalvGeo,
      assets.galvMat,
      bc
    )
    bhGalvInst.name = 'vent-duct-decoy-bulkhead-galv'
    const bhHwInst = new THREE.InstancedMesh(
      assets.decoyBulkheadHardwareGeo,
      assets.hardwareMat,
      bc
    )
    bhHwInst.name = 'vent-duct-decoy-bulkhead-hardware'
    localObj.rotation.set(0, 0, 0)
    localObj.scale.set(1, 1, 1)
    for (let i = 0; i < bc; i += 1) {
      const d = bulkheadDecoys[i]
      mountMat.copy(toWorldMat(d))
      localObj.position.set(
        0,
        Number.isFinite(d.ductRestY) ? d.ductRestY : VENTILATION_DUCT_CONSTANTS.ductRestY,
        0
      )
      localObj.updateMatrix()
      worldMat.multiplyMatrices(mountMat, localObj.matrix)
      bhGalvInst.setMatrixAt(i, worldMat)
      bhHwInst.setMatrixAt(i, worldMat)
    }
    meshes.push(bhGalvInst, bhHwInst)
  }

  // Main overhead duct runs + stubs + flanges + bottom grille + throats + seams
  const galvInst = new THREE.InstancedMesh(assets.decoyBodyGalvGeo, assets.galvMat, count)
  galvInst.name = 'vent-duct-decoy-galv'
  const hwInst = new THREE.InstancedMesh(assets.decoyBodyHardwareGeo, assets.hardwareMat, count)
  hwInst.name = 'vent-duct-decoy-hardware'
  const rustInst = new THREE.InstancedMesh(assets.decoyBodyRustGeo, assets.ductRustMat, count)
  rustInst.name = 'vent-duct-decoy-rust'
  const cavInst = new THREE.InstancedMesh(assets.decoyBodyCavityGeo, assets.cavityMat, count)
  cavInst.name = 'vent-duct-decoy-cavity'

  localObj.rotation.set(0, 0, 0)
  localObj.scale.set(1, 1, 1)
  for (let i = 0; i < count; i += 1) {
    const d = decoys[i]
    mountMat.copy(toWorldMat(d))
    localObj.position.set(
      0,
      Number.isFinite(d.ductRestY) ? d.ductRestY : VENTILATION_DUCT_CONSTANTS.ductRestY,
      0
    )
    localObj.updateMatrix()
    worldMat.multiplyMatrices(mountMat, localObj.matrix)
    galvInst.setMatrixAt(i, worldMat)
    hwInst.setMatrixAt(i, worldMat)
    rustInst.setMatrixAt(i, worldMat)
    cavInst.setMatrixAt(i, worldMat)
  }
  meshes.push(galvInst, hwInst, rustInst, cavInst)

  for (let i = 0; i < meshes.length; i += 1) {
    const inst = meshes[i]
    inst.castShadow = false
    inst.receiveShadow = true
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingBox()
    inst.computeBoundingSphere()
    group.add(inst)
  }

  return group
}

function getCeilingCollapseSharedAssets(qualityPreset = 'high') {
  const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset })
  const ceilingTex = surfaceSet?.ceiling || surfaceSet?.wall || null

  const soffitMat = getPooledMaterial(`ceiling_collapse:soffit:${qualityPreset}`, () =>
    new THREE.MeshStandardMaterial({
      color: HAZARD_PALETTE.ceilingConcrete,
      map: ceilingTex?.map || null,
      roughnessMap: ceilingTex?.roughnessMap || null,
      bumpMap: ceilingTex?.bumpMap || null,
      bumpScale: 0.048,
      roughness: 0.95,
      metalness: 0.015,
      envMapIntensity: 0.44,
    })
  )

  const rimGeo = getPooledGeometry(
    'ceiling_collapse:soffit_seam',
    () => new THREE.BoxGeometry(0.88, 0.014, 0.88)
  )

  return { soffitMat, rimGeo }
}

/**
 * Builds structurally sound precast ceiling soffit bay decoys
 * (`maze-ceiling-collapse-decoys`) matching dormant `ceiling_collapse` bays.
 */
export function buildCeilingCollapseDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getCeilingCollapseSharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5

  const group = new THREE.Group()
  group.name = CEILING_COLLAPSE_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const panelInst = new THREE.InstancedMesh(assets.rimGeo, assets.soffitMat, count)
  panelInst.name = 'ceiling-collapse-decoy-panels'
  // Dormant ceiling_collapse hazards render zero protruding geometry so the continuous
  // maze-ceiling-deck soffit remains completely unbroken across both corridor tiles;
  // keep decoy instances hidden to match dormant hazards 1-to-1 with zero ceiling seams.
  panelInst.visible = false
  panelInst.castShadow = false
  panelInst.receiveShadow = true

  const dummy = new THREE.Object3D()
  for (let i = 0; i < count; i += 1) {
    const d = decoys[i]
    const soffitY = Number.isFinite(d.ceilingSoffitY)
      ? d.ceilingSoffitY
      : CEILING_COLLAPSE_CONSTANTS.soffitY
    const offX = Number.isFinite(d.localPatchOffset?.x) ? d.localPatchOffset.x : 0
    const offZ = Number.isFinite(d.localPatchOffset?.z) ? d.localPatchOffset.z : 0
    const cx = originX + (d.col + 0.5) * CELL_SIZE + offX
    const cz = originZ + (d.row + 0.5) * CELL_SIZE + offZ
    dummy.position.set(cx, soffitY - 0.007, cz)
    dummy.rotation.set(0, Number.isFinite(d.collapseYaw) ? d.collapseYaw : 0, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    panelInst.setMatrixAt(i, dummy.matrix)
  }

  panelInst.instanceMatrix.needsUpdate = true
  panelInst.computeBoundingBox()
  panelInst.computeBoundingSphere()
  group.add(panelInst)

  return group
}

function getElectricalWiringSharedAssets(qualityPreset = 'high') {
  const envMats = getEnvironmentalPropMaterials({ qualityPreset })
  const wallZ = -CELL_SIZE * 0.5
  const wJuncX = 0.26
  const wJuncY = 1.62
  const wBrkX = -0.78
  const wBrkY = 1.32
  const wDoorHingeX = wJuncX - 0.205
  const wDoorHingeZ = wallZ + 0.158

  const cJuncX = 0.26
  const cJuncY = 2.86
  const cBrkX = -0.82
  const cBrkY = 1.48

  const wallCableSpecs = [
    { gx: -0.09, tx: -0.14, ty: -0.02, tz: -0.03, rx: 1.05, rz: 0.24 },
    { gx: 0.0, tx: 0.03, ty: -0.07, tz: 0.05, rx: 1.24, rz: -0.08 },
    { gx: 0.09, tx: 0.15, ty: 0.01, tz: -0.04, rx: 1.02, rz: -0.26 },
  ]
  const ceilingCableSpecs = [
    { rx: 0.24, rz: 0.26, tx: -0.13, ty: -0.02, tz: 0.07 },
    { rx: -0.22, rz: -0.28, tx: 0.14, ty: 0.01, tz: -0.05 },
    { rx: 0.3, rz: -0.08, tx: 0.01, ty: -0.07, tz: 0.11 },
  ]

  const wallSteelGeo = getPooledGeometry('wiring:wallDarkSteel', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(0.52, 0.7, 0.018), { x: wJuncX, y: wJuncY, z: wallZ + 0.009 }],
      [new THREE.CylinderGeometry(0.028, 0.028, 1.68, 8), { x: wJuncX, y: 2.76, z: wallZ + 0.055 }],
      [new THREE.CylinderGeometry(0.022, 0.022, 0.84, 8), { rz: Math.PI * 0.5, x: -0.36, y: 1.54, z: wallZ + 0.055 }],
      [new THREE.CylinderGeometry(0.022, 0.022, 0.14, 8), { x: wBrkX, y: 1.48, z: wallZ + 0.055 }],
      [new THREE.CylinderGeometry(0.022, 0.022, 1.15, 8), { x: wBrkX, y: 0.585, z: wallZ + 0.055 }],
      [new THREE.BoxGeometry(0.28, 0.36, 0.014), { x: wBrkX, y: wBrkY, z: wallZ + 0.007 }],
    ])
  )
  const wallEnclosureGeo = getPooledGeometry('wiring:wallLockerBlue', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(0.45, 0.62, 0.14), { x: wJuncX, y: wJuncY, z: wallZ + 0.088 }],
      [new THREE.BoxGeometry(0.24, 0.31, 0.11), { x: wBrkX, y: wBrkY, z: wallZ + 0.066 }],
    ])
  )
  const wallDoorGeo = getPooledGeometry('wiring:wallDoor', () =>
    new THREE.BoxGeometry(0.41, 0.56, 0.02).translate(0.205, 0, 0.008)
  )
  const wallDoorClaspGeo = getPooledGeometry('wiring:wallDoorClasp', () =>
    new THREE.BoxGeometry(0.022, 0.055, 0.016).translate(0.39, -0.04, 0.021)
  )
  const wallDoorPlaqueGeo = getPooledGeometry('wiring:wallDoorPlaque', () =>
    new THREE.BoxGeometry(0.11, 0.068, 0.008).translate(0.19, 0.13, 0.021)
  )
  const wallRustGeo = getPooledGeometry('wiring:wallRustyMetal', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(0.35, 0.42, 0.02), { x: wJuncX, y: wJuncY - 0.04, z: wallZ + 0.145 }],
      [new THREE.CylinderGeometry(0.011, 0.011, 0.055, 6), { x: wDoorHingeX, y: wJuncY + 0.18, z: wDoorHingeZ }],
      [new THREE.CylinderGeometry(0.011, 0.011, 0.055, 6), { x: wDoorHingeX, y: wJuncY - 0.18, z: wDoorHingeZ }],
      [new THREE.CylinderGeometry(0.048, 0.052, 0.032, 8), { x: wJuncX, y: 3.584, z: wallZ + 0.055 }],
      [new THREE.CylinderGeometry(0.048, 0.052, 0.032, 8), { x: wBrkX, y: 0.016, z: wallZ + 0.055 }],
      [new THREE.BoxGeometry(0.11, 0.042, 0.078), { x: wJuncX, y: 2.38, z: wallZ + 0.042 }],
      [new THREE.BoxGeometry(0.11, 0.042, 0.078), { x: wJuncX, y: 2.94, z: wallZ + 0.042 }],
      [new THREE.BoxGeometry(0.055, 0.12, 0.018), { x: wBrkX + 0.118, y: wBrkY, z: wallZ + 0.092 }],
      [new THREE.CylinderGeometry(0.024, 0.028, 0.032, 7), { x: wJuncX - 0.09, y: 1.305, z: wallZ + 0.088 }],
      [new THREE.CylinderGeometry(0.024, 0.028, 0.032, 7), { x: wJuncX, y: 1.305, z: wallZ + 0.088 }],
      [new THREE.CylinderGeometry(0.024, 0.028, 0.032, 7), { x: wJuncX + 0.09, y: 1.305, z: wallZ + 0.088 }],
    ])
  )
  const wallPlaqueGeo = getPooledGeometry('wiring:wallPlaque', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(0.11, 0.068, 0.008), { x: wBrkX - 0.01, y: wBrkY + 0.06, z: wallZ + 0.123 }],
    ])
  )
  const wallCablesGeo = getPooledGeometry('wiring:wallCables', () =>
    buildMergedWiringParts(
      wallCableSpecs.map((cs) => {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(cs.gx, -0.015, -0.532),
          new THREE.Vector3(cs.gx * 1.12, -0.14, -0.37),
          new THREE.Vector3(cs.tx * 0.85, cs.ty - 0.08, cs.tz - 0.16),
          new THREE.Vector3(cs.tx * 0.96, cs.ty - 0.02, cs.tz - 0.045),
        ])
        return [new THREE.TubeGeometry(curve, 10, 0.017, 6, false), {}]
      })
    )
  )
  const wallCuffsGeo = getPooledGeometry('wiring:wallCableCuffs', () =>
    buildMergedWiringParts(
      wallCableSpecs.map((cs) => [
        new THREE.CylinderGeometry(0.023, 0.028, 0.045, 7),
        { x: cs.tx * 0.96, y: cs.ty - 0.02, z: cs.tz - 0.045, rx: cs.rx, rz: cs.rz },
      ])
    )
  )

  const ceilingSteelGeo = getPooledGeometry('wiring:ceilingDarkSteel', () =>
    buildMergedWiringParts([
      [new THREE.CylinderGeometry(0.18, 0.2, 0.05, 10), { x: cJuncX, y: 3.575, z: 0 }],
      [new THREE.CylinderGeometry(0.18, 0.2, 0.05, 10), { x: cBrkX, y: 3.575, z: 0 }],
      [new THREE.BoxGeometry(1.36, 0.048, 0.068), { x: -0.28, y: 3.02, z: 0 }],
      [new THREE.CylinderGeometry(0.032, 0.032, 0.76, 8), { x: cJuncX, y: 2.38, z: 0 }],
      [new THREE.CylinderGeometry(0.024, 0.024, 1.42, 8), { x: cBrkX, y: 2.31, z: 0 }],
    ])
  )
  const ceilingEnclosureGeo = getPooledGeometry('wiring:ceilingLockerBlue', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(0.4, 0.26, 0.34), { x: cJuncX, y: cJuncY, z: 0 }],
      [new THREE.BoxGeometry(0.24, 0.31, 0.11), { x: cBrkX, y: cBrkY, z: 0 }],
    ])
  )
  const ceilingDoorGeo = getPooledGeometry('wiring:ceilingDoor', () =>
    new THREE.BoxGeometry(0.36, 0.22, 0.02).translate(0.18, 0, 0)
  )
  const ceilingDoorPlaqueGeo = getPooledGeometry('wiring:ceilingDoorPlaque', () =>
    new THREE.BoxGeometry(0.11, 0.068, 0.008).translate(0.18, 0.02, 0.015)
  )
  const ceilingRustGeo = getPooledGeometry('wiring:ceilingRustyMetal', () =>
    buildMergedWiringParts([
      [new THREE.CylinderGeometry(0.016, 0.016, 0.56, 6), { x: cJuncX, y: 3.3, z: 0 }],
      [new THREE.CylinderGeometry(0.016, 0.016, 0.56, 6), { x: cBrkX, y: 3.3, z: 0 }],
      [new THREE.CylinderGeometry(0.024, 0.028, 0.032, 7), { x: cJuncX, y: 2.01, z: 0 }],
      [new THREE.BoxGeometry(0.055, 0.12, 0.018), { x: cBrkX + 0.12, y: cBrkY, z: 0.025 }],
    ])
  )
  const ceilingPlaqueGeo = getPooledGeometry('wiring:ceilingPlaque', () =>
    buildMergedWiringParts([
      [new THREE.BoxGeometry(0.11, 0.068, 0.008), { x: cBrkX, y: cBrkY + 0.06, z: 0.06 }],
    ])
  )
  const ceilingCablesGeo = getPooledGeometry('wiring:ceilingCables', () =>
    buildMergedWiringParts(
      ceilingCableSpecs.map((cs) => {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(cs.tx * 0.12, 0.36, cs.tz * 0.12),
          new THREE.Vector3(cs.tx * 0.52, 0.21, cs.tz * 0.52),
          new THREE.Vector3(cs.tx * 0.88, cs.ty + 0.09, cs.tz * 0.88),
          new THREE.Vector3(cs.tx * 0.96, cs.ty + 0.035, cs.tz * 0.96),
        ])
        return [new THREE.TubeGeometry(curve, 10, 0.017, 6, false), {}]
      })
    )
  )
  const ceilingCuffsGeo = getPooledGeometry('wiring:ceilingCableCuffs', () =>
    buildMergedWiringParts(
      ceilingCableSpecs.map((cs) => [
        new THREE.CylinderGeometry(0.023, 0.028, 0.045, 7),
        { x: cs.tx * 0.96, y: cs.ty + 0.035, z: cs.tz * 0.96, rx: cs.rx, rz: cs.rz },
      ])
    )
  )

  const tipGeo = getPooledGeometry(
    'wiring:copperTip',
    () => new THREE.CylinderGeometry(0.013, 0.007, 0.095, 6)
  )
  const leverArmGeo = getPooledGeometry(
    'wiring:leverArm',
    () => new THREE.BoxGeometry(0.022, 0.12, 0.02)
  )
  const leverGripGeo = getPooledGeometry(
    'wiring:leverGrip',
    () => new THREE.CylinderGeometry(0.016, 0.016, 0.055, 8)
  )

  // Merged intact decoy geometries for wall & ceiling mounts (lever at rx = -0.58)
  const decoyWallDarkSteelGeo = getPooledGeometry('wiring:decoyWallDarkSteel', () =>
    buildMergedWiringParts([
      [wallSteelGeo.clone(), {}],
      [leverArmGeo.clone(), { x: 0, y: 0.055, z: 0.014, postRx: -0.58, postX: wBrkX + 0.132, postY: wBrkY, postZ: wallZ + 0.094 }],
    ])
  )
  const decoyWallLockerBlueGeo = getPooledGeometry('wiring:decoyWallLockerBlue', () =>
    buildMergedWiringParts([
      [wallEnclosureGeo.clone(), {}],
      [wallDoorGeo.clone(), { x: wDoorHingeX, y: wJuncY, z: wDoorHingeZ }],
    ])
  )
  const decoyWallRustyMetalGeo = getPooledGeometry('wiring:decoyWallRustyMetal', () =>
    buildMergedWiringParts([
      [wallRustGeo.clone(), {}],
      [wallDoorClaspGeo.clone(), { x: wDoorHingeX, y: wJuncY, z: wDoorHingeZ }],
      [leverGripGeo.clone(), { rz: Math.PI * 0.5, x: 0.015, y: 0.11, z: 0.018, postRx: -0.58, postX: wBrkX + 0.132, postY: wBrkY, postZ: wallZ + 0.094 }],
      [wallCuffsGeo.clone(), { x: wJuncX, y: 1.32, z: -1.38 }],
    ])
  )
  const decoyWallPlaqueGeo = getPooledGeometry('wiring:decoyWallPlaque', () =>
    buildMergedWiringParts([
      [wallPlaqueGeo.clone(), {}],
      [wallDoorPlaqueGeo.clone(), { x: wDoorHingeX, y: wJuncY, z: wDoorHingeZ }],
    ])
  )
  const decoyWallCableGeo = getPooledGeometry('wiring:decoyWallCable', () =>
    buildMergedWiringParts([
      [wallCablesGeo.clone(), { x: wJuncX, y: 1.32, z: -1.38 }],
      ...wallCableSpecs.map((cs) => [
        tipGeo.clone(),
        { rx: cs.rx + 0.14, rz: cs.rz, x: wJuncX + cs.tx, y: 1.32 + cs.ty, z: -1.38 + cs.tz },
      ]),
    ])
  )

  const decoyCeilingDarkSteelGeo = getPooledGeometry('wiring:decoyCeilingDarkSteel', () =>
    buildMergedWiringParts([
      [ceilingSteelGeo.clone(), {}],
      [leverArmGeo.clone(), { x: 0, y: 0.055, z: 0.014, postRx: -0.58, postX: cBrkX + 0.132, postY: cBrkY, postZ: 0.025 }],
    ])
  )
  const decoyCeilingLockerBlueGeo = getPooledGeometry('wiring:decoyCeilingLockerBlue', () =>
    buildMergedWiringParts([
      [ceilingEnclosureGeo.clone(), {}],
      [ceilingDoorGeo.clone(), { x: cJuncX - 0.18, y: cJuncY, z: 0.175 }],
    ])
  )
  const decoyCeilingRustyMetalGeo = getPooledGeometry('wiring:decoyCeilingRustyMetal', () =>
    buildMergedWiringParts([
      [ceilingRustGeo.clone(), {}],
      [leverGripGeo.clone(), { rz: Math.PI * 0.5, x: 0.015, y: 0.11, z: 0.018, postRx: -0.58, postX: cBrkX + 0.132, postY: cBrkY, postZ: 0.025 }],
      [ceilingCuffsGeo.clone(), { x: cJuncX, y: 1.65, z: 0 }],
    ])
  )
  const decoyCeilingPlaqueGeo = getPooledGeometry('wiring:decoyCeilingPlaque', () =>
    buildMergedWiringParts([
      [ceilingPlaqueGeo.clone(), {}],
      [ceilingDoorPlaqueGeo.clone(), { x: cJuncX - 0.18, y: cJuncY, z: 0.175 }],
    ])
  )
  const decoyCeilingCableGeo = getPooledGeometry('wiring:decoyCeilingCable', () =>
    buildMergedWiringParts([
      [ceilingCablesGeo.clone(), { x: cJuncX, y: 1.65, z: 0 }],
      ...ceilingCableSpecs.map((cs) => [
        tipGeo.clone(),
        { rx: cs.rx, rz: cs.rz, x: cJuncX + cs.tx, y: 1.65 + cs.ty, z: cs.tz },
      ]),
    ])
  )

  return {
    darkSteelMat: envMats.darkSteel,
    lockerBlueMat: envMats.lockerBlue,
    rustyMetalMat: envMats.rustyMetal,
    cableMat: envMats.cableBlack,
    plaqueMat: envMats.warningYellow,
    wallSteelGeo,
    wallEnclosureGeo,
    wallDoorGeo,
    wallDoorClaspGeo,
    wallDoorPlaqueGeo,
    wallRustGeo,
    wallPlaqueGeo,
    wallCablesGeo,
    wallCuffsGeo,
    ceilingSteelGeo,
    ceilingEnclosureGeo,
    ceilingDoorGeo,
    ceilingDoorPlaqueGeo,
    ceilingRustGeo,
    ceilingPlaqueGeo,
    ceilingCablesGeo,
    ceilingCuffsGeo,
    tipGeo,
    leverArmGeo,
    leverGripGeo,
    decoyWallDarkSteelGeo,
    decoyWallLockerBlueGeo,
    decoyWallRustyMetalGeo,
    decoyWallPlaqueGeo,
    decoyWallCableGeo,
    decoyCeilingDarkSteelGeo,
    decoyCeilingLockerBlueGeo,
    decoyCeilingRustyMetalGeo,
    decoyCeilingPlaqueGeo,
    decoyCeilingCableGeo,
    wallCableSpecs,
    ceilingCableSpecs,
  }
}

/**
 * Builds visually matching, non-hazardous intact electrical panel + conduit decoys
 * (`maze-electrical-wiring-decoys`) on unoccupied walls and ceiling intersections.
 */
export function buildElectricalWiringDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getElectricalWiringSharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5

  const group = new THREE.Group()
  group.name = ELECTRICAL_WIRING_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const wallDecoys = []
  const ceilingDecoys = []
  for (let i = 0; i < count; i += 1) {
    if (decoys[i].mountType === 'ceiling') {
      ceilingDecoys.push(decoys[i])
    } else {
      wallDecoys.push(decoys[i])
    }
  }

  const chunkLayout = createMazeChunkLayout(maze, { maxChunksPerAxis: 2 })
  const dummy = new THREE.Object3D()
  const meshes = []

  const addMountBatch = (list, prefix, geos) => {
    if (list.length === 0) return
    const chunkMatrices = Array.from({ length: chunkLayout.totalChunks }, () => [])
    for (let i = 0; i < list.length; i += 1) {
      const d = list[i]
      const cx = originX + (d.col + 0.5) * CELL_SIZE
      const cz = originZ + (d.row + 0.5) * CELL_SIZE
      dummy.position.set(cx, 0, cz)
      dummy.rotation.set(0, d.mountType === 'wall' && Number.isFinite(d.wallYaw) ? d.wallYaw : 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      chunkMatrices[chunkLayout.getChunkIndex(cx, cz)].push(dummy.matrix.clone())
    }
    const parts = [
      ['steel', geos.darkSteel, assets.darkSteelMat],
      ['enclosure', geos.lockerBlue, assets.lockerBlueMat],
      ['rust', geos.rustyMetal, assets.rustyMetalMat],
      ['plaque', geos.plaque, assets.plaqueMat],
      ['cable', geos.cable, assets.cableMat],
    ]
    for (let p = 0; p < parts.length; p += 1) {
      const [suffix, geo, mat] = parts[p]
      pushChunkedInstancedBatch(meshes, chunkLayout, `${prefix}-${suffix}`, geo, mat, chunkMatrices, {
        castShadow: false,
        receiveShadow: false,
      })
    }
  }

  addMountBatch(wallDecoys, 'electrical-wiring-decoy-wall', {
    darkSteel: assets.decoyWallDarkSteelGeo,
    lockerBlue: assets.decoyWallLockerBlueGeo,
    rustyMetal: assets.decoyWallRustyMetalGeo,
    plaque: assets.decoyWallPlaqueGeo,
    cable: assets.decoyWallCableGeo,
  })
  addMountBatch(ceilingDecoys, 'electrical-wiring-decoy-ceil', {
    darkSteel: assets.decoyCeilingDarkSteelGeo,
    lockerBlue: assets.decoyCeilingLockerBlueGeo,
    rustyMetal: assets.decoyCeilingRustyMetalGeo,
    plaque: assets.decoyCeilingPlaqueGeo,
    cable: assets.decoyCeilingCableGeo,
  })

  for (let i = 0; i < meshes.length; i += 1) {
    group.add(meshes[i])
  }

  return group
}

function getSteamPipeSharedAssets(qualityPreset = 'high') {
  const envMats = getEnvironmentalPropMaterials({ qualityPreset })
  const pipeMainY = STEAM_PIPE_CONSTANTS.pipeMainY
  const ceilingSoffitY = STEAM_PIPE_CONSTANTS.ceilingAnchorY

  const riserGeo = getPooledGeometry(
    'steam_pipe:vertical_riser',
    () => new THREE.CylinderGeometry(0.052, 0.052, 3.58, 10)
  )
  const deckFlangeGeo = getPooledGeometry(
    'steam_pipe:deck_flange',
    () => new THREE.CylinderGeometry(0.11, 0.12, 0.036, 12)
  )
  const elbowCollarGeo = getPooledGeometry(
    'steam_pipe:elbow_collar',
    () => new THREE.CylinderGeometry(0.072, 0.072, 0.11, 10)
  )
  const headerRunGeo = getPooledGeometry(
    'steam_pipe:header_run',
    () => new THREE.CylinderGeometry(0.056, 0.056, 2.2, 10)
  )
  const wallPlateGeo = getPooledGeometry(
    'steam_pipe:wall_plate',
    () => new THREE.BoxGeometry(0.14, 0.16, 0.024)
  )
  const wallStrutGeo = getPooledGeometry(
    'steam_pipe:wall_strut',
    () => new THREE.BoxGeometry(0.036, 0.036, 0.16)
  )
  const clampRingGeo = getPooledGeometry(
    'steam_pipe:clamp_ring',
    () => new THREE.CylinderGeometry(0.068, 0.068, 0.042, 10)
  )
  const ceilingStrapGeo = getPooledGeometry(
    'steam_pipe:ceiling_strap',
    () => new THREE.BoxGeometry(0.04, 0.44, 0.04)
  )
  const gaugeStemGeo = getPooledGeometry(
    'steam_pipe:gauge_stem',
    () => new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8)
  )
  const gaugeDialGeo = getPooledGeometry(
    'steam_pipe:gauge_dial',
    () => new THREE.CylinderGeometry(0.065, 0.065, 0.032, 12)
  )
  const valveBodyGeo = getPooledGeometry(
    'steam_pipe:valve_body',
    () => new THREE.CylinderGeometry(0.076, 0.076, 0.13, 10)
  )
  const valveStemGeo = getPooledGeometry(
    'steam_pipe:valve_stem',
    () => new THREE.CylinderGeometry(0.016, 0.016, 0.11, 8)
  )
  const valveWheelRimGeo = getPooledGeometry(
    'steam_pipe:valve_wheel_rim',
    () => new THREE.CylinderGeometry(0.115, 0.115, 0.024, 12)
  )
  const valveSpokeGeo = getPooledGeometry(
    'steam_pipe:valve_spoke',
    () => new THREE.BoxGeometry(0.21, 0.018, 0.018)
  )
  const pipeGeo = getPooledGeometry(
    'steam_pipe:main_branch',
    () => new THREE.CylinderGeometry(0.058, 0.058, 1.36, 12)
  )
  const unionPlateGeo = getPooledGeometry(
    'steam_pipe:union_plate',
    () => new THREE.CylinderGeometry(0.105, 0.105, 0.028, 12)
  )
  const gasketRingGeo = getPooledGeometry(
    'steam_pipe:gasket_ring',
    () => new THREE.CylinderGeometry(0.092, 0.092, 0.018, 12)
  )
  const boltPinGeo = getPooledGeometry(
    'steam_pipe:flange_bolt',
    () => new THREE.BoxGeometry(0.085, 0.018, 0.018)
  )

  const buildDecoyMountGeos = (mountType) => {
    const lineZ = mountType === 'ceiling' ? -1.24 : -1.8
    const keySuffix = mountType === 'ceiling' ? 'Ceiling' : 'Wall'
    const rustyParts = [
      [headerRunGeo.clone(), { rz: Math.PI * 0.5, x: 0.1, y: ceilingSoffitY - 0.36, z: lineZ }],
      [pipeGeo.clone(), { rz: Math.PI * 0.5, x: 0.1, y: pipeMainY, z: lineZ }],
    ]
    const steelParts = [
      [valveStemGeo.clone(), { rx: Math.PI * 0.5, x: -0.58, y: pipeMainY - 0.1, z: lineZ + 0.06 }],
      [valveSpokeGeo.clone(), { x: -0.58, y: pipeMainY - 0.1, z: lineZ + 0.115 }],
      [valveSpokeGeo.clone(), { rz: Math.PI * 0.5, x: -0.58, y: pipeMainY - 0.1, z: lineZ + 0.115 }],
      [unionPlateGeo.clone(), { rz: Math.PI * 0.5, x: 0.14 - 0.022, y: pipeMainY, z: lineZ }],
      [unionPlateGeo.clone(), { rz: Math.PI * 0.5, x: 0.14 + 0.022, y: pipeMainY, z: lineZ }],
    ]
    const brassParts = [
      [gaugeStemGeo.clone(), { x: -0.58, y: pipeMainY + 0.11, z: lineZ + 0.03 }],
      [gaugeDialGeo.clone(), { rx: Math.PI * 0.5, x: -0.58, y: pipeMainY + 0.19, z: lineZ + 0.055 }],
      [valveBodyGeo.clone(), { x: -0.58, y: pipeMainY - 0.1, z: lineZ }],
      [valveWheelRimGeo.clone(), { rx: Math.PI * 0.5, x: -0.58, y: pipeMainY - 0.1, z: lineZ + 0.115 }],
    ]
    for (const rx of [-0.58, 0.78]) {
      rustyParts.push([riserGeo.clone(), { x: rx, y: ceilingSoffitY * 0.5, z: lineZ }])
      steelParts.push(
        [deckFlangeGeo.clone(), { x: rx, y: 0.018, z: lineZ }],
        [deckFlangeGeo.clone(), { x: rx, y: ceilingSoffitY - 0.018, z: lineZ }],
        [elbowCollarGeo.clone(), { x: rx, y: pipeMainY, z: lineZ }],
        [elbowCollarGeo.clone(), { x: rx, y: ceilingSoffitY - 0.36, z: lineZ }]
      )
    }
    if (mountType === 'wall') {
      const bracketCoords = [
        { x: -0.58, y: 0.72, horiz: false },
        { x: -0.58, y: 2.35, horiz: false },
        { x: 0.78, y: 0.72, horiz: false },
        { x: 0.78, y: 2.35, horiz: false },
        { x: -0.22, y: pipeMainY, horiz: true },
        { x: 0.48, y: pipeMainY, horiz: true },
      ]
      for (let i = 0; i < bracketCoords.length; i += 1) {
        const bc = bracketCoords[i]
        steelParts.push(
          [wallPlateGeo.clone(), { x: bc.x, y: bc.y, z: -1.955 }],
          [wallStrutGeo.clone(), { x: bc.x, y: bc.y, z: -1.88 }],
          [clampRingGeo.clone(), { rz: bc.horiz ? Math.PI * 0.5 : 0, x: bc.x, y: bc.y, z: lineZ }]
        )
      }
    } else {
      for (const sx of [-0.58, 0.1, 0.78]) {
        steelParts.push([ceilingStrapGeo.clone(), { x: sx, y: ceilingSoffitY - 0.22, z: lineZ }])
      }
    }
    for (let b = 0; b < 4; b += 1) {
      const angle = (b / 4) * Math.PI * 2 + Math.PI * 0.25
      brassParts.push([
        boltPinGeo.clone(),
        { x: 0.14, y: pipeMainY + Math.cos(angle) * 0.082, z: lineZ + Math.sin(angle) * 0.082 },
      ])
    }
    const gasketGeo = getPooledGeometry(`steam_pipe:decoy${keySuffix}Gasket`, () =>
      buildMergedWiringParts([[gasketRingGeo.clone(), { rz: Math.PI * 0.5, x: 0.14, y: pipeMainY, z: lineZ }]])
    )
    return {
      rustyGeo: getPooledGeometry(`steam_pipe:decoy${keySuffix}Rusty`, () => buildMergedWiringParts(rustyParts)),
      steelGeo: getPooledGeometry(`steam_pipe:decoy${keySuffix}Steel`, () => buildMergedWiringParts(steelParts)),
      brassGeo: getPooledGeometry(`steam_pipe:decoy${keySuffix}Brass`, () => buildMergedWiringParts(brassParts)),
      gasketGeo,
    }
  }

  return {
    pipeMetalMat: envMats.rustyMetal,
    darkSteelMat: envMats.darkSteel,
    brassMat: envMats.warningYellow,
    gasketMat: envMats.cableBlack,
    valveMat: envMats.warningYellow,
    riserGeo,
    deckFlangeGeo,
    elbowCollarGeo,
    headerRunGeo,
    wallPlateGeo,
    wallStrutGeo,
    clampRingGeo,
    ceilingStrapGeo,
    gaugeStemGeo,
    gaugeDialGeo,
    valveBodyGeo,
    valveStemGeo,
    valveWheelRimGeo,
    valveSpokeGeo,
    pipeGeo,
    unionPlateGeo,
    gasketRingGeo,
    boltPinGeo,
    decoyWall: buildDecoyMountGeos('wall'),
    decoyCeiling: buildDecoyMountGeos('ceiling'),
  }
}

/**
 * Builds visually matching, non-hazardous pressurized steam pipe decoys
 * (`maze-steam-pipe-decoys`) on unoccupied wall corridors and ceiling runs.
 */
export function buildSteamPipeDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getSteamPipeSharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5

  const group = new THREE.Group()
  group.name = STEAM_PIPE_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const wallDecoys = []
  const ceilingDecoys = []
  for (let i = 0; i < count; i += 1) {
    if (decoys[i].mountType === 'ceiling') {
      ceilingDecoys.push(decoys[i])
    } else {
      wallDecoys.push(decoys[i])
    }
  }

  const chunkLayout = createMazeChunkLayout(maze, { maxChunksPerAxis: 2 })
  const dummy = new THREE.Object3D()
  const meshes = []

  const addMountBatch = (list, prefix, geos) => {
    if (list.length === 0) return
    const chunkMatrices = Array.from({ length: chunkLayout.totalChunks }, () => [])
    for (let i = 0; i < list.length; i += 1) {
      const d = list[i]
      const cx = originX + (d.col + 0.5) * CELL_SIZE
      const cz = originZ + (d.row + 0.5) * CELL_SIZE
      dummy.position.set(cx, 0, cz)
      dummy.rotation.set(0, Number.isFinite(d.steamYaw) ? d.steamYaw : 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      chunkMatrices[chunkLayout.getChunkIndex(cx, cz)].push(dummy.matrix.clone())
    }
    const parts = [
      ['rust', geos.rustyGeo, assets.pipeMetalMat],
      ['steel', geos.steelGeo, assets.darkSteelMat],
      ['brass', geos.brassGeo, assets.brassMat],
      ['gasket', geos.gasketGeo, assets.gasketMat],
    ]
    for (let p = 0; p < parts.length; p += 1) {
      const [suffix, geo, mat] = parts[p]
      pushChunkedInstancedBatch(meshes, chunkLayout, `${prefix}-${suffix}`, geo, mat, chunkMatrices, {
        castShadow: false,
        receiveShadow: false,
      })
    }
  }

  addMountBatch(wallDecoys, 'steam-pipe-decoy-wall', assets.decoyWall)
  addMountBatch(ceilingDecoys, 'steam-pipe-decoy-ceil', assets.decoyCeiling)

  for (let i = 0; i < meshes.length; i += 1) {
    group.add(meshes[i])
  }

  return group
}

function getFallingPipesSharedAssets(qualityPreset = 'high') {
  const envMats = getEnvironmentalPropMaterials({ qualityPreset })
  const pipeRestY = FALLING_PIPES_CONSTANTS.pipeRestY
  const ceilingAnchorY = FALLING_PIPES_CONSTANTS.ceilingAnchorY
  const overheadZ = FALLING_PIPES_CONSTANTS.overheadLocalZ

  const deckFlangeGeo = getPooledGeometry(
    'falling_pipes:deck_flange',
    () => new THREE.CylinderGeometry(0.145, 0.145, 0.036, 12)
  )
  const upperRiserGeo = getPooledGeometry(
    'falling_pipes:upper_riser',
    () => new THREE.CylinderGeometry(0.105, 0.105, 0.34, 10)
  )
  const riserCollarGeo = getPooledGeometry(
    'falling_pipes:riser_collar',
    () => new THREE.CylinderGeometry(0.136, 0.136, 0.032, 12)
  )
  const hangerPlateGeo = getPooledGeometry(
    'falling_pipes:hanger_plate',
    () => new THREE.BoxGeometry(0.14, 0.024, 0.14)
  )
  const upperRodGeo = getPooledGeometry(
    'falling_pipes:upper_rod',
    () => new THREE.CylinderGeometry(0.015, 0.015, 0.24, 6)
  )
  const wallPlateGeo = getPooledGeometry(
    'falling_pipes:wall_plate',
    () => new THREE.BoxGeometry(0.036, 0.36, 0.36)
  )
  const wallArmGeo = getPooledGeometry(
    'falling_pipes:wall_arm',
    () => new THREE.CylinderGeometry(0.126, 0.126, 0.14, 10)
  )
  const wallGussetGeo = getPooledGeometry(
    'falling_pipes:wall_gusset',
    () => new THREE.BoxGeometry(0.18, 0.042, 0.052)
  )
  const strainRodGeo = getPooledGeometry(
    'falling_pipes:strain_rod',
    () => new THREE.CylinderGeometry(0.014, 0.014, 0.22, 6)
  )
  const mainBarrelGeo = getPooledGeometry(
    'falling_pipes:main_barrel',
    () => new THREE.CylinderGeometry(0.105, 0.105, 3.52, 12)
  )
  const elbowHubGeo = getPooledGeometry(
    'falling_pipes:elbow_hub',
    () => new THREE.CylinderGeometry(0.12, 0.12, 0.16, 10)
  )
  const riserNeckGeo = getPooledGeometry(
    'falling_pipes:riser_neck',
    () => new THREE.CylinderGeometry(0.105, 0.105, 0.17, 10)
  )
  const slipFlangeGeo = getPooledGeometry(
    'falling_pipes:slip_flange',
    () => new THREE.CylinderGeometry(0.132, 0.132, 0.028, 12)
  )
  const unionFlangeGeo = getPooledGeometry(
    'falling_pipes:union_flange',
    () => new THREE.CylinderGeometry(0.142, 0.142, 0.032, 12)
  )
  const unionGasketGeo = getPooledGeometry(
    'falling_pipes:union_gasket',
    () => new THREE.CylinderGeometry(0.136, 0.136, 0.018, 12)
  )
  const teeBodyGeo = getPooledGeometry(
    'falling_pipes:tee_body',
    () => new THREE.CylinderGeometry(0.122, 0.122, 0.2, 10)
  )
  const valveBonnetGeo = getPooledGeometry(
    'falling_pipes:valve_bonnet',
    () => new THREE.CylinderGeometry(0.042, 0.054, 0.11, 8)
  )
  const valveWheelGeo = getPooledGeometry(
    'falling_pipes:valve_wheel',
    () => new THREE.CylinderGeometry(0.082, 0.082, 0.022, 12)
  )
  const returnLineGeo = getPooledGeometry(
    'falling_pipes:return_line',
    () => new THREE.CylinderGeometry(0.03, 0.03, 3.44, 8)
  )
  const clampStrapGeo = getPooledGeometry(
    'falling_pipes:clamp_strap',
    () => new THREE.BoxGeometry(0.052, 0.25, 0.18)
  )
  const clevisRingGeo = getPooledGeometry(
    'falling_pipes:clevis_ring',
    () => new THREE.CylinderGeometry(0.122, 0.122, 0.046, 10)
  )
  const clevisEarGeo = getPooledGeometry(
    'falling_pipes:clevis_ear',
    () => new THREE.BoxGeometry(0.048, 0.078, 0.048)
  )

  const buildDecoyMountGeos = (mountType) => {
    const keySuffix = mountType === 'ceiling' ? 'Ceiling' : 'Wall'
    const pipeParts = [
      [mainBarrelGeo.clone(), { rz: Math.PI * 0.5, x: 0, y: pipeRestY, z: overheadZ }],
      [valveBonnetGeo.clone(), { rx: Math.PI * 0.42, x: 0.42, y: pipeRestY - 0.01, z: overheadZ + 0.095 }],
    ]
    const steelParts = [
      [teeBodyGeo.clone(), { rz: Math.PI * 0.5, x: 0.42, y: pipeRestY, z: overheadZ }],
      [returnLineGeo.clone(), { rz: Math.PI * 0.5, x: 0, y: pipeRestY - 0.108, z: overheadZ - 0.045 }],
    ]
    for (const rx of [-1.8, 1.8]) {
      steelParts.push(
        [deckFlangeGeo.clone(), { x: rx, y: ceilingAnchorY - 0.018, z: overheadZ }],
        [riserCollarGeo.clone(), { x: rx, y: ceilingAnchorY - 0.33, z: overheadZ }]
      )
      pipeParts.push([upperRiserGeo.clone(), { x: rx, y: ceilingAnchorY - 0.17, z: overheadZ }])
    }
    for (const hx of [-1.05, 1.05]) {
      steelParts.push(
        [hangerPlateGeo.clone(), { x: hx, y: ceilingAnchorY - 0.012, z: overheadZ }],
        [upperRodGeo.clone(), { x: hx, y: ceilingAnchorY - 0.13, z: overheadZ }],
        [clevisRingGeo.clone(), { rz: Math.PI * 0.5, x: hx, y: pipeRestY, z: overheadZ }]
      )
      pipeParts.push(
        [strainRodGeo.clone(), { x: hx, y: pipeRestY + 0.16, z: overheadZ }],
        [clevisEarGeo.clone(), { x: hx, y: pipeRestY + 0.115, z: overheadZ }]
      )
    }
    if (mountType === 'wall') {
      for (const wx of [-1, 1]) {
        steelParts.push(
          [wallPlateGeo.clone(), { x: wx * 1.965, y: pipeRestY, z: overheadZ }],
          [wallArmGeo.clone(), { rz: Math.PI * 0.5, x: wx * 1.89, y: pipeRestY, z: overheadZ }]
        )
        pipeParts.push([
          wallGussetGeo.clone(),
          { rz: wx * 0.62, x: wx * 1.87, y: pipeRestY - 0.15, z: overheadZ },
        ])
      }
    }
    for (const ex of [-1.74, 1.74]) {
      const sign = Math.sign(ex)
      steelParts.push(
        [elbowHubGeo.clone(), { rz: Math.PI * 0.5, x: ex, y: pipeRestY, z: overheadZ }],
        [slipFlangeGeo.clone(), { x: sign * 1.8, y: pipeRestY + 0.15, z: overheadZ }]
      )
      pipeParts.push([riserNeckGeo.clone(), { x: sign * 1.8, y: pipeRestY + 0.075, z: overheadZ }])
    }
    for (const ux of [-0.026, 0.026]) {
      steelParts.push([unionFlangeGeo.clone(), { rz: Math.PI * 0.5, x: ux, y: pipeRestY, z: overheadZ }])
    }
    for (const cx of [-0.68, 0.68]) {
      steelParts.push([clampStrapGeo.clone(), { x: cx, y: pipeRestY - 0.015, z: overheadZ - 0.015 }])
    }

    return {
      pipeMetalGeo: getPooledGeometry(`falling_pipes:decoy${keySuffix}Pipe`, () => buildMergedWiringParts(pipeParts)),
      steelGeo: getPooledGeometry(`falling_pipes:decoy${keySuffix}Steel`, () => buildMergedWiringParts(steelParts)),
      valveGeo: getPooledGeometry(`falling_pipes:decoy${keySuffix}Valve`, () =>
        buildMergedWiringParts([[valveWheelGeo.clone(), { rx: Math.PI * 0.42, x: 0.42, y: pipeRestY - 0.02, z: overheadZ + 0.15 }]])
      ),
      gasketGeo: getPooledGeometry(`falling_pipes:decoy${keySuffix}Gasket`, () =>
        buildMergedWiringParts([[unionGasketGeo.clone(), { rz: Math.PI * 0.5, x: 0, y: pipeRestY, z: overheadZ }]])
      ),
    }
  }

  return {
    pipeMetalMat: envMats.rustyMetal,
    darkSteelMat: envMats.darkSteel,
    valveWheelMat: envMats.warningYellow,
    gasketBlackMat: envMats.cableBlack,
    deckFlangeGeo,
    upperRiserGeo,
    riserCollarGeo,
    hangerPlateGeo,
    upperRodGeo,
    wallPlateGeo,
    wallArmGeo,
    wallGussetGeo,
    strainRodGeo,
    mainBarrelGeo,
    elbowHubGeo,
    riserNeckGeo,
    slipFlangeGeo,
    unionFlangeGeo,
    unionGasketGeo,
    teeBodyGeo,
    valveBonnetGeo,
    valveWheelGeo,
    returnLineGeo,
    clampStrapGeo,
    clevisRingGeo,
    clevisEarGeo,
    decoyWall: buildDecoyMountGeos('wall'),
    decoyCeiling: buildDecoyMountGeos('ceiling'),
  }
}

/**
 * Builds visually matching, non-hazardous overhead pipe & valve decoys
 * (`maze-falling-pipes-decoys`) matching dormant `falling_pipes_fixtures`.
 */
export function buildFallingPipesDecoys(
  maze,
  decoys,
  { qualityPreset = 'high' } = {}
) {
  if (!maze?.grid || !Array.isArray(decoys) || decoys.length === 0) {
    return null
  }

  const assets = getFallingPipesSharedAssets(qualityPreset)
  const count = decoys.length
  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5

  const group = new THREE.Group()
  group.name = FALLING_PIPES_CONSTANTS.decoyLayerName
  group.userData = {
    decoyCount: count,
    decoys,
  }

  const wallDecoys = []
  const ceilingDecoys = []
  for (let i = 0; i < count; i += 1) {
    if (decoys[i].mountType === 'ceiling') {
      ceilingDecoys.push(decoys[i])
    } else {
      wallDecoys.push(decoys[i])
    }
  }

  const chunkLayout = createMazeChunkLayout(maze, { maxChunksPerAxis: 2 })
  const dummy = new THREE.Object3D()
  const meshes = []

  const addMountBatch = (list, prefix, geos) => {
    if (list.length === 0) return
    const chunkMatrices = Array.from({ length: chunkLayout.totalChunks }, () => [])
    for (let i = 0; i < list.length; i += 1) {
      const d = list[i]
      const cx = originX + (d.col + 0.5) * CELL_SIZE
      const cz = originZ + (d.row + 0.5) * CELL_SIZE
      dummy.position.set(cx, 0, cz)
      dummy.rotation.set(0, Number.isFinite(d.pipeYaw) ? d.pipeYaw : 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      chunkMatrices[chunkLayout.getChunkIndex(cx, cz)].push(dummy.matrix.clone())
    }
    const parts = [
      ['pipe', geos.pipeMetalGeo, assets.pipeMetalMat],
      ['steel', geos.steelGeo, assets.darkSteelMat],
      ['valve', geos.valveGeo, assets.valveWheelMat],
      ['gasket', geos.gasketGeo, assets.gasketBlackMat],
    ]
    for (let p = 0; p < parts.length; p += 1) {
      const [suffix, geo, mat] = parts[p]
      pushChunkedInstancedBatch(meshes, chunkLayout, `${prefix}-${suffix}`, geo, mat, chunkMatrices, {
        castShadow: false,
        receiveShadow: true,
      })
    }
  }

  addMountBatch(wallDecoys, 'falling-pipes-decoy-wall', assets.decoyWall)
  addMountBatch(ceilingDecoys, 'falling-pipes-decoy-ceil', assets.decoyCeiling)

  for (let i = 0; i < meshes.length; i += 1) {
    group.add(meshes[i])
  }

  return group
}

/**
 * Builds procedural 3D meshes for the 10 realistic underground facility environmental hazards.
 */
export function buildHazardMesh(hazardData = {}) {
  const type = hazardData?.type
  if (!type) {
    throw new Error(`Unsupported hazard type: ${type}`)
  }
  const root = new THREE.Group()
  root.name = `hazard-${type}-${hazardData.id || 'default'}`

  switch (type) {
    case HAZARD_TYPES.CEILING_COLLAPSE: {
      const soffitY = Number.isFinite(hazardData.ceilingSoffitY)
        ? hazardData.ceilingSoffitY
        : MAZE_CEILING_CONFIG.soffitY
      const patchOffsetX = Number.isFinite(hazardData.localPatchOffset?.x)
        ? hazardData.localPatchOffset.x
        : 0
      const patchOffsetZ = Number.isFinite(hazardData.localPatchOffset?.z)
        ? hazardData.localPatchOffset.z
        : 0
      const collapseYaw = Number.isFinite(hazardData.collapseYaw) ? hazardData.collapseYaw : 0
      const rubbleHalfW = Number.isFinite(hazardData.rubbleHalfW)
        ? Math.max(0.44, hazardData.rubbleHalfW)
        : CEILING_COLLAPSE_CONSTANTS.rubbleHalfW
      const defaultHalfD = Number.isFinite(hazardData.rubbleHalfD)
        ? Math.max(0.44, hazardData.rubbleHalfD)
        : CEILING_COLLAPSE_CONSTANTS.rubbleHalfD
      const rubbleMinLocalZ = Number.isFinite(hazardData.rubbleMinLocalZ)
        ? hazardData.rubbleMinLocalZ
        : -defaultHalfD
      const rubbleMaxLocalZ = Number.isFinite(hazardData.rubbleMaxLocalZ)
        ? hazardData.rubbleMaxLocalZ
        : defaultHalfD
      const rubbleCenterLocalZ = Number.isFinite(hazardData.rubbleCenterLocalZ)
        ? hazardData.rubbleCenterLocalZ
        : (rubbleMinLocalZ + rubbleMaxLocalZ) * 0.5
      const rubbleHalfD = Math.max(0.44, (rubbleMaxLocalZ - rubbleMinLocalZ) * 0.5)
      const activeDuration = Number.isFinite(hazardData.activeDuration)
        ? hazardData.activeDuration
        : 1.2

      // Wall-safe local clamps inside corridor-aligned ceilingPatchGroup space:
      // local X spans both adjacent corridor tiles; local Z runs along walking direction
      const clampLocalX = (val, halfExtent) => {
        const lim = rubbleHalfW - halfExtent
        if (lim <= 0) return 0
        return Math.max(-lim, Math.min(lim, val))
      }
      const clampLocalZ = (val, halfExtent) => {
        const minZ = rubbleMinLocalZ + halfExtent
        const maxZ = rubbleMaxLocalZ - halfExtent
        if (minZ > maxZ) return rubbleCenterLocalZ
        return Math.max(minZ, Math.min(maxZ, val))
      }

      const qualityPreset = hazardData?.qualityPreset || 'high'
      const { soffitMat, rimGeo } = getCeilingCollapseSharedAssets(qualityPreset)
      const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset })
      const ceilingTex = surfaceSet?.ceiling || surfaceSet?.wall || null

      // Patch root sits centered across both corridor tiles, oriented by collapseYaw
      // so all cracks, cavity, rebar, debris, pebbles, and dust align cleanly with E-W / N-S corridors
      const ceilingPatchGroup = new THREE.Group()
      ceilingPatchGroup.name = 'hazard-ceiling-patch'
      ceilingPatchGroup.position.set(patchOffsetX, 0, patchOffsetZ)
      ceilingPatchGroup.rotation.y = collapseYaw
      root.add(ceilingPatchGroup)
      const spallMat = getPooledMaterial(`ceiling_collapse:spall:${qualityPreset}`, () =>
        new THREE.MeshStandardMaterial({
          color: HAZARD_PALETTE.ceilingSpall,
          map: ceilingTex?.map || null,
          roughnessMap: ceilingTex?.roughnessMap || null,
          bumpMap: ceilingTex?.bumpMap || null,
          bumpScale: 0.062,
          roughness: 0.96,
          metalness: 0.015,
          envMapIntensity: 0.36,
        })
      )
      const soffitHighlightMat = getPooledMaterial(
        `ceiling_collapse:soffit_highlight:${qualityPreset}`,
        () => {
          const mat = soffitMat.clone()
          mat.emissive = new THREE.Color(0x523f1e)
          mat.emissiveIntensity = 0.52
          return mat
        }
      )
      const spallHighlightMat = getPooledMaterial(
        `ceiling_collapse:spall_highlight:${qualityPreset}`,
        () => {
          const mat = spallMat.clone()
          mat.emissive = new THREE.Color(0x523f1e)
          mat.emissiveIntensity = 0.52
          return mat
        }
      )
      const cavityMat = getPooledMaterial(`ceiling_collapse:cavity:${qualityPreset}`, () =>
        new THREE.MeshStandardMaterial({
          color: HAZARD_PALETTE.ceilingCavity,
          map: ceilingTex?.map || null,
          roughnessMap: ceilingTex?.roughnessMap || null,
          bumpMap: ceilingTex?.bumpMap || null,
          bumpScale: 0.07,
          roughness: 0.97,
          metalness: 0.01,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      )
      const crackMat = getPooledMaterial('ceiling_collapse:crack', () =>
        new THREE.MeshStandardMaterial({
          color: HAZARD_PALETTE.ceilingCrack,
          roughness: 0.98,
          metalness: 0.0,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      )
      const rebarMat = getPooledMaterial('ceiling_collapse:rebar', () =>
        new THREE.MeshStandardMaterial({
          color: HAZARD_PALETTE.ceilingRebar,
          roughness: 0.86,
          metalness: 0.42,
        })
      )
      // Instance-owned translucent dust material (disposed cleanly per hazard instance)
      const ceilingDustMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.ceilingDust,
        roughness: 0.98,
        metalness: 0.0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // Overhead structural deterioration frame (inherits collapseYaw from ceilingPatchGroup)
      const ceilingOverheadGroup = new THREE.Group()
      ceilingOverheadGroup.name = 'hazard-ceiling-overhead'
      ceilingOverheadGroup.rotation.y = 0
      ceilingPatchGroup.add(ceilingOverheadGroup)

      // 1. Twelve branching stress cracks spanning both corridor tiles & full collapse length
      //    (strictly hidden while dormant to preserve 100% visual camouflage)
      const ceilingCrackGroup = new THREE.Group()
      ceilingCrackGroup.name = 'hazard-ceiling-cracks'
      ceilingCrackGroup.visible = false
      ceilingOverheadGroup.add(ceilingCrackGroup)

      const crackStripGeo = getPooledGeometry(
        'ceiling_collapse:crack_strip',
        () => new THREE.BoxGeometry(1, 0.008, 1)
      )
      const widthScale = Math.min(1, rubbleHalfW / CEILING_COLLAPSE_CONSTANTS.rubbleHalfW)
      const lengthScale = Math.min(1, rubbleHalfD / CEILING_COLLAPSE_CONSTANTS.rubbleHalfD)
      const rawCrackSpecs = [
        { nx: -0.05, nz: 0.0, len: 2.15, w: 0.022, rotY: 1.52 },
        { nx: 0.06, nz: -0.46, len: 1.85, w: 0.02, rotY: 0.24 },
        { nx: -0.08, nz: 0.46, len: 1.9, w: 0.02, rotY: -0.28 },
        { nx: -0.54, nz: -0.58, len: 1.35, w: 0.018, rotY: 1.18 },
        { nx: 0.54, nz: -0.52, len: 1.32, w: 0.018, rotY: -1.12 },
        { nx: -0.56, nz: 0.04, len: 1.48, w: 0.019, rotY: 0.48 },
        { nx: 0.56, nz: -0.04, len: 1.44, w: 0.019, rotY: -0.52 },
        { nx: -0.52, nz: 0.58, len: 1.28, w: 0.018, rotY: -1.24 },
        { nx: 0.52, nz: 0.54, len: 1.3, w: 0.018, rotY: 1.26 },
        { nx: -0.24, nz: -0.22, len: 1.2, w: 0.016, rotY: 0.92 },
        { nx: 0.26, nz: 0.24, len: 1.18, w: 0.016, rotY: -0.88 },
        { nx: 0.0, nz: -0.78, len: 1.42, w: 0.017, rotY: 0.14 },
      ]
      const ceilingCrackMeshes = []
      const ceilingCrackConfigs = []
      for (let i = 0; i < rawCrackSpecs.length; i += 1) {
        const cs = rawCrackSpecs[i]
        const cosR = Math.abs(Math.cos(cs.rotY))
        const sinR = Math.abs(Math.sin(cs.rotY))
        const scaledLen = cs.len * (0.45 + 0.55 * Math.min(widthScale, lengthScale))
        const maxLenX = cosR > 1e-3 ? (rubbleHalfW * 1.72) / cosR : scaledLen
        const maxLenZ = sinR > 1e-3 ? (rubbleHalfD * 1.72) / sinR : scaledLen
        const len = Math.max(0.24, Math.min(scaledLen, maxLenX, maxLenZ))
        const halfExtentX = len * 0.52 * cosR + cs.w
        const halfExtentZ = len * 0.52 * sinR + cs.w
        const cx = clampLocalX(cs.nx * rubbleHalfW, halfExtentX)
        const cz = clampLocalZ(rubbleCenterLocalZ + cs.nz * rubbleHalfD, halfExtentZ)
        const cfg = { x: cx, z: cz, len, w: cs.w, rotY: cs.rotY }
        const strip = new THREE.Mesh(crackStripGeo, crackMat)
        strip.position.set(cx, soffitY - 0.005, cz)
        strip.rotation.y = cs.rotY
        strip.scale.set(len, 1, cs.w)
        strip.receiveShadow = true
        ceilingCrackGroup.add(strip)
        ceilingCrackMeshes.push(strip)
        ceilingCrackConfigs.push(cfg)
      }

      // Legacy soffit bay reference kept hidden in all states so the genuine unbroken
      // maze-ceiling-deck slab renders with zero cutouts, seams, or texture mismatches.
      const ceilingSoffitRimMesh = new THREE.Mesh(rimGeo, soffitMat)
      ceilingSoffitRimMesh.position.set(0, soffitY - 0.007, rubbleCenterLocalZ)
      ceilingSoffitRimMesh.visible = false
      ceilingSoffitRimMesh.castShadow = false
      ceilingSoffitRimMesh.receiveShadow = true
      ceilingOverheadGroup.add(ceilingSoffitRimMesh)

      // 2. Expanded spalled concrete cavity & 8 oxidized rebar stubs across both tiles
      //    (strictly hidden while dormant; scales symmetrically from rubbleCenterLocalZ on failure)
      const ceilingCavityGroup = new THREE.Group()
      ceilingCavityGroup.name = 'hazard-ceiling-cavity'
      ceilingCavityGroup.position.set(0, 0, rubbleCenterLocalZ)
      ceilingCavityGroup.visible = false
      ceilingOverheadGroup.add(ceilingCavityGroup)

      const cavityCoreGeo = getPooledGeometry(
        'ceiling_collapse:cavity_core',
        () => new THREE.CylinderGeometry(0.39, 0.43, 0.022, 9)
      )
      const cavityScaleX = Math.max(0.95, (rubbleHalfW * 0.92) / 0.43)
      const cavityScaleZ = Math.max(0.95, (rubbleHalfD * 0.92) / 0.43)
      const cavityCore = new THREE.Mesh(cavityCoreGeo, cavityMat)
      cavityCore.position.set(0, soffitY - 0.011, 0)
      cavityCore.scale.set(cavityScaleX, 1, cavityScaleZ)
      cavityCore.receiveShadow = true
      ceilingCavityGroup.add(cavityCore)

      const cavityCoreInner = new THREE.Mesh(cavityCoreGeo, cavityMat)
      cavityCoreInner.position.set(0, soffitY - 0.014, 0)
      cavityCoreInner.rotation.y = 0.56
      cavityCoreInner.scale.set(cavityScaleX * 0.78, 1, cavityScaleZ * 0.8)
      cavityCoreInner.receiveShadow = true
      ceilingCavityGroup.add(cavityCoreInner)

      const rebarGeo = getPooledGeometry(
        'ceiling_collapse:rebar_rod',
        () => new THREE.CylinderGeometry(0.011, 0.011, 0.36, 6)
      )
      const rebarScaleLen = Math.max(1.0, Math.min(2.2, rubbleHalfW * 1.05))
      const rebarSpecs = [
        { nx: -0.62, nz: -0.58, rx: 0.22, ry: 0.34, rz: 1.48 },
        { nx: 0.58, nz: -0.52, rx: -0.26, ry: -0.42, rz: 1.44 },
        { nx: -0.18, nz: -0.26, rx: 1.38, ry: 0.22, rz: -0.28 },
        { nx: 0.22, nz: -0.12, rx: -1.36, ry: -0.24, rz: 0.3 },
        { nx: -0.64, nz: 0.14, rx: 0.28, ry: -0.36, rz: 1.46 },
        { nx: 0.62, nz: 0.2, rx: -0.24, ry: 0.4, rz: 1.5 },
        { nx: -0.48, nz: 0.62, rx: 1.4, ry: -0.18, rz: 0.24 },
        { nx: 0.46, nz: 0.58, rx: -1.42, ry: 0.26, rz: -0.22 },
      ]
      for (let i = 0; i < rebarSpecs.length; i += 1) {
        const rs = rebarSpecs[i]
        const rod = new THREE.Mesh(rebarGeo, rebarMat)
        rod.position.set(
          rs.nx * rubbleHalfW * 0.82,
          soffitY - 0.036,
          rs.nz * rubbleHalfD * 0.82
        )
        rod.rotation.set(rs.rx, rs.ry, rs.rz)
        rod.scale.set(1.15, rebarScaleLen, 1.15)
        ceilingCavityGroup.add(rod)
      }

      // 3. Sixteen fractured concrete & plaster slabs distributed across BOTH corridor tiles
      //    and across the full extended longitudinal collapse footprint (strictly hidden while dormant)
      const slabGeoA = getPooledGeometry('ceiling_collapse:slab_a', () =>
        createFracturedConcreteGeometry(101, 0.85)
      )
      const slabGeoB = getPooledGeometry('ceiling_collapse:slab_b', () =>
        createFracturedConcreteGeometry(211, 0.92)
      )
      const chunkGeoC = getPooledGeometry('ceiling_collapse:chunk_c', () =>
        createFracturedConcreteGeometry(307, 1.0)
      )
      const slabGeos = [slabGeoA, slabGeoB, chunkGeoC]

      const ceilingRubbleGroup = new THREE.Group()
      ceilingRubbleGroup.name = 'hazard-ceiling-rubble'
      // Conceal fractured debris completely while dormant so nothing protrudes below soffitY
      ceilingRubbleGroup.visible = false
      ceilingPatchGroup.add(ceilingRubbleGroup)

      const slabSizeScale = Math.max(0.55, Math.min(1, rubbleHalfW / 1.5))
      const rawSlabs = [
        // Band 1: Leading corridor end (Left, Center-Right, Far Right)
        {
          geoIdx: 0,
          mat: 'soffit',
          sx: 0.72,
          sy: 0.16,
          sz: 0.64,
          nx: -0.58,
          nz: -0.76,
          driftNx: -0.04,
          driftNz: -0.03,
          stackY: 0,
          restRotX: 0.07,
          restRotY: 0.34,
          restRotZ: -0.08,
          detachDelay: 0.02,
          v0Down: 1.2,
          gravity: 11.4,
          bounce: 0.16,
          spinX: 2.0,
          spinY: 0.9,
          spinZ: -1.7,
          maxSag: 0.068,
        },
        {
          geoIdx: 1,
          mat: 'spall',
          sx: 0.66,
          sy: 0.15,
          sz: 0.58,
          nx: 0.08,
          nz: -0.7,
          driftNx: 0.03,
          driftNz: -0.04,
          stackY: 0,
          restRotX: -0.08,
          restRotY: 1.12,
          restRotZ: 0.09,
          detachDelay: 0.05,
          v0Down: 1.15,
          gravity: 11.2,
          bounce: 0.17,
          spinX: -2.2,
          spinY: 1.1,
          spinZ: 1.8,
          maxSag: 0.06,
        },
        {
          geoIdx: 0,
          mat: 'spall',
          sx: 0.7,
          sy: 0.16,
          sz: 0.62,
          nx: 0.62,
          nz: -0.74,
          driftNx: 0.04,
          driftNz: -0.02,
          stackY: 0,
          restRotX: 0.06,
          restRotY: -0.58,
          restRotZ: 0.08,
          detachDelay: 0.04,
          v0Down: 1.18,
          gravity: 11.3,
          bounce: 0.16,
          spinX: 1.9,
          spinY: -1.3,
          spinZ: 2.0,
          maxSag: 0.064,
        },
        {
          geoIdx: 2,
          mat: 'soffit',
          sx: 0.42,
          sy: 0.17,
          sz: 0.4,
          nx: -0.26,
          nz: -0.46,
          driftNx: -0.03,
          driftNz: 0.03,
          stackY: 0.04,
          restRotX: -0.1,
          restRotY: 2.04,
          restRotZ: -0.08,
          detachDelay: 0.09,
          v0Down: 1.0,
          gravity: 11.0,
          bounce: 0.2,
          spinX: -2.6,
          spinY: 1.6,
          spinZ: -2.1,
          maxSag: 0.048,
        },
        // Band 2: Mid-leading corridor section (Left, Center, Right, Accent)
        {
          geoIdx: 1,
          mat: 'soffit',
          sx: 0.74,
          sy: 0.17,
          sz: 0.66,
          nx: -0.64,
          nz: -0.24,
          driftNx: -0.03,
          driftNz: -0.02,
          stackY: 0,
          restRotX: 0.08,
          restRotY: 0.74,
          restRotZ: -0.06,
          detachDelay: 0.0,
          v0Down: 1.28,
          gravity: 11.5,
          bounce: 0.15,
          spinX: 2.1,
          spinY: -1.0,
          spinZ: 1.6,
          maxSag: 0.072,
        },
        {
          geoIdx: 0,
          mat: 'spall',
          sx: 0.76,
          sy: 0.18,
          sz: 0.68,
          nx: -0.06,
          nz: -0.18,
          driftNx: -0.02,
          driftNz: 0.02,
          stackY: 0,
          restRotX: -0.06,
          restRotY: 0.22,
          restRotZ: 0.09,
          detachDelay: 0.01,
          v0Down: 1.3,
          gravity: 11.5,
          bounce: 0.15,
          spinX: -1.8,
          spinY: 0.85,
          spinZ: -1.5,
          maxSag: 0.075,
        },
        {
          geoIdx: 1,
          mat: 'soffit',
          sx: 0.72,
          sy: 0.16,
          sz: 0.64,
          nx: 0.58,
          nz: -0.22,
          driftNx: 0.03,
          driftNz: 0.02,
          stackY: 0,
          restRotX: 0.09,
          restRotY: 1.48,
          restRotZ: -0.09,
          detachDelay: 0.03,
          v0Down: 1.24,
          gravity: 11.4,
          bounce: 0.16,
          spinX: 2.3,
          spinY: 1.25,
          spinZ: -1.9,
          maxSag: 0.066,
        },
        {
          geoIdx: 2,
          mat: 'spall',
          sx: 0.4,
          sy: 0.18,
          sz: 0.38,
          nx: 0.3,
          nz: -0.04,
          driftNx: 0.04,
          driftNz: -0.02,
          stackY: 0.05,
          restRotX: -0.11,
          restRotY: -1.22,
          restRotZ: 0.1,
          detachDelay: 0.11,
          v0Down: 0.95,
          gravity: 10.8,
          bounce: 0.21,
          spinX: -3.0,
          spinY: 1.9,
          spinZ: 2.3,
          maxSag: 0.045,
        },
        // Band 3: Mid-trailing corridor section (Left, Center, Right, Accent)
        {
          geoIdx: 0,
          mat: 'spall',
          sx: 0.7,
          sy: 0.16,
          sz: 0.62,
          nx: -0.6,
          nz: 0.24,
          driftNx: -0.04,
          driftNz: 0.02,
          stackY: 0,
          restRotX: -0.07,
          restRotY: -0.82,
          restRotZ: 0.07,
          detachDelay: 0.03,
          v0Down: 1.22,
          gravity: 11.4,
          bounce: 0.16,
          spinX: 1.95,
          spinY: -1.35,
          spinZ: 2.1,
          maxSag: 0.064,
        },
        {
          geoIdx: 1,
          mat: 'soffit',
          sx: 0.74,
          sy: 0.17,
          sz: 0.66,
          nx: 0.06,
          nz: 0.22,
          driftNx: 0.02,
          driftNz: -0.02,
          stackY: 0,
          restRotX: 0.08,
          restRotY: 0.56,
          restRotZ: -0.08,
          detachDelay: 0.02,
          v0Down: 1.26,
          gravity: 11.4,
          bounce: 0.16,
          spinX: -2.1,
          spinY: 1.05,
          spinZ: -1.8,
          maxSag: 0.07,
        },
        {
          geoIdx: 0,
          mat: 'spall',
          sx: 0.72,
          sy: 0.16,
          sz: 0.64,
          nx: 0.64,
          nz: 0.26,
          driftNx: 0.03,
          driftNz: 0.03,
          stackY: 0,
          restRotX: -0.08,
          restRotY: 1.86,
          restRotZ: 0.08,
          detachDelay: 0.06,
          v0Down: 1.16,
          gravity: 11.2,
          bounce: 0.18,
          spinX: 2.4,
          spinY: -1.5,
          spinZ: -2.0,
          maxSag: 0.06,
        },
        {
          geoIdx: 2,
          mat: 'soffit',
          sx: 0.38,
          sy: 0.16,
          sz: 0.36,
          nx: -0.32,
          nz: 0.44,
          driftNx: -0.03,
          driftNz: 0.03,
          stackY: 0.04,
          restRotX: 0.1,
          restRotY: 0.92,
          restRotZ: -0.09,
          detachDelay: 0.12,
          v0Down: 0.92,
          gravity: 10.8,
          bounce: 0.22,
          spinX: 2.9,
          spinY: -2.0,
          spinZ: 2.4,
          maxSag: 0.044,
        },
        // Band 4: Trailing corridor end (Left, Center, Right, Accent)
        {
          geoIdx: 1,
          mat: 'soffit',
          sx: 0.68,
          sy: 0.15,
          sz: 0.6,
          nx: -0.56,
          nz: 0.74,
          driftNx: -0.04,
          driftNz: 0.03,
          stackY: 0,
          restRotX: 0.07,
          restRotY: -0.44,
          restRotZ: -0.07,
          detachDelay: 0.05,
          v0Down: 1.14,
          gravity: 11.1,
          bounce: 0.18,
          spinX: -2.2,
          spinY: 1.4,
          spinZ: 1.9,
          maxSag: 0.058,
        },
        {
          geoIdx: 0,
          mat: 'spall',
          sx: 0.66,
          sy: 0.15,
          sz: 0.58,
          nx: -0.04,
          nz: 0.7,
          driftNx: -0.02,
          driftNz: 0.04,
          stackY: 0,
          restRotX: -0.09,
          restRotY: 1.32,
          restRotZ: 0.08,
          detachDelay: 0.07,
          v0Down: 1.08,
          gravity: 11.0,
          bounce: 0.19,
          spinX: 2.5,
          spinY: -1.6,
          spinZ: -2.1,
          maxSag: 0.054,
        },
        {
          geoIdx: 1,
          mat: 'soffit',
          sx: 0.7,
          sy: 0.16,
          sz: 0.62,
          nx: 0.6,
          nz: 0.76,
          driftNx: 0.04,
          driftNz: 0.02,
          stackY: 0,
          restRotX: 0.08,
          restRotY: 2.18,
          restRotZ: -0.08,
          detachDelay: 0.08,
          v0Down: 1.06,
          gravity: 11.0,
          bounce: 0.19,
          spinX: -2.4,
          spinY: 1.7,
          spinZ: 2.0,
          maxSag: 0.052,
        },
        {
          geoIdx: 2,
          mat: 'spall',
          sx: 0.36,
          sy: 0.15,
          sz: 0.34,
          nx: 0.32,
          nz: 0.5,
          driftNx: 0.04,
          driftNz: -0.03,
          stackY: 0,
          restRotX: -0.08,
          restRotY: 0.45,
          restRotZ: 0.09,
          detachDelay: 0.14,
          v0Down: 0.88,
          gravity: 10.6,
          bounce: 0.22,
          spinX: -3.1,
          spinY: 1.9,
          spinZ: 2.2,
          maxSag: 0.04,
        },
      ]

      const ceilingDebrisMeshes = []
      const ceilingDebrisConfigs = []

      for (let i = 0; i < rawSlabs.length; i += 1) {
        const s = rawSlabs[i]
        const sx = s.sx * slabSizeScale
        const sy = s.sy * (0.7 + 0.3 * slabSizeScale)
        const sz = s.sz * slabSizeScale
        const mesh = new THREE.Mesh(
          slabGeos[s.geoIdx],
          s.mat === 'spall' ? spallMat : soffitMat
        )
        const dormantSy = Math.min(sy, 0.012)
        mesh.scale.set(sx, dormantSy, sz)
        mesh.castShadow = false
        mesh.receiveShadow = true

        const halfX = sx * 0.5
        const halfY = sy * 0.5
        const halfZ = sz * 0.5
        const maxFootprintR = Math.hypot(halfX, halfZ)

        // Exact rotated resting height so NO vertex can ever dip below floor y = 0
        const minGroundedY = computeMinGroundedCenterY(
          halfX,
          halfY,
          halfZ,
          s.restRotX,
          s.restRotY,
          s.restRotZ
        )
        const restY = Math.max(halfY + 0.004, minGroundedY) + s.stackY

        // Tuck dormant fractured slabs strictly behind soffit panel with zero protrusion
        const startY = soffitY - 0.006
        const sagY = startY - s.maxSag
        const dropDist = Math.max(0.05, sagY - restY)
        const tImpact =
          (-s.v0Down + Math.sqrt(s.v0Down * s.v0Down + 2 * s.gravity * dropDist)) / s.gravity
        const vImpact = s.v0Down + s.gravity * tImpact
        const vBounce = vImpact * s.bounce
        const tBounce = Math.min(0.28, (2 * vBounce) / s.gravity)

        // Map normalized two-tile corridor coordinates into wall-safe local bounds
        const rawStartX = s.nx * rubbleHalfW
        const rawStartZ = rubbleCenterLocalZ + s.nz * rubbleHalfD
        const rawRestX = (s.nx + s.driftNx) * rubbleHalfW
        const rawRestZ = rubbleCenterLocalZ + (s.nz + s.driftNz) * rubbleHalfD
        const startX = clampLocalX(rawStartX, maxFootprintR)
        const startZ = clampLocalZ(rawStartZ, maxFootprintR)
        const restX = clampLocalX(rawRestX, maxFootprintR)
        const restZ = clampLocalZ(rawRestZ, maxFootprintR)
        const impactX = startX + (restX - startX) * 0.74
        const impactZ = startZ + (restZ - startZ) * 0.74

        // Shoved-aside cleared rubble tucked neatly against both flanking corridor walls
        // so clearing opens an unobstructed central walking path
        const sideSign = restX < -0.02 ? -1 : restX > 0.02 ? 1 : i % 2 === 0 ? -1 : 1
        const clearedHalfR = maxFootprintR * 0.82
        const clearedTargetX = sideSign * Math.max(0, rubbleHalfW - clearedHalfR - 0.04)
        const clearedTargetZ = rubbleCenterLocalZ + (restZ - rubbleCenterLocalZ) * 0.9
        const clearedX = clampLocalX(clearedTargetX, clearedHalfR)
        const clearedZ = clampLocalZ(clearedTargetZ, clearedHalfR)
        const clearedY = computeMinGroundedCenterY(
          halfX * 0.82,
          halfY * 0.56,
          halfZ * 0.82,
          0.04,
          s.restRotY + 0.6,
          -0.04
        )

        const isLargeRubble = s.geoIdx !== 2
        const isSmallFragment = !isLargeRubble
        const baseMat = s.mat === 'spall' ? spallMat : soffitMat
        const highlightMat = s.mat === 'spall' ? spallHighlightMat : soffitHighlightMat

        mesh.name = isLargeRubble
          ? `hazard-ceiling-rubble-slab-${i}`
          : `hazard-ceiling-rubble-chip-${i}`
        mesh.position.set(startX, startY, startZ)
        mesh.rotation.set(0, s.restRotY * 0.25, 0)
        mesh.userData = {
          ...(mesh.userData || {}),
          isCeilingRubblePiece: true,
          pieceIndex: i,
          isLargeRubble,
          isSmallFragment,
          sx,
          sy,
          sz,
          halfX,
          halfY,
          halfZ,
          baseMaterial: baseMat,
          highlightMaterial: highlightMat,
          manualState: 'fallen',
          hazardId: null,
          pieceId: null,
        }
        ceilingRubbleGroup.add(mesh)
        ceilingDebrisMeshes.push(mesh)
        ceilingDebrisConfigs.push({
          pieceIndex: i,
          isLargeRubble,
          isSmallFragment,
          sx,
          sy,
          sz,
          dormantSy,
          castShadowEnabled: i < 8,
          halfX,
          halfY,
          halfZ,
          startX,
          startY,
          startZ,
          sagY,
          impactX,
          impactZ,
          restX,
          restY,
          restZ,
          clearedX,
          clearedY,
          clearedZ,
          startRotY: s.restRotY * 0.25,
          restRotX: s.restRotX,
          restRotY: s.restRotY,
          restRotZ: s.restRotZ,
          detachDelay: s.detachDelay,
          v0Down: s.v0Down,
          gravity: s.gravity,
          vBounce,
          tImpact,
          tBounce,
          spinX: s.spinX,
          spinY: s.spinY,
          spinZ: s.spinZ,
          maxSag: s.maxSag,
        })
      }

      // 4. Ten bounded warning grit / plaster chips distributed across both corridor lanes
      //    and full collapse length (hidden while dormant; trickle under gravity during warning)
      const warningPebbleGeo = getPooledGeometry(
        'ceiling_collapse:warn_pebble',
        () => new THREE.DodecahedronGeometry(0.028, 0)
      )
      const ceilingWarnPebbleGroup = new THREE.Group()
      ceilingWarnPebbleGroup.name = 'hazard-ceiling-warning-pebbles'
      ceilingWarnPebbleGroup.visible = false
      ceilingPatchGroup.add(ceilingWarnPebbleGroup)

      const pebbleLayout = [
        { nx: -0.68, nz: -0.78 },
        { nx: 0.64, nz: -0.72 },
        { nx: -0.18, nz: -0.44 },
        { nx: 0.54, nz: -0.22 },
        { nx: -0.66, nz: -0.06 },
        { nx: 0.16, nz: 0.08 },
        { nx: -0.58, nz: 0.32 },
        { nx: 0.66, nz: 0.36 },
        { nx: -0.24, nz: 0.72 },
        { nx: 0.52, nz: 0.78 },
      ]
      const ceilingWarnPebbles = []
      const ceilingWarnPebbleConfigs = []
      for (let i = 0; i < pebbleLayout.length; i += 1) {
        const pl = pebbleLayout[i]
        const pebble = new THREE.Mesh(warningPebbleGeo, i % 2 === 0 ? spallMat : soffitMat)
        const scale = 0.7 + (i % 3) * 0.28
        pebble.scale.set(scale, scale * 0.72, scale * 0.9)
        const px = clampLocalX(pl.nx * rubbleHalfW, 0.16)
        const pz = clampLocalZ(rubbleCenterLocalZ + pl.nz * rubbleHalfD, 0.16)
        const driftAngle = (i / pebbleLayout.length) * Math.PI * 2 + 0.35
        const targetPx = clampLocalX(px + Math.cos(driftAngle) * 0.12, 0.05)
        const targetPz = clampLocalZ(pz + Math.sin(driftAngle) * 0.12, 0.05)
        pebble.position.set(px, soffitY - 0.05, pz)
        ceilingWarnPebbleGroup.add(pebble)
        ceilingWarnPebbles.push(pebble)
        ceilingWarnPebbleConfigs.push({
          x: px,
          z: pz,
          driftX: targetPx - px,
          driftZ: targetPz - pz,
          startY: soffitY - 0.05,
          minY: 0.022 * scale,
          phaseOffset: i / pebbleLayout.length,
          spin: (i % 2 === 0 ? 1 : -1) * (4.5 + i * 0.65),
        })
      }

      // 5. Ten bounded dust puffs spanning both lanes & extended collapse zone
      //    (subtle ceiling trickle in warning, low impact plume in active)
      const ceilingDustGeo = getPooledGeometry(
        'ceiling_collapse:dust_puff',
        () => new THREE.DodecahedronGeometry(0.24, 1)
      )
      const ceilingDustGroup = new THREE.Group()
      ceilingDustGroup.name = 'hazard-ceiling-dust'
      ceilingDustGroup.visible = false
      ceilingPatchGroup.add(ceilingDustGroup)

      const dustLayout = [
        { nx: -0.58, nz: -0.74 },
        { nx: 0.56, nz: -0.7 },
        { nx: -0.14, nz: -0.4 },
        { nx: 0.58, nz: -0.18 },
        { nx: -0.6, nz: -0.02 },
        { nx: 0.12, nz: 0.06 },
        { nx: -0.56, nz: 0.34 },
        { nx: 0.54, nz: 0.38 },
        { nx: -0.46, nz: 0.74 },
        { nx: 0.48, nz: 0.76 },
      ]
      const ceilingDustMeshes = []
      const ceilingDustConfigs = []
      for (let i = 0; i < dustLayout.length; i += 1) {
        const dl = dustLayout[i]
        const puff = new THREE.Mesh(ceilingDustGeo, ceilingDustMat)
        const angle = (i / dustLayout.length) * Math.PI * 2 + 0.22
        const dx = clampLocalX(dl.nx * rubbleHalfW, 0.26)
        const dz = clampLocalZ(rubbleCenterLocalZ + dl.nz * rubbleHalfD, 0.26)
        const spreadX = clampLocalX(dx + Math.cos(angle) * (0.32 + (i % 3) * 0.08), 0.32)
        const spreadZ = clampLocalZ(dz + Math.sin(angle) * (0.32 + (i % 3) * 0.08), 0.32)
        puff.position.set(dx, soffitY - 0.16, dz)
        ceilingDustGroup.add(puff)
        ceilingDustMeshes.push(puff)
        ceilingDustConfigs.push({
          warnX: dx,
          warnZ: dz,
          spreadX,
          spreadZ,
          phase: i * 0.11,
          baseScale: 0.65 + (i % 3) * 0.2,
          impactHeight: 0.24 + (i % 3) * 0.15,
        })
      }

      root.userData = {
        hazardType: type,
        soffitY,
        activeDuration,
        patchOffsetX,
        patchOffsetZ,
        collapseYaw,
        rubbleHalfW,
        rubbleHalfD,
        rubbleMinLocalZ,
        rubbleMaxLocalZ,
        rubbleCenterLocalZ,
        ceilingPatchGroup,
        ceilingOverheadGroup,
        ceilingSoffitRimMesh,
        ceilingCrackGroup,
        ceilingCrackMeshes,
        ceilingCrackConfigs,
        ceilingCavityGroup,
        rubbleGroup: ceilingRubbleGroup,
        ceilingDebrisMeshes,
        ceilingDebrisConfigs,
        ceilingWarnPebbleGroup,
        ceilingWarnPebbles,
        ceilingWarnPebbleConfigs,
        ceilingDustGroup,
        ceilingDustMeshes,
        ceilingDustConfigs,
        ceilingDustMat,
        isPermanentlyCollapsed: false,
        isAftermathCleared: false,
      }
      break
    }

    case HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE: {
      const wallYaw = Number.isFinite(hazardData.wallYaw) ? hazardData.wallYaw : 0
      const minLocalX = Number.isFinite(hazardData.minLocalX) ? hazardData.minLocalX : -2.6
      const maxLocalX = Number.isFinite(hazardData.maxLocalX) ? hazardData.maxLocalX : 2.6
      const spanWidth = Math.max(2.4, maxLocalX - minLocalX)
      const spanHalfW = spanWidth * 0.5
      const lateralOffset = Number.isFinite(hazardData.lateralOffset)
        ? hazardData.lateralOffset
        : (minLocalX + maxLocalX) * 0.5
      const rackHeight = 2.94
      const rackDepth = 0.46
      const pivotX = lateralOffset
      const pivotZ = -1.5
      const fallenPivotZ = -1.26
      const clearedPivotZ = -1.52
      const dormantPitch = 0
      const dormantRoll = 0
      const warnEndPitch = 0.085
      const warnEndRoll = -0.014
      const collapsedPitch = Math.PI * 0.5
      const collapsedRoll = 0
      const fallenYaw = 0.014
      const clearedPitch = 0.016
      const clearedYaw = -0.006
      const clearedRoll = -0.005

      const qualityPreset = hazardData?.qualityPreset || 'high'
      const propMats = getEnvironmentalPropMaterials({ qualityPreset })
      const woodMat = propMats.weatheredWood
      const rustyMat = propMats.rustyMetal
      const steelMat = propMats.darkSteel
      const yellowMat = propMats.warningYellow
      const paperMat = propMats.paperWhite

      const furnitureDustMat = new THREE.MeshBasicMaterial({
        color: 0x7b746a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      const wallAnchorGroup = new THREE.Group()
      wallAnchorGroup.name = 'hazard-rotten-furniture-wall-anchor'
      wallAnchorGroup.rotation.y = wallYaw

      // 4 upright column positions forming 3 proportional industrial warehouse rack bays
      const postInset = 0.045
      const baySpan = (spanWidth - postInset * 2) / 3
      const columnXs = [
        -spanHalfW + postInset,
        -spanHalfW + postInset + baySpan,
        -spanHalfW + postInset + baySpan * 2,
        spanHalfW - postInset,
      ]
      const bayCenterXs = [
        (columnXs[0] + columnXs[1]) * 0.5,
        (columnXs[1] + columnXs[2]) * 0.5,
        (columnXs[2] + columnXs[3]) * 0.5,
      ]

      // 1. Flush floor leveling shims seated cleanly beneath rear rack footplates (no dormant tells)
      const wallRemnantGroup = new THREE.Group()
      wallRemnantGroup.name = 'hazard-rotten-furniture-wall-remnants'

      const basePadGeo = getPooledGeometry(
        'rotten_furniture:tall_base_pad',
        () => new THREE.BoxGeometry(0.085, 0.012, 0.085)
      )
      for (let c = 0; c < columnXs.length; c += 1) {
        const pad = new THREE.Mesh(basePadGeo, rustyMat)
        pad.position.set(pivotX + columnXs[c], 0.006, pivotZ - (rackDepth - 0.045))
        wallRemnantGroup.add(pad)
      }
      wallAnchorGroup.add(wallRemnantGroup)

      // 2. Heavy 3-bay industrial warehouse storage shelving assembly
      // Child local coordinates satisfy:
      //   lx in [-spanHalfW, +spanHalfW], ly in [0, 2.94], lz_rel in [-0.46, 0]
      // Upright footprint spans localZ in [-1.96, -1.50] (flush with wall, leaving 3.50m clear corridor).
      // Fallen footprint tips forward to span localZ in [-1.26, +1.68] across BOTH corridor lanes.
      const furnitureGroup = new THREE.Group()
      furnitureGroup.name = 'hazard-rotten-furniture'
      furnitureGroup.position.set(pivotX, 0, pivotZ)
      furnitureGroup.rotation.set(dormantPitch, 0, dormantRoll)

      const uprightPostGeo = getPooledGeometry(
        'rotten_furniture:tall_upright_post',
        () => new THREE.BoxGeometry(0.056, rackHeight, 0.056)
      )
      const footplateGeo = getPooledGeometry(
        'rotten_furniture:tall_footplate',
        () => new THREE.BoxGeometry(0.086, 0.014, 0.086)
      )
      const frontPostZ = -0.044
      const rearPostZ = -(rackDepth - 0.044)
      for (let c = 0; c < columnXs.length; c += 1) {
        const px = columnXs[c]
        for (const pzRel of [rearPostZ, frontPostZ]) {
          const post = new THREE.Mesh(uprightPostGeo, rustyMat)
          post.position.set(px, rackHeight * 0.5, pzRel)
          furnitureGroup.add(post)

          const foot = new THREE.Mesh(footplateGeo, rustyMat)
          foot.position.set(px, 0.007, pzRel)
          furnitureGroup.add(foot)
        }
      }

      // 5 heavy steel shelf decks + front reinforcement lip beams across full 3-bay width
      const shelfDeckUnitGeo = getPooledGeometry(
        'rotten_furniture:tall_shelf_deck_unit',
        () => new THREE.BoxGeometry(1, 0.038, rackDepth - 0.02)
      )
      const shelfLipUnitGeo = getPooledGeometry(
        'rotten_furniture:tall_shelf_lip_unit',
        () => new THREE.BoxGeometry(1, 0.052, 0.024)
      )
      const shelfHeights = [0.14, 0.78, 1.44, 2.1, 2.74]
      for (let s = 0; s < shelfHeights.length; s += 1) {
        const tier = new THREE.Mesh(shelfDeckUnitGeo, steelMat)
        tier.scale.set(spanWidth - 0.02, 1, 1)
        tier.position.set(0, shelfHeights[s], -rackDepth * 0.5)
        furnitureGroup.add(tier)

        const lip = new THREE.Mesh(shelfLipUnitGeo, rustyMat)
        lip.scale.set(spanWidth - 0.02, 1, 1)
        lip.position.set(0, shelfHeights[s] - 0.01, -0.016)
        furnitureGroup.add(lip)
      }

      // Top header beam connecting all 4 post pairs at y = 2.91 (< 2.94)
      const topHeaderGeo = getPooledGeometry(
        'rotten_furniture:tall_top_header_unit',
        () => new THREE.BoxGeometry(1, 0.048, 0.04)
      )
      const topFrontHeader = new THREE.Mesh(topHeaderGeo, rustyMat)
      topFrontHeader.scale.set(spanWidth - 0.02, 1, 1)
      topFrontHeader.position.set(0, rackHeight - 0.032, frontPostZ)
      furnitureGroup.add(topFrontHeader)

      const topRearHeader = new THREE.Mesh(topHeaderGeo, rustyMat)
      topRearHeader.scale.set(spanWidth - 0.02, 1, 1)
      topRearHeader.position.set(0, rackHeight - 0.032, rearPostZ)
      furnitureGroup.add(topRearHeader)

      // End-frame and internal depth crossbars tying front & rear upright columns together
      const sideStrutGeo = getPooledGeometry(
        'rotten_furniture:tall_side_strut',
        () => new THREE.BoxGeometry(0.022, 0.036, rackDepth - 0.07)
      )
      for (let c = 0; c < columnXs.length; c += 1) {
        for (const sy of [0.46, 1.12, 1.78, 2.42]) {
          const strut = new THREE.Mesh(sideStrutGeo, rustyMat)
          strut.position.set(columnXs[c], sy, -rackDepth * 0.5)
          furnitureGroup.add(strut)
        }
      }

      // Rear X-bracing struts across all 3 bays (two vertical bands)
      const rearBraceUnitGeo = getPooledGeometry(
        'rotten_furniture:tall_rear_brace_unit',
        () => new THREE.BoxGeometry(0.02, 1, 0.014)
      )
      const braceBandHeight = 1.24
      const braceDiagLen = Math.hypot(baySpan * 0.88, braceBandHeight)
      const braceTilt = Math.atan2(baySpan * 0.88, braceBandHeight)
      for (let b = 0; b < bayCenterXs.length; b += 1) {
        for (const bandCenterY of [0.8, 2.08]) {
          for (const sign of [-1, 1]) {
            const brace = new THREE.Mesh(rearBraceUnitGeo, rustyMat)
            brace.scale.set(1, braceDiagLen, 1)
            brace.position.set(bayCenterXs[b], bandCenterY, rearPostZ - 0.018)
            brace.rotation.z = sign * braceTilt
            furnitureGroup.add(brace)
          }
        }
      }

      wallAnchorGroup.add(furnitureGroup)

      // 3. Unstretched grounded industrial cargo distributed across all 3 bays
      const looseCargoGroup = new THREE.Group()
      looseCargoGroup.name = 'hazard-rotten-furniture-cargo'

      const crateCargoGeo = getPooledGeometry('rotten_furniture:shelf_cargo_crate', () =>
        mergeGrateBoxSpecs([
          { x: 0, y: 0, z: 0, sx: 0.36, sy: 0.28, sz: 0.34 },
          { x: 0, y: 0.12, z: 0, sx: 0.38, sy: 0.04, sz: 0.36 },
        ])
      )
      const heavyCrateGeo = getPooledGeometry('rotten_furniture:shelf_cargo_heavy_crate', () =>
        mergeGrateBoxSpecs([
          { x: 0, y: 0, z: 0, sx: 0.48, sy: 0.32, sz: 0.36 },
          { x: 0, y: 0.14, z: 0, sx: 0.5, sy: 0.04, sz: 0.38 },
        ])
      )
      const toolboxCargoGeo = getPooledGeometry(
        'rotten_furniture:shelf_cargo_toolbox',
        () => new THREE.BoxGeometry(0.32, 0.18, 0.24)
      )
      const canisterCargoGeo = getPooledGeometry(
        'rotten_furniture:shelf_cargo_canister',
        () => new THREE.CylinderGeometry(0.1, 0.1, 0.32, 10)
      )
      const paperCargoGeo = getPooledGeometry(
        'rotten_furniture:shelf_cargo_papers',
        () => new THREE.BoxGeometry(0.26, 0.04, 0.22)
      )

      const clampLocalX = (val, half) =>
        Math.max(minLocalX + half + 0.08, Math.min(maxLocalX - half - 0.08, val))
      const clampFallenZ = (val, half) =>
        Math.max(-1.82 + half, Math.min(1.82 - half, val))

      const looseCargoTemplates = [
        {
          // Left bay heavy wooden supply crate on tier 2 (top = 0.799 -> y = 0.959)
          geo: heavyCrateGeo,
          mat: woodMat,
          halfX: 0.25,
          halfY: 0.16,
          halfZ: 0.19,
          shelfX: bayCenterXs[0] - 0.12,
          shelfY: 0.959,
          shelfZRel: -0.23,
          dormantRotY: 0.06,
          slideStart: 0.14,
          slideEnd: 0.84,
          arcHeight: 0.16,
          restX: clampLocalX(pivotX + bayCenterXs[0] - 0.16, 0.25),
          restZ: clampFallenZ(-0.22, 0.19),
          clearedX: clampLocalX(pivotX + bayCenterXs[0] - 0.12, 0.25),
          clearedZ: -1.73,
          clearedY: 0.16,
          restRotX: 1.54,
          restRotY: -0.24,
          restRotZ: 0.08,
        },
        {
          // Left bay industrial yellow toolbox on tier 4 (top = 2.119 -> y = 2.209)
          geo: toolboxCargoGeo,
          mat: yellowMat,
          halfX: 0.16,
          halfY: 0.09,
          halfZ: 0.12,
          shelfX: bayCenterXs[0] + 0.22,
          shelfY: 2.209,
          shelfZRel: -0.22,
          dormantRotY: -0.14,
          slideStart: 0.08,
          slideEnd: 0.78,
          arcHeight: 0.22,
          restX: clampLocalX(pivotX + bayCenterXs[0] + 0.2, 0.16),
          restZ: clampFallenZ(1.08, 0.12),
          clearedX: clampLocalX(pivotX + bayCenterXs[0] + 0.24, 0.16),
          clearedZ: -1.71,
          clearedY: 0.09,
          restRotX: 1.48,
          restRotY: 0.34,
          restRotZ: -0.12,
        },
        {
          // Center bay slatted crate on tier 3 (top = 1.459 -> y = 1.599)
          geo: crateCargoGeo,
          mat: woodMat,
          halfX: 0.19,
          halfY: 0.14,
          halfZ: 0.18,
          shelfX: bayCenterXs[1] - 0.24,
          shelfY: 1.599,
          shelfZRel: -0.23,
          dormantRotY: 0.11,
          slideStart: 0.12,
          slideEnd: 0.82,
          arcHeight: 0.18,
          restX: clampLocalX(pivotX + bayCenterXs[1] - 0.22, 0.19),
          restZ: clampFallenZ(0.46, 0.18),
          clearedX: clampLocalX(pivotX + bayCenterXs[1] - 0.22, 0.19),
          clearedZ: -1.73,
          clearedY: 0.14,
          restRotX: 1.56,
          restRotY: -0.18,
          restRotZ: 0.06,
        },
        {
          // Center bay heavy canister on tier 1 (top = 0.159 -> y = 0.319)
          geo: canisterCargoGeo,
          mat: yellowMat,
          halfX: 0.1,
          halfY: 0.16,
          halfZ: 0.1,
          shelfX: bayCenterXs[1] + 0.28,
          shelfY: 0.319,
          shelfZRel: -0.24,
          dormantRotY: 0,
          slideStart: 0.18,
          slideEnd: 0.88,
          arcHeight: 0.08,
          restX: clampLocalX(pivotX + bayCenterXs[1] + 0.26, 0.1),
          restZ: clampFallenZ(-0.84, 0.1),
          clearedX: clampLocalX(pivotX + bayCenterXs[1] + 0.26, 0.1),
          clearedZ: -1.72,
          clearedY: 0.16,
          restRotX: 1.55,
          restRotY: 0.2,
          restRotZ: -0.05,
        },
        {
          // Center bay top-tier crate on tier 5 (top = 2.759 -> y = 2.899? wait: top <= 2.94 -> toolbox at y=2.849!)
          geo: toolboxCargoGeo,
          mat: yellowMat,
          halfX: 0.16,
          halfY: 0.09,
          halfZ: 0.12,
          shelfX: bayCenterXs[1] + 0.08,
          shelfY: 2.849,
          shelfZRel: -0.23,
          dormantRotY: 0.16,
          slideStart: 0.06,
          slideEnd: 0.76,
          arcHeight: 0.24,
          restX: clampLocalX(pivotX + bayCenterXs[1] + 0.1, 0.16),
          restZ: clampFallenZ(1.56, 0.12),
          clearedX: clampLocalX(pivotX + bayCenterXs[1] + 0.02, 0.16),
          clearedZ: -1.72,
          clearedY: 0.87,
          restRotX: 1.52,
          restRotY: -0.36,
          restRotZ: 0.1,
        },
        {
          // Right bay heavy wooden crate on tier 3 (top = 1.459 -> y = 1.619)
          geo: heavyCrateGeo,
          mat: woodMat,
          halfX: 0.25,
          halfY: 0.16,
          halfZ: 0.19,
          shelfX: bayCenterXs[2] + 0.1,
          shelfY: 1.619,
          shelfZRel: -0.23,
          dormantRotY: -0.08,
          slideStart: 0.12,
          slideEnd: 0.82,
          arcHeight: 0.18,
          restX: clampLocalX(pivotX + bayCenterXs[2] + 0.14, 0.25),
          restZ: clampFallenZ(0.58, 0.19),
          clearedX: clampLocalX(pivotX + bayCenterXs[2] + 0.12, 0.25),
          clearedZ: -1.73,
          clearedY: 0.16,
          restRotX: 1.55,
          restRotY: 0.22,
          restRotZ: -0.09,
        },
        {
          // Right bay industrial canister on tier 4 (top = 2.119 -> y = 2.279)
          geo: canisterCargoGeo,
          mat: yellowMat,
          halfX: 0.1,
          halfY: 0.16,
          halfZ: 0.1,
          shelfX: bayCenterXs[2] - 0.24,
          shelfY: 2.279,
          shelfZRel: -0.23,
          dormantRotY: 0.05,
          slideStart: 0.09,
          slideEnd: 0.79,
          arcHeight: 0.2,
          restX: clampLocalX(pivotX + bayCenterXs[2] - 0.2, 0.1),
          restZ: clampFallenZ(1.24, 0.1),
          clearedX: clampLocalX(pivotX + bayCenterXs[2] - 0.22, 0.1),
          clearedZ: -1.72,
          clearedY: 0.16,
          restRotX: 1.56,
          restRotY: -0.28,
          restRotZ: 0.07,
        },
        {
          // Right bay archive papers on tier 2 (top = 0.799 -> y = 0.819)
          geo: paperCargoGeo,
          mat: paperMat,
          halfX: 0.13,
          halfY: 0.02,
          halfZ: 0.11,
          shelfX: bayCenterXs[2] - 0.14,
          shelfY: 0.819,
          shelfZRel: -0.2,
          dormantRotY: 0.24,
          slideStart: 0.1,
          slideEnd: 0.78,
          arcHeight: 0.14,
          restX: clampLocalX(pivotX + bayCenterXs[2] - 0.16, 0.13),
          restZ: clampFallenZ(-0.34, 0.11),
          clearedX: clampLocalX(pivotX + bayCenterXs[2] - 0.14, 0.13),
          clearedZ: -1.68,
          clearedY: 0.82,
          restRotX: 1.56,
          restRotY: -0.44,
          restRotZ: 0.06,
        },
      ]

      const looseCargoMeshes = []
      const looseCargoConfigs = []
      const shelfEvalPt = { x: 0, y: 0, z: 0 }

      for (let i = 0; i < looseCargoTemplates.length; i += 1) {
        const tpl = looseCargoTemplates[i]
        const mesh = new THREE.Mesh(tpl.geo, tpl.mat)
        evalFurnitureShelfPoint(
          tpl.shelfX,
          tpl.shelfY,
          tpl.shelfZRel,
          dormantPitch,
          dormantRoll,
          pivotX,
          0,
          pivotZ,
          shelfEvalPt
        )
        const minDormantY = computeMinGroundedCenterY(
          tpl.halfX,
          tpl.halfY,
          tpl.halfZ,
          dormantPitch,
          tpl.dormantRotY,
          dormantRoll
        )
        const restY = computeMinGroundedCenterY(
          tpl.halfX,
          tpl.halfY,
          tpl.halfZ,
          tpl.restRotX,
          tpl.restRotY,
          tpl.restRotZ
        )
        mesh.position.set(
          shelfEvalPt.x,
          Math.max(minDormantY, shelfEvalPt.y),
          shelfEvalPt.z
        )
        mesh.rotation.set(dormantPitch, tpl.dormantRotY, dormantRoll)
        looseCargoGroup.add(mesh)
        looseCargoMeshes.push(mesh)
        looseCargoConfigs.push({
          ...tpl,
          restY,
        })
      }
      wallAnchorGroup.add(looseCargoGroup)

      // 4. Warning rust/metal flakes & timber splinters distributed across all 3 bays (shown only during WARNING)
      const furnitureWarnSplinterGroup = new THREE.Group()
      furnitureWarnSplinterGroup.name = 'hazard-rotten-furniture-warn-splinters'
      furnitureWarnSplinterGroup.visible = false
      const splinterGeo = getPooledGeometry(
        'rotten_furniture:warn_splinter',
        () => new THREE.BoxGeometry(0.056, 0.018, 0.026)
      )
      const furnitureWarnSplinters = []
      const furnitureWarnSplinterConfigs = [
        { x: pivotX + columnXs[0] + 0.14, startY: 2.65, z: pivotZ - 0.04, speed: 1.55, phase: 0.0, rotSpeed: 4.5, mat: rustyMat },
        { x: pivotX + bayCenterXs[0], startY: 1.98, z: pivotZ - 0.36, speed: 1.35, phase: 0.12, rotSpeed: -5.1, mat: woodMat },
        { x: pivotX + columnXs[1], startY: 2.48, z: pivotZ - 0.06, speed: 1.48, phase: 0.24, rotSpeed: 4.2, mat: rustyMat },
        { x: pivotX + bayCenterXs[1] - 0.18, startY: 1.44, z: pivotZ - 0.1, speed: 1.62, phase: 0.36, rotSpeed: -4.8, mat: woodMat },
        { x: pivotX + bayCenterXs[1] + 0.22, startY: 2.72, z: pivotZ - 0.34, speed: 1.4, phase: 0.48, rotSpeed: 3.9, mat: rustyMat },
        { x: pivotX + columnXs[2], startY: 1.85, z: pivotZ - 0.05, speed: 1.5, phase: 0.6, rotSpeed: -4.4, mat: rustyMat },
        { x: pivotX + bayCenterXs[2], startY: 2.32, z: pivotZ - 0.22, speed: 1.42, phase: 0.72, rotSpeed: 4.7, mat: woodMat },
        { x: pivotX + columnXs[3] - 0.14, startY: 1.24, z: pivotZ - 0.04, speed: 1.58, phase: 0.84, rotSpeed: -4.9, mat: rustyMat },
      ]
      for (let i = 0; i < furnitureWarnSplinterConfigs.length; i += 1) {
        const cfg = furnitureWarnSplinterConfigs[i]
        const sp = new THREE.Mesh(splinterGeo, cfg.mat)
        sp.position.set(cfg.x, cfg.startY, cfg.z)
        furnitureWarnSplinterGroup.add(sp)
        furnitureWarnSplinters.push(sp)
      }
      wallAnchorGroup.add(furnitureWarnSplinterGroup)

      // 5. Full-width impact dust plumes (8 bounded puffs across the fallen shelving span)
      const furnitureDustGroup = new THREE.Group()
      furnitureDustGroup.name = 'hazard-rotten-furniture-dust'
      furnitureDustGroup.visible = false
      const dustGeo = getPooledGeometry(
        'rotten_furniture:dust_puff',
        () => new THREE.DodecahedronGeometry(0.28, 0)
      )
      const furnitureDustMeshes = []
      const furnitureDustConfigs = []
      for (let i = 0; i < 8; i += 1) {
        const frac = i / 7 - 0.5
        const puff = new THREE.Mesh(dustGeo, furnitureDustMat)
        const baseX = pivotX + frac * (spanWidth * 0.82)
        const baseZ = -0.25 + ((i % 3) - 1) * 0.62
        puff.position.set(baseX, 0.18, baseZ)
        furnitureDustGroup.add(puff)
        furnitureDustMeshes.push(puff)
        furnitureDustConfigs.push({
          baseX,
          baseZ,
          dx: Math.cos(i * 1.1) * 0.34,
          dz: 0.52 + (i % 3) * 0.38,
          baseScale: 0.56 + (i % 3) * 0.2,
          lift: 0.26 + (i % 2) * 0.18,
        })
      }
      wallAnchorGroup.add(furnitureDustGroup)

      const furnitureInteractiveMeshes = []
      furnitureGroup.traverse((child) => {
        if (child && child.isMesh) {
          child.userData = {
            ...child.userData,
            isRottenFurniturePiece: true,
            baseMaterial: child.material,
          }
          furnitureInteractiveMeshes.push(child)
        }
      })
      for (let i = 0; i < looseCargoMeshes.length; i += 1) {
        const cargoMesh = looseCargoMeshes[i]
        if (cargoMesh && cargoMesh.isMesh) {
          cargoMesh.userData = {
            ...cargoMesh.userData,
            isRottenFurniturePiece: true,
            baseMaterial: cargoMesh.material,
          }
          furnitureInteractiveMeshes.push(cargoMesh)
        }
      }

      root.add(wallAnchorGroup)
      root.userData = {
        hazardType: type,
        wallAnchorGroup,
        wallRemnantGroup,
        strainedStrapMesh: null,
        furnitureGroup,
        furnitureInteractiveMeshes,
        buckledLegMesh: null,
        ajarDoorMesh: null,
        looseCargoGroup,
        looseCargoMeshes,
        looseCargoConfigs,
        furnitureWarnSplinterGroup,
        furnitureWarnSplinters,
        furnitureWarnSplinterConfigs,
        furnitureDustGroup,
        furnitureDustMeshes,
        furnitureDustConfigs,
        furnitureDustMat,
        wallYaw,
        lateralOffset,
        minLocalX,
        maxLocalX,
        spanHalfW,
        rackHeight,
        rackDepth,
        pivotX,
        pivotZ,
        fallenPivotZ,
        clearedPivotZ,
        dormantPitch,
        dormantRoll,
        warnEndPitch,
        warnEndRoll,
        collapsedPitch,
        collapsedRoll,
        fallenYaw,
        clearedPitch,
        clearedYaw,
        clearedRoll,
        uprightRotX: dormantPitch,
        uprightRotZ: dormantRoll,
        collapsedRotX: collapsedPitch,
        collapsedRotZ: collapsedRoll,
        furnitureDispLocalX: 0,
        furnitureDispLocalZ: 0,
        isPermanentlyCollapsed: false,
        isAftermathCleared: false,
      }
      break
    }

    case HAZARD_TYPES.FALLING_PIPES_FIXTURES: {
      const mountType = hazardData.mountType === 'ceiling' ? 'ceiling' : 'wall'
      const pipeYaw = Number.isFinite(hazardData.pipeYaw) ? hazardData.pipeYaw : 0
      const pipeRestY = Number.isFinite(hazardData.pipeRestY)
        ? hazardData.pipeRestY
        : FALLING_PIPES_CONSTANTS.pipeRestY
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : FALLING_PIPES_CONSTANTS.ceilingAnchorY
      const overheadZ = FALLING_PIPES_CONSTANTS.overheadLocalZ
      const impactZ = FALLING_PIPES_CONSTANTS.impactLocalZ
      const clearedX = -1.7
      const clearedZ = 0

      // Reuse shared facility prop materials & pooled geometries so overhead pipes blend seamlessly
      const {
        pipeMetalMat,
        darkSteelMat,
        valveWheelMat,
        gasketBlackMat,
        deckFlangeGeo,
        upperRiserGeo,
        riserCollarGeo,
        hangerPlateGeo,
        upperRodGeo,
        wallPlateGeo,
        wallArmGeo,
        wallGussetGeo,
        strainRodGeo,
        mainBarrelGeo,
        elbowHubGeo,
        riserNeckGeo,
        slipFlangeGeo,
        unionFlangeGeo,
        unionGasketGeo,
        teeBodyGeo,
        valveBonnetGeo,
        valveWheelGeo,
        returnLineGeo,
        clampStrapGeo,
        clevisRingGeo,
        clevisEarGeo,
      } = getFallingPipesSharedAssets(hazardData.qualityPreset || 'high')

      // Instance-owned translucent dust material (disposed cleanly per hazard instance)
      const pipeDustMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.ceilingDust,
        roughness: 0.98,
        metalness: 0.0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      const pipeMountGroup = new THREE.Group()
      pipeMountGroup.name = 'hazard-falling-pipes-mount'
      pipeMountGroup.rotation.y = pipeYaw
      root.add(pipeMountGroup)

      // 1. Fixed overhead structural remnants (ceiling deck flanges, upper riser stubs, left/right wall collars)
      const ceilingRemnantGroup = new THREE.Group()
      ceilingRemnantGroup.name = 'hazard-falling-pipes-remnants'
      pipeMountGroup.add(ceilingRemnantGroup)

      for (const rx of [-1.8, 1.8]) {
        const deckFlange = new THREE.Mesh(deckFlangeGeo, darkSteelMat)
        deckFlange.position.set(rx, ceilingAnchorY - 0.018, overheadZ)
        deckFlange.castShadow = true
        deckFlange.receiveShadow = true
        ceilingRemnantGroup.add(deckFlange)

        const upperRiser = new THREE.Mesh(upperRiserGeo, pipeMetalMat)
        upperRiser.position.set(rx, ceilingAnchorY - 0.17, overheadZ)
        upperRiser.castShadow = true
        upperRiser.receiveShadow = true
        ceilingRemnantGroup.add(upperRiser)

        const riserCollar = new THREE.Mesh(riserCollarGeo, darkSteelMat)
        riserCollar.position.set(rx, ceilingAnchorY - 0.33, overheadZ)
        riserCollar.castShadow = true
        riserCollar.receiveShadow = true
        ceilingRemnantGroup.add(riserCollar)
      }

      for (const hx of [-1.05, 1.05]) {
        const cPlate = new THREE.Mesh(hangerPlateGeo, darkSteelMat)
        cPlate.position.set(hx, ceilingAnchorY - 0.012, overheadZ)
        ceilingRemnantGroup.add(cPlate)

        const uRod = new THREE.Mesh(upperRodGeo, darkSteelMat)
        uRod.position.set(hx, ceilingAnchorY - 0.13, overheadZ)
        ceilingRemnantGroup.add(uRod)
      }

      if (mountType === 'wall') {
        for (const wx of [-1, 1]) {
          const wPlate = new THREE.Mesh(wallPlateGeo, darkSteelMat)
          wPlate.position.set(wx * 1.965, pipeRestY, overheadZ)
          wPlate.receiveShadow = true
          ceilingRemnantGroup.add(wPlate)

          const wArm = new THREE.Mesh(wallArmGeo, darkSteelMat)
          wArm.position.set(wx * 1.89, pipeRestY, overheadZ)
          wArm.rotation.z = Math.PI * 0.5
          wArm.castShadow = true
          wArm.receiveShadow = true
          ceilingRemnantGroup.add(wArm)

          const wGusset = new THREE.Mesh(wallGussetGeo, pipeMetalMat)
          wGusset.position.set(wx * 1.87, pipeRestY - 0.15, overheadZ)
          wGusset.rotation.z = wx * 0.62
          ceilingRemnantGroup.add(wGusset)
        }
      }

      // Straining lower clevis hanger rods (right rod fails first, then left rod shears)
      const leftStrainRod = new THREE.Mesh(strainRodGeo, pipeMetalMat)
      leftStrainRod.position.set(-1.05, pipeRestY + 0.16, overheadZ)
      ceilingRemnantGroup.add(leftStrainRod)

      const rightStrainRod = new THREE.Mesh(strainRodGeo, pipeMetalMat)
      rightStrainRod.position.set(1.05, pipeRestY + 0.16, overheadZ)
      ceilingRemnantGroup.add(rightStrainRod)

      // 2. Detachable heavy transverse Schedule-40 pipe & valve fixture assembly
      const pipeGroup = new THREE.Group()
      pipeGroup.name = 'hazard-falling-pipes'
      pipeGroup.position.set(0, pipeRestY, overheadZ)
      pipeMountGroup.add(pipeGroup)

      const mainBarrel = new THREE.Mesh(mainBarrelGeo, pipeMetalMat)
      mainBarrel.rotation.z = Math.PI * 0.5
      mainBarrel.castShadow = true
      mainBarrel.receiveShadow = true
      pipeGroup.add(mainBarrel)

      // End 90-degree elbow hubs & vertical riser necks mating into overhead riser collars
      for (const ex of [-1.74, 1.74]) {
        const sign = Math.sign(ex)
        const elbowHub = new THREE.Mesh(elbowHubGeo, darkSteelMat)
        elbowHub.position.set(ex, 0, 0)
        elbowHub.rotation.z = Math.PI * 0.5
        elbowHub.castShadow = true
        pipeGroup.add(elbowHub)

        const riserNeck = new THREE.Mesh(riserNeckGeo, pipeMetalMat)
        riserNeck.position.set(sign * 1.8, 0.075, 0)
        riserNeck.castShadow = true
        pipeGroup.add(riserNeck)

        const slipFlange = new THREE.Mesh(slipFlangeGeo, darkSteelMat)
        slipFlange.position.set(sign * 1.8, 0.15, 0)
        slipFlange.castShadow = true
        pipeGroup.add(slipFlange)
      }

      // Center bolted union flange pair & dark rubber gasket seal
      for (const ux of [-0.026, 0.026]) {
        const uFlange = new THREE.Mesh(unionFlangeGeo, darkSteelMat)
        uFlange.position.set(ux, 0, 0)
        uFlange.rotation.z = Math.PI * 0.5
        uFlange.castShadow = true
        pipeGroup.add(uFlange)
      }
      const uGasket = new THREE.Mesh(unionGasketGeo, gasketBlackMat)
      uGasket.rotation.z = Math.PI * 0.5
      pipeGroup.add(uGasket)

      // Cast-iron T-fitting & industrial shutoff valve wheel fixture
      const teeBody = new THREE.Mesh(teeBodyGeo, darkSteelMat)
      teeBody.position.set(0.42, 0, 0)
      teeBody.rotation.z = Math.PI * 0.5
      teeBody.castShadow = true
      pipeGroup.add(teeBody)

      const valveBonnet = new THREE.Mesh(valveBonnetGeo, pipeMetalMat)
      valveBonnet.position.set(0.42, -0.01, 0.095)
      valveBonnet.rotation.x = Math.PI * 0.42
      valveBonnet.castShadow = true
      pipeGroup.add(valveBonnet)

      const valveWheel = new THREE.Mesh(valveWheelGeo, valveWheelMat)
      valveWheel.position.set(0.42, -0.02, 0.15)
      valveWheel.rotation.x = Math.PI * 0.42
      valveWheel.castShadow = true
      pipeGroup.add(valveWheel)

      // Parallel secondary condensate return line & twin pipe clamp straps
      const returnLine = new THREE.Mesh(returnLineGeo, darkSteelMat)
      returnLine.position.set(0, -0.108, -0.045)
      returnLine.rotation.z = Math.PI * 0.5
      returnLine.castShadow = true
      pipeGroup.add(returnLine)

      for (const cx of [-0.68, 0.68]) {
        const strap = new THREE.Mesh(clampStrapGeo, darkSteelMat)
        strap.position.set(cx, -0.015, -0.015)
        strap.castShadow = true
        pipeGroup.add(strap)
      }

      // Lower U-bolt clevis hanger rings attached to the pipe barrel
      for (const hx of [-1.05, 1.05]) {
        const ring = new THREE.Mesh(clevisRingGeo, darkSteelMat)
        ring.position.set(hx, 0, 0)
        ring.rotation.z = Math.PI * 0.5
        pipeGroup.add(ring)

        const ear = new THREE.Mesh(clevisEarGeo, pipeMetalMat)
        ear.position.set(hx, 0.115, 0)
        pipeGroup.add(ear)
      }

      // 3. Warning rust-flake & sheared-bolt particles (6 bounded meshes)
      const pipeWarnFlakeGroup = new THREE.Group()
      pipeWarnFlakeGroup.name = 'hazard-falling-pipes-flakes'
      pipeWarnFlakeGroup.visible = false
      pipeMountGroup.add(pipeWarnFlakeGroup)

      const flakeGeo = getPooledGeometry(
        'falling_pipes:rust_flake',
        () => new THREE.DodecahedronGeometry(0.022, 0)
      )
      const flakeSpecs = [
        { startX: 1.05, startY: pipeRestY + 0.18, startZ: overheadZ + 0.04, driftX: 0.06, driftZ: 0.14, delay: 0.0, mat: pipeMetalMat },
        { startX: 1.72, startY: pipeRestY + 0.15, startZ: overheadZ + 0.05, driftX: -0.05, driftZ: 0.16, delay: 0.08, mat: darkSteelMat },
        { startX: -1.05, startY: pipeRestY + 0.18, startZ: overheadZ + 0.04, driftX: 0.04, driftZ: -0.12, delay: 0.16, mat: pipeMetalMat },
        { startX: 0.68, startY: pipeRestY + 0.12, startZ: overheadZ - 0.06, driftX: -0.07, driftZ: -0.18, delay: 0.24, mat: darkSteelMat },
        { startX: -1.72, startY: pipeRestY + 0.15, startZ: overheadZ + 0.05, driftX: 0.05, driftZ: 0.15, delay: 0.32, mat: pipeMetalMat },
        { startX: 0.42, startY: pipeRestY + 0.08, startZ: overheadZ + 0.08, driftX: -0.04, driftZ: 0.14, delay: 0.4, mat: darkSteelMat },
      ]
      const pipeWarnFlakes = []
      const pipeWarnFlakeConfigs = []
      for (let i = 0; i < flakeSpecs.length; i += 1) {
        const fs = flakeSpecs[i]
        const flake = new THREE.Mesh(flakeGeo, fs.mat)
        flake.position.set(fs.startX, fs.startY, fs.startZ)
        pipeWarnFlakeGroup.add(flake)
        pipeWarnFlakes.push(flake)
        pipeWarnFlakeConfigs.push(fs)
      }

      // 4. Restrained localized dust puffs (5 bounded meshes)
      const pipeDustGroup = new THREE.Group()
      pipeDustGroup.name = 'hazard-falling-pipes-dust'
      pipeDustGroup.visible = false
      pipeMountGroup.add(pipeDustGroup)

      const dustPuffGeo = getPooledGeometry(
        'falling_pipes:dust_puff',
        () => new THREE.SphereGeometry(0.18, 7, 6)
      )
      const dustSpecs = [
        { warnX: 1.05, warnY: pipeRestY + 0.14, warnZ: overheadZ + 0.06, impX: -1.35, impZ: impactZ + 0.08, maxScale: 1.35 },
        { warnX: -1.05, warnY: pipeRestY + 0.14, warnZ: overheadZ + 0.06, impX: -0.65, impZ: impactZ - 0.06, maxScale: 1.45 },
        { warnX: 1.72, warnY: pipeRestY + 0.12, warnZ: overheadZ + 0.04, impX: 0.65, impZ: impactZ + 0.1, maxScale: 1.5 },
        { warnX: -1.72, warnY: pipeRestY + 0.12, warnZ: overheadZ + 0.04, impX: 1.35, impZ: impactZ - 0.04, maxScale: 1.3 },
        { warnX: 0.0, warnY: pipeRestY + 0.08, warnZ: overheadZ + 0.05, impX: 0.0, impZ: impactZ + 0.14, maxScale: 1.4 },
      ]
      const pipeDustMeshes = []
      const pipeDustConfigs = []
      for (let i = 0; i < dustSpecs.length; i += 1) {
        const ds = dustSpecs[i]
        const puff = new THREE.Mesh(dustPuffGeo, pipeDustMat)
        puff.position.set(ds.warnX, ds.warnY, ds.warnZ)
        pipeDustGroup.add(puff)
        pipeDustMeshes.push(puff)
        pipeDustConfigs.push(ds)
      }

      root.userData = {
        hazardType: type,
        mountType,
        pipeYaw,
        pipeRestY,
        ceilingAnchorY,
        overheadZ,
        impactZ,
        clearedX,
        clearedZ,
        pipeMountGroup,
        ceilingRemnantGroup,
        leftStrainRod,
        rightStrainRod,
        pipeGroup,
        pipeWarnFlakeGroup,
        pipeWarnFlakes,
        pipeWarnFlakeConfigs,
        pipeDustGroup,
        pipeDustMeshes,
        pipeDustConfigs,
        pipeDustMat,
        isPermanentlyCollapsed: false,
        isAftermathCleared: false,
      }
      break
    }

    case HAZARD_TYPES.STEAM_PIPE_BURST: {
      const mountType = hazardData.mountType === 'ceiling' ? 'ceiling' : 'wall'
      const steamYaw = Number.isFinite(hazardData.steamYaw) ? hazardData.steamYaw : 0
      const pipeMainY = Number.isFinite(hazardData.pipeMainY) ? hazardData.pipeMainY : 1.38
      const ceilingSoffitY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : 3.6
      const lineZ = mountType === 'wall' ? -1.8 : -1.24

      const {
        pipeMetalMat,
        darkSteelMat,
        brassMat,
        gasketMat,
        valveMat,
        riserGeo,
        deckFlangeGeo,
        elbowCollarGeo,
        headerRunGeo,
        wallPlateGeo,
        wallStrutGeo,
        clampRingGeo,
        ceilingStrapGeo,
        gaugeStemGeo,
        gaugeDialGeo,
        valveBodyGeo,
        valveStemGeo,
        valveWheelRimGeo,
        valveSpokeGeo,
        pipeGeo,
        unionPlateGeo,
        gasketRingGeo,
        boltPinGeo,
      } = getSteamPipeSharedAssets(hazardData.qualityPreset || 'high')

      // Instance-owned material so independent steam bursts never overwrite shared pooled opacity
      const steamMat = new THREE.MeshStandardMaterial({
        color: 0xd9e2ec,
        emissive: 0x9fb3c8,
        emissiveIntensity: 0.45,
        roughness: 0.92,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      })

      // Instance-owned condensation droplet material for stressed flange dripping
      const condensationMat = new THREE.MeshStandardMaterial({
        color: 0xa8c6d8,
        roughness: 0.18,
        metalness: 0.1,
        transparent: true,
        opacity: 0.0,
      })

      const steamMountGroup = new THREE.Group()
      steamMountGroup.name = `hazard-steam-${mountType}-mount`
      steamMountGroup.rotation.y = steamYaw
      root.add(steamMountGroup)

      // 1. Static structural pipework: supply & return risers, ceiling header tie-in,
      //    wall brackets/ceiling drop hangers, pressure gauge, and manual shutoff valve
      const steamSupportGroup = new THREE.Group()
      steamSupportGroup.name = 'hazard-steam-supports'
      steamMountGroup.add(steamSupportGroup)

      const riserXPositions = [-0.58, 0.78]
      for (let i = 0; i < riserXPositions.length; i += 1) {
        const rx = riserXPositions[i]
        const riser = new THREE.Mesh(riserGeo, pipeMetalMat)
        riser.position.set(rx, ceilingSoffitY * 0.5, lineZ)
        steamSupportGroup.add(riser)

        const floorFlange = new THREE.Mesh(deckFlangeGeo, darkSteelMat)
        floorFlange.position.set(rx, 0.018, lineZ)
        steamSupportGroup.add(floorFlange)

        const ceilingFlange = new THREE.Mesh(deckFlangeGeo, darkSteelMat)
        ceilingFlange.position.set(rx, ceilingSoffitY - 0.018, lineZ)
        steamSupportGroup.add(ceilingFlange)

        const teeJunction = new THREE.Mesh(elbowCollarGeo, darkSteelMat)
        teeJunction.position.set(rx, pipeMainY, lineZ)
        steamSupportGroup.add(teeJunction)

        const upperJunction = new THREE.Mesh(elbowCollarGeo, darkSteelMat)
        upperJunction.position.set(rx, ceilingSoffitY - 0.36, lineZ)
        steamSupportGroup.add(upperJunction)
      }

      // Upper ceiling header tying the two vertical risers into the facility overhead network
      const upperHeader = new THREE.Mesh(headerRunGeo, pipeMetalMat)
      upperHeader.rotation.z = Math.PI * 0.5
      upperHeader.position.set(0.1, ceilingSoffitY - 0.36, lineZ)
      steamSupportGroup.add(upperHeader)

      if (mountType === 'wall') {
        const bracketCoords = [
          { x: -0.58, y: 0.72, horiz: false },
          { x: -0.58, y: 2.35, horiz: false },
          { x: 0.78, y: 0.72, horiz: false },
          { x: 0.78, y: 2.35, horiz: false },
          { x: -0.22, y: pipeMainY, horiz: true },
          { x: 0.48, y: pipeMainY, horiz: true },
        ]
        for (let i = 0; i < bracketCoords.length; i += 1) {
          const bc = bracketCoords[i]
          const plate = new THREE.Mesh(wallPlateGeo, darkSteelMat)
          plate.position.set(bc.x, bc.y, -1.955)
          steamSupportGroup.add(plate)

          const strut = new THREE.Mesh(wallStrutGeo, darkSteelMat)
          strut.position.set(bc.x, bc.y, -1.88)
          steamSupportGroup.add(strut)

          const ring = new THREE.Mesh(clampRingGeo, darkSteelMat)
          if (bc.horiz) {
            ring.rotation.z = Math.PI * 0.5
          }
          ring.position.set(bc.x, bc.y, lineZ)
          steamSupportGroup.add(ring)
        }
      } else {
        for (const sx of [-0.58, 0.1, 0.78]) {
          const strap = new THREE.Mesh(ceilingStrapGeo, darkSteelMat)
          strap.position.set(sx, ceilingSoffitY - 0.22, lineZ)
          steamSupportGroup.add(strap)
        }
      }

      // Upstream pressure gauge and manual shutoff valve assembly at x = -0.58
      const gaugeStem = new THREE.Mesh(gaugeStemGeo, brassMat)
      gaugeStem.position.set(-0.58, pipeMainY + 0.11, lineZ + 0.03)
      steamSupportGroup.add(gaugeStem)

      const gaugeDial = new THREE.Mesh(gaugeDialGeo, brassMat)
      gaugeDial.rotation.x = Math.PI * 0.5
      gaugeDial.position.set(-0.58, pipeMainY + 0.19, lineZ + 0.055)
      steamSupportGroup.add(gaugeDial)

      const valveBody = new THREE.Mesh(valveBodyGeo, brassMat)
      valveBody.position.set(-0.58, pipeMainY - 0.1, lineZ)
      steamSupportGroup.add(valveBody)

      const valveStem = new THREE.Mesh(valveStemGeo, darkSteelMat)
      valveStem.rotation.x = Math.PI * 0.5
      valveStem.position.set(-0.58, pipeMainY - 0.1, lineZ + 0.06)
      steamSupportGroup.add(valveStem)

      const valveWheelMesh = new THREE.Group()
      valveWheelMesh.name = 'hazard-steam-valve-wheel'
      valveWheelMesh.position.set(-0.58, pipeMainY - 0.1, lineZ + 0.115)

      const wheelRim = new THREE.Mesh(valveWheelRimGeo, valveMat)
      wheelRim.rotation.x = Math.PI * 0.5
      valveWheelMesh.add(wheelRim)

      const spokeA = new THREE.Mesh(valveSpokeGeo, darkSteelMat)
      valveWheelMesh.add(spokeA)

      const spokeB = new THREE.Mesh(valveSpokeGeo, darkSteelMat)
      spokeB.rotation.z = Math.PI * 0.5
      valveWheelMesh.add(spokeB)

      steamSupportGroup.add(valveWheelMesh)

      // 2. Pressurized horizontal branch main & sealed union flange joint (flush while dormant)
      const steamGroup = new THREE.Group()
      steamGroup.name = 'hazard-steam-pipe'
      steamGroup.position.set(0.1, pipeMainY, lineZ)
      steamMountGroup.add(steamGroup)

      const pipe = new THREE.Mesh(pipeGeo, pipeMetalMat)
      pipe.rotation.z = Math.PI * 0.5
      steamGroup.add(pipe)

      // Bolted union flange at local x = +0.04 relative to steamGroup (cell x = +0.14)
      const ruptureFlangeGroup = new THREE.Group()
      ruptureFlangeGroup.name = 'hazard-steam-rupture-flange'
      ruptureFlangeGroup.position.set(0.04, 0, 0)
      steamGroup.add(ruptureFlangeGroup)

      const leftUnionPlate = new THREE.Mesh(unionPlateGeo, darkSteelMat)
      leftUnionPlate.rotation.z = Math.PI * 0.5
      leftUnionPlate.position.set(-0.022, 0, 0)
      ruptureFlangeGroup.add(leftUnionPlate)

      const rightUnionPlate = new THREE.Mesh(unionPlateGeo, darkSteelMat)
      rightUnionPlate.rotation.z = Math.PI * 0.5
      rightUnionPlate.position.set(0.022, 0, 0)
      ruptureFlangeGroup.add(rightUnionPlate)

      const gasketRing = new THREE.Mesh(gasketRingGeo, gasketMat)
      gasketRing.rotation.z = Math.PI * 0.5
      gasketRing.position.set(0, 0, 0)
      ruptureFlangeGroup.add(gasketRing)

      for (let b = 0; b < 4; b += 1) {
        const angle = (b / 4) * Math.PI * 2 + Math.PI * 0.25
        const bolt = new THREE.Mesh(boltPinGeo, brassMat)
        bolt.position.set(0, Math.cos(angle) * 0.082, Math.sin(angle) * 0.082)
        ruptureFlangeGroup.add(bolt)
      }

      // Bolted emergency split-sleeve repair clamp placed over the ruptured flange when sealed
      const repairPatchGroup = new THREE.Group()
      repairPatchGroup.name = 'hazard-steam-repair-patch'
      repairPatchGroup.visible = false
      const patchLinerGeo = getPooledGeometry(
        'steam_pipe:repair_patch_liner',
        () => new THREE.CylinderGeometry(0.114, 0.114, 0.21, 12)
      )
      const patchShellGeo = getPooledGeometry(
        'steam_pipe:repair_patch_shell',
        () => new THREE.CylinderGeometry(0.124, 0.124, 0.175, 12)
      )
      const patchBandGeo = getPooledGeometry(
        'steam_pipe:repair_patch_band',
        () => new THREE.CylinderGeometry(0.128, 0.128, 0.042, 12)
      )
      const patchLugGeo = getPooledGeometry(
        'steam_pipe:repair_patch_lug',
        () => new THREE.BoxGeometry(0.16, 0.046, 0.058)
      )
      const patchLiner = new THREE.Mesh(patchLinerGeo, gasketMat)
      patchLiner.rotation.z = Math.PI * 0.5
      repairPatchGroup.add(patchLiner)
      const patchShell = new THREE.Mesh(patchShellGeo, darkSteelMat)
      patchShell.rotation.z = Math.PI * 0.5
      repairPatchGroup.add(patchShell)
      const patchBand = new THREE.Mesh(patchBandGeo, brassMat)
      patchBand.rotation.z = Math.PI * 0.5
      repairPatchGroup.add(patchBand)
      const patchLug = new THREE.Mesh(patchLugGeo, darkSteelMat)
      patchLug.position.set(0, 0.105, 0.068)
      repairPatchGroup.add(patchLug)
      for (const lx of [-0.05, 0, 0.05]) {
        const clampBolt = new THREE.Mesh(boltPinGeo, brassMat)
        clampBolt.rotation.y = Math.PI * 0.5
        clampBolt.position.set(lx, 0.105, 0.088)
        repairPatchGroup.add(clampBolt)
      }
      ruptureFlangeGroup.add(repairPatchGroup)

      // 3. Warning condensation droplets dripping from the stressed flange gasket
      const condensationGroup = new THREE.Group()
      condensationGroup.name = 'hazard-steam-condensation'
      condensationGroup.visible = false
      steamMountGroup.add(condensationGroup)

      const dropGeo = getPooledGeometry(
        'steam_pipe:condensation_drop',
        () => new THREE.BoxGeometry(0.022, 0.042, 0.022)
      )
      const condensationDrops = []
      const condensationConfigs = [
        { x: 0.11, z: lineZ + 0.08, speed: 2.2, phase: 0.0, dropDist: 0.65 },
        { x: 0.14, z: lineZ + 0.09, speed: 2.7, phase: 0.25, dropDist: 0.72 },
        { x: 0.17, z: lineZ + 0.08, speed: 2.4, phase: 0.52, dropDist: 0.62 },
        { x: 0.13, z: lineZ + 0.07, speed: 3.0, phase: 0.74, dropDist: 0.58 },
        { x: 0.16, z: lineZ + 0.09, speed: 2.5, phase: 0.88, dropDist: 0.68 },
      ]
      for (let i = 0; i < condensationConfigs.length; i += 1) {
        const cfg = condensationConfigs[i]
        const drop = new THREE.Mesh(dropGeo, condensationMat)
        drop.position.set(cfg.x, pipeMainY - 0.08, cfg.z)
        condensationGroup.add(drop)
        condensationDrops.push(drop)
      }

      // 4. Directional steam jet & billowing wall-to-wall plume barrier spanning both corridor lanes
      const steamPlumeGroup = new THREE.Group()
      steamPlumeGroup.name = 'hazard-steam-plume'
      steamMountGroup.add(steamPlumeGroup)

      const cloudGeo = getPooledGeometry(
        'steam_pipe:cloud',
        () => new THREE.SphereGeometry(0.45, 10, 10)
      )
      const cloud = new THREE.Mesh(cloudGeo, steamMat)
      cloud.position.set(0.14, pipeMainY, lineZ + 0.18)
      cloud.scale.set(0.22, 0.22, 0.28)
      cloud.visible = false
      steamPlumeGroup.add(cloud)

      const isWallSteam = mountType === 'wall'
      const plumeLobeMeshes = []
      const plumeLobeConfigs = [
        // 0: Pipe-side rupture collar jet (fills mounting wall face without penetrating z = -2.0)
        {
          startX: 0.14,
          startY: pipeMainY,
          startZ: lineZ + 0.14,
          steadyX: 0.14,
          steadyY: pipeMainY,
          steadyZ: isWallSteam ? -1.45 : -1.28,
          startScale: 0.18,
          steadyScaleX: 1.05,
          steadyScaleY: 0.96,
          steadyScaleZ: 1.02,
        },
        // 1: Pipe-side left/valve-side lower billow (floor-to-chest coverage on pipe lane)
        {
          startX: 0.14,
          startY: pipeMainY,
          startZ: lineZ + 0.18,
          steadyX: -0.58,
          steadyY: 0.82,
          steadyZ: isWallSteam ? -1.05 : -0.82,
          startScale: 0.2,
          steadyScaleX: 1.38,
          steadyScaleY: 1.32,
          steadyScaleZ: 1.65,
        },
        // 2: Pipe-side right billow (fills pipe lane toward +X)
        {
          startX: 0.14,
          startY: pipeMainY,
          startZ: lineZ + 0.18,
          steadyX: 0.82,
          steadyY: 1.02,
          steadyZ: isWallSteam ? -1.0 : -0.78,
          startScale: 0.2,
          steadyScaleX: 1.38,
          steadyScaleY: 1.42,
          steadyScaleZ: 1.68,
        },
        // 3: Center-left corridor curtain (eye-height & overhead steam wall across corridor midline)
        {
          startX: 0.14,
          startY: pipeMainY,
          startZ: lineZ + 0.2,
          steadyX: -0.52,
          steadyY: 1.56,
          steadyZ: 0.12,
          startScale: 0.18,
          steadyScaleX: 1.52,
          steadyScaleY: 1.58,
          steadyScaleZ: 1.85,
        },
        // 4: Center-right corridor curtain (floor-to-eye steam wall across corridor midline)
        {
          startX: 0.14,
          startY: pipeMainY,
          startZ: lineZ + 0.2,
          steadyX: 0.76,
          steadyY: 1.24,
          steadyZ: 0.22,
          startScale: 0.18,
          steadyScaleX: 1.52,
          steadyScaleY: 1.68,
          steadyScaleZ: 1.85,
        },
        // 5: Opposite-wall impact core (pressurized jet slams into opposite wall z ≈ +1.93m)
        {
          startX: 0.14,
          startY: pipeMainY,
          startZ: lineZ + 0.24,
          steadyX: 0.14,
          steadyY: 1.22,
          steadyZ: 1.2,
          startScale: 0.16,
          steadyScaleX: 1.68,
          steadyScaleY: 1.65,
          steadyScaleZ: 1.48,
        },
        // 6: Opposite-wall left bank (eliminates visual gap along opposite wall toward -X)
        {
          startX: 0.14,
          startY: pipeMainY,
          startZ: lineZ + 0.24,
          steadyX: -0.58,
          steadyY: 1.02,
          steadyZ: 1.22,
          startScale: 0.16,
          steadyScaleX: 1.42,
          steadyScaleY: 1.56,
          steadyScaleZ: 1.42,
        },
        // 7: Opposite-wall right bank (eliminates visual gap along opposite wall toward +X)
        {
          startX: 0.14,
          startY: pipeMainY,
          startZ: lineZ + 0.24,
          steadyX: 0.8,
          steadyY: 1.38,
          steadyZ: 1.22,
          startScale: 0.16,
          steadyScaleX: 1.44,
          steadyScaleY: 1.68,
          steadyScaleZ: 1.42,
        },
      ]
      for (let i = 0; i < plumeLobeConfigs.length; i += 1) {
        const cfg = plumeLobeConfigs[i]
        const lobe = new THREE.Mesh(cloudGeo, steamMat)
        lobe.position.set(cfg.startX, cfg.startY, cfg.startZ)
        lobe.scale.setScalar(cfg.startScale)
        lobe.visible = false
        steamPlumeGroup.add(lobe)
        plumeLobeMeshes.push(lobe)
      }

      root.userData = {
        hazardType: type,
        mountType,
        steamYaw,
        pipeMainY,
        lineZ,
        steamMountGroup,
        steamSupportGroup,
        steamGroup,
        steamPipe: pipe,
        ruptureFlangeGroup,
        repairPatchGroup,
        leftUnionPlate,
        rightUnionPlate,
        gasketRing,
        valveWheelMesh,
        condensationGroup,
        condensationDrops,
        condensationConfigs,
        condensationMat,
        steamPlumeGroup,
        steamCloud: cloud,
        plumeLobeMeshes,
        plumeLobeConfigs,
        steamMat,
        isPermanentlyCollapsed: false,
        isAftermathCleared: false,
      }
      break
    }

    case HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING: {
      const mountType = hazardData.mountType === 'ceiling' ? 'ceiling' : 'wall'
      const wallYaw = Number.isFinite(hazardData.wallYaw) ? hazardData.wallYaw : 0

      const mountGroup = new THREE.Group()
      mountGroup.name = `hazard-wiring-${mountType}-mount`
      mountGroup.rotation.y = mountType === 'wall' ? wallYaw : 0
      root.add(mountGroup)

      // Reuse shared abandoned-facility environmental materials & geometries so dormant electrical
      // hardware is indistinguishable from ordinary safe electrical panel decoys.
      const assets = getElectricalWiringSharedAssets(hazardData.qualityPreset || 'high')
      const {
        darkSteelMat,
        lockerBlueMat,
        rustyMetalMat,
        cableMat,
        plaqueMat,
        wallSteelGeo,
        wallEnclosureGeo,
        wallDoorGeo,
        wallDoorClaspGeo,
        wallDoorPlaqueGeo,
        wallRustGeo,
        wallPlaqueGeo,
        wallCablesGeo,
        wallCuffsGeo,
        ceilingSteelGeo,
        ceilingEnclosureGeo,
        ceilingDoorGeo,
        ceilingDoorPlaqueGeo,
        ceilingRustGeo,
        ceilingPlaqueGeo,
        ceilingCablesGeo,
        ceilingCuffsGeo,
        tipGeo,
        leverArmGeo,
        leverGripGeo,
        wallCableSpecs,
        ceilingCableSpecs,
      } = assets

      // Instance-owned materials: dormant starts matte cable-sheathed; warning/active exposes glowing copper
      const tipMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.wiringCable,
        emissive: 0x000000,
        emissiveIntensity: 0,
        roughness: 0.85,
        metalness: 0.05,
      })
      const arcMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wiringArcActive,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const sparkMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wiringSparkWarning,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const glowMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wiringArcActive,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      const arcSegGeo = getPooledGeometry(
        'wiring:arcSeg',
        () => new THREE.BoxGeometry(0.014, 0.12, 0.014)
      )
      const sparkGeo = getPooledGeometry(
        'wiring:spark',
        () => new THREE.BoxGeometry(0.024, 0.056, 0.024)
      )
      const glowGeo = getPooledGeometry(
        'wiring:glow',
        () => new THREE.SphereGeometry(0.26, 8, 8)
      )

      const insulationBootGeo = getPooledGeometry(
        'wiring:insulationBoot',
        () => new THREE.CylinderGeometry(0.03, 0.025, 0.145, 8)
      )
      const insulationBandGeo = getPooledGeometry(
        'wiring:insulationBand',
        () => new THREE.CylinderGeometry(0.034, 0.034, 0.032, 8)
      )
      const insulationClampGeo = getPooledGeometry(
        'wiring:insulationClamp',
        () => new THREE.CylinderGeometry(0.031, 0.031, 0.022, 8)
      )

      const cableGroup = new THREE.Group()
      cableGroup.name = 'hazard-wiring-cables'
      const insulationGroup = new THREE.Group()
      insulationGroup.name = 'hazard-wiring-insulation'
      insulationGroup.visible = false
      const breakerHandleGroup = new THREE.Group()
      breakerHandleGroup.name = 'hazard-wiring-breaker-handle'
      const junctionDoorGroup = new THREE.Group()
      junctionDoorGroup.name = 'hazard-wiring-junction-door'

      let dischargeLocalX
      let dischargeLocalY
      let dischargeLocalZ
      let cableRestY
      let tipCoords

      if (mountType === 'wall') {
        const wallZ = -CELL_SIZE * 0.5
        const juncX = 0.26
        const juncY = 1.62
        const brkX = -0.78
        const brkY = 1.32
        const doorHingeX = juncX - 0.205
        const doorHingeZ = wallZ + 0.158

        // First child of mountGroup MUST be a Mesh using pooled geometry + shared material (phaseF02)
        mountGroup.add(new THREE.Mesh(wallSteelGeo, darkSteelMat))
        mountGroup.add(new THREE.Mesh(wallEnclosureGeo, lockerBlueMat))
        mountGroup.add(new THREE.Mesh(wallRustGeo, rustyMetalMat))
        mountGroup.add(new THREE.Mesh(wallPlaqueGeo, plaqueMat))

        // Latched hinged access door (closed flush at ry = 0 while dormant; swings ajar on warning/active)
        junctionDoorGroup.position.set(doorHingeX, juncY, doorHingeZ)
        junctionDoorGroup.rotation.y = 0
        junctionDoorGroup.add(new THREE.Mesh(wallDoorGeo, lockerBlueMat))
        junctionDoorGroup.add(new THREE.Mesh(wallDoorClaspGeo, rustyMetalMat))
        junctionDoorGroup.add(new THREE.Mesh(wallDoorPlaqueGeo, plaqueMat))
        mountGroup.add(junctionDoorGroup)

        const leverArm = new THREE.Mesh(leverArmGeo, darkSteelMat)
        leverArm.position.set(0, 0.055, 0.014)
        breakerHandleGroup.add(leverArm)
        const leverGrip = new THREE.Mesh(leverGripGeo, rustyMetalMat)
        leverGrip.rotation.z = Math.PI * 0.5
        leverGrip.position.set(0.015, 0.11, 0.018)
        breakerHandleGroup.add(leverGrip)
        breakerHandleGroup.position.set(brkX + 0.132, brkY, wallZ + 0.094)
        breakerHandleGroup.rotation.x = -0.58
        mountGroup.add(breakerHandleGroup)

        // Feeder cables spilling from junction glands into local discharge center
        dischargeLocalX = juncX
        dischargeLocalY = 1.32
        dischargeLocalZ = -1.38
        cableRestY = dischargeLocalY
        cableGroup.position.set(dischargeLocalX, cableRestY, dischargeLocalZ)

        tipCoords = wallCableSpecs.map((cs) => [cs.tx, cs.ty, cs.tz])
        cableGroup.add(new THREE.Mesh(wallCablesGeo, cableMat))
        cableGroup.add(new THREE.Mesh(wallCuffsGeo, rustyMetalMat))

        for (let i = 0; i < wallCableSpecs.length; i += 1) {
          const cs = wallCableSpecs[i]
          const tip = new THREE.Mesh(tipGeo, tipMat)
          tip.position.set(cs.tx, cs.ty, cs.tz)
          tip.rotation.set(cs.rx + 0.14, 0, cs.rz)
          cableGroup.add(tip)

          const sleeve = new THREE.Group()
          sleeve.position.set(cs.tx, cs.ty, cs.tz)
          sleeve.rotation.set(cs.rx + 0.14, 0, cs.rz)
          const boot = new THREE.Mesh(insulationBootGeo, cableMat)
          sleeve.add(boot)
          const band = new THREE.Mesh(insulationBandGeo, plaqueMat)
          band.position.set(0, -0.025, 0)
          sleeve.add(band)
          const clamp = new THREE.Mesh(insulationClampGeo, darkSteelMat)
          clamp.position.set(0, -0.055, 0)
          sleeve.add(clamp)
          insulationGroup.add(sleeve)
        }
        cableGroup.add(insulationGroup)
        mountGroup.add(cableGroup)
      } else {
        // Open 4-way intersection overhead trapeze mount anchored into ceiling soffit (y = 3.60)
        // Trapeze rail sits at y = 3.02 cleanly below ceiling primary beams (beamBottomY = 3.04)
        const juncX = 0.26
        const juncY = 2.86
        const brkX = -0.82
        const brkY = 1.48

        // First child of mountGroup MUST be a Mesh using pooled geometry + shared material (phaseF02)
        mountGroup.add(new THREE.Mesh(ceilingSteelGeo, darkSteelMat))
        mountGroup.add(new THREE.Mesh(ceilingEnclosureGeo, lockerBlueMat))
        mountGroup.add(new THREE.Mesh(ceilingRustGeo, rustyMetalMat))
        mountGroup.add(new THREE.Mesh(ceilingPlaqueGeo, plaqueMat))

        junctionDoorGroup.position.set(juncX - 0.18, juncY, 0.175)
        junctionDoorGroup.rotation.y = 0
        junctionDoorGroup.add(new THREE.Mesh(ceilingDoorGeo, lockerBlueMat))
        junctionDoorGroup.add(new THREE.Mesh(ceilingDoorPlaqueGeo, plaqueMat))
        mountGroup.add(junctionDoorGroup)

        const leverArm = new THREE.Mesh(leverArmGeo, darkSteelMat)
        leverArm.position.set(0, 0.055, 0.014)
        breakerHandleGroup.add(leverArm)
        const leverGrip = new THREE.Mesh(leverGripGeo, rustyMetalMat)
        leverGrip.rotation.z = Math.PI * 0.5
        leverGrip.position.set(0.015, 0.11, 0.018)
        breakerHandleGroup.add(leverGrip)
        breakerHandleGroup.position.set(brkX + 0.132, brkY, 0.025)
        breakerHandleGroup.rotation.x = -0.58
        mountGroup.add(breakerHandleGroup)

        dischargeLocalX = juncX
        dischargeLocalY = 1.65
        dischargeLocalZ = 0
        cableRestY = dischargeLocalY
        cableGroup.position.set(dischargeLocalX, cableRestY, dischargeLocalZ)

        tipCoords = ceilingCableSpecs.map((cs) => [cs.tx, cs.ty, cs.tz])
        cableGroup.add(new THREE.Mesh(ceilingCablesGeo, cableMat))
        cableGroup.add(new THREE.Mesh(ceilingCuffsGeo, rustyMetalMat))

        for (let i = 0; i < ceilingCableSpecs.length; i += 1) {
          const cs = ceilingCableSpecs[i]
          const tip = new THREE.Mesh(tipGeo, tipMat)
          tip.position.set(cs.tx, cs.ty, cs.tz)
          tip.rotation.set(cs.rx, 0, cs.rz)
          cableGroup.add(tip)

          const sleeve = new THREE.Group()
          sleeve.position.set(cs.tx, cs.ty, cs.tz)
          sleeve.rotation.set(cs.rx, 0, cs.rz)
          const boot = new THREE.Mesh(insulationBootGeo, cableMat)
          sleeve.add(boot)
          const band = new THREE.Mesh(insulationBandGeo, plaqueMat)
          band.position.set(0, -0.025, 0)
          sleeve.add(band)
          const clamp = new THREE.Mesh(insulationClampGeo, darkSteelMat)
          clamp.position.set(0, -0.055, 0)
          sleeve.add(clamp)
          insulationGroup.add(sleeve)
        }
        cableGroup.add(insulationGroup)
        mountGroup.add(cableGroup)
      }

      // Bounded electrical arc & spark assembly anchored directly to the 3 copper conductor tips
      const dischargeGroup = new THREE.Group()
      dischargeGroup.name = 'hazard-wiring-discharge'
      dischargeGroup.position.set(dischargeLocalX, dischargeLocalY, dischargeLocalZ)
      mountGroup.add(dischargeGroup)

      const arcGroup = new THREE.Group()
      arcGroup.name = 'hazard-wiring-arcs'
      arcGroup.visible = false
      const arcBolts = []
      const tipPairs = [
        [tipCoords[0], tipCoords[1]],
        [tipCoords[1], tipCoords[2]],
        [tipCoords[2], tipCoords[0]],
      ]
      for (let b = 0; b < tipPairs.length; b += 1) {
        const [a, c] = tipPairs[b]
        const mx = (a[0] + c[0]) * 0.5
        const my = (a[1] + c[1]) * 0.5
        const mz = (a[2] + c[2]) * 0.5
        const dx = c[0] - a[0]
        const dy = c[1] - a[1]
        const dz = c[2] - a[2]
        const pairDist = Math.max(0.12, Math.hypot(dx, dy, dz))
        _wiringArcDir.set(dx / pairDist, dy / pairDist, dz / pairDist)

        const bolt = new THREE.Group()
        bolt.position.set(mx, my, mz)
        bolt.quaternion.setFromUnitVectors(_wiringArcUp, _wiringArcDir)

        const baseScaleY = pairDist / 0.28
        for (let s = 0; s < 3; s += 1) {
          const seg = new THREE.Mesh(arcSegGeo, arcMat)
          const zig = s % 2 === 0 ? 0.022 : -0.022
          seg.position.set(zig, (s - 1) * (pairDist * 0.28), 0)
          seg.rotation.z = s % 2 === 0 ? 0.36 : -0.36
          seg.scale.y = Math.max(0.45, baseScaleY * 0.72)
          bolt.add(seg)
        }
        arcGroup.add(bolt)
        arcBolts.push(bolt)
      }
      dischargeGroup.add(arcGroup)

      // Bounded 8 spark shards emitting strictly from the exposed copper conductor tip origins
      const sparkGroup = new THREE.Group()
      sparkGroup.name = 'hazard-wiring-sparks'
      sparkGroup.visible = false
      const sparkMeshes = []
      const sparkConfigs = []
      const MAX_WIRING_SPARKS = 8
      for (let i = 0; i < MAX_WIRING_SPARKS; i += 1) {
        const originTip = tipCoords[i % tipCoords.length]
        const angle = (i / MAX_WIRING_SPARKS) * Math.PI * 2 + (i % 2) * 0.31
        const elev = 0.18 + (i % 3) * 0.16
        sparkConfigs.push({
          originX: originTip[0],
          originY: originTip[1],
          originZ: originTip[2],
          dx: Math.cos(angle) * 0.52,
          dy: elev,
          dz: Math.sin(angle) * 0.52,
          phase: (i * 0.37) % 1,
          speed: 1.9 + (i % 4) * 0.35,
          activeSpeed: 2.3 + (i % 4) * 0.4,
        })
        const spark = new THREE.Mesh(sparkGeo, sparkMat)
        spark.position.set(originTip[0], originTip[1], originTip[2])
        spark.rotation.set(i * 0.7, angle, i * 0.5)
        sparkGroup.add(spark)
        sparkMeshes.push(spark)
      }
      dischargeGroup.add(sparkGroup)

      const glowMesh = new THREE.Mesh(glowGeo, glowMat)
      glowMesh.visible = false
      dischargeGroup.add(glowMesh)

      root.userData = {
        hazardType: type,
        mountType,
        wallYaw,
        mountGroup,
        junctionDoorGroup,
        breakerHandleGroup,
        cableGroup,
        insulationGroup,
        cableRestY,
        dischargeGroup,
        arcGroup,
        arcBolts,
        sparkGroup,
        sparkMeshes,
        sparkConfigs,
        glowMesh,
        tipMat,
        arcMat,
        sparkMat,
        glowMat,
        isPermanentlyCollapsed: false,
        isAftermathCleared: false,
      }
      break
    }

    case HAZARD_TYPES.COLLAPSING_FLOOR_GRATE: {
      const grateYaw = Number.isFinite(hazardData.grateYaw) ? hazardData.grateYaw : 0
      const corridorAxis = hazardData.corridorAxis === 'ew' ? 'ew' : 'ns'
      const localPitOffset = hazardData.localPitOffset
        ? {
            x: Number(hazardData.localPitOffset.x) || 0,
            y: 0,
            z: Number(hazardData.localPitOffset.z) || 0,
          }
        : { x: 0, y: 0, z: 0 }

      const assets = getFloorGrateSharedAssets(hazardData.qualityPreset || 'high')
      const {
        ix,
        ox,
        oz,
        pitDepth,
        shaftWallMat,
        curbMat,
        ironMat,
        rustMat,
        pitMat,
        subPipeMat,
        boltMat,
        shaftConcreteGeo,
        pitSumpGeo,
        subPipeGeo,
        curbFrameGeo,
        leafSteelGeo,
        seamRustGeo,
        boltGeo,
        stubGeo,
        fragGeo,
        debrisGeo,
        coverPlateGeo,
        dustGeo,
      } = assets

      const grateRoot = new THREE.Group()
      grateRoot.name = 'hazard-floor-grate-root'
      grateRoot.position.set(localPitOffset.x, 0, localPitOffset.z)
      grateRoot.rotation.y = grateYaw
      root.add(grateRoot)

      // Instance-owned dust material so each collapsing grate fades dust independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.grateDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Real 0.68m recessed concrete service shaft lining + sump floor + subfloor utility pipes
      const shaftMesh = new THREE.Mesh(shaftConcreteGeo, shaftWallMat)
      shaftMesh.name = 'hazard-grate-shaft'
      shaftMesh.receiveShadow = true
      grateRoot.add(shaftMesh)

      const pitMesh = new THREE.Mesh(pitSumpGeo, pitMat)
      pitMesh.name = 'hazard-grate-sump'
      pitMesh.position.set(0, -(pitDepth - 0.006), 0)
      pitMesh.receiveShadow = true
      grateRoot.add(pitMesh)

      const subPipeMesh = new THREE.Mesh(subPipeGeo, subPipeMat)
      subPipeMesh.name = 'hazard-grate-subpipes'
      grateRoot.add(subPipeMesh)

      // 2. Flush floor-embedded cast-steel perimeter curb + bearing seat (y = -0.018..+0.014)
      const curbMesh = new THREE.Mesh(curbFrameGeo, curbMat)
      curbMesh.name = 'hazard-grate-curb'
      curbMesh.receiveShadow = true
      grateRoot.add(curbMesh)

      // 3. Corner anchor bolts (uniformly weathered to match decoy grates; loosen & shear during collapse)
      const bx = ox - 0.04
      const bz = oz - 0.04
      const boltRestPositions = [
        { x: -bx, y: 0.019, z: -bz, sx: -(ox + 0.08), sy: 0.011, sz: -(oz + 0.06), inPit: false },
        { x: bx, y: 0.019, z: -bz, sx: 0.24, sy: -0.654, sz: -0.28, inPit: true },
        { x: -bx, y: 0.019, z: bz, sx: -(ox + 0.06), sy: 0.011, sz: oz + 0.08, inPit: false },
        { x: bx, y: 0.019, z: bz, sx: -0.22, sy: -0.654, sz: 0.31, inPit: true },
      ]
      const bolts = []
      for (let i = 0; i < boltRestPositions.length; i += 1) {
        const bp = boltRestPositions[i]
        const bolt = new THREE.Mesh(boltGeo, boltMat)
        bolt.position.set(bp.x, bp.y, bp.z)
        grateRoot.add(bolt)
        bolts.push(bolt)
      }

      // 4. Collapsible two-leaf open steel bar grating flush inside curb (y = 0.009)
      const grateRestY = 0.009
      const leftLeafGroup = new THREE.Group()
      leftLeafGroup.name = 'hazard-grate-left-leaf'
      leftLeafGroup.position.set(-0.56, grateRestY, 0)
      const leftLeafMesh = new THREE.Mesh(leafSteelGeo, ironMat)
      leftLeafMesh.receiveShadow = true
      const leftSeamMesh = new THREE.Mesh(seamRustGeo, rustMat)
      leftLeafGroup.add(leftLeafMesh)
      leftLeafGroup.add(leftSeamMesh)
      grateRoot.add(leftLeafGroup)

      const rightLeafGroup = new THREE.Group()
      rightLeafGroup.name = 'hazard-grate-right-leaf'
      rightLeafGroup.position.set(0.56, grateRestY, 0)
      const rightLeafMesh = new THREE.Mesh(leafSteelGeo, ironMat)
      rightLeafMesh.rotation.y = Math.PI
      rightLeafMesh.receiveShadow = true
      const rightSeamMesh = new THREE.Mesh(seamRustGeo, rustMat)
      rightSeamMesh.rotation.y = Math.PI
      rightLeafGroup.add(rightLeafMesh)
      rightLeafGroup.add(rightSeamMesh)
      grateRoot.add(rightLeafGroup)

      // 5. Jagged bent perimeter fracture stubs shown once grate breaks open
      const brokenStubsGroup = new THREE.Group()
      brokenStubsGroup.name = 'hazard-grate-broken-stubs'
      brokenStubsGroup.visible = false
      const stubSpecs = [
        { x: -(ix - 0.04), z: -0.34, rz: -0.62, ry: 0.14 },
        { x: -(ix - 0.04), z: 0.17, rz: -0.74, ry: -0.18 },
        { x: ix - 0.04, z: -0.17, rz: 0.66, ry: 0.12 },
        { x: ix - 0.04, z: 0.34, rz: 0.56, ry: -0.16 },
      ]
      for (let i = 0; i < stubSpecs.length; i += 1) {
        const st = stubSpecs[i]
        const stub = new THREE.Mesh(stubGeo, i % 2 === 0 ? rustMat : ironMat)
        stub.position.set(st.x, 0.008, st.z)
        stub.rotation.set(0, st.ry, st.rz)
        brokenStubsGroup.add(stub)
      }
      grateRoot.add(brokenStubsGroup)

      // 6. Bounded warning falling fragments (6 rust/mortar chips falling INTO the 0.68m pit)
      const warningFragGroup = new THREE.Group()
      warningFragGroup.name = 'hazard-grate-warning-fragments'
      warningFragGroup.visible = false
      const warningFragments = []
      const warningFragConfigs = []
      const MAX_WARNING_FRAGS = 6
      for (let i = 0; i < MAX_WARNING_FRAGS; i += 1) {
        const sx = (i % 2 === 0 ? -1 : 1) * (0.04 + (i % 3) * 0.09)
        const sz = -0.44 + i * 0.176
        warningFragConfigs.push({
          x: sx,
          z: sz,
          phase: (i * 0.29) % 1,
          speed: 1.7 + (i % 3) * 0.35,
        })
        const chip = new THREE.Mesh(fragGeo, i % 2 === 0 ? rustMat : shaftWallMat)
        chip.position.set(sx, 0.01, sz)
        warningFragGroup.add(chip)
        warningFragments.push(chip)
      }
      grateRoot.add(warningFragGroup)

      // 7. Bounded collapse debris shards (4 settle into the 0.68m sump, 4 scatter cleanly near rim)
      const debrisGroup = new THREE.Group()
      debrisGroup.name = 'hazard-grate-debris'
      debrisGroup.visible = false
      const debrisMeshes = []
      const debrisConfigs = []
      const MAX_DEBRIS = 8
      for (let i = 0; i < MAX_DEBRIS; i += 1) {
        const inPit = i % 2 === 0
        const angle = (i / MAX_DEBRIS) * Math.PI * 2 + 0.32
        const startX = Math.cos(angle) * 0.18
        const startZ = Math.sin(angle) * 0.16
        const endX = inPit ? Math.cos(angle) * (0.18 + (i % 3) * 0.08) : Math.cos(angle) * (ox + 0.12)
        const endZ = inPit ? Math.sin(angle) * (0.18 + (i % 3) * 0.08) : Math.sin(angle) * (oz + 0.12)
        debrisConfigs.push({
          inPit,
          startX,
          startZ,
          endX,
          endZ,
          endY: inPit ? -(pitDepth - 0.028) : 0.014,
          arcH: inPit ? 0.05 : 0.18 + (i % 3) * 0.05,
          rotY: angle + i * 0.45,
        })
        const shard = new THREE.Mesh(debrisGeo, i % 3 === 0 ? rustMat : ironMat)
        debrisGroup.add(shard)
        debrisMeshes.push(shard)
      }
      grateRoot.add(debrisGroup)

      // 8. Bounded dust burst puffs (6 lightweight spheres rising & fading during collapse)
      const dustGroup = new THREE.Group()
      dustGroup.name = 'hazard-grate-dust'
      dustGroup.visible = false
      const dustMeshes = []
      const dustConfigs = []
      const MAX_DUST = 6
      for (let i = 0; i < MAX_DUST; i += 1) {
        const angle = (i / MAX_DUST) * Math.PI * 2
        dustConfigs.push({
          dx: Math.cos(angle) * (0.28 + (i % 2) * 0.14),
          dz: Math.sin(angle) * (0.28 + (i % 2) * 0.14),
          riseY: 0.34 + (i % 3) * 0.14,
          baseScale: 0.58 + (i % 3) * 0.16,
        })
        const puff = new THREE.Mesh(dustGeo, dustMat)
        dustGroup.add(puff)
        dustMeshes.push(puff)
      }
      grateRoot.add(dustGroup)

      // 9. Bolted steel trench recovery cover ("Secure Floor Opening" interaction)
      const securedCoverGroup = new THREE.Group()
      securedCoverGroup.name = 'hazard-grate-secured-cover'
      securedCoverGroup.visible = false
      const coverPlateMesh = new THREE.Mesh(coverPlateGeo, ironMat)
      coverPlateMesh.receiveShadow = true
      securedCoverGroup.add(coverPlateMesh)
      for (const cz of [-oz + 0.06, 0, oz - 0.06]) {
        for (const cx of [-ox + 0.06, ox - 0.06]) {
          const bMesh = new THREE.Mesh(boltGeo, boltMat)
          bMesh.position.set(cx, 0.025, cz)
          securedCoverGroup.add(bMesh)
        }
      }
      grateRoot.add(securedCoverGroup)

      root.userData = {
        hazardType: type,
        floorY: 0,
        corridorAxis,
        grateYaw,
        localPitOffset,
        pitDepth,
        grateRestY,
        grateRoot,
        pitMesh,
        shaftMesh,
        subPipeMesh,
        curbMesh,
        leftLeafGroup,
        rightLeafGroup,
        bolts,
        boltRestPositions,
        brokenStubsGroup,
        warningFragGroup,
        warningFragments,
        warningFragConfigs,
        debrisGroup,
        debrisMeshes,
        debrisConfigs,
        dustGroup,
        dustMeshes,
        dustConfigs,
        dustMat,
        securedCoverGroup,
        isPermanentlyCollapsed: false,
        isAftermathCleared: false,
      }
      break
    }

    case HAZARD_TYPES.WALL_COLLAPSE: {
      const wallYaw = Number.isFinite(hazardData.wallYaw) ? hazardData.wallYaw : 0
      const wallSide = hazardData.wallSide || 'north'
      const assets = getWallCollapseSharedAssets(hazardData.qualityPreset || 'high')
      const wallZ = assets.wallZ
      const slabHalfX = assets.slabW * 0.5
      const slabHalfY = assets.slabH * 0.5
      const slabHalfZ = assets.slabT * 0.5
      const slabRestZ = wallZ + slabHalfZ

      const wallMountGroup = new THREE.Group()
      wallMountGroup.name = `hazard-wall-collapse-${wallSide}`
      wallMountGroup.rotation.y = wallYaw
      root.add(wallMountGroup)

      // Instance-owned dust material so each collapsing wall fades independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wallDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Recessed fractured cavity backing flush on wall face (hidden while dormant, revealed only as masonry detaches)
      const cavityMesh = new THREE.Mesh(assets.cavityGeo, assets.cavityMat)
      cavityMesh.position.set(0, 1.24, wallZ + 0.003)
      cavityMesh.castShadow = false
      cavityMesh.receiveShadow = true
      cavityMesh.visible = false
      wallMountGroup.add(cavityMesh)

      // Flush weathered mortar & spall perimeter seam framing the wall veneer bay
      const rimGroup = new THREE.Mesh(assets.rimFrameGeo, assets.concreteMat)
      rimGroup.name = 'hazard-wall-fracture-rim'
      rimGroup.castShadow = false
      rimGroup.receiveShadow = true
      wallMountGroup.add(rimGroup)

      // 2. Concealed oxidized structural rebar revealed inside broken cavity on rupture
      const rebarGroup = new THREE.Group()
      rebarGroup.name = 'hazard-wall-rebar'
      rebarGroup.visible = false
      const rebarSpecs = [
        { x: -0.58, y: 1.28, rz: 0.08, rx: 0.014 },
        { x: -0.18, y: 1.24, rz: -0.1, rx: 0.015 },
        { x: 0.24, y: 1.3, rz: 0.06, rx: -0.014 },
        { x: 0.62, y: 1.24, rz: -0.08, rx: 0.014 },
        { x: 0.0, y: 1.42, rz: Math.PI * 0.5 + 0.05, rx: 0.012 },
      ]
      for (let i = 0; i < rebarSpecs.length; i += 1) {
        const rb = rebarSpecs[i]
        const rod = new THREE.Mesh(assets.rebarGeo, assets.rebarMat)
        rod.position.set(rb.x, rb.y, wallZ + 0.018)
        rod.rotation.set(rb.rx, 0, rb.rz)
        rebarGroup.add(rod)
      }
      wallMountGroup.add(rebarGroup)

      // 3. Flush wall-integrated fractured masonry veneer slabs (0.044m relief matching MAX_WALL_PROTRUSION)
      const slabGroup = new THREE.Group()
      slabGroup.name = 'hazard-wall-slabs'
      const rawSlabTargets = [
        {
          warnDropY: 0.024,
          warnRx: 0.075,
          bulgeZ: 0.072,
          detachDelay: 0.0,
          tImpact: 0.58,
          tSettle: 0.86,
          bounceH: 0.032,
          impactX: -0.52,
          impactZ: wallZ + 0.6,
          endX: -0.54,
          baseStackY: 0.058,
          endZ: wallZ + 0.64,
          endRx: 1.46,
          endRy: 0.18,
          endRz: -0.15,
          clearedX: -0.58,
          clearedZ: wallZ + 0.21,
          clearedRx: 0.08,
          clearedRy: 0.02,
          clearedRz: -0.03,
        },
        {
          warnDropY: 0.026,
          warnRx: 0.08,
          bulgeZ: 0.076,
          detachDelay: 0.04,
          tImpact: 0.6,
          tSettle: 0.88,
          bounceH: 0.03,
          impactX: 0.54,
          impactZ: wallZ + 0.59,
          endX: 0.56,
          baseStackY: 0.048,
          endZ: wallZ + 0.62,
          endRx: 1.49,
          endRy: -0.22,
          endRz: 0.16,
          clearedX: 0.58,
          clearedZ: wallZ + 0.21,
          clearedRx: 0.08,
          clearedRy: -0.02,
          clearedRz: 0.03,
        },
        {
          warnDropY: 0.012,
          warnRx: 0.055,
          bulgeZ: 0.058,
          detachDelay: 0.07,
          tImpact: 0.52,
          tSettle: 0.8,
          bounceH: 0.02,
          impactX: -0.42,
          impactZ: wallZ + 0.53,
          endX: -0.44,
          baseStackY: 0.005,
          endZ: wallZ + 0.56,
          endRx: 1.54,
          endRy: -0.12,
          endRz: 0.1,
          clearedX: -0.52,
          clearedZ: wallZ + 0.07,
          clearedRx: 0.05,
          clearedRy: -0.02,
          clearedRz: 0.02,
        },
        {
          warnDropY: 0.014,
          warnRx: 0.06,
          bulgeZ: 0.062,
          detachDelay: 0.06,
          tImpact: 0.54,
          tSettle: 0.82,
          bounceH: 0.022,
          impactX: 0.44,
          impactZ: wallZ + 0.55,
          endX: 0.46,
          baseStackY: 0.005,
          endZ: wallZ + 0.58,
          endRx: 1.52,
          endRy: 0.14,
          endRz: -0.12,
          clearedX: 0.52,
          clearedZ: wallZ + 0.07,
          clearedRx: 0.05,
          clearedRy: 0.02,
          clearedRz: -0.02,
        },
      ]
      const slabConfigs = []
      const slabMeshes = []
      for (let i = 0; i < WALL_COLLAPSE_SLAB_LAYOUT.length; i += 1) {
        const sl = WALL_COLLAPSE_SLAB_LAYOUT[i]
        const tgt = rawSlabTargets[i]
        const endExt = computeBoxOrientedExtents(
          slabHalfX,
          slabHalfY,
          slabHalfZ,
          tgt.endRx,
          tgt.endRy,
          tgt.endRz
        )
        const clearedExt = computeBoxOrientedExtents(
          slabHalfX,
          slabHalfY,
          slabHalfZ,
          tgt.clearedRx,
          tgt.clearedRy,
          tgt.clearedRz
        )
        const sc = {
          restX: sl.restX,
          restY: sl.restY,
          restZ: slabRestZ,
          warnDropY: tgt.warnDropY,
          warnRx: tgt.warnRx,
          bulgeZ: tgt.bulgeZ,
          warnEndY: sl.restY - tgt.warnDropY,
          warnEndZ: slabRestZ + tgt.bulgeZ,
          detachDelay: tgt.detachDelay,
          tImpact: tgt.tImpact,
          tSettle: tgt.tSettle,
          bounceH: tgt.bounceH,
          impactX: tgt.impactX,
          impactZ: Math.max(wallZ + endExt.extentZ + 0.004, tgt.impactZ),
          endX: tgt.endX,
          endY: endExt.extentY + tgt.baseStackY,
          endZ: Math.max(wallZ + endExt.extentZ + 0.004, tgt.endZ),
          endRx: tgt.endRx,
          endRy: tgt.endRy,
          endRz: tgt.endRz,
          clearedX: tgt.clearedX,
          clearedY: clearedExt.extentY + 0.004,
          clearedZ: Math.max(wallZ + clearedExt.extentZ + 0.006, tgt.clearedZ),
          clearedRx: tgt.clearedRx,
          clearedRy: tgt.clearedRy,
          clearedRz: tgt.clearedRz,
        }
        slabConfigs.push(sc)
        const slab = new THREE.Mesh(
          assets.slabGeo,
          i % 2 === 0 ? assets.concreteMat : assets.rubbleMat
        )
        slab.castShadow = false
        slab.receiveShadow = true
        slab.position.set(sc.restX, sc.restY, sc.restZ)
        slabGroup.add(slab)
        slabMeshes.push(slab)
      }
      wallMountGroup.add(slabGroup)

      // 4. Flush embedded fracture crack lines across masonry panel face (identical to safe decoys while dormant)
      const crackGroup = new THREE.Group()
      crackGroup.name = 'hazard-wall-cracks'
      const crackBaseZ = wallZ + assets.slabT
      crackGroup.position.set(0, 1.22, crackBaseZ)
      crackGroup.scale.set(0.95, 0.95, 1)
      for (let i = 0; i < WALL_COLLAPSE_CRACK_LAYOUT.length; i += 1) {
        const cs = WALL_COLLAPSE_CRACK_LAYOUT[i]
        const strip = new THREE.Mesh(assets.crackGeo, assets.crackMat)
        strip.position.set(cs.x, cs.y, 0)
        strip.rotation.z = cs.rz
        strip.scale.set(1, cs.sy, 1)
        crackGroup.add(strip)
      }
      wallMountGroup.add(crackGroup)

      // 5. Bounded warning mortar chips & masonry flakes (6 pieces)
      const warningGroup = new THREE.Group()
      warningGroup.name = 'hazard-wall-warning-masonry'
      warningGroup.visible = false
      const warningChunks = []
      const warningChunkConfigs = []
      const MAX_WALL_WARN_CHIPS = 6
      for (let i = 0; i < MAX_WALL_WARN_CHIPS; i += 1) {
        const wx = -0.76 + i * 0.3
        const startY = 1.48 + (i % 3) * 0.28
        const endX = wx + (i % 2 === 0 ? -0.08 : 0.08)
        warningChunkConfigs.push({
          x: wx,
          endX,
          startY,
          z: wallZ + assets.slabT + 0.01 + (i % 2) * 0.015,
          endZ: wallZ + 0.24 + (i % 3) * 0.09,
          startFrac: (i * 0.09) % 0.42,
          endFrac: Math.min(0.96, ((i * 0.09) % 0.42) + 0.52),
          sx: 0.068,
          sy: 0.056,
          sz: 0.048,
        })
        const chip = new THREE.Mesh(
          assets.warnChipGeo,
          i % 2 === 0 ? assets.rubbleMat : assets.concreteMat
        )
        chip.scale.set(0.068, 0.056, 0.048)
        warningGroup.add(chip)
        warningChunks.push(chip)
      }
      wallMountGroup.add(warningGroup)

      // 6. Bounded fractured concrete rubble chunks (8 blocks settling cleanly inside corridor apron)
      const wallRubbleGroup = new THREE.Group()
      wallRubbleGroup.name = 'hazard-wall-rubble'
      wallRubbleGroup.visible = false
      const wallRubbleMeshes = []
      const wallRubbleConfigs = []
      const MAX_WALL_RUBBLE = 8
      for (let i = 0; i < MAX_WALL_RUBBLE; i += 1) {
        const lane = -0.94 + (i / (MAX_WALL_RUBBLE - 1)) * 1.88
        const reach = 0.28 + (i % 4) * 0.22 // Settled within 0.28..0.94m of wall face
        const scaleX = 0.24 + (i % 3) * 0.04
        const scaleY = 0.13 + (i % 2) * 0.03
        const scaleZ = 0.17 + (i % 3) * 0.022
        const endRx = 0.14 + (i % 3) * 0.06
        const endRy = 0.4 + i * 0.75
        const endRz = (i % 2 === 0 ? 1 : -1) * 0.12
        const rubExt = computeBoxOrientedExtents(
          scaleX * 0.5,
          scaleY * 0.5,
          scaleZ * 0.5,
          endRx,
          endRy,
          endRz
        )
        const clearedRx = 0.08
        const clearedRy = (i % 2 === 0 ? 1 : -1) * 0.06
        const clearedRz = (i % 2 === 0 ? 1 : -1) * 0.08
        const rubClearedExt = computeBoxOrientedExtents(
          scaleX * 0.5,
          scaleY * 0.5,
          scaleZ * 0.5,
          clearedRx,
          clearedRy,
          clearedRz
        )
        const clearedSide = i < MAX_WALL_RUBBLE * 0.5 ? -1 : 1
        const clearedX = clearedSide * (0.62 + (i % 4) * 0.11)
        const clearedZ = Math.max(wallZ + rubClearedExt.extentZ + 0.006, wallZ + 0.12 + (i % 2) * 0.025)
        wallRubbleConfigs.push({
          startX: lane * 0.68,
          startY: 0.72 + (i % 3) * 0.52,
          startZ: wallZ + 0.08,
          endX: lane,
          endY: rubExt.extentY + 0.004,
          endZ: Math.max(wallZ + rubExt.extentZ + 0.006, wallZ + reach),
          arcH: 0.24 + (i % 3) * 0.12,
          scaleX,
          scaleY,
          scaleZ,
          endRx,
          endRy,
          endRz,
          clearedX,
          clearedY: rubClearedExt.extentY + 0.004,
          clearedZ,
          clearedRx,
          clearedRy,
          clearedRz,
        })
        const block = new THREE.Mesh(
          assets.rubbleBlockGeo,
          i % 2 === 0 ? assets.rubbleMat : assets.concreteMat
        )
        block.castShadow = false
        block.receiveShadow = true
        block.scale.set(scaleX, scaleY, scaleZ)
        wallRubbleGroup.add(block)
        wallRubbleMeshes.push(block)
      }
      wallMountGroup.add(wallRubbleGroup)

      // 7. Bounded mortar dust cloud puffs (6 spheres with C0 continuity across warning -> active -> disabled)
      const wallDustGroup = new THREE.Group()
      wallDustGroup.name = 'hazard-wall-dust'
      wallDustGroup.visible = false
      const wallDustMeshes = []
      const wallDustConfigs = []
      const MAX_WALL_DUST = 6
      for (let i = 0; i < MAX_WALL_DUST; i += 1) {
        const startY = 0.48 + (i % 3) * 0.4
        const warnEndY = Math.max(0.22, startY - 0.22)
        wallDustConfigs.push({
          x: -0.74 + i * 0.296,
          startY,
          warnEndY,
          riseY: 0.46 + (i % 2) * 0.24,
          reachZ: 0.42 + (i % 3) * 0.28,
          baseScale: 0.68 + (i % 3) * 0.2,
        })
        const puff = new THREE.Mesh(assets.dustGeo, dustMat)
        wallDustGroup.add(puff)
        wallDustMeshes.push(puff)
      }
      wallMountGroup.add(wallDustGroup)

      root.userData = {
        hazardType: type,
        wallSide,
        wallYaw,
        wallZ,
        slabHalfX,
        slabHalfY,
        slabHalfZ,
        crackBaseZ,
        wallMountGroup,
        cavityMesh,
        rimGroup,
        rebarGroup,
        slabGroup,
        slabMeshes,
        slabConfigs,
        crackGroup,
        warningGroup,
        warningChunks,
        warningChunkConfigs,
        wallRubbleGroup,
        wallRubbleMeshes,
        wallRubbleConfigs,
        wallDustGroup,
        wallDustMeshes,
        wallDustConfigs,
        dustMat,
      }
      break
    }

    case HAZARD_TYPES.FALLING_WATER_TANK: {
      const mountType = hazardData.mountType || 'ceiling_suspended'
      const wallSide = hazardData.wallSide || null
      const tankYaw = Number.isFinite(hazardData.tankYaw) ? hazardData.tankYaw : 0
      const sideSign =
        Number.isFinite(hazardData.sideSign) && hazardData.sideSign !== 0
          ? Math.sign(hazardData.sideSign)
          : 1
      const surgeLength = Number.isFinite(hazardData.surgeLength) ? hazardData.surgeLength : 2.55
      const surgeHalfWidth = Number.isFinite(hazardData.surgeHalfWidth) ? hazardData.surgeHalfWidth : 1.05
      const tankRestY = Number.isFinite(hazardData.tankRestY)
        ? hazardData.tankRestY
        : WATER_TANK_CONSTANTS.tankRestY
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : WATER_TANK_CONSTANTS.ceilingAnchorY
      const tankFallenY = WATER_TANK_CONSTANTS.tankFallenY

      const assets = getWaterTankSharedAssets('high')
      const {
        strapRestY,
        steelMat,
        rustMat,
        seamMat,
        ceilingRigGeo,
        wallBraceGeo,
        supplyWallSteelGeo,
        supplyWallTrimGeo,
        supplyCeilingSteelGeo,
        supplyCeilingTrimGeo,
        lowerStrapGeo,
        tankHullGeo,
        tankTrimGeo,
        rustPatchGeo,
        seamGeo,
        dropGeo,
        streamGeo,
        debrisGeo,
        surgeSheetGeo,
        crestGeo,
        sprayGeo,
        puddleGeo,
      } = assets

      const tankMountGroup = new THREE.Group()
      tankMountGroup.name = `hazard-water-tank-${mountType}`
      tankMountGroup.rotation.y = tankYaw
      root.add(tankMountGroup)

      // Instance-owned translucent water materials (disposed per hazard instance)
      const leakMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.waterLeak,
        roughness: 0.14,
        metalness: 0.12,
        transparent: true,
        opacity: WATER_TANK_CONSTANTS.dormantDripOpacity,
        depthWrite: false,
      })
      const surgeMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.waterSurge,
        roughness: 0.12,
        metalness: 0.22,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      const puddleMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.waterPuddle,
        roughness: 0.1,
        metalness: 0.28,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })

      // 1. Structural overhead support rig anchored flush to ceiling soffit (y = 3.60) & pipework
      const supportGroup = new THREE.Group()
      supportGroup.name = 'hazard-water-tank-supports'

      const ceilingRigMesh = new THREE.Mesh(ceilingRigGeo, steelMat)
      ceilingRigMesh.name = 'water-tank-ceiling-rig'
      supportGroup.add(ceilingRigMesh)

      const brokenStraps = []
      for (const sx of [-0.44, 0.44]) {
        const lowerStrap = new THREE.Mesh(lowerStrapGeo, rustMat)
        lowerStrap.position.set(sx, strapRestY, 0)
        supportGroup.add(lowerStrap)
        brokenStraps.push(lowerStrap)
      }

      // Integrated supply pipework, fittings, shutoff valve & pressure gauge
      let wallBraceGroup = null
      if (mountType === 'ceiling_wall_brace') {
        wallBraceGroup = new THREE.Group()
        wallBraceGroup.name = 'hazard-water-tank-wall-brace'
        wallBraceGroup.add(new THREE.Mesh(wallBraceGeo, rustMat))
        wallBraceGroup.add(new THREE.Mesh(supplyWallSteelGeo, steelMat))
        wallBraceGroup.add(new THREE.Mesh(supplyWallTrimGeo, rustMat))
        supportGroup.add(wallBraceGroup)
      } else {
        supportGroup.add(new THREE.Mesh(supplyCeilingSteelGeo, steelMat))
        supportGroup.add(new THREE.Mesh(supplyCeilingTrimGeo, rustMat))
      }
      tankMountGroup.add(supportGroup)

      // 2. Deteriorated horizontal industrial water tank body (composite multi-part assembly)
      const tankGroup = new THREE.Group()
      tankGroup.name = 'hazard-water-tank-body'
      tankGroup.position.set(0, tankRestY, 0)

      tankGroup.add(new THREE.Mesh(tankHullGeo, steelMat))
      tankGroup.add(new THREE.Mesh(tankTrimGeo, rustMat))

      // Subtle corroded lower-front seam patch indicating weakened weld
      const rustPatch = new THREE.Mesh(rustPatchGeo, rustMat)
      rustPatch.position.set(-0.08, -0.25, 0.31)
      rustPatch.rotation.x = 0.56
      tankGroup.add(rustPatch)

      const seamMesh = new THREE.Mesh(seamGeo, seamMat)
      seamMesh.position.set(-0.08, -0.285, 0.325)
      seamMesh.rotation.x = 0.56
      tankGroup.add(seamMesh)

      tankMountGroup.add(tankGroup)

      // 3. Bounded leaking water droplets & thin leak streams (6 droplets + 2 streams)
      const leakGroup = new THREE.Group()
      leakGroup.name = 'hazard-water-tank-leaks'
      const leakDrops = []
      const leakDropConfigs = []
      const MAX_LEAK_DROPS = 6
      for (let i = 0; i < MAX_LEAK_DROPS; i += 1) {
        leakDropConfigs.push({
          x: i === 0 ? -0.14 : -0.3 + i * 0.11,
          z: i === 0 ? 0.29 : 0.24 + (i % 2) * 0.12,
          startY: tankRestY - 0.34,
          phase: (i * 0.31) % 1,
          speed: 1.35 + (i % 3) * 0.28,
        })
        const drop = new THREE.Mesh(dropGeo, leakMat)
        drop.scale.set(0.56, 1.12, 0.56)
        leakGroup.add(drop)
        leakDrops.push(drop)
      }
      const leakStreams = []
      for (const sx of [-0.18, 0.1]) {
        const stream = new THREE.Mesh(streamGeo, leakMat)
        stream.position.set(sx, 1.08, 0.29)
        stream.scale.set(1, 2.04, 1)
        stream.visible = false
        leakGroup.add(stream)
        leakStreams.push(stream)
      }
      tankMountGroup.add(leakGroup)

      // 4. Bounded fallen bracket/metal fragments (4 pieces staying inside cell bounds)
      const tankDebrisGroup = new THREE.Group()
      tankDebrisGroup.name = 'hazard-water-tank-debris'
      tankDebrisGroup.visible = false
      const tankDebrisMeshes = []
      const tankDebrisConfigs = [
        {
          startX: -0.44,
          startY: 2.38,
          startZ: 0.05,
          endX: Math.max(-1.62, Math.min(1.62, sideSign * 0.56 - 0.24)),
          endZ: 0.24,
          clearX: sideSign * (WATER_TANK_CONSTANTS.clearedLocalX - 0.22),
          clearZ: 0.14,
          arcH: 0.28,
          rotY: 0.6,
        },
        {
          startX: 0.44,
          startY: 2.4,
          startZ: 0.05,
          endX: Math.max(-1.62, Math.min(1.62, sideSign * 0.96)),
          endZ: 0.42,
          clearX: sideSign * (WATER_TANK_CONSTANTS.clearedLocalX - 0.14),
          clearZ: 0.3,
          arcH: 0.34,
          rotY: -0.9,
        },
        {
          startX: -0.16,
          startY: 2.18,
          startZ: 0.26,
          endX: Math.max(-1.62, Math.min(1.62, sideSign * 0.46)),
          endZ: 0.58,
          clearX: sideSign * (WATER_TANK_CONSTANTS.clearedLocalX - 0.24),
          clearZ: 0.22,
          arcH: 0.22,
          rotY: 1.4,
        },
        {
          startX: 0.24,
          startY: 2.22,
          startZ: 0.22,
          endX: Math.max(-1.62, Math.min(1.62, sideSign * 1.14)),
          endZ: -0.88,
          clearX: sideSign * (WATER_TANK_CONSTANTS.clearedLocalX - 0.12),
          clearZ: -0.82,
          arcH: 0.24,
          rotY: -1.7,
        },
      ]
      for (let i = 0; i < tankDebrisConfigs.length; i += 1) {
        const frag = new THREE.Mesh(debrisGeo, i % 2 === 0 ? rustMat : steelMat)
        tankDebrisGroup.add(frag)
        tankDebrisMeshes.push(frag)
      }
      tankMountGroup.add(tankDebrisGroup)

      // 5. Controlled directional water surge wave (sheet + leading wave crest + 8 bounded spray droplets)
      const surgeGroup = new THREE.Group()
      surgeGroup.name = 'hazard-water-tank-surge'
      surgeGroup.visible = false

      const surgeSheetMesh = new THREE.Mesh(surgeSheetGeo, surgeMat)
      surgeSheetMesh.rotation.x = -Math.PI * 0.5
      surgeSheetMesh.position.set(0, 0.024, 0)
      surgeGroup.add(surgeSheetMesh)

      const crestMesh = new THREE.Mesh(crestGeo, surgeMat)
      crestMesh.rotation.z = Math.PI * 0.5
      crestMesh.position.set(0, 0.09, 0.35)
      crestMesh.scale.set(1, Math.min(1.82, surgeHalfWidth * 1.65), 1)
      surgeGroup.add(crestMesh)

      const sprayMeshes = []
      const sprayConfigs = []
      const MAX_SPRAY = 8
      for (let i = 0; i < MAX_SPRAY; i += 1) {
        const lane = -0.8 + (i / (MAX_SPRAY - 1)) * 1.6
        sprayConfigs.push({
          startX: lane * 0.36,
          endX: Math.max(-1.5, Math.min(1.5, lane * surgeHalfWidth * 0.84)),
          reachZ: 0.48 + ((i * 3 + 1) % MAX_SPRAY) / MAX_SPRAY * (surgeLength - 0.52),
          arcH: 0.22 + (i % 3) * 0.12,
          baseScale: 0.72 + (i % 3) * 0.2,
        })
        const sp = new THREE.Mesh(sprayGeo, leakMat)
        surgeGroup.add(sp)
        sprayMeshes.push(sp)
      }
      tankMountGroup.add(surgeGroup)

      // 6. Permanent flooded / wet reflective floor slick bounded strictly within corridor walls
      const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat)
      puddleMesh.rotation.x = -Math.PI * 0.5
      puddleMesh.position.set(0, 0.012, 0.12)
      puddleMesh.visible = false
      tankMountGroup.add(puddleMesh)

      root.userData = {
        hazardType: type,
        mountType,
        wallSide,
        tankYaw,
        sideSign,
        surgeLength,
        surgeHalfWidth,
        tankRestY,
        tankFallenY,
        ceilingAnchorY,
        strapRestY,
        isAftermathCleared: false,
        tankMountGroup,
        supportGroup,
        wallBraceGroup,
        brokenStraps,
        tankGroup,
        seamMesh,
        leakGroup,
        leakDrops,
        leakDropConfigs,
        leakStreams,
        tankDebrisGroup,
        tankDebrisMeshes,
        tankDebrisConfigs,
        surgeGroup,
        surgeSheetMesh,
        crestMesh,
        sprayMeshes,
        sprayConfigs,
        puddleMesh,
        leakMat,
        surgeMat,
        puddleMat,
      }
      break
    }

    case HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY: {
      const assets = getSuspendedMachinerySharedAssets(hazardData.qualityPreset || 'high')
      const mountType = hazardData.mountType || 'ceiling_gantry_rail'
      const ceilingStructureType = hazardData.ceilingStructureType || 'rib_hanger'
      const ceilingBeamY = Number.isFinite(hazardData.ceilingBeamY)
        ? hazardData.ceilingBeamY
        : ceilingStructureType === 'girder_saddle' || ceilingStructureType === 'cross_girder_saddle'
          ? 3.04
          : 3.38
      const machineryYaw = Number.isFinite(hazardData.machineryYaw) ? hazardData.machineryYaw : 0
      const sideSign =
        Number.isFinite(hazardData.sideSign) && hazardData.sideSign !== 0
          ? Math.sign(hazardData.sideSign)
          : 1
      const hasSideWall = Boolean(hazardData.hasSideWall)
      const machineryRestY = Number.isFinite(hazardData.machineryRestY)
        ? hazardData.machineryRestY
        : SUSPENDED_MACHINERY_CONSTANTS.machineryRestY
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : SUSPENDED_MACHINERY_CONSTANTS.ceilingAnchorY
      const pivotY = assets.pivotY
      const restDropY = machineryRestY - pivotY
      const fallenY = SUSPENDED_MACHINERY_CONSTANTS.fallenY
      const impactLocalZ = SUSPENDED_MACHINERY_CONSTANTS.impactLocalZ
      const fallenLocalX = sideSign * SUSPENDED_MACHINERY_CONSTANTS.fallenLocalX
      const fallenLocalZ = SUSPENDED_MACHINERY_CONSTANTS.fallenLocalZ
      const fallenRy = Number.isFinite(hazardData.aftermathYawOffset)
        ? hazardData.aftermathYawOffset
        : sideSign * SUSPENDED_MACHINERY_CONSTANTS.fallenRy
      const clearedLocalX = Number.isFinite(hazardData.clearedLocalX)
        ? hazardData.clearedLocalX
        : sideSign *
          (hasSideWall
            ? SUSPENDED_MACHINERY_CONSTANTS.clearedLocalX
            : SUSPENDED_MACHINERY_CONSTANTS.clearedOpenLocalX)
      const clearedLocalZ = Number.isFinite(hazardData.clearedLocalZ)
        ? hazardData.clearedLocalZ
        : hasSideWall
          ? SUSPENDED_MACHINERY_CONSTANTS.clearedLocalZ
          : SUSPENDED_MACHINERY_CONSTANTS.clearedOpenLocalZ
      const clearedRy = sideSign * SUSPENDED_MACHINERY_CONSTANTS.clearedRy

      const machineryMountGroup = new THREE.Group()
      machineryMountGroup.name = `hazard-suspended-machinery-${mountType}`
      machineryMountGroup.rotation.y = machineryYaw
      root.add(machineryMountGroup)

      // Instance-owned impact dust material so each crash fades independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.machineryDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Structural Overhead Steel Gantry I-Beam & Ceiling Girder/Rib Hangers + Wall Corbels
      const gantryGroup = new THREE.Group()
      gantryGroup.name = 'hazard-machinery-gantry'

      const railGeo = mountType === 'wall_to_wall_gantry' ? assets.railWallGeo : assets.railCeilGeo
      const railMesh = new THREE.Mesh(railGeo, assets.darkSteelMat)
      railMesh.name = 'machinery-gantry-rail'
      gantryGroup.add(railMesh)

      const hangerGeoMap = {
        girder_saddle: assets.girderSaddleGeo,
        rib_hanger: assets.ribHangerGeo,
        cross_girder_saddle: assets.crossGirderSaddleGeo,
        cross_rib_truss: assets.crossRibTrussGeo,
      }
      const ceilingHangerGroup = new THREE.Mesh(
        hangerGeoMap[ceilingStructureType] || assets.ribHangerGeo,
        assets.darkSteelMat
      )
      ceilingHangerGroup.name = `machinery-ceiling-hanger-${ceilingStructureType}`
      gantryGroup.add(ceilingHangerGroup)

      let wallBracketsGroup = null
      if (mountType === 'wall_to_wall_gantry') {
        wallBracketsGroup = new THREE.Mesh(assets.wallCorbelGeo, assets.rustMat)
        wallBracketsGroup.name = 'hazard-machinery-wall-brackets'
        gantryGroup.add(wallBracketsGroup)
      }

      // Wheeled hoist trolley carriage gripping lower I-beam flange
      const trolleyGroup = new THREE.Group()
      trolleyGroup.name = 'hazard-machinery-trolley'
      trolleyGroup.position.set(0, pivotY, 0)
      const trolleyMesh = new THREE.Mesh(assets.trolleyGeo, assets.darkSteelMat)
      trolleyGroup.add(trolleyMesh)
      gantryGroup.add(trolleyGroup)

      // Top-pivoted upper hoist cables anchored to trolley sheaves
      const rearCable = new THREE.Mesh(assets.topCableGeo, assets.cableMat)
      rearCable.name = 'machinery-rear-cable'
      rearCable.position.set(0, pivotY - 0.12, -0.22)
      gantryGroup.add(rearCable)

      const frontCable = new THREE.Mesh(assets.topCableGeo, assets.cableMat)
      frontCable.name = 'machinery-front-cable'
      frontCable.position.set(0, pivotY - 0.12, 0.22)
      gantryGroup.add(frontCable)

      machineryMountGroup.add(gantryGroup)

      // 2. Heavy Suspended Industrial Motor / Pump / Gearbox Unit (shared facility materials, no yellow bumper)
      const machinePivotGroup = new THREE.Group()
      machinePivotGroup.name = 'hazard-machinery-pivot'
      machinePivotGroup.position.set(0, pivotY, 0)

      const machineBodyGroup = new THREE.Group()
      machineBodyGroup.name = 'hazard-machinery-unit'
      machineBodyGroup.rotation.order = 'YXZ'
      machineBodyGroup.position.set(0, restDropY, 0)

      const housingMesh = new THREE.Mesh(assets.unitHousingGeo, assets.housingMat)
      machineBodyGroup.add(housingMesh)
      const skidMesh = new THREE.Mesh(assets.unitSkidGeo, assets.darkSteelMat)
      machineBodyGroup.add(skidMesh)
      const trimMesh = new THREE.Mesh(assets.unitTrimGeo, assets.rustMat)
      machineBodyGroup.add(trimMesh)

      // Lower cable stubs bolted to lifting shackles (revealed seamlessly when upper cables snap)
      const rearCableStub = new THREE.Mesh(assets.stubCableGeo, assets.cableMat)
      rearCableStub.name = 'machinery-rear-cable-stub'
      rearCableStub.position.set(0, 0.265, -0.22)
      rearCableStub.visible = false
      machineBodyGroup.add(rearCableStub)

      const frontCableStub = new THREE.Mesh(assets.stubCableGeo, assets.cableMat)
      frontCableStub.name = 'machinery-front-cable-stub'
      frontCableStub.position.set(0, 0.265, 0.22)
      frontCableStub.visible = false
      machineBodyGroup.add(frontCableStub)

      machinePivotGroup.add(machineBodyGroup)
      machineryMountGroup.add(machinePivotGroup)

      // 3. Bounded Warning Loose Bolts & Metal Shavings (6 falling particles)
      const warnBoltGroup = new THREE.Group()
      warnBoltGroup.name = 'hazard-machinery-warning-bolts'
      warnBoltGroup.visible = false
      const warnBoltMeshes = []
      const warnBoltConfigs = []
      const MAX_WARN_BOLTS = 6
      for (let i = 0; i < MAX_WARN_BOLTS; i += 1) {
        warnBoltConfigs.push({
          x: -0.34 + i * 0.136,
          z: -0.18 + (i % 3) * 0.2,
          startY: pivotY - 0.1 - (i % 2) * 0.32,
          phase: (i * 0.31) % 1,
          speed: 1.45 + (i % 3) * 0.32,
        })
        const bolt = new THREE.Mesh(
          assets.warnBoltGeo,
          i % 2 === 0 ? assets.rustMat : assets.cableMat
        )
        warnBoltGroup.add(bolt)
        warnBoltMeshes.push(bolt)
      }
      machineryMountGroup.add(warnBoltGroup)

      // 4. Bounded Impact Metal Debris (6 sheared brackets/castings settling around fallen hull & tucked when cleared)
      const impactDebrisGroup = new THREE.Group()
      impactDebrisGroup.name = 'hazard-machinery-debris'
      impactDebrisGroup.visible = false
      const impactDebrisMeshes = []
      const impactDebrisConfigs = []
      const MAX_IMPACT_DEBRIS = 6
      for (let i = 0; i < MAX_IMPACT_DEBRIS; i += 1) {
        const angle = (i / MAX_IMPACT_DEBRIS) * Math.PI * 2 + 0.35
        const dist = 0.42 + (i % 3) * 0.15
        const rawEndX = fallenLocalX + Math.cos(angle) * dist * 0.72
        const rawEndZ = fallenLocalZ + Math.sin(angle) * dist * 0.85
        const clampedEndX = Math.max(-1.78, Math.min(1.78, rawEndX))
        const clampedEndZ = Math.max(-1.72, Math.min(1.72, rawEndZ))
        const clampedClearX = Math.max(
          -1.82,
          Math.min(1.82, clearedLocalX - sideSign * (0.12 + (i % 3) * 0.08))
        )
        const clampedClearZ = Math.max(
          -1.7,
          Math.min(1.7, clearedLocalZ + ((i - 2.5) * 0.18))
        )
        impactDebrisConfigs.push({
          startX: sideSign * 0.35 + (i % 2 === 0 ? -0.18 : 0.18),
          startY: 0.9 + (i % 2) * 0.45,
          startZ: 0.34,
          endX: clampedEndX,
          endZ: clampedEndZ,
          clearX: clampedClearX,
          clearZ: clampedClearZ,
          arcH: 0.22 + (i % 3) * 0.1,
          rotY: angle + 0.6,
        })
        const frag = new THREE.Mesh(
          assets.impactFragGeo,
          i % 3 === 0 ? assets.darkSteelMat : i % 2 === 0 ? assets.rustMat : assets.housingMat
        )
        impactDebrisGroup.add(frag)
        impactDebrisMeshes.push(frag)
      }
      machineryMountGroup.add(impactDebrisGroup)

      // 5. Bounded Impact Dust Cloud (6 translucent spheres billowing around crash zone)
      const impactDustGroup = new THREE.Group()
      impactDustGroup.name = 'hazard-machinery-dust'
      impactDustGroup.visible = false
      const impactDustMeshes = []
      const impactDustConfigs = []
      const MAX_MACH_DUST = 6
      for (let i = 0; i < MAX_MACH_DUST; i += 1) {
        const angle = (i / MAX_MACH_DUST) * Math.PI * 2
        impactDustConfigs.push({
          dx: fallenLocalX + Math.cos(angle) * (0.38 + (i % 2) * 0.24),
          dz: impactLocalZ + Math.sin(angle) * (0.42 + (i % 2) * 0.24),
          riseY: 0.42 + (i % 3) * 0.22,
          baseScale: 0.72 + (i % 3) * 0.22,
        })
        const puff = new THREE.Mesh(assets.machDustGeo, dustMat)
        impactDustGroup.add(puff)
        impactDustMeshes.push(puff)
      }
      machineryMountGroup.add(impactDustGroup)

      root.userData = {
        hazardType: type,
        mountType,
        ceilingStructureType,
        ceilingBeamY,
        sideSign,
        hasSideWall,
        machineryYaw,
        machineryRestY,
        ceilingAnchorY,
        pivotY,
        restDropY,
        fallenY,
        impactLocalZ,
        fallenLocalX,
        fallenLocalZ,
        fallenRy,
        clearedLocalX,
        clearedLocalZ,
        clearedRy,
        isAftermathCleared: false,
        machineryMountGroup,
        gantryGroup,
        ceilingHangerGroup,
        wallBracketsGroup,
        trolleyGroup,
        rearCable,
        frontCable,
        rearCableStub,
        frontCableStub,
        machinePivotGroup,
        machineBodyGroup,
        warnBoltGroup,
        warnBoltMeshes,
        warnBoltConfigs,
        impactDebrisGroup,
        impactDebrisMeshes,
        impactDebrisConfigs,
        impactDustGroup,
        impactDustMeshes,
        impactDustConfigs,
        dustMat,
      }
      break
    }

    case HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE: {
      const assets = getVentilationDuctSharedAssets(hazardData.qualityPreset || 'high')
      const mountType = hazardData.mountType || 'ceiling_duct_run'
      const ceilingStructureType = hazardData.ceilingStructureType || 'cross_rib_truss'
      const ceilingBeamY = Number.isFinite(hazardData.ceilingBeamY)
        ? hazardData.ceilingBeamY
        : ceilingStructureType === 'girder_saddle' ||
            ceilingStructureType === 'cross_girder_saddle' ||
            ceilingStructureType === 'girder_intersection'
          ? MAZE_CEILING_CONFIG.beamBottomY
          : MAZE_CEILING_CONFIG.ribBottomY
      const ductYaw = Number.isFinite(hazardData.ductYaw) ? hazardData.ductYaw : 0
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : VENTILATION_DUCT_CONSTANTS.ceilingAnchorY
      const hangerPivotY = Number.isFinite(hazardData.hangerPivotY)
        ? hazardData.hangerPivotY
        : ceilingStructureType === 'girder_saddle' ||
            ceilingStructureType === 'girder_intersection'
          ? 3.035
          : ceilingAnchorY
      const ductRestY = Number.isFinite(hazardData.ductRestY)
        ? hazardData.ductRestY
        : ceilingBeamY <= MAZE_CEILING_CONFIG.beamBottomY + 0.01
          ? VENTILATION_DUCT_CONSTANTS.ductRestYGirder
          : ceilingBeamY <= MAZE_CEILING_CONFIG.ribBottomY + 0.01
            ? VENTILATION_DUCT_CONSTANTS.ductRestYRib
            : VENTILATION_DUCT_CONSTANTS.ductRestYSoffit
      const sideSign =
        Number.isFinite(hazardData.sideSign) && hazardData.sideSign !== 0
          ? Math.sign(hazardData.sideSign)
          : 1
      const hasSideWall = Boolean(hazardData.hasSideWall)
      const ductWidth = assets.ductWidth
      const ductHeight = assets.ductHeight
      const ductLen = assets.ductLen
      const hangerZ = assets.hangerZ
      const hangerHalfX = assets.hangerHalfX
      const pivotZ = VENTILATION_DUCT_CONSTANTS.pivotZ
      const bodyOffsetZ = VENTILATION_DUCT_CONSTANTS.bodyOffsetZ
      const fallenY = Number.isFinite(hazardData.fallenY)
        ? hazardData.fallenY
        : VENTILATION_DUCT_CONSTANTS.fallenY
      const impactLocalZ = VENTILATION_DUCT_CONSTANTS.impactLocalZ
      const fallenLocalX = sideSign * VENTILATION_DUCT_CONSTANTS.fallenLocalX
      const fallenLocalZ = VENTILATION_DUCT_CONSTANTS.fallenLocalZ
      const fallenRy = Number.isFinite(hazardData.aftermathYawOffset)
        ? hazardData.aftermathYawOffset
        : sideSign * VENTILATION_DUCT_CONSTANTS.fallenRy
      const clearedLocalX = Number.isFinite(hazardData.clearedLocalX)
        ? hazardData.clearedLocalX
        : sideSign *
          (hasSideWall
            ? VENTILATION_DUCT_CONSTANTS.clearedLocalX
            : VENTILATION_DUCT_CONSTANTS.clearedOpenLocalX)
      const clearedLocalZ = Number.isFinite(hazardData.clearedLocalZ)
        ? hazardData.clearedLocalZ
        : hasSideWall
          ? VENTILATION_DUCT_CONSTANTS.clearedLocalZ
          : VENTILATION_DUCT_CONSTANTS.clearedOpenLocalZ
      const clearedRy = sideSign * VENTILATION_DUCT_CONSTANTS.clearedRy

      const ductMountGroup = new THREE.Group()
      ductMountGroup.name = 'ventilation-duct-mount'
      ductMountGroup.rotation.y = ductYaw
      root.add(ductMountGroup)

      const { galvMat, hardwareMat, cavityMat, ductRustMat } = assets

      // 1. Fixed overhead plenum connector stubs, concrete-mounted saddles/plates, & trapeze hangers
      const ceilingRigGroup = new THREE.Group()
      ceilingRigGroup.name = 'duct-ceiling-rig'

      // Rear fixed plenum stub + dark open throat + drive-cleat flange
      const rearStub = new THREE.Mesh(assets.stubGeo, galvMat)
      rearStub.position.set(0, ductRestY, -1.16)
      ceilingRigGroup.add(rearStub)

      const rearFlange = new THREE.Mesh(assets.flangeGeo, hardwareMat)
      rearFlange.position.set(0, ductRestY, -0.92)
      ceilingRigGroup.add(rearFlange)

      const rearThroat = new THREE.Mesh(assets.throatGeo, cavityMat)
      rearThroat.position.set(0, ductRestY, -0.915)
      ceilingRigGroup.add(rearThroat)

      // Front fixed plenum stub + dark open throat + drive-cleat flange
      const frontStub = new THREE.Mesh(assets.stubGeo, galvMat)
      frontStub.position.set(0, ductRestY, 1.16)
      ceilingRigGroup.add(frontStub)

      const frontFlange = new THREE.Mesh(assets.flangeGeo, hardwareMat)
      frontFlange.position.set(0, ductRestY, 0.92)
      ceilingRigGroup.add(frontFlange)

      const frontThroat = new THREE.Mesh(assets.throatGeo, cavityMat)
      frontThroat.position.set(0, ductRestY, 0.915)
      ceilingRigGroup.add(frontThroat)

      // Optional rear wall bulkhead collar when backed by a maze wall
      let wallBulkheadGroup = null
      if (mountType === 'wall_bulkhead_duct') {
        wallBulkheadGroup = new THREE.Group()
        wallBulkheadGroup.name = 'duct-wall-bulkhead'
        const collar = new THREE.Mesh(assets.bulkheadCollarGeo, hardwareMat)
        collar.position.set(0, ductRestY, -1.94)
        wallBulkheadGroup.add(collar)

        const connector = new THREE.Mesh(assets.bulkheadConnectorGeo, galvMat)
        connector.position.set(0, ductRestY, -1.65)
        wallBulkheadGroup.add(connector)

        ceilingRigGroup.add(wallBulkheadGroup)
      }

      // Structure-specific overhead concrete girder/rib/soffit saddles & plates
      const ceilingSaddleMesh = new THREE.Mesh(
        assets.rigGeos[ceilingStructureType] || assets.rigGeos.cross_rib_truss,
        hardwareMat
      )
      ceilingSaddleMesh.name = `duct-ceiling-saddle-${ceilingStructureType}`
      ceilingRigGroup.add(ceilingSaddleMesh)

      const cradleY = ductRestY - assets.cradleDropOffset
      const rodHeight = Math.max(0.12, hangerPivotY - cradleY)

      // Rear trapeze hanger (remains overhead, slight strain bend on collapse)
      const rearHangerGroup = new THREE.Group()
      rearHangerGroup.name = 'duct-rear-hanger'
      rearHangerGroup.position.set(0, hangerPivotY, -hangerZ)
      for (const side of [-1, 1]) {
        const rod = new THREE.Mesh(assets.unitRodGeo, hardwareMat)
        rod.scale.set(1, rodHeight, 1)
        rod.position.set(side * hangerHalfX, -rodHeight * 0.5, 0)
        rearHangerGroup.add(rod)
      }
      const rearCradle = new THREE.Mesh(assets.cradleGeo, hardwareMat)
      rearCradle.position.set(0, -rodHeight, 0)
      rearHangerGroup.add(rearCradle)
      ceilingRigGroup.add(rearHangerGroup)

      // Front trapeze hanger (corroded — loosens during warning and snaps loose on collapse)
      const frontHangerGroup = new THREE.Group()
      frontHangerGroup.name = 'duct-front-hanger'
      frontHangerGroup.position.set(0, hangerPivotY, hangerZ)
      for (const side of [-1, 1]) {
        const rod = new THREE.Mesh(assets.unitRodGeo, side > 0 ? ductRustMat : hardwareMat)
        rod.scale.set(1, rodHeight, 1)
        rod.position.set(side * hangerHalfX, -rodHeight * 0.5, 0)
        frontHangerGroup.add(rod)
      }
      const frontCradle = new THREE.Mesh(assets.cradleGeo, ductRustMat)
      frontCradle.position.set(0, -rodHeight, 0)
      frontHangerGroup.add(frontCradle)
      ceilingRigGroup.add(frontHangerGroup)

      ductMountGroup.add(ceilingRigGroup)

      // 2. Collapsible rectangular galvanized ventilation duct section
      const ductPivotGroup = new THREE.Group()
      ductPivotGroup.name = 'ventilation-duct-pivot'
      ductPivotGroup.position.set(0, ductRestY, pivotZ)

      const ductBodyGroup = new THREE.Group()
      ductBodyGroup.name = 'ventilation-duct-body'
      ductBodyGroup.rotation.order = 'YXZ'
      ductBodyGroup.position.set(0, 0, bodyOffsetZ)

      // Keep mainDuct as children[0] with galvMat (pooled buildCeilingVents galvanized textures)
      const mainDuct = new THREE.Mesh(assets.mainDuctGeo, galvMat)
      ductBodyGroup.add(mainDuct)

      // End & center standing-seam drive-cleat flange collars
      for (const fz of [-ductLen * 0.5 + 0.025, 0, ductLen * 0.5 - 0.025]) {
        const fMesh = new THREE.Mesh(assets.flangeGeo, fz > 0 ? ductRustMat : hardwareMat)
        fMesh.position.set(0, 0, fz)
        ductBodyGroup.add(fMesh)
      }

      // Dark hollow duct end-caps so detached section reads as a hollow ventilation trunk
      for (const ez of [-ductLen * 0.5 - 0.002, ductLen * 0.5 + 0.002]) {
        const endVoid = new THREE.Mesh(assets.throatGeo, cavityMat)
        endVoid.position.set(0, 0, ez)
        ductBodyGroup.add(endVoid)
      }

      // Corroded stress seam patch near front joint
      const rustSeam = new THREE.Mesh(assets.rustSeamGeo, ductRustMat)
      rustSeam.position.set(0, 0, 0.62)
      ductBodyGroup.add(rustSeam)

      // Bottom recessed industrial intake grille with dark soot cavity + louver slats
      const grilleFrame = new THREE.Mesh(assets.grilleFrameGeo, hardwareMat)
      grilleFrame.position.set(0, -ductHeight * 0.5 - 0.01, 0.12)
      ductBodyGroup.add(grilleFrame)

      const grilleBack = new THREE.Mesh(assets.grilleBackGeo, cavityMat)
      grilleBack.position.set(0, -ductHeight * 0.5 - 0.016, 0.12)
      ductBodyGroup.add(grilleBack)

      for (let lv = 0; lv < 5; lv += 1) {
        const slat = new THREE.Mesh(assets.louverGeo, hardwareMat)
        slat.position.set(0, -ductHeight * 0.5 - 0.023, -0.08 + lv * 0.1)
        slat.rotation.x = 0.42
        ductBodyGroup.add(slat)
      }

      ductPivotGroup.add(ductBodyGroup)
      ductMountGroup.add(ductPivotGroup)

      // 3. Warning loose sheet-metal screws/rivets (6 bounded)
      const warnScrewGroup = new THREE.Group()
      warnScrewGroup.name = 'duct-warning-screws'
      warnScrewGroup.visible = false
      const warnScrewMeshes = []
      const warnScrewConfigs = []
      for (let i = 0; i < 6; i += 1) {
        warnScrewConfigs.push({
          x: (i % 2 === 0 ? -1 : 1) * (0.26 + (i % 3) * 0.05),
          z: 0.36 + (i % 3) * 0.24 - 0.12,
          startY: ductRestY - 0.14,
          speed: 1.55 + (i % 3) * 0.3,
          phase: i * 0.16,
        })
        const screw = new THREE.Mesh(assets.screwGeo, i % 2 === 0 ? hardwareMat : ductRustMat)
        warnScrewGroup.add(screw)
        warnScrewMeshes.push(screw)
      }
      ductMountGroup.add(warnScrewGroup)

      // 4. Warning sifting ceiling/joint dust (5 bounded, instance-owned material)
      const warnDustGroup = new THREE.Group()
      warnDustGroup.name = 'duct-warning-dust'
      warnDustGroup.visible = false
      const warnDustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.ductDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const warnDustMeshes = []
      const warnDustConfigs = []
      for (let i = 0; i < 5; i += 1) {
        warnDustConfigs.push({
          x: ((i % 3) - 1) * 0.24,
          z: 0.24 + (i % 4) * 0.22,
          startY: ductRestY - 0.12,
          speed: 0.95 + (i % 3) * 0.22,
          phase: i * 0.2,
          baseScale: 0.52 + (i % 2) * 0.18,
        })
        const puff = new THREE.Mesh(assets.ductDustGeo, warnDustMat)
        warnDustGroup.add(puff)
        warnDustMeshes.push(puff)
      }
      ductMountGroup.add(warnDustGroup)

      // 5. Impact sheared sheet-metal louvers & bracket shards (6 bounded; relocate cleanly when cleared)
      const ductDebrisGroup = new THREE.Group()
      ductDebrisGroup.name = 'duct-impact-debris'
      ductDebrisGroup.visible = false
      const ductDebrisMeshes = []
      const ductDebrisConfigs = []
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2 + 0.35
        const radius = 0.48 + (i % 3) * 0.16
        const rawEndX = fallenLocalX + Math.cos(angle) * radius * 0.65
        const rawEndZ = fallenLocalZ + Math.sin(angle) * radius * 0.88
        const clampedEndX = Math.max(-1.82, Math.min(1.82, rawEndX))
        const clampedEndZ = Math.max(-1.74, Math.min(1.74, rawEndZ))
        const clampedClearX = Math.max(
          -1.84,
          Math.min(1.84, clearedLocalX - sideSign * (0.1 + (i % 3) * 0.08))
        )
        const clampedClearZ = Math.max(
          -1.68,
          Math.min(1.68, clearedLocalZ + (i - 2.5) * 0.24)
        )
        ductDebrisConfigs.push({
          startX: sideSign * 0.25 + Math.cos(angle) * 0.18,
          startY: 0.42,
          startZ: impactLocalZ + Math.sin(angle) * 0.25,
          endX: clampedEndX,
          endZ: clampedEndZ,
          clearX: clampedClearX,
          clearZ: clampedClearZ,
          arcH: 0.26 + (i % 3) * 0.12,
          rotY: angle * 1.4,
        })
        const shard = new THREE.Mesh(assets.shardGeo, i % 2 === 0 ? galvMat : hardwareMat)
        ductDebrisGroup.add(shard)
        ductDebrisMeshes.push(shard)
      }
      ductMountGroup.add(ductDebrisGroup)

      // 6. Impact billowing dust cloud (6 bounded, instance-owned material)
      const ductImpactDustGroup = new THREE.Group()
      ductImpactDustGroup.name = 'duct-impact-dust'
      ductImpactDustGroup.visible = false
      const ductImpactDustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.ductDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const ductImpactDustMeshes = []
      const ductImpactDustConfigs = []
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2 + 0.2
        ductImpactDustConfigs.push({
          dx: fallenLocalX * 0.35 + Math.cos(angle) * (0.44 + (i % 2) * 0.24),
          dz: impactLocalZ + Math.sin(angle) * (0.52 + (i % 2) * 0.28),
          riseY: 0.42 + (i % 3) * 0.2,
          baseScale: 0.74 + (i % 3) * 0.22,
        })
        const puff = new THREE.Mesh(assets.ductDustGeo, ductImpactDustMat)
        ductImpactDustGroup.add(puff)
        ductImpactDustMeshes.push(puff)
      }
      ductMountGroup.add(ductImpactDustGroup)

      root.userData = {
        hazardType: type,
        mountType,
        ceilingStructureType,
        ceilingBeamY,
        hangerPivotY,
        sideSign,
        hasSideWall,
        ductYaw,
        ductRestY,
        ceilingAnchorY,
        ductWidth,
        ductHeight,
        ductLen,
        hangerZ,
        pivotZ,
        bodyOffsetZ,
        fallenY,
        impactLocalZ,
        fallenLocalX,
        fallenLocalZ,
        fallenRy,
        clearedLocalX,
        clearedLocalZ,
        clearedRy,
        isAftermathCleared: false,
        ductMountGroup,
        ceilingRigGroup,
        ceilingSaddleMesh,
        wallBulkheadGroup,
        rearHangerGroup,
        frontHangerGroup,
        ductPivotGroup,
        ductBodyGroup,
        warnScrewGroup,
        warnScrewMeshes,
        warnScrewConfigs,
        warnDustGroup,
        warnDustMeshes,
        warnDustConfigs,
        warnDustMat,
        ductDebrisGroup,
        ductDebrisMeshes,
        ductDebrisConfigs,
        ductImpactDustGroup,
        ductImpactDustMeshes,
        ductImpactDustConfigs,
        ductImpactDustMat,
      }
      break
    }

    default:
      throw new Error(`Unsupported hazard type: ${type}`)
  }

  root.traverse((node) => {
    if (node.isMesh) {
      node.receiveShadow = true
    }
  })

  return root
}

/**
 * Updates hazard visual state (dormant, warning, active) based on its cycle phase.
 */
export function updateHazardVisualState(hazardRoot, state = 'dormant', progress = 0) {
  if (!hazardRoot?.userData) return

  const data = hazardRoot.userData
  const type = data.hazardType

  switch (type) {
    case HAZARD_TYPES.CEILING_COLLAPSE: {
      const {
        soffitY = MAZE_CEILING_CONFIG.soffitY,
        activeDuration = 1.2,
        ceilingSoffitRimMesh,
        ceilingCrackGroup,
        ceilingCrackMeshes,
        ceilingCrackConfigs,
        ceilingCavityGroup,
        rubbleGroup,
        ceilingDebrisMeshes,
        ceilingDebrisConfigs,
        ceilingWarnPebbleGroup,
        ceilingWarnPebbles,
        ceilingWarnPebbleConfigs,
        ceilingDustGroup,
        ceilingDustMeshes,
        ceilingDustConfigs,
        ceilingDustMat,
      } = data
      if (!ceilingDebrisMeshes || !ceilingDebrisConfigs) return

      const clamped = Math.max(0, Math.min(1, progress))

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        const isCleared = Boolean(data.isAftermathCleared)
        if (ceilingSoffitRimMesh) ceilingSoffitRimMesh.visible = false
        if (rubbleGroup) rubbleGroup.visible = true
        if (ceilingCrackGroup) ceilingCrackGroup.visible = true
        if (ceilingCavityGroup) {
          ceilingCavityGroup.visible = true
          ceilingCavityGroup.scale.set(1, 1, 1)
        }
        if (ceilingCrackMeshes && ceilingCrackConfigs) {
          for (let i = 0; i < ceilingCrackMeshes.length; i += 1) {
            const cs = ceilingCrackConfigs[i]
            ceilingCrackMeshes[i].scale.set(cs.len * 1.18, 1, cs.w * 2.1)
          }
        }
        if (ceilingWarnPebbleGroup) ceilingWarnPebbleGroup.visible = false
        if (ceilingDustGroup) ceilingDustGroup.visible = false
        if (ceilingDustMat) ceilingDustMat.opacity = 0

        for (let i = 0; i < ceilingDebrisMeshes.length; i += 1) {
          const mesh = ceilingDebrisMeshes[i]
          const cfg = ceilingDebrisConfigs[i]
          mesh.castShadow = Boolean(cfg.castShadowEnabled)
          const manualState = mesh.userData?.manualState || 'fallen'
          if (
            manualState === 'picking_up' ||
            manualState === 'carried' ||
            manualState === 'placing' ||
            manualState === 'placed'
          ) {
            // Preserve manually handled / carried / placed rubble world transform
            mesh.scale.set(cfg.sx, cfg.sy, cfg.sz)
            continue
          }
          if (manualState === 'swept' || isCleared) {
            mesh.position.set(cfg.clearedX, cfg.clearedY, cfg.clearedZ)
            mesh.rotation.set(0.04, cfg.restRotY + 0.6, -0.04)
            mesh.scale.set(cfg.sx * 0.82, cfg.sy * 0.56, cfg.sz * 0.82)
          } else {
            mesh.position.set(cfg.restX, cfg.restY, cfg.restZ)
            mesh.rotation.set(cfg.restRotX, cfg.restRotY, cfg.restRotZ)
            mesh.scale.set(cfg.sx, cfg.sy, cfg.sz)
          }
        }
        break
      }

      if (state === 'active') {
        const tActive = clamped * activeDuration
        if (ceilingSoffitRimMesh) ceilingSoffitRimMesh.visible = false
        if (rubbleGroup) rubbleGroup.visible = true
        if (ceilingCrackGroup) ceilingCrackGroup.visible = true
        if (ceilingCavityGroup) {
          ceilingCavityGroup.visible = true
          ceilingCavityGroup.scale.set(1, 1, 1)
        }
        if (ceilingCrackMeshes && ceilingCrackConfigs) {
          const crackGain = 1.65 + clamped * 0.45
          for (let i = 0; i < ceilingCrackMeshes.length; i += 1) {
            const cs = ceilingCrackConfigs[i]
            ceilingCrackMeshes[i].scale.set(cs.len * (1.1 + clamped * 0.08), 1, cs.w * crackGain)
          }
        }
        if (ceilingWarnPebbleGroup) ceilingWarnPebbleGroup.visible = false

        let impactDustDrive = 0
        for (let i = 0; i < ceilingDebrisMeshes.length; i += 1) {
          const mesh = ceilingDebrisMeshes[i]
          const cfg = ceilingDebrisConfigs[i]
          mesh.castShadow = Boolean(cfg.castShadowEnabled)
          mesh.scale.set(cfg.sx, cfg.sy, cfg.sz)

          const t = tActive - cfg.detachDelay
          if (t <= 0) {
            // Seamlessly continues from warning end sag position (zero snap!)
            mesh.position.set(cfg.startX, cfg.sagY, cfg.startZ)
            mesh.rotation.set(0, cfg.startRotY, 0)
          } else if (t < cfg.tImpact) {
            // Continuous gravitational free-fall & angular tumble
            const u = t / cfg.tImpact
            const rx = cfg.spinX * t
            const ry = cfg.startRotY + cfg.spinY * t
            const rz = cfg.spinZ * t
            const minGroundY = computeMinGroundedCenterY(
              cfg.halfX,
              cfg.halfY,
              cfg.halfZ,
              rx,
              ry,
              rz
            )
            const y = Math.max(
              cfg.restY,
              minGroundY,
              cfg.sagY - cfg.v0Down * t - 0.5 * cfg.gravity * t * t
            )
            const x = cfg.startX + (cfg.impactX - cfg.startX) * u
            const z = cfg.startZ + (cfg.impactZ - cfg.startZ) * u
            mesh.position.set(x, y, z)
            mesh.rotation.set(rx, ry, rz)
          } else if (t < cfg.tImpact + cfg.tBounce) {
            // Damped single physical bounce & horizontal settle (strictly >= restY & minGroundY)
            const tb = t - cfg.tImpact
            const bFrac = cfg.tBounce > 1e-4 ? Math.min(1, tb / cfg.tBounce) : 1
            const easeOut = 1 - (1 - bFrac) * (1 - bFrac)
            const hopY = Math.max(0, cfg.vBounce * tb - 0.5 * cfg.gravity * tb * tb)
            const x = cfg.impactX + (cfg.restX - cfg.impactX) * easeOut
            const z = cfg.impactZ + (cfg.restZ - cfg.impactZ) * easeOut
            const fallRotX = cfg.spinX * cfg.tImpact
            const fallRotY = cfg.startRotY + cfg.spinY * cfg.tImpact
            const fallRotZ = cfg.spinZ * cfg.tImpact
            const rx = fallRotX + (cfg.restRotX - fallRotX) * easeOut
            const ry = fallRotY + (cfg.restRotY - fallRotY) * easeOut
            const rz = fallRotZ + (cfg.restRotZ - fallRotZ) * easeOut
            const minGroundY = computeMinGroundedCenterY(
              cfg.halfX,
              cfg.halfY,
              cfg.halfZ,
              rx,
              ry,
              rz
            )
            mesh.position.set(x, Math.max(cfg.restY, minGroundY) + hopY, z)
            mesh.rotation.set(rx, ry, rz)
            impactDustDrive = Math.max(impactDustDrive, 1 - bFrac * 0.45)
          } else {
            mesh.position.set(cfg.restX, cfg.restY, cfg.restZ)
            mesh.rotation.set(cfg.restRotX, cfg.restRotY, cfg.restRotZ)
            const postImpact = t - (cfg.tImpact + cfg.tBounce)
            if (postImpact < 0.45) {
              impactDustDrive = Math.max(impactDustDrive, Math.max(0, 1 - postImpact / 0.45) * 0.55)
            }
          }
        }

        // Localized low-lying dust plume blooms upon floor impact and dissipates cleanly
        if (ceilingDustGroup && ceilingDustMeshes && ceilingDustConfigs && ceilingDustMat) {
          const dustOpacity = Math.max(0, Math.min(0.42, impactDustDrive * 0.42))
          ceilingDustGroup.visible = dustOpacity > 0.01
          ceilingDustMat.opacity = dustOpacity
          if (ceilingDustGroup.visible) {
            const spreadT = Math.min(1, Math.max(0, (clamped - 0.36) / 0.58))
            const easeSpread = 1 - (1 - spreadT) * (1 - spreadT)
            for (let i = 0; i < ceilingDustMeshes.length; i += 1) {
              const puff = ceilingDustMeshes[i]
              const dc = ceilingDustConfigs[i]
              const px = dc.warnX + (dc.spreadX - dc.warnX) * easeSpread
              const pz = dc.warnZ + (dc.spreadZ - dc.warnZ) * easeSpread
              const py = dc.impactHeight + easeSpread * 0.36
              puff.position.set(px, py, pz)
              puff.scale.setScalar(dc.baseScale * (0.75 + easeSpread * 1.15))
            }
          }
        }
        break
      }

      if (state === 'warning') {
        // Smooth progressive fracture emergence out of the intact soffit (zero visual popping)
        const sagEase = clamped * clamped
        if (ceilingSoffitRimMesh) ceilingSoffitRimMesh.visible = false
        if (ceilingCrackGroup) ceilingCrackGroup.visible = clamped > 0.02
        if (ceilingCavityGroup) {
          ceilingCavityGroup.visible = clamped > 0.25
          if (ceilingCavityGroup.visible) {
            const cavT = Math.min(1, (clamped - 0.25) / 0.55)
            const cavScale = 0.32 + (1 - (1 - cavT) * (1 - cavT)) * 0.68
            ceilingCavityGroup.scale.set(cavScale, 1, cavScale)
          } else {
            ceilingCavityGroup.scale.set(1, 1, 1)
          }
        }
        if (ceilingCrackMeshes && ceilingCrackConfigs) {
          const crackGrow = Math.max(0, Math.min(1, (clamped - 0.02) / 0.28))
          const lenGain = 0.28 + crackGrow * 0.72 + clamped * 0.1
          const widthGain = 0.15 + crackGrow * 0.85 + clamped * 0.65
          for (let i = 0; i < ceilingCrackMeshes.length; i += 1) {
            const cs = ceilingCrackConfigs[i]
            ceilingCrackMeshes[i].scale.set(cs.len * lenGain, 1, cs.w * widthGain)
          }
        }

        if (rubbleGroup) rubbleGroup.visible = clamped > 0.05
        const emergeT = Math.max(0, Math.min(1, (clamped - 0.05) / 0.95))
        const emergeEase = Math.min(1, emergeT * 2.2)
        const tremorAmp = 0.004 + clamped * 0.006
        for (let i = 0; i < ceilingDebrisMeshes.length; i += 1) {
          const mesh = ceilingDebrisMeshes[i]
          const cfg = ceilingDebrisConfigs[i]
          const tremor =
            Math.sin(clamped * Math.PI * (14 + (i % 3) * 4) + i * 1.3) *
            tremorAmp *
            (1 - clamped * 0.55)
          const baseY = soffitY + (cfg.startY - soffitY) * emergeEase
          const sagY = baseY - cfg.maxSag * sagEase + tremor
          const slabSy = 0.002 + (cfg.sy - 0.002) * emergeT
          mesh.castShadow = clamped > 0.25 && Boolean(cfg.castShadowEnabled)
          mesh.position.set(cfg.startX, Math.min(soffitY, sagY), cfg.startZ)
          mesh.rotation.set(
            tremor * 1.6,
            cfg.startRotY,
            -tremor * 1.4
          )
          mesh.scale.set(cfg.sx, slabSy, cfg.sz)
        }

        // Bounded falling grit / plaster flakes under gravity (strictly >= floor)
        if (ceilingWarnPebbleGroup && ceilingWarnPebbles && ceilingWarnPebbleConfigs) {
          ceilingWarnPebbleGroup.visible = clamped > 0.04
          for (let i = 0; i < ceilingWarnPebbles.length; i += 1) {
            const p = ceilingWarnPebbles[i]
            const pc = ceilingWarnPebbleConfigs[i]
            const cycle = (clamped * 2.4 + pc.phaseOffset) % 1
            const tFall = cycle * 0.86
            const y = Math.max(pc.minY, pc.startY - 0.5 * 9.8 * tFall * tFall)
            const landed = y <= pc.minY + 1e-4
            p.position.set(
              pc.x + pc.driftX * Math.min(1, tFall * 1.15),
              y,
              pc.z + pc.driftZ * Math.min(1, tFall * 1.15)
            )
            p.rotation.set(
              landed ? 0.2 : pc.spin * tFall,
              pc.spin * 0.6 * tFall,
              landed ? -0.15 : pc.spin * 0.8 * tFall
            )
          }
        }

        // Subtle localized falling concrete dust veil
        if (ceilingDustGroup && ceilingDustMeshes && ceilingDustConfigs && ceilingDustMat) {
          const veilOpacity = Math.sin(clamped * Math.PI) * 0.24
          ceilingDustGroup.visible = veilOpacity > 0.01
          ceilingDustMat.opacity = veilOpacity
          for (let i = 0; i < ceilingDustMeshes.length; i += 1) {
            const puff = ceilingDustMeshes[i]
            const dc = ceilingDustConfigs[i]
            const drift = (clamped * 1.4 + dc.phase) % 1
            const py = soffitY - 0.14 - drift * 2.15
            puff.position.set(dc.warnX, Math.max(0.28, py), dc.warnZ)
            puff.scale.setScalar(dc.baseScale * (0.48 + drift * 0.55))
          }
        }
        break
      }

      // Dormant: 100% visually camouflaged into the continuous unbroken maze-ceiling-deck
      // (zero protruding panel, zero exposed cracks/cavity/slabs/pebbles/dust)
      if (ceilingSoffitRimMesh) ceilingSoffitRimMesh.visible = false
      if (rubbleGroup) rubbleGroup.visible = false
      if (ceilingCrackGroup) ceilingCrackGroup.visible = false
      if (ceilingCavityGroup) {
        ceilingCavityGroup.visible = false
        ceilingCavityGroup.scale.set(1, 1, 1)
      }
      if (ceilingCrackMeshes && ceilingCrackConfigs) {
        for (let i = 0; i < ceilingCrackMeshes.length; i += 1) {
          const cs = ceilingCrackConfigs[i]
          ceilingCrackMeshes[i].scale.set(cs.len, 1, cs.w)
        }
      }
      if (ceilingWarnPebbleGroup) ceilingWarnPebbleGroup.visible = false
      if (ceilingDustGroup) ceilingDustGroup.visible = false
      if (ceilingDustMat) ceilingDustMat.opacity = 0

      for (let i = 0; i < ceilingDebrisMeshes.length; i += 1) {
        const mesh = ceilingDebrisMeshes[i]
        const cfg = ceilingDebrisConfigs[i]
        if (mesh.userData) {
          mesh.userData.manualState = 'fallen'
          if (mesh.userData.baseMaterial && mesh.material !== mesh.userData.baseMaterial) {
            mesh.material = mesh.userData.baseMaterial
          }
        }
        mesh.castShadow = false
        mesh.position.set(cfg.startX, cfg.startY, cfg.startZ)
        mesh.rotation.set(0, cfg.startRotY, 0)
        mesh.scale.set(cfg.sx, cfg.dormantSy ?? cfg.sy, cfg.sz)
      }
      break
    }

    case HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE: {
      const {
        furnitureGroup,
        strainedStrapMesh,
        buckledLegMesh,
        ajarDoorMesh,
        looseCargoMeshes,
        looseCargoConfigs,
        furnitureWarnSplinterGroup,
        furnitureWarnSplinters,
        furnitureWarnSplinterConfigs,
        furnitureDustGroup,
        furnitureDustMeshes,
        furnitureDustConfigs,
        furnitureDustMat,
        minLocalX = -2.6,
        maxLocalX = 2.6,
        spanHalfW = 2.6,
        pivotX = 0,
        pivotZ = -1.5,
        fallenPivotZ = -1.26,
        clearedPivotZ = -1.52,
        dormantPitch = 0,
        dormantRoll = 0,
        warnEndPitch = 0.085,
        warnEndRoll = -0.014,
        collapsedPitch = Math.PI * 0.5,
        collapsedRoll = 0,
        fallenYaw = 0.014,
        clearedPitch = 0.016,
        clearedYaw = -0.006,
        clearedRoll = -0.005,
      } = data
      if (!furnitureGroup) return

      const shelfPt = { x: 0, y: 0, z: 0 }
      const evalPivotY = (pitch, roll, yaw = 0) =>
        spanHalfW *
          (Math.abs(Math.sin(roll)) * Math.abs(Math.cos(pitch)) +
            Math.abs(Math.sin(yaw)) * Math.abs(Math.sin(pitch))) +
        0.005 * Math.sin(Math.max(0, Math.min(Math.PI * 0.5, pitch)))
      const clampCargoX = (val, half) =>
        Math.max(minLocalX + half + 0.06, Math.min(maxLocalX - half - 0.06, val))
      const clampCargoZ = (val, half) =>
        Math.max(-1.92 + half, Math.min(1.88 - half, val))

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        if (furnitureWarnSplinterGroup) furnitureWarnSplinterGroup.visible = false
        if (furnitureDustGroup) furnitureDustGroup.visible = false
        if (furnitureDustMat) furnitureDustMat.opacity = 0

        if (strainedStrapMesh) {
          strainedStrapMesh.position.set(pivotX + 0.34, 1.27, -1.945)
          strainedStrapMesh.rotation.set(0.75, 0, -0.35)
          strainedStrapMesh.scale.set(1, 1, 0.55)
        }
        if (buckledLegMesh) {
          buckledLegMesh.rotation.set(0.32, 0, -0.48)
        }
        if (ajarDoorMesh) {
          ajarDoorMesh.rotation.y = -0.12
        }

        const hasExplicitDisp =
          Number.isFinite(data.furnitureDispLocalX) ||
          Number.isFinite(data.furnitureDispLocalZ)
        const dispLocalX = Number.isFinite(data.furnitureDispLocalX)
          ? data.furnitureDispLocalX
          : 0
        const dispLocalZ =
          data.isAftermathCleared &&
          (!hasExplicitDisp || Math.abs(data.furnitureDispLocalZ || 0) < 1e-4)
            ? ROTTEN_FURNITURE_HANDLING_LIMITS.minDispZ
            : Number.isFinite(data.furnitureDispLocalZ)
              ? data.furnitureDispLocalZ
              : 0

        const pose = computeRottenFurniturePose(data, dispLocalX, dispLocalZ)
        furnitureGroup.position.set(pose.curPivotX, pose.curPivotY, pose.curPivotZ)
        furnitureGroup.rotation.set(pose.pitch, pose.yaw, pose.roll)

        if (looseCargoMeshes && looseCargoConfigs) {
          const cargoMinX = pose.minLocalX
          const cargoMaxX = pose.maxLocalX
          const clampMovedCargoX = (val, half) =>
            Math.max(cargoMinX + half + 0.06, Math.min(cargoMaxX - half - 0.06, val))
          const compT = pose.compactionT
          const pushT = pose.pushProgress

          for (let i = 0; i < looseCargoMeshes.length; i += 1) {
            const mesh = looseCargoMeshes[i]
            const cfg = looseCargoConfigs[i]
            const clearedRy = (cfg.dormantRotY || 0) * 0.5
            const rx = cfg.restRotX + (clearedPitch - cfg.restRotX) * compT
            const ry = cfg.restRotY + (clearedRy - cfg.restRotY) * compT
            const rz = cfg.restRotZ + (clearedRoll - cfg.restRotZ) * compT
            const minGroundedY = computeMinGroundedCenterY(
              cfg.halfX,
              cfg.halfY,
              cfg.halfZ,
              rx,
              ry,
              rz
            )
            const targetClearedY = Math.max(minGroundedY, cfg.clearedY ?? minGroundedY)
            const fallenGroundedY = Math.max(minGroundedY, cfg.restY)
            const ty = fallenGroundedY + (targetClearedY - fallenGroundedY) * compT

            const shiftedRestX = cfg.restX + pose.dispLocalX
            const shiftedClearedX = cfg.clearedX + pose.dispLocalX
            const tx = clampMovedCargoX(
              shiftedRestX + (shiftedClearedX - shiftedRestX) * pushT,
              cfg.halfX
            )

            const baseRestZ = clampCargoZ(cfg.restZ, cfg.halfZ)
            const sweptLimitZ = Math.min(
              baseRestZ + Math.max(0, pose.dispLocalZ),
              pose.maxLocalZ - cfg.halfZ - 0.04
            )
            const sweepBlend = Math.min(1, pushT / 0.12)
            const sweptZ = baseRestZ + (sweptLimitZ - baseRestZ) * sweepBlend
            const wallTuckedZ = Math.max(
              -1.92 + cfg.halfZ,
              Math.min(-1.5 - cfg.halfZ * 0.25, cfg.clearedZ)
            )
            const rawZ = sweptZ + (wallTuckedZ - sweptZ) * compT
            const clampedZ = Math.max(
              -1.92 + cfg.halfZ,
              Math.min(pose.maxLocalZ - cfg.halfZ - 0.02, rawZ)
            )
            const tz =
              pushT <= 1e-4 ? rawZ : rawZ + (clampedZ - rawZ) * sweepBlend

            mesh.position.set(tx, ty, tz)
            mesh.rotation.set(rx, ry, rz)
          }
        }
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        if (furnitureWarnSplinterGroup) furnitureWarnSplinterGroup.visible = false

        // Continuous forward rotational acceleration from warnEndPitch -> collapsedPitch (PI/2)
        const tipNorm = Math.min(1, clamped / 0.66)
        const tipEase =
          tipNorm < 1
            ? tipNorm * tipNorm * (1.28 - 0.28 * tipNorm)
            : 1 - Math.sin(((clamped - 0.66) / 0.34) * Math.PI) * 0.01

        // Forward crash slide from pivotZ (-1.50) -> fallenPivotZ (-1.26) during impact
        const rawSlideZ = Math.max(0, Math.min(1, (clamped - 0.36) / 0.38))
        const slideZEase = rawSlideZ * rawSlideZ * (3 - 2 * rawSlideZ)
        const curPivotZ = pivotZ + (fallenPivotZ - pivotZ) * slideZEase

        const pitch = warnEndPitch + (collapsedPitch - warnEndPitch) * tipEase
        const roll = warnEndRoll + (collapsedRoll - warnEndRoll) * Math.min(1, tipEase)
        const yaw = fallenYaw * slideZEase
        const curPivotY = evalPivotY(pitch, roll, yaw)

        furnitureGroup.position.set(pivotX, curPivotY, curPivotZ)
        furnitureGroup.rotation.set(pitch, yaw, roll)

        if (strainedStrapMesh) {
          strainedStrapMesh.position.set(pivotX + 0.34, 1.27, -1.945)
          strainedStrapMesh.rotation.set(0.75 * Math.min(1, clamped * 2.5), 0, -0.35)
          strainedStrapMesh.scale.set(1, 1, 0.55)
        }
        if (buckledLegMesh) {
          buckledLegMesh.rotation.set(
            0.18 + 0.14 * Math.min(1, tipEase),
            0,
            -0.28 - 0.2 * Math.min(1, tipEase)
          )
        }
        if (ajarDoorMesh) {
          ajarDoorMesh.rotation.y = -0.12
        }

        if (looseCargoMeshes && looseCargoConfigs) {
          for (let i = 0; i < looseCargoMeshes.length; i += 1) {
            const mesh = looseCargoMeshes[i]
            const cfg = looseCargoConfigs[i]
            const dormantRy = cfg.dormantRotY || 0
            evalFurnitureShelfPoint(
              cfg.shelfX,
              cfg.shelfY,
              cfg.shelfZRel + 0.025,
              pitch,
              roll,
              pivotX,
              curPivotY,
              curPivotZ,
              shelfPt
            )
            const slideSpan = Math.max(0.05, cfg.slideEnd - cfg.slideStart)
            const rawSlide = Math.max(0, Math.min(1, (clamped - cfg.slideStart) / slideSpan))
            const slideEase = rawSlide * rawSlide * (3 - 2 * rawSlide)

            const rx = pitch + (cfg.restRotX - pitch) * slideEase
            const ry = dormantRy + (cfg.restRotY - dormantRy) * slideEase
            const rz = roll + (cfg.restRotZ - roll) * slideEase
            const minGroundedY = computeMinGroundedCenterY(
              cfg.halfX,
              cfg.halfY,
              cfg.halfZ,
              rx,
              ry,
              rz
            )

            const arcLift = Math.sin(slideEase * Math.PI) * cfg.arcHeight
            const rawX = shelfPt.x + (cfg.restX - shelfPt.x) * slideEase
            const rawY = shelfPt.y + (cfg.restY - shelfPt.y) * slideEase + arcLift
            const rawZ = shelfPt.z + (cfg.restZ - shelfPt.z) * slideEase

            mesh.position.set(
              clampCargoX(rawX, cfg.halfX),
              Math.max(minGroundedY, rawY),
              clampCargoZ(rawZ, cfg.halfZ)
            )
            mesh.rotation.set(rx, ry, rz)
          }
        }

        if (furnitureDustGroup && furnitureDustMeshes && furnitureDustConfigs && furnitureDustMat) {
          furnitureDustGroup.visible = true
          const impactBurst =
            clamped < 0.55
              ? 0.14 + clamped * 0.25
              : Math.sin(((clamped - 0.55) / 0.45) * Math.PI) * 0.46
          furnitureDustMat.opacity = Math.max(0, Math.min(0.48, impactBurst))
          for (let i = 0; i < furnitureDustMeshes.length; i += 1) {
            const puff = furnitureDustMeshes[i]
            const cfg = furnitureDustConfigs[i]
            const spread = 0.2 + clamped * 1.2
            puff.position.set(
              clampCargoX(cfg.baseX + cfg.dx * spread, 0.24),
              0.14 + clamped * cfg.lift,
              clampCargoZ(cfg.baseZ + cfg.dz * clamped, 0.24)
            )
            puff.scale.setScalar(cfg.baseScale * (0.55 + clamped * 1.15))
          }
        }
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Monotonic structural creep from upright dormant pose -> warnEndPitch + subtle zero-at-endpoints shudder
        const creep = clamped * clamped * (3 - 2 * clamped)
        const envelope = Math.sin(clamped * Math.PI)
        const shudderPitch = Math.sin(clamped * Math.PI * 14) * 0.006 * envelope
        const shudderRoll = Math.cos(clamped * Math.PI * 12) * 0.003 * envelope

        const pitch = dormantPitch + (warnEndPitch - dormantPitch) * creep + shudderPitch
        const roll = dormantRoll + (warnEndRoll - dormantRoll) * creep + shudderRoll
        const curPivotY = evalPivotY(pitch, roll)

        furnitureGroup.position.set(pivotX, curPivotY, pivotZ)
        furnitureGroup.rotation.set(pitch, 0, roll)

        if (strainedStrapMesh) {
          strainedStrapMesh.position.set(pivotX + 0.34, 1.295, -1.915 + creep * 0.022)
          strainedStrapMesh.rotation.set(creep * 0.18, 0, 0)
          strainedStrapMesh.scale.set(1, 1, 1 + creep * 0.45)
        }
        if (buckledLegMesh) {
          buckledLegMesh.rotation.set(0.12 + creep * 0.06, 0, -0.18 - creep * 0.1)
        }
        if (ajarDoorMesh) {
          ajarDoorMesh.rotation.y = -0.08 - creep * 0.04
        }

        if (looseCargoMeshes && looseCargoConfigs) {
          for (let i = 0; i < looseCargoMeshes.length; i += 1) {
            const mesh = looseCargoMeshes[i]
            const cfg = looseCargoConfigs[i]
            const dormantRy = cfg.dormantRotY || 0
            // Subtle forward creep along tilted shelf deck during warning
            const creepZRel = cfg.shelfZRel + creep * 0.025
            evalFurnitureShelfPoint(
              cfg.shelfX,
              cfg.shelfY,
              creepZRel,
              pitch,
              roll,
              pivotX,
              curPivotY,
              pivotZ,
              shelfPt
            )
            const minGroundedY = computeMinGroundedCenterY(
              cfg.halfX,
              cfg.halfY,
              cfg.halfZ,
              pitch,
              dormantRy,
              roll
            )
            mesh.position.set(
              shelfPt.x,
              Math.max(minGroundedY, shelfPt.y),
              shelfPt.z
            )
            mesh.rotation.set(pitch, dormantRy, roll)
          }
        }

        if (
          furnitureWarnSplinterGroup &&
          furnitureWarnSplinters &&
          furnitureWarnSplinterConfigs
        ) {
          furnitureWarnSplinterGroup.visible = true
          for (let i = 0; i < furnitureWarnSplinters.length; i += 1) {
            const sp = furnitureWarnSplinters[i]
            const cfg = furnitureWarnSplinterConfigs[i]
            const t = (clamped * cfg.speed + cfg.phase) % 1
            const dropDist = Math.max(0.08, cfg.startY - 0.02)
            const y = Math.max(0.015, cfg.startY - t * t * dropDist)
            sp.position.set(cfg.x, y, cfg.z + t * 0.08)
            sp.rotation.set(t * cfg.rotSpeed, t * 2.2, t * cfg.rotSpeed * 0.7)
          }
        }

        if (furnitureDustGroup && furnitureDustMeshes && furnitureDustConfigs && furnitureDustMat) {
          furnitureDustGroup.visible = true
          furnitureDustMat.opacity = 0.06 + clamped * 0.16
          for (let i = 0; i < furnitureDustMeshes.length; i += 1) {
            const puff = furnitureDustMeshes[i]
            const cfg = furnitureDustConfigs[i]
            const spread = 0.08 + clamped * 0.24
            puff.position.set(
              clampCargoX(cfg.baseX + cfg.dx * spread, 0.22),
              0.24 + (i % 2) * 0.45 - clamped * 0.14,
              clampCargoZ(-1.58 + cfg.dz * spread, 0.22)
            )
            puff.scale.setScalar(cfg.baseScale * (0.32 + clamped * 0.32))
          }
        }
        break
      }

      // Dormant state — completely level, grounded industrial shelving unit matching STORAGE_SHELF
      if (furnitureWarnSplinterGroup) furnitureWarnSplinterGroup.visible = false
      if (furnitureDustGroup) furnitureDustGroup.visible = false
      if (furnitureDustMat) furnitureDustMat.opacity = 0

      const dormantPivotY = evalPivotY(dormantPitch, dormantRoll)
      furnitureGroup.position.set(pivotX, dormantPivotY, pivotZ)
      furnitureGroup.rotation.set(dormantPitch, 0, dormantRoll)

      if (strainedStrapMesh) {
        strainedStrapMesh.position.set(pivotX + 0.34, 1.295, -1.915)
        strainedStrapMesh.rotation.set(0, 0, 0)
        strainedStrapMesh.scale.set(1, 1, 1)
      }
      if (buckledLegMesh) {
        buckledLegMesh.rotation.set(0, 0, 0)
      }
      if (ajarDoorMesh) {
        ajarDoorMesh.rotation.y = 0
      }

      if (looseCargoMeshes && looseCargoConfigs) {
        for (let i = 0; i < looseCargoMeshes.length; i += 1) {
          const mesh = looseCargoMeshes[i]
          const cfg = looseCargoConfigs[i]
          const dormantRy = cfg.dormantRotY || 0
          evalFurnitureShelfPoint(
            cfg.shelfX,
            cfg.shelfY,
            cfg.shelfZRel,
            dormantPitch,
            dormantRoll,
            pivotX,
            dormantPivotY,
            pivotZ,
            shelfPt
          )
          const minGroundedY = computeMinGroundedCenterY(
            cfg.halfX,
            cfg.halfY,
            cfg.halfZ,
            dormantPitch,
            dormantRy,
            dormantRoll
          )
          mesh.position.set(
            shelfPt.x,
            Math.max(minGroundedY, shelfPt.y),
            shelfPt.z
          )
          mesh.rotation.set(dormantPitch, dormantRy, dormantRoll)
        }
      }
      break
    }

    case HAZARD_TYPES.FALLING_PIPES_FIXTURES: {
      const pipeGroup = data.pipeGroup
      if (!pipeGroup) return

      const pipeRestY = Number.isFinite(data.pipeRestY)
        ? data.pipeRestY
        : FALLING_PIPES_CONSTANTS.pipeRestY
      const overheadZ = Number.isFinite(data.overheadZ)
        ? data.overheadZ
        : FALLING_PIPES_CONSTANTS.overheadLocalZ
      const impactZ = Number.isFinite(data.impactZ)
        ? data.impactZ
        : FALLING_PIPES_CONSTANTS.impactLocalZ
      const clearedX = Number.isFinite(data.clearedX) ? data.clearedX : -1.7
      const clearedZ = Number.isFinite(data.clearedZ) ? data.clearedZ : 0

      const leftStrainRod = data.leftStrainRod
      const rightStrainRod = data.rightStrainRod
      const warnFlakeGroup = data.pipeWarnFlakeGroup
      const warnFlakes = data.pipeWarnFlakes
      const warnFlakeConfigs = data.pipeWarnFlakeConfigs
      const dustGroup = data.pipeDustGroup
      const dustMeshes = data.pipeDustMeshes
      const dustConfigs = data.pipeDustConfigs
      const dustMat = data.pipeDustMat

      // Local half-extents of transverse pipeGroup for exact floor-clearance bounding
      const halfX = 1.935
      const halfY = 0.144
      const halfZ = 0.152

      // End-of-warning pose (continuous handoff into active progress = 0)
      const warnEndY = pipeRestY - 0.065
      const warnEndZ = overheadZ + 0.02
      const warnEndRotX = 0.04
      const warnEndRotZ = -0.09

      // Grounded horizontal resting pose spanning transversely across the corridor floor
      const restRotX = 0
      const restRotY = 0
      const restRotZ = 0
      const restMinY = computeMinGroundedCenterY(
        halfX,
        halfY,
        halfZ,
        restRotX,
        restRotY,
        restRotZ
      )

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        if (warnFlakeGroup) warnFlakeGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (leftStrainRod) {
          leftStrainRod.position.set(-1.03, pipeRestY + 0.21, overheadZ + 0.03)
          leftStrainRod.rotation.set(0.28, 0, -0.36)
          leftStrainRod.scale.set(1, 0.58, 1)
        }
        if (rightStrainRod) {
          rightStrainRod.position.set(1.07, pipeRestY + 0.22, overheadZ + 0.04)
          rightStrainRod.rotation.set(0.34, 0, 0.42)
          rightStrainRod.scale.set(1, 0.52, 1)
        }

        if (data.isAftermathCleared) {
          // Pivoted lengthwise flush against the left corridor wall so the corridor is fully open
          const clearedRotX = 0
          const clearedRotY = Math.PI * 0.5
          const clearedRotZ = 0
          const clearedMinY = computeMinGroundedCenterY(
            halfX,
            halfY,
            halfZ,
            clearedRotX,
            clearedRotY,
            clearedRotZ
          )
          pipeGroup.position.set(clearedX, clearedMinY, clearedZ)
          pipeGroup.rotation.set(clearedRotX, clearedRotY, clearedRotZ)
        } else {
          pipeGroup.position.set(0, restMinY, impactZ)
          pipeGroup.rotation.set(restRotX, restRotY, restRotZ)
        }
        break
      }

      if (state === 'active') {
        if (warnFlakeGroup) warnFlakeGroup.visible = false

        const p = Math.max(0, Math.min(1, progress))

        // Phase 1 (p in [0, 0.26]): right hanger shears first, pipe hinges downward on straining left hanger
        // Phase 2 (p in [0.26, 0.78]): left hanger shears, full transverse pipe falls under gravity and levels out
        // Phase 3 (p in [0.78, 1.0]): damped metallic bounce & settle horizontally onto corridor floor
        const hingeEndX = -0.02
        const hingeEndY = warnEndY - 0.48
        const hingeEndZ = warnEndZ + 0.04
        const hingeEndRotX = warnEndRotX + 0.06
        const hingeEndRotY = 0
        const hingeEndRotZ = warnEndRotZ - 0.25

        let curX
        let curY
        let curZ
        let curRotX
        let curRotY
        let curRotZ

        if (p <= 0.26) {
          const t1 = p / 0.26
          const e1 = t1 * t1
          curX = hingeEndX * e1
          curY = warnEndY + (hingeEndY - warnEndY) * e1
          curZ = warnEndZ + (hingeEndZ - warnEndZ) * e1
          curRotX = warnEndRotX + (hingeEndRotX - warnEndRotX) * e1
          curRotY = hingeEndRotY * e1
          curRotZ = warnEndRotZ + (hingeEndRotZ - warnEndRotZ) * e1
        } else if (p <= 0.78) {
          const t2 = (p - 0.26) / 0.52
          const grav = Math.pow(t2, 1.75)
          const smooth = t2 * t2 * (3 - 2 * t2)
          curX = hingeEndX * (1 - smooth)
          curY = hingeEndY + (restMinY - hingeEndY) * grav
          curZ = hingeEndZ + (impactZ - hingeEndZ) * smooth
          curRotX = hingeEndRotX + (restRotX - hingeEndRotX) * smooth
          curRotY = hingeEndRotY + (restRotY - hingeEndRotY) * smooth
          curRotZ = hingeEndRotZ + (restRotZ - hingeEndRotZ) * smooth
        } else {
          const t3 = (p - 0.78) / 0.22
          const bounce = Math.sin(t3 * Math.PI) * (1 - t3) * 0.035
          const rollOsc = Math.sin(t3 * Math.PI * 2) * (1 - t3) * 0.03
          curX = 0
          curY = restMinY + bounce
          curZ = impactZ + rollOsc * 0.25
          curRotX = restRotX + rollOsc
          curRotY = restRotY
          curRotZ = restRotZ + bounce * 0.1
        }

        const minFloorY = computeMinGroundedCenterY(
          halfX,
          halfY,
          halfZ,
          curRotX,
          curRotY,
          curRotZ
        )
        pipeGroup.position.set(curX, Math.max(minFloorY, curY), curZ)
        pipeGroup.rotation.set(curRotX, curRotY, curRotZ)

        // Animate straining & snapping clevis hanger rods overhead
        if (rightStrainRod) {
          const rSnap = Math.min(1, p / 0.14)
          rightStrainRod.position.set(
            1.05 + 0.02 * rSnap,
            pipeRestY + 0.115 + 0.105 * rSnap,
            overheadZ + 0.015 + 0.025 * rSnap
          )
          rightStrainRod.rotation.set(0.1 + 0.24 * rSnap, 0, -0.24 + 0.66 * rSnap)
          rightStrainRod.scale.set(1, 1.15 - 0.63 * rSnap, 1)
        }
        if (leftStrainRod) {
          if (p <= 0.26) {
            const lStrain = p / 0.26
            leftStrainRod.position.set(
              -1.05,
              pipeRestY + 0.148 - 0.04 * lStrain,
              overheadZ + 0.008 + 0.015 * lStrain
            )
            leftStrainRod.rotation.set(0.04 + 0.1 * lStrain, 0, -0.06 - 0.22 * lStrain)
            leftStrainRod.scale.set(1, 1.04 + 0.18 * lStrain, 1)
          } else {
            const lSnap = Math.min(1, (p - 0.26) / 0.16)
            leftStrainRod.position.set(
              -1.05 + 0.02 * lSnap,
              pipeRestY + 0.108 + 0.102 * lSnap,
              overheadZ + 0.023 + 0.007 * lSnap
            )
            leftStrainRod.rotation.set(0.14 + 0.14 * lSnap, 0, -0.28 - 0.08 * lSnap)
            leftStrainRod.scale.set(1, 1.22 - 0.64 * lSnap, 1)
          }
        }

        // Restrained impact dust plume when pipe slams onto floor (p >= 0.68)
        if (dustGroup && dustMeshes && dustConfigs && dustMat) {
          if (p >= 0.68) {
            const dp = Math.min(1, (p - 0.68) / 0.32)
            dustGroup.visible = true
            dustMat.opacity = Math.sin(dp * Math.PI) * 0.38
            for (let i = 0; i < dustMeshes.length; i += 1) {
              const mesh = dustMeshes[i]
              const cfg = dustConfigs[i]
              const s = 0.45 + dp * (cfg.maxScale - 0.45)
              mesh.position.set(
                cfg.impX * (0.85 + dp * 0.22),
                0.08 + dp * 0.18,
                cfg.impZ
              )
              mesh.scale.set(s * 1.15, s * 0.6, s * 1.05)
            }
          } else {
            dustGroup.visible = false
            dustMat.opacity = 0
          }
        }
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Envelope goes to 0 at clamped = 1.0 so handoff to active(0.0) has zero position jump
        const shudderEnv = Math.sin(clamped * Math.PI)
        const vibX = Math.sin(clamped * Math.PI * 26) * 0.012 * shudderEnv
        const vibY = Math.cos(clamped * Math.PI * 22) * 0.011 * shudderEnv
        const vibZ = Math.sin(clamped * Math.PI * 18) * 0.011 * shudderEnv
        const sagEase = clamped * clamped

        pipeGroup.position.set(
          vibX,
          pipeRestY + (warnEndY - pipeRestY) * sagEase + vibY,
          overheadZ + (warnEndZ - overheadZ) * sagEase + vibZ
        )
        pipeGroup.rotation.set(
          warnEndRotX * sagEase + vibZ * 0.4,
          0,
          warnEndRotZ * sagEase + vibX * 0.5
        )

        if (rightStrainRod) {
          rightStrainRod.position.set(
            1.05 + vibX * 0.3,
            pipeRestY + 0.16 - sagEase * 0.045,
            overheadZ + sagEase * 0.015
          )
          rightStrainRod.rotation.set(sagEase * 0.1, 0, -sagEase * 0.24)
          rightStrainRod.scale.set(1, 1 + sagEase * 0.15, 1)
        }
        if (leftStrainRod) {
          leftStrainRod.position.set(
            -1.05 + vibX * 0.2,
            pipeRestY + 0.16 - sagEase * 0.012,
            overheadZ + sagEase * 0.008
          )
          leftStrainRod.rotation.set(sagEase * 0.04, 0, -sagEase * 0.06)
          leftStrainRod.scale.set(1, 1 + sagEase * 0.04, 1)
        }

        // Falling rust flakes & sheared bolt fragments from straining overhead hangers
        if (warnFlakeGroup && warnFlakes && warnFlakeConfigs) {
          warnFlakeGroup.visible = true
          for (let i = 0; i < warnFlakes.length; i += 1) {
            const flake = warnFlakes[i]
            const cfg = warnFlakeConfigs[i]
            const localP = Math.max(
              0,
              Math.min(1, (clamped - cfg.delay) / Math.max(0.2, 1 - cfg.delay))
            )
            const fallDrop = localP * localP * (pipeRestY - 0.04)
            flake.position.set(
              cfg.startX + cfg.driftX * localP,
              Math.max(0.03, cfg.startY - fallDrop),
              cfg.startZ + cfg.driftZ * localP
            )
            flake.rotation.set(localP * 4.2, localP * 3.1, localP * 5.0)
          }
        }

        // Subtle overhead bracket dust puffs
        if (dustGroup && dustMeshes && dustConfigs && dustMat) {
          dustGroup.visible = true
          dustMat.opacity = Math.sin(clamped * Math.PI) * 0.28
          for (let i = 0; i < dustMeshes.length; i += 1) {
            const mesh = dustMeshes[i]
            const cfg = dustConfigs[i]
            const s = 0.35 + clamped * 0.55
            mesh.position.set(
              cfg.warnX,
              cfg.warnY - clamped * 0.28,
              cfg.warnZ + clamped * 0.08
            )
            mesh.scale.set(s, s * 0.85, s)
          }
        }
        break
      }

      // Dormant state: securely mounted horizontally across the corridor overhead
      if (warnFlakeGroup) {
        warnFlakeGroup.visible = false
        if (warnFlakes && warnFlakeConfigs) {
          for (let i = 0; i < warnFlakes.length; i += 1) {
            const cfg = warnFlakeConfigs[i]
            warnFlakes[i].position.set(cfg.startX, cfg.startY, cfg.startZ)
          }
        }
      }
      if (dustGroup) {
        dustGroup.visible = false
        if (dustMeshes && dustConfigs) {
          for (let i = 0; i < dustMeshes.length; i += 1) {
            const cfg = dustConfigs[i]
            dustMeshes[i].position.set(cfg.warnX, cfg.warnY, cfg.warnZ)
          }
        }
      }
      if (dustMat) dustMat.opacity = 0

      if (leftStrainRod) {
        leftStrainRod.position.set(-1.05, pipeRestY + 0.16, overheadZ)
        leftStrainRod.rotation.set(0, 0, 0)
        leftStrainRod.scale.set(1, 1, 1)
      }
      if (rightStrainRod) {
        rightStrainRod.position.set(1.05, pipeRestY + 0.16, overheadZ)
        rightStrainRod.rotation.set(0, 0, 0)
        rightStrainRod.scale.set(1, 1, 1)
      }

      pipeGroup.position.set(0, pipeRestY, overheadZ)
      pipeGroup.rotation.set(0, 0, 0)
      break
    }

    case HAZARD_TYPES.STEAM_PIPE_BURST: {
      const {
        steamGroup,
        steamPipe,
        repairPatchGroup,
        steamCloud,
        steamMat,
        pipeMainY = 1.38,
        lineZ = -1.8,
        leftUnionPlate,
        rightUnionPlate,
        gasketRing,
        valveWheelMesh,
        condensationGroup,
        condensationDrops,
        condensationConfigs,
        condensationMat,
        plumeLobeMeshes,
        plumeLobeConfigs,
      } = data
      const cloud = steamCloud || steamGroup
      if (!steamGroup || !cloud || !steamMat) return

      const isCleared = Boolean(data.isAftermathCleared)
      const steadyCloudZ = 0.0
      const steadyCloudScaleZ = 2.24

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        steamGroup.position.set(0.1, pipeMainY, lineZ)
        if (steamPipe) {
          steamPipe.position.set(0, 0, 0)
          steamPipe.scale.set(1, 1, 1)
        }
        if (leftUnionPlate) leftUnionPlate.position.set(isCleared ? -0.022 : -0.028, 0, 0)
        if (rightUnionPlate) rightUnionPlate.position.set(isCleared ? 0.022 : 0.028, 0, 0)
        if (gasketRing) gasketRing.position.set(0, isCleared ? 0 : -0.008, isCleared ? 0 : 0.028)
        if (repairPatchGroup) repairPatchGroup.visible = isCleared
        if (valveWheelMesh) {
          valveWheelMesh.rotation.z = isCleared ? -Math.PI * 0.75 : 0
        }
        if (condensationGroup) condensationGroup.visible = false
        if (condensationMat) condensationMat.opacity = 0

        cloud.visible = false
        cloud.position.set(0.14, pipeMainY, lineZ + 0.18)
        cloud.scale.set(0.22, 0.22, 0.28)
        steamMat.opacity = 0.0
        if (plumeLobeMeshes && plumeLobeConfigs) {
          for (let i = 0; i < plumeLobeMeshes.length; i += 1) {
            const lobe = plumeLobeMeshes[i]
            const cfg = plumeLobeConfigs[i]
            lobe.visible = false
            lobe.position.set(cfg.startX, cfg.startY, cfg.startZ)
            lobe.scale.setScalar(cfg.startScale)
          }
        }
        break
      }

      if (repairPatchGroup) repairPatchGroup.visible = false

      if (state === 'active') {
        const p = Math.max(0, progress)
        // Continuous pressurized vibration while steam vents
        const recoilAmp = 0.012
        const vibX = Math.sin(p * Math.PI * 26) * recoilAmp
        const vibY = Math.cos(p * Math.PI * 22) * recoilAmp * 0.5
        steamGroup.position.set(0.1 + vibX, pipeMainY + vibY, lineZ)
        if (steamPipe) {
          steamPipe.position.set(0, 0, 0)
          steamPipe.scale.set(1, 1, 1)
        }
        if (leftUnionPlate) leftUnionPlate.position.set(-0.028, 0, 0)
        if (rightUnionPlate) rightUnionPlate.position.set(0.028, 0, 0)
        if (gasketRing) gasketRing.position.set(0, -0.008, 0.028)
        if (valveWheelMesh) valveWheelMesh.rotation.z = 0
        if (condensationGroup) condensationGroup.visible = false
        if (condensationMat) condensationMat.opacity = 0

        // Continuous C0 transition from warning(1.0) -> surging full wall-to-wall steam barrier (p=0.4) -> continuous billowing forever (p > 0.4)
        const warnEndZ = lineZ + 0.8

        let cloudX
        let cloudY
        let cloudZ
        let sx
        let sy
        let sz
        let opacity

        if (p <= 0.4) {
          const t = p / 0.4
          const ease = t * 0.5 + 0.5 * (t * t * (3 - 2 * t))
          cloudX = 0.14 + (0.12 - 0.14) * ease
          cloudY = pipeMainY - 0.12 * ease
          cloudZ = warnEndZ + (steadyCloudZ - warnEndZ) * ease
          sx = 0.72 + (1.55 - 0.72) * ease
          sy = 0.64 + (1.44 - 0.64) * ease
          sz = 1.04 + (steadyCloudScaleZ - 1.04) * ease
          opacity = 0.74 + (0.86 - 0.74) * ease
        } else {
          const u = p - 0.4
          cloudX = 0.12 + 0.04 * Math.sin(u * 2.1)
          cloudY = pipeMainY - 0.12 + 0.06 * Math.sin(u * 1.7)
          cloudZ = steadyCloudZ + 0.05 * Math.sin(u * 2.4)
          sx = 1.55 + 0.08 * Math.sin(u * 2.3)
          sy = 1.44 + 0.08 * Math.sin(u * 1.9)
          sz = steadyCloudScaleZ + 0.06 * Math.sin(u * 2.7)
          opacity = 0.86 - 0.03 * (1 - Math.cos(u * 2.6))
        }

        cloud.visible = true
        cloud.position.set(cloudX, cloudY, cloudZ)
        cloud.scale.set(sx, sy, sz)
        steamMat.opacity = opacity

        if (plumeLobeMeshes && plumeLobeConfigs) {
          for (let i = 0; i < plumeLobeMeshes.length; i += 1) {
            const lobe = plumeLobeMeshes[i]
            const cfg = plumeLobeConfigs[i]
            lobe.visible = true

            const warnX = cfg.startX + (cfg.steadyX - cfg.startX) * 0.35
            const warnY = cfg.startY + (cfg.steadyY - cfg.startY) * 0.35
            const warnZ = cfg.startZ + (cfg.steadyZ - cfg.startZ) * 0.35
            const warnScaleX = cfg.startScale + (cfg.steadyScaleX - cfg.startScale) * 0.38
            const warnScaleY = cfg.startScale + (cfg.steadyScaleY - cfg.startScale) * 0.38
            const warnScaleZ = cfg.startScale + (cfg.steadyScaleZ - cfg.startScale) * 0.38

            if (p <= 0.4) {
              const t = p / 0.4
              const ease = t * 0.5 + 0.5 * (t * t * (3 - 2 * t))
              lobe.position.set(
                warnX + (cfg.steadyX - warnX) * ease,
                warnY + (cfg.steadyY - warnY) * ease,
                warnZ + (cfg.steadyZ - warnZ) * ease
              )
              lobe.scale.set(
                warnScaleX + (cfg.steadyScaleX - warnScaleX) * ease,
                warnScaleY + (cfg.steadyScaleY - warnScaleY) * ease,
                warnScaleZ + (cfg.steadyScaleZ - warnScaleZ) * ease
              )
            } else {
              const u = p - 0.4
              lobe.position.set(
                cfg.steadyX + 0.05 * Math.sin(u * (2.2 + i * 0.25)),
                cfg.steadyY + 0.05 * Math.sin(u * (1.8 + i * 0.2)),
                cfg.steadyZ + 0.04 * Math.sin(u * (2.4 + i * 0.2))
              )
              lobe.scale.set(
                cfg.steadyScaleX + 0.05 * Math.sin(u * (2.3 + i * 0.22)),
                cfg.steadyScaleY + 0.05 * Math.sin(u * (2.0 + i * 0.18)),
                cfg.steadyScaleZ + 0.05 * Math.sin(u * (2.5 + i * 0.24))
              )
            }
          }
        }
        break
      }

      if (state === 'warning') {
        const p = Math.max(0, Math.min(1, progress))
        const warnEase = p * p * (3 - 2 * p)
        // High-frequency metallic vibration ramping smoothly from 0 at p=0
        const vibAmp = warnEase * 0.015
        const vibX = Math.sin(p * Math.PI * 30) * vibAmp
        const vibY = Math.cos(p * Math.PI * 24) * vibAmp * 0.45
        steamGroup.position.set(0.1 + vibX, pipeMainY + vibY, lineZ)
        if (steamPipe) {
          steamPipe.position.set(0, 0, 0)
          steamPipe.scale.set(1, 1, 1)
        }

        // Union flange plates strain apart slightly and gasket extrudes forward
        if (leftUnionPlate) leftUnionPlate.position.set(-0.022 - warnEase * 0.006, 0, 0)
        if (rightUnionPlate) rightUnionPlate.position.set(0.022 + warnEase * 0.006, 0, 0)
        if (gasketRing) {
          gasketRing.position.set(0, -warnEase * 0.008, warnEase * 0.028)
        }
        if (valveWheelMesh) {
          valveWheelMesh.rotation.z = Math.sin(p * Math.PI * 18) * 0.04 * warnEase
        }

        // Dripping condensation from the stressed flange gasket
        if (condensationGroup && condensationDrops && condensationConfigs && condensationMat) {
          condensationGroup.visible = true
          condensationMat.opacity = Math.sin(p * Math.PI) * 0.72
          for (let i = 0; i < condensationDrops.length; i += 1) {
            const drop = condensationDrops[i]
            const cfg = condensationConfigs[i]
            const cycle = (p * cfg.speed + cfg.phase) % 1
            const dropY = pipeMainY - 0.08 - cycle * cycle * cfg.dropDist
            drop.position.set(cfg.x, Math.max(0.03, dropY), cfg.z)
          }
        }

        // Continuous steam leakage jet emerging from the flange joint into the corridor
        const startZ = lineZ + 0.18
        const warnEndZ = lineZ + 0.8
        cloud.visible = true
        cloud.position.set(0.14, pipeMainY, startZ + (warnEndZ - startZ) * warnEase)
        cloud.scale.set(
          0.22 + (0.72 - 0.22) * warnEase,
          0.22 + (0.64 - 0.22) * warnEase,
          0.28 + (1.04 - 0.28) * warnEase
        )
        steamMat.opacity = 0.74 * warnEase

        if (plumeLobeMeshes && plumeLobeConfigs) {
          for (let i = 0; i < plumeLobeMeshes.length; i += 1) {
            const lobe = plumeLobeMeshes[i]
            const cfg = plumeLobeConfigs[i]
            lobe.visible = true
            const warnX = cfg.startX + (cfg.steadyX - cfg.startX) * 0.35
            const warnY = cfg.startY + (cfg.steadyY - cfg.startY) * 0.35
            const warnZ = cfg.startZ + (cfg.steadyZ - cfg.startZ) * 0.35
            const warnScaleX = cfg.startScale + (cfg.steadyScaleX - cfg.startScale) * 0.38
            const warnScaleY = cfg.startScale + (cfg.steadyScaleY - cfg.startScale) * 0.38
            const warnScaleZ = cfg.startScale + (cfg.steadyScaleZ - cfg.startScale) * 0.38

            lobe.position.set(
              cfg.startX + (warnX - cfg.startX) * warnEase,
              cfg.startY + (warnY - cfg.startY) * warnEase,
              cfg.startZ + (warnZ - cfg.startZ) * warnEase
            )
            lobe.scale.set(
              cfg.startScale + (warnScaleX - cfg.startScale) * warnEase,
              cfg.startScale + (warnScaleY - cfg.startScale) * warnEase,
              cfg.startScale + (warnScaleZ - cfg.startScale) * warnEase
            )
          }
        }
        break
      }

      // Dormant state — intact pressurized steam line flush along corridor wall/ceiling
      steamGroup.position.set(0.1, pipeMainY, lineZ)
      if (steamPipe) {
        steamPipe.position.set(0, 0, 0)
        steamPipe.scale.set(1, 1, 1)
      }
      if (leftUnionPlate) leftUnionPlate.position.set(-0.022, 0, 0)
      if (rightUnionPlate) rightUnionPlate.position.set(0.022, 0, 0)
      if (gasketRing) gasketRing.position.set(0, 0, 0)
      if (valveWheelMesh) valveWheelMesh.rotation.z = 0
      if (condensationGroup) condensationGroup.visible = false
      if (condensationMat) condensationMat.opacity = 0

      cloud.visible = false
      cloud.position.set(0.14, pipeMainY, lineZ + 0.18)
      cloud.scale.set(0.22, 0.22, 0.28)
      steamMat.opacity = 0.0

      if (plumeLobeMeshes && plumeLobeConfigs) {
        for (let i = 0; i < plumeLobeMeshes.length; i += 1) {
          const lobe = plumeLobeMeshes[i]
          const cfg = plumeLobeConfigs[i]
          lobe.visible = false
          lobe.position.set(cfg.startX, cfg.startY, cfg.startZ)
          lobe.scale.setScalar(cfg.startScale)
        }
      }
      break
    }

    case HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING: {
      const {
        junctionDoorGroup,
        breakerHandleGroup,
        cableGroup,
        insulationGroup,
        cableRestY = 1.32,
        arcGroup,
        arcBolts,
        sparkGroup,
        sparkMeshes,
        sparkConfigs,
        glowMesh,
        tipMat,
        arcMat,
        sparkMat,
        glowMat,
      } = data
      if (!arcGroup || !sparkGroup || !tipMat || !arcMat || !sparkMat || !glowMat) return

      const isInsulated = Boolean(data.isAftermathCleared)
      if (breakerHandleGroup) {
        breakerHandleGroup.rotation.x = isInsulated ? 0.52 : -0.58
      }

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        const disabledKey = isInsulated ? 'disabled:insulated' : 'disabled:safe'
        if (junctionDoorGroup) junctionDoorGroup.rotation.y = isInsulated ? 0 : -0.14
        arcGroup.visible = false
        sparkGroup.visible = false
        if (glowMesh) glowMesh.visible = false
        if (insulationGroup) insulationGroup.visible = isInsulated
        arcMat.opacity = 0
        sparkMat.opacity = 0
        glowMat.opacity = 0
        tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
        tipMat.emissive.setHex(0x000000)
        tipMat.emissiveIntensity = 0
        tipMat.roughness = 0.35
        tipMat.metalness = 0.82
        if (cableGroup) {
          cableGroup.position.y = cableRestY
          cableGroup.rotation.z = 0
        }
        data._visualStateKey = disabledKey
        break
      }

      if (insulationGroup) insulationGroup.visible = false

      if (state === 'active') {
        const p = Math.max(0, progress)
        const surgeRamp = p <= 0.25 ? p / 0.25 : 1
        const crackle = Math.abs(Math.sin(p * Math.PI * 18))

        if (junctionDoorGroup) junctionDoorGroup.rotation.y = -0.14
        arcGroup.visible = true
        sparkGroup.visible = true
        if (glowMesh) {
          glowMesh.visible = true
          const glowScale = 0.76 + surgeRamp * 0.28 + crackle * 0.24
          glowMesh.scale.setScalar(glowScale)
        }

        arcMat.color.setHex(HAZARD_PALETTE.wiringArcActive)
        arcMat.opacity = 0.72 + crackle * 0.26 * surgeRamp
        sparkMat.color.setHex(HAZARD_PALETTE.wiringSparkActive)
        sparkMat.opacity = 0.85 + 0.12 * surgeRamp * (0.5 + 0.5 * Math.cos(p * Math.PI * 12))
        glowMat.color.setHex(HAZARD_PALETTE.wiringArcActive)
        glowMat.opacity = 0.36 + (0.16 + crackle * 0.2) * surgeRamp

        if (data._visualStateKey !== 'active') {
          tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
          tipMat.emissive.setHex(HAZARD_PALETTE.wiringArcActive)
          tipMat.roughness = 0.35
          tipMat.metalness = 0.82
        }
        tipMat.emissiveIntensity = 2.4 + crackle * 1.0 * surgeRamp

        if (arcBolts) {
          for (let b = 0; b < arcBolts.length; b += 1) {
            const bolt = arcBolts[b]
            const jitter = Math.sin(p * Math.PI * (16 + b * 6) + b * 2.1)
            const sy = 0.9 + Math.abs(jitter) * 0.22
            bolt.scale.set(0.92 + Math.abs(jitter) * 0.25, sy, 0.92 + Math.abs(jitter) * 0.25)
          }
        }

        if (sparkMeshes && sparkConfigs) {
          for (let i = 0; i < sparkMeshes.length; i += 1) {
            const cfg = sparkConfigs[i]
            const t = (cfg.speed + p * cfg.activeSpeed + cfg.phase) % 1
            const spark = sparkMeshes[i]
            spark.position.set(
              cfg.originX + cfg.dx * t * 1.15,
              cfg.originY + cfg.dy * t - 0.65 * t * t,
              cfg.originZ + cfg.dz * t * 1.15
            )
            const s = Math.max(0.18, 1.05 - t * 0.85)
            spark.scale.setScalar(s)
          }
        }

        if (cableGroup) {
          cableGroup.position.y = cableRestY
          cableGroup.rotation.z = Math.sin(p * Math.PI * 22) * 0.026
        }
        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const ease = clamped * clamped * (3 - 2 * clamped)
        const flicker = Math.sin(clamped * Math.PI * 22) * Math.cos(clamped * Math.PI * 9)
        const endArcRamp = clamped > 0.88 ? (clamped - 0.88) / 0.12 : 0
        const preArcFlash = endArcRamp > 0 || (clamped > 0.45 && flicker > 0.35)

        if (junctionDoorGroup) junctionDoorGroup.rotation.y = -0.14 * ease
        arcGroup.visible = preArcFlash
        arcMat.color.setHex(
          endArcRamp > 0.5 ? HAZARD_PALETTE.wiringArcActive : HAZARD_PALETTE.wiringSparkWarning
        )
        arcMat.opacity =
          endArcRamp > 0
            ? 0.72 * (endArcRamp * endArcRamp * (3 - 2 * endArcRamp))
            : preArcFlash
              ? 0.42 + clamped * 0.22
              : 0

        sparkGroup.visible = true
        sparkMat.color.setHex(HAZARD_PALETTE.wiringSparkWarning)
        sparkMat.opacity = 0.35 + ease * 0.5

        if (glowMesh) {
          glowMesh.visible = true
          glowMesh.scale.setScalar(0.36 + ease * 0.4 + Math.abs(flicker) * 0.08 * ease)
        }
        glowMat.color.setHex(
          endArcRamp > 0.5 ? HAZARD_PALETTE.wiringArcActive : HAZARD_PALETTE.wiringSparkWarning
        )
        glowMat.opacity = 0.1 + ease * 0.26

        if (data._visualStateKey !== 'warning') {
          tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
          tipMat.roughness = 0.35
          tipMat.metalness = 0.82
        }
        tipMat.emissive.setHex(HAZARD_PALETTE.wiringSparkWarning)
        // Starts at 0.56 (> 0.5) on fault onset and ramps smoothly to 2.40 matching active(0)
        tipMat.emissiveIntensity = 0.56 + ease * 1.84 + Math.abs(Math.sin(clamped * Math.PI * 22)) * 0.22 * (1 - endArcRamp)

        if (sparkMeshes && sparkConfigs) {
          const spread = 0.55 + ease * 0.6
          for (let i = 0; i < sparkMeshes.length; i += 1) {
            const cfg = sparkConfigs[i]
            const t = (clamped * cfg.speed + cfg.phase) % 1
            const spark = sparkMeshes[i]
            spark.position.set(
              cfg.originX + cfg.dx * t * spread,
              cfg.originY + cfg.dy * t - 0.65 * t * t,
              cfg.originZ + cfg.dz * t * spread
            )
            const s = Math.max(0.18, (0.65 + ease * 0.4) * (1 - t * 0.85))
            spark.scale.setScalar(s)
          }
        }

        if (cableGroup) {
          cableGroup.position.y = cableRestY
          cableGroup.rotation.z = Math.sin(clamped * Math.PI * 28) * 0.022 * ease
        }
        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — latched flush enclosure + matte rubber-sheathed tips matching decoys
      if (data._visualStateKey === 'dormant') break
      if (junctionDoorGroup) junctionDoorGroup.rotation.y = 0
      arcGroup.visible = false
      sparkGroup.visible = false
      if (glowMesh) glowMesh.visible = false
      arcMat.opacity = 0
      sparkMat.opacity = 0
      glowMat.opacity = 0
      tipMat.color.setHex(HAZARD_PALETTE.wiringCable)
      tipMat.emissive.setHex(0x000000)
      tipMat.emissiveIntensity = 0
      tipMat.roughness = 0.85
      tipMat.metalness = 0.05
      if (cableGroup) {
        cableGroup.position.y = cableRestY
        cableGroup.rotation.z = 0
      }
      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.COLLAPSING_FLOOR_GRATE: {
      const {
        grateRestY = 0.009,
        leftLeafGroup,
        rightLeafGroup,
        bolts,
        boltRestPositions,
        brokenStubsGroup,
        warningFragGroup,
        warningFragments,
        warningFragConfigs,
        debrisGroup,
        debrisMeshes,
        debrisConfigs,
        dustGroup,
        dustMeshes,
        dustConfigs,
        dustMat,
        securedCoverGroup,
      } = data
      if (!leftLeafGroup || !rightLeafGroup) return

      if (data.isAftermathCleared) {
        if (data._visualStateKey === 'secured') break
        leftLeafGroup.rotation.z = -1.28
        rightLeafGroup.rotation.z = 1.24
        leftLeafGroup.position.y = grateRestY - 0.139
        rightLeafGroup.position.y = grateRestY - 0.131

        if (securedCoverGroup) securedCoverGroup.visible = true
        if (brokenStubsGroup) brokenStubsGroup.visible = false
        if (warningFragGroup) warningFragGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0
        if (debrisGroup) debrisGroup.visible = false
        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            bolts[i].visible = !bp.inPit
          }
        }
        data._visualStateKey = 'secured'
        break
      }

      if (securedCoverGroup) securedCoverGroup.visible = false

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        if (data._visualStateKey === 'disabled') break
        leftLeafGroup.rotation.z = -1.28
        rightLeafGroup.rotation.z = 1.24
        leftLeafGroup.position.y = grateRestY - 0.139
        rightLeafGroup.position.y = grateRestY - 0.131

        if (brokenStubsGroup) brokenStubsGroup.visible = true
        if (warningFragGroup) warningFragGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (debrisGroup && debrisMeshes && debrisConfigs) {
          debrisGroup.visible = true
          for (let i = 0; i < debrisMeshes.length; i += 1) {
            const cfg = debrisConfigs[i]
            const shard = debrisMeshes[i]
            shard.position.set(cfg.endX, cfg.endY, cfg.endZ)
            shard.rotation.set(0.12, cfg.rotY, 0.08)
          }
        }
        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            bolt.visible = true
            bolt.position.set(bp.sx, bp.sy, bp.sz)
            bolt.rotation.z = i % 2 === 0 ? 1.35 : -1.25
          }
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const gravL = Math.min(1, clamped / 0.74)
        const gravR = Math.min(1, clamped / 0.78)
        const settleT = clamped > 0.74 ? (clamped - 0.74) / 0.26 : 0
        const bounce = settleT > 0 ? Math.sin(settleT * Math.PI) * (1 - settleT) * 0.05 : 0
        const easeL = gravL * gravL - bounce
        const easeR = gravR * gravR - bounce * 0.85

        leftLeafGroup.rotation.z = -0.156 - easeL * 1.124
        rightLeafGroup.rotation.z = 0.156 + easeR * 1.084
        leftLeafGroup.position.y = grateRestY - 0.012 - Math.min(1, gravL * gravL) * 0.127
        rightLeafGroup.position.y = grateRestY - 0.012 - Math.min(1, gravR * gravR) * 0.119

        if (brokenStubsGroup) brokenStubsGroup.visible = true
        if (warningFragGroup) warningFragGroup.visible = false

        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            bolt.visible = true
            const warnTopY = bp.y + 0.018
            const fallY = warnTopY + (bp.sy - warnTopY) * (clamped * clamped)
            const jump = bp.inPit ? 0 : Math.sin(clamped * Math.PI) * 0.09
            bolt.position.set(
              bp.x + (bp.sx - bp.x) * clamped,
              fallY + jump,
              bp.z + (bp.sz - bp.z) * clamped
            )
            bolt.rotation.z = (i % 2 === 0 ? 1.35 : -1.25) * clamped
          }
        }

        if (debrisGroup && debrisMeshes && debrisConfigs) {
          debrisGroup.visible = true
          for (let i = 0; i < debrisMeshes.length; i += 1) {
            const cfg = debrisConfigs[i]
            const shard = debrisMeshes[i]
            const gravShard = clamped * clamped
            const py = cfg.inPit
              ? 0.012 + (cfg.endY - 0.012) * gravShard
              : 0.014 + Math.sin(clamped * Math.PI) * cfg.arcH
            shard.position.set(
              cfg.startX + (cfg.endX - cfg.startX) * clamped,
              py,
              cfg.startZ + (cfg.endZ - cfg.startZ) * clamped
            )
            shard.rotation.set(clamped * 2.4, cfg.rotY, clamped * 1.8)
          }
        }

        if (dustGroup && dustMeshes && dustConfigs && dustMat) {
          dustGroup.visible = true
          dustMat.opacity = Math.max(0, Math.sin(clamped * Math.PI) * 0.36)
          for (let i = 0; i < dustMeshes.length; i += 1) {
            const cfg = dustConfigs[i]
            const puff = dustMeshes[i]
            puff.position.set(
              cfg.dx * (0.2 + clamped * 0.8),
              0.04 + cfg.riseY * clamped,
              cfg.dz * (0.2 + clamped * 0.8)
            )
            puff.scale.setScalar(cfg.baseScale * (0.55 + clamped * 1.05))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const vib = Math.sin(clamped * Math.PI * 26) * (0.004 + clamped * 0.01) * clamped
        const bend = clamped * clamped * 0.156

        leftLeafGroup.rotation.z = -bend + vib
        rightLeafGroup.rotation.z = bend - vib
        leftLeafGroup.position.y = grateRestY - clamped * 0.012
        rightLeafGroup.position.y = grateRestY - clamped * 0.012

        if (brokenStubsGroup) brokenStubsGroup.visible = false
        if (debrisGroup) debrisGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            bolt.visible = true
            const rattle = Math.abs(Math.sin(clamped * Math.PI * (20 + i * 5))) * 0.009 * clamped
            bolt.position.set(bp.x, bp.y + clamped * 0.018 + rattle, bp.z)
            bolt.rotation.z =
              Math.sin(clamped * Math.PI * 18 + i) * 0.16 * Math.sin(clamped * Math.PI)
          }
        }

        if (warningFragGroup && warningFragments && warningFragConfigs) {
          warningFragGroup.visible = true
          for (let i = 0; i < warningFragments.length; i += 1) {
            const cfg = warningFragConfigs[i]
            const chip = warningFragments[i]
            const t = (clamped * cfg.speed + cfg.phase) % 1
            chip.visible = t < 0.96
            chip.position.set(
              cfg.x + Math.sin(t * Math.PI * 2 + i) * 0.025,
              0.012 - t * t * 0.63,
              cfg.z
            )
            chip.rotation.set(t * 3.1, i * 0.8, t * 2.4)
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      if (data._visualStateKey === 'dormant') break

      // Dormant state — flush floor-integrated corroded grate matching decoy grates identically
      leftLeafGroup.rotation.z = 0
      rightLeafGroup.rotation.z = 0
      leftLeafGroup.position.y = grateRestY
      rightLeafGroup.position.y = grateRestY

      if (brokenStubsGroup) brokenStubsGroup.visible = false
      if (warningFragGroup) warningFragGroup.visible = false
      if (debrisGroup) debrisGroup.visible = false
      if (dustGroup) dustGroup.visible = false
      if (dustMat) dustMat.opacity = 0

      if (bolts && boltRestPositions) {
        for (let i = 0; i < bolts.length; i += 1) {
          const bp = boltRestPositions[i]
          const bolt = bolts[i]
          bolt.visible = true
          bolt.position.set(bp.x, bp.y, bp.z)
          bolt.rotation.set(0, 0, 0)
        }
      }

      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.WALL_COLLAPSE: {
      const {
        wallZ = -CELL_SIZE * 0.5,
        slabHalfX = 0.47,
        slabHalfY = 0.52,
        slabHalfZ = 0.022,
        crackBaseZ = -CELL_SIZE * 0.5 + 0.044,
        cavityMesh,
        rebarGroup,
        slabMeshes,
        slabConfigs,
        crackGroup,
        warningGroup,
        warningChunks,
        warningChunkConfigs,
        wallRubbleGroup,
        wallRubbleMeshes,
        wallRubbleConfigs,
        wallDustGroup,
        wallDustMeshes,
        wallDustConfigs,
        dustMat,
      } = data
      if (!slabMeshes || !slabConfigs) return

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        const cleared = Boolean(data.isAftermathCleared)
        const targetKey = cleared ? 'cleared' : 'disabled'
        if (data._visualStateKey === targetKey) break

        if (cavityMesh) cavityMesh.visible = true
        if (rebarGroup) rebarGroup.visible = true

        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          if (cleared) {
            slab.position.set(sc.clearedX, sc.clearedY, sc.clearedZ)
            slab.rotation.set(sc.clearedRx, sc.clearedRy, sc.clearedRz)
          } else {
            slab.position.set(sc.endX, sc.endY, sc.endZ)
            slab.rotation.set(sc.endRx, sc.endRy, sc.endRz)
          }
        }
        if (crackGroup) crackGroup.visible = false
        if (warningGroup) warningGroup.visible = false
        if (wallDustGroup) wallDustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (wallRubbleGroup && wallRubbleMeshes && wallRubbleConfigs) {
          wallRubbleGroup.visible = true
          for (let i = 0; i < wallRubbleMeshes.length; i += 1) {
            const rc = wallRubbleConfigs[i]
            const block = wallRubbleMeshes[i]
            block.scale.set(rc.scaleX, rc.scaleY, rc.scaleZ)
            if (cleared) {
              block.position.set(rc.clearedX, rc.clearedY, rc.clearedZ)
              block.rotation.set(rc.clearedRx, rc.clearedRy, rc.clearedRz)
            } else {
              block.position.set(rc.endX, rc.endY, rc.endZ)
              block.rotation.set(rc.endRx, rc.endRy, rc.endRz)
            }
          }
        }
        data._visualStateKey = targetKey
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        if (cavityMesh) cavityMesh.visible = true
        if (rebarGroup) rebarGroup.visible = true

        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          const u =
            clamped <= sc.detachDelay
              ? 0
              : Math.min(1, (clamped - sc.detachDelay) / Math.max(1e-4, 1 - sc.detachDelay))

          let rawX
          let rawY
          let rawZ
          let rx
          let ry
          let rz

          if (u <= sc.tImpact) {
            const tau = u / Math.max(1e-4, sc.tImpact)
            const tauSq = tau * tau
            const gravEase = 0.18 * tau + 0.82 * tauSq
            rawX = sc.restX + (sc.impactX - sc.restX) * tau
            rawY = sc.warnEndY - (sc.warnEndY - sc.endY) * gravEase
            rawZ = sc.warnEndZ + (sc.impactZ - sc.warnEndZ) * tau
            rx = sc.warnRx + (sc.endRx - sc.warnRx) * tau
            ry = sc.endRy * tau
            rz = sc.endRz * tau
          } else if (u <= sc.tSettle) {
            const bt = (u - sc.tImpact) / Math.max(1e-4, sc.tSettle - sc.tImpact)
            const bounce = Math.sin(bt * Math.PI) * sc.bounceH
            rawX = sc.impactX + (sc.endX - sc.impactX) * bt
            rawY = sc.endY + bounce
            rawZ = sc.impactZ + (sc.endZ - sc.impactZ) * bt
            rx = sc.endRx - Math.sin(bt * Math.PI) * 0.05
            ry = sc.endRy
            rz = sc.endRz
          } else {
            rawX = sc.endX
            rawY = sc.endY
            rawZ = sc.endZ
            rx = sc.endRx
            ry = sc.endRy
            rz = sc.endRz
          }

          const ext = computeBoxOrientedExtents(slabHalfX, slabHalfY, slabHalfZ, rx, ry, rz)
          slab.position.set(
            rawX,
            Math.max(ext.extentY + 0.002, rawY),
            Math.max(wallZ + ext.extentZ, rawZ)
          )
          slab.rotation.set(rx, ry, rz)
        }

        if (crackGroup) crackGroup.visible = false

        // Keep settled warning chips tucked into floor rubble fade smoothly without pop
        if (warningGroup && warningChunks && warningChunkConfigs) {
          const chipFade = Math.max(0, 1 - clamped / 0.35)
          if (chipFade > 0.01) {
            warningGroup.visible = true
            for (let i = 0; i < warningChunks.length; i += 1) {
              const wc = warningChunkConfigs[i]
              const chip = warningChunks[i]
              const sx = wc.sx * chipFade
              const sy = wc.sy * chipFade
              const sz = wc.sz * chipFade
              const chipExt = computeBoxOrientedExtents(
                sx * 0.5,
                sy * 0.5,
                sz * 0.5,
                3.1,
                i * 0.7,
                2.4
              )
              chip.scale.set(sx, sy, sz)
              chip.position.set(
                wc.endX + Math.sin(Math.PI) * 0.025,
                chipExt.extentY + 0.002,
                Math.max(wallZ + chipExt.extentZ + 0.002, wc.endZ)
              )
              chip.rotation.set(3.1, i * 0.7, 2.4)
            }
          } else {
            warningGroup.visible = false
          }
        }

        if (wallRubbleGroup && wallRubbleMeshes && wallRubbleConfigs) {
          wallRubbleGroup.visible = true
          const emergeScale = Math.min(1, 0.25 + (clamped / 0.14) * 0.75)
          for (let i = 0; i < wallRubbleMeshes.length; i += 1) {
            const rc = wallRubbleConfigs[i]
            const block = wallRubbleMeshes[i]
            const sMul = emergeScale
            block.scale.set(rc.scaleX * sMul, rc.scaleY * sMul, rc.scaleZ * sMul)
            const arcY = Math.sin(clamped * Math.PI) * rc.arcH
            const ease = clamped * clamped
            const rx = rc.endRx * (0.2 + 0.8 * clamped) + Math.sin(clamped * Math.PI) * 1.4
            const ry = rc.endRy * clamped
            const rz = rc.endRz * clamped + Math.sin(clamped * Math.PI) * 0.85
            const rubExt = computeBoxOrientedExtents(
              rc.scaleX * sMul * 0.5,
              rc.scaleY * sMul * 0.5,
              rc.scaleZ * sMul * 0.5,
              rx,
              ry,
              rz
            )
            const rawY = rc.startY + (rc.endY - rc.startY) * ease + arcY
            const rawZ = rc.startZ + (rc.endZ - rc.startZ) * clamped
            block.position.set(
              rc.startX + (rc.endX - rc.startX) * clamped,
              Math.max(rubExt.extentY + 0.002, rawY),
              Math.max(wallZ + rubExt.extentZ + 0.004, rawZ)
            )
            block.rotation.set(rx, ry, rz)
          }
        }

        if (wallDustGroup && wallDustMeshes && wallDustConfigs && dustMat) {
          wallDustGroup.visible = true
          dustMat.opacity = Math.max(
            0,
            (0.22 + Math.sin(clamped * Math.PI) * 0.36) * (1 - clamped * clamped)
          )
          for (let i = 0; i < wallDustMeshes.length; i += 1) {
            const dc = wallDustConfigs[i]
            const puff = wallDustMeshes[i]
            puff.position.set(
              dc.x * (0.82 + clamped * 0.38),
              dc.warnEndY + dc.riseY * clamped,
              wallZ + 0.22 + dc.reachZ * clamped
            )
            puff.scale.setScalar(dc.baseScale * (0.65 + clamped * 1.15))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const tremor = Math.sin(Math.PI * clamped)
        const lean = Math.pow(clamped, 1.35)
        const vibAmp = 0.018 * tremor

        if (cavityMesh) cavityMesh.visible = clamped > 0.16
        if (rebarGroup) rebarGroup.visible = clamped > 0.4

        let bulgeSum = 0
        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          const vibX = Math.sin(clamped * Math.PI * (26 + i * 5)) * vibAmp
          const vibY = Math.cos(clamped * Math.PI * (22 + i * 4)) * (vibAmp * 0.65)
          const rx = sc.warnRx * lean
          const ry = 0
          const rz = vibX * 0.85
          const bulge = sc.bulgeZ * lean
          bulgeSum += bulge
          const ext = computeBoxOrientedExtents(slabHalfX, slabHalfY, slabHalfZ, rx, ry, rz)
          const rawY = sc.restY - sc.warnDropY * lean + vibY
          const rawZ = sc.restZ + bulge
          slab.position.set(
            sc.restX + vibX,
            Math.max(ext.extentY + 0.002, rawY),
            Math.max(wallZ + ext.extentZ, rawZ)
          )
          slab.rotation.set(rx, ry, rz)
        }

        if (crackGroup) {
          crackGroup.visible = true
          const crackScale = 0.95 + clamped * 0.27
          crackGroup.scale.set(crackScale, crackScale, 1)
          crackGroup.position.y = 1.22 - clamped * 0.014
          crackGroup.position.z = crackBaseZ + bulgeSum / slabMeshes.length
        }

        if (warningGroup && warningChunks && warningChunkConfigs) {
          warningGroup.visible = true
          for (let i = 0; i < warningChunks.length; i += 1) {
            const wc = warningChunkConfigs[i]
            const chip = warningChunks[i]
            chip.scale.set(wc.sx, wc.sy, wc.sz)
            const localT =
              clamped <= wc.startFrac
                ? 0
                : Math.min(1, (clamped - wc.startFrac) / Math.max(1e-4, wc.endFrac - wc.startFrac))
            const fallEase = localT * localT
            const chipRx = localT * 3.1
            const chipRy = i * 0.7
            const chipRz = localT * 2.4
            const chipExt = computeBoxOrientedExtents(
              wc.sx * 0.5,
              wc.sy * 0.5,
              wc.sz * 0.5,
              chipRx,
              chipRy,
              chipRz
            )
            const floorRestY = chipExt.extentY + 0.002
            const chipY = Math.max(
              floorRestY,
              wc.startY * (1 - fallEase) + floorRestY * fallEase
            )
            const chipZ = Math.max(
              wallZ + chipExt.extentZ + 0.002,
              wc.z + (wc.endZ - wc.z) * localT
            )
            chip.position.set(
              wc.x + (wc.endX - wc.x) * localT + Math.sin(localT * Math.PI) * 0.025,
              chipY,
              chipZ
            )
            chip.rotation.set(chipRx, chipRy, chipRz)
          }
        }

        if (wallRubbleGroup) wallRubbleGroup.visible = false

        if (wallDustGroup && wallDustMeshes && wallDustConfigs && dustMat) {
          wallDustGroup.visible = true
          dustMat.opacity = Math.min(0.22, Math.sin(clamped * Math.PI * 0.5) * 0.22)
          for (let i = 0; i < wallDustMeshes.length; i += 1) {
            const dc = wallDustConfigs[i]
            const puff = wallDustMeshes[i]
            puff.position.set(
              dc.x * (0.72 + 0.1 * clamped),
              dc.startY + (dc.warnEndY - dc.startY) * clamped,
              wallZ + 0.08 + clamped * 0.14
            )
            puff.scale.setScalar(dc.baseScale * (0.35 + clamped * 0.3))
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — flush intact masonry veneer panel indistinguishable from safe deterioration decoys
      if (data._visualStateKey === 'dormant') break
      if (cavityMesh) cavityMesh.visible = false
      if (rebarGroup) rebarGroup.visible = false
      for (let i = 0; i < slabMeshes.length; i += 1) {
        const sc = slabConfigs[i]
        const slab = slabMeshes[i]
        slab.position.set(sc.restX, sc.restY, sc.restZ)
        slab.rotation.set(0, 0, 0)
      }
      if (crackGroup) {
        crackGroup.visible = true
        crackGroup.scale.set(0.95, 0.95, 1)
        crackGroup.position.set(0, 1.22, crackBaseZ)
      }
      if (warningGroup) warningGroup.visible = false
      if (wallRubbleGroup) wallRubbleGroup.visible = false
      if (wallDustGroup) wallDustGroup.visible = false
      if (dustMat) dustMat.opacity = 0

      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.FALLING_WATER_TANK: {
      const {
        tankRestY = WATER_TANK_CONSTANTS.tankRestY,
        tankFallenY = WATER_TANK_CONSTANTS.tankFallenY,
        strapRestY = 2.74,
        sideSign = 1,
        surgeLength = 2.55,
        surgeHalfWidth = 1.05,
        brokenStraps,
        tankGroup,
        seamMesh,
        leakGroup,
        leakDrops,
        leakDropConfigs,
        leakStreams,
        tankDebrisGroup,
        tankDebrisMeshes,
        tankDebrisConfigs,
        surgeGroup,
        surgeSheetMesh,
        crestMesh,
        sprayMeshes,
        sprayConfigs,
        puddleMesh,
        leakMat,
        surgeMat,
        puddleMat,
      } = data
      if (!tankGroup) return

      const sSign = sideSign >= 0 ? 1 : -1
      const impactProg = WATER_TANK_CONSTANTS.impactProgress // 0.28
      const settleEndProg = 0.48
      const impactX = sSign * 0.52
      const impactZ = -0.24
      const impactRy = sSign * 1.18
      const fallenX = sSign * WATER_TANK_CONSTANTS.fallenLocalX
      const fallenZ = WATER_TANK_CONSTANTS.fallenLocalZ
      const fallenRy = sSign * 1.48
      const clearedX = sSign * WATER_TANK_CONSTANTS.clearedLocalX
      const clearedZ = WATER_TANK_CONSTANTS.clearedLocalZ
      const clearedRy = sSign * 1.54

      const warnEndY = tankRestY - 0.055
      const warnEndZ = 0.02
      const warnEndRotX = 0.045
      const warnEndRotZ = -sSign * 0.06
      const warnEndStrapY = strapRestY - 0.035

      const puddleCenterZ = Math.min(0.95, (surgeLength - 0.65) * 0.5)
      const puddleScaleX = Math.min(0.96, surgeHalfWidth * 0.9)
      const puddleScaleY = (surgeLength + 0.62) * 0.48
      const puddleCenterX = Math.max(-0.55, Math.min(0.55, fallenX * 0.26))

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        const isCleared = Boolean(data.isAftermathCleared)
        tankGroup.position.set(
          isCleared ? clearedX : fallenX,
          tankFallenY,
          isCleared ? clearedZ : fallenZ
        )
        tankGroup.rotation.set(0, isCleared ? clearedRy : fallenRy, 0)
        if (seamMesh) seamMesh.scale.set(1.24, 2.0, 1.24)

        if (brokenStraps) {
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            strap.position.y = strapRestY + 0.14
            strap.rotation.z = i === 0 ? -0.58 : 0.64
            strap.rotation.x = 0.3
          }
        }

        if (leakGroup) leakGroup.visible = false
        if (leakStreams) {
          for (let i = 0; i < leakStreams.length; i += 1) leakStreams[i].visible = false
        }
        if (leakMat) leakMat.opacity = 0

        if (surgeGroup) surgeGroup.visible = false
        if (surgeMat) surgeMat.opacity = 0

        if (tankDebrisGroup && tankDebrisMeshes && tankDebrisConfigs) {
          tankDebrisGroup.visible = true
          for (let i = 0; i < tankDebrisMeshes.length; i += 1) {
            const dc = tankDebrisConfigs[i]
            const frag = tankDebrisMeshes[i]
            frag.position.set(
              isCleared ? dc.clearX : dc.endX,
              0.025,
              isCleared ? dc.clearZ : dc.endZ
            )
            frag.rotation.set(0.14, dc.rotY, 0.08)
          }
        }

        if (puddleMesh && puddleMat) {
          puddleMesh.visible = true
          puddleMesh.position.set(puddleCenterX, 0.012, puddleCenterZ)
          puddleMesh.scale.set(puddleScaleX, puddleScaleY, 1)
          puddleMat.opacity = isCleared ? 0.42 : 0.56
        }

        data._visualStateKey = isCleared ? 'disabled:cleared' : 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))

        // Phase 1 [0..0.28]: asymmetric strap failure & gravity-driven drop onto impact pose
        // Phase 2 (0.28..0.48]: damped roll & settle onto grounded floor pose
        if (clamped <= impactProg) {
          const dropT = clamped / impactProg
          const grav = dropT * dropT
          const smooth = dropT * dropT * (3 - 2 * dropT)
          const wobble = Math.sin(dropT * Math.PI)
          tankGroup.position.set(
            impactX * smooth,
            warnEndY + (tankFallenY - warnEndY) * grav,
            warnEndZ + (impactZ - warnEndZ) * smooth
          )
          tankGroup.rotation.set(
            warnEndRotX * (1 - smooth) + wobble * 0.14,
            impactRy * smooth,
            warnEndRotZ * (1 - smooth) - sSign * wobble * 0.12
          )
        } else if (clamped <= settleEndProg) {
          const settleT = (clamped - impactProg) / (settleEndProg - impactProg)
          const settleEase = settleT * settleT * (3 - 2 * settleT)
          const bounce = Math.sin(settleT * Math.PI) * (1 - settleT) * 0.045
          tankGroup.position.set(
            impactX + (fallenX - impactX) * settleEase,
            tankFallenY + bounce,
            impactZ + (fallenZ - impactZ) * settleEase
          )
          tankGroup.rotation.set(
            0,
            impactRy + (fallenRy - impactRy) * settleEase,
            0
          )
        } else {
          tankGroup.position.set(fallenX, tankFallenY, fallenZ)
          tankGroup.rotation.set(0, fallenRy, 0)
        }

        const crackT = Math.min(1, clamped / impactProg)
        if (seamMesh) {
          seamMesh.scale.set(1 + 0.24 * crackT, 1 + 1.0 * crackT, 1 + 0.24 * crackT)
        }

        // Asymmetric strap shear starting smoothly from warning(1) pose
        if (brokenStraps) {
          const rightSideIndex = sSign > 0 ? 1 : 0
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            const delay = i === rightSideIndex ? 0 : 0.08
            const snapT = Math.max(0, Math.min(1, (clamped - delay) / 0.2))
            const strapBaseRotZ = -sSign * 0.045
            const targetRotZ = i === 0 ? -0.58 : 0.64
            strap.position.y =
              warnEndStrapY + (strapRestY + 0.14 - warnEndStrapY) * snapT
            strap.rotation.z = strapBaseRotZ + (targetRotZ - strapBaseRotZ) * snapT
            strap.rotation.x = 0.3 * snapT
          }
        }

        if (tankDebrisGroup && tankDebrisMeshes && tankDebrisConfigs) {
          tankDebrisGroup.visible = true
          const debT = Math.min(1, clamped / 0.42)
          const debEase = debT * debT
          for (let i = 0; i < tankDebrisMeshes.length; i += 1) {
            const dc = tankDebrisConfigs[i]
            const frag = tankDebrisMeshes[i]
            const arcY = Math.sin(debT * Math.PI) * dc.arcH
            frag.position.set(
              dc.startX + (dc.endX - dc.startX) * debEase,
              dc.startY + (0.025 - dc.startY) * debEase + arcY,
              dc.startZ + (dc.endZ - dc.startZ) * debEase
            )
            frag.rotation.set(debT * 2.8, dc.rotY, debT * 2.1)
          }
        }

        // Warning drips stop cleanly once tank hits floor
        const dropFrac = Math.min(1, clamped / impactProg)
        if (leakGroup) leakGroup.visible = dropFrac < 0.72
        if (leakStreams) {
          for (let i = 0; i < leakStreams.length; i += 1) leakStreams[i].visible = false
        }

        // Directional water surge strictly begins AT or AFTER tank ground impact (>= 0.28)
        const surgeStart = WATER_TANK_CONSTANTS.surgeStartProgress
        const surgeT =
          clamped <= surgeStart
            ? 0
            : Math.min(1, (clamped - surgeStart) / (1 - surgeStart))
        const reachEase = 1 - Math.pow(1 - surgeT, 2.4)
        const currentFrontZ = 0.45 + reachEase * (surgeLength - 0.45)
        const backZ = -0.62
        const spanZ = Math.max(0.28, currentFrontZ - backZ)
        const spanX = Math.min(1.86, surgeHalfWidth * (1.28 + reachEase * 0.48))

        if (surgeGroup && surgeSheetMesh && crestMesh && surgeMat) {
          const isSurgeActive = surgeT > 0.005
          surgeGroup.visible = isSurgeActive
          const surgeOpacity = isSurgeActive ? Math.sin(surgeT * Math.PI) * 0.78 : 0
          surgeMat.opacity = Math.max(0, surgeOpacity)
          surgeSheetMesh.position.set(
            puddleCenterX * reachEase,
            0.024,
            (backZ + currentFrontZ) * 0.5
          )
          surgeSheetMesh.scale.set(spanX, spanZ, 1)

          crestMesh.position.set(
            puddleCenterX * reachEase,
            0.08 + Math.sin(surgeT * Math.PI) * 0.085,
            currentFrontZ - 0.08
          )
          crestMesh.scale.set(1, spanX * 0.9, 0.85 + Math.sin(surgeT * Math.PI) * 0.42)
        }

        if (sprayMeshes && sprayConfigs && leakMat) {
          leakMat.opacity =
            surgeT > 0.005 ? Math.sin(surgeT * Math.PI) * 0.72 : Math.max(0, 0.72 * (1 - dropFrac))
          for (let i = 0; i < sprayMeshes.length; i += 1) {
            const sc = sprayConfigs[i]
            const sp = sprayMeshes[i]
            const arcY = Math.sin(surgeT * Math.PI) * sc.arcH
            sp.position.set(
              sc.startX + (sc.endX - sc.startX) * reachEase,
              0.06 + arcY,
              0.1 + sc.reachZ * reachEase
            )
            sp.scale.setScalar(sc.baseScale * (0.55 + Math.sin(surgeT * Math.PI) * 0.65))
          }
        }

        // Smooth C0 puddle interpolation from warning(1) -> surge -> disabled
        if (puddleMesh && puddleMat) {
          puddleMesh.visible = true
          const preT = Math.min(1, clamped / surgeStart)
          const postT = surgeT > 0 ? reachEase : 0
          const preCenterZ = 0.12
          const postTargetZ = puddleCenterZ
          puddleMesh.position.set(
            puddleCenterX * postT,
            0.012,
            preCenterZ + (postTargetZ - preCenterZ) * postT
          )
          const curSX = 0.58 + preT * 0.06 + (puddleScaleX - 0.64) * postT
          const curSY = 0.66 + preT * 0.08 + (puddleScaleY - 0.74) * postT
          puddleMesh.scale.set(curSX, curSY, 1)
          puddleMat.opacity = 0.34 + preT * 0.06 + postT * 0.16
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Envelope vibrations with sin(PI * clamped) so w=0 matches dormant & w=1 hands off smoothly to active(0)
        const env = Math.sin(Math.PI * clamped)
        const sagT = clamped * clamped * (3 - 2 * clamped)
        const vibAmp = (0.008 + clamped * 0.022) * env
        const swayZ = Math.sin(clamped * Math.PI * 20) * (0.035 + clamped * 0.065) * env
        const swayX = Math.cos(clamped * Math.PI * 16) * (0.02 + clamped * 0.035) * env

        tankGroup.position.set(
          Math.sin(clamped * Math.PI * 26) * vibAmp,
          tankRestY + (warnEndY - tankRestY) * sagT + Math.cos(clamped * Math.PI * 22) * (vibAmp * 0.4),
          warnEndZ * sagT + Math.cos(clamped * Math.PI * 18) * (vibAmp * 0.45)
        )
        tankGroup.rotation.set(
          warnEndRotX * sagT + swayX,
          0,
          warnEndRotZ * sagT + swayZ
        )
        if (seamMesh) seamMesh.scale.set(1, 1, 1)

        if (brokenStraps) {
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            strap.position.y = strapRestY + (warnEndStrapY - strapRestY) * sagT
            strap.rotation.z = -sSign * 0.045 * sagT + swayZ * 0.35
            strap.rotation.x = 0
          }
        }

        if (tankDebrisGroup) tankDebrisGroup.visible = false
        if (surgeGroup) surgeGroup.visible = false
        if (surgeMat) surgeMat.opacity = 0

        // Accelerating gravity-driven dripping water & streams during warning
        const baseDripOp = WATER_TANK_CONSTANTS.dormantDripOpacity
        if (leakGroup && leakDrops && leakDropConfigs && leakMat) {
          leakGroup.visible = true
          leakMat.opacity = baseDripOp + clamped * (0.86 - baseDripOp)
          for (let i = 0; i < leakDrops.length; i += 1) {
            const cfg = leakDropConfigs[i]
            const drop = leakDrops[i]
            drop.visible = true
            const t = (clamped * (cfg.speed + clamped * 0.9) + cfg.phase) % 1
            const gravY = Math.max(0.025, cfg.startY * (1 - t * t))
            const dropScale = Math.min(1, t * 5) * (0.85 + clamped * 0.25)
            drop.position.set(cfg.x, gravY, cfg.z + t * 0.1)
            drop.scale.set(dropScale, dropScale * (1.55 + clamped * 0.35), dropScale)
          }
        }
        if (leakStreams) {
          for (let i = 0; i < leakStreams.length; i += 1) {
            const stream = leakStreams[i]
            stream.visible = clamped > 0.22
            const pulse = 0.75 + Math.abs(Math.sin(clamped * Math.PI * (14 + i * 5))) * 0.55
            stream.scale.set(pulse * (0.7 + clamped * 0.5), 2.04, pulse * (0.7 + clamped * 0.5))
          }
        }

        // Warning puddle starts smoothly from opacity 0 at w=0 up to warning(1) pose
        if (puddleMesh && puddleMat) {
          puddleMesh.visible = clamped > 0.005
          puddleMesh.position.set(0, 0.012, 0.12)
          const sx = 0.14 + sagT * 0.44
          const sy = 0.16 + sagT * 0.5
          puddleMesh.scale.set(sx, sy, 1)
          puddleMat.opacity = clamped * 0.34
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — intact suspended industrial tank with continuous gravity-driven slow drip
      tankGroup.position.set(0, tankRestY, 0)
      tankGroup.rotation.set(0, 0, 0)
      if (seamMesh) seamMesh.scale.set(1, 1, 1)

      if (brokenStraps) {
        for (let i = 0; i < brokenStraps.length; i += 1) {
          const strap = brokenStraps[i]
          strap.position.y = strapRestY
          strap.rotation.set(0, 0, 0)
        }
      }

      if (tankDebrisGroup) tankDebrisGroup.visible = false
      if (surgeGroup) surgeGroup.visible = false
      if (surgeMat) surgeMat.opacity = 0
      if (puddleMesh) puddleMesh.visible = false
      if (puddleMat) puddleMat.opacity = 0

      if (leakGroup && leakDrops && leakDropConfigs && leakMat) {
        leakGroup.visible = true
        leakMat.opacity = WATER_TANK_CONSTANTS.dormantDripOpacity
        const p = Number.isFinite(progress) ? progress : 0
        const rawCycle = p % 1
        const cycle = rawCycle < 0 ? rawCycle + 1 : rawCycle
        const duty = WATER_TANK_CONSTANTS.dormantDripDuty || 0.58
        for (let i = 0; i < leakDrops.length; i += 1) {
          const drop = leakDrops[i]
          const cfg = leakDropConfigs[i]
          if (i === 0 && cycle < duty) {
            const u = cycle / duty
            const dropY = Math.max(0.025, cfg.startY * (1 - u * u))
            const detachScale = Math.min(1, u * 4.5) * (1 - Math.max(0, u - 0.9) * 5)
            drop.visible = detachScale > 1e-4
            drop.position.set(cfg.x, dropY, cfg.z)
            drop.scale.set(
              0.56 * detachScale,
              1.12 * detachScale,
              0.56 * detachScale
            )
          } else {
            drop.visible = false
          }
        }
      }
      if (leakStreams) {
        for (let i = 0; i < leakStreams.length; i += 1) leakStreams[i].visible = false
      }

      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY: {
      const {
        pivotY = SUSPENDED_MACHINERY_CONSTANTS.pivotY,
        restDropY = SUSPENDED_MACHINERY_CONSTANTS.machineryRestY -
          SUSPENDED_MACHINERY_CONSTANTS.pivotY,
        fallenY = SUSPENDED_MACHINERY_CONSTANTS.fallenY,
        impactLocalZ = SUSPENDED_MACHINERY_CONSTANTS.impactLocalZ,
        sideSign = 1,
        fallenLocalX = SUSPENDED_MACHINERY_CONSTANTS.fallenLocalX,
        fallenLocalZ = SUSPENDED_MACHINERY_CONSTANTS.fallenLocalZ,
        fallenRy = SUSPENDED_MACHINERY_CONSTANTS.fallenRy,
        clearedLocalX = SUSPENDED_MACHINERY_CONSTANTS.clearedLocalX,
        clearedLocalZ = SUSPENDED_MACHINERY_CONSTANTS.clearedLocalZ,
        clearedRy = SUSPENDED_MACHINERY_CONSTANTS.clearedRy,
        trolleyGroup,
        rearCable,
        frontCable,
        rearCableStub,
        frontCableStub,
        machinePivotGroup,
        machineBodyGroup,
        warnBoltGroup,
        warnBoltMeshes,
        warnBoltConfigs,
        impactDebrisGroup,
        impactDebrisMeshes,
        impactDebrisConfigs,
        impactDustGroup,
        impactDustMeshes,
        impactDustConfigs,
        dustMat,
      } = data
      if (!machinePivotGroup || !machineBodyGroup) return

      const sSign = sideSign >= 0 ? 1 : -1
      const fallenLocalY = fallenY - pivotY
      const halfAx = 0.46
      const halfAy = 0.3
      const halfAz = 0.33
      const bodyCenterOffsetY = 0.035

      // Deterministic warning-end pose (handed off identically to active(0) with zero snap)
      const warnEndX = sSign * 0.04
      const warnEndY = restDropY - 0.09
      const warnEndZ = 0.08
      const warnEndRx = 0.14
      const warnEndRz = -sSign * 0.06
      const warnEndTrolleyZ = 0.07
      const warnEndTrolleyRx = 0.04

      const impactX = sSign * 0.68
      const impactZ = impactLocalZ
      const impactRx = Math.PI * 0.5
      const impactRy = sSign * 1.18
      const settledTrolleyZ = 0.14
      const settledTrolleyRx = 0.08
      const settledTrolleyRz = -sSign * 0.06

      // Helper: transforms a body-local point into mount-local space & aims top-pivoted cable directly to shackle
      const aimTopCableToShackle = (cableMesh, shackleLocalZ, trolleyZ, trolleyRx, trolleyRz, radiusScale = 1) => {
        if (!cableMesh) return { rx: 0, rz: 0, len: 0.24 }
        // Sheave pin in mount space (rotation applied around trolleyGroup pivot)
        const syOff = -0.12
        const szOff = shackleLocalZ
        const cosTrX = Math.cos(trolleyRx)
        const sinTrX = Math.sin(trolleyRx)
        const ty1 = syOff * cosTrX - szOff * sinTrX
        const tz1 = syOff * sinTrX + szOff * cosTrX
        const cosTrZ = Math.cos(trolleyRz)
        const sinTrZ = Math.sin(trolleyRz)
        const topX = trolleyGroup.position.x - ty1 * sinTrZ
        const topY = trolleyGroup.position.y + ty1 * cosTrZ
        const topZ = trolleyZ + tz1

        // Shackle center in machineBodyGroup -> machinePivotGroup -> mount space
        const shX = 0
        const shY = 0.265
        const shZ = shackleLocalZ
        // Apply machineBodyGroup Euler (YXZ so side-tip rx and horizontal yaw ry match visual pose)
        _slabEuler.set(
          machineBodyGroup.rotation.x,
          machineBodyGroup.rotation.y,
          machineBodyGroup.rotation.z,
          machineBodyGroup.rotation.order || 'YXZ'
        )
        _slabRotMat.makeRotationFromEuler(_slabEuler)
        const b = _slabRotMat.elements
        const bx = machineBodyGroup.position.x + b[0] * shX + b[4] * shY + b[8] * shZ
        const by = machineBodyGroup.position.y + b[1] * shX + b[5] * shY + b[9] * shZ
        const bz = machineBodyGroup.position.z + b[2] * shX + b[6] * shY + b[10] * shZ

        // Apply machinePivotGroup Euler XYZ
        _slabEuler.set(
          machinePivotGroup.rotation.x,
          machinePivotGroup.rotation.y,
          machinePivotGroup.rotation.z,
          'XYZ'
        )
        _slabRotMat.makeRotationFromEuler(_slabEuler)
        const pM = _slabRotMat.elements
        const botX = machinePivotGroup.position.x + pM[0] * bx + pM[4] * by + pM[8] * bz
        const botY = machinePivotGroup.position.y + pM[1] * bx + pM[5] * by + pM[9] * bz
        const botZ = machinePivotGroup.position.z + pM[2] * bx + pM[6] * by + pM[10] * bz

        const dx = botX - topX
        const dy = botY - topY
        const dz = botZ - topZ
        const len = Math.max(0.05, Math.hypot(dx, dy, dz))
        const ux = dx / len
        const uy = dy / len
        const uz = dz / len
        const rz = Math.asin(Math.max(-0.999, Math.min(0.999, ux)))
        const rx = Math.atan2(-uz, -uy)

        cableMesh.position.set(topX, topY, topZ)
        cableMesh.rotation.set(rx, 0, rz)
        cableMesh.scale.set(radiusScale, len, radiusScale)
        return { topX, topY, topZ, rx, rz, len, ux, uy, uz }
      }

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        const isCleared = Boolean(data.isAftermathCleared)
        machinePivotGroup.position.set(0, pivotY, 0)
        machinePivotGroup.rotation.set(0, 0, 0)
        machineBodyGroup.position.set(
          isCleared ? clearedLocalX : fallenLocalX,
          fallenLocalY,
          isCleared ? clearedLocalZ : fallenLocalZ
        )
        machineBodyGroup.rotation.set(
          Math.PI * 0.5,
          isCleared ? clearedRy : fallenRy,
          0
        )

        if (trolleyGroup) {
          trolleyGroup.position.set(0, pivotY, settledTrolleyZ)
          trolleyGroup.rotation.set(settledTrolleyRx, 0, settledTrolleyRz)
        }
        if (rearCable) {
          rearCable.position.set(0, pivotY - 0.12, settledTrolleyZ - 0.22)
          rearCable.rotation.set(-0.22, 0, 0.14)
          rearCable.scale.set(1, 0.22, 1)
        }
        if (frontCable) {
          frontCable.position.set(0, pivotY - 0.12, settledTrolleyZ + 0.22)
          frontCable.rotation.set(0.18, 0, -0.1)
          frontCable.scale.set(1, 0.2, 1)
        }
        if (rearCableStub) {
          rearCableStub.visible = true
          rearCableStub.rotation.set(0.55, 0, -sSign * 0.25)
          rearCableStub.scale.set(1, 0.11, 1)
        }
        if (frontCableStub) {
          frontCableStub.visible = true
          frontCableStub.rotation.set(-0.48, 0, sSign * 0.22)
          frontCableStub.scale.set(1, 0.12, 1)
        }

        if (warnBoltGroup) warnBoltGroup.visible = false
        if (impactDustGroup) impactDustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (impactDebrisGroup && impactDebrisMeshes && impactDebrisConfigs) {
          impactDebrisGroup.visible = true
          for (let i = 0; i < impactDebrisMeshes.length; i += 1) {
            const dc = impactDebrisConfigs[i]
            const frag = impactDebrisMeshes[i]
            frag.position.set(
              isCleared ? dc.clearX : dc.endX,
              0.028,
              isCleared ? dc.clearZ : dc.endZ
            )
            frag.rotation.set(0.18, dc.rotY, 0.12)
          }
        }
        data._visualStateKey = isCleared ? 'disabled:cleared' : 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const impactProg = SUSPENDED_MACHINERY_CONSTANTS.impactProgress // 0.52
        const settleEndProg = 0.78
        const rearSnapP = 0.04
        const frontSnapP = 0.16

        machinePivotGroup.position.set(0, pivotY, 0)
        machinePivotGroup.rotation.set(0, 0, 0)

        // Trolley motion: continuous from warning(1) -> surge on front-cable catch -> rest at 0.35
        const trolleyT = Math.min(1, clamped / 0.35)
        const trolleyKick = Math.sin(trolleyT * Math.PI) * 0.04
        const curTrolleyZ =
          warnEndTrolleyZ + (settledTrolleyZ - warnEndTrolleyZ) * trolleyT + trolleyKick
        const curTrolleyRx =
          warnEndTrolleyRx + (settledTrolleyRx - warnEndTrolleyRx) * trolleyT + trolleyKick * 1.1
        const curTrolleyRz = settledTrolleyRz * trolleyT
        if (trolleyGroup) {
          trolleyGroup.position.set(0, pivotY, curTrolleyZ)
          trolleyGroup.rotation.set(curTrolleyRx, 0, curTrolleyRz)
        }

        const computeBodyMinCenterY = (rx, ry, rz) => {
          _slabEuler.set(rx, ry, rz, 'YXZ')
          _slabRotMat.makeRotationFromEuler(_slabEuler)
          const m = _slabRotMat.elements
          return (
            Math.abs(m[1]) * halfAx +
            Math.abs(m[5]) * halfAy +
            Math.abs(m[9]) * halfAz -
            m[5] * bodyCenterOffsetY +
            0.008
          )
        }

        // Phase 1 [0 .. 0.52]: continuous gravity fall + rotational tumble onto impact pose
        // Phase 2 (0.52 .. 0.78]: damped bounce + side-biased roll settle to fallen pose
        // Phase 3 (0.78 .. 1.00]: settled resting pose matching disabled
        if (clamped <= impactProg) {
          const dropT = clamped / impactProg
          const smooth = dropT * dropT * (3 - 2 * dropT)
          const grav = dropT * dropT
          const rx = warnEndRx + (impactRx - warnEndRx) * smooth
          const ry = impactRy * smooth
          const rz = warnEndRz * (1 - smooth)
          const bx = warnEndX + (impactX - warnEndX) * smooth
          const bz = warnEndZ + (impactZ - warnEndZ) * Math.sin(dropT * Math.PI * 0.5)
          const rawY = warnEndY + (fallenLocalY - warnEndY) * grav

          const by = Math.max(computeBodyMinCenterY(rx, ry, rz) - pivotY, rawY)

          machineBodyGroup.position.set(bx, by, bz)
          machineBodyGroup.rotation.set(rx, ry, rz)
        } else if (clamped <= settleEndProg) {
          const settleT = (clamped - impactProg) / (settleEndProg - impactProg)
          const sEase = settleT * settleT * (3 - 2 * settleT)
          const bounce = Math.sin(settleT * Math.PI) * (1 - settleT) * 0.055
          const rx = impactRx
          const ry = impactRy + (fallenRy - impactRy) * sEase
          const by = Math.max(
            computeBodyMinCenterY(rx, ry, 0) - pivotY,
            fallenLocalY + bounce
          )
          machineBodyGroup.position.set(
            impactX + (fallenLocalX - impactX) * sEase,
            by,
            impactZ + (fallenLocalZ - impactZ) * sEase
          )
          machineBodyGroup.rotation.set(rx, ry, 0)
        } else {
          machineBodyGroup.position.set(fallenLocalX, fallenLocalY, fallenLocalZ)
          machineBodyGroup.rotation.set(Math.PI * 0.5, fallenRy, 0)
        }

        // Dynamic continuous cable snapping (taut until snap -> smooth length split & whip -> hang)
        if (clamped <= rearSnapP) {
          aimTopCableToShackle(rearCable, -0.22, curTrolleyZ, curTrolleyRx, curTrolleyRz, 0.78)
          if (rearCableStub) rearCableStub.visible = false
        } else {
          const whipT = Math.min(1, (clamped - rearSnapP) / (1 - rearSnapP))
          const splitT = Math.min(1, (clamped - rearSnapP) / 0.06)
          // Whip kicks backward/upward cleanly (|rx| > 0.45 at p=0.55) and damps to -0.22 rest hang
          const kickWave = Math.sin(whipT * Math.PI * 1.35) * Math.exp(-whipT * 1.15)
          const curRx = -0.22 * whipT - 0.85 * kickWave
          const curRz = 0.14 * whipT + 0.24 * kickWave
          if (rearCable) {
            rearCable.position.set(0, pivotY - 0.12, curTrolleyZ - 0.22)
            rearCable.rotation.set(curRx, 0, curRz)
            rearCable.scale.set(0.88 + 0.12 * splitT, 0.34 - 0.12 * splitT, 0.88 + 0.12 * splitT)
          }
          if (rearCableStub) {
            rearCableStub.visible = true
            rearCableStub.rotation.set(0.55 * splitT, 0, -sSign * 0.25 * splitT)
            rearCableStub.scale.set(1, 0.11, 1)
          }
        }

        if (clamped <= frontSnapP) {
          aimTopCableToShackle(frontCable, 0.22, curTrolleyZ, curTrolleyRx, curTrolleyRz, 0.85)
          if (frontCableStub) frontCableStub.visible = false
        } else {
          const whipT = Math.min(1, (clamped - frontSnapP) / (1 - frontSnapP))
          const splitT = Math.min(1, (clamped - frontSnapP) / 0.06)
          const kickWave = Math.sin(whipT * Math.PI * 1.25) * Math.exp(-whipT * 1.25)
          const curRx = 0.18 * whipT + 0.62 * kickWave
          const curRz = -0.1 * whipT - 0.18 * kickWave
          if (frontCable) {
            frontCable.position.set(0, pivotY - 0.12, curTrolleyZ + 0.22)
            frontCable.rotation.set(curRx, 0, curRz)
            frontCable.scale.set(0.9 + 0.1 * splitT, 0.32 - 0.12 * splitT, 0.9 + 0.1 * splitT)
          }
          if (frontCableStub) {
            frontCableStub.visible = true
            frontCableStub.rotation.set(-0.48 * splitT, 0, sSign * 0.22 * splitT)
            frontCableStub.scale.set(1, 0.12, 1)
          }
        }

        if (warnBoltGroup) warnBoltGroup.visible = false

        const impactT = clamped <= 0.36 ? 0 : Math.min(1, (clamped - 0.36) / 0.64)
        if (impactDebrisGroup && impactDebrisMeshes && impactDebrisConfigs) {
          impactDebrisGroup.visible = impactT > 0.01
          for (let i = 0; i < impactDebrisMeshes.length; i += 1) {
            const dc = impactDebrisConfigs[i]
            const frag = impactDebrisMeshes[i]
            const arcY = Math.sin(impactT * Math.PI) * dc.arcH
            frag.position.set(
              dc.startX + (dc.endX - dc.startX) * impactT,
              0.028 + (dc.startY - 0.028) * (1 - impactT) * (1 - impactT) + arcY,
              dc.startZ + (dc.endZ - dc.startZ) * impactT
            )
            frag.rotation.set(impactT * 3.0, dc.rotY, impactT * 2.2)
          }
        }

        if (impactDustGroup && impactDustMeshes && impactDustConfigs && dustMat) {
          impactDustGroup.visible = impactT > 0.01
          dustMat.opacity = impactT > 0.01 ? Math.max(0, Math.sin(impactT * Math.PI) * 0.5) : 0
          for (let i = 0; i < impactDustMeshes.length; i += 1) {
            const dc = impactDustConfigs[i]
            const puff = impactDustMeshes[i]
            puff.position.set(
              fallenLocalX * 0.25 + dc.dx * (0.25 + impactT * 0.75),
              0.12 + dc.riseY * impactT,
              dc.dz * (0.4 + impactT * 0.6)
            )
            puff.scale.setScalar(dc.baseScale * (0.5 + impactT * 1.25))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Envelope oscillatory sway/vibration so p=0 matches dormant and p=1 hands off cleanly to active(0)
        const env = Math.sin(Math.PI * clamped)
        const strain = clamped * clamped * (3 - 2 * clamped)
        const swayAmp = 0.045 + clamped * 0.095
        const swayPitch = Math.sin(clamped * Math.PI * 10) * swayAmp * env
        const swayRoll = Math.cos(clamped * Math.PI * 8) * (0.025 + clamped * 0.05) * env
        const vibX = Math.sin(clamped * Math.PI * 28) * (0.005 + clamped * 0.012) * env
        const vibY = Math.cos(clamped * Math.PI * 22) * 0.004 * env

        machinePivotGroup.position.set(vibX, pivotY + vibY, 0)
        machinePivotGroup.rotation.set(-swayPitch, 0, swayRoll)

        machineBodyGroup.position.set(
          warnEndX * strain,
          restDropY + (warnEndY - restDropY) * strain,
          warnEndZ * strain
        )
        machineBodyGroup.rotation.set(warnEndRx * strain, 0, warnEndRz * strain)

        const curTrolleyZ = warnEndTrolleyZ * strain
        const curTrolleyRx = warnEndTrolleyRx * strain
        if (trolleyGroup) {
          trolleyGroup.position.set(vibX * 0.5, pivotY, curTrolleyZ)
          trolleyGroup.rotation.set(curTrolleyRx, 0, swayRoll * 0.25)
        }

        // Dynamic hoist cables stay seamlessly anchored to trolley sheaves & machinery shackles while straining
        aimTopCableToShackle(rearCable, -0.22, curTrolleyZ, curTrolleyRx, swayRoll * 0.25, 1 - 0.22 * strain)
        aimTopCableToShackle(frontCable, 0.22, curTrolleyZ, curTrolleyRx, swayRoll * 0.25, 1 - 0.15 * strain)
        if (rearCableStub) rearCableStub.visible = false
        if (frontCableStub) frontCableStub.visible = false

        if (impactDebrisGroup) impactDebrisGroup.visible = false
        if (impactDustGroup) impactDustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (warnBoltGroup && warnBoltMeshes && warnBoltConfigs) {
          warnBoltGroup.visible = clamped > 0.02
          for (let i = 0; i < warnBoltMeshes.length; i += 1) {
            const wc = warnBoltConfigs[i]
            const bolt = warnBoltMeshes[i]
            const t = (clamped * wc.speed + wc.phase) % 1
            bolt.position.set(
              wc.x + Math.sin(t * Math.PI * 4 + i) * 0.04,
              Math.max(0.04, wc.startY * (1 - t * t)),
              wc.z + t * 0.22
            )
            bolt.rotation.set(t * 4.2, i * 0.9, t * 3.1)
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — heavy machinery suspended cleanly from overhead gantry rail
      machinePivotGroup.position.set(0, pivotY, 0)
      machinePivotGroup.rotation.set(0, 0, 0)
      machineBodyGroup.position.set(0, restDropY, 0)
      machineBodyGroup.rotation.set(0, 0, 0)

      if (trolleyGroup) {
        trolleyGroup.position.set(0, pivotY, 0)
        trolleyGroup.rotation.set(0, 0, 0)
      }
      aimTopCableToShackle(rearCable, -0.22, 0, 0, 0, 1)
      aimTopCableToShackle(frontCable, 0.22, 0, 0, 0, 1)
      if (rearCableStub) rearCableStub.visible = false
      if (frontCableStub) frontCableStub.visible = false

      if (warnBoltGroup) warnBoltGroup.visible = false
      if (impactDebrisGroup) impactDebrisGroup.visible = false
      if (impactDustGroup) impactDustGroup.visible = false
      if (dustMat) dustMat.opacity = 0

      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE: {
      const {
        ductRestY = VENTILATION_DUCT_CONSTANTS.ductRestY,
        ceilingAnchorY = VENTILATION_DUCT_CONSTANTS.ceilingAnchorY,
        hangerPivotY = ceilingAnchorY,
        sideSign = 1,
        hangerZ = VENTILATION_DUCT_CONSTANTS.hangerZ,
        pivotZ = VENTILATION_DUCT_CONSTANTS.pivotZ,
        bodyOffsetZ = VENTILATION_DUCT_CONSTANTS.bodyOffsetZ,
        fallenY = VENTILATION_DUCT_CONSTANTS.fallenY,
        impactLocalZ = VENTILATION_DUCT_CONSTANTS.impactLocalZ,
        fallenLocalX = sideSign * VENTILATION_DUCT_CONSTANTS.fallenLocalX,
        fallenLocalZ = VENTILATION_DUCT_CONSTANTS.fallenLocalZ,
        fallenRy = sideSign * VENTILATION_DUCT_CONSTANTS.fallenRy,
        clearedLocalX = sideSign * VENTILATION_DUCT_CONSTANTS.clearedLocalX,
        clearedLocalZ = VENTILATION_DUCT_CONSTANTS.clearedLocalZ,
        clearedRy = sideSign * VENTILATION_DUCT_CONSTANTS.clearedRy,
        ductWidth = VENTILATION_DUCT_CONSTANTS.ductWidth,
        ductHeight = VENTILATION_DUCT_CONSTANTS.ductHeight,
        ductLen = VENTILATION_DUCT_CONSTANTS.ductLen,
        rearHangerGroup,
        frontHangerGroup,
        ductPivotGroup,
        ductBodyGroup,
        warnScrewGroup,
        warnScrewMeshes,
        warnScrewConfigs,
        warnDustGroup,
        warnDustMeshes,
        warnDustConfigs,
        warnDustMat,
        ductDebrisGroup,
        ductDebrisMeshes,
        ductDebrisConfigs,
        ductImpactDustGroup,
        ductImpactDustMeshes,
        ductImpactDustConfigs,
        ductImpactDustMat,
      } = data
      if (!ductPivotGroup || !ductBodyGroup) return

      const sSign = sideSign >= 0 ? 1 : -1
      const isCleared = Boolean(data.isAftermathCleared)
      const fallenLocalY = fallenY - ductRestY
      const fallenBodyZ = fallenLocalZ - pivotZ
      const clearedBodyZ = clearedLocalZ - pivotZ
      const impactMountX = sSign * 0.42
      const impactMountZ = impactLocalZ
      const impactRx = 0.06
      const impactRy = sSign * 0.08
      const impactRz = -sSign * 0.05

      // End-of-warning canonical pose (zero rattle offset at p = 0 and p = 1)
      const warnEndPivotDrop = 0.05
      const warnEndSagPitch = 0.16
      const warnEndRearDrop = 0.03
      const warnEndRearRx = 0.04
      const warnEndFrontDrop = 0.08
      const warnEndFrontRx = -0.12
      const warnEndFrontRz = sSign * 0.16

      // Outer box half-extents of ductBodyGroup (flanges + main duct + bottom grille)
      const halfAx = (ductWidth + 0.06) * 0.5 // 0.36
      const halfAy = (ductHeight + 0.06) * 0.5 // 0.17
      const halfAz = ductLen * 0.5 + 0.015 // 0.915
      const computeDuctMinCenterY = (rx, ry, rz) => {
        _slabEuler.set(rx, ry, rz, 'YXZ')
        _slabRotMat.makeRotationFromEuler(_slabEuler)
        const m = _slabRotMat.elements
        return (
          Math.abs(m[1]) * halfAx +
          Math.abs(m[5]) * halfAy +
          Math.abs(m[9]) * halfAz +
          0.004
        )
      }

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        ductPivotGroup.position.set(0, ductRestY, pivotZ)
        ductPivotGroup.rotation.set(0, 0, 0)
        ductBodyGroup.position.set(
          isCleared ? clearedLocalX : fallenLocalX,
          fallenLocalY,
          isCleared ? clearedBodyZ : fallenBodyZ
        )
        ductBodyGroup.rotation.set(0, isCleared ? clearedRy : fallenRy, 0)

        if (rearHangerGroup) {
          rearHangerGroup.position.set(0, hangerPivotY - 0.05, -hangerZ)
          rearHangerGroup.rotation.set(0.12, 0, -sSign * 0.08)
        }
        if (frontHangerGroup) {
          frontHangerGroup.position.set(sSign * 0.04, hangerPivotY - 0.24, hangerZ)
          frontHangerGroup.rotation.set(-0.48, 0, sSign * 0.52)
        }

        if (warnScrewGroup) warnScrewGroup.visible = false
        if (warnDustGroup) warnDustGroup.visible = false
        if (warnDustMat) warnDustMat.opacity = 0
        if (ductImpactDustGroup) ductImpactDustGroup.visible = false
        if (ductImpactDustMat) ductImpactDustMat.opacity = 0

        if (ductDebrisGroup && ductDebrisMeshes && ductDebrisConfigs) {
          ductDebrisGroup.visible = true
          for (let i = 0; i < ductDebrisMeshes.length; i += 1) {
            const dc = ductDebrisConfigs[i]
            const shard = ductDebrisMeshes[i]
            shard.position.set(
              isCleared ? dc.clearX : dc.endX,
              0.018,
              isCleared ? dc.clearZ : dc.endZ
            )
            shard.rotation.set(0.14, dc.rotY, 0.1)
          }
        }
        data._visualStateKey = isCleared ? 'disabled:cleared' : 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const impactProg = VENTILATION_DUCT_CONSTANTS.impactProgress // 0.48
        const settleEndProg = 0.76

        // Continuous warning(1) mount-space center of ductBodyGroup at active(0)
        const warn1Y = ductRestY - warnEndPivotDrop - bodyOffsetZ * Math.sin(warnEndSagPitch)
        const warn1Z = pivotZ + bodyOffsetZ * Math.cos(warnEndSagPitch)

        let targetMx
        let targetMy
        let targetMz
        let targetRx
        let targetRy
        let targetRz

        // Phase 1 [0 .. 0.48]: C0 handoff from warning(1) + gravity acceleration onto corridor floor
        // Phase 2 (0.48 .. 0.76]: damped floor bounce + lateral settle onto side-biased fallen pose
        // Phase 3 (0.76 .. 1.00]: settled resting wreckage pose matching disabled
        if (clamped <= impactProg) {
          const dropT = clamped / impactProg
          const smooth = dropT * dropT * (3 - 2 * dropT)
          const grav = dropT * dropT
          const tumbleWave = Math.sin(dropT * Math.PI) * 0.22
          targetRx = warnEndSagPitch + (impactRx - warnEndSagPitch) * smooth + tumbleWave
          targetRy = impactRy * smooth
          targetRz = impactRz * smooth
          targetMx = impactMountX * grav
          targetMz = warn1Z + (impactMountZ - warn1Z) * Math.sin(dropT * Math.PI * 0.5)
          const minY = computeDuctMinCenterY(targetRx, targetRy, targetRz)
          const rawY = warn1Y + (Math.max(fallenY, minY) - warn1Y) * grav
          targetMy = Math.max(minY, rawY)
        } else if (clamped <= settleEndProg) {
          const settleT = (clamped - impactProg) / (settleEndProg - impactProg)
          const sEase = settleT * settleT * (3 - 2 * settleT)
          const damp = 1 - sEase
          const bounce = Math.sin(settleT * Math.PI) * (1 - settleT) * 0.045
          targetRx = impactRx * damp
          targetRy = impactRy + (fallenRy - impactRy) * sEase
          targetRz = impactRz * damp
          const minY = computeDuctMinCenterY(targetRx, targetRy, targetRz)
          targetMx = impactMountX + (fallenLocalX - impactMountX) * sEase
          targetMz = impactMountZ + (fallenLocalZ - impactMountZ) * sEase
          targetMy = Math.max(minY, fallenY + bounce)
        } else {
          targetMx = fallenLocalX
          targetMy = fallenY
          targetMz = fallenLocalZ
          targetRx = 0
          targetRy = fallenRy
          targetRz = 0
        }

        // Smoothly return hinge pivot from warning(1) sag to resting alignment over [0 .. 0.22]
        // while solving the exact inverse local transform for ductBodyGroup so world/mount pose stays exact.
        const pivotT = Math.min(1, clamped / 0.22)
        const pivotEase = pivotT * pivotT * (3 - 2 * pivotT)
        const curPivotY = (ductRestY - warnEndPivotDrop) * (1 - pivotEase) + ductRestY * pivotEase
        const curPivotRx = warnEndSagPitch * (1 - pivotEase)

        ductPivotGroup.position.set(0, curPivotY, pivotZ)
        ductPivotGroup.rotation.set(curPivotRx, 0, 0)

        const dx = targetMx
        const dy = targetMy - curPivotY
        const dz = targetMz - pivotZ
        const cosP = Math.cos(curPivotRx)
        const sinP = Math.sin(curPivotRx)
        const localY = dy * cosP + dz * sinP
        const localZ = -dy * sinP + dz * cosP

        _ductTargetEuler.set(targetRx, targetRy, targetRz)
        _ductTargetQuat.setFromEuler(_ductTargetEuler)
        _ductPivotInvEuler.set(-curPivotRx, 0, 0)
        _ductPivotInvQuat.setFromEuler(_ductPivotInvEuler)
        _ductLocalQuat.multiplyQuaternions(_ductPivotInvQuat, _ductTargetQuat)
        _ductLocalEuler.setFromQuaternion(_ductLocalQuat, 'YXZ')

        ductBodyGroup.position.set(dx, localY, localZ)
        ductBodyGroup.rotation.copy(_ductLocalEuler)

        // Hangers continue smoothly from warning(1) -> bent/snapped without upward ceiling penetration
        const bendT = Math.min(1, clamped / 0.42)
        const snapT = Math.min(1, clamped / 0.28)
        if (rearHangerGroup) {
          rearHangerGroup.position.set(
            0,
            hangerPivotY - warnEndRearDrop - 0.02 * bendT,
            -hangerZ
          )
          rearHangerGroup.rotation.set(
            warnEndRearRx + 0.08 * bendT,
            0,
            -sSign * 0.08 * bendT
          )
        }
        if (frontHangerGroup) {
          frontHangerGroup.position.set(
            sSign * 0.04 * snapT,
            hangerPivotY - warnEndFrontDrop - 0.16 * snapT,
            hangerZ
          )
          frontHangerGroup.rotation.set(
            warnEndFrontRx - 0.36 * snapT,
            0,
            warnEndFrontRz + sSign * 0.36 * snapT
          )
        }

        if (warnScrewGroup) warnScrewGroup.visible = false
        if (warnDustGroup) warnDustGroup.visible = false
        if (warnDustMat) warnDustMat.opacity = 0

        const impactT = clamped <= 0.38 ? 0 : Math.min(1, (clamped - 0.38) / 0.62)
        if (ductDebrisGroup && ductDebrisMeshes && ductDebrisConfigs) {
          ductDebrisGroup.visible = impactT > 0.01
          for (let i = 0; i < ductDebrisMeshes.length; i += 1) {
            const dc = ductDebrisConfigs[i]
            const shard = ductDebrisMeshes[i]
            const arcY = Math.sin(impactT * Math.PI) * dc.arcH
            shard.position.set(
              dc.startX + (dc.endX - dc.startX) * impactT,
              0.018 + (dc.startY - 0.018) * (1 - impactT) * (1 - impactT) + arcY,
              dc.startZ + (dc.endZ - dc.startZ) * impactT
            )
            shard.rotation.set(impactT * 3.1, dc.rotY, impactT * 2.0)
          }
        }

        if (ductImpactDustGroup && ductImpactDustMeshes && ductImpactDustConfigs && ductImpactDustMat) {
          ductImpactDustGroup.visible = impactT > 0.01
          ductImpactDustMat.opacity =
            impactT > 0.01 ? Math.max(0, Math.sin(impactT * Math.PI) * 0.54) : 0
          for (let i = 0; i < ductImpactDustMeshes.length; i += 1) {
            const dc = ductImpactDustConfigs[i]
            const puff = ductImpactDustMeshes[i]
            puff.position.set(
              dc.dx * (0.28 + impactT * 0.82),
              0.12 + dc.riseY * impactT,
              dc.dz * (0.42 + impactT * 0.58)
            )
            puff.scale.setScalar(dc.baseScale * (0.55 + impactT * 1.25))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        // C0 envelope so p=0 matches dormant and p=1 matches active(0) with monotonic sag
        const strain = clamped * clamped * (3 - 2 * clamped)
        const env = Math.sin(Math.PI * clamped)
        const rattleX = Math.sin(clamped * Math.PI * 30) * (0.01 + clamped * 0.02) * env
        const rattleRoll = Math.cos(clamped * Math.PI * 24) * 0.036 * env
        const sagPitch =
          warnEndSagPitch * strain + Math.sin(clamped * Math.PI * 18) * 0.012 * env

        ductPivotGroup.position.set(
          rattleX * 0.5,
          ductRestY - warnEndPivotDrop * strain,
          pivotZ
        )
        ductPivotGroup.rotation.set(sagPitch, 0, rattleRoll)
        ductBodyGroup.position.set(rattleX, 0, bodyOffsetZ)
        ductBodyGroup.rotation.set(0, 0, rattleRoll * 0.5)

        if (rearHangerGroup) {
          rearHangerGroup.position.set(0, hangerPivotY - warnEndRearDrop * strain, -hangerZ)
          rearHangerGroup.rotation.set(warnEndRearRx * strain, 0, rattleRoll * 0.3)
        }
        if (frontHangerGroup) {
          frontHangerGroup.position.set(
            rattleX * 0.35,
            hangerPivotY - warnEndFrontDrop * strain,
            hangerZ
          )
          frontHangerGroup.rotation.set(
            warnEndFrontRx * strain,
            0,
            warnEndFrontRz * strain + rattleRoll * 0.6
          )
        }

        if (ductDebrisGroup) ductDebrisGroup.visible = false
        if (ductImpactDustGroup) ductImpactDustGroup.visible = false
        if (ductImpactDustMat) ductImpactDustMat.opacity = 0

        if (warnScrewGroup && warnScrewMeshes && warnScrewConfigs) {
          warnScrewGroup.visible = clamped > 0.02
          for (let i = 0; i < warnScrewMeshes.length; i += 1) {
            const wc = warnScrewConfigs[i]
            const screw = warnScrewMeshes[i]
            const t = (clamped * wc.speed + wc.phase) % 1
            screw.position.set(
              wc.x + Math.sin(t * Math.PI * 4 + i) * 0.035,
              Math.max(0.03, wc.startY * (1 - t * t)),
              wc.z + t * 0.14
            )
            screw.rotation.set(t * 5.0, i * 1.1, t * 3.4)
          }
        }

        if (warnDustGroup && warnDustMeshes && warnDustConfigs && warnDustMat) {
          warnDustGroup.visible = clamped > 0.02
          warnDustMat.opacity = clamped > 0.02 ? 0.18 + clamped * 0.34 : 0
          for (let i = 0; i < warnDustMeshes.length; i += 1) {
            const dc = warnDustConfigs[i]
            const puff = warnDustMeshes[i]
            const t = (clamped * dc.speed + dc.phase) % 1
            puff.position.set(
              dc.x + Math.sin(t * Math.PI * 2 + i) * 0.08,
              Math.max(0.18, dc.startY - t * 2.4),
              dc.z + t * 0.18
            )
            puff.scale.setScalar(dc.baseScale * (0.65 + t * 0.85))
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — intact galvanized duct suspended cleanly beneath ceiling girders/ribs
      ductPivotGroup.position.set(0, ductRestY, pivotZ)
      ductPivotGroup.rotation.set(0, 0, 0)
      ductBodyGroup.position.set(0, 0, bodyOffsetZ)
      ductBodyGroup.rotation.set(0, 0, 0)

      if (rearHangerGroup) {
        rearHangerGroup.position.set(0, hangerPivotY, -hangerZ)
        rearHangerGroup.rotation.set(0, 0, 0)
      }
      if (frontHangerGroup) {
        frontHangerGroup.position.set(0, hangerPivotY, hangerZ)
        frontHangerGroup.rotation.set(0, 0, 0)
      }

      if (warnScrewGroup) warnScrewGroup.visible = false
      if (warnDustGroup) warnDustGroup.visible = false
      if (warnDustMat) warnDustMat.opacity = 0
      if (ductDebrisGroup) ductDebrisGroup.visible = false
      if (ductImpactDustGroup) ductImpactDustGroup.visible = false
      if (ductImpactDustMat) ductImpactDustMat.opacity = 0

      data._visualStateKey = 'dormant'
      break
    }

    default:
      break
  }
}

/**
 * Safely disposes instance-owned hazard geometries and materials without destroying shared pools.
 */
export function disposeHazardMesh(root) {
  if (!root) return
  if (root.userData) {
    root.userData._visualStateKey = null
    root.userData.isAftermathCleared = null
    root.userData.isPermanentlyCollapsed = null
    root.userData.ceilingSaddleMesh = null
    root.userData.rubbleGroup = null
    root.userData.furnitureGroup = null
    root.userData.pipeGroup = null
    root.userData.steamMountGroup = null
    root.userData.steamSupportGroup = null
    root.userData.steamGroup = null
    root.userData.steamPipe = null
    root.userData.ruptureFlangeGroup = null
    root.userData.repairPatchGroup = null
    root.userData.leftUnionPlate = null
    root.userData.rightUnionPlate = null
    root.userData.gasketRing = null
    root.userData.valveWheelMesh = null
    root.userData.condensationGroup = null
    root.userData.condensationDrops = null
    root.userData.condensationConfigs = null
    root.userData.condensationMat = null
    root.userData.steamPlumeGroup = null
    root.userData.steamCloud = null
    root.userData.plumeLobeMeshes = null
    root.userData.plumeLobeConfigs = null
    root.userData.steamMat = null
    root.userData.sparkMeshes = null
    root.userData.sparkConfigs = null
    root.userData.arcBolts = null
    root.userData.arcGroup = null
    root.userData.sparkGroup = null
    root.userData.cableGroup = null
    root.userData.insulationGroup = null
    root.userData.dischargeGroup = null
    root.userData.breakerHandleGroup = null
    root.userData.junctionDoorGroup = null
    root.userData.mountGroup = null
    root.userData.glowMesh = null
    root.userData.tipMat = null
    root.userData.arcMat = null
    root.userData.sparkMat = null
    root.userData.glowMat = null
    root.userData.grateRoot = null
    root.userData.pitMesh = null
    root.userData.shaftMesh = null
    root.userData.subPipeMesh = null
    root.userData.curbMesh = null
    root.userData.leftLeafGroup = null
    root.userData.rightLeafGroup = null
    root.userData.bolts = null
    root.userData.boltRestPositions = null
    root.userData.brokenStubsGroup = null
    root.userData.warningFragGroup = null
    root.userData.warningFragments = null
    root.userData.warningFragConfigs = null
    root.userData.debrisGroup = null
    root.userData.debrisMeshes = null
    root.userData.debrisConfigs = null
    root.userData.dustGroup = null
    root.userData.dustMeshes = null
    root.userData.dustConfigs = null
    root.userData.dustMat = null
    root.userData.securedCoverGroup = null
    root.userData.ceilingPatchGroup = null
    root.userData.ceilingOverheadGroup = null
    root.userData.ceilingSoffitRimMesh = null
    root.userData.ceilingCrackGroup = null
    root.userData.ceilingCrackMeshes = null
    root.userData.ceilingCrackConfigs = null
    root.userData.ceilingCavityGroup = null
    root.userData.rubbleGroup = null
    root.userData.ceilingDebrisMeshes = null
    root.userData.ceilingDebrisConfigs = null
    root.userData.ceilingWarnPebbleGroup = null
    root.userData.ceilingWarnPebbles = null
    root.userData.ceilingWarnPebbleConfigs = null
    root.userData.ceilingDustGroup = null
    root.userData.ceilingDustMeshes = null
    root.userData.ceilingDustConfigs = null
    root.userData.ceilingDustMat = null
    root.userData.wallAnchorGroup = null
    root.userData.wallRemnantGroup = null
    root.userData.strainedStrapMesh = null
    root.userData.furnitureGroup = null
    root.userData.buckledLegMesh = null
    root.userData.ajarDoorMesh = null
    root.userData.looseCargoGroup = null
    root.userData.looseCargoMeshes = null
    root.userData.looseCargoConfigs = null
    root.userData.furnitureWarnSplinterGroup = null
    root.userData.furnitureWarnSplinters = null
    root.userData.furnitureWarnSplinterConfigs = null
    root.userData.furnitureDustGroup = null
    root.userData.furnitureDustMeshes = null
    root.userData.furnitureDustConfigs = null
    root.userData.furnitureDustMat = null
    root.userData.pipeMountGroup = null
    root.userData.ceilingRemnantGroup = null
    root.userData.leftStrainRod = null
    root.userData.rightStrainRod = null
    root.userData.pipeWarnFlakeGroup = null
    root.userData.pipeWarnFlakes = null
    root.userData.pipeWarnFlakeConfigs = null
    root.userData.pipeDustGroup = null
    root.userData.pipeDustMeshes = null
    root.userData.pipeDustConfigs = null
    root.userData.pipeDustMat = null
    root.userData.wallMountGroup = null
    root.userData.cavityMesh = null
    root.userData.rimGroup = null
    root.userData.rebarGroup = null
    root.userData.slabGroup = null
    root.userData.slabMeshes = null
    root.userData.slabConfigs = null
    root.userData.crackGroup = null
    root.userData.warningGroup = null
    root.userData.warningChunks = null
    root.userData.warningChunkConfigs = null
    root.userData.wallRubbleGroup = null
    root.userData.wallRubbleMeshes = null
    root.userData.wallRubbleConfigs = null
    root.userData.wallDustGroup = null
    root.userData.wallDustMeshes = null
    root.userData.wallDustConfigs = null
    root.userData.tankMountGroup = null
    root.userData.supportGroup = null
    root.userData.wallBraceGroup = null
    root.userData.brokenStraps = null
    root.userData.tankGroup = null
    root.userData.seamMesh = null
    root.userData.leakGroup = null
    root.userData.leakDrops = null
    root.userData.leakDropConfigs = null
    root.userData.leakStreams = null
    root.userData.tankDebrisGroup = null
    root.userData.tankDebrisMeshes = null
    root.userData.tankDebrisConfigs = null
    root.userData.surgeGroup = null
    root.userData.surgeSheetMesh = null
    root.userData.crestMesh = null
    root.userData.sprayMeshes = null
    root.userData.sprayConfigs = null
    root.userData.puddleMesh = null
    root.userData.leakMat = null
    root.userData.surgeMat = null
    root.userData.puddleMat = null
    root.userData.machineryMountGroup = null
    root.userData.gantryGroup = null
    root.userData.ceilingHangerGroup = null
    root.userData.wallBracketsGroup = null
    root.userData.trolleyGroup = null
    root.userData.rearCable = null
    root.userData.frontCable = null
    root.userData.rearCableStub = null
    root.userData.frontCableStub = null
    root.userData.machinePivotGroup = null
    root.userData.machineBodyGroup = null
    root.userData.warnBoltGroup = null
    root.userData.warnBoltMeshes = null
    root.userData.warnBoltConfigs = null
    root.userData.impactDebrisGroup = null
    root.userData.impactDebrisMeshes = null
    root.userData.impactDebrisConfigs = null
    root.userData.impactDustGroup = null
    root.userData.impactDustMeshes = null
    root.userData.impactDustConfigs = null
    root.userData.ductMountGroup = null
    root.userData.ceilingRigGroup = null
    root.userData.wallBulkheadGroup = null
    root.userData.rearHangerGroup = null
    root.userData.frontHangerGroup = null
    root.userData.ductPivotGroup = null
    root.userData.ductBodyGroup = null
    root.userData.warnScrewGroup = null
    root.userData.warnScrewMeshes = null
    root.userData.warnScrewConfigs = null
    root.userData.warnDustGroup = null
    root.userData.warnDustMeshes = null
    root.userData.warnDustConfigs = null
    root.userData.warnDustMat = null
    root.userData.ductDebrisGroup = null
    root.userData.ductDebrisMeshes = null
    root.userData.ductDebrisConfigs = null
    root.userData.ductImpactDustGroup = null
    root.userData.ductImpactDustMeshes = null
    root.userData.ductImpactDustConfigs = null
    root.userData.ductImpactDustMat = null
  }
  const geos = new Set()
  const mats = new Set()

  root.traverse((node) => {
    if (node.geometry && !isSharedResource(node.geometry)) {
      geos.add(node.geometry)
    }
    if (node.material) {
      const list = Array.isArray(node.material) ? node.material : [node.material]
      for (let i = 0; i < list.length; i += 1) {
        const m = list[i]
        if (m && !isSharedResource(m)) mats.add(m)
      }
    }
  })

  for (const geo of geos) geo?.dispose?.()
  for (const mat of mats) mat?.dispose?.()

  if (root.parent) root.parent.remove(root)
  root.clear()
}
