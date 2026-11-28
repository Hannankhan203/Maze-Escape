import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createFullscreenController,
  detectTouchPrimaryInput,
  requestSafePointerLock,
  resolveShowTouchControls,
} from '../../game/three/fullscreenController.js'
import { createViewportPointerController } from '../../game/three/viewportPointerCapture.js'
import { MazeSceneEngine } from '../../game/three/MazeSceneEngine.js'
import { AUDITION_PRESETS } from '../../game/three/HorrorAudioEngine.js'
import {
  CAMERA_MODES,
  DEFAULT_THIRD_PERSON_CAMERA_DISTANCE,
  MANUAL_COLLECTIBLE_KEY_BINDING_IDS,
  formatKeyTokenLabel,
  normalizeKeyBindings,
  resolveLookInputConfig,
} from '../../game/three/threeConfig.js'
import {
  COLLECTIBLE_CONFIG,
  COLLECTIBLE_TYPES,
  MANUAL_COLLECTIBLE_TYPES,
} from '../../game/mechanics/collectiblesConfig.js'
import { useContinuousInput } from '../../hooks/useContinuousInput.js'
import Minimap3D from './Minimap3D.jsx'
import AudioSubtitlesOverlay from './AudioSubtitlesOverlay.jsx'
import TouchControls3D from './TouchControls3D.jsx'
import CenterCrosshair from './CenterCrosshair.jsx'
import { resolveCrosshairVisibility } from './centerCrosshairState.js'
import SandboxDiagnosticsModal from '../sandbox/SandboxDiagnosticsModal.jsx'
import {
  formatHudLevelAriaLabel,
  formatHudLevelDisplay,
  formatHudLevelNumber,
  resolveAuthoritativeHudLevel,
} from './levelHudFormat.js'
import { isProductionEnvironment } from '../../game/sandbox/sandboxAccess.js'

/**
 * React boundary component for the Three.js 3D maze viewport.
 *
 * Keeps DOM hosting, responsive sizing, and React lifecycle isolated from
 * game rules, maze generation, and reducer internals. Owns the MazeSceneEngine
 * mount/resize/unmount lifecycle and notifies optional `onViewportReady`
 * listeners without forcing React re-renders during the animation loop.
 */
