import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE, worldToGrid } from '../world/worldCoords.js'

export const MINIMAP_LOGICAL_SIZE = 156
export const MINIMAP_DEFAULT_WIDTH = 154
export const MINIMAP_DEFAULT_HEIGHT = 124
export const MINIMAP_MAX_DPR = 2

export const SPIRIT_LANTERN_REVEAL_RADIUS_TILES = 8
export const SPECTRAL_COMPASS_REVEAL_RADIUS_TILES = 6
export const WATCHERS_EYE_REVEAL_RADIUS_TILES = 10
export const ENEMY_DIRECT_SIGHT_RADIUS_TILES = 5

const CARDINAL_DIRS = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
]

function getGridDims(maze) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) {
    return null
  }
  return {
    rows: grid.length,
    cols: grid[0].length,
  }
}

function isInBounds(row, col, rows, cols) {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < rows &&
    col >= 0 &&
    col < cols
  )
}

/**
 * Creates a fresh fog-of-war exploration tracker for `maze`.
 * Reveals the starting cell neighborhood immediately when `maze.start` is valid.
 */
export function createExplorationState(maze, options = {}) {
  const dims = getGridDims(maze)
  const resolvedLevel =
    Number.isInteger(maze?.level) && maze.level >= 1
      ? maze.level
      : Number.isInteger(maze?.currentLevel) && maze.currentLevel >= 1
        ? maze.currentLevel
        : 1

  if (!dims) {
    return {
      mazeId: maze?.id || '',
      level: resolvedLevel,
      seed: maze?.seed ?? null,
      rows: 0,
      cols: 0,
      discovered: new Uint8Array(0),
      discoveredCount: 0,
      minRow: 0,
      maxRow: -1,
      minCol: 0,
      maxCol: -1,
    }
  }

  const state = {
    mazeId: maze?.id || '',
    level: resolvedLevel,
    seed: maze?.seed ?? null,
    rows: dims.rows,
    cols: dims.cols,
    discovered: new Uint8Array(dims.rows * dims.cols),
    discoveredCount: 0,
    minRow: dims.rows,
    maxRow: -1,
    minCol: dims.cols,
    maxCol: -1,
  }

  if (options.revealStart !== false && maze?.start) {
    revealAroundCell(state, maze, maze.start, options)
  }

  return state
}

export function isCellDiscovered(exploration, row, col) {
  if (!exploration || !exploration.discovered) return false
  if (!isInBounds(row, col, exploration.rows, exploration.cols)) return false
  return exploration.discovered[row * exploration.cols + col] === 1
}

function markDiscovered(exploration, row, col) {
  if (!isInBounds(row, col, exploration.rows, exploration.cols)) return 0
  const idx = row * exploration.cols + col
  if (exploration.discovered[idx] === 1) return 0
  exploration.discovered[idx] = 1
  exploration.discoveredCount += 1
  if (typeof exploration.minRow === 'number') {
    if (row < exploration.minRow) exploration.minRow = row
    if (row > exploration.maxRow) exploration.maxRow = row
    if (col < exploration.minCol) exploration.minCol = col
    if (col > exploration.maxCol) exploration.maxCol = col
  }
  return 1
}

/**
 * Progressively reveals maze cells around `cell`:
 * - Immediate 3x3 neighborhood (player cell + surrounding walls/doors)
 * - Short corridor line-of-sight rays along cardinal directions (stopping at walls)
 *   plus adjacent corridor walls so explored hallways read cleanly on the minimap.
 */
export function revealAroundCell(exploration, maze, cell, options = {}) {
  const dims = getGridDims(maze)
  if (!exploration || !dims || !cell) {
    return { changed: false, newlyRevealed: 0 }
  }
  if (exploration.rows !== dims.rows || exploration.cols !== dims.cols) {
    return { changed: false, newlyRevealed: 0 }
  }
  if (!isInBounds(cell.row, cell.col, dims.rows, dims.cols)) {
    return { changed: false, newlyRevealed: 0 }
  }

  const corridorRange = Math.max(
    1,
    Math.min(8, Number.isFinite(options.corridorRange) ? options.corridorRange : 4)
  )

  let newlyRevealed = 0

  // 1. Reveal 3x3 immediate vicinity around player
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      newlyRevealed += markDiscovered(exploration, cell.row + dr, cell.col + dc)
    }
  }

  // 2. Cast short cardinal corridor sight rays through open cells, stopping at walls
  for (let d = 0; d < CARDINAL_DIRS.length; d += 1) {
    const dir = CARDINAL_DIRS[d]
    for (let step = 1; step <= corridorRange; step += 1) {
      const r = cell.row + dir.row * step
      const c = cell.col + dir.col * step
      if (!isInBounds(r, c, dims.rows, dims.cols)) break

      newlyRevealed += markDiscovered(exploration, r, c)

      if (maze.grid[r][c] !== CELL_TYPES.PATH) {
        // Reveal stopping wall cell, do not look behind walls
        break
      }

      // Reveal side walls flanking the visible corridor cell
      if (dir.row === 0) {
        newlyRevealed += markDiscovered(exploration, r - 1, c)
        newlyRevealed += markDiscovered(exploration, r + 1, c)
      } else {
        newlyRevealed += markDiscovered(exploration, r, c - 1)
        newlyRevealed += markDiscovered(exploration, r, c + 1)
      }
    }
  }

  return {
    changed: newlyRevealed > 0,
    newlyRevealed,
  }
}

/**
 * Reveals all maze corridors within `radiusTiles` of `cell` (and their bordering
 * wall cells) for Spirit Lantern exploration without exposing hidden enemies.
 */
