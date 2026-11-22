import assert from 'node:assert/strict'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { createInitialGameState } from '../engine/gameReducer.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  ELEVATOR_DECK_TOP_Y,
  ELEVATOR_OUTER_BOUND,
  getElevatorFloorHeightAtWorld,
} from './buildElevators.js'
import { CAMERA_MODES, THIRD_PERSON_CAMERA_MODES } from './CameraRig.js'
import {
  DEFAULT_SPAWN_SEQUENCE_CONFIG,
  ElevatorExitSequence,
  SPAWN_SEQUENCE_STAGES,
  resolveElevatorExitTrajectory,
} from './ElevatorExitSequence.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools, getActiveSharedPoolOwnerCount } from './sharedResources.js'

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

function createMockRenderer() {
  return {
    domElement: { style: {} },
    capabilities: { getMaxAnisotropy: () => 8 },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: null, needsUpdate: false },
    pixelRatio: 1,
    setPixelRatio(r) {
      this.pixelRatio = r
    },
    setSize() {},
    render() {},
    dispose() {},
    getContext() {
      return null
    },
  }
}

function createHeadlessEngine(options = {}) {
  const canvasHost = {
    appendChild() {},
    removeChild() {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  return new MazeSceneEngine(canvasHost, {
    createRenderer: () => createMockRenderer(),
    isSoftwareGl: false,
    lowPerformance: false,
    enemies: { autoSpawn: false },
    ...options,
  })
}

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

console.log('--- RUNNING PHASE 2 ELEVATOR EXIT SPAWN ANIMATION TESTS ---')
disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Trajectory Resolution & Stage Progression Unit Verification
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Trajectory resolution across difficulties & braided layouts')
  for (const difficulty of ['easy', 'medium', 'hard', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 4242 })
    const trajectory = resolveElevatorExitTrajectory(maze)
    assert.ok(trajectory, `${difficulty}: trajectory resolved`)
    assert.equal(trajectory.hasOpenExit, true, `${difficulty}: start has open exit`)
    assert.ok(
      Math.abs(trajectory.startY - ELEVATOR_DECK_TOP_Y) < 1e-5,
      `${difficulty}: trajectory starts at deck height ${ELEVATOR_DECK_TOP_Y}`
    )
    assert.ok(
      trajectory.exitDistance >= ELEVATOR_OUTER_BOUND,
      `${difficulty}: exit target clears outer ramp bound (${trajectory.exitDistance} >= ${ELEVATOR_OUTER_BOUND})`
    )
    assert.ok(
      Math.abs(trajectory.endY) < 1e-5,
      `${difficulty}: exit target lands flush on corridor floor y=0 (got ${trajectory.endY})`
    )
  }

  // Closed-start fallback must remain safely on deck without walking through walls
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  const isolatedMaze = {
    id: 'isolated-start',
    rows: 3,
    cols: 3,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 1 },
    grid: [
      [W, W, W],
      [W, P, W],
      [W, W, W],
    ],
  }
  const isolatedTraj = resolveElevatorExitTrajectory(isolatedMaze)
  assert.equal(isolatedTraj.hasOpenExit, false, 'Isolated start detects no open exit')
  assert.equal(isolatedTraj.exitDistance, 0, 'Isolated start keeps exitDistance = 0')

  const seq = new ElevatorExitSequence()
  const maze = generateMaze({ difficulty: 'medium', seed: 1999 })
  assert.equal(seq.start(maze), true)
  assert.equal(seq.isActive(), true)

  const seenStages = []
  let prevStage = null
  let maxElevatorY = -Infinity
  let impactCount = 0
  for (let i = 0; i < 200; i += 1) {
    const step = seq.update(1 / 30)
    if (step.stage !== prevStage) {
      seenStages.push(step.stage)
      prevStage = step.stage
    }
    if (step.elevatorY > maxElevatorY) maxElevatorY = step.elevatorY
    if (step.impactTriggered) impactCount += 1
    if (step.completed) break
  }

  const expectedStageOrder = [
    SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND,
    SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT,
    SPAWN_SEQUENCE_STAGES.ELEVATOR_SETTLE,
    SPAWN_SEQUENCE_STAGES.IDLE_RECOVER,
    SPAWN_SEQUENCE_STAGES.TURN_TO_EXIT,
    SPAWN_SEQUENCE_STAGES.WALK_OFF,
    SPAWN_SEQUENCE_STAGES.SETTLE,
    SPAWN_SEQUENCE_STAGES.COMPLETED,
  ]
  for (const expectedStage of expectedStageOrder) {
    assert.ok(
      seenStages.includes(expectedStage),
      `Sequence visits required stage "${expectedStage}"`
    )
  }
  assert.deepEqual(seenStages, expectedStageOrder, 'Starting arrival and Phase 2 exit execute in strict stage order')
  assert.ok(maxElevatorY > 8.0, `Starting elevator starts elevated inside shaft (maxY=${maxElevatorY.toFixed(2)})`)
  assert.equal(impactCount, 1, 'Landing impact triggers exactly once')
  assert.equal(seq.isActive(), false, 'Sequence stops active flag cleanly upon completion')
  seq.dispose()
  console.log('✓ Trajectory resolution & arrival -> exit stage progression verified')
}

