import { useCallback, useEffect, useRef, useState } from 'react'
import { MazeSceneEngine } from '../../game/three/MazeSceneEngine.js'
import { useContinuousInput } from '../../hooks/useContinuousInput.js'
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
  playerCell = null,
  coins = [],
  powerUps = [],
  echoPath = [],
  showSolutionPath = false,
  inventory = null,
  activeEffects = null,
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
  const damageFlashTimeoutRef = useRef(null)
  const immunityTimeoutRef = useRef(null)
  const floatingDamageTimeoutRef = useRef(null)

  const handleEngineInteract = useCallback(() => {
    const engine = engineRef.current
    if (engine) {
      engine.unlockAudio()
      engine.interact()
    }
    onInteractRef.current?.()
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
  })

  const latestPropsRef = useRef({
    maze,
    playerCell,
    coins,
    powerUps,
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
      }
      engine = new MazeSceneEngine(canvasHost, initialConfig)
      engineRef.current = engine

      if (latestPropsRef.current.maze) {
        engine.setMaze(latestPropsRef.current.maze)
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
      if (event.target?.closest?.('[data-touch-control="true"]')) {
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
      engineRef.current?.applyLookDelta(dx, dy)
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
          '[data-touch-control="true"], button, input, select, textarea, a, .maze-preview-bar, .maze-toolbar'
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
        engineRef.current?.setAudioPaused(document.hidden)
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
    if (hasWon) {
      engineRef.current?.setAudioPaused(true)
    } else {
      engineRef.current?.setAudioPaused(false)
    }
  }, [hasWon])

  const handleTouchLookDelta = useCallback((dx, dy) => {
    engineRef.current?.applyLookDelta(dx, dy)
  }, [])

  const touchControlsMode = engineConfig?.touchControls || 'auto'
  const showTouchControls = touchControlsMode !== 'off' && isInteractive
  const touchLookSensitivity =
    Number.isFinite(engineConfig?.touchLookSensitivity) &&
    engineConfig.touchLookSensitivity > 0
      ? engineConfig.touchLookSensitivity
      : 1.8

  const hasValidMaze = Boolean(
    maze && Array.isArray(maze.grid) && maze.grid.length > 0
  )

  const hasPlayerCell = Number.isInteger(playerRow) && Number.isInteger(playerCol)
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
          {floatingDamage ? (
            <div className="maze-vitals-hud__floating-hit" aria-hidden="true">
              {floatingDamage}
            </div>
          ) : null}
        </div>

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
                lookSensitivity={touchLookSensitivity}
                onMoveAxes={setTouchMovement}
                onLookDelta={handleTouchLookDelta}
                onSprintChange={setTouchSprint}
                onInteractChange={setTouchInteract}
                onTriggerInteract={triggerInteract}
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
