import { useCallback, useReducer, useState } from 'react'
import Button from './components/common/Button'
import Modal from './components/common/Modal'
import MazeBoard from './components/game/MazeBoard'
import GameShell from './components/layout/GameShell'
import ScreenHeader from './components/layout/ScreenHeader'
import {
  DIFFICULTY_ORDER,
  MAZE_DIFFICULTIES,
} from './game/generation/mazeConfig.js'
import { generateMaze } from './game/generation/mazeGenerator.js'
import { attemptMove } from './game/mechanics/movement.js'
import { useKeyboardControls } from './hooks/useKeyboardControls.js'

const INITIAL_DIFFICULTY = 'medium'
const INITIAL_SEED = 409217

function getNextSeed(currentSeed) {
  return (((currentSeed * 1664525 + 1013904223) >>> 0) % 900000) + 100000
}

function createInitialGameState() {
  const maze = generateMaze({
    difficulty: INITIAL_DIFFICULTY,
    seed: INITIAL_SEED,
  })
  return {
    difficulty: INITIAL_DIFFICULTY,
    seed: INITIAL_SEED,
    maze,
    playerPos: maze.start,
    moves: 0,
    hasWon: false,
    lastDirection: 'down',
    blockedBump: null,
  }
}

function gameReducer(state, action) {
  switch (action.type) {
    case 'MOVE': {
      if (state.hasWon) return state

      const result = attemptMove(state.maze, state.playerPos, action.direction)
      if (!result.moved) {
        return {
          ...state,
          lastDirection: action.direction,
          blockedBump: {
            direction: action.direction,
            id: (state.blockedBump?.id || 0) + 1,
          },
        }
      }

      return {
        ...state,
        playerPos: result.position,
        moves: state.moves + 1,
        hasWon: result.reachedExit,
        lastDirection: action.direction,
        blockedBump: null,
      }
    }

    case 'SET_DIFFICULTY': {
      const nextMaze = generateMaze({
        difficulty: action.difficulty,
        seed: state.seed,
      })
      return {
        ...state,
        difficulty: action.difficulty,
        maze: nextMaze,
        playerPos: nextMaze.start,
        moves: 0,
        hasWon: false,
        lastDirection: 'down',
        blockedBump: null,
      }
    }

    case 'NEW_MAZE': {
      const nextSeed = getNextSeed(state.seed)
      const nextMaze = generateMaze({
        difficulty: state.difficulty,
        seed: nextSeed,
      })
      return {
        ...state,
        seed: nextSeed,
        maze: nextMaze,
        playerPos: nextMaze.start,
        moves: 0,
        hasWon: false,
        lastDirection: 'down',
        blockedBump: null,
      }
    }

    case 'RESET_RUN': {
      return {
        ...state,
        playerPos: state.maze.start,
        moves: 0,
        hasWon: false,
        lastDirection: 'down',
        blockedBump: null,
      }
    }

    default:
      return state
  }
}

