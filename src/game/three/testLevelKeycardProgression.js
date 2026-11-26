import assert from 'node:assert/strict'
import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { placeKeycards, placeKeycardsWithReport, KEYCARD_TYPE, STANDARD_KEYCARD_COUNT } from '../generation/keycardPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { exploreReachableCells, validateMaze } from '../generation/pathfinder.js'
import { KEYCARD_COLLECTIBLE_TYPE } from '../mechanics/collectiblesConfig.js'
import {
  DEFAULT_MAZE_PROGRESSION_CONFIG,
  INITIAL_BASE_SEED,
  getLevelConfig,
} from '../mechanics/levelProgression.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

const MILESTONE_LEVELS = [1, 2, 5, 10, 15, 20, 25, 26, 50, 100]

function createHeadlessCanvasHost() {
  return {
    clientWidth: 800,
    clientHeight: 500,
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
  }
}

function createFakeRendererFactory() {
  return () => ({
    domElement: {
      style: {},
      remove() {},
    },
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: '',
    setPixelRatio() {},
    setSize() {},
    render() {},
    dispose() {},
  })
}

console.log('--- RUNNING LEVEL-AWARE KEYCARD PROGRESSION & GATE SYNC TESTS ---')

// ---------------------------------------------------------------------------
// 1. Milestone Levels (1, 2, 5, 10, 15, 20, 25, 26, 50, 100)
//    Scaling, permanence, reachability, non-overlap & metadata synchronization
// ---------------------------------------------------------------------------
console.log('Test 1: Milestone levels keycard scaling, permanence & metadata synchronization')
{
  let previousMinRange = 0
  let previousMaxRange = 0

  for (const level of MILESTONE_LEVELS) {
    const levelCfg = getLevelConfig(level, INITIAL_BASE_SEED)
    const maze = generateMaze({ level, baseSeed: INITIAL_BASE_SEED })

    assert.equal(KEYCARD_TYPE, KEYCARD_COLLECTIBLE_TYPE, 'Keycard category constant matches')
    assert.equal(
      maze.collectibleSelection.keycardSelected,
      true,
      `Level ${level} always keeps keycards permanently active`
    )
    assert.equal(
      maze.collectibleSelection.selectedCategories.includes(KEYCARD_COLLECTIBLE_TYPE),
      true,
      `Level ${level} includes resonance_keycard in selectedCategories`
    )

    const range = levelCfg.keycardAllocation?.range
    assert.ok(range, `Level ${level} exposes keycardAllocation.range in getLevelConfig`)
    assert.ok(
      range.min >= previousMinRange && range.max >= previousMaxRange,
      `Level ${level} keycard range [${range.min}, ${range.max}] does not regress below [${previousMinRange}, ${previousMaxRange}]`
    )
    previousMinRange = range.min
    previousMaxRange = range.max

    const allocatedCount = levelCfg.keycardAllocation.allocatedCount
    assert.equal(
      allocatedCount,
      maze.collectibleAllocation.keycardCount,
      `Level ${level} getLevelConfig allocatedCount matches maze.collectibleAllocation.keycardCount`
    )
    assert.ok(
      allocatedCount >= range.min && allocatedCount <= range.max,
      `Level ${level} allocatedCount (${allocatedCount}) stays inside [${range.min}, ${range.max}]`
    )

    assert.ok(maze.keycardMetadata, `Level ${level} exposes keycardMetadata`)
    assert.equal(maze.keycardMetadata.category, KEYCARD_COLLECTIBLE_TYPE)
    assert.equal(maze.keycardMetadata.allocatedCount, allocatedCount)
    assert.equal(maze.keycardMetadata.placedCount, maze.keycards.length)
    assert.equal(maze.keycardMetadata.requiredCount, maze.keycards.length)
    assert.equal(maze.requiredKeys, maze.keycards.length)
    assert.equal(maze.keycardMetadata.shortfallCount, 0)
    assert.equal(maze.keycardMetadata.hadShortfall, false)
    assert.equal(maze.keycardMetadata.isExitLockedByDefault, maze.keycards.length > 0)

    const kcReport = maze.collectiblePlacementReport.keycardReport
    assert.equal(kcReport.allocatedCount, allocatedCount)
    assert.equal(kcReport.placedCount, maze.keycards.length)
    assert.equal(kcReport.requiredCount, maze.keycards.length)
    assert.equal(kcReport.shortfallCount, 0)
    assert.equal(kcReport.hadShortfall, false)

    // Verify all keycards are reachable, unique, and avoid start, exit, hazards, and items
    const reach = exploreReachableCells(maze.grid, maze.start)
    assert.equal(validateMaze(maze).valid, true, `Level ${level} maze is valid and solvable`)

    const blockedCells = new Set([
      `${maze.start.row},${maze.start.col}`,
      `${maze.exit.row},${maze.exit.col}`,
      ...maze.hazards.map((h) => `${h.row},${h.col}`),
      ...maze.collectibles.items.map((item) => `${item.row},${item.col}`),
    ])
    const seenKeyCells = new Set()
    const seenKeyIds = new Set()

    for (const kc of maze.keycards) {
      const key = `${kc.row},${kc.col}`
      assert.equal(maze.grid[kc.row]?.[kc.col], CELL_TYPES.PATH, `Level ${level} keycard on PATH`)
      assert.equal(reach.distances.has(key), true, `Level ${level} keycard reachable from start`)
      assert.equal(blockedCells.has(key), false, `Level ${level} keycard avoids start/exit/hazards/items`)
      assert.equal(seenKeyCells.has(key), false, `Level ${level} keycard cell is unique`)
      assert.equal(seenKeyIds.has(kc.id), false, `Level ${level} keycard ID is unique`)
      seenKeyCells.add(key)
      seenKeyIds.add(kc.id)
    }

    // Verify reducer initializes synchronized counts
    const state = createInitialGameState({ maze })
    assert.equal(state.totalKeys, maze.requiredKeys, `Level ${level} state.totalKeys matches maze.requiredKeys`)
    assert.equal(state.keycards.length, maze.keycards.length, `Level ${level} state.keycards matches maze.keycards`)
    assert.equal(state.keysCollected, 0)
    assert.equal(state.isExitLocked, maze.requiredKeys > 0)
  }

  // Verify exact expected progressive brackets
  assert.equal(generateMaze({ level: 1, baseSeed: INITIAL_BASE_SEED }).requiredKeys, STANDARD_KEYCARD_COUNT)
  assert.equal(generateMaze({ level: 2, baseSeed: INITIAL_BASE_SEED }).requiredKeys, 2)
  assert.equal(generateMaze({ level: 10, baseSeed: INITIAL_BASE_SEED }).requiredKeys, 3)
  assert.equal(generateMaze({ level: 20, baseSeed: INITIAL_BASE_SEED }).requiredKeys, 4)
  assert.ok(generateMaze({ level: 50, baseSeed: INITIAL_BASE_SEED }).requiredKeys >= 5)
  assert.ok(generateMaze({ level: 100, baseSeed: INITIAL_BASE_SEED }).requiredKeys >= 5)
}
console.log('✓ Milestone levels scaling, permanence, reachability & metadata sync verified')

