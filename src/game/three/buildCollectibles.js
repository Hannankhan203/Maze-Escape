import * as THREE from 'three'
import { POWERUP_TYPES } from '../mechanics/powerups.js'
import {
  isSharedResource,
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

export const COLLECTIBLE_PALETTE = {
  coinRim: 0xd97706,
  coinFace: 0xf59e0b,
  coinCore: 0xfef08a,
  coinGlow: 0xfbbf24,

  wallPassPrimary: 0x818cf8,
  wallPassTrim: 0x312e81,
  wallPassCore: 0xe0e7ff,

  echoPrimary: 0x38bdf8,
  echoTrim: 0x0369a1,
  echoCore: 0xe0f2fe,

  magnetPrimary: 0x10b981,
  magnetTrim: 0xcbd5e1,
  magnetFlux: 0x6ee7b7,

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

/**
 * Computes a deterministic phase offset [0, 2*PI) from a string ID or grid coords.
 */
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
 * Builds a multi-part procedural 3D Vault Coin mesh with beveled gold rim,
 * embossed face disc, and luminous jewel core.
 */
export function buildCoinMesh(coinData = {}) {
  const group = new THREE.Group()
  const id = coinData.id || `coin-${coinData.row ?? 0}-${coinData.col ?? 0}`
  group.name = `collectible-coin-${id}`

  // Outer beveled metallic rim (shared static geometry & material)
  const rimGeo = getPooledGeometry(
    'coin:rim',
    () => new THREE.TorusGeometry(0.32, 0.065, 12, 28)
  )
  const rimMat = getPooledMaterial(
    'coin:rim',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.coinRim,
        emissive: COLLECTIBLE_PALETTE.coinRim,
        emissiveIntensity: 0.25,
        roughness: 0.25,
        metalness: 0.88,
      })
  )
  const rimMesh = new THREE.Mesh(rimGeo, rimMat)
  rimMesh.name = 'coin-rim'
  group.add(rimMesh)

  // Inner stamped gold disc (aligned upright inside the torus)
  const faceGeo = getPooledGeometry(
    'coin:face',
    () => new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20)
  )
  const faceMat = getPooledMaterial(
    'coin:face',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.coinFace,
        emissive: COLLECTIBLE_PALETTE.coinGlow,
        emissiveIntensity: 0.28,
        roughness: 0.32,
        metalness: 0.8,
      })
  )
  const faceMesh = new THREE.Mesh(faceGeo, faceMat)
  faceMesh.rotation.x = Math.PI / 2
  faceMesh.name = 'coin-face'
  group.add(faceMesh)

  // Radiant center gem prism
  const gemGeo = getPooledGeometry(
    'coin:gem',
    () => new THREE.OctahedronGeometry(0.11, 0)
  )
  const gemMat = getPooledMaterial(
    'coin:gem',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.coinCore,
        emissive: COLLECTIBLE_PALETTE.coinGlow,
        emissiveIntensity: 0.72,
        roughness: 0.14,
        metalness: 0.3,
      })
  )
  const gemMesh = new THREE.Mesh(gemGeo, gemMat)
  gemMesh.scale.set(0.95, 1.1, 0.65)
  gemMesh.name = 'coin-core-gem'
  group.add(gemMesh)

  const baseY = 0.82
  group.position.y = baseY

  group.userData = {
    collectibleKind: 'coin',
    id,
    baseY,
    bobAmp: 0.11,
    bobFreq: 2.4,
    spinSpeed: 2.1,
    phaseOffset: computePhaseOffset(id, coinData.row, coinData.col),
    accentColor: COLLECTIBLE_PALETTE.coinGlow,
  }

  return group
}

/**
 * Builds distinct multi-part procedural 3D meshes for Wall Pass, Echo Reveal,
 * and Coin Magnet power-ups.
 */
