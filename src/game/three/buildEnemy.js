import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'

export const ENEMY_PALETTE = {
  chassis: 0x0e131a,
  plating: 0x1a2332,
  joints: 0x090c10,
  spines: 0x2e3a4e,
  accentHardware: 0x475569,
  sensorNormal: 0xf59e0b,
  sensorNormalEmissive: 0xd97706,
  sensorAlert: 0xf97316,
  sensorAlertEmissive: 0xea580c,
  sensorChase: 0xef4444,
  sensorChaseEmissive: 0xdc2626,
}

export const DEFAULT_ENEMY_MODEL_CONFIG = {
  height: 2.15,
  eyeHeight: 1.88,
  radius: 0.55,
  lightIntensity: 1.2,
  lightDistance: 7.0,
}

function createEnemyMaterials() {
  const chassis = new THREE.MeshStandardMaterial({
    color: ENEMY_PALETTE.chassis,
    roughness: 0.84,
    metalness: 0.22,
  })

  const plating = new THREE.MeshStandardMaterial({
    color: ENEMY_PALETTE.plating,
    roughness: 0.62,
    metalness: 0.48,
  })

  const joints = new THREE.MeshStandardMaterial({
    color: ENEMY_PALETTE.joints,
    roughness: 0.9,
    metalness: 0.1,
  })

  const spines = new THREE.MeshStandardMaterial({
    color: ENEMY_PALETTE.spines,
    roughness: 0.5,
    metalness: 0.55,
  })

  const hardware = new THREE.MeshStandardMaterial({
    color: ENEMY_PALETTE.accentHardware,
    roughness: 0.35,
    metalness: 0.75,
  })

  const sensor = new THREE.MeshStandardMaterial({
    color: ENEMY_PALETTE.sensorNormal,
    emissive: ENEMY_PALETTE.sensorNormalEmissive,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.1,
  })

  return { chassis, plating, joints, spines, hardware, sensor }
}

/**
 * Builds a procedural 3D horror enemy stalker character using Three.js.
 * Features an articulated pivot rig, hunched biomechanical chassis,
 * dorsal spines, elongated arms with claws, and an ocular sensor with localized light.
 */
