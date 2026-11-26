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

console.log('--- RUNNING REVENANT PROCEDURAL CHARACTER & RIG TESTS ---')

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

// 1. Structural Anatomy, Decayed Flesh / Exposed Bone Vertex Colors, Uneven Posture & Ground Contact
console.log('Test 1: Revenant Procedural Anatomy, Decayed Skin, Exposed Bones & Ragged Clothing')
{
  const revenant = buildEnemy({ id: 'revenant-inspect', type: 'hunter' })
  const stats = countTrianglesAndValidate(revenant)

  assert.equal(stats.meshCount, 18, `Revenant builds 18 articulated meshes (got ${stats.meshCount})`)
  assert.ok(
    stats.triangleCount >= 4000 && stats.triangleCount <= 18000,
    `Revenant carries high-craft procedural anatomical detail (${stats.triangleCount} triangles)`
  )

  revenant.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(revenant)
  const height = box.max.y - box.min.y
  assert.ok(
    height >= 1.62 && height <= 1.9,
    `Revenant has grounded hunched human proportions (minY=${box.min.y.toFixed(3)}, maxY=${box.max.y.toFixed(3)}, height=${height.toFixed(3)})`
  )
  assert.ok(
    box.min.y >= 0 && box.min.y <= 0.04,
    `Revenant bare feet rest cleanly on floor level (minY=${box.min.y.toFixed(3)})`
  )

  const expectedNames = [
    'maze-enemy-revenant-flesh',
    'maze-enemy-revenant-torso',
    'maze-enemy-revenant-neck',
    'maze-enemy-revenant-head',
    'maze-enemy-revenant-hair',
    'maze-enemy-sensor-eye',
    'maze-enemy-revenant-thigh-left',
    'maze-enemy-revenant-shin-left',
    'maze-enemy-revenant-thigh-right',
    'maze-enemy-revenant-shin-right',
    'maze-enemy-revenant-upper-arm-left',
    'maze-enemy-revenant-sleeve-left',
    'maze-enemy-revenant-forearm-left',
    'maze-enemy-revenant-hand-left',
    'maze-enemy-revenant-upper-arm-right',
    'maze-enemy-revenant-sleeve-right',
    'maze-enemy-revenant-forearm-right',
    'maze-enemy-revenant-hand-right',
  ]
  for (const name of expectedNames) {
    assert.ok(revenant.getObjectByName(name), `Revenant includes expected part: ${name}`)
  }
  for (const legacyName of [
    'maze-enemy-carapace',
    'maze-enemy-chest-plate',
    'maze-enemy-brow',
    'maze-enemy-acoustic-ear-left',
    'maze-enemy-acoustic-ear-right',
    'maze-enemy-blade-hand-left',
  ]) {
    assert.equal(revenant.getObjectByName(legacyName), undefined, `Revenant omits robotic/armor part: ${legacyName}`)
  }

  // Verify uneven shoulders & slightly twisted posture
  const rig = revenant.userData.rig
  assert.ok(
    rig.leftArmPivot.position.y < rig.rightArmPivot.position.y - 0.03,
    `Revenant shoulders are measurably uneven (leftY=${rig.leftArmPivot.position.y}, rightY=${rig.rightArmPivot.position.y})`
  )
  assert.ok(
    Math.abs(rig.upperBodyPivot.rotation.z) > 0.02 && Math.abs(rig.headPivot.rotation.z) > 0.05,
    'Revenant exhibits slightly twisted scoliotic torso and crooked head posture'
  )

  // Verify flesh vertex colors encode both dark necrotic cracks/creases and pale exposed bone highlights
  const torsoCol = revenant.getObjectByName('maze-enemy-revenant-flesh').geometry.attributes.color
  let minLum = Infinity
  let maxLum = -Infinity
  for (let i = 0; i < torsoCol.count; i += 1) {
    const lum = (torsoCol.getX(i) + torsoCol.getY(i) + torsoCol.getZ(i)) / 3
    if (lum < minLum) minLum = lum
    if (lum > maxLum) maxLum = lum
  }
  assert.ok(
    minLum < 0.28 && maxLum > 0.65,
    `Torso vertex shading includes dark necrotic crevices (${minLum.toFixed(2)}) and exposed ivory bone (${maxLum.toFixed(2)})`
  )

  // Verify undead material properties (non-metallic decayed flesh, ragged matte double-sided coat, dull dead eyes)
  const clothMat = rig.materials.chassis
  const fleshMat = rig.materials.plating
  const eyeMat = rig.materials.sensor
  assert.equal(clothMat.side, THREE.DoubleSide, 'Ragged open coat & strips render double-sided')
  assert.equal(clothMat.vertexColors, true, 'Clothing uses mud/tear AO vertex colors')
  assert.ok(clothMat.metalness < 0.05, 'Burial clothing is non-metallic cloth')
  assert.equal(fleshMat.vertexColors, true, 'Skin renders mottled decay, cracks & exposed bone via vertex colors')
  assert.ok(fleshMat.metalness < 0.05, 'Flesh & bone are non-metallic organic materials')
  assert.ok(eyeMat.emissiveIntensity < 0.5, 'Dead sunken cataract eyes start restrained without bright neon glare')

  // Verify articulated rig pivots
  for (const pivotKey of [
    'upperBodyPivot',
    'neckPivot',
    'headPivot',
    'leftLegPivot',
    'rightLegPivot',
    'leftKneePivot',
    'rightKneePivot',
    'leftArmPivot',
    'rightArmPivot',
    'leftElbowPivot',
    'rightElbowPivot',
    'leftWristPivot',
    'rightWristPivot',
  ]) {
    assert.ok(rig[pivotKey], `Revenant rig exposes ${pivotKey}`)
  }

  // Dynamic ocular tint + sensor light toggle compatibility
  updateEnemyVisualState(revenant, ENEMY_STATES.CHASE)
  assert.equal(eyeMat.color.getHex(), ENEMY_VISUAL_PRESETS.hunter.sensorChase)
  setEnemySensorLightEnabled(revenant, false)
  assert.equal(rig.sensorLight, null)
  setEnemySensorLightEnabled(revenant, true)
  assert.ok(rig.sensorLight && rig.sensorLight.position.y > 0.1, 'Re-enabled light aligns with Revenant face')

  // Verify neck-to-head vertical seating & anatomical rest rotations (-Z front)
  const neckBox = new THREE.Box3().setFromObject(revenant.getObjectByName('maze-enemy-revenant-neck'))
  const headBox = new THREE.Box3().setFromObject(revenant.getObjectByName('maze-enemy-revenant-head'))
  assert.ok(
    neckBox.max.y > headBox.min.y + 0.01,
    `Revenant neck seats cleanly inside skull base (neckMaxY=${neckBox.max.y.toFixed(3)}, headMinY=${headBox.min.y.toFixed(3)})`
  )
  assert.ok(rig.upperBodyPivot.rotation.x < 0 && rig.neckPivot.rotation.x < 0 && rig.headPivot.rotation.x > 0, 'Revenant rest posture leans torso/neck forward (-Z) and pitches head up')
  assert.ok(rig.leftKneePivot.rotation.x < 0 && rig.rightKneePivot.rotation.x < 0, 'Revenant knees flex anatomically backward (< 0) in rest pose')

  // Verify high-contrast outline encloses rest-pose mesh bounds
  syncEnemyHighContrast(revenant, true)
  revenant.updateMatrixWorld(true)
  const outlineBox = new THREE.Box3().setFromObject(revenant.userData.highContrastOutline)
  assert.ok(
    outlineBox.min.x <= box.min.x &&
      outlineBox.max.x >= box.max.x &&
      outlineBox.min.y <= box.min.y &&
      outlineBox.max.y >= box.max.y &&
      outlineBox.min.z <= box.min.z &&
      outlineBox.max.z >= box.max.z,
    'Revenant high-contrast outline encloses rest-pose silhouette'
  )
  syncEnemyHighContrast(revenant, false)

  disposeEnemy(revenant)
}