// ---------------------------------------------------------------------------
// 2. Starting Elevator Physical Descent, Impact Effects, 16-Pivot Exit & Zero-Snap Handoff
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Starting elevator shaft descent, impact thud/dust/shake, 16-pivot exit & handoff')
  for (const difficulty of ['easy', 'medium', 'hard', 'hardcore']) {
    const gameState = createInitialGameState(difficulty, 2027)
    const engine = createHeadlessEngine({
      cameraMode: CAMERA_MODES.THIRD_PERSON,
      thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
      audio: { autoUnlock: false, recordCueHistory: true },
    })

    let heldInput = { forwardAxis: 1, strafeAxis: 0, sprint: false }
    engine.setInputSource(() => heldInput)
    engine.setMaze(gameState.maze)

    assert.equal(
      engine.isSpawnSequenceActive(),
      true,
      `${difficulty}: spawn sequence starts automatically on setMaze`
    )

    const startWorld = gridToWorld(
      gameState.maze.start.row,
      gameState.maze.start.col,
      gameState.maze
    )
    const startElevator = engine.getMazeGroup()?.userData?.startElevator
    assert.ok(startElevator?.userData?.cabinGroup, `${difficulty}: start elevator cabinGroup present`)
    const initialCabinY = startElevator.userData.cabinGroup.position.y
    assert.ok(
      initialCabinY >= 8.35,
      `${difficulty}: starting elevator begins elevated inside shaft (cabinY=${initialCabinY.toFixed(3)})`
    )
    const initialCableScale = startElevator.userData.tensionCables[0].scale.y

    const initialPos = engine.getPlayerWorldPosition()
    assert.ok(
      Math.hypot(initialPos.x - startWorld.x, initialPos.z - startWorld.z) < 1e-5 &&
        Math.abs(initialPos.y - (ELEVATOR_DECK_TOP_Y + initialCabinY)) < 1e-3,
      `${difficulty}: player spawns standing inside elevated cabin deck (y=${initialPos.y.toFixed(3)})`
    )

    // Verify initial camera yaw matches corridor exit orientation immediately on spawn
    assert.ok(
      Math.abs(engine.cameraRig.getLookDirection().yaw - engine._currentInitialYaw) < 1e-5,
      `${difficulty}: camera initially looks cleanly toward open elevator exit`
    )

    const player = engine.getPlayer()
    const rig = player.userData.rig
    const seenStages = new Set()
    let prevCabinY = initialCabinY
    let prevCableScale = initialCableScale
    let sawCableElongate = false
    let sawSheaveSpin = false
    let sawImpactShakeAndDust = false
    let sawSettleAtGround = false
    let minHeadYaw = Infinity
    let maxHeadYaw = -Infinity
    let minSpineRotX = Infinity
    let maxSpineRotX = -Infinity
    let minArmSwing = Infinity
    let maxArmSwing = -Infinity
    let minHipSwing = Infinity
    let maxHipSwing = -Infinity
    let sawRampFloorTransition = false
    let maxPosJumpPerFrame = 0

    let prevPos = engine.getPlayerWorldPosition()
    const dt = 1 / 60

    // Step until full arrival + exit spawn sequence finishes (~4.19s -> 360 frames max)
    for (let f = 0; f < 360; f += 1) {
      engine.stepFrame(dt)
      const seqState = engine.getSpawnSequenceState()
      seenStages.add(seqState.stage)
      assertAllRigTransformsFinite(rig, `${difficulty}.frame[${f}]`)

      // Knees must never hyperextend positive
      assert.ok(
        rig.leftKneePivot.rotation.x <= 1e-4 && rig.rightKneePivot.rotation.x <= 1e-4,
        `${difficulty}: knees never hyperextend (${rig.leftKneePivot.rotation.x}, ${rig.rightKneePivot.rotation.x})`
      )

      const curPos = engine.getPlayerWorldPosition()
      const cabinY = startElevator.userData.cabinGroup.position.y
      const cableScale = startElevator.userData.tensionCables[0].scale.y

      if (seqState.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND) {
        assert.ok(
          cabinY <= prevCabinY + 0.012,
          `${difficulty}: cabin descends smoothly inside shaft (${prevCabinY.toFixed(3)} -> ${cabinY.toFixed(3)})`
        )
        prevCabinY = cabinY
        if (cableScale > prevCableScale + 0.05) {
          sawCableElongate = true
        }
        prevCableScale = cableScale
        if (Math.abs(startElevator.userData.sheaveWheel.rotation.x) > 0.2) {
          sawSheaveSpin = true
        }
        assert.ok(
          Math.abs(curPos.y - (ELEVATOR_DECK_TOP_Y + cabinY)) < 0.025,
          `${difficulty}: player rides descending elevator deck synchronously`
        )
      }

      if (seqState.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT) {
        if (
          startElevator.userData.dustPoints.visible &&
          engine.cameraShakeIntensity > 0.05
        ) {
          sawImpactShakeAndDust = true
        }
      }

      if (seqState.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_SETTLE) {
        assert.ok(Math.abs(cabinY) < 1e-4, `${difficulty}: elevator seated firmly on platform during settle`)
        sawSettleAtGround = true
      }

      const frameDist = Math.hypot(curPos.x - prevPos.x, curPos.z - prevPos.z)
      maxPosJumpPerFrame = Math.max(maxPosJumpPerFrame, frameDist)
      prevPos = curPos

      // Held forward input must NOT break player loose onto sprint/free walk before WALK_OFF
      if (
        seqState.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND ||
        seqState.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT ||
        seqState.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_SETTLE ||
        seqState.stage === SPAWN_SEQUENCE_STAGES.IDLE_RECOVER ||
        seqState.stage === SPAWN_SEQUENCE_STAGES.TURN_TO_EXIT
      ) {
        assert.ok(
          Math.hypot(curPos.x - startWorld.x, curPos.z - startWorld.z) < 1e-5,
          `${difficulty}: player remains planted on deck during ${seqState.stage} even with held input`
        )
      }

      const localFloorY =
        getElevatorFloorHeightAtWorld(curPos.x, curPos.z, gameState.maze) + cabinY
      if (
        seqState.stage === SPAWN_SEQUENCE_STAGES.WALK_OFF &&
        localFloorY > 0.002 &&
        localFloorY < ELEVATOR_DECK_TOP_Y - 0.002
      ) {
        sawRampFloorTransition = true
      }

      const bootMinY = measureBootsWorldMinY(player)
      const clearance = bootMinY - localFloorY
      assert.ok(
        clearance >= -0.03,
        `${difficulty}: boots do not sink below local deck (${bootMinY.toFixed(4)} vs ${localFloorY.toFixed(4)})`
      )
      assert.ok(
        clearance <= 0.1,
        `${difficulty}: boots do not float excessively above local deck (${bootMinY.toFixed(4)} vs ${localFloorY.toFixed(4)})`
      )

      minHeadYaw = Math.min(minHeadYaw, rig.headPivot.rotation.y)
      maxHeadYaw = Math.max(maxHeadYaw, rig.headPivot.rotation.y)
      minSpineRotX = Math.min(minSpineRotX, rig.spinePivot.rotation.x)
      maxSpineRotX = Math.max(maxSpineRotX, rig.spinePivot.rotation.x)
      minArmSwing = Math.min(minArmSwing, rig.leftShoulderPivot.rotation.x)
      maxArmSwing = Math.max(maxArmSwing, rig.leftShoulderPivot.rotation.x)
      minHipSwing = Math.min(minHipSwing, rig.leftHipPivot.rotation.x)
      maxHipSwing = Math.max(maxHipSwing, rig.leftHipPivot.rotation.x)

      if (!engine.isSpawnSequenceActive()) break
    }

    assert.equal(engine.isSpawnSequenceActive(), false, `${difficulty}: arrival + exit finished within expected duration`)
    assert.ok(Math.abs(startElevator.userData.cabinGroup.position.y) < 1e-5, `${difficulty}: elevator rests at ground level after landing`)
    assert.ok(sawCableElongate, `${difficulty}: hoist tension cables elongate cleanly during descent`)
    assert.ok(sawSheaveSpin, `${difficulty}: overhead sheave wheel rotates during descent`)
    assert.ok(sawImpactShakeAndDust, `${difficulty}: impact triggers camera shake and landing dust burst`)
    assert.ok(sawSettleAtGround, `${difficulty}: settling pause precedes character exit`)
    assert.ok(sawRampFloorTransition, `${difficulty}: traversed downward ramp slope smoothly after landing`)
    assert.ok(maxPosJumpPerFrame < 0.08, `${difficulty}: smooth per-frame displacement (${maxPosJumpPerFrame.toFixed(4)}m)`)
    assert.ok(maxHeadYaw - minHeadYaw > 0.08, `${difficulty}: head turns naturally toward exit`)
    assert.ok(maxSpineRotX - minSpineRotX > 0.04, `${difficulty}: spine articulates recovery & gait lean`)
    assert.ok(maxArmSwing - minArmSwing > 0.25, `${difficulty}: arms swing organically`)
    assert.ok(maxHipSwing - minHipSwing > 0.35, `${difficulty}: legs stride naturally down ramp`)

    const cueTypes = engine.audioEngine.getCueHistory().map((c) => c.type)
    assert.equal(
      cueTypes.filter((t) => t === 'start_elevator_descent').length,
      1,
      `${difficulty}: start_elevator_descent audio cue fires once`
    )
    assert.equal(
      cueTypes.filter((t) => t === 'start_elevator_impact').length,
      1,
      `${difficulty}: start_elevator_impact audio cue fires once`
    )

    // Verify landing dust dissipates cleanly
    for (let d = 0; d < 70; d += 1) {
      engine.stepFrame(dt)
    }
    assert.equal(
      startElevator.userData.dustPoints.visible,
      false,
      `${difficulty}: landing dust fades out and hides cleanly`
    )

    const handoffPos = engine.getPlayerWorldPosition()
    const handoffDistFromStart = Math.hypot(
      handoffPos.x - startWorld.x,
      handoffPos.z - startWorld.z
    )
    assert.ok(
      handoffDistFromStart >= ELEVATOR_OUTER_BOUND && Math.abs(handoffPos.y) < 1e-5,
      `${difficulty}: character finished stepped off onto flat maze floor (dist=${handoffDistFromStart.toFixed(3)}m, y=${handoffPos.y})`
    )

    // Verify seamless handoff: first frame of normal player control has zero snap in pos, yaw, or camera
    const preCamPos = engine.camera.position.clone()
    const prePlayerYaw = player.rotation.y
    const preCamYaw = engine.cameraRig.getLookDirection().yaw
    assert.ok(
      Math.abs(prePlayerYaw - preCamYaw) < 1e-5,
      `${difficulty}: character & camera yaw aligned at handoff`
    )

    engine.stepFrame(dt)
    const postHandoffPos = engine.getPlayerWorldPosition()
    const firstControlStep = Math.hypot(
      postHandoffPos.x - handoffPos.x,
      postHandoffPos.z - handoffPos.z
    )
    assert.ok(
      firstControlStep > 0.02 && firstControlStep < 0.15,
      `${difficulty}: held movement resumes immediately & smoothly after handoff (step=${firstControlStep.toFixed(4)}m)`
    )
    assert.ok(
      engine.camera.position.distanceTo(preCamPos) < 0.2,
      `${difficulty}: zero camera snap on control handoff`
    )

    engine.dispose()
  }
  disposeAllSharedPools()
  console.log('✓ Starting arrival descent, impact effects, 16-pivot exit & zero-snap handoff verified across difficulties')
}

