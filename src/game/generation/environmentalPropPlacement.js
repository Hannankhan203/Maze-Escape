import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { CELL_SIZE, PLAYER_RADIUS } from '../world/worldCoords.js'
import { placeHazards } from './hazardPlacement.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'
import { sortCandidatesByPreference } from './placementPreferences.js'

export const PROP_TYPES = {
  DESK_BROKEN: 'desk_broken',
  CHAIR_BROKEN: 'chair_broken',
  CHAIR_OVERTURNED: 'chair_overturned',
  FILING_CABINET: 'filing_cabinet',
  FILING_CABINET_OVERTURNED: 'filing_cabinet_overturned',
  STORAGE_LOCKER: 'storage_locker',
  STORAGE_SHELF: 'storage_shelf',
  INDUSTRIAL_BARREL: 'industrial_barrel',
  WOODEN_CRATE: 'wooden_crate',
  TOOLBOX: 'toolbox',
  ELECTRICAL_PANEL: 'electrical_panel',
  DEBRIS_PILE: 'debris_pile',
}

const PROP_COUNTS_BY_DENSITY = {
  light: 24,
  medium: 55,
  heavy: 95,
}

const CELL_HALF = CELL_SIZE * 0.5 // 2.0m
// Pilaster plinths in buildMazeCeiling.js sit on even-even wall nodes:
// cornerOffPlinth = 2.0 - 0.25 + 0.04*1.5 = 1.81, halfSize = 0.27 -> outer reach = 2.08 (0.08m into adjacent cell)
// and lateral reach along an even-even wall segment from +/-2.00 down to +/-1.54.
const PILASTER_PLINTH_OUTER_REACH = 0.08
const PILASTER_SEGMENT_INSET = 0.46
const PILASTER_SAFETY_PAD = 0.04
const SIDE_WALL_SAFETY_PAD = 0.06
const OPEN_CORNER_SAFETY_PAD = 0.1
const MIN_CORRIDOR_PASSAGE_WIDTH = PLAYER_RADIUS * 2 + 0.4 // 1.90m minimum clear passage

/**
 * Physical footprint bounds (in unscaled local space with -Z facing the anchor wall,
 * +Z facing into the corridor, and +/-X running laterally along the wall).
 */
