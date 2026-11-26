import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  HAZARD_TYPES,
  STANDARD_HAZARD_TYPES,
  placeHazards,
  placeHazardsWithReport,
  validateHazardPlacement,
} from '../generation/hazardPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { exploreReachableCells, validateMaze } from '../generation/pathfinder.js'
import {
  DEFAULT_HAZARD_PROGRESSION_CONFIG,
  HAZARD_TYPE_BUDGET_SCHEDULE,
  INITIAL_BASE_SEED,
  getHazardBudgetForLevel,
  getLevelConfig,
  getLevelSeed,
  selectHazardsForLevel,
} from '../mechanics/levelProgression.js'
import { HazardManager } from './HazardManager.js'

console.log('--- RUNNING LEVEL-BASED HAZARD PROGRESSION TESTS ---')

const MILESTONE_SCHEDULE = [
  [1, 5],
  [5, 5],
  [6, 6],
  [10, 6],
  [11, 7],
  [15, 7],
  [16, 8],
  [20, 8],
  [21, 9],
  [25, 9],
  [26, 10],
  [50, 10],
  [100, 10],
]

// ---------------------------------------------------------------------------
// 1. Exact Budget Schedule Across All Required Milestones
// ---------------------------------------------------------------------------
console.log('Test 1: Hazard type budget schedule across Levels 1, 5, 6, 10, 11, 15, 16, 20, 21, 25, 26, 50, 100')
assert.equal(STANDARD_HAZARD_TYPES.length, 10, 'Exactly 10 hazard types exist')
assert.equal(HAZARD_TYPE_BUDGET_SCHEDULE.length, 6, 'Budget schedule defines all 6 tier brackets')

for (const [level, expectedDistinct] of MILESTONE_SCHEDULE) {
  const budget = getHazardBudgetForLevel(level)
  assert.equal(
    budget.distinctTypeCount,
    expectedDistinct,
    `Level ${level} budget distinctTypeCount=${expectedDistinct} (got ${budget.distinctTypeCount})`
  )
  assert.equal(budget.minInstancesPerType, 2, `Level ${level} enforces >= 2 instances per type`)

  const levelCfg = getLevelConfig(level, INITIAL_BASE_SEED)
  assert.equal(
    levelCfg.hazardBudget.distinctTypeCount,
    expectedDistinct,
    `getLevelConfig(${level}) hazardBudget matches ${expectedDistinct}`
  )
  assert.equal(
    levelCfg.hazardSelection.distinctTypeCount,
    expectedDistinct,
    `getLevelConfig(${level}) hazardSelection distinctTypeCount matches ${expectedDistinct}`
  )
  assert.equal(
    levelCfg.hazardSelection.selectedTypes.length,
    expectedDistinct,
    `getLevelConfig(${level}) selects ${expectedDistinct} distinct types`
  )
  assert.equal(
    levelCfg.hazardSelection.unselectedTypes.length,
    10 - expectedDistinct,
    `getLevelConfig(${level}) leaves ${10 - expectedDistinct} unselected types`
  )
}
console.log('✓ Budget schedule verified across all milestone levels')

