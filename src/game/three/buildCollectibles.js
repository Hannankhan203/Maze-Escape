import * as THREE from 'three'
import { COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import {
  isSharedResource,
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

export const COLLECTIBLE_PALETTE = {
  healthPrimary: 0xf43f5e,
  healthGore: 0xbe123c,
  soulPrimary: 0xa855f7,
  soulCore: 0xe9d5ff,
  compassPrimary: 0x3b82f6,
  veilPrimary: 0x06b6d4,
  energyPrimary: 0x10b981,
  wardingPrimary: 0xf59e0b,
  timePrimary: 0xec4899,
  watchersPrimary: 0x8b5cf6,
  echoPulsePrimary: 0x38bdf8,
  spiritLanternPrimary: 0xfbbf24,

  echoPathStep: 0x38bdf8,
  echoPathFinal: 0x6ee7b7,

  keycardChassis: 0x0f172a,
  keycardPrimary: 0x22d3ee,
  keycardCore: 0x67e8f9,
  keycardChip: 0xfbbf24,
  gateUnlock: 0x10b981,
}

const collectibleGeoPool = new Map()
const collectibleMatPool = new Map()

function getPooledGeometry(key, factory) {
  let geo = collectibleGeoPool.get(key)
  if (!geo) {
    geo = markSharedResource(factory())
    collectibleGeoPool.set(key, geo)
  }
  return geo
}

function getPooledMaterial(key, factory) {
  let mat = collectibleMatPool.get(key)
  if (!mat) {
    mat = markSharedResource(factory())
    collectibleMatPool.set(key, mat)
  }
  return mat
}

function disposeMaterialDirect(material) {
  if (!material) return
  if (Array.isArray(material)) {
    for (let i = 0; i < material.length; i += 1) {
      disposeMaterialDirect(material[i])
    }
    return
  }

  const textureKeys = [
    'map',
    'alphaMap',
    'aoMap',
    'bumpMap',
    'emissiveMap',
    'envMap',
    'lightMap',
    'metalnessMap',
    'normalMap',
    'roughnessMap',
  ]
  for (let i = 0; i < textureKeys.length; i += 1) {
    const tex = material[textureKeys[i]]
    if (tex && typeof tex.dispose === 'function') {
      tex.dispose()
    }
  }

  if (typeof material.dispose === 'function') {
    material.dispose()
  }
}

export function disposeCollectiblePools() {
  for (const geo of collectibleGeoPool.values()) {
    geo?.dispose?.()
  }
  collectibleGeoPool.clear()

  for (const mat of collectibleMatPool.values()) {
    disposeMaterialDirect(mat)
  }
  collectibleMatPool.clear()
}

export function getCollectiblePoolStats() {
  return {
    geometries: collectibleGeoPool.size,
    materials: collectibleMatPool.size,
  }
}

registerSharedPoolClearer(disposeCollectiblePools)

function disposeMaterial(material) {
  if (!material) return
  if (Array.isArray(material)) {
    for (let i = 0; i < material.length; i += 1) {
      disposeMaterial(material[i])
    }
    return
  }
  if (isSharedResource(material)) {
    return
  }
  disposeMaterialDirect(material)
}

export function disposeObject3D(root) {
  if (!root) return
  if (root.parent && typeof root.parent.remove === 'function') {
    root.parent.remove(root)
  }

  const geometries = new Set()
  const materials = new Set()

  if (typeof root.traverse === 'function') {
    root.traverse((obj) => {
      if (obj.geometry && !isSharedResource(obj.geometry)) {
        geometries.add(obj.geometry)
      }
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          for (let i = 0; i < obj.material.length; i += 1) {
            const m = obj.material[i]
            if (m && !isSharedResource(m)) materials.add(m)
          }
        } else if (!isSharedResource(obj.material)) {
          materials.add(obj.material)
        }
      }
    })
  } else {
    if (root.geometry && !isSharedResource(root.geometry)) geometries.add(root.geometry)
    if (root.material && !isSharedResource(root.material)) materials.add(root.material)
  }

  for (const geo of geometries) {
    if (typeof geo.dispose === 'function') geo.dispose()
  }
  for (const mat of materials) {
    disposeMaterial(mat)
  }

  if (typeof root.clear === 'function') {
    root.clear()
  }
}

function computePhaseOffset(id, row = 0, col = 0) {
  const str = typeof id === 'string' ? id : `${row},${col}`
  let hash = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 6283) / 1000
}

/**
 * Builds a distinctive multi-part procedural 3D Health Capsule (crimson serum vial + 3D medical cross).
 */
