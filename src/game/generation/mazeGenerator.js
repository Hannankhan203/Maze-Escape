import { createRng, normalizeSeed, shuffleWithRng } from '../../utils/rng.js'
import { placeCollectibles } from './collectiblePlacement.js'
import { placeKeycards } from './keycardPlacement.js'
import { placeHazards } from './hazardPlacement.js'
import { placeHidingSpots } from './hidingSpotPlacement.js'
import {
  CELL_TYPES,
  MAX_MAZE_DIMENSION,
  MIN_BRAID_FACTOR,
  MIN_MAZE_DIMENSION,
  normalizeBraidFactor,
  normalizeDimension,
} from './mazeConfig.js'
import { exploreReachableCells, validateMaze } from './pathfinder.js'
import { getLevelConfig, normalizeLevel } from '../mechanics/levelProgression.js'

const CARVE_DIRS = [
  { row: -2, col: 0 },
  { row: 2, col: 0 },
  { row: 0, col: -2 },
  { row: 0, col: 2 },
]

const ORTHOGONAL_DIRS = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
]

function createFilledGrid(rows, cols, fillValue) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => fillValue)
  )
}

function countWalkableNeighbors(grid, row, col) {
  let count = 0
  for (let i = 0; i < ORTHOGONAL_DIRS.length; i += 1) {
    const nr = row + ORTHOGONAL_DIRS[i].row
    const nc = col + ORTHOGONAL_DIRS[i].col
    if (grid[nr]?.[nc] === CELL_TYPES.PATH) {
      count += 1
    }
  }
  return count
}

/**
 * Optionally opens a controlled fraction of dead ends into neighboring paths
 * to introduce tactical loops without breaking outer walls.
 */
function applyControlledBraiding(grid, braidFactor, rng) {
  if (!braidFactor || braidFactor <= 0) return

  const rows = grid.length
  const cols = grid[0].length

  for (let r = 1; r < rows - 1; r += 2) {
    for (let c = 1; c < cols - 1; c += 2) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      if (countWalkableNeighbors(grid, r, c) !== 1) continue
      if (rng() > braidFactor) continue

      const candidateWalls = []
      for (let i = 0; i < ORTHOGONAL_DIRS.length; i += 1) {
        const wallR = r + ORTHOGONAL_DIRS[i].row
        const wallC = c + ORTHOGONAL_DIRS[i].col
        const beyondR = r + ORTHOGONAL_DIRS[i].row * 2
        const beyondC = c + ORTHOGONAL_DIRS[i].col * 2

        if (
          beyondR >= 1 &&
          beyondR < rows - 1 &&
          beyondC >= 1 &&
          beyondC < cols - 1 &&
          grid[wallR][wallC] === CELL_TYPES.WALL &&
          grid[beyondR][beyondC] === CELL_TYPES.PATH
        ) {
          candidateWalls.push({ row: wallR, col: wallC })
        }
      }

      if (candidateWalls.length > 0) {
        const chosen = candidateWalls[Math.floor(rng() * candidateWalls.length)]
        grid[chosen.row][chosen.col] = CELL_TYPES.PATH
      }
    }
  }
}

/**
 * Generates a playable, validated procedural maze using Iterative Randomized DFS
 * (Recursive Backtracking). Deterministic whenever a seed is provided.
 */
export function generateMaze(options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {}
  const level = normalizeLevel(safeOptions.level ?? safeOptions.currentLevel ?? 1)
  const levelConfig = getLevelConfig(
    level,
    safeOptions.seed,
    safeOptions.progressionConfig
  )

  let defaultRows = levelConfig.rows
  let defaultCols = levelConfig.cols
  let defaultBraid = levelConfig.braidFactor

  const diff =
    typeof safeOptions.difficulty === 'string'
      ? safeOptions.difficulty.toLowerCase()
      : ''
  if (diff === 'easy' || diff === 'small') {
    defaultRows = 11
    defaultCols = 11
    defaultBraid = 0.0
  } else if (diff === 'medium') {
    defaultRows = 17
    defaultCols = 17
    defaultBraid = 0.08
  } else if (diff === 'hard' || diff === 'large') {
    defaultRows = 23
    defaultCols = 23
    defaultBraid = 0.14
  } else if (diff === 'hardcore') {
    defaultRows = 31
    defaultCols = 31
    defaultBraid = 0.18
  }

  const maxDim = levelConfig.maxDimension ?? MAX_MAZE_DIMENSION
  const rows = normalizeDimension(safeOptions.rows, defaultRows, {
    min: MIN_MAZE_DIMENSION,
    max: maxDim,
  })
  const cols = normalizeDimension(safeOptions.cols, defaultCols, {
    min: MIN_MAZE_DIMENSION,
    max: maxDim,
  })
  const braidFactor = normalizeBraidFactor(
    safeOptions.braidFactor,
    defaultBraid,
    { min: MIN_BRAID_FACTOR, max: 1 }
  )
  const seed = normalizeSeed(safeOptions.seed)
  const rng = createRng(seed)

  const grid = createFilledGrid(rows, cols, CELL_TYPES.WALL)

  const start = { row: 1, col: 1 }
  grid[start.row][start.col] = CELL_TYPES.PATH

  const stack = [start]

  while (stack.length > 0) {
    const current = stack[stack.length - 1]
    const shuffledDirs = shuffleWithRng(CARVE_DIRS, rng)
    let carvedNext = false

    for (let i = 0; i < shuffledDirs.length; i += 1) {
      const nextRow = current.row + shuffledDirs[i].row
      const nextCol = current.col + shuffledDirs[i].col

      if (
        nextRow >= 1 &&
        nextRow < rows - 1 &&
        nextCol >= 1 &&
        nextCol < cols - 1 &&
        grid[nextRow][nextCol] === CELL_TYPES.WALL
      ) {
        const betweenRow = current.row + shuffledDirs[i].row / 2
        const betweenCol = current.col + shuffledDirs[i].col / 2

        grid[betweenRow][betweenCol] = CELL_TYPES.PATH
        grid[nextRow][nextCol] = CELL_TYPES.PATH
        stack.push({ row: nextRow, col: nextCol })
        carvedNext = true
        break
      }
    }

    if (!carvedNext) {
      stack.pop()
    }
  }

  applyControlledBraiding(grid, braidFactor, rng)

  // Choose the farthest reachable walkable cell from start for the exit gate
  const reachInfo = exploreReachableCells(grid, start)
  const exit =
    reachInfo.farthestCell &&
    (reachInfo.farthestCell.row !== start.row ||
      reachInfo.farthestCell.col !== start.col)
      ? reachInfo.farthestCell
      : { row: rows - 2, col: cols - 2 }

  const validation = validateMaze({ grid, start, exit })

  const baseMaze = {
    id: `maze-L${level}-${rows}x${cols}-${seed}`,
    seed,
    level,
    currentLevel: level,
    rows,
    cols,
    dimensions: { rows, cols },
    braidFactor,
    grid,
    start,
    exit,
    shortestPath: validation.shortestPath,
    parMoves: validation.distance,
    validation: {
      valid: validation.valid,
      reachableCount: validation.reachableCount,
      totalPathCells: validation.totalPathCells,
      issues: validation.issues,
    },
  }

  const hazards = placeHazards(baseMaze)
  const keycards = placeKeycards({ ...baseMaze, hazards })
  const collectibles = placeCollectibles(baseMaze, { hazards, keycards })
  const hidingSpots = placeHidingSpots(baseMaze, {
    hazards,
    keycards,
    collectibles,
  })

  return {
    ...baseMaze,
    hazards,
    keycards,
    collectibles,
    hidingSpots,
  }
}
