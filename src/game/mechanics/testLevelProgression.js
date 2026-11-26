import assert from 'node:assert'
import {
  DEFAULT_INITIAL_LEVEL,
  INITIAL_BASE_SEED,
  isValidLevel,
  normalizeLevel,
  normalizeBaseSeed,
  getNextLevel,
  getLevelSeed,
  getLevelConfig,
  DEFAULT_MAZE_PROGRESSION_CONFIG,
  calculateMazeDimensionsForLevel,
  calculateBraidFactorForLevel,
} from './levelProgression.js'
import { createInitialGameState, gameReducer, INITIAL_SEED } from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  CELL_TYPES,
  MAX_BRAID_FACTOR,
  MAX_MAZE_DIMENSION,
  MIN_BRAID_FACTOR,
  MIN_MAZE_DIMENSION,
  normalizeDimension,
} from '../generation/mazeConfig.js'
import { validateMaze } from '../generation/pathfinder.js'

console.log('--- RUNNING INFINITE LEVEL PROGRESSION TESTS ---')

// ---------------------------------------------------------------------------
// 1. Level normalization, validation, and unbounded progression
// ---------------------------------------------------------------------------
console.log('Test 1: Unbounded level normalization and validation (no artificial maximum)')
assert.equal(DEFAULT_INITIAL_LEVEL, 1, 'Default initial level is 1')
assert.equal(INITIAL_BASE_SEED, 409217, 'Initial base seed matches 409217')
assert.equal(INITIAL_SEED, 409217, 'gameReducer INITIAL_SEED matches 409217')
assert.equal(normalizeBaseSeed(), 409217, 'Default normalizeBaseSeed is 409217')
assert.equal(normalizeBaseSeed(12345), 12345, 'normalizeBaseSeed(12345) is 12345')
assert.ok(typeof normalizeBaseSeed('seed-str') === 'number', 'normalizeBaseSeed string produces numeric hash')

assert.equal(isValidLevel(1), true, 'Level 1 is valid')
assert.equal(isValidLevel(5), true, 'Level 5 is valid')
assert.equal(isValidLevel(100), true, 'Level 100 is valid')
assert.equal(isValidLevel(5000), true, 'Level 5000 is valid')
assert.equal(isValidLevel(1000000), true, 'Level 1000000 is valid (no artificial maximum)')
assert.equal(isValidLevel('42'), true, 'String integer 42 is valid')
assert.equal(isValidLevel(0), false, 'Level 0 is not valid')
assert.equal(isValidLevel(-1), false, 'Negative level is not valid')
assert.equal(isValidLevel(3.14), false, 'Float level is not valid')
assert.equal(isValidLevel(''), false, 'Empty string is not valid')
assert.equal(isValidLevel('abc'), false, 'Non-numeric string is not valid')
assert.equal(isValidLevel(null), false, 'null is not valid')
assert.equal(isValidLevel(undefined), false, 'undefined is not valid')

// Unbounded normalization checks for positive integers: 1, 5, 6, 10, 11, 25, 26, 100, 5000
const testLevels = [1, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000, 100000]
for (const lvl of testLevels) {
  assert.equal(normalizeLevel(lvl), lvl, `normalizeLevel preserves ${lvl}`)
  assert.equal(getNextLevel(lvl), lvl + 1, `getNextLevel(${lvl}) is ${lvl + 1}`)
}

assert.equal(normalizeLevel(0), 1, 'normalizeLevel(0) falls back to 1')
assert.equal(normalizeLevel(-10), 1, 'normalizeLevel(-10) falls back to 1')
assert.equal(normalizeLevel(NaN), 1, 'normalizeLevel(NaN) falls back to 1')
assert.equal(normalizeLevel(null), 1, 'normalizeLevel(null) falls back to 1')
assert.equal(normalizeLevel(undefined), 1, 'normalizeLevel(undefined) falls back to 1')
assert.equal(normalizeLevel('25'), 25, 'normalizeLevel("25") parses to 25')
assert.equal(normalizeLevel(7.9), 7, 'normalizeLevel(7.9) truncates to 7')