function buildHealthCapsuleParts(group, id, row, col) {
  const glassGeo = getPooledGeometry(
    'item:health_capsule:glass',
    () => new THREE.CylinderGeometry(0.15, 0.15, 0.34, 16)
  )
  const glassMat = getPooledMaterial(
    'item:health_capsule:glass',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.healthPrimary,
        emissive: COLLECTIBLE_PALETTE.healthGore,
        emissiveIntensity: 0.42,
        roughness: 0.18,
        metalness: 0.25,
        transparent: true,
        opacity: 0.86,
      })
  )
  const glassMesh = new THREE.Mesh(glassGeo, glassMat)
  glassMesh.name = 'health-capsule-vial'
  group.add(glassMesh)

  const capGeo = getPooledGeometry(
    'item:health_capsule:cap',
    () => new THREE.SphereGeometry(0.156, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)
  )
  const capMat = getPooledMaterial(
    'item:health_capsule:cap',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xdbeafe,
        emissive: 0x475569,
        emissiveIntensity: 0.22,
        roughness: 0.28,
        metalness: 0.85,
      })
  )
  const topCap = new THREE.Mesh(capGeo, capMat)
  topCap.position.y = 0.165
  topCap.name = 'health-capsule-top-cap'
  group.add(topCap)

  const bottomCap = new THREE.Mesh(capGeo, capMat)
  bottomCap.position.y = -0.165
  bottomCap.rotation.x = Math.PI
  bottomCap.name = 'health-capsule-bottom-cap'
  group.add(bottomCap)

  const coreGeo = getPooledGeometry(
    'item:health_capsule:core',
    () => new THREE.CylinderGeometry(0.088, 0.088, 0.25, 12)
  )
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffe4e6,
    emissive: COLLECTIBLE_PALETTE.healthPrimary,
    emissiveIntensity: 0.92,
    roughness: 0.12,
    metalness: 0.15,
  })
  const coreMesh = new THREE.Mesh(coreGeo, coreMat)
  coreMesh.name = 'health-capsule-core'
  group.add(coreMesh)

  const crossHGeo = getPooledGeometry(
    'item:health_capsule:cross-h',
    () => new THREE.BoxGeometry(0.18, 0.056, 0.335)
  )
  const crossVGeo = getPooledGeometry(
    'item:health_capsule:cross-v',
    () => new THREE.BoxGeometry(0.056, 0.18, 0.335)
  )
  const crossMat = getPooledMaterial(
    'item:health_capsule:cross',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xfda4af,
        emissiveIntensity: 0.65,
        roughness: 0.2,
        metalness: 0.2,
      })
  )
  const crossH = new THREE.Mesh(crossHGeo, crossMat)
  crossH.name = 'health-capsule-cross-h'
  const crossV = new THREE.Mesh(crossVGeo, crossMat)
  crossV.name = 'health-capsule-cross-v'
  group.add(crossH, crossV)

  const haloGeo = getPooledGeometry(
    'item:halo',
    () => new THREE.TorusGeometry(0.36, 0.022, 8, 24)
  )
  const haloMat = getPooledMaterial(
    'item:health_capsule:halo',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.healthPrimary,
        emissive: COLLECTIBLE_PALETTE.healthPrimary,
        emissiveIntensity: 0.65,
        roughness: 0.22,
        metalness: 0.65,
      })
  )
  const haloMesh = new THREE.Mesh(haloGeo, haloMat)
  haloMesh.rotation.x = Math.PI / 2.2
  haloMesh.name = 'health-capsule-halo'
  group.add(haloMesh)

  const baseY = 0.92
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type: COLLECTIBLE_TYPES.HEALTH_CAPSULE,
    id,
    baseY,
    bobAmp: 0.11,
    bobFreq: 2.3,
    spinSpeed: 1.65,
    phaseOffset: computePhaseOffset(id, row, col),
    accentColor: COLLECTIBLE_PALETTE.healthPrimary,
    orbitRings: [haloMesh],
    coreMesh,
    coreMat,
  }
}

/**
 * Builds a distinctive supernatural amethyst crystal cluster for Soul Shards.
 */
function buildSoulShardParts(group, id, row, col) {
  const spireTopGeo = getPooledGeometry(
    'item:soul_shards:spire-top',
    () => new THREE.ConeGeometry(0.145, 0.44, 6)
  )
  const spireBottomGeo = getPooledGeometry(
    'item:soul_shards:spire-bottom',
    () => new THREE.ConeGeometry(0.145, 0.24, 6)
  )
  const crystalMat = getPooledMaterial(
    'item:soul_shards:crystal',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.soulPrimary,
        emissive: 0x7e22ce,
        emissiveIntensity: 0.62,
        roughness: 0.14,
        metalness: 0.45,
        transparent: true,
        opacity: 0.92,
      })
  )

  const topSpire = new THREE.Mesh(spireTopGeo, crystalMat)
  topSpire.position.y = 0.16
  topSpire.name = 'soul-shard-main-spire'
  group.add(topSpire)

  const bottomSpire = new THREE.Mesh(spireBottomGeo, crystalMat)
  bottomSpire.position.y = -0.18
  bottomSpire.rotation.x = Math.PI
  bottomSpire.name = 'soul-shard-bottom-taper'
  group.add(bottomSpire)

  const subSpireGeo = getPooledGeometry(
    'item:soul_shards:sub-spire',
    () => new THREE.ConeGeometry(0.072, 0.28, 5)
  )
  const leftShard = new THREE.Mesh(subSpireGeo, crystalMat)
  leftShard.position.set(-0.14, -0.02, 0.05)
  leftShard.rotation.set(0.16, 0.2, 0.48)
  leftShard.name = 'soul-shard-satellite-left'
  group.add(leftShard)

  const rightShard = new THREE.Mesh(subSpireGeo, crystalMat)
  rightShard.position.set(0.14, 0.01, -0.05)
  rightShard.rotation.set(-0.14, -0.25, -0.44)
  rightShard.name = 'soul-shard-satellite-right'
  group.add(rightShard)

  const coreGeo = getPooledGeometry(
    'item:soul_shards:core',
    () => new THREE.OctahedronGeometry(0.105, 0)
  )
  const coreMat = new THREE.MeshStandardMaterial({
    color: COLLECTIBLE_PALETTE.soulCore,
    emissive: COLLECTIBLE_PALETTE.soulCore,
    emissiveIntensity: 0.95,
    roughness: 0.08,
    metalness: 0.2,
  })
  const coreMesh = new THREE.Mesh(coreGeo, coreMat)
  coreMesh.position.y = 0.02
  coreMesh.name = 'soul-shard-core'
  group.add(coreMesh)

  const haloGeo = getPooledGeometry(
    'item:halo',
    () => new THREE.TorusGeometry(0.36, 0.022, 8, 24)
  )
  const haloMat = getPooledMaterial(
    'item:soul_shards:halo',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.soulCore,
        emissive: COLLECTIBLE_PALETTE.soulPrimary,
        emissiveIntensity: 0.72,
        roughness: 0.22,
        metalness: 0.7,
      })
  )
  const haloMesh = new THREE.Mesh(haloGeo, haloMat)
  haloMesh.rotation.set(Math.PI / 2.35, 0.28, 0)
  haloMesh.name = 'soul-shard-halo'
  group.add(haloMesh)

  const baseY = 0.92
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type: COLLECTIBLE_TYPES.SOUL_SHARDS,
    id,
    baseY,
    bobAmp: 0.13,
    bobFreq: 2.0,
    spinSpeed: 1.9,
    phaseOffset: computePhaseOffset(id, row, col),
    accentColor: COLLECTIBLE_PALETTE.soulPrimary,
    orbitRings: [haloMesh],
    coreMesh,
    coreMat,
  }
}

