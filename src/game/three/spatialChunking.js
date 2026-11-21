import * as THREE from 'three'
import { CELL_SIZE } from '../world/worldCoords.js'
import {
  FACE_NEG_X,
  FACE_NEG_Z,
  FACE_POS_X,
  FACE_POS_Z,
} from './geometryOptimization.js'

export const DEFAULT_SPATIAL_CHUNKING_CONFIG = {
  smallMazeMaxDim: 13,
  maxChunkCells: 9,
  minTrianglesToChunk: 900,
}

function splitCoordinateRanges(totalCells, chunkCount, origin, cellSize) {
  const ranges = []
  for (let i = 0; i < chunkCount; i += 1) {
    const startCell = Math.floor((i * totalCells) / chunkCount)
    const endCell = Math.floor(((i + 1) * totalCells) / chunkCount)
    const min = origin + startCell * cellSize
    const max = origin + endCell * cellSize
    ranges.push({
      chunkCoord: i,
      startCell,
      endCell,
      cellCount: endCell - startCell,
      min,
      max,
      center: (min + max) * 0.5,
      size: (endCell - startCell) * cellSize,
    })
  }
  return ranges
}

function findSplitBucket(value, splits, maxIndex) {
  for (let i = 0; i < splits.length; i += 1) {
    if (value < splits[i]) {
      return i
    }
  }
  return maxIndex
}

function sliceIntervalBySplits(minVal, maxVal, splits, eps = 1e-4) {
  const segments = []
  let cursor = minVal
  for (let i = 0; i < splits.length; i += 1) {
    const s = splits[i]
    if (s > cursor + eps && s < maxVal - eps) {
      segments.push([cursor, s])
      cursor = s
    }
  }
  if (maxVal - cursor > eps || segments.length === 0) {
    segments.push([cursor, maxVal])
  }
  return segments
}

/**
 * Computes deterministic world-space XZ spatial chunk layout aligned to canonical
 * `CELL_SIZE` grid boundaries. Small mazes (<= 13x13) collapse to a single 1x1 layout
 * so they incur zero chunk-splitting or extra draw-call overhead.
 */
export function createMazeChunkLayout(maze, options = {}) {
  const grid = maze?.grid
  const rows = grid?.length || maze?.rows || 1
  const cols = grid?.[0]?.length || maze?.cols || 1

  const smallMazeMaxDim =
    options.smallMazeMaxDim ?? DEFAULT_SPATIAL_CHUNKING_CONFIG.smallMazeMaxDim
  const maxChunkCells = Math.max(
    4,
    options.maxChunkCells ?? DEFAULT_SPATIAL_CHUNKING_CONFIG.maxChunkCells
  )
  const minTrianglesToChunk = Math.max(
    1,
    options.minTrianglesToChunk ??
      DEFAULT_SPATIAL_CHUNKING_CONFIG.minTrianglesToChunk
  )

  const maxChunksPerAxis =
    Number.isFinite(options.maxChunksPerAxis) && options.maxChunksPerAxis >= 1
      ? Math.floor(options.maxChunksPerAxis)
      : null

  const isSmallMaze = rows <= smallMazeMaxDim && cols <= smallMazeMaxDim
  let chunkCols = isSmallMaze ? 1 : Math.max(1, Math.ceil(cols / maxChunkCells))
  let chunkRows = isSmallMaze ? 1 : Math.max(1, Math.ceil(rows / maxChunkCells))
  if (!isSmallMaze && maxChunksPerAxis !== null) {
    chunkCols = Math.min(chunkCols, maxChunksPerAxis)
    chunkRows = Math.min(chunkRows, maxChunksPerAxis)
  }
  const totalChunks = chunkCols * chunkRows
  const isChunked = totalChunks > 1

  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5
  const totalWidth = cols * CELL_SIZE
  const totalDepth = rows * CELL_SIZE

  const colRanges = splitCoordinateRanges(cols, chunkCols, originX, CELL_SIZE).map(
    (r) => ({
      cx: r.chunkCoord,
      startCol: r.startCell,
      endCol: r.endCell,
      cellCount: r.cellCount,
      minX: r.min,
      maxX: r.max,
      centerX: r.center,
      width: r.size,
    })
  )
  const rowRanges = splitCoordinateRanges(rows, chunkRows, originZ, CELL_SIZE).map(
    (r) => ({
      cz: r.chunkCoord,
      startRow: r.startCell,
      endRow: r.endCell,
      cellCount: r.cellCount,
      minZ: r.min,
      maxZ: r.max,
      centerZ: r.center,
      depth: r.size,
    })
  )

  const splitXs = colRanges.slice(0, -1).map((r) => r.maxX)
  const splitZs = rowRanges.slice(0, -1).map((r) => r.maxZ)

  const chunks = []
  for (let cz = 0; cz < chunkRows; cz += 1) {
    const r = rowRanges[cz]
    for (let cx = 0; cx < chunkCols; cx += 1) {
      const c = colRanges[cx]
      chunks.push({
        index: cz * chunkCols + cx,
        cx,
        cz,
        startCol: c.startCol,
        endCol: c.endCol,
        cellCols: c.cellCount,
        startRow: r.startRow,
        endRow: r.endRow,
        cellRows: r.cellCount,
        minX: c.minX,
        maxX: c.maxX,
        minZ: r.minZ,
        maxZ: r.maxZ,
        centerX: c.centerX,
        centerZ: r.centerZ,
        width: c.width,
        depth: r.depth,
      })
    }
  }

  const getChunkCoords = (x, z) => {
    const cx = isChunked ? findSplitBucket(x, splitXs, chunkCols - 1) : 0
    const cz = isChunked ? findSplitBucket(z, splitZs, chunkRows - 1) : 0
    return {
      cx,
      cz,
      index: cz * chunkCols + cx,
    }
  }

  const getChunkIndex = (x, z) => {
    const cx = isChunked ? findSplitBucket(x, splitXs, chunkCols - 1) : 0
    const cz = isChunked ? findSplitBucket(z, splitZs, chunkRows - 1) : 0
    return cz * chunkCols + cx
  }

  return {
    rows,
    cols,
    chunkCols,
    chunkRows,
    totalChunks,
    isChunked,
    smallMazeMaxDim,
    maxChunkCells,
    maxChunksPerAxis,
    minTrianglesToChunk,
    originX,
    originZ,
    totalWidth,
    totalDepth,
    colRanges,
    rowRanges,
    splitXs,
    splitZs,
    chunks,
    getChunkCoords,
    getChunkIndex,
  }
}

