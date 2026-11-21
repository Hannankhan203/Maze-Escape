import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  MINIMAP_LOGICAL_SIZE,
  createExplorationState,
  renderMinimapCanvas,
  revealAroundCell,
  syncMinimapCanvasResolution,
} from '../../game/mechanics/minimap.js'
import {
  computeWayfinderHint,
  DEFAULT_MAX_WAYFINDER_HINTS,
  WAYFINDER_HINT_DURATION_MS,
} from '../../game/mechanics/wayfinder.js'

const CANVAS_DRAW_SIZE = MINIMAP_LOGICAL_SIZE

function Minimap3D({
  ref = null,
  maze = null,
  runId = 1,
  playerCell = null,
  coins = [],
  powerUps = [],
  keycards = [],
  objectivesEnabled = false,
  isExitLocked = false,
  controlsEnabled = true,
  wayfinderEnabled = true,
}) {
  const runKey = `${maze?.id || 'none'}-${runId}`
  const canvasRef = useRef(null)
  const explorationRef = useRef(null)
  const liveMotionRef = useRef({
    cell: playerCell,
    worldPos: null,
    yaw: 0,
  })
  const lastRenderSigRef = useRef('')
  const hintTimeoutRef = useRef(null)

  const [hintState, setHintState] = useState({
    runKey,
    remaining: DEFAULT_MAX_WAYFINDER_HINTS,
    activeHint: null,
  })

  const activeHint =
    wayfinderEnabled && hintState.runKey === runKey ? hintState.activeHint : null

  const latestDataRef = useRef({
    maze,
    runKey,
    coins,
    powerUps,
    keycards,
    objectivesEnabled,
    isExitLocked,
    activeHint,
  })

  useEffect(() => {
    latestDataRef.current = {
      maze,
      runKey,
      coins,
      powerUps,
      keycards,
      objectivesEnabled,
      isExitLocked,
      activeHint,
    }
  }, [
    maze,
    runKey,
    coins,
    powerUps,
    keycards,
    objectivesEnabled,
    isExitLocked,
    activeHint,
  ])

  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!wayfinderEnabled && hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current)
      hintTimeoutRef.current = null
    }
  }, [wayfinderEnabled])

  const drawCanvas = useCallback((force = false) => {
    const data = latestDataRef.current
    if (!data.maze) return

    if (
      !explorationRef.current ||
      explorationRef.current.runKey !== data.runKey
    ) {
      const nextExp = createExplorationState(data.maze)
      nextExp.runKey = data.runKey
      explorationRef.current = nextExp
      lastRenderSigRef.current = ''
    }

    const exploration = explorationRef.current
    const motion = liveMotionRef.current
    const activeCell = motion.cell || data.maze.start
    if (activeCell) {
      revealAroundCell(exploration, data.maze, activeCell)
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const { dpr } = syncMinimapCanvasResolution(canvas, CANVAS_DRAW_SIZE)

    const wx = Number.isFinite(motion.worldPos?.x)
      ? motion.worldPos.x.toFixed(2)
      : 'n'
    const wz = Number.isFinite(motion.worldPos?.z)
      ? motion.worldPos.z.toFixed(2)
      : 'n'
    const yawSig = Number.isFinite(motion.yaw) ? motion.yaw.toFixed(2) : '0'
    const sig = `${data.runKey}|${dpr}|${exploration.discoveredCount}|${wx},${wz}|${yawSig}|${data.coins.length}|${data.powerUps.length}|${data.keycards.length}|${data.isExitLocked}|${data.activeHint?.direction || ''}`

    if (!force && sig === lastRenderSigRef.current) {
      return
    }
    lastRenderSigRef.current = sig

    renderMinimapCanvas(canvas, {
      maze: data.maze,
      exploration,
      playerCell: activeCell,
      playerWorldPos: motion.worldPos,
      yaw: motion.yaw,
      coins: data.coins,
      powerUps: data.powerUps,
      keycards: data.keycards,
      objectivesEnabled: data.objectivesEnabled,
      isExitLocked: data.isExitLocked,
      activeHint: data.activeHint,
      logicalSize: CANVAS_DRAW_SIZE,
      dpr,
    })
  }, [])

  useEffect(() => {
    liveMotionRef.current.cell = playerCell
    drawCanvas(true)
  }, [
    maze,
    runKey,
    playerCell,
    coins,
    powerUps,
    keycards,
    objectivesEnabled,
    isExitLocked,
    activeHint,
    drawCanvas,
  ])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined
    }
    const handleResize = () => {
      drawCanvas(false)
    }
    window.addEventListener('resize', handleResize, { passive: true })
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [drawCanvas])

  const triggerHint = useCallback(() => {
    if (!controlsEnabled || !wayfinderEnabled) return null
    const data = latestDataRef.current
    if (!data.maze) return null

    const currentRemaining =
      hintState.runKey === data.runKey
        ? hintState.remaining
        : DEFAULT_MAX_WAYFINDER_HINTS

    if (currentRemaining <= 0) {
      return null
    }

    const currentCell =
      liveMotionRef.current.cell || playerCell || data.maze.start
    const hint = computeWayfinderHint({
      maze: data.maze,
      playerCell: currentCell,
      keycards: data.keycards,
      objectivesEnabled: data.objectivesEnabled,
      isExitLocked: data.isExitLocked,
    })

    if (!hint.found) return null

    setHintState({
      runKey: data.runKey,
      remaining: Math.max(0, currentRemaining - 1),
      activeHint: hint,
    })

    if (hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current)
    }
    const scheduledKey = data.runKey
    hintTimeoutRef.current = setTimeout(() => {
      setHintState((prev) =>
        prev.runKey === scheduledKey
          ? { ...prev, activeHint: null }
          : prev
      )
    }, WAYFINDER_HINT_DURATION_MS)

    return hint
  }, [controlsEnabled, wayfinderEnabled, hintState.remaining, hintState.runKey, playerCell])

  useImperativeHandle(
    ref,
    () => ({
      syncFrame(frameData) {
        if (!frameData) return
        if (frameData.playerGridCell) {
          liveMotionRef.current.cell = frameData.playerGridCell
        }
        if (frameData.playerWorldPos) {
          liveMotionRef.current.worldPos = frameData.playerWorldPos
        }
        if (Number.isFinite(frameData.yaw)) {
          liveMotionRef.current.yaw = frameData.yaw
        }

        drawCanvas(false)
      },
      triggerHint,
    }),
    [drawCanvas, triggerHint]
  )

  if (!maze) {
    return null
  }

  return (
    <div
      className="maze-minimap"
      data-viewport-control="true"
      data-minimap-permanent="true"
    >
      {activeHint ? (
        <div
          className="maze-minimap__hint-banner"
          role="status"
          aria-live="polite"
          data-wayfinder-hint={activeHint.direction}
          data-wayfinder-target={activeHint.targetType || ''}
        >
          {activeHint.label}
        </div>
      ) : null}

      <div className="maze-minimap__body">
        <canvas
          ref={canvasRef}
          width={CANVAS_DRAW_SIZE}
          height={CANVAS_DRAW_SIZE}
          className="maze-minimap__canvas"
          aria-label="Fog-of-war exploration minimap"
        />
      </div>
    </div>
  )
}

export default Minimap3D
