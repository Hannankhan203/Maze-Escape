import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  ALL_HIDING_SPOT_TYPES,
  HIDING_SPOT_CONFIG,
  HIDING_SPOT_SELECTION_COUNT,
  MIN_HIDING_SPOT_INSTANCES_PER_TYPE,
  isValidHidingSpotType,
} from '../mechanics/hidingConfig.js'
import {
  DEFAULT_HIDING_PROGRESSION_CONFIG,
  allocateHidingSpotQuantitiesForLevel,
  getLevelConfig,
  resolveHidingProgressionConfig,
  selectHidingSpotTypesForLevel,
} from '../mechanics/levelProgression.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { validateMaze } from '../generation/pathfinder.js'
import { placeHidingSpotsWithReport } from '../generation/hidingSpotPlacement.js'
import { buildPropCollisionIndex } from '../world/propCollision.js'
import { HidingSpotManager } from './HidingSpotManager.js'
import {
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  createSetLevelAction,
  gameReducer,
} from '../engine/gameReducer.js'

console.log('--- RUNNING LEVEL-BASED HIDING PROGRESSION TESTS ---')

const MILESTONE_LEVELS = [1, 2, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000]
const BASE_SEED = 409217

function getSpotWorldBox(spot) {
  const cfg = HIDING_SPOT_CONFIG[spot.type]
  const width = cfg?.dimensions?.width ?? 1.2
  const depth = cfg?.dimensions?.depth ?? 0.9
  const cos = Math.abs(Math.cos(spot.wallYaw || 0))
  const sin = Math.abs(Math.sin(spot.wallYaw || 0))
  const halfX = (width * cos + depth * sin) * 0.5
  const halfZ = (width * sin + depth * cos) * 0.5
  return {
    minX: spot.x - halfX,
    maxX: spot.x + halfX,
    minZ: spot.z - halfZ,
    maxZ: spot.z + halfZ,
  }
}

function boxesOverlap(a, b) {
  return (
    a.minX < b.maxX - 0.01 &&
    a.maxX > b.minX + 0.01 &&
    a.minZ < b.maxZ - 0.01 &&
    a.maxZ > b.minZ + 0.01
  )
}

function collectMazeExclusions(maze) {
  const occupied = new Set()
  if (maze.start) occupied.add(`${maze.start.row},${maze.start.col}`)
  if (maze.exit) occupied.add(`${maze.exit.row},${maze.exit.col}`)
  for (const h of maze.hazards || []) {
    occupied.add(`${h.row},${h.col}`)
  }
  for (const k of maze.keycards || []) {
    occupied.add(`${k.row},${k.col}`)
  }
  for (const item of [
    ...(maze.collectibles?.items || []),
    ...(maze.collectibles?.coins || []),
    ...(maze.collectibles?.powerUps || []),
  ]) {
    occupied.add(`${item.row},${item.col}`)
  }
  for (const enemy of maze.enemies || []) {
    const cell = enemy?.spawnCell || enemy
    if (Number.isInteger(cell?.row) && Number.isInteger(cell?.col)) {
      occupied.add(`${cell.row},${cell.col}`)
    }
  }
  return occupied
}

// =========================================================================
// Test 1: Category Inventory & Centralized Config Integration
// =========================================================================
console.log('Test 1: Exact 8 hiding-spot categories and centralized configuration')

assert.equal(ALL_HIDING_SPOT_TYPES.length, 8, 'Exactly 8 hiding-spot types exist')
assert.equal(HIDING_SPOT_SELECTION_COUNT, 4, 'Selection count constant is 4')
assert.equal(MIN_HIDING_SPOT_INSTANCES_PER_TYPE, 2, 'Minimum instances per type constant is 2')
assert.deepEqual(
  [...ALL_HIDING_SPOT_TYPES].sort(),
  [
    'elevated_platform',
    'floor_hatch',
    'heavy_industrial_curtains',
    'machinery_hiding',
    'metal_cupboard',
    'pipe_crawlspace',
    'storage_shelves',
    'wall_alcove',
  ],
  'Exact 8 canonical hiding-spot category names match specification'
)

const resolvedDefaults = resolveHidingProgressionConfig()
assert.equal(resolvedDefaults.selectionCount, 4)
assert.equal(resolvedDefaults.minInstancesPerType, 2)
assert.ok(Array.isArray(resolvedDefaults.quantitySchedule) && resolvedDefaults.quantitySchedule.length >= 4)