/**
 * Builds a distinctive glowing emerald battery/power cell for Energy Cell.
 */
function buildEnergyCellParts(group, id, row, col) {
  const coreChamberGeo = getPooledGeometry(
    'item:energy_cell:chamber',
    () => new THREE.CylinderGeometry(0.145, 0.145, 0.34, 8)
  )
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xa7f3d0,
    emissive: COLLECTIBLE_PALETTE.energyPrimary,
    emissiveIntensity: 0.92,
    roughness: 0.14,
    metalness: 0.25,
  })
  const coreMesh = new THREE.Mesh(coreChamberGeo, coreMat)
  coreMesh.name = 'energy-cell-plasma-core'
  group.add(coreMesh)

  const casingMat = getPooledMaterial(
    'item:energy_cell:casing',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        emissive: 0x064e3b,
        emissiveIntensity: 0.25,
        roughness: 0.35,
        metalness: 0.88,
      })
  )
  const capRingGeo = getPooledGeometry(
    'item:energy_cell:cap-ring',
    () => new THREE.CylinderGeometry(0.185, 0.185, 0.085, 6)
  )
  const topCap = new THREE.Mesh(capRingGeo, casingMat)
  topCap.position.y = 0.19
  topCap.name = 'energy-cell-top-cap'
  group.add(topCap)

  const bottomCap = new THREE.Mesh(capRingGeo, casingMat)
  bottomCap.position.y = -0.19
  bottomCap.name = 'energy-cell-bottom-cap'
  group.add(bottomCap)

  const terminalGeo = getPooledGeometry(
    'item:energy_cell:terminal',
    () => new THREE.CylinderGeometry(0.068, 0.068, 0.065, 10)
  )
  const terminalMat = getPooledMaterial(
    'item:energy_cell:terminal',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.45,
        roughness: 0.22,
        metalness: 0.9,
      })
  )
  const terminal = new THREE.Mesh(terminalGeo, terminalMat)
  terminal.position.y = 0.26
  terminal.name = 'energy-cell-terminal'
  group.add(terminal)

  const ribGeo = getPooledGeometry(
    'item:energy_cell:rib',
    () => new THREE.TorusGeometry(0.165, 0.018, 6, 6)
  )
  const midRib = new THREE.Mesh(ribGeo, casingMat)
  midRib.rotation.x = Math.PI / 2
  midRib.name = 'energy-cell-center-rib'
  group.add(midRib)

  const haloGeo = getPooledGeometry(
    'item:halo',
    () => new THREE.TorusGeometry(0.36, 0.022, 8, 24)
  )
  const haloMat = getPooledMaterial(
    'item:energy_cell:halo',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.energyPrimary,
        emissive: COLLECTIBLE_PALETTE.energyPrimary,
        emissiveIntensity: 0.68,
        roughness: 0.22,
        metalness: 0.72,
      })
  )
  const haloMesh = new THREE.Mesh(haloGeo, haloMat)
  haloMesh.rotation.x = Math.PI / 2.2
  haloMesh.name = 'energy-cell-halo'
  group.add(haloMesh)

  const baseY = 0.90
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type: COLLECTIBLE_TYPES.ENERGY_CELL,
    id,
    baseY,
    bobAmp: 0.11,
    bobFreq: 2.5,
    spinSpeed: 1.75,
    phaseOffset: computePhaseOffset(id, row, col),
    accentColor: COLLECTIBLE_PALETTE.energyPrimary,
    orbitRings: [haloMesh],
    coreMesh,
    coreMat,
  }
}

/**
 * Builds a distinctive cyan sonar prism silhouette for Echo Reveal.
 */
