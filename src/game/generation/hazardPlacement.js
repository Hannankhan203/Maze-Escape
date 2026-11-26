import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'
import {
  HAZARD_TYPES,
  STANDARD_HAZARD_COUNT,
  STANDARD_HAZARD_TYPES,
} from './hazardTypes.js'
import {
  normalizeLevel,
  selectHazardsForLevel,
} from '../mechanics/levelProgression.js'
import { findHidingSpotConflictForHazard } from './placementCoexistence.js'

export { HAZARD_TYPES, STANDARD_HAZARD_COUNT, STANDARD_HAZARD_TYPES }

const WALL_MOUNT_DIRECTIONS = [
  { side: 'north', dr: -1, dc: 0, yaw: 0 },
  { side: 'south', dr: 1, dc: 0, yaw: Math.PI },
  { side: 'west', dr: 0, dc: -1, yaw: Math.PI * 0.5 },
  { side: 'east', dr: 0, dc: 1, yaw: -Math.PI * 0.5 },
]

const WALL_DISCHARGE_LOCAL_X = 0.26
const WALL_DISCHARGE_LOCAL_Y = 1.32
const WALL_DISCHARGE_LOCAL_Z = -1.38
const WALL_JUNCTION_LOCAL_X = 0.26
const WALL_JUNCTION_LOCAL_Y = 1.62
const WALL_JUNCTION_LOCAL_Z = -1.92
const WALL_BREAKER_LOCAL_X = -0.78
const WALL_BREAKER_LOCAL_Y = 1.32
const WALL_BREAKER_LOCAL_Z = -1.88

const CEILING_DISCHARGE_LOCAL_X = 0.26
const CEILING_DISCHARGE_LOCAL_Y = 1.65
const CEILING_DISCHARGE_LOCAL_Z = 0
const CEILING_JUNCTION_LOCAL_X = 0.26
const CEILING_JUNCTION_LOCAL_Y = 3.22
const CEILING_JUNCTION_LOCAL_Z = 0
const CEILING_BREAKER_LOCAL_X = -0.82
const CEILING_BREAKER_LOCAL_Y = 1.48
const CEILING_BREAKER_LOCAL_Z = 0

export const ELECTRICAL_WIRING_CONSTANTS = Object.freeze({
  wallDischargeLocalX: WALL_DISCHARGE_LOCAL_X,
  wallDischargeLocalY: WALL_DISCHARGE_LOCAL_Y,
  wallDischargeLocalZ: WALL_DISCHARGE_LOCAL_Z,
  ceilingDischargeLocalX: CEILING_DISCHARGE_LOCAL_X,
  ceilingDischargeLocalY: CEILING_DISCHARGE_LOCAL_Y,
  ceilingDischargeLocalZ: CEILING_DISCHARGE_LOCAL_Z,
  decoyLayerName: 'maze-electrical-wiring-decoys',
})

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

function normalizeZero(value) {
  return Math.abs(value) < 1e-9 ? 0 : value
}

/**
 * Inspects adjacent maze walls for (row, col) and resolves a believable
 * electrical mounting configuration ('wall' flush on an adjacent corridor wall
 * clear of corner pilasters, or 'ceiling' hanging from an overhead trapeze mount
 * in open 4-way intersections), along with an upstream isolation breaker switch.
 */
export function resolveElectricalMount(grid, row, col, rng = null, preferredSide = null) {
  const rows = Array.isArray(grid) ? grid.length : 0
  const cols = rows > 0 && Array.isArray(grid[0]) ? grid[0].length : 0
  const r = Number.isInteger(row) ? row : 1
  const c = Number.isInteger(col) ? col : 1

  const adjacentWalls = []
  if (rows > 0 && cols > 0) {
    for (let i = 0; i < WALL_MOUNT_DIRECTIONS.length; i += 1) {
      const dir = WALL_MOUNT_DIRECTIONS[i]
      const nr = r + dir.dr
      const nc = c + dir.dc
      if (grid[nr]?.[nc] === CELL_TYPES.WALL) {
        const isBoundaryWall =
          nr <= 0 || nr >= rows - 1 || nc <= 0 || nc >= cols - 1
        const hasOppositePath = grid[r - dir.dr]?.[c - dir.dc] === CELL_TYPES.PATH
        const perpOpenA = grid[r + dir.dc]?.[c + dir.dr] === CELL_TYPES.PATH
        const perpOpenB = grid[r - dir.dc]?.[c - dir.dr] === CELL_TYPES.PATH
        const isCorridorSideWall = perpOpenA || perpOpenB
        adjacentWalls.push({
          ...dir,
          wallRow: nr,
          wallCol: nc,
          isBoundaryWall,
          hasOppositePath,
          isCorridorSideWall,
        })
      }
    }
  }

  if (adjacentWalls.length > 0) {
    let chosen = null
    if (preferredSide) {
      chosen = adjacentWalls.find((d) => d.side === preferredSide) || null
    }
    if (!chosen) {
      const sideWithOpp = adjacentWalls.filter(
        (w) => w.isCorridorSideWall && w.hasOppositePath
      )
      const sideWalls = adjacentWalls.filter((w) => w.isCorridorSideWall)
      const interiorWalls = adjacentWalls.filter((w) => !w.isBoundaryWall)
      const pool =
        sideWithOpp.length > 0
          ? sideWithOpp
          : sideWalls.length > 0
            ? sideWalls
            : interiorWalls.length > 0
              ? interiorWalls
              : adjacentWalls
      const idx =
        typeof rng === 'function'
          ? Math.floor(rng() * pool.length) % pool.length
          : 0
      chosen = pool[idx]
    }
    const cosYaw = Math.cos(chosen.yaw)
    const sinYaw = Math.sin(chosen.yaw)
    const toCellWorld = (lx, lz) => ({
      x: normalizeZero(lx * cosYaw + lz * sinYaw),
      z: normalizeZero(-lx * sinYaw + lz * cosYaw),
    })
    const dischargeWorld = toCellWorld(WALL_DISCHARGE_LOCAL_X, WALL_DISCHARGE_LOCAL_Z)
    const junctionWorld = toCellWorld(WALL_JUNCTION_LOCAL_X, WALL_JUNCTION_LOCAL_Z)
    const breakerWorld = toCellWorld(WALL_BREAKER_LOCAL_X, WALL_BREAKER_LOCAL_Z)

    return {
      mountType: 'wall',
      wallSide: chosen.side,
      wallRow: chosen.wallRow,
      wallCol: chosen.wallCol,
      wallYaw: normalizeZero(chosen.yaw),
      localDischargeOffset: {
        x: dischargeWorld.x,
        y: WALL_DISCHARGE_LOCAL_Y,
        z: dischargeWorld.z,
      },
      localJunctionOffset: {
        x: junctionWorld.x,
        y: WALL_JUNCTION_LOCAL_Y,
        z: junctionWorld.z,
      },
      localBreakerOffset: {
        x: breakerWorld.x,
        y: WALL_BREAKER_LOCAL_Y,
        z: breakerWorld.z,
      },
    }
  }

  return {
    mountType: 'ceiling',
    wallSide: null,
    wallRow: null,
    wallCol: null,
    wallYaw: 0,
    localDischargeOffset: {
      x: CEILING_DISCHARGE_LOCAL_X,
      y: CEILING_DISCHARGE_LOCAL_Y,
      z: CEILING_DISCHARGE_LOCAL_Z,
    },
    localJunctionOffset: {
      x: CEILING_JUNCTION_LOCAL_X,
      y: CEILING_JUNCTION_LOCAL_Y,
      z: CEILING_JUNCTION_LOCAL_Z,
    },
    localBreakerOffset: {
      x: CEILING_BREAKER_LOCAL_X,
      y: CEILING_BREAKER_LOCAL_Y,
      z: CEILING_BREAKER_LOCAL_Z,
    },
  }
}

export const FLOOR_GRATE_CONSTANTS = Object.freeze({
  pitInnerHalfW: 0.58,
  pitInnerHalfD: 0.64,
  frameOuterHalfW: 0.67,
  frameOuterHalfD: 0.73,
  pitDepth: 0.68,
  colliderHalfW: 0.62,
  colliderHalfD: 0.68,
  offsetSideMag: 0.78,
  offsetCornerDepthMag: 0.76,
  decoyLayerName: 'maze-floor-grate-decoys',
})

/**
 * Resolves floor-flush grate orientation aligned with the local corridor axis
 * so the recessed industrial drainage grate integrates cleanly into the floor
 * at y = 0 without floating or intersecting adjacent walls.
 */
export function resolveFloorGrateOrientation(grid, row, col) {
  let openNS = 0
  let openEW = 0
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    if (grid[row - 1]?.[col] === CELL_TYPES.PATH) openNS += 1
    if (grid[row + 1]?.[col] === CELL_TYPES.PATH) openNS += 1
    if (grid[row]?.[col - 1] === CELL_TYPES.PATH) openEW += 1
    if (grid[row]?.[col + 1] === CELL_TYPES.PATH) openEW += 1
  }

  const corridorAxis = openEW > openNS ? 'ew' : 'ns'
  const grateYaw = corridorAxis === 'ew' ? Math.PI * 0.5 : 0
  return {
    floorY: 0,
    corridorAxis,
    grateYaw,
  }
}

/**
 * Resolves a structurally integrated, non-blocking placement inside cell `(row, col)`
 * for both collapsing floor grates and visually matching intact safe decoy grates.
 * Tucks the pit/curb toward an adjacent wall or corner bay so a >= 2.08m wide
 * unobstructed corridor walkway always remains available (>= 1.60m clearance).
 */
export function resolveFloorGrateMount(grid, row, col, rng = null) {
  const orient = resolveFloorGrateOrientation(grid, row, col)
  const r = Number.isInteger(row) ? row : 0
  const c = Number.isInteger(col) ? col : 0

  const nOpen = Boolean(Array.isArray(grid) && grid[r - 1]?.[c] === CELL_TYPES.PATH)
  const sOpen = Boolean(Array.isArray(grid) && grid[r + 1]?.[c] === CELL_TYPES.PATH)
  const wOpen = Boolean(Array.isArray(grid) && grid[r]?.[c - 1] === CELL_TYPES.PATH)
  const eOpen = Boolean(Array.isArray(grid) && grid[r]?.[c + 1] === CELL_TYPES.PATH)

  const pickSign = (salt) => {
    if (typeof rng === 'function') {
      return rng() < 0.5 ? -1 : 1
    }
    const h = ((r * 73856093) ^ (c * 19349663) ^ salt) >>> 0
    return (h & 1) === 0 ? -1 : 1
  }

  const sideMag = FLOOR_GRATE_CONSTANTS.offsetSideMag
  const cornerMag = FLOOR_GRATE_CONSTANTS.offsetCornerDepthMag
  let wx
  let wz

  if (!wOpen && !eOpen) {
    // NS straight or dead-end: flank along West or East wall
    wx = pickSign(101) * sideMag
    wz = 0
  } else if (!nOpen && !sOpen) {
    // EW straight or dead-end: flank along North or South wall
    wx = 0
    wz = pickSign(211) * sideMag
  } else if (!wOpen && eOpen && nOpen && sOpen) {
    // T-junction with West wall closed
    wx = -sideMag
    wz = 0
  } else if (wOpen && !eOpen && nOpen && sOpen) {
    // T-junction with East wall closed
    wx = sideMag
    wz = 0
  } else if (!nOpen && sOpen && wOpen && eOpen) {
    // T-junction with North wall closed
    wx = 0
    wz = -sideMag
  } else if (nOpen && !sOpen && wOpen && eOpen) {
    // T-junction with South wall closed
    wx = 0
    wz = sideMag
  } else if (!nOpen || !sOpen || !wOpen || !eOpen) {
    // L-corner: tuck into closed corner bay
    wx = !wOpen ? -sideMag : !eOpen ? sideMag : pickSign(307) * sideMag
    wz = !nOpen ? -cornerMag : !sOpen ? cornerMag : pickSign(409) * cornerMag
  } else {
    // 4-way intersection: tuck cleanly into one corner quadrant
    wx = pickSign(307) * sideMag
    wz = pickSign(409) * cornerMag
  }

  const isRotatedEW = Math.abs(Math.sin(orient.grateYaw)) > 0.5
  return {
    floorY: 0,
    corridorAxis: orient.corridorAxis,
    grateYaw: orient.grateYaw,
    localPitOffset: {
      x: normalizeZero(wx),
      y: 0,
      z: normalizeZero(wz),
    },
    pitInnerHalfW: FLOOR_GRATE_CONSTANTS.pitInnerHalfW,
    pitInnerHalfD: FLOOR_GRATE_CONSTANTS.pitInnerHalfD,
    frameOuterHalfW: FLOOR_GRATE_CONSTANTS.frameOuterHalfW,
    frameOuterHalfD: FLOOR_GRATE_CONSTANTS.frameOuterHalfD,
    pitDepth: FLOOR_GRATE_CONSTANTS.pitDepth,
    aftermathHalfW: FLOOR_GRATE_CONSTANTS.colliderHalfW,
    aftermathHalfD: FLOOR_GRATE_CONSTANTS.colliderHalfD,
    worldInnerHalfW: isRotatedEW
      ? FLOOR_GRATE_CONSTANTS.pitInnerHalfD
      : FLOOR_GRATE_CONSTANTS.pitInnerHalfW,
    worldInnerHalfD: isRotatedEW
      ? FLOOR_GRATE_CONSTANTS.pitInnerHalfW
      : FLOOR_GRATE_CONSTANTS.pitInnerHalfD,
  }
}

/**
 * Resolves the world-space XZ cutout aperture rectangle for a floor grate
 * hazard or safe decoy spec so `maze-floor` and `maze-env-plinth` expose a real
 * vertical cavity below y = 0.
 */
export function getFloorGrateOpeningRect(spec, maze) {
  const grid = maze?.grid
  const rows = Array.isArray(grid) ? grid.length : 0
  const cols = rows > 0 && Array.isArray(grid[0]) ? grid[0].length : 0
  if (!spec || !Number.isInteger(spec.row) || !Number.isInteger(spec.col) || rows === 0 || cols === 0) {
    return null
  }
  const originX = -(cols * CELL_SIZE) * 0.5
  const originZ = -(rows * CELL_SIZE) * 0.5
  const cellCenterX = originX + (spec.col + 0.5) * CELL_SIZE
  const cellCenterZ = originZ + (spec.row + 0.5) * CELL_SIZE
  const fallback =
    spec.localPitOffset && Number.isFinite(spec.grateYaw)
      ? null
      : resolveFloorGrateMount(grid, spec.row, spec.col)
  const localOff = spec.localPitOffset || fallback?.localPitOffset || { x: 0, y: 0, z: 0 }
  const yaw = Number.isFinite(spec.grateYaw) ? spec.grateYaw : fallback?.grateYaw || 0
  const rotatedEW = Math.abs(Math.sin(yaw)) > 0.5
  const innerHalfW = Number.isFinite(spec.pitInnerHalfW)
    ? spec.pitInnerHalfW
    : FLOOR_GRATE_CONSTANTS.pitInnerHalfW
  const innerHalfD = Number.isFinite(spec.pitInnerHalfD)
    ? spec.pitInnerHalfD
    : FLOOR_GRATE_CONSTANTS.pitInnerHalfD
  const halfW = rotatedEW ? innerHalfD : innerHalfW
  const halfD = rotatedEW ? innerHalfW : innerHalfD
  const cx = normalizeZero(cellCenterX + (Number(localOff.x) || 0))
  const cz = normalizeZero(cellCenterZ + (Number(localOff.z) || 0))

  return {
    id: spec.id || `grate-${spec.row}-${spec.col}`,
    kind: spec.isDecoy ? 'decoy' : 'hazard',
    row: spec.row,
    col: spec.col,
    cx,
    cz,
    halfW,
    halfD,
    minX: normalizeZero(cx - halfW),
    maxX: normalizeZero(cx + halfW),
    minZ: normalizeZero(cz - halfD),
    maxZ: normalizeZero(cz + halfD),
    yaw,
  }
}

/**
 * Places visually matching, structurally solid non-hazard floor drain grates
 * across walkable corridor cells so grate geometry alone never telegraphs traps.
 */
export function placeFloorGrateDecoys(
  maze,
  {
    hazards = undefined,
    collectibles = undefined,
    keycards = undefined,
    hidingSpots = undefined,
    excludedCells = undefined,
    placedProps = undefined,
  } = {}
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !maze?.start || !maze?.exit) {
    return []
  }

  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) return []

  const resolvedHazards = Array.isArray(hazards)
    ? hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : placeHazards(maze)

  const resolvedCollectibles = Array.isArray(collectibles)
    ? collectibles
    : Array.isArray(maze.collectibles?.items)
      ? maze.collectibles.items
      : []

  const resolvedKeycards = Array.isArray(keycards)
    ? keycards
    : Array.isArray(maze.keycards)
      ? maze.keycards
      : []

  const resolvedHidingSpots = Array.isArray(hidingSpots)
    ? hidingSpots
    : Array.isArray(maze.hidingSpots)
      ? maze.hidingSpots
      : []

  const blockedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
  ])
  const grateCells = []

  for (let i = 0; i < resolvedHazards.length; i += 1) {
    const h = resolvedHazards[i]
    if (!h) continue
    blockedKeys.add(`${h.row},${h.col}`)
    if (h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      grateCells.push({ row: h.row, col: h.col })
    }
  }
  for (let i = 0; i < resolvedCollectibles.length; i += 1) {
    const item = resolvedCollectibles[i]
    if (item && Number.isInteger(item.row) && Number.isInteger(item.col)) {
      blockedKeys.add(`${item.row},${item.col}`)
    }
  }
  for (let i = 0; i < resolvedKeycards.length; i += 1) {
    const kc = resolvedKeycards[i]
    if (kc && Number.isInteger(kc.row) && Number.isInteger(kc.col)) {
      blockedKeys.add(`${kc.row},${kc.col}`)
    }
  }
  if (Array.isArray(placedProps)) {
    for (let i = 0; i < placedProps.length; i += 1) {
      const p = placedProps[i]
      if (p && Number.isInteger(p.row) && Number.isInteger(p.col)) {
        blockedKeys.add(`${p.row},${p.col}`)
      }
    }
  }
  for (let i = 0; i < resolvedHidingSpots.length; i += 1) {
    const hs = resolvedHidingSpots[i]
    if (hs && Number.isInteger(hs.row) && Number.isInteger(hs.col)) {
      blockedKeys.add(`${hs.row},${hs.col}`)
    }
  }
  if (excludedCells) {
    const entries =
      excludedCells instanceof Set
        ? Array.from(excludedCells)
        : Array.isArray(excludedCells)
          ? excludedCells
          : []
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (typeof entry === 'string') {
        blockedKeys.add(entry)
      } else if (entry && Number.isInteger(entry.row) && Number.isInteger(entry.col)) {
        blockedKeys.add(`${entry.row},${entry.col}`)
      }
    }
  }

  let walkableCount = 0
  const candidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      const key = `${r},${c}`
      if (blockedKeys.has(key)) continue
      const nearStart =
        Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2
      if (nearStart) continue
      candidates.push({ row: r, col: c })
    }
  }

  if (candidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-floor-grate-decoys-v1`)
  const shuffled = shuffleWithRng(candidates, rng)
  const targetCount = Math.max(2, Math.min(8, Math.round(walkableCount / 32)))
  const decoys = []

  for (let i = 0; i < shuffled.length && decoys.length < targetCount; i += 1) {
    const cand = shuffled[i]
    const tooClose = grateCells.some(
      (gc) => Math.abs(gc.row - cand.row) + Math.abs(gc.col - cand.col) <= 1
    )
    if (tooClose) continue

    const mount = resolveFloorGrateMount(grid, cand.row, cand.col, rng)
    grateCells.push({ row: cand.row, col: cand.col })
    decoys.push({
      id: `floor-grate-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      row: cand.row,
      col: cand.col,
      ...mount,
    })
  }

  return decoys
}

