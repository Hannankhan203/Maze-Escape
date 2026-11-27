import { createRng, normalizeSeed, shuffleWithRng } from '../../utils/rng.js'
import { placeCollectiblesWithReport } from './collectiblePlacement.js'
import { KEYCARD_TYPE, placeKeycardsWithReport } from './keycardPlacement.js'
import { placeHazardsWithReport, placeSandboxHazardDecoysWithReport } from './hazardPlacement.js'
import { placeHidingSpotsWithReport } from './hidingSpotPlacement.js'
import { ENEMY_TYPES, placeEnemiesWithReport } from './enemyPlacement.js'
import { placeEnvironmentalPropsWithReport, PROP_TYPES } from './environmentalPropPlacement.js'
import {
  CELL_TYPES,
  MAX_MAZE_DIMENSION,
  MIN_BRAID_FACTOR,
  MIN_MAZE_DIMENSION,
  normalizeBraidFactor,
  normalizeDimension,
} from './mazeConfig.js'
import { exploreReachableCells, validateMaze } from './pathfinder.js'
import {
  allocateCollectibleQuantitiesForLevel,
  allocateEnemyQuantitiesForLevel,
  allocateHidingSpotQuantitiesForLevel,
  coordinateHazardAndHidingCapacity,
  getLevelConfig,
  getLevelSeed,
  normalizeBaseSeed,
  normalizeLevel,
  selectCollectibleCategoriesForLevel,
  selectEnemiesForLevel,
  selectHidingSpotTypesForLevel,
} from '../mechanics/levelProgression.js'
import {
  HIDING_SPOT_SELECTION_COUNT,
  MIN_HIDING_SPOT_INSTANCES_PER_TYPE,
  ALL_HIDING_SPOT_TYPES,
} from '../mechanics/hidingConfig.js'
import { auditHazardHidingCoexistence } from './placementCoexistence.js'
import { buildSandboxRuntimePayload } from '../sandbox/sandboxSession.js'
import {
  ENVIRONMENTAL_OBJECT_TYPES,
  isSandboxItemEnabled,
  SANDBOX_CATEGORY_IDS,
  SANDBOX_GLOBAL_LIMITS,
} from '../sandbox/sandboxConfig.js'
import { STANDARD_HAZARD_TYPES } from './hazardTypes.js'
import {
  ALL_COLLECTIBLE_CATEGORIES,
  PERMANENT_COLLECTIBLE_CATEGORIES,
  OPTIONAL_COLLECTIBLE_CATEGORIES,
  KEYCARD_COLLECTIBLE_TYPE,
} from '../mechanics/collectiblesConfig.js'
import { buildSandboxGenerationValidationReport } from './placementPreferences.js'

const CARVE_DIRS = [
  { row: -2, col: 0 },
  { row: 2, col: 0 },
  { row: 0, col: -2 },
  { row: 0, col: 2 },
]

const ORTHOGONAL_DIRS = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
]

function createFilledGrid(rows, cols, fillValue) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => fillValue)
  )
}

function countWalkableNeighbors(grid, row, col) {
  let count = 0
  for (let i = 0; i < ORTHOGONAL_DIRS.length; i += 1) {
    const nr = row + ORTHOGONAL_DIRS[i].row
    const nc = col + ORTHOGONAL_DIRS[i].col
    if (grid[nr]?.[nc] === CELL_TYPES.PATH) {
      count += 1
    }
  }
  return count
}

/**
 * Optionally opens a controlled fraction of dead ends into neighboring paths
 * to introduce tactical loops without breaking outer walls.
 */
function applyControlledBraiding(grid, braidFactor, rng) {
  if (!braidFactor || braidFactor <= 0) return

  const rows = grid.length
  const cols = grid[0].length

  for (let r = 1; r < rows - 1; r += 2) {
    for (let c = 1; c < cols - 1; c += 2) {
      if (grid[r][c] !== CELL_TYPES.PATH) continue
      if (countWalkableNeighbors(grid, r, c) !== 1) continue
      if (rng() > braidFactor) continue

      const candidateWalls = []
      for (let i = 0; i < ORTHOGONAL_DIRS.length; i += 1) {
        const wallR = r + ORTHOGONAL_DIRS[i].row
        const wallC = c + ORTHOGONAL_DIRS[i].col
        const beyondR = r + ORTHOGONAL_DIRS[i].row * 2
        const beyondC = c + ORTHOGONAL_DIRS[i].col * 2

        if (
          beyondR >= 1 &&
          beyondR < rows - 1 &&
          beyondC >= 1 &&
          beyondC < cols - 1 &&
          grid[wallR][wallC] === CELL_TYPES.WALL &&
          grid[beyondR][beyondC] === CELL_TYPES.PATH
        ) {
          candidateWalls.push({ row: wallR, col: wallC })
        }
      }

      if (candidateWalls.length > 0) {
        const chosen = candidateWalls[Math.floor(rng() * candidateWalls.length)]
        grid[chosen.row][chosen.col] = CELL_TYPES.PATH
      }
    }
  }
}

