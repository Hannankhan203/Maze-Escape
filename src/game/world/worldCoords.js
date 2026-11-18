/**
 * Foundational 3D world-space coordinate system for Maze Escape.
 *
 * Uses `maze.grid` (rows × cols) as the single source of truth and centers
 * the entire labyrinth around world origin (0, 0) on the X/Z ground plane:
 *   - +X runs left-to-right across columns (0 → cols - 1)
 *   - +Z runs top-to-bottom across rows (0 → rows - 1)
 *   - +Y is vertical elevation (floor at y = 0, walls rise to WALL_HEIGHT)
 */

export const CELL_SIZE = 4
export const WALL_HEIGHT = 3
export const PLAYER_RADIUS = 0.75

function normalizeZero(value) {
  return value === 0 ? 0 : value
}

function getGridDimensions(maze) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return null
  }

  const firstRow = grid[0]
  if (!Array.isArray(firstRow) || firstRow.length === 0) {
    return null
  }

  const rows = grid.length
  const cols = firstRow.length

  for (let r = 0; r < rows; r += 1) {
    if (!Array.isArray(grid[r]) || grid[r].length !== cols) {
      return null
    }
  }

  return { rows, cols }
}

/**
 * Validates whether (row, col) is an integer coordinate inside `maze.grid`.
 */
export function isValidGridPosition(row, col, maze) {
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return false
  }

  const dims = getGridDimensions(maze)
  if (!dims) {
    return false
  }

  return row >= 0 && row < dims.rows && col >= 0 && col < dims.cols
}

/**
 * Converts grid coordinates (row, col) into centered world-space { x, z }
 * coordinates for the center of that cell, with the maze centered at (0, 0).
 * Returns null if the maze or grid coordinates are invalid.
 */
export function gridToWorld(row, col, maze) {
  if (!isValidGridPosition(row, col, maze)) {
    return null
  }

  const { rows, cols } = getGridDimensions(maze)
  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2

  return {
    x: normalizeZero(originX + (col + 0.5) * CELL_SIZE),
    z: normalizeZero(originZ + (row + 0.5) * CELL_SIZE),
  }
}

/**
 * Converts world-space (x, z) coordinates back into grid { row, col }.
 * Returns null if inputs are non-finite, maze is malformed, or the point lies
 * outside the maze boundaries.
 */
export function worldToGrid(x, z, maze) {
  if (
    typeof x !== 'number' ||
    typeof z !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(z)
  ) {
    return null
  }

  const dims = getGridDimensions(maze)
  if (!dims) {
    return null
  }

  const originX = -(dims.cols * CELL_SIZE) / 2
  const originZ = -(dims.rows * CELL_SIZE) / 2

  const col = Math.floor((x - originX) / CELL_SIZE)
  const row = Math.floor((z - originZ) / CELL_SIZE)

  if (!isValidGridPosition(row, col, maze)) {
    return null
  }

  return { row, col }
}

/**
 * Returns the world-space X/Z boundaries and center for grid cell (row, col).
 * Returns null if the maze or grid coordinates are invalid.
 */
export function getCellBounds(row, col, maze) {
  if (!isValidGridPosition(row, col, maze)) {
    return null
  }

  const { rows, cols } = getGridDimensions(maze)
  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2

  const minX = normalizeZero(originX + col * CELL_SIZE)
  const maxX = normalizeZero(minX + CELL_SIZE)
  const minZ = normalizeZero(originZ + row * CELL_SIZE)
  const maxZ = normalizeZero(minZ + CELL_SIZE)
  const centerX = normalizeZero(minX + CELL_SIZE / 2)
  const centerZ = normalizeZero(minZ + CELL_SIZE / 2)

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX,
    centerZ,
  }
}
