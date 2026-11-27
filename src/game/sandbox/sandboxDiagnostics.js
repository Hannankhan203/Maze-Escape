import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  SANDBOX_CATEGORIES,
  SANDBOX_CATEGORY_IDS,
  isItemQuantityEligible,
} from './sandboxConfig.js'
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

function buildItemLabelLookup() {
  const map = new Map()
  for (const cat of SANDBOX_CATEGORIES) {
    for (const item of cat.items) {
      map.set(`${cat.id}:${item.id}`, item.label)
      if (!map.has(item.id)) {
        map.set(item.id, item.label)
      }
    }
  }
  return map
}

const ITEM_LABEL_LOOKUP = buildItemLabelLookup()

/**
 * Extracts live entities across all categories from the active 3D engine and maze layout.
 */
export function extractLiveEntitiesFromEngine(engine, maze, sandboxConfigOverride = null) {
  const playerWorldPos =
    engine?.getPlayerWorldPosition?.() ||
    engine?._playerWorldPos ||
    { x: 0, y: 0, z: 0 }
  const playerGridCell =
    engine?.getPlayerGridCell?.() ||
    maze?.start ||
    { row: 0, col: 0 }

  const seed = maze?.seed ?? 'unknown'
  const rows = maze?.rows || maze?.grid?.length || 21
  const cols = maze?.cols || maze?.grid?.[0]?.length || 21
  const startCell = maze?.start || { row: 1, col: 1 }

  const entities = []
  const manualPlacementsLookup = new Map()
  const cfg = sandboxConfigOverride || maze?.sandboxConfig || engine?.sandboxConfig || null

  if (cfg?.categories) {
    for (const [catId, catObj] of Object.entries(cfg.categories)) {
      for (const [itemId, itemEntry] of Object.entries(catObj?.items || {})) {
        if (itemEntry?.enabled && Array.isArray(itemEntry?.manualPlacements)) {
          for (const p of itemEntry.manualPlacements) {
            if (p && Number.isInteger(p.row) && Number.isInteger(p.col)) {
              const key = `${catId}:${itemId}:${p.row},${p.col}`
              manualPlacementsLookup.set(key, {
                categoryId: catId,
                itemId,
                row: p.row,
                col: p.col,
                id: p.id || null,
              })
            }
          }
        }
      }
    }
  }

  const resolveOriginMeta = (rawObj, catId, itemId, row, col) => {
    const manualMatch = manualPlacementsLookup.get(`${catId}:${itemId}:${row},${col}`) || null
    const isManual = Boolean(
      rawObj?.isManual ||
        rawObj?.placementOrigin === 'manual' ||
        manualMatch
    )
    const manualId = rawObj?.manualId || manualMatch?.id || null
    const configuredPref = cfg?.categories?.[catId]?.items?.[itemId]?.placementPreference
    const preference =
      rawObj?.placementPreference ||
      (isManual ? 'manual' : configuredPref || 'auto')
    return {
      isManual,
      manualId,
      origin: isManual ? 'manual' : 'automatic',
      preference,
    }
  }

  const computeEntityValidation = (ent) => {
    const issues = []
    const { row, col } = ent.gridCoord
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= rows || col < 0 || col >= cols) {
      issues.push('out_of_bounds')
    } else if (
      maze?.grid &&
      (ent.category === SANDBOX_CATEGORY_IDS.HAZARDS ||
        ent.category === SANDBOX_CATEGORY_IDS.COLLECTIBLES ||
        ent.category === SANDBOX_CATEGORY_IDS.ENEMIES) &&
      maze.grid[row]?.[col] === CELL_TYPES.WALL
    ) {
      issues.push('wall_cell')
    }

    if (
      row === startCell.row &&
      col === startCell.col &&
      (ent.category === SANDBOX_CATEGORY_IDS.HAZARDS || ent.category === SANDBOX_CATEGORY_IDS.ENEMIES)
    ) {
      issues.push('start_cell_conflict')
    }

    if (ent.category === SANDBOX_CATEGORY_IDS.ENEMIES) {
      const dist = calcManhattanDist({ row, col }, startCell)
      if (dist < 3) {
        issues.push('start_safety_clearance_violation')
      }
    }

    return {
      validationStatus: issues.length > 0 ? 'FAIL' : 'PASS',
      validationIssues: issues,
    }
  }

  // 1. Hazards
  const hazardManager = engine?.getHazardManager?.() || null
  const hazardList =
    hazardManager?.getHazards?.() ||
    (Array.isArray(maze?.hazards) ? maze.hazards : [])

  for (let i = 0; i < hazardList.length; i += 1) {
    const rawH = hazardList[i]
    if (!rawH) continue
    const hStateResult = typeof rawH.getState === 'function' ? rawH.getState() : null
    const h = hStateResult && typeof hStateResult === 'object' ? { ...rawH, ...hStateResult } : rawH
    const hType = h.type || 'unknown'
    const hazardStateStr = typeof hStateResult === 'string' ? hStateResult : (h.state || null)
    const row = Number.isInteger(h.row) ? h.row : (h.gridRow ?? 0)
    const col = Number.isInteger(h.col) ? h.col : (h.gridCol ?? 0)
    const worldPos = {
      x: h.worldPos?.x ?? h.cellWorldPos?.x ?? h.position?.x ?? h.x ?? 0,
      y: h.worldPos?.y ?? h.cellWorldPos?.y ?? h.position?.y ?? h.y ?? 0,
      z: h.worldPos?.z ?? h.cellWorldPos?.z ?? h.position?.z ?? h.z ?? 0,
    }
    const meta = resolveOriginMeta(h, SANDBOX_CATEGORY_IDS.HAZARDS, hType, row, col)
    const isTriggeredOrDisabled = Boolean(
      h.isTriggered ||
        h.isPermanentlyCollapsed ||
        h.isDisabled ||
        hazardStateStr === 'disabled'
    )
    const active = h.isActive !== false && !h.isDisposed && !isTriggeredOrDisabled
    const interactable = Boolean(h.interactable ?? active)
    const status = isTriggeredOrDisabled
      ? (hazardStateStr === 'disabled' || h.isDisabled || h.isPermanentlyCollapsed ? 'Disabled / Triggered' : 'Triggered')
      : hazardStateStr === 'active'
        ? 'Active'
        : hazardStateStr === 'warning'
          ? 'Warning'
          : active
            ? 'Armed'
            : 'Inactive'
    const ent = {
      id: h.id || `hazard-${hType}-${row}-${col}-${i}`,
      manualId: meta.manualId,
      category: SANDBOX_CATEGORY_IDS.HAZARDS,
      categoryLabel: 'Hazards',
      type: hType,
      label: h.label || ITEM_LABEL_LOOKUP.get(`${SANDBOX_CATEGORY_IDS.HAZARDS}:${hType}`) || hType,
      gridCoord: { row, col },
      worldPos,
      seed,
      status,
      active,
      interactable,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: meta.origin,
      preference: meta.preference,
      entityState: {
        hazardType: hType,
        hazardState: hazardStateStr || (isTriggeredOrDisabled ? 'disabled' : 'dormant'),
        triggered: isTriggeredOrDisabled,
        armed: active,
        mountType: h.mountType || null,
        wallSide: h.wallSide || null,
        cooldownRemaining: Number.isFinite(h.cooldownTimer) ? Number(h.cooldownTimer.toFixed(2)) : 0,
        registeredInManager: Boolean(hazardManager),
      },
    }
    entities.push({ ...ent, ...computeEntityValidation(ent) })
  }

  // 2. Enemies
  const enemyManager = engine?.getEnemyManager?.() || null
  const enemyList =
    enemyManager?.getEnemies?.() ||
    (Array.isArray(maze?.enemies) ? maze.enemies : [])

  for (let i = 0; i < enemyList.length; i += 1) {
    const rawE = enemyList[i]
    if (!rawE) continue
    const eStateResult = typeof rawE.getState === 'function' ? rawE.getState() : null
    const e = eStateResult && typeof eStateResult === 'object' ? { ...rawE, ...eStateResult } : rawE
    const enemyType = e.type || e.archetype || 'unknown'
    const enemyAiState = typeof eStateResult === 'string' ? eStateResult : (e.state || 'patrol')
    const liveCell = typeof rawE.getGridCell === 'function' ? rawE.getGridCell() : null
    const spawnCell = e.spawnCell || liveCell || e.currentCell || { row: e.row ?? 0, col: e.col ?? 0 }
    const currentCell = liveCell || e.currentCell || spawnCell
    const row = Number.isInteger(spawnCell.row) ? spawnCell.row : 0
    const col = Number.isInteger(spawnCell.col) ? spawnCell.col : 0
    const worldPos = {
      x: e.worldPos?.x ?? e.position?.x ?? e.x ?? 0,
      y: e.worldPos?.y ?? e.position?.y ?? e.y ?? 0,
      z: e.worldPos?.z ?? e.position?.z ?? e.z ?? 0,
    }
    const meta = resolveOriginMeta(e, SANDBOX_CATEGORY_IDS.ENEMIES, enemyType, row, col)
    const active = !e.isDisposed && e.active !== false
    const ent = {
      id: e.id || `enemy-${enemyType}-${row}-${col}-${i}`,
      manualId: meta.manualId,
      category: SANDBOX_CATEGORY_IDS.ENEMIES,
      categoryLabel: 'Enemies',
      type: enemyType,
      label: ITEM_LABEL_LOOKUP.get(`${SANDBOX_CATEGORY_IDS.ENEMIES}:${enemyType}`) || String(enemyType).toUpperCase(),
      gridCoord: { row, col },
      currentGridCoord: currentCell,
      worldPos,
      seed,
      status: enemyAiState,
      active,
      interactable: false,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist(currentCell, playerGridCell),
      origin: meta.origin,
      preference: meta.preference,
      entityState: {
        archetype: enemyType,
        aiState: enemyAiState,
        spawnCell: { row, col },
        currentCell: { row: currentCell.row ?? row, col: currentCell.col ?? col },
        stunned: Boolean(e.isStunned || e.stunTimer > 0),
        slowed: Boolean(
          e.isTimeSlowed ||
            (e.speedMultiplier && e.speedMultiplier < 1) ||
            (e.slowFactor && e.slowFactor < 1)
        ),
        watchersEyeRevealed: Boolean(e.isWatchersEyeRevealed),
        registeredInManager: Boolean(enemyManager),
      },
    }
    entities.push({ ...ent, ...computeEntityValidation(ent) })
  }

  // 3. Hiding Spots
  const hidingManager =
    engine?.getHidingSpotManager?.() ||
    engine?.hidingSpotManager ||
    null
  const hidingList =
    hidingManager?.getHidingSpots?.() ||
    hidingManager?.getSpots?.() ||
    (Array.isArray(maze?.hidingSpots) ? maze.hidingSpots : [])

  for (let i = 0; i < hidingList.length; i += 1) {
    const s = hidingList[i]
    if (!s) continue
    const spotType = s.type || 'unknown'
    const row = Number.isInteger(s.row) ? s.row : 0
    const col = Number.isInteger(s.col) ? s.col : 0
    const worldPos = {
      x: s.worldPos?.x ?? (s.x ?? 0),
      y: s.worldPos?.y ?? (s.y ?? 0),
      z: s.worldPos?.z ?? (s.z ?? 0),
    }
    const meta = resolveOriginMeta(s, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, spotType, row, col)
    const isCompromised = Boolean(s.compromised ?? s.isCompromised)
    const active = s.isActive !== false && !s.isDisposed && !isCompromised
    const status = isCompromised ? 'Compromised' : s.isOccupied ? 'Player Inside' : 'Vacant'
    const ent = {
      id: s.id || `hiding-${spotType}-${row}-${col}-${i}`,
      manualId: meta.manualId,
      category: SANDBOX_CATEGORY_IDS.HIDING_SPOTS,
      categoryLabel: 'Hiding Spots',
      type: spotType,
      label: s.label || ITEM_LABEL_LOOKUP.get(`${SANDBOX_CATEGORY_IDS.HIDING_SPOTS}:${spotType}`) || spotType,
      gridCoord: { row, col },
      worldPos,
      seed,
      status,
      active,
      interactable: active,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: meta.origin,
      preference: meta.preference,
      entityState: {
        spotType,
        occupied: Boolean(s.isOccupied),
        compromised: isCompromised,
        wallSide: s.wallSide || null,
        exposure: Number.isFinite(s.exposure) ? Number(s.exposure.toFixed(2)) : 0,
        registeredInManager: Boolean(hidingManager),
      },
    }
    entities.push({ ...ent, ...computeEntityValidation(ent) })
  }

  // 4. Keycards & Collectibles (combining maze data + live CollectibleManager active state)
  const collectibleManager = engine?.getCollectibleManager?.() || null
  const activeKeycards = collectibleManager?.getActiveKeycards?.() || null
  const activeItems = collectibleManager?.getActiveItems?.() || null
  const activeKeycardById = new Map((activeKeycards || []).map((k) => [k.id, k]))
  const activeItemById = new Map((activeItems || []).map((it) => [it.id, it]))

  const mazeKeycards = Array.isArray(maze?.keycards) ? maze.keycards : []
  const keycardsToInspect =
    mazeKeycards.length > 0
      ? mazeKeycards
      : Array.isArray(activeKeycards)
        ? activeKeycards
        : []

  for (let i = 0; i < keycardsToInspect.length; i += 1) {
    const kc = keycardsToInspect[i]
    if (!kc) continue
    const liveKc = activeKeycardById.get(kc.id) || null
    const row = Number.isInteger(kc.row) ? kc.row : 0
    const col = Number.isInteger(kc.col) ? kc.col : 0
    const worldPos = {
      x: liveKc?.worldPos?.x ?? liveKc?.x ?? kc.worldPos?.x ?? kc.x ?? 0,
      y: liveKc?.worldPos?.y ?? liveKc?.y ?? kc.worldPos?.y ?? kc.y ?? 0,
      z: liveKc?.worldPos?.z ?? liveKc?.z ?? kc.worldPos?.z ?? kc.z ?? 0,
    }
    const meta = resolveOriginMeta(
      liveKc || kc,
      SANDBOX_CATEGORY_IDS.COLLECTIBLES,
      KEYCARD_COLLECTIBLE_TYPE,
      row,
      col
    )
    const isCollected = collectibleManager
      ? !activeKeycardById.has(kc.id)
      : Boolean(kc.collected)
    const status = isCollected ? 'Collected' : 'Active'
    const ent = {
      id: kc.id || `keycard-${row}-${col}-${i}`,
      manualId: meta.manualId,
      category: SANDBOX_CATEGORY_IDS.COLLECTIBLES,
      categoryLabel: 'Collectibles · Keycard',
      type: KEYCARD_COLLECTIBLE_TYPE,
      label: 'Resonance Keycard',
      gridCoord: { row, col },
      worldPos,
      seed,
      status,
      active: !isCollected,
      interactable: !isCollected,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: meta.origin,
      preference: meta.preference,
      entityState: {
        collectibleType: KEYCARD_COLLECTIBLE_TYPE,
        collected: isCollected,
        unlocksExitGate: true,
        registeredInManager: Boolean(collectibleManager && !isCollected),
      },
    }
    entities.push({ ...ent, ...computeEntityValidation(ent) })
  }

  const mazeItems = Array.isArray(maze?.collectibles?.items) ? maze.collectibles.items : []
  const itemsToInspect =
    mazeItems.length > 0
      ? mazeItems
      : Array.isArray(activeItems)
        ? activeItems
        : []

  for (let i = 0; i < itemsToInspect.length; i += 1) {
    const it = itemsToInspect[i]
    if (!it) continue
    const liveIt = activeItemById.get(it.id) || null
    const itemType = it.type || it.category || 'unknown'
    const row = Number.isInteger(it.row) ? it.row : 0
    const col = Number.isInteger(it.col) ? it.col : 0
    const worldPos = {
      x: liveIt?.worldPos?.x ?? liveIt?.x ?? it.worldPos?.x ?? it.x ?? 0,
      y: liveIt?.worldPos?.y ?? liveIt?.y ?? it.worldPos?.y ?? it.y ?? 0,
      z: liveIt?.worldPos?.z ?? liveIt?.z ?? it.worldPos?.z ?? it.z ?? 0,
    }
    const meta = resolveOriginMeta(
      liveIt || it,
      SANDBOX_CATEGORY_IDS.COLLECTIBLES,
      itemType,
      row,
      col
    )
    const isCollected = collectibleManager
      ? !activeItemById.has(it.id)
      : Boolean(it.collected)
    const status = isCollected ? 'Collected' : 'Active'
    const ent = {
      id: it.id || `item-${itemType}-${row}-${col}-${i}`,
      manualId: meta.manualId,
      category: SANDBOX_CATEGORY_IDS.COLLECTIBLES,
      categoryLabel: 'Collectibles',
      type: itemType,
      label: it.label || ITEM_LABEL_LOOKUP.get(`${SANDBOX_CATEGORY_IDS.COLLECTIBLES}:${itemType}`) || itemType,
      gridCoord: { row, col },
      worldPos,
      seed,
      status,
      active: !isCollected,
      interactable: !isCollected,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: meta.origin,
      preference: meta.preference,
      entityState: {
        collectibleType: itemType,
        collected: isCollected,
        registeredInManager: Boolean(collectibleManager && !isCollected),
      },
    }
    entities.push({ ...ent, ...computeEntityValidation(ent) })
  }

  // 5. Environmental Props & Hazard Decoys
  const engineProps = engine?.getEnvironmentalProps?.()
  const props =
    Array.isArray(engineProps) && engineProps.length > 0
      ? engineProps
      : Array.isArray(maze?.environmentalProps)
        ? maze.environmentalProps
        : []

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
    const meta = resolveOriginMeta(p, SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS, p.type, row, col)
    const ent = {
      id: p.id || `prop-${p.type}-${row}-${col}-${i}`,
      manualId: meta.manualId,
      category: SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      categoryLabel: 'Environmental Objects',
      type: p.type,
      label: p.label || ITEM_LABEL_LOOKUP.get(`${SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS}:${p.type}`) || p.type,
      gridCoord: { row, col },
      worldPos,
      seed,
      status: 'Static',
      active: true,
      interactable: false,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: meta.origin,
      preference: meta.preference,
      entityState: {
        propType: p.type,
        wallSide: p.wallSide || null,
        wallMounted: Boolean(p.wallMounted),
        registeredInEngine: Boolean(Array.isArray(engineProps) && engineProps.length > 0),
      },
    }
    entities.push({ ...ent, ...computeEntityValidation(ent) })
  }

  const engineDecoys = engine?.getHazardDecoys?.()
  const decoys =
    Array.isArray(engineDecoys) && engineDecoys.length > 0
      ? engineDecoys
      : Array.isArray(maze?.hazardDecoys?.decoys)
        ? maze.hazardDecoys.decoys
        : []

  for (let i = 0; i < decoys.length; i += 1) {
    const d = decoys[i]
    if (!d) continue
    const row = Number.isInteger(d.row) ? d.row : 0
    const col = Number.isInteger(d.col) ? d.col : 0
    const worldPos = {
      x: d.worldX ?? (d.x ?? 0),
      y: d.worldY ?? (d.y ?? 0),
      z: d.worldZ ?? (d.z ?? 0),
    }
    const ent = {
      id: d.id || `decoy-${d.type || 'hazard_decoy'}-${row}-${col}-${i}`,
      manualId: null,
      category: SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      categoryLabel: 'Environmental Objects',
      type: 'hazard_decoys',
      label: d.label || 'Safe Hazard Decoy',
      gridCoord: { row, col },
      worldPos,
      seed,
      status: 'Decoy (Non-Lethal)',
      active: true,
      interactable: false,
      distanceToPlayer: calcEuclideanDist(worldPos, playerWorldPos),
      gridDistance: calcManhattanDist({ row, col }, playerGridCell),
      origin: 'automatic',
      preference: d.placementPreference || 'auto',
      entityState: {
        decoySubType: d.type || null,
        nonLethal: true,
        registeredInEngine: Boolean(Array.isArray(engineDecoys) && engineDecoys.length > 0),
      },
    }
    entities.push({ ...ent, ...computeEntityValidation(ent) })
  }

  return {
    player: {
      worldPos: playerWorldPos,
      gridCell: playerGridCell,
    },
    entities,
    totalEntities: entities.length,
    managersAvailable: {
      hazards: Boolean(hazardManager),
      enemies: Boolean(enemyManager),
      hidingSpots: Boolean(hidingManager),
      collectibles: Boolean(collectibleManager),
      environmentalProps: Boolean(engine?.getEnvironmentalProps),
    },
  }
}