export function buildEnemy(options = {}) {
  const config = {
    ...DEFAULT_ENEMY_MODEL_CONFIG,
    ...(options?.config || {}),
  }

  const root = new THREE.Group()
  root.name = `maze-enemy-root-${options?.id || 'default'}`
  root.visible = options?.visible !== false

  const mats = createEnemyMaterials()

  const hipHeight = 0.96
  const shoulderOffsetY = 1.62 - hipHeight
  const headPivotOffsetY = 1.72 - hipHeight

  // --- Lower body: Articulated Digitigrade Leg Pivots ---
  const legPivots = { left: null, right: null }
  const legXOffsets = [-0.18, 0.18]

  const thighGeo = new THREE.CylinderGeometry(0.085, 0.065, 0.52, 8)
  const shinGeo = new THREE.CylinderGeometry(0.06, 0.045, 0.54, 8)
  const clawGeo = new THREE.BoxGeometry(0.14, 0.12, 0.26)

  for (let i = 0; i < legXOffsets.length; i += 1) {
    const sideX = legXOffsets[i]
    const sideTag = i === 0 ? 'left' : 'right'

    const legPivot = new THREE.Group()
    legPivot.name = `maze-enemy-leg-pivot-${sideTag}`
    legPivot.position.set(sideX, hipHeight, 0)
    root.add(legPivot)
    legPivots[sideTag] = legPivot

    // Thigh angled slightly backwards
    const thigh = new THREE.Mesh(thighGeo, mats.plating)
    thigh.name = `maze-enemy-thigh-${sideTag}`
    thigh.position.set(0, -0.22, 0.05)
    thigh.rotation.x = -0.22
    legPivot.add(thigh)

    // Shin angled forward
    const shin = new THREE.Mesh(shinGeo, mats.chassis)
    shin.name = `maze-enemy-shin-${sideTag}`
    shin.position.set(0, -0.62, -0.04)
    shin.rotation.x = 0.25
    legPivot.add(shin)

    // Talon/claw foot flush on floor
    const claw = new THREE.Mesh(clawGeo, mats.hardware)
    claw.name = `maze-enemy-claw-${sideTag}`
    claw.position.set(0, 0.06 - hipHeight, -0.06)
    legPivot.add(claw)
  }

  // --- Upper Body Pivot (hunched predatory torso & carapace) ---
  const upperBodyPivot = new THREE.Group()
  upperBodyPivot.name = 'maze-enemy-upper-body'
  upperBodyPivot.position.set(0, hipHeight, 0)
  root.add(upperBodyPivot)

  // Hunched thoracic shell
  const carapaceGeo = new THREE.BoxGeometry(0.48, 0.58, 0.38)
  const carapace = new THREE.Mesh(carapaceGeo, mats.chassis)
  carapace.name = 'maze-enemy-carapace'
  carapace.position.set(0, 1.32 - hipHeight, 0.08)
  carapace.rotation.x = 0.28
  upperBodyPivot.add(carapace)

  // Heavy chest armor plate
  const chestPlateGeo = new THREE.CylinderGeometry(0.24, 0.18, 0.44, 8)
  const chestPlate = new THREE.Mesh(chestPlateGeo, mats.plating)
  chestPlate.name = 'maze-enemy-chest-plate'
  chestPlate.position.set(0, 1.34 - hipHeight, -0.08)
  chestPlate.rotation.x = 0.22
  upperBodyPivot.add(chestPlate)

  // Dorsal spines / cooling ribs on +Z
  for (let s = 0; s < 3; s += 1) {
    const spineGeo = new THREE.BoxGeometry(0.06, 0.12, 0.18)
    const spine = new THREE.Mesh(spineGeo, mats.spines)
    spine.name = `maze-enemy-spine-${s}`
    spine.position.set(0, 1.18 + s * 0.15 - hipHeight, 0.26 + s * 0.04)
    spine.rotation.x = 0.38
    upperBodyPivot.add(spine)
  }

  // --- Elongated Predator Arm Pivots ---
  const armPivots = { left: null, right: null }
  const armSigns = [-1, 1]
  const upperArmGeo = new THREE.CylinderGeometry(0.065, 0.052, 0.58, 8)
  const foreArmGeo = new THREE.CylinderGeometry(0.052, 0.038, 0.62, 8)
  const bladeHandGeo = new THREE.BoxGeometry(0.08, 0.22, 0.04)

  for (let i = 0; i < armSigns.length; i += 1) {
    const sign = armSigns[i]
    const sideTag = sign < 0 ? 'left' : 'right'

    const armPivot = new THREE.Group()
    armPivot.name = `maze-enemy-arm-pivot-${sideTag}`
    armPivot.position.set(sign * 0.32, shoulderOffsetY, 0.04)
    upperBodyPivot.add(armPivot)
    armPivots[sideTag] = armPivot

    const shoulderJoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      mats.joints
    )
    shoulderJoint.position.set(0, 0, 0)
    armPivot.add(shoulderJoint)

    const upperArm = new THREE.Mesh(upperArmGeo, mats.plating)
    upperArm.name = `maze-enemy-upper-arm-${sideTag}`
    upperArm.position.set(sign * 0.04, -0.26, 0)
    upperArm.rotation.z = sign * 0.12
    upperArm.rotation.x = 0.14
    armPivot.add(upperArm)

    const foreArm = new THREE.Mesh(foreArmGeo, mats.chassis)
    foreArm.name = `maze-enemy-fore-arm-${sideTag}`
    foreArm.position.set(sign * 0.06, -0.72, -0.08)
    foreArm.rotation.x = 0.28
    armPivot.add(foreArm)

    const bladeHand = new THREE.Mesh(bladeHandGeo, mats.hardware)
    bladeHand.name = `maze-enemy-blade-hand-${sideTag}`
    bladeHand.position.set(sign * 0.06, -1.06, -0.16)
    bladeHand.rotation.x = 0.4
    armPivot.add(bladeHand)
  }

  // --- Head & Ocular Sensor Pivot facing -Z ---
  const headPivot = new THREE.Group()
  headPivot.name = 'maze-enemy-head-pivot'
  headPivot.position.set(0, headPivotOffsetY, -0.18)
  upperBodyPivot.add(headPivot)

  const headCowlGeo = new THREE.BoxGeometry(0.26, 0.22, 0.34)
  const headCowl = new THREE.Mesh(headCowlGeo, mats.chassis)
  headCowl.name = 'maze-enemy-head-cowl'
  headCowl.position.set(0, 0.04, 0)
  headCowl.rotation.x = 0.12
  headPivot.add(headCowl)

  const browGeo = new THREE.BoxGeometry(0.28, 0.08, 0.14)
  const brow = new THREE.Mesh(browGeo, mats.plating)
  brow.name = 'maze-enemy-brow'
  brow.position.set(0, 0.1, -0.12)
  headPivot.add(brow)

  // Glowing Ocular Visor / Eye Lens
  const sensorGeo = new THREE.BoxGeometry(0.2, 0.05, 0.04)
  const sensorMesh = new THREE.Mesh(sensorGeo, mats.sensor)
  sensorMesh.name = 'maze-enemy-sensor-eye'
  sensorMesh.position.set(0, 0.04, -0.18)
  headPivot.add(sensorMesh)

  // Localized Ocular PointLight casting horror glow into corridors
  const sensorLight = new THREE.PointLight(
    ENEMY_PALETTE.sensorNormal,
    config.lightIntensity,
    config.lightDistance,
    2
  )
  sensorLight.name = 'maze-enemy-sensor-light'
  sensorLight.position.set(0, 0.04, -0.32)
  headPivot.add(sensorLight)

  // Initial positioning
  if (options?.position) {
    root.position.set(
      options.position.x || 0,
      options.position.y || 0,
      options.position.z || 0
    )
  } else if (options?.maze && options?.spawnCell) {
    const worldPos = gridToWorld(
      options.spawnCell.row,
      options.spawnCell.col,
      options.maze
    )
    if (worldPos) {
      root.position.set(worldPos.x, 0, worldPos.z)
    }
  }

  if (Number.isFinite(options?.yaw)) {
    root.rotation.y = options.yaw
  }

  root.userData = {
    isEnemyModel: true,
    id: options?.id || 'stalker',
    height: config.height,
    radius: config.radius,
    rig: {
      upperBodyPivot,
      headPivot,
      leftLegPivot: legPivots.left,
      rightLegPivot: legPivots.right,
      leftArmPivot: armPivots.left,
      rightArmPivot: armPivots.right,
      sensorMesh,
      sensorLight,
      materials: mats,
      restPose: {
        hipHeight,
        shoulderOffsetY,
        headPivotOffsetY,
      },
    },
  }

  return root
}