/**
 * Resolves all floor grate aperture cutout rectangles (hazard grates + safe
 * intact decoy grates) for subtractive floor slab & plinth cavity construction.
 */
export function resolveFloorGrateCutouts(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return []
  }

  const resolvedHazards = Array.isArray(options?.hazards)
    ? options.hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : placeHazards(maze)

  const floorHazardSpecs = resolvedHazards.filter(
    (h) => h && h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE
  )
  const resolvedDecoys = Array.isArray(options?.decoys)
    ? options.decoys
    : placeFloorGrateDecoys(maze, {
        hazards: resolvedHazards,
        collectibles: options?.collectibles,
        keycards: options?.keycards,
        hidingSpots: options?.hidingSpots,
        excludedCells: options?.excludedCells,
        placedProps: options?.placedProps,
      })

  const cutouts = []
  const combined = floorHazardSpecs.concat(resolvedDecoys)
  for (let i = 0; i < combined.length; i += 1) {
    const rect = getFloorGrateOpeningRect(combined[i], maze)
    if (rect) {
      cutouts.push(rect)
    }
  }
  return cutouts
}

export const WALL_COLLAPSE_CONSTANTS = {
  sectionHalfWidth: 1.02,
  sectionHeight: 2.38,
  slabWidth: 0.94,
  slabHeight: 1.04,
  slabThickness: 0.044,
  impactLocalZ: -1.32,
  impactLocalY: 0.95,
  dangerHalfW: 1.14,
  dangerMinLocalZ: -2.04,
  dangerMaxLocalZ: -0.76,
  aftermathLocalZ: -1.42,
  aftermathHalfW: 1.08,
  aftermathHalfD: 0.58,
  decoyLayerName: 'maze-wall-collapse-decoys',
}

/**
 * Inspects adjacent maze walls for (row, col) and resolves a structurally valid
 * wall section for `wall_collapse`, preferring interior corridor side walls over
 * dead-end caps or outer boundary walls while never modifying maze.grid.
 */
export function resolveWallCollapseMount(grid, row, col, rng = null, preferredSide = null) {
  const rows = Array.isArray(grid) ? grid.length : 0
  const cols = rows > 0 && Array.isArray(grid[0]) ? grid[0].length : 0
  const adjacentWalls = []

  if (rows > 0 && cols > 0 && Number.isInteger(row) && Number.isInteger(col)) {
    for (let i = 0; i < WALL_MOUNT_DIRECTIONS.length; i += 1) {
      const dir = WALL_MOUNT_DIRECTIONS[i]
      const wr = row + dir.dr
      const wc = col + dir.dc
      if (grid[wr]?.[wc] === CELL_TYPES.WALL) {
        const isBoundaryWall =
          wr === 0 || wr === rows - 1 || wc === 0 || wc === cols - 1
        const perpOpenA = grid[row + dir.dc]?.[col + dir.dr] === CELL_TYPES.PATH
        const perpOpenB = grid[row - dir.dc]?.[col - dir.dr] === CELL_TYPES.PATH
        adjacentWalls.push({
          ...dir,
          wallRow: wr,
          wallCol: wc,
          isBoundaryWall,
          isCorridorSideWall: perpOpenA || perpOpenB,
        })
      }
    }
  }

  if (adjacentWalls.length === 0) {
    return null
  }

  let chosen = null
  if (preferredSide) {
    chosen = adjacentWalls.find((d) => d.side === preferredSide) || null
  }
  if (!chosen) {
    const interiorSideWalls = adjacentWalls.filter(
      (w) => !w.isBoundaryWall && w.isCorridorSideWall
    )
    const interiorWalls = adjacentWalls.filter((w) => !w.isBoundaryWall)
    const sideWalls = adjacentWalls.filter((w) => w.isCorridorSideWall)
    const pool =
      interiorSideWalls.length > 0
        ? interiorSideWalls
        : interiorWalls.length > 0
          ? interiorWalls
          : sideWalls.length > 0
            ? sideWalls
            : adjacentWalls
    const idx =
      typeof rng === 'function'
        ? Math.floor(rng() * pool.length) % pool.length
        : 0
    chosen = pool[idx]
  }

  const collapseDirX = normalizeZero(Math.sin(chosen.yaw))
  const collapseDirZ = normalizeZero(Math.cos(chosen.yaw))
  const localImpactX = normalizeZero(WALL_COLLAPSE_CONSTANTS.impactLocalZ * Math.sin(chosen.yaw))
  const localImpactZ = normalizeZero(WALL_COLLAPSE_CONSTANTS.impactLocalZ * Math.cos(chosen.yaw))

  return {
    wallSide: chosen.side,
    wallRow: chosen.wallRow,
    wallCol: chosen.wallCol,
    isBoundaryWall: chosen.isBoundaryWall,
    wallYaw: chosen.yaw,
    collapseDir: { x: collapseDirX, z: collapseDirZ },
    localImpactOffset: {
      x: localImpactX,
      y: WALL_COLLAPSE_CONSTANTS.impactLocalY,
      z: localImpactZ,
    },
  }
}

/**
 * Deterministically places safe, static deteriorated wall-section decoys on
 * unoccupied corridor walls so fractured wall panels alone do not telegraph
 * `wall_collapse` traps. Never overlaps hazards, start/exit,
 * or environmental wall props.
 */
export function placeWallCollapseDecoys(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) return []
  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return []

  const {
    hazards = null,
    collectibles = null,
    keycards = null,
    excludedCells = null,
    placedProps = null,
  } = options || {}

  const blockedCells = new Set()
  if (maze.start) blockedCells.add(`${maze.start.row},${maze.start.col}`)
  if (maze.exit) blockedCells.add(`${maze.exit.row},${maze.exit.col}`)

  const blockedWallFaces = new Set()
  const markAllWallsInCell = (r, c) => {
    if (!Number.isInteger(r) || !Number.isInteger(c)) return
    for (let i = 0; i < WALL_MOUNT_DIRECTIONS.length; i += 1) {
      const dir = WALL_MOUNT_DIRECTIONS[i]
      blockedWallFaces.add(`${r + dir.dr},${c + dir.dc},${dir.side}`)
    }
  }
  if (maze.start) markAllWallsInCell(maze.start.row, maze.start.col)
  if (maze.exit) markAllWallsInCell(maze.exit.row, maze.exit.col)

  if (Array.isArray(hazards)) {
    for (let i = 0; i < hazards.length; i += 1) {
      const h = hazards[i]
      if (!h || !Number.isInteger(h.row) || !Number.isInteger(h.col)) continue
      blockedCells.add(`${h.row},${h.col}`)
      markAllWallsInCell(h.row, h.col)
      if (Number.isInteger(h.wallRow) && Number.isInteger(h.wallCol) && h.wallSide) {
        blockedWallFaces.add(`${h.wallRow},${h.wallCol},${h.wallSide}`)
      }
    }
  }
  if (Array.isArray(placedProps)) {
    for (let i = 0; i < placedProps.length; i += 1) {
      const p = placedProps[i]
      if (!p || !Number.isInteger(p.row) || !Number.isInteger(p.col)) continue
      if (p.wallSide) {
        const match = WALL_MOUNT_DIRECTIONS.find((d) => d.side === p.wallSide)
        if (match) {
          blockedWallFaces.add(`${p.row + match.dr},${p.col + match.dc},${match.side}`)
        }
      } else {
        markAllWallsInCell(p.row, p.col)
      }
    }
  }

  const resolvedCollectibles = Array.isArray(collectibles)
    ? collectibles
    : Array.isArray(collectibles?.items)
      ? collectibles.items
      : Array.isArray(maze.collectibles?.items)
        ? maze.collectibles.items
        : []
  for (let i = 0; i < resolvedCollectibles.length; i += 1) {
    const item = resolvedCollectibles[i]
    if (item && Number.isInteger(item.row) && Number.isInteger(item.col)) {
      blockedCells.add(`${item.row},${item.col}`)
    }
  }
  const resolvedKeycards = Array.isArray(keycards)
    ? keycards
    : Array.isArray(maze.keycards)
      ? maze.keycards
      : []
  for (let i = 0; i < resolvedKeycards.length; i += 1) {
    const kc = resolvedKeycards[i]
    if (kc && Number.isInteger(kc.row) && Number.isInteger(kc.col)) {
      blockedCells.add(`${kc.row},${kc.col}`)
    }
  }
  if (excludedCells) {
    const entries =
      excludedCells instanceof Set
        ? Array.from(excludedCells)
        : Array.isArray(excludedCells)
          ? excludedCells
          : []
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (typeof entry === 'string') {
        blockedCells.add(entry)
      } else if (entry && Number.isInteger(entry.row) && Number.isInteger(entry.col)) {
        blockedCells.add(`${entry.row},${entry.col}`)
      }
    }
  }

  let walkableCount = 0
  const candidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      const key = `${r},${c}`
      if (blockedCells.has(key)) continue
      const nearStart =
        maze.start && Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2
      if (nearStart) continue

      const interiorMounts = []
      const allMounts = []
      for (let d = 0; d < WALL_MOUNT_DIRECTIONS.length; d += 1) {
        const dir = WALL_MOUNT_DIRECTIONS[d]
        const wr = r + dir.dr
        const wc = c + dir.dc
        if (grid[wr]?.[wc] !== CELL_TYPES.WALL) continue
        if (blockedWallFaces.has(`${wr},${wc},${dir.side}`)) continue
        const isBoundary = wr <= 0 || wr >= rows - 1 || wc <= 0 || wc >= cols - 1
        const entry = {
          row: r,
          col: c,
          wallSide: dir.side,
          wallRow: wr,
          wallCol: wc,
          wallYaw: dir.yaw,
          isBoundaryWall: isBoundary,
        }
        allMounts.push(entry)
        if (!isBoundary) interiorMounts.push(entry)
      }
      if (interiorMounts.length > 0) {
        candidates.push(interiorMounts[0])
      } else if (allMounts.length > 0) {
        candidates.push(allMounts[0])
      }
    }
  }

  if (candidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-wall-collapse-decoys-v1`)
  const shuffled = shuffleWithRng(candidates, rng)
  const targetCount = Math.max(2, Math.min(8, Math.round(walkableCount / 32)))
  const decoys = []

  for (let i = 0; i < shuffled.length && decoys.length < targetCount; i += 1) {
    const cand = shuffled[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 1
    )
    if (tooClose) continue

    decoys.push({
      id: `wall-collapse-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      ...cand,
    })
  }

  return decoys
}

export const WATER_TANK_CONSTANTS = Object.freeze({
  ceilingAnchorY: 3.6,
  tankRestY: 2.5,
  tankRadius: 0.4,
  tankHoopRadius: 0.415,
  tankLength: 1.36,
  tankFallenY: 0.418,
  fallenLocalX: 0.86,
  fallenLocalZ: -0.36,
  clearedLocalX: 1.48,
  clearedLocalZ: -0.44,
  aftermathHalfW: 0.45,
  aftermathHalfD: 0.7,
  impactProgress: 0.28,
  surgeStartProgress: 0.28,
  decoyLayerName: 'maze-water-tank-decoys',
  dormantDripPeriodSec: 2.2,
  dormantDripDuty: 0.58,
  dormantDripOpacity: 0.24,
  decoyDripIntervalMinSec: 4.2,
  decoyDripIntervalMaxSec: 6.4,
  decoyDripDuty: 0.32,
  decoyDripOpacity: 0.19,
})

const WATER_SURGE_DIRECTIONS = [
  { side: 'south', dr: 1, dc: 0, yaw: 0, oppositeWall: 'north' },
  { side: 'north', dr: -1, dc: 0, yaw: Math.PI, oppositeWall: 'south' },
  { side: 'east', dr: 0, dc: 1, yaw: Math.PI * 0.5, oppositeWall: 'west' },
  { side: 'west', dr: 0, dc: -1, yaw: -Math.PI * 0.5, oppositeWall: 'east' },
]

/**
 * Resolves an overhead structural mounting, side-biased aftermath landing, and
 * controlled directional water surge configuration for `falling_water_tank`.
 *
 * Always anchors the tank structurally to the overhead ceiling slab/trapeze
 * (`ceilingAnchorY = 3.60`) — plus an angled steel wall-brace truss when an
 * adjacent wall backs the chosen flow direction — and aligns `flowDir` along an
 * open walkable corridor so the bounded water surge never shoots into a wall.
 */
export function resolveWaterTankMount(grid, row, col, rng = null, preferredDirection = null) {
  const openDirections = []
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    for (let i = 0; i < WATER_SURGE_DIRECTIONS.length; i += 1) {
      const dir = WATER_SURGE_DIRECTIONS[i]
      const nr = row + dir.dr
      const nc = col + dir.dc
      if (grid[nr]?.[nc] === CELL_TYPES.PATH) {
        const backR = row - dir.dr
        const backC = col - dir.dc
        const hasBackWall = grid[backR]?.[backC] === CELL_TYPES.WALL
        openDirections.push({
          ...dir,
          hasBackWall,
          wallRow: hasBackWall ? backR : null,
          wallCol: hasBackWall ? backC : null,
        })
      }
    }
  }

  let chosen = null
  if (preferredDirection && openDirections.length > 0) {
    chosen = openDirections.find((d) => d.side === preferredDirection) || null
  }
  if (!chosen && openDirections.length > 0) {
    // Prefer directions backed by an actual structural wall for ceiling+wall bracing
    const wallBacked = openDirections.filter((d) => d.hasBackWall)
    const pool = wallBacked.length > 0 ? wallBacked : openDirections
    const idx =
      typeof rng === 'function'
        ? Math.floor(rng() * pool.length) % pool.length
        : 0
    chosen = pool[idx]
  }
  if (!chosen) {
    chosen = {
      ...WATER_SURGE_DIRECTIONS[0],
      hasBackWall: false,
      wallRow: null,
      wallCol: null,
    }
  }

  const flowDirX = normalizeZero(Math.sin(chosen.yaw))
  const flowDirZ = normalizeZero(Math.cos(chosen.yaw))
  const hasOpenAhead =
    Array.isArray(grid) &&
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    grid[row + chosen.dr]?.[col + chosen.dc] === CELL_TYPES.PATH
  const surgeLength = hasOpenAhead ? 2.55 : 1.48

  // Bias aftermath resting/cleared position toward an adjacent closed wall (+X or -X in mount frame)
  let sideSign = Number.isInteger(row) && Number.isInteger(col) && (row + col) % 2 === 0 ? 1 : -1
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    const rightColOff = Math.round(Math.cos(chosen.yaw))
    const rightRowOff = Math.round(-Math.sin(chosen.yaw))
    const rightClosed = grid[row + rightRowOff]?.[col + rightColOff] !== CELL_TYPES.PATH
    const leftClosed = grid[row - rightRowOff]?.[col - rightColOff] !== CELL_TYPES.PATH
    if (rightClosed && !leftClosed) sideSign = 1
    else if (leftClosed && !rightClosed) sideSign = -1
  }

  return {
    mountType: chosen.hasBackWall ? 'ceiling_wall_brace' : 'ceiling_suspended',
    wallSide: chosen.hasBackWall ? chosen.oppositeWall : null,
    wallRow: chosen.wallRow,
    wallCol: chosen.wallCol,
    flowSide: chosen.side,
    tankYaw: chosen.yaw,
    flowDir: { x: flowDirX, z: flowDirZ },
    surgeLength,
    surgeHalfWidth: 1.05,
    tankRestY: WATER_TANK_CONSTANTS.tankRestY,
    ceilingAnchorY: WATER_TANK_CONSTANTS.ceilingAnchorY,
    sideSign,
    aftermathHalfW: WATER_TANK_CONSTANTS.aftermathHalfW,
    aftermathHalfD: WATER_TANK_CONSTANTS.aftermathHalfD,
  }
}

/**
 * Places deterministic intact non-hazard overhead industrial water tank decoys
 * in unoccupied corridor cells so tank silhouettes alone do not betray hazards.
 */
export function placeWaterTankDecoys(
  maze,
  {
    hazards = null,
    collectibles = null,
    keycards = null,
    excludedCells = null,
    placedProps = null,
  } = {}
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) return []

  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return []

  const blockedCells = new Set()
  if (maze.start) blockedCells.add(`${maze.start.row},${maze.start.col}`)
  if (maze.exit) blockedCells.add(`${maze.exit.row},${maze.exit.col}`)

  const resolvedHazards = Array.isArray(hazards)
    ? hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : []
  for (let i = 0; i < resolvedHazards.length; i += 1) {
    const h = resolvedHazards[i]
    if (h && Number.isInteger(h.row) && Number.isInteger(h.col)) {
      blockedCells.add(`${h.row},${h.col}`)
    }
  }

  const resolvedProps = Array.isArray(placedProps)
    ? placedProps
    : Array.isArray(maze.environmentalProps)
      ? maze.environmentalProps
      : []
  for (let i = 0; i < resolvedProps.length; i += 1) {
    const p = resolvedProps[i]
    if (p && Number.isInteger(p.row) && Number.isInteger(p.col)) {
      blockedCells.add(`${p.row},${p.col}`)
    }
  }

  const resolvedCollectibles = Array.isArray(collectibles)
    ? collectibles
    : Array.isArray(collectibles?.items)
      ? collectibles.items
      : Array.isArray(maze.collectibles?.items)
        ? maze.collectibles.items
        : []
  for (let i = 0; i < resolvedCollectibles.length; i += 1) {
    const item = resolvedCollectibles[i]
    if (item && Number.isInteger(item.row) && Number.isInteger(item.col)) {
      blockedCells.add(`${item.row},${item.col}`)
    }
  }

  const resolvedKeycards = Array.isArray(keycards)
    ? keycards
    : Array.isArray(maze.keycards)
      ? maze.keycards
      : []
  for (let i = 0; i < resolvedKeycards.length; i += 1) {
    const kc = resolvedKeycards[i]
    if (kc && Number.isInteger(kc.row) && Number.isInteger(kc.col)) {
      blockedCells.add(`${kc.row},${kc.col}`)
    }
  }

  if (excludedCells) {
    const entries =
      excludedCells instanceof Set
        ? Array.from(excludedCells)
        : Array.isArray(excludedCells)
          ? excludedCells
          : []
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (typeof entry === 'string') {
        blockedCells.add(entry)
      } else if (entry && Number.isInteger(entry.row) && Number.isInteger(entry.col)) {
        blockedCells.add(`${entry.row},${entry.col}`)
      }
    }
  }

  let walkableCount = 0
  const wallBackedCandidates = []
  const suspendedCandidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      const key = `${r},${c}`
      if (blockedCells.has(key)) continue
      const nearStart =
        maze.start && Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2
      if (nearStart) continue

      const mount = resolveWaterTankMount(grid, r, c, null)
      const cand = {
        row: r,
        col: c,
        ...mount,
      }
      if (mount.mountType === 'ceiling_wall_brace') {
        wallBackedCandidates.push(cand)
      } else {
        suspendedCandidates.push(cand)
      }
    }
  }

  const candidates =
    wallBackedCandidates.length > 0
      ? [...wallBackedCandidates, ...suspendedCandidates]
      : suspendedCandidates
  if (candidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-water-tank-decoys-v1`)
  const orderedWall = shuffleWithRng(wallBackedCandidates, rng)
  const orderedSusp = shuffleWithRng(suspendedCandidates, rng)
  const ordered = [...orderedWall, ...orderedSusp]
  const targetCount = Math.max(2, Math.min(8, Math.round(walkableCount / 32)))
  const decoys = []

  for (let i = 0; i < ordered.length && decoys.length < targetCount; i += 1) {
    const cand = ordered[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 2
    )
    if (tooClose) continue

    const intervalSpan =
      WATER_TANK_CONSTANTS.decoyDripIntervalMaxSec - WATER_TANK_CONSTANTS.decoyDripIntervalMinSec
    const dripIntervalSec =
      Math.round((WATER_TANK_CONSTANTS.decoyDripIntervalMinSec + rng() * intervalSpan) * 1000) /
      1000
    const dripPhase = Math.round(rng() * 10000) / 10000
    const dripOffsetX = Math.round((-0.22 + rng() * 0.28) * 1000) / 1000
    const dripOffsetZ = Math.round((0.26 + rng() * 0.06) * 1000) / 1000

    decoys.push({
      id: `water-tank-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      dripIntervalSec,
      dripPhase,
      dripOffsetX,
      dripOffsetZ,
      ...cand,
    })
  }

  return decoys
}

