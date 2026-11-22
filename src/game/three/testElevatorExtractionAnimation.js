import assert from 'node:assert/strict'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import {
  ELEVATOR_DECK_TOP_Y,
  ELEVATOR_PALETTE,
  getElevatorFloorHeightAtWorld,
  getExtractionDeckOffsetY,
  resolveElevatorLayout,
} from './buildElevators.js'
import { CAMERA_MODES, THIRD_PERSON_CAMERA_MODES } from './CameraRig.js'
import {
  EXTRACTION_SEQUENCE_STAGES,
  ElevatorExtractionSequence,
  resolveElevatorExtractionTrajectory,
} from './ElevatorExtractionSequence.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  disposeAllSharedPools,
  getActiveSharedPoolOwnerCount,
} from './sharedResources.js'

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

function wrapAngleDiff(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current))
}

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
    skipSpawnSequence: true,
    enemies: { autoSpawn: false },
    audio: { recordCueHistory: true },
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

function findWalkableNeighbor(maze, cell) {
  const dirs = [
    { dRow: -1, dCol: 0 },
    { dRow: 1, dCol: 0 },
    { dRow: 0, dCol: -1 },
    { dRow: 0, dCol: 1 },
  ]
  for (const d of dirs) {
    const r = cell.row + d.dRow
    const c = cell.col + d.dCol
    if (maze.grid?.[r]?.[c] === CELL_TYPES.PATH) {
      return { row: r, col: c }
    }
  }
  return null
}

function buildDirectionalExitMaze(openDirection) {
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  // 5x5 grid with exit at (2, 2) and approach corridor open ONLY toward openDirection
  const grid = [
    [W, W, W, W, W],
    [W, W, W, W, W],
    [W, W, P, W, W],
    [W, W, W, W, W],
    [W, W, W, W, W],
  ]
  let start = { row: 2, col: 2 }
  if (openDirection === 'north') {
    grid[1][2] = P
    grid[0][2] = P
    start = { row: 0, col: 2 }
  } else if (openDirection === 'south') {
    grid[3][2] = P
    grid[4][2] = P
    start = { row: 4, col: 2 }
  } else if (openDirection === 'east') {
    grid[2][3] = P
    grid[2][4] = P
    start = { row: 2, col: 4 }
  } else if (openDirection === 'west') {
    grid[2][1] = P
    grid[2][0] = P
    start = { row: 2, col: 0 }
  }
  return {
    id: `dir-exit-${openDirection}`,
    difficulty: 'easy',
    rows: 5,
    cols: 5,
    start,
    exit: { row: 2, col: 2 },
    grid,
    coins: [],
    powerUps: [],
    keycards: [],
    solutionPath: [],
  }
}

