import { CELL_TYPES } from '../generation/mazeConfig.js'

export const MOVE_DELTAS = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
}

export function isWithinBounds(grid, row, col) {
  return (
    Array.isArray(grid) &&
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < grid.length &&
    Array.isArray(grid[row]) &&
    col >= 0 &&
    col < grid[row].length
  )
}

export function canMoveTo(grid, row, col) {
  if (!Array.isArray(grid) || grid.length === 0) {
    return { allowed: false, reason: 'invalid' }
  }

  if (!isWithinBounds(grid, row, col)) {
    return { allowed: false, reason: 'boundary' }
  }

  if (grid[row][col] !== CELL_TYPES.PATH) {
    return { allowed: false, reason: 'wall' }
  }

  return { allowed: true, reason: null }
}

export function isAtExit(maze, position) {
  if (!maze?.exit || !position) return false
  return position.row === maze.exit.row && position.col === maze.exit.col
}

/**
 * Attempts to move the player one tile in the requested cardinal direction.
 * Pure function returning the validation outcome without mutating state.
 */
export function attemptMove(maze, position, direction) {
  const delta = MOVE_DELTAS[direction]
  if (!delta || !maze?.grid || !position) {
    return {
      moved: false,
      blocked: true,
      reason: 'invalid',
      direction: direction || null,
      position,
      reachedExit: false,
    }
  }

  const nextPosition = {
    row: position.row + delta.row,
    col: position.col + delta.col,
  }

  const check = canMoveTo(maze.grid, nextPosition.row, nextPosition.col)
  if (!check.allowed) {
    return {
      moved: false,
      blocked: true,
      reason: check.reason,
      direction,
      position,
      reachedExit: false,
    }
  }

  return {
    moved: true,
    blocked: false,
    reason: null,
    direction,
    position: nextPosition,
    reachedExit: isAtExit(maze, nextPosition),
  }
}