// ---------------------------------------------------------------------------
// 2. Deterministic, reproducible level-based seed generation
// ---------------------------------------------------------------------------
console.log('Test 2: Level-based deterministic seed derivation and reproducibility')
const baseSeed = 409217

// Same level + same baseSeed produces identical seeds
for (const lvl of [1, 2, 5, 10, 100, 5000]) {
  const seedA = getLevelSeed(lvl, baseSeed)
  const seedB = getLevelSeed(lvl, baseSeed)
  const seedC = getLevelSeed(lvl, baseSeed)
  assert.equal(seedA, seedB, `Level ${lvl} seed derivation is reproducible`)
  assert.equal(seedB, seedC, `Level ${lvl} seed derivation is stable`)
  assert.ok(typeof seedA === 'number' && Number.isInteger(seedA) && seedA > 0, `Level ${lvl} seed is a valid positive integer`)
}

// Level 1 preserves base seed for backwards compatibility
assert.equal(getLevelSeed(1, baseSeed), baseSeed, 'Level 1 preserves the baseSeed directly')
assert.equal(getLevelSeed(1, 12345), 12345, 'Level 1 preserves custom baseSeed 12345')

// Different levels with the same baseSeed receive distinct seeds
const generatedSeeds = new Set()
for (const lvl of testLevels) {
  const seed = getLevelSeed(lvl, baseSeed)
  assert.equal(generatedSeeds.has(seed), false, `Level ${lvl} has a unique seed (${seed})`)
  generatedSeeds.add(seed)
}
assert.equal(generatedSeeds.size, testLevels.length, 'All test levels received unique generation seeds')

// Different base seeds produce different seeds for the same level
const seedBaseA = getLevelSeed(5, 409217)
const seedBaseB = getLevelSeed(5, 999999)
assert.notEqual(seedBaseA, seedBaseB, 'Different base seeds produce different level seeds')

// ---------------------------------------------------------------------------
// 3. Centralized getLevelConfig module descriptor
// ---------------------------------------------------------------------------
console.log('Test 3: getLevelConfig centralized configuration')
for (const lvl of [1, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000]) {
  const config = getLevelConfig(lvl, baseSeed)
  assert.ok(config, `Config returned for level ${lvl}`)
  assert.equal(config.level, lvl, `Config level matches ${lvl}`)
  assert.equal(config.currentLevel, lvl, `Config currentLevel matches ${lvl}`)
  assert.equal(config.baseSeed, baseSeed, `Config baseSeed matches ${baseSeed}`)
  assert.equal(config.seed, getLevelSeed(lvl, baseSeed), `Config seed matches getLevelSeed(${lvl})`)
  assert.ok(config.rows >= MIN_MAZE_DIMENSION && config.rows <= MAX_MAZE_DIMENSION, `Level ${lvl} rows within bounds`)
  assert.equal(config.rows % 2, 1, `Level ${lvl} rows is odd`)
  assert.equal(config.cols, config.rows, `Level ${lvl} cols matches rows`)
  assert.deepStrictEqual(config.dimensions, { rows: config.rows, cols: config.cols }, `Level ${lvl} dimensions matches`)
  assert.ok(config.braidFactor >= MIN_BRAID_FACTOR && config.braidFactor <= MAX_BRAID_FACTOR, `Level ${lvl} braidFactor in bounds`)
}

// Default invocations
const defaultConfig = getLevelConfig()
assert.equal(defaultConfig.level, 1, 'Default getLevelConfig level is 1')
assert.equal(defaultConfig.baseSeed, INITIAL_BASE_SEED, 'Default getLevelConfig baseSeed is 409217')
assert.equal(defaultConfig.seed, 409217, 'Default getLevelConfig seed is 409217')
assert.equal(defaultConfig.rows, 11, 'Default getLevelConfig Level 1 rows is 11')
assert.equal(defaultConfig.cols, 11, 'Default getLevelConfig Level 1 cols is 11')
assert.equal(defaultConfig.braidFactor, 0, 'Default getLevelConfig Level 1 braidFactor is 0')

