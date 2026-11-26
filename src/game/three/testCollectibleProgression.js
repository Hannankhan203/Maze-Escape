import assert from 'node:assert/strict'
import {
  ALL_COLLECTIBLE_CATEGORIES,
  COLLECTIBLE_TYPES,
  KEYCARD_COLLECTIBLE_TYPE,
  OPTIONAL_COLLECTIBLE_CATEGORIES,
  PERMANENT_COLLECTIBLE_CATEGORIES,
} from '../mechanics/collectiblesConfig.js'
import {
  DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG,
  INITIAL_BASE_SEED,
  allocateCollectibleQuantitiesForLevel,
  getLevelConfig,
  selectCollectibleCategoriesForLevel,
} from '../mechanics/levelProgression.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { placeCollectibles, placeCollectiblesWithReport } from '../generation/collectiblePlacement.js'
import { placeKeycardsWithReport } from '../generation/keycardPlacement.js'
import { exploreReachableCells, validateMaze } from '../generation/pathfinder.js'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'

console.log('--- RUNNING LEVEL-BASED COLLECTIBLE PROGRESSION TESTS ---')

const MILESTONE_LEVELS = [1, 2, 5, 6, 10, 20, 25, 26, 50, 100]

// ---------------------------------------------------------------------------
// 1. Category Definitions (12 total = 4 permanent + 8 optional)
// ---------------------------------------------------------------------------
console.log('Test 1: Verify exact 12 categories (4 permanent + 8 optional)')
assert.equal(PERMANENT_COLLECTIBLE_CATEGORIES.length, 4, 'Exactly 4 permanent categories')
assert.equal(OPTIONAL_COLLECTIBLE_CATEGORIES.length, 8, 'Exactly 8 optional categories')
assert.equal(ALL_COLLECTIBLE_CATEGORIES.length, 12, 'Exactly 12 total categories')
assert.equal(new Set(ALL_COLLECTIBLE_CATEGORIES).size, 12, 'All 12 categories are distinct')
assert.deepEqual(
  [...PERMANENT_COLLECTIBLE_CATEGORIES].sort(),
  ['echo_reveal', 'health_capsule', 'resonance_keycard', 'soul_shards'],
  'Exact 4 permanent categories match specification'
)
assert.deepEqual(
  [...OPTIONAL_COLLECTIBLE_CATEGORIES].sort(),
  [
    'echo_pulse',
    'energy_cell',
    'phantom_veil',
    'spectral_compass',
    'spirit_lantern',
    'time_fragment',
    'warding_charm',
    'watchers_eye',
  ],
  'Exact 8 optional categories match specification'
)
console.log('✓ Category inventory verified')

// ---------------------------------------------------------------------------
// 2. Milestone Levels (1, 2, 5, 6, 10, 20, 25, 26, 50, 100):
//    8 Active Categories, No Unlock Schedule, Zero Unselected Spawns,
//    Reachability, Separation, Solvability & Keycard Gate Compatibility
// ---------------------------------------------------------------------------
console.log('Test 2: Milestone levels 1, 2, 5, 6, 10, 20, 25, 26, 50, 100')

