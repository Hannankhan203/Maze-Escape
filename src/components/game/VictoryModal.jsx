import Button from '../common/Button.jsx'
import Modal from '../common/Modal.jsx'
import StarRating from '../common/StarRating.jsx'
import { getNextLevel, normalizeLevel } from '../../game/mechanics/levelProgression.js'
import { formatElapsedTime } from '../../game/mechanics/runTimer.js'
import { clampSafeScore } from '../../game/mechanics/scoring.js'

export default function VictoryModal({
  isOpen = false,
  completedLevel = 1,
  nextLevel = 2,
  maze = null,
  victorySummary = null,
  cumulativeScore = null,
  formattedTime = '00:00',
  shardsCollected = 0,
  totalShards = 0,
  isActionPending = false,
  onNextLevel = null,
  onReplayLevel = null,
  onMainMenu = null,
  isSandbox = false,
  onReturnToSandbox = null,
}) {
  const resolvedCompletedLevel = normalizeLevel(completedLevel)
  const resolvedNextLevel = normalizeLevel(nextLevel ?? getNextLevel(resolvedCompletedLevel))
  const rows = maze?.rows ?? 0
  const cols = maze?.cols ?? 0
  const seed = maze?.seed ?? ''

  const subtitle = isSandbox
    ? rows > 0 && cols > 0
      ? `Sandbox Test Complete · Labyrinth ${rows}×${cols} · Seed #${seed}`
      : 'Sandbox Test Complete'
    : rows > 0 && cols > 0
      ? `Level ${resolvedCompletedLevel} Complete · Labyrinth ${rows}×${cols} · Seed #${seed}`
      : `Level ${resolvedCompletedLevel} Complete`

  const levelScore = clampSafeScore(victorySummary?.score ?? 0)
  const resolvedCumulativeScore = clampSafeScore(
    victorySummary?.cumulativeScore ?? cumulativeScore ?? levelScore
  )
  const stars =
    victorySummary && Number.isFinite(Number(victorySummary.stars))
      ? Math.max(0, Math.min(3, Math.round(Number(victorySummary.stars))))
      : 0
  const breakdown = victorySummary?.breakdown || {}
  const baseScore = clampSafeScore(
    breakdown.levelCompletionScore ?? breakdown.baseScore ?? 0
  )
  const timeBonus = clampSafeScore(breakdown.timeBonus ?? 0)
  const healthBonus = clampSafeScore(
    breakdown.survivalBonus ?? breakdown.healthBonus ?? 0
  )
  const keycardBonus = clampSafeScore(
    breakdown.objectiveBonus ?? breakdown.keycardBonus ?? 0
  )
  const shardBonus = clampSafeScore(breakdown.shardBonus ?? 0)
  const collectibleBonus = clampSafeScore(breakdown.collectibleBonus ?? 0)
  const damagePenalty = clampSafeScore(
    breakdown.damagePenalty ?? breakdown.penalty ?? 0
  )
  const flawlessSurvival = Boolean(victorySummary?.stats?.flawlessSurvival)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onReplayLevel}
      title={isSandbox ? 'Sandbox Test Complete' : 'Maze Escaped'}
      subtitle={subtitle}
      size="md"
      className="lv-modal--victory"
      showCloseButton={false}
      closeOnBackdrop={false}
      closeOnEscape={false}
      footer={
        <div
          className="maze-victory-actions"
          role="group"
          aria-label="Level completion actions"
        >
          {isSandbox ? (
            <Button
              variant="primary"
              size="lg"
              className="maze-victory-actions__primary"
              onClick={onReturnToSandbox || onMainMenu}
              disabled={isActionPending}
              data-testid="victory-return-sandbox-btn"
            >
              Return to Sandbox
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="maze-victory-actions__primary"
              onClick={onNextLevel}
              disabled={isActionPending}
              data-testid="victory-next-level-btn"
            >
              Next Level
            </Button>
          )}
          <div className="maze-victory-actions__secondary">
            <Button
              variant="secondary"
              size="md"
              onClick={onReplayLevel}
              disabled={isActionPending}
              data-testid="victory-replay-level-btn"
            >
              {isSandbox ? 'Replay Test' : 'Replay Level'}
            </Button>
            {typeof onMainMenu === 'function' ? (
              <Button
                variant="ghost"
                size="md"
                onClick={onMainMenu}
                disabled={isActionPending}
                data-testid="victory-main-menu-btn"
              >
                Main Menu
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {isSandbox ? (
        <div
          className="maze-victory-level-banner"
          aria-label="Sandbox Test Run Complete"
          data-testid="victory-sandbox-banner"
        >
          <div className="maze-victory-level-step maze-victory-level-step--completed">
            <span className="maze-victory-level-step__label">Mode</span>
            <span className="maze-victory-level-step__value">Developer Sandbox</span>
          </div>
          <span className="maze-victory-level-arrow" aria-hidden="true">
            &rarr;
          </span>
          <div className="maze-victory-level-step maze-victory-level-step--next">
            <span className="maze-victory-level-step__label">Progression</span>
            <span className="maze-victory-level-step__value">Isolated Test Run</span>
          </div>
        </div>
      ) : (
        <div
          className="maze-victory-level-banner"
          aria-label={`Completed Level ${resolvedCompletedLevel}, next up Level ${resolvedNextLevel}`}
        >
          <div
            className="maze-victory-level-step maze-victory-level-step--completed"
            data-testid="victory-completed-level"
          >
            <span className="maze-victory-level-step__label">Completed</span>
            <span className="maze-victory-level-step__value">
              Level {resolvedCompletedLevel}
            </span>
          </div>
          <span className="maze-victory-level-arrow" aria-hidden="true">
            &rarr;
          </span>
          <div
            className="maze-victory-level-step maze-victory-level-step--next"
            data-testid="victory-next-level"
          >
            <span className="maze-victory-level-step__label">Next Level</span>
            <span className="maze-victory-level-step__value">
              Level {resolvedNextLevel}
            </span>
          </div>
        </div>
      )}

      {victorySummary ? (
        <>
          <div
            className="maze-victory-rating"
            data-testid="victory-star-rating"
            data-stars={String(stars)}
          >
            <StarRating
              rating={stars}
              size="lg"
              label={`Earned ${stars} out of 3 stars`}
            />
            {victorySummary.beatPar || flawlessSurvival ? (
              <div className="maze-victory-badges">
                {victorySummary.beatPar ? (
                  <span className="maze-victory-badge maze-victory-badge--emerald">
                    Under Par
                  </span>
                ) : null}
                {flawlessSurvival ? (
                  <span className="maze-victory-badge maze-victory-badge--emerald">
                    No Damage
                  </span>
                ) : null}
              </div>
            ) : null}
            <div
              className="maze-victory-breakdown"
              data-testid="victory-score-breakdown"
              data-base-score={String(baseScore)}
              data-time-bonus={String(timeBonus)}
              data-health-bonus={String(healthBonus)}
              data-keycard-bonus={String(keycardBonus)}
              data-shard-bonus={String(shardBonus)}
              data-collectible-bonus={String(collectibleBonus)}
              data-damage-penalty={String(damagePenalty)}
            >
              <span data-testid="victory-breakdown-base">
                Base +{baseScore}
              </span>
              <span data-testid="victory-breakdown-time">
                Time +{timeBonus}
              </span>
              <span data-testid="victory-breakdown-health">
                Survival +{healthBonus}
              </span>
              <span data-testid="victory-breakdown-keys">
                Keys +{keycardBonus}
              </span>
              <span data-testid="victory-breakdown-shards">
                Shards +{shardBonus}
              </span>
              {collectibleBonus > 0 ? (
                <span data-testid="victory-breakdown-collectibles">
                  Items +{collectibleBonus}
                </span>
              ) : null}
              {damagePenalty > 0 ? (
                <span
                  className="maze-victory-breakdown__penalty"
                  data-testid="victory-breakdown-penalty"
                >
                  Penalty -{damagePenalty}
                </span>
              ) : null}
            </div>
          </div>

          <div className="maze-victory-stats">
            <div className="maze-victory-stat" data-testid="victory-level-score-card">
              <span className="maze-victory-stat__label">Level Score</span>
              <span
                className="maze-victory-stat__value"
                data-testid="victory-level-score"
              >
                {levelScore}
              </span>
            </div>
            <div className="maze-victory-stat" data-testid="victory-cumulative-score-card">
              <span className="maze-victory-stat__label">Cumulative Score</span>
              <span
                className="maze-victory-stat__value maze-victory-stat__value--accent"
                data-testid="victory-cumulative-score"
              >
                {resolvedCumulativeScore}
              </span>
            </div>
            <div className="maze-victory-stat" data-testid="victory-completion-time-card">
              <span className="maze-victory-stat__label">Completion Time</span>
              <span
                className="maze-victory-stat__value maze-victory-stat__value--accent"
                data-testid="victory-completion-time"
              >
                {formatElapsedTime(victorySummary.completionTimeMs)}
              </span>
            </div>
            <div className="maze-victory-stat" data-testid="victory-par-time-card">
              <span className="maze-victory-stat__label">Par Time</span>
              <span
                className="maze-victory-stat__value"
                data-testid="victory-par-time"
              >
                {formatElapsedTime(victorySummary.parTimeMs)}
              </span>
            </div>
            <div className="maze-victory-stat" data-testid="victory-soul-shards-card">
              <span className="maze-victory-stat__label">Soul Shards</span>
              <span
                className="maze-victory-stat__value"
                data-testid="victory-soul-shards"
              >
                {shardsCollected} / {totalShards}
              </span>
            </div>
            <div className="maze-victory-stat" data-testid="victory-time-bonus-card">
              <span className="maze-victory-stat__label">Time Bonus</span>
              <span
                className="maze-victory-stat__value"
                data-testid="victory-time-bonus"
              >
                +{timeBonus}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="maze-victory-stats">
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Completion Time</span>
            <span
              className="maze-victory-stat__value maze-victory-stat__value--accent"
              data-testid="victory-completion-time"
            >
              {formattedTime}
            </span>
          </div>
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Cumulative Score</span>
            <span
              className="maze-victory-stat__value"
              data-testid="victory-cumulative-score"
            >
              {resolvedCumulativeScore}
            </span>
          </div>
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Soul Shards</span>
            <span
              className="maze-victory-stat__value"
              data-testid="victory-soul-shards"
            >
              {shardsCollected} / {totalShards}
            </span>
          </div>
        </div>
      )}
    </Modal>
  )
}
