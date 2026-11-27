import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  CROSSHAIR_TARGET_STATES,
  resolveCrosshairFeedbackState,
  resolveCrosshairVisibility,
} from '../../components/game/centerCrosshairState.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { registerDynamicCollider } from '../world/propCollision.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES, THIRD_PERSON_CAMERA_MODES } from './CameraRig.js'
import { RUBBLE_CONTROLLER_STATES } from './CeilingRubbleController.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { resolveLookInputConfig } from './threeConfig.js'
import { createViewportPointerController } from './viewportPointerCapture.js'

const W = CELL_TYPES.WALL
const P = CELL_TYPES.PATH
const S = CELL_TYPES.START
const E = CELL_TYPES.EXIT

function createMockPointerEnv() {
  const listeners = new Map()
  const docListeners = new Map()
  const activePointers = new Set()
  const capturedPointers = new Set()

  const doc = {
    pointerLockElement: null,
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set())
      docListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn)
    },
    dispatchEvent(event) {
      const set = docListeners.get(event.type)
      if (!set) return
      for (const fn of [...set]) fn(event)
    },
  }

  const canvasHost = {
    clientWidth: 960,
    clientHeight: 540,
    isConnected: true,
    ownerDocument: doc,
    appendChild() {},
    removeChild() {},
    contains(el) {
      return el === canvasHost
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatchEvent(event) {
      const set = listeners.get(event.type)
      if (!set) return
      for (const fn of [...set]) fn(event)
    },
    hasPointerCapture(pointerId) {
      return capturedPointers.has(pointerId)
    },
    setPointerCapture(pointerId) {
      if (doc.pointerLockElement !== null) {
        const err = new Error("Failed to execute 'setPointerCapture' on 'Element': InvalidStateError")
        err.name = 'InvalidStateError'
        throw err
      }
      if (!Number.isInteger(pointerId) || !activePointers.has(pointerId)) {
        const err = new Error("Failed to execute 'setPointerCapture' on 'Element': NotFoundError")
        err.name = 'NotFoundError'
        throw err
      }
      capturedPointers.add(pointerId)
    },
    releasePointerCapture(pointerId) {
      capturedPointers.delete(pointerId)
    },
  }

  return {
    doc,
    canvasHost,
    activatePointer(id = 1) {
      activePointers.add(id)
    },
    deactivatePointer(id = 1) {
      activePointers.delete(id)
      capturedPointers.delete(id)
    },
  }
}

function createCrosshairTestEngine({
  cameraMode = CAMERA_MODES.FIRST_PERSON,
  thirdPersonCameraMode = THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
} = {}) {
  const env = createMockPointerEnv()
  const grid = [
    [W, W, W, W, W, W, W, W, W],
    [W, W, W, W, W, W, W, W, W],
    [W, S, P, P, P, P, P, E, W],
    [W, W, W, W, W, W, W, W, W],
    [W, P, P, P, P, P, P, P, W],
    [W, W, W, W, W, W, W, W, W],
  ]
  const maze = {
    grid,
    rows: grid.length,
    cols: grid[0].length,
    start: { row: 2, col: 1 },
    exit: { row: 2, col: 7 },
    level: 3,
    seed: 6103,
  }

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

  let latestStealthState = {}
  const engine = new MazeSceneEngine(env.canvasHost, {
    createRenderer: () => mockRenderer,
    skipSpawnSequence: true,
    cameraMode,
    thirdPersonCameraMode,
    enemies: { autoSpawn: false },
    onStealthChange: (snap) => {
      latestStealthState = { ...snap }
    },
  })

  engine.setMaze(maze)
  engine.cancelSpawnSequence?.({ syncYaw: false })
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })

  const hazardCell = { row: 2, col: 4 }
  const playerCell = { row: 2, col: 2 }
  const hazard = engine.hazardManager.addHazard({
    id: 'cc-crosshair-003',
    type: HAZARD_TYPES.CEILING_COLLAPSE,
    row: hazardCell.row,
    col: hazardCell.col,
  })

  const hazWorld = gridToWorld(hazardCell.row, hazardCell.col, maze)
  hazard.update(0.05, {
    playerWorldPos: { x: hazWorld.x, y: 0, z: hazWorld.z },
    playerGridCell: hazardCell,
  })
  for (let i = 0; i < 45; i += 1) {
    hazard.update(0.06, {
      playerWorldPos: { x: hazWorld.x - 10, y: 0, z: hazWorld.z - 10 },
      playerGridCell: playerCell,
    })
  }
  assert.equal(hazard.state, HAZARD_STATES.DISABLED)
  engine._syncHazardColliders({ allowPushOut: false })
  latestStealthState = engine.getStealthState()

  const latestProps = {
    controlsEnabled: true,
    hasWon: false,
    isGameOver: false,
    isArrivalLocked: false,
    engineConfig: {},
  }

  const pointerController = createViewportPointerController({
    canvasHost: env.canvasHost,
    doc: env.doc,
    getEngine: () => engine,
    getLatestProps: () => latestProps,
    resolveLookInputConfig,
  })
  pointerController.attach()

  return {
    env,
    maze,
    engine,
    hazard,
    pointerController,
    getStealthState: () => latestStealthState,
  }
}

