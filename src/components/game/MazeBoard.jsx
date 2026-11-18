import { memo, useMemo } from 'react'
import { CELL_TYPES } from '../../game/generation/mazeConfig.js'
import { POWERUP_TYPES } from '../../game/mechanics/powerups.js'
import Player from './Player'

function PowerUpToken({ type }) {
  if (type === POWERUP_TYPES.WALL_PASS) {
    return (
      <span
        className="maze-powerup maze-powerup--wall_pass"
        aria-label="Wall Pass power-up"
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 3v14M4 7l3 3-3 3M16 7l-3 3 3 3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }

  if (type === POWERUP_TYPES.ECHO_REVEAL) {
    return (
      <span
        className="maze-powerup maze-powerup--echo_reveal"
        aria-label="Echo Reveal power-up"
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z"
            stroke="currentColor"
            strokeWidth="1.9"
          />
          <circle cx="10" cy="10" r="2.3" fill="currentColor" />
        </svg>
      </span>
    )
  }

  return (
    <span
      className="maze-powerup maze-powerup--coin_magnet"
      aria-label="Coin Magnet power-up"
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M5 4v6a5 5 0 0 0 10 0V4M5 7h3M12 7h3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

const MazeCell = memo(function MazeCell({
  cell,
  isStart,
  isExit,
  isSolution,
  isEchoReveal,
  hasCoin,
  powerUpType,
  effectKind,
  effectId,
  hasPathBelow,
  hasPathAbove,
}) {
  const isWall = cell === CELL_TYPES.WALL

  const classNames = [
    'maze-cell',
    isWall ? 'maze-cell--wall' : 'maze-cell--path',
    isWall && hasPathAbove ? 'maze-cell--wall-top-edge' : '',
    isWall && hasPathBelow ? 'maze-cell--wall-overhang' : '',
    !isWall && isEchoReveal && !isStart && !isExit
      ? 'maze-cell--echo-path'
      : !isWall && isSolution && !isStart && !isExit
        ? 'maze-cell--solution'
        : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classNames}
      role="gridcell"
      aria-label={
        isStart
          ? 'Start position'
          : isExit
            ? 'Exit gate'
            : powerUpType
              ? `${powerUpType} power-up`
              : hasCoin
                ? 'Gold coin'
                : isWall
                  ? 'Wall'
                  : 'Pathway'
      }
    >
      {isStart ? <span className="maze-marker-start" aria-hidden="true" /> : null}
      {isExit ? <span className="maze-marker-exit" aria-hidden="true" /> : null}
      {hasCoin ? <span className="maze-coin" aria-hidden="true" /> : null}
      {powerUpType ? <PowerUpToken type={powerUpType} /> : null}
      {effectKind ? (
        <span
          key={effectId}
          className={`maze-effect-burst maze-effect-burst--${effectKind}`}
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
})

function MazeBoard({
  maze,
  playerPosition,
  playerDirection = 'down',
  blockedBump = null,
  hasWon = false,
  showSolutionPath = false,
  echoPath = [],
  coins = [],
  powerUps = [],
  effects = [],
  wallPassArmed = false,
  magnetActive = false,
}) {
  const solutionKeys = useMemo(() => {
    if (!showSolutionPath || !Array.isArray(maze?.shortestPath)) {
      return new Set()
    }
    return new Set(maze.shortestPath.map((step) => `${step.row},${step.col}`))
  }, [maze, showSolutionPath])

  const echoKeys = useMemo(() => {
    if (!Array.isArray(echoPath) || echoPath.length === 0) {
      return new Set()
    }
    return new Set(echoPath.map((step) => `${step.row},${step.col}`))
  }, [echoPath])

  const coinKeys = useMemo(() => {
    const keys = new Set()
    for (let i = 0; i < coins.length; i += 1) {
      keys.add(`${coins[i].row},${coins[i].col}`)
    }
    return keys
  }, [coins])

  const powerUpByKey = useMemo(() => {
    const map = new Map()
    for (let i = 0; i < powerUps.length; i += 1) {
      map.set(`${powerUps[i].row},${powerUps[i].col}`, powerUps[i].type)
    }
    return map
  }, [powerUps])

  const effectByKey = useMemo(() => {
    const map = new Map()
    for (let i = 0; i < effects.length; i += 1) {
      map.set(`${effects[i].row},${effects[i].col}`, effects[i])
    }
    return map
  }, [effects])

  if (!maze || !Array.isArray(maze.grid) || maze.grid.length === 0) {
    return null
  }

  const { grid, rows, cols, start, exit, difficultyLabel } = maze
  const activePlayerPos = playerPosition || start

  return (
    <div className="maze-board-frame">
      <span className="lv-corner lv-corner--tl" aria-hidden="true" />
      <span className="lv-corner lv-corner--tr" aria-hidden="true" />
      <span className="lv-corner lv-corner--bl" aria-hidden="true" />
      <span className="lv-corner lv-corner--br" aria-hidden="true" />

      <div
        className="maze-board"
        role="grid"
        aria-label={`${difficultyLabel || 'Maze'} ${rows} by ${cols} labyrinth`}
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          aspectRatio: `${cols} / ${rows}`,
        }}
      >
        {grid.map((rowData, rIdx) =>
          rowData.map((cell, cIdx) => {
            const key = `${rIdx},${cIdx}`
            const isStart = start?.row === rIdx && start?.col === cIdx
            const isExit = exit?.row === rIdx && exit?.col === cIdx
            const isSolution = solutionKeys.has(key)
            const isEchoReveal = echoKeys.has(key)
            const hasCoin = coinKeys.has(key)
            const powerUpType = powerUpByKey.get(key) || null
            const effect = effectByKey.get(key) || null
            const hasPathBelow = grid[rIdx + 1]?.[cIdx] === CELL_TYPES.PATH
            const hasPathAbove = grid[rIdx - 1]?.[cIdx] === CELL_TYPES.PATH

            return (
              <MazeCell
                key={`${rIdx}-${cIdx}`}
                cell={cell}
                isStart={isStart}
                isExit={isExit}
                isSolution={isSolution}
                isEchoReveal={isEchoReveal}
                hasCoin={hasCoin}
                powerUpType={powerUpType}
                effectKind={effect?.kind || null}
                effectId={effect?.id || null}
                hasPathBelow={hasPathBelow}
                hasPathAbove={hasPathAbove}
              />
            )
          })
        )}

        <div className="maze-player-layer">
          <Player
            key={maze.id}
            position={activePlayerPos}
            rows={rows}
            cols={cols}
            direction={playerDirection}
            blockedBump={blockedBump}
            hasWon={hasWon}
            wallPassArmed={wallPassArmed}
            magnetActive={magnetActive}
          />
        </div>
      </div>
    </div>
  )
}

export default MazeBoard