export const SUSPENDED_MACHINERY_CONSTANTS = Object.freeze({
  ceilingAnchorY: 3.6,
  gantryBeamCenterY: 2.94,
  gantryBeamTopY: 3.03,
  gantryBeamBottomY: 2.85,
  pivotY: 2.86,
  machineryRestY: 2.26,
  fallenY: 0.342,
  impactLocalZ: 0.72,
  fallenLocalX: 0.96,
  fallenLocalZ: 0.68,
  fallenRy: 1.48,
  clearedLocalX: 1.56,
  clearedLocalZ: 0.44,
  clearedOpenLocalX: 1.48,
  clearedOpenLocalZ: 1.18,
  clearedRy: 1.54,
  aftermathHalfW: 0.46,
  aftermathHalfD: 0.31,
  impactProgress: 0.52,
  decoyLayerName: 'maze-suspended-machinery-decoys',
})

const MACHINERY_IMPACT_LOCAL_Z = SUSPENDED_MACHINERY_CONSTANTS.impactLocalZ
const MACHINERY_IMPACT_LOCAL_Y = 0.75

/**
 * Resolves a believable overhead gantry/hoist mounting aligned with actual
 * ceiling concrete girders or transverse coffer ribs (plus flanking corridor
 * wall corbels when opposite walls frame the bay), wall-biased aftermath resting
 * side preserving >= 1.60m passage clearance, and controlled swing-drop
 * direction down an open corridor for `falling_suspended_machinery`.
 */
export function resolveSuspendedMachineryMount(
  grid,
  row,
  col,
  rng = null,
  preferredSwingSide = null
) {
  const openDirections = []
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    for (let i = 0; i < WATER_SURGE_DIRECTIONS.length; i += 1) {
      const dir = WATER_SURGE_DIRECTIONS[i]
      const nr = row + dir.dr
      const nc = col + dir.dc
      if (grid[nr]?.[nc] === CELL_TYPES.PATH) {
        // Perpendicular cells flanking the gantry beam
        const perpDr = dir.dc
        const perpDc = -dir.dr
        const leftWall = grid[row + perpDr]?.[col + perpDc] === CELL_TYPES.WALL
        const rightWall = grid[row - perpDr]?.[col - perpDc] === CELL_TYPES.WALL
        openDirections.push({
          ...dir,
          hasFlankingWalls: leftWall && rightWall,
          flankingWallCount: (leftWall ? 1 : 0) + (rightWall ? 1 : 0),
        })
      }
    }
  }

  let chosen = null
  if (preferredSwingSide && openDirections.length > 0) {
    chosen = openDirections.find((d) => d.side === preferredSwingSide) || null
  }
  if (!chosen && openDirections.length > 0) {
    const wallFlanked = openDirections.filter((d) => d.hasFlankingWalls)
    const pool = wallFlanked.length > 0 ? wallFlanked : openDirections
    const idx =
      typeof rng === 'function'
        ? Math.floor(rng() * pool.length) % pool.length
        : 0
    chosen = pool[idx]
  }
  if (!chosen) {
    chosen = {
      ...WATER_SURGE_DIRECTIONS[0],
      hasFlankingWalls: false,
      flankingWallCount: 0,
    }
  }

  const swingDirX = normalizeZero(Math.sin(chosen.yaw))
  const swingDirZ = normalizeZero(Math.cos(chosen.yaw))
  const localImpactX = normalizeZero(MACHINERY_IMPACT_LOCAL_Z * Math.sin(chosen.yaw))
  const localImpactZ = normalizeZero(MACHINERY_IMPACT_LOCAL_Z * Math.cos(chosen.yaw))

  // Resolve real ceiling structural concrete girder / rib parity beneath ceiling deck
  const beamAlongWorldX = chosen.side === 'north' || chosen.side === 'south'
  const hasRowGirder = Number.isInteger(row) && row % 2 === 0
  const hasColGirder = Number.isInteger(col) && col % 2 === 0
  let ceilingStructureType
  let ceilingBeamY
  if ((beamAlongWorldX && hasRowGirder) || (!beamAlongWorldX && hasColGirder)) {
    ceilingStructureType = 'girder_saddle'
    ceilingBeamY = 3.04
  } else if (beamAlongWorldX) {
    ceilingStructureType = 'rib_hanger'
    ceilingBeamY = 3.38
  } else if (hasRowGirder) {
    ceilingStructureType = 'cross_girder_saddle'
    ceilingBeamY = 3.04
  } else {
    ceilingStructureType = 'cross_rib_truss'
    ceilingBeamY = 3.38
  }

  // Bias aftermath resting & cleared position toward an adjacent closed wall (+X or -X in mount frame)
  let sideSign = Number.isInteger(row) && Number.isInteger(col) && (row + col) % 2 === 0 ? 1 : -1
  let rightClosed = false
  let leftClosed = false
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    const rightColOff = Math.round(Math.cos(chosen.yaw))
    const rightRowOff = Math.round(-Math.sin(chosen.yaw))
    rightClosed = grid[row + rightRowOff]?.[col + rightColOff] !== CELL_TYPES.PATH
    leftClosed = grid[row - rightRowOff]?.[col - rightColOff] !== CELL_TYPES.PATH
    if (rightClosed && !leftClosed) sideSign = 1
    else if (leftClosed && !rightClosed) sideSign = -1
  }
  const hasSideWall = sideSign > 0 ? rightClosed : leftClosed
  const clearedLocalX =
    sideSign *
    (hasSideWall
      ? SUSPENDED_MACHINERY_CONSTANTS.clearedLocalX
      : SUSPENDED_MACHINERY_CONSTANTS.clearedOpenLocalX)
  const clearedLocalZ = hasSideWall
    ? SUSPENDED_MACHINERY_CONSTANTS.clearedLocalZ
    : SUSPENDED_MACHINERY_CONSTANTS.clearedOpenLocalZ
  const aftermathYawOffset = sideSign * SUSPENDED_MACHINERY_CONSTANTS.fallenRy

  return {
    mountType: chosen.hasFlankingWalls ? 'wall_to_wall_gantry' : 'ceiling_gantry_rail',
    ceilingStructureType,
    ceilingBeamY,
    swingSide: chosen.side,
    machineryYaw: chosen.yaw,
    swingDir: { x: swingDirX, z: swingDirZ },
    localImpactOffset: {
      x: localImpactX,
      y: MACHINERY_IMPACT_LOCAL_Y,
      z: localImpactZ,
    },
    machineryRestY: SUSPENDED_MACHINERY_CONSTANTS.machineryRestY,
    ceilingAnchorY: SUSPENDED_MACHINERY_CONSTANTS.ceilingAnchorY,
    sideSign,
    hasSideWall,
    clearedLocalX,
    clearedLocalZ,
    aftermathHalfW: SUSPENDED_MACHINERY_CONSTANTS.aftermathHalfW,
    aftermathHalfD: SUSPENDED_MACHINERY_CONSTANTS.aftermathHalfD,
    aftermathYawOffset,
  }
}

/**
 * Places deterministic intact non-hazard overhead industrial gantry machinery
 * decoys in unoccupied corridor cells so suspended equipment alone does not
 * telegraph traps.
 */
export function placeSuspendedMachineryDecoys(
  maze,
  {
    hazards = null,
    collectibles = null,
    keycards = null,
    excludedCells = null,
    placedProps = null,
  } = {}
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) return []

  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return []

  const blockedCells = new Set()
  if (maze.start) blockedCells.add(`${maze.start.row},${maze.start.col}`)
  if (maze.exit) blockedCells.add(`${maze.exit.row},${maze.exit.col}`)

  const resolvedHazards = Array.isArray(hazards)
    ? hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : []
  for (let i = 0; i < resolvedHazards.length; i += 1) {
    const h = resolvedHazards[i]
    if (h && Number.isInteger(h.row) && Number.isInteger(h.col)) {
      blockedCells.add(`${h.row},${h.col}`)
    }
  }

  const resolvedProps = Array.isArray(placedProps)
    ? placedProps
    : Array.isArray(maze.environmentalProps)
      ? maze.environmentalProps
      : []
  for (let i = 0; i < resolvedProps.length; i += 1) {
    const p = resolvedProps[i]
    if (p && Number.isInteger(p.row) && Number.isInteger(p.col)) {
      blockedCells.add(`${p.row},${p.col}`)
    }
  }

  const resolvedCollectibles = Array.isArray(collectibles)
    ? collectibles
    : Array.isArray(collectibles?.items)
      ? collectibles.items
      : Array.isArray(maze.collectibles?.items)
        ? maze.collectibles.items
        : []
  for (let i = 0; i < resolvedCollectibles.length; i += 1) {
    const item = resolvedCollectibles[i]
    if (item && Number.isInteger(item.row) && Number.isInteger(item.col)) {
      blockedCells.add(`${item.row},${item.col}`)
    }
  }

  const resolvedKeycards = Array.isArray(keycards)
    ? keycards
    : Array.isArray(maze.keycards)
      ? maze.keycards
      : []
  for (let i = 0; i < resolvedKeycards.length; i += 1) {
    const kc = resolvedKeycards[i]
    if (kc && Number.isInteger(kc.row) && Number.isInteger(kc.col)) {
      blockedCells.add(`${kc.row},${kc.col}`)
    }
  }

  if (excludedCells) {
    const entries =
      excludedCells instanceof Set
        ? Array.from(excludedCells)
        : Array.isArray(excludedCells)
          ? excludedCells
          : []
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (typeof entry === 'string') {
        blockedCells.add(entry)
      } else if (entry && Number.isInteger(entry.row) && Number.isInteger(entry.col)) {
        blockedCells.add(`${entry.row},${entry.col}`)
      }
    }
  }

  let walkableCount = 0
  const wallFlankedCandidates = []
  const ceilingRailCandidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      const key = `${r},${c}`
      if (blockedCells.has(key)) continue
      const nearStart =
        maze.start && Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2
      if (nearStart) continue

      const mount = resolveSuspendedMachineryMount(grid, r, c, null)
      const cand = {
        row: r,
        col: c,
        ...mount,
      }
      if (mount.mountType === 'wall_to_wall_gantry') {
        wallFlankedCandidates.push(cand)
      } else {
        ceilingRailCandidates.push(cand)
      }
    }
  }

  const candidates =
    wallFlankedCandidates.length > 0
      ? [...wallFlankedCandidates, ...ceilingRailCandidates]
      : ceilingRailCandidates
  if (candidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-suspended-machinery-decoys-v1`)
  const orderedWall = shuffleWithRng(wallFlankedCandidates, rng)
  const orderedCeil = shuffleWithRng(ceilingRailCandidates, rng)
  const ordered = [...orderedWall, ...orderedCeil]
  const targetCount = Math.max(2, Math.min(8, Math.round(walkableCount / 32)))
  const decoys = []

  for (let i = 0; i < ordered.length && decoys.length < targetCount; i += 1) {
    const cand = ordered[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 2
    )
    if (tooClose) continue

    decoys.push({
      id: `suspended-machinery-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      ...cand,
    })
  }

  return decoys
}

/**
 * Resolves a believable overhead ventilation duct run and controlled drop
 * orientation for `ventilation_duct_collapse`.
 *
 * Always anchors the duct structurally beneath the ceiling slab (`ceilingAnchorY = 3.58`,
 * `ductRestY = 3.18`) via trapeze steel hangers and inline plenum collars (plus a
 * rear wall bulkhead intake collar when backed by a maze wall), aligning `dropDir`
 * down an open walkable corridor so the detaching duct never clips into solid walls.
 */
export const VENTILATION_DUCT_CONSTANTS = Object.freeze({
  ceilingAnchorY: 3.6,
  girderBottomY: 3.04,
  ribBottomY: 3.38,
  ductRestY: 3.16,
  ductRestYGirder: 2.83,
  ductRestYRib: 3.16,
  ductRestYSoffit: 3.34,
  ductWidth: 0.66,
  ductHeight: 0.28,
  ductLen: 1.8,
  pivotZ: -0.92,
  bodyOffsetZ: 0.92,
  hangerZ: 0.78,
  fallenY: 0.174,
  impactLocalZ: 0.56,
  fallenLocalX: 1.12,
  fallenLocalZ: 0.62,
  fallenRy: 0.14,
  clearedLocalX: 1.56,
  clearedLocalZ: 0.25,
  clearedOpenLocalX: 1.48,
  clearedOpenLocalZ: 0.78,
  clearedRy: 0.04,
  aftermathHalfW: 0.36,
  aftermathHalfD: 0.91,
  impactProgress: 0.48,
  decoyLayerName: 'maze-ventilation-duct-decoys',
})

const DUCT_IMPACT_LOCAL_Z = VENTILATION_DUCT_CONSTANTS.impactLocalZ
const DUCT_IMPACT_LOCAL_Y = 0.65

/**
 * Resolves a believable overhead ventilation duct run and drop orientation
 * for `ventilation_duct_collapse`, aligning with actual ceiling concrete
 * girders/ribs (`buildMazeCeiling.js`), wall bulkheads, per-structure vertical
 * clearance (never clipping girders/ribs/trays, never blindly lowering rib/soffit
 * mounts), and wall-biased aftermath resting coordinates preserving >= 1.60m
 * passage clearance across all 5 maze topologies.
 */
export function resolveVentilationDuctMount(
  grid,
  row,
  col,
  rng = null,
  preferredDropSide = null
) {
  const openDirections = []
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    for (let i = 0; i < WATER_SURGE_DIRECTIONS.length; i += 1) {
      const dir = WATER_SURGE_DIRECTIONS[i]
      const nr = row + dir.dr
      const nc = col + dir.dc
      if (grid[nr]?.[nc] === CELL_TYPES.PATH) {
        const backR = row - dir.dr
        const backC = col - dir.dc
        const hasRearWall = grid[backR]?.[backC] === CELL_TYPES.WALL
        const hasRearOpen = grid[backR]?.[backC] === CELL_TYPES.PATH
        openDirections.push({
          ...dir,
          hasRearWall,
          hasRearOpen,
          wallRow: hasRearWall ? backR : null,
          wallCol: hasRearWall ? backC : null,
        })
      }
    }
  }

  let chosen = null
  if (preferredDropSide && openDirections.length > 0) {
    chosen = openDirections.find((d) => d.side === preferredDropSide) || null
  }
  if (!chosen && openDirections.length > 0) {
    const straightRuns = openDirections.filter((d) => d.hasRearOpen)
    const pool = straightRuns.length > 0 ? straightRuns : openDirections
    const idx =
      typeof rng === 'function'
        ? Math.floor(rng() * pool.length) % pool.length
        : 0
    chosen = pool[idx]
  }
  if (!chosen) {
    chosen = {
      ...WATER_SURGE_DIRECTIONS[0],
      hasRearWall: false,
      hasRearOpen: false,
      wallRow: null,
      wallCol: null,
    }
  }

  const dropDirX = normalizeZero(Math.sin(chosen.yaw))
  const dropDirZ = normalizeZero(Math.cos(chosen.yaw))
  const localImpactX = normalizeZero(DUCT_IMPACT_LOCAL_Z * Math.sin(chosen.yaw))
  const localImpactZ = normalizeZero(DUCT_IMPACT_LOCAL_Z * Math.cos(chosen.yaw))

  // Resolve real ceiling concrete beam/rib geometry relative to the duct's local Z run axis:
  // - evenRow has a primary X-girder (|worldZ| <= 0.39, y = 3.04..3.60)
  // - oddRow has a transverse X-rib (|worldZ| <= 0.21, y = 3.38..3.60)
  // - evenCol has a primary Z-girder (|worldX| <= 0.39, y = 3.04..3.60)
  const ductAlongWorldZ = chosen.side === 'north' || chosen.side === 'south'
  const hasRowGirder = Number.isInteger(row) && Math.abs(row) % 2 === 0
  const hasColGirder = Number.isInteger(col) && Math.abs(col) % 2 === 0
  const hasParallelGirder =
    (ductAlongWorldZ && hasColGirder) || (!ductAlongWorldZ && hasRowGirder)
  const hasCrossGirder =
    (ductAlongWorldZ && hasRowGirder) || (!ductAlongWorldZ && hasColGirder)

  let ceilingStructureType
  let ceilingBeamY
  let ductRestY
  let hangerPivotY

  if (hasParallelGirder && hasCrossGirder) {
    ceilingStructureType = 'girder_intersection'
    ceilingBeamY = VENTILATION_DUCT_CONSTANTS.girderBottomY
    ductRestY = VENTILATION_DUCT_CONSTANTS.ductRestYGirder
    hangerPivotY = 3.035
  } else if (hasParallelGirder) {
    ceilingStructureType = 'girder_saddle'
    ceilingBeamY = VENTILATION_DUCT_CONSTANTS.girderBottomY
    ductRestY = VENTILATION_DUCT_CONSTANTS.ductRestYGirder
    hangerPivotY = 3.035
  } else if (hasCrossGirder) {
    ceilingStructureType = 'cross_girder_saddle'
    ceilingBeamY = VENTILATION_DUCT_CONSTANTS.girderBottomY
    ductRestY = VENTILATION_DUCT_CONSTANTS.ductRestYGirder
    hangerPivotY = VENTILATION_DUCT_CONSTANTS.ceilingAnchorY
  } else if (!ductAlongWorldZ) {
    // oddRow + oddCol + E/W run: continuous X-rib runs parallel directly above duct spine (|localX| <= 0.21)
    ceilingStructureType = 'rib_hanger'
    ceilingBeamY = VENTILATION_DUCT_CONSTANTS.ribBottomY
    ductRestY = VENTILATION_DUCT_CONSTANTS.ductRestYRib
    hangerPivotY = VENTILATION_DUCT_CONSTANTS.ceilingAnchorY
  } else {
    // oddRow + oddCol + N/S run: transverse X-rib crosses perpendicular over duct at localZ = 0
    ceilingStructureType = 'cross_rib_truss'
    ceilingBeamY = VENTILATION_DUCT_CONSTANTS.ribBottomY
    ductRestY = VENTILATION_DUCT_CONSTANTS.ductRestYRib
    hangerPivotY = VENTILATION_DUCT_CONSTANTS.ceilingAnchorY
  }

  // Bias aftermath resting & cleared side toward an adjacent closed wall (+X or -X in mount frame)
  let sideSign = Number.isInteger(row) && Number.isInteger(col) && (row + col) % 2 === 0 ? 1 : -1
  let rightClosed = false
  let leftClosed = false
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    const rightColOff = Math.round(Math.cos(chosen.yaw))
    const rightRowOff = Math.round(-Math.sin(chosen.yaw))
    rightClosed = grid[row + rightRowOff]?.[col + rightColOff] !== CELL_TYPES.PATH
    leftClosed = grid[row - rightRowOff]?.[col - rightColOff] !== CELL_TYPES.PATH
    if (rightClosed && !leftClosed) sideSign = 1
    else if (leftClosed && !rightClosed) sideSign = -1
  }
  const hasSideWall = sideSign > 0 ? rightClosed : leftClosed
  const clearedLocalX =
    sideSign *
    (hasSideWall
      ? VENTILATION_DUCT_CONSTANTS.clearedLocalX
      : VENTILATION_DUCT_CONSTANTS.clearedOpenLocalX)
  const clearedLocalZ = hasSideWall
    ? VENTILATION_DUCT_CONSTANTS.clearedLocalZ
    : VENTILATION_DUCT_CONSTANTS.clearedOpenLocalZ
  const aftermathYawOffset = sideSign * VENTILATION_DUCT_CONSTANTS.fallenRy

  return {
    mountType: chosen.hasRearWall ? 'wall_bulkhead_duct' : 'ceiling_duct_run',
    ceilingStructureType,
    ceilingBeamY,
    hangerPivotY,
    wallSide: chosen.hasRearWall ? chosen.oppositeWall : null,
    wallRow: chosen.wallRow,
    wallCol: chosen.wallCol,
    dropSide: chosen.side,
    ductYaw: chosen.yaw,
    dropDir: { x: dropDirX, z: dropDirZ },
    localImpactOffset: {
      x: localImpactX,
      y: DUCT_IMPACT_LOCAL_Y,
      z: localImpactZ,
    },
    ductRestY,
    ceilingAnchorY: VENTILATION_DUCT_CONSTANTS.ceilingAnchorY,
    fallenY: VENTILATION_DUCT_CONSTANTS.fallenY,
    sideSign,
    hasSideWall,
    clearedLocalX,
    clearedLocalZ,
    aftermathHalfW: VENTILATION_DUCT_CONSTANTS.aftermathHalfW,
    aftermathHalfD: VENTILATION_DUCT_CONSTANTS.aftermathHalfD,
    aftermathYawOffset,
  }
}

