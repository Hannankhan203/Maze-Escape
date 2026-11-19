import { useId } from 'react'
import {
  DIFFICULTY_ORDER,
  MAZE_DIFFICULTIES,
} from '../../game/generation/mazeConfig.js'
import { POWERUP_CONFIG, POWERUP_TYPES } from '../../game/mechanics/powerups.js'
import { formatElapsedTime } from '../../game/mechanics/runTimer.js'
import {
  CAMERA_MODES,
  DEFAULT_AUDIO_VOLUMES,
} from '../../game/three/threeConfig.js'
import Button from '../common/Button'
import Modal from '../common/Modal'

const MIXER_CHANNELS = [
  { id: 'master', label: 'Master', defaultVal: DEFAULT_AUDIO_VOLUMES.master },
  { id: 'ambience', label: 'Ambience', defaultVal: DEFAULT_AUDIO_VOLUMES.ambience },
  { id: 'effects', label: 'SFX', defaultVal: DEFAULT_AUDIO_VOLUMES.effects },
  { id: 'music', label: 'Music', defaultVal: DEFAULT_AUDIO_VOLUMES.music },
]

function PowerUpGlyph({ type }) {
  if (type === POWERUP_TYPES.WALL_PASS) {
    return (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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
  difficulty,
  moves,
  coinsCollected,
  totalCoins,
  keysCollected = 0,
  totalKeys = 0,
  isExitLocked = false,
  objectivesEnabled = false,
  inventory = null,
  activeEffects = null,
  timeDisplayRef = null,
  bestTimeMs = null,
  cameraMode = CAMERA_MODES.FIRST_PERSON,
  audio = DEFAULT_AUDIO_VOLUMES,
  onResume,
  onRestart,
  onNewMaze,
  onChangeDifficulty,
  onChangeCameraMode,
  onAudioVolumeChange,
  onOpenSettings,
  onOpenRecords,
  onOpenMazeInfo,
}) {
  const mixerBaseId = useId()
  const isMuted = Boolean(audio?.muted)

  const wallPassCount = inventory?.[POWERUP_TYPES.WALL_PASS] || 0
  const echoCount = inventory?.[POWERUP_TYPES.ECHO_REVEAL] || 0
  const magnetCount = inventory?.[POWERUP_TYPES.COIN_MAGNET] || 0

  const wallPassArmed = Boolean(activeEffects?.wallPassArmed)
  const echoMs = activeEffects?.echoRevealRemainingMs || 0
  const magnetMs = activeEffects?.magnetRemainingMs || 0

  const powerUpIndicators = [
    {
      config: POWERUP_CONFIG[POWERUP_TYPES.WALL_PASS],
      count: wallPassCount,
      isActive: wallPassArmed,
      statusText: wallPassArmed
        ? 'Armed'
        : wallPassCount > 0
          ? `x${wallPassCount}`
          : 'Empty',
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
    },
  ]

  const bestLabel =
    Number.isFinite(bestTimeMs) && bestTimeMs >= 0
      ? ` · Best ${formatElapsedTime(bestTimeMs)}`
      : ''

  return (
    <Modal
      isOpen={isOpen}
      onClose={onResume}
      title="Game Paused"
      subtitle={`${maze.difficultyLabel} · ${maze.rows}×${maze.cols} · Seed #${maze.seed}${bestLabel}`}
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
              <span className="lv-pause-stat__label">Seed</span>
              <span
                className="lv-pause-stat__value"
                data-testid="pause-maze-seed"
              >
                #{maze.seed}
              </span>
            </div>
            <div className="lv-pause-stat">
              <span className="lv-pause-stat__label">Coins</span>
              <span
                className="lv-pause-stat__value lv-pause-stat__value--coins"
                data-testid="pause-coins"
              >
                {coinsCollected} / {totalCoins}
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
            <h3 className="lv-pause-section__title">Power-Ups</h3>
          </div>
          <div className="lv-pause-powerups">
            {powerUpIndicators.map(({ config, count, isActive, statusText }) => {
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
                  <kbd className="lv-pause-powerup__key">{config.shortcut}</kbd>
                </div>
              )
            })}
          </div>
        </section>

        {/* Difficulty & Camera Perspective */}
        <section className="lv-pause-section" aria-label="Chamber and camera setup">
          <div className="lv-pause-controls-grid">
            <div className="lv-pause-control-block">
              <span className="lv-pause-section__title">Difficulty</span>
              <div
                className="lv-pause-segmented lv-pause-segmented--difficulty"
                role="group"
                aria-label="Difficulty"
              >
                {DIFFICULTY_ORDER.map((key) => {
                  const preset = MAZE_DIFFICULTIES[key]
                  const selected = difficulty === key
                  return (
                    <button
                      key={key}
                      type="button"
                      className="lv-pause-segmented__btn"
                      aria-pressed={selected}
                      data-difficulty-option={key}
                      onClick={() => onChangeDifficulty?.(key)}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="lv-pause-control-block">
              <span className="lv-pause-section__title">Camera View</span>
              <div
                className="lv-pause-segmented"
                role="group"
                aria-label="Camera perspective"
              >
                <button
                  type="button"
                  className="lv-pause-segmented__btn"
                  aria-pressed={cameraMode === CAMERA_MODES.FIRST_PERSON}
                  data-camera-option={CAMERA_MODES.FIRST_PERSON}
                  onClick={() => onChangeCameraMode?.(CAMERA_MODES.FIRST_PERSON)}
                >
                  First-Person
                </button>
                <button
                  type="button"
                  className="lv-pause-segmented__btn"
                  aria-pressed={cameraMode === CAMERA_MODES.THIRD_PERSON}
                  data-camera-option={CAMERA_MODES.THIRD_PERSON}
                  onClick={() => onChangeCameraMode?.(CAMERA_MODES.THIRD_PERSON)}
                >
                  Third-Person
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Audio Controls & Channel Mixer */}
        <section className="lv-pause-section" aria-label="Audio controls and mixer">
          <div className="lv-pause-section__head">
            <h3 className="lv-pause-section__title">Audio &amp; Mixer</h3>
            <button
              type="button"
              className="lv-pause-mute-btn"
              aria-pressed={isMuted}
              data-pause-mute="true"
              onClick={() => onAudioVolumeChange?.('muted', !isMuted)}
            >
              {isMuted ? 'Muted' : 'Mute Audio'}
            </button>
          </div>
          <div className="lv-pause-mixer">
            {MIXER_CHANNELS.map((ch) => {
              const sliderId = `${mixerBaseId}-${ch.id}`
              const pct = Math.round((audio?.[ch.id] ?? ch.defaultVal) * 100)
              return (
                <div key={ch.id} className="lv-pause-mixer__channel">
                  <div className="lv-pause-mixer__meta">
                    <label htmlFor={sliderId} className="lv-pause-mixer__label">
                      {ch.label}
                    </label>
                    <span className="lv-pause-mixer__value">{pct}%</span>
                  </div>
                  <input
                    id={sliderId}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={pct}
                    aria-label={`${ch.label} volume`}
                    className="lv-pause-mixer__slider"
                    onChange={(e) =>
                      onAudioVolumeChange?.(ch.id, Number(e.target.value) / 100)
                    }
                  />
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
            <Button variant="secondary" size="sm" onClick={onOpenRecords}>
              Records
            </Button>
            <Button variant="secondary" size="sm" onClick={onOpenMazeInfo}>
              Maze Info
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  )
}