// =========================================================================
// Test 2: Milestone Levels 1, 2, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000
// =========================================================================
console.log('Test 2: Milestone levels selection, multi-instance allocation, placement, exclusions & solvability')

const placedTotalsByLevel = new Map()

for (const level of MILESTONE_LEVELS) {
  const config = getLevelConfig(level, BASE_SEED)
  assert.ok(config.hidingSpotSelection, `Level ${level} config exposes hidingSpotSelection`)
  assert.ok(config.hidingSpotAllocation, `Level ${level} config exposes hidingSpotAllocation`)
  assert.ok(config.hidingSpotAllocationSummary, `Level ${level} config exposes hidingSpotAllocationSummary`)

  const selection = config.hidingSpotSelection
  assert.equal(selection.selectedTypes.length, 4, `Level ${level} selects exactly 4 types`)
  assert.equal(new Set(selection.selectedTypes).size, 4, `Level ${level} selected types are distinct`)
  assert.equal(selection.unselectedTypes.length, 4, `Level ${level} leaves exactly 4 unselected types`)

  const selectedSet = new Set(selection.selectedTypes)
  for (const type of selection.selectedTypes) {
    assert.equal(isValidHidingSpotType(type), true, `Level ${level} type ${type} is valid`)
    assert.equal(selection.unselectedTypes.includes(type), false, `Level ${level} type ${type} not in unselected`)
  }
  assert.equal(
    selection.selectedTypes.length + selection.unselectedTypes.length,
    ALL_HIDING_SPOT_TYPES.length
  )

  const allocation = config.hidingSpotAllocation
  assert.deepEqual(allocation.selectedTypes, selection.selectedTypes)
  for (const type of selection.selectedTypes) {
    const qty = allocation.typeQuantities[type]
    assert.ok(
      Number.isInteger(qty) && qty >= 2,
      `Level ${level} allocates >= 2 instances for ${type} (got ${qty})`
    )
  }

  const maze = generateMaze({ level, baseSeed: BASE_SEED })
  const validation = validateMaze(maze)
  assert.equal(validation.valid, true, `Level ${level} maze remains valid and solvable`)

  assert.deepEqual(maze.hidingSpotSelection.selectedTypes, selection.selectedTypes)
  assert.deepEqual(maze.hidingSpotAllocation.typeQuantities, allocation.typeQuantities)

  // Metadata parity
  const report = maze.hidingSpotPlacementReport
  const meta = maze.hidingSpotMetadata
  assert.ok(report, `Level ${level} exposes hidingSpotPlacementReport`)
  assert.ok(meta, `Level ${level} exposes hidingSpotMetadata`)
  assert.deepEqual(meta.selectedTypes, selection.selectedTypes)
  assert.deepEqual(meta.unselectedTypes, selection.unselectedTypes)
  assert.deepEqual(meta.allocatedQuantities, allocation.typeQuantities)
  assert.deepEqual(meta.placedQuantities, report.placedByType)
  assert.deepEqual(meta.shortfallsByType, report.shortfallsByType)
  assert.equal(meta.requestedTotal, report.requestedTotal)
  assert.equal(meta.placedTotal, maze.hidingSpots.length)
  assert.equal(meta.shortfallTotal, report.shortfallTotal)
  assert.equal(report.unselectedSpawnCount, 0, `Level ${level} spawns zero unselected types`)

  // Verify every selected type placed multiple instances and zero unselected types appeared
  const countByType = new Map()
  const occupiedOther = collectMazeExclusions(maze)
  const usedCells = new Set()
  const boxes = []

  for (const spot of maze.hidingSpots) {
    assert.equal(selectedSet.has(spot.type), true, `Level ${level} excludes unselected type ${spot.type}`)
    countByType.set(spot.type, (countByType.get(spot.type) || 0) + 1)

    // Walkable PATH tile & valid wall mount
    assert.equal(
      maze.grid[spot.row]?.[spot.col],
      CELL_TYPES.PATH,
      `Level ${level} spot ${spot.id} sits on walkable PATH cell`
    )
    assert.equal(
      maze.grid[spot.wallRow]?.[spot.wallCol],
      CELL_TYPES.WALL,
      `Level ${level} spot ${spot.id} mounts to solid WALL cell`
    )

    // Corridor clearance (>= 1.92m remaining passage width) & finite entry/interior anchors
    const placementCfg = HIDING_SPOT_CONFIG[spot.type].placement
    const remainingPassage =
      4 - (placementCfg.wallGap + placementCfg.halfDepthBack + placementCfg.halfDepthFront)
    assert.ok(
      remainingPassage >= 1.92,
      `Level ${level} spot ${spot.id} preserves corridor clearance (${remainingPassage.toFixed(2)}m)`
    )
    assert.ok(
      Number.isFinite(spot.entryAnchor?.x) && Number.isFinite(spot.entryAnchor?.z),
      `Level ${level} spot ${spot.id} has valid entryAnchor`
    )

    // No duplicate cells & no overlap with spawn, exit, hazards, keycards, collectibles, enemies
    const cellKey = `${spot.row},${spot.col}`
    assert.equal(usedCells.has(cellKey), false, `Level ${level} spot ${spot.id} does not share cell`)
    usedCells.add(cellKey)
    assert.equal(
      occupiedOther.has(cellKey),
      false,
      `Level ${level} spot ${spot.id} avoids spawn/exit/hazards/keycards/collectibles/enemies`
    )

    // World-space non-overlap with other hiding spots
    const box = getSpotWorldBox(spot)
    for (const prevBox of boxes) {
      assert.equal(boxesOverlap(box, prevBox), false, `Level ${level} spot ${spot.id} has zero world-space overlap`)
    }
    boxes.push(box)
  }

  for (const type of selection.selectedTypes) {
    const placed = countByType.get(type) || 0
    assert.ok(
      placed >= 2,
      `Level ${level} places multiple instances (>= 2) of selected type ${type} (got ${placed})`
    )
    assert.equal(
      placed,
      allocation.typeQuantities[type],
      `Level ${level} fulfills full allocation for ${type}`
    )
  }

  assert.equal(report.hadShortfall, false, `Level ${level} has zero shortfalls on standard maze`)
  assert.equal(report.fullySatisfied, true, `Level ${level} is fully satisfied`)
  placedTotalsByLevel.set(level, maze.hidingSpots.length)

  // Strict determinism check for identical level + baseSeed
  const mazeCopy = generateMaze({ level, baseSeed: BASE_SEED })
  assert.deepEqual(
    maze.hidingSpots.map((s) => ({
      id: s.id,
      type: s.type,
      row: s.row,
      col: s.col,
      wallSide: s.wallSide,
      x: s.x,
      z: s.z,
    })),
    mazeCopy.hidingSpots.map((s) => ({
      id: s.id,
      type: s.type,
      row: s.row,
      col: s.col,
      wallSide: s.wallSide,
      x: s.x,
      z: s.z,
    })),
    `Level ${level} hiding spot selection, quantities, and placement are strictly deterministic`
  )
}