export function revealPathsInRadius(
  exploration,
  maze,
  cell,
  radiusTiles = SPIRIT_LANTERN_REVEAL_RADIUS_TILES
) {
  const dims = getGridDims(maze)
  if (!exploration || !dims || !cell) {
    return { changed: false, newlyRevealed: 0 }
  }
  if (exploration.rows !== dims.rows || exploration.cols !== dims.cols) {
    return { changed: false, newlyRevealed: 0 }
  }
  if (!isInBounds(cell.row, cell.col, dims.rows, dims.cols)) {
    return { changed: false, newlyRevealed: 0 }
  }

  const radius = Math.max(
    1,
    Number(radiusTiles) || SPIRIT_LANTERN_REVEAL_RADIUS_TILES
  )
  const ceilR = Math.ceil(radius)
  let newlyRevealed = 0

  for (let dr = -ceilR; dr <= ceilR; dr += 1) {
    for (let dc = -ceilR; dc <= ceilR; dc += 1) {
      if (Math.hypot(dr, dc) > radius) continue
      const r = cell.row + dr
      const c = cell.col + dc
      if (!isInBounds(r, c, dims.rows, dims.cols)) continue
      if (maze.grid[r][c] === CELL_TYPES.PATH) {
        newlyRevealed += markDiscovered(exploration, r, c)
        for (let d = 0; d < CARDINAL_DIRS.length; d += 1) {
          const dir = CARDINAL_DIRS[d]
          newlyRevealed += markDiscovered(exploration, r + dir.row, c + dir.col)
        }
      }
    }
  }

  return {
    changed: newlyRevealed > 0,
    newlyRevealed,
  }
}

/**
 * Reveals the shortest-path corridor cells along `echoPath` (and their flanking walls)
 * when Echo Reveal is active.
 */
export function revealEchoPath(exploration, maze, echoPath = []) {
  const dims = getGridDims(maze)
  if (!exploration || !dims || !Array.isArray(echoPath) || echoPath.length === 0) {
    return { changed: false, newlyRevealed: 0 }
  }
  if (exploration.rows !== dims.rows || exploration.cols !== dims.cols) {
    return { changed: false, newlyRevealed: 0 }
  }

  let newlyRevealed = 0
  for (let i = 0; i < echoPath.length; i += 1) {
    const step = echoPath[i]
    if (!step || !isInBounds(step.row, step.col, dims.rows, dims.cols)) continue
    newlyRevealed += markDiscovered(exploration, step.row, step.col)
    for (let d = 0; d < CARDINAL_DIRS.length; d += 1) {
      const dir = CARDINAL_DIRS[d]
      newlyRevealed += markDiscovered(
        exploration,
        step.row + dir.row,
        step.col + dir.col
      )
    }
  }

  return {
    changed: newlyRevealed > 0,
    newlyRevealed,
  }
}

/**
 * Reveals nearby collectible and keycard cells within `radiusTiles` when Spectral Compass
 * is active, without revealing distant unexplored maze corridors.
 */
export function revealNearbyObjectivesInRadius(
  exploration,
  maze,
  cell,
  {
    items = [],
    keycards = [],
    radiusTiles = SPECTRAL_COMPASS_REVEAL_RADIUS_TILES,
  } = {}
) {
  const dims = getGridDims(maze)
  if (!exploration || !dims || !cell) {
    return { changed: false, newlyRevealed: 0 }
  }
  if (exploration.rows !== dims.rows || exploration.cols !== dims.cols) {
    return { changed: false, newlyRevealed: 0 }
  }

  const radius = Math.max(
    1,
    Number(radiusTiles) || SPECTRAL_COMPASS_REVEAL_RADIUS_TILES
  )
  let newlyRevealed = 0

  const checkTargets = (list) => {
    if (!Array.isArray(list)) return
    for (let i = 0; i < list.length; i += 1) {
      const target = list[i]
      if (!target || !isInBounds(target.row, target.col, dims.rows, dims.cols)) {
        continue
      }
      const dist = Math.hypot(target.row - cell.row, target.col - cell.col)
      if (dist <= radius) {
        newlyRevealed += markDiscovered(exploration, target.row, target.col)
        for (let d = 0; d < CARDINAL_DIRS.length; d += 1) {
          const dir = CARDINAL_DIRS[d]
          newlyRevealed += markDiscovered(
            exploration,
            target.row + dir.row,
            target.col + dir.col
          )
        }
      }
    }
  }

  checkTargets(items)
  checkTargets(keycards)

  return {
    changed: newlyRevealed > 0,
    newlyRevealed,
  }
}

/**
 * Centralized helper applying player neighborhood discovery and all active map-reveal
 * collectible effects (Spirit Lantern, Echo Reveal, Spectral Compass).
 */
export function applyMinimapRevealEffects(
  exploration,
  maze,
  {
    playerCell = null,
    activeEffects = null,
    echoPath = [],
    items = [],
    keycards = [],
    spiritLanternActive = false,
    echoRevealActive = false,
    spectralCompassActive = false,
  } = {}
) {
  if (!exploration || !maze) {
    return { changed: false, newlyRevealed: 0 }
  }

  const activeCell = playerCell || maze.start
  let totalNewlyRevealed = 0

  if (activeCell) {
    const baseRes = revealAroundCell(exploration, maze, activeCell)
    totalNewlyRevealed += baseRes.newlyRevealed
  }

  const isSpiritLantern = Boolean(
    spiritLanternActive || (activeEffects?.spiritLanternRemainingMs || 0) > 0
  )
  if (isSpiritLantern && activeCell) {
    const lanternRes = revealPathsInRadius(
      exploration,
      maze,
      activeCell,
      SPIRIT_LANTERN_REVEAL_RADIUS_TILES
    )
    totalNewlyRevealed += lanternRes.newlyRevealed
  }

  const isEchoReveal = Boolean(
    echoRevealActive || (activeEffects?.echoRevealRemainingMs || 0) > 0
  )
  if (isEchoReveal && Array.isArray(echoPath) && echoPath.length > 0) {
    const echoRes = revealEchoPath(exploration, maze, echoPath)
    totalNewlyRevealed += echoRes.newlyRevealed
  }

  const isSpectralCompass = Boolean(
    spectralCompassActive ||
      (activeEffects?.spectralCompassRemainingMs || 0) > 0
  )
  if (isSpectralCompass && activeCell) {
    const compassRes = revealNearbyObjectivesInRadius(
      exploration,
      maze,
      activeCell,
      {
        items,
        keycards,
        radiusTiles: SPECTRAL_COMPASS_REVEAL_RADIUS_TILES,
      }
    )
    totalNewlyRevealed += compassRes.newlyRevealed
  }

  return {
    changed: totalNewlyRevealed > 0,
    newlyRevealed: totalNewlyRevealed,
  }
}

/**
 * Checks whether two grid cells have an unobstructed walkable corridor line-of-sight
 * within `maxDistanceTiles`.
 */
