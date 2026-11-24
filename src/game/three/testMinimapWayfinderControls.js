import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import {
  MINIMAP_LOGICAL_SIZE,
  buildMinimapSnapshot,
  createExplorationState,
  isCellDiscovered,
  renderMinimapCanvas,
  revealAroundCell,
} from '../mechanics/minimap.js'
import {
  computeWayfinderHint,
  DEFAULT_MAX_WAYFINDER_HINTS,
} from '../mechanics/wayfinder.js'
import { SETTINGS_SCHEMA } from '../../components/settings/settingsConfig.js'
import { CameraRig } from './CameraRig.js'
import { createContinuousInputController } from '../../hooks/useContinuousInput.js'
import { loadPreferences, savePreferences } from '../../utils/persistence.js'

function createMockStorage() {
  const map = new Map()
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null
    },
    setItem(k, v) {
      map.set(k, String(v))
    },
    removeItem(k) {
      map.delete(k)
    },
  }
}

console.log('--- Running Phase E Prompt 07 Tests: Minimap, Wayfinder & Control Settings ---')

// ---------------------------------------------------------------------------
// 1. Progressive Fog-of-War Exploration & Privacy Guarantees
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Fog-of-war progressive discovery, heading math, and enemy-privacy')

  const maze = generateMaze({ difficulty: 'medium', seed: 551199 })
  const exploration = createExplorationState(maze)

  assert.equal(isCellDiscovered(exploration, maze.start.row, maze.start.col), true)
  // Exit is at the farthest reachable cell so it must NOT be discovered at start
  assert.equal(isCellDiscovered(exploration, maze.exit.row, maze.exit.col), false)

  const startSnapshot = buildMinimapSnapshot({
    maze,
    exploration,
    playerCell: maze.start,
    yaw: 0,
    items: maze.collectibles.items,
    keycards: maze.keycards,
    objectivesEnabled: true,
    isExitLocked: true,
    // Adversarial extra field must be completely ignored
    enemies: [{ id: 'stalker-1', row: maze.exit.row, col: maze.exit.col }],
  })

  assert.ok(startSnapshot.start, 'Start marker should be visible once start cell is discovered')
  assert.equal(startSnapshot.exit, null, 'Unexplored exit must stay hidden under fog')
  assert.equal('enemies' in startSnapshot, false, 'Minimap snapshot must never expose enemies')
  assert.ok(
    startSnapshot.exploredCells.length < maze.rows * maze.cols,
    'Unexplored maze cells must stay hidden at start'
  )

  // Heading vectors match CameraRig convention
  assert.ok(Math.abs(startSnapshot.player.headingX) < 1e-6)
  assert.ok(Math.abs(startSnapshot.player.headingY - -1) < 1e-6) // yaw 0 -> North (-Y on minimap)

  const eastSnapshot = buildMinimapSnapshot({
    maze,
    exploration,
    playerCell: maze.start,
    yaw: -Math.PI / 2,
  })
  assert.ok(Math.abs(eastSnapshot.player.headingX - 1) < 1e-6) // yaw -PI/2 -> East (+X)
  assert.ok(Math.abs(eastSnapshot.player.headingY) < 1e-6)

  // Undiscovered keycards must not leak before exploration
  const distantKeycard = maze.keycards.find(
    (k) => !isCellDiscovered(exploration, k.row, k.col)
  )
  assert.ok(distantKeycard, 'Expected at least one keycard outside initial fog')
  assert.equal(
    startSnapshot.keycards.some((k) => k.id === distantKeycard.id),
    false,
    'Unexplored keycard must not appear on minimap'
  )

  // Walk along shortest path to exit -> exit and passed cells become discovered
  const pathToExit = findShortestPath(maze.grid, maze.start, maze.exit).path
  const prevDiscovered = exploration.discoveredCount
  for (let i = 0; i < pathToExit.length; i += 1) {
    revealAroundCell(exploration, maze, pathToExit[i])
  }
  assert.ok(exploration.discoveredCount > prevDiscovered)
  assert.equal(isCellDiscovered(exploration, maze.exit.row, maze.exit.col), true)

  const exitSnapshot = buildMinimapSnapshot({
    maze,
    exploration,
    playerCell: maze.exit,
    keycards: maze.keycards,
    objectivesEnabled: true,
    isExitLocked: true,
  })
  assert.deepEqual(exitSnapshot.exit, {
    row: maze.exit.row,
    col: maze.exit.col,
    locked: true,
  })

  // Reveal around distant keycard -> it appears on minimap
  revealAroundCell(exploration, maze, distantKeycard)
  const keyVisibleSnapshot = buildMinimapSnapshot({
    maze,
    exploration,
    playerCell: distantKeycard,
    keycards: maze.keycards,
    objectivesEnabled: true,
    isExitLocked: true,
  })
  assert.equal(
    keyVisibleSnapshot.keycards.some((k) => k.id === distantKeycard.id),
    true,
    'Discovered keycard should appear on minimap'
  )

  console.log('✓ Fog-of-war progression, heading alignment, and enemy-privacy verified')
}