export const PROP_PLACEMENT_SPECS = {
  [PROP_TYPES.DESK_BROKEN]: {
    halfWidth: 0.63,
    halfDepthBack: 0.36,
    halfDepthFront: 0.36,
    wallGap: 0.03,
    maxYawJitter: 0.08,
    scaleMin: 0.92,
    scaleMax: 1.06,
    wallMounted: false,
    companions: [
      PROP_TYPES.CHAIR_BROKEN,
      PROP_TYPES.CHAIR_OVERTURNED,
      PROP_TYPES.FILING_CABINET,
      PROP_TYPES.DEBRIS_PILE,
    ],
  },
  [PROP_TYPES.CHAIR_BROKEN]: {
    halfWidth: 0.36,
    halfDepthBack: 0.22,
    halfDepthFront: 0.29,
    wallGap: 0.05,
    maxYawJitter: 0.22,
    scaleMin: 0.94,
    scaleMax: 1.08,
    wallMounted: false,
    companions: [
      PROP_TYPES.DESK_BROKEN,
      PROP_TYPES.DEBRIS_PILE,
      PROP_TYPES.FILING_CABINET,
    ],
  },
  [PROP_TYPES.CHAIR_OVERTURNED]: {
    halfWidth: 0.43,
    halfDepthBack: 0.32,
    halfDepthFront: 0.32,
    wallGap: 0.06,
    maxYawJitter: 0.24,
    scaleMin: 0.94,
    scaleMax: 1.08,
    wallMounted: false,
    companions: [
      PROP_TYPES.DESK_BROKEN,
      PROP_TYPES.DEBRIS_PILE,
      PROP_TYPES.TOOLBOX,
    ],
  },
  [PROP_TYPES.FILING_CABINET]: {
    halfWidth: 0.28,
    halfDepthBack: 0.3,
    halfDepthFront: 0.45,
    wallGap: 0.025,
    maxYawJitter: 0.06,
    scaleMin: 0.94,
    scaleMax: 1.08,
    wallMounted: false,
    companions: [
      PROP_TYPES.DESK_BROKEN,
      PROP_TYPES.CHAIR_BROKEN,
      PROP_TYPES.DEBRIS_PILE,
      PROP_TYPES.FILING_CABINET_OVERTURNED,
    ],
  },
  [PROP_TYPES.FILING_CABINET_OVERTURNED]: {
    halfWidth: 0.71,
    halfDepthBack: 0.48,
    halfDepthFront: 0.48,
    wallGap: 0.04,
    maxYawJitter: 0.12,
    scaleMin: 0.92,
    scaleMax: 1.04,
    wallMounted: false,
    companions: [
      PROP_TYPES.FILING_CABINET,
      PROP_TYPES.DEBRIS_PILE,
      PROP_TYPES.CHAIR_OVERTURNED,
    ],
  },
  [PROP_TYPES.STORAGE_LOCKER]: {
    halfWidth: 0.59,
    halfDepthBack: 0.28,
    halfDepthFront: 0.48,
    wallGap: 0.025,
    maxYawJitter: 0.05,
    scaleMin: 0.95,
    scaleMax: 1.06,
    wallMounted: false,
    companions: [
      PROP_TYPES.WOODEN_CRATE,
      PROP_TYPES.INDUSTRIAL_BARREL,
      PROP_TYPES.TOOLBOX,
      PROP_TYPES.DEBRIS_PILE,
    ],
  },
  [PROP_TYPES.STORAGE_SHELF]: {
    halfWidth: 0.48,
    halfDepthBack: 0.24,
    halfDepthFront: 0.24,
    wallGap: 0.025,
    maxYawJitter: 0.06,
    scaleMin: 0.94,
    scaleMax: 1.06,
    wallMounted: false,
    companions: [
      PROP_TYPES.WOODEN_CRATE,
      PROP_TYPES.INDUSTRIAL_BARREL,
      PROP_TYPES.TOOLBOX,
      PROP_TYPES.DEBRIS_PILE,
    ],
  },
  [PROP_TYPES.INDUSTRIAL_BARREL]: {
    halfWidth: 0.35,
    halfDepthBack: 0.35,
    halfDepthFront: 0.35,
    wallGap: 0.04,
    maxYawJitter: 0.4,
    scaleMin: 0.94,
    scaleMax: 1.08,
    wallMounted: false,
    companions: [
      PROP_TYPES.WOODEN_CRATE,
      PROP_TYPES.STORAGE_SHELF,
      PROP_TYPES.TOOLBOX,
    ],
  },
  [PROP_TYPES.WOODEN_CRATE]: {
    halfWidth: 0.29,
    halfDepthBack: 0.29,
    halfDepthFront: 0.29,
    wallGap: 0.035,
    maxYawJitter: 0.2,
    scaleMin: 0.92,
    scaleMax: 1.08,
    wallMounted: false,
    companions: [
      PROP_TYPES.INDUSTRIAL_BARREL,
      PROP_TYPES.STORAGE_SHELF,
      PROP_TYPES.TOOLBOX,
      PROP_TYPES.DEBRIS_PILE,
    ],
  },
  [PROP_TYPES.TOOLBOX]: {
    halfWidth: 0.23,
    halfDepthBack: 0.14,
    halfDepthFront: 0.14,
    wallGap: 0.04,
    maxYawJitter: 0.26,
    scaleMin: 0.94,
    scaleMax: 1.1,
    wallMounted: false,
    companions: [
      PROP_TYPES.WOODEN_CRATE,
      PROP_TYPES.STORAGE_SHELF,
      PROP_TYPES.ELECTRICAL_PANEL,
    ],
  },
  [PROP_TYPES.ELECTRICAL_PANEL]: {
    halfWidth: 0.29,
    halfDepthBack: 0.1,
    halfDepthFront: 0.1,
    wallGap: 0.002,
    maxYawJitter: 0,
    scaleMin: 0.95,
    scaleMax: 1.05,
    wallMounted: true,
    companions: [
      PROP_TYPES.TOOLBOX,
      PROP_TYPES.INDUSTRIAL_BARREL,
      PROP_TYPES.DEBRIS_PILE,
    ],
  },
  [PROP_TYPES.DEBRIS_PILE]: {
    halfWidth: 0.44,
    halfDepthBack: 0.35,
    halfDepthFront: 0.3,
    wallGap: 0.05,
    maxYawJitter: 0.35,
    scaleMin: 0.92,
    scaleMax: 1.08,
    wallMounted: false,
    companions: [
      PROP_TYPES.DESK_BROKEN,
      PROP_TYPES.CHAIR_BROKEN,
      PROP_TYPES.FILING_CABINET_OVERTURNED,
    ],
  },
}

/**
 * Authoritative 2D X/Z collision shapes in unscaled prop local space matching
 * `buildEnvironmentalProps.js` silhouettes. Non-solid debris and wall-mounted
 * electrical boxes intentionally omit blocking shapes so corridor navigation stays natural.
 */
export const PROP_COLLIDER_SPECS = {
  [PROP_TYPES.DESK_BROKEN]: [
    { kind: 'obb', x: 0, z: 0, halfW: 0.59, halfD: 0.33, yaw: 0 },
  ],
  [PROP_TYPES.CHAIR_BROKEN]: [
    { kind: 'obb', x: 0, z: 0.025, halfW: 0.21, halfD: 0.23, yaw: 0 },
  ],
  [PROP_TYPES.CHAIR_OVERTURNED]: [
    { kind: 'obb', x: 0, z: 0, halfW: 0.39, halfD: 0.2, yaw: 0.24 },
  ],
  [PROP_TYPES.FILING_CABINET]: [
    { kind: 'obb', x: 0, z: 0.07, halfW: 0.265, halfD: 0.36, yaw: 0 },
  ],
  [PROP_TYPES.FILING_CABINET_OVERTURNED]: [
    { kind: 'obb', x: 0, z: -0.035, halfW: 0.61, halfD: 0.29, yaw: 0.22 },
  ],
  [PROP_TYPES.STORAGE_LOCKER]: [
    { kind: 'obb', x: 0, z: -0.05, halfW: 0.4, halfD: 0.22, yaw: 0 },
    { kind: 'obb', x: 0.2588, z: 0.3103, halfW: 0.185, halfD: 0.02, yaw: 0.82 },
  ],
  [PROP_TYPES.STORAGE_SHELF]: [
    { kind: 'obb', x: 0, z: 0, halfW: 0.46, halfD: 0.22, yaw: 0 },
  ],
  [PROP_TYPES.INDUSTRIAL_BARREL]: [
    { kind: 'circle', x: 0, z: 0, radius: 0.332 },
  ],
  [PROP_TYPES.WOODEN_CRATE]: [
    { kind: 'obb', x: 0, z: 0, halfW: 0.28, halfD: 0.28, yaw: 0 },
  ],
  [PROP_TYPES.TOOLBOX]: [
    { kind: 'obb', x: 0, z: 0, halfW: 0.22, halfD: 0.135, yaw: 0 },
  ],
  [PROP_TYPES.ELECTRICAL_PANEL]: [],
  [PROP_TYPES.DEBRIS_PILE]: [],
}

