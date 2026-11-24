import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

export const HAZARD_TYPES = {
  CEILING_COLLAPSE: 'ceiling_collapse',
  ROTTEN_FURNITURE_COLLAPSE: 'rotten_furniture_collapse',
  FALLING_PIPES_FIXTURES: 'falling_pipes_fixtures',
  STEAM_PIPE_BURST: 'steam_pipe_burst',
  EXPOSED_ELECTRICAL_WIRING: 'exposed_electrical_wiring',
  COLLAPSING_FLOOR_GRATE: 'collapsing_floor_grate',
  WALL_COLLAPSE: 'wall_collapse',
  FALLING_WATER_TANK: 'falling_water_tank',
  FALLING_SUSPENDED_MACHINERY: 'falling_suspended_machinery',
  VENTILATION_DUCT_COLLAPSE: 'ventilation_duct_collapse',
}

const STANDARD_HAZARD_COUNT = 10

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
    hidingSpots = undefined,
    collectibles = undefined,
    keycards = undefined,
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

  const resolvedHidingSpots = Array.isArray(hidingSpots)
    ? hidingSpots
    : Array.isArray(maze.hidingSpots)
      ? maze.hidingSpots
      : []

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
  for (let i = 0; i < resolvedHidingSpots.length; i += 1) {
    const s = resolvedHidingSpots[i]
    if (s && Number.isInteger(s.row) && Number.isInteger(s.col)) {
      blockedKeys.add(`${s.row},${s.col}`)
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
  const targetCount = Math.max(2, Math.min(8, Math.round(walkableCount / 16)))
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
        hidingSpots: options?.hidingSpots,
        collectibles: options?.collectibles,
        keycards: options?.keycards,
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
  aftermathLocalZ: -1.48,
  aftermathHalfW: 1.05,
  aftermathHalfD: 0.48,
  decoyLayerName: 'maze-wall-collapse-decoys',
}

/**
 * Inspects adjacent maze walls for (row, col) and resolves a structurally valid
 * wall section for `wall_collapse`, preferring interior walls over outer
 * boundary walls while never modifying maze.grid or breaking boundary sealing.
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
        adjacentWalls.push({
          ...dir,
          wallRow: wr,
          wallCol: wc,
          isBoundaryWall,
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
    const interiorWalls = adjacentWalls.filter((w) => !w.isBoundaryWall)
    const pool = interiorWalls.length > 0 ? interiorWalls : adjacentWalls
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
 * `wall_collapse` traps. Never overlaps hazards, hiding spots, start/exit,
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
    hidingSpots = null,
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
  if (Array.isArray(hidingSpots)) {
    for (let i = 0; i < hidingSpots.length; i += 1) {
      const hs = hidingSpots[i]
      if (hs && Number.isInteger(hs.row) && Number.isInteger(hs.col)) {
        blockedCells.add(`${hs.row},${hs.col}`)
        markAllWallsInCell(hs.row, hs.col)
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
  const targetCount = Math.max(2, Math.min(8, Math.round(walkableCount / 18)))
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
    hidingSpots = null,
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

  const resolvedSpots = Array.isArray(hidingSpots)
    ? hidingSpots
    : Array.isArray(maze.hidingSpots)
      ? maze.hidingSpots
      : []
  for (let i = 0; i < resolvedSpots.length; i += 1) {
    const s = resolvedSpots[i]
    if (s && Number.isInteger(s.row) && Number.isInteger(s.col)) {
      blockedCells.add(`${s.row},${s.col}`)
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
  const targetCount = Math.max(2, Math.min(6, Math.round(walkableCount / 22)))
  const decoys = []

  for (let i = 0; i < ordered.length && decoys.length < targetCount; i += 1) {
    const cand = ordered[i]
    const tooClose = decoys.some(
      (dc) => Math.abs(dc.row - cand.row) + Math.abs(dc.col - cand.col) <= 2
    )
    if (tooClose) continue

    decoys.push({
      id: `water-tank-decoy-${cand.row}-${cand.col}`,
      isDecoy: true,
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
    hidingSpots = null,
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

  const resolvedSpots = Array.isArray(hidingSpots)
    ? hidingSpots
    : Array.isArray(maze.hidingSpots)
      ? maze.hidingSpots
      : []
  for (let i = 0; i < resolvedSpots.length; i += 1) {
    const s = resolvedSpots[i]
    if (s && Number.isInteger(s.row) && Number.isInteger(s.col)) {
      blockedCells.add(`${s.row},${s.col}`)
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
  const targetCount = Math.max(2, Math.min(6, Math.round(walkableCount / 22)))
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

const DUCT_IMPACT_LOCAL_Z = 0.56
const DUCT_IMPACT_LOCAL_Y = 0.65

/**
 * Resolves a believable overhead ventilation duct run and controlled drop
 * orientation for `ventilation_duct_collapse`.
 *
 * Always anchors the duct structurally beneath the ceiling slab (`ceilingAnchorY = 3.58`,
 * `ductRestY = 3.18`) via trapeze steel hangers and inline plenum collars (plus a
 * rear wall bulkhead intake collar when backed by a maze wall), aligning `dropDir`
 * down an open walkable corridor so the detaching duct never clips into solid walls.
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
    // Prefer straight corridor runs (open front and back) or bulkhead-backed corridors
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

  return {
    mountType: chosen.hasRearWall ? 'wall_bulkhead_duct' : 'ceiling_duct_run',
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
    ductRestY: 3.18,
    ceilingAnchorY: 3.58,
  }
}

const CEILING_SOFFIT_Y = 3.6
const CEILING_RUBBLE_HALF_W = 0.44
const CEILING_RUBBLE_HALF_D = 0.44

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

const FALLING_PIPES_OVERHEAD_LOCAL_Z = -1.32
const FALLING_PIPES_OVERHEAD_LOCAL_Y = 3.12
const FALLING_PIPES_IMPACT_LOCAL_Z = -1.06
const FALLING_PIPES_IMPACT_LOCAL_Y = 0.18
const FALLING_PIPES_CEILING_SOFFIT_Y = 3.6
const FALLING_PIPES_AFTERMATH_HALF_W = 0.88
const FALLING_PIPES_AFTERMATH_HALF_D = 0.26

/**
 * Resolves a structurally anchored overhead pipe & valve assembly mount for
 * `falling_pipes_fixtures`.
 *
 * When an adjacent corridor wall exists, mounts the pipe run parallel to that
 * wall (`localZ = -1.32m`, `y = 3.12m`) anchored both into the overhead ceiling
 * soffit (`y = 3.60m`) via vertical riser elbows and clevis U-bolt hangers AND
 * into the adjacent wall face (`z = -1.96m`) via horizontal standoff brackets.
 * In open junctions without an adjacent wall, anchors the pipe run to the
 * overhead ceiling slab along the dominant corridor axis.
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
        : (r * 11 + c * 17) % pool.length
    chosen = pool[idx]
  }

  let mountType
  let pipeYaw
  let wallSide = null
  let wallRow = null
  let wallCol = null

  if (chosen) {
    mountType = 'wall'
    wallSide = chosen.side
    wallRow = chosen.wallRow
    wallCol = chosen.wallCol
    pipeYaw = normalizeZero(chosen.yaw)
  } else if (rows > 0 && cols > 0) {
    mountType = 'ceiling'
    let openNS = 0
    let openEW = 0
    if (grid[r - 1]?.[c] === CELL_TYPES.PATH) openNS += 1
    if (grid[r + 1]?.[c] === CELL_TYPES.PATH) openNS += 1
    if (grid[r]?.[c - 1] === CELL_TYPES.PATH) openEW += 1
    if (grid[r]?.[c + 1] === CELL_TYPES.PATH) openEW += 1
    if (openNS > openEW) {
      pipeYaw = Math.PI * 0.5
    } else if (openEW > openNS) {
      pipeYaw = 0
    } else {
      pipeYaw = ((r + c) & 1) === 0 ? 0 : Math.PI * 0.5
    }
  } else {
    const fallbackDir = WALL_MOUNT_DIRECTIONS[(r + c) % WALL_MOUNT_DIRECTIONS.length]
    mountType = 'wall'
    wallSide = fallbackDir.side
    wallRow = r + fallbackDir.dr
    wallCol = c + fallbackDir.dc
    pipeYaw = normalizeZero(fallbackDir.yaw)
  }

  const cosYaw = Math.cos(pipeYaw)
  const sinYaw = Math.sin(pipeYaw)
  const toCellWorld = (lx, lz) => ({
    x: normalizeZero(lx * cosYaw + lz * sinYaw),
    z: normalizeZero(-lx * sinYaw + lz * cosYaw),
  })

  const overheadWorld = toCellWorld(0, FALLING_PIPES_OVERHEAD_LOCAL_Z)
  const impactWorld = toCellWorld(0, FALLING_PIPES_IMPACT_LOCAL_Z)
  const rollDirX = normalizeZero(sinYaw)
  const rollDirZ = normalizeZero(cosYaw)

  return {
    mountType,
    wallSide,
    wallRow,
    wallCol,
    pipeYaw,
    corridorAxis: Math.abs(Math.sin(pipeYaw)) > 0.5 ? 'ns' : 'ew',
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
  }
}

const STEAM_PIPE_CEILING_SOFFIT_Y = 3.6
const STEAM_PIPE_MAIN_Y = 1.38
const STEAM_PIPE_RUPTURE_LOCAL_X = 0.14
const STEAM_PIPE_RUPTURE_LOCAL_Y = 1.38
const STEAM_PIPE_RUPTURE_LOCAL_Z = -1.72
const STEAM_PIPE_VALVE_LOCAL_X = -0.58
const STEAM_PIPE_VALVE_LOCAL_Y = 1.28
const STEAM_PIPE_VALVE_LOCAL_Z = -1.72
const STEAM_PIPE_PLUME_LOCAL_X = 0.08
const STEAM_PIPE_PLUME_LOCAL_Y = 1.25
const STEAM_PIPE_PLUME_LOCAL_Z = -0.68

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

  const ruptureWorld = toCellWorld(STEAM_PIPE_RUPTURE_LOCAL_X, STEAM_PIPE_RUPTURE_LOCAL_Z)
  const valveWorld = toCellWorld(STEAM_PIPE_VALVE_LOCAL_X, STEAM_PIPE_VALVE_LOCAL_Z)
  const plumeWorld = toCellWorld(STEAM_PIPE_PLUME_LOCAL_X, STEAM_PIPE_PLUME_LOCAL_Z)
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
  }
}

/**
 * Places deterministic, non-overlapping environmental hazards on reachable
 * walkable maze tiles while avoiding the start and exit positions.
 */
export function placeHazards(maze) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return []
  }

  const targetCount = STANDARD_HAZARD_COUNT
  const rng = createRng(`${maze.seed}-hazards`)

  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 3) {
    return []
  }

  const startKey = `${maze.start.row},${maze.start.col}`
  const exitKey = `${maze.exit.row},${maze.exit.col}`

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (key === startKey || key === exitKey) return
    const { row, col } = parseKey(key)
    // Avoid immediate start vicinity (dist < 3)
    if (dist < 3) return
    candidates.push({ key, row, col, dist })
  })

  if (candidates.length === 0) {
    return []
  }

  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
  const shuffled = shuffleWithRng(candidates, rng)
  const types = [
    HAZARD_TYPES.CEILING_COLLAPSE,
    HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    HAZARD_TYPES.STEAM_PIPE_BURST,
    HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
    HAZARD_TYPES.WALL_COLLAPSE,
    HAZARD_TYPES.FALLING_WATER_TANK,
    HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY,
    HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE,
  ]

  const actualCount = Math.min(targetCount, shuffled.length)
  const chosen = shuffled.slice(0, actualCount)
  const chosenKeys = new Set(chosen.map((c) => c.key))

  // Ensure the cell assigned to ROTTEN_FURNITURE_COLLAPSE borders at least one solid wall
  const furnitureIdx = types.indexOf(HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE)
  if (furnitureIdx >= 0 && furnitureIdx < chosen.length) {
    const currentCell = chosen[furnitureIdx]
    const hasWall = WALL_MOUNT_DIRECTIONS.some(
      (d) => maze.grid[currentCell.row + d.dr]?.[currentCell.col + d.dc] === CELL_TYPES.WALL
    )
    if (!hasWall) {
      for (let i = actualCount; i < shuffled.length; i += 1) {
        const cand = shuffled[i]
        if (chosenKeys.has(cand.key)) continue
        const candHasWall = WALL_MOUNT_DIRECTIONS.some(
          (d) => maze.grid[cand.row + d.dr]?.[cand.col + d.dc] === CELL_TYPES.WALL
        )
        if (candHasWall) {
          chosenKeys.delete(currentCell.key)
          chosen[furnitureIdx] = cand
          chosenKeys.add(cand.key)
          break
        }
      }
    }
  }

  // Ensure the cell assigned to STEAM_PIPE_BURST borders at least one solid wall when available
  const steamIdx = types.indexOf(HAZARD_TYPES.STEAM_PIPE_BURST)
  if (steamIdx >= 0 && steamIdx < chosen.length) {
    const currentCell = chosen[steamIdx]
    const hasWall = WALL_MOUNT_DIRECTIONS.some(
      (d) => maze.grid[currentCell.row + d.dr]?.[currentCell.col + d.dc] === CELL_TYPES.WALL
    )
    if (!hasWall) {
      for (let i = actualCount; i < shuffled.length; i += 1) {
        const cand = shuffled[i]
        if (chosenKeys.has(cand.key)) continue
        const candHasWall = WALL_MOUNT_DIRECTIONS.some(
          (d) => maze.grid[cand.row + d.dr]?.[cand.col + d.dc] === CELL_TYPES.WALL
        )
        if (candHasWall) {
          chosenKeys.delete(currentCell.key)
          chosen[steamIdx] = cand
          chosenKeys.add(cand.key)
          break
        }
      }
    }
  }

  // Ensure the cell assigned to WALL_COLLAPSE borders an actual wall (preferring an interior wall)
  const wallCollapseIdx = types.indexOf(HAZARD_TYPES.WALL_COLLAPSE)
  if (wallCollapseIdx >= 0 && wallCollapseIdx < chosen.length) {
    const currentCell = chosen[wallCollapseIdx]
    const currentMount = resolveWallCollapseMount(maze.grid, currentCell.row, currentCell.col)
    if (!currentMount || currentMount.isBoundaryWall) {
      let replacement = null
      for (let i = actualCount; i < shuffled.length; i += 1) {
        const cand = shuffled[i]
        if (chosenKeys.has(cand.key)) continue
        const m = resolveWallCollapseMount(maze.grid, cand.row, cand.col)
        if (m && !m.isBoundaryWall) {
          replacement = cand
          break
        }
        if (!currentMount && m && !replacement) {
          replacement = cand
        }
      }
      if (replacement) {
        chosenKeys.delete(currentCell.key)
        chosen[wallCollapseIdx] = replacement
        chosenKeys.add(replacement.key)
      }
    }
  }

  return chosen.map((cell, idx) => {
    const type = types[idx % types.length]
    const spec = {
      id: `hazard-${cell.row}-${cell.col}`,
      type,
      row: cell.row,
      col: cell.col,
      active: true,
    }
    if (type === HAZARD_TYPES.CEILING_COLLAPSE) {
      const mount = resolveCeilingCollapseMount(maze.grid, cell.row, cell.col, rng)
      spec.wallSide = mount.wallSide
      spec.collapseYaw = mount.collapseYaw
      spec.localPatchOffset = mount.localPatchOffset
      spec.ceilingSoffitY = mount.ceilingSoffitY
      spec.rubbleHalfW = mount.rubbleHalfW
      spec.rubbleHalfD = mount.rubbleHalfD
      spec.clearBias = mount.clearBias
    } else if (type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) {
      const mount = resolveRottenFurnitureMount(maze.grid, cell.row, cell.col, rng)
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
      const mount = resolveFallingPipesMount(maze.grid, cell.row, cell.col, rng)
      spec.mountType = mount.mountType
      spec.wallSide = mount.wallSide
      spec.wallRow = mount.wallRow
      spec.wallCol = mount.wallCol
      spec.pipeYaw = mount.pipeYaw
      spec.corridorAxis = mount.corridorAxis
      spec.rollDir = mount.rollDir
      spec.localOverheadOffset = mount.localOverheadOffset
      spec.localImpactOffset = mount.localImpactOffset
      spec.pipeRestY = mount.pipeRestY
      spec.ceilingAnchorY = mount.ceilingAnchorY
      spec.aftermathHalfW = mount.aftermathHalfW
      spec.aftermathHalfD = mount.aftermathHalfD
    } else if (type === HAZARD_TYPES.STEAM_PIPE_BURST) {
      const mount = resolveSteamPipeMount(maze.grid, cell.row, cell.col, rng)
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
    } else if (type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      const mount = resolveElectricalMount(maze.grid, cell.row, cell.col, rng)
      spec.mountType = mount.mountType
      spec.wallSide = mount.wallSide
      spec.wallRow = mount.wallRow
      spec.wallCol = mount.wallCol
      spec.wallYaw = mount.wallYaw
      spec.localDischargeOffset = mount.localDischargeOffset
      spec.localJunctionOffset = mount.localJunctionOffset
      spec.localBreakerOffset = mount.localBreakerOffset
    } else if (type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      const mount = resolveFloorGrateMount(maze.grid, cell.row, cell.col)
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
      const mount = resolveWallCollapseMount(maze.grid, cell.row, cell.col, rng)
      if (mount) {
        spec.wallSide = mount.wallSide
        spec.wallRow = mount.wallRow
        spec.wallCol = mount.wallCol
        spec.isBoundaryWall = mount.isBoundaryWall
        spec.wallYaw = mount.wallYaw
        spec.collapseDir = mount.collapseDir
        spec.localImpactOffset = mount.localImpactOffset
      }
    } else if (type === HAZARD_TYPES.FALLING_WATER_TANK) {
      const mount = resolveWaterTankMount(maze.grid, cell.row, cell.col, rng)
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
      const mount = resolveSuspendedMachineryMount(maze.grid, cell.row, cell.col, rng)
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
      const mount = resolveVentilationDuctMount(maze.grid, cell.row, cell.col, rng)
      spec.mountType = mount.mountType
      spec.wallSide = mount.wallSide
      spec.wallRow = mount.wallRow
      spec.wallCol = mount.wallCol
      spec.dropSide = mount.dropSide
      spec.ductYaw = mount.ductYaw
      spec.dropDir = mount.dropDir
      spec.localImpactOffset = mount.localImpactOffset
      spec.ductRestY = mount.ductRestY
      spec.ceilingAnchorY = mount.ceilingAnchorY
    }
    return spec
  })
}
