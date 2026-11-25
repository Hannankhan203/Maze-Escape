import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Button from './components/common/Button.jsx'
import Modal from './components/common/Modal.jsx'
import StarRating from './components/common/StarRating.jsx'
import MazeViewport3D from './components/game/MazeViewport3D.jsx'
import PauseMenuModal from './components/game/PauseMenuModal.jsx'
import GameShell from './components/layout/GameShell.jsx'
import SettingsModal from './components/settings/SettingsModal.jsx'
import { createInitialGameState, gameReducer } from './game/engine/gameReducer.js'
import { formatElapsedTime } from './game/mechanics/runTimer.js'
import {
  buildGameOverSummary,
  calculateRunScore,
  resolveVictorySummary,
} from './game/mechanics/scoring.js'
import {
  CAMERA_MODES,
  normalizeBindingKeyToken,
  normalizeKeyBindings,
  resolveInputKeyToken,
} from './game/three/threeConfig.js'
import { useRunTimer } from './hooks/useRunTimer.js'
import { triggerHapticForGameEvent } from './utils/haptics.js'
import {
  loadAllSettings,
  resetAllSettings,
  saveAllSettings,
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

  const [isPauseOpen, setIsPauseOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [viewportError, setViewportError] = useState(null)
  const [victorySummary, setVictorySummary] = useState(null)
  const [isSpawnIntroActive, setIsSpawnIntroActive] = useState(false)
  const [isExtractionActive, setIsExtractionActive] = useState(false)

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

  const isMenuModalOpen = isPauseOpen || isSettingsOpen
  const isAnyModalOpen = isMenuModalOpen || state.hasWon || state.isGameOver
  const controlsEnabled = !isAnyModalOpen && !viewportError
  const audioPaused = isMenuModalOpen

  const handleVictoryTime = useCallback((completionTimeMs, targetRunId) => {
    const current = latestStateRef.current
    const scored = calculateRunScore({
      maze: current.maze,
      completionTimeMs,
      shardsCollected: current.shardsCollected,
      totalShards: current.totalShards,
      health: current.health,
      maxHealth: current.maxHealth,
      keysCollected: current.keysCollected,
      totalKeys: current.totalKeys,
      objectivesEnabled: current.objectivesEnabled,
    })

    setVictorySummary({
      ...scored,
      runId: targetRunId,
    })
  }, [])

  const { getFormattedTime } = useRunTimer({
    resetKey: state.runId,
    isPaused: isMenuModalOpen || isSpawnIntroActive || isExtractionActive,
    hasWon: state.hasWon,
    isGameOver: state.isGameOver,
    onVictoryTime: handleVictoryTime,
  })

  // Count down active timed power-up abilities while gameplay is active
  const hasTimedAbilities =
    (state.activeEffects?.echoRevealRemainingMs || 0) > 0 ||
    (state.activeEffects?.phantomVeilRemainingMs || 0) > 0 ||
    (state.activeEffects?.spectralCompassRemainingMs || 0) > 0 ||
    (state.activeEffects?.timeFragmentRemainingMs || 0) > 0 ||
    (state.activeEffects?.watchersEyeRemainingMs || 0) > 0 ||
    (state.activeEffects?.spiritLanternRemainingMs || 0) > 0 ||
    (state.activeEffects?.magnetRemainingMs || 0) > 0

  useEffect(() => {
    if (
      !hasTimedAbilities ||
      isAnyModalOpen ||
      isSpawnIntroActive ||
      isExtractionActive
    ) {
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
  }, [hasTimedAbilities, isAnyModalOpen, isSpawnIntroActive, isExtractionActive])

  // Global Pause shortcut (customizable, defaults to P)
  const pauseKeyToken = normalizeKeyBindings(settings.controls.keyBindings).pause
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleKeyDown = (event) => {
      if (
        !event ||
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
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

      const token = normalizeBindingKeyToken(resolveInputKeyToken(event))
      if (!token || token !== pauseKeyToken) return
      if (state.hasWon || state.isGameOver) return

      event.preventDefault?.()
      if (isSettingsOpen) {
        setIsSettingsOpen(false)
        setIsPauseOpen(true)
        return
      }
      setIsPauseOpen((prev) => !prev)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [pauseKeyToken, state.hasWon, state.isGameOver, isSettingsOpen])

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
        else if (id === 'subtitles') nextAudio.subtitles = Boolean(val)
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
        } else if (id === 'keyBindings') {
          nextControls.keyBindings = normalizeKeyBindings(val)
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
      updateSettings((prev) => {
        const nextGameplay = { ...prev.gameplay }
        if (id === 'thirdPersonCameraMode') nextGameplay.thirdPersonCameraMode = val
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

  const handleToggleCameraMode = useCallback(() => {
    updateSettings((prev) => {
      const nextMode =
        prev.gameplay.cameraMode === CAMERA_MODES.THIRD_PERSON
          ? CAMERA_MODES.FIRST_PERSON
          : CAMERA_MODES.THIRD_PERSON
      return {
        ...prev,
        gameplay: {
          ...prev.gameplay,
          cameraMode: nextMode,
        },
      }
    })
  }, [updateSettings])

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
      battery: meta?.battery,
      maxBattery: meta?.maxBattery,
    })
  }, [])

  const handleCollectItem = useCallback((entry) => {
    if (!entry) return
    dispatch({
      type: 'COLLECT_ITEM',
      itemId: entry.id || null,
      row: entry.row,
      col: entry.col,
    })
  }, [])

  const handleActivateAbility = useCallback((abilityType, meta) => {
    dispatch({
      type: 'ACTIVATE_ABILITY',
      abilityType,
      ...(meta?.inputEventId !== undefined ? { inputEventId: meta.inputEventId } : {}),
    })
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

  const handleSpawnSequenceChange = useCallback((active) => {
    setIsSpawnIntroActive(Boolean(active))
  }, [])

  const handleExtractionSequenceChange = useCallback((active) => {
    setIsExtractionActive(Boolean(active))
  }, [])

  const handleExtractionComplete = useCallback(() => {
    dispatch({ type: 'COMPLETE_EXIT_EXTRACTION' })
  }, [])

  const handleRestartRun = useCallback(() => {
    setVictorySummary(null)
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    dispatch({ type: 'RESET_RUN' })
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
      subtitles: settings.audio.subtitles,
    }),
    [
      viewportEngineConfig?.audio,
      audioVolumesConfig,
      settings.audio.spatialAudio,
      settings.audio.footstepEchoes,
      settings.audio.subtitles,
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
      keyBindings: settings.controls.keyBindings,
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
      settings.controls.keyBindings,
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
      subtitles: settings.audio.subtitles,
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
      keyBindings: settings.controls.keyBindings,
    }),
    [settings.controls]
  )

  const modalGameplaySettings = useMemo(
    () => ({
      thirdPersonCameraMode: settings.gameplay.thirdPersonCameraMode,
      fieldOfView: settings.gameplay.fieldOfView,
      cameraShake: settings.gameplay.cameraShake,
      scareIntensity: settings.gameplay.scareIntensity,
      visualScares: settings.gameplay.visualScaresEnabled,
      reducedMotion: settings.gameplay.reducedMotion,
      wayfinderGuide: settings.gameplay.wayfinderGuide,
    }),
    [settings.gameplay]
  )

  const activeVictorySummary = resolveVictorySummary(
    victorySummary,
    state.runId,
    state.hasWon
  )
  const activeGameOverSummary = useMemo(() => {
    if (!state.isGameOver || state.hasWon) {
      return null
    }
    return buildGameOverSummary({
      runId: state.runId,
      shardsCollected: state.shardsCollected,
      totalShards: state.totalShards,
      keysCollected: state.keysCollected,
      totalKeys: state.totalKeys,
      objectivesEnabled: state.objectivesEnabled,
    })
  }, [
    state.isGameOver,
    state.hasWon,
    state.runId,
    state.shardsCollected,
    state.totalShards,
    state.keysCollected,
    state.totalKeys,
    state.objectivesEnabled,
  ])

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
              items={state.items}
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
              onCollectItem={handleCollectItem}
              onActivateAbility={handleActivateAbility}
              onPlayerDamage={handlePlayerDamage}
              onGameOver={handleEngineGameOver}
              onToggleCameraMode={handleToggleCameraMode}
              onSpawnSequenceChange={handleSpawnSequenceChange}
              onExtractionSequenceChange={handleExtractionSequenceChange}
              onExtractionComplete={handleExtractionComplete}
              onViewportReady={onViewportReady}
              onViewportError={setViewportError}
            />
          )}
        </div>
      </main>

      <PauseMenuModal
        key={isPauseOpen ? 'open' : 'closed'}
        isOpen={
          isPauseOpen &&
          !isSettingsOpen &&
          !state.hasWon &&
          !state.isGameOver
        }
        maze={state.maze}
        shardsCollected={state.shardsCollected}
        totalShards={state.totalShards}
        shardBonus={state.shardBonus}
        keysCollected={state.keysCollected}
        totalKeys={state.totalKeys}
        isExitLocked={state.isExitLocked}
        objectivesEnabled={state.objectivesEnabled}
        inventory={state.inventory}
        activeEffects={state.activeEffects}
        keyBindings={settings.controls.keyBindings}
        onResume={() => setIsPauseOpen(false)}
        onRestart={handleRestartRun}
        onOpenSettings={() => {
          setIsPauseOpen(true)
          setIsSettingsOpen(true)
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
        isOpen={state.hasWon}
        onClose={handleRestartRun}
        title="Maze Escaped"
        subtitle={`Labyrinth ${state.maze.rows}×${state.maze.cols} · Seed #${state.maze.seed}`}
        size="md"
        showCloseButton={false}
        closeOnBackdrop={false}
        closeOnEscape={false}
        footer={
          <Button variant="primary" onClick={handleRestartRun}>
            Replay Maze
          </Button>
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
              {activeVictorySummary.beatPar ? (
                <div className="maze-victory-badges">
                  <span className="maze-victory-badge maze-victory-badge--emerald">
                    Under Par
                  </span>
                </div>
              ) : null}
              <div className="maze-victory-breakdown">
                <span>Base +{activeVictorySummary.breakdown.baseScore}</span>
                <span>Time +{activeVictorySummary.breakdown.timeBonus}</span>

                <span>Health +{activeVictorySummary.breakdown.healthBonus}</span>
                {activeVictorySummary.breakdown.keycardBonus > 0 ? (
                  <span>Keys +{activeVictorySummary.breakdown.keycardBonus}</span>
                ) : null}
                {activeVictorySummary.breakdown.shardBonus > 0 ? (
                  <span>Shards +{activeVictorySummary.breakdown.shardBonus}</span>
                ) : null}
              </div>
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
                <span className="maze-victory-stat__label">Soul Shards</span>
                <span className="maze-victory-stat__value">
                  {state.shardsCollected} / {state.totalShards}
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
          </div>
        )}
      </Modal>

      <Modal
        isOpen={state.isGameOver && !state.hasWon}
        onClose={handleRestartRun}
        title="Claimed by the Dark"
        subtitle="Trapped in the abandoned underground facility, you fell to the darkness, hazards, and hostile threats."
        size="md"
        showCloseButton={false}
        closeOnBackdrop={false}
        closeOnEscape={false}
        footer={
          <Button variant="primary" onClick={handleRestartRun}>
            Try Again
          </Button>
        }
      >
        <div className="maze-victory-stats">
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Keycards Collected</span>
            <span className="maze-victory-stat__value">
              {activeGameOverSummary
                ? `${activeGameOverSummary.keysCollected} / ${activeGameOverSummary.totalKeys}`
                : `${state.keysCollected} / ${state.totalKeys}`}
            </span>
          </div>
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Soul Shards</span>
            <span className="maze-victory-stat__value">
              {activeGameOverSummary
                ? `${activeGameOverSummary.shardsCollected} / ${activeGameOverSummary.totalShards}`
                : `${state.shardsCollected} / ${state.totalShards}`}
            </span>
          </div>
        </div>
      </Modal>
    </GameShell>
  )
}
