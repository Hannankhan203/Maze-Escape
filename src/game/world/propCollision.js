import { CELL_TYPES } from '../generation/mazeConfig.js'
import { PROP_COLLIDER_SPECS } from '../generation/environmentalPropPlacement.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from './worldCoords.js'

export const COLLIDER_KIND_OBB = 1
export const COLLIDER_KIND_CIRCLE = 2
export const MIN_HAZARD_NAVIGABLE_CLEARANCE = 1.25

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

function normalizeColliderKind(kind) {
  if (kind === COLLIDER_KIND_CIRCLE || kind === 'circle') {
    return COLLIDER_KIND_CIRCLE
  }
  return COLLIDER_KIND_OBB
}

function computeColliderGeometryInto(spec, out) {
  const cx = Number(spec.cx)
  const cz = Number(spec.cz)
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
    return false
  }

  const kind = normalizeColliderKind(spec.kind)
  out.kind = kind
  out.cx = cx
  out.cz = cz

  if (kind === COLLIDER_KIND_CIRCLE) {
    const rawRadius = Number(spec.radius)
    if (!Number.isFinite(rawRadius) || rawRadius <= 0) {
      return false
    }
    const radius = Math.max(0.01, rawRadius)
    out.ux = 1
    out.uz = 0
    out.vx = 0
    out.vz = 1
    out.halfW = radius
    out.halfD = radius
    out.radius = radius
    out.yaw = 0
    out.minX = cx - radius
    out.maxX = cx + radius
    out.minZ = cz - radius
    out.maxZ = cz + radius
    return true
  }

  const rawHalfW = Number(spec.halfW)
  const rawHalfD = Number(spec.halfD)
  if (
    !Number.isFinite(rawHalfW) ||
    rawHalfW <= 0 ||
    !Number.isFinite(rawHalfD) ||
    rawHalfD <= 0
  ) {
    return false
  }
  const yaw = Number.isFinite(spec.yaw) ? spec.yaw : 0
  const ux = Math.cos(yaw)
  const uz = -Math.sin(yaw)
  const vx = Math.sin(yaw)
  const vz = Math.cos(yaw)
  const halfW = Math.max(0.01, rawHalfW)
  const halfD = Math.max(0.01, rawHalfD)
  const envX = Math.abs(ux) * halfW + Math.abs(vx) * halfD
  const envZ = Math.abs(uz) * halfW + Math.abs(vz) * halfD

  out.ux = ux
  out.uz = uz
  out.vx = vx
  out.vz = vz
  out.halfW = halfW
  out.halfD = halfD
  out.radius = 0
  out.yaw = yaw
  out.minX = cx - envX
  out.maxX = cx + envX
  out.minZ = cz - envZ
  out.maxZ = cz + envZ
  return true
}

function computeBucketRange(index, col, out) {
  out.minCol = clamp(Math.floor((col.minX - index.originX) / CELL_SIZE), 0, index.cols - 1)
  out.maxCol = clamp(Math.floor((col.maxX - index.originX) / CELL_SIZE), 0, index.cols - 1)
  out.minRow = clamp(Math.floor((col.minZ - index.originZ) / CELL_SIZE), 0, index.rows - 1)
  out.maxRow = clamp(Math.floor((col.maxZ - index.originZ) / CELL_SIZE), 0, index.rows - 1)
}

function insertSlotIntoBuckets(index, slotIdx, minRow, maxRow, minCol, maxCol) {
  const { cols, cellBuckets } = index
  for (let r = minRow; r <= maxRow; r += 1) {
    const rowOffset = r * cols
    for (let c = minCol; c <= maxCol; c += 1) {
      const bucketIdx = rowOffset + c
      let bucket = cellBuckets[bucketIdx]
      if (!bucket) {
        bucket = [slotIdx]
        cellBuckets[bucketIdx] = bucket
      } else if (bucket.indexOf(slotIdx) === -1) {
        bucket.push(slotIdx)
      }
    }
  }
}

