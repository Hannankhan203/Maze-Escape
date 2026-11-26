/**
 * Maze dimension constraints and defaults for Maze Escape — Lumen Vault.
 * Grid dimensions are odd integers so outer walls seal cleanly and corridors
 * alternate 1-cell walls and 1-cell pathways.
 *
 * Safe dimension ceiling (MAX_MAZE_DIMENSION = 51):
 * - Spatial chunking (maxChunkCells = 9): 51x51 partitions into 6x6 = 36 chunks
 *   (~1,112 leaf draw nodes, ~422k tris total across culled chunks) before jumping
 *   to 7x7 = 49 chunks.
 * - Minimap legibility (154x124 desktop / 106x84 mobile landscape): 51x51 preserves
 *   >= 1.49px/cell on mobile and >= 2.27px/cell on desktop; larger grids drop
 *   below 1.4px and smear 1-cell corridors under pixel rounding.
 * - Subterranean sky dome & camera envelope: dome radius caps at 240m and camera
 *   far plane at 400m; 51x51 spans 204m (144.2m corner radius), staying safely
 *   inside the 240m sky dome even with outer terrain aprons.
 * - Procedural build & BFS latency: 51x51 builds full 3D geometry in ~1.3s and
 *   generates/validates paths in ~19ms without excessive GPU/CPU spikes.
 */

export const CELL_TYPES = {
  PATH: 0,
  WALL: 1,
}

export const MIN_MAZE_DIMENSION = 5
export const MAX_MAZE_DIMENSION = 51
export const DEFAULT_BASE_MAZE_DIMENSION = 11

export const MIN_BRAID_FACTOR = 0
export const MAX_BRAID_FACTOR = 0.35

export const MAZE_DIMENSION_CONSTRAINTS = Object.freeze({
  minDimension: MIN_MAZE_DIMENSION,
  maxDimension: MAX_MAZE_DIMENSION,
  baseDimension: DEFAULT_BASE_MAZE_DIMENSION,
  minBraidFactor: MIN_BRAID_FACTOR,
  maxBraidFactor: MAX_BRAID_FACTOR,
})

export const STANDARD_MAZE_CONFIG = {
  rows: DEFAULT_BASE_MAZE_DIMENSION,
  cols: DEFAULT_BASE_MAZE_DIMENSION,
  braidFactor: 0,
  label: 'Labyrinth Vault',
  tierName: 'Braided Vaults',
}

function toOddMinBound(value, fallback = MIN_MAZE_DIMENSION) {
  const num = Number.isFinite(value) ? Math.floor(value) : fallback
  const bounded = Math.max(MIN_MAZE_DIMENSION, num)
  return bounded % 2 === 0 ? bounded + 1 : bounded
}

function toOddMaxBound(value, minOdd, fallback = MAX_MAZE_DIMENSION) {
  const num = Number.isFinite(value) ? Math.floor(value) : fallback
  const bounded = Math.max(minOdd, num)
  return bounded % 2 === 0 ? Math.max(minOdd, bounded - 1) : bounded
}

export function normalizeDimension(
  value,
  fallback = DEFAULT_BASE_MAZE_DIMENSION,
  options = {}
) {
  const minOdd = toOddMinBound(options?.min, MIN_MAZE_DIMENSION)
  const maxOdd = toOddMaxBound(options?.max, minOdd, MAX_MAZE_DIMENSION)

  const parsedFallback = Number.isInteger(fallback)
    ? fallback
    : DEFAULT_BASE_MAZE_DIMENSION
  const parsed = Number.isInteger(value) ? value : parsedFallback
  const clamped = Math.max(minOdd, Math.min(parsed, maxOdd))
  const odd = clamped % 2 === 0 ? clamped + 1 : clamped
  return odd > maxOdd ? maxOdd : odd
}

export function normalizeBraidFactor(
  value,
  fallback = MIN_BRAID_FACTOR,
  options = {}
) {
  const minBraid =
    typeof options?.min === 'number' && Number.isFinite(options.min)
      ? Math.max(0, Math.min(1, options.min))
      : MIN_BRAID_FACTOR
  const maxBraid =
    typeof options?.max === 'number' && Number.isFinite(options.max)
      ? Math.max(minBraid, Math.min(1, options.max))
      : 1
  const numericFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? fallback
      : MIN_BRAID_FACTOR
  const numeric =
    typeof value === 'number' && Number.isFinite(value) ? value : numericFallback
  return Math.max(minBraid, Math.min(maxBraid, numeric))
}