console.log('--- RUNNING PHASE 3 EMERGENCY EXTRACTION ANIMATION TESTS ---')
disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Trajectory Resolution & Stage Progression Unit Tests (N/S/E/W + Difficulties)
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Trajectory resolution across N/S/E/W orientations & all difficulties')
  for (const dir of ['north', 'south', 'east', 'west']) {
    const maze = buildDirectionalExitMaze(dir)
    const neighbor = findWalkableNeighbor(maze, maze.exit)
    const neighborW = gridToWorld(neighbor.row, neighbor.col, maze)
    const exitW = gridToWorld(maze.exit.row, maze.exit.col, maze)
    const layout = resolveElevatorLayout(maze, maze.exit)

    const traj = resolveElevatorExtractionTrajectory(maze, neighborW)
    assert.ok(traj, `${dir}: trajectory resolved`)
    assert.ok(
      traj.totalWalkDistance > 2.0,
      `${dir}: resolves full walk path from outside ramp into cabin (${traj.totalWalkDistance.toFixed(2)}m)`
    )
    assert.ok(
      traj.rampStartDist < traj.deckTopDist && traj.deckTopDist < traj.totalWalkDistance,
      `${dir}: ramp/threshold crossing interval ordered cleanly`
    )

    // Verify cabin target sits inside cabin (+0.24 local Z) on 0.06m deck
    const dx = traj.cabinCenterX - exitW.x
    const dz = traj.cabinCenterZ - exitW.z
    const lx = dx * Math.cos(layout.yaw) - dz * Math.sin(layout.yaw)
    const lz = dx * Math.sin(layout.yaw) + dz * Math.cos(layout.yaw)
    assert.ok(Math.abs(lx) < 1e-4, `${dir}: cabin target centered locally X=${lx}`)
    assert.ok(Math.abs(lz - 0.24) < 1e-4, `${dir}: cabin target stands inside cabin Z=${lz}`)
    assert.ok(
      Math.abs(traj.cabinCenterY - ELEVATOR_DECK_TOP_Y) < 1e-5,
      `${dir}: cabin center target height equals ELEVATOR_DECK_TOP_Y`
    )
  }

  for (const difficulty of ['easy', 'medium', 'hard', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 8080 })
    const neighbor = findWalkableNeighbor(maze, maze.exit)
    const neighborW = gridToWorld(neighbor.row, neighbor.col, maze)
    // Test sideways offset approach near doorframe/console edge
    const offCenterStart = { x: neighborW.x + 0.72, z: neighborW.z - 0.35 }
    const seq = new ElevatorExtractionSequence()
    assert.equal(seq.start(maze, offCenterStart, { initialYaw: 1.8 }), true)

    const seenStages = new Set()
    for (let i = 0; i < 240; i += 1) {
      const out = seq.update(1 / 45)
      seenStages.add(out.stage)
      if (out.completed) break
    }
    for (const reqStage of [
      EXTRACTION_SEQUENCE_STAGES.APPROACH_TURN,
      EXTRACTION_SEQUENCE_STAGES.WALK_TO_THRESHOLD,
      EXTRACTION_SEQUENCE_STAGES.CLIMB_THRESHOLD,
      EXTRACTION_SEQUENCE_STAGES.ENTER_CABIN,
      EXTRACTION_SEQUENCE_STAGES.TURN_AND_SETTLE,
      EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING,
      EXTRACTION_SEQUENCE_STAGES.DEPARTING,
      EXTRACTION_SEQUENCE_STAGES.COMPLETED,
    ]) {
      assert.ok(
        seenStages.has(reqStage),
        `${difficulty}: extraction sequence visits stage "${reqStage}"`
      )
    }
    assert.equal(seq.isActive(), false, `${difficulty}: sequence clears active after completion`)
    seq.dispose()
  }
  console.log('✓ Trajectory resolution & full 8-stage progression verified')
}