// ---------------------------------------------------------------------------
// 3. First-Person, Free-Look, Live Camera Controls, Mid-Descent Toggles & N/S/E/W Orientations
// ---------------------------------------------------------------------------
{
  console.log('Test 3: First-person, 3P shaft containment, live mode toggles & N/S/E/W orientations')
  const maze = generateMaze({ difficulty: 'medium', seed: 8080 })
  const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)

  // 3a. First-person mode: player group hidden, descends from shaft height, eye offset active
  const fpEngine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
  })
  fpEngine.setMaze(maze)
  assert.equal(fpEngine.getCameraMode(), CAMERA_MODES.FIRST_PERSON)
  assert.equal(fpEngine.getPlayer().visible, false, 'Player mesh hidden in first-person intro')
  assert.ok(
    fpEngine.camera.position.y > 9.0,
    `1P camera starts inside elevated cabin (y=${fpEngine.camera.position.y.toFixed(2)})`
  )

  const initialYaw = fpEngine.cameraRig.getLookDirection().yaw
  fpEngine.applyLookDelta(120, -40)
  const lookedDir = fpEngine.cameraRig.getLookDirection()
  assert.notEqual(lookedDir.yaw, initialYaw, 'First-person camera look stays responsive during arrival descent')

  let sawEyeDip = false
  for (let i = 0; i < 360; i += 1) {
    fpEngine.stepFrame(1 / 60)
    const st = fpEngine.getSpawnSequenceState()
    if (st.active) {
      const camPos = fpEngine.camera.position
      const pos = fpEngine.getPlayerWorldPosition()
      if (camPos.y < pos.y + fpEngine.cameraRig.config.eyeHeight - 0.005) {
        sawEyeDip = true
      }
    }
    if (!fpEngine.isSpawnSequenceActive()) break
  }
  assert.ok(sawEyeDip, 'First-person camera expresses grounded landing/recovery eye cadence')
  assert.equal(
    fpEngine.getCameraMode(),
    CAMERA_MODES.FIRST_PERSON,
    'Spawn sequence does not force camera mode change'
  )

  // Mid-descent toggle from FP -> TP -> FP seamlessly reveals/hides animated rig without breaking shaft containment
  fpEngine.restartSpawnSequence()
  fpEngine.stepFrame(0.6)
  assert.equal(fpEngine.isSpawnSequenceActive(), true)
  assert.equal(fpEngine.getSpawnSequenceState().stage, SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND)
  fpEngine.toggleCameraMode()
  fpEngine.stepFrame(0.016)
  assert.equal(fpEngine.getCameraMode(), CAMERA_MODES.THIRD_PERSON)
  assert.equal(fpEngine.getPlayer().visible, true, 'Toggling to 3rd person mid-descent immediately shows animated rig')
  const midCamDist = Math.hypot(
    fpEngine.camera.position.x - startWorld.x,
    fpEngine.camera.position.z - startWorld.z
  )
  assert.ok(midCamDist <= 1.54, `3P camera stays within shaft bounds during descent (r=${midCamDist.toFixed(3)})`)
  fpEngine.stepFrame(0.3)
  fpEngine.toggleCameraMode()
  assert.equal(fpEngine.getCameraMode(), CAMERA_MODES.FIRST_PERSON)
  assert.equal(fpEngine.getPlayer().visible, false, 'Toggling back to 1st person hides rig cleanly')
  fpEngine.dispose()

  // 3b. Third-Person Free Look: independent orbit remains under user control inside shaft & on exit
  const flEngine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
  })
  flEngine.setMaze(maze)
  assert.equal(flEngine.isSpawnSequenceActive(), true)

  const preOrbit = flEngine.cameraRig.getCameraLookDirection()
  flEngine.applyLookDelta(180, -30)
  const postOrbit = flEngine.cameraRig.getCameraLookDirection()
  assert.notEqual(postOrbit.yaw, preOrbit.yaw, 'Free-look orbit remains responsive during arrival & exit')

  for (let i = 0; i < 360; i += 1) {
    flEngine.stepFrame(1 / 60)
    const curState = flEngine.getSpawnSequenceState()
    if (curState.elevatorY > 2.15) {
      const r = Math.hypot(
        flEngine.camera.position.x - startWorld.x,
        flEngine.camera.position.z - startWorld.z
      )
      assert.ok(r <= 1.54, `Free-look camera stays inside concrete shaft walls while descending (r=${r.toFixed(3)})`)
    }
    if (!flEngine.isSpawnSequenceActive()) break
  }
  assert.equal(flEngine.isSpawnSequenceActive(), false)
  assert.ok(
    Math.abs(flEngine.cameraRig.getCameraLookDirection().yaw - postOrbit.yaw) < 1e-4,
    'Free-look orbit yaw is preserved without snapping on handoff'
  )
  flEngine.dispose()

  // 3c. Verify all 4 cardinal start elevator orientations (N/S/E/W)
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  for (const dir of [
    { name: 'north', dr: -1, dc: 0 },
    { name: 'south', dr: 1, dc: 0 },
    { name: 'east', dr: 0, dc: 1 },
    { name: 'west', dr: 0, dc: -1 },
  ]) {
    const grid = [
      [W, W, W, W, W],
      [W, W, W, W, W],
      [W, W, P, W, W],
      [W, W, W, W, W],
      [W, W, W, W, W],
    ]
    grid[2 + dir.dr][2 + dir.dc] = P
    grid[2 + dir.dr * 2][2 + dir.dc * 2] = P
    const dirMaze = {
      id: `dir-start-${dir.name}`,
      difficulty: 'easy',
      rows: 5,
      cols: 5,
      start: { row: 2, col: 2 },
      exit: { row: 2 + dir.dr * 2, col: 2 + dir.dc * 2 },
      grid,
      keycards: [],
      collectibles: { coins: [], powerUps: [] },
    }
    const dirEngine = createHeadlessEngine()
    dirEngine.setMaze(dirMaze)
    for (let f = 0; f < 360; f += 1) {
      dirEngine.stepFrame(1 / 60)
      if (!dirEngine.isSpawnSequenceActive()) break
    }
    assert.equal(dirEngine.isSpawnSequenceActive(), false, `${dir.name}: orientation finishes arrival + exit`)
    const dirWorldStart = gridToWorld(2, 2, dirMaze)
    const dirEndPos = dirEngine.getPlayerWorldPosition()
    const alongExit =
      (dirEndPos.x - dirWorldStart.x) * dir.dc +
      (dirEndPos.z - dirWorldStart.z) * dir.dr
    assert.ok(
      alongExit >= ELEVATOR_OUTER_BOUND && Math.abs(dirEndPos.y) < 1e-4,
      `${dir.name}: player exits ramp onto floor along exit corridor (dist=${alongExit.toFixed(3)}, y=${dirEndPos.y.toFixed(4)})`
    )
    dirEngine.stepMovement({ forwardAxis: 1 }, 0.12)
    const endCell = dirEngine.getPlayerGridCell()
    assert.deepEqual(
      endCell,
      { row: 2 + dir.dr, col: 2 + dir.dc },
      `${dir.name}: player steps cleanly into open neighbor corridor after handoff`
    )
    dirEngine.dispose()
  }

  disposeAllSharedPools()
  console.log('✓ First-person cadence, 3P shaft containment, live toggles & N/S/E/W orientations verified')
}

