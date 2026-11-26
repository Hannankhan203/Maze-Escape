export const DEFAULT_AUDIO_VOLUMES = {
  master: 0.85,
  ambience: 0.55,
  effects: 0.85,
  music: 0.6,
  muted: false,
}

export const CAMERA_MODES = {
  FIRST_PERSON: 'first-person',
  THIRD_PERSON: 'third-person',
}

export const THIRD_PERSON_CAMERA_MODES = {
  CHARACTER_FOLLOW: 'character-follow',
  FREE_LOOK: 'free-look',
}

export const DEFAULT_THIRD_PERSON_CAMERA_MODE =
  THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW

export function normalizeThirdPersonCameraMode(
  raw,
  fallback = DEFAULT_THIRD_PERSON_CAMERA_MODE
) {
  if (
    raw === THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW ||
    raw === THIRD_PERSON_CAMERA_MODES.FREE_LOOK
  ) {
    return raw
  }
  return fallback
}

export const THIRD_PERSON_CAMERA_DISTANCES = {
  CLOSE: 'close',
  MEDIUM: 'medium',
  FAR: 'far',
}

export const THIRD_PERSON_CAMERA_DISTANCE_ORDER = [
  THIRD_PERSON_CAMERA_DISTANCES.CLOSE,
  THIRD_PERSON_CAMERA_DISTANCES.MEDIUM,
  THIRD_PERSON_CAMERA_DISTANCES.FAR,
]

export const THIRD_PERSON_CAMERA_DISTANCE_VALUES = {
  [THIRD_PERSON_CAMERA_DISTANCES.CLOSE]: 2.4,
  [THIRD_PERSON_CAMERA_DISTANCES.MEDIUM]: 4.2,
  [THIRD_PERSON_CAMERA_DISTANCES.FAR]: 6.2,
}

export const DEFAULT_THIRD_PERSON_CAMERA_DISTANCE =
  THIRD_PERSON_CAMERA_DISTANCES.MEDIUM

export function normalizeThirdPersonCameraDistance(
  raw,
  fallback = DEFAULT_THIRD_PERSON_CAMERA_DISTANCE
) {
  if (
    typeof raw === 'string' &&
    raw in THIRD_PERSON_CAMERA_DISTANCE_VALUES
  ) {
    return raw
  }
  return fallback
}

export function getThirdPersonCameraDistanceValue(
  preset = DEFAULT_THIRD_PERSON_CAMERA_DISTANCE
) {
  const normalized = normalizeThirdPersonCameraDistance(preset)
  return THIRD_PERSON_CAMERA_DISTANCE_VALUES[normalized]
}

export function getNextThirdPersonCameraDistance(
  current = DEFAULT_THIRD_PERSON_CAMERA_DISTANCE
) {
  const normalized = normalizeThirdPersonCameraDistance(current)
  const index = THIRD_PERSON_CAMERA_DISTANCE_ORDER.indexOf(normalized)
  const nextIndex =
    index >= 0 ? (index + 1) % THIRD_PERSON_CAMERA_DISTANCE_ORDER.length : 0
  return THIRD_PERSON_CAMERA_DISTANCE_ORDER[nextIndex]
}

export const DEFAULT_KEY_BINDINGS = {
  moveForward: 'w',
  moveBackward: 's',
  moveLeft: 'a',
  moveRight: 'd',
  sprint: 'shift',
  interact: 'f',
  flashlight: 'l',
  wayfinder: 'h',
  // Safe conflict-free defaults: T/R are free; Q avoids preserved V (cycleCameraDistance) and E avoids preserved F (interact)
  phantomVeil: 'q',
  timeFragment: 't',
  watchersEye: 'r',
  echoPulse: 'e',
  cycleCameraDistance: 'v',
  pause: 'p',
}

export const MANUAL_COLLECTIBLE_KEY_BINDING_IDS = Object.freeze({
  phantom_veil: 'phantomVeil',
  time_fragment: 'timeFragment',
  watchers_eye: 'watchersEye',
  echo_pulse: 'echoPulse',
})

export const KEY_BINDING_ACTION_ORDER = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'sprint',
  'interact',
  'flashlight',
  'wayfinder',
  'phantomVeil',
  'timeFragment',
  'watchersEye',
  'echoPulse',
  'cycleCameraDistance',
  'pause',
]