/**
 * Splits an axis-aligned box `{ cx, cy, cz, sx, sy, sz, ... }` along chunk split planes
 * so long spans (such as concrete ceiling girders) never bloat adjacent chunk bounds.
 * Rotated boxes are assigned cleanly by midpoint without altering geometry.
 */
export function splitAxisAlignedBoxToChunks(box, layout) {
  if (!box || !layout || !layout.isChunked) {
    return [{ chunkIndex: 0, item: box }]
  }
  if ((box.rx || 0) !== 0 || (box.ry || 0) !== 0 || (box.rz || 0) !== 0) {
    return [{ chunkIndex: layout.getChunkIndex(box.cx, box.cz), item: box }]
  }

  const minX = box.cx - box.sx * 0.5
  const maxX = box.cx + box.sx * 0.5
  const minZ = box.cz - box.sz * 0.5
  const maxZ = box.cz + box.sz * 0.5

  const xSegs = sliceIntervalBySplits(minX, maxX, layout.splitXs)
  const zSegs = sliceIntervalBySplits(minZ, maxZ, layout.splitZs)

  if (xSegs.length === 1 && zSegs.length === 1) {
    return [{ chunkIndex: layout.getChunkIndex(box.cx, box.cz), item: box }]
  }

  const out = []
  const baseCull = box.cullFaces || 0
  for (let zi = 0; zi < zSegs.length; zi += 1) {
    const [z0, z1] = zSegs[zi]
    const cz = (z0 + z1) * 0.5
    const sz = z1 - z0
    for (let xi = 0; xi < xSegs.length; xi += 1) {
      const [x0, x1] = xSegs[xi]
      const cx = (x0 + x1) * 0.5
      const sx = x1 - x0
      if (sx <= 1e-5 || sz <= 1e-5) continue
      let pieceCull = baseCull
      if (pieceCull !== 0) {
        if (xi > 0) pieceCull &= ~FACE_NEG_X
        if (xi < xSegs.length - 1) pieceCull &= ~FACE_POS_X
        if (zi > 0) pieceCull &= ~FACE_NEG_Z
        if (zi < zSegs.length - 1) pieceCull &= ~FACE_POS_Z
      }
      out.push({
        chunkIndex: layout.getChunkIndex(cx, cz),
        item: {
          ...box,
          cx,
          cz,
          sx,
          sz,
          ...(baseCull !== 0 ? { cullFaces: pieceCull } : null),
        },
      })
    }
  }

  return out.length > 0
    ? out
    : [{ chunkIndex: layout.getChunkIndex(box.cx, box.cz), item: box }]
}

