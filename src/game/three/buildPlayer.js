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

  // --- Grounded anatomical pivot rig (0-allocation animation handles) ---
  const upperBodyY = 0.86
  const shoulderOffsetY = 1.39 - upperBodyY
  const headPivotOffsetY = 1.49 - upperBodyY

  // --- Lower body: hip pivots with legs & boots ---
  const bootGeo = new THREE.BoxGeometry(0.14, 0.14, 0.24)
  const legGeo = new THREE.CylinderGeometry(0.082, 0.068, 0.72, 10)
  const hipSides = [-0.11, 0.11]
  const legPivots = { left: null, right: null }

  for (let i = 0; i < hipSides.length; i += 1) {
    const sideX = hipSides[i]
    const sideTag = i === 0 ? 'left' : 'right'

    const legPivot = new THREE.Group()
    legPivot.name = `maze-player-leg-pivot-${sideTag}`
    legPivot.position.set(sideX, upperBodyY, 0)
    root.add(legPivot)
    legPivots[sideTag] = legPivot

    const boot = new THREE.Mesh(bootGeo, mats.trousers)
    boot.name = `maze-player-boot-${sideTag}`
    boot.position.set(0, 0.07 - upperBodyY, -0.03)
    legPivot.add(boot)

    const leg = new THREE.Mesh(legGeo, mats.trousers)
    leg.name = `maze-player-leg-${sideTag}`
    leg.position.set(0, 0.5 - upperBodyY, 0)
    legPivot.add(leg)
  }

  // --- Upper body pivot: weathered field coat, harness, belt, pack, arms & head ---
  const upperBodyPivot = new THREE.Group()
  upperBodyPivot.name = 'maze-player-upper-body'
  upperBodyPivot.position.set(0, upperBodyY, 0)
  root.add(upperBodyPivot)

  const coatSkirtGeo = new THREE.CylinderGeometry(0.195, 0.235, 0.28, 12)
  const coatSkirt = new THREE.Mesh(coatSkirtGeo, mats.coat)
  coatSkirt.name = 'maze-player-coat-skirt'
  coatSkirt.position.set(0, 0.86 - upperBodyY, 0.01)
  upperBodyPivot.add(coatSkirt)

  const torsoGeo = new THREE.CylinderGeometry(0.215, 0.185, 0.54, 12)
  const torso = new THREE.Mesh(torsoGeo, mats.coat)
  torso.name = 'maze-player-torso'
  torso.position.set(0, 1.18 - upperBodyY, 0)
  upperBodyPivot.add(torso)

  const beltGeo = new THREE.CylinderGeometry(0.202, 0.202, 0.065, 12)
  const belt = new THREE.Mesh(beltGeo, mats.gear)
  belt.name = 'maze-player-belt'
  belt.position.set(0, 0.95 - upperBodyY, 0)
  upperBodyPivot.add(belt)

  const buckleGeo = new THREE.BoxGeometry(0.08, 0.075, 0.04)
  const buckle = new THREE.Mesh(buckleGeo, mats.hardware)
  buckle.name = 'maze-player-buckle'
  buckle.position.set(0, 0.95 - upperBodyY, -0.195)
  upperBodyPivot.add(buckle)

  const strapGeo = new THREE.BoxGeometry(0.055, 0.48, 0.39)
  const chestStrap = new THREE.Mesh(strapGeo, mats.gear)
  chestStrap.name = 'maze-player-harness-strap'
  chestStrap.position.set(0, 1.19 - upperBodyY, 0)
  chestStrap.rotation.z = 0.36
  upperBodyPivot.add(chestStrap)

  const beaconHousingGeo = new THREE.BoxGeometry(0.06, 0.08, 0.04)
  const beaconHousing = new THREE.Mesh(beaconHousingGeo, mats.hardware)
  beaconHousing.name = 'maze-player-chest-rig'
  beaconHousing.position.set(0.065, 1.25 - upperBodyY, -0.195)
  upperBodyPivot.add(beaconHousing)

  const beaconPinGeo = new THREE.BoxGeometry(0.032, 0.032, 0.016)
  const beaconPin = new THREE.Mesh(beaconPinGeo, mats.accent)
  beaconPin.name = 'maze-player-chest-accent'
  beaconPin.position.set(0.065, 1.25 - upperBodyY, -0.215)
  upperBodyPivot.add(beaconPin)

  // --- Survival backpack on +Z ---
  const packGeo = new THREE.BoxGeometry(0.28, 0.36, 0.15)
  const backpack = new THREE.Mesh(packGeo, mats.gear)
  backpack.name = 'maze-player-backpack'
  backpack.position.set(0, 1.2 - upperBodyY, 0.21)
  upperBodyPivot.add(backpack)

  const claspGeo = new THREE.BoxGeometry(0.18, 0.045, 0.03)
  const packClasp = new THREE.Mesh(claspGeo, mats.hardware)
  packClasp.name = 'maze-player-pack-clasp'
  packClasp.position.set(0, 1.24 - upperBodyY, 0.285)
  upperBodyPivot.add(packClasp)

  const bedrollGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.3, 10)
  const bedroll = new THREE.Mesh(bedrollGeo, mats.trousers)
  bedroll.name = 'maze-player-bedroll'
  bedroll.rotation.z = Math.PI / 2
  bedroll.position.set(0, 1.42 - upperBodyY, 0.21)
  upperBodyPivot.add(bedroll)

  // --- Shoulder pivots, arms & gloved hands (shared left/right geometries) ---
  const shoulderGeo = new THREE.SphereGeometry(0.095, 10, 8)
  const armGeo = new THREE.CylinderGeometry(0.066, 0.052, 0.5, 10)
  const handGeo = new THREE.SphereGeometry(0.052, 8, 8)
  const armSign = [-1, 1]
  const armPivots = { left: null, right: null }

  for (let i = 0; i < armSign.length; i += 1) {
    const sign = armSign[i]
    const sideTag = sign < 0 ? 'left' : 'right'

    const armPivot = new THREE.Group()
    armPivot.name = `maze-player-arm-pivot-${sideTag}`
    armPivot.position.set(sign * 0.24, shoulderOffsetY, 0)
    upperBodyPivot.add(armPivot)
    armPivots[sideTag] = armPivot

    const shoulder = new THREE.Mesh(shoulderGeo, mats.coat)
    shoulder.name = `maze-player-shoulder-${sideTag}`
    shoulder.position.set(0, 0, 0)
    armPivot.add(shoulder)

    const arm = new THREE.Mesh(armGeo, mats.coat)
    arm.name = `maze-player-arm-${sideTag}`
    arm.position.set(sign * 0.025, 1.11 - 1.39, -0.01)
    arm.rotation.z = sign * 0.08
    armPivot.add(arm)

    const hand = new THREE.Mesh(handGeo, mats.gear)
    hand.name = `maze-player-hand-${sideTag}`
    hand.position.set(sign * 0.045, 0.84 - 1.39, -0.025)
    armPivot.add(hand)
  }

  // --- Head pivot, collar, hooded head & restrained respirator visor facing -Z ---
  const headPivot = new THREE.Group()
  headPivot.name = 'maze-player-head-pivot'
  headPivot.position.set(0, headPivotOffsetY, 0)
  upperBodyPivot.add(headPivot)

  const collarGeo = new THREE.CylinderGeometry(0.115, 0.145, 0.12, 12)
  const collar = new THREE.Mesh(collarGeo, mats.coat)
  collar.name = 'maze-player-collar'
  collar.position.set(0, 1.49 - 1.49, 0)
  headPivot.add(collar)

  const headGeo = new THREE.SphereGeometry(0.132, 14, 12)
  const head = new THREE.Mesh(headGeo, mats.mask)
  head.name = 'maze-player-head'
  head.position.set(0, 1.64 - 1.49, -0.01)
  headPivot.add(head)

  const hoodGeo = new THREE.CylinderGeometry(0.145, 0.17, 0.24, 12)
  const hood = new THREE.Mesh(hoodGeo, mats.coat)
  hood.name = 'maze-player-hood'
  hood.position.set(0, 1.655 - 1.49, 0.025)
  hood.rotation.x = 0.12
  headPivot.add(hood)

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
  hoodCrown.position.set(0, 1.67 - 1.49, 0.02)
  headPivot.add(hoodCrown)

  const visorPlateGeo = new THREE.BoxGeometry(0.15, 0.08, 0.06)
  const visorPlate = new THREE.Mesh(visorPlateGeo, mats.hardware)
  visorPlate.name = 'maze-player-visor-plate'
  visorPlate.position.set(0, 1.63 - 1.49, -0.12)
  headPivot.add(visorPlate)

  const visorSlitGeo = new THREE.BoxGeometry(0.115, 0.022, 0.02)
  const visorSlit = new THREE.Mesh(visorSlitGeo, mats.accent)
  visorSlit.name = 'maze-player-visor-slit'
  visorSlit.position.set(0, 1.645 - 1.49, -0.148)
  headPivot.add(visorSlit)

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

  let meshCount = 0
  root.traverse((node) => {
    if (node.isMesh) meshCount += 1
  })

  root.userData = {
    isPlayerModel: true,
    height: config.height,
    eyeHeight: config.eyeHeight,
    radius: config.radius,
    meshCount,
    mazeId: options?.maze?.id || null,
    rig: {
      upperBodyPivot,
      headPivot,
      leftLegPivot: legPivots.left,
      rightLegPivot: legPivots.right,
      leftArmPivot: armPivots.left,
      rightArmPivot: armPivots.right,
      restPose: {
        upperBodyY,
        headPivotY: headPivotOffsetY,
      },
    },
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
