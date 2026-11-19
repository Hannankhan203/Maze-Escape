import {
  DIFFICULTY_ORDER,
  normalizeMazeDifficulty,
} from '../game/generation/mazeConfig.js'
import {
  CAMERA_MODES,
  DEFAULT_AUDIO_VOLUMES,
  DEFAULT_GRAPHICS_SETTINGS,
  HORROR_INTENSITY_LEVELS,
  detectPrefersReducedMotion,
  normalizeGraphicsSettings,
  normalizeHorrorIntensity,
} from '../game/three/threeConfig.js'

export const SETTINGS_SCHEMA_VERSION = 2

export const STORAGE_KEYS = {
  RECORDS: 'maze-escape:records:v1',
  PREFERENCES: 'maze-escape:preferences:v1',
  SETTINGS: 'maze-escape:settings:v1',
}

export const TOUCH_CONTROL_MODES = ['auto', 'always', 'off']

export const DEFAULT_CONTROL_SETTINGS = {
  mouseSensitivity: 0.0022,
  touchLookSensitivity: 1.8,
  invertY: false,
  touchControls: 'auto',
}

export const DEFAULT_AUDIO_OPTIONS = {
  spatialAudio: true,
  footstepEchoes: true,
}

export const DEFAULT_GAMEPLAY_SETTINGS = {
  cameraMode: CAMERA_MODES.FIRST_PERSON,
  fieldOfView: 65,
  cameraShake: true,
  scareIntensity: HORROR_INTENSITY_LEVELS.MEDIUM,
  visualScaresEnabled: true,
  reducedMotion: false,
  wayfinderGuide: true,
}

function resolveStorage(customStorage) {
  if (customStorage !== undefined) {
    return customStorage
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    return null
  }

  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    return null
  }

  return null
}

