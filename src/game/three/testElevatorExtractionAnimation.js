import assert from 'node:assert/strict'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { createRunTimer } from '../mechanics/runTimer.js'
import { gridToWorld } from '../world/worldCoords.js'
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

    const seenStages = []
    let prevStage = null
    let maxDepartElevatorY = 0
    let pauseSawZeroElevation = false
    for (let i = 0; i < 360; i += 1) {
      const out = seq.update(1 / 45)
      if (out.stage !== prevStage) {
        seenStages.push(out.stage)
        prevStage = out.stage
      }
      if (out.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTURE_PAUSE) {
        assert.equal(out.elevatorY, 0, `${difficulty}: elevator holds at bottom during lock pause`)
        assert.equal(out.doorCloseProgress, 1, `${difficulty}: doors closed during departure pause`)
        pauseSawZeroElevation = true
      }
      if (out.elevatorY > maxDepartElevatorY) {
        maxDepartElevatorY = out.elevatorY
      }
      if (out.completed) break
    }
    for (const reqStage of [
      EXTRACTION_SEQUENCE_STAGES.APPROACH_TURN,
      EXTRACTION_SEQUENCE_STAGES.WALK_TO_THRESHOLD,
      EXTRACTION_SEQUENCE_STAGES.CLIMB_THRESHOLD,
      EXTRACTION_SEQUENCE_STAGES.ENTER_CABIN,
      EXTRACTION_SEQUENCE_STAGES.TURN_AND_SETTLE,
      EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING,
      EXTRACTION_SEQUENCE_STAGES.DEPARTURE_PAUSE,
      EXTRACTION_SEQUENCE_STAGES.DEPARTING,
      EXTRACTION_SEQUENCE_STAGES.COMPLETED,
    ]) {
      assert.ok(
        seenStages.includes(reqStage),
        `${difficulty}: extraction sequence visits stage "${reqStage}"`
      )
    }
    assert.ok(pauseSawZeroElevation, `${difficulty}: verified departure pause before ascent`)
    assert.ok(maxDepartElevatorY >= 12.0, `${difficulty}: elevator ascends up shaft (${maxDepartElevatorY.toFixed(2)}m)`)
    assert.equal(seq.isActive(), false, `${difficulty}: sequence clears active after completion`)
    seq.dispose()
  }
  console.log('✓ Trajectory resolution & full 9-stage extraction progression verified')
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
  let sawDeparturePauseLock = false
  let sawClosedDoorsAndLockedBar = false
  let sawAmberBeaconPulse = false
  let sawConfirmedEmeraldBeacon = false
  let sawSheaveRotation = false
  let sawDeckHeave = false
  let sawCableShorten = false
  let sawDepthDimming = false
  let sawDepartureShake = false
  let maxCabinAscentY = 0
  let prevDepartCabinY = 0
  let prevDepartCableScale = gateGroup.userData.tensionCables[0].scale.y
  let maxSoleError = 0
  let maxPosStep = 0
  let prevPos = engine.getPlayerWorldPosition()
  const seenStages = new Set()

  // Advance full extraction sequence at 60Hz (~5.8s -> 420 frames max)
  for (let f = 0; f < 420; f += 1) {
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

    const cabinY = gateGroup.userData.cabinGroup.position.y
    const floorY = getElevatorFloorHeightAtWorld(curPos.x, curPos.z, maze)
    const deckOffset = getExtractionDeckOffsetY(gateGroup)
    const expectedFloorY =
      floorY +
      (state.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING ||
      state.stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED
        ? state.elevatorY + deckOffset
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
      if (Math.abs(doors.leftInner.position.x) >= 0.94) {
        sawOpenDoorsInsideCabin = true
      }
    }

    if (state.stage === EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING) {
      const absInnerX = Math.abs(doors.leftInner.position.x)
      if (absInnerX > 0.35 && absInnerX < 0.95) {
        sawClosingDoorsIntermediate = true
      }
      if (beaconMat.emissive.getHex() === ELEVATOR_PALETTE.exitExtractingAccent) {
        sawAmberBeaconPulse = true
      }
    }

    if (state.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTURE_PAUSE) {
      assert.equal(cabinY, 0, 'Elevator cabin pauses at landing before ascending')
      if (
        Math.abs(doors.leftInner.position.x) < 0.34 &&
        lockBarGroup.visible &&
        interiorLightMat.emissiveIntensity >= 1.3
      ) {
        sawDeparturePauseLock = true
      }
    }

    if (state.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING) {
      assert.ok(
        cabinY >= prevDepartCabinY - 0.01,
        `Cabin ascends smoothly up shaft (${prevDepartCabinY.toFixed(3)} -> ${cabinY.toFixed(3)})`
      )
      prevDepartCabinY = cabinY
      maxCabinAscentY = Math.max(maxCabinAscentY, cabinY)

      const curCableScale = gateGroup.userData.tensionCables[0].scale.y
      if (curCableScale < prevDepartCableScale - 0.1) {
        sawCableShorten = true
      }
      prevDepartCableScale = curCableScale

      if (Math.abs(doors.leftInner.position.x) < 0.34 && lockBarGroup.visible) {
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
      if (engine.cameraShakeIntensity > 0.02) {
        sawDepartureShake = true
      }
      if (state.elevatorY <= 4.0) {
        assert.ok(interiorLightMat.emissiveIntensity >= 1.3, 'Cabin light starts bright inside closed cabin')
      } else if (state.elevatorY >= 10.0 && interiorLightMat.emissiveIntensity < 0.85) {
        sawDepthDimming = true
      }
    }

    if (state.stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED) {
      maxCabinAscentY = Math.max(maxCabinAscentY, cabinY)
      break
    }
  }

  assert.equal(engine.isExtractionSequenceActive(), false, 'Extraction sequence completes cleanly')
  assert.equal(deferredCellEntered, true, 'onPlayerCellChange fires ONLY upon extraction completion')
  assert.equal(extractionCompletedCallback, true, 'onExtractionComplete fires upon extraction completion')
  assert.ok(maxPosStep < 0.14, `No teleportation jumps per frame (max step=${maxPosStep.toFixed(4)}m)`)
  assert.ok(maxSoleError < 0.032, `Boots remain flush with floor/ramp/deck/ascent (maxErr=${maxSoleError.toFixed(4)}m)`)
  assert.ok(sawFloorToDeckClimb && maxClimbEnv > 0.7, 'Player physically climbs beveled threshold ramp')
  assert.ok(minKneeDuringClimb < -0.45, `Clear climbing knee bend achieved (${minKneeDuringClimb.toFixed(2)}rad)`)
  assert.ok(minSpineLeanDuringClimb < -0.08, `Forward torso lean during climb (${minSpineLeanDuringClimb.toFixed(2)}rad)`)
  assert.ok(sawOpenDoorsInsideCabin, 'Doors remain tucked open while player enters cabin')
  assert.ok(sawClosingDoorsIntermediate, 'Bi-parting doors animate smoothly through closed positions')
  assert.ok(sawDeparturePauseLock, 'Lock engages and departure lighting establishes during pre-ascent pause')
  assert.ok(sawClosedDoorsAndLockedBar, 'Doors stay locked shut throughout ascent')
  assert.ok(sawAmberBeaconPulse && sawConfirmedEmeraldBeacon, 'Emergency beacons transition amber -> confirmed emerald')
  assert.ok(sawSheaveRotation, 'Overhead twin hoist sheaves spin during departure')
  assert.ok(sawDeckHeave, 'Grounded subtle mechanical hoist heave animates platform deck')
  assert.ok(sawCableShorten, 'Hoist tension cables retract upward synchronously with ascending cabin')
  assert.ok(sawDepthDimming, 'Cabin interior lighting progressively dims with upper shaft depth')
  assert.ok(sawDepartureShake, 'Subtle camera vibration accompanies mechanical ascent')
  assert.ok(maxCabinAscentY >= 12.0, `Extraction cabin physically ascended high into shaft (y=${maxCabinAscentY.toFixed(2)}m)`)
  assert.ok(engine.camera.position.y > 10.5, `Camera tracked elevator ascent into shaft (camY=${engine.camera.position.y.toFixed(2)}m)`)

  // Player stands inside ascending cabin centered and facing doors outward
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
  assert.equal(cues.filter((t) => t === 'extraction_lock_pause').length, 1, 'Lock-pause audio cue fires once')
  assert.equal(cues.filter((t) => t === 'extraction_depart').length, 1, 'Departure winch audio cue fires once')

  engine.dispose()
  console.log('✓ Kinematics, grounding, door/lock pause, physical ascent, dimming, audio & delayed victory verified')
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
      phantomVeilRemainingMs: 1800,
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
  assert.equal(wonState.activeEffects.echoRevealRemainingMs, 0, 'Clears active echoReveal timer on victory')
  assert.equal(wonState.activeEffects.phantomVeilRemainingMs, 0, 'Clears active phantomVeil timer on victory')

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

  for (let f = 0; f < 420; f += 1) {
    engine.stepFrame(1 / 60)
    const st = engine.getExtractionSequenceState()
    if (st.elevatorY > 2.15) {
      const r = Math.hypot(
        engine.camera.position.x - exitW.x,
        engine.camera.position.z - exitW.z
      )
      assert.ok(r <= 1.54, `3P Free-Look stays inside shaft walls during ascent (r=${r.toFixed(3)})`)
    }
    if (!engine.isExtractionSequenceActive()) break
  }
  assert.equal(engine.isExtractionSequenceActive(), false, 'Resumed sequence completes smoothly')
  assert.ok(engine.camera.position.y > 10.0, `3P Free-Look tracks elevator up shaft (camY=${engine.camera.position.y.toFixed(2)})`)
  assert.equal(engine.health, startHealth, 'Player takes zero damage during extraction')

  // Test pause/resume mid-ascent freezes 3D cabin elevation cleanly
  engine.resetCombat()
  engine.setPlayerWorldPosition(exitW.x, ELEVATOR_DECK_TOP_Y, exitW.z, { immediate: true })
  assert.equal(engine.startExtractionSequence(), true, 'Replay after resetCombat works')
  for (let f = 0; f < 180; f += 1) {
    engine.stepFrame(1 / 60)
    if (engine.getExtractionSequenceState().stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING) {
      engine.stepFrame(0.35)
      break
    }
  }
  const midAscentY = engine.getExitGateGroup().userData.cabinGroup.position.y
  assert.ok(midAscentY > 0.2, `Reached mid-ascent (y=${midAscentY.toFixed(2)}m)`)
  engine.setPaused(true)
  engine.stepFrame(0.5)
  assert.equal(
    engine.getExitGateGroup().userData.cabinGroup.position.y,
    midAscentY,
    'Paused mid-ascent freezes 3D cabin elevation cleanly'
  )
  engine.setPaused(false)

  // Cancelling / resetCombat mid-ascent resets 3D cabin back to platform ground y=0
  engine.resetCombat()
  assert.equal(
    engine.getExitGateGroup().userData.cabinGroup.position.y,
    0,
    'resetCombat mid-ascent restores cabin to ground level y=0'
  )

  // Test reducedMotion suppresses deck heave while still completing full ascent
  engine.setHorrorConfig({ reducedMotion: true })
  engine.setPlayerWorldPosition(exitW.x, ELEVATOR_DECK_TOP_Y, exitW.z, { immediate: true })
  assert.equal(engine.startExtractionSequence(), true, 'Replay after reducedMotion toggle works')
  for (let f = 0; f < 420; f += 1) {
    engine.stepFrame(1 / 60)
    assert.equal(
      getExtractionDeckOffsetY(engine.getExitGateGroup()),
      0,
      'reducedMotion keeps platformDeck steady (0 heave)'
    )
    if (!engine.isExtractionSequenceActive()) break
  }
  assert.equal(engine.isExtractionSequenceActive(), false)
  assert.ok(
    engine.getExitGateGroup().userData.cabinGroup.position.y >= 12.0,
    'reducedMotion still completes physical cabin ascent up shaft'
  )

  // Changing maze difficulty/level mid-extraction aborts safely with zero leftover locks
  const hardMaze = generateMaze({ difficulty: 'hard', seed: 7777 })
  engine.setMaze(hardMaze)
  assert.equal(engine.isExtractionSequenceActive(), false, 'setMaze resets extraction state cleanly')

  engine.dispose()

  // Verify full engine departure across all 4 N/S/E/W orientations
  for (const dir of ['north', 'south', 'east', 'west']) {
    const dirMaze = buildDirectionalExitMaze(dir)
    const dirExitW = gridToWorld(dirMaze.exit.row, dirMaze.exit.col, dirMaze)
    const dirEngine = createHeadlessEngine()
    dirEngine.setMaze(dirMaze)
    dirEngine.setPlayerWorldPosition(dirExitW.x, ELEVATOR_DECK_TOP_Y, dirExitW.z, { immediate: true })
    assert.equal(dirEngine.startExtractionSequence(), true, `${dir}: starts extraction`)
    for (let f = 0; f < 420; f += 1) {
      dirEngine.stepFrame(1 / 60)
      if (!dirEngine.isExtractionSequenceActive()) break
    }
    assert.equal(dirEngine.isExtractionSequenceActive(), false, `${dir}: completes extraction`)
    assert.ok(
      dirEngine.getExitGateGroup().userData.cabinGroup.position.y >= 12.0,
      `${dir}: cabin visibly ascends shaft`
    )
    dirEngine.dispose()
  }

  console.log('✓ 1P/3P camera tracking, pause/resume mid-ascent, reducedMotion, N/S/E/W & replay/difficulty cleanup verified')
}

