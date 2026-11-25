import { useState } from 'react'
import { COLLECTIBLE_CONFIG, COLLECTIBLE_TYPES } from '../../game/mechanics/collectiblesConfig.js'
import { DEFAULT_KEY_BINDINGS, formatKeyTokenLabel } from '../../game/three/threeConfig.js'
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
  onResume,
  onRestart,
  onOpenSettings,
}) {
  void maze
  void keyBindings
  const [view, setView] = useState('main')

  const echoCount = inventory?.[COLLECTIBLE_TYPES.ECHO_REVEAL] || 0
  const echoMs = activeEffects?.echoRevealRemainingMs || 0

  const collectibleExplanations = [
    { type: COLLECTIBLE_TYPES.HEALTH_CAPSULE, name: 'Health Capsule', word: 'Heal' },
    { type: COLLECTIBLE_TYPES.SOUL_SHARDS, name: 'Soul Shards', word: 'Score' },
    { type: COLLECTIBLE_TYPES.SPECTRAL_COMPASS, name: 'Spectral Compass', word: 'Attract' },
    { type: COLLECTIBLE_TYPES.PHANTOM_VEIL, name: 'Phantom Veil', word: 'Conceal' },
    { type: COLLECTIBLE_TYPES.ENERGY_CELL, name: 'Energy Cell', word: 'Recharge' },
    { type: COLLECTIBLE_TYPES.WARDING_CHARM, name: 'Warding Charm', word: 'Protect' },
    { type: COLLECTIBLE_TYPES.TIME_FRAGMENT, name: 'Time Fragment', word: 'Slow' },
    { type: COLLECTIBLE_TYPES.WATCHERS_EYE, name: "Watcher's Eye", word: 'Reveal' },
    { type: COLLECTIBLE_TYPES.ECHO_PULSE, name: 'Echo Pulse', word: 'Stun' },
    { type: COLLECTIBLE_TYPES.SPIRIT_LANTERN, name: 'Spirit Lantern', word: 'Illuminate' },
    { type: 'keys', name: 'Keys / Keycards', word: 'Unlock' },
    { type: COLLECTIBLE_TYPES.ECHO_REVEAL, name: 'Echo Reveal', word: 'Navigate' },
  ]

  const powerUpIndicators = collectibleExplanations.map(({ type, name, word }) => {
    const description =
      type === 'keys'
        ? 'Unlocks the exit gate when all required keycards are collected.'
        : COLLECTIBLE_CONFIG[type]?.description || ''

    if (type === 'keys') {
      return {
        type: 'keys',
        label: name,
        word,
        description,
        statusText: objectivesEnabled && totalKeys > 0 ? `${keysCollected}/${totalKeys}` : 'Off',
        isActive: false,
        isReady: objectivesEnabled && totalKeys > 0,
      }
    }
    if (type === COLLECTIBLE_TYPES.ECHO_REVEAL) {
      return {
        type,
        label: name,
        word,
        description,
        statusText:
          echoMs > 0
            ? formatSeconds(echoMs)
            : echoCount > 0
              ? `x${echoCount}`
              : 'Auto',
        isActive: echoMs > 0,
        isReady: echoCount > 0 || echoMs > 0,
      }
    }
    const count = inventory?.[type] || 0
    const remainingMs =
      type === COLLECTIBLE_TYPES.PHANTOM_VEIL
        ? activeEffects?.phantomVeilRemainingMs || 0
        : type === COLLECTIBLE_TYPES.TIME_FRAGMENT
          ? activeEffects?.timeFragmentRemainingMs || 0
          : type === COLLECTIBLE_TYPES.WATCHERS_EYE
            ? activeEffects?.watchersEyeRemainingMs || 0
            : 0
    const isActive = remainingMs > 0
    const shortcutLabel =
      type === COLLECTIBLE_TYPES.PHANTOM_VEIL
        ? formatKeyTokenLabel(keyBindings.phantomVeil)
        : type === COLLECTIBLE_TYPES.TIME_FRAGMENT
          ? formatKeyTokenLabel(keyBindings.timeFragment)
          : type === COLLECTIBLE_TYPES.WATCHERS_EYE
            ? formatKeyTokenLabel(keyBindings.watchersEye)
            : type === COLLECTIBLE_TYPES.ECHO_PULSE
              ? formatKeyTokenLabel(keyBindings.echoPulse)
              : ''

    return {
      type,
      label: name,
      word,
      description,
      statusText:
        isActive
          ? formatSeconds(remainingMs)
          : count > 0
            ? `x${count}`
            : shortcutLabel || '0',
      isActive,
      isReady: count > 0 || isActive,
    }
  })

  return (
    <Modal
      isOpen={isOpen}
      onClose={onResume}
      title={view === 'main' ? 'Game Paused' : 'Abilities & Collectibles'}
      subtitle={null}
      size="lg"
      className="lv-modal--pause"
      closeOnBackdrop={false}
      closeOnEscape={false}
      footer={
        view === 'main' ? (
          <div
            className="lv-pause-footer"
            role="group"
            aria-label="Pause menu actions"
            data-testid="pause-actions"
          >
            <Button variant="secondary" onClick={() => setView('abilities')} data-testid="pause-abilities-btn">
              Abilities
            </Button>
            <Button variant="secondary" onClick={onOpenSettings} data-testid="pause-settings-btn">
              Settings
            </Button>
            <Button variant="secondary" onClick={onRestart} data-testid="pause-restart-btn">
              Restart
            </Button>
            <Button variant="primary" onClick={onResume} data-testid="pause-resume-btn">
              Resume
            </Button>
          </div>
        ) : (
          <div className="lv-pause-footer lv-pause-footer--single" role="group" aria-label="Abilities actions">
            <Button variant="primary" onClick={() => setView('main')} data-testid="abilities-back-btn">
              Back to Pause Menu
            </Button>
          </div>
        )
      }
    >
      <div className="lv-pause-menu">
        {view === 'main' ? (
          <div className="lv-pause-counters" role="group" aria-label="Keys and Soul Shards">
            <div className="lv-pause-counter">
              <span className="lv-pause-counter__label">Keys</span>
              <span
                className={[
                  'lv-pause-counter__value',
                  objectivesEnabled && totalKeys > 0
                    ? isExitLocked
                      ? 'lv-pause-counter__value--locked'
                      : 'lv-pause-counter__value--unlocked'
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
            <div className="lv-pause-counter">
              <span className="lv-pause-counter__label">Soul Shards</span>
              <span
                className="lv-pause-counter__value lv-pause-counter__value--coins"
                data-testid="pause-shards"
              >
                {shardsCollected} / {totalShards}
                {shardBonus > 0 ? ` (+${shardBonus})` : ''}
              </span>
            </div>
          </div>
        ) : (
          <section className="lv-pause-section" aria-label="Abilities and collectibles inventory">
            <div className="lv-pause-powerups lv-pause-powerups--detailed">
              {powerUpIndicators.map(({ type, label, word, description, statusText, isActive, isReady }) => {
                return (
                  <div
                    key={type}
                    className={[
                      'lv-pause-powerup',
                      `lv-pause-powerup--${type}`,
                      isActive ? 'lv-pause-powerup--active' : '',
                      isReady ? 'lv-pause-powerup--ready' : 'lv-pause-powerup--empty',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    data-powerup-indicator={type}
                  >
                    <span className="lv-pause-powerup__icon">
                      <PowerUpGlyph type={type} />
                    </span>
                    <div className="lv-pause-powerup__meta">
                      <span className="lv-pause-powerup__name">{label}</span>
                      {description ? (
                        <span className="lv-pause-powerup__desc">
                          {description}
                        </span>
                      ) : null}
                      <span className="lv-pause-powerup__status">{statusText}</span>
                    </div>
                    <span className="lv-pause-powerup__key">{word}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