// ---------------------------------------------------------------------------
// 4. Maze generation receives level and seed cleanly
// ---------------------------------------------------------------------------
console.log('Test 4: Maze generation receives level and seed through existing architecture')
const mazeLevel1 = generateMaze({ seed: 12345, level: 1 })
assert.equal(mazeLevel1.level, 1, 'Maze object records level 1')
assert.equal(mazeLevel1.currentLevel, 1, 'Maze object records currentLevel 1')
assert.equal(mazeLevel1.rows, 11, 'Level 1 maze starts at 11 rows (Easy)')
assert.equal(mazeLevel1.cols, 11, 'Level 1 maze starts at 11 cols (Easy)')
assert.deepStrictEqual(mazeLevel1.dimensions, { rows: 11, cols: 11 }, 'Level 1 maze records dimensions')
assert.equal(mazeLevel1.braidFactor, 0, 'Level 1 maze records braidFactor = 0')
assert.equal(mazeLevel1.seed, 12345, 'Maze object records seed 12345')
assert.equal(mazeLevel1.id, 'maze-L1-11x11-12345', 'Maze id reflects Level 1, dimensions, seed')
assert.ok(mazeLevel1.grid, 'Maze has grid')
assert.ok(mazeLevel1.start, 'Maze has start')
assert.ok(mazeLevel1.exit, 'Maze has exit')
assert.ok(mazeLevel1.shortestPath.length > 0, 'Maze has shortestPath')

const mazeLevel5Seed = getLevelSeed(5, 12345)
const mazeLevel5A = generateMaze({ seed: mazeLevel5Seed, level: 5 })
const mazeLevel5B = generateMaze({ seed: mazeLevel5Seed, level: 5 })
assert.equal(mazeLevel5A.level, 5, 'Maze object records level 5')
assert.equal(mazeLevel5A.currentLevel, 5, 'Maze object records currentLevel 5')
assert.equal(mazeLevel5A.seed, mazeLevel5Seed, 'Maze object records level 5 seed')
assert.equal(mazeLevel5A.id, `maze-L5-${mazeLevel5A.rows}x${mazeLevel5A.cols}-${mazeLevel5Seed}`, 'Maze id reflects Level 5')
assert.deepStrictEqual(mazeLevel5A.grid, mazeLevel5B.grid, 'Same level + seed produces identical maze grid')
assert.deepStrictEqual(mazeLevel5A.start, mazeLevel5B.start, 'Same level + seed produces identical start')
assert.deepStrictEqual(mazeLevel5A.exit, mazeLevel5B.exit, 'Same level + seed produces identical exit')

// ---------------------------------------------------------------------------
// 5. Fresh game startup, game state, inventory & mechanics preservation
// ---------------------------------------------------------------------------
console.log('Test 5: Fresh game startup begins at Level 1 (11x11) and preserves existing state')
const freshState = createInitialGameState()
assert.equal(freshState.currentLevel, 1, 'Fresh game starts at currentLevel = 1')
assert.equal(freshState.seed, 409217, 'Fresh game default seed is 409217')
assert.equal(freshState.baseSeed, 409217, 'Fresh game default baseSeed is 409217')
assert.equal(freshState.maze.rows, 11, 'Fresh game starts with 11x11 maze')
assert.equal(freshState.maze.cols, 11, 'Fresh game starts with 11x11 maze')
assert.equal(freshState.hasWon, false, 'hasWon is false on startup')
assert.equal(freshState.isGameOver, false, 'isGameOver is false on startup')
assert.equal(freshState.health, 100, 'Initial health is 100')
assert.equal(freshState.maxHealth, 100, 'Initial maxHealth is 100')
assert.equal(freshState.battery, 100, 'Initial battery is 100')
assert.equal(freshState.maxBattery, 100, 'Initial maxBattery is 100')
assert.ok(freshState.inventory, 'Inventory is initialized')
assert.ok(freshState.activeEffects, 'ActiveEffects is initialized')
assert.ok(Array.isArray(freshState.items), 'Collectibles items list is initialized')
assert.ok(Array.isArray(freshState.maze.hazards), 'Hazards are placed and preserved')
assert.ok(Array.isArray(freshState.maze.hidingSpots), 'Hiding spots are placed and preserved')
assert.equal(freshState.maze.level, 1, 'Maze level is 1')
assert.equal(freshState.maze.currentLevel, 1, 'Maze currentLevel is 1')
assert.equal('difficulty' in freshState, false, 'No difficulty property in state')

