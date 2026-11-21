import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  CAMERA_MODES,
  THIRD_PERSON_CAMERA_MODES,
} from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  DEFAULT_PLAYER_ANIM_CONFIG,
  PLAYER_ANIM_STATES,
  PlayerAnimator,
} from './PlayerAnimator.js'
import { buildPlayer, disposePlayer } from './buildPlayer.js'
import { disposeAllSharedPools } from './sharedResources.js'
import { gridToWorld } from '../world/worldCoords.js'

console.log('--- RUNNING PROCEDURAL PLAYER ANIMATOR TESTS (PHASE 3) ---')

const ALL_16_PIVOT_KEYS = [
  'pelvisPivot',
  'spinePivot',
  'neckPivot',
  'headPivot',
  'leftShoulderPivot',
  'leftElbowPivot',
  'leftWristPivot',
  'rightShoulderPivot',
  'rightElbowPivot',
  'rightWristPivot',
  'leftHipPivot',
  'leftKneePivot',
  'leftAnklePivot',
  'rightHipPivot',
  'rightKneePivot',
  'rightAnklePivot',
]

function assertAllRigTransformsFinite(rig, label = 'rig') {
  for (const key of ALL_16_PIVOT_KEYS) {
    const pivot = rig[key]
    if (!pivot) continue
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(
        Number.isFinite(pivot.position[axis]),
        `${label}.${key}.position.${axis} is finite`
      )
      assert.ok(
        Number.isFinite(pivot.rotation[axis]),
        `${label}.${key}.rotation.${axis} is finite`
      )
    }
  }
}

function measureBootsWorldMinY(player) {
  player.updateMatrixWorld(true)
  const leftBoot = player.getObjectByName('maze-player-boot-left')
  const rightBoot = player.getObjectByName('maze-player-boot-right')
  leftBoot.geometry.computeBoundingBox()
  rightBoot.geometry.computeBoundingBox()
  const leftBox = leftBoot.geometry.boundingBox
    .clone()
    .applyMatrix4(leftBoot.matrixWorld)
  const rightBox = rightBoot.geometry.boundingBox
    .clone()
    .applyMatrix4(rightBoot.matrixWorld)
  return Math.min(leftBox.min.y, rightBox.min.y)
}

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 800,
    clientHeight: 500,
  }
  const mockRenderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    pixelRatio: 1,
    lastSize: { width: 800, height: 500 },
    renderCalls: 0,
    setPixelRatio: (r) => {
      mockRenderer.pixelRatio = r
    },
    setSize: (w, h) => {
      mockRenderer.lastSize = { width: w, height: h }
    },
    render: () => {
      mockRenderer.renderCalls += 1
    },
    dispose: () => {},
    getContext: () => null,
  }
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    ...config,
  })
}

