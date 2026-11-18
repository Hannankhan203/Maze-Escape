import { useState } from 'react'
import Button from './components/common/Button'
import Modal from './components/common/Modal'
import StarRating from './components/common/StarRating'
import ToggleSwitch from './components/common/ToggleSwitch'
import GameShell from './components/layout/GameShell'
import ScreenHeader from './components/layout/ScreenHeader'

const DECORATIVE_MAZE_TILES = [
  'start',
  'crumb',
  'wall',
  'path',
  'shard',
  'wall',
  'crumb',
  'wall',
  'path',
  'path',
  'path',
  'player',
  'path',
  'path',
  'wall',
  'path',
  'wall',
  'wall',
  'path',
  'wall',
  'shard',
  'path',
  'path',
  'path',
  'exit',
]

const PALETTE_SWATCHES = [
  { name: 'Void', hex: '#090D14' },
  { name: 'Chamber', hex: '#101722' },
  { name: 'Wall Body', hex: '#233044' },
  { name: 'Wall Bevel', hex: '#354762' },
  { name: 'Wayfinder', hex: '#F59E0B' },
  { name: 'Exit Gate', hex: '#10B981' },
  { name: 'Echo Shard', hex: '#38BDF8' },
  { name: 'Start Ring', hex: '#818CF8' },
]

function MazeEmblemIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
      <rect
        x="2"
        y="2"
        width="24"
        height="24"
        rx="4"
        stroke="var(--color-wall-bevel)"
        strokeWidth="2"
      />
      <path
        d="M8 8h12v5h-6v7H8V8Z"
        stroke="var(--color-text-primary)"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="19" r="3" fill="var(--color-player)" />
    </svg>
  )
}