export const KEY_BINDING_DEFINITIONS = [
  { id: 'moveForward', action: 'Move Forward', category: 'Movement' },
  { id: 'moveBackward', action: 'Move Backward', category: 'Movement' },
  { id: 'moveLeft', action: 'Move Left', category: 'Movement' },
  { id: 'moveRight', action: 'Move Right', category: 'Movement' },
  { id: 'sprint', action: 'Sprint / Dash', category: 'Movement' },
  { id: 'interact', action: 'Interact', category: 'Actions' },
  { id: 'flashlight', action: 'Toggle Flashlight', category: 'Actions' },
  { id: 'wayfinder', action: 'Wayfinder Beacon', category: 'Actions' },
  { id: 'phantomVeil', action: 'Phantom Veil', category: 'Collectibles' },
  { id: 'timeFragment', action: 'Time Fragment', category: 'Collectibles' },
  { id: 'watchersEye', action: "Watcher's Eye", category: 'Collectibles' },
  { id: 'echoPulse', action: 'Echo Pulse', category: 'Collectibles' },
  { id: 'cycleCameraDistance', action: 'Cycle Camera Distance', category: 'Camera & System' },
  { id: 'pause', action: 'Pause Game', category: 'Camera & System' },
]

export const KEY_BINDING_ACTION_LABELS = KEY_BINDING_DEFINITIONS.reduce(
  (acc, item) => {
    acc[item.id] = item.action
    return acc
  },
  {}
)

export const MODIFIER_ONLY_TOKENS = new Set([
  'control',
  'ctrl',
  'alt',
  'altgraph',
  'meta',
  'os',
  'super',
])

export const RESERVED_FIXED_KEY_TOKENS = new Set([
  'c',
  'escape',
  'esc',
  'control',
  'ctrl',
  'alt',
  'altgraph',
  'meta',
  'os',
  'super',
  'contextmenu',
  'capslock',
  'numlock',
  'scrolllock',
  'fn',
  'fnlock',
  'printscreen',
  'pause',
  'dead',
  'unidentified',
  'process',
  'f1',
  'f3',
  'f5',
  'f6',
  'f7',
  'f11',
  'f12',
  'browserback',
  'browserforward',
  'browserrefresh',
  'browserstop',
  'browsersearch',
  'browserfavorites',
  'browserhome',
  'audiovolumemute',
  'audiovolumedown',
  'audiovolumeup',
  'mediatracknext',
  'mediatrackprevious',
  'mediastop',
  'mediaplaypause',
  'wakeup',
  'sleep',
  'power',
])

const VALID_NAMED_KEY_TOKENS = new Set([
  'space',
  'shift',
  'tab',
  'enter',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'f2',
  'f4',
  'f8',
  'f9',
  'f10',
])

const FALLBACK_KEY_POOL = [
  'w',
  's',
  'a',
  'd',
  'shift',
  'f',
  'l',
  'h',
  'space',
  'e',
  'q',
  'p',
  'i',
  'k',
  'j',
  'r',
  't',
  'y',
  'u',
  'o',
  'g',
  'z',
  'x',
  'v',
  'b',
  'n',
  'm',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
]

export function normalizeBindingKeyToken(token) {
  if (typeof token !== 'string') return ''
  if (token === ' ') return 'space'
  const lower = token.trim().toLowerCase()
  if (!lower) return ''
  if (lower === 'spacebar' || lower === 'space') return 'space'
  if (lower === 'shift' || lower === 'shiftleft' || lower === 'shiftright') {
    return 'shift'
  }
  if (lower === 'esc') return 'escape'
  if (lower === 'ctrl') return 'control'
  return lower
}

export function resolveInputKeyToken(event) {
  if (!event) return ''
  if (event.code === 'Space') return 'space'
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    return event.code.toLowerCase()
  }
  return typeof event.key === 'string' ? event.key.toLowerCase() : ''
}

export function isValidCustomKeyToken(token) {
  const normalized = normalizeBindingKeyToken(token)
  if (!normalized) return false
  if (RESERVED_FIXED_KEY_TOKENS.has(normalized)) return false
  if (normalized.length === 1) return true
  return VALID_NAMED_KEY_TOKENS.has(normalized)
}

