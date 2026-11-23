import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  ELEVATOR_DECK_TOP_Y,
  getElevatorPoolStats,
  getElevatorTextureSet,
  resolveElevatorLayout,
} from './buildElevators.js'
import { buildMazeMeshes, disposeMazeGroup, MAZE_MESH_PALETTE } from './buildMazeMeshes.js'
import { applyHighContrastToScene } from './highContrastOutlines.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools, getActiveSharedPoolOwnerCount } from './sharedResources.js'

function createMockRenderer() {
  const renderer = {
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
  return renderer
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

function collectMeshNames(group) {
  const names = []
  group?.traverse((node) => {
    if (node?.name) names.push(node.name)
  })
  return names
}

function findFirstOpenNeighbor(maze, cell) {
  const dirs = [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: -1, dc: 0 },
    { dr: 0, dc: -1 },
  ]
  for (const { dr, dc } of dirs) {
    const nr = cell.row + dr
    const nc = cell.col + dc
    if (maze.grid[nr]?.[nc] === CELL_TYPES.PATH) {
      return { row: nr, col: nc, dr, dc }
    }
  }
  return null
}

console.log('--- RUNNING INDUSTRIAL START & EXTRACTION ELEVATOR TESTS ---')
disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Structural & Visual Inspection of Broken Start & Extraction Elevators
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Procedural broken start elevator & emergency extraction elevator anatomy')
  const maze = generateMaze({ difficulty: 'medium', seed: 7741 })
  const root = buildMazeMeshes(maze, { qualityPreset: 'high' })
  assert.ok(root, 'buildMazeMeshes returns scene root')

  const startEl = root.getObjectByName('maze-marker-start')
  const exitEl = root.getObjectByName('maze-marker-exit')
  assert.ok(startEl && startEl.userData.isStartElevator, 'Start marker replaced by broken industrial elevator')
  assert.ok(exitEl && exitEl.userData.isExitElevator, 'Exit marker replaced by emergency extraction elevator')

  const startNames = collectMeshNames(startEl)
  const exitNames = collectMeshNames(exitEl)

  // Verify old green/indigo circular & diamond visuals are completely removed
  assert.ok(!exitNames.includes('exit-floor-diamond'), 'Old green diamond marker removed')
  assert.ok(!exitNames.includes('exit-portal-ring'), 'Old floating green portal ring removed')
  assert.ok(!exitNames.includes('exit-base-pad'), 'Old circular/square glowing pad removed')

  // Verify required Broken Start Elevator details
  for (const required of [
    'start-elevator-pit-pan',
    'start-elevator-deck-main',
    'start-elevator-damaged-grate',
    'start-elevator-buckled-plate',
    'start-elevator-crosshead-beam',
    'start-elevator-sheave-wheel',
    'start-elevator-broken-door-left',
    'start-elevator-broken-door-right',
    'start-elevator-snapped-cable-1',
    'start-elevator-snapped-cable-2',
    'start-elevator-cable-coil',
    'start-elevator-exposed-wiring',
    'start-elevator-broken-call-panel',
    'start-elevator-dead-warning-light-0',
    'start-elevator-dead-warning-light-1',
  ]) {
    assert.ok(startNames.includes(required), `Start elevator includes ${required}`)
  }

  // Dead lamps on abandoned elevator should be dim/inactive
  const lampDome = startEl.getObjectByName('start-elevator-lamp-dome-0')
  assert.ok(
    lampDome?.material && lampDome.material.emissiveIntensity <= 0.1,
    'Start elevator warning lamps are dead/inactive'
  )

  // Verify all start/exit parts stay safely below 3.0m maze ceiling beams
  const startBounds = new THREE.Box3().setFromObject(startEl)
  const exitBounds = new THREE.Box3().setFromObject(exitEl)
  assert.ok(startBounds.max.y <= 2.85, `Start elevator height (${startBounds.max.y.toFixed(2)}m) clears 3m ceiling`)
  assert.ok(exitBounds.max.y <= 2.9, `Extraction elevator height (${exitBounds.max.y.toFixed(2)}m) clears 3m ceiling`)

  // Verify required Emergency Extraction Elevator details
  for (const required of [
    'extraction-elevator-platform',
    'extraction-elevator-threshold-sill',
    'extraction-elevator-header',
    'extraction-elevator-header-sign',
    'extraction-elevator-cabin-light',
    'extraction-elevator-winch-mount',
    'extraction-elevator-doors',
    'extraction-door-left-inner',
    'extraction-door-right-inner',
    'extraction-door-left-outer',
    'extraction-door-right-outer',
    'extraction-elevator-lock-bar',
    'extraction-elevator-control-panel',
    'extraction-control-keycard-reader',
    'extraction-control-status-screen',
    'extraction-control-call-button',
    'extraction-elevator-emergency-beacons',
    'extraction-elevator-hoist-cable-0',
    'extraction-elevator-traveler-cable',
  ]) {
    assert.ok(exitNames.includes(required), `Extraction elevator includes ${required}`)
  }

  // Verify high-contrast outlines adapt to box frames cleanly
  applyHighContrastToScene({ mazeGroup: root, enabled: true })
  assert.ok(startEl.userData.highContrastOutline?.visible, 'Start elevator high-contrast outline added')
  assert.ok(exitEl.userData.highContrastOutline?.visible, 'Extraction elevator high-contrast outline added')

  disposeMazeGroup(root)
  disposeAllSharedPools()
  console.log('✓ Broken start elevator & emergency extraction elevator structures verified')
}

