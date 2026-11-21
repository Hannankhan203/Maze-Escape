import * as THREE from 'three'
import { createRng } from '../../utils/rng.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { getGalvanizedMetalTextureSet } from './buildCeilingVents.js'
import {
  bucketItemsByChunk,
  buildChunkedLayerNode,
  createMazeChunkLayout,
  shouldChunkLayer,
} from './spatialChunking.js'
import {
  FACE_ALL,
  FACE_BOT,
  FACE_NEG_X,
  FACE_NEG_Z,
  FACE_POS_X,
  FACE_POS_Z,
  FACE_TOP,
  computeBoxBounds,
  countKeptBoxTriangles,
  countKeptFaces,
} from './geometryOptimization.js'

export const CEILING_ELECTRICAL_CLEARANCE_MIN_Y = 3.05

export const CEILING_ELECTRICAL_CONDITIONS = [
  'intact',
  'aged',
  'damaged',
]

export const CEILING_ELECTRICAL_PALETTE = {
  conduitSteel: 0x4c5868, // Aged galvanized EMT conduit & ladder tray steel
  hardwareIron: 0x2b3440, // Dark oxidized cast junction boxes, clamps & Unistrut
  cableJacket: 0x8e96a0, // Multi-color vertex-modulated insulated wire jackets
}

/**
 * Extracts exact world-space box AABBs from a merged-box BufferGeometry
 * (24 vertices per box, as built by buildMazeCeiling / buildCeilingVents / buildCeilingLights)
 * or from an InstancedMesh built on a 1x1x1 unit box.
 */
function extractObstacleBoundsFromObject(obj, kind, outList) {
  if (!obj) return

  if (
    !obj.isMesh &&
    !obj.isInstancedMesh &&
    Array.isArray(obj.children) &&
    obj.children.length > 0
  ) {
    for (let i = 0; i < obj.children.length; i += 1) {
      extractObstacleBoundsFromObject(obj.children[i], kind, outList)
    }
    return
  }

  if (obj.isInstancedMesh && obj.geometry) {
    obj.geometry.computeBoundingBox()
    const baseBox = obj.geometry.boundingBox
    if (!baseBox) return
    const mat = new THREE.Matrix4()
    const tmpBox = new THREE.Box3()
    for (let i = 0; i < obj.count; i += 1) {
      obj.getMatrixAt(i, mat)
      tmpBox.copy(baseBox).applyMatrix4(mat)
      outList.push({
        minX: tmpBox.min.x,
        maxX: tmpBox.max.x,
        minY: tmpBox.min.y,
        maxY: tmpBox.max.y,
        minZ: tmpBox.min.z,
        maxZ: tmpBox.max.z,
        kind,
      })
    }
    return
  }

  const cachedBounds = obj.geometry?.userData?.boxBounds
  if (Array.isArray(cachedBounds)) {
    for (let i = 0; i < cachedBounds.length; i += 1) {
      const b = cachedBounds[i]
      outList.push({
        minX: b.minX,
        maxX: b.maxX,
        minY: b.minY,
        maxY: b.maxY,
        minZ: b.minZ,
        maxZ: b.maxZ,
        kind,
      })
    }
    return
  }

  const pos = obj.geometry?.attributes?.position
  if (!pos || pos.count < 24) return

  const stride = 24
  for (let start = 0; start + stride <= pos.count; start += stride) {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let k = 0; k < stride; k += 1) {
      const idx = start + k
      const vx = pos.getX(idx)
      const vy = pos.getY(idx)
      const vz = pos.getZ(idx)
      if (vx < minX) minX = vx
      if (vx > maxX) maxX = vx
      if (vy < minY) minY = vy
      if (vy > maxY) maxY = vy
      if (vz < minZ) minZ = vz
      if (vz > maxZ) maxZ = vz
    }
    outList.push({ minX, maxX, minY, maxY, minZ, maxZ, kind })
  }
}

/**
 * Builds an indexed BufferGeometry from box specs `{ cx, cy, cz, sx, sy, sz, rx?, ry?, rz?, r?, g?, b?, cullFaces? }`
 * combined with tubular segment specs `{ p0, p1, radius, sides, r, g, b, capStart?, capEnd? }`.
 */
