import { CELL_TYPES } from './mazeConfig.js'

const MAX_BFS_GENERATION = 0xfffffff0

let bfsCapacity = 0
let bfsVisitedStamp = new Uint32Array(0)
let bfsParentIdx = new Int32Array(0)
let bfsQueueIdx = new Int32Array(0)
let bfsDistanceIdx = new Int32Array(0)
let bfsGeneration = 0

let validatedGridCache = new WeakMap()

/**
 * Resets reusable pathfinder scratch buffers and validation cache.
 */
export function resetPathfinderState() {
  bfsCapacity = 0
  bfsVisitedStamp = new Uint32Array(0)
  bfsParentIdx = new Int32Array(0)
  bfsQueueIdx = new Int32Array(0)
  bfsDistanceIdx = new Int32Array(0)
  bfsGeneration = 0
  validatedGridCache = new WeakMap()
}

function nextBfsStamp(requiredCells) {
  if (requiredCells > bfsCapacity) {
    bfsCapacity = requiredCells
    bfsVisitedStamp = new Uint32Array(bfsCapacity)
    bfsParentIdx = new Int32Array(bfsCapacity)
    bfsQueueIdx = new Int32Array(bfsCapacity)
    bfsDistanceIdx = new Int32Array(bfsCapacity)
    bfsGeneration = 1
    return bfsGeneration
  }

  if (bfsGeneration >= MAX_BFS_GENERATION) {
    bfsVisitedStamp.fill(0)
    bfsGeneration = 1
    return bfsGeneration
  }

  bfsGeneration += 1
  return bfsGeneration
}

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

  const rowCount = grid.length
  const colCount = Array.isArray(grid[0]) ? grid[0].length : 0
  if (colCount < 3) {
    return { valid: false, reason: 'Grid rows must contain at least 3 cells.' }
  }

  const cached = validatedGridCache.get(grid)
  if (cached && cached.rows === rowCount && cached.cols === colCount) {
    let shapeIntact = true
    for (let r = 1; r < rowCount; r += 1) {
      const row = grid[r]
      if (!Array.isArray(row) || row.length !== colCount) {
        shapeIntact = false
        break
      }
    }
    if (shapeIntact) {
      return cached
    }
  }

  for (let r = 0; r < rowCount; r += 1) {
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

  const result = { valid: true, rows: rowCount, cols: colCount }
  validatedGridCache.set(grid, result)
  return result
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

  const startIdx = start.row * cols + start.col
  const exitIdx = exit.row * cols + exit.col

  if (startIdx === exitIdx) {
    return {
      found: true,
      path: [{ row: start.row, col: start.col }],
      distance: 0,
      visitedCount: 1,
      error: null,
    }
  }

  const stamp = nextBfsStamp(rows * cols)
  bfsVisitedStamp[startIdx] = stamp
  bfsParentIdx[startIdx] = -1
  bfsQueueIdx[0] = startIdx

  let head = 0
  let tail = 1
  let visitedCount = 1

  while (head < tail) {
    const currentIdx = bfsQueueIdx[head]
    head += 1

    if (currentIdx === exitIdx) {
      let pathLen = 0
      let trace = exitIdx
      while (trace !== -1) {
        pathLen += 1
        trace = bfsParentIdx[trace]
      }

      const path = new Array(pathLen)
      trace = exitIdx
      for (let p = pathLen - 1; p >= 0; p -= 1) {
        const r = (trace / cols) | 0
        const c = trace - r * cols
        path[p] = { row: r, col: c }
        trace = bfsParentIdx[trace]
      }

      return {
        found: true,
        path,
        distance: pathLen - 1,
        visitedCount,
        error: null,
      }
    }

    const curRow = (currentIdx / cols) | 0
    const curCol = currentIdx - curRow * cols

    // Preserve exact DIRECTIONS traversal order: up (-1,0), down (+1,0), left (0,-1), right (0,+1)
    if (curRow > 0 && grid[curRow - 1][curCol] === CELL_TYPES.PATH) {
      const nextIdx = currentIdx - cols
      if (bfsVisitedStamp[nextIdx] !== stamp) {
        bfsVisitedStamp[nextIdx] = stamp
        bfsParentIdx[nextIdx] = currentIdx
        bfsQueueIdx[tail] = nextIdx
        tail += 1
        visitedCount += 1
      }
    }

    if (curRow + 1 < rows && grid[curRow + 1][curCol] === CELL_TYPES.PATH) {
      const nextIdx = currentIdx + cols
      if (bfsVisitedStamp[nextIdx] !== stamp) {
        bfsVisitedStamp[nextIdx] = stamp
        bfsParentIdx[nextIdx] = currentIdx
        bfsQueueIdx[tail] = nextIdx
        tail += 1
        visitedCount += 1
      }
    }

    if (curCol > 0 && grid[curRow][curCol - 1] === CELL_TYPES.PATH) {
      const nextIdx = currentIdx - 1
      if (bfsVisitedStamp[nextIdx] !== stamp) {
        bfsVisitedStamp[nextIdx] = stamp
        bfsParentIdx[nextIdx] = currentIdx
        bfsQueueIdx[tail] = nextIdx
        tail += 1
        visitedCount += 1
      }
    }

    if (curCol + 1 < cols && grid[curRow][curCol + 1] === CELL_TYPES.PATH) {
      const nextIdx = currentIdx + 1
      if (bfsVisitedStamp[nextIdx] !== stamp) {
        bfsVisitedStamp[nextIdx] = stamp
        bfsParentIdx[nextIdx] = currentIdx
        bfsQueueIdx[tail] = nextIdx
        tail += 1
        visitedCount += 1
      }
    }
  }

  return {
    found: false,
    path: [],
    distance: -1,
    visitedCount,
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
    const row = grid[r]
    for (let c = 0; c < cols; c += 1) {
      if (row[c] === CELL_TYPES.PATH) {
        totalPathCells += 1
      }
    }
  }

  const stamp = nextBfsStamp(rows * cols)
  const startIdx = start.row * cols + start.col
  bfsVisitedStamp[startIdx] = stamp
  bfsDistanceIdx[startIdx] = 0
  bfsQueueIdx[0] = startIdx

  let head = 0
  let tail = 1
  const distances = new Map([[toKey(start.row, start.col), 0]])

  let farthestRow = start.row
  let farthestCol = start.col
  let maxDistance = 0

  while (head < tail) {
    const currentIdx = bfsQueueIdx[head]
    head += 1
    const currentDist = bfsDistanceIdx[currentIdx]
    const curRow = (currentIdx / cols) | 0
    const curCol = currentIdx - curRow * cols

    if (currentDist > maxDistance) {
      maxDistance = currentDist
      farthestRow = curRow
      farthestCol = curCol
    }

    const nextDist = currentDist + 1

    if (curRow > 0 && grid[curRow - 1][curCol] === CELL_TYPES.PATH) {
      const nextIdx = currentIdx - cols
      if (bfsVisitedStamp[nextIdx] !== stamp) {
        bfsVisitedStamp[nextIdx] = stamp
        bfsDistanceIdx[nextIdx] = nextDist
        bfsQueueIdx[tail] = nextIdx
        tail += 1
        distances.set(toKey(curRow - 1, curCol), nextDist)
      }
    }

    if (curRow + 1 < rows && grid[curRow + 1][curCol] === CELL_TYPES.PATH) {
      const nextIdx = currentIdx + cols
      if (bfsVisitedStamp[nextIdx] !== stamp) {
        bfsVisitedStamp[nextIdx] = stamp
        bfsDistanceIdx[nextIdx] = nextDist
        bfsQueueIdx[tail] = nextIdx
        tail += 1
        distances.set(toKey(curRow + 1, curCol), nextDist)
      }
    }

    if (curCol > 0 && grid[curRow][curCol - 1] === CELL_TYPES.PATH) {
      const nextIdx = currentIdx - 1
      if (bfsVisitedStamp[nextIdx] !== stamp) {
        bfsVisitedStamp[nextIdx] = stamp
        bfsDistanceIdx[nextIdx] = nextDist
        bfsQueueIdx[tail] = nextIdx
        tail += 1
        distances.set(toKey(curRow, curCol - 1), nextDist)
      }
    }

    if (curCol + 1 < cols && grid[curRow][curCol + 1] === CELL_TYPES.PATH) {
      const nextIdx = currentIdx + 1
      if (bfsVisitedStamp[nextIdx] !== stamp) {
        bfsVisitedStamp[nextIdx] = stamp
        bfsDistanceIdx[nextIdx] = nextDist
        bfsQueueIdx[tail] = nextIdx
        tail += 1
        distances.set(toKey(curRow, curCol + 1), nextDist)
      }
    }
  }

  return {
    valid: true,
    reachableCount: distances.size,
    totalPathCells,
    distances,
    farthestCell: { row: farthestRow, col: farthestCol },
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