/**
 * Places deterministic intact non-hazard overhead ventilation duct decoys
 * in unoccupied corridor cells.
 */
export function placeVentilationDuctDecoys(
  maze,
  {
    hazards = null,
    collectibles = null,
    keycards = null,
    excludedCells = null,
    placedProps = null,
  } = {}
) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) return []

  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return []

  const blockedCells = new Set()
  if (maze.start) blockedCells.add(`${maze.start.row},${maze.start.col}`)
  if (maze.exit) blockedCells.add(`${maze.exit.row},${maze.exit.col}`)

  const resolvedHazards = Array.isArray(hazards)
    ? hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : []
  for (let i = 0; i < resolvedHazards.length; i += 1) {
    const h = resolvedHazards[i]
    if (h && Number.isInteger(h.row) && Number.isInteger(h.col)) {
      blockedCells.add(`${h.row},${h.col}`)
    }
  }

  const resolvedProps = Array.isArray(placedProps)
    ? placedProps
    : Array.isArray(maze.environmentalProps)
      ? maze.environmentalProps
      : []
  for (let i = 0; i < resolvedProps.length; i += 1) {
    const p = resolvedProps[i]
    if (p && Number.isInteger(p.row) && Number.isInteger(p.col)) {
      blockedCells.add(`${p.row},${p.col}`)
    }
  }

  const resolvedCollectibles = Array.isArray(collectibles)
    ? collectibles
    : Array.isArray(collectibles?.items)
      ? collectibles.items
      : Array.isArray(maze.collectibles?.items)
        ? maze.collectibles.items
        : []
  for (let i = 0; i < resolvedCollectibles.length; i += 1) {
    const item = resolvedCollectibles[i]
    if (item && Number.isInteger(item.row) && Number.isInteger(item.col)) {
      blockedCells.add(`${item.row},${item.col}`)
    }
  }

  const resolvedKeycards = Array.isArray(keycards)
    ? keycards
    : Array.isArray(maze.keycards)
      ? maze.keycards
      : []
  for (let i = 0; i < resolvedKeycards.length; i += 1) {
    const kc = resolvedKeycards[i]
    if (kc && Number.isInteger(kc.row) && Number.isInteger(kc.col)) {
      blockedCells.add(`${kc.row},${kc.col}`)
    }
  }

  if (excludedCells) {
    const entries =
      excludedCells instanceof Set
        ? Array.from(excludedCells)
        : Array.isArray(excludedCells)
          ? excludedCells
          : []
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (typeof entry === 'string') {
        blockedCells.add(entry)
      } else if (entry && Number.isInteger(entry.row) && Number.isInteger(entry.col)) {
        blockedCells.add(`${entry.row},${entry.col}`)
      }
    }
  }

  let walkableCount = 0
  const bulkCandidates = []
  const runCandidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      const key = `${r},${c}`
      if (blockedCells.has(key)) continue
      const nearStart =
        maze.start && Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2
      if (nearStart) continue

      const mount = resolveVentilationDuctMount(grid, r, c, null)
      const cand = {
        row: r,
        col: c,
        ...mount,
      }
      if (mount.mountType === 'wall_bulkhead_duct') {
        bulkCandidates.push(cand)
      } else {
        runCandidates.push(cand)
      }
    }
  }

  const candidates =
    bulkCandidates.length > 0 ? [...bulkCandidates, ...runCandidates] : runCandidates
  if (candidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-vent-duct-decoys-v1`)
  const orderedBulk = shuffleWithRng(bulkCandidates, rng)
  const orderedRun = shuffleWithRng(runCandidates, rng)
  const ordered = [...orderedBulk, ...orderedRun]
  const targetCount = Math.max(2, Math.min(8, Math.round(walkableCount / 32)))
  const decoys = []

  for (let i = 0; i < ordered.length && decoys.length < targetCount; i += 1) {
    const cand = ordered[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 2
    )
    if (tooClose) continue

    decoys.push({
      id: `ventilation-duct-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      ...cand,
    })
  }

  return decoys
}

const CEILING_SOFFIT_Y = 3.6
const CEILING_RUBBLE_HALF_W = 0.44
const CEILING_RUBBLE_HALF_D = 0.44

export const CEILING_COLLAPSE_CONSTANTS = Object.freeze({
  soffitY: CEILING_SOFFIT_Y,
  rubbleHalfW: CEILING_RUBBLE_HALF_W,
  rubbleHalfD: CEILING_RUBBLE_HALF_D,
  decoyLayerName: 'maze-ceiling-collapse-decoys',
})

/**
 * Resolves a deterministic overhead ceiling-collapse bay inside walkable cell
 * `(row, col)` that blends into the concrete ceiling soffit while avoiding:
 *  - Primary X/Z girders (`|z| <= 0.39` on even rows, `|x| <= 0.39` on even cols)
 *  - Secondary transverse ribs (`|z| <= 0.21` on odd rows)
 *  - Centered ceiling light fixtures (`|x|, |z| <= 0.42`)
 *  - Adjacent walls & pilasters (`|x|, |z| <= 1.72`)
 * while biasing toward a bordering solid wall whenever present so fallen rubble
 * always leaves >= 2.40m of navigable corridor clearance (well above 1.60m).
 */
export function resolveCeilingCollapseMount(
  grid,
  row,
  col,
  rng = null,
  preferredWallSide = null
) {
  const rows = Array.isArray(grid) ? grid.length : 0
  const cols = rows > 0 && Array.isArray(grid[0]) ? grid[0].length : 0
  const hasGrid = rows > 0 && cols > 0

  const isWall = (r, c) =>
    hasGrid && r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === CELL_TYPES.WALL

  const wallN = isWall(row - 1, col)
  const wallS = isWall(row + 1, col)
  const wallW = isWall(row, col - 1)
  const wallE = isWall(row, col + 1)

  const rowEven = Number.isInteger(row) ? Math.abs(row) % 2 === 0 : false
  const colEven = Number.isInteger(col) ? Math.abs(col) % 2 === 0 : false

  const pickSign = (negPref, posPref, seedSalt) => {
    if (negPref && !posPref) return -1
    if (posPref && !negPref) return 1
    if (typeof rng === 'function') {
      return rng() < 0.5 ? -1 : 1
    }
    const h = Math.abs((Number(row) || 0) * 31 + (Number(col) || 0) * 17 + seedSalt)
    return h % 2 === 0 ? -1 : 1
  }

  let wallSide = null
  if (
    preferredWallSide === 'north' ||
    preferredWallSide === 'south' ||
    preferredWallSide === 'east' ||
    preferredWallSide === 'west'
  ) {
    wallSide = preferredWallSide
  } else {
    const bordering = []
    if (wallN) bordering.push('north')
    if (wallS) bordering.push('south')
    if (wallW) bordering.push('west')
    if (wallE) bordering.push('east')
    if (bordering.length > 0) {
      const idx =
        typeof rng === 'function'
          ? Math.floor(rng() * bordering.length) % bordering.length
          : Math.abs((Number(row) || 0) * 13 + (Number(col) || 0) * 7) % bordering.length
      wallSide = bordering[idx]
    }
  }

  const signX = pickSign(wallW || wallSide === 'west', wallE || wallSide === 'east', 3)
  const signZ = pickSign(wallN || wallSide === 'north', wallS || wallSide === 'south', 11)

  let localX
  let localZ

  if (rowEven && colEven) {
    // Both X- and Z-girders intersect at cell center -> use clean quadrant coffer bay
    localX = signX * 0.9
    localZ = signZ * 0.9
  } else if (!rowEven && colEven) {
    // Z-girder along X=0 ([-0.39, +0.39]) + odd-row X-rib -> clean quadrant bay
    localX = signX * 0.9
    localZ = signZ * 0.86
  } else if (rowEven && !colEven) {
    // X-girder along Z=0 ([-0.39, +0.39]) -> clean quadrant bay
    localX = signX * 0.86
    localZ = signZ * 0.9
  } else {
    // Odd row + odd col (only shallow X-rib at |z| <= 0.21):
    // If N/S wall exists (straight E-W corridor or corner), align along that wall bay
    // unless 4-way open (where quadrant bay guarantees >= 2.4m clearance on both axes).
    const openCount = (wallN ? 0 : 1) + (wallS ? 0 : 1) + (wallW ? 0 : 1) + (wallE ? 0 : 1)
    if (openCount >= 4) {
      localX = signX * 0.9
      localZ = signZ * 0.86
    } else if (wallSide === 'north' || wallSide === 'south') {
      localX = 0
      localZ = wallSide === 'north' ? -0.96 : 0.96
    } else if (wallSide === 'west' || wallSide === 'east') {
      localX = wallSide === 'west' ? -0.96 : 0.96
      localZ = signZ * 0.78
    } else {
      localX = signX * 0.9
      localZ = signZ * 0.86
    }
  }

  let collapseYaw
  if (wallSide === 'south') collapseYaw = Math.PI
  else if (wallSide === 'west') collapseYaw = Math.PI * 0.5
  else if (wallSide === 'east') collapseYaw = -Math.PI * 0.5
  else collapseYaw = signZ < 0 ? 0 : Math.PI

  // Deterministic cleared scatter direction (tucked even further toward nearest wall/corner)
  const clearDirX = localX !== 0 ? Math.sign(localX) : signX
  const clearDirZ = localZ !== 0 ? Math.sign(localZ) : signZ

  return {
    wallSide,
    collapseYaw: normalizeZero(collapseYaw),
    localPatchOffset: {
      x: normalizeZero(localX),
      y: CEILING_SOFFIT_Y,
      z: normalizeZero(localZ),
    },
    ceilingSoffitY: CEILING_SOFFIT_Y,
    rubbleHalfW: CEILING_RUBBLE_HALF_W,
    rubbleHalfD: CEILING_RUBBLE_HALF_D,
    clearBias: {
      x: normalizeZero(clearDirX),
      z: normalizeZero(clearDirZ),
    },
  }
}

const ROTTEN_FURNITURE_UPRIGHT_LOCAL_Z = -1.73
const ROTTEN_FURNITURE_IMPACT_LOCAL_Z = -0.86
const ROTTEN_FURNITURE_IMPACT_LOCAL_Y = 0.38
const ROTTEN_FURNITURE_LATERAL_OFFSET = 0.46
const ROTTEN_FURNITURE_UPRIGHT_HALF_W = 0.45
const ROTTEN_FURNITURE_UPRIGHT_HALF_D = 0.23
const ROTTEN_FURNITURE_AFTERMATH_HALF_W = 0.46
const ROTTEN_FURNITURE_AFTERMATH_HALF_D = 0.72

/**
 * Resolves a wall-side facility furniture placement for `rotten_furniture_collapse`
 * so the deteriorated storage shelving unit rests flush against an actual corridor
 * wall (avoiding corner pilasters at +/-1.54m) and tips forward into the corridor
 * while preserving >= 2.00m navigable clearance along both axes.
 */
export function resolveRottenFurnitureMount(
  grid,
  row,
  col,
  rng = null,
  preferredWallSide = null
) {
  const rows = Array.isArray(grid) ? grid.length : 0
  const cols = rows > 0 && Array.isArray(grid[0]) ? grid[0].length : 0
  const r = Number.isInteger(row) ? row : 1
  const c = Number.isInteger(col) ? col : 1

  const adjacentWalls = []
  if (rows > 0 && cols > 0) {
    for (let i = 0; i < WALL_MOUNT_DIRECTIONS.length; i += 1) {
      const dir = WALL_MOUNT_DIRECTIONS[i]
      const wr = r + dir.dr
      const wc = c + dir.dc
      if (wr < 0 || wr >= rows || wc < 0 || wc >= cols || grid[wr]?.[wc] === CELL_TYPES.WALL) {
        const isBoundaryWall =
          wr <= 0 || wr >= rows - 1 || wc <= 0 || wc >= cols - 1
        const hasOppositePath = grid[r - dir.dr]?.[c - dir.dc] === CELL_TYPES.PATH
        const perpOpenA = grid[r + dir.dc]?.[c + dir.dr] === CELL_TYPES.PATH
        const perpOpenB = grid[r - dir.dc]?.[c - dir.dr] === CELL_TYPES.PATH
        const isCorridorSideWall = perpOpenA || perpOpenB
        adjacentWalls.push({
          ...dir,
          wallRow: wr,
          wallCol: wc,
          isBoundaryWall,
          hasOppositePath,
          isCorridorSideWall,
        })
      }
    }
  }

  let chosen = null
  if (preferredWallSide) {
    chosen =
      adjacentWalls.find((w) => w.side === preferredWallSide) ||
      WALL_MOUNT_DIRECTIONS.find((d) => d.side === preferredWallSide) ||
      null
    if (chosen && chosen.wallRow === undefined) {
      chosen = {
        ...chosen,
        wallRow: r + chosen.dr,
        wallCol: c + chosen.dc,
        isBoundaryWall: false,
      }
    }
  }

  if (!chosen && adjacentWalls.length > 0) {
    const sideWithOppositeOpen = adjacentWalls.filter(
      (w) => w.isCorridorSideWall && w.hasOppositePath
    )
    const sideWalls = adjacentWalls.filter((w) => w.isCorridorSideWall)
    const interiorWalls = adjacentWalls.filter((w) => !w.isBoundaryWall)
    const pool =
      sideWithOppositeOpen.length > 0
        ? sideWithOppositeOpen
        : sideWalls.length > 0
          ? sideWalls
          : interiorWalls.length > 0
            ? interiorWalls
            : adjacentWalls
    const idx =
      typeof rng === 'function'
        ? Math.floor(rng() * pool.length) % pool.length
        : (r * 7 + c * 13) % pool.length
    chosen = pool[idx]
  }

  if (!chosen) {
    const fallbackDir = WALL_MOUNT_DIRECTIONS[(r + c) % WALL_MOUNT_DIRECTIONS.length]
    chosen = {
      ...fallbackDir,
      wallRow: r + fallbackDir.dr,
      wallCol: c + fallbackDir.dc,
      isBoundaryWall: false,
    }
  }

  // Determine natural off-center lateral position (+/-0.46m) along the wall face,
  // biasing toward any closed perpendicular side wall so open turns/junctions stay wide.
  const cosYaw = Math.cos(chosen.yaw)
  const sinYaw = Math.sin(chosen.yaw)
  const posXStepRow = Math.round(-sinYaw)
  const posXStepCol = Math.round(cosYaw)
  const wallAtPosX =
    rows > 0 &&
    cols > 0 &&
    grid[r + posXStepRow]?.[c + posXStepCol] === CELL_TYPES.WALL
  const wallAtNegX =
    rows > 0 &&
    cols > 0 &&
    grid[r - posXStepRow]?.[c - posXStepCol] === CELL_TYPES.WALL

  let lateralSign
  if (wallAtPosX && !wallAtNegX) {
    lateralSign = 1
  } else if (wallAtNegX && !wallAtPosX) {
    lateralSign = -1
  } else if (typeof rng === 'function') {
    lateralSign = rng() < 0.5 ? -1 : 1
  } else {
    lateralSign = ((r * 19 + c * 37) & 1) === 0 ? -1 : 1
  }

  const lateralOffset = normalizeZero(lateralSign * ROTTEN_FURNITURE_LATERAL_OFFSET)

  // Convert local wall coordinates (lx = lateralOffset, lz) to cell-relative world (wx, wz)
  const toCellWorld = (lx, lz) => ({
    x: normalizeZero(lx * cosYaw + lz * sinYaw),
    z: normalizeZero(-lx * sinYaw + lz * cosYaw),
  })

  const uprightWorld = toCellWorld(lateralOffset, ROTTEN_FURNITURE_UPRIGHT_LOCAL_Z)
  const impactWorld = toCellWorld(lateralOffset, ROTTEN_FURNITURE_IMPACT_LOCAL_Z)
  const tipDirX = normalizeZero(sinYaw)
  const tipDirZ = normalizeZero(cosYaw)

  return {
    wallSide: chosen.side,
    wallRow: chosen.wallRow,
    wallCol: chosen.wallCol,
    wallYaw: normalizeZero(chosen.yaw),
    lateralOffset,
    tipDir: { x: tipDirX, z: tipDirZ },
    localUprightOffset: {
      x: uprightWorld.x,
      y: 0.68,
      z: uprightWorld.z,
    },
    localImpactOffset: {
      x: impactWorld.x,
      y: ROTTEN_FURNITURE_IMPACT_LOCAL_Y,
      z: impactWorld.z,
    },
    uprightHalfW: ROTTEN_FURNITURE_UPRIGHT_HALF_W,
    uprightHalfD: ROTTEN_FURNITURE_UPRIGHT_HALF_D,
    aftermathHalfW: ROTTEN_FURNITURE_AFTERMATH_HALF_W,
    aftermathHalfD: ROTTEN_FURNITURE_AFTERMATH_HALF_D,
  }
}