for (const level of MILESTONE_LEVELS) {
  const maze = generateMaze({ level, baseSeed: INITIAL_BASE_SEED })
  const levelCfg = getLevelConfig(level, INITIAL_BASE_SEED)
  const selection = maze.collectibleSelection
  const allocation = maze.collectibleAllocation
  const report = maze.collectiblePlacementReport

  assert.ok(selection, `Level ${level} records collectibleSelection`)
  assert.ok(allocation, `Level ${level} records collectibleAllocation`)
  assert.ok(report, `Level ${level} records collectiblePlacementReport`)
  assert.deepEqual(
    selection,
    levelCfg.collectibleSelection,
    `Level ${level} maze.collectibleSelection matches getLevelConfig`
  )

  // Every level must activate all 4 permanent + 4 of 8 optional = 8 categories (no unlock schedule)
  assert.equal(selection.activeCategoryCount, 8, `Level ${level} has 8 active categories`)
  assert.equal(selection.selectedOptionalCategories.length, 4, `Level ${level} selects 4 optional categories`)
  assert.equal(selection.unselectedOptionalCategories.length, 4, `Level ${level} excludes 4 optional categories`)
  assert.equal(new Set(selection.selectedCategories).size, 8, `Level ${level} selected categories are unique`)

  for (const perm of PERMANENT_COLLECTIBLE_CATEGORIES) {
    assert.equal(
      selection.selectedCategories.includes(perm),
      true,
      `Level ${level} includes permanent category ${perm}`
    )
  }

  assert.equal(
    report.fullySatisfied,
    true,
    `Level ${level} satisfies collectible placement budget (failures=${JSON.stringify(report.failures)})`
  )
  assert.equal(report.missingTotal, 0, `Level ${level} has zero placement shortfalls`)
  assert.equal(report.unselectedSpawnCount, 0, `Level ${level} has zero unselected spawns`)

  // Verify separation: keycards live in maze.keycards, item categories live in maze.collectibles.items
  assert.ok(Array.isArray(maze.keycards), `Level ${level} keycards array exists`)
  assert.equal(
    maze.keycards.length,
    allocation.keycardCount,
    `Level ${level} places allocated keycard count (${allocation.keycardCount})`
  )
  assert.equal(
    maze.collectibles.items.some((item) => item.type === KEYCARD_COLLECTIBLE_TYPE),
    false,
    `Level ${level} keeps resonance_keycard separate from collectible items`
  )
  assert.equal(
    maze.keycards.every((kc) => kc.type === KEYCARD_COLLECTIBLE_TYPE),
    true,
    `Level ${level} keycard array contains only resonance_keycard`
  )

  // Verify placed items & keycards reachability and zero overlap with start/exit/hazards/each other
  const reach = exploreReachableCells(maze.grid, maze.start)
  assert.equal(validateMaze(maze).valid, true, `Level ${level} maze stays solvable`)

  const blockedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
    ...maze.hazards.map((h) => `${h.row},${h.col}`),
  ])
  const occupiedKeys = new Set()
  const countsByCategory = new Map()
  const seenItemIds = new Set()

  for (const kc of maze.keycards) {
    const key = `${kc.row},${kc.col}`
    assert.equal(maze.grid[kc.row]?.[kc.col], CELL_TYPES.PATH, `Level ${level} keycard on PATH`)
    assert.equal(reach.distances.has(key), true, `Level ${level} keycard reachable`)
    assert.equal(blockedKeys.has(key), false, `Level ${level} keycard avoids start/exit/hazards`)
    assert.equal(occupiedKeys.has(key), false, `Level ${level} keycard cell unique`)
    occupiedKeys.add(key)
    countsByCategory.set(KEYCARD_COLLECTIBLE_TYPE, (countsByCategory.get(KEYCARD_COLLECTIBLE_TYPE) || 0) + 1)
  }

  for (const item of maze.collectibles.items) {
    const key = `${item.row},${item.col}`
    assert.equal(seenItemIds.has(item.id), false, `Level ${level} unique item ID ${item.id}`)
    seenItemIds.add(item.id)
    assert.equal(maze.grid[item.row]?.[item.col], CELL_TYPES.PATH, `Level ${level} item on PATH`)
    assert.equal(reach.distances.has(key), true, `Level ${level} item reachable via BFS`)
    assert.equal(blockedKeys.has(key), false, `Level ${level} item avoids start/exit/hazards`)
    assert.equal(occupiedKeys.has(key), false, `Level ${level} item avoids keycards and other items`)
    occupiedKeys.add(key)
    countsByCategory.set(item.type, (countsByCategory.get(item.type) || 0) + 1)
  }

  // All 8 selected categories present; none of the 4 unselected optionals appear
  assert.equal(countsByCategory.size, 8, `Level ${level} spawns all 8 active categories`)
  for (const activeCat of selection.selectedCategories) {
    const actual = countsByCategory.get(activeCat) || 0
    assert.equal(
      actual,
      allocation.categoryQuantities[activeCat],
      `Level ${level} ${activeCat} count matches allocated target (${actual})`
    )
  }
  for (const excludedCat of selection.unselectedOptionalCategories) {
    assert.equal(
      countsByCategory.get(excludedCat) || 0,
      0,
      `Level ${level} unselected optional ${excludedCat} never spawns`
    )
  }
}

