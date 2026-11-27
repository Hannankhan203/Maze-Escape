import { CELL_TYPES } from '../generation/mazeConfig.js'
import { SANDBOX_CATEGORY_IDS } from './sandboxConfig.js'
import { KEYCARD_COLLECTIBLE_TYPE } from '../mechanics/collectiblesConfig.js'

function calcEuclideanDist(posA, posB) {
  if (!posA || !posB) return 0
  const dx = (posA.x || 0) - (posB.x || 0)
  const dz = (posA.z || 0) - (posB.z || 0)
  return Math.sqrt(dx * dx + dz * dz)
}

function calcManhattanDist(cellA, cellB) {
  if (!cellA || !cellB) return 0
  return Math.abs((cellA.row || 0) - (cellB.row || 0)) + Math.abs((cellA.col || 0) - (cellB.col || 0))
}

/**
 * Extracts live entities across all categories from the active 3D engine and maze layout.
 */
export function extractLiveEntitiesFromEngine(engine, maze) {
  const playerWorldPos = engine?.getPlayerWorldPosition?.() ||
    engine?._playerWorldPos || { x: 0, y: 0, z: 0 }
  const playerGridCell = engine?.getPlayerGridCell?.() ||
    maze?.start || { row: 0, col: 0 }

  const entities = []
  const manualPlacementsLookup = new Map()

  // Build manual placements lookup from sandbox config if present
  const cfg = maze?.sandboxConfig || engine?.sandboxConfig || null
  if (cfg?.categories) {
    for (const [catId, catObj] of Object.entries(cfg.categories)) {
      for (const [itemId, itemEntry] of Object.entries(catObj?.items || {})) {
        if (Array.isArray(itemEntry?.manualPlacements)) {
          for (const p of itemEntry.manualPlacements) {
            if (p && Number.isInteger(p.row) && Number.isInteger(p.col)) {
              manualPlacementsLookup.set(`${catId}:${itemId}:${p.row},${p.col}`, true)
              manualPlacementsLookup.set(`${p.row},${p.col}`, { catId, itemId })
            }
          }
        }
      }
    }
  }

  // 1. Hazards
  const hazardManager = engine?.getHazardManager?.() || null
  const hazardList = hazardManager?.getHazards?.() ||
    (Array.isArray(maze?.hazards) ? maze.hazards : [])

  for (let i = 0; i < hazardList.length; i += 1) {
    const h = hazardList[i]
    if (!h) continue
    const row = Number.isInteger(h.row) ? h.row : (h.gridRow ?? 0)
    const col = Number.isInteger(h.col) ? h.col : (h.gridCol ?? 0)
    const worldPos = {
      x: h.x ?? (h.position?.x ?? 0),
      y: h.y ?? (h.position?.y ?? 0),
      z: h.z ?? (h.position?.z ?? 0),
    }
    const isManual = Boolean(
      h.isManual ||
      manualPlacementsLookup.has(`${SANDBOX_CATEGORY_IDS.HAZARDS}:${h.type}:${row},${col}`)
    )
    const status = h.isTriggered ? 'Triggered' : (h.isActive ? 'Active' : 'Armed')
    entities.push({
      id: h.id || `hazard-${h.type}-${row}-${col}-${i}`,
      category: SANDBOX_CATEGORY_IDS.HAZARDS,
      categoryLabel: 'Hazards',
      type: h.type,
      label: h.label || h.type,
      gridCoord: { row, col },
      worldPos,
      status,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: isManual ? 'manual' : 'procedural',
      preference: h.placementPreference || 'auto',
    })
  }

  // 2. Enemies
  const enemyManager = engine?.getEnemyManager?.() || null
  const enemyList = enemyManager?.getEnemies?.() ||
    (Array.isArray(maze?.enemies) ? maze.enemies : [])

  for (let i = 0; i < enemyList.length; i += 1) {
    const e = enemyList[i]
    if (!e) continue
    const spawnCell = e.spawnCell || e.currentCell || { row: 0, col: 0 }
    const row = Number.isInteger(spawnCell.row) ? spawnCell.row : 0
    const col = Number.isInteger(spawnCell.col) ? spawnCell.col : 0
    const worldPos = {
      x: e.position?.x ?? (e.x ?? 0),
      y: e.position?.y ?? (e.y ?? 0),
      z: e.position?.z ?? (e.z ?? 0),
    }
    const isManual = Boolean(
      e.isManual ||
      manualPlacementsLookup.has(`${SANDBOX_CATEGORY_IDS.ENEMIES}:${e.type}:${row},${col}`)
    )
    const status = e.state || 'Patrolling'
    entities.push({
      id: e.id || `enemy-${e.type}-${row}-${col}-${i}`,
      category: SANDBOX_CATEGORY_IDS.ENEMIES,
      categoryLabel: 'Enemies',
      type: e.type,
      label: e.type.toUpperCase(),
      gridCoord: { row, col },
      worldPos,
      status,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: isManual ? 'manual' : 'procedural',
      preference: e.placementPreference || 'auto',
    })
  }

  // 3. Hiding Spots
  const hidingManager = engine?.hidingSpotManager || null
  const hidingList = hidingManager?.getHidingSpots?.() ||
    (Array.isArray(maze?.hidingSpots) ? maze.hidingSpots : [])

  for (let i = 0; i < hidingList.length; i += 1) {
    const s = hidingList[i]
    if (!s) continue
    const row = Number.isInteger(s.row) ? s.row : 0
    const col = Number.isInteger(s.col) ? s.col : 0
    const worldPos = {
      x: s.worldPos?.x ?? (s.x ?? 0),
      y: s.worldPos?.y ?? (s.y ?? 0),
      z: s.worldPos?.z ?? (s.z ?? 0),
    }
    const isManual = Boolean(
      s.isManual ||
      manualPlacementsLookup.has(`${SANDBOX_CATEGORY_IDS.HIDING_SPOTS}:${s.type}:${row},${col}`)
    )
    const status = s.isOccupied ? 'Player Inside' : 'Vacant'
    entities.push({
      id: s.id || `hiding-${s.type}-${row}-${col}-${i}`,
      category: SANDBOX_CATEGORY_IDS.HIDING_SPOTS,
      categoryLabel: 'Hiding Spots',
      type: s.type,
      label: s.label || s.type,
      gridCoord: { row, col },
      worldPos,
      status,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: isManual ? 'manual' : 'procedural',
      preference: s.placementPreference || 'auto',
    })
  }

  // 4. Collectibles & Keycards
  const keycards = Array.isArray(maze?.keycards) ? maze.keycards : []
  for (let i = 0; i < keycards.length; i += 1) {
    const kc = keycards[i]
    if (!kc) continue
    const row = Number.isInteger(kc.row) ? kc.row : 0
    const col = Number.isInteger(kc.col) ? kc.col : 0
    const worldPos = {
      x: kc.x ?? 0,
      y: kc.y ?? 0,
      z: kc.z ?? 0,
    }
    const isManual = Boolean(
      kc.isManual ||
      manualPlacementsLookup.has(`${SANDBOX_CATEGORY_IDS.COLLECTIBLES}:${KEYCARD_COLLECTIBLE_TYPE}:${row},${col}`)
    )
    const status = kc.collected ? 'Collected' : 'Active'
    entities.push({
      id: kc.id || `keycard-${row}-${col}-${i}`,
      category: SANDBOX_CATEGORY_IDS.COLLECTIBLES,
      categoryLabel: 'Collectibles',
      type: KEYCARD_COLLECTIBLE_TYPE,
      label: 'Resonance Keycard',
      gridCoord: { row, col },
      worldPos,
      status,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: isManual ? 'manual' : 'procedural',
      preference: kc.placementPreference || 'auto',
    })
  }

  const items = Array.isArray(maze?.collectibles?.items) ? maze.collectibles.items : []
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]
    if (!it) continue
    const row = Number.isInteger(it.row) ? it.row : 0
    const col = Number.isInteger(it.col) ? it.col : 0
    const worldPos = {
      x: it.x ?? 0,
      y: it.y ?? 0,
      z: it.z ?? 0,
    }
    const isManual = Boolean(
      it.isManual ||
      manualPlacementsLookup.has(`${SANDBOX_CATEGORY_IDS.COLLECTIBLES}:${it.type}:${row},${col}`)
    )
    const status = it.collected ? 'Collected' : 'Active'
    entities.push({
      id: it.id || `item-${it.type}-${row}-${col}-${i}`,
      category: SANDBOX_CATEGORY_IDS.COLLECTIBLES,
      categoryLabel: 'Collectibles',
      type: it.type || it.category,
      label: it.label || it.type,
      gridCoord: { row, col },
      worldPos,
      status,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: isManual ? 'manual' : 'procedural',
      preference: it.placementPreference || 'auto',
    })
  }

  // 5. Environmental Props
  const props = Array.isArray(maze?.environmentalProps) ? maze.environmentalProps : []
  for (let i = 0; i < props.length; i += 1) {
    const p = props[i]
    if (!p) continue
    const row = Number.isInteger(p.row) ? p.row : 0
    const col = Number.isInteger(p.col) ? p.col : 0
    const worldPos = {
      x: p.worldX ?? (p.x ?? 0),
      y: p.worldY ?? (p.y ?? 0),
      z: p.worldZ ?? (p.z ?? 0),
    }
    const isManual = Boolean(
      p.isManual ||
      manualPlacementsLookup.has(`${SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS}:${p.type}:${row},${col}`)
    )
    entities.push({
      id: p.id || `prop-${p.type}-${row}-${col}-${i}`,
      category: SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      categoryLabel: 'Environmental Objects',
      type: p.type,
      label: p.label || p.type,
      gridCoord: { row, col },
      worldPos,
      status: 'Static',
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: isManual ? 'manual' : 'procedural',
      preference: p.placementPreference || 'auto',
    })
  }

  return {
    player: {
      worldPos: playerWorldPos,
      gridCell: playerGridCell,
    },
    entities,
    totalEntities: entities.length,
  }
}

