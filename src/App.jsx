import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Button from './components/common/Button'
import Modal from './components/common/Modal'
import StarRating from './components/common/StarRating'
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
import { formatElapsedTime } from './game/mechanics/runTimer.js'
import {
  buildGameOverSummary,
  calculateRunScore,
  resolveVictorySummary,
} from './game/mechanics/scoring.js'
import {
  CAMERA_MODES,
  HORROR_INTENSITY_LEVELS,
} from './game/three/threeConfig.js'
import { useKeyboardControls } from './hooks/useKeyboardControls.js'
import { useRunTimer } from './hooks/useRunTimer.js'
import {
  clearRecords,
  loadPreferences,
  loadRecords,
  savePersonalBest,
  savePreferences,
  TOUCH_CONTROL_MODES,
} from './utils/persistence.js'
import {
  VIEW_MODES,
  getWindowViewMode,
  syncViewQueryParam,
} from './utils/viewMode.js'

const MazeViewport3D = lazy(() => import('./components/game/MazeViewport3D'))

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
    () =>
      createInitialGameState(undefined, undefined, {
        objectivesEnabled: getWindowViewMode() === VIEW_MODES.MODE_3D,
      })
  )
  const [showSolutionPath, setShowSolutionPath] = useState(false)
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [isRecordsOpen, setIsRecordsOpen] = useState(false)
  const [viewMode, setViewMode] = useState(getWindowViewMode)
  const [preferences, setPreferences] = useState(() => loadPreferences())
  const [records, setRecords] = useState(() => loadRecords())
  const [victorySummary, setVictorySummary] = useState(null)
  const [gameOverSummary, setGameOverSummary] = useState(null)
  const [isAudioMixerOpen, setIsAudioMixerOpen] = useState(false)
  const [viewportFallbackReason, setViewportFallbackReason] = useState(null)
  const viewportEngineRef = useRef(null)
  const gameStateRef = useRef(gameState)

  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    savePreferences(preferences)
  }, [preferences])

  const { cameraMode, audioVolumes, horrorConfig, controlSettings } = preferences

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handlePopState = () => {
      const urlMode = getWindowViewMode()
      setViewMode(urlMode)
      if (urlMode === VIEW_MODES.MODE_3D) {
        setViewportFallbackReason(null)
      } else {
        setIsAudioMixerOpen(false)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  const is3DPreviewActive =
    viewMode === VIEW_MODES.MODE_3D && !viewportFallbackReason

  useEffect(() => {
    dispatch({
      type: 'SET_OBJECTIVES_ENABLED',
      enabled: is3DPreviewActive,
    })
  }, [is3DPreviewActive])

  const handleVictoryTime = useCallback((completionTimeMs, targetRunId) => {
    const gs = gameStateRef.current
    if (!gs || !gs.hasWon) return

    const scored = calculateRunScore({
      difficulty: gs.difficulty,
      maze: gs.maze,
      completionTimeMs,
      moves: gs.moves,
      coinsCollected: gs.coinsCollected,
      totalCoins: gs.totalCoins,
      health: gs.health,
      maxHealth: gs.maxHealth,
      keysCollected: gs.keysCollected,
      totalKeys: gs.totalKeys,
      objectivesEnabled: gs.objectivesEnabled,
    })

    const savedResult = savePersonalBest(gs.difficulty, {
      timeMs: completionTimeMs,
      score: scored.score,
      stars: scored.stars,
    })

    setRecords(savedResult.records)
    setVictorySummary({
      runId: targetRunId,
      ...scored,
      record: savedResult.record,
      isNewBestTime: savedResult.isNewBestTime,
      isNewBestScore: savedResult.isNewBestScore,
      isNewBestStars: savedResult.isNewBestStars,
    })
  }, [])

  const handleGameOverTime = useCallback((survivalTimeMs, targetRunId) => {
    const gs = gameStateRef.current
    if (!gs || !gs.isGameOver) return

    setGameOverSummary(
      buildGameOverSummary({
        runId: targetRunId,
        survivalTimeMs,
        moves: gs.moves,
        coinsCollected: gs.coinsCollected,
        totalCoins: gs.totalCoins,
        keysCollected: gs.keysCollected,
        totalKeys: gs.totalKeys,
        objectivesEnabled: gs.objectivesEnabled,
      })
    )
  }, [])

  const isMenuModalOpen = isInfoOpen || isRecordsOpen
  const isPauseOverlayOpen =
    isMenuModalOpen || (is3DPreviewActive && isAudioMixerOpen)
  const runInteractive =
    !gameState.hasWon && !gameState.isGameOver && !isPauseOverlayOpen

  const { timeDisplayRef } = useRunTimer({
    resetKey: gameState.runId,
    isPaused: isPauseOverlayOpen,
    hasWon: gameState.hasWon,
    isGameOver: gameState.isGameOver,
    onVictoryTime: handleVictoryTime,
    onGameOverTime: handleGameOverTime,
  })

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
    setVictorySummary(null)
    setGameOverSummary(null)
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
    setVictorySummary(null)
    setGameOverSummary(null)
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
    setIsAudioMixerOpen(false)
    setViewportFallbackReason(null)
    syncViewQueryParam(VIEW_MODES.MODE_2D)
  }, [])

  const handleSwitchTo3D = useCallback(() => {
    setViewMode(VIEW_MODES.MODE_3D)
    setViewportFallbackReason(null)
    syncViewQueryParam(VIEW_MODES.MODE_3D)
  }, [])

  const handleSetCameraMode = useCallback((nextMode) => {
    setPreferences((prev) => ({
      ...prev,
      cameraMode: nextMode,
    }))
  }, [])

  const handleVolumeChange = useCallback((channel, nextValue) => {
    viewportEngineRef.current?.unlockAudio()
    setPreferences((prev) => ({
      ...prev,
      audioVolumes: {
        ...prev.audioVolumes,
        [channel]:
          channel === 'muted'
            ? Boolean(nextValue)
            : Math.max(0, Math.min(1, Number(nextValue) || 0)),
      },
    }))
  }, [])

  const handleToggleMute = useCallback(() => {
    viewportEngineRef.current?.unlockAudio()
    setPreferences((prev) => ({
      ...prev,
      audioVolumes: {
        ...prev.audioVolumes,
        muted: !prev.audioVolumes.muted,
      },
    }))
  }, [])

  const handleUpdateHorrorConfig = useCallback((updater) => {
    setPreferences((prev) => ({
      ...prev,
      horrorConfig:
        typeof updater === 'function'
          ? updater(prev.horrorConfig)
          : { ...prev.horrorConfig, ...updater },
    }))
  }, [])

  const handleUpdateControlSettings = useCallback((patch) => {
    setPreferences((prev) => ({
      ...prev,
      controlSettings: {
        ...prev.controlSettings,
        ...patch,
      },
    }))
  }, [])

  const handleClearRecords = useCallback(() => {
    setRecords(clearRecords())
  }, [])

  const resolvedEngineConfig = useMemo(
    () => ({
      mouseSensitivity: controlSettings.mouseSensitivity,
      touchLookSensitivity: controlSettings.touchLookSensitivity,
      invertY: controlSettings.invertY,
      touchControls: controlSettings.touchControls,
      ...(viewportEngineConfig || {}),
      camera: {
        mode: cameraMode,
        sensitivity: controlSettings.mouseSensitivity,
        invertY: controlSettings.invertY,
        ...(viewportEngineConfig?.camera || {}),
      },
      audio: {
        ...(viewportEngineConfig?.audio || {}),
        volumes: audioVolumes,
      },
      horrorDirector: {
        ...horrorConfig,
        ...(viewportEngineConfig?.horrorDirector || {}),
      },
    }),
    [audioVolumes, cameraMode, controlSettings, horrorConfig, viewportEngineConfig]
  )

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
    runId,
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
    objectivesEnabled,
    keycards,
    totalKeys,
    keysCollected,
    isExitLocked,
    inventory,
    activeEffects,
    echoPath,
    effects,
  } = gameState

  const currentRecord = records[difficulty] || null
  const activeVictory = resolveVictorySummary(victorySummary, runId, hasWon)
  const activeGameOver =
    isGameOver && gameOverSummary?.runId === runId
      ? gameOverSummary
      : isGameOver
        ? buildGameOverSummary({
            runId,
            survivalTimeMs: 0,
            moves,
            coinsCollected,
            totalCoins,
            keysCollected,
            totalKeys,
            objectivesEnabled,
          })
        : null

  const hasAnySavedRecord = DIFFICULTY_ORDER.some((key) => Boolean(records[key]))
  const sensitivityMultiplier = Number(
    (controlSettings.mouseSensitivity / 0.0022).toFixed(2)
  )

  return (
    <GameShell
      layout="viewport"
      reducedMotion={Boolean(horrorConfig.reducedMotion)}
    >
      <ScreenHeader
        as="h1"
        eyebrow={`Lumen Vault · ${maze.tierName}`}
        title="Maze Escape"
        rightActions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsRecordsOpen(true)}
            >
              Records
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsInfoOpen(true)}
            >
              Maze Info
            </Button>
          </>
        }
      />

      <main className="gameplay-stage">
        <GameHUD
          maze={maze}
          moves={moves}
          coinsCollected={coinsCollected}
          totalCoins={totalCoins}
          keysCollected={keysCollected}
          totalKeys={totalKeys}
          isExitLocked={isExitLocked}
          objectivesEnabled={objectivesEnabled}
          inventory={inventory}
          activeEffects={activeEffects}
          timeDisplayRef={timeDisplayRef}
          bestTimeMs={currentRecord?.bestTimeMs ?? null}
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
                  onClick={() => {
                    setVictorySummary(null)
                    setGameOverSummary(null)
                    dispatch({ type: 'SET_DIFFICULTY', difficulty: key })
                  }}
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
                  ? 'BFS path overlay is available in 2D mode (use Wayfinder Hints in 3D)'
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
            {!is3DPreviewActive ? (
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
                    onClick={() => handleSetCameraMode(CAMERA_MODES.FIRST_PERSON)}
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
                    onClick={() => handleSetCameraMode(CAMERA_MODES.THIRD_PERSON)}
                  >
                    Third-Person
                  </Button>
                </div>

                <div className="maze-preview-bar__group">
                  <Button
                    variant={audioVolumes.muted ? 'secondary' : 'primary'}
                    size="sm"
                    aria-pressed={audioVolumes.muted}
                    onClick={handleToggleMute}
                  >
                    {audioVolumes.muted ? 'Audio Muted' : 'Audio On'}
                  </Button>
                  <Button
                    variant={isAudioMixerOpen ? 'primary' : 'secondary'}
                    size="sm"
                    aria-expanded={isAudioMixerOpen}
                    onClick={() => {
                      viewportEngineRef.current?.unlockAudio()
                      setIsAudioMixerOpen((prev) => !prev)
                    }}
                  >
                    Mixer
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSwitchTo2D}
                  >
                    Switch to 2D
                  </Button>
                </div>
              </div>

              {isAudioMixerOpen ? (
                <div className="maze-audio-panel" role="group" aria-label="3D horror audio, scare director, and control settings">
                  <div className="maze-audio-mixer">
                    {[
                      { key: 'master', label: 'Master' },
                      { key: 'ambience', label: 'Ambience' },
                      { key: 'effects', label: 'Effects' },
                      { key: 'music', label: 'Music' },
                    ].map(({ key, label }) => {
                      const pct = Math.round((audioVolumes[key] ?? 0) * 100)
                      return (
                        <label key={key} className="maze-audio-mixer__channel">
                          <span className="maze-audio-mixer__meta">
                            <span className="maze-audio-mixer__label">{label}</span>
                            <span className="maze-audio-mixer__value">{pct}%</span>
                          </span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={audioVolumes[key] ?? 0}
                            aria-label={`${label} volume`}
                            className="maze-audio-mixer__slider"
                            onChange={(e) => handleVolumeChange(key, e.target.value)}
                          />
                        </label>
                      )
                    })}
                  </div>

                  <div className="maze-horror-controls">
                    <div className="maze-horror-controls__group" role="group" aria-label="Scare Director intensity">
                      <span className="maze-horror-controls__title">Scare Intensity</span>
                      {[
                        { key: HORROR_INTENSITY_LEVELS.OFF, label: 'Off' },
                        { key: HORROR_INTENSITY_LEVELS.LOW, label: 'Low' },
                        { key: HORROR_INTENSITY_LEVELS.MEDIUM, label: 'Med' },
                        { key: HORROR_INTENSITY_LEVELS.HIGH, label: 'High' },
                      ].map(({ key, label }) => (
                        <Button
                          key={key}
                          variant={horrorConfig.intensity === key ? 'primary' : 'secondary'}
                          size="sm"
                          aria-pressed={horrorConfig.intensity === key}
                          onClick={() =>
                            handleUpdateHorrorConfig((prev) => ({
                              ...prev,
                              intensity: key,
                            }))
                          }
                        >
                          {label}
                        </Button>
                      ))}
                    </div>

                    <div className="maze-horror-controls__group">
                      <Button
                        variant={horrorConfig.visualScaresEnabled ? 'primary' : 'secondary'}
                        size="sm"
                        aria-pressed={horrorConfig.visualScaresEnabled}
                        onClick={() =>
                          handleUpdateHorrorConfig((prev) => ({
                            ...prev,
                            visualScaresEnabled: !prev.visualScaresEnabled,
                          }))
                        }
                      >
                        Visual Scares: {horrorConfig.visualScaresEnabled ? 'On' : 'Off'}
                      </Button>
                      <Button
                        variant={horrorConfig.reducedMotion ? 'primary' : 'secondary'}
                        size="sm"
                        aria-pressed={horrorConfig.reducedMotion}
                        onClick={() =>
                          handleUpdateHorrorConfig((prev) => ({
                            ...prev,
                            reducedMotion: !prev.reducedMotion,
                          }))
                        }
                      >
                        Reduced Motion: {horrorConfig.reducedMotion ? 'On' : 'Off'}
                      </Button>
                    </div>
                  </div>

                  <div className="maze-control-settings" role="group" aria-label="Look and touch control preferences">
                    <label className="maze-audio-mixer__channel maze-control-settings__slider-wrap">
                      <span className="maze-audio-mixer__meta">
                        <span className="maze-audio-mixer__label">Mouse Sensitivity</span>
                        <span className="maze-audio-mixer__value">
                          {Math.round(sensitivityMultiplier * 100)}%
                        </span>
                      </span>
                      <input
                        type="range"
                        min="0.4"
                        max="2.5"
                        step="0.1"
                        value={sensitivityMultiplier}
                        aria-label="Mouse sensitivity"
                        className="maze-audio-mixer__slider"
                        onChange={(e) => {
                          const scale = Number(e.target.value) || 1
                          handleUpdateControlSettings({
                            mouseSensitivity: Number((0.0022 * scale).toFixed(5)),
                            touchLookSensitivity: Number((1.8 * scale).toFixed(2)),
                          })
                        }}
                      />
                    </label>

                    <div className="maze-horror-controls__group">
                      <Button
                        variant={controlSettings.invertY ? 'primary' : 'secondary'}
                        size="sm"
                        aria-pressed={controlSettings.invertY}
                        onClick={() =>
                          handleUpdateControlSettings({
                            invertY: !controlSettings.invertY,
                          })
                        }
                      >
                        Invert Y: {controlSettings.invertY ? 'On' : 'Off'}
                      </Button>
                    </div>

                    <div className="maze-horror-controls__group" role="group" aria-label="Touch controls visibility">
                      <span className="maze-horror-controls__title">Touch Pad</span>
                      {TOUCH_CONTROL_MODES.map((mode) => (
                        <Button
                          key={mode}
                          variant={
                            controlSettings.touchControls === mode ? 'primary' : 'secondary'
                          }
                          size="sm"
                          aria-pressed={controlSettings.touchControls === mode}
                          onClick={() =>
                            handleUpdateControlSettings({ touchControls: mode })
                          }
                        >
                          {mode === 'auto'
                            ? 'Auto'
                            : mode === 'always'
                              ? 'Always'
                              : 'Off'}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <Viewport3DErrorBoundary onError={handleViewportError}>
                <Suspense
                  fallback={
                    <div
                      className="maze-viewport-3d maze-viewport-3d--loading"
                      role="status"
                      aria-live="polite"
                    >
                      Initializing 3D Labyrinth...
                    </div>
                  }
                >
                  <MazeViewport3D
                    maze={maze}
                    runId={runId}
                    playerCell={playerPos}
                    coins={coins}
                    powerUps={powerUps}
                    keycards={keycards}
                    keysCollected={keysCollected}
                    totalKeys={totalKeys}
                    isExitLocked={isExitLocked}
                    objectivesEnabled={objectivesEnabled}
                    echoPath={echoPath}
                    showSolutionPath={showSolutionPath}
                    inventory={inventory}
                    activeEffects={activeEffects}
                    lastEvent={gameState.lastEvent}
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
                </Suspense>
              </Viewport3DErrorBoundary>

              <p className="maze-controls-hint">
                Move: WASD / Arrows · Sprint: Shift · Flashlight: L · Map: M · Hint: H · Hide: F · Phase: Space
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
        isOpen={hasWon && Boolean(activeVictory)}
        title="Maze Escaped"
        subtitle={`${maze.difficultyLabel} · ${maze.rows}×${maze.cols} · Seed #${maze.seed}`}
        size="sm"
        showCloseButton={false}
        closeOnBackdrop={false}
        closeOnEscape={false}
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
        {activeVictory ? (
          <div className="maze-victory-rating">
            <StarRating
              rating={activeVictory.stars}
              max={3}
              size="lg"
              label={`Run rating: ${activeVictory.stars} out of 3 stars`}
            />
            <div className="maze-victory-badges">
              {activeVictory.isNewBestScore ? (
                <span className="maze-victory-badge maze-victory-badge--gold">
                  New High Score
                </span>
              ) : null}
              {activeVictory.isNewBestTime ? (
                <span className="maze-victory-badge maze-victory-badge--cyan">
                  Fastest Time
                </span>
              ) : null}
              {activeVictory.beatPar ? (
                <span className="maze-victory-badge maze-victory-badge--emerald">
                  Under Par Time
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <p>You reached the Resonance Exit Gate and cleared the chamber.</p>

        {activeVictory ? (
          <>
            <div className="maze-victory-stats">
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">Final Score</span>
                <span className="maze-victory-stat__value maze-victory-stat__value--accent">
                  {activeVictory.score.toLocaleString()}
                </span>
              </div>
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">Completion Time</span>
                <span className="maze-victory-stat__value">
                  {formatElapsedTime(activeVictory.completionTimeMs)}
                </span>
              </div>
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">Coins Collected</span>
                <span className="maze-victory-stat__value">
                  {coinsCollected} / {totalCoins}
                </span>
              </div>
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">
                  {objectivesEnabled && totalKeys > 0 ? 'Keycards' : 'Moves Taken'}
                </span>
                <span className="maze-victory-stat__value">
                  {objectivesEnabled && totalKeys > 0
                    ? `${keysCollected} / ${totalKeys}`
                    : moves}
                </span>
              </div>
            </div>

            <div className="maze-victory-breakdown">
              <span>Base {activeVictory.breakdown.baseScore}</span>
              <span>Time +{activeVictory.breakdown.timeBonus}</span>
              <span>Coins +{activeVictory.breakdown.coinBonus}</span>
              <span>Health +{activeVictory.breakdown.healthBonus}</span>
              {activeVictory.breakdown.keycardBonus > 0 ? (
                <span>Keys +{activeVictory.breakdown.keycardBonus}</span>
              ) : null}
            </div>

            {currentRecord ? (
              <p className="maze-victory-record">
                <strong>{maze.difficultyLabel} Best:</strong>{' '}
                {currentRecord.bestTimeMs != null
                  ? formatElapsedTime(currentRecord.bestTimeMs)
                  : '—'}{' '}
                · {currentRecord.bestScore.toLocaleString()} pts ({currentRecord.bestStars}/3★)
              </p>
            ) : null}
          </>
        ) : null}
      </Modal>

      {/* Game Over Modal */}
      <Modal
        isOpen={isGameOver}
        title="Vault Breached"
        subtitle={`Eliminated by Sub-Level Stalker · ${maze.difficultyLabel}`}
        size="sm"
        showCloseButton={false}
        closeOnBackdrop={false}
        closeOnEscape={false}
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
        {activeGameOver ? (
          <div className="maze-victory-stats">
            <div className="maze-victory-stat">
              <span className="maze-victory-stat__label">Survival Time</span>
              <span className="maze-victory-stat__value maze-victory-stat__value--accent">
                {formatElapsedTime(activeGameOver.survivalTimeMs)}
              </span>
            </div>
            <div className="maze-victory-stat">
              <span className="maze-victory-stat__label">Moves Survived</span>
              <span className="maze-victory-stat__value">
                {activeGameOver.moves}
              </span>
            </div>
            <div className="maze-victory-stat">
              <span className="maze-victory-stat__label">Coins Collected</span>
              <span className="maze-victory-stat__value">
                {activeGameOver.coinsCollected} / {activeGameOver.totalCoins}
              </span>
            </div>
            {activeGameOver.objectivesEnabled && activeGameOver.totalKeys > 0 ? (
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">Keycards Collected</span>
                <span className="maze-victory-stat__value">
                  {activeGameOver.keysCollected} / {activeGameOver.totalKeys}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Personal Records Modal */}
      <Modal
        isOpen={isRecordsOpen}
        onClose={() => setIsRecordsOpen(false)}
        title="Personal Best Records"
        subtitle="Saved locally per chamber difficulty"
        size="sm"
        footer={
          <>
            {hasAnySavedRecord ? (
              <Button variant="secondary" onClick={handleClearRecords}>
                Clear Records
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setIsRecordsOpen(false)}>
              Close
            </Button>
          </>
        }
      >
        <div className="maze-records-list">
          {DIFFICULTY_ORDER.map((key) => {
            const preset = MAZE_DIFFICULTIES[key]
            const entry = records[key]
            return (
              <div key={key} className="maze-records-card">
                <div className="maze-records-card__head">
                  <div>
                    <span className="maze-records-card__title">{preset.label}</span>
                    <span className="maze-records-card__meta">
                      {preset.rows}×{preset.cols} · {entry ? `${entry.completions} cleared` : 'No clears yet'}
                    </span>
                  </div>
                  <StarRating
                    rating={entry?.bestStars || 0}
                    max={3}
                    size="sm"
                    label={`${preset.label} best rating: ${entry?.bestStars || 0} of 3 stars`}
                  />
                </div>
                <div className="maze-records-card__metrics">
                  <span>
                    Time:{' '}
                    <strong>
                      {entry?.bestTimeMs != null
                        ? formatElapsedTime(entry.bestTimeMs)
                        : '—'}
                    </strong>
                  </span>
                  <span>
                    Score:{' '}
                    <strong>
                      {entry ? entry.bestScore.toLocaleString() : '—'}
                    </strong>
                  </span>
                </div>
              </div>
            )
          })}
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
          {objectivesEnabled && totalKeys > 0
            ? ` · ${keysCollected}/${totalKeys} resonance keycards`
            : ''}
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
