import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { attemptMove, canMoveTo, isAtExit } from '../mechanics/movement.js'
import {
  COLLECTIBLE_CONFIG,
  COLLECTIBLE_TYPES,
  createInitialActiveEffects,
  createInitialInventory,
} from '../mechanics/collectiblesConfig.js'

import { getShardBonusValue } from '../mechanics/scoring.js'
import {
  DEFAULT_INITIAL_LEVEL,
  INITIAL_BASE_SEED,
  getLevelConfig,
  getLevelSeed,
  getNextLevel,
  normalizeBaseSeed,
  normalizeLevel,
} from '../mechanics/levelProgression.js'

export const INITIAL_SEED = INITIAL_BASE_SEED
const MAX_VISUAL_EFFECTS = 8

export const LEVEL_TRANSITION_ACTIONS = Object.freeze({
  ADVANCE_LEVEL: 'ADVANCE_LEVEL',
  REPLAY_LEVEL: 'REPLAY_LEVEL',
  NEW_GAME: 'NEW_GAME',
  NEW_MAZE: 'NEW_MAZE',
  SET_LEVEL: 'SET_LEVEL',
  RESET_RUN: 'RESET_RUN',
})

export function getNextSeed(currentSeed) {
  return (((currentSeed * 1664525 + 1013904223) >>> 0) % 900000) + 100000
}

function deriveDeterministicNextBaseSeed(previousSeed) {
  const prev = normalizeBaseSeed(previousSeed)
  const candidate = getNextSeed(prev)
  return candidate === prev
    ? ((candidate - 100000 + 1) % 900000) + 100000
    : candidate
}

/**
 * Generates a genuinely fresh positive integer base seed outside the reducer.
 * @param {number|string|null} [previousBaseSeed]
 * @returns {number}
 */
export function generateFreshBaseSeed(previousBaseSeed = null) {
  const hasPrev =
    previousBaseSeed !== null &&
    previousBaseSeed !== undefined &&
    previousBaseSeed !== ''
  const prevNorm = hasPrev ? normalizeBaseSeed(previousBaseSeed) : null

  let candidate = Math.floor(Math.random() * 900000) + 100000
  if (prevNorm !== null && candidate === prevNorm) {
    candidate = ((candidate - 100000 + 1 + Math.floor(Math.random() * 899998)) % 900000) + 100000
  }
  return candidate
}

function synchronizeMazeMetadata(maze, levelConfig, seed, baseSeed) {
  if (!maze || typeof maze !== 'object') return maze
  if (
    maze.level === levelConfig.level &&
    maze.currentLevel === levelConfig.level &&
    maze.seed === seed &&
    maze.baseSeed === baseSeed
  ) {
    return maze
  }
  return {
    ...maze,
    level: levelConfig.level,
    currentLevel: levelConfig.level,
    baseSeed,
    seed,
    dimensions:
      maze.dimensions || { rows: maze.rows, cols: maze.cols },
  }
}

function isMatchingPrebuiltMaze(maze, levelConfig, seed) {
  if (
    !maze ||
    !Array.isArray(maze.grid) ||
    !maze.start ||
    !maze.exit
  ) {
    return false
  }
  const mazeLevel = normalizeLevel(maze.level ?? maze.currentLevel)
  if (mazeLevel !== levelConfig.level) return false
  if (maze.seed !== seed) return false
  if (maze.rows !== levelConfig.rows || maze.cols !== levelConfig.cols) return false
  if (
    typeof maze.braidFactor === 'number' &&
    Math.abs(maze.braidFactor - levelConfig.braidFactor) > 1e-6
  ) {
    return false
  }
  return true
}

function resolveSynchronizedMaze(
  actionMaze,
  levelConfig,
  seed,
  baseSeed,
  objectivesEnabled,
  progressionConfig
) {
  if (isMatchingPrebuiltMaze(actionMaze, levelConfig, seed)) {
    return synchronizeMazeMetadata(actionMaze, levelConfig, seed, baseSeed)
  }
  const generated = generateMaze({
    seed,
    baseSeed,
    level: levelConfig.level,
    objectivesEnabled,
    progressionConfig,
  })
  return synchronizeMazeMetadata(generated, levelConfig, seed, baseSeed)
}

/**
 * Builds an ADVANCE_LEVEL action with maze generation performed outside the reducer.
 */
export function createAdvanceLevelAction(state, options = {}) {
  const currentLevel = normalizeLevel(state?.currentLevel)
  const nextLevel = getNextLevel(currentLevel)
  const baseSeed = normalizeBaseSeed(
    options?.baseSeed ?? state?.baseSeed ?? state?.seed
  )
  const levelConfig = getLevelConfig(
    nextLevel,
    baseSeed,
    options?.progressionConfig
  )
  const objectivesEnabled =
    options?.objectivesEnabled !== undefined
      ? options.objectivesEnabled !== false
      : state?.objectivesEnabled !== false

  const maze = generateMaze({
    seed: levelConfig.seed,
    baseSeed: levelConfig.baseSeed,
    level: nextLevel,
    objectivesEnabled,
    progressionConfig: options?.progressionConfig,
  })

  return {
    type: LEVEL_TRANSITION_ACTIONS.ADVANCE_LEVEL,
    level: nextLevel,
    baseSeed: levelConfig.baseSeed,
    seed: levelConfig.seed,
    levelConfig,
    maze,
    objectivesEnabled,
    ...(options?.progressionConfig
      ? { progressionConfig: options.progressionConfig }
      : {}),
    ...(Number.isFinite(options?.maxHealth ?? state?.maxHealth)
      ? { maxHealth: options?.maxHealth ?? state?.maxHealth }
      : {}),
    ...(Number.isFinite(options?.maxBattery ?? state?.maxBattery)
      ? { maxBattery: options?.maxBattery ?? state?.maxBattery }
      : {}),
  }
}

/**
 * Builds a REPLAY_LEVEL action reusing the current level, maze, and seed.
 */
export function createReplayLevelAction(_state, options = {}) {
  return {
    type: LEVEL_TRANSITION_ACTIONS.REPLAY_LEVEL,
    ...(options?.objectivesEnabled !== undefined
      ? { objectivesEnabled: options.objectivesEnabled !== false }
      : {}),
    ...(Number.isFinite(options?.maxHealth) ? { maxHealth: options.maxHealth } : {}),
    ...(Number.isFinite(options?.maxBattery) ? { maxBattery: options.maxBattery } : {}),
  }
}

/**
 * Builds a NEW_GAME action at Level 1 with a newly established base seed and maze
 * generated outside the reducer.
 */
export function createNewGameAction(options = {}) {
  const isStateArg = Boolean(
    options &&
      typeof options === 'object' &&
      'maze' in options &&
      'runId' in options
  )
  const opts = isStateArg ? {} : options && typeof options === 'object' ? options : {}
  const previousBaseSeed = isStateArg
    ? (options.baseSeed ?? options.seed)
    : opts.previousBaseSeed

  const hasExplicitBaseSeed =
    opts.baseSeed !== undefined &&
    opts.baseSeed !== null &&
    opts.baseSeed !== ''
  const baseSeed = hasExplicitBaseSeed
    ? normalizeBaseSeed(opts.baseSeed)
    : generateFreshBaseSeed(previousBaseSeed)

  const level = DEFAULT_INITIAL_LEVEL
  const levelConfig = getLevelConfig(level, baseSeed, opts.progressionConfig)
  const objectivesEnabled = isStateArg
    ? options.objectivesEnabled !== false
    : opts.objectivesEnabled !== undefined
      ? opts.objectivesEnabled !== false
      : true

  const maze = generateMaze({
    seed: levelConfig.seed,
    baseSeed: levelConfig.baseSeed,
    level,
    objectivesEnabled,
    progressionConfig: opts.progressionConfig,
  })

  return {
    type: LEVEL_TRANSITION_ACTIONS.NEW_GAME,
    level,
    baseSeed: levelConfig.baseSeed,
    seed: levelConfig.seed,
    levelConfig,
    maze,
    objectivesEnabled,
    ...( !isStateArg && opts.progressionConfig
      ? { progressionConfig: opts.progressionConfig }
      : {}),
    maxHealth: Number.isFinite(opts.maxHealth) ? opts.maxHealth : 100,
    maxBattery: Number.isFinite(opts.maxBattery) ? opts.maxBattery : 100,
  }
}

