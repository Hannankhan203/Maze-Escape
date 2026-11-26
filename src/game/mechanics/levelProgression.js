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
import {
  COLLECTIBLE_TYPES,
  KEYCARD_COLLECTIBLE_TYPE,
  OPTIONAL_COLLECTIBLE_CATEGORIES,
  OPTIONAL_COLLECTIBLE_PICK_COUNT,
  PERMANENT_COLLECTIBLE_CATEGORIES,
} from './collectiblesConfig.js'
import { getEnemyArchetypeConfig } from '../generation/enemyPlacement.js'
import { ALL_HIDING_SPOT_TYPES } from './hidingConfig.js'

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
 * Level-aware and maze-size-aware quantity ranges for all 12 collectible categories.
 * Note: `resonance_keycard` starts at [2, 2] on Levels 1–12 for existing keycard compatibility,
 * scaling gently at higher levels while staying within playable bounds.
 */
export const DEFAULT_COLLECTIBLE_QUANTITY_SETTINGS = Object.freeze({
  [COLLECTIBLE_TYPES.SOUL_SHARDS]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 5, min: 6, max: 10 }),
    Object.freeze({ minLevel: 6, maxLevel: 10, min: 8, max: 14 }),
    Object.freeze({ minLevel: 11, maxLevel: 20, min: 10, max: 16 }),
    Object.freeze({ minLevel: 21, maxLevel: Infinity, min: 12, max: 22 }),
  ]),
  [COLLECTIBLE_TYPES.HEALTH_CAPSULE]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 10, min: 1, max: 2 }),
    Object.freeze({ minLevel: 11, maxLevel: 25, min: 2, max: 3 }),
    Object.freeze({ minLevel: 26, maxLevel: Infinity, min: 2, max: 4 }),
  ]),
  [KEYCARD_COLLECTIBLE_TYPE]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 4, min: 2, max: 2 }),
    Object.freeze({ minLevel: 5, maxLevel: 9, min: 2, max: 3 }),
    Object.freeze({ minLevel: 10, maxLevel: 14, min: 3, max: 3 }),
    Object.freeze({ minLevel: 15, maxLevel: 19, min: 3, max: 4 }),
    Object.freeze({ minLevel: 20, maxLevel: 24, min: 4, max: 4 }),
    Object.freeze({ minLevel: 25, maxLevel: 49, min: 4, max: 5 }),
    Object.freeze({ minLevel: 50, maxLevel: Infinity, min: 5, max: 6 }),
  ]),
  [COLLECTIBLE_TYPES.ECHO_REVEAL]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 10, min: 1, max: 2 }),
    Object.freeze({ minLevel: 11, maxLevel: Infinity, min: 1, max: 3 }),
  ]),
  [COLLECTIBLE_TYPES.ENERGY_CELL]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 10, min: 1, max: 2 }),
    Object.freeze({ minLevel: 11, maxLevel: Infinity, min: 1, max: 3 }),
  ]),
  [COLLECTIBLE_TYPES.SPECTRAL_COMPASS]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 15, min: 1, max: 2 }),
    Object.freeze({ minLevel: 16, maxLevel: Infinity, min: 1, max: 3 }),
  ]),
  [COLLECTIBLE_TYPES.PHANTOM_VEIL]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 10, min: 1, max: 2 }),
    Object.freeze({ minLevel: 11, maxLevel: Infinity, min: 2, max: 3 }),
  ]),
  [COLLECTIBLE_TYPES.WARDING_CHARM]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 12, min: 1, max: 2 }),
    Object.freeze({ minLevel: 13, maxLevel: Infinity, min: 1, max: 3 }),
  ]),
  [COLLECTIBLE_TYPES.TIME_FRAGMENT]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 12, min: 1, max: 2 }),
    Object.freeze({ minLevel: 13, maxLevel: Infinity, min: 1, max: 3 }),
  ]),
  [COLLECTIBLE_TYPES.WATCHERS_EYE]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 12, min: 1, max: 2 }),
    Object.freeze({ minLevel: 13, maxLevel: Infinity, min: 1, max: 3 }),
  ]),
  [COLLECTIBLE_TYPES.ECHO_PULSE]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 12, min: 1, max: 2 }),
    Object.freeze({ minLevel: 13, maxLevel: Infinity, min: 1, max: 3 }),
  ]),
  [COLLECTIBLE_TYPES.SPIRIT_LANTERN]: Object.freeze([
    Object.freeze({ minLevel: 1, maxLevel: 15, min: 1, max: 2 }),
    Object.freeze({ minLevel: 16, maxLevel: Infinity, min: 1, max: 3 }),
  ]),
})