// Weighted prop selection prioritizing office furniture, desks, chairs, filing cabinets, and lockers over boxes
const PROP_WEIGHTED_POOL = [
  { type: PROP_TYPES.DESK_BROKEN, weight: 18 },
  { type: PROP_TYPES.CHAIR_BROKEN, weight: 14 },
  { type: PROP_TYPES.CHAIR_OVERTURNED, weight: 14 },
  { type: PROP_TYPES.FILING_CABINET, weight: 12 },
  { type: PROP_TYPES.FILING_CABINET_OVERTURNED, weight: 8 },
  { type: PROP_TYPES.STORAGE_LOCKER, weight: 10 },
  { type: PROP_TYPES.STORAGE_SHELF, weight: 8 },
  { type: PROP_TYPES.INDUSTRIAL_BARREL, weight: 6 },
  { type: PROP_TYPES.WOODEN_CRATE, weight: 4 },
  { type: PROP_TYPES.TOOLBOX, weight: 3 },
  { type: PROP_TYPES.ELECTRICAL_PANEL, weight: 6 },
  { type: PROP_TYPES.DEBRIS_PILE, weight: 4 },
]

function pickWeightedProp(rng, preferredTypes = null) {
  if (Array.isArray(preferredTypes) && preferredTypes.length > 0 && rng() < 0.65) {
    return preferredTypes[Math.floor(rng() * preferredTypes.length)]
  }
  const totalWeight = PROP_WEIGHTED_POOL.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * totalWeight
  for (let i = 0; i < PROP_WEIGHTED_POOL.length; i += 1) {
    roll -= PROP_WEIGHTED_POOL[i].weight
    if (roll <= 0) {
      return PROP_WEIGHTED_POOL[i].type
    }
  }
  return PROP_TYPES.DESK_BROKEN
}

// Cardinal wall directions with outward normal (nx, nz) from cell center toward wall
// and lateral tangent (tx, tz) running along that wall face.
// Yaw rotates local -Z toward (nx, nz), so local +Z faces cleanly into the corridor.
const CARDINAL_DIRS = [
  { name: 'north', dRow: -1, dCol: 0, nx: 0, nz: -1, tx: 1, tz: 0, yaw: 0 },
  { name: 'south', dRow: 1, dCol: 0, nx: 0, nz: 1, tx: 1, tz: 0, yaw: Math.PI },
  { name: 'west', dRow: 0, dCol: -1, nx: -1, nz: 0, tx: 0, tz: 1, yaw: Math.PI / 2 },
  { name: 'east', dRow: 0, dCol: 1, nx: 1, nz: 0, tx: 0, tz: 1, yaw: -Math.PI / 2 },
]

const ORTHOGONAL_NEIGHBORS = [
  { dRow: -1, dCol: 0 },
  { dRow: 1, dCol: 0 },
  { dRow: 0, dCol: -1 },
  { dRow: 0, dCol: 1 },
]

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

function isWallAt(grid, r, c) {
  const rows = grid.length
  const cols = grid[0].length
  return r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] === CELL_TYPES.WALL
}