// ---------------------------------------------------------------------------
// 1. Public API, Idle Breathing, Weight Shift, Relaxed Limbs & Grounding
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Idle chest breathing, weight shift, relaxed arms/head & grounded feet')
  disposeAllSharedPools()

  assert.equal(PLAYER_ANIM_STATES.IDLE, 'idle')
  assert.equal(PLAYER_ANIM_STATES.WALK, 'walk')
  assert.equal(PLAYER_ANIM_STATES.SPRINT, 'sprint')
  assert.ok(Number.isFinite(DEFAULT_PLAYER_ANIM_CONFIG.idleFrequency))

  const player = buildPlayer()
  const rig = player.userData.rig
  const animator = new PlayerAnimator(player)

  let minSpineY = Infinity
  let maxSpineY = -Infinity
  let minSpinePitch = Infinity
  let maxSpinePitch = -Infinity
  let minPelvisRoll = Infinity
  let maxPelvisRoll = -Infinity
  let minHeadYaw = Infinity
  let maxHeadYaw = -Infinity
  let minBootY = Infinity
  let maxBootY = -Infinity

  for (let i = 0; i < 180; i += 1) {
    animator.update(0.02, { moved: false, isSprinting: false, actualSpeed: 0 })
    assertAllRigTransformsFinite(rig, `idle[${i}]`)

    minSpineY = Math.min(minSpineY, rig.spinePivot.position.y)
    maxSpineY = Math.max(maxSpineY, rig.spinePivot.position.y)
    minSpinePitch = Math.min(minSpinePitch, rig.spinePivot.rotation.x)
    maxSpinePitch = Math.max(maxSpinePitch, rig.spinePivot.rotation.x)
    minPelvisRoll = Math.min(minPelvisRoll, rig.pelvisPivot.rotation.z)
    maxPelvisRoll = Math.max(maxPelvisRoll, rig.pelvisPivot.rotation.z)
    minHeadYaw = Math.min(minHeadYaw, rig.headPivot.rotation.y)
    maxHeadYaw = Math.max(maxHeadYaw, rig.headPivot.rotation.y)

    assert.ok(
      rig.leftElbowPivot.rotation.x > 0.1 && rig.rightElbowPivot.rotation.x > 0.1,
      'Idle elbows hold natural relaxed forward bend'
    )
    assert.ok(
      Math.abs(rig.leftWristPivot.rotation.x) > 0.01 &&
        Math.abs(rig.leftWristPivot.rotation.z) > 0.01,
      'Idle wrists hang with natural relaxation'
    )

    const bootMinY = measureBootsWorldMinY(player)
    minBootY = Math.min(minBootY, bootMinY)
    maxBootY = Math.max(maxBootY, bootMinY)
  }

  const state = animator.getState()
  assert.equal(state.state, 'idle')
  assert.equal(state.locomotionWeight, 0)
  assert.ok(maxSpineY - minSpineY > 0.002, 'Idle chest exhibits subtle vertical breathing')
  assert.ok(maxSpinePitch - minSpinePitch > 0.01, 'Idle chest exhibits breathing pitch')
  assert.ok(maxPelvisRoll - minPelvisRoll > 0.01, 'Idle pelvis exhibits subtle weight shift')
  assert.ok(maxHeadYaw - minHeadYaw > 0.015 && maxHeadYaw - minHeadYaw < 0.15, 'Idle head exhibits very subtle movement')
  assert.ok(minBootY >= -0.012 && maxBootY <= 0.012, `Idle feet stay stably grounded (min=${minBootY.toFixed(4)}, max=${maxBootY.toFixed(4)})`)

  animator.dispose()
  disposePlayer(player)
  disposeAllSharedPools()
  console.log('✓ Idle breathing, weight shifting, relaxed limbs & grounded feet verified')
}