// ---------------------------------------------------------------------------
// 2. Player Flush Spawn, Ramp Transition & Non-Blocking Movement / Triggers
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Player flush standing height, smooth exit & extraction entry across difficulties')
  for (const difficulty of ['easy', 'medium', 'hard', 'hardcore']) {
    let gameState = createInitialGameState(difficulty, 2026)
    const engine = createHeadlessEngine({ skipSpawnSequence: true })
    engine.setMaze(gameState.maze)

    const player = engine.getPlayer()
    const spawnPos = engine.getPlayerWorldPosition()
    assert.ok(
      Math.abs(spawnPos.y - ELEVATOR_DECK_TOP_Y) < 1e-5 &&
        Math.abs(player.position.y - ELEVATOR_DECK_TOP_Y) < 1e-5,
      `${difficulty}: player spawns standing flush on start elevator deck (y=${player.position.y})`
    )

    // Verify boot soles sit strictly at local y = 0 inside player group -> world y = ELEVATOR_DECK_TOP_Y
    const rig = player.userData.rig
    player.updateMatrixWorld(true)
    const soleBox = new THREE.Box3().setFromObject(rig.leftAnklePivot)
    assert.ok(
      Math.abs(soleBox.min.y - ELEVATOR_DECK_TOP_Y) <= 0.025,
      `${difficulty}: player boot sole sits flush on elevator deck (${soleBox.min.y.toFixed(4)} vs ${ELEVATOR_DECK_TOP_Y})`
    )

    // Step player out through open neighbor from starting elevator -> must NOT be blocked
    const openNext = findFirstOpenNeighbor(gameState.maze, gameState.maze.start)
    assert.ok(openNext, `${difficulty}: start has open neighbor`)
    const dirYaw = Math.atan2(-openNext.dc, -openNext.dr)
    engine.setLookDirection(dirYaw, 0)

    let leftStartCell = false
    for (let step = 0; step < 30; step += 1) {
      const res = engine.stepMovement({ forwardAxis: 1, strafeAxis: 0 }, 0.05)
      if (
        res.cell &&
        (res.cell.row !== gameState.maze.start.row ||
          res.cell.col !== gameState.maze.start.col)
      ) {
        leftStartCell = true
        break
      }
    }
    assert.ok(leftStartCell, `${difficulty}: player exits starting elevator smoothly without obstruction`)
    const corridorPos = engine.getPlayerWorldPosition()
    assert.ok(
      corridorPos.y < ELEVATOR_DECK_TOP_Y && corridorPos.y >= 0,
      `${difficulty}: stepping off elevator lowers player smoothly to corridor floor (y=${corridorPos.y})`
    )

    // Place player in corridor cell adjacent to exit and walk into extraction elevator
    const exitAdj = findFirstOpenNeighbor(gameState.maze, gameState.maze.exit)
    assert.ok(exitAdj, `${difficulty}: exit has open neighbor`)
    const approachYaw = Math.atan2(
      -(gameState.maze.exit.col - exitAdj.col),
      -(gameState.maze.exit.row - exitAdj.row)
    )
    engine.setPlayerGridPosition(exitAdj.row, exitAdj.col, { immediate: true, yaw: approachYaw })

    // Even when locked (to trigger HUD locked cue), player can approach onto exit tile
    let enteredExitCell = false
    engine.setMovementOptions({
      onPlayerCellChange: (cell) => {
        gameState = gameReducer(gameState, { type: 'SYNC_PLAYER_CELL', position: cell })
        if (
          cell.row === gameState.maze.exit.row &&
          cell.col === gameState.maze.exit.col
        ) {
          enteredExitCell = true
        }
      },
    })

    for (let step = 0; step < 30; step += 1) {
      engine.stepMovement({ forwardAxis: 1, strafeAxis: 0 }, 0.05)
      if (enteredExitCell) break
    }
    assert.ok(enteredExitCell, `${difficulty}: player walks unobstructed onto extraction elevator platform`)
    assert.equal(gameState.hasWon, false, `${difficulty}: locked extraction elevator still prevents premature win`)

    // Collect keycards, unlock extraction elevator, and re-enter to trigger victory
    while (gameState.keycards.length > 0) {
      const kc = gameState.keycards[0]
      gameState = gameReducer(gameState, {
        type: 'SYNC_PLAYER_CELL',
        position: { row: kc.row, col: kc.col },
      })
    }
    assert.equal(gameState.isExitLocked, false, `${difficulty}: keycards unlock extraction gate`)
    engine.setExitLocked(false, { animate: false })
    assert.equal(
      engine.getEnvironment().lights.exitLight,
      undefined,
      `${difficulty}: extraction elevator has no artificial localized chamber PointLight`
    )
    assert.equal(
      engine.getExitGateGroup().userData.beaconMat.emissive.getHex(),
      MAZE_MESH_PALETTE.exitAccent,
      `${difficulty}: physical extraction elevator status beacon switches to emergency emerald on unlock`
    )

    enteredExitCell = false
    engine.setPlayerGridPosition(exitAdj.row, exitAdj.col, { immediate: true, yaw: approachYaw })
    for (let step = 0; step < 30; step += 1) {
      engine.stepMovement({ forwardAxis: 1, strafeAxis: 0 }, 0.05)
      if (enteredExitCell) break
    }
    assert.equal(gameState.hasWon, true, `${difficulty}: unlocked extraction elevator completes level cleanly`)

    engine.dispose()
  }
  disposeAllSharedPools()
  console.log('✓ Flush player grounding, non-blocking travel, and win trigger verified across all difficulties')
}

