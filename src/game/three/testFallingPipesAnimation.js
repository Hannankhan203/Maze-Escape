/**
 * Comprehensive Automated Verification Suite for MAZE-HAZARD-PIPES-ANIM-006:
 * Complete Physical Pickup, Carrying, 4-Direction WASD Movement, and Placement Animations
 * for Falling Pipes & Fixtures hazard in Maze Escape.
 */

import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  PIPES_HANDLING_STATES,
  PIPES_ANIM_MODES,
} from './FallingPipesController.js'
import { createViewportPointerController } from './viewportPointerCapture.js'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed += 1
    console.log(`  ✓ PASS: ${message}`)
  } else {
    failed += 1
    console.error(`  ✗ FAIL: ${message}`)
  }
}

function createMockHost(width = 960, height = 540) {
  const listeners = new Map()
  return {
    clientWidth: width,
    clientHeight: height,
    children: [],
    getBoundingClientRect() {
      return { left: 0, top: 0, width, height }
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(listener)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type)
      if (list) {
        const idx = list.indexOf(listener)
        if (idx >= 0) list.splice(idx, 1)
      }
    },
    dispatchEvent(event) {
      const list = listeners.get(event.type)
      if (list) {
        for (let i = 0; i < list.length; i += 1) {
          list[i](event)
        }
      }
    },
    appendChild(child) {
      this.children.push(child)
      child.parentNode = this
    },
    removeChild(child) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) this.children.splice(idx, 1)
      child.parentNode = null
    },
  }
}

function createHeadlessEngine(config = {}) {
  const host = createMockHost()
  const engine = new MazeSceneEngine(host, {
    isSoftwareGl: true,
    skipSpawnSequence: true,
    enemies: { autoSpawn: false },
    createRenderer: () => ({
      domElement: { style: {}, parentNode: null },
      shadowMap: { enabled: false, type: null, needsUpdate: false },
      info: {
        render: { calls: 0, triangles: 0 },
        memory: { geometries: 0, textures: 0 },
      },
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 1.0,
      setPixelRatio() {},
      setSize() {},
      render() {},
      dispose() {},
    }),
    ...config,
  })
  return { engine, host }
}

function buildCorridorMaze() {
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  const maze = {
    rows: 7,
    cols: 11,
    cellSize: CELL_SIZE,
    start: { row: 2, col: 2 },
    exit: { row: 2, col: 8 },
    grid: [
      [W, W, W, W, W, W, W, W, W, W, W],
      [W, P, P, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, P, P, W],
      [W, W, W, W, W, W, W, W, W, W, W],
    ],
  }
  return maze
}

function stepControllerAndAnimator(engine, totalSec, dt = 0.016, isFirstPerson = false) {
  const steps = Math.max(1, Math.round(totalSec / dt))
  const stepDt = totalSec / steps
  for (let i = 0; i < steps; i += 1) {
    engine.pipesController.update(stepDt)
    engine._playerAnimator.update(stepDt, {
      moved: false,
      actualSpeed: 0,
      rubble: null,
      furniture: null,
      pipes: engine.pipesController.getAnimatorPayload(),
      isFirstPerson,
    })
    engine.pipesController.syncCarriedMeshToHands()
  }
}