// Gradual density scaling across progression & maze-size cap enforcement
assert.ok(
  placedTotalsByLevel.get(50) > placedTotalsByLevel.get(1),
  `High-level large maze (L50=${placedTotalsByLevel.get(50)}) scales above L1 (${placedTotalsByLevel.get(1)})`
)
assert.ok(
  placedTotalsByLevel.get(5000) <= DEFAULT_HIDING_PROGRESSION_CONFIG.maxTotalHidingSpots,
  `L5000 total (${placedTotalsByLevel.get(5000)}) stays bounded below maxTotalHidingSpots`
)

const smallHighLevelAlloc = allocateHidingSpotQuantitiesForLevel({
  level: 50,
  baseSeed: BASE_SEED,
  rows: 11,
  cols: 11,
  selection: selectHidingSpotTypesForLevel({ level: 50, baseSeed: BASE_SEED }),
})
assert.ok(
  smallHighLevelAlloc.totalTargetSpots <= 10,
  `High level on small 11x11 maze respects maze-size density cap (got ${smallHighLevelAlloc.totalTargetSpots})`
)
console.log('✓ All 13 milestone levels verified')

// =========================================================================
// Test 3: Statistical Randomness, Fairness & Consecutive Independence
// =========================================================================
console.log('Test 3: Statistical randomness, zero unlock schedule & consecutive level independence')

const typeAppearances = Object.fromEntries(ALL_HIDING_SPOT_TYPES.map((t) => [t, 0]))
const firstSlotTypes = new Set()
const consecutiveOverlaps = new Set()
let prevSelectedSet = null

