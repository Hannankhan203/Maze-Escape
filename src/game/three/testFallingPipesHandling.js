/**
 * End-to-End Automated Verification Suite for MAZE-HAZARD-PIPES-ANIM-001
 * Physical Falling Pipes & Fixtures Handling, Coupled Player-Pipe Movement,
 * Procedural Animation & Crosshair Feedback Parity.
 */

import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  PIPES_ANIM_MODES,
  PIPES_HANDLING_STATES,
} from './FallingPipesController.js'
import {
  CROSSHAIR_TARGET_STATES,
  resolveCrosshairFeedbackState,
} from '../../components/game/centerCrosshairState.js'

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
  return {
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
}

function collapsePipesHazard(engine, hazard) {
  hazard.state = HAZARD_STATES.ACTIVE
  hazard.progress = 1.0
  hazard._updateVisualState(1.0)
  engine._syncHazardColliders?.()
}

export function runTestFallingPipesHandling() {
  console.log('=== Running MAZE-HAZARD-PIPES-ANIM-001 Automated Tests ===')

  const engine = createHeadlessEngine()
  const maze = buildTwoTileCorridorMaze()
  engine.initializeMaze(maze)

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
  engine._playerWorldPos.set(worldPos.x, 0, worldPos.z + 1.25)
  if (engine._playerGroup) {
    engine._playerGroup.position.copy(engine._playerWorldPos)
    engine._playerGroup.rotation.y = 0 // facing North toward pipes
  }
  engine.camera.position.set(worldPos.x, 1.7, worldPos.z + 2.2)
  engine.camera.lookAt(worldPos.x, 0.4, worldPos.z)
  engine.camera.updateMatrixWorld(true)

  // 4. Verify center-screen crosshair targets the fallen pipes
  const targetRes = engine.pipesController.updateTargeting({ x: 0, y: 0 })
  assert(
    targetRes !== null && targetRes.hazard.id === pipeHaz.id,
    '2a. Center-screen crosshair successfully targets fallen pipes within interaction range'
  )

  const stealthSnapshot = engine.getStealthSnapshot?.() || {}
  const crosshairState = resolveCrosshairFeedbackState({
    ...stealthSnapshot,
    pipesState: engine.pipesController.getStateName(),
    pipesCanGrip: engine.pipesController.getInteractionSnapshot().canGrip,
    pipesIsHandling: engine.pipesController.getInteractionSnapshot().isHandling,
    pipesTargetedHazardId: engine.pipesController.getInteractionSnapshot().targetedHazardId,
    pipesActiveHazardId: engine.pipesController.getInteractionSnapshot().activeHazardId,
    pipesFeedback: engine.pipesController.getInteractionSnapshot().feedbackMessage,
  })

  assert(
    crosshairState.targetState === CROSSHAIR_TARGET_STATES.VALID_TARGET,
    '2b. Crosshair transitions to VALID_TARGET state when aimed at fallen pipes'
  )
  assert(
    crosshairState.hintText && crosshairState.hintText.includes('Grip'),
    '2c. Crosshair displays Grip & push pipes interaction hint'
  )

  // 5. Left-click grip action
  const gripRes = engine.pipesController.tryStartHandling()
  assert(gripRes.handled === true, '3a. Left-click successfully initiates pipe gripping')
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.GRIPPING,
    '3b. Controller enters GRIPPING state'
  )

  // Step through grip duration
  engine.pipesController.update(0.5)
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.HANDLING,
    '3c. Controller progresses to HANDLING state with grip attached'
  )
  assert(
    engine.pipesController.isGripAttached() === true,
    '3d. Physical two-handed grip attached flag confirmed'
  )

  // 6. Coupled WASD movement and pushing/dragging
  const initialPose = pipeHaz.getPipesPose()
  const moveRes = engine.pipesController.stepCoupledMovement(0, -0.4, 0.016)
  assert(
    moveRes.moved === true,
    '4a. Coupled WASD movement pushes/drags fallen pipes across corridor floor'
  )
  const updatedPose = pipeHaz.getPipesPose()
  assert(
    updatedPose.dispLocalZ < initialPose.dispLocalZ,
    '4b. Pipe displacement advances toward corridor wall'
  )

  const handlingAnim = engine.pipesController.getAnimatorPayload()
  assert(
    handlingAnim.mode === PIPES_ANIM_MODES.PUSH_DRAG,
    '4c. Animator payload reports PUSH_DRAG mode'
  )

  // 7. Right-click release action
  const releaseRes = engine.pipesController.tryRelease()
  assert(releaseRes.handled === true, '5a. Right-click successfully initiates release sequence')
  engine.pipesController.update(0.4)
  assert(
    engine.pipesController.getStateName() === PIPES_HANDLING_STATES.IDLE,
    '5b. Controller safely returns to IDLE state after release'
  )

  // 8. Cleanup & disposal
  engine.pipesController.dispose()
  assert(engine.pipesController.isDisposed === true, '6a. FallingPipesController disposes cleanly')

  console.log(`=== Falling Pipes Test Results: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    globalThis.process?.exit?.(1)
  }
}

if (typeof window === 'undefined') {
  runTestFallingPipesHandling()
}