function removeSlotFromBuckets(index, slotIdx, minRow, maxRow, minCol, maxCol) {
  if (minRow < 0 || minCol < 0) return
  const { cols, cellBuckets } = index
  for (let r = minRow; r <= maxRow; r += 1) {
    const rowOffset = r * cols
    for (let c = minCol; c <= maxCol; c += 1) {
      const bucket = cellBuckets[rowOffset + c]
      if (!bucket || bucket.length === 0) continue
      const pos = bucket.indexOf(slotIdx)
      if (pos !== -1) {
        const lastIdx = bucket.length - 1
        if (pos !== lastIdx) {
          bucket[pos] = bucket[lastIdx]
        }
        bucket.pop()
      }
    }
  }
}

function ensureDynamicBookkeeping(index) {
  if (!index) return false
  if (!index.dynamicSlotsById) {
    index.dynamicSlotsById = new Map()
  }
  if (!Array.isArray(index.freeSlotIndices)) {
    index.freeSlotIndices = []
  }
  if (!Number.isInteger(index.staticCount)) {
    index.staticCount = Array.isArray(index.colliders) ? index.colliders.length : 0
  }
  if (!Number.isFinite(index.version)) {
    index.version = 0
  }
  return true
}

const _tmpBucketRange = { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }
const _tmpValidateGeom = {
  kind: COLLIDER_KIND_OBB,
  cx: 0,
  cz: 0,
  ux: 1,
  uz: 0,
  vx: 0,
  vz: 1,
  halfW: 0,
  halfD: 0,
  radius: 0,
  yaw: 0,
  minX: 0,
  maxX: 0,
  minZ: 0,
  maxZ: 0,
}

/**
 * Builds a cell-indexed 2D X/Z collision lookup structure for all solid
 * environmental props in `maze`, with support for incremental dynamic hazard
 * colliders. Static props are indexed once per `setMaze` and queried with zero
 * per-frame allocations inside `gridCollision.js`.
 */
export function buildPropCollisionIndex(maze, placedProps = null, options = null) {
  const grid = maze?.grid
  const allowEmpty = Boolean(options?.allowEmpty)
  const hasProps = Array.isArray(placedProps) && placedProps.length > 0
  if (!Array.isArray(grid) || grid.length === 0 || (!hasProps && !allowEmpty)) {
    return null
  }

  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) {
    return null
  }

  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2
  const colliders = []

  if (hasProps) {
    for (let i = 0; i < placedProps.length; i += 1) {
      const desc = placedProps[i]
      if (!desc) continue

      const propType = desc.propType || desc.type
      const shapes = Array.isArray(desc.shapes)
        ? desc.shapes
        : PROP_COLLIDER_SPECS[propType]
      if (!Array.isArray(shapes) || shapes.length === 0) {
        continue
      }

      let px
      let pz
      if (Array.isArray(desc.position) && desc.position.length >= 3) {
        px = Number(desc.position[0])
        pz = Number(desc.position[2])
      } else {
        const cellWorld = gridToWorld(desc.row, desc.col, maze)
        if (!cellWorld) continue
        px = cellWorld.x + (Number(desc.offsetX) || 0)
        pz = cellWorld.z + (Number(desc.offsetZ) || 0)
      }

      if (!Number.isFinite(px) || !Number.isFinite(pz)) continue

      const yaw = Number.isFinite(desc.rotationYaw) ? desc.rotationYaw : 0
      const scale = Number.isFinite(desc.scale) && desc.scale > 0 ? desc.scale : 1
      const cosYaw = Math.cos(yaw)
      const sinYaw = Math.sin(yaw)
      const propId = desc.propId || desc.id || null

      for (let s = 0; s < shapes.length; s += 1) {
        const shape = shapes[s]
        const lx = Number(shape.x) || 0
        const lz = Number(shape.z) || 0
        // Three.js Ry(yaw): x' = x*cos + z*sin, z' = -x*sin + z*cos
        const cx = px + (lx * cosYaw + lz * sinYaw) * scale
        const cz = pz + (-lx * sinYaw + lz * cosYaw) * scale

        if (shape.kind === 'circle') {
          const radius = Math.max(0.01, (Number(shape.radius) || 0) * scale)
          colliders.push({
            id: propId ? `${propId}:${s}` : null,
            ownerId: propId,
            kind: COLLIDER_KIND_CIRCLE,
            isDynamic: false,
            enabled: true,
            inBuckets: true,
            propId,
            propType,
            row: desc.row,
            col: desc.col,
            cx,
            cz,
            ux: 1,
            uz: 0,
            vx: 0,
            vz: 1,
            halfW: radius,
            halfD: radius,
            radius,
            yaw: 0,
            minX: cx - radius,
            maxX: cx + radius,
            minZ: cz - radius,
            maxZ: cz + radius,
            minRow: -1,
            maxRow: -1,
            minCol: -1,
            maxCol: -1,
          })
        } else {
          const totalYaw = yaw + (Number(shape.yaw) || 0)
          const ux = Math.cos(totalYaw)
          const uz = -Math.sin(totalYaw)
          const vx = Math.sin(totalYaw)
          const vz = Math.cos(totalYaw)
          const halfW = Math.max(0.01, (Number(shape.halfW) || 0) * scale)
          const halfD = Math.max(0.01, (Number(shape.halfD) || 0) * scale)
          const envX = Math.abs(ux) * halfW + Math.abs(vx) * halfD
          const envZ = Math.abs(uz) * halfW + Math.abs(vz) * halfD

          colliders.push({
            id: propId ? `${propId}:${s}` : null,
            ownerId: propId,
            kind: COLLIDER_KIND_OBB,
            isDynamic: false,
            enabled: true,
            inBuckets: true,
            propId,
            propType,
            row: desc.row,
            col: desc.col,
            cx,
            cz,
            ux,
            uz,
            vx,
            vz,
            halfW,
            halfD,
            radius: 0,
            yaw: totalYaw,
            minX: cx - envX,
            maxX: cx + envX,
            minZ: cz - envZ,
            maxZ: cz + envZ,
            minRow: -1,
            maxRow: -1,
            minCol: -1,
            maxCol: -1,
          })
        }
      }
    }
  }

  if (colliders.length === 0 && !allowEmpty) {
    return null
  }

  const index = {
    rows,
    cols,
    originX,
    originZ,
    colliders,
    cellBuckets: new Array(rows * cols).fill(null),
    staticCount: colliders.length,
    dynamicSlotsById: new Map(),
    freeSlotIndices: [],
    version: 0,
  }

  for (let i = 0; i < colliders.length; i += 1) {
    const col = colliders[i]
    computeBucketRange(index, col, _tmpBucketRange)
    col.minRow = _tmpBucketRange.minRow
    col.maxRow = _tmpBucketRange.maxRow
    col.minCol = _tmpBucketRange.minCol
    col.maxCol = _tmpBucketRange.maxCol
    insertSlotIntoBuckets(
      index,
      i,
      col.minRow,
      col.maxRow,
      col.minCol,
      col.maxCol
    )
  }

  return index
}

