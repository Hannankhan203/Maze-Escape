import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createFullscreenController,
  resolveShowTouchControls,
} from '../../game/three/fullscreenController.js'
import { MazeSceneEngine } from '../../game/three/MazeSceneEngine.js'
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
  cameraMode = 'first-person',
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
  const prevMazeRef = useRef(maze)
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
  const [isMinimapOpen, setIsMinimapOpen] = useState(() =>
    typeof window !== 'undefined' && typeof window.innerWidth === 'number'
      ? window.innerWidth > 640
      : true
  )
  const [dismissedGateNoticeId, setDismissedGateNoticeId] = useState(null)
  const minimapRef = useRef(null)
  const staminaFillRef = useRef(null)
  const staminaNumericRef = useRef(null)
  const exhaustedTagRef = useRef(null)
  const batteryFillRef = useRef(null)
  const batteryNumericRef = useRef(null)
  const flashlightTagRef = useRef(null)

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

  const handleToggleMinimap = useCallback(() => {
    setIsMinimapOpen((prev) => !prev)
  }, [])

  const handleTriggerWayfinder = useCallback(() => {
    minimapRef.current?.triggerHint()
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
    onActivateAbility,
    onInteract: handleEngineInteract,
    onToggleFlashlight: handleToggleFlashlight,
    onToggleMinimap: handleToggleMinimap,
    onTriggerWayfinder: handleTriggerWayfinder,
  })

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
    cameraMode,
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
      cameraMode,
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
    cameraMode,
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

      engine.setFrameCallback((frameData) => {
        if (!frameData) return
        const staminaPct = Math.round(
          Math.max(0, Math.min(100, (frameData.stamina / (frameData.maxStamina || 100)) * 100))
        )
        if (staminaFillRef.current) {
          staminaFillRef.current.style.width = `${staminaPct}%`
          if (frameData.isExhausted) {
            staminaFillRef.current.className =
              'maze-vitals-hud__fill maze-vitals-hud__fill--stamina-exhausted'
          } else if (staminaPct <= 30) {
            staminaFillRef.current.className =
              'maze-vitals-hud__fill maze-vitals-hud__fill--stamina-warning'
          } else {
            staminaFillRef.current.className =
              'maze-vitals-hud__fill maze-vitals-hud__fill--stamina'
          }
        }
        if (staminaNumericRef.current) {
          staminaNumericRef.current.textContent = `${staminaPct}%`
        }
        if (exhaustedTagRef.current) {
          exhaustedTagRef.current.style.display = frameData.isExhausted ? 'inline-block' : 'none'
        }

        const batteryPct = Math.round(
          Math.max(0, Math.min(100, (frameData.battery / (frameData.maxBattery || 100)) * 100))
        )
        if (batteryFillRef.current) {
          batteryFillRef.current.style.width = `${batteryPct}%`
          if (batteryPct <= 20) {
            batteryFillRef.current.className =
              'maze-vitals-hud__fill maze-vitals-hud__fill--battery-critical'
          } else if (batteryPct <= 45) {
            batteryFillRef.current.className =
              'maze-vitals-hud__fill maze-vitals-hud__fill--battery-warning'
          } else {
            batteryFillRef.current.className =
              'maze-vitals-hud__fill maze-vitals-hud__fill--battery'
          }
        }
        if (batteryNumericRef.current) {
          batteryNumericRef.current.textContent = `${batteryPct}%`
        }
        if (flashlightTagRef.current) {
          flashlightTagRef.current.textContent = frameData.flashlightActive ? 'ON' : 'OFF'
          flashlightTagRef.current.dataset.active = String(Boolean(frameData.flashlightActive))
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
    let lastX = 0
    let lastY = 0

    const handlePointerDown = (event) => {
      const props = latestPropsRef.current
      if (!props.controlsEnabled || props.hasWon) return
      if (typeof event.button === 'number' && event.button !== 0) return
      if (
        event.target?.closest?.(
          '[data-touch-control="true"], [data-viewport-control="true"], button'
        )
      ) {
        return
      }
      draggingPointerId = event.pointerId ?? 0
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
      if (!props.controlsEnabled || props.hasWon) {
        draggingPointerId = null
        return
      }
      const dx =
        typeof event.movementX === 'number'
          ? event.movementX
          : (event.clientX || 0) - lastX
      const dy =
        typeof event.movementY === 'number'
          ? event.movementY
          : (event.clientY || 0) - lastY
      lastX = event.clientX || 0
      lastY = event.clientY || 0
      const cfg = props.engineConfig || {}
      const sensitivity =
        Number.isFinite(cfg.mouseSensitivity) && cfg.mouseSensitivity > 0
          ? cfg.mouseSensitivity
          : Number.isFinite(cfg.camera?.sensitivity) &&
              cfg.camera.sensitivity > 0
            ? cfg.camera.sensitivity
            : 0.0022
      const invertY = Boolean(cfg.invertY ?? cfg.camera?.invertY)
      engineRef.current?.applyLookDelta(dx, dy, { sensitivity, invertY })
    }

    const endDrag = (event) => {
      if (
        draggingPointerId !== null &&
        (event.pointerId === undefined || event.pointerId === draggingPointerId)
      ) {
        canvasHost.releasePointerCapture?.(draggingPointerId)
        draggingPointerId = null
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
      if (!props.controlsEnabled || props.hasWon) return
      if (engineConfig?.pointerLockEnabled === false) return
      if (
        event.target?.closest?.(
          '[data-touch-control="true"], [data-viewport-control="true"], button, input, select, textarea, a, .maze-preview-bar, .maze-toolbar'
        )
      ) {
        return
      }
      if (document.pointerLockElement !== canvasHost) {
        try {
          canvasHost.requestPointerLock?.()
        } catch {
          // Ignore pointer lock rejections or missing API support
        }
      }
    }

    const handleMouseMove = (event) => {
      if (document.pointerLockElement !== canvasHost) return
      const props = latestPropsRef.current
      if (!props.controlsEnabled || props.hasWon) {
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

      const cfg = props.engineConfig || {}
      const sensitivity =
        Number.isFinite(cfg.mouseSensitivity) && cfg.mouseSensitivity > 0
          ? cfg.mouseSensitivity
          : Number.isFinite(cfg.camera?.sensitivity) &&
              cfg.camera.sensitivity > 0
            ? cfg.camera.sensitivity
            : 0.0022
      const invertY = Boolean(cfg.invertY)

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
    const engine = engineRef.current
    if (!engine) return
    const isMazeChange = prevMazeRef.current !== maze
    prevMazeRef.current = maze
    engine.syncCollectibles({
      coins,
      powerUps,
      keycards,
      echoPath,
      spawnBursts: !isMazeChange && lastEvent !== null,
      isReset: isMazeChange || lastEvent === null,
    })
    engine.setExitLocked(isExitLocked, {
      animate: !isMazeChange && lastEvent !== null,
    })
  }, [maze, coins, powerUps, keycards, isExitLocked, echoPath, lastEvent])

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

  const envConfig = engineConfig?.environment
  useEffect(() => {
    if (envConfig) {
      engineRef.current?.updateEnvironment(envConfig)
    }
  }, [envConfig])

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

  const horrorDirectorConfig = engineConfig?.horrorDirector
  useEffect(() => {
    if (horrorDirectorConfig) {
      engineRef.current?.updateHorrorConfig(horrorDirectorConfig)
    }
  }, [horrorDirectorConfig])

  // Respect browser autoplay restrictions: unlock/resume Web Audio strictly after a user gesture
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleUserGesture = () => {
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
      if (typeof document !== 'undefined') {
        engineRef.current?.setPaused(document.hidden)
      }
    }
    document?.addEventListener?.('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pointerdown', handleUserGesture)
      window.removeEventListener('keydown', handleUserGesture)
      window.removeEventListener('touchstart', handleUserGesture)
      document?.removeEventListener?.('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setHasWon(hasWon)
    if (hasWon || isGameOver) {
      engine.setHorrorPaused(true)
      engine.setAudioPaused(false)
    } else if (!controlsEnabled) {
      engine.setPaused(true)
    } else {
      engine.setPaused(false)
    }
  }, [hasWon, isGameOver, controlsEnabled])

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
    const cfg = latestPropsRef.current.engineConfig || {}
    const invertY = Boolean(cfg.invertY ?? cfg.camera?.invertY)
    engineRef.current?.applyLookDelta(dx, dy, { invertY })
  }, [])

  const touchControlsMode = engineConfig?.touchControls || 'auto'
  const showTouchControls = resolveShowTouchControls({
    touchControlsMode,
    isInteractive,
    isFullscreen: fullscreenState.isFullscreen,
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
      <span className="lv-corner lv-corner--tl" aria-hidden="true" />
      <span className="lv-corner lv-corner--tr" aria-hidden="true" />
      <span className="lv-corner lv-corner--bl" aria-hidden="true" />
      <span className="lv-corner lv-corner--br" aria-hidden="true" />

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

        {/* 3D Mode Player Health & Integrity Gauge */}
        <div
          className="maze-vitals-hud"
          role="status"
          aria-label={`Player Health: ${health} of ${maxHealth} HP`}
        >
          <div className="maze-vitals-hud__header">
            <span className="maze-vitals-hud__icon" aria-hidden="true">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
            </span>
            <span className="maze-vitals-hud__label">VITALS</span>
            <span className="maze-vitals-hud__numeric">
              {health} / {maxHealth} HP
            </span>
            {isImmune && !isGameOver ? (
              <span className="maze-vitals-hud__immunity-tag">IMMUNE</span>
            ) : null}
          </div>
          <div className="maze-vitals-hud__track">
            <div
              className={[
                'maze-vitals-hud__fill',
                health <= 25
                  ? 'maze-vitals-hud__fill--critical'
                  : health <= 55
                    ? 'maze-vitals-hud__fill--warning'
                    : 'maze-vitals-hud__fill--healthy',
              ].join(' ')}
              style={{
                width: `${Math.max(0, Math.min(100, (health / maxHealth) * 100))}%`,
              }}
            />
          </div>

          {/* Stamina Meter */}
          <div className="maze-vitals-hud__row maze-vitals-hud__row--stamina">
            <div className="maze-vitals-hud__header">
              <span className="maze-vitals-hud__icon maze-vitals-hud__icon--stamina" aria-hidden="true">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </span>
              <span className="maze-vitals-hud__label">STAMINA</span>
              <span ref={staminaNumericRef} className="maze-vitals-hud__numeric">
                100%
              </span>
              <span
                ref={exhaustedTagRef}
                className="maze-vitals-hud__exhausted-tag"
                style={{ display: 'none' }}
              >
                TIRED
              </span>
            </div>
            <div className="maze-vitals-hud__track">
              <div
                ref={staminaFillRef}
                className="maze-vitals-hud__fill maze-vitals-hud__fill--stamina"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Flashlight & Battery Gauge */}
          <div className="maze-vitals-hud__row maze-vitals-hud__row--battery">
            <div className="maze-vitals-hud__header">
              <span className="maze-vitals-hud__icon maze-vitals-hud__icon--battery" aria-hidden="true">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="16" height="10" x="2" y="7" rx="2" ry="2" />
                  <line x1="22" x2="22" y1="11" y2="13" />
                </svg>
              </span>
              <span className="maze-vitals-hud__label">LIGHT</span>
              <span ref={flashlightTagRef} className="maze-vitals-hud__light-tag" data-active="false">
                OFF
              </span>
              <span ref={batteryNumericRef} className="maze-vitals-hud__numeric">
                100%
              </span>
            </div>
            <div className="maze-vitals-hud__track">
              <div
                ref={batteryFillRef}
                className="maze-vitals-hud__fill maze-vitals-hud__fill--battery"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Resonance Keycard Objectives */}
          {objectivesEnabled && totalKeys > 0 ? (
            <div
              className="maze-vitals-hud__row maze-vitals-hud__row--objectives"
              aria-label={`Resonance Keycards collected: ${keysCollected} of ${totalKeys}`}
            >
              <div className="maze-vitals-hud__header">
                <span
                  className="maze-vitals-hud__icon maze-vitals-hud__icon--keycard"
                  aria-hidden="true"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="7.5" cy="15.5" r="5.5" />
                    <path d="m21 2-9.6 9.6" />
                    <path d="m15.5 7.5 3 3L22 7l-3-3" />
                  </svg>
                </span>
                <span className="maze-vitals-hud__label">
                  KEYS: {keysCollected}/{totalKeys}
                </span>
                <span
                  className={[
                    'maze-vitals-hud__gate-tag',
                    isExitLocked
                      ? 'maze-vitals-hud__gate-tag--locked'
                      : 'maze-vitals-hud__gate-tag--unlocked',
                  ].join(' ')}
                >
                  {isExitLocked ? 'LOCKED' : 'OPEN'}
                </span>
              </div>
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
              width="14"
              height="14"
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
              width="14"
              height="14"
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
          <span className="maze-fullscreen-btn__label">
            {fullscreenState.isFullscreen ? 'Exit' : 'Fullscreen'}
          </span>
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
          isOpen={isMinimapOpen}
          controlsEnabled={isInteractive}
          onToggleOpen={handleToggleMinimap}
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
            <span className="maze-interact-prompt__key">F</span>
            <span className="maze-interact-prompt__text">
              {stealthState.isHidden
                ? 'Exit Hiding Spot'
                : stealthState.nearbySpotType === 'supply_cabinet'
                  ? 'Hide in Cabinet'
                  : 'Hide in Locker'}
            </span>
          </div>
        ) : null}

        <div className="maze-pointer-lock-hint" aria-hidden="true">
          Click 3D view to lock mouse look (ESC to release)
        </div>
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
                lookSensitivity={touchLookSensitivity}
                onMoveAxes={setTouchMovement}
                onLookDelta={handleTouchLookDelta}
                onSprintChange={setTouchSprint}
                onInteractChange={setTouchInteract}
                onTriggerInteract={triggerInteract}
                onToggleFlashlight={handleToggleFlashlight}
                onActivateAbility={triggerAbility}
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
