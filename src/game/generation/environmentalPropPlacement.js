import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { CELL_TYPES, normalizeMazeDifficulty } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

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
  { type: PROP_TYPES.ELECTRICAL_PANEL, weight: 3 },
  { type: PROP_TYPES.DEBRIS_PILE, weight: 4 },
]

function pickWeightedProp(rng) {
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

const CARDINAL_DIRS = [
  { name: 'north', dRow: -1, dCol: 0, wallDx: 0, wallDz: -1.45, yaw: 0 },
  { name: 'south', dRow: 1, dCol: 0, wallDx: 0, wallDz: 1.45, yaw: Math.PI },
  { name: 'west', dRow: 0, dCol: -1, wallDx: -1.45, wallDz: 0, yaw: Math.PI / 2 },
  { name: 'east', dRow: 0, dCol: 1, wallDx: 1.45, wallDz: 0, yaw: -Math.PI / 2 },
]

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

function resolveWallSide(grid, row, col) {
  const rows = grid.length
  const cols = grid[0].length
  const wallNeighbors = []

  for (let i = 0; i < CARDINAL_DIRS.length; i += 1) {
    const dir = CARDINAL_DIRS[i]
    const nr = row + dir.dRow
    const nc = col + dir.dCol
    const isWall =
      nr < 0 ||
      nr >= rows ||
      nc < 0 ||
      nc >= cols ||
      grid[nr][nc] === CELL_TYPES.WALL

    if (isWall) {
      wallNeighbors.push(dir)
    }
  }

  if (wallNeighbors.length > 0) {
    return wallNeighbors[0]
  }
  return CARDINAL_DIRS[0]
}

/**
 * Places procedural environmental props deterministically across reachable path cells,
 * with irregular clusters, priority office furniture, and safe wall-tucked positioning.
 */
export function placeEnvironmentalProps(maze, options = {}) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return []
  }

  const diffKey = normalizeMazeDifficulty(maze.difficulty)
  const density = options?.density || (diffKey === 'easy' ? 'light' : diffKey === 'hardcore' ? 'heavy' : 'medium')
  const targetCount =
    Number.isInteger(options?.count) && options.count >= 0
      ? options.count
      : PROP_COUNTS_BY_DENSITY[density] || PROP_COUNTS_BY_DENSITY.medium

  if (targetCount === 0) {
    return []
  }

  const rng = createRng(`${maze.seed ?? 0}-${diffKey}-props-${density}`)
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 2) {
    return []
  }

  const excludedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
  ])

  const hazards = Array.isArray(options?.hazards) ? options.hazards : maze.hazards || []
  for (let i = 0; i < hazards.length; i += 1) {
    const h = hazards[i]
    if (Number.isInteger(h?.row) && Number.isInteger(h?.col)) {
      excludedKeys.add(`${h.row},${h.col}`)
    }
  }

  const hidingSpots = Array.isArray(options?.hidingSpots) ? options.hidingSpots : maze.hidingSpots || []
  for (let i = 0; i < hidingSpots.length; i += 1) {
    const s = hidingSpots[i]
    if (Number.isInteger(s?.row) && Number.isInteger(s?.col)) {
      excludedKeys.add(`${s.row},${s.col}`)
    }
  }

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key)) return
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return
    candidates.push({ key, row, col, dist })
  })

  if (candidates.length === 0) {
    return []
  }

  const shuffled = shuffleWithRng(candidates, rng)
  const props = []
  const usedKeys = new Set()

  for (let i = 0; i < targetCount; i += 1) {
    const candidate = shuffled.find((c) => !usedKeys.has(c.key))
    if (!candidate) break

    usedKeys.add(candidate.key)
    const propType = pickWeightedProp(rng)
    const wallSide = resolveWallSide(maze.grid, candidate.row, candidate.col)

    const jitterX = (rng() - 0.5) * 0.35
    const jitterZ = (rng() - 0.5) * 0.35
    const rotationYaw = wallSide.yaw + (rng() - 0.5) * 0.5
    const scaleVar = 0.92 + rng() * 0.22

    let offsetX = wallSide.wallDx !== 0 ? wallSide.wallDx + jitterX : jitterX
    let offsetZ = wallSide.wallDz !== 0 ? wallSide.wallDz + jitterZ : jitterZ

    props.push({
      id: `prop-${propType}-${candidate.row}-${candidate.col}-${i}`,
      type: propType,
      row: candidate.row,
      col: candidate.col,
      offsetX,
      offsetZ,
      rotationYaw,
      scale: scaleVar,
    })

    // Clustered secondary prop (45% chance to place a companion prop nearby if space permits)
    if (rng() < 0.45 && props.length < targetCount) {
      const neighborCandidates = [
        { dRow: -1, dCol: 0 },
        { dRow: 1, dCol: 0 },
        { dRow: 0, dCol: -1 },
        { dRow: 0, dCol: 1 },
      ]
      const nDir = neighborCandidates[Math.floor(rng() * neighborCandidates.length)]
      const nr = candidate.row + nDir.dRow
      const nc = candidate.col + nDir.dCol
      const nKey = `${nr},${nc}`
      if (
        nr >= 0 &&
        nr < maze.grid.length &&
        nc >= 0 &&
        nc < maze.grid[0].length &&
        maze.grid[nr][nc] === CELL_TYPES.PATH &&
        !excludedKeys.has(nKey) &&
        !usedKeys.has(nKey)
      ) {
        usedKeys.add(nKey)
        const secondaryType = pickWeightedProp(rng)
        const nWallSide = resolveWallSide(maze.grid, nr, nc)
        props.push({
          id: `prop-cluster-${secondaryType}-${nr}-${nc}-${i}`,
          type: secondaryType,
          row: nr,
          col: nc,
          offsetX: nWallSide.wallDx + (rng() - 0.5) * 0.3,
          offsetZ: nWallSide.wallDz + (rng() - 0.5) * 0.3,
          rotationYaw: nWallSide.yaw + (rng() - 0.5) * 0.8,
          scale: 0.88 + rng() * 0.2,
        })
      }
    }
  }

  return props
}
