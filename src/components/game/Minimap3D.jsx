import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  MINIMAP_LOGICAL_SIZE,
  applyMinimapRevealEffects,
  buildMinimapSnapshot,
  createExplorationState,
  renderMinimapCanvas,
  syncMinimapCanvasResolution,
} from '../../game/mechanics/minimap.js'
import {
  computeWayfinderHint,
  DEFAULT_MAX_WAYFINDER_HINTS,
  formatWayfinderHintFromResolved,
  resolveWayfinderObjectiveTarget,
  WAYFINDER_HINT_DURATION_MS,
} from '../../game/mechanics/wayfinder.js'

const CANVAS_DRAW_SIZE = MINIMAP_LOGICAL_SIZE

function resolveAuthoritativeMinimapLevel(currentLevel, maze) {
  if (Number.isInteger(currentLevel) && currentLevel >= 1) {
    return currentLevel
  }
  if (Number.isInteger(maze?.level) && maze.level >= 1) {
    return maze.level
  }
  if (Number.isInteger(maze?.currentLevel) && maze.currentLevel >= 1) {
    return maze.currentLevel
  }
  return 1
}

function Minimap3D({
  ref = null,
  maze = null,
  runId = 1,
  currentLevel = null,
  playerCell = null,
  items = [],
  keycards = [],
  echoPath = [],
  activeEffects = null,
  hazards = null,
  enemies = null,
  objectivesEnabled = false,
  isExitLocked = false,
  controlsEnabled = true,
  wayfinderEnabled = true,
  spiritLanternActive = false,
  echoRevealActive = false,
  watchersEyeActive = false,
  spectralCompassActive = false,
}) {
  const resolvedLevel = resolveAuthoritativeMinimapLevel(currentLevel, maze)
  const runKey = `${resolvedLevel}-${maze?.id || 'none'}-${maze?.seed ?? 's'}-${runId}`
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const explorationRef = useRef(null)
  const liveMotionRef = useRef({
    runKey,
    cell: playerCell,
    worldPos: null,
    yaw: 0,
    enemies: null,
    hazards: null,
  })
  const lastRenderSigRef = useRef('')
  const lastRevealSigRef = useRef('')
  const wayfinderRouteCacheRef = useRef({ key: '', resolved: null })
  const hintTimeoutRef = useRef(null)

  const [hintState, setHintState] = useState({
    runKey,
    remaining: DEFAULT_MAX_WAYFINDER_HINTS,
    isOpen: false,
    activeHint: null,
  })

  const effectiveCell = playerCell || maze?.start || null
  const effRow = effectiveCell?.row ?? -1
  const effCol = effectiveCell?.col ?? -1
  const keycardsSig = useMemo(() => {
    if (!Array.isArray(keycards) || keycards.length === 0) return ''
    let s = String(keycards.length)
    for (let i = 0; i < keycards.length; i += 1) {
      const k = keycards[i]
      s += `|${k?.id || ''}:${k?.row ?? ''},${k?.col ?? ''}`
    }
    return s
  }, [keycards])

  const liveWayfinderTarget = useMemo(() => {
    if (!wayfinderEnabled || !maze || effRow < 0 || effCol < 0) return null
    const cell = { row: effRow, col: effCol }
    return computeWayfinderHint({
      maze,
      playerCell: cell,
      keycards,
      objectivesEnabled,
      isExitLocked,
    })
    // keycardsSig tracks identity+positions cleanly alongside maze/cell/lock state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wayfinderEnabled, maze, effRow, effCol, keycardsSig, objectivesEnabled, isExitLocked])

  const isHintBannerOpen =
    wayfinderEnabled &&
    hintState.runKey === runKey &&
    Boolean(hintState.isOpen || hintState.activeHint)

  const activeHint = isHintBannerOpen
    ? liveWayfinderTarget?.found
      ? liveWayfinderTarget
      : hintState.activeHint
    : null

  const resolvedSpiritLantern = Boolean(
    spiritLanternActive || (activeEffects?.spiritLanternRemainingMs || 0) > 0
  )
  const resolvedEchoReveal = Boolean(
    echoRevealActive || (activeEffects?.echoRevealRemainingMs || 0) > 0
  )
  const resolvedWatchersEye = Boolean(
    watchersEyeActive || (activeEffects?.watchersEyeRemainingMs || 0) > 0
  )
  const resolvedSpectralCompass = Boolean(
    spectralCompassActive ||
      (activeEffects?.spectralCompassRemainingMs || 0) > 0
  )

  const latestDataRef = useRef({
    maze,
    runKey,
    resolvedLevel,
    playerCell,
    items,
    keycards,
    echoPath,
    activeEffects,
    hazards,
    enemies,
    objectivesEnabled,
    isExitLocked,
    wayfinderEnabled,
    activeHint,
    liveWayfinderTarget,
    spiritLanternActive: resolvedSpiritLantern,
    echoRevealActive: resolvedEchoReveal,
    watchersEyeActive: resolvedWatchersEye,
    spectralCompassActive: resolvedSpectralCompass,
  })

  useEffect(() => {
    latestDataRef.current = {
      maze,
      runKey,
      resolvedLevel,
      playerCell,
      items,
      keycards,
      echoPath,
      activeEffects,
      hazards,
      enemies,
      objectivesEnabled,
      isExitLocked,
      wayfinderEnabled,
      activeHint,
      liveWayfinderTarget,
      spiritLanternActive: resolvedSpiritLantern,
      echoRevealActive: resolvedEchoReveal,
      watchersEyeActive: resolvedWatchersEye,
      spectralCompassActive: resolvedSpectralCompass,
    }
  }, [
    maze,
    runKey,
    resolvedLevel,
    playerCell,
    items,
    keycards,
    echoPath,
    activeEffects,
    hazards,
    enemies,
    objectivesEnabled,
    isExitLocked,
    wayfinderEnabled,
    activeHint,
    liveWayfinderTarget,
    resolvedSpiritLantern,
    resolvedEchoReveal,
    resolvedWatchersEye,
    resolvedSpectralCompass,
  ])

  useEffect(() => {
    const motionRef = liveMotionRef
    const expRef = explorationRef
    const sigRef = lastRenderSigRef
    return () => {
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current)
        hintTimeoutRef.current = null
      }
      expRef.current = null
      sigRef.current = ''
      motionRef.current = {
        runKey: '',
        cell: null,
        worldPos: null,
        yaw: 0,
        enemies: null,
        hazards: null,
      }
    }
  }, [])

  useEffect(() => {
    if (!wayfinderEnabled && hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current)
      hintTimeoutRef.current = null
    }
  }, [wayfinderEnabled])

  const ensureExploration = useCallback((data) => {
    if (!data?.maze) return null
    if (
      !explorationRef.current ||
      explorationRef.current.runKey !== data.runKey
    ) {
      const nextExp = createExplorationState(data.maze)
      nextExp.runKey = data.runKey
      explorationRef.current = nextExp
      liveMotionRef.current = {
        runKey: data.runKey,
        cell: data.playerCell || data.maze.start || null,
        worldPos: null,
        yaw: 0,
        enemies: null,
        hazards: null,
      }
      lastRenderSigRef.current = ''
      lastRevealSigRef.current = ''
      wayfinderRouteCacheRef.current = { key: '', resolved: null }
    }
    return explorationRef.current
  }, [])

  const drawCanvas = useCallback(
    (force = false) => {
      const data = latestDataRef.current
      if (!data.maze) return

      const exploration = ensureExploration(data)
      if (!exploration) return

      const motion = liveMotionRef.current
      const activeCell = motion.cell || data.maze.start
      const revealSig = activeCell
        ? `${data.runKey}|${activeCell.row},${activeCell.col}|${data.spiritLanternActive ? 1 : 0}${data.echoRevealActive ? 1 : 0}${data.spectralCompassActive ? 1 : 0}|${data.items.length}|${data.keycards.length}|${data.echoPath?.length || 0}`
        : ''
      if (force || revealSig !== lastRevealSigRef.current) {
        lastRevealSigRef.current = revealSig
        applyMinimapRevealEffects(exploration, data.maze, {
          playerCell: activeCell,
          activeEffects: data.activeEffects,
          echoPath: data.echoPath,
          items: data.items,
          keycards: data.keycards,
          spiritLanternActive: data.spiritLanternActive,
          echoRevealActive: data.echoRevealActive,
          spectralCompassActive: data.spectralCompassActive,
        })
      }

      if (containerRef.current) {
        containerRef.current.dataset.minimapDiscovered = String(
          exploration.discoveredCount
        )
      }

      let currentWayfinder = null
      if (data.wayfinderEnabled && activeCell) {
        const keycardList = Array.isArray(data.keycards) ? data.keycards : []
        let kSig = String(keycardList.length)
        for (let i = 0; i < keycardList.length; i += 1) {
          const k = keycardList[i]
          kSig += `,${k?.row ?? ''}:${k?.col ?? ''}`
        }
        const routeKey = `${data.runKey}|${activeCell.row},${activeCell.col}|${Boolean(data.objectivesEnabled)}|${Boolean(data.isExitLocked)}|${kSig}`
        let resolvedRoute = wayfinderRouteCacheRef.current.resolved
        if (wayfinderRouteCacheRef.current.key !== routeKey || !resolvedRoute) {
          resolvedRoute = resolveWayfinderObjectiveTarget({
            maze: data.maze,
            playerCell: activeCell,
            keycards: keycardList,
            objectivesEnabled: data.objectivesEnabled,
            isExitLocked: data.isExitLocked,
          })
          wayfinderRouteCacheRef.current.key = routeKey
          wayfinderRouteCacheRef.current.resolved = resolvedRoute
        }
        currentWayfinder = formatWayfinderHintFromResolved(resolvedRoute, {
          maze: data.maze,
          playerCell: activeCell,
          playerWorldPos: motion.worldPos,
          yaw: motion.yaw,
          objectivesEnabled: data.objectivesEnabled,
          isExitLocked: data.isExitLocked,
        })
      }

      if (containerRef.current && currentWayfinder) {
        containerRef.current.dataset.wayfinderTargetType =
          currentWayfinder.targetType || 'none'
        containerRef.current.dataset.wayfinderDirection =
          currentWayfinder.direction || 'here'
        containerRef.current.dataset.wayfinderRelativeDirection =
          currentWayfinder.relativeDirection || 'here'
        containerRef.current.dataset.wayfinderDistance = String(
          currentWayfinder.distanceSteps ?? 0
        )
      }

      const canvas = canvasRef.current
      if (!canvas) return

      const { dpr } = syncMinimapCanvasResolution(canvas, CANVAS_DRAW_SIZE)

      const wx = Number.isFinite(motion.worldPos?.x)
        ? motion.worldPos.x.toFixed(2)
        : activeCell
          ? `c${activeCell.col}`
          : 'n'
      const wz = Number.isFinite(motion.worldPos?.z)
        ? motion.worldPos.z.toFixed(2)
        : activeCell
          ? `r${activeCell.row}`
          : 'n'
      const yawSig = Number.isFinite(motion.yaw) ? motion.yaw.toFixed(2) : '0'
      const activeEnemies = motion.enemies ?? data.enemies
      const activeHazards = motion.hazards ?? data.hazards ?? data.maze?.hazards
      const enemyThreatSig =
        data.watchersEyeActive && activeEnemies
          ? `eye:${Date.now() >> 7}`
          : activeEnemies
            ? `e:${wx},${wz}`
            : 'ne'
      const effectSig = `${data.spiritLanternActive ? 1 : 0}${data.echoRevealActive ? 1 : 0}${data.watchersEyeActive ? 1 : 0}${data.spectralCompassActive ? 1 : 0}`
      const wfSig = `${data.activeHint?.direction || ''}:${currentWayfinder?.direction || ''}:${currentWayfinder?.targetType || ''}`
      const sig = `${data.runKey}|${dpr}|${exploration.discoveredCount}|${wx},${wz}|${yawSig}|${data.items.length}|${data.keycards.length}|${data.isExitLocked}|${effectSig}|${enemyThreatSig}|${wfSig}`

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
        items: data.items,
        keycards: data.keycards,
        hazards: activeHazards,
        enemies: activeEnemies,
        echoPath: data.echoPath,
        objectivesEnabled: data.objectivesEnabled,
        isExitLocked: data.isExitLocked,
        activeHint: data.activeHint,
        wayfinderTarget: data.wayfinderEnabled ? currentWayfinder : null,
        spiritLanternActive: data.spiritLanternActive,
        echoRevealActive: data.echoRevealActive,
        watchersEyeActive: data.watchersEyeActive,
        spectralCompassActive: data.spectralCompassActive,
        activeEffects: data.activeEffects,
        logicalSize: CANVAS_DRAW_SIZE,
        dpr,
      })
    },
    [ensureExploration]
  )

  useEffect(() => {
    if (liveMotionRef.current.runKey !== runKey) {
      liveMotionRef.current = {
        runKey,
        cell: playerCell || maze?.start || null,
        worldPos: null,
        yaw: 0,
        enemies: null,
        hazards: null,
      }
    } else if (playerCell) {
      liveMotionRef.current.cell = playerCell
    }
    drawCanvas(true)
  }, [
    maze,
    runKey,
    playerCell,
    items,
    keycards,
    echoPath,
    activeEffects,
    hazards,
    enemies,
    objectivesEnabled,
    isExitLocked,
    wayfinderEnabled,
    activeHint,
    resolvedSpiritLantern,
    resolvedEchoReveal,
    resolvedWatchersEye,
    resolvedSpectralCompass,
    drawCanvas,
  ])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function'
    ) {
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
      playerWorldPos: liveMotionRef.current.worldPos,
      yaw: liveMotionRef.current.yaw,
      keycards: data.keycards,
      objectivesEnabled: data.objectivesEnabled,
      isExitLocked: data.isExitLocked,
    })

    if (!hint.found) return null

    setHintState({
      runKey: data.runKey,
      remaining: Math.max(0, currentRemaining - 1),
      isOpen: true,
      activeHint: hint,
    })

    if (hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current)
    }
    const scheduledKey = data.runKey
    hintTimeoutRef.current = setTimeout(() => {
      setHintState((prev) =>
        prev.runKey === scheduledKey
          ? { ...prev, isOpen: false, activeHint: null }
          : prev
      )
    }, WAYFINDER_HINT_DURATION_MS)

    return hint
  }, [
    controlsEnabled,
    wayfinderEnabled,
    hintState.remaining,
    hintState.runKey,
    playerCell,
  ])

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
        if (frameData.enemies) {
          liveMotionRef.current.enemies = frameData.enemies
        } else if (frameData.enemyManager?.enemies) {
          liveMotionRef.current.enemies = frameData.enemyManager.enemies
        }
        if (frameData.hazards) {
          liveMotionRef.current.hazards = frameData.hazards
        } else if (frameData.hazardManager?.hazards) {
          liveMotionRef.current.hazards = frameData.hazardManager.hazards
        }

        drawCanvas(false)
      },
      triggerHint,
      getExplorationState() {
        return ensureExploration(latestDataRef.current)
      },
      getSnapshot(options = {}) {
        const data = latestDataRef.current
        const exploration = ensureExploration(data)
        if (!data.maze || !exploration) return null
        const motion = liveMotionRef.current
        return buildMinimapSnapshot({
          maze: data.maze,
          exploration,
          playerCell: motion.cell || data.maze.start,
          playerWorldPos: motion.worldPos,
          yaw: motion.yaw,
          items: data.items,
          keycards: data.keycards,
          hazards:
            options.includeHazards !== false
              ? motion.hazards ?? data.hazards ?? data.maze.hazards
              : undefined,
          enemies: motion.enemies ?? data.enemies,
          watchersEyeActive: data.watchersEyeActive,
          activeEffects: data.activeEffects,
          includeThreatVisibility: Boolean(options.includeThreatVisibility),
          objectivesEnabled: data.objectivesEnabled,
          isExitLocked: data.isExitLocked,
          activeHint: data.activeHint || data.liveWayfinderTarget,
        })
      },
      getWayfinderState() {
        const data = latestDataRef.current
        const currentRemaining =
          hintState.runKey === data.runKey
            ? hintState.remaining
            : DEFAULT_MAX_WAYFINDER_HINTS
        return {
          wayfinderEnabled: Boolean(data.wayfinderEnabled),
          remainingHints: currentRemaining,
          activeHint: data.activeHint,
          target: data.liveWayfinderTarget,
        }
      },
    }),
    [drawCanvas, ensureExploration, hintState.remaining, hintState.runKey, triggerHint]
  )

  if (!maze) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className="maze-minimap"
      role="region"
      aria-label={`Level ${resolvedLevel} tactical minimap`}
      data-testid="maze-minimap"
      data-viewport-control="true"
      data-minimap-permanent="true"
      data-minimap-level={String(resolvedLevel)}
      data-minimap-maze-id={maze?.id || ''}
      data-wayfinder-enabled={String(Boolean(wayfinderEnabled))}
      data-wayfinder-target-type={
        wayfinderEnabled ? liveWayfinderTarget?.targetType || 'none' : 'disabled'
      }
      data-wayfinder-direction={
        wayfinderEnabled ? liveWayfinderTarget?.direction || 'here' : 'here'
      }
      data-wayfinder-relative-direction={
        wayfinderEnabled ? liveWayfinderTarget?.relativeDirection || 'here' : 'here'
      }
      data-wayfinder-distance={String(
        wayfinderEnabled ? liveWayfinderTarget?.distanceSteps ?? 0 : 0
      )}
    >
      {activeHint ? (
        <div
          className="maze-minimap__hint-banner"
          role="status"
          aria-live="polite"
          data-wayfinder-hint={activeHint.direction}
          data-wayfinder-target={activeHint.targetType || ''}
          data-wayfinder-relative={activeHint.relativeDirection || ''}
          data-wayfinder-distance={String(activeHint.distanceSteps ?? 0)}
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
          role="img"
          aria-label="Fog-of-war exploration minimap"
        />
      </div>
    </div>
  )
}

export default Minimap3D

