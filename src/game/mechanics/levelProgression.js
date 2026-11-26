/**
 * Infinite Level Progression Architecture.
 *
 * Centralized configuration and calculation module for level-based settings,
 * unbounded positive integer levels, deterministic reproducible seed derivation,
 * and progressive maze dimensions & braiding complexity.
 */

import { createRng, hashSeed, shuffleWithRng } from '../../utils/rng.js'
import {
  DEFAULT_BASE_MAZE_DIMENSION,
  MAX_BRAID_FACTOR,
  MAX_MAZE_DIMENSION,
  MIN_BRAID_FACTOR,
  MIN_MAZE_DIMENSION,
  normalizeBraidFactor,
  normalizeDimension,
} from '../generation/mazeConfig.js'
import { STANDARD_HAZARD_TYPES } from '../generation/hazardTypes.js'

export const DEFAULT_INITIAL_LEVEL = 1
export const INITIAL_BASE_SEED = 409217

/**
 * Centralized, configurable parameters controlling progressive maze sizing and braiding:
 *
 * Dimensions:
 *   dim(level) = normalizeDimension(
 *     baseDimension + dimensionStep * Math.floor(Math.pow(level - 1, dimensionExponent)),
 *     baseDimension,
 *     { min: minDimension, max: maxDimension }
 *   )
 *   - Level 1: 11x11 (Easy)
 *   - Level 6: 17x17 (Medium)
 *   - Level 12: 23x23 (Hard)
 *   - Level 25: 31x31 (Hardcore)
 *   - Levels 26..99: 33x33..49x49 (Beyond Hardcore)
 *   - Levels 100..5000+: capped safely at maxDimension = 51 (51x51) while currentLevel stays unbounded
 *
 * Braiding:
 *   braidFactor(level) = round4(
 *     baseBraidFactor + (maxBraidFactor - baseBraidFactor) * ((level - 1) / ((level - 1) + braidHalfSaturationLevels))
 *   )
 *   - Level 1: 0.0000 (Easy baseline)
 *   - Progressively increases toward maxBraidFactor (0.34 <= MAX_BRAID_FACTOR = 0.35),
 *     expanding tactical loops while preserving labyrinthine dead-end tension.
 */
export const DEFAULT_MAZE_PROGRESSION_CONFIG = Object.freeze({
  baseDimension: DEFAULT_BASE_MAZE_DIMENSION,
  dimensionStep: 2,
  dimensionExponent: 0.75,
  minDimension: MIN_MAZE_DIMENSION,
  maxDimension: MAX_MAZE_DIMENSION,
  baseBraidFactor: 0.0,
  maxBraidFactor: 0.34,
  braidHalfSaturationLevels: 18,
  braidPrecision: 10000,
})

/**
 * Level-based distinct hazard type budget schedule out of all 10 hazard types:
 * - Levels 1–5: 5 of 10
 * - Levels 6–10: 6 of 10
 * - Levels 11–15: 7 of 10
 * - Levels 16–20: 8 of 10
 * - Levels 21–25: 9 of 10
 * - Levels 26+: All 10
 */
export const HAZARD_TYPE_BUDGET_SCHEDULE = Object.freeze([
  Object.freeze({ minLevel: 1, maxLevel: 5, distinctTypes: 5 }),
  Object.freeze({ minLevel: 6, maxLevel: 10, distinctTypes: 6 }),
  Object.freeze({ minLevel: 11, maxLevel: 15, distinctTypes: 7 }),
  Object.freeze({ minLevel: 16, maxLevel: 20, distinctTypes: 8 }),
  Object.freeze({ minLevel: 21, maxLevel: 25, distinctTypes: 9 }),
  Object.freeze({ minLevel: 26, maxLevel: Infinity, distinctTypes: 10 }),
])

/**
 * Centralized, configurable hazard progression settings.
 */
export const DEFAULT_HAZARD_PROGRESSION_CONFIG = Object.freeze({
  minInstancesPerType: 2,
  baseInstancesPerType: 2,
  maxInstancesPerType: 4,
  extraInstanceLevelInterval: 10,
  maxTotalHazards: 40,
  maxWalkableOccupancyRatio: 0.35,
  minDistinctTypes: 5,
  levelsPerTypeTier: 5,
  budgetSchedule: HAZARD_TYPE_BUDGET_SCHEDULE,
  availableTypes: STANDARD_HAZARD_TYPES,
  perTypeQuantities: null,
})

