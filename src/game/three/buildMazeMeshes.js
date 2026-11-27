import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  WALL_HEIGHT,
  gridToWorld,
} from '../world/worldCoords.js'
import { isSharedResource } from './sharedResources.js'
import {
  applyFloorGeometrySurfaceDetails,
  applyWorldSpaceConcreteShader,
  buildFloorImperfectionMesh,
  buildSelectiveGraffitiMesh,
  buildWallImperfectionMesh,
  getMazeSurfaceTextureSet,
} from './mazeSurfaceTextures.js'
import { buildMazeCeiling } from './buildMazeCeiling.js'
import { buildElevatorShafts } from './buildElevatorShafts.js'
import { buildEnvironmentalProps } from './buildEnvironmentalProps.js'
import { buildStructuralDeterioration } from './buildStructuralDeterioration.js'
import {
  buildCeilingCollapseDecoys,
  buildElectricalWiringDecoys,
  buildFallingPipesDecoys,
  buildFloorGrateDecoys,
  buildSteamPipeDecoys,
  buildSuspendedMachineryDecoys,
  buildVentilationDuctDecoys,
  buildWallCollapseDecoys,
  buildWaterTankDecoys,
} from './buildHazards.js'
import { placeEnvironmentalProps } from '../generation/environmentalPropPlacement.js'
import {
  ENVIRONMENTAL_OBJECT_TYPES,
  isSandboxItemEnabled,
  SANDBOX_CATEGORY_IDS,
} from '../sandbox/sandboxConfig.js'
import {
  placeCeilingCollapseDecoys,
  placeElectricalWiringDecoys,
  placeFallingPipesDecoys,
  placeFloorGrateDecoys,
  placeHazards,
  placeSteamPipeDecoys,
  placeSuspendedMachineryDecoys,
  placeVentilationDuctDecoys,
  placeWallCollapseDecoys,
  placeWaterTankDecoys,
  resolveFloorGrateCutouts,
} from '../generation/hazardPlacement.js'
import {
  placeHidingSpots,
  resolveFloorHatchCutouts,
} from '../generation/hidingSpotPlacement.js'
import {
  buildChunkedInstancedLayerNode,
  buildChunkedLayerNode,
  createMazeChunkLayout,
} from './spatialChunking.js'
import {
  FACE_BOT,
  FACE_NEG_X,
  FACE_NEG_Z,
  FACE_POS_X,
  FACE_POS_Z,
  buildMergedBoxesWithCulling,
  buildOptimizedFloorGeometry,
} from './geometryOptimization.js'
import {
  ELEVATOR_PALETTE,
  createBrokenStartElevator,
  createExtractionElevator,
  getExtractionCabinY,
  getExtractionDeckOffsetY,
  getStartElevatorOffsetY,
  setExtractionElevatorSequenceState,
  setExtractionElevatorState,
  setStartElevatorSequenceState,
  triggerStartElevatorLandingDust,
  updateExtractionElevator,
  updateStartElevator,
} from './buildElevators.js'

const FLOOR_THICKNESS = 0.25
const WALL_CAP_HEIGHT = 0.14

export const MAZE_MESH_PALETTE = {
  floor: 0x1c283d, // Readable dark concrete facility floor
  wallBody: 0x2f405b, // Cool slate industrial concrete wall body
  wallBevel: 0x485f82, // Precast top coping bevel highlight
  markerBase: ELEVATOR_PALETTE.steelDark,
  startAccent: 0x7b6a56,
  exitAccent: ELEVATOR_PALETTE.exitUnlockedAccent,
  exitGlow: ELEVATOR_PALETTE.exitUnlockedGlow,
  exitLocked: ELEVATOR_PALETTE.exitLockedAccent,
  exitLockedGlow: ELEVATOR_PALETTE.exitLockedGlow,
  gateSteel: ELEVATOR_PALETTE.steelMid,
  gateSteelDark: ELEVATOR_PALETTE.steelDark,
}

