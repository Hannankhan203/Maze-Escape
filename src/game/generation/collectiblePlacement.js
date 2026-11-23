import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import { normalizeMazeDifficulty } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'
import { placeHazards } from './hazardPlacement.js'
import { placeHidingSpots } from './hidingSpotPlacement.js'
import { placeKeycards } from './keycardPlacement.js'

export const COLLECTIBLE_SPAWN_COUNTS = {
  easy: {
    [COLLECTIBLE_TYPES.HEALTH_CAPSULE]: 1,
    [COLLECTIBLE_TYPES.ENERGY_CELL]: 1,
    [COLLECTIBLE_TYPES.ECHO_REVEAL]: 1,
    [COLLECTIBLE_TYPES.SOUL_SHARDS]: 6,
  },
  medium: {
    [COLLECTIBLE_TYPES.HEALTH_CAPSULE]: 2,
    [COLLECTIBLE_TYPES.ENERGY_CELL]: 2,
    [COLLECTIBLE_TYPES.ECHO_REVEAL]: 1,
    [COLLECTIBLE_TYPES.SOUL_SHARDS]: 10,
  },
  hard: {
    [COLLECTIBLE_TYPES.HEALTH_CAPSULE]: 3,
    [COLLECTIBLE_TYPES.ENERGY_CELL]: 3,
    [COLLECTIBLE_TYPES.ECHO_REVEAL]: 2,
    [COLLECTIBLE_TYPES.SOUL_SHARDS]: 16,
  },
  hardcore: {
    [COLLECTIBLE_TYPES.HEALTH_CAPSULE]: 4,
    [COLLECTIBLE_TYPES.ENERGY_CELL]: 4,
    [COLLECTIBLE_TYPES.ECHO_REVEAL]: 2,
    [COLLECTIBLE_TYPES.SOUL_SHARDS]: 24,
  },
}

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

/**
 * Builds the sequence of items to place based on difficulty preset counts.
 */
function buildTargetItemTypes(spawnCounts) {
  const types = []
  if (!spawnCounts) return types

  // Core survival order: Echo Reveal, Health Capsules, Energy Cells, then Soul Shards
  const order = [
    COLLECTIBLE_TYPES.ECHO_REVEAL,
    COLLECTIBLE_TYPES.HEALTH_CAPSULE,
    COLLECTIBLE_TYPES.ENERGY_CELL,
    COLLECTIBLE_TYPES.SOUL_SHARDS,
  ]

  for (const type of order) {
    const count = spawnCounts[type] || 0
    for (let i = 0; i < count; i += 1) {
      types.push(type)
    }
  }

  return types
}

/**
 * Places deterministic, non-overlapping survival collectibles and Echo Reveal items
 * on reachable walkable maze tiles while strictly avoiding the start, exit,
 * hazards, hiding spots, and keycards.
 */
export function placeCollectibles(maze, options = {}) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return { items: [], coins: [], powerUps: [] }
  }

  const diffKey = normalizeMazeDifficulty(maze.difficulty)
  const spawnCounts =
    COLLECTIBLE_SPAWN_COUNTS[diffKey] || COLLECTIBLE_SPAWN_COUNTS.medium
  const targetTypes = buildTargetItemTypes(spawnCounts)
  const rng = createRng(`${maze.seed}-${diffKey}-collectibles-v2`)

  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 2) {
    return { items: [], coins: [], powerUps: [] }
  }

  const hazardList = Array.isArray(options?.hazards)
    ? options.hazards
    : Array.isArray(maze?.hazards)
      ? maze.hazards
      : typeof placeHazards === 'function'
        ? placeHazards(maze)
        : []

  const hidingSpotList = Array.isArray(options?.hidingSpots)
    ? options.hidingSpots
    : Array.isArray(maze?.hidingSpots)
      ? maze.hidingSpots
      : typeof placeHidingSpots === 'function'
        ? placeHidingSpots(maze, { hazards: hazardList })
        : []

  const keycardList = Array.isArray(options?.keycards)
    ? options.keycards
    : Array.isArray(maze?.keycards)
      ? maze.keycards
      : typeof placeKeycards === 'function'
        ? placeKeycards(maze, { hazards: hazardList, hidingSpots: hidingSpotList })
        : []

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

  for (let i = 0; i < hidingSpotList.length; i += 1) {
    const spot = hidingSpotList[i]
    if (Number.isInteger(spot?.row) && Number.isInteger(spot?.col)) {
      excludedKeys.add(`${spot.row},${spot.col}`)
    }
  }

  for (let i = 0; i < keycardList.length; i += 1) {
    const k = keycardList[i]
    if (Number.isInteger(k?.row) && Number.isInteger(k?.col)) {
      excludedKeys.add(`${k.row},${k.col}`)
    }
  }

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key)) return
    const { row, col } = parseKey(key)
    candidates.push({ key, row, col, dist })
  })

  if (candidates.length === 0) {
    return {
      items: [],
      coins: [],
      powerUps: [],
    }
  }

  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)

  const usedKeys = new Set()
  const items = []

  // Skip cells right next to start first to provide breathing room,
  // falling back to near-start valid candidates only if needed for tight mazes.
  const midStart = Math.min(2, Math.floor(candidates.length * 0.1))
  const preferredPool = shuffleWithRng(candidates.slice(midStart), rng)
  const fallbackPool = midStart > 0 ? shuffleWithRng(candidates.slice(0, midStart), rng) : []
  const pool = [...preferredPool, ...fallbackPool]

  for (let i = 0; i < targetTypes.length; i += 1) {
    const type = targetTypes[i]
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

  return {
    items,
    coins: [],
    powerUps: [],
  }
}