/**
 * Registers (or updates in-place if already present) a dynamic OBB or circle
 * collider without rebuilding static prop colliders or scanning the full grid.
 */
export function registerDynamicCollider(index, spec) {
  if (!index || !spec || typeof spec.id !== 'string' || spec.id.length === 0) {
    return null
  }
  ensureDynamicBookkeeping(index)

  if (index.dynamicSlotsById.has(spec.id)) {
    const res = updateDynamicCollider(index, spec.id, spec)
    return res.collider
  }

  const record = {
    id: spec.id,
    ownerId: spec.ownerId ?? spec.propId ?? spec.id,
    kind: COLLIDER_KIND_OBB,
    isDynamic: true,
    enabled: spec.enabled !== false,
    inBuckets: false,
    propId: spec.propId ?? spec.ownerId ?? spec.id,
    propType: spec.propType ?? spec.type ?? 'hazard_aftermath',
    row: Number.isInteger(spec.row) ? spec.row : -1,
    col: Number.isInteger(spec.col) ? spec.col : -1,
    cx: 0,
    cz: 0,
    ux: 1,
    uz: 0,
    vx: 0,
    vz: 1,
    halfW: 0,
    halfD: 0,
    radius: 0,
    yaw: 0,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
    minRow: -1,
    maxRow: -1,
    minCol: -1,
    maxCol: -1,
  }

  if (!computeColliderGeometryInto(spec, record)) {
    return null
  }

  const slotIdx =
    index.freeSlotIndices.length > 0
      ? index.freeSlotIndices.pop()
      : index.colliders.length
  index.colliders[slotIdx] = record
  index.dynamicSlotsById.set(record.id, slotIdx)

  if (record.enabled) {
    computeBucketRange(index, record, _tmpBucketRange)
    record.minRow = _tmpBucketRange.minRow
    record.maxRow = _tmpBucketRange.maxRow
    record.minCol = _tmpBucketRange.minCol
    record.maxCol = _tmpBucketRange.maxCol
    insertSlotIntoBuckets(
      index,
      slotIdx,
      record.minRow,
      record.maxRow,
      record.minCol,
      record.maxCol
    )
    record.inBuckets = true
  }

  index.version += 1
  return record
}

