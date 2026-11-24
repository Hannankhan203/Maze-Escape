import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { COLLECTIBLE_CONFIG, COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'
import { placeHazards } from './hazardPlacement.js'
import { placeHidingSpots } from './hidingSpotPlacement.js'
import { placeKeycards } from './keycardPlacement.js'

export const STANDARD_COLLECTIBLE_SPAWN_COUNTS = {
  [COLLECTIBLE_TYPES.HEALTH_CAPSULE]: 2,
  [COLLECTIBLE_TYPES.ENERGY_CELL]: 2,
  [COLLECTIBLE_TYPES.ECHO_REVEAL]: 1,
  [COLLECTIBLE_TYPES.SPECTRAL_COMPASS]: 1,
  [COLLECTIBLE_TYPES.PHANTOM_VEIL]: 2,
  [COLLECTIBLE_TYPES.WARDING_CHARM]: 1,
  [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 1,
  [COLLECTIBLE_TYPES.WATCHERS_EYE]: 1,
  [COLLECTIBLE_TYPES.ECHO_PULSE]: 1,
  [COLLECTIBLE_TYPES.SPIRIT_LANTERN]: 1,
  [COLLECTIBLE_TYPES.SOUL_SHARDS]: 10,
}

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

/**
 * Builds the sequence of items to place based on standard spawn counts.
 */
function buildTargetItemTypes(spawnCounts) {
  const types = []
  if (!spawnCounts) return types

  const order = [
    COLLECTIBLE_TYPES.ECHO_REVEAL,
    COLLECTIBLE_TYPES.HEALTH_CAPSULE,
    COLLECTIBLE_TYPES.ENERGY_CELL,
    COLLECTIBLE_TYPES.SPECTRAL_COMPASS,
    COLLECTIBLE_TYPES.PHANTOM_VEIL,
    COLLECTIBLE_TYPES.WARDING_CHARM,
    COLLECTIBLE_TYPES.TIME_FRAGMENT,
    COLLECTIBLE_TYPES.WATCHERS_EYE,
    COLLECTIBLE_TYPES.ECHO_PULSE,
    COLLECTIBLE_TYPES.SPIRIT_LANTERN,
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

  const spawnCounts = STANDARD_COLLECTIBLE_SPAWN_COUNTS
  const targetTypes = buildTargetItemTypes(spawnCounts)
  const rng = createRng(`${maze.seed}-collectibles-v2`)

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
        ? placeKeycards({ ...maze, hazards: hazardList, hidingSpots: hidingSpotList })
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
    const kc = keycardList[i]
    if (Number.isInteger(kc?.row) && Number.isInteger(kc?.col)) {
      excludedKeys.add(`${kc.row},${kc.col}`)
    }
  }

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key)) return
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return
    if (dist < 2) return
    candidates.push({ key, row, col, dist })
  })

  if (candidates.length === 0) {
    return { items: [], coins: [], powerUps: [] }
  }

  candidates.sort((a, b) => b.dist - a.dist || a.row - b.row || a.col - b.col)
  const shuffledCandidates = shuffleWithRng(candidates, rng)
  const usedKeys = new Set()
  const placedItems = []

  let shardCounter = 0
  let consumableCounter = 0

  for (let i = 0; i < targetTypes.length; i += 1) {
    const type = targetTypes[i]
    const chosen =
      shuffledCandidates.find((c) => !usedKeys.has(c.key)) ||
      candidates.find((c) => !usedKeys.has(c.key))

    if (!chosen) break
    usedKeys.add(chosen.key)

    const isShard = type === COLLECTIBLE_TYPES.SOUL_SHARDS
    const config = COLLECTIBLE_CONFIG[type] || {}

    if (isShard) {
      shardCounter += 1
      placedItems.push({
        id: `shard-${shardCounter}`,
        type,
        row: chosen.row,
        col: chosen.col,
        value: config.value || 1,
        label: config.label || type,
      })
    } else {
      consumableCounter += 1
      placedItems.push({
        id: `item-${consumableCounter}`,
        type,
        row: chosen.row,
        col: chosen.col,
        label: config.label || type,
      })
    }
  }

  return {
    items: placedItems,
    coins: [],
    powerUps: [],
  }
}