// ---------------------------------------------------------------------------
// 2. Exploration Reset on Replay, New Maze & Difficulty Switch
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Exploration resets cleanly on replay, new maze, and difficulty change')

  const mediumMaze = generateMaze({ difficulty: 'medium', seed: 778899 })
  const expRun1 = createExplorationState(mediumMaze)
  revealAroundCell(expRun1, mediumMaze, mediumMaze.exit)
  assert.equal(isCellDiscovered(expRun1, mediumMaze.exit.row, mediumMaze.exit.col), true)

  // Replay same maze -> fresh exploration state hides exit again
  const expReplay = createExplorationState(mediumMaze)
  assert.equal(isCellDiscovered(expReplay, mediumMaze.exit.row, mediumMaze.exit.col), false)

  // Difficulty change -> new grid dimensions and clean exploration state
  const largeMaze = generateMaze({ difficulty: 'large', seed: 778899 })
  const expLarge = createExplorationState(largeMaze)
  assert.equal(expLarge.rows, largeMaze.rows)
  assert.equal(expLarge.cols, largeMaze.cols)
  assert.equal(isCellDiscovered(expLarge, largeMaze.exit.row, largeMaze.exit.col), false)

  console.log('✓ Minimap exploration reset verified across replay, new maze, and difficulty switches')
}