export function buildPowerUpMesh(powerUpData = {}) {
  const type = powerUpData.type || POWERUP_TYPES.WALL_PASS
  const id =
    powerUpData.id || `pu-${type}-${powerUpData.row ?? 0}-${powerUpData.col ?? 0}`
  const group = new THREE.Group()
  group.name = `collectible-powerup-${type}-${id}`

  let accentColor
  let spinSpeed

  if (type === POWERUP_TYPES.ECHO_REVEAL) {
    accentColor = COLLECTIBLE_PALETTE.echoPrimary
    spinSpeed = 1.9

    const eyeGeo = getPooledGeometry(
      'pu:echo:eye',
      () => new THREE.SphereGeometry(0.18, 16, 14)
    )
    const eyeMat = getPooledMaterial(
      'pu:echo:eye',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.echoCore,
          emissive: COLLECTIBLE_PALETTE.echoPrimary,
          emissiveIntensity: 0.85,
          roughness: 0.12,
          metalness: 0.2,
        })
    )
    const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat)
    eyeMesh.name = 'echo-core-sphere'
    group.add(eyeMesh)

    const cageGeo = getPooledGeometry(
      'pu:echo:cage',
      () => new THREE.OctahedronGeometry(0.32, 0)
    )
    const cageMat = getPooledMaterial(
      'pu:echo:cage',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.echoPrimary,
          emissive: COLLECTIBLE_PALETTE.echoTrim,
          emissiveIntensity: 0.45,
          roughness: 0.25,
          metalness: 0.55,
          wireframe: true,
        })
    )
    const cageMesh = new THREE.Mesh(cageGeo, cageMat)
    cageMesh.name = 'echo-cage'
    group.add(cageMesh)

    const ringGeo = getPooledGeometry(
      'pu:echo:ring',
      () => new THREE.TorusGeometry(0.42, 0.032, 8, 28)
    )
    const ringMat = getPooledMaterial(
      'pu:echo:ring',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.echoPrimary,
          emissive: COLLECTIBLE_PALETTE.echoPrimary,
          emissiveIntensity: 0.6,
          roughness: 0.3,
          metalness: 0.65,
        })
    )
    const ringA = new THREE.Mesh(ringGeo, ringMat)
    ringA.rotation.set(Math.PI / 3, 0.3, 0)
    ringA.name = 'echo-orbit-a'
    group.add(ringA)

    const ringB = new THREE.Mesh(ringGeo, ringMat)
    ringB.rotation.set(-Math.PI / 3, -0.3, Math.PI / 4)
    ringB.scale.setScalar(0.84)
    ringB.name = 'echo-orbit-b'
    group.add(ringB)

    group.userData.orbitRings = [ringA, ringB]
  } else if (type === POWERUP_TYPES.COIN_MAGNET) {
    accentColor = COLLECTIBLE_PALETTE.magnetPrimary
    spinSpeed = 1.75

    const archGeo = getPooledGeometry(
      'pu:magnet:arch',
      () => new THREE.TorusGeometry(0.24, 0.075, 12, 22, Math.PI)
    )
    const bodyMat = getPooledMaterial(
      'pu:magnet:body',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.magnetPrimary,
          emissive: COLLECTIBLE_PALETTE.magnetPrimary,
          emissiveIntensity: 0.38,
          roughness: 0.3,
          metalness: 0.72,
        })
    )
    const archMesh = new THREE.Mesh(archGeo, bodyMat)
    archMesh.position.y = 0.08
    archMesh.name = 'magnet-arch'
    group.add(archMesh)

    const armGeo = getPooledGeometry(
      'pu:magnet:arm',
      () => new THREE.CylinderGeometry(0.075, 0.075, 0.24, 12)
    )
    const capGeo = getPooledGeometry(
      'pu:magnet:cap',
      () => new THREE.CylinderGeometry(0.082, 0.082, 0.1, 12)
    )
    const capMat = getPooledMaterial(
      'pu:magnet:cap',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.magnetTrim,
          emissive: COLLECTIBLE_PALETTE.magnetFlux,
          emissiveIntensity: 0.48,
          roughness: 0.22,
          metalness: 0.88,
        })
    )

    const leftArm = new THREE.Mesh(armGeo, bodyMat)
    leftArm.position.set(-0.24, -0.04, 0)
    leftArm.name = 'magnet-arm-left'
    group.add(leftArm)

    const rightArm = new THREE.Mesh(armGeo, bodyMat)
    rightArm.position.set(0.24, -0.04, 0)
    rightArm.name = 'magnet-arm-right'
    group.add(rightArm)

    const leftCap = new THREE.Mesh(capGeo, capMat)
    leftCap.position.set(-0.24, -0.19, 0)
    leftCap.name = 'magnet-cap-left'
    group.add(leftCap)

    const rightCap = new THREE.Mesh(capGeo, capMat)
    rightCap.position.set(0.24, -0.19, 0)
    rightCap.name = 'magnet-cap-right'
    group.add(rightCap)

    const fluxGeo = getPooledGeometry(
      'pu:magnet:flux',
      () => new THREE.TorusGeometry(0.42, 0.028, 8, 28)
    )
    const fluxMat = getPooledMaterial(
      'pu:magnet:flux',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.magnetFlux,
          emissive: COLLECTIBLE_PALETTE.magnetFlux,
          emissiveIntensity: 0.7,
          roughness: 0.2,
          metalness: 0.4,
        })
    )
    const fluxRing = new THREE.Mesh(fluxGeo, fluxMat)
    fluxRing.rotation.x = Math.PI / 2 - 0.25
    fluxRing.name = 'magnet-flux-ring'
    group.add(fluxRing)

    group.userData.orbitRings = [fluxRing]
  } else {
    accentColor = COLLECTIBLE_PALETTE.wallPassPrimary
    spinSpeed = 1.5

    const prismGeo = getPooledGeometry(
      'pu:wallpass:prism',
      () => new THREE.OctahedronGeometry(0.26, 0)
    )
    const prismMat = getPooledMaterial(
      'pu:wallpass:prism',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.wallPassPrimary,
          emissive: COLLECTIBLE_PALETTE.wallPassPrimary,
          emissiveIntensity: 0.65,
          roughness: 0.18,
          metalness: 0.48,
        })
    )
    const prismMesh = new THREE.Mesh(prismGeo, prismMat)
    prismMesh.scale.set(0.85, 1.55, 0.85)
    prismMesh.name = 'wallpass-prism'
    group.add(prismMesh)

    const rodGeo = getPooledGeometry(
      'pu:wallpass:rod',
      () => new THREE.CylinderGeometry(0.05, 0.05, 0.68, 10)
    )
    const rodMat = getPooledMaterial(
      'pu:wallpass:rod',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.wallPassCore,
          emissive: COLLECTIBLE_PALETTE.wallPassCore,
          emissiveIntensity: 0.85,
          roughness: 0.15,
          metalness: 0.2,
        })
    )
    const rodMesh = new THREE.Mesh(rodGeo, rodMat)
    rodMesh.name = 'wallpass-core-rod'
    group.add(rodMesh)

    const ringGeo = getPooledGeometry(
      'pu:wallpass:ring',
      () => new THREE.TorusGeometry(0.38, 0.04, 10, 28)
    )
    const ringMat = getPooledMaterial(
      'pu:wallpass:ring',
      () =>
        new THREE.MeshStandardMaterial({
          color: COLLECTIBLE_PALETTE.wallPassTrim,
          emissive: COLLECTIBLE_PALETTE.wallPassPrimary,
          emissiveIntensity: 0.45,
          roughness: 0.35,
          metalness: 0.78,
        })
    )
    const outerRing = new THREE.Mesh(ringGeo, ringMat)
    outerRing.rotation.y = Math.PI / 4
    outerRing.name = 'wallpass-gate-ring'
    group.add(outerRing)

    const haloGeo = getPooledGeometry(
      'pu:wallpass:halo',
      () => new THREE.TorusGeometry(0.45, 0.025, 8, 28)
    )
    const haloMesh = new THREE.Mesh(haloGeo, prismMat)
    haloMesh.rotation.x = Math.PI / 2
    haloMesh.position.y = -0.25
    haloMesh.name = 'wallpass-halo'
    group.add(haloMesh)

    group.userData.orbitRings = [outerRing, haloMesh]
  }

  const baseY = 0.96
  group.position.y = baseY

  group.userData = {
    ...group.userData,
    collectibleKind: 'powerup',
    powerUpType: type,
    id,
    baseY,
    bobAmp: 0.14,
    bobFreq: 2.0,
    spinSpeed,
    phaseOffset: computePhaseOffset(id, powerUpData.row, powerUpData.col),
    accentColor,
  }

  return group
}