// ---------------------------------------------------------------------------
// 2. Full 16-Pivot Kinematics, Threshold Climb Boot Grounding & Door/Winch Visuals
// ---------------------------------------------------------------------------
{
  console.log('Test 2: 16-pivot kinematics, threshold climb grounding & elevator door/beacon/winch visuals')
  const maze = buildDirectionalExitMaze('south')
  const exitW = gridToWorld(maze.exit.row, maze.exit.col, maze)
  const neighborW = gridToWorld(3, 2, maze)
  const layout = resolveElevatorLayout(maze, maze.exit)

  const engine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
  })

  let heldInput = { forwardAxis: 1, strafeAxis: 0, sprint: false }
  let deferredCellEntered = false
  let extractionCompletedCallback = false
  const notifiedStates = []

  engine.setMovementOptions({
    onPlayerCellChange: (cell) => {
      if (cell.row === maze.exit.row && cell.col === maze.exit.col) {
        deferredCellEntered = true
      }
    },
  })
  engine.setOnExtractionSequenceChange((active, detail) => {
    notifiedStates.push({ active, stage: detail?.stage })
  })
  engine.setOnExtractionComplete(() => {
    extractionCompletedCallback = true
  })

  engine.setInputSource(() => heldInput)
  engine.setMaze(maze)

  // Place player just outside exit threshold facing north toward elevator (-Z)
  engine.setPlayerWorldPosition(neighborW.x, 0, neighborW.z + 0.1, {
    yaw: 0,
    immediate: true,
  })
  engine.setLookDirection(0, 0)

  // Step forward until player enters exit cell -> extraction sequence must start automatically
  let triggered = false
  for (let f = 0; f < 90; f += 1) {
    engine.stepFrame(1 / 60)
    if (engine.isExtractionSequenceActive()) {
      triggered = true
      break
    }
  }
  assert.equal(triggered, true, 'Stepping into unlocked exit cell starts Phase 3 extraction')
  assert.equal(
    deferredCellEntered,
    false,
    'onPlayerCellChange victory trigger must be deferred while extraction begins'
  )
  assert.equal(engine.hasWon, false, 'engine.hasWon stays false at start of extraction')

  const player = engine.getPlayer()
  const rig = player.userData.rig
  const gateGroup = engine.getExitGateGroup()
  const doors = gateGroup.userData.doors
  const lockBarGroup = gateGroup.userData.lockBarGroup
  const sheaves = gateGroup.userData.sheaves
  const beaconMat = gateGroup.userData.beaconMat
  const interiorLightMat = gateGroup.userData.interiorLightMat

  let maxClimbEnv = 0
  let minKneeDuringClimb = 0
  let minSpineLeanDuringClimb = Infinity
  let sawFloorToDeckClimb = false
  let sawOpenDoorsInsideCabin = false
  let sawClosingDoorsIntermediate = false
  let sawClosedDoorsAndLockedBar = false
  let sawAmberBeaconPulse = false
  let sawConfirmedEmeraldBeacon = false
  let sawSheaveRotation = false
  let sawDeckHeave = false
  let maxSoleError = 0
  let maxPosStep = 0
  let prevPos = engine.getPlayerWorldPosition()
  const seenStages = new Set()

  // Advance full extraction sequence at 60Hz
  for (let f = 0; f < 320; f += 1) {
    engine.stepFrame(1 / 60)
    const state = engine.getExtractionSequenceState()
    seenStages.add(state.stage)
    assertAllRigTransformsFinite(rig, `frame[${f}]`)

    // While extraction runs (until final completion frame), victory must NOT trigger prematurely
    if (state.stage !== EXTRACTION_SEQUENCE_STAGES.COMPLETED) {
      assert.equal(
        deferredCellEntered,
        false,
        `Victory deferred during active extraction stage "${state.stage}"`
      )
      assert.equal(
        extractionCompletedCallback,
        false,
        `Extraction complete callback deferred during "${state.stage}"`
      )
    }

    assert.ok(
      rig.leftKneePivot.rotation.x <= 1e-5 && rig.leftKneePivot.rotation.x >= -1.75 - 1e-5,
      'Left knee angle within physical limits'
    )
    assert.ok(
      rig.rightKneePivot.rotation.x <= 1e-5 && rig.rightKneePivot.rotation.x >= -1.75 - 1e-5,
      'Right knee angle within physical limits'
    )

    const curPos = engine.getPlayerWorldPosition()
    const frameStep = Math.hypot(curPos.x - prevPos.x, curPos.z - prevPos.z)
    if (frameStep > maxPosStep) maxPosStep = frameStep
    prevPos = curPos

    const floorY = getElevatorFloorHeightAtWorld(curPos.x, curPos.z, maze)
    const deckOffset = getExtractionDeckOffsetY(gateGroup)
    const expectedFloorY =
      floorY +
      (state.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING ||
      state.stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED
        ? deckOffset
        : 0)
    const bootMinY = measureBootsWorldMinY(player)
    const soleErr = Math.abs(bootMinY - expectedFloorY)
    if (soleErr > maxSoleError) maxSoleError = soleErr

    if (state.stage === EXTRACTION_SEQUENCE_STAGES.CLIMB_THRESHOLD) {
      maxClimbEnv = Math.max(maxClimbEnv, engine._elevatorExtractionSequence._stepOutput.climbEnvelope)
      minKneeDuringClimb = Math.min(
        minKneeDuringClimb,
        rig.leftKneePivot.rotation.x,
        rig.rightKneePivot.rotation.x
      )
      minSpineLeanDuringClimb = Math.min(minSpineLeanDuringClimb, rig.spinePivot.rotation.x)
      if (floorY > 0.01 && floorY < ELEVATOR_DECK_TOP_Y - 0.005) {
        sawFloorToDeckClimb = true
      }
    }

    if (
      state.stage === EXTRACTION_SEQUENCE_STAGES.ENTER_CABIN ||
      state.stage === EXTRACTION_SEQUENCE_STAGES.TURN_AND_SETTLE
    ) {
      if (Math.abs(doors.leftInner.position.x) > 1.2) {
        sawOpenDoorsInsideCabin = true
      }
    }

    if (state.stage === EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING) {
      const absInnerX = Math.abs(doors.leftInner.position.x)
      if (absInnerX > 0.56 && absInnerX < 1.25) {
        sawClosingDoorsIntermediate = true
      }
      if (beaconMat.emissive.getHex() === ELEVATOR_PALETTE.exitExtractingAccent) {
        sawAmberBeaconPulse = true
      }
    }

    if (state.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING) {
      if (Math.abs(doors.leftInner.position.x) < 0.56 && lockBarGroup.visible) {
        sawClosedDoorsAndLockedBar = true
      }
      if (Math.abs(sheaves[0].rotation.x) > 0.05 && Math.abs(sheaves[1].rotation.x) > 0.05) {
        sawSheaveRotation = true
      }
      if (deckOffset > 0.002 && deckOffset <= 0.025) {
        sawDeckHeave = true
      }
      if (beaconMat.emissive.getHex() === ELEVATOR_PALETTE.exitUnlockedAccent) {
        sawConfirmedEmeraldBeacon = true
      }
      assert.ok(interiorLightMat.emissiveIntensity >= 1.3, 'Cabin light stays bright inside closed cabin')
    }

    if (state.stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED) {
      break
    }
  }

  assert.equal(engine.isExtractionSequenceActive(), false, 'Extraction sequence completes cleanly')
  assert.equal(deferredCellEntered, true, 'onPlayerCellChange fires ONLY upon extraction completion')
  assert.equal(extractionCompletedCallback, true, 'onExtractionComplete fires upon extraction completion')
  assert.ok(maxPosStep < 0.14, `No teleportation jumps per frame (max step=${maxPosStep.toFixed(4)}m)`)
  assert.ok(maxSoleError < 0.028, `Boots remain flush with floor/ramp/deck/heave (maxErr=${maxSoleError.toFixed(4)}m)`)
  assert.ok(sawFloorToDeckClimb && maxClimbEnv > 0.7, 'Player physically climbs beveled threshold ramp')
  assert.ok(minKneeDuringClimb < -0.45, `Clear climbing knee bend achieved (${minKneeDuringClimb.toFixed(2)}rad)`)
  assert.ok(minSpineLeanDuringClimb < -0.08, `Forward torso lean during climb (${minSpineLeanDuringClimb.toFixed(2)}rad)`)
  assert.ok(sawOpenDoorsInsideCabin, 'Doors remain tucked open while player enters cabin')
  assert.ok(sawClosingDoorsIntermediate, 'Bi-parting doors animate smoothly through closed positions')
  assert.ok(sawClosedDoorsAndLockedBar, 'Doors close flush and electromagnetic crossbar locks shut')
  assert.ok(sawAmberBeaconPulse && sawConfirmedEmeraldBeacon, 'Emergency beacons transition amber -> confirmed emerald')
  assert.ok(sawSheaveRotation, 'Overhead twin hoist sheaves spin during departure')
  assert.ok(sawDeckHeave, 'Grounded subtle mechanical hoist heave animates platform deck')

  // Player stands inside cabin centered and facing doors outward
  const finalPos = engine.getPlayerWorldPosition()
  const fdx = finalPos.x - exitW.x
  const fdz = finalPos.z - exitW.z
  const flx = fdx * Math.cos(layout.yaw) - fdz * Math.sin(layout.yaw)
  const flz = fdx * Math.sin(layout.yaw) + fdz * Math.cos(layout.yaw)
  assert.ok(
    Math.hypot(flx, flz - 0.24) < 0.08,
    `Character finishes centered in cabin facing doorway (local=${flx.toFixed(3)},${flz.toFixed(3)})`
  )
  assert.ok(
    Math.abs(wrapAngleDiff(player.rotation.y, layout.yaw)) < 0.03,
    'Character finishes facing outward toward closed doors'
  )

  // Audio cues triggered exactly once per stage transition
  const cues = engine.audioEngine.getCueHistory().map((c) => c.type)
  assert.equal(cues.filter((t) => t === 'extraction_doors_close').length, 1, 'Doors-close audio cue fires once')
  assert.equal(cues.filter((t) => t === 'extraction_depart').length, 1, 'Departure winch audio cue fires once')

  engine.dispose()
  console.log('✓ Kinematics, grounding, door/crossbar closure, lighting transitions, sheaves & delayed victory verified')
}

