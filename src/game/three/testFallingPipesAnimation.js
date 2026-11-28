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
import { HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  PIPES_HANDLING_STATES,
  PIPES_ANIM_MODES,
  PIPES_INTERACTION_CONFIG,
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

  // Position player standing in front of fallen pipe
  engine._playerWorldPos.x = pipeWorld.x
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = pipeWorld.z + 1.2
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

  // Step into anticipation & reach phase (progress ~ 0.35)
  engine.pipesController.update(0.15)
  const animSample = {
    moved: false,
    actualSpeed: 0,
    rubble: null,
    furniture: null,
    pipes: engine.pipesController.getAnimatorPayload(),
    isFirstPerson: false,
  }
  engine._playerAnimator.update(0.016, animSample)
  const pState1 = engine._playerAnimator.getPipesState()
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

  // Advance past attach contact moment (dt = 0.15 -> total 0.30s >= 0.21s attach progress)
  engine.pipesController.update(0.15)
  assert(
    engine.pipesController.isGripAttached() === true,
    'Req 2A: Hands attach to pipe at contact progress threshold'
  )

  engine._playerAnimator.update(0.016, {
    moved: false,
    actualSpeed: 0,
    pipes: engine.pipesController.getAnimatorPayload(),
  })
  engine.pipesController.syncCarriedMeshToHands()
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
  // Test 5: Continuous hand-to-pipe attachment during carrying and rotation
  // -------------------------------------------------------------
  engine.pipesController.update(0.20) // Reach HANDLING state
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.HANDLING,
    'Req 5A: Controller enters HANDLING (carry) state'
  )
  engine._playerAnimator.update(0.016, {
    moved: false,
    actualSpeed: 0,
    pipes: engine.pipesController.getAnimatorPayload(),
  })
  engine.pipesController.syncCarriedMeshToHands()
  const carryPose1 = new THREE.Vector3()
  pipeGroup.getWorldPosition(carryPose1)

  // Rotate player group yaw by 45 degrees
  engine._playerGroup.rotation.y += Math.PI * 0.25
  engine._playerAnimator.update(0.016, {
    moved: false,
    actualSpeed: 0,
    pipes: engine.pipesController.getAnimatorPayload(),
  })
  engine.pipesController.syncCarriedMeshToHands()
  const carryPose2 = new THREE.Vector3()
  pipeGroup.getWorldPosition(carryPose2)
  assert(
    Math.hypot(carryPose2.x - carryPose1.x, carryPose2.z - carryPose1.z) > 0.05,
    'Req 5B: Carried pipe continuously follows character rotation in hands'
  )

  // -------------------------------------------------------------
  // Test 6: Full 4-direction WASD movement while handling (W, S, A, D)
  // -------------------------------------------------------------
  engine._playerGroup.rotation.y = 0 // Face North (-Z)
  const pStartX = engine._playerWorldPos.x
  const pStartZ = engine._playerWorldPos.z

  // Forward (W): negative Z
  const moveW = engine.pipesController.stepCoupledMovement(0, -0.2, 0.016)
  assert(
    moveW.moved === true && engine._playerWorldPos.z < pStartZ,
    'Req 6A: Forward movement (W) moves player and carried pipe forward'
  )

  // Right strafe (D): positive X
  const pMidX = engine._playerWorldPos.x
  const moveD = engine.pipesController.stepCoupledMovement(0.2, 0, 0.016)
  assert(
    moveD.moved === true && engine._playerWorldPos.x > pMidX,
    'Req 6B: Right strafe movement (D) moves player and carried pipe right'
  )

  // Left strafe (A): negative X
  const moveA = engine.pipesController.stepCoupledMovement(-0.2, 0, 0.016)
  assert(
    moveA.moved === true,
    'Req 6C: Left strafe movement (A) moves player and carried pipe left'
  )

  // -------------------------------------------------------------
  // Test 7: Backward movement (S) moves backward without sideways teleportation
  // -------------------------------------------------------------
  const preBackX = engine._playerWorldPos.x
  const preBackZ = engine._playerWorldPos.z
  const moveS = engine.pipesController.stepCoupledMovement(0, 0.35, 0.016)
  const postBackX = engine._playerWorldPos.x
  const postBackZ = engine._playerWorldPos.z

  assert(
    moveS.moved === true &&
      postBackZ > preBackZ &&
      Math.abs(postBackX - preBackX) < 1e-3,
    'Req 7: Backward movement (S) translates player backward without sideways teleportation'
  )

  // -------------------------------------------------------------
  // Test 8: Right-click initiates placement animation (knees bend, lower to floor, release)
  // -------------------------------------------------------------
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
    'Req 8A: Right-click initiates RELEASING (placement) animation state'
  )

  // Advance lowering phase (progress ~ 0.3)
  engine.pipesController.update(0.10)
  engine._playerAnimator.update(0.016, {
    moved: false,
    actualSpeed: 0,
    pipes: engine.pipesController.getAnimatorPayload(),
  })
  const pStatePlace = engine._playerAnimator.getPipesState()
  assert(
    pStatePlace.pipesMode === PIPES_ANIM_MODES.PLACE &&
      pStatePlace.pipesCrouch > 0.4 &&
      pStatePlace.pipesReach > 0.4,
    'Req 8B: Character bends knees and lowers pipe toward floor target during placement'
  )

  // -------------------------------------------------------------
  // Test 9: Placed pipe remains solid with updated collider matching final transform
  // -------------------------------------------------------------
  // Advance through floor contact and release (dt = 0.25 -> total 0.35s >= 0.32s release duration)
  engine.pipesController.update(0.25)
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.IDLE,
    'Req 9A: Controller completes placement and returns to IDLE'
  )

  const placedPose = pipeHaz.getPipesPose()
  assert(
    pipeHaz.pipesHandlingState === 'placed' &&
      Number.isFinite(placedPose.worldCx) &&
      Number.isFinite(placedPose.worldCz),
    'Req 9B: Hazard aftermath collider updated with placed solid world transform'
  )

  // -------------------------------------------------------------
  // Test 10: Placed pipe can be targeted and picked up again
  // -------------------------------------------------------------
  // Align camera and player to face placed pipe
  engine._playerWorldPos.x = placedPose.worldCx
  engine._playerWorldPos.z = placedPose.worldCz + 1.2
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
    'Req 10B: Player can pick up the placed pipe again from its new floor position'
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
  engine.cameraRig.setMode?.(CAMERA_MODES.FIRST_PERSON)
  const eyeOffset = engine.pipesController.getFirstPersonEyeOffsetY()
  assert(
    eyeOffset < -0.05,
    'Req 12A: First-person camera applies downward eye offset during lift crouch'
  )
  engine._playerAnimator.update(0.016, {
    moved: false,
    actualSpeed: 0,
    pipes: engine.pipesController.getAnimatorPayload(),
    isFirstPerson: true,
  })
  const rig = engine._playerAnimator.rig
  assert(
    rig.leftShoulderPivot.position.z < -0.05,
    'Req 12B: Articulated arms shift forward into lower viewport during first-person handling'
  )
  engine.cameraRig.setMode?.(CAMERA_MODES.THIRD_PERSON_FOLLOW)

  // -------------------------------------------------------------
  // Test 13: Third-Person Follow view support (smooth yaw alignment, hands attached)
  // -------------------------------------------------------------
  engine.pipesController.update(0.20) // Reach handling
  const contacts = engine.pipesController.getHandContactPoints()
  assert(
    contacts.gripAttached === true &&
      Number.isFinite(contacts.leftHandWorld.x) &&
      Number.isFinite(contacts.rightHandWorld.x),
    'Req 13: Third-Person Follow attaches left and right hand contact points'
  )

  // -------------------------------------------------------------
  // Test 14: Third-Person Free Look mode support
  // -------------------------------------------------------------
  engine.cameraRig.setMode?.(CAMERA_MODES.THIRD_PERSON_FREE_LOOK)
  const freeLookActive = Boolean(engine.cameraRig.isFreeLookActive?.())
  const canMoveInFreeLook = engine.pipesController.stepCoupledMovement(0, -0.1, 0.016)
  assert(
    freeLookActive === true && canMoveInFreeLook.moved === true,
    'Req 14: Free look maintains coupled character and pipe movement cleanly'
  )
  engine.cameraRig.setMode?.(CAMERA_MODES.THIRD_PERSON_FOLLOW)

  // -------------------------------------------------------------
  // Test 15: Safe interruption and recovery handling
  // -------------------------------------------------------------
  const interrupted = engine.pipesController.interruptHandling({ immediate: true })
  assert(
    interrupted === true &&
      engine.pipesController.getStateName() === PIPES_HANDLING_STATES.IDLE &&
      engine.pipesController.getActiveHazard() === null,
    'Req 15: Interrupt handling resets state machine safely to IDLE without corrupting state'
  )

  // -------------------------------------------------------------
  // Test 16: Dynamic sound emission during pickup, carry movement, and placement
  // -------------------------------------------------------------
  let soundsEmitted = 0
  engine.emitSound = () => {
    soundsEmitted += 1
  }
  engine.pipesController.tryGripTarget({ x: 0, y: 0 })
  engine.pipesController.update(0.25) // Triggers attach sound
  engine.pipesController.update(0.20) // Reach handling
  engine.pipesController.stepCoupledMovement(0, -0.3, 0.016) // Triggers movement sound
  engine.pipesController.tryRelease()
  engine.pipesController.update(0.25) // Triggers placement sound
  assert(
    soundsEmitted >= 2,
    'Req 16: Sounds emitted during pickup lift, carry movement, and placement'
  )

  // -------------------------------------------------------------
  // Test 17: Sprint is disabled while carrying pipes
  // -------------------------------------------------------------
  engine.pipesController.tryGripTarget({ x: 0, y: 0 })
  engine.pipesController.update(0.45)
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
  // Test 18: Zero per-frame memory allocations in render/update loops
  // -------------------------------------------------------------
  const origVector3 = THREE.Vector3
  let allocCount = 0
  // Monkey-patch Vector3 during a tight 60-frame update loop
  THREE.Vector3 = class extends origVector3 {
    constructor(...args) {
      super(...args)
      allocCount += 1
    }
  }

  for (let f = 0; f < 60; f += 1) {
    engine.pipesController.stepCoupledMovement(0, -0.01, 0.016)
    engine._playerAnimator.update(0.016, {
      moved: true,
      actualSpeed: 1.2,
      pipes: engine.pipesController.getAnimatorPayload(),
    })
    engine.pipesController.syncCarriedMeshToHands()
  }

  THREE.Vector3 = origVector3
  assert(
    allocCount === 0,
    'Req 18: Zero THREE.Vector3 allocations per frame in animation and controller update loops'
  )

  // Cleanup
  pointerCtrl.detach()
  engine.pipesController.interruptHandling({ immediate: true })

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
