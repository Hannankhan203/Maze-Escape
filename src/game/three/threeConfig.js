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
  dynamicLights: true,
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
    dynamicLights:
      typeof src.dynamicLights === 'boolean'
        ? src.dynamicLights
        : DEFAULT_GRAPHICS_SETTINGS.dynamicLights,
    highContrast:
      typeof src.highContrast === 'boolean'
        ? src.highContrast
        : DEFAULT_GRAPHICS_SETTINGS.highContrast,
  }
}