/**
 * Compiles a comprehensive runtime verification report comparing configured parameters,
 * generation validation reports, and live engine state.
 */
export function generateLiveVerificationReport(engine, maze, sandboxConfig = null) {
  const config = sandboxConfig || maze?.sandboxConfig || engine?.sandboxConfig || null
  const genReport = maze?.sandboxValidationReport || null
  const liveExtraction = extractLiveEntitiesFromEngine(engine, maze)

  const rows = maze?.rows || maze?.grid?.length || 21
  const cols = maze?.cols || maze?.grid?.[0]?.length || 21
  const startCell = maze?.start || { row: 1, col: 1 }
  const exitCell = maze?.exit || { row: rows - 2, col: cols - 2 }

  const ruleChecks = [
    {
      id: 'bounds_check',
      label: 'Grid Coordinates Within Bounds',
      description: `All entities must sit within grid boundary [0..${rows - 1}, 0..${cols - 1}].`,
      passed: true,
      violations: [],
    },
    {
      id: 'path_walkability',
      label: 'Walkable Path Placements',
      description: 'Hazards, collectibles, and enemy spawn locations must be placed on open corridor paths.',
      passed: true,
      violations: [],
    },
    {
      id: 'player_start_clearance',
      label: 'Player Spawn Safety Buffer',
      description: 'No hazards or enemy spawns on the arrival elevator landing deck.',
      passed: true,
      violations: [],
    },
    {
      id: 'enemy_min_distance',
      label: 'Enemy Minimum Spawn Clearance',
      description: 'Hostile entities must spawn at least 3 tiles away from player start.',
      passed: true,
      violations: [],
    },
    {
      id: 'manual_coordinate_fidelity',
      label: 'Manual Coordinate Placement Fidelity',
      description: 'All requested manual grid coordinates must match actual entity spawn locations.',
      passed: true,
      violations: [],
    },
  ]

  // Check live entities against verification rules
  for (const ent of liveExtraction.entities) {
    const { row, col } = ent.gridCoord
    // 1. Bounds
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      ruleChecks[0].passed = false
      ruleChecks[0].violations.push(`${ent.id} at out-of-bounds (${row}, ${col})`)
    }

    // 2. Path walkability (props and hiding spots can be wall-adjacent)
    if (maze?.grid && (ent.category === SANDBOX_CATEGORY_IDS.HAZARDS || ent.category === SANDBOX_CATEGORY_IDS.COLLECTIBLES || ent.category === SANDBOX_CATEGORY_IDS.ENEMIES)) {
      if (maze.grid[row]?.[col] === CELL_TYPES.WALL) {
        ruleChecks[1].passed = false
        ruleChecks[1].violations.push(`${ent.id} placed on wall tile at (${row}, ${col})`)
      }
    }

    // 3. Player start safety
    if (row === startCell.row && col === startCell.col) {
      if (ent.category === SANDBOX_CATEGORY_IDS.HAZARDS || ent.category === SANDBOX_CATEGORY_IDS.ENEMIES) {
        ruleChecks[2].passed = false
        ruleChecks[2].violations.push(`${ent.id} placed directly on player start (${row}, ${col})`)
      }
    }

    // 4. Enemy min distance
    if (ent.category === SANDBOX_CATEGORY_IDS.ENEMIES) {
      const manhattanFromStart = Math.abs(row - startCell.row) + Math.abs(col - startCell.col)
      if (manhattanFromStart < 3) {
        ruleChecks[3].passed = false
        ruleChecks[3].violations.push(`${ent.id} spawned too close to start (${manhattanFromStart} tiles < 3)`)
      }
    }
  }

  // 5. Manual coordinate fidelity check
  const manualVerifications = genReport?.manualCoordinateVerifications || []
  for (const v of manualVerifications) {
    if (!v.verified) {
      ruleChecks[4].passed = false
      ruleChecks[4].violations.push(
        `Failed manual placement for ${v.itemId} at (${v.row}, ${v.col})`
      )
    }
  }

  const allRulesPassed = ruleChecks.every((r) => r.passed)
  const genStatus = genReport?.validationStatus || (allRulesPassed ? 'PASS' : 'FAIL')

  const overallStatus =
    !allRulesPassed || genStatus === 'FAIL'
      ? 'FAIL'
      : genStatus === 'WARNING'
        ? 'WARNING'
        : 'PASS'

  return {
    status: overallStatus,
    allRulesPassed,
    ruleChecks,
    genReport,
    liveEntities: liveExtraction.entities,
    player: liveExtraction.player,
    mazeMeta: {
      seed: maze?.seed ?? 'unknown',
      dimensions: `${rows} × ${cols}`,
      start: startCell,
      exit: exitCell,
    },
  }
}