/**
 * Buckets items into per-chunk arrays using a coordinate accessor `(item) => [x, z]`.
 */
export function bucketItemsByChunk(items, getCoord, layout) {
  const buckets = Array.from({ length: layout.totalChunks }, () => [])
  if (!Array.isArray(items) || items.length === 0) {
    return buckets
  }
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const coord = getCoord(item)
    const idx = layout.getChunkIndex(coord[0], coord[1])
    buckets[idx].push(item)
  }
  return buckets
}

export function getGeometryTriangleCount(geometry) {
  if (!geometry) return 0
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3)
  }
  return Math.floor((geometry.attributes?.position?.count || 0) / 3)
}

/**
 * Determines whether a spatially extensive layer should be chunked.
 * Allows smaller geometry layers that still span multiple chunks to be culled
 * while avoiding splitting degenerate single-chunk layers.
 */
export function shouldChunkLayer({
  layout,
  triangleCount = 0,
  occupiedChunks = 0,
  minTrianglesForSpatialChunk = 90,
  forceWhenMultiChunk = false,
} = {}) {
  if (!layout?.isChunked || occupiedChunks <= 1) {
    return false
  }
  if (forceWhenMultiChunk) {
    return true
  }
  return triangleCount >= minTrianglesForSpatialChunk
}

/**
 * Builds either a single `THREE.Mesh` (when unchunked or effectively 1 chunk)
 * or a `THREE.Group` named `layerName` containing spatially chunked child meshes
 * sharing `material` with tight world-space bounding boxes/spheres and frustum culling enabled.
 */
export function buildChunkedLayerNode({
  layerName,
  chunkEntries = [],
  material,
  castShadow = false,
  receiveShadow = true,
  frustumCulled = true,
  layout,
} = {}) {
  const validEntries = chunkEntries.filter((entry) => entry && entry.geometry)
  if (validEntries.length === 0) {
    return null
  }

  if (!layout?.isChunked || validEntries.length === 1) {
    const entry = validEntries[0]
    entry.geometry.computeBoundingBox()
    entry.geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(entry.geometry, material)
    mesh.name = layerName
    if (entry.position) {
      mesh.position.copy(entry.position)
    }
    mesh.castShadow = Boolean(castShadow)
    mesh.receiveShadow = Boolean(receiveShadow)
    mesh.frustumCulled = Boolean(frustumCulled)
    mesh.userData = {
      layerName,
      isSpatialChunk: false,
    }
    return mesh
  }

  const group = new THREE.Group()
  group.name = layerName
  group.userData = {
    isSpatialChunkGroup: true,
    layerName,
    chunkCols: layout.chunkCols,
    chunkRows: layout.chunkRows,
    chunkCount: validEntries.length,
  }

  for (let i = 0; i < validEntries.length; i += 1) {
    const entry = validEntries[i]
    const chunkMeta = layout.chunks[entry.chunkIndex] || {
      index: entry.chunkIndex,
      cx: i,
      cz: 0,
      minX: null,
      maxX: null,
      minZ: null,
      maxZ: null,
    }
    entry.geometry.computeBoundingBox()
    entry.geometry.computeBoundingSphere()

    const mesh = new THREE.Mesh(entry.geometry, material)
    mesh.name = `${layerName}-chunk-${chunkMeta.cx}-${chunkMeta.cz}`
    if (entry.position) {
      mesh.position.copy(entry.position)
    }
    mesh.castShadow = Boolean(castShadow)
    mesh.receiveShadow = Boolean(receiveShadow)
    mesh.frustumCulled = Boolean(frustumCulled)
    mesh.userData = {
      isSpatialChunk: true,
      layerName,
      chunkIndex: chunkMeta.index,
      chunkX: chunkMeta.cx,
      chunkZ: chunkMeta.cz,
      chunkBounds: {
        minX: chunkMeta.minX,
        maxX: chunkMeta.maxX,
        minZ: chunkMeta.minZ,
        maxZ: chunkMeta.maxZ,
      },
    }
    group.add(mesh)
  }

  return group
}

const _defaultInstanceColor = new THREE.Color(0xffffff)

/**
 * Builds either a single `THREE.InstancedMesh` (when unchunked or only 1 chunk
 * has instances) or a `THREE.Group` containing per-chunk `THREE.InstancedMesh`es
 * sharing `geometry` and `material` with tight per-chunk bounding spheres.
 * Records `userData.instanceTargets[sourceIndex] = { mesh, meshIndex, localIndex }`
 * so animated/dynamic per-instance colors remain directly addressable.
 */