function aimCenterAtPiece(engine, piece, standOffset = { dx: -1.35, dz: 0 }) {
  piece.mesh.updateMatrixWorld(true)
  const target = new THREE.Vector3()
  piece.mesh.getWorldPosition(target)

  const px = target.x + standOffset.dx
  const pz = target.z + standOffset.dz
  engine._playerWorldPos.x = px
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = pz
  if (engine._playerGroup) {
    engine._playerGroup.position.set(px, 0, pz)
  }
  engine.cameraRig?.setPlayerPosition(px, 0, pz)

  const yaw = Math.atan2(-(target.x - px), -(target.z - pz))
  if (engine._playerGroup) {
    engine._playerGroup.rotation.y = yaw
  }
  engine.cameraRig?.setLookDirection(yaw, -0.35)
  engine.cameraRig?.snap?.()
  const cam = engine.cameraRig.camera
  cam.updateMatrixWorld(true)
  const cdx = target.x - cam.position.x
  const cdy = target.y - cam.position.y
  const cdz = target.z - cam.position.z
  const horiz = Math.max(1e-4, Math.hypot(cdx, cdz))
  engine.cameraRig.setLookDirection(Math.atan2(-cdx, -cdz), Math.atan2(cdy, horiz))
  engine.cameraRig.snap()
  cam.updateMatrixWorld(true)
  engine.stepFrame(0.016)
  return target
}

