import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'
import {
  buildArmSegmentGeometries,
  buildHeadSegmentGeometries,
  buildLegSegmentGeometries,
  buildNeckGeometry,
  buildPelvisGeometries,
  buildTorsoAndBackpackGeometries,
} from './playerGeometry.js'
import {
  PLAYER_MATERIAL_SPECS,
  PLAYER_PALETTE,
  getPlayerTextureSet,
  resolvePlayerTextureQualityPreset,
} from './playerTextures.js'
import { isSharedResource } from './sharedResources.js'

export { PLAYER_PALETTE }

export const DEFAULT_PLAYER_MODEL_CONFIG = {
  height: 1.8,
  eyeHeight: 1.65,
  radius: 0.34,
  accentEmissiveIntensity: 0.42,
  qualityPreset: 'high',
}

function createMaterialFromSpec(spec, texBundle) {
  const matOptions = {
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    envMapIntensity: spec.envMapIntensity,
    vertexColors: true,
  }

  if (texBundle) {
    matOptions.map = texBundle.map
    matOptions.bumpMap = texBundle.bumpMap
    matOptions.bumpScale = spec.bumpScale
    matOptions.roughnessMap = texBundle.roughnessMap
  }

  return new THREE.MeshStandardMaterial(matOptions)
}

function createPlayerMaterials(config) {
  const qualityPreset = resolvePlayerTextureQualityPreset(config.qualityPreset)
  const textures = getPlayerTextureSet({ qualityPreset })

  return {
    qualityPreset,
    skin: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.skin, textures.skin),
    lips: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.lips, textures.skin),
    hair: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.hair, textures.hair),
    eyesSclera: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.eyesSclera, null),
    eyesIris: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.eyesIris, null),
    jacket: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.jacket, textures.jacket),
    trousers: createMaterialFromSpec(
      PLAYER_MATERIAL_SPECS.trousers,
      textures.trousers
    ),
    boots: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.boots, textures.leather),
    gloves: createMaterialFromSpec(
      PLAYER_MATERIAL_SPECS.gloves,
      textures.leather
    ),
    backpack: createMaterialFromSpec(
      PLAYER_MATERIAL_SPECS.backpack,
      textures.leather
    ),
    hardware: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.hardware, null),
  }
}