function isEvenWallNode(grid, r, c) {
  const rows = grid.length
  const cols = grid[0].length
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

function getValidWallNeighbors(grid, row, col) {
  const wallNeighbors = []
  for (let i = 0; i < CARDINAL_DIRS.length; i += 1) {
    const dir = CARDINAL_DIRS[i]
    if (isWallAt(grid, row + dir.dRow, col + dir.dCol)) {
      wallNeighbors.push(dir)
    }
  }
  return wallNeighbors
}

/**
 * Computes valid lateral [minT, maxT] placement bounds along `wallDir` within cell `(row, col)`
 * accounting for side walls, open corner transitions, and protruding wall-engaged pilasters
 * generated by `buildMazeCeiling.js`.
 */
function computeWallLateralBounds(grid, row, col, wallDir) {
  const wr = row + wallDir.dRow
  const wc = col + wallDir.dCol

  let minT = -CELL_HALF
  let maxT = CELL_HALF

  // Case 1: The wall segment itself is an even-even pillar node -> corner pilasters occupy
  // [-2.08, -1.54] and [+1.54, +2.08] at both ends along the wall face.
  const wallIsEvenNode = isEvenWallNode(grid, wr, wc)

  for (const sign of [-1, 1]) {
    const sideR = row + sign * wallDir.tz
    const sideC = col + sign * wallDir.tx
    const diagR = wr + sign * wallDir.tz
    const diagC = wc + sign * wallDir.tx

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

    if (sign < 0) {
      minT = Math.max(minT, -CELL_HALF + inset)
    } else {
      maxT = Math.min(maxT, CELL_HALF - inset)
    }
  }

  return { minT, maxT }
}

/**
 * Evaluates a candidate prop placement inside `(row, col)` against wall geometry,
 * pilaster zones, navigable corridor width, and nearby placed props.
 */
function tryBuildPropPlacement(
  grid,
  row,
  col,
  propType,
  wallNeighbors,
  rng,
  placedProps,
  id
) {
  const spec = PROP_PLACEMENT_SPECS[propType] || PROP_PLACEMENT_SPECS[PROP_TYPES.DEBRIS_PILE]
  const orderedWalls = shuffleWithRng(wallNeighbors, rng)

  for (let wIdx = 0; wIdx < orderedWalls.length; wIdx += 1) {
    const wallDir = orderedWalls[wIdx]
    const { minT, maxT } = computeWallLateralBounds(grid, row, col, wallDir)
    const spanT = maxT - minT
    if (spanT <= 0.2) continue

    const scale = spec.scaleMin + rng() * (spec.scaleMax - spec.scaleMin)
    const yawDelta =
      spec.maxYawJitter > 0 ? (rng() - 0.5) * 2 * spec.maxYawJitter : 0
    const absYaw = Math.abs(yawDelta)
    const cosY = Math.cos(absYaw)
    const sinY = Math.sin(absYaw)

    const maxDepth = Math.max(spec.halfDepthBack, spec.halfDepthFront)
    const effHalfWidth = (spec.halfWidth * cosY + maxDepth * sinY) * scale
    const effHalfBack = (spec.halfDepthBack * cosY + spec.halfWidth * sinY) * scale
    const effHalfFront = (spec.halfDepthFront * cosY + spec.halfWidth * sinY) * scale

    const minAllowedT = minT + effHalfWidth
    const maxAllowedT = maxT - effHalfWidth
    if (minAllowedT > maxAllowedT) {
      continue
    }

    // Anchor wall-normal distance from cell center so back stays cleanly inside/against +/-2.0 wall face
    const normalDist = CELL_HALF - spec.wallGap - effHalfBack

    // Ensure navigable passage remains generous across this cell (including opposite pilaster margin)
    const hasOppositeWall = isWallAt(grid, row - wallDir.dRow, col - wallDir.dCol)
    if (hasOppositeWall) {
      const oppPilasterReach = isEvenWallNode(grid, row - wallDir.dRow, col - wallDir.dCol)
        ? PILASTER_PLINTH_OUTER_REACH
        : 0
      const frontEdgeInCell = normalDist - effHalfFront // relative to cell center toward +normal
      const clearPassage = frontEdgeInCell - (-CELL_HALF + oppPilasterReach)
      if (clearPassage < MIN_CORRIDOR_PASSAGE_WIDTH) {
        continue
      }
    }

    // Pick lateral offset inside safe wall segment (avoid overly centered symmetrical stiffness)
    const slackT = maxAllowedT - minAllowedT
    const maxJitterShift = Math.min(slackT * 0.5, 0.55)
    const centerT = (minAllowedT + maxAllowedT) * 0.5
    const lateralT =
      slackT > 0.02 ? centerT + (rng() - 0.5) * 2 * maxJitterShift : centerT

    const offsetX = wallDir.nx * normalDist + wallDir.tx * lateralT
    const offsetZ = wallDir.nz * normalDist + wallDir.tz * lateralT
    const worldX = col * CELL_SIZE + offsetX
    const worldZ = row * CELL_SIZE + offsetZ

    // Compute world-space axis-aligned 2D bounding box for fast exact overlap checking against nearby props
    const worldYaw = wallDir.yaw + yawDelta
    const absWorldCos = Math.abs(Math.cos(worldYaw))
    const absWorldSin = Math.abs(Math.sin(worldYaw))
    const boundHalfX = (spec.halfWidth * absWorldCos + maxDepth * absWorldSin) * scale + 0.08
    const boundHalfZ = (maxDepth * absWorldCos + spec.halfWidth * absWorldSin) * scale + 0.08

    let overlapsNearby = false
    for (let pIdx = 0; pIdx < placedProps.length; pIdx += 1) {
      const other = placedProps[pIdx]
      if (Math.abs(other.descriptor.row - row) > 1 || Math.abs(other.descriptor.col - col) > 1) {
        continue
      }
      if (
        Math.abs(worldX - other.worldX) < boundHalfX + other.boundHalfX &&
        Math.abs(worldZ - other.worldZ) < boundHalfZ + other.boundHalfZ
      ) {
        overlapsNearby = true
        break
      }
    }
    if (overlapsNearby) continue

    return {
      descriptor: {
        id,
        type: propType,
        row,
        col,
        wallSide: wallDir.name,
        wallMounted: spec.wallMounted,
        offsetX: Math.round(offsetX * 10000) / 10000,
        offsetZ: Math.round(offsetZ * 10000) / 10000,
        rotationYaw: Math.round(worldYaw * 10000) / 10000,
        scale: Math.round(scale * 10000) / 10000,
      },
      worldX,
      worldZ,
      boundHalfX,
      boundHalfZ,
    }
  }

  return null
}

function addExcludedCellList(excludedKeys, list) {
  if (!Array.isArray(list)) return
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (Number.isInteger(item?.row) && Number.isInteger(item?.col)) {
      excludedKeys.add(`${item.row},${item.col}`)
    }
  }
}

