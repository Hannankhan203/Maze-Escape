import { CELL_TYPES } from './mazeConfig.js'

const DIRECTIONS = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
]

function isValidCoord(coord, rows, cols) {
  return (
    Boolean(coord) &&
    Number.isInteger(coord.row) &&
    Number.isInteger(coord.col) &&
    coord.row >= 0 &&
    coord.row < rows &&
    coord.col >= 0 &&
    coord.col < cols
  )
}

function isValidGrid(grid) {
  if (!Array.isArray(grid) || grid.length < 3) {
    return { valid: false, reason: 'Grid must be a non-empty 2D array.' }
  }

  const colCount = Array.isArray(grid[0]) ? grid[0].length : 0
  if (colCount < 3) {
    return { valid: false, reason: 'Grid rows must contain at least 3 cells.' }
  }

  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r]
    if (!Array.isArray(row) || row.length !== colCount) {
      return { valid: false, reason: 'Grid must be rectangular.' }
    }
    for (let c = 0; c < colCount; c += 1) {
      const cell = row[c]
      if (cell !== CELL_TYPES.PATH && cell !== CELL_TYPES.WALL) {
        return {
          valid: false,
          reason: `Invalid cell value at (${r}, ${c}).`,
        }
      }
    }
  }

  return { valid: true, rows: grid.length, cols: colCount }
}

function toKey(row, col) {
  return `${row},${col}`
}

/**
 * Finds the shortest walkable path between start and exit using BFS.
 * Handles malformed grids or coordinates safely without throwing.
 */
export function findShortestPath(grid, start, exit) {
  const gridCheck = isValidGrid(grid)
  if (!gridCheck.valid) {
    return {
      found: false,
      path: [],
      distance: -1,
      visitedCount: 0,
      error: gridCheck.reason,
    }
  }

  const { rows, cols } = gridCheck

  if (!isValidCoord(start, rows, cols) || !isValidCoord(exit, rows, cols)) {
    return {
      found: false,
      path: [],
      distance: -1,
      visitedCount: 0,
      error: 'Start or exit coordinate is out of bounds.',
    }
  }

  if (grid[start.row][start.col] !== CELL_TYPES.PATH) {
    return {
      found: false,
      path: [],
      distance: -1,
      visitedCount: 0,
      error: 'Start coordinate is blocked by a wall.',
    }
  }

  if (grid[exit.row][exit.col] !== CELL_TYPES.PATH) {
    return {
      found: false,
      path: [],
      distance: -1,
      visitedCount: 0,
      error: 'Exit coordinate is blocked by a wall.',
    }
  }

  const queue = [{ row: start.row, col: start.col }]
  let head = 0

  const visited = new Set([toKey(start.row, start.col)])
  const parents = new Map()

  while (head < queue.length) {
    const current = queue[head]
    head += 1

    if (current.row === exit.row && current.col === exit.col) {
      const path = []
      let traceKey = toKey(exit.row, exit.col)
      let cursor = { row: exit.row, col: exit.col }

      while (cursor) {
        path.push(cursor)
        cursor = parents.get(traceKey) || null
        if (cursor) {
          traceKey = toKey(cursor.row, cursor.col)
        }
      }

      path.reverse()

      return {
        found: true,
        path,
        distance: path.length - 1,
        visitedCount: visited.size,
        error: null,
      }
    }

    for (let i = 0; i < DIRECTIONS.length; i += 1) {
      const nextRow = current.row + DIRECTIONS[i].row
      const nextCol = current.col + DIRECTIONS[i].col

      if (
        nextRow < 0 ||
        nextRow >= rows ||
        nextCol < 0 ||
        nextCol >= cols ||
        grid[nextRow][nextCol] !== CELL_TYPES.PATH
      ) {
        continue
      }

      const nextKey = toKey(nextRow, nextCol)
      if (!visited.has(nextKey)) {
        visited.add(nextKey)
        parents.set(nextKey, current)
        queue.push({ row: nextRow, col: nextCol })
      }
    }
  }

  return {
    found: false,
    path: [],
    distance: -1,
    visitedCount: visited.size,
    error: 'No valid path exists from start to exit.',
  }
}

