import { findShortestPath } from '../generation/pathfinder.js'

export const DEFAULT_MAX_WAYFINDER_HINTS = 3
export const WAYFINDER_HINT_DURATION_MS = 5000

const DIRECTION_LABELS = {
  north: 'North',
  south: 'South',
  east: 'East',
  west: 'West',
  here: 'Here',
}

export function computeCardinalDirection(fromCell, toCell) {
  if (!fromCell || !toCell) return 'here'
  const dRow = toCell.row - fromCell.row
  const dCol = toCell.col - fromCell.col

  if (dRow === 0 && dCol === 0) return 'here'
  if (Math.abs(dRow) >= Math.abs(dCol)) {
    return dRow < 0 ? 'north' : 'south'
  }
  return dCol > 0 ? 'east' : 'west'
}

/**
 * Computes a limited, privacy-safe guidance hint using BFS pathfinding without
 * leaking unexplored maze corridors or enemy positions.
 *
 * - If objectives are enabled and the exit gate is locked with remaining keycards,
 *   guides toward the nearest uncollected Resonance Keycard.
 * - Otherwise guides toward the unlocked exit gate.
 */
export function computeWayfinderHint({
  maze,
  playerCell,
  keycards = [],
  objectivesEnabled = false,
  isExitLocked = false,
} = {}) {
  if (!maze?.grid || !playerCell) {
    return {
      found: false,
      targetType: null,
      direction: 'here',
      cardinalLabel: 'Here',
      nextStep: null,
      distanceSteps: 0,
      label: 'Wayfinder unavailable',
    }
  }

  const hasPendingKeycards =
    Boolean(objectivesEnabled) &&
    Boolean(isExitLocked) &&
    Array.isArray(keycards) &&
    keycards.length > 0

  let bestPathResult = null
  let targetType = 'exit'

  if (hasPendingKeycards) {
    targetType = 'keycard'
    for (let i = 0; i < keycards.length; i += 1) {
      const candidate = keycards[i]
      if (!candidate) continue
      const res = findShortestPath(maze.grid, playerCell, candidate)
      if (
        res.found &&
        (!bestPathResult || res.distance < bestPathResult.distance)
      ) {
        bestPathResult = res
      }
    }
  }

  if (!bestPathResult && maze.exit) {
    targetType = 'exit'
    const exitRes = findShortestPath(maze.grid, playerCell, maze.exit)
    if (exitRes.found) {
      bestPathResult = exitRes
    }
  }

  if (!bestPathResult || !bestPathResult.found) {
    return {
      found: false,
      targetType: null,
      direction: 'here',
      cardinalLabel: 'Here',
      nextStep: null,
      distanceSteps: 0,
      label: 'No route signal detected',
    }
  }

  const nextStep =
    bestPathResult.path.length > 1
      ? {
          row: bestPathResult.path[1].row,
          col: bestPathResult.path[1].col,
        }
      : {
          row: playerCell.row,
          col: playerCell.col,
        }

  const direction = computeCardinalDirection(playerCell, nextStep)
  const cardinalLabel = DIRECTION_LABELS[direction] || 'Ahead'
  const distanceSteps = Math.max(0, bestPathResult.distance)
  const targetNoun =
    targetType === 'keycard'
      ? 'Nearest Keycard'
      : objectivesEnabled && isExitLocked
        ? 'Locked Exit Gate'
        : 'Exit Gate'

  const label =
    distanceSteps === 0
      ? `Arrived at ${targetNoun}`
      : `Head ${cardinalLabel} · ${targetNoun} (~${distanceSteps} step${distanceSteps === 1 ? '' : 's'})`

  return {
    found: true,
    targetType,
    direction,
    cardinalLabel,
    nextStep,
    distanceSteps,
    label,
  }
}