for (let lvl = 1; lvl <= 80; lvl += 1) {
  const sel = selectHidingSpotTypesForLevel({ level: lvl, baseSeed: 777123 })
  assert.equal(sel.selectedTypes.length, 4)
  assert.equal(new Set(sel.selectedTypes).size, 4)
  firstSlotTypes.add(sel.selectedTypes[0])
  for (const t of sel.selectedTypes) {
    typeAppearances[t] += 1
  }
  const curSet = new Set(sel.selectedTypes)
  if (prevSelectedSet) {
    let overlap = 0
    for (const t of curSet) {
      if (prevSelectedSet.has(t)) overlap += 1
    }
    consecutiveOverlaps.add(overlap)
  }
  prevSelectedSet = curSet
}

// Every one of the 8 hiding types appears well across 80 levels (expected ~40 each)
for (const type of ALL_HIDING_SPOT_TYPES) {
  assert.ok(
    typeAppearances[type] >= 18 && typeAppearances[type] <= 62,
    `Type ${type} appears fairly across 80 levels (got ${typeAppearances[type]})`
  )
}
// No alphabetical lock on index 0
assert.ok(
  firstSlotTypes.size >= 6,
  `Selected types are not alphabetically sorted (distinct first-slot types: ${firstSlotTypes.size})`
)
// Consecutive levels overlap naturally across multiple counts (not disjoint-cycled or frozen)
assert.ok(
  consecutiveOverlaps.size >= 3,
  `Consecutive levels exhibit natural independent overlap distribution (${[...consecutiveOverlaps].join(',')})`
)

// Different seeds at Level 1 produce all 8 types across 40 runs (no Level 1 unlock restriction)
const level1TypesSeen = new Set()
const level1Signatures = new Set()
for (let s = 1; s <= 40; s += 1) {
  const sel = selectHidingSpotTypesForLevel({ level: 1, baseSeed: s * 9973 })
  for (const t of sel.selectedTypes) level1TypesSeen.add(t)
  level1Signatures.add(sel.selectedTypes.join(','))
}
assert.equal(level1TypesSeen.size, 8, 'All 8 hiding-spot types can appear on Level 1 (no unlock schedule)')
assert.ok(level1Signatures.size >= 25, 'Different seeds produce varied Level 1 selections')
console.log('✓ Randomness fairness, seed variation & consecutive independence verified')

// =========================================================================
// Test 4: Strict RNG Stream Isolation (Category vs Quantity vs Placement vs Maze)
// =========================================================================
console.log('Test 4: Strict RNG stream isolation between selection, allocation, placement & maze subsystems')

const baselineMaze = generateMaze({ level: 12, baseSeed: BASE_SEED })
const alteredHidingMaze = generateMaze({
  level: 12,
  baseSeed: BASE_SEED,
  hidingConfig: {
    forcedTypes: ['metal_cupboard', 'floor_hatch', 'wall_alcove', 'storage_shelves'],
    perTypeQuantities: {
      metal_cupboard: 5,
      floor_hatch: 4,
      wall_alcove: 4,
      storage_shelves: 5,
    },
    maxTotalHidingSpots: 20,
  },
})

// Maze geometry, start/exit, hazards, keycards, and collectibles must be bit-for-bit identical
assert.deepEqual(alteredHidingMaze.grid, baselineMaze.grid, 'Hiding config never perturbs maze grid')
assert.deepEqual(alteredHidingMaze.start, baselineMaze.start, 'Hiding config never perturbs maze start')
assert.deepEqual(alteredHidingMaze.exit, baselineMaze.exit, 'Hiding config never perturbs maze exit')
assert.deepEqual(alteredHidingMaze.hazards, baselineMaze.hazards, 'Hiding config never perturbs hazards')
assert.deepEqual(alteredHidingMaze.keycards, baselineMaze.keycards, 'Hiding config never perturbs keycards')
assert.deepEqual(alteredHidingMaze.collectibles, baselineMaze.collectibles, 'Hiding config never perturbs collectibles')

// Quantity settings never alter category selection
const selDefault = selectHidingSpotTypesForLevel({ level: 15, baseSeed: BASE_SEED })
const selWithQtyOverride = selectHidingSpotTypesForLevel({
  level: 15,
  baseSeed: BASE_SEED,
  hidingConfig: {
    minInstancesPerType: 3,
    maxInstancesPerType: 6,
    perTypeQuantities: { floor_hatch: 5 },
  },
})
assert.deepEqual(
  selDefault.selectedTypes,
  selWithQtyOverride.selectedTypes,
  'Quantity configuration never affects category selection'
)

