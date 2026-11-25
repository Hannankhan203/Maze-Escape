import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  PLAYER_RADIUS,
  isValidGridPosition,
} from './worldCoords.js'

const DEFAULT_COLLISION_PASSES = 2
const EPSILON = 1e-6
const MAX_POOLED_SCRATCH_FRAMES = 4
export const DEFAULT_MAX_STEP_HEIGHT = 0.38

const CANDIDATE_WALL = 0
const CANDIDATE_PROP_OBB = 1
const CANDIDATE_PROP_CIRCLE = 2

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
      hitProp: false,
      hitX: false,
      hitZ: false,
      steppedOverProp: false,
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

function acquireCandidateSlot(candidates, index) {
  let cand = candidates[index]
  if (!cand) {
    cand = {
      kind: CANDIDATE_WALL,
      propIndex: -1,
      row: 0,
      col: 0,
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
      cx: 0,
      cz: 0,
      ux: 1,
      uz: 0,
      vx: 0,
      vz: 1,
      halfW: 0,
      halfD: 0,
      radius: 0,
      distSq: 0,
    }
    candidates[index] = cand
  }
  return cand
}

function sortCandidatesByDistSq(candidates, candidateCount) {
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
}

function hasPropCandidate(candidates, count, propIndex) {
  for (let i = count - 1; i >= 0; i -= 1) {
    if (candidates[i].propIndex === propIndex) {
      return true
    }
  }
  return false
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

function distanceSqToCircle(x, z, cx, cz, propRadius) {
  const dx = x - cx
  const dz = z - cz
  const distToCenter = Math.hypot(dx, dz)
  const edgeDist = distToCenter - propRadius
  return edgeDist > 0 ? edgeDist * edgeDist : 0
}

function distanceSqToOBB(x, z, col) {
  const dx = x - col.cx
  const dz = z - col.cz
  const localX = dx * col.ux + dz * col.uz
  const localZ = dx * col.vx + dz * col.vz
  const clampedX = clamp(localX, -col.halfW, col.halfW)
  const clampedZ = clamp(localZ, -col.halfD, col.halfD)
  const ex = localX - clampedX
  const ez = localZ - clampedZ
  return ex * ex + ez * ez
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

function resolveCircleCircleInto(x, z, radius, cx, cz, propRadius, out) {
  const dx = x - cx
  const dz = z - cz
  const minDist = radius + propRadius
  const distSq = dx * dx + dz * dz

  if (distSq >= minDist * minDist - EPSILON) {
    out.x = x
    out.z = z
    out.hit = false
    out.normalX = 0
    out.normalZ = 0
    return
  }

  if (distSq > EPSILON) {
    const dist = Math.sqrt(distSq)
    const overlap = minDist - dist
    const nx = dx / dist
    const nz = dz / dist
    out.x = x + nx * overlap
    out.z = z + nz * overlap
    out.hit = true
    out.normalX = nx
    out.normalZ = nz
    return
  }

  out.x = cx + minDist
  out.z = cz
  out.hit = true
  out.normalX = 1
  out.normalZ = 0
}

function resolveCircleOBBInto(x, z, radius, obb, out) {
  const dx = x - obb.cx
  const dz = z - obb.cz
  const localX = dx * obb.ux + dz * obb.uz
  const localZ = dx * obb.vx + dz * obb.vz
  const nearestX = clamp(localX, -obb.halfW, obb.halfW)
  const nearestZ = clamp(localZ, -obb.halfD, obb.halfD)
  const lx = localX - nearestX
  const lz = localZ - nearestZ
  const distSq = lx * lx + lz * lz

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
    const lnx = lx / dist
    const lnz = lz / dist
    const wnx = lnx * obb.ux + lnz * obb.vx
    const wnz = lnx * obb.uz + lnz * obb.vz
    out.x = x + wnx * overlap
    out.z = z + wnz * overlap
    out.hit = true
    out.normalX = wnx
    out.normalZ = wnz
    return
  }

  const distLeft = Math.abs(localX + obb.halfW)
  const distRight = Math.abs(obb.halfW - localX)
  const distTop = Math.abs(localZ + obb.halfD)
  const distBottom = Math.abs(obb.halfD - localZ)
  const minFace = Math.min(distLeft, distRight, distTop, distBottom)

  let targetLocalX = localX
  let targetLocalZ = localZ
  let lnx = 0
  let lnz = 0

  if (minFace === distLeft) {
    targetLocalX = -obb.halfW - radius
    lnx = -1
  } else if (minFace === distRight) {
    targetLocalX = obb.halfW + radius
    lnx = 1
  } else if (minFace === distTop) {
    targetLocalZ = -obb.halfD - radius
    lnz = -1
  } else {
    targetLocalZ = obb.halfD + radius
    lnz = 1
  }

  out.x = obb.cx + targetLocalX * obb.ux + targetLocalZ * obb.vx
  out.z = obb.cz + targetLocalX * obb.uz + targetLocalZ * obb.vz
  out.hit = true
  out.normalX = lnx * obb.ux + lnz * obb.vx
  out.normalZ = lnx * obb.uz + lnz * obb.vz
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

function isColliderTraversableForStep(pCol, maxStepHeight) {
  return Boolean(
    pCol &&
      pCol.enabled !== false &&
      pCol.kind !== CANDIDATE_PROP_CIRCLE &&
      pCol.traversable === true &&
      Number.isFinite(pCol.stepHeight) &&
      pCol.stepHeight > 0 &&
      pCol.stepHeight <= maxStepHeight
  )
}

/**
 * Samples the smooth C1 step-over elevation profile of any active traversable
 * obstacle (such as a fallen transverse pipe) overlapping `(x, z)` in O(1) via
 * `propColliders.cellBuckets`. Reuses `out` when provided to avoid allocations.
 */
export function sampleTraversableObstacleHeight(
  x,
  z,
  radius,
  propColliders,
  maxStepHeight = DEFAULT_MAX_STEP_HEIGHT,
  out = null
) {
  const result = out || {
    height: 0,
    onObstacle: false,
    onCrest: false,
    colliderId: null,
    stepHeight: 0,
    localZ: 0,
  }
  result.height = 0
  result.onObstacle = false
  result.onCrest = false
  result.colliderId = null
  result.stepHeight = 0
  result.localZ = 0

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !propColliders ||
    !Array.isArray(propColliders.cellBuckets) ||
    !Array.isArray(propColliders.colliders)
  ) {
    return result
  }

  const safeRadius = Number.isFinite(radius) ? Math.max(0.1, radius) : PLAYER_RADIUS
  const safeMaxStep = Number.isFinite(maxStepHeight)
    ? Math.max(0, maxStepHeight)
    : DEFAULT_MAX_STEP_HEIGHT
  if (safeMaxStep <= 0) {
    return result
  }

  const { rows, cols, originX, originZ, cellBuckets, colliders } = propColliders
  if (rows <= 0 || cols <= 0) {
    return result
  }

  const crestMargin = 0.04
  const rampWidth = Math.max(0.24, Math.min(safeRadius, 0.64) - crestMargin)
  const queryMargin = crestMargin + rampWidth + 0.05

  const minCol = clamp(
    Math.floor((x - queryMargin - originX) / CELL_SIZE),
    0,
    cols - 1
  )
  const maxCol = clamp(
    Math.floor((x + queryMargin - originX) / CELL_SIZE),
    0,
    cols - 1
  )
  const minRow = clamp(
    Math.floor((z - queryMargin - originZ) / CELL_SIZE),
    0,
    rows - 1
  )
  const maxRow = clamp(
    Math.floor((z + queryMargin - originZ) / CELL_SIZE),
    0,
    rows - 1
  )

  for (let r = minRow; r <= maxRow; r += 1) {
    const rowOffset = r * cols
    for (let c = minCol; c <= maxCol; c += 1) {
      const bucket = cellBuckets[rowOffset + c]
      if (!bucket || bucket.length === 0) continue
      for (let i = 0; i < bucket.length; i += 1) {
        const pCol = colliders[bucket[i]]
        if (!isColliderTraversableForStep(pCol, safeMaxStep)) continue
        if (
          pCol.maxX < x - queryMargin ||
          pCol.minX > x + queryMargin ||
          pCol.maxZ < z - queryMargin ||
          pCol.minZ > z + queryMargin
        ) {
          continue
        }

        const dx = x - pCol.cx
        const dz = z - pCol.cz
        const localX = dx * pCol.ux + dz * pCol.uz
        const localZ = dx * pCol.vx + dz * pCol.vz
        const crestHalfD = pCol.halfD + crestMargin
        const excessX = Math.max(0, Math.abs(localX) - pCol.halfW)
        const excessZ = Math.max(0, Math.abs(localZ) - crestHalfD)

        if (excessX >= rampWidth || excessZ >= rampWidth) {
          continue
        }

        const distFromCrest =
          excessX === 0
            ? excessZ
            : excessZ === 0
              ? excessX
              : Math.hypot(excessX, excessZ)
        if (distFromCrest >= rampWidth) {
          continue
        }

        let sampledHeight = pCol.stepHeight
        let onCrest = true
        if (distFromCrest > 1e-5) {
          const t = 1 - distFromCrest / rampWidth
          sampledHeight = pCol.stepHeight * (t * t * (3 - 2 * t))
          onCrest = false
        }

        if (sampledHeight > result.height) {
          result.height = sampledHeight
          result.onObstacle = sampledHeight > 1e-4
          result.onCrest = onCrest
          result.colliderId = pCol.id ?? null
          result.stepHeight = pCol.stepHeight
          result.localZ = localZ
        }
      }
    }
  }

  return result
}

function runCollisionStep(
  x,
  z,
  maze,
  radius,
  passes,
  bounds,
  frame,
  stateOut,
  blockingCells,
  propColliders = null,
  allowStepOver = false,
  maxStepHeight = DEFAULT_MAX_STEP_HEIGHT
) {
  let curX = clamp(x, bounds.minX, bounds.maxX)
  let curZ = clamp(z, bounds.minZ, bounds.maxZ)
  let hitBoundary = curX !== x || curZ !== z
  let hitX = curX !== x
  let hitZ = curZ !== z
  let propCollided = false
  let lastPassHitProp = false
  let steppedOverProp = false

  const candidates = frame.candidates
  const resolveOut = frame.resolveOut
  const grid = maze.grid
  const originX = bounds.originX
  const originZ = bounds.originZ
  const rows = bounds.rows
  const cols = bounds.cols
  const prevBlockingCount = blockingCells.length

  const hasPropBuckets = Boolean(
    propColliders &&
      Array.isArray(propColliders.cellBuckets) &&
      Array.isArray(propColliders.colliders) &&
      propColliders.rows === rows &&
      propColliders.cols === cols
  )
  const effectivePasses = hasPropBuckets ? Math.max(passes, 3) : passes

  for (let pass = 0; pass < effectivePasses; pass += 1) {
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
          const cand = acquireCandidateSlot(candidates, candidateCount)
          cand.kind = CANDIDATE_WALL
          cand.propIndex = -1
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

        if (hasPropBuckets) {
          const bucket = propColliders.cellBuckets[r * cols + c]
          if (bucket && bucket.length > 0) {
            for (let b = 0; b < bucket.length; b += 1) {
              const propIndex = bucket[b]
              if (hasPropCandidate(candidates, candidateCount, propIndex)) {
                continue
              }
              const pCol = propColliders.colliders[propIndex]
              if (!pCol || pCol.enabled === false) continue
              if (
                pCol.maxX < curX - radius ||
                pCol.minX > curX + radius ||
                pCol.maxZ < curZ - radius ||
                pCol.minZ > curZ + radius
              ) {
                continue
              }
              if (allowStepOver && isColliderTraversableForStep(pCol, maxStepHeight)) {
                if (distanceSqToOBB(curX, curZ, pCol) < radius * radius) {
                  steppedOverProp = true
                }
                continue
              }
              const cand = acquireCandidateSlot(candidates, candidateCount)
              cand.kind =
                pCol.kind === CANDIDATE_PROP_CIRCLE
                  ? CANDIDATE_PROP_CIRCLE
                  : CANDIDATE_PROP_OBB
              cand.propIndex = propIndex
              cand.cx = pCol.cx
              cand.cz = pCol.cz
              cand.ux = pCol.ux
              cand.uz = pCol.uz
              cand.vx = pCol.vx
              cand.vz = pCol.vz
              cand.halfW = pCol.halfW
              cand.halfD = pCol.halfD
              cand.radius = pCol.radius
              cand.distSq =
                cand.kind === CANDIDATE_PROP_CIRCLE
                  ? distanceSqToCircle(curX, curZ, pCol.cx, pCol.cz, pCol.radius)
                  : distanceSqToOBB(curX, curZ, pCol)
              candidateCount += 1
            }
          }
        }
      }
    }

    if (candidateCount === 0) {
      lastPassHitProp = false
      break
    }

    // Nearest face first prevents corner seam catching along straight corridors (stable insertion sort)
    sortCandidatesByDistSq(candidates, candidateCount)

    let passAdjusted = false
    lastPassHitProp = false
    for (let i = 0; i < candidateCount; i += 1) {
      const candidate = candidates[i]
      if (candidate.kind === CANDIDATE_WALL) {
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
      } else if (candidate.kind === CANDIDATE_PROP_CIRCLE) {
        resolveCircleCircleInto(
          curX,
          curZ,
          radius,
          candidate.cx,
          candidate.cz,
          candidate.radius,
          resolveOut
        )
        if (resolveOut.hit) {
          curX = resolveOut.x
          curZ = resolveOut.z
          passAdjusted = true
          propCollided = true
          lastPassHitProp = true
          if (Math.abs(resolveOut.normalX) > 0.1) hitX = true
          if (Math.abs(resolveOut.normalZ) > 0.1) hitZ = true
        }
      } else {
        resolveCircleOBBInto(curX, curZ, radius, candidate, resolveOut)
        if (resolveOut.hit) {
          curX = resolveOut.x
          curZ = resolveOut.z
          passAdjusted = true
          propCollided = true
          lastPassHitProp = true
          if (Math.abs(resolveOut.normalX) > 0.1) hitX = true
          if (Math.abs(resolveOut.normalZ) > 0.1) hitZ = true
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

  // Final wall-priority safety sweep so no prop push can ever leave the player inside a wall tile or out of bounds.
  if (lastPassHitProp) {
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
    let wallCount = 0
    for (let r = minRow; r <= maxRow; r += 1) {
      const rowArr = grid[r]
      if (!rowArr) continue
      const cellMinZ = originZ + r * CELL_SIZE
      const cellMaxZ = cellMinZ + CELL_SIZE
      for (let c = minCol; c <= maxCol; c += 1) {
        if (rowArr[c] !== CELL_TYPES.PATH) {
          const cellMinX = originX + c * CELL_SIZE
          const cellMaxX = cellMinX + CELL_SIZE
          const cand = acquireCandidateSlot(candidates, wallCount)
          cand.kind = CANDIDATE_WALL
          cand.propIndex = -1
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
          wallCount += 1
        }
      }
    }
    if (wallCount > 0) {
      sortCandidatesByDistSq(candidates, wallCount)
      for (let i = 0; i < wallCount; i += 1) {
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
  }

  stateOut.x = curX
  stateOut.z = curZ
  stateOut.collided =
    hitBoundary || propCollided || blockingCells.length > prevBlockingCount
  stateOut.hitBoundary = hitBoundary
  stateOut.hitProp = propCollided
  stateOut.hitX = hitX
  stateOut.hitZ = hitZ
  stateOut.steppedOverProp = steppedOverProp
}

/**
 * Resolves circular player collision against `maze.grid` walls, outer maze
 * boundaries, and optional solid environmental prop colliders in world X/Z space.
 */
export function resolveGridCollision(x, z, maze, options = {}) {
  const radius = Number.isFinite(options?.radius)
    ? Math.max(0, options.radius)
    : PLAYER_RADIUS
  const passes =
    Number.isInteger(options?.passes) && options.passes > 0
      ? options.passes
      : DEFAULT_COLLISION_PASSES
  const propColliders = options?.propColliders || maze?.propColliders || null
  const allowStepOver = options?.allowStepOver === true
  const maxStepHeight = Number.isFinite(options?.maxStepHeight)
    ? Math.max(0, options.maxStepHeight)
    : DEFAULT_MAX_STEP_HEIGHT

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
        hitProp: false,
        hitX: false,
        hitZ: false,
        steppedOverProp: false,
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
      blockingCells,
      propColliders,
      allowStepOver,
      maxStepHeight
    )

    return {
      x: stepState.x,
      z: stepState.z,
      collided: stepState.collided,
      hitBoundary: stepState.hitBoundary,
      hitProp: stepState.hitProp,
      hitX: stepState.hitX,
      hitZ: stepState.hitZ,
      steppedOverProp: stepState.steppedOverProp,
      blockingCells,
    }
  } finally {
    releaseCollisionScratchFrame()
  }
}

/**
 * Advances continuous X/Z movement using distance-bounded substeps so fast
 * speeds or frame-time spikes cannot tunnel through maze walls, solid props,
 * or boundaries.
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
      hitProp: false,
      hitX: false,
      hitZ: false,
      steppedOverProp: false,
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
  const propColliders = options?.propColliders || maze?.propColliders || null
  const allowStepOver = options?.allowStepOver === true
  const maxStepHeight = Number.isFinite(options?.maxStepHeight)
    ? Math.max(0, options.maxStepHeight)
    : DEFAULT_MAX_STEP_HEIGHT

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
        hitProp: false,
        hitX: false,
        hitZ: false,
        steppedOverProp: false,
        blockingCells: [],
        substeps: steps,
      }
    }

    let curX = safeStartX
    let curZ = safeStartZ
    let collided = false
    let hitBoundary = false
    let hitProp = false
    let hitX = false
    let hitZ = false
    let steppedOverProp = false
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
        blockingCells,
        propColliders,
        allowStepOver,
        maxStepHeight
      )
      curX = stepState.x
      curZ = stepState.z

      if (stepState.collided) collided = true
      if (stepState.hitBoundary) hitBoundary = true
      if (stepState.hitProp) hitProp = true
      if (stepState.hitX) hitX = true
      if (stepState.hitZ) hitZ = true
      if (stepState.steppedOverProp) steppedOverProp = true
    }

    return {
      x: curX,
      z: curZ,
      collided,
      hitBoundary,
      hitProp,
      hitX,
      hitZ,
      steppedOverProp,
      blockingCells,
      substeps: steps,
    }
  } finally {
    releaseCollisionScratchFrame()
  }
}

/**
 * Checks whether an unobstructed straight-line 2D segment exists between
 * `(x0, z0)` and `(x1, z1)` across walkable cells in `maze.grid` (2D DDA).
 * Prevents players from triggering interactions through walls or around solid corners.
 */
export function hasLineOfSightInMaze(x0, z0, x1, z1, maze) {
  const grid = maze?.grid
  if (
    !Array.isArray(grid) ||
    grid.length === 0 ||
    !Array.isArray(grid[0]) ||
    !Number.isFinite(x0) ||
    !Number.isFinite(z0) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(z1)
  ) {
    return false
  }

  const rows = grid.length
  const cols = grid[0].length
  if (cols === 0) return false

  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2

  const gx0 = (x0 - originX) / CELL_SIZE
  const gz0 = (z0 - originZ) / CELL_SIZE
  const gx1 = (x1 - originX) / CELL_SIZE
  const gz1 = (z1 - originZ) / CELL_SIZE

  let col = Math.floor(gx0)
  let row = Math.floor(gz0)
  const endCol = Math.floor(gx1)
  const endRow = Math.floor(gz1)

  if (
    row < 0 ||
    row >= rows ||
    col < 0 ||
    col >= cols ||
    endRow < 0 ||
    endRow >= rows ||
    endCol < 0 ||
    endCol >= cols
  ) {
    return false
  }

  if (grid[row][col] !== CELL_TYPES.PATH || grid[endRow][endCol] !== CELL_TYPES.PATH) {
    return false
  }

  if (row === endRow && col === endCol) {
    return true
  }

  const dx = gx1 - gx0
  const dz = gz1 - gz0
  const stepCol = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepRow = dz > 0 ? 1 : dz < 0 ? -1 : 0

  const tDeltaX = stepCol !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaZ = stepRow !== 0 ? Math.abs(1 / dz) : Infinity

  let tMaxX =
    stepCol > 0
      ? (col + 1 - gx0) * tDeltaX
      : stepCol < 0
        ? (gx0 - col) * tDeltaX
        : Infinity
  let tMaxZ =
    stepRow > 0
      ? (row + 1 - gz0) * tDeltaZ
      : stepRow < 0
        ? (gz0 - row) * tDeltaZ
        : Infinity

  const maxSteps = rows + cols + 4
  for (let iter = 0; iter < maxSteps; iter += 1) {
    if (row === endRow && col === endCol) {
      return true
    }

    if (Math.abs(tMaxX - tMaxZ) <= 1e-7) {
      // Exact corner crossing: both adjacent orthogonal cells must be walkable
      const nextCol = col + stepCol
      const nextRow = row + stepRow
      if (
        nextCol < 0 ||
        nextCol >= cols ||
        nextRow < 0 ||
        nextRow >= rows ||
        grid[row][nextCol] !== CELL_TYPES.PATH ||
        grid[nextRow][col] !== CELL_TYPES.PATH ||
        grid[nextRow][nextCol] !== CELL_TYPES.PATH
      ) {
        return false
      }
      col = nextCol
      row = nextRow
      tMaxX += tDeltaX
      tMaxZ += tDeltaZ
    } else if (tMaxX < tMaxZ) {
      col += stepCol
      tMaxX += tDeltaX
      if (col < 0 || col >= cols || grid[row][col] !== CELL_TYPES.PATH) {
        return false
      }
    } else {
      row += stepRow
      tMaxZ += tDeltaZ
      if (row < 0 || row >= rows || grid[row][col] !== CELL_TYPES.PATH) {
        return false
      }
    }
  }

  return row === endRow && col === endCol
}

function overlapsAnyActivePropCollider(x, z, radius, propColliders) {
  if (
    !propColliders ||
    !Array.isArray(propColliders.cellBuckets) ||
    !Array.isArray(propColliders.colliders)
  ) {
    return false
  }
  const { rows, cols, originX, originZ, cellBuckets, colliders } = propColliders
  const minCol = clamp(Math.floor((x - radius - originX) / CELL_SIZE), 0, cols - 1)
  const maxCol = clamp(Math.floor((x + radius - originX) / CELL_SIZE), 0, cols - 1)
  const minRow = clamp(Math.floor((z - radius - originZ) / CELL_SIZE), 0, rows - 1)
  const maxRow = clamp(Math.floor((z + radius - originZ) / CELL_SIZE), 0, rows - 1)
  const rSq = (radius - 1e-4) * (radius - 1e-4)

  for (let r = minRow; r <= maxRow; r += 1) {
    const rowOffset = r * cols
    for (let c = minCol; c <= maxCol; c += 1) {
      const bucket = cellBuckets[rowOffset + c]
      if (!bucket || bucket.length === 0) continue
      for (let i = 0; i < bucket.length; i += 1) {
        const pCol = colliders[bucket[i]]
        if (!pCol || pCol.enabled === false) continue
        if (
          pCol.maxX < x - radius ||
          pCol.minX > x + radius ||
          pCol.maxZ < z - radius ||
          pCol.minZ > z + radius
        ) {
          continue
        }
        if (pCol.kind === CANDIDATE_PROP_CIRCLE) {
          const minDist = radius + pCol.radius - 1e-4
          const dx = x - pCol.cx
          const dz = z - pCol.cz
          if (dx * dx + dz * dz < minDist * minDist) {
            return true
          }
        } else {
          const dx = x - pCol.cx
          const dz = z - pCol.cz
          const localX = dx * pCol.ux + dz * pCol.uz
          const localZ = dx * pCol.vx + dz * pCol.vz
          const nearestX = clamp(localX, -pCol.halfW, pCol.halfW)
          const nearestZ = clamp(localZ, -pCol.halfD, pCol.halfD)
          const lx = localX - nearestX
          const lz = localZ - nearestZ
          if (lx * lx + lz * lz < rSq) {
            return true
          }
        }
      }
    }
  }
  return false
}

const PUSH_OUT_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.70710678, 0.70710678],
  [-0.70710678, 0.70710678],
  [0.70710678, -0.70710678],
  [-0.70710678, -0.70710678],
]
const PUSH_OUT_RINGS = [0.38, 0.78, 1.18, 1.58]

/**
 * Safely ejects a player who is overlapped by a newly activated dynamic collider
 * while guaranteeing wall-priority safety (never pushes through walls or out of bounds).
 */
export function resolveSafePushOut(x, z, maze, options = {}) {
  const safeX = Number.isFinite(x) ? x : 0
  const safeZ = Number.isFinite(z) ? z : 0
  const radius = Number.isFinite(options?.radius)
    ? Math.max(0.05, options.radius)
    : PLAYER_RADIUS
  const propColliders = options?.propColliders || maze?.propColliders || null

  if (!maze?.grid || !propColliders) {
    return { x: safeX, z: safeZ, pushed: false, safe: true, distanceMoved: 0 }
  }

  if (!overlapsAnyActivePropCollider(safeX, safeZ, radius, propColliders)) {
    return { x: safeX, z: safeZ, pushed: false, safe: true, distanceMoved: 0 }
  }

  const primary = resolveGridCollision(safeX, safeZ, maze, {
    radius,
    propColliders,
    passes: 4,
  })

  const grid = maze.grid
  const rows = grid.length
  const cols = grid[0].length
  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2

  const isPositionSafeAndClear = (px, pz) => {
    const col = Math.floor((px - originX) / CELL_SIZE)
    const row = Math.floor((pz - originZ) / CELL_SIZE)
    if (!isCellWalkable(row, col, maze)) return false
    if (overlapsAnyActivePropCollider(px, pz, radius, propColliders)) return false
    // Ensure line of sight from original cell prevents teleporting across a solid wall
    const wallCheck = resolveGridCollision(px, pz, maze, {
      radius,
      propColliders: null,
      passes: 2,
    })
    return Math.hypot(wallCheck.x - px, wallCheck.z - pz) <= 1e-3
  }

  if (
    isPositionSafeAndClear(primary.x, primary.z) &&
    hasLineOfSightInMaze(safeX, safeZ, primary.x, primary.z, maze)
  ) {
    const dist = Math.hypot(primary.x - safeX, primary.z - safeZ)
    return {
      x: primary.x,
      z: primary.z,
      pushed: dist > 1e-4,
      safe: true,
      distanceMoved: dist,
    }
  }

  // Probe radial escape candidates when primary ejection pinches against a wall
  let bestX = primary.x
  let bestZ = primary.z
  let bestDist = Infinity
  let foundClean = false

  for (let rIdx = 0; rIdx < PUSH_OUT_RINGS.length; rIdx += 1) {
    const ring = PUSH_OUT_RINGS[rIdx]
    for (let dIdx = 0; dIdx < PUSH_OUT_DIRS.length; dIdx += 1) {
      const candX = safeX + PUSH_OUT_DIRS[dIdx][0] * ring
      const candZ = safeZ + PUSH_OUT_DIRS[dIdx][1] * ring
      const resolved = resolveGridCollision(candX, candZ, maze, {
        radius,
        propColliders,
        passes: 4,
      })
      if (
        isPositionSafeAndClear(resolved.x, resolved.z) &&
        hasLineOfSightInMaze(safeX, safeZ, resolved.x, resolved.z, maze)
      ) {
        const dist = Math.hypot(resolved.x - safeX, resolved.z - safeZ)
        if (dist < bestDist) {
          bestDist = dist
          bestX = resolved.x
          bestZ = resolved.z
          foundClean = true
        }
      }
    }
    if (foundClean) break
  }

  if (!foundClean) {
    // Wall-priority fallback: guarantee player remains inside walkable bounds & outside walls
    const wallOnly = resolveGridCollision(primary.x, primary.z, maze, {
      radius,
      propColliders: null,
      passes: 3,
    })
    bestX = wallOnly.x
    bestZ = wallOnly.z
  }

  const distanceMoved = Math.hypot(bestX - safeX, bestZ - safeZ)
  return {
    x: bestX,
    z: bestZ,
    pushed: distanceMoved > 1e-4,
    safe: foundClean,
    distanceMoved,
  }
}