export function normalizeKeyBindings(raw = null) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const resolved = {}
  const usedTokens = new Set()

  // Pass 1: Lock defaults for actions not explicitly overridden (or overridden with invalid tokens),
  // as well as actions explicitly keeping their own default token.
  for (const actionId of KEY_BINDING_ACTION_ORDER) {
    const rawCandidate =
      typeof src[actionId] === 'string'
        ? normalizeBindingKeyToken(src[actionId])
        : ''
    const hasValidOverride = Boolean(rawCandidate && isValidCustomKeyToken(rawCandidate))
    const defaultToken = DEFAULT_KEY_BINDINGS[actionId]

    if (!hasValidOverride || rawCandidate === defaultToken) {
      if (!usedTokens.has(defaultToken)) {
        resolved[actionId] = defaultToken
        usedTokens.add(defaultToken)
      }
    }
  }

  // Pass 2: Apply valid non-default custom overrides when the target token is free.
  for (const actionId of KEY_BINDING_ACTION_ORDER) {
    if (resolved[actionId]) continue
    const rawCandidate =
      typeof src[actionId] === 'string'
        ? normalizeBindingKeyToken(src[actionId])
        : ''
    if (
      rawCandidate &&
      isValidCustomKeyToken(rawCandidate) &&
      !usedTokens.has(rawCandidate)
    ) {
      resolved[actionId] = rawCandidate
      usedTokens.add(rawCandidate)
    }
  }

  // Pass 3: Fall back cleanly for any remaining unresolved/conflicted actions without creating duplicates.
  for (const actionId of KEY_BINDING_ACTION_ORDER) {
    if (resolved[actionId]) continue
    const defaultToken = DEFAULT_KEY_BINDINGS[actionId]
    if (!usedTokens.has(defaultToken)) {
      resolved[actionId] = defaultToken
      usedTokens.add(defaultToken)
      continue
    }
    const freeToken =
      FALLBACK_KEY_POOL.find((candidate) => !usedTokens.has(candidate)) || defaultToken
    resolved[actionId] = freeToken
    usedTokens.add(freeToken)
  }

  return resolved
}

export function findKeyBindingConflict(
  bindings = DEFAULT_KEY_BINDINGS,
  targetActionId,
  candidateToken
) {
  const normalizedToken = normalizeBindingKeyToken(candidateToken)
  if (!normalizedToken) return null
  const normalizedBindings = normalizeKeyBindings(bindings)

  for (const actionId of KEY_BINDING_ACTION_ORDER) {
    if (actionId === targetActionId) continue
    if (normalizedBindings[actionId] === normalizedToken) {
      return {
        actionId,
        actionLabel: KEY_BINDING_ACTION_LABELS[actionId] || actionId,
        key: normalizedToken,
      }
    }
  }
  return null
}

export function applyKeyBindingChange(
  bindings = DEFAULT_KEY_BINDINGS,
  targetActionId,
  candidateToken,
  { resolution = 'reject' } = {}
) {
  const normalizedBindings = normalizeKeyBindings(bindings)
  if (!(targetActionId in DEFAULT_KEY_BINDINGS)) {
    return { ok: false, reason: 'unknown_action', bindings: normalizedBindings, conflict: null }
  }

  const normalizedToken = normalizeBindingKeyToken(candidateToken)
  if (!normalizedToken || !isValidCustomKeyToken(normalizedToken)) {
    return { ok: false, reason: 'invalid', bindings: normalizedBindings, conflict: null }
  }

  if (normalizedBindings[targetActionId] === normalizedToken) {
    return { ok: true, reason: null, bindings: normalizedBindings, conflict: null }
  }

  const conflict = findKeyBindingConflict(
    normalizedBindings,
    targetActionId,
    normalizedToken
  )
  if (conflict) {
    if (resolution !== 'swap') {
      return {
        ok: false,
        reason: 'conflict',
        bindings: normalizedBindings,
        conflict,
      }
    }
    const previousToken = normalizedBindings[targetActionId]
    const nextBindings = {
      ...normalizedBindings,
      [targetActionId]: normalizedToken,
      [conflict.actionId]: previousToken,
    }
    return {
      ok: true,
      reason: 'swapped',
      swappedWith: conflict,
      bindings: nextBindings,
      conflict: null,
    }
  }

  return {
    ok: true,
    reason: null,
    bindings: {
      ...normalizedBindings,
      [targetActionId]: normalizedToken,
    },
    conflict: null,
  }
}