/**
 * Merges and sanitizes a progression config against `DEFAULT_MAZE_PROGRESSION_CONFIG`.
 * @param {object} [overrides]
 * @returns {object}
 */
export function resolveMazeProgressionConfig(overrides = {}) {
  const src = overrides && typeof overrides === 'object' ? overrides : {}

  const minDimension = normalizeDimension(
    src.minDimension,
    DEFAULT_MAZE_PROGRESSION_CONFIG.minDimension,
    { min: MIN_MAZE_DIMENSION, max: MAX_MAZE_DIMENSION }
  )
  const rawMax =
    Number.isFinite(src.maxDimension) && src.maxDimension >= minDimension
      ? Math.floor(src.maxDimension)
      : DEFAULT_MAZE_PROGRESSION_CONFIG.maxDimension
  const maxOddRaw = rawMax % 2 === 0 ? Math.max(minDimension, rawMax - 1) : rawMax
  const maxDimension = Math.max(
    minDimension,
    Math.min(MAX_MAZE_DIMENSION, maxOddRaw)
  )

  const baseDimension = normalizeDimension(
    src.baseDimension,
    DEFAULT_MAZE_PROGRESSION_CONFIG.baseDimension,
    { min: minDimension, max: maxDimension }
  )

  const rawStep =
    Number.isFinite(src.dimensionStep) && src.dimensionStep >= 2
      ? Math.floor(src.dimensionStep)
      : DEFAULT_MAZE_PROGRESSION_CONFIG.dimensionStep
  const dimensionStep = rawStep % 2 === 0 ? rawStep : rawStep + 1

  const dimensionExponent =
    typeof src.dimensionExponent === 'number' &&
    Number.isFinite(src.dimensionExponent) &&
    src.dimensionExponent > 0
      ? src.dimensionExponent
      : DEFAULT_MAZE_PROGRESSION_CONFIG.dimensionExponent

  const baseBraidFactor = normalizeBraidFactor(
    src.baseBraidFactor,
    DEFAULT_MAZE_PROGRESSION_CONFIG.baseBraidFactor,
    { min: MIN_BRAID_FACTOR, max: MAX_BRAID_FACTOR }
  )

  const maxBraidFactor = normalizeBraidFactor(
    src.maxBraidFactor,
    DEFAULT_MAZE_PROGRESSION_CONFIG.maxBraidFactor,
    { min: baseBraidFactor, max: MAX_BRAID_FACTOR }
  )

  const braidHalfSaturationLevels =
    typeof src.braidHalfSaturationLevels === 'number' &&
    Number.isFinite(src.braidHalfSaturationLevels) &&
    src.braidHalfSaturationLevels > 0
      ? src.braidHalfSaturationLevels
      : DEFAULT_MAZE_PROGRESSION_CONFIG.braidHalfSaturationLevels

  const braidPrecision =
    Number.isInteger(src.braidPrecision) && src.braidPrecision >= 10
      ? src.braidPrecision
      : DEFAULT_MAZE_PROGRESSION_CONFIG.braidPrecision

  return {
    baseDimension,
    dimensionStep,
    dimensionExponent,
    minDimension,
    maxDimension,
    baseBraidFactor,
    maxBraidFactor,
    braidHalfSaturationLevels,
    braidPrecision,
  }
}

/**
 * Validates whether a given level input represents a valid positive integer level.
 * @param {unknown} level
 * @returns {boolean}
 */
export function isValidLevel(level) {
  if (typeof level === 'number') {
    return Number.isInteger(level) && level >= 1
  }
  if (typeof level === 'string' && level.trim() !== '') {
    const num = Number(level)
    return Number.isInteger(num) && num >= 1
  }
  return false
}

/**
 * Normalizes any level input into a positive integer >= 1.
 * Supports unbounded integer progression without any artificial maximum (1, 5, 10, 100, 5000, etc.).
 *
 * @param {unknown} level
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeLevel(level, fallback = DEFAULT_INITIAL_LEVEL) {
  const num = Number(level)
  if (!Number.isFinite(num) || num < 1) {
    return fallback
  }
  return Math.floor(num)
}

/**
 * Normalizes a base seed input.
 * @param {unknown} seed
 * @returns {number}
 */
export function normalizeBaseSeed(seed) {
  if (seed === undefined || seed === null || seed === '') {
    return INITIAL_BASE_SEED
  }
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return (seed >>> 0) || 1
  }
  return hashSeed(seed)
}

