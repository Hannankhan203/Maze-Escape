import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { placeHazards } from './hazardPlacement.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

export const STANDARD_KEYCARD_COUNT = 2

export const KEYCARD_TYPE = 'resonance_keycard'

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

function makeEmptyReport({
  requestedCount = 0,
  placedCount = 0,
  candidateCellCount = 0,
  failures = [],
  fullySatisfied = true,
} = {}) {
  const missingCount = Math.max(0, requestedCount - placedCount)
  return {
    category: KEYCARD_TYPE,
    allocatedCount: requestedCount,
    requestedCount,
    placedCount,
    requiredCount: placedCount,
    missingCount,
    shortfallCount: missingCount,
    hadShortfall: missingCount > 0,
    candidateCellCount,
    failures,
    fullySatisfied,
  }
}

/**
 * Places deterministic, reachable Resonance Keycards across the maze using an
 * isolated seeded RNG while strictly excluding walls, start, exit, hazards,
 * and occupied collectible locations.
 * Returns both the placed keycard array and a structured placement report.
 */
export function placeKeycardsWithReport(maze, options = {}) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return {
      keycards: [],
      report: makeEmptyReport({
        requestedCount: 0,
        placedCount: 0,
        candidateCellCount: 0,
        failures: [
          {
            category: KEYCARD_TYPE,
            requested: 0,
            placed: 0,
            missing: 0,
            reason: 'invalid_maze_structure',
          },
        ],
        fullySatisfied: true,
      }),
    }
  }

  const targetCount =
    Number.isInteger(options?.count) && options.count >= 0
      ? options.count
      : Number.isInteger(options?.collectibleAllocation?.keycardCount) &&
          options.collectibleAllocation.keycardCount >= 0
        ? options.collectibleAllocation.keycardCount
        : Number.isInteger(maze?.collectibleAllocation?.keycardCount) &&
            maze.collectibleAllocation.keycardCount >= 0
          ? maze.collectibleAllocation.keycardCount
          : STANDARD_KEYCARD_COUNT

  if (targetCount === 0) {
    return {
      keycards: [],
      report: makeEmptyReport({
        requestedCount: 0,
        placedCount: 0,
        candidateCellCount: 0,
        failures: [],
        fullySatisfied: true,
      }),
    }
  }

  const rng = createRng(`${maze.seed}-keycards`)
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 2) {
    return {
      keycards: [],
      report: makeEmptyReport({
        requestedCount: targetCount,
        placedCount: 0,
        candidateCellCount: 0,
        failures: [
          {
            category: KEYCARD_TYPE,
            requested: targetCount,
            placed: 0,
            missing: targetCount,
            reason: 'insufficient_reachable_cells',
          },
        ],
        fullySatisfied: false,
      }),
    }
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

  // Strictly exclude occupied collectible locations when collectibles are provided
  // or when placing keycards onto a pre-populated collectibles maze without keycards.
  const collectibleSource =
    options?.collectibles || (!Array.isArray(maze.keycards) ? maze.collectibles : null)
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
      excludedKeys.add(`${item.row},${item.col}`)
    }
  }
  for (let i = 0; i < coinList.length; i += 1) {
    const c = coinList[i]
    if (Number.isInteger(c?.row) && Number.isInteger(c?.col)) {
      excludedKeys.add(`${c.row},${c.col}`)
    }
  }
  for (let i = 0; i < powerUpList.length; i += 1) {
    const pu = powerUpList[i]
    if (Number.isInteger(pu?.row) && Number.isInteger(pu?.col)) {
      excludedKeys.add(`${pu.row},${pu.col}`)
    }
  }

  const strictValidFar = []
  const strictValidAll = []

  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key)) return
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return

    const candidate = { key, row, col, dist }
    strictValidAll.push(candidate)
    if (dist >= 2) {
      strictValidFar.push(candidate)
    }
  })

  let pool =
    strictValidFar.length >= targetCount ? strictValidFar : strictValidAll

  if (pool.length === 0) {
    return {
      keycards: [],
      report: makeEmptyReport({
        requestedCount: targetCount,
        placedCount: 0,
        candidateCellCount: 0,
        failures: [
          {
            category: KEYCARD_TYPE,
            requested: targetCount,
            placed: 0,
            missing: targetCount,
            reason: 'no_valid_candidate_cells',
          },
        ],
        fullySatisfied: false,
      }),
    }
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

  const keycards = chosenSlots.map((slot, idx) => ({
    id: `keycard-${slot.row}-${slot.col}`,
    type: KEYCARD_TYPE,
    index: idx,
    label: idx < 26 ? `Node ${String.fromCharCode(65 + idx)}` : `Node ${idx + 1}`,
    row: slot.row,
    col: slot.col,
  }))

  const missingCount = Math.max(0, targetCount - keycards.length)
  const failures =
    missingCount > 0
      ? [
          {
            category: KEYCARD_TYPE,
            requested: targetCount,
            placed: keycards.length,
            missing: missingCount,
            reason: 'insufficient_valid_cells',
          },
        ]
      : []

  return {
    keycards,
    report: makeEmptyReport({
      requestedCount: targetCount,
      placedCount: keycards.length,
      candidateCellCount: pool.length,
      failures,
      fullySatisfied: missingCount === 0,
    }),
  }
}

/**
 * Places deterministic, reachable Resonance Keycards across the maze using the
 * seeded RNG while strictly excluding walls, start, exit, and hazards.
 */
export function placeKeycards(maze, options = {}) {
  return placeKeycardsWithReport(maze, options).keycards
}
