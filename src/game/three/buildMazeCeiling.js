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
  buildChunkedLayerNode,
  createMazeChunkLayout,
  shouldChunkLayer,
  splitAxisAlignedBoxToChunks,
} from './spatialChunking.js'
import {
  resolveElevatorShaftCutouts,
  subtractCutoutRectsFromBoxes,
} from './buildElevatorShafts.js'
import {
  FACE_BOT,
  FACE_NEG_X,
  FACE_NEG_Z,
  FACE_POS_X,
  FACE_POS_Z,
  FACE_TOP,
  buildMergedBoxesWithCulling,
  countKeptBoxTriangles,
} from './geometryOptimization.js'

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
  return buildMergedBoxesWithCulling(boxes, {
    tileUnits,
    worldTileUVs: true,
    storeBoxBounds: true,
  })
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
 * Pilasters stay outside walkable corridors and clear of markers.
 */
export function buildMazeCeiling(
  maze,
  {
    surfaceSet = null,
    worldSeed = 0,
    qualityPreset = 'high',
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
  const chunkLayout = createMazeChunkLayout(maze)
  const shaftCutouts = resolveElevatorShaftCutouts(maze)
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
  // (bottom rests flush on main roof slab top surface -> cull FACE_BOT)
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
      cullFaces: FACE_BOT,
    },
    {
      cx: centerX,
      cy: parapetY,
      cz: centerZ + halfD + cfg.eaveOverhang - parapetRim * 0.5,
      sx: roofWidth,
      sy: cfg.parapetHeight,
      sz: parapetRim,
      shade: 1.03,
      cullFaces: FACE_BOT,
    },
    {
      cx: centerX - halfW - cfg.eaveOverhang + parapetRim * 0.5,
      cy: parapetY,
      cz: centerZ,
      sx: parapetRim,
      sy: cfg.parapetHeight,
      sz: roofDepth - parapetRim * 2,
      shade: 1.01,
      cullFaces: FACE_BOT | FACE_POS_Z | FACE_NEG_Z,
    },
    {
      cx: centerX + halfW + cfg.eaveOverhang - parapetRim * 0.5,
      cy: parapetY,
      cz: centerZ,
      sx: parapetRim,
      sy: cfg.parapetHeight,
      sz: roofDepth - parapetRim * 2,
      shade: 1.01,
      cullFaces: FACE_BOT | FACE_POS_Z | FACE_NEG_Z,
    }
  )

  // Perimeter spandrel sealing walls (y = 2.94 .. 3.60) resting flush on outer perimeter wall shell
  // (top face sits flush against solid main roof slab soffit -> cull FACE_TOP)
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
      cullFaces: FACE_TOP,
    },
    {
      cx: centerX,
      cy: spandrelCy,
      cz: centerZ + spandrelCenterOffsetZ,
      sx: roofWidth,
      sy: spandrelH,
      sz: spandrelThick,
      shade: 0.92,
      cullFaces: FACE_TOP,
    },
    {
      cx: centerX - spandrelCenterOffsetX,
      cy: spandrelCy,
      cz: centerZ,
      sx: spandrelThick,
      sy: spandrelH,
      sz: sideSpanZ,
      shade: 0.9,
      cullFaces: FACE_TOP | FACE_POS_Z | FACE_NEG_Z,
    },
    {
      cx: centerX + spandrelCenterOffsetX,
      cy: spandrelCy,
      cz: centerZ,
      sx: spandrelThick,
      sy: spandrelH,
      sz: sideSpanZ,
      shade: 0.9,
      cullFaces: FACE_TOP | FACE_POS_Z | FACE_NEG_Z,
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

  const cutDeckBoxes = subtractCutoutRectsFromBoxes(deckBoxes, shaftCutouts)
  const deckBuckets = Array.from({ length: chunkLayout.totalChunks }, () => [])
  let deckOccupiedChunks = 0
  if (chunkLayout.isChunked) {
    for (let i = 0; i < cutDeckBoxes.length; i += 1) {
      const pieces = splitAxisAlignedBoxToChunks(cutDeckBoxes[i], chunkLayout)
      for (let j = 0; j < pieces.length; j += 1) {
        const piece = pieces[j]
        if (deckBuckets[piece.chunkIndex].length === 0) {
          deckOccupiedChunks += 1
        }
        deckBuckets[piece.chunkIndex].push(piece.item)
      }
    }
  }
  const shouldChunkDeck = shouldChunkLayer({
    layout: chunkLayout,
    triangleCount: countKeptBoxTriangles(cutDeckBoxes),
    occupiedChunks: deckOccupiedChunks,
    forceWhenMultiChunk: true,
  })
  const deckChunkEntries = []
  if (shouldChunkDeck) {
    for (let cIdx = 0; cIdx < deckBuckets.length; cIdx += 1) {
      if (deckBuckets[cIdx].length === 0) continue
      const geo = buildMergedBoxesGeometry(deckBuckets[cIdx], CELL_SIZE * 2)
      if (geo) {
        deckChunkEntries.push({ chunkIndex: cIdx, geometry: geo })
      }
    }
  } else {
    const deckGeo = buildMergedBoxesGeometry(cutDeckBoxes, CELL_SIZE * 2)
    if (deckGeo) {
      deckChunkEntries.push({ chunkIndex: 0, geometry: deckGeo })
    }
  }

  const deckMesh = buildChunkedLayerNode({
    layerName: 'maze-ceiling-deck',
    chunkEntries: deckChunkEntries,
    material: ceilingMat,
    castShadow: false,
    receiveShadow: true,
    layout: shouldChunkDeck ? chunkLayout : { ...chunkLayout, isChunked: false },
  })
  if (deckMesh) {
    ceilingGroup.add(deckMesh)
  }

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
  // (top is flush with ceiling soffit; ends meet perimeter spandrels flush)
  for (let i = 0; i < evenRowZs.length; i += 1) {
    beamBoxes.push({
      cx: centerX,
      cy: beamCy,
      cz: evenRowZs[i],
      sx: innerSpanX,
      sy: beamH,
      sz: cfg.beamWidth,
      shade: 0.97,
      cullFaces: FACE_TOP | FACE_POS_X | FACE_NEG_X,
    })
  }

  // Non-overlapping Z-axis primary concrete girder segments spanning cleanly between X-girders
  // (top flush with soffit; Z ends abut perpendicular X-girders or N/S spandrels of equal/greater height)
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
        cullFaces: FACE_TOP | FACE_POS_Z | FACE_NEG_Z,
      })
    }
  }

  // Secondary recessed coffer ribs spanning bays along odd grid lines (non-overlapping)
  // (top flush with soffit; X ends terminate flush against deeper Z-girders or E/W spandrels)
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
        cullFaces: FACE_TOP | FACE_POS_X | FACE_NEG_X,
      })
    }
  }

  // Structural column-bay drop panel / shear capitals above wall piers (above 3.30m)
  // Shallow soffit-level corner pads contribute negligible visible shadows below beams -> non-casting detail layer
  const beamDetailBoxes = []
  const dropH = 0.24
  const dropCy = cfg.soffitY - dropH * 0.5
  for (let r = 2; r <= rows - 3; r += 2) {
    for (let c = 2; c <= cols - 3; c += 2) {
      if (grid[r][c] !== CELL_TYPES.WALL) continue
      const wp = gridToWorld(r, c, maze)
      if (!wp) continue
      // 4 shallow quadrant flanges nestled around girder cross (top + inner X/Z faces buried against slab & girders)
      const off = cfg.beamWidth * 0.5 + 0.22
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          beamDetailBoxes.push({
            cx: wp.x + sx * off,
            cy: dropCy,
            cz: wp.z + sz * off,
            sx: 0.44,
            sy: dropH,
            sz: 0.44,
            shade: 0.91,
            cullFaces:
              FACE_TOP |
              (sx > 0 ? FACE_NEG_X : FACE_POS_X) |
              (sz > 0 ? FACE_NEG_Z : FACE_POS_Z),
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

  const buildCeilingBoxLayer = (boxes, layerName, material, castShadow) => {
    if (!boxes || boxes.length === 0) return null
    const buckets = chunkLayout.isChunked
      ? Array.from({ length: chunkLayout.totalChunks }, () => [])
      : null
    let occupiedChunks = 0
    if (buckets) {
      for (let i = 0; i < boxes.length; i += 1) {
        const pieces = splitAxisAlignedBoxToChunks(boxes[i], chunkLayout)
        for (let j = 0; j < pieces.length; j += 1) {
          const piece = pieces[j]
          if (buckets[piece.chunkIndex].length === 0) {
            occupiedChunks += 1
          }
          buckets[piece.chunkIndex].push(piece.item)
        }
      }
    }
    const shouldChunk = shouldChunkLayer({
      layout: chunkLayout,
      triangleCount: countKeptBoxTriangles(boxes),
      occupiedChunks,
    })
    const chunkEntries = []
    if (shouldChunk) {
      for (let cIdx = 0; cIdx < buckets.length; cIdx += 1) {
        if (buckets[cIdx].length === 0) continue
        const geo = buildMergedBoxesGeometry(buckets[cIdx], CELL_SIZE * 2)
        if (geo) {
          chunkEntries.push({ chunkIndex: cIdx, geometry: geo })
        }
      }
    } else {
      const geo = buildMergedBoxesGeometry(boxes, CELL_SIZE * 2)
      if (geo) {
        chunkEntries.push({ chunkIndex: 0, geometry: geo })
      }
    }
    return buildChunkedLayerNode({
      layerName,
      chunkEntries,
      material,
      castShadow,
      receiveShadow: true,
      layout: shouldChunk ? chunkLayout : { ...chunkLayout, isChunked: false },
    })
  }

  const cutBeamBoxes = subtractCutoutRectsFromBoxes(beamBoxes, shaftCutouts)
  const cutBeamDetailBoxes = subtractCutoutRectsFromBoxes(beamDetailBoxes, shaftCutouts)

  const beamsMesh = buildCeilingBoxLayer(cutBeamBoxes, 'maze-ceiling-beams', beamMat, true)
  if (beamsMesh) {
    ceilingGroup.add(beamsMesh)
  }

  const beamDetailsMesh = buildCeilingBoxLayer(
    cutBeamDetailBoxes,
    'maze-ceiling-beam-details',
    beamMat,
    false
  )
  if (beamDetailsMesh) {
    ceilingGroup.add(beamDetailsMesh)
  }

  // -------------------------------------------------------------------------
  // 3. Wall-Engaged Structural Pilasters (Even Structural Nodes) & Exterior Buttresses
  // -------------------------------------------------------------------------
  const pillarBoxes = []
  const pillarDetailBoxes = []
  const isPathAt = (r, c) =>
    r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === CELL_TYPES.PATH
  const isWallAt = (r, c) =>
    r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === CELL_TYPES.WALL

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
          // Inner (-sx / -sz) faces are embedded strictly inside wall cells when adjacent neighbor along Z / X is also a WALL
          const wallSideCull =
            (isWallAt(r + sz, c) ? (sx > 0 ? FACE_NEG_X : FACE_POS_X) : 0) |
            (isWallAt(r, c + sx) ? (sz > 0 ? FACE_NEG_Z : FACE_POS_Z) : 0)

          // Grounded stepped plinth foot (y = 0 .. 0.22m, minimal floor-level offset -> skip shadow pass)
          pillarDetailBoxes.push({
            cx: wp.x + sx * cornerOffPlinth,
            cy: plinthCy,
            cz: wp.z + sz * cornerOffPlinth,
            sx: 0.54,
            sy: cfg.pilasterPlinthHeight,
            sz: 0.54,
            shade: 0.88,
            cullFaces: FACE_BOT | wallSideCull,
          })
          // Reinforced concrete corner shaft (y = 0.22 .. 2.79m, ends enclosed inside wider plinth & capital)
          pillarBoxes.push({
            cx: wp.x + sx * cornerOffset,
            cy: shaftCy,
            cz: wp.z + sz * cornerOffset,
            sx: 0.48,
            sy: shaftH,
            sz: 0.48,
            shade: 0.96,
            cullFaces: FACE_TOP | FACE_BOT | wallSideCull,
          })
          // Flared concrete corbel capital supporting girders (y = 2.79 .. 3.05m, strictly above 2.75m camera & 2.67m Brute)
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

  // Exterior perimeter structural buttress columns sit outside enclosed maze walls -> skip interior shadow maps
  const extPositions = []
  const extOffsetX = halfW + 0.42
  const extOffsetZ = halfD + 0.42
  for (let c = 0; c < cols; c += 2) {
    const wp = gridToWorld(0, c, maze)
    if (!wp) continue
    extPositions.push([wp.x, -extOffsetZ, isWallAt(0, c) ? FACE_POS_Z : 0])
    extPositions.push([wp.x, extOffsetZ, isWallAt(rows - 1, c) ? FACE_NEG_Z : 0])
  }
  for (let r = 2; r <= rows - 3; r += 2) {
    const wp = gridToWorld(r, 0, maze)
    if (!wp) continue
    extPositions.push([-extOffsetX, wp.z, isWallAt(r, 0) ? FACE_POS_X : 0])
    extPositions.push([extOffsetX, wp.z, isWallAt(r, cols - 1) ? FACE_NEG_X : 0])
  }

  for (let i = 0; i < extPositions.length; i += 1) {
    const [bx, bz, wallFaceCull] = extPositions[i]
    // Deep foundation plinth resting onto facility sub-floor (-0.72 .. 0.35m)
    pillarDetailBoxes.push({
      cx: bx,
      cy: -0.185,
      cz: bz,
      sx: 1.24,
      sy: 1.07,
      sz: 1.24,
      shade: 0.86,
      cullFaces: FACE_BOT,
    })
    // Column shaft (y = 0.35 .. 2.75m, ends covered inside wider plinth & capital, inner face inside perimeter wall)
    pillarDetailBoxes.push({
      cx: bx,
      cy: 1.55,
      cz: bz,
      sx: 0.96,
      sy: 2.4,
      sz: 0.96,
      shade: 0.95,
      cullFaces: FACE_TOP | FACE_BOT | wallFaceCull,
    })
    // Heavy upper capital bracket meeting spandrel & roof eave (top y = 3.04 inside spandrel, inner face inside wall/spandrel)
    pillarDetailBoxes.push({
      cx: bx,
      cy: 2.895,
      cz: bz,
      sx: 1.22,
      sy: 0.29,
      sz: 1.22,
      shade: 0.91,
      cullFaces: FACE_TOP | wallFaceCull,
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

  const pillarsMesh = buildCeilingBoxLayer(
    pillarBoxes,
    'maze-ceiling-pillars',
    pillarMat,
    true
  )
  if (pillarsMesh) {
    ceilingGroup.add(pillarsMesh)
  }

  const pillarDetailsMesh = buildCeilingBoxLayer(
    pillarDetailBoxes,
    'maze-ceiling-pillar-details',
    pillarMat,
    false
  )
  if (pillarDetailsMesh) {
    ceilingGroup.add(pillarDetailsMesh)
  }

  // -------------------------------------------------------------------------
  // 4. Downward-Facing Ceiling Soffit Imperfections (Pooled 4x4 Detail Atlas)
  // -------------------------------------------------------------------------
  const ceilingImperfectionsMesh = buildCeilingImperfectionMesh(
    maze,
    resolvedSurfaceSet.wallDetailMaterial,
    { soffitY: cfg.soffitY, excludedCutouts: shaftCutouts }
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
    excludedCutouts: shaftCutouts,
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
    isSoftwareGl,
    excludedCutouts: shaftCutouts,
  })
  if (ceilingLightsGroup) {
    ceilingGroup.add(ceilingLightsGroup)
  }

  ceilingGroup.userData.beamsMesh = beamsMesh
  ceilingGroup.userData.beamDetailsMesh = beamDetailsMesh

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
    excludedCutouts: shaftCutouts,
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
    shaftCutouts,
    deckMesh,
    beamsMesh,
    beamDetailsMesh,
    pillarsMesh,
    pillarDetailsMesh,
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
