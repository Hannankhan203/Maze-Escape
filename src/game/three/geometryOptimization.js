import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Face bitmask flags matching local box axes
export const FACE_TOP = 1 // +Y
export const FACE_BOT = 2 // -Y
export const FACE_POS_Z = 4 // +Z
export const FACE_NEG_Z = 8 // -Z
export const FACE_POS_X = 16 // +X
export const FACE_NEG_X = 32 // -X
export const FACE_ALL =
  FACE_TOP | FACE_BOT | FACE_POS_Z | FACE_NEG_Z | FACE_POS_X | FACE_NEG_X

/**
 * Returns how many faces remain unculled (0..6) for a given `cullFaces` bitmask.
 */
export function countKeptFaces(cullFaces = 0) {
  let mask = FACE_ALL & ~cullFaces
  let count = 0
  while (mask) {
    count += mask & 1
    mask >>= 1
  }
  return count
}

/**
 * Counts exact post-cull triangles (2 per kept face) across an array of box specs.
 */
export function countKeptBoxTriangles(boxes) {
  if (!Array.isArray(boxes) || boxes.length === 0) return 0
  let faces = 0
  for (let i = 0; i < boxes.length; i += 1) {
    faces += countKeptFaces(boxes[i]?.cullFaces || 0)
  }
  return faces * 2
}

/**
 * Computes conservative world-space AABB for an axis-aligned or intrinsic-XYZ rotated box spec
 * `{ cx, cy, cz, sx, sy, sz, rx?, ry?, rz? }`.
 */
export function computeBoxBounds(b) {
  const hx = b.sx * 0.5
  const hy = b.sy * 0.5
  const hz = b.sz * 0.5
  const rx = b.rx || 0
  const ry = b.ry || 0
  const rz = b.rz || 0

  if (rx === 0 && ry === 0 && rz === 0) {
    return {
      minX: b.cx - hx,
      maxX: b.cx + hx,
      minY: b.cy - hy,
      maxY: b.cy + hy,
      minZ: b.cz - hz,
      maxZ: b.cz + hz,
    }
  }

  const ax = Math.cos(rx), bx = Math.sin(rx)
  const ay = Math.cos(ry), by = Math.sin(ry)
  const az = Math.cos(rz), bz = Math.sin(rz)
  const ae = ax * az
  const af = ax * bz
  const be = bx * az
  const bf = bx * bz

  const m00 = ay * az, m01 = -ay * bz, m02 = by
  const m10 = af + be * by, m11 = ae - bf * by, m12 = -bx * ay
  const m20 = bf - ae * by, m21 = be + af * by, m22 = ax * ay

  const ex = Math.abs(m00) * hx + Math.abs(m01) * hy + Math.abs(m02) * hz
  const ey = Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz
  const ez = Math.abs(m20) * hx + Math.abs(m21) * hy + Math.abs(m22) * hz

  return {
    minX: b.cx - ex,
    maxX: b.cx + ex,
    minY: b.cy - ey,
    maxY: b.cy + ey,
    minZ: b.cz - ez,
    maxZ: b.cz + ez,
  }
}

/**
 * Builds an indexed BufferGeometry from axis-aligned or rotated box specs while
 * omitting any face flagged in `box.cullFaces`.
 *
 * Modes:
 * - `worldTileUVs: true`: axis-aligned world planar UVs + directional concrete shading
 *   (`shade * 1.02` top, `shade * 0.94` soffit, `shade` Z sides, `shade * 0.97` X sides).
 * - `worldTileUVs: false`: local box-dimension UVs + standard face contrast (`[0.88, 0.94, 1, 1, 0.96, 0.96]`)
 *   multiplied by per-box RGB tints (`r, g, b`), supporting intrinsic-XYZ orientation (`rx, ry, rz`).
 *
 * Stores exact per-box AABBs on `geometry.userData.boxBounds` when `storeBoxBounds` is true
 * so downstream obstacle clearance tests remain exact even when faces are culled.
 */