/**
 * Returns the next sequential level.
 * @param {unknown} level
 * @returns {number}
 */
export function getNextLevel(level) {
  return normalizeLevel(level) + 1
}

/**
 * Deterministically derives a unique reproducible generation seed for a given level
 * and base seed.
 *
 * Guarantees:
 * 1. Reproducibility: Same level + same base seed always produces the exact same seed.
 * 2. Uniqueness: Different levels with the same base seed receive different generation seeds.
 * 3. Base seed preservation: Level 1 preserves the base seed directly for 100% backwards compatibility.
 * 4. Arbitrary levels: Supports positive integer levels without ceiling.
 *
 * @param {number|unknown} level
 * @param {number|string|unknown} baseSeed
 * @returns {number} 32-bit unsigned integer seed
 */
export function getLevelSeed(level = DEFAULT_INITIAL_LEVEL, baseSeed = INITIAL_BASE_SEED) {
  const normLevel = normalizeLevel(level)
  const normBase = normalizeBaseSeed(baseSeed)

  if (normLevel === 1) {
    return normBase
  }

  // Deterministic FNV-1a salted hash derivation
  return hashSeed(`level:${normLevel}:base:${normBase}`)
}

/**
 * Calculates progressive odd maze dimensions `{ rows, cols }` from `currentLevel`.
 * Clamps safely to the configured dimension ceiling without capping `currentLevel`.
 *
 * @param {number|unknown} level
 * @param {object} [progressionConfig]
 * @returns {{ rows: number, cols: number }}
 */
export function calculateMazeDimensionsForLevel(
  level = DEFAULT_INITIAL_LEVEL,
  progressionConfig = DEFAULT_MAZE_PROGRESSION_CONFIG
) {
  const normLevel = normalizeLevel(level)
  const cfg = resolveMazeProgressionConfig(progressionConfig)
  const delta = Math.max(0, normLevel - 1)
  const growth = Math.floor(Math.pow(delta, cfg.dimensionExponent))
  const rawDim = Number.isFinite(growth)
    ? cfg.baseDimension + cfg.dimensionStep * growth
    : cfg.maxDimension
  const capped = Math.min(cfg.maxDimension, Math.floor(rawDim))

  const dim = normalizeDimension(capped, cfg.baseDimension, {
    min: cfg.minDimension,
    max: cfg.maxDimension,
  })

  return {
    rows: dim,
    cols: dim,
  }
}

/**
 * Calculates progressive `braidFactor` in `[MIN_BRAID_FACTOR, MAX_BRAID_FACTOR]` from `currentLevel`.
 * Level 1 begins at 0.0 (Easy baseline) and asymptotically approaches `maxBraidFactor` (0.34)
 * so larger mazes gain interconnected loops while keeping dead-end horror structure.
 *
 * @param {number|unknown} level
 * @param {object} [progressionConfig]
 * @returns {number}
 */
export function calculateBraidFactorForLevel(
  level = DEFAULT_INITIAL_LEVEL,
  progressionConfig = DEFAULT_MAZE_PROGRESSION_CONFIG
) {
  const normLevel = normalizeLevel(level)
  const cfg = resolveMazeProgressionConfig(progressionConfig)
  const delta = Math.max(0, normLevel - 1)
  if (delta === 0) {
    return cfg.baseBraidFactor
  }

  const saturation = delta / (delta + cfg.braidHalfSaturationLevels)
  const rawBraid =
    cfg.baseBraidFactor + (cfg.maxBraidFactor - cfg.baseBraidFactor) * saturation
  const rounded = Math.round(rawBraid * cfg.braidPrecision) / cfg.braidPrecision

  return normalizeBraidFactor(rounded, cfg.baseBraidFactor, {
    min: cfg.baseBraidFactor,
    max: cfg.maxBraidFactor,
  })
}

