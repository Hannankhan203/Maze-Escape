import { useCallback, useEffect, useReducer, useState } from 'react'
import Button from './components/common/Button'
import Modal from './components/common/Modal'
import GameHUD from './components/game/GameHUD'
import MazeBoard from './components/game/MazeBoard'
import GameShell from './components/layout/GameShell'
import ScreenHeader from './components/layout/ScreenHeader'
import {
  createInitialGameState,
  gameReducer,
} from './game/engine/gameReducer.js'
import {
  DIFFICULTY_ORDER,
  MAZE_DIFFICULTIES,
} from './game/generation/mazeConfig.js'
import { useKeyboardControls } from './hooks/useKeyboardControls.js'

function App({ onGameEvent }) {
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

  const handleActivateAbility = useCallback((abilityType) => {
    dispatch({ type: 'ACTIVATE_ABILITY', abilityType })
  }, [])

  const controlsEnabled = !gameState.hasWon && !isInfoOpen

  useKeyboardControls({
    enabled: controlsEnabled,
    onMove: handleMove,
    onActivateAbility: handleActivateAbility,
  })

  // Drive active temporary ability countdowns (Echo Reveal / Coin Magnet)
  const hasTimedAbility =
    gameState.activeEffects.echoRevealRemainingMs > 0 ||
    gameState.activeEffects.magnetRemainingMs > 0

  useEffect(() => {
    if (!hasTimedAbility || !controlsEnabled) return undefined

    let lastTick = Date.now()
    const intervalId = window.setInterval(() => {
      const now = Date.now()
      const deltaMs = now - lastTick
      lastTick = now
      dispatch({ type: 'TICK_ABILITIES', deltaMs })
    }, 100)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [hasTimedAbility, controlsEnabled])

  // Sound-ready event hook for collection, ability activation, and exit events
  useEffect(() => {
    if (gameState.lastEvent && typeof onGameEvent === 'function') {
      onGameEvent(gameState.lastEvent)
    }
  }, [gameState.lastEvent, onGameEvent])

  const {
    maze,
    difficulty,
    playerPos,
    moves,
    hasWon,
    lastDirection,
    blockedBump,
    coins,
    totalCoins,
    coinsCollected,
    powerUps,
    inventory,
    activeEffects,
    echoPath,
    effects,
  } = gameState

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
        <GameHUD
          maze={maze}
          moves={moves}
          coinsCollected={coinsCollected}
          totalCoins={totalCoins}
          inventory={inventory}
          activeEffects={activeEffects}
          disabled={!controlsEnabled}
          onActivateAbility={handleActivateAbility}
        />

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

        {/* Visual Maze Board with Player, Coins & Power-Ups */}
        <section className="maze-arena" aria-label="Interactive maze board">
          <MazeBoard
            maze={maze}
            playerPosition={playerPos}
            playerDirection={lastDirection}
            blockedBump={blockedBump}
            hasWon={hasWon}
            showSolutionPath={showSolutionPath}
            echoPath={echoPath}
            coins={coins}
            powerUps={powerUps}
            effects={effects}
            wallPassArmed={activeEffects.wallPassArmed}
            magnetActive={activeEffects.magnetRemainingMs > 0}
          />

          <div className="maze-legend" aria-label="Maze tile legend">
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--player" />
              Player
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--coin" />
              Coin
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--powerup" />
              Power-Up
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--exit" />
              Exit
            </span>
          </div>

          <p className="maze-controls-hint">
            Move: WASD / Arrows · Phase: Space · Echo: E · Magnet: Q
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
            <span className="maze-victory-stat__label">Coins Collected</span>
            <span className="maze-victory-stat__value">
              {coinsCollected} / {totalCoins}
            </span>
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
          <strong>Collectibles:</strong> {totalCoins} coins ·{' '}
          {maze.collectibles?.powerUps?.length || 0} power-ups
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