const FALLING_PIPES_OVERHEAD_LOCAL_Z = 0
const FALLING_PIPES_OVERHEAD_LOCAL_Y = 3.12
const FALLING_PIPES_IMPACT_LOCAL_Z = 0
const FALLING_PIPES_IMPACT_LOCAL_Y = 0.155
const FALLING_PIPES_CEILING_SOFFIT_Y = 3.6
const FALLING_PIPES_AFTERMATH_HALF_W = 1.92
const FALLING_PIPES_AFTERMATH_HALF_D = 0.24
const FALLING_PIPES_DANGER_HALF_W = 1.92
const FALLING_PIPES_DANGER_HALF_D = 0.68
const FALLING_PIPES_STEP_HEIGHT = 0.31
const FALLING_PIPES_TRAVERSAL_SPEED_SCALE = 0.78

export const FALLING_PIPES_CONSTANTS = Object.freeze({
  overheadLocalZ: FALLING_PIPES_OVERHEAD_LOCAL_Z,
  pipeRestY: FALLING_PIPES_OVERHEAD_LOCAL_Y,
  ceilingAnchorY: FALLING_PIPES_CEILING_SOFFIT_Y,
  impactLocalZ: FALLING_PIPES_IMPACT_LOCAL_Z,
  impactLocalY: FALLING_PIPES_IMPACT_LOCAL_Y,
  aftermathHalfW: FALLING_PIPES_AFTERMATH_HALF_W,
  aftermathHalfD: FALLING_PIPES_AFTERMATH_HALF_D,
  dangerHalfW: FALLING_PIPES_DANGER_HALF_W,
  dangerHalfD: FALLING_PIPES_DANGER_HALF_D,
  stepHeight: FALLING_PIPES_STEP_HEIGHT,
  traversalSpeedScale: FALLING_PIPES_TRAVERSAL_SPEED_SCALE,
  decoyLayerName: 'maze-falling-pipes-decoys',
})

/**
 * Resolves a structurally anchored transverse overhead pipe & valve assembly
 * mount for `falling_pipes_fixtures`.
 *
 * Mounts the pipe horizontally ACROSS the corridor from left side to right side
 * (`localX` spans wall-to-wall across the 4m corridor, centered at `localZ = 0`,
 * `y = 3.12m`), crossing perpendicular to the player's corridor travel direction:
 *   - North–South corridor (walls on West & East): `pipeYaw = 0`, spanning West <-> East
 *   - East–West corridor (walls on North & South): `pipeYaw = Math.PI * 0.5`, spanning South <-> North
 * When both opposing transverse corridor walls are solid, anchors into both left
 * and right wall collars (`mountType = 'wall'`) plus overhead ceiling risers and
 * clevis hangers (`y = 3.60m`). In corners, T-junctions, or 4-way intersections
 * without opposing transverse walls, anchors strictly to the overhead ceiling slab
 * (`mountType = 'ceiling'`) oriented transversely across the dominant open axis.
 */
export function resolveFallingPipesMount(
  grid,
  row,
  col,
  rng = null,
  preferredWallSide = null
) {
  const rows = Array.isArray(grid) ? grid.length : 0
  const cols = rows > 0 && Array.isArray(grid[0]) ? grid[0].length : 0
  const r = Number.isInteger(row) ? row : 1
  const c = Number.isInteger(col) ? col : 1

  const isWallAt = (wr, wc) =>
    wr < 0 || wr >= rows || wc < 0 || wc >= cols || grid[wr]?.[wc] === CELL_TYPES.WALL
  const isPathAt = (pr, pc) =>
    pr >= 0 && pr < rows && pc >= 0 && pc < cols && grid[pr]?.[pc] === CELL_TYPES.PATH

  let mountType
  let pipeYaw
  let wallSide = null
  let wallRow = null
  let wallCol = null
  let oppositeWallSide = null
  let oppositeWallRow = null
  let oppositeWallCol = null

  if (rows > 0 && cols > 0) {
    const wallN = isWallAt(r - 1, c)
    const wallS = isWallAt(r + 1, c)
    const wallW = isWallAt(r, c - 1)
    const wallE = isWallAt(r, c + 1)

    const openN = isPathAt(r - 1, c)
    const openS = isPathAt(r + 1, c)
    const openW = isPathAt(r, c - 1)
    const openE = isPathAt(r, c + 1)
    const openNS = (openN ? 1 : 0) + (openS ? 1 : 0)
    const openEW = (openW ? 1 : 0) + (openE ? 1 : 0)

    const nsCorridorWalls = wallW && wallE
    const ewCorridorWalls = wallN && wallS

    if (preferredWallSide === 'west' || preferredWallSide === 'east') {
      // Pipe spans West <-> East transversely across a North–South corridor
      mountType = 'wall'
      pipeYaw = preferredWallSide === 'east' ? Math.PI : 0
      wallSide = preferredWallSide
      wallRow = r
      wallCol = preferredWallSide === 'west' ? c - 1 : c + 1
      oppositeWallSide = preferredWallSide === 'west' ? 'east' : 'west'
      oppositeWallRow = r
      oppositeWallCol = preferredWallSide === 'west' ? c + 1 : c - 1
    } else if (preferredWallSide === 'north' || preferredWallSide === 'south') {
      // Pipe spans North <-> South transversely across an East–West corridor
      mountType = 'wall'
      pipeYaw = preferredWallSide === 'south' ? -Math.PI * 0.5 : Math.PI * 0.5
      wallSide = preferredWallSide
      wallRow = preferredWallSide === 'north' ? r - 1 : r + 1
      wallCol = c
      oppositeWallSide = preferredWallSide === 'north' ? 'south' : 'north'
      oppositeWallRow = preferredWallSide === 'north' ? r + 1 : r - 1
      oppositeWallCol = c
    } else if (nsCorridorWalls && !ewCorridorWalls) {
      // Pure N–S corridor (or N/S dead-end): pipe crosses horizontally West <-> East
      mountType = 'wall'
      pipeYaw = 0
      wallSide = 'west'
      wallRow = r
      wallCol = c - 1
      oppositeWallSide = 'east'
      oppositeWallRow = r
      oppositeWallCol = c + 1
    } else if (ewCorridorWalls && !nsCorridorWalls) {
      // Pure E–W corridor (or E/W dead-end): pipe crosses horizontally South <-> North
      mountType = 'wall'
      pipeYaw = Math.PI * 0.5
      wallSide = 'north'
      wallRow = r - 1
      wallCol = c
      oppositeWallSide = 'south'
      oppositeWallRow = r + 1
      oppositeWallCol = c
    } else if (nsCorridorWalls && ewCorridorWalls) {
      // Enclosed cell fallback
      mountType = 'wall'
      const useEW = typeof rng === 'function' ? rng() >= 0.5 : ((r + c) & 1) === 1
      if (useEW) {
        pipeYaw = Math.PI * 0.5
        wallSide = 'north'
        wallRow = r - 1
        wallCol = c
        oppositeWallSide = 'south'
        oppositeWallRow = r + 1
        oppositeWallCol = c
      } else {
        pipeYaw = 0
        wallSide = 'west'
        wallRow = r
        wallCol = c - 1
        oppositeWallSide = 'east'
        oppositeWallRow = r
        oppositeWallCol = c + 1
      }
    } else {
      // Corner, T-junction, or 4-way intersection: anchor cleanly to ceiling soffit
      // oriented transversely across the dominant open corridor travel axis.
      mountType = 'ceiling'
      if (openNS > openEW) {
        // Corridor travels N–S -> pipe crosses horizontally E–W
        pipeYaw = 0
      } else if (openEW > openNS) {
        // Corridor travels E–W -> pipe crosses horizontally N–S
        pipeYaw = Math.PI * 0.5
      } else {
        pipeYaw = ((r + c) & 1) === 0 ? 0 : Math.PI * 0.5
      }
    }
  } else {
    mountType = 'wall'
    const useEW = ((r + c) & 1) === 1
    if (useEW) {
      pipeYaw = Math.PI * 0.5
      wallSide = 'north'
      wallRow = r - 1
      wallCol = c
      oppositeWallSide = 'south'
      oppositeWallRow = r + 1
      oppositeWallCol = c
    } else {
      pipeYaw = 0
      wallSide = 'west'
      wallRow = r
      wallCol = c - 1
      oppositeWallSide = 'east'
      oppositeWallRow = r
      oppositeWallCol = c + 1
    }
  }

  pipeYaw = normalizeZero(pipeYaw)
  const cosYaw = Math.cos(pipeYaw)
  const sinYaw = Math.sin(pipeYaw)
  const toCellWorld = (lx, lz) => ({
    x: normalizeZero(lx * cosYaw + lz * sinYaw),
    z: normalizeZero(-lx * sinYaw + lz * cosYaw),
  })

  const overheadWorld = toCellWorld(0, FALLING_PIPES_OVERHEAD_LOCAL_Z)
  const impactWorld = toCellWorld(0, FALLING_PIPES_IMPACT_LOCAL_Z)
  // Local +Z points along corridor travel direction (perpendicular to the transverse pipe)
  const rollDirX = normalizeZero(sinYaw)
  const rollDirZ = normalizeZero(cosYaw)

  return {
    mountType,
    wallSide,
    wallRow,
    wallCol,
    oppositeWallSide,
    oppositeWallRow,
    oppositeWallCol,
    pipeYaw,
    // Pipe local X runs along (cosYaw, -sinYaw); corridor travel axis is perpendicular (sinYaw, cosYaw)
    corridorAxis: Math.abs(Math.sin(pipeYaw)) > 0.5 ? 'ew' : 'ns',
    rollDir: { x: rollDirX, z: rollDirZ },
    localOverheadOffset: {
      x: overheadWorld.x,
      y: FALLING_PIPES_OVERHEAD_LOCAL_Y,
      z: overheadWorld.z,
    },
    localImpactOffset: {
      x: impactWorld.x,
      y: FALLING_PIPES_IMPACT_LOCAL_Y,
      z: impactWorld.z,
    },
    pipeRestY: FALLING_PIPES_OVERHEAD_LOCAL_Y,
    ceilingAnchorY: FALLING_PIPES_CEILING_SOFFIT_Y,
    aftermathHalfW: FALLING_PIPES_AFTERMATH_HALF_W,
    aftermathHalfD: FALLING_PIPES_AFTERMATH_HALF_D,
    dangerHalfW: FALLING_PIPES_DANGER_HALF_W,
    dangerHalfD: FALLING_PIPES_DANGER_HALF_D,
  }
}

const STEAM_PIPE_CEILING_SOFFIT_Y = 3.6
const STEAM_PIPE_MAIN_Y = 1.38
const STEAM_PIPE_RUPTURE_LOCAL_X = 0.14
const STEAM_PIPE_RUPTURE_LOCAL_Y = 1.38
const STEAM_PIPE_RUPTURE_LOCAL_Z = -1.72
const STEAM_PIPE_CEILING_RUPTURE_LOCAL_Z = -1.16
const STEAM_PIPE_VALVE_LOCAL_X = -0.58
const STEAM_PIPE_VALVE_LOCAL_Y = 1.28
const STEAM_PIPE_VALVE_LOCAL_Z = -1.72
const STEAM_PIPE_CEILING_VALVE_LOCAL_Z = -1.16
const STEAM_PIPE_PLUME_LOCAL_X = 0.12
const STEAM_PIPE_PLUME_LOCAL_Y = 1.26
const STEAM_PIPE_PLUME_LOCAL_Z = -0.5

export const STEAM_PIPE_CONSTANTS = Object.freeze({
  ceilingSoffitY: STEAM_PIPE_CEILING_SOFFIT_Y,
  pipeMainY: STEAM_PIPE_MAIN_Y,
  ruptureLocalX: STEAM_PIPE_RUPTURE_LOCAL_X,
  ruptureLocalY: STEAM_PIPE_RUPTURE_LOCAL_Y,
  ruptureLocalZ: STEAM_PIPE_RUPTURE_LOCAL_Z,
  ceilingRuptureLocalZ: STEAM_PIPE_CEILING_RUPTURE_LOCAL_Z,
  valveLocalX: STEAM_PIPE_VALVE_LOCAL_X,
  valveLocalY: STEAM_PIPE_VALVE_LOCAL_Y,
  valveLocalZ: STEAM_PIPE_VALVE_LOCAL_Z,
  ceilingValveLocalZ: STEAM_PIPE_CEILING_VALVE_LOCAL_Z,
  plumeLocalX: STEAM_PIPE_PLUME_LOCAL_X,
  plumeLocalY: STEAM_PIPE_PLUME_LOCAL_Y,
  plumeLocalZ: STEAM_PIPE_PLUME_LOCAL_Z,
  dangerCenterLocalX: 0.12,
  dangerHalfW: 1.28,
  dangerMinLocalZ: -1.82,
  ceilingDangerMinLocalZ: -1.45,
  dangerMaxLocalZ: 0.74,
  decoyLayerName: 'maze-steam-pipe-decoys',
})

/**
 * Resolves a realistic wall- or ceiling-integrated mounting pose for the
 * Steam Pipe Burst hazard.
 *
 * - Prefers an adjacent solid corridor side wall (`mountType: 'wall'`) where
 *   the pressurized steam main, supply/return vertical risers, manual shutoff
 *   handwheel valve, pressure gauge, and bolted union flange are anchored flush
 *   against the wall (`z = -1.80m`) and tied into the ceiling soffit (`y = 3.60m`)
 *   and floor bulkhead (`y = 0.02m`).
 * - Falls back to a ceiling-hung pressurized manifold frame (`mountType: 'ceiling'`)
 *   in open 4-way intersections without adjacent walls.
 */
export function resolveSteamPipeMount(
  grid,
  row,
  col,
  rng = null,
  preferredWallSide = null
) {
  const rows = Array.isArray(grid) ? grid.length : 0
  const cols = rows > 0 && Array.isArray(grid[0]) ? grid[0].length : 0
  const r = Number.isFinite(row) ? row : 0
  const c = Number.isFinite(col) ? col : 0

  const adjacentWalls = []
  if (rows > 0 && cols > 0) {
    for (let i = 0; i < WALL_MOUNT_DIRECTIONS.length; i += 1) {
      const dir = WALL_MOUNT_DIRECTIONS[i]
      const wr = r + dir.dr
      const wc = c + dir.dc
      if (grid[wr]?.[wc] === CELL_TYPES.WALL) {
        const isBoundaryWall =
          wr <= 0 || wr >= rows - 1 || wc <= 0 || wc >= cols - 1
        const hasOppositePath = grid[r - dir.dr]?.[c - dir.dc] === CELL_TYPES.PATH
        const perpOpenA = grid[r + dir.dc]?.[c + dir.dr] === CELL_TYPES.PATH
        const perpOpenB = grid[r - dir.dc]?.[c - dir.dr] === CELL_TYPES.PATH
        const isCorridorSideWall = perpOpenA || perpOpenB
        adjacentWalls.push({
          ...dir,
          wallRow: wr,
          wallCol: wc,
          isBoundaryWall,
          hasOppositePath,
          isCorridorSideWall,
        })
      }
    }
  }

  let chosen = null

  if (preferredWallSide) {
    chosen =
      adjacentWalls.find((w) => w.side === preferredWallSide) ||
      WALL_MOUNT_DIRECTIONS.find((d) => d.side === preferredWallSide) ||
      null
    if (chosen && chosen.wallRow === undefined) {
      chosen = {
        ...chosen,
        wallRow: r + chosen.dr,
        wallCol: c + chosen.dc,
        isBoundaryWall: false,
      }
    }
  }

  if (!chosen && adjacentWalls.length > 0) {
    const sideWithOppositeOpen = adjacentWalls.filter(
      (w) => w.isCorridorSideWall && w.hasOppositePath
    )
    const sideWalls = adjacentWalls.filter((w) => w.isCorridorSideWall)
    const interiorWalls = adjacentWalls.filter((w) => !w.isBoundaryWall)
    const pool =
      sideWithOppositeOpen.length > 0
        ? sideWithOppositeOpen
        : sideWalls.length > 0
          ? sideWalls
          : interiorWalls.length > 0
            ? interiorWalls
            : adjacentWalls
    const idx =
      typeof rng === 'function'
        ? Math.floor(rng() * pool.length) % pool.length
        : (r * 13 + c * 19) % pool.length
    chosen = pool[idx]
  }

  let mountType
  let steamYaw
  let wallSide = null
  let wallRow = null
  let wallCol = null

  if (chosen) {
    mountType = 'wall'
    wallSide = chosen.side
    wallRow = chosen.wallRow
    wallCol = chosen.wallCol
    steamYaw = normalizeZero(chosen.yaw)
  } else if (rows > 0 && cols > 0) {
    mountType = 'ceiling'
    let openNS = 0
    let openEW = 0
    if (grid[r - 1]?.[c] === CELL_TYPES.PATH) openNS += 1
    if (grid[r + 1]?.[c] === CELL_TYPES.PATH) openNS += 1
    if (grid[r]?.[c - 1] === CELL_TYPES.PATH) openEW += 1
    if (grid[r]?.[c + 1] === CELL_TYPES.PATH) openEW += 1
    if (openNS > openEW) {
      steamYaw = Math.PI * 0.5
    } else if (openEW > openNS) {
      steamYaw = 0
    } else {
      steamYaw = ((r + c) & 1) === 0 ? 0 : Math.PI * 0.5
    }
  } else {
    const fallbackDir = WALL_MOUNT_DIRECTIONS[(r + c) % WALL_MOUNT_DIRECTIONS.length]
    mountType = 'wall'
    wallSide = fallbackDir.side
    wallRow = r + fallbackDir.dr
    wallCol = c + fallbackDir.dc
    steamYaw = normalizeZero(fallbackDir.yaw)
  }

  const cosYaw = Math.cos(steamYaw)
  const sinYaw = Math.sin(steamYaw)
  const toCellWorld = (lx, lz) => ({
    x: normalizeZero(lx * cosYaw + lz * sinYaw),
    z: normalizeZero(-lx * sinYaw + lz * cosYaw),
  })

  const ruptureLocalZ =
    mountType === 'ceiling'
      ? STEAM_PIPE_CEILING_RUPTURE_LOCAL_Z
      : STEAM_PIPE_RUPTURE_LOCAL_Z
  const valveLocalZ =
    mountType === 'ceiling'
      ? STEAM_PIPE_CEILING_VALVE_LOCAL_Z
      : STEAM_PIPE_VALVE_LOCAL_Z
  const plumeLocalZ =
    mountType === 'ceiling' ? -0.34 : STEAM_PIPE_PLUME_LOCAL_Z
  const dangerMinLocalZ =
    mountType === 'ceiling'
      ? STEAM_PIPE_CONSTANTS.ceilingDangerMinLocalZ
      : STEAM_PIPE_CONSTANTS.dangerMinLocalZ

  const ruptureWorld = toCellWorld(STEAM_PIPE_RUPTURE_LOCAL_X, ruptureLocalZ)
  const valveWorld = toCellWorld(STEAM_PIPE_VALVE_LOCAL_X, valveLocalZ)
  const plumeWorld = toCellWorld(STEAM_PIPE_PLUME_LOCAL_X, plumeLocalZ)
  const ruptureDirX = normalizeZero(sinYaw)
  const ruptureDirZ = normalizeZero(cosYaw)

  return {
    mountType,
    wallSide,
    wallRow,
    wallCol,
    steamYaw,
    corridorAxis: Math.abs(Math.sin(steamYaw)) > 0.5 ? 'ns' : 'ew',
    ruptureDir: { x: ruptureDirX, z: ruptureDirZ },
    localRuptureOffset: {
      x: ruptureWorld.x,
      y: STEAM_PIPE_RUPTURE_LOCAL_Y,
      z: ruptureWorld.z,
    },
    localValveOffset: {
      x: valveWorld.x,
      y: STEAM_PIPE_VALVE_LOCAL_Y,
      z: valveWorld.z,
    },
    localImpactOffset: {
      x: plumeWorld.x,
      y: STEAM_PIPE_PLUME_LOCAL_Y,
      z: plumeWorld.z,
    },
    pipeMainY: STEAM_PIPE_MAIN_Y,
    ceilingAnchorY: STEAM_PIPE_CEILING_SOFFIT_Y,
    dangerCenterLocalX: STEAM_PIPE_CONSTANTS.dangerCenterLocalX,
    dangerHalfW: STEAM_PIPE_CONSTANTS.dangerHalfW,
    dangerMinLocalZ,
    dangerMaxLocalZ: STEAM_PIPE_CONSTANTS.dangerMaxLocalZ,
  }
}

