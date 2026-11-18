import { useCallback, useEffect, useRef } from 'react'
import { POWERUP_TYPES } from '../game/mechanics/powerups.js'

const KEY_TO_MOVEMENT = {
  w: 'forward',
  arrowup: 'forward',
  s: 'backward',
  arrowdown: 'backward',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
}

const KEY_TO_ABILITY = {
  ' ': POWERUP_TYPES.WALL_PASS,
  space: POWERUP_TYPES.WALL_PASS,
  spacebar: POWERUP_TYPES.WALL_PASS,
  e: POWERUP_TYPES.ECHO_REVEAL,
  q: POWERUP_TYPES.COIN_MAGNET,
}

const INTERACT_KEY = 'f'

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
  if (!event) return ''
  if (event.code === 'Space') return 'space'
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    return event.code.toLowerCase()
  }
  return typeof event.key === 'string' ? event.key.toLowerCase() : ''
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
 * suppresses OS keydown auto-repeats, and prevents stuck keys on blur/reset.
 */
export function createContinuousInputController({
  targetState = null,
  onActivateAbility,
  onInteract,
} = {}) {
  const state = targetState || createEmptyInputState()
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

  function syncDerivedState() {
    state.forward = movementSets.forward.size > 0
    state.backward = movementSets.backward.size > 0
    state.left = movementSets.left.size > 0
    state.right = movementSets.right.size > 0
    state.sprint = sprintTokens.size > 0

    state.forwardAxis = (state.forward ? 1 : 0) - (state.backward ? 1 : 0)
    state.strafeAxis = (state.right ? 1 : 0) - (state.left ? 1 : 0)
    state.isMoving = state.forwardAxis !== 0 || state.strafeAxis !== 0

    state.interact = interactTokens.size > 0
    state.abilities[POWERUP_TYPES.WALL_PASS] =
      abilitySets[POWERUP_TYPES.WALL_PASS].size > 0
    state.abilities[POWERUP_TYPES.ECHO_REVEAL] =
      abilitySets[POWERUP_TYPES.ECHO_REVEAL].size > 0
    state.abilities[POWERUP_TYPES.COIN_MAGNET] =
      abilitySets[POWERUP_TYPES.COIN_MAGNET].size > 0
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
    syncDerivedState()
  }

  function handleKeyDown(event) {
    if (!event || event.defaultPrevented) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (isEditableTarget(event.target)) return

    const token = resolveKeyToken(event)
    if (!token) return

    // Self-heal if Shift was released outside the window
    if (event.shiftKey === false && !isShiftToken(token) && sprintTokens.size > 0) {
      sprintTokens.clear()
      syncDerivedState()
    }

    if (isShiftToken(token)) {
      if (event.repeat || sprintTokens.has(token)) return
      sprintTokens.add(token)
      syncDerivedState()
      return
    }

    const movementKey = KEY_TO_MOVEMENT[token]
    if (movementKey) {
      event.preventDefault?.()
      if (event.repeat || movementSets[movementKey].has(token)) return
      movementSets[movementKey].add(token)
      syncDerivedState()
      return
    }

    const abilityType = KEY_TO_ABILITY[token]
    if (abilityType) {
      event.preventDefault?.()
      if (event.repeat || abilitySets[abilityType].has(token)) return
      abilitySets[abilityType].add(token)
      syncDerivedState()
      onActivateAbility?.(abilityType)
      return
    }

    if (token === INTERACT_KEY) {
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

    let changed = false

    if (isShiftToken(token)) {
      if (token === 'shift') {
        if (sprintTokens.size > 0) {
          sprintTokens.clear()
          changed = true
        }
      } else if (sprintTokens.delete(token)) {
        changed = true
      }
      // Also clear if browser reports no Shift keys remain pressed
      if (event.shiftKey === false && sprintTokens.size > 0) {
        sprintTokens.clear()
        changed = true
      }
    }

    const movementKey = KEY_TO_MOVEMENT[token]
    if (movementKey && movementSets[movementKey].delete(token)) {
      changed = true
    }

    const abilityType = KEY_TO_ABILITY[token]
    if (abilityType && abilitySets[abilityType].delete(token)) {
      changed = true
    }

    if (token === INTERACT_KEY && interactTokens.delete(token)) {
      changed = true
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
    reset,
    getInputState,
  }
}

/**
 * Attaches continuous keyboard input listeners for future 3D animation loops.
 * Returns a mutable `inputRef` (no 60fps React re-renders), `getInputState()`,
 * and `reset()`. Automatically clears all held keys on disable, blur,
 * page hide, and unmount.
 */
export function useContinuousInput({
  enabled = true,
  onActivateAbility,
  onInteract,
} = {}) {
  const inputRef = useRef(createEmptyInputState())
  const controllerRef = useRef(null)
  const onActivateRef = useRef(onActivateAbility)
  const onInteractRef = useRef(onInteract)

  useEffect(() => {
    onActivateRef.current = onActivateAbility
  }, [onActivateAbility])

  useEffect(() => {
    onInteractRef.current = onInteract
  }, [onInteract])

  useEffect(() => {
    const controller = createContinuousInputController({
      targetState: inputRef.current,
      onActivateAbility: (abilityType) => onActivateRef.current?.(abilityType),
      onInteract: () => onInteractRef.current?.(),
    })
    controllerRef.current = controller

    if (!enabled) {
      controller.reset()
      return undefined
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
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

  const reset = useCallback(() => {
    controllerRef.current?.reset()
  }, [])

  return {
    inputRef,
    getInputState,
    reset,
  }
}
