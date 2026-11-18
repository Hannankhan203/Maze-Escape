import { DIFFICULTY_ORDER } from '../game/generation/mazeConfig.js'
import { CAMERA_MODES } from '../game/three/CameraRig.js'
import { DEFAULT_AUDIO_VOLUMES } from '../game/three/HorrorAudioEngine.js'
import {
  HORROR_INTENSITY_LEVELS,
  detectPrefersReducedMotion,
  normalizeHorrorIntensity,
} from '../game/three/HorrorDirector.js'

export const STORAGE_KEYS = {
  RECORDS: 'maze-escape:records:v1',
  PREFERENCES: 'maze-escape:preferences:v1',
}

export const TOUCH_CONTROL_MODES = ['auto', 'always', 'off']

export const DEFAULT_CONTROL_SETTINGS = {
  mouseSensitivity: 0.0022,
  touchLookSensitivity: 1.8,
  invertY: false,
  touchControls: 'auto',
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
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

function normalizeDifficultyKey(difficulty) {
  return DIFFICULTY_ORDER.includes(difficulty) ? difficulty : 'medium'
}

export function createEmptyRecords() {
  return {
    small: null,
    medium: null,
    large: null,
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

export function loadRecords(storage) {
  const empty = createEmptyRecords()
  const raw = safeReadJson(STORAGE_KEYS.RECORDS, storage)
  if (!raw) {
    return empty
  }

  for (let i = 0; i < DIFFICULTY_ORDER.length; i += 1) {
    const key = DIFFICULTY_ORDER[i]
    empty[key] = sanitizeRecordEntry(raw[key])
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