function countLocalClusterNeighbors(usedKeys, row, col) {
  let count = 0
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue
      if (usedKeys.has(`${row + dr},${col + dc}`)) {
        count += 1
      }
    }
  }
  return count
}

/**
 * Places procedural environmental props deterministically across reachable walled path cells,
 * excluding gameplay entities (collectibles, keycards, hazards, start/exit),
 * keeping props attached to valid walls/pilaster-clear segments, and preserving corridor space.
 */
export function placeEnvironmentalProps(maze, options = {}) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return []
  }

  const density = options?.density || 'medium'
  const targetCount =
    Number.isInteger(options?.count) && options.count >= 0
      ? options.count
      : PROP_COUNTS_BY_DENSITY[density] || PROP_COUNTS_BY_DENSITY.medium

  if (targetCount === 0) {
    return []
  }

  const rng = createRng(`${maze.seed ?? 0}-props-${density}`)
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 2) {
    return []
  }

  // Deterministically resolve hazards when not passed explicitly
  // so buildMazeMeshes() and standalone callers obey identical exclusions.
  const hazardList = Array.isArray(options?.hazards)
    ? options.hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : placeHazards(maze)

  const collectibleSource = options?.collectibles || maze.collectibles
  const keycardList = Array.isArray(options?.keycards)
    ? options.keycards
    : maze.keycards

  const excludedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
  ])

  addExcludedCellList(excludedKeys, hazardList)
  addExcludedCellList(excludedKeys, collectibleSource?.items)
  addExcludedCellList(excludedKeys, collectibleSource?.coins)
  addExcludedCellList(excludedKeys, collectibleSource?.powerUps)
  addExcludedCellList(excludedKeys, keycardList)
  addExcludedCellList(excludedKeys, options?.hidingSpots || maze.hidingSpots)
  addExcludedCellList(excludedKeys, options?.excludedCells)

  // Softly deprioritize immediate start/exit threshold neighbors so entrances and exit gates feel unobstructed
  const softAvoidKeys = new Set()
  for (let i = 0; i < ORTHOGONAL_NEIGHBORS.length; i += 1) {
    const dir = ORTHOGONAL_NEIGHBORS[i]
    const er = maze.exit.row + dir.dRow
    const ec = maze.exit.col + dir.dCol
    if (maze.grid[er]?.[ec] === CELL_TYPES.PATH) {
      softAvoidKeys.add(`${er},${ec}`)
    }
  }

  const candidateMap = new Map()
  const primaryPool = []
  const fallbackPool = []

  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key)) return
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return

    const wallNeighbors = getValidWallNeighbors(maze.grid, row, col)
    // Strictly skip open wall-less intersections so props never float in middle of foreground space
    if (wallNeighbors.length === 0) return

    const entry = { key, row, col, dist, wallNeighbors }
    candidateMap.set(key, entry)

    if (softAvoidKeys.has(key) || dist <= 1) {
      fallbackPool.push(entry)
    } else {
      primaryPool.push(entry)
    }
  })

  if (candidateMap.size === 0) {
    return []
  }

  primaryPool.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
  fallbackPool.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)

  const orderedCandidates = [
    ...shuffleWithRng(primaryPool, rng),
    ...shuffleWithRng(fallbackPool, rng),
  ]

  const placedProps = []
  const usedKeys = new Set()
  const maxSafetyPass = orderedCandidates.length * 2

  // Two-pass spacing: pass 0 avoids overcrowding (>2 neighbors in 3x3 pocket),
  // pass 1 relaxes local neighbor cap only if needed to preserve density target.
  for (let pass = 0; pass < 2 && placedProps.length < targetCount; pass += 1) {
    let cursor = 0
    while (placedProps.length < targetCount && cursor < orderedCandidates.length && cursor < maxSafetyPass) {
      const candidate = orderedCandidates[cursor]
      cursor += 1
      if (usedKeys.has(candidate.key)) continue

      if (pass === 0 && countLocalClusterNeighbors(usedKeys, candidate.row, candidate.col) >= 2) {
        continue
      }

      const propType = pickWeightedProp(rng)
      const built = tryBuildPropPlacement(
        maze.grid,
        candidate.row,
        candidate.col,
        propType,
        candidate.wallNeighbors,
        rng,
        placedProps,
        `prop-${propType}-${candidate.row}-${candidate.col}-${placedProps.length}`
      )

      if (!built) continue

      usedKeys.add(candidate.key)
      placedProps.push(built)

      // Occasional contextual companion prop in an adjacent valid walled cell
      if (
        pass === 0 &&
        placedProps.length < targetCount &&
        countLocalClusterNeighbors(usedKeys, candidate.row, candidate.col) === 0 &&
        rng() < 0.35
      ) {
        const shuffledNeighbors = shuffleWithRng([...ORTHOGONAL_NEIGHBORS], rng)
        const preferredCompanions = PROP_PLACEMENT_SPECS[propType]?.companions || null

        for (let nIdx = 0; nIdx < shuffledNeighbors.length; nIdx += 1) {
          const nDir = shuffledNeighbors[nIdx]
          const nr = candidate.row + nDir.dRow
          const nc = candidate.col + nDir.dCol
          const nKey = `${nr},${nc}`
          const nCandidate = candidateMap.get(nKey)

          if (!nCandidate || usedKeys.has(nKey) || softAvoidKeys.has(nKey)) {
            continue
          }
          if (countLocalClusterNeighbors(usedKeys, nr, nc) >= 2) {
            continue
          }

          const secondaryType = pickWeightedProp(rng, preferredCompanions)
          const companion = tryBuildPropPlacement(
            maze.grid,
            nr,
            nc,
            secondaryType,
            nCandidate.wallNeighbors,
            rng,
            placedProps,
            `prop-cluster-${secondaryType}-${nr}-${nc}-${placedProps.length}`
          )

          if (companion) {
            usedKeys.add(nKey)
            placedProps.push(companion)
            break
          }
        }
      }
    }
  }

  return placedProps.map((item) => item.descriptor)
}