// Verify all 8 hiding spot types are present or supported in generation
const allHidingTypes = new Set(freshState.maze.hidingSpots.map((h) => h.type))
assert.ok(allHidingTypes.size > 0, 'Hiding spots are generated in maze')

// ---------------------------------------------------------------------------
// 6. Legacy helper signatures and backwards compatibility
// ---------------------------------------------------------------------------
console.log('Test 6: Backwards compatibility with existing callers and tests')
// Standard call with seed
const stateWithSeed = createInitialGameState(12345)
assert.equal(stateWithSeed.currentLevel, 1, 'Starts at level 1 with custom seed')
assert.equal(stateWithSeed.seed, 12345, 'Seed matches 12345')
assert.equal('difficulty' in stateWithSeed, false, 'No difficulty property')

// Standard call with seed and config
const stateWithConfig = createInitialGameState(9191, { objectivesEnabled: false })
assert.equal(stateWithConfig.currentLevel, 1, 'Starts at level 1')
assert.equal(stateWithConfig.seed, 9191, 'Seed matches 9191')
assert.equal(stateWithConfig.objectivesEnabled, false, 'Config applied cleanly')

// Legacy signature: createInitialGameState(difficulty, seed, overrides)
const legacyState = createInitialGameState('easy', 9901, { objectivesEnabled: true })
assert.equal(legacyState.currentLevel, 1, 'Legacy call starts at level 1')
assert.equal(legacyState.seed, 9901, 'Legacy call preserves seed 9901')
assert.equal(legacyState.maze.rows, 11, 'Legacy difficulty "easy" produces 11 rows')
assert.equal(legacyState.maze.cols, 11, 'Legacy difficulty "easy" produces 11 cols')

// Config signature with specified level
const level5State = createInitialGameState({ currentLevel: 5, baseSeed: 12345 })
assert.equal(level5State.currentLevel, 5, 'Explicit level 5 initializes currentLevel = 5')
assert.equal(level5State.baseSeed, 12345, 'baseSeed is 12345')
assert.equal(level5State.seed, getLevelSeed(5, 12345), 'seed derived deterministically for Level 5')
assert.equal(level5State.maze.level, 5, 'maze.level is 5')
assert.equal(level5State.maze.rows, 15, 'Level 5 maze is 15x15')

// ---------------------------------------------------------------------------
// 7. gameReducer progression actions (RESET_RUN, NEW_MAZE, SET_LEVEL)
// ---------------------------------------------------------------------------
console.log('Test 7: Progression state transitions in gameReducer')
// RESET_RUN preserves currentLevel and baseSeed
const resetState = gameReducer(level5State, { type: 'RESET_RUN' })
assert.equal(resetState.currentLevel, 5, 'RESET_RUN preserves currentLevel 5')
assert.equal(resetState.baseSeed, 12345, 'RESET_RUN preserves baseSeed 12345')
assert.equal(resetState.seed, level5State.seed, 'RESET_RUN preserves level seed')
assert.equal('difficulty' in resetState, false, 'RESET_RUN has no difficulty')

// NEW_MAZE increments currentLevel and advances to reproducible next seed
const nextLevelState = gameReducer(freshState, { type: 'NEW_MAZE' })
assert.equal(nextLevelState.currentLevel, 2, 'NEW_MAZE increments level 1 to 2')
assert.equal(nextLevelState.hasWon, false, 'NEW_MAZE clears hasWon')
assert.notEqual(nextLevelState.seed, freshState.seed, 'NEW_MAZE advances seed')
assert.equal(nextLevelState.seed, getLevelSeed(2, freshState.baseSeed), 'NEW_MAZE seed matches getLevelSeed(2)')
assert.equal(nextLevelState.maze.level, 2, 'NEW_MAZE maze records level 2')
assert.equal(nextLevelState.maze.rows, 13, 'Level 2 progresses to 13x13')