function buildMergedElectricalGeometry({ boxes = [], tubes = [], tileUnits = 1.6 }) {
  const boxCount = boxes.length
  const tubeCount = tubes.length
  if (boxCount === 0 && tubeCount === 0) {
    return null
  }

  let keptFaceCount = 0
  for (let i = 0; i < boxCount; i += 1) {
    keptFaceCount += countKeptFaces(boxes[i]?.cullFaces || 0)
  }
  if (keptFaceCount === 0 && tubeCount === 0) {
    return null
  }

  let vertCount = keptFaceCount * 4
  let idxCount = keptFaceCount * 6
  for (let i = 0; i < tubeCount; i += 1) {
    const t = tubes[i]
    const sides = t.sides || 8
    vertCount += (sides + 1) * 2
    idxCount += sides * 6
    if (t.capStart) {
      vertCount += sides + 1
      idxCount += sides * 3
    }
    if (t.capEnd) {
      vertCount += sides + 1
      idxCount += sides * 3
    }
  }

  const positions = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const colors = new Float32Array(vertCount * 3)
  const indices =
    vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount)

  let vCursor = 0
  let iCursor = 0
  const invTile = 1 / tileUnits

  // 1. Write box primitives
  for (let bIdx = 0; bIdx < boxCount; bIdx += 1) {
    const b = boxes[bIdx]
    const cull = b.cullFaces || 0
    if ((cull & FACE_ALL) === FACE_ALL) continue
    const hx = b.sx * 0.5
    const hy = b.sy * 0.5
    const hz = b.sz * 0.5
    const cx = b.cx
    const cy = b.cy
    const cz = b.cz
    const rx = b.rx || 0
    const ry = b.ry || 0
    const rz = b.rz || 0

    const cr = b.r ?? 1
    const cg = b.g ?? 1
    const cb = b.b ?? 1

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

    const sxT = b.sx * invTile
    const syT = b.sy * invTile
    const szT = b.sz * invTile

    if (!(cull & FACE_TOP)) {
      writeQuad(-hx, hy, hz, 0, szT, hx, hy, hz, sxT, szT, hx, hy, -hz, sxT, 0, -hx, hy, -hz, 0, 0, 0, 1, 0, 0.88)
    }
    if (!(cull & FACE_BOT)) {
      writeQuad(-hx, -hy, -hz, 0, 0, hx, -hy, -hz, sxT, 0, hx, -hy, hz, sxT, szT, -hx, -hy, hz, 0, szT, 0, -1, 0, 0.94)
    }
    if (!(cull & FACE_POS_Z)) {
      writeQuad(-hx, -hy, hz, 0, 0, hx, -hy, hz, sxT, 0, hx, hy, hz, sxT, syT, -hx, hy, hz, 0, syT, 0, 0, 1, 1.0)
    }
    if (!(cull & FACE_NEG_Z)) {
      writeQuad(hx, -hy, -hz, sxT, 0, -hx, -hy, -hz, 0, 0, -hx, hy, -hz, 0, syT, hx, hy, -hz, sxT, syT, 0, 0, -1, 1.0)
    }
    if (!(cull & FACE_POS_X)) {
      writeQuad(hx, -hy, hz, szT, 0, hx, -hy, -hz, 0, 0, hx, hy, -hz, 0, syT, hx, hy, hz, szT, syT, 1, 0, 0, 0.96)
    }
    if (!(cull & FACE_NEG_X)) {
      writeQuad(-hx, -hy, -hz, 0, 0, -hx, -hy, hz, szT, 0, -hx, hy, hz, szT, syT, -hx, hy, -hz, 0, syT, -1, 0, 0, 0.96)
    }
  }

  // 2. Write cylindrical conduit / cable tube segments
  for (let tIdx = 0; tIdx < tubeCount; tIdx += 1) {
    const t = tubes[tIdx]
    const [x0, y0, z0] = t.p0
    const [x1, y1, z1] = t.p1
    const dx = x1 - x0
    const dy = y1 - y0
    const dz = z1 - z0
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-4) continue

    const tx = dx / len
    const ty = dy / len
    const tz = dz / len

    // Choose non-collinear reference vector for stable orthonormal frame
    const refX = Math.abs(ty) < 0.9 ? 0 : 1
    const refY = Math.abs(ty) < 0.9 ? 1 : 0
    const refZ = 0

    // N = normalize(cross(T, ref))
    let nx = ty * refZ - tz * refY
    let ny = tz * refX - tx * refZ
    let nz = tx * refY - ty * refX
    const nLen = Math.hypot(nx, ny, nz) || 1
    nx /= nLen
    ny /= nLen
    nz /= nLen

    // B = cross(T, N)
    const bx = ty * nz - tz * ny
    const by = tz * nx - tx * nz
    const bz = tx * ny - ty * nx

    const sides = t.sides || 8
    const rad = t.radius
    const cr = t.r ?? 1
    const cg = t.g ?? 1
    const cb = t.b ?? 1
    const lenU = len * invTile

    const ringBase = vCursor
    for (let ring = 0; ring < 2; ring += 1) {
      const px = ring === 0 ? x0 : x1
      const py = ring === 0 ? y0 : y1
      const pz = ring === 0 ? z0 : z1
      const uVal = ring === 0 ? 0 : lenU

      for (let s = 0; s <= sides; s += 1) {
        const theta = (s / sides) * Math.PI * 2
        const c = Math.cos(theta)
        const si = Math.sin(theta)
        const rnx = nx * c + bx * si
        const rny = ny * c + by * si
        const rnz = nz * c + bz * si

        const shade = 0.9 + 0.1 * rny
        const p = vCursor * 3
        const up = vCursor * 2

        positions[p] = px + rnx * rad
        positions[p + 1] = py + rny * rad
        positions[p + 2] = pz + rnz * rad
        normals[p] = rnx
        normals[p + 1] = rny
        normals[p + 2] = rnz
        colors[p] = cr * shade
        colors[p + 1] = cg * shade
        colors[p + 2] = cb * shade
        uvs[up] = uVal
        uvs[up + 1] = s / sides
        vCursor += 1
      }
    }

    const ringStride = sides + 1
    for (let s = 0; s < sides; s += 1) {
      const a = ringBase + s
      const b = ringBase + ringStride + s
      const c = ringBase + ringStride + s + 1
      const d = ringBase + s + 1
      indices[iCursor] = a
      indices[iCursor + 1] = b
      indices[iCursor + 2] = c
      indices[iCursor + 3] = a
      indices[iCursor + 4] = c
      indices[iCursor + 5] = d
      iCursor += 6
    }

    if (t.capStart) {
      const capCenter = vCursor
      const cp = capCenter * 3
      const cup = capCenter * 2
      positions[cp] = x0
      positions[cp + 1] = y0
      positions[cp + 2] = z0
      normals[cp] = -tx
      normals[cp + 1] = -ty
      normals[cp + 2] = -tz
      colors[cp] = cr * 0.85
      colors[cp + 1] = cg * 0.85
      colors[cp + 2] = cb * 0.85
      uvs[cup] = 0.5
      uvs[cup + 1] = 0.5
      vCursor += 1

      const rimBase = vCursor
      for (let s = 0; s < sides; s += 1) {
        const theta = (s / sides) * Math.PI * 2
        const c = Math.cos(theta)
        const si = Math.sin(theta)
        const rnx = nx * c + bx * si
        const rny = ny * c + by * si
        const rnz = nz * c + bz * si
        const p = vCursor * 3
        const up = vCursor * 2
        positions[p] = x0 + rnx * rad
        positions[p + 1] = y0 + rny * rad
        positions[p + 2] = z0 + rnz * rad
        normals[p] = -tx
        normals[p + 1] = -ty
        normals[p + 2] = -tz
        colors[p] = cr * 0.85
        colors[p + 1] = cg * 0.85
        colors[p + 2] = cb * 0.85
        uvs[up] = 0.5 + 0.5 * c
        uvs[up + 1] = 0.5 + 0.5 * si
        vCursor += 1
      }
      for (let s = 0; s < sides; s += 1) {
        indices[iCursor] = capCenter
        indices[iCursor + 1] = rimBase + ((s + 1) % sides)
        indices[iCursor + 2] = rimBase + s
        iCursor += 3
      }
    }

    if (t.capEnd) {
      const capCenter = vCursor
      const cp = capCenter * 3
      const cup = capCenter * 2
      positions[cp] = x1
      positions[cp + 1] = y1
      positions[cp + 2] = z1
      normals[cp] = tx
      normals[cp + 1] = ty
      normals[cp + 2] = tz
      colors[cp] = cr * 0.85
      colors[cp + 1] = cg * 0.85
      colors[cp + 2] = cb * 0.85
      uvs[cup] = 0.5
      uvs[cup + 1] = 0.5
      vCursor += 1

      const rimBase = vCursor
      for (let s = 0; s < sides; s += 1) {
        const theta = (s / sides) * Math.PI * 2
        const c = Math.cos(theta)
        const si = Math.sin(theta)
        const rnx = nx * c + bx * si
        const rny = ny * c + by * si
        const rnz = nz * c + bz * si
        const p = vCursor * 3
        const up = vCursor * 2
        positions[p] = x1 + rnx * rad
        positions[p + 1] = y1 + rny * rad
        positions[p + 2] = z1 + rnz * rad
        normals[p] = tx
        normals[p + 1] = ty
        normals[p + 2] = tz
        colors[p] = cr * 0.85
        colors[p + 1] = cg * 0.85
        colors[p + 2] = cb * 0.85
        uvs[up] = 0.5 + 0.5 * c
        uvs[up + 1] = 0.5 + 0.5 * si
        vCursor += 1
      }
      for (let s = 0; s < sides; s += 1) {
        indices[iCursor] = capCenter
        indices[iCursor + 1] = rimBase + s
        indices[iCursor + 2] = rimBase + ((s + 1) % sides)
        iCursor += 3
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vCursor * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, vCursor * 3), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs.subarray(0, vCursor * 2), 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, vCursor * 3), 3))
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, iCursor), 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  if (boxes.length > 0) {
    geometry.userData.boxBounds = boxes.map(computeBoxBounds)
  }
  return geometry
}

/**
 * Builds industrial electrical conduits, couplings, elbow bends, junction boxes,
 * perforated ladder cable trays with bundled cables, equipment/light connections,
 * and subtle restrained deterioration (localized rust, askew covers, limited exposed
 * wiring sagging safely above >= 3.05m) integrated cleanly into existing ceiling bays.
 */
