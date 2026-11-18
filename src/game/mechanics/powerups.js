import { CELL_TYPES } from '../generation/mazeConfig.js'
import { isWithinBounds } from './movement.js'

export const POWERUP_TYPES = {
  WALL_PASS: 'wall_pass',
  ECHO_REVEAL: 'echo_reveal',
  COIN_MAGNET: 'coin_magnet',
}

export const POWERUP_CONFIG = {
  [POWERUP_TYPES.WALL_PASS]: {
    type: POWERUP_TYPES.WALL_PASS,
    label: 'Wall Pass',
    shortLabel: 'Phase',
    shortcut: 'Space',
    description: 'Cross one interior wall on your next blocked move.',
    durationMs: 0,
  },
  [POWERUP_TYPES.ECHO_REVEAL]: {
    type: POWERUP_TYPES.ECHO_REVEAL,
    label: 'Echo Reveal',
    shortLabel: 'Echo',
    shortcut: 'E',
    description: 'Reveals the BFS shortest route to the exit gate.',
    durationMs: 4500,
  },
  [POWERUP_TYPES.COIN_MAGNET]: {
    type: POWERUP_TYPES.COIN_MAGNET,
    label: 'Coin Magnet',
    shortLabel: 'Magnet',
    shortcut: 'Q',
    description: 'Pulls nearby unobstructed coins within 2 tiles.',
    durationMs: 6000,
    radius: 2,
  },
}

export const MAGNET_RADIUS = POWERUP_CONFIG[POWERUP_TYPES.COIN_MAGNET].radius

export function createInitialInventory() {
  return {
    [POWERUP_TYPES.WALL_PASS]: 0,
    [POWERUP_TYPES.ECHO_REVEAL]: 0,
    [POWERUP_TYPES.COIN_MAGNET]: 0,
  }
}

export function createInitialActiveEffects() {
  return {
    wallPassArmed: false,
    echoRevealRemainingMs: 0,
    magnetRemainingMs: 0,
  }
}

const ORTHOGONAL_DIRS = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
]

/**
 * Finds coins reachable within `radius` unobstructed walkable steps from `origin`.
 * Uses BFS over PATH cells only so solid walls always block magnet range.
 */
export function findMagnetizableCoins(grid, origin, coins, radius = MAGNET_RADIUS) {
  if (
    !Array.isArray(grid) ||
    !origin ||
    !Array.isArray(coins) ||
    coins.length === 0 ||
    radius <= 0
  ) {
    return []
  }

  if (
    !isWithinBounds(grid, origin.row, origin.col) ||
    grid[origin.row][origin.col] !== CELL_TYPES.PATH
  ) {
    return []
  }

  const coinByKey = new Map()
  for (let i = 0; i < coins.length; i += 1) {
    coinByKey.set(`${coins[i].row},${coins[i].col}`, coins[i])
  }

  const startKey = `${origin.row},${origin.col}`
  const visited = new Set([startKey])
  const queue = [{ row: origin.row, col: origin.col, dist: 0 }]
  let head = 0
  const matched = []

  if (coinByKey.has(startKey)) {
    matched.push(coinByKey.get(startKey))
  }

  while (head < queue.length) {
    const current = queue[head]
    head += 1

    if (current.dist >= radius) continue

    for (let i = 0; i < ORTHOGONAL_DIRS.length; i += 1) {
      const nextRow = current.row + ORTHOGONAL_DIRS[i].row
      const nextCol = current.col + ORTHOGONAL_DIRS[i].col

      if (!isWithinBounds(grid, nextRow, nextCol)) continue
      if (grid[nextRow][nextCol] !== CELL_TYPES.PATH) continue

      const nextKey = `${nextRow},${nextCol}`
      if (visited.has(nextKey)) continue

      visited.add(nextKey)
      if (coinByKey.has(nextKey)) {
        matched.push(coinByKey.get(nextKey))
      }

      queue.push({ row: nextRow, col: nextCol, dist: current.dist + 1 })
    }
  }

  return matched
}

/**
 * Checks whether a single-use Wall Pass can cross an interior wall tile
 * at (wallRow, wallCol) along `delta` and land on a walkable tile beyond it.
 * Outer boundary walls and multi-wall blocks are always rejected.
 */
export function resolveWallPassStep(grid, wallRow, wallCol, delta) {
  if (!Array.isArray(grid) || grid.length < 3 || !delta) {
    return { allowed: false, reason: 'invalid', landing: null }
  }

  const rows = grid.length
  const cols = grid[0]?.length || 0

  // Never allow crossing the outer maze perimeter
  const isOuterBoundary =
    wallRow <= 0 ||
    wallRow >= rows - 1 ||
    wallCol <= 0 ||
    wallCol >= cols - 1

  if (isOuterBoundary) {
    return { allowed: false, reason: 'boundary', landing: null }
  }

  const beyondRow = wallRow + delta.row
  const beyondCol = wallCol + delta.col

  if (!isWithinBounds(grid, beyondRow, beyondCol)) {
    return { allowed: false, reason: 'boundary', landing: null }
  }

  if (grid[beyondRow][beyondCol] !== CELL_TYPES.PATH) {
    return { allowed: false, reason: 'wall', landing: null }
  }

  return {
    allowed: true,
    reason: null,
    wallTile: { row: wallRow, col: wallCol },
    landing: { row: beyondRow, col: beyondCol },
  }
}