/**
 * Builds a SET_LEVEL action with maze generation performed outside the reducer.
 */
export function createSetLevelAction(state, level, options = {}) {
  const targetLevel = normalizeLevel(level ?? state?.currentLevel)
  const baseSeed = normalizeBaseSeed(
    options?.baseSeed ?? state?.baseSeed ?? state?.seed
  )
  const levelConfig = getLevelConfig(
    targetLevel,
    baseSeed,
    options?.progressionConfig
  )
  const objectivesEnabled =
    options?.objectivesEnabled !== undefined
      ? options.objectivesEnabled !== false
      : state?.objectivesEnabled !== false

  const maze = generateMaze({
    seed: levelConfig.seed,
    baseSeed: levelConfig.baseSeed,
    level: targetLevel,
    objectivesEnabled,
    progressionConfig: options?.progressionConfig,
  })

  return {
    type: LEVEL_TRANSITION_ACTIONS.SET_LEVEL,
    level: targetLevel,
    baseSeed: levelConfig.baseSeed,
    seed: levelConfig.seed,
    levelConfig,
    maze,
    objectivesEnabled,
    ...(options?.progressionConfig
      ? { progressionConfig: options.progressionConfig }
      : {}),
    ...(Number.isFinite(options?.maxHealth ?? state?.maxHealth)
      ? { maxHealth: options?.maxHealth ?? state?.maxHealth }
      : {}),
    ...(Number.isFinite(options?.maxBattery ?? state?.maxBattery)
      ? { maxBattery: options?.maxBattery ?? state?.maxBattery }
      : {}),
  }
}

function countSoulShards(items) {
  if (!Array.isArray(items)) return 0
  let count = 0
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]?.type === COLLECTIBLE_TYPES.SOUL_SHARDS) {
      count += 1
    }
  }
  return count
}

function sanitizeMazeKeycards(rawKeycards) {
  if (!Array.isArray(rawKeycards) || rawKeycards.length === 0) return []
  const seenIds = new Set()
  const seenCells = new Set()
  const result = []

  for (let i = 0; i < rawKeycards.length; i += 1) {
    const kc = rawKeycards[i]
    if (!kc || !Number.isInteger(kc.row) || !Number.isInteger(kc.col)) continue
    const cellKey = `${kc.row},${kc.col}`
    const id = kc.id || `keycard-${kc.row}-${kc.col}`
    if (seenIds.has(id) || seenCells.has(cellKey)) continue
    seenIds.add(id)
    seenCells.add(cellKey)
    result.push(kc.id ? kc : { ...kc, id })
  }

  return result
}

function buildStateFromMaze(maze, seed, eventCounter = 0, config = {}) {
  const currentLevel = normalizeLevel(
    config?.currentLevel ?? config?.level ?? maze?.level ?? DEFAULT_INITIAL_LEVEL
  )
  const baseSeed = config?.baseSeed !== undefined ? config.baseSeed : (maze?.baseSeed ?? seed)
  const initialItems = maze.collectibles?.items || []
  const totalShards = countSoulShards(initialItems)
  const objectivesEnabled = config?.objectivesEnabled !== false
  const initialKeycards = objectivesEnabled
    ? sanitizeMazeKeycards(maze?.keycards)
    : []
  const maxHealth = Math.max(1, Number(config?.maxHealth) || 100)
  const health = Math.max(
    0,
    Math.min(
      maxHealth,
      Number.isFinite(config?.health) ? config.health : maxHealth
    )
  )
  const maxBattery = Math.max(1, Number(config?.maxBattery) || 100)
  const battery = Math.max(
    0,
    Math.min(
      maxBattery,
      Number.isFinite(config?.battery) ? config.battery : maxBattery
    )
  )

  return {
    currentLevel,
    baseSeed,
    seed,
    maze,
    playerPos: maze.start,
    hasWon: false,
    isGameOver: false,
    health,
    maxHealth,
    battery,
    maxBattery,
    lastDirection: 'down',
    blockedBump: null,
    items: [...initialItems],
    totalItems: initialItems.length,
    itemsCollected: 0,
    shardsCollected: 0,
    totalShards,
    shardBonus: 0,
    objectivesEnabled,
    keycards: [...initialKeycards],
    totalKeys: initialKeycards.length,
    keysCollected: 0,
    isExitLocked: objectivesEnabled && initialKeycards.length > 0,
    inventory: createInitialInventory(),
    activeEffects: createInitialActiveEffects(),
    echoPath: [],
    effects: [],
    runId: Number.isInteger(config?.runId) ? config.runId : 1,
    eventCounter,
    recentActivationEventIds: [],
    lastEvent: null,
  }
}

export function createInitialGameState(
  param1 = INITIAL_SEED,
  param2 = {},
  param3 = {}
) {
  let legacyDifficulty = null
  let seed = INITIAL_SEED
  let config = {}

  if (typeof param1 === 'string') {
    legacyDifficulty = param1
    seed = param2 !== undefined ? param2 : INITIAL_SEED
    config = typeof param3 === 'object' && param3 !== null ? param3 : {}
  } else if (typeof param1 === 'number') {
    seed = param1
    config = typeof param2 === 'object' && param2 !== null ? param2 : {}
  } else if (typeof param1 === 'object' && param1 !== null) {
    config = param1
    seed = config.seed !== undefined ? config.seed : INITIAL_SEED
  }

  const hasProvidedMaze =
    config.maze &&
    Array.isArray(config.maze.grid) &&
    config.maze.start &&
    config.maze.exit

  const currentLevel = normalizeLevel(
    config.currentLevel ??
      config.level ??
      (hasProvidedMaze
        ? config.maze.currentLevel ?? config.maze.level
        : undefined) ??
      DEFAULT_INITIAL_LEVEL
  )
  const baseSeed =
    config.baseSeed !== undefined
      ? normalizeBaseSeed(config.baseSeed)
      : hasProvidedMaze && config.maze.baseSeed !== undefined
        ? normalizeBaseSeed(config.maze.baseSeed)
        : typeof seed === 'number' && Number.isFinite(seed)
          ? seed
          : normalizeBaseSeed(seed)

  let resolvedSeed = seed
  if (config.seed !== undefined) {
    resolvedSeed = config.seed
  } else if (hasProvidedMaze && config.maze.seed !== undefined) {
    resolvedSeed = config.maze.seed
  } else if (
    (config.baseSeed !== undefined || currentLevel > 1) &&
    config.useLevelSeed !== false
  ) {
    resolvedSeed = getLevelSeed(currentLevel, baseSeed)
  }

  const maze = hasProvidedMaze
    ? config.maze
    : generateMaze({
        ...config,
        seed: resolvedSeed,
        baseSeed,
        level: currentLevel,
        ...(legacyDifficulty ? { difficulty: legacyDifficulty } : {}),
      })

  return buildStateFromMaze(maze, resolvedSeed, 0, {
    ...config,
    currentLevel,
    baseSeed,
  })
}