const nextLevelState2 = gameReducer(nextLevelState, { type: 'NEW_MAZE' })
assert.equal(nextLevelState2.currentLevel, 3, 'NEW_MAZE increments level 2 to 3')
assert.equal(nextLevelState2.hasWon, false, 'NEW_MAZE clears hasWon')
assert.notEqual(nextLevelState2.seed, nextLevelState.seed, 'NEW_MAZE advances seed again')
assert.equal(nextLevelState2.seed, getLevelSeed(3, freshState.baseSeed), 'NEW_MAZE seed matches getLevelSeed(3)')
assert.equal(nextLevelState2.maze.level, 3, 'NEW_MAZE maze records level 3')

// SET_LEVEL sets arbitrary positive level (e.g. 5000)
const setLevelState = gameReducer(freshState, { type: 'SET_LEVEL', level: 5000 })
assert.equal(setLevelState.currentLevel, 5000, 'SET_LEVEL sets level to 5000')
assert.equal(setLevelState.seed, getLevelSeed(5000, freshState.baseSeed), 'SET_LEVEL uses level 5000 seed')
assert.equal(setLevelState.maze.level, 5000, 'SET_LEVEL maze records level 5000')
assert.equal(setLevelState.maze.currentLevel, 5000, 'SET_LEVEL maze records currentLevel 5000')
assert.equal(setLevelState.maze.rows, MAX_MAZE_DIMENSION, 'Level 5000 maze respects safe dimension ceiling')
assert.equal(setLevelState.maze.cols, MAX_MAZE_DIMENSION, 'Level 5000 maze respects safe dimension ceiling')

// ---------------------------------------------------------------------------
// 8. Progressive Maze Dimensions & Ceiling Verification (Required Levels)
// ---------------------------------------------------------------------------
console.log('Test 8: Progressive maze dimensions across Levels 1, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000')
const expectedDimsByLevel = [
  [1, 11],
  [5, 15],
  [6, 17],
  [10, 21],
  [11, 21],
  [12, 23],
  [15, 25],
  [20, 29],
  [25, 31],
  [26, 33],
  [50, 47],
  [100, 51],
  [5000, 51],
]

let prevDim = 0
let prevBraid = -1
for (const [lvl, expectedDim] of expectedDimsByLevel) {
  const dims = calculateMazeDimensionsForLevel(lvl)
  assert.equal(dims.rows, expectedDim, `Level ${lvl} expected rows=${expectedDim}, got ${dims.rows}`)
  assert.equal(dims.cols, expectedDim, `Level ${lvl} expected cols=${expectedDim}, got ${dims.cols}`)
  assert.equal(dims.rows % 2, 1, `Level ${lvl} preserves odd dimension`)
  assert.ok(dims.rows >= prevDim, `Level ${lvl} dimension (${dims.rows}) is non-decreasing (>= ${prevDim})`)
  prevDim = dims.rows

  const braid = calculateBraidFactorForLevel(lvl)
  assert.ok(
    braid >= MIN_BRAID_FACTOR && braid <= MAX_BRAID_FACTOR,
    `Level ${lvl} braidFactor (${braid}) stays within [${MIN_BRAID_FACTOR}, ${MAX_BRAID_FACTOR}]`
  )
  assert.ok(braid > prevBraid, `Level ${lvl} braidFactor (${braid}) strictly increases (> ${prevBraid})`)
  prevBraid = braid
}

