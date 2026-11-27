import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'
import {
  ALL_HIDING_SPOT_TYPES,
  HIDING_SPOT_CONFIG,
  HIDING_SPOT_TYPES,
  isValidHidingSpotType,
  localToWorldSpotOffset,
} from '../mechanics/hidingConfig.js'
import {
  normalizeLevel,
  selectHidingSpotTypesForLevel,
  allocateHidingSpotQuantitiesForLevel,
} from '../mechanics/levelProgression.js'
import { findHazardConflictForHidingSpot } from './placementCoexistence.js'
import { sortCandidatesByPreference } from './placementPreferences.js'

const CELL_HALF = CELL_SIZE * 0.5
const PILASTER_PLINTH_OUTER_REACH = 0.08
const PILASTER_SEGMENT_INSET = 0.46
const PILASTER_SAFETY_PAD = 0.04
const SIDE_WALL_SAFETY_PAD = 0.06
const OPEN_CORNER_SAFETY_PAD = 0.12
const MIN_CORRIDOR_PASSAGE_WIDTH = PLAYER_RADIUS * 2 + 0.42 // >= 1.92m open passage

const WALL_DIRS = [
  { name: 'north', dRow: -1, dCol: 0, nx: 0, nz: -1, tx: 1, tz: 0, yaw: 0 },
  { name: 'south', dRow: 1, dCol: 0, nx: 0, nz: 1, tx: 1, tz: 0, yaw: Math.PI },
  { name: 'west', dRow: 0, dCol: -1, nx: -1, nz: 0, tx: 0, tz: 1, yaw: Math.PI / 2 },
  { name: 'east', dRow: 0, dCol: 1, nx: 1, nz: 0, tx: 0, tz: 1, yaw: -Math.PI / 2 },
]

function normalizeZero(value) {
  return Math.abs(value) < 1e-9 ? 0 : value
}

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

function isWallAt(grid, r, c) {
  const rows = grid.length
  const cols = grid[0]?.length || 0
  return r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] === CELL_TYPES.WALL
}

function isEvenWallNode(grid, r, c) {
  const rows = grid.length
  const cols = grid[0]?.length || 0
  return (
    r >= 0 &&
    r < rows &&
    c >= 0 &&
    c < cols &&
    r % 2 === 0 &&
    c % 2 === 0 &&
    grid[r][c] === CELL_TYPES.WALL
  )
}

function addExcludedList(excludedKeys, list) {
  if (!list) return
  const entries =
    list instanceof Set ? Array.from(list) : Array.isArray(list) ? list : []
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (typeof entry === 'string') {
      excludedKeys.add(entry)
    } else if (entry && Number.isInteger(entry.row) && Number.isInteger(entry.col)) {
      excludedKeys.add(`${entry.row},${entry.col}`)
    } else if (
      entry?.cell &&
      Number.isInteger(entry.cell.row) &&
      Number.isInteger(entry.cell.col)
    ) {
      excludedKeys.add(`${entry.cell.row},${entry.cell.col}`)
    } else if (
      entry?.spawnCell &&
      Number.isInteger(entry.spawnCell.row) &&
      Number.isInteger(entry.spawnCell.col)
    ) {
      excludedKeys.add(`${entry.spawnCell.row},${entry.spawnCell.col}`)
    }
  }
}

function computeCellTopology(grid, row, col) {
  const openN = !isWallAt(grid, row - 1, col)
  const openS = !isWallAt(grid, row + 1, col)
  const openW = !isWallAt(grid, row, col - 1)
  const openE = !isWallAt(grid, row, col + 1)
  const openCount = (openN ? 1 : 0) + (openS ? 1 : 0) + (openW ? 1 : 0) + (openE ? 1 : 0)

  if (openCount <= 1) return 'dead_end'
  if (openCount === 2) {
    if ((openN && openS) || (openW && openE)) return 'straight'
    return 'corner'
  }
  if (openCount === 3) return 't_junction'
  return 'intersection'
}