// ---------------------------------------------------------------------------
// 2. Full Maze Generation, Representation, Unselected Exclusion & Solvability
// ---------------------------------------------------------------------------
console.log('Test 2: Maze generation, >= 2 instances per selected type, unselected exclusion & solvability')
for (const [level, expectedDistinct] of MILESTONE_SCHEDULE) {
  const maze = generateMaze({ level, baseSeed: INITIAL_BASE_SEED })
  const hazards = maze.hazards
  const selection = maze.hazardSelection
  const report = maze.hazardPlacementReport

  assert.ok(selection, `Level ${level} records hazardSelection metadata`)
  assert.ok(report, `Level ${level} records hazardPlacementReport metadata`)
  assert.equal(selection.distinctTypeCount, expectedDistinct, `Level ${level} selects ${expectedDistinct} types`)
  assert.equal(
    report.fullySatisfied,
    true,
    `Level ${level} satisfies full hazard placement budget without failures (failures=${JSON.stringify(report.failures)})`
  )

  const selectedSet = new Set(selection.selectedTypes)
  const unselectedSet = new Set(selection.unselectedTypes)
  assert.equal(selectedSet.size, expectedDistinct, `Level ${level} selectedTypes are distinct`)
  assert.equal(unselectedSet.size, 10 - expectedDistinct, `Level ${level} unselectedTypes complement selectedTypes`)

  const countsByType = new Map()
  const usedIds = new Set()
  const usedCoords = new Set()
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  assert.equal(validateMaze(maze).valid, true, `Level ${level} maze remains solvable`)

  for (const spec of hazards) {
    assert.equal(selectedSet.has(spec.type), true, `Level ${level}: placed ${spec.type} is selected`)
    assert.equal(unselectedSet.has(spec.type), false, `Level ${level}: unselected ${spec.type} never appears`)
    assert.equal(usedIds.has(spec.id), false, `Level ${level}: unique hazard id ${spec.id}`)
    usedIds.add(spec.id)

    const coordKey = `${spec.row},${spec.col}`
    assert.equal(usedCoords.has(coordKey), false, `Level ${level}: no overlapping hazard at ${coordKey}`)
    usedCoords.add(coordKey)

    const check = validateHazardPlacement(maze, spec, { allowStartExit: false })
    assert.equal(check.valid, true, `Level ${level} hazard ${spec.id} passes placement validation (${check.reason})`)

    const dist = reachInfo.distances.get(coordKey)
    const manhattan = Math.abs(spec.row - maze.start.row) + Math.abs(spec.col - maze.start.col)
    assert.ok(dist >= 3 && manhattan >= 3, `Level ${level} hazard ${spec.id} preserves spawn clearance`)

    countsByType.set(spec.type, (countsByType.get(spec.type) || 0) + 1)
  }

  assert.equal(countsByType.size, expectedDistinct, `Level ${level} places all ${expectedDistinct} selected types`)
  for (const selectedType of selectedSet) {
    const count = countsByType.get(selectedType) || 0
    assert.ok(count >= 2, `Level ${level} selected type ${selectedType} has >= 2 instances (got ${count})`)
  }
}
console.log('✓ All milestone levels satisfy type count, >=2 minimum, exclusion, validity, and solvability')

// ---------------------------------------------------------------------------
// 3. Randomness, Anti-Index Bias, Consecutive Level Independence & Determinism
// ---------------------------------------------------------------------------
console.log('Test 3: Random selection fairness, consecutive level independence & seed determinism')
{
  const typeAppearances = new Map(STANDARD_HAZARD_TYPES.map((t) => [t, 0]))
  const signatureSet = new Set()

  for (let i = 1; i <= 40; i += 1) {
    const sel = selectHazardsForLevel({ level: 1, baseSeed: 10000 + i * 7919, rows: 11, cols: 11 })
    assert.equal(sel.distinctTypeCount, 5)
    signatureSet.add([...sel.selectedTypes].sort().join('|'))
    for (const t of sel.selectedTypes) {
      typeAppearances.set(t, typeAppearances.get(t) + 1)
    }
  }

  assert.ok(signatureSet.size > 12, `Level 1 produces varied random subsets across seeds (got ${signatureSet.size} distinct sets)`)
  for (const t of STANDARD_HAZARD_TYPES) {
    const hits = typeAppearances.get(t)
    assert.ok(hits > 0 && hits < 40, `Hazard type ${t} is randomly sampled (${hits}/40), not fixed by index`)
  }

  // Independent selection between consecutive levels 1..8 on same baseSeed
  const consecutiveSelections = []
  for (let lvl = 1; lvl <= 8; lvl += 1) {
    const sel = selectHazardsForLevel({ level: lvl, baseSeed: 919191 })
    consecutiveSelections.push(sel.selectedTypes)
  }
  const consecutiveSignatures = new Set(consecutiveSelections.map((s) => [...s].sort().join('|')))
  assert.ok(consecutiveSignatures.size >= 5, 'Consecutive levels select hazard types independently')

  // Verify determinism for identical level + seed and placeHazards parity
  const mazeA = generateMaze({ level: 12, baseSeed: 554433 })
  const mazeB = generateMaze({ level: 12, baseSeed: 554433 })
  assert.deepStrictEqual(mazeA.hazardSelection, mazeB.hazardSelection, 'Identical seed produces identical hazardSelection')
  assert.deepStrictEqual(mazeA.hazards, mazeB.hazards, 'Identical seed produces identical placed hazards')
  assert.deepStrictEqual(placeHazards(mazeA), mazeA.hazards, 'placeHazards(maze) matches generateMaze().hazards')

  // Verify HazardManager mounts exact maze hazards without altering selection
  const scene = new THREE.Scene()
  const manager = new HazardManager(scene)
  manager.setMaze(mazeA)
  const spawned = manager.getHazards()
  assert.equal(spawned.length, mazeA.hazards.length, 'HazardManager spawns exact progressive hazard count')
  assert.deepStrictEqual(
    spawned.map((h) => ({ id: h.id, type: h.type, row: h.row, col: h.col })),
    mazeA.hazards.map((h) => ({ id: h.id, type: h.type, row: h.row, col: h.col })),
    'HazardManager preserves selected hazard IDs, types, and coordinates'
  )
  manager.dispose()
}
console.log('✓ Randomness fairness, consecutive independence, determinism, and HazardManager parity verified')

