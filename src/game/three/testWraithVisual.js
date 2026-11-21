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
import { ENEMY_ARCHETYPES, ENEMY_STATES, ENEMY_TYPES, EnemyAgent } from './EnemyAgent.js'
import { syncEnemyHighContrast } from './highContrastOutlines.js'

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

  // Verify anatomical neck-to-head vertical overlap (no neck gap) and mist hover parenting
  const neckBox = new THREE.Box3().setFromObject(wraith.getObjectByName('maze-enemy-wraith-neck'))
  const headBox = new THREE.Box3().setFromObject(wraith.getObjectByName('maze-enemy-wraith-head'))
  assert.ok(
    neckBox.max.y > headBox.min.y + 0.01,
    `Wraith neck seats deeply inside skull base (neckMaxY=${neckBox.max.y.toFixed(3)}, headMinY=${headBox.min.y.toFixed(3)})`
  )
  assert.equal(rig.leftLegPivot.parent, rig.upperBodyPivot, 'Left mist tendril parents under upperBodyPivot to sync hover bob')
  assert.equal(rig.rightLegPivot.parent, rig.upperBodyPivot, 'Right mist tendril parents under upperBodyPivot to sync hover bob')

  // Verify high-contrast outline completely encloses rest-pose mesh bounds
  syncEnemyHighContrast(wraith, true)
  wraith.updateMatrixWorld(true)
  const outlineBox = new THREE.Box3().setFromObject(wraith.userData.highContrastOutline)
  assert.ok(
    outlineBox.min.x <= box.min.x &&
      outlineBox.max.x >= box.max.x &&
      outlineBox.min.y <= box.min.y &&
      outlineBox.max.y >= box.max.y &&
      outlineBox.min.z <= box.min.z &&
      outlineBox.max.z >= box.max.z,
    'Wraith high-contrast outline encloses rest-pose silhouette'
  )
  syncEnemyHighContrast(wraith, false)

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

  // Patrol gliding pose (-Z front: upperBody leans < 0, trailing mist trails < 0 toward +Z)
  agent.state = ENEMY_STATES.PATROL
  agent.stridePhase = 1.2
  agent._animateLimbs(agent.stridePhase, 0.45)
  assert.ok(rig.upperBodyPivot.rotation.x < 0, 'Wraith leans forward (-Z) during patrol glide')
  assert.ok(
    rig.leftLegPivot.rotation.x < 0 && rig.rightLegPivot.rotation.x < 0 && rig.lowerRobePivot.rotation.x < 0,
    'Lower mist tendrils and robe skirt trail backward (+Z) behind forward patrol glide'
  )

  // Investigate / Search crouched articulation
  agent.state = ENEMY_STATES.INVESTIGATE
  agent._animateLimbs(1.2, 0.55)
  assert.ok(
    rig.upperBodyPivot.rotation.x < -0.15 &&
      rig.neckPivot.rotation.x < -0.1 &&
      rig.headPivot.rotation.x > 0.05 &&
      rig.leftArmPivot.rotation.x > 0.15 &&
      rig.leftElbowPivot.rotation.x > 0.4,
    'Wraith leans/flexes arms forward (-Z) and counter-pitches head up while investigating'
  )

  // Chase predatory reach
  agent.state = ENEMY_STATES.CHASE
  agent._animateLimbs(0.4, 0.7)
  assert.ok(
    rig.upperBodyPivot.rotation.x < -0.25 &&
      rig.leftArmPivot.rotation.x > 0.5 &&
      rig.rightArmPivot.rotation.x > 0.5,
    'Wraith reaches long clawed arms forward (-Z) during chase'
  )

  // Attack multi-joint lunge, floor clearance & hit synchronization
  assert.equal(ENEMY_ARCHETYPES.stalker.attackHitDelay, 0.38, 'Stalker attackHitDelay tuned to forward strike apex')
  agent.resetAttackState()
  agent.state = ENEMY_STATES.ATTACK
  agent._animateAttack(0.25)
  assert.ok(
    rig.leftArmPivot.rotation.x < -0.3 && rig.leftElbowPivot.rotation.x > 0.5,
    'Wraith winds up arms backward while cocking elbows before slashing'
  )
  agent._animateAttack(0.475)
  assert.ok(
    rig.upperBodyPivot.rotation.x < -0.15 &&
      rig.leftArmPivot.rotation.x > 0.4 &&
      rig.rightArmPivot.rotation.x > 0.4,
    'Wraith lunges and rakes claws forward (-Z) during active strike window'
  )

  // Subtle independent wrist articulation across chase and attack
  agent.state = ENEMY_STATES.CHASE
  agent._animateLimbs(0.4, 0.7)
  const chaseLwRx = rig.leftWristPivot.rotation.x
  const chaseRwRx = rig.rightWristPivot.rotation.x
  const chaseLwRz = rig.leftWristPivot.rotation.z
  const chaseRwRz = rig.rightWristPivot.rotation.z
  assert.ok(
    Math.abs(chaseLwRx) > 0.01 &&
      Math.abs(chaseRwRx) > 0.01 &&
      Math.abs(chaseLwRz - chaseRwRz) > 0.01 &&
      Math.abs(chaseLwRx - chaseRwRx) > 0.005,
    'Wraith wrists articulate with subtle left/right independence during chase'
  )

  // Floor clearance check across all states, full gait sweeps & attack phases
  for (const [label, fn] of [
    ['idle', () => { agent.state = ENEMY_STATES.IDLE; agent._dampLimbs(0.25) }],
    ['patrol', () => { agent.state = ENEMY_STATES.PATROL; agent._animateLimbs(1.0, 0.45) }],
    ['investigate', () => { agent.state = ENEMY_STATES.INVESTIGATE; agent._animateLimbs(1.0, 0.55) }],
    ['chase', () => { agent.state = ENEMY_STATES.CHASE; agent._animateLimbs(1.0, 0.7) }],
    ['attack-windup', () => { agent.state = ENEMY_STATES.ATTACK; agent._animateAttack(0.25) }],
    ['attack-strike', () => { agent.state = ENEMY_STATES.ATTACK; agent._animateAttack(0.5) }],
  ]) {
    fn()
    agent.mesh.updateMatrixWorld(true)
    const stateBox = new THREE.Box3().setFromObject(agent.mesh)
    assert.ok(stateBox.min.y >= 0.02, `Wraith ${label} keeps robes & mist cleanly above floor (minY=${stateBox.min.y.toFixed(3)})`)
  }
  for (let p = 0; p <= Math.PI * 2; p += 0.4) {
    agent.state = ENEMY_STATES.CHASE
    agent._animateLimbs(p, 0.7)
    agent.mesh.updateMatrixWorld(true)
    const gaitBox = new THREE.Box3().setFromObject(agent.mesh)
    assert.ok(gaitBox.min.y >= 0.02, `Wraith full chase stride keeps mist above floor at phase ${p.toFixed(2)} (minY=${gaitBox.min.y.toFixed(3)})`)
  }

  // Smooth damped state transitions (no single-frame snap across idle/patrol/investigate/chase/attack/recovery)
  {
    const sampleJoints = () => [
      rig.upperBodyPivot.rotation.x,
      rig.leftArmPivot.rotation.x,
      rig.rightArmPivot.rotation.x,
      rig.headPivot.rotation.x,
      rig.neckPivot.rotation.x,
      rig.leftWristPivot.rotation.z,
    ]
    const dt = 1 / 60
    let prev = sampleJoints()
    const checkTransition = (label, nextState, stepFn) => {
      agent.state = nextState
      stepFn()
      const cur = sampleJoints()
      for (let j = 0; j < cur.length; j += 1) {
        const delta = Math.abs(cur[j] - prev[j])
        assert.ok(delta < 0.22, `Wraith ${label} joint[${j}] transitions smoothly without snap (delta=${delta.toFixed(4)})`)
      }
      prev = cur
    }
    checkTransition('IDLE->PATROL', ENEMY_STATES.PATROL, () => agent._animateLimbs(0.4, 0.45, dt))
    checkTransition('PATROL->CHASE', ENEMY_STATES.CHASE, () => agent._animateLimbs(1.1, 0.7, dt))
    agent._captureAttackStartPose()
    agent.isAttacking = true
    checkTransition('CHASE->ATTACK', ENEMY_STATES.ATTACK, () => agent._animateAttack(0.05))
    checkTransition('ATTACK->CHASE', ENEMY_STATES.CHASE, () => agent._animateLimbs(1.3, 0.7, dt))
    checkTransition('CHASE->IDLE', ENEMY_STATES.IDLE, () => agent._dampLimbs(dt))
  }

  // Smooth attack transition blending + synchronized damage hit window
  agent.resetAttackState()
  agent.state = ENEMY_STATES.CHASE
  agent._animateLimbs(0.5, 0.7)
  const chaseArmRx = rig.leftArmPivot.rotation.x
  const pos = agent.getPosition()
  const closePlayerCtx = {
    playerWorldPos: { x: pos.x, y: 0, z: pos.z - 0.9 },
    playerGridCell: agent.getGridCell(),
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
  }
  agent.yaw = 0
  let hitProgress = null
  let hitArmRx = null
  const totalSteps = Math.ceil(agent.config.attackDuration / 0.04)
  for (let step = 0; step < totalSteps; step += 1) {
    const res = agent.update(0.04, closePlayerCtx)
    const prog = agent.attackTimer / agent.config.attackDuration
    if (step === 1) {
      assert.ok(
        Math.abs(rig.leftArmPivot.rotation.x - chaseArmRx) < 0.25,
        'Wraith entry into attack blends smoothly from prior chase arm pose without snapping'
      )
    }
    if (step > 0 && agent.state === ENEMY_STATES.ATTACK && prog < 0.3) {
      assert.equal(res?.attackHit, null, 'Wraith never deals damage during early windup')
    }
    if (res?.attackHit) {
      hitProgress = (step * 0.04) / agent.config.attackDuration
      hitArmRx = rig.leftArmPivot.rotation.x
    }
  }
  assert.ok(
    hitProgress !== null && hitProgress >= 0.42 && hitProgress <= 0.6 && hitArmRx > 0.35,
    `Wraith attackHit aligns with forward strike apex (progress=${hitProgress?.toFixed(3)}, armRx=${hitArmRx?.toFixed(3)})`
  )

  agent.state = ENEMY_STATES.ATTACK
  updateEnemyVisualState(agent.mesh, ENEMY_STATES.ATTACK)
  agent.resetAttackState()
  assert.equal(agent.getState(), ENEMY_STATES.PATROL, 'resetAttackState restores PATROL')
  assert.equal(rig.upperBodyPivot.position.y.toFixed(2), (baseHipY + Math.sin(agent.hoverPhase * 1.1) * 0.028).toFixed(2))
  assert.equal(rig.headPivot.rotation.y, 0, 'resetAttackState zeroes residual head yaw')
  assert.equal(
    rig.materials.sensor.color.getHex(),
    ENEMY_VISUAL_PRESETS.stalker.sensorNormal,
    'resetAttackState restores normal ocular color from attack crimson'
  )

  agent.dispose()
  disposeEnemyPools()
}

console.log('ALL WRAITH VISUAL & RIG TESTS PASSED.')
