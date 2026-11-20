import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  gridToWorld,
} from '../world/worldCoords.js'
import {
  applyWorldSpaceConcreteShader,
  buildCeilingImperfectionMesh,
  getMazeSurfaceTextureSet,
} from './mazeSurfaceTextures.js'
import { buildCeilingVents } from './buildCeilingVents.js'
import { buildCeilingLights } from './buildCeilingLights.js'
import { buildCeilingElectrical } from './buildCeilingElectrical.js'
import {
  bucketItemsByChunk,
  buildChunkedLayerNode,
  createMazeChunkLayout,
  splitAxisAlignedBoxToChunks,
} from './spatialChunking.js'

export const MAZE_CEILING_CONFIG = {
  soffitY: 3.6,
  slabThickness: 0.82,
  parapetHeight: 0.24,
  eaveOverhang: 1.15,
  spandrelBottomY: 2.94,
  beamBottomY: 3.04,
  beamWidth: 0.78,
  ribBottomY: 3.38,
  ribWidth: 0.42,
  pilasterPlinthHeight: 0.22,
  pilasterShaftTopY: 2.79,
  pilasterCapitalTopY: 3.05,
  pilasterProtrusion: 0.04,
}

export const MAZE_CEILING_PALETTE = {
  deck: 0x26354b, // Heavy cast concrete ceiling soffit
  beam: 0x2c3d56, // Reinforced structural concrete girders
  pillar: 0x31435e, // Wall-engaged concrete pilasters & capitals
}

/**
 * Builds an indexed BufferGeometry directly from an array of axis-aligned box specs
 * `{ cx, cy, cz, sx, sy, sz, shade }` with world-space scaled concrete UVs
 * (matching 2x2 cell slab tiling) and subtle RGB vertex shading contrast.
 */
