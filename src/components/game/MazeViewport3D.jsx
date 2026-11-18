import { useCallback, useEffect, useRef } from 'react'
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
 *
 * @param {object} props
 * @param {object|null} [props.maze=null] - Canonical maze blueprint (`maze.grid`, `rows`, `cols`, `start`, `exit`).
 * @param {{row: number, col: number}|null} [props.playerCell=null] - Current discrete player grid cell.
 * @param {Array<{id: string, row: number, col: number}>} [props.coins=[]] - Remaining collectible coins.
 * @param {Array<{id: string, type: string, row: number, col: number}>} [props.powerUps=[]] - Remaining power-up tokens.
 * @param {Array<{row: number, col: number}>} [props.echoPath=[]] - Active Echo Reveal BFS cells.
 * @param {boolean} [props.showSolutionPath=false] - Whether debug/par BFS route markers are enabled.
 * @param {object|null} [props.inventory=null] - Optional player power-up inventory counts for touch/HUD display.
 * @param {object|null} [props.activeEffects=null] - Active power-up states (`wallPassArmed`, timers).
 * @param {boolean} [props.hasWon=false] - Victory state flag.
 * @param {boolean} [props.controlsEnabled=true] - Input/pointer-lock eligibility gate.
 * @param {'first-person'|'third-person'} [props.cameraMode='first-person'] - Active 3D camera rig mode.
 * @param {object|null} [props.engineConfig=null] - Optional renderer/camera configuration overrides.
 * @param {Function|null} [props.onPlayerCellChange=null] - Callback `(cell, meta) => void` for discrete cell entry.
 * @param {Function|null} [props.onActivateAbility=null] - Callback `(abilityType) => void` for Space / E / Q activation.
 * @param {Function|null} [props.onInteract=null] - Optional callback `() => void` for F / interact action.
 * @param {Function|null} [props.onViewportReady=null] - Lifecycle hook `({ container, canvasHost, engine, getLatestProps }) => cleanup | void`.
 * @param {Function|null} [props.onViewportResize=null] - ResizeObserver callback `({ width, height }) => void`.
 * @param {Function|null} [props.onViewportError=null] - Initialization/runtime error callback `(error) => void` for safe 2D fallback.
 * @param {string} [props.className=''] - Optional extra class name on the viewport frame.
 * @param {import('react').ReactNode} [props.children=null] - Optional viewport HUD/prompt overlay content.
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
  cameraMode = 'first-person',
  engineConfig = null,
  onPlayerCellChange = null,
  onActivateAbility = null,
  onInteract = null,
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
  const isInteractive = Boolean(controlsEnabled) && !hasWon
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
    onInteract,
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
    controlsEnabled,
    cameraMode,
    engineConfig,
    onPlayerCellChange,
  })

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
    latestPropsRef.current = {
      maze,
      playerCell,
      coins,
      powerUps,
      echoPath,
      showSolutionPath,
      activeEffects,
      hasWon,
      controlsEnabled,
      cameraMode,
      engineConfig,
      onPlayerCellChange,
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
    controlsEnabled,
    cameraMode,
    engineConfig,
    onPlayerCellChange,
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
        if (!props.controlsEnabled || props.hasWon) {
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
    >
      <span className="lv-corner lv-corner--tl" aria-hidden="true" />
      <span className="lv-corner lv-corner--tr" aria-hidden="true" />
      <span className="lv-corner lv-corner--bl" aria-hidden="true" />
      <span className="lv-corner lv-corner--br" aria-hidden="true" />

      <div ref={canvasHostRef} className="maze-viewport-3d__stage">
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
