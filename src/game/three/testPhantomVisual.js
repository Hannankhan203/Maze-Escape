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
import { EnemyManager } from './EnemyManager.js'
import { syncEnemyHighContrast } from './highContrastOutlines.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

console.log('--- RUNNING PHANTOM PROCEDURAL APPARITION & RIG TESTS ---')

function countGeometryAndValidate(root) {
  let meshCount = 0
  let pointsCount = 0
  let triangleCount = 0
  let vertexCount = 0
  let particlePointCount = 0

  root.traverse((node) => {
    if (!node.isMesh && !node.isPoints) return
    const geo = node.geometry
    assert.ok(geo && geo.attributes?.position, `Renderable ${node.name} has position attribute`)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.array.length; i += 1) {
      assert.ok(Number.isFinite(pos.array[i]), `${node.name} has finite vertex coordinate`)
    }

    if (node.isMesh) {
      meshCount += 1
      assert.ok(geo.attributes?.normal, `Mesh ${node.name} has normal attribute`)
      const norm = geo.attributes.normal
      for (let i = 0; i < norm.array.length; i += 1) {
        assert.ok(Number.isFinite(norm.array[i]), `Mesh ${node.name} has finite normal coordinate`)
      }
      vertexCount += pos.count
      if (geo.index) {
        triangleCount += Math.floor(geo.index.count / 3)
      } else {
        triangleCount += Math.floor(pos.count / 3)
      }
    } else if (node.isPoints) {
      pointsCount += 1
      particlePointCount += pos.count
    }
  })

  return { meshCount, pointsCount, triangleCount, vertexCount, particlePointCount }
}

disposeEnemyPools()