// ---------------------------------------------------------------------------
// 2. Strict Occupied Collectible Exclusion
// ---------------------------------------------------------------------------
console.log('Test 2: Strict non-overlap with occupied collectible locations')
{
  // 5x5 grid with 5 walkable cells total:
  // (1,1)=start, (1,2)=path, (1,3)=occupied item, (2,3)=path, (3,3)=exit
  const grid = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 0, 1],
    [1, 1, 1, 0, 1],
    [1, 1, 1, 1, 1],
  ]
  const syntheticMaze = {
    id: 'strict-collectible-exclusion',
    seed: 12345,
    grid,
    start: { row: 1, col: 1 },
    exit: { row: 3, col: 3 },
    hazards: [],
  }

  // Place an item at (1,3) and (2,3) -> leaves ONLY (1,2) available!
  const result = placeKeycardsWithReport(syntheticMaze, {
    count: 4,
    hazards: [],
    collectibles: {
      items: [
        { id: 'item-1', row: 1, col: 3, type: 'soul_shards' },
        { id: 'item-2', row: 2, col: 3, type: 'health_capsule' },
      ],
      coins: [],
      powerUps: [],
    },
  })

  assert.equal(result.keycards.length, 1, 'Never falls back onto occupied collectible cells')
  assert.deepEqual(
    { row: result.keycards[0].row, col: result.keycards[0].col },
    { row: 1, col: 2 },
    'Places keycard only on the unoccupied valid cell'
  )
  assert.equal(result.report.allocatedCount, 4)
  assert.equal(result.report.placedCount, 1)
  assert.equal(result.report.requiredCount, 1)
  assert.equal(result.report.shortfallCount, 3)
  assert.equal(result.report.hadShortfall, true)
  assert.equal(result.report.fullySatisfied, false)

  // Also test when pre-populated on maze.collectibles before keycards exist
  const prePopulatedMaze = {
    ...syntheticMaze,
    collectibles: {
      items: [{ id: 'item-1', row: 1, col: 3, type: 'soul_shards' }],
      coins: [],
      powerUps: [],
    },
  }
  const direct = placeKeycards(prePopulatedMaze, { count: 4, hazards: [] })
  assert.equal(direct.length, 2, 'Excludes maze.collectibles when keycards not yet placed')
  assert.equal(
    direct.some((kc) => kc.row === 1 && kc.col === 3),
    false,
    'Never places keycard on maze.collectibles occupied cell'
  )
}
console.log('✓ Strict occupied collectible exclusion verified')