export const setExitGateState = setExtractionElevatorState
export const updateExitGate = updateExtractionElevator
export const setExitGateSequenceState = setExtractionElevatorSequenceState
export const getExitGateDeckOffsetY = getExtractionDeckOffsetY
export {
  getExtractionCabinY,
  getStartElevatorOffsetY,
  setStartElevatorSequenceState,
  triggerStartElevatorLandingDust,
  updateStartElevator,
}



/**
 * Converts a canonical `maze` (`maze.grid`) into a Three.js Group containing:
 *  - Continuous stone floor slab
 *  - Instanced 3D walls + stone bevel top caps (2 draw calls total)
 *  - Distinct entrance (start) and exit floor markers
 *
 * Returns null if `maze` or `maze.grid` is missing/malformed.
 */
export function buildMazeMeshes(
  maze,
  {
    qualityPreset = 'high',
    isSoftwareGl = false,
    hazards = undefined,
    collectibles = undefined,
    keycards = undefined,
    hidingSpots = undefined,
    excludedCells = undefined,
    propDensity = undefined,
    propCount = undefined,
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

  const root = new THREE.Group()
  root.name = 'maze-geometry-root'

  const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset })

  // Resolve gameplay exclusions, props, and floor grate cutouts up front so the
  // floor slab cuts real pit apertures for both hazard grates and safe decoys.
  const resolvedHazards = Array.isArray(hazards)
    ? hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : placeHazards(maze)

  const resolvedHidingSpots = Array.isArray(hidingSpots)
    ? hidingSpots
    : Array.isArray(maze.hidingSpots)
      ? maze.hidingSpots
      : placeHidingSpots(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
        })

  const normalizedExcludedCells =
    excludedCells instanceof Set
      ? Array.from(excludedCells)
      : Array.isArray(excludedCells)
        ? excludedCells
        : []

  const decoyBaseExcludedCells =
    resolvedHidingSpots.length > 0
      ? [...normalizedExcludedCells, ...resolvedHidingSpots]
      : normalizedExcludedCells

  const sandboxConfig = maze?.sandboxConfig || null
  const isEnvEnabled = (id) =>
    !sandboxConfig ||
    isSandboxItemEnabled(
      sandboxConfig,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      id
    )

  const resolvedProps = Array.isArray(maze.environmentalProps)
    ? maze.environmentalProps
    : placeEnvironmentalProps(maze, {
        hazards: resolvedHazards,
        collectibles,
        keycards,
        hidingSpots: resolvedHidingSpots,
        excludedCells,
        density: propDensity,
        count: propCount,
      })

  const decoysEnabled = isEnvEnabled(ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS)
  const sandboxDecoyLayers =
    decoysEnabled && maze.hazardDecoys?.byLayer ? maze.hazardDecoys.byLayer : null

  const resolvedFloorGrateDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.floorGrateDecoys || []
      : placeFloorGrateDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: decoyBaseExcludedCells,
          placedProps: resolvedProps,
        })

  const resolvedWallCollapseDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.wallCollapseDecoys || []
      : placeWallCollapseDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: decoyBaseExcludedCells,
          placedProps: resolvedProps,
        })

  const resolvedWaterTankDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.waterTankDecoys || []
      : placeWaterTankDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: decoyBaseExcludedCells,
          placedProps: resolvedProps,
        })

  const cumulativeDecoyExclusions = [
    ...decoyBaseExcludedCells,
    ...resolvedFloorGrateDecoys,
    ...resolvedWallCollapseDecoys,
    ...resolvedWaterTankDecoys,
  ]

  const resolvedSuspendedMachineryDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.suspendedMachineryDecoys || []
      : placeSuspendedMachineryDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: cumulativeDecoyExclusions,
          placedProps: resolvedProps,
        })
  cumulativeDecoyExclusions.push(...resolvedSuspendedMachineryDecoys)

  const resolvedVentilationDuctDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.ventilationDuctDecoys || []
      : placeVentilationDuctDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: cumulativeDecoyExclusions,
          placedProps: resolvedProps,
        })
  cumulativeDecoyExclusions.push(...resolvedVentilationDuctDecoys)

  const resolvedCeilingCollapseDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.ceilingCollapseDecoys || []
      : placeCeilingCollapseDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: cumulativeDecoyExclusions,
          placedProps: resolvedProps,
        })
  cumulativeDecoyExclusions.push(...resolvedCeilingCollapseDecoys)

  const resolvedElectricalWiringDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.electricalWiringDecoys || []
      : placeElectricalWiringDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: cumulativeDecoyExclusions,
          placedProps: resolvedProps,
        })
  cumulativeDecoyExclusions.push(...resolvedElectricalWiringDecoys)

  const resolvedSteamPipeDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.steamPipeDecoys || []
      : placeSteamPipeDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: cumulativeDecoyExclusions,
          placedProps: resolvedProps,
        })
  cumulativeDecoyExclusions.push(...resolvedSteamPipeDecoys)

  const resolvedFallingPipesDecoys = !decoysEnabled
    ? []
    : sandboxDecoyLayers
      ? sandboxDecoyLayers.fallingPipesDecoys || []
      : placeFallingPipesDecoys(maze, {
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells: cumulativeDecoyExclusions,
          placedProps: resolvedProps,
        })

  const grateCutouts = resolveFloorGrateCutouts(maze, {
    hazards: resolvedHazards,
    decoys: resolvedFloorGrateDecoys,
  })
  const hatchCutouts = resolveFloorHatchCutouts(maze, {
    hidingSpots: resolvedHidingSpots,
  })
  const floorCutouts =
    hatchCutouts.length > 0 ? grateCutouts.concat(hatchCutouts) : grateCutouts

  // 1. Continuous textured concrete floor spanning the entire grid footprint (spatially chunked on larger mazes)
  const chunkLayout = createMazeChunkLayout(maze)
  const floorWidth = cols * CELL_SIZE
  const floorDepth = rows * CELL_SIZE
  const floorCenterX = (topLeft.x + bottomRight.x) / 2
  const floorCenterZ = (topLeft.z + bottomRight.z) / 2

  const worldSeed = maze.seed ?? maze.id ?? 0
  const floorMat = new THREE.MeshStandardMaterial({
    color: MAZE_MESH_PALETTE.floor,
    map: surfaceSet.floor.map,
    roughnessMap: surfaceSet.floor.roughnessMap,
    bumpMap: surfaceSet.floor.bumpMap,
    bumpScale: 0.048,
    roughness: 0.96,
    metalness: 0.015,
    envMapIntensity: 0.48,
    vertexColors: true,
  })
  applyWorldSpaceConcreteShader(floorMat, {
    mode: 'floor',
    seed: worldSeed,
    qualityPreset,
  })

  const floorChunkEntries = []
  if (!chunkLayout.isChunked) {
    const floorGeo = buildOptimizedFloorGeometry({
      width: floorWidth,
      depth: floorDepth,
      thickness: FLOOR_THICKNESS,
      segX: cols * 2,
      segZ: rows * 2,
      skipFaces: 0,
      cutouts: floorCutouts,
      offsetX: floorCenterX,
      offsetZ: floorCenterZ,
    })
    applyFloorGeometrySurfaceDetails(floorGeo, maze, floorWidth, floorDepth)
    floorChunkEntries.push({
      chunkIndex: 0,
      geometry: floorGeo,
      position: new THREE.Vector3(floorCenterX, -FLOOR_THICKNESS / 2, floorCenterZ),
    })
  } else {
    for (let i = 0; i < chunkLayout.chunks.length; i += 1) {
      const chunk = chunkLayout.chunks[i]
      let skipFaces = 0
      if (chunk.cx > 0) skipFaces |= FACE_NEG_X
      if (chunk.cx < chunkLayout.chunkCols - 1) skipFaces |= FACE_POS_X
      if (chunk.cz > 0) skipFaces |= FACE_NEG_Z
      if (chunk.cz < chunkLayout.chunkRows - 1) skipFaces |= FACE_POS_Z

      const chunkGeo = buildOptimizedFloorGeometry({
        width: chunk.width,
        depth: chunk.depth,
        thickness: FLOOR_THICKNESS,
        segX: chunk.cellCols * 2,
        segZ: chunk.cellRows * 2,
        skipFaces,
        cutouts: floorCutouts,
        offsetX: chunk.centerX,
        offsetZ: chunk.centerZ,
      })
      applyFloorGeometrySurfaceDetails(
        chunkGeo,
        maze,
        floorWidth,
        floorDepth,
        chunk.centerX,
        chunk.centerZ
      )
      floorChunkEntries.push({
        chunkIndex: chunk.index,
        geometry: chunkGeo,
        position: new THREE.Vector3(chunk.centerX, -FLOOR_THICKNESS / 2, chunk.centerZ),
      })
    }
  }

  const floorMesh = buildChunkedLayerNode({
    layerName: 'maze-floor',
    chunkEntries: floorChunkEntries,
    material: floorMat,
    castShadow: false,
    receiveShadow: true,
    layout: chunkLayout,
  })
  if (floorMesh) {
    root.add(floorMesh)
  }

  const showSurfaceDecals = isEnvEnabled(
    ENVIRONMENTAL_OBJECT_TYPES.SURFACE_IMPERFECTIONS_GRAFFITI
  )
  const floorImperfectionsMesh = showSurfaceDecals
    ? buildFloorImperfectionMesh(
        maze,
        surfaceSet.floorDetailMaterial,
        { excludedCutouts: floorCutouts }
      )
    : null
  if (floorImperfectionsMesh) {
    root.add(floorImperfectionsMesh)
  }

  // 2. Collect wall cell positions from canonical maze.grid
  const wallPositions = []
  const wallCells = []
  let pathCount = 0

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] === CELL_TYPES.WALL) {
        const worldPos = gridToWorld(r, c, maze)
        if (worldPos) {
          wallPositions.push(worldPos)
          wallCells.push({ r, c, worldPos })
        }
      } else {
        pathCount += 1
      }
    }
  }

  // 3. Instanced weathered concrete walls & precast coping top caps
  let wallMat = null
  let capMat = null
  let wallImperfectionsMesh = null
  let graffitiMesh = null
  if (wallPositions.length > 0) {
    const bodyHeight = Math.max(0.5, WALL_HEIGHT - WALL_CAP_HEIGHT)
    const wallGeo = buildMergedBoxesWithCulling(
      [
        {
          cx: 0,
          cy: 0,
          cz: 0,
          sx: CELL_SIZE,
          sy: bodyHeight,
          sz: CELL_SIZE,
          cullFaces: FACE_BOT,
        },
      ],
      {
        tileUnits: CELL_SIZE,
        worldTileUVs: false,
        storeBoxBounds: false,
        includeVertexColors: false,
      }
    )
    wallMat = new THREE.MeshStandardMaterial({
      color: MAZE_MESH_PALETTE.wallBody,
      map: surfaceSet.wall.map,
      roughnessMap: surfaceSet.wall.roughnessMap,
      bumpMap: surfaceSet.wall.bumpMap,
      bumpScale: 0.056,
      roughness: 0.95,
      metalness: 0.015,
      envMapIntensity: 0.48,
    })
    applyWorldSpaceConcreteShader(wallMat, {
      mode: 'wall',
      seed: worldSeed,
      qualityPreset,
    })

    const capGeo = buildMergedBoxesWithCulling(
      [
        {
          cx: 0,
          cy: 0,
          cz: 0,
          sx: CELL_SIZE * 0.94,
          sy: WALL_CAP_HEIGHT,
          sz: CELL_SIZE * 0.94,
          cullFaces: FACE_BOT,
        },
      ],
      {
        tileUnits: CELL_SIZE,
        worldTileUVs: false,
        storeBoxBounds: false,
        includeVertexColors: false,
      }
    )
    capMat = new THREE.MeshStandardMaterial({
      color: MAZE_MESH_PALETTE.wallBevel,
      map: surfaceSet.cap.map,
      bumpMap: surfaceSet.cap.bumpMap,
      bumpScale: 0.032,
      roughness: 0.88,
      metalness: 0.03,
      envMapIntensity: 0.55,
    })
    applyWorldSpaceConcreteShader(capMat, {
      mode: 'cap',
      seed: worldSeed,
      qualityPreset,
    })

    const wallBuckets = Array.from({ length: chunkLayout.totalChunks }, (_, chunkIndex) => ({
      chunkIndex,
      items: [],
    }))
    const capBuckets = Array.from({ length: chunkLayout.totalChunks }, (_, chunkIndex) => ({
      chunkIndex,
      items: [],
    }))

    const dummy = new THREE.Object3D()
    const instanceTint = new THREE.Color()
    const bodyCenterY = bodyHeight / 2
    const capCenterY = bodyHeight + WALL_CAP_HEIGHT / 2

    for (let i = 0; i < wallCells.length; i += 1) {
      const { r, c, worldPos } = wallCells[i]
      const { x, z } = worldPos
      const chunkIdx = chunkLayout.getChunkIndex(x, z)

      // Deterministic subtle per-column weathered concrete shade & dampness jitter
      const hashA = (((r * 73856093) ^ (c * 19349663)) >>> 0) / 4294967295
      const hashB = (((r * 83492791) ^ (c * 2971215073)) >>> 0) / 4294967295
      const wallTone = 0.89 + hashA * 0.16
      const chromaShift = (hashB - 0.5) * 0.045
      instanceTint.setRGB(
        wallTone + chromaShift,
        wallTone + (hashB > 0.65 ? 0.012 : 0),
        wallTone - chromaShift * 0.6,
        THREE.SRGBColorSpace
      )

      dummy.position.set(x, bodyCenterY, z)
      dummy.updateMatrix()
      wallBuckets[chunkIdx].items.push({
        sourceIndex: i,
        matrix: dummy.matrix.clone(),
        color: instanceTint.clone(),
      })

      const capTone = 0.9 + hashA * 0.14
      instanceTint.setRGB(capTone, capTone, capTone, THREE.SRGBColorSpace)
      dummy.position.set(x, capCenterY, z)
      dummy.updateMatrix()
      capBuckets[chunkIdx].items.push({
        sourceIndex: i,
        matrix: dummy.matrix.clone(),
        color: instanceTint.clone(),
      })
    }

    const wallNode = buildChunkedInstancedLayerNode({
      layerName: 'maze-walls',
      chunkBuckets: wallBuckets,
      geometry: wallGeo,
      material: wallMat,
      castShadow: true,
      receiveShadow: true,
      layout: chunkLayout,
      trackColors: true,
    })
    const capNode = buildChunkedInstancedLayerNode({
      layerName: 'maze-wall-caps',
      chunkBuckets: capBuckets,
      geometry: capGeo,
      material: capMat,
      castShadow: true,
      receiveShadow: true,
      layout: chunkLayout,
      trackColors: true,
    })

    if (wallNode) root.add(wallNode)
    if (capNode) root.add(capNode)

    wallImperfectionsMesh = showSurfaceDecals
      ? buildWallImperfectionMesh(
          maze,
          surfaceSet.wallDetailMaterial,
          bodyHeight
        )
      : null
    if (wallImperfectionsMesh) {
      root.add(wallImperfectionsMesh)
    }

    // Selective, restrained facility graffiti merged into 1 static decal mesh
    graffitiMesh = showSurfaceDecals
      ? buildSelectiveGraffitiMesh(
          maze,
          surfaceSet.graffitiMaterial,
          bodyHeight
        )
      : null
    if (graffitiMesh) {
      root.add(graffitiMesh)
    }
  }

  // 4. Procedural Broken Start Elevator & Emergency Extraction Elevator
  let startElevator = null
  if (maze.start && isEnvEnabled(ENVIRONMENTAL_OBJECT_TYPES.BROKEN_START_ELEVATOR)) {
    const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)
    if (startWorld) {
      startElevator = createBrokenStartElevator(startWorld, maze, { qualityPreset })
      root.add(startElevator)
    }
  }

  let exitGate = null
  if (maze.exit && isEnvEnabled(ENVIRONMENTAL_OBJECT_TYPES.EXTRACTION_ELEVATOR)) {
    const exitWorld = gridToWorld(maze.exit.row, maze.exit.col, maze)
    if (exitWorld) {
      exitGate = createExtractionElevator(exitWorld, maze, { qualityPreset })
      root.add(exitGate)
    }
  }

  // 5. Heavy underground industrial concrete roof slab, beams & wall-engaged pilasters
  const ceilingGroup = buildMazeCeiling(maze, {
    surfaceSet,
    worldSeed,
    qualityPreset,
    isSoftwareGl,
  })
  if (ceilingGroup) {
    root.add(ceilingGroup)
  }

  // 5b. Vertical Elevator Shaft Openings & Procedural Shaft Interiors (start damaged + extraction industrial)
  const elevatorShaftsGroup = isEnvEnabled(ENVIRONMENTAL_OBJECT_TYPES.ELEVATOR_SHAFTS)
    ? buildElevatorShafts(maze, {
        surfaceSet,
        worldSeed,
        qualityPreset,
      })
    : null
  if (elevatorShaftsGroup) {
    root.add(elevatorShaftsGroup)
  }

  // 6. Procedural structural concrete deterioration (localized cracks, spalling, cavities, sparse rebar)
  const bodyHeight = Math.max(0.5, WALL_HEIGHT - WALL_CAP_HEIGHT)
  const structuralDeteriorationGroup =
    wallPositions.length > 0 &&
    isEnvEnabled(ENVIRONMENTAL_OBJECT_TYPES.STRUCTURAL_DETERIORATION)
      ? buildStructuralDeterioration(maze, {
          qualityPreset,
          bodyHeight,
          hazards: resolvedHazards,
          collectibles,
          keycards,
          excludedCells,
          propDensity,
          propCount,
          props: resolvedProps,
        })
      : null
  if (structuralDeteriorationGroup) {
    root.add(structuralDeteriorationGroup)
  }

  // 7. Procedural environmental props (instanced broken desks, storage shelves, filing cabinets, barrels, debris)
  const environmentalPropsGroup =
    resolvedProps.length > 0
      ? buildEnvironmentalProps(maze, {
          qualityPreset,
          hazards: resolvedHazards,
          collectibles,
          keycards,
          hidingSpots: resolvedHidingSpots,
          excludedCells,
          density: propDensity,
          count: propCount,
          placedProps: resolvedProps,
        })
      : null
  if (environmentalPropsGroup) {
    root.add(environmentalPropsGroup)
  }

  // 8. Safe solid intact floor grate decoys recessed into matching real floor/plinth shafts
  const floorGrateDecoysGroup = buildFloorGrateDecoys(maze, resolvedFloorGrateDecoys, {
    qualityPreset,
  })
  if (floorGrateDecoysGroup) {
    root.add(floorGrateDecoysGroup)
  }

  // 9. Safe structurally solid wall deterioration decoys matching dormant wall_collapse bays
  const wallCollapseDecoysGroup = buildWallCollapseDecoys(
    maze,
    resolvedWallCollapseDecoys,
    { qualityPreset }
  )
  if (wallCollapseDecoysGroup) {
    root.add(wallCollapseDecoysGroup)
  }

  // 10. Safe intact overhead industrial water tank decoys matching dormant falling_water_tank bays
  const waterTankDecoysGroup = buildWaterTankDecoys(
    maze,
    resolvedWaterTankDecoys,
    { qualityPreset }
  )
  if (waterTankDecoysGroup) {
    root.add(waterTankDecoysGroup)
  }

  // 11. Safe intact overhead suspended machinery decoys matching dormant falling_suspended_machinery bays
  const suspendedMachineryDecoysGroup = buildSuspendedMachineryDecoys(
    maze,
    resolvedSuspendedMachineryDecoys,
    { qualityPreset }
  )
  if (suspendedMachineryDecoysGroup) {
    root.add(suspendedMachineryDecoysGroup)
  }

  // 12. Safe intact overhead ventilation duct decoys matching dormant ventilation_duct_collapse bays
  const ventilationDuctDecoysGroup = buildVentilationDuctDecoys(
    maze,
    resolvedVentilationDuctDecoys,
    { qualityPreset }
  )
  if (ventilationDuctDecoysGroup) {
    root.add(ventilationDuctDecoysGroup)
  }

  // 13. Safe intact precast ceiling soffit bay decoys matching dormant ceiling_collapse bays
  const ceilingCollapseDecoysGroup = buildCeilingCollapseDecoys(
    maze,
    resolvedCeilingCollapseDecoys,
    { qualityPreset }
  )
  if (ceilingCollapseDecoysGroup) {
    root.add(ceilingCollapseDecoysGroup)
  }

  // 14. Safe intact electrical panel + conduit decoys matching dormant exposed_electrical_wiring
  const electricalWiringDecoysGroup = buildElectricalWiringDecoys(
    maze,
    resolvedElectricalWiringDecoys,
    { qualityPreset }
  )
  if (electricalWiringDecoysGroup) {
    root.add(electricalWiringDecoysGroup)
  }

  // 15. Safe intact pressurized steam pipe decoys matching dormant steam_pipe_burst lines
  const steamPipeDecoysGroup = buildSteamPipeDecoys(
    maze,
    resolvedSteamPipeDecoys,
    { qualityPreset }
  )
  if (steamPipeDecoysGroup) {
    root.add(steamPipeDecoysGroup)
  }

  // 16. Safe intact overhead pipe & valve decoys matching dormant falling_pipes_fixtures
  const fallingPipesDecoysGroup = buildFallingPipesDecoys(
    maze,
    resolvedFallingPipesDecoys,
    { qualityPreset }
  )
  if (fallingPipesDecoysGroup) {
    root.add(fallingPipesDecoysGroup)
  }

  root.userData = {
    mazeId: maze.id || null,
    rows,
    cols,
    wallCount: wallPositions.length,
    pathCount,
    floorWidth,
    floorDepth,
    chunkLayout: {
      chunkCols: chunkLayout.chunkCols,
      chunkRows: chunkLayout.chunkRows,
      isChunked: chunkLayout.isChunked,
    },
    startElevator,
    exitGate,
    wallPositions,
    floorMat,
    wallMat,
    capMat,
    ceilingGroup,
    elevatorShaftsGroup,
    structuralDeteriorationGroup,
    environmentalPropsGroup,
    ceilingMat: ceilingGroup?.userData?.ceilingMat || null,
    beamMat: ceilingGroup?.userData?.beamMat || null,
    pillarMat: ceilingGroup?.userData?.pillarMat || null,
    floorImperfectionsMesh,
    wallImperfectionsMesh,
    ceilingImperfectionsMesh: ceilingGroup?.userData?.ceilingImperfectionsMesh || null,
    ceilingVentsGroup: ceilingGroup?.userData?.ceilingVentsGroup || null,
    ceilingLightsGroup: ceilingGroup?.userData?.ceilingLightsGroup || null,
    ceilingElectricalGroup: ceilingGroup?.userData?.ceilingElectricalGroup || null,
    graffitiMesh,
    floorImperfectionCount: floorImperfectionsMesh?.userData?.decalCount || 0,
    wallImperfectionCount: wallImperfectionsMesh?.userData?.decalCount || 0,
    ceilingImperfectionCount: ceilingGroup?.userData?.ceilingImperfectionCount || 0,
    pilasterCount: ceilingGroup?.userData?.pilasterCount || 0,
    exteriorButtressCount: ceilingGroup?.userData?.exteriorButtressCount || 0,
    ductTrunkCount: ceilingGroup?.userData?.ductTrunkCount || 0,
    ceilingVentCount: ceilingGroup?.userData?.ceilingVentCount || 0,
    ceilingLightCount: ceilingGroup?.userData?.ceilingLightCount || 0,
    workingLightCount: ceilingGroup?.userData?.workingLightCount || 0,
    flickeringLightCount: ceilingGroup?.userData?.flickeringLightCount || 0,
    burnedOutLightCount: ceilingGroup?.userData?.burnedOutLightCount || 0,
    conduitRunCount: ceilingGroup?.userData?.conduitRunCount || 0,
    cableTrayCount: ceilingGroup?.userData?.cableTrayCount || 0,
    junctionBoxCount: ceilingGroup?.userData?.junctionBoxCount || 0,
    damagedElectricalCount: ceilingGroup?.userData?.damagedElectricalCount || 0,
    graffitiCount: graffitiMesh?.userData?.decalCount || 0,
    structuralDeteriorationCount:
      structuralDeteriorationGroup?.userData?.totalSites || 0,
    structuralDeteriorationProfiles:
      structuralDeteriorationGroup?.userData?.profileCounts || null,
    environmentalPropCount: environmentalPropsGroup?.userData?.propCount || 0,
    floorGrateDecoysGroup,
    floorGrateDecoyCount: resolvedFloorGrateDecoys.length,
    wallCollapseDecoysGroup,
    wallCollapseDecoyCount: resolvedWallCollapseDecoys.length,
    waterTankDecoysGroup,
    waterTankDecoyCount: resolvedWaterTankDecoys.length,
    suspendedMachineryDecoysGroup,
    suspendedMachineryDecoyCount: resolvedSuspendedMachineryDecoys.length,
    ventilationDuctDecoysGroup,
    ventilationDuctDecoyCount: resolvedVentilationDuctDecoys.length,
    ceilingCollapseDecoysGroup,
    ceilingCollapseDecoyCount: resolvedCeilingCollapseDecoys.length,
    electricalWiringDecoysGroup,
    electricalWiringDecoyCount: resolvedElectricalWiringDecoys.length,
    steamPipeDecoysGroup,
    steamPipeDecoyCount: resolvedSteamPipeDecoys.length,
    fallingPipesDecoysGroup,
    fallingPipesDecoyCount: resolvedFallingPipesDecoys.length,
    hidingSpotCount: resolvedHidingSpots.length,
    floorCutoutCount: floorCutouts.length,
    floorCutouts,
  }

  return root
}