// ---------------------------------------------------------------------------
// 5. Doorway Sill Monotonicity, Side/Rear Corridor Approaches, Wall Rejection & Physical Extraction Indicators
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Doorway sill monotonicity, braided side/rear approaches, wall rejection & physical indicators')
  const southMaze = buildDirectionalExitMaze('south')
  const exitW = gridToWorld(southMaze.exit.row, southMaze.exit.col, southMaze)
  const layout = resolveElevatorLayout(southMaze, southMaze.exit)
  // Place player just on open doorway sill (lx=0, lz=-1.34 in elevator local space -> world z = exitW.z + 1.34 for south yaw=0)
  const sillWorld = { x: exitW.x, z: exitW.z + 1.34 }
  const sillTraj = resolveElevatorExtractionTrajectory(southMaze, sillWorld)
  assert.ok(sillTraj, 'Sill trajectory resolved')
  let prevLz = -Infinity
  for (let i = 0; i < sillTraj.points.length; i += 1) {
    const pt = sillTraj.points[i]
    const dx = pt.x - exitW.x
    const dz = pt.z - exitW.z
    const lz = dx * Math.sin(layout.yaw) + dz * Math.cos(layout.yaw)
    assert.ok(
      lz >= prevLz - 1e-5,
      `Sill entry never walks backwards (${prevLz.toFixed(3)} -> ${lz.toFixed(3)})`
    )
    prevLz = lz
  }

  // Braided corridor maze where left/right/rear neighbors are ALSO open around exit (2,2)
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  const braidedMaze = {
    id: 'braided-exit',
    difficulty: 'medium',
    rows: 5,
    cols: 5,
    start: { row: 4, col: 2 },
    exit: { row: 2, col: 2 },
    grid: [
      [W, W, P, W, W],
      [W, W, P, W, W],
      [P, P, P, P, P],
      [W, W, P, W, W],
      [W, W, P, W, W],
    ],
    coins: [],
    powerUps: [],
    keycards: [],
    solutionPath: [],
  }
  const braidedExitW = gridToWorld(2, 2, braidedMaze)
  const braidedLayout = resolveElevatorLayout(braidedMaze, braidedMaze.exit)
  assert.equal(braidedLayout.localSides.left, true, 'Braided maze opens left side')
  assert.equal(braidedLayout.localSides.right, true, 'Braided maze opens right side')
  assert.equal(braidedLayout.localSides.rear, true, 'Braided maze opens rear side')
  for (const offset of [
    { name: 'left-corridor', dx: -1.8, dz: 0 },
    { name: 'right-corridor', dx: 1.8, dz: 0 },
    { name: 'rear-corridor', dx: 0, dz: 1.8 },
  ]) {
    const seq = new ElevatorExtractionSequence()
    const startP = { x: braidedExitW.x + offset.dx, z: braidedExitW.z + offset.dz }
    assert.equal(seq.start(braidedMaze, startP, { initialYaw: 0.4 }), true, `${offset.name}: starts`)
    for (let f = 0; f < 360; f += 1) {
      const out = seq.update(1 / 45)
      if (out.completed) break
    }
    assert.equal(seq.isActive(), false, `${offset.name}: completes smoothly`)
    seq.dispose()
  }

  // Closed-wall rejection + physical extraction indicator transitions
  const walledMaze = {
    id: 'walled-exit',
    difficulty: 'easy',
    rows: 5,
    cols: 5,
    start: { row: 2, col: 4 },
    exit: { row: 2, col: 2 },
    grid: [
      [W, W, P, W, W],
      [W, W, P, W, W],
      [W, W, P, W, P],
      [W, W, W, W, W],
      [W, W, W, W, W],
    ],
    coins: [],
    powerUps: [],
    keycards: [],
    solutionPath: [],
  }
  const engine = createHeadlessEngine({
    movement: { radius: 0.1 },
  })
  engine.setMaze(walledMaze)
  // Place player in walled neighbor-corner cell (row 1, col 3 is wall; row 2, col 4 is separated by wall at (2,3); use corner in row 1, col 1? Make (1,1) open and place close to corner)
  walledMaze.grid[1][1] = P
  const diagCornerCellW = gridToWorld(1, 1, walledMaze)
  engine.setPlayerWorldPosition(diagCornerCellW.x + 1.45, 0, diagCornerCellW.z + 1.45, { immediate: true })
  const wallInteract = engine.interact()
  assert.equal(wallInteract.action, null, 'Diagonal corner behind solid wall cannot trigger extraction')
  assert.equal(engine.isExtractionSequenceActive(), false)

  // Verify extraction elevator has no artificial localized chamber PointLights while physical status indicators transition cleanly
  const litMaze = buildDirectionalExitMaze('north')
  engine.setMaze(litMaze)
  assert.equal(
    engine._environment.lights.startLight,
    undefined,
    'Start elevator chamber has no artificial localized PointLight'
  )
  assert.equal(
    engine._environment.lights.exitLight,
    undefined,
    'Extraction elevator chamber has no artificial localized PointLight'
  )
  assert.equal(engine.scene.getObjectByName('maze-env-light-start'), undefined)
  assert.equal(engine.scene.getObjectByName('maze-env-light-exit'), undefined)

  const litExitW = gridToWorld(litMaze.exit.row, litMaze.exit.col, litMaze)
  const exitBeaconMat = engine.getExitGateGroup()?.userData?.beaconMat
  assert.ok(exitBeaconMat, 'Physical extraction elevator status beacon material exists')
  engine.setPlayerWorldPosition(litExitW.x, 0, litExitW.z - 2.1, { immediate: true })
  assert.equal(engine.startExtractionSequence(), true)
  let sawClosingAmber = false
  let sawConfirmedEmerald = false
  for (let f = 0; f < 420; f += 1) {
    engine.stepFrame(1 / 60)
    const st = engine.getExtractionSequenceState()
    if (st.stage === EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING) {
      if (exitBeaconMat.emissive.getHex() === ELEVATOR_PALETTE.exitExtractingAccent) {
        sawClosingAmber = true
      }
    } else if (st.stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED) {
      assert.equal(
        exitBeaconMat.emissive.getHex(),
        ELEVATOR_PALETTE.exitUnlockedAccent,
        'Completed extraction displays physical emerald status indicator'
      )
      sawConfirmedEmerald = true
      break
    }
  }
  assert.ok(sawClosingAmber && sawConfirmedEmerald, 'Physical extraction beacon transitions verified without artificial chamber lights')

  engine.dispose()
  console.log('✓ Sill monotonicity, braided approaches, wall rejection & physical extraction indicators verified')
}