// ---------------------------------------------------------------------------
// 3. Wayfinder Hints: Locked-Exit Objectives, Privacy & Input Shortcuts
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Wayfinder guides to nearest keycard when locked, then exit when unlocked')

  const maze = generateMaze({ difficulty: 'large', seed: 334455 })
  assert.equal(maze.keycards.length, 2)
  assert.equal(DEFAULT_MAX_WAYFINDER_HINTS, 3)

  // Pick nearest keycard expected distance via BFS
  let expectedMinDist = Infinity
  for (const k of maze.keycards) {
    const res = findShortestPath(maze.grid, maze.start, k)
    if (res.distance < expectedMinDist) expectedMinDist = res.distance
  }

  const lockedHint = computeWayfinderHint({
    maze,
    playerCell: maze.start,
    keycards: maze.keycards,
    objectivesEnabled: true,
    isExitLocked: true,
  })

  assert.equal(lockedHint.found, true)
  assert.equal(lockedHint.targetType, 'keycard')
  assert.equal(lockedHint.distanceSteps, expectedMinDist)
  assert.ok(lockedHint.nextStep, 'Hint should return immediate nextStep cell')
  assert.equal('path' in lockedHint, false, 'Hint must not leak full unexplored path')
  assert.equal('enemies' in lockedHint, false, 'Hint must not expose enemy locations')

  // Once all keycards collected and exit unlocked -> hint targets Exit Gate
  const exitDist = findShortestPath(maze.grid, maze.start, maze.exit).distance
  const unlockedHint = computeWayfinderHint({
    maze,
    playerCell: maze.start,
    keycards: [],
    objectivesEnabled: true,
    isExitLocked: false,
  })

  assert.equal(unlockedHint.found, true)
  assert.equal(unlockedHint.targetType, 'exit')
  assert.equal(unlockedHint.distanceSteps, exitDist)

  // Verify M no longer triggers minimap toggle while H (wayfinder hint) and L (flashlight) work
  let hintTriggers = 0
  let flashlightToggles = 0

  const input = createContinuousInputController({
    onTriggerWayfinder: () => {
      hintTriggers += 1
    },
    onToggleFlashlight: () => {
      flashlightToggles += 1
    },
  })

  input.handleKeyDown({ key: 'm', repeat: false })
  input.handleKeyDown({ key: 'M', repeat: false })
  input.handleKeyDown({ key: 'h', repeat: false })
  input.handleKeyDown({ key: 'h', repeat: true }) // repeat must be ignored
  input.handleKeyDown({ key: 'l', repeat: false })
  assert.equal(hintTriggers, 1)
  assert.equal(flashlightToggles, 1)

  // Editable targets must NOT trigger shortcuts
  input.handleKeyDown({ key: 'h', target: { tagName: 'TEXTAREA' } })
  assert.equal(hintTriggers, 1)

  console.log('✓ Wayfinder objective targeting, layout privacy, H/L shortcuts, and M-key removal verified')
}

// ---------------------------------------------------------------------------
// 4. Control Settings: Immediate Camera Application & Persistence
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Mouse sensitivity & invert-Y immediate application and persistence')

  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 100)
  const rig = new CameraRig(camera, {
    sensitivity: 0.0022,
    invertY: false,
  })

  rig.setLookDirection(0, 0)
  rig.applyLookDelta(100, 100)
  const normalLook = rig.getLookDirection()
  assert.ok(normalLook.yaw < 0)
  assert.ok(normalLook.pitch < 0)

  // Apply updated sensitivity & invertY immediately via updateConfig
  rig.setLookDirection(0, 0)
  rig.updateConfig({
    sensitivity: 0.0044,
    invertY: true,
  })
  rig.applyLookDelta(100, 100)
  const invertedLook = rig.getLookDirection()

  assert.ok(
    Math.abs(invertedLook.yaw - normalLook.yaw * 2) < 1e-6,
    'Doubled sensitivity should immediately double yaw delta'
  )
  assert.ok(
    invertedLook.pitch > 0 && Math.abs(invertedLook.pitch - Math.abs(normalLook.pitch) * 2) < 1e-6,
    'Invert-Y should immediately reverse and scale pitch delta'
  )

  rig.dispose()

  // Persist and restore through Prompt 06 persistence system
  const storage = createMockStorage()
  const basePrefs = loadPreferences(storage)
  const updatedPrefs = {
    ...basePrefs,
    controlSettings: {
      ...basePrefs.controlSettings,
      mouseSensitivity: 0.0044,
      touchLookSensitivity: 3.6,
      invertY: true,
      touchControls: 'always',
    },
  }
  savePreferences(updatedPrefs, storage)
  const restored = loadPreferences(storage)

  assert.equal(restored.controlSettings.mouseSensitivity, 0.0044)
  assert.equal(restored.controlSettings.touchLookSensitivity, 3.6)
  assert.equal(restored.controlSettings.invertY, true)
  assert.equal(restored.controlSettings.touchControls, 'always')

  console.log('✓ Immediate camera control updates and persistence restoration verified')
}

