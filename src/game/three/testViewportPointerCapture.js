import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES } from './CameraRig.js'
import { RUBBLE_CONTROLLER_STATES } from './CeilingRubbleController.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { resolveLookInputConfig } from './threeConfig.js'
import {
  canSafelyCapturePointer,
  createViewportPointerController,
  trySafeReleasePointerCapture,
  trySafeSetPointerCapture,
} from './viewportPointerCapture.js'

const W = CELL_TYPES.WALL
const P = CELL_TYPES.PATH
const S = CELL_TYPES.START
const E = CELL_TYPES.EXIT

/**
 * Simulates a real browser DOM element & document with W3C Pointer Events + Pointer Lock rules:
 * - Throws DOMException('InvalidStateError') if setPointerCapture is called while document.pointerLockElement is non-null
 *   OR when browser is in a pending/invalid pointer-capture state (`forceInvalidState`).
 * - Throws DOMException('NotFoundError') if pointerId is not in the active pointer set.
 * - Throws DOMException('InvalidStateError') if element.isConnected === false.
 */
function createSpecCompliantPointerEnv() {
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
    forceInvalidStateOnCapture: false,
    appendChild() {},
    removeChild() {},
    contains(el) {
      return el === canvasHost
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 960, height: 540 }
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
      if (!this.isConnected) {
        const err = new Error("Failed to execute 'setPointerCapture' on 'Element': InvalidStateError")
        err.name = 'InvalidStateError'
        throw err
      }
      if (doc.pointerLockElement !== null || this.forceInvalidStateOnCapture) {
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
      if (!this.isConnected) {
        const err = new Error("Failed to execute 'releasePointerCapture' on 'Element': InvalidStateError")
        err.name = 'InvalidStateError'
        throw err
      }
      if (!capturedPointers.has(pointerId)) {
        const err = new Error("Failed to execute 'releasePointerCapture' on 'Element': NotFoundError")
        err.name = 'NotFoundError'
        throw err
      }
      capturedPointers.delete(pointerId)
    },
  }

  return {
    doc,
    canvasHost,
    activePointers,
    capturedPointers,
    activatePointer(id = 1) {
      activePointers.add(id)
    },
    deactivatePointer(id = 1) {
      activePointers.delete(id)
      capturedPointers.delete(id)
    },
  }
}

function createRubbleTestSetup(cameraMode = CAMERA_MODES.THIRD_PERSON) {
  const env = createSpecCompliantPointerEnv()
  const grid = [
    [W, W, W, W, W, W, W, W, W],
    [W, W, W, W, W, W, W, W, W],
    [W, S, P, P, P, P, P, E, W],
    [W, W, W, W, W, W, W, W, W],
  ]
  const maze = {
    grid,
    rows: grid.length,
    cols: grid[0].length,
    start: { row: 2, col: 1 },
    exit: { row: 2, col: 7 },
    level: 2,
    seed: 5101,
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

  const engine = new MazeSceneEngine(env.canvasHost, {
    createRenderer: () => mockRenderer,
    skipSpawnSequence: true,
    cameraMode,
    enemies: { autoSpawn: false },
  })

  engine.setMaze(maze)
  engine.cancelSpawnSequence?.({ syncYaw: false })
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })

  const hazardCell = { row: 2, col: 4 }
  const playerCell = { row: 2, col: 2 }
  const hazard = engine.hazardManager.addHazard({
    id: 'cc-ptr-test',
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

  const latestProps = {
    controlsEnabled: true,
    hasWon: false,
    isGameOver: false,
    isArrivalLocked: false,
    engineConfig: {},
  }

  const diagnostics = []
  const pointerController = createViewportPointerController({
    canvasHost: env.canvasHost,
    doc: env.doc,
    getEngine: () => engine,
    getLatestProps: () => latestProps,
    resolveLookInputConfig,
    onDiagnostic: (info) => diagnostics.push(info),
  })
  pointerController.attach()

  return {
    env,
    engine,
    hazard,
    latestProps,
    diagnostics,
    pointerController,
  }
}

function aimAtNearestRubblePiece(engine, hazard) {
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
  best.mesh.updateMatrixWorld(true)
  const target = new THREE.Vector3()
  best.mesh.getWorldPosition(target)

  const px = target.x - 1.35
  const pz = target.z
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
  return best
}

console.log('Running MAZE-HAZARD-CEILING-ANIM-002 Pointer Capture & Rubble Interaction tests...')

// ============================================================================
// TEST 1: Normal pointer down/move/up without capture errors
// ============================================================================
{
  const { env, engine, pointerController } = createRubbleTestSetup()
  // Aim away from rubble so left-drag performs unlocked drag-look
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0)
  engine.cameraRig.snap()
  engine.stepFrame(0.016)
  const initialYaw = engine.cameraRig.getLookDirection().yaw

  env.activatePointer(1)
  env.canvasHost.dispatchEvent({
    type: 'pointerdown',
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 480,
    clientY: 270,
  })
  assert.equal(pointerController.getState().draggingPointerId, 1, 'Drag started for pointer 1')
  assert.equal(env.canvasHost.hasPointerCapture(1), true, 'Pointer 1 captured cleanly when unlocked')

  env.canvasHost.dispatchEvent({
    type: 'pointermove',
    pointerId: 1,
    pointerType: 'mouse',
    buttons: 1,
    clientX: 540,
    clientY: 270,
  })
  assert.notEqual(
    engine.cameraRig.getLookDirection().yaw,
    initialYaw,
    'Unlocked drag-look rotates camera smoothly'
  )

  env.canvasHost.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: 540,
    clientY: 270,
  })
  env.deactivatePointer(1)
  assert.equal(pointerController.getState().draggingPointerId, null, 'Drag state cleared on pointerup')
  assert.equal(env.canvasHost.hasPointerCapture(1), false, 'Pointer capture released on pointerup')

  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 1: Normal pointer down/move/up without capture errors')
}

