import * as THREE from 'three'
import { CELL_SIZE } from '../world/worldCoords.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import {
  isSharedResource,
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

export const HAZARD_PALETTE = {
  basePlate: 0x29374d,
  spikeMetal: 0xaab8c9,
  spikeTip: 0xef4444,
  plateRim: 0x5b6b82,
  plateCoreDormant: 0x475569,
  plateCoreActive: 0xf59e0b,
  gridWire: 0x1a2538,
  gridEnergyDormant: 0x38bdf8,
  gridEnergyWarning: 0xf59e0b,
  gridEnergyActive: 0xef4444,
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

/**
 * Builds procedural 3D hazards for the maze: floor spikes, pressure plates, and electrical grids.
 */
export function buildHazardMesh(hazardData = {}) {
  const type = hazardData.type || HAZARD_TYPES.FLOOR_SPIKES
  const root = new THREE.Group()
  root.name = `hazard-${type}-${hazardData.id || 'default'}`

  const size = CELL_SIZE * 0.85

  switch (type) {
    case HAZARD_TYPES.FLOOR_SPIKES: {
      const baseGeo = getPooledGeometry(
        'spikes:base',
        () => new THREE.BoxGeometry(size, 0.08, size)
      )
      const baseMat = getPooledMaterial(
        'spikes:base',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.basePlate,
            roughness: 0.8,
            metalness: 0.3,
          })
      )
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.04, 0)
      root.add(base)

      const spikesGroup = new THREE.Group()
      spikesGroup.name = 'hazard-spikes-group'
      spikesGroup.position.set(0, 0.08, 0)

      const bladeGeo = getPooledGeometry(
        'spikes:blade',
        () => new THREE.ConeGeometry(0.1, 0.45, 4)
      )
      const bladeMat = getPooledMaterial(
        'spikes:blade',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.spikeMetal,
            roughness: 0.3,
            metalness: 0.85,
          })
      )

      const offsets = [
        [-0.4, 0, -0.4],
        [0.4, 0, -0.4],
        [0, 0, 0],
        [-0.4, 0, 0.4],
        [0.4, 0, 0.4],
      ]

      for (let i = 0; i < offsets.length; i += 1) {
        const [ox, oy, oz] = offsets[i]
        const blade = new THREE.Mesh(bladeGeo, bladeMat)
        blade.position.set(ox * (size * 0.4), oy, oz * (size * 0.4))
        spikesGroup.add(blade)
      }

      root.add(spikesGroup)
      root.userData = { hazardType: type, spikesGroup, activeY: 0.32, dormantY: -0.05 }
      break
    }

    case HAZARD_TYPES.PRESSURE_PLATE: {
      const baseGeo = getPooledGeometry(
        'plate:base',
        () => new THREE.BoxGeometry(size * 0.9, 0.06, size * 0.9)
      )
      const baseMat = getPooledMaterial(
        'plate:base',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.plateRim,
            roughness: 0.7,
            metalness: 0.4,
          })
      )
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.03, 0)
      root.add(base)

      const plateGeo = getPooledGeometry(
        'plate:pad',
        () => new THREE.BoxGeometry(size * 0.55, 0.08, size * 0.55)
      )
      // Instance-owned material because each plate reflects its own trigger state
      const plateMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.plateCoreDormant,
        emissive: 0x000000,
        roughness: 0.4,
        metalness: 0.6,
      })
      const plate = new THREE.Mesh(plateGeo, plateMat)
      plate.position.set(0, 0.06, 0)
      root.add(plate)

      root.userData = { hazardType: type, plateMesh: plate, plateMat }
      break
    }

    case HAZARD_TYPES.ELECTRIC_GRID: {
      const baseGeo = getPooledGeometry(
        'electric:base',
        () => new THREE.BoxGeometry(size, 0.04, size)
      )
      const baseMat = getPooledMaterial(
        'electric:base',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.gridWire,
            roughness: 0.9,
            metalness: 0.2,
          })
      )
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.02, 0)
      root.add(base)

      // Instance-owned material because electric grids pulse independently per phase
      const arcMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.gridEnergyDormant,
        emissive: HAZARD_PALETTE.gridEnergyDormant,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.1,
      })

      const arcGroup = new THREE.Group()
      const wireGeo = getPooledGeometry(
        'electric:wire',
        () => new THREE.BoxGeometry(size * 0.8, 0.03, 0.08)
      )
      for (let a = -1; a <= 1; a += 2) {
        const wire = new THREE.Mesh(wireGeo, arcMat)
        wire.position.set(0, 0.05, a * (size * 0.25))
        arcGroup.add(wire)
      }

      root.add(arcGroup)
      root.userData = { hazardType: type, arcMat, arcGroup }
      break
    }

    case HAZARD_TYPES.CEILING_COLLAPSE: {
      const markerGeo = getPooledGeometry(
        'ceiling_collapse:marker',
        () => new THREE.BoxGeometry(size * 0.8, 0.02, size * 0.8)
      )
      const markerMat = getPooledMaterial(
        'ceiling_collapse:marker',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.9,
            metalness: 0.1,
          })
      )
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.set(0, 0.01, 0)
      root.add(marker)

      const rubbleGroup = new THREE.Group()
      rubbleGroup.name = 'hazard-ceiling-rubble'
      rubbleGroup.position.set(0, 2.4, 0)

      const chunkGeo = getPooledGeometry(
        'ceiling_collapse:chunk',
        () => new THREE.BoxGeometry(0.35, 0.35, 0.35)
      )
      const chunkMat = getPooledMaterial(
        'ceiling_collapse:chunk',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x3d4f6c,
            roughness: 0.85,
            metalness: 0.15,
          })
      )

      for (let c = 0; c < 5; c += 1) {
        const chunk = new THREE.Mesh(chunkGeo, chunkMat)
        const angle = (c / 5) * Math.PI * 2
        const rad = 0.2 + (c % 2) * 0.15
        chunk.position.set(Math.cos(angle) * rad, (c * 0.1) - 0.2, Math.sin(angle) * rad)
        chunk.rotation.set(c * 0.5, c * 0.7, c * 0.3)
        rubbleGroup.add(chunk)
      }

      root.add(rubbleGroup)
      root.userData = { hazardType: type, rubbleGroup, dormantY: 2.4, activeY: 0.05 }
      break
    }

    case HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE: {
      const furnitureGroup = new THREE.Group()
      furnitureGroup.name = 'hazard-rotten-furniture'
      furnitureGroup.position.set(0, 0, 0)

      const woodMat = getPooledMaterial(
        'rotten_furniture:wood',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x45352a,
            roughness: 0.94,
            metalness: 0.02,
          })
      )
      const metalMat = getPooledMaterial(
        'rotten_furniture:metal',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x3b2820,
            roughness: 0.9,
            metalness: 0.2,
          })
      )

      const topGeo = getPooledGeometry(
        'rotten_furniture:top',
        () => new THREE.BoxGeometry(0.9, 0.05, 0.5)
      )
      const topMesh = new THREE.Mesh(topGeo, woodMat)
      topMesh.position.set(0, 0.65, 0)
      furnitureGroup.add(topMesh)

      const legGeo = getPooledGeometry(
        'rotten_furniture:leg',
        () => new THREE.BoxGeometry(0.06, 0.65, 0.06)
      )
      const legOffsets = [
        [-0.38, 0.325, -0.2],
        [0.38, 0.325, -0.2],
        [-0.38, 0.325, 0.2],
        [0.38, 0.325, 0.2],
      ]
      for (let l = 0; l < legOffsets.length; l += 1) {
        const [lx, ly, lz] = legOffsets[l]
        const leg = new THREE.Mesh(legGeo, l < 2 ? woodMat : metalMat)
        leg.position.set(lx, ly, lz)
        if (l === 3) {
          leg.rotation.z = 0.35
          leg.rotation.x = -0.2
        }
        furnitureGroup.add(leg)
      }

      root.add(furnitureGroup)
      root.userData = { hazardType: type, furnitureGroup, uprightRotX: 0, uprightRotZ: 0, collapsedRotX: Math.PI * 0.48, collapsedRotZ: Math.PI * 0.15 }
      break
    }

    default:
      break
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
    case HAZARD_TYPES.FLOOR_SPIKES: {
      const group = data.spikesGroup
      if (!group) return
      let targetY = data.dormantY

      if (state === 'active') {
        targetY = data.activeY
      } else if (state === 'warning') {
        targetY = data.dormantY + Math.sin(progress * Math.PI * 8) * 0.04
      }

      const diff = targetY - group.position.y
      if (state === 'warning' || Math.abs(diff) > 1e-5) {
        const nextY =
          state !== 'warning' && Math.abs(diff * 0.75) <= 1e-5
            ? targetY
            : group.position.y + diff * 0.25
        group.position.y = nextY
      }
      break
    }

    case HAZARD_TYPES.PRESSURE_PLATE: {
      const plate = data.plateMesh
      const mat = data.plateMat
      if (!plate || !mat) return

      const isTriggered = state === 'active' || state === 'warning'
      const nextKey = isTriggered ? 'triggered' : 'dormant'
      if (data._visualStateKey === nextKey) return
      data._visualStateKey = nextKey

      if (isTriggered) {
        plate.position.y = 0.03
        mat.color.setHex(HAZARD_PALETTE.plateCoreActive)
        mat.emissive.setHex(0xd97706)
        mat.emissiveIntensity = 1.2
      } else {
        plate.position.y = 0.06
        mat.color.setHex(HAZARD_PALETTE.plateCoreDormant)
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
      }
      break
    }

    case HAZARD_TYPES.ELECTRIC_GRID: {
      const mat = data.arcMat
      if (!mat) return

      if (state === 'active') {
        if (data._visualStateKey === 'active') return
        data._visualStateKey = 'active'
        data._warningPulse = null
        mat.color.setHex(HAZARD_PALETTE.gridEnergyActive)
        mat.emissive.setHex(HAZARD_PALETTE.gridEnergyActive)
        mat.emissiveIntensity = 3.5
      } else if (state === 'warning') {
        const pulse = Math.sin(progress * Math.PI * 10) > 0 ? 1 : 0.2
        if (data._visualStateKey === 'warning' && data._warningPulse === pulse) return
        if (data._visualStateKey !== 'warning') {
          mat.color.setHex(HAZARD_PALETTE.gridEnergyWarning)
          mat.emissive.setHex(HAZARD_PALETTE.gridEnergyWarning)
        }
        data._visualStateKey = 'warning'
        data._warningPulse = pulse
        mat.emissiveIntensity = 1.8 * pulse
      } else {
        if (data._visualStateKey === 'dormant') return
        data._visualStateKey = 'dormant'
        data._warningPulse = null
        mat.color.setHex(HAZARD_PALETTE.gridEnergyDormant)
        mat.emissive.setHex(HAZARD_PALETTE.gridEnergyDormant)
        mat.emissiveIntensity = 0.4
      }
      break
    }

    case HAZARD_TYPES.CEILING_COLLAPSE: {
      const group = data.rubbleGroup
      if (!group) return

      if (state === 'active') {
        group.position.y = data.activeY
      } else if (state === 'warning') {
        const shake = Math.sin(progress * Math.PI * 12) * 0.06
        group.position.y = data.dormantY + shake
      } else {
        group.position.y = data.dormantY
      }
      break
    }

    case HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE: {
      const group = data.furnitureGroup
      if (!group) return

      if (state === 'active' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        group.rotation.x = data.collapsedRotX
        group.rotation.z = data.collapsedRotZ
        group.position.y = -0.15
      } else if (state === 'warning') {
        const shakeX = Math.sin(progress * Math.PI * 16) * 0.06
        const shakeZ = Math.cos(progress * Math.PI * 14) * 0.05
        group.rotation.x = data.uprightRotX + shakeX
        group.rotation.z = data.uprightRotZ + shakeZ
        group.position.y = 0
      } else {
        group.rotation.x = data.uprightRotX
        group.rotation.z = data.uprightRotZ
        group.position.y = 0
      }
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
    root.userData._warningPulse = null
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