/**
 * Builds Requested | Manual | Automatic | Actual | Failed comparison rows
 * directly from actual generator/runtime data.
 */
function buildComparisonRows(genReport, sandboxConfig, liveEntities) {
  const rows = []
  const itemsReport = genReport?.itemsReport || null

  if (itemsReport) {
    for (const cat of SANDBOX_CATEGORIES) {
      const catReport = itemsReport[cat.id] || {}
      for (const item of cat.items) {
        const ir = catReport[item.id]
        if (!ir) continue
        const isMatched = ir.failedQuantity === 0
        const status = !isMatched
          ? 'FAIL'
          : ir.fallbackPlacementUsed
            ? 'WARNING'
            : 'PASS'
        rows.push({
          categoryId: cat.id,
          categoryLabel: cat.shortLabel,
          itemId: item.id,
          label: item.label,
          requested: ir.requestedQuantity ?? 0,
          manual: ir.manualRequested ?? 0,
          manualPlaced: ir.manualPlaced ?? 0,
          automatic: ir.automaticRequested ?? 0,
          automaticPlaced: ir.automaticPlaced ?? 0,
          actual: ir.placedQuantity ?? 0,
          failed: ir.failedQuantity ?? 0,
          placementPreferenceRequested: ir.placementPreferenceRequested || 'auto',
          fallbackPlacementUsed: Boolean(ir.fallbackPlacementUsed),
          status,
          failureReasons: Array.isArray(ir.failureReasons) ? ir.failureReasons : [],
        })
      }
    }
    return rows
  }

  // Fallback only if no generation report exists (e.g. partial test stub)
  if (sandboxConfig?.categories) {
    for (const cat of SANDBOX_CATEGORIES) {
      const catItems = sandboxConfig.categories[cat.id]?.items || {}
      for (const item of cat.items) {
        if (!isItemQuantityEligible(cat.id, item.id)) continue
        const entry = catItems[item.id]
        if (!entry?.enabled) continue
        const liveMatches = liveEntities.filter(
          (e) => e.category === cat.id && e.type === item.id
        )
        const manualCount = Array.isArray(entry.manualPlacements) ? entry.manualPlacements.length : 0
        const req = entry.quantity !== null && entry.quantity !== undefined ? entry.quantity : liveMatches.length
        const autoReq = Math.max(0, req - manualCount)
        const failed = Math.max(0, req - liveMatches.length)
        rows.push({
          categoryId: cat.id,
          categoryLabel: cat.shortLabel,
          itemId: item.id,
          label: item.label,
          requested: req,
          manual: manualCount,
          manualPlaced: liveMatches.filter((e) => e.origin === 'manual').length,
          automatic: autoReq,
          automaticPlaced: liveMatches.filter((e) => e.origin === 'automatic').length,
          actual: liveMatches.length,
          failed,
          placementPreferenceRequested: entry.placementPreference || 'auto',
          fallbackPlacementUsed: false,
          status: failed > 0 ? 'FAIL' : 'PASS',
          failureReasons: failed > 0 ? ['missing_live_entities'] : [],
        })
      }
    }
  }

  return rows
}