function buildEchoRevealParts(group, id, row, col) {
  const prismGeo = getPooledGeometry(
    'item:echo_reveal:prism',
    () => new THREE.OctahedronGeometry(0.24, 0)
  )
  const prismMat = getPooledMaterial(
    'item:echo_reveal:prism',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.echoPulsePrimary,
        emissive: 0x0284c7,
        emissiveIntensity: 0.52,
        roughness: 0.16,
        metalness: 0.65,
        transparent: true,
        opacity: 0.88,
      })
  )
  const prismMesh = new THREE.Mesh(prismGeo, prismMat)
  prismMesh.name = 'echo-reveal-prism'
  group.add(prismMesh)

  const coreGeo = getPooledGeometry(
    'item:echo_reveal:core',
    () => new THREE.SphereGeometry(0.11, 14, 12)
  )
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xe0f2fe,
    emissive: COLLECTIBLE_PALETTE.echoPulsePrimary,
    emissiveIntensity: 0.95,
    roughness: 0.1,
    metalness: 0.2,
  })
  const coreMesh = new THREE.Mesh(coreGeo, coreMat)
  coreMesh.name = 'echo-reveal-eye'
  group.add(coreMesh)

  const haloGeo = getPooledGeometry(
    'item:halo',
    () => new THREE.TorusGeometry(0.36, 0.022, 8, 24)
  )
  const haloMat = getPooledMaterial(
    'item:echo_reveal:halo',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.echoPulsePrimary,
        emissive: COLLECTIBLE_PALETTE.echoPulsePrimary,
        emissiveIntensity: 0.65,
        roughness: 0.2,
        metalness: 0.78,
      })
  )
  const haloA = new THREE.Mesh(haloGeo, haloMat)
  haloA.rotation.x = Math.PI / 2.2
  haloA.name = 'echo-reveal-halo-a'
  const haloB = new THREE.Mesh(haloGeo, haloMat)
  haloB.rotation.set(Math.PI / 3.1, Math.PI / 4, 0)
  haloB.name = 'echo-reveal-halo-b'
  group.add(haloA, haloB)

  const baseY = 0.92
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type: COLLECTIBLE_TYPES.ECHO_REVEAL,
    id,
    baseY,
    bobAmp: 0.12,
    bobFreq: 2.2,
    spinSpeed: 1.85,
    phaseOffset: computePhaseOffset(id, row, col),
    accentColor: COLLECTIBLE_PALETTE.echoPulsePrimary,
    orbitRings: [haloA, haloB],
    coreMesh,
    coreMat,
  }
}

/**
 * Builds a distinctive chromatic chronos hourglass & gear assembly for Time Fragment.
 */
function buildTimeFragmentParts(group, id, row, col) {
  const gearGeo = getPooledGeometry(
    'item:time_fragment:gear',
    () => new THREE.TorusGeometry(0.28, 0.034, 8, 12)
  )
  const gearMat = getPooledMaterial(
    'item:time_fragment:gear',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.timePrimary,
        emissive: 0x9d174d,
        emissiveIntensity: 0.55,
        roughness: 0.22,
        metalness: 0.85,
      })
  )
  const gearMesh = new THREE.Mesh(gearGeo, gearMat)
  gearMesh.name = 'time-fragment-chronos-ring'
  group.add(gearMesh)

  const glassConeGeo = getPooledGeometry(
    'item:time_fragment:cone',
    () => new THREE.ConeGeometry(0.12, 0.22, 6)
  )
  const glassMat = getPooledMaterial(
    'item:time_fragment:glass',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xfce7f3,
        emissive: COLLECTIBLE_PALETTE.timePrimary,
        emissiveIntensity: 0.45,
        roughness: 0.15,
        metalness: 0.35,
        transparent: true,
        opacity: 0.85,
      })
  )
  const topHourglass = new THREE.Mesh(glassConeGeo, glassMat)
  topHourglass.position.y = 0.11
  topHourglass.name = 'time-fragment-glass-top'
  const bottomHourglass = new THREE.Mesh(glassConeGeo, glassMat)
  bottomHourglass.position.y = -0.11
  bottomHourglass.rotation.x = Math.PI
  bottomHourglass.name = 'time-fragment-glass-bottom'
  group.add(topHourglass, bottomHourglass)

  const coreGeo = getPooledGeometry(
    'item:time_fragment:core',
    () => new THREE.OctahedronGeometry(0.09, 0)
  )
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: COLLECTIBLE_PALETTE.timePrimary,
    emissiveIntensity: 0.95,
    roughness: 0.1,
    metalness: 0.2,
  })
  const coreMesh = new THREE.Mesh(coreGeo, coreMat)
  coreMesh.name = 'time-fragment-temporal-core'
  group.add(coreMesh)

  const haloGeo = getPooledGeometry(
    'item:halo',
    () => new THREE.TorusGeometry(0.36, 0.022, 8, 24)
  )
  const haloMat = getPooledMaterial(
    'item:time_fragment:halo',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.timePrimary,
        emissive: COLLECTIBLE_PALETTE.timePrimary,
        emissiveIntensity: 0.65,
        roughness: 0.2,
        metalness: 0.8,
      })
  )
  const haloMesh = new THREE.Mesh(haloGeo, haloMat)
  haloMesh.rotation.x = Math.PI / 2.3
  haloMesh.name = 'time-fragment-halo'
  group.add(haloMesh)

  const baseY = 0.92
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type: COLLECTIBLE_TYPES.TIME_FRAGMENT,
    id,
    baseY,
    bobAmp: 0.12,
    bobFreq: 2.1,
    spinSpeed: 1.6,
    phaseOffset: computePhaseOffset(id, row, col),
    accentColor: COLLECTIBLE_PALETTE.timePrimary,
    orbitRings: [gearMesh, haloMesh],
    coreMesh,
    coreMat,
  }
}

/**
 * Builds a distinctive ocular sigil & pupil assembly for Watcher's Eye.
 */
