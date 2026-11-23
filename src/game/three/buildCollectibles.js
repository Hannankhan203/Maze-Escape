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
 * Builds a multi-part procedural 3D collectible item mesh supporting all upcoming collectible archetypes.
 */
export function buildCollectibleItemMesh(itemData = {}) {
  const type = itemData.type || COLLECTIBLE_TYPES.HEALTH_CAPSULE
  const id = itemData.id || `item-${type}-${itemData.row ?? 0}-${itemData.col ?? 0}`
  const group = new THREE.Group()
  group.name = `collectible-item-${type}-${id}`

  let primaryColor = COLLECTIBLE_PALETTE.healthPrimary
  let coreColor = 0xffffff

  if (type === COLLECTIBLE_TYPES.SOUL_SHARDS) {
    primaryColor = COLLECTIBLE_PALETTE.soulPrimary
    coreColor = COLLECTIBLE_PALETTE.soulCore
  } else if (type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS) {
    primaryColor = COLLECTIBLE_PALETTE.compassPrimary
  } else if (type === COLLECTIBLE_TYPES.PHANTOM_VEIL) {
    primaryColor = COLLECTIBLE_PALETTE.veilPrimary
  } else if (type === COLLECTIBLE_TYPES.ENERGY_CELL) {
    primaryColor = COLLECTIBLE_PALETTE.energyPrimary
  } else if (type === COLLECTIBLE_TYPES.WARDING_CHARM) {
    primaryColor = COLLECTIBLE_PALETTE.wardingPrimary
  } else if (type === COLLECTIBLE_TYPES.TIME_FRAGMENT) {
    primaryColor = COLLECTIBLE_PALETTE.timePrimary
  } else if (type === COLLECTIBLE_TYPES.WATCHERS_EYE) {
    primaryColor = COLLECTIBLE_PALETTE.watchersPrimary
  } else if (type === COLLECTIBLE_TYPES.ECHO_PULSE || type === COLLECTIBLE_TYPES.ECHO_REVEAL) {
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
    'item:halo',
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
  const particleGeo = new THREE.SphereGeometry(0.06, 8, 8)
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
  const { particles, velocities, duration } = group.userData
  const dt = 0.016

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const v = velocities[i]
    p.position.addScaledVector(v, dt)
    v.y -= 3.5 * dt
  }

  const mat = group.userData.material
  if (mat) {
    mat.opacity = Math.max(0, 1 - progress / duration)
  }
}

export function resetCollectionBurst(group, worldPos = { x: 0, y: 1, z: 0 }) {
  if (!group) return
  group.position.set(worldPos.x, worldPos.y, worldPos.z)
  group.userData.elapsed = 0
  const { particles, velocities, material } = group.userData

  if (material) {
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