// ---------------------------------------------------------------------------
// 4. Configurable Per-Type Quantities & Performance Ceiling
// ---------------------------------------------------------------------------
console.log('Test 4: Configurable per-type quantities & safe high-level ceiling')
{
  const customMaze = generateMaze({
    level: 1,
    baseSeed: 224466,
    hazardConfig: {
      perTypeQuantities: (type) =>
        type === HAZARD_TYPES.CEILING_COLLAPSE ? 4 : 3,
    },
  })
  assert.equal(customMaze.hazardSelection.distinctTypeCount, 5, 'Custom quantities keep 5 distinct types at Level 1')
  for (const t of customMaze.hazardSelection.selectedTypes) {
    const expected = t === HAZARD_TYPES.CEILING_COLLAPSE ? 4 : 3
    assert.equal(
      customMaze.hazardSelection.typeQuantities[t],
      expected,
      `Configured per-type quantity honored for ${t} (expected ${expected})`
    )
    const placedCount = customMaze.hazards.filter((h) => h.type === t).length
    assert.equal(placedCount, expected, `Placed count for ${t} matches configured ${expected}`)
  }

  // Enforces minimum 2 instances even if config asks for < 2
  const clampedSelection = selectHazardsForLevel({
    level: 1,
    baseSeed: 224466,
    rows: 11,
    cols: 11,
    hazardConfig: {
      minInstancesPerType: 1,
      perTypeQuantities: {
        [STANDARD_HAZARD_TYPES[0]]: 1,
      },
    },
  })
  assert.equal(clampedSelection.minInstancesPerType, 2, 'Minimum instances per type strictly stays >= 2')
  for (const qty of Object.values(clampedSelection.typeQuantities)) {
    assert.ok(qty >= 2, `Every selected type quantity stays >= 2 (got ${qty})`)
  }

  // Performance cap at Level 5000 (51x51) stays bounded at DEFAULT_HAZARD_PROGRESSION_CONFIG.maxTotalHazards
  const highLevelMaze = generateMaze({ level: 5000, seed: getLevelSeed(5000, INITIAL_BASE_SEED) })
  assert.equal(highLevelMaze.hazardSelection.distinctTypeCount, 10, 'Level 5000 selects all 10 types')
  assert.ok(
    highLevelMaze.hazards.length >= 20 &&
      highLevelMaze.hazards.length <= DEFAULT_HAZARD_PROGRESSION_CONFIG.maxTotalHazards,
    `Level 5000 hazard count (${highLevelMaze.hazards.length}) stays bounded within [20, ${DEFAULT_HAZARD_PROGRESSION_CONFIG.maxTotalHazards}]`
  )
}
console.log('✓ Configurable per-type quantities and performance ceiling verified')