function applyReplayLevelTransition(state, action = {}) {
  if (!state?.maze) {
    return state
  }
  return buildStateFromMaze(
    state.maze,
    state.seed,
    (state.eventCounter || 0) + 1,
    {
      currentLevel: normalizeLevel(state.currentLevel),
      baseSeed: state.baseSeed !== undefined ? state.baseSeed : state.seed,
      objectivesEnabled:
        action?.objectivesEnabled !== undefined
          ? action.objectivesEnabled !== false
          : state.objectivesEnabled !== false,
      maxHealth: action?.maxHealth ?? state.maxHealth,
      maxBattery: action?.maxBattery ?? state.maxBattery,
      runId: (state.runId || 1) + 1,
    }
  )
}

function applyAdvanceLevelTransition(state, action = {}) {
  const nextLevel = getNextLevel(state?.currentLevel)
  const baseSeed = normalizeBaseSeed(
    action?.baseSeed ?? state?.baseSeed ?? state?.seed
  )
  const levelConfig = getLevelConfig(
    nextLevel,
    baseSeed,
    action?.progressionConfig
  )
  const allowCustomSeed = action?.type === LEVEL_TRANSITION_ACTIONS.NEW_MAZE
  const nextSeed =
    allowCustomSeed && action?.seed !== undefined
      ? action.seed
      : levelConfig.seed
  const objectivesEnabled =
    action?.objectivesEnabled !== undefined
      ? action.objectivesEnabled !== false
      : state?.objectivesEnabled !== false

  const maze = resolveSynchronizedMaze(
    action?.maze,
    levelConfig,
    nextSeed,
    baseSeed,
    objectivesEnabled,
    action?.progressionConfig
  )

  return buildStateFromMaze(maze, nextSeed, (state?.eventCounter || 0) + 1, {
    currentLevel: nextLevel,
    baseSeed,
    objectivesEnabled,
    maxHealth: action?.maxHealth ?? state?.maxHealth,
    maxBattery: action?.maxBattery ?? state?.maxBattery,
    runId: (state?.runId || 0) + 1,
  })
}

function applySetLevelTransition(state, action = {}) {
  const targetLevel = normalizeLevel(action?.level ?? state?.currentLevel)
  const baseSeed = normalizeBaseSeed(
    action?.baseSeed ?? state?.baseSeed ?? state?.seed
  )
  const levelConfig = getLevelConfig(
    targetLevel,
    baseSeed,
    action?.progressionConfig
  )
  const levelSeed =
    action?.seed !== undefined ? action.seed : levelConfig.seed
  const objectivesEnabled =
    action?.objectivesEnabled !== undefined
      ? action.objectivesEnabled !== false
      : state?.objectivesEnabled !== false

  const maze = resolveSynchronizedMaze(
    action?.maze,
    levelConfig,
    levelSeed,
    baseSeed,
    objectivesEnabled,
    action?.progressionConfig
  )

  return buildStateFromMaze(maze, levelSeed, (state?.eventCounter || 0) + 1, {
    currentLevel: targetLevel,
    baseSeed,
    objectivesEnabled,
    maxHealth: action?.maxHealth ?? state?.maxHealth,
    maxBattery: action?.maxBattery ?? state?.maxBattery,
    runId: (state?.runId || 0) + 1,
  })
}

function applyNewGameTransition(state, action = {}) {
  const targetLevel = DEFAULT_INITIAL_LEVEL
  const hasExplicitBaseSeed =
    action?.baseSeed !== undefined &&
    action?.baseSeed !== null &&
    action?.baseSeed !== ''
  const hasMazeBaseSeed =
    action?.maze?.baseSeed !== undefined &&
    action?.maze?.baseSeed !== null &&
    action?.maze?.baseSeed !== ''
  const hasMazeSeed =
    action?.maze?.seed !== undefined &&
    action?.maze?.seed !== null &&
    action?.maze?.seed !== ''

  const baseSeed = hasExplicitBaseSeed
    ? normalizeBaseSeed(action.baseSeed)
    : hasMazeBaseSeed
      ? normalizeBaseSeed(action.maze.baseSeed)
      : hasMazeSeed
        ? normalizeBaseSeed(action.maze.seed)
        : deriveDeterministicNextBaseSeed(state?.baseSeed ?? state?.seed)

  const levelConfig = getLevelConfig(
    targetLevel,
    baseSeed,
    action?.progressionConfig
  )
  const levelSeed = levelConfig.seed
  const objectivesEnabled =
    action?.objectivesEnabled !== undefined
      ? action.objectivesEnabled !== false
      : state
        ? state.objectivesEnabled !== false
        : true

  const maze = resolveSynchronizedMaze(
    action?.maze,
    levelConfig,
    levelSeed,
    baseSeed,
    objectivesEnabled,
    action?.progressionConfig
  )

  return buildStateFromMaze(maze, levelSeed, (state?.eventCounter || 0) + 1, {
    currentLevel: targetLevel,
    baseSeed,
    objectivesEnabled,
    maxHealth: action?.maxHealth ?? 100,
    maxBattery: action?.maxBattery ?? 100,
    runId: (state?.runId || 0) + 1,
  })
}

function appendEffects(existing, additions) {
  if (!additions || additions.length === 0) return existing
  const combined = [...existing, ...additions]
  return combined.slice(-MAX_VISUAL_EFFECTS)
}

function isSamePosition(a, b) {
  return Boolean(a && b && a.row === b.row && a.col === b.col)
}

function normalizePositionInput(action) {
  if (
    action?.position &&
    Number.isInteger(action.position.row) &&
    Number.isInteger(action.position.col)
  ) {
    return { row: action.position.row, col: action.position.col }
  }

  if (Number.isInteger(action?.row) && Number.isInteger(action?.col)) {
    return { row: action.row, col: action.col }
  }

  return null
}

/**
 * Collects (or rejects on full vitals/battery) a collectible item at `position`.
 * Health Capsules and Energy Cells activate immediately without entering inventory;
 * Soul Shards immediately update bonus survival score; Echo Reveal increments ability inventory.
 */