export function buildChunkedInstancedLayerNode({
  layerName,
  chunkBuckets = [],
  geometry,
  material,
  castShadow = false,
  receiveShadow = true,
  frustumCulled = true,
  layout,
  trackColors = false,
  extraUserData = null,
} = {}) {
  const validBuckets = []
  let totalCount = 0
  for (let i = 0; i < chunkBuckets.length; i += 1) {
    const bucket = chunkBuckets[i]
    if (bucket && Array.isArray(bucket.items) && bucket.items.length > 0) {
      validBuckets.push(bucket)
      totalCount += bucket.items.length
    }
  }
  if (validBuckets.length === 0 || !geometry || !material) {
    return null
  }

  const targets = new Array(totalCount)

  if (!layout?.isChunked || validBuckets.length === 1) {
    const bucket = validBuckets[0]
    const items = bucket.items
    const mesh = new THREE.InstancedMesh(geometry, material, items.length)
    mesh.name = layerName
    mesh.castShadow = Boolean(castShadow)
    mesh.receiveShadow = Boolean(receiveShadow)
    mesh.frustumCulled = Boolean(frustumCulled)

    let wroteColor = false
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      mesh.setMatrixAt(i, item.matrix)
      if (item.color || trackColors) {
        mesh.setColorAt(i, item.color || _defaultInstanceColor)
        wroteColor = true
      }
      const srcIdx = item.sourceIndex ?? i
      targets[srcIdx] = { mesh, meshIndex: 0, localIndex: i }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (wroteColor && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()

    mesh.userData = {
      ...(extraUserData || {}),
      layerName,
      isSpatialChunk: false,
      instanceCount: items.length,
      instanceTargets: targets,
    }
    return mesh
  }

  const group = new THREE.Group()
  group.name = layerName
  const chunkMeshes = []

  let runningIndex = 0
  for (let mIdx = 0; mIdx < validBuckets.length; mIdx += 1) {
    const bucket = validBuckets[mIdx]
    const items = bucket.items
    const chunkMeta = layout.chunks[bucket.chunkIndex] || {
      index: bucket.chunkIndex,
      cx: mIdx,
      cz: 0,
      minX: null,
      maxX: null,
      minZ: null,
      maxZ: null,
    }

    const mesh = new THREE.InstancedMesh(geometry, material, items.length)
    mesh.name = `${layerName}-chunk-${chunkMeta.cx}-${chunkMeta.cz}`
    mesh.castShadow = Boolean(castShadow)
    mesh.receiveShadow = Boolean(receiveShadow)
    mesh.frustumCulled = Boolean(frustumCulled)

    let wroteColor = false
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      mesh.setMatrixAt(i, item.matrix)
      if (item.color || trackColors) {
        mesh.setColorAt(i, item.color || _defaultInstanceColor)
        wroteColor = true
      }
      const srcIdx = item.sourceIndex ?? runningIndex
      runningIndex += 1
      targets[srcIdx] = { mesh, meshIndex: mIdx, localIndex: i }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (wroteColor && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()

    mesh.userData = {
      ...(extraUserData || {}),
      isSpatialChunk: true,
      layerName,
      chunkIndex: chunkMeta.index,
      chunkX: chunkMeta.cx,
      chunkZ: chunkMeta.cz,
      instanceCount: items.length,
      chunkBounds: {
        minX: chunkMeta.minX,
        maxX: chunkMeta.maxX,
        minZ: chunkMeta.minZ,
        maxZ: chunkMeta.maxZ,
      },
    }
    group.add(mesh)
    chunkMeshes.push(mesh)
  }

  group.userData = {
    ...(extraUserData || {}),
    isSpatialChunkGroup: true,
    layerName,
    chunkCols: layout.chunkCols,
    chunkRows: layout.chunkRows,
    chunkCount: chunkMeshes.length,
    instanceCount: totalCount,
    instanceTargets: targets,
    chunkMeshes,
  }

  return group
}

/**
 * Returns all leaf Mesh / InstancedMesh instances belonging to a layer node
 * (supporting both monolithic meshes and chunked `Group` containers).
 */
export function getLayerMeshes(target) {
  if (!target) return []
  if (target.isMesh || target.isInstancedMesh) {
    return [target]
  }
  const meshes = []
  if (typeof target.traverse === 'function') {
    target.traverse((node) => {
      if (node !== target && (node.isMesh || node.isInstancedMesh)) {
        meshes.push(node)
      }
    })
  } else if (Array.isArray(target.children)) {
    for (let i = 0; i < target.children.length; i += 1) {
      const child = target.children[i]
      if (child.isMesh || child.isInstancedMesh) {
        meshes.push(child)
      }
    }
  }
  return meshes
}
