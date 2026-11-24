import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { exploreReachableCells } from './pathfinder.js'

export const HAZARD_TYPES = {
  FLOOR_SPIKES: 'floor_spikes',
  PRESSURE_PLATE: 'pressure_plate',
  ELECTRIC_GRID: 'electric_grid',
  CEILING_COLLAPSE: 'ceiling_collapse',
}

const STANDARD_HAZARD_COUNT = 6

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
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
    HAZARD_TYPES.FLOOR_SPIKES,
    HAZARD_TYPES.PRESSURE_PLATE,
    HAZARD_TYPES.ELECTRIC_GRID,
    HAZARD_TYPES.CEILING_COLLAPSE,
  ]

  const actualCount = Math.min(targetCount, shuffled.length)
  const chosen = shuffled.slice(0, actualCount)

  return chosen.map((cell, idx) => ({
    id: `hazard-${cell.row}-${cell.col}`,
    type: types[idx % types.length],
    row: cell.row,
    col: cell.col,
    active: true,
  }))
}