// Category selection order/membership never perturbs another type's independent quantity roll
const allocOrderA = allocateHidingSpotQuantitiesForLevel({
  level: 15,
  baseSeed: BASE_SEED,
  rows: 25,
  cols: 25,
  selection: {
    selectedTypes: ['metal_cupboard', 'floor_hatch', 'wall_alcove', 'storage_shelves'],
  },
})
const allocOrderB = allocateHidingSpotQuantitiesForLevel({
  level: 15,
  baseSeed: BASE_SEED,
  rows: 25,
  cols: 25,
  selection: {
    selectedTypes: ['pipe_crawlspace', 'machinery_hiding', 'elevated_platform', 'metal_cupboard'],
  },
})
assert.equal(
  allocOrderA.typeQuantities.metal_cupboard,
  allocOrderB.typeQuantities.metal_cupboard,
  'Pre-cap quantity roll for metal_cupboard is completely independent of partner types and slot order'
)

// Explicit enemy exclusion in direct placeHidingSpotsWithReport call
const directMaze = generateMaze({ level: 6, baseSeed: 551199 })
const syntheticEnemies = directMaze.hidingSpots.slice(0, 3).map((spot, idx) => ({
  id: `enemy-synthetic-${idx}`,
  spawnCell: { row: spot.row, col: spot.col },
}))
const directWithEnemies = placeHidingSpotsWithReport(directMaze, {
  enemies: syntheticEnemies,
  hidingSpotSelection: directMaze.hidingSpotSelection,
  hidingSpotAllocation: directMaze.hidingSpotAllocation,
})
const enemyKeys = new Set(syntheticEnemies.map((e) => `${e.spawnCell.row},${e.spawnCell.col}`))
for (const spot of directWithEnemies.hidingSpots) {
  assert.equal(
    enemyKeys.has(`${spot.row},${spot.col}`),
    false,
    `Direct placeHidingSpotsWithReport excludes enemy spawnCell (${spot.row},${spot.col})`
  )
}
console.log('✓ RNG stream isolation & explicit enemy exclusion verified')

// =========================================================================
// Test 5: Shortfall Reporting, Wave Fairness & Zero Silent Substitution
// =========================================================================
console.log('Test 5: Constrained placement shortfall reporting, wave fairness & zero silent substitution')

const tightBaseMaze = generateMaze({ level: 1, baseSeed: 882211 })
// Block most walkable cells via extra exclusions so capacity cannot fulfill 4 x 5 = 20 spots
const walkableCells = []
for (let r = 1; r < tightBaseMaze.rows - 1; r += 1) {
  for (let c = 1; c < tightBaseMaze.cols - 1; c += 1) {
    if (tightBaseMaze.grid[r][c] === CELL_TYPES.PATH) {
      walkableCells.push({ row: r, col: c })
    }
  }
}
const extraBlocked = walkableCells.slice(0, Math.max(0, walkableCells.length - 10))
const forcedSelected = ['metal_cupboard', 'floor_hatch', 'wall_alcove', 'storage_shelves']
const tightResult = placeHidingSpotsWithReport(tightBaseMaze, {
  excludeCells: extraBlocked,
  hidingSpotSelection: {
    selectedTypes: forcedSelected,
    unselectedTypes: ALL_HIDING_SPOT_TYPES.filter((t) => !forcedSelected.includes(t)),
  },
  hidingSpotAllocation: {
    selectedTypes: forcedSelected,
    typeQuantities: {
      metal_cupboard: 5,
      floor_hatch: 5,
      wall_alcove: 5,
      storage_shelves: 5,
    },
    totalTargetSpots: 20,
  },
})