export function buildCeilingElectrical(
  maze,
  {
    soffitY = 3.6,
    beamBottomY = 3.04,
    beamWidth = 0.78,
    ribBottomY = 3.38,
    ribWidth = 0.42,
    worldSeed = 0,
    ceilingGroup = null,
    ceilingVentsGroup = null,
    ceilingLightsGroup = null,
    qualityPreset = 'high',
  } = {}
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return null
  }
  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) {
    return null
  }

  const topLeft = gridToWorld(0, 0, maze)
  const bottomRight = gridToWorld(rows - 1, cols - 1, maze)
  if (!topLeft || !bottomRight) {
    return null
  }

  const seed =
    ((Number(worldSeed) || 0) * 1103515245 + rows * 193 + cols * 419 + 9311) >>> 0
  const rng = createRng(seed)

  const floorWidth = cols * CELL_SIZE
  const floorDepth = rows * CELL_SIZE

  const centerX = (topLeft.x + bottomRight.x) * 0.5
  const centerZ = (topLeft.z + bottomRight.z) * 0.5
  const innerSpanX = floorWidth - 0.7
  const innerSpanZ = floorDepth - 0.7
  const innerMinX = centerX - innerSpanX * 0.5 + 0.02
  const innerMaxX = centerX + innerSpanX * 0.5 - 0.02
  const innerMinZ = centerZ - innerSpanZ * 0.5 + 0.02
  const innerMaxZ = centerZ + innerSpanZ * 0.5 - 0.02

  const beamHalf = beamWidth * 0.5 // 0.39m
  const ribHalf = ribWidth * 0.5 // 0.21m

  const evenRowZs = []
  for (let r = 2; r <= rows - 3; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (wp) evenRowZs.push(wp.z)
  }
  const evenColXs = []
  for (let c = 2; c <= cols - 3; c += 2) {
    const wp = gridToWorld(0, c, maze)
    if (wp) evenColXs.push(wp.x)
  }
  const oddRowZs = []
  for (let r = 1; r <= rows - 2; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (wp) oddRowZs.push(wp.z)
  }

  const xBaySpans = []
  {
    let cur = innerMinX
    for (let i = 0; i < evenColXs.length; i += 1) {
      xBaySpans.push([cur, evenColXs[i] - beamHalf])
      cur = evenColXs[i] + beamHalf
    }
    xBaySpans.push([cur, innerMaxX])
  }

  // Exact world AABBs of existing ceiling beams, drop panels, ribs, vents, ducts & light fixtures
  const obstacleBounds = []
  if (ceilingGroup?.userData?.beamsMesh) {
    extractObstacleBoundsFromObject(ceilingGroup.userData.beamsMesh, 'beam', obstacleBounds)
  }
  if (ceilingGroup?.userData?.beamDetailsMesh) {
    extractObstacleBoundsFromObject(ceilingGroup.userData.beamDetailsMesh, 'beam', obstacleBounds)
  }
  if (ceilingVentsGroup?.userData) {
    extractObstacleBoundsFromObject(ceilingVentsGroup.userData.ductMesh, 'vent', obstacleBounds)
    extractObstacleBoundsFromObject(ceilingVentsGroup.userData.ductHardwareMesh, 'vent', obstacleBounds)
    extractObstacleBoundsFromObject(ceilingVentsGroup.userData.ventCavityMesh, 'vent', obstacleBounds)
  }
  if (ceilingLightsGroup?.userData) {
    extractObstacleBoundsFromObject(ceilingLightsGroup.userData.housingMesh, 'light', obstacleBounds)
    extractObstacleBoundsFromObject(ceilingLightsGroup.userData.diffuserMesh, 'light', obstacleBounds)
  }

  const isAABBBlocked = (minX, maxX, minY, maxY, minZ, maxZ, pad = 0.012) => {
    if (
      minY < CEILING_ELECTRICAL_CLEARANCE_MIN_Y ||
      maxY > soffitY + 0.002 ||
      minX < innerMinX - 0.01 ||
      maxX > innerMaxX + 0.01 ||
      minZ < innerMinZ - 0.01 ||
      maxZ > innerMaxZ + 0.01
    ) {
      return true
    }

    // Double-check mathematical concrete girder/rib bounds even if ceilingGroup was passed partially
    for (let i = 0; i < evenRowZs.length; i += 1) {
      if (maxY > beamBottomY - 0.005 && maxZ > evenRowZs[i] - beamHalf - pad && minZ < evenRowZs[i] + beamHalf + pad) {
        return true
      }
    }
    for (let i = 0; i < evenColXs.length; i += 1) {
      if (maxY > beamBottomY - 0.005 && maxX > evenColXs[i] - beamHalf - pad && minX < evenColXs[i] + beamHalf + pad) {
        return true
      }
    }
    for (let i = 0; i < oddRowZs.length; i += 1) {
      if (maxY > ribBottomY - 0.005 && maxZ > oddRowZs[i] - ribHalf - pad && minZ < oddRowZs[i] + ribHalf + pad) {
        return true
      }
    }

    for (let i = 0; i < obstacleBounds.length; i += 1) {
      const ob = obstacleBounds[i]
      if (
        maxX > ob.minX - pad &&
        minX < ob.maxX + pad &&
        maxY > ob.minY - pad &&
        minY < ob.maxY + pad &&
        maxZ > ob.minZ - pad &&
        minZ < ob.maxZ + pad
      ) {
        return true
      }
    }
    return false
  }

  const isBoxSpecClear = (box, pad = 0.01) => {
    const b = computeBoxBounds(box)
    return !isAABBBlocked(b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ, pad)
  }

  const isTubeSegmentClear = (p0, p1, radius, pad = 0.01) => {
    const minX = Math.min(p0[0], p1[0]) - radius
    const maxX = Math.max(p0[0], p1[0]) + radius
    const minY = Math.min(p0[1], p1[1]) - radius
    const maxY = Math.max(p0[1], p1[1]) + radius
    const minZ = Math.min(p0[2], p1[2]) - radius
    const maxZ = Math.max(p0[2], p1[2]) + radius
    return !isAABBBlocked(minX, maxX, minY, maxY, minZ, maxZ, pad)
  }

  const conduitBoxes = []
  const conduitTubes = []
  const hardwareBoxes = []
  const cableTubes = []
  const cableBoxes = []

  const electricalMetadata = []
  let conduitRunCount = 0
  let cableTrayCount = 0
  let junctionBoxCount = 0
  let intactCount = 0
  let agedCount = 0
  let damagedCount = 0
  let connectedLightCount = 0
  let connectedVentCount = 0
  let exposedWireLoopCount = 0

  const trackCondition = (cond) => {
    if (cond === 'damaged') damagedCount += 1
    else if (cond === 'aged') agedCount += 1
    else intactCount += 1
  }

  const addHardwareBoxSafe = (box, pad = 0.004) => {
    if (!isBoxSpecClear(box, pad)) return false
    hardwareBoxes.push(box)
    return true
  }

  const addConduitBoxSafe = (box, pad = 0.004) => {
    if (!isBoxSpecClear(box, pad)) return false
    conduitBoxes.push(box)
    return true
  }

  const addConduitTubeSafe = (tube, pad = 0.004) => {
    if (!isTubeSegmentClear(tube.p0, tube.p1, tube.radius, pad)) return false
    conduitTubes.push(tube)
    return true
  }

  const addCableTubeSafe = (tube, pad = 0.004) => {
    if (!isTubeSegmentClear(tube.p0, tube.p1, tube.radius, pad)) return false
    cableTubes.push(tube)
    return true
  }

  const maxWireLoops = Math.max(3, Math.min(20, Math.round((rows + cols) * 0.34)))

  /**
   * Emits a multi-segment sagging exposed insulated wire bundle between pA and pB,
   * strictly clamped >= CEILING_ELECTRICAL_CLEARANCE_MIN_Y + 0.01m.
   */
  const emitExposedWireBundle = (pA, pB, sagDepth, wireCount = 3) => {
    if (exposedWireLoopCount >= maxWireLoops) return
    const safeSag = Math.max(0.06, Math.min(0.22, sagDepth))
    const segments = 5
    const palette = [
      [0.18, 0.21, 0.26], // Charcoal rubber
      [0.52, 0.27, 0.21], // Oxidized red-brown jacket
      [0.64, 0.56, 0.32], // Faded industrial ochre wire
    ]

    let addedAny = false
    for (let w = 0; w < wireCount; w += 1) {
      const col = palette[w % palette.length]
      const lat = (w - (wireCount - 1) * 0.5) * 0.016
      const wSag = safeSag * (0.86 + w * 0.14)
      const rad = 0.0075

      const pts = []
      for (let s = 0; s <= segments; s += 1) {
        const u = s / segments
        const arch = 4 * u * (1 - u)
        const wx = pA[0] + (pB[0] - pA[0]) * u + lat * arch * 0.65
        const wz = pA[2] + (pB[2] - pA[2]) * u + lat * arch
        const wy = Math.max(
          CEILING_ELECTRICAL_CLEARANCE_MIN_Y + rad + 0.01,
          pA[1] + (pB[1] - pA[1]) * u - wSag * arch
        )
        pts.push([wx, wy, wz])
      }

      for (let s = 0; s < segments; s += 1) {
        if (
          addCableTubeSafe(
            {
              p0: pts[s],
              p1: pts[s + 1],
              radius: rad,
              sides: 4,
              r: col[0],
              g: col[1],
              b: col[2],
              capStart: false,
              capEnd: false,
            },
            0.003
          )
        ) {
          addedAny = true
        }
      }
    }
    if (addedAny) {
      exposedWireLoopCount += 1
    }
  }

  /**
   * Emits a detailed multi-part NEMA junction box assembly mounted flush under ceiling soffit,
   * supporting intact, aged (rusted/faded paint), and damaged (askew cover + exposed wires) states.
   */
  const emitJunctionBox = ({ cx, cz, topY = soffitY - 0.003, size = 0.19, height = 0.075, condition = 'intact', kind = 'junction_box' }) => {
    const bodyCy = topY - height * 0.5
    const baseBox = {
      cx,
      cy: bodyCy,
      cz,
      sx: size,
      sy: height,
      sz: size,
      r: condition === 'aged' ? 0.96 : condition === 'damaged' ? 0.92 : 0.88,
      g: condition === 'aged' ? 0.82 : condition === 'damaged' ? 0.78 : 0.89,
      b: condition === 'aged' ? 0.72 : condition === 'damaged' ? 0.71 : 0.91,
      cullFaces: FACE_TOP | (condition !== 'damaged' ? FACE_BOT : 0),
    }
    if (!addHardwareBoxSafe(baseBox, 0.006)) {
      return null
    }

    // Mounting flange ears anchored tight to soffit
    addHardwareBoxSafe(
      {
        cx,
        cy: topY - 0.01,
        cz,
        sx: size + 0.055,
        sy: 0.016,
        sz: size * 0.54,
        r: 0.78,
        g: 0.78,
        b: 0.8,
        cullFaces: FACE_TOP,
      },
      0.002
    )

    // Bottom cover plate (intact/aged sealed; damaged tilted askew on 1 corner bolt + exposed wire loop)
    const coverY = topY - height - 0.008
    if (condition === 'damaged') {
      const skewRy = (rng() < 0.5 ? 1 : -1) * (0.22 + rng() * 0.14)
      const tiltRz = (rng() < 0.5 ? 1 : -1) * (0.14 + rng() * 0.1)
      addHardwareBoxSafe(
        {
          cx: cx + 0.025,
          cy: coverY - 0.018,
          cz: cz + 0.02,
          sx: size + 0.014,
          sy: 0.014,
          sz: size + 0.014,
          ry: skewRy,
          rz: tiltRz,
          r: 0.96,
          g: 0.75,
          b: 0.64,
        },
        0.002
      )
      if (rng() < 0.55) {
        emitExposedWireBundle(
          [cx - size * 0.25, coverY, cz - size * 0.18],
          [cx + size * 0.24, coverY - 0.005, cz + size * 0.22],
          0.11 + rng() * 0.05,
          2
        )
      }
    } else {
      const paintBadge = condition === 'aged' && rng() < 0.55
      addHardwareBoxSafe(
        {
          cx,
          cy: coverY,
          cz,
          sx: size + 0.014,
          sy: 0.014,
          sz: size + 0.014,
          r: paintBadge ? 0.95 : 0.84,
          g: paintBadge ? 0.86 : 0.85,
          b: paintBadge ? 0.64 : 0.87,
          cullFaces: FACE_TOP,
        },
        0.002
      )
    }

    junctionBoxCount += 1
    trackCondition(condition)
    const bounds = computeBoxBounds(baseBox)
    electricalMetadata.push({
      kind,
      condition,
      cx,
      cz,
      minY: coverY - 0.02,
      maxY: topY,
      bounds,
    })

    return {
      cx,
      cz,
      bodyCy,
      topY,
      bottomY: coverY,
      halfSize: size * 0.5,
    }
  }

  /**
   * Emits a straight X or Z EMT conduit segment with couplings, mounting Unistrut clamps,
   * and optional damaged split-pipe gap with restrained sagging exposed wiring.
   */
  const emitConduitSpan = ({
    axis, // 'x' | 'z'
    start,
    end,
    fixedCoord,
    yCenter,
    radius = 0.018,
    supportTopY = soffitY - 0.002,
    condition = 'intact',
    allowSplitDamage = false,
    capStart = false,
    capEnd = false,
  }) => {
    const len = end - start
    if (len < 0.22) return false

    const tint =
      condition === 'aged'
        ? [0.95, 0.84, 0.76]
        : condition === 'damaged'
          ? [0.92, 0.78, 0.7]
          : [0.92, 0.93, 0.96]

    const emitSegmentWithStraps = (
      segA,
      segB,
      tilt = 0,
      segCapStart = capStart,
      segCapEnd = capEnd
    ) => {
      const segLen = segB - segA
      if (segLen < 0.14) return false

      const p0 =
        axis === 'x'
          ? [segA, yCenter, fixedCoord]
          : [fixedCoord, yCenter, segA]
      const p1 =
        axis === 'x'
          ? [segB, yCenter - tilt, fixedCoord]
          : [fixedCoord, yCenter - tilt, segB]

      if (
        !addConduitTubeSafe(
          {
            p0,
            p1,
            radius,
            sides: 6,
            r: tint[0],
            g: tint[1],
            b: tint[2],
            capStart: segCapStart,
            capEnd: segCapEnd,
          },
          0.005
        )
      ) {
        return false
      }

      // Unistrut ceiling mounting straps & threaded couplings along span
      const strapStep = 1.65
      const count = Math.max(1, Math.floor(segLen / strapStep))
      for (let i = 1; i <= count; i += 1) {
        const u = i / (count + 1)
        const posAlong = segA + segLen * u
        const localY = yCenter - tilt * u
        const clampH = Math.max(0.02, supportTopY - (localY - radius - 0.006))
        const clampCy = supportTopY - clampH * 0.5
        const isLoose = condition !== 'intact' && rng() < 0.28
        const strapTilt = isLoose ? (rng() < 0.5 ? 1 : -1) * (0.08 + rng() * 0.08) : 0

        if (axis === 'x') {
          addHardwareBoxSafe(
            {
              cx: posAlong,
              cy: clampCy,
              cz: fixedCoord,
              sx: 0.036,
              sy: clampH,
              sz: radius * 2 + 0.036,
              rx: strapTilt,
              r: 0.82,
              g: 0.8,
              b: 0.79,
              cullFaces: FACE_TOP,
            },
            0.002
          )
        } else {
          addHardwareBoxSafe(
            {
              cx: fixedCoord,
              cy: clampCy,
              cz: posAlong,
              sx: radius * 2 + 0.036,
              sy: clampH,
              sz: 0.036,
              rz: strapTilt,
              r: 0.82,
              g: 0.8,
              b: 0.79,
              cullFaces: FACE_TOP,
            },
            0.002
          )
        }

        // Conduit compression coupling collar every second strap (sleeves over continuous pipe)
        if (i % 2 === 1 && segLen > 1.35) {
          const c0 =
            axis === 'x'
              ? [posAlong - 0.03, localY, fixedCoord]
              : [fixedCoord, localY, posAlong - 0.03]
          const c1 =
            axis === 'x'
              ? [posAlong + 0.03, localY, fixedCoord]
              : [fixedCoord, localY, posAlong + 0.03]
          addConduitTubeSafe(
            {
              p0: c0,
              p1: c1,
              radius: radius + 0.0065,
              sides: 6,
              r: 0.86,
              g: 0.84,
              b: 0.82,
              capStart: false,
              capEnd: false,
            },
            0.003
          )
        }
      }
      return true
    }

    if (condition === 'damaged' && allowSplitDamage && len > 1.45) {
      const gapCenter = start + len * (0.42 + rng() * 0.18)
      const gapHalf = 0.22
      const leftEnd = gapCenter - gapHalf
      const rightStart = gapCenter + gapHalf

      const okL = emitSegmentWithStraps(start, leftEnd, 0.035, capStart, false)
      const okR = emitSegmentWithStraps(rightStart, end, 0, false, capEnd)
      if (okL && okR) {
        // Damaged fractured end bushing rings capping open split-pipe ends (only outward gap-facing cap emitted)
        const bL0 =
          axis === 'x'
            ? [leftEnd - 0.034, yCenter - 0.035, fixedCoord]
            : [fixedCoord, yCenter - 0.035, leftEnd - 0.034]
        const bL1 =
          axis === 'x'
            ? [leftEnd + 0.002, yCenter - 0.035, fixedCoord]
            : [fixedCoord, yCenter - 0.035, leftEnd + 0.002]
        addConduitTubeSafe(
          {
            p0: bL0,
            p1: bL1,
            radius: radius + 0.008,
            sides: 6,
            r: 0.72,
            g: 0.62,
            b: 0.55,
            capStart: false,
            capEnd: true,
          },
          0.002
        )
        const bR0 =
          axis === 'x'
            ? [rightStart - 0.002, yCenter, fixedCoord]
            : [fixedCoord, yCenter, rightStart - 0.002]
        const bR1 =
          axis === 'x'
            ? [rightStart + 0.034, yCenter, fixedCoord]
            : [fixedCoord, yCenter, rightStart + 0.034]
        addConduitTubeSafe(
          {
            p0: bR0,
            p1: bR1,
            radius: radius + 0.008,
            sides: 6,
            r: 0.72,
            g: 0.62,
            b: 0.55,
            capStart: true,
            capEnd: false,
          },
          0.002
        )

        const pL =
          axis === 'x'
            ? [leftEnd - 0.02, yCenter - 0.035, fixedCoord]
            : [fixedCoord, yCenter - 0.035, leftEnd - 0.02]
        const pR =
          axis === 'x'
            ? [rightStart + 0.02, yCenter, fixedCoord]
            : [fixedCoord, yCenter, rightStart + 0.02]
        emitExposedWireBundle(pL, pR, 0.14 + rng() * 0.06, 3)
        conduitRunCount += 1
        trackCondition('damaged')
        electricalMetadata.push({
          kind: 'conduit_run_damaged',
          condition: 'damaged',
          axis,
          minY: yCenter - 0.22,
          maxY: yCenter + radius,
        })
        return true
      }
    }

    const ok = emitSegmentWithStraps(start, end, 0)
    if (ok) {
      conduitRunCount += 1
      trackCondition(condition)
      electricalMetadata.push({
        kind: 'conduit_run',
        condition,
        axis,
        minY: yCenter - radius,
        maxY: yCenter + radius,
      })
    }
    return ok
  }

  /**
   * Routes a connected orthogonal L-path conduit in the X/Z soffit plane from (xA, zA)
   * to (xB, zB) using straight pipe segments + a rounded 3-segment 90-degree elbow bend.
   */
  const routeOrthogonalConduit = (xA, zA, xB, zB, yCenter, radius, condition, supportTopY = soffitY - 0.002) => {
    const dx = xB - xA
    const dz = zB - zA
    const dist = Math.hypot(dx, dz)
    if (dist < 0.08) return false

    const tint =
      condition === 'aged'
        ? [0.95, 0.84, 0.76]
        : condition === 'damaged'
          ? [0.92, 0.78, 0.7]
          : [0.92, 0.93, 0.96]

    if (Math.abs(dx) < 0.09) {
      return emitConduitSpan({
        axis: 'z',
        start: Math.min(zA, zB),
        end: Math.max(zA, zB),
        fixedCoord: xA,
        yCenter,
        radius,
        supportTopY,
        condition,
        capStart: zA < zB,
        capEnd: zB < zA,
      })
    }
    if (Math.abs(dz) < 0.09) {
      return emitConduitSpan({
        axis: 'x',
        start: Math.min(xA, xB),
        end: Math.max(xA, xB),
        fixedCoord: zA,
        yCenter,
        radius,
        supportTopY,
        condition,
        capStart: xA < xB,
        capEnd: xB < xA,
      })
    }

    // L-corner at (xB, zA) with curved 0.10m elbow radius (elbow-facing ends un-capped)
    const rBend = Math.min(0.11, Math.abs(dx) * 0.45, Math.abs(dz) * 0.45)
    const sx = Math.sign(dx)
    const sz = Math.sign(dz)
    const elbowEntryX = xB - sx * rBend
    const elbowExitZ = zA + sz * rBend

    const legX = emitConduitSpan({
      axis: 'x',
      start: Math.min(xA, elbowEntryX),
      end: Math.max(xA, elbowEntryX),
      fixedCoord: zA,
      yCenter,
      radius,
      supportTopY,
      condition,
      capStart: xA < elbowEntryX,
      capEnd: elbowEntryX < xA,
    })
    const legZ = emitConduitSpan({
      axis: 'z',
      start: Math.min(elbowExitZ, zB),
      end: Math.max(elbowExitZ, zB),
      fixedCoord: xB,
      yCenter,
      radius,
      supportTopY,
      condition,
      capStart: false,
      capEnd: false,
    })

    if (!legX || !legZ) return false

    // 3-segment smooth 90-degree conduit sweep elbow
    const bendCenterX = elbowEntryX
    const bendCenterZ = elbowExitZ
    const elbowPts = []
    for (let k = 0; k <= 3; k += 1) {
      const u = k / 3
      const angle = u * (Math.PI * 0.5)
      // Quarter circle from (xB - sx*rBend, zA) to (xB, zA + sz*rBend)
      const px = bendCenterX + sx * Math.sin(angle) * rBend
      const pz = bendCenterZ - sz * Math.cos(angle) * rBend
      elbowPts.push([px, yCenter, pz])
    }
    for (let k = 0; k < 3; k += 1) {
      addConduitTubeSafe(
        {
          p0: elbowPts[k],
          p1: elbowPts[k + 1],
          radius: radius * 1.04,
          sides: 6,
          r: tint[0] * 0.94,
          g: tint[1] * 0.94,
          b: tint[2] * 0.94,
          capStart: false,
          capEnd: false,
        },
        0.003
      )
    }
    return true
  }

  // -------------------------------------------------------------------------
  // 1. Industrial Perforated Cable Trays Along Unobstructed Girder Flanks
  // -------------------------------------------------------------------------
  const ductTrunks = ceilingVentsGroup?.userData?.ductTrunks || []
  const xTrunksByGirderZ = new Map()
  for (let i = 0; i < ductTrunks.length; i += 1) {
    const tr = ductTrunks[i]
    if (typeof tr.girderZ === 'number') {
      xTrunksByGirderZ.set(tr.girderZ, tr)
    }
  }

  const trayWidth = 0.27
  const trayHeight = 0.056
  const trayBottomY = Math.max(CEILING_ELECTRICAL_CLEARANCE_MIN_Y + 0.11, beamBottomY + 0.12) // 3.16m
  const trayTargetCount = evenRowZs.length <= 2 ? 1 : evenRowZs.length <= 4 ? 2 : 3

  for (let t = 0; t < trayTargetCount; t += 1) {
    const gIdx = Math.min(
      evenRowZs.length - 1,
      Math.floor(((t + 0.5) * evenRowZs.length) / trayTargetCount)
    )
    const girderZ = evenRowZs[gIdx]
    const existingXTrunk = xTrunksByGirderZ.get(girderZ)
    // Choose the girder flank free of main HVAC X-trunks
    const traySide = existingXTrunk ? -existingXTrunk.side : t % 2 === 0 ? 1 : -1
    const trayZ = girderZ + traySide * (beamHalf + 0.05 + trayWidth * 0.5) // beamHalf + 0.185 = girderZ ± 0.575m

    for (let b = 0; b < xBaySpans.length; b += 1) {
      const [spanA, spanB] = xBaySpans[b]
      const segStart = spanA + 0.04
      const segEnd = spanB - 0.04
      if (segEnd - segStart < 1.2) continue

      // Split cable tray around any crossing HVAC Z-trunk or vent drop
      const stepScan = 0.22
      const clearIntervals = []
      let runStart = null
      for (let x = segStart; x <= segEnd + 0.01; x += stepScan) {
        const cx = Math.min(x, segEnd)
        const sliceClear = !isAABBBlocked(
          cx - 0.12,
          cx + 0.12,
          trayBottomY - 0.02,
          trayBottomY + trayHeight + 0.03,
          trayZ - trayWidth * 0.5 - 0.02,
          trayZ + trayWidth * 0.5 + 0.02,
          0.01
        )
        if (sliceClear && runStart === null) {
          runStart = Math.max(segStart, cx - 0.1)
        } else if (!sliceClear && runStart !== null) {
          const runEnd = Math.max(runStart, cx - 0.12)
          if (runEnd - runStart >= 0.78) {
            clearIntervals.push([runStart, runEnd])
          }
          runStart = null
        }
      }
      if (runStart !== null) {
        if (segEnd - runStart >= 0.78) {
          clearIntervals.push([runStart, segEnd])
        }
      }

      for (let cIdx = 0; cIdx < clearIntervals.length; cIdx += 1) {
        const [x0, x1] = clearIntervals[cIdx]
        const len = x1 - x0
        const midX = (x0 + x1) * 0.5
        const condRoll = rng()
        const condition =
          condRoll < 0.42 ? 'intact' : condRoll < 0.8 ? 'aged' : 'damaged'
        const railTint =
          condition === 'aged'
            ? [0.95, 0.82, 0.72]
            : condition === 'damaged'
              ? [0.9, 0.76, 0.68]
              : [0.9, 0.92, 0.95]

        // 2 steel U-channel side rails
        const railHalf = trayWidth * 0.5 - 0.014
        const railCy = trayBottomY + trayHeight * 0.5
        const railN = addConduitBoxSafe(
          { cx: midX, cy: railCy, cz: trayZ - railHalf, sx: len, sy: trayHeight, sz: 0.022, r: railTint[0], g: railTint[1], b: railTint[2] },
          0.004
        )
        const railS = addConduitBoxSafe(
          { cx: midX, cy: railCy, cz: trayZ + railHalf, sx: len, sy: trayHeight, sz: 0.022, r: railTint[0], g: railTint[1], b: railTint[2] },
          0.004
        )
        if (!railN && !railS) continue

        // Ladder cross rungs along tray underside
        const rungCount = Math.max(2, Math.floor(len / 0.42))
        for (let rk = 0; rk <= rungCount; rk += 1) {
          const rxPos = x0 + 0.08 + ((len - 0.16) * rk) / rungCount
          addConduitBoxSafe(
            {
              cx: rxPos,
              cy: trayBottomY + 0.01,
              cz: trayZ,
              sx: 0.024,
              sy: 0.016,
              sz: trayWidth - 0.03,
              r: railTint[0] * 0.9,
              g: railTint[1] * 0.9,
              b: railTint[2] * 0.9,
              cullFaces: FACE_POS_Z | FACE_NEG_Z,
            },
            0.002
          )
        }

        // End bulkhead tie-down plates capping both ends of each cable tray span
        addConduitBoxSafe(
          {
            cx: x0 + 0.012,
            cy: railCy,
            cz: trayZ,
            sx: 0.024,
            sy: trayHeight,
            sz: trayWidth - 0.024,
            r: railTint[0] * 0.88,
            g: railTint[1] * 0.88,
            b: railTint[2] * 0.88,
            cullFaces: FACE_POS_Z | FACE_NEG_Z,
          },
          0.003
        )
        addConduitBoxSafe(
          {
            cx: x1 - 0.012,
            cy: railCy,
            cz: trayZ,
            sx: 0.024,
            sy: trayHeight,
            sz: trayWidth - 0.024,
            r: railTint[0] * 0.88,
            g: railTint[1] * 0.88,
            b: railTint[2] * 0.88,
            cullFaces: FACE_POS_Z | FACE_NEG_Z,
          },
          0.003
        )

        // 4 bundled insulated multi-core cables lying inside tray channel
        const cableColors = [
          [0.19, 0.22, 0.27],
          [0.24, 0.28, 0.34],
          [0.44, 0.36, 0.25],
          [0.2, 0.24, 0.29],
        ]
        const cableOffsets = [-0.078, -0.026, 0.026, 0.078]
        for (let k = 0; k < cableOffsets.length; k += 1) {
          const czCable = trayZ + cableOffsets[k]
          const cyCable = trayBottomY + 0.032 + (k % 2) * 0.008
          const cc = cableColors[k]
          addCableTubeSafe(
            {
              p0: [x0 + 0.02, cyCable, czCable],
              p1: [x1 - 0.02, cyCable, czCable],
              radius: 0.016,
              sides: 5,
              r: cc[0],
              g: cc[1],
              b: cc[2],
              capStart: false,
              capEnd: false,
            },
            0.002
          )
        }

        // Nylon cable-bundle tie straps keeping tray conductors organized
        const tieCount = len > 2.2 ? 2 : 1
        for (let tk = 1; tk <= tieCount; tk += 1) {
          const txPos = x0 + (len * tk) / (tieCount + 1)
          addHardwareBoxSafe(
            {
              cx: txPos,
              cy: trayBottomY + 0.036,
              cz: trayZ,
              sx: 0.016,
              sy: 0.044,
              sz: trayWidth - 0.054,
              r: 0.58,
              g: 0.6,
              b: 0.64,
              cullFaces: FACE_POS_Z | FACE_NEG_Z,
            },
            0.002
          )
        }

        // Trapeze cantilever brackets & steel hanger rods supporting tray cleanly
        const hangerCount = Math.max(1, Math.floor(len / 1.85))
        for (let hk = 1; hk <= hangerCount; hk += 1) {
          const hxPos = x0 + (len * hk) / (hangerCount + 1)
          const isLoose = condition === 'damaged' && hk === 1
          const tiltZ = isLoose ? (rng() < 0.5 ? 1 : -1) * 0.09 : 0

          // Under-tray angle cradle
          addHardwareBoxSafe(
            {
              cx: hxPos,
              cy: trayBottomY - 0.014,
              cz: trayZ,
              sx: 0.042,
              sy: 0.022,
              sz: trayWidth + 0.06,
              rz: tiltZ,
              r: 0.82,
              g: 0.8,
              b: 0.78,
            },
            0.002
          )

          // Drop hanger rod from soffit (skip if inside drop panel, use girder side tie instead)
          const rodZ = trayZ + traySide * (trayWidth * 0.5 + 0.02)
          const rodH = soffitY - (trayBottomY + 0.01)
          const rodBox = {
            cx: hxPos,
            cy: trayBottomY + 0.01 + rodH * 0.5,
            cz: rodZ,
            sx: 0.018,
            sy: rodH - 0.01,
            sz: 0.018,
            r: 0.78,
            g: 0.78,
            b: 0.8,
            cullFaces: FACE_TOP | FACE_BOT,
          }
          if (addHardwareBoxSafe(rodBox, 0.002)) {
            // Soffit ceiling anchor plate for trapeze hanger rod
            addHardwareBoxSafe(
              {
                cx: hxPos,
                cy: soffitY - 0.009,
                cz: rodZ,
                sx: 0.052,
                sy: 0.014,
                sz: 0.052,
                r: 0.76,
                g: 0.76,
                b: 0.78,
                cullFaces: FACE_TOP,
              },
              0.002
            )
          } else {
            // Lateral tie back to concrete girder side web
            const webFace = girderZ + traySide * beamHalf
            const sideGap = Math.abs(trayZ - traySide * (trayWidth * 0.5) - webFace)
            if (sideGap > 0.03) {
              addHardwareBoxSafe(
                {
                  cx: hxPos,
                  cy: trayBottomY,
                  cz: webFace + traySide * (sideGap * 0.5),
                  sx: 0.04,
                  sy: 0.028,
                  sz: sideGap - 0.004,
                  r: 0.82,
                  g: 0.8,
                  b: 0.79,
                },
                0.001
              )
            }
          }
        }

        // Occasional subtle slack cable dip on damaged cable tray spans (strictly >= 3.06m)
        if (condition === 'damaged' && len > 1.4) {
          const dipA = midX - 0.28
          const dipB = midX + 0.28
          const sideEdgeZ = trayZ + traySide * (trayWidth * 0.5 - 0.02)
          emitExposedWireBundle(
            [dipA, trayBottomY + 0.03, sideEdgeZ],
            [dipB, trayBottomY + 0.03, sideEdgeZ],
            0.1 + rng() * 0.04,
            2
          )
        }

        cableTrayCount += 1
        trackCondition(condition)
        electricalMetadata.push({
          kind: 'cable_tray',
          condition,
          girderZ,
          minY: trayBottomY - 0.03,
          maxY: trayBottomY + trayHeight,
        })
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Corridor Backbone Conduit Runs Along Concrete Rib Flanks + Damaged Splits
  // -------------------------------------------------------------------------
  const backboneZCoords = []
  for (let i = 0; i < oddRowZs.length; i += 1) {
    // Place conduit backbone along alternating oddRowZ coffer rib flanks
    if (i % 2 === 1 && oddRowZs.length > 2 && rng() < 0.45) continue
    const ribZ = oddRowZs[i]
    const side = i % 2 === 0 ? 1 : -1
    const condZ = ribZ + side * (ribHalf + 0.125) // 0.335m from rib center (keeps 0.20m pull boxes clear of 0.21m rib)
    backboneZCoords.push({ ribZ, condZ, side })

    for (let b = 0; b < xBaySpans.length; b += 1) {
      const [spanA, spanB] = xBaySpans[b]
      const segStart = spanA + 0.04
      const segEnd = spanB - 0.04
      if (segEnd - segStart < 1.1) continue

      const yPipe = soffitY - 0.062 // 3.538m flush under soffit beside concrete rib
      const condRoll = rng()
      const condState =
        condRoll < 0.5 ? 'intact' : condRoll < 0.88 ? 'aged' : 'damaged'

      // Primary 18mm EMT pipe + parallel secondary 15mm pipe spaced 0.055m beside it
      const primaryOk = emitConduitSpan({
        axis: 'x',
        start: segStart,
        end: segEnd,
        fixedCoord: condZ,
        yCenter: yPipe,
        radius: 0.018,
        condition: condState,
        allowSplitDamage: true,
      })

      if (primaryOk) {
        // Girder-face entry gland collars enclosing backbone pipe ends
        addHardwareBoxSafe(
          {
            cx: segStart + 0.014,
            cy: yPipe,
            cz: condZ,
            sx: 0.028,
            sy: 0.052,
            sz: 0.052,
            r: 0.78,
            g: 0.77,
            b: 0.76,
          },
          0.004
        )
        addHardwareBoxSafe(
          {
            cx: segEnd - 0.014,
            cy: yPipe,
            cz: condZ,
            sx: 0.028,
            sy: 0.052,
            sz: 0.052,
            r: 0.78,
            g: 0.77,
            b: 0.76,
          },
          0.004
        )
      }

      if (rng() < 0.65) {
        emitConduitSpan({
          axis: 'x',
          start: segStart + 0.15,
          end: segEnd - 0.15,
          fixedCoord: condZ + side * 0.055,
          yCenter: yPipe,
          radius: 0.015,
          condition: condState === 'damaged' ? 'aged' : condState,
          allowSplitDamage: false,
          capStart: true,
          capEnd: true,
        })
      }

      // Anchor beam sleeve / pull box at bay girder crossing on alternating ends
      if (b > 0 && rng() < 0.55) {
        emitJunctionBox({
          cx: Math.min(segEnd - 0.14, segStart + 0.24),
          cz: condZ,
          size: 0.2,
          height: 0.08,
          condition: condState,
          kind: 'feeder_pull_box',
        })
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Plausible Lighting Fixture Connections (Junction Box -> Elbow -> Housing)
  // -------------------------------------------------------------------------
  const fixtures = ceilingLightsGroup?.userData?.fixtures || []

  for (let i = 0; i < fixtures.length; i += 1) {
    const f = fixtures[i]
    // Connect ~82% of lighting fixtures to visible junction points
    if (i > 0 && rng() > 0.82) continue

    const isFaultyLight = f.condition !== 'working'
    const boxCondition = isFaultyLight
      ? rng() < 0.45
        ? 'damaged'
        : 'aged'
      : rng() < 0.3
        ? 'aged'
        : 'intact'

    // Approximate housing footprint around (f.x, f.z)
    let halfX = 0.44
    let halfZ = 0.25
    let targetY = soffitY - 0.055
    if (f.designType === 'cage_bulkhead') {
      halfX = f.yaw90 ? 0.17 : 0.22
      halfZ = f.yaw90 ? 0.22 : 0.17
      targetY = soffitY - 0.045
    } else if (f.designType === 'fluorescent_batten') {
      halfX = f.yaw90 ? 0.15 : 0.6
      halfZ = f.yaw90 ? 0.6 : 0.15
      targetY = soffitY - 0.06
    }

    // Try candidate junction box offsets around the light in clear sub-coffer soffit space
    const candidateOffsets = [
      [halfX + 0.68, 0.08],
      [-halfX - 0.68, -0.08],
      [0.12, halfZ + 0.56],
      [-0.12, -halfZ - 0.56],
    ]

    let placedConnection = false
    for (let c = 0; c < candidateOffsets.length && !placedConnection; c += 1) {
      const [ox, oz] = candidateOffsets[(c + i) % candidateOffsets.length]
      const jx = f.x + ox
      const jz = f.z + oz

      const jb = emitJunctionBox({
        cx: jx,
        cz: jz,
        size: 0.17,
        height: 0.068,
        condition: boxCondition,
        kind: 'light_junction_box',
      })
      if (!jb) continue

      // Route branch conduit cleanly right up to just outside fixture housing edge
      const dirX = f.x - jx
      const dirZ = f.z - jz
      const stopX =
        Math.abs(dirX) > Math.abs(dirZ)
          ? f.x - Math.sign(dirX) * (halfX + 0.02)
          : f.x
      const stopZ =
        Math.abs(dirX) > Math.abs(dirZ)
          ? f.z
          : f.z - Math.sign(dirZ) * (halfZ + 0.02)

      const startX =
        Math.abs(dirX) > Math.abs(dirZ)
          ? jx + Math.sign(dirX) * (jb.halfSize + 0.01)
          : jx
      const startZ =
        Math.abs(dirX) > Math.abs(dirZ)
          ? jz
          : jz + Math.sign(dirZ) * (jb.halfSize + 0.01)

      if (routeOrthogonalConduit(startX, startZ, stopX, stopZ, targetY, 0.016, boxCondition)) {
        // Connect vertical/angled conduit termination sleeve at fixture edge
        addHardwareBoxSafe(
          {
            cx: stopX,
            cy: targetY,
            cz: stopZ,
            sx: 0.048,
            sy: 0.048,
            sz: 0.048,
            r: 0.85,
            g: 0.82,
            b: 0.78,
          },
          0.004
        )
        if (f.designType === 'fluorescent_batten') {
          // Drop EMT whip down to suspended batten hood height with entry gland
          const dropEndY = soffitY - 0.125
          if (
            addConduitTubeSafe(
              {
                p0: [stopX, targetY - 0.02, stopZ],
                p1: [stopX, dropEndY, stopZ],
                radius: 0.015,
                sides: 6,
                r: 0.9,
                g: 0.88,
                b: 0.86,
                capStart: false,
                capEnd: false,
              },
              0.004
            )
          ) {
            addHardwareBoxSafe(
              {
                cx: stopX,
                cy: dropEndY,
                cz: stopZ,
                sx: 0.044,
                sy: 0.036,
                sz: 0.044,
                r: 0.82,
                g: 0.8,
                b: 0.78,
              },
              0.004
            )
          }
        }
        connectedLightCount += 1
        placedConnection = true

        // Tie light junction box back toward nearest rib-flank conduit backbone when clear
        let nearestBb = null
        let bestDz = Infinity
        for (let b = 0; b < backboneZCoords.length; b += 1) {
          const d = Math.abs(backboneZCoords[b].condZ - jz)
          if (d < bestDz) {
            bestDz = d
            nearestBb = backboneZCoords[b]
          }
        }
        if (nearestBb && bestDz > 0.35 && bestDz < 2.2) {
          const feedStartZ = jz + Math.sign(nearestBb.condZ - jz) * (jb.halfSize + 0.012)
          const feedEndZ = nearestBb.condZ - Math.sign(nearestBb.condZ - jz) * 0.03
          const bbFeedOk = emitConduitSpan({
            axis: 'z',
            start: Math.min(feedStartZ, feedEndZ),
            end: Math.max(feedStartZ, feedEndZ),
            fixedCoord: jx,
            yCenter: soffitY - 0.062,
            radius: 0.016,
            condition: boxCondition,
            capStart: feedStartZ < feedEndZ,
            capEnd: feedEndZ < feedStartZ,
          })
          if (bbFeedOk) {
            // Cast T-condulet tee-fitting joining feeder branch into backbone pipe
            addHardwareBoxSafe(
              {
                cx: jx,
                cy: soffitY - 0.062,
                cz: nearestBb.condZ,
                sx: 0.064,
                sy: 0.056,
                sz: 0.064,
                r: 0.8,
                g: 0.79,
                b: 0.78,
              },
              0.004
            )
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Plausible Power / Actuator Feeds to Ventilation Ducts & Dampers
  // -------------------------------------------------------------------------
  const vents = ceilingVentsGroup?.userData?.ventMetadata || []
  for (let vIdx = 0; vIdx < vents.length; vIdx += 1) {
    const vm = vents[vIdx]
    // Connect damper hatches and selected double-louver / industrial grilles
    if (vm.designType !== 'damper_hatch' && vIdx % 3 !== 0) continue

    const ventCond =
      vm.condition === 'corroded' || vm.condition === 'damaged'
        ? 'damaged'
        : vm.condition === 'dusty'
          ? 'aged'
          : 'intact'

    const offsets = [
      [vm.sx * 0.5 + 0.52, 0],
      [-vm.sx * 0.5 - 0.52, 0],
      [0, vm.sz * 0.5 + 0.5],
      [0, -vm.sz * 0.5 - 0.5],
    ]

    for (let o = 0; o < offsets.length; o += 1) {
      const [ox, oz] = offsets[(o + vIdx) % offsets.length]
      const jx = vm.cx + ox
      const jz = vm.cz + oz
      const jb = emitJunctionBox({
        cx: jx,
        cz: jz,
        size: 0.18,
        height: 0.072,
        condition: ventCond,
        kind: 'vent_control_box',
      })
      if (!jb) continue

      const dirX = vm.cx - jx
      const dirZ = vm.cz - jz
      const targetEdgeX =
        Math.abs(dirX) > Math.abs(dirZ)
          ? vm.cx - Math.sign(dirX) * (vm.sx * 0.5 + 0.035)
          : vm.cx
      const targetEdgeZ =
        Math.abs(dirX) > Math.abs(dirZ)
          ? vm.cz
          : vm.cz - Math.sign(dirZ) * (vm.sz * 0.5 + 0.035)

      const startX =
        Math.abs(dirX) > Math.abs(dirZ)
          ? jx + Math.sign(dirX) * (jb.halfSize + 0.015)
          : jx
      const startZ =
        Math.abs(dirX) > Math.abs(dirZ)
          ? jz
          : jz + Math.sign(dirZ) * (jb.halfSize + 0.015)

      const runOk = routeOrthogonalConduit(
        startX,
        startZ,
        targetEdgeX,
        targetEdgeZ,
        soffitY - 0.068,
        0.015,
        ventCond
      )

      if (runOk) {
        // Armored flex whip dropping safely to damper / plenum side casing with entry gland
        const topPt = [targetEdgeX, soffitY - 0.072, targetEdgeZ]
        const botY = Math.max(CEILING_ELECTRICAL_CLEARANCE_MIN_Y + 0.12, vm.frameBottomY + 0.09)
        const botPt = [targetEdgeX, botY, targetEdgeZ]
        const whipOk = addCableTubeSafe(
          {
            p0: topPt,
            p1: botPt,
            radius: 0.013,
            sides: 6,
            r: 0.24,
            g: 0.27,
            b: 0.31,
            capStart: false,
            capEnd: false,
          },
          0.004
        )
        if (whipOk) {
          const glandX =
            Math.abs(dirX) > Math.abs(dirZ)
              ? targetEdgeX + Math.sign(dirX) * 0.022
              : targetEdgeX
          const glandZ =
            Math.abs(dirX) > Math.abs(dirZ)
              ? targetEdgeZ
              : targetEdgeZ + Math.sign(dirZ) * 0.022
          addHardwareBoxSafe(
            {
              cx: (targetEdgeX + glandX) * 0.5,
              cy: botY,
              cz: (targetEdgeZ + glandZ) * 0.5,
              sx: Math.abs(dirX) > Math.abs(dirZ) ? 0.032 : 0.04,
              sy: 0.04,
              sz: Math.abs(dirX) > Math.abs(dirZ) ? 0.04 : 0.032,
              r: 0.86,
              g: 0.82,
              b: 0.78,
            },
            0.001
          )
        }
        connectedVentCount += 1
      }
      break
    }
  }

  if (
    conduitBoxes.length === 0 &&
    conduitTubes.length === 0 &&
    hardwareBoxes.length === 0 &&
    cableTubes.length === 0
  ) {
    return null
  }

  // -------------------------------------------------------------------------
  // 5. Build 3 Static Merged Meshes Reusing Existing Galvanized Textures
  // -------------------------------------------------------------------------
  const metalTex = getGalvanizedMetalTextureSet({ qualityPreset })

  const conduitMat = new THREE.MeshStandardMaterial({
    color: CEILING_ELECTRICAL_PALETTE.conduitSteel,
    map: metalTex.map,
    roughnessMap: metalTex.roughnessMap,
    bumpMap: metalTex.bumpMap,
    bumpScale: 0.022,
    roughness: 0.74,
    metalness: 0.64,
    envMapIntensity: 0.54,
    vertexColors: true,
  })

  const hardwareMat = new THREE.MeshStandardMaterial({
    color: CEILING_ELECTRICAL_PALETTE.hardwareIron,
    map: metalTex.map,
    roughnessMap: metalTex.roughnessMap,
    bumpMap: metalTex.bumpMap,
    bumpScale: 0.026,
    roughness: 0.91,
    metalness: 0.36,
    envMapIntensity: 0.36,
    vertexColors: true,
  })

  const cableMat = new THREE.MeshStandardMaterial({
    color: CEILING_ELECTRICAL_PALETTE.cableJacket,
    roughnessMap: metalTex.roughnessMap,
    roughness: 0.88,
    metalness: 0.05,
    envMapIntensity: 0.2,
    vertexColors: true,
  })

  const electricalGroup = new THREE.Group()
  electricalGroup.name = 'maze-ceiling-electrical-group'

  const chunkLayout = createMazeChunkLayout(maze)
  const estimateElectricalTriangles = (boxes = [], tubes = []) => {
    let tris = countKeptBoxTriangles(boxes)
    for (let i = 0; i < tubes.length; i += 1) {
      const t = tubes[i]
      const sides = t.sides || 8
      tris += sides * 2 + (t.capStart ? sides : 0) + (t.capEnd ? sides : 0)
    }
    return tris
  }

  const buildElectricalLayerNode = ({
    boxes = [],
    tubes = [],
    tileUnits,
    layerName,
    material,
  }) => {
    if (boxes.length === 0 && tubes.length === 0) {
      return null
    }
    const totalTris = estimateElectricalTriangles(boxes, tubes)
    const boxBuckets = chunkLayout.isChunked
      ? bucketItemsByChunk(boxes, (b) => [b.cx, b.cz], chunkLayout)
      : null
    const tubeBuckets = chunkLayout.isChunked
      ? bucketItemsByChunk(
          tubes,
          (t) => [(t.p0[0] + t.p1[0]) * 0.5, (t.p0[2] + t.p1[2]) * 0.5],
          chunkLayout
        )
      : null
    let occupiedChunks = 0
    if (boxBuckets && tubeBuckets) {
      for (let cIdx = 0; cIdx < chunkLayout.totalChunks; cIdx += 1) {
        if (boxBuckets[cIdx].length > 0 || tubeBuckets[cIdx].length > 0) {
          occupiedChunks += 1
        }
      }
    }
    const shouldChunk = shouldChunkLayer({
      layout: chunkLayout,
      triangleCount: totalTris,
      occupiedChunks,
    })

    const chunkEntries = []
    if (shouldChunk) {
      for (let cIdx = 0; cIdx < chunkLayout.totalChunks; cIdx += 1) {
        if (boxBuckets[cIdx].length === 0 && tubeBuckets[cIdx].length === 0) {
          continue
        }
        const geo = buildMergedElectricalGeometry({
          boxes: boxBuckets[cIdx],
          tubes: tubeBuckets[cIdx],
          tileUnits,
        })
        if (geo) {
          chunkEntries.push({ chunkIndex: cIdx, geometry: geo })
        }
      }
    } else {
      const geo = buildMergedElectricalGeometry({ boxes, tubes, tileUnits })
      if (geo) {
        chunkEntries.push({ chunkIndex: 0, geometry: geo })
      }
    }

    return buildChunkedLayerNode({
      layerName,
      chunkEntries,
      material,
      castShadow: false,
      receiveShadow: true,
      layout: shouldChunk ? chunkLayout : { ...chunkLayout, isChunked: false },
    })
  }

  // Thin EMT pipes & tray rails run flush near the soffit; skip shadow-pass cost while keeping receiveShadow
  const conduitMesh = buildElectricalLayerNode({
    boxes: conduitBoxes,
    tubes: conduitTubes,
    tileUnits: 1.6,
    layerName: 'maze-ceiling-conduits',
    material: conduitMat,
  })
  if (conduitMesh) {
    electricalGroup.add(conduitMesh)
  }

  const hardwareMesh = buildElectricalLayerNode({
    boxes: hardwareBoxes,
    tubes: [],
    tileUnits: 1.2,
    layerName: 'maze-ceiling-electrical-hardware',
    material: hardwareMat,
  })
  if (hardwareMesh) {
    electricalGroup.add(hardwareMesh)
  }

  const cableMesh = buildElectricalLayerNode({
    boxes: cableBoxes,
    tubes: cableTubes,
    tileUnits: 1.0,
    layerName: 'maze-ceiling-cables',
    material: cableMat,
  })
  if (cableMesh) {
    electricalGroup.add(cableMesh)
  }

  electricalGroup.userData = {
    isMazeCeilingElectrical: true,
    conduitMesh,
    hardwareMesh,
    cableMesh,
    conduitMat,
    hardwareMat,
    cableMat,
    conduitRunCount,
    cableTrayCount,
    junctionBoxCount,
    intactCount,
    agedCount,
    damagedCount,
    connectedLightCount,
    connectedVentCount,
    exposedWireLoopCount,
    electricalMetadata,
  }

  return electricalGroup
}

export function syncCeilingElectricalQuality(electricalGroup, qualityPreset = 'high') {
  if (!electricalGroup) return false
  const metalTex = getGalvanizedMetalTextureSet({ qualityPreset })
  const ud = electricalGroup.userData || {}
  for (const mat of [ud.conduitMat, ud.hardwareMat]) {
    if (!mat) continue
    if (
      mat.map !== metalTex.map ||
      mat.roughnessMap !== metalTex.roughnessMap ||
      mat.bumpMap !== metalTex.bumpMap
    ) {
      mat.map = metalTex.map
      mat.roughnessMap = metalTex.roughnessMap
      mat.bumpMap = metalTex.bumpMap
      mat.needsUpdate = true
    }
  }
  if (ud.cableMat && ud.cableMat.roughnessMap !== metalTex.roughnessMap) {
    ud.cableMat.roughnessMap = metalTex.roughnessMap
    ud.cableMat.needsUpdate = true
  }
  return true
}