// ---------------------------------------------------------------------------
// 3. Shortfall Impossibility Prevention (End-to-End with generateMaze & Reducer)
// ---------------------------------------------------------------------------
console.log('Test 3: Shortfall impossibility safety & 0-keycard completable fallback')
{
  // A) Custom small 7x7 maze via generateMaze requesting 20 keycards -> hits shortfall safely
  const crampedCustomMaze = generateMaze({
    level: 5,
    baseSeed: 77889,
    rows: 7,
    cols: 7,
    progressionConfig: { minDimension: 7 },
    collectibleConfig: {
      perCategoryQuantities: {
        [KEYCARD_COLLECTIBLE_TYPE]: 20,
      },
    },
  })

  assert.ok(crampedCustomMaze.keycardMetadata.allocatedCount === 20, 'Records requested 20 allocatedCount')
  assert.ok(crampedCustomMaze.keycards.length < 20 && crampedCustomMaze.keycards.length >= 1, 'Caps placed keycards to reachable candidate cells')
  assert.equal(crampedCustomMaze.keycardMetadata.hadShortfall, true, 'Reports keycard shortfall accurately')
  assert.equal(
    crampedCustomMaze.keycardMetadata.shortfallCount,
    20 - crampedCustomMaze.keycards.length,
    'shortfallCount equals allocated - placed'
  )
  assert.equal(
    crampedCustomMaze.requiredKeys,
    crampedCustomMaze.keycards.length,
    'requiredKeys equals actual placed keycards so completion remains possible'
  )

  // Play through with gameReducer: must unlock and allow winning after collecting placed keycards
  let state = createInitialGameState({ maze: crampedCustomMaze })
  assert.equal(state.totalKeys, crampedCustomMaze.keycards.length)
  assert.equal(state.isExitLocked, true)

  for (const kc of [...state.keycards]) {
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: kc.row, col: kc.col },
    })
  }
  assert.equal(state.keysCollected, state.totalKeys)
  assert.equal(state.isExitLocked, false, 'Exit unlocks even when original allocation had shortfall')

  state = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    position: crampedCustomMaze.exit,
  })
  assert.equal(state.hasWon, true, 'Cramped shortfall maze remains 100% completable')

  // B) Zero candidate capacity fallback -> 0 keycards placed -> exit starts unlocked (never deadlocked)
  const zeroCandidateMaze = {
    id: 'zero-keycard-capacity',
    seed: 9991,
    level: 3,
    rows: 5,
    cols: 5,
    grid: [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 1, 1],
      [1, 1, 0, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 2, col: 2 },
    hazards: [{ id: 'hz-1', type: 'spike_trap', row: 1, col: 2 }],
    collectibles: { items: [], coins: [], powerUps: [] },
  }
  const zeroPlacement = placeKeycardsWithReport(zeroCandidateMaze, {
    count: 4,
    hazards: zeroCandidateMaze.hazards,
  })
  assert.equal(zeroPlacement.keycards.length, 0)
  assert.equal(zeroPlacement.report.requiredCount, 0)
  assert.equal(zeroPlacement.report.shortfallCount, 4)
  assert.equal(zeroPlacement.report.hadShortfall, true)

  const zeroMazeFull = {
    ...zeroCandidateMaze,
    keycards: zeroPlacement.keycards,
    requiredKeys: zeroPlacement.report.requiredCount,
    keycardMetadata: zeroPlacement.report,
  }
  let zeroState = createInitialGameState({ maze: zeroMazeFull })
  assert.equal(zeroState.totalKeys, 0)
  assert.equal(zeroState.isExitLocked, false, '0 placed keycards leaves exit unlocked so player is never trapped')
  zeroState = gameReducer(zeroState, {
    type: 'SYNC_PLAYER_CELL',
    position: zeroMazeFull.exit,
  })
  assert.equal(zeroState.hasWon, true, 'Zero-keycard capacity maze is still completable')
}
console.log('✓ Shortfall impossibility prevention & zero-capacity unlock safety verified')