function safeReadJson(key, storage) {
  const targetStorage = resolveStorage(storage)
  if (!targetStorage || typeof targetStorage.getItem !== 'function') {
    return null
  }

  try {
    const raw = targetStorage.getItem(key)
    if (typeof raw !== 'string' || !raw.trim()) {
      return null
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function safeWriteJson(key, value, storage) {
  const targetStorage = resolveStorage(storage)
  if (!targetStorage || typeof targetStorage.setItem !== 'function') {
    return false
  }

  try {
    targetStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function safeRemoveKey(key, storage) {
  const targetStorage = resolveStorage(storage)
  if (!targetStorage || typeof targetStorage.removeItem !== 'function') {
    return false
  }

  try {
    targetStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function clamp(value, min, max, fallback) {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'object' ||
    (typeof value === 'string' && !value.trim())
  ) {
    return fallback
  }
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

function normalizeDifficultyKey(difficulty) {
  return normalizeMazeDifficulty(difficulty)
}

const LEGACY_RECORD_SOURCE = {
  easy: 'small',
  hard: 'large',
}

export function createEmptyRecords() {
  return {
    easy: null,
    medium: null,
    hard: null,
    hardcore: null,
  }
}

function sanitizeRecordEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const bestTimeMs = Number(raw.bestTimeMs)
  const bestScore = Number(raw.bestScore)
  const bestStars = Number(raw.bestStars)
  const completions = Number(raw.completions)

  const hasValidTime = Number.isFinite(bestTimeMs) && bestTimeMs >= 0
  const hasValidScore = Number.isFinite(bestScore) && bestScore >= 0
  const hasValidStars = Number.isFinite(bestStars) && bestStars >= 1

  if (!hasValidTime && !hasValidScore && !hasValidStars) {
    return null
  }

  return {
    bestTimeMs: hasValidTime ? Math.round(bestTimeMs) : null,
    bestScore: hasValidScore ? Math.round(bestScore) : 0,
    bestStars: hasValidStars ? Math.max(1, Math.min(3, Math.round(bestStars))) : 1,
    completions:
      Number.isFinite(completions) && completions >= 1
        ? Math.round(completions)
        : 1,
    updatedAt:
      Number.isFinite(Number(raw.updatedAt)) && Number(raw.updatedAt) > 0
        ? Math.round(Number(raw.updatedAt))
        : 0,
  }
}

function mergeRecordEntries(primary, legacy) {
  if (!primary) return legacy
  if (!legacy) return primary
  const bestTimeMs =
    primary.bestTimeMs != null && legacy.bestTimeMs != null
      ? Math.min(primary.bestTimeMs, legacy.bestTimeMs)
      : primary.bestTimeMs ?? legacy.bestTimeMs ?? null
  return {
    bestTimeMs,
    bestScore: Math.max(primary.bestScore, legacy.bestScore),
    bestStars: Math.max(primary.bestStars, legacy.bestStars),
    completions: Math.max(primary.completions, legacy.completions),
    updatedAt: Math.max(primary.updatedAt, legacy.updatedAt),
  }
}

export function loadRecords(storage) {
  const empty = createEmptyRecords()
  const raw = safeReadJson(STORAGE_KEYS.RECORDS, storage)
  if (!raw) {
    return empty
  }

  for (let i = 0; i < DIFFICULTY_ORDER.length; i += 1) {
    const key = DIFFICULTY_ORDER[i]
    const direct = sanitizeRecordEntry(raw[key])
    const legacyKey = LEGACY_RECORD_SOURCE[key]
    const legacy = legacyKey ? sanitizeRecordEntry(raw[legacyKey]) : null
    empty[key] = mergeRecordEntries(direct, legacy)
  }

  return empty
}

/**
 * Updates personal best records for `difficulty` only where the new run improves
 * fastest completion time, highest score, or highest star rating.
 */
export function savePersonalBest(difficulty, runResult, storage) {
  const key = normalizeDifficultyKey(difficulty)
  const records = loadRecords(storage)
  const previousRecord = records[key]

  const rawTime = Number(runResult?.timeMs ?? runResult?.completionTimeMs)
  const timeMs = Number.isFinite(rawTime) && rawTime >= 0 ? Math.round(rawTime) : null

  const rawScore = Number(runResult?.score)
  const score = Number.isFinite(rawScore) && rawScore >= 0 ? Math.round(rawScore) : 0

  const rawStars = Number(runResult?.stars)
  const stars = Number.isFinite(rawStars)
    ? Math.max(1, Math.min(3, Math.round(rawStars)))
    : 1

  const isNewBestTime =
    timeMs !== null &&
    (previousRecord?.bestTimeMs == null || timeMs < previousRecord.bestTimeMs)
  const isNewBestScore =
    previousRecord?.bestScore == null || score > previousRecord.bestScore
  const isNewBestStars =
    previousRecord?.bestStars == null || stars > previousRecord.bestStars

  const nextEntry = {
    bestTimeMs:
      timeMs === null
        ? previousRecord?.bestTimeMs ?? null
        : previousRecord?.bestTimeMs == null
          ? timeMs
          : Math.min(previousRecord.bestTimeMs, timeMs),
    bestScore:
      previousRecord?.bestScore == null
        ? score
        : Math.max(previousRecord.bestScore, score),
    bestStars:
      previousRecord?.bestStars == null
        ? stars
        : Math.max(previousRecord.bestStars, stars),
    completions: (previousRecord?.completions || 0) + 1,
    updatedAt: Date.now(),
  }

  const nextRecords = {
    ...records,
    [key]: nextEntry,
  }

  const saved = safeWriteJson(STORAGE_KEYS.RECORDS, nextRecords, storage)

  return {
    records: nextRecords,
    record: nextEntry,
    previousRecord,
    isNewBestTime,
    isNewBestScore,
    isNewBestStars,
    saved,
  }
}

export function clearRecords(storage) {
  safeRemoveKey(STORAGE_KEYS.RECORDS, storage)
  return createEmptyRecords()
}

export function getDefaultPreferences() {
  return {
    audioVolumes: { ...DEFAULT_AUDIO_VOLUMES },
    cameraMode: CAMERA_MODES.FIRST_PERSON,
    horrorConfig: {
      intensity: HORROR_INTENSITY_LEVELS.MEDIUM,
      visualScaresEnabled: true,
      reducedMotion: detectPrefersReducedMotion(),
    },
    controlSettings: { ...DEFAULT_CONTROL_SETTINGS },
  }
}

export function sanitizePreferences(raw, fallbackOverrides = null) {
  const defaults = getDefaultPreferences()
  if (fallbackOverrides && typeof fallbackOverrides === 'object') {
    if (fallbackOverrides.audioVolumes) {
      defaults.audioVolumes = {
        ...defaults.audioVolumes,
        ...fallbackOverrides.audioVolumes,
      }
    }
    if (fallbackOverrides.cameraMode) {
      defaults.cameraMode = fallbackOverrides.cameraMode
    }
    if (fallbackOverrides.horrorConfig) {
      defaults.horrorConfig = {
        ...defaults.horrorConfig,
        ...fallbackOverrides.horrorConfig,
      }
    }
    if (fallbackOverrides.controlSettings) {
      defaults.controlSettings = {
        ...defaults.controlSettings,
        ...fallbackOverrides.controlSettings,
      }
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults
  }

  const rawVolumes =
    raw.audioVolumes && typeof raw.audioVolumes === 'object' ? raw.audioVolumes : {}
  const audioVolumes = {
    master: clamp(rawVolumes.master, 0, 1, defaults.audioVolumes.master),
    ambience: clamp(rawVolumes.ambience, 0, 1, defaults.audioVolumes.ambience),
    effects: clamp(rawVolumes.effects, 0, 1, defaults.audioVolumes.effects),
    music: clamp(rawVolumes.music, 0, 1, defaults.audioVolumes.music),
    muted:
      typeof rawVolumes.muted === 'boolean'
        ? rawVolumes.muted
        : defaults.audioVolumes.muted,
  }

  const validCameraModes = Object.values(CAMERA_MODES)
  const cameraMode = validCameraModes.includes(raw.cameraMode)
    ? raw.cameraMode
    : defaults.cameraMode

  const rawHorror =
    raw.horrorConfig && typeof raw.horrorConfig === 'object' ? raw.horrorConfig : {}
  const horrorConfig = {
    intensity: Object.values(HORROR_INTENSITY_LEVELS).includes(rawHorror.intensity)
      ? normalizeHorrorIntensity(rawHorror.intensity)
      : defaults.horrorConfig.intensity,
    visualScaresEnabled:
      typeof rawHorror.visualScaresEnabled === 'boolean'
        ? rawHorror.visualScaresEnabled
        : defaults.horrorConfig.visualScaresEnabled,
    reducedMotion:
      typeof rawHorror.reducedMotion === 'boolean'
        ? rawHorror.reducedMotion
        : defaults.horrorConfig.reducedMotion,
  }

  const rawControls =
    raw.controlSettings && typeof raw.controlSettings === 'object'
      ? raw.controlSettings
      : {}
  const controlSettings = {
    mouseSensitivity: clamp(
      rawControls.mouseSensitivity,
      0.0005,
      0.01,
      defaults.controlSettings.mouseSensitivity
    ),
    touchLookSensitivity: clamp(
      rawControls.touchLookSensitivity,
      0.5,
      5.0,
      defaults.controlSettings.touchLookSensitivity
    ),
    invertY:
      typeof rawControls.invertY === 'boolean'
        ? rawControls.invertY
        : defaults.controlSettings.invertY,
    touchControls: TOUCH_CONTROL_MODES.includes(rawControls.touchControls)
      ? rawControls.touchControls
      : defaults.controlSettings.touchControls,
  }

  return {
    audioVolumes,
    cameraMode,
    horrorConfig,
    controlSettings,
  }
}

export function loadPreferences(storage, fallbackOverrides = null) {
  const raw = safeReadJson(STORAGE_KEYS.PREFERENCES, storage)
  return sanitizePreferences(raw, fallbackOverrides)
}

export function savePreferences(preferences, storage) {
  const sanitized = sanitizePreferences(preferences)
  const saved = safeWriteJson(STORAGE_KEYS.PREFERENCES, sanitized, storage)
  return {
    preferences: sanitized,
    saved,
  }
}

export function getDefaultAllSettings() {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    audio: {
      ...DEFAULT_AUDIO_VOLUMES,
      ...DEFAULT_AUDIO_OPTIONS,
    },
    controls: {
      ...DEFAULT_CONTROL_SETTINGS,
      touchHaptics: true,
    },
    graphics: {
      ...DEFAULT_GRAPHICS_SETTINGS,
    },
    gameplay: {
      ...DEFAULT_GAMEPLAY_SETTINGS,
      reducedMotion: detectPrefersReducedMotion(),
    },
  }
}

function normalizeFov(value, fallback = DEFAULT_GAMEPLAY_SETTINGS.fieldOfView) {
  const clamped = clamp(value, 55, 85, fallback)
  return Math.round(clamped / 5) * 5
}

export function sanitizeAllSettings(raw, fallbackOverrides = null) {
  const defaults = getDefaultAllSettings()
  if (fallbackOverrides && typeof fallbackOverrides === 'object') {
    if (fallbackOverrides.audio && typeof fallbackOverrides.audio === 'object') {
      defaults.audio = { ...defaults.audio, ...fallbackOverrides.audio }
    }
    if (fallbackOverrides.controls && typeof fallbackOverrides.controls === 'object') {
      defaults.controls = { ...defaults.controls, ...fallbackOverrides.controls }
    }
    if (fallbackOverrides.graphics && typeof fallbackOverrides.graphics === 'object') {
      defaults.graphics = normalizeGraphicsSettings({
        ...defaults.graphics,
        ...fallbackOverrides.graphics,
      })
    }
    if (fallbackOverrides.gameplay && typeof fallbackOverrides.gameplay === 'object') {
      defaults.gameplay = { ...defaults.gameplay, ...fallbackOverrides.gameplay }
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults
  }

  // Support both unified v2 structure and legacy/outdated v1 preference fields
  const rawAudio =
    raw.audio && typeof raw.audio === 'object' && !Array.isArray(raw.audio)
      ? raw.audio
      : raw.audioVolumes && typeof raw.audioVolumes === 'object' && !Array.isArray(raw.audioVolumes)
        ? raw.audioVolumes
        : {}
  const rawAudioOpts =
    raw.audioOptions && typeof raw.audioOptions === 'object' && !Array.isArray(raw.audioOptions)
      ? raw.audioOptions
      : {}

  const audio = {
    master: clamp(
      rawAudio.master ?? (Number.isFinite(Number(raw.masterVolume)) ? Number(raw.masterVolume) / 100 : undefined),
      0,
      1,
      defaults.audio.master
    ),
    ambience: clamp(
      rawAudio.ambience ?? (Number.isFinite(Number(raw.ambienceVolume)) ? Number(raw.ambienceVolume) / 100 : undefined),
      0,
      1,
      defaults.audio.ambience
    ),
    effects: clamp(
      rawAudio.effects ?? (Number.isFinite(Number(raw.effectsVolume)) ? Number(raw.effectsVolume) / 100 : undefined),
      0,
      1,
      defaults.audio.effects
    ),
    music: clamp(
      rawAudio.music ?? (Number.isFinite(Number(raw.musicVolume)) ? Number(raw.musicVolume) / 100 : undefined),
      0,
      1,
      defaults.audio.music
    ),
    muted:
      typeof rawAudio.muted === 'boolean'
        ? rawAudio.muted
        : typeof raw.muted === 'boolean'
          ? raw.muted
          : defaults.audio.muted,
    spatialAudio:
      typeof rawAudio.spatialAudio === 'boolean'
        ? rawAudio.spatialAudio
        : typeof rawAudioOpts.spatialAudio === 'boolean'
          ? rawAudioOpts.spatialAudio
          : defaults.audio.spatialAudio,
    footstepEchoes:
      typeof rawAudio.footstepEchoes === 'boolean'
        ? rawAudio.footstepEchoes
        : typeof rawAudioOpts.footstepEchoes === 'boolean'
          ? rawAudioOpts.footstepEchoes
          : defaults.audio.footstepEchoes,
  }

  const rawControls =
    raw.controls && typeof raw.controls === 'object' && !Array.isArray(raw.controls)
      ? raw.controls
      : raw.controlSettings && typeof raw.controlSettings === 'object' && !Array.isArray(raw.controlSettings)
        ? raw.controlSettings
        : {}
  const touchModeCandidate = rawControls.touchControls ?? rawControls.touchControlsMode
  const controls = {
    mouseSensitivity: clamp(
      rawControls.mouseSensitivity,
      0.0005,
      0.01,
      defaults.controls.mouseSensitivity
    ),
    touchLookSensitivity: clamp(
      rawControls.touchLookSensitivity,
      0.5,
      5.0,
      defaults.controls.touchLookSensitivity
    ),
    invertY:
      typeof rawControls.invertY === 'boolean'
        ? rawControls.invertY
        : defaults.controls.invertY,
    touchControls: TOUCH_CONTROL_MODES.includes(touchModeCandidate)
      ? touchModeCandidate
      : defaults.controls.touchControls,
    touchHaptics:
      typeof rawControls.touchHaptics === 'boolean'
        ? rawControls.touchHaptics
        : typeof raw.touchHaptics === 'boolean'
          ? raw.touchHaptics
          : defaults.controls.touchHaptics,
  }

  const rawGraphics =
    raw.graphics && typeof raw.graphics === 'object' && !Array.isArray(raw.graphics)
      ? raw.graphics
      : raw.graphicsSettings && typeof raw.graphicsSettings === 'object' && !Array.isArray(raw.graphicsSettings)
        ? raw.graphicsSettings
        : {}
  const graphics = normalizeGraphicsSettings({
    ...defaults.graphics,
    ...rawGraphics,
  })

  const rawGameplay =
    raw.gameplay && typeof raw.gameplay === 'object' && !Array.isArray(raw.gameplay)
      ? raw.gameplay
      : raw.gameplaySettings && typeof raw.gameplaySettings === 'object' && !Array.isArray(raw.gameplaySettings)
        ? raw.gameplaySettings
        : {}
  const rawHorror =
    raw.horrorConfig && typeof raw.horrorConfig === 'object' && !Array.isArray(raw.horrorConfig)
      ? raw.horrorConfig
      : {}

  const validCameraModes = Object.values(CAMERA_MODES)
  const cameraModeCandidate = rawGameplay.cameraMode ?? rawGameplay.defaultCamera ?? raw.cameraMode
  const intensityCandidate =
    rawGameplay.scareIntensity ?? rawHorror.intensity
  const visualScaresCandidate =
    rawGameplay.visualScaresEnabled ?? rawGameplay.visualScares ?? rawHorror.visualScaresEnabled
  const reducedMotionCandidate =
    rawGameplay.reducedMotion ?? rawHorror.reducedMotion

  const gameplay = {
    cameraMode: validCameraModes.includes(cameraModeCandidate)
      ? cameraModeCandidate
      : defaults.gameplay.cameraMode,
    fieldOfView: normalizeFov(
      rawGameplay.fieldOfView ?? raw.fieldOfView,
      defaults.gameplay.fieldOfView
    ),
    cameraShake:
      typeof rawGameplay.cameraShake === 'boolean'
        ? rawGameplay.cameraShake
        : defaults.gameplay.cameraShake,
    scareIntensity: Object.values(HORROR_INTENSITY_LEVELS).includes(intensityCandidate)
      ? normalizeHorrorIntensity(intensityCandidate)
      : defaults.gameplay.scareIntensity,
    visualScaresEnabled:
      typeof visualScaresCandidate === 'boolean'
        ? visualScaresCandidate
        : defaults.gameplay.visualScaresEnabled,
    reducedMotion:
      typeof reducedMotionCandidate === 'boolean'
        ? reducedMotionCandidate
        : defaults.gameplay.reducedMotion,
    wayfinderGuide:
      typeof rawGameplay.wayfinderGuide === 'boolean'
        ? rawGameplay.wayfinderGuide
        : defaults.gameplay.wayfinderGuide,
  }

  return {
    version: SETTINGS_SCHEMA_VERSION,
    audio,
    controls,
    graphics,
    gameplay,
  }
}

export function extractLegacyPreferencesFromSettings(settings) {
  const normalized = sanitizeAllSettings(settings)
  return {
    audioVolumes: {
      master: normalized.audio.master,
      ambience: normalized.audio.ambience,
      effects: normalized.audio.effects,
      music: normalized.audio.music,
      muted: normalized.audio.muted,
    },
    cameraMode: normalized.gameplay.cameraMode,
    horrorConfig: {
      intensity: normalized.gameplay.scareIntensity,
      visualScaresEnabled: normalized.gameplay.visualScaresEnabled,
      reducedMotion: normalized.gameplay.reducedMotion,
    },
    controlSettings: {
      mouseSensitivity: normalized.controls.mouseSensitivity,
      touchLookSensitivity: normalized.controls.touchLookSensitivity,
      invertY: normalized.controls.invertY,
      touchControls: normalized.controls.touchControls,
    },
  }
}

/**
 * Pure read-only loader: reads unified settings first, gracefully migrates
 * legacy v1 preferences if unified settings are absent/corrupted, and never
 * writes to storage during initialization.
 */
export function loadAllSettings(storage, fallbackOverrides = null) {
  const rawSettings = safeReadJson(STORAGE_KEYS.SETTINGS, storage)
  if (rawSettings) {
    return sanitizeAllSettings(rawSettings, fallbackOverrides)
  }

  const rawLegacyPrefs = safeReadJson(STORAGE_KEYS.PREFERENCES, storage)
  if (rawLegacyPrefs) {
    return sanitizeAllSettings(rawLegacyPrefs, fallbackOverrides)
  }

  return sanitizeAllSettings(null, fallbackOverrides)
}

export function saveAllSettings(settings, storage) {
  const sanitized = sanitizeAllSettings(settings)
  const savedSettings = safeWriteJson(STORAGE_KEYS.SETTINGS, sanitized, storage)
  const legacyPrefs = extractLegacyPreferencesFromSettings(sanitized)
  safeWriteJson(STORAGE_KEYS.PREFERENCES, legacyPrefs, storage)
  return {
    settings: sanitized,
    saved: savedSettings,
  }
}

export function resetAllSettings(storage) {
  const defaults = getDefaultAllSettings()
  const result = saveAllSettings(defaults, storage)
  return {
    settings: result.settings,
    saved: result.saved,
  }
}
