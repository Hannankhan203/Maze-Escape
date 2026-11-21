import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'
import {
  isSharedResource,
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'
import {
  buildWraithClawHandGeometry,
  buildWraithForearmGeometry,
  buildWraithHeadAndEyesGeometries,
  buildWraithNeckGeometry,
  buildWraithRobeAndMistGeometries,
  buildWraithTorsoGeometry,
  buildWraithUpperArmGeometry,
} from './wraithGeometry.js'

export const ENEMY_PALETTE = {
  chassis: 0x18212e,
  plating: 0x27354b,
  joints: 0x111824,
  spines: 0x3e516e,
  accentHardware: 0x64748b,
  sensorNormal: 0xf59e0b,
  sensorNormalEmissive: 0xd97706,
  sensorAlert: 0xf97316,
  sensorAlertEmissive: 0xea580c,
  sensorChase: 0xef4444,
  sensorChaseEmissive: 0xdc2626,
}

export const ENEMY_VISUAL_PRESETS = {
  stalker: {
    scaleX: 1.0,
    scaleY: 1.0,
    scaleZ: 1.0,
    chassis: 0x10141c,
    plating: 0x9ab0c4,
    spines: 0x1a2230,
    hardware: 0x7a96ad,
    sensorNormal: 0x7dd3fc,
    sensorAlert: 0xa5f3fc,
    sensorChase: 0xf43f5e,
    lightDistance: 8.5,
    lightIntensity: 2.2,
  },
  hunter: {
    scaleX: 0.9,
    scaleY: 0.93,
    scaleZ: 0.95,
    chassis: 0x142429,
    plating: 0x20424d,
    spines: 0x2e6e7a,
    hardware: 0x38bdf8,
    sensorNormal: 0x14b8a6,
    sensorAlert: 0xfacc15,
    sensorChase: 0xf43f5e,
    lightDistance: 10.0,
    lightIntensity: 2.4,
  },
  brute: {
    scaleX: 1.32,
    scaleY: 1.24,
    scaleZ: 1.28,
    chassis: 0x261916,
    plating: 0x482c23,
    spines: 0x6e3f2b,
    hardware: 0x94a3b8,
    sensorNormal: 0xf97316,
    sensorAlert: 0xfb923c,
    sensorChase: 0xff1e00,
    lightDistance: 8.0,
    lightIntensity: 2.6,
  },
}

export const DEFAULT_ENEMY_MODEL_CONFIG = {
  height: 2.15,
  eyeHeight: 1.88,
  radius: 0.55,
  lightIntensity: 2.2,
  lightDistance: 8.5,
}

const enemyGeoPool = new Map()
const enemyMatPool = new Map()

function getPooledGeometry(key, factory) {
  let geo = enemyGeoPool.get(key)
  if (!geo) {
    geo = markSharedResource(factory())
    enemyGeoPool.set(key, geo)
  }
  return geo
}

function getPooledMaterial(key, factory) {
  let mat = enemyMatPool.get(key)
  if (!mat) {
    mat = markSharedResource(factory())
    enemyMatPool.set(key, mat)
  }
  return mat
}

export function disposeEnemyPools() {
  for (const geo of enemyGeoPool.values()) {
    geo?.dispose?.()
  }
  enemyGeoPool.clear()

  for (const mat of enemyMatPool.values()) {
    mat?.dispose?.()
  }
  enemyMatPool.clear()
}

export function getEnemyPoolStats() {
  return {
    geometries: enemyGeoPool.size,
    materials: enemyMatPool.size,
  }
}

registerSharedPoolClearer(disposeEnemyPools)

function createEnemyMaterials(enemyType, preset) {
  if (enemyType === 'stalker') {
    const chassis = getPooledMaterial(
      'stalker:chassis',
      () =>
        new THREE.MeshStandardMaterial({
          color: preset.chassis,
          roughness: 0.94,
          metalness: 0.02,
          side: THREE.DoubleSide,
          vertexColors: true,
        })
    )

    const plating = getPooledMaterial(
      'stalker:plating',
      () =>
        new THREE.MeshStandardMaterial({
          color: preset.plating,
          roughness: 0.72,
          metalness: 0.04,
          vertexColors: true,
        })
    )

    const joints = getPooledMaterial(
      'shared:joints',
      () =>
        new THREE.MeshStandardMaterial({
          color: ENEMY_PALETTE.joints,
          roughness: 0.9,
          metalness: 0.12,
        })
    )

    const spines = getPooledMaterial(
      'stalker:spines',
      () =>
        new THREE.MeshStandardMaterial({
          color: preset.spines,
          roughness: 0.9,
          metalness: 0.02,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          side: THREE.DoubleSide,
          vertexColors: true,
        })
    )

    const hardware = getPooledMaterial(
      'stalker:hardware',
      () =>
        new THREE.MeshStandardMaterial({
          color: preset.hardware,
          emissive: 0x1e3a52,
          emissiveIntensity: 0.36,
          roughness: 0.85,
          metalness: 0.0,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          side: THREE.DoubleSide,
          vertexColors: true,
        })
    )

    // Instance-owned ocular eye material for subtle supernatural glow per AI alert state
    const sensor = new THREE.MeshStandardMaterial({
      color: preset.sensorNormal,
      emissive: preset.sensorNormal,
      emissiveIntensity: 0.85,
      roughness: 0.25,
      metalness: 0.05,
      vertexColors: true,
    })

    return { chassis, plating, joints, spines, hardware, sensor }
  }

  const chassis = getPooledMaterial(
    `${enemyType}:chassis`,
    () =>
      new THREE.MeshStandardMaterial({
        color: preset.chassis,
        roughness: 0.84,
        metalness: 0.22,
      })
  )

  const plating = getPooledMaterial(
    `${enemyType}:plating`,
    () =>
      new THREE.MeshStandardMaterial({
        color: preset.plating,
        roughness: 0.58,
        metalness: 0.52,
      })
  )

  const joints = getPooledMaterial(
    'shared:joints',
    () =>
      new THREE.MeshStandardMaterial({
        color: ENEMY_PALETTE.joints,
        roughness: 0.9,
        metalness: 0.12,
      })
  )

  const spines = getPooledMaterial(
    `${enemyType}:spines`,
    () =>
      new THREE.MeshStandardMaterial({
        color: preset.spines,
        roughness: 0.48,
        metalness: 0.58,
      })
  )

  const hardware = getPooledMaterial(
    `${enemyType}:hardware`,
    () =>
      new THREE.MeshStandardMaterial({
        color: preset.hardware,
        roughness: 0.3,
        metalness: 0.8,
      })
  )

  // Instance-owned material because each enemy changes ocular glow independently per AI alert state
  const sensor = new THREE.MeshStandardMaterial({
    color: preset.sensorNormal,
    emissive: preset.sensorNormal,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.1,
  })

  return { chassis, plating, joints, spines, hardware, sensor }
}

function buildWraithRig(rigScaleGroup, mats, sensorLightEnabled, preset, config) {
  const hipHeight = 1.08
  const lowerRobeOffsetY = 0.04
  const neckPivotOffsetY = 0.71
  const headPivotOffsetY = 0.2
  const shoulderOffsetY = 0.675

  // Ensure paired head & eyes geometry build together once cleanly into enemyGeoPool
  if (!enemyGeoPool.has('wraith:headSkin') || !enemyGeoPool.has('wraith:eyes')) {
    const { headSkin, eyes } = buildWraithHeadAndEyesGeometries()
    if (!enemyGeoPool.has('wraith:headSkin')) {
      enemyGeoPool.set('wraith:headSkin', markSharedResource(headSkin))
    } else {
      headSkin.dispose()
    }
    if (!enemyGeoPool.has('wraith:eyes')) {
      enemyGeoPool.set('wraith:eyes', markSharedResource(eyes))
    } else {
      eyes.dispose()
    }
  }

  // Ensure robe & dissolving mist geometries build together once cleanly into enemyGeoPool
  if (
    !enemyGeoPool.has('wraith:robeTorso') ||
    !enemyGeoPool.has('wraith:robeVeilUpper') ||
    !enemyGeoPool.has('wraith:robeSkirt') ||
    !enemyGeoPool.has('wraith:mistVeil') ||
    !enemyGeoPool.has('wraith:mistTendril')
  ) {
    const robeAndMist = buildWraithRobeAndMistGeometries()
    const entries = [
      ['wraith:robeTorso', robeAndMist.robeTorso],
      ['wraith:robeVeilUpper', robeAndMist.robeVeilUpper],
      ['wraith:robeSkirt', robeAndMist.robeSkirt],
      ['wraith:mistVeil', robeAndMist.mistVeil],
      ['wraith:mistTendril', robeAndMist.mistTendril],
    ]
    for (let i = 0; i < entries.length; i += 1) {
      const [key, geo] = entries[i]
      if (!enemyGeoPool.has(key)) {
        enemyGeoPool.set(key, markSharedResource(geo))
      } else {
        geo?.dispose?.()
      }
    }
  }

  const torsoGeo = getPooledGeometry('wraith:torsoSkin', buildWraithTorsoGeometry)
  const neckGeo = getPooledGeometry('wraith:neckSkin', buildWraithNeckGeometry)
  const headGeo = enemyGeoPool.get('wraith:headSkin')
  const eyesGeo = enemyGeoPool.get('wraith:eyes')
  const robeTorsoGeo = enemyGeoPool.get('wraith:robeTorso')
  const robeVeilUpperGeo = enemyGeoPool.get('wraith:robeVeilUpper')
  const robeSkirtGeo = enemyGeoPool.get('wraith:robeSkirt')
  const mistVeilGeo = enemyGeoPool.get('wraith:mistVeil')
  const mistTendrilGeo = enemyGeoPool.get('wraith:mistTendril')

  // Lower body: dissolving mist tendrils replacing feet (compatibility leg pivots for Engine/AI)
  const legPivots = { left: null, right: null }
  const tendrilOffsets = [-0.11, 0.11]
  for (let i = 0; i < tendrilOffsets.length; i += 1) {
    const sideTag = i === 0 ? 'left' : 'right'
    const legPivot = new THREE.Group()
    legPivot.name = `maze-enemy-leg-pivot-${sideTag}`
    legPivot.position.set(tendrilOffsets[i], hipHeight, 0.02)
    rigScaleGroup.add(legPivot)
    legPivots[sideTag] = legPivot

    const tendril = new THREE.Mesh(mistTendrilGeo, mats.hardware)
    tendril.name = `maze-enemy-wraith-mist-tendril-${sideTag}`
    if (i === 1) {
      tendril.rotation.y = Math.PI * 0.65
    }
    tendril.userData.skipShadowCasting = true
    legPivot.add(tendril)
  }

  // Upper body & torn robes
  const upperBodyPivot = new THREE.Group()
  upperBodyPivot.name = 'maze-enemy-upper-body'
  upperBodyPivot.position.set(0, hipHeight, 0)
  rigScaleGroup.add(upperBodyPivot)

  const torsoMesh = new THREE.Mesh(torsoGeo, mats.plating)
  torsoMesh.name = 'maze-enemy-wraith-torso'
  upperBodyPivot.add(torsoMesh)

  const robeUpperMesh = new THREE.Mesh(robeTorsoGeo, mats.chassis)
  robeUpperMesh.name = 'maze-enemy-wraith-robe-upper'
  upperBodyPivot.add(robeUpperMesh)

  const robeVeilUpperMesh = new THREE.Mesh(robeVeilUpperGeo, mats.spines)
  robeVeilUpperMesh.name = 'maze-enemy-wraith-veil-upper'
  robeVeilUpperMesh.userData.skipShadowCasting = true
  upperBodyPivot.add(robeVeilUpperMesh)

  // Flowing shredded lower robe + dissolving mist skirt
  const lowerRobePivot = new THREE.Group()
  lowerRobePivot.name = 'maze-enemy-wraith-lower-robe-pivot'
  lowerRobePivot.position.set(0, lowerRobeOffsetY, 0)
  upperBodyPivot.add(lowerRobePivot)

  const robeSkirtMesh = new THREE.Mesh(robeSkirtGeo, mats.chassis)
  robeSkirtMesh.name = 'maze-enemy-wraith-robe-skirt'
  lowerRobePivot.add(robeSkirtMesh)

  const mistSkirtMesh = new THREE.Mesh(mistVeilGeo, mats.hardware)
  mistSkirtMesh.name = 'maze-enemy-wraith-mist-skirt'
  mistSkirtMesh.userData.skipShadowCasting = true
  lowerRobePivot.add(mistSkirtMesh)

  // Articulated slightly elongated neck -> head -> glowing recessed eyes
  const neckPivot = new THREE.Group()
  neckPivot.name = 'maze-enemy-wraith-neck-pivot'
  neckPivot.position.set(0, neckPivotOffsetY, -0.015)
  upperBodyPivot.add(neckPivot)

  const neckMesh = new THREE.Mesh(neckGeo, mats.plating)
  neckMesh.name = 'maze-enemy-wraith-neck'
  neckPivot.add(neckMesh)

  const headPivot = new THREE.Group()
  headPivot.name = 'maze-enemy-head-pivot'
  headPivot.position.set(0, headPivotOffsetY, -0.012)
  neckPivot.add(headPivot)

  const headMesh = new THREE.Mesh(headGeo, mats.plating)
  headMesh.name = 'maze-enemy-wraith-head'
  headPivot.add(headMesh)

  const sensorMesh = new THREE.Mesh(eyesGeo, mats.sensor)
  sensorMesh.name = 'maze-enemy-sensor-eye'
  sensorMesh.userData.skipShadowCasting = true
  headPivot.add(sensorMesh)

  let sensorLight = null
  if (sensorLightEnabled) {
    sensorLight = new THREE.PointLight(
      preset.sensorNormal,
      config.lightIntensity,
      config.lightDistance,
      2
    )
    sensorLight.name = 'maze-enemy-sensor-light'
    sensorLight.position.set(0, 0.145, -0.24)
    headPivot.add(sensorLight)
  }

  // Long, unnaturally thin articulated arms -> elbows -> wrists -> elongated clawed fingers
  const armPivots = { left: null, right: null }
  const elbowPivots = { left: null, right: null }
  const wristPivots = { left: null, right: null }
  const signs = [-1, 1]

  for (let i = 0; i < signs.length; i += 1) {
    const sign = signs[i]
    const sideTag = sign < 0 ? 'left' : 'right'
    const capSide = sign < 0 ? 'Left' : 'Right'

    const upperArmGeo = getPooledGeometry(`wraith:upperArm${capSide}`, () =>
      buildWraithUpperArmGeometry(sign)
    )
    const forearmGeo = getPooledGeometry(`wraith:forearm${capSide}`, () =>
      buildWraithForearmGeometry(sign)
    )
    const clawHandGeo = getPooledGeometry(`wraith:clawHand${capSide}`, () =>
      buildWraithClawHandGeometry(sign)
    )

    const armPivot = new THREE.Group()
    armPivot.name = `maze-enemy-arm-pivot-${sideTag}`
    armPivot.position.set(sign * 0.215, shoulderOffsetY, -0.005)
    upperBodyPivot.add(armPivot)
    armPivots[sideTag] = armPivot

    const upperArmMesh = new THREE.Mesh(upperArmGeo, mats.plating)
    upperArmMesh.name = `maze-enemy-wraith-upper-arm-${sideTag}`
    armPivot.add(upperArmMesh)

    const elbowPivot = new THREE.Group()
    elbowPivot.name = `maze-enemy-elbow-pivot-${sideTag}`
    elbowPivot.position.set(sign * 0.008, -0.42, 0)
    armPivot.add(elbowPivot)
    elbowPivots[sideTag] = elbowPivot

    const forearmMesh = new THREE.Mesh(forearmGeo, mats.plating)
    forearmMesh.name = `maze-enemy-wraith-forearm-${sideTag}`
    elbowPivot.add(forearmMesh)

    const wristPivot = new THREE.Group()
    wristPivot.name = `maze-enemy-wrist-pivot-${sideTag}`
    wristPivot.position.set(sign * 0.003, -0.44, 0)
    elbowPivot.add(wristPivot)
    wristPivots[sideTag] = wristPivot

    const clawHandMesh = new THREE.Mesh(clawHandGeo, mats.plating)
    clawHandMesh.name = `maze-enemy-wraith-claw-hand-${sideTag}`
    wristPivot.add(clawHandMesh)
  }

  return {
    scaleGroup: rigScaleGroup,
    upperBodyPivot,
    lowerRobePivot,
    neckPivot,
    headPivot,
    leftLegPivot: legPivots.left,
    rightLegPivot: legPivots.right,
    leftArmPivot: armPivots.left,
    rightArmPivot: armPivots.right,
    leftElbowPivot: elbowPivots.left,
    rightElbowPivot: elbowPivots.right,
    leftWristPivot: wristPivots.left,
    rightWristPivot: wristPivots.right,
    sensorMesh,
    sensorLight,
    materials: mats,
    restPose: {
      hipHeight,
      lowerRobeOffsetY,
      neckPivotOffsetY,
      shoulderOffsetY,
      headPivotOffsetY,
    },
  }
}

/**
 * Builds a procedural 3D horror enemy character ('stalker' -> The Wraith, 'hunter', or 'brute')
 * with distinct silhouette, geometry, ocular optics, and articulated rig pivots.
 */
export function buildEnemy(options = {}) {
  const enemyType =
    options?.type && options.type in ENEMY_VISUAL_PRESETS
      ? options.type
      : 'stalker'
  const preset = ENEMY_VISUAL_PRESETS[enemyType]

  const config = {
    ...DEFAULT_ENEMY_MODEL_CONFIG,
    lightIntensity: preset.lightIntensity,
    lightDistance: preset.lightDistance,
    ...(options?.config || {}),
  }

  const sensorLightEnabled =
    typeof options?.sensorLightEnabled === 'boolean'
      ? options.sensorLightEnabled
      : typeof config.sensorLightEnabled === 'boolean'
        ? config.sensorLightEnabled
        : true

  const root = new THREE.Group()
  root.name = `maze-enemy-root-${enemyType}-${options?.id || 'default'}`
  root.visible = options?.visible !== false

  const rigScaleGroup = new THREE.Group()
  rigScaleGroup.name = 'maze-enemy-scale-group'
  rigScaleGroup.scale.set(preset.scaleX, preset.scaleY, preset.scaleZ)
  root.add(rigScaleGroup)

  const mats = createEnemyMaterials(enemyType, preset)

  let rig
  let modelHeight = config.height * preset.scaleY

  if (enemyType === 'stalker') {
    rig = buildWraithRig(rigScaleGroup, mats, sensorLightEnabled, preset, config)
    modelHeight = 2.28 * preset.scaleY
  } else {
    const hipHeight = 0.96
    const shoulderOffsetY = 1.62 - hipHeight
    const headPivotOffsetY = 1.72 - hipHeight

    // --- Lower body: Articulated Leg Pivots ---
    const legPivots = { left: null, right: null }
    const legXOffsets = enemyType === 'brute' ? [-0.24, 0.24] : [-0.18, 0.18]

    const thighRadiusTop = enemyType === 'brute' ? 0.13 : 0.075
    const thighGeo = getPooledGeometry(
      `${enemyType}:thigh`,
      () => new THREE.CylinderGeometry(thighRadiusTop, thighRadiusTop * 0.78, 0.52, 8)
    )
    const shinGeo = getPooledGeometry(
      `${enemyType}:shin`,
      () =>
        new THREE.CylinderGeometry(
          enemyType === 'brute' ? 0.1 : 0.06,
          enemyType === 'brute' ? 0.085 : 0.045,
          0.54,
          8
        )
    )
    const clawGeo = getPooledGeometry(
      `${enemyType}:claw`,
      () =>
        enemyType === 'brute'
          ? new THREE.BoxGeometry(0.22, 0.14, 0.32)
          : new THREE.BoxGeometry(0.14, 0.12, 0.26)
    )

    for (let i = 0; i < legXOffsets.length; i += 1) {
      const sideX = legXOffsets[i]
      const sideTag = i === 0 ? 'left' : 'right'

      const legPivot = new THREE.Group()
      legPivot.name = `maze-enemy-leg-pivot-${sideTag}`
      legPivot.position.set(sideX, hipHeight, 0)
      rigScaleGroup.add(legPivot)
      legPivots[sideTag] = legPivot

      const thigh = new THREE.Mesh(thighGeo, mats.plating)
      thigh.name = `maze-enemy-thigh-${sideTag}`
      thigh.position.set(0, -0.22, 0.05)
      thigh.rotation.x = enemyType === 'hunter' ? -0.35 : -0.22
      legPivot.add(thigh)

      const shin = new THREE.Mesh(shinGeo, mats.chassis)
      shin.name = `maze-enemy-shin-${sideTag}`
      shin.position.set(0, -0.62, -0.04)
      shin.rotation.x = enemyType === 'hunter' ? 0.34 : 0.25
      legPivot.add(shin)

      const claw = new THREE.Mesh(clawGeo, mats.hardware)
      claw.name = `maze-enemy-claw-${sideTag}`
      claw.position.set(0, 0.06 - hipHeight, -0.06)
      claw.userData.skipShadowCasting = true
      legPivot.add(claw)
    }

    // --- Upper Body Pivot ---
    const upperBodyPivot = new THREE.Group()
    upperBodyPivot.name = 'maze-enemy-upper-body'
    upperBodyPivot.position.set(0, hipHeight, 0)
    rigScaleGroup.add(upperBodyPivot)

    const carapaceGeo = getPooledGeometry(
      `${enemyType}:carapace`,
      () =>
        enemyType === 'brute'
          ? new THREE.BoxGeometry(0.68, 0.68, 0.52)
          : new THREE.BoxGeometry(0.48, 0.58, 0.38)
    )
    const carapace = new THREE.Mesh(carapaceGeo, mats.chassis)
    carapace.name = 'maze-enemy-carapace'
    carapace.position.set(0, 1.32 - hipHeight, 0.08)
    carapace.rotation.x = enemyType === 'hunter' ? 0.42 : 0.14
    upperBodyPivot.add(carapace)

    const chestPlateGeo = getPooledGeometry(
      `${enemyType}:chestPlate`,
      () =>
        enemyType === 'brute'
          ? new THREE.BoxGeometry(0.56, 0.48, 0.24)
          : new THREE.CylinderGeometry(0.24, 0.18, 0.44, 8)
    )
    const chestPlate = new THREE.Mesh(chestPlateGeo, mats.plating)
    chestPlate.name = 'maze-enemy-chest-plate'
    chestPlate.position.set(0, 1.34 - hipHeight, -0.1)
    chestPlate.rotation.x = enemyType === 'hunter' ? 0.34 : 0.2
    upperBodyPivot.add(chestPlate)

    // Archetype dorsal silhouettes
    if (enemyType === 'brute') {
      const reactorGeo = getPooledGeometry(
        'brute:reactor',
        () => new THREE.CylinderGeometry(0.08, 0.1, 0.32, 8)
      )
      for (const sign of [-1, 1]) {
        const reactor = new THREE.Mesh(reactorGeo, mats.spines)
        reactor.name = `maze-enemy-reactor-${sign < 0 ? 'left' : 'right'}`
        reactor.position.set(sign * 0.22, 1.66 - hipHeight, 0.24)
        reactor.rotation.x = 0.25
        upperBodyPivot.add(reactor)
      }
    } else {
      const spineCount = 4
      const spineGeo = getPooledGeometry(
        `${enemyType}:spine`,
        () => new THREE.ConeGeometry(0.045, 0.22, 6)
      )
      for (let s = 0; s < spineCount; s += 1) {
        const spine = new THREE.Mesh(spineGeo, mats.spines)
        spine.name = `maze-enemy-spine-${s}`
        spine.position.set(0, 1.15 + s * 0.14 - hipHeight, 0.25 + s * 0.04)
        spine.rotation.x = 0.72
        upperBodyPivot.add(spine)
      }
    }

    // --- Arm Pivots ---
    const armPivots = { left: null, right: null }
    const armSigns = [-1, 1]
    const upperArmGeo = getPooledGeometry(
      `${enemyType}:upperArm`,
      () =>
        enemyType === 'brute'
          ? new THREE.CylinderGeometry(0.11, 0.095, 0.62, 8)
          : new THREE.CylinderGeometry(0.065, 0.052, 0.58, 8)
    )
    const foreArmGeo = getPooledGeometry(
      `${enemyType}:foreArm`,
      () =>
        enemyType === 'brute'
          ? new THREE.BoxGeometry(0.19, 0.62, 0.19)
          : new THREE.CylinderGeometry(0.052, 0.038, 0.62, 8)
    )
    const bladeHandGeo = getPooledGeometry(
      `${enemyType}:bladeHand`,
      () =>
        enemyType === 'brute'
          ? new THREE.BoxGeometry(0.24, 0.28, 0.26)
          : new THREE.ConeGeometry(0.055, 0.32, 6)
    )
    const shoulderJointGeo = getPooledGeometry(
      `${enemyType}:shoulderJoint`,
      () => new THREE.SphereGeometry(enemyType === 'brute' ? 0.16 : 0.09, 8, 8)
    )
    const pauldronGeo =
      enemyType === 'brute'
        ? getPooledGeometry(
            'brute:pauldron',
            () => new THREE.BoxGeometry(0.28, 0.2, 0.32)
          )
        : null

    const shoulderX = enemyType === 'brute' ? 0.44 : 0.32

    for (let i = 0; i < armSigns.length; i += 1) {
      const sign = armSigns[i]
      const sideTag = sign < 0 ? 'left' : 'right'

      const armPivot = new THREE.Group()
      armPivot.name = `maze-enemy-arm-pivot-${sideTag}`
      armPivot.position.set(sign * shoulderX, shoulderOffsetY, 0.04)
      upperBodyPivot.add(armPivot)
      armPivots[sideTag] = armPivot

      const shoulderJoint = new THREE.Mesh(shoulderJointGeo, mats.joints)
      shoulderJoint.name = `maze-enemy-shoulder-joint-${sideTag}`
      shoulderJoint.userData.skipShadowCasting = true
      armPivot.add(shoulderJoint)

      if (pauldronGeo) {
        const pauldron = new THREE.Mesh(pauldronGeo, mats.spines)
        pauldron.name = `maze-enemy-pauldron-${sideTag}`
        pauldron.position.set(sign * 0.04, 0.08, 0)
        pauldron.rotation.z = -sign * 0.22
        armPivot.add(pauldron)
      }

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
      bladeHand.rotation.x = enemyType === 'hunter' ? -Math.PI * 0.65 : 0.4
      armPivot.add(bladeHand)
    }

    // --- Head & Ocular Sensor Pivot facing -Z ---
    const headPivot = new THREE.Group()
    headPivot.name = 'maze-enemy-head-pivot'
    headPivot.position.set(0, headPivotOffsetY, enemyType === 'hunter' ? -0.24 : -0.18)
    upperBodyPivot.add(headPivot)

    const headCowlGeo = getPooledGeometry(
      `${enemyType}:headCowl`,
      () =>
        enemyType === 'brute'
          ? new THREE.BoxGeometry(0.38, 0.28, 0.36)
          : new THREE.BoxGeometry(0.26, 0.22, 0.34)
    )
    const headCowl = new THREE.Mesh(headCowlGeo, mats.chassis)
    headCowl.name = 'maze-enemy-head-cowl'
    headCowl.position.set(0, 0.04, 0)
    headCowl.rotation.x = 0.12
    headPivot.add(headCowl)

    const browGeo = getPooledGeometry(
      `${enemyType}:brow`,
      () =>
        enemyType === 'brute'
          ? new THREE.BoxGeometry(0.4, 0.1, 0.16)
          : new THREE.BoxGeometry(0.28, 0.08, 0.14)
    )
    const brow = new THREE.Mesh(browGeo, mats.plating)
    brow.name = 'maze-enemy-brow'
    brow.position.set(0, 0.1, -0.12)
    brow.userData.skipShadowCasting = true
    headPivot.add(brow)

    if (enemyType === 'hunter') {
      const earGeo = getPooledGeometry(
        'hunter:ear',
        () => new THREE.ConeGeometry(0.035, 0.22, 6)
      )
      for (const sign of [-1, 1]) {
        const ear = new THREE.Mesh(earGeo, mats.spines)
        ear.name = `maze-enemy-acoustic-ear-${sign < 0 ? 'left' : 'right'}`
        ear.position.set(sign * 0.12, 0.2, 0.02)
        ear.rotation.z = -sign * 0.32
        ear.rotation.x = -0.35
        headPivot.add(ear)
      }
    }

    const sensorGeo = getPooledGeometry(
      `${enemyType}:sensor`,
      () =>
        enemyType === 'hunter'
          ? new THREE.BoxGeometry(0.22, 0.035, 0.045)
          : new THREE.BoxGeometry(0.28, 0.065, 0.05)
    )
    const sensorMesh = new THREE.Mesh(sensorGeo, mats.sensor)
    sensorMesh.name = 'maze-enemy-sensor-eye'
    sensorMesh.position.set(0, 0.04, -0.185)
    sensorMesh.userData.skipShadowCasting = true
    headPivot.add(sensorMesh)

    let sensorLight = null
    if (sensorLightEnabled) {
      sensorLight = new THREE.PointLight(
        preset.sensorNormal,
        config.lightIntensity,
        config.lightDistance,
        2
      )
      sensorLight.name = 'maze-enemy-sensor-light'
      sensorLight.position.set(0, 0.04, -0.34)
      headPivot.add(sensorLight)
    }

    rig = {
      scaleGroup: rigScaleGroup,
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
    }
  }

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
    enemyType,
    id: options?.id || enemyType,
    height: modelHeight,
    radius: config.radius * preset.scaleX,
    typePalette: preset,
    lightConfig: {
      intensity: config.lightIntensity,
      distance: config.lightDistance,
    },
    _visualState: null,
    rig,
  }

  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = !node.userData?.skipShadowCasting
      node.receiveShadow = true
    }
  })

  return root
}

