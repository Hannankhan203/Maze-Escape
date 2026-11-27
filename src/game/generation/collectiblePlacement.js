import { createRng, shuffleWithRng } from '../../utils/rng.js'
import {
  COLLECTIBLE_CONFIG,
  COLLECTIBLE_TYPES,
  KEYCARD_COLLECTIBLE_TYPE,
} from '../mechanics/collectiblesConfig.js'
import {
  allocateCollectibleQuantitiesForLevel,
  normalizeLevel,
  selectCollectibleCategoriesForLevel,
} from '../mechanics/levelProgression.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'
import { placeHazards } from './hazardPlacement.js'
import { placeKeycards } from './keycardPlacement.js'
import { sortCandidatesByPreference } from './placementPreferences.js'

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

const CANONICAL_ITEM_ORDER = Object.freeze([
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
])

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

/**
 * Builds wave-ordered item slots strictly from the requested per-category counts.
 * Wave 0 allocates 1 instance of every requested non-shard item category (and 1 shard)
 * before Waves 1+ allocate extra duplicates/shards, ensuring fair coverage under tight
 * constraints while NEVER substituting unselected categories.
 */
function buildWaveOrderedItemTypes(itemQuantities, categoryOrder = CANONICAL_ITEM_ORDER) {
  const types = []
  if (!itemQuantities || typeof itemQuantities !== 'object') {
    return types
  }

  const normalizedCounts = {}
  const orderedCategories = []
  const seen = new Set()

  for (let i = 0; i < categoryOrder.length; i += 1) {
    const type = categoryOrder[i]
    if (!type || type === KEYCARD_COLLECTIBLE_TYPE || seen.has(type)) continue
    seen.add(type)
    const count = Math.max(0, Math.floor(itemQuantities[type] || 0))
    if (count > 0) {
      normalizedCounts[type] = count
      orderedCategories.push(type)
    }
  }

  for (const type of Object.keys(itemQuantities)) {
    if (!type || type === KEYCARD_COLLECTIBLE_TYPE || seen.has(type)) continue
    seen.add(type)
    const count = Math.max(0, Math.floor(itemQuantities[type] || 0))
    if (count > 0) {
      normalizedCounts[type] = count
      orderedCategories.push(type)
    }
  }

  // Prioritize non-shard active categories ahead of Soul Shards inside Wave 0
  // so every utility/survival category is represented first when candidates are scarce.
  const shardIdx = orderedCategories.indexOf(COLLECTIBLE_TYPES.SOUL_SHARDS)
  if (shardIdx !== -1) {
    orderedCategories.splice(shardIdx, 1)
    orderedCategories.push(COLLECTIBLE_TYPES.SOUL_SHARDS)
  }

  let maxCount = 0
  for (let i = 0; i < orderedCategories.length; i += 1) {
    const count = normalizedCounts[orderedCategories[i]] || 0
    if (count > maxCount) maxCount = count
  }

  for (let wave = 0; wave < maxCount; wave += 1) {
    for (let i = 0; i < orderedCategories.length; i += 1) {
      const type = orderedCategories[i]
      if (wave < (normalizedCounts[type] || 0)) {
        types.push(type)
      }
    }
  }

  return types
}