function getAdjacentWallInfos(grid, row, col) {
  const infos = []
  const rows = grid.length
  const cols = grid[0]?.length || 0

  for (let i = 0; i < WALL_DIRS.length; i += 1) {
    const dir = WALL_DIRS[i]
    const wr = row + dir.dRow
    const wc = col + dir.dCol
    if (!isWallAt(grid, wr, wc)) continue

    const isBoundaryWall = wr <= 0 || wr >= rows - 1 || wc <= 0 || wc >= cols - 1
    const oppositeOpen = !isWallAt(grid, row - dir.dRow, col - dir.dCol)
    const wallIsEvenNode = isEvenWallNode(grid, wr, wc)

    let minT = -CELL_HALF
    let maxT = CELL_HALF
    for (const sign of [-1, 1]) {
      const sideR = row + sign * dir.tz
      const sideC = col + sign * dir.tx
      const diagR = wr + sign * dir.tz
      const diagC = wc + sign * dir.tx

      let inset = OPEN_CORNER_SAFETY_PAD
      if (wallIsEvenNode) {
        inset = Math.max(inset, PILASTER_SEGMENT_INSET + PILASTER_SAFETY_PAD)
      } else if (isWallAt(grid, sideR, sideC)) {
        inset = Math.max(inset, SIDE_WALL_SAFETY_PAD)
        if (isEvenWallNode(grid, diagR, diagC)) {
          inset = Math.max(inset, PILASTER_PLINTH_OUTER_REACH + PILASTER_SAFETY_PAD)
        }
      } else if (isEvenWallNode(grid, diagR, diagC)) {
        inset = Math.max(inset, PILASTER_PLINTH_OUTER_REACH + PILASTER_SAFETY_PAD)
      }

      if (sign < 0) minT = Math.max(minT, -CELL_HALF + inset)
      else maxT = Math.min(maxT, CELL_HALF - inset)
    }

    infos.push({
      ...dir,
      wallRow: wr,
      wallCol: wc,
      isBoundaryWall,
      oppositeOpen,
      minT,
      maxT,
      spanT: maxT - minT,
    })
  }
  return infos
}

/**
 * Checks if placing a hiding spot against `wallInfo` leaves enough clear
 * corridor width and clear entry anchor inside walkable space.
 */
function evaluateWallPlacement(spotType, grid, row, col, wallInfo, rng, maze) {
  const cfg = HIDING_SPOT_CONFIG[spotType]
  if (!cfg) return null
  const p = cfg.placement

  if (wallInfo.spanT < p.halfWidth * 2 + 0.08) {
    return null
  }

  // Distance from opposite wall / open corridor edge
  const backGap = p.wallGap
  const forwardReachFromWall = backGap + p.halfDepthBack + p.halfDepthFront
  const remainingPassageWidth = CELL_SIZE - forwardReachFromWall
  if (remainingPassageWidth < MIN_CORRIDOR_PASSAGE_WIDTH) {
    return null
  }

  // Center inside the safe wall span [minT, maxT] before adding bounded lateral jitter
  const midT = (wallInfo.minT + wallInfo.maxT) * 0.5
  const usableMargin = Math.max(0, (wallInfo.spanT - p.halfWidth * 2) * 0.5)
  const lateralJitter =
    usableMargin > 0.04 && typeof rng === 'function'
      ? (rng() * 2 - 1) * Math.min(0.28, usableMargin * 0.65)
      : 0
  const lateralOffset = midT + lateralJitter

  const centerWorld = gridToWorld(row, col, maze)
  if (!centerWorld) return null

  const distFromWallToCenter = backGap + p.halfDepthBack
  const centerDistFromCellMid = CELL_HALF - distFromWallToCenter
  const cx = normalizeZero(
    centerWorld.x + wallInfo.nx * centerDistFromCellMid + wallInfo.tx * lateralOffset
  )
  const cz = normalizeZero(
    centerWorld.z + wallInfo.nz * centerDistFromCellMid + wallInfo.tz * lateralOffset
  )

  const entryWorld = localToWorldSpotOffset(
    cx,
    cz,
    wallInfo.yaw,
    p.entryLocal.x,
    p.entryLocal.z
  )
  // Entry anchor must stay well inside walkable space of the cell (away from walls)
  const minX = centerWorld.x - (CELL_HALF - PLAYER_RADIUS * 0.72)
  const maxX = centerWorld.x + (CELL_HALF - PLAYER_RADIUS * 0.72)
  const minZ = centerWorld.z - (CELL_HALF - PLAYER_RADIUS * 0.72)
  const maxZ = centerWorld.z + (CELL_HALF - PLAYER_RADIUS * 0.72)
  if (
    entryWorld.x < minX ||
    entryWorld.x > maxX ||
    entryWorld.z < minZ ||
    entryWorld.z > maxZ
  ) {
    // Fallback toward cell center if opposite wall is close (e.g. dead-end wall)
    entryWorld.x = normalizeZero(
      centerWorld.x - wallInfo.nx * Math.min(0.45, centerDistFromCellMid * 0.35)
    )
    entryWorld.z = normalizeZero(
      centerWorld.z - wallInfo.nz * Math.min(0.45, centerDistFromCellMid * 0.35)
    )
  }

  const interiorOffset = localToWorldSpotOffset(
    cx,
    cz,
    wallInfo.yaw,
    p.interiorLocal.x,
    p.interiorLocal.z
  )

  return {
    type: spotType,
    row,
    col,
    wallSide: wallInfo.name,
    wallRow: wallInfo.wallRow,
    wallCol: wallInfo.wallCol,
    wallYaw: normalizeZero(wallInfo.yaw),
    x: cx,
    y: 0,
    z: cz,
    entryAnchor: {
      x: normalizeZero(entryWorld.x),
      y: 0,
      z: normalizeZero(entryWorld.z),
    },
    interiorAnchor: {
      x: normalizeZero(interiorOffset.x),
      y: normalizeZero(p.interiorLocal.y || 0),
      z: normalizeZero(interiorOffset.z),
    },
  }
}

