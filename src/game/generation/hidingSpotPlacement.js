import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { placeHazards } from './hazardPlacement.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

export const HIDING_SPOT_TYPES = {
  CONTAINMENT_LOCKER: 'containment_locker',
  SUPPLY_CABINET: 'supply_cabinet',
}

const STANDARD_HIDING_SPOT_COUNT = 6

const CARDINAL_DIRS = [
  { name: 'north', dRow: -1, dCol: 0, yaw: 0 }, // looking -Z
  { name: 'south', dRow: 1, dCol: 0, yaw: Math.PI }, // looking +Z
  { name: 'west', dRow: 0, dCol: -1, yaw: Math.PI / 2 }, // looking -X
  { name: 'east', dRow: 0, dCol: 1, yaw: -Math.PI / 2 }, // looking +X
]

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

/**
 * Picks an outward-facing yaw and wall-side offset for a hiding spot so it sits
 * tucked against an adjacent wall facing an open walkable corridor when possible.
 */
function resolveOrientation(grid, row, col) {
  const rows = grid.length
  const cols = grid[0].length

  for (let i = 0; i < CARDINAL_DIRS.length; i += 1) {
    const front = CARDINAL_DIRS[i]
    const frontR = row + front.dRow
    const frontC = col + front.dCol
    const backR = row - front.dRow
    const backC = col - front.dCol

    const frontIsPath =
      frontR >= 0 &&
      frontR < rows &&
      frontC >= 0 &&
      frontC < cols &&
      grid[frontR][frontC] === CELL_TYPES.PATH
    const backIsWall =
      backR < 0 ||
      backR >= rows ||
      backC < 0 ||
      backC >= cols ||
      grid[backR][backC] === CELL_TYPES.WALL

    if (frontIsPath && backIsWall) {
      return {
        facingYaw: front.yaw,
        offsetDir: { dRow: -front.dRow, dCol: -front.dCol },
      }
    }
  }

  for (let i = 0; i < CARDINAL_DIRS.length; i += 1) {
    const front = CARDINAL_DIRS[i]
    const frontR = row + front.dRow
    const frontC = col + front.dCol
    if (
      frontR >= 0 &&
      frontR < rows &&
      frontC >= 0 &&
      frontC < cols &&
      grid[frontR][frontC] === CELL_TYPES.PATH
    ) {
      return {
        facingYaw: front.yaw,
        offsetDir: { dRow: 0, dCol: 0 },
      }
    }
  }

  return {
    facingYaw: 0,
    offsetDir: { dRow: 0, dCol: 0 },
  }
}

/**
 * Places deterministic, non-overlapping hiding spots on reachable walkable maze
 * tiles while strictly excluding walls, start, exit, and environmental hazards.
 */
export function placeHidingSpots(maze, options = {}) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return []
  }

  const targetCount =
    Number.isInteger(options?.count) && options.count >= 0
      ? options.count
      : STANDARD_HIDING_SPOT_COUNT

  if (targetCount === 0) {
    return []
  }

  const rng = createRng(`${maze.seed}-hiding-spots`)
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 3) {
    return []
  }

  const hazardList = Array.isArray(options?.hazards)
    ? options.hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : placeHazards(maze)

  const excludedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
  ])

  for (let i = 0; i < hazardList.length; i += 1) {
    const h = hazardList[i]
    if (Number.isInteger(h?.row) && Number.isInteger(h?.col)) {
      excludedKeys.add(`${h.row},${h.col}`)
    }
  }

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key)) return
    if (dist < 2) return
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return
    candidates.push({ key, row, col, dist })
  })

  if (candidates.length === 0) {
    return []
  }

  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
  const shuffled = shuffleWithRng(candidates, rng)
  const types = [
    HIDING_SPOT_TYPES.CONTAINMENT_LOCKER,
    HIDING_SPOT_TYPES.SUPPLY_CABINET,
  ]

  const spots = []
  const usedKeys = new Set()

  for (let i = 0; i < targetCount; i += 1) {
    const candidate = shuffled.find((c) => !usedKeys.has(c.key))
    if (!candidate) break

    usedKeys.add(candidate.key)
    const spotType = types[i % types.length]
    const orientation = resolveOrientation(maze.grid, candidate.row, candidate.col)

    spots.push({
      id: `hide-${spotType}-${candidate.row}-${candidate.col}`,
      type: spotType,
      row: candidate.row,
      col: candidate.col,
      facingYaw: orientation.facingYaw,
      offsetDir: orientation.offsetDir,
    })
  }

  return spots
}