function createPartMesh(name, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
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
 * Builds a procedural semi-realistic 3D adult male explorer character (~1.80m tall).
 * Grounded at `y = 0` at the boot soles and oriented in local space facing `-Z`
 * so `rotation.y = yaw` matches CameraRig and third-person flashlight attachment.
 *
 * @param {object} [options]
 * @param {object|null} [options.maze=null] - Optional maze used for `gridToWorld()` spawn placement.
 * @param {{row: number, col: number}|null} [options.spawnCell=null] - Optional grid spawn cell (defaults to `maze.start`).
 * @param {{x: number, y?: number, z: number}|null} [options.position=null] - Optional explicit world position override.
 * @param {number} [options.yaw=0] - Initial Y-axis facing angle in radians.
 * @param {boolean} [options.visible=true] - Initial model visibility.
 * @param {'performance'|'balanced'|'high'} [options.qualityPreset] - Procedural texture tier override.
 * @param {object} [options.config] - Visual overrides merged with `DEFAULT_PLAYER_MODEL_CONFIG`.
 */
export function buildPlayer(options = {}) {
  const config = {
    ...DEFAULT_PLAYER_MODEL_CONFIG,
    ...(options?.config || {}),
  }
  if (options?.qualityPreset) {
    config.qualityPreset = options.qualityPreset
  }

  const root = new THREE.Group()
  root.name = 'maze-player-root'
  root.visible = options?.visible !== false

  const mats = createPlayerMaterials(config)

  // --- Anatomical joint coordinates (world total = 1.80m, eyes = 1.65m, soles = 0.00m) ---
  const pelvisY = 0.91
  const spineOffsetY = 0.05 // world 0.96
  const neckOffsetY = 0.46 // world 1.42
  const headOffsetY = 0.09 // world 1.51 (head center +0.13 => 1.64, eyes +0.14 => 1.65, crown +0.29 => 1.80)
  const shoulderOffsetX = 0.205
  const shoulderOffsetY = 0.415 // relative to spinePivot -> world 1.375
  const elbowOffsetX = 0.02
  const elbowOffsetY = -0.28 // world 1.095
  const wristOffsetX = 0.004
  const wristOffsetY = -0.245 // world 0.85
  const hipOffsetX = 0.102
  const kneeOffsetY = -0.42 // world 0.49
  const ankleOffsetY = -0.39 // world 0.10 (boot sole at -0.10 => world 0.00)

  // --- Pelvis Pivot ---
  const pelvisPivot = new THREE.Group()
  pelvisPivot.name = 'maze-player-pelvis-pivot'
  pelvisPivot.position.set(0, pelvisY, 0)
  root.add(pelvisPivot)

  const pelvisGeo = buildPelvisGeometries()
  pelvisPivot.add(
    createPartMesh('maze-player-pelvis-trousers', pelvisGeo.trousers, mats.trousers),
    createPartMesh('maze-player-belt', pelvisGeo.belt, mats.boots),
    createPartMesh('maze-player-belt-buckle', pelvisGeo.hardware, mats.hardware)
  )

  // --- Spine / Upper Body Pivot (legacy alias: upperBodyPivot) ---
  const spinePivot = new THREE.Group()
  spinePivot.name = 'maze-player-spine-pivot'
  spinePivot.position.set(0, spineOffsetY, 0)
  pelvisPivot.add(spinePivot)

  const torsoGeo = buildTorsoAndBackpackGeometries()
  spinePivot.add(
    createPartMesh('maze-player-torso-jacket', torsoGeo.jacket, mats.jacket),
    createPartMesh('maze-player-backpack', torsoGeo.backpack, mats.backpack),
    createPartMesh('maze-player-torso-hardware', torsoGeo.hardware, mats.hardware)
  )

  // --- Neck & Head Pivots ---
  const neckPivot = new THREE.Group()
  neckPivot.name = 'maze-player-neck-pivot'
  neckPivot.position.set(0, neckOffsetY, -0.005)
  spinePivot.add(neckPivot)

  neckPivot.add(
    createPartMesh('maze-player-neck', buildNeckGeometry(), mats.skin)
  )

  const headPivot = new THREE.Group()
  headPivot.name = 'maze-player-head-pivot'
  headPivot.position.set(0, headOffsetY, -0.005)
  neckPivot.add(headPivot)

  const headGeo = buildHeadSegmentGeometries()
  headPivot.add(
    createPartMesh('maze-player-head-skin', headGeo.skin, mats.skin),
    createPartMesh('maze-player-lips', headGeo.lips, mats.lips),
    createPartMesh('maze-player-hair', headGeo.hair, mats.hair),
    createPartMesh('maze-player-eyes-sclera', headGeo.eyesSclera, mats.eyesSclera),
    createPartMesh('maze-player-eyes-iris', headGeo.eyesIris, mats.eyesIris)
  )

  // --- Articulated Arms (Shoulder -> Elbow -> Wrist) ---
  const armSideConfigs = [
    { tag: 'left', sign: -1 },
    { tag: 'right', sign: 1 },
  ]
  const shoulderPivots = { left: null, right: null }
  const elbowPivots = { left: null, right: null }
  const wristPivots = { left: null, right: null }

  for (let i = 0; i < armSideConfigs.length; i += 1) {
    const { tag, sign } = armSideConfigs[i]
    const armGeo = buildArmSegmentGeometries(sign)

    const shoulderPivot = new THREE.Group()
    shoulderPivot.name = `maze-player-shoulder-pivot-${tag}`
    shoulderPivot.position.set(sign * shoulderOffsetX, shoulderOffsetY, 0)
    spinePivot.add(shoulderPivot)
    shoulderPivots[tag] = shoulderPivot

    shoulderPivot.add(
      createPartMesh(`maze-player-upper-arm-${tag}`, armGeo.upperArm, mats.jacket)
    )

    const elbowPivot = new THREE.Group()
    elbowPivot.name = `maze-player-elbow-pivot-${tag}`
    elbowPivot.position.set(sign * elbowOffsetX, elbowOffsetY, 0.005)
    shoulderPivot.add(elbowPivot)
    elbowPivots[tag] = elbowPivot

    elbowPivot.add(
      createPartMesh(`maze-player-forearm-${tag}`, armGeo.forearm, mats.jacket)
    )

    const wristPivot = new THREE.Group()
    wristPivot.name = `maze-player-wrist-pivot-${tag}`
    wristPivot.position.set(sign * wristOffsetX, wristOffsetY, -0.005)
    elbowPivot.add(wristPivot)
    wristPivots[tag] = wristPivot

    wristPivot.add(
      createPartMesh(`maze-player-hand-${tag}`, armGeo.hand, mats.gloves)
    )
  }

  // --- Articulated Legs (Hip -> Knee -> Ankle) ---
  const legSideConfigs = [
    { tag: 'left', sign: -1 },
    { tag: 'right', sign: 1 },
  ]
  const hipPivots = { left: null, right: null }
  const kneePivots = { left: null, right: null }
  const anklePivots = { left: null, right: null }

  for (let i = 0; i < legSideConfigs.length; i += 1) {
    const { tag, sign } = legSideConfigs[i]
    const legGeo = buildLegSegmentGeometries(sign)

    const hipPivot = new THREE.Group()
    hipPivot.name = `maze-player-hip-pivot-${tag}`
    hipPivot.position.set(sign * hipOffsetX, 0, 0)
    pelvisPivot.add(hipPivot)
    hipPivots[tag] = hipPivot

    hipPivot.add(
      createPartMesh(`maze-player-thigh-${tag}`, legGeo.thigh, mats.trousers)
    )

    const kneePivot = new THREE.Group()
    kneePivot.name = `maze-player-knee-pivot-${tag}`
    kneePivot.position.set(0, kneeOffsetY, 0)
    hipPivot.add(kneePivot)
    kneePivots[tag] = kneePivot

    kneePivot.add(
      createPartMesh(`maze-player-shin-${tag}`, legGeo.shin, mats.trousers)
    )

    const anklePivot = new THREE.Group()
    anklePivot.name = `maze-player-ankle-pivot-${tag}`
    anklePivot.position.set(0, ankleOffsetY, 0)
    kneePivot.add(anklePivot)
    anklePivots[tag] = anklePivot

    anklePivot.add(
      createPartMesh(`maze-player-boot-${tag}`, legGeo.boot, mats.boots),
      createPartMesh(
        `maze-player-boot-hardware-${tag}`,
        legGeo.hardware,
        mats.hardware
      )
    )
  }

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
    if (node.isMesh) {
      meshCount += 1
      node.castShadow = true
      node.receiveShadow = true
    }
  })

  root.userData = {
    isPlayerModel: true,
    height: config.height,
    eyeHeight: config.eyeHeight,
    radius: config.radius,
    meshCount,
    mazeId: options?.maze?.id || null,
    qualityPreset: mats.qualityPreset,
    rig: {
      // Full 16-pivot anatomical rig
      pelvisPivot,
      spinePivot,
      neckPivot,
      headPivot,
      leftShoulderPivot: shoulderPivots.left,
      leftElbowPivot: elbowPivots.left,
      leftWristPivot: wristPivots.left,
      rightShoulderPivot: shoulderPivots.right,
      rightElbowPivot: elbowPivots.right,
      rightWristPivot: wristPivots.right,
      leftHipPivot: hipPivots.left,
      leftKneePivot: kneePivots.left,
      leftAnklePivot: anklePivots.left,
      rightHipPivot: hipPivots.right,
      rightKneePivot: kneePivots.right,
      rightAnklePivot: anklePivots.right,
      // Legacy rig aliases for PlayerAnimator compatibility
      upperBodyPivot: spinePivot,
      leftLegPivot: hipPivots.left,
      rightLegPivot: hipPivots.right,
      leftArmPivot: shoulderPivots.left,
      rightArmPivot: shoulderPivots.right,
      restPose: {
        pelvisY,
        upperBodyY: spineOffsetY,
        spineY: spineOffsetY,
        neckY: neckOffsetY,
        headPivotY: headOffsetY,
        leftLegY: 0,
        rightLegY: 0,
        leftKneeY: kneeOffsetY,
        rightKneeY: kneeOffsetY,
        leftAnkleY: ankleOffsetY,
        rightAnkleY: ankleOffsetY,
        leftShoulderY: shoulderOffsetY,
        rightShoulderY: shoulderOffsetY,
        leftElbowY: elbowOffsetY,
        rightElbowY: elbowOffsetY,
        leftWristY: wristOffsetY,
        rightWristY: wristOffsetY,
      },
    },
  }

  return root
}

/**
 * Safely disposes all unique non-shared geometries and materials owned by a
 * player model group and detaches it from its parent scene. Pooled shared
 * DataTextures from `playerTextures.js` remain managed by `sharedResources.js`.
 * Idempotent.
 */
export function disposePlayer(playerGroup) {
  if (!playerGroup) return false

  const disposedGeometries = new Set()
  const disposedMaterials = new Set()

  playerGroup.traverse((node) => {
    if (
      node.geometry &&
      !isSharedResource(node.geometry) &&
      !disposedGeometries.has(node.geometry)
    ) {
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
        if (mat && !isSharedResource(mat) && !disposedMaterials.has(mat)) {
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
