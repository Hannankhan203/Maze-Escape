/**
 * Maze difficulty and dimension presets for Maze Escape — Lumen Vault.
 * Grid dimensions are odd integers so outer walls seal cleanly and corridors
 * alternate 1-cell walls and 1-cell pathways.
 */

export const CELL_TYPES = {
  PATH: 0,
  WALL: 1,
}

export const MAZE_DIFFICULTIES = {
  easy: {
    key: 'easy',
    label: 'Easy',
    tierName: 'Shallow Steps',
    rows: 11,
    cols: 11,
    braidFactor: 0,
    description: 'Compact 11×11 chamber ideal for quick runs.',
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    tierName: 'Braided Vaults',
    rows: 17,
    cols: 17,
    braidFactor: 0.08,
    description: 'Balanced 17×17 labyrinth with branching corridors.',
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    tierName: 'Deep Crypts',
    rows: 23,
    cols: 23,
    braidFactor: 0.14,
    description: 'Dense 23×23 slate maze built for spatial mastery.',
  },
  hardcore: {
    key: 'hardcore',
    label: 'Hardcore',
    tierName: 'Abyssal Core',
    rows: 31,
    cols: 31,
    braidFactor: 0.18,
    description: 'Expansive 31×31 high-threat labyrinth built for endurance.',
  },
}

export const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'hardcore']

const LEGACY_DIFFICULTY_ALIASES = {
  small: 'easy',
  large: 'hard',
}

export function normalizeMazeDifficulty(difficulty = 'medium') {
  if (typeof difficulty === 'string') {
    if (difficulty in MAZE_DIFFICULTIES) return difficulty
    const lower = difficulty.toLowerCase()
    if (lower in MAZE_DIFFICULTIES) return lower
    if (lower in LEGACY_DIFFICULTY_ALIASES) {
      return LEGACY_DIFFICULTY_ALIASES[lower]
    }
  }
  return 'medium'
}

export function getMazePreset(difficulty = 'medium') {
  return MAZE_DIFFICULTIES[normalizeMazeDifficulty(difficulty)]
}

export function normalizeDimension(value, fallback = 11) {
  const parsed = Number.isInteger(value) ? value : fallback
  const clamped = Math.max(5, Math.min(parsed, 51))
  return clamped % 2 === 0 ? clamped + 1 : clamped
}