/**
 * Builds a single Echo Reveal 3D breadcrumb marker (floor sonar ring + floating mote).
 */
export function buildEchoMarkerMesh(cell = {}, index = 0, total = 1) {
  const row = cell.row ?? 0
  const col = cell.col ?? 0
  const isGoal = index === Math.max(0, total - 1) && total > 1
  const color = isGoal
    ? COLLECTIBLE_PALETTE.echoPathFinal
    : COLLECTIBLE_PALETTE.echoPathStep

  const group = new THREE.Group()
  group.name = `echo-marker-${row}-${col}`

  const ringGeo = getPooledGeometry(
    isGoal ? 'echo:ring:goal' : 'echo:ring:step',
    () => new THREE.TorusGeometry(isGoal ? 0.42 : 0.28, 0.035, 8, 24)
  )
  // Instance-owned material because each breadcrumb ring animates opacity per phase
  const ringMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: isGoal ? 0.9 : 0.7,
    roughness: 0.22,
    metalness: 0.25,
    transparent: true,
    opacity: 0.85,
  })
  const ringMesh = new THREE.Mesh(ringGeo, ringMat)
  ringMesh.rotation.x = Math.PI / 2
  ringMesh.position.y = 0.07
  ringMesh.name = 'echo-floor-ring'
  group.add(ringMesh)

  const moteGeo = getPooledGeometry(
    isGoal ? 'echo:mote:goal' : 'echo:mote:step',
    () => new THREE.OctahedronGeometry(isGoal ? 0.16 : 0.1, 0)
  )
  const moteMat = getPooledMaterial(
    isGoal ? 'echo:mote:goal' : 'echo:mote:step',
    () =>
      new THREE.MeshStandardMaterial({
        color: COLLECTIBLE_PALETTE.echoCore,
        emissive: color,
        emissiveIntensity: 0.95,
        roughness: 0.15,
        metalness: 0.2,
        transparent: true,
        opacity: 0.92,
      })
  )
  const moteMesh = new THREE.Mesh(moteGeo, moteMat)
  moteMesh.position.y = isGoal ? 0.42 : 0.28
  moteMesh.name = 'echo-mote'
  group.add(moteMesh)

  group.userData = {
    row,
    col,
    index,
    isGoal,
    ringMesh,
    ringMat,
    moteMesh,
    moteMat,
    moteBaseY: isGoal ? 0.42 : 0.28,
    phaseOffset: index * 0.45,
  }

  return group
}

