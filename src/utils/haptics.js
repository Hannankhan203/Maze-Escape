export const HAPTIC_PATTERNS = {
  DAMAGE: [40, 30, 60],
  COLLISION: 18,
  ABILITY: 24,
  INTERACT: 14,
}

export function isHapticsSupported(
  nav = typeof navigator !== 'undefined' ? navigator : null
) {
  return Boolean(nav && typeof nav.vibrate === 'function')
}

export function triggerHapticFeedback(
  pattern = HAPTIC_PATTERNS.COLLISION,
  options = {}
) {
  if (options.enabled === false) {
    return false
  }
  const nav =
    options.navigator !== undefined
      ? options.navigator
      : typeof navigator !== 'undefined'
        ? navigator
        : null
  if (!isHapticsSupported(nav)) {
    return false
  }
  try {
    return Boolean(nav.vibrate(pattern))
  } catch {
    return false
  }
}

export function triggerHapticForGameEvent(event, options = {}) {
  if (!event || typeof event !== 'object' || options.enabled === false) {
    return false
  }

  switch (event.type) {
    case 'player_damaged':
    case 'game_over':
      return triggerHapticFeedback(HAPTIC_PATTERNS.DAMAGE, options)
    case 'blocked':
    case 'locked_exit':
      return triggerHapticFeedback(HAPTIC_PATTERNS.COLLISION, options)
    case 'echo_reveal_activated':
    case 'keycard_collected':
    case 'gate_unlocked':
      return triggerHapticFeedback(HAPTIC_PATTERNS.ABILITY, options)
    default:
      return false
  }
}