assert.equal(tightResult.report.hadShortfall, true, 'Constrained maze reports hadShortfall=true')
assert.equal(tightResult.report.fullySatisfied, false, 'Constrained maze reports fullySatisfied=false')
assert.ok(tightResult.report.shortfallTotal > 0, 'Constrained maze reports positive shortfallTotal')
assert.equal(tightResult.report.shortfallTotal, tightResult.report.missingTotal)
assert.deepEqual(tightResult.report.shortfallsByType, tightResult.report.missingByType)
assert.ok(tightResult.report.failures.length > 0, 'Constrained maze records detailed failure reasons')
assert.equal(
  tightResult.report.unselectedSpawnCount,
  0,
  'Shortfall never triggers silent substitution of unselected types'
)
for (const spot of tightResult.hidingSpots) {
  assert.equal(
    forcedSelected.includes(spot.type),
    true,
    `Tight maze only spawns selected types (got ${spot.type})`
  )
}
const sumShortfalls = Object.values(tightResult.report.shortfallsByType).reduce((a, b) => a + b, 0)
assert.equal(sumShortfalls, tightResult.report.shortfallTotal)
assert.equal(
  tightResult.report.placedTotal + tightResult.report.shortfallTotal,
  tightResult.report.requestedTotal
)
console.log('✓ Shortfall reporting and zero silent substitution verified')

// =========================================================================
// Test 6: All 8 Hiding-Spot Mechanics Preserved End-to-End
// =========================================================================
console.log('Test 6: Preserved mechanics across all 8 hiding-spot types')

const mechanicsScene = new THREE.Scene()
const mechanicsManager = new HidingSpotManager(mechanicsScene)

// Construct one valid instance of each of the 8 types by sampling from generated mazes
const sampleSpecByType = new Map()
for (let probeLevel = 1; probeLevel <= 30 && sampleSpecByType.size < 8; probeLevel += 1) {
  const probeMaze = generateMaze({ level: probeLevel, baseSeed: 314159 })
  for (const spot of probeMaze.hidingSpots) {
    if (!sampleSpecByType.has(spot.type)) {
      sampleSpecByType.set(spot.type, { spot, maze: probeMaze })
    }
  }
}
assert.equal(sampleSpecByType.size, 8, 'Collected valid generated instances for all 8 hiding-spot types')

for (const type of ALL_HIDING_SPOT_TYPES) {
  const { spot, maze } = sampleSpecByType.get(type)
  const colIdx = buildPropCollisionIndex(maze, [], { allowEmpty: true })
  mechanicsManager.setMaze({
    ...maze,
    hidingSpots: [spot],
    hidingSpotSelection: { selectedTypes: [type], unselectedTypes: [] },
  })
  mechanicsManager.syncCollidersToIndex(colIdx)
  assert.equal(mechanicsManager.getHidingSpots().length, 1, `Mounted ${type}`)

  const enterRes = mechanicsManager.interact({
    playerWorldPos: { x: spot.entryAnchor.x, y: 0, z: spot.entryAnchor.z },
    playerGridCell: { row: spot.row, col: spot.col },
  })
  assert.equal(enterRes.action, 'enter', `Player enters ${type}`)
  assert.equal(mechanicsManager.isPlayerHiding(), true, `Player is hiding in ${type}`)

  const perception = mechanicsManager.getEnemyPerceptionContext(false)
  assert.equal(perception?.active, true, `Enemy perception sees player hidden in ${type}`)
  assert.equal(perception?.spotType, type, `Perception reports type ${type}`)
  assert.ok(perception.concealment > 0, `Type ${type} provides concealment`)

  mechanicsManager.update(0.5, { flashlightActive: false, reducedMotion: false })
  const exitRes = mechanicsManager.exitActiveSpot({ forced: false })
  assert.equal(exitRes.action, 'exit', `Player exits ${type}`)
  assert.equal(mechanicsManager.isPlayerHiding(), false, `Player no longer hiding after exiting ${type}`)
}
mechanicsManager.dispose()
console.log('✓ All 8 hiding-spot types retain enter/exit/concealment/collider/cleanup mechanics')

// =========================================================================
// Test 7: Replay, Next-Level, Set-Level & New-Game Transitions
// =========================================================================
console.log('Test 7: Replay, next-level, set-level & new-game transition rebuilding')

let state = createInitialGameState({ level: 1, baseSeed: BASE_SEED })
assert.equal(state.currentLevel, 1)
assert.equal(state.maze.hidingSpotSelection.selectedTypes.length, 4)

const transitionScene = new THREE.Scene()
const transitionManager = new HidingSpotManager(transitionScene)
transitionManager.syncQuality('balanced')
transitionManager.setMaze(state.maze)
let collisionIndex = buildPropCollisionIndex(state.maze, [], { allowEmpty: true })
transitionManager.syncCollidersToIndex(collisionIndex)

