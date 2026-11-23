import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import { normalizeMazeDifficulty } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

const PLACEMENT_COUNTS = {
  easy: {
    items: [
      COLLECTIBLE_TYPES.ECHO_REVEAL,
      COLLECTIBLE_TYPES.HEALTH_CAPSULE,
      COLLECTIBLE_TYPES.SOUL_SHARDS,
    ],
  },
  medium: {
    items: [
      COLLECTIBLE_TYPES.ECHO_REVEAL,
      COLLECTIBLE_TYPES.HEALTH_CAPSULE,
      COLLECTIBLE_TYPES.SOUL_SHARDS,
      COLLECTIBLE_TYPES.SPECTRAL_COMPASS,
    ],
  },
  hard: {
    items: [
      COLLECTIBLE_TYPES.ECHO_REVEAL,
      COLLECTIBLE_TYPES.ECHO_REVEAL,
      COLLECTIBLE_TYPES.HEALTH_CAPSULE,
      COLLECTIBLE_TYPES.SOUL_SHARDS,
      COLLECTIBLE_TYPES.SPECTRAL_COMPASS,
      COLLECTIBLE_TYPES.ENERGY_CELL,
    ],
  },
  hardcore: {
    items: [
      COLLECTIBLE_TYPES.ECHO_REVEAL,
      COLLECTIBLE_TYPES.ECHO_REVEAL,
      COLLECTIBLE_TYPES.HEALTH_CAPSULE,
      COLLECTIBLE_TYPES.HEALTH_CAPSULE,
      COLLECTIBLE_TYPES.SOUL_SHARDS,
      COLLECTIBLE_TYPES.SPECTRAL_COMPASS,
      COLLECTIBLE_TYPES.ENERGY_CELL,
      COLLECTIBLE_TYPES.SPIRIT_LANTERN,
    ],
  },
}

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

/**
 * Places deterministic, non-overlapping architectural collectibles and power-ups
 * on reachable walkable maze tiles while avoiding the start and exit positions.
 */
export function placeCollectibles(maze) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return { items: [] }
  }

  const diffKey = normalizeMazeDifficulty(maze.difficulty)
  const presetCounts =
    PLACEMENT_COUNTS[diffKey] || PLACEMENT_COUNTS.medium
  const rng = createRng(`${maze.seed}-${diffKey}-collectibles-v2`)

  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 2) {
    return { items: [] }
  }

  const startKey = `${maze.start.row},${maze.start.col}`
  const exitKey = `${maze.exit.row},${maze.exit.col}`

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (key === startKey || key === exitKey) return
    const { row, col } = parseKey(key)
    candidates.push({ key, row, col, dist })
  })

  if (candidates.length === 0) {
    return { items: [] }
  }

  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)

  const usedKeys = new Set()
  const items = []

  const midStart = Math.min(2, Math.floor(candidates.length * 0.15))
  const pool = shuffleWithRng(candidates.slice(midStart), rng)

  for (let i = 0; i < presetCounts.items.length; i += 1) {
    const type = presetCounts.items[i]
    const slot = pool.find((cell) => !usedKeys.has(cell.key))
    if (!slot) break

    usedKeys.add(slot.key)
    items.push({
      id: `item-${type}-${slot.row}-${slot.col}`,
      type,
      row: slot.row,
      col: slot.col,
    })
  }

  return { items }
}