function MazeViewport3D({
  maze = null,
  currentLevel = undefined,
  score = 0,
  cumulativeScore = 0,
  runId = 1,
  playerCell = null,
  items = [],
  keycards = [],
  keysCollected = 0,
  totalKeys = 0,
  isExitLocked = false,
  objectivesEnabled = false,
  echoPath = [],
  showSolutionPath = false,
  inventory = null,
  activeEffects = null,
  lastEvent = null,
  hasWon = false,
  controlsEnabled = true,
  health = 100,
  maxHealth = 100,
  isGameOver = false,
  audioPaused = false,
  cameraMode = 'first-person',
  thirdPersonCameraMode = undefined,
  engineConfig = null,
  onPlayerCellChange = null,
  onCollectItem = null,
  onActivateAbility = null,
  onInteract = null,
  onPlayerDamage = null,
  onGameOver = null,
  onToggleCameraMode = null,
  onSpawnSequenceChange = null,
  onExtractionSequenceChange = null,
  onExtractionComplete = null,
  onViewportReady = null,
  onViewportResize = null,
  onViewportError = null,
  isTransitioning = false,
  isLevelTransitioning = false,
  levelTransitionPhase = 'idle',
  levelTransitionMeta = null,
  onLevelSceneReady = null,
  isArrivalActive = false,
  arrivalPhase = 'idle',
  arrivalEntryPath = null,
  arrivalDoorProgress = 0,
  reducedMotion = false,
  className = '',
  children = null,
  sandboxConfig = null,
  devBrightnessOverride = undefined,
  onToggleDevBrightness = null,
  canUseDevBrightness = undefined,
  onOpenDiagnostics = null,
  onDiagnosticsOpenChange = null,
  onRestartSameSeed = null,
  onRestartNewSeed = null,
  onOpenManualEditor = null,
  onReturnToSandbox = null,
}) {
  const frameRef = useRef(null)
  const canvasHostRef = useRef(null)
  const engineRef = useRef(null)
  const [engineInstance, setEngineInstance] = useState(null)
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false)
  const prevSyncRef = useRef({
    maze,
    runId,
    items,
    keycards,
    echoPath,
    isExitLocked,
  })
  const lastEventRef = useRef(lastEvent)
  const wallPassLockRef = useRef(false)
  const manualPointerGuardRef = useRef({})
  const manualActivationSeqRef = useRef(0)
  const onReadyRef = useRef(onViewportReady)
  const onResizeRef = useRef(onViewportResize)
  const onErrorRef = useRef(onViewportError)
  const onInteractRef = useRef(onInteract)
  const onActivateAbilityRef = useRef(onActivateAbility)
  const onSpawnSequenceChangeRef = useRef(onSpawnSequenceChange)
  const onExtractionSequenceChangeRef = useRef(onExtractionSequenceChange)
  const onExtractionCompleteRef = useRef(onExtractionComplete)
  const onLevelSceneReadyRef = useRef(onLevelSceneReady)

  const [isSpawnSequenceActive, setIsSpawnSequenceActive] = useState(false)
  const [isExtractionSequenceActive, setIsExtractionSequenceActive] = useState(false)
  const [damageFlashState, setDamageFlashState] = useState({ runId, active: false })
  const [floatingDamageState, setFloatingDamageState] = useState({ runId, text: null })
  const [immunityState, setImmunityState] = useState({ runId, active: false })
  const [stealthState, setStealthState] = useState({
    canInteract: false,
    nearbyInteractableKind: null,
    nearbyInteractableId: null,
    nearbyInteractableType: null,
    nearbyInteractableLabel: null,
    nearbyInteractableShortLabel: null,
    isHiding: false,
    hidingSpotId: null,
    hidingSpotType: null,
    hidingSpotLabel: null,
    hidingExposure: 0,
    hidingTimeRemainingSec: 0,
    hidingWarning: false,
    hidingFlashlightLeak: false,
    hidingCompromised: false,
  })
  const [horrorPulseState, setHorrorPulseState] = useState({ runId, type: null })
  const [fullscreenState, setFullscreenState] = useState({
    supported: false,
    isFullscreen: false,
    showEscHint: false,
  })
  const fullscreenControllerRef = useRef(null)
  const runIdRef = useRef(runId)
  const damageFlashTimeoutRef = useRef(null)
  const immunityTimeoutRef = useRef(null)
  const floatingDamageTimeoutRef = useRef(null)
  const horrorPulseTimeoutRef = useRef(null)

  const damageFlash = damageFlashState.runId === runId && damageFlashState.active
  const floatingDamage =
    floatingDamageState.runId === runId ? floatingDamageState.text : null
  const isImmune = immunityState.runId === runId && immunityState.active
  const horrorPulse =
    horrorPulseState.runId === runId ? horrorPulseState.type : null

  const [flashlightActive, setFlashlightActive] = useState(false)
  const [isPointerLocked, setIsPointerLocked] = useState(false)
  const [audioEngineState, setAudioEngineState] = useState(null)
  const [localCameraState, setLocalCameraState] = useState({
    prop: cameraMode,
    value: cameraMode,
  })
  const resolvedCameraMode =
    typeof onToggleCameraMode === 'function'
      ? cameraMode
      : localCameraState.prop === cameraMode
        ? localCameraState.value
        : cameraMode

  const [cameraDistancePreset, setCameraDistancePreset] = useState(
    () =>
      engineConfig?.camera?.cameraDistancePreset ??
      engineConfig?.cameraDistancePreset ??
      DEFAULT_THIRD_PERSON_CAMERA_DISTANCE
  )
  const [isTouchDevice, setIsTouchDevice] = useState(() =>
    detectTouchPrimaryInput()
  )
  const [hasUsedTouchControls, setHasUsedTouchControls] = useState(false)
  const [dismissedGateNoticeId, setDismissedGateNoticeId] = useState(null)
  const [dismissedPickupNoticeId, setDismissedPickupNoticeId] = useState(null)
  const minimapRef = useRef(null)
  const staminaHudRef = useRef(null)
  const staminaNumericRef = useRef(null)
  const batteryHudRef = useRef(null)
  const batteryNumericRef = useRef(null)
  const auditionResetTimerRef = useRef(null)
  const [activeAuditionState, setActiveAuditionState] = useState(null)
  const [auditionCategoryFilter, setAuditionCategoryFilter] = useState('all')

  const showDevAuditionPanel =
    Boolean(import.meta.env?.DEV) &&
    (engineConfig?.audio?.auditionPanel === true ||
      (typeof window !== 'undefined' &&
        (() => {
          try {
            const params = new URLSearchParams(window.location.search)
            return params.get('audioDebug') === '1'
          } catch {
            return false
          }
        })()))

  const isSandboxMode = Boolean(
    maze?.isSandbox ||
      maze?.gameMode === 'sandbox' ||
      engineConfig?.sandbox?.isSandbox ||
      engineConfig?.sandbox?.enabled
  )
  const sandboxBrightnessAllowed = Boolean(
    isSandboxMode &&
      !isProductionEnvironment() &&
      (canUseDevBrightness !== undefined ? canUseDevBrightness : true)
  )
  const [localDevBrightness, setLocalDevBrightness] = useState({
    allowed: sandboxBrightnessAllowed,
    enabled: false,
  })
  const resolvedLocalDevBrightness =
    sandboxBrightnessAllowed && localDevBrightness.allowed === sandboxBrightnessAllowed
      ? localDevBrightness.enabled
      : false
  const resolvedDevBrightness = sandboxBrightnessAllowed
    ? typeof onToggleDevBrightness === 'function'
      ? Boolean(devBrightnessOverride)
      : resolvedLocalDevBrightness
    : false

  const handleToggleDevBrightness = useCallback(() => {
    if (!sandboxBrightnessAllowed) return
    if (typeof onToggleDevBrightness === 'function') {
      onToggleDevBrightness()
    } else {
      setLocalDevBrightness((prev) => ({
        allowed: sandboxBrightnessAllowed,
        enabled:
          prev.allowed === sandboxBrightnessAllowed ? !prev.enabled : true,
      }))
    }
  }, [sandboxBrightnessAllowed, onToggleDevBrightness])

  useEffect(() => {
    engineRef.current?.setDevBrightnessOverride?.(
      Boolean(sandboxBrightnessAllowed && resolvedDevBrightness)
    )
  }, [sandboxBrightnessAllowed, resolvedDevBrightness, maze])

  useEffect(() => {
    if (!isSandboxMode || typeof window === 'undefined') return undefined
    const handleKeyDown = (e) => {
      if (
        e.target &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT')
      ) {
        return
      }
      if (hasWon || isGameOver) return
      const isF1 = e.key === 'F1'
      const isShiftD = e.shiftKey && (e.key === 'd' || e.key === 'D')
      if ((isF1 || isShiftD) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setShowDiagnosticsModal((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSandboxMode, hasWon, isGameOver])

  useEffect(() => {
    onDiagnosticsOpenChange?.(Boolean(isSandboxMode && showDiagnosticsModal))
  }, [isSandboxMode, showDiagnosticsModal, onDiagnosticsOpenChange])

  const handleAuditionCue = useCallback((presetId) => {
    const engine = engineRef.current
    if (!engine) return null
    if (auditionResetTimerRef.current) {
      clearTimeout(auditionResetTimerRef.current)
      auditionResetTimerRef.current = null
    }
    engine.unlockAudio?.()
    const result = engine.auditionCue?.(presetId) || null
    if (result?.played) {
      setActiveAuditionState(result)
      const clearMs = Math.max(220, Math.ceil((result.durationSec || 0.4) * 1000) + 60)
      auditionResetTimerRef.current = setTimeout(() => {
        setActiveAuditionState((prev) =>
          prev?.presetId === result.presetId ? null : prev
        )
        auditionResetTimerRef.current = null
      }, clearMs)
    } else {
      setActiveAuditionState(null)
    }
    return result
  }, [])

  const handleStopAudition = useCallback(() => {
    if (auditionResetTimerRef.current) {
      clearTimeout(auditionResetTimerRef.current)
      auditionResetTimerRef.current = null
    }
    setActiveAuditionState(null)
    return Boolean(engineRef.current?.stopAudition?.({ immediate: true }))
  }, [])

  const handleTouchInteract = useCallback(() => {
    const engine = engineRef.current
    if (engine) {
      if (
        engine.isSpawnSequenceActive?.() ||
        engine.isExtractionSequenceActive?.() ||
        engine.isLevelTransitionActive?.() ||
        engine.isArrivalActive?.()
      ) {
        return
      }
      engine.unlockAudio()
      if (engine.hidingSpotManager?.isPlayerHiding?.()) {
        engine.handleSecondaryAction()
      } else {
        engine.handlePrimaryAction()
      }
    }
    onInteractRef.current?.()
  }, [])

  const handleEngineActivateAbility = useCallback((abilityType, meta) => {
    if (
      engineRef.current?.isSpawnSequenceActive?.() ||
      engineRef.current?.isExtractionSequenceActive?.() ||
      engineRef.current?.isLevelTransitionActive?.() ||
      engineRef.current?.isArrivalActive?.()
    ) {
      return
    }
    onActivateAbilityRef.current?.(abilityType, meta)
  }, [])

  const handleToggleFlashlight = useCallback(() => {
    const engine = engineRef.current
    if (engine) {
      engine.unlockAudio()
      const nextActive = engine.toggleFlashlight()
      setFlashlightActive(nextActive)
    }
  }, [])

  const handleCycleCameraDistance = useCallback(() => {
    engineRef.current?.cycleCameraDistance()
  }, [])

  const handleToggleCameraMode = useCallback(() => {
    if (typeof onToggleCameraMode === 'function') {
      onToggleCameraMode()
      return
    }
    const engineNext = engineRef.current?.toggleCameraMode?.()
    if (engineNext) {
      setLocalCameraState({ prop: cameraMode, value: engineNext })
      return
    }
    setLocalCameraState((prev) => {
      const current = prev.prop === cameraMode ? prev.value : cameraMode
      return {
        prop: cameraMode,
        value:
          current === CAMERA_MODES.THIRD_PERSON
            ? CAMERA_MODES.FIRST_PERSON
            : CAMERA_MODES.THIRD_PERSON,
      }
    })
  }, [onToggleCameraMode, cameraMode])

  const isArrivalLocked = Boolean(
    isTransitioning ||
      isSpawnSequenceActive ||
      isLevelTransitioning ||
      isArrivalActive
  )
  const isEngineAnimatedSequence = Boolean(
    isSpawnSequenceActive ||
      isLevelTransitioning ||
      isArrivalActive ||
      isExtractionSequenceActive
  )
  const isInteractive =
    Boolean(controlsEnabled) &&
    !showDiagnosticsModal &&
    !hasWon &&
    !isGameOver &&
    !isLevelTransitioning &&
    !isArrivalLocked &&
    !isExtractionSequenceActive

  const wayfinderEnabled = engineConfig?.wayfinderGuide !== false

  const handleTriggerWayfinder = useCallback(() => {
    if (!wayfinderEnabled || !isInteractive) {
      return null
    }
    if (
      engineRef.current?.isSpawnSequenceActive?.() ||
      engineRef.current?.isExtractionSequenceActive?.() ||
      engineRef.current?.isLevelTransitionActive?.() ||
      engineRef.current?.isArrivalActive?.()
    ) {
      return null
    }
    return minimapRef.current?.triggerHint?.() || null
  }, [wayfinderEnabled, isInteractive])
  const {
    inputRef,
    setTouchMovement,
    setTouchSprint,
    setTouchInteract,
    triggerAbility,
    resetTouch,
    reset: resetContinuousInput,
  } = useContinuousInput({
    enabled: isInteractive,
    keyBindings: engineConfig?.keyBindings,
    onActivateAbility: handleEngineActivateAbility,
    onToggleFlashlight: handleToggleFlashlight,
    onTriggerWayfinder: handleTriggerWayfinder,
    onCycleCameraDistance: handleCycleCameraDistance,
    onToggleCameraMode: handleToggleCameraMode,
  })

  const resolvedThirdPersonMode =
    thirdPersonCameraMode ??
    engineConfig?.camera?.thirdPersonCameraMode ??
    engineConfig?.camera?.thirdPersonMode ??
    'character-follow'

  const latestPropsRef = useRef({
    maze,
    currentLevel,
    score,
    cumulativeScore,
    playerCell,
    items,
    keycards,
    keysCollected,
    totalKeys,
    isExitLocked,
    objectivesEnabled,
    echoPath,
    showSolutionPath,
    activeEffects,
    hasWon,
    health,
    maxHealth,
    isGameOver,
    controlsEnabled,
    showDiagnosticsModal,
    isArrivalLocked,
    isEngineAnimatedSequence,
    arrivalPhase,
    arrivalEntryPath,
    arrivalDoorProgress,
    reducedMotion,
    audioPaused,
    cameraMode: resolvedCameraMode,
    thirdPersonCameraMode: resolvedThirdPersonMode,
    engineConfig,
    onPlayerCellChange,
    onCollectItem,
    onInteract,
    onPlayerDamage,
    onGameOver,
    onExtractionComplete,
  })

  const handleTriggerDamageFeedback = useCallback((amount) => {
    const activeRunId = runIdRef.current
    setDamageFlashState({ runId: activeRunId, active: true })
    setFloatingDamageState({ runId: activeRunId, text: `-${amount} HP` })
    setImmunityState({ runId: activeRunId, active: true })

    if (damageFlashTimeoutRef.current) clearTimeout(damageFlashTimeoutRef.current)
    damageFlashTimeoutRef.current = setTimeout(() => {
      setDamageFlashState({ runId: activeRunId, active: false })
    }, 450)

    if (floatingDamageTimeoutRef.current) clearTimeout(floatingDamageTimeoutRef.current)
    floatingDamageTimeoutRef.current = setTimeout(() => {
      setFloatingDamageState({ runId: activeRunId, text: null })
    }, 900)

    if (immunityTimeoutRef.current) clearTimeout(immunityTimeoutRef.current)
    immunityTimeoutRef.current = setTimeout(() => {
      setImmunityState({ runId: activeRunId, active: false })
    }, 1200)
  }, [])

  const triggerDamageFeedbackRef = useRef(handleTriggerDamageFeedback)
  useEffect(() => {
    triggerDamageFeedbackRef.current = handleTriggerDamageFeedback
  }, [handleTriggerDamageFeedback])

  useEffect(() => {
    runIdRef.current = runId
  }, [runId])

  useEffect(() => {
    return () => {
      if (damageFlashTimeoutRef.current) clearTimeout(damageFlashTimeoutRef.current)
      if (immunityTimeoutRef.current) clearTimeout(immunityTimeoutRef.current)
      if (floatingDamageTimeoutRef.current) clearTimeout(floatingDamageTimeoutRef.current)
      if (horrorPulseTimeoutRef.current) clearTimeout(horrorPulseTimeoutRef.current)
      if (auditionResetTimerRef.current) clearTimeout(auditionResetTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env?.DEV) {
      return undefined
    }
    const api = {
      getPresets: () =>
        engineRef.current?.getAuditionPresets?.() || AUDITION_PRESETS,
      play: (presetId = 'enemy_vocal_stalker') =>
        handleAuditionCue(presetId),
      stop: () => handleStopAudition(),
      getState: () => engineRef.current?.getAudioState?.() || null,
    }
    window.__MAZE_AUDIO_AUDITION__ = api
    return () => {
      if (window.__MAZE_AUDIO_AUDITION__ === api) {
        delete window.__MAZE_AUDIO_AUDITION__
      }
    }
  }, [handleAuditionCue, handleStopAudition])

  useEffect(() => {
    onReadyRef.current = onViewportReady
  }, [onViewportReady])

  useEffect(() => {
    onResizeRef.current = onViewportResize
  }, [onViewportResize])

  useEffect(() => {
    onErrorRef.current = onViewportError
  }, [onViewportError])

  useEffect(() => {
    onInteractRef.current = onInteract
  }, [onInteract])

  useEffect(() => {
    onActivateAbilityRef.current = onActivateAbility
  }, [onActivateAbility])

  useEffect(() => {
    onSpawnSequenceChangeRef.current = onSpawnSequenceChange
  }, [onSpawnSequenceChange])

  useEffect(() => {
    onExtractionSequenceChangeRef.current = onExtractionSequenceChange
  }, [onExtractionSequenceChange])

  useEffect(() => {
    onExtractionCompleteRef.current = onExtractionComplete
  }, [onExtractionComplete])

  useEffect(() => {
    onLevelSceneReadyRef.current = onLevelSceneReady
  }, [onLevelSceneReady])

  useEffect(() => {
    latestPropsRef.current = {
      maze,
      currentLevel,
      score,
      cumulativeScore,
      playerCell,
      items,
      keycards,
      keysCollected,
      totalKeys,
      isExitLocked,
      objectivesEnabled,
      echoPath,
      showSolutionPath,
      activeEffects,
      hasWon,
      health,
      maxHealth,
      isGameOver,
      controlsEnabled,
      showDiagnosticsModal,
      isArrivalLocked,
      isEngineAnimatedSequence,
      arrivalPhase,
      arrivalEntryPath,
      arrivalDoorProgress,
      reducedMotion,
      audioPaused,
      cameraMode: resolvedCameraMode,
      thirdPersonCameraMode: resolvedThirdPersonMode,
      devBrightnessOverride: resolvedDevBrightness,
      engineConfig,
      onPlayerCellChange,
      onCollectItem,
      onInteract,
      onPlayerDamage,
      onGameOver,
      onExtractionComplete,
    }
  }, [
    maze,
    currentLevel,
    score,
    cumulativeScore,
    playerCell,
    items,
    keycards,
    keysCollected,
    totalKeys,
    isExitLocked,
    objectivesEnabled,
    echoPath,
    showSolutionPath,
    activeEffects,
    hasWon,
    health,
    maxHealth,
    isGameOver,
    controlsEnabled,
    showDiagnosticsModal,
    isArrivalLocked,
    isEngineAnimatedSequence,
    arrivalPhase,
    arrivalEntryPath,
    arrivalDoorProgress,
    reducedMotion,
    audioPaused,
    resolvedCameraMode,
    resolvedThirdPersonMode,
    resolvedDevBrightness,
    engineConfig,
    onPlayerCellChange,
    onCollectItem,
    onInteract,
    onPlayerDamage,
    onGameOver,
    onExtractionComplete,
  ])

  useEffect(() => {
    const canvasHost = canvasHostRef.current
    if (!canvasHost || typeof ResizeObserver !== 'function') {
      return undefined
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      engineRef.current?.resize(width, height)
      onResizeRef.current?.({ width, height })
    })

    observer.observe(canvasHost)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const syncTouchCapability = () => {
      setIsTouchDevice(detectTouchPrimaryInput())
    }
    syncTouchCapability()
    window.addEventListener('resize', syncTouchCapability, { passive: true })
    return () => {
      window.removeEventListener('resize', syncTouchCapability)
    }
  }, [])

  useEffect(() => {
    const controller = createFullscreenController({
      getElement: () => frameRef.current,
      getCanvasHost: () => canvasHostRef.current,
      onStateChange: (nextState) => {
        setFullscreenState(nextState)
      },
      onResize: ({ width, height }) => {
        engineRef.current?.resize(width, height)
        onResizeRef.current?.({ width, height })
      },
    })
    fullscreenControllerRef.current = controller

    return () => {
      if (fullscreenControllerRef.current === controller) {
        fullscreenControllerRef.current = null
      }
      controller.dispose()
    }
  }, [])

  useEffect(() => {
    if (!activeEffects?.wallPassArmed) {
      wallPassLockRef.current = false
    }
  }, [activeEffects?.wallPassArmed])

  useEffect(() => {
    const canvasHost = canvasHostRef.current
    if (!canvasHost) return undefined

    let engine = null
    let userCleanup = null
    let isCancelled = false
    let rafId1 = null
    let rafId2 = null

    const hasRaf = typeof requestAnimationFrame === 'function'
    const scheduleInit = (cb) => {
      if (hasRaf) {
        rafId1 = requestAnimationFrame(() => {
          if (isCancelled || !canvasHostRef.current) return
          rafId2 = requestAnimationFrame(cb)
        })
        return
      }
      cb()
    }

    scheduleInit(() => {
      if (isCancelled || !canvasHostRef.current) return

      try {
        const initialConfig = {
            ...(latestPropsRef.current.engineConfig || {}),
            cameraMode: latestPropsRef.current.cameraMode,
            thirdPersonCameraMode: latestPropsRef.current.thirdPersonCameraMode,
            initialHealth: latestPropsRef.current.health,
            maxHealth: latestPropsRef.current.maxHealth,
            onPlayerDamage: (event) => {
              if (!event?.absorbedByWardingCharm) {
                triggerDamageFeedbackRef.current?.(event.damage)
              }
              latestPropsRef.current.onPlayerDamage?.(event)
            },
            onCollectItem: (entry) => {
              latestPropsRef.current.onCollectItem?.(entry)
            },
            onGameOver: (event) => {
              latestPropsRef.current.onGameOver?.(event)
            },
            onStealthChange: (nextStealth) => {
              setStealthState(nextStealth)
            },
            onFlashlightChange: (isActive) => {
              setFlashlightActive(isActive)
            },
            onCameraDistanceChange: (nextPreset) => {
              setCameraDistancePreset(nextPreset)
            },
            onSpawnSequenceChange: (active, detail) => {
              const nextActive = Boolean(active)
              setIsSpawnSequenceActive(nextActive)
              onSpawnSequenceChangeRef.current?.(nextActive, detail)
            },
            onExtractionSequenceChange: (active, detail) => {
              const nextActive = Boolean(active)
              setIsExtractionSequenceActive(nextActive)
              onExtractionSequenceChangeRef.current?.(nextActive, detail)
            },
            onExtractionComplete: (detail) => {
              onExtractionCompleteRef.current?.(detail)
            },
            onHorrorEvent: (event) => {
              if (
                event &&
                event.visualScaresEnabled &&
                !event.reducedMotion &&
                (event.type === 'presence_warning' ||
                  event.type === 'blackout' ||
                  event.type === 'scripted_scare')
              ) {
                const activeRunId = runIdRef.current
                setHorrorPulseState({ runId: activeRunId, type: event.type })
                if (horrorPulseTimeoutRef.current) clearTimeout(horrorPulseTimeoutRef.current)
                horrorPulseTimeoutRef.current = setTimeout(() => {
                  setHorrorPulseState({ runId: activeRunId, type: null })
                }, Math.min(2600, Math.round((event.duration || 1.6) * 850)))
              }
            },
          }
          engine = new MazeSceneEngine(canvasHost, initialConfig)
          if (isCancelled) {
            try {
              engine.dispose()
            } catch {
              // Ignore cancellation disposal error
            }
            return
          }
          engineRef.current = engine
          setEngineInstance(engine)
          engine.unlockAudio?.()
          if (
            initialConfig.controlsEnabled !== false &&
            latestPropsRef.current.controlsEnabled &&
            !latestPropsRef.current.isArrivalLocked
          ) {
            void requestSafePointerLock(canvasHost)
          }
          setAudioEngineState(engine.audioEngine || null)
          setCameraDistancePreset(
            engine.getCameraDistancePreset() || DEFAULT_THIRD_PERSON_CAMERA_DISTANCE
          )
          if (
            latestPropsRef.current.audioPaused ||
            (!latestPropsRef.current.controlsEnabled &&
              !latestPropsRef.current.isEngineAnimatedSequence)
          ) {
            engine.setPaused(true)
          }

          let lastStaminaPct = null
          let lastStaminaLevel = null
          let lastBatteryPct = null
          let lastBatteryLevel = null
          let lastBatteryActive = null

          engine.setFrameCallback((frameData) => {
            if (!frameData) return
            const staminaPct = Math.round(
              Math.max(0, Math.min(100, (frameData.stamina / (frameData.maxStamina || 100)) * 100))
            )
            const staminaLevel = frameData.isExhausted
              ? 'exhausted'
              : staminaPct <= 30
                ? 'warning'
                : 'normal'
            if (staminaHudRef.current && staminaLevel !== lastStaminaLevel) {
              staminaHudRef.current.dataset.level = staminaLevel
              lastStaminaLevel = staminaLevel
            }
            if (staminaNumericRef.current && staminaPct !== lastStaminaPct) {
              staminaNumericRef.current.textContent = `${staminaPct}%`
              lastStaminaPct = staminaPct
            }

            const batteryPct = Math.round(
              Math.max(0, Math.min(100, (frameData.battery / (frameData.maxBattery || 100)) * 100))
            )
            const batteryActive = Boolean(frameData.flashlightActive)
            const batteryLevel =
              batteryPct <= 20 ? 'critical' : batteryPct <= 45 ? 'warning' : 'normal'
            if (batteryHudRef.current) {
              if (batteryActive !== lastBatteryActive) {
                batteryHudRef.current.dataset.active = String(batteryActive)
                lastBatteryActive = batteryActive
              }
              if (batteryLevel !== lastBatteryLevel) {
                batteryHudRef.current.dataset.level = batteryLevel
                lastBatteryLevel = batteryLevel
              }
            }
            if (batteryNumericRef.current && batteryPct !== lastBatteryPct) {
              batteryNumericRef.current.textContent = `${batteryPct}%`
              lastBatteryPct = batteryPct
            }

            minimapRef.current?.syncFrame(frameData)
          })

          if (latestPropsRef.current.maze) {
            engine.setMaze(latestPropsRef.current.maze)
            engine.syncCollectibles({
              items: latestPropsRef.current.items,
              keycards: latestPropsRef.current.keycards,
              echoPath: latestPropsRef.current.echoPath,
              spawnBursts: false,
              isReset: true,
            })
            engine.setExitLocked(latestPropsRef.current.isExitLocked, {
              animate: false,
            })
          }
          engine.setDevBrightnessOverride?.(
            Boolean(latestPropsRef.current.devBrightnessOverride)
          )

          const initialCell = latestPropsRef.current.playerCell
          if (
            initialCell &&
            Number.isInteger(initialCell.row) &&
            Number.isInteger(initialCell.col)
          ) {
            const engineCell = engine.getPlayerGridCell()
            if (
              !engineCell ||
              engineCell.row !== initialCell.row ||
              engineCell.col !== initialCell.col
            ) {
              engine.setPlayerGridPosition(initialCell.row, initialCell.col, {
                immediate: true,
              })
            }
          }
          const initialSpawnActive = Boolean(engine.isSpawnSequenceActive?.())
          const initialArrivalLocked = Boolean(
            latestPropsRef.current.isArrivalLocked || initialSpawnActive
          )
          engine.setArrivalState?.({
            active: initialArrivalLocked,
            phase: initialArrivalLocked
              ? latestPropsRef.current.arrivalPhase || 'elevator_arrival'
              : 'idle',
            entryPath: latestPropsRef.current.arrivalEntryPath,
            lockLook: initialArrivalLocked,
            doorProgress: latestPropsRef.current.arrivalDoorProgress,
            reducedMotion: Boolean(latestPropsRef.current.reducedMotion),
          })
          setIsSpawnSequenceActive(initialSpawnActive)
          onSpawnSequenceChangeRef.current?.(
            initialSpawnActive,
            engine.getSpawnSequenceState?.()
          )
          const initialExtractionActive = Boolean(engine.isExtractionSequenceActive?.())
          setIsExtractionSequenceActive(initialExtractionActive)
          onExtractionSequenceChangeRef.current?.(
            initialExtractionActive,
            engine.getExtractionSequenceState?.()
          )

          engine.setMovementOptions({
            getWallPassArmed: () =>
              Boolean(latestPropsRef.current.activeEffects?.wallPassArmed) &&
              !wallPassLockRef.current,
            onPlayerCellChange: (cell, meta) => {
              if (meta?.usedWallPass) {
                wallPassLockRef.current = true
              }
              latestPropsRef.current.onPlayerCellChange?.(cell, {
                ...(meta || {}),
                battery: Number.isFinite(meta?.battery) ? meta.battery : engine.battery,
                maxBattery: Number.isFinite(meta?.maxBattery)
                  ? meta.maxBattery
                  : engine.maxBattery,
              })
            },
          })

          engine.setInputSource(() => {
            const props = latestPropsRef.current
            if (
              !props.controlsEnabled ||
              props.hasWon ||
              props.isGameOver ||
              props.isArrivalLocked
            ) {
              return null
            }
            return inputRef.current
          })

          engine.start()

          userCleanup = onReadyRef.current?.({
            container: frameRef.current,
            canvasHost,
            engine,
            getLatestProps: () => latestPropsRef.current,
          })
        } catch (error) {
          if (engine) {
            try {
              engine.dispose()
            } catch {
              // Ignore secondary cleanup errors during initialization failure
            }
          }
          if (engineRef.current === engine) {
            engineRef.current = null
            setEngineInstance(null)
            setAudioEngineState(null)
          }
          onErrorRef.current?.(error)
        }
      })

    return () => {
      isCancelled = true
      if (typeof cancelAnimationFrame === 'function') {
        if (rafId1) cancelAnimationFrame(rafId1)
        if (rafId2) cancelAnimationFrame(rafId2)
      }
      resetContinuousInput()
      wallPassLockRef.current = false
      if (typeof userCleanup === 'function') {
        userCleanup()
      }
      if (engine) {
        try {
          engine.dispose()
        } catch {
          // Ignore engine disposal cleanup error
        }
      }
      if (engineRef.current === engine) {
        engineRef.current = null
        setEngineInstance(null)
        setAudioEngineState(null)
      }
    }
  }, [inputRef, resetContinuousInput])

  // Optional drag-look & rubble mouse interaction support with safe pointer capture
  useEffect(() => {
    const canvasHost = canvasHostRef.current
    if (!canvasHost || typeof canvasHost.addEventListener !== 'function') {
      return undefined
    }

    const pointerController = createViewportPointerController({
      canvasHost,
      doc: typeof document !== 'undefined' ? document : null,
      getEngine: () => engineRef.current,
      getLatestProps: () => latestPropsRef.current,
      resolveLookInputConfig,
      onTouchControlsChange: (usedTouch) => setHasUsedTouchControls(Boolean(usedTouch)),
    })

    pointerController.attach()
    return () => {
      pointerController.detach()
    }
  }, [])

  // Desktop Pointer Lock Mouse Look
  useEffect(() => {
    const canvasHost = canvasHostRef.current
    if (!canvasHost || typeof canvasHost.addEventListener !== 'function') {
      return undefined
    }

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === canvasHost
      setIsPointerLocked(locked)
      if (frameRef.current) {
        frameRef.current.dataset.pointerLocked = String(locked)
      }
    }

    const handleStageClick = (event) => {
      const props = latestPropsRef.current
      if (
        !props.controlsEnabled ||
        props.showDiagnosticsModal ||
        props.hasWon ||
        props.isGameOver ||
        props.isArrivalLocked
      ) {
        return
      }
      if (engineConfig?.pointerLockEnabled === false) return
      if (
        event.target?.closest?.(
          '[data-touch-control="true"], [data-viewport-control="true"], button, input, select, textarea, a, .maze-preview-bar, .maze-toolbar'
        )
      ) {
        return
      }
      if (document.pointerLockElement !== canvasHost) {
        void requestSafePointerLock(canvasHost)
      }
    }

    const handleMouseMove = (event) => {
      if (document.pointerLockElement !== canvasHost) return
      const props = latestPropsRef.current
      if (
        !props.controlsEnabled ||
        props.showDiagnosticsModal ||
        props.hasWon ||
        props.isGameOver ||
        props.isArrivalLocked
      ) {
        if (typeof document.exitPointerLock === 'function') {
          try {
            document.exitPointerLock()
          } catch {
            // Ignore exit pointer lock failures
          }
        }
        return
      }

      const dx = Number(event.movementX) || 0
      const dy = Number(event.movementY) || 0
      if (dx === 0 && dy === 0) return

      const { sensitivity, invertY } = resolveLookInputConfig(props.engineConfig)

      engineRef.current?.applyLookDelta(dx, dy, { sensitivity, invertY })
    }

    canvasHost.addEventListener('click', handleStageClick)
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    document.addEventListener('mousemove', handleMouseMove)

    return () => {
      canvasHost.removeEventListener('click', handleStageClick)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      document.removeEventListener('mousemove', handleMouseMove)
      if (
        document.pointerLockElement === canvasHost &&
        typeof document.exitPointerLock === 'function'
      ) {
        try {
          document.exitPointerLock()
        } catch {
          // Ignore exit pointer lock failures on cleanup
        }
      }
    }
  }, [engineConfig?.pointerLockEnabled])

  useEffect(() => {
    if (
      !isInteractive &&
      typeof document !== 'undefined' &&
      document.pointerLockElement === canvasHostRef.current &&
      typeof document.exitPointerLock === 'function'
    ) {
      try {
        document.exitPointerLock()
      } catch {
        // Ignore exit pointer lock failures when disabling controls
      }
    }
  }, [isInteractive])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setLevelTransitionState?.({
      active: Boolean(isLevelTransitioning),
      phase: isLevelTransitioning ? levelTransitionPhase : 'idle',
      fromLevel: levelTransitionMeta?.fromLevel,
      toLevel: levelTransitionMeta?.toLevel,
      travelDurationSec: levelTransitionMeta?.travelDurationSec,
      travelDurationMs: levelTransitionMeta?.travelDurationMs,
      doorProgress: arrivalDoorProgress,
      cancelled: Boolean(levelTransitionMeta?.cancelled),
    })
    if (isLevelTransitioning) {
      resetContinuousInput()
    }
  }, [
    isLevelTransitioning,
    levelTransitionPhase,
    levelTransitionMeta?.fromLevel,
    levelTransitionMeta?.toLevel,
    levelTransitionMeta?.travelDurationSec,
    levelTransitionMeta?.travelDurationMs,
    levelTransitionMeta?.cancelled,
    arrivalDoorProgress,
    resetContinuousInput,
  ])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setArrivalState?.({
      active: Boolean(isArrivalLocked),
      phase: isArrivalLocked ? arrivalPhase : 'idle',
      entryPath: arrivalEntryPath,
      lockLook: Boolean(isArrivalLocked),
      doorProgress: arrivalDoorProgress,
      reducedMotion: Boolean(reducedMotion),
    })
    if (isArrivalLocked) {
      resetContinuousInput()
    }
  }, [
    isArrivalLocked,
    arrivalPhase,
    arrivalEntryPath,
    arrivalDoorProgress,
    reducedMotion,
    resetContinuousInput,
  ])

  const sandboxProp = engineConfig?.sandbox || null
  useEffect(() => {
    engineRef.current?.setSandboxConfig?.(sandboxProp)
  }, [sandboxProp])

  useEffect(() => {
    wallPassLockRef.current = false
    resetContinuousInput()
    engineRef.current?.setSandboxConfig?.(
      latestPropsRef.current?.engineConfig?.sandbox || null
    )
    engineRef.current?.setMaze(maze)
  }, [maze, resetContinuousInput])

  useEffect(() => {
    lastEventRef.current = lastEvent
  }, [lastEvent])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const prev = prevSyncRef.current
    const isMazeChange = prev.maze !== maze
    const isRunChange = prev.runId !== runId
    const isFullReset = isMazeChange || isRunChange
    const isReset = isFullReset || lastEventRef.current === null
    const canAnimate = !isReset

    const syncPayload = {}
    let hasCollectibleUpdates = false

    if (isFullReset || prev.items !== items) {
      syncPayload.items = items
      hasCollectibleUpdates = true
    }
    if (isFullReset || prev.keycards !== keycards) {
      syncPayload.keycards = keycards
      hasCollectibleUpdates = true
    }

    const echoPathChanged = isFullReset || prev.echoPath !== echoPath
    if (hasCollectibleUpdates) {
      syncPayload.spawnBursts = canAnimate
      syncPayload.isReset = isReset
      if (echoPathChanged) {
        syncPayload.echoPath = echoPath
      }
      engine.syncCollectibles(syncPayload)
    } else if (echoPathChanged) {
      engine.syncEchoPath(echoPath)
    }

    if (isFullReset || prev.isExitLocked !== isExitLocked) {
      engine.setExitLocked(isExitLocked, {
        animate: canAnimate,
      })
    }

    if (isFullReset) {
      wallPassLockRef.current = false
      resetContinuousInput()
      if (damageFlashTimeoutRef.current) {
        clearTimeout(damageFlashTimeoutRef.current)
        damageFlashTimeoutRef.current = null
      }
      if (immunityTimeoutRef.current) {
        clearTimeout(immunityTimeoutRef.current)
        immunityTimeoutRef.current = null
      }
      if (floatingDamageTimeoutRef.current) {
        clearTimeout(floatingDamageTimeoutRef.current)
        floatingDamageTimeoutRef.current = null
      }
      if (horrorPulseTimeoutRef.current) {
        clearTimeout(horrorPulseTimeoutRef.current)
        horrorPulseTimeoutRef.current = null
      }
      if (!isMazeChange && isRunChange) {
        engine.resetCombat({
          preserveSpawnSequence: true,
          restartSpawnSequence: !engine.config?.skipSpawnSequence,
          resetPlayerPosition: true,
        })
      } else {
        engine.resetCombat({ preserveSpawnSequence: true })
      }
      if (isMazeChange && engine.isLevelTransitionActive?.()) {
        engine.renderFrame?.()
      }
      onLevelSceneReadyRef.current?.({
        maze,
        runId,
        level: maze?.level ?? null,
        isMazeChange,
      })
    }

    prevSyncRef.current = {
      maze,
      runId,
      items,
      keycards,
      echoPath,
      isExitLocked,
    }
  }, [maze, runId, items, keycards, isExitLocked, echoPath, resetContinuousInput])

  useEffect(() => {
    if (!lastEvent) return undefined
    engineRef.current?.handleGameEvent(lastEvent)

    if (
      lastEvent.type === 'item_collected' &&
      lastEvent.item?.type === 'energy_cell' &&
      Number.isFinite(lastEvent.battery)
    ) {
      engineRef.current?.setBattery?.(lastEvent.battery)
    }

    if (lastEvent.type === 'locked_exit' || lastEvent.type === 'gate_unlocked') {
      const eventId = lastEvent.id
      const timerId = setTimeout(() => {
        setDismissedGateNoticeId(eventId)
      }, 3200)
      return () => {
        clearTimeout(timerId)
      }
    }

    if (
      lastEvent.type === 'item_collected' ||
      lastEvent.type === 'item_pickup_rejected' ||
      lastEvent.type === 'ability_activated'
    ) {
      const eventId = lastEvent.id
      const timerId = setTimeout(() => {
        setDismissedPickupNoticeId(eventId)
      }, 2400)
      return () => {
        clearTimeout(timerId)
      }
    }

    return undefined
  }, [lastEvent])

  const playerRow = playerCell?.row
  const playerCol = playerCell?.col
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !Number.isInteger(playerRow) || !Number.isInteger(playerCol)) {
      return
    }
    const currentCell = engine.getPlayerGridCell()
    if (
      !currentCell ||
      currentCell.row !== playerRow ||
      currentCell.col !== playerCol
    ) {
      engine.setPlayerGridPosition(playerRow, playerCol, {
        immediate: true,
      })
    }
  }, [playerRow, playerCol])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setHealth(health)
  }, [health, maxHealth])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setActiveEffects?.(isGameOver || hasWon ? null : activeEffects)
  }, [activeEffects, isGameOver, hasWon])

  useEffect(() => {
    engineRef.current?.setCameraMode(resolvedCameraMode)
  }, [resolvedCameraMode])

  useEffect(() => {
    engineRef.current?.setThirdPersonCameraMode(resolvedThirdPersonMode)
  }, [resolvedThirdPersonMode])

  const envConfig = engineConfig?.environment
  useEffect(() => {
    if (envConfig) {
      engineRef.current?.updateEnvironment(envConfig)
    }
  }, [envConfig])

  const graphicsConfig = engineConfig?.graphics
  useEffect(() => {
    if (graphicsConfig) {
      engineRef.current?.updateGraphicsConfig(graphicsConfig)
    }
  }, [graphicsConfig])

  const camConfig = engineConfig?.camera
  useEffect(() => {
    if (camConfig) {
      engineRef.current?.updateCameraConfig(camConfig)
    }
  }, [camConfig])

  const moveConfig = engineConfig?.movement
  useEffect(() => {
    if (moveConfig) {
      engineRef.current?.updateMovementConfig(moveConfig)
    }
  }, [moveConfig])

  const audioVolumesConfig = engineConfig?.audio?.volumes
  useEffect(() => {
    if (audioVolumesConfig) {
      engineRef.current?.setAudioVolumes(audioVolumesConfig)
    }
  }, [audioVolumesConfig])

  const audioSpatialEnabled = engineConfig?.audio?.spatialAudio
  const audioReverbEnabled = engineConfig?.audio?.footstepEchoes
  const audioSubtitlesEnabled =
    engineConfig?.audio?.subtitles ?? engineConfig?.subtitles
  useEffect(() => {
    if (
      typeof audioSpatialEnabled === 'boolean' ||
      typeof audioReverbEnabled === 'boolean' ||
      typeof audioSubtitlesEnabled === 'boolean'
    ) {
      engineRef.current?.setAudioOptions?.({
        ...(typeof audioSpatialEnabled === 'boolean'
          ? { spatialAudio: audioSpatialEnabled }
          : {}),
        ...(typeof audioReverbEnabled === 'boolean'
          ? { footstepEchoes: audioReverbEnabled }
          : {}),
        ...(typeof audioSubtitlesEnabled === 'boolean'
          ? { subtitles: audioSubtitlesEnabled }
          : {}),
      })
    }
  }, [audioSpatialEnabled, audioReverbEnabled, audioSubtitlesEnabled])

  const horrorDirectorConfig = engineConfig?.horrorDirector
  useEffect(() => {
    if (horrorDirectorConfig) {
      engineRef.current?.updateHorrorConfig(horrorDirectorConfig)
    }
  }, [horrorDirectorConfig])

  // Respect browser autoplay restrictions: unlock/resume Web Audio strictly after a user gesture during active gameplay
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const gestureEvents = ['pointerdown', 'click', 'keydown', 'touchstart', 'touchend']

    const removeGestureListeners = () => {
      for (let i = 0; i < gestureEvents.length; i += 1) {
        window.removeEventListener(gestureEvents[i], handleUserGesture, { capture: true })
      }
    }

    const handleUserGesture = (event) => {
      const props = latestPropsRef.current
      if (!props.controlsEnabled || props.hasWon || props.isGameOver || props.audioPaused) {
        return
      }
      if (
        event?.target?.closest?.('.lv-modal, [data-audio-pause-trigger="true"]')
      ) {
        return
      }
      const unlocked = engineRef.current?.unlockAudio()
      const ctxState = engineRef.current?.getAudioState?.()?.contextState
      if (unlocked && (!ctxState || ctxState === 'running')) {
        removeGestureListeners()
      }
    }

    for (let i = 0; i < gestureEvents.length; i += 1) {
      window.addEventListener(gestureEvents[i], handleUserGesture, {
        capture: true,
        passive: true,
      })
    }

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return
      const engine = engineRef.current
      const isHidden = Boolean(document.hidden || document.visibilityState === 'hidden')
      if (isHidden) {
        resetContinuousInput()
        engine?.setPaused(true)
      } else if (engine) {
        const props = latestPropsRef.current
        if (props.hasWon || props.isGameOver) {
          engine.setPaused(false)
          engine.setHorrorPaused(true)
          engine.setAudioPaused(Boolean(props.audioPaused))
        } else if (
          props.audioPaused ||
          props.showDiagnosticsModal ||
          (!props.controlsEnabled && !props.isEngineAnimatedSequence)
        ) {
          engine.setPaused(true)
        } else {
          engine.setPaused(false)
        }
      }
    }
    document?.addEventListener?.('visibilitychange', handleVisibilityChange)

    return () => {
      removeGestureListeners()
      document?.removeEventListener?.('visibilitychange', handleVisibilityChange)
    }
  }, [resetContinuousInput])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setHasWon(hasWon)
    const isTabHidden =
      typeof document !== 'undefined' &&
      Boolean(document.hidden || document.visibilityState === 'hidden')
    if (isTabHidden) {
      resetContinuousInput()
      engine.setPaused(true)
    } else if (hasWon || isGameOver) {
      resetContinuousInput()
      engine.setPaused(false)
      engine.setHorrorPaused(true)
      engine.setAudioPaused(Boolean(audioPaused))
      } else if (
        audioPaused ||
        showDiagnosticsModal ||
        (!controlsEnabled && !isEngineAnimatedSequence)
      ) {
        resetContinuousInput()
        engine.setPaused(true)
      } else {
        if (!controlsEnabled || showDiagnosticsModal) {
          resetContinuousInput()
        }
        engine.setPaused(false)
      }
    }, [
      hasWon,
      isGameOver,
      controlsEnabled,
      audioPaused,
      showDiagnosticsModal,
      isEngineAnimatedSequence,
      resetContinuousInput,
    ])

  // Exit fullscreen automatically if a modal/victory/game-over overlay takes focus outside the viewport
  useEffect(() => {
    if (hasWon || isGameOver || (!controlsEnabled && !isEngineAnimatedSequence)) {
      if (fullscreenControllerRef.current?.getState?.().isFullscreen) {
        void fullscreenControllerRef.current.exitFullscreen()
      }
    }
  }, [hasWon, isGameOver, controlsEnabled, isEngineAnimatedSequence])

  const handleToggleFullscreen = useCallback((event) => {
    event?.stopPropagation?.()
    engineRef.current?.unlockAudio()
    void fullscreenControllerRef.current?.toggleFullscreen()
  }, [])

  const handleTouchLookDelta = useCallback((dx, dy) => {
    const props = latestPropsRef.current
    if (
      !props.controlsEnabled ||
      props.hasWon ||
      props.isGameOver ||
      props.isArrivalLocked
    ) {
      return
    }
    const cfg = props.engineConfig || {}
    const touchLookSens = Number.isFinite(cfg.touchLookSensitivity) && cfg.touchLookSensitivity > 0
      ? cfg.touchLookSensitivity
      : 1.8
    const sensitivity = touchLookSens * 0.0022
    const { invertY } = resolveLookInputConfig(cfg)
    engineRef.current?.applyLookDelta(dx, dy, { sensitivity, invertY })
  }, [])

  const touchControlsMode = engineConfig?.touchControls || 'auto'

  const handleTouchActivity = useCallback((event) => {
    if (!event?.pointerType || event.pointerType === 'touch' || event.pointerType === 'pen') {
      setHasUsedTouchControls(true)
    } else if (touchControlsMode === 'always') {
      setHasUsedTouchControls(true)
    }
  }, [touchControlsMode])

  const showTouchControls = resolveShowTouchControls({
    touchControlsMode,
    isInteractive,
    isFullscreen: fullscreenState.isFullscreen,
    isTouchDevice,
    hasUsedTouchControls,
  })
  const touchLookSensitivity =
    Number.isFinite(engineConfig?.touchLookSensitivity) &&
    engineConfig.touchLookSensitivity > 0
      ? engineConfig.touchLookSensitivity
      : 1.8

  const hasValidMaze = Boolean(
    maze && Array.isArray(maze.grid) && maze.grid.length > 0
  )

  const hasPlayerCell = Number.isInteger(playerRow) && Number.isInteger(playerCol)
  const isGateEvent =
    lastEvent &&
    (lastEvent.type === 'locked_exit' || lastEvent.type === 'gate_unlocked')
  const gateNotice =
    isGateEvent && lastEvent.id !== dismissedGateNoticeId
      ? {
          id: lastEvent.id,
          type: lastEvent.type,
          text:
            lastEvent.message ||
            (lastEvent.type === 'gate_unlocked'
              ? 'Resonance Exit Gate Unlocked!'
              : 'Exit Gate Locked — Collect all Resonance Keycards'),
        }
      : null
  const isPickupEvent =
    lastEvent &&
    (lastEvent.type === 'item_collected' ||
      lastEvent.type === 'item_pickup_rejected' ||
      lastEvent.type === 'ability_activated') &&
    Boolean(lastEvent.message)
  const pickupNotice =
    isPickupEvent && lastEvent.id !== dismissedPickupNoticeId
      ? {
          id: lastEvent.id,
          kind:
            lastEvent.type === 'item_pickup_rejected'
              ? 'rejected'
              : lastEvent.abilityType || lastEvent.item?.type || 'item',
          text: lastEvent.message,
        }
      : null
  const resolvedKeyBindings = normalizeKeyBindings(engineConfig?.keyBindings)
  const manualCollectibleSlots = MANUAL_COLLECTIBLE_TYPES.map((type) => {
    const config = COLLECTIBLE_CONFIG[type]
    const bindingId = MANUAL_COLLECTIBLE_KEY_BINDING_IDS[type]
    const shortcutLabel = bindingId
      ? formatKeyTokenLabel(resolvedKeyBindings[bindingId])
      : ''
    const count = inventory?.[type] || 0
    const remainingMs =
      type === COLLECTIBLE_TYPES.PHANTOM_VEIL
        ? activeEffects?.phantomVeilRemainingMs || 0
        : type === COLLECTIBLE_TYPES.TIME_FRAGMENT
          ? activeEffects?.timeFragmentRemainingMs || 0
          : type === COLLECTIBLE_TYPES.WATCHERS_EYE
            ? activeEffects?.watchersEyeRemainingMs || 0
            : 0
    const isActive = remainingMs > 0
    const canActivate =
      isInteractive &&
      !isSpawnSequenceActive &&
      !isExtractionSequenceActive &&
      count > 0 &&
      !isActive
    return {
      type,
      label: config.label,
      shortLabel: config.shortLabel,
      shortcutLabel,
      count,
      remainingMs,
      isActive,
      canActivate,
    }
  })
  const resolvedCurrentLevel = resolveAuthoritativeHudLevel({
    currentLevel,
    maze,
  })
  const formattedLevelNumber = formatHudLevelNumber(resolvedCurrentLevel)
  const formattedLevelDisplay = formatHudLevelDisplay(resolvedCurrentLevel)
  const levelAriaLabel = formatHudLevelAriaLabel(resolvedCurrentLevel)
  const resolvedHudScore = Number.isFinite(Number(score))
    ? Math.max(0, Math.round(Number(score)))
    : 0
  const resolvedCumulativeScore = Number.isFinite(Number(cumulativeScore))
    ? Math.max(0, Math.round(Number(cumulativeScore)))
    : 0
  const formattedHudScore = resolvedHudScore.toLocaleString('en-US')
  const frameClassName = [
    'maze-viewport-3d',
    isTransitioning ? 'maze-viewport-3d--transitioning' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const viewportLabel = hasValidMaze
    ? `Labyrinth ${maze.rows} by ${maze.cols} 3D labyrinth viewport`
    : '3D labyrinth viewport'

  return (
    <div
      ref={frameRef}
      className={frameClassName}
      role="region"
      aria-label={viewportLabel}
      data-maze-ready={String(hasValidMaze)}
      data-maze-id={maze?.id || ''}
      data-current-level={String(resolvedCurrentLevel)}
      data-score={String(resolvedHudScore)}
      data-cumulative-score={String(resolvedCumulativeScore)}
      data-player-cell={hasPlayerCell ? `${playerRow},${playerCol}` : ''}
      data-items-remaining={String(Array.isArray(items) ? items.length : 0)}
      data-keys-collected={String(keysCollected)}
      data-total-keys={String(totalKeys)}
      data-exit-locked={String(Boolean(isExitLocked))}
      data-echo-steps={String(Array.isArray(echoPath) ? echoPath.length : 0)}
      data-show-solution-path={String(Boolean(showSolutionPath))}
      data-wall-pass-armed={String(Boolean(activeEffects?.wallPassArmed))}
      data-camera-mode={resolvedCameraMode}
      data-third-person-camera-mode={resolvedThirdPersonMode}
      data-camera-distance={cameraDistancePreset}
      data-controls-enabled={String(Boolean(controlsEnabled))}
      data-has-won={String(Boolean(hasWon))}
      data-player-health={String(health)}
      data-player-max-health={String(maxHealth)}
      data-is-game-over={String(Boolean(isGameOver))}
      data-is-immune={String(Boolean(isImmune))}
      data-can-interact={String(Boolean(stealthState.canInteract))}
      data-nearby-interactable-kind={stealthState.nearbyInteractableKind || ''}
      data-nearby-interactable-id={stealthState.nearbyInteractableId || ''}
      data-is-hiding={String(Boolean(stealthState.isHiding))}
      data-hiding-spot-type={stealthState.hidingSpotType || ''}
      data-horror-intensity={horrorDirectorConfig?.intensity || 'medium'}
      data-visual-scares={String(horrorDirectorConfig?.visualScaresEnabled !== false)}
      data-reduced-motion={String(Boolean(horrorDirectorConfig?.reducedMotion))}
      data-fullscreen={String(Boolean(fullscreenState.isFullscreen))}
      data-fullscreen-supported={String(Boolean(fullscreenState.supported))}
      data-touch-controls-visible={String(Boolean(showTouchControls))}
      data-spawn-sequence-active={String(Boolean(isSpawnSequenceActive))}
      data-extraction-sequence-active={String(Boolean(isExtractionSequenceActive))}
      data-arrival-active={String(Boolean(isArrivalLocked))}
      data-arrival-phase={isArrivalLocked ? arrivalPhase : 'idle'}
      data-arrival-entry-path={arrivalEntryPath || ''}
    >
      <div ref={canvasHostRef} className="maze-viewport-3d__stage">
        {!isTransitioning ? (
          <>
            {/* Hiding Spot Enclosure Vignette */}
        <div
          className={[
            'maze-hiding-vignette',
            stealthState.isHiding ? 'maze-hiding-vignette--active' : '',
            stealthState.isHiding && stealthState.hidingWarning
              ? 'maze-hiding-vignette--warning'
              : '',
            stealthState.isHiding && stealthState.hidingCompromised
              ? 'maze-hiding-vignette--compromised'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        />

            {/* Full-screen red damage vignette & horror game-over overlay */}
        <div
          className={[
            'maze-damage-overlay',
            damageFlash ? 'maze-damage-overlay--active' : '',
            isGameOver ? 'maze-damage-overlay--gameover' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        />

        {/* Subtle Horror Director Dread Pulse (suppressed on reducedMotion or disabled visuals) */}
        <div
          className={[
            'maze-horror-pulse-overlay',
            horrorPulse &&
            horrorDirectorConfig?.visualScaresEnabled !== false &&
            !horrorDirectorConfig?.reducedMotion
              ? 'maze-horror-pulse-overlay--active'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        />

        {/* Compact Top-Left HUD: Level Indicator + Icons & Numerical Values */}
        <div
          className="maze-vitals-hud"
          role="status"
          aria-label={`HP ${health} of ${maxHealth}${objectivesEnabled && totalKeys > 0 ? `, Keys ${keysCollected} of ${totalKeys}` : ''}`}
        >
          <div
            className="maze-level-hud"
            data-testid="maze-level-hud"
            data-current-level={String(resolvedCurrentLevel)}
            data-level-code={formattedLevelNumber}
            data-level-display={formattedLevelDisplay}
            aria-label={levelAriaLabel}
          >
            <span className="maze-level-hud__prefix">LEVEL</span>{' '}
            <span
              className="maze-level-hud__number"
              data-testid="maze-level-hud-number"
            >
              {formattedLevelNumber}
            </span>
          </div>
          <span
            className="maze-level-hud__live-announcer"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="maze-level-hud-live"
            data-announced-level={String(resolvedCurrentLevel)}
          >
            {levelAriaLabel}
          </span>

          {isSandboxMode ? (
            <div className="maze-sandbox-hud-cluster" data-testid="maze-sandbox-hud-cluster">
              <div
                className="maze-sandbox-hud-badge"
                data-testid="maze-sandbox-badge"
                aria-label="Developer Sandbox Mode"
              >
                SANDBOX
              </div>
              <button
                type="button"
                className="maze-sandbox-hud-diagnostics-btn"
                data-testid="maze-sandbox-diagnostics-btn"
                data-viewport-control="true"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (typeof onOpenDiagnostics === 'function') {
                    onOpenDiagnostics()
                  }
                  setShowDiagnosticsModal(true)
                }}
                title="Open Sandbox Runtime Diagnostics (Hotkey: F1 or Shift+D)"
              >
                DIAGNOSTICS
              </button>
              {sandboxBrightnessAllowed ? (
                <button
                  type="button"
                  className={[
                    'maze-sandbox-hud-brightness-btn',
                    resolvedDevBrightness
                      ? 'maze-sandbox-hud-brightness-btn--active'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-testid="maze-sandbox-brightness-btn"
                  data-viewport-control="true"
                  data-active={String(Boolean(resolvedDevBrightness))}
                  aria-pressed={Boolean(resolvedDevBrightness)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleDevBrightness()
                  }}
                  title="Toggle Developer Full-Environment Brightness Override (Sandbox Only)"
                >
                  <svg
                    className="maze-sandbox-hud-brightness-icon"
                    viewBox="0 0 24 24"
                    width="13"
                    height="13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2" />
                    <path d="M12 20v2" />
                    <path d="m4.93 4.93 1.41 1.41" />
                    <path d="m17.66 17.66 1.41 1.41" />
                    <path d="M2 12h2" />
                    <path d="M20 12h2" />
                    <path d="m6.34 17.66-1.41 1.41" />
                    <path d="m19.07 4.93-1.41 1.41" />
                  </svg>
                  <span className="maze-sandbox-hud-brightness-label">
                    {resolvedDevBrightness
                      ? 'TEST BRIGHTNESS: ON'
                      : 'TEST BRIGHTNESS: OFF'}
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}

          <div
            className="maze-score-hud"
            data-testid="maze-score-hud"
            data-score={String(resolvedHudScore)}
            data-cumulative-score={String(resolvedCumulativeScore)}
            aria-label={`Score ${resolvedHudScore}`}
          >
            <span className="maze-score-hud__prefix">SCORE</span>{' '}
            <span
              className="maze-score-hud__number"
              data-testid="maze-score-hud-number"
            >
              {formattedHudScore}
            </span>
          </div>

          <div
            className={[
              'maze-vitals-hud__item',
              'maze-vitals-hud__item--hp',
              health <= 25
                ? 'maze-vitals-hud__item--critical'
                : health <= 55
                  ? 'maze-vitals-hud__item--warning'
                  : '',
              isImmune && !isGameOver ? 'maze-vitals-hud__item--immune' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`Health ${health} of ${maxHealth}`}
          >
            <span className="maze-vitals-hud__icon" aria-hidden="true">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
            </span>
            <span className="maze-vitals-hud__numeric">{health}</span>
          </div>

          <div
            ref={staminaHudRef}
            className="maze-vitals-hud__item maze-vitals-hud__item--stamina"
            data-level="normal"
            aria-label="Stamina"
          >
            <span className="maze-vitals-hud__icon maze-vitals-hud__icon--stamina" aria-hidden="true">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
            <span ref={staminaNumericRef} className="maze-vitals-hud__numeric">
              100%
            </span>
          </div>

          <div
            ref={batteryHudRef}
            className="maze-vitals-hud__item maze-vitals-hud__item--battery"
            data-active={String(Boolean(flashlightActive))}
            data-level="normal"
            aria-label="Flashlight battery"
          >
            <span className="maze-vitals-hud__icon maze-vitals-hud__icon--battery" aria-hidden="true">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z" />
                <line x1="6" x2="18" y1="6" y2="6" />
              </svg>
            </span>
            <span ref={batteryNumericRef} className="maze-vitals-hud__numeric">
              100%
            </span>
          </div>

          {objectivesEnabled && totalKeys > 0 ? (
            <div
              className={[
                'maze-vitals-hud__item',
                'maze-vitals-hud__item--keys',
                isExitLocked
                  ? 'maze-vitals-hud__item--keys-locked'
                  : 'maze-vitals-hud__item--keys-unlocked',
              ].join(' ')}
              aria-label={`Keys ${keysCollected} of ${totalKeys}`}
            >
              <span className="maze-vitals-hud__icon maze-vitals-hud__icon--keycard" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="7.5" cy="15.5" r="5.5" />
                  <path d="m21 2-9.6 9.6" />
                  <path d="m15.5 7.5 3 3L22 7l-3-3" />
                </svg>
              </span>
              <span className="maze-vitals-hud__numeric">
                {keysCollected}/{totalKeys}
              </span>
            </div>
          ) : null}

          {floatingDamage ? (
            <div className="maze-vitals-hud__floating-hit" aria-hidden="true">
              {floatingDamage}
            </div>
          ) : null}
        </div>

        {!isGameOver && !hasWon ? (
          <div className="maze-active-effects" aria-live="polite" aria-label="Active collectible effects">
            {(activeEffects?.timeFragmentRemainingMs || 0) > 0 ? (
              <div className="maze-active-effect maze-active-effect--time_fragment" data-active-effect="time_fragment">
                <span>Time Slow</span>
                <span>{(activeEffects.timeFragmentRemainingMs / 1000).toFixed(1)}s</span>
              </div>
            ) : null}
            {(activeEffects?.watchersEyeRemainingMs || 0) > 0 ? (
              <div className="maze-active-effect maze-active-effect--watchers_eye" data-active-effect="watchers_eye">
                <span>Watcher&apos;s Eye</span>
                <span>{(activeEffects.watchersEyeRemainingMs / 1000).toFixed(1)}s</span>
              </div>
            ) : null}
            {(activeEffects?.spiritLanternRemainingMs || 0) > 0 ? (
              <div className="maze-active-effect maze-active-effect--spirit_lantern" data-active-effect="spirit_lantern">
                <span>Spirit Lantern</span>
                <span>{(activeEffects.spiritLanternRemainingMs / 1000).toFixed(1)}s</span>
              </div>
            ) : null}
            {(activeEffects?.phantomVeilRemainingMs || 0) > 0 ? (
              <div className="maze-active-effect maze-active-effect--phantom_veil" data-active-effect="phantom_veil">
                <span>Phantom Veil</span>
                <span>{(activeEffects.phantomVeilRemainingMs / 1000).toFixed(1)}s</span>
              </div>
            ) : null}
            {(activeEffects?.spectralCompassRemainingMs || 0) > 0 ? (
              <div className="maze-active-effect maze-active-effect--spectral_compass" data-active-effect="spectral_compass">
                <span>Spectral Compass</span>
                <span>{(activeEffects.spectralCompassRemainingMs / 1000).toFixed(1)}s</span>
              </div>
            ) : null}
            {(activeEffects?.wardingCharmsCount || 0) > 0 ? (
              <div className="maze-active-effect maze-active-effect--warding_charm" data-active-effect="warding_charm">
                <span>Warding Shield</span>
                <span>x{activeEffects.wardingCharmsCount}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isGameOver && !hasWon ? (
          <div
            className="maze-manual-inventory"
            data-viewport-control="true"
            role="group"
            aria-label="Stored collectibles"
          >
            {manualCollectibleSlots.map((slot) => (
              <button
                key={slot.type}
                type="button"
                className={[
                  'maze-manual-slot',
                  `maze-manual-slot--${slot.type}`,
                  slot.isActive ? 'maze-manual-slot--active' : '',
                  slot.count > 0 ? 'maze-manual-slot--ready' : 'maze-manual-slot--empty',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-viewport-control="true"
                data-manual-collectible={slot.type}
                data-stored-count={String(slot.count)}
                data-active={String(slot.isActive)}
                data-keybind={slot.shortcutLabel}
                disabled={!slot.canActivate}
                aria-pressed={slot.isActive}
                aria-label={
                  slot.isActive
                    ? `${slot.label} (${slot.shortcutLabel}) active (${(slot.remainingMs / 1000).toFixed(1)}s)`
                    : slot.count > 0
                      ? `Activate ${slot.label} (${slot.shortcutLabel}) (${slot.count} stored)`
                      : `${slot.label} (${slot.shortcutLabel}) (0 stored)`
                }
                onPointerDown={(event) => {
                  event.stopPropagation()
                  if (!slot.canActivate) return
                  if (typeof event.button === 'number' && event.button !== 0) return
                  event.preventDefault()
                  manualPointerGuardRef.current[slot.type] = true
                  manualActivationSeqRef.current += 1
                  handleEngineActivateAbility(slot.type, {
                    inputEventId: `hud-${slot.type}-${manualActivationSeqRef.current}`,
                  })
                }}
                onPointerUp={(event) => {
                  event.stopPropagation()
                }}
                onPointerCancel={(event) => {
                  event.stopPropagation()
                  manualPointerGuardRef.current[slot.type] = false
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (manualPointerGuardRef.current[slot.type]) {
                    manualPointerGuardRef.current[slot.type] = false
                    return
                  }
                  if (!slot.canActivate) return
                  manualActivationSeqRef.current += 1
                  handleEngineActivateAbility(slot.type, {
                    inputEventId: `hud-${slot.type}-${manualActivationSeqRef.current}`,
                  })
                }}
              >
                {slot.shortcutLabel ? (
                  <kbd className="maze-manual-slot__key">{slot.shortcutLabel}</kbd>
                ) : null}
                <span className="maze-manual-slot__label">{slot.shortLabel}</span>
                <span className="maze-manual-slot__count">
                  {slot.isActive
                    ? `${(slot.remainingMs / 1000).toFixed(1)}s`
                    : `x${slot.count}`}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {gateNotice && !isGameOver && !hasWon ? (
          <div
            key={gateNotice.id}
            className={[
              'maze-gate-notice',
              gateNotice.type === 'gate_unlocked'
                ? 'maze-gate-notice--unlocked'
                : 'maze-gate-notice--locked',
            ].join(' ')}
            role="status"
            aria-live="assertive"
            data-gate-notice={gateNotice.type}
          >
            {gateNotice.text}
          </div>
        ) : null}

        {pickupNotice && !gateNotice && !isGameOver && !hasWon ? (
          <div
            key={`pickup-${pickupNotice.id}`}
            className={[
              'maze-pickup-notice',
              `maze-pickup-notice--${pickupNotice.kind}`,
            ].join(' ')}
            role="status"
            aria-live="polite"
            data-pickup-notice={pickupNotice.kind}
          >
            {pickupNotice.text}
          </div>
        ) : null}

        <button
          type="button"
          className={[
            'maze-fullscreen-btn',
            fullscreenState.isFullscreen ? 'maze-fullscreen-btn--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-viewport-control="true"
          data-fullscreen-toggle="true"
          disabled={!fullscreenState.supported}
          aria-pressed={fullscreenState.isFullscreen}
          aria-label={
            !fullscreenState.supported
              ? 'Fullscreen is not supported in this browser'
              : fullscreenState.isFullscreen
                ? 'Exit fullscreen'
                : 'Enter fullscreen'
          }
          title={
            !fullscreenState.supported
              ? 'Fullscreen is not supported in this browser'
              : fullscreenState.isFullscreen
                ? 'Exit fullscreen (ESC)'
                : 'Enter fullscreen'
          }
          onClick={handleToggleFullscreen}
        >
          {fullscreenState.isFullscreen ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
          )}
        </button>

        <Minimap3D
          ref={minimapRef}
          maze={maze}
          runId={runId}
          currentLevel={resolvedCurrentLevel}
          playerCell={playerCell}
          items={items}
          keycards={keycards}
          echoPath={echoPath}
          activeEffects={isGameOver || hasWon ? null : activeEffects}
          hazards={maze?.hazards || null}
          enemies={maze?.enemies || null}
          objectivesEnabled={objectivesEnabled}
          isExitLocked={isExitLocked}
          controlsEnabled={isInteractive}
          wayfinderEnabled={wayfinderEnabled}
          spiritLanternActive={
            !isGameOver &&
            !hasWon &&
            (activeEffects?.spiritLanternRemainingMs || 0) > 0
          }
          echoRevealActive={
            !isGameOver &&
            !hasWon &&
            (activeEffects?.echoRevealRemainingMs || 0) > 0
          }
          watchersEyeActive={
            !isGameOver &&
            !hasWon &&
            (activeEffects?.watchersEyeRemainingMs || 0) > 0
          }
          spectralCompassActive={
            !isGameOver &&
            !hasWon &&
            (activeEffects?.spectralCompassRemainingMs || 0) > 0
          }
        />

        <AudioSubtitlesOverlay
          audioEngine={audioEngineState}
          enabled={Boolean(engineConfig?.audio?.subtitles ?? engineConfig?.subtitles)}
          paused={Boolean(audioPaused)}
          gameOver={Boolean(isGameOver)}
          won={Boolean(hasWon)}
        />

        {fullscreenState.isFullscreen && fullscreenState.showEscHint ? (
          <div
            className="maze-fullscreen-hint"
            role="status"
            aria-live="polite"
            data-fullscreen-esc-hint="true"
          >
            Press <kbd className="maze-fullscreen-hint__key">ESC</kbd> to exit fullscreen
          </div>
        ) : null}

        {/* Active Hiding Spot HUD Indicator */}
        {stealthState.isHiding &&
        isInteractive &&
        !isSpawnSequenceActive &&
        !isExtractionSequenceActive ? (
          <div
            className={[
              'maze-hiding-hud',
              stealthState.hidingWarning ? 'maze-hiding-hud--warning' : '',
              stealthState.hidingCompromised ? 'maze-hiding-hud--compromised' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="status"
            aria-live="polite"
            data-hiding-hud="true"
            data-hiding-spot-type={stealthState.hidingSpotType || ''}
          >
            <div className="maze-hiding-hud__header">
              <span className="maze-hiding-hud__label">
                {stealthState.hidingCompromised
                  ? 'COVER BLOWN'
                  : `HIDDEN · ${stealthState.hidingSpotLabel || 'CONCEALED'}`}
              </span>
              <span className="maze-hiding-hud__timer">
                {`${Math.max(0, Math.ceil(stealthState.hidingTimeRemainingSec || 0))}s`}
              </span>
            </div>
            <div className="maze-hiding-hud__meter" aria-hidden="true">
              <div
                className="maze-hiding-hud__fill"
                style={{
                  width: `${Math.min(100, Math.max(0, Math.round((stealthState.hidingExposure || 0) * 100)))}%`,
                }}
              />
            </div>
            {stealthState.hidingFlashlightLeak ? (
              <div className="maze-hiding-hud__alert">
                Flashlight leaks cover! Turn off beam
              </div>
            ) : stealthState.hidingWarning && !stealthState.hidingCompromised ? (
              <div className="maze-hiding-hud__alert">
                Cover weakening — prepare to move
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Persistent Center Crosshair & Manual Ceiling Rubble Mouse Interaction Feedback */}
        <CenterCrosshair
          visible={resolveCrosshairVisibility({
            controlsEnabled:
              Boolean(isInteractive) ||
              (Boolean(isArrivalLocked) &&
                !audioPaused &&
                !isTransitioning &&
                !isLevelTransitioning),
            hasWon,
            isGameOver,
            isPaused: Boolean(audioPaused),
            isTransitioning,
            isLevelTransitioning,
            isExtractionSequenceActive,
            showDiagnosticsModal,
          })}
          stealthState={stealthState}
          cameraMode={resolvedCameraMode}
          thirdPersonCameraMode={resolvedThirdPersonMode}
          pointerLocked={isPointerLocked}
        />

        {/* Context-Sensitive Mouse Interaction Prompt (Hiding Spots & Hazards) */}
        {stealthState.canInteract &&
        isInteractive &&
        !isSpawnSequenceActive &&
        !isExtractionSequenceActive ? (
          <div
            className="maze-interact-prompt"
            role="status"
            aria-live="polite"
            data-interactable-kind={stealthState.nearbyInteractableKind || 'hazard'}
            data-hiding-active={String(Boolean(stealthState.isHiding))}
          >
            <span className="maze-interact-prompt__key">
              {stealthState.isHiding ? 'Right-Click' : 'Left-Click'}
            </span>
            <span className="maze-interact-prompt__text">
              {stealthState.nearbyInteractableLabel || 'Interact'}
            </span>
          </div>
        ) : null}

        {showDevAuditionPanel ? (
          <div
            className="pointer-events-auto absolute bottom-3 left-3 z-40 flex max-w-[420px] flex-col gap-1.5 rounded border border-amber-500/40 bg-black/85 p-2.5 text-xs text-amber-100 shadow-lg backdrop-blur-sm"
            data-viewport-control="true"
            data-audio-audition-panel="true"
            role="region"
            aria-label="Development Audio Audition Controls"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-amber-500/25 pb-1">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                Dev Audio Audition
              </span>
              <button
                type="button"
                data-viewport-control="true"
                data-audio-audition-stop="true"
                className="rounded border border-rose-400/40 bg-rose-950/70 px-2 py-0.5 font-mono text-[10px] uppercase text-rose-200 hover:bg-rose-900/80"
                onClick={(event) => {
                  event.stopPropagation()
                  handleStopAudition()
                }}
              >
                Stop
              </button>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-amber-500/15 pb-1">
              {[
                { id: 'all', label: 'All' },
                { id: 'enemy_breath', label: 'Enemy Breath' },
                { id: 'enemy_vocal', label: 'Enemy Vocals' },
                { id: 'alerts_attacks', label: 'Alerts/Attacks' },
                { id: 'combat_mix', label: 'Combat Mix' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  data-viewport-control="true"
                  className={[
                    'rounded px-1.5 py-0.5 font-mono text-[9px] uppercase transition-colors',
                    auditionCategoryFilter === cat.id
                      ? 'bg-amber-400/30 text-amber-100 font-semibold border border-amber-400/60'
                      : 'bg-neutral-800/70 text-amber-300/60 hover:text-amber-200',
                  ].join(' ')}
                  onClick={(event) => {
                    event.stopPropagation()
                    setAuditionCategoryFilter(cat.id)
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="flex max-h-[220px] flex-wrap gap-1.5 overflow-y-auto pr-1">
              {AUDITION_PRESETS.filter(
                (p) => auditionCategoryFilter === 'all' || p.category === auditionCategoryFilter
              ).map((preset) => {
                const isPlaying = activeAuditionState?.presetId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    data-viewport-control="true"
                    data-audio-audition-preset={preset.id}
                    aria-pressed={isPlaying}
                    className={[
                      'rounded border px-2 py-1 font-mono text-[10px] transition-colors',
                      isPlaying
                        ? 'border-amber-300 bg-amber-500/30 text-amber-100'
                        : 'border-amber-500/30 bg-neutral-900/90 text-amber-200/90 hover:border-amber-400/60 hover:bg-neutral-800',
                    ].join(' ')}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleAuditionCue(preset.id)
                    }}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
            <div
              className="font-mono text-[10px] text-amber-200/75"
              data-audio-audition-status="true"
            >
              {activeAuditionState
                ? `Active: ${activeAuditionState.presetId} (${activeAuditionState.synthesizer || activeAuditionState.kind} / ${activeAuditionState.profile || activeAuditionState.variant})`
                : 'Ready — non-overlapping production synthesis path'}
            </div>
          </div>
        ) : null}

        {children || showTouchControls ? (
          <div className="maze-viewport-3d__overlay">
            {children}
            {showTouchControls ? (
              <TouchControls3D
                key={maze?.id || 'touch-controls'}
                enabled={isInteractive}
                mode={touchControlsMode}
                inventory={inventory}
                activeEffects={activeEffects}
                stealthState={stealthState}
                flashlightActive={flashlightActive}
                keyBindings={resolvedKeyBindings}
                lookSensitivity={touchLookSensitivity}
                hapticsEnabled={Boolean(engineConfig?.touchHaptics)}
                wayfinderEnabled={wayfinderEnabled}
                onMoveAxes={setTouchMovement}
                onLookDelta={handleTouchLookDelta}
                onSprintChange={setTouchSprint}
                onInteractChange={setTouchInteract}
                onTriggerInteract={handleTouchInteract}
                onToggleFlashlight={handleToggleFlashlight}
                onActivateAbility={triggerAbility}
                onTriggerWayfinder={handleTriggerWayfinder}
                onTouchActivity={handleTouchActivity}
                onReset={resetTouch}
              />
            ) : null}
          </div>
        ) : null}
          </>
        ) : null}
        {isSandboxMode && (
          <SandboxDiagnosticsModal
            isOpen={showDiagnosticsModal}
            engine={engineInstance}
            maze={maze}
            sandboxConfig={sandboxConfig || maze?.sandboxConfig}
            onClose={() => setShowDiagnosticsModal(false)}
            onRestartSameSeed={
              onRestartSameSeed
                ? () => {
                    setShowDiagnosticsModal(false)
                    onRestartSameSeed()
                  }
                : null
            }
            onRestartNewSeed={
              onRestartNewSeed
                ? () => {
                    setShowDiagnosticsModal(false)
                    onRestartNewSeed()
                  }
                : null
            }
            onOpenManualEditor={(coord) => {
              setShowDiagnosticsModal(false)
              onOpenManualEditor?.(coord)
            }}
            onReturnToSandbox={() => {
              setShowDiagnosticsModal(false)
              onReturnToSandbox?.()
            }}
          />
        )}
      </div>
    </div>
  )
}

export default MazeViewport3D