/**
 * Resolves world-space XZ floor cutout aperture rectangles for `floor_hatch`
 * hiding spots so `buildMazeMeshes` opens an authentic sub-floor maintenance shaft.
 */
export function resolveFloorHatchCutouts(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return []
  }

  const spots = Array.isArray(options?.hidingSpots)
    ? options.hidingSpots
    : Array.isArray(maze.hidingSpots)
      ? maze.hidingSpots
      : []

  const cutouts = []
  const cfg = HIDING_SPOT_CONFIG[HIDING_SPOT_TYPES.FLOOR_HATCH]
  const defaultHalfW = cfg.placement.pitHalfW || 0.56
  const defaultHalfD = cfg.placement.pitHalfD || 0.56

  for (let i = 0; i < spots.length; i += 1) {
    const spot = spots[i]
    if (!spot || spot.type !== HIDING_SPOT_TYPES.FLOOR_HATCH) continue
    if (!Number.isFinite(spot.x) || !Number.isFinite(spot.z)) continue

    const rotatedEW = Math.abs(Math.sin(spot.wallYaw || 0)) > 0.5
    const hw = rotatedEW ? defaultHalfD : defaultHalfW
    const hd = rotatedEW ? defaultHalfW : defaultHalfD

    cutouts.push({
      id: spot.id || `floor-hatch-${spot.row}-${spot.col}`,
      kind: 'hiding_spot',
      row: spot.row,
      col: spot.col,
      cx: normalizeZero(spot.x),
      cz: normalizeZero(spot.z),
      halfW: hw,
      halfD: hd,
      minX: normalizeZero(spot.x - hw),
      maxX: normalizeZero(spot.x + hw),
      minZ: normalizeZero(spot.z - hd),
      maxZ: normalizeZero(spot.z + hd),
      yaw: spot.wallYaw || 0,
    })
  }

  return cutouts
}

function computeSpotWorldBounds(spot) {
  const cfg = HIDING_SPOT_CONFIG[spot?.type]
  const p = cfg?.placement
  if (!p || !Number.isFinite(spot?.x) || !Number.isFinite(spot?.z)) {
    return null
  }
  const halfDepth = Math.max(p.halfDepthBack || 0.4, p.halfDepthFront || 0.4)
  const halfWidth = p.halfWidth || 0.7
  const rotatedEW = Math.abs(Math.sin(spot.wallYaw || 0)) > 0.5
  const hx = rotatedEW ? halfDepth : halfWidth
  const hz = rotatedEW ? halfWidth : halfDepth
  return {
    minX: spot.x - hx,
    maxX: spot.x + hx,
    minZ: spot.z - hz,
    maxZ: spot.z + hz,
  }
}