function buildShortfallReport({
  requestedByCategory,
  placedByCategory,
  selectedCategories,
  unselectedOptionalCategories,
  candidateCellCount,
  failureReason = 'insufficient_candidate_cells',
  failureReasonByCategory = {},
  preferencesByCategory = {},
}) {
  const missingByCategory = {}
  const missingSelectedCategories = []
  const failures = []
  let requestedTotal = 0
  let placedTotal = 0
  let missingTotal = 0

  for (const category of Object.keys(requestedByCategory)) {
    const requested = requestedByCategory[category] || 0
    const placed = placedByCategory[category] || 0
    const missing = Math.max(0, requested - placed)
    requestedTotal += requested
    placedTotal += placed
    missingByCategory[category] = missing
    if (missing > 0) {
      missingTotal += missing
      missingSelectedCategories.push(category)
      failures.push({
        category,
        requested,
        placed,
        missing,
        reason: failureReasonByCategory[category] || failureReason,
      })
    }
  }

  const unselectedSet = new Set(unselectedOptionalCategories || [])
  let unselectedSpawnCount = 0
  for (const category of Object.keys(placedByCategory)) {
    if (unselectedSet.has(category) && placedByCategory[category] > 0) {
      unselectedSpawnCount += placedByCategory[category]
    }
  }

  return {
    fullySatisfied: missingTotal === 0 && unselectedSpawnCount === 0,
    selectedCategories: [...selectedCategories],
    unselectedOptionalCategories: [...(unselectedOptionalCategories || [])],
    requestedTotal,
    placedTotal,
    missingTotal,
    requestedByCategory,
    allocatedByCategory: { ...requestedByCategory },
    placedByCategory,
    missingByCategory,
    missingSelectedCategories,
    unselectedSpawnCount,
    candidateCellCount,
    preferencesByCategory,
    failures,
  }
}

/**
 * Places deterministic, non-overlapping survival collectibles and Echo Reveal items
 * on reachable walkable maze tiles while strictly avoiding the start, exit,
 * hazards, and keycards, and returns a structured placement report.
 *
 * Uses separated category selection & level-aware quantity allocation unless an
 * explicit `options.spawnCounts` override is passed. Never silently substitutes
 * unselected optional categories when placement capacity runs short.
 */