// 1. Structural Apparition Anatomy, Translucent Layered Shadow Materials, Distorted Proportions & Hover Bounds
console.log('Test 1: Phantom Apparition Anatomy, Translucent Layers, Particles & Tall Silhouette')
{
  const phantom = buildEnemy({ id: 'phantom-inspect', type: 'brute' })
  const stats = countGeometryAndValidate(phantom)

  assert.equal(stats.meshCount, 16, `Phantom builds 16 articulated meshes (got ${stats.meshCount})`)
  assert.equal(stats.pointsCount, 2, `Phantom includes 2 procedural drifting particle clouds (got ${stats.pointsCount})`)
  assert.ok(stats.particlePointCount >= 100, `Phantom particle clouds contain >= 100 spectral motes (got ${stats.particlePointCount})`)
  assert.ok(
    stats.triangleCount >= 3500 && stats.triangleCount <= 16000,
    `Phantom carries sculpted procedural apparition detail (${stats.triangleCount} triangles)`
  )

  phantom.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(phantom)
  const height = box.max.y - box.min.y
  assert.ok(
    height >= 2.25 && height <= 2.95 && box.max.y < 3.0,
    `Phantom has towering supernatural proportions under 3m ceiling (minY=${box.min.y.toFixed(3)}, maxY=${box.max.y.toFixed(3)}, height=${height.toFixed(3)})`
  )

  // Verify the solid/hovering mesh body stays hovered cleanly above ground (no floor clipping)
  const torsoWorldBox = new THREE.Box3()
  phantom.traverse((node) => {
    if (node.isMesh) {
      torsoWorldBox.expandByObject(node)
    }
  })
  assert.ok(
    torsoWorldBox.min.y >= 0.01 && torsoWorldBox.min.y <= 0.2,
    `Phantom hovering mist legs float just above floor without z-fighting (mesh minY=${torsoWorldBox.min.y.toFixed(3)})`
  )

  const expectedNames = [
    'maze-enemy-phantom-torso',
    'maze-enemy-phantom-shroud',
    'maze-enemy-phantom-neck',
    'maze-enemy-phantom-head',
    'maze-enemy-phantom-veil',
    'maze-enemy-sensor-eye',
    'maze-enemy-phantom-leg-left',
    'maze-enemy-phantom-leg-right',
    'maze-enemy-phantom-upper-arm-left',
    'maze-enemy-phantom-shoulder-rag-left',
    'maze-enemy-phantom-forearm-left',
    'maze-enemy-phantom-hand-left',
    'maze-enemy-phantom-upper-arm-right',
    'maze-enemy-phantom-shoulder-rag-right',
    'maze-enemy-phantom-forearm-right',
    'maze-enemy-phantom-hand-right',
    'maze-enemy-phantom-particles-inner',
    'maze-enemy-phantom-particles-outer',
  ]
  for (const name of expectedNames) {
    assert.ok(phantom.getObjectByName(name), `Phantom includes expected part: ${name}`)
  }

  for (const legacyName of [
    'maze-enemy-carapace',
    'maze-enemy-chest-plate',
    'maze-enemy-pauldron-left',
    'maze-enemy-pauldron-right',
    'maze-enemy-reactor-left',
    'maze-enemy-reactor-right',
    'maze-enemy-blade-hand-left',
    'maze-enemy-claw-left',
  ]) {
    assert.equal(phantom.getObjectByName(legacyName), undefined, `Phantom omits old mechanical Brute part: ${legacyName}`)
  }

  // Verify distorted torso/shoulder/neck/head positioning
  const rig = phantom.userData.rig
  assert.ok(
    rig.leftArmPivot.position.y > rig.rightArmPivot.position.y + 0.04,
    `Phantom shoulders are unnaturally skewed (leftY=${rig.leftArmPivot.position.y}, rightY=${rig.rightArmPivot.position.y})`
  )
  assert.ok(
    Math.abs(rig.neckPivot.rotation.z) > 0.05 && Math.abs(rig.headPivot.rotation.z) > 0.08,
    'Phantom exhibits unnatural craned neck & tilted head positioning'
  )

  // Verify translucent shadow materials, fading vertex colors, and circular additive point material
  const coreMat = rig.materials.chassis
  const shroudMat = rig.materials.plating
  const veilMat = rig.materials.spines
  const particleMat = rig.materials.hardware
  const eyeMat = rig.materials.sensor

  assert.equal(coreMat.transparent, false, 'Phantom opaque void core prevents translucent depth-sorting glitches')
  assert.equal(coreMat.vertexColors, true, 'Phantom dark body uses fading vertex color gradient')
  assert.equal(shroudMat.transparent, true, 'Phantom layered shroud uses translucent fading shadow material')
  assert.equal(shroudMat.side, THREE.DoubleSide, 'Phantom tattered shroud renders double-sided')
  assert.equal(shroudMat.depthWrite, false, 'Phantom outer shroud avoids self-occlusion artifacts via depthWrite=false')
  assert.equal(veilMat.transparent, true, 'Phantom head veil is translucent')
  assert.equal(veilMat.depthWrite, false, 'Phantom head veil disables depthWrite cleanly')
  assert.equal(phantom.getObjectByName('maze-enemy-phantom-shroud').renderOrder, 2, 'Phantom shroud sorts after opaque core')
  assert.equal(particleMat.isPointsMaterial, true, 'Phantom particle material is Three.PointsMaterial')
  assert.equal(particleMat.blending, THREE.AdditiveBlending, 'Phantom spectral particles glow additively')
  assert.equal(typeof particleMat.onBeforeCompile, 'function', 'Phantom point material compiles circular glow + per-mote drift shader')
  assert.ok(rig.particleInner.geometry.attributes.aPhase, 'Inner spectral particles include per-mote aPhase attribute')
  assert.ok(rig.particleOuter.geometry.attributes.aPhase, 'Outer spectral particles include per-mote aPhase attribute')
  assert.ok(rig.particleUniforms?.uTime && rig.particleUniforms?.uMotionScale, 'Phantom exposes per-instance shader uniforms')
  assert.equal(rig.leftLegPivot.parent, rig.upperBodyPivot, 'Phantom shadow legs parent under upperBodyPivot to sync hover bob')
  assert.equal(rig.rightLegPivot.parent, rig.upperBodyPivot, 'Phantom shadow legs parent under upperBodyPivot to sync hover bob')
  assert.ok(eyeMat.emissiveIntensity >= 0.7 && eyeMat.emissiveIntensity <= 1.2, 'Phantom starts with faint supernatural glowing eyes')

  // Verify vertex colors on shroud fade dark near ragged tips
  const shroudCol = phantom.getObjectByName('maze-enemy-phantom-shroud').geometry.attributes.color
  let minLum = Infinity
  let maxLum = -Infinity
  for (let i = 0; i < shroudCol.count; i += 1) {
    const lum = (shroudCol.getX(i) + shroudCol.getY(i) + shroudCol.getZ(i)) / 3
    if (lum < minLum) minLum = lum
    if (lum > maxLum) maxLum = lum
  }
  assert.ok(
    minLum < 0.25 && maxLum > 0.65,
    `Phantom shroud vertex shading fades between luminous mantle (${maxLum.toFixed(2)}) and dark tatter wisps (${minLum.toFixed(2)})`
  )

  // Verify all rig pivots
  for (const pivotKey of [
    'upperBodyPivot',
    'shroudPivot',
    'neckPivot',
    'headPivot',
    'leftLegPivot',
    'rightLegPivot',
    'leftArmPivot',
    'rightArmPivot',
    'leftElbowPivot',
    'rightElbowPivot',
    'leftWristPivot',
    'rightWristPivot',
    'particleInner',
    'particleOuter',
  ]) {
    assert.ok(rig[pivotKey], `Phantom rig exposes ${pivotKey}`)
  }

  // Dynamic eye state update & sensor light toggle
  updateEnemyVisualState(phantom, ENEMY_STATES.CHASE)
  assert.equal(eyeMat.color.getHex(), ENEMY_VISUAL_PRESETS.brute.sensorChase)
  updateEnemyVisualState(phantom, ENEMY_STATES.ATTACK)
  assert.equal(eyeMat.color.getHex(), 0xff0033)
  assert.ok(eyeMat.emissiveIntensity >= 2.0, 'Phantom eyes flare intensely during attack')
  setEnemySensorLightEnabled(phantom, false)
  assert.equal(rig.sensorLight, null)
  setEnemySensorLightEnabled(phantom, true)
  assert.ok(rig.sensorLight && rig.sensorLight.position.y > 0.1, 'Re-enabled light aligns with Phantom face')

  // Verify high-contrast outline encloses rest-pose mesh silhouette (excluding ambient particle points)
  syncEnemyHighContrast(phantom, true)
  phantom.updateMatrixWorld(true)
  const outlineBox = new THREE.Box3().setFromObject(phantom.userData.highContrastOutline)
  assert.ok(
    outlineBox.min.x <= torsoWorldBox.min.x &&
      outlineBox.max.x >= torsoWorldBox.max.x &&
      outlineBox.min.y <= torsoWorldBox.min.y &&
      outlineBox.max.y >= torsoWorldBox.max.y &&
      outlineBox.min.z <= torsoWorldBox.min.z &&
      outlineBox.max.z >= torsoWorldBox.max.z,
    'Phantom high-contrast outline encloses rest-pose mesh silhouette'
  )
  syncEnemyHighContrast(phantom, false)

  console.log(
    `Metrics: meshes=${stats.meshCount}, points=${stats.pointsCount} (${stats.particlePointCount} motes), tris=${stats.triangleCount}, verts=${stats.vertexCount}, height=${height.toFixed(3)}m`
  )
  disposeEnemy(phantom)
}