// ---------------------------------------------------------------------------
// 4. Vulnerability, Enemy, Hazard, Director, Pause/Cancel & Reduced Motion Safeguards
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Invulnerability, enemy/hazard/director suppression, pause, cancel & resets')
  const maze = generateMaze({ difficulty: 'hard', seed: 9191 })
  const engine = createHeadlessEngine({
    enemies: { autoSpawn: false },
  })

  let notifications = []
  engine.setOnSpawnSequenceChange((active, state) => {
    notifications.push({ active, stage: state?.stage || null })
  })
  engine.setMaze(maze)
  assert.equal(engine.isSpawnSequenceActive(), true)
  assert.equal(notifications.at(-1)?.active, true, 'Notified listener when spawn sequence started')
  assert.equal(
    engine.getSpawnSequenceState().stage,
    SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND,
    'Spawn starts in ELEVATOR_DESCEND stage'
  )

  const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)
  const killer = engine.spawnEnemy({
    type: 'revenant',
    row: maze.start.row,
    col: maze.start.col,
    speed: 5.0,
    sightRange: 25,
    attackRange: 3.0,
    attackDamage: 50,
  })
  assert.ok(killer, 'Hostile enemy spawned for protection test')

  engine.hazardManager?.addHazard?.({
    id: 'spawn-test-spike',
    type: 'floor_spikes',
    row: maze.start.row,
    col: maze.start.col,
    initialTimer: 0,
  })

  assert.equal(
    engine.interact().handled,
    false,
    'Interact blocked cleanly while intro sequence plays'
  )

  const preDirectorState = engine.getHorrorState()
  for (let i = 0; i < 40; i += 1) {
    engine.stepFrame(1 / 60)
    assert.notEqual(
      killer.getState(),
      'chase',
      'Enemy cannot detect/chase player during active spawn sequence'
    )
    assert.notEqual(
      killer.getState(),
      'attack',
      'Enemy cannot attack player during active spawn sequence'
    )
  }
  const midDirectorState = engine.getHorrorState()
  assert.equal(
    engine.getHealth().health,
    100,
    'Neither enemy nor hazard can injure player during spawn sequence'
  )
  assert.equal(
    midDirectorState.elapsedTime,
    preDirectorState.elapsedTime,
    'HorrorDirector elapsed timer stays paused during arrival + intro sequence'
  )

  // Pause & resume mid-descent preserves exact progress and cabin position
  const startElev = engine.getMazeGroup().userData.startElevator
  const pausedProgress = engine.getSpawnSequenceState().progress
  const pausedCabinY = startElev.userData.cabinGroup.position.y
  engine.setPaused(true)
  engine.stepFrame(0.5)
  assert.equal(
    engine.getSpawnSequenceState().progress,
    pausedProgress,
    'Paused engine freezes spawn descent sequence cleanly'
  )
  assert.equal(
    startElev.userData.cabinGroup.position.y,
    pausedCabinY,
    'Paused engine freezes elevator 3D cabin position cleanly'
  )
  engine.setPaused(false)

  // Finish full arrival + exit sequence (~4.19s total)
  for (let i = 0; i < 360; i += 1) {
    engine.stepFrame(1 / 60)
    if (!engine.isSpawnSequenceActive()) break
  }
  assert.equal(engine.isSpawnSequenceActive(), false)
  assert.equal(engine.getHealth().health, 100, 'Player emerges from spawn sequence at full health')
  assert.equal(notifications.at(-1)?.active, false, 'Notified listener when spawn sequence completed')

  // After completion, damage works again and HorrorDirector resumes ticking
  engine.stepFrame(0.1)
  assert.ok(
    engine.getHorrorState().elapsedTime > preDirectorState.elapsedTime,
    'HorrorDirector resumes once spawn sequence completes'
  )
  assert.equal(
    engine.applyDamage(20, { enemyId: killer.id }),
    true,
    'Player vulnerability restores cleanly upon sequence completion'
  )

  // RESET_RUN simulation via resetCombat({ preserveSpawnSequence: true, restartSpawnSequence: true })
  notifications = []
  engine.resetCombat({ preserveSpawnSequence: true, restartSpawnSequence: true })
  assert.equal(engine.isSpawnSequenceActive(), true, 'Restart run re-arms arrival + spawn sequence')
  assert.equal(engine.getHealth().health, 100, 'Restart run restores health cleanly')
  assert.ok(
    Math.hypot(
      engine.getPlayerWorldPosition().x - startWorld.x,
      engine.getPlayerWorldPosition().z - startWorld.z
    ) < 1e-5 &&
      engine.getPlayerWorldPosition().y > 8.0 &&
      startElev.userData.cabinGroup.position.y > 8.0,
    'Restart run re-positions elevator and player back at upper shaft arrival elevation'
  )

  // Mid-descent cancellation cleanly grounds both elevator cabin and player
  engine.stepFrame(0.3)
  assert.equal(engine.cancelSpawnSequence(), true, 'cancelSpawnSequence returns true when active')
  assert.equal(engine.isSpawnSequenceActive(), false)
  assert.equal(startElev.userData.cabinGroup.position.y, 0, 'Cancelled arrival resets cabin to platform ground')
  assert.ok(Math.abs(engine.getPlayerWorldPosition().y - ELEVATOR_DECK_TOP_Y) < 1e-5, 'Cancelled arrival grounds player onto deck')

  // Difficulty / New Maze reset re-arms arrival sequence cleanly
  const hardMaze = generateMaze({ difficulty: 'hardcore', seed: 3030 })
  engine.setMaze(hardMaze)
  assert.equal(engine.isSpawnSequenceActive(), true, 'Changing difficulty/maze starts fresh arrival sequence')
  assert.ok(
    engine.getPlayerWorldPosition().y > 8.0,
    'New maze places player inside elevated starting elevator in new shaft'
  )

  // Reduced motion preference suppresses shake, vibration & dust without breaking arrival/exit completion
  engine.updateHorrorConfig({ reducedMotion: true })
  engine.updateCameraConfig({ cameraShake: false })
  const hardElev = engine.getMazeGroup().userData.startElevator
  for (let i = 0; i < 360; i += 1) {
    engine.stepFrame(1 / 60)
    const st = engine.getSpawnSequenceState()
    assert.equal(st.vibrationY, 0, 'reducedMotion suppresses elevator vibration')
    assert.equal(engine.cameraShakeIntensity, 0, 'reducedMotion + cameraShake off keeps shake at 0')
    assert.equal(hardElev.userData.dustPoints.visible, false, 'reducedMotion skips dust burst')
    if (!engine.isSpawnSequenceActive()) break
  }
  assert.equal(engine.isSpawnSequenceActive(), false, 'Reduced motion finishes arrival + exit smoothly')
  assert.equal(hardElev.userData.cabinGroup.position.y, 0, 'Reduced motion still lands elevator flush at ground')

  assert.ok(DEFAULT_SPAWN_SEQUENCE_CONFIG.enabled)
  engine.dispose()
  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Zero lingering shared pools after dispose')
  console.log('✓ Vulnerability safeguards, director/enemy suppression, pause/cancel, reducedMotion & resets verified')
}

