import { normalizeMazeDifficulty } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { attemptMove, canMoveTo, isAtExit } from '../mechanics/movement.js'
import {
  COLLECTIBLE_CONFIG,
  COLLECTIBLE_TYPES,
  createInitialActiveEffects,
  createInitialInventory,
} from '../mechanics/collectiblesConfig.js'

const INITIAL_DIFFICULTY = 'medium'
const INITIAL_SEED = 409217
const MAX_VISUAL_EFFECTS = 8

export function getNextSeed(currentSeed) {
  return (((currentSeed * 1664525 + 1013904223) >>> 0) % 900000) + 100000
}

function buildStateFromMaze(maze, difficulty, seed, eventCounter = 0, config = {}) {
  const initialItems = maze.collectibles?.items || []
  const objectivesEnabled = config?.objectivesEnabled !== false
  const initialKeycards = objectivesEnabled ? maze.keycards || [] : []
  const maxHealth = Math.max(1, Number(config?.maxHealth) || 100)
  const health = Math.max(
    0,
    Math.min(
      maxHealth,
      Number.isFinite(config?.health) ? config.health : maxHealth
    )
  )

  return {
    difficulty,
    seed,
    maze,
    playerPos: maze.start,
    moves: 0,
    hasWon: false,
    isGameOver: false,
    health,
    maxHealth,
    lastDirection: 'down',
    blockedBump: null,
    items: [...initialItems],
    totalItems: initialItems.length,
    itemsCollected: 0,
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
    lastEvent: null,
  }
}