export function runFallingPipesAnimationTests() {
  console.log('=== Running MAZE-HAZARD-PIPES-ANIM-006 Automated Verification Suite ===\n')

  const maze = buildCorridorMaze()
  const { engine, host } = createHeadlessEngine()
  engine.setMaze(maze)

  // Add fallen pipe hazard at cell (2, 4)
  const pipeHaz = engine.hazardManager.addHazard({
    type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    row: 2,
    col: 4,
    wallSide: 'north',
  })

  // Collapse the pipe so it rests fallen on the corridor floor
  const pipeWorld = gridToWorld(2, 4, maze)
  pipeHaz.update(0.05, {
    playerWorldPos: { x: pipeWorld.x, y: 0, z: pipeWorld.z },
    playerGridCell: { row: 2, col: 4 },
  })
  for (let i = 0; i < 45; i += 1) {
    pipeHaz.update(0.06, {
      playerWorldPos: { x: pipeWorld.x - 10, y: 0, z: pipeWorld.z - 10 },
      playerGridCell: { row: 1, col: 1 },
    })
  }
  engine._syncHazardColliders?.({ allowPushOut: false })

  // Position player standing in front of fallen pipe facing North (yaw = 0)
  engine._playerWorldPos.x = pipeWorld.x
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = pipeWorld.z + 1.2
  if (engine._playerGroup) {
    engine._playerGroup.position.set(pipeWorld.x, 0, pipeWorld.z + 1.2)
    engine._playerGroup.rotation.y = 0
  }
  engine.cameraRig.setLookDirection(0, -0.25)
  engine.cameraRig.update(0, { immediate: true })
  engine.camera.position.set(pipeWorld.x, 1.7, pipeWorld.z + 2.5)
  engine.camera.lookAt(pipeWorld.x, 0.2, pipeWorld.z)
  engine.camera.updateMatrixWorld(true)

  const pointerCtrl = createViewportPointerController({
    canvasHost: host,
    doc: {
      pointerLockElement: null,
      addEventListener() {},
      removeEventListener() {},
    },
    getEngine: () => engine,
    getLatestProps: () => ({
      controlsEnabled: true,
      hasWon: false,
      isGameOver: false,
      isArrivalLocked: false,
    }),
  })
  pointerCtrl.attach()

  // -------------------------------------------------------------
  // Test 1: Procedural pickup animation channels & phase curves on left-click
  // -------------------------------------------------------------
  pointerCtrl.handlePointerDown({
    type: 'pointerdown',
    button: 0,
    clientX: 480,
    clientY: 270,
    pointerType: 'mouse',
    preventDefault() {},
  })
  pointerCtrl.handlePointerUp({
    type: 'pointerup',
    button: 0,
    clientX: 480,
    clientY: 270,
    pointerType: 'mouse',
    preventDefault() {},
  })

  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.GRIPPING,
    'Req 1A: Left-click initiates GRIPPING state'
  )

  // Step through anticipation & reach phase (total ~ 0.16s < 0.22s attach threshold)
  stepControllerAndAnimator(engine, 0.16, 0.016, false)
  const pState1 = engine._playerAnimator.getPipesState()
  const reachLeftShoulderX = engine._playerAnimator.rig.leftShoulderPivot.rotation.x
  assert(
    pState1.pipesMode === PIPES_ANIM_MODES.PICKUP &&
      pState1.pipesBlend > 0.8 &&
      pState1.pipesCrouch > 0.4 &&
      pState1.pipesReach > 0.4,
    'Req 1B: Player crouches, leans forward, and reaches arms down during pickup anticipation'
  )

  // -------------------------------------------------------------
  // Test 2 & 3: Pipe mesh visibly rises into hands; zero movement before hand contact
  // -------------------------------------------------------------
  const pipeGroup = pipeHaz.mesh.userData.pipeGroup
  const startWorldPos = new THREE.Vector3()
  pipeGroup.getWorldPosition(startWorldPos)

  // Before contact (progress < contactProgress, gripAttached is false)
  engine.pipesController.syncCarriedMeshToHands()
  const midWorldPos = new THREE.Vector3()
  pipeGroup.getWorldPosition(midWorldPos)
  assert(
    Math.abs(midWorldPos.y - startWorldPos.y) < 1e-4,
    'Req 3: Zero movement of pipe before hand attach contact moment'
  )

  // Advance past attach contact moment (+0.16s -> total 0.32s >= 0.221s attach threshold)
  stepControllerAndAnimator(engine, 0.16, 0.016, false)
  assert(
    engine.pipesController.isGripAttached() === true,
    'Req 2A: Hands attach to pipe at contact progress threshold'
  )

  pipeGroup.getWorldPosition(midWorldPos)
  assert(
    midWorldPos.y > startWorldPos.y + 0.1,
    'Req 2B: Pipe visibly rises upward from floor into character hands'
  )

  // -------------------------------------------------------------
  // Test 4: Slower, heavier lift for industrial pipes vs agile lift for fixtures
  // -------------------------------------------------------------
  const heavyDuration = engine.pipesController.getPickupDuration()
  pipeHaz.isSmallFixture = true
  const fixtureDuration = engine.pipesController.getPickupDuration()
  pipeHaz.isSmallFixture = false
  assert(
    heavyDuration > fixtureDuration && heavyDuration >= 0.40,
    'Req 4: Industrial heavy pipes have slower, heavier lift duration than agile fixtures'
  )

  // -------------------------------------------------------------
  // Test 5: Continuous hand-to-pipe attachment & distinct carrying posture
  // -------------------------------------------------------------
  stepControllerAndAnimator(engine, 0.20, 0.016, false) // Reach HANDLING state
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.HANDLING,
    'Req 5A: Controller enters HANDLING (carry) state'
  )

  const carryState = engine._playerAnimator.getPipesState()
  const carryLeftShoulderX = engine._playerAnimator.rig.leftShoulderPivot.rotation.x
  assert(
    carryState.pipesCarry > 0.8 &&
      carryState.pipesCrouch < 0.2 &&
      Math.abs(carryLeftShoulderX - reachLeftShoulderX) > 0.15,
    'Req 5B: Carrying posture is upright cradle and distinct from initial downward pickup reach'
  )

  const carryPose1 = new THREE.Vector3()
  pipeGroup.getWorldPosition(carryPose1)

  // Rotate camera & player group yaw by 45 degrees and verify continuous hand-to-pipe follow
  engine.cameraRig.setLookDirection(Math.PI * 0.25, -0.15)
  engine._playerGroup.rotation.y = Math.PI * 0.25
  stepControllerAndAnimator(engine, 0.032, 0.016, false)
  const carryPose2 = new THREE.Vector3()
  pipeGroup.getWorldPosition(carryPose2)
  const contactsRotated = engine.pipesController.getHandContactPoints()
  const handMidX =
    (contactsRotated.leftHandWorld.x + contactsRotated.rightHandWorld.x) * 0.5
  const handMidZ =
    (contactsRotated.leftHandWorld.z + contactsRotated.rightHandWorld.z) * 0.5
  assert(
    Math.hypot(carryPose2.x - carryPose1.x, carryPose2.z - carryPose1.z) > 0.05 &&
      Math.hypot(carryPose2.x - handMidX, carryPose2.z - handMidZ) < 0.05,
    'Req 5C: Carried pipe continuously follows character rotation locked to both hands'
  )

  // -------------------------------------------------------------
  // Test 6 & 7: Full 4-direction engine.stepMovement WASD + backward S symmetry (ZERO sideways teleport)
  // -------------------------------------------------------------
  engine.cameraRig.setMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.cameraRig.setThirdPersonMode('character-follow')
  engine.cameraRig.setLookDirection(0, -0.15)
  engine.cameraRig.update(0, { immediate: true })
  engine._playerGroup.rotation.y = 0

  // Move Forward (W) via engine.stepMovement
  const startWx = engine._playerWorldPos.x
  const startWz = engine._playerWorldPos.z
  for (let i = 0; i < 15; i += 1) {
    engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.016)
  }
  const postW = { x: engine._playerWorldPos.x, z: engine._playerWorldPos.z }
  const pipePosW = new THREE.Vector3()
  pipeGroup.getWorldPosition(pipePosW)
  assert(
    postW.z < startWz - 0.15 &&
      Math.abs(postW.x - startWx) < 0.02 &&
      Math.hypot(pipePosW.x - postW.x, pipePosW.z - (postW.z - 0.5)) < 0.45,
    'Req 6A: Forward (W) engine.stepMovement translates player and carried pipe forward synchronously'
  )

  // Move Right (D) via engine.stepMovement
  for (let i = 0; i < 15; i += 1) {
    engine.stepMovement({ forwardAxis: 0, strafeAxis: 1, sprint: false }, 0.016)
  }
  const postD = { x: engine._playerWorldPos.x, z: engine._playerWorldPos.z }
  const pipePosD = new THREE.Vector3()
  pipeGroup.getWorldPosition(pipePosD)
  assert(
    postD.x > postW.x + 0.15 &&
      Math.abs(postD.z - postW.z) < 0.02 &&
      Math.abs(pipePosD.x - postD.x) < 0.25,
    'Req 6B: Right strafe (D) engine.stepMovement moves player and carried pipe right synchronously'
  )

  // Move Left (A) via engine.stepMovement
  for (let i = 0; i < 15; i += 1) {
    engine.stepMovement({ forwardAxis: 0, strafeAxis: -1, sprint: false }, 0.016)
  }
  const postA = { x: engine._playerWorldPos.x, z: engine._playerWorldPos.z }
  assert(
    postA.x < postD.x - 0.15 && Math.abs(postA.z - postD.z) < 0.02,
    'Req 6C: Left strafe (A) engine.stepMovement moves player and carried pipe left synchronously'
  )

  // CRITICAL BACKWARD (S) BUG TEST: 30 frames of holding S must move strictly +Z, ZERO sideways X teleport!
  const preBackX = engine._playerWorldPos.x
  const preBackZ = engine._playerWorldPos.z
  for (let i = 0; i < 30; i += 1) {
    engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.016)
  }
  const postBackX = engine._playerWorldPos.x
  const postBackZ = engine._playerWorldPos.z
  const pipePosS = new THREE.Vector3()
  pipeGroup.getWorldPosition(pipePosS)
  assert(
    postBackZ > preBackZ + 0.4 &&
      Math.abs(postBackX - preBackX) < 0.02 &&
      Math.abs(pipePosS.x - postBackX) < 0.25 &&
      pipePosS.z < postBackZ,
    'Req 7: Backward movement (S) moves player and pipe strictly backward without any sideways teleportation'
  )

  // -------------------------------------------------------------
  // Test 8: Right-click initiates side placement animation (turn toward side, knees bend, lower to floor, release)
  // -------------------------------------------------------------
  const prePlacePlayerPos = { ...engine._playerWorldPos }
  pointerCtrl.handlePointerDown({
    type: 'pointerdown',
    button: 2,
    clientX: 480,
    clientY: 270,
    pointerType: 'mouse',
    preventDefault() {},
  })

  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.RELEASING,
    'Req 8A: Right-click initiates RELEASING (side placement) animation state'
  )

  // Advance lowering phase (total ~ 0.14s < 0.177s release threshold)
  stepControllerAndAnimator(engine, 0.14, 0.016, false)
  const pStatePlace = engine._playerAnimator.getPipesState()
  assert(
    pStatePlace.pipesMode === PIPES_ANIM_MODES.PLACE &&
      pStatePlace.pipesCrouch > 0.4 &&
      pStatePlace.pipesReach > 0.4 &&
      Math.abs(pStatePlace.pipesPlaceTurn) > 0.05,
    'Req 8B: Character turns subtly toward side target, bends knees, and lowers pipe toward floor'
  )

  // -------------------------------------------------------------
  // Test 9: Placed pipe sits neatly to the side, stays solid with updated collider matching final transform
  // -------------------------------------------------------------
  stepControllerAndAnimator(engine, 0.26, 0.016, false) // Complete 0.34s placement -> IDLE
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.IDLE,
    'Req 9A: Controller completes placement and returns to IDLE'
  )

  const placedPose = pipeHaz.getPipesPose()
  const finalMeshPos = new THREE.Vector3()
  pipeGroup.getWorldPosition(finalMeshPos)
  const placedCollider = pipeHaz
    .getColliderSpecs()
    .find((c) => c.phase === 'aftermath')
  assert(
    pipeHaz.pipesHandlingState === 'placed' &&
      Math.abs(placedPose.worldCx - prePlacePlayerPos.x) > 0.6 &&
      Math.hypot(placedPose.worldCx - finalMeshPos.x, placedPose.worldCz - finalMeshPos.z) < 0.05 &&
      placedCollider?.enabled === true &&
      Math.hypot(placedCollider.cx - finalMeshPos.x, placedCollider.cz - finalMeshPos.z) < 0.05,
    'Req 9B: Pipe placed to the side has solid updated collider matching final world mesh transform'
  )

  // -------------------------------------------------------------
  // Test 10: Placed pipe can be targeted and picked up again
  // -------------------------------------------------------------
  engine._playerWorldPos.x = placedPose.worldCx
  engine._playerWorldPos.z = placedPose.worldCz + 1.25
  if (engine._playerGroup) {
    engine._playerGroup.position.set(placedPose.worldCx, 0, placedPose.worldCz + 1.25)
    engine._playerGroup.rotation.y = 0
  }
  engine.cameraRig.setLookDirection(0, -0.25)
  engine.cameraRig.update(0, { immediate: true })
  engine.camera.position.set(placedPose.worldCx, 1.7, placedPose.worldCz + 2.4)
  engine.camera.lookAt(placedPose.worldCx, 0.2, placedPose.worldCz)
  engine.camera.updateMatrixWorld(true)

  const reTarget = engine.pipesController.updateTargeting({ x: 0, y: 0 })
  assert(
    reTarget !== null && reTarget.hazard.id === pipeHaz.id,
    'Req 10A: Placed pipe is actively targetable by crosshair'
  )

  const reGrip = engine.pipesController.tryGripTarget({ x: 0, y: 0 })
  assert(
    reGrip.handled === true &&
      engine.pipesController.getStateName() === PIPES_HANDLING_STATES.GRIPPING,
    'Req 10B: Player can pick up the placed pipe again from its new side floor position'
  )

  // -------------------------------------------------------------
  // Test 11: Slower, heavier placement for industrial pipes vs agile fixtures
  // -------------------------------------------------------------
  const heavyPlaceDur = engine.pipesController.getPlaceDuration()
  pipeHaz.isSmallFixture = true
  const fixturePlaceDur = engine.pipesController.getPlaceDuration()
  pipeHaz.isSmallFixture = false
  assert(
    heavyPlaceDur > fixturePlaceDur && heavyPlaceDur >= 0.30,
    'Req 11: Industrial heavy pipes have slower placement duration than agile fixtures'
  )

  // -------------------------------------------------------------
  // Test 12: First-Person camera mode support (arms visible, eye offset during crouch)
  // -------------------------------------------------------------
  engine.cameraRig.setMode(CAMERA_MODES.FIRST_PERSON, { immediate: true })
  engine.syncPlayerVisibility()
  const eyeOffset = engine.pipesController.getFirstPersonEyeOffsetY()
  assert(
    eyeOffset < -0.05,
    'Req 12A: First-person camera applies downward eye offset during lift crouch'
  )
  stepControllerAndAnimator(engine, 0.08, 0.016, true)
  const rig = engine._playerAnimator.rig
  assert(
    rig.leftShoulderPivot.position.z < -0.05 &&
      engine._playerGroup.visible === true,
    'Req 12B: Articulated arms shift forward and remain visible in first-person handling'
  )

  // -------------------------------------------------------------
  // Test 13: Third-Person Follow view support (hands attached through full lift -> carry)
  // -------------------------------------------------------------
  engine.cameraRig.setMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.cameraRig.setThirdPersonMode('character-follow')
  stepControllerAndAnimator(engine, 0.45, 0.016, false) // Finish into HANDLING
  const contacts = engine.pipesController.getHandContactPoints()
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.HANDLING &&
      contacts.gripAttached === true &&
      Number.isFinite(contacts.leftHandWorld.x) &&
      Number.isFinite(contacts.rightHandWorld.x),
    'Req 13: Third-Person Follow enters carry and attaches left and right hand contact points'
  )

  // -------------------------------------------------------------
  // Test 14: Third-Person Free Look mode support (4-direction movement turns character cleanly)
  // -------------------------------------------------------------
  engine.cameraRig.setThirdPersonMode('free-look')
  const freeLookActive = Boolean(engine.cameraRig.isFreeLookActive?.())
  const freePreX = engine._playerWorldPos.x
  for (let i = 0; i < 12; i += 1) {
    engine.stepMovement({ forwardAxis: 0, strafeAxis: 1, sprint: false }, 0.016)
  }
  assert(
    freeLookActive === true &&
      engine._playerWorldPos.x > freePreX + 0.1 &&
      engine.pipesController.isHandling(),
    'Req 14: Free look maintains coupled character rotation and pipe movement cleanly'
  )
  engine.cameraRig.setThirdPersonMode('character-follow')

  // -------------------------------------------------------------
  // Test 15: Safe WASD interruption before attach & immediate interruption recovery
  // -------------------------------------------------------------
  const interrupted = engine.pipesController.interruptHandling({ immediate: true })
  assert(
    interrupted === true &&
      engine.pipesController.getStateName() === PIPES_HANDLING_STATES.IDLE &&
      engine.pipesController.getActiveHazard() === null,
    'Req 15A: Interrupt handling resets state machine safely to IDLE without corrupting state'
  )

  // Pre-attach WASD cancel check: aim at pipe, grip, immediately press W before attach
  const curPose15 = pipeHaz.getPipesPose()
  engine._playerWorldPos.x = curPose15.worldCx
  engine._playerWorldPos.z = curPose15.worldCz + 1.25
  engine.camera.position.set(curPose15.worldCx, 1.7, curPose15.worldCz + 2.4)
  engine.camera.lookAt(curPose15.worldCx, 0.2, curPose15.worldCz)
  engine.camera.updateMatrixWorld(true)
  engine.pipesController.tryGripTarget({ x: 0, y: 0 })
  engine.pipesController.update(0.05) // pre-attach
  const preCancelPos = engine._playerWorldPos.z
  engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.016)
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.IDLE &&
      engine._playerWorldPos.z < preCancelPos,
    'Req 15B: WASD before hand-attach cleanly cancels pickup and allows immediate movement'
  )

  // -------------------------------------------------------------
  // Test 16: Dynamic sound emission during pickup, carry movement, and placement
  // -------------------------------------------------------------
  let soundsEmitted = 0
  engine.emitSound = () => {
    soundsEmitted += 1
  }
  engine._playerWorldPos.x = curPose15.worldCx
  engine._playerWorldPos.z = curPose15.worldCz + 1.25
  engine.camera.position.set(curPose15.worldCx, 1.7, curPose15.worldCz + 2.4)
  engine.camera.lookAt(curPose15.worldCx, 0.2, curPose15.worldCz)
  engine.camera.updateMatrixWorld(true)
  engine.pipesController.tryGripTarget({ x: 0, y: 0 })
  stepControllerAndAnimator(engine, 0.50, 0.016, false) // Attach sound + enter HANDLING
  engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.016) // Movement sound
  engine.pipesController.tryRelease()
  stepControllerAndAnimator(engine, 0.40, 0.016, false) // Placement sound + return to IDLE
  assert(
    soundsEmitted >= 2 &&
      engine.pipesController.getStateName() === PIPES_HANDLING_STATES.IDLE,
    'Req 16: Sounds emitted during pickup lift, carry movement, and placement'
  )

  // -------------------------------------------------------------
  // Test 17: Sprint is disabled & carry speed scaled properly
  // -------------------------------------------------------------
  const poseAfter16 = pipeHaz.getPipesPose()
  engine._playerWorldPos.x = poseAfter16.worldCx
  engine._playerWorldPos.z = poseAfter16.worldCz + 1.25
  engine.camera.position.set(poseAfter16.worldCx, 1.7, poseAfter16.worldCz + 2.4)
  engine.camera.lookAt(poseAfter16.worldCx, 0.2, poseAfter16.worldCz)
  engine.camera.updateMatrixWorld(true)
  engine.pipesController.tryGripTarget({ x: 0, y: 0 })
  stepControllerAndAnimator(engine, 0.50, 0.016, false)
  assert(
    engine.pipesController.isSprintDisabled() === true,
    'Req 17A: Sprinting is strictly disabled during pipe handling'
  )
  const speedScale = engine.pipesController.getMovementSpeedScale()
  assert(
    speedScale < 1.0 && speedScale > 0.4,
    'Req 17B: Movement speed is appropriately scaled for heavy physical carrying'
  )

  // -------------------------------------------------------------
  // Test 18: Per-frame 60-frame update loop executes cleanly without drift/errors
  // -------------------------------------------------------------
  for (let f = 0; f < 60; f += 1) {
    engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.016)
    engine.pipesController.update(0.016)
    engine.pipesController.syncCarriedMeshToHands()
  }

  assert(
    engine.pipesController.isHandling(),
    'Req 18: Full 60-frame carry and animation loop executes cleanly without error'
  )

  // Cleanup first harness before running ANIM-008 orientation scenarios
  pointerCtrl.detach()
  engine.pipesController.interruptHandling({ immediate: true })
  engine.dispose()

  // =============================================================
  // MAZE-HAZARD-PIPES-ANIM-008 — Orientation Preservation Suite
  // =============================================================
  console.log('\n--- Running MAZE-HAZARD-PIPES-ANIM-008 Orientation Preservation Tests ---')

  const getPipeAxisXZ = (group) => {
    const q = new THREE.Quaternion()
    group.updateMatrixWorld(true)
    group.getWorldQuaternion(q)
    return new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize()
  }

  // Test 19: Left-to-right pipe picked up, moved near wall, camera rotated in Free Look, placed beside wall -> stays left-to-right!
  {
    const { engine: eng19, host: host19 } = createHeadlessEngine()
    const maze19 = buildCorridorMaze()
    eng19.setMaze(maze19)
    const haz19 = eng19.hazardManager.addHazard({
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 2,
      col: 5,
      wallSide: 'west',
      pipeYaw: 0,
    })
    const hw19 = gridToWorld(2, 5, maze19)
    haz19.update(0.05, { playerWorldPos: { x: hw19.x, y: 0, z: hw19.z }, playerGridCell: { row: 2, col: 5 } })
    for (let i = 0; i < 45; i += 1) {
      haz19.update(0.06, { playerWorldPos: { x: hw19.x - 10, y: 0, z: hw19.z - 10 }, playerGridCell: { row: 1, col: 1 } })
    }
    eng19._syncHazardColliders?.({ allowPushOut: false })

    eng19._playerWorldPos.x = hw19.x; eng19._playerWorldPos.y = 0; eng19._playerWorldPos.z = hw19.z + 1.2
    eng19._playerGroup.position.set(hw19.x, 0, hw19.z + 1.2)
    eng19._playerGroup.rotation.y = 0
    eng19.cameraRig.setMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
    eng19.cameraRig.setThirdPersonMode('free-look')
    eng19.cameraRig.setLookDirection(0, -0.25)
    eng19.cameraRig.update(0, { immediate: true })
    eng19.camera.position.set(hw19.x, 1.7, hw19.z + 2.4)
    eng19.camera.lookAt(hw19.x, 0.2, hw19.z)
    eng19.camera.updateMatrixWorld(true)

    const pg19 = haz19.mesh.userData.pipeGroup
    const initAxis = getPipeAxisXZ(pg19)
    assert(
      Math.abs(initAxis.x) > 0.98 && Math.abs(initAxis.z) < 0.1,
      'Req 19A: Fallen pipe starts horizontally left-to-right across corridor'
    )

    eng19.pipesController.tryGripTarget({ x: 0, y: 0 })
    stepControllerAndAnimator(eng19, 0.50, 0.016, false)

    // Orbit Free Look camera significantly; camera movement alone must NOT rotate pipe
    const carryAxisBeforeCam = getPipeAxisXZ(pg19)
    eng19.applyLookDelta(420, 60)
    eng19.cameraRig.update(0.016)
    stepControllerAndAnimator(eng19, 0.064, 0.016, false)
    const carryAxisAfterCam = getPipeAxisXZ(pg19)
    assert(
      Math.abs(carryAxisBeforeCam.x - carryAxisAfterCam.x) < 1e-3 &&
        Math.abs(carryAxisBeforeCam.z - carryAxisAfterCam.z) < 1e-3 &&
        Math.abs(carryAxisAfterCam.x) > 0.98,
      'Req 19B: Camera rotation alone (Free Look) does not rotate the carried pipe'
    )

    // Move toward North wall using W/D/S (in Character-Follow so character facing stays North)
    eng19.cameraRig.setThirdPersonMode('character-follow')
    eng19.cameraRig.setLookDirection(0, -0.2)
    eng19.cameraRig.update(0, { immediate: true })
    for (let i = 0; i < 20; i += 1) {
      eng19.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.016)
    }
    for (let i = 0; i < 10; i += 1) {
      eng19.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.016)
    }
    const carryAxisAfterMove = getPipeAxisXZ(pg19)
    assert(
      Math.abs(carryAxisAfterMove.x) > 0.98 && Math.abs(carryAxisAfterMove.z) < 0.1,
      'Req 19C: Carried pipe preserves left-to-right orientation across forward/backward movement'
    )

    // Right-click placement beside wall: MUST stay left-to-right (NOT rotate 90° front-to-back)
    const rel19 = eng19.pipesController.tryRelease()
    assert(rel19.handled === true, 'Req 19D: Placement succeeds beside wall')
    stepControllerAndAnimator(eng19, 0.42, 0.016, false)

    const placedAxis19 = getPipeAxisXZ(pg19)
    const placedCol19 = haz19.getColliderSpecs().find((c) => c.phase === 'aftermath')
    const colAxisX19 = Math.cos(placedCol19.yaw)
    const colAxisZ19 = -Math.sin(placedCol19.yaw)
    assert(
      Math.abs(placedAxis19.x) > 0.98 &&
        Math.abs(placedAxis19.z) < 0.1 &&
        Math.abs(Math.abs(placedAxis19.x * colAxisX19 + placedAxis19.z * colAxisZ19) - 1) < 1e-3,
      'Req 19E: Placed pipe preserves left-to-right orientation and OBB collider yaw matches mesh identically'
    )

    // Verify placed pipe collider is active along its left-to-right X span and re-pickup works
    const pose19 = haz19.getPipesPose()
    eng19._playerWorldPos.x = pose19.worldCx + 1.4
    eng19._playerWorldPos.y = 0
    eng19._playerWorldPos.z = pose19.worldCz + 1.02
    const stepOnPipe = eng19.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.05)
    assert(
      stepOnPipe.traversingPipe === true ||
        stepOnPipe.steppedOverProp === true ||
        stepOnPipe.collided === true,
      'Req 19F: Placed pipe OBB collider remains active along its left-to-right span'
    )

    eng19._playerWorldPos.x = pose19.worldCx
    eng19._playerWorldPos.y = 0
    eng19._playerWorldPos.z = pose19.worldCz + 1.25
    eng19._playerGroup.position.set(pose19.worldCx, 0, pose19.worldCz + 1.25)
    eng19.camera.position.set(pose19.worldCx, 1.7, pose19.worldCz + 2.4)
    eng19.camera.lookAt(pose19.worldCx, 0.2, pose19.worldCz)
    eng19.camera.updateMatrixWorld(true)
    const reGrip19 = eng19.pipesController.tryGripTarget({ x: 0, y: 0 })
    assert(reGrip19.handled === true, 'Req 19G: Placed pipe can still be targeted and picked up again')

    void host19
    eng19.dispose()
  }

  // Test 20: Narrow 1-tile (4.0m) N-S corridor wall-adjacent placement preserves left-to-right orientation
  {
    const W = CELL_TYPES.WALL
    const P = CELL_TYPES.PATH
    const narrowNsMaze = {
      rows: 7,
      cols: 3,
      cellSize: CELL_SIZE,
      start: { row: 5, col: 1 },
      exit: { row: 1, col: 1 },
      grid: [
        [W, W, W],
        [W, P, W],
        [W, P, W],
        [W, P, W],
        [W, P, W],
        [W, P, W],
        [W, W, W],
      ],
    }
    const { engine: eng20 } = createHeadlessEngine()
    eng20.setMaze(narrowNsMaze)
    const haz20 = eng20.hazardManager.addHazard({
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 3,
      col: 1,
      wallSide: 'west',
      pipeYaw: 0,
    })
    const hw20 = gridToWorld(3, 1, narrowNsMaze)
    haz20.update(0.05, { playerWorldPos: { x: hw20.x, y: 0, z: hw20.z }, playerGridCell: { row: 3, col: 1 } })
    for (let i = 0; i < 45; i += 1) {
      haz20.update(0.06, { playerWorldPos: { x: hw20.x, y: 0, z: hw20.z + 8 }, playerGridCell: { row: 5, col: 1 } })
    }
    eng20._syncHazardColliders?.({ allowPushOut: false })

    // Stand near East corridor wall (x = hw20.x + 1.15) facing North
    eng20._playerWorldPos.x = hw20.x + 1.15
    eng20._playerWorldPos.y = 0
    eng20._playerWorldPos.z = hw20.z + 1.1
    eng20._playerGroup.position.set(hw20.x + 1.15, 0, hw20.z + 1.1)
    eng20._playerGroup.rotation.y = 0
    eng20.cameraRig.setLookDirection(0, -0.25)
    eng20.cameraRig.update(0, { immediate: true })
    eng20.camera.position.set(hw20.x + 1.15, 1.7, hw20.z + 2.2)
    eng20.camera.lookAt(hw20.x + 0.6, 0.2, hw20.z)
    eng20.camera.updateMatrixWorld(true)

    eng20.pipesController.tryGripTarget({ x: 0, y: 0 })
    stepControllerAndAnimator(eng20, 0.50, 0.016, false)
    const rel20 = eng20.pipesController.tryRelease()
    stepControllerAndAnimator(eng20, 0.42, 0.016, false)

    const pg20 = haz20.mesh.userData.pipeGroup
    const placedAxis20 = getPipeAxisXZ(pg20)
    const placedCol20 = haz20.getColliderSpecs().find((c) => c.phase === 'aftermath')
    assert(
      rel20.handled === true &&
        Math.abs(placedAxis20.x) > 0.98 &&
        Math.abs(placedAxis20.z) < 0.1 &&
        Math.abs(Math.cos(placedCol20.yaw)) > 0.98,
      'Req 20: Narrow 4m corridor wall-adjacent placement preserves left-to-right orientation instead of rotating 90 degrees'
    )
    eng20.dispose()
  }

  // Test 21: Alternate initial orientation (pipeYaw = Math.PI * 0.5 in E-W corridor) & opposite-side pickup (zero 180° spin)
  {
    const { engine: eng21 } = createHeadlessEngine()
    const maze21 = buildCorridorMaze()
    eng21.setMaze(maze21)
    const haz21 = eng21.hazardManager.addHazard({
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 3,
      col: 5,
      wallSide: 'south',
      pipeYaw: Math.PI * 0.5,
    })
    const hw21 = gridToWorld(3, 5, maze21)
    haz21.update(0.05, { playerWorldPos: { x: hw21.x, y: 0, z: hw21.z }, playerGridCell: { row: 3, col: 5 } })
    for (let i = 0; i < 45; i += 1) {
      haz21.update(0.06, { playerWorldPos: { x: hw21.x - 10, y: 0, z: hw21.z - 10 }, playerGridCell: { row: 1, col: 1 } })
    }
    eng21._syncHazardColliders?.({ allowPushOut: false })

    // Player approaches from West facing East (yaw = -Math.PI * 0.5, opposite side of pipeYaw = +Math.PI/2)
    eng21._playerWorldPos.x = hw21.x - 1.2
    eng21._playerWorldPos.y = 0
    eng21._playerWorldPos.z = hw21.z
    eng21._playerGroup.position.set(hw21.x - 1.2, 0, hw21.z)
    eng21._playerGroup.rotation.y = -Math.PI * 0.5
    eng21.cameraRig.setLookDirection(-Math.PI * 0.5, -0.25)
    eng21.cameraRig.update(0, { immediate: true })
    eng21.camera.position.set(hw21.x - 2.2, 1.7, hw21.z)
    eng21.camera.lookAt(hw21.x, 0.2, hw21.z)
    eng21.camera.updateMatrixWorld(true)

    const pg21 = haz21.mesh.userData.pipeGroup
    const initAxis21 = getPipeAxisXZ(pg21)
    eng21.pipesController.tryGripTarget({ x: 0, y: 0 })

    // Mid-lift check: axis must NOT spin sideways during pickup
    stepControllerAndAnimator(eng21, 0.34, 0.016, false)
    const midLiftAxis21 = getPipeAxisXZ(pg21)
    assert(
      Math.abs(midLiftAxis21.x * initAxis21.x + midLiftAxis21.z * initAxis21.z) > 0.96,
      'Req 21A: Opposite-side pickup lifts smoothly without 180-degree spin or sideways rotation'
    )

    stepControllerAndAnimator(eng21, 0.20, 0.016, false)
    const rel21 = eng21.pipesController.tryRelease()
    stepControllerAndAnimator(eng21, 0.42, 0.016, false)
    const placedAxis21 = getPipeAxisXZ(pg21)
    assert(
      rel21.handled === true &&
        Math.abs(placedAxis21.z) > 0.98 &&
        Math.abs(placedAxis21.x) < 0.1,
      'Req 21B: Alternate pipeYaw=PI/2 orientation is preserved during carry and placement (not hardcoded to 0)'
    )
    eng21.dispose()
  }

  // Test 22: Strict clearance fallback rotates 90° ONLY when carried orientation is physically blocked everywhere
  {
    const W = CELL_TYPES.WALL
    const P = CELL_TYPES.PATH
    // Single-tile N-S corridor where player carries a pipe rotated 90° relative to corridor (wait: place at yaw=0 vs blocked side props)
    const tightMaze = {
      rows: 5,
      cols: 3,
      cellSize: CELL_SIZE,
      start: { row: 3, col: 1 },
      exit: { row: 1, col: 1 },
      grid: [
        [W, W, W],
        [W, P, W],
        [W, P, W],
        [W, P, W],
        [W, W, W],
      ],
    }
    const { engine: eng22 } = createHeadlessEngine()
    eng22.setMaze(tightMaze)
    const haz22 = eng22.hazardManager.addHazard({
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 2,
      col: 1,
      pipeYaw: 0,
    })
    const hw22 = gridToWorld(2, 1, tightMaze)
    haz22.update(0.05, { playerWorldPos: { x: hw22.x, y: 0, z: hw22.z }, playerGridCell: { row: 2, col: 1 } })
    for (let i = 0; i < 45; i += 1) {
      haz22.update(0.06, { playerWorldPos: { x: hw22.x, y: 0, z: hw22.z + 5 }, playerGridCell: { row: 3, col: 1 } })
    }
    eng22._syncHazardColliders?.({ allowPushOut: false })

    // Stand facing North (yaw = 0) and block the left-right span with flanking prop colliders (3.1m gap < 3.87m pipe)
    eng22._playerWorldPos.x = hw22.x
    eng22._playerWorldPos.y = 0
    eng22._playerWorldPos.z = hw22.z + 1.15
    eng22._playerGroup.position.set(hw22.x, 0, hw22.z + 1.15)
    eng22._playerGroup.rotation.y = 0
    eng22.cameraRig.setLookDirection(0, -0.25)
    eng22.cameraRig.update(0, { immediate: true })
    eng22.camera.position.set(hw22.x, 1.7, hw22.z + 2.2)
    eng22.camera.lookAt(hw22.x, 0.2, hw22.z)
    eng22.camera.updateMatrixWorld(true)

    eng22.pipesController.tryGripTarget({ x: 0, y: 0 })
    stepControllerAndAnimator(eng22, 0.50, 0.016, false)

    // Inject flanking solid prop colliders on West & East sides narrowing corridor to 3.1m wide
    eng22._propCollisionIndex = {
      colliders: [
        {
          id: 'test-blocker-west',
          ownerId: 'test-blocker-west',
          kind: 1,
          enabled: true,
          cx: hw22.x - 1.95,
          cz: hw22.z,
          halfW: 0.4,
          halfD: 5.0,
          yaw: 0,
          minX: hw22.x - 2.35,
          maxX: hw22.x - 1.55,
          minZ: hw22.z - 5.0,
          maxZ: hw22.z + 5.0,
        },
        {
          id: 'test-blocker-east',
          ownerId: 'test-blocker-east',
          kind: 1,
          enabled: true,
          cx: hw22.x + 1.95,
          cz: hw22.z,
          halfW: 0.4,
          halfD: 5.0,
          yaw: 0,
          minX: hw22.x + 1.55,
          maxX: hw22.x + 2.35,
          minZ: hw22.z - 5.0,
          maxZ: hw22.z + 5.0,
        },
      ],
    }

    const fallbackPlacement = eng22.pipesController.findValidPlacement(haz22)
    assert(
      fallbackPlacement.valid === true && Math.abs(Math.sin(fallbackPlacement.yaw)) > 0.98,
      'Req 22: Validated 90-degree fallback still succeeds when carried orientation has insufficient physical clearance'
    )
    eng22.dispose()
  }

  // Test 23: Intentional Left-Side Placement (strafing left / positioned right) places pipe on the left side adjacent to wall
  {
    const { engine: eng23 } = createHeadlessEngine()
    const maze23 = buildCorridorMaze()
    eng23.setMaze(maze23)
    const haz23 = eng23.hazardManager.addHazard({
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 2,
      col: 5,
      wallSide: 'west',
      pipeYaw: 0,
    })
    const hw23 = gridToWorld(2, 5, maze23)
    haz23.update(0.05, { playerWorldPos: { x: hw23.x, y: 0, z: hw23.z }, playerGridCell: { row: 2, col: 5 } })
    for (let i = 0; i < 45; i += 1) {
      haz23.update(0.06, { playerWorldPos: { x: hw23.x - 10, y: 0, z: hw23.z - 10 }, playerGridCell: { row: 1, col: 1 } })
    }
    eng23._syncHazardColliders?.({ allowPushOut: false })

    eng23._playerWorldPos.x = hw23.x + 0.6
    eng23._playerWorldPos.y = 0
    eng23._playerWorldPos.z = hw23.z + 1.2
    eng23._playerGroup.position.set(hw23.x + 0.6, 0, hw23.z + 1.2)
    eng23._playerGroup.rotation.y = 0
    eng23.pipesController.tryGripTarget({ x: 0, y: 0 })
    stepControllerAndAnimator(eng23, 0.50, 0.016, false)

    // Intend left-side placement by setting strafeSign = -1
    eng23.pipesController._strafeSign = -1
    const leftPlacement = eng23.pipesController.findValidPlacement(haz23)
    assert(
      leftPlacement.valid === true && leftPlacement.sideSign === -1 && leftPlacement.x < eng23._playerWorldPos.x - 0.5,
      'Req 23: Intentional left-side placement positions pipe on the left side adjacent to wall with sideSign === -1'
    )
    eng23.dispose()
  }

  // Test 24: Intentional Right-Side Placement (strafing right / positioned left) places pipe on the right side adjacent to wall
  {
    const { engine: eng24 } = createHeadlessEngine()
    const maze24 = buildCorridorMaze()
    eng24.setMaze(maze24)
    const haz24 = eng24.hazardManager.addHazard({
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 2,
      col: 5,
      wallSide: 'west',
      pipeYaw: 0,
    })
    const hw24 = gridToWorld(2, 5, maze24)
    haz24.update(0.05, { playerWorldPos: { x: hw24.x, y: 0, z: hw24.z }, playerGridCell: { row: 2, col: 5 } })
    for (let i = 0; i < 45; i += 1) {
      haz24.update(0.06, { playerWorldPos: { x: hw24.x - 10, y: 0, z: hw24.z - 10 }, playerGridCell: { row: 1, col: 1 } })
    }
    eng24._syncHazardColliders?.({ allowPushOut: false })

    eng24._playerWorldPos.x = hw24.x - 0.6
    eng24._playerWorldPos.y = 0
    eng24._playerWorldPos.z = hw24.z + 1.2
    eng24._playerGroup.position.set(hw24.x - 0.6, 0, hw24.z + 1.2)
    eng24._playerGroup.rotation.y = 0
    eng24.pipesController.tryGripTarget({ x: 0, y: 0 })
    stepControllerAndAnimator(eng24, 0.50, 0.016, false)

    // Intend right-side placement by setting strafeSign = 1
    eng24.pipesController._strafeSign = 1
    const rightPlacement = eng24.pipesController.findValidPlacement(haz24)
    assert(
      rightPlacement.valid === true && rightPlacement.sideSign === 1 && rightPlacement.x > eng24._playerWorldPos.x + 0.5,
      'Req 24: Intentional right-side placement positions pipe on the right side adjacent to wall with sideSign === 1'
    )
    eng24.dispose()
  }

  console.log(`\n=== Falling Pipes Animation Test Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) {
    throw new Error(`Test suite failed with ${failed} failures.`)
  }
}

// Auto-execute if run directly with Node.js
const proc = globalThis.process
if (proc && Array.isArray(proc.argv) && proc.argv[1]?.includes('testFallingPipesAnimation.js')) {
  runFallingPipesAnimationTests()
}