// ============================================================================
// TEST 2: Left-click rubble pickup while pointer lock is active (never calls setPointerCapture)
// ============================================================================
{
  const { env, engine, hazard, pointerController } = createRubbleTestSetup()
  const targetPiece = aimAtNearestRubblePiece(engine, hazard)

  // Activate Pointer Lock on canvasHost (or child canvas)
  env.doc.pointerLockElement = env.canvasHost
  env.activatePointer(1)

  // Under pointer lock, setPointerCapture throws InvalidStateError in browsers.
  // Verify handlePointerDown picks up rubble and NEVER throws InvalidStateError!
  assert.doesNotThrow(() => {
    env.canvasHost.dispatchEvent({
      type: 'pointerdown',
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 480,
      clientY: 270,
    })
    env.canvasHost.dispatchEvent({
      type: 'pointerup',
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 480,
      clientY: 270,
    })
  }, 'Pointer-locked left-click never throws InvalidStateError')

  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.PICKING_UP,
    'Left-click starts rubble pickup while pointer lock is active'
  )
  assert.equal(
    engine.getRubbleInteractionState().carriedPieceId,
    targetPiece.pieceId,
    'Targeted slab is being picked up'
  )
  assert.equal(env.canvasHost.hasPointerCapture(1), false, 'No pointer capture attempted during pointer lock')

  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 2: Left-click rubble pickup while pointer lock is active')
}

// ============================================================================
// TEST 3 & 4: Left-click rubble pickup while pointer lock is inactive + Right-click placement
// ============================================================================
{
  const { env, engine, hazard, pointerController } = createRubbleTestSetup()
  const targetPiece = aimAtNearestRubblePiece(engine, hazard)
  env.doc.pointerLockElement = null

  // Also test when browser throws InvalidStateError on setPointerCapture even while unlocked
  // (e.g., pending pointer lock request or browser gesture restriction)
  env.canvasHost.forceInvalidStateOnCapture = true
  env.activatePointer(2)

  assert.doesNotThrow(() => {
    env.canvasHost.dispatchEvent({
      type: 'pointerdown',
      pointerId: 2,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 480,
      clientY: 270,
    })
    env.canvasHost.dispatchEvent({
      type: 'pointerup',
      pointerId: 2,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 480,
      clientY: 270,
    })
  }, 'Unlocked left-click pickup succeeds without throwing InvalidStateError')

  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.PICKING_UP,
    'Left-click starts rubble pickup while pointer lock is inactive'
  )
  assert.equal(engine.getRubbleInteractionState().carriedPieceId, targetPiece.pieceId)

  // Advance pickup to CARRYING state
  for (let i = 0; i < 22; i += 1) {
    engine.stepFrame(0.05)
  }
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.CARRYING)

  // Face North corridor wall and right-click (button 2) + contextmenu to place carried rubble
  engine.cameraRig.setLookDirection(0, 0)
  engine.cameraRig.snap()
  engine.stepFrame(0.05)

  let contextMenuPrevented = false
  env.canvasHost.dispatchEvent({
    type: 'contextmenu',
    target: env.canvasHost,
    preventDefault() {
      contextMenuPrevented = true
    },
  })
  assert.equal(contextMenuPrevented, true, 'Browser contextmenu prevented during gameplay')

  let rightClickPrevented = false
  env.canvasHost.dispatchEvent({
    type: 'pointerdown',
    pointerId: 2,
    pointerType: 'mouse',
    button: 2,
    buttons: 2,
    clientX: 480,
    clientY: 270,
    preventDefault() {
      rightClickPrevented = true
    },
  })
  assert.equal(rightClickPrevented, true, 'Right-click pointerdown prevents default context action')
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.PLACING,
    'Right-click initiates controlled rubble placement animation'
  )

  for (let i = 0; i < 20; i += 1) {
    engine.stepFrame(0.05)
  }
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.IDLE)
  assert.equal(targetPiece.state, 'placed', 'Slab placed solidly on floor via right-click')

  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 3 & 4: Left-click pickup while unlocked & right-click placement while carrying')
}