function buildWatchersEyeParts(group, id, row, col) {
  const eyeRimGeo = getPooledGeometry(
    'item:watchers_eye:rim',
    () => new THREE.TorusGeometry(0.26, 0.038, 8, 24)
  )
  const eyeRimMat = getPooledMaterial(
    'item:watchers_eye:rim',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.watchersPrimary,
        emissive: 0x5b21b6,
        emissiveIntensity: 0.6,
        roughness: 0.18,
        metalness: 0.75,
      })
  )
  const rimMesh = new THREE.Mesh(eyeRimGeo, eyeRimMat)
  rimMesh.scale.set(1.25, 0.65, 1)
  rimMesh.name = 'watchers-eye-rim'
  group.add(rimMesh)

  const pupilGeo = getPooledGeometry(
    'item:watchers_eye:pupil',
    () => new THREE.OctahedronGeometry(0.13, 0)
  )
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0xf3e8ff,
    emissive: COLLECTIBLE_PALETTE.watchersPrimary,
    emissiveIntensity: 0.98,
    roughness: 0.08,
    metalness: 0.3,
  })
  const pupilMesh = new THREE.Mesh(pupilGeo, pupilMat)
  pupilMesh.name = 'watchers-eye-pupil'
  group.add(pupilMesh)

  const haloGeo = getPooledGeometry(
    'item:halo',
    () => new THREE.TorusGeometry(0.36, 0.022, 8, 24)
  )
  const haloMat = getPooledMaterial(
    'item:watchers_eye:halo',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xc084fc,
        emissive: COLLECTIBLE_PALETTE.watchersPrimary,
        emissiveIntensity: 0.72,
        roughness: 0.2,
        metalness: 0.75,
      })
  )
  const haloA = new THREE.Mesh(haloGeo, haloMat)
  haloA.rotation.set(Math.PI / 2.2, 0.35, 0)
  haloA.name = 'watchers-eye-halo-a'
  const haloB = new THREE.Mesh(haloGeo, haloMat)
  haloB.rotation.set(Math.PI / 3.0, -0.4, 0)
  haloB.name = 'watchers-eye-halo-b'
  group.add(haloA, haloB)

  const baseY = 0.92
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type: COLLECTIBLE_TYPES.WATCHERS_EYE,
    id,
    baseY,
    bobAmp: 0.13,
    bobFreq: 2.2,
    spinSpeed: 1.7,
    phaseOffset: computePhaseOffset(id, row, col),
    accentColor: COLLECTIBLE_PALETTE.watchersPrimary,
    orbitRings: [haloA, haloB],
    coreMesh: pupilMesh,
    coreMat: pupilMat,
  }
}

/**
 * Builds a distinctive sonic wave tuning orb for Echo Pulse.
 */
function buildEchoPulseParts(group, id, row, col) {
  const sphereGeo = getPooledGeometry(
    'item:echo_pulse:sphere',
    () => new THREE.SphereGeometry(0.14, 16, 14)
  )
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0xe0f2fe,
    emissive: COLLECTIBLE_PALETTE.echoPulsePrimary,
    emissiveIntensity: 0.95,
    roughness: 0.12,
    metalness: 0.25,
  })
  const coreMesh = new THREE.Mesh(sphereGeo, sphereMat)
  coreMesh.name = 'echo-pulse-core'
  group.add(coreMesh)

  const ringGeo1 = getPooledGeometry(
    'item:echo_pulse:ring1',
    () => new THREE.TorusGeometry(0.24, 0.022, 8, 24)
  )
  const ringGeo2 = getPooledGeometry(
    'item:echo_pulse:ring2',
    () => new THREE.TorusGeometry(0.35, 0.02, 8, 24)
  )
  const ringMat = getPooledMaterial(
    'item:echo_pulse:ring',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.echoPulsePrimary,
        emissive: COLLECTIBLE_PALETTE.echoPulsePrimary,
        emissiveIntensity: 0.65,
        roughness: 0.2,
        metalness: 0.8,
      })
  )
  const ringA = new THREE.Mesh(ringGeo1, ringMat)
  ringA.rotation.x = Math.PI / 2.2
  ringA.name = 'echo-pulse-ring-inner'
  const ringB = new THREE.Mesh(ringGeo2, ringMat)
  ringB.rotation.set(Math.PI / 3.2, 0.45, 0)
  ringB.name = 'echo-pulse-ring-outer'
  group.add(ringA, ringB)

  const baseY = 0.90
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type: COLLECTIBLE_TYPES.ECHO_PULSE,
    id,
    baseY,
    bobAmp: 0.12,
    bobFreq: 2.6,
    spinSpeed: 2.0,
    phaseOffset: computePhaseOffset(id, row, col),
    accentColor: COLLECTIBLE_PALETTE.echoPulsePrimary,
    orbitRings: [ringA, ringB],
    coreMesh,
    coreMat: sphereMat,
  }
}

/**
 * Builds a distinctive antique caged lantern with floating ember for Spirit Lantern.
 */