function findNearestWestPiece(hazard) {
  const pieces = hazard.getRubblePieces()
  const westX = hazard.dangerWorldPos.x - 4.0
  let best = pieces[0]
  let bestDist = Infinity
  for (const p of pieces) {
    const d = Math.hypot(p.worldPos.x - westX, p.worldPos.z - hazard.dangerWorldPos.z)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

console.log('Running MAZE-HAZARD-CEILING-ANIM-003 Persistent Crosshair & Targeting tests...')

// ============================================================================
// TEST 1, 2, 3 & 6: Crosshair visible across 1P, 3P Follow, 3P Free Look, and pointer-lock states,
//                   and hidden on non-gameplay screens (pause, game over, victory, modals)
// ============================================================================
{
  const { env, engine, hazard, pointerController } = createCrosshairTestEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
  })
  const piece = findNearestWestPiece(hazard)

  // 1. First-person mode
  assert.equal(engine.getCameraMode(), CAMERA_MODES.FIRST_PERSON)
  assert.equal(
    resolveCrosshairVisibility({ controlsEnabled: true }),
    true,
    'Crosshair visible in First-Person mode'
  )
  aimCenterAtPiece(engine, piece)
  assert.equal(
    engine.getRubbleInteractionState().targetedPieceId,
    piece.pieceId,
    'Center crosshair targets slab in First-Person mode'
  )

  // 2. Third-Person Character Follow mode
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
  engine.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW)
  assert.equal(engine.getCameraMode(), CAMERA_MODES.THIRD_PERSON)
  assert.equal(
    engine.getThirdPersonCameraMode(),
    THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW
  )
  assert.equal(
    resolveCrosshairVisibility({ controlsEnabled: true }),
    true,
    'Crosshair visible in Third-Person Follow mode'
  )
  aimCenterAtPiece(engine, piece)
  assert.equal(
    engine.getRubbleInteractionState().targetedPieceId,
    piece.pieceId,
    'Center crosshair targets slab in Third-Person Follow mode'
  )

  // 3. Third-Person Free Look mode
  engine.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK)
  assert.equal(
    engine.getThirdPersonCameraMode(),
    THIRD_PERSON_CAMERA_MODES.FREE_LOOK
  )
  assert.equal(
    resolveCrosshairVisibility({ controlsEnabled: true }),
    true,
    'Crosshair visible in Third-Person Free Look mode'
  )
  aimCenterAtPiece(engine, piece)
  assert.equal(
    engine.getRubbleInteractionState().targetedPieceId,
    piece.pieceId,
    'Center crosshair targets slab in Third-Person Free Look mode'
  )

  // 6. Pointer-lock independence & non-gameplay screen hiding
  env.doc.pointerLockElement = env.canvasHost
  engine.stepFrame(0.016)
  assert.equal(
    engine.getRubbleInteractionState().targetedPieceId,
    piece.pieceId,
    'Center crosshair targeting is identical when pointer lock is active'
  )
  env.doc.pointerLockElement = null
  engine.stepFrame(0.016)
  assert.equal(
    engine.getRubbleInteractionState().targetedPieceId,
    piece.pieceId,
    'Center crosshair targeting is identical when pointer lock is inactive'
  )

  // Non-gameplay screen visibility guards
  assert.equal(
    resolveCrosshairVisibility({ controlsEnabled: false }),
    false,
    'Crosshair hidden when controls are disabled (Pause / Start / Settings)'
  )
  assert.equal(
    resolveCrosshairVisibility({ controlsEnabled: true, hasWon: true }),
    false,
    'Crosshair hidden on Victory screen'
  )
  assert.equal(
    resolveCrosshairVisibility({ controlsEnabled: true, isGameOver: true }),
    false,
    'Crosshair hidden on Game Over screen'
  )
  assert.equal(
    resolveCrosshairVisibility({ controlsEnabled: true, showDiagnosticsModal: true }),
    false,
    'Crosshair hidden when modal overlay is open'
  )

  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 1, 2, 3 & 6: Crosshair visibility across 1P, 3P Follow, 3P Free Look, and pointer-lock states')
}

// ============================================================================
// TEST 4 & 5: Crosshair remains centered & accurate during viewport resize and camera rotation
// ============================================================================
{
  const { env, engine, hazard, pointerController } = createCrosshairTestEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
  })
  const piece = findNearestWestPiece(hazard)
  aimCenterAtPiece(engine, piece)
  assert.equal(engine.getRubbleInteractionState().targetedPieceId, piece.pieceId)

  // 4. Resize viewport across multiple resolutions/aspect ratios: center raycast (0, 0) stays invariant
  for (const [w, h] of [
    [1920, 1080],
    [1280, 720],
    [800, 600],
    [2560, 1440],
  ]) {
    env.canvasHost.clientWidth = w
    env.canvasHost.clientHeight = h
    engine.resize(w, h)
    engine.stepFrame(0.016)
    assert.equal(
      engine.getRubbleInteractionState().targetedPieceId,
      piece.pieceId,
      `Center crosshair remains aligned with targeted piece at ${w}x${h}`
    )
  }

  // 5. Rotate camera away from rubble -> crosshair returns to NORMAL state; rotate back -> re-acquires piece
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0) // face West away from rubble
  engine.cameraRig.snap()
  engine.stepFrame(0.016)
  assert.equal(engine.getRubbleInteractionState().targetedPieceId, null)
  assert.equal(
    resolveCrosshairFeedbackState(engine.getStealthState()).targetState,
    CROSSHAIR_TARGET_STATES.NORMAL,
    'Crosshair switches to NORMAL state when camera rotates away from rubble'
  )

  aimCenterAtPiece(engine, piece)
  assert.equal(engine.getRubbleInteractionState().targetedPieceId, piece.pieceId)
  assert.equal(
    resolveCrosshairFeedbackState(engine.getStealthState()).targetState,
    CROSSHAIR_TARGET_STATES.VALID_TARGET,
    'Crosshair returns to VALID_TARGET state when rotated back onto rubble slab'
  )

  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 4 & 5: Crosshair stays centered and accurate during viewport resize and camera rotation')
}