/**
 * Sandbox-aware environmental prop placement with exact per-type quantities,
 * placement preferences, strict vs fallback control, and structured report.
 */
export function placeEnvironmentalPropsWithReport(maze, options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {}
  const explicitPlacements = Array.isArray(safeOptions?.placements) ? safeOptions.placements : []
  const hasSandboxControl = Boolean(
    safeOptions.perTypeQuantities ||
      Array.isArray(safeOptions.enabledTypes) ||
      safeOptions.placementPreferences ||
      explicitPlacements.length > 0
  )

  if (!hasSandboxControl) {
    const props = placeEnvironmentalProps(maze, safeOptions).map((d) => ({
      ...d,
      isManual: false,
      placementOrigin: 'automatic',
      manualId: null,
      placementPreference: 'auto',
    }))
    const placedByType = {}
    for (let i = 0; i < props.length; i += 1) {
      const t = props[i].type
      placedByType[t] = (placedByType[t] || 0) + 1
    }
    return {
      props,
      report: {
        requestedTotal: props.length,
        placedTotal: props.length,
        missingTotal: 0,
        requestedByType: { ...placedByType },
        placedByType,
        missingByType: {},
        preferencesByType: {},
        failures: [],
        fullySatisfied: true,
      },
    }
  }

  const allPropSet = new Set(Object.values(PROP_TYPES))
  const enabledTypes = Array.isArray(safeOptions.enabledTypes)
    ? Array.from(new Set(safeOptions.enabledTypes.filter((t) => allPropSet.has(t))))
    : Object.values(PROP_TYPES)

  if (!maze?.grid || !maze?.start || !maze?.exit || (enabledTypes.length === 0 && explicitPlacements.length === 0)) {
    return {
      props: [],
      report: {
        requestedTotal: 0,
        placedTotal: 0,
        missingTotal: 0,
        requestedByType: {},
        placedByType: {},
        missingByType: {},
        preferencesByType: {},
        failures: [],
        fullySatisfied: true,
      },
    }
  }

  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  const walkableCount = reachInfo?.distances?.size || 0
  const density = safeOptions.density || 'medium'
  const autoBudget = Math.min(
    PROP_COUNTS_BY_DENSITY[density] || PROP_COUNTS_BY_DENSITY.medium,
    Math.max(enabledTypes.length, Math.floor(walkableCount * 0.35))
  )

  const perTypeQuantities = safeOptions.perTypeQuantities || {}
  const requestedByType = {}
  const autoTypes = []
  let explicitSum = 0

  for (let i = 0; i < enabledTypes.length; i += 1) {
    const t = enabledTypes[i]
    const rawQ = perTypeQuantities[t]
    if (rawQ !== null && rawQ !== undefined && Number.isFinite(Number(rawQ))) {
      const q = Math.max(0, Math.floor(Number(rawQ)))
      requestedByType[t] = q
      explicitSum += q
    } else {
      autoTypes.push(t)
    }
  }

  if (autoTypes.length > 0) {
    const remainingBudget = Math.max(autoTypes.length, autoBudget - explicitSum)
    const perAuto = Math.max(1, Math.min(6, Math.floor(remainingBudget / autoTypes.length)))
    for (let i = 0; i < autoTypes.length; i += 1) {
      requestedByType[autoTypes[i]] = perAuto
    }
  }

  const globalMax = Number.isFinite(safeOptions.globalMax)
    ? Math.max(0, Math.floor(safeOptions.globalMax))
    : 120

  const targetSlots = []
  const maxPerType = Math.max(0, ...Object.values(requestedByType))
  for (let wave = 0; wave < maxPerType && targetSlots.length < globalMax; wave += 1) {
    for (let i = 0; i < enabledTypes.length && targetSlots.length < globalMax; i += 1) {
      const t = enabledTypes[i]
      if (wave < (requestedByType[t] || 0)) {
        targetSlots.push(t)
      }
    }
  }

  if (
    (targetSlots.length === 0 && explicitPlacements.length === 0) ||
    !reachInfo.valid ||
    reachInfo.distances.size <= 2
  ) {
    const placedByType = Object.fromEntries(enabledTypes.map((t) => [t, 0]))
    const missingByType = {}
    let missingTotal = 0
    for (const t of enabledTypes) {
      missingByType[t] = requestedByType[t] || 0
      missingTotal += missingByType[t]
    }
    return {
      props: [],
      report: {
        requestedTotal: targetSlots.length,
        placedTotal: 0,
        missingTotal,
        requestedByType,
        placedByType,
        missingByType,
        preferencesByType: {},
        failures:
          !reachInfo.valid || reachInfo.distances.size <= 2
            ? [{ stage: 'reachability', reason: 'insufficient_reachable_cells' }]
            : [],
        fullySatisfied: missingTotal === 0 && (!reachInfo.valid || reachInfo.distances.size <= 2 ? false : true),
      },
    }
  }

  const rng = createRng(`${maze.seed ?? 0}-props-sandbox`)
  const hazardList = Array.isArray(safeOptions.hazards)
    ? safeOptions.hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : []
  const collectibleSource = safeOptions.collectibles || maze.collectibles
  const keycardList = Array.isArray(safeOptions.keycards)
    ? safeOptions.keycards
    : maze.keycards
  const hidingList = Array.isArray(safeOptions.hidingSpots)
    ? safeOptions.hidingSpots
    : maze.hidingSpots

  const excludedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
  ])
  addExcludedCellList(excludedKeys, hazardList)
  addExcludedCellList(excludedKeys, collectibleSource?.items)
  addExcludedCellList(excludedKeys, collectibleSource?.coins)
  addExcludedCellList(excludedKeys, collectibleSource?.powerUps)
  addExcludedCellList(excludedKeys, keycardList)
  addExcludedCellList(excludedKeys, hidingList)
  addExcludedCellList(excludedKeys, safeOptions.excludedCells)

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key)) return
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return
    if (dist < 1) return
    const wallNeighbors = getValidWallNeighbors(maze.grid, row, col)
    if (wallNeighbors.length === 0) return
    candidates.push({ key, row, col, dist, wallNeighbors })
  })

  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
  const shuffledCandidates = shuffleWithRng(candidates, rng)

  const placedProps = []
  const usedKeys = new Set()
  const placedByType = Object.fromEntries(enabledTypes.map((t) => [t, 0]))
  const prefStats = {}
  const placementPreferences = safeOptions.placementPreferences || {}
  const allowFallback = Boolean(safeOptions.allowFallback)
  const failures = []

  for (const t of enabledTypes) {
    prefStats[t] = {
      preference: placementPreferences[t] || safeOptions.placementPreference || 'auto',
      requested: requestedByType[t] || 0,
      achievedCount: 0,
      fallbackCount: 0,
      failedCount: 0,
    }
  }

  const staticEntities = [
    ...hazardList,
    ...(keycardList || []),
    ...(collectibleSource?.items || []),
    ...(hidingList || []),
  ]

  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const startKey = `${maze.start.row},${maze.start.col}`
  const exitKey = `${maze.exit.row},${maze.exit.col}`

  // Handle explicit manual placements first with structured validation & origin tracking
  for (let i = 0; i < explicitPlacements.length; i += 1) {
    const req = explicitPlacements[i]
    if (!req || !req.type || !Number.isInteger(req.row) || !Number.isInteger(req.col)) {
      failures.push({
        type: req?.type || null,
        row: req?.row,
        col: req?.col,
        manualId: req?.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'invalid_manual_coordinates',
      })
      continue
    }
    if (perTypeQuantities[req.type] === 0) {
      failures.push({
        type: req.type,
        row: req.row,
        col: req.col,
        manualId: req.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'quantity_zero_conflict',
      })
      continue
    }
    const key = `${req.row},${req.col}`
    if (req.row < 0 || req.row >= rows || req.col < 0 || req.col >= cols) {
      failures.push({
        type: req.type,
        row: req.row,
        col: req.col,
        manualId: req.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'out_of_bounds',
      })
      continue
    }
    if (key === startKey || key === exitKey) {
      failures.push({
        type: req.type,
        row: req.row,
        col: req.col,
        manualId: req.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'start_or_exit_cell',
      })
      continue
    }
    if (maze.grid[req.row]?.[req.col] !== CELL_TYPES.PATH) {
      failures.push({
        type: req.type,
        row: req.row,
        col: req.col,
        manualId: req.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'wall_cell',
      })
      continue
    }
    if (usedKeys.has(key)) {
      failures.push({
        type: req.type,
        row: req.row,
        col: req.col,
        manualId: req.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'duplicate_manual_coordinate',
      })
      continue
    }
    if (excludedKeys.has(key)) {
      failures.push({
        type: req.type,
        row: req.row,
        col: req.col,
        manualId: req.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'entity_collision',
      })
      continue
    }
    const wallNeighbors = getValidWallNeighbors(maze.grid, req.row, req.col)
    if (wallNeighbors.length === 0) {
      failures.push({
        type: req.type,
        row: req.row,
        col: req.col,
        manualId: req.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'no_adjacent_wall',
      })
      continue
    }
    const built = tryBuildPropPlacement(
      maze.grid,
      req.row,
      req.col,
      req.type,
      wallNeighbors,
      rng,
      placedProps,
      `prop-${req.type}-${req.row}-${req.col}-${placedProps.length}`
    )
    if (!built) {
      failures.push({
        type: req.type,
        row: req.row,
        col: req.col,
        manualId: req.id || null,
        isManual: true,
        placementOrigin: 'manual',
        stage: 'manual_validation',
        reason: 'no_valid_wall_clearance',
      })
      continue
    }

    built.descriptor.isManual = true
    built.descriptor.placementOrigin = 'manual'
    built.descriptor.manualId = req.id || null
    built.descriptor.placementPreference =
      req.placementPreference || placementPreferences[req.type] || 'manual'

    placedProps.push(built)
    usedKeys.add(key)
    placedByType[req.type] = (placedByType[req.type] || 0) + 1
    if (!enabledTypes.includes(req.type)) {
      enabledTypes.push(req.type)
    }
    const remIdx = targetSlots.indexOf(req.type)
    if (remIdx !== -1) {
      targetSlots.splice(remIdx, 1)
    } else {
      requestedByType[req.type] = (requestedByType[req.type] || 0) + 1
    }
    if (!prefStats[req.type]) {
      prefStats[req.type] = {
        preference: built.descriptor.placementPreference,
        requested: requestedByType[req.type] || 0,
        achievedCount: 0,
        fallbackCount: 0,
        failedCount: 0,
      }
    } else {
      prefStats[req.type].requested = requestedByType[req.type] || 0
    }
    prefStats[req.type].achievedCount += 1
  }

  for (let sIdx = 0; sIdx < targetSlots.length; sIdx += 1) {
    const propType = targetSlots[sIdx]
    const pref = prefStats[propType].preference
    const available = shuffledCandidates.filter((c) => !usedKeys.has(c.key))

    let orderedPool = available
    let preferredCount = available.length
    let fallbackUsedFromSort = false
    let prefFailureReason = null

    if (pref !== 'auto') {
      const prefRes = sortCandidatesByPreference(available, pref, {
        grid: maze.grid,
        rows: maze.rows ?? maze.grid.length,
        cols: maze.cols ?? maze.grid[0]?.length,
        start: maze.start,
        exit: maze.exit,
        maxDistance: reachInfo.maxDistance,
        placedInstances: placedProps
          .filter((p) => p.descriptor.type === propType)
          .map((p) => p.descriptor),
        allEntities: [
          ...staticEntities,
          ...placedProps.map((p) => p.descriptor),
        ],
        allowFallback,
      })
      orderedPool = prefRes.sortedCandidates
      preferredCount = prefRes.preferredCount
      fallbackUsedFromSort = prefRes.fallbackUsed
      prefFailureReason = prefRes.reason || null
    }

    if (orderedPool.length === 0) {
      prefStats[propType].failedCount += 1
      failures.push({
        type: propType,
        isManual: false,
        placementOrigin: 'automatic',
        stage: 'preference_placement',
        reason: prefFailureReason || 'insufficient_valid_walled_cells',
      })
      continue
    }

    let builtEntry = null
    let builtIndex = 0
    for (let cIdx = 0; cIdx < orderedPool.length; cIdx += 1) {
      const candidate = orderedPool[cIdx]
      const built = tryBuildPropPlacement(
        maze.grid,
        candidate.row,
        candidate.col,
        propType,
        candidate.wallNeighbors,
        rng,
        placedProps,
        `prop-${propType}-${candidate.row}-${candidate.col}-${placedProps.length}`
      )
      if (built) {
        builtEntry = { built, key: candidate.key }
        builtIndex = cIdx
        break
      }
    }

    if (!builtEntry) {
      prefStats[propType].failedCount += 1
      failures.push({
        type: propType,
        isManual: false,
        placementOrigin: 'automatic',
        stage: 'wall_clearance',
        reason: 'no_valid_wall_clearance',
      })
      continue
    }

    builtEntry.built.descriptor.isManual = false
    builtEntry.built.descriptor.placementOrigin = 'automatic'
    builtEntry.built.descriptor.manualId = null
    builtEntry.built.descriptor.placementPreference = pref

    usedKeys.add(builtEntry.key)
    placedProps.push(builtEntry.built)
    placedByType[propType] = (placedByType[propType] || 0) + 1
    if (pref !== 'auto' && (fallbackUsedFromSort || builtIndex >= preferredCount)) {
      prefStats[propType].fallbackCount += 1
    } else {
      prefStats[propType].achievedCount += 1
    }
  }

  const missingByType = {}
  let placedTotal = 0
  let missingTotal = 0
  let requestedTotal = 0
  const preferencesByType = {}

  for (const t of enabledTypes) {
    const req = requestedByType[t] || 0
    const plc = placedByType[t] || 0
    const mis = Math.max(0, req - plc)
    requestedTotal += req
    placedTotal += plc
    missingByType[t] = mis
    missingTotal += mis

    const stat = prefStats[t]
    preferencesByType[t] = {
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

  return {
    props: placedProps.map((item) => item.descriptor),
    report: {
      requestedTotal,
      placedTotal,
      missingTotal,
      requestedByType,
      placedByType,
      missingByType,
      preferencesByType,
      failures,
      fullySatisfied: missingTotal === 0 && failures.length === 0,
    },
  }
}