function buildSpiritLanternParts(group, id, row, col) {
  const cageMat = getPooledMaterial(
    'item:spirit_lantern:cage',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x78350f,
        emissive: 0x451a03,
        emissiveIntensity: 0.25,
        roughness: 0.35,
        metalness: 0.85,
      })
  )
  const baseTrayGeo = getPooledGeometry(
    'item:spirit_lantern:base',
    () => new THREE.CylinderGeometry(0.16, 0.18, 0.06, 6)
  )
  const baseTray = new THREE.Mesh(baseTrayGeo, cageMat)
  baseTray.position.y = -0.16
  baseTray.name = 'spirit-lantern-base'
  group.add(baseTray)

  const roofGeo = getPooledGeometry(
    'item:spirit_lantern:roof',
    () => new THREE.ConeGeometry(0.18, 0.14, 6)
  )
  const roofMesh = new THREE.Mesh(roofGeo, cageMat)
  roofMesh.position.y = 0.18
  roofMesh.name = 'spirit-lantern-roof'
  group.add(roofMesh)

  const strutGeo = getPooledGeometry(
    'item:spirit_lantern:strut',
    () => new THREE.CylinderGeometry(0.015, 0.015, 0.28, 6)
  )
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2
    const strut = new THREE.Mesh(strutGeo, cageMat)
    strut.position.set(Math.cos(angle) * 0.13, 0.01, Math.sin(angle) * 0.13)
    strut.name = `spirit-lantern-strut-${i}`
    group.add(strut)
  }

  const ringHandleGeo = getPooledGeometry(
    'item:spirit_lantern:handle',
    () => new THREE.TorusGeometry(0.065, 0.016, 6, 12)
  )
  const handle = new THREE.Mesh(ringHandleGeo, cageMat)
  handle.position.y = 0.28
  handle.rotation.x = Math.PI / 2
  handle.name = 'spirit-lantern-handle'
  group.add(handle)

  const emberGeo = getPooledGeometry(
    'item:spirit_lantern:ember',
    () => new THREE.OctahedronGeometry(0.095, 0)
  )
  const emberMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: COLLECTIBLE_PALETTE.spiritLanternPrimary,
    emissiveIntensity: 0.98,
    roughness: 0.1,
    metalness: 0.25,
  })
  const coreMesh = new THREE.Mesh(emberGeo, emberMat)
  coreMesh.position.y = 0.01
  coreMesh.name = 'spirit-lantern-ember'
  group.add(coreMesh)

  const haloGeo = getPooledGeometry(
    'item:halo',
    () => new THREE.TorusGeometry(0.36, 0.022, 8, 24)
  )
  const haloMat = getPooledMaterial(
    'item:spirit_lantern:halo',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.spiritLanternPrimary,
        emissive: COLLECTIBLE_PALETTE.spiritLanternPrimary,
        emissiveIntensity: 0.65,
        roughness: 0.2,
        metalness: 0.75,
      })
  )
  const haloMesh = new THREE.Mesh(haloGeo, haloMat)
  haloMesh.rotation.x = Math.PI / 2.2
  haloMesh.name = 'spirit-lantern-halo'
  group.add(haloMesh)

  const baseY = 0.92
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type: COLLECTIBLE_TYPES.SPIRIT_LANTERN,
    id,
    baseY,
    bobAmp: 0.11,
    bobFreq: 2.3,
    spinSpeed: 1.65,
    phaseOffset: computePhaseOffset(id, row, col),
    accentColor: COLLECTIBLE_PALETTE.spiritLanternPrimary,
    orbitRings: [haloMesh],
    coreMesh,
    coreMat: emberMat,
  }
}

/**
 * Builds a multi-part procedural 3D collectible item mesh supporting all collectible archetypes.
 */
export function buildCollectibleItemMesh(itemData = {}) {
  const type = itemData.type || COLLECTIBLE_TYPES.HEALTH_CAPSULE
  const id = itemData.id || `item-${type}-${itemData.row ?? 0}-${itemData.col ?? 0}`
  const group = new THREE.Group()
  group.name = `collectible-item-${type}-${id}`

  if (type === COLLECTIBLE_TYPES.HEALTH_CAPSULE) {
    buildHealthCapsuleParts(group, id, itemData.row, itemData.col)
    return group
  }
  if (type === COLLECTIBLE_TYPES.SOUL_SHARDS) {
    buildSoulShardParts(group, id, itemData.row, itemData.col)
    return group
  }
  if (type === COLLECTIBLE_TYPES.ENERGY_CELL) {
    buildEnergyCellParts(group, id, itemData.row, itemData.col)
    return group
  }
  if (type === COLLECTIBLE_TYPES.ECHO_REVEAL) {
    buildEchoRevealParts(group, id, itemData.row, itemData.col)
    return group
  }
  if (type === COLLECTIBLE_TYPES.TIME_FRAGMENT) {
    buildTimeFragmentParts(group, id, itemData.row, itemData.col)
    return group
  }
  if (type === COLLECTIBLE_TYPES.WATCHERS_EYE) {
    buildWatchersEyeParts(group, id, itemData.row, itemData.col)
    return group
  }
  if (type === COLLECTIBLE_TYPES.ECHO_PULSE) {
    buildEchoPulseParts(group, id, itemData.row, itemData.col)
    return group
  }
  if (type === COLLECTIBLE_TYPES.SPIRIT_LANTERN) {
    buildSpiritLanternParts(group, id, itemData.row, itemData.col)
    return group
  }

  let primaryColor = COLLECTIBLE_PALETTE.healthPrimary
  const coreColor = 0xffffff

  if (type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS) {
    primaryColor = COLLECTIBLE_PALETTE.compassPrimary
  } else if (type === COLLECTIBLE_TYPES.PHANTOM_VEIL) {
    primaryColor = COLLECTIBLE_PALETTE.veilPrimary
  } else if (type === COLLECTIBLE_TYPES.WARDING_CHARM) {
    primaryColor = COLLECTIBLE_PALETTE.wardingPrimary
  } else if (type === COLLECTIBLE_TYPES.TIME_FRAGMENT) {
    primaryColor = COLLECTIBLE_PALETTE.timePrimary
  } else if (type === COLLECTIBLE_TYPES.WATCHERS_EYE) {
    primaryColor = COLLECTIBLE_PALETTE.watchersPrimary
  } else if (type === COLLECTIBLE_TYPES.ECHO_PULSE) {
    primaryColor = COLLECTIBLE_PALETTE.echoPulsePrimary
  } else if (type === COLLECTIBLE_TYPES.SPIRIT_LANTERN) {
    primaryColor = COLLECTIBLE_PALETTE.spiritLanternPrimary
  }

  const bodyGeo = getPooledGeometry(
    `item:${type}:body`,
    () => new THREE.DodecahedronGeometry(0.24, 0)
  )
  const bodyMat = getPooledMaterial(
    `item:${type}:mat`,
    () =>
      new THREE.MeshStandardMaterial({
        color: primaryColor,
        emissive: primaryColor,
        emissiveIntensity: 0.45,
        roughness: 0.22,
        metalness: 0.65,
      })
  )
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
  bodyMesh.name = 'item-body'
  group.add(bodyMesh)

  const coreGeo = getPooledGeometry(
    `item:${type}:core`,
    () => new THREE.OctahedronGeometry(0.12, 0)
  )
  const coreMat = new THREE.MeshStandardMaterial({
    color: coreColor,
    emissive: coreColor,
    emissiveIntensity: 0.85,
    roughness: 0.1,
    metalness: 0.2,
  })
  const coreMesh = new THREE.Mesh(coreGeo, coreMat)
  coreMesh.name = 'item-core'
  group.add(coreMesh)

  const haloGeo = getPooledGeometry(
    'item:halo',
    () => new THREE.TorusGeometry(0.36, 0.022, 8, 24)
  )
  const haloMat = getPooledMaterial(
    `item:${type}:halo`,
    () =>
      new THREE.MeshStandardMaterial({
        color: primaryColor,
        emissive: primaryColor,
        emissiveIntensity: 0.6,
        roughness: 0.25,
        metalness: 0.8,
      })
  )
  const haloMesh = new THREE.Mesh(haloGeo, haloMat)
  haloMesh.rotation.x = Math.PI / 2.2
  haloMesh.name = 'item-halo'
  group.add(haloMesh)

  const baseY = 0.90
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'item',
    type,
    id,
    baseY,
    bobAmp: 0.12,
    bobFreq: 2.2,
    spinSpeed: 1.8,
    phaseOffset: computePhaseOffset(id, itemData.row, itemData.col),
    accentColor: primaryColor,
    orbitRings: [haloMesh],
    coreMesh,
    coreMat,
  }

  return group
}

