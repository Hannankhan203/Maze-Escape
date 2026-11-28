/**
 * End-to-End Automated Verification Suite for MAZE-HAZARD-PIPES-ANIM-002
 * Left-Click Pipe Handling, F-Key Hazard Audit & Hiding Spot Preservation,
 * First-Person & Third-Person Camera Modes, Crosshair Feedback Parity.
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
} from './FallingPipesController.js'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    console.error(`  ✗ FAIL: ${message}`)
  }
}

function createMockHost(width = 960, height = 540) {
  return {
    clientWidth: width,
    clientHeight: height,
    children: [],
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
  return new MazeSceneEngine(host, {
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
}

function buildTwoTileCorridorMaze() {
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  const maze = {
    rows: 5,
    cols: 9,
    cellSize: CELL_SIZE,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 7 },
    grid: [
      [W, W, W, W, W, W, W, W, W],
      [W, P, P, P, P, P, P, P, W],
      [W, W, W, W, W, W, W, W, W],
      [W, P, P, P, P, P, P, P, W],
      [W, W, W, W, W, W, W, W, W],
    ],
  }
  const hsWorld = gridToWorld(1, 2, maze)
  maze.hidingSpots = [
    {
      id: 'hs-1',
      row: 1,
      col: 2,
      x: hsWorld.x,
      z: hsWorld.z,
      type: 'wall_alcove',
      wallSide: 'north',
      entryAnchor: { x: hsWorld.x, z: hsWorld.z + 0.8 },
      interiorAnchor: { x: hsWorld.x, z: hsWorld.z - 0.8 },
    },
  ]
  return maze
}

function collapsePipesHazard(engine, hazard) {
  hazard.state = HAZARD_STATES.DISABLED
  hazard.isPermanentlyCollapsed = true
  hazard._syncColliderStates(1)
  engine._syncHazardColliders?.()
}

export function runTestFallingPipesHandling() {
  console.log('=== Running MAZE-HAZARD-PIPES-ANIM-002 Automated Tests (14 Points) ===')

  const engine = createHeadlessEngine()
  const maze = buildTwoTileCorridorMaze()
  engine.setMaze(maze)
  engine.gridToWorldCenter = (r, c) => {
    const w = gridToWorld(r, c, maze)
    return new THREE.Vector3(w.x, w.y, w.z)
  }

  // 1. Spawn Falling Pipes hazard at (1, 3)
  const pipeHaz = engine.hazardManager.addHazard({
    type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    row: 1,
    col: 3,
    mountType: 'ceiling',
    pipeYaw: 0,
  })

  assert(Boolean(pipeHaz), '1a. Falling pipes hazard successfully spawned')
  assert(Boolean(engine.pipesController), '1b. FallingPipesController instantiated in engine')

  // 2. Collapse the pipes hazard
  collapsePipesHazard(engine, pipeHaz)
  assert(
    pipeHaz.isCollapsedForPipesHandling(),
    '1c. Falling pipes hazard enters collapsed/grounded state for physical handling'
  )

  // 3. Position player near the fallen pipes
  const worldPos = engine.gridToWorldCenter(1, 3)
  engine._playerWorldPos.x = worldPos.x
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = worldPos.z + 1.25
  if (engine._playerGroup) {
    engine._playerGroup.position.copy(engine._playerWorldPos)
    engine._playerGroup.rotation.y = 0
  }
  engine.camera.position.set(worldPos.x, 1.7, worldPos.z + 2.2)
  engine.camera.lookAt(worldPos.x, 0.4, worldPos.z)
  engine.camera.updateMatrixWorld(true)

  // Test Point 1: Left-click starts pipe gripping via handlePrimaryAction()
  engine.pipesController.updateTargeting({ x: 0, y: 0 })
  const primaryGrip = engine.handlePrimaryAction()
  assert(
    primaryGrip.handled === true &&
      engine.pipesController.getStateName() === PIPES_HANDLING_STATES.GRIPPING,
    'Point 1: Left-click (handlePrimaryAction) starts pipe gripping'
  )

  // Test Point 2: F does not clear or remove fallen pipes (interact() returns unhandled / action: null)
  engine.pipesController.interruptHandling({ immediate: true })
  const fInteract = engine.interact()
  assert(
    fInteract.handled !== true || fInteract.action !== 'clear_pipe',
    'Point 2: F key does not clear or remove fallen pipes'
  )

  // Re-grip for further tests
  engine.pipesController.updateTargeting({ x: 0, y: 0 })
  engine.handlePrimaryAction()
  engine.pipesController.update(0.5) // reach handling state

  // Test Point 3: WASD moves pipe and player together
  const initialPose = pipeHaz.getPipesPose()
  const moveRes = engine.pipesController.stepCoupledMovement(0, -0.4, 0.016)
  const updatedPose = pipeHaz.getPipesPose()
  assert(
    moveRes.moved === true && updatedPose.dispLocalZ < initialPose.dispLocalZ,
    'Point 3: WASD moves pipe and player together'
  )

  // Test Point 4: Right-click releases the pipe (handleSecondaryAction)
  const secondaryRelease = engine.handleSecondaryAction()
  engine.pipesController.update(0.4)
  assert(
    secondaryRelease.handled === true &&
      engine.pipesController.getStateName() === PIPES_HANDLING_STATES.IDLE,
    'Point 4: Right-click (handleSecondaryAction) releases the pipe'
  )

  // Test Point 5: Left-click resumes handling
  engine.pipesController.updateTargeting({ x: 0, y: 0 })
  const resumeRes = engine.handlePrimaryAction()
  assert(
    resumeRes.handled === true &&
      engine.pipesController.getStateName() === PIPES_HANDLING_STATES.GRIPPING,
    'Point 5: Left-click resumes handling released pipe'
  )
  engine.pipesController.interruptHandling({ immediate: true })

  // Test Point 6: First-Person targeting works
  engine.cameraRig.setMode(CAMERA_MODES.FIRST_PERSON, { immediate: true })
  engine.camera.position.set(worldPos.x, 1.7, worldPos.z + 1.2)
  engine.camera.lookAt(worldPos.x, 0.4, worldPos.z)
  engine.camera.updateMatrixWorld(true)
  const fpTarget = engine.pipesController.updateTargeting({ x: 0, y: 0 })
  assert(
    fpTarget !== null && fpTarget.hazard.id === pipeHaz.id,
    'Point 6: First-Person targeting works'
  )

  // Test Point 7: Third-Person Character Follow targeting works
  engine.cameraRig.setMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.cameraRig.setThirdPersonMode('character-follow')
  engine.camera.updateMatrixWorld(true)
  const tpFollowTarget = engine.pipesController.updateTargeting({ x: 0, y: 0 })
  assert(
    tpFollowTarget !== null && tpFollowTarget.hazard.id === pipeHaz.id,
    'Point 7: Third-Person Character Follow targeting works'
  )

  // Test Point 8: Third-Person Free Look targeting works
  engine.cameraRig.setThirdPersonMode('free-look')
  engine.camera.updateMatrixWorld(true)
  const tpFreeTarget = engine.pipesController.updateTargeting({ x: 0, y: 0 })
  assert(
    tpFreeTarget !== null && tpFreeTarget.hazard.id === pipeHaz.id,
    'Point 8: Third-Person Free Look targeting works'
  )

  // Test Point 9: Ceiling rubble left-click handling still works
  const rubbleHaz = engine.hazardManager.addHazard({
    type: HAZARD_TYPES.CEILING_COLLAPSE,
    row: 1,
    col: 5,
  })
  const rubbleWorld = engine.gridToWorldCenter(1, 5)
  rubbleHaz.update(0.05, {
    playerWorldPos: { x: rubbleWorld.x, y: 0, z: rubbleWorld.z },
    playerGridCell: { row: 1, col: 5 },
  })
  for (let i = 0; i < 45; i += 1) {
    rubbleHaz.update(0.06, {
      playerWorldPos: { x: rubbleWorld.x - 10, y: 0, z: rubbleWorld.z - 10 },
      playerGridCell: { row: 1, col: 1 },
    })
  }
  engine._syncHazardColliders?.({ allowPushOut: false })
  const pieces = rubbleHaz.getRubblePieces?.() || []
  if (pieces.length > 0) {
    const piece = pieces[0]
    piece.mesh.updateMatrixWorld(true)
    const target = new THREE.Vector3()
    piece.mesh.getWorldPosition(target)
    engine._playerWorldPos.x = target.x - 1.2
    engine._playerWorldPos.y = 0
    engine._playerWorldPos.z = target.z
    engine.camera.position.set(target.x - 1.2, 1.7, target.z)
    engine.camera.lookAt(target.x, target.y + 0.1, target.z)
    engine.camera.updateMatrixWorld(true)
  }
  engine.rubbleController.updateTargeting({ x: 0, y: 0 })
  const rubblePickup = engine.handlePrimaryAction()
  assert(
    rubblePickup.handled === true,
    'Point 9: Ceiling rubble left-click handling still works'
  )
  engine.rubbleController.reset()

  // Test Point 10: Rotten furniture left-click handling still works
  const furnHaz = engine.hazardManager.addHazard({
    type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    row: 1,
    col: 4,
    wallSide: 'north',
  })
  furnHaz.state = HAZARD_STATES.DISABLED
  engine._syncHazardColliders?.()
  const furnWorld = engine.gridToWorldCenter(1, 4)
  engine._playerWorldPos.x = furnWorld.x
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = furnWorld.z + 1.2
  engine.camera.position.set(furnWorld.x, 1.7, furnWorld.z + 2.0)
  engine.camera.lookAt(furnWorld.x, 0.4, furnWorld.z)
  engine.camera.updateMatrixWorld(true)
  engine.furnitureController.updateTargeting({ x: 0, y: 0 })
  const furnGrip = engine.handlePrimaryAction()
  assert(
    furnGrip.handled === true,
    'Point 10: Rotten furniture left-click handling still works'
  )
  engine.furnitureController.reset()

  // Test Point 11: F still enters hiding spots
  const hidingSpot = engine.hidingSpotManager.getHidingSpots()[0]
  const entry = hidingSpot.entryAnchor || engine.gridToWorldCenter(hidingSpot.row, hidingSpot.col)
  engine._playerWorldPos.x = entry.x
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = entry.z
  if (engine._playerGroup) {
    engine._playerGroup.position.set(entry.x, 0, entry.z)
  }
  engine.camera.position.set(entry.x, 1.7, entry.z + 0.8)
  engine.camera.lookAt(hidingSpot.interiorAnchor?.x || entry.x, 0.8, hidingSpot.interiorAnchor?.z || (entry.z - 1.0))
  engine.camera.updateMatrixWorld(true)
  engine._notifyStealthChange?.(true)
  const enterHiding = engine.interact()
  assert(
    enterHiding.handled === true && engine.hidingSpotManager.isPlayerHiding(),
    'Point 11: F key still enters hiding spots'
  )

  // Test Point 12: F still exits hiding spots
  const exitHiding = engine.interact()
  assert(
    exitHiding.handled === true && !engine.hidingSpotManager.isPlayerHiding(),
    'Point 12: F key still exits hiding spots'
  )

  // Test Point 13 & 14: F cannot trigger conflicting actions & obsolete shortcuts are unreachable
  const obsoleteClear = engine.hazardManager.interactWithHazard(pipeHaz.id)
  assert(
    obsoleteClear.handled !== true,
    'Points 13 & 14: Obsolete hazard clearing shortcuts are unreachable'
  )

  engine.dispose()

  console.log(`=== Falling Pipes Test Results (14 Points): ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    globalThis.process?.exit?.(1)
  }
}

if (typeof window === 'undefined') {
  runTestFallingPipesHandling()
}
