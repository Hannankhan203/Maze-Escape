import assert from 'node:assert/strict'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import {
  CELL_TYPES,
  MAX_BRAID_FACTOR,
  MAX_MAZE_DIMENSION,
  MIN_BRAID_FACTOR,
  normalizeBraidFactor,
  normalizeDimension,
} from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath, validateMaze } from '../generation/pathfinder.js'
import {
  DEFAULT_MAZE_PROGRESSION_CONFIG,
  INITIAL_BASE_SEED,
  calculateBraidFactorForLevel,
  calculateMazeDimensionsForLevel,
  getLevelConfig,
  getLevelSeed,
} from '../mechanics/levelProgression.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { disposeAllSharedPools } from './sharedResources.js'
import { createMazeChunkLayout, getLayerMeshes } from './spatialChunking.js'

console.log('--- RUNNING PROGRESSIVE MAZE DIMENSIONS & BRAIDING TESTS ---')

function countDeadEnds(grid) {
  let deadEnds = 0
  const rows = grid.length
  const cols = grid[0].length
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]

  for (let r = 1; r < rows - 1; r += 2) {
    for (let c = 1; c < cols - 1; c += 2) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      let neighbors = 0
      for (let i = 0; i < dirs.length; i += 1) {
        if (grid[r + dirs[i][0]]?.[c + dirs[i][1]] === CELL_TYPES.PATH) {
          neighbors += 1
        }
      }
      if (neighbors === 1) {
        deadEnds += 1
      }
    }
  }
  return deadEnds
}

// ---------------------------------------------------------------------------
// 1. Progressive Dimension & BraidFactor Formula Verification
// ---------------------------------------------------------------------------
console.log('Test 1: Verifying progressive dimensions and braidFactor across target levels')
const expectedProgression = [
  { level: 1, rows: 11, cols: 11, tierNote: 'Easy baseline' },
  { level: 5, rows: 15, cols: 15 },
  { level: 6, rows: 17, cols: 17, tierNote: 'Medium tier' },
  { level: 10, rows: 21, cols: 21 },
  { level: 11, rows: 21, cols: 21 },
  { level: 12, rows: 23, cols: 23, tierNote: 'Hard tier' },
  { level: 15, rows: 25, cols: 25 },
  { level: 20, rows: 29, cols: 29 },
  { level: 25, rows: 31, cols: 31, tierNote: 'Hardcore tier' },
  { level: 26, rows: 33, cols: 33, tierNote: 'Beyond Hardcore' },
  { level: 50, rows: 47, cols: 47 },
  { level: 100, rows: 51, cols: 51, tierNote: 'Safe ceiling reached' },
  { level: 5000, rows: 51, cols: 51, tierNote: 'Ceiling enforced, level unbounded' },
]

let lastBraid = -1
for (const entry of expectedProgression) {
  const cfg = getLevelConfig(entry.level, INITIAL_BASE_SEED)
  assert.equal(cfg.level, entry.level)
  assert.equal(cfg.currentLevel, entry.level)
  assert.equal(cfg.rows, entry.rows, `Level ${entry.level} rows=${entry.rows}`)
  assert.equal(cfg.cols, entry.cols, `Level ${entry.level} cols=${entry.cols}`)
  assert.deepStrictEqual(cfg.dimensions, { rows: entry.rows, cols: entry.cols })
  assert.equal(cfg.rows % 2, 1, `Level ${entry.level} rows must be odd`)
  assert.equal(cfg.cols % 2, 1, `Level ${entry.level} cols must be odd`)
  assert.ok(cfg.rows <= MAX_MAZE_DIMENSION, `Level ${entry.level} stays within safe ceiling`)
  assert.ok(
    cfg.braidFactor >= MIN_BRAID_FACTOR && cfg.braidFactor <= MAX_BRAID_FACTOR,
    `Level ${entry.level} braidFactor=${cfg.braidFactor} in [0, ${MAX_BRAID_FACTOR}]`
  )
  assert.ok(
    cfg.braidFactor > lastBraid,
    `Level ${entry.level} braidFactor (${cfg.braidFactor}) strictly increases over ${lastBraid}`
  )
  lastBraid = cfg.braidFactor
}

// ---------------------------------------------------------------------------
// 2. Generation Determinism, Metadata, Start/Exit & Solvability Across Levels
// ---------------------------------------------------------------------------
console.log('Test 2: Maze generation metadata, determinism & solvability across all required levels')
const requiredLevels = [1, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000]

