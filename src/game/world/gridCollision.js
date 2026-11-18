import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  PLAYER_RADIUS,
  getCellBounds,
  isValidGridPosition,
} from './worldCoords.js'

const DEFAULT_COLLISION_PASSES = 2
const EPSILON = 1e-6

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getGridShape(maze) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return null
  }
  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) {
    return null
  }
  return { grid, rows, cols }
}

/**
 * Returns true when `(row, col)` is inside `maze.grid` and marked as a
 * walkable `CELL_TYPES.PATH` tile.
 */
export function isCellWalkable(row, col, maze) {
  if (!isValidGridPosition(row, col, maze)) {
    return false
  }
  return maze.grid[row][col] === CELL_TYPES.PATH
}

/**
 * Computes world-space outer X/Z boundaries for a circular collider of `radius`
 * moving inside `maze.grid`.
 */
export function getMazeWorldBounds(maze, radius = PLAYER_RADIUS) {
  const shape = getGridShape(maze)
  if (!shape) {
    return null
  }

  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : PLAYER_RADIUS
  const totalWidth = shape.cols * CELL_SIZE
  const totalDepth = shape.rows * CELL_SIZE
  const originX = -totalWidth / 2
  const originZ = -totalDepth / 2

  const minX = originX + safeRadius
  const maxX = Math.max(minX, originX + totalWidth - safeRadius)
  const minZ = originZ + safeRadius
  const maxZ = Math.max(minZ, originZ + totalDepth - safeRadius)

  return {
    originX,
    originZ,
    minX,
    maxX,
    minZ,
    maxZ,
    rows: shape.rows,
    cols: shape.cols,
  }
}

/**
 * Computes squared distance from `(x, z)` to an axis-aligned cell box.
 */
function distanceSqToBox(x, z, bounds) {
  const nearestX = clamp(x, bounds.minX, bounds.maxX)
  const nearestZ = clamp(z, bounds.minZ, bounds.maxZ)
  const dx = x - nearestX
  const dz = z - nearestZ
  return dx * dx + dz * dz
}

/**
 * Separates a circle `(x, z, radius)` from a solid cell AABB if overlapping.
 * Returns `{ x, z, hit, normalX, normalZ }`.
 */
function resolveCircleBox(x, z, radius, bounds) {
  const nearestX = clamp(x, bounds.minX, bounds.maxX)
  const nearestZ = clamp(z, bounds.minZ, bounds.maxZ)
  const dx = x - nearestX
  const dz = z - nearestZ
  const distSq = dx * dx + dz * dz

  if (distSq >= radius * radius - EPSILON) {
    return { x, z, hit: false, normalX: 0, normalZ: 0 }
  }

  if (distSq > EPSILON) {
    const dist = Math.sqrt(distSq)
    const overlap = radius - dist
    const nx = dx / dist
    const nz = dz / dist
    return {
      x: x + nx * overlap,
      z: z + nz * overlap,
      hit: true,
      normalX: nx,
      normalZ: nz,
    }
  }

  // Fallback when circle center sits inside the wall box: eject via nearest face
  const distLeft = Math.abs(x - bounds.minX)
  const distRight = Math.abs(bounds.maxX - x)
  const distTop = Math.abs(z - bounds.minZ)
  const distBottom = Math.abs(bounds.maxZ - z)
  const minFace = Math.min(distLeft, distRight, distTop, distBottom)

  if (minFace === distLeft) {
    return { x: bounds.minX - radius, z, hit: true, normalX: -1, normalZ: 0 }
  }
  if (minFace === distRight) {
    return { x: bounds.maxX + radius, z, hit: true, normalX: 1, normalZ: 0 }
  }
  if (minFace === distTop) {
    return { x, z: bounds.minZ - radius, hit: true, normalX: 0, normalZ: -1 }
  }
  return { x, z: bounds.maxZ + radius, hit: true, normalX: 0, normalZ: 1 }
}

/**
 * Resolves circular player collision against `maze.grid` walls and outer maze
 * boundaries in world X/Z space. Candidate wall tiles are sorted by proximity
 * so sliding along multi-tile corridor walls never snags on cell seams.
 */