// ---------------------------------------------------------------------------
// 2. Walk Articulation: Hip, Knee, Ankle, Shoulder, Elbow, Pelvis/Spine & Head
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Walk hip, knee, ankle, shoulder, elbow, torso counter-rotation & grounding')
  disposeAllSharedPools()

  const player = buildPlayer()
  const rig = player.userData.rig
  const animator = new PlayerAnimator(player)

  const walkMotion = {
    moved: true,
    isSprinting: false,
    actualSpeed: 5.5,
    walkSpeed: 5.5,
    sprintSpeed: 9.0,
  }

  let leftHipMin = Infinity
  let leftHipMax = -Infinity
  let leftKneeMin = Infinity
  let leftKneeMax = -Infinity
  let leftAnkleMin = Infinity
  let leftAnkleMax = -Infinity
  let leftShoulderMin = Infinity
  let leftShoulderMax = -Infinity
  let leftElbowMin = Infinity
  let leftElbowMax = -Infinity
  let bootMinY = Infinity
  let oppositeArmSamples = 0
  let counterTorsoSamples = 0
  let forwardElbowHigherCount = 0

  // Warm up blend into full walk
  for (let i = 0; i < 30; i += 1) {
    animator.update(0.016, walkMotion)
  }

  const prevPhase = animator.getState().stridePhase
  animator.update(0.016, walkMotion)
  const nextPhase = animator.getState().stridePhase
  assert.notEqual(nextPhase, prevPhase, 'Distance-synchronized stridePhase advances during walk')

  for (let i = 0; i < 60; i += 1) {
    animator.update(0.016, walkMotion)
    assertAllRigTransformsFinite(rig, `walk[${i}]`)

    leftHipMin = Math.min(leftHipMin, rig.leftHipPivot.rotation.x)
    leftHipMax = Math.max(leftHipMax, rig.leftHipPivot.rotation.x)
    leftKneeMin = Math.min(leftKneeMin, rig.leftKneePivot.rotation.x)
    leftKneeMax = Math.max(leftKneeMax, rig.leftKneePivot.rotation.x)
    leftAnkleMin = Math.min(leftAnkleMin, rig.leftAnklePivot.rotation.x)
    leftAnkleMax = Math.max(leftAnkleMax, rig.leftAnklePivot.rotation.x)
    leftShoulderMin = Math.min(leftShoulderMin, rig.leftShoulderPivot.rotation.x)
    leftShoulderMax = Math.max(leftShoulderMax, rig.leftShoulderPivot.rotation.x)
    leftElbowMin = Math.min(leftElbowMin, rig.leftElbowPivot.rotation.x)
    leftElbowMax = Math.max(leftElbowMax, rig.leftElbowPivot.rotation.x)

    assert.ok(
      rig.leftKneePivot.rotation.x <= 1e-6 && rig.rightKneePivot.rotation.x <= 1e-6,
      'Walk knees never hyperextend forward (> 0)'
    )
    assert.ok(
      rig.leftHipPivot.position.y === 0 && rig.rightHipPivot.position.y === 0,
      'Hip pivots remain socketed in pelvis (no floating leg detachment)'
    )

    if (
      Math.abs(rig.leftHipPivot.rotation.x) > 0.1 &&
      rig.leftHipPivot.rotation.x * rig.leftShoulderPivot.rotation.x < 0 &&
      rig.leftHipPivot.rotation.x * rig.rightShoulderPivot.rotation.x > 0
    ) {
      oppositeArmSamples += 1
    }

    if (
      Math.abs(rig.pelvisPivot.rotation.y) > 0.01 &&
      rig.pelvisPivot.rotation.y * rig.spinePivot.rotation.y < 0
    ) {
      counterTorsoSamples += 1
    }

    if (rig.leftShoulderPivot.rotation.x > 0.15 && rig.leftElbowPivot.rotation.x > 0.38) {
      forwardElbowHigherCount += 1
    }

    bootMinY = Math.min(bootMinY, measureBootsWorldMinY(player))
  }

  assert.ok(leftHipMax - leftHipMin > 0.75, `Walk hip swing active (range=${(leftHipMax - leftHipMin).toFixed(3)})`)
  assert.ok(leftKneeMin < -0.55 && leftKneeMax <= 0, `Walk knee flexion articulated (min=${leftKneeMin.toFixed(3)})`)
  assert.ok(leftAnkleMax - leftAnkleMin > 0.35, `Walk heel-to-toe ankle articulation active (range=${(leftAnkleMax - leftAnkleMin).toFixed(3)})`)
  assert.ok(leftShoulderMax - leftShoulderMin > 0.55, `Walk opposite arm swing active (range=${(leftShoulderMax - leftShoulderMin).toFixed(3)})`)
  assert.ok(leftElbowMax - leftElbowMin > 0.25 && forwardElbowHigherCount > 0, 'Walk elbows bend dynamically with arm swing')
  assert.ok(oppositeArmSamples > 10, 'Walk arms swing opposite to legs')
  assert.ok(counterTorsoSamples > 10, 'Walk torso counter-rotates against pelvis sway')
  assert.ok(bootMinY >= -0.015, `Walk boots avoid ground penetration (minY=${bootMinY.toFixed(4)})`)

  // Verify right-side pivots, wrists, and neck all articulate across a full stride
  let rHipMin = Infinity
  let rHipMax = -Infinity
  let rKneeMin = Infinity
  let rAnkleMin = Infinity
  let rAnkleMax = -Infinity
  let rShoulderMin = Infinity
  let rShoulderMax = -Infinity
  let rElbowMin = Infinity
  let rElbowMax = -Infinity
  let lWristMin = Infinity
  let lWristMax = -Infinity
  let rWristMin = Infinity
  let rWristMax = -Infinity
  let neckYawMin = Infinity
  let neckYawMax = -Infinity

  for (let i = 0; i < 40; i += 1) {
    animator.update(0.016, walkMotion)
    rHipMin = Math.min(rHipMin, rig.rightHipPivot.rotation.x)
    rHipMax = Math.max(rHipMax, rig.rightHipPivot.rotation.x)
    rKneeMin = Math.min(rKneeMin, rig.rightKneePivot.rotation.x)
    rAnkleMin = Math.min(rAnkleMin, rig.rightAnklePivot.rotation.x)
    rAnkleMax = Math.max(rAnkleMax, rig.rightAnklePivot.rotation.x)
    rShoulderMin = Math.min(rShoulderMin, rig.rightShoulderPivot.rotation.x)
    rShoulderMax = Math.max(rShoulderMax, rig.rightShoulderPivot.rotation.x)
    rElbowMin = Math.min(rElbowMin, rig.rightElbowPivot.rotation.x)
    rElbowMax = Math.max(rElbowMax, rig.rightElbowPivot.rotation.x)
    lWristMin = Math.min(lWristMin, rig.leftWristPivot.rotation.x)
    lWristMax = Math.max(lWristMax, rig.leftWristPivot.rotation.x)
    rWristMin = Math.min(rWristMin, rig.rightWristPivot.rotation.x)
    rWristMax = Math.max(rWristMax, rig.rightWristPivot.rotation.x)
    neckYawMin = Math.min(neckYawMin, rig.neckPivot.rotation.y)
    neckYawMax = Math.max(neckYawMax, rig.neckPivot.rotation.y)
  }
  assert.ok(rHipMax - rHipMin > 0.75, 'Right hip swing active')
  assert.ok(rKneeMin < -0.55, 'Right knee flexion articulated')
  assert.ok(rAnkleMax - rAnkleMin > 0.35, 'Right ankle heel-to-toe active')
  assert.ok(rShoulderMax - rShoulderMin > 0.55, 'Right shoulder swing active')
  assert.ok(rElbowMax - rElbowMin > 0.25, 'Right elbow dynamic bend active')
  assert.ok(lWristMax - lWristMin > 0.08 && rWristMax - rWristMin > 0.08, 'Both wrists articulate dynamically')
  assert.ok(neckYawMax - neckYawMin > 0.005, 'Neck pivot counter-stabilizes yaw')

  // Head stabilization counters torso pitch (measured on active walk rig)
  const worldTorsoPitch = rig.pelvisPivot.rotation.x + rig.spinePivot.rotation.x
  const worldHeadPitch =
    worldTorsoPitch + rig.neckPivot.rotation.x + rig.headPivot.rotation.x
  assert.ok(
    Math.abs(worldHeadPitch) < Math.abs(worldTorsoPitch),
    'Neck and head stabilize head pitch against torso lean during walk'
  )

  // Stance-foot slip minimization check during mid-stance (boot world Z vs ground advance)
  const slipPos = new THREE.Vector3()
  let midStanceChecked = false
  let prevFootZ = null
  const dtStep = 0.008
  for (let i = 0; i < 60; i += 1) {
    animator.update(dtStep, walkMotion)
    const phase = animator.getState().stridePhase
    const isLeftMidStance = Math.abs(phase - Math.PI) < 0.35
    player.updateMatrixWorld(true)
    rig.leftAnklePivot.getWorldPosition(slipPos)
    if (isLeftMidStance && prevFootZ !== null) {
      const footSweepSpeed = (slipPos.z - prevFootZ) / dtStep
      const slipErrorRatio =
        Math.abs(footSweepSpeed - walkMotion.actualSpeed) / walkMotion.actualSpeed
      assert.ok(
        slipErrorRatio < 0.2,
        `Mid-stance foot velocity matches ground speed closely (foot=${footSweepSpeed.toFixed(2)}, ground=${walkMotion.actualSpeed.toFixed(2)})`
      )
      midStanceChecked = true
    }
    prevFootZ = isLeftMidStance ? slipPos.z : null
  }
  assert.ok(midStanceChecked, 'Mid-stance foot slip window sampled')

  // Distance-synchronized stride phase scales linearly with actualSpeed
  const slowAnim = new PlayerAnimator()
  const fastAnim = new PlayerAnimator()
  slowAnim.update(0.05, { moved: true, isSprinting: false, actualSpeed: 2.75 })
  fastAnim.update(0.05, { moved: true, isSprinting: false, actualSpeed: 5.5 })
  const slowPhase = slowAnim.getState().stridePhase
  const fastPhase = fastAnim.getState().stridePhase
  assert.ok(
    Math.abs(fastPhase - slowPhase * 2) < 1e-4,
    `stridePhase advances proportionally to actualSpeed (slow=${slowPhase.toFixed(4)}, fast=${fastPhase.toFixed(4)})`
  )
  slowAnim.update(0.016, { moved: true, isSprinting: false, actualSpeed: 0 })
  assert.equal(slowAnim.getState().state, 'idle', 'moved=true with actualSpeed=0 resolves to idle')
  slowAnim.dispose()
  fastAnim.dispose()

  animator.dispose()
  disposePlayer(player)
  disposeAllSharedPools()
  console.log('✓ Walk articulation, counter-rotation, stabilization & grounding verified')
}

