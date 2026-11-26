import Button from '../common/Button.jsx'
import Modal from '../common/Modal.jsx'
import StarRating from '../common/StarRating.jsx'
import { getNextLevel, normalizeLevel } from '../../game/mechanics/levelProgression.js'
import { formatElapsedTime } from '../../game/mechanics/runTimer.js'

export default function VictoryModal({
  isOpen = false,
  completedLevel = 1,
  nextLevel = 2,
  maze = null,
  victorySummary = null,
  formattedTime = '00:00',
  shardsCollected = 0,
  totalShards = 0,
  isActionPending = false,
  onNextLevel = null,
  onReplayLevel = null,
  onMainMenu = null,
}) {
  const resolvedCompletedLevel = normalizeLevel(completedLevel)
  const resolvedNextLevel = normalizeLevel(nextLevel ?? getNextLevel(resolvedCompletedLevel))
  const rows = maze?.rows ?? 0
  const cols = maze?.cols ?? 0
  const seed = maze?.seed ?? ''

  const subtitle =
    rows > 0 && cols > 0
      ? `Level ${resolvedCompletedLevel} Complete · Labyrinth ${rows}×${cols} · Seed #${seed}`
      : `Level ${resolvedCompletedLevel} Complete`

  return (
    <Modal
      isOpen={isOpen}
      onClose={onReplayLevel}
      title="Maze Escaped"
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
          <div className="maze-victory-actions__secondary">
            <Button
              variant="secondary"
              size="md"
              onClick={onReplayLevel}
              disabled={isActionPending}
              data-testid="victory-replay-level-btn"
            >
              Replay Level
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

      {victorySummary ? (
        <>
          <div className="maze-victory-rating">
            <StarRating
              rating={victorySummary.stars}
              size="lg"
              label={`Earned ${victorySummary.stars} out of 3 stars`}
            />
            {victorySummary.beatPar ? (
              <div className="maze-victory-badges">
                <span className="maze-victory-badge maze-victory-badge--emerald">
                  Under Par
                </span>
              </div>
            ) : null}
            <div className="maze-victory-breakdown">
              <span>Base +{victorySummary.breakdown.baseScore}</span>
              <span>Time +{victorySummary.breakdown.timeBonus}</span>
              <span>Health +{victorySummary.breakdown.healthBonus}</span>
              {victorySummary.breakdown.keycardBonus > 0 ? (
                <span>Keys +{victorySummary.breakdown.keycardBonus}</span>
              ) : null}
              {victorySummary.breakdown.shardBonus > 0 ? (
                <span>Shards +{victorySummary.breakdown.shardBonus}</span>
              ) : null}
            </div>
          </div>

          <div className="maze-victory-stats">
            <div className="maze-victory-stat">
              <span className="maze-victory-stat__label">Completion Time</span>
              <span className="maze-victory-stat__value maze-victory-stat__value--accent">
                {formatElapsedTime(victorySummary.completionTimeMs)}
              </span>
            </div>
            <div className="maze-victory-stat">
              <span className="maze-victory-stat__label">Final Score</span>
              <span className="maze-victory-stat__value">
                {victorySummary.score}
              </span>
            </div>
            <div className="maze-victory-stat">
              <span className="maze-victory-stat__label">Soul Shards</span>
              <span className="maze-victory-stat__value">
                {shardsCollected} / {totalShards}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="maze-victory-stats">
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Completion Time</span>
            <span className="maze-victory-stat__value maze-victory-stat__value--accent">
              {formattedTime}
            </span>
          </div>
          <div className="maze-victory-stat">
            <span className="maze-victory-stat__label">Soul Shards</span>
            <span className="maze-victory-stat__value">
              {shardsCollected} / {totalShards}
            </span>
          </div>
        </div>
      )}
    </Modal>
  )
}