/**
 * Builds a multi-part procedural 3D Resonance Keycard / Node mesh with dark
 * metallic chassis, cyan resonance trim frame, gold contact chip, diamond
 * data core, and tilted orbital resonance halo.
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

  // Central luminous Resonance Core Diamond (instance-owned material for per-card glow)
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
  if (kind === POWERUP_TYPES.WALL_PASS || kind === 'wall_pass') {
    return COLLECTIBLE_PALETTE.wallPassPrimary
  }
  if (kind === POWERUP_TYPES.ECHO_REVEAL || kind === 'echo_reveal') {
    return COLLECTIBLE_PALETTE.echoPrimary
  }
  if (kind === POWERUP_TYPES.COIN_MAGNET || kind === 'coin_magnet') {
    return COLLECTIBLE_PALETTE.magnetFlux
  }
  return COLLECTIBLE_PALETTE.coinGlow
}

/**
 * Builds an ephemeral procedural 3D burst effect (expanding pulse ring + rising shards)
 * when a coin, power-up, or Wall Pass is triggered.
 */
export function buildCollectionBurst(kind = 'coin', worldPos = { x: 0, y: 0.85, z: 0 }) {
  const color = resolveBurstColor(kind)
  const group = new THREE.Group()
  group.name = `collectible-burst-${kind}`
  group.position.set(
    Number(worldPos?.x) || 0,
    Number.isFinite(worldPos?.y) ? worldPos.y : 0.85,
    Number(worldPos?.z) || 0
  )

  const ringGeo = getPooledGeometry(
    'burst:ring',
    () => new THREE.TorusGeometry(0.32, 0.04, 8, 24)
  )
  // Instance-owned fade materials
  const ringMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.95,
    roughness: 0.2,
    metalness: 0.2,
    transparent: true,
    opacity: 0.92,
  })
  const ringMesh = new THREE.Mesh(ringGeo, ringMat)
  ringMesh.rotation.x = Math.PI / 2
  group.add(ringMesh)

  const shardGeo = getPooledGeometry(
    'burst:shard',
    () => new THREE.OctahedronGeometry(0.065, 0)
  )
  const shardMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: color,
    emissiveIntensity: 1.0,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.95,
  })

  const shards = []
  const count = 6
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2
    const shard = new THREE.Mesh(shardGeo, shardMat)
    shard.userData = {
      vx: Math.cos(angle) * 1.45,
      vy: 0.95 + (i % 2) * 0.4,
      vz: Math.sin(angle) * 1.45,
    }
    group.add(shard)
    shards.push(shard)
  }

  group.userData = {
    kind,
    elapsed: 0,
    duration: 0.46,
    ringMesh,
    ringMat,
    shardMat,
    shards,
  }

  return group
}