// ---------------------------------------------------------------------------
// 5. Coherent Moving Car Gate, Continuous Landing Cables & High Contrast Outline
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Coherent start cabin components, continuous cables on landing & moving cabin outline')
  const maze = generateMaze({ difficulty: 'medium', seed: 7744 })
  const engine = createHeadlessEngine({
    graphics: { highContrast: true },
  })
  engine.setMaze(maze)

  const startElev = engine.getMazeGroup().userData.startElevator
  const cabinGroup = startElev.userData.cabinGroup
  assert.ok(
    cabinGroup.getObjectByName('start-elevator-car-gate-left')?.isMesh &&
      cabinGroup.getObjectByName('start-elevator-car-gate-right')?.isMesh,
    'Start cabin includes inner car gate stiles that descend coherently with cabinGroup'
  )
  assert.ok(
    cabinGroup.userData.highContrastOutline?.visible &&
      cabinGroup.userData.highContrastOutline?.parent === cabinGroup,
    'High-contrast cabin outline attaches directly to moving cabinGroup'
  )

  let impactCableLen = 0
  let settleCableLen = 0
  for (let i = 0; i < 240; i += 1) {
    engine.stepFrame(1 / 60)
    const st = engine.getSpawnSequenceState()
    if (st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT) {
      impactCableLen = startElev.userData.tensionCables[0].scale.y
    } else if (st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_SETTLE) {
      settleCableLen = startElev.userData.tensionCables[0].scale.y
      break
    }
  }
  assert.ok(
    impactCableLen >= 12.0 && settleCableLen >= 12.0,
    `Hoist tension cables remain continuously connected through impact & settle (impact=${impactCableLen.toFixed(2)}m, settle=${settleCableLen.toFixed(2)}m)`
  )

  engine.dispose()
  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Zero lingering shared pools after coherent assembly test')
  console.log('✓ Coherent start car gate, continuous landing cables & moving cabin outline verified')
}

