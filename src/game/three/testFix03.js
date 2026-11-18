import assert from 'node:assert/strict'
import { generateMaze } from '../generation/mazeGenerator.js'
import { HIDING_SPOT_TYPES } from '../generation/hidingSpotPlacement.js'
import { gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools } from './sharedResources.js'

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
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    ...config,
  })
}

console.log('--- RUNNING FIX 03: HIDING SPOT & RESTART CAMERA TRANSITIONS TESTS ---')

const maze = generateMaze({ difficulty: 'small', seed: 5555 })

for (const mode of [CAMERA_MODES.FIRST_PERSON, CAMERA_MODES.THIRD_PERSON]) {
  console.log(`Testing Hiding Spot & Restart in mode: ${mode}`)
  const engine = createHeadlessEngine({
    cameraMode: mode,
    enemies: { autoSpawn: false },
  })
  engine.setMaze(maze)

  // 1. Initial maze start orientation & initialYaw storage
  const lookBefore = engine.cameraRig.getLookDirection()
  assert.equal(lookBefore.pitch, 0, 'Initial pitch is 0 at maze start')
  assert.equal(typeof engine._currentInitialYaw, 'number', '_currentInitialYaw stored on MazeSceneEngine')

  // Rotate camera away from initial orientation and pitch
  engine.setLookDirection(lookBefore.yaw + 1.25, 0.6)
  engine.cameraRig.snap()
  const lookModified = engine.cameraRig.getLookDirection()
  assert.notEqual(lookModified.yaw, lookBefore.yaw, 'Yaw modified successfully')
  assert.equal(lookModified.pitch, 0.6, 'Pitch modified successfully')

  // 2. Restart via resetCombat() and setPlayerGridPosition(start) restores initialYaw and pitch = 0 with snap
  engine.resetCombat()
  engine.setPlayerGridPosition(maze.start.row, maze.start.col, { immediate: true })
  const lookAfterRestart = engine.cameraRig.getLookDirection()
  assert.equal(
    lookAfterRestart.yaw,
    engine._currentInitialYaw,
    `Restart restores initialYaw in ${mode} mode`
  )
  assert.equal(lookAfterRestart.pitch, 0, `Restart resets pitch to 0 in ${mode} mode`)

  // 3. Hiding Spot Entry (snaps camera instantly to interior position without slow lerp)
  engine.clearHidingSpots()
  const spot = engine.hidingSpotManager.addHidingSpot({
    id: `locker-${mode}`,
    type: HIDING_SPOT_TYPES.CONTAINMENT_LOCKER,
    row: maze.start.row,
    col: maze.start.col + 1,
    facingYaw: Math.PI / 2,
    offsetDir: { dRow: 0, dCol: 1 },
  })

  // Move player near spot and set pre-entry look yaw
  const spotWorld = gridToWorld(spot.row, spot.col, maze)
  engine.setPlayerWorldPosition(spotWorld.x, 0, spotWorld.z, { immediate: true })
  const preEntryYaw = 0.85
  engine.setLookDirection(preEntryYaw, 0.2)
  engine.cameraRig.snap()
  
  const enterRes = engine.enterHidingSpot(spot)
  assert.equal(enterRes.entered, true, `Player enters hiding spot in ${mode}`)
  assert.equal(engine.isPlayerHidden(), true, 'Engine reports player hidden')

  // Verify camera snapped directly to interior position without transition lag
  const camPos = engine.camera.position
  assert.equal(camPos.x, spot.worldPos.x, 'Camera X snapped to locker interior position')
  assert.equal(camPos.z, spot.worldPos.z, 'Camera Z snapped to locker interior position')
  assert.equal(engine.cameraRig._transitioning, false, 'CameraRig is not transitioning (snapped immediately)')

  // 4. Hiding Spot Exit restores restoreYaw correctly
  const exitRes = engine.exitHidingSpot({ immediate: true })
  assert.equal(exitRes.exited, true, `Player exits hiding spot in ${mode}`)
  assert.equal(engine.isPlayerHidden(), false, 'Player no longer hidden')

  const lookAfterExit = engine.cameraRig.getLookDirection()
  assert.equal(
    lookAfterExit.yaw,
    preEntryYaw,
    `Exiting hiding spot restores correct pre-entry restoreYaw (${preEntryYaw}) in ${mode}`
  )
  assert.equal(lookAfterExit.pitch, 0, 'Pitch is 0 after exiting hiding spot')

  engine.dispose()
}

disposeAllSharedPools()
console.log('--- ALL FIX 03 HIDING SPOT & RESTART CAMERA TESTS PASSED SUCCESSFULLY! ---')
