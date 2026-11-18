import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE } from '../world/worldCoords.js'

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
  if (!dims) {
    return {
      mazeId: maze?.id || '',
      rows: 0,
      cols: 0,
      discovered: new Uint8Array(0),
      discoveredCount: 0,
    }
  }

  const state = {
    mazeId: maze?.id || '',
    rows: dims.rows,
    cols: dims.cols,
    discovered: new Uint8Array(dims.rows * dims.cols),
    discoveredCount: 0,
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
 * Builds a privacy-safe fog-of-war minimap snapshot.
 * Strictly filters maze geometry, start/exit, keycards, coins, and power-ups
 * to explored cells only, and NEVER accepts or exposes enemy information.
 */
export function buildMinimapSnapshot({
  maze,
  exploration,
  playerCell = null,
  playerWorldPos = null,
  yaw = 0,
  coins = [],
  powerUps = [],
  keycards = [],
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

  const visibleCoins = Array.isArray(coins)
    ? coins
        .filter((c) => c && isCellDiscovered(exploration, c.row, c.col))
        .map((c) => ({ id: c.id, row: c.row, col: c.col }))
    : []

  const visiblePowerUps = Array.isArray(powerUps)
    ? powerUps
        .filter((p) => p && isCellDiscovered(exploration, p.row, p.col))
        .map((p) => ({ id: p.id, type: p.type, row: p.row, col: p.col }))
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

  return {
    rows: dims.rows,
    cols: dims.cols,
    discoveredCount: exploration.discoveredCount,
    totalCells: dims.rows * dims.cols,
    exploredCells,
    player: {
      row: Math.floor(rowPos),
      col: Math.floor(colPos),
      colFrac: colPos,
      rowFrac: rowPos,
      yaw: safeYaw,
      headingX: -Math.sin(safeYaw),
      headingY: -Math.cos(safeYaw),
    },
    start: startVisible,
    exit: exitVisible,
    keycards: visibleKeycards,
    coins: visibleCoins,
    powerUps: visiblePowerUps,
    wayfinder: activeHint
      ? {
          direction: activeHint.direction,
          targetType: activeHint.targetType,
          distanceSteps: activeHint.distanceSteps,
          nextStep:
            activeHint.nextStep &&
            isCellDiscovered(exploration, activeHint.nextStep.row, activeHint.nextStep.col)
              ? { row: activeHint.nextStep.row, col: activeHint.nextStep.col }
              : null,
        }
      : null,
  }
}

/**
 * Renders explored maze geometry, discovered objectives/collectibles,
 * local wayfinder direction cue, and player heading onto a 2D Canvas.
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
    coins = [],
    powerUps = [],
    keycards = [],
    objectivesEnabled = false,
    isExitLocked = false,
    activeHint = null,
  } = params

  const dims = getGridDims(maze)
  if (!dims || !exploration) return false

  const width = canvas.width
  const height = canvas.height
  if (!width || !height) return false

  const padding = 4
  const drawW = Math.max(1, width - padding * 2)
  const drawH = Math.max(1, height - padding * 2)
  const cellSize = Math.min(drawW / dims.cols, drawH / dims.rows)
  const offsetX = (width - cellSize * dims.cols) / 2
  const offsetY = (height - cellSize * dims.rows) / 2

  // Background fog
  ctx.fillStyle = '#060a11'
  ctx.fillRect(0, 0, width, height)

  // Draw explored maze cells only (unexplored cells remain hidden fog)
  for (let r = 0; r < dims.rows; r += 1) {
    const rowArr = maze.grid[r]
    for (let c = 0; c < dims.cols; c += 1) {
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

  // Discovered Start marker
  if (maze.start && isCellDiscovered(exploration, maze.start.row, maze.start.col)) {
    const sx = offsetX + (maze.start.col + 0.5) * cellSize
    const sy = offsetY + (maze.start.row + 0.5) * cellSize
    const r = Math.max(2, cellSize * 0.24)
    ctx.strokeStyle = 'rgba(129, 140, 248, 0.85)'
    ctx.lineWidth = 1.25
    ctx.strokeRect(sx - r, sy - r, r * 2, r * 2)
  }

  // Discovered Exit marker (reflects locked/unlocked gate state)
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
  }

  // Discovered Coins
  if (Array.isArray(coins)) {
    ctx.fillStyle = '#fbbf24'
    const coinRadius = Math.max(1.3, cellSize * 0.16)
    for (let i = 0; i < coins.length; i += 1) {
      const coin = coins[i]
      if (!coin || !isCellDiscovered(exploration, coin.row, coin.col)) continue
      ctx.beginPath()
      ctx.arc(
        offsetX + (coin.col + 0.5) * cellSize,
        offsetY + (coin.row + 0.5) * cellSize,
        coinRadius,
        0,
        Math.PI * 2
      )
      ctx.fill()
    }
  }

  // Discovered Power-Ups
  if (Array.isArray(powerUps)) {
    ctx.fillStyle = '#38bdf8'
    const puR = Math.max(1.8, cellSize * 0.22)
    for (let i = 0; i < powerUps.length; i += 1) {
      const pu = powerUps[i]
      if (!pu || !isCellDiscovered(exploration, pu.row, pu.col)) continue
      const px = offsetX + (pu.col + 0.5) * cellSize
      const py = offsetY + (pu.row + 0.5) * cellSize
      ctx.beginPath()
      ctx.moveTo(px, py - puR)
      ctx.lineTo(px + puR, py)
      ctx.lineTo(px, py + puR)
      ctx.lineTo(px - puR, py)
      ctx.closePath()
      ctx.fill()
    }
  }

  // Discovered Keycards
  if (objectivesEnabled && Array.isArray(keycards)) {
    const keyR = Math.max(2.3, cellSize * 0.28)
    for (let i = 0; i < keycards.length; i += 1) {
      const key = keycards[i]
      if (!key || !isCellDiscovered(exploration, key.row, key.col)) continue
      const kx = offsetX + (key.col + 0.5) * cellSize
      const ky = offsetY + (key.row + 0.5) * cellSize
      ctx.fillStyle = '#22d3ee'
      ctx.beginPath()
      ctx.moveTo(kx, ky - keyR)
      ctx.lineTo(kx + keyR * 0.9, ky + keyR * 0.8)
      ctx.lineTo(kx - keyR * 0.9, ky + keyR * 0.8)
      ctx.closePath()
      ctx.fill()
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

  const px = offsetX + colFrac * cellSize
  const py = offsetY + rowFrac * cellSize
  const safeYaw = Number.isFinite(yaw) ? yaw : 0
  const fx = -Math.sin(safeYaw)
  const fy = -Math.cos(safeYaw)
  const rx = -fy
  const ry = fx

  // Local Wayfinder Hint marker (ONLY immediate next step & compass direction — never leaks unexplored layout)
  if (activeHint && activeHint.direction && activeHint.direction !== 'here') {
    let hx = 0
    let hy = 0
    if (activeHint.direction === 'north') hy = -1
    else if (activeHint.direction === 'south') hy = 1
    else if (activeHint.direction === 'east') hx = 1
    else if (activeHint.direction === 'west') hx = -1

    const ringRadius = Math.max(6, cellSize * 0.95)
    const tipX = px + hx * (ringRadius + 3.5)
    const tipY = py + hy * (ringRadius + 3.5)
    const perpX = -hy
    const perpY = hx

    ctx.strokeStyle = 'rgba(52, 211, 153, 0.72)'
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.arc(px, py, ringRadius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.fillStyle = '#34d399'
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(px + hx * (ringRadius - 1.5) + perpX * 3.2, py + hy * (ringRadius - 1.5) + perpY * 3.2)
    ctx.lineTo(px + hx * (ringRadius - 1.5) - perpX * 3.2, py + hy * (ringRadius - 1.5) - perpY * 3.2)
    ctx.closePath()
    ctx.fill()
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

  // Directional player arrow
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
