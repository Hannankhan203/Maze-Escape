import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Button from './components/common/Button.jsx'
import Modal from './components/common/Modal.jsx'
import ElevatorTransitionOverlay from './components/game/ElevatorTransitionOverlay.jsx'
import MazeViewport3D from './components/game/MazeViewport3D.jsx'
import PauseMenuModal from './components/game/PauseMenuModal.jsx'
import StartScreen from './components/game/StartScreen.jsx'
import StartTransitionOverlay from './components/game/StartTransitionOverlay.jsx'
import VictoryModal from './components/game/VictoryModal.jsx'
import { resolveVictoryModalViewModel } from './components/game/victoryModalState.js'
import GameShell from './components/layout/GameShell.jsx'
import {
  ELEVATOR_TRANSITION_PHASES,
  advanceElevatorTransitionToOpening,
  advanceElevatorTransitionToTraveling,
  beginElevatorTransitionState,
  cancelElevatorTransitionState,
  createIdleElevatorTransitionState,
  easeElevatorDoorProgress,
  finishElevatorTransitionState,
  markElevatorTransitionMazeCommitted,
  markElevatorTransitionSceneReady,
  resolveElevatorTransitionTimings,
  updateElevatorDoorProgress,
  updateElevatorTravelProgress,
} from './game/engine/elevatorLevelTransition.js'
import {
  ARRIVAL_ENTRY_PATHS,
  ARRIVAL_SEQUENCE_PHASES,
  beginArrivalSequenceState,
  cancelArrivalSequenceState,
  createIdleArrivalState,
  finishArrivalSequenceState,
  resolveArrivalConfig,
  resolveInterLevelArrivalPhase,
  resolveSpawnSequenceArrivalPhase,
  updateArrivalPhaseState,
} from './game/engine/levelArrivalSequence.js'
import {
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  createStartSandboxAction,
  gameReducer,
} from './game/engine/gameReducer.js'
import {
  isDeveloperAccessEnabled,
  isSandboxViewRequested,
  syncSandboxUrlParam,
} from './game/sandbox/sandboxAccess.js'
import {
  loadSandboxConfig,
  resetPersistedSandboxConfig,
  saveSandboxConfig,
} from './game/sandbox/sandboxConfig.js'
import { buildSandboxRuntimePayload } from './game/sandbox/sandboxSession.js'
import {
  buildGameOverSummary,
  calculateRunScore,
  resolveAuthoritativeHudScore,
  resolveVictorySummary,
} from './game/mechanics/scoring.js'
import {
  CAMERA_MODES,
  normalizeKeyBindings,
  resolveInputKeyToken,
} from './game/three/threeConfig.js'
import { COLLECTIBLE_TYPES } from './game/mechanics/collectiblesConfig.js'
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
  initialPlaying = false,
  initialGameState = null,
  levelTransitionConfig = null,
  onLevelTransitionChange = null,
  arrivalConfig = null,
  onArrivalStateChange = null,
  advanceLevelActionBuilder = createAdvanceLevelAction,
}) {
  const [gameLaunchState, setGameLaunchState] = useState(
    initialPlaying ? 'playing' : 'start'
  )
  const [isMazeReady, setIsMazeReady] = useState(false)
  const isPlaying = gameLaunchState === 'transitioning' || gameLaunchState === 'playing'

  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    initialGameState || createInitialGameState()
  )
  const [settings, setSettings] = useState(() => loadAllSettings())
  const [developerAccess] = useState(() => isDeveloperAccessEnabled())
  const [initialStartView, setInitialStartView] = useState(() =>
    isSandboxViewRequested() ? 'dev-sandbox' : 'menu'
  )
  const [sandboxConfig, setSandboxConfig] = useState(() => loadSandboxConfig())

  const [isPauseOpen, setIsPauseOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [viewportError, setViewportError] = useState(null)
  const [victorySummary, setVictorySummary] = useState(null)
  const [pendingVictoryActionRunId, setPendingVictoryActionRunId] = useState(null)
  const [isSpawnIntroActive, setIsSpawnIntroActive] = useState(false)
  const [spawnIntroStage, setSpawnIntroStage] = useState('IDLE')
  const [isExtractionActive, setIsExtractionActive] = useState(false)
  const [levelTransition, setLevelTransition] = useState(createIdleElevatorTransitionState)
  const [arrivalEntryPath, setArrivalEntryPath] = useState(
    initialPlaying ? ARRIVAL_ENTRY_PATHS.FRESH_GAME : null
  )

  const latestStateRef = useRef(state)
  const completedActionRunIdRef = useRef(null)
  const levelTransitionRef = useRef(levelTransition)
  const arrivalStateRef = useRef(createIdleArrivalState())
  const arrivalEntryPathRef = useRef(
    initialPlaying ? ARRIVAL_ENTRY_PATHS.FRESH_GAME : null
  )
  const arrivalSequenceCounterRef = useRef(0)
  const arrivalSafetyTimeoutRef = useRef(null)
  const arrivalLockedRef = useRef(false)
  const viewportEngineRef = useRef(null)
  const transitionSourceStateRef = useRef(null)
  const committedTransitionIdRef = useRef(0)
  const transitionSequenceCounterRef = useRef(0)
  const minTravelElapsedRef = useRef({ transitionId: 0, elapsed: false })
  const transitionHandlesRef = useRef({
    rafId: null,
    timeoutId: null,
    safetyTimeoutId: null,
  })
  const viewportErrorRef = useRef(viewportError)
  const onLevelTransitionChangeRef = useRef(onLevelTransitionChange)
  const onArrivalStateChangeRef = useRef(onArrivalStateChange)
  const advanceLevelActionBuilderRef = useRef(advanceLevelActionBuilder)

  useEffect(() => {
    latestStateRef.current = state
  }, [state])

  useEffect(() => {
    viewportErrorRef.current = viewportError
  }, [viewportError])

  useEffect(() => {
    onLevelTransitionChangeRef.current = onLevelTransitionChange
  }, [onLevelTransitionChange])

  useEffect(() => {
    onArrivalStateChangeRef.current = onArrivalStateChange
  }, [onArrivalStateChange])

  useEffect(() => {
    advanceLevelActionBuilderRef.current =
      typeof advanceLevelActionBuilder === 'function'
        ? advanceLevelActionBuilder
        : createAdvanceLevelAction
  }, [advanceLevelActionBuilder])

  const clearArrivalSafetyTimeout = useCallback(() => {
    if (arrivalSafetyTimeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout?.(arrivalSafetyTimeoutRef.current)
      arrivalSafetyTimeoutRef.current = null
    }
  }, [])

  const updateArrivalState = useCallback((updater) => {
    const prev = arrivalStateRef.current
    const next = typeof updater === 'function' ? updater(prev) : updater
    if (next === prev) {
      return prev
    }
    arrivalStateRef.current = next
    onArrivalStateChangeRef.current?.(next)
    return next
  }, [])

  const clearTransitionTimers = useCallback(() => {
    const handles = transitionHandlesRef.current
    if (handles.rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame?.(handles.rafId)
      handles.rafId = null
    }
    if (handles.timeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout?.(handles.timeoutId)
      handles.timeoutId = null
    }
    if (handles.safetyTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout?.(handles.safetyTimeoutId)
      handles.safetyTimeoutId = null
    }
  }, [])

  const updateLevelTransition = useCallback((updater) => {
    const prev = levelTransitionRef.current
    const next = typeof updater === 'function' ? updater(prev) : updater
    if (next === prev) {
      return prev
    }
    levelTransitionRef.current = next
    setLevelTransition(next)
    onLevelTransitionChangeRef.current?.(next)
    return next
  }, [])

  const cancelActiveLevelTransition = useCallback(
    ({ error = null } = {}) => {
      clearTransitionTimers()
      transitionSourceStateRef.current = null
      minTravelElapsedRef.current = { transitionId: 0, elapsed: false }
      if (levelTransitionRef.current.active || error) {
        updateLevelTransition((prev) => cancelElevatorTransitionState(prev, error))
      }
    },
    [clearTransitionTimers, updateLevelTransition]
  )

  useEffect(
    () => () => {
      clearTransitionTimers()
      clearArrivalSafetyTimeout()
    },
    [clearTransitionTimers, clearArrivalSafetyTimeout]
  )

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

  const effectiveArrivalConfig = useMemo(
    () =>
      resolveArrivalConfig(
        arrivalConfig,
        Boolean(settings.gameplay.reducedMotion)
      ),
    [arrivalConfig, settings.gameplay.reducedMotion]
  )

  const isLevelTransitionActive = Boolean(isPlaying && levelTransition.active)
  const isArrivalLocked = Boolean(
    isPlaying &&
      (gameLaunchState === 'transitioning' ||
        isSpawnIntroActive ||
        isLevelTransitionActive)
  )
  const resolvedArrivalEntryPath = isLevelTransitionActive
    ? ARRIVAL_ENTRY_PATHS.NEXT_LEVEL
    : arrivalEntryPath || ARRIVAL_ENTRY_PATHS.FRESH_GAME
  const resolvedArrivalPhase = !isArrivalLocked
    ? ARRIVAL_SEQUENCE_PHASES.IDLE
    : gameLaunchState === 'transitioning'
      ? ARRIVAL_SEQUENCE_PHASES.PREPARING
      : isLevelTransitionActive
        ? resolveInterLevelArrivalPhase(levelTransition, effectiveArrivalConfig)
        : resolveSpawnSequenceArrivalPhase(spawnIntroStage)
  const resolvedArrivalDoorProgress = isLevelTransitionActive
    ? levelTransition.doorProgress
    : gameLaunchState === 'transitioning'
      ? 1
      : 0

  useEffect(() => {
    arrivalLockedRef.current = isArrivalLocked
  }, [isArrivalLocked])

  // Synchronize unified arrival state across Fresh Game, Next Level, and Replay
  useEffect(() => {
    if (!isArrivalLocked) {
      if (arrivalStateRef.current.active) {
        updateArrivalState((prev) => finishArrivalSequenceState(prev))
      }
      return
    }

    const entryPath = resolvedArrivalEntryPath
    const targetLevel = isLevelTransitionActive
      ? levelTransition.toLevel
      : state.currentLevel
    const targetRunId = state.runId
    const handoffProgress =
      resolvedArrivalPhase === ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF ? 0.85 : 0

    updateArrivalState((prev) => {
      if (!prev.active) {
        const nextArrivalId = arrivalSequenceCounterRef.current + 1
        arrivalSequenceCounterRef.current = nextArrivalId
        return beginArrivalSequenceState(prev, {
          entryPath,
          phase: resolvedArrivalPhase,
          level: targetLevel,
          runId: targetRunId,
          arrivalId: nextArrivalId,
        })
      }
      return updateArrivalPhaseState(prev, resolvedArrivalPhase, {
        doorProgress:
          resolvedArrivalPhase === ARRIVAL_SEQUENCE_PHASES.PREPARING
            ? 1
            : resolvedArrivalPhase === ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF
              ? 0.25
              : 0.75,
        cameraHandoffProgress: handoffProgress,
      })
    })
  }, [
    isArrivalLocked,
    isLevelTransitionActive,
    levelTransition.toLevel,
    resolvedArrivalEntryPath,
    resolvedArrivalPhase,
    state.currentLevel,
    state.runId,
    updateArrivalState,
  ])

  // Bounded safety watchdog for 3D spawn arrival so a stalled sequence never permanently locks gameplay
  useEffect(() => {
    clearArrivalSafetyTimeout()
    if (
      !isPlaying ||
      gameLaunchState !== 'playing' ||
      !isSpawnIntroActive ||
      isLevelTransitionActive ||
      typeof window === 'undefined'
    ) {
      return undefined
    }

    arrivalSafetyTimeoutRef.current = window.setTimeout(() => {
      arrivalSafetyTimeoutRef.current = null
      viewportEngineRef.current?.cancelSpawnSequence?.({ forceNotify: false })
      setIsSpawnIntroActive(false)
      setSpawnIntroStage('IDLE')
      updateArrivalState((prev) =>
        cancelArrivalSequenceState(prev, { timedOut: true })
      )
    }, effectiveArrivalConfig.maxArrivalTimeoutMs)

    return clearArrivalSafetyTimeout
  }, [
    isPlaying,
    gameLaunchState,
    isSpawnIntroActive,
    isLevelTransitionActive,
    effectiveArrivalConfig.maxArrivalTimeoutMs,
    clearArrivalSafetyTimeout,
    updateArrivalState,
  ])

  const isMenuModalOpen =
    isPlaying &&
    (isPauseOpen || isSettingsOpen) &&
    !state.hasWon &&
    !state.isGameOver &&
    !isArrivalLocked
  const isAnyModalOpen =
    isMenuModalOpen ||
    isArrivalLocked ||
    (isPlaying && (state.hasWon || state.isGameOver))
  const controlsEnabled = gameLaunchState === 'playing' && !isAnyModalOpen && !viewportError
  const audioPaused = gameLaunchState !== 'playing' || isMenuModalOpen

  const handleViewportReady = useCallback((ctx) => {
    viewportEngineRef.current = ctx?.engine || null
    setIsMazeReady(true)
    const userCleanup = onViewportReady?.(ctx)
    return () => {
      if (viewportEngineRef.current === ctx?.engine) {
        viewportEngineRef.current = null
      }
      if (typeof userCleanup === 'function') {
        userCleanup()
      }
    }
  }, [onViewportReady])

  const handleVictoryTime = useCallback((completionTimeMs, targetRunId) => {
    const current = latestStateRef.current
    const completedLevel =
      current.completedLevel ?? current.currentLevel ?? current.maze?.level ?? 1
    const levelBaseCumulativeScore = Number.isFinite(
      current.levelBaseCumulativeScore
    )
      ? Math.max(0, Math.round(current.levelBaseCumulativeScore))
      : 0
    const scored = calculateRunScore({
      maze: current.maze,
      level: completedLevel,
      completionTimeMs,
      shardsCollected: current.shardsCollected,
      totalShards: current.totalShards,
      nonShardCollectiblesCollected: current.nonShardCollectiblesCollected,
      totalNonShardCollectibles: current.totalNonShardCollectibles,
      collectibleBonus: current.collectibleBonus,
      health: current.health,
      maxHealth: current.maxHealth,
      damageTaken: current.damageTaken,
      hitsTaken: current.hitsTaken,
      keysCollected: current.keysCollected,
      totalKeys: current.totalKeys,
      objectivesEnabled: current.objectivesEnabled,
    })
    const cumulativeScore = levelBaseCumulativeScore + scored.score

    setVictorySummary({
      ...scored,
      levelBaseCumulativeScore,
      cumulativeScore,
      runId: targetRunId,
    })
    dispatch({
      type: 'FINALIZE_LEVEL_SCORE',
      runId: targetRunId,
      completionTimeMs,
    })
  }, [])

  const { getFormattedTime, getElapsedMs } = useRunTimer({
    resetKey: state.runId,
    isPaused:
      !isPlaying ||
      isMenuModalOpen ||
      isArrivalLocked ||
      isExtractionActive,
    hasWon: isPlaying && state.hasWon,
    isGameOver: isPlaying && state.isGameOver,
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
      !isPlaying ||
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
  }, [isPlaying, hasTimedAbilities, isAnyModalOpen, isSpawnIntroActive, isExtractionActive])

  // Global Pause shortcut (customizable, defaults to P)
  const pauseKeyToken = normalizeKeyBindings(settings.controls.keyBindings).pause
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleKeyDown = (event) => {
      if (
        !isPlaying ||
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

      const token = resolveInputKeyToken(event)
      if (token && token === pauseKeyToken) {
        event.preventDefault?.()
        if (state.hasWon || state.isGameOver || isArrivalLocked) return
        setIsSettingsOpen(false)
        setIsPauseOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPlaying, pauseKeyToken, state.hasWon, state.isGameOver, isArrivalLocked])

  const effectiveTransitionTimings = useMemo(
    () =>
      resolveElevatorTransitionTimings(
        levelTransitionConfig,
        Boolean(settings.gameplay.reducedMotion)
      ),
    [levelTransitionConfig, settings.gameplay.reducedMotion]
  )

  const handleLevelSceneReady = useCallback(
    ({ maze: readyMaze, runId: readyRunId } = {}) => {
      const cur = levelTransitionRef.current
      if (!cur.active || cur.phase !== ELEVATOR_TRANSITION_PHASES.TRAVELING) {
        return
      }
      const matchesTargetLevel =
        readyMaze && Number(readyMaze.level) === Number(cur.toLevel)
      const matchesNewRun =
        cur.sourceRunId == null ||
        (typeof readyRunId === 'number' && readyRunId > cur.sourceRunId)
      if (!matchesTargetLevel && !matchesNewRun) {
        return
      }

      const updated = updateLevelTransition((prev) => {
        if (!prev.active || prev.transitionId !== cur.transitionId) return prev
        return markElevatorTransitionSceneReady(prev)
      })

      if (
        updated.active &&
        updated.phase === ELEVATOR_TRANSITION_PHASES.TRAVELING &&
        updated.mazeCommitted &&
        updated.sceneReady &&
        minTravelElapsedRef.current.transitionId === updated.transitionId &&
        minTravelElapsedRef.current.elapsed
      ) {
        clearTransitionTimers()
        updateLevelTransition((prev) => {
          if (!prev.active || prev.transitionId !== updated.transitionId) return prev
          return advanceElevatorTransitionToOpening(prev)
        })
      }
    },
    [clearTransitionTimers, updateLevelTransition]
  )

  const levelTransitionActive = levelTransition.active
  const levelTransitionPhase = levelTransition.phase
  const levelTransitionId = levelTransition.transitionId

  // Drive the inter-level elevator transition phases:
  // closing_doors (doors close completely) -> traveling (generate/mount next maze once) -> opening_doors -> idle
  useEffect(() => {
    if (!levelTransitionActive || typeof window === 'undefined') {
      return undefined
    }

    const phase = levelTransitionPhase
    const transitionId = levelTransitionId
    const timings = effectiveTransitionTimings

    if (phase === ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS) {
      const startMs = performance.now()
      const durationMs = timings.doorsCloseDurationMs
      let completed = false

      const finishClosing = () => {
        if (completed) return
        completed = true
        clearTransitionTimers()
        updateLevelTransition((prev) => {
          if (!prev.active || prev.transitionId !== transitionId) return prev
          return advanceElevatorTransitionToTraveling(prev)
        })
      }

      const tick = () => {
        if (completed) return
        const cur = levelTransitionRef.current
        if (
          !cur.active ||
          cur.transitionId !== transitionId ||
          cur.phase !== ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS
        ) {
          return
        }
        const elapsed = Math.max(0, performance.now() - startMs)
        const rawT = Math.min(1, elapsed / durationMs)
        const eased = easeElevatorDoorProgress(rawT)
        updateLevelTransition((prev) => updateElevatorDoorProgress(prev, eased))
        if (rawT >= 1) {
          finishClosing()
          return
        }
        transitionHandlesRef.current.rafId = window.requestAnimationFrame(tick)
      }

      transitionHandlesRef.current.rafId = window.requestAnimationFrame(tick)
      transitionHandlesRef.current.timeoutId = window.setTimeout(
        finishClosing,
        durationMs + 40
      )

      return () => {
        completed = true
        clearTransitionTimers()
      }
    }

    if (phase === ELEVATOR_TRANSITION_PHASES.TRAVELING) {
      const startMs = performance.now()
      const minDurationMs = timings.travelMinDurationMs
      const maxTimeoutMs = timings.maxTravelTimeoutMs
      let completed = false

      // Generate and commit the next level strictly ONCE after doors are fully sealed
      if (committedTransitionIdRef.current !== transitionId) {
        committedTransitionIdRef.current = transitionId
        const sourceState = transitionSourceStateRef.current || latestStateRef.current
        try {
          const action = advanceLevelActionBuilderRef.current(sourceState, {
            requireVictory: true,
            guardRunId: true,
          })
          if (!action || typeof action !== 'object') {
            throw new Error('Failed to create next-level action')
          }
          dispatch(action)
          updateLevelTransition((prev) => {
            if (!prev.active || prev.transitionId !== transitionId) return prev
            const committed = markElevatorTransitionMazeCommitted(prev)
            return viewportErrorRef.current
              ? markElevatorTransitionSceneReady(committed)
              : committed
          })
        } catch (err) {
          completedActionRunIdRef.current = null
          setPendingVictoryActionRunId(null)
          cancelActiveLevelTransition({ error: err })
          return undefined
        }
      }

      const markMinElapsed = () => {
        if (completed) return
        minTravelElapsedRef.current = { transitionId, elapsed: true }
        updateLevelTransition((prev) => updateElevatorTravelProgress(prev, 1))
        const cur = levelTransitionRef.current
        if (
          cur.active &&
          cur.transitionId === transitionId &&
          cur.phase === ELEVATOR_TRANSITION_PHASES.TRAVELING &&
          cur.mazeCommitted &&
          cur.sceneReady
        ) {
          completed = true
          clearTransitionTimers()
          updateLevelTransition((prev) => {
            if (!prev.active || prev.transitionId !== transitionId) return prev
            return advanceElevatorTransitionToOpening(prev)
          })
        }
      }

      const tick = () => {
        if (completed) return
        const cur = levelTransitionRef.current
        if (
          !cur.active ||
          cur.transitionId !== transitionId ||
          cur.phase !== ELEVATOR_TRANSITION_PHASES.TRAVELING
        ) {
          return
        }
        const elapsed = Math.max(0, performance.now() - startMs)
        const rawT = Math.min(1, elapsed / minDurationMs)
        updateLevelTransition((prev) => updateElevatorTravelProgress(prev, rawT))
        if (rawT >= 1) {
          markMinElapsed()
          return
        }
        transitionHandlesRef.current.rafId = window.requestAnimationFrame(tick)
      }

      transitionHandlesRef.current.rafId = window.requestAnimationFrame(tick)
      transitionHandlesRef.current.timeoutId = window.setTimeout(
        markMinElapsed,
        minDurationMs + 30
      )
      transitionHandlesRef.current.safetyTimeoutId = window.setTimeout(() => {
        if (completed) return
        completed = true
        clearTransitionTimers()
        const cur = levelTransitionRef.current
        if (!cur.active || cur.transitionId !== transitionId) return
        if (cur.mazeCommitted) {
          updateLevelTransition((prev) =>
            advanceElevatorTransitionToOpening(prev, { force: true })
          )
        } else {
          completedActionRunIdRef.current = null
          setPendingVictoryActionRunId(null)
          cancelActiveLevelTransition({
            error: new Error('Elevator transition timed out before maze load'),
          })
        }
      }, maxTimeoutMs)

      return () => {
        completed = true
        clearTransitionTimers()
      }
    }

    if (phase === ELEVATOR_TRANSITION_PHASES.OPENING_DOORS) {
      const startMs = performance.now()
      const durationMs = timings.doorsOpenDurationMs
      let completed = false

      const finishOpening = () => {
        if (completed) return
        completed = true
        clearTransitionTimers()
        transitionSourceStateRef.current = null
        minTravelElapsedRef.current = { transitionId: 0, elapsed: false }
        setPendingVictoryActionRunId(null)
        updateLevelTransition((prev) => {
          if (!prev.active || prev.transitionId !== transitionId) return prev
          return finishElevatorTransitionState(prev)
        })
      }

      const tick = () => {
        if (completed) return
        const cur = levelTransitionRef.current
        if (
          !cur.active ||
          cur.transitionId !== transitionId ||
          cur.phase !== ELEVATOR_TRANSITION_PHASES.OPENING_DOORS
        ) {
          return
        }
        const elapsed = Math.max(0, performance.now() - startMs)
        const rawT = Math.min(1, elapsed / durationMs)
        const nextDoorProgress = 1 - easeElevatorDoorProgress(rawT)
        updateLevelTransition((prev) => updateElevatorDoorProgress(prev, nextDoorProgress))
        if (rawT >= 1) {
          finishOpening()
          return
        }
        transitionHandlesRef.current.rafId = window.requestAnimationFrame(tick)
      }

      transitionHandlesRef.current.rafId = window.requestAnimationFrame(tick)
      transitionHandlesRef.current.timeoutId = window.setTimeout(
        finishOpening,
        durationMs + 40
      )

      return () => {
        completed = true
        clearTransitionTimers()
      }
    }

    return undefined
  }, [
    levelTransitionActive,
    levelTransitionPhase,
    levelTransitionId,
    effectiveTransitionTimings,
    clearTransitionTimers,
    updateLevelTransition,
    cancelActiveLevelTransition,
  ])

  const handleRestartRun = useCallback(() => {
    cancelActiveLevelTransition()
    clearArrivalSafetyTimeout()
    arrivalEntryPathRef.current = ARRIVAL_ENTRY_PATHS.REPLAY_LEVEL
    setArrivalEntryPath(ARRIVAL_ENTRY_PATHS.REPLAY_LEVEL)
    setVictorySummary(null)
    setPendingVictoryActionRunId(null)
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    setIsExtractionActive(false)
    dispatch(createReplayLevelAction(latestStateRef.current))
  }, [cancelActiveLevelTransition, clearArrivalSafetyTimeout])

  const handleNextLevel = useCallback(() => {
    const current = latestStateRef.current
    if (!current?.hasWon || current?.isSandbox) return
    if (levelTransitionRef.current.active || arrivalLockedRef.current) return
    if (completedActionRunIdRef.current === current.runId) return
    completedActionRunIdRef.current = current.runId
    arrivalEntryPathRef.current = ARRIVAL_ENTRY_PATHS.NEXT_LEVEL
    setArrivalEntryPath(ARRIVAL_ENTRY_PATHS.NEXT_LEVEL)
    transitionSourceStateRef.current = current
    minTravelElapsedRef.current = { transitionId: 0, elapsed: false }
    setPendingVictoryActionRunId(current.runId)
    setVictorySummary(null)
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    setIsExtractionActive(false)
    setIsSpawnIntroActive(false)
    setSpawnIntroStage('IDLE')

    const nextTransitionId = transitionSequenceCounterRef.current + 1
    transitionSequenceCounterRef.current = nextTransitionId
    updateLevelTransition((prev) =>
      beginElevatorTransitionState(prev, {
        fromLevel: current.currentLevel,
        toLevel: current.currentLevel + 1,
        sourceRunId: current.runId,
        transitionId: nextTransitionId,
      })
    )
  }, [updateLevelTransition])

  const handleReplayCompletedLevel = useCallback(() => {
    const current = latestStateRef.current
    if (!current?.hasWon) return
    if (levelTransitionRef.current.active || arrivalLockedRef.current) return
    if (completedActionRunIdRef.current === current.runId) return
    completedActionRunIdRef.current = current.runId
    cancelActiveLevelTransition()
    clearArrivalSafetyTimeout()
    arrivalEntryPathRef.current = ARRIVAL_ENTRY_PATHS.REPLAY_LEVEL
    setArrivalEntryPath(ARRIVAL_ENTRY_PATHS.REPLAY_LEVEL)
    setPendingVictoryActionRunId(current.runId)
    setVictorySummary(null)
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    setIsExtractionActive(false)
    setIsSpawnIntroActive(false)
    setSpawnIntroStage('IDLE')
    dispatch(createReplayLevelAction(current, { guardRunId: true }))
  }, [cancelActiveLevelTransition, clearArrivalSafetyTimeout])

  const handleReturnToMainMenu = useCallback(() => {
    const current = latestStateRef.current
    const isTransitionRunning =
      levelTransitionRef.current.active || arrivalLockedRef.current
    if (
      !isTransitionRunning &&
      current?.hasWon &&
      completedActionRunIdRef.current === current.runId
    ) {
      return
    }
    if (current?.runId !== undefined) {
      completedActionRunIdRef.current = current.runId
    }
    cancelActiveLevelTransition()
    clearArrivalSafetyTimeout()
    viewportEngineRef.current?.cancelSpawnSequence?.({ forceNotify: false })
    arrivalEntryPathRef.current = null
    setArrivalEntryPath(null)
    if (arrivalStateRef.current.active) {
      updateArrivalState((prev) => cancelArrivalSequenceState(prev))
    }
    setPendingVictoryActionRunId(null)
    setVictorySummary(null)
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    setIsExtractionActive(false)
    setIsSpawnIntroActive(false)
    setSpawnIntroStage('IDLE')
    setViewportError(null)
    setIsMazeReady(false)
    setInitialStartView('menu')
    syncSandboxUrlParam(false)
    setGameLaunchState('start')
    dispatch(createNewGameAction(current))
  }, [cancelActiveLevelTransition, clearArrivalSafetyTimeout, updateArrivalState])

  const handleSandboxConfigChange = useCallback((nextConfig) => {
    const saved = saveSandboxConfig(nextConfig)
    setSandboxConfig(saved.config)
  }, [])

  const handleResetSandboxConfig = useCallback(() => {
    const reset = resetPersistedSandboxConfig()
    setSandboxConfig(reset.config)
  }, [])

  const handleSandboxViewChange = useCallback((isOpen) => {
    setInitialStartView(isOpen ? 'dev-sandbox' : 'menu')
    syncSandboxUrlParam(isOpen)
  }, [])

  const handleStartSandboxTest = useCallback(
    (overrideConfig = null) => {
      if (!developerAccess) return
      const current = latestStateRef.current
      cancelActiveLevelTransition()
      clearArrivalSafetyTimeout()
      arrivalEntryPathRef.current = ARRIVAL_ENTRY_PATHS.FRESH_GAME
      setArrivalEntryPath(ARRIVAL_ENTRY_PATHS.FRESH_GAME)
      setIsSettingsOpen(false)
      setIsPauseOpen(false)
      setVictorySummary(null)
      setPendingVictoryActionRunId(null)
      setIsExtractionActive(false)
      setIsSpawnIntroActive(false)
      setSpawnIntroStage('IDLE')
      setViewportError(null)

      const { config: savedConfig } = saveSandboxConfig(
        overrideConfig || sandboxConfig
      )
      setSandboxConfig(savedConfig)
      setInitialStartView('dev-sandbox')
      syncSandboxUrlParam(true)

      dispatch(
        createStartSandboxAction(savedConfig, {
          previousBaseSeed: current?.baseSeed ?? current?.seed,
        })
      )
      setGameLaunchState('transitioning')
      setIsMazeReady(false)
    },
    [
      developerAccess,
      sandboxConfig,
      cancelActiveLevelTransition,
      clearArrivalSafetyTimeout,
    ]
  )

  const handleReturnToSandboxConfig = useCallback(() => {
    const current = latestStateRef.current
    if (current?.runId !== undefined) {
      completedActionRunIdRef.current = current.runId
    }
    cancelActiveLevelTransition()
    clearArrivalSafetyTimeout()
    viewportEngineRef.current?.cancelSpawnSequence?.({ forceNotify: false })
    arrivalEntryPathRef.current = null
    setArrivalEntryPath(null)
    if (arrivalStateRef.current.active) {
      updateArrivalState((prev) => cancelArrivalSequenceState(prev))
    }
    setPendingVictoryActionRunId(null)
    setVictorySummary(null)
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    setIsExtractionActive(false)
    setIsSpawnIntroActive(false)
    setSpawnIntroStage('IDLE')
    setViewportError(null)
    setIsMazeReady(false)
    setInitialStartView(developerAccess ? 'dev-sandbox' : 'menu')
    if (developerAccess) {
      syncSandboxUrlParam(true)
    }
    setGameLaunchState('start')
    dispatch(createNewGameAction(current))
  }, [
    developerAccess,
    cancelActiveLevelTransition,
    clearArrivalSafetyTimeout,
    updateArrivalState,
  ])

  const handleStartGame = useCallback(() => {
    const current = latestStateRef.current
    cancelActiveLevelTransition()
    clearArrivalSafetyTimeout()
    arrivalEntryPathRef.current = ARRIVAL_ENTRY_PATHS.FRESH_GAME
    setArrivalEntryPath(ARRIVAL_ENTRY_PATHS.FRESH_GAME)
    setIsSettingsOpen(false)
    setIsPauseOpen(false)
    setVictorySummary(null)
    setPendingVictoryActionRunId(null)
    setIsExtractionActive(false)
    setIsSpawnIntroActive(false)
    setSpawnIntroStage('IDLE')
    setViewportError(null)
    setInitialStartView('menu')
    syncSandboxUrlParam(false)
    const needsFreshRun =
      !current ||
      current.isSandbox ||
      current.currentLevel !== 1 ||
      current.hasWon ||
      current.isGameOver ||
      (current.levelsCompleted || 0) > 0 ||
      (current.cumulativeScore || 0) > 0 ||
      (current.itemsCollected || 0) > 0 ||
      (current.keysCollected || 0) > 0
    if (needsFreshRun) {
      dispatch(createNewGameAction(current))
    }
    setGameLaunchState('transitioning')
    setIsMazeReady(false)
  }, [cancelActiveLevelTransition, clearArrivalSafetyTimeout])

  const handleStartTransitionComplete = useCallback(() => {
    if (typeof requestAnimationFrame !== 'function') {
      viewportEngineRef.current?.cancelSpawnSequence?.({ forceNotify: false })
      setIsSpawnIntroActive(false)
      setSpawnIntroStage('IDLE')
    }
    setGameLaunchState((prev) => (prev === 'transitioning' ? 'playing' : prev))
  }, [])

  const handleAudioSettingChange = useCallback((category, value) => {
    setSettings((prev) => {
      let patch = { [category]: value }
      if (category === 'masterVolume') {
        patch = { masterVolume: value, master: value / 100 }
      } else if (category === 'ambienceVolume') {
        patch = { ambienceVolume: value, ambience: value / 100 }
      } else if (category === 'effectsVolume') {
        patch = { effectsVolume: value, effects: value / 100 }
      } else if (category === 'musicVolume') {
        patch = { musicVolume: value, music: value / 100 }
      } else if (category === 'master') {
        patch = { master: value, masterVolume: Math.round(value * 100) }
      } else if (category === 'ambience') {
        patch = { ambience: value, ambienceVolume: Math.round(value * 100) }
      } else if (category === 'effects') {
        patch = { effects: value, effectsVolume: Math.round(value * 100) }
      } else if (category === 'music') {
        patch = { music: value, musicVolume: Math.round(value * 100) }
      }
      const nextAudio = { ...prev.audio, ...patch }
      const nextAll = { ...prev, audio: nextAudio }
      saveAllSettings(nextAll)
      return nextAll
    })
  }, [])

  const handleControlSettingChange = useCallback((key, value) => {
    setSettings((prev) => {
      let patch = { [key]: value }
      if (key === 'mouseSensitivity') {
        const val =
          typeof value === 'number' && value > 1
            ? (value / 100) * BASE_MOUSE_SENSITIVITY
            : value
        patch = { mouseSensitivity: val }
      } else if (key === 'touchLookSensitivity') {
        const val = typeof value === 'number' && value > 10 ? value / 100 : value
        patch = { touchLookSensitivity: val }
      } else if (key === 'touchControlsMode') {
        patch = { touchControls: value, touchControlsMode: value }
      }
      const nextControls = { ...prev.controls, ...patch }
      const nextAll = { ...prev, controls: nextControls }
      saveAllSettings(nextAll)
      return nextAll
    })
  }, [])

  const handleGraphicsSettingChange = useCallback((key, value) => {
    setSettings((prev) => {
      const nextGraphics = { ...prev.graphics, [key]: value }
      const nextAll = { ...prev, graphics: nextGraphics }
      saveAllSettings(nextAll)
      return nextAll
    })
  }, [])

  const handleGameplaySettingChange = useCallback((key, value) => {
    setSettings((prev) => {
      let patch = { [key]: value }
      if (key === 'visualScares') {
        patch = { visualScares: value, visualScaresEnabled: value }
      } else if (key === 'visualScaresEnabled') {
        patch = { visualScares: value, visualScaresEnabled: value }
      } else if (key === 'scareIntensity') {
        patch = { scareIntensity: value, intensity: value }
      }
      const nextGameplay = { ...prev.gameplay, ...patch }
      const nextAll = { ...prev, gameplay: nextGameplay }
      saveAllSettings(nextAll)
      return nextAll
    })
  }, [])

  const handleRestoreDefaults = useCallback(() => {
    const fresh = resetAllSettings()
    setSettings(fresh.settings)
  }, [])

  const handlePlayerCellChange = useCallback((cell, meta) => {
    if (levelTransitionRef.current.active || arrivalLockedRef.current) return
    dispatch({
      type: 'SYNC_PLAYER_CELL',
      position: cell,
      battery: meta?.battery,
      maxBattery: meta?.maxBattery,
    })
  }, [])

  const handleCollectItem = useCallback((item) => {
    if (levelTransitionRef.current.active || arrivalLockedRef.current) return
    dispatch({ type: 'COLLECT_ITEM', position: { row: item.row, col: item.col } })
  }, [])

  const handleActivateAbility = useCallback((abilityType) => {
    if (levelTransitionRef.current.active || arrivalLockedRef.current) return
    if (abilityType === COLLECTIBLE_TYPES.PHANTOM_VEIL) {
      dispatch({ type: 'ACTIVATE_PHANTOM_VEIL' })
    } else if (abilityType === COLLECTIBLE_TYPES.TIME_FRAGMENT) {
      dispatch({ type: 'ACTIVATE_TIME_FRAGMENT' })
    } else if (abilityType === COLLECTIBLE_TYPES.WATCHERS_EYE) {
      dispatch({ type: 'ACTIVATE_WATCHERS_EYE' })
    } else if (abilityType === COLLECTIBLE_TYPES.ECHO_PULSE) {
      dispatch({ type: 'ACTIVATE_ECHO_PULSE' })
    }
  }, [])

  const handlePlayerDamage = useCallback((damagePayload) => {
    if (levelTransitionRef.current.active || arrivalLockedRef.current) return
    const damage = Number(damagePayload?.damage) || 10
    dispatch({ type: 'DAMAGE_PLAYER', damage, enemyId: damagePayload?.enemyId || null })
  }, [])

  const handleEngineGameOver = useCallback(() => {
    if (levelTransitionRef.current.active || arrivalLockedRef.current) return
    dispatch({ type: 'DAMAGE_PLAYER', damage: 999 })
  }, [])

  const handleToggleCameraMode = useCallback(() => {
    setSettings((prev) => {
      const nextMode =
        prev.gameplay.cameraMode === CAMERA_MODES.FIRST_PERSON
          ? CAMERA_MODES.THIRD_PERSON
          : CAMERA_MODES.FIRST_PERSON
      const nextGameplay = { ...prev.gameplay, cameraMode: nextMode }
      const nextAll = { ...prev, gameplay: nextGameplay }
      saveAllSettings(nextAll)
      return nextAll
    })
  }, [])

  const handleSpawnSequenceChange = useCallback((active, detail) => {
    const nextActive = Boolean(active)
    setIsSpawnIntroActive(nextActive)
    setSpawnIntroStage(nextActive ? detail?.stage || 'ELEVATOR_DESCEND' : 'IDLE')
    if (nextActive) {
      setIsPauseOpen(false)
      setIsSettingsOpen(false)
    }
  }, [])

  const handleExtractionSequenceChange = useCallback((active) => {
    setIsExtractionActive(Boolean(active))
  }, [])

  const handleExtractionComplete = useCallback(() => {
    if (levelTransitionRef.current.active || arrivalLockedRef.current) return
    setIsPauseOpen(false)
    setIsSettingsOpen(false)
    setIsExtractionActive(false)
    const elapsedMs = typeof getElapsedMs === 'function' ? getElapsedMs() : 0
    dispatch({ type: 'COMPLETE_EXIT_EXTRACTION', completionTimeMs: elapsedMs })
  }, [getElapsedMs])

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

  const activeSandboxPayload = useMemo(
    () => (state.isSandbox ? buildSandboxRuntimePayload(state.sandboxConfig) : null),
    [state.isSandbox, state.sandboxConfig]
  )

  const engineConfig = useMemo(
    () => ({
      ...(viewportEngineConfig || {}),
      skipSpawnSequence:
        viewportEngineConfig?.skipSpawnSequence ??
        (Boolean(initialPlaying) && typeof requestAnimationFrame !== 'function'),
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
      sandbox: viewportEngineConfig?.sandbox ?? activeSandboxPayload,
    }),
    [
      initialPlaying,
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
      activeSandboxPayload,
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
    state.hasWon,
    state.lastLevelScoreSummary
  )
  const hudScore = resolveAuthoritativeHudScore({
    state,
    victorySummary: activeVictorySummary,
  })
  const victoryModalViewModel = resolveVictoryModalViewModel({
    isPlaying,
    state,
    victorySummary: activeVictorySummary,
    formattedTime: getFormattedTime(),
    isLevelTransitioning: isLevelTransitionActive || isArrivalLocked,
  })
  const isVictoryActionPending =
    pendingVictoryActionRunId === state.runId ||
    isLevelTransitionActive ||
    isArrivalLocked

  const levelTransitionMeta = useMemo(
    () => ({
      fromLevel: levelTransition.fromLevel,
      toLevel: levelTransition.toLevel,
      travelDurationSec: effectiveTransitionTimings.travelMinDurationMs / 1000,
      travelDurationMs: effectiveTransitionTimings.travelMinDurationMs,
      cancelled: Boolean(levelTransition.error),
    }),
    [
      levelTransition.fromLevel,
      levelTransition.toLevel,
      levelTransition.error,
      effectiveTransitionTimings.travelMinDurationMs,
    ]
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
      cumulativeScore: state.cumulativeScore,
      levelBaseCumulativeScore: state.levelBaseCumulativeScore,
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
    state.cumulativeScore,
    state.levelBaseCumulativeScore,
  ])

  return (
    <GameShell
      layout="viewport"
      highContrast={Boolean(settings.graphics.highContrast)}
      reducedMotion={Boolean(horrorConfig.reducedMotion)}
    >
      <main className="gameplay-stage">
        {isPlaying ? (
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
                currentLevel={state.currentLevel}
                score={hudScore}
                cumulativeScore={state.cumulativeScore}
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
                onViewportReady={handleViewportReady}
                onViewportError={setViewportError}
                isTransitioning={gameLaunchState === 'transitioning'}
                isLevelTransitioning={isLevelTransitionActive}
                levelTransitionPhase={levelTransition.phase}
                levelTransitionMeta={levelTransitionMeta}
                onLevelSceneReady={handleLevelSceneReady}
                isArrivalActive={isArrivalLocked}
                arrivalPhase={resolvedArrivalPhase}
                arrivalEntryPath={resolvedArrivalEntryPath}
                arrivalDoorProgress={resolvedArrivalDoorProgress}
                reducedMotion={Boolean(horrorConfig.reducedMotion)}
              />
            )}
          </div>
        ) : (
          <StartScreen
            key={initialStartView}
            onStartGame={handleStartGame}
            audioSettings={modalAudioSettings}
            onAudioSettingChange={handleAudioSettingChange}
            controlSettings={modalControlSettings}
            onControlSettingChange={handleControlSettingChange}
            graphicsSettings={settings.graphics}
            onGraphicsSettingChange={handleGraphicsSettingChange}
            gameplaySettings={modalGameplaySettings}
            onGameplaySettingChange={handleGameplaySettingChange}
            onRestoreDefaults={handleRestoreDefaults}
            initialView={initialStartView}
            developerAccess={developerAccess}
            sandboxConfig={sandboxConfig}
            onSandboxConfigChange={handleSandboxConfigChange}
            onResetSandboxConfig={handleResetSandboxConfig}
            onStartSandboxTest={handleStartSandboxTest}
            onSandboxViewChange={handleSandboxViewChange}
          />
        )}
      </main>

      <StartTransitionOverlay
        isOpen={gameLaunchState === 'transitioning'}
        isMazeReady={isMazeReady}
        reducedMotion={Boolean(horrorConfig.reducedMotion)}
        minDurationMs={effectiveArrivalConfig.startOverlayMinMs}
        onComplete={handleStartTransitionComplete}
      />

      <ElevatorTransitionOverlay
        transitionState={isPlaying ? levelTransition : null}
        reducedMotion={Boolean(horrorConfig.reducedMotion)}
      />

      <PauseMenuModal
        key={isPauseOpen ? 'open' : 'closed'}
        isOpen={
          isPlaying &&
          isPauseOpen &&
          !state.hasWon &&
          !state.isGameOver &&
          !isArrivalLocked
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
        isSandbox={Boolean(state.isSandbox)}
        onReturnToSandbox={
          developerAccess && state.isSandbox ? handleReturnToSandboxConfig : null
        }
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

      <VictoryModal
        isOpen={victoryModalViewModel.isOpen}
        completedLevel={victoryModalViewModel.completedLevel}
        nextLevel={victoryModalViewModel.nextLevel}
        maze={state.maze}
        victorySummary={victoryModalViewModel.victorySummary}
        cumulativeScore={victoryModalViewModel.cumulativeScore}
        formattedTime={victoryModalViewModel.formattedTime}
        shardsCollected={victoryModalViewModel.shardsCollected}
        totalShards={victoryModalViewModel.totalShards}
        isActionPending={isVictoryActionPending}
        onNextLevel={handleNextLevel}
        onReplayLevel={handleReplayCompletedLevel}
        onMainMenu={handleReturnToMainMenu}
        isSandbox={Boolean(state.isSandbox)}
        onReturnToSandbox={
          developerAccess && state.isSandbox ? handleReturnToSandboxConfig : null
        }
      />

      <Modal
        isOpen={isPlaying && state.isGameOver && !state.hasWon && !isArrivalLocked}
        onClose={handleRestartRun}
        title="Claimed by the Dark"
        subtitle="Trapped in the abandoned underground facility, you fell to the darkness, hazards, and hostile threats."
        size="md"
        showCloseButton={false}
        closeOnBackdrop={false}
        closeOnEscape={false}
        footer={
          <div className="lv-sandbox-gameover-actions">
            <Button variant="primary" onClick={handleRestartRun}>
              Try Again
            </Button>
            {developerAccess && state.isSandbox ? (
              <Button
                variant="secondary"
                onClick={handleReturnToSandboxConfig}
                data-testid="gameover-return-sandbox-btn"
              >
                Return to Sandbox
              </Button>
            ) : null}
          </div>
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