export function placeCollectiblesWithReport(maze, options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {}

  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return {
      items: [],
      coins: [],
      powerUps: [],
      selection: null,
      allocation: null,
      report: buildShortfallReport({
        requestedByCategory: {},
        placedByCategory: {},
        selectedCategories: [],
        unselectedOptionalCategories: [],
        candidateCellCount: 0,
        failureReason: 'invalid_maze_structure',
      }),
    }
  }

  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  const level = normalizeLevel(
    safeOptions.level ?? maze.level ?? maze.currentLevel ?? 1
  )
  const collectibleConfig =
    safeOptions.collectibleConfig ??
    maze.collectibleProgressionConfig ??
    undefined

  let selection = null
  let allocation = null
  let requestedByCategory = {}
  let targetTypes

  if (safeOptions.spawnCounts && typeof safeOptions.spawnCounts === 'object') {
    const selectedItemCategories = CANONICAL_ITEM_ORDER.filter(
      (type) => (safeOptions.spawnCounts[type] || 0) > 0
    )
    for (const type of Object.keys(safeOptions.spawnCounts)) {
      if (
        type !== KEYCARD_COLLECTIBLE_TYPE &&
        !selectedItemCategories.includes(type) &&
        (safeOptions.spawnCounts[type] || 0) > 0
      ) {
        selectedItemCategories.push(type)
      }
    }
    for (const type of selectedItemCategories) {
      requestedByCategory[type] = Math.max(
        0,
        Math.floor(safeOptions.spawnCounts[type] || 0)
      )
    }
    targetTypes = buildWaveOrderedItemTypes(
      requestedByCategory,
      selectedItemCategories
    )
  } else {
    selection =
      safeOptions.collectibleSelection ??
      safeOptions.selection ??
      maze.collectibleSelection ??
      selectCollectibleCategoriesForLevel({
        level,
        baseSeed: maze.baseSeed,
        seed: maze.seed,
        collectibleConfig,
      })

    allocation =
      safeOptions.collectibleAllocation ??
      safeOptions.allocation ??
      maze.collectibleAllocation ??
      allocateCollectibleQuantitiesForLevel({
        level,
        baseSeed: maze.baseSeed,
        seed: maze.seed,
        rows: maze.grid.length,
        cols: maze.grid[0]?.length,
        walkableCount: reachInfo.reachableCount,
        selection,
        collectibleConfig,
      })

    requestedByCategory = { ...(allocation.itemQuantities || {}) }
    targetTypes = buildWaveOrderedItemTypes(
      requestedByCategory,
      selection.selectedItemCategories || CANONICAL_ITEM_ORDER
    )
  }

  const selectedItemCategories = selection
    ? selection.selectedItemCategories
    : Object.keys(requestedByCategory)
  const unselectedOptionalCategories = selection
    ? selection.unselectedOptionalCategories
    : []

  if (!reachInfo.valid || reachInfo.distances.size <= 2) {
    return {
      items: [],
      coins: [],
      powerUps: [],
      selection,
      allocation,
      report: buildShortfallReport({
        requestedByCategory,
        placedByCategory: {},
        selectedCategories: selectedItemCategories,
        unselectedOptionalCategories,
        candidateCellCount: 0,
        failureReason: 'insufficient_reachable_cells',
      }),
    }
  }

  const rngSeed =
    safeOptions.seed !== undefined && safeOptions.seed !== null
      ? `${maze.seed}-collectibles-v2-${safeOptions.seed}`
      : `${maze.seed}-collectibles-v2`
  const rng = createRng(rngSeed)

  const hazardList = Array.isArray(safeOptions.hazards)
    ? safeOptions.hazards
    : Array.isArray(maze?.hazards)
      ? maze.hazards
      : typeof placeHazards === 'function'
        ? placeHazards(maze)
        : []

  const keycardList = Array.isArray(safeOptions.keycards)
    ? safeOptions.keycards
    : Array.isArray(maze?.keycards)
      ? maze.keycards
      : typeof placeKeycards === 'function'
        ? placeKeycards({
            ...maze,
            hazards: hazardList,
            ...(allocation ? { collectibleAllocation: allocation } : {}),
          })
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
    return {
      items: [],
      coins: [],
      powerUps: [],
      selection,
      allocation,
      report: buildShortfallReport({
        requestedByCategory,
        placedByCategory: {},
        selectedCategories: selectedItemCategories,
        unselectedOptionalCategories,
        candidateCellCount: 0,
        failureReason: 'no_valid_candidate_cells',
      }),
    }
  }

  if (targetTypes.length === 0) {
    return {
      items: [],
      coins: [],
      powerUps: [],
      selection,
      allocation,
      report: buildShortfallReport({
        requestedByCategory,
        placedByCategory: {},
        selectedCategories: selectedItemCategories,
        unselectedOptionalCategories,
        candidateCellCount: candidates.length,
        preferencesByCategory: {},
      }),
    }
  }

  candidates.sort((a, b) => b.dist - a.dist || a.row - b.row || a.col - b.col)
  const shuffledCandidates = shuffleWithRng(candidates, rng)
  const usedKeys = new Set()
  const placedItems = []
  const placedByCategory = {}
  const placementPreferences = safeOptions.placementPreferences || {}
  const allowFallback = Boolean(safeOptions.allowFallback)
  const prefStats = {}
  const failureReasonByCategory = {}

  let shardCounter = 0
  let consumableCounter = 0

  // Handle explicit manual placements first
  const explicitPlacements = Array.isArray(safeOptions?.placements) ? safeOptions.placements : []
  for (const req of explicitPlacements) {
    if (req && req.type && Number.isInteger(req.row) && Number.isInteger(req.col)) {
      const key = `${req.row},${req.col}`
      if (!usedKeys.has(key) && maze.grid[req.row]?.[req.col] === CELL_TYPES.PATH) {
        usedKeys.add(key)
        placedByCategory[req.type] = (placedByCategory[req.type] || 0) + 1
        if (!prefStats[req.type]) {
          prefStats[req.type] = {
            preference: placementPreferences[req.type] || safeOptions.placementPreference || 'auto',
            requested: requestedByCategory[req.type] || 0,
            achievedCount: 0,
            fallbackCount: 0,
            failedCount: 0,
          }
        }
        prefStats[req.type].achievedCount += 1
        const config = COLLECTIBLE_CONFIG[req.type] || {}
        if (req.type === COLLECTIBLE_TYPES.SOUL_SHARDS) {
          shardCounter += 1
          placedItems.push({
            id: `shard-${shardCounter}`,
            type: req.type,
            row: req.row,
            col: req.col,
            value: config.value || 1,
            label: config.label || req.type,
          })
        } else {
          consumableCounter += 1
          placedItems.push({
            id: `item-${consumableCounter}`,
            type: req.type,
            row: req.row,
            col: req.col,
            label: config.label || req.type,
          })
        }
        // Remove one instance of this type from targetTypes
        const removeIdx = targetTypes.indexOf(req.type)
        if (removeIdx !== -1) {
          targetTypes.splice(removeIdx, 1)
        }
      }
    }
  }

  for (let i = 0; i < targetTypes.length; i += 1) {
    const type = targetTypes[i]
    const pref = placementPreferences[type] || safeOptions.placementPreference || 'auto'
    if (!prefStats[type]) {
      prefStats[type] = {
        preference: pref,
        requested: requestedByCategory[type] || 0,
        achievedCount: 0,
        fallbackCount: 0,
        failedCount: 0,
      }
    }

    let chosen
    let usedFallback = false

    if (pref === 'auto') {
      chosen =
        shuffledCandidates.find((c) => !usedKeys.has(c.key)) ||
        candidates.find((c) => !usedKeys.has(c.key))
    } else {
      const remaining = candidates.filter((c) => !usedKeys.has(c.key))
      const prefRes = sortCandidatesByPreference(remaining, pref, {
        grid: maze.grid,
        rows: maze.rows ?? maze.grid.length,
        cols: maze.cols ?? maze.grid[0]?.length,
        start: maze.start,
        exit: maze.exit,
        maxDistance: reachInfo.maxDistance,
        placedInstances: placedItems.filter((it) => it.type === type),
        allEntities: [...hazardList, ...keycardList, ...placedItems],
        allowFallback,
      })
      chosen = prefRes.sortedCandidates[0] || null
      usedFallback = Boolean(prefRes.fallbackUsed || prefRes.preferredCount === 0)
      if (!chosen && !failureReasonByCategory[type]) {
        failureReasonByCategory[type] =
          prefRes.reason ||
          (remaining.length === 0 ? 'insufficient_candidate_cells' : `strict_preference_${pref}_unavailable`)
      }
    }

    if (!chosen) {
      prefStats[type].failedCount += 1
      if (!failureReasonByCategory[type]) {
        failureReasonByCategory[type] = 'insufficient_candidate_cells'
      }
      continue
    }

    usedKeys.add(chosen.key)
    placedByCategory[type] = (placedByCategory[type] || 0) + 1
    if (usedFallback) {
      prefStats[type].fallbackCount += 1
    } else {
      prefStats[type].achievedCount += 1
    }

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

  const preferencesByCategory = {}
  for (const [cat, stat] of Object.entries(prefStats)) {
    const req = stat.requested || 0
    const plc = placedByCategory[cat] || 0
    preferencesByCategory[cat] = {
      ...stat,
      fallbackUsed: stat.fallbackCount > 0,
      achieved:
        req === 0
          ? true
          : stat.preference === 'auto'
            ? plc > 0
            : stat.failedCount === 0 && stat.fallbackCount === 0 && plc === req,
    }
  }

  return {
    items: placedItems,
    coins: [],
    powerUps: [],
    selection,
    allocation,
    report: buildShortfallReport({
      requestedByCategory,
      placedByCategory,
      selectedCategories: selectedItemCategories,
      unselectedOptionalCategories,
      candidateCellCount: candidates.length,
      failureReason: 'insufficient_candidate_cells',
      failureReasonByCategory,
      preferencesByCategory,
    }),
  }
}

/**
 * Places deterministic, non-overlapping survival collectibles and Echo Reveal items
 * on reachable walkable maze tiles while strictly avoiding the start, exit,
 * hazards, and keycards.
 */
export function placeCollectibles(maze, options = {}) {
  const { items, coins, powerUps } = placeCollectiblesWithReport(maze, options)
  return {
    items,
    coins,
    powerUps,
  }
}