// ---------------------------------------------------------------------------
// 4. End-to-End Level Transitions, Replay, New Game & MazeSceneEngine Sync
// ---------------------------------------------------------------------------
console.log('Test 4: Transitions (REPLAY_LEVEL, ADVANCE_LEVEL, SET_LEVEL, NEW_GAME) & Engine Sync')
{
  const engine = new MazeSceneEngine(createHeadlessCanvasHost(), {
    createRenderer: createFakeRendererFactory(),
    isSoftwareGl: true,
  })

  let state = createInitialGameState({
    level: 1,
    baseSeed: INITIAL_BASE_SEED,
    progressionConfig: DEFAULT_MAZE_PROGRESSION_CONFIG,
  })
  engine.setMaze(state.maze)
  assert.equal(state.currentLevel, 1)
  assert.equal(state.totalKeys, 2)
  assert.equal(engine.getIsExitLocked(), true)
  assert.equal(engine.getCollectibleManager().getCounts().keycards, 2)

  // Jump to Level 15 (should scale to 3 or 4 keycards)
  state = gameReducer(state, { type: 'SET_LEVEL', level: 15 })
  engine.setMaze(state.maze)
  const expectedL15Keys = state.maze.requiredKeys
  assert.ok(expectedL15Keys >= 3, `Level 15 scales keycards (got ${expectedL15Keys})`)
  assert.equal(state.totalKeys, expectedL15Keys)
  assert.equal(state.keycards.length, expectedL15Keys)
  assert.equal(engine.getCollectibleManager().getCounts().keycards, expectedL15Keys)
  assert.equal(engine.getIsExitLocked(), true)

  // Partial keycard collection keeps gate locked and updates engine count
  const partialTarget = state.keycards[0]
  state = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: partialTarget.row, col: partialTarget.col },
  })
  engine.syncCollectibles({ keycards: state.keycards, spawnBursts: true })
  engine.setExitLocked(state.isExitLocked, { animate: true })
  assert.equal(state.keysCollected, 1)
  assert.equal(state.isExitLocked, true)
  assert.equal(engine.getIsExitLocked(), true)
  assert.equal(engine.getCollectibleManager().getCounts().keycards, expectedL15Keys - 1)

  // REPLAY_LEVEL restores exact seed, keycards, totalKeys, and re-locks gate
  const seedBeforeReplay = state.seed
  state = gameReducer(state, { type: 'REPLAY_LEVEL' })
  engine.syncCollectibles({ keycards: state.keycards, spawnBursts: false, isReset: true })
  engine.setExitLocked(state.isExitLocked, { animate: false })
  assert.equal(state.currentLevel, 15)
  assert.equal(state.seed, seedBeforeReplay)
  assert.equal(state.keysCollected, 0)
  assert.equal(state.totalKeys, expectedL15Keys)
  assert.equal(state.keycards.length, expectedL15Keys)
  assert.equal(state.isExitLocked, true)
  assert.equal(engine.getIsExitLocked(), true)
  assert.equal(engine.getCollectibleManager().getCounts().keycards, expectedL15Keys)

  // Collect all keycards on Level 15 -> unlock -> win -> ADVANCE_LEVEL to Level 16
  for (const kc of [...state.keycards]) {
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: kc.row, col: kc.col },
    })
  }
  assert.equal(state.keysCollected, expectedL15Keys)
  assert.equal(state.isExitLocked, false)
  state = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    position: state.maze.exit,
  })
  assert.equal(state.hasWon, true)

  // Advance to Level 16
  state = gameReducer(state, { type: 'ADVANCE_LEVEL' })
  engine.setMaze(state.maze)
  assert.equal(state.currentLevel, 16)
  assert.equal(state.hasWon, false)
  assert.equal(state.keysCollected, 0)
  assert.equal(state.totalKeys, state.maze.requiredKeys)
  assert.equal(state.keycards.length, state.maze.keycards.length)
  assert.equal(state.isExitLocked, true)
  assert.equal(engine.getIsExitLocked(), true)
  assert.equal(engine.getCollectibleManager().getCounts().keycards, state.totalKeys)

  // SET_OBJECTIVES_ENABLED false -> true restores full synchronized keys
  state = gameReducer(state, { type: 'SET_OBJECTIVES_ENABLED', enabled: false })
  assert.equal(state.totalKeys, 0)
  assert.equal(state.isExitLocked, false)
  state = gameReducer(state, { type: 'SET_OBJECTIVES_ENABLED', enabled: true })
  assert.equal(state.totalKeys, state.maze.requiredKeys)
  assert.equal(state.isExitLocked, true)

  // NEW_GAME resets to Level 1 with Level 1 keycard count (2)
  state = gameReducer(state, { type: 'NEW_GAME', baseSeed: 998877 })
  engine.setMaze(state.maze)
  assert.equal(state.currentLevel, 1)
  assert.equal(state.totalKeys, 2)
  assert.equal(state.keycards.length, 2)
  assert.equal(state.isExitLocked, true)
  assert.equal(engine.getCollectibleManager().getCounts().keycards, 2)

  engine.dispose()
}
console.log('✓ Transitions, replay, new game & 3D engine keycard synchronization verified')

