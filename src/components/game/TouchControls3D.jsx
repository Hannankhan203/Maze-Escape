import { useCallback, useEffect, useRef } from 'react'
import { COLLECTIBLE_CONFIG, COLLECTIBLE_TYPES } from '../../game/mechanics/collectiblesConfig.js'
import {
  DEFAULT_KEY_BINDINGS,
  formatKeyTokenLabel,
  normalizeKeyBindings,
} from '../../game/three/threeConfig.js'
import { computeVirtualJoystickAxes } from '../../hooks/useContinuousInput.js'
import { HAPTIC_PATTERNS, triggerHapticFeedback } from '../../utils/haptics.js'
import {
  applyFlashlightClick,
  applyFlashlightKeyDown,
  applyFlashlightPointerDown,
  applyFlashlightPointerEnd,
  clearFlashlightResetTimer,
  createFlashlightPointerState,
} from './flashlightButtonState.js'

const DEFAULT_JOYSTICK_RADIUS = 44
const JOYSTICK_DEADZONE = 0.12

function formatCompactSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`
}

function safeSetPointerCapture(element, pointerId) {
  if (!element || typeof element.setPointerCapture !== 'function') return
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Ignore synthetic or detached pointer capture errors
  }
}

function safeReleasePointerCapture(element, pointerId) {
  if (!element || typeof element.releasePointerCapture !== 'function') return
  try {
    if (
      typeof element.hasPointerCapture !== 'function' ||
      element.hasPointerCapture(pointerId)
    ) {
      element.releasePointerCapture(pointerId)
    }
  } catch {
    // Ignore synthetic or already-released capture errors
  }
}

/**
 * Responsive mobile/tablet pointer-event touch controls for the 3D maze viewport.
 * Uses refs and direct DOM transforms to guarantee zero per-frame React state updates
 * while cleanly supporting simultaneous movement, touch-look rotation, sprint,
 * and Space/E/Q/F actions.
 *
 * @param {object} props
 * @param {boolean} [props.enabled=true] - Master interactive gate.
 * @param {'auto'|'always'|'off'} [props.mode='auto'] - Display mode (`auto` shows on touch/mobile/tablet viewports).
 * @param {object|null} [props.inventory=null] - Optional player power-up counts.
 * @param {object|null} [props.activeEffects=null] - Active power-up states (`wallPassArmed`, countdowns).
 * @param {number} [props.lookSensitivity=1.8] - Multiplier applied to touch-look pixel deltas.
 * @param {Function|null} [props.onMoveAxes=null] - Callback `(strafeAxis, forwardAxis) => void`.
 * @param {Function|null} [props.onLookDelta=null] - Callback `(dx, dy) => void`.
 * @param {Function|null} [props.onSprintChange=null] - Callback `(isSprinting) => void`.
 * @param {Function|null} [props.onInteractChange=null] - Callback `(isHeld) => void`.
 * @param {Function|null} [props.onTriggerInteract=null] - Callback `() => void` on interact press.
 * @param {Function|null} [props.onActivateAbility=null] - Callback `(abilityType) => void`.
 * @param {Function|null} [props.onReset=null] - Callback `() => void` invoked when touch state resets.
 */
function TouchControls3D({
  enabled = true,
  mode = 'auto',
  inventory = null,
  activeEffects = null,
  stealthState = null,
  flashlightActive = false,
  keyBindings = DEFAULT_KEY_BINDINGS,
  lookSensitivity = 1.8,
  hapticsEnabled = false,
  onMoveAxes = null,
  onLookDelta = null,
  onSprintChange = null,
  onInteractChange = null,
  onTriggerInteract = null,
  onToggleFlashlight = null,
  onActivateAbility = null,
  onTouchActivity = null,
  onReset = null,
}) {
  const rootRef = useRef(null)
  const joystickBaseRef = useRef(null)
  const joystickKnobRef = useRef(null)
  const lookZoneRef = useRef(null)
  const sprintBtnRef = useRef(null)
  const flashlightBtnRef = useRef(null)
  const interactBtnRef = useRef(null)

  const joystickStateRef = useRef({
    pointerId: null,
    originX: 0,
    originY: 0,
    maxRadius: DEFAULT_JOYSTICK_RADIUS,
  })
  const lookStateRef = useRef({
    pointerId: null,
    lastX: 0,
    lastY: 0,
  })
  const sprintStateRef = useRef({
    pointerId: null,
    toggled: false,
    pointerTriggered: false,
  })
  const flashlightStateRef = useRef(createFlashlightPointerState())
  const interactStateRef = useRef({
    pointerId: null,
    pointerTriggered: false,
  })
  const abilityPointerGuardRef = useRef({})

  const callbacksRef = useRef({
    onMoveAxes,
    onLookDelta,
    onSprintChange,
    onInteractChange,
    onTriggerInteract,
    onToggleFlashlight,
    onActivateAbility,
    onTouchActivity,
    onReset,
    lookSensitivity,
    hapticsEnabled,
  })

  useEffect(() => {
    callbacksRef.current = {
      onMoveAxes,
      onLookDelta,
      onSprintChange,
      onInteractChange,
      onTriggerInteract,
      onToggleFlashlight,
      onActivateAbility,
      onTouchActivity,
      onReset,
      lookSensitivity,
      hapticsEnabled,
    }
  }, [
    onMoveAxes,
    onLookDelta,
    onSprintChange,
    onInteractChange,
    onTriggerInteract,
    onToggleFlashlight,
    onActivateAbility,
    onTouchActivity,
    onReset,
    lookSensitivity,
    hapticsEnabled,
  ])

  const resetJoystick = useCallback(() => {
    const js = joystickStateRef.current
    if (js.pointerId !== null) {
      safeReleasePointerCapture(joystickBaseRef.current, js.pointerId)
    }
    js.pointerId = null
    if (joystickBaseRef.current) {
      joystickBaseRef.current.dataset.active = 'false'
    }
    if (joystickKnobRef.current) {
      joystickKnobRef.current.style.transform = 'translate3d(0px, 0px, 0)'
    }
    callbacksRef.current.onMoveAxes?.(0, 0)
  }, [])

  const resetLook = useCallback(() => {
    const ls = lookStateRef.current
    if (ls.pointerId !== null) {
      safeReleasePointerCapture(lookZoneRef.current, ls.pointerId)
    }
    ls.pointerId = null
    if (lookZoneRef.current) {
      lookZoneRef.current.dataset.active = 'false'
    }
  }, [])

  const resetSprint = useCallback(() => {
    const ss = sprintStateRef.current
    if (ss.pointerId !== null) {
      safeReleasePointerCapture(sprintBtnRef.current, ss.pointerId)
    }
    ss.pointerId = null
    ss.toggled = false
    ss.pointerTriggered = false
    if (sprintBtnRef.current) {
      sprintBtnRef.current.dataset.active = 'false'
      sprintBtnRef.current.setAttribute('aria-pressed', 'false')
    }
    callbacksRef.current.onSprintChange?.(false)
  }, [])

  const resetInteract = useCallback(() => {
    const is = interactStateRef.current
    if (is.pointerId !== null) {
      safeReleasePointerCapture(interactBtnRef.current, is.pointerId)
    }
    is.pointerId = null
    is.pointerTriggered = false
    if (interactBtnRef.current) {
      interactBtnRef.current.dataset.active = 'false'
      interactBtnRef.current.setAttribute('aria-pressed', 'false')
    }
    callbacksRef.current.onInteractChange?.(false)
  }, [])

  const resetFlashlight = useCallback(() => {
    const fs = flashlightStateRef.current
    clearFlashlightResetTimer(fs)
    if (fs.pointerId !== null) {
      safeReleasePointerCapture(flashlightBtnRef.current, fs.pointerId)
    }
    fs.pointerId = null
    fs.pointerTriggered = false
  }, [])

  const resetAllTouchControls = useCallback(() => {
    resetJoystick()
    resetLook()
    resetSprint()
    resetFlashlight()
    resetInteract()
    abilityPointerGuardRef.current = {}
    callbacksRef.current.onReset?.()
  }, [resetJoystick, resetLook, resetSprint, resetFlashlight, resetInteract])

  useEffect(() => {
    if (!enabled) {
      resetAllTouchControls()
      return undefined
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resetAllTouchControls()
      }
    }

    window.addEventListener('blur', resetAllTouchControls)
    window.addEventListener('pagehide', resetAllTouchControls)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('blur', resetAllTouchControls)
      window.removeEventListener('pagehide', resetAllTouchControls)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      resetAllTouchControls()
    }
  }, [enabled, resetAllTouchControls])

  if (mode === 'off') {
    return null
  }

  const updateJoystickFromPoint = (clientX, clientY) => {
    const js = joystickStateRef.current
    const dx = clientX - js.originX
    const dy = clientY - js.originY
    const result = computeVirtualJoystickAxes(
      dx,
      dy,
      js.maxRadius,
      JOYSTICK_DEADZONE
    )

    if (joystickKnobRef.current) {
      joystickKnobRef.current.style.transform = `translate3d(${result.knobX.toFixed(1)}px, ${result.knobY.toFixed(1)}px, 0)`
    }
    callbacksRef.current.onMoveAxes?.(result.strafeAxis, result.forwardAxis)
  }

  // --- Virtual Movement Joystick Handlers ---
  const handleJoystickPointerDown = (event) => {
    event.stopPropagation()
    if (!enabled) return
    if (typeof event.button === 'number' && event.button !== 0) return

    const js = joystickStateRef.current
    if (js.pointerId !== null) return

    event.preventDefault()
    const base = joystickBaseRef.current
    const pointerId = event.pointerId ?? 0
    const clientX = Number.isFinite(event.clientX) ? event.clientX : 0
    const clientY = Number.isFinite(event.clientY) ? event.clientY : 0

    const rect = base?.getBoundingClientRect?.()
    if (rect && rect.width > 0 && rect.height > 0) {
      js.originX = rect.left + rect.width / 2
      js.originY = rect.top + rect.height / 2
      js.maxRadius = Math.max(
        24,
        Math.min(rect.width, rect.height) * 0.42
      )
    } else {
      js.originX = clientX
      js.originY = clientY
      js.maxRadius = DEFAULT_JOYSTICK_RADIUS
    }

    js.pointerId = pointerId
    if (base) {
      base.dataset.active = 'true'
    }
    safeSetPointerCapture(base, pointerId)
    updateJoystickFromPoint(clientX, clientY)
  }

  const handleJoystickPointerMove = (event) => {
    event.stopPropagation()
    const js = joystickStateRef.current
    if (js.pointerId === null) return
    const pointerId = event.pointerId ?? 0
    if (pointerId !== js.pointerId) return
    if (!enabled) {
      resetJoystick()
      return
    }

    event.preventDefault()
    const clientX = Number.isFinite(event.clientX) ? event.clientX : js.originX
    const clientY = Number.isFinite(event.clientY) ? event.clientY : js.originY
    updateJoystickFromPoint(clientX, clientY)
  }

  const handleJoystickPointerEnd = (event) => {
    event.stopPropagation()
    const js = joystickStateRef.current
    if (js.pointerId === null) return
    const pointerId = event.pointerId ?? 0
    if (pointerId !== js.pointerId) return
    resetJoystick()
  }

  // --- Separate Touch-Look Area Handlers ---
  const handleLookPointerDown = (event) => {
    event.stopPropagation()
    if (!enabled) return
    if (typeof event.button === 'number' && event.button !== 0) return

    const ls = lookStateRef.current
    if (ls.pointerId !== null) return

    event.preventDefault()
    const pointerId = event.pointerId ?? 0
    ls.pointerId = pointerId
    ls.lastX = Number.isFinite(event.clientX) ? event.clientX : 0
    ls.lastY = Number.isFinite(event.clientY) ? event.clientY : 0

    if (lookZoneRef.current) {
      lookZoneRef.current.dataset.active = 'true'
    }
    safeSetPointerCapture(lookZoneRef.current, pointerId)
  }

  const handleLookPointerMove = (event) => {
    event.stopPropagation()
    const ls = lookStateRef.current
    if (ls.pointerId === null) return
    const pointerId = event.pointerId ?? 0
    if (pointerId !== ls.pointerId) return
    if (!enabled) {
      resetLook()
      return
    }

    event.preventDefault()
    const hasClientCoords =
      Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
    const rawDx = hasClientCoords
      ? event.clientX - ls.lastX
      : Number(event.movementX) || 0
    const rawDy = hasClientCoords
      ? event.clientY - ls.lastY
      : Number(event.movementY) || 0

    if (hasClientCoords) {
      ls.lastX = event.clientX
      ls.lastY = event.clientY
    }

    if (rawDx !== 0 || rawDy !== 0) {
      callbacksRef.current.onLookDelta?.(rawDx, rawDy)
    }
  }

  const handleLookPointerEnd = (event) => {
    event.stopPropagation()
    const ls = lookStateRef.current
    if (ls.pointerId === null) return
    const pointerId = event.pointerId ?? 0
    if (pointerId !== ls.pointerId) return
    resetLook()
  }

  // --- Sprint Hold Button Handlers ---
  const handleSprintPointerDown = (event) => {
    event.stopPropagation()
    if (!enabled) return
    if (typeof event.button === 'number' && event.button !== 0) return

    const ss = sprintStateRef.current
    if (ss.pointerId !== null) return

    event.preventDefault()
    const pointerId = event.pointerId ?? 0
    ss.pointerId = pointerId
    ss.pointerTriggered = true
    ss.toggled = false

    if (sprintBtnRef.current) {
      sprintBtnRef.current.dataset.active = 'true'
      sprintBtnRef.current.setAttribute('aria-pressed', 'true')
    }
    safeSetPointerCapture(sprintBtnRef.current, pointerId)
    triggerHapticFeedback(HAPTIC_PATTERNS.INTERACT, {
      enabled: callbacksRef.current.hapticsEnabled,
    })
    callbacksRef.current.onSprintChange?.(true)
  }

  const handleSprintPointerEnd = (event) => {
    event.stopPropagation()
    const ss = sprintStateRef.current
    if (ss.pointerId === null) return
    const pointerId = event.pointerId ?? 0
    if (pointerId !== ss.pointerId) return
    ss.pointerId = null
    safeReleasePointerCapture(sprintBtnRef.current, pointerId)
    if (sprintBtnRef.current) {
      sprintBtnRef.current.dataset.active = 'false'
      sprintBtnRef.current.setAttribute('aria-pressed', 'false')
    }
    callbacksRef.current.onSprintChange?.(false)
  }

  const handleSprintClick = (event) => {
    event.stopPropagation()
    if (!enabled) return
    const ss = sprintStateRef.current
    if (ss.pointerTriggered) {
      ss.pointerTriggered = false
      return
    }
    ss.toggled = !ss.toggled
    if (sprintBtnRef.current) {
      sprintBtnRef.current.dataset.active = ss.toggled ? 'true' : 'false'
      sprintBtnRef.current.setAttribute('aria-pressed', String(ss.toggled))
    }
    callbacksRef.current.onSprintChange?.(ss.toggled)
  }

  // --- Interact (F) Button Handlers ---
  const handleInteractPointerDown = (event) => {
    event.stopPropagation()
    if (!enabled) return
    if (typeof event.button === 'number' && event.button !== 0) return

    const is = interactStateRef.current
    if (is.pointerId !== null) return

    event.preventDefault()
    const pointerId = event.pointerId ?? 0
    is.pointerId = pointerId
    is.pointerTriggered = true

    if (interactBtnRef.current) {
      interactBtnRef.current.dataset.active = 'true'
      interactBtnRef.current.setAttribute('aria-pressed', 'true')
    }
    safeSetPointerCapture(interactBtnRef.current, pointerId)
    triggerHapticFeedback(HAPTIC_PATTERNS.INTERACT, {
      enabled: callbacksRef.current.hapticsEnabled,
    })
    callbacksRef.current.onInteractChange?.(true)
    callbacksRef.current.onTriggerInteract?.()
  }

  const handleInteractPointerEnd = (event) => {
    event.stopPropagation()
    const is = interactStateRef.current
    if (is.pointerId === null) return
    const pointerId = event.pointerId ?? 0
    if (pointerId !== is.pointerId) return
    is.pointerId = null
    safeReleasePointerCapture(interactBtnRef.current, pointerId)
    if (interactBtnRef.current) {
      interactBtnRef.current.dataset.active = 'false'
      interactBtnRef.current.setAttribute('aria-pressed', 'false')
    }
    callbacksRef.current.onInteractChange?.(false)
  }

  const handleInteractClick = (event) => {
    event.stopPropagation()
    if (!enabled) return
    const is = interactStateRef.current
    if (is.pointerTriggered) {
      is.pointerTriggered = false
      return
    }
    callbacksRef.current.onTriggerInteract?.()
  }

  // --- Flashlight (L) Toggle Button Handlers ---
  const handleFlashlightPointerDown = (event) => {
    event.stopPropagation()
    const fs = flashlightStateRef.current
    const pointerId = applyFlashlightPointerDown(fs, event, { enabled })
    if (pointerId === false) return

    event.preventDefault()
    safeSetPointerCapture(flashlightBtnRef.current, pointerId)
    triggerHapticFeedback(HAPTIC_PATTERNS.INTERACT, {
      enabled: callbacksRef.current.hapticsEnabled,
    })
    callbacksRef.current.onTouchActivity?.(event)
    callbacksRef.current.onToggleFlashlight?.()
  }

  const handleFlashlightPointerEnd = (event) => {
    event.stopPropagation()
    const fs = flashlightStateRef.current
    if (event.type === 'pointercancel') {
      fs.pointerTriggered = false
    }
    const result = applyFlashlightPointerEnd(fs, event, {
      element: flashlightBtnRef.current,
    })
    if (!result.ended) return
    safeReleasePointerCapture(flashlightBtnRef.current, result.pointerId)
  }

  const handleFlashlightKeyDown = (event) => {
    applyFlashlightKeyDown(flashlightStateRef.current, event)
  }

  const handleFlashlightClick = (event) => {
    event.stopPropagation()
    if (!applyFlashlightClick(flashlightStateRef.current, { enabled })) {
      return
    }
    callbacksRef.current.onToggleFlashlight?.()
  }

  const hasInventoryInfo = Boolean(inventory && typeof inventory === 'object')
  const echoCount = inventory?.[COLLECTIBLE_TYPES.ECHO_REVEAL] || 0
  const echoMs = activeEffects?.echoRevealRemainingMs || 0

  const resolvedBindings = normalizeKeyBindings(keyBindings)
  const sprintHint = formatKeyTokenLabel(resolvedBindings.sprint)
  const flashlightHint = formatKeyTokenLabel(resolvedBindings.flashlight)
  const interactHint = formatKeyTokenLabel(resolvedBindings.interact)

  const abilityButtons = [
    {
      type: COLLECTIBLE_TYPES.ECHO_REVEAL,
      shortName: 'Echo',
      keyHint: formatKeyTokenLabel(resolvedBindings.echoReveal),
      ariaName: COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ECHO_REVEAL].label,
      count: echoCount,
      isActive: echoMs > 0,
      badge:
        echoMs > 0
          ? formatCompactSeconds(echoMs)
          : hasInventoryInfo
            ? `x${echoCount}`
            : null,
      canActivate: enabled && (!hasInventoryInfo || (echoCount > 0 && echoMs <= 0)),
    },
  ]

  const rootClassName = [
    'maze-touch-controls',
    mode === 'always' ? 'maze-touch-controls--always' : '',
    !enabled ? 'maze-touch-controls--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-touch-controls-root="true"
      data-touch-mode={mode}
      aria-label="Touch controls"
      onPointerDownCapture={(event) => {
        callbacksRef.current.onTouchActivity?.(event)
      }}
    >
      {/* Dedicated Touch-Look Area (right & open upper viewport region) */}
      <div
        ref={lookZoneRef}
        className="maze-touch-look"
        data-touch-control="true"
        data-touch-zone="look"
        data-active="false"
        role="application"
        aria-roledescription="touch look pad"
        aria-label="Drag to rotate camera"
        onPointerDown={handleLookPointerDown}
        onPointerMove={handleLookPointerMove}
        onPointerUp={handleLookPointerEnd}
        onPointerCancel={handleLookPointerEnd}
        onLostPointerCapture={handleLookPointerEnd}
      >
        <span className="maze-touch-look__hint" aria-hidden="true">
          Look
        </span>
      </div>

      {/* Left Thumb Virtual Movement Joystick */}
      <div
        ref={joystickBaseRef}
        className="maze-joystick"
        data-touch-control="true"
        data-touch-zone="joystick"
        data-active="false"
        role="application"
        aria-roledescription="virtual joystick"
        aria-label="Virtual movement joystick"
        onPointerDown={handleJoystickPointerDown}
        onPointerMove={handleJoystickPointerMove}
        onPointerUp={handleJoystickPointerEnd}
        onPointerCancel={handleJoystickPointerEnd}
        onLostPointerCapture={handleJoystickPointerEnd}
      >
        <span className="maze-joystick__ring" aria-hidden="true" />
        <span
          ref={joystickKnobRef}
          className="maze-joystick__knob"
          aria-hidden="true"
        />
        <span className="maze-joystick__label" aria-hidden="true">
          Move
        </span>
      </div>

      {/* Right Thumb Sprint, Ability & Interact Controls */}
      <div
        className="maze-touch-actions"
        data-touch-control="true"
        role="group"
        aria-label="Touch action and ability buttons"
      >
        <button
          ref={sprintBtnRef}
          type="button"
          className="maze-touch-btn maze-touch-btn--sprint"
          data-touch-control="true"
          data-touch-action="sprint"
          data-active="false"
          disabled={!enabled}
          aria-pressed="false"
          aria-label={`Hold to sprint (${sprintHint})`}
          onPointerDown={handleSprintPointerDown}
          onPointerUp={handleSprintPointerEnd}
          onPointerCancel={handleSprintPointerEnd}
          onLostPointerCapture={handleSprintPointerEnd}
          onClick={handleSprintClick}
        >
          <span className="maze-touch-btn__title">Sprint</span>
        </button>

        <button
          ref={flashlightBtnRef}
          type="button"
          className={[
            'maze-touch-btn',
            'maze-touch-btn--flashlight',
            flashlightActive ? 'maze-touch-btn--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-touch-control="true"
          data-touch-action="flashlight"
          data-active={flashlightActive ? 'true' : 'false'}
          disabled={!enabled}
          aria-pressed={Boolean(flashlightActive)}
          aria-label={`Toggle flashlight (${flashlightHint})`}
          onPointerDown={handleFlashlightPointerDown}
          onPointerUp={handleFlashlightPointerEnd}
          onPointerCancel={handleFlashlightPointerEnd}
          onLostPointerCapture={handleFlashlightPointerEnd}
          onKeyDown={handleFlashlightKeyDown}
          onClick={handleFlashlightClick}
        >
          <span className="maze-touch-btn__title">Light</span>
        </button>

        <button
          ref={interactBtnRef}
          type="button"
          className={[
            'maze-touch-btn',
            'maze-touch-btn--interact',
            stealthState?.isHidden
              ? 'maze-touch-btn--interact-hidden'
              : stealthState?.canInteract
                ? 'maze-touch-btn--interact-ready'
                : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-touch-control="true"
          data-touch-action="interact"
          data-active={stealthState?.isHidden ? 'true' : 'false'}
          disabled={!enabled}
          aria-pressed={Boolean(stealthState?.isHidden)}
          aria-label={
            stealthState?.isHidden
              ? `Exit hiding spot (${interactHint})`
              : stealthState?.canInteract
                ? `Hide in spot (${interactHint})`
                : `Interact (${interactHint})`
          }
          onPointerDown={handleInteractPointerDown}
          onPointerUp={handleInteractPointerEnd}
          onPointerCancel={handleInteractPointerEnd}
          onLostPointerCapture={handleInteractPointerEnd}
          onClick={handleInteractClick}
        >
          <span className="maze-touch-btn__title">
            {stealthState?.isHidden
              ? 'Exit'
              : stealthState?.canInteract
                ? 'Hide'
                : 'Use'}
          </span>
        </button>

        {abilityButtons.map(
          ({
            type,
            shortName,
            keyHint,
            ariaName,
            isActive,
            badge,
            canActivate,
          }) => (
            <button
              key={type}
              type="button"
              className={[
                'maze-touch-btn',
                `maze-touch-btn--${type}`,
                isActive ? 'maze-touch-btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-touch-control="true"
              data-touch-action={type}
              data-active={String(isActive)}
              disabled={!canActivate}
              aria-pressed={isActive}
              aria-label={
                badge
                  ? `${ariaName} (${keyHint}): ${badge}`
                  : `${ariaName} (${keyHint})`
              }
              onPointerDown={(event) => {
                event.stopPropagation()
                if (!canActivate) return
                if (typeof event.button === 'number' && event.button !== 0) return
                event.preventDefault()
                abilityPointerGuardRef.current[type] = true
                callbacksRef.current.onActivateAbility?.(type)
              }}
              onPointerUp={(event) => {
                event.stopPropagation()
              }}
              onPointerCancel={(event) => {
                event.stopPropagation()
                abilityPointerGuardRef.current[type] = false
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (abilityPointerGuardRef.current[type]) {
                  abilityPointerGuardRef.current[type] = false
                  return
                }
                if (!canActivate) return
                callbacksRef.current.onActivateAbility?.(type)
              }}
            >
              <span className="maze-touch-btn__title">{shortName}</span>
              {badge ? (
                <span className="maze-touch-btn__meta">{badge}</span>
              ) : null}
            </button>
          )
        )}
      </div>
    </div>
  )
}

export default TouchControls3D
