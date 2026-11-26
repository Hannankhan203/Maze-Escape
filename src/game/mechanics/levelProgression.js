/**
 * Infinite Level Progression Architecture.
 *
 * Centralized configuration and calculation module for level-based settings,
 * unbounded positive integer levels, deterministic reproducible seed derivation,
 * and progressive maze dimensions & braiding complexity.
 */

import { hashSeed } from '../../utils/rng.js'
import {
  DEFAULT_BASE_MAZE_DIMENSION,
  MAX_BRAID_FACTOR,
  MAX_MAZE_DIMENSION,
  MIN_BRAID_FACTOR,
  MIN_MAZE_DIMENSION,
  normalizeBraidFactor,
  normalizeDimension,
} from '../generation/mazeConfig.js'

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
 * Returns the centralized level configuration descriptor for a given level.
 * Future progression phases will retrieve level-scaled hazards, enemies, collectibles,
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
  }
}