export function collectItemAtPosition(
  items,
  inventory,
  position,
  eventCounter = 0,
  context = {}
) {
  const maxHealth = Math.max(1, Number(context?.maxHealth) || 100)
  const currentHealth = Math.max(
    0,
    Math.min(
      maxHealth,
      Number.isFinite(context?.health) ? context.health : maxHealth
    )
  )
  const maxBattery = Math.max(1, Number(context?.maxBattery) || 100)
  const currentBattery = Math.max(
    0,
    Math.min(
      maxBattery,
      Number.isFinite(context?.battery) ? context.battery : maxBattery
    )
  )

  if (!Array.isArray(items) || items.length === 0 || !position) {
    return {
      items: Array.isArray(items) ? items : [],
      inventory,
      collectedItem: null,
      rejectedItem: null,
      rejectionReason: null,
      health: currentHealth,
      healthRestored: 0,
      battery: currentBattery,
      batteryRestored: 0,
      shardsDelta: 0,
      scoreDelta: 0,
      visualEffects: [],
      eventCounter,
    }
  }

  const steppedItem = items.find(
    (item) => item.row === position.row && item.col === position.col
  )

  if (!steppedItem) {
    return {
      items,
      inventory,
      collectedItem: null,
      rejectedItem: null,
      rejectionReason: null,
      health: currentHealth,
      healthRestored: 0,
      battery: currentBattery,
      batteryRestored: 0,
      shardsDelta: 0,
      scoreDelta: 0,
      visualEffects: [],
      eventCounter,
    }
  }

  const nextCounter = eventCounter + 1

  if (steppedItem.type === COLLECTIBLE_TYPES.HEALTH_CAPSULE) {
    if (currentHealth >= maxHealth) {
      return {
        items,
        inventory,
        collectedItem: null,
        rejectedItem: steppedItem,
        rejectionReason: 'health_full',
        health: currentHealth,
        healthRestored: 0,
        battery: currentBattery,
        batteryRestored: 0,
        shardsDelta: 0,
        scoreDelta: 0,
        visualEffects: [],
        eventCounter: nextCounter,
      }
    }

    const restorePercent =
      COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.HEALTH_CAPSULE]?.restorePercent || 25
    const restoreAmount = Math.round(maxHealth * (restorePercent / 100))
    const nextHealth = Math.min(maxHealth, currentHealth + restoreAmount)
    const healthRestored = nextHealth - currentHealth

    return {
      items: items.filter((item) => item.id !== steppedItem.id),
      inventory,
      collectedItem: steppedItem,
      rejectedItem: null,
      rejectionReason: null,
      health: nextHealth,
      healthRestored,
      battery: currentBattery,
      batteryRestored: 0,
      shardsDelta: 0,
      scoreDelta: 0,
      visualEffects: [
        {
          id: `fx-item-${nextCounter}`,
          kind: steppedItem.type,
          row: steppedItem.row,
          col: steppedItem.col,
        },
      ],
      eventCounter: nextCounter,
    }
  }

  if (steppedItem.type === COLLECTIBLE_TYPES.ENERGY_CELL) {
    if (currentBattery >= maxBattery) {
      return {
        items,
        inventory,
        collectedItem: null,
        rejectedItem: steppedItem,
        rejectionReason: 'battery_full',
        health: currentHealth,
        healthRestored: 0,
        battery: currentBattery,
        batteryRestored: 0,
        shardsDelta: 0,
        scoreDelta: 0,
        visualEffects: [],
        eventCounter: nextCounter,
      }
    }

    const restorePercent =
      COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ENERGY_CELL]?.restorePercent || 30
    const restoreAmount = Math.round(maxBattery * (restorePercent / 100))
    const nextBattery = Math.min(maxBattery, currentBattery + restoreAmount)
    const batteryRestored = nextBattery - currentBattery

    return {
      items: items.filter((item) => item.id !== steppedItem.id),
      inventory,
      collectedItem: steppedItem,
      rejectedItem: null,
      rejectionReason: null,
      health: currentHealth,
      healthRestored: 0,
      battery: nextBattery,
      batteryRestored,
      shardsDelta: 0,
      scoreDelta: 0,
      visualEffects: [
        {
          id: `fx-item-${nextCounter}`,
          kind: steppedItem.type,
          row: steppedItem.row,
          col: steppedItem.col,
        },
      ],
      eventCounter: nextCounter,
    }
  }

  if (steppedItem.type === COLLECTIBLE_TYPES.SOUL_SHARDS) {
    const scoreDelta = getShardBonusValue()
    return {
      items: items.filter((item) => item.id !== steppedItem.id),
      inventory,
      collectedItem: steppedItem,
      rejectedItem: null,
      rejectionReason: null,
      health: currentHealth,
      healthRestored: 0,
      battery: currentBattery,
      batteryRestored: 0,
      shardsDelta: 1,
      scoreDelta,
      visualEffects: [
        {
          id: `fx-item-${nextCounter}`,
          kind: steppedItem.type,
          row: steppedItem.row,
          col: steppedItem.col,
        },
      ],
      eventCounter: nextCounter,
    }
  }

  if (steppedItem.type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS) {
    return {
      items: items.filter((item) => item.id !== steppedItem.id),
      inventory,
      collectedItem: steppedItem,
      rejectedItem: null,
      rejectionReason: null,
      health: currentHealth,
      healthRestored: 0,
      battery: currentBattery,
      batteryRestored: 0,
      shardsDelta: 0,
      scoreDelta: 0,
      visualEffects: [
        {
          id: `fx-item-${nextCounter}`,
          kind: steppedItem.type,
          row: steppedItem.row,
          col: steppedItem.col,
        },
      ],
      eventCounter: nextCounter,
    }
  }

  if (
    steppedItem.type === COLLECTIBLE_TYPES.WARDING_CHARM ||
    steppedItem.type === COLLECTIBLE_TYPES.SPIRIT_LANTERN
  ) {
    return {
      items: items.filter((item) => item.id !== steppedItem.id),
      inventory,
      collectedItem: steppedItem,
      rejectedItem: null,
      rejectionReason: null,
      health: currentHealth,
      healthRestored: 0,
      battery: currentBattery,
      batteryRestored: 0,
      shardsDelta: 0,
      scoreDelta: 0,
      visualEffects: [
        {
          id: `fx-item-${nextCounter}`,
          kind: steppedItem.type,
          row: steppedItem.row,
          col: steppedItem.col,
        },
      ],
      eventCounter: nextCounter,
    }
  }

  const nextInventory = {
    ...inventory,
    [steppedItem.type]: (inventory?.[steppedItem.type] || 0) + 1,
  }

  return {
    items: items.filter((item) => item.id !== steppedItem.id),
    inventory: nextInventory,
    collectedItem: steppedItem,
    rejectedItem: null,
    rejectionReason: null,
    health: currentHealth,
    healthRestored: 0,
    battery: currentBattery,
    batteryRestored: 0,
    shardsDelta: 0,
    scoreDelta: 0,
    visualEffects: [
      {
        id: `fx-item-${nextCounter}`,
        kind: steppedItem.type,
        row: steppedItem.row,
        col: steppedItem.col,
      },
    ],
    eventCounter: nextCounter,
  }
}

function tryReuseEchoPath(grid, exit, position, cachedEchoPath) {
  if (!Array.isArray(cachedEchoPath) || cachedEchoPath.length === 0) {
    return null
  }

  const lastCell = cachedEchoPath[cachedEchoPath.length - 1]
  if (!isSamePosition(lastCell, exit)) {
    return null
  }

  let matchIndex = -1
  for (let i = 0; i < cachedEchoPath.length; i += 1) {
    if (isSamePosition(cachedEchoPath[i], position)) {
      matchIndex = i
      break
    }
  }

  if (matchIndex === -1) {
    return null
  }

  let prev = null
  for (let i = matchIndex; i < cachedEchoPath.length; i += 1) {
    const cell = cachedEchoPath[i]
    if (!cell || !canMoveTo(grid, cell.row, cell.col).allowed) {
      return null
    }
    if (prev) {
      const manhattan =
        Math.abs(cell.row - prev.row) + Math.abs(cell.col - prev.col)
      if (manhattan !== 1) {
        return null
      }
    }
    prev = cell
  }

  return matchIndex === 0 ? cachedEchoPath : cachedEchoPath.slice(matchIndex)
}

export function resolveEchoRevealPath(
  maze,
  position,
  activeEffects,
  reachedExit = false,
  cachedEchoPath = null,
  options = undefined
) {
  if (
    reachedExit ||
    !activeEffects ||
    activeEffects.echoRevealRemainingMs <= 0 ||
    !maze?.grid ||
    !maze?.exit ||
    !position
  ) {
    return Array.isArray(cachedEchoPath) && cachedEchoPath.length === 0
      ? cachedEchoPath
      : []
  }

  const reusedPath = tryReuseEchoPath(
    maze.grid,
    maze.exit,
    position,
    cachedEchoPath
  )
  if (reusedPath) {
    return reusedPath
  }

  const pathFinder =
    typeof options?.pathFinder === 'function'
      ? options.pathFinder
      : findShortestPath

  return pathFinder(maze.grid, position, maze.exit).path
}

