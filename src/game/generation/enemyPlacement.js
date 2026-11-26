import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'

export const ENEMY_TYPES = {
  STALKER: 'stalker',
  HUNTER: 'hunter',
  BRUTE: 'brute',
}

export const ENEMY_ARCHETYPES = {
  [ENEMY_TYPES.STALKER]: {
    type: ENEMY_TYPES.STALKER,
    label: 'Stalker',
    patrolSpeed: 2.5,
    investigateSpeed: 3.5,
    chaseSpeed: 5.15,
    turnSpeed: 7.5,
    radius: 0.55,
    visionRange: 13.5,
    visionFov: Math.PI * 0.65,
    closeProximityRange: 1.65,
    hearingSprintRange: 11.0,
    hearingWalkRange: 4.5,
    detectionDelay: 0.32,
    loseSightDuration: 2.35,
    searchDuration: 3.2,
    idleDuration: 1.8,
    attackRange: 1.35,
    attackDuration: 0.8,
    attackHitDelay: 0.38,
    attackCooldown: 1.75,
    attackDamage: 25,
  },
  [ENEMY_TYPES.HUNTER]: {
    type: ENEMY_TYPES.HUNTER,
    label: 'Hunter',
    patrolSpeed: 2.85,
    investigateSpeed: 4.2,
    chaseSpeed: 4.75,
    turnSpeed: 9.0,
    radius: 0.5,
    visionRange: 12.5,
    visionFov: Math.PI * 0.78,
    closeProximityRange: 2.0,
    hearingSprintRange: 15.5,
    hearingWalkRange: 7.8,
    detectionDelay: 0.24,
    loseSightDuration: 2.0,
    searchDuration: 4.8,
    idleDuration: 1.4,
    attackRange: 1.4,
    attackDuration: 0.68,
    attackHitDelay: 0.32,
    attackCooldown: 1.45,
    attackDamage: 20,
  },
  [ENEMY_TYPES.BRUTE]: {
    type: ENEMY_TYPES.BRUTE,
    label: 'Brute',
    patrolSpeed: 1.85,
    investigateSpeed: 2.55,
    chaseSpeed: 3.65,
    turnSpeed: 5.0,
    radius: 0.64,
    visionRange: 10.5,
    visionFov: Math.PI * 0.55,
    closeProximityRange: 1.5,
    hearingSprintRange: 8.5,
    hearingWalkRange: 3.5,
    detectionDelay: 0.48,
    loseSightDuration: 1.9,
    searchDuration: 2.8,
    idleDuration: 2.4,
    attackRange: 2.05,
    attackDuration: 1.05,
    attackHitDelay: 0.58,
    attackCooldown: 2.35,
    attackDamage: 40,
  },
}

const DEFAULT_ROSTER = [ENEMY_TYPES.STALKER, ENEMY_TYPES.HUNTER, ENEMY_TYPES.BRUTE]

export function normalizeEnemyType(rawType) {
  if (rawType && rawType in ENEMY_ARCHETYPES) {
    return rawType
  }
  return ENEMY_TYPES.STALKER
}

export function getEnemyArchetypeConfig(type = ENEMY_TYPES.STALKER) {
  const normalized = normalizeEnemyType(type)
  return { ...ENEMY_ARCHETYPES[normalized] }
}

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

function buildSectorPatrolRoute(spawnCell, candidatePool, rng) {
  const route = [{ row: spawnCell.row, col: spawnCell.col }]
  const pool = [...candidatePool]

  const shuffledPool = shuffleWithRng(pool, rng)
  for (let i = 0; i < shuffledPool.length && route.length < 4; i += 1) {
    const cell = shuffledPool[i]
    if (!route.some((w) => w.row === cell.row && w.col === cell.col)) {
      route.push({ row: cell.row, col: cell.col })
    }
  }

  return route
}

/**
 * Generates deterministic, seeded multi-archetype enemy placements and patrol routes
 * strictly on reachable walkable maze tiles away from the player start cell.
 */
export function placeEnemies(maze, options = {}) {
  if (!maze?.grid || !maze?.start) {
    return []
  }

  const rng = createRng(`${maze.seed}-enemies`)
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size < 2) {
    return []
  }

  const roster = Array.isArray(options?.archetypes) && options.archetypes.length > 0
    ? options.archetypes.map(normalizeEnemyType)
    : Number.isInteger(options?.count) && options.count >= 0
      ? Array.from({ length: options.count }, (_, idx) => DEFAULT_ROSTER[idx % DEFAULT_ROSTER.length])
      : DEFAULT_ROSTER

  if (roster.length === 0) {
    return []
  }

  const allReachable = []
  reachInfo.distances.forEach((dist, key) => {
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return
    if (row === maze.start.row && col === maze.start.col) return
    allReachable.push({ key, row, col, dist })
  })

  if (allReachable.length === 0) {
    return []
  }

  allReachable.sort((a, b) => b.dist - a.dist || a.row - b.row || a.col - b.col)

  // Prefer cells well away from spawn so player never gets ambushed on frame 1
  const minSpawnDist = Math.max(3, Math.floor((reachInfo.maxDistance || 4) * 0.42))
  const farCandidates = allReachable.filter((c) => c.dist >= minSpawnDist)
  const primaryPool =
    farCandidates.length >= roster.length ? farCandidates : allReachable

  const shuffledSpawns = shuffleWithRng(primaryPool, rng)
  const usedKeys = new Set()
  const typeCounters = {
    [ENEMY_TYPES.STALKER]: 0,
    [ENEMY_TYPES.HUNTER]: 0,
    [ENEMY_TYPES.BRUTE]: 0,
  }

  const placements = []
  for (let i = 0; i < roster.length; i += 1) {
    const type = roster[i]
    const chosen =
      shuffledSpawns.find((c) => !usedKeys.has(c.key)) ||
      allReachable.find((c) => !usedKeys.has(c.key))
    if (!chosen) break

    usedKeys.add(chosen.key)
    typeCounters[type] = (typeCounters[type] || 0) + 1
    const id = `${type}-${typeCounters[type]}`

    const patrolRoute = buildSectorPatrolRoute(
      chosen,
      allReachable,
      rng
    )

    placements.push({
      id,
      type,
      spawnCell: { row: chosen.row, col: chosen.col },
      patrolRoute,
    })
  }

  return placements
}
