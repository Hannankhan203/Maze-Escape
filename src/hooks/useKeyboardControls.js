import { useEffect, useRef } from 'react'
import { POWERUP_TYPES } from '../game/mechanics/powerups.js'

const KEY_TO_DIRECTION = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
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
  return typeof event.key === 'string' ? event.key.toLowerCase() : ''
}

export function createKeyboardControlsHandler({
  getEnabled = () => true,
  onMove,
  onActivateAbility,
} = {}) {
  return (event) => {
    if (!getEnabled()) return false
    if (!event || event.defaultPrevented) return false
    if (event.metaKey || event.ctrlKey || event.altKey) return false
    if (isEditableTarget(event.target)) return false

    const token = resolveKeyToken(event)
    if (!token) return false

    const direction = KEY_TO_DIRECTION[token]
    if (direction) {
      event.preventDefault?.()
      if (event.repeat) return false
      onMove?.(direction)
      return true
    }

    const abilityType = KEY_TO_ABILITY[token]
    if (abilityType) {
      event.preventDefault?.()
      if (event.repeat) return false
      onActivateAbility?.(abilityType)
      return true
    }

    return false
  }
}

/**
 * Attaches window keyboard listeners for WASD/Arrow movement and 2D ability
 * shortcuts (Space = Wall Pass, E = Echo Reveal, Q = Coin Magnet).
 * Prevents default browser scrolling during active gameplay and ignores
 * OS key-repeat events and modifier shortcuts.
 */
export function useKeyboardControls({
  enabled = true,
  onMove,
  onActivateAbility,
}) {
  const onMoveRef = useRef(onMove)
  const onActivateAbilityRef = useRef(onActivateAbility)

  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  useEffect(() => {
    onActivateAbilityRef.current = onActivateAbility
  }, [onActivateAbility])

  useEffect(() => {
    if (!enabled) return undefined

    const handleKeyDown = createKeyboardControlsHandler({
      getEnabled: () => enabled,
      onMove: (direction) => onMoveRef.current?.(direction),
      onActivateAbility: (abilityType) =>
        onActivateAbilityRef.current?.(abilityType),
    })

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled])
}
