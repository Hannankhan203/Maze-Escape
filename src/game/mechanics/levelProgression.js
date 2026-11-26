/**
 * Infinite Level Progression Architecture.
 *
 * Centralized configuration and calculation module for level-based settings,
 * unbounded positive integer levels, and deterministic reproducible seed derivation.
 */

import { hashSeed } from '../../utils/rng.js'

export const DEFAULT_INITIAL_LEVEL = 1
export const INITIAL_BASE_SEED = 409217

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
 * Returns the centralized level configuration descriptor for a given level.
 * Future progression phases will retrieve level-scaled hazards, enemies, collectibles,
 * and maze parameters from this centralized entry point.
 *
 * @param {number|unknown} level
 * @param {number|string|unknown} baseSeed
 * @returns {object}
 */
export function getLevelConfig(level = DEFAULT_INITIAL_LEVEL, baseSeed = INITIAL_BASE_SEED) {
  const normalizedLevel = normalizeLevel(level)
  const normalizedBase = normalizeBaseSeed(baseSeed)
  const seed = getLevelSeed(normalizedLevel, normalizedBase)

  return {
    level: normalizedLevel,
    seed,
    baseSeed: normalizedBase,
  }
}
