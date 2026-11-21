import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  PLAYER_RADIUS,
  isValidGridPosition,
} from './worldCoords.js'

const DEFAULT_COLLISION_PASSES = 2
const EPSILON = 1e-6
const MAX_POOLED_SCRATCH_FRAMES = 4

const collisionScratchStack = []
let activeScratchDepth = 0

function createCollisionScratchFrame() {
  return {
    bounds: {
      originX: 0,
      originZ: 0,
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
      rows: 0,
      cols: 0,
    },
    candidates: [],
    resolveOut: {
      x: 0,
      z: 0,
      hit: false,
      normalX: 0,
      normalZ: 0,
    },
    stepState: {
      x: 0,
      z: 0,
      collided: false,
      hitBoundary: false,
      hitX: false,
      hitZ: false,
    },
  }
}

function acquireCollisionScratchFrame() {
  const depth = activeScratchDepth
  activeScratchDepth += 1
  let frame = collisionScratchStack[depth]
  if (!frame) {
    frame = createCollisionScratchFrame()
    if (depth < MAX_POOLED_SCRATCH_FRAMES) {
      collisionScratchStack[depth] = frame
    }
  }
  return frame
}

function releaseCollisionScratchFrame() {
  if (activeScratchDepth > 0) {
    activeScratchDepth -= 1
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function computeMazeWorldBounds(maze, radius, outBounds) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return false
  }
  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) {
    return false
  }

  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : PLAYER_RADIUS
  const totalWidth = cols * CELL_SIZE
  const totalDepth = rows * CELL_SIZE
  const originX = -totalWidth / 2
  const originZ = -totalDepth / 2

  const minX = originX + safeRadius
  const maxX = Math.max(minX, originX + totalWidth - safeRadius)
  const minZ = originZ + safeRadius
  const maxZ = Math.max(minZ, originZ + totalDepth - safeRadius)

  outBounds.originX = originX
  outBounds.originZ = originZ
  outBounds.minX = minX
  outBounds.maxX = maxX
  outBounds.minZ = minZ
  outBounds.maxZ = maxZ
  outBounds.rows = rows
  outBounds.cols = cols
  return true
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
  const out = {
    originX: 0,
    originZ: 0,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
    rows: 0,
    cols: 0,
  }
  return computeMazeWorldBounds(maze, radius, out) ? out : null
}

/**
 * Computes squared distance from `(x, z)` to an axis-aligned cell box.
 */
function distanceSqToBoxBounds(x, z, minX, maxX, minZ, maxZ) {
  const nearestX = clamp(x, minX, maxX)
  const nearestZ = clamp(z, minZ, maxZ)
  const dx = x - nearestX
  const dz = z - nearestZ
  return dx * dx + dz * dz
}

/**
 * Separates a circle `(x, z, radius)` from a solid cell AABB if overlapping.
 * Writes `{ x, z, hit, normalX, normalZ }` into `out`.
 */
function resolveCircleBoxInto(x, z, radius, minX, maxX, minZ, maxZ, out) {
  const nearestX = clamp(x, minX, maxX)
  const nearestZ = clamp(z, minZ, maxZ)
  const dx = x - nearestX
  const dz = z - nearestZ
  const distSq = dx * dx + dz * dz

  if (distSq >= radius * radius - EPSILON) {
    out.x = x
    out.z = z
    out.hit = false
    out.normalX = 0
    out.normalZ = 0
    return
  }

  if (distSq > EPSILON) {
    const dist = Math.sqrt(distSq)
    const overlap = radius - dist
    const nx = dx / dist
    const nz = dz / dist
    out.x = x + nx * overlap
    out.z = z + nz * overlap
    out.hit = true
    out.normalX = nx
    out.normalZ = nz
    return
  }

  // Fallback when circle center sits inside the wall box: eject via nearest face
  const distLeft = Math.abs(x - minX)
  const distRight = Math.abs(maxX - x)
  const distTop = Math.abs(z - minZ)
  const distBottom = Math.abs(maxZ - z)
  const minFace = Math.min(distLeft, distRight, distTop, distBottom)

  if (minFace === distLeft) {
    out.x = minX - radius
    out.z = z
    out.hit = true
    out.normalX = -1
    out.normalZ = 0
    return
  }
  if (minFace === distRight) {
    out.x = maxX + radius
    out.z = z
    out.hit = true
    out.normalX = 1
    out.normalZ = 0
    return
  }
  if (minFace === distTop) {
    out.x = x
    out.z = minZ - radius
    out.hit = true
    out.normalX = 0
    out.normalZ = -1
    return
  }
  out.x = x
  out.z = maxZ + radius
  out.hit = true
  out.normalX = 0
  out.normalZ = 1
}