/**
 * Updates an enemy's ocular sensor color and illumination based on AI alert state.
 */
export function updateEnemyVisualState(enemyGroup, state) {
  if (!enemyGroup?.userData?.rig) return

  const { sensorMesh, sensorLight } = enemyGroup.userData.rig
  if (!sensorMesh || !sensorLight) return

  let color
  let emissive
  let intensity

  switch (state) {
    case 'attack':
      color = 0xff0033
      emissive = 0xff0022
      intensity = 3.6
      break
    case 'chase':
      color = ENEMY_PALETTE.sensorChase
      emissive = ENEMY_PALETTE.sensorChaseEmissive
      intensity = 2.4
      break
    case 'investigate':
    case 'search':
      color = ENEMY_PALETTE.sensorAlert
      emissive = ENEMY_PALETTE.sensorAlertEmissive
      intensity = 1.7
      break
    case 'patrol':
    case 'idle':
    default:
      color = ENEMY_PALETTE.sensorNormal
      emissive = ENEMY_PALETTE.sensorNormalEmissive
      intensity = 1.1
      break
  }

  if (sensorMesh.material) {
    sensorMesh.material.color.setHex(color)
    sensorMesh.material.emissive.setHex(emissive)
  }
  sensorLight.color.setHex(color)
  sensorLight.intensity = intensity
}

/**
 * Safely disposes all geometries, materials, and lights owned by an enemy model.
 */
export function disposeEnemy(enemyGroup) {
  if (!enemyGroup) return false

  const disposedGeos = new Set()
  const disposedMats = new Set()

  enemyGroup.traverse((node) => {
    if (node.geometry && !disposedGeos.has(node.geometry)) {
      disposedGeos.add(node.geometry)
      node.geometry.dispose?.()
    }
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (let i = 0; i < mats.length; i += 1) {
        const m = mats[i]
        if (m && !disposedMats.has(m)) {
          disposedMats.add(m)
          m.dispose?.()
        }
      }
    }
    if (typeof node.dispose === 'function' && node !== enemyGroup) {
      node.dispose()
    }
  })

  if (enemyGroup.parent) {
    enemyGroup.parent.remove(enemyGroup)
  }
  enemyGroup.clear()

  return true
}