/**
 * Generates a playable, validated procedural maze using Iterative Randomized DFS
 * (Recursive Backtracking). Deterministic whenever a seed is provided.
 */
export function generateMaze(options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {}
  const diff =
    typeof safeOptions.difficulty === 'string'
      ? safeOptions.difficulty.toLowerCase()
      : ''
  const level = normalizeLevel(safeOptions.level ?? safeOptions.currentLevel ?? 1)
  const hasExplicitBaseSeed =
    safeOptions.baseSeed !== undefined &&
    safeOptions.baseSeed !== null &&
    safeOptions.baseSeed !== ''
  const baseSeed = hasExplicitBaseSeed
    ? normalizeBaseSeed(safeOptions.baseSeed)
    : undefined
  const hasExplicitSeed =
    safeOptions.seed !== undefined &&
    safeOptions.seed !== null &&
    safeOptions.seed !== ''
  const resolvedInputSeed = hasExplicitSeed
    ? safeOptions.seed
    : baseSeed !== undefined
      ? getLevelSeed(level, baseSeed)
      : undefined
  const levelConfig = getLevelConfig(
    level,
    baseSeed ?? resolvedInputSeed,
    safeOptions.progressionConfig
  )

  const rawSandboxInput = safeOptions.sandboxConfig ?? safeOptions.sandbox ?? null
  const hasSandboxOverride = Boolean(
    rawSandboxInput && typeof rawSandboxInput === 'object'
  )

  let defaultRows = levelConfig.rows
  let defaultCols = levelConfig.cols
  let defaultBraid = levelConfig.braidFactor
  if (hasSandboxOverride && safeOptions.rows === undefined && safeOptions.cols === undefined) {
    defaultRows = Math.max(defaultRows, 21)
    defaultCols = Math.max(defaultCols, 21)
    defaultBraid = Math.max(defaultBraid, 0.12)
  } else if (diff === 'easy' || diff === 'small') {
    defaultRows = 11
    defaultCols = 11
    defaultBraid = 0.0
  } else if (diff === 'medium') {
    defaultRows = 17
    defaultCols = 17
    defaultBraid = 0.08
  } else if (diff === 'hard' || diff === 'large') {
    defaultRows = 23
    defaultCols = 23
    defaultBraid = 0.14
  } else if (diff === 'hardcore') {
    defaultRows = 31
    defaultCols = 31
    defaultBraid = 0.18
  }

  const maxDim = levelConfig.maxDimension ?? MAX_MAZE_DIMENSION
  const rows = normalizeDimension(safeOptions.rows, defaultRows, {
    min: MIN_MAZE_DIMENSION,
    max: maxDim,
  })
  const cols = normalizeDimension(safeOptions.cols, defaultCols, {
    min: MIN_MAZE_DIMENSION,
    max: maxDim,
  })
  const braidFactor = normalizeBraidFactor(
    safeOptions.braidFactor,
    defaultBraid,
    { min: MIN_BRAID_FACTOR, max: 1 }
  )
  const seed = normalizeSeed(resolvedInputSeed)
  const rng = createRng(seed)

  const grid = createFilledGrid(rows, cols, CELL_TYPES.WALL)

  const start = { row: 1, col: 1 }
  grid[start.row][start.col] = CELL_TYPES.PATH

  const stack = [start]

  while (stack.length > 0) {
    const current = stack[stack.length - 1]
    const shuffledDirs = shuffleWithRng(CARVE_DIRS, rng)
    let carvedNext = false

    for (let i = 0; i < shuffledDirs.length; i += 1) {
      const nextRow = current.row + shuffledDirs[i].row
      const nextCol = current.col + shuffledDirs[i].col

      if (
        nextRow >= 1 &&
        nextRow < rows - 1 &&
        nextCol >= 1 &&
        nextCol < cols - 1 &&
        grid[nextRow][nextCol] === CELL_TYPES.WALL
      ) {
        const betweenRow = current.row + shuffledDirs[i].row / 2
        const betweenCol = current.col + shuffledDirs[i].col / 2

        grid[betweenRow][betweenCol] = CELL_TYPES.PATH
        grid[nextRow][nextCol] = CELL_TYPES.PATH
        stack.push({ row: nextRow, col: nextCol })
        carvedNext = true
        break
      }
    }

    if (!carvedNext) {
      stack.pop()
    }
  }

  applyControlledBraiding(grid, braidFactor, rng)

  // Choose the farthest reachable walkable cell from start for the exit gate
  const reachInfo = exploreReachableCells(grid, start)
  const exit =
    reachInfo.farthestCell &&
    (reachInfo.farthestCell.row !== start.row ||
      reachInfo.farthestCell.col !== start.col)
      ? reachInfo.farthestCell
      : { row: rows - 2, col: cols - 2 }

  const validation = validateMaze({ grid, start, exit })

  const sandboxPayload = hasSandboxOverride
    ? buildSandboxRuntimePayload(rawSandboxInput.config ?? rawSandboxInput)
    : null
  const sandboxConfig = sandboxPayload?.config || null

  let hazardConfig =
    safeOptions.hazardConfig ??
    safeOptions.progressionConfig?.hazards ??
    safeOptions.progressionConfig?.hazardConfig ??
    safeOptions.progressionConfig?.hazardProgression

  let collectibleConfig =
    safeOptions.collectibleConfig ??
    safeOptions.progressionConfig?.collectibles ??
    safeOptions.progressionConfig?.collectibleConfig ??
    safeOptions.progressionConfig?.collectibleProgression

  let hidingConfig =
    safeOptions.hidingConfig ??
    safeOptions.progressionConfig?.hidingSpots ??
    safeOptions.progressionConfig?.hidingSpotConfig ??
    safeOptions.progressionConfig?.hidingSpotProgression

  let enemyConfig =
    safeOptions.enemyConfig ??
    safeOptions.progressionConfig?.enemies ??
    safeOptions.progressionConfig?.enemyConfig ??
    safeOptions.progressionConfig?.enemyProgression

  let hazardPerTypeQuantities = {}
  let collectiblePerCategoryQuantities = {}
  let hidingPerTypeQuantities = {}
  let enemyPerArchetypeQuantities = {}
  let propPerTypeQuantities = {}
  const placementPreferences = {}
  const allowFallback = Boolean(sandboxConfig?.allowPreferenceFallback)

  if (sandboxConfig) {
    for (const catId of Object.values(SANDBOX_CATEGORY_IDS)) {
      const catItems = sandboxConfig.categories?.[catId]?.items || {}
      for (const [itemId, entry] of Object.entries(catItems)) {
        if (entry.quantity !== null && entry.quantity !== undefined) {
          const q = Math.max(0, Math.floor(Number(entry.quantity) || 0))
          if (catId === SANDBOX_CATEGORY_IDS.HAZARDS) hazardPerTypeQuantities[itemId] = q
          else if (catId === SANDBOX_CATEGORY_IDS.COLLECTIBLES) collectiblePerCategoryQuantities[itemId] = q
          else if (catId === SANDBOX_CATEGORY_IDS.HIDING_SPOTS) hidingPerTypeQuantities[itemId] = q
          else if (catId === SANDBOX_CATEGORY_IDS.ENEMIES) enemyPerArchetypeQuantities[itemId] = q
          else if (catId === SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS) propPerTypeQuantities[itemId] = q
        }
        if (entry.placementPreference && entry.placementPreference !== 'auto') {
          placementPreferences[itemId] = entry.placementPreference
        }
      }
    }

    const enabledHazards = STANDARD_HAZARD_TYPES.filter((type) =>
      isSandboxItemEnabled(sandboxConfig, SANDBOX_CATEGORY_IDS.HAZARDS, type)
    )
    hazardConfig = {
      ...(hazardConfig || {}),
      allowEmpty: true,
      availableTypes: enabledHazards,
      minDistinctTypes: enabledHazards.length > 0 ? enabledHazards.length : 1,
      minInstancesPerType: Object.keys(hazardPerTypeQuantities).length > 0 ? 0 : 2,
      maxTotalHazards: SANDBOX_GLOBAL_LIMITS.categoryCaps.hazards,
      maxWalkableOccupancyRatio: 0.85,
      perTypeQuantities: hazardPerTypeQuantities,
    }

    const enabledCollectibles = ALL_COLLECTIBLE_CATEGORIES.filter((type) =>
      isSandboxItemEnabled(sandboxConfig, SANDBOX_CATEGORY_IDS.COLLECTIBLES, type)
    )
    const enabledPerm = PERMANENT_COLLECTIBLE_CATEGORIES.filter((type) =>
      enabledCollectibles.includes(type) &&
      !(type === KEYCARD_COLLECTIBLE_TYPE && collectiblePerCategoryQuantities[type] === 0)
    )
    const enabledOpt = OPTIONAL_COLLECTIBLE_CATEGORIES.filter((type) =>
      enabledCollectibles.includes(type)
    )
    collectibleConfig = {
      ...(collectibleConfig || {}),
      allowEmpty: true,
      permanentCategories: enabledPerm,
      optionalCategories: enabledOpt,
      optionalSelectionCount: enabledOpt.length,
      forcedOptionalCategories: enabledOpt,
      maxTotalCollectibleItems: SANDBOX_GLOBAL_LIMITS.categoryCaps.collectibles,
      maxKeycards: 8,
      maxWalkableOccupancyRatio: 0.85,
      perCategoryQuantities: collectiblePerCategoryQuantities,
    }

    const enabledHiding = ALL_HIDING_SPOT_TYPES.filter((type) =>
      isSandboxItemEnabled(sandboxConfig, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, type)
    )
    hidingConfig = {
      ...(hidingConfig || {}),
      allowEmpty: true,
      availableTypes: enabledHiding,
      selectionCount: enabledHiding.length,
      minInstancesPerType: Object.keys(hidingPerTypeQuantities).length > 0 ? 0 : 2,
      maxTotalHidingSpots: SANDBOX_GLOBAL_LIMITS.categoryCaps.hidingSpots,
      maxWalkableOccupancyRatio: 0.85,
      forcedTypes: enabledHiding,
      perTypeQuantities: hidingPerTypeQuantities,
    }

    const enabledEnemies = [ENEMY_TYPES.STALKER, ENEMY_TYPES.HUNTER, ENEMY_TYPES.BRUTE].filter((type) =>
      isSandboxItemEnabled(sandboxConfig, SANDBOX_CATEGORY_IDS.ENEMIES, type)
    )
    enemyConfig = {
      ...(enemyConfig || {}),
      allowEmpty: true,
      availableArchetypes: enabledEnemies,
      maxTotalEnemies: SANDBOX_GLOBAL_LIMITS.categoryCaps.enemies,
      maxWalkableOccupancyRatio: 0.5,
      perArchetypeQuantities: enemyPerArchetypeQuantities,
      schedule: [
        {
          minLevel: 1,
          maxLevel: Infinity,
          archetypes: enabledEnemies,
          minCount: Math.max(0, enabledEnemies.length),
          maxCount: Math.max(0, enabledEnemies.length * 4),
        },
      ],
    }
  }

  const collectibleSelection = selectCollectibleCategoriesForLevel({
    level,
    baseSeed,
    seed,
    collectibleConfig,
  })
  const collectibleAllocation = allocateCollectibleQuantitiesForLevel({
    level,
    baseSeed,
    seed,
    rows,
    cols,
    walkableCount: validation.reachableCount,
    selection: collectibleSelection,
    collectibleConfig,
  })

  const baseMaze = {
    id: `maze-L${level}-${rows}x${cols}-${seed}`,
    seed,
    ...(baseSeed !== undefined ? { baseSeed } : {}),
    level,
    currentLevel: level,
    rows,
    cols,
    dimensions: { rows, cols },
    braidFactor,
    ...(hazardConfig ? { hazardProgressionConfig: hazardConfig } : {}),
    ...(collectibleConfig ? { collectibleProgressionConfig: collectibleConfig } : {}),
    ...(hidingConfig ? { hidingProgressionConfig: hidingConfig } : {}),
    collectibleSelection,
    collectibleAllocation,
    grid,
    start,
    exit,
    shortestPath: validation.shortestPath,
    parMoves: validation.distance,
    validation: {
      valid: validation.valid,
      reachableCount: validation.reachableCount,
      totalPathCells: validation.totalPathCells,
      issues: validation.issues,
    },
  }

  const hasExplicitHazardOverride = Boolean(
    safeOptions.hazardOptions?.placements ||
      safeOptions.hazardOptions?.specs ||
      safeOptions.hazardOptions?.hazardTypes ||
      safeOptions.hazardOptions?.types ||
      hazardConfig?.perTypeQuantities
  )
  // Constant cross-system reserve (start/exit buffer + mandatory hiding minimum floor +
  // baseline collectible/keycard/clearance reserve), deliberately independent of
  // hidingConfig and collectibleConfig to keep all PRNG and progression streams isolated.
  const defaultReservedCoexistenceCells =
    6 + HIDING_SPOT_SELECTION_COUNT * MIN_HIDING_SPOT_INSTANCES_PER_TYPE + 22

  const manualHazardPlacements = []
  if (sandboxConfig) {
    for (const catId of Object.values(SANDBOX_CATEGORY_IDS)) {
      const catItems = sandboxConfig.categories?.[catId]?.items || {}
      for (const [itemId, entry] of Object.entries(catItems)) {
        if (entry.enabled && Array.isArray(entry.manualPlacements)) {
          for (const p of entry.manualPlacements) {
            if (catId === SANDBOX_CATEGORY_IDS.HAZARDS) {
              manualHazardPlacements.push({ type: itemId, row: p.row, col: p.col })
            }
          }
        }
      }
    }
  }

  const hazardResult = placeHazardsWithReport(baseMaze, {
    ...(safeOptions.hazardOptions || {}),
    ...(hazardConfig ? { hazardConfig } : {}),
    ...(sandboxConfig ? { placementPreferences, allowFallback } : {}),
    ...(manualHazardPlacements.length > 0 ? { placements: manualHazardPlacements } : {}),
    ...(!hasExplicitHazardOverride &&
    !sandboxConfig &&
    safeOptions.hazardOptions?.reservedCoexistenceCells === undefined
      ? { reservedCoexistenceCells: defaultReservedCoexistenceCells }
      : {}),
  })
  const hazards = hazardResult.hazards

  const keycardResult = placeKeycardsWithReport(
    { ...baseMaze, hazards },
    {
      collectibleAllocation,
      ...(sandboxConfig ? { placementPreferences, allowFallback } : {}),
    }
  )
  const keycards = keycardResult.keycards

  const collectiblesResult = placeCollectiblesWithReport(baseMaze, {
    ...(safeOptions.collectibleOptions || {}),
    hazards,
    keycards,
    collectibleSelection,
    collectibleAllocation,
    ...(collectibleConfig ? { collectibleConfig } : {}),
    ...(sandboxConfig ? { placementPreferences, allowFallback } : {}),
  })
  const collectibles = {
    items: collectiblesResult.items,
    coins: collectiblesResult.coins,
    powerUps: collectiblesResult.powerUps,
  }

  const combinedRequestedByCategory = {
    [KEYCARD_TYPE]: keycardResult.report.requestedCount,
    ...collectiblesResult.report.requestedByCategory,
  }
  const combinedPlacedByCategory = {
    [KEYCARD_TYPE]: keycardResult.report.placedCount,
    ...collectiblesResult.report.placedByCategory,
  }
  const combinedMissingByCategory = {
    [KEYCARD_TYPE]: keycardResult.report.missingCount,
    ...collectiblesResult.report.missingByCategory,
  }
  const combinedFailures = [
    ...keycardResult.report.failures,
    ...collectiblesResult.report.failures,
  ]
  const combinedRequestedTotal =
    keycardResult.report.requestedCount + collectiblesResult.report.requestedTotal
  const combinedPlacedTotal =
    keycardResult.report.placedCount + collectiblesResult.report.placedTotal
  const combinedMissingTotal =
    keycardResult.report.missingCount + collectiblesResult.report.missingTotal

  const collectiblePlacementReport = {
    fullySatisfied:
      keycardResult.report.fullySatisfied &&
      collectiblesResult.report.fullySatisfied,
    selectedCategories: [...collectibleSelection.selectedCategories],
    permanentCategories: [...collectibleSelection.permanentCategories],
    selectedOptionalCategories: [
      ...collectibleSelection.selectedOptionalCategories,
    ],
    unselectedOptionalCategories: [
      ...collectibleSelection.unselectedOptionalCategories,
    ],
    requestedTotal: combinedRequestedTotal,
    placedTotal: combinedPlacedTotal,
    missingTotal: combinedMissingTotal,
    requestedByCategory: combinedRequestedByCategory,
    allocatedByCategory: combinedRequestedByCategory,
    placedByCategory: combinedPlacedByCategory,
    missingByCategory: combinedMissingByCategory,
    keycardTarget: keycardResult.report.keycardTarget ?? keycardResult.report.requestedCount,
    keycardFailureReason: keycardResult.report.keycardFailureReason ?? null,
    preferencesByCategory: {
      ...(keycardResult.report.preferencesByCategory || {}),
      ...(collectiblesResult.report.preferencesByCategory || {}),
    },
    missingSelectedCategories: Object.keys(combinedMissingByCategory).filter(
      (cat) => combinedMissingByCategory[cat] > 0
    ),
    unselectedSpawnCount: collectiblesResult.report.unselectedSpawnCount,
    keycardReport: keycardResult.report,
    itemReport: collectiblesResult.report,
    failures: combinedFailures,
  }





  const enemySelection = selectEnemiesForLevel({
    level,
    baseSeed,
    seed,
    enemyConfig,
  })
  const enemyAllocation = allocateEnemyQuantitiesForLevel({
    level,
    baseSeed,
    seed,
    rows,
    cols,
    selection: enemySelection,
    enemyConfig,
  })

  const hidingSpotSelection = selectHidingSpotTypesForLevel({
    level,
    baseSeed,
    seed,
    hidingConfig,
  })
  const hidingSpotAllocation = allocateHidingSpotQuantitiesForLevel({
    level,
    baseSeed,
    seed,
    rows,
    cols,
    selection: hidingSpotSelection,
    hidingConfig,
  })

  const hidingSpotResult = placeHidingSpotsWithReport(baseMaze, {
    ...(safeOptions.hidingOptions || {}),
    hazards,
    keycards,
    collectibles,
    hidingSpotSelection,
    hidingSpotAllocation,
    ...(hidingConfig ? { hidingConfig } : {}),
    ...(sandboxConfig ? { placementPreferences, allowFallback } : {}),
  })
  const hidingSpots = hidingSpotResult.hidingSpots
  const hidingSpotPlacementReport = hidingSpotResult.report
  const hidingSpotMetadata = {
    selectedTypes: [...hidingSpotSelection.selectedTypes],
    unselectedTypes: [...hidingSpotSelection.unselectedTypes],
    allocatedQuantities: { ...hidingSpotAllocation.typeQuantities },
    placedQuantities: { ...hidingSpotPlacementReport.placedByType },
    shortfallsByType: { ...hidingSpotPlacementReport.missingByType },
    requestedTotal: hidingSpotPlacementReport.requestedTotal,
    placedTotal: hidingSpotPlacementReport.placedTotal,
    shortfallTotal: hidingSpotPlacementReport.missingTotal,
    hadShortfall: hidingSpotPlacementReport.missingTotal > 0,
    fullySatisfied: hidingSpotPlacementReport.fullySatisfied,
  }

  const enemyResult = placeEnemiesWithReport(baseMaze, {
    ...(safeOptions.enemyOptions || {}),
    hazards,
    keycards,
    collectibles,
    hidingSpots,
    enemySelection,
    enemyAllocation,
    ...(enemyConfig ? { enemyConfig } : {}),
    ...(sandboxConfig ? { placementPreferences, allowFallback } : {}),
  })
  const enemies = enemyResult.enemies
  const enemyPlacementReport = enemyResult.report

  let environmentalProps = null
  let environmentalPropsReport = null
  let hazardDecoys = null
  let hazardDecoysReport = null

  if (sandboxConfig) {
    const enabledPropTypes = Object.values(PROP_TYPES).filter((type) =>
      isSandboxItemEnabled(sandboxConfig, SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS, type)
    )
    const propResult = placeEnvironmentalPropsWithReport(baseMaze, {
      hazards,
      keycards,
      collectibles,
      hidingSpots,
      excludedCells: enemies.map((e) => e.spawnCell).filter(Boolean),
      enabledTypes: enabledPropTypes,
      perTypeQuantities: propPerTypeQuantities,
      placementPreferences,
      allowFallback,
      globalMax: SANDBOX_GLOBAL_LIMITS.categoryCaps.environmentalObjects,
    })
    environmentalProps = propResult.props
    environmentalPropsReport = propResult.report

    const decoysEnabled = isSandboxItemEnabled(
      sandboxConfig,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS
    )
    const decoyEntry =
      sandboxConfig.categories?.[SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS]?.items?.[
        ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS
      ]
    const decoyResult = placeSandboxHazardDecoysWithReport(baseMaze, {
      enabled: decoysEnabled,
      quantity: decoyEntry?.quantity ?? null,
      placementPreference: decoyEntry?.placementPreference || 'auto',
      allowFallback,
      hazards,
      keycards,
      collectibles,
      hidingSpots,
      placedProps: environmentalProps,
      excludedCells: enemies.map((e) => e.spawnCell).filter(Boolean),
    })
    hazardDecoys = { decoys: decoyResult.decoys, byLayer: decoyResult.byLayer }
    hazardDecoysReport = decoyResult.report
  }

  const requiredKeys = keycards.length
  const keycardMetadata = {
    category: KEYCARD_TYPE,
    allocatedCount: keycardResult.report.allocatedCount,
    placedCount: keycards.length,
    requiredCount: requiredKeys,
    shortfallCount: keycardResult.report.shortfallCount,
    hadShortfall: keycardResult.report.hadShortfall,
    isExitLockedByDefault: requiredKeys > 0,
  }

  const hazardHidingCapacityPlan = coordinateHazardAndHidingCapacity({
    rows,
    cols,
    walkableCount: validation.reachableCount,
    reservedOtherCount: keycards.length + collectibles.items.length,
    startExitBuffer: 6,
    hazardSelection: hazardResult.selection,
    hidingSpotAllocation,
  })

  const placementCoexistenceReport = auditHazardHidingCoexistence(
    {
      ...baseMaze,
      hazards,
      hidingSpots,
      keycards,
      collectibles,
      enemies,
      hazardSelection: hazardResult.selection,
      hazardPlacementReport: hazardResult.report,
      hidingSpotSelection,
      hidingSpotAllocation,
      hidingSpotPlacementReport,
    },
    {
      capacityPlan: hazardHidingCapacityPlan,
      hazardReport: hazardResult.report,
      hidingReport: hidingSpotPlacementReport,
    }
  )

  const sandboxValidationReport = sandboxConfig
    ? buildSandboxGenerationValidationReport({
        sandboxConfig,
        hazardsReport: hazardResult.report,
        collectiblesReport: collectiblePlacementReport,
        hidingSpotsReport: hidingSpotPlacementReport,
        enemiesReport: enemyPlacementReport,
        propsReport: environmentalPropsReport,
        decoysReport: hazardDecoysReport,
        hazards,
        collectibles: { ...collectibles, keycards },
        hidingSpots,
        enemies,
        props: environmentalProps || [],
        hazardDecoys,
      })
    : null

  return {
    ...baseMaze,
    hazardBudget: levelConfig.hazardBudget,
    hazardSelection: hazardResult.selection,
    hazardPlacementReport: hazardResult.report,
    collectiblePlacementReport,
    enemySelection,
    enemyAllocation,
    enemyPlacementReport,
    hidingSpotSelection,
    hidingSpotAllocation,
    hidingSpotPlacementReport,
    hidingSpotMetadata,
    hazardHidingCapacityPlan,
    placementCoexistenceReport,
    requiredKeys,
    keycardMetadata,
    hazards,
    keycards,
    collectibles,
    hidingSpots,
    enemies,
    ...(environmentalProps !== null ? { environmentalProps, environmentalPropsReport } : {}),
    ...(hazardDecoys !== null ? { hazardDecoys, hazardDecoysReport } : {}),
    ...(sandboxPayload
      ? {
          gameMode: sandboxPayload.mode,
          isSandbox: true,
          sandboxConfig: sandboxPayload.config,
          sandboxSummary: sandboxPayload.summary,
          sandboxValidationReport,
        }
      : {}),
  }
}
