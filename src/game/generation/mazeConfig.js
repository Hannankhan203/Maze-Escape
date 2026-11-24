/**
 * Maze dimension presets for Maze Escape — Lumen Vault.
 * Grid dimensions are odd integers so outer walls seal cleanly and corridors
 * alternate 1-cell walls and 1-cell pathways.
 */

export const CELL_TYPES = {
  PATH: 0,
  WALL: 1,
}

export const STANDARD_MAZE_CONFIG = {
  rows: 17,
  cols: 17,
  braidFactor: 0.08,
  label: 'Labyrinth Vault',
  tierName: 'Braided Vaults',
}

export function normalizeDimension(value, fallback = 17) {
  const parsed = Number.isInteger(value) ? value : fallback
  const clamped = Math.max(5, Math.min(parsed, 51))
  return clamped % 2 === 0 ? clamped + 1 : clamped
}