function buildMergedBoxesGeometry(boxes, tileUnits = CELL_SIZE * 2) {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return null
  }

  const count = boxes.length
  const vertCount = count * 24
  const idxCount = count * 36

  const positions = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const colors = new Float32Array(vertCount * 3)
  const indices = vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount)

  let vCursor = 0
  let iCursor = 0

  const writeFace = (
    p0x, p0y, p0z,
    p1x, p1y, p1z,
    p2x, p2y, p2z,
    p3x, p3y, p3z,
    nx, ny, nz,
    u0, v0, u1, v1, u2, v2, u3, v3,
    r, g, b
  ) => {
    const base = vCursor
    const pts = [
      [p0x, p0y, p0z, u0, v0],
      [p1x, p1y, p1z, u1, v1],
      [p2x, p2y, p2z, u2, v2],
      [p3x, p3y, p3z, u3, v3],
    ]
    for (let k = 0; k < 4; k += 1) {
      const p = (base + k) * 3
      const up = (base + k) * 2
      positions[p] = pts[k][0]
      positions[p + 1] = pts[k][1]
      positions[p + 2] = pts[k][2]
      normals[p] = nx
      normals[p + 1] = ny
      normals[p + 2] = nz
      colors[p] = r
      colors[p + 1] = g
      colors[p + 2] = b
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

  const invTile = 1 / tileUnits

  for (let bIdx = 0; bIdx < count; bIdx += 1) {
    const b = boxes[bIdx]
    const hx = b.sx * 0.5
    const hy = b.sy * 0.5
    const hz = b.sz * 0.5
    const x0 = b.cx - hx
    const x1 = b.cx + hx
    const y0 = b.cy - hy
    const y1 = b.cy + hy
    const z0 = b.cz - hz
    const z1 = b.cz + hz
    const shade = b.shade ?? 1.0

    const uX0 = x0 * invTile
    const uX1 = x1 * invTile
    const uZ0 = z0 * invTile
    const uZ1 = z1 * invTile
    const vY0 = y0 * invTile
    const vY1 = y1 * invTile

    // Slight face directional contrast to accentuate soffits vs beam webs
    const soffitR = shade * 0.94
    const topR = shade * 1.02
    const sideR = shade

    // +Y Top
    writeFace(
      x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0,
      0, 1, 0,
      uX0, uZ1, uX1, uZ1, uX1, uZ0, uX0, uZ0,
      topR, topR, topR
    )
    // -Y Soffit (CCW downward normal (0, -1, 0))
    writeFace(
      x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
      0, -1, 0,
      uX0, uZ0, uX1, uZ0, uX1, uZ1, uX0, uZ1,
      soffitR, soffitR, soffitR
    )
    // +Z Front
    writeFace(
      x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
      0, 0, 1,
      uX0, vY0, uX1, vY0, uX1, vY1, uX0, vY1,
      sideR, sideR, sideR
    )
    // -Z Back
    writeFace(
      x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0,
      0, 0, -1,
      uX1, vY0, uX0, vY0, uX0, vY1, uX1, vY1,
      sideR, sideR, sideR
    )
    // +X Right
    writeFace(
      x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1,
      1, 0, 0,
      uZ1, vY0, uZ0, vY0, uZ0, vY1, uZ1, vY1,
      sideR * 0.97, sideR * 0.97, sideR * 0.97
    )
    // -X Left
    writeFace(
      x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0,
      -1, 0, 0,
      uZ0, vY0, uZ1, vY0, uZ1, vY1, uZ0, vY1,
      sideR * 0.97, sideR * 0.97, sideR * 0.97
    )
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Builds the heavy industrial concrete ceiling slab, perimeter spandrel enclosure,
 * coffered girder & transverse rib grid, wall-engaged corner pilasters with bases
 * and corbel capitals, exterior buttress piers, and ceiling-specific imperfections.
 *
 * The roof deck slab and downward-facing ceiling imperfections keep `castShadow = false`
 * (preventing large enclosed-slab shadow acne/occlusion), while primary structural beams
 * and wall-engaged pilasters retain `castShadow = true` for corridor relief; all meshes
 * keep `receiveShadow = true` (reacting naturally to the flashlight and overhead spots).
 * Pilasters stay outside walkable corridors and clear of hiding spots/markers.
 */
export function buildMazeCeiling(
  maze,
  {
    surfaceSet = null,
    worldSeed = 0,
    qualityPreset = 'high',
    dynamicLights = true,
    isSoftwareGl = false,
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

  const resolvedSurfaceSet = surfaceSet || getMazeSurfaceTextureSet({ qualityPreset })
  const floorWidth = cols * CELL_SIZE
  const floorDepth = rows * CELL_SIZE
  const centerX = (topLeft.x + bottomRight.x) * 0.5
  const centerZ = (topLeft.z + bottomRight.z) * 0.5
  const halfW = floorWidth * 0.5
  const halfD = floorDepth * 0.5

  const cfg = MAZE_CEILING_CONFIG
  const ceilingGroup = new THREE.Group()
  ceilingGroup.name = 'maze-ceiling-group'

  // -------------------------------------------------------------------------
  // 1. Continuous Heavy Concrete Roof Slab, Parapet Rim & Perimeter Spandrel
  // -------------------------------------------------------------------------
  const deckBoxes = []
  const roofWidth = floorWidth + cfg.eaveOverhang * 2
  const roofDepth = floorDepth + cfg.eaveOverhang * 2

  // Main poured slab overhead
  deckBoxes.push({
    cx: centerX,
    cy: cfg.soffitY + cfg.slabThickness * 0.5,
    cz: centerZ,
    sx: roofWidth,
    sy: cfg.slabThickness,
    sz: roofDepth,
    shade: 0.98,
  })

  // Raised roof coping parapet around all 4 edges for thick bunker silhouette
  const parapetY = cfg.soffitY + cfg.slabThickness + cfg.parapetHeight * 0.5
  const parapetRim = 0.62
  deckBoxes.push(
    {
      cx: centerX,
      cy: parapetY,
      cz: centerZ - halfD - cfg.eaveOverhang + parapetRim * 0.5,
      sx: roofWidth,
      sy: cfg.parapetHeight,
      sz: parapetRim,
      shade: 1.03,
    },
    {
      cx: centerX,
      cy: parapetY,
      cz: centerZ + halfD + cfg.eaveOverhang - parapetRim * 0.5,
      sx: roofWidth,
      sy: cfg.parapetHeight,
      sz: parapetRim,
      shade: 1.03,
    },
    {
      cx: centerX - halfW - cfg.eaveOverhang + parapetRim * 0.5,
      cy: parapetY,
      cz: centerZ,
      sx: parapetRim,
      sy: cfg.parapetHeight,
      sz: roofDepth - parapetRim * 2,
      shade: 1.01,
    },
    {
      cx: centerX + halfW + cfg.eaveOverhang - parapetRim * 0.5,
      cy: parapetY,
      cz: centerZ,
      sx: parapetRim,
      sy: cfg.parapetHeight,
      sz: roofDepth - parapetRim * 2,
      shade: 1.01,
    }
  )

  // Perimeter spandrel sealing walls (y = 2.94 .. 3.60) resting flush on outer perimeter wall shell
  const spandrelH = cfg.soffitY - cfg.spandrelBottomY
  const spandrelCy = cfg.spandrelBottomY + spandrelH * 0.5
  const spandrelThick = cfg.eaveOverhang + 0.35 // Inner face sits 0.35m inside wall rim, far outside any PATH cell
  const spandrelCenterOffsetX = halfW + (cfg.eaveOverhang - 0.35) * 0.5
  const spandrelCenterOffsetZ = halfD + (cfg.eaveOverhang - 0.35) * 0.5
  const sideSpanZ = floorDepth - 0.7

  deckBoxes.push(
    {
      cx: centerX,
      cy: spandrelCy,
      cz: centerZ - spandrelCenterOffsetZ,
      sx: roofWidth,
      sy: spandrelH,
      sz: spandrelThick,
      shade: 0.92,
    },
    {
      cx: centerX,
      cy: spandrelCy,
      cz: centerZ + spandrelCenterOffsetZ,
      sx: roofWidth,
      sy: spandrelH,
      sz: spandrelThick,
      shade: 0.92,
    },
    {
      cx: centerX - spandrelCenterOffsetX,
      cy: spandrelCy,
      cz: centerZ,
      sx: spandrelThick,
      sy: spandrelH,
      sz: sideSpanZ,
      shade: 0.9,
    },
    {
      cx: centerX + spandrelCenterOffsetX,
      cy: spandrelCy,
      cz: centerZ,
      sx: spandrelThick,
      sy: spandrelH,
      sz: sideSpanZ,
      shade: 0.9,
    }
  )

  const ceilingMat = new THREE.MeshStandardMaterial({
    color: MAZE_CEILING_PALETTE.deck,
    map: resolvedSurfaceSet.ceiling.map,
    roughnessMap: resolvedSurfaceSet.ceiling.roughnessMap,
    bumpMap: resolvedSurfaceSet.ceiling.bumpMap,
    bumpScale: 0.048,
    roughness: 0.95,
    metalness: 0.015,
    envMapIntensity: 0.44,
    vertexColors: true,
  })
  applyWorldSpaceConcreteShader(ceilingMat, {
    mode: 'ceiling',
    seed: worldSeed,
    qualityPreset,
  })

  const deckGeo = buildMergedBoxesGeometry(deckBoxes, CELL_SIZE * 2)
  const deckMesh = new THREE.Mesh(deckGeo, ceilingMat)
  deckMesh.name = 'maze-ceiling-deck'
  deckMesh.castShadow = false
  deckMesh.receiveShadow = true
  ceilingGroup.add(deckMesh)

  // -------------------------------------------------------------------------
  // 2. Coffered Concrete Girders, Drop Caps & Secondary Transverse Ribs
  // -------------------------------------------------------------------------
  const beamBoxes = []
  const beamH = cfg.soffitY - cfg.beamBottomY
  const beamCy = cfg.beamBottomY + beamH * 0.5
  const innerSpanX = floorWidth - 0.7
  const innerSpanZ = floorDepth - 0.7

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

  // Continuous X-axis primary concrete girders along structural even rows
  for (let i = 0; i < evenRowZs.length; i += 1) {
    beamBoxes.push({
      cx: centerX,
      cy: beamCy,
      cz: evenRowZs[i],
      sx: innerSpanX,
      sy: beamH,
      sz: cfg.beamWidth,
      shade: 0.97,
    })
  }

  // Non-overlapping Z-axis primary concrete girder segments spanning cleanly between X-girders
  const zBoundaries = [centerZ - innerSpanZ * 0.5]
  for (let i = 0; i < evenRowZs.length; i += 1) {
    zBoundaries.push(evenRowZs[i] - cfg.beamWidth * 0.5)
    zBoundaries.push(evenRowZs[i] + cfg.beamWidth * 0.5)
  }
  zBoundaries.push(centerZ + innerSpanZ * 0.5)

  for (let cIdx = 0; cIdx < evenColXs.length; cIdx += 1) {
    const gx = evenColXs[cIdx]
    for (let s = 0; s < zBoundaries.length; s += 2) {
      const zA = zBoundaries[s]
      const zB = zBoundaries[s + 1]
      const segLen = zB - zA
      if (segLen <= 0.05) continue
      beamBoxes.push({
        cx: gx,
        cy: beamCy,
        cz: (zA + zB) * 0.5,
        sx: cfg.beamWidth,
        sy: beamH,
        sz: segLen,
        shade: 0.95,
      })
    }
  }

  // Secondary recessed coffer ribs spanning bays along odd grid lines (non-overlapping)
  const ribH = cfg.soffitY - cfg.ribBottomY
  const ribCy = cfg.ribBottomY + ribH * 0.5
  const xBoundaries = [centerX - innerSpanX * 0.5]
  for (let i = 0; i < evenColXs.length; i += 1) {
    xBoundaries.push(evenColXs[i] - cfg.beamWidth * 0.5)
    xBoundaries.push(evenColXs[i] + cfg.beamWidth * 0.5)
  }
  xBoundaries.push(centerX + innerSpanX * 0.5)

  for (let r = 1; r <= rows - 2; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (!wp) continue
    for (let s = 0; s < xBoundaries.length; s += 2) {
      const xA = xBoundaries[s]
      const xB = xBoundaries[s + 1]
      const segLen = xB - xA
      if (segLen <= 0.05) continue
      beamBoxes.push({
        cx: (xA + xB) * 0.5,
        cy: ribCy,
        cz: wp.z,
        sx: segLen,
        sy: ribH,
        sz: cfg.ribWidth,
        shade: 0.99,
      })
    }
  }

  // Structural column-bay drop panel / shear capitals above wall piers (above 3.30m)
  const dropH = 0.24
  const dropCy = cfg.soffitY - dropH * 0.5
  for (let r = 2; r <= rows - 3; r += 2) {
    for (let c = 2; c <= cols - 3; c += 2) {
      if (grid[r][c] !== CELL_TYPES.WALL) continue
      const wp = gridToWorld(r, c, maze)
      if (!wp) continue
      // 4 shallow quadrant flanges nestled around girder cross (zero coplanar overlap)
      const off = cfg.beamWidth * 0.5 + 0.22
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          beamBoxes.push({
            cx: wp.x + sx * off,
            cy: dropCy,
            cz: wp.z + sz * off,
            sx: 0.44,
            sy: dropH,
            sz: 0.44,
            shade: 0.91,
          })
        }
      }
    }
  }

  const beamMat = new THREE.MeshStandardMaterial({
    color: MAZE_CEILING_PALETTE.beam,
    map: resolvedSurfaceSet.ceiling.map,
    roughnessMap: resolvedSurfaceSet.ceiling.roughnessMap,
    bumpMap: resolvedSurfaceSet.ceiling.bumpMap,
    bumpScale: 0.044,
    roughness: 0.95,
    metalness: 0.02,
    envMapIntensity: 0.45,
    vertexColors: true,
  })
  applyWorldSpaceConcreteShader(beamMat, {
    mode: 'ceiling',
    seed: worldSeed,
    qualityPreset,
  })

  const chunkLayout = createMazeChunkLayout(maze)
  const shouldChunkBeams =
    chunkLayout.isChunked && beamBoxes.length * 12 >= chunkLayout.minTrianglesToChunk
  const beamChunkEntries = []
  if (shouldChunkBeams) {
    const beamBuckets = Array.from({ length: chunkLayout.totalChunks }, () => [])
    for (let i = 0; i < beamBoxes.length; i += 1) {
      const pieces = splitAxisAlignedBoxToChunks(beamBoxes[i], chunkLayout)
      for (let j = 0; j < pieces.length; j += 1) {
        beamBuckets[pieces[j].chunkIndex].push(pieces[j].item)
      }
    }
    for (let cIdx = 0; cIdx < beamBuckets.length; cIdx += 1) {
      if (beamBuckets[cIdx].length === 0) continue
      const geo = buildMergedBoxesGeometry(beamBuckets[cIdx], CELL_SIZE * 2)
      if (geo) {
        beamChunkEntries.push({ chunkIndex: cIdx, geometry: geo })
      }
    }
  } else {
    const beamsGeo = buildMergedBoxesGeometry(beamBoxes, CELL_SIZE * 2)
    if (beamsGeo) {
      beamChunkEntries.push({ chunkIndex: 0, geometry: beamsGeo })
    }
  }

  const beamsMesh = buildChunkedLayerNode({
    layerName: 'maze-ceiling-beams',
    chunkEntries: beamChunkEntries,
    material: beamMat,
    castShadow: true,
    receiveShadow: true,
    layout: shouldChunkBeams ? chunkLayout : { ...chunkLayout, isChunked: false },
  })
  if (beamsMesh) {
    ceilingGroup.add(beamsMesh)
  }

  // -------------------------------------------------------------------------
  // 3. Wall-Engaged Structural Pilasters (Even Structural Nodes) & Exterior Buttresses
  // -------------------------------------------------------------------------
  const pillarBoxes = []
  const isPathAt = (r, c) =>
    r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === CELL_TYPES.PATH

  const shaftH = cfg.pilasterShaftTopY - cfg.pilasterPlinthHeight
  const shaftCy = cfg.pilasterPlinthHeight + shaftH * 0.5
  const plinthCy = cfg.pilasterPlinthHeight * 0.5
  const capH = cfg.pilasterCapitalTopY - cfg.pilasterShaftTopY
  const capCy = cfg.pilasterShaftTopY + capH * 0.5

  const cornerOffset = CELL_SIZE * 0.5 - 0.24 + cfg.pilasterProtrusion
  const cornerOffPlinth = CELL_SIZE * 0.5 - 0.25 + cfg.pilasterProtrusion * 1.5
  const cornerOffCap = CELL_SIZE * 0.5 - 0.24 + 0.12

  let pilasterCount = 0
  for (let r = 0; r < rows; r += 2) {
    for (let c = 0; c < cols; c += 2) {
      if (grid[r][c] !== CELL_TYPES.WALL) continue
      const wp = gridToWorld(r, c, maze)
      if (!wp) continue

      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          // Only add a corner pilaster where this structural corner actually borders corridor space
          const exposed =
            isPathAt(r + sz, c) || isPathAt(r, c + sx) || isPathAt(r + sz, c + sx)
          if (!exposed) continue

          pilasterCount += 1
          // Grounded stepped plinth foot (y = 0 .. 0.22m)
          pillarBoxes.push({
            cx: wp.x + sx * cornerOffPlinth,
            cy: plinthCy,
            cz: wp.z + sz * cornerOffPlinth,
            sx: 0.54,
            sy: cfg.pilasterPlinthHeight,
            sz: 0.54,
            shade: 0.88,
          })
          // Reinforced concrete corner shaft (y = 0.22 .. 2.78m)
          pillarBoxes.push({
            cx: wp.x + sx * cornerOffset,
            cy: shaftCy,
            cz: wp.z + sz * cornerOffset,
            sx: 0.48,
            sy: shaftH,
            sz: 0.48,
            shade: 0.96,
          })
          // Flared concrete corbel capital supporting girders (y = 2.78 .. 3.05m, strictly above 2.75m camera & 2.67m Brute)
          pillarBoxes.push({
            cx: wp.x + sx * cornerOffCap,
            cy: capCy,
            cz: wp.z + sz * cornerOffCap,
            sx: 0.66,
            sy: capH,
            sz: 0.66,
            shade: 0.92,
          })
        }
      }
    }
  }

  // Exterior perimeter structural buttress columns visually supporting overhanging eaves
  const extPositions = []
  const extOffsetX = halfW + 0.42
  const extOffsetZ = halfD + 0.42
  for (let c = 0; c < cols; c += 2) {
    const wp = gridToWorld(0, c, maze)
    if (!wp) continue
    extPositions.push([wp.x, -extOffsetZ])
    extPositions.push([wp.x, extOffsetZ])
  }
  for (let r = 2; r <= rows - 3; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (!wp) continue
    extPositions.push([-extOffsetX, wp.z])
    extPositions.push([extOffsetX, wp.z])
  }

  for (let i = 0; i < extPositions.length; i += 1) {
    const [bx, bz] = extPositions[i]
    // Deep foundation plinth resting onto facility sub-floor (-0.72 .. 0.35m)
    pillarBoxes.push({
      cx: bx,
      cy: -0.185,
      cz: bz,
      sx: 1.24,
      sy: 1.07,
      sz: 1.24,
      shade: 0.86,
    })
    // Column shaft (y = 0.35 .. 2.75m)
    pillarBoxes.push({
      cx: bx,
      cy: 1.55,
      cz: bz,
      sx: 0.96,
      sy: 2.4,
      sz: 0.96,
      shade: 0.95,
    })
    // Heavy upper capital bracket meeting spandrel & roof eave (y = 2.75 .. 3.04m)
    pillarBoxes.push({
      cx: bx,
      cy: 2.895,
      cz: bz,
      sx: 1.22,
      sy: 0.29,
      sz: 1.22,
      shade: 0.91,
    })
  }

  const pillarMat = new THREE.MeshStandardMaterial({
    color: MAZE_CEILING_PALETTE.pillar,
    map: resolvedSurfaceSet.ceiling.map,
    roughnessMap: resolvedSurfaceSet.ceiling.roughnessMap,
    bumpMap: resolvedSurfaceSet.ceiling.bumpMap,
    bumpScale: 0.048,
    roughness: 0.94,
    metalness: 0.02,
    envMapIntensity: 0.45,
    vertexColors: true,
  })
  applyWorldSpaceConcreteShader(pillarMat, {
    mode: 'ceiling',
    seed: worldSeed,
    qualityPreset,
  })

  const shouldChunkPillars =
    chunkLayout.isChunked && pillarBoxes.length * 12 >= chunkLayout.minTrianglesToChunk
  const pillarChunkEntries = []
  if (shouldChunkPillars) {
    const pillarBuckets = bucketItemsByChunk(
      pillarBoxes,
      (b) => [b.cx, b.cz],
      chunkLayout
    )
    for (let cIdx = 0; cIdx < pillarBuckets.length; cIdx += 1) {
      if (pillarBuckets[cIdx].length === 0) continue
      const geo = buildMergedBoxesGeometry(pillarBuckets[cIdx], CELL_SIZE * 2)
      if (geo) {
        pillarChunkEntries.push({ chunkIndex: cIdx, geometry: geo })
      }
    }
  } else {
    const pillarsGeo = buildMergedBoxesGeometry(pillarBoxes, CELL_SIZE * 2)
    if (pillarsGeo) {
      pillarChunkEntries.push({ chunkIndex: 0, geometry: pillarsGeo })
    }
  }

  const pillarsMesh = buildChunkedLayerNode({
    layerName: 'maze-ceiling-pillars',
    chunkEntries: pillarChunkEntries,
    material: pillarMat,
    castShadow: true,
    receiveShadow: true,
    layout: shouldChunkPillars ? chunkLayout : { ...chunkLayout, isChunked: false },
  })
  if (pillarsMesh) {
    ceilingGroup.add(pillarsMesh)
  }

  // -------------------------------------------------------------------------
  // 4. Downward-Facing Ceiling Soffit Imperfections (Pooled 4x4 Detail Atlas)
  // -------------------------------------------------------------------------
  const ceilingImperfectionsMesh = buildCeilingImperfectionMesh(
    maze,
    resolvedSurfaceSet.wallDetailMaterial,
    { soffitY: cfg.soffitY }
  )
  if (ceilingImperfectionsMesh) {
    ceilingGroup.add(ceilingImperfectionsMesh)
  }

  // -------------------------------------------------------------------------
  // 5. Industrial Ceiling Ventilation Ducts, Collars, Hangers & Grilles
  // -------------------------------------------------------------------------
  const ceilingVentsGroup = buildCeilingVents(maze, {
    soffitY: cfg.soffitY,
    beamBottomY: cfg.beamBottomY,
    beamWidth: cfg.beamWidth,
    ribBottomY: cfg.ribBottomY,
    ribWidth: cfg.ribWidth,
    worldSeed,
    qualityPreset,
  })
  if (ceilingVentsGroup) {
    ceilingGroup.add(ceilingVentsGroup)
  }

  // -------------------------------------------------------------------------
  // 6. Industrial Overhead Ceiling Lighting Fixtures
  // -------------------------------------------------------------------------
  const ceilingLightsGroup = buildCeilingLights(maze, {
    soffitY: cfg.soffitY,
    beamBottomY: cfg.beamBottomY,
    beamWidth: cfg.beamWidth,
    ribWidth: cfg.ribWidth,
    worldSeed,
    ventMetadata: ceilingVentsGroup?.userData?.ventMetadata || null,
    ductTrunks: ceilingVentsGroup?.userData?.ductTrunks || null,
    qualityPreset,
    dynamicLights,
    isSoftwareGl,
  })
  if (ceilingLightsGroup) {
    ceilingGroup.add(ceilingLightsGroup)
  }

  ceilingGroup.userData.beamsMesh = beamsMesh

  // -------------------------------------------------------------------------
  // 7. Electrical Conduits, Cable Trays, Junction Boxes & Exposed Wiring
  // -------------------------------------------------------------------------
  const ceilingElectricalGroup = buildCeilingElectrical(maze, {
    soffitY: cfg.soffitY,
    beamBottomY: cfg.beamBottomY,
    beamWidth: cfg.beamWidth,
    ribBottomY: cfg.ribBottomY,
    ribWidth: cfg.ribWidth,
    worldSeed,
    ceilingGroup,
    ceilingVentsGroup,
    ceilingLightsGroup,
    qualityPreset,
  })
  if (ceilingElectricalGroup) {
    ceilingGroup.add(ceilingElectricalGroup)
  }

  ceilingGroup.userData = {
    isMazeCeiling: true,
    soffitY: cfg.soffitY,
    slabTopY: cfg.soffitY + cfg.slabThickness,
    beamBottomY: cfg.beamBottomY,
    spandrelBottomY: cfg.spandrelBottomY,
    deckMesh,
    beamsMesh,
    pillarsMesh,
    ceilingImperfectionsMesh,
    ceilingVentsGroup,
    ceilingLightsGroup,
    ceilingElectricalGroup,
    ductMesh: ceilingVentsGroup?.userData?.ductMesh || null,
    ductHardwareMesh: ceilingVentsGroup?.userData?.ductHardwareMesh || null,
    ventCavityMesh: ceilingVentsGroup?.userData?.ventCavityMesh || null,
    lightHousingMesh: ceilingLightsGroup?.userData?.housingMesh || null,
    lightDiffuserMesh: ceilingLightsGroup?.userData?.diffuserMesh || null,
    conduitMesh: ceilingElectricalGroup?.userData?.conduitMesh || null,
    electricalHardwareMesh: ceilingElectricalGroup?.userData?.hardwareMesh || null,
    electricalCableMesh: ceilingElectricalGroup?.userData?.cableMesh || null,
    ceilingMat,
    beamMat,
    pillarMat,
    pilasterCount,
    exteriorButtressCount: extPositions.length,
    ceilingImperfectionCount: ceilingImperfectionsMesh?.userData?.decalCount || 0,
    ductTrunkCount: ceilingVentsGroup?.userData?.trunkCount || 0,
    ceilingVentCount: ceilingVentsGroup?.userData?.ventCount || 0,
    ceilingLightCount: ceilingLightsGroup?.userData?.fixtureCount || 0,
    workingLightCount: ceilingLightsGroup?.userData?.workingCount || 0,
    flickeringLightCount: ceilingLightsGroup?.userData?.flickeringCount || 0,
    burnedOutLightCount: ceilingLightsGroup?.userData?.burnedOutCount || 0,
    conduitRunCount: ceilingElectricalGroup?.userData?.conduitRunCount || 0,
    cableTrayCount: ceilingElectricalGroup?.userData?.cableTrayCount || 0,
    junctionBoxCount: ceilingElectricalGroup?.userData?.junctionBoxCount || 0,
    damagedElectricalCount: ceilingElectricalGroup?.userData?.damagedCount || 0,
    connectedElectricalLightCount: ceilingElectricalGroup?.userData?.connectedLightCount || 0,
    connectedElectricalVentCount: ceilingElectricalGroup?.userData?.connectedVentCount || 0,
  }

  return ceilingGroup
}