// ---------------------------------------------------------------------------
// 6. Active Enemy/Hazard Protection, Paused Reset Restoration, Camera Mode Persistence & Timer Freeze
// ---------------------------------------------------------------------------
{
  console.log('Test 6: Active enemy/hazard protection, paused resetCombat, camera persistence & timers')
  const maze = buildDirectionalExitMaze('east')
  const exitW = gridToWorld(maze.exit.row, maze.exit.col, maze)
  const neighborW = gridToWorld(2, 3, maze)

  const engine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
  })
  engine.setMaze(maze)

  // Spawn an aggressive Stalker enemy right behind the player AND a hazard right under the exit sill
  engine.spawnEnemy({
    type: 'stalker',
    row: 2,
    col: 3,
    position: { x: neighborW.x, z: neighborW.z },
  })
  engine.hazardManager?.placeHazard?.({
    type: 'steam',
    row: 2,
    col: 2,
    position: { x: exitW.x, z: exitW.z },
  })

  // Also add a hiding spot nearby to verify enterHidingSpot rejects during extraction
  engine.setPlayerWorldPosition(exitW.x + (neighborW.x - exitW.x) * 0.55, 0, exitW.z, {
    yaw: Math.PI / 2,
    immediate: true,
  })
  assert.equal(engine.startExtractionSequence(), true)
  assert.equal(engine.applyDamage(25), false, 'Direct applyDamage blocked during extraction')
  assert.equal(engine.enterHidingSpot().entered, false, 'enterHidingSpot blocked during extraction')

  // Simulate runTimer + reducer ability timer behavior while extraction runs: paused until completion
  let nowMs = 10000
  const timer = createRunTimer({ now: () => nowMs })
  timer.start()
  nowMs += 4500
  timer.pause() // Mirrors App.jsx pausing useRunTimer when isExtractionActive === true
  const frozenTimeMs = timer.getElapsedMs()
  let gameState = createInitialGameState('easy', 4242)
  gameState = {
    ...gameState,
    keysCollected: gameState.totalKeys,
    isExitLocked: false,
    activeEffects: {
      echoRevealRemainingMs: 1200,
      phantomVeilRemainingMs: 900,
    },
  }

  for (let f = 0; f < 100; f += 1) {
    nowMs += 16
    engine.stepFrame(1 / 60)
    if (f === 60) {
      // Mid-sequence paused resetCombat must immediately restore open/closed door state cleanly
      engine.setPaused(true)
      const prevMode = engine.getCameraMode()
      engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
      engine.resetCombat()
      const doors = engine.getExitGateGroup().userData.doors
      assert.ok(Math.abs(doors.leftInner.position.x) >= 0.94, 'Paused resetCombat restores unlocked open doors immediately')
      assert.equal(engine.isExtractionSequenceActive(), false)
      assert.equal(engine.getCameraMode(), CAMERA_MODES.THIRD_PERSON, 'Camera mode preference preserved across reset')
      engine.setCameraMode(prevMode)
      engine.setPaused(false)
      break
    }
  }
  assert.equal(timer.getElapsedMs(), frozenTimeMs, 'Run timer stays frozen while extraction pauses gameplay')
  assert.equal(engine.health, engine.maxHealth, 'Enemy/hazard presence inflicts 0 damage during extraction')

  // Verify full extraction completion then progression to next level via gameReducer NEW_MAZE
  engine.setPlayerWorldPosition(exitW.x + (neighborW.x - exitW.x) * 0.55, 0, exitW.z, {
    yaw: Math.PI / 2,
    immediate: true,
  })
  assert.equal(engine.startExtractionSequence(), true)
  let victoryCalls = 0
  engine.setOnExtractionComplete(() => {
    victoryCalls += 1
    gameState = gameReducer(gameState, { type: 'COMPLETE_EXIT_EXTRACTION' })
  })
  for (let f = 0; f < 420; f += 1) {
    engine.stepFrame(1 / 60)
    if (!engine.isExtractionSequenceActive()) break
  }
  assert.equal(victoryCalls, 1, 'Victory callback runs exactly once after extraction completion')
  assert.equal(gameState.hasWon, true, 'Victory state set after extraction finishes')
  const nextLevelState = gameReducer(gameState, { type: 'NEW_MAZE' })
  assert.equal(nextLevelState.hasWon, false, 'Progression NEW_MAZE clears hasWon cleanly')
  assert.notEqual(nextLevelState.seed, gameState.seed, 'NEW_MAZE advances to a fresh level seed')
  const hardLevelState = gameReducer(nextLevelState, { type: 'SET_DIFFICULTY', difficulty: 'hard' })
  assert.equal(hardLevelState.hasWon, false, 'Progression SET_DIFFICULTY clears hasWon cleanly')
  assert.equal(hardLevelState.difficulty, 'hard', 'Progression advances cleanly to selected difficulty')

  engine.dispose()
  console.log('✓ Enemy/hazard immunity, paused reset, camera persistence & victory progression verified')
}

