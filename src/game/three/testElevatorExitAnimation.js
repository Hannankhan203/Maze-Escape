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

  const seenStages = new Set()
  for (let i = 0; i < 90; i += 1) {
    const step = seq.update(1 / 30)
    seenStages.add(step.stage)
    if (step.completed) break
  }

  for (const expectedStage of [
    SPAWN_SEQUENCE_STAGES.IDLE_RECOVER,
    SPAWN_SEQUENCE_STAGES.TURN_TO_EXIT,
    SPAWN_SEQUENCE_STAGES.WALK_OFF,
    SPAWN_SEQUENCE_STAGES.SETTLE,
    SPAWN_SEQUENCE_STAGES.COMPLETED,
  ]) {
    assert.ok(
      seenStages.has(expectedStage),
      `Sequence visits required stage "${expectedStage}"`
    )
  }
  assert.equal(seq.isActive(), false, 'Sequence stops active flag cleanly upon completion')
  seq.dispose()
  console.log('✓ Trajectory resolution & stage progression verified')
}

// ---------------------------------------------------------------------------
// 2. Full 16-Pivot Kinematics, Boot Grounding Down Ramp & Zero-Snap Handoff
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Full 16-pivot procedural kinematics, boot grounding down ramp & seamless handoff')
  for (const difficulty of ['easy', 'medium', 'hard', 'hardcore']) {
    const gameState = createInitialGameState(difficulty, 2027)
    const engine = createHeadlessEngine({
      cameraMode: CAMERA_MODES.THIRD_PERSON,
      thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
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
    const initialPos = engine.getPlayerWorldPosition()
    assert.ok(
      Math.hypot(initialPos.x - startWorld.x, initialPos.z - startWorld.z) < 1e-5 &&
        Math.abs(initialPos.y - ELEVATOR_DECK_TOP_Y) < 1e-5,
      `${difficulty}: player starts centered on broken elevator deck (y=${initialPos.y})`
    )

    // Verify initial camera yaw matches corridor exit orientation immediately on spawn
    assert.ok(
      Math.abs(engine.cameraRig.getLookDirection().yaw - engine._currentInitialYaw) < 1e-5,
      `${difficulty}: camera initially looks cleanly toward open elevator exit`
    )

    const player = engine.getPlayer()
    const rig = player.userData.rig
    const seenStages = new Set()
    let minHeadYaw = Infinity
    let maxHeadYaw = -Infinity
    let minSpineRotX = Infinity
    let maxSpineRotX = -Infinity
    let minArmSwing = Infinity
    let maxArmSwing = -Infinity
    let minHipSwing = Infinity
    let maxHipSwing = -Infinity
    let sawRampFloorTransition = false
    let maxSoleClearanceError = 0
    let maxPosJumpPerFrame = 0

    let prevPos = engine.getPlayerWorldPosition()
    const dt = 1 / 60

    // Step until spawn sequence finishes
    for (let f = 0; f < 220; f += 1) {
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
      const frameDist = Math.hypot(curPos.x - prevPos.x, curPos.z - prevPos.z)
      maxPosJumpPerFrame = Math.max(maxPosJumpPerFrame, frameDist)
      prevPos = curPos

      // Held forward input must NOT break player loose onto sprint/free walk during recover/turn
      if (
        seqState.stage === SPAWN_SEQUENCE_STAGES.IDLE_RECOVER ||
        seqState.stage === SPAWN_SEQUENCE_STAGES.TURN_TO_EXIT
      ) {
        assert.ok(
          Math.hypot(curPos.x - startWorld.x, curPos.z - startWorld.z) < 1e-5,
          `${difficulty}: player remains planted on deck during ${seqState.stage} even with held input`
        )
      }

      const localFloorY = getElevatorFloorHeightAtWorld(curPos.x, curPos.z, gameState.maze)
      if (localFloorY > 0.002 && localFloorY < ELEVATOR_DECK_TOP_Y - 0.002) {
        sawRampFloorTransition = true
      }

      const bootMinY = measureBootsWorldMinY(player)
      const clearance = bootMinY - localFloorY
      assert.ok(
        clearance >= -0.025,
        `${difficulty}: boots do not sink below local floor (${bootMinY.toFixed(4)} vs ${localFloorY.toFixed(4)})`
      )
      assert.ok(
        clearance <= 0.095,
        `${difficulty}: boots do not float excessively above local floor (${bootMinY.toFixed(4)} vs ${localFloorY.toFixed(4)})`
      )
      maxSoleClearanceError = Math.max(maxSoleClearanceError, Math.abs(clearance))

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

    assert.equal(engine.isSpawnSequenceActive(), false, `${difficulty}: sequence finished within expected duration`)
    assert.ok(sawRampFloorTransition, `${difficulty}: traversed downward ramp slope smoothly`)
    assert.ok(maxPosJumpPerFrame < 0.08, `${difficulty}: smooth per-frame displacement (${maxPosJumpPerFrame.toFixed(4)}m)`)
    assert.ok(maxHeadYaw - minHeadYaw > 0.08, `${difficulty}: head turns naturally toward exit`)
    assert.ok(maxSpineRotX - minSpineRotX > 0.04, `${difficulty}: spine articulates recovery & gait lean`)
    assert.ok(maxArmSwing - minArmSwing > 0.25, `${difficulty}: arms swing organically`)
    assert.ok(maxHipSwing - minHipSwing > 0.35, `${difficulty}: legs stride naturally down ramp`)

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
  console.log('✓ 16-pivot kinematics, boot grounding & zero-snap handoff verified across all difficulties')
}

// ---------------------------------------------------------------------------
// 3. First-Person, Free-Look, Live Camera Controls & Mid-Intro Mode Toggles
// ---------------------------------------------------------------------------
{
  console.log('Test 3: First-person cadence, Free-Look responsiveness & live camera mode toggles')
  const maze = generateMaze({ difficulty: 'medium', seed: 8080 })

  // 3a. First-person mode: player group hidden, subtle eye offset, mouse look responsive, mode unaffected
  const fpEngine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
  })
  fpEngine.setMaze(maze)
  assert.equal(fpEngine.getCameraMode(), CAMERA_MODES.FIRST_PERSON)
  assert.equal(fpEngine.getPlayer().visible, false, 'Player mesh hidden in first-person intro')

  const initialYaw = fpEngine.cameraRig.getLookDirection().yaw
  fpEngine.applyLookDelta(120, -40)
  const lookedDir = fpEngine.cameraRig.getLookDirection()
  assert.notEqual(lookedDir.yaw, initialYaw, 'First-person camera look stays responsive during spawn sequence')

  let sawEyeDip = false
  for (let i = 0; i < 160; i += 1) {
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
  assert.ok(sawEyeDip, 'First-person camera expresses subtle grounded eye recovery/step cadence')
  assert.equal(
    fpEngine.getCameraMode(),
    CAMERA_MODES.FIRST_PERSON,
    'Spawn sequence does not force camera mode change'
  )

  // Mid-intro toggle from FP -> TP -> FP seamlessly reveals/hides animated rig without interrupting sequence
  fpEngine.restartSpawnSequence()
  fpEngine.stepFrame(0.6)
  assert.equal(fpEngine.isSpawnSequenceActive(), true)
  fpEngine.toggleCameraMode()
  assert.equal(fpEngine.getCameraMode(), CAMERA_MODES.THIRD_PERSON)
  assert.equal(fpEngine.getPlayer().visible, true, 'Toggling to 3rd person mid-intro immediately shows animated rig')
  fpEngine.stepFrame(0.3)
  fpEngine.toggleCameraMode()
  assert.equal(fpEngine.getCameraMode(), CAMERA_MODES.FIRST_PERSON)
  assert.equal(fpEngine.getPlayer().visible, false, 'Toggling back to 1st person hides rig cleanly')
  fpEngine.dispose()

  // 3b. Third-Person Free Look: independent orbit remains under user control while character turns cleanly
  const flEngine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
  })
  flEngine.setMaze(maze)
  assert.equal(flEngine.isSpawnSequenceActive(), true)

  const preOrbit = flEngine.cameraRig.getCameraLookDirection()
  flEngine.applyLookDelta(180, -30)
  const postOrbit = flEngine.cameraRig.getCameraLookDirection()
  assert.notEqual(postOrbit.yaw, preOrbit.yaw, 'Free-look orbit remains responsive during spawn sequence')

  for (let i = 0; i < 160; i += 1) {
    flEngine.stepFrame(1 / 60)
    if (!flEngine.isSpawnSequenceActive()) break
  }
  assert.equal(flEngine.isSpawnSequenceActive(), false)
  // User free-look orbit yaw is preserved after character completes turn & step-off
  assert.ok(
    Math.abs(flEngine.cameraRig.getCameraLookDirection().yaw - postOrbit.yaw) < 1e-4,
    'Free-look orbit yaw is preserved without snapping on handoff'
  )
  flEngine.dispose()
  disposeAllSharedPools()
  console.log('✓ First-person cadence, Free-Look orbit & live mode switches verified')
}