function collectDecoyExclusions(
  maze,
  {
    hazards = null,
    collectibles = null,
    keycards = null,
    excludedCells = null,
    placedProps = null,
  } = {}
) {
  const blockedCells = new Set()
  const blockedWallFaces = new Set()

  const markAllWallsInCell = (r, c) => {
    if (!Number.isInteger(r) || !Number.isInteger(c)) return
    for (let i = 0; i < WALL_MOUNT_DIRECTIONS.length; i += 1) {
      const dir = WALL_MOUNT_DIRECTIONS[i]
      blockedWallFaces.add(`${r + dir.dr},${c + dir.dc},${dir.side}`)
    }
  }

  if (maze.start) {
    blockedCells.add(`${maze.start.row},${maze.start.col}`)
    markAllWallsInCell(maze.start.row, maze.start.col)
  }
  if (maze.exit) {
    blockedCells.add(`${maze.exit.row},${maze.exit.col}`)
    markAllWallsInCell(maze.exit.row, maze.exit.col)
  }

  const resolvedHazards = Array.isArray(hazards)
    ? hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : []
  for (let i = 0; i < resolvedHazards.length; i += 1) {
    const h = resolvedHazards[i]
    if (!h || !Number.isInteger(h.row) || !Number.isInteger(h.col)) continue
    blockedCells.add(`${h.row},${h.col}`)
    markAllWallsInCell(h.row, h.col)
    if (Number.isInteger(h.wallRow) && Number.isInteger(h.wallCol) && h.wallSide) {
      blockedWallFaces.add(`${h.wallRow},${h.wallCol},${h.wallSide}`)
    }
  }

  const resolvedProps = Array.isArray(placedProps)
    ? placedProps
    : Array.isArray(maze.environmentalProps)
      ? maze.environmentalProps
      : []
  for (let i = 0; i < resolvedProps.length; i += 1) {
    const p = resolvedProps[i]
    if (!p || !Number.isInteger(p.row) || !Number.isInteger(p.col)) continue
    blockedCells.add(`${p.row},${p.col}`)
    if (p.wallSide) {
      const match = WALL_MOUNT_DIRECTIONS.find((d) => d.side === p.wallSide)
      if (match) {
        blockedWallFaces.add(`${p.row + match.dr},${p.col + match.dc},${match.side}`)
      }
    } else {
      markAllWallsInCell(p.row, p.col)
    }
  }

  const resolvedCollectibles = Array.isArray(collectibles)
    ? collectibles
    : Array.isArray(collectibles?.items)
      ? collectibles.items
      : Array.isArray(maze.collectibles?.items)
        ? maze.collectibles.items
        : []
  for (let i = 0; i < resolvedCollectibles.length; i += 1) {
    const item = resolvedCollectibles[i]
    if (item && Number.isInteger(item.row) && Number.isInteger(item.col)) {
      blockedCells.add(`${item.row},${item.col}`)
    }
  }

  const resolvedKeycards = Array.isArray(keycards)
    ? keycards
    : Array.isArray(maze.keycards)
      ? maze.keycards
      : []
  for (let i = 0; i < resolvedKeycards.length; i += 1) {
    const kc = resolvedKeycards[i]
    if (kc && Number.isInteger(kc.row) && Number.isInteger(kc.col)) {
      blockedCells.add(`${kc.row},${kc.col}`)
    }
  }

  if (excludedCells) {
    const entries =
      excludedCells instanceof Set
        ? Array.from(excludedCells)
        : Array.isArray(excludedCells)
          ? excludedCells
          : []
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (typeof entry === 'string') {
        blockedCells.add(entry)
      } else if (entry && Number.isInteger(entry.row) && Number.isInteger(entry.col)) {
        blockedCells.add(`${entry.row},${entry.col}`)
        if (Number.isInteger(entry.wallRow) && Number.isInteger(entry.wallCol) && entry.wallSide) {
          blockedWallFaces.add(`${entry.wallRow},${entry.wallCol},${entry.wallSide}`)
        }
      }
    }
  }

  return { blockedCells, blockedWallFaces }
}

/**
 * Balanced decoy target count scoped exclusively to the four 6/12 environmental
 * camouflage decoy layers (electrical wiring, ceiling collapse, steam pipes,
 * and falling pipes/fixtures) so all four layers coexist without starving
 * downstream placements on dense corridors.
 */
function resolveEnvironmentalCamouflageDecoyTargetCount(walkableCount) {
  return Math.max(2, Math.min(5, Math.round(walkableCount / 52)))
}

/**
 * Places deterministic, non-hazardous intact electrical panel + conduit decoys
 * on unoccupied corridor walls and ceiling intersections so electrical hardware
 * silhouettes alone do not betray `exposed_electrical_wiring` traps.
 */
export function placeElectricalWiringDecoys(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) return []
  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return []

  const { blockedCells, blockedWallFaces } = collectDecoyExclusions(maze, options)

  let walkableCount = 0
  const wallCandidates = []
  const ceilingCandidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      if (blockedCells.has(`${r},${c}`)) continue
      if (maze.start && Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2) {
        continue
      }

      const mount = resolveElectricalMount(grid, r, c, null)
      if (mount.mountType === 'wall') {
        if (
          Number.isInteger(mount.wallRow) &&
          Number.isInteger(mount.wallCol) &&
          mount.wallSide &&
          blockedWallFaces.has(`${mount.wallRow},${mount.wallCol},${mount.wallSide}`)
        ) {
          continue
        }
        wallCandidates.push({ row: r, col: c, ...mount })
      } else {
        ceilingCandidates.push({ row: r, col: c, ...mount })
      }
    }
  }

  if (wallCandidates.length === 0 && ceilingCandidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-electrical-wiring-decoys-v1`)
  const ordered = [
    ...shuffleWithRng(wallCandidates, rng),
    ...shuffleWithRng(ceilingCandidates, rng),
  ]
  const targetCount = resolveEnvironmentalCamouflageDecoyTargetCount(walkableCount)
  const decoys = []

  for (let i = 0; i < ordered.length && decoys.length < targetCount; i += 1) {
    const cand = ordered[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 2
    )
    if (tooClose) continue

    decoys.push({
      id: `electrical-wiring-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      ...cand,
    })
  }

  return decoys
}

/**
 * Places deterministic, structurally sound precast ceiling soffit panel decoys
 * in unoccupied corridor cells matching dormant `ceiling_collapse` bays.
 */
export function placeCeilingCollapseDecoys(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) return []
  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return []

  const { blockedCells } = collectDecoyExclusions(maze, options)

  let walkableCount = 0
  const candidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      if (blockedCells.has(`${r},${c}`)) continue
      if (maze.start && Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2) {
        continue
      }

      const mount = resolveCeilingCollapseMount(grid, r, c, null)
      candidates.push({ row: r, col: c, ...mount })
    }
  }

  if (candidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-ceiling-collapse-decoys-v1`)
  const ordered = shuffleWithRng(candidates, rng)
  const targetCount = resolveEnvironmentalCamouflageDecoyTargetCount(walkableCount)
  const decoys = []

  for (let i = 0; i < ordered.length && decoys.length < targetCount; i += 1) {
    const cand = ordered[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 2
    )
    if (tooClose) continue

    decoys.push({
      id: `ceiling-collapse-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      ...cand,
    })
  }

  return decoys
}

/**
 * Places deterministic intact non-hazardous pressurized steam pipe manifold decoys
 * along corridor walls and ceiling intersections matching dormant `steam_pipe_burst`.
 */
export function placeSteamPipeDecoys(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) return []
  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return []

  const { blockedCells, blockedWallFaces } = collectDecoyExclusions(maze, options)

  let walkableCount = 0
  const wallCandidates = []
  const ceilingCandidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      if (blockedCells.has(`${r},${c}`)) continue
      if (maze.start && Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2) {
        continue
      }

      const mount = resolveSteamPipeMount(grid, r, c, null)
      if (mount.mountType === 'wall') {
        if (
          Number.isInteger(mount.wallRow) &&
          Number.isInteger(mount.wallCol) &&
          mount.wallSide &&
          blockedWallFaces.has(`${mount.wallRow},${mount.wallCol},${mount.wallSide}`)
        ) {
          continue
        }
        wallCandidates.push({ row: r, col: c, ...mount })
      } else {
        ceilingCandidates.push({ row: r, col: c, ...mount })
      }
    }
  }

  if (wallCandidates.length === 0 && ceilingCandidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-steam-pipe-decoys-v1`)
  const ordered = [
    ...shuffleWithRng(wallCandidates, rng),
    ...shuffleWithRng(ceilingCandidates, rng),
  ]
  const targetCount = resolveEnvironmentalCamouflageDecoyTargetCount(walkableCount)
  const decoys = []

  for (let i = 0; i < ordered.length && decoys.length < targetCount; i += 1) {
    const cand = ordered[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 2
    )
    if (tooClose) continue

    decoys.push({
      id: `steam-pipe-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      ...cand,
    })
  }

  return decoys
}

/**
 * Places deterministic intact non-hazardous overhead pipe + valve fixture decoys
 * matching dormant `falling_pipes_fixtures` mounts across corridors.
 */