export function hasCorridorLineOfSight(
  maze,
  fromCell,
  toCell,
  maxDistanceTiles = ENEMY_DIRECT_SIGHT_RADIUS_TILES
) {
  const dims = getGridDims(maze)
  if (!dims || !fromCell || !toCell) return false
  if (
    !isInBounds(fromCell.row, fromCell.col, dims.rows, dims.cols) ||
    !isInBounds(toCell.row, toCell.col, dims.rows, dims.cols)
  ) {
    return false
  }
  if (
    maze.grid[fromCell.row][fromCell.col] === CELL_TYPES.WALL ||
    maze.grid[toCell.row][toCell.col] === CELL_TYPES.WALL
  ) {
    return false
  }

  const dRow = toCell.row - fromCell.row
  const dCol = toCell.col - fromCell.col
  const dist = Math.hypot(dRow, dCol)
  if (dist > maxDistanceTiles) return false
  if (dist < 1e-4) return true

  const steps = Math.max(2, Math.ceil(dist * 4))
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps
    const sampleRow = Math.floor(fromCell.row + 0.5 + dRow * t)
    const sampleCol = Math.floor(fromCell.col + 0.5 + dCol * t)
    if (!isInBounds(sampleRow, sampleCol, dims.rows, dims.cols)) {
      return false
    }
    if (maze.grid[sampleRow][sampleCol] === CELL_TYPES.WALL) {
      return false
    }
  }

  return true
}

function normalizeCollectionToArray(collection) {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (typeof collection.values === 'function') {
    return Array.from(collection.values())
  }
  if (typeof collection[Symbol.iterator] === 'function') {
    return Array.from(collection)
  }
  return []
}

/**
 * Centralizes enemy visibility on the minimap to prevent wallhacks:
 * - Enemies are visible when Watcher's Eye is active (within WATCHERS_EYE_REVEAL_RADIUS_TILES = 10 tiles,
 *   or if the enemy agent has `isWatchersEyeRevealed === true`).
 * - Otherwise, enemies are visible ONLY if their cell has been discovered AND they are within
 *   direct unobstructed corridor line-of-sight (`ENEMY_DIRECT_SIGHT_RADIUS_TILES = 5` tiles) of the player.
 * - Enemies in unexplored areas (when Watcher's Eye is inactive) or behind walls out of sight
 *   remain strictly concealed.
 */
export function resolveVisibleMinimapEnemies({
  maze,
  exploration,
  enemies = [],
  playerCell = null,
  playerWorldPos = null,
  watchersEyeActive = false,
  activeEffects = null,
} = {}) {
  const dims = getGridDims(maze)
  if (!dims || !exploration) return []

  const enemyList = normalizeCollectionToArray(enemies)
  if (enemyList.length === 0) return []

  const isWatchersEye = Boolean(
    watchersEyeActive || (activeEffects?.watchersEyeRemainingMs || 0) > 0
  )

  let playerRow = Number.isInteger(playerCell?.row)
    ? playerCell.row
    : maze?.start?.row ?? 1
  let playerCol = Number.isInteger(playerCell?.col)
    ? playerCell.col
    : maze?.start?.col ?? 1
  let playerRowFrac = playerRow + 0.5
  let playerColFrac = playerCol + 0.5

  if (
    playerWorldPos &&
    Number.isFinite(playerWorldPos.x) &&
    Number.isFinite(playerWorldPos.z)
  ) {
    const originX = -(dims.cols * CELL_SIZE) / 2
    const originZ = -(dims.rows * CELL_SIZE) / 2
    playerColFrac = (playerWorldPos.x - originX) / CELL_SIZE
    playerRowFrac = (playerWorldPos.z - originZ) / CELL_SIZE
    playerRow = Math.max(0, Math.min(dims.rows - 1, Math.floor(playerRowFrac)))
    playerCol = Math.max(0, Math.min(dims.cols - 1, Math.floor(playerColFrac)))
  }

  const originX = -(dims.cols * CELL_SIZE) / 2
  const originZ = -(dims.rows * CELL_SIZE) / 2
  const visible = []

  for (let i = 0; i < enemyList.length; i += 1) {
    const enemy = enemyList[i]
    if (!enemy || enemy.isDisposed) continue

    let row = null
    let col = null
    let rowFrac = null
    let colFrac = null

    const wPos = enemy.worldPos || enemy.position || null
    if (wPos && Number.isFinite(wPos.x) && Number.isFinite(wPos.z)) {
      colFrac = (wPos.x - originX) / CELL_SIZE
      rowFrac = (wPos.z - originZ) / CELL_SIZE
      const gridCell = worldToGrid(wPos.x, wPos.z, maze)
      if (gridCell) {
        row = gridCell.row
        col = gridCell.col
      } else {
        row = Math.floor(rowFrac)
        col = Math.floor(colFrac)
      }
    } else if (typeof enemy.getGridCell === 'function') {
      const cell = enemy.getGridCell()
      if (cell && Number.isInteger(cell.row) && Number.isInteger(cell.col)) {
        row = cell.row
        col = cell.col
        rowFrac = row + 0.5
        colFrac = col + 0.5
      }
    } else if (
      Number.isInteger(enemy.row) &&
      Number.isInteger(enemy.col)
    ) {
      row = enemy.row
      col = enemy.col
      rowFrac = row + 0.5
      colFrac = col + 0.5
    } else if (
      enemy.spawnCell &&
      Number.isInteger(enemy.spawnCell.row) &&
      Number.isInteger(enemy.spawnCell.col)
    ) {
      row = enemy.spawnCell.row
      col = enemy.spawnCell.col
      rowFrac = row + 0.5
      colFrac = col + 0.5
    }

    if (!isInBounds(row, col, dims.rows, dims.cols)) continue

    const distTiles = Math.hypot(
      (rowFrac ?? row + 0.5) - playerRowFrac,
      (colFrac ?? col + 0.5) - playerColFrac
    )

    let visibilityReason = null
    if (
      (isWatchersEye && distTiles <= WATCHERS_EYE_REVEAL_RADIUS_TILES) ||
      enemy.isWatchersEyeRevealed === true
    ) {
      visibilityReason = 'watchers_eye'
    } else if (
      isCellDiscovered(exploration, row, col) &&
      hasCorridorLineOfSight(
        maze,
        { row: playerRow, col: playerCol },
        { row, col },
        ENEMY_DIRECT_SIGHT_RADIUS_TILES
      )
    ) {
      visibilityReason = 'line_of_sight'
    }

    if (!visibilityReason) continue

    visible.push({
      id: enemy.id || `enemy-${i + 1}`,
      type: enemy.type || enemy.archetype || 'stalker',
      row,
      col,
      rowFrac: Math.max(0.5, Math.min(dims.rows - 0.5, rowFrac ?? row + 0.5)),
      colFrac: Math.max(0.5, Math.min(dims.cols - 0.5, colFrac ?? col + 0.5)),
      yaw: Number.isFinite(enemy.yaw) ? enemy.yaw : 0,
      state: enemy.state || 'patrol',
      visibilityReason,
    })
  }

  return visible
}