export function collectKeycardAtPosition(keycards, position, eventCounter = 0) {
  if (!Array.isArray(keycards) || keycards.length === 0 || !position) {
    return {
      keycards: Array.isArray(keycards) ? keycards : [],
      collectedKeycard: null,
      visualEffects: [],
      eventCounter,
    }
  }

  const targetKeycard = keycards.find(
    (keycard) => keycard.row === position.row && keycard.col === position.col
  )

  if (!targetKeycard) {
    return {
      keycards,
      collectedKeycard: null,
      visualEffects: [],
      eventCounter,
    }
  }

  const nextCounter = eventCounter + 1
  return {
    keycards: keycards.filter((k) =>
      targetKeycard.id !== undefined && targetKeycard.id !== null
        ? k.id !== targetKeycard.id
        : !(k.row === targetKeycard.row && k.col === targetKeycard.col)
    ),
    collectedKeycard: targetKeycard,
    visualEffects: [
      {
        id: `fx-keycard-${nextCounter}`,
        kind: 'keycard',
        row: targetKeycard.row,
        col: targetKeycard.col,
      },
    ],
    eventCounter: nextCounter,
  }
}

export function resolveExitVictory(maze, position, activeEffects, options = {}) {
  const reachedExit = isAtExit(maze, position)
  if (!reachedExit) {
    return {
      reachedExit: false,
      blockedByLock: false,
      activeEffects,
    }
  }

  if (options?.isExitLocked) {
    return {
      reachedExit: false,
      blockedByLock: true,
      activeEffects,
    }
  }

  return {
    reachedExit: true,
    blockedByLock: false,
    activeEffects: createInitialActiveEffects(),
  }
}

export function syncPlayerCell(state, position, options = {}) {
  if (!state || state.hasWon || state.isGameOver || !position) {
    return state
  }

  const walkCheck = canMoveTo(state.maze?.grid, position.row, position.col)
  if (!walkCheck.allowed) {
    return state
  }

  const nextPos = { row: position.row, col: position.col }
  const sameCell = isSamePosition(state.playerPos, nextPos)

  if (sameCell) {
    return state
  }

  const {
    direction = state.lastDirection,
  } = options

  let nextCounter =
    typeof options.eventCounter === 'number'
      ? options.eventCounter
      : state.eventCounter + 1

  let nextInventory = state.inventory
  let nextActive = state.activeEffects
  const newVisualEffects = []

  const resolvedMaxHealth = Math.max(1, Number(state.maxHealth) || 100)
  const resolvedHealth = Math.max(
    0,
    Math.min(
      resolvedMaxHealth,
      Number.isFinite(state.health) ? state.health : resolvedMaxHealth
    )
  )
  const resolvedMaxBattery = Math.max(
    1,
    Number.isFinite(Number(options?.maxBattery)) && Number(options.maxBattery) > 0
      ? Number(options.maxBattery)
      : Number(state.maxBattery) || 100
  )
  const resolvedBattery = Math.max(
    0,
    Math.min(
      resolvedMaxBattery,
      Number.isFinite(Number(options?.battery))
        ? Number(options.battery)
        : Number.isFinite(state.battery)
          ? state.battery
          : resolvedMaxBattery
    )
  )

  // 1. Collectible Item check
  const itemResult = collectItemAtPosition(
    state.items,
    nextInventory,
    nextPos,
    nextCounter,
    {
      health: resolvedHealth,
      maxHealth: resolvedMaxHealth,
      battery: resolvedBattery,
      maxBattery: resolvedMaxBattery,
    }
  )
  if (itemResult.visualEffects.length > 0) {
    newVisualEffects.push(...itemResult.visualEffects)
  }
  nextInventory = itemResult.inventory
  const collectedItem = itemResult.collectedItem
  const rejectedItem = itemResult.rejectedItem

  if (collectedItem) {
    if (collectedItem.type === COLLECTIBLE_TYPES.ECHO_REVEAL) {
      nextActive = {
        ...nextActive,
        echoRevealRemainingMs:
          COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ECHO_REVEAL].durationMs,
      }
    } else if (collectedItem.type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS) {
      nextActive = {
        ...nextActive,
        spectralCompassRemainingMs:
          COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.SPECTRAL_COMPASS].durationMs,
      }
    } else if (collectedItem.type === COLLECTIBLE_TYPES.WARDING_CHARM) {
      nextActive = {
        ...nextActive,
        wardingCharmsCount: (nextActive.wardingCharmsCount || 0) + 1,
      }
    } else if (collectedItem.type === COLLECTIBLE_TYPES.SPIRIT_LANTERN) {
      nextActive = {
        ...nextActive,
        spiritLanternRemainingMs:
          COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.SPIRIT_LANTERN].durationMs,
      }
    }
  }

  // 2. Resonance Keycard objective check & gate unlock resolution
  const objectivesActive = state.objectivesEnabled !== false
  const keycardResult = objectivesActive
    ? collectKeycardAtPosition(
        state.keycards,
        nextPos,
        itemResult.eventCounter
      )
    : {
        keycards: state.keycards || [],
        collectedKeycard: null,
        visualEffects: [],
        eventCounter: itemResult.eventCounter,
      }

  if (keycardResult.visualEffects.length > 0) {
    newVisualEffects.push(...keycardResult.visualEffects)
  }

  const totalKeys = Math.max(0, Number(state.totalKeys) || 0)
  const nextKeysCollected =
    (state.keysCollected || 0) + (keycardResult.collectedKeycard ? 1 : 0)
  const wasExitLocked = Boolean(state.isExitLocked)
  const nextIsExitLocked =
    objectivesActive && totalKeys > 0
      ? nextKeysCollected < totalKeys && keycardResult.keycards.length > 0
      : false
  const gateJustUnlocked = wasExitLocked && !nextIsExitLocked

  let runningCounter = keycardResult.eventCounter
  if (gateJustUnlocked && state.maze?.exit) {
    runningCounter += 1
    newVisualEffects.push({
      id: `fx-gate-unlock-${runningCounter}`,
      kind: 'gate_unlock',
      row: state.maze.exit.row,
      col: state.maze.exit.col,
    })
  }

  // 3. Exit detection & Echo Reveal shortest-path update
  const exitResult = resolveExitVictory(state.maze, nextPos, nextActive, {
    isExitLocked: nextIsExitLocked,
  })
  const nextEchoPath = resolveEchoRevealPath(
    state.maze,
    nextPos,
    exitResult.activeEffects,
    exitResult.reachedExit,
    state.echoPath
  )

  const eventType = exitResult.reachedExit
    ? 'exit'
    : exitResult.blockedByLock
      ? 'locked_exit'
      : gateJustUnlocked
        ? 'gate_unlocked'
        : keycardResult.collectedKeycard
          ? 'keycard_collected'
          : collectedItem
            ? 'item_collected'
            : rejectedItem
              ? 'item_pickup_rejected'
              : 'move'

  nextCounter = runningCounter + 1
  const remainingKeys = Math.max(0, totalKeys - nextKeysCollected)
  const nextShardsCollected = (state.shardsCollected || 0) + (itemResult.shardsDelta || 0)
  const totalShards =
    typeof state.totalShards === 'number'
      ? state.totalShards
      : countSoulShards(state.maze?.collectibles?.items)
  const nextShardBonus = (state.shardBonus || 0) + (itemResult.scoreDelta || 0)

  let eventMessage = null
  if (exitResult.blockedByLock) {
    eventMessage = `Exit Gate Locked — Collect ${remainingKeys} more Resonance Keycard${remainingKeys === 1 ? '' : 's'}`
  } else if (gateJustUnlocked) {
    eventMessage = 'Resonance Exit Gate Unlocked!'
  } else if (collectedItem) {
    if (collectedItem.type === COLLECTIBLE_TYPES.HEALTH_CAPSULE) {
      eventMessage = `Health Capsule +${itemResult.healthRestored} HP`
    } else if (collectedItem.type === COLLECTIBLE_TYPES.ENERGY_CELL) {
      const pctGain = Math.round((itemResult.batteryRestored / resolvedMaxBattery) * 100)
      eventMessage = `Energy Cell +${pctGain}% Battery`
    } else if (collectedItem.type === COLLECTIBLE_TYPES.SOUL_SHARDS) {
      eventMessage = `Soul Shard +${itemResult.scoreDelta} Score (${nextShardsCollected}/${Math.max(1, totalShards)})`
    } else if (collectedItem.type === COLLECTIBLE_TYPES.ECHO_REVEAL) {
      eventMessage = 'Echo Reveal Acquired'
    } else if (collectedItem.type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS) {
      eventMessage = 'Spectral Compass Activated (6s)'
    } else if (collectedItem.type === COLLECTIBLE_TYPES.PHANTOM_VEIL) {
      eventMessage = `Phantom Veil Stored (x${nextInventory[COLLECTIBLE_TYPES.PHANTOM_VEIL]})`
    } else if (collectedItem.type === COLLECTIBLE_TYPES.WARDING_CHARM) {
      eventMessage = `Warding Charm Acquired (${nextActive.wardingCharmsCount} Shield)`
    } else if (collectedItem.type === COLLECTIBLE_TYPES.TIME_FRAGMENT) {
      eventMessage = `Time Fragment Stored (x${nextInventory[COLLECTIBLE_TYPES.TIME_FRAGMENT]})`
    } else if (collectedItem.type === COLLECTIBLE_TYPES.WATCHERS_EYE) {
      eventMessage = `Watcher's Eye Stored (x${nextInventory[COLLECTIBLE_TYPES.WATCHERS_EYE]})`
    } else if (collectedItem.type === COLLECTIBLE_TYPES.ECHO_PULSE) {
      eventMessage = `Echo Pulse Stored (x${nextInventory[COLLECTIBLE_TYPES.ECHO_PULSE]})`
    } else if (collectedItem.type === COLLECTIBLE_TYPES.SPIRIT_LANTERN) {
      eventMessage = 'Spirit Lantern Ignited — Path & Area Illuminated (8s)'
    }
  } else if (rejectedItem) {
    if (itemResult.rejectionReason === 'health_full') {
      eventMessage = 'Health Full — Health Capsule Left'
    } else if (itemResult.rejectionReason === 'battery_full') {
      eventMessage = 'Battery Full — Energy Cell Left'
    }
  }

  return {
    ...state,
    playerPos: nextPos,
    hasWon: exitResult.reachedExit,
    health: itemResult.health,
    battery: itemResult.battery,
    maxBattery: resolvedMaxBattery,
    lastDirection: direction,
    blockedBump: null,
    items: itemResult.items,
    itemsCollected: state.itemsCollected + (collectedItem ? 1 : 0),
    shardsCollected: nextShardsCollected,
    totalShards,
    shardBonus: nextShardBonus,
    keycards: keycardResult.keycards,
    keysCollected: nextKeysCollected,
    isExitLocked: nextIsExitLocked,
    inventory: nextInventory,
    activeEffects: exitResult.activeEffects,
    echoPath: nextEchoPath,
    effects: appendEffects(state.effects, newVisualEffects),
    eventCounter: nextCounter,
    lastEvent: {
      id: nextCounter,
      type: eventType,
      item: collectedItem || rejectedItem || null,
      rejected: Boolean(rejectedItem && !collectedItem),
      reason: itemResult.rejectionReason || null,
      healthRestored: itemResult.healthRestored || 0,
      health: itemResult.health,
      maxHealth: resolvedMaxHealth,
      batteryRestored: itemResult.batteryRestored || 0,
      battery: itemResult.battery,
      maxBattery: resolvedMaxBattery,
      shardsCollected: nextShardsCollected,
      totalShards,
      shardBonus: nextShardBonus,
      scoreDelta: itemResult.scoreDelta || 0,
      keycard: keycardResult.collectedKeycard,
      keysCollected: nextKeysCollected,
      totalKeys,
      gateUnlocked: gateJustUnlocked,
      isExitLocked: nextIsExitLocked,
      echoPulse: null,
      message: eventMessage,
    },
  }
}