/**
 * Dynamically enables or disables an enemy's localized ocular PointLight in place
 * without resetting AI state or rebuilding the enemy rig.
 */
export function setEnemySensorLightEnabled(enemyGroup, enabled) {
  const rig = enemyGroup?.userData?.rig
  if (!rig) return false
  const want = Boolean(enabled)
  const existing = rig.sensorLight

  if (!want) {
    if (existing) {
      if (existing.parent) {
        existing.parent.remove(existing)
      }
      existing.dispose?.()
      rig.sensorLight = null
    }
    return false
  }

  if (!existing && rig.headPivot) {
    const preset = enemyGroup.userData.typePalette || ENEMY_VISUAL_PRESETS.stalker
    const lightCfg = enemyGroup.userData.lightConfig || { intensity: 1.5, distance: 7.5 }
    const light = new THREE.PointLight(
      preset.sensorNormal,
      lightCfg.intensity,
      lightCfg.distance,
      2
    )
    light.name = 'maze-enemy-sensor-light'
    if (enemyGroup.userData.enemyType === 'stalker') {
      light.position.set(0, 0.145, -0.24)
    } else {
      light.position.set(0, 0.04, -0.34)
    }
    rig.headPivot.add(light)
    rig.sensorLight = light

    const prevState = enemyGroup.userData._visualState || 'patrol'
    enemyGroup.userData._visualState = null
    updateEnemyVisualState(enemyGroup, prevState)
  }

  return Boolean(rig.sensorLight)
}