function App() {
  const [gameState, dispatch] = useReducer(
    gameReducer,
    undefined,
    createInitialGameState
  )
  const [showSolutionPath, setShowSolutionPath] = useState(false)
  const [isInfoOpen, setIsInfoOpen] = useState(false)

  const handleMove = useCallback((direction) => {
    dispatch({ type: 'MOVE', direction })
  }, [])

  useKeyboardControls({
    enabled: !gameState.hasWon && !isInfoOpen,
    onMove: handleMove,
  })

  const { maze, difficulty, playerPos, moves, hasWon, lastDirection, blockedBump } =
    gameState

  return (
    <GameShell layout="viewport">
      <ScreenHeader
        as="h1"
        eyebrow={`Lumen Vault · ${maze.tierName}`}
        title="Maze Escape"
        rightActions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsInfoOpen(true)}
          >
            Maze Info
          </Button>
        }
      />

      <main className="gameplay-stage">
        {/* Live Game HUD */}
        <section className="game-hud" aria-label="Game status HUD">
          <div className="game-hud__group">
            <div className="game-hud__slot">
              <span className="game-hud__label">Difficulty</span>
              <span className="game-hud__value">{maze.difficultyLabel}</span>
            </div>
            <div className="game-hud__slot">
              <span className="game-hud__label">Seed</span>
              <span className="game-hud__value">#{maze.seed}</span>
            </div>
            <div className="game-hud__slot">
              <span className="game-hud__label">Pos</span>
              <span className="game-hud__value">
                {playerPos.row},{playerPos.col}
              </span>
            </div>
          </div>

          <div className="game-hud__group">
            <div className="game-hud__slot">
              <span className="game-hud__label">Moves</span>
              <span className="game-hud__value" aria-live="polite">
                {moves}
              </span>
            </div>
            <div className="game-hud__slot">
              <span className="game-hud__label">Par</span>
              <span className="game-hud__value game-hud__value--par">
                {maze.parMoves}
              </span>
            </div>
            <div className="game-hud__slot">
              <span className="game-hud__label">Time</span>
              <span className="game-hud__value">00:00.0</span>
            </div>
          </div>
        </section>

        {/* Difficulty & Generation Controls */}
        <section className="maze-toolbar" aria-label="Maze controls">
          <div
            className="maze-toolbar__presets"
            role="group"
            aria-label="Maze size presets"
          >
            {DIFFICULTY_ORDER.map((key) => {
              const preset = MAZE_DIFFICULTIES[key]
              const isActive = difficulty === key
              return (
                <Button
                  key={key}
                  variant={isActive ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={isActive}
                  onClick={() =>
                    dispatch({ type: 'SET_DIFFICULTY', difficulty: key })
                  }
                >
                  {preset.label} ({preset.rows}×{preset.cols})
                </Button>
              )
            })}
          </div>

          <div className="maze-toolbar__actions">
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={showSolutionPath}
              onClick={() => setShowSolutionPath((prev) => !prev)}
            >
              {showSolutionPath ? 'Hide BFS Path' : 'Show BFS Path'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => dispatch({ type: 'RESET_RUN' })}
            >
              Restart
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => dispatch({ type: 'NEW_MAZE' })}
            >
              New Maze
            </Button>
          </div>
        </section>

        {/* Visual Maze Board with Player */}
        <section className="maze-arena" aria-label="Interactive maze board">
          <MazeBoard
            maze={maze}
            playerPosition={playerPos}
            playerDirection={lastDirection}
            blockedBump={blockedBump}
            hasWon={hasWon}
            showSolutionPath={showSolutionPath}
          />

          <div className="maze-legend" aria-label="Maze tile legend">
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--player" />
              Player
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--start" />
              Start
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--exit" />
              Exit Gate
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--wall" />
              Slate Wall
            </span>
          </div>

          <p className="maze-controls-hint">
            Move with WASD or Arrow Keys
          </p>
        </section>
      </main>

      {/* Victory Modal */}
      <Modal
        isOpen={hasWon}
        onClose={() => dispatch({ type: 'RESET_RUN' })}
        title="Maze Escaped"
        subtitle={`${maze.difficultyLabel} · ${maze.rows}×${maze.cols} · Seed #${maze.seed}`}
        size="sm"
        showCloseButton={false}
        closeOnBackdrop={false}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => dispatch({ type: 'RESET_RUN' })}
            >
              Replay Maze
            </Button>
            <Button
              variant="primary"
              onClick={() => dispatch({ type: 'NEW_MAZE' })}
            >
              New Maze
            </Button>
          </>
        }
      >
        <p>You reached the Resonance Exit Gate and cleared the chamber.</p>
        <div className="maze-victory-stats">
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Moves Taken</span>
            <span className="maze-victory-stat__value maze-victory-stat__value--accent">
              {moves}
            </span>
          </div>
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">BFS Shortest</span>
            <span className="maze-victory-stat__value">{maze.parMoves}</span>
          </div>
        </div>
      </Modal>

      {/* Maze Validation Modal */}
      <Modal
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        title="Maze Validation Summary"
        subtitle={`${maze.difficultyLabel} · ${maze.tierName}`}
        size="sm"
        footer={
          <Button variant="primary" onClick={() => setIsInfoOpen(false)}>
            Close
          </Button>
        }
      >
        <p>
          <strong>Dimensions:</strong> {maze.rows} × {maze.cols}
        </p>
        <p>
          <strong>Deterministic Seed:</strong> #{maze.seed}
        </p>
        <p>
          <strong>Start:</strong> ({maze.start.row}, {maze.start.col}) →{' '}
          <strong>Exit:</strong> ({maze.exit.row}, {maze.exit.col})
        </p>
        <p>
          <strong>BFS Shortest Path:</strong> {maze.parMoves} steps
        </p>
        <p>
          <strong>Connectivity:</strong>{' '}
          {maze.validation.valid ? 'Verified' : 'Invalid'} (
          {maze.validation.reachableCount} / {maze.validation.totalPathCells}{' '}
          walkable cells reachable)
        </p>
      </Modal>
    </GameShell>
  )
}

export default App