export function buildMergedBoxesWithCulling(
  boxes,
  {
    tileUnits = 1.6,
    worldTileUVs = false,
    storeBoxBounds = true,
    includeVertexColors = true,
  } = {}
) {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return null
  }

  let keptFaceCount = 0
  for (let i = 0; i < boxes.length; i += 1) {
    keptFaceCount += countKeptFaces(boxes[i]?.cullFaces || 0)
  }
  if (keptFaceCount === 0) {
    return null
  }

  const vertCount = keptFaceCount * 4
  const idxCount = keptFaceCount * 6

  const positions = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const colors = includeVertexColors ? new Float32Array(vertCount * 3) : null
  const indices =
    vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount)

  let vCursor = 0
  let iCursor = 0
  const invTile = 1 / tileUnits

  for (let bIdx = 0; bIdx < boxes.length; bIdx += 1) {
    const b = boxes[bIdx]
    const cull = b.cullFaces || 0
    if ((cull & FACE_ALL) === FACE_ALL) continue

    const hx = b.sx * 0.5
    const hy = b.sy * 0.5
    const hz = b.sz * 0.5
    const cx = b.cx
    const cy = b.cy
    const cz = b.cz

    const rx = worldTileUVs ? 0 : b.rx || 0
    const ry = worldTileUVs ? 0 : b.ry || 0
    const rz = worldTileUVs ? 0 : b.rz || 0

    let m00 = 1, m01 = 0, m02 = 0
    let m10 = 0, m11 = 1, m12 = 0
    let m20 = 0, m21 = 0, m22 = 1

    const rotated = rx !== 0 || ry !== 0 || rz !== 0
    if (rotated) {
      const ax = Math.cos(rx), bx = Math.sin(rx)
      const ay = Math.cos(ry), by = Math.sin(ry)
      const az = Math.cos(rz), bz = Math.sin(rz)
      const ae = ax * az
      const af = ax * bz
      const be = bx * az
      const bf = bx * bz

      m00 = ay * az
      m01 = -ay * bz
      m02 = by

      m10 = af + be * by
      m11 = ae - bf * by
      m12 = -bx * ay

      m20 = bf - ae * by
      m21 = be + af * by
      m22 = ax * ay
    }

    const cr = worldTileUVs ? (b.shade ?? 1.0) : (b.r ?? 1.0)
    const cg = worldTileUVs ? (b.shade ?? 1.0) : (b.g ?? 1.0)
    const cb = worldTileUVs ? (b.shade ?? 1.0) : (b.b ?? 1.0)

    const writeQuad = (
      x0, y0, z0, u0, v0,
      x1, y1, z1, u1, v1,
      x2, y2, z2, u2, v2,
      x3, y3, z3, u3, v3,
      lnx, lny, lnz,
      shade
    ) => {
      const base = vCursor
      const nx = rotated ? m00 * lnx + m01 * lny + m02 * lnz : lnx
      const ny = rotated ? m10 * lnx + m11 * lny + m12 * lnz : lny
      const nz = rotated ? m20 * lnx + m21 * lny + m22 * lnz : lnz

      const pts = [
        [x0, y0, z0, u0, v0],
        [x1, y1, z1, u1, v1],
        [x2, y2, z2, u2, v2],
        [x3, y3, z3, u3, v3],
      ]
      const fr = cr * shade
      const fg = cg * shade
      const fb = cb * shade

      for (let k = 0; k < 4; k += 1) {
        const lx = pts[k][0]
        const ly = pts[k][1]
        const lz = pts[k][2]
        const p = (base + k) * 3
        const up = (base + k) * 2
        if (rotated) {
          positions[p] = cx + m00 * lx + m01 * ly + m02 * lz
          positions[p + 1] = cy + m10 * lx + m11 * ly + m12 * lz
          positions[p + 2] = cz + m20 * lx + m21 * ly + m22 * lz
        } else {
          positions[p] = cx + lx
          positions[p + 1] = cy + ly
          positions[p + 2] = cz + lz
        }
        normals[p] = nx
        normals[p + 1] = ny
        normals[p + 2] = nz
        if (colors) {
          colors[p] = fr
          colors[p + 1] = fg
          colors[p + 2] = fb
        }
        uvs[up] = pts[k][3]
        uvs[up + 1] = pts[k][4]
      }

      indices[iCursor] = base
      indices[iCursor + 1] = base + 1
      indices[iCursor + 2] = base + 2
      indices[iCursor + 3] = base
      indices[iCursor + 4] = base + 2
      indices[iCursor + 5] = base + 3
      vCursor += 4
      iCursor += 6
    }

    if (worldTileUVs) {
      const uX0 = (cx - hx) * invTile
      const uX1 = (cx + hx) * invTile
      const uZ0 = (cz - hz) * invTile
      const uZ1 = (cz + hz) * invTile
      const vY0 = (cy - hy) * invTile
      const vY1 = (cy + hy) * invTile

      if (!(cull & FACE_TOP)) {
        writeQuad(
          -hx, hy, hz, uX0, uZ1,
          hx, hy, hz, uX1, uZ1,
          hx, hy, -hz, uX1, uZ0,
          -hx, hy, -hz, uX0, uZ0,
          0, 1, 0,
          1.02
        )
      }
      if (!(cull & FACE_BOT)) {
        writeQuad(
          -hx, -hy, -hz, uX0, uZ0,
          hx, -hy, -hz, uX1, uZ0,
          hx, -hy, hz, uX1, uZ1,
          -hx, -hy, hz, uX0, uZ1,
          0, -1, 0,
          0.94
        )
      }
      if (!(cull & FACE_POS_Z)) {
        writeQuad(
          -hx, -hy, hz, uX0, vY0,
          hx, -hy, hz, uX1, vY0,
          hx, hy, hz, uX1, vY1,
          -hx, hy, hz, uX0, vY1,
          0, 0, 1,
          1.0
        )
      }
      if (!(cull & FACE_NEG_Z)) {
        writeQuad(
          hx, -hy, -hz, uX1, vY0,
          -hx, -hy, -hz, uX0, vY0,
          -hx, hy, -hz, uX0, vY1,
          hx, hy, -hz, uX1, vY1,
          0, 0, -1,
          1.0
        )
      }
      if (!(cull & FACE_POS_X)) {
        writeQuad(
          hx, -hy, hz, uZ1, vY0,
          hx, -hy, -hz, uZ0, vY0,
          hx, hy, -hz, uZ0, vY1,
          hx, hy, hz, uZ1, vY1,
          1, 0, 0,
          0.97
        )
      }
      if (!(cull & FACE_NEG_X)) {
        writeQuad(
          -hx, -hy, -hz, uZ0, vY0,
          -hx, -hy, hz, uZ1, vY0,
          -hx, hy, hz, uZ1, vY1,
          -hx, hy, -hz, uZ0, vY1,
          -1, 0, 0,
          0.97
        )
      }
    } else {
      const sxT = b.sx * invTile
      const syT = b.sy * invTile
      const szT = b.sz * invTile

      if (!(cull & FACE_TOP)) {
        writeQuad(
          -hx, hy, hz, 0, szT,
          hx, hy, hz, sxT, szT,
          hx, hy, -hz, sxT, 0,
          -hx, hy, -hz, 0, 0,
          0, 1, 0,
          0.88
        )
      }
      if (!(cull & FACE_BOT)) {
        writeQuad(
          -hx, -hy, -hz, 0, 0,
          hx, -hy, -hz, sxT, 0,
          hx, -hy, hz, sxT, szT,
          -hx, -hy, hz, 0, szT,
          0, -1, 0,
          0.94
        )
      }
      if (!(cull & FACE_POS_Z)) {
        writeQuad(
          -hx, -hy, hz, 0, 0,
          hx, -hy, hz, sxT, 0,
          hx, hy, hz, sxT, syT,
          -hx, hy, hz, 0, syT,
          0, 0, 1,
          1.0
        )
      }
      if (!(cull & FACE_NEG_Z)) {
        writeQuad(
          hx, -hy, -hz, sxT, 0,
          -hx, -hy, -hz, 0, 0,
          -hx, hy, -hz, 0, syT,
          hx, hy, -hz, sxT, syT,
          0, 0, -1,
          1.0
        )
      }
      if (!(cull & FACE_POS_X)) {
        writeQuad(
          hx, -hy, hz, szT, 0,
          hx, -hy, -hz, 0, 0,
          hx, hy, -hz, 0, syT,
          hx, hy, hz, szT, syT,
          1, 0, 0,
          0.96
        )
      }
      if (!(cull & FACE_NEG_X)) {
        writeQuad(
          -hx, -hy, -hz, 0, 0,
          -hx, -hy, hz, szT, 0,
          -hx, hy, hz, szT, syT,
          -hx, hy, -hz, 0, syT,
          -1, 0, 0,
          0.96
        )
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  if (colors) {
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  if (storeBoxBounds) {
    geometry.userData.boxBounds = boxes.map(computeBoxBounds)
  }

  return geometry
}

/**
 * Builds an optimized indexed floor slab geometry preserving the full `(segX + 1) x (segZ + 1)`
 * subdivided top (+Y) grid required for per-vertex wall-contact AO & world macro shading,
 * while collapsing the hidden underside (-Y) to a single quad, simplifying perimeter skirts
 * to single quads, and skipping interior chunk-seam side faces via `skipFaces`.
 */
function subtractCutoutsFromFloorRect(baseRect, cutouts) {
  let rects = [baseRect]
  for (let c = 0; c < cutouts.length; c += 1) {
    const cut = cutouts[c]
    const next = []
    for (let i = 0; i < rects.length; i += 1) {
      const r = rects[i]
      const ox0 = Math.max(r.x0, cut.x0)
      const ox1 = Math.min(r.x1, cut.x1)
      const oz0 = Math.max(r.z0, cut.z0)
      const oz1 = Math.min(r.z1, cut.z1)
      if (ox1 - ox0 <= 1e-4 || oz1 - oz0 <= 1e-4) {
        next.push(r)
        continue
      }
      if (ox0 - r.x0 > 1e-4) {
        next.push({ x0: r.x0, x1: ox0, z0: r.z0, z1: r.z1 })
      }
      if (r.x1 - ox1 > 1e-4) {
        next.push({ x0: ox1, x1: r.x1, z0: r.z0, z1: r.z1 })
      }
      if (oz0 - r.z0 > 1e-4) {
        next.push({ x0: ox0, x1: ox1, z0: r.z0, z1: oz0 })
      }
      if (r.z1 - oz1 > 1e-4) {
        next.push({ x0: ox0, x1: ox1, z0: oz1, z1: r.z1 })
      }
    }
    rects = next
    if (rects.length === 0) break
  }
  return rects
}

export function buildOptimizedFloorGeometry({
  width,
  depth,
  thickness,
  segX,
  segZ,
  skipFaces = 0,
  cutouts = null,
  offsetX = 0,
  offsetZ = 0,
}) {
  const hw = width * 0.5
  const hd = depth * 0.5
  const ht = thickness * 0.5

  const cols = Math.max(1, Math.floor(segX))
  const rows = Math.max(1, Math.floor(segZ))
  const rowStride = cols + 1
  const topVertCount = rowStride * (rows + 1)

  const localCutouts = []
  if (Array.isArray(cutouts) && cutouts.length > 0) {
    for (let i = 0; i < cutouts.length; i += 1) {
      const cut = cutouts[i]
      if (!cut) continue
      const x0 = cut.minX - offsetX
      const x1 = cut.maxX - offsetX
      const z0 = cut.minZ - offsetZ
      const z1 = cut.maxZ - offsetZ
      if (x1 > -hw + 1e-4 && x0 < hw - 1e-4 && z1 > -hd + 1e-4 && z0 < hd - 1e-4) {
        localCutouts.push({
          x0: Math.max(-hw, x0),
          x1: Math.min(hw, x1),
          z0: Math.max(-hd, z0),
          z1: Math.min(hd, z1),
        })
      }
    }
  }

  let cutCellQuads = null
  let topFullCells = cols * rows
  let topCutQuads = 0

  if (localCutouts.length > 0) {
    cutCellQuads = new Map()
    topFullCells = 0
    for (let iz = 0; iz < rows; iz += 1) {
      const cz0 = -hd + (iz / rows) * depth
      const cz1 = -hd + ((iz + 1) / rows) * depth
      for (let ix = 0; ix < cols; ix += 1) {
        const cx0 = -hw + (ix / cols) * width
        const cx1 = -hw + ((ix + 1) / cols) * width
        const overlapping = []
        for (let c = 0; c < localCutouts.length; c += 1) {
          const cut = localCutouts[c]
          if (
            cut.x1 > cx0 + 1e-4 &&
            cut.x0 < cx1 - 1e-4 &&
            cut.z1 > cz0 + 1e-4 &&
            cut.z0 < cz1 - 1e-4
          ) {
            overlapping.push(cut)
          }
        }
        if (overlapping.length === 0) {
          topFullCells += 1
        } else if (overlapping.length === 1) {
          const cut = overlapping[0]
          let ox0 = Math.max(cx0, cut.x0)
          let ox1 = Math.min(cx1, cut.x1)
          let oz0 = Math.max(cz0, cut.z0)
          let oz1 = Math.min(cz1, cut.z1)
          if (ox0 - cx0 <= 1e-4) ox0 = cx0
          if (cx1 - ox1 <= 1e-4) ox1 = cx1
          if (oz0 - cz0 <= 1e-4) oz0 = cz0
          if (cz1 - oz1 <= 1e-4) oz1 = cz1
          const quads = []
          if (ox1 > ox0 + 1e-4 && oz1 > oz0 + 1e-4) {
            if (oz0 > cz0) {
              quads.push([
                [cx0, cz0],
                [ox0, oz0],
                [ox1, oz0],
                [cx1, cz0],
              ])
            }
            if (cz1 > oz1) {
              quads.push([
                [ox0, oz1],
                [cx0, cz1],
                [cx1, cz1],
                [ox1, oz1],
              ])
            }
            if (ox0 > cx0) {
              quads.push([
                [cx0, cz0],
                [cx0, cz1],
                [ox0, oz1],
                [ox0, oz0],
              ])
            }
            if (cx1 > ox1) {
              quads.push([
                [ox1, oz0],
                [ox1, oz1],
                [cx1, cz1],
                [cx1, cz0],
              ])
            }
          } else {
            quads.push([
              [cx0, cz0],
              [cx0, cz1],
              [cx1, cz1],
              [cx1, cz0],
            ])
          }
          cutCellQuads.set(iz * cols + ix, quads)
          topCutQuads += quads.length
        } else {
          const strips = subtractCutoutsFromFloorRect(
            { x0: cx0, x1: cx1, z0: cz0, z1: cz1 },
            overlapping
          )
          const quads = strips.map((st) => [
            [st.x0, st.z0],
            [st.x0, st.z1],
            [st.x1, st.z1],
            [st.x1, st.z0],
          ])
          cutCellQuads.set(iz * cols + ix, quads)
          topCutQuads += quads.length
        }
      }
    }
  }

  const sideFlags = [
    FACE_BOT,
    FACE_POS_Z,
    FACE_NEG_Z,
    FACE_POS_X,
    FACE_NEG_X,
  ]
  let extraQuads = 0
  for (let i = 0; i < sideFlags.length; i += 1) {
    if (!(skipFaces & sideFlags[i])) {
      extraQuads += 1
    }
  }

  const vertCount = topVertCount + (topCutQuads + extraQuads) * 4
  const idxCount = (topFullCells * 2 + (topCutQuads + extraQuads) * 2) * 3

  const positions = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const indices =
    vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount)

  // 1. Subdivided top (+Y) grid matching BoxGeometry vertex coordinates
  let vCursor = 0
  for (let iz = 0; iz <= rows; iz += 1) {
    const z = -hd + (iz / rows) * depth
    const vCoord = 1 - iz / rows
    for (let ix = 0; ix <= cols; ix += 1) {
      const x = -hw + (ix / cols) * width
      const p = vCursor * 3
      const up = vCursor * 2
      positions[p] = x
      positions[p + 1] = ht
      positions[p + 2] = z
      normals[p] = 0
      normals[p + 1] = 1
      normals[p + 2] = 0
      uvs[up] = ix / cols
      uvs[up + 1] = vCoord
      vCursor += 1
    }
  }

  let iCursor = 0
  const pushQuad = (pts, nx, ny, nz) => {
    const base = vCursor
    for (let k = 0; k < 4; k += 1) {
      const p = vCursor * 3
      const up = vCursor * 2
      positions[p] = pts[k][0]
      positions[p + 1] = pts[k][1]
      positions[p + 2] = pts[k][2]
      normals[p] = nx
      normals[p + 1] = ny
      normals[p + 2] = nz
      uvs[up] = pts[k][3]
      uvs[up + 1] = pts[k][4]
      vCursor += 1
    }
    indices[iCursor] = base
    indices[iCursor + 1] = base + 1
    indices[iCursor + 2] = base + 2
    indices[iCursor + 3] = base
    indices[iCursor + 4] = base + 2
    indices[iCursor + 5] = base + 3
    iCursor += 6
  }

  for (let iz = 0; iz < rows; iz += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      const quads = cutCellQuads ? cutCellQuads.get(iz * cols + ix) : null
      if (!quads) {
        const a = ix + iz * rowStride
        const b = a + 1
        const c = a + rowStride
        const d = b + rowStride
        indices[iCursor] = a
        indices[iCursor + 1] = c
        indices[iCursor + 2] = b
        indices[iCursor + 3] = c
        indices[iCursor + 4] = d
        indices[iCursor + 5] = b
        iCursor += 6
      } else {
        for (let q = 0; q < quads.length; q += 1) {
          const pts = quads[q]
          pushQuad(
            [
              [pts[0][0], ht, pts[0][1], (pts[0][0] + hw) / width, 1 - (pts[0][1] + hd) / depth],
              [pts[1][0], ht, pts[1][1], (pts[1][0] + hw) / width, 1 - (pts[1][1] + hd) / depth],
              [pts[2][0], ht, pts[2][1], (pts[2][0] + hw) / width, 1 - (pts[2][1] + hd) / depth],
              [pts[3][0], ht, pts[3][1], (pts[3][0] + hw) / width, 1 - (pts[3][1] + hd) / depth],
            ],
            0,
            1,
            0
          )
        }
      }
    }
  }


  // 2. Single underside (-Y) quad
  if (!(skipFaces & FACE_BOT)) {
    pushQuad(
      [
        [-hw, -ht, -hd, 0, 1],
        [hw, -ht, -hd, 1, 1],
        [hw, -ht, hd, 1, 0],
        [-hw, -ht, hd, 0, 0],
      ],
      0,
      -1,
      0
    )
  }

  // 3. Outer perimeter skirts (1 quad per active exposed edge)
  if (!(skipFaces & FACE_POS_Z)) {
    pushQuad(
      [
        [-hw, -ht, hd, 0, 0],
        [hw, -ht, hd, 1, 0],
        [hw, ht, hd, 1, 1],
        [-hw, ht, hd, 0, 1],
      ],
      0,
      0,
      1
    )
  }
  if (!(skipFaces & FACE_NEG_Z)) {
    pushQuad(
      [
        [hw, -ht, -hd, 1, 0],
        [-hw, -ht, -hd, 0, 0],
        [-hw, ht, -hd, 0, 1],
        [hw, ht, -hd, 1, 1],
      ],
      0,
      0,
      -1
    )
  }
  if (!(skipFaces & FACE_POS_X)) {
    pushQuad(
      [
        [hw, -ht, hd, 1, 0],
        [hw, -ht, -hd, 0, 0],
        [hw, ht, -hd, 0, 1],
        [hw, ht, hd, 1, 1],
      ],
      1,
      0,
      0
    )
  }
  if (!(skipFaces & FACE_NEG_X)) {
    pushQuad(
      [
        [-hw, -ht, -hd, 0, 0],
        [-hw, -ht, hd, 1, 0],
        [-hw, ht, hd, 1, 1],
        [-hw, ht, -hd, 0, 1],
      ],
      -1,
      0,
      0
    )
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Merges multiple BufferGeometries while preserving index buffers (avoiding
 * `.toNonIndexed()` vertex duplication across indexed primitives and curved tubes).
 * Harmonizes core attributes (`position`, `normal`, `uv`, and optional `color` when
 * shared by all inputs) and strips unnecessary `tangent` attributes.
 */
export function mergeIndexedGeometries(
  geometries,
  { stripTangent = true } = {}
) {
  if (!Array.isArray(geometries) || geometries.length === 0) {
    return null
  }

  const validInputs = geometries.filter(
    (g) => g && g.attributes?.position && g.attributes.position.count >= 3
  )
  if (validInputs.length === 0) {
    return null
  }

  const keepColors = validInputs.every((g) => Boolean(g.attributes.color))
  const prepared = []

  try {
    for (let i = 0; i < validInputs.length; i += 1) {
      const geo = validInputs[i].clone()
      if (stripTangent && geo.attributes.tangent) {
        geo.deleteAttribute('tangent')
      }
      if (!geo.attributes.normal) {
        geo.computeVertexNormals()
      }
      if (!geo.attributes.uv) {
        const vCount = geo.attributes.position.count
        geo.setAttribute(
          'uv',
          new THREE.BufferAttribute(new Float32Array(vCount * 2), 2)
        )
      }
      if (!keepColors && geo.attributes.color) {
        geo.deleteAttribute('color')
      }
      if (!geo.index) {
        const vCount = geo.attributes.position.count
        const seq = vCount > 65535 ? new Uint32Array(vCount) : new Uint16Array(vCount)
        for (let k = 0; k < vCount; k += 1) {
          seq[k] = k
        }
        geo.setIndex(new THREE.BufferAttribute(seq, 1))
      }
      prepared.push(geo)
    }

    const merged = mergeGeometries(prepared, false)
    if (merged) {
      merged.computeBoundingBox()
      merged.computeBoundingSphere()
    }
    return merged || null
  } finally {
    for (let i = 0; i < prepared.length; i += 1) {
      prepared[i]?.dispose?.()
    }
  }
}