export function createInitialGameState(
  difficulty = INITIAL_DIFFICULTY,
  seed = INITIAL_SEED,
  config = {}
) {
  const normalizedDifficulty = normalizeMazeDifficulty(difficulty)
  const maze = generateMaze({ difficulty: normalizedDifficulty, seed })
  return buildStateFromMaze(maze, maze.difficulty, seed, 0, config)
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
 * Collects a collectible item at `position`, incrementing inventory and returning updated items.
 */
export function collectItemAtPosition(items, inventory, position, eventCounter = 0) {
  if (!Array.isArray(items) || items.length === 0 || !position) {
    return {
      items: Array.isArray(items) ? items : [],
      inventory,
      collectedItem: null,
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
      visualEffects: [],
      eventCounter,
    }
  }

  const nextInventory = {
    ...inventory,
    [steppedItem.type]: (inventory?.[steppedItem.type] || 0) + 1,
  }
  const nextCounter = eventCounter + 1

  return {
    items: items.filter((item) => item.id !== steppedItem.id),
    inventory: nextInventory,
    collectedItem: steppedItem,
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
    keycards: keycards.filter((k) => k.id !== targetKeycard.id),
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
    activeEffects: {
      ...activeEffects,
      echoRevealRemainingMs: 0,
      phantomVeilRemainingMs: 0,
    },
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
    countMove = true,
  } = options

  let nextCounter =
    typeof options.eventCounter === 'number'
      ? options.eventCounter
      : state.eventCounter + 1

  let nextInventory = state.inventory
  let nextActive = state.activeEffects
  const newVisualEffects = []

  // 1. Collectible Item check
  const itemResult = collectItemAtPosition(
    state.items,
    nextInventory,
    nextPos,
    nextCounter
  )
  if (itemResult.visualEffects.length > 0) {
    newVisualEffects.push(...itemResult.visualEffects)
  }
  nextInventory = itemResult.inventory
  const collectedItem = itemResult.collectedItem

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

  const totalKeys = state.totalKeys || 0
  const nextKeysCollected =
    (state.keysCollected || 0) + (keycardResult.collectedKeycard ? 1 : 0)
  const wasExitLocked = Boolean(state.isExitLocked)
  const nextIsExitLocked =
    objectivesActive && totalKeys > 0 ? nextKeysCollected < totalKeys : false
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
            : 'move'

  nextCounter = runningCounter + 1
  const remainingKeys = Math.max(0, totalKeys - nextKeysCollected)

  return {
    ...state,
    playerPos: nextPos,
    moves: state.moves + (countMove ? 1 : 0),
    hasWon: exitResult.reachedExit,
    lastDirection: direction,
    blockedBump: null,
    items: itemResult.items,
    itemsCollected: state.itemsCollected + (collectedItem ? 1 : 0),
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
      item: collectedItem,
      keycard: keycardResult.collectedKeycard,
      keysCollected: nextKeysCollected,
      totalKeys,
      gateUnlocked: gateJustUnlocked,
      isExitLocked: nextIsExitLocked,
      message: exitResult.blockedByLock
        ? `Exit Gate Locked — Collect ${remainingKeys} more Resonance Keycard${remainingKeys === 1 ? '' : 's'}`
        : gateJustUnlocked
          ? 'Resonance Exit Gate Unlocked!'
          : null,
    },
  }
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
        countMove: true,
        eventCounter: nextCounter,
      })
    }

    case 'SYNC_PLAYER_CELL': {
      const targetPosition = normalizePositionInput(action)
      if (!targetPosition) return state

      return syncPlayerCell(state, targetPosition, {
        direction: action.direction ?? state.lastDirection,
        countMove: action.countMove !== false,
      })
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
      if (state.hasWon || state.isGameOver) return state

      const abilityType = action.abilityType
      const available = state.inventory[abilityType] || 0
      if (available <= 0) return state

      let nextCounter = state.eventCounter + 1
      const nextInventory = { ...state.inventory }
      const nextActive = { ...state.activeEffects }

      if (abilityType === COLLECTIBLE_TYPES.ECHO_REVEAL) {
        if (nextActive.echoRevealRemainingMs > 0) return state
        nextInventory[COLLECTIBLE_TYPES.ECHO_REVEAL] = Math.max(0, available - 1)
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
          lastEvent: {
            id: nextCounter,
            type: 'echo_reveal_activated',
          },
        }
      }

      return state
    }

    case 'TICK_ABILITIES': {
      const deltaMs = action.deltaMs || 0
      if (deltaMs <= 0) return state

      const prevEcho = state.activeEffects.echoRevealRemainingMs
      const prevVeil = state.activeEffects.phantomVeilRemainingMs
      if (prevEcho <= 0 && prevVeil <= 0) return state

      const nextEcho = Math.max(0, prevEcho - deltaMs)
      const nextVeil = Math.max(0, prevVeil - deltaMs)

      return {
        ...state,
        activeEffects: {
          ...state.activeEffects,
          echoRevealRemainingMs: nextEcho,
          phantomVeilRemainingMs: nextVeil,
        },
        echoPath:
          nextEcho > 0
            ? state.echoPath
            : Array.isArray(state.echoPath) && state.echoPath.length === 0
              ? state.echoPath
              : [],
      }
    }

    case 'SET_DIFFICULTY': {
      const normalizedDifficulty = normalizeMazeDifficulty(action.difficulty)
      const nextMaze = generateMaze({
        difficulty: normalizedDifficulty,
        seed: state.seed,
      })
      return buildStateFromMaze(
        nextMaze,
        nextMaze.difficulty,
        state.seed,
        state.eventCounter + 1,
        {
          objectivesEnabled: state.objectivesEnabled !== false,
          runId: (state.runId || 1) + 1,
        }
      )
    }

    case 'NEW_MAZE': {
      const nextSeed = getNextSeed(state.seed)
      const nextMaze = generateMaze({
        difficulty: state.difficulty,
        seed: nextSeed,
      })
      return buildStateFromMaze(
        nextMaze,
        state.difficulty,
        nextSeed,
        state.eventCounter + 1,
        {
          objectivesEnabled: state.objectivesEnabled !== false,
          runId: (state.runId || 1) + 1,
        }
      )
    }

    case 'RESET_RUN': {
      return buildStateFromMaze(
        state.maze,
        state.difficulty,
        state.seed,
        state.eventCounter + 1,
        {
          objectivesEnabled: state.objectivesEnabled !== false,
          runId: (state.runId || 1) + 1,
        }
      )
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
      const mazeKeycards = state.maze?.keycards || []
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

      const nextHealth = Math.max(0, Math.min(state.maxHealth, state.health - damage))
      const isGameOver = nextHealth <= 0
      const nextCounter = state.eventCounter + 1

      return {
        ...state,
        health: nextHealth,
        isGameOver,
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
      return {
        ...state,
        health: nextHealth,
        isGameOver: nextHealth <= 0,
      }
    }

    case 'RESET_HEALTH': {
      return {
        ...state,
        health: state.maxHealth,
        isGameOver: false,
      }
    }

    default:
      return state
  }
}
