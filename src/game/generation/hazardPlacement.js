import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

export const HAZARD_TYPES = {
  FLOOR_SPIKES: 'floor_spikes',
  PRESSURE_PLATE: 'pressure_plate',
  ELECTRIC_GRID: 'electric_grid',
  CEILING_COLLAPSE: 'ceiling_collapse',
  ROTTEN_FURNITURE_COLLAPSE: 'rotten_furniture_collapse',
  FALLING_PIPES_FIXTURES: 'falling_pipes_fixtures',
  STEAM_PIPE_BURST: 'steam_pipe_burst',
  EXPOSED_ELECTRICAL_WIRING: 'exposed_electrical_wiring',
  COLLAPSING_FLOOR_GRATE: 'collapsing_floor_grate',
}

const STANDARD_HAZARD_COUNT = 9

const WALL_MOUNT_DIRECTIONS = [
  { side: 'north', dr: -1, dc: 0, yaw: 0 },
  { side: 'south', dr: 1, dc: 0, yaw: Math.PI },
  { side: 'west', dr: 0, dc: -1, yaw: Math.PI * 0.5 },
  { side: 'east', dr: 0, dc: 1, yaw: -Math.PI * 0.5 },
]

const WALL_DISCHARGE_LOCAL_Z = -1.18
const WALL_DISCHARGE_LOCAL_Y = 1.45
const CEILING_DISCHARGE_LOCAL_Y = 1.65

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

function normalizeZero(value) {
  return Math.abs(value) < 1e-9 ? 0 : value
}

/**
 * Inspects adjacent maze walls for (row, col) and resolves a believable
 * electrical mounting configuration ('wall' on an adjacent wall face, or
 * 'ceiling' hanging from the overhead soffit in open junctions). Never mounts
 * exposed electrical wiring as an arbitrary floor object.
 */
export function resolveElectricalMount(grid, row, col, rng = null, preferredSide = null) {
  const adjacentWalls = []
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    for (let i = 0; i < WALL_MOUNT_DIRECTIONS.length; i += 1) {
      const dir = WALL_MOUNT_DIRECTIONS[i]
      const nr = row + dir.dr
      const nc = col + dir.dc
      if (grid[nr]?.[nc] === CELL_TYPES.WALL) {
        adjacentWalls.push(dir)
      }
    }
  }

  if (adjacentWalls.length > 0) {
    let chosen = null
    if (preferredSide) {
      chosen = adjacentWalls.find((d) => d.side === preferredSide) || null
    }
    if (!chosen) {
      const idx =
        typeof rng === 'function'
          ? Math.floor(rng() * adjacentWalls.length) % adjacentWalls.length
          : 0
      chosen = adjacentWalls[idx]
    }
    const localX = normalizeZero(WALL_DISCHARGE_LOCAL_Z * Math.sin(chosen.yaw))
    const localZ = normalizeZero(WALL_DISCHARGE_LOCAL_Z * Math.cos(chosen.yaw))
    return {
      mountType: 'wall',
      wallSide: chosen.side,
      wallYaw: chosen.yaw,
      localDischargeOffset: {
        x: localX,
        y: WALL_DISCHARGE_LOCAL_Y,
        z: localZ,
      },
    }
  }

  return {
    mountType: 'ceiling',
    wallSide: null,
    wallYaw: 0,
    localDischargeOffset: {
      x: 0,
      y: CEILING_DISCHARGE_LOCAL_Y,
      z: 0,
    },
  }
}

/**
 * Resolves floor-flush grate orientation aligned with the local corridor axis
 * so the recessed industrial drainage grate integrates cleanly into the floor
 * at y = 0 without floating or intersecting adjacent walls.
 */
export function resolveFloorGrateOrientation(grid, row, col) {
  let openNS = 0
  let openEW = 0
  if (Array.isArray(grid) && Number.isInteger(row) && Number.isInteger(col)) {
    if (grid[row - 1]?.[col] === CELL_TYPES.PATH) openNS += 1
    if (grid[row + 1]?.[col] === CELL_TYPES.PATH) openNS += 1
    if (grid[row]?.[col - 1] === CELL_TYPES.PATH) openEW += 1
    if (grid[row]?.[col + 1] === CELL_TYPES.PATH) openEW += 1
  }

  const corridorAxis = openEW > openNS ? 'ew' : 'ns'
  const grateYaw = corridorAxis === 'ew' ? Math.PI * 0.5 : 0
  return {
    floorY: 0,
    corridorAxis,
    grateYaw,
  }
}

/**
 * Places deterministic, non-overlapping environmental hazards on reachable
 * walkable maze tiles while avoiding the start and exit positions.
 */
export function placeHazards(maze) {
  if (!maze?.grid || !maze?.start || !maze?.exit) {
    return []
  }

  const targetCount = STANDARD_HAZARD_COUNT
  const rng = createRng(`${maze.seed}-hazards`)

  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size <= 3) {
    return []
  }

  const startKey = `${maze.start.row},${maze.start.col}`
  const exitKey = `${maze.exit.row},${maze.exit.col}`

  const candidates = []
  reachInfo.distances.forEach((dist, key) => {
    if (key === startKey || key === exitKey) return
    const { row, col } = parseKey(key)
    // Avoid immediate start vicinity (dist < 3)
    if (dist < 3) return
    candidates.push({ key, row, col, dist })
  })

  if (candidates.length === 0) {
    return []
  }

  candidates.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
  const shuffled = shuffleWithRng(candidates, rng)
  const types = [
    HAZARD_TYPES.FLOOR_SPIKES,
    HAZARD_TYPES.PRESSURE_PLATE,
    HAZARD_TYPES.ELECTRIC_GRID,
    HAZARD_TYPES.CEILING_COLLAPSE,
    HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    HAZARD_TYPES.STEAM_PIPE_BURST,
    HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
  ]

  const actualCount = Math.min(targetCount, shuffled.length)
  const chosen = shuffled.slice(0, actualCount)

  return chosen.map((cell, idx) => {
    const type = types[idx % types.length]
    const spec = {
      id: `hazard-${cell.row}-${cell.col}`,
      type,
      row: cell.row,
      col: cell.col,
      active: true,
    }
    if (type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      const mount = resolveElectricalMount(maze.grid, cell.row, cell.col, rng)
      spec.mountType = mount.mountType
      spec.wallSide = mount.wallSide
      spec.wallYaw = mount.wallYaw
      spec.localDischargeOffset = mount.localDischargeOffset
    } else if (type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      const orient = resolveFloorGrateOrientation(maze.grid, cell.row, cell.col)
      spec.floorY = orient.floorY
      spec.corridorAxis = orient.corridorAxis
      spec.grateYaw = orient.grateYaw
    }
    return spec
  })
}