// ============================================================================
// TEST 5 & 6: Pointer cancellation during drag-look & lostpointercapture cleanup
// ============================================================================
{
  const { env, engine, pointerController } = createRubbleTestSetup()
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0)
  engine.cameraRig.snap()

  // 5. pointercancel mid-drag
  env.activatePointer(5)
  env.canvasHost.dispatchEvent({
    type: 'pointerdown',
    pointerId: 5,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 300,
    clientY: 200,
  })
  assert.equal(pointerController.getState().draggingPointerId, 5)
  assert.equal(env.canvasHost.hasPointerCapture(5), true)

  env.canvasHost.dispatchEvent({
    type: 'pointercancel',
    pointerId: 5,
  })
  assert.equal(pointerController.getState().draggingPointerId, null, 'pointercancel clears draggingPointerId')
  assert.equal(env.canvasHost.hasPointerCapture(5), false, 'pointercancel releases pointer capture')

  // Verify subsequent pointermove does NOT rotate camera (drag-look is not stuck!)
  const yawAfterCancel = engine.cameraRig.getLookDirection().yaw
  env.canvasHost.dispatchEvent({
    type: 'pointermove',
    pointerId: 5,
    clientX: 450,
    clientY: 200,
  })
  assert.equal(
    engine.cameraRig.getLookDirection().yaw,
    yawAfterCancel,
    'Camera does not stick or rotate after pointercancel'
  )
  env.deactivatePointer(5)

  // 6. lostpointercapture mid-drag
  env.activatePointer(6)
  env.canvasHost.dispatchEvent({
    type: 'pointerdown',
    pointerId: 6,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 300,
    clientY: 200,
  })
  assert.equal(pointerController.getState().draggingPointerId, 6)
  // Simulate browser revoking capture and firing lostpointercapture
  env.capturedPointers.delete(6)
  assert.doesNotThrow(() => {
    env.canvasHost.dispatchEvent({
      type: 'lostpointercapture',
      pointerId: 6,
    })
  }, 'lostpointercapture handled without calling redundant releasePointerCapture')
  assert.equal(pointerController.getState().draggingPointerId, null, 'lostpointercapture resets drag state')
  assert.equal(pointerController.getState().hasActiveCapture, false)

  const yawAfterLost = engine.cameraRig.getLookDirection().yaw
  env.canvasHost.dispatchEvent({
    type: 'pointermove',
    pointerId: 6,
    clientX: 500,
    clientY: 250,
  })
  assert.equal(
    engine.cameraRig.getLookDirection().yaw,
    yawAfterLost,
    'Camera does not stick or rotate after lostpointercapture'
  )
  env.deactivatePointer(6)

  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 5 & 6: Pointer cancellation and lost pointer capture clean up drag-look state')
}