// ---------------------------------------------------------------------------
// 6. Procedural Player Impact & Balance-Recovery Reaction (16-Pivot, Camera, Reset)
// ---------------------------------------------------------------------------
{
  console.log('Test 6: Procedural player landing impact, balance recovery, 1P/3P camera & zero residual pose')
  const maze = generateMaze({ difficulty: 'medium', seed: 5150 })

  // 6a. Third-person impact kinematics: reaction begins strictly at impact, articulates all 16 pivots, and completes before exit walk
  const tpEngine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
  })
  tpEngine.setMaze(maze)
  const tpPlayer = tpEngine.getPlayer()
  const tpRig = tpPlayer.userData.rig

  let descentMaxJolt = 0
  let descentMaxBal = 0
  let impactStartJolt = 0
  let minSpinePitch = Infinity
  let maxKneeFlexLeft = 0
  let maxKneeFlexRight = 0
  let maxShoulderAbductLeft = 0
  let maxShoulderAbductRight = 0
  let maxHipDiff = 0
  let maxPelvisRoll = 0
  let settleIdleJoltMax = 0
  let settleIdleSpineAbsMax = 0
  let sawFirstImpactFrame = false

  for (let i = 0; i < 360; i += 1) {
    tpEngine.stepFrame(1 / 60)
    const st = tpEngine.getSpawnSequenceState()
    if (st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND) {
      descentMaxJolt = Math.max(descentMaxJolt, st.impactJoltEnvelope)
      descentMaxBal = Math.max(descentMaxBal, st.balanceLossEnvelope)
    } else if (
      st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT ||
      st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_SETTLE
    ) {
      if (st.impactTriggered && !sawFirstImpactFrame) {
        sawFirstImpactFrame = true
        impactStartJolt = st.impactJoltEnvelope
      }
      minSpinePitch = Math.min(minSpinePitch, tpRig.spinePivot.rotation.x)
      maxKneeFlexLeft = Math.max(maxKneeFlexLeft, -tpRig.leftKneePivot.rotation.x)
      maxKneeFlexRight = Math.max(maxKneeFlexRight, -tpRig.rightKneePivot.rotation.x)
      maxShoulderAbductLeft = Math.max(
        maxShoulderAbductLeft,
        -tpRig.leftShoulderPivot.rotation.z
      )
      maxShoulderAbductRight = Math.max(
        maxShoulderAbductRight,
        tpRig.rightShoulderPivot.rotation.z
      )
      maxHipDiff = Math.max(
        maxHipDiff,
        Math.abs(tpRig.leftHipPivot.rotation.x - tpRig.rightHipPivot.rotation.x)
      )
      maxPelvisRoll = Math.max(maxPelvisRoll, Math.abs(tpRig.pelvisPivot.rotation.z))
    } else if (st.stage === SPAWN_SEQUENCE_STAGES.IDLE_RECOVER) {
      settleIdleJoltMax = Math.max(
        settleIdleJoltMax,
        st.impactJoltEnvelope,
        st.balanceLossEnvelope,
        st.stepReachEnvelope
      )
      settleIdleSpineAbsMax = Math.max(
        settleIdleSpineAbsMax,
        Math.abs(tpRig.spinePivot.rotation.x)
      )
    }
    if (!tpEngine.isSpawnSequenceActive()) break
  }

  assert.equal(descentMaxJolt, 0, 'Impact jolt envelope stays 0 throughout descent')
  assert.equal(descentMaxBal, 0, 'Balance-loss envelope stays 0 throughout descent')
  assert.equal(sawFirstImpactFrame, true, 'Observed exact elevator impact trigger frame')
  assert.ok(
    impactStartJolt > 0.35,
    `Player impact jolt begins immediately on touchdown frame (jolt=${impactStartJolt.toFixed(3)})`
  )
  assert.ok(
    maxKneeFlexLeft > 0.38 && maxKneeFlexRight > 0.35,
    `Knees bend to absorb landing impact (L=${maxKneeFlexLeft.toFixed(3)}, R=${maxKneeFlexRight.toFixed(3)})`
  )
  assert.ok(
    minSpinePitch < -0.18,
    `Upper body pitches forward on landing impact (spine.x=${minSpinePitch.toFixed(3)})`
  )
  assert.ok(
    maxShoulderAbductLeft > 0.28 && maxShoulderAbductRight > 0.28,
    `Shoulders & arms flare outward instinctively for balance (L=${maxShoulderAbductLeft.toFixed(3)}, R=${maxShoulderAbductRight.toFixed(3)})`
  )
  assert.ok(
    maxHipDiff > 0.25 && maxPelvisRoll > 0.03,
    `Hips & pelvis execute asymmetric weight stagger & corrective step (hipDiff=${maxHipDiff.toFixed(3)}, pelvisRoll=${maxPelvisRoll.toFixed(3)})`
  )
  assert.equal(
    settleIdleJoltMax,
    0,
    'Balance recovery envelopes complete back to 0 during settling pause before exit'
  )
  assert.ok(
    settleIdleSpineAbsMax < 0.04,
    `Torso returns to upright neutral posture before exit walk (maxAbsSpine=${settleIdleSpineAbsMax.toFixed(4)})`
  )

  // Step idle in normal gameplay and confirm zero residual impact pose or camera shake remains
  for (let g = 0; g < 15; g += 1) {
    tpEngine.stepFrame(1 / 60)
  }
  assert.equal(tpEngine.cameraRig.getShakePitch(), 0, 'Zero residual camera shake pitch after sequence')
  assert.equal(tpEngine.cameraRig.getShakeRoll(), 0, 'Zero residual camera shake roll after sequence')
  assert.ok(
    Math.abs(tpRig.spinePivot.rotation.x) < 0.04 &&
      Math.abs(tpRig.leftShoulderPivot.rotation.z) < 0.08 &&
      Math.abs(tpRig.leftKneePivot.rotation.x) < 0.09,
    'No residual impact pose leaks into normal idle gameplay'
  )
  tpEngine.dispose()

  // 6b. First-person synchronized camera jolt + recovery + pause/resume + mid-impact cancel
  const fpEngine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
  })
  fpEngine.setMaze(maze)

  let minShakePitch = Infinity
  let maxAbsShakeRoll = 0
  let pausedAtImpact = false

  for (let i = 0; i < 240; i += 1) {
    fpEngine.stepFrame(1 / 60)
    const st = fpEngine.getSpawnSequenceState()
    if (st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT) {
      minShakePitch = Math.min(minShakePitch, fpEngine.cameraRig.getShakePitch())
      maxAbsShakeRoll = Math.max(maxAbsShakeRoll, Math.abs(fpEngine.cameraRig.getShakeRoll()))
      if (!pausedAtImpact && st.stageProgress > 0.35) {
        pausedAtImpact = true
        const fpRig = fpEngine.getPlayer().userData.rig
        const frozenKnee = fpRig.leftKneePivot.rotation.x
        const frozenShakePitch = fpEngine.cameraRig.getShakePitch()
        fpEngine.setPaused(true)
        fpEngine.stepFrame(0.25)
        assert.equal(
          fpRig.leftKneePivot.rotation.x,
          frozenKnee,
          'Pause mid-impact freezes character reaction pose'
        )
        assert.equal(
          fpEngine.cameraRig.getShakePitch(),
          frozenShakePitch,
          'Pause mid-impact freezes 1P camera jolt offset'
        )
        fpEngine.setPaused(false)
      }
    }
    if (st.stage === SPAWN_SEQUENCE_STAGES.IDLE_RECOVER) break
  }

  assert.ok(
    minShakePitch < -0.025 && maxAbsShakeRoll > 0.005,
    `First-person camera applies directional pitch jolt & subtle tilt during landing impact (pitch=${minShakePitch.toFixed(4)}, roll=${maxAbsShakeRoll.toFixed(4)})`
  )
  assert.equal(
    fpEngine.cameraRig.getShakePitch(),
    0,
    'First-person directional camera jolt recovers cleanly before exit turn'
  )

  // Mid-recovery restart -> run to impact -> cancel must clear pose & camera immediately
  fpEngine.restartSpawnSequence()
  for (let i = 0; i < 110; i += 1) {
    fpEngine.stepFrame(1 / 60)
    if (fpEngine.getSpawnSequenceState().stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT) break
  }
  assert.equal(
    fpEngine.getSpawnSequenceState().stage,
    SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT,
    'Reached mid-impact before cancel check'
  )
  fpEngine.cancelSpawnSequence()
  const fpRigAfterCancel = fpEngine.getPlayer().userData.rig
  assert.equal(fpEngine.cameraRig.getShakePitch(), 0, 'Cancel clears camera shake pitch')
  assert.equal(fpEngine.cameraRig.getShakeRoll(), 0, 'Cancel clears camera shake roll')
  assert.ok(
    Math.abs(fpRigAfterCancel.spinePivot.rotation.x) < 0.04 &&
      Math.abs(fpRigAfterCancel.leftShoulderPivot.rotation.z) < 0.08,
    'Cancel mid-impact immediately restores neutral player posture'
  )

  // 6c. Mid-impact 1P <-> 3P perspective switching & cameraShake=false setting
  fpEngine.restartSpawnSequence()
  let switchedMidImpact = false
  for (let i = 0; i < 130; i += 1) {
    fpEngine.stepFrame(1 / 60)
    const st = fpEngine.getSpawnSequenceState()
    if (!switchedMidImpact && st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT && st.stageProgress > 0.25) {
      switchedMidImpact = true
      assert.ok(fpEngine.cameraRig.getShakePitch() < -0.015, '1P pitch jolt active before mid-impact toggle')
      fpEngine.toggleCameraMode()
      fpEngine.stepFrame(1 / 60)
      const switchedRig = fpEngine.getPlayer().userData.rig
      assert.equal(fpEngine.getCameraMode(), CAMERA_MODES.THIRD_PERSON)
      assert.equal(fpEngine.getPlayer().visible, true, 'Switching 1P->3P mid-impact immediately shows reacting character')
      assert.equal(fpEngine.cameraRig.getShakePitch(), 0, '3P mode drops 1P pitch jolt to keep character framed cleanly')
      assert.ok(switchedRig.leftKneePivot.rotation.x < -0.15, 'Switching 1P->3P mid-impact preserves knee absorption pose')
      fpEngine.toggleCameraMode()
      fpEngine.stepFrame(1 / 60)
      assert.equal(fpEngine.getCameraMode(), CAMERA_MODES.FIRST_PERSON)
      assert.equal(fpEngine.getPlayer().visible, false, 'Switching 3P->1P mid-impact hides rig cleanly')
      break
    }
  }
  assert.equal(switchedMidImpact, true, 'Verified mid-impact perspective switch')

  // cameraShake=false suppresses 1P camera jolt/tilt without suppressing character balance physics
  fpEngine.updateCameraConfig({ cameraShake: false })
  fpEngine.restartSpawnSequence()
  let rigReactedWithShakeOff = false
  for (let i = 0; i < 160; i += 1) {
    fpEngine.stepFrame(1 / 60)
    const st = fpEngine.getSpawnSequenceState()
    if (st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT || st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_SETTLE) {
      assert.equal(fpEngine.cameraRig.getShakePitch(), 0, 'cameraShake=false suppresses 1P impact pitch')
      assert.equal(fpEngine.cameraRig.getShakeRoll(), 0, 'cameraShake=false suppresses 1P impact roll')
      if (fpEngine.getPlayer().userData.rig.spinePivot.rotation.x < -0.15) {
        rigReactedWithShakeOff = true
      }
    }
  }
  assert.equal(rigReactedWithShakeOff, true, 'Character balance reaction still executes smoothly with cameraShake=false')

  fpEngine.dispose()
  disposeAllSharedPools()
  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Zero lingering shared pools after impact tests')
  console.log('✓ Procedural player landing impact, balance recovery, 1P/3P camera & zero residual pose verified')
}