// Verify keycard/exit-gate lock & unlock gameplay flow on a higher level (Level 25 with dynamic keycard count)
{
  let state = createInitialGameState({ level: 25, baseSeed: INITIAL_BASE_SEED })
  assert.equal(state.isExitLocked, true, 'Level 25 exit starts locked')
  assert.equal(state.totalKeys, state.maze.keycards.length, 'Level 25 tracks allocated keycards')

  // Attempting to exit before collecting all keycards stays locked
  let blockedState = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    position: { ...state.maze.exit },
  })
  assert.equal(blockedState.hasWon, false, 'Exit remains locked before collecting keycards')

  for (const kc of state.keycards) {
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: kc.row, col: kc.col },
    })
  }
  assert.equal(state.isExitLocked, false, 'Exit unlocks after collecting all allocated keycards')
  const wonState = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    position: { ...state.maze.exit },
  })
  assert.equal(wonState.hasWon, true, 'Reaching unlocked exit completes Level 25')
}
console.log('✓ All milestone levels & keycard/exit gate compatibility verified')

// ---------------------------------------------------------------------------
// 3. Random Fairness Without Replacement & Consecutive Level Independence
// ---------------------------------------------------------------------------
console.log('Test 3: Random selection fairness without replacement & consecutive independence')
{
  const appearances = new Map(OPTIONAL_COLLECTIBLE_CATEGORIES.map((c) => [c, 0]))
  const subsetSignatures = new Set()

  for (let i = 1; i <= 48; i += 1) {
    const sel = selectCollectibleCategoriesForLevel({
      level: 1,
      baseSeed: 90000 + i * 7919,
    })
    assert.equal(sel.selectedOptionalCategories.length, 4)
    assert.equal(new Set(sel.selectedOptionalCategories).size, 4, 'No duplicate optional category in a level')
    subsetSignatures.add([...sel.selectedOptionalCategories].sort().join('|'))
    for (const c of sel.selectedOptionalCategories) {
      appearances.set(c, appearances.get(c) + 1)
    }
  }

  assert.ok(subsetSignatures.size >= 15, `Varied 4-of-8 optional combinations sampled (${subsetSignatures.size} subsets)`)
  for (const c of OPTIONAL_COLLECTIBLE_CATEGORIES) {
    const hits = appearances.get(c)
    assert.ok(hits > 0 && hits < 48, `Optional category ${c} sampled randomly (${hits}/48)`)
  }

  // Check consecutive levels on fixed base seed vary yet may legitimately share overlaps by chance
  const consecutiveSignatures = new Set()
  let observedOverlap = false
  let prevSet = null
  for (let lvl = 1; lvl <= 12; lvl += 1) {
    const sel = selectCollectibleCategoriesForLevel({ level: lvl, baseSeed: 7331 })
    consecutiveSignatures.add([...sel.selectedOptionalCategories].sort().join('|'))
    const currSet = new Set(sel.selectedOptionalCategories)
    if (prevSet) {
      const overlap = [...currSet].filter((c) => prevSet.has(c)).length
      if (overlap > 0 && overlap < 4) observedOverlap = true
    }
    prevSet = currSet
  }
  assert.ok(consecutiveSignatures.size >= 6, 'Consecutive levels draw independent optional subsets')
  assert.equal(observedOverlap, true, 'Independent draws naturally permit occasional overlap without banning repeats')
}
console.log('✓ Random selection fairness and consecutive level independence verified')