/**
 * Sanitizes hazard progression overrides against `DEFAULT_HAZARD_PROGRESSION_CONFIG`.
 * Enforces `minInstancesPerType >= 2` so every selected hazard type always targets at least 2 instances.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
export function resolveHazardProgressionConfig(overrides = {}) {
  const src = overrides && typeof overrides === 'object' ? overrides : {}

  const rawTypes = Array.isArray(src.availableTypes) && src.availableTypes.length > 0
    ? src.availableTypes
    : DEFAULT_HAZARD_PROGRESSION_CONFIG.availableTypes
  const availableTypes = Array.from(
    new Set(rawTypes.filter((t) => typeof t === 'string' && t.trim().length > 0))
  )
  const resolvedTypes =
    availableTypes.length > 0
      ? availableTypes
      : [...DEFAULT_HAZARD_PROGRESSION_CONFIG.availableTypes]

  const minInstancesPerType =
    Number.isFinite(src.minInstancesPerType) && src.minInstancesPerType >= 2
      ? Math.floor(src.minInstancesPerType)
      : DEFAULT_HAZARD_PROGRESSION_CONFIG.minInstancesPerType

  const baseInstancesPerType =
    Number.isFinite(src.baseInstancesPerType) && src.baseInstancesPerType >= minInstancesPerType
      ? Math.floor(src.baseInstancesPerType)
      : Math.max(minInstancesPerType, DEFAULT_HAZARD_PROGRESSION_CONFIG.baseInstancesPerType)

  const maxInstancesPerType =
    Number.isFinite(src.maxInstancesPerType) && src.maxInstancesPerType >= baseInstancesPerType
      ? Math.floor(src.maxInstancesPerType)
      : Math.max(baseInstancesPerType, DEFAULT_HAZARD_PROGRESSION_CONFIG.maxInstancesPerType)

  const extraInstanceLevelInterval =
    Number.isFinite(src.extraInstanceLevelInterval) && src.extraInstanceLevelInterval >= 1
      ? Math.floor(src.extraInstanceLevelInterval)
      : DEFAULT_HAZARD_PROGRESSION_CONFIG.extraInstanceLevelInterval

  const maxTotalHazards =
    Number.isFinite(src.maxTotalHazards) && src.maxTotalHazards >= 1
      ? Math.floor(src.maxTotalHazards)
      : DEFAULT_HAZARD_PROGRESSION_CONFIG.maxTotalHazards

  const maxWalkableOccupancyRatio =
    typeof src.maxWalkableOccupancyRatio === 'number' &&
    Number.isFinite(src.maxWalkableOccupancyRatio) &&
    src.maxWalkableOccupancyRatio > 0 &&
    src.maxWalkableOccupancyRatio <= 1
      ? src.maxWalkableOccupancyRatio
      : DEFAULT_HAZARD_PROGRESSION_CONFIG.maxWalkableOccupancyRatio

  const minDistinctTypes =
    Number.isFinite(src.minDistinctTypes) && src.minDistinctTypes >= 1
      ? Math.min(resolvedTypes.length, Math.floor(src.minDistinctTypes))
      : Math.min(resolvedTypes.length, DEFAULT_HAZARD_PROGRESSION_CONFIG.minDistinctTypes)

  const levelsPerTypeTier =
    Number.isFinite(src.levelsPerTypeTier) && src.levelsPerTypeTier >= 1
      ? Math.floor(src.levelsPerTypeTier)
      : DEFAULT_HAZARD_PROGRESSION_CONFIG.levelsPerTypeTier

  const budgetSchedule =
    Array.isArray(src.budgetSchedule) && src.budgetSchedule.length > 0
      ? src.budgetSchedule
      : DEFAULT_HAZARD_PROGRESSION_CONFIG.budgetSchedule

  const perTypeQuantities =
    src.perTypeQuantities &&
    (typeof src.perTypeQuantities === 'object' || typeof src.perTypeQuantities === 'function')
      ? src.perTypeQuantities
      : null

  return {
    minInstancesPerType,
    baseInstancesPerType,
    maxInstancesPerType,
    extraInstanceLevelInterval,
    maxTotalHazards,
    maxWalkableOccupancyRatio,
    minDistinctTypes,
    levelsPerTypeTier,
    budgetSchedule,
    availableTypes: resolvedTypes,
    perTypeQuantities,
    hasCustomSchedule: Boolean(
      src.budgetSchedule !== undefined ||
        src.minDistinctTypes !== undefined ||
        src.levelsPerTypeTier !== undefined
    ),
  }
}

/**
 * Resolves the distinct hazard-type budget and instance quantity parameters for `level`.
 *
 * @param {number|unknown} level
 * @param {object} [hazardConfig]
 * @returns {object}
 */