// ---------------------------------------------------------------------------
// 3. Sprint Stronger Stride, Lean, Knee/Ankle/Elbow Drive & Head Stability
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Sprint stronger forward lean, deeper knee flexion, push-off & arm drive')
  disposeAllSharedPools()

  const walkPlayer = buildPlayer()
  const sprintPlayer = buildPlayer()
  const walkAnim = new PlayerAnimator(walkPlayer)
  const sprintAnim = new PlayerAnimator(sprintPlayer)

  const walkMotion = { moved: true, isSprinting: false, actualSpeed: 5.5 }
  const sprintMotion = { moved: true, isSprinting: true, actualSpeed: 9.0 }

  for (let i = 0; i < 35; i += 1) {
    walkAnim.update(0.016, walkMotion)
    sprintAnim.update(0.016, sprintMotion)
  }

  let walkHipRange = [Infinity, -Infinity]
  let sprintHipRange = [Infinity, -Infinity]
  let walkKneeMin = Infinity
  let sprintKneeMin = Infinity
  let walkAnkleMin = Infinity
  let sprintAnkleMin = Infinity
  let walkShoulderRange = [Infinity, -Infinity]
  let sprintShoulderRange = [Infinity, -Infinity]
  let sprintElbowAvg = 0
  let walkElbowAvg = 0
  let sprintBootMinY = Infinity
  let maxSprintHeadPitch = 0
  let maxSprintHeadYaw = 0

  const samples = 60
  for (let i = 0; i < samples; i += 1) {
    walkAnim.update(0.016, walkMotion)
    sprintAnim.update(0.016, sprintMotion)

    const wRig = walkPlayer.userData.rig
    const sRig = sprintPlayer.userData.rig
    assertAllRigTransformsFinite(sRig, `sprint[${i}]`)

    walkHipRange[0] = Math.min(walkHipRange[0], wRig.leftHipPivot.rotation.x)
    walkHipRange[1] = Math.max(walkHipRange[1], wRig.leftHipPivot.rotation.x)
    sprintHipRange[0] = Math.min(sprintHipRange[0], sRig.leftHipPivot.rotation.x)
    sprintHipRange[1] = Math.max(sprintHipRange[1], sRig.leftHipPivot.rotation.x)

    walkKneeMin = Math.min(walkKneeMin, wRig.leftKneePivot.rotation.x)
    sprintKneeMin = Math.min(sprintKneeMin, sRig.leftKneePivot.rotation.x)

    walkAnkleMin = Math.min(walkAnkleMin, wRig.leftAnklePivot.rotation.x)
    sprintAnkleMin = Math.min(sprintAnkleMin, sRig.leftAnklePivot.rotation.x)

    walkShoulderRange[0] = Math.min(walkShoulderRange[0], wRig.leftShoulderPivot.rotation.x)
    walkShoulderRange[1] = Math.max(walkShoulderRange[1], wRig.leftShoulderPivot.rotation.x)
    sprintShoulderRange[0] = Math.min(sprintShoulderRange[0], sRig.leftShoulderPivot.rotation.x)
    sprintShoulderRange[1] = Math.max(sprintShoulderRange[1], sRig.leftShoulderPivot.rotation.x)

    walkElbowAvg += wRig.leftElbowPivot.rotation.x
    sprintElbowAvg += sRig.leftElbowPivot.rotation.x

    sprintBootMinY = Math.min(sprintBootMinY, measureBootsWorldMinY(sprintPlayer))

    const sprintTorsoPitch = sRig.pelvisPivot.rotation.x + sRig.spinePivot.rotation.x
    const sprintHeadPitch =
      sprintTorsoPitch + sRig.neckPivot.rotation.x + sRig.headPivot.rotation.x
    const sprintHeadYaw =
      sRig.pelvisPivot.rotation.y +
      sRig.spinePivot.rotation.y +
      sRig.neckPivot.rotation.y +
      sRig.headPivot.rotation.y

    maxSprintHeadPitch = Math.max(maxSprintHeadPitch, Math.abs(sprintHeadPitch))
    maxSprintHeadYaw = Math.max(maxSprintHeadYaw, Math.abs(sprintHeadYaw))

    // Stronger forward lean during sprint
    const walkTorsoPitch = wRig.pelvisPivot.rotation.x + wRig.spinePivot.rotation.x
    assert.ok(
      sprintTorsoPitch < walkTorsoPitch - 0.08,
      'Sprint maintains stronger forward torso lean than walk'
    )
  }

  walkElbowAvg /= samples
  sprintElbowAvg /= samples

  assert.equal(sprintAnim.getState().state, 'sprint')
  assert.ok(
    sprintHipRange[1] - sprintHipRange[0] > walkHipRange[1] - walkHipRange[0] + 0.35,
    'Sprint drives longer strides than walk'
  )
  assert.ok(
    sprintKneeMin < walkKneeMin - 0.35,
    `Sprint produces deeper knee flexion (sprint=${sprintKneeMin.toFixed(3)}, walk=${walkKneeMin.toFixed(3)})`
  )
  assert.ok(
    sprintAnkleMin < walkAnkleMin - 0.05,
    `Sprint exhibits stronger ankle push-off (sprint=${sprintAnkleMin.toFixed(3)}, walk=${walkAnkleMin.toFixed(3)})`
  )
  assert.ok(
    sprintShoulderRange[1] - sprintShoulderRange[0] >
      walkShoulderRange[1] - walkShoulderRange[0] + 0.5,
    'Sprint drives stronger arm pump than walk'
  )
  assert.ok(
    sprintElbowAvg > walkElbowAvg + 0.55,
    `Sprint bends elbows into athletic runner posture (sprintAvg=${sprintElbowAvg.toFixed(3)}, walkAvg=${walkElbowAvg.toFixed(3)})`
  )
  assert.ok(maxSprintHeadPitch < 0.06 && maxSprintHeadYaw < 0.06, 'Sprint keeps head stable and forward-facing')
  assert.ok(sprintBootMinY >= -0.015, `Sprint boots avoid ground penetration (minY=${sprintBootMinY.toFixed(4)})`)

  walkAnim.dispose()
  sprintAnim.dispose()
  disposePlayer(walkPlayer)
  disposePlayer(sprintPlayer)
  disposeAllSharedPools()
  console.log('✓ Sprint lean, deeper knee flexion, push-off, arm drive & head stability verified')
}