// ============================================================================
// TEST 7, 8, 9, 10 & 11: Single center-crosshair source of truth (ignores off-center cursor),
//                        highlight parity, left-click pickup, right-click place, F-key disabled
// ============================================================================
{
  const { env, engine, hazard, pointerController, getStealthState } = createCrosshairTestEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
  })
  const piece = findNearestWestPiece(hazard)
  aimCenterAtPiece(engine, piece)

  // 7 & 8. Center raycast selects exact piece AND crosshair valid-target state matches highlighted mesh
  const stealthTargeting = getStealthState()
  const feedbackTargeting = resolveCrosshairFeedbackState(stealthTargeting)
  assert.equal(
    feedbackTargeting.targetState,
    CROSSHAIR_TARGET_STATES.VALID_TARGET,
    'Crosshair feedback state is VALID_TARGET when aiming at reachable slab'
  )
  assert.equal(
    feedbackTargeting.targetedPieceId,
    piece.pieceId,
    'Crosshair targetedPieceId matches the center-raycast slab'
  )
  assert.equal(
    piece.mesh.material,
    piece.mesh.userData.highlightMaterial,
    'Highlighted rubble mesh matches the crosshair target'
  )

  // Verify off-center mouse cursor position does NOT override center-crosshair targeting:
  // Even if mouse clicks at corner clientX=10, clientY=10 while unlocked, it interacts with the
  // center-crosshair target (and if center crosshair is aimed away, clicking over a slab off-center does NOT pick it up!)
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0.2) // Aim center crosshair away from rubble
  engine.cameraRig.snap()
  engine.stepFrame(0.016)
  assert.equal(engine.getRubbleInteractionState().canPickup, false)

  env.activatePointer(10)
  env.canvasHost.dispatchEvent({
    type: 'pointerdown',
    pointerId: 10,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 700,
    clientY: 400,
  })
  env.canvasHost.dispatchEvent({
    type: 'pointerup',
    pointerId: 10,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: 700,
    clientY: 400,
  })
  env.deactivatePointer(10)
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.IDLE,
    'Clicking off-center when center crosshair is not aimed at rubble does NOT pick up rubble'
  )

  // 11. F key remains disabled for Ceiling Collapse
  aimCenterAtPiece(engine, piece)
  assert.equal(engine.interact().handled, false, 'F key remains disabled for Ceiling Collapse')

  // 9. Left-click picks up the center-crosshair targeted piece (even if cursor clientX/Y is at screen edge)
  env.activatePointer(11)
  env.canvasHost.dispatchEvent({
    type: 'pointerdown',
    pointerId: 11,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 25,
    clientY: 25,
  })
  env.canvasHost.dispatchEvent({
    type: 'pointerup',
    pointerId: 11,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: 25,
    clientY: 25,
  })
  env.deactivatePointer(11)
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.PICKING_UP,
    'Left-click picks up the piece targeted by the center crosshair'
  )

  // Step to CARRYING state and verify crosshair transitions to CARRYING state
  for (let i = 0; i < 22; i += 1) {
    engine.stepFrame(0.05)
  }
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.CARRYING)
  // Face North corridor wall so placement is valid
  engine.cameraRig.setLookDirection(0, 0)
  engine.cameraRig.snap()
  engine.stepFrame(0.05)
  const feedbackCarrying = resolveCrosshairFeedbackState(getStealthState())
  assert.equal(
    feedbackCarrying.targetState,
    CROSSHAIR_TARGET_STATES.CARRYING,
    'Crosshair shows CARRYING state when holding rubble with valid placement'
  )

  // 10. Right-click places carried rubble
  env.activatePointer(12)
  env.canvasHost.dispatchEvent({
    type: 'pointerdown',
    pointerId: 12,
    pointerType: 'mouse',
    button: 2,
    buttons: 2,
    clientX: 480,
    clientY: 270,
  })
  env.deactivatePointer(12)
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.PLACING,
    'Right-click initiates rubble placement'
  )
  for (let i = 0; i < 20; i += 1) {
    engine.stepFrame(0.05)
  }
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.IDLE)
  assert.equal(piece.state, 'placed')

  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 7, 8, 9, 10 & 11: Single center-crosshair targeting, highlight parity, left/right click & F-key disabled')
}