const MAX_RECENT_ACTIVATION_IDS = 16

function activateStoredAbility(state, abilityType, action = {}) {
  if (!state || state.hasWon || state.isGameOver) return state
  if (!abilityType || typeof abilityType !== 'string') return state

  const inputEventId = action?.inputEventId ?? action?.eventId ?? null
  const recentIds = Array.isArray(state.recentActivationEventIds)
    ? state.recentActivationEventIds
    : []
  if (
    inputEventId !== null &&
    inputEventId !== undefined &&
    recentIds.includes(inputEventId)
  ) {
    return state
  }

  const available = state.inventory?.[abilityType] || 0
  if (available <= 0) return state

  const nextCounter = (state.eventCounter || 0) + 1
  const nextInventory = {
    ...state.inventory,
    [abilityType]: Math.max(0, available - 1),
  }
  const nextActive = { ...(state.activeEffects || createInitialActiveEffects()) }
  const nextRecentIds =
    inputEventId !== null && inputEventId !== undefined
      ? [...recentIds.slice(-(MAX_RECENT_ACTIVATION_IDS - 1)), inputEventId]
      : recentIds

  if (abilityType === COLLECTIBLE_TYPES.ECHO_REVEAL) {
    if ((nextActive.echoRevealRemainingMs || 0) > 0) return state
    nextActive.echoRevealRemainingMs =
      COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ECHO_REVEAL].durationMs
    const nextEchoPath = resolveEchoRevealPath(
      state.maze,
      state.playerPos,
      nextActive,
      false
    )

    return {
      ...state,
      inventory: nextInventory,
      activeEffects: nextActive,
      echoPath: nextEchoPath,
      eventCounter: nextCounter,
      recentActivationEventIds: nextRecentIds,
      lastEvent: {
        id: nextCounter,
        type: 'echo_reveal_activated',
      },
    }
  }

  if (abilityType === COLLECTIBLE_TYPES.PHANTOM_VEIL) {
    if ((nextActive.phantomVeilRemainingMs || 0) > 0) return state
    const durationMs =
      COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.PHANTOM_VEIL].durationMs
    nextActive.phantomVeilRemainingMs = durationMs

    return {
      ...state,
      inventory: nextInventory,
      activeEffects: nextActive,
      eventCounter: nextCounter,
      recentActivationEventIds: nextRecentIds,
      lastEvent: {
        id: nextCounter,
        type: 'ability_activated',
        abilityType: COLLECTIBLE_TYPES.PHANTOM_VEIL,
        durationMs,
        remainingCount: nextInventory[COLLECTIBLE_TYPES.PHANTOM_VEIL],
        message: 'Phantom Veil Activated — Concealed (4s)',
      },
    }
  }

  if (abilityType === COLLECTIBLE_TYPES.TIME_FRAGMENT) {
    if ((nextActive.timeFragmentRemainingMs || 0) > 0) return state
    const durationMs =
      COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.TIME_FRAGMENT].durationMs
    nextActive.timeFragmentRemainingMs = durationMs

    return {
      ...state,
      inventory: nextInventory,
      activeEffects: nextActive,
      eventCounter: nextCounter,
      recentActivationEventIds: nextRecentIds,
      lastEvent: {
        id: nextCounter,
        type: 'ability_activated',
        abilityType: COLLECTIBLE_TYPES.TIME_FRAGMENT,
        durationMs,
        remainingCount: nextInventory[COLLECTIBLE_TYPES.TIME_FRAGMENT],
        message: 'Time Fragment Activated — Nearby Enemies Slowed (5s)',
      },
    }
  }

  if (abilityType === COLLECTIBLE_TYPES.WATCHERS_EYE) {
    if ((nextActive.watchersEyeRemainingMs || 0) > 0) return state
    const durationMs =
      COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.WATCHERS_EYE].durationMs
    nextActive.watchersEyeRemainingMs = durationMs

    return {
      ...state,
      inventory: nextInventory,
      activeEffects: nextActive,
      eventCounter: nextCounter,
      recentActivationEventIds: nextRecentIds,
      lastEvent: {
        id: nextCounter,
        type: 'ability_activated',
        abilityType: COLLECTIBLE_TYPES.WATCHERS_EYE,
        durationMs,
        remainingCount: nextInventory[COLLECTIBLE_TYPES.WATCHERS_EYE],
        message: "Watcher's Eye Activated — Enemies Revealed (6s)",
      },
    }
  }

  if (abilityType === COLLECTIBLE_TYPES.ECHO_PULSE) {
    const durationMs =
      COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ECHO_PULSE].durationMs
    const originCell = state.playerPos ? { ...state.playerPos } : null

    return {
      ...state,
      inventory: nextInventory,
      activeEffects: nextActive,
      eventCounter: nextCounter,
      recentActivationEventIds: nextRecentIds,
      lastEvent: {
        id: nextCounter,
        type: 'ability_activated',
        abilityType: COLLECTIBLE_TYPES.ECHO_PULSE,
        durationMs,
        remainingCount: nextInventory[COLLECTIBLE_TYPES.ECHO_PULSE],
        echoPulse: {
          radius: 6,
          duration: durationMs,
          position: originCell,
        },
        message: 'Echo Pulse Emitted — Nearby Enemies Stunned (2s)',
      },
    }
  }

  return state
}

