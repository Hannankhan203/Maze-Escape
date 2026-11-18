import { useMemo, useState } from 'react'
import Button from './components/common/Button'
import Modal from './components/common/Modal'
import MazeBoard from './components/game/MazeBoard'
import GameShell from './components/layout/GameShell'
import ScreenHeader from './components/layout/ScreenHeader'
import {
  DIFFICULTY_ORDER,
  MAZE_DIFFICULTIES,
} from './game/generation/mazeConfig.js'
import { generateMaze } from './game/generation/mazeGenerator.js'

function App() {
  const [difficulty, setDifficulty] = useState('medium')
  const [seed, setSeed] = useState(409217)
  const [showSolutionPath, setShowSolutionPath] = useState(false)
  const [isInfoOpen, setIsInfoOpen] = useState(false)

  const maze = useMemo(
    () => generateMaze({ difficulty, seed }),
    [difficulty, seed]
  )

  const handleRegenerate = () => {
    setSeed((prev) => ((prev * 1664525 + 1013904223) >>> 0) % 900000 + 100000)
  }

  const handleDifficultyChange = (nextDifficulty) => {
    setDifficulty(nextDifficulty)
  }

  return (
    <GameShell>
      <ScreenHeader
        as="h1"
        eyebrow={`Lumen Vault · ${maze.tierName}`}
        title="Maze Escape"
        rightActions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsInfoOpen(true)}
          >
            Maze Info
          </Button>
        }
      />

      <main className="gameplay-stage">
        {/* Basic Game HUD Placeholder */}
        <section className="game-hud" aria-label="Game status HUD">
          <div className="game-hud__group">
            <div className="game-hud__slot">
              <span className="game-hud__label">Size</span>
              <span className="game-hud__value">
                {maze.rows}×{maze.cols}
              </span>
            </div>
            <div className="game-hud__slot">
              <span className="game-hud__label">Par</span>
              <span className="game-hud__value game-hud__value--par">
                {maze.parMoves}
              </span>
            </div>
            <div className="game-hud__slot">
              <span className="game-hud__label">Seed</span>
              <span className="game-hud__value">#{maze.seed}</span>
            </div>
          </div>

          <div className="game-hud__group">
            <div className="game-hud__slot">
              <span className="game-hud__label">Time</span>
              <span className="game-hud__value">00:00.0</span>
            </div>
            <div className="game-hud__slot">
              <span className="game-hud__label">Moves</span>
              <span className="game-hud__value">0</span>
            </div>
            <div className="game-hud__slot">
              <span className="game-hud__label">Lives</span>
              <span className="game-hud__value game-hud__value--lives">
                3 / 3
              </span>
            </div>
          </div>
        </section>

        {/* Difficulty & Generation Controls */}
        <section className="maze-toolbar" aria-label="Maze controls">
          <div className="maze-toolbar__presets" role="group" aria-label="Maze size presets">
            {DIFFICULTY_ORDER.map((key) => {
              const preset = MAZE_DIFFICULTIES[key]
              const isActive = difficulty === key
              return (
                <Button
                  key={key}
                  variant={isActive ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={isActive}
                  onClick={() => handleDifficultyChange(key)}
                >
                  {preset.label} ({preset.rows}×{preset.cols})
                </Button>
              )
            })}
          </div>

          <div className="maze-toolbar__actions">
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={showSolutionPath}
              onClick={() => setShowSolutionPath((prev) => !prev)}
            >
              {showSolutionPath ? 'Hide BFS Path' : 'Show BFS Path'}
            </Button>
            <Button variant="primary" size="sm" onClick={handleRegenerate}>
              New Maze
            </Button>
          </div>
        </section>

        {/* Visual Maze Board */}
        <section className="maze-arena" aria-label="Generated maze board">
          <MazeBoard maze={maze} showSolutionPath={showSolutionPath} />

          <div className="maze-legend" aria-label="Maze tile legend">
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--start" />
              Start
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--exit" />
              Exit Gate
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--wall" />
              Slate Wall
            </span>
            <span className="maze-legend__item">
              <span className="maze-legend__swatch maze-legend__swatch--path" />
              Corridor
            </span>
          </div>
        </section>
      </main>

      <Modal
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        title="Maze Validation Summary"
        subtitle={`${maze.difficultyLabel} · ${maze.tierName}`}
        size="sm"
        footer={
          <Button variant="primary" onClick={() => setIsInfoOpen(false)}>
            Close
          </Button>
        }
      >
        <p>
          <strong>Dimensions:</strong> {maze.rows} × {maze.cols}
        </p>
        <p>
          <strong>Deterministic Seed:</strong> #{maze.seed}
        </p>
        <p>
          <strong>Start:</strong> ({maze.start.row}, {maze.start.col}) →{' '}
          <strong>Exit:</strong> ({maze.exit.row}, {maze.exit.col})
        </p>
        <p>
          <strong>BFS Shortest Path:</strong> {maze.parMoves} steps
        </p>
        <p>
          <strong>Connectivity:</strong>{' '}
          {maze.validation.valid ? 'Verified' : 'Invalid'} (
          {maze.validation.reachableCount} / {maze.validation.totalPathCells}{' '}
          walkable cells reachable)
        </p>
      </Modal>
    </GameShell>
  )
}

export default App