// ---------------------------------------------------------------------------
// 5. Determinism & RNG Isolation
// ---------------------------------------------------------------------------
console.log('Test 5: Deterministic placement & RNG stream isolation')
{
  const mazeA = generateMaze({ level: 25, baseSeed: 424242 })
  const mazeB = generateMaze({ level: 25, baseSeed: 424242 })
  const mazeOtherSeed = generateMaze({ level: 25, baseSeed: 131313 })
  const mazeCustomKeyCount = generateMaze({
    level: 25,
    baseSeed: 424242,
    collectibleConfig: {
      perCategoryQuantities: {
        [KEYCARD_COLLECTIBLE_TYPE]: 6,
      },
    },
  })

  assert.deepEqual(mazeA.keycards, mazeB.keycards, 'Same level & baseSeed generate identical keycards')
  assert.deepEqual(mazeA.keycardMetadata, mazeB.keycardMetadata, 'Same level & baseSeed generate identical metadata')
  assert.notDeepEqual(mazeA.keycards, mazeOtherSeed.keycards, 'Different seeds produce different keycard placements')

  // Isolated RNG: changing keycard count never perturbs maze walls, start/exit, or hazards
  assert.deepEqual(mazeA.grid, mazeCustomKeyCount.grid, 'Keycard count override never alters maze layout')
  assert.deepEqual(mazeA.start, mazeCustomKeyCount.start)
  assert.deepEqual(mazeA.exit, mazeCustomKeyCount.exit)
  assert.deepEqual(mazeA.hazards, mazeCustomKeyCount.hazards, 'Keycard count override never alters hazards')
  assert.equal(mazeCustomKeyCount.requiredKeys, 6)
}
console.log('✓ Determinism and RNG isolation verified')

console.log('--- ALL LEVEL-AWARE KEYCARD PROGRESSION TESTS PASSED! ---')
