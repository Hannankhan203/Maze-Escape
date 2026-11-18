import { CELL_TYPES } from '../generation/mazeConfig.js'
import { resolveWallPassStep } from './powerups.js'

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
 * Attempts to move the player in the requested cardinal direction.
 * When `wallPassArmed` is true and the adjacent cell is a single interior wall
 * with a walkable corridor directly beyond it, crosses that single wall tile
 * and reports `usedWallPass: true`. Outer boundaries are never passable.
 */
export function attemptMove(maze, position, direction, options = {}) {
  const { wallPassArmed = false } = options
  const delta = MOVE_DELTAS[direction]

  if (!delta || !maze?.grid || !position) {
    return {
      moved: false,
      blocked: true,
      reason: 'invalid',
      direction: direction || null,
      position,
      reachedExit: false,
      usedWallPass: false,
      passedWall: null,
    }
  }

  const nextRow = position.row + delta.row
  const nextCol = position.col + delta.col
  const check = canMoveTo(maze.grid, nextRow, nextCol)

  if (check.allowed) {
    const nextPosition = { row: nextRow, col: nextCol }
    return {
      moved: true,
      blocked: false,
      reason: null,
      direction,
      position: nextPosition,
      reachedExit: isAtExit(maze, nextPosition),
      usedWallPass: false,
      passedWall: null,
    }
  }

  if (check.reason === 'wall' && wallPassArmed) {
    const wallPass = resolveWallPassStep(maze.grid, nextRow, nextCol, delta)
    if (wallPass.allowed && wallPass.landing) {
      return {
        moved: true,
        blocked: false,
        reason: null,
        direction,
        position: wallPass.landing,
        reachedExit: isAtExit(maze, wallPass.landing),
        usedWallPass: true,
        passedWall: wallPass.wallTile,
      }
    }

    return {
      moved: false,
      blocked: true,
      reason: wallPass.reason || 'wall',
      direction,
      position,
      reachedExit: false,
      usedWallPass: false,
      passedWall: null,
    }
  }

  return {
    moved: false,
    blocked: true,
    reason: check.reason,
    direction,
    position,
    reachedExit: false,
    usedWallPass: false,
    passedWall: null,
  }
}