assert.deepEqual(
  transitionManager.getSelectedTypes(),
  state.maze.hidingSpotSelection.selectedTypes,
  'HidingSpotManager exposes Level 1 selectedTypes'
)
assert.equal(
  transitionManager.getHidingSpots().length,
  state.maze.hidingSpots.length,
  'HidingSpotManager mounts exact Level 1 hiding spots'
)

// Enter a hiding spot mid-run before REPLAY_LEVEL
const firstSpotL1 = state.maze.hidingSpots[0]
const enterBeforeReplay = transitionManager.interact({
  playerWorldPos: { x: firstSpotL1.entryAnchor.x, y: 0, z: firstSpotL1.entryAnchor.z },
  playerGridCell: { row: firstSpotL1.row, col: firstSpotL1.col },
})
assert.equal(enterBeforeReplay.action, 'enter')
assert.equal(transitionManager.isPlayerHiding(), true)

// Replay Level 1: same maze & hiding spots, active occupancy & cooldowns reset cleanly
const l1SpotIdsBeforeReplay = state.maze.hidingSpots.map((s) => s.id)
state = gameReducer(state, createReplayLevelAction(state))
assert.equal(state.currentLevel, 1)
assert.deepEqual(
  state.maze.hidingSpots.map((s) => s.id),
  l1SpotIdsBeforeReplay,
  'REPLAY_LEVEL preserves exact Level 1 hiding spots'
)
transitionManager.resetStates()
assert.equal(transitionManager.isPlayerHiding(), false, 'Replay clears active hiding state')
assert.equal(
  transitionManager.getHidingSpots().length,
  l1SpotIdsBeforeReplay.length,
  'Replay retains all Level 1 hiding spots'
)

// Enter again before ADVANCE_LEVEL to verify next-level transition cleans up and rebuilds
const enterBeforeAdvance = transitionManager.interact({
  playerWorldPos: { x: firstSpotL1.entryAnchor.x, y: 0, z: firstSpotL1.entryAnchor.z },
  playerGridCell: { row: firstSpotL1.row, col: firstSpotL1.col },
})
assert.equal(enterBeforeAdvance.action, 'enter')

state = gameReducer(state, createAdvanceLevelAction(state))
assert.equal(state.currentLevel, 2)
assert.equal(state.maze.hidingSpotSelection.selectedTypes.length, 4)

transitionManager.setMaze(state.maze)
collisionIndex = buildPropCollisionIndex(state.maze, [], { allowEmpty: true })
transitionManager.syncCollidersToIndex(collisionIndex)

assert.equal(transitionManager.isPlayerHiding(), false, 'Next-level transition clears prior hiding occupancy')
assert.deepEqual(
  transitionManager.getSelectedTypes(),
  state.maze.hidingSpotSelection.selectedTypes,
  'Next-level transition updates HidingSpotManager selectedTypes to Level 2'
)
assert.equal(
  transitionManager.getHidingSpots().length,
  state.maze.hidingSpots.length,
  'Next-level transition mounts exact Level 2 hiding spot count'
)
assert.equal(
  transitionManager.getPlacementReport()?.placedTotal,
  state.maze.hidingSpots.length,
  'Next-level transition updates HidingSpotManager placement report'
)
assert.equal(
  transitionScene.children.length,
  state.maze.hidingSpots.length,
  'Previous level hiding-spot meshes were cleanly removed from scene'
)

// SET_LEVEL to Level 25
state = gameReducer(state, createSetLevelAction(state, 25))
assert.equal(state.currentLevel, 25)
transitionManager.setMaze(state.maze)
assert.deepEqual(
  transitionManager.getSelectedTypes(),
  state.maze.hidingSpotSelection.selectedTypes,
  'SET_LEVEL rebuilds hiding spots for Level 25'
)
assert.equal(transitionManager.getHidingSpots().length, state.maze.hidingSpots.length)

// NEW_GAME resets to Level 1 with fresh seed
const oldSeed = state.baseSeed
state = gameReducer(state, createNewGameAction(state))
assert.equal(state.currentLevel, 1)
assert.notEqual(state.baseSeed, oldSeed)
transitionManager.setMaze(state.maze)
assert.equal(transitionManager.getSelectedTypes().length, 4)
assert.equal(transitionManager.getHidingSpots().length, state.maze.hidingSpots.length)

transitionManager.dispose()
console.log('✓ Replay, next-level, set-level & new-game transitions verified')

console.log('✓ All Level-Based Hiding Progression tests passed successfully!')