// ---------------------------------------------------------------------------
// 4. Determinism & Variation Across Seeds
// ---------------------------------------------------------------------------
console.log('Test 4: Deterministic selection/allocation/placement & seed variation')
{
  const m1a = generateMaze({ level: 10, baseSeed: 24680 })
  const m1b = generateMaze({ level: 10, baseSeed: 24680 })
  const m2 = generateMaze({ level: 10, baseSeed: 13579 })

  assert.deepEqual(m1a.collectibleSelection, m1b.collectibleSelection, 'Identical seeds yield identical selection')
  assert.deepEqual(m1a.collectibleAllocation, m1b.collectibleAllocation, 'Identical seeds yield identical allocation')
  assert.deepEqual(m1a.keycards, m1b.keycards, 'Identical seeds yield identical keycards')
  assert.deepEqual(m1a.collectibles, m1b.collectibles, 'Identical seeds yield identical collectibles')
  assert.deepEqual(m1a.collectiblePlacementReport, m1b.collectiblePlacementReport, 'Identical seeds yield identical report')

  assert.notDeepEqual(m1a.collectibles, m2.collectibles, 'Different base seeds vary collectible placements')
}
console.log('✓ Determinism and seed variation verified')

// ---------------------------------------------------------------------------
// 5. RNG Stream Isolation & Architecture Separation
// ---------------------------------------------------------------------------
console.log('Test 5: Isolated RNG streams & separation between selection, allocation, and placement')
{
  const baseMaze = generateMaze({ level: 6, baseSeed: 55119 })
  const customMaze = generateMaze({
    level: 6,
    baseSeed: 55119,
    collectibleConfig: {
      forcedOptionalCategories: [
        COLLECTIBLE_TYPES.SPIRIT_LANTERN,
        COLLECTIBLE_TYPES.ECHO_PULSE,
        COLLECTIBLE_TYPES.TIME_FRAGMENT,
        COLLECTIBLE_TYPES.WATCHERS_EYE,
      ],
      perCategoryQuantities: {
        [COLLECTIBLE_TYPES.SOUL_SHARDS]: 6,
        [KEYCARD_COLLECTIBLE_TYPE]: 3,
      },
    },
  })

  assert.deepEqual(baseMaze.grid, customMaze.grid, 'Collectible config changes never perturb maze grid RNG')
  assert.deepEqual(baseMaze.start, customMaze.start, 'Maze start unaffected')
  assert.deepEqual(baseMaze.exit, customMaze.exit, 'Maze exit unaffected')
  assert.deepEqual(baseMaze.shortestPath, customMaze.shortestPath, 'Maze shortestPath unaffected')
  assert.deepEqual(baseMaze.hazardSelection, customMaze.hazardSelection, 'Hazard selection unaffected')
  assert.deepEqual(baseMaze.hazards, customMaze.hazards, 'Hazard placement unaffected')

  // Verify standalone stage invocation produces identical placement to generateMaze()
  const standaloneResult = placeCollectibles(baseMaze, {
    hazards: baseMaze.hazards,
    keycards: baseMaze.keycards,
  })
  assert.deepEqual(standaloneResult, baseMaze.collectibles, 'Standalone placeCollectibles matches generateMaze().collectibles')

  // Verify separated functions work cleanly in isolation
  const sel = selectCollectibleCategoriesForLevel({ level: 10, baseSeed: 999 })
  const alloc = allocateCollectibleQuantitiesForLevel({
    level: 10,
    baseSeed: 999,
    rows: 21,
    cols: 21,
    selection: sel,
  })
  assert.equal(sel.activeCategoryCount, 8)
  assert.equal(Object.keys(alloc.categoryQuantities).length, 8)
  assert.equal(Object.keys(alloc.itemQuantities).length, 7)
  assert.equal(
    alloc.totalTargetItems,
    Object.values(alloc.itemQuantities).reduce((s, n) => s + n, 0)
  )
}
console.log('✓ RNG isolation and separated stage architecture verified')

