import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createFullscreenController,
  detectTouchPrimaryInput,
  requestSafePointerLock,
  resolveShowTouchControls,
} from '../../game/three/fullscreenController.js'
import { MazeSceneEngine } from '../../game/three/MazeSceneEngine.js'
import {
  DEFAULT_THIRD_PERSON_CAMERA_DISTANCE,
  formatKeyTokenLabel,
  normalizeKeyBindings,
  resolveLookInputConfig,
} from '../../game/three/threeConfig.js'
import { useContinuousInput } from '../../hooks/useContinuousInput.js'
import Minimap3D from './Minimap3D.jsx'
import TouchControls3D from './TouchControls3D.jsx'

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
  runId = 1,
  playerCell = null,
  coins = [],
  powerUps = [],
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
  onActivateAbility = null,
  onInteract = null,
  onPlayerDamage = null,
  onGameOver = null,
  onViewportReady = null,
  onViewportResize = null,
  onViewportError = null,
  className = '',
  children = null,
}) {
  const frameRef = useRef(null)
  const canvasHostRef = useRef(null)
  const engineRef = useRef(null)
  const prevSyncRef = useRef({
    maze,
    runId,
    coins,
    powerUps,
    keycards,
    echoPath,
    isExitLocked,
  })
  const lastEventRef = useRef(lastEvent)
  const wallPassLockRef = useRef(false)
  const onReadyRef = useRef(onViewportReady)
  const onResizeRef = useRef(onViewportResize)
  const onErrorRef = useRef(onViewportError)
  const onInteractRef = useRef(onInteract)

  const [damageFlash, setDamageFlash] = useState(false)
  const [floatingDamage, setFloatingDamage] = useState(null)
  const [isImmune, setIsImmune] = useState(false)
  const [stealthState, setStealthState] = useState({
    isHidden: false,
    canInteract: false,
    nearbySpotId: null,
    nearbySpotType: null,
  })
  const [horrorPulse, setHorrorPulse] = useState(null)
  const [fullscreenState, setFullscreenState] = useState({
    supported: false,
    isFullscreen: false,
    showEscHint: false,
  })
  const fullscreenControllerRef = useRef(null)
  const damageFlashTimeoutRef = useRef(null)
  const immunityTimeoutRef = useRef(null)
  const floatingDamageTimeoutRef = useRef(null)
  const horrorPulseTimeoutRef = useRef(null)

  const [flashlightActive, setFlashlightActive] = useState(false)
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
  const minimapRef = useRef(null)
  const staminaHudRef = useRef(null)
  const staminaNumericRef = useRef(null)
  const batteryHudRef = useRef(null)
  const batteryNumericRef = useRef(null)

  const handleEngineInteract = useCallback(() => {
    const engine = engineRef.current
    if (engine) {
      engine.unlockAudio()
      engine.interact()
    }
    onInteractRef.current?.()
  }, [])

  const handleToggleFlashlight = useCallback(() => {
    const engine = engineRef.current
    if (engine) {
      engine.unlockAudio()
      const nextActive = engine.toggleFlashlight()
      setFlashlightActive(nextActive)
    }
  }, [])

  const wayfinderEnabled = engineConfig?.wayfinderGuide !== false

  const handleTriggerWayfinder = useCallback(() => {
    if (!wayfinderEnabled) {
      return
    }
    minimapRef.current?.triggerHint()
  }, [wayfinderEnabled])

  const handleCycleCameraDistance = useCallback(() => {
    engineRef.current?.cycleCameraDistance()
  }, [])

  const isInteractive = Boolean(controlsEnabled) && !hasWon && !isGameOver
  const {
    inputRef,
    setTouchMovement,
    setTouchSprint,
    setTouchInteract,
    triggerAbility,
    triggerInteract,
    resetTouch,
    reset: resetContinuousInput,
  } = useContinuousInput({
    enabled: isInteractive,
    keyBindings: engineConfig?.keyBindings,
    onActivateAbility,
    onInteract: handleEngineInteract,
    onToggleFlashlight: handleToggleFlashlight,
    onTriggerWayfinder: handleTriggerWayfinder,
    onCycleCameraDistance: handleCycleCameraDistance,
  })

  const resolvedThirdPersonMode =
    thirdPersonCameraMode ??
    engineConfig?.camera?.thirdPersonCameraMode ??
    engineConfig?.camera?.thirdPersonMode ??
    'character-follow'

  const latestPropsRef = useRef({
    maze,
    playerCell,
    coins,
    powerUps,
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
    audioPaused,
    cameraMode,
    thirdPersonCameraMode: resolvedThirdPersonMode,
    engineConfig,
    onPlayerCellChange,
    onInteract,
    onPlayerDamage,
    onGameOver,
  })

  const handleTriggerDamageFeedback = useCallback((amount) => {
    setDamageFlash(true)
    setFloatingDamage(`-${amount} HP`)
    setIsImmune(true)

    if (damageFlashTimeoutRef.current) clearTimeout(damageFlashTimeoutRef.current)
    damageFlashTimeoutRef.current = setTimeout(() => {
      setDamageFlash(false)
    }, 450)

    if (floatingDamageTimeoutRef.current) clearTimeout(floatingDamageTimeoutRef.current)
    floatingDamageTimeoutRef.current = setTimeout(() => {
      setFloatingDamage(null)
    }, 900)

    if (immunityTimeoutRef.current) clearTimeout(immunityTimeoutRef.current)
    immunityTimeoutRef.current = setTimeout(() => {
      setIsImmune(false)
    }, 1200)
  }, [])

  const triggerDamageFeedbackRef = useRef(handleTriggerDamageFeedback)
  useEffect(() => {
    triggerDamageFeedbackRef.current = handleTriggerDamageFeedback
  }, [handleTriggerDamageFeedback])

  useEffect(() => {
    return () => {
      if (damageFlashTimeoutRef.current) clearTimeout(damageFlashTimeoutRef.current)
      if (immunityTimeoutRef.current) clearTimeout(immunityTimeoutRef.current)
      if (floatingDamageTimeoutRef.current) clearTimeout(floatingDamageTimeoutRef.current)
      if (horrorPulseTimeoutRef.current) clearTimeout(horrorPulseTimeoutRef.current)
    }
  }, [])

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
    latestPropsRef.current = {
      maze,
      playerCell,
      coins,
      powerUps,
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
      audioPaused,
      cameraMode,
      thirdPersonCameraMode: resolvedThirdPersonMode,
      engineConfig,
      onPlayerCellChange,
      onInteract,
      onPlayerDamage,
      onGameOver,
    }
  }, [
    maze,
    playerCell,
    coins,
    powerUps,
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
    audioPaused,
    cameraMode,
    resolvedThirdPersonMode,
    engineConfig,
    onPlayerCellChange,
    onInteract,
    onPlayerDamage,
    onGameOver,
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

    try {
      const initialConfig = {
        ...(latestPropsRef.current.engineConfig || {}),
        cameraMode: latestPropsRef.current.cameraMode,
        thirdPersonCameraMode: latestPropsRef.current.thirdPersonCameraMode,
        initialHealth: latestPropsRef.current.health,
        maxHealth: latestPropsRef.current.maxHealth,
        onPlayerDamage: (event) => {
          triggerDamageFeedbackRef.current?.(event.damage)
          latestPropsRef.current.onPlayerDamage?.(event)
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
        onHorrorEvent: (event) => {
          if (
            event &&
            event.visualScaresEnabled &&
            !event.reducedMotion &&
            (event.type === 'presence_warning' ||
              event.type === 'blackout' ||
              event.type === 'scripted_scare')
          ) {
            setHorrorPulse(event.type)
            if (horrorPulseTimeoutRef.current) clearTimeout(horrorPulseTimeoutRef.current)
            horrorPulseTimeoutRef.current = setTimeout(() => {
              setHorrorPulse(null)
            }, Math.min(2600, Math.round((event.duration || 1.6) * 850)))
          }
        },
      }
      engine = new MazeSceneEngine(canvasHost, initialConfig)
      engineRef.current = engine
      setCameraDistancePreset(
        engine.getCameraDistancePreset() || DEFAULT_THIRD_PERSON_CAMERA_DISTANCE
      )
      if (latestPropsRef.current.audioPaused || !latestPropsRef.current.controlsEnabled) {
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
          coins: latestPropsRef.current.coins,
          powerUps: latestPropsRef.current.powerUps,
          keycards: latestPropsRef.current.keycards,
          echoPath: latestPropsRef.current.echoPath,
          spawnBursts: false,
          isReset: true,
        })
        engine.setExitLocked(latestPropsRef.current.isExitLocked, {
          animate: false,
        })
      }

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

      engine.setMovementOptions({
        getWallPassArmed: () =>
          Boolean(latestPropsRef.current.activeEffects?.wallPassArmed) &&
          !wallPassLockRef.current,
        onPlayerCellChange: (cell, meta) => {
          if (meta?.usedWallPass) {
            wallPassLockRef.current = true
          }
          latestPropsRef.current.onPlayerCellChange?.(cell, meta)
        },
      })

      engine.setInputSource(() => {
        const props = latestPropsRef.current
        if (!props.controlsEnabled || props.hasWon || props.isGameOver) {
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
      }
      onErrorRef.current?.(error)
      return undefined
    }

    return () => {
      resetContinuousInput()
      wallPassLockRef.current = false
      if (typeof userCleanup === 'function') {
        userCleanup()
      }
      engine.dispose()
      if (engineRef.current === engine) {
        engineRef.current = null
      }
    }
  }, [inputRef, resetContinuousInput])

  // Optional drag-look support without requiring pointer lock
  useEffect(() => {
    const canvasHost = canvasHostRef.current
    if (!canvasHost || typeof canvasHost.addEventListener !== 'function') {
      return undefined
    }

    let draggingPointerId = null
    let draggingPointerType = null
    let lastX = 0
    let lastY = 0

    const handlePointerDown = (event) => {
      if (event?.pointerType === 'touch') {
        setHasUsedTouchControls(true)
      } else if (
        event?.pointerType === 'mouse' &&
        !event.target?.closest?.('[data-touch-control="true"]')
      ) {
        setHasUsedTouchControls(false)
      }
      const props = latestPropsRef.current
      if (!props.controlsEnabled || props.hasWon || props.isGameOver) return
      if (typeof event.button === 'number' && event.button !== 0) return
      if (
        event.target?.closest?.(
          '[data-touch-control="true"], [data-viewport-control="true"], button'
        )
      ) {
        return
      }
      draggingPointerId = event.pointerId ?? 0
      draggingPointerType = event.pointerType || 'mouse'
      lastX = event.clientX || 0
      lastY = event.clientY || 0
      canvasHost.setPointerCapture?.(draggingPointerId)
    }

    const handlePointerMove = (event) => {
      if (draggingPointerId === null) return
      if (
        event.pointerId !== undefined &&
        event.pointerId !== draggingPointerId
      ) {
        return
      }
      const props = latestPropsRef.current
      if (!props.controlsEnabled || props.hasWon || props.isGameOver) {
        draggingPointerId = null
        draggingPointerType = null
        return
      }
      const clientX = Number.isFinite(event.clientX) ? event.clientX : lastX
      const clientY = Number.isFinite(event.clientY) ? event.clientY : lastY
      const dx = clientX - lastX
      const dy = clientY - lastY
      lastX = clientX
      lastY = clientY
      const cfg = props.engineConfig || {}
      const { sensitivity: mouseSens, invertY } = resolveLookInputConfig(cfg)
      const isTouchDrag =
        draggingPointerType === 'touch' || event.pointerType === 'touch'
      const touchLookSens =
        Number.isFinite(cfg.touchLookSensitivity) && cfg.touchLookSensitivity > 0
          ? cfg.touchLookSensitivity
          : 1.8
      const sensitivity = isTouchDrag ? touchLookSens * 0.0022 : mouseSens
      engineRef.current?.applyLookDelta(dx, dy, { sensitivity, invertY })
    }

    const endDrag = (event) => {
      if (
        draggingPointerId !== null &&
        (event.pointerId === undefined || event.pointerId === draggingPointerId)
      ) {
        canvasHost.releasePointerCapture?.(draggingPointerId)
        draggingPointerId = null
        draggingPointerType = null
      }
    }

    canvasHost.addEventListener('pointerdown', handlePointerDown)
    canvasHost.addEventListener('pointermove', handlePointerMove)
    canvasHost.addEventListener('pointerup', endDrag)
    canvasHost.addEventListener('pointercancel', endDrag)

    return () => {
      draggingPointerId = null
      canvasHost.removeEventListener('pointerdown', handlePointerDown)
      canvasHost.removeEventListener('pointermove', handlePointerMove)
      canvasHost.removeEventListener('pointerup', endDrag)
      canvasHost.removeEventListener('pointercancel', endDrag)
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
      if (frameRef.current) {
        frameRef.current.dataset.pointerLocked = String(locked)
      }
    }

    const handleStageClick = (event) => {
      const props = latestPropsRef.current
      if (!props.controlsEnabled || props.hasWon || props.isGameOver) return
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
      if (!props.controlsEnabled || props.hasWon || props.isGameOver) {
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
    wallPassLockRef.current = false
    resetContinuousInput()
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

    if (isFullReset || prev.coins !== coins) {
      syncPayload.coins = coins
      hasCollectibleUpdates = true
    }
    if (isFullReset || prev.powerUps !== powerUps) {
      syncPayload.powerUps = powerUps
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

    prevSyncRef.current = {
      maze,
      runId,
      coins,
      powerUps,
      keycards,
      echoPath,
      isExitLocked,
    }
  }, [maze, runId, coins, powerUps, keycards, isExitLocked, echoPath])

  useEffect(() => {
    if (!lastEvent) return undefined
    engineRef.current?.handleGameEvent(lastEvent)

    if (lastEvent.type === 'locked_exit' || lastEvent.type === 'gate_unlocked') {
      const eventId = lastEvent.id
      const timerId = setTimeout(() => {
        setDismissedGateNoticeId(eventId)
      }, 3200)
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
    if (health === maxHealth) {
      engine.resetCombat()
    } else {
      engine.setHealth(health)
    }
  }, [health, maxHealth])

  useEffect(() => {
    engineRef.current?.setCameraMode(cameraMode)
  }, [cameraMode])

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
  useEffect(() => {
    if (
      typeof audioSpatialEnabled === 'boolean' ||
      typeof audioReverbEnabled === 'boolean'
    ) {
      engineRef.current?.setAudioOptions?.({
        ...(typeof audioSpatialEnabled === 'boolean'
          ? { spatialAudio: audioSpatialEnabled }
          : {}),
        ...(typeof audioReverbEnabled === 'boolean'
          ? { footstepEchoes: audioReverbEnabled }
          : {}),
      })
    }
  }, [audioSpatialEnabled, audioReverbEnabled])

  const horrorDirectorConfig = engineConfig?.horrorDirector
  useEffect(() => {
    if (horrorDirectorConfig) {
      engineRef.current?.updateHorrorConfig(horrorDirectorConfig)
    }
  }, [horrorDirectorConfig])

  // Respect browser autoplay restrictions: unlock/resume Web Audio strictly after a user gesture during active gameplay
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

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
      if (unlocked) {
        window.removeEventListener('pointerdown', handleUserGesture)
        window.removeEventListener('keydown', handleUserGesture)
        window.removeEventListener('touchstart', handleUserGesture)
      }
    }

    window.addEventListener('pointerdown', handleUserGesture, { passive: true })
    window.addEventListener('keydown', handleUserGesture, { passive: true })
    window.addEventListener('touchstart', handleUserGesture, { passive: true })

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
        } else if (props.audioPaused || !props.controlsEnabled) {
          engine.setPaused(true)
        } else {
          engine.setPaused(false)
        }
      }
    }
    document?.addEventListener?.('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pointerdown', handleUserGesture)
      window.removeEventListener('keydown', handleUserGesture)
      window.removeEventListener('touchstart', handleUserGesture)
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
    } else if (audioPaused || !controlsEnabled) {
      resetContinuousInput()
      engine.setPaused(true)
    } else {
      engine.setPaused(false)
    }
  }, [hasWon, isGameOver, controlsEnabled, audioPaused, resetContinuousInput])

  // Exit fullscreen automatically if a modal/victory/game-over overlay takes focus outside the viewport
  useEffect(() => {
    if (hasWon || isGameOver || !controlsEnabled) {
      if (fullscreenControllerRef.current?.getState?.().isFullscreen) {
        void fullscreenControllerRef.current.exitFullscreen()
      }
    }
  }, [hasWon, isGameOver, controlsEnabled])

  const handleToggleFullscreen = useCallback((event) => {
    event?.stopPropagation?.()
    engineRef.current?.unlockAudio()
    void fullscreenControllerRef.current?.toggleFullscreen()
  }, [])

  const handleTouchLookDelta = useCallback((dx, dy) => {
    const props = latestPropsRef.current
    if (!props.controlsEnabled || props.hasWon || props.isGameOver) return
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
  const resolvedKeyBindings = normalizeKeyBindings(engineConfig?.keyBindings)
  const interactKeyLabel = formatKeyTokenLabel(resolvedKeyBindings.interact)
  const frameClassName = ['maze-viewport-3d', className].filter(Boolean).join(' ')
  const viewportLabel = hasValidMaze
    ? `${maze.difficultyLabel || 'Maze'} ${maze.rows} by ${maze.cols} 3D labyrinth viewport`
    : '3D labyrinth viewport'

  return (
    <div
      ref={frameRef}
      className={frameClassName}
      role="region"
      aria-label={viewportLabel}
      data-maze-ready={String(hasValidMaze)}
      data-maze-id={maze?.id || ''}
      data-player-cell={hasPlayerCell ? `${playerRow},${playerCol}` : ''}
      data-coins-remaining={String(Array.isArray(coins) ? coins.length : 0)}
      data-powerups-remaining={String(Array.isArray(powerUps) ? powerUps.length : 0)}
      data-keys-collected={String(keysCollected)}
      data-total-keys={String(totalKeys)}
      data-exit-locked={String(Boolean(isExitLocked))}
      data-echo-steps={String(Array.isArray(echoPath) ? echoPath.length : 0)}
      data-show-solution-path={String(Boolean(showSolutionPath))}
      data-wall-pass-armed={String(Boolean(activeEffects?.wallPassArmed))}
      data-camera-mode={cameraMode}
      data-third-person-camera-mode={resolvedThirdPersonMode}
      data-camera-distance={cameraDistancePreset}
      data-controls-enabled={String(Boolean(controlsEnabled))}
      data-has-won={String(Boolean(hasWon))}
      data-player-health={String(health)}
      data-player-max-health={String(maxHealth)}
      data-is-game-over={String(Boolean(isGameOver))}
      data-is-immune={String(Boolean(isImmune))}
      data-player-hidden={String(Boolean(stealthState.isHidden))}
      data-can-interact={String(Boolean(stealthState.canInteract))}
      data-nearby-spot-id={stealthState.nearbySpotId || ''}
      data-horror-intensity={horrorDirectorConfig?.intensity || 'medium'}
      data-visual-scares={String(horrorDirectorConfig?.visualScaresEnabled !== false)}
      data-reduced-motion={String(Boolean(horrorDirectorConfig?.reducedMotion))}
      data-fullscreen={String(Boolean(fullscreenState.isFullscreen))}
      data-fullscreen-supported={String(Boolean(fullscreenState.supported))}
      data-touch-controls-visible={String(Boolean(showTouchControls))}
    >
      <div ref={canvasHostRef} className="maze-viewport-3d__stage">
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

        {/* Stealth Darkened Vignette when Hidden */}
        <div
          className={[
            'maze-stealth-overlay',
            stealthState.isHidden ? 'maze-stealth-overlay--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        />

        {/* Compact Top-Left HUD: Icons + Numerical Values Only */}
        <div
          className="maze-vitals-hud"
          role="status"
          aria-label={`HP ${health} of ${maxHealth}${objectivesEnabled && totalKeys > 0 ? `, Keys ${keysCollected} of ${totalKeys}` : ''}`}
        >
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
          playerCell={playerCell}
          coins={coins}
          powerUps={powerUps}
          keycards={keycards}
          objectivesEnabled={objectivesEnabled}
          isExitLocked={isExitLocked}
          controlsEnabled={isInteractive}
          wayfinderEnabled={wayfinderEnabled}
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

        {/* Stealth Status Indicator Badge */}
        {stealthState.isHidden && !isGameOver ? (
          <div
            className="maze-stealth-badge"
            role="status"
            aria-label="Player hidden from enemy sight"
          >
            <span className="maze-stealth-badge__title">HIDDEN</span>
            <span className="maze-stealth-badge__sub">Concealed from sight</span>
          </div>
        ) : null}

        {/* Context-Sensitive Hiding Spot Interaction Prompt */}
        {stealthState.canInteract && isInteractive ? (
          <div
            className={[
              'maze-interact-prompt',
              stealthState.isHidden ? 'maze-interact-prompt--exit' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="status"
            aria-live="polite"
          >
            <span className="maze-interact-prompt__key">{interactKeyLabel}</span>
            <span className="maze-interact-prompt__text">
              {stealthState.isHidden
                ? 'Exit Hiding Spot'
                : stealthState.nearbySpotType === 'supply_cabinet'
                  ? 'Hide in Cabinet'
                  : 'Hide in Locker'}
            </span>
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
                onMoveAxes={setTouchMovement}
                onLookDelta={handleTouchLookDelta}
                onSprintChange={setTouchSprint}
                onInteractChange={setTouchInteract}
                onTriggerInteract={triggerInteract}
                onToggleFlashlight={handleToggleFlashlight}
                onActivateAbility={triggerAbility}
                onTouchActivity={handleTouchActivity}
                onReset={resetTouch}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default MazeViewport3D