// ============================================================================
// TEST 12: Wall/prop occlusion, range restrictions, and INVALID_PLACEMENT crosshair feedback
// ============================================================================
{
  const { maze, engine, hazard, pointerController, getStealthState } = createCrosshairTestEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
  })
  const piece = findNearestWestPiece(hazard)

  // Out of range (> 2.65m)
  aimCenterAtPiece(engine, piece, { dx: -4.2, dz: 0 })
  assert.equal(engine.getRubbleInteractionState().canPickup, false, 'Out-of-range piece rejected')
  assert.equal(
    resolveCrosshairFeedbackState(getStealthState()).targetState,
    CROSSHAIR_TARGET_STATES.NORMAL
  )

  // Through solid maze wall (row 4 is separated from row 2 by wall row 3)
  aimCenterAtPiece(engine, piece, { dx: 0, dz: 2 * CELL_SIZE })
  assert.equal(engine.getRubbleInteractionState().canPickup, false, 'Through-wall piece rejected')

  // Behind solid prop collider
  const targetPos = aimCenterAtPiece(engine, piece, { dx: -1.65, dz: 0 })
  const blockId = 'crosshair-prop-blocker'
  registerDynamicCollider(engine._propCollisionIndex, {
    id: blockId,
    ownerId: 'blocker-prop',
    ownerType: 'prop',
    kind: 'obb',
    cx: (engine._playerWorldPos.x + targetPos.x) * 0.5,
    cz: targetPos.z,
    halfW: 0.25,
    halfD: 0.45,
    yaw: 0,
    row: 2,
    col: 3,
    enabled: true,
  })
  engine.stepFrame(0.016)
  assert.equal(
    engine.getRubbleInteractionState().canPickup,
    false,
    'Prop-occluded piece rejected by center crosshair'
  )
  registerDynamicCollider(engine._propCollisionIndex, {
    id: blockId,
    ownerId: 'blocker-prop',
    ownerType: 'prop',
    kind: 'obb',
    cx: 0,
    cz: 0,
    halfW: 0.1,
    halfD: 0.1,
    yaw: 0,
    row: 0,
    col: 0,
    enabled: false,
  })

  // Test INVALID_PLACEMENT crosshair feedback when surrounded by obstacles while carrying
  aimCenterAtPiece(engine, piece, { dx: -1.35, dz: 0 })
  assert.equal(engine.handlePrimaryAction().handled, true)
  for (let i = 0; i < 22; i += 1) engine.stepFrame(0.05)
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.CARRYING)

  // Block surrounding corridor floor with temporary obstacle
  const surroundId = 'crosshair-surround-block'
  registerDynamicCollider(engine._propCollisionIndex, {
    id: surroundId,
    ownerId: 'surround-owner',
    ownerType: 'prop',
    kind: 'obb',
    cx: engine._playerWorldPos.x,
    cz: engine._playerWorldPos.z,
    halfW: 3.5,
    halfD: 3.5,
    yaw: 0,
    row: 2,
    col: 2,
    enabled: true,
  })
  engine.stepFrame(0.016)
  const placeAttempt = engine.handleSecondaryAction()
  assert.equal(placeAttempt.handled, false, 'Blocked placement refused without dropping slab')
  const invalidFeedback = resolveCrosshairFeedbackState(getStealthState())
  assert.equal(
    invalidFeedback.targetState,
    CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT,
    'Crosshair transitions to INVALID_PLACEMENT state when placement is blocked'
  )

  // Verify maze reference is valid
  assert.ok(maze.rows > 0)
  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 12: Wall/prop occlusion, range restrictions, and INVALID_PLACEMENT crosshair state verified')
}