/**
 * Builds Echo Reveal navigation breadcrumb markers.
 */
export function buildEchoMarkerMesh(cell = {}, index = 0, total = 1) {
  const isGoal = index === total - 1 && total > 1
  const group = new THREE.Group()
  group.name = `echo-marker-${cell.row ?? 0}-${cell.col ?? 0}`

  const moteGeo = getPooledGeometry(
    'echo:mote',
    () => new THREE.SphereGeometry(isGoal ? 0.2 : 0.14, 16, 16)
  )
  const color = isGoal ? COLLECTIBLE_PALETTE.echoPathFinal : COLLECTIBLE_PALETTE.echoPathStep
  const moteMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: isGoal ? 0.95 : 0.75,
    roughness: 0.15,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9,
  })
  const moteMesh = new THREE.Mesh(moteGeo, moteMat)
  moteMesh.position.y = 0.28
  group.add(moteMesh)

  const ringGeo = getPooledGeometry(
    'echo:ring',
    () => new THREE.RingGeometry(0.25, 0.32, 24)
  )
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  })
  const ringMesh = new THREE.Mesh(ringGeo, ringMat)
  ringMesh.rotation.x = -Math.PI / 2
  ringMesh.position.y = 0.05
  group.add(ringMesh)

  group.userData = {
    isGoal,
    index,
    phaseOffset: index * 0.45,
    moteMesh,
    ringMesh,
    ringMat,
    moteBaseY: 0.28,
  }

  return group
}

/**
 * Builds a multi-part procedural 3D Resonance Keycard / Node mesh.
 */
export function buildKeycardMesh(keycardData = {}) {
  const id =
    keycardData.id || `keycard-${keycardData.row ?? 0}-${keycardData.col ?? 0}`
  const group = new THREE.Group()
  group.name = `collectible-keycard-${id}`

  const bodyGeo = getPooledGeometry(
    'keycard:body',
    () => new THREE.BoxGeometry(0.44, 0.62, 0.055)
  )
  const bodyMat = getPooledMaterial(
    'keycard:body',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.keycardChassis,
        roughness: 0.42,
        metalness: 0.78,
      })
  )
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
  bodyMesh.name = 'keycard-chassis'
  group.add(bodyMesh)

  const frameGeo = getPooledGeometry(
    'keycard:frame',
    () => new THREE.BoxGeometry(0.48, 0.66, 0.032)
  )
  const frameMat = getPooledMaterial(
    'keycard:frame',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.keycardPrimary,
        emissive: COLLECTIBLE_PALETTE.keycardPrimary,
        emissiveIntensity: 0.52,
        roughness: 0.22,
        metalness: 0.86,
      })
  )
  const frameMesh = new THREE.Mesh(frameGeo, frameMat)
  frameMesh.name = 'keycard-trim-frame'
  group.add(frameMesh)

  const coreGeo = getPooledGeometry(
    'keycard:core',
    () => new THREE.OctahedronGeometry(0.145, 0)
  )
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xe0f2fe,
    emissive: COLLECTIBLE_PALETTE.keycardCore,
    emissiveIntensity: 0.95,
    roughness: 0.12,
    metalness: 0.2,
  })
  const coreMesh = new THREE.Mesh(coreGeo, coreMat)
  coreMesh.scale.set(0.9, 1.15, 0.7)
  coreMesh.position.y = 0.05
  coreMesh.name = 'keycard-core-gem'
  group.add(coreMesh)

  const chipGeo = getPooledGeometry(
    'keycard:chip',
    () => new THREE.BoxGeometry(0.16, 0.11, 0.068)
  )
  const chipMat = getPooledMaterial(
    'keycard:chip',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.keycardChip,
        emissive: COLLECTIBLE_PALETTE.keycardChip,
        emissiveIntensity: 0.25,
        roughness: 0.25,
        metalness: 0.9,
      })
  )
  const chipMesh = new THREE.Mesh(chipGeo, chipMat)
  chipMesh.position.set(0, -0.17, 0)
  chipMesh.name = 'keycard-contact-chip'
  group.add(chipMesh)

  const haloGeo = getPooledGeometry(
    'keycard:halo',
    () => new THREE.TorusGeometry(0.42, 0.024, 8, 28)
  )
  const haloMat = getPooledMaterial(
    'keycard:halo',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.keycardCore,
        emissive: COLLECTIBLE_PALETTE.keycardPrimary,
        emissiveIntensity: 0.75,
        roughness: 0.2,
        metalness: 0.55,
      })
  )
  const haloMesh = new THREE.Mesh(haloGeo, haloMat)
  haloMesh.rotation.set(Math.PI / 2.6, 0.25, 0)
  haloMesh.name = 'keycard-orbital-halo'
  group.add(haloMesh)

  const baseY = 1.02
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'keycard',
    id,
    baseY,
    bobAmp: 0.15,
    bobFreq: 2.2,
    spinSpeed: 1.5,
    phaseOffset: computePhaseOffset(id, keycardData.row, keycardData.col),
    accentColor: COLLECTIBLE_PALETTE.keycardPrimary,
    orbitRings: [haloMesh],
    coreMesh,
    coreMat,
  }

  return group
}

