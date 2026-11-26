import {
  DEFAULT_INITIAL_LEVEL,
  normalizeLevel,
} from '../../game/mechanics/levelProgression.js'

/**
 * Resolves the authoritative current level from reducer state / maze metadata.
 * Never maintains duplicate or independent level state.
 *
 * @param {object} [params]
 * @param {number|string|null} [params.currentLevel]
 * @param {object|null} [params.maze]
 * @returns {number} Normalized positive integer level (>= 1)
 */
export function resolveAuthoritativeHudLevel({ currentLevel, maze } = {}) {
  if (
    currentLevel !== undefined &&
    currentLevel !== null &&
    currentLevel !== ''
  ) {
    return normalizeLevel(currentLevel)
  }
  const mazeLevel = maze?.level ?? maze?.currentLevel
  if (mazeLevel !== undefined && mazeLevel !== null && mazeLevel !== '') {
    return normalizeLevel(mazeLevel)
  }
  return DEFAULT_INITIAL_LEVEL
}

/**
 * Formats a level integer with 2-digit zero-padding for early levels (01..09)
 * and full untruncated integer digits for levels >= 10 (10, 100, 5000, 5001, ...).
 *
 * @param {number|string} level
 * @returns {string}
 */
export function formatHudLevelNumber(level) {
  const normalized = normalizeLevel(level)
  return String(normalized).padStart(2, '0')
}

/**
 * Formats the concise HUD level display string (e.g. "LEVEL 01", "LEVEL 5001").
 *
 * @param {number|string} level
 * @returns {string}
 */
export function formatHudLevelDisplay(level) {
  return `LEVEL ${formatHudLevelNumber(level)}`
}

/**
 * Formats the accessible semantic label for the current level indicator.
 *
 * @param {number|string} level
 * @returns {string}
 */
export function formatHudLevelAriaLabel(level) {
  const normalized = normalizeLevel(level)
  return `Current level: Level ${normalized}`
}