/**
 * Safely disposes all geometries, materials, and child objects owned by a
 * maze geometry group and detaches it from its parent scene if attached.
 */
export function disposeMazeGroup(group) {
  if (!group) return false

  const disposedGeometries = new Set()
  const disposedMaterials = new Set()

  group.traverse((node) => {
    if (
      node.geometry &&
      !isSharedResource(node.geometry) &&
      !disposedGeometries.has(node.geometry)
    ) {
      disposedGeometries.add(node.geometry)
      if (typeof node.geometry.dispose === 'function') {
        node.geometry.dispose()
      }
    }

    if (node.material) {
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material]
      for (let i = 0; i < materials.length; i += 1) {
        const mat = materials[i]
        if (mat && !isSharedResource(mat) && !disposedMaterials.has(mat)) {
          disposedMaterials.add(mat)
          if (typeof mat.dispose === 'function') {
            mat.dispose()
          }
        }
      }
    }

    if (typeof node.dispose === 'function' && node !== group) {
      node.dispose()
    }
  })

  const lightsUd = group.userData?.ceilingLightsGroup?.userData
  if (lightsUd) {
    lightsUd._diffuserColorCache = null
    lightsUd._haloColorCache = null
    lightsUd._diffuserDirtyChunks = null
    lightsUd._haloDirtyChunks = null
    lightsUd.diffuserTargets = null
    lightsUd.haloTargets = null
    lightsUd.diffuserMeshes = null
    lightsUd.haloMeshes = null
    lightsUd._diffuserColorsInitialized = false
    lightsUd._haloColorsInitialized = false
  }

  const waterTankUd = group.userData?.waterTankDecoysGroup?.userData
  if (waterTankUd) {
    waterTankUd.dripStates = null
    waterTankUd.decoyDripsInst = null
  }

  if (group.parent) {
    group.parent.remove(group)
  }
  group.clear()

  return true
}