/**
 * Resets a pooled collection burst group for clean reuse with a new kind and position.
 */
export function resetCollectionBurst(
  burstGroup,
  kind = 'coin',
  worldPos = { x: 0, y: 0.85, z: 0 }
) {
  if (!burstGroup) return null
  const color = resolveBurstColor(kind)

  burstGroup.name = `collectible-burst-${kind}`
  burstGroup.visible = true
  burstGroup.position.set(
    Number(worldPos?.x) || 0,
    Number.isFinite(worldPos?.y) ? worldPos.y : 0.85,
    Number(worldPos?.z) || 0
  )
  burstGroup.rotation.set(0, 0, 0)
  burstGroup.scale.set(1, 1, 1)

  const ud = burstGroup.userData
  if (ud) {
    ud.kind = kind
    ud.elapsed = 0
    ud.duration = 0.46

    if (ud.ringMesh) {
      ud.ringMesh.position.set(0, 0, 0)
      ud.ringMesh.rotation.set(Math.PI / 2, 0, 0)
      ud.ringMesh.scale.setScalar(1)
    }
    if (ud.ringMat) {
      ud.ringMat.color?.setHex?.(color)
      ud.ringMat.emissive?.setHex?.(color)
      ud.ringMat.opacity = 0.92
    }
    if (ud.shardMat) {
      ud.shardMat.color?.setHex?.(0xffffff)
      ud.shardMat.emissive?.setHex?.(color)
      ud.shardMat.opacity = 0.95
    }
    if (Array.isArray(ud.shards)) {
      for (let i = 0; i < ud.shards.length; i += 1) {
        const shard = ud.shards[i]
        shard.position.set(0, 0, 0)
        shard.rotation.set(0, 0, 0)
        shard.scale.setScalar(1)
      }
    }
  }

  return burstGroup
}

/**
 * Animates a collection burst for `progress` in [0, 1].
 */
export function updateCollectionBurst(burstGroup, progress) {
  if (!burstGroup?.userData) return
  const t = Math.max(0, Math.min(1, progress))
  const easeOut = 1 - Math.pow(1 - t, 2)
  const fade = Math.max(0, 1 - t)

  const { ringMesh, ringMat, shardMat, shards } = burstGroup.userData
  if (ringMesh) {
    const scale = 0.75 + easeOut * 1.85
    ringMesh.scale.setScalar(scale)
    ringMesh.position.y = easeOut * 0.25
  }
  if (ringMat) {
    ringMat.opacity = fade * 0.92
  }
  if (shardMat) {
    shardMat.opacity = fade
  }
  if (Array.isArray(shards)) {
    for (let i = 0; i < shards.length; i += 1) {
      const shard = shards[i]
      const v = shard.userData
      shard.position.set(v.vx * easeOut, v.vy * easeOut, v.vz * easeOut)
      shard.rotation.x += 0.16
      shard.rotation.y += 0.2
      shard.scale.setScalar(Math.max(0.1, 1 - t * 0.75))
    }
  }
}