// ---------------------------------------------------------------------------
// 5. Settings Schema Cleanup & Canvas Fog-of-War / Player Orientation Accuracy
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Settings cleanup (no M minimap toggle) and canvas progressive reveal & yaw accuracy')

  const controlItems = SETTINGS_SCHEMA.controls.flatMap((g) => g.items || [])
  const keybindTable = controlItems.find((item) => item.id === 'keybinds')
  assert.ok(keybindTable, 'Keybinds reference table exists in controls settings')
  assert.equal(
    keybindTable.bindings.some(
      (b) => b.action === 'Tactical Minimap' || (Array.isArray(b.keys) && b.keys.includes('M'))
    ),
    false,
    'Obsolete Tactical Minimap (M) entry is completely removed from Settings schema'
  )
  assert.equal(
    Object.values(SETTINGS_SCHEMA)
      .flat()
      .flatMap((g) => g.items || [])
      .some((item) => /minimap/i.test(item.id || '') || /minimap/i.test(item.label || '')),
    false,
    'No minimap visibility toggle exists in Settings schema'
  )

  const maze = generateMaze({ difficulty: 'medium', seed: 112233 })
  const exploration = createExplorationState(maze)

  function createSpyCanvas() {
    const fillRects = []
    const moveTos = []
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      setTransform() {},
      fillRect(x, y, w, h) {
        fillRects.push({ x, y, w, h, fillStyle: ctx.fillStyle })
      },
      strokeRect() {},
      beginPath() {},
      arc() {},
      moveTo(x, y) {
        moveTos.push({ x, y })
      },
      lineTo() {},
      closePath() {},
      fill() {},
      stroke() {},
    }
    return {
      width: MINIMAP_LOGICAL_SIZE,
      height: MINIMAP_LOGICAL_SIZE,
      getContext: (type) => (type === '2d' ? ctx : null),
      fillRects,
      moveTos,
    }
  }

  const canvasStart = createSpyCanvas()
  renderMinimapCanvas(canvasStart, {
    maze,
    exploration,
    playerCell: maze.start,
    yaw: 0,
    logicalSize: MINIMAP_LOGICAL_SIZE,
    dpr: 1,
  })
  // 1 background rect + exploredCells count (exit not discovered yet -> no exit rect)
  assert.equal(
    canvasStart.fillRects.length,
    1 + exploration.discoveredCount,
    'Canvas draws strictly the currently discovered cells plus background fog'
  )
  const initialCellRects = canvasStart.fillRects.length

  // Move along shortest path -> newly explored cells appear on canvas
  const pathToExit = findShortestPath(maze.grid, maze.start, maze.exit).path
  const stepCell = pathToExit[Math.min(4, pathToExit.length - 1)]
  revealAroundCell(exploration, maze, stepCell)

  const canvasMovedNorth = createSpyCanvas()
  renderMinimapCanvas(canvasMovedNorth, {
    maze,
    exploration,
    playerCell: stepCell,
    yaw: 0,
    logicalSize: MINIMAP_LOGICAL_SIZE,
    dpr: 1,
  })
  assert.ok(
    canvasMovedNorth.fillRects.length > initialCellRects,
    'Canvas draws newly explored cells as player moves'
  )

  const canvasMovedEast = createSpyCanvas()
  renderMinimapCanvas(canvasMovedEast, {
    maze,
    exploration,
    playerCell: stepCell,
    yaw: -Math.PI / 2,
    logicalSize: MINIMAP_LOGICAL_SIZE,
    dpr: 1,
  })
  // Player arrow tip is the last moveTo call; facing North (yaw=0) has smaller Y than center, facing East (yaw=-PI/2) has larger X
  const northArrowTip = canvasMovedNorth.moveTos.at(-1)
  const eastArrowTip = canvasMovedEast.moveTos.at(-1)
  assert.ok(
    eastArrowTip.x > northArrowTip.x && eastArrowTip.y > northArrowTip.y,
    'Player arrow orientation on minimap canvas rotates accurately with yaw'
  )

  console.log('✓ Settings schema cleanup and canvas fog-of-war / orientation verified')
}

console.log('=== All Phase E Prompt 07 Tests Passed ===')