function App() {
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true)
  const [highContrast, setHighContrast] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [previewStars, setPreviewStars] = useState(3)
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <GameShell highContrast={highContrast} reducedMotion={reducedMotion}>
      <ScreenHeader
        eyebrow="Lumen Vault · Visual Foundation"
        title="Maze Escape"
        rightActions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsModalOpen(true)}
          >
            Open Modal
          </Button>
        }
      />

      <main className="foundation-preview">
        {/* Hero Identity & Decorative Maze Motif */}
        <section className="lv-hero-slab" aria-label="Maze Escape identity">
          <span className="lv-corner lv-corner--tl" aria-hidden="true" />
          <span className="lv-corner lv-corner--tr" aria-hidden="true" />
          <span className="lv-corner lv-corner--bl" aria-hidden="true" />
          <span className="lv-corner lv-corner--br" aria-hidden="true" />

          <div className="lv-hero-slab__brand">
            <span className="lv-badge">
              <span className="lv-badge__dot" aria-hidden="true" />
              Design System Preview
            </span>

            <div className="lv-hero-slab__title-row">
              <div className="lv-emblem" aria-hidden="true">
                <MazeEmblemIcon />
              </div>
              <h1 className="lv-hero-slab__title">Maze Escape</h1>
            </div>

            <p className="lv-hero-slab__subtitle">
              Carved nocturnal slate surfaces paired with warm amber Wayfinder
              illumination, jade Resonance Gates, and cyan Echo Shards.
            </p>

            <div className="lv-hero-slab__actions">
              <Button variant="primary" size="lg" onClick={() => setIsModalOpen(true)}>
                Primary Action
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setPreviewStars((s) => (s % 3) + 1)}
              >
                Cycle Rating ({previewStars}★)
              </Button>
            </div>
          </div>

          {/* Static Decorative Maze Visual Motif */}
          <div
            className="lv-maze-motif"
            aria-label="Decorative maze tile palette demonstration"
          >
            <div
              className="lv-maze-motif__grid"
              role="img"
              aria-label="Static decorative 5 by 5 maze preview"
            >
              {DECORATIVE_MAZE_TILES.map((tile, index) => {
                const isWall = tile === 'wall'
                return (
                  <div
                    key={index}
                    className={`lv-maze-tile ${
                      isWall ? 'lv-maze-tile--wall' : 'lv-maze-tile--path'
                    }`}
                  >
                    {tile === 'start' ? (
                      <span className="lv-maze-tile__start" />
                    ) : null}
                    {tile === 'crumb' && showBreadcrumbs ? (
                      <span className="lv-maze-tile__crumb" />
                    ) : null}
                    {tile === 'player' ? (
                      <span className="lv-maze-tile__player" />
                    ) : null}
                    {tile === 'shard' ? (
                      <span className="lv-maze-tile__shard" />
                    ) : null}
                    {tile === 'exit' ? (
                      <span className="lv-maze-tile__exit" />
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div className="lv-maze-motif__legend">
              <span className="lv-legend-item">
                <span
                  className="lv-legend-swatch"
                  style={{ backgroundColor: 'var(--color-start)' }}
                />
                Start
              </span>
              <span className="lv-legend-item">
                <span
                  className="lv-legend-swatch"
                  style={{ backgroundColor: 'var(--color-player)' }}
                />
                Player
              </span>
              <span className="lv-legend-item">
                <span
                  className="lv-legend-swatch"
                  style={{ backgroundColor: 'var(--color-shard)' }}
                />
                Shard
              </span>
              <span className="lv-legend-item">
                <span
                  className="lv-legend-swatch"
                  style={{ backgroundColor: 'var(--color-exit)' }}
                />
                Exit
              </span>
            </div>
          </div>
        </section>

        {/* Sample HUD Readout Bar */}
        <section className="lv-hud-bar" aria-label="Sample HUD readout">
          <div className="lv-hud-bar__group">
            <div className="lv-hud-slot">
              <span className="lv-hud-slot__label">Stage</span>
              <span className="lv-hud-slot__value">LVL 04</span>
            </div>
            <div className="lv-hud-slot">
              <span className="lv-hud-slot__label">Shards</span>
              <span className="lv-hud-slot__value lv-hud-slot__value--shard">
                2 / 2
              </span>
            </div>
          </div>

          <div className="lv-hud-bar__group">
            <div className="lv-hud-slot">
              <span className="lv-hud-slot__label">Time</span>
              <span className="lv-hud-slot__value">00:24.8</span>
            </div>
            <div className="lv-hud-slot">
              <span className="lv-hud-slot__label">Moves</span>
              <span className="lv-hud-slot__value">18 / 22</span>
            </div>
            <div className="lv-hud-slot">
              <span className="lv-hud-slot__label">Gate</span>
              <span className="lv-hud-slot__value lv-hud-slot__value--exit">
                OPEN
              </span>
            </div>
          </div>
        </section>

        {/* UI Primitives & Accessibility Controls */}
        <section
          className="lv-foundation-grid"
          aria-label="UI primitives and theme controls"
        >
          <div className="lv-panel">
            <div className="lv-panel__header">
              <h2 className="lv-panel__title">Tactile Controls</h2>
              <span className="lv-panel__tag">Buttons &amp; Stars</span>
            </div>

            <div className="lv-button-row">
              <Button variant="primary" size="md">
                Primary
              </Button>
              <Button variant="secondary" size="md">
                Secondary
              </Button>
              <Button variant="danger" size="md">
                Danger
              </Button>
              <Button variant="ghost" size="md">
                Ghost
              </Button>
            </div>

            <div className="lv-rating-row">
              <span className="lv-rating-row__label">Performance Crest</span>
              <StarRating rating={previewStars} max={3} size="lg" />
            </div>

            <div className="lv-swatch-grid" aria-label="Lumen Vault palette">
              {PALETTE_SWATCHES.map((swatch) => (
                <div key={swatch.hex} className="lv-swatch">
                  <span
                    className="lv-swatch__chip"
                    style={{ backgroundColor: swatch.hex }}
                    aria-hidden="true"
                  />
                  <span className="lv-swatch__meta">
                    <span className="lv-swatch__name">{swatch.name}</span>
                    <span className="lv-swatch__hex">{swatch.hex}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lv-panel">
            <div className="lv-panel__header">
              <h2 className="lv-panel__title">System Toggles</h2>
              <span className="lv-panel__tag">Interactive States</span>
            </div>

            <div className="lv-toggle-list">
              <ToggleSwitch
                label="Breadcrumb Trail"
                description="Displays faint amber step markers in the decorative motif."
                checked={showBreadcrumbs}
                onChange={setShowBreadcrumbs}
              />
              <ToggleSwitch
                label="High-Contrast Walls"
                description="Boosts stone wall bevel and chamber separation."
                checked={highContrast}
                onChange={setHighContrast}
              />
              <ToggleSwitch
                label="Reduced Motion"
                description="Disables ambient pulses and transitions across the shell."
                checked={reducedMotion}
                onChange={setReducedMotion}
              />
            </div>
          </div>
        </section>
      </main>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Modal Foundation"
        subtitle="Lumen Vault accessible dialog primitive"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Dismiss
            </Button>
            <Button variant="primary" onClick={() => setIsModalOpen(false)}>
              Confirm
            </Button>
          </>
        }
      >
        <p>
          This dialog demonstrates the backdrop blur, carved stone surface,
          keyboard Escape dismissal, and focusable button actions that will
          power the Pause and Level Completion overlays.
        </p>
      </Modal>
    </GameShell>
  )
}

export default App
