import { memo, useMemo } from 'react'
import { CELL_TYPES } from '../../game/generation/mazeConfig.js'

const MazeCell = memo(function MazeCell({
  cell,
  isStart,
  isExit,
  isSolution,
  hasPathBelow,
  hasPathAbove,
}) {
  const isWall = cell === CELL_TYPES.WALL

  const classNames = [
    'maze-cell',
    isWall ? 'maze-cell--wall' : 'maze-cell--path',
    isWall && hasPathAbove ? 'maze-cell--wall-top-edge' : '',
    isWall && hasPathBelow ? 'maze-cell--wall-overhang' : '',
    !isWall && isSolution && !isStart && !isExit ? 'maze-cell--solution' : '',
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
            : isWall
              ? 'Wall'
              : 'Pathway'
      }
    >
      {isStart ? <span className="maze-marker-start" aria-hidden="true" /> : null}
      {isExit ? <span className="maze-marker-exit" aria-hidden="true" /> : null}
    </div>
  )
})

function MazeBoard({ maze, showSolutionPath = false }) {
  const solutionKeys = useMemo(() => {
    if (!showSolutionPath || !Array.isArray(maze?.shortestPath)) {
      return new Set()
    }
    return new Set(maze.shortestPath.map((step) => `${step.row},${step.col}`))
  }, [maze, showSolutionPath])

  if (!maze || !Array.isArray(maze.grid) || maze.grid.length === 0) {
    return null
  }

  const { grid, rows, cols, start, exit, difficultyLabel } = maze

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
            const isStart = start?.row === rIdx && start?.col === cIdx
            const isExit = exit?.row === rIdx && exit?.col === cIdx
            const isSolution = solutionKeys.has(`${rIdx},${cIdx}`)
            const hasPathBelow = grid[rIdx + 1]?.[cIdx] === CELL_TYPES.PATH
            const hasPathAbove = grid[rIdx - 1]?.[cIdx] === CELL_TYPES.PATH

            return (
              <MazeCell
                key={`${rIdx}-${cIdx}`}
                cell={cell}
                isStart={isStart}
                isExit={isExit}
                isSolution={isSolution}
                hasPathBelow={hasPathBelow}
                hasPathAbove={hasPathAbove}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

export default MazeBoard