// ---------------------------------------------------------------------------
// 7. Heavy Elevator Landing Audio Synchronization, Settings & Cleanup
// ---------------------------------------------------------------------------
{
  console.log('Test 7: Heavy elevator landing audio sync, reducedMotion audio, volumes & cancel/reset cleanup')
  function createMockWebAudioContext() {
    const stats = {
      oscStarted: 0,
      oscStopped: 0,
      bufStarted: 0,
      bufStopped: 0,
      delayCreated: 0,
      disconnected: 0,
    }
    const makeParam = (init = 0) => ({
      value: init,
      setValueAtTime(v) {
        this.value = v
      },
      setTargetAtTime(v) {
        this.value = v
      },
      linearRampToValueAtTime(v) {
        this.value = v
      },
      exponentialRampToValueAtTime(v) {
        this.value = v
      },
      cancelScheduledValues() {},
    })
    const makeBase = (extra = {}) => ({
      connect() {},
      disconnect() {
        stats.disconnected += 1
      },
      ...extra,
    })
    const ctx = {
      state: 'running',
      currentTime: 2.0,
      sampleRate: 44100,
      destination: makeBase(),
      listener: {
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
        forwardX: makeParam(0),
        forwardY: makeParam(0),
        forwardZ: makeParam(-1),
        upX: makeParam(0),
        upY: makeParam(1),
        upZ: makeParam(0),
      },
      async resume() {
        this.state = 'running'
      },
      async suspend() {
        this.state = 'suspended'
      },
      async close() {
        this.state = 'closed'
      },
      createDelay(maxDelayTime = 1) {
        stats.delayCreated += 1
        return makeBase({ maxDelayTime, delayTime: makeParam(0) })
      },
      createGain() {
        return makeBase({ gain: makeParam(1) })
      },
      createDynamicsCompressor() {
        return makeBase({ threshold: makeParam(-24), knee: makeParam(30), ratio: makeParam(12) })
      },
      createBiquadFilter() {
        return makeBase({ type: 'lowpass', frequency: makeParam(1000), Q: makeParam(1) })
      },
      createPanner() {
        return makeBase({
          panningModel: 'HRTF',
          distanceModel: 'linear',
          refDistance: 1,
          maxDistance: 100,
          rolloffFactor: 1,
          positionX: makeParam(0),
          positionY: makeParam(0),
          positionZ: makeParam(0),
        })
      },
      createOscillator() {
        return makeBase({
          type: 'sine',
          frequency: makeParam(440),
          onended: null,
          start() {
            stats.oscStarted += 1
          },
          stop() {
            stats.oscStopped += 1
            this.onended?.()
          },
        })
      },
      createBuffer(channels, length, sampleRate) {
        return {
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          getChannelData() {
            return new Float32Array(length)
          },
        }
      },
      createBufferSource() {
        return makeBase({
          buffer: null,
          loop: false,
          onended: null,
          start() {
            stats.bufStarted += 1
          },
          stop() {
            stats.bufStopped += 1
            this.onended?.()
          },
        })
      },
    }
    return { ctx, stats }
  }

  const mockAudio = createMockWebAudioContext()
  const maze = generateMaze({ difficulty: 'medium', seed: 6161 })
  const engine = createHeadlessEngine({
    audio: {
      createAudioContext: () => mockAudio.ctx,
      recordCueHistory: true,
      volumes: { master: 0.9, effects: 0.75, ambience: 0.5, music: 0.4, muted: false },
    },
  })
  assert.equal(engine.unlockAudio(), true)
  engine.setMaze(maze)

  let impactFrameCount = 0
  let syncedOnImpactFrame = false
  let sawExitAfterImpact = false
  for (let i = 0; i < 360; i += 1) {
    const oscBefore = mockAudio.stats.oscStarted
    const bufBefore = mockAudio.stats.bufStarted
    const delayBefore = mockAudio.stats.delayCreated
    engine.stepFrame(1 / 60)
    const st = engine.getSpawnSequenceState()
    const cues = engine.audioEngine.getCueHistory().filter((c) => c.type === 'start_elevator_impact')
    if (st.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND) {
      assert.equal(cues.length, 0, 'No landing impact audio triggers before touchdown')
    } else if (st.impactTriggered) {
      impactFrameCount += 1
      syncedOnImpactFrame =
        cues.length === 1 &&
        mockAudio.stats.oscStarted - oscBefore >= 8 &&
        mockAudio.stats.bufStarted - bufBefore >= 5 &&
        mockAudio.stats.delayCreated - delayBefore >= 5 &&
        st.impactJoltEnvelope > 0.35 &&
        engine.cameraShakeIntensity > 0.1 &&
        engine.getMazeGroup().userData.startElevator.userData.dustPoints.visible
    } else if (st.stage === SPAWN_SEQUENCE_STAGES.WALK_OFF) {
      sawExitAfterImpact = true
    }
    if (!engine.isSpawnSequenceActive()) break
  }

  assert.equal(impactFrameCount, 1, 'Touchdown frame triggers once per arrival')
  assert.equal(
    syncedOnImpactFrame,
    true,
    'Multi-layer impact + shaft echo DelayNodes start synchronously with dust, shake, and player balance jolt'
  )
  assert.equal(
    sawExitAfterImpact && !engine.isSpawnSequenceActive(),
    true,
    'Echo reverb tail rings out naturally without delaying balance recovery or character exit walk'
  )
  assert.equal(
    engine.audioEngine.getCueHistory().filter((c) => c.type === 'start_elevator_impact').length,
    1,
    'Impact sound fires strictly once across entire arrival-to-exit sequence'
  )

  // Reduced motion preserves impact audio while suppressing camera shake/dust
  engine.audioEngine.clearCueHistory()
  engine.updateHorrorConfig({ reducedMotion: true })
  engine.restartSpawnSequence()
  assert.equal(
    engine.audioEngine.getAudioState().activeElevatorCueCount,
    0,
    'restartSpawnSequence stops previous active elevator cues before restarting'
  )
  for (let i = 0; i < 160; i += 1) {
    engine.stepFrame(1 / 60)
  }
  assert.equal(
    engine.audioEngine.getCueHistory().filter((c) => c.type === 'start_elevator_impact').length,
    1,
    'reducedMotion keeps heavy landing impact audio active without muting'
  )

  // Mid-impact cancelSpawnSequence stops and disconnects active elevator audio nodes cleanly
  engine.updateHorrorConfig({ reducedMotion: false })
  engine.restartSpawnSequence()
  for (let i = 0; i < 120; i += 1) {
    engine.stepFrame(1 / 60)
    if (engine.getSpawnSequenceState().stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_IMPACT) break
  }
  assert.ok(
    engine.audioEngine.getAudioState().activeElevatorCueCount >= 1,
    'Active elevator cue tracked during impact'
  )
  const oscStoppedBeforeCancel = mockAudio.stats.oscStopped
  const discBeforeCancel = mockAudio.stats.disconnected
  engine.cancelSpawnSequence()
  assert.equal(
    engine.audioEngine.getAudioState().activeElevatorCueCount,
    0,
    'cancelSpawnSequence leaves zero active elevator cues'
  )
  assert.ok(
    mockAudio.stats.oscStopped > oscStoppedBeforeCancel &&
      mockAudio.stats.disconnected > discBeforeCancel,
    'cancelSpawnSequence stops and disconnects active landing audio nodes'
  )

  // Mute and volume checks via MazeSceneEngine
  engine.audioEngine.setMuted(true)
  assert.equal(engine.audioEngine.masterGain.gain.value, 0, 'Mute zeroes master GainNode')
  engine.audioEngine.setMuted(false)
  engine.audioEngine.setVolumes({ master: 0.5, effects: 0.6 })
  assert.ok(
    Math.abs(engine.audioEngine.getEffectiveVolumes().effects - 0.3) < 1e-6,
    'Master & SFX volumes scale effects bus accurately'
  )

  engine.dispose()
  disposeAllSharedPools()
  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Zero lingering shared pools after audio sync test')
  console.log('✓ Heavy elevator landing audio sync, reducedMotion audio, volumes & cancel/reset cleanup verified')
}

console.log('=== ALL PHASE 2 ELEVATOR ARRIVAL & EXIT SPAWN ANIMATION TESTS PASSED! ===')
