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
  releasePlayerTexturePreset,
  resolvePlayerTextureQualityPreset,
  retainPlayerTexturePreset,
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

const MATERIAL_TEXTURE_KEYS = [
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

function createMaterialFromSpec(spec, texBundle, materialKey = null) {
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

  const usesPhysical =
    spec.sheen !== undefined || spec.clearcoat !== undefined
  if (usesPhysical) {
    if (spec.sheen !== undefined) {
      matOptions.sheen = spec.sheen
      matOptions.sheenRoughness = spec.sheenRoughness ?? 0.7
      if (spec.sheenColor !== undefined) {
        matOptions.sheenColor = spec.sheenColor
      }
    }
    if (spec.clearcoat !== undefined) {
      matOptions.clearcoat = spec.clearcoat
      matOptions.clearcoatRoughness = spec.clearcoatRoughness ?? 0.1
    }
  }

  const mat = usesPhysical
    ? new THREE.MeshPhysicalMaterial(matOptions)
    : new THREE.MeshStandardMaterial(matOptions)
  mat.userData = {
    ...(mat.userData || {}),
    materialKey,
    textureKey: spec.textureKey || null,
  }
  return mat
}

function createPlayerMaterials(config) {
  const qualityPreset = resolvePlayerTextureQualityPreset(config.qualityPreset)
  const textures = getPlayerTextureSet({ qualityPreset })

  return {
    qualityPreset,
    skin: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.skin, textures.skin, 'skin'),
    lips: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.lips, textures.skin, 'lips'),
    hair: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.hair, textures.hair, 'hair'),
    eyesSclera: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.eyesSclera, null, 'eyesSclera'),
    eyesIris: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.eyesIris, null, 'eyesIris'),
    jacket: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.jacket, textures.jacket, 'jacket'),
    trousers: createMaterialFromSpec(
      PLAYER_MATERIAL_SPECS.trousers,
      textures.trousers,
      'trousers'
    ),
    boots: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.boots, textures.leather, 'boots'),
    gloves: createMaterialFromSpec(
      PLAYER_MATERIAL_SPECS.gloves,
      textures.leather,
      'gloves'
    ),
    backpack: createMaterialFromSpec(
      PLAYER_MATERIAL_SPECS.backpack,
      textures.leather,
      'backpack'
    ),
    hardware: createMaterialFromSpec(PLAYER_MATERIAL_SPECS.hardware, null, 'hardware'),
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

  const createdGeometries = []
  const createdMaterials = []
  const trackGeo = (geo) => {
    if (geo) createdGeometries.push(geo)
    return geo
  }
  const trackGeoDict = (dict) => {
    if (dict && typeof dict === 'object') {
      const vals = Object.values(dict)
      for (let i = 0; i < vals.length; i += 1) {
        trackGeo(vals[i])
      }
    }
    return dict
  }

  try {
    const mats = createPlayerMaterials(config)
    retainPlayerTexturePreset(mats.qualityPreset, root)
    for (const [k, v] of Object.entries(mats)) {
      if (k !== 'qualityPreset' && v && typeof v.dispose === 'function') {
        createdMaterials.push(v)
      }
    }

    // --- Anatomical joint coordinates (world total ~1.77m, eyes ~1.62m, soles = 0.00m) ---
    const pelvisY = 0.92
    const spineOffsetY = 0.05 // world 0.97
    const neckOffsetY = 0.456 // world 1.426
    const headOffsetY = 0.058 // world 1.484 (head center +0.132 => 1.616, eyes +0.136 => 1.620, crown ~1.769)
    const shoulderOffsetX = 0.194
    const shoulderOffsetY = 0.422 // relative to spinePivot -> world 1.392
    const elbowOffsetX = 0.016
    const elbowOffsetY = -0.28 // world 1.095
    const wristOffsetX = 0.004
    const wristOffsetY = -0.245 // world 0.85
    const hipOffsetX = 0.094
    const kneeOffsetY = -0.425 // world 0.495
    const ankleOffsetY = -0.395 // world 0.10 (boot sole at -0.10 => world 0.00)

    // --- Pelvis Pivot ---
    const pelvisPivot = new THREE.Group()
    pelvisPivot.name = 'maze-player-pelvis-pivot'
    pelvisPivot.position.set(0, pelvisY, 0)
    root.add(pelvisPivot)

    const pelvisGeo = trackGeoDict(buildPelvisGeometries())
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

    const torsoGeo = trackGeoDict(buildTorsoAndBackpackGeometries())
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
      createPartMesh('maze-player-neck', trackGeo(buildNeckGeometry()), mats.skin)
    )

    const headPivot = new THREE.Group()
    headPivot.name = 'maze-player-head-pivot'
    headPivot.position.set(0, headOffsetY, -0.005)
    neckPivot.add(headPivot)

    const headGeo = trackGeoDict(buildHeadSegmentGeometries())
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
      const armGeo = trackGeoDict(buildArmSegmentGeometries(sign))

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
      const legGeo = trackGeoDict(buildLegSegmentGeometries(sign))

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
      isDisposed: false,
      height: config.height,
      eyeHeight: config.eyeHeight,
      radius: config.radius,
      meshCount,
      mazeId: options?.maze?.id || null,
      qualityPreset: mats.qualityPreset,
      materials: mats,
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
  } catch (error) {
    releasePlayerTexturePreset(root)
    for (let i = 0; i < createdGeometries.length; i += 1) {
      const geo = createdGeometries[i]
      if (geo && !isSharedResource(geo)) {
        geo.dispose?.()
      }
    }
    for (let i = 0; i < createdMaterials.length; i += 1) {
      const mat = createdMaterials[i]
      if (mat && !isSharedResource(mat)) {
        mat.dispose?.()
      }
    }
    root.clear?.()
    throw error
  }
}