// ---------------------------------------------------------------------------
// 6. Small Maze Capacity Safety & Explicit Shortfall Reporting (No Substitution)
// ---------------------------------------------------------------------------
console.log('Test 6: Level-aware capacity bounds, shortfall reporting & zero silent substitution')
{
  // Small Level 1 11x11 mazes across multiple seeds never exhaust capacity
  for (let i = 0; i < 20; i += 1) {
    const smallMaze = generateMaze({ level: 1, baseSeed: 3000 + i * 31 })
    assert.equal(
      smallMaze.collectiblePlacementReport.fullySatisfied,
      true,
      `Level 1 11x11 seed ${3000 + i * 31} places full allocation cleanly`
    )
    assert.ok(
      smallMaze.collectibles.items.length <= DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG.maxTotalCollectibleItems,
      'Level 1 stays well under maxTotalCollectibleItems'
    )
  }

  // Artificially cramped 5x5 grid with only 4 walkable path cells away from start/exit (dist >= 2 -> only 2 candidates)
  // Expect exact shortfall reporting and ZERO substitution from the 4 unselected optional categories
  const crampedGrid = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 0, 1],
    [1, 1, 1, 0, 1],
    [1, 1, 1, 1, 1],
  ]
  const crampedMaze = {
    id: 'cramped-shortfall-test',
    seed: 8080,
    level: 5,
    grid: crampedGrid,
    start: { row: 1, col: 1 },
    exit: { row: 3, col: 3 },
    hazards: [],
    keycards: [],
  }

  const sel = selectCollectibleCategoriesForLevel({
    level: 5,
    seed: crampedMaze.seed,
  })
  const alloc = allocateCollectibleQuantitiesForLevel({
    level: 5,
    seed: crampedMaze.seed,
    rows: 5,
    cols: 5,
    selection: sel,
  })

  // Cramped maze has only 2 valid cells with dist >= 2 ((1,3) and (2,3)), far fewer than 7 selected item categories!
  const itemPlacement = placeCollectiblesWithReport(crampedMaze, {
    collectibleSelection: sel,
    collectibleAllocation: alloc,
    hazards: [],
    keycards: [],
  })

  assert.equal(itemPlacement.report.candidateCellCount, 2, 'Cramped maze has exactly 2 candidate cells')
  assert.equal(itemPlacement.items.length, 2, 'Places exactly up to candidate capacity')
  assert.equal(itemPlacement.report.fullySatisfied, false, 'Shortfall is explicitly reported')
  assert.equal(
    itemPlacement.report.missingTotal,
    itemPlacement.report.requestedTotal - 2,
    'missingTotal equals exact unplaced count'
  )
  assert.ok(itemPlacement.report.failures.length > 0, 'Failure entries explain missing categories')
  assert.equal(
    itemPlacement.report.unselectedSpawnCount,
    0,
    'Unselected optional categories are NEVER substituted when capacity runs out'
  )
  const unselectedSet = new Set(sel.unselectedOptionalCategories)
  for (const placed of itemPlacement.items) {
    assert.equal(
      unselectedSet.has(placed.type),
      false,
      `Placed item ${placed.type} is never an unselected category`
    )
  }

  // Verify keycard shortfall reporting on cramped maze when 4 keycards are requested for 3 valid non-start/exit cells (strictValidAll includes dist >= 1)
  const keycardShortfall = placeKeycardsWithReport(crampedMaze, {
    count: 4,
    hazards: [],
  })
  assert.equal(keycardShortfall.keycards.length, 3, 'Places max available valid keycards')
  assert.equal(keycardShortfall.report.requestedCount, 4)
  assert.equal(keycardShortfall.report.placedCount, 3)
  assert.equal(keycardShortfall.report.missingCount, 1)
  assert.equal(keycardShortfall.report.fullySatisfied, false)
  assert.equal(keycardShortfall.report.failures[0].reason, 'insufficient_valid_cells')
}
console.log('✓ Small-maze safety, shortfall reporting & non-substitution verified')

console.log('--- ALL LEVEL-BASED COLLECTIBLE PROGRESSION TESTS PASSED! ---')