// ============================================================================
// TEST 7 & 8: Already-captured pointer & invalid/inactive pointer IDs
// ============================================================================
{
  const env = createSpecCompliantPointerEnv()
  env.activatePointer(7)
  env.canvasHost.setPointerCapture(7)
  assert.equal(env.canvasHost.hasPointerCapture(7), true)

  // 7. Pointer already captured: canSafelyCapturePointer detects alreadyCaptured without re-calling setPointerCapture
  let setCaptureCalls = 0
  const origSetCapture = env.canvasHost.setPointerCapture.bind(env.canvasHost)
  env.canvasHost.setPointerCapture = (id) => {
    setCaptureCalls += 1
    return origSetCapture(id)
  }

  const alreadyRes = trySafeSetPointerCapture(env.canvasHost, {
    pointerId: 7,
    buttons: 1,
  })
  assert.equal(alreadyRes.captured, true, 'Reports captured=true when already captured')
  assert.equal(alreadyRes.alreadyCaptured, true, 'Flags alreadyCaptured=true')
  assert.equal(setCaptureCalls, 0, 'Does not redundantly call setPointerCapture when already captured')

  // 8. Invalid, negative, non-integer, or inactive pointer IDs and disconnected elements
  for (const badEvent of [
    null,
    {},
    { pointerId: null, buttons: 1 },
    { pointerId: undefined, buttons: 1 },
    { pointerId: -1, buttons: 1 },
    { pointerId: 1.5, buttons: 1 },
    { pointerId: NaN, buttons: 1 },
    { pointerId: 999, buttons: 1 }, // inactive pointerId -> throws NotFoundError in browser
    { pointerId: 7, buttons: 0 }, // no active buttons depressed
  ]) {
    assert.doesNotThrow(() => {
      const res = trySafeSetPointerCapture(env.canvasHost, badEvent)
      assert.equal(res.captured, false, `Rejects invalid/inactive pointer event: ${JSON.stringify(badEvent)}`)
    })
  }

  // Disconnected element check
  env.canvasHost.isConnected = false
  assert.equal(
    canSafelyCapturePointer(env.canvasHost, { pointerId: 7, buttons: 1 }).eligible,
    false,
    'Disconnected element is ineligible for pointer capture'
  )
  assert.equal(
    trySafeReleasePointerCapture(env.canvasHost, 7).released,
    false,
    'Disconnected element safely skips releasePointerCapture'
  )

  console.log('  [PASS] 7 & 8: Already-captured pointer and invalid/inactive pointer IDs handled safely')
}

// ============================================================================
// TEST 9 & 10: Switching between pointer-lock and unlocked modes + repeated rapid clicks
// ============================================================================
{
  const { env, engine, hazard, pointerController } = createRubbleTestSetup()
  aimAtNearestRubblePiece(engine, hazard)

  // Start an unlocked drag-look, then engage pointer lock mid-drag -> must clean up drag state immediately
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0)
  engine.cameraRig.snap()
  engine.stepFrame(0.016)

  env.activatePointer(9)
  env.canvasHost.dispatchEvent({
    type: 'pointerdown',
    pointerId: 9,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 400,
    clientY: 250,
  })
  assert.equal(pointerController.getState().draggingPointerId, 9)

  // Engage pointer lock while pointer 9 is still down
  env.doc.pointerLockElement = env.canvasHost
  assert.doesNotThrow(() => {
    env.doc.dispatchEvent({ type: 'pointerlockchange' })
  })
  assert.equal(
    pointerController.getState().draggingPointerId,
    null,
    'Switching into pointer lock mid-drag clears unlocked drag state'
  )

  // Switch back to unlocked and re-aim at rubble slab
  env.doc.pointerLockElement = null
  env.doc.dispatchEvent({ type: 'pointerlockchange' })
  aimAtNearestRubblePiece(engine, hazard)

  // 10. Repeated rapid left/right clicks across alternating pointer-lock / unlocked / InvalidStateError states
  assert.doesNotThrow(() => {
    for (let i = 0; i < 40; i += 1) {
      const pid = 100 + i
      if (i % 3 !== 0) env.activatePointer(pid)
      env.doc.pointerLockElement = i % 2 === 0 ? env.canvasHost : null
      env.canvasHost.forceInvalidStateOnCapture = i % 4 === 1

      env.canvasHost.dispatchEvent({
        type: 'pointerdown',
        pointerId: pid,
        pointerType: 'mouse',
        button: i % 5 === 0 ? 2 : 0,
        buttons: i % 5 === 0 ? 2 : 1,
        clientX: 480 + (i % 3),
        clientY: 270 + (i % 3),
      })
      env.canvasHost.dispatchEvent({
        type: 'pointermove',
        pointerId: pid,
        pointerType: 'mouse',
        buttons: 1,
        clientX: 482 + (i % 3),
        clientY: 271 + (i % 3),
      })
      env.canvasHost.dispatchEvent({
        type: 'pointerup',
        pointerId: pid,
        pointerType: 'mouse',
        button: i % 5 === 0 ? 2 : 0,
        buttons: 0,
        clientX: 482 + (i % 3),
        clientY: 271 + (i % 3),
      })
      engine.stepFrame(0.02)
      env.deactivatePointer(pid)
    }
  }, '40 rapid clicks across pointer-lock transitions produce zero uncaught exceptions')

  pointerController.detach()
  engine.dispose()
  console.log('  [PASS] 9 & 10: Pointer-lock mode transitions and 40 rapid clicks with zero uncaught errors')
}

console.log('ALL 10 MAZE-HAZARD-CEILING-ANIM-002 POINTER CAPTURE TESTS PASSED!')