export function getHazardBudgetForLevel(
  level = DEFAULT_INITIAL_LEVEL,
  hazardConfig = DEFAULT_HAZARD_PROGRESSION_CONFIG
) {
  const normLevel = normalizeLevel(level)
  const cfg = resolveHazardProgressionConfig(hazardConfig)
  const totalAvailableTypes = cfg.availableTypes.length

  let scheduledDistinct = null
  if (!cfg.hasCustomSchedule || Array.isArray(hazardConfig?.budgetSchedule)) {
    for (let i = 0; i < cfg.budgetSchedule.length; i += 1) {
      const tier = cfg.budgetSchedule[i]
      if (!tier) continue
      const minL = Number.isFinite(tier.minLevel) ? tier.minLevel : 1
      const maxL = tier.maxLevel === Infinity || Number.isFinite(tier.maxLevel) ? tier.maxLevel : Infinity
      if (normLevel >= minL && normLevel <= maxL && Number.isFinite(tier.distinctTypes)) {
        scheduledDistinct = Math.floor(tier.distinctTypes)
        break
      }
    }
  }

  if (scheduledDistinct === null) {
    const tierOffset = Math.floor((normLevel - 1) / cfg.levelsPerTypeTier)
    scheduledDistinct = cfg.minDistinctTypes + tierOffset
  }

  const distinctTypeCount = Math.max(1, Math.min(totalAvailableTypes, scheduledDistinct))
  const extraInstances = Math.floor((normLevel - 1) / cfg.extraInstanceLevelInterval)
  const targetInstancesPerType = Math.max(
    cfg.minInstancesPerType,
    Math.min(cfg.maxInstancesPerType, cfg.baseInstancesPerType + extraInstances)
  )

  return {
    level: normLevel,
    distinctTypeCount,
    totalAvailableTypes,
    minInstancesPerType: cfg.minInstancesPerType,
    targetInstancesPerType,
    maxInstancesPerType: cfg.maxInstancesPerType,
    maxTotalHazards: cfg.maxTotalHazards,
  }
}

function estimateMazeWalkableCells(rows, cols, explicitWalkableCount = null) {
  if (Number.isFinite(explicitWalkableCount) && explicitWalkableCount > 0) {
    return Math.floor(explicitWalkableCount)
  }
  const safeRows = Number.isFinite(rows) && rows >= 3 ? rows : DEFAULT_BASE_MAZE_DIMENSION
  const safeCols = Number.isFinite(cols) && cols >= 3 ? cols : DEFAULT_BASE_MAZE_DIMENSION
  return Math.max(1, Math.floor(((safeRows - 1) * (safeCols - 1)) / 2))
}

/**
 * Deterministically and randomly selects distinct hazard types and target per-type
 * quantities for a level using an isolated hazard-selection PRNG stream.
 * Never consumes or mutates maze terrain, collectible, or enemy PRNG state.
 *
 * @param {object} [params]
 * @returns {object}
 */