// ============================================================================
// TEST 13 (MAZE-HAZARD-CEILING-ANIM-004): Live CSS & Inline Style Regression Guard
// Ensures CenterCrosshair never relies on missing Tailwind classes and renders
// explicit screen-center positioning, dimensions (5px-6px), and high-contrast colors
// ============================================================================
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { createServer } = await import('vite')
  const viteServer = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const { default: CenterCrosshair } = await viteServer.ssrLoadModule(
      '/src/components/game/CenterCrosshair.jsx'
    )

    const mazeCss = fs.readFileSync(
      path.resolve('src/styles/maze.css'),
      'utf8'
    )
    for (const selector of [
      '.maze-center-crosshair-layer',
      '.maze-center-crosshair-dot',
      '.maze-center-crosshair-dot--normal',
      '.maze-center-crosshair-dot--valid_target',
      '.maze-center-crosshair-dot--carrying',
      '.maze-center-crosshair-dot--invalid_placement',
      '.maze-center-crosshair-hint',
    ]) {
      assert.ok(
        mazeCss.includes(selector),
        `src/styles/maze.css must define ${selector}`
      )
    }

    // Hidden when visible=false
    assert.equal(CenterCrosshair({ visible: false }), null)

    // Verify rendered React element structure & inline styles for all 4 feedback states
    const stateInputs = [
      {
        expectedState: CROSSHAIR_TARGET_STATES.NORMAL,
        stealthState: { rubbleState: 'idle' },
        expectedWidth: '5px',
        expectedHeight: '5px',
      },
      {
        expectedState: CROSSHAIR_TARGET_STATES.VALID_TARGET,
        stealthState: {
          rubbleState: 'idle',
          rubbleCanPickup: true,
          rubbleTargetedPieceId: 'cc:rubble-0',
        },
        expectedWidth: '6px',
        expectedHeight: '6px',
      },
      {
        expectedState: CROSSHAIR_TARGET_STATES.CARRYING,
        stealthState: {
          rubbleState: 'carrying',
          rubbleCanPlace: true,
          rubblePlacementValid: true,
          rubbleCarriedPieceId: 'cc:rubble-0',
        },
        expectedWidth: '6px',
        expectedHeight: '6px',
      },
      {
        expectedState: CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT,
        stealthState: {
          rubbleState: 'carrying',
          rubbleCanPlace: true,
          rubblePlacementValid: false,
          rubbleFeedback: 'Placement blocked',
          rubbleCarriedPieceId: 'cc:rubble-0',
        },
        expectedWidth: '6px',
        expectedHeight: '6px',
      },
    ]

    for (const item of stateInputs) {
      const vnode = CenterCrosshair({
        visible: true,
        stealthState: item.stealthState,
        cameraMode: 'first-person',
        thirdPersonCameraMode: 'character-follow',
        pointerLocked: true,
      })
      assert.ok(vnode, `CenterCrosshair renders vnode for ${item.expectedState}`)
      assert.equal(vnode.props['data-crosshair-state'], item.expectedState)
      assert.equal(vnode.props.style.position, 'absolute')
      assert.equal(vnode.props.style.pointerEvents, 'none')

      const children = Array.isArray(vnode.props.children)
        ? vnode.props.children
        : [vnode.props.children]
      const dotVnode = children.find(
        (c) => c && c.props && c.props['data-center-crosshair-dot'] === 'true'
      )
      assert.ok(dotVnode, `Center dot element exists for ${item.expectedState}`)
      assert.equal(dotVnode.props.style.position, 'absolute')
      assert.equal(dotVnode.props.style.left, '50%')
      assert.equal(dotVnode.props.style.top, '50%')
      assert.equal(dotVnode.props.style.transform, 'translate(-50%, -50%)')
      assert.equal(dotVnode.props.style.width, item.expectedWidth)
      assert.equal(dotVnode.props.style.height, item.expectedHeight)
      assert.equal(dotVnode.props.style.borderRadius, '9999px')
      assert.equal(dotVnode.props.style.pointerEvents, 'none')
      assert.ok(dotVnode.props.style.backgroundColor, 'Dot has explicit backgroundColor')
      assert.ok(dotVnode.props.style.boxShadow, 'Dot has explicit high-contrast boxShadow')
    }

    console.log('  [PASS] 13: MAZE-HAZARD-CEILING-ANIM-004 CSS & inline style visibility guarantees verified')
  } finally {
    await viteServer.close()
  }
}

console.log('ALL MAZE-HAZARD-CEILING-ANIM-003 & 004 PERSISTENT CROSSHAIR & TARGETING TESTS PASSED!')

