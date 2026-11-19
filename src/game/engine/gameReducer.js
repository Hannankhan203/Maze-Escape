import { normalizeMazeDifficulty } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { attemptMove, canMoveTo, isAtExit } from '../mechanics/movement.js'
import {
  createInitialActiveEffects,
  createInitialInventory,
  findMagnetizableCoins,
  MAGNET_RADIUS,
  POWERUP_CONFIG,
  POWERUP_TYPES,
} from '../mechanics/powerups.js'

const INITIAL_DIFFICULTY = 'medium'
const INITIAL_SEED = 409217
const MAX_VISUAL_EFFECTS = 8

export function getNextSeed(currentSeed) {
  return (((currentSeed * 1664525 + 1013904223) >>> 0) % 900000) + 100000
}

function buildStateFromMaze(maze, difficulty, seed, eventCounter = 0, config = {}) {
  const initialCoins = maze.collectibles?.coins || []
  const initialPowerUps = maze.collectibles?.powerUps || []
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
    coins: [...initialCoins],
    totalCoins: initialCoins.length,
    coinsCollected: 0,
    powerUps: [...initialPowerUps],
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
 * Collects a coin directly on `position`, if present, returning updated coins
 * and visual effect metadata.
 */
export function collectCoinAtPosition(coins, position, eventCounter = 0) {
  if (!Array.isArray(coins) || coins.length === 0 || !position) {
    return {
      coins: Array.isArray(coins) ? coins : [],
      coinsGained: 0,
      visualEffects: [],
      eventCounter,
    }
  }

  const directCoin = coins.find(
    (coin) => coin.row === position.row && coin.col === position.col
  )

  if (!directCoin) {
    return {
      coins,
      coinsGained: 0,
      visualEffects: [],
      eventCounter,
    }
  }

  const nextCounter = eventCounter + 1
  return {
    coins: coins.filter((c) => c.id !== directCoin.id),
    coinsGained: 1,
    visualEffects: [
      {
        id: `fx-coin-${nextCounter}`,
        kind: 'coin',
        row: directCoin.row,
        col: directCoin.col,
      },
    ],
    eventCounter: nextCounter,
  }
}

/**
 * Pulls unobstructed coins within Coin Magnet BFS radius when Magnet is active.
 */
export function processCoinMagnet(
  grid,
  position,
  coins,
  activeEffects,
  eventCounter = 0,
  effectPrefix = 'fx-mag'
) {
  if (
    !activeEffects ||
    activeEffects.magnetRemainingMs <= 0 ||
    !Array.isArray(coins) ||
    coins.length === 0 ||
    !position
  ) {
    return {
      coins: Array.isArray(coins) ? coins : [],
      coinsGained: 0,
      visualEffects: [],
      eventCounter,
    }
  }

  const pulledCoins = findMagnetizableCoins(grid, position, coins, MAGNET_RADIUS)
  if (pulledCoins.length === 0) {
    return {
      coins,
      coinsGained: 0,
      visualEffects: [],
      eventCounter,
    }
  }

  const pulledIds = new Set(pulledCoins.map((c) => c.id))
  const remainingCoins = coins.filter((c) => !pulledIds.has(c.id))
  const visualEffects = []
  let nextCounter = eventCounter

  for (let i = 0; i < pulledCoins.length; i += 1) {
    nextCounter += 1
    visualEffects.push({
      id: `${effectPrefix}-${nextCounter}`,
      kind: 'coin',
      row: pulledCoins[i].row,
      col: pulledCoins[i].col,
    })
  }

  return {
    coins: remainingCoins,
    coinsGained: pulledCoins.length,
    visualEffects,
    eventCounter: nextCounter,
  }
}

/**
 * Collects a power-up token at `position`, incrementing inventory once.
 */
export function collectPowerUpAtPosition(
  powerUps,
  inventory,
  position,
  eventCounter = 0
) {
  if (!Array.isArray(powerUps) || powerUps.length === 0 || !position) {
    return {
      powerUps: Array.isArray(powerUps) ? powerUps : [],
      inventory,
      collectedPowerUp: null,
      visualEffects: [],
      eventCounter,
    }
  }

  const steppedPowerUp = powerUps.find(
    (pu) => pu.row === position.row && pu.col === position.col
  )

  if (!steppedPowerUp) {
    return {
      powerUps,
      inventory,
      collectedPowerUp: null,
      visualEffects: [],
      eventCounter,
    }
  }

  const nextInventory = {
    ...inventory,
    [steppedPowerUp.type]: (inventory?.[steppedPowerUp.type] || 0) + 1,
  }
  const nextCounter = eventCounter + 1

  return {
    powerUps: powerUps.filter((pu) => pu.id !== steppedPowerUp.id),
    inventory: nextInventory,
    collectedPowerUp: steppedPowerUp.type,
    visualEffects: [
      {
        id: `fx-pu-${nextCounter}`,
        kind: steppedPowerUp.type,
        row: steppedPowerUp.row,
        col: steppedPowerUp.col,
      },
    ],
    eventCounter: nextCounter,
  }
}

/**
 * Computes the Echo Reveal BFS path from `position` to exit when active.
 */
export function resolveEchoRevealPath(
  maze,
  position,
  activeEffects,
  reachedExit = false
) {
  if (
    reachedExit ||
    !activeEffects ||
    activeEffects.echoRevealRemainingMs <= 0 ||
    !maze?.grid ||
    !maze?.exit ||
    !position
  ) {
    return []
  }

  return findShortestPath(maze.grid, position, maze.exit).path
}

/**
 * Collects a Resonance Keycard on `position`, returning updated keycards
 * and visual effect metadata.
 */
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

/**
 * Evaluates exit arrival and clears active timed/armed effects upon victory,
 * blocking victory when the exit gate is locked.
 */
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
      magnetRemainingMs: 0,
      wallPassArmed: false,
    },
  }
}

