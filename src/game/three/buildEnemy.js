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
import {
  buildRevenantForearmGeometry,
  buildRevenantHandGeometry,
  buildRevenantHeadAndEyesGeometries,
  buildRevenantNeckGeometry,
  buildRevenantShinAndFootGeometry,
  buildRevenantSleeveRagGeometry,
  buildRevenantThighTrouserGeometry,
  buildRevenantTorsoGeometries,
  buildRevenantUpperArmGeometry,
} from './revenantGeometry.js'
import {
  buildPhantomForearmGeometry,
  buildPhantomHandGeometry,
  buildPhantomHeadAndEyesGeometries,
  buildPhantomLegShadowGeometry,
  buildPhantomNeckGeometry,
  buildPhantomParticlesGeometries,
  buildPhantomShoulderRagGeometry,
  buildPhantomTorsoGeometries,
  buildPhantomUpperArmGeometry,
} from './phantomGeometry.js'

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
    chassis: 0x2c2722,
    plating: 0x7b8072,
    spines: 0x1d1a18,
    hardware: 0x64685e,
    sensorNormal: 0x14b8a6,
    sensorAlert: 0xfacc15,
    sensorChase: 0xf43f5e,
    lightDistance: 10.0,
    lightIntensity: 2.4,
  },
  brute: {
    scaleX: 1.12,
    scaleY: 1.18,
    scaleZ: 1.12,
    chassis: 0x0b0912,
    plating: 0x1a1529,
    spines: 0x2d2444,
    hardware: 0xc4b5fd,
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

  if (enemyType === 'hunter') {
    const chassis = getPooledMaterial(
      'hunter:chassis',
      () =>
        new THREE.MeshStandardMaterial({
          color: preset.chassis,
          roughness: 0.96,
          metalness: 0.01,
          side: THREE.DoubleSide,
          vertexColors: true,
        })
    )

    const plating = getPooledMaterial(
      'hunter:plating',
      () =>
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.78,
          metalness: 0.02,
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
      'hunter:spines',
      () =>
        new THREE.MeshStandardMaterial({
          color: preset.spines,
          roughness: 0.96,
          metalness: 0.0,
          side: THREE.DoubleSide,
          vertexColors: true,
        })
    )

    // Instance-owned material for recessed dead cataract eyeballs with muted state tinting
    const sensor = new THREE.MeshStandardMaterial({
      color: preset.sensorNormal,
      emissive: preset.sensorNormal,
      emissiveIntensity: 0.32,
      roughness: 0.42,
      metalness: 0.04,
      vertexColors: true,
    })

    return { chassis, plating, joints, spines, hardware: chassis, sensor }
  }

  // 'brute' -> The Phantom (opaque abyssal void core + layered translucent shadow shroud & rising particle shader)
  const chassis = getPooledMaterial(
    'brute:chassis',
    () =>
      new THREE.MeshStandardMaterial({
        color: preset.chassis,
        roughness: 0.88,
        metalness: 0.04,
        transparent: false,
        vertexColors: true,
      })
  )

  const plating = getPooledMaterial(
    'brute:plating',
    () =>
      new THREE.MeshStandardMaterial({
        color: preset.plating,
        roughness: 0.92,
        metalness: 0.0,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide,
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
    'brute:spines',
    () =>
      new THREE.MeshStandardMaterial({
        color: preset.spines,
        emissive: 0x160e2a,
        emissiveIntensity: 0.4,
        roughness: 0.8,
        metalness: 0.0,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexColors: true,
      })
  )

  // Instance-owned additive particle material with per-mote shader drift, rise, and lifecycle fade
  const particleUniforms = {
    uTime: { value: 0 },
    uMotionScale: { value: 1 },
    uAlertBoost: { value: 0 },
  }
  const hardware = new THREE.PointsMaterial({
    size: 0.068,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  hardware.userData.particleUniforms = particleUniforms
  hardware.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = particleUniforms.uTime
    shader.uniforms.uMotionScale = particleUniforms.uMotionScale
    shader.uniforms.uAlertBoost = particleUniforms.uAlertBoost

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aPhase;
        uniform float uTime;
        uniform float uMotionScale;
        uniform float uAlertBoost;
        varying float vMoteFade;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float moteSpeed = (0.18 + uAlertBoost * 0.14) * max(0.2, uMotionScale);
        float moteLife = fract(aPhase + uTime * moteSpeed);
        float cloudMinY = 0.12;
        float cloudSpanY = 1.96;
        float targetY = mod(position.y - cloudMinY + moteLife * cloudSpanY, cloudSpanY) + cloudMinY;
        float swirlAngle = moteLife * 6.2831853 + aPhase * 6.2831853;
        float swirlRadius = (0.045 + 0.032 * uAlertBoost) * uMotionScale;
        transformed.y = targetY;
        transformed.x += cos(swirlAngle) * swirlRadius;
        transformed.z += sin(swirlAngle) * swirlRadius;
        vMoteFade = sin(moteLife * 3.14159265);`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uAlertBoost;
        varying float vMoteFade;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec2 cxy = 2.0 * gl_PointCoord - 1.0;
        float r2 = dot(cxy, cxy);
        if (r2 > 1.0) discard;
        diffuseColor.a *= pow(1.0 - r2, 1.8) * vMoteFade * (0.88 + 0.28 * uAlertBoost);`
      )
  }

  // Instance-owned material for faint supernatural glowing eyes in shadowed featureless face
  const sensor = new THREE.MeshStandardMaterial({
    color: preset.sensorNormal,
    emissive: preset.sensorNormal,
    emissiveIntensity: 0.95,
    roughness: 0.22,
    metalness: 0.04,
    vertexColors: true,
  })

  return { chassis, plating, joints, spines, hardware, sensor, particleUniforms }
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

  // Upper body & torn robes
  const upperBodyPivot = new THREE.Group()
  upperBodyPivot.name = 'maze-enemy-upper-body'
  upperBodyPivot.position.set(0, hipHeight, 0)
  rigScaleGroup.add(upperBodyPivot)

  // Lower body: dissolving mist tendrils parented under upperBodyPivot so hover bobbing stays coupled
  const legPivots = { left: null, right: null }
  const tendrilOffsets = [-0.11, 0.11]
  for (let i = 0; i < tendrilOffsets.length; i += 1) {
    const sideTag = i === 0 ? 'left' : 'right'
    const legPivot = new THREE.Group()
    legPivot.name = `maze-enemy-leg-pivot-${sideTag}`
    legPivot.position.set(tendrilOffsets[i], 0.02, 0.02)
    upperBodyPivot.add(legPivot)
    legPivots[sideTag] = legPivot

    const tendril = new THREE.Mesh(mistTendrilGeo, mats.hardware)
    tendril.name = `maze-enemy-wraith-mist-tendril-${sideTag}`
    if (i === 1) {
      tendril.rotation.y = Math.PI * 0.65
    }
    tendril.renderOrder = 2
    tendril.userData.skipShadowCasting = true
    legPivot.add(tendril)
  }

  const torsoMesh = new THREE.Mesh(torsoGeo, mats.plating)
  torsoMesh.name = 'maze-enemy-wraith-torso'
  upperBodyPivot.add(torsoMesh)

  const robeUpperMesh = new THREE.Mesh(robeTorsoGeo, mats.chassis)
  robeUpperMesh.name = 'maze-enemy-wraith-robe-upper'
  upperBodyPivot.add(robeUpperMesh)

  const robeVeilUpperMesh = new THREE.Mesh(robeVeilUpperGeo, mats.spines)
  robeVeilUpperMesh.name = 'maze-enemy-wraith-veil-upper'
  robeVeilUpperMesh.renderOrder = 2
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
  mistSkirtMesh.renderOrder = 2
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

function buildRevenantRig(rigScaleGroup, mats, sensorLightEnabled, preset, config) {
  const hipHeight = 0.948
  const neckPivotOffsetY = 0.62
  const headPivotOffsetY = 0.14
  const leftShoulderOffsetY = 0.545
  const rightShoulderOffsetY = 0.6

  // Paired torso geometries (decayed flesh + exposed bones vs ragged open burial coat)
  if (!enemyGeoPool.has('revenant:torsoFlesh') || !enemyGeoPool.has('revenant:torsoClothes')) {
    const { torsoFlesh, torsoClothes } = buildRevenantTorsoGeometries()
    if (!enemyGeoPool.has('revenant:torsoFlesh')) {
      enemyGeoPool.set('revenant:torsoFlesh', markSharedResource(torsoFlesh))
    } else {
      torsoFlesh.dispose()
    }
    if (!enemyGeoPool.has('revenant:torsoClothes')) {
      enemyGeoPool.set('revenant:torsoClothes', markSharedResource(torsoClothes))
    } else {
      torsoClothes.dispose()
    }
  }

  // Paired head flesh + sparse matted hair + sunken dead eyeballs
  if (
    !enemyGeoPool.has('revenant:headFlesh') ||
    !enemyGeoPool.has('revenant:headHair') ||
    !enemyGeoPool.has('revenant:eyes')
  ) {
    const { headFlesh, headHair, eyes } = buildRevenantHeadAndEyesGeometries()
    const entries = [
      ['revenant:headFlesh', headFlesh],
      ['revenant:headHair', headHair],
      ['revenant:eyes', eyes],
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

  const torsoFleshGeo = enemyGeoPool.get('revenant:torsoFlesh')
  const torsoClothesGeo = enemyGeoPool.get('revenant:torsoClothes')
  const neckGeo = getPooledGeometry('revenant:neckFlesh', buildRevenantNeckGeometry)
  const headGeo = enemyGeoPool.get('revenant:headFlesh')
  const hairGeo = enemyGeoPool.get('revenant:headHair')
  const eyesGeo = enemyGeoPool.get('revenant:eyes')
  const sleeveRagGeo = getPooledGeometry('revenant:sleeveRag', buildRevenantSleeveRagGeometry)
  const thighTrouserGeo = getPooledGeometry('revenant:thighTrouser', buildRevenantThighTrouserGeometry)

  // --- Lower Body: Articulated legs -> knees -> decayed bare shins & feet ---
  const legPivots = { left: null, right: null }
  const kneePivots = { left: null, right: null }
  const legSpecs = [
    { sideTag: 'left', capSide: 'Left', isRight: false, x: -0.145, z: 0.02, rotZ: -0.04 },
    { sideTag: 'right', capSide: 'Right', isRight: true, x: 0.155, z: -0.01, rotZ: 0.025 },
  ]

  for (let i = 0; i < legSpecs.length; i += 1) {
    const spec = legSpecs[i]
    const shinFootGeo = getPooledGeometry(`revenant:shinFoot${spec.capSide}`, () =>
      buildRevenantShinAndFootGeometry(spec.isRight)
    )

    const legPivot = new THREE.Group()
    legPivot.name = `maze-enemy-leg-pivot-${spec.sideTag}`
    legPivot.position.set(spec.x, hipHeight, spec.z)
    legPivot.rotation.z = spec.rotZ
    rigScaleGroup.add(legPivot)
    legPivots[spec.sideTag] = legPivot

    const thighMesh = new THREE.Mesh(thighTrouserGeo, mats.chassis)
    thighMesh.name = `maze-enemy-revenant-thigh-${spec.sideTag}`
    if (spec.isRight) thighMesh.rotation.y = 0.28
    legPivot.add(thighMesh)

    const kneePivot = new THREE.Group()
    kneePivot.name = `maze-enemy-knee-pivot-${spec.sideTag}`
    kneePivot.position.set(0, -0.44, 0)
    kneePivot.rotation.x = spec.isRight ? -0.06 : -0.14
    legPivot.add(kneePivot)
    kneePivots[spec.sideTag] = kneePivot

    const shinMesh = new THREE.Mesh(shinFootGeo, mats.plating)
    shinMesh.name = `maze-enemy-revenant-shin-${spec.sideTag}`
    kneePivot.add(shinMesh)
  }

  // --- Upper Body: Forward-hunched, slightly twisted posture + ragged coat over necrotic torso ---
  const upperBodyPivot = new THREE.Group()
  upperBodyPivot.name = 'maze-enemy-upper-body'
  upperBodyPivot.position.set(0, hipHeight, 0)
  upperBodyPivot.rotation.set(-0.14, 0.05, -0.055)
  rigScaleGroup.add(upperBodyPivot)

  const torsoFleshMesh = new THREE.Mesh(torsoFleshGeo, mats.plating)
  torsoFleshMesh.name = 'maze-enemy-revenant-flesh'
  upperBodyPivot.add(torsoFleshMesh)

  const torsoClothesMesh = new THREE.Mesh(torsoClothesGeo, mats.chassis)
  torsoClothesMesh.name = 'maze-enemy-revenant-torso'
  upperBodyPivot.add(torsoClothesMesh)

  // --- Crooked neck -> asymmetrical decayed head -> matted hair -> dead sunken eyes ---
  const neckPivot = new THREE.Group()
  neckPivot.name = 'maze-enemy-revenant-neck-pivot'
  neckPivot.position.set(0.01, neckPivotOffsetY, -0.018)
  neckPivot.rotation.set(-0.12, -0.03, 0.085)
  upperBodyPivot.add(neckPivot)

  const neckMesh = new THREE.Mesh(neckGeo, mats.plating)
  neckMesh.name = 'maze-enemy-revenant-neck'
  neckPivot.add(neckMesh)

  const headPivot = new THREE.Group()
  headPivot.name = 'maze-enemy-head-pivot'
  headPivot.position.set(0.008, headPivotOffsetY, -0.012)
  headPivot.rotation.set(0.1, 0.02, -0.11)
  neckPivot.add(headPivot)

  const headMesh = new THREE.Mesh(headGeo, mats.plating)
  headMesh.name = 'maze-enemy-revenant-head'
  headPivot.add(headMesh)

  const hairMesh = new THREE.Mesh(hairGeo, mats.spines)
  hairMesh.name = 'maze-enemy-revenant-hair'
  hairMesh.userData.skipShadowCasting = true
  headPivot.add(hairMesh)

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
    sensorLight.position.set(0, 0.125, -0.22)
    headPivot.add(sensorLight)
  }

  // --- Uneven shoulders -> tattered sleeves -> elbows -> forearms -> bony damaged hands ---
  const armPivots = { left: null, right: null }
  const elbowPivots = { left: null, right: null }
  const wristPivots = { left: null, right: null }
  const armSpecs = [
    {
      sign: -1,
      sideTag: 'left',
      capSide: 'Left',
      posX: -0.205,
      posY: leftShoulderOffsetY,
      posZ: 0.02,
      armRotZ: -0.06,
      elbowRotX: 0.24,
      sleeveRotZ: 0.06,
      sleeveRotY: 0.2,
    },
    {
      sign: 1,
      sideTag: 'right',
      capSide: 'Right',
      posX: 0.215,
      posY: rightShoulderOffsetY,
      posZ: -0.015,
      armRotZ: 0.06,
      elbowRotX: 0.58,
      sleeveRotZ: -0.05,
      sleeveRotY: -0.35,
    },
  ]

  for (let i = 0; i < armSpecs.length; i += 1) {
    const spec = armSpecs[i]
    const upperArmGeo = getPooledGeometry(`revenant:upperArm${spec.capSide}`, () =>
      buildRevenantUpperArmGeometry(spec.sign)
    )
    const forearmGeo = getPooledGeometry(`revenant:forearm${spec.capSide}`, () =>
      buildRevenantForearmGeometry(spec.sign)
    )
    const handGeo = getPooledGeometry(`revenant:hand${spec.capSide}`, () =>
      buildRevenantHandGeometry(spec.sign)
    )

    const armPivot = new THREE.Group()
    armPivot.name = `maze-enemy-arm-pivot-${spec.sideTag}`
    armPivot.position.set(spec.posX, spec.posY, spec.posZ)
    armPivot.rotation.z = spec.armRotZ
    upperBodyPivot.add(armPivot)
    armPivots[spec.sideTag] = armPivot

    const upperArmMesh = new THREE.Mesh(upperArmGeo, mats.plating)
    upperArmMesh.name = `maze-enemy-revenant-upper-arm-${spec.sideTag}`
    armPivot.add(upperArmMesh)

    const sleeveMesh = new THREE.Mesh(sleeveRagGeo, mats.chassis)
    sleeveMesh.name = `maze-enemy-revenant-sleeve-${spec.sideTag}`
    sleeveMesh.rotation.set(0, spec.sleeveRotY, spec.sleeveRotZ)
    armPivot.add(sleeveMesh)

    const elbowPivot = new THREE.Group()
    elbowPivot.name = `maze-enemy-elbow-pivot-${spec.sideTag}`
    elbowPivot.position.set(spec.sign * 0.008, -0.37, 0)
    elbowPivot.rotation.x = spec.elbowRotX
    armPivot.add(elbowPivot)
    elbowPivots[spec.sideTag] = elbowPivot

    const forearmMesh = new THREE.Mesh(forearmGeo, mats.plating)
    forearmMesh.name = `maze-enemy-revenant-forearm-${spec.sideTag}`
    elbowPivot.add(forearmMesh)

    const wristPivot = new THREE.Group()
    wristPivot.name = `maze-enemy-wrist-pivot-${spec.sideTag}`
    wristPivot.position.set(spec.sign * 0.003, -0.39, 0)
    elbowPivot.add(wristPivot)
    wristPivots[spec.sideTag] = wristPivot

    const handMesh = new THREE.Mesh(handGeo, mats.plating)
    handMesh.name = `maze-enemy-revenant-hand-${spec.sideTag}`
    wristPivot.add(handMesh)
  }

  return {
    scaleGroup: rigScaleGroup,
    upperBodyPivot,
    neckPivot,
    headPivot,
    leftLegPivot: legPivots.left,
    rightLegPivot: legPivots.right,
    leftKneePivot: kneePivots.left,
    rightKneePivot: kneePivots.right,
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
      neckPivotOffsetY,
      headPivotOffsetY,
      leftShoulderOffsetY,
      rightShoulderOffsetY,
    },
  }
}

function buildPhantomRig(rigScaleGroup, mats, sensorLightEnabled, preset, config) {
  const hipHeight = 1.05
  const neckPivotOffsetY = 0.65
  const headPivotOffsetY = 0.185
  const leftShoulderOffsetY = 0.625
  const rightShoulderOffsetY = 0.555

  if (!enemyGeoPool.has('phantom:torsoCore') || !enemyGeoPool.has('phantom:torsoShroud')) {
    const { torsoCore, torsoShroud } = buildPhantomTorsoGeometries()
    if (!enemyGeoPool.has('phantom:torsoCore')) {
      enemyGeoPool.set('phantom:torsoCore', markSharedResource(torsoCore))
    } else {
      torsoCore.dispose()
    }
    if (!enemyGeoPool.has('phantom:torsoShroud')) {
      enemyGeoPool.set('phantom:torsoShroud', markSharedResource(torsoShroud))
    } else {
      torsoShroud.dispose()
    }
  }

  if (
    !enemyGeoPool.has('phantom:headCore') ||
    !enemyGeoPool.has('phantom:headVeil') ||
    !enemyGeoPool.has('phantom:eyes')
  ) {
    const { headCore, headVeil, eyes } = buildPhantomHeadAndEyesGeometries()
    const entries = [
      ['phantom:headCore', headCore],
      ['phantom:headVeil', headVeil],
      ['phantom:eyes', eyes],
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

  if (
    !enemyGeoPool.has('phantom:particlesInner') ||
    !enemyGeoPool.has('phantom:particlesOuter')
  ) {
    const { particlesInner, particlesOuter } = buildPhantomParticlesGeometries()
    if (!enemyGeoPool.has('phantom:particlesInner')) {
      enemyGeoPool.set('phantom:particlesInner', markSharedResource(particlesInner))
    } else {
      particlesInner.dispose()
    }
    if (!enemyGeoPool.has('phantom:particlesOuter')) {
      enemyGeoPool.set('phantom:particlesOuter', markSharedResource(particlesOuter))
    } else {
      particlesOuter.dispose()
    }
  }

  const torsoCoreGeo = enemyGeoPool.get('phantom:torsoCore')
  const torsoShroudGeo = enemyGeoPool.get('phantom:torsoShroud')
  const neckGeo = getPooledGeometry('phantom:neckCore', buildPhantomNeckGeometry)
  const headCoreGeo = enemyGeoPool.get('phantom:headCore')
  const headVeilGeo = enemyGeoPool.get('phantom:headVeil')
  const eyesGeo = enemyGeoPool.get('phantom:eyes')
  const upperArmGeo = getPooledGeometry('phantom:upperArm', buildPhantomUpperArmGeometry)
  const forearmGeo = getPooledGeometry('phantom:forearm', buildPhantomForearmGeometry)
  const shoulderRagGeo = getPooledGeometry('phantom:shoulderRag', buildPhantomShoulderRagGeometry)
  const legShadowGeo = getPooledGeometry('phantom:legShadow', buildPhantomLegShadowGeometry)
  const particlesInnerGeo = enemyGeoPool.get('phantom:particlesInner')
  const particlesOuterGeo = enemyGeoPool.get('phantom:particlesOuter')

  // --- Upper Body: Distorted narrow waist + hunched dislocated shoulders + outer layered shroud ---
  const upperBodyPivot = new THREE.Group()
  upperBodyPivot.name = 'maze-enemy-upper-body'
  upperBodyPivot.position.set(0, hipHeight, 0)
  upperBodyPivot.rotation.set(-0.11, 0.0, 0.035)
  rigScaleGroup.add(upperBodyPivot)

  // --- Lower Body: Shadow legs parented under upperBodyPivot so hover bobbing stays coupled ---
  const legPivots = { left: null, right: null }
  const legSpecs = [
    { sideTag: 'left', x: -0.17, z: 0.015, rotY: 0.14, rotZ: -0.04 },
    { sideTag: 'right', x: 0.17, z: -0.01, rotY: -0.22, rotZ: 0.035 },
  ]
  for (let i = 0; i < legSpecs.length; i += 1) {
    const spec = legSpecs[i]
    const legPivot = new THREE.Group()
    legPivot.name = `maze-enemy-leg-pivot-${spec.sideTag}`
    legPivot.position.set(spec.x, 0, spec.z)
    legPivot.rotation.z = spec.rotZ
    upperBodyPivot.add(legPivot)
    legPivots[spec.sideTag] = legPivot

    const legMesh = new THREE.Mesh(legShadowGeo, mats.chassis)
    legMesh.name = `maze-enemy-phantom-leg-${spec.sideTag}`
    legMesh.rotation.y = spec.rotY
    legPivot.add(legMesh)
  }

  const torsoMesh = new THREE.Mesh(torsoCoreGeo, mats.chassis)
  torsoMesh.name = 'maze-enemy-phantom-torso'
  upperBodyPivot.add(torsoMesh)

  const shroudPivot = new THREE.Group()
  shroudPivot.name = 'maze-enemy-phantom-shroud-pivot'
  upperBodyPivot.add(shroudPivot)

  const shroudMesh = new THREE.Mesh(torsoShroudGeo, mats.plating)
  shroudMesh.name = 'maze-enemy-phantom-shroud'
  shroudMesh.renderOrder = 2
  shroudMesh.userData.skipShadowCasting = true
  shroudPivot.add(shroudMesh)

  // --- Unnaturally craned/twisted neck -> dark featureless face -> faint glowing eyes ---
  const neckPivot = new THREE.Group()
  neckPivot.name = 'maze-enemy-phantom-neck-pivot'
  neckPivot.position.set(0.014, neckPivotOffsetY, -0.042)
  neckPivot.rotation.set(-0.16, 0.0, -0.09)
  upperBodyPivot.add(neckPivot)

  const neckMesh = new THREE.Mesh(neckGeo, mats.chassis)
  neckMesh.name = 'maze-enemy-phantom-neck'
  neckPivot.add(neckMesh)

  const headPivot = new THREE.Group()
  headPivot.name = 'maze-enemy-head-pivot'
  headPivot.position.set(0.018, headPivotOffsetY, -0.052)
  headPivot.rotation.set(0.1, 0.0, 0.13)
  neckPivot.add(headPivot)

  const headMesh = new THREE.Mesh(headCoreGeo, mats.chassis)
  headMesh.name = 'maze-enemy-phantom-head'
  headPivot.add(headMesh)

  const veilMesh = new THREE.Mesh(headVeilGeo, mats.spines)
  veilMesh.name = 'maze-enemy-phantom-veil'
  veilMesh.renderOrder = 2
  veilMesh.userData.skipShadowCasting = true
  headPivot.add(veilMesh)

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
    sensorLight.position.set(0, 0.145, -0.22)
    headPivot.add(sensorLight)
  }

  // --- Distorted asymmetric shoulders -> elongated thin arms -> sharp long-fingered shadow hands ---
  const armPivots = { left: null, right: null }
  const elbowPivots = { left: null, right: null }
  const wristPivots = { left: null, right: null }
  const armSpecs = [
    {
      sign: -1,
      sideTag: 'left',
      capSide: 'Left',
      posX: -0.26,
      posY: leftShoulderOffsetY,
      posZ: -0.02,
      armRotZ: -0.08,
      ragRotY: 0.25,
    },
    {
      sign: 1,
      sideTag: 'right',
      capSide: 'Right',
      posX: 0.24,
      posY: rightShoulderOffsetY,
      posZ: 0.015,
      armRotZ: 0.09,
      ragRotY: -0.35,
    },
  ]

  for (let i = 0; i < armSpecs.length; i += 1) {
    const spec = armSpecs[i]
    const handGeo = getPooledGeometry(`phantom:hand${spec.capSide}`, () =>
      buildPhantomHandGeometry(spec.sign)
    )

    const armPivot = new THREE.Group()
    armPivot.name = `maze-enemy-arm-pivot-${spec.sideTag}`
    armPivot.position.set(spec.posX, spec.posY, spec.posZ)
    armPivot.rotation.z = spec.armRotZ
    upperBodyPivot.add(armPivot)
    armPivots[spec.sideTag] = armPivot

    const upperArmMesh = new THREE.Mesh(upperArmGeo, mats.chassis)
    upperArmMesh.name = `maze-enemy-phantom-upper-arm-${spec.sideTag}`
    armPivot.add(upperArmMesh)

    const shoulderRagMesh = new THREE.Mesh(shoulderRagGeo, mats.plating)
    shoulderRagMesh.name = `maze-enemy-phantom-shoulder-rag-${spec.sideTag}`
    shoulderRagMesh.rotation.y = spec.ragRotY
    shoulderRagMesh.renderOrder = 2
    shoulderRagMesh.userData.skipShadowCasting = true
    armPivot.add(shoulderRagMesh)

    const elbowPivot = new THREE.Group()
    elbowPivot.name = `maze-enemy-elbow-pivot-${spec.sideTag}`
    elbowPivot.position.set(0, -0.46, 0)
    elbowPivot.rotation.x = 0.3
    armPivot.add(elbowPivot)
    elbowPivots[spec.sideTag] = elbowPivot

    const forearmMesh = new THREE.Mesh(forearmGeo, mats.chassis)
    forearmMesh.name = `maze-enemy-phantom-forearm-${spec.sideTag}`
    elbowPivot.add(forearmMesh)

    const wristPivot = new THREE.Group()
    wristPivot.name = `maze-enemy-wrist-pivot-${spec.sideTag}`
    wristPivot.position.set(0, -0.49, 0)
    elbowPivot.add(wristPivot)
    wristPivots[spec.sideTag] = wristPivot

    const handMesh = new THREE.Mesh(handGeo, mats.chassis)
    handMesh.name = `maze-enemy-phantom-hand-${spec.sideTag}`
    wristPivot.add(handMesh)
  }

  // --- Drifting Procedural Spectral Particle Clouds ---
  const particleInner = new THREE.Points(particlesInnerGeo, mats.hardware)
  particleInner.name = 'maze-enemy-phantom-particles-inner'
  particleInner.renderOrder = 3
  rigScaleGroup.add(particleInner)

  const particleOuter = new THREE.Points(particlesOuterGeo, mats.hardware)
  particleOuter.name = 'maze-enemy-phantom-particles-outer'
  particleOuter.renderOrder = 3
  rigScaleGroup.add(particleOuter)

  return {
    scaleGroup: rigScaleGroup,
    upperBodyPivot,
    shroudPivot,
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
    particleInner,
    particleOuter,
    particleUniforms: mats.particleUniforms || null,
    sensorMesh,
    sensorLight,
    materials: mats,
    restPose: {
      hipHeight,
      neckPivotOffsetY,
      headPivotOffsetY,
      leftShoulderOffsetY,
      rightShoulderOffsetY,
    },
  }
}

/**
 * Builds a procedural 3D horror enemy character ('stalker' -> The Wraith, 'hunter' -> The Revenant, or 'brute' -> The Phantom)
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
  let modelHeight

  if (enemyType === 'stalker') {
    rig = buildWraithRig(rigScaleGroup, mats, sensorLightEnabled, preset, config)
    modelHeight = 2.28 * preset.scaleY
  } else if (enemyType === 'hunter') {
    rig = buildRevenantRig(rigScaleGroup, mats, sensorLightEnabled, preset, config)
    modelHeight = 1.88 * preset.scaleY
  } else {
    rig = buildPhantomRig(rigScaleGroup, mats, sensorLightEnabled, preset, config)
    modelHeight = 2.14 * preset.scaleY
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
    } else if (enemyGroup.userData.enemyType === 'hunter') {
      light.position.set(0, 0.125, -0.22)
    } else {
      light.position.set(0, 0.145, -0.22)
    }
    rig.headPivot.add(light)
    rig.sensorLight = light

    const prevState = enemyGroup.userData._visualState || 'patrol'
    enemyGroup.userData._visualState = null
    updateEnemyVisualState(enemyGroup, prevState)
  }

  return Boolean(rig.sensorLight)
}

function ensureWatchersEyeRevealGroup(enemyGroup) {
  const rig = enemyGroup?.userData?.rig
  if (!rig) return null
  if (enemyGroup.userData.watchersEyeReveal) {
    return enemyGroup.userData.watchersEyeReveal
  }

  const parent = rig.scaleGroup || enemyGroup
  const group = new THREE.Group()
  group.name = 'maze-enemy-watchers-eye-reveal'
  group.visible = false
  group.userData = { isWatchersEyeReveal: true, skipShadowCasting: true }

  const hullGeo = getPooledGeometry(
    'shared:watchersEyeHull',
    () => new THREE.CapsuleGeometry(0.42, 1.05, 4, 10)
  )
  const hullMat = getPooledMaterial(
    'shared:watchersEyeHullMat',
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xa855f7,
        transparent: true,
        opacity: 0.32,
        depthTest: false,
        depthWrite: false,
        fog: false,
      })
  )
  const hullMesh = new THREE.Mesh(hullGeo, hullMat)
  hullMesh.name = 'watchers-eye-silhouette'
  hullMesh.position.y = 1.05
  hullMesh.renderOrder = 60
  hullMesh.castShadow = false
  hullMesh.receiveShadow = false
  hullMesh.userData = { isWatchersEyeReveal: true, skipShadowCasting: true }
  group.add(hullMesh)

  const wireGeo = getPooledGeometry('shared:watchersEyeWire', () => {
    const cap = new THREE.CapsuleGeometry(0.45, 1.08, 4, 10)
    const edges = new THREE.EdgesGeometry(cap, 22)
    cap.dispose()
    return edges
  })
  const wireMat = getPooledMaterial(
    'shared:watchersEyeWireMat',
    () =>
      new THREE.LineBasicMaterial({
        color: 0xf0abfc,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false,
        fog: false,
      })
  )
  const wireLines = new THREE.LineSegments(wireGeo, wireMat)
  wireLines.name = 'watchers-eye-wire'
  wireLines.position.y = 1.05
  wireLines.renderOrder = 61
  wireLines.userData = { isWatchersEyeReveal: true, skipShadowCasting: true }
  group.add(wireLines)

  const ringGeo = getPooledGeometry(
    'shared:watchersEyeRing',
    () => new THREE.TorusGeometry(0.36, 0.032, 6, 20)
  )
  const ringMat = getPooledMaterial(
    'shared:watchersEyeRingMat',
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        fog: false,
      })
  )
  const beaconRing = new THREE.Mesh(ringGeo, ringMat)
  beaconRing.name = 'watchers-eye-beacon'
  beaconRing.position.y = 2.38
  beaconRing.rotation.x = Math.PI / 2
  beaconRing.renderOrder = 62
  beaconRing.castShadow = false
  beaconRing.receiveShadow = false
  beaconRing.userData = { isWatchersEyeReveal: true, skipShadowCasting: true }
  group.add(beaconRing)

  group.userData.hullMesh = hullMesh
  group.userData.beaconRing = beaconRing

  parent.add(group)
  enemyGroup.userData.watchersEyeReveal = group
  return group
}

/**
 * Toggles the Watcher's Eye through-wall spectral silhouette & beacon on an enemy.
 * Distinct from High-Contrast threat outlines and automatically tracks enemy transforms.
 */
export function setEnemyWatchersEyeReveal(enemyGroup, revealed, elapsedSec = 0) {
  if (!enemyGroup?.userData?.rig) return false
  const want = Boolean(revealed)
  const existing = enemyGroup.userData.watchersEyeReveal

  if (!want) {
    if (existing) {
      existing.visible = false
    }
    return false
  }

  const revealGroup = existing || ensureWatchersEyeRevealGroup(enemyGroup)
  if (!revealGroup) return false

  revealGroup.visible = true
  const t = Number.isFinite(elapsedSec) ? elapsedSec : 0
  const pulse = 1 + 0.12 * Math.sin(t * 5.4)
  if (revealGroup.userData?.beaconRing) {
    revealGroup.userData.beaconRing.scale.setScalar(pulse)
    revealGroup.userData.beaconRing.rotation.z = t * 1.8
  }
  if (revealGroup.userData?.hullMesh) {
    const hullPulse = 1 + 0.03 * Math.sin(t * 4.2)
    revealGroup.userData.hullMesh.scale.set(hullPulse, 1, hullPulse)
  }
  return true
}

/**
 * Updates an enemy's ocular sensor color and illumination based on AI alert state.
 */
export function updateEnemyVisualState(enemyGroup, state, statusOptions = null) {
  if (!enemyGroup?.userData?.rig) return

  const resolvedState = state || 'patrol'
  const isStunned = Boolean(statusOptions?.stunned)
  const cacheKey = isStunned ? `${resolvedState}:stunned` : resolvedState
  if (enemyGroup.userData._visualState === cacheKey) {
    return
  }

  const { sensorMesh, sensorLight } = enemyGroup.userData.rig
  if (!sensorMesh) return

  const isWraith = enemyGroup.userData.enemyType === 'stalker'
  const isRevenant = enemyGroup.userData.enemyType === 'hunter'
  const isPhantom = enemyGroup.userData.enemyType === 'brute'
  const preset = enemyGroup.userData.typePalette || ENEMY_VISUAL_PRESETS.stalker
  let color
  let emissive
  let intensity
  let eyeEmissiveIntensity
  let deadEyeEmissiveIntensity
  let phantomEyeEmissiveIntensity

  if (isStunned) {
    color = 0x38bdf8
    emissive = 0x0284c7
    intensity = 0.25
    eyeEmissiveIntensity = 0.35
    deadEyeEmissiveIntensity = 0.2
    phantomEyeEmissiveIntensity = 0.35
  } else {
    switch (resolvedState) {
      case 'attack':
        color = 0xff0033
        emissive = 0xff0022
        intensity = 3.6
        eyeEmissiveIntensity = 2.1
        deadEyeEmissiveIntensity = 1.15
        phantomEyeEmissiveIntensity = 2.25
        break
      case 'chase':
        color = preset.sensorChase
        emissive = preset.sensorChase
        intensity = 2.4
        eyeEmissiveIntensity = 1.65
        deadEyeEmissiveIntensity = 0.85
        phantomEyeEmissiveIntensity = 1.75
        break
      case 'investigate':
      case 'search':
        color = preset.sensorAlert
        emissive = preset.sensorAlert
        intensity = 1.7
        eyeEmissiveIntensity = 1.15
        deadEyeEmissiveIntensity = 0.55
        phantomEyeEmissiveIntensity = 1.25
        break
      case 'patrol':
      case 'idle':
      default:
        color = preset.sensorNormal
        emissive = preset.sensorNormal
        intensity = 1.1
        eyeEmissiveIntensity = 0.85
        deadEyeEmissiveIntensity = 0.32
        phantomEyeEmissiveIntensity = 0.85
        break
    }
  }

  if (sensorMesh.material) {
    sensorMesh.material.color.setHex(color)
    sensorMesh.material.emissive.setHex(emissive)
    if (isWraith) {
      sensorMesh.material.emissiveIntensity = eyeEmissiveIntensity
    } else if (isRevenant) {
      sensorMesh.material.emissiveIntensity = deadEyeEmissiveIntensity
    } else if (isPhantom) {
      sensorMesh.material.emissiveIntensity = phantomEyeEmissiveIntensity
    }
  }
  if (sensorLight) {
    sensorLight.color.setHex(color)
    sensorLight.intensity = intensity
  }
  enemyGroup.userData._visualState = cacheKey
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

  if (enemyGroup.userData) {
    enemyGroup.userData.watchersEyeReveal = null
  }
  if (enemyGroup.parent) {
    enemyGroup.parent.remove(enemyGroup)
  }
  enemyGroup.clear()

  return true
}
