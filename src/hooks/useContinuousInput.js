import { useCallback, useEffect, useRef } from 'react'
import { POWERUP_TYPES } from '../game/mechanics/powerups.js'
import {
  DEFAULT_KEY_BINDINGS,
  normalizeBindingKeyToken,
  normalizeKeyBindings,
  resolveInputKeyToken,
} from '../game/three/threeConfig.js'

const SECONDARY_ARROW_TO_MOVEMENT = {
  arrowup: 'forward',
  arrowdown: 'backward',
  arrowleft: 'left',
  arrowright: 'right',
}

function buildTokenActionMap(bindings) {
  const map = new Map()
  if (bindings.moveForward) {
    map.set(bindings.moveForward, { kind: 'movement', direction: 'forward' })
  }
  if (bindings.moveBackward) {
    map.set(bindings.moveBackward, { kind: 'movement', direction: 'backward' })
  }
  if (bindings.moveLeft) {
    map.set(bindings.moveLeft, { kind: 'movement', direction: 'left' })
  }
  if (bindings.moveRight) {
    map.set(bindings.moveRight, { kind: 'movement', direction: 'right' })
  }
  if (bindings.sprint) {
    map.set(bindings.sprint, { kind: 'sprint' })
  }
  if (bindings.interact) {
    map.set(bindings.interact, { kind: 'interact' })
  }
  if (bindings.flashlight) {
    map.set(bindings.flashlight, { kind: 'flashlight' })
  }
  if (bindings.wayfinder) {
    map.set(bindings.wayfinder, { kind: 'wayfinder' })
  }
  if (bindings.wallPass) {
    map.set(bindings.wallPass, {
      kind: 'ability',
      abilityType: POWERUP_TYPES.WALL_PASS,
    })
  }
  if (bindings.echoReveal) {
    map.set(bindings.echoReveal, {
      kind: 'ability',
      abilityType: POWERUP_TYPES.ECHO_REVEAL,
    })
  }
  if (bindings.coinMagnet) {
    map.set(bindings.coinMagnet, {
      kind: 'ability',
      abilityType: POWERUP_TYPES.COIN_MAGNET,
    })
  }
  if (bindings.cycleCameraDistance) {
    map.set(bindings.cycleCameraDistance, { kind: 'cycleCameraDistance' })
  }
  if (bindings.pause) {
    map.set(bindings.pause, { kind: 'pause' })
  }
  return map
}

function clampAxis(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

/**
 * Maps screen-space joystick displacement `(dx, dy)` inside `maxRadius`
 * into clamped/normalized movement axes (`strafeAxis`, `forwardAxis`)
 * with an adjustable circular deadzone.
 *
 * Screen `+dx` maps to `+strafeAxis` (right) and `-dy` maps to `+forwardAxis` (up).
 */
export function computeVirtualJoystickAxes(
  dx = 0,
  dy = 0,
  maxRadius = 48,
  deadzone = 0.12
) {
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    !Number.isFinite(maxRadius) ||
    maxRadius <= 0
  ) {
    return {
      strafeAxis: 0,
      forwardAxis: 0,
      knobX: 0,
      knobY: 0,
      magnitude: 0,
    }
  }

  const dist = Math.hypot(dx, dy)
  if (dist <= 1e-6) {
    return {
      strafeAxis: 0,
      forwardAxis: 0,
      knobX: 0,
      knobY: 0,
      magnitude: 0,
    }
  }

  const clampedDist = Math.min(dist, maxRadius)
  const ux = dx / dist
  const uy = dy / dist
  const knobX = ux * clampedDist
  const knobY = uy * clampedDist

  const safeDeadzone = Number.isFinite(deadzone)
    ? Math.max(0, Math.min(0.9, deadzone))
    : 0.12
  const normalizedDist = clampedDist / maxRadius

  if (normalizedDist <= safeDeadzone) {
    return {
      strafeAxis: 0,
      forwardAxis: 0,
      knobX,
      knobY,
      magnitude: 0,
    }
  }

  const magnitude = Math.max(
    0,
    Math.min(1, (normalizedDist - safeDeadzone) / (1 - safeDeadzone))
  )

  return {
    strafeAxis: ux * magnitude,
    forwardAxis: -uy * magnitude,
    knobX,
    knobY,
    magnitude,
  }
}

function isEditableTarget(target) {
  if (!target || typeof target.tagName !== 'string') return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    Boolean(target.isContentEditable)
  )
}

function resolveKeyToken(event) {
  return resolveInputKeyToken(event)
}

function isShiftToken(token) {
  return token === 'shift' || token === 'shiftleft' || token === 'shiftright'
}