/**
 * Synchronizes game state when the player enters a walkable maze cell,
 * resolving Wall Pass consumption, coins, Coin Magnet, power-ups, Echo Reveal,
 * exit victory, and `lastEvent` independently of how movement occurred.
 */
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
  const canConsumeWallPass =
    Boolean(options.usedWallPass) &&
    Boolean(state.activeEffects?.wallPassArmed) &&
    (state.inventory?.[POWERUP_TYPES.WALL_PASS] || 0) > 0

  // Prevent duplicate move counts, item sweeps, or events when re-syncing same cell
  if (sameCell && !canConsumeWallPass) {
    return state
  }

  const {
    direction = state.lastDirection,
    countMove = true,
    passedWall = null,
  } = options

  let nextCounter =
    typeof options.eventCounter === 'number'
      ? options.eventCounter
      : state.eventCounter + 1

  let nextInventory = state.inventory
  let nextActive = state.activeEffects
  const newVisualEffects = []

  if (canConsumeWallPass) {
    nextInventory = {
      ...state.inventory,
      [POWERUP_TYPES.WALL_PASS]: Math.max(
        0,
        (state.inventory?.[POWERUP_TYPES.WALL_PASS] || 0) - 1
      ),
    }
    nextActive = {
      ...state.activeEffects,
      wallPassArmed: false,
    }
    if (passedWall) {
      nextCounter += 1
      newVisualEffects.push({
        id: `fx-wp-${nextCounter}`,
        kind: 'wall_pass',
        row: passedWall.row,
        col: passedWall.col,
      })
    }
  }

  // 1. Direct tile coin check
  const coinResult = collectCoinAtPosition(state.coins, nextPos, nextCounter)
  if (coinResult.visualEffects.length > 0) {
    newVisualEffects.push(...coinResult.visualEffects)
  }

  // 2. Magnet sweep (wall-blocked BFS within radius)
  const magnetResult = processCoinMagnet(
    state.maze.grid,
    nextPos,
    coinResult.coins,
    nextActive,
    coinResult.eventCounter,
    'fx-mag'
  )
  if (magnetResult.visualEffects.length > 0) {
    newVisualEffects.push(...magnetResult.visualEffects)
  }

  const coinsGained = coinResult.coinsGained + magnetResult.coinsGained

  // 3. Power-up tile check
  const powerUpResult = collectPowerUpAtPosition(
    state.powerUps,
    nextInventory,
    nextPos,
    magnetResult.eventCounter
  )
  if (powerUpResult.visualEffects.length > 0) {
    newVisualEffects.push(...powerUpResult.visualEffects)
  }

  // 4. Resonance Keycard objective check & gate unlock resolution
  const objectivesActive = state.objectivesEnabled !== false
  const keycardResult = objectivesActive
    ? collectKeycardAtPosition(
        state.keycards,
        nextPos,
        powerUpResult.eventCounter
      )
    : {
        keycards: state.keycards || [],
        collectedKeycard: null,
        visualEffects: [],
        eventCounter: powerUpResult.eventCounter,
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

  // 5. Exit detection & Echo Reveal shortest-path update
  const exitResult = resolveExitVictory(state.maze, nextPos, nextActive, {
    isExitLocked: nextIsExitLocked,
  })
  const nextEchoPath = resolveEchoRevealPath(
    state.maze,
    nextPos,
    exitResult.activeEffects,
    exitResult.reachedExit
  )

  const eventType = exitResult.reachedExit
    ? 'exit'
    : exitResult.blockedByLock
      ? 'locked_exit'
      : gateJustUnlocked
        ? 'gate_unlocked'
        : keycardResult.collectedKeycard
          ? 'keycard_collected'
          : canConsumeWallPass
            ? 'wall_pass_used'
            : powerUpResult.collectedPowerUp
              ? 'powerup_collected'
              : coinsGained > 0
                ? 'coin_collected'
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
    coins: magnetResult.coins,
    coinsCollected: state.coinsCollected + coinsGained,
    powerUps: powerUpResult.powerUps,
    keycards: keycardResult.keycards,
    keysCollected: nextKeysCollected,
    isExitLocked: nextIsExitLocked,
    inventory: powerUpResult.inventory,
    activeEffects: exitResult.activeEffects,
    echoPath: nextEchoPath,
    effects: appendEffects(state.effects, newVisualEffects),
    eventCounter: nextCounter,
    lastEvent: {
      id: nextCounter,
      type: eventType,
      coinsGained,
      powerUpType: powerUpResult.collectedPowerUp,
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
      const result = attemptMove(state.maze, state.playerPos, action.direction, {
        wallPassArmed: state.activeEffects.wallPassArmed,
      })

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
        usedWallPass: result.usedWallPass,
        passedWall: result.passedWall,
        eventCounter: nextCounter,
      })
    }

    case 'SYNC_PLAYER_CELL': {
      const targetPosition = normalizePositionInput(action)
      if (!targetPosition) return state

      return syncPlayerCell(state, targetPosition, {
        direction: action.direction ?? state.lastDirection,
        countMove: action.countMove !== false,
        usedWallPass: Boolean(action.usedWallPass),
        passedWall: action.passedWall || null,
      })
    }

    case 'ACTIVATE_ABILITY': {
      if (state.hasWon || state.isGameOver) return state

      const abilityType = action.abilityType
      const available = state.inventory[abilityType] || 0
      if (available <= 0) return state

      let nextCounter = state.eventCounter + 1
      const nextInventory = { ...state.inventory }
      const nextActive = { ...state.activeEffects }

      if (abilityType === POWERUP_TYPES.WALL_PASS) {
        if (nextActive.wallPassArmed) return state
        nextActive.wallPassArmed = true
        return {
          ...state,
          activeEffects: nextActive,
          eventCounter: nextCounter,
          lastEvent: {
            id: nextCounter,
            type: 'wall_pass_armed',
          },
        }
      }

      if (abilityType === POWERUP_TYPES.ECHO_REVEAL) {
        if (nextActive.echoRevealRemainingMs > 0) return state
        nextInventory[POWERUP_TYPES.ECHO_REVEAL] = Math.max(0, available - 1)
        nextActive.echoRevealRemainingMs =
          POWERUP_CONFIG[POWERUP_TYPES.ECHO_REVEAL].durationMs
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

      if (abilityType === POWERUP_TYPES.COIN_MAGNET) {
        if (nextActive.magnetRemainingMs > 0) return state
        nextInventory[POWERUP_TYPES.COIN_MAGNET] = Math.max(0, available - 1)
        nextActive.magnetRemainingMs =
          POWERUP_CONFIG[POWERUP_TYPES.COIN_MAGNET].durationMs

        // Immediately sweep unobstructed coins within radius
        const magnetResult = processCoinMagnet(
          state.maze.grid,
          state.playerPos,
          state.coins,
          nextActive,
          nextCounter,
          'fx-mag-init'
        )

        nextCounter = magnetResult.eventCounter + 1
        return {
          ...state,
          coins: magnetResult.coins,
          coinsCollected: state.coinsCollected + magnetResult.coinsGained,
          inventory: nextInventory,
          activeEffects: nextActive,
          effects: appendEffects(state.effects, magnetResult.visualEffects),
          eventCounter: nextCounter,
          lastEvent: {
            id: nextCounter,
            type: 'coin_magnet_activated',
            coinsGained: magnetResult.coinsGained,
          },
        }
      }

      return state
    }

    case 'TICK_ABILITIES': {
      const deltaMs = action.deltaMs || 0
      if (deltaMs <= 0) return state

      const prevEcho = state.activeEffects.echoRevealRemainingMs
      const prevMagnet = state.activeEffects.magnetRemainingMs
      if (prevEcho <= 0 && prevMagnet <= 0) return state

      const nextEcho = Math.max(0, prevEcho - deltaMs)
      const nextMagnet = Math.max(0, prevMagnet - deltaMs)

      return {
        ...state,
        activeEffects: {
          ...state.activeEffects,
          echoRevealRemainingMs: nextEcho,
          magnetRemainingMs: nextMagnet,
        },
        echoPath: nextEcho > 0 ? state.echoPath : [],
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
