import { findShortestPath } from '../generation/pathfinder.js'
import { CELL_SIZE } from '../world/worldCoords.js'

export const DEFAULT_MAX_WAYFINDER_HINTS = 3
export const WAYFINDER_HINT_DURATION_MS = 5000

const DIRECTION_LABELS = {
  north: 'North',
  south: 'South',
  east: 'East',
  west: 'West',
  here: 'Here',
}

const RELATIVE_DIRECTION_LABELS = {
  ahead: 'Ahead',
  right: 'Right',
  left: 'Left',
  behind: 'Behind',
  here: 'Here',
}

export function normalizeAngleRad(angleRad) {
  const num = Number(angleRad)
  if (!Number.isFinite(num)) return 0
  let a = num % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  if (a < -Math.PI) a += Math.PI * 2
  return a
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
 * Computes the direction and angular bearing of `toCell` relative to the player's
 * current facing orientation (`yaw`), where `yaw = 0` faces North (-row) and
 * `yaw = -Math.PI / 2` faces East (+col), matching CameraRig and Minimap conventions.
 */
export function computeRelativeDirection(
  fromCell,
  toCell,
  yaw = 0,
  options = {}
) {
  if (!fromCell || !toCell) {
    return {
      relativeDirection: 'here',
      relativeLabel: 'Here',
      relativeBearingRad: 0,
    }
  }

  let fromCol = Number.isFinite(fromCell.col) ? fromCell.col + 0.5 : 0
  let fromRow = Number.isFinite(fromCell.row) ? fromCell.row + 0.5 : 0

  const { playerWorldPos = null, maze = null } = options
  if (
    playerWorldPos &&
    Number.isFinite(playerWorldPos.x) &&
    Number.isFinite(playerWorldPos.z) &&
    Array.isArray(maze?.grid) &&
    maze.grid.length > 0 &&
    Array.isArray(maze.grid[0])
  ) {
    const rows = maze.grid.length
    const cols = maze.grid[0].length
    const originX = -(cols * CELL_SIZE) / 2
    const originZ = -(rows * CELL_SIZE) / 2
    fromCol = (playerWorldPos.x - originX) / CELL_SIZE
    fromRow = (playerWorldPos.z - originZ) / CELL_SIZE
  }

  const toCol = Number.isFinite(toCell.col) ? toCell.col + 0.5 : fromCol
  const toRow = Number.isFinite(toCell.row) ? toCell.row + 0.5 : fromRow

  const dx = toCol - fromCol
  const dy = toRow - fromRow

  if (
    (fromCell.row === toCell.row && fromCell.col === toCell.col) ||
    Math.hypot(dx, dy) < 1e-4
  ) {
    return {
      relativeDirection: 'here',
      relativeLabel: 'Here',
      relativeBearingRad: 0,
    }
  }

  const safeYaw = Number.isFinite(yaw) ? yaw : 0
  const headingX = -Math.sin(safeYaw)
  const headingY = -Math.cos(safeYaw)
  const rightX = -headingY
  const rightY = headingX

  const forwardDot = dx * headingX + dy * headingY
  const rightDot = dx * rightX + dy * rightY
  const relativeBearingRad = normalizeAngleRad(Math.atan2(rightDot, forwardDot))

  let relativeDirection
  const absAngle = Math.abs(relativeBearingRad)
  if (absAngle <= Math.PI / 4 + 1e-6) {
    relativeDirection = 'ahead'
  } else if (absAngle >= (3 * Math.PI) / 4 - 1e-6) {
    relativeDirection = 'behind'
  } else if (relativeBearingRad > 0) {
    relativeDirection = 'right'
  } else {
    relativeDirection = 'left'
  }

  return {
    relativeDirection,
    relativeLabel: RELATIVE_DIRECTION_LABELS[relativeDirection] || 'Ahead',
    relativeBearingRad,
  }
}

/**
 * Resolves the authoritative navigation objective target without exposing the full path.
 * - Prioritizes the nearest reachable uncollected keycard while objectives are active and the exit is locked.
 * - Switches automatically to the exit gate once all required keycards are collected or objectives are disabled.
 */
export function resolveWayfinderObjectiveTarget({
  maze,
  playerCell,
  keycards = [],
  objectivesEnabled = false,
  isExitLocked = false,
} = {}) {
  if (
    !maze?.grid ||
    !Array.isArray(maze.grid) ||
    maze.grid.length === 0 ||
    !playerCell ||
    !Number.isInteger(playerCell.row) ||
    !Number.isInteger(playerCell.col)
  ) {
    return {
      found: false,
      targetType: null,
      targetId: null,
      targetCell: null,
      nextStep: null,
      distanceSteps: 0,
      remainingObjectives: 0,
    }
  }

  const validKeycards = Array.isArray(keycards)
    ? keycards.filter(
        (k) => k && Number.isInteger(k.row) && Number.isInteger(k.col)
      )
    : []

  const hasPendingKeycards =
    Boolean(objectivesEnabled) &&
    Boolean(isExitLocked) &&
    validKeycards.length > 0

  let bestPathResult = null
  let targetType = null
  let targetId = null
  let targetCell = null

  if (hasPendingKeycards) {
    for (let i = 0; i < validKeycards.length; i += 1) {
      const candidate = validKeycards[i]
      const res = findShortestPath(maze.grid, playerCell, candidate)
      if (
        res.found &&
        (!bestPathResult || res.distance < bestPathResult.distance)
      ) {
        bestPathResult = res
        targetType = 'keycard'
        targetId = candidate.id || `keycard-${candidate.row}-${candidate.col}`
        targetCell = { row: candidate.row, col: candidate.col }
      }
    }
  }

  if (
    !bestPathResult &&
    maze.exit &&
    Number.isInteger(maze.exit.row) &&
    Number.isInteger(maze.exit.col)
  ) {
    const exitRes = findShortestPath(maze.grid, playerCell, maze.exit)
    if (exitRes.found) {
      bestPathResult = exitRes
      targetType = 'exit'
      targetId = 'exit'
      targetCell = { row: maze.exit.row, col: maze.exit.col }
    }
  }

  if (!bestPathResult || !bestPathResult.found || !targetCell) {
    return {
      found: false,
      targetType: null,
      targetId: null,
      targetCell: null,
      nextStep: null,
      distanceSteps: 0,
      remainingObjectives: hasPendingKeycards ? validKeycards.length : 0,
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

  return {
    found: true,
    targetType,
    targetId,
    targetCell,
    nextStep,
    distanceSteps: Math.max(0, bestPathResult.distance),
    remainingObjectives: hasPendingKeycards ? validKeycards.length : 0,
  }
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
  playerWorldPos = null,
  yaw = 0,
  keycards = [],
  objectivesEnabled = false,
  isExitLocked = false,
} = {}) {
  if (!maze?.grid || !playerCell) {
    return {
      found: false,
      targetType: null,
      targetId: null,
      direction: 'here',
      cardinalLabel: 'Here',
      targetDirection: 'here',
      targetCardinalLabel: 'Here',
      relativeDirection: 'here',
      relativeLabel: 'Here',
      relativeBearingRad: 0,
      targetRelativeBearingRad: 0,
      nextStep: null,
      distanceSteps: 0,
      remainingObjectives: 0,
      label: 'Wayfinder unavailable',
    }
  }

  const resolved = resolveWayfinderObjectiveTarget({
    maze,
    playerCell,
    keycards,
    objectivesEnabled,
    isExitLocked,
  })

  if (!resolved.found || !resolved.nextStep) {
    return {
      found: false,
      targetType: null,
      targetId: null,
      direction: 'here',
      cardinalLabel: 'Here',
      targetDirection: 'here',
      targetCardinalLabel: 'Here',
      relativeDirection: 'here',
      relativeLabel: 'Here',
      relativeBearingRad: 0,
      targetRelativeBearingRad: 0,
      nextStep: null,
      distanceSteps: 0,
      remainingObjectives: resolved.remainingObjectives || 0,
      label: 'No route signal detected',
    }
  }

  const {
    targetType,
    targetId,
    targetCell,
    nextStep,
    distanceSteps,
    remainingObjectives,
  } = resolved

  const direction = computeCardinalDirection(playerCell, nextStep)
  const cardinalLabel = DIRECTION_LABELS[direction] || 'Ahead'
  const targetDirection = computeCardinalDirection(playerCell, targetCell)
  const targetCardinalLabel = DIRECTION_LABELS[targetDirection] || cardinalLabel

  const stepRel = computeRelativeDirection(playerCell, nextStep, yaw, {
    playerWorldPos,
    maze,
  })
  const targetRel = computeRelativeDirection(playerCell, targetCell, yaw, {
    playerWorldPos,
    maze,
  })

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
    targetId,
    direction,
    cardinalLabel,
    targetDirection,
    targetCardinalLabel,
    relativeDirection: stepRel.relativeDirection,
    relativeLabel: stepRel.relativeLabel,
    relativeBearingRad: stepRel.relativeBearingRad,
    targetRelativeBearingRad: targetRel.relativeBearingRad,
    nextStep,
    distanceSteps,
    remainingObjectives,
    label,
  }
}