/**
 * Rebinds a live player model's PBR textures (`map`, `bumpMap`, `roughnessMap`)
 * to match the requested graphics `qualityPreset` (`performance`: 64px,
 * `balanced`: 128px, `high`: 256px) in-place without rebuilding geometry or
 * leaking materials.
 */
export function syncPlayerQuality(playerGroup, qualityPreset = 'high') {
  if (!playerGroup || typeof playerGroup !== 'object' || playerGroup.userData?.isDisposed) {
    return null
  }

  const nextPreset = resolvePlayerTextureQualityPreset(qualityPreset)
  const prevPreset = playerGroup.userData?.qualityPreset || null
  const textures = getPlayerTextureSet({ qualityPreset: nextPreset })
  retainPlayerTexturePreset(nextPreset, playerGroup)
  if (prevPreset && prevPreset !== nextPreset) {
    releasePlayerTexturePreset(playerGroup, prevPreset)
  }

  const seenMats = new Set()
  const syncMaterial = (mat) => {
    if (!mat || seenMats.has(mat)) return
    seenMats.add(mat)
    const texKey =
      mat.userData?.textureKey ||
      (mat.userData?.materialKey && PLAYER_MATERIAL_SPECS[mat.userData.materialKey]?.textureKey) ||
      null
    if (!texKey || !textures[texKey]) return
    const bundle = textures[texKey]
    let changed = false
    if (mat.map !== bundle.map) {
      mat.map = bundle.map
      changed = true
    }
    if (mat.bumpMap !== bundle.bumpMap) {
      mat.bumpMap = bundle.bumpMap
      changed = true
    }
    if (mat.roughnessMap !== bundle.roughnessMap) {
      mat.roughnessMap = bundle.roughnessMap
      changed = true
    }
    if (changed) {
      mat.needsUpdate = true
    }
  }

  const udMats = playerGroup.userData?.materials
  if (udMats && typeof udMats === 'object') {
    for (const [k, m] of Object.entries(udMats)) {
      if (k === 'qualityPreset') continue
      syncMaterial(m)
    }
    udMats.qualityPreset = nextPreset
  }

  if (typeof playerGroup.traverse === 'function') {
    playerGroup.traverse((node) => {
      if (!node?.material) return
      if (Array.isArray(node.material)) {
        for (let i = 0; i < node.material.length; i += 1) {
          syncMaterial(node.material[i])
        }
      } else {
        syncMaterial(node.material)
      }
    })
  }

  if (!playerGroup.userData || typeof playerGroup.userData !== 'object') {
    playerGroup.userData = {}
  }
  playerGroup.userData.qualityPreset = nextPreset
  return textures
}

/**
 * Safely disposes all unique non-shared geometries, materials, and non-shared
 * textures owned by a player model group, releases its pooled texture preset
 * ownership, clears child pivots, and detaches it from its parent scene.
 * Pooled shared DataTextures from `playerTextures.js` remain managed cleanly by
 * reference count / `sharedResources.js`. Idempotent and safe for partial groups.
 */
export function disposePlayer(playerGroup) {
  if (!playerGroup || typeof playerGroup !== 'object') return false

  const disposedGeometries = new Set()
  const disposedMaterials = new Set()
  const disposedTextures = new Set()
  const groupsToClear = []

  const disposeMaterialSafe = (mat) => {
    if (!mat) return
    if (Array.isArray(mat)) {
      for (let i = 0; i < mat.length; i += 1) {
        disposeMaterialSafe(mat[i])
      }
      return
    }
    if (typeof mat !== 'object') return
    for (let i = 0; i < MATERIAL_TEXTURE_KEYS.length; i += 1) {
      const tex = mat[MATERIAL_TEXTURE_KEYS[i]]
      if (
        tex &&
        !isSharedResource(tex) &&
        !disposedTextures.has(tex) &&
        typeof tex.dispose === 'function'
      ) {
        disposedTextures.add(tex)
        tex.dispose()
      }
    }
    if (!isSharedResource(mat) && !disposedMaterials.has(mat)) {
      disposedMaterials.add(mat)
      if (typeof mat.dispose === 'function') {
        mat.dispose()
      }
    }
  }

  const visitNode = (node) => {
    if (!node || typeof node !== 'object') return
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
      disposeMaterialSafe(node.material)
    }

    if (node !== playerGroup) {
      if (typeof node.dispose === 'function') {
        node.dispose()
      }
      if (typeof node.clear === 'function') {
        groupsToClear.push(node)
      }
    }
  }

  if (typeof playerGroup.traverse === 'function') {
    playerGroup.traverse(visitNode)
  } else {
    visitNode(playerGroup)
    if (Array.isArray(playerGroup.children)) {
      for (let i = 0; i < playerGroup.children.length; i += 1) {
        visitNode(playerGroup.children[i])
      }
    }
  }

  const udMats = playerGroup.userData?.materials
  if (udMats && typeof udMats === 'object') {
    for (const [k, m] of Object.entries(udMats)) {
      if (k !== 'qualityPreset') {
        disposeMaterialSafe(m)
      }
    }
  }

  for (let i = groupsToClear.length - 1; i >= 0; i -= 1) {
    groupsToClear[i]?.clear?.()
  }

  releasePlayerTexturePreset(playerGroup)

  if (playerGroup.parent && typeof playerGroup.parent.remove === 'function') {
    playerGroup.parent.remove(playerGroup)
  }
  playerGroup.clear?.()

  if (playerGroup.userData && typeof playerGroup.userData === 'object') {
    playerGroup.userData.rig = null
    playerGroup.userData.materials = null
    playerGroup.userData.isDisposed = true
  }

  return true
}