/**
 * Updates an existing dynamic collider's transform, dimensions, shape kind, or
 * enabled state in-place. Spatial buckets are mutated ONLY when enabled state or
 * overlapped cell bounds actually change.
 */
export function updateDynamicCollider(index, id, patch = null) {
  if (!index || !patch || typeof id !== 'string') {
    return { updated: false, bucketChanged: false, enabledChanged: false, collider: null }
  }
  ensureDynamicBookkeeping(index)

  const slotIdx = index.dynamicSlotsById.get(id)
  if (slotIdx === undefined) {
    return { updated: false, bucketChanged: false, enabledChanged: false, collider: null }
  }
  const col = index.colliders[slotIdx]
  if (!col) {
    return { updated: false, bucketChanged: false, enabledChanged: false, collider: null }
  }

  const prevEnabled = col.enabled
  const prevInBuckets = col.inBuckets
  const prevMinRow = col.minRow
  const prevMaxRow = col.maxRow
  const prevMinCol = col.minCol
  const prevMaxCol = col.maxCol

  const nextEnabled =
    patch.enabled !== undefined ? Boolean(patch.enabled) : col.enabled
  const nextKind =
    patch.kind !== undefined ? normalizeColliderKind(patch.kind) : col.kind
  const nextCx = patch.cx !== undefined ? Number(patch.cx) : col.cx
  const nextCz = patch.cz !== undefined ? Number(patch.cz) : col.cz
  const nextYaw = patch.yaw !== undefined ? Number(patch.yaw) : col.yaw
  const nextHalfW = patch.halfW !== undefined ? Number(patch.halfW) : col.halfW
  const nextHalfD = patch.halfD !== undefined ? Number(patch.halfD) : col.halfD
  const nextRadius =
    patch.radius !== undefined
      ? Number(patch.radius)
      : nextKind === COLLIDER_KIND_CIRCLE
        ? col.radius || col.halfW
        : col.radius

  const geomChanged =
    nextKind !== col.kind ||
    nextCx !== col.cx ||
    nextCz !== col.cz ||
    (nextKind === COLLIDER_KIND_CIRCLE
      ? nextRadius !== col.radius
      : nextHalfW !== col.halfW || nextHalfD !== col.halfD || nextYaw !== col.yaw)
  const enabledChanged = nextEnabled !== prevEnabled

  if (!geomChanged && !enabledChanged) {
    return { updated: false, bucketChanged: false, enabledChanged: false, collider: col }
  }

  if (geomChanged) {
    _tmpValidateGeom.kind = nextKind
    _tmpValidateGeom.cx = nextCx
    _tmpValidateGeom.cz = nextCz
    _tmpValidateGeom.halfW = nextHalfW
    _tmpValidateGeom.halfD = nextHalfD
    _tmpValidateGeom.yaw = nextYaw
    _tmpValidateGeom.radius = nextRadius
    if (!computeColliderGeometryInto(_tmpValidateGeom, col)) {
      return { updated: false, bucketChanged: false, enabledChanged: false, collider: col }
    }
  }

  if (Number.isInteger(patch.row)) col.row = patch.row
  if (Number.isInteger(patch.col)) col.col = patch.col
  col.enabled = nextEnabled

  let bucketChanged = false
  if (!nextEnabled) {
    if (prevInBuckets) {
      removeSlotFromBuckets(
        index,
        slotIdx,
        prevMinRow,
        prevMaxRow,
        prevMinCol,
        prevMaxCol
      )
      col.inBuckets = false
      col.minRow = -1
      col.maxRow = -1
      col.minCol = -1
      col.maxCol = -1
      bucketChanged = true
    }
  } else {
    computeBucketRange(index, col, _tmpBucketRange)
    const spanChanged =
      !prevInBuckets ||
      _tmpBucketRange.minRow !== prevMinRow ||
      _tmpBucketRange.maxRow !== prevMaxRow ||
      _tmpBucketRange.minCol !== prevMinCol ||
      _tmpBucketRange.maxCol !== prevMaxCol

    if (spanChanged) {
      if (prevInBuckets) {
        removeSlotFromBuckets(
          index,
          slotIdx,
          prevMinRow,
          prevMaxRow,
          prevMinCol,
          prevMaxCol
        )
      }
      col.minRow = _tmpBucketRange.minRow
      col.maxRow = _tmpBucketRange.maxRow
      col.minCol = _tmpBucketRange.minCol
      col.maxCol = _tmpBucketRange.maxCol
      insertSlotIntoBuckets(
        index,
        slotIdx,
        col.minRow,
        col.maxRow,
        col.minCol,
        col.maxCol
      )
      col.inBuckets = true
      bucketChanged = true
    }
  }

  index.version += 1
  return {
    updated: true,
    bucketChanged,
    enabledChanged,
    collider: col,
  }
}