function resolveBurstColor(kind) {
  if (kind === COLLECTIBLE_TYPES.HEALTH_CAPSULE) {
    return COLLECTIBLE_PALETTE.healthPrimary
  }
  if (kind === COLLECTIBLE_TYPES.SOUL_SHARDS) {
    return COLLECTIBLE_PALETTE.soulPrimary
  }
  if (kind === COLLECTIBLE_TYPES.ENERGY_CELL) {
    return COLLECTIBLE_PALETTE.energyPrimary
  }
  if (kind === COLLECTIBLE_TYPES.ECHO_REVEAL || kind === COLLECTIBLE_TYPES.ECHO_PULSE) {
    return COLLECTIBLE_PALETTE.echoPulsePrimary
  }
  if (kind === 'keycard' || kind === 'resonance_keycard') {
    return COLLECTIBLE_PALETTE.keycardPrimary
  }
  if (kind === 'gate_unlock') {
    return COLLECTIBLE_PALETTE.gateUnlock
  }
  return COLLECTIBLE_PALETTE.soulPrimary
}

export function buildCollectionBurst(kind = 'item', worldPos = { x: 0, y: 1, z: 0 }) {
  const group = new THREE.Group()
  group.name = `collection-burst-${kind}`

  const count = 10
  const color = resolveBurstColor(kind)
  const particleGeo = getPooledGeometry(
    'burst:particle',
    () => new THREE.SphereGeometry(0.06, 8, 8)
  )
  const particleMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
  })

  const particles = []
  const velocities = []

  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(particleGeo, particleMat)
    const theta = (i / count) * Math.PI * 2
    const phi = (Math.random() - 0.5) * Math.PI
    const speed = 1.2 + Math.random() * 1.6

    velocities.push(
      new THREE.Vector3(
        Math.cos(theta) * Math.cos(phi) * speed,
        Math.sin(phi) * speed + 1.5,
        Math.sin(theta) * Math.cos(phi) * speed
      )
    )

    mesh.position.set(0, 0.2, 0)
    group.add(mesh)
    particles.push(mesh)
  }

  group.position.set(worldPos.x, worldPos.y, worldPos.z)
  group.userData = {
    kind,
    elapsed: 0,
    duration: 0.46,
    particles,
    velocities,
    material: particleMat,
  }

  return group
}

export function updateCollectionBurst(group, progress) {
  if (!group || !group.userData) return
  const { particles, velocities } = group.userData
  const dt = 0.016

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const v = velocities[i]
    p.position.addScaledVector(v, dt)
    v.y -= 3.5 * dt
  }

  const mat = group.userData.material
  if (mat) {
    mat.opacity = Math.max(0, 1 - Math.max(0, Math.min(1, progress)))
  }
}

export function resetCollectionBurst(
  group,
  kindOrWorldPos = 'item',
  maybeWorldPos = null
) {
  if (!group) return
  const hasExplicitKind = typeof kindOrWorldPos === 'string'
  const resolvedKind = hasExplicitKind ? kindOrWorldPos : group.userData?.kind || 'item'
  const resolvedWorldPos = hasExplicitKind
    ? maybeWorldPos || { x: 0, y: 1, z: 0 }
    : kindOrWorldPos || { x: 0, y: 1, z: 0 }

  group.name = `collection-burst-${resolvedKind}`
  group.position.set(resolvedWorldPos.x, resolvedWorldPos.y, resolvedWorldPos.z)
  group.userData.kind = resolvedKind
  group.userData.elapsed = 0
  const { particles, velocities, material } = group.userData

  if (material) {
    material.color?.setHex?.(resolveBurstColor(resolvedKind))
    material.opacity = 1
  }

  for (let i = 0; i < particles.length; i += 1) {
    particles[i].position.set(0, 0.2, 0)
    const theta = (i / particles.length) * Math.PI * 2
    const phi = (Math.random() - 0.5) * Math.PI
    const speed = 1.2 + Math.random() * 1.6
    velocities[i].set(
      Math.cos(theta) * Math.cos(phi) * speed,
      Math.sin(phi) * speed + 1.5,
      Math.sin(theta) * Math.cos(phi) * speed
    )
  }
  group.visible = true
}