export function placeFallingPipesDecoys(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) return []
  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return []

  const { blockedCells, blockedWallFaces } = collectDecoyExclusions(maze, options)

  let walkableCount = 0
  const wallCandidates = []
  const ceilingCandidates = []
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      walkableCount += 1
      if (blockedCells.has(`${r},${c}`)) continue
      if (maze.start && Math.abs(r - maze.start.row) + Math.abs(c - maze.start.col) <= 2) {
        continue
      }

      const mount = resolveFallingPipesMount(grid, r, c, null)
      if (mount.mountType === 'wall') {
        const leftWallBlocked =
          Number.isInteger(mount.wallRow) &&
          Number.isInteger(mount.wallCol) &&
          mount.wallSide &&
          blockedWallFaces.has(`${mount.wallRow},${mount.wallCol},${mount.wallSide}`)
        const rightWallBlocked =
          Number.isInteger(mount.oppositeWallRow) &&
          Number.isInteger(mount.oppositeWallCol) &&
          mount.oppositeWallSide &&
          blockedWallFaces.has(
            `${mount.oppositeWallRow},${mount.oppositeWallCol},${mount.oppositeWallSide}`
          )
        if (leftWallBlocked || rightWallBlocked) {
          continue
        }
        wallCandidates.push({ row: r, col: c, ...mount })
      } else {
        ceilingCandidates.push({ row: r, col: c, ...mount })
      }
    }
  }

  if (wallCandidates.length === 0 && ceilingCandidates.length === 0) return []

  const rng = createRng(`${maze.seed ?? maze.id ?? 'maze'}-falling-pipes-decoys-v1`)
  const ordered = [
    ...shuffleWithRng(wallCandidates, rng),
    ...shuffleWithRng(ceilingCandidates, rng),
  ]
  const targetCount = resolveEnvironmentalCamouflageDecoyTargetCount(walkableCount)
  const decoys = []

  for (let i = 0; i < ordered.length && decoys.length < targetCount; i += 1) {
    const cand = ordered[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 2
    )
    if (tooClose) continue

    decoys.push({
      id: `falling-pipes-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
      ...cand,
    })
  }

  return decoys
}

const VALID_HAZARD_TYPE_SET = new Set(Object.values(HAZARD_TYPES))

const MOUNT_DIR_BY_SIDE = Object.freeze(
  Object.fromEntries(WALL_MOUNT_DIRECTIONS.map((d) => [d.side, d]))
)

const SURGE_DIR_BY_SIDE = Object.freeze(
  Object.fromEntries(WATER_SURGE_DIRECTIONS.map((d) => [d.side, d]))
)

function normalizeCellKeySet(input) {
  const keys = new Set()
  if (!input) return keys
  const entries =
    input instanceof Set ? Array.from(input) : Array.isArray(input) ? input : []
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (typeof entry === 'string') {
      keys.add(entry)
    } else if (entry && Number.isInteger(entry.row) && Number.isInteger(entry.col)) {
      keys.add(`${entry.row},${entry.col}`)
    }
  }
  return keys
}

function getMountingCategoryForType(type) {
  if (
    type === HAZARD_TYPES.WALL_COLLAPSE ||
    type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE
  ) {
    return 'wall'
  }
  if (
    type === HAZARD_TYPES.STEAM_PIPE_BURST ||
    type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING ||
    type === HAZARD_TYPES.FALLING_PIPES_FIXTURES
  ) {
    return 'dual_wall_ceiling'
  }
  if (type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
    return 'floor'
  }
  if (
    type === HAZARD_TYPES.CEILING_COLLAPSE ||
    type === HAZARD_TYPES.FALLING_WATER_TANK ||
    type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY ||
    type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE
  ) {
    return 'ceiling'
  }
  return 'unknown'
}

function getAdjacentWallDirections(grid, row, col) {
  const dirs = []
  for (let i = 0; i < WALL_MOUNT_DIRECTIONS.length; i += 1) {
    const dir = WALL_MOUNT_DIRECTIONS[i]
    if (grid[row + dir.dr]?.[col + dir.dc] === CELL_TYPES.WALL) {
      dirs.push(dir)
    }
  }
  return dirs
}

function getAdjacentPathDirections(grid, row, col) {
  const dirs = []
  for (let i = 0; i < WATER_SURGE_DIRECTIONS.length; i += 1) {
    const dir = WATER_SURGE_DIRECTIONS[i]
    if (grid[row + dir.dr]?.[col + dir.dc] === CELL_TYPES.PATH) {
      dirs.push(dir)
    }
  }
  return dirs
}

function resolveDirectionFromVector(vec) {
  if (!vec || !Number.isFinite(vec.x) || !Number.isFinite(vec.z)) return null
  const dz = Math.round(vec.z)
  const dx = Math.round(vec.x)
  for (let i = 0; i < WATER_SURGE_DIRECTIONS.length; i += 1) {
    const d = WATER_SURGE_DIRECTIONS[i]
    if (d.dr === dz && d.dc === dx) return d
  }
  return null
}

function resolveUniqueHazardId(preferredId, type, row, col, usedIds) {
  const trimmed = typeof preferredId === 'string' ? preferredId.trim() : ''
  if (trimmed && !usedIds.has(trimmed)) {
    usedIds.add(trimmed)
    return trimmed
  }
  const cellBase = `hazard-${row}-${col}`
  if (!trimmed && !usedIds.has(cellBase)) {
    usedIds.add(cellBase)
    return cellBase
  }
  const typedBase = trimmed || `hazard-${type}-${row}-${col}`
  if (!usedIds.has(typedBase)) {
    usedIds.add(typedBase)
    return typedBase
  }
  let suffix = 2
  while (usedIds.has(`${typedBase}-${suffix}`)) {
    suffix += 1
  }
  const finalId = `${typedBase}-${suffix}`
  usedIds.add(finalId)
  return finalId
}

/**
 * Validates an individual hazard placement/spec against maze geometry, start/exit
 * exclusion, cell occupancy, and mounting-category structural constraints
 * (wall-mounted, ceiling-mounted, floor-mounted, and dual wall/ceiling mounts).
 */
export function validateHazardPlacement(maze, spec, options = {}) {
  const type = spec?.type
  const category = getMountingCategoryForType(type)

  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) {
    return { valid: false, reason: 'invalid_maze_grid', category }
  }
  if (!type || !VALID_HAZARD_TYPE_SET.has(type)) {
    return { valid: false, reason: 'unsupported_hazard_type', category }
  }

  const rows = grid.length
  const cols = grid[0].length
  const row = spec?.row
  const col = spec?.col
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return { valid: false, reason: 'invalid_coordinates', category }
  }
  if (row < 0 || row >= rows || col < 0 || col >= cols) {
    return { valid: false, reason: 'out_of_bounds', category }
  }
  if (grid[row]?.[col] !== CELL_TYPES.PATH) {
    return { valid: false, reason: 'non_walkable_cell', category }
  }

  const key = `${row},${col}`
  if (!options.allowStartExit) {
    if (maze.start && maze.start.row === row && maze.start.col === col) {
      return { valid: false, reason: 'overlaps_start', category }
    }
    if (maze.exit && maze.exit.row === row && maze.exit.col === col) {
      return { valid: false, reason: 'overlaps_exit', category }
    }
  }

  if (!options.skipOccupancyCheck && options.occupiedCells?.has?.(key)) {
    return { valid: false, reason: 'cell_occupied', category }
  }
  if (
    !options.skipCoexistenceCheck &&
    Array.isArray(options.hidingSpots) &&
    options.hidingSpots.length > 0
  ) {
    const conflict = findHidingSpotConflictForHazard(spec, options.hidingSpots, maze)
    if (conflict.conflict) {
      return {
        valid: false,
        reason:
          conflict.reason === 'same_cell_overlap'
            ? 'overlaps_hiding_spot'
            : conflict.reason,
        category,
        conflictWith: conflict.hidingSpot?.id || null,
      }
    }
  }
  if (options.excludedCells?.has?.(key)) {
    return { valid: false, reason: 'cell_excluded', category }
  }

  const validateExplicitWallTarget = (allowNullSide = false) => {
    if (spec.wallSide !== undefined && spec.wallSide !== null) {
      const dir = MOUNT_DIR_BY_SIDE[spec.wallSide]
      if (!dir) {
        return { valid: false, reason: 'invalid_wall_side', category }
      }
      if (grid[row + dir.dr]?.[col + dir.dc] !== CELL_TYPES.WALL) {
        return { valid: false, reason: 'wall_side_not_solid_wall', category }
      }
    } else if (!allowNullSide && spec.wallSide === null) {
      return { valid: false, reason: 'missing_wall_side', category }
    }

    if (
      (spec.wallRow !== undefined && spec.wallRow !== null) ||
      (spec.wallCol !== undefined && spec.wallCol !== null)
    ) {
      if (!Number.isInteger(spec.wallRow) || !Number.isInteger(spec.wallCol)) {
        return { valid: false, reason: 'invalid_wall_coordinates', category }
      }
      const dist = Math.abs(spec.wallRow - row) + Math.abs(spec.wallCol - col)
      if (dist !== 1 || grid[spec.wallRow]?.[spec.wallCol] !== CELL_TYPES.WALL) {
        return { valid: false, reason: 'wall_target_not_solid_wall', category }
      }
    }
    return null
  }

  if (type === HAZARD_TYPES.WALL_COLLAPSE) {
    const adjacentWalls = getAdjacentWallDirections(grid, row, col)
    if (adjacentWalls.length === 0) {
      return { valid: false, reason: 'wall_collapse_requires_adjacent_wall', category }
    }
    const wallErr = validateExplicitWallTarget(false)
    if (wallErr) return wallErr
    return { valid: true, reason: null, category }
  }

  if (type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
    const adjacentWalls = getAdjacentWallDirections(grid, row, col)
    if (adjacentWalls.length === 0) {
      return { valid: false, reason: 'furniture_requires_adjacent_wall', category }
    }
    const wallErr = validateExplicitWallTarget(false)
    if (wallErr) return wallErr
    return { valid: true, reason: null, category }
  }

  if (
    type === HAZARD_TYPES.STEAM_PIPE_BURST ||
    type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING
  ) {
    if (spec.mountType === 'wall') {
      const adjacentWalls = getAdjacentWallDirections(grid, row, col)
      if (adjacentWalls.length === 0) {
        return { valid: false, reason: `${type}_wall_mount_requires_adjacent_wall`, category }
      }
      const wallErr = validateExplicitWallTarget(false)
      if (wallErr) return wallErr
    } else if (spec.mountType === 'ceiling') {
      if (spec.wallSide !== undefined && spec.wallSide !== null) {
        return { valid: false, reason: `${type}_ceiling_mount_unexpected_wall_side`, category }
      }
    } else {
      const wallErr = validateExplicitWallTarget(true)
      if (wallErr) return wallErr
    }
    return { valid: true, reason: null, category }
  }

  if (type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
    const wallN = grid[row - 1]?.[col] === CELL_TYPES.WALL
    const wallS = grid[row + 1]?.[col] === CELL_TYPES.WALL
    const wallW = grid[row]?.[col - 1] === CELL_TYPES.WALL
    const wallE = grid[row]?.[col + 1] === CELL_TYPES.WALL

    if (spec.mountType === 'wall') {
      if (spec.wallSide === 'west' || spec.wallSide === 'east') {
        if (!wallW || !wallE) {
          return { valid: false, reason: 'falling_pipes_wall_mount_requires_ew_walls', category }
        }
      } else if (spec.wallSide === 'north' || spec.wallSide === 'south') {
        if (!wallN || !wallS) {
          return { valid: false, reason: 'falling_pipes_wall_mount_requires_ns_walls', category }
        }
      } else if (spec.wallSide !== undefined && spec.wallSide !== null) {
        return { valid: false, reason: 'invalid_wall_side', category }
      } else if (!(wallW && wallE) && !(wallN && wallS)) {
        return { valid: false, reason: 'falling_pipes_wall_mount_requires_flanking_walls', category }
      }
    } else if (spec.wallSide !== undefined && spec.wallSide !== null) {
      const dir = MOUNT_DIR_BY_SIDE[spec.wallSide]
      if (!dir || grid[row + dir.dr]?.[col + dir.dc] !== CELL_TYPES.WALL) {
        return { valid: false, reason: 'wall_side_not_solid_wall', category }
      }
    }
    return { valid: true, reason: null, category }
  }

  if (type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
    const mount = spec.localPitOffset
      ? spec
      : resolveFloorGrateMount(grid, row, col)
    const offsetX = Number(mount.localPitOffset?.x ?? 0)
    const offsetZ = Number(mount.localPitOffset?.z ?? 0)
    const grateYaw = Number.isFinite(mount.grateYaw) ? mount.grateYaw : 0
    const rawHalfW = Number.isFinite(mount.frameOuterHalfW)
      ? mount.frameOuterHalfW
      : FLOOR_GRATE_CONSTANTS.frameOuterHalfW
    const rawHalfD = Number.isFinite(mount.frameOuterHalfD)
      ? mount.frameOuterHalfD
      : FLOOR_GRATE_CONSTANTS.frameOuterHalfD
    const cosY = Math.abs(Math.cos(grateYaw))
    const sinY = Math.abs(Math.sin(grateYaw))
    const worldHalfW = cosY * rawHalfW + sinY * rawHalfD
    const worldHalfD = sinY * rawHalfW + cosY * rawHalfD
    const cellHalf = CELL_SIZE * 0.5
    if (
      !Number.isFinite(offsetX) ||
      !Number.isFinite(offsetZ) ||
      Math.abs(offsetX) + worldHalfW > cellHalf + 1e-4 ||
      Math.abs(offsetZ) + worldHalfD > cellHalf + 1e-4
    ) {
      return { valid: false, reason: 'floor_grate_out_of_cell_bounds', category }
    }
    return { valid: true, reason: null, category }
  }

  if (type === HAZARD_TYPES.CEILING_COLLAPSE) {
    if (spec.wallSide !== undefined && spec.wallSide !== null) {
      const dir = MOUNT_DIR_BY_SIDE[spec.wallSide]
      if (!dir || grid[row + dir.dr]?.[col + dir.dc] !== CELL_TYPES.WALL) {
        return { valid: false, reason: 'ceiling_collapse_wall_side_not_solid_wall', category }
      }
    }
    if (spec.localPatchOffset) {
      const ox = Number(spec.localPatchOffset.x)
      const oz = Number(spec.localPatchOffset.z)
      const cellHalf = CELL_SIZE * 0.5
      if (
        !Number.isFinite(ox) ||
        !Number.isFinite(oz) ||
        Math.abs(ox) >= cellHalf ||
        Math.abs(oz) >= cellHalf
      ) {
        return { valid: false, reason: 'ceiling_patch_out_of_cell_bounds', category }
      }
    }
    return { valid: true, reason: null, category }
  }

  if (type === HAZARD_TYPES.FALLING_WATER_TANK) {
    const openDirs = getAdjacentPathDirections(grid, row, col)
    if (openDirs.length === 0) {
      return { valid: false, reason: 'water_tank_requires_open_corridor_direction', category }
    }
    const flowDirObj = spec.flowSide
      ? SURGE_DIR_BY_SIDE[spec.flowSide] || null
      : spec.flowDir
        ? resolveDirectionFromVector(spec.flowDir)
        : null
    if ((spec.flowSide || spec.flowDir) && (!flowDirObj || grid[row + flowDirObj.dr]?.[col + flowDirObj.dc] !== CELL_TYPES.PATH)) {
      return { valid: false, reason: 'water_tank_flow_blocked_by_wall', category }
    }
    if (spec.mountType === 'ceiling_wall_brace') {
      const wallErr = validateExplicitWallTarget(false)
      if (wallErr) return wallErr
      if (!spec.wallSide && getAdjacentWallDirections(grid, row, col).length === 0) {
        return { valid: false, reason: 'water_tank_wall_brace_requires_wall', category }
      }
    } else if (spec.wallSide !== undefined && spec.wallSide !== null) {
      const wallErr = validateExplicitWallTarget(true)
      if (wallErr) return wallErr
    }
    return { valid: true, reason: null, category }
  }

  if (type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
    const openDirs = getAdjacentPathDirections(grid, row, col)
    if (openDirs.length === 0) {
      return { valid: false, reason: 'machinery_requires_open_swing_direction', category }
    }
    const swingDirObj = spec.swingSide
      ? SURGE_DIR_BY_SIDE[spec.swingSide] || null
      : spec.swingDir
        ? resolveDirectionFromVector(spec.swingDir)
        : null
    if ((spec.swingSide || spec.swingDir) && (!swingDirObj || grid[row + swingDirObj.dr]?.[col + swingDirObj.dc] !== CELL_TYPES.PATH)) {
      return { valid: false, reason: 'machinery_swing_blocked_by_wall', category }
    }
    if (spec.mountType === 'wall_to_wall_gantry') {
      const dirToCheck = swingDirObj || openDirs[0]
      const perpDr = dirToCheck.dc
      const perpDc = -dirToCheck.dr
      const leftWall = grid[row + perpDr]?.[col + perpDc] === CELL_TYPES.WALL
      const rightWall = grid[row - perpDr]?.[col - perpDc] === CELL_TYPES.WALL
      if (!leftWall || !rightWall) {
        return { valid: false, reason: 'machinery_wall_gantry_requires_flanking_walls', category }
      }
    }
    return { valid: true, reason: null, category }
  }

  if (type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
    const openDirs = getAdjacentPathDirections(grid, row, col)
    if (openDirs.length === 0) {
      return { valid: false, reason: 'ventilation_duct_requires_open_drop_direction', category }
    }
    const dropDirObj = spec.dropSide
      ? SURGE_DIR_BY_SIDE[spec.dropSide] || null
      : spec.dropDir
        ? resolveDirectionFromVector(spec.dropDir)
        : null
    if ((spec.dropSide || spec.dropDir) && (!dropDirObj || grid[row + dropDirObj.dr]?.[col + dropDirObj.dc] !== CELL_TYPES.PATH)) {
      return { valid: false, reason: 'ventilation_duct_drop_blocked_by_wall', category }
    }
    if (spec.mountType === 'wall_bulkhead_duct') {
      const wallErr = validateExplicitWallTarget(false)
      if (wallErr) return wallErr
      if (!spec.wallSide && getAdjacentWallDirections(grid, row, col).length === 0) {
        return { valid: false, reason: 'ventilation_duct_bulkhead_requires_wall', category }
      }
    } else if (spec.wallSide !== undefined && spec.wallSide !== null) {
      const wallErr = validateExplicitWallTarget(true)
      if (wallErr) return wallErr
    }
    return { valid: true, reason: null, category }
  }

  return { valid: false, reason: 'unsupported_hazard_type', category }
}

/**
 * Builds a fully resolved, individually configured hazard spec at `(row, col)`
 * for `type`, preserving optional explicit mount preferences when supplied.
 */
export function buildHazardSpec(maze, type, cell, rng = null, usedIds = null, explicitSpec = null) {
  const row = cell.row
  const col = cell.col
  const grid = maze.grid
  const idSet = usedIds instanceof Set ? usedIds : new Set()
  const preferredId = explicitSpec?.id ?? cell.id ?? null

  const spec = {
    id: resolveUniqueHazardId(preferredId, type, row, col, idSet),
    type,
    row,
    col,
    active: explicitSpec?.active !== undefined ? Boolean(explicitSpec.active) : true,
  }

  if (type === HAZARD_TYPES.CEILING_COLLAPSE) {
    const mount = resolveCeilingCollapseMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.wallSide ?? null
    )
    spec.wallSide = explicitSpec?.wallSide !== undefined ? explicitSpec.wallSide : mount.wallSide
    spec.collapseYaw = Number.isFinite(explicitSpec?.collapseYaw)
      ? explicitSpec.collapseYaw
      : mount.collapseYaw
    spec.localPatchOffset = explicitSpec?.localPatchOffset
      ? { ...explicitSpec.localPatchOffset }
      : mount.localPatchOffset
    spec.ceilingSoffitY = Number.isFinite(explicitSpec?.ceilingSoffitY)
      ? explicitSpec.ceilingSoffitY
      : mount.ceilingSoffitY
    spec.rubbleHalfW = Number.isFinite(explicitSpec?.rubbleHalfW)
      ? explicitSpec.rubbleHalfW
      : mount.rubbleHalfW
    spec.rubbleHalfD = Number.isFinite(explicitSpec?.rubbleHalfD)
      ? explicitSpec.rubbleHalfD
      : mount.rubbleHalfD
    spec.clearBias = explicitSpec?.clearBias
      ? { ...explicitSpec.clearBias }
      : mount.clearBias
  } else if (type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
    const mount = resolveRottenFurnitureMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.wallSide ?? null
    )
    spec.wallSide = mount.wallSide
    spec.wallRow = mount.wallRow
    spec.wallCol = mount.wallCol
    spec.wallYaw = mount.wallYaw
    spec.lateralOffset = mount.lateralOffset
    spec.tipDir = mount.tipDir
    spec.localUprightOffset = mount.localUprightOffset
    spec.localImpactOffset = mount.localImpactOffset
    spec.uprightHalfW = mount.uprightHalfW
    spec.uprightHalfD = mount.uprightHalfD
    spec.aftermathHalfW = mount.aftermathHalfW
    spec.aftermathHalfD = mount.aftermathHalfD
  } else if (type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
    const mount = resolveFallingPipesMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.wallSide ?? null
    )
    spec.mountType = mount.mountType
    spec.wallSide = mount.wallSide
    spec.wallRow = mount.wallRow
    spec.wallCol = mount.wallCol
    spec.oppositeWallSide = mount.oppositeWallSide
    spec.oppositeWallRow = mount.oppositeWallRow
    spec.oppositeWallCol = mount.oppositeWallCol
    spec.pipeYaw = mount.pipeYaw
    spec.corridorAxis = mount.corridorAxis
    spec.rollDir = mount.rollDir
    spec.localOverheadOffset = mount.localOverheadOffset
    spec.localImpactOffset = mount.localImpactOffset
    spec.pipeRestY = mount.pipeRestY
    spec.ceilingAnchorY = mount.ceilingAnchorY
    spec.aftermathHalfW = mount.aftermathHalfW
    spec.aftermathHalfD = mount.aftermathHalfD
    spec.dangerHalfW = mount.dangerHalfW
    spec.dangerHalfD = mount.dangerHalfD
  } else if (type === HAZARD_TYPES.STEAM_PIPE_BURST) {
    const mount = resolveSteamPipeMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.wallSide ?? null
    )
    spec.mountType = mount.mountType
    spec.wallSide = mount.wallSide
    spec.wallRow = mount.wallRow
    spec.wallCol = mount.wallCol
    spec.steamYaw = mount.steamYaw
    spec.corridorAxis = mount.corridorAxis
    spec.ruptureDir = mount.ruptureDir
    spec.localRuptureOffset = mount.localRuptureOffset
    spec.localValveOffset = mount.localValveOffset
    spec.localImpactOffset = mount.localImpactOffset
    spec.pipeMainY = mount.pipeMainY
    spec.ceilingAnchorY = mount.ceilingAnchorY
    spec.dangerCenterLocalX = mount.dangerCenterLocalX
    spec.dangerHalfW = mount.dangerHalfW
    spec.dangerMinLocalZ = mount.dangerMinLocalZ
    spec.dangerMaxLocalZ = mount.dangerMaxLocalZ
  } else if (type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
    const mount = resolveElectricalMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.wallSide ?? null
    )
    spec.mountType = mount.mountType
    spec.wallSide = mount.wallSide
    spec.wallRow = mount.wallRow
    spec.wallCol = mount.wallCol
    spec.wallYaw = mount.wallYaw
    spec.localDischargeOffset = mount.localDischargeOffset
    spec.localJunctionOffset = mount.localJunctionOffset
    spec.localBreakerOffset = mount.localBreakerOffset
  } else if (type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
    const mount = resolveFloorGrateMount(grid, row, col)
    spec.floorY = mount.floorY
    spec.corridorAxis = mount.corridorAxis
    spec.grateYaw = mount.grateYaw
    spec.localPitOffset = mount.localPitOffset
    spec.pitInnerHalfW = mount.pitInnerHalfW
    spec.pitInnerHalfD = mount.pitInnerHalfD
    spec.frameOuterHalfW = mount.frameOuterHalfW
    spec.frameOuterHalfD = mount.frameOuterHalfD
    spec.pitDepth = mount.pitDepth
    spec.aftermathHalfW = mount.aftermathHalfW
    spec.aftermathHalfD = mount.aftermathHalfD
  } else if (type === HAZARD_TYPES.WALL_COLLAPSE) {
    const mount = resolveWallCollapseMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.wallSide ?? null
    )
    if (!mount) {
      return null
    }
    spec.wallSide = mount.wallSide
    spec.wallRow = mount.wallRow
    spec.wallCol = mount.wallCol
    spec.isBoundaryWall = mount.isBoundaryWall
    spec.wallYaw = mount.wallYaw
    spec.collapseDir = mount.collapseDir
    spec.localImpactOffset = mount.localImpactOffset
  } else if (type === HAZARD_TYPES.FALLING_WATER_TANK) {
    const mount = resolveWaterTankMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.flowSide ?? null
    )
    spec.mountType = mount.mountType
    spec.wallSide = mount.wallSide
    spec.wallRow = mount.wallRow
    spec.wallCol = mount.wallCol
    spec.flowSide = mount.flowSide
    spec.tankYaw = mount.tankYaw
    spec.flowDir = mount.flowDir
    spec.surgeLength = mount.surgeLength
    spec.surgeHalfWidth = mount.surgeHalfWidth
    spec.tankRestY = mount.tankRestY
    spec.ceilingAnchorY = mount.ceilingAnchorY
    spec.sideSign = mount.sideSign
    spec.aftermathHalfW = mount.aftermathHalfW
    spec.aftermathHalfD = mount.aftermathHalfD
  } else if (type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY) {
    const mount = resolveSuspendedMachineryMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.swingSide ?? null
    )
    spec.mountType = mount.mountType
    spec.ceilingStructureType = mount.ceilingStructureType
    spec.ceilingBeamY = mount.ceilingBeamY
    spec.swingSide = mount.swingSide
    spec.machineryYaw = mount.machineryYaw
    spec.swingDir = mount.swingDir
    spec.localImpactOffset = mount.localImpactOffset
    spec.machineryRestY = mount.machineryRestY
    spec.ceilingAnchorY = mount.ceilingAnchorY
    spec.sideSign = mount.sideSign
    spec.hasSideWall = mount.hasSideWall
    spec.clearedLocalX = mount.clearedLocalX
    spec.clearedLocalZ = mount.clearedLocalZ
    spec.aftermathHalfW = mount.aftermathHalfW
    spec.aftermathHalfD = mount.aftermathHalfD
    spec.aftermathYawOffset = mount.aftermathYawOffset
  } else if (type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE) {
    const mount = resolveVentilationDuctMount(
      grid,
      row,
      col,
      rng,
      explicitSpec?.dropSide ?? null
    )
    spec.mountType = mount.mountType
    spec.ceilingStructureType = mount.ceilingStructureType
    spec.ceilingBeamY = mount.ceilingBeamY
    spec.hangerPivotY = mount.hangerPivotY
    spec.wallSide = mount.wallSide
    spec.wallRow = mount.wallRow
    spec.wallCol = mount.wallCol
    spec.dropSide = mount.dropSide
    spec.ductYaw = mount.ductYaw
    spec.dropDir = mount.dropDir
    spec.localImpactOffset = mount.localImpactOffset
    spec.ductRestY = mount.ductRestY
    spec.ceilingAnchorY = mount.ceilingAnchorY
    spec.fallenY = mount.fallenY
    spec.sideSign = mount.sideSign
    spec.hasSideWall = mount.hasSideWall
    spec.clearedLocalX = mount.clearedLocalX
    spec.clearedLocalZ = mount.clearedLocalZ
    spec.aftermathHalfW = mount.aftermathHalfW
    spec.aftermathHalfD = mount.aftermathHalfD
    spec.aftermathYawOffset = mount.aftermathYawOffset
  }

  return spec
}

function evaluateCandidatePreference(maze, type, cell, assignedSlots = null, selfIdx = -1) {
  const check = validateHazardPlacement(
    maze,
    { type, row: cell.row, col: cell.col },
    { skipOccupancyCheck: true }
  )
  if (!check.valid) {
    return { requiredOk: false, preferredOk: false }
  }

  const grid = maze.grid
  if (type === HAZARD_TYPES.WALL_COLLAPSE) {
    const m = resolveWallCollapseMount(grid, cell.row, cell.col)
    return {
      requiredOk: Boolean(m),
      preferredOk: Boolean(m && !m.isBoundaryWall),
    }
  }
  if (type === HAZARD_TYPES.FALLING_PIPES_FIXTURES) {
    const m = resolveFallingPipesMount(grid, cell.row, cell.col)
    return {
      requiredOk: true,
      preferredOk: m.mountType === 'wall',
    }
  }
  if (type === HAZARD_TYPES.STEAM_PIPE_BURST) {
    const hasWall = getAdjacentWallDirections(grid, cell.row, cell.col).length > 0
    return {
      requiredOk: true,
      preferredOk: hasWall,
    }
  }
  if (type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE && Array.isArray(assignedSlots)) {
    let tooCloseToOtherGrate = false
    for (let i = 0; i < assignedSlots.length; i += 1) {
      if (i === selfIdx) continue
      const slot = assignedSlots[i]
      if (!slot || !slot.cell || slot.type !== HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) continue
      const dist = Math.abs(slot.cell.row - cell.row) + Math.abs(slot.cell.col - cell.col)
      if (dist <= 1) {
        tooCloseToOtherGrate = true
        break
      }
    }
    return {
      requiredOk: true,
      preferredOk: !tooCloseToOtherGrate,
    }
  }

  return { requiredOk: true, preferredOk: true }
}

function countTypes(list) {
  const counts = {}
  for (let i = 0; i < list.length; i += 1) {
    const t = typeof list[i] === 'string' ? list[i] : list[i]?.type
    if (!t) continue
    counts[t] = (counts[t] || 0) + 1
  }
  return counts
}

function buildPlacementReport({
  requestedTypes = [],
  placed = [],
  selection = null,
  failures = [],
  coexistenceRejections = 0,
}) {
  const requestedByType =
    selection?.typeQuantities && requestedTypes.length === selection.totalTargetCount
      ? { ...selection.typeQuantities }
      : countTypes(requestedTypes)
  const placedByType = countTypes(placed)
  const missingByType = {}
  const missingSelectedTypes = []
  const underMinimumTypes = []
  const minRequired = selection?.minInstancesPerType ?? 0

  for (const [type, reqCount] of Object.entries(requestedByType)) {
    const got = placedByType[type] || 0
    if (got < reqCount) {
      missingByType[type] = reqCount - got
    }
    if (got === 0 && reqCount > 0) {
      missingSelectedTypes.push(type)
    }
    if (minRequired > 0 && got < minRequired && reqCount >= minRequired) {
      underMinimumTypes.push({ type, expectedMin: minRequired, actual: got })
    }
  }

  const requestedTotal = requestedTypes.length
  const placedTotal = placed.length
  const missingTotal = Math.max(0, requestedTotal - placedTotal)

  return {
    requestedTotal,
    placedTotal,
    missingTotal,
    shortfallTotal: missingTotal,
    hadShortfall: missingTotal > 0,
    requestedByType,
    placedByType,
    missingByType,
    shortfallsByType: { ...missingByType },
    missingSelectedTypes,
    underMinimumTypes,
    coexistenceRejections,
    failures,
    fullySatisfied:
      missingTotal === 0 &&
      failures.length === 0 &&
      missingSelectedTypes.length === 0 &&
      underMinimumTypes.length === 0,
  }
}

/**
 * Places deterministic, non-overlapping environmental hazards on reachable
 * walkable maze tiles while avoiding the start and exit positions, and returns
 * `{ hazards, selection, report }` so callers can inspect placement shortfalls
 * without silently altering the level's hazard budget/selection.
 */
export function placeHazardsWithReport(maze, options = {}) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    const emptyReport = buildPlacementReport({
      requestedTypes: [],
      placed: [],
      selection: null,
      failures: [{ stage: 'maze_validation', reason: 'invalid_maze' }],
    })
    return { hazards: [], selection: null, report: emptyReport }
  }

  const seedValue = options?.seed !== undefined ? options.seed : maze.seed
  const rng = createRng(`${seedValue}-hazards`)
  const excludedCells = normalizeCellKeySet(options?.excludedCells)
  const allowStartExit = Boolean(options?.allowStartExit)
  const existingHidingSpots = Array.isArray(options?.hidingSpots)
    ? options.hidingSpots
    : options?.hidingSpots !== null &&
        Array.isArray(maze.hidingSpots) &&
        !Array.isArray(maze.hazards)
      ? maze.hidingSpots
      : []

  for (let i = 0; i < existingHidingSpots.length; i += 1) {
    const spot = existingHidingSpots[i]
    if (spot && Number.isInteger(spot.row) && Number.isInteger(spot.col)) {
      excludedCells.add(`${spot.row},${spot.col}`)
    }
  }

  // Explicit placement requests path: validate & build each instance individually
  const explicitPlacements = Array.isArray(options?.placements)
    ? options.placements
    : Array.isArray(options?.specs)
      ? options.specs
      : null

  if (explicitPlacements) {
    const placed = []
    const occupiedCells = new Set()
    const usedIds = new Set()
    const failures = []
    const requestedTypes = []
    let coexistenceRejections = 0

    for (let i = 0; i < explicitPlacements.length; i += 1) {
      const req = explicitPlacements[i]
      if (!req) {
        failures.push({ slotIndex: i, type: null, stage: 'input', reason: 'null_placement_request' })
        continue
      }
      if (req.type) requestedTypes.push(req.type)
      const check = validateHazardPlacement(maze, req, {
        occupiedCells,
        excludedCells,
        allowStartExit,
        hidingSpots: existingHidingSpots,
      })
      if (!check.valid) {
        if (check.conflictWith || check.reason === 'overlaps_hiding_spot') {
          coexistenceRejections += 1
        }
        failures.push({ slotIndex: i, type: req.type || null, stage: 'pre_validation', reason: check.reason })
        continue
      }

      const spec = buildHazardSpec(
        maze,
        req.type,
        { row: req.row, col: req.col, id: req.id },
        rng,
        usedIds,
        req
      )
      if (!spec) {
        failures.push({ slotIndex: i, type: req.type || null, stage: 'build_spec', reason: 'mount_resolution_failed' })
        continue
      }

      const builtCheck = validateHazardPlacement(maze, spec, {
        occupiedCells,
        excludedCells,
        allowStartExit,
        hidingSpots: existingHidingSpots,
      })
      if (!builtCheck.valid) {
        if (builtCheck.conflictWith || builtCheck.reason === 'overlaps_hiding_spot') {
          coexistenceRejections += 1
        }
        failures.push({ slotIndex: i, type: req.type || null, stage: 'post_validation', reason: builtCheck.reason })
        continue
      }

      occupiedCells.add(`${spec.row},${spec.col}`)
      placed.push(spec)
    }

    const report = buildPlacementReport({
      requestedTypes,
      placed,
      selection: null,
      failures,
      coexistenceRejections,
    })
    if (typeof options?.onReport === 'function') {
      options.onReport(report, null)
    }
    return { hazards: placed, selection: null, report }
  }

  const explicitTypes = Array.isArray(options?.hazardTypes)
    ? options.hazardTypes
    : Array.isArray(options?.types)
      ? options.types
      : null

  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 3) {
    const emptyReport = buildPlacementReport({
      requestedTypes: explicitTypes || [],
      placed: [],
      selection: null,
      failures: [{ stage: 'reachability', reason: 'insufficient_reachable_cells' }],
    })
    return { hazards: [], selection: null, report: emptyReport }
  }

  let selection = null
  let requestedTypes
  let minInstancesFloor = 0

  if (explicitTypes) {
    if (explicitTypes.length === 0) {
      const emptyReport = buildPlacementReport({ requestedTypes: [], placed: [], selection: null, failures: [] })
      return { hazards: [], selection: null, report: emptyReport }
    }
    const targetCount = Number.isInteger(options?.count)
      ? Math.max(0, options.count)
      : explicitTypes.length
    if (targetCount === 0) {
      const emptyReport = buildPlacementReport({ requestedTypes: [], placed: [], selection: null, failures: [] })
      return { hazards: [], selection: null, report: emptyReport }
    }
    requestedTypes = []
    for (let i = 0; i < targetCount; i += 1) {
      requestedTypes.push(explicitTypes[i % explicitTypes.length])
    }
  } else {
    const resolvedLevel = normalizeLevel(options?.level ?? maze.level ?? maze.currentLevel ?? 1)
    const hasSeedOverride = options?.seed !== undefined && options.seed !== null && options.seed !== ''
    const hasLevelOverride = options?.level !== undefined && options.level !== null
    const hasConfigOverride = options?.hazardConfig !== undefined
    const canReuseMazeSelection =
      maze.hazardSelection &&
      !hasSeedOverride &&
      !hasLevelOverride &&
      !hasConfigOverride &&
      options?.reservedCoexistenceCells === undefined &&
      maze.hazardSelection.level === resolvedLevel &&
      maze.hazardSelection.seed === maze.seed

    selection = canReuseMazeSelection
      ? maze.hazardSelection
      : selectHazardsForLevel({
          level: resolvedLevel,
          seed: seedValue,
          baseSeed: options?.baseSeed ?? maze.baseSeed,
          rows: maze.rows ?? maze.grid.length,
          cols: maze.cols ?? maze.grid[0]?.length,
          walkableCount: reachInfo.distances.size,
          hazardConfig: options?.hazardConfig,
          reservedCoexistenceCells: options?.reservedCoexistenceCells,
        })

    requestedTypes = selection.requestedHazardTypes
    minInstancesFloor = selection.minInstancesPerType
  }

  if (!Array.isArray(requestedTypes) || requestedTypes.length === 0) {
    const emptyReport = buildPlacementReport({
      requestedTypes: [],
      placed: [],
      selection,
      failures: [],
    })
    return { hazards: [], selection, report: emptyReport }
  }

  const startKey = `${maze.start.row},${maze.start.col}`
  const exitKey = `${maze.exit.row},${maze.exit.col}`

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (key === startKey || key === exitKey) return
    if (excludedCells.has(key)) return
    const { row, col } = parseKey(key)
    const manhattan = Math.abs(row - maze.start.row) + Math.abs(col - maze.start.col)
    // Avoid immediate start vicinity (both BFS path distance and Manhattan clearance >= 3)
    if (dist < 3 || manhattan < 3) return
    candidates.push({ key, row, col, dist })
  })

  if (candidates.length === 0) {
    const emptyReport = buildPlacementReport({
      requestedTypes,
      placed: [],
      selection,
      failures: requestedTypes.map((type, idx) => ({
        slotIndex: idx,
        type,
        stage: 'candidate_discovery',
        reason: 'no_valid_candidate_cells',
      })),
    })
    return { hazards: [], selection, report: emptyReport }
  }

  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
  const shuffled = shuffleWithRng(candidates, rng)

  const targetCount = requestedTypes.length
  const actualCount = Math.min(targetCount, shuffled.length)
  const failures = []
  for (let i = actualCount; i < targetCount; i += 1) {
    failures.push({
      slotIndex: i,
      type: requestedTypes[i],
      stage: 'candidate_allocation',
      reason: 'insufficient_candidate_cells',
    })
  }

  const typeInstanceCounts = {}
  const slots = []
  const chosenKeys = new Set()

  for (let i = 0; i < actualCount; i += 1) {
    const type = requestedTypes[i]
    const wave = typeInstanceCounts[type] || 0
    typeInstanceCounts[type] = wave + 1
    const cell = shuffled[i]
    slots.push({
      slotIndex: i,
      type,
      wave,
      cell,
    })
    chosenKeys.add(cell.key)
  }

  // Validate and resolve each hazard instance individually (fixing single-index lookup bug)
  for (let idx = 0; idx < slots.length; idx += 1) {
    const slot = slots[idx]
    const currentCell = slot.cell
    if (!currentCell) continue

    const currentEval = evaluateCandidatePreference(maze, slot.type, currentCell, slots, idx)
    if (currentEval.requiredOk && currentEval.preferredOk) {
      continue
    }

    let bestPreferred = null
    let bestFallback = null
    for (let i = 0; i < shuffled.length; i += 1) {
      const cand = shuffled[i]
      if (chosenKeys.has(cand.key)) continue
      const candEval = evaluateCandidatePreference(maze, slot.type, cand, slots, idx)
      if (!candEval.requiredOk) continue
      if (candEval.preferredOk) {
        bestPreferred = cand
        break
      }
      if (!currentEval.requiredOk && !bestFallback) {
        bestFallback = cand
      }
    }

    const replacement = bestPreferred || bestFallback
    if (replacement) {
      chosenKeys.delete(currentCell.key)
      slot.cell = replacement
      chosenKeys.add(replacement.key)
      continue
    }

    // If current cell still fails a hard requirement, try trading with another
    // placed slot whose constraints allow holding `currentCell` while yielding
    // a valid cell for `slot.type`.
    const postEval = evaluateCandidatePreference(maze, slot.type, slot.cell, slots, idx)
    if (!postEval.requiredOk) {
      let swapped = false
      // Pass 1: swap keeping other slot's preferred constraints intact
      for (let j = 0; j < slots.length; j += 1) {
        if (j === idx || !slots[j].cell) continue
        const other = slots[j]
        const otherEvalForMine = evaluateCandidatePreference(
          maze,
          slot.type,
          other.cell,
          slots,
          idx
        )
        if (!otherEvalForMine.requiredOk) continue
        const currentEvalForOther = evaluateCandidatePreference(
          maze,
          other.type,
          slot.cell,
          slots,
          j
        )
        if (!currentEvalForOther.requiredOk || !currentEvalForOther.preferredOk) continue
        const temp = slot.cell
        slot.cell = other.cell
        other.cell = temp
        swapped = true
        break
      }
      // Pass 2: relax soft preferredOk on `other` so hard constraints succeed
      if (!swapped) {
        for (let j = 0; j < slots.length; j += 1) {
          if (j === idx || !slots[j].cell) continue
          const other = slots[j]
          const otherEvalForMine = evaluateCandidatePreference(
            maze,
            slot.type,
            other.cell,
            slots,
            idx
          )
          if (!otherEvalForMine.requiredOk) continue
          const currentEvalForOther = evaluateCandidatePreference(
            maze,
            other.type,
            slot.cell,
            slots,
            j
          )
          if (!currentEvalForOther.requiredOk) continue
          const temp = slot.cell
          slot.cell = other.cell
          other.cell = temp
          swapped = true
          break
        }
      }
      // Pass 3: protect required base instances (< minInstancesFloor) by reclaiming
      // a cell from an optional bonus instance (>= minInstancesFloor) if needed.
      if (!swapped && minInstancesFloor > 0 && slot.wave < minInstancesFloor) {
        for (let j = slots.length - 1; j >= 0; j -= 1) {
          if (j === idx || !slots[j].cell) continue
          const other = slots[j]
          if (other.wave < minInstancesFloor) continue
          const otherEvalForMine = evaluateCandidatePreference(
            maze,
            slot.type,
            other.cell,
            slots,
            idx
          )
          if (!otherEvalForMine.requiredOk) continue
          chosenKeys.delete(slot.cell.key)
          slot.cell = other.cell
          other.cell = null
          failures.push({
            slotIndex: other.slotIndex,
            type: other.type,
            stage: 'reclaimed_for_required_type',
            reason: 'yielded_cell_to_guaranteed_instance',
          })
          swapped = true
          break
        }
      }
      if (!swapped) {
        // Reject this invalid instance individually without rejecting other valid instances
        chosenKeys.delete(slot.cell.key)
        slot.cell = null
        failures.push({
          slotIndex: slot.slotIndex,
          type: slot.type,
          stage: 'constraint_validation',
          reason: 'no_valid_mounting_location',
        })
      }
    }
  }

  const placed = []
  const occupiedCells = new Set()
  const usedIds = new Set()
  let coexistenceRejections = 0

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]
    if (!slot.cell) continue

    const tryBuildOnCell = (targetCell) => {
      const preCheck = validateHazardPlacement(
        maze,
        { type: slot.type, row: targetCell.row, col: targetCell.col },
        { occupiedCells, excludedCells, allowStartExit, skipCoexistenceCheck: true }
      )
      if (!preCheck.valid) {
        return { ok: false, stage: 'pre_validation', reason: preCheck.reason, conflict: false }
      }
      const spec = buildHazardSpec(maze, slot.type, targetCell, rng, usedIds)
      if (!spec) {
        return { ok: false, stage: 'build_spec', reason: 'mount_resolution_failed', conflict: false }
      }
      const postCheck = validateHazardPlacement(maze, spec, {
        occupiedCells,
        excludedCells,
        allowStartExit,
        hidingSpots: existingHidingSpots,
      })
      if (!postCheck.valid) {
        usedIds.delete(spec.id)
        const isConflict = Boolean(postCheck.conflictWith || postCheck.reason === 'overlaps_hiding_spot')
        return { ok: false, stage: 'post_validation', reason: postCheck.reason, conflict: isConflict }
      }
      return { ok: true, spec }
    }

    let attempt = tryBuildOnCell(slot.cell)
    if (!attempt.ok && attempt.conflict && existingHidingSpots.length > 0) {
      coexistenceRejections += 1
      // Try remaining unassigned candidate cells deterministically so a single
      // adjacent hiding-spot conflict does not needlessly cause a hazard shortfall.
      for (let cIdx = 0; cIdx < shuffled.length; cIdx += 1) {
        const altCell = shuffled[cIdx]
        if (chosenKeys.has(altCell.key) || occupiedCells.has(altCell.key)) continue
        const altEval = evaluateCandidatePreference(maze, slot.type, altCell, slots, i)
        if (!altEval.requiredOk) continue
        const altAttempt = tryBuildOnCell(altCell)
        if (altAttempt.ok) {
          chosenKeys.delete(slot.cell.key)
          slot.cell = altCell
          chosenKeys.add(altCell.key)
          attempt = altAttempt
          break
        }
        if (altAttempt.conflict) {
          coexistenceRejections += 1
        }
      }
    }

    if (!attempt.ok) {
      failures.push({
        slotIndex: slot.slotIndex,
        type: slot.type,
        stage: attempt.stage,
        reason: attempt.reason,
      })
      continue
    }

    occupiedCells.add(`${attempt.spec.row},${attempt.spec.col}`)
    placed.push(attempt.spec)
  }

  const report = buildPlacementReport({
    requestedTypes,
    placed,
    selection,
    failures,
    coexistenceRejections,
  })
  if (typeof options?.onReport === 'function') {
    options.onReport(report, selection)
  }

  return { hazards: placed, selection, report }
}

/**
 * Places deterministic, non-overlapping environmental hazards on reachable
 * walkable maze tiles while avoiding the start and exit positions.
 * Validates each hazard instance individually so multiple instances of the
 * same hazard type are each validated, assigned unique IDs, and independently
 * positioned without single-index collision.
 */
export function placeHazards(maze, options = {}) {
  return placeHazardsWithReport(maze, options).hazards
}