/**
 * Updates an enemy's ocular sensor color and illumination based on AI alert state.
 */
export function updateEnemyVisualState(enemyGroup, state) {
  if (!enemyGroup?.userData?.rig) return

  const resolvedState = state || 'patrol'
  if (enemyGroup.userData._visualState === resolvedState) {
    return
  }

  const { sensorMesh, sensorLight } = enemyGroup.userData.rig
  if (!sensorMesh) return

  const isWraith = enemyGroup.userData.enemyType === 'stalker'
  const preset = enemyGroup.userData.typePalette || ENEMY_VISUAL_PRESETS.stalker
  let color
  let emissive
  let intensity
  let eyeEmissiveIntensity

  switch (resolvedState) {
    case 'attack':
      color = 0xff0033
      emissive = 0xff0022
      intensity = 3.6
      eyeEmissiveIntensity = 2.1
      break
    case 'chase':
      color = preset.sensorChase
      emissive = preset.sensorChase
      intensity = 2.4
      eyeEmissiveIntensity = 1.65
      break
    case 'investigate':
    case 'search':
      color = preset.sensorAlert
      emissive = preset.sensorAlert
      intensity = 1.7
      eyeEmissiveIntensity = 1.15
      break
    case 'patrol':
    case 'idle':
    default:
      color = preset.sensorNormal
      emissive = preset.sensorNormal
      intensity = 1.1
      eyeEmissiveIntensity = 0.85
      break
  }

  if (sensorMesh.material) {
    sensorMesh.material.color.setHex(color)
    sensorMesh.material.emissive.setHex(emissive)
    if (isWraith) {
      sensorMesh.material.emissiveIntensity = eyeEmissiveIntensity
    }
  }
  if (sensorLight) {
    sensorLight.color.setHex(color)
    sensorLight.intensity = intensity
  }
  enemyGroup.userData._visualState = resolvedState
}

/**
 * Safely disposes instance-owned geometries, materials, and lights owned by an enemy model
 * without destroying shared pooled geometries/materials.
 */
export function disposeEnemy(enemyGroup) {
  if (!enemyGroup) return false

  const disposedGeos = new Set()
  const disposedMats = new Set()

  enemyGroup.traverse((node) => {
    if (
      node.geometry &&
      !isSharedResource(node.geometry) &&
      !disposedGeos.has(node.geometry)
    ) {
      disposedGeos.add(node.geometry)
      node.geometry.dispose?.()
    }
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (let i = 0; i < mats.length; i += 1) {
        const m = mats[i]
        if (m && !isSharedResource(m) && !disposedMats.has(m)) {
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