export function gameReducer(state, action) {
  switch (action.type) {
    case 'MOVE': {
      if (state.hasWon || state.isGameOver) return state

      const nextCounter = state.eventCounter + 1
      const result = attemptMove(state.maze, state.playerPos, action.direction)

      if (!result.moved) {
        return {
          ...state,
          lastDirection: action.direction,
          blockedBump: {
            direction: action.direction,
            id: (state.blockedBump?.id || 0) + 1,
          },
          eventCounter: nextCounter,
          lastEvent: {
            id: nextCounter,
            type: 'blocked',
            reason: result.reason,
          },
        }
      }

      return syncPlayerCell(state, result.position, {
        direction: action.direction,
        eventCounter: nextCounter,
      })
    }

    case 'SYNC_PLAYER_CELL': {
      const targetPosition = normalizePositionInput(action)
      if (!targetPosition) return state

      return syncPlayerCell(state, targetPosition, {
        direction: action.direction ?? state.lastDirection,
        battery: action.battery,
        maxBattery: action.maxBattery,
      })
    }

    case 'COLLECT_ITEM': {
      if (state.hasWon || state.isGameOver) return state
      const targetItem = state.items.find(
        (item) =>
          (action.itemId && item.id === action.itemId) ||
          (Number.isInteger(action.row) &&
            Number.isInteger(action.col) &&
            item.row === action.row &&
            item.col === action.col)
      )
      if (!targetItem) return state

      const nextCounter = state.eventCounter + 1
      const itemResult = collectItemAtPosition(
        state.items,
        state.inventory,
        { row: targetItem.row, col: targetItem.col },
        nextCounter,
        {
          health: state.health,
          maxHealth: state.maxHealth,
          battery: state.battery,
          maxBattery: state.maxBattery,
        }
      )
      if (!itemResult.collectedItem) return state

      const collectedItem = itemResult.collectedItem
      const nextShardsCollected =
        (state.shardsCollected || 0) + (itemResult.shardsDelta || 0)
      const totalShards =
        typeof state.totalShards === 'number'
          ? state.totalShards
          : countSoulShards(state.maze?.collectibles?.items)
      const nextShardBonus =
        (state.shardBonus || 0) + (itemResult.scoreDelta || 0)
      let nextActive = state.activeEffects
      if (collectedItem.type === COLLECTIBLE_TYPES.ECHO_REVEAL) {
        nextActive = {
          ...nextActive,
          echoRevealRemainingMs:
            COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ECHO_REVEAL].durationMs,
        }
      } else if (collectedItem.type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS) {
        nextActive = {
          ...nextActive,
          spectralCompassRemainingMs:
            COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.SPECTRAL_COMPASS].durationMs,
        }
      } else if (collectedItem.type === COLLECTIBLE_TYPES.WARDING_CHARM) {
        nextActive = {
          ...nextActive,
          wardingCharmsCount: (nextActive?.wardingCharmsCount || 0) + 1,
        }
      } else if (collectedItem.type === COLLECTIBLE_TYPES.SPIRIT_LANTERN) {
        nextActive = {
          ...nextActive,
          spiritLanternRemainingMs:
            COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.SPIRIT_LANTERN].durationMs,
        }
      }

      const nextEchoPath =
        collectedItem.type === COLLECTIBLE_TYPES.ECHO_REVEAL
          ? resolveEchoRevealPath(state.maze, state.playerPos, nextActive, false)
          : state.echoPath

      const eventId = itemResult.eventCounter + 1

      let eventMessage = null
      if (collectedItem.type === COLLECTIBLE_TYPES.HEALTH_CAPSULE) {
        eventMessage = `Health Capsule +${itemResult.healthRestored} HP`
      } else if (collectedItem.type === COLLECTIBLE_TYPES.ENERGY_CELL) {
        const pctGain = Math.round((itemResult.batteryRestored / (state.maxBattery || 100)) * 100)
        eventMessage = `Energy Cell +${pctGain}% Battery`
      } else if (collectedItem.type === COLLECTIBLE_TYPES.SOUL_SHARDS) {
        eventMessage = `Soul Shard +${itemResult.scoreDelta} Score (${nextShardsCollected}/${Math.max(1, totalShards)})`
      } else if (collectedItem.type === COLLECTIBLE_TYPES.ECHO_REVEAL) {
        eventMessage = 'Echo Reveal Acquired'
      } else if (collectedItem.type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS) {
        eventMessage = 'Spectral Compass Activated (6s)'
      } else if (collectedItem.type === COLLECTIBLE_TYPES.PHANTOM_VEIL) {
        eventMessage = `Phantom Veil Stored (x${itemResult.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL]})`
      } else if (collectedItem.type === COLLECTIBLE_TYPES.WARDING_CHARM) {
        eventMessage = `Warding Charm Acquired (${nextActive.wardingCharmsCount} Shield)`
      } else if (collectedItem.type === COLLECTIBLE_TYPES.TIME_FRAGMENT) {
        eventMessage = `Time Fragment Stored (x${itemResult.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT]})`
      } else if (collectedItem.type === COLLECTIBLE_TYPES.WATCHERS_EYE) {
        eventMessage = `Watcher's Eye Stored (x${itemResult.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE]})`
      } else if (collectedItem.type === COLLECTIBLE_TYPES.ECHO_PULSE) {
        eventMessage = `Echo Pulse Stored (x${itemResult.inventory[COLLECTIBLE_TYPES.ECHO_PULSE]})`
      } else if (collectedItem.type === COLLECTIBLE_TYPES.SPIRIT_LANTERN) {
        eventMessage = 'Spirit Lantern Ignited — Path & Area Illuminated (8s)'
      }

      return {
        ...state,
        health: itemResult.health,
        battery: itemResult.battery,
        items: itemResult.items,
        itemsCollected: state.itemsCollected + 1,
        shardsCollected: nextShardsCollected,
        totalShards,
        shardBonus: nextShardBonus,
        inventory: itemResult.inventory,
        activeEffects: nextActive,
        echoPath: nextEchoPath,
        effects: appendEffects(state.effects, itemResult.visualEffects),
        eventCounter: eventId,
        lastEvent: {
          id: eventId,
          type: 'item_collected',
          item: collectedItem,
          rejected: false,
          reason: null,
          healthRestored: itemResult.healthRestored || 0,
          health: itemResult.health,
          maxHealth: state.maxHealth,
          batteryRestored: itemResult.batteryRestored || 0,
          battery: itemResult.battery,
          maxBattery: state.maxBattery,
          shardsCollected: nextShardsCollected,
          totalShards,
          shardBonus: nextShardBonus,
          scoreDelta: itemResult.scoreDelta || 0,
          message: eventMessage,
        },
      }
    }

    case 'COMPLETE_EXIT_EXTRACTION': {
      if (state.hasWon || state.isGameOver || state.isExitLocked || !state.maze?.exit) {
        return state
      }
      const exitPos = {
        row: state.maze.exit.row,
        col: state.maze.exit.col,
      }
      const exitResult = resolveExitVictory(state.maze, exitPos, state.activeEffects, {
        isExitLocked: state.isExitLocked,
      })
      if (!exitResult.reachedExit) {
        return state
      }
      const nextCounter = state.eventCounter + 1
      return {
        ...state,
        playerPos: exitPos,
        activeEffects: exitResult.activeEffects,
        hasWon: true,
        eventCounter: nextCounter,
        lastEvent: {
          id: nextCounter,
          type: 'exit',
        },
      }
    }

    case 'ACTIVATE_ABILITY': {
      return activateStoredAbility(state, action.abilityType, action)
    }

    case 'ACTIVATE_PHANTOM_VEIL': {
      return activateStoredAbility(state, COLLECTIBLE_TYPES.PHANTOM_VEIL, action)
    }

    case 'ACTIVATE_TIME_FRAGMENT': {
      return activateStoredAbility(state, COLLECTIBLE_TYPES.TIME_FRAGMENT, action)
    }

    case 'ACTIVATE_WATCHERS_EYE': {
      return activateStoredAbility(state, COLLECTIBLE_TYPES.WATCHERS_EYE, action)
    }

    case 'ACTIVATE_ECHO_PULSE': {
      return activateStoredAbility(state, COLLECTIBLE_TYPES.ECHO_PULSE, action)
    }

    case 'TICK_ABILITIES': {
      const deltaMs = action.deltaMs || 0
      if (deltaMs <= 0) return state

      const prevEcho = state.activeEffects.echoRevealRemainingMs || 0
      const prevVeil = state.activeEffects.phantomVeilRemainingMs || 0
      const prevCompass = state.activeEffects.spectralCompassRemainingMs || 0
      const prevTime = state.activeEffects.timeFragmentRemainingMs || 0
      const prevEye = state.activeEffects.watchersEyeRemainingMs || 0
      const prevLantern = state.activeEffects.spiritLanternRemainingMs || 0

      if (
        prevEcho <= 0 &&
        prevVeil <= 0 &&
        prevCompass <= 0 &&
        prevTime <= 0 &&
        prevEye <= 0 &&
        prevLantern <= 0
      ) return state

      const nextEcho = Math.max(0, prevEcho - deltaMs)
      const nextVeil = Math.max(0, prevVeil - deltaMs)
      const nextCompass = Math.max(0, prevCompass - deltaMs)
      const nextTime = Math.max(0, prevTime - deltaMs)
      const nextEye = Math.max(0, prevEye - deltaMs)
      const nextLantern = Math.max(0, prevLantern - deltaMs)

      return {
        ...state,
        activeEffects: {
          ...state.activeEffects,
          echoRevealRemainingMs: nextEcho,
          phantomVeilRemainingMs: nextVeil,
          spectralCompassRemainingMs: nextCompass,
          timeFragmentRemainingMs: nextTime,
          watchersEyeRemainingMs: nextEye,
          spiritLanternRemainingMs: nextLantern,
        },
        echoPath:
          nextEcho > 0
            ? state.echoPath
            : Array.isArray(state.echoPath) && state.echoPath.length === 0
              ? state.echoPath
              : [],
      }
    }

    case 'REPLAY_LEVEL':
    case 'RESET_RUN': {
      return applyReplayLevelTransition(state, action)
    }

    case 'ADVANCE_LEVEL':
    case 'NEW_MAZE': {
      return applyAdvanceLevelTransition(state, action)
    }

    case 'SET_LEVEL': {
      return applySetLevelTransition(state, action)
    }

    case 'NEW_GAME': {
      return applyNewGameTransition(state, action)
    }

    case 'SET_OBJECTIVES_ENABLED': {
      const enabled = action.enabled !== false
      if (Boolean(state.objectivesEnabled) === enabled) {
        return state
      }
      if (!enabled) {
        return {
          ...state,
          objectivesEnabled: false,
          keycards: [],
          totalKeys: 0,
          keysCollected: 0,
          isExitLocked: false,
        }
      }
      const mazeKeycards = sanitizeMazeKeycards(state.maze?.keycards)
      return {
        ...state,
        objectivesEnabled: true,
        keycards: [...mazeKeycards],
        totalKeys: mazeKeycards.length,
        keysCollected: 0,
        isExitLocked: mazeKeycards.length > 0,
      }
    }

    case 'DAMAGE_PLAYER': {
      if (state.hasWon || state.isGameOver) return state
      const damage = Math.max(0, Number(action.damage) || 0)
      if (damage <= 0) return state

      const wardingCount = state.activeEffects?.wardingCharmsCount || 0
      if (wardingCount > 0) {
        const nextActive = {
          ...state.activeEffects,
          wardingCharmsCount: wardingCount - 1,
        }
        const nextCounter = state.eventCounter + 1
        return {
          ...state,
          activeEffects: nextActive,
          eventCounter: nextCounter,
          lastEvent: {
            id: nextCounter,
            type: 'warding_charm_absorbed',
            damage,
            remainingHealth: state.health,
            message: 'Warding Charm Absorbed Attack!',
          },
        }
      }

      const nextHealth = Math.max(0, Math.min(state.maxHealth, state.health - damage))
      const isGameOver = nextHealth <= 0
      const nextCounter = state.eventCounter + 1

      return {
        ...state,
        health: nextHealth,
        isGameOver,
        activeEffects: isGameOver ? createInitialActiveEffects() : state.activeEffects,
        eventCounter: nextCounter,
        lastEvent: {
          id: nextCounter,
          type: isGameOver ? 'game_over' : 'player_damaged',
          damage,
          enemyId: action.enemyId || null,
          remainingHealth: nextHealth,
        },
      }
    }

    case 'SET_HEALTH': {
      const nextHealth = Math.max(
        0,
        Math.min(state.maxHealth, Number(action.health) || 0)
      )
      const isGameOver = nextHealth <= 0
      return {
        ...state,
        health: nextHealth,
        isGameOver,
        activeEffects: isGameOver ? createInitialActiveEffects() : state.activeEffects,
      }
    }

    case 'RESET_HEALTH': {
      return {
        ...state,
        health: state.maxHealth,
        isGameOver: false,
      }
    }

    case 'SET_BATTERY': {
      const nextMaxBattery =
        Number.isFinite(Number(action.maxBattery)) && Number(action.maxBattery) > 0
          ? Number(action.maxBattery)
          : Number(state.maxBattery) || 100
      const nextBattery = Math.max(
        0,
        Math.min(nextMaxBattery, Number.isFinite(Number(action.battery)) ? Number(action.battery) : nextMaxBattery)
      )
      return {
        ...state,
        battery: nextBattery,
        maxBattery: nextMaxBattery,
      }
    }

    default:
      return state
  }
}