export function setDynamicColliderEnabled(index, id, enabled) {
  return updateDynamicCollider(index, id, { enabled: Boolean(enabled) })
}

export function unregisterDynamicCollider(index, id) {
  if (!index || typeof id !== 'string') return false
  ensureDynamicBookkeeping(index)

  const slotIdx = index.dynamicSlotsById.get(id)
  if (slotIdx === undefined) return false

  const col = index.colliders[slotIdx]
  if (col && col.inBuckets) {
    removeSlotFromBuckets(
      index,
      slotIdx,
      col.minRow,
      col.maxRow,
      col.minCol,
      col.maxCol
    )
  }

  index.colliders[slotIdx] = null
  index.dynamicSlotsById.delete(id)
  index.freeSlotIndices.push(slotIdx)
  index.version += 1
  return true
}

export function unregisterDynamicCollidersByOwner(index, ownerId) {
  if (!index || ownerId === null || ownerId === undefined) return 0
  ensureDynamicBookkeeping(index)

  const idsToRemove = []
  for (const [id, slotIdx] of index.dynamicSlotsById.entries()) {
    const col = index.colliders[slotIdx]
    if (col && col.ownerId === ownerId) {
      idsToRemove.push(id)
    }
  }
  for (let i = 0; i < idsToRemove.length; i += 1) {
    unregisterDynamicCollider(index, idsToRemove[i])
  }
  return idsToRemove.length
}

export function clearDynamicColliders(index) {
  if (!index) return 0
  ensureDynamicBookkeeping(index)
  if (index.dynamicSlotsById.size === 0) return 0

  const ids = Array.from(index.dynamicSlotsById.keys())
  for (let i = 0; i < ids.length; i += 1) {
    unregisterDynamicCollider(index, ids[i])
  }
  return ids.length
}

export function getDynamicCollider(index, id) {
  if (!index || !index.dynamicSlotsById || typeof id !== 'string') return null
  const slotIdx = index.dynamicSlotsById.get(id)
  if (slotIdx === undefined) return null
  return index.colliders[slotIdx] || null
}

export function getDynamicColliderCount(index) {
  if (!index || !index.dynamicSlotsById) return 0
  return index.dynamicSlotsById.size
}

function isWalkableCell(grid, row, col) {
  return (
    row >= 0 &&
    col >= 0 &&
    row < grid.length &&
    Array.isArray(grid[row]) &&
    col < grid[row].length &&
    grid[row][col] === CELL_TYPES.PATH
  )
}

/**
 * Computes the widest unobstructed 1D gap inside `[spanMin, spanMax]` after
 * subtracting the interval `[obsMin, obsMax]` and any additional blocking
 * intervals from neighboring colliders in the same cell.
 */
function computeLargestFreeInterval(spanMin, spanMax, intervals) {
  if (spanMax <= spanMin) return 0
  if (intervals.length === 0) return spanMax - spanMin

  intervals.sort((a, b) => a[0] - b[0])
  let cursor = spanMin
  let maxGap = 0
  for (let i = 0; i < intervals.length; i += 1) {
    const start = clamp(intervals[i][0], spanMin, spanMax)
    const end = clamp(intervals[i][1], spanMin, spanMax)
    if (start > cursor) {
      const gap = start - cursor
      if (gap > maxGap) maxGap = gap
    }
    if (end > cursor) {
      cursor = end
    }
  }
  if (spanMax > cursor) {
    const gap = spanMax - cursor
    if (gap > maxGap) maxGap = gap
  }
  return maxGap
}