/**
 * Centralizes hazard discovery/visibility on the minimap:
 * - Only hazards located on explored cells (`isCellDiscovered`) are visible.
 * - Undiscovered hazards remain strictly concealed.
 */
export function resolveVisibleMinimapHazards({
  maze,
  exploration,
  hazards = null,
} = {}) {
  const dims = getGridDims(maze)
  if (!dims || !exploration) return []

  const rawHazards =
    hazards !== null && hazards !== undefined
      ? normalizeCollectionToArray(hazards)
      : Array.isArray(maze?.hazards)
        ? maze.hazards
        : []

  if (rawHazards.length === 0) return []

  const visible = []
  for (let i = 0; i < rawHazards.length; i += 1) {
    const hazard = rawHazards[i]
    if (!hazard || hazard.isDisposed) continue
    const row = hazard.row
    const col = hazard.col
    if (!isInBounds(row, col, dims.rows, dims.cols)) continue
    if (!isCellDiscovered(exploration, row, col)) continue

    visible.push({
      id: hazard.id || `hazard-${row}-${col}`,
      type: hazard.type || 'hazard',
      row,
      col,
      state: hazard.state || 'dormant',
    })
  }

  return visible
}

/**
 * Builds a privacy-safe fog-of-war minimap snapshot.
 * Strictly filters maze geometry, start/exit, keycards, collectibles, and hazards
 * to explored cells only, and never exposes hidden enemies (only revealing enemies
 * when Watcher's Eye is active or when explicitly requested and within direct line-of-sight).
 */
export function buildMinimapSnapshot({
  maze,
  exploration,
  playerCell = null,
  playerWorldPos = null,
  yaw = 0,
  items = [],
  keycards = [],
  hazards = undefined,
  enemies = undefined,
  watchersEyeActive = false,
  activeEffects = null,
  includeThreatVisibility = false,
  objectivesEnabled = false,
  isExitLocked = false,
  activeHint = null,
} = {}) {
  const dims = getGridDims(maze)
  if (!dims || !exploration) {
    return null
  }

  const exploredCells = []
  for (let r = 0; r < dims.rows; r += 1) {
    for (let c = 0; c < dims.cols; c += 1) {
      if (isCellDiscovered(exploration, r, c)) {
        exploredCells.push({
          row: r,
          col: c,
          type: maze.grid[r][c] === CELL_TYPES.WALL ? 'wall' : 'path',
        })
      }
    }
  }

  const startVisible =
    maze.start && isCellDiscovered(exploration, maze.start.row, maze.start.col)
      ? { row: maze.start.row, col: maze.start.col }
      : null

  const exitVisible =
    maze.exit && isCellDiscovered(exploration, maze.exit.row, maze.exit.col)
      ? {
          row: maze.exit.row,
          col: maze.exit.col,
          locked: Boolean(objectivesEnabled && isExitLocked),
        }
      : null

  const visibleKeycards =
    objectivesEnabled && Array.isArray(keycards)
      ? keycards
          .filter((k) => k && isCellDiscovered(exploration, k.row, k.col))
          .map((k) => ({ id: k.id, row: k.row, col: k.col }))
      : []

  const visibleItems = Array.isArray(items)
    ? items
        .filter((item) => item && isCellDiscovered(exploration, item.row, item.col))
        .map((item) => ({ id: item.id, type: item.type, row: item.row, col: item.col }))
    : []

  let colPos = Number.isInteger(playerCell?.col) ? playerCell.col + 0.5 : 1.5
  let rowPos = Number.isInteger(playerCell?.row) ? playerCell.row + 0.5 : 1.5

  if (
    playerWorldPos &&
    Number.isFinite(playerWorldPos.x) &&
    Number.isFinite(playerWorldPos.z)
  ) {
    const originX = -(dims.cols * CELL_SIZE) / 2
    const originZ = -(dims.rows * CELL_SIZE) / 2
    colPos = Math.max(0.5, Math.min(dims.cols - 0.5, (playerWorldPos.x - originX) / CELL_SIZE))
    rowPos = Math.max(0.5, Math.min(dims.rows - 0.5, (playerWorldPos.z - originZ) / CELL_SIZE))
  }

  const safeYaw = Number.isFinite(yaw) ? yaw : 0
  const resolvedPlayerCell = {
    row: Math.floor(rowPos),
    col: Math.floor(colPos),
  }

  const snapshot = {
    rows: dims.rows,
    cols: dims.cols,
    discoveredCount: exploration.discoveredCount,
    totalCells: dims.rows * dims.cols,
    exploredCells,
    player: {
      row: resolvedPlayerCell.row,
      col: resolvedPlayerCell.col,
      colFrac: colPos,
      rowFrac: rowPos,
      yaw: safeYaw,
      headingX: -Math.sin(safeYaw),
      headingY: -Math.cos(safeYaw),
    },
    start: startVisible,
    exit: exitVisible,
    keycards: visibleKeycards,
    items: visibleItems,
    wayfinder: activeHint
      ? {
          direction: activeHint.direction,
          targetType: activeHint.targetType,
          distanceSteps: activeHint.distanceSteps,
          relativeDirection: activeHint.relativeDirection || 'ahead',
          relativeBearingRad: Number.isFinite(activeHint.relativeBearingRad)
            ? activeHint.relativeBearingRad
            : 0,
          nextStep:
            activeHint.nextStep &&
            isCellDiscovered(exploration, activeHint.nextStep.row, activeHint.nextStep.col)
              ? { row: activeHint.nextStep.row, col: activeHint.nextStep.col }
              : null,
        }
      : null,
  }

  if (hazards !== undefined) {
    snapshot.hazards = resolveVisibleMinimapHazards({
      maze,
      exploration,
      hazards,
    })
  }

  const allowEnemyCheck = Boolean(
    includeThreatVisibility ||
      watchersEyeActive ||
      (activeEffects?.watchersEyeRemainingMs || 0) > 0
  )
  if (allowEnemyCheck && enemies !== undefined) {
    const visibleEnemies = resolveVisibleMinimapEnemies({
      maze,
      exploration,
      enemies,
      playerCell: resolvedPlayerCell,
      playerWorldPos,
      watchersEyeActive,
      activeEffects,
    })
    if (visibleEnemies.length > 0 || includeThreatVisibility) {
      snapshot.enemies = visibleEnemies
    }
  }

  return snapshot
}

