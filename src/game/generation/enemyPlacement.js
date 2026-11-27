import { createRng, shuffleWithRng } from '../../utils/rng.js'
import { CELL_TYPES } from './mazeConfig.js'
import { exploreReachableCells } from './pathfinder.js'
import { sortCandidatesByPreference } from './placementPreferences.js'

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

export function resolveEnemyAiConfigForLevel(level = 1, type = ENEMY_TYPES.STALKER, config = {}) {
  const normLevel = Math.max(1, Math.floor(Number(level) || 1))
  const normType = normalizeEnemyType(type)
  const baseArchetype = ENEMY_ARCHETYPES[normType] || ENEMY_ARCHETYPES[ENEMY_TYPES.STALKER]
  const baseConfig = config && typeof config === 'object' ? config : {}

  const progress = (normLevel - 1) / ((normLevel - 1) + 25)

  const maxSpeedMult = normType === ENEMY_TYPES.BRUTE ? 1.20 : normType === ENEMY_TYPES.HUNTER ? 1.30 : 1.25
  const maxVisionMult = normType === ENEMY_TYPES.HUNTER ? 1.28 : 1.22
  const maxHearingMult = normType === ENEMY_TYPES.HUNTER ? 1.32 : 1.25
  const minDetectionDelayMult = 0.80
  const minAttackCooldownMult = 0.85

  const speedMult = 1.0 + (maxSpeedMult - 1.0) * progress
  const visionMult = 1.0 + (maxVisionMult - 1.0) * progress
  const hearingMult = 1.0 + (maxHearingMult - 1.0) * progress
  const detectionMult = 1.0 - (1.0 - minDetectionDelayMult) * progress
  const cooldownMult = 1.0 - (1.0 - minAttackCooldownMult) * progress

  return {
    ...baseArchetype,
    patrolSpeed: Number((baseArchetype.patrolSpeed * speedMult).toFixed(2)),
    investigateSpeed: Number((baseArchetype.investigateSpeed * speedMult).toFixed(2)),
    chaseSpeed: Number((baseArchetype.chaseSpeed * speedMult).toFixed(2)),
    visionRange: Number((baseArchetype.visionRange * visionMult).toFixed(2)),
    hearingSprintRange: Number((baseArchetype.hearingSprintRange * hearingMult).toFixed(2)),
    hearingWalkRange: Number((baseArchetype.hearingWalkRange * hearingMult).toFixed(2)),
    detectionDelay: Number((baseArchetype.detectionDelay * detectionMult).toFixed(3)),
    attackCooldown: Number((baseArchetype.attackCooldown * cooldownMult).toFixed(3)),
    searchDuration: Number((baseArchetype.searchDuration * (1.0 + 0.2 * progress)).toFixed(2)),
    loseSightDuration: Number((baseArchetype.loseSightDuration * (1.0 + 0.15 * progress)).toFixed(2)),
    ...baseConfig,
  }
}

export function getEnemyArchetypeConfig(type = ENEMY_TYPES.STALKER, level = 1, config = {}) {
  return resolveEnemyAiConfigForLevel(level, type, config)
}

function parseKey(key) {
  const [rowStr, colStr] = key.split(',')
  return { row: Number(rowStr), col: Number(colStr) }
}

/**
 * Resolves the primary opening corridor direction and orientation from the maze start elevator.
 * Matches the canonical directional priority in MazeSceneEngine.
 */
export function getStartCorridorDirection(maze) {
  if (!maze?.grid || !maze?.start) return null
  const { row, col } = maze.start
  const g = maze.grid
  if (g?.[row]?.[col + 1] === CELL_TYPES.PATH) return { dRow: 0, dCol: 1, direction: 'east', yaw: -Math.PI / 2 }
  if (g?.[row + 1]?.[col] === CELL_TYPES.PATH) return { dRow: 1, dCol: 0, direction: 'south', yaw: Math.PI }
  if (g?.[row - 1]?.[col] === CELL_TYPES.PATH) return { dRow: -1, dCol: 0, direction: 'north', yaw: 0 }
  if (g?.[row]?.[col - 1] === CELL_TYPES.PATH) return { dRow: 0, dCol: -1, direction: 'west', yaw: Math.PI / 2 }
  return null
}

