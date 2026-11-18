import { Component, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Button from './components/common/Button'
import Modal from './components/common/Modal'
import GameHUD from './components/game/GameHUD'
import MazeBoard from './components/game/MazeBoard'
import MazeViewport3D from './components/game/MazeViewport3D'
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
import { CAMERA_MODES } from './game/three/CameraRig.js'
import { useKeyboardControls } from './hooks/useKeyboardControls.js'

const VIEW_MODES = {
  MODE_2D: '2d',
  MODE_3D: '3d',
}

function readViewModeFromSearch(search) {
  if (typeof search !== 'string' || !search) {
    return VIEW_MODES.MODE_2D
  }
  const params = new URLSearchParams(search)
  const rawView = params.get('view')
  return rawView && rawView.toLowerCase() === VIEW_MODES.MODE_3D
    ? VIEW_MODES.MODE_3D
    : VIEW_MODES.MODE_2D
}

function getWindowViewMode() {
  if (typeof window === 'undefined' || !window.location) {
    return VIEW_MODES.MODE_2D
  }
  return readViewModeFromSearch(window.location.search)
}

function syncViewQueryParam(nextMode) {
  if (
    typeof window === 'undefined' ||
    !window.location ||
    typeof window.history?.replaceState !== 'function'
  ) {
    return
  }

  try {
    const url = new URL(window.location.href)
    if (nextMode === VIEW_MODES.MODE_3D) {
      url.searchParams.set('view', VIEW_MODES.MODE_3D)
    } else {
      url.searchParams.delete('view')
    }
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // Ignore history API restrictions in synthetic test environments
  }
}

class Viewport3DErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    this.props.onError?.(error)
  }

  render() {
    if (this.state.hasError) {
      return null
    }
    return this.props.children
  }
}

