import { ELEVATOR_TRANSITION_PHASES } from '../../game/engine/elevatorLevelTransition.js'

/**
 * Progressive inter-level elevator door & shaft-travel presentation.
 *
 * Reuses Maze Escape's industrial underground elevator aesthetic without
 * introducing backdrop-filter GPU stalls over the active WebGL canvas:
 *   1. CLOSING_DOORS: Bi-parting steel doors slide smoothly shut over the completed level.
 *   2. TRAVELING:     Doors remain sealed while the next level generates and mounts cleanly.
 *   3. OPENING_DOORS: Doors slide open to reveal the ready next level.
 */
export default function ElevatorTransitionOverlay({
  transitionState = null,
  reducedMotion = false,
}) {
  if (
    !transitionState?.active ||
    transitionState.phase === ELEVATOR_TRANSITION_PHASES.IDLE
  ) {
    return null
  }

  const { phase, fromLevel, toLevel, doorProgress = 0, travelProgress = 0 } =
    transitionState
  const isClosing = phase === ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS
  const isTraveling = phase === ELEVATOR_TRANSITION_PHASES.TRAVELING
  const isOpening = phase === ELEVATOR_TRANSITION_PHASES.OPENING_DOORS

  const clampedDoor = Math.max(0, Math.min(1, Number(doorProgress) || 0))
  const easedDoor = isTraveling ? 1 : clampedDoor

  // easedDoor = 0 => fully open (±100% off-screen); easedDoor = 1 => sealed at center seam (0%)
  const slideOffsetPct = (1 - easedDoor) * 100
  const leftDoorTransform = `translate3d(-${slideOffsetPct.toFixed(3)}%, 0, 0)`
  const rightDoorTransform = `translate3d(${slideOffsetPct.toFixed(3)}%, 0, 0)`
  const seamOpacity = easedDoor > 0.88 ? Math.min(1, (easedDoor - 0.88) / 0.12) : 0
  const panelOpacity = isTraveling
    ? 1
    : isClosing
      ? Math.max(0, (easedDoor - 0.55) / 0.45)
      : Math.max(0, (easedDoor - 0.35) / 0.65)

  const displayedLevel =
    isOpening || (isTraveling && travelProgress >= 0.45) ? toLevel : fromLevel

  const statusHeading = isClosing
    ? 'SEALING LIFT DOORS'
    : isOpening
      ? `ARRIVED · LEVEL ${toLevel}`
      : `DESCENDING TO LEVEL ${toLevel}`

  const statusSubtext = isClosing
    ? `Leaving Level ${fromLevel}...`
    : isOpening
      ? 'Doors opening — prepare for deployment'
      : `Level ${fromLevel} → Level ${toLevel}`

  return (
    <div
      className={[
        'lv-elevator-transition',
        `lv-elevator-transition--${phase}`,
        reducedMotion ? 'lv-elevator-transition--reduced-motion' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
      aria-label={`Elevator transition from Level ${fromLevel} to Level ${toLevel}`}
      data-testid="elevator-level-transition"
      data-phase={phase}
      data-door-progress={clampedDoor.toFixed(3)}
      data-from-level={String(fromLevel)}
      data-to-level={String(toLevel)}
    >
      <div
        className="lv-elevator-door lv-elevator-door--left"
        data-testid="elevator-door-left"
        style={{ transform: leftDoorTransform }}
      >
        <div className="lv-elevator-door__rib" />
        <div className="lv-elevator-door__hazard-stripe" />
        <div className="lv-elevator-door__edge" />
      </div>

      <div
        className="lv-elevator-door lv-elevator-door--right"
        data-testid="elevator-door-right"
        style={{ transform: rightDoorTransform }}
      >
        <div className="lv-elevator-door__edge" />
        <div className="lv-elevator-door__hazard-stripe" />
        <div className="lv-elevator-door__rib" />
      </div>

      <div
        className="lv-elevator-transition__seam"
        aria-hidden="true"
        style={{ opacity: seamOpacity }}
      />

      <div
        className="lv-elevator-transition__panel-wrap"
        style={{ opacity: panelOpacity }}
      >
        <div className="lv-start-transition__elevator-cabin lv-elevator-transition__panel">
          <div className="lv-start-transition__indicator">
            <span
              className="lv-start-transition__level"
              data-testid="elevator-transition-floor"
            >
              LEVEL {displayedLevel}
            </span>
            <div className="lv-elevator-transition__progress-track" aria-hidden="true">
              <div
                className="lv-elevator-transition__progress-fill"
                style={{
                  transform: `scaleX(${
                    isOpening
                      ? 1
                      : isTraveling
                        ? Math.max(0.18, Math.min(1, travelProgress))
                        : Math.max(0.06, easedDoor * 0.25)
                  })`,
                }}
              />
            </div>
          </div>
          <h2
            className="lv-start-transition__title lv-elevator-transition__title"
            data-testid="elevator-transition-status"
          >
            {statusHeading}
          </h2>
          <p className="lv-start-transition__hint lv-elevator-transition__subtext">
            {statusSubtext}
          </p>
        </div>
      </div>
    </div>
  )
}
