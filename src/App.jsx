import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Button from './components/common/Button.jsx'
import Modal from './components/common/Modal.jsx'
import StarRating from './components/common/StarRating.jsx'
import MazeViewport3D from './components/game/MazeViewport3D.jsx'
import PauseMenuModal from './components/game/PauseMenuModal.jsx'
import GameShell from './components/layout/GameShell.jsx'
import SettingsModal from './components/settings/SettingsModal.jsx'
import { createInitialGameState, gameReducer } from './game/engine/gameReducer.js'
import { DIFFICULTY_ORDER, MAZE_DIFFICULTIES } from './game/generation/mazeConfig.js'
import { formatElapsedTime } from './game/mechanics/runTimer.js'
import {
  buildGameOverSummary,
  calculateRunScore,
  resolveVictorySummary,
} from './game/mechanics/scoring.js'
import { useRunTimer } from './hooks/useRunTimer.js'
import { triggerHapticForGameEvent } from './utils/haptics.js'
import {
  clearRecords,
  loadAllSettings,
  loadRecords,
  resetAllSettings,
  saveAllSettings,
  savePersonalBest,
} from './utils/persistence.js'

const BASE_MOUSE_SENSITIVITY = 0.0022

export default function App({
  viewportEngineConfig = null,
  onViewportReady = null,
  onGameEvent = null,
}) {
  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    createInitialGameState()
  )
  const [settings, setSettings] = useState(() => loadAllSettings())
  const [records, setRecords] = useState(() => loadRecords())

  const [isPauseOpen, setIsPauseOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isRecordsOpen, setIsRecordsOpen] = useState(false)
  const [viewportError, setViewportError] = useState(null)
  const [victorySummary, setVictorySummary] = useState(null)
  const [gameOverSummary, setGameOverSummary] = useState(null)

  const latestStateRef = useRef(state)
  useEffect(() => {
    latestStateRef.current = state
  }, [state])

  const lastNotifiedEventIdRef = useRef(null)
  useEffect(() => {
    const evt = state.lastEvent
    if (!evt || evt.id === lastNotifiedEventIdRef.current) {
      return
    }
    lastNotifiedEventIdRef.current = evt.id
    triggerHapticForGameEvent(evt, {
      enabled: settings.controls.touchHaptics,
    })
    onGameEvent?.(evt)
  }, [state.lastEvent, settings.controls.touchHaptics, onGameEvent])

  const isMenuModalOpen = isPauseOpen || isSettingsOpen || isRecordsOpen
  const isAnyModalOpen = isMenuModalOpen || state.hasWon || state.isGameOver
  const controlsEnabled = !isAnyModalOpen && !viewportError
  const audioPaused = isMenuModalOpen

  const handleVictoryTime = useCallback((completionTimeMs, targetRunId) => {
    const current = latestStateRef.current
    const scored = calculateRunScore({
      difficulty: current.difficulty,
      maze: current.maze,
      completionTimeMs,
      coinsCollected: current.coinsCollected,
      totalCoins: current.totalCoins,
      health: current.health,
      maxHealth: current.maxHealth,
      keysCollected: current.keysCollected,
      totalKeys: current.totalKeys,
      objectivesEnabled: current.objectivesEnabled,
      moves: current.moves,
    })

    const savedResult = savePersonalBest(current.difficulty, {
      timeMs: completionTimeMs,
      score: scored.score,
      stars: scored.stars,
    })

    setRecords(savedResult.records)
    setVictorySummary({
      ...scored,
      runId: targetRunId,
      record: savedResult.record,
      isNewBestTime: savedResult.isNewBestTime,
      isNewBestScore: savedResult.isNewBestScore,
      isNewBestStars: savedResult.isNewBestStars,
    })
  }, [])

  const handleGameOverTime = useCallback((survivalTimeMs, targetRunId) => {
    const current = latestStateRef.current
    const summary = buildGameOverSummary({
      runId: targetRunId,
      survivalTimeMs,
      moves: current.moves,
      coinsCollected: current.coinsCollected,
      totalCoins: current.totalCoins,
      keysCollected: current.keysCollected,
      totalKeys: current.totalKeys,
      objectivesEnabled: current.objectivesEnabled,
    })
    setGameOverSummary(summary)
  }, [])

  const { timeDisplayRef, getFormattedTime } = useRunTimer({
    resetKey: state.runId,
    isPaused: isMenuModalOpen,
    hasWon: state.hasWon,
    isGameOver: state.isGameOver,
    onVictoryTime: handleVictoryTime,
    onGameOverTime: handleGameOverTime,
  })

  // Count down active timed power-up abilities while gameplay is active
  const hasTimedAbilities =
    (state.activeEffects?.echoRevealRemainingMs || 0) > 0 ||
    (state.activeEffects?.magnetRemainingMs || 0) > 0

  useEffect(() => {
    if (!hasTimedAbilities || isAnyModalOpen) {
      return undefined
    }
    let lastTick = performance.now()
    const intervalId = window.setInterval(() => {
      const now = performance.now()
      const deltaMs = now - lastTick
      lastTick = now
      if (deltaMs > 0) {
        dispatch({ type: 'TICK_ABILITIES', deltaMs })
      }
    }, 100)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [hasTimedAbilities, isAnyModalOpen])

  // Global Pause shortcut (P)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleKeyDown = (event) => {
      if (!event || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const tag = event.target?.tagName?.toLowerCase?.()
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        event.target?.isContentEditable
      ) {
        return
      }

      const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''
      if (key !== 'p') return
      if (state.hasWon || state.isGameOver) return

      event.preventDefault?.()
      if (isSettingsOpen || isRecordsOpen) {
        setIsSettingsOpen(false)
        setIsRecordsOpen(false)
        setIsPauseOpen(true)
        return
      }
      setIsPauseOpen((prev) => !prev)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [state.hasWon, state.isGameOver, isSettingsOpen, isRecordsOpen])

  const updateSettings = useCallback((updater) => {
    setSettings((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveAllSettings(next)
      return next
    })
  }, [])

  const handleAudioSettingChange = useCallback(
    (id, val) => {
      updateSettings((prev) => {
        const nextAudio = { ...prev.audio }
        if (id === 'masterVolume') nextAudio.master = Number(val) / 100
        else if (id === 'ambienceVolume') nextAudio.ambience = Number(val) / 100
        else if (id === 'effectsVolume') nextAudio.effects = Number(val) / 100
        else if (id === 'musicVolume') nextAudio.music = Number(val) / 100
        else if (id === 'muted') nextAudio.muted = Boolean(val)
        else if (id === 'spatialAudio') nextAudio.spatialAudio = Boolean(val)
        else if (id === 'footstepEchoes') nextAudio.footstepEchoes = Boolean(val)
        return { ...prev, audio: nextAudio }
      })
    },
    [updateSettings]
  )

  const handleControlSettingChange = useCallback(
    (id, val) => {
      updateSettings((prev) => {
        const nextControls = { ...prev.controls }
        if (id === 'mouseSensitivity') {
          nextControls.mouseSensitivity = Number(
            ((Number(val) / 100) * BASE_MOUSE_SENSITIVITY).toFixed(6)
          )
        } else if (id === 'touchLookSensitivity') {
          nextControls.touchLookSensitivity = Number((Number(val) / 100).toFixed(4))
        } else if (id === 'invertY') {
          nextControls.invertY = Boolean(val)
        } else if (id === 'touchControlsMode') {
          nextControls.touchControls = val
        } else if (id === 'touchHaptics') {
          nextControls.touchHaptics = Boolean(val)
        }
        return { ...prev, controls: nextControls }
      })
    },
    [updateSettings]
  )

  const handleGraphicsSettingChange = useCallback(
    (id, val) => {
      updateSettings((prev) => ({
        ...prev,
        graphics: {
          ...prev.graphics,
          [id]: val,
        },
      }))
    },
    [updateSettings]
  )

  const handleGameplaySettingChange = useCallback(
    (id, val) => {
      if (id === 'difficulty') {
        dispatch({ type: 'SET_DIFFICULTY', difficulty: val })
        return
      }
      updateSettings((prev) => {
        const nextGameplay = { ...prev.gameplay }
        if (id === 'defaultCamera') nextGameplay.cameraMode = val
        else if (id === 'thirdPersonCameraMode') nextGameplay.thirdPersonCameraMode = val
        else if (id === 'fieldOfView') nextGameplay.fieldOfView = Number(val)
        else if (id === 'cameraShake') nextGameplay.cameraShake = Boolean(val)
        else if (id === 'scareIntensity') nextGameplay.scareIntensity = val
        else if (id === 'visualScares') nextGameplay.visualScaresEnabled = Boolean(val)
        else if (id === 'reducedMotion') nextGameplay.reducedMotion = Boolean(val)
        else if (id === 'wayfinderGuide') nextGameplay.wayfinderGuide = Boolean(val)
        return { ...prev, gameplay: nextGameplay }
      })
    },
    [updateSettings]
  )

  const handleRestoreDefaults = useCallback(() => {
    const result = resetAllSettings()
    setSettings(result.settings)
  }, [])

  const handlePlayerCellChange = useCallback((cell, meta) => {
    if (!cell) return
    dispatch({
      type: 'SYNC_PLAYER_CELL',
      position: cell,
      direction: meta?.direction,
      usedWallPass: Boolean(meta?.usedWallPass),
      passedWall: meta?.passedWall || null,
    })
  }, [])

  const handleActivateAbility = useCallback((abilityType) => {
    dispatch({ type: 'ACTIVATE_ABILITY', abilityType })
  }, [])

  const handlePlayerDamage = useCallback((event) => {
    dispatch({
      type: 'DAMAGE_PLAYER',
      damage: event?.damage ?? 0,
      enemyId: event?.enemyId || null,
    })
  }, [])

  const handleEngineGameOver = useCallback(() => {
    if (latestStateRef.current.health > 0 && !latestStateRef.current.isGameOver) {
      dispatch({ type: 'SET_HEALTH', health: 0 })
    }
  }, [])

  const handleRestartRun = useCallback(() => {
    setVictorySummary(null)
    setGameOverSummary(null)
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    setIsRecordsOpen(false)
    dispatch({ type: 'RESET_RUN' })
  }, [])

  const handleNewMaze = useCallback(() => {
    setVictorySummary(null)
    setGameOverSummary(null)
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    setIsRecordsOpen(false)
    dispatch({ type: 'NEW_MAZE' })
  }, [])

  const handleClearRecords = useCallback(() => {
    const cleared = clearRecords()
    setRecords(cleared)
  }, [])

  const horrorConfig = useMemo(
    () => ({
      intensity: settings.gameplay.scareIntensity,
      visualScaresEnabled: settings.gameplay.visualScaresEnabled,
      reducedMotion: settings.gameplay.reducedMotion,
    }),
    [
      settings.gameplay.scareIntensity,
      settings.gameplay.visualScaresEnabled,
      settings.gameplay.reducedMotion,
    ]
  )

  const audioVolumesConfig = useMemo(
    () => ({
      master: settings.audio.master,
      ambience: settings.audio.ambience,
      effects: settings.audio.effects,
      music: settings.audio.music,
      muted: settings.audio.muted,
    }),
    [
      settings.audio.master,
      settings.audio.ambience,
      settings.audio.effects,
      settings.audio.music,
      settings.audio.muted,
    ]
  )

  const audioConfig = useMemo(
    () => ({
      ...(viewportEngineConfig?.audio || {}),
      volumes: audioVolumesConfig,
      spatialAudio: settings.audio.spatialAudio,
      footstepEchoes: settings.audio.footstepEchoes,
    }),
    [
      viewportEngineConfig?.audio,
      audioVolumesConfig,
      settings.audio.spatialAudio,
      settings.audio.footstepEchoes,
    ]
  )

  const cameraConfig = useMemo(
    () => ({
      ...(viewportEngineConfig?.camera || {}),
      mode: settings.gameplay.cameraMode,
      thirdPersonMode: settings.gameplay.thirdPersonCameraMode,
      fov: settings.gameplay.fieldOfView,
      cameraShake: settings.gameplay.cameraShake,
      sensitivity: settings.controls.mouseSensitivity,
      invertY: settings.controls.invertY,
    }),
    [
      viewportEngineConfig?.camera,
      settings.gameplay.cameraMode,
      settings.gameplay.thirdPersonCameraMode,
      settings.gameplay.fieldOfView,
      settings.gameplay.cameraShake,
      settings.controls.mouseSensitivity,
      settings.controls.invertY,
    ]
  )

  const horrorDirectorConfig = useMemo(
    () => ({
      ...(viewportEngineConfig?.horrorDirector || {}),
      intensity: horrorConfig.intensity,
      visualScaresEnabled: horrorConfig.visualScaresEnabled,
      reducedMotion: horrorConfig.reducedMotion,
    }),
    [viewportEngineConfig?.horrorDirector, horrorConfig]
  )

  const engineConfig = useMemo(
    () => ({
      ...(viewportEngineConfig || {}),
      fov: settings.gameplay.fieldOfView,
      cameraShake: settings.gameplay.cameraShake,
      mouseSensitivity: settings.controls.mouseSensitivity,
      touchLookSensitivity: settings.controls.touchLookSensitivity,
      invertY: settings.controls.invertY,
      touchControls: settings.controls.touchControls,
      touchHaptics: settings.controls.touchHaptics,
      wayfinderGuide: settings.gameplay.wayfinderGuide,
      graphics: settings.graphics,
      camera: cameraConfig,
      audio: audioConfig,
      horrorDirector: horrorDirectorConfig,
    }),
    [
      viewportEngineConfig,
      settings.gameplay.fieldOfView,
      settings.gameplay.cameraShake,
      settings.gameplay.wayfinderGuide,
      settings.controls.mouseSensitivity,
      settings.controls.touchLookSensitivity,
      settings.controls.invertY,
      settings.controls.touchControls,
      settings.controls.touchHaptics,
      settings.graphics,
      cameraConfig,
      audioConfig,
      horrorDirectorConfig,
    ]
  )

  const modalAudioSettings = useMemo(
    () => ({
      masterVolume: Math.round(settings.audio.master * 100),
      ambienceVolume: Math.round(settings.audio.ambience * 100),
      effectsVolume: Math.round(settings.audio.effects * 100),
      musicVolume: Math.round(settings.audio.music * 100),
      muted: settings.audio.muted,
      spatialAudio: settings.audio.spatialAudio,
      footstepEchoes: settings.audio.footstepEchoes,
    }),
    [settings.audio]
  )

  const modalControlSettings = useMemo(
    () => ({
      mouseSensitivity: Math.round(
        (settings.controls.mouseSensitivity / BASE_MOUSE_SENSITIVITY) * 100
      ),
      touchLookSensitivity: Math.round(settings.controls.touchLookSensitivity * 100),
      invertY: settings.controls.invertY,
      touchControlsMode: settings.controls.touchControls,
      touchHaptics: settings.controls.touchHaptics,
    }),
    [settings.controls]
  )

  const modalGameplaySettings = useMemo(
    () => ({
      defaultCamera: settings.gameplay.cameraMode,
      thirdPersonCameraMode: settings.gameplay.thirdPersonCameraMode,
      fieldOfView: settings.gameplay.fieldOfView,
      cameraShake: settings.gameplay.cameraShake,
      scareIntensity: settings.gameplay.scareIntensity,
      visualScares: settings.gameplay.visualScaresEnabled,
      reducedMotion: settings.gameplay.reducedMotion,
      wayfinderGuide: settings.gameplay.wayfinderGuide,
      difficulty: state.difficulty,
    }),
    [settings.gameplay, state.difficulty]
  )

  const currentBestRecord = records?.[state.difficulty] || null
  const activeVictorySummary = resolveVictorySummary(
    victorySummary,
    state.runId,
    state.hasWon
  )
  const activeGameOverSummary =
    state.isGameOver && gameOverSummary?.runId === state.runId
      ? gameOverSummary
      : null

  return (
    <GameShell
      layout="viewport"
      highContrast={Boolean(settings.graphics.highContrast)}
      reducedMotion={Boolean(horrorConfig.reducedMotion)}
    >
      <main className="gameplay-stage">
        <div className="maze-arena">
          {viewportError ? (
            <div className="maze-fallback-notice" role="alert">
              <span>
                Unable to initialize 3D WebGL viewport:{' '}
                {viewportError?.message || 'Graphics context unavailable.'}
              </span>
              <div className="maze-fallback-notice__actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setViewportError(null)}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <MazeViewport3D
              maze={state.maze}
              runId={state.runId}
              playerCell={state.playerPos}
              coins={state.coins}
              powerUps={state.powerUps}
              keycards={state.keycards}
              keysCollected={state.keysCollected}
              totalKeys={state.totalKeys}
              isExitLocked={state.isExitLocked}
              objectivesEnabled={state.objectivesEnabled}
              echoPath={state.echoPath}
              inventory={state.inventory}
              activeEffects={state.activeEffects}
              lastEvent={state.lastEvent}
              hasWon={state.hasWon}
              controlsEnabled={controlsEnabled}
              health={state.health}
              maxHealth={state.maxHealth}
              isGameOver={state.isGameOver}
              audioPaused={audioPaused}
              cameraMode={settings.gameplay.cameraMode}
              thirdPersonCameraMode={settings.gameplay.thirdPersonCameraMode}
              engineConfig={engineConfig}
              onPlayerCellChange={handlePlayerCellChange}
              onActivateAbility={handleActivateAbility}
              onPlayerDamage={handlePlayerDamage}
              onGameOver={handleEngineGameOver}
              onViewportReady={onViewportReady}
              onViewportError={setViewportError}
            />
          )}
        </div>
      </main>

      <PauseMenuModal
        isOpen={
          isPauseOpen &&
          !isSettingsOpen &&
          !isRecordsOpen &&
          !state.hasWon &&
          !state.isGameOver
        }
        maze={state.maze}
        moves={state.moves}
        coinsCollected={state.coinsCollected}
        totalCoins={state.totalCoins}
        keysCollected={state.keysCollected}
        totalKeys={state.totalKeys}
        isExitLocked={state.isExitLocked}
        objectivesEnabled={state.objectivesEnabled}
        inventory={state.inventory}
        activeEffects={state.activeEffects}
        timeDisplayRef={timeDisplayRef}
        bestTimeMs={currentBestRecord?.bestTimeMs ?? null}
        onResume={() => setIsPauseOpen(false)}
        onRestart={handleRestartRun}
        onNewMaze={handleNewMaze}
        onOpenSettings={() => {
          setIsPauseOpen(true)
          setIsRecordsOpen(false)
          setIsSettingsOpen(true)
        }}
        onOpenRecords={() => {
          setRecords(loadRecords())
          setIsPauseOpen(true)
          setIsSettingsOpen(false)
          setIsRecordsOpen(true)
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen && !state.hasWon && !state.isGameOver}
        onClose={() => setIsSettingsOpen(false)}
        audioSettings={modalAudioSettings}
        onAudioSettingChange={handleAudioSettingChange}
        controlSettings={modalControlSettings}
        onControlSettingChange={handleControlSettingChange}
        graphicsSettings={settings.graphics}
        onGraphicsSettingChange={handleGraphicsSettingChange}
        gameplaySettings={modalGameplaySettings}
        onGameplaySettingChange={handleGameplaySettingChange}
        onRestoreDefaults={handleRestoreDefaults}
      />

      <Modal
        isOpen={isRecordsOpen && !state.hasWon && !state.isGameOver}
        onClose={() => setIsRecordsOpen(false)}
        title="Personal Best Records"
        subtitle="Fastest escapes and highest scores across chamber tiers"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={handleClearRecords}>
              Clear Records
            </Button>
            <Button variant="primary" onClick={() => setIsRecordsOpen(false)}>
              Close
            </Button>
          </>
        }
      >
        <div className="maze-records-list">
          {DIFFICULTY_ORDER.map((diffKey) => {
            const preset = MAZE_DIFFICULTIES[diffKey]
            const entry = records?.[diffKey] || null
            return (
              <div key={diffKey} className="maze-records-card">
                <div className="maze-records-card__head">
                  <div>
                    <span className="maze-records-card__title">
                      {preset.label}
                    </span>
                    <span className="maze-records-card__meta">
                      {preset.tierName} · {preset.rows}×{preset.cols}
                    </span>
                  </div>
                  <StarRating
                    rating={entry?.bestStars || 0}
                    size="sm"
                    label={`${preset.label} best star rating: ${entry?.bestStars || 0} of 3`}
                  />
                </div>
                <div className="maze-records-card__metrics">
                  <span>
                    Best Time:{' '}
                    {entry?.bestTimeMs != null
                      ? formatElapsedTime(entry.bestTimeMs)
                      : '—'}
                  </span>
                  <span>
                    Best Score: {entry ? entry.bestScore : '—'}
                  </span>
                  <span>
                    Clears: {entry ? entry.completions : 0}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </Modal>

      <Modal
        isOpen={state.hasWon}
        onClose={handleNewMaze}
        title="Maze Escaped"
        subtitle={`${state.maze.difficultyLabel} · ${state.maze.tierName}`}
        size="md"
        showCloseButton={false}
        closeOnBackdrop={false}
        closeOnEscape={false}
        footer={
          <>
            <Button variant="secondary" onClick={handleRestartRun}>
              Replay Maze
            </Button>
            <Button variant="primary" onClick={handleNewMaze}>
              New Maze
            </Button>
          </>
        }
      >
        {activeVictorySummary ? (
          <>
            <div className="maze-victory-rating">
              <StarRating
                rating={activeVictorySummary.stars}
                size="lg"
                label={`Earned ${activeVictorySummary.stars} out of 3 stars`}
              />
              <div className="maze-victory-badges">
                {activeVictorySummary.isNewBestTime ? (
                  <span className="maze-victory-badge maze-victory-badge--cyan">
                    New Best Time
                  </span>
                ) : null}
                {activeVictorySummary.isNewBestScore ? (
                  <span className="maze-victory-badge maze-victory-badge--gold">
                    New High Score
                  </span>
                ) : null}
                {activeVictorySummary.beatPar ? (
                  <span className="maze-victory-badge maze-victory-badge--emerald">
                    Under Par
                  </span>
                ) : null}
              </div>
              <div className="maze-victory-breakdown">
                <span>Base +{activeVictorySummary.breakdown.baseScore}</span>
                <span>Time +{activeVictorySummary.breakdown.timeBonus}</span>
                <span>Coins +{activeVictorySummary.breakdown.coinBonus}</span>
                <span>Health +{activeVictorySummary.breakdown.healthBonus}</span>
                {activeVictorySummary.breakdown.keycardBonus > 0 ? (
                  <span>Keys +{activeVictorySummary.breakdown.keycardBonus}</span>
                ) : null}
              </div>
              {activeVictorySummary.record ? (
                <div className="maze-victory-record">
                  Personal Best:{' '}
                  {formatElapsedTime(activeVictorySummary.record.bestTimeMs)} ·{' '}
                  {activeVictorySummary.record.bestScore} pts
                </div>
              ) : null}
            </div>

            <div className="maze-victory-stats">
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">Completion Time</span>
                <span className="maze-victory-stat__value maze-victory-stat__value--accent">
                  {formatElapsedTime(activeVictorySummary.completionTimeMs)}
                </span>
              </div>
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">Final Score</span>
                <span className="maze-victory-stat__value">
                  {activeVictorySummary.score}
                </span>
              </div>
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">Coins</span>
                <span className="maze-victory-stat__value">
                  {state.coinsCollected} / {state.totalCoins}
                </span>
              </div>
              <div className="maze-victory-stat">
                <span className="maze-victory-stat__label">Moves / Par</span>
                <span className="maze-victory-stat__value">
                  {state.moves} / {state.maze.parMoves}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="maze-victory-stats">
            <div className="maze-victory-stat">
              <span className="maze-victory-stat__label">Completion Time</span>
              <span className="maze-victory-stat__value maze-victory-stat__value--accent">
                {getFormattedTime()}
              </span>
            </div>
            <div className="maze-victory-stat">
              <span className="maze-victory-stat__label">Moves</span>
              <span className="maze-victory-stat__value">{state.moves}</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={state.isGameOver && !state.hasWon}
        onClose={handleRestartRun}
        title="Vault Breached"
        subtitle="You succumbed inside the labyrinth"
        size="md"
        showCloseButton={false}
        closeOnBackdrop={false}
        closeOnEscape={false}
        footer={
          <>
            <Button variant="secondary" onClick={handleNewMaze}>
              New Maze
            </Button>
            <Button variant="primary" onClick={handleRestartRun}>
              Try Again
            </Button>
          </>
        }
      >
        <div className="maze-victory-stats">
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Survival Time</span>
            <span className="maze-victory-stat__value maze-victory-stat__value--accent">
              {formatElapsedTime(activeGameOverSummary?.survivalTimeMs ?? 0)}
            </span>
          </div>
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Keycards Collected</span>
            <span className="maze-victory-stat__value">
              {activeGameOverSummary
                ? `${activeGameOverSummary.keysCollected} / ${activeGameOverSummary.totalKeys}`
                : `${state.keysCollected} / ${state.totalKeys}`}
            </span>
          </div>
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Coins Collected</span>
            <span className="maze-victory-stat__value">
              {state.coinsCollected} / {state.totalCoins}
            </span>
          </div>
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Moves</span>
            <span className="maze-victory-stat__value">{state.moves}</span>
          </div>
        </div>
      </Modal>
    </GameShell>
  )
}