// 2. Shared Pool Cap & Clean Disposal Verification Across All 3 Archetypes
console.log('Test 2: Wraith + Revenant + Phantom Shared Pool Ceiling & Clean Disposal')
{
  disposeEnemyPools()
  const wraith = buildEnemy({ id: 'pool-s', type: 'stalker' })
  const revenant = buildEnemy({ id: 'pool-h', type: 'hunter' })
  const phantom = buildEnemy({ id: 'pool-b', type: 'brute' })

  const poolStats = getEnemyPoolStats()
  assert.ok(
    poolStats.geometries <= 45,
    `Total pooled enemy geometries across Wraith + Revenant + Phantom stays <= 45 (got ${poolStats.geometries})`
  )
  console.log(`Pool Stats (All 3 Archetypes): geometries=${poolStats.geometries}, materials=${poolStats.materials}`)

  disposeEnemy(wraith)
  disposeEnemy(revenant)
  disposeEnemy(phantom)
  disposeEnemyPools()
  assert.equal(getEnemyPoolStats().geometries, 0)
  assert.equal(getEnemyPoolStats().materials, 0)
}

// 3. Articulated Spectral Animations, Drifting Particles & Preserved Brute Gameplay
console.log('Test 3: Phantom Articulated Animations, Spectral Drift & Preserved Brute Gameplay')
{
  const maze = generateMaze({ difficulty: 'hardcore', seed: 1337 })
  const agent = new EnemyAgent('phantom-ai-check', {
    maze,
    type: ENEMY_TYPES.BRUTE,
    spawnCell: { row: 1, col: 1 },
  })
  const rig = agent.mesh.userData.rig

  // Preserved Brute gameplay & combat balance
  assert.equal(agent.config.attackDamage, ENEMY_ARCHETYPES.brute.attackDamage, 'Phantom/Brute damage remains 40')
  assert.equal(agent.config.attackRange, ENEMY_ARCHETYPES.brute.attackRange, 'Phantom/Brute attackRange remains 2.05m')
  assert.equal(agent.config.radius, ENEMY_ARCHETYPES.brute.radius, 'Phantom/Brute collision radius remains 0.64m')

  // Idle spectral hover, shroud distortion & particle drift
  agent.state = ENEMY_STATES.IDLE
  agent.idleTimer = 2.0
  agent.update(0.35, null)
  const particleRot0 = rig.particleInner.rotation.y
  const shroudScale0 = rig.shroudPivot.scale.x
  assert.ok(
    Math.abs(rig.neckPivot.rotation.z) > 0.04 && Math.abs(rig.headPivot.rotation.z) > 0.05,
    'Phantom maintains eerie tilted neck & head during idle'
  )

  agent.update(0.35, null)
  assert.notEqual(rig.particleInner.rotation.y, particleRot0, 'Phantom inner particle cloud drifts over time')
  assert.notEqual(rig.shroudPivot.scale.x, shroudScale0, 'Phantom outer shroud subtly ripples over time')
  assert.ok(rig.particleUniforms.uTime.value > 0, 'Phantom shader uTime advances cleanly over update steps')

  // Patrol glide (-Z front: trailing legs < 0)
  agent.state = ENEMY_STATES.PATROL
  agent._animateLimbs(1.2, 0.45)
  assert.ok(
    rig.leftLegPivot.rotation.x < 0 &&
      rig.rightLegPivot.rotation.x < 0 &&
      Math.abs(rig.leftLegPivot.rotation.x - rig.rightLegPivot.rotation.x) > 0.1,
    'Phantom articulates trailing shadow legs behind (-Z) forward patrol glide'
  )

  // Investigate & Search craned alert
  agent.state = ENEMY_STATES.INVESTIGATE
  agent._animateLimbs(0.9, 0.5)
  assert.ok(
    rig.upperBodyPivot.rotation.x <= -0.18 && rig.leftElbowPivot.rotation.x > 0.4,
    'Phantom looms forward (-Z) with crooked flexed arms while investigating'
  )

  agent.state = ENEMY_STATES.SEARCH
  agent._animateLimbs(1.5, 0.5)
  assert.ok(rig.neckPivot.rotation.x <= -0.2, 'Phantom cranes elongated neck forward (-Z) during search')

  // Chase predatory spectral surge
  agent.state = ENEMY_STATES.CHASE
  agent._animateLimbs(0.6, 0.7)
  assert.ok(
    rig.upperBodyPivot.rotation.x <= -0.25 &&
      rig.leftArmPivot.rotation.x > 0.5 &&
      rig.rightArmPivot.rotation.x > 0.5,
    'Phantom reaches forward (-Z) with elongated clawed arms during chase'
  )

  // Attack windup -> forward overhead cleave -> ceiling/floor bounds & hit sync
  assert.equal(ENEMY_ARCHETYPES.brute.attackHitDelay, 0.58, 'Phantom/Brute attackHitDelay tuned to downward cleave apex')
  agent.resetAttackState()
  agent.state = ENEMY_STATES.ATTACK
  agent._animateAttack(0.35)
  assert.ok(
    Math.abs(rig.leftArmPivot.rotation.x - rig.rightArmPivot.rotation.x) < 1e-4 &&
      rig.leftArmPivot.rotation.x > 1.0,
    'Phantom preserves symmetric overhead double-arm cleave windup (+rx forward/up)'
  )
  agent._animateAttack(0.6)
  assert.ok(
    rig.upperBodyPivot.rotation.x < -0.2 && rig.leftArmPivot.rotation.x > 0.3 && rig.leftArmPivot.rotation.x < 1.2,
    'Phantom slams arms down sharply forward (-Z) through strike'
  )

  // Verify ceiling clearance (<= 2.65m) and floor clearance (>= 0.01m) across full attack cycle
  let peakAttackY = -Infinity
  let lowestAttackY = Infinity
  for (let p = 0; p <= 1.001; p += 0.05) {
    agent._animateAttack(Math.min(1, p))
    agent.mesh.updateMatrixWorld(true)
    const meshBox = new THREE.Box3()
    agent.mesh.traverse((node) => {
      if (node.isMesh) meshBox.expandByObject(node)
    })
    peakAttackY = Math.max(peakAttackY, meshBox.max.y)
    lowestAttackY = Math.min(lowestAttackY, meshBox.min.y)
  }
  assert.ok(
    peakAttackY <= 2.65 && lowestAttackY >= 0.01,
    `Phantom attack remains safely below 3m ceiling & above floor (minY=${lowestAttackY.toFixed(3)}, maxY=${peakAttackY.toFixed(3)})`
  )

  // Hit-sync check entering from CHASE
  agent.resetAttackState()
  agent.state = ENEMY_STATES.CHASE
  agent._animateLimbs(0.4, 0.7)
  const pos = agent.getPosition()
  const closePlayerCtx = {
    playerWorldPos: { x: pos.x, y: 0, z: pos.z - 1.2 },
    playerGridCell: agent.getGridCell(),
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
  }
  agent.yaw = 0
  let hitProgress = null
  const steps = Math.ceil(agent.config.attackDuration / 0.05)
  for (let s = 0; s < steps; s += 1) {
    const res = agent.update(0.05, closePlayerCtx)
    const prog = agent.attackTimer / agent.config.attackDuration
    if (s > 0 && agent.state === ENEMY_STATES.ATTACK && prog < 0.35) {
      assert.equal(res?.attackHit, null, 'Phantom never deals damage during overhead raise windup')
    }
    if (res?.attackHit) {
      hitProgress = (s * 0.05) / agent.config.attackDuration
    }
  }
  assert.ok(
    hitProgress !== null && hitProgress >= 0.45 && hitProgress <= 0.68,
    `Phantom attackHit fires inside downward cleave impact window (progress=${hitProgress?.toFixed(3)})`
  )

  // Runtime particlesEnabled & reducedMotion propagation through EnemyManager & MazeSceneEngine
  const directMgr = new EnemyManager(null, { autoSpawn: true, particlesEnabled: false, reducedMotion: true })
  directMgr.setMaze(maze)
  const mgrPhantom = directMgr.getEnemies().find((e) => e.getType() === ENEMY_TYPES.BRUTE)
  assert.ok(mgrPhantom, 'EnemyManager spawns Phantom on hardcore maze')
  assert.equal(mgrPhantom.mesh.userData.rig.particleInner.visible, false, 'EnemyManager constructor particlesEnabled=false hides particles')
  assert.equal(mgrPhantom.mesh.userData.rig.particleUniforms.uMotionScale.value, 0.3, 'EnemyManager constructor reducedMotion=true scales shader motion')
  directMgr.setParticlesEnabled(true)
  directMgr.setReducedMotion(false)
  assert.equal(mgrPhantom.mesh.userData.rig.particleInner.visible, true, 'EnemyManager.setParticlesEnabled toggles particles cleanly')
  assert.equal(mgrPhantom.mesh.userData.rig.particleUniforms.uMotionScale.value, 1.0, 'EnemyManager.setReducedMotion restores shader motion cleanly')
  directMgr.dispose()

  const mockHost = { appendChild: () => {}, removeChild: () => {}, clientWidth: 640, clientHeight: 480 }
  const mockRenderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  const engine = new MazeSceneEngine(mockHost, { createRenderer: () => mockRenderer })
  engine.setMaze(maze)
  engine.updateGraphicsConfig({ particlesEnabled: false })
  engine.updateHorrorConfig({ reducedMotion: true })
  const scenePhantom = engine.getEnemies().find((e) => e.getType() === ENEMY_TYPES.BRUTE)
  assert.ok(scenePhantom, 'Scene spawns Phantom on hardcore maze')
  assert.equal(scenePhantom.mesh.userData.rig.particleInner.visible, false, 'particlesEnabled=false hides Phantom inner particle cloud')
  assert.equal(scenePhantom.mesh.userData.rig.particleOuter.visible, false, 'particlesEnabled=false hides Phantom outer particle cloud')
  assert.equal(scenePhantom.mesh.userData.rig.particleUniforms.uMotionScale.value, 0.3, 'reducedMotion=true dampens Phantom shader uMotionScale to 0.3')
  engine.updateGraphicsConfig({ particlesEnabled: true })
  assert.equal(scenePhantom.mesh.userData.rig.particleInner.visible, true, 'particlesEnabled=true restores Phantom inner particle cloud')
  engine.dispose()

  agent.resetAttackState()
  assert.equal(agent.getState(), ENEMY_STATES.PATROL, 'resetAttackState restores PATROL')
  assert.ok(
    Math.abs(rig.shroudPivot.scale.x - 1) <= 0.045,
    'resetAttackState restores shroud distortion to gentle idle envelope'
  )

  agent.dispose()
  disposeEnemyPools()
}

console.log('ALL PHANTOM VISUAL & RIG TESTS PASSED.')