/**
 * Compiles a comprehensive runtime verification report comparing configured parameters,
 * generation validation reports, and live engine state.
 */
export function generateLiveVerificationReport(engine, maze, sandboxConfigOverride = null) {
  const effectiveConfig = sandboxConfigOverride || maze?.sandboxConfig || engine?.sandboxConfig || null
  const genReport = maze?.sandboxValidationReport || null
  const liveExtraction = extractLiveEntitiesFromEngine(engine, maze, effectiveConfig)

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
      label: 'Manual Coordinate, Origin & Identity Fidelity',
      description: 'Requested manual entities must exist at exact coordinates with manual origin, expected identity, and no unintended duplicates or relocations.',
      passed: true,
      violations: [],
    },
    {
      id: 'automatic_quantity_and_exclusions',
      label: 'Automatic Quantities & Configuration Exclusions',
      description: 'Disabled entities must remain excluded and requested quantities must honor strict/fallback rules.',
      passed: true,
      violations: [],
    },
    {
      id: 'engine_registration',
      label: 'Runtime Manager & Gameplay Registration',
      description: 'Active maze entities must match runtime engine managers when the 3D scene is mounted.',
      passed: true,
      violations: [],
    },
  ]

  const navigableFailures = []
  const pushFailure = (failure) => {
    navigableFailures.push({
      row: Number.isInteger(failure.row) ? failure.row : null,
      col: Number.isInteger(failure.col) ? failure.col : null,
      categoryId: failure.categoryId || null,
      itemId: failure.itemId || failure.type || null,
      reason: failure.reason || 'verification_failure',
      isManual: Boolean(failure.isManual),
      canNavigate: Number.isInteger(failure.row) && Number.isInteger(failure.col),
    })
  }

  // 1-4: Verify live entity spatial & safety integrity
  for (const ent of liveExtraction.entities) {
    const { row, col } = ent.gridCoord
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      ruleChecks[0].passed = false
      ruleChecks[0].violations.push(`${ent.id} at out-of-bounds (${row}, ${col})`)
      pushFailure({ row, col, categoryId: ent.category, itemId: ent.type, reason: 'out_of_bounds', isManual: ent.origin === 'manual' })
    }

    if (
      maze?.grid &&
      (ent.category === SANDBOX_CATEGORY_IDS.HAZARDS ||
        ent.category === SANDBOX_CATEGORY_IDS.COLLECTIBLES ||
        ent.category === SANDBOX_CATEGORY_IDS.ENEMIES)
    ) {
      if (maze.grid[row]?.[col] === CELL_TYPES.WALL) {
        ruleChecks[1].passed = false
        ruleChecks[1].violations.push(`${ent.id} placed on wall tile at (${row}, ${col})`)
        pushFailure({ row, col, categoryId: ent.category, itemId: ent.type, reason: 'wall_cell', isManual: ent.origin === 'manual' })
      }
    }

    if (row === startCell.row && col === startCell.col) {
      if (ent.category === SANDBOX_CATEGORY_IDS.HAZARDS || ent.category === SANDBOX_CATEGORY_IDS.ENEMIES) {
        ruleChecks[2].passed = false
        ruleChecks[2].violations.push(`${ent.id} placed directly on player start (${row}, ${col})`)
        pushFailure({ row, col, categoryId: ent.category, itemId: ent.type, reason: 'start_or_exit_cell', isManual: ent.origin === 'manual' })
      }
    }

    if (ent.category === SANDBOX_CATEGORY_IDS.ENEMIES) {
      const manhattanFromStart = Math.abs(row - startCell.row) + Math.abs(col - startCell.col)
      if (manhattanFromStart < 3) {
        ruleChecks[3].passed = false
        ruleChecks[3].violations.push(`${ent.id} spawned too close to start (${manhattanFromStart} tiles < 3)`)
        pushFailure({ row, col, categoryId: ent.category, itemId: ent.type, reason: 'start_safety_clearance', isManual: ent.origin === 'manual' })
      }
    }
  }

  // 5: Live Manual Placement Fidelity verification directly against live entities & config
  const manualVerificationResults = []
  if (effectiveConfig?.categories) {
    for (const [catId, catObj] of Object.entries(effectiveConfig.categories)) {
      for (const [itemId, entry] of Object.entries(catObj?.items || {})) {
        if (!entry?.enabled || !Array.isArray(entry.manualPlacements)) continue
        for (const mp of entry.manualPlacements) {
          if (!mp || !Number.isInteger(mp.row) || !Number.isInteger(mp.col)) continue
          const matched = liveExtraction.entities.filter(
            (e) =>
              e.category === catId &&
              e.type === itemId &&
              e.gridCoord.row === mp.row &&
              e.gridCoord.col === mp.col
          )
          const genCheck = Array.isArray(genReport?.manualCoordinateVerifications)
            ? genReport.manualCoordinateVerifications.find(
                (v) =>
                  v.categoryId === catId &&
                  v.itemId === itemId &&
                  v.row === mp.row &&
                  v.col === mp.col &&
                  (!mp.id || !v.manualId || v.manualId === mp.id)
              )
            : null
          let verified = matched.length > 0
          let manualOriginVerified = false
          let identityVerified = mp.id ? false : true
          let noUnexpectedDuplicates = true
          let reason = null

          if (matched.length === 0) {
            // Check whether relocated elsewhere with same manualId
            const relocated = mp.id
              ? liveExtraction.entities.find((e) => e.manualId === mp.id)
              : null
            reason = relocated ? 'unexpected_relocation' : (genCheck?.reason || 'missing_manual_entity')
            const reasonMsg = relocated
              ? `Manual ${itemId} (${mp.id}) relocated to (${relocated.gridCoord.row}, ${relocated.gridCoord.col}) instead of (${mp.row}, ${mp.col})`
              : `Missing manual ${itemId} at (${mp.row}, ${mp.col})`
            ruleChecks[4].passed = false
            ruleChecks[4].violations.push(reasonMsg)
            pushFailure({ row: mp.row, col: mp.col, categoryId: catId, itemId, reason, isManual: true })
          } else {
            manualOriginVerified = matched.some((e) => e.origin === 'manual')
            if (!manualOriginVerified) {
              verified = false
              reason = 'origin_mismatch'
              ruleChecks[4].passed = false
              ruleChecks[4].violations.push(`Manual ${itemId} at (${mp.row}, ${mp.col}) lacks manual origin metadata`)
            }
            if (mp.id) {
              identityVerified = matched.some((e) => e.manualId === mp.id)
              if (!identityVerified) {
                verified = false
                reason = 'identity_mismatch'
                ruleChecks[4].passed = false
                ruleChecks[4].violations.push(`Manual ${itemId} at (${mp.row}, ${mp.col}) identity mismatch (expected ${mp.id})`)
              }
            }
            if (matched.length > 1) {
              const dupReqCount = entry.manualPlacements.filter(
                (p) => p.row === mp.row && p.col === mp.col
              ).length
              if (matched.length > dupReqCount) {
                verified = false
                noUnexpectedDuplicates = false
                reason = 'unexpected_duplicate'
                ruleChecks[4].passed = false
                ruleChecks[4].violations.push(`Unintended duplicate manual ${itemId} at (${mp.row}, ${mp.col}) (${matched.length} instances)`)
              }
            }
          }

          manualVerificationResults.push({
            categoryId: catId,
            itemId,
            manualId: mp.id || null,
            row: mp.row,
            col: mp.col,
            verified,
            manualOriginVerified,
            identityVerified,
            noUnexpectedDuplicates,
            status: verified ? 'PASS' : 'FAIL',
            reason,
          })
        }
      }
    }
  } else {
    const manualVerifications = genReport?.manualCoordinateVerifications || []
    for (const v of manualVerifications) {
      if (!v.verified) {
        ruleChecks[4].passed = false
        ruleChecks[4].violations.push(`Failed manual placement for ${v.itemId} at (${v.row}, ${v.col})`)
        pushFailure({ row: v.row, col: v.col, categoryId: v.categoryId, itemId: v.itemId, reason: 'missing_manual_entity', isManual: true })
      }
      manualVerificationResults.push({
        ...v,
        status: v.verified ? 'PASS' : 'FAIL',
      })
    }
  }

  // 6: Exclusion & quantity shortfall checks
  if (effectiveConfig?.categories) {
    for (const ent of liveExtraction.entities) {
      const entry = effectiveConfig.categories?.[ent.category]?.items?.[ent.type]
      if (entry && (!entry.enabled || entry.quantity === 0)) {
        ruleChecks[5].passed = false
        ruleChecks[5].violations.push(
          `Excluded entity ${ent.type} spawned at (${ent.gridCoord.row}, ${ent.gridCoord.col}) despite ${!entry.enabled ? 'disabled config' : 'quantity=0'}`
        )
        pushFailure({ row: ent.gridCoord.row, col: ent.gridCoord.col, categoryId: ent.category, itemId: ent.type, reason: 'exclusion_violated', isManual: ent.origin === 'manual' })
      }
    }
  }
  if (genReport?.totalFailed > 0) {
    ruleChecks[5].passed = false
    ruleChecks[5].violations.push(
      `${genReport.totalFailed} requested placement(s) could not be placed (${(genReport.omittedByConstraints || []).map((o) => `${o.itemId}: -${o.omitted}`).join(', ')})`
    )
  }

  // 7: Runtime engine manager registration check (when engine is mounted)
  if (engine && maze) {
    const expectedHazards = Array.isArray(maze.hazards) ? maze.hazards.length : 0
    const liveHazards = liveExtraction.managersAvailable.hazards
      ? liveExtraction.entities.filter((e) => e.category === SANDBOX_CATEGORY_IDS.HAZARDS).length
      : expectedHazards
    if (liveHazards !== expectedHazards) {
      ruleChecks[6].passed = false
      ruleChecks[6].violations.push(`HazardManager registered ${liveHazards}/${expectedHazards} hazards`)
    }

    const expectedEnemies = Array.isArray(maze.enemies) ? maze.enemies.length : 0
    const liveEnemies = liveExtraction.managersAvailable.enemies
      ? liveExtraction.entities.filter((e) => e.category === SANDBOX_CATEGORY_IDS.ENEMIES).length
      : expectedEnemies
    if (liveEnemies !== expectedEnemies) {
      ruleChecks[6].passed = false
      ruleChecks[6].violations.push(`EnemyManager registered ${liveEnemies}/${expectedEnemies} enemies`)
    }

    const expectedHiding = Array.isArray(maze.hidingSpots) ? maze.hidingSpots.length : 0
    const liveHiding = liveExtraction.managersAvailable.hidingSpots
      ? liveExtraction.entities.filter((e) => e.category === SANDBOX_CATEGORY_IDS.HIDING_SPOTS).length
      : expectedHiding
    if (liveHiding !== expectedHiding) {
      ruleChecks[6].passed = false
      ruleChecks[6].violations.push(`HidingSpotManager registered ${liveHiding}/${expectedHiding} hiding spots`)
    }

    const expectedProps = Array.isArray(maze.environmentalProps) ? maze.environmentalProps.length : 0
    const liveProps = liveExtraction.managersAvailable.environmentalProps
      ? liveExtraction.entities.filter((e) => e.category === SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS && e.type !== 'hazard_decoys').length
      : expectedProps
    if (expectedProps > 0 && liveProps !== expectedProps) {
      ruleChecks[6].passed = false
      ruleChecks[6].violations.push(`MazeSceneEngine tracked ${liveProps}/${expectedProps} environmental props`)
    }
  }

  // Merge generation failure diagnostics
  if (Array.isArray(genReport?.failures)) {
    for (const f of genReport.failures) {
      pushFailure(f)
    }
  }

  const comparisonRows = buildComparisonRows(genReport, effectiveConfig, liveExtraction.entities)
  const generationSummary = {
    seed: genReport?.seed ?? maze?.seed ?? 'unknown',
    dimensions: `${rows} × ${cols}`,
    generationMode: genReport?.generationMode || (maze?.isSandbox ? 'sandbox' : 'standard'),
    selectedCount: genReport?.selectedEntities?.length ?? 0,
    excludedCount: genReport?.excludedEntities?.length ?? 0,
    omittedCount: genReport?.omittedByConstraints?.length ?? 0,
    selectedEntities: genReport?.selectedEntities || [],
    excludedEntities: genReport?.excludedEntities || [],
    omittedByConstraints: genReport?.omittedByConstraints || [],
    warnings: genReport?.warnings || [],
    blockingErrors: genReport?.blockingErrors || [],
    categorySummaries: genReport?.categorySummaries || null,
    totalRequested: genReport?.totalRequested ?? comparisonRows.reduce((s, r) => s + r.requested, 0),
    totalManual: genReport?.totalManualRequested ?? comparisonRows.reduce((s, r) => s + r.manual, 0),
    totalAutomatic: genReport?.totalAutomaticRequested ?? comparisonRows.reduce((s, r) => s + r.automatic, 0),
    totalActual: genReport?.totalPlaced ?? liveExtraction.totalEntities,
    totalFailed: genReport?.totalFailed ?? comparisonRows.reduce((s, r) => s + r.failed, 0),
  }

  const allRulesPassed = ruleChecks.every((r) => r.passed)
  const genStatus = genReport?.validationStatus || (allRulesPassed ? 'PASS' : 'FAIL')
  const hasEntityViolations = liveExtraction.entities.some((e) => e.validationStatus === 'FAIL')

  const overallStatus =
    !allRulesPassed || genStatus === 'FAIL' || hasEntityViolations || (generationSummary.blockingErrors?.length || 0) > 0
      ? 'FAIL'
      : genStatus === 'WARNING' || (generationSummary.warnings?.length || 0) > 0
        ? 'WARNING'
        : 'PASS'

  return {
    status: overallStatus,
    overallStatus,
    allRulesPassed,
    ruleChecks,
    manualVerificationResults,
    genReport,
    generationSummary,
    comparisonRows,
    failureDiagnostics: navigableFailures,
    liveEntities: liveExtraction.entities,
    player: liveExtraction.player,
    mazeMeta: {
      seed: maze?.seed ?? 'unknown',
      dimensions: `${rows} × ${cols}`,
      rows,
      cols,
      generationMode: generationSummary.generationMode,
      start: startCell,
      exit: exitCell,
    },
  }
}