export function formatKeyTokenLabel(token) {
  const normalized = normalizeBindingKeyToken(token)
  if (!normalized) {
    return ''
  }
  if (normalized === 'space') return 'Space'
  if (normalized === 'shift') return 'Shift'
  if (normalized === 'tab') return 'Tab'
  if (normalized === 'enter') return 'Enter'
  if (normalized === 'backspace') return 'Backspace'
  if (normalized === 'delete') return 'Del'
  if (normalized === 'insert') return 'Ins'
  if (normalized === 'home') return 'Home'
  if (normalized === 'end') return 'End'
  if (normalized === 'pageup') return 'PgUp'
  if (normalized === 'pagedown') return 'PgDn'
  if (normalized === 'arrowup') return 'Arrow Up'
  if (normalized === 'arrowdown') return 'Arrow Down'
  if (normalized === 'arrowleft') return 'Arrow Left'
  if (normalized === 'arrowright') return 'Arrow Right'
  if (normalized === 'escape') return 'Esc'
  if (/^f\d{1,2}$/.test(normalized)) return normalized.toUpperCase()
  if (normalized.length === 1) return normalized.toUpperCase()
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export const HORROR_INTENSITY_LEVELS = {
  OFF: 'off',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
}

export const HORROR_INTENSITY_PRESETS = {
  [HORROR_INTENSITY_LEVELS.OFF]: {
    enabled: false,
    initialDelay: Infinity,
    minCooldown: Infinity,
    maxCooldown: Infinity,
    scriptedCooldown: Infinity,
    minScriptedElapsed: Infinity,
    lightDipDepth: 0,
    silhouetteMaxOpacity: 0,
    scriptedWeight: 0,
  },
  [HORROR_INTENSITY_LEVELS.LOW]: {
    enabled: true,
    initialDelay: 10.0,
    minCooldown: 18.0,
    maxCooldown: 28.0,
    scriptedCooldown: 75.0,
    minScriptedElapsed: 40.0,
    lightDipDepth: 0.42,
    silhouetteMaxOpacity: 0.45,
    scriptedWeight: 0.45,
  },
  [HORROR_INTENSITY_LEVELS.MEDIUM]: {
    enabled: true,
    initialDelay: 6.0,
    minCooldown: 10.5,
    maxCooldown: 18.0,
    scriptedCooldown: 55.0,
    minScriptedElapsed: 26.0,
    lightDipDepth: 0.68,
    silhouetteMaxOpacity: 0.62,
    scriptedWeight: 0.85,
  },
  [HORROR_INTENSITY_LEVELS.HIGH]: {
    enabled: true,
    initialDelay: 3.5,
    minCooldown: 5.5,
    maxCooldown: 10.5,
    scriptedCooldown: 38.0,
    minScriptedElapsed: 16.0,
    lightDipDepth: 0.86,
    silhouetteMaxOpacity: 0.78,
    scriptedWeight: 1.25,
  },
}

export function normalizeHorrorIntensity(raw) {
  if (raw && raw in HORROR_INTENSITY_PRESETS) {
    return raw
  }
  return HORROR_INTENSITY_LEVELS.MEDIUM
}

export function detectPrefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  try {
    return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}

/**
 * Resolves unified look sensitivity and invertY setting across pointer-lock,
 * drag-look, and touch-look paths.
 */
export function resolveLookInputConfig(engineConfig = {}) {
  const cfg = engineConfig && typeof engineConfig === 'object' ? engineConfig : {}
  const sensitivity =
    Number.isFinite(cfg.mouseSensitivity) && cfg.mouseSensitivity > 0
      ? cfg.mouseSensitivity
      : Number.isFinite(cfg.camera?.sensitivity) && cfg.camera.sensitivity > 0
        ? cfg.camera.sensitivity
        : 0.0022
  const invertY = Boolean(cfg.invertY ?? cfg.camera?.invertY)
  return { sensitivity, invertY }
}

export const GRAPHICS_QUALITY_PRESETS = {
  performance: {
    id: 'performance',
    pixelRatioCap: 1.0,
    particleCount: 36,
    maxEnemyLights: 0,
  },
  balanced: {
    id: 'balanced',
    pixelRatioCap: 1.5,
    particleCount: 72,
    maxEnemyLights: 1,
  },
  high: {
    id: 'high',
    pixelRatioCap: 2.0,
    particleCount: 110,
    maxEnemyLights: 2,
  },
}

export const DEFAULT_GRAPHICS_SETTINGS = {
  qualityPreset: 'high',
  antialias: true,
  volumetricFog: true,
  particlesEnabled: true,
  highContrast: false,
}

export function normalizeGraphicsPreset(raw) {
  if (typeof raw === 'string' && raw in GRAPHICS_QUALITY_PRESETS) {
    return raw
  }
  return DEFAULT_GRAPHICS_SETTINGS.qualityPreset
}

export function normalizeGraphicsSettings(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    qualityPreset: normalizeGraphicsPreset(src.qualityPreset),
    antialias:
      typeof src.antialias === 'boolean'
        ? src.antialias
        : DEFAULT_GRAPHICS_SETTINGS.antialias,
    volumetricFog:
      typeof src.volumetricFog === 'boolean'
        ? src.volumetricFog
        : DEFAULT_GRAPHICS_SETTINGS.volumetricFog,
    particlesEnabled:
      typeof src.particlesEnabled === 'boolean'
        ? src.particlesEnabled
        : DEFAULT_GRAPHICS_SETTINGS.particlesEnabled,
    highContrast:
      typeof src.highContrast === 'boolean'
        ? src.highContrast
        : DEFAULT_GRAPHICS_SETTINGS.highContrast,
  }
}