// ---------------------------------------------------------------------------
// 7. Continuous Hoist Cables, Door-Before-Lock Sequencing, Upper-Shaft Darkness & Moving Outline
// ---------------------------------------------------------------------------
{
  console.log('Test 7: Continuous cables, door-before-lock order, upper-shaft darkness & High Contrast cabin outline')
  const maze = buildDirectionalExitMaze('north')
  const exitW = gridToWorld(maze.exit.row, maze.exit.col, maze)
  const engine = createHeadlessEngine({
    graphics: { highContrast: true },
  })
  engine.setMaze(maze)

  const gateGroup = engine.getExitGateGroup()
  const cabinGroup = gateGroup.userData.cabinGroup
  const { doors, lockBarGroup, tensionCables } = gateGroup.userData
  const env = engine.getEnvironment()
  const baselineAmbient = env.lights.ambientLight.intensity
  const baselineHemi = env.lights.hemiLight.intensity
  const baselineDir = env.lights.directionalLight.intensity
  const baselineFogDensity = env.fog.density

  // Verify High Contrast moving cabin outline rides coherently with extraction cabinGroup
  assert.ok(
    cabinGroup.userData.highContrastOutline?.visible &&
      cabinGroup.userData.highContrastOutline?.parent === cabinGroup,
    'High-contrast cabin outline rides coherently with extraction cabinGroup'
  )

  engine.setPlayerWorldPosition(exitW.x, 0, exitW.z - 2.1, { immediate: true })
  assert.equal(engine.startExtractionSequence(), true)
  // Verify continuous upper-shaft tension cables engage once extraction begins BEFORE lift-off (zero 0.24m pop at y=0.015)
  assert.ok(
    tensionCables[0].scale.y >= 15.0,
    `Extraction cables connect continuously from docked cabin to head sheaves before ascent (len=${tensionCables[0].scale.y.toFixed(2)}m)`
  )

  let sawClosedBeforeLock = false
  let lockAppearedPrematurely = false
  let minAmbientAtTop = baselineAmbient
  let minHemiAtTop = baselineHemi
  let maxFogAtTop = baselineFogDensity

  for (let f = 0; f < 420; f += 1) {
    engine.stepFrame(1 / 60)
    const st = engine.getExtractionSequenceState()
    if (st.stage === EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING) {
      const absInnerX = Math.abs(doors.leftInner.position.x)
      if (lockBarGroup.visible && absInnerX > 0.32) {
        lockAppearedPrematurely = true
      }
      if (!lockBarGroup.visible && absInnerX <= 0.32) {
        sawClosedBeforeLock = true
      }
      if (lockBarGroup.visible && absInnerX <= 0.315) {
        sawClosedBeforeLock = true
      }
    }
    if (st.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING && st.elevatorY >= 10.5) {
      minAmbientAtTop = Math.min(minAmbientAtTop, env.lights.ambientLight.intensity)
      minHemiAtTop = Math.min(minHemiAtTop, env.lights.hemiLight.intensity)
      maxFogAtTop = Math.max(maxFogAtTop, env.fog.density)
    }
    if (!engine.isExtractionSequenceActive()) break
  }

  assert.equal(lockAppearedPrematurely, false, 'Security lock bar never engages while doors are still open')
  assert.equal(sawClosedBeforeLock, true, 'Doors close completely before security lock bar engages')
  assert.ok(
    minAmbientAtTop < baselineAmbient * 0.35 &&
      minHemiAtTop < baselineHemi * 0.35 &&
      maxFogAtTop > baselineFogDensity * 1.8,
    `Upper shaft progressively darkens scene lighting and deepens fog (ambient ${baselineAmbient.toFixed(3)}->${minAmbientAtTop.toFixed(3)}, hemi ${baselineHemi.toFixed(3)}->${minHemiAtTop.toFixed(3)})`
  )

  // Verify resetCombat restores baseline environment lighting & fog density cleanly
  engine.resetCombat()
  assert.ok(
    Math.abs(env.lights.ambientLight.intensity - baselineAmbient) < 1e-5 &&
      Math.abs(env.lights.hemiLight.intensity - baselineHemi) < 1e-5 &&
      Math.abs(env.lights.directionalLight.intensity - baselineDir) < 1e-5 &&
      Math.abs(env.fog.density - baselineFogDensity) < 1e-6,
    'resetCombat restores exact baseline lighting and fog after upper-shaft extraction darkness'
  )

  engine.dispose()
  console.log('✓ Continuous cables, strict door-before-lock sequence, progressive shaft darkness & High Contrast cabin outline verified')
}

disposeAllSharedPools()
assert.equal(
  getActiveSharedPoolOwnerCount(),
  0,
  'Zero active shared pool owners leak after extraction test suite'
)

console.log('ALL PHASE 3 EMERGENCY EXTRACTION ANIMATION TESTS PASSED ✓')
