import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { POWERUP_TYPES } from '../mechanics/powerups.js'
import { normalizeMazeDifficulty } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

const PLACEMENT_COUNTS = {
  easy: {
    coins: 6,
    powerUps: [
      POWERUP_TYPES.WALL_PASS,
      POWERUP_TYPES.ECHO_REVEAL,
      POWERUP_TYPES.COIN_MAGNET,
    ],
  },
  medium: {
    coins: 12,
    powerUps: [
      POWERUP_TYPES.WALL_PASS,
      POWERUP_TYPES.WALL_PASS,
      POWERUP_TYPES.ECHO_REVEAL,
      POWERUP_TYPES.COIN_MAGNET,
    ],
  },
  hard: {
    coins: 20,
    powerUps: [
      POWERUP_TYPES.WALL_PASS,
      POWERUP_TYPES.WALL_PASS,
      POWERUP_TYPES.ECHO_REVEAL,
      POWERUP_TYPES.ECHO_REVEAL,
      POWERUP_TYPES.COIN_MAGNET,
      POWERUP_TYPES.COIN_MAGNET,
    ],
  },
  hardcore: {
    coins: 32,
    powerUps: [
      POWERUP_TYPES.WALL_PASS,
      POWERUP_TYPES.WALL_PASS,
      POWERUP_TYPES.WALL_PASS,
      POWERUP_TYPES.ECHO_REVEAL,
      POWERUP_TYPES.ECHO_REVEAL,
      POWERUP_TYPES.ECHO_REVEAL,
      POWERUP_TYPES.COIN_MAGNET,
      POWERUP_TYPES.COIN_MAGNET,
    ],
  },
}

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

/**
 * Places deterministic, non-overlapping coins and power-ups on reachable
 * walkable maze tiles while avoiding the start and exit positions.
 */
export function placeCollectibles(maze) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return { coins: [], powerUps: [] }
  }

  const diffKey = normalizeMazeDifficulty(maze.difficulty)
  const presetCounts =
    PLACEMENT_COUNTS[diffKey] || PLACEMENT_COUNTS.medium
  const rng = createRng(`${maze.seed}-${diffKey}-collectibles`)

  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 2) {
    return { coins: [], powerUps: [] }
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
    return { coins: [], powerUps: [] }
  }

  // Sort by distance then stratify across distance bands for fair spread
  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)

  const usedKeys = new Set()
  const powerUps = []

  // Place power-ups in mid-to-outer bands (excluding immediate start tile)
  const midStart = Math.min(2, Math.floor(candidates.length * 0.15))
  const powerUpPool = shuffleWithRng(candidates.slice(midStart), rng)

  for (let i = 0; i < presetCounts.powerUps.length; i += 1) {
    const type = presetCounts.powerUps[i]
    const slot = powerUpPool.find((cell) => !usedKeys.has(cell.key))
    if (!slot) break

    usedKeys.add(slot.key)
    powerUps.push({
      id: `pu-${type}-${slot.row}-${slot.col}`,
      type,
      row: slot.row,
      col: slot.col,
    })
  }

  // Distribute coins fairly across equal distance buckets
  const remaining = candidates.filter((cell) => !usedKeys.has(cell.key))
  const targetCoins = Math.min(presetCounts.coins, remaining.length)
  const coins = []

  if (targetCoins > 0) {
    const bucketCount = Math.min(4, targetCoins)
    const bucketSize = Math.ceil(remaining.length / bucketCount)
    const buckets = Array.from({ length: bucketCount }, (_, idx) =>
      shuffleWithRng(
        remaining.slice(idx * bucketSize, (idx + 1) * bucketSize),
        rng
      )
    )

    let bucketIndex = 0
    let safety = 0
    while (coins.length < targetCoins && safety < remaining.length * 2) {
      const bucket = buckets[bucketIndex % bucketCount]
      bucketIndex += 1
      safety += 1

      const nextCell = bucket.find((cell) => !usedKeys.has(cell.key))
      if (!nextCell) continue

      usedKeys.add(nextCell.key)
      coins.push({
        id: `coin-${nextCell.row}-${nextCell.col}`,
        row: nextCell.row,
        col: nextCell.col,
      })
    }
  }

  return { coins, powerUps }
}
