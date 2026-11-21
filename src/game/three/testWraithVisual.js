import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  buildEnemy,
  disposeEnemy,
  disposeEnemyPools,
  ENEMY_VISUAL_PRESETS,
  getEnemyPoolStats,
  setEnemySensorLightEnabled,
  updateEnemyVisualState,
} from './buildEnemy.js'
import { ENEMY_STATES, ENEMY_TYPES, EnemyAgent } from './EnemyAgent.js'

console.log('--- RUNNING WRAITH PROCEDURAL CHARACTER & RIG TESTS ---')

function countTrianglesAndValidate(root) {
  let meshCount = 0
  let triangleCount = 0
  let vertexCount = 0
  root.traverse((node) => {
    if (!node.isMesh) return
    meshCount += 1
    const geo = node.geometry
    assert.ok(geo && geo.attributes?.position, `Mesh ${node.name} has position attribute`)
    assert.ok(geo.attributes?.normal, `Mesh ${node.name} has normal attribute`)
    const pos = geo.attributes.position
    vertexCount += pos.count
    for (let i = 0; i < pos.array.length; i += 1) {
      assert.ok(Number.isFinite(pos.array[i]), `Mesh ${node.name} has finite vertex coordinate`)
    }
    const norm = geo.attributes.normal
    for (let i = 0; i < norm.array.length; i += 1) {
      assert.ok(Number.isFinite(norm.array[i]), `Mesh ${node.name} has finite normal coordinate`)
    }
    if (geo.index) {
      triangleCount += Math.floor(geo.index.count / 3)
    } else {
      triangleCount += Math.floor(pos.count / 3)
    }
  })
  return { meshCount, triangleCount, vertexCount }
}

disposeEnemyPools()

// 1. Structural Anatomy, Bounding Height, Translucent Ghostly Materials & Shadow Flags
console.log('Test 1: Wraith Procedural Anatomy, Pale Ghostly Skin, Torn Robes & Dissolving Mist')
{
  const wraith = buildEnemy({ id: 'wraith-inspect', type: 'stalker' })
  const stats = countTrianglesAndValidate(wraith)

  assert.equal(stats.meshCount, 16, `Wraith builds 16 articulated meshes (got ${stats.meshCount})`)
  assert.ok(
    stats.triangleCount >= 4000 && stats.triangleCount <= 16000,
    `Wraith carries high-craft procedural detail (${stats.triangleCount} triangles)`
  )

  wraith.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(wraith)
  const height = box.max.y - box.min.y
  assert.ok(
    height >= 2.15 && height <= 2.45 && box.max.y >= 2.2,
    `Wraith towers ominously above player height (minY=${box.min.y.toFixed(3)}, maxY=${box.max.y.toFixed(3)}, height=${height.toFixed(3)})`
  )
  assert.ok(box.min.y >= 0.02, 'Lower body dissolves into mist cleanly above floor with no solid boots/feet')

  // Verify anatomical & spectral parts exist and mechanical parts are absent
  const expectedNames = [
    'maze-enemy-wraith-torso',
    'maze-enemy-wraith-neck',
    'maze-enemy-wraith-head',
    'maze-enemy-sensor-eye',
    'maze-enemy-wraith-robe-upper',
    'maze-enemy-wraith-veil-upper',
    'maze-enemy-wraith-robe-skirt',
    'maze-enemy-wraith-mist-skirt',
    'maze-enemy-wraith-mist-tendril-left',
    'maze-enemy-wraith-mist-tendril-right',
    'maze-enemy-wraith-upper-arm-left',
    'maze-enemy-wraith-forearm-left',
    'maze-enemy-wraith-claw-hand-left',
    'maze-enemy-wraith-upper-arm-right',
    'maze-enemy-wraith-forearm-right',
    'maze-enemy-wraith-claw-hand-right',
  ]
  for (const name of expectedNames) {
    assert.ok(wraith.getObjectByName(name), `Wraith includes expected part: ${name}`)
  }
  for (const legacyName of ['maze-enemy-carapace', 'maze-enemy-thigh-left', 'maze-enemy-claw-left', 'maze-enemy-brow']) {
    assert.equal(wraith.getObjectByName(legacyName), undefined, `Wraith omits legacy mechanical part: ${legacyName}`)
  }

  // Verify material aesthetics (pale grey-blue skin, shadow robes, subtle translucent veil & mist)
  const rig = wraith.userData.rig
  const skinMat = rig.materials.plating
  const robeMat = rig.materials.chassis
  const veilMat = rig.materials.spines
  const mistMat = rig.materials.hardware
  const eyeMat = rig.materials.sensor

  assert.ok(skinMat.vertexColors === true, 'Wraith skin uses vertex-colored orbital/rib/cheek AO shading')
  assert.ok(skinMat.color.b > skinMat.color.r, 'Wraith skin tone is pale ghostly grey-blue')
  assert.equal(robeMat.side, THREE.DoubleSide, 'Torn robes render double-sided cloth depth')
  assert.equal(veilMat.transparent, true, 'Outer shadow veil supports ghostly transparency')
  assert.equal(mistMat.transparent, true, 'Lower dissolving mist supports ghostly transparency')
  assert.equal(mistMat.depthWrite, false, 'Lower dissolving mist uses depthWrite=false to avoid sorting seams')
  assert.ok(eyeMat.emissiveIntensity < 1.2, 'Recessed eyes start with subtle supernatural glow')

  // Verify articulated rig pivots
  for (const pivotKey of [
    'upperBodyPivot',
    'lowerRobePivot',
    'neckPivot',
    'headPivot',
    'leftArmPivot',
    'rightArmPivot',
    'leftElbowPivot',
    'rightElbowPivot',
    'leftWristPivot',
    'rightWristPivot',
    'leftLegPivot',
    'rightLegPivot',
  ]) {
    assert.ok(rig[pivotKey], `Wraith rig exposes ${pivotKey}`)
  }

  // Dynamic ocular state + sensor light toggle
  updateEnemyVisualState(wraith, ENEMY_STATES.CHASE)
  assert.equal(eyeMat.color.getHex(), ENEMY_VISUAL_PRESETS.stalker.sensorChase)
  setEnemySensorLightEnabled(wraith, false)
  assert.equal(rig.sensorLight, null)
  setEnemySensorLightEnabled(wraith, true)
  assert.ok(rig.sensorLight && rig.sensorLight.position.y > 0.1, 'Re-enabled light aligns with Wraith face height')

  disposeEnemy(wraith)
}