// ---------------------------------------------------------------------------
// 4. Smooth State Transitions, Stopping Behavior, Reset & Group Replacement
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Smooth transitions, stopping damping, reset() & setPlayerGroup() replacement')
  disposeAllSharedPools()

  const playerA = buildPlayer()
  const playerB = buildPlayer()
  const rigA = playerA.userData.rig
  const rigB = playerB.userData.rig
  const animator = new PlayerAnimator(playerA)

  let prevHip = rigA.leftHipPivot.rotation.x
  let prevSpineLean = rigA.spinePivot.rotation.x

  // Idle -> Walk -> Sprint -> Walk -> Idle smooth step-by-step check
  const schedule = [
    ...Array(30).fill({ moved: true, isSprinting: false, actualSpeed: 5.5 }),
    ...Array(30).fill({ moved: true, isSprinting: true, actualSpeed: 9.0 }),
    ...Array(30).fill({ moved: true, isSprinting: false, actualSpeed: 5.5 }),
    ...Array(50).fill({ moved: false, isSprinting: false, actualSpeed: 0 }),
  ]

  for (let i = 0; i < schedule.length; i += 1) {
    animator.update(0.008, schedule[i])
    const hip = rigA.leftHipPivot.rotation.x
    const spineLean = rigA.spinePivot.rotation.x
    assert.ok(
      Math.abs(hip - prevHip) < 0.3 && Math.abs(spineLean - prevSpineLean) < 0.06,
      `Frame ${i} transition remains smooth without discontinuous snaps (dHip=${Math.abs(hip - prevHip).toFixed(3)}, dLean=${Math.abs(spineLean - prevSpineLean).toFixed(3)})`
    )
    if (i === 30) {
      // First frame switching Walk -> Sprint blends weights gradually rather than snapping
      const st = animator.getState()
      assert.ok(
        st.sprintWeight > 0 && st.sprintWeight < 0.25 && st.walkWeight > 0.7,
        'Walk -> Sprint blends weights smoothly on initial transition frame'
      )
    }
    prevHip = hip
    prevSpineLean = spineLean
  }

  const stoppedState = animator.getState()
  assert.deepEqual(
    Object.keys(stoppedState).sort(),
    ['idlePhase', 'locomotionWeight', 'sprintWeight', 'state', 'stridePhase', 'walkWeight'],
    'getState() telemetry schema preserved'
  )
  assert.equal(stoppedState.state, 'idle')
  assert.equal(stoppedState.locomotionWeight, 0, 'Stopping settles locomotionWeight cleanly to 0')
  assert.equal(stoppedState.stridePhase, 0)

  // Put playerA mid-sprint, then replace with playerB
  for (let i = 0; i < 15; i += 1) {
    animator.update(0.016, { moved: true, isSprinting: true, actualSpeed: 9.0 })
  }
  assert.ok(Math.abs(rigA.leftElbowPivot.rotation.x) > 0.5)

  animator.setPlayerGroup(playerB)
  // Old playerA was reset on detach, new playerB is reset to neutral pose
  for (const key of ALL_16_PIVOT_KEYS) {
    assert.equal(rigA[key].rotation.x, 0, `Old playerA.${key} reset on replacement`)
    assert.equal(rigA[key].rotation.y, 0)
    assert.equal(rigA[key].rotation.z, 0)
    assert.equal(rigB[key].rotation.x, 0, `New playerB.${key} reset on attach`)
    assert.equal(rigB[key].rotation.y, 0)
    assert.equal(rigB[key].rotation.z, 0)
  }
  assert.equal(rigB.pelvisPivot.position.y, rigB.restPose.pelvisY)
  assert.equal(rigB.spinePivot.position.y, rigB.restPose.spineY)

  // Animating playerB does not mutate playerA
  animator.update(0.016, { moved: true, isSprinting: false, actualSpeed: 5.5 })
  assert.equal(rigA.leftHipPivot.rotation.x, 0)
  assert.notEqual(rigB.leftHipPivot.rotation.x, 0)

  // Detaching via setPlayerGroup(null) resets playerB and runs safely with no rig
  animator.setPlayerGroup(null)
  assert.equal(rigB.leftHipPivot.rotation.x, 0)
  animator.update(0.016, { moved: true, isSprinting: true, actualSpeed: 9.0 })
  animator.setPlayerGroup(playerB)
  animator.update(0.016, { moved: true, isSprinting: false, actualSpeed: 5.5 })

  animator.reset()
  for (const key of ALL_16_PIVOT_KEYS) {
    assert.equal(rigB[key].rotation.x, 0, `After reset(), ${key}.rotation.x === 0`)
    assert.equal(rigB[key].rotation.y, 0, `After reset(), ${key}.rotation.y === 0`)
    assert.equal(rigB[key].rotation.z, 0, `After reset(), ${key}.rotation.z === 0`)
  }
  assert.equal(rigB.pelvisPivot.position.y, rigB.restPose.pelvisY)
  assert.equal(rigB.spinePivot.position.y, rigB.restPose.spineY)

  animator.dispose()
  disposePlayer(playerA)
  disposePlayer(playerB)
  disposeAllSharedPools()
  console.log('✓ Smooth transitions, stopping damping, reset & group replacement verified')
}