function pushUniqueBlockingCell(blockingCells, row, col, distSq) {
  for (let i = 0; i < blockingCells.length; i += 1) {
    const existing = blockingCells[i]
    if (existing.row === row && existing.col === col) {
      return
    }
  }
  blockingCells.push({ row, col, distSq })
}

function runCollisionStep(x, z, maze, radius, passes, bounds, frame, stateOut, blockingCells) {
  let curX = clamp(x, bounds.minX, bounds.maxX)
  let curZ = clamp(z, bounds.minZ, bounds.maxZ)
  let hitBoundary = curX !== x || curZ !== z
  let hitX = curX !== x
  let hitZ = curZ !== z

  const candidates = frame.candidates
  const resolveOut = frame.resolveOut
  const grid = maze.grid
  const originX = bounds.originX
  const originZ = bounds.originZ
  const rows = bounds.rows
  const cols = bounds.cols
  const prevBlockingCount = blockingCells.length

  for (let pass = 0; pass < passes; pass += 1) {
    const minCol = clamp(
      Math.floor((curX - radius - originX) / CELL_SIZE),
      0,
      cols - 1
    )
    const maxCol = clamp(
      Math.floor((curX + radius - originX) / CELL_SIZE),
      0,
      cols - 1
    )
    const minRow = clamp(
      Math.floor((curZ - radius - originZ) / CELL_SIZE),
      0,
      rows - 1
    )
    const maxRow = clamp(
      Math.floor((curZ + radius - originZ) / CELL_SIZE),
      0,
      rows - 1
    )

    let candidateCount = 0
    for (let r = minRow; r <= maxRow; r += 1) {
      const rowArr = grid[r]
      if (!rowArr) continue
      const cellMinZ = originZ + r * CELL_SIZE
      const cellMaxZ = cellMinZ + CELL_SIZE
      for (let c = minCol; c <= maxCol; c += 1) {
        if (rowArr[c] !== CELL_TYPES.PATH) {
          const cellMinX = originX + c * CELL_SIZE
          const cellMaxX = cellMinX + CELL_SIZE
          let cand = candidates[candidateCount]
          if (!cand) {
            cand = {
              row: 0,
              col: 0,
              minX: 0,
              maxX: 0,
              minZ: 0,
              maxZ: 0,
              distSq: 0,
            }
            candidates[candidateCount] = cand
          }
          cand.row = r
          cand.col = c
          cand.minX = cellMinX
          cand.maxX = cellMaxX
          cand.minZ = cellMinZ
          cand.maxZ = cellMaxZ
          cand.distSq = distanceSqToBoxBounds(
            curX,
            curZ,
            cellMinX,
            cellMaxX,
            cellMinZ,
            cellMaxZ
          )
          candidateCount += 1
        }
      }
    }

    if (candidateCount === 0) {
      break
    }

    // Nearest wall face first prevents corner seam catching along straight corridors (stable insertion sort)
    for (let i = 1; i < candidateCount; i += 1) {
      const key = candidates[i]
      const keyDistSq = key.distSq
      let j = i - 1
      while (j >= 0 && candidates[j].distSq > keyDistSq) {
        candidates[j + 1] = candidates[j]
        j -= 1
      }
      candidates[j + 1] = key
    }

    let passAdjusted = false
    for (let i = 0; i < candidateCount; i += 1) {
      const candidate = candidates[i]
      resolveCircleBoxInto(
        curX,
        curZ,
        radius,
        candidate.minX,
        candidate.maxX,
        candidate.minZ,
        candidate.maxZ,
        resolveOut
      )
      if (resolveOut.hit) {
        curX = resolveOut.x
        curZ = resolveOut.z
        passAdjusted = true
        if (Math.abs(resolveOut.normalX) > 0.1) hitX = true
        if (Math.abs(resolveOut.normalZ) > 0.1) hitZ = true
        pushUniqueBlockingCell(
          blockingCells,
          candidate.row,
          candidate.col,
          candidate.distSq
        )
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

  stateOut.x = curX
  stateOut.z = curZ
  stateOut.collided = hitBoundary || blockingCells.length > prevBlockingCount
  stateOut.hitBoundary = hitBoundary
  stateOut.hitX = hitX
  stateOut.hitZ = hitZ
}

/**
 * Resolves circular player collision against `maze.grid` walls and outer maze
 * boundaries in world X/Z space. Candidate wall tiles are sorted by proximity
 * so sliding along multi-tile corridor walls never snags on cell seams.
 */
export function resolveGridCollision(x, z, maze, options = {}) {
  const radius = Number.isFinite(options?.radius)
    ? Math.max(0, options.radius)
    : PLAYER_RADIUS
  const passes =
    Number.isInteger(options?.passes) && options.passes > 0
      ? options.passes
      : DEFAULT_COLLISION_PASSES

  const frame = acquireCollisionScratchFrame()
  try {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !computeMazeWorldBounds(maze, radius, frame.bounds)
    ) {
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

    const blockingCells = []
    const stepState = frame.stepState
    runCollisionStep(
      x,
      z,
      maze,
      radius,
      passes,
      frame.bounds,
      frame,
      stepState,
      blockingCells
    )

    return {
      x: stepState.x,
      z: stepState.z,
      collided: stepState.collided,
      hitBoundary: stepState.hitBoundary,
      hitX: stepState.hitX,
      hitZ: stepState.hitZ,
      blockingCells,
    }
  } finally {
    releaseCollisionScratchFrame()
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
  const passes =
    Number.isInteger(options?.passes) && options.passes > 0
      ? options.passes
      : DEFAULT_COLLISION_PASSES

  const distance = Math.hypot(safeDeltaX, safeDeltaZ)
  const steps =
    distance > 0 ? Math.max(1, Math.ceil(distance / maxStep)) : 1

  const stepX = safeDeltaX / steps
  const stepZ = safeDeltaZ / steps

  const frame = acquireCollisionScratchFrame()
  try {
    if (!computeMazeWorldBounds(maze, radius, frame.bounds)) {
      return {
        x: safeStartX + safeDeltaX,
        z: safeStartZ + safeDeltaZ,
        collided: false,
        hitBoundary: false,
        hitX: false,
        hitZ: false,
        blockingCells: [],
        substeps: steps,
      }
    }

    let curX = safeStartX
    let curZ = safeStartZ
    let collided = false
    let hitBoundary = false
    let hitX = false
    let hitZ = false
    const blockingCells = []
    const stepState = frame.stepState

    for (let i = 0; i < steps; i += 1) {
      runCollisionStep(
        curX + stepX,
        curZ + stepZ,
        maze,
        radius,
        passes,
        frame.bounds,
        frame,
        stepState,
        blockingCells
      )
      curX = stepState.x
      curZ = stepState.z

      if (stepState.collided) collided = true
      if (stepState.hitBoundary) hitBoundary = true
      if (stepState.hitX) hitX = true
      if (stepState.hitZ) hitZ = true
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
  } finally {
    releaseCollisionScratchFrame()
  }
}