function spotsOverlapInWorld(candidate, existingSpots, pad = 0.12) {
  const candBounds = computeSpotWorldBounds(candidate)
  if (!candBounds) return false
  for (let i = 0; i < existingSpots.length; i += 1) {
    const otherBounds = computeSpotWorldBounds(existingSpots[i])
    if (!otherBounds) continue
    const separated =
      candBounds.maxX + pad < otherBounds.minX ||
      candBounds.minX - pad > otherBounds.maxX ||
      candBounds.maxZ + pad < otherBounds.minZ ||
      candBounds.minZ - pad > otherBounds.maxZ
    if (!separated) {
      return true
    }
  }
  return false
}

/**
 * Deterministically places level-selected hiding-spot types and quantities
 * throughout walkable maze cells without overlapping start, exit, hazards,
 * enemies, keycards, or collectibles, and while keeping every corridor navigable.
 *
 * Uses wave-ordered placement so every selected type receives its minimum
 * instances before optional extra instances are placed, and NEVER substitutes
 * unselected types when capacity is constrained.
 */
export function placeHidingSpotsWithReport(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !maze?.start || !maze?.exit) {
    return {
      hidingSpots: [],
      selection: null,
      allocation: null,
      report: {
        level: normalizeLevel(maze?.level ?? options?.level ?? 1),
        seed: maze?.seed ?? options?.seed ?? 0,
        placementSeed: '',
        candidateCellCount: 0,
        requestedTotal: 0,
        placedTotal: 0,
        missingTotal: 0,
        shortfallTotal: 0,
        hadShortfall: true,
        requestedByType: {},
        allocatedByType: {},
        placedByType: {},
        missingByType: {},
        shortfallsByType: {},
        shortfallTypes: [],
        unselectedSpawnCount: 0,
        selectedTypes: [],
        unselectedTypes: [...ALL_HIDING_SPOT_TYPES],
        fullySatisfied: false,
        failures: [{ reason: 'invalid_maze_structure' }],
      },
    }
  }

  const level = normalizeLevel(maze.level ?? options.level ?? 1)
  const seed = maze.seed ?? options.seed ?? 0
  const baseSeed = maze.baseSeed ?? options.baseSeed
  const hidingConfig =
    options.hidingConfig ||
    maze.hidingProgressionConfig ||
    options.progressionConfig?.hidingSpots

  const selection =
    options.hidingSpotSelection ||
    options.selection ||
    selectHidingSpotTypesForLevel({ level, seed, baseSeed, hidingConfig })

  const allocation =
    options.hidingSpotAllocation ||
    options.allocation ||
    allocateHidingSpotQuantitiesForLevel({
      level,
      seed,
      baseSeed,
      rows: maze.rows,
      cols: maze.cols,
      selection,
      hidingConfig,
    })

  const rawSelected = Array.isArray(selection?.selectedTypes)
    ? selection.selectedTypes
    : ALL_HIDING_SPOT_TYPES.slice(0, 4)
  const selectedTypes = Array.from(
    new Set(rawSelected.filter((t) => isValidHidingSpotType(t)))
  )
  const selectedSet = new Set(selectedTypes)
  const unselectedTypes = Array.isArray(selection?.unselectedTypes)
    ? selection.unselectedTypes.filter((t) => !selectedSet.has(t))
    : ALL_HIDING_SPOT_TYPES.filter((t) => !selectedSet.has(t))

  const typeQuantities = allocation?.typeQuantities || {}
  const requestedByType = {}
  let requestedTotal = 0
  for (let i = 0; i < selectedTypes.length; i += 1) {
    const type = selectedTypes[i]
    const qty =
      Number.isInteger(typeQuantities[type]) && typeQuantities[type] >= 0
        ? typeQuantities[type]
        : 2
    requestedByType[type] = qty
    requestedTotal += qty
  }

  const reachInfo = exploreReachableCells(grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 3) {
    const placedByType = {}
    const missingByType = {}
    const failures = []
    for (let i = 0; i < selectedTypes.length; i += 1) {
      const type = selectedTypes[i]
      placedByType[type] = 0
      missingByType[type] = requestedByType[type] || 0
      if (missingByType[type] > 0) {
        failures.push({
          type,
          reason: 'insufficient_reachable_cells',
          missing: missingByType[type],
        })
      }
    }
    return {
      hidingSpots: [],
      selection,
      allocation,
      report: {
        level,
        seed,
        placementSeed: `hiding-placement:level:${level}:seed:${seed}`,
        candidateCellCount: 0,
        requestedTotal,
        placedTotal: 0,
        missingTotal: requestedTotal,
        shortfallTotal: requestedTotal,
        hadShortfall: requestedTotal > 0,
        requestedByType,
        allocatedByType: { ...requestedByType },
        placedByType,
        missingByType,
        shortfallsByType: { ...missingByType },
        shortfallTypes: selectedTypes.filter((t) => missingByType[t] > 0),
        unselectedSpawnCount: 0,
        selectedTypes: [...selectedTypes],
        unselectedTypes: [...unselectedTypes],
        fullySatisfied: requestedTotal === 0,
        failures:
          failures.length > 0
            ? failures
            : [{ reason: 'insufficient_reachable_cells' }],
      },
    }
  }

  const excludedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
  ])

  for (let i = 0; i < WALL_DIRS.length; i += 1) {
    const d = WALL_DIRS[i]
    excludedKeys.add(`${maze.start.row + d.dRow},${maze.start.col + d.dCol}`)
    excludedKeys.add(`${maze.exit.row + d.dRow},${maze.exit.col + d.dCol}`)
  }

  const existingHazards = Array.isArray(options?.hazards)
    ? options.hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : []
  addExcludedList(excludedKeys, existingHazards)
  addExcludedList(excludedKeys, options?.keycards ?? maze.keycards)
  const collectibles = options?.collectibles ?? maze.collectibles
  addExcludedList(excludedKeys, collectibles?.items)
  addExcludedList(excludedKeys, collectibles?.coins)
  addExcludedList(excludedKeys, collectibles?.powerUps)
  if (options?.enemies !== undefined) {
    addExcludedList(excludedKeys, options.enemies)
  } else if (Array.isArray(maze.enemies) && !Array.isArray(maze.hidingSpots)) {
    addExcludedList(excludedKeys, maze.enemies)
  }
  addExcludedList(excludedKeys, options?.excludedCells)

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key) || dist < 2) return
    const { row, col } = parseKey(key)
    if (grid[row]?.[col] !== CELL_TYPES.PATH) return
    const wallInfos = getAdjacentWallInfos(grid, row, col)
    if (wallInfos.length === 0) return

    candidates.push({
      key,
      row,
      col,
      dist,
      topology: computeCellTopology(grid, row, col),
      wallInfos,
    })
  })

  const placementSeed = `hiding-placement:level:${level}:seed:${seed}`
  const rng = createRng(placementSeed)
  const shuffledCandidates = shuffleWithRng(candidates, rng)

  if (requestedTotal === 0) {
    return {
      hidingSpots: [],
      selection,
      allocation,
      report: {
        level,
        seed,
        placementSeed,
        candidateCellCount: candidates.length,
        requestedTotal: 0,
        placedTotal: 0,
        missingTotal: 0,
        shortfallTotal: 0,
        hadShortfall: false,
        requestedByType,
        allocatedByType: { ...requestedByType },
        placedByType: Object.fromEntries(selectedTypes.map((t) => [t, 0])),
        missingByType: Object.fromEntries(selectedTypes.map((t) => [t, 0])),
        shortfallsByType: Object.fromEntries(selectedTypes.map((t) => [t, 0])),
        shortfallTypes: [],
        preferencesByType: {},
        unselectedSpawnCount: 0,
        coexistenceRejections: 0,
        coexistenceRejectionReasons: {},
        fullySatisfied: true,
        failures: [],
        selectedTypes: [...selectedTypes],
        unselectedTypes: [...unselectedTypes],
      },
    }
  }

  const spots = []
  const usedCells = new Set()
  const placedByType = {}
  const prefStats = {}
  const placementPreferences = options?.placementPreferences || {}
  const allowFallback = Boolean(options?.allowFallback)

  for (let i = 0; i < selectedTypes.length; i += 1) {
    const t = selectedTypes[i]
    placedByType[t] = 0
    prefStats[t] = {
      preference: placementPreferences[t] || options?.placementPreference || 'auto',
      requested: requestedByType[t] || 0,
      achievedCount: 0,
      fallbackCount: 0,
      failedCount: 0,
    }
  }
  const failures = []
  let coexistenceRejections = 0
  const coexistenceRejectionReasons = {}

  const attemptBuildOnCandidate = (cand, spotType, rejectedReasonsOut) => {
    const orderedWalls = shuffleWithRng(cand.wallInfos, rng).sort((a, b) => {
      const aScore = (a.isBoundaryWall ? 0 : 2) + (a.oppositeOpen ? 1 : 0)
      const bScore = (b.isBoundaryWall ? 0 : 2) + (b.oppositeOpen ? 1 : 0)
      return bScore - aScore
    })

    for (let w = 0; w < orderedWalls.length; w += 1) {
      const built = evaluateWallPlacement(
        spotType,
        grid,
        cand.row,
        cand.col,
        orderedWalls[w],
        rng,
        maze
      )
      if (!built) continue
      if (spotsOverlapInWorld(built, spots)) continue
      if (existingHazards.length > 0) {
        const hazardConflict = findHazardConflictForHidingSpot(
          built,
          existingHazards,
          maze
        )
        if (hazardConflict.conflict) {
          coexistenceRejections += 1
          const r = hazardConflict.reason || 'hazard_coexistence_conflict'
          coexistenceRejectionReasons[r] = (coexistenceRejectionReasons[r] || 0) + 1
          if (rejectedReasonsOut) {
            rejectedReasonsOut.add(r)
          }
          continue
        }
      }

      usedCells.add(cand.key)
      const typeCount = placedByType[spotType] || 0
      const spot = {
        id: `hiding-${spotType}-${cand.row}-${cand.col}-${typeCount}`,
        ...built,
      }
      spots.push(spot)
      placedByType[spotType] = typeCount + 1
      return spot
    }
    return null
  }

  const tryPlaceType = (spotType, minManhattanSpacing, rejectedReasonsOut = null) => {
    if (!selectedSet.has(spotType)) return null
    const cfg = HIDING_SPOT_CONFIG[spotType]
    if (!cfg) return null
    const pref = placementPreferences[spotType] || options?.placementPreference || 'auto'

    if (pref !== 'auto') {
      const eligible = shuffledCandidates.filter((cand) => {
        if (usedCells.has(cand.key)) return false
        if (minManhattanSpacing > 0) {
          const tooClose = spots.some(
            (s) =>
              Math.abs(s.row - cand.row) + Math.abs(s.col - cand.col) <
              minManhattanSpacing
          )
          if (tooClose) return false
        }
        return true
      })

      const prefRes = sortCandidatesByPreference(eligible, pref, {
        grid,
        rows: maze.rows ?? grid.length,
        cols: maze.cols ?? grid[0]?.length,
        start: maze.start,
        exit: maze.exit,
        maxDistance: reachInfo.maxDistance,
        placedInstances: spots.filter((s) => s.type === spotType),
        allEntities: [...existingHazards, ...spots],
        allowFallback,
      })

      if (prefRes.sortedCandidates.length === 0) {
        if (rejectedReasonsOut && prefRes.reason) {
          rejectedReasonsOut.add(prefRes.reason)
        }
        return null
      }

      for (let i = 0; i < prefRes.sortedCandidates.length; i += 1) {
        const spot = attemptBuildOnCandidate(
          prefRes.sortedCandidates[i],
          spotType,
          rejectedReasonsOut
        )
        if (spot) {
          const usedFallback = prefRes.fallbackUsed || i >= prefRes.preferredCount
          return { spot, usedFallback }
        }
      }
      return null
    }

    const preferredTopos = cfg?.placement?.preferredTopologies || []

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < shuffledCandidates.length; i += 1) {
        const cand = shuffledCandidates[i]
        if (usedCells.has(cand.key)) continue
        if (
          pass === 0 &&
          preferredTopos.length > 0 &&
          !preferredTopos.includes(cand.topology)
        ) {
          continue
        }

        if (minManhattanSpacing > 0) {
          const tooClose = spots.some(
            (s) =>
              Math.abs(s.row - cand.row) + Math.abs(s.col - cand.col) <
              minManhattanSpacing
          )
          if (tooClose) continue
        }

        const spot = attemptBuildOnCandidate(cand, spotType, rejectedReasonsOut)
        if (spot) return { spot, usedFallback: false }
      }
    }
    return null
  }

  // Handle explicit manual placements first
  const explicitPlacements = Array.isArray(options?.placements) ? options.placements : []
  for (const req of explicitPlacements) {
    if (req && req.type && Number.isInteger(req.row) && Number.isInteger(req.col)) {
      const key = `${req.row},${req.col}`
      if (!usedCells.has(key)) {
        const wallInfos = getAdjacentWallInfos(grid, req.row, req.col)
        if (wallInfos.length > 0) {
          const cand = {
            key,
            row: req.row,
            col: req.col,
            wallInfos,
            topology: computeCellTopology(grid, req.row, req.col),
          }
          const spot = attemptBuildOnCandidate(cand, req.type, null)
          if (spot && prefStats[req.type]) {
            prefStats[req.type].achievedCount += 1
          }
        }
      }
    }
  }

  // Wave-ordered placement guarantees every selected type receives its
  // minimum instances before optional extra instances consume scarce cells.
  let maxTargetQty = 0
  for (let i = 0; i < selectedTypes.length; i += 1) {
    const qty = requestedByType[selectedTypes[i]] || 0
    if (qty > maxTargetQty) maxTargetQty = qty
  }

  for (let wave = 0; wave < maxTargetQty; wave += 1) {
    for (let i = 0; i < selectedTypes.length; i += 1) {
      const spotType = selectedTypes[i]
      const targetQty = requestedByType[spotType] || 0
      const currentPlaced = placedByType[spotType] || 0
      if (currentPlaced >= targetQty || wave >= targetQty) continue

      const attemptConflicts = new Set()
      const outcome =
        tryPlaceType(spotType, 2, attemptConflicts) ||
        tryPlaceType(spotType, 1, attemptConflicts)
      if (!outcome) {
        prefStats[spotType].failedCount += 1
        const strictPrefFailure = Array.from(attemptConflicts).find((r) =>
          r.startsWith('strict_preference_')
        )
        const hadHazardConflict = attemptConflicts.size > 0 && !strictPrefFailure
        failures.push({
          type: spotType,
          reason:
            strictPrefFailure ||
            (hadHazardConflict
              ? 'insufficient_valid_wall_cells_due_to_hazard_coexistence'
              : 'insufficient_valid_wall_cells_or_capacity'),
          ...(hadHazardConflict ? { conflictReasons: Array.from(attemptConflicts) } : {}),
          instanceIndex: wave,
        })
      } else if (outcome.usedFallback) {
        prefStats[spotType].fallbackCount += 1
      } else {
        prefStats[spotType].achievedCount += 1
      }
    }
  }

  const missingByType = {}
  let placedTotal = 0
  let missingTotal = 0

  for (let i = 0; i < selectedTypes.length; i += 1) {
    const type = selectedTypes[i]
    const req = requestedByType[type] || 0
    const plc = placedByType[type] || 0
    const mis = Math.max(0, req - plc)
    missingByType[type] = mis
    placedTotal += plc
    missingTotal += mis
  }

  const preferencesByType = {}
  for (const [type, stat] of Object.entries(prefStats)) {
    const req = stat.requested || 0
    const plc = placedByType[type] || 0
    preferencesByType[type] = {
      ...stat,
      fallbackUsed: stat.fallbackCount > 0,
      achieved:
        req === 0
          ? true
          : stat.preference === 'auto'
            ? plc > 0
            : stat.failedCount === 0 && stat.fallbackCount === 0 && plc === req,
    }
  }

  let unselectedSpawnCount = 0
  for (let i = 0; i < spots.length; i += 1) {
    if (!selectedSet.has(spots[i].type)) {
      unselectedSpawnCount += 1
    }
  }

  const shortfallTypes = selectedTypes.filter((t) => missingByType[t] > 0)
  const fullySatisfied = missingTotal === 0 && unselectedSpawnCount === 0

  return {
    hidingSpots: spots,
    selection,
    allocation,
    report: {
      level,
      seed,
      placementSeed,
      candidateCellCount: candidates.length,
      requestedTotal,
      placedTotal,
      missingTotal,
      shortfallTotal: missingTotal,
      hadShortfall: missingTotal > 0,
      requestedByType,
      allocatedByType: { ...requestedByType },
      placedByType,
      missingByType,
      shortfallsByType: { ...missingByType },
      shortfallTypes,
      preferencesByType,
      unselectedSpawnCount,
      coexistenceRejections,
      coexistenceRejectionReasons,
      fullySatisfied,
      failures,
      selectedTypes: [...selectedTypes],
      unselectedTypes: [...unselectedTypes],
    },
  }
}

export function placeHidingSpots(maze, options = {}) {
  const result = placeHidingSpotsWithReport(maze, options)
  return result.hidingSpots
}