for (const level of requiredLevels) {
  const seed = getLevelSeed(level, INITIAL_BASE_SEED)
  const expectedDims = calculateMazeDimensionsForLevel(level)
  const expectedBraid = calculateBraidFactorForLevel(level)

  const mazeA = generateMaze({ level, seed })
  const mazeB = generateMaze({ level, seed })

  // Determinism
  assert.deepStrictEqual(mazeA.grid, mazeB.grid, `Level ${level} grid deterministic`)
  assert.deepStrictEqual(mazeA.start, mazeB.start, `Level ${level} start deterministic`)
  assert.deepStrictEqual(mazeA.exit, mazeB.exit, `Level ${level} exit deterministic`)
  assert.deepStrictEqual(mazeA.shortestPath, mazeB.shortestPath, `Level ${level} shortestPath deterministic`)
  assert.equal(mazeA.id, mazeB.id, `Level ${level} id deterministic`)

  // Metadata fidelity
  assert.equal(mazeA.currentLevel, level, `Level ${level} records currentLevel`)
  assert.equal(mazeA.level, level, `Level ${level} records level`)
  assert.equal(mazeA.rows, expectedDims.rows, `Level ${level} records rows`)
  assert.equal(mazeA.cols, expectedDims.cols, `Level ${level} records cols`)
  assert.deepStrictEqual(mazeA.dimensions, expectedDims, `Level ${level} records dimensions object`)
  assert.equal(mazeA.braidFactor, expectedBraid, `Level ${level} records braidFactor`)
  assert.equal(mazeA.seed, seed, `Level ${level} records seed`)
  assert.equal(
    mazeA.id,
    `maze-L${level}-${expectedDims.rows}x${expectedDims.cols}-${seed}`,
    `Level ${level} records maze identifier`
  )

  // Solvability & pathfinding
  const validation = validateMaze(mazeA)
  assert.equal(validation.valid, true, `Level ${level} passes validateMaze`)
  assert.equal(mazeA.validation.valid, true, `Level ${level} embedded validation passes`)
  const bfs = findShortestPath(mazeA.grid, mazeA.start, mazeA.exit)
  assert.equal(bfs.found, true, `Level ${level} pathfinder finds valid path from start to exit`)
  assert.equal(bfs.distance, mazeA.parMoves, `Level ${level} parMoves matches path distance`)
  assert.equal(
    validation.reachableCount,
    validation.totalPathCells,
    `Level ${level} has 100% connected walkable cells`
  )
}

// ---------------------------------------------------------------------------
// 3. Controlled Braiding Reduces Dead-End Ratio at Higher Levels
// ---------------------------------------------------------------------------
console.log('Test 3: Progressive braiding opens dead ends and builds interconnected routes')
{
  const level1Maze = generateMaze({ level: 1, seed: 98765 })
  const zeroBraid51 = generateMaze({ rows: 51, cols: 51, braidFactor: 0, seed: 98765 })
  const level5000Maze = generateMaze({ level: 5000, seed: 98765 })

  assert.equal(level1Maze.braidFactor, 0)
  const deadEndsUnbraided51 = countDeadEnds(zeroBraid51.grid)
  const deadEndsBraided51 = countDeadEnds(level5000Maze.grid)
  assert.ok(
    deadEndsBraided51 < deadEndsUnbraided51 * 0.85,
    `Level 5000 braiding significantly reduces dead ends (${deadEndsBraided51} vs ${deadEndsUnbraided51} unbraided)`
  )
}

// ---------------------------------------------------------------------------
// 4. Configurable Bounds, Ceiling Safety & Reducer Integration
// ---------------------------------------------------------------------------
console.log('Test 4: Configurable dimension ceiling, odd preservation & reducer integration')
{
  assert.equal(DEFAULT_MAZE_PROGRESSION_CONFIG.maxDimension, 51)
  assert.equal(normalizeDimension(4), 5)
  assert.equal(normalizeDimension(12), 13)
  assert.equal(normalizeDimension(50), 51)
  assert.equal(normalizeDimension(52), 51)
  assert.equal(normalizeDimension(500), 51)
  assert.equal(normalizeBraidFactor(-0.5), 0)
  assert.equal(normalizeBraidFactor(2.0, 0, { max: MAX_BRAID_FACTOR }), MAX_BRAID_FACTOR)

  const state1 = createInitialGameState()
  assert.equal(state1.currentLevel, 1)
  assert.equal(state1.maze.rows, 11)
  assert.equal(state1.maze.cols, 11)

  const state6 = gameReducer(state1, { type: 'SET_LEVEL', level: 6 })
  assert.equal(state6.currentLevel, 6)
  assert.equal(state6.maze.rows, 17)
  assert.equal(state6.maze.cols, 17)

  const state5000 = gameReducer(state6, { type: 'SET_LEVEL', level: 5000 })
  assert.equal(state5000.currentLevel, 5000)
  assert.equal(state5000.maze.currentLevel, 5000)
  assert.equal(state5000.maze.rows, 51)
  assert.equal(state5000.maze.cols, 51)
  assert.equal(state5000.maze.validation.valid, true)
}

// ---------------------------------------------------------------------------
// 5. Max Dimension (51x51) Spatial Chunking & 3D Mesh Integrity
// ---------------------------------------------------------------------------
console.log('Test 5: 51x51 ceiling renders cleanly with bounded 6x6 spatial chunks')
{
  disposeAllSharedPools()
  const maxMaze = generateMaze({
    level: 5000,
    seed: getLevelSeed(5000, INITIAL_BASE_SEED),
  })
  const layout = createMazeChunkLayout(maxMaze)
  assert.equal(layout.chunkCols, 6, '51x51 uses bounded 6 chunk columns')
  assert.equal(layout.chunkRows, 6, '51x51 uses bounded 6 chunk rows')
  assert.equal(layout.totalChunks, 36, '51x51 partitions cleanly into 36 chunks')

  const group = buildMazeMeshes(maxMaze, { qualityPreset: 'high' })
  assert.ok(group, 'buildMazeMeshes succeeds at 51x51 max dimension')
  const floorMeshes = getLayerMeshes(group.getObjectByName('maze-floor'))
  assert.equal(floorMeshes.length, 36, 'Floor splits cleanly across all 36 chunks')
  disposeMazeGroup(group)
  disposeAllSharedPools()
}

console.log('✓ All progressive maze dimension & braiding tests passed!')