export function createEmptyInputState() {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    forwardAxis: 0,
    strafeAxis: 0,
    isMoving: false,
    interact: false,
    abilities: {
      [POWERUP_TYPES.WALL_PASS]: false,
      [POWERUP_TYPES.ECHO_REVEAL]: false,
      [POWERUP_TYPES.COIN_MAGNET]: false,
    },
  }
}

function cloneInputState(state) {
  return {
    ...state,
    abilities: { ...state.abilities },
  }
}

/**
 * Pure, renderer-independent continuous input state controller.
 * Tracks held keys safely across simultaneous bindings (e.g. W + ArrowUp),
 * merges continuous mobile touch axes/sprint/actions without cross-interference,
 * suppresses OS keydown auto-repeats, and prevents stuck inputs on blur/reset.
 */
export function createContinuousInputController({
  targetState = null,
  keyBindings = DEFAULT_KEY_BINDINGS,
  onActivateAbility,
  onInteract,
  onToggleFlashlight,
  onTriggerWayfinder,
  onCycleCameraDistance,
} = {}) {
  const state = targetState || createEmptyInputState()
  let activeKeyBindings = normalizeKeyBindings(keyBindings)
  let tokenActionMap = buildTokenActionMap(activeKeyBindings)
  const movementSets = {
    forward: new Set(),
    backward: new Set(),
    left: new Set(),
    right: new Set(),
  }
  const sprintTokens = new Set()
  const interactTokens = new Set()
  const abilitySets = {
    [POWERUP_TYPES.WALL_PASS]: new Set(),
    [POWERUP_TYPES.ECHO_REVEAL]: new Set(),
    [POWERUP_TYPES.COIN_MAGNET]: new Set(),
  }

  let touchForwardAxis = 0
  let touchStrafeAxis = 0
  let touchSprint = false
  let touchInteract = false

  function syncDerivedState() {
    const kbdForward =
      (movementSets.forward.size > 0 ? 1 : 0) -
      (movementSets.backward.size > 0 ? 1 : 0)
    const kbdStrafe =
      (movementSets.right.size > 0 ? 1 : 0) -
      (movementSets.left.size > 0 ? 1 : 0)

    const combinedForward = clampAxis(kbdForward + touchForwardAxis)
    const combinedStrafe = clampAxis(kbdStrafe + touchStrafeAxis)
    const combinedMag = Math.hypot(combinedForward, combinedStrafe)

    if (combinedMag > 1) {
      state.forwardAxis = combinedForward / combinedMag
      state.strafeAxis = combinedStrafe / combinedMag
    } else {
      state.forwardAxis = combinedForward
      state.strafeAxis = combinedStrafe
    }

    state.forward = state.forwardAxis > 0.1
    state.backward = state.forwardAxis < -0.1
    state.left = state.strafeAxis < -0.1
    state.right = state.strafeAxis > 0.1
    state.sprint = sprintTokens.size > 0 || touchSprint
    state.isMoving =
      Math.abs(state.forwardAxis) > 1e-4 || Math.abs(state.strafeAxis) > 1e-4

    state.interact = interactTokens.size > 0 || touchInteract
    state.abilities[POWERUP_TYPES.WALL_PASS] =
      abilitySets[POWERUP_TYPES.WALL_PASS].size > 0
    state.abilities[POWERUP_TYPES.ECHO_REVEAL] =
      abilitySets[POWERUP_TYPES.ECHO_REVEAL].size > 0
    state.abilities[POWERUP_TYPES.COIN_MAGNET] =
      abilitySets[POWERUP_TYPES.COIN_MAGNET].size > 0
  }

  function resetTouch() {
    touchForwardAxis = 0
    touchStrafeAxis = 0
    touchSprint = false
    touchInteract = false
    syncDerivedState()
  }

  function clearKeyboardInputs() {
    let hadActive = false
    for (const dirSet of Object.values(movementSets)) {
      if (dirSet.size > 0) {
        dirSet.clear()
        hadActive = true
      }
    }
    if (sprintTokens.size > 0) {
      sprintTokens.clear()
      hadActive = true
    }
    if (interactTokens.size > 0) {
      interactTokens.clear()
      hadActive = true
    }
    for (const abSet of Object.values(abilitySets)) {
      if (abSet.size > 0) {
        abSet.clear()
        hadActive = true
      }
    }
    if (hadActive) {
      syncDerivedState()
    }
  }

  function reset() {
    movementSets.forward.clear()
    movementSets.backward.clear()
    movementSets.left.clear()
    movementSets.right.clear()
    sprintTokens.clear()
    interactTokens.clear()
    abilitySets[POWERUP_TYPES.WALL_PASS].clear()
    abilitySets[POWERUP_TYPES.ECHO_REVEAL].clear()
    abilitySets[POWERUP_TYPES.COIN_MAGNET].clear()
    touchForwardAxis = 0
    touchStrafeAxis = 0
    touchSprint = false
    touchInteract = false
    syncDerivedState()
  }

  function setTouchMovement(strafeAxis = 0, forwardAxis = 0) {
    const safeStrafe = clampAxis(strafeAxis)
    const safeForward = clampAxis(forwardAxis)
    const mag = Math.hypot(safeStrafe, safeForward)
    if (mag > 1) {
      touchStrafeAxis = safeStrafe / mag
      touchForwardAxis = safeForward / mag
    } else {
      touchStrafeAxis = safeStrafe
      touchForwardAxis = safeForward
    }
    syncDerivedState()
  }

  function setTouchSprint(active) {
    touchSprint = Boolean(active)
    syncDerivedState()
  }

  function setTouchInteract(active) {
    touchInteract = Boolean(active)
    syncDerivedState()
  }

  function triggerAbility(abilityType) {
    if (
      abilityType === POWERUP_TYPES.WALL_PASS ||
      abilityType === POWERUP_TYPES.ECHO_REVEAL ||
      abilityType === POWERUP_TYPES.COIN_MAGNET
    ) {
      onActivateAbility?.(abilityType)
    }
  }

  function triggerInteract() {
    onInteract?.()
  }

  function toggleFlashlight() {
    onToggleFlashlight?.()
  }

  function setKeyBindings(nextBindings) {
    activeKeyBindings = normalizeKeyBindings(nextBindings)
    tokenActionMap = buildTokenActionMap(activeKeyBindings)
    clearKeyboardInputs()
  }

  function resolveBoundAction(canonicalToken) {
    const direct = tokenActionMap.get(canonicalToken)
    if (direct) return direct
    const arrowDir = SECONDARY_ARROW_TO_MOVEMENT[canonicalToken]
    if (arrowDir) {
      return { kind: 'movement', direction: arrowDir }
    }
    return null
  }

  function removeTokenFromAllSets(targetToken) {
    let removed = false
    if (sprintTokens.delete(targetToken)) removed = true
    if (interactTokens.delete(targetToken)) removed = true
    for (const dirSet of Object.values(movementSets)) {
      if (dirSet.delete(targetToken)) removed = true
    }
    for (const abSet of Object.values(abilitySets)) {
      if (abSet.delete(targetToken)) removed = true
    }
    return removed
  }

  function handleKeyDown(event) {
    if (!event || event.defaultPrevented) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (isEditableTarget(event.target)) return

    const token = resolveKeyToken(event)
    if (!token) return
    const canonicalToken = normalizeBindingKeyToken(token)
    if (!canonicalToken) return

    // Self-heal if Shift was released outside the window
    if (event.shiftKey === false && !isShiftToken(token)) {
      let clearedShift = false
      for (const sTok of ['shift', 'shiftleft', 'shiftright']) {
        if (removeTokenFromAllSets(sTok)) {
          clearedShift = true
        }
      }
      if (clearedShift) {
        syncDerivedState()
      }
    }

    const action = resolveBoundAction(canonicalToken)
    if (!action) return

    if (action.kind === 'cycleCameraDistance') {
      event.preventDefault?.()
      if (event.repeat) return
      onCycleCameraDistance?.()
      return
    }

    if (action.kind === 'flashlight') {
      event.preventDefault?.()
      if (event.repeat) return
      onToggleFlashlight?.()
      return
    }

    if (action.kind === 'wayfinder') {
      event.preventDefault?.()
      if (event.repeat) return
      onTriggerWayfinder?.()
      return
    }

    if (action.kind === 'sprint') {
      if (!isShiftToken(token)) {
        event.preventDefault?.()
      }
      if (event.repeat || sprintTokens.has(token)) return
      sprintTokens.add(token)
      syncDerivedState()
      return
    }

    if (action.kind === 'movement') {
      event.preventDefault?.()
      const dirSet = movementSets[action.direction]
      if (!dirSet || event.repeat || dirSet.has(token)) return
      dirSet.add(token)
      syncDerivedState()
      return
    }

    if (action.kind === 'ability') {
      event.preventDefault?.()
      const abSet = abilitySets[action.abilityType]
      if (!abSet || event.repeat || abSet.has(token)) return
      abSet.add(token)
      syncDerivedState()
      onActivateAbility?.(action.abilityType)
      return
    }

    if (action.kind === 'interact') {
      event.preventDefault?.()
      if (event.repeat || interactTokens.has(token)) return
      interactTokens.add(token)
      syncDerivedState()
      onInteract?.()
    }
  }

  function handleKeyUp(event) {
    if (!event) return
    const token = resolveKeyToken(event)
    if (!token) return

    let changed = removeTokenFromAllSets(token)

    if (isShiftToken(token) && (token === 'shift' || event.shiftKey === false)) {
      for (const sTok of ['shift', 'shiftleft', 'shiftright']) {
        if (removeTokenFromAllSets(sTok)) {
          changed = true
        }
      }
    }

    if (changed) {
      syncDerivedState()
    }
  }

  function getInputState() {
    return cloneInputState(state)
  }

  return {
    state,
    handleKeyDown,
    handleKeyUp,
    setKeyBindings,
    setTouchMovement,
    setTouchSprint,
    setTouchInteract,
    triggerAbility,
    triggerInteract,
    toggleFlashlight,
    resetTouch,
    reset,
    getInputState,
  }
}