// ---------------------------------------------------------------------------
// 5. Shortfall Reporting Without Silently Altering Selection Budget
// ---------------------------------------------------------------------------
console.log('Test 5: Placement failure reporting without silently altering selection budget')
{
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  // Tight 7x7 open room (only 25 walkable cells total, minus start/exit/clearance -> fewer than 20 candidates, and center cells have 0 walls)
  const constrainedRoom = {
    id: 'constrained-shortfall-room',
    level: 26,
    currentLevel: 26,
    seed: 778899,
    rows: 7,
    cols: 7,
    start: { row: 1, col: 1 },
    exit: { row: 5, col: 5 },
    grid: [
      [W, W, W, W, W, W, W],
      [W, P, P, P, P, P, W],
      [W, P, P, P, P, P, W],
      [W, P, P, P, P, P, W],
      [W, P, P, P, P, P, W],
      [W, P, P, P, P, P, W],
      [W, W, W, W, W, W, W],
    ],
  }

  let callbackReport = null
  const result = placeHazardsWithReport(constrainedRoom, {
    onReport: (rep) => {
      callbackReport = rep
    },
  })

  // Selection budget MUST stay intact at Level 26 (10 distinct types, >= 2 instances each)
  assert.equal(result.selection.distinctTypeCount, 10, 'Selection budget preserves all 10 distinct types despite tight maze')
  assert.ok(result.selection.totalTargetCount >= 20, 'Selection target count preserves >= 20 requested slots')

  // Shortfalls MUST be explicitly reported instead of silently mutating the selection budget
  assert.ok(callbackReport, 'onReport callback receives placement report')
  assert.equal(result.report.fullySatisfied, false, 'Report flags constrained maze shortfall (fullySatisfied=false)')
  assert.equal(result.report.requestedTotal, result.selection.totalTargetCount, 'Report requestedTotal matches unmutated selection')
  assert.ok(result.report.missingTotal > 0, `Report quantifies missing placements (${result.report.missingTotal})`)
  assert.ok(result.report.failures.length > 0, `Report logs structured failure entries (${result.report.failures.length})`)
}
console.log('✓ Placement shortfall reporting verified without silently modifying selection budget')

// ---------------------------------------------------------------------------
// 6. Seed Isolation: Hazard Selection Does Not Alter Maze Terrain
// ---------------------------------------------------------------------------
console.log('Test 6: Deterministic seed isolation between hazard randomness and maze generation')
{
  const level = 7
  const levelSeed = getLevelSeed(level, INITIAL_BASE_SEED)
  const baselineMaze = generateMaze({ level, seed: levelSeed })
  const customHazardMaze = generateMaze({
    level,
    seed: levelSeed,
    hazardConfig: {
      minDistinctTypes: 9,
      budgetSchedule: [{ minLevel: 1, maxLevel: Infinity, distinctTypes: 9 }],
      perTypeQuantities: {
        [HAZARD_TYPES.CEILING_COLLAPSE]: 4,
        [HAZARD_TYPES.STEAM_PIPE_BURST]: 4,
      },
    },
  })

  // Maze grid, start, exit, shortestPath, braidFactor, and dimensions remain bit-for-bit identical
  assert.deepStrictEqual(customHazardMaze.grid, baselineMaze.grid, 'Hazard config changes do not mutate maze grid')
  assert.deepStrictEqual(customHazardMaze.start, baselineMaze.start, 'Hazard config changes do not mutate start')
  assert.deepStrictEqual(customHazardMaze.exit, baselineMaze.exit, 'Hazard config changes do not mutate exit')
  assert.deepStrictEqual(customHazardMaze.shortestPath, baselineMaze.shortestPath, 'Hazard config changes do not mutate shortestPath')
  assert.equal(customHazardMaze.braidFactor, baselineMaze.braidFactor, 'Hazard config changes do not mutate braidFactor')
  assert.deepStrictEqual(customHazardMaze.dimensions, baselineMaze.dimensions, 'Hazard config changes do not mutate dimensions')
  assert.notDeepStrictEqual(customHazardMaze.hazardSelection, baselineMaze.hazardSelection, 'Custom hazard config did alter hazardSelection')
}
console.log('✓ Deterministic seed isolation verified')

console.log('--- ALL LEVEL-BASED HAZARD PROGRESSION TESTS PASSED! ---')
