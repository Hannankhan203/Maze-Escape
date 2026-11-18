import { POWERUP_CONFIG, POWERUP_TYPES } from '../../game/mechanics/powerups.js'
import { formatElapsedTime } from '../../game/mechanics/runTimer.js'

function AbilityGlyph({ type }) {
  if (type === POWERUP_TYPES.WALL_PASS) {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M10 3v14M4 7l3 3-3 3M16 7l-3 3 3 3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (type === POWERUP_TYPES.ECHO_REVEAL) {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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

function GameHUD({
  maze,
  moves,
  coinsCollected,
  totalCoins,
  keysCollected = 0,
  totalKeys = 0,
  isExitLocked = false,
  objectivesEnabled = false,
  inventory,
  activeEffects,
  timeDisplayRef = null,
  bestTimeMs = null,
  disabled = false,
  onActivateAbility,
}) {
  const wallPassCount = inventory?.[POWERUP_TYPES.WALL_PASS] || 0
  const echoCount = inventory?.[POWERUP_TYPES.ECHO_REVEAL] || 0
  const magnetCount = inventory?.[POWERUP_TYPES.COIN_MAGNET] || 0

  const wallPassArmed = Boolean(activeEffects?.wallPassArmed)
  const echoMs = activeEffects?.echoRevealRemainingMs || 0
  const magnetMs = activeEffects?.magnetRemainingMs || 0

  const abilities = [
    {
      config: POWERUP_CONFIG[POWERUP_TYPES.WALL_PASS],
      count: wallPassCount,
      isActive: wallPassArmed,
      statusText: wallPassArmed
        ? 'Armed'
        : wallPassCount > 0
          ? `x${wallPassCount}`
          : 'Empty',
      canActivate: !disabled && wallPassCount > 0 && !wallPassArmed,
    },
    {
      config: POWERUP_CONFIG[POWERUP_TYPES.ECHO_REVEAL],
      count: echoCount,
      isActive: echoMs > 0,
      statusText:
        echoMs > 0
          ? formatSeconds(echoMs)
          : echoCount > 0
            ? `x${echoCount}`
            : 'Empty',
      canActivate: !disabled && echoCount > 0 && echoMs <= 0,
    },
    {
      config: POWERUP_CONFIG[POWERUP_TYPES.COIN_MAGNET],
      count: magnetCount,
      isActive: magnetMs > 0,
      statusText:
        magnetMs > 0
          ? formatSeconds(magnetMs)
          : magnetCount > 0
            ? `x${magnetCount}`
            : 'Empty',
      canActivate: !disabled && magnetCount > 0 && magnetMs <= 0,
    },
  ]

  return (
    <section className="game-hud-stack" aria-label="Game status and inventory">
      <div className="game-hud">
        <div className="game-hud__group">
          <div className="game-hud__slot">
            <span className="game-hud__label">Difficulty</span>
            <span className="game-hud__value">{maze.difficultyLabel}</span>
          </div>
          <div className="game-hud__slot">
            <span className="game-hud__label">Seed</span>
            <span className="game-hud__value">#{maze.seed}</span>
          </div>
          <div className="game-hud__slot">
            <span className="game-hud__label">Coins</span>
            <span
              className="game-hud__value game-hud__value--coins"
              aria-live="polite"
            >
              {coinsCollected} / {totalCoins}
            </span>
          </div>
          {objectivesEnabled && totalKeys > 0 ? (
            <div className="game-hud__slot">
              <span className="game-hud__label">Keys</span>
              <span
                className={[
                  'game-hud__value',
                  isExitLocked
                    ? 'game-hud__value--keys-locked'
                    : 'game-hud__value--keys-unlocked',
                ].join(' ')}
                aria-live="polite"
              >
                KEYS: {keysCollected}/{totalKeys}
              </span>
            </div>
          ) : null}
        </div>

        <div className="game-hud__group">
          <div className="game-hud__slot">
            <span className="game-hud__label">Moves</span>
            <span className="game-hud__value" aria-live="polite">
              {moves}
            </span>
          </div>
          <div className="game-hud__slot">
            <span className="game-hud__label">Par</span>
            <span className="game-hud__value game-hud__value--par">
              {maze.parMoves}
            </span>
          </div>
          <div className="game-hud__slot">
            <span className="game-hud__label">Time</span>
            <span
              ref={timeDisplayRef}
              className="game-hud__value game-hud__value--time"
              data-testid="hud-run-timer"
            >
              00:00.0
            </span>
          </div>
          {Number.isFinite(bestTimeMs) && bestTimeMs >= 0 ? (
            <div className="game-hud__slot">
              <span className="game-hud__label">Best</span>
              <span
                className="game-hud__value game-hud__value--best"
                data-testid="hud-best-time"
              >
                {formatElapsedTime(bestTimeMs)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="inventory-bar" role="group" aria-label="Power-up inventory">
        {abilities.map(({ config, count, isActive, statusText, canActivate }) => {
          const isAvailable = count > 0 || isActive
          return (
            <button
              key={config.type}
              type="button"
              className={[
                'inventory-slot',
                `inventory-slot--${config.type}`,
                isActive ? 'inventory-slot--active' : '',
                isAvailable ? 'inventory-slot--ready' : 'inventory-slot--empty',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!canActivate}
              aria-pressed={isActive}
              aria-label={`${config.label} (${config.shortcut}): ${statusText}`}
              onClick={() => onActivateAbility?.(config.type)}
            >
              <span className="inventory-slot__icon">
                <AbilityGlyph type={config.type} />
              </span>
              <span className="inventory-slot__meta">
                <span className="inventory-slot__name">{config.label}</span>
                <span className="inventory-slot__status">{statusText}</span>
              </span>
              <kbd className="inventory-slot__key">{config.shortcut}</kbd>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default GameHUD