/**
 * Explores all walkable cells reachable from start via BFS.
 * Useful for verifying connectivity and locating farthest candidate cells.
 */
export function exploreReachableCells(grid, start) {
  const gridCheck = isValidGrid(grid)
  if (!gridCheck.valid) {
    return {
      valid: false,
      reachableCount: 0,
      totalPathCells: 0,
      distances: new Map(),
      farthestCell: null,
      maxDistance: -1,
      error: gridCheck.reason,
    }
  }

  const { rows, cols } = gridCheck
  if (
    !isValidCoord(start, rows, cols) ||
    grid[start.row][start.col] !== CELL_TYPES.PATH
  ) {
    return {
      valid: false,
      reachableCount: 0,
      totalPathCells: 0,
      distances: new Map(),
      farthestCell: null,
      maxDistance: -1,
      error: 'Start coordinate is invalid or not walkable.',
    }
  }

  let totalPathCells = 0
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] === CELL_TYPES.PATH) {
        totalPathCells += 1
      }
    }
  }

  const startKey = toKey(start.row, start.col)
  const distances = new Map([[startKey, 0]])
  const queue = [{ row: start.row, col: start.col }]
  let head = 0

  let farthestCell = { row: start.row, col: start.col }
  let maxDistance = 0

  while (head < queue.length) {
    const current = queue[head]
    head += 1
    const currentDist = distances.get(toKey(current.row, current.col))

    if (currentDist > maxDistance) {
      maxDistance = currentDist
      farthestCell = { row: current.row, col: current.col }
    }

    for (let i = 0; i < DIRECTIONS.length; i += 1) {
      const nextRow = current.row + DIRECTIONS[i].row
      const nextCol = current.col + DIRECTIONS[i].col

      if (
        nextRow < 0 ||
        nextRow >= rows ||
        nextCol < 0 ||
        nextCol >= cols ||
        grid[nextRow][nextCol] !== CELL_TYPES.PATH
      ) {
        continue
      }

      const nextKey = toKey(nextRow, nextCol)
      if (!distances.has(nextKey)) {
        distances.set(nextKey, currentDist + 1)
        queue.push({ row: nextRow, col: nextCol })
      }
    }
  }

  return {
    valid: true,
    reachableCount: distances.size,
    totalPathCells,
    distances,
    farthestCell,
    maxDistance,
    error: null,
  }
}

/**
 * Validates a generated or provided maze object for structural integrity,
 * start-to-exit reachability, and absence of isolated walkable pockets.
 */
export function validateMaze(maze) {
  if (!maze || typeof maze !== 'object') {
    return {
      valid: false,
      issues: ['Maze payload is missing or malformed.'],
      shortestPath: [],
      distance: -1,
      reachableCount: 0,
      totalPathCells: 0,
    }
  }

  const { grid, start, exit } = maze
  const issues = []

  const gridCheck = isValidGrid(grid)
  if (!gridCheck.valid) {
    return {
      valid: false,
      issues: [gridCheck.reason],
      shortestPath: [],
      distance: -1,
      reachableCount: 0,
      totalPathCells: 0,
    }
  }

  if (
    start &&
    exit &&
    start.row === exit.row &&
    start.col === exit.col
  ) {
    issues.push('Start and exit positions must be distinct.')
  }

  const pathResult = findShortestPath(grid, start, exit)
  if (!pathResult.found) {
    issues.push(pathResult.error || 'Exit is unreachable from start.')
  }

  const reachResult = exploreReachableCells(grid, start)
  if (!reachResult.valid) {
    issues.push(reachResult.error || 'Unable to explore maze connectivity.')
  } else if (reachResult.reachableCount !== reachResult.totalPathCells) {
    issues.push(
      `Detected ${reachResult.totalPathCells - reachResult.reachableCount} isolated walkable cells.`
    )
  }

  return {
    valid: issues.length === 0,
    issues,
    shortestPath: pathResult.path,
    distance: pathResult.distance,
    reachableCount: reachResult.reachableCount,
    totalPathCells: reachResult.totalPathCells,
  }
}
