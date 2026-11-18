import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { attemptMove } from '../mechanics/movement.js'
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

function buildStateFromMaze(maze, difficulty, seed, eventCounter = 0) {
  const initialCoins = maze.collectibles?.coins || []
  const initialPowerUps = maze.collectibles?.powerUps || []

  return {
    difficulty,
    seed,
    maze,
    playerPos: maze.start,
    moves: 0,
    hasWon: false,
    lastDirection: 'down',
    blockedBump: null,
    coins: [...initialCoins],
    totalCoins: initialCoins.length,
    coinsCollected: 0,
    powerUps: [...initialPowerUps],
    inventory: createInitialInventory(),
    activeEffects: createInitialActiveEffects(),
    echoPath: [],
    effects: [],
    eventCounter,
    lastEvent: null,
  }
}

export function createInitialGameState(
  difficulty = INITIAL_DIFFICULTY,
  seed = INITIAL_SEED
) {
  const maze = generateMaze({ difficulty, seed })
  return buildStateFromMaze(maze, difficulty, seed, 0)
}

function appendEffects(existing, additions) {
  if (!additions || additions.length === 0) return existing
  const combined = [...existing, ...additions]
  return combined.slice(-MAX_VISUAL_EFFECTS)
}

export function gameReducer(state, action) {
  switch (action.type) {
    case 'MOVE': {
      if (state.hasWon) return state

      let nextCounter = state.eventCounter + 1
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

      const nextPos = result.position
      const nextInventory = { ...state.inventory }
      const nextActive = { ...state.activeEffects }
      const newVisualEffects = []

      if (result.usedWallPass) {
        nextInventory[POWERUP_TYPES.WALL_PASS] = Math.max(
          0,
          nextInventory[POWERUP_TYPES.WALL_PASS] - 1
        )
        nextActive.wallPassArmed = false
        if (result.passedWall) {
          nextCounter += 1
          newVisualEffects.push({
            id: `fx-wp-${nextCounter}`,
            kind: 'wall_pass',
            row: result.passedWall.row,
            col: result.passedWall.col,
          })
        }
      }

      // 1. Direct tile coin check
      let remainingCoins = state.coins
      let coinsGained = 0

      const directCoin = remainingCoins.find(
        (coin) => coin.row === nextPos.row && coin.col === nextPos.col
      )
      if (directCoin) {
        remainingCoins = remainingCoins.filter((c) => c.id !== directCoin.id)
        coinsGained += 1
        nextCounter += 1
        newVisualEffects.push({
          id: `fx-coin-${nextCounter}`,
          kind: 'coin',
          row: directCoin.row,
          col: directCoin.col,
        })
      }

      // 2. Magnet sweep (wall-blocked BFS within radius)
      if (nextActive.magnetRemainingMs > 0 && remainingCoins.length > 0) {
        const pulledCoins = findMagnetizableCoins(
          state.maze.grid,
          nextPos,
          remainingCoins,
          MAGNET_RADIUS
        )

        if (pulledCoins.length > 0) {
          const pulledIds = new Set(pulledCoins.map((c) => c.id))
          remainingCoins = remainingCoins.filter((c) => !pulledIds.has(c.id))
          coinsGained += pulledCoins.length
          for (let i = 0; i < pulledCoins.length; i += 1) {
            nextCounter += 1
            newVisualEffects.push({
              id: `fx-mag-${nextCounter}`,
              kind: 'coin',
              row: pulledCoins[i].row,
              col: pulledCoins[i].col,
            })
          }
        }
      }

      // 3. Power-up tile check
      let remainingPowerUps = state.powerUps
      let collectedPowerUp = null
      const steppedPowerUp = remainingPowerUps.find(
        (pu) => pu.row === nextPos.row && pu.col === nextPos.col
      )

      if (steppedPowerUp) {
        remainingPowerUps = remainingPowerUps.filter(
          (pu) => pu.id !== steppedPowerUp.id
        )
        nextInventory[steppedPowerUp.type] =
          (nextInventory[steppedPowerUp.type] || 0) + 1
        collectedPowerUp = steppedPowerUp.type
        nextCounter += 1
        newVisualEffects.push({
          id: `fx-pu-${nextCounter}`,
          kind: steppedPowerUp.type,
          row: steppedPowerUp.row,
          col: steppedPowerUp.col,
        })
      }

      // 4. Update Echo Reveal shortest path dynamically if active
      let nextEchoPath = state.echoPath
      if (result.reachedExit) {
        nextActive.echoRevealRemainingMs = 0
        nextActive.magnetRemainingMs = 0
        nextActive.wallPassArmed = false
        nextEchoPath = []
      } else if (nextActive.echoRevealRemainingMs > 0) {
        nextEchoPath = findShortestPath(
          state.maze.grid,
          nextPos,
          state.maze.exit
        ).path
      }

      const eventType = result.reachedExit
        ? 'exit'
        : result.usedWallPass
          ? 'wall_pass_used'
          : collectedPowerUp
            ? 'powerup_collected'
            : coinsGained > 0
              ? 'coin_collected'
              : 'move'

      nextCounter += 1

      return {
        ...state,
        playerPos: nextPos,
        moves: state.moves + 1,
        hasWon: result.reachedExit,
        lastDirection: action.direction,
        blockedBump: null,
        coins: remainingCoins,
        coinsCollected: state.coinsCollected + coinsGained,
        powerUps: remainingPowerUps,
        inventory: nextInventory,
        activeEffects: nextActive,
        echoPath: nextEchoPath,
        effects: appendEffects(state.effects, newVisualEffects),
        eventCounter: nextCounter,
        lastEvent: {
          id: nextCounter,
          type: eventType,
          coinsGained,
          powerUpType: collectedPowerUp,
        },
      }
    }

    case 'ACTIVATE_ABILITY': {
      if (state.hasWon) return state

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
        const revealResult = findShortestPath(
          state.maze.grid,
          state.playerPos,
          state.maze.exit
        )

        return {
          ...state,
          inventory: nextInventory,
          activeEffects: nextActive,
          echoPath: revealResult.path,
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
        let remainingCoins = state.coins
        let coinsGained = 0
        const newVisualEffects = []

        const pulled = findMagnetizableCoins(
          state.maze.grid,
          state.playerPos,
          remainingCoins,
          MAGNET_RADIUS
        )
        if (pulled.length > 0) {
          const pulledIds = new Set(pulled.map((c) => c.id))
          remainingCoins = remainingCoins.filter((c) => !pulledIds.has(c.id))
          coinsGained = pulled.length
          for (let i = 0; i < pulled.length; i += 1) {
            nextCounter += 1
            newVisualEffects.push({
              id: `fx-mag-init-${nextCounter}`,
              kind: 'coin',
              row: pulled[i].row,
              col: pulled[i].col,
            })
          }
        }

        nextCounter += 1
        return {
          ...state,
          coins: remainingCoins,
          coinsCollected: state.coinsCollected + coinsGained,
          inventory: nextInventory,
          activeEffects: nextActive,
          effects: appendEffects(state.effects, newVisualEffects),
          eventCounter: nextCounter,
          lastEvent: {
            id: nextCounter,
            type: 'coin_magnet_activated',
            coinsGained,
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
      const nextMaze = generateMaze({
        difficulty: action.difficulty,
        seed: state.seed,
      })
      return buildStateFromMaze(
        nextMaze,
        action.difficulty,
        state.seed,
        state.eventCounter + 1
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
        state.eventCounter + 1
      )
    }

    case 'RESET_RUN': {
      return buildStateFromMaze(
        state.maze,
        state.difficulty,
        state.seed,
        state.eventCounter + 1
      )
    }

    default:
      return state
  }
}