function App({
  onGameEvent,
  viewportEngineConfig = null,
  onViewportReady = null,
}) {
  const [gameState, dispatch] = useReducer(
    gameReducer,
    undefined,
    createInitialGameState
  )
  const [showSolutionPath, setShowSolutionPath] = useState(false)
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [viewMode, setViewMode] = useState(getWindowViewMode)
  const [hasOptedInto3D, setHasOptedInto3D] = useState(
    () => getWindowViewMode() === VIEW_MODES.MODE_3D
  )
  const [cameraMode, setCameraMode] = useState(CAMERA_MODES.FIRST_PERSON)
  const [viewportFallbackReason, setViewportFallbackReason] = useState(null)
  const viewportEngineRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handlePopState = () => {
      const urlMode = getWindowViewMode()
      setViewMode(urlMode)
      if (urlMode === VIEW_MODES.MODE_3D) {
        setHasOptedInto3D(true)
        setViewportFallbackReason(null)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  const is3DPreviewActive =
    viewMode === VIEW_MODES.MODE_3D && !viewportFallbackReason

  const handleMove = useCallback((direction) => {
    dispatch({ type: 'MOVE', direction })
  }, [])

  const handleActivateAbility = useCallback((abilityType) => {
    dispatch({ type: 'ACTIVATE_ABILITY', abilityType })
  }, [])

  const handlePlayerCellChange = useCallback((cell, meta = {}) => {
    if (!cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.col)) {
      return
    }
    dispatch({
      type: 'SYNC_PLAYER_CELL',
      position: { row: cell.row, col: cell.col },
      direction: meta.direction,
      countMove: meta.countMove !== false,
      usedWallPass: Boolean(meta.usedWallPass),
      passedWall: meta.passedWall || null,
    })
  }, [])

  const handleRestart = useCallback(() => {
    dispatch({ type: 'RESET_RUN' })
    viewportEngineRef.current?.resetCombat()
    const start = gameState.maze?.start
    if (start) {
      viewportEngineRef.current?.setPlayerGridPosition(start.row, start.col, {
        immediate: true,
      })
    }
  }, [gameState.maze])

  const handleNewMaze = useCallback(() => {
    dispatch({ type: 'NEW_MAZE' })
    viewportEngineRef.current?.resetCombat()
  }, [])

  const handlePlayerDamage = useCallback((damageEvent) => {
    dispatch({
      type: 'DAMAGE_PLAYER',
      damage: damageEvent?.damage,
      enemyId: damageEvent?.enemyId,
    })
  }, [])

  const handleViewportReadyInternal = useCallback(
    (ctx) => {
      viewportEngineRef.current = ctx?.engine || null
      const userCleanup = onViewportReady?.(ctx)
      return () => {
        if (typeof userCleanup === 'function') {
          userCleanup()
        }
        if (viewportEngineRef.current === ctx?.engine) {
          viewportEngineRef.current = null
        }
      }
    },
    [onViewportReady]
  )

  const handleViewportError = useCallback((error) => {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'WebGL 3D viewport could not be initialized.'
    setViewportFallbackReason(message)
  }, [])

  const handleSwitchTo2D = useCallback(() => {
    setViewMode(VIEW_MODES.MODE_2D)
    setViewportFallbackReason(null)
    syncViewQueryParam(VIEW_MODES.MODE_2D)
  }, [])

  const handleSwitchTo3D = useCallback(() => {
    setViewMode(VIEW_MODES.MODE_3D)
    setHasOptedInto3D(true)
    setViewportFallbackReason(null)
    syncViewQueryParam(VIEW_MODES.MODE_3D)
  }, [])

  const resolvedEngineConfig = useMemo(
    () => ({
      ...(viewportEngineConfig || {}),
      camera: {
        mode: cameraMode,
        ...(viewportEngineConfig?.camera || {}),
      },
    }),
    [cameraMode, viewportEngineConfig]
  )

  const runInteractive =
    !gameState.hasWon && !gameState.isGameOver && !isInfoOpen
  const controlsEnabled2D = runInteractive && !is3DPreviewActive
  const controlsEnabled3D = runInteractive && is3DPreviewActive

  useKeyboardControls({
    enabled: controlsEnabled2D,
    onMove: handleMove,
    onActivateAbility: handleActivateAbility,
  })

  // Drive active temporary ability countdowns (Echo Reveal / Coin Magnet)
  const hasTimedAbility =
    gameState.activeEffects.echoRevealRemainingMs > 0 ||
    gameState.activeEffects.magnetRemainingMs > 0

  useEffect(() => {
    if (!hasTimedAbility || !runInteractive) return undefined

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
  }, [hasTimedAbility, runInteractive])

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
    isGameOver,
    health,
    maxHealth,
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
          disabled={!runInteractive}
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
              disabled={is3DPreviewActive}
              aria-pressed={showSolutionPath}
              title={
                is3DPreviewActive
                  ? 'BFS path overlay is available in 2D mode before Phase C'
                  : undefined
              }
              onClick={() => setShowSolutionPath((prev) => !prev)}
            >
              {showSolutionPath ? 'Hide BFS Path' : 'Show BFS Path'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRestart}
            >
              Restart
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleNewMaze}
            >
              New Maze
            </Button>
            {hasOptedInto3D && !is3DPreviewActive ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSwitchTo3D}
              >
                3D Preview
              </Button>
            ) : null}
          </div>
        </section>

        {/* Visual Maze Viewport (Default 2D Board or Opt-In 3D Preview) */}
        <section
          className="maze-arena"
          aria-label={
            is3DPreviewActive ? '3D maze preview viewport' : 'Interactive maze board'
          }
        >
          {viewportFallbackReason ? (
            <div className="maze-fallback-notice" role="status">
              <span>
                3D viewport unavailable ({viewportFallbackReason}). Returned to 2D
                game mode.
              </span>
              <div className="maze-fallback-notice__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSwitchTo3D}
                >
                  Retry 3D
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setViewportFallbackReason(null)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}

          {is3DPreviewActive ? (
            <>
              <div className="maze-preview-bar" aria-label="3D preview controls">
                <div className="maze-preview-bar__group">
                  <span className="maze-preview-badge">
                    3D Mode · Active
                  </span>
                  <Button
                    variant={
                      cameraMode === CAMERA_MODES.FIRST_PERSON
                        ? 'primary'
                        : 'secondary'
                    }
                    size="sm"
                    aria-pressed={cameraMode === CAMERA_MODES.FIRST_PERSON}
                    onClick={() => setCameraMode(CAMERA_MODES.FIRST_PERSON)}
                  >
                    First-Person
                  </Button>
                  <Button
                    variant={
                      cameraMode === CAMERA_MODES.THIRD_PERSON
                        ? 'primary'
                        : 'secondary'
                    }
                    size="sm"
                    aria-pressed={cameraMode === CAMERA_MODES.THIRD_PERSON}
                    onClick={() => setCameraMode(CAMERA_MODES.THIRD_PERSON)}
                  >
                    Third-Person
                  </Button>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSwitchTo2D}
                >
                  Switch to 2D
                </Button>
              </div>

              <Viewport3DErrorBoundary onError={handleViewportError}>
                <MazeViewport3D
                  maze={maze}
                  playerCell={playerPos}
                  coins={coins}
                  powerUps={powerUps}
                  echoPath={echoPath}
                  showSolutionPath={showSolutionPath}
                  inventory={inventory}
                  activeEffects={activeEffects}
                  hasWon={hasWon}
                  health={health}
                  maxHealth={maxHealth}
                  isGameOver={isGameOver}
                  controlsEnabled={controlsEnabled3D}
                  cameraMode={cameraMode}
                  engineConfig={resolvedEngineConfig}
                  onPlayerCellChange={handlePlayerCellChange}
                  onActivateAbility={handleActivateAbility}
                  onPlayerDamage={handlePlayerDamage}
                  onViewportReady={handleViewportReadyInternal}
                  onViewportError={handleViewportError}
                />
              </Viewport3DErrorBoundary>

              <p className="maze-controls-hint">
                Move: WASD / Arrows · Sprint: Shift · Drag: Look · Phase: Space
                · Echo: E · Magnet: Q
              </p>
            </>
          ) : (
            <>
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
            </>
          )}
        </section>
      </main>

      {/* Victory Modal */}
      <Modal
        isOpen={hasWon}
        onClose={handleRestart}
        title="Maze Escaped"
        subtitle={`${maze.difficultyLabel} · ${maze.rows}×${maze.cols} · Seed #${maze.seed}`}
        size="sm"
        showCloseButton={false}
        closeOnBackdrop={false}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={handleRestart}
            >
              Replay Maze
            </Button>
            <Button
              variant="primary"
              onClick={handleNewMaze}
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

      {/* Game Over Modal */}
      <Modal
        isOpen={isGameOver}
        onClose={handleRestart}
        title="Vault Breached"
        subtitle={`Eliminated by Sub-Level Stalker · ${maze.difficultyLabel}`}
        size="sm"
        showCloseButton={false}
        closeOnBackdrop={false}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={handleRestart}
            >
              Try Again
            </Button>
            <Button
              variant="primary"
              onClick={handleNewMaze}
            >
              New Maze
            </Button>
          </>
        }
      >
        <p>A bio-mechanical stalker caught you in the corridors and terminated the breach.</p>
        <div className="maze-victory-stats">
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Moves Survived</span>
            <span className="maze-victory-stat__value">
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
