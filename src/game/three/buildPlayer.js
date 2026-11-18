import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'

export const PLAYER_PALETTE = {
  coat: 0x1b2330,
  trousers: 0x101620,
  gear: 0x28221e,
  hardware: 0x4b586e,
  mask: 0x141b24,
  accent: 0x818cf8,
  accentEmissive: 0x6366f1,
}

export const DEFAULT_PLAYER_MODEL_CONFIG = {
  height: 1.8,
  eyeHeight: 1.65,
  radius: 0.34,
  accentEmissiveIntensity: 0.26,
}

function createPlayerMaterials(config) {
  const coat = new THREE.MeshStandardMaterial({
    color: PLAYER_PALETTE.coat,
    roughness: 0.88,
    metalness: 0.08,
  })

  const trousers = new THREE.MeshStandardMaterial({
    color: PLAYER_PALETTE.trousers,
    roughness: 0.92,
    metalness: 0.06,
  })

  const gear = new THREE.MeshStandardMaterial({
    color: PLAYER_PALETTE.gear,
    roughness: 0.8,
    metalness: 0.12,
  })

  const hardware = new THREE.MeshStandardMaterial({
    color: PLAYER_PALETTE.hardware,
    roughness: 0.42,
    metalness: 0.65,
  })

  const mask = new THREE.MeshStandardMaterial({
    color: PLAYER_PALETTE.mask,
    roughness: 0.72,
    metalness: 0.22,
  })

  const accent = new THREE.MeshStandardMaterial({
    color: PLAYER_PALETTE.accent,
    emissive: PLAYER_PALETTE.accentEmissive,
    emissiveIntensity: config.accentEmissiveIntensity,
    roughness: 0.35,
    metalness: 0.25,
  })

  return { coat, trousers, gear, hardware, mask, accent }
}

/**
 * Updates a player group's world-space position (and optional Y-axis yaw)
 * without rebuilding geometry or touching maze meshes.
 * Accepts `(playerGroup, x, y, z, yaw)` or `(playerGroup, { x, y, z }, yaw)`.
 */
export function positionPlayerAtWorld(
  playerGroup,
  xOrVec,
  yOrYaw = 0,
  z = 0,
  yaw = undefined
) {
  if (!playerGroup || !playerGroup.position) {
    return null
  }

  let nextX = playerGroup.position.x
  let nextY = playerGroup.position.y
  let nextZ = playerGroup.position.z
  let nextYaw = yaw

  if (xOrVec && typeof xOrVec === 'object') {
    if (Number.isFinite(xOrVec.x)) nextX = xOrVec.x
    if (Number.isFinite(xOrVec.y)) nextY = xOrVec.y
    if (Number.isFinite(xOrVec.z)) nextZ = xOrVec.z
    if (Number.isFinite(yOrYaw) && yaw === undefined) {
      nextYaw = yOrYaw
    }
  } else if (
    Number.isFinite(xOrVec) &&
    Number.isFinite(yOrYaw) &&
    Number.isFinite(z)
  ) {
    nextX = xOrVec
    nextY = yOrYaw
    nextZ = z
  } else {
    return null
  }

  playerGroup.position.set(nextX, nextY, nextZ)
  if (Number.isFinite(nextYaw)) {
    playerGroup.rotation.y = nextYaw
  }

  return {
    x: playerGroup.position.x,
    y: playerGroup.position.y,
    z: playerGroup.position.z,
  }
}

/**
 * Positions a player group at grid `(row, col)` using canonical `gridToWorld()`.
 * Returns the resolved world coordinates or `null` if the target cell/maze is invalid.
 */
export function positionPlayerAtGrid(
  playerGroup,
  row,
  col,
  maze,
  options = {}
) {
  if (!playerGroup) return null

  const worldPos = gridToWorld(row, col, maze)
  if (!worldPos) {
    return null
  }

  const y = Number.isFinite(options?.y) ? options.y : 0
  const yaw = Number.isFinite(options?.yaw) ? options.yaw : undefined

  return positionPlayerAtWorld(playerGroup, worldPos.x, y, worldPos.z, yaw)
}

/**
 * Builds a lightweight, procedural dark survival/adventure 3D humanoid character.
 * Oriented in local space facing `-Z` so `rotation.y = yaw` matches CameraRig.
 *
 * @param {object} [options]
 * @param {object|null} [options.maze=null] - Optional maze used for `gridToWorld()` spawn placement.
 * @param {{row: number, col: number}|null} [options.spawnCell=null] - Optional grid spawn cell (defaults to `maze.start`).
 * @param {{x: number, y?: number, z: number}|null} [options.position=null] - Optional explicit world position override.
 * @param {number} [options.yaw=0] - Initial Y-axis facing angle in radians.
 * @param {boolean} [options.visible=true] - Initial model visibility.
 * @param {object} [options.config] - Visual overrides merged with `DEFAULT_PLAYER_MODEL_CONFIG`.
 */