/**
 * Checks 2D grid line-of-sight between two cells using Bresenham raycasting.
 * Returns true if an unobstructed path of PATH cells connects fromCell and toCell.
 */
export function checkGridLineOfSight(fromCell, toCell, grid) {
  if (!grid || !fromCell || !toCell) return false
  let r0 = fromCell.row
  let c0 = fromCell.col
  const r1 = toCell.row
  const c1 = toCell.col
  const dR = Math.abs(r1 - r0)
  const dC = Math.abs(c1 - c0)
  const sR = r0 < r1 ? 1 : -1
  const sC = c0 < c1 ? 1 : -1
  let err = dC - dR

  while (true) {
    if (grid[r0]?.[c0] !== CELL_TYPES.PATH) {
      return false
    }
    if (r0 === r1 && c0 === c1) {
      return true
    }
    const e2 = 2 * err
    if (e2 > -dR) {
      err -= dR
      c0 += sC
    }
    if (e2 < dC) {
      err += dC
      r0 += sR
    }
  }
}

/**
 * Builds comprehensive player spawn safety exclusion zones:
 * 1. Player start cell
 * 2. Adjacent cells (Manhattan distance <= 1)
 * 3. Immediate vicinity (Manhattan distance <= 2, Chebyshev <= 2)
 * 4. Elevator doorway threshold and opening corridor (direct line-of-sight)
 */
export function buildStartSafetyExclusionZones(maze) {
  const startExclusions = new Set()
  const forwardViewExclusions = new Set()
  const lineOfSightExclusions = new Set()

  if (!maze?.grid || !maze?.start) {
    return {
      allSafetyExclusions: new Set(),
      startExclusions,
      forwardViewExclusions,
      lineOfSightExclusions,
      startDirection: null,
      doorwayCell: null,
    }
  }

  const { row: sR, col: sC } = maze.start
  const grid = maze.grid
  const rows = grid.length
  const cols = grid[0]?.length || 0

  // 1 & 2 & 3. Start cell, adjacent cells, and immediate vicinity (Manhattan distance <= 2)
  for (let r = Math.max(0, sR - 2); r <= Math.min(rows - 1, sR + 2); r += 1) {
    for (let c = Math.max(0, sC - 2); c <= Math.min(cols - 1, sC + 2); c += 1) {
      const manhattan = Math.abs(r - sR) + Math.abs(c - sC)
      if (manhattan <= 2) {
        startExclusions.add(`${r},${c}`)
      }
    }
  }

  // 4. Elevator doorway threshold and initial forward corridor march
  const startDir = getStartCorridorDirection(maze)
  let doorwayCell = null
  if (startDir) {
    const { dRow, dCol } = startDir
    doorwayCell = { row: sR + dRow, col: sC + dCol }
    startExclusions.add(`${doorwayCell.row},${doorwayCell.col}`)

    // March straight down the corridor opening
    let step = 1
    while (true) {
      const cr = sR + step * dRow
      const cc = sC + step * dCol
      if (cr < 0 || cr >= rows || cc < 0 || cc >= cols || grid[cr]?.[cc] !== CELL_TYPES.PATH) {
        break
      }
      forwardViewExclusions.add(`${cr},${cc}`)

      // Lateral clearances at the doorway and opening stretch
      if (step <= 3) {
        const latR1 = cr + dCol
        const latC1 = cc + dRow
        if (grid[latR1]?.[latC1] === CELL_TYPES.PATH) {
          forwardViewExclusions.add(`${latR1},${latC1}`)
        }
        const latR2 = cr - dCol
        const latC2 = cc - dRow
        if (grid[latR2]?.[latC2] === CELL_TYPES.PATH) {
          forwardViewExclusions.add(`${latR2},${latC2}`)
        }
      }
      step += 1
    }
  }

  // 5. Line-of-sight from start cell across unobstructed paths
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r]?.[c] === CELL_TYPES.PATH && !startExclusions.has(`${r},${c}`)) {
        if (checkGridLineOfSight(maze.start, { row: r, col: c }, grid)) {
          lineOfSightExclusions.add(`${r},${c}`)
        }
      }
    }
  }

  const allSafetyExclusions = new Set([
    ...startExclusions,
    ...forwardViewExclusions,
    ...lineOfSightExclusions,
  ])

  return {
    allSafetyExclusions,
    startExclusions,
    forwardViewExclusions,
    lineOfSightExclusions,
    startDirection: startDir,
    doorwayCell,
  }
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
 * strictly on reachable walkable maze tiles with guaranteed player spawn exclusion,
 * forward-view clearance, elevator doorway clearance, and line-of-sight protection.
 */