// ---------------------------------------------------------------------------
// 5. Root Transform Invariance, Missing Optional Pivots & Invalid Inputs
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Root transform invariance, missing optional pivots, legacy rig & invalid input guard')
  disposeAllSharedPools()

  const player = buildPlayer({
    position: { x: 4.25, y: 0, z: -7.5 },
    yaw: 1.15,
  })
  player.rotation.x = 0.02
  player.rotation.z = -0.01

  const animator = new PlayerAnimator(player)
  const inputs = [
    [0.016, { moved: false, actualSpeed: 0 }],
    [0.016, { moved: true, isSprinting: false, actualSpeed: 5.5 }],
    [0.016, { moved: true, isSprinting: true, actualSpeed: 9.0 }],
    [NaN, { moved: true, isSprinting: true, actualSpeed: NaN }],
    [-0.5, { moved: true, isSprinting: false, actualSpeed: Infinity }],
    [Infinity, null],
  ]

  for (const [dt, motion] of inputs) {
    animator.update(dt, motion)
    assert.equal(player.position.x, 4.25, 'root.position.x unchanged')
    assert.equal(player.position.y, 0, 'root.position.y unchanged')
    assert.equal(player.position.z, -7.5, 'root.position.z unchanged')
    assert.equal(player.rotation.x, 0.02, 'root.rotation.x unchanged')
    assert.equal(player.rotation.y, 1.15, 'root.rotation.y unchanged')
    assert.equal(player.rotation.z, -0.01, 'root.rotation.z unchanged')
    assertAllRigTransformsFinite(player.userData.rig, 'robustness')
  }

  // Legacy / partial rig missing pelvisPivot, neckPivot, elbows, wrists, knees, ankles
  const legacyGroup = new THREE.Group()
  const upperBodyPivot = new THREE.Group()
  const headPivot = new THREE.Group()
  const leftLegPivot = new THREE.Group()
  const rightLegPivot = new THREE.Group()
  const leftArmPivot = new THREE.Group()
  const rightArmPivot = new THREE.Group()
  legacyGroup.userData.rig = {
    upperBodyPivot,
    headPivot,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    restPose: { upperBodyY: 0.86, leftLegY: 0.86, rightLegY: 0.86 },
  }

  animator.setPlayerGroup(legacyGroup)
  for (let i = 0; i < 15; i += 1) {
    animator.update(0.016, { moved: true, isSprinting: false, actualSpeed: 5.5 })
  }
  assert.ok(Number.isFinite(leftLegPivot.rotation.x) && Math.abs(leftLegPivot.rotation.x) > 0.01)
  assert.ok(Number.isFinite(upperBodyPivot.position.y) && upperBodyPivot.position.y >= 0.86)
  animator.reset()
  assert.equal(upperBodyPivot.position.y, 0.86)
  assert.equal(leftLegPivot.rotation.x, 0)

  // Partial 16-pivot rig missing optional neckPivot, wrists, and rightAnklePivot, plus empty rig
  const partialGroup = new THREE.Group()
  partialGroup.userData.rig = {
    pelvisPivot: new THREE.Group(),
    spinePivot: new THREE.Group(),
    leftHipPivot: new THREE.Group(),
    leftKneePivot: new THREE.Group(),
    rightHipPivot: new THREE.Group(),
  }
  animator.setPlayerGroup(partialGroup)
  for (let i = 0; i < 10; i += 1) {
    animator.update(0.016, { moved: true, isSprinting: true, actualSpeed: 9.0 })
  }
  assertAllRigTransformsFinite(partialGroup.userData.rig, 'partialRig')

  const emptyRigGroup = new THREE.Group()
  emptyRigGroup.userData.rig = {}
  animator.setPlayerGroup(emptyRigGroup)
  animator.update(0.016, { moved: true, isSprinting: false, actualSpeed: 5.5 })
  animator.reset()

  animator.dispose()
  disposePlayer(player)
  disposeAllSharedPools()
  console.log('✓ Root invariance, partial/legacy rig fallback & invalid input guards verified')
}