// ---------------------------------------------------------------------------
// 3. Multi-Open-Neighbor Braided Safety, Corner Column Collisions & Quality Scaling
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Multi-open braided layout safety, pylon collision & quality/disposal checks')

  // Custom 5x5 grid where start & exit each have 3 open neighbors (North, East, South/West)
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  const customMaze = {
    id: 'braided-elevator-test',
    rows: 5,
    cols: 5,
    start: { row: 1, col: 1 },
    exit: { row: 3, col: 3 },
    grid: [
      [W, W, W, W, W],
      [W, P, P, P, W],
      [W, P, P, P, W],
      [W, P, P, P, W],
      [W, W, W, W, W],
    ],
    keycards: [],
    collectibles: { coins: [], powerUps: [] },
  }

  const startLayout = resolveElevatorLayout(customMaze, customMaze.start)
  assert.equal(startLayout.localSides.front, true, 'Front open toward East primary corridor')
  assert.equal(startLayout.localSides.right, true, 'Secondary South side remains open')

  const engine = createHeadlessEngine({ graphics: { qualityPreset: 'performance' } })
  engine.setMaze(customMaze)

  // Move South out of start (secondary open side) -> must NOT be blocked by wall-backed bulkhead
  engine.setLookDirection(Math.PI, 0) // South (+Z)
  let movedSouth = false
  for (let i = 0; i < 25; i += 1) {
    const res = engine.stepMovement({ forwardAxis: 1, strafeAxis: 0 }, 0.05)
    if (res.cell && res.cell.row === 2 && res.cell.col === 1) {
      movedSouth = true
      break
    }
  }
  assert.ok(movedSouth, 'Player can exit start elevator via secondary braided open side without blockage')

  // Verify corner structural column physically blocks player pushing straight into corner post
  const startWorld = gridToWorld(1, 1, customMaze)
  engine.setPlayerWorldPosition(startWorld.x + 1.0, ELEVATOR_DECK_TOP_Y, startWorld.z + 1.0, {
    immediate: true,
    yaw: Math.atan2(-1, -1),
  })
  const pushCorner = engine.stepMovement({ forwardAxis: 1, strafeAxis: 0 }, 0.2)
  assert.ok(
    pushCorner.position.x < startWorld.x + 1.66 &&
      pushCorner.position.z < startWorld.z + 1.66,
    'Elevator corner structural column constrains player collision cleanly'
  )

  // Verify DataTexture scaling across presets & clean pool disposal
  assert.equal(getElevatorTextureSet({ qualityPreset: 'performance' }).size, 64)
  assert.equal(getElevatorTextureSet({ qualityPreset: 'balanced' }).size, 128)
  assert.equal(getElevatorTextureSet({ qualityPreset: 'high' }).size, 256)

  engine.dispose()
  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Zero lingering pool owners after dispose')
  assert.equal(getElevatorPoolStats().textures, 0, 'Elevator procedural texture pools fully disposed')
  assert.equal(getElevatorPoolStats().presets, 0, 'Elevator texture preset map cleared')
  console.log('✓ Multi-open safety, column collision, quality tiers & clean disposal verified')
}

console.log('=== ALL INDUSTRIAL ELEVATOR PHASE 1 TESTS PASSED! ===')
