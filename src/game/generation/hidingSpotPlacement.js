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

  // Pick slight deterministic lateral jitter inside safe wall span
  const usableMargin = Math.max(0, (wallInfo.spanT - p.halfWidth * 2) * 0.5)
  const lateralJitter =
    usableMargin > 0.04 && typeof rng === 'function'
      ? (rng() * 2 - 1) * Math.min(0.28, usableMargin * 0.65)
      : 0

  const centerWorld = gridToWorld(row, col, maze)
  if (!centerWorld) return null

  const distFromWallToCenter = backGap + p.halfDepthBack
  const centerDistFromCellMid = CELL_HALF - distFromWallToCenter
  const cx = normalizeZero(
    centerWorld.x + wallInfo.nx * centerDistFromCellMid + wallInfo.tx * lateralJitter
  )
  const cz = normalizeZero(
    centerWorld.z + wallInfo.nz * centerDistFromCellMid + wallInfo.tz * lateralJitter
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

/**
 * Deterministically places a balanced variety of all 8 hiding spot types
 * throughout walkable maze cells without overlapping start, exit, hazards,
 * keycards, or collectibles, and while keeping every corridor navigable.
 */
export function placeHidingSpots(maze, options = {}) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !maze?.start || !maze?.exit) {
    return []
  }

  const reachInfo = exploreReachableCells(grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 3) {
    return []
  }

  const excludedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
  ])

  // Preserve start & exit immediate threshold safety
  for (let i = 0; i < WALL_DIRS.length; i += 1) {
    const d = WALL_DIRS[i]
    excludedKeys.add(`${maze.start.row + d.dRow},${maze.start.col + d.dCol}`)
    excludedKeys.add(`${maze.exit.row + d.dRow},${maze.exit.col + d.dCol}`)
  }

  addExcludedList(excludedKeys, options?.hazards ?? maze.hazards)
  addExcludedList(excludedKeys, options?.keycards ?? maze.keycards)
  const collectibles = options?.collectibles ?? maze.collectibles
  addExcludedList(excludedKeys, collectibles?.items)
  addExcludedList(excludedKeys, collectibles?.coins)
  addExcludedList(excludedKeys, collectibles?.powerUps)
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

  if (candidates.length === 0) {
    return []
  }

  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
  const seed = maze.seed ?? maze.id ?? 0
  const rng = createRng(`${seed}-hiding-spots-v1`)
  const shuffledCandidates = shuffleWithRng(candidates, rng)

  const targetCount = Number.isInteger(options?.count)
    ? Math.max(0, options.count)
    : Math.max(
        ALL_HIDING_SPOT_TYPES.length,
        Math.min(18, Math.round(reachInfo.distances.size / 18))
      )

  if (targetCount === 0) return []

  const requestedTypes = Array.isArray(options?.types) && options.types.length > 0
    ? options.types.filter(isValidHidingSpotType)
    : ALL_HIDING_SPOT_TYPES

  // Ensure every single one of the 8 types is scheduled first in deterministic order
  const typeQueue = [...shuffleWithRng(requestedTypes, rng)]
  while (typeQueue.length < targetCount) {
    typeQueue.push(...shuffleWithRng(requestedTypes, rng))
  }
  typeQueue.length = targetCount

  const spots = []
  const usedCells = new Set()

  const tryPlaceType = (spotType, minManhattanSpacing) => {
    const cfg = HIDING_SPOT_CONFIG[spotType]
    const preferredTopos = cfg?.placement?.preferredTopologies || []

    // Two candidate passes: first matching preferred topology, then any safe wall cell
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < shuffledCandidates.length; i += 1) {
        const cand = shuffledCandidates[i]
        if (usedCells.has(cand.key)) continue
        if (pass === 0 && preferredTopos.length > 0 && !preferredTopos.includes(cand.topology)) {
          continue
        }

        if (minManhattanSpacing > 0) {
          const tooClose = spots.some(
            (s) =>
              Math.abs(s.row - cand.row) + Math.abs(s.col - cand.col) < minManhattanSpacing
          )
          if (tooClose) continue
        }

        // Order adjacent walls so interior corridor side walls are chosen before dead-end back walls
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
          if (built) {
            usedCells.add(cand.key)
            const spot = {
              id: `hiding-${spotType}-${cand.row}-${cand.col}-${spots.length}`,
              ...built,
            }
            spots.push(spot)
            return spot
          }
        }
      }
    }
    return null
  }

  for (let i = 0; i < typeQueue.length; i += 1) {
    const spotType = typeQueue[i]
    // Prefer spacing >= 2 Manhattan cells; relax to 1 only if maze is tight so all 8 types appear
    const placed = tryPlaceType(spotType, 2) || tryPlaceType(spotType, 1)
    if (!placed) continue
  }

  return spots
}