// 2. Shared Pool Cap Verification Across All 3 Archetypes
console.log('Test 2: Wraith + Revenant + Brute Shared Pool Ceiling & Clean Disposal')
{
  disposeEnemyPools()
  const wraith = buildEnemy({ id: 'pool-s', type: 'stalker' })
  const revenant = buildEnemy({ id: 'pool-h', type: 'hunter' })
  const brute = buildEnemy({ id: 'pool-b', type: 'brute' })

  const poolStats = getEnemyPoolStats()
  assert.ok(
    poolStats.geometries <= 45,
    `Total pooled enemy geometries across Wraith + Revenant + Brute stays <= 45 (got ${poolStats.geometries})`
  )

  disposeEnemy(wraith)
  disposeEnemy(revenant)
  disposeEnemy(brute)
  disposeEnemyPools()
  assert.equal(getEnemyPoolStats().geometries, 0)
  assert.equal(getEnemyPoolStats().materials, 0)
}

// 3. Articulated Animations (Idle, Patrol, Investigate, Search, Chase, Attack) & Gameplay Preservation
console.log('Test 3: Revenant Articulated Animations & Preserved Hunter Gameplay')
{
  const maze = generateMaze({ difficulty: 'medium', seed: 909 })
  const agent = new EnemyAgent('revenant-ai-check', {
    maze,
    type: ENEMY_TYPES.HUNTER,
    spawnCell: { row: 1, col: 1 },
  })
  const rig = agent.mesh.userData.rig

  // Preserved Hunter AI / combat / acoustic stats
  assert.equal(agent.config.attackDamage, ENEMY_ARCHETYPES.hunter.attackDamage, 'Hunter/Revenant damage remains 20')
  assert.equal(agent.config.hearingWalkRange, ENEMY_ARCHETYPES.hunter.hearingWalkRange, 'Hunter/Revenant high hearing sensitivity (7.8m) preserved')

  // Idle twisted crooked standing posture
  agent.state = ENEMY_STATES.IDLE
  agent.idleTimer = 2.0
  agent.update(0.25, null)
  assert.ok(
    Math.abs(rig.upperBodyPivot.rotation.z) > 0.01 && Math.abs(rig.headPivot.rotation.z) > 0.02,
    'Revenant holds twisted crooked hunch and head tilt during idle'
  )

  // Patrol asymmetrical limp stride + anatomical backward knee flexion across entire gait cycle
  agent.state = ENEMY_STATES.PATROL
  for (let p = 0; p < Math.PI * 2; p += 0.35) {
    agent._animateLimbs(p, 0.7)
    assert.ok(
      rig.leftKneePivot.rotation.x <= 0 && rig.rightKneePivot.rotation.x <= 0,
      `Revenant knees never bend hyperextended forward at phase ${p.toFixed(2)}`
    )
  }
  agent._animateLimbs(1.1, 0.45)
  assert.ok(
    rig.leftKneePivot.rotation.x < -0.05 &&
      Math.abs(rig.leftArmPivot.rotation.x - rig.rightArmPivot.rotation.x) > 0.08,
    'Revenant articulates asymmetrical limp with backward knee bend and uneven arm swing during patrol'
  )

  // Verify flared coat tails stay safely behind thighs during chase strides (coat Z > thigh surface Z)
  agent.state = ENEMY_STATES.CHASE
  const coatMesh = agent.mesh.getObjectByName('maze-enemy-revenant-torso')
  const coatPos = coatMesh.geometry.attributes.position
  let worstPenetration = 0
  const vLocal = new THREE.Vector3()
  const vWorld = new THREE.Vector3()
  const vThighLocal = new THREE.Vector3()
  for (const testPhase of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
    agent._animateLimbs(testPhase, 0.7)
    agent.mesh.updateMatrixWorld(true)
    const thighs = [
      agent.mesh.getObjectByName('maze-enemy-revenant-thigh-left'),
      agent.mesh.getObjectByName('maze-enemy-revenant-thigh-right'),
    ]
    for (let vi = 0; vi < coatPos.count; vi += 1) {
      vLocal.fromBufferAttribute(coatPos, vi)
      if (vLocal.y >= -0.02) continue // lower coat hem / coat tails below waist
      vWorld.copy(vLocal).applyMatrix4(coatMesh.matrixWorld)
      for (const thigh of thighs) {
        vThighLocal.copy(vWorld).applyMatrix4(thigh.matrixWorld.clone().invert())
        if (vThighLocal.y >= -0.44 && vThighLocal.y <= 0.04) {
          const radial = Math.hypot(vThighLocal.x, vThighLocal.z)
          const thighRadius = 0.068
          if (radial < thighRadius) {
            worstPenetration = Math.max(worstPenetration, thighRadius - radial)
          }
        }
      }
    }
  }
  assert.ok(
    worstPenetration < 0.015,
    `Flared coat avoids noticeable thigh clipping across chase gait (max overlap=${worstPenetration.toFixed(4)}m)`
  )

  // Investigate & Search hunched alert articulation
  agent.state = ENEMY_STATES.INVESTIGATE
  agent._animateLimbs(0.9, 0.55)
  assert.ok(
    rig.upperBodyPivot.rotation.x <= -0.22 && rig.rightElbowPivot.rotation.x > 0.5,
    'Revenant hunches forward (-Z) and flexes forearm forward when investigating'
  )

  agent.state = ENEMY_STATES.SEARCH
  agent._animateLimbs(1.4, 0.5)
  assert.ok(rig.neckPivot.rotation.x <= -0.15, 'Revenant cranes crooked neck forward (-Z) while searching')

  // Chase predatory lunging sprint
  agent.state = ENEMY_STATES.CHASE
  agent._animateLimbs(0.5, 0.7)
  assert.ok(
    rig.upperBodyPivot.rotation.x <= -0.32 &&
      rig.leftArmPivot.rotation.x > 0.45 &&
      rig.rightArmPivot.rotation.x > 0.55,
    'Revenant lurches forward (-Z) with reaching hands during chase'
  )

  // Attack windup -> forward cross-slash strike + braced leg settling + clean reset
  assert.equal(ENEMY_ARCHETYPES.hunter.attackHitDelay, 0.32, 'Hunter/Revenant attackHitDelay tuned to forward slash apex')
  agent.resetAttackState()
  agent.state = ENEMY_STATES.ATTACK
  agent._animateAttack(0.2)
  assert.ok(
    rig.leftArmPivot.rotation.x < 0 && rig.rightArmPivot.rotation.x < 0,
    'Revenant draws both arms back before snapping forward cross-slash'
  )
  agent._animateAttack(0.471)
  assert.ok(
    rig.leftArmPivot.rotation.x > 0.4 &&
      rig.rightArmPivot.rotation.x > 0.4 &&
      rig.leftArmPivot.rotation.z * rig.rightArmPivot.rotation.z < 0,
    'Revenant drives BOTH arms forward through cross-slash impact toward player'
  )

  // Synchronized attackHit test entering from CHASE
  agent.resetAttackState()
  agent.state = ENEMY_STATES.CHASE
  agent._animateLimbs(1.2, 0.7)
  const pos = agent.getPosition()
  const closePlayerCtx = {
    playerWorldPos: { x: pos.x, y: 0, z: pos.z - 0.9 },
    playerGridCell: agent.getGridCell(),
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
  }
  agent.yaw = 0
  let hitProgress = null
  let hitLeftArmRx = null
  let hitRightArmRx = null
  const steps = Math.ceil(agent.config.attackDuration / 0.04)
  for (let s = 0; s < steps; s += 1) {
    const res = agent.update(0.04, closePlayerCtx)
    const prog = agent.attackTimer / agent.config.attackDuration
    if (s > 0 && agent.state === ENEMY_STATES.ATTACK && prog < 0.3) {
      assert.equal(res?.attackHit, null, 'Revenant never deals damage during windup')
    }
    if (res?.attackHit) {
      hitProgress = (s * 0.04) / agent.config.attackDuration
      hitLeftArmRx = rig.leftArmPivot.rotation.x
      hitRightArmRx = rig.rightArmPivot.rotation.x
    }
  }
  assert.ok(
    hitProgress !== null && hitProgress >= 0.4 && hitProgress <= 0.6 && hitLeftArmRx > 0.35 && hitRightArmRx > 0.35,
    `Revenant attackHit aligns with active cross-slash (progress=${hitProgress?.toFixed(3)}, lArm=${hitLeftArmRx?.toFixed(3)}, rArm=${hitRightArmRx?.toFixed(3)})`
  )

  // Full floor clearance across idle, patrol, chase, and entire attack sweep
  for (let p = 0; p <= Math.PI * 2; p += 0.4) {
    agent.state = ENEMY_STATES.CHASE
    agent._animateLimbs(p, 0.7)
    agent.mesh.updateMatrixWorld(true)
    const gaitBox = new THREE.Box3().setFromObject(agent.mesh)
    assert.ok(gaitBox.min.y >= 0, `Revenant feet stay above floor during chase stride at phase ${p.toFixed(2)} (minY=${gaitBox.min.y.toFixed(4)})`)
  }
  for (let t = 0; t <= 1.001; t += 0.1) {
    agent.state = ENEMY_STATES.ATTACK
    agent._animateAttack(Math.min(1, t))
    agent.mesh.updateMatrixWorld(true)
    const atkBox = new THREE.Box3().setFromObject(agent.mesh)
    assert.ok(atkBox.min.y >= 0, `Revenant feet stay above floor during attack at t=${t.toFixed(2)} (minY=${atkBox.min.y.toFixed(4)})`)
  }

  // Smooth damped state transitions (no single-frame snap across patrol/investigate/chase/attack/recovery)
  {
    const sampleJoints = () => [
      rig.upperBodyPivot.rotation.x,
      rig.leftArmPivot.rotation.x,
      rig.rightArmPivot.rotation.x,
      rig.leftLegPivot.rotation.x,
      rig.rightLegPivot.rotation.x,
      rig.headPivot.rotation.x,
    ]
    const dt = 1 / 60
    let prev = sampleJoints()
    const checkTransition = (label, nextState, stepFn) => {
      agent.state = nextState
      stepFn()
      const cur = sampleJoints()
      for (let j = 0; j < cur.length; j += 1) {
        const delta = Math.abs(cur[j] - prev[j])
        assert.ok(delta < 0.22, `Revenant ${label} joint[${j}] transitions smoothly without snap (delta=${delta.toFixed(4)})`)
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

  agent.state = ENEMY_STATES.ATTACK
  updateEnemyVisualState(agent.mesh, ENEMY_STATES.ATTACK)
  agent.resetAttackState()
  assert.equal(agent.getState(), ENEMY_STATES.PATROL, 'resetAttackState restores PATROL')
  assert.equal(rig.headPivot.rotation.y, 0, 'resetAttackState zeroes residual head yaw')
  assert.equal(
    rig.materials.sensor.color.getHex(),
    ENEMY_VISUAL_PRESETS.hunter.sensorNormal,
    'resetAttackState restores normal eye color from attack red'
  )

  agent.dispose()
  disposeEnemyPools()
}

console.log('ALL REVENANT VISUAL & RIG TESTS PASSED.')