// ---------------------------------------------------------------------------
// 4. Vulnerability, Enemy, Hazard, Director & Reset/Restart Safeguards
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Invulnerability, enemy/hazard/director suppression, pause & resets')
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

  // Spawn an aggressive enemy right on top of the start deck
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

  // Direct damage test only after testing real in-frame enemy/hazard suppression
  // Spawn a floor hazard at the start cell as well
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
    'HorrorDirector elapsed timer stays paused during intro sequence'
  )

  // Pause & resume mid-sequence preserves exact progress
  const pausedProgress = engine.getSpawnSequenceState().progress
  engine.setPaused(true)
  engine.stepFrame(0.5)
  assert.equal(
    engine.getSpawnSequenceState().progress,
    pausedProgress,
    'Paused engine freezes spawn sequence cleanly'
  )
  engine.setPaused(false)

  // Finish spawn sequence (enemy & hazard still must not have damaged player before completion)
  for (let i = 0; i < 160; i += 1) {
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
  assert.equal(engine.isSpawnSequenceActive(), true, 'Restart run re-arms spawn sequence')
  assert.equal(engine.getHealth().health, 100, 'Restart run restores health cleanly')
  assert.ok(
    Math.hypot(
      engine.getPlayerWorldPosition().x - startWorld.x,
      engine.getPlayerWorldPosition().z - startWorld.z
    ) < 1e-5 &&
      Math.abs(engine.getPlayerWorldPosition().y - ELEVATOR_DECK_TOP_Y) < 1e-5,
    'Restart run places player back on broken elevator deck'
  )

  // Difficulty / New Maze reset re-arms spawn sequence cleanly
  const hardMaze = generateMaze({ difficulty: 'hardcore', seed: 3030 })
  engine.setMaze(hardMaze)
  assert.equal(engine.isSpawnSequenceActive(), true, 'Changing difficulty/maze starts fresh spawn sequence')
  assert.ok(
    Math.abs(engine.getPlayerWorldPosition().y - ELEVATOR_DECK_TOP_Y) < 1e-5,
    'New maze places player flush on new broken elevator deck'
  )

  // Reduced motion preference skips eye-bob without breaking sequence completion
  engine.updateHorrorConfig({ reducedMotion: true })
  for (let i = 0; i < 160; i += 1) {
    engine.stepFrame(1 / 60)
    if (!engine.isSpawnSequenceActive()) break
  }
  assert.equal(engine.isSpawnSequenceActive(), false, 'Reduced motion finishes sequence smoothly')

  // Skip option compatibility check
  assert.ok(DEFAULT_SPAWN_SEQUENCE_CONFIG.enabled)
  engine.dispose()
  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Zero lingering shared pools after dispose')
  console.log('✓ Vulnerability safeguards, director/enemy suppression, pause & resets verified')
}

console.log('=== ALL PHASE 2 ELEVATOR EXIT SPAWN ANIMATION TESTS PASSED! ===')