export function selectHazardsForLevel(params = {}) {
  const safeParams = params && typeof params === 'object' ? params : {}
  const normLevel = normalizeLevel(safeParams.level ?? DEFAULT_INITIAL_LEVEL)
  const normBaseSeed =
    safeParams.baseSeed !== undefined &&
    safeParams.baseSeed !== null &&
    safeParams.baseSeed !== ''
      ? normalizeBaseSeed(safeParams.baseSeed)
      : INITIAL_BASE_SEED
  const hasExplicitSeed =
    safeParams.seed !== undefined &&
    safeParams.seed !== null &&
    safeParams.seed !== ''
  const resolvedSeed = hasExplicitSeed
    ? safeParams.seed
    : getLevelSeed(normLevel, normBaseSeed)

  const cfg = resolveHazardProgressionConfig(safeParams.hazardConfig)
  const budget = getHazardBudgetForLevel(normLevel, cfg)

  const selectionSeed = `hazard-selection:level:${normLevel}:seed:${resolvedSeed}`
  const selectionRng = createRng(selectionSeed)
  const shuffledTypes = shuffleWithRng(cfg.availableTypes, selectionRng)

  const selectedTypes = shuffledTypes.slice(0, budget.distinctTypeCount)
  const unselectedTypes = shuffledTypes.slice(budget.distinctTypeCount)

  const estimatedWalkable = estimateMazeWalkableCells(
    safeParams.rows,
    safeParams.cols,
    safeParams.walkableCount
  )
  const minimumRequiredTotal = selectedTypes.length * cfg.minInstancesPerType
  const occupancyCap = Math.floor(estimatedWalkable * cfg.maxWalkableOccupancyRatio)
  const totalBudgetCap = Math.max(
    minimumRequiredTotal,
    Math.min(cfg.maxTotalHazards, Math.max(minimumRequiredTotal, occupancyCap))
  )

  const typeQuantities = {}
  let plannedTotal = 0
  for (let i = 0; i < selectedTypes.length; i += 1) {
    const type = selectedTypes[i]
    let desired = budget.targetInstancesPerType
    let hasExplicitOverride = false

    if (cfg.perTypeQuantities) {
      const rawOverride =
        typeof cfg.perTypeQuantities === 'function'
          ? cfg.perTypeQuantities(type, {
              level: normLevel,
              seed: resolvedSeed,
              rows: safeParams.rows,
              cols: safeParams.cols,
              budget,
            })
          : cfg.perTypeQuantities[type]
      if (Number.isFinite(rawOverride)) {
        desired = Math.floor(rawOverride)
        hasExplicitOverride = true
      }
    }

    const upperBound = hasExplicitOverride
      ? Math.max(cfg.maxInstancesPerType, desired)
      : cfg.maxInstancesPerType
    const clamped = Math.max(cfg.minInstancesPerType, Math.min(upperBound, desired))
    typeQuantities[type] = clamped
    plannedTotal += clamped
  }

  // Trim only optional excess instances above minInstancesPerType to honor maze capacity & performance caps
  if (plannedTotal > totalBudgetCap) {
    let safetyCounter = plannedTotal
    while (plannedTotal > totalBudgetCap && safetyCounter > 0) {
      let trimmedAny = false
      for (let i = selectedTypes.length - 1; i >= 0 && plannedTotal > totalBudgetCap; i -= 1) {
        const type = selectedTypes[i]
        if (typeQuantities[type] > cfg.minInstancesPerType) {
          typeQuantities[type] -= 1
          plannedTotal -= 1
          trimmedAny = true
        }
      }
      if (!trimmedAny) break
      safetyCounter -= 1
    }
  }

  // Order slots by wave so every selected type gets its guaranteed minimum instances
  // before any optional bonus (3rd+) instances are slotted.
  const requestedHazardTypes = []
  const maxQty = selectedTypes.reduce(
    (max, type) => Math.max(max, typeQuantities[type] || 0),
    0
  )
  for (let wave = 0; wave < maxQty; wave += 1) {
    for (let i = 0; i < selectedTypes.length; i += 1) {
      const type = selectedTypes[i]
      if (wave < typeQuantities[type]) {
        requestedHazardTypes.push(type)
      }
    }
  }

  return {
    level: normLevel,
    seed: resolvedSeed,
    selectionSeed,
    distinctTypeCount: selectedTypes.length,
    totalAvailableTypes: budget.totalAvailableTypes,
    minInstancesPerType: cfg.minInstancesPerType,
    selectedTypes,
    unselectedTypes,
    typeQuantities,
    requestedHazardTypes,
    totalTargetCount: requestedHazardTypes.length,
  }
}

/**
 * Returns the centralized level configuration descriptor for a given level.
 * Future progression phases will retrieve level-scaled enemies, collectibles,
 * and maze parameters from this centralized entry point.
 *
 * @param {number|unknown} level
 * @param {number|string|unknown} baseSeed
 * @param {object} [progressionConfig]
 * @returns {object}
 */
export function getLevelConfig(
  level = DEFAULT_INITIAL_LEVEL,
  baseSeed = INITIAL_BASE_SEED,
  progressionConfig = DEFAULT_MAZE_PROGRESSION_CONFIG
) {
  const normalizedLevel = normalizeLevel(level)
  const normalizedBase = normalizeBaseSeed(baseSeed)
  const resolvedConfig = resolveMazeProgressionConfig(progressionConfig)
  const seed = getLevelSeed(normalizedLevel, normalizedBase)
  const dimensions = calculateMazeDimensionsForLevel(normalizedLevel, resolvedConfig)
  const braidFactor = calculateBraidFactorForLevel(normalizedLevel, resolvedConfig)

  const hazardConfig =
    progressionConfig?.hazards ??
    progressionConfig?.hazardConfig ??
    progressionConfig?.hazardProgression
  const hazardBudget = getHazardBudgetForLevel(normalizedLevel, hazardConfig)
  const hazardSelection = selectHazardsForLevel({
    level: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
    rows: dimensions.rows,
    cols: dimensions.cols,
    hazardConfig,
  })

  return {
    level: normalizedLevel,
    currentLevel: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
    rows: dimensions.rows,
    cols: dimensions.cols,
    dimensions,
    braidFactor,
    maxDimension: resolvedConfig.maxDimension,
    hazardBudget,
    hazardSelection,
  }
}


