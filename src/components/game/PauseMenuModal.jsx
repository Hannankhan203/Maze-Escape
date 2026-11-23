import { COLLECTIBLE_CONFIG, COLLECTIBLE_TYPES } from '../../game/mechanics/collectiblesConfig.js'
import { DEFAULT_KEY_BINDINGS } from '../../game/three/threeConfig.js'
import Button from '../common/Button'
import Modal from '../common/Modal'

function PowerUpGlyph({ type }) {
  if (type === COLLECTIBLE_TYPES.ECHO_REVEAL) {
    return (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <circle cx="10" cy="10" r="2.2" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5 4v6a5 5 0 0 0 10 0V4M5 7h3M12 7h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`
}

export default function PauseMenuModal({
  isOpen,
  maze,
  moves,
  shardsCollected = 0,
  totalShards = 0,
  shardBonus = 0,
  keysCollected = 0,
  totalKeys = 0,
  isExitLocked = false,
  objectivesEnabled = false,
  inventory = null,
  activeEffects = null,
  keyBindings = DEFAULT_KEY_BINDINGS,
  timeDisplayRef = null,
  onResume,
  onRestart,
  onNewMaze,
  onOpenSettings,
}) {
  void keyBindings
  const echoCount = inventory?.[COLLECTIBLE_TYPES.ECHO_REVEAL] || 0
  const echoMs = activeEffects?.echoRevealRemainingMs || 0

  const powerUpIndicators = [
    {
      config: COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ECHO_REVEAL],
      shortcutLabel: '',
      count: echoCount,
      isActive: echoMs > 0,
      statusText:
        echoMs > 0
          ? formatSeconds(echoMs)
          : echoCount > 0
            ? `x${echoCount}`
            : 'Empty',
    },
  ]

  return (
    <Modal
      isOpen={isOpen}
      onClose={onResume}
      title="Game Paused"
      subtitle={maze.difficultyLabel}
      size="lg"
      className="lv-modal--pause"
      closeOnBackdrop={false}
      closeOnEscape={false}
      footer={
        <div className="lv-pause-footer">
          <div className="lv-pause-footer__actions">
            <Button variant="secondary" onClick={onRestart}>
              Restart
            </Button>
            <Button variant="secondary" onClick={onNewMaze}>
              New Maze
            </Button>
          </div>
          <Button variant="primary" onClick={onResume}>
            Resume
          </Button>
        </div>
      }
    >
      <div className="lv-pause-menu">
        {/* Run Summary & Maze Stats */}
        <section className="lv-pause-section" aria-label="Current run telemetry">
          <div className="lv-pause-section__head">
            <h3 className="lv-pause-section__title">Run Overview</h3>
          </div>
          <div className="lv-pause-stats">
            <div className="lv-pause-stat">
              <span className="lv-pause-stat__label">Time</span>
              <span
                ref={timeDisplayRef}
                className="lv-pause-stat__value lv-pause-stat__value--time"
                data-testid="pause-run-timer"
              >
                00:00.0
              </span>
            </div>
            <div className="lv-pause-stat">
              <span className="lv-pause-stat__label">Keys</span>
              <span
                className={[
                  'lv-pause-stat__value',
                  objectivesEnabled && totalKeys > 0
                    ? isExitLocked
                      ? 'lv-pause-stat__value--locked'
                      : 'lv-pause-stat__value--unlocked'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-testid="pause-keys"
              >
                {objectivesEnabled && totalKeys > 0
                  ? `${keysCollected} / ${totalKeys} ${isExitLocked ? 'Locked' : 'Open'}`
                  : 'Off'}
              </span>
            </div>
            <div className="lv-pause-stat">
              <span className="lv-pause-stat__label">Moves</span>
              <span
                className="lv-pause-stat__value"
                data-testid="pause-moves"
              >
                {moves}
              </span>
            </div>
            <div className="lv-pause-stat">
              <span className="lv-pause-stat__label">Soul Shards</span>
              <span
                className="lv-pause-stat__value lv-pause-stat__value--coins"
                data-testid="pause-shards"
              >
                {shardsCollected} / {totalShards}
                {shardBonus > 0 ? ` (+${shardBonus})` : ''}
              </span>
            </div>
            <div className="lv-pause-stat">
              <span className="lv-pause-stat__label">Par</span>
              <span
                className="lv-pause-stat__value lv-pause-stat__value--par"
                data-testid="pause-par"
              >
                {maze.parMoves}
              </span>
            </div>
          </div>
        </section>

        {/* Power-Up Status Indicators */}
        <section className="lv-pause-section" aria-label="Power-up indicators">
          <div className="lv-pause-section__head">
            <h3 className="lv-pause-section__title">Abilities</h3>
          </div>
          <div className="lv-pause-powerups">
            {powerUpIndicators.map(({ config, shortcutLabel, count, isActive, statusText }) => {
              const isAvailable = count > 0 || isActive
              return (
                <div
                  key={config.type}
                  className={[
                    'lv-pause-powerup',
                    `lv-pause-powerup--${config.type}`,
                    isActive ? 'lv-pause-powerup--active' : '',
                    isAvailable ? 'lv-pause-powerup--ready' : 'lv-pause-powerup--empty',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-powerup-indicator={config.type}
                >
                  <span className="lv-pause-powerup__icon">
                    <PowerUpGlyph type={config.type} />
                  </span>
                  <div className="lv-pause-powerup__meta">
                    <span className="lv-pause-powerup__name">{config.label}</span>
                    <span className="lv-pause-powerup__status">{statusText}</span>
                  </div>
                  {shortcutLabel ? (
                    <kbd className="lv-pause-powerup__key">{shortcutLabel}</kbd>
                  ) : (
                    <span className="lv-pause-powerup__key">Auto</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Secondary Modal Navigation */}
        <section className="lv-pause-section lv-pause-section--links" aria-label="Chamber menus">
          <div className="lv-pause-links">
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              Settings
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  )
}