// Explicit check on configurable progression overrides & normalizeDimension safety
assert.equal(normalizeDimension(50), 51, 'normalizeDimension clamps/rounds 50 cleanly to 51')
assert.equal(normalizeDimension(999), MAX_MAZE_DIMENSION, 'normalizeDimension respects MAX_MAZE_DIMENSION=51')
assert.equal(normalizeDimension(40, 11, { max: 40 }), 39, 'Configurable even max=40 clamps to odd 39')
assert.equal(
  calculateMazeDimensionsForLevel(5000, { maxDimension: 41 }).rows,
  41,
  'Custom progressionConfig.maxDimension=41 overrides ceiling cleanly'
)
assert.equal(
  calculateMazeDimensionsForLevel(1, { baseDimension: 13 }).rows,
  13,
  'Custom progressionConfig.baseDimension configures Level 1 dimension'
)

// ---------------------------------------------------------------------------
// 9. Solvability, Determinism & Metadata Verification Across All Tested Levels
// ---------------------------------------------------------------------------
console.log('Test 9: Maze generation determinism, metadata & solvability at every tested level')
const verificationLevels = [1, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000]

for (const lvl of verificationLevels) {
  const levelSeed = getLevelSeed(lvl, baseSeed)
  const mazeA = generateMaze({ level: lvl, seed: levelSeed })
  const mazeB = generateMaze({ level: lvl, seed: levelSeed })

  // Determinism
  assert.deepStrictEqual(mazeA.grid, mazeB.grid, `Level ${lvl} deterministic grid`)
  assert.deepStrictEqual(mazeA.start, mazeB.start, `Level ${lvl} deterministic start`)
  assert.deepStrictEqual(mazeA.exit, mazeB.exit, `Level ${lvl} deterministic exit`)
  assert.deepStrictEqual(mazeA.shortestPath, mazeB.shortestPath, `Level ${lvl} deterministic shortestPath`)
  assert.equal(mazeA.braidFactor, mazeB.braidFactor, `Level ${lvl} deterministic braidFactor`)
  assert.equal(mazeA.id, mazeB.id, `Level ${lvl} deterministic maze id`)

  // Metadata
  assert.equal(mazeA.currentLevel, lvl, `Level ${lvl} metadata.currentLevel`)
  assert.equal(mazeA.level, lvl, `Level ${lvl} metadata.level`)
  assert.equal(mazeA.rows % 2, 1, `Level ${lvl} odd rows`)
  assert.equal(mazeA.cols % 2, 1, `Level ${lvl} odd cols`)
  assert.ok(mazeA.rows <= DEFAULT_MAZE_PROGRESSION_CONFIG.maxDimension, `Level ${lvl} within safe ceiling`)
  assert.deepStrictEqual(mazeA.dimensions, { rows: mazeA.rows, cols: mazeA.cols }, `Level ${lvl} metadata.dimensions`)
  assert.equal(mazeA.seed, levelSeed, `Level ${lvl} metadata.seed`)
  assert.equal(mazeA.id, `maze-L${lvl}-${mazeA.rows}x${mazeA.cols}-${levelSeed}`, `Level ${lvl} metadata.id`)

  // Outer walls sealed & solvability
  for (let r = 0; r < mazeA.rows; r += 1) {
    assert.equal(mazeA.grid[r][0], CELL_TYPES.WALL, `Level ${lvl} left border sealed at row ${r}`)
    assert.equal(mazeA.grid[r][mazeA.cols - 1], CELL_TYPES.WALL, `Level ${lvl} right border sealed at row ${r}`)
  }
  for (let c = 0; c < mazeA.cols; c += 1) {
    assert.equal(mazeA.grid[0][c], CELL_TYPES.WALL, `Level ${lvl} top border sealed at col ${c}`)
    assert.equal(mazeA.grid[mazeA.rows - 1][c], CELL_TYPES.WALL, `Level ${lvl} bottom border sealed at col ${c}`)
  }

  const check = validateMaze(mazeA)
  assert.equal(check.valid, true, `Level ${lvl} (${mazeA.rows}x${mazeA.cols}) is valid and solvable`)
  assert.equal(mazeA.validation.valid, true, `Level ${lvl} embedded validation passes`)
  assert.ok(mazeA.shortestPath.length > 1, `Level ${lvl} has non-trivial solution path`)
}

console.log('✓ All infinite level progression & progressive dimension tests passed successfully!')

