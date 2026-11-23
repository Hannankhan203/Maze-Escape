export const HAPTIC_PATTERNS = {
  DAMAGE: [40, 30, 60],
  COLLISION: 18,
  ABILITY: 24,
  INTERACT: 14,
  PICKUP: 18,
  SHARD: [12, 18, 16],
  TIME_FRAGMENT: [18, 22, 28],
  WATCHERS_EYE: [14, 16, 20],
  ECHO_PULSE: [32, 20, 44],
  SPIRIT_LANTERN: [16, 20, 16],
  REJECTED: 10,
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
    case 'item_collected': {
      const itemType = event.item?.type
      if (itemType === 'soul_shards') {
        return triggerHapticFeedback(HAPTIC_PATTERNS.SHARD, options)
      }
      if (itemType === 'time_fragment') {
        return triggerHapticFeedback(HAPTIC_PATTERNS.TIME_FRAGMENT, options)
      }
      if (itemType === 'watchers_eye') {
        return triggerHapticFeedback(HAPTIC_PATTERNS.WATCHERS_EYE, options)
      }
      if (itemType === 'echo_pulse') {
        return triggerHapticFeedback(HAPTIC_PATTERNS.ECHO_PULSE, options)
      }
      if (itemType === 'spirit_lantern') {
        return triggerHapticFeedback(HAPTIC_PATTERNS.SPIRIT_LANTERN, options)
      }
      if (itemType === 'health_capsule' || itemType === 'energy_cell') {
        return triggerHapticFeedback(HAPTIC_PATTERNS.ABILITY, options)
      }
      return triggerHapticFeedback(HAPTIC_PATTERNS.PICKUP, options)
    }
    case 'item_pickup_rejected':
      return triggerHapticFeedback(HAPTIC_PATTERNS.REJECTED, options)
    case 'echo_reveal_activated':
    case 'keycard_collected':
    case 'gate_unlocked':
      return triggerHapticFeedback(HAPTIC_PATTERNS.ABILITY, options)
    default:
      return false
  }
}