/**
 * Centralized, configurable collectible category selection and allocation settings.
 * Always keeps all 4 permanent categories and randomly selects 4 of 8 optional categories.
 */
export const DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG = Object.freeze({
  permanentCategories: PERMANENT_COLLECTIBLE_CATEGORIES,
  optionalCategories: OPTIONAL_COLLECTIBLE_CATEGORIES,
  optionalSelectionCount: OPTIONAL_COLLECTIBLE_PICK_COUNT,
  forcedOptionalCategories: null,
  quantitySettings: DEFAULT_COLLECTIBLE_QUANTITY_SETTINGS,
  perCategoryQuantities: null,
  maxTotalCollectibleItems: 64,
  maxWalkableOccupancyRatio: 0.44,
  maxKeycards: 8,
  maxKeycardWalkableRatio: 0.25,
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
 * Resolves and sanitizes collectible progression overrides against
 * `DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG`.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
export function resolveCollectibleProgressionConfig(overrides = {}) {
  const src = overrides && typeof overrides === 'object' ? overrides : {}

  const rawPermanent =
    Array.isArray(src.permanentCategories) && src.permanentCategories.length > 0
      ? src.permanentCategories
      : DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG.permanentCategories
  const permanentCategories = Array.from(
    new Set(rawPermanent.filter((c) => typeof c === 'string' && c.trim().length > 0))
  )
  const permanentSet = new Set(permanentCategories)

  const rawOptional =
    Array.isArray(src.optionalCategories) && src.optionalCategories.length > 0
      ? src.optionalCategories
      : DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG.optionalCategories
  const optionalCategories = Array.from(
    new Set(
      rawOptional.filter(
        (c) => typeof c === 'string' && c.trim().length > 0 && !permanentSet.has(c)
      )
    )
  )

  const rawOptionalCount = Number.isFinite(src.optionalSelectionCount)
    ? Math.floor(src.optionalSelectionCount)
    : DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG.optionalSelectionCount
  const optionalSelectionCount = Math.max(
    0,
    Math.min(optionalCategories.length, rawOptionalCount)
  )

  const optionalSet = new Set(optionalCategories)
  const forcedOptionalCategories = Array.isArray(src.forcedOptionalCategories)
    ? Array.from(
        new Set(
          src.forcedOptionalCategories.filter(
            (c) => typeof c === 'string' && optionalSet.has(c)
          )
        )
      )
    : null

  const quantitySettings =
    src.quantitySettings && typeof src.quantitySettings === 'object'
      ? { ...DEFAULT_COLLECTIBLE_QUANTITY_SETTINGS, ...src.quantitySettings }
      : DEFAULT_COLLECTIBLE_QUANTITY_SETTINGS

  const perCategoryQuantities =
    src.perCategoryQuantities &&
    (typeof src.perCategoryQuantities === 'object' ||
      typeof src.perCategoryQuantities === 'function')
      ? src.perCategoryQuantities
      : null

  const maxTotalCollectibleItems =
    Number.isFinite(src.maxTotalCollectibleItems) && src.maxTotalCollectibleItems >= 1
      ? Math.floor(src.maxTotalCollectibleItems)
      : DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG.maxTotalCollectibleItems

  const maxWalkableOccupancyRatio =
    typeof src.maxWalkableOccupancyRatio === 'number' &&
    Number.isFinite(src.maxWalkableOccupancyRatio) &&
    src.maxWalkableOccupancyRatio > 0 &&
    src.maxWalkableOccupancyRatio <= 1
      ? src.maxWalkableOccupancyRatio
      : DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG.maxWalkableOccupancyRatio

  const maxKeycards =
    Number.isFinite(src.maxKeycards) && src.maxKeycards >= 1
      ? Math.floor(src.maxKeycards)
      : DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG.maxKeycards

  const maxKeycardWalkableRatio =
    typeof src.maxKeycardWalkableRatio === 'number' &&
    Number.isFinite(src.maxKeycardWalkableRatio) &&
    src.maxKeycardWalkableRatio > 0 &&
    src.maxKeycardWalkableRatio <= 1
      ? src.maxKeycardWalkableRatio
      : DEFAULT_COLLECTIBLE_PROGRESSION_CONFIG.maxKeycardWalkableRatio

  return {
    permanentCategories,
    optionalCategories,
    optionalSelectionCount,
    forcedOptionalCategories,
    quantitySettings,
    perCategoryQuantities,
    maxTotalCollectibleItems,
    maxWalkableOccupancyRatio,
    maxKeycards,
    maxKeycardWalkableRatio,
  }
}

function resolveSeedAndLevel(params = {}) {
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

  return { safeParams, normLevel, normBaseSeed, resolvedSeed }
}

/**
 * Stage 1: Deterministically selects collectible categories for a level using an
 * isolated collectible-selection PRNG stream.
 *
 * Always includes all 4 permanent categories (`soul_shards`, `health_capsule`,
 * `resonance_keycard`, `echo_reveal`) and randomly selects 4 of 8 optional
 * categories without replacement. No unlock schedules are applied.
 *
 * @param {object} [params]
 * @returns {object}
 */
export function selectCollectibleCategoriesForLevel(params = {}) {
  const { safeParams, normLevel, resolvedSeed } = resolveSeedAndLevel(params)
  const cfg = resolveCollectibleProgressionConfig(safeParams.collectibleConfig)

  const selectionSeed = `collectible-selection:level:${normLevel}:seed:${resolvedSeed}`
  const selectionRng = createRng(selectionSeed)
  const shuffledOptionals = shuffleWithRng(cfg.optionalCategories, selectionRng)

  let selectedOptionalCategories
  if (cfg.forcedOptionalCategories && cfg.forcedOptionalCategories.length > 0) {
    const forced = cfg.forcedOptionalCategories.slice(0, cfg.optionalSelectionCount)
    const forcedSet = new Set(forced)
    const remainder = shuffledOptionals.filter((c) => !forcedSet.has(c))
    selectedOptionalCategories = [...forced, ...remainder].slice(
      0,
      cfg.optionalSelectionCount
    )
  } else {
    selectedOptionalCategories = shuffledOptionals.slice(0, cfg.optionalSelectionCount)
  }

  const selectedOptionalSet = new Set(selectedOptionalCategories)
  const unselectedOptionalCategories = cfg.optionalCategories.filter(
    (c) => !selectedOptionalSet.has(c)
  )

  const selectedCategories = [
    ...cfg.permanentCategories,
    ...selectedOptionalCategories,
  ]
  const selectedItemCategories = selectedCategories.filter(
    (c) => c !== KEYCARD_COLLECTIBLE_TYPE
  )

  return {
    level: normLevel,
    seed: resolvedSeed,
    selectionSeed,
    permanentCategories: [...cfg.permanentCategories],
    optionalCategoriesPool: [...cfg.optionalCategories],
    selectedOptionalCategories,
    unselectedOptionalCategories,
    selectedCategories,
    selectedItemCategories,
    keycardSelected: cfg.permanentCategories.includes(KEYCARD_COLLECTIBLE_TYPE),
    totalAvailableCategories:
      cfg.permanentCategories.length + cfg.optionalCategories.length,
    activeCategoryCount: selectedCategories.length,
  }
}

function normalizeQuantityRange(rawRange, fallbackMin = 1, fallbackMax = 2) {
  if (Number.isFinite(rawRange)) {
    const val = Math.max(0, Math.floor(rawRange))
    return { min: val, max: val }
  }
  if (rawRange && typeof rawRange === 'object') {
    const min = Number.isFinite(rawRange.min)
      ? Math.max(0, Math.floor(rawRange.min))
      : fallbackMin
    const rawMax = Number.isFinite(rawRange.max)
      ? Math.max(min, Math.floor(rawRange.max))
      : Math.max(min, fallbackMax)
    return { min, max: rawMax }
  }
  return { min: fallbackMin, max: Math.max(fallbackMin, fallbackMax) }
}

function getEffectiveScaleLevel(normLevel, rows, cols) {
  if (!Number.isFinite(rows) || !Number.isFinite(cols)) {
    return normLevel
  }
  const area = rows * cols
  // Cap effective quantity tier on explicitly tiny/small custom grids so smaller
  // mazes are never overwhelmed with high-level item volumes.
  if (area <= 121) return Math.min(normLevel, 5)
  if (area <= 289) return Math.min(normLevel, 10)
  if (area <= 529) return Math.min(normLevel, 20)
  return normLevel
}

function resolveCategoryRangeForLevel(category, effectiveLevel, cfg, context) {
  if (cfg.perCategoryQuantities) {
    const rawOverride =
      typeof cfg.perCategoryQuantities === 'function'
        ? cfg.perCategoryQuantities(category, context)
        : cfg.perCategoryQuantities[category]
    if (rawOverride !== undefined && rawOverride !== null) {
      return normalizeQuantityRange(rawOverride, 1, 2)
    }
  }

  const schedule = cfg.quantitySettings?.[category]
  if (Array.isArray(schedule) && schedule.length > 0) {
    for (let i = 0; i < schedule.length; i += 1) {
      const tier = schedule[i]
      if (!tier) continue
      const minL = Number.isFinite(tier.minLevel) ? tier.minLevel : 1
      const maxL =
        tier.maxLevel === Infinity || Number.isFinite(tier.maxLevel)
          ? tier.maxLevel
          : Infinity
      if (effectiveLevel >= minL && effectiveLevel <= maxL) {
        return normalizeQuantityRange(tier, 1, 2)
      }
    }
    return normalizeQuantityRange(schedule[schedule.length - 1], 1, 2)
  }

  if (schedule && typeof schedule === 'object') {
    return normalizeQuantityRange(schedule, 1, 2)
  }

  return category === COLLECTIBLE_TYPES.SOUL_SHARDS
    ? { min: 6, max: 10 }
    : { min: 1, max: 2 }
}

/**
 * Stage 2: Deterministically allocates level-aware & maze-size-aware quantities
 * for each selected category using an isolated collectible-allocation PRNG stream.
 * Never consumes selection, maze, hazard, or enemy PRNG streams.
 *
 * @param {object} [params]
 * @returns {object}
 */
export function allocateCollectibleQuantitiesForLevel(params = {}) {
  const { safeParams, normLevel, resolvedSeed } = resolveSeedAndLevel(params)
  const cfg = resolveCollectibleProgressionConfig(safeParams.collectibleConfig)

  const selection =
    safeParams.selection &&
    Array.isArray(safeParams.selection.selectedCategories) &&
    Array.isArray(safeParams.selection.selectedItemCategories)
      ? safeParams.selection
      : selectCollectibleCategoriesForLevel({
          level: normLevel,
          baseSeed: safeParams.baseSeed,
          seed: resolvedSeed,
          collectibleConfig: cfg,
        })

  const allocationSeed = `collectible-allocation:level:${normLevel}:seed:${resolvedSeed}`
  const allocationRng = createRng(allocationSeed)

  const effectiveLevel = getEffectiveScaleLevel(
    normLevel,
    safeParams.rows,
    safeParams.cols
  )

  const categoryQuantities = {}
  const categoryRanges = {}
  const itemQuantities = {}
  let keycardCount = 0

  for (let i = 0; i < selection.selectedCategories.length; i += 1) {
    const category = selection.selectedCategories[i]
    const range = resolveCategoryRangeForLevel(category, effectiveLevel, cfg, {
      level: normLevel,
      effectiveLevel,
      seed: resolvedSeed,
      rows: safeParams.rows,
      cols: safeParams.cols,
      walkableCount: safeParams.walkableCount,
    })
    categoryRanges[category] = range

    const rolled =
      range.max <= range.min
        ? range.min
        : range.min + Math.floor(allocationRng() * (range.max - range.min + 1))

    categoryQuantities[category] = rolled
    if (category === KEYCARD_COLLECTIBLE_TYPE) {
      keycardCount = rolled
    } else {
      itemQuantities[category] = rolled
    }
  }

  const estimatedWalkable = estimateMazeWalkableCells(
    safeParams.rows,
    safeParams.cols,
    safeParams.walkableCount
  )
  const keycardPreCapCount = keycardCount
  const hasExplicitKeycardOverride = Boolean(
    cfg.perCategoryQuantities &&
      (typeof cfg.perCategoryQuantities === 'function'
        ? cfg.perCategoryQuantities(KEYCARD_COLLECTIBLE_TYPE, {
            level: normLevel,
            effectiveLevel,
            seed: resolvedSeed,
            rows: safeParams.rows,
            cols: safeParams.cols,
            walkableCount: safeParams.walkableCount,
          }) !== undefined
        : cfg.perCategoryQuantities[KEYCARD_COLLECTIBLE_TYPE] !== undefined &&
          cfg.perCategoryQuantities[KEYCARD_COLLECTIBLE_TYPE] !== null)
  )
  const keycardCapacityCap = Math.max(
    estimatedWalkable >= 4 ? 1 : 0,
    Math.min(
      cfg.maxKeycards,
      Math.floor(estimatedWalkable * cfg.maxKeycardWalkableRatio)
    )
  )
  let wasKeycardCapacityCapped = false
  if (
    !hasExplicitKeycardOverride &&
    selection.keycardSelected &&
    keycardCount > keycardCapacityCap
  ) {
    keycardCount = keycardCapacityCap
    categoryQuantities[KEYCARD_COLLECTIBLE_TYPE] = keycardCount
    wasKeycardCapacityCapped = true
  }

  const occupancyCap = Math.max(
    selection.selectedItemCategories.length,
    Math.floor(estimatedWalkable * cfg.maxWalkableOccupancyRatio)
  )
  const totalItemCap = Math.min(cfg.maxTotalCollectibleItems, occupancyCap)

  let preCapItemTotal = 0
  for (let i = 0; i < selection.selectedItemCategories.length; i += 1) {
    preCapItemTotal += itemQuantities[selection.selectedItemCategories[i]] || 0
  }

  let plannedItemTotal = preCapItemTotal
  let wasCapacityCapped = false

  if (plannedItemTotal > totalItemCap) {
    wasCapacityCapped = true
    const shardType = COLLECTIBLE_TYPES.SOUL_SHARDS
    const shardMinFloor = Math.min(
      itemQuantities[shardType] || 0,
      Math.max(1, Math.min(6, Math.floor(totalItemCap * 0.35)))
    )

    // First trim extra Soul Shards down to shardMinFloor before touching tactical items
    while (
      plannedItemTotal > totalItemCap &&
      (itemQuantities[shardType] || 0) > shardMinFloor
    ) {
      itemQuantities[shardType] -= 1
      categoryQuantities[shardType] = itemQuantities[shardType]
      plannedItemTotal -= 1
    }

    // Next trim excess (>1) counts from optional / non-shard categories
    const nonShardTypes = selection.selectedItemCategories.filter(
      (c) => c !== shardType
    )
    let guard = plannedItemTotal
    while (plannedItemTotal > totalItemCap && guard > 0) {
      let trimmed = false
      for (let i = nonShardTypes.length - 1; i >= 0 && plannedItemTotal > totalItemCap; i -= 1) {
        const type = nonShardTypes[i]
        if ((itemQuantities[type] || 0) > 1) {
          itemQuantities[type] -= 1
          categoryQuantities[type] = itemQuantities[type]
          plannedItemTotal -= 1
          trimmed = true
        }
      }
      if (!trimmed && (itemQuantities[shardType] || 0) > 1) {
        itemQuantities[shardType] -= 1
        categoryQuantities[shardType] = itemQuantities[shardType]
        plannedItemTotal -= 1
        trimmed = true
      }
      if (!trimmed) break
      guard -= 1
    }
  }

  return {
    level: normLevel,
    effectiveLevel,
    seed: resolvedSeed,
    allocationSeed,
    selectedCategories: [...selection.selectedCategories],
    selectedItemCategories: [...selection.selectedItemCategories],
    selectedOptionalCategories: [...selection.selectedOptionalCategories],
    unselectedOptionalCategories: [...selection.unselectedOptionalCategories],
    categoryRanges,
    categoryQuantities,
    itemQuantities,
    keycardCount,
    keycardPreCapCount,
    keycardCapacityCap,
    wasKeycardCapacityCapped,
    totalTargetItems: plannedItemTotal,
    totalTargetCollectibles: plannedItemTotal + keycardCount,
    totalItemCap,
    preCapItemTotal,
    wasCapacityCapped,
  }
}

export const ENEMY_PROGRESSION_SCHEDULE = Object.freeze([
  Object.freeze({ minLevel: 1, maxLevel: 5, archetypes: ['stalker', 'hunter'], minCount: 2, maxCount: 5 }),
  Object.freeze({ minLevel: 6, maxLevel: 10, archetypes: ['stalker', 'hunter'], minCount: 5, maxCount: 7 }),
  Object.freeze({ minLevel: 11, maxLevel: 15, archetypes: ['stalker', 'hunter', 'brute'], minCount: 6, maxCount: 9 }),
  Object.freeze({ minLevel: 16, maxLevel: 20, archetypes: ['stalker', 'hunter', 'brute'], minCount: 8, maxCount: 11 }),
  Object.freeze({ minLevel: 21, maxLevel: 25, archetypes: ['stalker', 'hunter', 'brute'], minCount: 10, maxCount: 13 }),
  Object.freeze({ minLevel: 26, maxLevel: 50, archetypes: ['stalker', 'hunter', 'brute'], minCount: 12, maxCount: 18 }),
  Object.freeze({ minLevel: 51, maxLevel: Infinity, archetypes: ['stalker', 'hunter', 'brute'], minCount: 16, maxCount: 24 }),
])

export const DEFAULT_ENEMY_PROGRESSION_CONFIG = Object.freeze({
  schedule: ENEMY_PROGRESSION_SCHEDULE,
  maxTotalEnemies: 24,
  maxWalkableOccupancyRatio: 0.22,
})

export function resolveEnemyProgressionConfig(overrides = {}) {
  const src = overrides && typeof overrides === 'object' ? overrides : {}
  return {
    schedule: Array.isArray(src.schedule) && src.schedule.length > 0 ? src.schedule : ENEMY_PROGRESSION_SCHEDULE,
    maxTotalEnemies: Number.isFinite(src.maxTotalEnemies) && src.maxTotalEnemies >= 1 ? Math.floor(src.maxTotalEnemies) : DEFAULT_ENEMY_PROGRESSION_CONFIG.maxTotalEnemies,
    maxWalkableOccupancyRatio: typeof src.maxWalkableOccupancyRatio === 'number' && Number.isFinite(src.maxWalkableOccupancyRatio) && src.maxWalkableOccupancyRatio > 0 && src.maxWalkableOccupancyRatio <= 1 ? src.maxWalkableOccupancyRatio : DEFAULT_ENEMY_PROGRESSION_CONFIG.maxWalkableOccupancyRatio,
  }
}

export function selectEnemiesForLevel(params = {}) {
  const { safeParams, normLevel, resolvedSeed } = resolveSeedAndLevel(params)
  const cfg = resolveEnemyProgressionConfig(safeParams.enemyConfig ?? safeParams.enemyProgression)
  const scheduleTier = cfg.schedule.find(
    (tier) => normLevel >= (tier.minLevel ?? 1) && normLevel <= (tier.maxLevel ?? Infinity)
  ) || cfg.schedule[cfg.schedule.length - 1]

  const archetypes = [...(scheduleTier.archetypes || ['stalker', 'hunter', 'brute'])]
  const selectionSeed = `enemy-selection:level:${normLevel}:seed:${resolvedSeed}`

  return {
    level: normLevel,
    seed: resolvedSeed,
    selectionSeed,
    archetypes,
    hasBrute: archetypes.includes('brute'),
  }
}

export function allocateEnemyQuantitiesForLevel(params = {}) {
  const { safeParams, normLevel, resolvedSeed } = resolveSeedAndLevel(params)
  const cfg = resolveEnemyProgressionConfig(safeParams.enemyConfig ?? safeParams.enemyProgression)
  const selection = safeParams.selection || selectEnemiesForLevel(params)

  const scheduleTier = cfg.schedule.find(
    (tier) => normLevel >= (tier.minLevel ?? 1) && normLevel <= (tier.maxLevel ?? Infinity)
  ) || cfg.schedule[cfg.schedule.length - 1]

  const allocationSeed = `enemy-allocation:level:${normLevel}:seed:${resolvedSeed}`
  const rng = createRng(allocationSeed)

  const minC = scheduleTier.minCount ?? 2
  const maxC = scheduleTier.maxCount ?? 5
  let targetCount = minC >= maxC ? minC : minC + Math.floor(rng() * (maxC - minC + 1))

  if (normLevel === 1) {
    targetCount = Math.min(5, Math.max(2, targetCount))
  }

  const estimatedWalkable = estimateMazeWalkableCells(
    safeParams.rows,
    safeParams.cols,
    safeParams.walkableCount
  )
  const capacityCap = Math.max(
    selection.archetypes.length,
    Math.min(cfg.maxTotalEnemies, Math.floor(estimatedWalkable * cfg.maxWalkableOccupancyRatio))
  )

  let wasCapacityCapped = false
  if (targetCount > capacityCap) {
    targetCount = Math.max(selection.archetypes.length, capacityCap)
    wasCapacityCapped = true
  }

  const archetypes = selection.archetypes
  const counts = {}
  for (const a of archetypes) {
    counts[a] = 0
  }

  if (!selection.hasBrute) {
    for (let i = 0; i < targetCount; i += 1) {
      const type = i % 2 === 0 ? 'stalker' : 'hunter'
      counts[type] += 1
    }
  } else if (normLevel >= 11 && normLevel <= 15) {
    const bruteCount = targetCount >= 8 ? 2 : 1
    counts['brute'] = bruteCount
    let rem = targetCount - bruteCount
    for (let i = 0; i < rem; i += 1) {
      const type = i % 2 === 0 ? 'hunter' : 'stalker'
      counts[type] += 1
    }
  } else {
    let bruteCount = Math.max(1, Math.floor(targetCount * 0.3))
    if (bruteCount >= targetCount) bruteCount = Math.max(1, targetCount - 2)
    counts['brute'] = bruteCount
    let rem = targetCount - bruteCount
    for (let i = 0; i < rem; i += 1) {
      const type = i % 2 === 0 ? 'hunter' : 'stalker'
      counts[type] += 1
    }
  }

  if (targetCount >= archetypes.length) {
    for (const a of archetypes) {
      if ((counts[a] || 0) === 0) {
        const maxType = Object.keys(counts).reduce((max, k) => counts[k] > counts[max] ? k : max, archetypes[0])
        if (counts[maxType] > 1) {
          counts[maxType] -= 1
          counts[a] += 1
        }
      }
    }
  }

  const rosterList = []
  for (const a of archetypes) {
    const c = counts[a] || 0
    for (let i = 0; i < c; i += 1) {
      rosterList.push(a)
    }
  }

  return {
    level: normLevel,
    seed: resolvedSeed,
    allocationSeed,
    archetypes: [...archetypes],
    targetCount,
    archetypeCounts: counts,
    roster: rosterList,
    capacityCap,
    wasCapacityCapped,
  }
}

export const DEFAULT_HIDING_PROGRESSION_CONFIG = Object.freeze({
  availableTypes: ALL_HIDING_SPOT_TYPES,
  selectionCount: 4,
  minInstancesPerType: 2,
  baseInstancesPerType: 2,
  maxInstancesPerType: 5,
  maxTotalHidingSpots: 24,
})

export function resolveHidingProgressionConfig(overrides = {}) {
  const src = overrides && typeof overrides === 'object' ? overrides : {}
  return {
    availableTypes: Array.isArray(src.availableTypes) && src.availableTypes.length > 0 ? src.availableTypes : ALL_HIDING_SPOT_TYPES,
    selectionCount: Number.isInteger(src.selectionCount) && src.selectionCount >= 1 ? Math.floor(src.selectionCount) : DEFAULT_HIDING_PROGRESSION_CONFIG.selectionCount,
    minInstancesPerType: Number.isInteger(src.minInstancesPerType) && src.minInstancesPerType >= 1 ? Math.floor(src.minInstancesPerType) : DEFAULT_HIDING_PROGRESSION_CONFIG.minInstancesPerType,
    maxInstancesPerType: Number.isInteger(src.maxInstancesPerType) && src.maxInstancesPerType >= 2 ? Math.floor(src.maxInstancesPerType) : DEFAULT_HIDING_PROGRESSION_CONFIG.maxInstancesPerType,
    maxTotalHidingSpots: Number.isInteger(src.maxTotalHidingSpots) && src.maxTotalHidingSpots >= 1 ? Math.floor(src.maxTotalHidingSpots) : DEFAULT_HIDING_PROGRESSION_CONFIG.maxTotalHidingSpots,
  }
}

export function selectHidingSpotTypesForLevel(params = {}) {
  const { safeParams, normLevel, resolvedSeed } = resolveSeedAndLevel(params)
  const cfg = resolveHidingProgressionConfig(safeParams.hidingConfig ?? safeParams.hidingProgression)
  const selectionSeed = `hiding-selection:level:${normLevel}:seed:${resolvedSeed}`
  const rng = createRng(selectionSeed)
  const shuffled = shuffleWithRng([...cfg.availableTypes], rng)
  const pickCount = Math.min(cfg.availableTypes.length, cfg.selectionCount)
  const selectedTypes = shuffled.slice(0, pickCount).sort()
  const selectedSet = new Set(selectedTypes)
  const unselectedTypes = cfg.availableTypes.filter((t) => !selectedSet.has(t)).sort()

  return {
    level: normLevel,
    seed: resolvedSeed,
    selectionSeed,
    selectedTypes,
    unselectedTypes,
    activeTypeCount: selectedTypes.length,
  }
}

export function allocateHidingSpotQuantitiesForLevel(params = {}) {
  const { safeParams, normLevel, resolvedSeed } = resolveSeedAndLevel(params)
  const cfg = resolveHidingProgressionConfig(safeParams.hidingConfig ?? safeParams.hidingProgression)
  const selection = safeParams.selection || selectHidingSpotTypesForLevel(params)
  const allocationSeed = `hiding-allocation:level:${normLevel}:seed:${resolvedSeed}`
  const rng = createRng(allocationSeed)

  const minCount = cfg.minInstancesPerType
  let scaledMax = cfg.maxInstancesPerType
  if (normLevel <= 5) {
    scaledMax = Math.min(scaledMax, minCount)
  } else if (normLevel <= 10) {
    scaledMax = Math.min(scaledMax, minCount + 1)
  } else if (normLevel <= 20) {
    scaledMax = Math.min(scaledMax, minCount + 2)
  }
  const maxCount = Math.max(minCount, scaledMax)

  const estimatedWalkable = estimateMazeWalkableCells(
    safeParams.rows,
    safeParams.cols,
    safeParams.walkableCount
  )
  const capacityCap = Math.max(
    selection.selectedTypes.length * minCount,
    Math.min(cfg.maxTotalHidingSpots, Math.floor(estimatedWalkable * 0.25))
  )

  const typeQuantities = {}
  let totalTargetSpots = 0

  for (let i = 0; i < selection.selectedTypes.length; i += 1) {
    const type = selection.selectedTypes[i]
    const count = minCount >= maxCount ? minCount : minCount + Math.floor(rng() * (maxCount - minCount + 1))
    typeQuantities[type] = count
    totalTargetSpots += count
  }

  const effectiveCap = Math.min(cfg.maxTotalHidingSpots, capacityCap)
  if (totalTargetSpots > effectiveCap) {
    let excess = totalTargetSpots - effectiveCap
    while (excess > 0) {
      let trimmed = false
      for (let i = selection.selectedTypes.length - 1; i >= 0 && excess > 0; i -= 1) {
        const type = selection.selectedTypes[i]
        if (typeQuantities[type] > minCount) {
          typeQuantities[type] -= 1
          totalTargetSpots -= 1
          excess -= 1
          trimmed = true
        }
      }
      if (!trimmed || excess <= 0) break
    }
  }

  return {
    level: normLevel,
    seed: resolvedSeed,
    allocationSeed,
    selectedTypes: [...selection.selectedTypes],
    typeQuantities,
    totalTargetSpots,
    capacityCap,
  }
}

/**
 * Returns the centralized level configuration descriptor for a given level.
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

  const collectibleConfig =
    progressionConfig?.collectibles ??
    progressionConfig?.collectibleConfig ??
    progressionConfig?.collectibleProgression
  const collectibleSelection = selectCollectibleCategoriesForLevel({
    level: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
    collectibleConfig,
  })
  const collectibleAllocation = allocateCollectibleQuantitiesForLevel({
    level: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
    rows: dimensions.rows,
    cols: dimensions.cols,
    selection: collectibleSelection,
    collectibleConfig,
  })

  const enemyConfig =
    progressionConfig?.enemies ??
    progressionConfig?.enemyConfig ??
    progressionConfig?.enemyProgression
  const enemySelection = selectEnemiesForLevel({
    level: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
    enemyConfig,
  })
  const enemyAllocation = allocateEnemyQuantitiesForLevel({
    level: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
    rows: dimensions.rows,
    cols: dimensions.cols,
    selection: enemySelection,
    enemyConfig,
  })

  const hidingSpotConfig =
    progressionConfig?.hidingSpots ??
    progressionConfig?.hidingSpotConfig ??
    progressionConfig?.hidingSpotProgression
  const hidingSpotSelection = selectHidingSpotTypesForLevel({
    level: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
    hidingConfig: hidingSpotConfig,
  })
  const hidingSpotAllocation = allocateHidingSpotQuantitiesForLevel({
    level: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
    rows: dimensions.rows,
    cols: dimensions.cols,
    selection: hidingSpotSelection,
    hidingConfig: hidingSpotConfig,
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
    collectibleSelection,
    collectibleAllocation,
    keycardAllocation: {
      category: KEYCARD_COLLECTIBLE_TYPE,
      allocatedCount: collectibleAllocation.keycardCount,
      preCapCount: collectibleAllocation.keycardPreCapCount,
      capacityCap: collectibleAllocation.keycardCapacityCap,
      wasCapacityCapped: collectibleAllocation.wasKeycardCapacityCapped,
      range: collectibleAllocation.categoryRanges[KEYCARD_COLLECTIBLE_TYPE] || null,
    },
    enemySelection,
    enemyAllocation,
    enemyAllocationSummary: {
      category: 'enemy',
      allocatedCount: enemyAllocation.targetCount,
      roster: enemyAllocation.roster,
      archetypeCounts: enemyAllocation.archetypeCounts,
    },
    enemyAiSummary: {
      level: normalizedLevel,
      stalker: getEnemyArchetypeConfig('stalker', normalizedLevel, enemyConfig),
      hunter: getEnemyArchetypeConfig('hunter', normalizedLevel, enemyConfig),
      brute: getEnemyArchetypeConfig('brute', normalizedLevel, enemyConfig),
    },
    hidingSpotSelection,
    hidingSpotAllocation,
  }
}