/**
 * Validates that a candidate hazard collider sits inside a walkable corridor
 * cell without wall violations and preserves at least `minClearance` (default
 * 1.25m) of navigable passage so a single obstacle can never soft-lock the maze.
 */
export function validateHazardColliderPlacement(maze, colliderSpec, options = {}) {
  const minClearance = Math.max(
    PLAYER_RADIUS * 2 + 0.1,
    Number.isFinite(options?.minClearance)
      ? options.minClearance
      : MIN_HAZARD_NAVIGABLE_CLEARANCE
  )

  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0]) || !colliderSpec) {
    return { valid: false, clearance: 0, minClearance, reason: 'invalid_maze_or_spec', cell: null }
  }

  const rows = grid.length
  const cols = grid[0].length
  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2
  const mazeMaxX = originX + cols * CELL_SIZE
  const mazeMaxZ = originZ + rows * CELL_SIZE

  if (!computeColliderGeometryInto(colliderSpec, _tmpValidateGeom)) {
    return { valid: false, clearance: 0, minClearance, reason: 'invalid_geometry', cell: null }
  }

  const { cx, cz, minX, maxX, minZ, maxZ } = _tmpValidateGeom
  if (cx < originX || cx > mazeMaxX || cz < originZ || cz > mazeMaxZ) {
    return { valid: false, clearance: 0, minClearance, reason: 'out_of_bounds', cell: null }
  }

  const col = Number.isInteger(colliderSpec.col)
    ? colliderSpec.col
    : Math.floor((cx - originX) / CELL_SIZE)
  const row = Number.isInteger(colliderSpec.row)
    ? colliderSpec.row
    : Math.floor((cz - originZ) / CELL_SIZE)

  if (!isWalkableCell(grid, row, col)) {
    return { valid: false, clearance: 0, minClearance, reason: 'non_walkable_cell', cell: { row, col } }
  }

  const cellMinX = originX + col * CELL_SIZE
  const cellMaxX = cellMinX + CELL_SIZE
  const cellMinZ = originZ + row * CELL_SIZE
  const cellMaxZ = cellMinZ + CELL_SIZE

  const openN = isWalkableCell(grid, row - 1, col)
  const openS = isWalkableCell(grid, row + 1, col)
  const openW = isWalkableCell(grid, row, col - 1)
  const openE = isWalkableCell(grid, row, col + 1)

  // Reject colliders that deeply intrude into an adjacent solid wall tile
  const wallPenetrationTolerance = 0.08
  if (!openW && minX < cellMinX - wallPenetrationTolerance) {
    return { valid: false, clearance: 0, minClearance, reason: 'wall_overlap_west', cell: { row, col } }
  }
  if (!openE && maxX > cellMaxX + wallPenetrationTolerance) {
    return { valid: false, clearance: 0, minClearance, reason: 'wall_overlap_east', cell: { row, col } }
  }
  if (!openN && minZ < cellMinZ - wallPenetrationTolerance) {
    return { valid: false, clearance: 0, minClearance, reason: 'wall_overlap_north', cell: { row, col } }
  }
  if (!openS && maxZ > cellMaxZ + wallPenetrationTolerance) {
    return { valid: false, clearance: 0, minClearance, reason: 'wall_overlap_south', cell: { row, col } }
  }

  // Collect blocking intervals along X and Z from this collider plus any other
  // active colliders in the same cell (excluding same ownerId/id).
  const xIntervals = [[minX, maxX]]
  const zIntervals = [[minZ, maxZ]]
  const index = options?.index || null
  const ignoreId = colliderSpec.id ?? null
  const ignoreOwnerId = options?.ignoreOwnerId ?? colliderSpec.ownerId ?? null

  if (index && Array.isArray(index.cellBuckets) && Array.isArray(index.colliders)) {
    const bucket = index.cellBuckets[row * cols + col]
    if (bucket && bucket.length > 0) {
      for (let i = 0; i < bucket.length; i += 1) {
        const other = index.colliders[bucket[i]]
        if (!other || other.enabled === false) continue
        if (ignoreId && other.id === ignoreId) continue
        if (ignoreOwnerId && other.ownerId === ignoreOwnerId) continue
        // Only count obstacles whose orthogonal projection overlaps our obstacle band
        if (other.maxZ > minZ && other.minZ < maxZ) {
          xIntervals.push([other.minX, other.maxX])
        }
        if (other.maxX > minX && other.minX < maxX) {
          zIntervals.push([other.minZ, other.maxZ])
        }
      }
    }
  }

  const clearanceX = computeLargestFreeInterval(cellMinX, cellMaxX, xIntervals)
  const clearanceZ = computeLargestFreeInterval(cellMinZ, cellMaxZ, zIntervals)

  // Compute unobstructed margin on each open-side edge (for corner/T-junction turns
  // where an obstacle tucked against a closed wall does not block the open turn band).
  let minBlockX = cellMaxX
  let maxBlockX = cellMinX
  for (let i = 0; i < xIntervals.length; i += 1) {
    const s = clamp(xIntervals[i][0], cellMinX, cellMaxX)
    const e = clamp(xIntervals[i][1], cellMinX, cellMaxX)
    if (s < minBlockX) minBlockX = s
    if (e > maxBlockX) maxBlockX = e
  }
  let minBlockZ = cellMaxZ
  let maxBlockZ = cellMinZ
  for (let i = 0; i < zIntervals.length; i += 1) {
    const s = clamp(zIntervals[i][0], cellMinZ, cellMaxZ)
    const e = clamp(zIntervals[i][1], cellMinZ, cellMaxZ)
    if (s < minBlockZ) minBlockZ = s
    if (e > maxBlockZ) maxBlockZ = e
  }
  const gapNorth = Math.max(0, minBlockZ - cellMinZ)
  const gapSouth = Math.max(0, cellMaxZ - maxBlockZ)
  const gapWest = Math.max(0, minBlockX - cellMinX)
  const gapEast = Math.max(0, cellMaxX - maxBlockX)

  const openCount = (openN ? 1 : 0) + (openS ? 1 : 0) + (openW ? 1 : 0) + (openE ? 1 : 0)

  // Determine required navigable clearance based on corridor topology
  let effectiveClearance = Math.max(clearanceX, clearanceZ)
  if ((openN || openS) && !openE && !openW) {
    // Pure N-S corridor or N/S dead-end: player must pass along X
    effectiveClearance = clearanceX
  } else if ((openE || openW) && !openN && !openS) {
    // Pure E-W corridor or E/W dead-end: player must pass along Z
    effectiveClearance = clearanceZ
  } else if (openCount === 2) {
    // L-corner (one N/S exit + one E/W exit): player can turn cleanly via the open-side
    // band if the obstacle is tucked away from either open edge, OR go around the outer side.
    const openZGap = openN ? gapNorth : gapSouth
    const openXGap = openW ? gapWest : gapEast
    effectiveClearance = Math.max(openZGap, openXGap, Math.min(clearanceX, clearanceZ))
  } else if (openCount === 3) {
    // T-junction: an obstacle tucked flush against the single closed wall leaves the
    // opposite open band completely navigable for all three branches.
    let closedWallOppositeGap = 0
    if (!openN) closedWallOppositeGap = gapSouth
    else if (!openS) closedWallOppositeGap = gapNorth
    else if (!openW) closedWallOppositeGap = gapEast
    else if (!openE) closedWallOppositeGap = gapWest
    effectiveClearance = Math.max(closedWallOppositeGap, Math.min(clearanceX, clearanceZ))
  } else if (openCount === 4) {
    // 4-way intersection: all four branches connect, require clearance on both axes
    effectiveClearance = Math.min(clearanceX, clearanceZ)
  }

  if (effectiveClearance + 1e-4 < minClearance) {
    return {
      valid: false,
      clearance: effectiveClearance,
      minClearance,
      reason: 'insufficient_corridor_clearance',
      cell: { row, col },
    }
  }

  return {
    valid: true,
    clearance: effectiveClearance,
    minClearance,
    reason: null,
    cell: { row, col },
  }
}

