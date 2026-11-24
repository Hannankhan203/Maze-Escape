import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { placeHazards } from './hazardPlacement.js'
import { placeHidingSpots } from './hidingSpotPlacement.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

export const STANDARD_KEYCARD_COUNT = 2

export const KEYCARD_TYPE = 'resonance_keycard'

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

/**
 * Places deterministic, reachable Resonance Keycards across the maze using the
 * seeded RNG while strictly excluding walls, start, exit, hazards, and hiding spots.
 */
export function placeKeycards(maze, options = {}) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return []
  }

  const targetCount =
    Number.isInteger(options?.count) && options.count >= 0
      ? options.count
      : STANDARD_KEYCARD_COUNT

  if (targetCount === 0) {
    return []
  }

  const rng = createRng(`${maze.seed}-keycards`)
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 2) {
    return []
  }

  const hazardList = Array.isArray(options?.hazards)
    ? options.hazards
    : Array.isArray(maze.hazards)
      ? maze.hazards
      : placeHazards(maze)

  const hidingSpotList = Array.isArray(options?.hidingSpots)
    ? options.hidingSpots
    : Array.isArray(maze.hidingSpots)
      ? maze.hidingSpots
      : placeHidingSpots(maze, { hazards: hazardList })

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

  // Softly avoid explicitly provided items when ample cells exist
  const softAvoidKeys = new Set()
  const collectibleSource = options?.collectibles || null
  const itemList = Array.isArray(collectibleSource?.items)
    ? collectibleSource.items
    : []
  const coinList = Array.isArray(collectibleSource?.coins)
    ? collectibleSource.coins
    : []
  const powerUpList = Array.isArray(collectibleSource?.powerUps)
    ? collectibleSource.powerUps
    : []

  for (let i = 0; i < itemList.length; i += 1) {
    const item = itemList[i]
    if (Number.isInteger(item?.row) && Number.isInteger(item?.col)) {
      softAvoidKeys.add(`${item.row},${item.col}`)
    }
  }
  for (let i = 0; i < coinList.length; i += 1) {
    const c = coinList[i]
    if (Number.isInteger(c?.row) && Number.isInteger(c?.col)) {
      softAvoidKeys.add(`${c.row},${c.col}`)
    }
  }
  for (let i = 0; i < powerUpList.length; i += 1) {
    const pu = powerUpList[i]
    if (Number.isInteger(pu?.row) && Number.isInteger(pu?.col)) {
      softAvoidKeys.add(`${pu.row},${pu.col}`)
    }
  }

  const strictValidFar = []
  const strictValidAll = []
  const preferredPool = []

  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key)) return
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return

    const candidate = { key, row, col, dist }
    strictValidAll.push(candidate)
    if (dist >= 2) {
      strictValidFar.push(candidate)
      if (!softAvoidKeys.has(key)) {
        preferredPool.push(candidate)
      }
    }
  })

  let pool =
    preferredPool.length >= targetCount
      ? preferredPool
      : strictValidFar.length >= targetCount
        ? strictValidFar
        : strictValidAll

  if (pool.length === 0) {
    return []
  }

  pool = [...pool].sort(
    (a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col
  )

  const actualCount = Math.min(targetCount, pool.length)
  const usedKeys = new Set()
  const chosenSlots = []

  // Stratify across distance bands so keycards spread through the maze
  const bucketSize = Math.max(1, Math.floor(pool.length / actualCount))
  for (let i = 0; i < actualCount; i += 1) {
    const startIdx = i * bucketSize
    const endIdx = i === actualCount - 1 ? pool.length : (i + 1) * bucketSize
    const bucket = shuffleWithRng(pool.slice(startIdx, endIdx), rng)
    const picked =
      bucket.find((c) => !usedKeys.has(c.key)) ||
      shuffleWithRng(pool, rng).find((c) => !usedKeys.has(c.key))

    if (picked) {
      usedKeys.add(picked.key)
      chosenSlots.push(picked)
    }
  }

  return chosenSlots.map((slot, idx) => ({
    id: `keycard-${slot.row}-${slot.col}`,
    type: KEYCARD_TYPE,
    index: idx,
    label: `Node ${String.fromCharCode(65 + idx)}`,
    row: slot.row,
    col: slot.col,
  }))
}