export function buildPlayer(options = {}) {
  const config = {
    ...DEFAULT_PLAYER_MODEL_CONFIG,
    ...(options?.config || {}),
  }

  const root = new THREE.Group()
  root.name = 'maze-player-root'
  root.visible = options?.visible !== false

  const mats = createPlayerMaterials(config)

  // --- Lower body: boots & trousers (shared left/right geometries) ---
  const bootGeo = new THREE.BoxGeometry(0.14, 0.14, 0.24)
  const legGeo = new THREE.CylinderGeometry(0.082, 0.068, 0.72, 10)
  const hipSides = [-0.11, 0.11]

  for (let i = 0; i < hipSides.length; i += 1) {
    const sideX = hipSides[i]
    const sideTag = i === 0 ? 'left' : 'right'

    const boot = new THREE.Mesh(bootGeo, mats.trousers)
    boot.name = `maze-player-boot-${sideTag}`
    boot.position.set(sideX, 0.07, -0.03)
    root.add(boot)

    const leg = new THREE.Mesh(legGeo, mats.trousers)
    leg.name = `maze-player-leg-${sideTag}`
    leg.position.set(sideX, 0.5, 0)
    root.add(leg)
  }

  // --- Torso: weathered field coat, harness, belt & utility beacon ---
  const coatSkirtGeo = new THREE.CylinderGeometry(0.195, 0.235, 0.28, 12)
  const coatSkirt = new THREE.Mesh(coatSkirtGeo, mats.coat)
  coatSkirt.name = 'maze-player-coat-skirt'
  coatSkirt.position.set(0, 0.86, 0.01)
  root.add(coatSkirt)

  const torsoGeo = new THREE.CylinderGeometry(0.215, 0.185, 0.54, 12)
  const torso = new THREE.Mesh(torsoGeo, mats.coat)
  torso.name = 'maze-player-torso'
  torso.position.set(0, 1.18, 0)
  root.add(torso)

  const beltGeo = new THREE.CylinderGeometry(0.202, 0.202, 0.065, 12)
  const belt = new THREE.Mesh(beltGeo, mats.gear)
  belt.name = 'maze-player-belt'
  belt.position.set(0, 0.95, 0)
  root.add(belt)

  const buckleGeo = new THREE.BoxGeometry(0.08, 0.075, 0.04)
  const buckle = new THREE.Mesh(buckleGeo, mats.hardware)
  buckle.name = 'maze-player-buckle'
  buckle.position.set(0, 0.95, -0.195)
  root.add(buckle)

  const strapGeo = new THREE.BoxGeometry(0.055, 0.48, 0.39)
  const chestStrap = new THREE.Mesh(strapGeo, mats.gear)
  chestStrap.name = 'maze-player-harness-strap'
  chestStrap.position.set(0, 1.19, 0)
  chestStrap.rotation.z = 0.36
  root.add(chestStrap)

  const beaconHousingGeo = new THREE.BoxGeometry(0.06, 0.08, 0.04)
  const beaconHousing = new THREE.Mesh(beaconHousingGeo, mats.hardware)
  beaconHousing.name = 'maze-player-chest-rig'
  beaconHousing.position.set(0.065, 1.25, -0.195)
  root.add(beaconHousing)

  const beaconPinGeo = new THREE.BoxGeometry(0.032, 0.032, 0.016)
  const beaconPin = new THREE.Mesh(beaconPinGeo, mats.accent)
  beaconPin.name = 'maze-player-chest-accent'
  beaconPin.position.set(0.065, 1.25, -0.215)
  root.add(beaconPin)

  // --- Survival backpack on +Z ---
  const packGeo = new THREE.BoxGeometry(0.28, 0.36, 0.15)
  const backpack = new THREE.Mesh(packGeo, mats.gear)
  backpack.name = 'maze-player-backpack'
  backpack.position.set(0, 1.2, 0.21)
  root.add(backpack)

  const claspGeo = new THREE.BoxGeometry(0.18, 0.045, 0.03)
  const packClasp = new THREE.Mesh(claspGeo, mats.hardware)
  packClasp.name = 'maze-player-pack-clasp'
  packClasp.position.set(0, 1.24, 0.285)
  root.add(packClasp)

  const bedrollGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.3, 10)
  const bedroll = new THREE.Mesh(bedrollGeo, mats.trousers)
  bedroll.name = 'maze-player-bedroll'
  bedroll.rotation.z = Math.PI / 2
  bedroll.position.set(0, 1.42, 0.21)
  root.add(bedroll)

  // --- Shoulders, arms & gloved hands (shared left/right geometries) ---
  const shoulderGeo = new THREE.SphereGeometry(0.095, 10, 8)
  const armGeo = new THREE.CylinderGeometry(0.066, 0.052, 0.5, 10)
  const handGeo = new THREE.SphereGeometry(0.052, 8, 8)
  const armSign = [-1, 1]

  for (let i = 0; i < armSign.length; i += 1) {
    const sign = armSign[i]
    const sideTag = sign < 0 ? 'left' : 'right'

    const shoulder = new THREE.Mesh(shoulderGeo, mats.coat)
    shoulder.name = `maze-player-shoulder-${sideTag}`
    shoulder.position.set(sign * 0.24, 1.39, 0)
    root.add(shoulder)

    const arm = new THREE.Mesh(armGeo, mats.coat)
    arm.name = `maze-player-arm-${sideTag}`
    arm.position.set(sign * 0.265, 1.11, -0.01)
    arm.rotation.z = sign * 0.08
    root.add(arm)

    const hand = new THREE.Mesh(handGeo, mats.gear)
    hand.name = `maze-player-hand-${sideTag}`
    hand.position.set(sign * 0.285, 0.84, -0.025)
    root.add(hand)
  }

  // --- Collar, hooded head & restrained respirator visor facing -Z ---
  const collarGeo = new THREE.CylinderGeometry(0.115, 0.145, 0.12, 12)
  const collar = new THREE.Mesh(collarGeo, mats.coat)
  collar.name = 'maze-player-collar'
  collar.position.set(0, 1.49, 0)
  root.add(collar)

  const headGeo = new THREE.SphereGeometry(0.132, 14, 12)
  const head = new THREE.Mesh(headGeo, mats.mask)
  head.name = 'maze-player-head'
  head.position.set(0, 1.64, -0.01)
  root.add(head)

  const hoodGeo = new THREE.CylinderGeometry(0.145, 0.17, 0.24, 12)
  const hood = new THREE.Mesh(hoodGeo, mats.coat)
  hood.name = 'maze-player-hood'
  hood.position.set(0, 1.655, 0.025)
  hood.rotation.x = 0.12
  root.add(hood)

  const hoodCrownGeo = new THREE.SphereGeometry(
    0.15,
    12,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.56
  )
  const hoodCrown = new THREE.Mesh(hoodCrownGeo, mats.coat)
  hoodCrown.name = 'maze-player-hood-crown'
  hoodCrown.position.set(0, 1.67, 0.02)
  root.add(hoodCrown)

  const visorPlateGeo = new THREE.BoxGeometry(0.15, 0.08, 0.06)
  const visorPlate = new THREE.Mesh(visorPlateGeo, mats.hardware)
  visorPlate.name = 'maze-player-visor-plate'
  visorPlate.position.set(0, 1.63, -0.12)
  root.add(visorPlate)

  const visorSlitGeo = new THREE.BoxGeometry(0.115, 0.022, 0.02)
  const visorSlit = new THREE.Mesh(visorSlitGeo, mats.accent)
  visorSlit.name = 'maze-player-visor-slit'
  visorSlit.position.set(0, 1.645, -0.148)
  root.add(visorSlit)

  // Initial placement: explicit world override > maze grid spawn > origin
  if (options?.position) {
    positionPlayerAtWorld(root, options.position, options.yaw)
  } else {
    const targetCell = options?.spawnCell || options?.maze?.start || null
    if (options?.maze && targetCell) {
      positionPlayerAtGrid(root, targetCell.row, targetCell.col, options.maze, {
        yaw: options.yaw,
      })
    } else if (Number.isFinite(options?.yaw)) {
      root.rotation.y = options.yaw
    }
  }

  root.userData = {
    isPlayerModel: true,
    height: config.height,
    eyeHeight: config.eyeHeight,
    radius: config.radius,
    meshCount: root.children.length,
    mazeId: options?.maze?.id || null,
  }

  return root
}

/**
 * Safely disposes all unique geometries and materials owned by a player model
 * group and detaches it from its parent scene if attached. Idempotent.
 */
export function disposePlayer(playerGroup) {
  if (!playerGroup) return false

  const disposedGeometries = new Set()
  const disposedMaterials = new Set()

  playerGroup.traverse((node) => {
    if (node.geometry && !disposedGeometries.has(node.geometry)) {
      disposedGeometries.add(node.geometry)
      if (typeof node.geometry.dispose === 'function') {
        node.geometry.dispose()
      }
    }

    if (node.material) {
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material]
      for (let i = 0; i < materials.length; i += 1) {
        const mat = materials[i]
        if (mat && !disposedMaterials.has(mat)) {
          disposedMaterials.add(mat)
          if (typeof mat.dispose === 'function') {
            mat.dispose()
          }
        }
      }
    }

    if (typeof node.dispose === 'function' && node !== playerGroup) {
      node.dispose()
    }
  })

  if (playerGroup.parent) {
    playerGroup.parent.remove(playerGroup)
  }
  playerGroup.clear()

  return true
}