export function resolveGridCollision(x, z, maze, options = {}) {
  const bounds = getMazeWorldBounds(maze, options?.radius)
  if (!bounds || !Number.isFinite(x) || !Number.isFinite(z)) {
    return {
      x: Number.isFinite(x) ? x : 0,
      z: Number.isFinite(z) ? z : 0,
      collided: false,
      hitBoundary: false,
      hitX: false,
      hitZ: false,
      blockingCells: [],
    }
  }

  const radius = Number.isFinite(options?.radius)
    ? Math.max(0, options.radius)
    : PLAYER_RADIUS
  const passes =
    Number.isInteger(options?.passes) && options.passes > 0
      ? options.passes
      : DEFAULT_COLLISION_PASSES

  let curX = clamp(x, bounds.minX, bounds.maxX)
  let curZ = clamp(z, bounds.minZ, bounds.maxZ)
  let hitBoundary = curX !== x || curZ !== z
  let hitX = curX !== x
  let hitZ = curZ !== z

  const blockingCells = []
  const seenBlockingKeys = new Set()

  for (let pass = 0; pass < passes; pass += 1) {
    const minCol = clamp(
      Math.floor((curX - radius - bounds.originX) / CELL_SIZE),
      0,
      bounds.cols - 1
    )
    const maxCol = clamp(
      Math.floor((curX + radius - bounds.originX) / CELL_SIZE),
      0,
      bounds.cols - 1
    )
    const minRow = clamp(
      Math.floor((curZ - radius - bounds.originZ) / CELL_SIZE),
      0,
      bounds.rows - 1
    )
    const maxRow = clamp(
      Math.floor((curZ + radius - bounds.originZ) / CELL_SIZE),
      0,
      bounds.rows - 1
    )

    const candidates = []
    for (let r = minRow; r <= maxRow; r += 1) {
      for (let c = minCol; c <= maxCol; c += 1) {
        if (maze.grid[r][c] !== CELL_TYPES.PATH) {
          const cellBounds = getCellBounds(r, c, maze)
          if (cellBounds) {
            candidates.push({
              row: r,
              col: c,
              bounds: cellBounds,
              distSq: distanceSqToBox(curX, curZ, cellBounds),
            })
          }
        }
      }
    }

    if (candidates.length === 0) {
      break
    }

    // Nearest wall face first prevents corner seam catching along straight corridors
    candidates.sort((a, b) => a.distSq - b.distSq)

    let passAdjusted = false
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i]
      const res = resolveCircleBox(curX, curZ, radius, candidate.bounds)
      if (res.hit) {
        curX = res.x
        curZ = res.z
        passAdjusted = true
        if (Math.abs(res.normalX) > 0.1) hitX = true
        if (Math.abs(res.normalZ) > 0.1) hitZ = true

        const key = `${candidate.row},${candidate.col}`
        if (!seenBlockingKeys.has(key)) {
          seenBlockingKeys.add(key)
          blockingCells.push({
            row: candidate.row,
            col: candidate.col,
            distSq: candidate.distSq,
          })
        }
      }
    }

    const clampedX = clamp(curX, bounds.minX, bounds.maxX)
    const clampedZ = clamp(curZ, bounds.minZ, bounds.maxZ)
    if (clampedX !== curX || clampedZ !== curZ) {
      hitBoundary = true
      if (clampedX !== curX) hitX = true
      if (clampedZ !== curZ) hitZ = true
      curX = clampedX
      curZ = clampedZ
    }

    if (!passAdjusted) {
      break
    }
  }

  return {
    x: curX,
    z: curZ,
    collided: hitBoundary || blockingCells.length > 0,
    hitBoundary,
    hitX,
    hitZ,
    blockingCells,
  }
}

/**
 * Advances continuous X/Z movement using distance-bounded substeps so fast
 * speeds or frame-time spikes cannot tunnel through maze walls or boundaries.
 */
export function moveWithSubsteps(
  startX,
  startZ,
  deltaX,
  deltaZ,
  maze,
  options = {}
) {
  const safeStartX = Number.isFinite(startX) ? startX : 0
  const safeStartZ = Number.isFinite(startZ) ? startZ : 0
  const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0
  const safeDeltaZ = Number.isFinite(deltaZ) ? deltaZ : 0

  if (!maze?.grid) {
    return {
      x: safeStartX,
      z: safeStartZ,
      collided: false,
      hitBoundary: false,
      hitX: false,
      hitZ: false,
      blockingCells: [],
      substeps: 0,
    }
  }

  const radius = Number.isFinite(options?.radius)
    ? Math.max(0.05, options.radius)
    : PLAYER_RADIUS
  const maxStep = Number.isFinite(options?.maxStep)
    ? Math.max(0.05, options.maxStep)
    : Math.max(0.15, radius * 0.45)

  const distance = Math.hypot(safeDeltaX, safeDeltaZ)
  const steps =
    distance > 0 ? Math.max(1, Math.ceil(distance / maxStep)) : 1

  const stepX = safeDeltaX / steps
  const stepZ = safeDeltaZ / steps

  let curX = safeStartX
  let curZ = safeStartZ
  let collided = false
  let hitBoundary = false
  let hitX = false
  let hitZ = false
  const blockingCells = []
  const seenKeys = new Set()

  for (let i = 0; i < steps; i += 1) {
    const res = resolveGridCollision(curX + stepX, curZ + stepZ, maze, {
      radius,
      passes: options?.passes,
    })
    curX = res.x
    curZ = res.z

    if (res.collided) collided = true
    if (res.hitBoundary) hitBoundary = true
    if (res.hitX) hitX = true
    if (res.hitZ) hitZ = true

    for (let j = 0; j < res.blockingCells.length; j += 1) {
      const cell = res.blockingCells[j]
      const key = `${cell.row},${cell.col}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        blockingCells.push(cell)
      }
    }
  }

  return {
    x: curX,
    z: curZ,
    collided,
    hitBoundary,
    hitX,
    hitZ,
    blockingCells,
    substeps: steps,
  }
}
