import * as THREE from 'three'
import { CELL_SIZE } from '../world/worldCoords.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
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
  wallConcrete: 0x354663,
  wallCavity: 0x141c29,
  wallCrack: 0x0b1019,
  wallRebar: 0x4b2d20,
  wallRubble: 0x3a4961,
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

const CEILING_WALL_CLAMP_LIMIT = CELL_SIZE * 0.5 - 0.16 // 1.84m max reach from cell center

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

function clampCellLocalOffset(val, patchOffset, halfExtent) {
  const minLocal = -CEILING_WALL_CLAMP_LIMIT + halfExtent - patchOffset
  const maxLocal = CEILING_WALL_CLAMP_LIMIT - halfExtent - patchOffset
  if (minLocal > maxLocal) return 0
  return Math.max(minLocal, Math.min(maxLocal, val))
}

function computeMinGroundedCenterY(halfX, halfY, halfZ, rx, ry, rz) {
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
        : -0.96
      const collapseYaw = Number.isFinite(hazardData.collapseYaw) ? hazardData.collapseYaw : 0
      const clearBiasX = Number.isFinite(hazardData.clearBias?.x) ? hazardData.clearBias.x : 1
      const clearBiasZ = Number.isFinite(hazardData.clearBias?.z) ? hazardData.clearBias.z : -1
      const activeDuration = Number.isFinite(hazardData.activeDuration)
        ? hazardData.activeDuration
        : 1.2

      const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset: 'balanced' })
      const ceilingTex = surfaceSet?.ceiling || surfaceSet?.wall || null

      // Patch root sits at the resolved coffer bay (x, 0, z) with zero floor marker
      const ceilingPatchGroup = new THREE.Group()
      ceilingPatchGroup.name = 'hazard-ceiling-patch'
      ceilingPatchGroup.position.set(patchOffsetX, 0, patchOffsetZ)
      root.add(ceilingPatchGroup)

      const soffitMat = getPooledMaterial('ceiling_collapse:soffit', () =>
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
      const spallMat = getPooledMaterial('ceiling_collapse:spall', () =>
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
      const cavityMat = getPooledMaterial('ceiling_collapse:cavity', () =>
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

      // Overhead structural deterioration frame (oriented by collapseYaw)
      const ceilingOverheadGroup = new THREE.Group()
      ceilingOverheadGroup.name = 'hazard-ceiling-overhead'
      ceilingOverheadGroup.rotation.y = collapseYaw
      ceilingPatchGroup.add(ceilingOverheadGroup)

      // 1. Subtle dormant cracks & structural concrete seam flush against soffitY (3.60m)
      const ceilingCrackGroup = new THREE.Group()
      ceilingCrackGroup.name = 'hazard-ceiling-cracks'
      ceilingOverheadGroup.add(ceilingCrackGroup)

      const crackStripGeo = getPooledGeometry(
        'ceiling_collapse:crack_strip',
        () => new THREE.BoxGeometry(1, 0.008, 1)
      )
      const crackSpecs = [
        { x: 0.0, z: 0.0, len: 0.62, w: 0.016, rotY: 0.18 },
        { x: 0.14, z: -0.1, len: 0.42, w: 0.013, rotY: 1.04 },
        { x: -0.16, z: 0.08, len: 0.46, w: 0.014, rotY: -0.78 },
        { x: 0.08, z: 0.16, len: 0.34, w: 0.012, rotY: 2.08 },
        { x: -0.12, z: -0.15, len: 0.32, w: 0.012, rotY: -1.62 },
      ]
      const ceilingCrackMeshes = []
      const ceilingCrackConfigs = []
      for (let i = 0; i < crackSpecs.length; i += 1) {
        const cs = crackSpecs[i]
        const strip = new THREE.Mesh(crackStripGeo, crackMat)
        strip.position.set(cs.x, soffitY - 0.005, cs.z)
        strip.rotation.y = cs.rotY
        strip.scale.set(cs.len, 1, cs.w)
        strip.receiveShadow = true
        ceilingCrackGroup.add(strip)
        ceilingCrackMeshes.push(strip)
        ceilingCrackConfigs.push(cs)
      }

      // Subtle plastered joint collar flush at soffit (blends seamlessly with cast concrete deck)
      const rimGeo = getPooledGeometry(
        'ceiling_collapse:soffit_seam',
        () => new THREE.BoxGeometry(0.84, 0.012, 0.8)
      )
      const rimMesh = new THREE.Mesh(rimGeo, soffitMat)
      rimMesh.position.set(0, soffitY - 0.006, 0)
      rimMesh.receiveShadow = true
      ceilingOverheadGroup.add(rimMesh)

      // 2. Recessed spalled concrete cavity & oxidized rebar stubs (hidden while dormant; revealed on collapse)
      const ceilingCavityGroup = new THREE.Group()
      ceilingCavityGroup.name = 'hazard-ceiling-cavity'
      ceilingCavityGroup.visible = false
      ceilingOverheadGroup.add(ceilingCavityGroup)

      const cavityCoreGeo = getPooledGeometry(
        'ceiling_collapse:cavity_core',
        () => new THREE.CylinderGeometry(0.39, 0.43, 0.022, 9)
      )
      const cavityCore = new THREE.Mesh(cavityCoreGeo, cavityMat)
      cavityCore.position.set(0, soffitY - 0.011, 0)
      cavityCore.scale.set(1.04, 1, 0.96)
      cavityCore.receiveShadow = true
      ceilingCavityGroup.add(cavityCore)

      const rebarGeo = getPooledGeometry(
        'ceiling_collapse:rebar_rod',
        () => new THREE.CylinderGeometry(0.011, 0.011, 0.36, 6)
      )
      const rebarSpecs = [
        { x: -0.14, z: -0.06, rx: 0.24, ry: 0.32, rz: 1.48 },
        { x: 0.12, z: 0.08, rx: -0.28, ry: -0.44, rz: 1.44 },
        { x: 0.02, z: -0.14, rx: 1.38, ry: 0.18, rz: -0.26 },
      ]
      for (let i = 0; i < rebarSpecs.length; i += 1) {
        const rs = rebarSpecs[i]
        const rod = new THREE.Mesh(rebarGeo, rebarMat)
        rod.position.set(rs.x, soffitY - 0.032, rs.z)
        rod.rotation.set(rs.rx, rs.ry, rs.rz)
        ceilingCavityGroup.add(rod)
      }

      // 3. Eight bounded irregular fractured concrete & plaster slabs (flush at soffit while dormant!)
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
      ceilingPatchGroup.add(ceilingRubbleGroup)

      const rawSlabs = [
        // Primary heavy central concrete slab
        {
          geoIdx: 0,
          mat: 'soffit',
          sx: 0.44,
          sy: 0.11,
          sz: 0.36,
          startX: -0.04,
          startZ: -0.03,
          restX: -0.05,
          restZ: -0.04,
          stackY: 0,
          restRotX: 0.06,
          restRotY: 0.32,
          restRotZ: -0.08,
          detachDelay: 0.0,
          v0Down: 1.25,
          gravity: 11.4,
          bounce: 0.16,
          spinX: 2.1,
          spinY: 0.9,
          spinZ: -1.7,
          maxSag: 0.068,
        },
        // Secondary thick concrete slab (stacks slightly on edge of primary mound)
        {
          geoIdx: 1,
          mat: 'spall',
          sx: 0.38,
          sy: 0.1,
          sz: 0.32,
          startX: 0.18,
          startZ: 0.12,
          restX: 0.14,
          restZ: 0.11,
          stackY: 0.05,
          restRotX: -0.1,
          restRotY: 1.18,
          restRotZ: 0.12,
          detachDelay: 0.04,
          v0Down: 1.1,
          gravity: 11.2,
          bounce: 0.18,
          spinX: -2.4,
          spinY: 1.2,
          spinZ: 1.9,
          maxSag: 0.058,
        },
        // Third heavy slab
        {
          geoIdx: 0,
          mat: 'spall',
          sx: 0.34,
          sy: 0.095,
          sz: 0.28,
          startX: -0.2,
          startZ: 0.15,
          restX: -0.21,
          restZ: 0.17,
          stackY: 0,
          restRotX: 0.08,
          restRotY: -0.64,
          restRotZ: 0.07,
          detachDelay: 0.07,
          v0Down: 1.05,
          gravity: 11.0,
          bounce: 0.19,
          spinX: 1.8,
          spinY: -1.4,
          spinZ: 2.2,
          maxSag: 0.052,
        },
        // Fourth concrete block
        {
          geoIdx: 1,
          mat: 'soffit',
          sx: 0.3,
          sy: 0.09,
          sz: 0.26,
          startX: 0.17,
          startZ: -0.18,
          restX: 0.21,
          restZ: -0.19,
          stackY: 0,
          restRotX: -0.07,
          restRotY: 2.1,
          restRotZ: -0.09,
          detachDelay: 0.09,
          v0Down: 0.95,
          gravity: 11.0,
          bounce: 0.2,
          spinX: -1.9,
          spinY: 1.6,
          spinZ: -2.0,
          maxSag: 0.046,
        },
        // Medium fractured chunks building natural rubble silhouette
        {
          geoIdx: 2,
          mat: 'spall',
          sx: 0.22,
          sy: 0.13,
          sz: 0.2,
          startX: -0.16,
          startZ: -0.18,
          restX: -0.23,
          restZ: -0.22,
          stackY: 0,
          restRotX: 0.11,
          restRotY: 0.88,
          restRotZ: 0.09,
          detachDelay: 0.05,
          v0Down: 1.15,
          gravity: 10.8,
          bounce: 0.21,
          spinX: 3.1,
          spinY: -1.8,
          spinZ: 2.5,
          maxSag: 0.05,
        },
        {
          geoIdx: 2,
          mat: 'soffit',
          sx: 0.2,
          sy: 0.12,
          sz: 0.19,
          startX: 0.04,
          startZ: 0.22,
          restX: 0.02,
          restZ: 0.27,
          stackY: 0,
          restRotX: -0.09,
          restRotY: -1.3,
          restRotZ: 0.08,
          detachDelay: 0.11,
          v0Down: 0.9,
          gravity: 10.8,
          bounce: 0.22,
          spinX: -2.8,
          spinY: 2.1,
          spinZ: -1.9,
          maxSag: 0.042,
        },
        {
          geoIdx: 2,
          mat: 'spall',
          sx: 0.18,
          sy: 0.1,
          sz: 0.17,
          startX: 0.24,
          startZ: -0.01,
          restX: 0.29,
          restZ: 0.02,
          stackY: 0,
          restRotX: 0.07,
          restRotY: 1.72,
          restRotZ: -0.1,
          detachDelay: 0.13,
          v0Down: 0.85,
          gravity: 10.6,
          bounce: 0.22,
          spinX: 2.6,
          spinY: -2.2,
          spinZ: 2.4,
          maxSag: 0.038,
        },
        {
          geoIdx: 2,
          mat: 'soffit',
          sx: 0.16,
          sy: 0.09,
          sz: 0.15,
          startX: -0.03,
          startZ: -0.23,
          restX: -0.04,
          restZ: -0.28,
          stackY: 0,
          restRotX: -0.08,
          restRotY: 0.45,
          restRotZ: 0.07,
          detachDelay: 0.14,
          v0Down: 0.85,
          gravity: 10.6,
          bounce: 0.22,
          spinX: -3.2,
          spinY: 1.9,
          spinZ: 2.1,
          maxSag: 0.036,
        },
      ]

      const ceilingDebrisMeshes = []
      const ceilingDebrisConfigs = []

      for (let i = 0; i < rawSlabs.length; i += 1) {
        const s = rawSlabs[i]
        const mesh = new THREE.Mesh(
          slabGeos[s.geoIdx],
          s.mat === 'spall' ? spallMat : soffitMat
        )
        mesh.scale.set(s.sx, s.sy, s.sz)
        mesh.castShadow = i < 4
        mesh.receiveShadow = true

        const halfX = s.sx * 0.5
        const halfY = s.sy * 0.5
        const halfZ = s.sz * 0.5
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

        // Start flush against ceiling soffit (protruding only a few cm like delaminating concrete)
        const startY = soffitY - halfY * 0.72
        const sagY = startY - s.maxSag
        const dropDist = Math.max(0.05, sagY - restY)
        const tImpact =
          (-s.v0Down + Math.sqrt(s.v0Down * s.v0Down + 2 * s.gravity * dropDist)) / s.gravity
        const vImpact = s.v0Down + s.gravity * tImpact
        const vBounce = vImpact * s.bounce
        const tBounce = Math.min(0.28, (2 * vBounce) / s.gravity)

        // Clamp horizontal rest & impact positions strictly inside wall-safe bounds
        const startX = clampCellLocalOffset(s.startX, patchOffsetX, maxFootprintR)
        const startZ = clampCellLocalOffset(s.startZ, patchOffsetZ, maxFootprintR)
        const restX = clampCellLocalOffset(s.restX, patchOffsetX, maxFootprintR)
        const restZ = clampCellLocalOffset(s.restZ, patchOffsetZ, maxFootprintR)
        const impactX = startX + (restX - startX) * 0.74
        const impactZ = startZ + (restZ - startZ) * 0.74

        // Shoved-aside cleared rubble positions tucked flat toward nearest wall/corner
        const clearedTargetX = restX * 0.65 + clearBiasX * (0.48 + (i % 3) * 0.1)
        const clearedTargetZ = restZ * 0.65 + clearBiasZ * (0.48 + ((i + 1) % 3) * 0.1)
        const clearedX = clampCellLocalOffset(clearedTargetX, patchOffsetX, maxFootprintR)
        const clearedZ = clampCellLocalOffset(clearedTargetZ, patchOffsetZ, maxFootprintR)
        const clearedY = computeMinGroundedCenterY(
          halfX * 0.82,
          halfY * 0.56,
          halfZ * 0.82,
          0.04,
          s.restRotY + 0.6,
          -0.04
        )

        mesh.position.set(startX, startY, startZ)
        mesh.rotation.set(0, s.restRotY * 0.25, 0)
        ceilingRubbleGroup.add(mesh)
        ceilingDebrisMeshes.push(mesh)
        ceilingDebrisConfigs.push({
          sx: s.sx,
          sy: s.sy,
          sz: s.sz,
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

      // 4. Six bounded warning grit / plaster chips (hidden while dormant; trickle under gravity during warning)
      const warningPebbleGeo = getPooledGeometry(
        'ceiling_collapse:warn_pebble',
        () => new THREE.DodecahedronGeometry(0.028, 0)
      )
      const ceilingWarnPebbleGroup = new THREE.Group()
      ceilingWarnPebbleGroup.name = 'hazard-ceiling-warning-pebbles'
      ceilingWarnPebbleGroup.visible = false
      ceilingPatchGroup.add(ceilingWarnPebbleGroup)

      const ceilingWarnPebbles = []
      const ceilingWarnPebbleConfigs = []
      for (let i = 0; i < 6; i += 1) {
        const pebble = new THREE.Mesh(warningPebbleGeo, i % 2 === 0 ? spallMat : soffitMat)
        const scale = 0.65 + (i % 3) * 0.28
        pebble.scale.set(scale, scale * 0.72, scale * 0.9)
        const angle = (i / 6) * Math.PI * 2 + 0.35
        const rad = 0.08 + (i % 3) * 0.11
        const px = clampCellLocalOffset(Math.cos(angle) * rad, patchOffsetX, 0.05)
        const pz = clampCellLocalOffset(Math.sin(angle) * rad, patchOffsetZ, 0.05)
        pebble.position.set(px, soffitY - 0.05, pz)
        ceilingWarnPebbleGroup.add(pebble)
        ceilingWarnPebbles.push(pebble)
        ceilingWarnPebbleConfigs.push({
          x: px,
          z: pz,
          driftX: Math.cos(angle) * 0.12,
          driftZ: Math.sin(angle) * 0.12,
          startY: soffitY - 0.05,
          minY: 0.022 * scale,
          phaseOffset: i / 6,
          spin: (i % 2 === 0 ? 1 : -1) * (4.5 + i * 0.7),
        })
      }

      // 5. Six bounded localized dust puffs (subtle ceiling trickle in warning, low impact plume in active)
      const ceilingDustGeo = getPooledGeometry(
        'ceiling_collapse:dust_puff',
        () => new THREE.DodecahedronGeometry(0.24, 1)
      )
      const ceilingDustGroup = new THREE.Group()
      ceilingDustGroup.name = 'hazard-ceiling-dust'
      ceilingDustGroup.visible = false
      ceilingPatchGroup.add(ceilingDustGroup)

      const ceilingDustMeshes = []
      const ceilingDustConfigs = []
      for (let i = 0; i < 6; i += 1) {
        const puff = new THREE.Mesh(ceilingDustGeo, ceilingDustMat)
        const angle = (i / 6) * Math.PI * 2 + 0.22
        const rad = 0.08 + (i % 2) * 0.16
        const dx = clampCellLocalOffset(Math.cos(angle) * rad, patchOffsetX, 0.25)
        const dz = clampCellLocalOffset(Math.sin(angle) * rad, patchOffsetZ, 0.25)
        const spreadX = clampCellLocalOffset(Math.cos(angle) * (0.42 + (i % 3) * 0.12), patchOffsetX, 0.3)
        const spreadZ = clampCellLocalOffset(Math.sin(angle) * (0.42 + (i % 3) * 0.12), patchOffsetZ, 0.3)
        puff.position.set(dx, soffitY - 0.16, dz)
        ceilingDustGroup.add(puff)
        ceilingDustMeshes.push(puff)
        ceilingDustConfigs.push({
          warnX: dx,
          warnZ: dz,
          spreadX,
          spreadZ,
          phase: i * 0.17,
          baseScale: 0.55 + (i % 3) * 0.18,
          impactHeight: 0.22 + (i % 3) * 0.14,
        })
      }

      root.userData = {
        hazardType: type,
        soffitY,
        activeDuration,
        patchOffsetX,
        patchOffsetZ,
        collapseYaw,
        ceilingPatchGroup,
        ceilingOverheadGroup,
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
      const lateralOffset = Number.isFinite(hazardData.lateralOffset)
        ? Math.max(-0.55, Math.min(0.55, hazardData.lateralOffset))
        : 0.46
      const pivotX = lateralOffset
      const pivotZ = -1.5
      const dormantPitch = 0.045
      const dormantRoll = -0.032
      const warnEndPitch = 0.135
      const warnEndRoll = -0.056
      const collapsedPitch = 1.495
      const collapsedRoll = -0.038

      const propMats = getEnvironmentalPropMaterials()
      const woodMat = propMats.weatheredWood
      const rustyMat = propMats.rustyMetal
      const steelMat = propMats.darkSteel
      const cabinetMat = propMats.cabinetGreen
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

      // 1. Wall & floor structural contact remnants (stay attached to wall/floor when rack tips)
      const wallRemnantGroup = new THREE.Group()
      wallRemnantGroup.name = 'hazard-rotten-furniture-wall-remnants'

      const battenGeo = getPooledGeometry(
        'rotten_furniture:wall_batten',
        () => new THREE.BoxGeometry(0.82, 0.065, 0.035)
      )
      const wallBatten = new THREE.Mesh(battenGeo, woodMat)
      wallBatten.position.set(pivotX, 1.28, -1.96)
      wallRemnantGroup.add(wallBatten)

      const bracketFlangeGeo = getPooledGeometry(
        'rotten_furniture:bracket_flange',
        () => new THREE.BoxGeometry(0.055, 0.11, 0.025)
      )
      const bracketArmGeo = getPooledGeometry(
        'rotten_furniture:bracket_arm',
        () => new THREE.BoxGeometry(0.048, 0.032, 0.065)
      )
      const boltHeadGeo = getPooledGeometry(
        'rotten_furniture:bolt_head',
        () => new THREE.CylinderGeometry(0.014, 0.014, 0.024, 6)
      )
      for (let b = 0; b < 2; b += 1) {
        const bx = pivotX + (b === 0 ? -0.34 : 0.34)
        const flange = new THREE.Mesh(bracketFlangeGeo, rustyMat)
        flange.position.set(bx, 1.28, -1.965)
        wallRemnantGroup.add(flange)

        const arm = new THREE.Mesh(bracketArmGeo, rustyMat)
        arm.position.set(bx, 1.295, -1.935)
        arm.rotation.x = b === 0 ? 0.24 : 0.08
        wallRemnantGroup.add(arm)

        const bolt = new THREE.Mesh(boltHeadGeo, steelMat)
        bolt.rotation.x = Math.PI * 0.5
        bolt.position.set(bx, 1.26, -1.952)
        wallRemnantGroup.add(bolt)
      }

      // Straining top retention strap on right bracket that stretches during warning and snaps on active
      const strapGeo = getPooledGeometry(
        'rotten_furniture:retention_strap',
        () => new THREE.BoxGeometry(0.036, 0.018, 0.08)
      )
      const strainedStrapMesh = new THREE.Mesh(strapGeo, rustyMat)
      strainedStrapMesh.position.set(pivotX + 0.34, 1.295, -1.915)
      wallRemnantGroup.add(strainedStrapMesh)

      // Floor-level rear base shims & crushed front-right rotted post stub (firm y=0 floor contact)
      const baseShimGeo = getPooledGeometry(
        'rotten_furniture:base_shim',
        () => new THREE.BoxGeometry(0.11, 0.036, 0.12)
      )
      for (let s = 0; s < 2; s += 1) {
        const shim = new THREE.Mesh(baseShimGeo, woodMat)
        shim.position.set(pivotX + (s === 0 ? -0.36 : 0.36), 0.018, -1.91)
        shim.rotation.y = s === 0 ? 0.05 : -0.07
        wallRemnantGroup.add(shim)
      }

      const rottedStubGeo = getPooledGeometry(
        'rotten_furniture:rotted_foot_stub',
        () => new THREE.BoxGeometry(0.075, 0.044, 0.075)
      )
      const rottedStub = new THREE.Mesh(rottedStubGeo, woodMat)
      rottedStub.position.set(pivotX + 0.38, 0.036, -1.525)
      rottedStub.rotation.set(0.14, 0.18, -0.22)
      wallRemnantGroup.add(rottedStub)

      wallAnchorGroup.add(wallRemnantGroup)

      // 2. Main tipping shelving cabinet carcass pivoted at front floor line (pivotX, pivotY, pivotZ = -1.50)
      // All child coordinates satisfy lx in [-0.43, +0.43], ly in [0.004, 1.36], lz_rel in [-0.45, 0.0]
      // so tipping around pivotZ = -1.50 by pitch in [0, 1.50 rad] is mathematically guaranteed >= 0 above floor.
      const furnitureGroup = new THREE.Group()
      furnitureGroup.name = 'hazard-rotten-furniture'
      const initPivotY =
        0.44 * Math.abs(Math.sin(dormantRoll)) +
        0.04 * Math.sin(Math.max(0, dormantPitch)) +
        0.004
      furnitureGroup.position.set(pivotX, initPivotY, pivotZ)
      furnitureGroup.rotation.set(dormantPitch, 0, dormantRoll)

      // Side timber panels (lx = +-0.405, ly in [0.16, 1.32], lz_rel in [-0.43, -0.02])
      const sidePanelGeo = getPooledGeometry(
        'rotten_furniture:side_panel',
        () => new THREE.BoxGeometry(0.036, 1.16, 0.41)
      )
      const leftPanel = new THREE.Mesh(sidePanelGeo, woodMat)
      leftPanel.position.set(-0.405, 0.74, -0.225)
      furnitureGroup.add(leftPanel)

      const rightPanel = new THREE.Mesh(sidePanelGeo, woodMat)
      rightPanel.position.set(0.405, 0.75, -0.225)
      furnitureGroup.add(rightPanel)

      // Four corner uprights (3 intact steel/timber uprights + 1 buckled rotted front-right leg)
      const intactPostGeo = getPooledGeometry(
        'rotten_furniture:upright_post',
        () => new THREE.BoxGeometry(0.052, 1.34, 0.052)
      )
      const postConfigs = [
        { x: -0.4, y: 0.674, z: -0.42, mat: rustyMat }, // rear-left
        { x: 0.4, y: 0.674, z: -0.42, mat: rustyMat },  // rear-right
        { x: -0.4, y: 0.674, z: -0.03, mat: woodMat },  // front-left
      ]
      for (let p = 0; p < postConfigs.length; p += 1) {
        const pc = postConfigs[p]
        const post = new THREE.Mesh(intactPostGeo, pc.mat)
        post.position.set(pc.x, pc.y, pc.z)
        furnitureGroup.add(post)
      }

      // Upper portion of front-right post + buckled rotted lower knee
      const upperRightPostGeo = getPooledGeometry(
        'rotten_furniture:upper_right_post',
        () => new THREE.BoxGeometry(0.052, 1.06, 0.052)
      )
      const upperRightPost = new THREE.Mesh(upperRightPostGeo, woodMat)
      upperRightPost.position.set(0.4, 0.81, -0.03)
      furnitureGroup.add(upperRightPost)

      const buckledKneeGeo = getPooledGeometry(
        'rotten_furniture:buckled_leg_knee',
        () => new THREE.BoxGeometry(0.046, 0.24, 0.048)
      )
      const buckledLegMesh = new THREE.Mesh(buckledKneeGeo, woodMat)
      buckledLegMesh.position.set(0.392, 0.175, -0.032)
      buckledLegMesh.rotation.set(0.12, 0, -0.18)
      furnitureGroup.add(buckledLegMesh)

      // 4 horizontal shelf decks (bottom plinth deck, lower shelf, mid shelf, top cap deck)
      const shelfDeckGeo = getPooledGeometry(
        'rotten_furniture:shelf_deck',
        () => new THREE.BoxGeometry(0.84, 0.034, 0.43)
      )
      const shelfRailGeo = getPooledGeometry(
        'rotten_furniture:shelf_rail',
        () => new THREE.BoxGeometry(0.84, 0.026, 0.024)
      )
      const shelfHeights = [0.1, 0.48, 0.9, 1.33]
      for (let s = 0; s < shelfHeights.length; s += 1) {
        const sy = shelfHeights[s]
        const deck = new THREE.Mesh(shelfDeckGeo, s === 3 ? rustyMat : woodMat)
        deck.position.set(0, sy, -0.225)
        if (s === 1) deck.rotation.z = -0.025
        furnitureGroup.add(deck)

        const rail = new THREE.Mesh(shelfRailGeo, steelMat)
        rail.position.set(0, sy - 0.018, -0.022)
        furnitureGroup.add(rail)
      }

      // Center vertical divider between lower/mid shelves and upper compartment
      const dividerGeo = getPooledGeometry(
        'rotten_furniture:center_divider',
        () => new THREE.BoxGeometry(0.028, 1.22, 0.39)
      )
      const divider = new THREE.Mesh(dividerGeo, woodMat)
      divider.position.set(0.0, 0.71, -0.23)
      furnitureGroup.add(divider)

      // Upper-left cabinet locker door (ajar on rusty hinges) & recessed back panel
      const backPanelGeo = getPooledGeometry(
        'rotten_furniture:back_panel',
        () => new THREE.BoxGeometry(0.8, 0.84, 0.02)
      )
      const backPanel = new THREE.Mesh(backPanelGeo, woodMat)
      backPanel.position.set(0, 0.9, -0.432)
      furnitureGroup.add(backPanel)

      const crossBraceGeo = getPooledGeometry(
        'rotten_furniture:rear_cross_brace',
        () => new THREE.BoxGeometry(0.86, 0.024, 0.016)
      )
      for (let cb = 0; cb < 2; cb += 1) {
        const brace = new THREE.Mesh(crossBraceGeo, rustyMat)
        brace.position.set(0, 0.32, -0.438)
        brace.rotation.z = cb === 0 ? 0.44 : -0.44
        furnitureGroup.add(brace)
      }

      const ajarDoorGeo = getPooledGeometry(
        'rotten_furniture:ajar_cabinet_door',
        () => new THREE.BoxGeometry(0.38, 0.4, 0.024)
      )
      const ajarDoorMesh = new THREE.Mesh(ajarDoorGeo, cabinetMat)
      ajarDoorMesh.position.set(-0.2, 1.11, -0.028)
      ajarDoorMesh.rotation.y = -0.08
      furnitureGroup.add(ajarDoorMesh)

      const doorHandleGeo = getPooledGeometry(
        'rotten_furniture:door_handle',
        () => new THREE.BoxGeometry(0.018, 0.085, 0.016)
      )
      const doorHandle = new THREE.Mesh(doorHandleGeo, rustyMat)
      doorHandle.position.set(0.14, 0, 0.01)
      ajarDoorMesh.add(doorHandle)

      wallAnchorGroup.add(furnitureGroup)

      // 3. Secondary shelf cargo items that sit inside the bays and slide/tumble onto the floor during collapse
      const looseCargoGroup = new THREE.Group()
      looseCargoGroup.name = 'hazard-rotten-furniture-cargo'

      const crateCargoGeo = getPooledGeometry(
        'rotten_furniture:cargo_crate',
        () => new THREE.BoxGeometry(0.28, 0.18, 0.24)
      )
      const toolboxCargoGeo = getPooledGeometry(
        'rotten_furniture:cargo_toolbox',
        () => new THREE.BoxGeometry(0.24, 0.13, 0.17)
      )
      const drawerCargoGeo = getPooledGeometry(
        'rotten_furniture:cargo_drawer',
        () => new THREE.BoxGeometry(0.33, 0.15, 0.32)
      )
      const binderCargoGeo = getPooledGeometry(
        'rotten_furniture:cargo_binder',
        () => new THREE.BoxGeometry(0.21, 0.055, 0.17)
      )

      const looseCargoTemplates = [
        {
          // Slatted wooden supply crate on mid-left shelf
          geo: crateCargoGeo,
          mat: woodMat,
          halfX: 0.14,
          halfY: 0.09,
          halfZ: 0.12,
          shelfX: -0.19,
          shelfY: 0.59,
          shelfZRel: -0.21,
          slideStart: 0.14,
          slideEnd: 0.84,
          arcHeight: 0.12,
          restX: clampCellLocalOffset(pivotX - 0.18, 0, 0.16),
          restZ: -0.44,
          clearedX: clampCellLocalOffset(pivotX - 0.34, 0, 0.16),
          clearedZ: -1.68,
          restRotX: 1.54,
          restRotY: -0.28,
          restRotZ: 0.12,
        },
        {
          // Ochre maintenance steel toolbox on upper-right shelf
          geo: toolboxCargoGeo,
          mat: yellowMat,
          halfX: 0.12,
          halfY: 0.065,
          halfZ: 0.085,
          shelfX: 0.19,
          shelfY: 0.985,
          shelfZRel: -0.2,
          slideStart: 0.1,
          slideEnd: 0.8,
          arcHeight: 0.16,
          restX: clampCellLocalOffset(pivotX + 0.21, 0, 0.14),
          restZ: -0.22,
          clearedX: clampCellLocalOffset(pivotX + 0.32, 0, 0.14),
          clearedZ: -1.64,
          restRotX: 1.48,
          restRotY: 0.34,
          restRotZ: -0.16,
        },
        {
          // Lower utility drawer sliding out of bottom-right bay
          geo: drawerCargoGeo,
          mat: cabinetMat,
          halfX: 0.165,
          halfY: 0.075,
          halfZ: 0.16,
          shelfX: 0.19,
          shelfY: 0.2,
          shelfZRel: -0.19,
          slideStart: 0.18,
          slideEnd: 0.88,
          arcHeight: 0.07,
          restX: clampCellLocalOffset(pivotX + 0.18, 0, 0.18),
          restZ: -0.88,
          clearedX: clampCellLocalOffset(pivotX + 0.16, 0, 0.18),
          clearedZ: -1.58,
          restRotX: 1.44,
          restRotY: 0.12,
          restRotZ: -0.06,
        },
        {
          // Stained archive ledger/binder stack on upper-right shelf
          geo: binderCargoGeo,
          mat: paperMat,
          halfX: 0.105,
          halfY: 0.028,
          halfZ: 0.085,
          shelfX: 0.17,
          shelfY: 1.08,
          shelfZRel: -0.19,
          slideStart: 0.08,
          slideEnd: 0.78,
          arcHeight: 0.18,
          restX: clampCellLocalOffset(pivotX - 0.26, 0, 0.13),
          restZ: -0.18,
          clearedX: clampCellLocalOffset(pivotX - 0.16, 0, 0.13),
          clearedZ: -1.62,
          restRotX: 1.56,
          restRotY: -0.48,
          restRotZ: 0.08,
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
          initPivotY,
          pivotZ,
          shelfEvalPt
        )
        const minDormantY = computeMinGroundedCenterY(
          tpl.halfX,
          tpl.halfY,
          tpl.halfZ,
          dormantPitch,
          0,
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
        mesh.rotation.set(dormantPitch, 0, dormantRoll)
        looseCargoGroup.add(mesh)
        looseCargoMeshes.push(mesh)
        looseCargoConfigs.push({
          ...tpl,
          restY,
        })
      }
      wallAnchorGroup.add(looseCargoGroup)

      // 4. Warning wood splinters & rust flakes (6 bounded particles)
      const furnitureWarnSplinterGroup = new THREE.Group()
      furnitureWarnSplinterGroup.name = 'hazard-rotten-furniture-warn-splinters'
      furnitureWarnSplinterGroup.visible = false
      const splinterGeo = getPooledGeometry(
        'rotten_furniture:warn_splinter',
        () => new THREE.BoxGeometry(0.048, 0.016, 0.022)
      )
      const furnitureWarnSplinters = []
      const furnitureWarnSplinterConfigs = [
        { x: pivotX + 0.38, startY: 0.34, z: -1.52, speed: 1.55, phase: 0.0, rotSpeed: 4.5, mat: woodMat },
        { x: pivotX + 0.34, startY: 1.28, z: -1.9, speed: 1.35, phase: 0.18, rotSpeed: -5.1, mat: rustyMat },
        { x: pivotX - 0.34, startY: 1.26, z: -1.89, speed: 1.45, phase: 0.36, rotSpeed: 4.2, mat: rustyMat },
        { x: pivotX + 0.39, startY: 0.24, z: -1.54, speed: 1.65, phase: 0.52, rotSpeed: -4.8, mat: woodMat },
        { x: pivotX + 0.05, startY: 0.48, z: -1.62, speed: 1.4, phase: 0.68, rotSpeed: 3.9, mat: woodMat },
        { x: pivotX - 0.38, startY: 0.28, z: -1.55, speed: 1.5, phase: 0.84, rotSpeed: -4.4, mat: woodMat },
      ]
      for (let i = 0; i < furnitureWarnSplinterConfigs.length; i += 1) {
        const cfg = furnitureWarnSplinterConfigs[i]
        const sp = new THREE.Mesh(splinterGeo, cfg.mat)
        sp.position.set(cfg.x, cfg.startY, cfg.z)
        furnitureWarnSplinterGroup.add(sp)
        furnitureWarnSplinters.push(sp)
      }
      wallAnchorGroup.add(furnitureWarnSplinterGroup)

      // 5. Restrained dry-rot dust plumes (5 bounded puffs)
      const furnitureDustGroup = new THREE.Group()
      furnitureDustGroup.name = 'hazard-rotten-furniture-dust'
      furnitureDustGroup.visible = false
      const dustGeo = getPooledGeometry(
        'rotten_furniture:dust_puff',
        () => new THREE.DodecahedronGeometry(0.24, 0)
      )
      const furnitureDustMeshes = []
      const furnitureDustConfigs = []
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2 + 0.35
        const puff = new THREE.Mesh(dustGeo, furnitureDustMat)
        puff.position.set(pivotX, 0.16, -0.95)
        furnitureDustGroup.add(puff)
        furnitureDustMeshes.push(puff)
        furnitureDustConfigs.push({
          dx: Math.cos(angle) * (0.28 + (i % 2) * 0.14),
          dz: Math.sin(angle) * (0.26 + (i % 3) * 0.12),
          baseScale: 0.48 + (i % 3) * 0.18,
          lift: 0.22 + (i % 2) * 0.14,
        })
      }
      wallAnchorGroup.add(furnitureDustGroup)

      root.add(wallAnchorGroup)
      root.userData = {
        hazardType: type,
        wallAnchorGroup,
        wallRemnantGroup,
        strainedStrapMesh,
        furnitureGroup,
        buckledLegMesh,
        ajarDoorMesh,
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
        pivotX,
        pivotZ,
        dormantPitch,
        dormantRoll,
        warnEndPitch,
        warnEndRoll,
        collapsedPitch,
        collapsedRoll,
        uprightRotX: dormantPitch,
        uprightRotZ: dormantRoll,
        collapsedRotX: collapsedPitch,
        collapsedRotZ: collapsedRoll,
        isPermanentlyCollapsed: false,
        isAftermathCleared: false,
      }
      break
    }

    case HAZARD_TYPES.FALLING_PIPES_FIXTURES: {
      const mountType = hazardData.mountType === 'ceiling' ? 'ceiling' : 'wall'
      const pipeYaw = Number.isFinite(hazardData.pipeYaw) ? hazardData.pipeYaw : 0
      const pipeRestY = Number.isFinite(hazardData.pipeRestY) ? hazardData.pipeRestY : 3.12
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : 3.6
      const overheadZ = -1.32
      const impactZ = -1.06
      const clearedZ = -1.68

      // Reuse shared facility prop materials so overhead pipes blend seamlessly with environment
      const envPropMats = getEnvironmentalPropMaterials()
      const pipeMetalMat = envPropMats.rustyMetal
      const darkSteelMat = envPropMats.darkSteel
      const valveWheelMat = envPropMats.warningYellow
      const gasketBlackMat = envPropMats.cableBlack

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

      // 1. Fixed overhead structural remnants (ceiling deck flanges, upper riser stubs, wall standoffs)
      const ceilingRemnantGroup = new THREE.Group()
      ceilingRemnantGroup.name = 'hazard-falling-pipes-remnants'
      pipeMountGroup.add(ceilingRemnantGroup)

      const deckFlangeGeo = getPooledGeometry(
        'falling_pipes:deck_flange',
        () => new THREE.CylinderGeometry(0.145, 0.145, 0.036, 12)
      )
      const upperRiserGeo = getPooledGeometry(
        'falling_pipes:upper_riser',
        () => new THREE.CylinderGeometry(0.082, 0.082, 0.34, 10)
      )
      const riserCollarGeo = getPooledGeometry(
        'falling_pipes:riser_collar',
        () => new THREE.CylinderGeometry(0.118, 0.118, 0.03, 12)
      )

      for (const rx of [-0.82, 0.82]) {
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

      const hangerPlateGeo = getPooledGeometry(
        'falling_pipes:hanger_plate',
        () => new THREE.BoxGeometry(0.14, 0.024, 0.14)
      )
      const upperRodGeo = getPooledGeometry(
        'falling_pipes:upper_rod',
        () => new THREE.CylinderGeometry(0.014, 0.014, 0.24, 6)
      )
      const wallPlateGeo = getPooledGeometry(
        'falling_pipes:wall_plate',
        () => new THREE.BoxGeometry(0.16, 0.22, 0.024)
      )
      const wallArmGeo = getPooledGeometry(
        'falling_pipes:wall_arm',
        () => new THREE.BoxGeometry(0.044, 0.052, 0.56)
      )
      const wallGussetGeo = getPooledGeometry(
        'falling_pipes:wall_gusset',
        () => new THREE.BoxGeometry(0.034, 0.034, 0.38)
      )

      for (const hx of [-0.54, 0.54]) {
        const cPlate = new THREE.Mesh(hangerPlateGeo, darkSteelMat)
        cPlate.position.set(hx, ceilingAnchorY - 0.012, overheadZ)
        ceilingRemnantGroup.add(cPlate)

        const uRod = new THREE.Mesh(upperRodGeo, darkSteelMat)
        uRod.position.set(hx, ceilingAnchorY - 0.13, overheadZ)
        ceilingRemnantGroup.add(uRod)

        if (mountType === 'wall') {
          const wPlate = new THREE.Mesh(wallPlateGeo, darkSteelMat)
          wPlate.position.set(hx, pipeRestY, -1.955)
          wPlate.receiveShadow = true
          ceilingRemnantGroup.add(wPlate)

          const wArm = new THREE.Mesh(wallArmGeo, darkSteelMat)
          wArm.position.set(hx, pipeRestY, -1.67)
          wArm.castShadow = true
          wArm.receiveShadow = true
          ceilingRemnantGroup.add(wArm)

          const wGusset = new THREE.Mesh(wallGussetGeo, pipeMetalMat)
          wGusset.position.set(hx, pipeRestY - 0.11, -1.8)
          wGusset.rotation.x = 0.62
          ceilingRemnantGroup.add(wGusset)
        }
      }

      // Straining lower clevis hanger rods (right rod fails first, then left rod shears)
      const strainRodGeo = getPooledGeometry(
        'falling_pipes:strain_rod',
        () => new THREE.CylinderGeometry(0.013, 0.013, 0.22, 6)
      )
      const leftStrainRod = new THREE.Mesh(strainRodGeo, pipeMetalMat)
      leftStrainRod.position.set(-0.54, pipeRestY + 0.16, overheadZ)
      ceilingRemnantGroup.add(leftStrainRod)

      const rightStrainRod = new THREE.Mesh(strainRodGeo, pipeMetalMat)
      rightStrainRod.position.set(0.54, pipeRestY + 0.16, overheadZ)
      ceilingRemnantGroup.add(rightStrainRod)

      // 2. Detachable heavy Schedule-40 pipe & valve fixture assembly
      const pipeGroup = new THREE.Group()
      pipeGroup.name = 'hazard-falling-pipes'
      pipeGroup.position.set(0, pipeRestY, overheadZ)
      pipeMountGroup.add(pipeGroup)

      const mainBarrelGeo = getPooledGeometry(
        'falling_pipes:main_barrel',
        () => new THREE.CylinderGeometry(0.082, 0.082, 1.64, 12)
      )
      const mainBarrel = new THREE.Mesh(mainBarrelGeo, pipeMetalMat)
      mainBarrel.rotation.z = Math.PI * 0.5
      mainBarrel.castShadow = true
      mainBarrel.receiveShadow = true
      pipeGroup.add(mainBarrel)

      // End 90-degree elbow hubs & vertical riser necks mating into overhead riser collars
      const elbowHubGeo = getPooledGeometry(
        'falling_pipes:elbow_hub',
        () => new THREE.CylinderGeometry(0.096, 0.096, 0.14, 10)
      )
      const riserNeckGeo = getPooledGeometry(
        'falling_pipes:riser_neck',
        () => new THREE.CylinderGeometry(0.082, 0.082, 0.15, 10)
      )
      const slipFlangeGeo = getPooledGeometry(
        'falling_pipes:slip_flange',
        () => new THREE.CylinderGeometry(0.114, 0.114, 0.026, 12)
      )

      for (const ex of [-0.78, 0.78]) {
        const sign = Math.sign(ex)
        const elbowHub = new THREE.Mesh(elbowHubGeo, darkSteelMat)
        elbowHub.position.set(ex, 0, 0)
        elbowHub.rotation.z = Math.PI * 0.5
        elbowHub.castShadow = true
        pipeGroup.add(elbowHub)

        const riserNeck = new THREE.Mesh(riserNeckGeo, pipeMetalMat)
        riserNeck.position.set(sign * 0.82, 0.06, 0)
        riserNeck.castShadow = true
        pipeGroup.add(riserNeck)

        const slipFlange = new THREE.Mesh(slipFlangeGeo, darkSteelMat)
        slipFlange.position.set(sign * 0.82, 0.132, 0)
        slipFlange.castShadow = true
        pipeGroup.add(slipFlange)
      }

      // Center bolted union flange pair & dark rubber gasket seal
      const unionFlangeGeo = getPooledGeometry(
        'falling_pipes:union_flange',
        () => new THREE.CylinderGeometry(0.122, 0.122, 0.03, 12)
      )
      const unionGasketGeo = getPooledGeometry(
        'falling_pipes:union_gasket',
        () => new THREE.CylinderGeometry(0.116, 0.116, 0.016, 12)
      )
      for (const ux of [-0.024, 0.024]) {
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
      const teeBodyGeo = getPooledGeometry(
        'falling_pipes:tee_body',
        () => new THREE.CylinderGeometry(0.102, 0.102, 0.18, 10)
      )
      const teeBody = new THREE.Mesh(teeBodyGeo, darkSteelMat)
      teeBody.position.set(0.28, 0, 0)
      teeBody.rotation.z = Math.PI * 0.5
      teeBody.castShadow = true
      pipeGroup.add(teeBody)

      const valveBonnetGeo = getPooledGeometry(
        'falling_pipes:valve_bonnet',
        () => new THREE.CylinderGeometry(0.038, 0.048, 0.11, 8)
      )
      const valveBonnet = new THREE.Mesh(valveBonnetGeo, pipeMetalMat)
      valveBonnet.position.set(0.28, -0.025, 0.075)
      valveBonnet.rotation.x = Math.PI * 0.42
      valveBonnet.castShadow = true
      pipeGroup.add(valveBonnet)

      const valveWheelGeo = getPooledGeometry(
        'falling_pipes:valve_wheel',
        () => new THREE.CylinderGeometry(0.078, 0.078, 0.02, 12)
      )
      const valveWheel = new THREE.Mesh(valveWheelGeo, valveWheelMat)
      valveWheel.position.set(0.28, -0.04, 0.13)
      valveWheel.rotation.x = Math.PI * 0.42
      valveWheel.castShadow = true
      pipeGroup.add(valveWheel)

      // Parallel secondary 26mm condensate return line & twin pipe clamp straps
      const returnLineGeo = getPooledGeometry(
        'falling_pipes:return_line',
        () => new THREE.CylinderGeometry(0.025, 0.025, 1.52, 8)
      )
      const returnLine = new THREE.Mesh(returnLineGeo, darkSteelMat)
      returnLine.position.set(0, -0.092, -0.038)
      returnLine.rotation.z = Math.PI * 0.5
      returnLine.castShadow = true
      pipeGroup.add(returnLine)

      const clampStrapGeo = getPooledGeometry(
        'falling_pipes:clamp_strap',
        () => new THREE.BoxGeometry(0.046, 0.21, 0.15)
      )
      for (const cx of [-0.4, 0.4]) {
        const strap = new THREE.Mesh(clampStrapGeo, darkSteelMat)
        strap.position.set(cx, -0.015, -0.015)
        strap.castShadow = true
        pipeGroup.add(strap)
      }

      // Lower U-bolt clevis hanger rings attached to the pipe barrel
      const clevisRingGeo = getPooledGeometry(
        'falling_pipes:clevis_ring',
        () => new THREE.CylinderGeometry(0.1, 0.1, 0.042, 10)
      )
      const clevisEarGeo = getPooledGeometry(
        'falling_pipes:clevis_ear',
        () => new THREE.BoxGeometry(0.042, 0.072, 0.042)
      )
      for (const hx of [-0.54, 0.54]) {
        const ring = new THREE.Mesh(clevisRingGeo, darkSteelMat)
        ring.position.set(hx, 0, 0)
        ring.rotation.z = Math.PI * 0.5
        pipeGroup.add(ring)

        const ear = new THREE.Mesh(clevisEarGeo, pipeMetalMat)
        ear.position.set(hx, 0.095, 0)
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
        { startX: 0.54, startY: pipeRestY + 0.18, startZ: overheadZ + 0.04, driftX: 0.06, driftZ: 0.14, delay: 0.0, mat: pipeMetalMat },
        { startX: 0.82, startY: pipeRestY + 0.15, startZ: overheadZ + 0.05, driftX: -0.05, driftZ: 0.16, delay: 0.08, mat: darkSteelMat },
        { startX: -0.54, startY: pipeRestY + 0.18, startZ: overheadZ + 0.04, driftX: 0.04, driftZ: 0.12, delay: 0.16, mat: pipeMetalMat },
        { startX: 0.52, startY: pipeRestY + 0.12, startZ: overheadZ + 0.06, driftX: -0.07, driftZ: 0.18, delay: 0.24, mat: darkSteelMat },
        { startX: -0.82, startY: pipeRestY + 0.15, startZ: overheadZ + 0.05, driftX: 0.05, driftZ: 0.15, delay: 0.32, mat: pipeMetalMat },
        { startX: 0.28, startY: pipeRestY + 0.08, startZ: overheadZ + 0.08, driftX: -0.04, driftZ: 0.14, delay: 0.4, mat: darkSteelMat },
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
        { warnX: 0.54, warnY: pipeRestY + 0.14, warnZ: overheadZ + 0.06, impX: -0.58, impZ: impactZ + 0.08, maxScale: 1.35 },
        { warnX: -0.54, warnY: pipeRestY + 0.14, warnZ: overheadZ + 0.06, impX: -0.18, impZ: impactZ - 0.06, maxScale: 1.45 },
        { warnX: 0.82, warnY: pipeRestY + 0.12, warnZ: overheadZ + 0.04, impX: 0.22, impZ: impactZ + 0.1, maxScale: 1.5 },
        { warnX: -0.82, warnY: pipeRestY + 0.12, warnZ: overheadZ + 0.04, impX: 0.62, impZ: impactZ - 0.04, maxScale: 1.3 },
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
      const steamGroup = new THREE.Group()
      steamGroup.name = 'hazard-steam-pipe'
      steamGroup.position.set(0, 1.5, 0)

      const pipeMat = getPooledMaterial(
        'steam_pipe:metal',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x4a3b32,
            roughness: 0.85,
            metalness: 0.5,
          })
      )
      // Instance-owned material so independent steam bursts never overwrite shared pooled opacity
      const steamMat = new THREE.MeshStandardMaterial({
        color: 0xd9e2ec,
        emissive: 0x9fb3c8,
        emissiveIntensity: 0.6,
        roughness: 0.9,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      })

      const pipeGeo = getPooledGeometry(
        'steam_pipe:segment',
        () => new THREE.CylinderGeometry(0.12, 0.12, 1.8, 8)
      )
      const pipe = new THREE.Mesh(pipeGeo, pipeMat)
      steamGroup.add(pipe)

      const cloudGeo = getPooledGeometry(
        'steam_pipe:cloud',
        () => new THREE.SphereGeometry(0.6, 8, 8)
      )
      const cloud = new THREE.Mesh(cloudGeo, steamMat)
      cloud.position.set(0, 0, 0.5)
      cloud.visible = false
      steamGroup.add(cloud)

      root.add(steamGroup)
      root.userData = { hazardType: type, steamGroup, steamPipe: pipe, steamCloud: cloud, steamMat }
      break
    }

    case HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING: {
      const mountType = hazardData.mountType === 'ceiling' ? 'ceiling' : 'wall'
      const wallYaw = Number.isFinite(hazardData.wallYaw) ? hazardData.wallYaw : 0

      const mountGroup = new THREE.Group()
      mountGroup.name = `hazard-wiring-${mountType}-mount`
      mountGroup.rotation.y = mountType === 'wall' ? wallYaw : 0
      root.add(mountGroup)

      const conduitMat = getPooledMaterial(
        'wiring:conduit',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wiringConduit,
            roughness: 0.52,
            metalness: 0.72,
          })
      )
      const hardwareMat = getPooledMaterial(
        'wiring:hardware',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wiringHardware,
            roughness: 0.72,
            metalness: 0.58,
          })
      )
      const cableMat = getPooledMaterial(
        'wiring:cable',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wiringCable,
            roughness: 0.85,
            metalness: 0.08,
          })
      )
      const cautionMat = getPooledMaterial(
        'wiring:caution',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wiringCaution,
            roughness: 0.76,
            metalness: 0.12,
          })
      )

      // Instance-owned materials for independent flickering, arcing, and burned-out states
      const tipMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.wiringCopper,
        emissive: HAZARD_PALETTE.wiringSparkWarning,
        emissiveIntensity: 0.18,
        roughness: 0.35,
        metalness: 0.82,
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

      const cableSegGeo = getPooledGeometry(
        'wiring:cableSeg',
        () => new THREE.CylinderGeometry(0.022, 0.02, 0.78, 6)
      )
      const tipGeo = getPooledGeometry(
        'wiring:copperTip',
        () => new THREE.CylinderGeometry(0.015, 0.008, 0.11, 5)
      )
      const clampGeo = getPooledGeometry(
        'wiring:clamp',
        () => new THREE.BoxGeometry(0.14, 0.05, 0.09)
      )
      const arcSegGeo = getPooledGeometry(
        'wiring:arcSeg',
        () => new THREE.BoxGeometry(0.026, 0.34, 0.026)
      )
      const sparkGeo = getPooledGeometry(
        'wiring:spark',
        () => new THREE.BoxGeometry(0.032, 0.075, 0.032)
      )
      const glowGeo = getPooledGeometry(
        'wiring:glow',
        () => new THREE.SphereGeometry(0.32, 8, 8)
      )

      const cableGroup = new THREE.Group()
      cableGroup.name = 'hazard-wiring-cables'
      let cableRestY
      let dischargeLocalY
      let dischargeLocalZ

      if (mountType === 'wall') {
        const wallZ = -CELL_SIZE * 0.5
        // Vertical conduit running from junction box up to ceiling soffit (y = 3.56)
        const conduitGeo = getPooledGeometry(
          'wiring:wallConduit',
          () => new THREE.CylinderGeometry(0.038, 0.038, 1.5, 8)
        )
        const conduit = new THREE.Mesh(conduitGeo, conduitMat)
        conduit.position.set(0, 2.81, wallZ + 0.06)
        mountGroup.add(conduit)

        for (const cy of [2.46, 3.16]) {
          const clamp = new THREE.Mesh(clampGeo, hardwareMat)
          clamp.position.set(0, cy, wallZ + 0.05)
          mountGroup.add(clamp)
        }

        // Ruptured wall-mounted junction box flush against wall face
        const boxGeo = getPooledGeometry(
          'wiring:junctionBox',
          () => new THREE.BoxGeometry(0.46, 0.56, 0.18)
        )
        const box = new THREE.Mesh(boxGeo, hardwareMat)
        box.position.set(0, 1.92, wallZ + 0.09)
        mountGroup.add(box)

        // Caution warning strip on upper housing
        const stripeGeo = getPooledGeometry(
          'wiring:cautionStripe',
          () => new THREE.BoxGeometry(0.36, 0.07, 0.02)
        )
        const stripe = new THREE.Mesh(stripeGeo, cautionMat)
        stripe.position.set(0, 2.1, wallZ + 0.185)
        mountGroup.add(stripe)

        // Blown-open crooked cover plate
        const coverGeo = getPooledGeometry(
          'wiring:coverPlate',
          () => new THREE.BoxGeometry(0.42, 0.44, 0.03)
        )
        const cover = new THREE.Mesh(coverGeo, conduitMat)
        cover.position.set(-0.22, 1.78, wallZ + 0.23)
        cover.rotation.set(0.38, 0.58, -0.28)
        mountGroup.add(cover)

        // Damaged live cables spilling from ruptured box into corridor
        cableRestY = 1.84
        cableGroup.position.set(0, cableRestY, wallZ + 0.16)
        const wallCableSpecs = [
          { x: -0.14, y: -0.28, z: 0.34, rx: 0.92, rz: 0.24 },
          { x: 0.04, y: -0.34, z: 0.38, rx: 0.84, rz: -0.12 },
          { x: 0.16, y: -0.26, z: 0.33, rx: 0.96, rz: -0.28 },
          { x: -0.05, y: -0.42, z: 0.3, rx: 0.62, rz: 0.08 },
        ]
        for (let i = 0; i < wallCableSpecs.length; i += 1) {
          const cs = wallCableSpecs[i]
          const seg = new THREE.Mesh(cableSegGeo, cableMat)
          seg.position.set(cs.x, cs.y, cs.z)
          seg.rotation.set(cs.rx, 0, cs.rz)
          cableGroup.add(seg)

          const tip = new THREE.Mesh(tipGeo, tipMat)
          tip.position.set(
            cs.x * 1.45,
            cs.y - 0.24,
            cs.z + 0.3
          )
          tip.rotation.set(cs.rx + 0.22, 0, cs.rz)
          cableGroup.add(tip)
        }
        mountGroup.add(cableGroup)

        dischargeLocalY = 1.45
        dischargeLocalZ = -1.18
      } else {
        // Ceiling-hanging damaged electrical conduit & cable bundle anchored to soffit (y = 3.6)
        const flangeGeo = getPooledGeometry(
          'wiring:ceilingFlange',
          () => new THREE.CylinderGeometry(0.24, 0.26, 0.08, 10)
        )
        const flange = new THREE.Mesh(flangeGeo, hardwareMat)
        flange.position.set(0, 3.56, 0)
        mountGroup.add(flange)

        const collarGeo = getPooledGeometry(
          'wiring:ceilingBox',
          () => new THREE.BoxGeometry(0.38, 0.22, 0.38)
        )
        const collar = new THREE.Mesh(collarGeo, hardwareMat)
        collar.position.set(0, 3.42, 0)
        mountGroup.add(collar)

        const hangingConduitGeo = getPooledGeometry(
          'wiring:ceilingConduit',
          () => new THREE.CylinderGeometry(0.042, 0.042, 0.95, 8)
        )
        const hangingConduit = new THREE.Mesh(hangingConduitGeo, conduitMat)
        hangingConduit.position.set(0.05, 2.94, 0)
        hangingConduit.rotation.z = 0.14
        mountGroup.add(hangingConduit)

        cableRestY = 2.48
        cableGroup.position.set(0, cableRestY, 0)
        const ceilingCableSpecs = [
          { x: -0.14, y: -0.4, z: 0.12, rx: 0.28, rz: 0.26 },
          { x: 0.16, y: -0.44, z: -0.1, rx: -0.22, rz: -0.3 },
          { x: 0.06, y: -0.5, z: 0.16, rx: 0.34, rz: -0.12 },
          { x: -0.1, y: -0.46, z: -0.15, rx: -0.28, rz: 0.18 },
        ]
        for (let i = 0; i < ceilingCableSpecs.length; i += 1) {
          const cs = ceilingCableSpecs[i]
          const seg = new THREE.Mesh(cableSegGeo, cableMat)
          seg.position.set(cs.x, cs.y, cs.z)
          seg.rotation.set(cs.rx, 0, cs.rz)
          cableGroup.add(seg)

          const tip = new THREE.Mesh(tipGeo, tipMat)
          tip.position.set(cs.x * 1.45, cs.y - 0.38, cs.z * 1.45)
          tip.rotation.set(cs.rx, 0, cs.rz)
          cableGroup.add(tip)
        }
        mountGroup.add(cableGroup)

        dischargeLocalY = 1.65
        dischargeLocalZ = 0
      }

      // Bounded electrical arc & spark assembly centered on the exposed copper tips
      const dischargeGroup = new THREE.Group()
      dischargeGroup.name = 'hazard-wiring-discharge'
      dischargeGroup.position.set(0, dischargeLocalY, dischargeLocalZ)
      mountGroup.add(dischargeGroup)

      const arcGroup = new THREE.Group()
      arcGroup.name = 'hazard-wiring-arcs'
      arcGroup.visible = false
      const arcBolts = []
      const boltConfigs = [
        { baseRotY: 0, baseRotZ: 0.35, offsetX: -0.12, offsetZ: 0.06 },
        { baseRotY: 1.9, baseRotZ: -0.42, offsetX: 0.14, offsetZ: -0.04 },
        { baseRotY: -1.6, baseRotZ: 0.28, offsetX: 0.02, offsetZ: 0.12 },
      ]
      for (let b = 0; b < boltConfigs.length; b += 1) {
        const bc = boltConfigs[b]
        const bolt = new THREE.Group()
        bolt.position.set(bc.offsetX, 0, bc.offsetZ)
        bolt.rotation.set(0, bc.baseRotY, bc.baseRotZ)

        for (let s = 0; s < 3; s += 1) {
          const seg = new THREE.Mesh(arcSegGeo, arcMat)
          const zig = s % 2 === 0 ? 0.08 : -0.08
          seg.position.set(zig, (s - 1) * 0.24, 0)
          seg.rotation.z = s % 2 === 0 ? 0.52 : -0.52
          bolt.add(seg)
        }
        arcGroup.add(bolt)
        arcBolts.push(bolt)
      }
      dischargeGroup.add(arcGroup)

      // Bounded 8 spark shards with deterministic trajectories (zero per-frame allocations)
      const sparkGroup = new THREE.Group()
      sparkGroup.name = 'hazard-wiring-sparks'
      sparkGroup.visible = false
      const sparkMeshes = []
      const sparkConfigs = []
      const MAX_WIRING_SPARKS = 8
      for (let i = 0; i < MAX_WIRING_SPARKS; i += 1) {
        const angle = (i / MAX_WIRING_SPARKS) * Math.PI * 2 + (i % 2) * 0.31
        const elev = 0.25 + (i % 3) * 0.22
        sparkConfigs.push({
          dx: Math.cos(angle) * 0.72,
          dy: elev,
          dz: Math.sin(angle) * 0.72,
          phase: (i * 0.37) % 1,
          speed: 2.2 + (i % 4) * 0.45,
        })
        const spark = new THREE.Mesh(sparkGeo, sparkMat)
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
        cableGroup,
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
      }
      break
    }

    case HAZARD_TYPES.COLLAPSING_FLOOR_GRATE: {
      const grateYaw = Number.isFinite(hazardData.grateYaw) ? hazardData.grateYaw : 0
      const corridorAxis = hazardData.corridorAxis === 'ew' ? 'ew' : 'ns'

      const grateRoot = new THREE.Group()
      grateRoot.name = 'hazard-floor-grate-root'
      grateRoot.rotation.y = grateYaw
      root.add(grateRoot)

      const pitMat = getPooledMaterial(
        'grate:pit',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.gratePit,
            roughness: 1.0,
            metalness: 0.0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          })
      )
      const subPipeMat = getPooledMaterial(
        'grate:subPipe',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateSubPipe,
            roughness: 0.9,
            metalness: 0.35,
          })
      )
      const curbMat = getPooledMaterial(
        'grate:curb',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateCurb,
            roughness: 0.82,
            metalness: 0.48,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          })
      )
      const ironMat = getPooledMaterial(
        'grate:iron',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateIron,
            roughness: 0.78,
            metalness: 0.62,
          })
      )
      const rustMat = getPooledMaterial(
        'grate:rust',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateRust,
            roughness: 0.92,
            metalness: 0.28,
          })
      )
      const boltMat = getPooledMaterial(
        'grate:bolt',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateBolt,
            roughness: 0.55,
            metalness: 0.78,
          })
      )

      // Instance-owned dust material so each collapsing grate fades dust independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.grateDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Recessed dark drainage pit flush at y = 0.004 (polygon-offset prevents floor Z-fighting)
      const pitGeo = getPooledGeometry('grate:pitPlane', () => new THREE.PlaneGeometry(2.14, 1.94))
      const pitMesh = new THREE.Mesh(pitGeo, pitMat)
      pitMesh.rotation.x = -Math.PI * 0.5
      pitMesh.position.set(0, 0.004, 0)
      grateRoot.add(pitMesh)

      // Subtle subfloor pipes crossing inside the recessed pit cavity
      const subPipeGeo = getPooledGeometry(
        'grate:subPipe',
        () => new THREE.CylinderGeometry(0.032, 0.032, 1.9, 6)
      )
      for (const px of [-0.52, 0.46]) {
        const subPipe = new THREE.Mesh(subPipeGeo, subPipeMat)
        subPipe.rotation.x = Math.PI * 0.5
        subPipe.position.set(px, 0.007, 0)
        grateRoot.add(subPipe)
      }

      // 2. Flush floor-embedded cast-iron perimeter curb (y = 0..0.020)
      const railHGeo = getPooledGeometry('grate:railH', () => new THREE.BoxGeometry(2.38, 0.02, 0.12))
      const railVGeo = getPooledGeometry('grate:railV', () => new THREE.BoxGeometry(0.12, 0.02, 1.94))
      for (const rz of [-1.03, 1.03]) {
        const rail = new THREE.Mesh(railHGeo, curbMat)
        rail.position.set(0, 0.01, rz)
        grateRoot.add(rail)
      }
      for (const rx of [-1.13, 1.13]) {
        const rail = new THREE.Mesh(railVGeo, curbMat)
        rail.position.set(rx, 0.01, 0)
        grateRoot.add(rail)
      }

      // 3. Corner anchor bolts (vibrate & loosen during warning, shear during collapse)
      const boltGeo = getPooledGeometry('grate:bolt', () => new THREE.CylinderGeometry(0.034, 0.034, 0.024, 6))
      const boltRestPositions = [
        { x: -1.11, y: 0.022, z: -1.01, sx: -1.24, sz: -1.12 },
        { x: 1.11, y: 0.022, z: -1.01, sx: 1.25, sz: -1.14 },
        { x: -1.11, y: 0.022, z: 1.01, sx: -1.22, sz: 1.16 },
        { x: 1.11, y: 0.022, z: 1.01, sx: 1.26, sz: 1.12 },
      ]
      const bolts = []
      for (let i = 0; i < boltRestPositions.length; i += 1) {
        const bp = boltRestPositions[i]
        const bolt = new THREE.Mesh(boltGeo, i % 2 === 0 ? boltMat : rustMat)
        bolt.position.set(bp.x, bp.y, bp.z)
        grateRoot.add(bolt)
        bolts.push(bolt)
      }

      // 4. Collapsible two-leaf corroded steel floor grate flush inside curb (y = 0.015)
      const grateRestY = 0.015
      const leafBarGeo = getPooledGeometry('grate:leafBar', () => new THREE.BoxGeometry(1.02, 0.018, 0.075))
      const leafCrossGeo = getPooledGeometry('grate:leafCross', () => new THREE.BoxGeometry(0.055, 0.014, 1.88))
      const seamRustGeo = getPooledGeometry('grate:seamRust', () => new THREE.BoxGeometry(0.07, 0.019, 1.84))

      const buildLeaf = (dirSign) => {
        const leaf = new THREE.Group()
        leaf.position.set(-dirSign * 1.04, grateRestY, 0)
        const zBars = [-0.82, -0.41, 0, 0.41, 0.82]
        for (let b = 0; b < zBars.length; b += 1) {
          const bar = new THREE.Mesh(leafBarGeo, b === 2 ? rustMat : ironMat)
          bar.position.set(dirSign * 0.51, 0, zBars[b])
          leaf.add(bar)
        }
        for (const cx of [0.22, 0.58, 0.92]) {
          const cross = new THREE.Mesh(leafCrossGeo, cx > 0.85 ? rustMat : ironMat)
          cross.position.set(dirSign * cx, -0.002, 0)
          leaf.add(cross)
        }
        const seam = new THREE.Mesh(seamRustGeo, rustMat)
        seam.position.set(dirSign * 0.99, 0.001, 0)
        leaf.add(seam)
        return leaf
      }

      const leftLeafGroup = buildLeaf(1)
      leftLeafGroup.name = 'hazard-grate-left-leaf'
      const rightLeafGroup = buildLeaf(-1)
      rightLeafGroup.name = 'hazard-grate-right-leaf'
      grateRoot.add(leftLeafGroup)
      grateRoot.add(rightLeafGroup)

      // 5. Jagged bent perimeter fracture stubs shown once grate breaks open
      const brokenStubsGroup = new THREE.Group()
      brokenStubsGroup.name = 'hazard-grate-broken-stubs'
      brokenStubsGroup.visible = false
      const stubGeo = getPooledGeometry('grate:stub', () => new THREE.BoxGeometry(0.24, 0.018, 0.065))
      const stubSpecs = [
        { x: -1.0, z: -0.62, rz: -0.58, ry: 0.14 },
        { x: -1.0, z: 0.24, rz: -0.72, ry: -0.18 },
        { x: 1.0, z: -0.35, rz: 0.64, ry: 0.12 },
        { x: 1.0, z: 0.66, rz: 0.52, ry: -0.16 },
      ]
      for (let i = 0; i < stubSpecs.length; i += 1) {
        const st = stubSpecs[i]
        const stub = new THREE.Mesh(stubGeo, i % 2 === 0 ? rustMat : ironMat)
        stub.position.set(st.x, 0.014, st.z)
        stub.rotation.set(0, st.ry, st.rz)
        brokenStubsGroup.add(stub)
      }
      grateRoot.add(brokenStubsGroup)

      // 6. Bounded warning falling fragments (6 chips dropping along seam during warning)
      const warningFragGroup = new THREE.Group()
      warningFragGroup.name = 'hazard-grate-warning-fragments'
      warningFragGroup.visible = false
      const fragGeo = getPooledGeometry('grate:frag', () => new THREE.BoxGeometry(0.055, 0.022, 0.055))
      const warningFragments = []
      const warningFragConfigs = []
      const MAX_WARNING_FRAGS = 6
      for (let i = 0; i < MAX_WARNING_FRAGS; i += 1) {
        const sx = (i % 2 === 0 ? -1 : 1) * (0.08 + (i % 3) * 0.12)
        const sz = -0.75 + i * 0.3
        warningFragConfigs.push({
          x: sx,
          z: sz,
          phase: (i * 0.29) % 1,
          speed: 1.8 + (i % 3) * 0.35,
        })
        const chip = new THREE.Mesh(fragGeo, i % 2 === 0 ? rustMat : ironMat)
        chip.position.set(sx, 0.02, sz)
        warningFragGroup.add(chip)
        warningFragments.push(chip)
      }
      grateRoot.add(warningFragGroup)

      // 7. Bounded collapse debris shards (8 fragments scattering & settling around broken curb)
      const debrisGroup = new THREE.Group()
      debrisGroup.name = 'hazard-grate-debris'
      debrisGroup.visible = false
      const debrisGeo = getPooledGeometry('grate:debris', () => new THREE.BoxGeometry(0.11, 0.032, 0.075))
      const debrisMeshes = []
      const debrisConfigs = []
      const MAX_DEBRIS = 8
      for (let i = 0; i < MAX_DEBRIS; i += 1) {
        const angle = (i / MAX_DEBRIS) * Math.PI * 2 + 0.25
        const dist = 1.18 + (i % 3) * 0.16
        debrisConfigs.push({
          startX: Math.cos(angle) * 0.35,
          startZ: Math.sin(angle) * 0.3,
          endX: Math.cos(angle) * dist,
          endZ: Math.sin(angle) * dist,
          arcH: 0.22 + (i % 3) * 0.09,
          rotY: angle + i * 0.5,
        })
        const shard = new THREE.Mesh(debrisGeo, i % 2 === 0 ? rustMat : ironMat)
        debrisGroup.add(shard)
        debrisMeshes.push(shard)
      }
      grateRoot.add(debrisGroup)

      // 8. Bounded dust burst puffs (6 lightweight spheres rising & fading during collapse)
      const dustGroup = new THREE.Group()
      dustGroup.name = 'hazard-grate-dust'
      dustGroup.visible = false
      const dustGeo = getPooledGeometry('grate:dust', () => new THREE.SphereGeometry(0.24, 7, 7))
      const dustMeshes = []
      const dustConfigs = []
      const MAX_DUST = 6
      for (let i = 0; i < MAX_DUST; i += 1) {
        const angle = (i / MAX_DUST) * Math.PI * 2
        dustConfigs.push({
          dx: Math.cos(angle) * (0.48 + (i % 2) * 0.24),
          dz: Math.sin(angle) * (0.44 + (i % 2) * 0.2),
          riseY: 0.42 + (i % 3) * 0.18,
          baseScale: 0.65 + (i % 3) * 0.2,
        })
        const puff = new THREE.Mesh(dustGeo, dustMat)
        dustGroup.add(puff)
        dustMeshes.push(puff)
      }
      grateRoot.add(dustGroup)

      root.userData = {
        hazardType: type,
        floorY: 0,
        corridorAxis,
        grateYaw,
        grateRestY,
        grateRoot,
        pitMesh,
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
      }
      break
    }

    case HAZARD_TYPES.WALL_COLLAPSE: {
      const wallYaw = Number.isFinite(hazardData.wallYaw) ? hazardData.wallYaw : 0
      const wallSide = hazardData.wallSide || 'north'
      const wallZ = -CELL_SIZE * 0.5

      const wallMountGroup = new THREE.Group()
      wallMountGroup.name = `hazard-wall-collapse-${wallSide}`
      wallMountGroup.rotation.y = wallYaw
      root.add(wallMountGroup)

      const concreteMat = getPooledMaterial(
        'wall_collapse:concrete',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wallConcrete,
            roughness: 0.94,
            metalness: 0.02,
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
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          })
      )
      const crackMat = getPooledMaterial(
        'wall_collapse:crack',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wallCrack,
            roughness: 1.0,
            metalness: 0.0,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
          })
      )
      const rebarMat = getPooledMaterial(
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
            roughness: 0.93,
            metalness: 0.03,
          })
      )

      // Instance-owned dust material so each collapsing wall fades independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wallDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Recessed fractured cavity backing flush on wall face (never removes actual maze wall)
      const cavityGeo = getPooledGeometry(
        'wall_collapse:cavityPlane',
        () => new THREE.PlaneGeometry(2.16, 2.32)
      )
      const cavityMesh = new THREE.Mesh(cavityGeo, cavityMat)
      cavityMesh.position.set(0, 1.32, wallZ + 0.008)
      wallMountGroup.add(cavityMesh)

      // Jagged fractured perimeter rim framing the damaged wall opening
      const rimGroup = new THREE.Group()
      rimGroup.name = 'hazard-wall-fracture-rim'
      const rimVGeo = getPooledGeometry('wall_collapse:rimV', () => new THREE.BoxGeometry(0.14, 2.38, 0.09))
      const rimHGeo = getPooledGeometry('wall_collapse:rimH', () => new THREE.BoxGeometry(2.3, 0.14, 0.09))
      for (const rx of [-1.08, 1.08]) {
        const post = new THREE.Mesh(rimVGeo, concreteMat)
        post.position.set(rx, 1.32, wallZ + 0.045)
        rimGroup.add(post)
      }
      const lintel = new THREE.Mesh(rimHGeo, concreteMat)
      lintel.position.set(0, 2.48, wallZ + 0.045)
      rimGroup.add(lintel)
      wallMountGroup.add(rimGroup)

      // 2. Exposed bent structural rebar revealed inside the broken cavity
      const rebarGroup = new THREE.Group()
      rebarGroup.name = 'hazard-wall-rebar'
      const rebarGeo = getPooledGeometry(
        'wall_collapse:rebar',
        () => new THREE.CylinderGeometry(0.014, 0.014, 1.95, 5)
      )
      const rebarSpecs = [
        { x: -0.62, y: 1.34, rz: 0.08, rx: 0.04 },
        { x: -0.18, y: 1.28, rz: -0.11, rx: 0.08 },
        { x: 0.28, y: 1.38, rz: 0.06, rx: -0.05 },
        { x: 0.68, y: 1.26, rz: -0.09, rx: 0.07 },
        { x: 0.0, y: 1.48, rz: Math.PI * 0.5 + 0.06, rx: 0.03 },
      ]
      for (let i = 0; i < rebarSpecs.length; i += 1) {
        const rb = rebarSpecs[i]
        const rod = new THREE.Mesh(rebarGeo, rebarMat)
        rod.position.set(rb.x, rb.y, wallZ + 0.035)
        rod.rotation.set(rb.rx, 0, rb.rz)
        rebarGroup.add(rod)
      }
      wallMountGroup.add(rebarGroup)

      // 3. Collapsible fractured concrete wall slabs (distinguishable weathered masonry section)
      const slabGroup = new THREE.Group()
      slabGroup.name = 'hazard-wall-slabs'
      const slabGeo = getPooledGeometry('wall_collapse:slab', () => new THREE.BoxGeometry(0.98, 1.04, 0.14))
      const slabConfigs = [
        {
          restX: -0.52,
          restY: 1.86,
          restZ: wallZ + 0.085,
          endX: -0.64,
          endY: 0.16,
          endZ: wallZ + 0.92,
          endRx: 1.42,
          endRy: 0.22,
          endRz: -0.18,
          bulgeZ: 0.095,
        },
        {
          restX: 0.52,
          restY: 1.84,
          restZ: wallZ + 0.085,
          endX: 0.66,
          endY: 0.18,
          endZ: wallZ + 1.02,
          endRx: 1.48,
          endRy: -0.26,
          endRz: 0.2,
          bulgeZ: 0.105,
        },
        {
          restX: -0.5,
          restY: 0.78,
          restZ: wallZ + 0.08,
          endX: -0.34,
          endY: 0.11,
          endZ: wallZ + 0.58,
          endRx: 1.54,
          endRy: -0.14,
          endRz: 0.12,
          bulgeZ: 0.075,
        },
        {
          restX: 0.5,
          restY: 0.78,
          restZ: wallZ + 0.08,
          endX: 0.36,
          endY: 0.12,
          endZ: wallZ + 0.64,
          endRx: 1.5,
          endRy: 0.18,
          endRz: -0.14,
          bulgeZ: 0.08,
        },
      ]
      const slabMeshes = []
      for (let i = 0; i < slabConfigs.length; i += 1) {
        const sc = slabConfigs[i]
        const slab = new THREE.Mesh(slabGeo, i % 2 === 0 ? concreteMat : rubbleMat)
        slab.position.set(sc.restX, sc.restY, sc.restZ)
        slabGroup.add(slab)
        slabMeshes.push(slab)
      }
      wallMountGroup.add(slabGroup)

      // 4. Spreading dark structural crack lines across the damaged masonry face
      const crackGroup = new THREE.Group()
      crackGroup.name = 'hazard-wall-cracks'
      crackGroup.position.set(0, 1.32, wallZ + 0.165)
      const crackGeo = getPooledGeometry('wall_collapse:crackStrip', () => new THREE.BoxGeometry(0.042, 0.92, 0.012))
      const crackSpecs = [
        { x: 0.0, y: 0.12, rz: 0.16, sy: 1.15 },
        { x: -0.32, y: 0.36, rz: -0.52, sy: 0.85 },
        { x: 0.36, y: 0.24, rz: 0.48, sy: 0.9 },
        { x: -0.26, y: -0.32, rz: 0.64, sy: 0.78 },
        { x: 0.28, y: -0.28, rz: -0.58, sy: 0.82 },
      ]
      for (let i = 0; i < crackSpecs.length; i += 1) {
        const cs = crackSpecs[i]
        const strip = new THREE.Mesh(crackGeo, crackMat)
        strip.position.set(cs.x, cs.y, 0)
        strip.rotation.z = cs.rz
        strip.scale.set(1, cs.sy, 1)
        crackGroup.add(strip)
      }
      wallMountGroup.add(crackGroup)

      // 5. Bounded warning loose masonry & falling dust flakes (6 chips)
      const warningGroup = new THREE.Group()
      warningGroup.name = 'hazard-wall-warning-masonry'
      warningGroup.visible = false
      const warnChipGeo = getPooledGeometry('wall_collapse:warnChip', () => new THREE.BoxGeometry(0.075, 0.065, 0.055))
      const warningChunks = []
      const warningChunkConfigs = []
      const MAX_WALL_WARN_CHIPS = 6
      for (let i = 0; i < MAX_WALL_WARN_CHIPS; i += 1) {
        const wx = -0.78 + i * 0.31
        const startY = 1.65 + (i % 3) * 0.28
        warningChunkConfigs.push({
          x: wx,
          startY,
          z: wallZ + 0.19 + (i % 2) * 0.06,
          phase: (i * 0.31) % 1,
          speed: 1.55 + (i % 3) * 0.3,
        })
        const chip = new THREE.Mesh(warnChipGeo, i % 2 === 0 ? rubbleMat : concreteMat)
        warningGroup.add(chip)
        warningChunks.push(chip)
      }
      wallMountGroup.add(warningGroup)

      // 6. Bounded collapse rubble chunks (8 blocks settling in controlled corridor apron)
      const wallRubbleGroup = new THREE.Group()
      wallRubbleGroup.name = 'hazard-wall-rubble'
      wallRubbleGroup.visible = false
      const rubbleBlockGeo = getPooledGeometry('wall_collapse:rubbleBlock', () => new THREE.BoxGeometry(0.24, 0.16, 0.2))
      const wallRubbleMeshes = []
      const wallRubbleConfigs = []
      const MAX_WALL_RUBBLE = 8
      for (let i = 0; i < MAX_WALL_RUBBLE; i += 1) {
        const lane = -0.96 + (i / (MAX_WALL_RUBBLE - 1)) * 1.92
        const reach = 0.34 + (i % 4) * 0.24 // Stays within 0.34..1.06m of wall face (leaves ~2.9m corridor open!)
        wallRubbleConfigs.push({
          startX: lane * 0.7,
          startY: 0.75 + (i % 3) * 0.58,
          startZ: wallZ + 0.14,
          endX: lane,
          endY: 0.08 + (i % 2) * 0.04,
          endZ: wallZ + reach,
          arcH: 0.28 + (i % 3) * 0.14,
          rotY: 0.4 + i * 0.75,
        })
        const block = new THREE.Mesh(rubbleBlockGeo, i % 2 === 0 ? rubbleMat : concreteMat)
        wallRubbleGroup.add(block)
        wallRubbleMeshes.push(block)
      }
      wallMountGroup.add(wallRubbleGroup)

      // 7. Bounded dust cloud puffs (6 spheres billowing outward and fading cleanly)
      const wallDustGroup = new THREE.Group()
      wallDustGroup.name = 'hazard-wall-dust'
      wallDustGroup.visible = false
      const wallDustGeo = getPooledGeometry('wall_collapse:dust', () => new THREE.SphereGeometry(0.32, 7, 7))
      const wallDustMeshes = []
      const wallDustConfigs = []
      const MAX_WALL_DUST = 6
      for (let i = 0; i < MAX_WALL_DUST; i += 1) {
        wallDustConfigs.push({
          x: -0.75 + i * 0.3,
          startY: 0.45 + (i % 3) * 0.42,
          riseY: 0.55 + (i % 2) * 0.28,
          reachZ: 0.45 + (i % 3) * 0.32,
          baseScale: 0.7 + (i % 3) * 0.22,
        })
        const puff = new THREE.Mesh(wallDustGeo, dustMat)
        wallDustGroup.add(puff)
        wallDustMeshes.push(puff)
      }
      wallMountGroup.add(wallDustGroup)

      root.userData = {
        hazardType: type,
        wallSide,
        wallYaw,
        wallZ,
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
      const surgeLength = Number.isFinite(hazardData.surgeLength) ? hazardData.surgeLength : 2.55
      const surgeHalfWidth = Number.isFinite(hazardData.surgeHalfWidth) ? hazardData.surgeHalfWidth : 1.05
      const tankRestY = Number.isFinite(hazardData.tankRestY) ? hazardData.tankRestY : 2.48
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY) ? hazardData.ceilingAnchorY : 3.58
      const tankFallenY = 0.44

      const tankMountGroup = new THREE.Group()
      tankMountGroup.name = `hazard-water-tank-${mountType}`
      tankMountGroup.rotation.y = tankYaw
      root.add(tankMountGroup)

      const steelMat = getPooledMaterial(
        'water_tank:steel',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankSteel,
            roughness: 0.62,
            metalness: 0.58,
          })
      )
      const rustMat = getPooledMaterial(
        'water_tank:rust',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankRust,
            roughness: 0.92,
            metalness: 0.24,
          })
      )
      const bracketMat = getPooledMaterial(
        'water_tank:bracket',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankBracket,
            roughness: 0.52,
            metalness: 0.78,
          })
      )
      const pipeMat = getPooledMaterial(
        'water_tank:pipe',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankPipe,
            roughness: 0.68,
            metalness: 0.62,
          })
      )
      const seamMat = getPooledMaterial(
        'water_tank:seam',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankSeam,
            roughness: 0.96,
            metalness: 0.12,
          })
      )

      // Instance-owned translucent water materials (disposed per hazard instance)
      const leakMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.waterLeak,
        roughness: 0.14,
        metalness: 0.12,
        transparent: true,
        opacity: 0.32,
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

      // 1. Structural overhead support rig anchored to ceiling slab (never floating)
      const supportGroup = new THREE.Group()
      supportGroup.name = 'hazard-water-tank-supports'

      const beamGeo = getPooledGeometry(
        'water_tank:ceilingBeam',
        () => new THREE.BoxGeometry(1.56, 0.12, 0.24)
      )
      const ceilingBeam = new THREE.Mesh(beamGeo, bracketMat)
      ceilingBeam.position.set(0, ceilingAnchorY - 0.06, 0)
      supportGroup.add(ceilingBeam)

      const anchorPlateGeo = getPooledGeometry(
        'water_tank:anchorPlate',
        () => new THREE.BoxGeometry(0.26, 0.04, 0.28)
      )
      const upperRodGeo = getPooledGeometry(
        'water_tank:upperRod',
        () => new THREE.CylinderGeometry(0.024, 0.024, 0.56, 6)
      )
      const lowerStrapGeo = getPooledGeometry(
        'water_tank:lowerStrap',
        () => new THREE.BoxGeometry(0.075, 0.54, 0.024)
      )
      const strapRestY = 2.74
      const brokenStraps = []
      for (const sx of [-0.46, 0.46]) {
        const plate = new THREE.Mesh(anchorPlateGeo, rustMat)
        plate.position.set(sx, ceilingAnchorY - 0.01, 0)
        supportGroup.add(plate)

        const upperRod = new THREE.Mesh(upperRodGeo, bracketMat)
        upperRod.position.set(sx, ceilingAnchorY - 0.34, 0)
        supportGroup.add(upperRod)

        const lowerStrap = new THREE.Mesh(lowerStrapGeo, rustMat)
        lowerStrap.position.set(sx, strapRestY, 0)
        supportGroup.add(lowerStrap)
        brokenStraps.push(lowerStrap)
      }

      // Corroded overhead feeder pipe connected into ceiling deck
      const feederPipeGeo = getPooledGeometry(
        'water_tank:feederPipe',
        () => new THREE.CylinderGeometry(0.055, 0.055, 0.68, 8)
      )
      const feederPipe = new THREE.Mesh(feederPipeGeo, pipeMat)
      feederPipe.position.set(0.28, ceilingAnchorY - 0.34, -0.06)
      supportGroup.add(feederPipe)

      const feederFlangeGeo = getPooledGeometry(
        'water_tank:feederFlange',
        () => new THREE.CylinderGeometry(0.095, 0.095, 0.045, 8)
      )
      const feederFlange = new THREE.Mesh(feederFlangeGeo, rustMat)
      feederFlange.position.set(0.28, ceilingAnchorY - 0.68, -0.06)
      supportGroup.add(feederFlange)

      // Structural wall brace when backed by an actual maze wall at z = -CELL_SIZE/2
      let wallBraceGroup = null
      if (mountType === 'ceiling_wall_brace') {
        wallBraceGroup = new THREE.Group()
        wallBraceGroup.name = 'hazard-water-tank-wall-brace'
        const wallZ = -CELL_SIZE * 0.5
        const wallPlateGeo = getPooledGeometry(
          'water_tank:wallPlate',
          () => new THREE.BoxGeometry(1.16, 0.34, 0.06)
        )
        const wallPlate = new THREE.Mesh(wallPlateGeo, bracketMat)
        wallPlate.position.set(0, 2.74, wallZ + 0.035)
        wallBraceGroup.add(wallPlate)

        const braceStrutGeo = getPooledGeometry(
          'water_tank:braceStrut',
          () => new THREE.BoxGeometry(0.07, 0.07, 1.82)
        )
        for (const sx of [-0.42, 0.42]) {
          const strut = new THREE.Mesh(braceStrutGeo, rustMat)
          strut.position.set(sx, 3.04, wallZ * 0.52)
          strut.rotation.x = -0.34
          wallBraceGroup.add(strut)
        }
        supportGroup.add(wallBraceGroup)
      }
      tankMountGroup.add(supportGroup)

      // 2. Deteriorated horizontal industrial water tank body (composite multi-part assembly)
      const tankGroup = new THREE.Group()
      tankGroup.name = 'hazard-water-tank-body'
      tankGroup.position.set(0, tankRestY, 0)

      const hullGeo = getPooledGeometry(
        'water_tank:hull',
        () => new THREE.CylinderGeometry(0.45, 0.45, 1.36, 12)
      )
      const hullMesh = new THREE.Mesh(hullGeo, steelMat)
      hullMesh.rotation.z = Math.PI * 0.5
      tankGroup.add(hullMesh)

      const capGeo = getPooledGeometry(
        'water_tank:endCap',
        () => new THREE.SphereGeometry(0.445, 10, 8)
      )
      for (const sx of [-0.68, 0.68]) {
        const cap = new THREE.Mesh(capGeo, steelMat)
        cap.position.set(sx, 0, 0)
        cap.scale.set(0.42, 1, 1)
        tankGroup.add(cap)
      }

      const hoopGeo = getPooledGeometry(
        'water_tank:hoop',
        () => new THREE.TorusGeometry(0.465, 0.028, 6, 14)
      )
      for (const sx of [-0.44, 0.44]) {
        const hoop = new THREE.Mesh(hoopGeo, rustMat)
        hoop.position.set(sx, 0, 0)
        hoop.rotation.y = Math.PI * 0.5
        tankGroup.add(hoop)
      }

      // Corroded rust patch & damaged leaking seam on lower-front face
      const rustPatchGeo = getPooledGeometry(
        'water_tank:rustPatch',
        () => new THREE.BoxGeometry(0.74, 0.24, 0.06)
      )
      const rustPatch = new THREE.Mesh(rustPatchGeo, rustMat)
      rustPatch.position.set(-0.08, -0.28, 0.36)
      rustPatch.rotation.x = 0.55
      tankGroup.add(rustPatch)

      const seamGeo = getPooledGeometry(
        'water_tank:seamCrack',
        () => new THREE.BoxGeometry(0.62, 0.055, 0.04)
      )
      const seamMesh = new THREE.Mesh(seamGeo, seamMat)
      seamMesh.position.set(-0.08, -0.32, 0.375)
      seamMesh.rotation.x = 0.55
      tankGroup.add(seamMesh)

      // Top inlet collar + shutoff valve wheel
      const valveStemGeo = getPooledGeometry(
        'water_tank:valveStem',
        () => new THREE.CylinderGeometry(0.035, 0.045, 0.16, 6)
      )
      const valveStem = new THREE.Mesh(valveStemGeo, pipeMat)
      valveStem.position.set(0.28, 0.48, -0.06)
      tankGroup.add(valveStem)

      const valveWheelGeo = getPooledGeometry(
        'water_tank:valveWheel',
        () => new THREE.TorusGeometry(0.11, 0.018, 6, 10)
      )
      const valveWheel = new THREE.Mesh(valveWheelGeo, rustMat)
      valveWheel.position.set(-0.34, 0.12, 0.47)
      tankGroup.add(valveWheel)

      tankMountGroup.add(tankGroup)

      // 3. Bounded leaking water droplets & thin leak streams (6 droplets + 2 streams)
      const leakGroup = new THREE.Group()
      leakGroup.name = 'hazard-water-tank-leaks'
      const dropGeo = getPooledGeometry(
        'water_tank:droplet',
        () => new THREE.SphereGeometry(0.036, 6, 5)
      )
      const streamGeo = getPooledGeometry(
        'water_tank:leakStream',
        () => new THREE.CylinderGeometry(0.012, 0.022, 1.0, 5)
      )
      const leakDrops = []
      const leakDropConfigs = []
      const MAX_LEAK_DROPS = 6
      for (let i = 0; i < MAX_LEAK_DROPS; i += 1) {
        leakDropConfigs.push({
          x: -0.32 + i * 0.13,
          z: 0.22 + (i % 2) * 0.16,
          startY: tankRestY - 0.38,
          phase: (i * 0.29) % 1,
          speed: 1.45 + (i % 3) * 0.35,
        })
        const drop = new THREE.Mesh(dropGeo, leakMat)
        drop.scale.set(0.85, 1.45, 0.85)
        leakGroup.add(drop)
        leakDrops.push(drop)
      }
      const leakStreams = []
      for (const sx of [-0.2, 0.12]) {
        const stream = new THREE.Mesh(streamGeo, leakMat)
        stream.position.set(sx, 1.04, 0.3)
        stream.scale.set(1, 2.02, 1)
        stream.visible = false
        leakGroup.add(stream)
        leakStreams.push(stream)
      }
      tankMountGroup.add(leakGroup)

      // 4. Bounded fallen bracket/metal fragments (4 pieces)
      const tankDebrisGroup = new THREE.Group()
      tankDebrisGroup.name = 'hazard-water-tank-debris'
      tankDebrisGroup.visible = false
      const debrisGeo = getPooledGeometry(
        'water_tank:debrisFrag',
        () => new THREE.BoxGeometry(0.16, 0.045, 0.09)
      )
      const tankDebrisMeshes = []
      const tankDebrisConfigs = [
        { startX: -0.46, startY: 2.3, startZ: 0.1, endX: -0.84, endZ: 0.42, arcH: 0.35, rotY: 0.6 },
        { startX: 0.46, startY: 2.35, startZ: 0.1, endX: 0.88, endZ: 0.56, arcH: 0.42, rotY: -0.9 },
        { startX: -0.18, startY: 2.1, startZ: 0.32, endX: -0.52, endZ: 0.96, arcH: 0.28, rotY: 1.4 },
        { startX: 0.24, startY: 2.15, startZ: 0.28, endX: 0.64, endZ: 1.08, arcH: 0.31, rotY: -1.7 },
      ]
      for (let i = 0; i < tankDebrisConfigs.length; i += 1) {
        const frag = new THREE.Mesh(debrisGeo, i % 2 === 0 ? rustMat : bracketMat)
        tankDebrisGroup.add(frag)
        tankDebrisMeshes.push(frag)
      }
      tankMountGroup.add(tankDebrisGroup)

      // 5. Controlled directional water surge wave (sheet + leading wave crest + 8 bounded spray droplets)
      const surgeGroup = new THREE.Group()
      surgeGroup.name = 'hazard-water-tank-surge'
      surgeGroup.visible = false

      const surgeSheetGeo = getPooledGeometry(
        'water_tank:surgeSheet',
        () => new THREE.PlaneGeometry(1, 1)
      )
      const surgeSheetMesh = new THREE.Mesh(surgeSheetGeo, surgeMat)
      surgeSheetMesh.rotation.x = -Math.PI * 0.5
      surgeSheetMesh.position.set(0, 0.024, 0)
      surgeGroup.add(surgeSheetMesh)

      const crestGeo = getPooledGeometry(
        'water_tank:surgeCrest',
        () => new THREE.CylinderGeometry(0.14, 0.2, 1.0, 8, 1, false, 0, Math.PI)
      )
      const crestMesh = new THREE.Mesh(crestGeo, surgeMat)
      crestMesh.rotation.z = Math.PI * 0.5
      crestMesh.position.set(0, 0.09, 0.35)
      crestMesh.scale.set(1, surgeHalfWidth * 1.85, 1)
      surgeGroup.add(crestMesh)

      const sprayGeo = getPooledGeometry(
        'water_tank:sprayDrop',
        () => new THREE.SphereGeometry(0.068, 6, 5)
      )
      const sprayMeshes = []
      const sprayConfigs = []
      const MAX_SPRAY = 8
      for (let i = 0; i < MAX_SPRAY; i += 1) {
        const lane = -0.82 + (i / (MAX_SPRAY - 1)) * 1.64
        sprayConfigs.push({
          startX: lane * 0.4,
          endX: lane * surgeHalfWidth * 0.92,
          reachZ: 0.55 + ((i * 3 + 1) % MAX_SPRAY) / MAX_SPRAY * (surgeLength - 0.45),
          arcH: 0.24 + (i % 3) * 0.14,
          baseScale: 0.72 + (i % 3) * 0.22,
        })
        const sp = new THREE.Mesh(sprayGeo, leakMat)
        surgeGroup.add(sp)
        sprayMeshes.push(sp)
      }
      tankMountGroup.add(surgeGroup)

      // 6. Permanent flooded / wet reflective floor slick (single lightweight disc, zero overdraw spam)
      const puddleGeo = getPooledGeometry(
        'water_tank:puddleDisc',
        () => new THREE.CircleGeometry(1, 14)
      )
      const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat)
      puddleMesh.rotation.x = -Math.PI * 0.5
      puddleMesh.position.set(0, 0.012, 0.15)
      puddleMesh.visible = false
      tankMountGroup.add(puddleMesh)

      root.userData = {
        hazardType: type,
        mountType,
        wallSide,
        tankYaw,
        surgeLength,
        surgeHalfWidth,
        tankRestY,
        tankFallenY,
        ceilingAnchorY,
        strapRestY,
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
      const mountType = hazardData.mountType || 'ceiling_gantry_rail'
      const machineryYaw = Number.isFinite(hazardData.machineryYaw) ? hazardData.machineryYaw : 0
      const machineryRestY = Number.isFinite(hazardData.machineryRestY)
        ? hazardData.machineryRestY
        : 2.42
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : 3.58
      const pivotY = 3.22
      const restDropY = machineryRestY - pivotY // -0.80
      const fallenY = 0.4
      const impactLocalZ = 0.72

      const machineryMountGroup = new THREE.Group()
      machineryMountGroup.name = `hazard-suspended-machinery-${mountType}`
      machineryMountGroup.rotation.y = machineryYaw
      root.add(machineryMountGroup)

      const gantryMat = getPooledMaterial(
        'suspended_machinery:gantry',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryGantry,
            roughness: 0.68,
            metalness: 0.56,
          })
      )
      const housingMat = getPooledMaterial(
        'suspended_machinery:housing',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryHousing,
            roughness: 0.58,
            metalness: 0.64,
          })
      )
      const stripeMat = getPooledMaterial(
        'suspended_machinery:stripe',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryStripe,
            roughness: 0.72,
            metalness: 0.18,
          })
      )
      const chainMat = getPooledMaterial(
        'suspended_machinery:chain',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryChain,
            roughness: 0.46,
            metalness: 0.84,
          })
      )
      const rustMat = getPooledMaterial(
        'suspended_machinery:rust',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryRust,
            roughness: 0.9,
            metalness: 0.28,
          })
      )

      // Instance-owned impact dust material so each crash fades independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.machineryDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Structural Overhead Steel Gantry I-Beam & Ceiling/Wall Anchors (adapted from facility gantries)
      const gantryGroup = new THREE.Group()
      gantryGroup.name = 'hazard-machinery-gantry'

      const beamSpanX = mountType === 'wall_to_wall_gantry' ? CELL_SIZE - 0.08 : 2.35
      const flangeGeo = getPooledGeometry(
        mountType === 'wall_to_wall_gantry'
          ? 'suspended_machinery:flangeWall'
          : 'suspended_machinery:flangeCeil',
        () => new THREE.BoxGeometry(beamSpanX, 0.055, 0.26)
      )
      const webGeo = getPooledGeometry(
        mountType === 'wall_to_wall_gantry'
          ? 'suspended_machinery:webWall'
          : 'suspended_machinery:webCeil',
        () => new THREE.BoxGeometry(beamSpanX, 0.16, 0.075)
      )
      const topFlange = new THREE.Mesh(flangeGeo, gantryMat)
      topFlange.position.set(0, ceilingAnchorY - 0.03, 0)
      gantryGroup.add(topFlange)

      const beamWeb = new THREE.Mesh(webGeo, gantryMat)
      beamWeb.position.set(0, ceilingAnchorY - 0.135, 0)
      gantryGroup.add(beamWeb)

      const botFlange = new THREE.Mesh(flangeGeo, gantryMat)
      botFlange.position.set(0, ceilingAnchorY - 0.24, 0)
      gantryGroup.add(botFlange)

      // Ceiling anchor plates bolted into soffit slab
      const anchorGeo = getPooledGeometry(
        'suspended_machinery:anchorPlate',
        () => new THREE.BoxGeometry(0.28, 0.04, 0.36)
      )
      for (const ax of [-0.92, 0.92]) {
        const plate = new THREE.Mesh(anchorGeo, rustMat)
        plate.position.set(ax, ceilingAnchorY - 0.01, 0)
        gantryGroup.add(plate)
      }

      // Flanking wall corbel brackets when spanning wall-to-wall
      let wallBracketsGroup = null
      if (mountType === 'wall_to_wall_gantry') {
        wallBracketsGroup = new THREE.Group()
        wallBracketsGroup.name = 'hazard-machinery-wall-brackets'
        const corbelGeo = getPooledGeometry(
          'suspended_machinery:wallCorbel',
          () => new THREE.BoxGeometry(0.14, 0.34, 0.34)
        )
        const halfWallX = CELL_SIZE * 0.5 - 0.07
        for (const sx of [-halfWallX, halfWallX]) {
          const corbel = new THREE.Mesh(corbelGeo, rustMat)
          corbel.position.set(sx, ceilingAnchorY - 0.22, 0)
          wallBracketsGroup.add(corbel)
        }
        gantryGroup.add(wallBracketsGroup)
      }

      // Wheeled hoist trolley carriage gripping lower I-beam flange
      const trolleyGroup = new THREE.Group()
      trolleyGroup.name = 'hazard-machinery-trolley'
      trolleyGroup.position.set(0, pivotY, 0)
      const trolleyBodyGeo = getPooledGeometry(
        'suspended_machinery:trolleyBody',
        () => new THREE.BoxGeometry(0.58, 0.16, 0.38)
      )
      const trolleyBody = new THREE.Mesh(trolleyBodyGeo, gantryMat)
      trolleyBody.position.set(0, 0.06, 0)
      trolleyGroup.add(trolleyBody)

      const pulleyGeo = getPooledGeometry(
        'suspended_machinery:pulley',
        () => new THREE.CylinderGeometry(0.085, 0.085, 0.08, 8)
      )
      for (const pz of [-0.14, 0.14]) {
        const pulley = new THREE.Mesh(pulleyGeo, chainMat)
        pulley.rotation.z = Math.PI * 0.5
        pulley.position.set(0, -0.02, pz)
        trolleyGroup.add(pulley)
      }
      gantryGroup.add(trolleyGroup)

      // Overhead snapped cable stubs anchored to trolley (visible & bent after drop)
      const cableGeo = getPooledGeometry(
        'suspended_machinery:hoistCable',
        () => new THREE.CylinderGeometry(0.018, 0.018, 0.72, 6)
      )
      const rearCable = new THREE.Mesh(cableGeo, chainMat)
      rearCable.position.set(0, pivotY - 0.36, -0.24)
      gantryGroup.add(rearCable)

      const frontCable = new THREE.Mesh(cableGeo, chainMat)
      frontCable.position.set(0, pivotY - 0.36, 0.24)
      gantryGroup.add(frontCable)

      machineryMountGroup.add(gantryGroup)

      // 2. Heavy Suspended Industrial Motor / Winch Machinery Unit (composite multi-part silhouette)
      const machinePivotGroup = new THREE.Group()
      machinePivotGroup.name = 'hazard-machinery-pivot'
      machinePivotGroup.position.set(0, pivotY, 0)

      const machineBodyGroup = new THREE.Group()
      machineBodyGroup.name = 'hazard-machinery-unit'
      machineBodyGroup.position.set(0, restDropY, 0)

      // Primary ribbed cast-iron motor chassis
      const chassisGeo = getPooledGeometry(
        'suspended_machinery:chassis',
        () => new THREE.BoxGeometry(0.92, 0.52, 0.76)
      )
      const chassisMesh = new THREE.Mesh(chassisGeo, housingMat)
      machineBodyGroup.add(chassisMesh)

      // Cylindrical industrial motor/winch drum
      const drumGeo = getPooledGeometry(
        'suspended_machinery:drum',
        () => new THREE.CylinderGeometry(0.24, 0.24, 1.06, 10)
      )
      const drumMesh = new THREE.Mesh(drumGeo, gantryMat)
      drumMesh.rotation.z = Math.PI * 0.5
      drumMesh.position.set(0, 0.04, 0.06)
      machineBodyGroup.add(drumMesh)

      // Side gearbox casing & rusted mounting flange
      const gearboxGeo = getPooledGeometry(
        'suspended_machinery:gearbox',
        () => new THREE.BoxGeometry(0.24, 0.42, 0.48)
      )
      const gearboxMesh = new THREE.Mesh(gearboxGeo, rustMat)
      gearboxMesh.position.set(-0.52, -0.02, -0.04)
      machineBodyGroup.add(gearboxMesh)

      // Weathered caution-ochre underside skid bumper (visually signals heavy falling load)
      const bumperGeo = getPooledGeometry(
        'suspended_machinery:bumper',
        () => new THREE.BoxGeometry(0.98, 0.09, 0.82)
      )
      const bumperMesh = new THREE.Mesh(bumperGeo, stripeMat)
      bumperMesh.position.set(0, -0.28, 0)
      machineBodyGroup.add(bumperMesh)

      // Top lifting shackle eyes & hoist crossbar
      const shackleGeo = getPooledGeometry(
        'suspended_machinery:shackle',
        () => new THREE.TorusGeometry(0.065, 0.018, 6, 10)
      )
      for (const sz of [-0.24, 0.24]) {
        const shackle = new THREE.Mesh(shackleGeo, chainMat)
        shackle.position.set(0, 0.3, sz)
        machineBodyGroup.add(shackle)
      }

      machinePivotGroup.add(machineBodyGroup)
      machineryMountGroup.add(machinePivotGroup)

      // 3. Bounded Warning Loose Bolts & Metal Shavings (6 falling particles)
      const warnBoltGroup = new THREE.Group()
      warnBoltGroup.name = 'hazard-machinery-warning-bolts'
      warnBoltGroup.visible = false
      const boltFragGeo = getPooledGeometry(
        'suspended_machinery:warnBolt',
        () => new THREE.CylinderGeometry(0.024, 0.024, 0.07, 6)
      )
      const warnBoltMeshes = []
      const warnBoltConfigs = []
      const MAX_WARN_BOLTS = 6
      for (let i = 0; i < MAX_WARN_BOLTS; i += 1) {
        warnBoltConfigs.push({
          x: -0.36 + i * 0.145,
          z: -0.18 + (i % 3) * 0.22,
          startY: pivotY - 0.08 - (i % 2) * 0.35,
          phase: (i * 0.31) % 1,
          speed: 1.45 + (i % 3) * 0.32,
        })
        const bolt = new THREE.Mesh(boltFragGeo, i % 2 === 0 ? rustMat : chainMat)
        warnBoltGroup.add(bolt)
        warnBoltMeshes.push(bolt)
      }
      machineryMountGroup.add(warnBoltGroup)

      // 4. Bounded Impact Metal Debris (6 sheared plates/gears settling around impactLocalZ)
      const impactDebrisGroup = new THREE.Group()
      impactDebrisGroup.name = 'hazard-machinery-debris'
      impactDebrisGroup.visible = false
      const impactFragGeo = getPooledGeometry(
        'suspended_machinery:impactFrag',
        () => new THREE.BoxGeometry(0.18, 0.055, 0.12)
      )
      const impactDebrisMeshes = []
      const impactDebrisConfigs = []
      const MAX_IMPACT_DEBRIS = 6
      for (let i = 0; i < MAX_IMPACT_DEBRIS; i += 1) {
        const angle = (i / MAX_IMPACT_DEBRIS) * Math.PI * 2 + 0.35
        const dist = 0.56 + (i % 3) * 0.24
        impactDebrisConfigs.push({
          startX: (i % 2 === 0 ? -0.25 : 0.25),
          startY: 1.2 + (i % 2) * 0.6,
          startZ: 0.25,
          endX: Math.cos(angle) * dist,
          endZ: impactLocalZ + Math.sin(angle) * (dist * 0.85),
          arcH: 0.26 + (i % 3) * 0.12,
          rotY: angle + 0.6,
        })
        const frag = new THREE.Mesh(impactFragGeo, i % 3 === 0 ? stripeMat : i % 2 === 0 ? rustMat : housingMat)
        impactDebrisGroup.add(frag)
        impactDebrisMeshes.push(frag)
      }
      machineryMountGroup.add(impactDebrisGroup)

      // 5. Bounded Impact Dust Cloud (6 translucent spheres billowing around crash zone)
      const impactDustGroup = new THREE.Group()
      impactDustGroup.name = 'hazard-machinery-dust'
      impactDustGroup.visible = false
      const machDustGeo = getPooledGeometry(
        'suspended_machinery:dust',
        () => new THREE.SphereGeometry(0.26, 7, 6)
      )
      const impactDustMeshes = []
      const impactDustConfigs = []
      const MAX_MACH_DUST = 6
      for (let i = 0; i < MAX_MACH_DUST; i += 1) {
        const angle = (i / MAX_MACH_DUST) * Math.PI * 2
        impactDustConfigs.push({
          dx: Math.cos(angle) * (0.45 + (i % 2) * 0.32),
          dz: impactLocalZ + Math.sin(angle) * (0.45 + (i % 2) * 0.28),
          riseY: 0.42 + (i % 3) * 0.22,
          baseScale: 0.72 + (i % 3) * 0.22,
        })
        const puff = new THREE.Mesh(machDustGeo, dustMat)
        impactDustGroup.add(puff)
        impactDustMeshes.push(puff)
      }
      machineryMountGroup.add(impactDustGroup)

      root.userData = {
        hazardType: type,
        mountType,
        machineryYaw,
        machineryRestY,
        ceilingAnchorY,
        pivotY,
        restDropY,
        fallenY,
        impactLocalZ,
        machineryMountGroup,
        gantryGroup,
        wallBracketsGroup,
        trolleyGroup,
        rearCable,
        frontCable,
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
      const mountType = hazardData.mountType || 'ceiling_duct_run'
      const ductYaw = Number.isFinite(hazardData.ductYaw) ? hazardData.ductYaw : 0
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : 3.58
      const ductRestY = Number.isFinite(hazardData.ductRestY)
        ? hazardData.ductRestY
        : 3.18
      const ductWidth = 0.72
      const ductHeight = 0.4
      const ductLen = 2.08
      const pivotZ = -0.98
      const bodyOffsetZ = 0.98
      const fallenY = 0.22
      const impactLocalZ = 0.56

      const ductMountGroup = new THREE.Group()
      ductMountGroup.name = 'ventilation-duct-mount'
      ductMountGroup.rotation.y = ductYaw
      root.add(ductMountGroup)

      // Reuse facility galvanized zinc-steel textures & palette from buildCeilingVents.js
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

      // 1. Fixed overhead plenum connector stubs & soffit anchor rig
      const ceilingRigGroup = new THREE.Group()
      ceilingRigGroup.name = 'duct-ceiling-rig'

      const stubGeo = getPooledGeometry(
        'duct:stub',
        () => new THREE.BoxGeometry(ductWidth, ductHeight, 0.54)
      )
      const flangeGeo = getPooledGeometry(
        'duct:flange',
        () => new THREE.BoxGeometry(ductWidth + 0.08, ductHeight + 0.08, 0.06)
      )
      const throatGeo = getPooledGeometry(
        'duct:throat',
        () => new THREE.BoxGeometry(ductWidth - 0.08, ductHeight - 0.08, 0.03)
      )
      const soffitPlateGeo = getPooledGeometry(
        'duct:soffit-plate',
        () => new THREE.BoxGeometry(0.11, 0.024, 0.11)
      )
      const rodHeight = Math.max(0.18, ceilingAnchorY - (ductRestY - ductHeight * 0.5 - 0.03))
      const rodGeo = getPooledGeometry(
        'duct:hanger-rod',
        () => new THREE.CylinderGeometry(0.014, 0.014, 0.64, 6)
      )
      const cradleGeo = getPooledGeometry(
        'duct:trapeze-cradle',
        () => new THREE.BoxGeometry(ductWidth + 0.18, 0.036, 0.065)
      )

      // Rear fixed plenum stub + dark open throat + drive-cleat flange
      const rearStub = new THREE.Mesh(stubGeo, galvMat)
      rearStub.position.set(0, ductRestY, -1.32)
      ceilingRigGroup.add(rearStub)

      const rearFlange = new THREE.Mesh(flangeGeo, hardwareMat)
      rearFlange.position.set(0, ductRestY, -1.04)
      ceilingRigGroup.add(rearFlange)

      const rearThroat = new THREE.Mesh(throatGeo, cavityMat)
      rearThroat.position.set(0, ductRestY, -1.035)
      ceilingRigGroup.add(rearThroat)

      // Front fixed plenum stub + dark open throat + drive-cleat flange
      const frontStub = new THREE.Mesh(stubGeo, galvMat)
      frontStub.position.set(0, ductRestY, 1.36)
      ceilingRigGroup.add(frontStub)

      const frontFlange = new THREE.Mesh(flangeGeo, hardwareMat)
      frontFlange.position.set(0, ductRestY, 1.09)
      ceilingRigGroup.add(frontFlange)

      const frontThroat = new THREE.Mesh(throatGeo, cavityMat)
      frontThroat.position.set(0, ductRestY, 1.085)
      ceilingRigGroup.add(frontThroat)

      // Optional rear wall bulkhead collar when backed by a maze wall
      let wallBulkheadGroup = null
      if (mountType === 'wall_bulkhead_duct') {
        wallBulkheadGroup = new THREE.Group()
        wallBulkheadGroup.name = 'duct-wall-bulkhead'
        const bulkheadCollarGeo = getPooledGeometry(
          'duct:bulkhead-collar',
          () => new THREE.BoxGeometry(ductWidth + 0.22, ductHeight + 0.22, 0.14)
        )
        const collar = new THREE.Mesh(bulkheadCollarGeo, hardwareMat)
        collar.position.set(0, ductRestY, -1.9)
        wallBulkheadGroup.add(collar)

        const connectorGeo = getPooledGeometry(
          'duct:bulkhead-connector',
          () => new THREE.BoxGeometry(ductWidth, ductHeight, 0.36)
        )
        const connector = new THREE.Mesh(connectorGeo, galvMat)
        connector.position.set(0, ductRestY, -1.72)
        wallBulkheadGroup.add(connector)

        ceilingRigGroup.add(wallBulkheadGroup)
      }

      // Soffit anchor plates for rear (-0.82) & front (+0.82) trapeze hangers
      const hangerHalfX = ductWidth * 0.5 + 0.055
      const hangerZs = [-0.82, 0.82]
      for (let hz = 0; hz < hangerZs.length; hz += 1) {
        const zPos = hangerZs[hz]
        for (const side of [-1, 1]) {
          const plate = new THREE.Mesh(soffitPlateGeo, hardwareMat)
          plate.position.set(side * hangerHalfX, ceilingAnchorY - 0.012, zPos)
          ceilingRigGroup.add(plate)
        }
      }

      // Rear trapeze hanger (remains mostly anchored overhead)
      const rearHangerGroup = new THREE.Group()
      rearHangerGroup.name = 'duct-rear-hanger'
      rearHangerGroup.position.set(0, ceilingAnchorY, -0.82)
      const rodScaleY = rodHeight / 0.64
      for (const side of [-1, 1]) {
        const rod = new THREE.Mesh(rodGeo, hardwareMat)
        rod.scale.set(1, rodScaleY, 1)
        rod.position.set(side * hangerHalfX, -rodHeight * 0.5, 0)
        rearHangerGroup.add(rod)
      }
      const rearCradle = new THREE.Mesh(cradleGeo, hardwareMat)
      rearCradle.position.set(0, -rodHeight, 0)
      rearHangerGroup.add(rearCradle)
      ceilingRigGroup.add(rearHangerGroup)

      // Front trapeze hanger (corroded — loosens during warning and snaps loose on collapse)
      const frontHangerGroup = new THREE.Group()
      frontHangerGroup.name = 'duct-front-hanger'
      frontHangerGroup.position.set(0, ceilingAnchorY, 0.82)
      for (const side of [-1, 1]) {
        const rod = new THREE.Mesh(rodGeo, side > 0 ? ductRustMat : hardwareMat)
        rod.scale.set(1, rodScaleY, 1)
        rod.position.set(side * hangerHalfX, -rodHeight * 0.5, 0)
        frontHangerGroup.add(rod)
      }
      const frontCradle = new THREE.Mesh(cradleGeo, ductRustMat)
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
      ductBodyGroup.position.set(0, 0, bodyOffsetZ)

      const mainDuctGeo = getPooledGeometry(
        'duct:main-section',
        () => new THREE.BoxGeometry(ductWidth, ductHeight, ductLen)
      )
      const mainDuct = new THREE.Mesh(mainDuctGeo, galvMat)
      ductBodyGroup.add(mainDuct)

      // End & center standing-seam drive-cleat flange collars
      for (const fz of [-ductLen * 0.5 + 0.04, 0, ductLen * 0.5 - 0.04]) {
        const fMesh = new THREE.Mesh(flangeGeo, fz > 0 ? ductRustMat : hardwareMat)
        fMesh.position.set(0, 0, fz)
        ductBodyGroup.add(fMesh)
      }

      // Dark hollow duct end-caps so detached section reads as a hollow ventilation trunk
      for (const ez of [-ductLen * 0.5 - 0.004, ductLen * 0.5 + 0.004]) {
        const endVoid = new THREE.Mesh(throatGeo, cavityMat)
        endVoid.position.set(0, 0, ez)
        ductBodyGroup.add(endVoid)
      }

      // Corroded stress seam patch near front joint
      const rustSeamGeo = getPooledGeometry(
        'duct:rust-seam',
        () => new THREE.BoxGeometry(ductWidth + 0.02, ductHeight + 0.02, 0.24)
      )
      const rustSeam = new THREE.Mesh(rustSeamGeo, ductRustMat)
      rustSeam.position.set(0, 0, 0.72)
      ductBodyGroup.add(rustSeam)

      // Bottom recessed industrial intake grille with dark soot cavity + louver slats
      const grilleFrameGeo = getPooledGeometry(
        'duct:grille-frame',
        () => new THREE.BoxGeometry(0.52, 0.03, 0.68)
      )
      const grilleFrame = new THREE.Mesh(grilleFrameGeo, hardwareMat)
      grilleFrame.position.set(0, -ductHeight * 0.5 - 0.01, 0.14)
      ductBodyGroup.add(grilleFrame)

      const grilleBackGeo = getPooledGeometry(
        'duct:grille-back',
        () => new THREE.BoxGeometry(0.44, 0.02, 0.58)
      )
      const grilleBack = new THREE.Mesh(grilleBackGeo, cavityMat)
      grilleBack.position.set(0, -ductHeight * 0.5 - 0.018, 0.14)
      ductBodyGroup.add(grilleBack)

      const louverGeo = getPooledGeometry(
        'duct:grille-louver',
        () => new THREE.BoxGeometry(0.42, 0.012, 0.028)
      )
      for (let lv = 0; lv < 5; lv += 1) {
        const slat = new THREE.Mesh(louverGeo, hardwareMat)
        slat.position.set(0, -ductHeight * 0.5 - 0.026, -0.08 + lv * 0.11)
        slat.rotation.x = 0.42
        ductBodyGroup.add(slat)
      }

      ductPivotGroup.add(ductBodyGroup)
      ductMountGroup.add(ductPivotGroup)

      // 3. Warning loose sheet-metal screws/rivets (6 bounded)
      const warnScrewGroup = new THREE.Group()
      warnScrewGroup.name = 'duct-warning-screws'
      warnScrewGroup.visible = false
      const screwGeo = getPooledGeometry(
        'duct:warn-screw',
        () => new THREE.CylinderGeometry(0.016, 0.016, 0.055, 5)
      )
      const warnScrewMeshes = []
      const warnScrewConfigs = []
      for (let i = 0; i < 6; i += 1) {
        warnScrewConfigs.push({
          x: (i % 2 === 0 ? -1 : 1) * (0.28 + (i % 3) * 0.06),
          z: 0.42 + (i % 3) * 0.28 - 0.14,
          startY: ductRestY - 0.16,
          speed: 1.55 + (i % 3) * 0.3,
          phase: i * 0.16,
        })
        const screw = new THREE.Mesh(screwGeo, i % 2 === 0 ? hardwareMat : ductRustMat)
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
      const ductDustGeo = getPooledGeometry(
        'duct:dust-puff',
        () => new THREE.SphereGeometry(0.19, 6, 5)
      )
      const warnDustMeshes = []
      const warnDustConfigs = []
      for (let i = 0; i < 5; i += 1) {
        warnDustConfigs.push({
          x: ((i % 3) - 1) * 0.26,
          z: 0.25 + (i % 4) * 0.24,
          startY: ductRestY - 0.14,
          speed: 0.95 + (i % 3) * 0.22,
          phase: i * 0.2,
          baseScale: 0.52 + (i % 2) * 0.18,
        })
        const puff = new THREE.Mesh(ductDustGeo, warnDustMat)
        warnDustGroup.add(puff)
        warnDustMeshes.push(puff)
      }
      ductMountGroup.add(warnDustGroup)

      // 5. Impact sheared sheet-metal louvers & bracket shards (6 bounded)
      const ductDebrisGroup = new THREE.Group()
      ductDebrisGroup.name = 'duct-impact-debris'
      ductDebrisGroup.visible = false
      const shardGeo = getPooledGeometry(
        'duct:impact-shard',
        () => new THREE.BoxGeometry(0.22, 0.028, 0.14)
      )
      const ductDebrisMeshes = []
      const ductDebrisConfigs = []
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2 + 0.35
        const radius = 0.58 + (i % 3) * 0.2
        ductDebrisConfigs.push({
          startX: Math.cos(angle) * 0.22,
          startY: 0.38,
          startZ: impactLocalZ + Math.sin(angle) * 0.25,
          endX: Math.cos(angle) * radius,
          endZ: impactLocalZ + Math.sin(angle) * radius,
          arcH: 0.3 + (i % 3) * 0.14,
          rotY: angle * 1.4,
        })
        const shard = new THREE.Mesh(shardGeo, i % 2 === 0 ? galvMat : hardwareMat)
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
          dx: Math.cos(angle) * (0.48 + (i % 2) * 0.28),
          dz: impactLocalZ + Math.sin(angle) * (0.58 + (i % 2) * 0.32),
          riseY: 0.45 + (i % 3) * 0.22,
          baseScale: 0.78 + (i % 3) * 0.24,
        })
        const puff = new THREE.Mesh(ductDustGeo, ductImpactDustMat)
        ductImpactDustGroup.add(puff)
        ductImpactDustMeshes.push(puff)
      }
      ductMountGroup.add(ductImpactDustGroup)

      root.userData = {
        hazardType: type,
        mountType,
        ductYaw,
        ductRestY,
        ceilingAnchorY,
        pivotZ,
        bodyOffsetZ,
        fallenY,
        impactLocalZ,
        ductMountGroup,
        ceilingRigGroup,
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
        ceilingCrackMeshes,
        ceilingCrackConfigs,
        ceilingCavityGroup,
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
        if (ceilingCavityGroup) ceilingCavityGroup.visible = true
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
          if (isCleared) {
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
        if (ceilingCavityGroup) ceilingCavityGroup.visible = true
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
        // Subtle progressive crack widening, slight ceiling sag & restrained tremor
        const sagEase = clamped * clamped
        if (ceilingCavityGroup) ceilingCavityGroup.visible = clamped > 0.25
        if (ceilingCrackMeshes && ceilingCrackConfigs) {
          const widthGain = 1 + clamped * 0.65
          const lenGain = 1 + clamped * 0.1
          for (let i = 0; i < ceilingCrackMeshes.length; i += 1) {
            const cs = ceilingCrackConfigs[i]
            ceilingCrackMeshes[i].scale.set(cs.len * lenGain, 1, cs.w * widthGain)
          }
        }

        const tremorAmp = 0.004 + clamped * 0.006
        for (let i = 0; i < ceilingDebrisMeshes.length; i += 1) {
          const mesh = ceilingDebrisMeshes[i]
          const cfg = ceilingDebrisConfigs[i]
          const tremor =
            Math.sin(clamped * Math.PI * (14 + (i % 3) * 4) + i * 1.3) *
            tremorAmp *
            (1 - clamped * 0.55)
          const sagY = cfg.startY - cfg.maxSag * sagEase + tremor
          mesh.position.set(cfg.startX, Math.min(cfg.startY, sagY), cfg.startZ)
          mesh.rotation.set(
            tremor * 1.6,
            cfg.startRotY,
            -tremor * 1.4
          )
          mesh.scale.set(cfg.sx, cfg.sy, cfg.sz)
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

      // Dormant: flush concealed ceiling deterioration (nothing floating, zero dust/pebbles)
      if (ceilingCavityGroup) ceilingCavityGroup.visible = false
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
        mesh.position.set(cfg.startX, cfg.startY, cfg.startZ)
        mesh.rotation.set(0, cfg.startRotY, 0)
        mesh.scale.set(cfg.sx, cfg.sy, cfg.sz)
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
        pivotX = 0.46,
        pivotZ = -1.5,
        dormantPitch = 0.045,
        dormantRoll = -0.032,
        warnEndPitch = 0.135,
        warnEndRoll = -0.056,
        collapsedPitch = 1.495,
        collapsedRoll = -0.038,
      } = data
      if (!furnitureGroup) return

      const shelfPt = { x: 0, y: 0, z: 0 }

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

        const isCleared = Boolean(data.isAftermathCleared)
        const settledPitch = collapsedPitch
        const settledRoll = isCleared ? -0.015 : collapsedRoll
        const settledPivotY =
          0.44 * Math.abs(Math.sin(settledRoll)) +
          0.04 * Math.sin(Math.max(0, settledPitch)) +
          0.004
        const settledPivotZ = isCleared ? -1.78 : pivotZ
        const settledPivotX = isCleared
          ? clampCellLocalOffset(pivotX + (pivotX >= 0 ? 0.14 : -0.14), 0, 0.44)
          : pivotX

        furnitureGroup.position.set(settledPivotX, settledPivotY, settledPivotZ)
        furnitureGroup.rotation.set(settledPitch, isCleared ? 0.12 : 0, settledRoll)

        if (looseCargoMeshes && looseCargoConfigs) {
          for (let i = 0; i < looseCargoMeshes.length; i += 1) {
            const mesh = looseCargoMeshes[i]
            const cfg = looseCargoConfigs[i]
            const tx = isCleared ? cfg.clearedX : cfg.restX
            const tz = isCleared ? cfg.clearedZ : cfg.restZ
            const rx = cfg.restRotX
            const ry = isCleared ? cfg.restRotY * 0.4 : cfg.restRotY
            const rz = cfg.restRotZ
            const minGroundedY = computeMinGroundedCenterY(
              cfg.halfX,
              cfg.halfY,
              cfg.halfZ,
              rx,
              ry,
              rz
            )
            mesh.position.set(tx, Math.max(minGroundedY, cfg.restY), tz)
            mesh.rotation.set(rx, ry, rz)
          }
        }
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        if (furnitureWarnSplinterGroup) furnitureWarnSplinterGroup.visible = false

        // Continuous forward rotational acceleration from warnEndPitch -> collapsedPitch
        const tipNorm = Math.min(1, clamped / 0.66)
        const tipEase =
          tipNorm < 1
            ? tipNorm * tipNorm * (1.28 - 0.28 * tipNorm)
            : 1 - Math.sin(((clamped - 0.66) / 0.34) * Math.PI) * 0.014

        const pitch = warnEndPitch + (collapsedPitch - warnEndPitch) * tipEase
        const roll = warnEndRoll + (collapsedRoll - warnEndRoll) * Math.min(1, tipEase)
        const curPivotY =
          0.44 * Math.abs(Math.sin(roll)) +
          0.04 * Math.sin(Math.max(0, pitch)) +
          0.004

        furnitureGroup.position.set(pivotX, curPivotY, pivotZ)
        furnitureGroup.rotation.set(pitch, 0, roll)

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
            evalFurnitureShelfPoint(
              cfg.shelfX,
              cfg.shelfY,
              cfg.shelfZRel + 0.025,
              pitch,
              roll,
              pivotX,
              curPivotY,
              pivotZ,
              shelfPt
            )
            const slideSpan = Math.max(0.05, cfg.slideEnd - cfg.slideStart)
            const rawSlide = Math.max(0, Math.min(1, (clamped - cfg.slideStart) / slideSpan))
            const slideEase = rawSlide * rawSlide * (3 - 2 * rawSlide)

            const rx = pitch + (cfg.restRotX - pitch) * slideEase
            const ry = cfg.restRotY * slideEase
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
              clampCellLocalOffset(rawX, 0, cfg.halfX),
              Math.max(minGroundedY, rawY),
              clampCellLocalOffset(rawZ, 0, cfg.halfZ)
            )
            mesh.rotation.set(rx, ry, rz)
          }
        }

        if (furnitureDustGroup && furnitureDustMeshes && furnitureDustConfigs && furnitureDustMat) {
          furnitureDustGroup.visible = true
          const impactBurst =
            clamped < 0.55
              ? 0.14 + clamped * 0.25
              : Math.sin(((clamped - 0.55) / 0.45) * Math.PI) * 0.44
          furnitureDustMat.opacity = Math.max(0, Math.min(0.46, impactBurst))
          for (let i = 0; i < furnitureDustMeshes.length; i += 1) {
            const puff = furnitureDustMeshes[i]
            const cfg = furnitureDustConfigs[i]
            const spread = 0.2 + clamped * 1.15
            puff.position.set(
              clampCellLocalOffset(pivotX + cfg.dx * spread, 0, 0.24),
              0.12 + clamped * cfg.lift,
              clampCellLocalOffset(-0.88 + cfg.dz * spread, 0, 0.24)
            )
            puff.scale.setScalar(cfg.baseScale * (0.55 + clamped * 1.1))
          }
        }
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Monotonic structural creep from dormantPitch -> warnEndPitch + subtle zero-at-endpoints shudder
        const creep = clamped * clamped * (3 - 2 * clamped)
        const envelope = Math.sin(clamped * Math.PI)
        const shudderPitch = Math.sin(clamped * Math.PI * 14) * 0.008 * envelope
        const shudderRoll = Math.cos(clamped * Math.PI * 12) * 0.006 * envelope

        const pitch = dormantPitch + (warnEndPitch - dormantPitch) * creep + shudderPitch
        const roll = dormantRoll + (warnEndRoll - dormantRoll) * creep + shudderRoll
        const curPivotY =
          0.44 * Math.abs(Math.sin(roll)) +
          0.04 * Math.sin(Math.max(0, pitch)) +
          0.004

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
              0,
              roll
            )
            mesh.position.set(
              shelfPt.x,
              Math.max(minGroundedY, shelfPt.y),
              shelfPt.z
            )
            mesh.rotation.set(pitch, 0, roll)
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
              clampCellLocalOffset(pivotX + cfg.dx * spread, 0, 0.22),
              0.24 + (i % 2) * 0.35 - clamped * 0.14,
              clampCellLocalOffset(-1.58 + cfg.dz * spread, 0, 0.22)
            )
            puff.scale.setScalar(cfg.baseScale * (0.32 + clamped * 0.32))
          }
        }
        break
      }

      // Dormant state
      if (furnitureWarnSplinterGroup) furnitureWarnSplinterGroup.visible = false
      if (furnitureDustGroup) furnitureDustGroup.visible = false
      if (furnitureDustMat) furnitureDustMat.opacity = 0

      const dormantPivotY =
        0.44 * Math.abs(Math.sin(dormantRoll)) +
        0.04 * Math.sin(Math.max(0, dormantPitch)) +
        0.004
      furnitureGroup.position.set(pivotX, dormantPivotY, pivotZ)
      furnitureGroup.rotation.set(dormantPitch, 0, dormantRoll)

      if (strainedStrapMesh) {
        strainedStrapMesh.position.set(pivotX + 0.34, 1.295, -1.915)
        strainedStrapMesh.rotation.set(0, 0, 0)
        strainedStrapMesh.scale.set(1, 1, 1)
      }
      if (buckledLegMesh) {
        buckledLegMesh.rotation.set(0.12, 0, -0.18)
      }
      if (ajarDoorMesh) {
        ajarDoorMesh.rotation.y = -0.08
      }

      if (looseCargoMeshes && looseCargoConfigs) {
        for (let i = 0; i < looseCargoMeshes.length; i += 1) {
          const mesh = looseCargoMeshes[i]
          const cfg = looseCargoConfigs[i]
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
            0,
            dormantRoll
          )
          mesh.position.set(
            shelfPt.x,
            Math.max(minGroundedY, shelfPt.y),
            shelfPt.z
          )
          mesh.rotation.set(dormantPitch, 0, dormantRoll)
        }
      }
      break
    }

    case HAZARD_TYPES.FALLING_PIPES_FIXTURES: {
      const pipeGroup = data.pipeGroup
      if (!pipeGroup) return

      const pipeRestY = Number.isFinite(data.pipeRestY) ? data.pipeRestY : 3.12
      const overheadZ = Number.isFinite(data.overheadZ) ? data.overheadZ : -1.32
      const impactZ = Number.isFinite(data.impactZ) ? data.impactZ : -1.06
      const clearedZ = Number.isFinite(data.clearedZ) ? data.clearedZ : -1.68

      const leftStrainRod = data.leftStrainRod
      const rightStrainRod = data.rightStrainRod
      const warnFlakeGroup = data.pipeWarnFlakeGroup
      const warnFlakes = data.pipeWarnFlakes
      const warnFlakeConfigs = data.pipeWarnFlakeConfigs
      const dustGroup = data.pipeDustGroup
      const dustMeshes = data.pipeDustMeshes
      const dustConfigs = data.pipeDustConfigs
      const dustMat = data.pipeDustMat

      // Local half-extents of pipeGroup for exact floor-clearance bounding
      const halfX = 0.94
      const halfY = 0.155
      const halfZ = 0.165

      // End-of-warning pose (continuous handoff into active progress = 0)
      const warnEndY = pipeRestY - 0.065
      const warnEndZ = overheadZ + 0.025
      const warnEndRotX = 0.04
      const warnEndRotZ = -0.09

      // Grounded resting pose on corridor floor
      const restRotX = 0.24
      const restRotY = 0.045
      const restRotZ = -0.025
      const restMinY =
        computeMinGroundedCenterY(halfX, halfY, halfZ, restRotX, restRotY, restRotZ) + 0.018

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        if (warnFlakeGroup) warnFlakeGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (leftStrainRod) {
          leftStrainRod.position.set(-0.52, pipeRestY + 0.21, overheadZ + 0.03)
          leftStrainRod.rotation.set(0.28, 0, -0.36)
          leftStrainRod.scale.set(1, 0.58, 1)
        }
        if (rightStrainRod) {
          rightStrainRod.position.set(0.56, pipeRestY + 0.22, overheadZ + 0.04)
          rightStrainRod.rotation.set(0.34, 0, 0.42)
          rightStrainRod.scale.set(1, 0.52, 1)
        }

        if (data.isAftermathCleared) {
          const clearedRotX = -0.18
          const clearedRotY = 0.015
          const clearedRotZ = 0.01
          const clearedMinY =
            computeMinGroundedCenterY(
              halfX,
              halfY,
              halfZ,
              clearedRotX,
              clearedRotY,
              clearedRotZ
            ) + 0.018
          pipeGroup.position.set(0, clearedMinY, clearedZ)
          pipeGroup.rotation.set(clearedRotX, clearedRotY, clearedRotZ)
        } else {
          pipeGroup.position.set(0.02, restMinY, impactZ)
          pipeGroup.rotation.set(restRotX, restRotY, restRotZ)
        }
        break
      }

      if (state === 'active') {
        if (warnFlakeGroup) warnFlakeGroup.visible = false

        const p = Math.max(0, Math.min(1, progress))

        // Phase 1 (p in [0, 0.26]): right hanger shears first, pipe hinges downward on straining left hanger
        // Phase 2 (p in [0.26, 0.72]): left hanger shears, full pipe assembly falls under gravity to floor
        // Phase 3 (p in [0.72, 1.0]): damped metallic bounce & slight floor roll into rest pose
        const hingeEndX = -0.025
        const hingeEndY = warnEndY - 0.38
        const hingeEndZ = warnEndZ + 0.065
        const hingeEndRotX = warnEndRotX + 0.08
        const hingeEndRotY = 0.018
        const hingeEndRotZ = warnEndRotZ - 0.26

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
        } else if (p <= 0.72) {
          const t2 = (p - 0.26) / 0.46
          const grav = t2 * t2
          const smooth = t2 * t2 * (3 - 2 * t2)
          curX = hingeEndX + (0.02 - hingeEndX) * smooth
          curY = hingeEndY + (restMinY - hingeEndY) * grav
          curZ = hingeEndZ + (impactZ - hingeEndZ) * smooth
          curRotX = hingeEndRotX + (restRotX - hingeEndRotX) * smooth
          curRotY = hingeEndRotY + (restRotY - hingeEndRotY) * smooth
          curRotZ = hingeEndRotZ + (restRotZ - hingeEndRotZ) * smooth
        } else {
          const t3 = (p - 0.72) / 0.28
          const bounce = Math.sin(t3 * Math.PI) * (1 - t3) * 0.032
          const rollOsc = Math.sin(t3 * Math.PI * 2) * (1 - t3) * 0.035
          curX = 0.02
          curY = restMinY + bounce
          curZ = impactZ + rollOsc * 0.35
          curRotX = restRotX + rollOsc
          curRotY = restRotY
          curRotZ = restRotZ + bounce * 0.25
        }

        const minFloorY =
          computeMinGroundedCenterY(halfX, halfY, halfZ, curRotX, curRotY, curRotZ) + 0.016
        pipeGroup.position.set(curX, Math.max(minFloorY, curY), curZ)
        pipeGroup.rotation.set(curRotX, curRotY, curRotZ)

        // Animate straining & snapping clevis hanger rods overhead
        if (rightStrainRod) {
          const rSnap = Math.min(1, p / 0.14)
          rightStrainRod.position.set(
            0.54 + 0.02 * rSnap,
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
              -0.54,
              pipeRestY + 0.148 - 0.04 * lStrain,
              overheadZ + 0.008 + 0.015 * lStrain
            )
            leftStrainRod.rotation.set(0.04 + 0.1 * lStrain, 0, -0.06 - 0.22 * lStrain)
            leftStrainRod.scale.set(1, 1.04 + 0.18 * lStrain, 1)
          } else {
            const lSnap = Math.min(1, (p - 0.26) / 0.16)
            leftStrainRod.position.set(
              -0.54 + 0.02 * lSnap,
              pipeRestY + 0.108 + 0.102 * lSnap,
              overheadZ + 0.023 + 0.007 * lSnap
            )
            leftStrainRod.rotation.set(0.14 + 0.14 * lSnap, 0, -0.28 - 0.08 * lSnap)
            leftStrainRod.scale.set(1, 1.22 - 0.64 * lSnap, 1)
          }
        }

        // Restrained impact dust plume when pipe slams onto floor (p >= 0.62)
        if (dustGroup && dustMeshes && dustConfigs && dustMat) {
          if (p >= 0.62) {
            const dp = Math.min(1, (p - 0.62) / 0.38)
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
        const vibX = Math.sin(clamped * Math.PI * 26) * 0.015 * shudderEnv
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
            0.54 + vibX * 0.3,
            pipeRestY + 0.16 - sagEase * 0.045,
            overheadZ + sagEase * 0.015
          )
          rightStrainRod.rotation.set(sagEase * 0.1, 0, -sagEase * 0.24)
          rightStrainRod.scale.set(1, 1 + sagEase * 0.15, 1)
        }
        if (leftStrainRod) {
          leftStrainRod.position.set(
            -0.54 + vibX * 0.2,
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

      // Dormant state: securely mounted to overhead ceiling risers & wall standoff brackets
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
        leftStrainRod.position.set(-0.54, pipeRestY + 0.16, overheadZ)
        leftStrainRod.rotation.set(0, 0, 0)
        leftStrainRod.scale.set(1, 1, 1)
      }
      if (rightStrainRod) {
        rightStrainRod.position.set(0.54, pipeRestY + 0.16, overheadZ)
        rightStrainRod.rotation.set(0, 0, 0)
        rightStrainRod.scale.set(1, 1, 1)
      }

      pipeGroup.position.set(0, pipeRestY, overheadZ)
      pipeGroup.rotation.set(0, 0, 0)
      break
    }

    case HAZARD_TYPES.STEAM_PIPE_BURST: {
      const group = data.steamGroup
      const cloud = data.steamCloud || group
      const pipe = data.steamPipe
      const mat = data.steamMat
      if (!group || !cloud || !mat) return

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        if (pipe) pipe.position.set(0, 0, 0)
        cloud.visible = true
        cloud.scale.setScalar(0.4)
        mat.opacity = 0.05
      } else if (state === 'active') {
        if (pipe) pipe.position.set(0, 0, 0)
        cloud.visible = true
        cloud.scale.setScalar(2.2)
        mat.opacity = 0.85
      } else if (state === 'warning') {
        const pulse = Math.sin(progress * Math.PI * 20) * 0.5 + 0.5
        if (pipe) {
          pipe.position.set(Math.sin(progress * Math.PI * 30) * 0.018, 0, 0)
        }
        cloud.visible = true
        cloud.scale.setScalar(0.8 + pulse * 0.4)
        mat.opacity = 0.3 + pulse * 0.3
      } else {
        if (pipe) pipe.position.set(0, 0, 0)
        cloud.visible = false
        cloud.scale.setScalar(0.1)
        mat.opacity = 0.0
      }
      break
    }

    case HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING: {
      const {
        cableGroup,
        cableRestY,
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

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        arcGroup.visible = false
        sparkGroup.visible = false
        if (glowMesh) glowMesh.visible = false
        arcMat.opacity = 0
        sparkMat.opacity = 0
        glowMat.opacity = 0
        tipMat.color.setHex(HAZARD_PALETTE.wiringCharred)
        tipMat.emissive.setHex(0x000000)
        tipMat.emissiveIntensity = 0
        if (cableGroup) {
          cableGroup.position.y = (cableRestY ?? 1.84) - 0.06
          cableGroup.rotation.z = 0
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const crackle = Math.abs(Math.sin(clamped * Math.PI * 34))
        arcGroup.visible = true
        sparkGroup.visible = true
        if (glowMesh) {
          glowMesh.visible = true
          const glowScale = 0.95 + crackle * 0.45
          glowMesh.scale.setScalar(glowScale)
        }

        arcMat.color.setHex(HAZARD_PALETTE.wiringArcActive)
        arcMat.opacity = 0.8 + crackle * 0.2
        sparkMat.color.setHex(HAZARD_PALETTE.wiringSparkActive)
        sparkMat.opacity = 0.92
        glowMat.color.setHex(HAZARD_PALETTE.wiringArcActive)
        glowMat.opacity = 0.48 + crackle * 0.28

        tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
        tipMat.emissive.setHex(HAZARD_PALETTE.wiringArcActive)
        tipMat.emissiveIntensity = 2.6 + crackle * 1.1

        if (arcBolts) {
          for (let b = 0; b < arcBolts.length; b += 1) {
            const bolt = arcBolts[b]
            const jitter = Math.sin(clamped * Math.PI * (28 + b * 11) + b * 2.1)
            bolt.rotation.y = b * 2.1 + jitter * 0.85
            bolt.rotation.x = Math.cos(clamped * Math.PI * (22 + b * 7)) * 0.45
            const s = 0.85 + Math.abs(jitter) * 0.5
            bolt.scale.set(1, s, 1)
          }
        }

        if (sparkMeshes && sparkConfigs) {
          for (let i = 0; i < sparkMeshes.length; i += 1) {
            const cfg = sparkConfigs[i]
            const t = (clamped * cfg.speed * 1.45 + cfg.phase) % 1
            const spark = sparkMeshes[i]
            spark.position.set(
              cfg.dx * t * 1.25,
              cfg.dy * t - 0.65 * t * t,
              cfg.dz * t * 1.25
            )
            const s = Math.max(0.2, 1.15 - t * 0.9)
            spark.scale.setScalar(s)
          }
        }

        if (cableGroup) {
          cableGroup.position.y = cableRestY ?? 1.84
          cableGroup.rotation.z = Math.sin(clamped * Math.PI * 36) * 0.045
        }
        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const intensity = 0.35 + clamped * 0.65
        const flicker = Math.sin(clamped * Math.PI * 26) * Math.cos(clamped * Math.PI * 11)
        const preArcFlash = clamped > 0.5 && flicker > 0.3

        arcGroup.visible = preArcFlash
        arcMat.color.setHex(HAZARD_PALETTE.wiringSparkWarning)
        arcMat.opacity = preArcFlash ? 0.55 + clamped * 0.3 : 0

        sparkGroup.visible = true
        sparkMat.color.setHex(HAZARD_PALETTE.wiringSparkWarning)
        sparkMat.opacity = 0.45 + intensity * 0.45

        if (glowMesh) {
          glowMesh.visible = true
          glowMesh.scale.setScalar(0.5 + intensity * 0.35 + Math.abs(flicker) * 0.15)
        }
        glowMat.color.setHex(HAZARD_PALETTE.wiringSparkWarning)
        glowMat.opacity = 0.12 + intensity * 0.22 * (0.5 + Math.abs(flicker) * 0.5)

        tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
        tipMat.emissive.setHex(HAZARD_PALETTE.wiringSparkWarning)
        tipMat.emissiveIntensity = 0.7 + intensity * 1.8 * (0.45 + Math.abs(flicker) * 0.55)

        if (sparkMeshes && sparkConfigs) {
          for (let i = 0; i < sparkMeshes.length; i += 1) {
            const cfg = sparkConfigs[i]
            const t = (clamped * cfg.speed + cfg.phase) % 1
            const spark = sparkMeshes[i]
            const spread = 0.45 + clamped * 0.45
            spark.position.set(
              cfg.dx * t * spread,
              cfg.dy * t * 0.75 - 0.55 * t * t,
              cfg.dz * t * spread
            )
            const s = Math.max(0.18, (0.75 + clamped * 0.35) * (1 - t * 0.85))
            spark.scale.setScalar(s)
          }
        }

        if (cableGroup) {
          cableGroup.position.y = cableRestY ?? 1.84
          cableGroup.rotation.z = Math.sin(clamped * Math.PI * 30) * 0.028 * intensity
        }
        data._visualStateKey = 'warning'
        break
      }

      // Dormant state
      if (data._visualStateKey === 'dormant') break
      arcGroup.visible = false
      sparkGroup.visible = false
      if (glowMesh) glowMesh.visible = false
      arcMat.opacity = 0
      sparkMat.opacity = 0
      glowMat.opacity = 0
      tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
      tipMat.emissive.setHex(HAZARD_PALETTE.wiringSparkWarning)
      tipMat.emissiveIntensity = 0.18
      if (cableGroup) {
        cableGroup.position.y = cableRestY ?? 1.84
        cableGroup.rotation.z = 0
      }
      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.COLLAPSING_FLOOR_GRATE: {
      const {
        grateRestY = 0.015,
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
      } = data
      if (!leftLeafGroup || !rightLeafGroup) return

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        leftLeafGroup.rotation.z = -1.34
        rightLeafGroup.rotation.z = 1.28
        leftLeafGroup.position.y = grateRestY - 0.34
        rightLeafGroup.position.y = grateRestY - 0.34

        if (brokenStubsGroup) brokenStubsGroup.visible = true
        if (warningFragGroup) warningFragGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (debrisGroup && debrisMeshes && debrisConfigs) {
          debrisGroup.visible = true
          for (let i = 0; i < debrisMeshes.length; i += 1) {
            const cfg = debrisConfigs[i]
            const shard = debrisMeshes[i]
            shard.position.set(cfg.endX, 0.016, cfg.endZ)
            shard.rotation.set(0.12, cfg.rotY, 0.08)
          }
        }
        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            bolt.position.set(bp.sx, 0.012, bp.sz)
            bolt.rotation.z = i % 2 === 0 ? 1.35 : -1.25
          }
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const ease = clamped * clamped
        leftLeafGroup.rotation.z = -0.18 - ease * 1.16
        rightLeafGroup.rotation.z = 0.18 + ease * 1.1
        leftLeafGroup.position.y = grateRestY - ease * 0.34
        rightLeafGroup.position.y = grateRestY - ease * 0.34

        if (brokenStubsGroup) brokenStubsGroup.visible = true
        if (warningFragGroup) warningFragGroup.visible = false

        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            const jump = Math.sin(clamped * Math.PI) * 0.14
            bolt.position.set(
              bp.x + (bp.sx - bp.x) * clamped,
              0.012 + jump,
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
            const arcY = Math.sin(clamped * Math.PI) * cfg.arcH
            shard.position.set(
              cfg.startX + (cfg.endX - cfg.startX) * clamped,
              0.016 + arcY,
              cfg.startZ + (cfg.endZ - cfg.startZ) * clamped
            )
            shard.rotation.set(clamped * 2.4, cfg.rotY, clamped * 1.8)
          }
        }

        if (dustGroup && dustMeshes && dustConfigs && dustMat) {
          dustGroup.visible = true
          dustMat.opacity = Math.max(0, Math.sin(clamped * Math.PI) * 0.42)
          for (let i = 0; i < dustMeshes.length; i += 1) {
            const cfg = dustConfigs[i]
            const puff = dustMeshes[i]
            puff.position.set(
              cfg.dx * (0.25 + clamped * 0.85),
              0.08 + cfg.riseY * clamped,
              cfg.dz * (0.25 + clamped * 0.85)
            )
            puff.scale.setScalar(cfg.baseScale * (0.55 + clamped * 1.15))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const vib = Math.sin(clamped * Math.PI * 28) * (0.006 + clamped * 0.012)
        const bend = 0.018 + clamped * 0.16

        leftLeafGroup.rotation.z = -bend + vib
        rightLeafGroup.rotation.z = bend - vib
        leftLeafGroup.position.y = grateRestY - clamped * 0.012 + Math.abs(vib) * 0.25
        rightLeafGroup.position.y = grateRestY - clamped * 0.012 - Math.abs(vib) * 0.2

        if (brokenStubsGroup) brokenStubsGroup.visible = false
        if (debrisGroup) debrisGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            const rattle = Math.abs(Math.sin(clamped * Math.PI * (22 + i * 5))) * 0.012
            bolt.position.set(bp.x, bp.y + clamped * 0.022 + rattle, bp.z)
            bolt.rotation.z = Math.sin(clamped * Math.PI * 18 + i) * 0.18 * clamped
          }
        }

        if (warningFragGroup && warningFragments && warningFragConfigs) {
          warningFragGroup.visible = true
          for (let i = 0; i < warningFragments.length; i += 1) {
            const cfg = warningFragConfigs[i]
            const chip = warningFragments[i]
            const t = (clamped * cfg.speed + cfg.phase) % 1
            chip.position.set(
              cfg.x + Math.sin(t * Math.PI * 3 + i) * 0.04,
              0.025 - t * 0.08,
              cfg.z
            )
            chip.rotation.set(t * 3.1, i * 0.8, t * 2.4)
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — flush floor-integrated corroded grate with subtle pre-stress sag
      leftLeafGroup.rotation.z = -0.015
      rightLeafGroup.rotation.z = 0.015
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
        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          slab.position.set(sc.endX, sc.endY, sc.endZ)
          slab.rotation.set(sc.endRx, sc.endRy, sc.endRz)
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
            block.position.set(rc.endX, rc.endY, rc.endZ)
            block.rotation.set(0.24, rc.rotY, 0.15)
          }
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const ease = clamped * clamped

        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          const startZ = sc.restZ + sc.bulgeZ
          slab.position.set(
            sc.restX + (sc.endX - sc.restX) * clamped,
            sc.restY + (sc.endY - sc.restY) * ease,
            startZ + (sc.endZ - startZ) * clamped
          )
          slab.rotation.set(
            sc.endRx * clamped,
            sc.endRy * clamped,
            sc.endRz * clamped
          )
        }

        if (crackGroup) crackGroup.visible = false
        if (warningGroup) warningGroup.visible = false

        if (wallRubbleGroup && wallRubbleMeshes && wallRubbleConfigs) {
          wallRubbleGroup.visible = true
          for (let i = 0; i < wallRubbleMeshes.length; i += 1) {
            const rc = wallRubbleConfigs[i]
            const block = wallRubbleMeshes[i]
            const arcY = Math.sin(clamped * Math.PI) * rc.arcH
            block.position.set(
              rc.startX + (rc.endX - rc.startX) * clamped,
              rc.startY + (rc.endY - rc.startY) * ease + arcY,
              rc.startZ + (rc.endZ - rc.startZ) * clamped
            )
            block.rotation.set(clamped * 2.6, rc.rotY, clamped * 1.9)
          }
        }

        if (wallDustGroup && wallDustMeshes && wallDustConfigs && dustMat) {
          wallDustGroup.visible = true
          dustMat.opacity = Math.max(0, Math.sin(clamped * Math.PI) * 0.48)
          for (let i = 0; i < wallDustMeshes.length; i += 1) {
            const dc = wallDustConfigs[i]
            const puff = wallDustMeshes[i]
            puff.position.set(
              dc.x * (0.65 + clamped * 0.5),
              dc.startY + dc.riseY * clamped,
              wallZ + 0.22 + dc.reachZ * clamped
            )
            puff.scale.setScalar(dc.baseScale * (0.55 + clamped * 1.25))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const vibAmp = 0.008 + clamped * 0.024

        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          const vibX = Math.sin(clamped * Math.PI * (26 + i * 5)) * vibAmp
          const vibY = Math.cos(clamped * Math.PI * (22 + i * 4)) * (vibAmp * 0.65)
          slab.position.set(
            sc.restX + vibX,
            sc.restY + vibY,
            sc.restZ + sc.bulgeZ * clamped
          )
          slab.rotation.set(clamped * 0.085, 0, vibX * 1.5)
        }

        if (crackGroup) {
          crackGroup.visible = true
          const crackScale = 0.78 + clamped * 0.78
          crackGroup.scale.set(crackScale, crackScale, 1)
          crackGroup.position.z = wallZ + 0.165 + clamped * 0.095
        }

        if (warningGroup && warningChunks && warningChunkConfigs) {
          warningGroup.visible = true
          for (let i = 0; i < warningChunks.length; i += 1) {
            const wc = warningChunkConfigs[i]
            const chip = warningChunks[i]
            const t = (clamped * wc.speed + wc.phase) % 1
            chip.position.set(
              wc.x + Math.sin(t * Math.PI * 4 + i) * 0.05,
              Math.max(0.05, wc.startY * (1 - t * t)),
              wc.z + t * 0.24
            )
            chip.rotation.set(t * 3.4, i * 0.7, t * 2.8)
          }
        }

        if (wallRubbleGroup) wallRubbleGroup.visible = false

        if (wallDustGroup && wallDustMeshes && wallDustConfigs && dustMat) {
          wallDustGroup.visible = true
          dustMat.opacity = 0.08 + clamped * 0.14
          for (let i = 0; i < wallDustMeshes.length; i += 1) {
            const dc = wallDustConfigs[i]
            const puff = wallDustMeshes[i]
            puff.position.set(
              dc.x * 0.85,
              Math.max(0.18, dc.startY - clamped * 0.35),
              wallZ + 0.2 + clamped * 0.18
            )
            puff.scale.setScalar(dc.baseScale * (0.35 + clamped * 0.35))
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — intact visibly weathered wall section flush against real maze wall
      for (let i = 0; i < slabMeshes.length; i += 1) {
        const sc = slabConfigs[i]
        const slab = slabMeshes[i]
        slab.position.set(sc.restX, sc.restY, sc.restZ)
        slab.rotation.set(0, 0, 0)
      }
      if (crackGroup) {
        crackGroup.visible = true
        crackGroup.scale.set(0.75, 0.75, 1)
        crackGroup.position.z = wallZ + 0.165
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
        tankRestY = 2.48,
        tankFallenY = 0.44,
        strapRestY = 2.74,
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

      const puddleCenterZ = (surgeLength - 0.65) * 0.5
      const puddleScaleX = surgeHalfWidth * 1.02
      const puddleScaleY = (surgeLength + 0.72) * 0.52

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        tankGroup.position.set(0.08, tankFallenY, 0.14)
        tankGroup.rotation.set(0.28, 0.14, -0.32)
        if (seamMesh) seamMesh.scale.set(1.28, 2.2, 1.3)

        if (brokenStraps) {
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            strap.position.y = strapRestY + 0.14
            strap.rotation.z = i === 0 ? -0.58 : 0.64
            strap.rotation.x = 0.32
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
            frag.position.set(dc.endX, 0.025, dc.endZ)
            frag.rotation.set(0.14, dc.rotY, 0.08)
          }
        }

        if (puddleMesh && puddleMat) {
          puddleMesh.visible = true
          puddleMesh.position.set(0, 0.012, puddleCenterZ)
          puddleMesh.scale.set(puddleScaleX, puddleScaleY, 1)
          puddleMat.opacity = 0.56
        }

        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Tank snaps and falls rapidly in first 34% of active phase; water surge sweeps across remaining 66%
        const fallT = Math.min(1, clamped / 0.34)
        const fallEase = fallT * fallT
        tankGroup.position.set(
          0.08 * fallT,
          tankRestY + (tankFallenY - tankRestY) * fallEase,
          0.14 * fallT
        )
        tankGroup.rotation.set(0.28 * fallT, 0.14 * fallT, -0.32 * fallT)
        if (seamMesh) seamMesh.scale.set(1 + 0.28 * fallT, 1 + 1.2 * fallT, 1 + 0.3 * fallT)

        if (brokenStraps) {
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            strap.position.y = strapRestY + 0.14 * fallT
            strap.rotation.z = (i === 0 ? -0.58 : 0.64) * fallT
            strap.rotation.x = 0.32 * fallT
          }
        }

        if (tankDebrisGroup && tankDebrisMeshes && tankDebrisConfigs) {
          tankDebrisGroup.visible = true
          for (let i = 0; i < tankDebrisMeshes.length; i += 1) {
            const dc = tankDebrisConfigs[i]
            const frag = tankDebrisMeshes[i]
            const arcY = Math.sin(fallT * Math.PI) * dc.arcH
            frag.position.set(
              dc.startX + (dc.endX - dc.startX) * fallT,
              dc.startY + (0.025 - dc.startY) * fallEase + arcY,
              dc.startZ + (dc.endZ - dc.startZ) * fallT
            )
            frag.rotation.set(fallT * 2.8, dc.rotY, fallT * 2.1)
          }
        }

        // Hide warning drips once tank hits ground
        if (leakGroup) leakGroup.visible = fallT < 0.75
        if (leakStreams) {
          for (let i = 0; i < leakStreams.length; i += 1) leakStreams[i].visible = false
        }

        // Directional water surge expands smoothly from rupture point along +Z
        const surgeT = clamped <= 0.18 ? 0 : Math.min(1, (clamped - 0.18) / 0.82)
        const reachEase = 1 - (1 - surgeT) * (1 - surgeT)
        const currentFrontZ = 0.45 + reachEase * (surgeLength - 0.45)
        const backZ = -0.58
        const spanZ = Math.max(0.25, currentFrontZ - backZ)
        const spanX = surgeHalfWidth * (1.35 + reachEase * 0.65)

        if (surgeGroup && surgeSheetMesh && crestMesh && surgeMat) {
          surgeGroup.visible = surgeT > 0.01
          const surgeOpacity = surgeT > 0.01 ? Math.sin(surgeT * Math.PI) * 0.78 : 0
          surgeMat.opacity = Math.max(0, surgeOpacity)
          surgeSheetMesh.position.set(0, 0.024, (backZ + currentFrontZ) * 0.5)
          surgeSheetMesh.scale.set(spanX, spanZ, 1)

          crestMesh.position.set(0, 0.08 + Math.sin(surgeT * Math.PI) * 0.09, currentFrontZ - 0.08)
          crestMesh.scale.set(1, spanX * 0.92, 0.85 + Math.sin(surgeT * Math.PI) * 0.45)
        }

        if (sprayMeshes && sprayConfigs && leakMat) {
          leakMat.opacity = surgeT > 0.01 ? Math.sin(surgeT * Math.PI) * 0.75 : 0.45
          for (let i = 0; i < sprayMeshes.length; i += 1) {
            const sc = sprayConfigs[i]
            const sp = sprayMeshes[i]
            const arcY = Math.sin(surgeT * Math.PI) * sc.arcH
            sp.position.set(
              sc.startX + (sc.endX - sc.startX) * reachEase,
              0.08 + arcY,
              0.1 + sc.reachZ * reachEase
            )
            sp.scale.setScalar(sc.baseScale * (0.6 + Math.sin(surgeT * Math.PI) * 0.65))
          }
        }

        if (puddleMesh && puddleMat) {
          puddleMesh.visible = true
          const curPuddleZ = (backZ + currentFrontZ) * 0.5
          puddleMesh.position.set(0, 0.012, curPuddleZ)
          puddleMesh.scale.set(
            Math.max(0.55, spanX * 0.52),
            Math.max(0.55, spanZ * 0.52),
            1
          )
          puddleMat.opacity = 0.28 + reachEase * 0.34
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const vibAmp = 0.012 + clamped * 0.032
        const swayZ = Math.sin(clamped * Math.PI * 22) * (0.045 + clamped * 0.085)
        const swayX = Math.cos(clamped * Math.PI * 16) * (0.025 + clamped * 0.045)

        tankGroup.position.set(
          Math.sin(clamped * Math.PI * 28) * vibAmp,
          tankRestY - clamped * 0.065 + Math.cos(clamped * Math.PI * 24) * (vibAmp * 0.45),
          Math.cos(clamped * Math.PI * 20) * (vibAmp * 0.5)
        )
        tankGroup.rotation.set(swayX, 0, swayZ)
        if (seamMesh) seamMesh.scale.set(1 + clamped * 0.18, 1 + clamped * 0.45, 1)

        if (brokenStraps) {
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            strap.position.y = strapRestY - clamped * 0.03
            strap.rotation.z = swayZ * 0.45
            strap.rotation.x = 0
          }
        }

        if (tankDebrisGroup) tankDebrisGroup.visible = false
        if (surgeGroup) surgeGroup.visible = false
        if (surgeMat) surgeMat.opacity = 0

        // Intensifying dripping water & visible leaking streams during warning
        if (leakGroup && leakDrops && leakDropConfigs && leakMat) {
          leakGroup.visible = true
          leakMat.opacity = 0.55 + clamped * 0.32
          for (let i = 0; i < leakDrops.length; i += 1) {
            const cfg = leakDropConfigs[i]
            const drop = leakDrops[i]
            drop.visible = true
            const t = (clamped * (cfg.speed + clamped * 0.9) + cfg.phase) % 1
            drop.position.set(
              cfg.x + Math.sin(t * Math.PI * 3 + i) * 0.03,
              Math.max(0.03, cfg.startY * (1 - t * t)),
              cfg.z + t * 0.14
            )
            drop.scale.set(0.9 + clamped * 0.25, 1.55 + clamped * 0.45, 0.9 + clamped * 0.25)
          }
        }
        if (leakStreams) {
          for (let i = 0; i < leakStreams.length; i += 1) {
            const stream = leakStreams[i]
            stream.visible = clamped > 0.22
            const pulse = 0.75 + Math.abs(Math.sin(clamped * Math.PI * (14 + i * 5))) * 0.55
            stream.scale.set(pulse * (0.8 + clamped * 0.6), 2.02, pulse * (0.8 + clamped * 0.6))
          }
        }

        // Small warning puddle forming directly beneath leaking tank
        if (puddleMesh && puddleMat) {
          puddleMesh.visible = true
          puddleMesh.position.set(0, 0.012, 0.24)
          const r = 0.34 + clamped * 0.36
          puddleMesh.scale.set(r, r * 1.15, 1)
          puddleMat.opacity = 0.14 + clamped * 0.22
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — intact suspended rusted tank with faint trickle so it reads as visibly leaking
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
        leakMat.opacity = 0.32
        for (let i = 0; i < leakDrops.length; i += 1) {
          const drop = leakDrops[i]
          const cfg = leakDropConfigs[i]
          drop.visible = i < 2
          drop.position.set(cfg.x, cfg.startY - (i === 0 ? 0.32 : 1.1), cfg.z)
          drop.scale.set(0.75, 1.35, 0.75)
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
        pivotY = 3.22,
        restDropY = -0.8,
        fallenY = 0.4,
        impactLocalZ = 0.72,
        trolleyGroup,
        rearCable,
        frontCable,
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

      const fallenLocalY = fallenY - pivotY // -2.82

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        machinePivotGroup.position.set(0, pivotY, 0)
        machinePivotGroup.rotation.set(0, 0, 0)
        machineBodyGroup.position.set(0.08, fallenLocalY, impactLocalZ)
        machineBodyGroup.rotation.set(0.46, 0.16, -0.26)

        if (trolleyGroup) {
          trolleyGroup.position.set(0, pivotY, 0.14)
          trolleyGroup.rotation.set(0.14, 0, -0.1)
        }
        if (rearCable) {
          rearCable.position.set(-0.08, pivotY - 0.18, -0.3)
          rearCable.rotation.set(-0.72, 0, 0.35)
        }
        if (frontCable) {
          frontCable.position.set(0.06, pivotY - 0.24, 0.34)
          frontCable.rotation.set(0.54, 0, -0.22)
        }

        if (warnBoltGroup) warnBoltGroup.visible = false
        if (impactDustGroup) impactDustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (impactDebrisGroup && impactDebrisMeshes && impactDebrisConfigs) {
          impactDebrisGroup.visible = true
          for (let i = 0; i < impactDebrisMeshes.length; i += 1) {
            const dc = impactDebrisConfigs[i]
            const frag = impactDebrisMeshes[i]
            frag.position.set(dc.endX, 0.028, dc.endZ)
            frag.rotation.set(0.18, dc.rotY, 0.12)
          }
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Controlled swing-drop: rear cable snaps first, machine swings forward (+Z) and crashes down by 55% progress
        const dropT = Math.min(1, clamped / 0.54)
        const dropEase = dropT * dropT
        const swingArcZ = Math.sin(dropT * Math.PI * 0.5) * impactLocalZ

        machinePivotGroup.position.set(0, pivotY, 0)
        machinePivotGroup.rotation.set(0, 0, 0)
        machineBodyGroup.position.set(
          0.08 * dropT,
          restDropY + (fallenLocalY - restDropY) * dropEase,
          swingArcZ
        )
        machineBodyGroup.rotation.set(0.46 * dropT, 0.16 * dropT, -0.26 * dropT)

        if (trolleyGroup) {
          trolleyGroup.position.set(0, pivotY, 0.14 * dropT)
          trolleyGroup.rotation.set(0.14 * dropT, 0, -0.1 * dropT)
        }
        if (rearCable) {
          const snapT = Math.min(1, clamped / 0.28)
          rearCable.position.set(-0.08 * snapT, pivotY - 0.36 + 0.18 * snapT, -0.24 - 0.06 * snapT)
          rearCable.rotation.set(-0.72 * snapT, 0, 0.35 * snapT)
        }
        if (frontCable) {
          frontCable.position.set(0.06 * dropT, pivotY - 0.36 + 0.12 * dropT, 0.24 + 0.1 * dropT)
          frontCable.rotation.set(0.54 * dropT, 0, -0.22 * dropT)
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
              dc.dx * (0.25 + impactT * 0.85),
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
        // Progressive mechanical strain: increasing pendulum sway forward (+Z) & lateral shudder
        const swayAmp = 0.06 + clamped * 0.19
        const swayPitch = Math.sin(clamped * Math.PI * 11) * swayAmp + clamped * 0.14
        const swayRoll = Math.cos(clamped * Math.PI * 9) * (0.03 + clamped * 0.08)
        const vib = Math.sin(clamped * Math.PI * 30) * (0.008 + clamped * 0.018)

        machinePivotGroup.position.set(vib, pivotY - clamped * 0.05, clamped * 0.08)
        machinePivotGroup.rotation.set(-swayPitch, 0, swayRoll)
        machineBodyGroup.position.set(0, restDropY - clamped * 0.04, 0)
        machineBodyGroup.rotation.set(clamped * 0.1, 0, vib * 1.4)

        if (trolleyGroup) {
          trolleyGroup.position.set(vib * 0.6, pivotY, clamped * 0.06)
          trolleyGroup.rotation.set(clamped * 0.05, 0, swayRoll * 0.35)
        }
        if (rearCable) {
          rearCable.position.set(0, pivotY - 0.36 - clamped * 0.03, -0.24)
          rearCable.rotation.set(-swayPitch * 0.6, 0, swayRoll * 0.6)
        }
        if (frontCable) {
          frontCable.position.set(0, pivotY - 0.36 - clamped * 0.02, 0.24)
          frontCable.rotation.set(-swayPitch * 0.6, 0, swayRoll * 0.6)
        }

        if (impactDebrisGroup) impactDebrisGroup.visible = false
        if (impactDustGroup) impactDustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (warnBoltGroup && warnBoltMeshes && warnBoltConfigs) {
          warnBoltGroup.visible = true
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
      if (rearCable) {
        rearCable.position.set(0, pivotY - 0.36, -0.24)
        rearCable.rotation.set(0, 0, 0)
      }
      if (frontCable) {
        frontCable.position.set(0, pivotY - 0.36, 0.24)
        frontCable.rotation.set(0, 0, 0)
      }

      if (warnBoltGroup) warnBoltGroup.visible = false
      if (impactDebrisGroup) impactDebrisGroup.visible = false
      if (impactDustGroup) impactDustGroup.visible = false
      if (dustMat) dustMat.opacity = 0

      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE: {
      const {
        ductRestY = 3.18,
        ceilingAnchorY = 3.58,
        pivotZ = -0.98,
        bodyOffsetZ = 0.98,
        fallenY = 0.22,
        impactLocalZ = 0.56,
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

      const fallenLocalY = fallenY - ductRestY
      const fallenLocalZ = impactLocalZ - pivotZ

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        ductPivotGroup.position.set(0, ductRestY, pivotZ)
        ductPivotGroup.rotation.set(0, 0, 0)
        ductBodyGroup.position.set(0.06, fallenLocalY, fallenLocalZ)
        ductBodyGroup.rotation.set(0.08, 0.14, -0.18)

        if (rearHangerGroup) {
          rearHangerGroup.position.set(0, ceilingAnchorY, -0.82)
          rearHangerGroup.rotation.set(0.12, 0, -0.08)
        }
        if (frontHangerGroup) {
          frontHangerGroup.position.set(0.04, ceilingAnchorY, 0.82)
          frontHangerGroup.rotation.set(-0.48, 0, 0.52)
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
            shard.position.set(dc.endX, 0.02, dc.endZ)
            shard.rotation.set(0.14, dc.rotY, 0.1)
          }
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Controlled detachment: front hanger snaps -> duct pitches nose-down & detaches to floor by 54%
        const dropT = Math.min(1, clamped / 0.54)
        const dropEase = dropT * dropT
        const midPitch = Math.sin(dropT * Math.PI) * 0.42

        ductPivotGroup.position.set(0, ductRestY, pivotZ)
        ductPivotGroup.rotation.set(0, 0, 0)
        ductBodyGroup.position.set(
          0.06 * dropT,
          fallenLocalY * dropEase,
          bodyOffsetZ + (fallenLocalZ - bodyOffsetZ) * dropT
        )
        ductBodyGroup.rotation.set(
          midPitch + 0.08 * dropT,
          0.14 * dropT,
          -0.18 * dropT
        )

        if (rearHangerGroup) {
          rearHangerGroup.position.set(0, ceilingAnchorY, -0.82)
          rearHangerGroup.rotation.set(0.12 * dropT, 0, -0.08 * dropT)
        }
        if (frontHangerGroup) {
          const snapT = Math.min(1, clamped / 0.3)
          frontHangerGroup.position.set(0.04 * snapT, ceilingAnchorY, 0.82)
          frontHangerGroup.rotation.set(-0.48 * snapT, 0, 0.52 * snapT)
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
              0.02 + (dc.startY - 0.02) * (1 - impactT) * (1 - impactT) + arcY,
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
        // Progressive structural failure: duct sags nose-down, rattles laterally, front hanger loosens
        const sagPitch = 0.04 + clamped * clamped * 0.22
        const rattleX = Math.sin(clamped * Math.PI * 32) * (0.012 + clamped * 0.024)
        const rattleRoll = Math.cos(clamped * Math.PI * 26) * (0.018 + clamped * 0.05)

        ductPivotGroup.position.set(rattleX * 0.5, ductRestY - clamped * 0.04, pivotZ)
        ductPivotGroup.rotation.set(sagPitch, 0, rattleRoll)
        ductBodyGroup.position.set(rattleX, 0, bodyOffsetZ)
        ductBodyGroup.rotation.set(0, 0, rattleRoll * 0.5)

        if (rearHangerGroup) {
          rearHangerGroup.position.set(0, ceilingAnchorY, -0.82)
          rearHangerGroup.rotation.set(clamped * 0.04, 0, rattleRoll * 0.3)
        }
        if (frontHangerGroup) {
          frontHangerGroup.position.set(rattleX * 0.4, ceilingAnchorY - clamped * 0.06, 0.82)
          frontHangerGroup.rotation.set(-clamped * 0.14, 0, clamped * 0.18 + rattleRoll)
        }

        if (ductDebrisGroup) ductDebrisGroup.visible = false
        if (ductImpactDustGroup) ductImpactDustGroup.visible = false
        if (ductImpactDustMat) ductImpactDustMat.opacity = 0

        if (warnScrewGroup && warnScrewMeshes && warnScrewConfigs) {
          warnScrewGroup.visible = true
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
          warnDustGroup.visible = true
          warnDustMat.opacity = 0.18 + clamped * 0.34
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

      // Dormant state — intact galvanized duct suspended cleanly from ceiling trapeze hangers
      ductPivotGroup.position.set(0, ductRestY, pivotZ)
      ductPivotGroup.rotation.set(0, 0, 0)
      ductBodyGroup.position.set(0, 0, bodyOffsetZ)
      ductBodyGroup.rotation.set(0, 0, 0)

      if (rearHangerGroup) {
        rearHangerGroup.position.set(0, ceilingAnchorY, -0.82)
        rearHangerGroup.rotation.set(0, 0, 0)
      }
      if (frontHangerGroup) {
        frontHangerGroup.position.set(0, ceilingAnchorY, 0.82)
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
    root.userData.rubbleGroup = null
    root.userData.furnitureGroup = null
    root.userData.pipeGroup = null
    root.userData.steamGroup = null
    root.userData.steamPipe = null
    root.userData.steamCloud = null
    root.userData.steamMat = null
    root.userData.sparkMeshes = null
    root.userData.sparkConfigs = null
    root.userData.arcBolts = null
    root.userData.arcGroup = null
    root.userData.sparkGroup = null
    root.userData.cableGroup = null
    root.userData.dischargeGroup = null
    root.userData.mountGroup = null
    root.userData.glowMesh = null
    root.userData.tipMat = null
    root.userData.arcMat = null
    root.userData.sparkMat = null
    root.userData.glowMat = null
    root.userData.grateRoot = null
    root.userData.pitMesh = null
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
    root.userData.ceilingPatchGroup = null
    root.userData.ceilingOverheadGroup = null
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
    root.userData.wallBracketsGroup = null
    root.userData.trolleyGroup = null
    root.userData.rearCable = null
    root.userData.frontCable = null
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