/**
 * Attaches continuous keyboard & touch-capable input tracking for 3D animation loops.
 * Returns a mutable `inputRef` (no 60fps React re-renders), `getInputState()`,
 * touch input setters, and `reset()`. Automatically clears held inputs on disable,
 * blur, page hide, and unmount.
 */
export function useContinuousInput({
  enabled = true,
  keyBindings = DEFAULT_KEY_BINDINGS,
  onActivateAbility,
  onInteract,
  onToggleFlashlight,
  onTriggerWayfinder,
  onCycleCameraDistance,
} = {}) {
  const inputRef = useRef(createEmptyInputState())
  const controllerRef = useRef(null)
  const keyBindingsRef = useRef(normalizeKeyBindings(keyBindings))
  const onActivateRef = useRef(onActivateAbility)
  const onInteractRef = useRef(onInteract)
  const onToggleFlashlightRef = useRef(onToggleFlashlight)
  const onTriggerWayfinderRef = useRef(onTriggerWayfinder)
  const onCycleCameraDistanceRef = useRef(onCycleCameraDistance)

  useEffect(() => {
    const normalized = normalizeKeyBindings(keyBindings)
    keyBindingsRef.current = normalized
    controllerRef.current?.setKeyBindings(normalized)
  }, [keyBindings])

  useEffect(() => {
    onActivateRef.current = onActivateAbility
  }, [onActivateAbility])

  useEffect(() => {
    onInteractRef.current = onInteract
  }, [onInteract])

  useEffect(() => {
    onToggleFlashlightRef.current = onToggleFlashlight
  }, [onToggleFlashlight])

  useEffect(() => {
    onTriggerWayfinderRef.current = onTriggerWayfinder
  }, [onTriggerWayfinder])

  useEffect(() => {
    onCycleCameraDistanceRef.current = onCycleCameraDistance
  }, [onCycleCameraDistance])

  useEffect(() => {
    const controller = createContinuousInputController({
      targetState: inputRef.current,
      keyBindings: keyBindingsRef.current,
      onActivateAbility: (abilityType) => onActivateRef.current?.(abilityType),
      onInteract: () => onInteractRef.current?.(),
      onToggleFlashlight: () => onToggleFlashlightRef.current?.(),
      onTriggerWayfinder: () => onTriggerWayfinderRef.current?.(),
      onCycleCameraDistance: () => onCycleCameraDistanceRef.current?.(),
    })
    controllerRef.current = controller

    if (!enabled) {
      controller.reset()
      return undefined
    }

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        controller.reset()
      }
    }

    window.addEventListener('keydown', controller.handleKeyDown)
    window.addEventListener('keyup', controller.handleKeyUp)
    window.addEventListener('blur', controller.reset)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('keydown', controller.handleKeyDown)
      window.removeEventListener('keyup', controller.handleKeyUp)
      window.removeEventListener('blur', controller.reset)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      controller.reset()
    }
  }, [enabled])

  const getInputState = useCallback(() => {
    if (controllerRef.current) {
      return controllerRef.current.getInputState()
    }
    return cloneInputState(inputRef.current)
  }, [])

  const setTouchMovement = useCallback((strafeAxis, forwardAxis) => {
    controllerRef.current?.setTouchMovement(strafeAxis, forwardAxis)
  }, [])

  const setTouchSprint = useCallback((active) => {
    controllerRef.current?.setTouchSprint(active)
  }, [])

  const setTouchInteract = useCallback((active) => {
    controllerRef.current?.setTouchInteract(active)
  }, [])

  const triggerAbility = useCallback((abilityType) => {
    controllerRef.current?.triggerAbility(abilityType)
  }, [])

  const triggerInteract = useCallback(() => {
    controllerRef.current?.triggerInteract()
  }, [])

  const toggleFlashlight = useCallback(() => {
    controllerRef.current?.toggleFlashlight?.()
  }, [])

  const resetTouch = useCallback(() => {
    controllerRef.current?.resetTouch()
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.reset()
  }, [])

  return {
    inputRef,
    getInputState,
    setTouchMovement,
    setTouchSprint,
    setTouchInteract,
    triggerAbility,
    triggerInteract,
    toggleFlashlight,
    resetTouch,
    reset,
  }
}
