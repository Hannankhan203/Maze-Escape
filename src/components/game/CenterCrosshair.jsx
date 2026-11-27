import {
  CROSSHAIR_TARGET_STATES,
  resolveCrosshairFeedbackState,
} from './centerCrosshairState.js'

const LAYER_STYLE = Object.freeze({
  position: 'absolute',
  inset: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: '100%',
  height: '100%',
  zIndex: 25,
  pointerEvents: 'none',
  userSelect: 'none',
})

const DOT_BASE_STYLE = Object.freeze({
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  borderRadius: '9999px',
  pointerEvents: 'none',
})

const DOT_STATE_STYLES = Object.freeze({
  [CROSSHAIR_TARGET_STATES.NORMAL]: Object.freeze({
    ...DOT_BASE_STYLE,
    width: '5px',
    height: '5px',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    boxShadow:
      '0 0 0 1.25px rgba(0, 0, 0, 0.92), 0 0 4px rgba(0, 0, 0, 0.85)',
  }),
  [CROSSHAIR_TARGET_STATES.VALID_TARGET]: Object.freeze({
    ...DOT_BASE_STYLE,
    width: '6px',
    height: '6px',
    backgroundColor: '#5eead4',
    boxShadow:
      '0 0 0 1.25px rgba(0, 0, 0, 0.95), 0 0 7px rgba(45, 212, 191, 0.95), 0 0 3px rgba(0, 0, 0, 0.95)',
  }),
  [CROSSHAIR_TARGET_STATES.CARRYING]: Object.freeze({
    ...DOT_BASE_STYLE,
    width: '6px',
    height: '6px',
    backgroundColor: '#6ee7b7',
    boxShadow:
      '0 0 0 1.25px rgba(0, 0, 0, 0.95), 0 0 7px rgba(52, 211, 153, 0.9), 0 0 3px rgba(0, 0, 0, 0.95)',
  }),
  [CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT]: Object.freeze({
    ...DOT_BASE_STYLE,
    width: '6px',
    height: '6px',
    backgroundColor: '#fb7185',
    boxShadow:
      '0 0 0 1.25px rgba(0, 0, 0, 0.95), 0 0 7px rgba(251, 113, 133, 0.95), 0 0 3px rgba(0, 0, 0, 0.95)',
  }),
})

const HINT_CONTAINER_STYLE = Object.freeze({
  position: 'absolute',
  left: '50%',
  top: 'calc(50% + 18px)',
  transform: 'translateX(-50%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  whiteSpace: 'nowrap',
  padding: '3px 8px',
  borderRadius: '4px',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  backgroundColor: 'rgba(11, 16, 24, 0.88)',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.65)',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.03em',
  color: '#f1f5f9',
  pointerEvents: 'none',
})

const HINT_KEY_STYLES = Object.freeze({
  [CROSSHAIR_TARGET_STATES.VALID_TARGET]: Object.freeze({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1px 5px',
    borderRadius: '3px',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    border: '1px solid rgba(94, 234, 212, 0.5)',
    backgroundColor: 'rgba(4, 47, 46, 0.85)',
    color: '#99f6e4',
  }),
  [CROSSHAIR_TARGET_STATES.CARRYING]: Object.freeze({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1px 5px',
    borderRadius: '3px',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    border: '1px solid rgba(110, 231, 183, 0.5)',
    backgroundColor: 'rgba(2, 44, 34, 0.85)',
    color: '#a7f3d0',
  }),
  [CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT]: Object.freeze({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1px 5px',
    borderRadius: '3px',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    border: '1px solid rgba(251, 113, 133, 0.5)',
    backgroundColor: 'rgba(76, 5, 25, 0.85)',
    color: '#fecdd3',
  }),
})

const HINT_TEXT_STYLES = Object.freeze({
  [CROSSHAIR_TARGET_STATES.VALID_TARGET]: Object.freeze({ color: '#ccfbf1' }),
  [CROSSHAIR_TARGET_STATES.CARRYING]: Object.freeze({ color: '#d1fae5' }),
  [CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT]: Object.freeze({ color: '#fecdd3' }),
})

export default function CenterCrosshair({
  visible = true,
  stealthState = null,
  cameraMode = 'first-person',
  thirdPersonCameraMode = 'follow',
  pointerLocked = false,
}) {
  if (!visible) return null

  const feedback = resolveCrosshairFeedbackState(stealthState || {})
  const targetState =
    feedback.targetState || CROSSHAIR_TARGET_STATES.NORMAL
  const dotStyle =
    DOT_STATE_STYLES[targetState] ||
    DOT_STATE_STYLES[CROSSHAIR_TARGET_STATES.NORMAL]

  return (
    <div
      className="maze-center-crosshair-layer"
      style={LAYER_STYLE}
      data-center-crosshair-layer="true"
      data-crosshair-state={targetState}
      data-crosshair-camera-mode={cameraMode}
      data-crosshair-tp-mode={thirdPersonCameraMode || 'follow'}
      data-crosshair-pointer-locked={String(Boolean(pointerLocked))}
      data-targeted-piece-id={feedback.targetedPieceId || ''}
      data-carried-piece-id={feedback.carriedPieceId || ''}
    >
      {/* Exact screen-space center dot (50% / 50%) — never moves with mouse cursor */}
      <div
        className={[
          'maze-center-crosshair-dot',
          `maze-center-crosshair-dot--${targetState}`,
        ].join(' ')}
        style={dotStyle}
        data-center-crosshair-dot="true"
        data-crosshair-dot-state={targetState}
        aria-hidden="true"
      />

      {/* Concise contextual action indicator below center dot */}
      {feedback.hintText ? (
        <div
          className={[
            'maze-center-crosshair-hint',
            `maze-center-crosshair-hint--${targetState}`,
          ].join(' ')}
          style={HINT_CONTAINER_STYLE}
          role="status"
          aria-live="polite"
          data-rubble-indicator="true"
          data-rubble-state={feedback.rubbleState}
          data-rubble-piece-id={
            feedback.carriedPieceId || feedback.targetedPieceId || ''
          }
        >
          {feedback.hintKey ? (
            <span
              className={[
                'maze-center-crosshair-hint__key',
                `maze-center-crosshair-hint__key--${targetState}`,
              ].join(' ')}
              style={
                HINT_KEY_STYLES[targetState] ||
                HINT_KEY_STYLES[CROSSHAIR_TARGET_STATES.VALID_TARGET]
              }
            >
              {feedback.hintKey}
            </span>
          ) : null}
          <span
            className={[
              'maze-center-crosshair-hint__text',
              `maze-center-crosshair-hint__text--${targetState}`,
            ].join(' ')}
            style={
              HINT_TEXT_STYLES[targetState] ||
              HINT_TEXT_STYLES[CROSSHAIR_TARGET_STATES.VALID_TARGET]
            }
          >
            {feedback.hintText}
          </span>
        </div>
      ) : null}
    </div>
  )
}