/**
 * Resolves the backing pixel ratio for the 3D minimap canvas, clamped to [1, 2].
 */
export function resolveMinimapDpr(devicePixelRatio) {
  const raw =
    devicePixelRatio !== undefined
      ? devicePixelRatio
      : typeof window !== 'undefined'
        ? window.devicePixelRatio
        : 1
  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 1
  }
  return Math.min(MINIMAP_MAX_DPR, Math.max(1, numeric))
}

/**
 * Synchronizes a minimap canvas backing resolution (`canvas.width` / `canvas.height`)
 * using `devicePixelRatio` capped at 2 while leaving CSS displayed dimensions intact.
 * Accepts either a scalar square `logicalSize` or `{ width, height }`.
 */
export function syncMinimapCanvasResolution(
  canvas,
  logicalSize = MINIMAP_LOGICAL_SIZE,
  devicePixelRatio
) {
  const isRect = logicalSize && typeof logicalSize === 'object'
  const rawW = isRect ? logicalSize.width : logicalSize
  const rawH = isRect ? logicalSize.height : logicalSize

  const safeWidth =
    Number.isFinite(Number(rawW)) && Number(rawW) > 0
      ? Math.round(Number(rawW))
      : isRect
        ? MINIMAP_DEFAULT_WIDTH
        : MINIMAP_LOGICAL_SIZE
  const safeHeight =
    Number.isFinite(Number(rawH)) && Number(rawH) > 0
      ? Math.round(Number(rawH))
      : isRect
        ? MINIMAP_DEFAULT_HEIGHT
        : safeWidth

  const dpr = resolveMinimapDpr(devicePixelRatio)
  const targetWidth = Math.max(1, Math.round(safeWidth * dpr))
  const targetHeight = Math.max(1, Math.round(safeHeight * dpr))

  if (canvas) {
    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight
    }
  }

  return {
    dpr,
    logicalSize: Math.max(safeWidth, safeHeight),
    logicalWidth: safeWidth,
    logicalHeight: safeHeight,
    backingWidth: targetWidth,
    backingHeight: targetHeight,
  }
}

/**
 * Renders explored maze geometry, discovered objectives/collectibles, discovered hazards,
 * visibility-filtered enemies, local wayfinder direction cue, and player heading onto a 2D Canvas.
 */
