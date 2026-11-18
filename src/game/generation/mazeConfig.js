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
  small: {
    key: 'small',
    label: 'Small',
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
  large: {
    key: 'large',
    label: 'Large',
    tierName: 'Deep Crypts',
    rows: 23,
    cols: 23,
    braidFactor: 0.14,
    description: 'Dense 23×23 slate maze built for spatial mastery.',
  },
}

export const DIFFICULTY_ORDER = ['small', 'medium', 'large']

export function getMazePreset(difficulty = 'medium') {
  return MAZE_DIFFICULTIES[difficulty] || MAZE_DIFFICULTIES.medium
}

export function normalizeDimension(value, fallback = 11) {
  const parsed = Number.isInteger(value) ? value : fallback
  const clamped = Math.max(5, Math.min(parsed, 51))
  return clamped % 2 === 0 ? clamped + 1 : clamped
}