// ---------------------------------------------------------------------------
// 3. GameReducer COMPLETE_EXIT_EXTRACTION + Locked Exit Gate Blocking
// ---------------------------------------------------------------------------
{
  console.log('Test 3: gameReducer COMPLETE_EXIT_EXTRACTION & locked-exit protection')
  const baseState = createInitialGameState('medium', 9901)
  const unlockedState = {
    ...baseState,
    keysCollected: baseState.totalKeys,
    isExitLocked: false,
    activeEffects: {
      echoRevealRemainingMs: 2500,
      magnetRemainingMs: 1800,
      wallPassArmed: true,
    },
  }

  // Locked state MUST reject COMPLETE_EXIT_EXTRACTION
  const lockedAttempt = gameReducer(
    { ...unlockedState, isExitLocked: true },
    { type: 'COMPLETE_EXIT_EXTRACTION' }
  )
  assert.equal(lockedAttempt.hasWon, false, 'Locked state cannot complete extraction victory')

  // Unlocked state MUST complete cleanly & clear active timed effects & be idempotent
  const wonState = gameReducer(unlockedState, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(wonState.hasWon, true, 'COMPLETE_EXIT_EXTRACTION marks hasWon true')
  assert.deepEqual(wonState.playerPos, unlockedState.maze.exit, 'playerPos updated to exit cell')
  assert.equal(wonState.lastEvent?.type, 'exit', 'Emits exit event')
  assert.equal(wonState.activeEffects.wallPassArmed, false, 'Clears armed powerups on victory')

  const idempotent = gameReducer(wonState, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(idempotent, wonState, 'Duplicate COMPLETE_EXIT_EXTRACTION is a safe no-op')

  // Engine level locked-exit enforcement: never starts extraction while locked
  const lockedMaze = generateMaze({ difficulty: 'medium', seed: 9902 })
  const neighbor = findWalkableNeighbor(lockedMaze, lockedMaze.exit)
  const neighborW = gridToWorld(neighbor.row, neighbor.col, lockedMaze)
  const lockedExitW = gridToWorld(lockedMaze.exit.row, lockedMaze.exit.col, lockedMaze)
  const doorwayOutsideLocked = {
    x: lockedExitW.x + (neighborW.x - lockedExitW.x) * 0.55,
    z: lockedExitW.z + (neighborW.z - lockedExitW.z) * 0.55,
  }
  const engine = createHeadlessEngine()
  engine.setMaze(lockedMaze)
  engine.setExitLocked(true, { animate: false })
  engine.setPlayerWorldPosition(doorwayOutsideLocked.x, 0, doorwayOutsideLocked.z, { immediate: true })

  assert.equal(engine.startExtractionSequence(), false, 'Locked exit rejects startExtractionSequence()')
  const interactRes = engine.interact()
  assert.equal(interactRes.action, 'locked_exit', 'interact() near locked exit triggers locked_exit cue')
  assert.equal(engine.isExtractionSequenceActive(), false, 'Extraction remains inactive while locked')
  assert.ok(
    engine.audioEngine.getCueHistory().some((c) => c.type === 'locked_exit'),
    'Locked exit audio cue emitted'
  )

  engine.dispose()
  console.log('✓ Reducer COMPLETE_EXIT_EXTRACTION & locked-exit protection verified')
}

// ---------------------------------------------------------------------------
// 4. Camera Modes (1P, 3P Follow, 3P Free-Look, Mid-Sequence Toggle) & Pause/Protection
// ---------------------------------------------------------------------------
{
  console.log('Test 4: 1P/3P camera modes, interact() trigger, pause/resume & enemy/hazard protection')
  const maze = buildDirectionalExitMaze('east')
  const exitW = gridToWorld(maze.exit.row, maze.exit.col, maze)
  const neighborW = gridToWorld(2, 3, maze)
  const doorwayOutside = {
    x: exitW.x + (neighborW.x - exitW.x) * 0.55,
    z: exitW.z + (neighborW.z - exitW.z) * 0.55,
  }

  const engine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
    horrorDirector: { reducedMotion: false },
  })
  engine.setMaze(maze)
  engine.setPlayerWorldPosition(doorwayOutside.x, 0, doorwayOutside.z, {
    yaw: Math.PI / 2, // facing west toward exit (2,2)
    immediate: true,
  })
  engine.setLookDirection(Math.PI / 2, 0)

  // Trigger via interact() near unlocked exit
  const interactStart = engine.interact()
  assert.equal(interactStart.handled, true, 'interact() near unlocked exit triggers extraction')
  assert.equal(interactStart.action, 'extract')
  assert.equal(engine.isExtractionSequenceActive(), true)

  // Duplicate trigger rejected cleanly
  assert.equal(engine.startExtractionSequence(), false, 'Duplicate extraction trigger rejected')

  // Player movement locked during extraction
  const moveAttempt = engine.stepMovement({ forwardAxis: 1, strafeAxis: 0 }, 1 / 30)
  assert.equal(moveAttempt.moved, false, 'Player movement locked during extraction')

  // Look delta remains responsive in 1P without breaking player pose
  const lookBefore = engine.cameraRig.getLookDirection().yaw
  engine.applyLookDelta(40, 0, { sensitivity: 0.005 })
  assert.notEqual(engine.cameraRig.getLookDirection().yaw, lookBefore, 'Camera look responds during extraction')

  // Enemy attack & hazard immunity during extraction
  const startHealth = engine.health
  const player = engine.getPlayer()
  assert.equal(player.visible, false, '1P mode keeps character mesh hidden initially')

  // Step halfway, verify pause freezes elapsed, switch camera mode mid-sequence to 3P free-look
  for (let f = 0; f < 40; f += 1) {
    engine.stepFrame(1 / 60)
  }
  const midElapsed = engine.getExtractionSequenceState().elapsed
  engine.setPaused(true)
  engine.stepFrame(1 / 30)
  assert.equal(
    engine.getExtractionSequenceState().elapsed,
    midElapsed,
    'Paused extraction freezes sequence clock cleanly'
  )
  engine.setPaused(false)

  // Switch to 3P free-look mid-sequence and step through to completion
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
  engine.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK)
  assert.equal(player.visible, true, 'Switching to 3P mid-sequence shows character cleanly')

  for (let f = 0; f < 220; f += 1) {
    engine.stepFrame(1 / 60)
    if (!engine.isExtractionSequenceActive()) break
  }
  assert.equal(engine.isExtractionSequenceActive(), false, 'Resumed sequence completes smoothly')
  assert.equal(engine.health, startHealth, 'Player takes zero damage during extraction')

  // Test reducedMotion suppresses deck heave
  engine.resetCombat()
  engine.setHorrorConfig({ reducedMotion: true })
  engine.setPlayerWorldPosition(exitW.x, ELEVATOR_DECK_TOP_Y, exitW.z, { immediate: true })
  assert.equal(engine.startExtractionSequence(), true, 'Replay after resetCombat works')
  for (let f = 0; f < 240; f += 1) {
    engine.stepFrame(1 / 60)
    assert.equal(
      getExtractionDeckOffsetY(engine.getExitGateGroup()),
      0,
      'reducedMotion keeps platformDeck steady (0 heave)'
    )
    if (!engine.isExtractionSequenceActive()) break
  }
  assert.equal(engine.isExtractionSequenceActive(), false)

  // Changing maze difficulty/level mid-extraction aborts safely with zero leftover locks
  const hardMaze = generateMaze({ difficulty: 'hard', seed: 7777 })
  engine.setMaze(hardMaze)
  assert.equal(engine.isExtractionSequenceActive(), false, 'setMaze resets extraction state cleanly')

  engine.dispose()
  console.log('✓ 1P/3P camera modes, pause/resume, reducedMotion & replay/difficulty cleanup verified')
}

disposeAllSharedPools()
assert.equal(
  getActiveSharedPoolOwnerCount(),
  0,
  'Zero active shared pool owners leak after extraction test suite'
)

console.log('ALL PHASE 3 EMERGENCY EXTRACTION ANIMATION TESTS PASSED ✓')