// ---------------------------------------------------------------------------
// 6. Character Follow & Free Look Integration via MazeSceneEngine
// ---------------------------------------------------------------------------
{
  console.log('Test 6: Character Follow & Free Look camera mode compatibility in MazeSceneEngine')
  disposeAllSharedPools()

  const openMaze = {
    width: 11,
    height: 11,
    start: { row: 5, col: 5 },
    exit: { row: 9, col: 9 },
    grid: Array.from({ length: 11 }, (_, r) =>
      Array.from({ length: 11 }, (_, c) =>
        r === 0 || r === 10 || c === 0 || c === 10 ? 1 : 0
      )
    ),
  }

  const engine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
    enemies: { autoSpawn: false },
    audio: { enabled: false },
  })
  engine.setMaze(openMaze)
  engine.clearHazards()

  const center = gridToWorld(5, 5, openMaze)
  engine.setPlayerWorldPosition(center.x, 0, center.z, {
    yaw: 0,
    pitch: 0,
    immediate: true,
  })

  const player = engine.getPlayer()
  const rig = player.userData.rig

  // Character Follow walk + look
  engine.applyLookDelta(120, 0, { sensitivity: 0.0022 })
  const expectedFollowYaw = engine.cameraRig.getLookDirection().yaw
  for (let i = 0; i < 15; i += 1) {
    engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.016)
  }
  assert.equal(engine.getPlayerAnimationState().state, 'walk')
  assert.ok(Math.abs(player.rotation.y - expectedFollowYaw) < 1e-5, 'Character Follow yaw preserved')
  assert.ok(Math.abs(rig.leftKneePivot.rotation.x) > 0.01, '16-pivot knee animates in Character Follow')
  assert.ok(Math.abs(rig.leftElbowPivot.rotation.x) > 0.1, '16-pivot elbow animates in Character Follow')

  // Switch seamlessly to Free Look, orbit camera 180°, sprint toward camera
  engine.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK, { immediate: true })
  const yawBeforeOrbit = player.rotation.y
  engine.applyLookDelta(-Math.PI / 0.01, 0, { sensitivity: 0.01 })
  assert.ok(Math.abs(player.rotation.y - yawBeforeOrbit) < 1e-5, 'Free Look orbit leaves player yaw untouched')

  for (let i = 0; i < 20; i += 1) {
    engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: true }, 0.016)
  }
  assert.equal(engine.getPlayerAnimationState().state, 'sprint')
  assert.ok(rig.leftElbowPivot.rotation.x > 0.8, '16-pivot sprint elbow drive active in Free Look')
  assertAllRigTransformsFinite(rig, 'freeLookSprint')

  engine.dispose()
  disposeAllSharedPools()
  console.log('✓ Character Follow & Free Look integration verified')
}

// ---------------------------------------------------------------------------
// 7. Zero Per-Frame Allocations by Design
// ---------------------------------------------------------------------------
{
  console.log('Test 7: Zero per-frame allocations inside PlayerAnimator.update()')
  const updateSrc = PlayerAnimator.prototype.update.toString()
  assert.equal(/\bnew\s+[A-Z]/.test(updateSrc), false, 'update() never instantiates objects via new')
  assert.equal(/\.map\s*\(|\.filter\s*\(|\.slice\s*\(/.test(updateSrc), false, 'update() avoids allocating array methods')
  assert.equal(/Object\.assign|Object\.keys|Object\.values/.test(updateSrc), false, 'update() avoids Object helper allocations')
  console.log('✓ Zero per-frame allocation design verified')
}

console.log('=== ALL PHASE 3 PLAYER ANIMATOR TESTS PASSED! ===')