// 2. Shared Pool Budget Across All 3 Archetypes
console.log('Test 2: Wraith + Hunter + Brute Shared Pool Ceiling & Clean Disposal')
{
  disposeEnemyPools()
  const wraith = buildEnemy({ id: 'pool-s', type: 'stalker' })
  const hunter = buildEnemy({ id: 'pool-h', type: 'hunter' })
  const brute = buildEnemy({ id: 'pool-b', type: 'brute' })

  const poolStats = getEnemyPoolStats()
  assert.ok(
    poolStats.geometries <= 45,
    `Total pooled enemy geometries across Wraith + Hunter + Brute stays <= 45 (got ${poolStats.geometries})`
  )

  disposeEnemy(wraith)
  disposeEnemy(hunter)
  disposeEnemy(brute)
  disposeEnemyPools()
  assert.equal(getEnemyPoolStats().geometries, 0)
  assert.equal(getEnemyPoolStats().materials, 0)
}

// 3. Articulated Procedural Animations Across Idle, Patrol, Investigate, Chase & Attack
console.log('Test 3: Wraith Articulated Procedural Animations & Preserved Gameplay Behavior')
{
  const maze = generateMaze({ difficulty: 'small', seed: 777 })
  const agent = new EnemyAgent('wraith-ai-check', {
    maze,
    type: ENEMY_TYPES.STALKER,
    spawnCell: { row: 1, col: 1 },
  })
  const rig = agent.mesh.userData.rig
  const baseHipY = rig.restPose.hipHeight

  // Preserved Stalker gameplay balancing
  assert.equal(agent.config.attackDamage, 25, 'Stalker damage remains 25')
  assert.equal(agent.config.attackRange, 1.35, 'Stalker attackRange remains 1.35')

  // Idle floating & eerie head tilt
  agent.state = ENEMY_STATES.IDLE
  agent.idleTimer = 2.0
  agent.update(0.25, null)
  assert.ok(
    Math.abs(rig.upperBodyPivot.position.y - baseHipY) > 0.002,
    'Wraith exhibits subtle ethereal hover bob during idle'
  )
  assert.ok(
    Math.abs(rig.headPivot.rotation.z) > 0.005 || Math.abs(rig.neckPivot.rotation.z) > 0.005,
    'Wraith tilts head/neck eerily during idle'
  )

  // Patrol gliding pose
  agent.state = ENEMY_STATES.PATROL
  agent.stridePhase = 1.2
  agent._animateLimbs(agent.stridePhase, 0.45)
  assert.ok(rig.leftLegPivot.rotation.x > 0 && rig.rightLegPivot.rotation.x > 0, 'Lower mist tendrils trail behind forward patrol glide')

  // Investigate / Search crouched articulation
  agent.state = ENEMY_STATES.INVESTIGATE
  agent._animateLimbs(1.2, 0.55)
  assert.ok(rig.leftArmPivot.rotation.x < -0.15 && rig.leftElbowPivot.rotation.x < -0.4, 'Wraith crouches and flexes clawed arms while investigating')

  // Chase predatory reach
  agent.state = ENEMY_STATES.CHASE
  agent._animateLimbs(0.4, 0.7)
  assert.ok(rig.leftArmPivot.rotation.x < -0.5, 'Wraith reaches long clawed arms forward during chase')

  // Attack multi-joint lunge & reset
  agent.state = ENEMY_STATES.ATTACK
  agent._animateAttack(0.25)
  assert.ok(rig.leftArmPivot.rotation.x < -0.8 && rig.leftElbowPivot.rotation.x < -0.5, 'Wraith winds up shoulder & elbow claws before slashing')
  agent._animateAttack(0.55)
  assert.ok(rig.upperBodyPivot.rotation.x > 0.15 && rig.leftArmPivot.rotation.x > 0.2, 'Wraith lunges forward during attack strike window')

  agent.resetAttackState()
  assert.equal(rig.upperBodyPivot.position.y.toFixed(2), (baseHipY + Math.sin(agent.hoverPhase * 1.1) * 0.03).toFixed(2))

  agent.dispose()
  disposeEnemyPools()
}

console.log('ALL WRAITH VISUAL & RIG TESTS PASSED.')