export function placeEnemiesWithReport(maze, options = {}) {
  if (!maze?.grid || !maze?.start) {
    return {
      enemies: [],
      report: {
        requestedCount: 0,
        placedCount: 0,
        missingCount: 0,
        candidateCellCount: 0,
        fullySatisfied: true,
        failures: [{ reason: 'invalid_maze_structure' }],
      },
    }
  }

  const rng = createRng(`${maze.seed}-enemies`)
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  if (!reachInfo.valid || reachInfo.distances.size < 2) {
    return {
      enemies: [],
      report: {
        requestedCount: 0,
        placedCount: 0,
        missingCount: 0,
        candidateCellCount: 0,
        fullySatisfied: false,
        failures: [{ reason: 'insufficient_reachable_cells' }],
      },
    }
  }

  const hasExplicitCount = Number.isInteger(options?.count) && options.count >= 0
  const hasExplicitArchetypes = Array.isArray(options?.archetypes) && options.archetypes.length > 0
  const allocation = (!hasExplicitCount && !hasExplicitArchetypes)
    ? (options?.enemyAllocation || null)
    : null
  const roster = Array.isArray(allocation?.roster) &&
    (allocation.roster.length > 0 || allocation.targetCount === 0 || options?.enemyConfig?.allowEmpty)
    ? allocation.roster.map(normalizeEnemyType)
    : hasExplicitArchetypes
      ? options.archetypes.map(normalizeEnemyType)
      : hasExplicitCount
        ? Array.from({ length: options.count }, (_, idx) => DEFAULT_ROSTER[idx % DEFAULT_ROSTER.length])
        : DEFAULT_ROSTER

  const requestedCount = roster.length
  if (requestedCount === 0) {
    return {
      enemies: [],
      report: {
        requestedCount: 0,
        placedCount: 0,
        missingCount: 0,
        candidateCellCount: 0,
        fullySatisfied: true,
        failures: [],
      },
    }
  }

  // Build comprehensive start safety exclusions
  const safety = buildStartSafetyExclusionZones(maze)

  // Inviolable exclusions: start safety, exit, hazards, keycards
  const inviolableKeys = new Set([
    ...safety.allSafetyExclusions,
    ...(maze.exit ? [`${maze.exit.row},${maze.exit.col}`] : []),
  ])

  const hazardList = Array.isArray(options?.hazards) ? options.hazards : Array.isArray(maze.hazards) ? maze.hazards : []
  for (const h of hazardList) {
    if (Number.isInteger(h?.row) && Number.isInteger(h?.col)) inviolableKeys.add(`${h.row},${h.col}`)
  }

  const keycardList = Array.isArray(options?.keycards) ? options.keycards : Array.isArray(maze.keycards) ? maze.keycards : []
  for (const kc of keycardList) {
    if (Number.isInteger(kc?.row) && Number.isInteger(kc?.col)) inviolableKeys.add(`${kc.row},${kc.col}`)
  }

  // Non-inviolable exclusions (hiding spots, items, coins)
  const itemExclusions = new Set()
  const collectibleSource = options?.collectibles || maze.collectibles || null
  const itemList = Array.isArray(collectibleSource?.items) ? collectibleSource.items : []
  for (const item of itemList) {
    if (Number.isInteger(item?.row) && Number.isInteger(item?.col)) {
      itemExclusions.add(`${item.row},${item.col}`)
    }
  }

  const hidingList = Array.isArray(options?.hidingSpots) ? options.hidingSpots : Array.isArray(maze.hidingSpots) ? maze.hidingSpots : []
  for (const hs of hidingList) {
    if (Number.isInteger(hs?.row) && Number.isInteger(hs?.col)) {
      itemExclusions.add(`${hs.row},${hs.col}`)
    }
  }

  const coinList = Array.isArray(collectibleSource?.coins) ? collectibleSource.coins : []
  const powerUpList = Array.isArray(collectibleSource?.powerUps) ? collectibleSource.powerUps : []
  const minorCollectibleExclusions = new Set()
  for (const item of [...coinList, ...powerUpList]) {
    if (Number.isInteger(item?.row) && Number.isInteger(item?.col)) {
      minorCollectibleExclusions.add(`${item.row},${item.col}`)
    }
  }

  // Min safe path distance from start: at least 4 tiles (minimum 3 on tiny mazes)
  const maxDistance = reachInfo.maxDistance || 10
  const minSafeDist = Math.max(3, Math.min(5, Math.floor(maxDistance * 0.3)))
  const minFarDist = Math.max(minSafeDist, Math.floor(maxDistance * 0.42))

  const primaryCandidates = []
  const safeCandidates = []
  const allSafeCandidates = []
  const reserveCandidates = []

  reachInfo.distances.forEach((dist, key) => {
    const { row, col } = parseKey(key)
    if (maze.grid[row]?.[col] !== CELL_TYPES.PATH) return
    if (inviolableKeys.has(key)) return
    if (dist < 3) return // Strict inviolable minimum path distance from start

    const hasItemOrHiding = itemExclusions.has(key)
    const hasMinorCollectible = minorCollectibleExclusions.has(key)

    const cellObj = { key, row, col, dist }

    if (!hasItemOrHiding && !hasMinorCollectible) {
      allSafeCandidates.push(cellObj)
      if (dist >= minFarDist) {
        primaryCandidates.push(cellObj)
      }
      if (dist >= minSafeDist) {
        safeCandidates.push(cellObj)
      }
    } else if (!hasItemOrHiding) {
      // Cell only has minor coin/powerup
      reserveCandidates.push(cellObj)
    }
  })

  // Primary pool selection with graceful fallback
  let candidatePool = primaryCandidates
  if (candidatePool.length < requestedCount) {
    candidatePool = safeCandidates
  }
  if (candidatePool.length < requestedCount) {
    const combined = [...safeCandidates, ...reserveCandidates]
    if (combined.length > candidatePool.length) {
      candidatePool = combined
    }
  }

  const preferenceCandidatePool =
    allSafeCandidates.length > 0
      ? [...allSafeCandidates, ...reserveCandidates]
      : candidatePool

  if (candidatePool.length === 0 && preferenceCandidatePool.length === 0) {
    return {
      enemies: [],
      report: {
        requestedCount,
        placedCount: 0,
        missingCount: requestedCount,
        candidateCellCount: 0,
        fullySatisfied: false,
        failures: [{ reason: 'no_valid_candidate_cells' }],
      },
    }
  }

  candidatePool.sort((a, b) => b.dist - a.dist || a.row - b.row || a.col - b.col)
  const shuffledSpawns = shuffleWithRng(candidatePool, rng)
  const usedKeys = new Set()
  const typeCounters = {
    [ENEMY_TYPES.STALKER]: 0,
    [ENEMY_TYPES.HUNTER]: 0,
    [ENEMY_TYPES.BRUTE]: 0,
  }
  const requestedByType = {}
  for (let i = 0; i < roster.length; i += 1) {
    requestedByType[roster[i]] = (requestedByType[roster[i]] || 0) + 1
  }

  // Safe pool for patrol routes (strictly excludes start zone)
  const patrolSource = candidatePool.length >= 4 ? candidatePool : safeCandidates.length > 0 ? safeCandidates : preferenceCandidatePool
  const safePatrolPool = patrolSource

  const allowFallback = Boolean(options?.allowFallback)
  const enemies = []
  const preferenceStats = {}
  const failures = []

  // Handle explicit manual placements first
  const explicitPlacements = Array.isArray(options?.placements) ? options.placements : []
  for (const req of explicitPlacements) {
    if (req && req.type && Number.isInteger(req.row) && Number.isInteger(req.col)) {
      const key = `${req.row},${req.col}`
      if (!usedKeys.has(key) && maze.grid[req.row]?.[req.col] === CELL_TYPES.PATH) {
        usedKeys.add(key)
        typeCounters[req.type] = (typeCounters[req.type] || 0) + 1
        const id = `${req.type}-${typeCounters[req.type]}`
        const chosen = { key, row: req.row, col: req.col, dist: reachInfo.distances.get(key) || 1 }
        const patrolRoute = buildSectorPatrolRoute(chosen, safePatrolPool, rng)
        enemies.push({
          id,
          type: req.type,
          spawnCell: { row: req.row, col: req.col },
          patrolRoute,
          placementPreference: options?.placementPreferences?.[req.type] || 'manual',
        })
        if (!preferenceStats[req.type]) {
          preferenceStats[req.type] = {
            preference: options?.placementPreferences?.[req.type] || 'manual',
            requested: requestedByType[req.type] || 0,
            achievedCount: 0,
            fallbackCount: 0,
            failedCount: 0,
          }
        }
        preferenceStats[req.type].achievedCount += 1
        const removeIdx = roster.indexOf(req.type)
        if (removeIdx !== -1) {
          roster.splice(removeIdx, 1)
        }
      }
    }
  }

  for (let i = 0; i < roster.length; i += 1) {
    const type = roster[i]
    const pref = options?.placementPreferences?.[type] || options?.placementPreference || 'auto'
    if (!preferenceStats[type]) {
      preferenceStats[type] = {
        preference: pref,
        requested: requestedByType[type] || 0,
        achievedCount: 0,
        fallbackCount: 0,
        failedCount: 0,
      }
    }

    const poolForPref =
      pref === 'auto' || pref === 'far_start' ? candidatePool : preferenceCandidatePool
    const availablePool = poolForPref.filter((c) => !usedKeys.has(c.key))

    let chosen
    let usedFallback = false
    if (pref === 'auto') {
      chosen =
        shuffledSpawns.find((c) => !usedKeys.has(c.key)) ||
        availablePool[0]
    } else {
      const prefRes = sortCandidatesByPreference(
        availablePool,
        pref,
        {
          grid: maze.grid,
          rows: maze.rows ?? maze.grid.length,
          cols: maze.cols ?? maze.grid[0]?.length,
          start: maze.start,
          exit: maze.exit,
          maxDistance: reachInfo.maxDistance,
          placedInstances: enemies.filter((e) => e.type === type),
          allEntities: enemies,
          allowFallback,
        }
      )
      chosen = prefRes.sortedCandidates[0]
      usedFallback = Boolean(prefRes.fallbackUsed || prefRes.preferredCount === 0)
      if (!chosen) {
        preferenceStats[type].failedCount += 1
        failures.push({
          type,
          archetype: type,
          reason:
            prefRes.reason ||
            (availablePool.length === 0
              ? 'insufficient_valid_cells'
              : `strict_preference_${pref}_unavailable`),
          instanceIndex: i,
        })
        continue
      }
    }

    if (!chosen) {
      preferenceStats[type].failedCount += 1
      failures.push({
        type,
        archetype: type,
        reason: 'insufficient_valid_cells',
        instanceIndex: i,
      })
      continue
    }

    usedKeys.add(chosen.key)
    typeCounters[type] = (typeCounters[type] || 0) + 1
    if (usedFallback) {
      preferenceStats[type].fallbackCount += 1
    } else {
      preferenceStats[type].achievedCount += 1
    }

    const id = `${type}-${typeCounters[type]}`
    const patrolRoute = buildSectorPatrolRoute(chosen, safePatrolPool, rng)

    enemies.push({
      id,
      type,
      spawnCell: { row: chosen.row, col: chosen.col },
      patrolRoute,
      placementPreference: pref,
    })
  }

  const preferences = {}
  for (const [type, stat] of Object.entries(preferenceStats)) {
    const req = stat.requested || 0
    const plc = typeCounters[type] || 0
    preferences[type] = {
      ...stat,
      fallbackUsed: stat.fallbackCount > 0,
      achieved:
        req === 0
          ? true
          : stat.preference === 'auto'
            ? plc > 0
            : stat.failedCount === 0 && stat.fallbackCount === 0 && plc === req,
    }
  }

  const missingCount = Math.max(0, requestedCount - enemies.length)

  return {
    enemies,
    report: {
      requestedCount,
      placedCount: enemies.length,
      missingCount,
      shortfallCount: missingCount,
      hadShortfall: missingCount > 0,
      candidateCellCount: preferenceCandidatePool.length,
      safetyExclusionCount: safety.allSafetyExclusions.size,
      requestedByType,
      placedByType: typeCounters,
      preferences,
      failures,
      fullySatisfied: missingCount === 0,
    },
  }
}

export function placeEnemies(maze, options = {}) {
  return placeEnemiesWithReport(maze, options).enemies
}

