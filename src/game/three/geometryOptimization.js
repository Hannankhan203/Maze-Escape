import * as THREE from 'three'

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
  { tileUnits = 1.6, worldTileUVs = false, storeBoxBounds = true } = {}
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
  const colors = new Float32Array(vertCount * 3)
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
        colors[p] = fr
        colors[p + 1] = fg
        colors[p + 2] = fb
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
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
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
export function buildOptimizedFloorGeometry({
  width,
  depth,
  thickness,
  segX,
  segZ,
  skipFaces = 0,
}) {
  const hw = width * 0.5
  const hd = depth * 0.5
  const ht = thickness * 0.5

  const cols = Math.max(1, Math.floor(segX))
  const rows = Math.max(1, Math.floor(segZ))
  const rowStride = cols + 1
  const topVertCount = rowStride * (rows + 1)
  const topTriCount = cols * rows * 2

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

  const vertCount = topVertCount + extraQuads * 4
  const idxCount = (topTriCount + extraQuads * 2) * 3

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
  for (let iz = 0; iz < rows; iz += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
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
    }
  }

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
