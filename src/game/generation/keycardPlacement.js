import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { placeHazards } from './hazardPlacement.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'
import { sortCandidatesByPreference } from './placementPreferences.js'

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
  preferencesByCategory = {},
  keycardFailureReason = null,
} = {}) {
  const missingCount = Math.max(0, requestedCount - placedCount)
  return {
    category: KEYCARD_TYPE,
    allocatedCount: requestedCount,
    keycardTarget: requestedCount,
    requestedCount,
    placedCount,
    requiredCount: placedCount,
    missingCount,
    shortfallCount: missingCount,
    hadShortfall: missingCount > 0,
    candidateCellCount,
    preferencesByCategory,
    keycardFailureReason,
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

  const explicitPlacements = Array.isArray(options?.placements) ? options.placements : []

  if (targetCount === 0 && explicitPlacements.length === 0) {
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
        requestedCount: Math.max(targetCount, explicitPlacements.length),
        placedCount: 0,
        candidateCellCount: 0,
        failures: [
          {
            category: KEYCARD_TYPE,
            requested: Math.max(targetCount, explicitPlacements.length),
            placed: 0,
            missing: Math.max(targetCount, explicitPlacements.length),
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

  const pref =
    options?.placementPreference ||
    options?.placementPreferences?.[KEYCARD_TYPE] ||
    'auto'
  const allowFallback = Boolean(options?.allowFallback)

  const usedKeys = new Set()
  const chosenSlots = []
  const manualFailures = []
  let achievedCount = 0
  let fallbackCount = 0
  let failedCount = 0
  let preferenceFailureReason = null

  const rows = maze.grid.length
  const cols = maze.grid[0]?.length || 0
  const startKey = `${maze.start.row},${maze.start.col}`
  const exitKey = `${maze.exit.row},${maze.exit.col}`

  // Handle explicit manual placements first
  for (let idx = 0; idx < explicitPlacements.length; idx += 1) {
    const req = explicitPlacements[idx]
    if (!req || !Number.isInteger(req.row) || !Number.isInteger(req.col)) {
      manualFailures.push({
        category: KEYCARD_TYPE,
        type: KEYCARD_TYPE,
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
    if (targetCount === 0) {
      manualFailures.push({
        category: KEYCARD_TYPE,
        type: KEYCARD_TYPE,
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
      manualFailures.push({
        category: KEYCARD_TYPE,
        type: KEYCARD_TYPE,
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
      manualFailures.push({
        category: KEYCARD_TYPE,
        type: KEYCARD_TYPE,
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
      manualFailures.push({
        category: KEYCARD_TYPE,
        type: KEYCARD_TYPE,
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
      manualFailures.push({
        category: KEYCARD_TYPE,
        type: KEYCARD_TYPE,
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
      manualFailures.push({
        category: KEYCARD_TYPE,
        type: KEYCARD_TYPE,
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
    usedKeys.add(key)
    chosenSlots.push({
      key,
      row: req.row,
      col: req.col,
      dist: reachInfo.distances.get(key) || 1,
      isManual: true,
      manualId: req.id || null,
      placementPreference: req.placementPreference || pref || 'manual',
    })
    achievedCount += 1
  }

  const strictValidFar = []
  const strictValidAll = []

  reachInfo.distances.forEach((dist, key) => {
    if (excludedKeys.has(key) || usedKeys.has(key)) return
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return

    const candidate = { key, row, col, dist }
    strictValidAll.push(candidate)
    if (dist >= 2) {
      strictValidFar.push(candidate)
    }
  })

  const effectiveTargetCount =
    explicitPlacements.length > 0 && targetCount > 0
      ? Math.max(targetCount, chosenSlots.length)
      : targetCount
  const remainingTargetCount = Math.max(0, effectiveTargetCount - chosenSlots.length)

  let pool =
    strictValidFar.length >= remainingTargetCount ? strictValidFar : strictValidAll

  if (remainingTargetCount > 0 && pool.length === 0) {
    failedCount = remainingTargetCount
    preferenceFailureReason = 'no_valid_candidate_cells'
  } else if (remainingTargetCount > 0) {
    if (pref === 'auto') {
      pool = [...pool].sort(
        (a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col
      )

      const actualCount = Math.min(remainingTargetCount, pool.filter((c) => !usedKeys.has(c.key)).length)
      // Stratify across distance bands so keycards spread through the maze
      const bucketSize = Math.max(1, Math.floor(pool.length / Math.max(1, actualCount)))
      for (let i = 0; i < actualCount; i += 1) {
        const startIdx = i * bucketSize
        const endIdx = i === actualCount - 1 ? pool.length : (i + 1) * bucketSize
        const bucket = shuffleWithRng(pool.slice(startIdx, endIdx), rng)
        const picked =
          bucket.find((c) => !usedKeys.has(c.key)) ||
          shuffleWithRng(pool, rng).find((c) => !usedKeys.has(c.key))

        if (picked) {
          usedKeys.add(picked.key)
          chosenSlots.push({ ...picked, isManual: false, manualId: null, placementPreference: 'auto' })
          achievedCount += 1
        }
      }
      failedCount = Math.max(0, effectiveTargetCount - chosenSlots.length)
    } else {
      const contextAllEntities = [...hazardList, ...itemList]
      for (let i = 0; i < remainingTargetCount; i += 1) {
        const remaining = pool.filter((c) => !usedKeys.has(c.key))
        const prefRes = sortCandidatesByPreference(remaining, pref, {
          grid: maze.grid,
          rows: maze.rows ?? maze.grid.length,
          cols: maze.cols ?? maze.grid[0]?.length,
          start: maze.start,
          exit: maze.exit,
          maxDistance: reachInfo.maxDistance,
          placedInstances: chosenSlots,
          allEntities: contextAllEntities,
          allowFallback,
        })

        const picked = prefRes.sortedCandidates[0]
        if (!picked) {
          preferenceFailureReason =
            prefRes.reason ||
            (remaining.length === 0 ? 'insufficient_valid_cells' : `strict_preference_${pref}_unavailable`)
          failedCount += remainingTargetCount - i
          break
        }

        usedKeys.add(picked.key)
        chosenSlots.push({ ...picked, isManual: false, manualId: null, placementPreference: pref })
        if (prefRes.fallbackUsed || prefRes.preferredCount === 0) {
          fallbackCount += 1
        } else {
          achievedCount += 1
        }
      }
    }
  }

  const keycards = chosenSlots.map((slot, idx) => ({
    id: slot.manualId || `keycard-${slot.row}-${slot.col}`,
    type: KEYCARD_TYPE,
    index: idx,
    label: idx < 26 ? `Node ${String.fromCharCode(65 + idx)}` : `Node ${idx + 1}`,
    row: slot.row,
    col: slot.col,
    isManual: Boolean(slot.isManual),
    placementOrigin: slot.isManual ? 'manual' : 'automatic',
    manualId: slot.manualId || null,
    placementPreference: slot.placementPreference || pref,
  }))

  const missingCount = Math.max(0, effectiveTargetCount - keycards.length)
  const failureReason =
    preferenceFailureReason ||
    manualFailures[0]?.reason ||
    (missingCount > 0 ? 'insufficient_valid_cells' : null)
  const failures = [
    ...manualFailures,
    ...(missingCount > 0 && manualFailures.length < missingCount
      ? [
          {
            category: KEYCARD_TYPE,
            requested: effectiveTargetCount,
            placed: keycards.length,
            missing: missingCount,
            reason: failureReason,
          },
        ]
      : []),
  ]

  const preferencesByCategory = {
    [KEYCARD_TYPE]: {
      preference: pref,
      requested: effectiveTargetCount,
      achievedCount,
      fallbackCount,
      failedCount,
      fallbackUsed: fallbackCount > 0,
      achieved:
        effectiveTargetCount === 0
          ? manualFailures.length === 0
          : pref === 'auto'
            ? keycards.length > 0 && manualFailures.length === 0
            : failedCount === 0 && fallbackCount === 0 && manualFailures.length === 0,
      failureReason,
    },
  }

  return {
    keycards,
    report: makeEmptyReport({
      requestedCount: effectiveTargetCount,
      placedCount: keycards.length,
      candidateCellCount: pool.length,
      failures,
      fullySatisfied: missingCount === 0 && manualFailures.length === 0,
      preferencesByCategory,
      keycardFailureReason: failureReason,
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
