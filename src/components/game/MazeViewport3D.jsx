import { useEffect, useRef } from 'react'
import { MazeSceneEngine } from '../../game/three/MazeSceneEngine.js'

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
 * @param {object|null} [props.activeEffects=null] - Active power-up states (`wallPassArmed`, timers).
 * @param {boolean} [props.hasWon=false] - Victory state flag.
 * @param {boolean} [props.controlsEnabled=true] - Input/pointer-lock eligibility gate.
 * @param {'first-person'|'third-person'} [props.cameraMode='first-person'] - Active 3D camera rig mode.
 * @param {object|null} [props.engineConfig=null] - Optional renderer/camera configuration overrides.
 * @param {Function|null} [props.onPlayerCellChange=null] - Callback `(cell, meta) => void` for discrete cell entry.
 * @param {Function|null} [props.onViewportReady=null] - Lifecycle hook `({ container, canvasHost, engine, getLatestProps }) => cleanup | void`.
 * @param {Function|null} [props.onViewportResize=null] - ResizeObserver callback `({ width, height }) => void`.
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
  activeEffects = null,
  hasWon = false,
  controlsEnabled = true,
  cameraMode = 'first-person',
  engineConfig = null,
  onPlayerCellChange = null,
  onViewportReady = null,
  onViewportResize = null,
  className = '',
  children = null,
}) {
  const frameRef = useRef(null)
  const canvasHostRef = useRef(null)
  const engineRef = useRef(null)
  const onReadyRef = useRef(onViewportReady)
  const onResizeRef = useRef(onViewportResize)
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
    const canvasHost = canvasHostRef.current
    if (!canvasHost) return undefined

    const engine = new MazeSceneEngine(
      canvasHost,
      latestPropsRef.current.engineConfig || {}
    )
    engineRef.current = engine
    if (latestPropsRef.current.maze) {
      engine.setMaze(latestPropsRef.current.maze)
    }
    engine.start()

    const userCleanup = onReadyRef.current?.({
      container: frameRef.current,
      canvasHost,
      engine,
      getLatestProps: () => latestPropsRef.current,
    })

    return () => {
      if (typeof userCleanup === 'function') {
        userCleanup()
      }
      engine.dispose()
      if (engineRef.current === engine) {
        engineRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setMaze(maze)
  }, [maze])

  const envConfig = engineConfig?.environment
  useEffect(() => {
    if (envConfig) {
      engineRef.current?.updateEnvironment(envConfig)
    }
  }, [envConfig])

  const hasValidMaze = Boolean(
    maze && Array.isArray(maze.grid) && maze.grid.length > 0
  )

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
      data-camera-mode={cameraMode}
      data-controls-enabled={String(Boolean(controlsEnabled))}
      data-has-won={String(Boolean(hasWon))}
    >
      <span className="lv-corner lv-corner--tl" aria-hidden="true" />
      <span className="lv-corner lv-corner--tr" aria-hidden="true" />
      <span className="lv-corner lv-corner--bl" aria-hidden="true" />
      <span className="lv-corner lv-corner--br" aria-hidden="true" />

      <div ref={canvasHostRef} className="maze-viewport-3d__stage">
        {children ? (
          <div className="maze-viewport-3d__overlay">{children}</div>
        ) : null}
      </div>
    </div>
  )
}

export default MazeViewport3D