export function renderMinimapCanvas(canvas, params = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return false
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const {
    maze,
    exploration,
    playerCell,
    playerWorldPos,
    yaw = 0,
    items = [],
    keycards = [],
    hazards = null,
    enemies = null,
    echoPath = null,
    objectivesEnabled = false,
    isExitLocked = false,
    activeHint = null,
    wayfinderTarget = null,
    spiritLanternActive = false,
    echoRevealActive = false,
    watchersEyeActive = false,
    spectralCompassActive = false,
    activeEffects = null,
    logicalSize = null,
    logicalWidth = null,
    logicalHeight = null,
    dpr: explicitDpr = null,
  } = params

  const dims = getGridDims(maze)
  if (!dims || !exploration) return false

  if (!canvas.width || !canvas.height) return false

  const hasExplicitDims =
    Number.isFinite(Number(logicalWidth)) &&
    Number(logicalWidth) > 0 &&
    Number.isFinite(Number(logicalHeight)) &&
    Number(logicalHeight) > 0
  const hasLogicalObj =
    logicalSize &&
    typeof logicalSize === 'object' &&
    Number.isFinite(Number(logicalSize.width)) &&
    Number(logicalSize.width) > 0 &&
    Number.isFinite(Number(logicalSize.height)) &&
    Number(logicalSize.height) > 0
  const hasLogicalScalar =
    Number.isFinite(Number(logicalSize)) && Number(logicalSize) > 0

  const width = hasExplicitDims
    ? Number(logicalWidth)
    : hasLogicalObj
      ? Number(logicalSize.width)
      : hasLogicalScalar
        ? Number(logicalSize)
        : explicitDpr != null
          ? canvas.width / resolveMinimapDpr(explicitDpr)
          : canvas.width
  const height = hasExplicitDims
    ? Number(logicalHeight)
    : hasLogicalObj
      ? Number(logicalSize.height)
      : hasLogicalScalar
        ? Number(logicalSize)
        : explicitDpr != null
          ? canvas.height / resolveMinimapDpr(explicitDpr)
          : canvas.height

  const dpr =
    explicitDpr != null
      ? resolveMinimapDpr(explicitDpr)
      : hasExplicitDims || hasLogicalObj || hasLogicalScalar
        ? resolveMinimapDpr(canvas.width / width)
        : 1

  if (typeof ctx.setTransform === 'function') {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const padding = 4
  const drawW = Math.max(1, width - padding * 2)
  const drawH = Math.max(1, height - padding * 2)
  const cellSize = Math.min(drawW / dims.cols, drawH / dims.rows)
  const offsetX = (width - cellSize * dims.cols) / 2
  const offsetY = (height - cellSize * dims.rows) / 2

  // Background fog
  ctx.fillStyle = '#060a11'
  ctx.fillRect(0, 0, width, height)

  // Draw explored maze cells only (unexplored cells remain hidden fog).
  // Bounded by discovered bounding box when available for O(discovered) efficiency on Level 5000+ mazes.
  const hasBounds =
    Number.isInteger(exploration.minRow) &&
    Number.isInteger(exploration.maxRow) &&
    Number.isInteger(exploration.minCol) &&
    Number.isInteger(exploration.maxCol)
  const startRow = hasBounds ? Math.max(0, exploration.minRow) : 0
  const endRow = hasBounds ? Math.min(dims.rows - 1, exploration.maxRow) : dims.rows - 1
  const startCol = hasBounds ? Math.max(0, exploration.minCol) : 0
  const endCol = hasBounds ? Math.min(dims.cols - 1, exploration.maxCol) : dims.cols - 1

  for (let r = startRow; r <= endRow; r += 1) {
    const rowArr = maze.grid[r]
    for (let c = startCol; c <= endCol; c += 1) {
      if (!isCellDiscovered(exploration, r, c)) continue
      const x = offsetX + c * cellSize
      const y = offsetY + r * cellSize
      if (rowArr[c] === CELL_TYPES.WALL) {
        ctx.fillStyle = '#26354d'
        ctx.fillRect(x, y, Math.ceil(cellSize), Math.ceil(cellSize))
      } else {
        ctx.fillStyle = '#111a2b'
        ctx.fillRect(x, y, Math.ceil(cellSize), Math.ceil(cellSize))
      }
    }
  }

  // Echo Reveal path markers along discovered echo path cells
  const isEchoActive = Boolean(
    echoRevealActive || (activeEffects?.echoRevealRemainingMs || 0) > 0
  )
  if (isEchoActive && Array.isArray(echoPath) && echoPath.length > 0) {
    const dotR = Math.max(1.1, cellSize * 0.16)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.72)'
    for (let i = 0; i < echoPath.length; i += 1) {
      const step = echoPath[i]
      if (!step || !isCellDiscovered(exploration, step.row, step.col)) continue
      const ex = offsetX + (step.col + 0.5) * cellSize
      const ey = offsetY + (step.row + 0.5) * cellSize
      ctx.beginPath()
      ctx.arc(ex, ey, dotR, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Discovered Start Elevator marker (outlined square)
  if (maze.start && isCellDiscovered(exploration, maze.start.row, maze.start.col)) {
    const sx = offsetX + (maze.start.col + 0.5) * cellSize
    const sy = offsetY + (maze.start.row + 0.5) * cellSize
    const r = Math.max(2, cellSize * 0.24)
    ctx.strokeStyle = 'rgba(129, 140, 248, 0.85)'
    ctx.lineWidth = 1.25
    ctx.strokeRect(sx - r, sy - r, r * 2, r * 2)
  }

  // Discovered Exit marker (reflects locked/unlocked gate state with both color and inner symbol)
  if (maze.exit && isCellDiscovered(exploration, maze.exit.row, maze.exit.col)) {
    const ex = offsetX + (maze.exit.col + 0.5) * cellSize
    const ey = offsetY + (maze.exit.row + 0.5) * cellSize
    const locked = Boolean(objectivesEnabled && isExitLocked)
    const radius = Math.max(2.6, cellSize * 0.34)
    ctx.fillStyle = locked ? '#ef4444' : '#10b981'
    ctx.fillRect(ex - radius, ey - radius, radius * 2, radius * 2)
    ctx.strokeStyle = locked ? '#fecaca' : '#a7f3d0'
    ctx.lineWidth = 1
    ctx.strokeRect(ex - radius, ey - radius, radius * 2, radius * 2)
    if (locked) {
      // Inner lock bar for non-color-only distinction
      ctx.beginPath()
      ctx.moveTo(ex - radius * 0.55, ey)
      ctx.lineTo(ex + radius * 0.55, ey)
      ctx.stroke()
    } else {
      // Inner unlocked portal circle
      ctx.beginPath()
      ctx.arc(ex, ey, Math.max(1.1, radius * 0.45), 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // Discovered Hazards (inverted warning triangle — never uses fillRect)
  if (hazards) {
    const visibleHazards = resolveVisibleMinimapHazards({
      maze,
      exploration,
      hazards,
    })
    const hazR = Math.max(1.9, cellSize * 0.24)
    for (let i = 0; i < visibleHazards.length; i += 1) {
      const haz = visibleHazards[i]
      const hx = offsetX + (haz.col + 0.5) * cellSize
      const hy = offsetY + (haz.row + 0.5) * cellSize
      const isDisabled = haz.state === 'disabled'
      ctx.fillStyle = isDisabled
        ? 'rgba(100, 116, 139, 0.55)'
        : 'rgba(249, 115, 22, 0.85)'
      ctx.strokeStyle = isDisabled ? '#94a3b8' : '#fed7aa'
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(hx - hazR * 0.85, hy - hazR * 0.7)
      ctx.lineTo(hx + hazR * 0.85, hy - hazR * 0.7)
      ctx.lineTo(hx, hy + hazR * 0.9)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }

  // Discovered Items
  if (Array.isArray(items)) {
    const itemRadius = Math.max(1.8, cellSize * 0.22)
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item || !isCellDiscovered(exploration, item.row, item.col)) continue
      const ix = offsetX + (item.col + 0.5) * cellSize
      const iy = offsetY + (item.row + 0.5) * cellSize

      if (item.type === 'health_capsule') {
        const arm = Math.max(2.1, itemRadius * 1.15)
        const thick = Math.max(1.2, arm * 0.45)
        ctx.fillStyle = '#f43f5e'
        ctx.fillRect(ix - arm, iy - thick / 2, arm * 2, thick)
        ctx.fillRect(ix - thick / 2, iy - arm, thick, arm * 2)
      } else if (item.type === 'soul_shards') {
        const r = Math.max(2.2, itemRadius * 1.2)
        ctx.fillStyle = '#a855f7'
        ctx.strokeStyle = '#e9d5ff'
        ctx.lineWidth = 0.85
        ctx.beginPath()
        ctx.moveTo(ix, iy - r)
        ctx.lineTo(ix + r * 0.72, iy)
        ctx.lineTo(ix, iy + r)
        ctx.lineTo(ix - r * 0.72, iy)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else if (item.type === 'energy_cell') {
        const bw = Math.max(2.2, itemRadius * 1.05)
        const bh = Math.max(3.0, itemRadius * 1.45)
        ctx.fillStyle = '#10b981'
        ctx.fillRect(ix - bw / 2, iy - bh / 2, bw, bh)
        ctx.fillStyle = '#fbbf24'
        ctx.fillRect(ix - bw * 0.28, iy - bh / 2 - Math.max(0.9, bh * 0.2), bw * 0.56, Math.max(0.9, bh * 0.2))
        ctx.strokeStyle = '#a7f3d0'
        ctx.lineWidth = 0.75
        ctx.strokeRect(ix - bw / 2, iy - bh / 2, bw, bh)
      } else if (item.type === 'echo_reveal') {
        ctx.fillStyle = '#38bdf8'
        ctx.beginPath()
        ctx.arc(ix, iy, itemRadius, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#e0f2fe'
        ctx.lineWidth = 0.85
        ctx.beginPath()
        ctx.arc(ix, iy, itemRadius * 1.35, 0, Math.PI * 2)
        ctx.stroke()
      } else if (item.type === 'time_fragment') {
        const r = Math.max(2.1, itemRadius * 1.15)
        ctx.fillStyle = '#ec4899'
        ctx.strokeStyle = '#fbcfe8'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(ix - r, iy - r)
        ctx.lineTo(ix + r, iy - r)
        ctx.lineTo(ix, iy)
        ctx.lineTo(ix + r, iy + r)
        ctx.lineTo(ix - r, iy + r)
        ctx.lineTo(ix, iy)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else if (item.type === 'watchers_eye') {
        const rxEye = Math.max(2.6, itemRadius * 1.35)
        const ryEye = Math.max(1.6, itemRadius * 0.85)
        ctx.fillStyle = '#8b5cf6'
        ctx.strokeStyle = '#ddd6fe'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(ix - rxEye, iy)
        ctx.lineTo(ix, iy - ryEye)
        ctx.lineTo(ix + rxEye, iy)
        ctx.lineTo(ix, iy + ryEye)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#fde047'
        ctx.beginPath()
        ctx.arc(ix, iy, Math.max(1, itemRadius * 0.42), 0, Math.PI * 2)
        ctx.fill()
      } else if (item.type === 'echo_pulse') {
        ctx.strokeStyle = '#06b6d4'
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.arc(ix, iy, itemRadius * 1.3, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#67e8f9'
        ctx.beginPath()
        ctx.arc(ix, iy, itemRadius * 0.65, 0, Math.PI * 2)
        ctx.fill()
      } else if (item.type === 'spirit_lantern') {
        const r = Math.max(2.2, itemRadius * 1.2)
        ctx.fillStyle = '#fbbf24'
        ctx.strokeStyle = '#fef3c7'
        ctx.lineWidth = 0.9
        ctx.beginPath()
        ctx.moveTo(ix, iy - r)
        ctx.lineTo(ix + r * 0.8, iy - r * 0.2)
        ctx.lineTo(ix + r * 0.65, iy + r)
        ctx.lineTo(ix - r * 0.65, iy + r)
        ctx.lineTo(ix - r * 0.8, iy - r * 0.2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else if (item.type === 'spectral_compass') {
        ctx.fillStyle = '#3b82f6'
        ctx.strokeStyle = '#bfdbfe'
        ctx.lineWidth = 0.85
        ctx.beginPath()
        ctx.arc(ix, iy, itemRadius * 1.1, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else if (item.type === 'phantom_veil') {
        ctx.fillStyle = '#22d3ee'
        ctx.strokeStyle = '#cffafe'
        ctx.lineWidth = 0.85
        ctx.beginPath()
        ctx.arc(ix, iy, itemRadius * 1.05, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else if (item.type === 'warding_charm') {
        const r = Math.max(2.1, itemRadius * 1.15)
        ctx.fillStyle = '#f59e0b'
        ctx.strokeStyle = '#fef3c7'
        ctx.lineWidth = 0.85
        ctx.beginPath()
        ctx.moveTo(ix, iy - r)
        ctx.lineTo(ix + r * 0.85, iy - r * 0.35)
        ctx.lineTo(ix + r * 0.65, iy + r * 0.85)
        ctx.lineTo(ix, iy + r)
        ctx.lineTo(ix - r * 0.65, iy + r * 0.85)
        ctx.lineTo(ix - r * 0.85, iy - r * 0.35)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.fillStyle = '#fbbf24'
        ctx.beginPath()
        ctx.arc(ix, iy, itemRadius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // Discovered Keycards (upward cyan triangle with crisp border)
  if (objectivesEnabled && Array.isArray(keycards)) {
    const keyR = Math.max(2.3, cellSize * 0.28)
    for (let i = 0; i < keycards.length; i += 1) {
      const key = keycards[i]
      if (!key || !isCellDiscovered(exploration, key.row, key.col)) continue
      const kx = offsetX + (key.col + 0.5) * cellSize
      const ky = offsetY + (key.row + 0.5) * cellSize
      ctx.fillStyle = '#22d3ee'
      ctx.strokeStyle = '#cffafe'
      ctx.lineWidth = 0.85
      ctx.beginPath()
      ctx.moveTo(kx, ky - keyR)
      ctx.lineTo(kx + keyR * 0.9, ky + keyR * 0.8)
      ctx.lineTo(kx - keyR * 0.9, ky + keyR * 0.8)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }

  // Player position & directional heading
  let colFrac = Number.isInteger(playerCell?.col) ? playerCell.col + 0.5 : 1.5
  let rowFrac = Number.isInteger(playerCell?.row) ? playerCell.row + 0.5 : 1.5
  if (
    playerWorldPos &&
    Number.isFinite(playerWorldPos.x) &&
    Number.isFinite(playerWorldPos.z)
  ) {
    const originX = -(dims.cols * CELL_SIZE) / 2
    const originZ = -(dims.rows * CELL_SIZE) / 2
    colFrac = Math.max(0.5, Math.min(dims.cols - 0.5, (playerWorldPos.x - originX) / CELL_SIZE))
    rowFrac = Math.max(0.5, Math.min(dims.rows - 0.5, (playerWorldPos.z - originZ) / CELL_SIZE))
  }

  // Visibility-Filtered Enemies (only Watcher's Eye or direct line-of-sight on discovered cells)
  if (enemies) {
    const visibleEnemies = resolveVisibleMinimapEnemies({
      maze,
      exploration,
      enemies,
      playerCell: playerCell || {
        row: Math.floor(rowFrac),
        col: Math.floor(colFrac),
      },
      playerWorldPos,
      watchersEyeActive,
      activeEffects,
    })
    const enemyR = Math.max(2.3, cellSize * 0.3)
    for (let i = 0; i < visibleEnemies.length; i += 1) {
      const enemy = visibleEnemies[i]
      const ex = offsetX + enemy.colFrac * cellSize
      const ey = offsetY + enemy.rowFrac * cellSize
      const isEyeReveal = enemy.visibilityReason === 'watchers_eye'

      ctx.strokeStyle = isEyeReveal
        ? 'rgba(192, 132, 252, 0.78)'
        : 'rgba(244, 63, 94, 0.78)'
      ctx.lineWidth = 0.9
      ctx.beginPath()
      ctx.arc(ex, ey, enemyR * 1.25, 0, Math.PI * 2)
      ctx.stroke()

      ctx.fillStyle = isEyeReveal ? '#c084fc' : '#e11d48'
      ctx.strokeStyle = isEyeReveal ? '#f3e8ff' : '#fecdd3'
      ctx.lineWidth = 0.85
      ctx.beginPath()
      ctx.moveTo(ex, ey - enemyR)
      ctx.lineTo(ex + enemyR * 0.38, ey - enemyR * 0.38)
      ctx.lineTo(ex + enemyR, ey)
      ctx.lineTo(ex + enemyR * 0.38, ey + enemyR * 0.38)
      ctx.lineTo(ex, ey + enemyR)
      ctx.lineTo(ex - enemyR * 0.38, ey + enemyR * 0.38)
      ctx.lineTo(ex - enemyR, ey)
      ctx.lineTo(ex - enemyR * 0.38, ey - enemyR * 0.38)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }

  const px = offsetX + colFrac * cellSize
  const py = offsetY + rowFrac * cellSize
  const safeYaw = Number.isFinite(yaw) ? yaw : 0
  const fx = -Math.sin(safeYaw)
  const fy = -Math.cos(safeYaw)
  const rx = -fy
  const ry = fx

  // Local Wayfinder Hint / Compass marker (ONLY immediate next step & compass direction — never leaks unexplored layout)
  const resolvedWayfinder = activeHint || wayfinderTarget
  if (
    resolvedWayfinder &&
    resolvedWayfinder.direction &&
    resolvedWayfinder.direction !== 'here'
  ) {
    let hx = 0
    let hy = 0
    if (resolvedWayfinder.direction === 'north') hy = -1
    else if (resolvedWayfinder.direction === 'south') hy = 1
    else if (resolvedWayfinder.direction === 'east') hx = 1
    else if (resolvedWayfinder.direction === 'west') hx = -1

    const isKeycardTarget = resolvedWayfinder.targetType === 'keycard'
    const isBeaconActive = Boolean(activeHint)
    const ringRadius = Math.max(6, cellSize * 0.95)
    const tipX = px + hx * (ringRadius + (isBeaconActive ? 3.5 : 2.6))
    const tipY = py + hy * (ringRadius + (isBeaconActive ? 3.5 : 2.6))
    const perpX = -hy
    const perpY = hx

    ctx.strokeStyle = isKeycardTarget
      ? isBeaconActive
        ? 'rgba(34, 211, 238, 0.8)'
        : 'rgba(34, 211, 238, 0.45)'
      : isBeaconActive
        ? 'rgba(52, 211, 153, 0.72)'
        : 'rgba(52, 211, 153, 0.42)'
    ctx.lineWidth = isBeaconActive ? 1.25 : 1
    ctx.beginPath()
    ctx.arc(px, py, ringRadius, 0, Math.PI * 2)
    ctx.stroke()

    const wingSize = isBeaconActive ? 3.2 : 2.3
    ctx.fillStyle = isKeycardTarget ? '#22d3ee' : '#34d399'
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(
      px + hx * (ringRadius - 1.5) + perpX * wingSize,
      py + hy * (ringRadius - 1.5) + perpY * wingSize
    )
    ctx.lineTo(
      px + hx * (ringRadius - 1.5) - perpX * wingSize,
      py + hy * (ringRadius - 1.5) - perpY * wingSize
    )
    ctx.closePath()
    ctx.fill()
  }

  // Spectral Compass attraction aura on minimap
  const isCompassActive = Boolean(
    spectralCompassActive ||
      (activeEffects?.spectralCompassRemainingMs || 0) > 0
  )
  if (isCompassActive) {
    const compassR = Math.max(8, cellSize * 1.85)
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)'
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.arc(px, py, compassR, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Spirit Lantern illumination aura on minimap
  const isLanternActive = Boolean(
    spiritLanternActive || (activeEffects?.spiritLanternRemainingMs || 0) > 0
  )
  if (isLanternActive) {
    const lanternR = Math.max(10, cellSize * 2.2)
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)'
    ctx.fillStyle = 'rgba(251, 191, 36, 0.12)'
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.arc(px, py, lanternR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  // Heading cone
  const coneLen = Math.max(7, cellSize * 1.45)
  const coneHalf = Math.max(3.5, cellSize * 0.6)
  ctx.fillStyle = 'rgba(245, 158, 11, 0.24)'
  ctx.beginPath()
  ctx.moveTo(px, py)
  ctx.lineTo(px + fx * coneLen + rx * coneHalf, py + fy * coneLen + ry * coneHalf)
  ctx.lineTo(px + fx * coneLen - rx * coneHalf, py + fy * coneLen - ry * coneHalf)
  ctx.closePath()
  ctx.fill()

  // Directional player arrow (ALWAYS DRAWN LAST so player marker sits on top and last moveTo is the arrow tip)
  const arrowSize = Math.max(3.2, cellSize * 0.44)
  ctx.fillStyle = '#f59e0b'
  ctx.strokeStyle = '#fef3c7'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px + fx * arrowSize * 1.35, py + fy * arrowSize * 1.35)
  ctx.lineTo(px - fx * arrowSize * 0.8 + rx * arrowSize * 0.85, py - fy * arrowSize * 0.8 + ry * arrowSize * 0.85)
  ctx.lineTo(px - fx * arrowSize * 0.35, py - fy * arrowSize * 0.35)
  ctx.lineTo(px - fx * arrowSize * 0.8 - rx * arrowSize * 0.85, py - fy * arrowSize * 0.8 - ry * arrowSize * 0.85)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  return true
}

