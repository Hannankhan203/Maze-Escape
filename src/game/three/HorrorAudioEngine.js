import { isCellWalkable } from '../world/gridCollision.js'
import { gridToWorld, worldToGrid } from '../world/worldCoords.js'
import {
  THUNDERSTORM_RAIN_CONSTANTS,
  createCeilingLightVoice,
  createNoiseBuffer,
  createRainNoiseBuffer,
  startAdaptiveMusicLayer,
  startAmbientBed,
  startThunderstormRainBed,
  triggerAbilityActivateCue,
  triggerAmbientCreakOrKnockCue,
  triggerAmbientDistantEchoStepsCue,
  triggerAmbientRareAnomalyCue,
  triggerAmbientUndergroundRumbleCue,
  triggerAmbientVentWindCue,
  triggerCeilingLightFaultCue,
  triggerCeilingLightSputterCue,
  triggerCeilingLightStarterCue,
  triggerCoinPickupCue,
  triggerEnemyAlertCue,
  triggerEnemyAttackCue,
  triggerEnemyFootstep,
  triggerEnvironmentalDisturbanceCue,
  triggerExitVictoryCue,
  triggerGameOverCue,
  triggerHazardCue,
  triggerHidingSpotCue,
  triggerLightFailureCue,
  triggerPlayerDamageCue,
  triggerPlayerFootstep,
  triggerPowerUpPickupCue,
  triggerPresenceWarningCue,
  triggerScriptedScareCue,
  triggerSilhouetteStingCue,
  triggerDistantThunderCue,
  triggerLightningCrackCue,
  triggerFlashlightCue,
  triggerStaminaWarningCue,
  triggerKeycardPickupCue,
  triggerGateUnlockCue,
  triggerLockedExitCue,
} from './audioSynthesis.js'
import { DEFAULT_AUDIO_VOLUMES } from './threeConfig.js'

export { DEFAULT_AUDIO_VOLUMES }

export const AMBIENT_HORROR_CATEGORIES = Object.freeze({
  CREAK_KNOCK: 'creak_knock',
  UNDERGROUND_RUMBLE: 'underground_rumble',
  VENT_WIND: 'vent_wind',
  DISTANT_ECHO_STEPS: 'distant_echo_steps',
  RARE_ANOMALY: 'rare_anomaly',
})

const AMBIENT_HORROR_CATEGORY_LIST = Object.freeze([
  AMBIENT_HORROR_CATEGORIES.CREAK_KNOCK,
  AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE,
  AMBIENT_HORROR_CATEGORIES.VENT_WIND,
  AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS,
  AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY,
])

export const AMBIENT_HORROR_CONFIG = Object.freeze({
  initialGraceMinSec: 5.5,
  initialGraceMaxSec: 10.0,
  intervalMinSec: 8.5,
  intervalMaxSec: 21.0,
  extraSilenceChance: 0.28,
  extraSilenceMinSec: 5.0,
  extraSilenceMaxSec: 12.0,
  minResumeDelaySec: 2.5,
  suppressionDeferralMinSec: 1.5,
  suppressionDeferralMaxSec: 3.2,
  busyHorrorGraceSec: 1.8,
  ceilingLightClusterGraceSec: 1.1,
  minRareAnomalyElapsedSec: 22.0,
  minStartlingElapsedSec: 16.0,
  startlingCooldownSec: 36.0,
  minEnemyDistanceForSteps: 10.5,
  perCategoryCooldowns: Object.freeze({
    [AMBIENT_HORROR_CATEGORIES.CREAK_KNOCK]: 20.0,
    [AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE]: 24.0,
    [AMBIENT_HORROR_CATEGORIES.VENT_WIND]: 20.0,
    [AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS]: 36.0,
    [AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY]: 48.0,
  }),
  categoryWeights: Object.freeze({
    [AMBIENT_HORROR_CATEGORIES.CREAK_KNOCK]: 1.15,
    [AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE]: 0.95,
    [AMBIENT_HORROR_CATEGORIES.VENT_WIND]: 1.15,
    [AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS]: 0.78,
    [AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY]: 0.34,
  }),
})

export const THUNDER_AUDIO_CONFIG = Object.freeze({
  initialGraceMinSec: 6.0,
  initialGraceMaxSec: 11.0,
  distantIntervalMinSec: 16.0,
  distantIntervalMaxSec: 36.0,
  crackCooldownMinSec: 48.0,
  crackCooldownMaxSec: 88.0,
  minCrackElapsedSec: 20.0,
  minResumeDelaySec: 2.5,
  suppressionDeferralMinSec: 2.0,
  suppressionDeferralMaxSec: 4.5,
  busyHorrorGraceSec: 1.8,
  crackChanceWhenReady: 0.38,
  rainDuckHoldSec: 2.6,
})

export const CEILING_LIGHT_AUDIO_CONFIG = Object.freeze({
  maxHumVoices: 2,
  humMaxDistance: 12.5,
  humRefDistance: 1.9,
  transientMaxDistance: 15.5,
  transientRefDistance: 2.0,
  workingHumGain: 0.032,
  flickeringHumGain: 0.056,
  minAudibleGain: 0.006,
  minTransientGain: 0.025,
  globalSputterCooldownSec: 0.45,
  perFixtureCooldownMinSec: 2.2,
  perFixtureCooldownSpanSec: 2.4,
  dipEnterThreshold: 0.26,
  dipExitThreshold: 0.12,
  faultDipThreshold: 0.44,
})

export const MUSIC_MOODS = {
  SILENT: 'silent',
  AMBIENT: 'ambient',
  TENSION: 'tension',
  CHASE: 'chase',
}

function clamp01(val, fallback = 0.5) {
  const num = Number(val)
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, Math.min(1, num))
}

function setGainSmooth(gainNode, value, now, tau = 0.03) {
  if (!gainNode?.gain) return
  if (typeof gainNode.gain.setTargetAtTime === 'function') {
    gainNode.gain.setTargetAtTime(value, now, tau)
  } else {
    gainNode.gain.value = value
  }
}

/**
 * Computes distance-based volume attenuation from listener to world sound source.
 */
export function computeDistanceAttenuation(sourcePos, listenerPos, options = {}) {
  if (!sourcePos || !listenerPos) return 0
  const refDistance = Math.max(0.25, Number(options.refDistance) || 1.8)
  const maxDistance = Math.max(refDistance + 0.5, Number(options.maxDistance) || 22.0)
  const rolloff = Math.max(0.2, Number(options.rolloff) || 1.45)

  const dx = (Number(sourcePos.x) || 0) - (Number(listenerPos.x) || 0)
  const dy = (Number(sourcePos.y) || 0) - (Number(listenerPos.y) || 0)
  const dz = (Number(sourcePos.z) || 0) - (Number(listenerPos.z) || 0)
  const dist = Math.hypot(dx, dy, dz)

  if (dist <= refDistance) return 1.0
  if (dist >= maxDistance) return 0.0

  const inv = refDistance / (refDistance + rolloff * (dist - refDistance))
  // Smooth taper to exact 0 at maxDistance
  const normalizedTail = 1 - Math.pow((dist - refDistance) / (maxDistance - refDistance), 2)
  return Math.max(0, Math.min(1, inv * normalizedTail))
}

/**
 * Counts distinct non-walkable wall cells crossed along the 2D maze ray
 * between listener and sound source for wall-occlusion attenuation.
 */
export function countOccludingWalls(fromPos, toPos, maze) {
  if (!maze?.grid || !fromPos || !toPos) return 0
  const dx = (Number(toPos.x) || 0) - (Number(fromPos.x) || 0)
  const dz = (Number(toPos.z) || 0) - (Number(fromPos.z) || 0)
  const dist = Math.hypot(dx, dz)
  if (dist < 0.6) return 0

  const startCell = worldToGrid(fromPos.x, fromPos.z, maze)
  const endCell = worldToGrid(toPos.x, toPos.z, maze)
  const step = 0.45
  const steps = Math.floor(dist / step)
  const ux = dx / dist
  const uz = dz / dist

  let wallCount = 0
  let lastWallKey = ''

  for (let i = 1; i < steps; i += 1) {
    const sx = fromPos.x + ux * (i * step)
    const sz = fromPos.z + uz * (i * step)
    const cell = worldToGrid(sx, sz, maze)
    if (!cell) continue
    if (
      (startCell && cell.row === startCell.row && cell.col === startCell.col) ||
      (endCell && cell.row === endCell.row && cell.col === endCell.col)
    ) {
      continue
    }

    if (!isCellWalkable(cell.row, cell.col, maze)) {
      const key = `${cell.row},${cell.col}`
      if (key !== lastWallKey) {
        wallCount += 1
        lastWallKey = key
      }
    }
  }

  return wallCount
}

/**
 * Maps crossed wall barriers to gain reduction and low-pass muffling frequency.
 */
export function computeOcclusionFactors(fromPos, toPos, maze, options = {}) {
  const wallCount = countOccludingWalls(fromPos, toPos, maze)
  if (wallCount <= 0) {
    return {
      wallCount: 0,
      gainMultiplier: 1.0,
      lowpassCutoff: 18000,
    }
  }

  const wallAttBase = Math.max(0.1, Math.min(0.95, Number(options?.wallAttBase) || 0.45))
  const minOcclusionGain = Math.max(
    0.01,
    Math.min(1.0, Number(options?.minOcclusionGain) || 0.08)
  )
  const minLowpassCutoff = Math.max(200, Number(options?.minLowpassCutoff) || 420)
  const initialBlockedCutoff = Math.max(
    minLowpassCutoff,
    Number(options?.initialBlockedCutoff) || 1800
  )

  const gainMultiplier = Math.max(minOcclusionGain, Math.pow(wallAttBase, wallCount))
  const lowpassCutoff = Math.max(
    minLowpassCutoff,
    Math.round(initialBlockedCutoff / Math.pow(1.75, wallCount - 1))
  )
  return {
    wallCount,
    gainMultiplier,
    lowpassCutoff,
  }
}

/**
 * Combined distance + wall occlusion gain helper.
 */
export function computeSpatialAudioAttenuation(sourcePos, listenerPos, maze, options = {}) {
  const distanceGain = computeDistanceAttenuation(sourcePos, listenerPos, options)
  const minSpatialGain = Math.max(0, Math.min(1, Number(options?.minSpatialGain) || 0))
  if (distanceGain <= 0.001 && minSpatialGain <= 0) {
    return {
      gain: 0,
      distanceGain: 0,
      wallCount: 0,
      occlusionMultiplier: 1,
      lowpassCutoff: 18000,
    }
  }

  const occlusion = computeOcclusionFactors(listenerPos, sourcePos, maze, options)
  const rawGain = distanceGain * occlusion.gainMultiplier
  return {
    gain: minSpatialGain > 0 ? Math.max(minSpatialGain, rawGain) : rawGain,
    distanceGain,
    wallCount: occlusion.wallCount,
    occlusionMultiplier: occlusion.gainMultiplier,
    lowpassCutoff: occlusion.lowpassCutoff,
  }
}

/**
 * Centralized procedural 3D horror audio engine for Maze Escape.
 * Respects browser autoplay restrictions (no AudioContext until user gesture unlock),
 * routes master/ambience/effects/music buses, spatializes 3D world sources with
 * wall-occlusion muffling, and triggers state-driven enemy/hazard cues cleanly.
 */
export class HorrorAudioEngine {
  constructor(options = {}) {
    this.isDisposed = false
    this.isPaused = false
    this.isUnlocked = false
    this.maze = null

    this._createAudioContext =
      typeof options.createAudioContext === 'function'
        ? options.createAudioContext
        : null
    this._injectedContext = options.audioContext || null
    this._ownsContext = !options.audioContext

    this.volumes = {
      master: clamp01(options.volumes?.master, DEFAULT_AUDIO_VOLUMES.master),
      ambience: clamp01(options.volumes?.ambience, DEFAULT_AUDIO_VOLUMES.ambience),
      effects: clamp01(options.volumes?.effects, DEFAULT_AUDIO_VOLUMES.effects),
      music: clamp01(options.volumes?.music, DEFAULT_AUDIO_VOLUMES.music),
      muted: Boolean(options.volumes?.muted ?? DEFAULT_AUDIO_VOLUMES.muted),
    }

    this.spatialAudio = options.spatialAudio !== false
    this.footstepEchoes = options.footstepEchoes !== false

    this.ctx = null
    this.masterGain = null
    this.ambienceGain = null
    this.effectsGain = null
    this.musicGain = null
    this.compressor = null
    this.noiseBuffer = null
    this._rainNoiseBuffer = null
    this._reverbInput = null
    this._reverbDelay = null
    this._reverbFilter = null
    this._reverbWetGain = null
    this._ambientReverbInput = null
    this._ambientReverbDelay = null
    this._ambientReverbFilter = null
    this._ambientReverbWetGain = null
    this._playerStepBus = null

    this._ambientBed = null
    this._thunderstormRainBed = null
    this._musicLayer = null
    this._musicMood = MUSIC_MOODS.SILENT
    this._desiredAmbientActive = true
    this._desiredRainActive = options.rainEnabled !== false
    this._rainBreathPhase = 0
    this._rainBreathTimer = 0
    this._rainLastHidden = false
    this._rainLastDucked = false
    this._rainLastReducedMotion = false
    this._rainContextPayload = {
      hidden: false,
      ducked: false,
      reducedMotion: false,
      breath: 0.5,
    }

    this._listenerPos = { x: 0, y: 1.65, z: 0 }
    this._tmpListenerPos = { x: 0, y: 1.65, z: 0 }
    this._listenerForward = { x: 0, y: 0, z: -1 }
    this._listenerUp = { x: 0, y: 1, z: 0 }
    this._enemyStateMap = new Map()
    this._hazardStateMap = new Map()
    this._fixtureAudioState = new Map()
    this._cleanupTimers = new Set()
    this._activePositionalCleanups = new Set()
    this._activeSilhouetteCleanups = new Set()
    this._pendingFadeCleanups = new Set()

    this._lightVoicePool = []
    this._lightVoiceAssigned = [-1, -1]
    this._lastGlobalLightSputterAt = -10
    this._lightSourcePos = { x: 0, y: 3.4, z: 0 }
    this._lightHumAttOpts = {
      refDistance: CEILING_LIGHT_AUDIO_CONFIG.humRefDistance,
      maxDistance: CEILING_LIGHT_AUDIO_CONFIG.humMaxDistance,
      rolloff: 1.55,
    }
    this._lightTransientAttOpts = {
      refDistance: CEILING_LIGHT_AUDIO_CONFIG.transientRefDistance,
      maxDistance: CEILING_LIGHT_AUDIO_CONFIG.transientMaxDistance,
      rolloff: 1.45,
      ttlMs: 420,
    }
    this._lightBestIndices = [-1, -1]
    this._lightBestScores = [0, 0]
    this._lightBestGains = [0, 0]
    this._lightBestCutoffs = [900, 900]
    this._lightBestWallCounts = [0, 0]
    this._lightBestWarm = [0, 0]
    this._lightBestFixtures = [null, null]
    this._lightVoicePayload = {
      x: 0,
      y: 3.4,
      z: 0,
      gain: 0,
      cutoff: 780,
      humHz: 60,
      buzzHz: 120,
      buzzLevel: 0.22,
      tau: 0.05,
    }

    this._playerStepTimer = 0
    this._ambientRng =
      typeof options.ambientRandom === 'function' ? options.ambientRandom : Math.random
    const customAmbient =
      options.ambientScheduler && typeof options.ambientScheduler === 'object'
        ? options.ambientScheduler
        : null
    this._ambientConfig = {
      ...AMBIENT_HORROR_CONFIG,
      ...(customAmbient || {}),
      perCategoryCooldowns: {
        ...AMBIENT_HORROR_CONFIG.perCategoryCooldowns,
        ...(customAmbient?.perCategoryCooldowns || {}),
      },
      categoryWeights: {
        ...AMBIENT_HORROR_CONFIG.categoryWeights,
        ...(customAmbient?.categoryWeights || {}),
      },
    }
    this._ambientEventTimer = this._sampleAmbientInitialGrace()
    this._ambientClockSec = 0
    this._ambientLastTriggeredAt = new Map()
    this._lastAmbientCategory = null
    this._lastAmbientVariantByCategory = new Map()
    this._activeAmbientCue = null
    this._ambientAnchors = { vents: [], ducts: [], corridors: [] }
    this._ambientPickedAnchor = { x: 0, y: 1.4, z: 0 }
    this._ambientProbePos = { x: 0, y: 1.4, z: 0 }
    this._ambientEnemyList = []
    this._ambientEligibleCategories = []
    this._lastStartlingAmbientAt = -100
    this._lastHorrorCueAt = -100

    this._desiredThunderActive = options.thunderEnabled !== false
    this._thunderRng =
      typeof options.thunderRandom === 'function' ? options.thunderRandom : Math.random
    const customThunder =
      options.thunderScheduler && typeof options.thunderScheduler === 'object'
        ? options.thunderScheduler
        : null
    this._thunderConfig = {
      ...THUNDER_AUDIO_CONFIG,
      ...(customThunder || {}),
    }
    this._thunderClockSec = 0
    this._thunderEventTimer = this._sampleThunderInitialGrace()
    this._thunderNextCrackAllowedAtSec = Math.max(
      0,
      Number(this._thunderConfig.minCrackElapsedSec ?? 20.0)
    )
    this._activeThunderCue = null
    this._lastThunderKind = null
    this._lastThunderDistantVariant = -1
    this._lastThunderCrackVariant = -1
    this._thunderLastTriggerAtSec = -100
    this._thunderDuckRemainingSec = 0

    this._elapsedSec = 0
    this._isHidden = false
    this._isGameOver = false
    this._hasWon = false
    this._lastGameEventId = null
    this._lastCueLog = [] // Bounded recent cues only when debugHistoryEnabled is set
    this._debugHistoryEnabled = Boolean(options.recordCueHistory)

    if (options.autoUnlock === true) {
      this.unlock()
    }
  }

  _resolveAudioContextConstructor() {
    if (this._createAudioContext) {
      return null
    }
    if (typeof window !== 'undefined') {
      return window.AudioContext || window.webkitAudioContext || null
    }
    if (typeof globalThis !== 'undefined') {
      return globalThis.AudioContext || globalThis.webkitAudioContext || null
    }
    return null
  }

  _ensureContinuousLayers() {
    if (this.isDisposed || !this.isUnlocked || !this.ctx || this.isPaused) return

    if (!this._ambientBed && this._desiredAmbientActive && !this._isGameOver && !this._hasWon) {
      this._ambientBed = startAmbientBed(this.ctx, this.ambienceGain, this.noiseBuffer)
      this._ambientBed?.setStealthDucking?.(this._isHidden)
    }
    if (
      !this._thunderstormRainBed &&
      this._desiredRainActive &&
      !this._isGameOver &&
      !this._hasWon &&
      this._rainNoiseBuffer &&
      this.ambienceGain
    ) {
      this._thunderstormRainBed = startThunderstormRainBed(
        this.ctx,
        this.ambienceGain,
        this._rainNoiseBuffer
      )
      this._rainContextPayload.hidden = this._isHidden
      this._rainContextPayload.ducked = this._rainLastDucked
      this._rainContextPayload.reducedMotion = this._rainLastReducedMotion
      this._rainContextPayload.breath = this._rainLastReducedMotion
        ? 0.5
        : 0.5 + 0.5 * Math.sin(this._rainBreathPhase)
      if (this._isHidden || this._rainLastDucked || this._rainLastReducedMotion) {
        this._thunderstormRainBed?.setContext?.(this._rainContextPayload, 0.42)
      }
      this._thunderstormRainBed?.setPaused?.(false)
    }
    if (!this._musicLayer) {
      this._musicLayer = startAdaptiveMusicLayer(this.ctx, this.musicGain)
    }
    const targetMood =
      this._isGameOver || this._hasWon
        ? MUSIC_MOODS.SILENT
        : this._musicMood === MUSIC_MOODS.SILENT
          ? MUSIC_MOODS.AMBIENT
          : this._musicMood
    this._musicMood = targetMood
    this._musicLayer?.setMood?.(targetMood)
  }

  _stopThunderstormRainBed({ immediate = true } = {}) {
    if (!this._thunderstormRainBed) return
    const bed = this._thunderstormRainBed
    this._thunderstormRainBed = null
    try {
      bed.stop?.({ immediate: Boolean(immediate) })
    } catch {
      // Ignore already-stopped rain bed errors
    }
  }

  /**
   * Initializes or resumes the Web Audio graph. Safe to call repeatedly; must be
   * called from a user gesture in browsers to satisfy autoplay policies.
   */
  unlock() {
    if (this.isDisposed || this.isPaused) return false

    if (!this.ctx) {
      let ctx = this._injectedContext || null
      if (!ctx && this._createAudioContext) {
        ctx = this._createAudioContext()
      } else if (!ctx) {
        const AudioCtx = this._resolveAudioContextConstructor()
        if (!AudioCtx) {
          return false
        }
        ctx = new AudioCtx()
      }

      if (!ctx) return false
      this.ctx = ctx
      this._buildAudioGraph()
    }

    if (!this.isPaused && this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
      try {
        this.ctx.resume().catch?.(() => {})
      } catch {
        // Ignore resume errors in restricted contexts
      }
    }

    this.isUnlocked = true
    this._syncBusGains()
    this._ensureContinuousLayers()

    return true
  }

  _buildAudioGraph() {
    if (!this.ctx || typeof this.ctx.createGain !== 'function') return

    this.masterGain = this.ctx.createGain()
    this.ambienceGain = this.ctx.createGain()
    this.effectsGain = this.ctx.createGain()
    this.musicGain = this.ctx.createGain()

    this.ambienceGain.connect(this.masterGain)
    this.effectsGain.connect(this.masterGain)
    this.musicGain.connect(this.masterGain)

    if (typeof this.ctx.createDelay === 'function') {
      this._reverbInput = this.ctx.createGain()
      this._reverbDelay = this.ctx.createDelay(1.0)
      if (this._reverbDelay.delayTime) {
        this._reverbDelay.delayTime.value = 0.095
      }
      this._reverbWetGain = this.ctx.createGain()
      if (this._reverbWetGain.gain) {
        this._reverbWetGain.gain.value = this.footstepEchoes ? 0.16 : 0
      }

      if (typeof this.ctx.createBiquadFilter === 'function') {
        this._reverbFilter = this.ctx.createBiquadFilter()
        this._reverbFilter.type = 'lowpass'
        if (this._reverbFilter.frequency) this._reverbFilter.frequency.value = 950
        if (this._reverbFilter.Q) this._reverbFilter.Q.value = 0.7
        this._reverbInput.connect(this._reverbDelay)
        this._reverbDelay.connect(this._reverbFilter)
        this._reverbFilter.connect(this._reverbWetGain)
      } else {
        this._reverbInput.connect(this._reverbDelay)
        this._reverbDelay.connect(this._reverbWetGain)
      }
      this._reverbWetGain.connect(this.effectsGain)

      this._playerStepBus = this.ctx.createGain()
      this._playerStepBus.connect(this.effectsGain)
      this._playerStepBus.connect(this._reverbInput)

      // Dedicated corridor reflection tail strictly isolated on ambienceGain (never bleeds to effects)
      this._ambientReverbInput = this.ctx.createGain()
      this._ambientReverbDelay = this.ctx.createDelay(1.0)
      if (this._ambientReverbDelay.delayTime) {
        this._ambientReverbDelay.delayTime.value = 0.165
      }
      this._ambientReverbWetGain = this.ctx.createGain()
      if (this._ambientReverbWetGain.gain) {
        this._ambientReverbWetGain.gain.value = 0.18
      }
      if (typeof this.ctx.createBiquadFilter === 'function') {
        this._ambientReverbFilter = this.ctx.createBiquadFilter()
        this._ambientReverbFilter.type = 'bandpass'
        if (this._ambientReverbFilter.frequency) this._ambientReverbFilter.frequency.value = 620
        if (this._ambientReverbFilter.Q) this._ambientReverbFilter.Q.value = 0.65
        this._ambientReverbInput.connect(this._ambientReverbDelay)
        this._ambientReverbDelay.connect(this._ambientReverbFilter)
        this._ambientReverbFilter.connect(this._ambientReverbWetGain)
      } else {
        this._ambientReverbInput.connect(this._ambientReverbDelay)
        this._ambientReverbDelay.connect(this._ambientReverbWetGain)
      }
      this._ambientReverbWetGain.connect(this.ambienceGain)
    }

    if (typeof this.ctx.createDynamicsCompressor === 'function') {
      this.compressor = this.ctx.createDynamicsCompressor()
      if (this.compressor.threshold) this.compressor.threshold.value = -14
      if (this.compressor.knee) this.compressor.knee.value = 18
      if (this.compressor.ratio) this.compressor.ratio.value = 6
      this.masterGain.connect(this.compressor)
      this.compressor.connect(this.ctx.destination)
    } else {
      this.masterGain.connect(this.ctx.destination)
    }

    this.noiseBuffer = createNoiseBuffer(this.ctx, 2.0)
    this._rainNoiseBuffer = createRainNoiseBuffer(
      this.ctx,
      THUNDERSTORM_RAIN_CONSTANTS.bufferDurationSec
    )
    this._syncBusGains()
  }

  _syncBusGains() {
    if (!this.ctx || !this.masterGain) return
    const now = this.ctx.currentTime || 0
    const masterVal = this.volumes.muted || this.isPaused ? 0 : this.volumes.master
    setGainSmooth(this.masterGain, masterVal, now, 0.025)
    setGainSmooth(this.ambienceGain, this.volumes.ambience, now, 0.03)
    setGainSmooth(this.effectsGain, this.volumes.effects, now, 0.03)
    setGainSmooth(this.musicGain, this.volumes.music, now, 0.03)
    if (this._reverbWetGain) {
      setGainSmooth(this._reverbWetGain, this.footstepEchoes ? 0.16 : 0, now, 0.03)
    }
  }

  getVolumeConfig() {
    return { ...this.volumes }
  }

  setVolume(channel, value) {
    if (this.isDisposed) return this.getVolumeConfig()
    if (channel === 'muted') {
      this.volumes.muted = Boolean(value)
    } else if (channel in this.volumes) {
      this.volumes[channel] = clamp01(value, this.volumes[channel])
    }
    this._syncBusGains()
    return this.getVolumeConfig()
  }

  setVolumes(partial = {}) {
    if (this.isDisposed || !partial || typeof partial !== 'object') {
      return this.getVolumeConfig()
    }
    if ('master' in partial) {
      this.volumes.master = clamp01(partial.master, this.volumes.master)
    }
    if ('ambience' in partial) {
      this.volumes.ambience = clamp01(partial.ambience, this.volumes.ambience)
    }
    if ('effects' in partial) {
      this.volumes.effects = clamp01(partial.effects, this.volumes.effects)
    }
    if ('music' in partial) {
      this.volumes.music = clamp01(partial.music, this.volumes.music)
    }
    if ('muted' in partial) {
      this.volumes.muted = Boolean(partial.muted)
    }
    this._syncBusGains()
    return this.getVolumeConfig()
  }

  setMuted(muted) {
    return this.setVolume('muted', Boolean(muted))
  }

  getEffectiveVolumes() {
    const activeMaster = this.volumes.muted || this.isPaused ? 0 : this.volumes.master
    return {
      master: activeMaster,
      ambience: activeMaster * this.volumes.ambience,
      effects: activeMaster * this.volumes.effects,
      music: activeMaster * this.volumes.music,
      muted: this.volumes.muted,
      isPaused: this.isPaused,
    }
  }

  getAudioOptions() {
    return {
      spatialAudio: this.spatialAudio,
      footstepEchoes: this.footstepEchoes,
    }
  }

  setAudioOptions(partial = {}) {
    if (this.isDisposed || !partial || typeof partial !== 'object') {
      return this.getAudioOptions()
    }
    const prevSpatial = this.spatialAudio
    if ('spatialAudio' in partial) {
      this.spatialAudio = Boolean(partial.spatialAudio)
    }
    if ('footstepEchoes' in partial) {
      this.footstepEchoes = Boolean(partial.footstepEchoes)
    }
    if (this.spatialAudio !== prevSpatial) {
      this._stopCeilingLightVoices()
    }
    this._syncBusGains()
    return this.getAudioOptions()
  }

  getAudioState() {
    return {
      isUnlocked: this.isUnlocked,
      isPaused: this.isPaused,
      isDisposed: this.isDisposed,
      contextState: this.ctx?.state || 'uninitialized',
      musicMood: this._musicMood,
      isHidden: this._isHidden,
      isGameOver: this._isGameOver,
      volumes: this.getVolumeConfig(),
      effectiveVolumes: this.getEffectiveVolumes(),
      spatialAudio: this.spatialAudio,
      footstepEchoes: this.footstepEchoes,
      ceilingLights: this.getCeilingLightAudioState(),
      ambientHorror: this.getAmbientHorrorState(),
      thunder: this.getThunderAudioState(),
      rain: this._thunderstormRainBed?.getState?.() || {
        active: false,
        paused: this.isPaused,
        hidden: this._isHidden,
        ducked: this._rainLastDucked,
        targetGain: 0,
      },
    }
  }

  getThunderAudioState() {
    return {
      enabled: this._desiredThunderActive,
      nextEventInSec: this._thunderEventTimer,
      clockSec: this._thunderClockSec,
      nextCrackAllowedAtSec: this._thunderNextCrackAllowedAtSec,
      lastKind: this._lastThunderKind,
      duckingRain: this._thunderDuckRemainingSec > 0,
      activeCue: this._activeThunderCue
        ? {
            kind: this._activeThunderCue.kind,
            variant: this._activeThunderCue.variant,
            remainingSec: this._activeThunderCue.remainingSec,
          }
        : null,
    }
  }

  getAmbientHorrorState() {
    return {
      nextEventInSec: this._ambientEventTimer,
      clockSec: this._ambientClockSec,
      lastCategory: this._lastAmbientCategory,
      activeCue: this._activeAmbientCue
        ? {
            category: this._activeAmbientCue.category,
            variant: this._activeAmbientCue.variant,
            remainingSec: this._activeAmbientCue.remainingSec,
          }
        : null,
      anchorCounts: {
        vents: this._ambientAnchors.vents.length,
        ducts: this._ambientAnchors.ducts.length,
        corridors: this._ambientAnchors.corridors.length,
      },
    }
  }

  getCeilingLightAudioState() {
    let activeVoiceCount = 0
    for (let i = 0; i < this._lightVoiceAssigned.length; i += 1) {
      if (this._lightVoiceAssigned[i] >= 0) activeVoiceCount += 1
    }
    return {
      poolSize: this._lightVoicePool.length,
      maxVoices: CEILING_LIGHT_AUDIO_CONFIG.maxHumVoices,
      activeVoiceCount,
      assignedFixtures: [...this._lightVoiceAssigned],
      trackedFixtures: this._fixtureAudioState.size,
      lastGlobalSputterAt: this._lastGlobalLightSputterAt,
    }
  }

  _ensureCeilingLightVoicePool() {
    if (
      this.isDisposed ||
      !this.isUnlocked ||
      !this.ctx ||
      !this.effectsGain ||
      this.isPaused ||
      this._isGameOver ||
      this._hasWon
    ) {
      return false
    }
    while (this._lightVoicePool.length < CEILING_LIGHT_AUDIO_CONFIG.maxHumVoices) {
      this._lightVoicePool.push(
        createCeilingLightVoice(this.ctx, this.effectsGain, {
          spatialAudio: this.spatialAudio,
          refDistance: CEILING_LIGHT_AUDIO_CONFIG.humRefDistance,
          maxDistance: CEILING_LIGHT_AUDIO_CONFIG.humMaxDistance,
        })
      )
    }
    return true
  }

  _silenceCeilingLightVoices(tau = 0.03) {
    for (let i = 0; i < this._lightVoicePool.length; i += 1) {
      this._lightVoicePool[i]?.silence?.(tau)
    }
    this._lightVoiceAssigned[0] = -1
    this._lightVoiceAssigned[1] = -1
  }

  _stopCeilingLightVoices() {
    for (let i = 0; i < this._lightVoicePool.length; i += 1) {
      this._lightVoicePool[i]?.stop?.()
    }
    this._lightVoicePool.length = 0
    this._lightVoiceAssigned[0] = -1
    this._lightVoiceAssigned[1] = -1
    this._fixtureAudioState.clear()
    this._lastGlobalLightSputterAt = -10
  }

  _sampleAmbientInitialGrace() {
    const min = Math.max(0.1, Number(this._ambientConfig.initialGraceMinSec) || 5.5)
    const max = Math.max(min, Number(this._ambientConfig.initialGraceMaxSec) || 10.0)
    return min + this._ambientRng() * (max - min)
  }

  _sampleAmbientNextInterval() {
    const min = Math.max(0.2, Number(this._ambientConfig.intervalMinSec) || 9.0)
    const max = Math.max(min, Number(this._ambientConfig.intervalMaxSec) || 19.0)
    let delay = min + this._ambientRng() * (max - min)
    const extraChance = Number(this._ambientConfig.extraSilenceChance) || 0
    if (extraChance > 0 && this._ambientRng() < extraChance) {
      const eMin = Math.max(0, Number(this._ambientConfig.extraSilenceMinSec) || 4.0)
      const eMax = Math.max(eMin, Number(this._ambientConfig.extraSilenceMaxSec) || 8.0)
      delay += eMin + this._ambientRng() * (eMax - eMin)
    }
    return delay
  }

  _scheduleFadeCleanup(fn, delayMs = 50) {
    if (typeof fn !== 'function') return null
    if (this.isDisposed) {
      try {
        fn()
      } catch {
        // Ignore already-cleaned node errors during disposal
      }
      return null
    }
    let done = false
    let timerId = null
    const flush = () => {
      if (done) return
      done = true
      this._pendingFadeCleanups.delete(flush)
      if (timerId !== null) {
        this._cleanupTimers.delete(timerId)
        clearTimeout(timerId)
        timerId = null
      }
      try {
        fn()
      } catch {
        // Ignore already-cleaned node errors
      }
    }
    this._pendingFadeCleanups.add(flush)
    timerId = setTimeout(flush, Math.max(20, Number(delayMs) || 50))
    this._cleanupTimers.add(timerId)
    return flush
  }

  _flushPendingFadeCleanups() {
    if (this._pendingFadeCleanups.size === 0) return
    const pendingFades = Array.from(this._pendingFadeCleanups)
    this._pendingFadeCleanups.clear()
    for (const flush of pendingFades) {
      flush()
    }
  }

  _stopActiveAmbientCues({ immediate = false } = {}) {
    if (!this._activeAmbientCue) return
    const active = this._activeAmbientCue
    this._activeAmbientCue = null
    const shouldImmediate = Boolean(immediate || this.isDisposed)

    if (shouldImmediate) {
      try {
        active.stop?.({ immediate: true })
      } catch {
        // Ignore already-stopped cue errors
      }
      try {
        active.cleanup?.()
      } catch {
        // Ignore already-cleaned destination errors
      }
      return
    }

    try {
      active.stop?.({
        immediate: false,
        delayMs: 50,
        scheduleDisconnect: (disconnectFn, delayMs) => {
          this._scheduleFadeCleanup(disconnectFn, delayMs)
        },
      })
    } catch {
      // Ignore already-stopped cue errors
    }
    if (typeof active.cleanup === 'function') {
      this._scheduleFadeCleanup(active.cleanup, 50)
    }
  }

  _resetAmbientScheduler() {
    this._stopActiveAmbientCues({ immediate: true })
    this._ambientClockSec = 0
    this._ambientEventTimer = this._sampleAmbientInitialGrace()
    this._ambientLastTriggeredAt.clear()
    this._lastAmbientCategory = null
    this._lastAmbientVariantByCategory.clear()
    this._lastStartlingAmbientAt = -100
    this._lastHorrorCueAt = -100
  }

  _sampleThunderInitialGrace() {
    const min = Math.max(0.1, Number(this._thunderConfig.initialGraceMinSec) || 6.0)
    const max = Math.max(min, Number(this._thunderConfig.initialGraceMaxSec) || 11.0)
    return min + this._thunderRng() * (max - min)
  }

  _sampleThunderNextInterval() {
    const min = Math.max(0.2, Number(this._thunderConfig.distantIntervalMinSec) || 16.0)
    const max = Math.max(min, Number(this._thunderConfig.distantIntervalMaxSec) || 36.0)
    return min + this._thunderRng() * (max - min)
  }

  _sampleThunderCrackCooldown() {
    const min = Math.max(0.5, Number(this._thunderConfig.crackCooldownMinSec) || 48.0)
    const max = Math.max(min, Number(this._thunderConfig.crackCooldownMaxSec) || 88.0)
    return min + this._thunderRng() * (max - min)
  }

  _pickThunderVariant(count, lastVariant) {
    if (count <= 1) return 0
    if (lastVariant < 0 || lastVariant >= count) {
      return Math.floor(this._thunderRng() * count) % count
    }
    const pick = Math.floor(this._thunderRng() * (count - 1)) % (count - 1)
    return pick >= lastVariant ? pick + 1 : pick
  }

  _stopActiveThunderCues({ immediate = false } = {}) {
    this._thunderDuckRemainingSec = 0
    if (!this._activeThunderCue) return
    const active = this._activeThunderCue
    this._activeThunderCue = null
    const shouldImmediate = Boolean(immediate || this.isDisposed)

    if (shouldImmediate) {
      try {
        active.stop?.({ immediate: true })
      } catch {
        // Ignore already-stopped thunder cue errors
      }
      return
    }

    try {
      active.stop?.({
        immediate: false,
        delayMs: 100,
        scheduleDisconnect: (disconnectFn, delayMs) => {
          this._scheduleFadeCleanup(disconnectFn, delayMs)
        },
      })
    } catch {
      // Ignore already-stopped thunder cue errors
    }
  }

  _resetThunderScheduler() {
    this._stopActiveThunderCues({ immediate: true })
    this._thunderClockSec = 0
    this._thunderEventTimer = this._sampleThunderInitialGrace()
    this._thunderNextCrackAllowedAtSec = Math.max(
      0,
      Number(this._thunderConfig.minCrackElapsedSec ?? 20.0)
    )
    this._lastThunderKind = null
    this._lastThunderDistantVariant = -1
    this._lastThunderCrackVariant = -1
    this._thunderLastTriggerAtSec = -100
    this._thunderDuckRemainingSec = 0
  }

  _cacheAmbientAnchorsFromMaze(maze, providedAnchors = null) {
    if (providedAnchors && typeof providedAnchors === 'object') {
      this._ambientAnchors = {
        vents: Array.isArray(providedAnchors.vents) ? providedAnchors.vents : [],
        ducts: Array.isArray(providedAnchors.ducts) ? providedAnchors.ducts : [],
        corridors: Array.isArray(providedAnchors.corridors) ? providedAnchors.corridors : [],
      }
      return
    }

    const corridors = []
    if (Array.isArray(maze?.grid)) {
      const rows = maze.grid.length
      const cols = maze.grid[0]?.length || 0
      for (let r = 0; r < rows; r += 1) {
        const rowArr = maze.grid[r]
        if (!rowArr) continue
        for (let c = 0; c < cols; c += 1) {
          if (rowArr[c] === 0) {
            const wp = gridToWorld(r, c, maze)
            if (wp) {
              corridors.push({ x: wp.x, y: 1.4, z: wp.z })
            }
          }
        }
      }
    }
    this._ambientAnchors = { vents: [], ducts: [], corridors }
  }

  setAmbientEnvironmentMetadata(metadata = null) {
    if (this.isDisposed) return
    this._cacheAmbientAnchorsFromMaze(this.maze, metadata)
  }

  setHasWon(won) {
    if (this.isDisposed) return
    this._hasWon = Boolean(won)
    if (this._hasWon) {
      this._stopCeilingLightVoices()
      this._stopActiveAmbientCues({ immediate: true })
      this._stopActiveThunderCues({ immediate: true })
      this._stopActiveSilhouetteAudio({ immediate: true })
      this._stopThunderstormRainBed({ immediate: true })
      this._flushPendingFadeCleanups()
    } else if (this.isUnlocked && !this.isPaused && !this._isGameOver) {
      this._ensureContinuousLayers()
    }
  }

  setPaused(paused) {
    if (this.isDisposed) return
    const nextPaused = Boolean(paused)
    const wasPaused = this.isPaused
    this.isPaused = nextPaused
    this._syncBusGains()

    if (this.isPaused) {
      this._silenceCeilingLightVoices(0.02)
      this._stopActiveAmbientCues()
      this._stopActiveThunderCues({ immediate: false })
      this._stopActiveSilhouetteAudio({ immediate: false })
      this._thunderstormRainBed?.setPaused?.(true)
      this._musicLayer?.setMood?.(MUSIC_MOODS.SILENT)
      if (this.ctx?.state === 'running' && typeof this.ctx.suspend === 'function') {
        try {
          this.ctx.suspend().catch?.(() => {})
        } catch {
          // Ignore suspend errors in restricted contexts
        }
      }
      return
    }

    if (wasPaused) {
      const minResumeDelay = Math.max(0.5, Number(this._ambientConfig.minResumeDelaySec) || 4.0)
      if (this._ambientEventTimer < minResumeDelay) {
        this._ambientEventTimer = minResumeDelay
      }
      const minThunderResumeDelay = Math.max(
        0.5,
        Number(this._thunderConfig.minResumeDelaySec) || 2.5
      )
      if (this._thunderEventTimer < minThunderResumeDelay) {
        this._thunderEventTimer = minThunderResumeDelay
      }
    }

    if (this.isUnlocked && this.ctx) {
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        try {
          this.ctx.resume().catch?.(() => {})
        } catch {
          // Ignore resume errors in restricted contexts
        }
      }
      this._ensureContinuousLayers()
      this._thunderstormRainBed?.setPaused?.(false)
      this._syncBusGains()
      if (this._musicLayer) {
        this._musicLayer.setMood?.(
          this._isGameOver || this._hasWon ? MUSIC_MOODS.SILENT : this._musicMood
        )
      }
    }
  }

  setMaze(maze, ambientAnchors = null) {
    this.maze = maze || null
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()
    this._stopCeilingLightVoices()
    this._resetAmbientScheduler()
    this._resetThunderScheduler()
    this._cacheAmbientAnchorsFromMaze(maze, ambientAnchors)
    this._playerStepTimer = 0
    this._hasWon = false
    this._clearTransientTimers()

    this._rainBreathPhase = 0
    this._rainBreathTimer = 0
    this._rainLastDucked = false
    this._rainContextPayload.hidden = this._isHidden
    this._rainContextPayload.ducked = false
    this._rainContextPayload.breath = 0.5
    const hadRainBed = Boolean(this._thunderstormRainBed)
    if (this.isUnlocked && !this.isPaused && !this._isGameOver) {
      this._ensureContinuousLayers()
    }
    if (hadRainBed) {
      this._thunderstormRainBed?.setContext?.(this._rainContextPayload, 0.42)
    }
    this._thunderstormRainBed?.setPaused?.(Boolean(this.isPaused))

    if (!this._isGameOver && this._musicLayer) {
      this._musicMood = MUSIC_MOODS.AMBIENT
      this._musicLayer.setMood?.(this.isPaused ? MUSIC_MOODS.SILENT : MUSIC_MOODS.AMBIENT)
    }
  }

  reset() {
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()
    this._stopCeilingLightVoices()
    this._resetAmbientScheduler()
    this._resetThunderScheduler()
    this._playerStepTimer = 0
    this._isHidden = false
    this._isGameOver = false
    this._hasWon = false
    this._clearTransientTimers()
    this._ambientBed?.setStealthDucking?.(false)
    this._rainBreathPhase = 0
    this._rainBreathTimer = 0
    this._rainLastHidden = false
    this._rainLastDucked = false
    this._rainContextPayload.hidden = false
    this._rainContextPayload.ducked = false
    this._rainContextPayload.breath = 0.5
    const hadRainBed = Boolean(this._thunderstormRainBed)
    if (this.isUnlocked && !this.isPaused) {
      this._ensureContinuousLayers()
    }
    if (hadRainBed) {
      this._thunderstormRainBed?.setContext?.(this._rainContextPayload, 0.42)
    }
    this._thunderstormRainBed?.setPaused?.(Boolean(this.isPaused))
    this._musicMood = this.isUnlocked ? MUSIC_MOODS.AMBIENT : MUSIC_MOODS.SILENT
    this._musicLayer?.setMood?.(this.isPaused ? MUSIC_MOODS.SILENT : this._musicMood)
  }

  _stopActiveSilhouetteAudio({ immediate = false } = {}) {
    if (this._activeSilhouetteCleanups.size === 0) return
    const entries = Array.from(this._activeSilhouetteCleanups)
    this._activeSilhouetteCleanups.clear()
    const shouldImmediate = Boolean(immediate || this.isDisposed)

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (!entry) continue
      if (shouldImmediate) {
        try {
          entry.stop?.({ immediate: true })
        } catch {
          // Ignore already-stopped silhouette node errors
        }
        try {
          entry.cleanup?.()
        } catch {
          // Ignore already-cleaned silhouette positional destination errors
        }
      } else {
        try {
          entry.stop?.({
            immediate: false,
            delayMs: 50,
            scheduleDisconnect: (disconnectFn, delayMs) => {
              this._scheduleFadeCleanup(disconnectFn, delayMs)
            },
          })
        } catch {
          // Ignore already-stopped silhouette node errors
        }
        if (typeof entry.cleanup === 'function') {
          this._scheduleFadeCleanup(entry.cleanup, 50)
        }
      }
    }
  }

  _clearTransientTimers() {
    this._stopActiveSilhouetteAudio({ immediate: true })
    for (const id of this._cleanupTimers) {
      clearTimeout(id)
    }
    this._cleanupTimers.clear()
    this._flushPendingFadeCleanups()
    if (this._activePositionalCleanups.size > 0) {
      const pending = Array.from(this._activePositionalCleanups)
      this._activePositionalCleanups.clear()
      for (const cleanup of pending) {
        cleanup()
      }
    }
  }

  _recordCue(type, meta = {}) {
    if (!this._debugHistoryEnabled) return
    this._lastCueLog.push({ type, time: this._elapsedSec, ...meta })
    if (this._lastCueLog.length > 64) {
      this._lastCueLog.shift()
    }
  }

  getCueHistory() {
    return [...this._lastCueLog]
  }

  clearCueHistory() {
    this._lastCueLog.length = 0
  }

  /**
   * Updates Web Audio listener orientation & position to match the 3D camera.
   */
  updateListener(cameraOrPos, forwardVec = null, upVec = null) {
    if (!cameraOrPos) return

    const pos = cameraOrPos.position || cameraOrPos
    this._listenerPos.x = Number(pos.x) || 0
    this._listenerPos.y = Number.isFinite(pos.y) ? pos.y : 1.65
    this._listenerPos.z = Number(pos.z) || 0

    if (forwardVec) {
      this._listenerForward.x = Number(forwardVec.x) || 0
      this._listenerForward.y = Number(forwardVec.y) || 0
      this._listenerForward.z = Number(forwardVec.z) || -1
    } else if (cameraOrPos.quaternion) {
      const q = cameraOrPos.quaternion
      const x = q.x, y = q.y, z = q.z, w = q.w
      this._listenerForward.x = -(2 * (x * z + w * y))
      this._listenerForward.y = -(2 * (y * z - w * x))
      this._listenerForward.z = -(1 - 2 * (x * x + y * y))
    }

    if (upVec) {
      this._listenerUp.x = Number(upVec.x) || 0
      this._listenerUp.y = Number(upVec.y) || 1
      this._listenerUp.z = Number(upVec.z) || 0
    } else if (cameraOrPos.quaternion) {
      const q = cameraOrPos.quaternion
      const x = q.x, y = q.y, z = q.z, w = q.w
      this._listenerUp.x = 2 * (x * y - w * z)
      this._listenerUp.y = 1 - 2 * (x * x + z * z)
      this._listenerUp.z = 2 * (y * z + w * x)
    }

    const listener = this.ctx?.listener
    if (!listener) return

    const now = this.ctx.currentTime || 0
    if (listener.positionX) {
      setGainSmooth({ gain: listener.positionX }, this._listenerPos.x, now, 0.015)
      setGainSmooth({ gain: listener.positionY }, this._listenerPos.y, now, 0.015)
      setGainSmooth({ gain: listener.positionZ }, this._listenerPos.z, now, 0.015)
      setGainSmooth({ gain: listener.forwardX }, this._listenerForward.x, now, 0.015)
      setGainSmooth({ gain: listener.forwardY }, this._listenerForward.y, now, 0.015)
      setGainSmooth({ gain: listener.forwardZ }, this._listenerForward.z, now, 0.015)
      setGainSmooth({ gain: listener.upX }, this._listenerUp.x, now, 0.015)
      setGainSmooth({ gain: listener.upY }, this._listenerUp.y, now, 0.015)
      setGainSmooth({ gain: listener.upZ }, this._listenerUp.z, now, 0.015)
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(this._listenerPos.x, this._listenerPos.y, this._listenerPos.z)
      listener.setOrientation?.(
        this._listenerForward.x,
        this._listenerForward.y,
        this._listenerForward.z,
        this._listenerUp.x,
        this._listenerUp.y,
        this._listenerUp.z
      )
    }
  }

  /**
   * Creates a spatialized (Panner + Occlusion Filter + Attenuation Gain) node chain
   * attached to `effectsGain` and schedules leak-free cleanup. Returns `null` if out
   * of audible range or audio context is not yet unlocked.
   */
  _createPositionalDestination(worldPos, options = {}) {
    const attenuation = computeSpatialAudioAttenuation(
      worldPos,
      this._listenerPos,
      this.maze,
      options
    )
    if (attenuation.gain <= 0.005) {
      return { dest: null, attenuation, cleanup: () => {}, timerId: null }
    }

    const targetBus = options.targetBus || this.effectsGain
    if (!this.isUnlocked || !this.ctx || !targetBus || this.isPaused) {
      return { dest: null, attenuation, cleanup: () => {}, timerId: null }
    }

    const now = this.ctx.currentTime || 0
    const attGain = this.ctx.createGain()
    if (attGain.gain) {
      attGain.gain.setValueAtTime?.(attenuation.gain, now)
    }

    let tail = attGain
    let filter = null
    if (typeof this.ctx.createBiquadFilter === 'function' && attenuation.wallCount > 0) {
      filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency?.setValueAtTime?.(attenuation.lowpassCutoff, now)
      tail.connect(filter)
      tail = filter
    }

    let panner = null
    if (this.spatialAudio && typeof this.ctx.createPanner === 'function') {
      panner = this.ctx.createPanner()
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'linear'
      panner.refDistance = options.refDistance || 1.8
      panner.maxDistance = options.maxDistance || 22.0
      panner.rolloffFactor = 0 // Distance gain already accounts for wall occlusion + taper
      if (panner.positionX) {
        panner.positionX.setValueAtTime?.(Number(worldPos.x) || 0, now)
        panner.positionY.setValueAtTime?.(Number(worldPos.y) || 0, now)
        panner.positionZ.setValueAtTime?.(Number(worldPos.z) || 0, now)
      } else {
        panner.setPosition?.(
          Number(worldPos.x) || 0,
          Number(worldPos.y) || 0,
          Number(worldPos.z) || 0
        )
      }
      tail.connect(panner)
      panner.connect(targetBus)
    } else {
      tail.connect(targetBus)
    }

    const reverbTarget =
      options.reverbSend !== undefined
        ? options.reverbSend
        : options.sendToReverb !== false
          ? this._reverbInput
          : null
    if (reverbTarget) {
      tail.connect(reverbTarget)
    }

    const ttlMs = Math.max(250, Number(options.ttlMs) || 1200)
    let cleaned = false
    let timerId = null
    const onCleanup = typeof options?.onCleanup === 'function' ? options.onCleanup : null
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      this._activePositionalCleanups.delete(cleanup)
      onCleanup?.()
      if (timerId !== null) {
        this._cleanupTimers.delete(timerId)
        clearTimeout(timerId)
      }
      try {
        attGain.disconnect()
        filter?.disconnect()
        panner?.disconnect()
      } catch {
        // Ignore already-disconnected errors
      }
    }
    this._activePositionalCleanups.add(cleanup)
    timerId = setTimeout(() => {
      cleanup()
    }, ttlMs)
    this._cleanupTimers.add(timerId)

    return { dest: attGain, attenuation, cleanup, timerId }
  }

  onHidingSpotTransition(action, worldPos) {
    if (this.isDisposed) return
    this._isHidden = action === 'enter'
    this._ambientBed?.setStealthDucking?.(this._isHidden)
    this._rainLastHidden = this._isHidden
    if (this._thunderstormRainBed) {
      this._rainContextPayload.hidden = this._isHidden
      this._thunderstormRainBed.setContext?.(this._rainContextPayload, 0.24)
    }

    const { dest, attenuation } = this._createPositionalDestination(
      worldPos || this._listenerPos,
      { maxDistance: 12, ttlMs: 800 }
    )
    this._recordCue(`hiding_${action}`, { gain: attenuation.gain })
    if (dest) {
      triggerHidingSpotCue(this.ctx, dest, this.noiseBuffer, action)
    }
  }

  onFlashlightToggle(active) {
    if (this.isDisposed) return
    this._recordCue('flashlight_toggle', { active })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) return
    triggerFlashlightCue(this.ctx, this.effectsGain, this.noiseBuffer, active)
  }

  onStaminaWarning(type = 'breathing') {
    if (this.isDisposed || this.isPaused) return
    if (!this.isUnlocked || !this.ctx || !this.effectsGain) return
    triggerStaminaWarningCue(this.ctx, this.effectsGain, this.noiseBuffer, type)
  }

  onPlayerDamage() {
    if (this.isDisposed) return
    this._recordCue('player_damage', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) return
    triggerPlayerDamageCue(this.ctx, this.effectsGain, this.noiseBuffer)
  }

  onGameOver() {
    if (this.isDisposed) return
    this._isGameOver = true
    this._isHidden = false
    this._stopCeilingLightVoices()
    this._stopActiveAmbientCues({ immediate: true })
    this._stopActiveThunderCues({ immediate: true })
    this._stopActiveSilhouetteAudio({ immediate: true })
    this._stopThunderstormRainBed({ immediate: true })
    this._flushPendingFadeCleanups()
    this._ambientBed?.setStealthDucking?.(false)
    this._musicMood = MUSIC_MOODS.SILENT
    this._musicLayer?.setMood?.(MUSIC_MOODS.SILENT)

    this._recordCue('game_over', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) return
    triggerGameOverCue(this.ctx, this.effectsGain, this.noiseBuffer)
  }

  onCoinPickup(coinsGained = 1) {
    if (this.isDisposed || this._isGameOver) return false
    const count = Math.max(1, Number(coinsGained) || 1)
    this._recordCue('coin_collected', { coinsGained: count })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerCoinPickupCue(this.ctx, this.effectsGain, count)
    return true
  }

  onPowerUpPickup(powerUpType = 'wall_pass') {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('powerup_collected', { powerUpType })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerPowerUpPickupCue(this.ctx, this.effectsGain, powerUpType)
    return true
  }

  onAbilityActivate(abilityType = 'wall_pass_armed') {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('ability_activate', { abilityType })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerAbilityActivateCue(this.ctx, this.effectsGain, this.noiseBuffer, abilityType)
    return true
  }

  onExitVictory() {
    if (this.isDisposed || this._isGameOver) return false
    this._hasWon = true
    this._isHidden = false
    this._stopCeilingLightVoices()
    this._stopActiveAmbientCues({ immediate: true })
    this._stopActiveThunderCues({ immediate: true })
    this._stopActiveSilhouetteAudio({ immediate: true })
    this._stopThunderstormRainBed({ immediate: true })
    this._flushPendingFadeCleanups()
    this._ambientBed?.setStealthDucking?.(false)
    this._musicMood = MUSIC_MOODS.SILENT
    this._musicLayer?.setMood?.(MUSIC_MOODS.SILENT)

    this._recordCue('exit_victory', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerExitVictoryCue(this.ctx, this.effectsGain)
    return true
  }

  onKeycardPickup(keysCollected = 1, totalKeys = 1) {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('keycard_collected', { keysCollected, totalKeys })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerKeycardPickupCue(this.ctx, this.effectsGain, keysCollected, totalKeys)
    return true
  }

  onGateUnlocked() {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('gate_unlocked', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerGateUnlockCue(this.ctx, this.effectsGain, this.noiseBuffer)
    return true
  }

  onLockedExit() {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('locked_exit', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerLockedExitCue(this.ctx, this.effectsGain)
    return true
  }

  /**
   * Handles discrete reducer `lastEvent` objects with strict ID deduplication so
   * collectibles, power-up abilities, keycards, gate unlocks, and exit chimes never trigger twice per event.
   */
  handleGameEvent(event) {
    if (this.isDisposed || !event || typeof event !== 'object') return false

    if (event.id !== undefined && event.id !== null) {
      if (event.id === this._lastGameEventId) {
        return false
      }
      this._lastGameEventId = event.id
    }

    switch (event.type) {
      case 'coin_collected':
        return this.onCoinPickup(event.coinsGained || 1)

      case 'powerup_collected': {
        const playedPu = this.onPowerUpPickup(event.powerUpType || 'wall_pass')
        if ((event.coinsGained || 0) > 0) {
          this.onCoinPickup(event.coinsGained)
        }
        return playedPu
      }

      case 'keycard_collected':
        return this.onKeycardPickup(event.keysCollected || 1, event.totalKeys || 1)

      case 'gate_unlocked': {
        if (event.keycard) {
          this.onKeycardPickup(event.keysCollected || 1, event.totalKeys || 1)
        }
        return this.onGateUnlocked()
      }

      case 'locked_exit':
        return this.onLockedExit()

      case 'wall_pass_armed':
      case 'wall_pass_used':
      case 'echo_reveal_activated':
        return this.onAbilityActivate(event.type)

      case 'coin_magnet_activated': {
        const playedMag = this.onAbilityActivate('coin_magnet_activated')
        if ((event.coinsGained || 0) > 0) {
          this.onCoinPickup(event.coinsGained)
        }
        return playedMag
      }

      case 'exit':
        return this.onExitVictory()

      default:
        return false
    }
  }

  /**
   * Plays a HorrorDirector scare/tension cue. Positional events (environmental disturbances,
   * distant silhouettes) route through distance + wall occlusion; presence warnings and light
   * events play non-directionally so exact enemy positions are never leaked.
   */
  playHorrorDirectorCue(eventType, worldPos = null, meta = {}) {
    if (this.isDisposed || this._isGameOver || this._hasWon || this.isPaused) return false

    this._lastHorrorCueAt = this._elapsedSec
    this._stopActiveAmbientCues()
    this._stopActiveThunderCues({ immediate: false })

    if (eventType === 'distant_silhouette') {
      this._stopActiveSilhouetteAudio({ immediate: false })
    }

    const isPositional =
      (eventType === 'environmental_sound' || eventType === 'distant_silhouette') &&
      worldPos &&
      Number.isFinite(worldPos.x) &&
      Number.isFinite(worldPos.z)

    let dest = null
    let attenuation = { gain: 1, wallCount: 0 }
    let silhouetteEntry = null

    if (isPositional) {
      const spatial = this._createPositionalDestination(worldPos, {
        maxDistance: 24,
        ttlMs: eventType === 'distant_silhouette' ? 1950 : 1400,
        onCleanup: () => {
          if (silhouetteEntry) {
            this._activeSilhouetteCleanups.delete(silhouetteEntry)
          }
        },
      })
      dest = spatial.dest
      attenuation = spatial.attenuation
      if (eventType === 'distant_silhouette' && dest) {
        silhouetteEntry = {
          cleanup: spatial.cleanup,
          stop: null,
        }
      }
    } else if (this.isUnlocked && this.ctx && this.effectsGain) {
      dest = this.effectsGain
    }

    this._recordCue(`director_${eventType}`, {
      gain: attenuation.gain,
      wallCount: attenuation.wallCount,
      variant: meta?.variant ?? 0,
      beat: meta?.beat ?? 1,
      positional: isPositional,
    })

    if (!dest || !this.isUnlocked || !this.ctx) {
      return false
    }

    if (eventType === 'environmental_sound') {
      triggerEnvironmentalDisturbanceCue(this.ctx, dest, this.noiseBuffer, meta?.variant || 0)
      return true
    }
    if (eventType === 'distant_silhouette') {
      const handle = triggerSilhouetteStingCue(this.ctx, dest, this.noiseBuffer)
      if (silhouetteEntry) {
        silhouetteEntry.stop = handle?.stop || null
        this._activeSilhouetteCleanups.add(silhouetteEntry)
      }
      return true
    }
    if (eventType === 'light_flicker' || eventType === 'blackout') {
      triggerLightFailureCue(this.ctx, dest, this.noiseBuffer, eventType === 'blackout')
      return true
    }
    if (eventType === 'presence_warning') {
      triggerPresenceWarningCue(this.ctx, dest, this.noiseBuffer, meta?.tension ?? 0.6)
      return true
    }
    if (eventType === 'scripted_scare') {
      triggerScriptedScareCue(this.ctx, dest, this.noiseBuffer, meta?.beat ?? 1)
      return true
    }

    return false
  }

  /**
   * Main per-frame update driven inside MazeSceneEngine.tick() (outside React state).
   * Monitors discrete state transitions on enemies and hazards without re-triggering
   * cues across consecutive frames in the same state.
   */
  update(delta = 0.016, context = {}) {
    if (this.isDisposed || !Number.isFinite(delta) || delta <= 0) return

    this._elapsedSec += delta
    if (context.isHidden !== undefined) {
      this._isHidden = Boolean(context.isHidden)
    }
    if (context.isGameOver !== undefined) {
      this._isGameOver = Boolean(context.isGameOver)
    }
    if (context.hasWon !== undefined) {
      const nextWon = Boolean(context.hasWon)
      if (nextWon && !this._hasWon) {
        this.setHasWon(true)
      } else if (!nextWon) {
        this._hasWon = false
      }
    }

    if (context.camera) {
      this.updateListener(context.camera)
    } else if (context.playerWorldPos) {
      this._tmpListenerPos.x = context.playerWorldPos.x
      this._tmpListenerPos.y = 1.65
      this._tmpListenerPos.z = context.playerWorldPos.z
      this.updateListener(this._tmpListenerPos)
    }

    if (this._isGameOver || this._hasWon || this.isPaused) {
      this._silenceCeilingLightVoices(0.025)
      this._stopActiveAmbientCues()
      if (this._isGameOver || this._hasWon) {
        this._stopActiveThunderCues({ immediate: true })
        this._stopThunderstormRainBed({ immediate: true })
      } else {
        this._stopActiveThunderCues({ immediate: false })
        this._thunderstormRainBed?.setPaused?.(true)
      }
      if (this._musicMood !== MUSIC_MOODS.SILENT) {
        this._musicMood = MUSIC_MOODS.SILENT
        this._musicLayer?.setMood?.(MUSIC_MOODS.SILENT)
      }
      return
    }

    this._ambientBed?.setStealthDucking?.(this._isHidden)

    // 1. Player footsteps (paused when hidden)
    const motion = context.playerMotion
    if (motion?.moved && !this._isHidden) {
      const interval = motion.isSprinting ? 0.31 : 0.48
      this._playerStepTimer += delta
      if (this._playerStepTimer >= interval) {
        this._playerStepTimer -= interval
        this._recordCue('player_footstep', { sprinting: Boolean(motion.isSprinting) })
        if (this.isUnlocked && this.ctx && this.effectsGain) {
          triggerPlayerFootstep(
            this.ctx,
            this._playerStepBus || this.effectsGain,
            this.noiseBuffer,
            Boolean(motion.isSprinting)
          )
        }
      }
    } else {
      this._playerStepTimer = 0.25
    }

    // 2. Enemy state cues, footsteps, and adaptive chase music evaluation
    let anyChaseOrAttack = false
    let anyInvestigateOrClose = false
    let nearestEnemyDist = Infinity
    const enemies = context.enemies
    this._ambientEnemyList.length = 0

    if (enemies) {
      for (const enemy of enemies) {
        if (!enemy || enemy.isDisposed) continue
        this._ambientEnemyList.push(enemy)
        const enemyId = enemy.id
        const enemyType = enemy.type || 'stalker'
        const state = enemy.state
        const worldPos = enemy.worldPos

        let tracker = this._enemyStateMap.get(enemyId)
        if (!tracker) {
          tracker = {
            lastState: state,
            stepTimer: 0,
            lastAlertAt: -10,
            lastAttackAt: -10,
          }
          this._enemyStateMap.set(enemyId, tracker)
        }

        if (worldPos) {
          const d = Math.hypot(
            worldPos.x - this._listenerPos.x,
            worldPos.z - this._listenerPos.z
          )
          if (d < nearestEnemyDist) nearestEnemyDist = d
        }

        if (state === 'chase' || state === 'attack') {
          anyChaseOrAttack = true
        } else if (state === 'investigate' || state === 'search') {
          anyInvestigateOrClose = true
        }

        // Edge-triggered state transition cues (never restarted every frame)
        if (state !== tracker.lastState) {
          if (state === 'chase' && this._elapsedSec - tracker.lastAlertAt >= 2.0) {
            tracker.lastAlertAt = this._elapsedSec
            const { dest, attenuation } = this._createPositionalDestination(worldPos, {
              maxDistance: 24,
              ttlMs: 900,
            })
            this._recordCue('enemy_detect_chase', {
              enemyId,
              enemyType,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) triggerEnemyAlertCue(this.ctx, dest, true, enemyType)
          } else if (
            state === 'investigate' &&
            (tracker.lastState === 'patrol' || tracker.lastState === 'idle') &&
            this._elapsedSec - tracker.lastAlertAt >= 2.4
          ) {
            tracker.lastAlertAt = this._elapsedSec
            const { dest, attenuation } = this._createPositionalDestination(worldPos, {
              maxDistance: 20,
              ttlMs: 700,
            })
            this._recordCue('enemy_detect_investigate', {
              enemyId,
              enemyType,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) triggerEnemyAlertCue(this.ctx, dest, false, enemyType)
          } else if (
            state === 'attack' &&
            this._elapsedSec - tracker.lastAttackAt >= 0.4
          ) {
            tracker.lastAttackAt = this._elapsedSec
            const { dest, attenuation } = this._createPositionalDestination(worldPos, {
              maxDistance: 16,
              ttlMs: 700,
            })
            this._recordCue('enemy_attack_windup', {
              enemyId,
              enemyType,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) triggerEnemyAttackCue(this.ctx, dest, this.noiseBuffer, false, enemyType)
          }

          tracker.lastState = state
        }

        // Positional enemy footsteps while patrolling, investigating, or chasing
        if (state === 'patrol' || state === 'investigate' || state === 'chase') {
          const isChasing = state === 'chase'
          const stepPeriod =
            enemyType === 'brute'
              ? isChasing
                ? 0.42
                : state === 'investigate'
                  ? 0.62
                  : 0.78
              : enemyType === 'hunter'
                ? isChasing
                  ? 0.22
                  : state === 'investigate'
                    ? 0.3
                    : 0.42
                : isChasing
                  ? 0.28
                  : state === 'investigate'
                    ? 0.42
                    : 0.56
          tracker.stepTimer += delta
          if (tracker.stepTimer >= stepPeriod) {
            tracker.stepTimer -= stepPeriod
            const { dest, attenuation } = this._createPositionalDestination(worldPos, {
              refDistance: 2.2,
              maxDistance: isChasing ? 24 : 18,
              rolloff: 1.25,
              wallAttBase: 0.62,
              minOcclusionGain: 0.16,
              initialBlockedCutoff: 1650,
              minLowpassCutoff: 480,
              ttlMs: 500,
            })
            this._recordCue('enemy_footstep', {
              enemyId,
              enemyType,
              isChasing,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) {
              triggerEnemyFootstep(this.ctx, dest, this.noiseBuffer, isChasing, enemyType)
            }
          }
        }
      }
    }

    // Discrete attack hits
    if (context.attackHits?.length > 0) {
      for (let i = 0; i < context.attackHits.length; i += 1) {
        const hit = context.attackHits[i]
        const hitType = hit.enemyType || 'stalker'
        const { dest, attenuation } = this._createPositionalDestination(
          hit.position || this._listenerPos,
          { maxDistance: 16, ttlMs: 600 }
        )
        this._recordCue('enemy_attack_hit', {
          enemyId: hit.enemyId,
          enemyType: hitType,
          gain: attenuation.gain,
        })
        if (dest) {
          triggerEnemyAttackCue(this.ctx, dest, this.noiseBuffer, true, hitType)
        }
      }
    }

    // 4. Environmental hazards positional state-change cues
    const hazards = context.hazards
    if (hazards) {
      for (const hazard of hazards) {
        if (!hazard || hazard.isDisposed) continue
        const prevState = this._hazardStateMap.get(hazard.id)
        const nextState = hazard.state
        if (prevState !== undefined && nextState !== prevState) {
          if (nextState === 'warning' || nextState === 'active') {
            const { dest, attenuation } = this._createPositionalDestination(hazard.worldPos, {
              maxDistance: 18,
              ttlMs: 800,
            })
            this._recordCue(`hazard_${hazard.type}_${nextState}`, {
              hazardId: hazard.id,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) {
              triggerHazardCue(this.ctx, dest, this.noiseBuffer, hazard.type, nextState)
            }
          }
        }
        this._hazardStateMap.set(hazard.id, nextState)
      }
    }

    // 4b. Overhead industrial ceiling light ballast hum & synchronized flicker SFX
    if (context.ceilingLightsGroup) {
      this.updateCeilingLights(context.ceilingLightsGroup, context)
    }

    // 4c. Unified procedural ambient horror scheduler (calm, spatialized, context-aware)
    this._updateAmbientHorror(delta, context, anyChaseOrAttack, anyInvestigateOrClose, nearestEnemyDist)

    // 4d. Independent procedural distant thunder & lightning crack scheduler
    this._updateThunderAtmosphere(delta, context, anyChaseOrAttack)

    // 4e. Continuous outdoor rainfall bed contextual ducking & subtle breath drift
    this._updateRainAtmosphere(delta, context, anyChaseOrAttack)

    // 5. Adaptive chase / tension / ambient music mood transition (edge-driven)
    const desiredMood = anyChaseOrAttack
      ? MUSIC_MOODS.CHASE
      : anyInvestigateOrClose
        ? MUSIC_MOODS.TENSION
        : MUSIC_MOODS.AMBIENT

    if (desiredMood !== this._musicMood) {
      this._musicMood = desiredMood
      this._musicLayer?.setMood?.(desiredMood)
      this._recordCue('music_mood_change', { mood: desiredMood })
    }
    this._musicLayer?.tick?.(delta)
  }

  _updateRainAtmosphere(delta, context, anyChaseOrAttack) {
    if (
      this.isDisposed ||
      !this.isUnlocked ||
      !this.ctx ||
      !this.ambienceGain ||
      this.isPaused ||
      this._isGameOver ||
      this._hasWon ||
      !this._thunderstormRainBed
    ) {
      return
    }

    const activeHorrorType =
      context.activeHorrorEventType ?? context.horrorState?.activeEvent?.type ?? null
    const lightScale = Number.isFinite(context.lightScale)
      ? context.lightScale
      : Number.isFinite(context.ceilingLightsGroup?.userData?.currentLightScale)
        ? context.ceilingLightsGroup.userData.currentLightScale
        : 1
    const isBlackout = activeHorrorType === 'blackout' || lightScale < 0.45
    const isHorrorBusy =
      Boolean(activeHorrorType) ||
      this._elapsedSec - this._lastHorrorCueAt < this._ambientConfig.busyHorrorGraceSec
    const isThunderDucking = this._thunderDuckRemainingSec > 0
    const isDucked = Boolean(anyChaseOrAttack || isBlackout || isHorrorBusy || isThunderDucking)
    const isReduced = Boolean(context.reducedMotion)
    const isAudible =
      !this.volumes.muted && this.volumes.master > 0.001 && this.volumes.ambience > 0.001

    let breathTick = false
    if (isAudible && !isReduced && !this._isHidden && !isDucked) {
      this._rainBreathTimer += delta
      if (this._rainBreathTimer >= 1.8) {
        this._rainBreathTimer %= 1.8
        this._rainBreathPhase = (this._rainBreathPhase + 0.65) % (Math.PI * 2)
        breathTick = true
      }
    } else {
      this._rainBreathTimer = 0
    }

    const hiddenChanged = this._isHidden !== this._rainLastHidden
    const duckedChanged = isDucked !== this._rainLastDucked
    const reducedChanged = isReduced !== this._rainLastReducedMotion

    if (hiddenChanged || duckedChanged || reducedChanged || breathTick) {
      const enteringDuckOrHide =
        (isDucked && !this._rainLastDucked) || (this._isHidden && !this._rainLastHidden)

      this._rainLastHidden = this._isHidden
      this._rainLastDucked = isDucked
      this._rainLastReducedMotion = isReduced

      this._rainContextPayload.hidden = this._isHidden
      this._rainContextPayload.ducked = isDucked
      this._rainContextPayload.reducedMotion = isReduced
      this._rainContextPayload.breath = isReduced
        ? 0.5
        : 0.5 + 0.5 * Math.sin(this._rainBreathPhase)

      const tau = enteringDuckOrHide
        ? 0.16
        : duckedChanged || hiddenChanged
          ? 0.48
          : 0.9
      this._thunderstormRainBed.setContext?.(this._rainContextPayload, tau)
    }
  }

  _updateThunderAtmosphere(delta, context, anyChaseOrAttack) {
    if (this._activeThunderCue) {
      this._activeThunderCue.remainingSec -= delta
      if (this._activeThunderCue.remainingSec <= 0) {
        this._activeThunderCue = null
      }
    }
    if (this._thunderDuckRemainingSec > 0) {
      this._thunderDuckRemainingSec = Math.max(0, this._thunderDuckRemainingSec - delta)
    }

    if (
      !this._desiredThunderActive ||
      this.isDisposed ||
      !this.isUnlocked ||
      !this.ctx ||
      !this.ambienceGain ||
      this.isPaused ||
      this._isGameOver ||
      this._hasWon
    ) {
      return
    }

    this._thunderClockSec += delta

    const activeHorrorType =
      context.activeHorrorEventType ?? context.horrorState?.activeEvent?.type ?? null
    const lightScale = Number.isFinite(context.lightScale)
      ? context.lightScale
      : Number.isFinite(context.ceilingLightsGroup?.userData?.currentLightScale)
        ? context.ceilingLightsGroup.userData.currentLightScale
        : 1
    const isBlackout = activeHorrorType === 'blackout' || lightScale < 0.45
    const isHorrorBusy =
      Boolean(activeHorrorType) ||
      this._elapsedSec - this._lastHorrorCueAt < this._thunderConfig.busyHorrorGraceSec
    const isSuppressed = Boolean(anyChaseOrAttack || isBlackout || isHorrorBusy)

    if (isSuppressed) {
      this._stopActiveThunderCues({ immediate: false })
      const minDefer = Math.max(0.5, Number(this._thunderConfig.suppressionDeferralMinSec) || 2.0)
      if (this._thunderEventTimer < minDefer) {
        const maxDefer = Math.max(
          minDefer,
          Number(this._thunderConfig.suppressionDeferralMaxSec) || 4.5
        )
        this._thunderEventTimer = minDefer + this._thunderRng() * (maxDefer - minDefer)
      }
      return
    }

    const isReduced = Boolean(context.reducedMotion)
    if (isReduced && this._activeThunderCue?.kind === 'crack') {
      this._stopActiveThunderCues({ immediate: false })
    }

    if (this._activeThunderCue) {
      return
    }

    this._thunderEventTimer -= delta
    if (this._thunderEventTimer > 0) {
      return
    }

    this._thunderEventTimer = this._sampleThunderNextInterval()

    if (
      this.volumes.muted ||
      this.volumes.master <= 0.001 ||
      this.volumes.ambience <= 0.001
    ) {
      return
    }

    const thunderBuffer = this._rainNoiseBuffer || this.noiseBuffer
    if (!thunderBuffer) {
      return
    }

    const minCrackElapsed = Math.max(0, Number(this._thunderConfig.minCrackElapsedSec ?? 20.0))
    const canCrack =
      !isReduced &&
      !this._activeAmbientCue?.isStartling &&
      this._elapsedSec - this._lastGlobalLightSputterAt >= 1.0 &&
      this._thunderClockSec >= minCrackElapsed &&
      this._thunderClockSec >= this._thunderNextCrackAllowedAtSec
    const crackChance = Math.max(
      0,
      Math.min(1, Number(this._thunderConfig.crackChanceWhenReady ?? 0.38))
    )
    const triggerCrack = canCrack && this._thunderRng() < crackChance

    let cueHandle
    let chosenVariant

    if (triggerCrack) {
      chosenVariant = this._pickThunderVariant(3, this._lastThunderCrackVariant)
      cueHandle = triggerLightningCrackCue(this.ctx, this.ambienceGain, thunderBuffer, {
        variant: chosenVariant,
        intensity: 0.88 + this._thunderRng() * 0.12,
        random: this._thunderRng,
      })
    } else {
      chosenVariant = this._pickThunderVariant(4, this._lastThunderDistantVariant)
      cueHandle = triggerDistantThunderCue(this.ctx, this.ambienceGain, thunderBuffer, {
        variant: chosenVariant,
        intensity: 0.86 + this._thunderRng() * 0.14,
        reducedMotion: isReduced,
        random: this._thunderRng,
      })
    }

    if (!cueHandle || cueHandle.durationSec <= 0) {
      return
    }

    this._lastThunderKind = triggerCrack ? 'crack' : 'distant'
    this._thunderLastTriggerAtSec = this._thunderClockSec
    if (triggerCrack) {
      this._lastThunderCrackVariant = chosenVariant
      this._thunderNextCrackAllowedAtSec =
        this._thunderClockSec + this._sampleThunderCrackCooldown()
      const duckHold = Math.max(0.5, Number(this._thunderConfig.rainDuckHoldSec) || 2.6)
      this._thunderDuckRemainingSec = Math.min(cueHandle.durationSec, duckHold)
    } else {
      this._lastThunderDistantVariant = chosenVariant
      this._thunderDuckRemainingSec = 0
    }

    this._activeThunderCue = {
      kind: this._lastThunderKind,
      variant: chosenVariant,
      remainingSec: cueHandle.durationSec,
      stop: cueHandle.stop,
    }

    this._recordCue(triggerCrack ? 'thunder_crack' : 'thunder_distant', {
      kind: this._lastThunderKind,
      variant: chosenVariant,
      durationSec: cueHandle.durationSec,
      reducedMotion: isReduced,
      isHidden: this._isHidden,
    })
  }

  _updateAmbientHorror(delta, context, anyChaseOrAttack, anyInvestigateOrClose, nearestEnemyDist) {
    if (this._activeAmbientCue) {
      this._activeAmbientCue.remainingSec -= delta
      if (this._activeAmbientCue.remainingSec <= 0) {
        this._activeAmbientCue = null
      }
    }

    if (
      this.isDisposed ||
      !this.isUnlocked ||
      !this.ctx ||
      !this.ambienceGain ||
      this.isPaused ||
      this._isGameOver ||
      this._hasWon
    ) {
      return
    }

    this._ambientClockSec += delta

    const activeHorrorType =
      context.activeHorrorEventType ?? context.horrorState?.activeEvent?.type ?? null
    const lightScale = Number.isFinite(context.lightScale)
      ? context.lightScale
      : Number.isFinite(context.ceilingLightsGroup?.userData?.currentLightScale)
        ? context.ceilingLightsGroup.userData.currentLightScale
        : 1
    const isBlackout = activeHorrorType === 'blackout' || lightScale < 0.45
    const isHorrorBusy =
      Boolean(activeHorrorType) ||
      this._elapsedSec - this._lastHorrorCueAt < this._ambientConfig.busyHorrorGraceSec
    const isSuppressed = Boolean(anyChaseOrAttack || isBlackout || isHorrorBusy)

    if (isSuppressed) {
      this._stopActiveAmbientCues()
      const minDefer = Math.max(0.5, Number(this._ambientConfig.suppressionDeferralMinSec) || 1.5)
      if (this._ambientEventTimer < minDefer) {
        const maxDefer = Math.max(
          minDefer,
          Number(this._ambientConfig.suppressionDeferralMaxSec) || 3.2
        )
        this._ambientEventTimer = minDefer + this._ambientRng() * (maxDefer - minDefer)
      }
      return
    }

    // Never stack or overlap ambient cues
    if (this._activeAmbientCue) {
      return
    }

    this._ambientEventTimer -= delta
    if (this._ambientEventTimer > 0) {
      return
    }

    // Avoid clustering new ambient cues right on top of ceiling-light sputters/faults
    const lightClusterGrace = Number(this._ambientConfig.ceilingLightClusterGraceSec) || 0
    if (
      lightClusterGrace > 0 &&
      this._elapsedSec - this._lastGlobalLightSputterAt < lightClusterGrace
    ) {
      this._ambientEventTimer = 0.8 + this._ambientRng() * 1.1
      return
    }

    this._ambientEventTimer = this._sampleAmbientNextInterval()

    // Respect zero volume / mute cleanly without wasting audio nodes
    if (
      this.volumes.muted ||
      this.volumes.master <= 0.001 ||
      this.volumes.ambience <= 0.001
    ) {
      return
    }

    const allowDistantSteps =
      !anyInvestigateOrClose &&
      nearestEnemyDist >= (Number(this._ambientConfig.minEnemyDistanceForSteps) || 10.5)

    const pickedCategory = this._selectAmbientCategory(allowDistantSteps)
    if (!pickedCategory) {
      return
    }

    const allowStartling =
      !context.reducedMotion &&
      this._ambientClockSec >= (Number(this._ambientConfig.minStartlingElapsedSec) || 16.0) &&
      this._ambientClockSec - this._lastStartlingAmbientAt >=
        (Number(this._ambientConfig.startlingCooldownSec) || 36.0)

    const pickedVariant = this._selectAmbientVariant(pickedCategory, allowStartling)
    const isStartling = this._isStartlingVariant(pickedCategory, pickedVariant)
    const anchor = this._pickAmbientSpatialAnchor(pickedCategory)
    const maxDist =
      pickedCategory === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE ||
      pickedCategory === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY
        ? 28.0
        : pickedCategory === AMBIENT_HORROR_CATEGORIES.VENT_WIND
          ? 24.0
          : 26.0
    const refDist =
      pickedCategory === AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS
        ? 3.0
        : pickedCategory === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE ||
            pickedCategory === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY
          ? 3.8
          : 3.4

    const reducedMult = context.reducedMotion ? 0.8 : 1.0
    const pitchScale = 0.94 + this._ambientRng() * 0.12
    const rumbleDur =
      pickedCategory === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE
        ? 2.4 + this._ambientRng() * 1.3
        : 0
    const windDur =
      pickedCategory === AMBIENT_HORROR_CATEGORIES.VENT_WIND
        ? 2.5 + this._ambientRng() * 1.4
        : 0
    const stepCount =
      pickedCategory === AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS
        ? 2 + Math.floor(this._ambientRng() * 3)
        : 0

    const estDurationSec =
      pickedCategory === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE
        ? rumbleDur + 0.15
        : pickedCategory === AMBIENT_HORROR_CATEGORIES.VENT_WIND
          ? windDur + 0.15
          : pickedCategory === AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS
            ? (pickedVariant === 1 ? 2.69 : Math.max(1, stepCount - 1) * 0.72 + 0.95)
            : pickedCategory === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY
              ? 3.2
              : 2.35

    const { dest, attenuation, cleanup } = this._createPositionalDestination(anchor.pos, {
      targetBus: this.ambienceGain,
      sendToReverb: false,
      reverbSend: this._ambientReverbInput,
      refDistance: refDist,
      maxDistance: maxDist,
      rolloff: 1.05,
      wallAttBase: 0.62,
      minOcclusionGain: 0.22,
      initialBlockedCutoff: 2200,
      minLowpassCutoff: 480,
      minSpatialGain: 0,
      ttlMs: Math.ceil((estDurationSec + 0.65) * 1000),
    })

    if (!dest) {
      return
    }

    let cueHandle = null

    if (pickedCategory === AMBIENT_HORROR_CATEGORIES.CREAK_KNOCK) {
      cueHandle = triggerAmbientCreakOrKnockCue(this.ctx, dest, this.noiseBuffer, {
        variant: pickedVariant,
        pitchScale,
        intensity: 0.94 * reducedMult,
      })
    } else if (pickedCategory === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE) {
      cueHandle = triggerAmbientUndergroundRumbleCue(this.ctx, dest, this.noiseBuffer, {
        variant: pickedVariant,
        durationSec: rumbleDur,
        pitchScale,
        intensity: 0.94 * reducedMult,
      })
    } else if (pickedCategory === AMBIENT_HORROR_CATEGORIES.VENT_WIND) {
      cueHandle = triggerAmbientVentWindCue(this.ctx, dest, this.noiseBuffer, {
        variant: pickedVariant,
        durationSec: windDur,
        intensity: 0.94 * reducedMult,
      })
    } else if (pickedCategory === AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS) {
      cueHandle = triggerAmbientDistantEchoStepsCue(this.ctx, dest, this.noiseBuffer, {
        variant: pickedVariant,
        stepCount,
        pitchScale,
        intensity: 0.86 * reducedMult,
      })
    } else if (pickedCategory === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY) {
      cueHandle = triggerAmbientRareAnomalyCue(this.ctx, dest, this.noiseBuffer, {
        variant: pickedVariant,
        pitchScale,
        intensity: 0.94 * reducedMult,
      })
    }

    if (!cueHandle || cueHandle.durationSec <= 0) {
      cleanup?.()
      return
    }

    this._lastAmbientCategory = pickedCategory
    this._lastAmbientVariantByCategory.set(pickedCategory, pickedVariant)
    this._ambientLastTriggeredAt.set(pickedCategory, this._ambientClockSec)
    if (isStartling) {
      this._lastStartlingAmbientAt = this._ambientClockSec
    }
    this._activeAmbientCue = {
      category: pickedCategory,
      variant: pickedVariant,
      isStartling,
      remainingSec: cueHandle.durationSec,
      stop: cueHandle.stop,
      cleanup,
    }

    this._recordCue('ambient_horror', {
      category: pickedCategory,
      variant: pickedVariant,
      isStartling,
      anchorType: anchor.anchorType,
      gain: attenuation.gain,
      wallCount: attenuation.wallCount,
      positional: this.spatialAudio,
      isHidden: this._isHidden,
    })
  }

  _selectAmbientCategory(allowDistantSteps) {
    const eligible = this._ambientEligibleCategories
    eligible.length = 0
    const cooldowns = this._ambientConfig.perCategoryCooldowns || {}
    const enforceRareEarlyGuard =
      (Number(this._ambientConfig.initialGraceMinSec) || 0) >= 4.0 &&
      this._ambientClockSec < (Number(this._ambientConfig.minRareAnomalyElapsedSec) || 0)

    for (let i = 0; i < AMBIENT_HORROR_CATEGORY_LIST.length; i += 1) {
      const cat = AMBIENT_HORROR_CATEGORY_LIST[i]
      if (cat === AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS && !allowDistantSteps) {
        continue
      }
      if (cat === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY && enforceRareEarlyGuard) {
        continue
      }
      if (cat === this._lastAmbientCategory) {
        continue
      }
      const cd = Number(cooldowns[cat]) || 0
      const lastAt = this._ambientLastTriggeredAt.get(cat)
      if (lastAt !== undefined && this._ambientClockSec - lastAt < cd) {
        continue
      }
      eligible.push(cat)
    }

    // Safe fallback if custom short intervals temporarily put all non-repeating categories on cooldown
    if (eligible.length === 0) {
      let oldestCat = null
      let oldestTime = Infinity
      for (let i = 0; i < AMBIENT_HORROR_CATEGORY_LIST.length; i += 1) {
        const cat = AMBIENT_HORROR_CATEGORY_LIST[i]
        if (cat === AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS && !allowDistantSteps) {
          continue
        }
        if (cat === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY && enforceRareEarlyGuard) {
          continue
        }
        if (cat === this._lastAmbientCategory) {
          continue
        }
        const lastAt = this._ambientLastTriggeredAt.get(cat) ?? -Infinity
        if (lastAt < oldestTime) {
          oldestTime = lastAt
          oldestCat = cat
        }
      }
      if (!oldestCat) return null
      eligible.push(oldestCat)
    }

    const weights = this._ambientConfig.categoryWeights || {}
    let totalWeight = 0
    for (let i = 0; i < eligible.length; i += 1) {
      const cat = eligible[i]
      let w = Math.max(0.05, Number(weights[cat]) || 1)
      if (
        this._isHidden &&
        (cat === AMBIENT_HORROR_CATEGORIES.VENT_WIND ||
          cat === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE ||
          cat === AMBIENT_HORROR_CATEGORIES.CREAK_KNOCK)
      ) {
        w *= 1.25
      }
      totalWeight += w
    }

    let roll = this._ambientRng() * totalWeight
    for (let i = 0; i < eligible.length; i += 1) {
      const cat = eligible[i]
      let w = Math.max(0.05, Number(weights[cat]) || 1)
      if (
        this._isHidden &&
        (cat === AMBIENT_HORROR_CATEGORIES.VENT_WIND ||
          cat === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE ||
          cat === AMBIENT_HORROR_CATEGORIES.CREAK_KNOCK)
      ) {
        w *= 1.25
      }
      roll -= w
      if (roll <= 0) {
        return cat
      }
    }

    return eligible[eligible.length - 1]
  }

  _isStartlingVariant(category, variant) {
    if (category === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY) {
      return variant === 0
    }
    if (
      category === AMBIENT_HORROR_CATEGORIES.CREAK_KNOCK ||
      category === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE ||
      category === AMBIENT_HORROR_CATEGORIES.VENT_WIND
    ) {
      return variant === 2
    }
    return false
  }

  _selectAmbientVariant(category, allowStartling = true) {
    const prev = this._lastAmbientVariantByCategory.get(category)
    let validCount = 0
    for (let v = 0; v < 3; v += 1) {
      if (v === prev) continue
      if (!allowStartling && this._isStartlingVariant(category, v)) continue
      validCount += 1
    }
    if (validCount === 0) {
      return prev === undefined ? 0 : (prev + 1) % 3
    }
    const pickIdx = Math.floor(this._ambientRng() * validCount) % validCount
    let seen = 0
    for (let v = 0; v < 3; v += 1) {
      if (v === prev) continue
      if (!allowStartling && this._isStartlingVariant(category, v)) continue
      if (seen === pickIdx) return v
      seen += 1
    }
    return prev === undefined ? 0 : (prev + 1) % 3
  }

  _isAnchorNearAnyEnemy(anchor, minDist = 6.5) {
    const list = this._ambientEnemyList
    for (let i = 0; i < list.length; i += 1) {
      const wp = list[i]?.worldPos
      if (!wp) continue
      const d = Math.hypot(anchor.x - wp.x, anchor.z - wp.z)
      if (d < minDist) return true
    }
    return false
  }

  _sampleAnchorFromPool(pool, anchorType, minDist, maxDist, yOverride = null, avoidEnemies = false) {
    if (!Array.isArray(pool) || pool.length === 0) return null
    const lx = this._listenerPos.x
    const lz = this._listenerPos.z
    const len = pool.length
    const stride = len > 48 ? Math.ceil(len / 48) : 1
    const startOffset = Math.floor(this._ambientRng() * len)

    const probePos = this._ambientProbePos
    const attOpts = {
      refDistance: 3.4,
      maxDistance: maxDist + 4,
      rolloff: 1.05,
      wallAttBase: 0.62,
      minOcclusionGain: 0.22,
      initialBlockedCutoff: 2200,
      minLowpassCutoff: 480,
    }
    let chosenItem = null
    let chosenY = 0
    let nearLoudItem = null
    let nearLoudY = 0
    let fallbackItem = null
    let fallbackY = 0
    let inspectedInRange = 0

    for (let s = 0; s < len; s += stride) {
      const item = pool[(startOffset + s) % len]
      if (!item) continue
      const d = Math.hypot(item.x - lx, item.z - lz)
      if (avoidEnemies && this._isAnchorNearAnyEnemy(item, 6.5)) {
        continue
      }
      const candidateY = yOverride !== null ? yOverride : item.y
      if (d >= minDist && d <= maxDist) {
        probePos.x = item.x
        probePos.y = candidateY
        probePos.z = item.z
        const att = computeSpatialAudioAttenuation(probePos, this._listenerPos, this.maze, attOpts)
        inspectedInRange += 1
        if (att.gain >= 0.12 && att.gain <= 0.86) {
          chosenItem = item
          chosenY = candidateY
          break
        }
        if (!nearLoudItem && att.gain >= 0.08) {
          nearLoudItem = item
          nearLoudY = candidateY
        } else if (!fallbackItem && att.gain >= 0.05) {
          fallbackItem = item
          fallbackY = candidateY
        }
        if (nearLoudItem && inspectedInRange >= 10) {
          break
        }
      } else if (!fallbackItem && d >= 3.0 && d <= maxDist + 2) {
        probePos.x = item.x
        probePos.y = candidateY
        probePos.z = item.z
        const att = computeSpatialAudioAttenuation(probePos, this._listenerPos, this.maze, attOpts)
        if (att.gain >= 0.08) {
          fallbackItem = item
          fallbackY = candidateY
        }
      }
    }

    const finalItem = chosenItem || nearLoudItem || fallbackItem
    if (!finalItem) return null
    this._ambientPickedAnchor.x = finalItem.x
    this._ambientPickedAnchor.y = chosenItem
      ? chosenY
      : nearLoudItem
        ? nearLoudY
        : fallbackY
    this._ambientPickedAnchor.z = finalItem.z
    return { pos: this._ambientPickedAnchor, anchorType }
  }

  _pickAmbientSpatialAnchor(category) {
    const { vents, ducts, corridors } = this._ambientAnchors

    if (category === AMBIENT_HORROR_CATEGORIES.VENT_WIND) {
      return (
        this._sampleAnchorFromPool(vents, 'vent', 4.0, 20.0) ||
        this._sampleAnchorFromPool(ducts, 'duct', 4.5, 20.0) ||
        this._sampleAnchorFromPool(corridors, 'corridor_ceiling', 5.0, 19.0, 3.1) ||
        this._fallbackVirtualAnchor(9.5, 3.1, 'virtual_vent')
      )
    }

    if (category === AMBIENT_HORROR_CATEGORIES.CREAK_KNOCK) {
      return (
        this._sampleAnchorFromPool(ducts, 'duct', 5.0, 21.0) ||
        this._sampleAnchorFromPool(vents, 'vent', 5.0, 21.0) ||
        this._sampleAnchorFromPool(corridors, 'corridor_ceiling', 5.5, 20.0, 3.05) ||
        this._fallbackVirtualAnchor(10.5, 3.05, 'virtual_duct')
      )
    }

    if (category === AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS) {
      return (
        this._sampleAnchorFromPool(corridors, 'distant_corridor', 9.5, 23.0, 1.35, true) ||
        this._sampleAnchorFromPool(corridors, 'distant_corridor', 5.0, 23.0, 1.35, true) ||
        this._fallbackVirtualAnchor(13.5, 1.35, 'virtual_corridor')
      )
    }

    if (category === AMBIENT_HORROR_CATEGORIES.UNDERGROUND_RUMBLE) {
      return (
        this._sampleAnchorFromPool(corridors, 'distant_underground', 8.5, 24.0, 0.45) ||
        this._sampleAnchorFromPool(corridors, 'distant_underground', 4.5, 24.0, 0.45) ||
        this._fallbackVirtualAnchor(12.0, 0.45, 'virtual_underground')
      )
    }

    // RARE_ANOMALY
    return (
      this._sampleAnchorFromPool(corridors, 'distant_corridor', 7.5, 23.0, 1.8) ||
      this._sampleAnchorFromPool(vents, 'vent', 6.5, 22.0) ||
      this._fallbackVirtualAnchor(11.5, 1.8, 'virtual_anomaly')
    )
  }

  _fallbackVirtualAnchor(radius, y, anchorType) {
    const startAngle = this._ambientRng() * Math.PI * 2
    const probePos = this._ambientProbePos
    const attOpts = {
      refDistance: 3.5,
      maxDistance: Math.max(26.0, radius + 14.0),
      rolloff: 1.05,
      wallAttBase: 0.62,
      minOcclusionGain: 0.22,
      initialBlockedCutoff: 2200,
      minLowpassCutoff: 480,
      minSpatialGain: 0,
    }
    let bestX = this._listenerPos.x + Math.cos(startAngle) * radius
    let bestZ = this._listenerPos.z + Math.sin(startAngle) * radius
    let bestGain = -1

    for (let i = 0; i < 8; i += 1) {
      const angle = startAngle + (i * Math.PI * 2) / 8
      const cx = this._listenerPos.x + Math.cos(angle) * radius
      const cz = this._listenerPos.z + Math.sin(angle) * radius
      probePos.x = cx
      probePos.y = y
      probePos.z = cz
      const att = computeSpatialAudioAttenuation(probePos, this._listenerPos, this.maze, attOpts)
      if (att.gain >= 0.14 && att.gain <= 0.82) {
        bestX = cx
        bestZ = cz
        break
      }
      if (att.gain > bestGain) {
        bestGain = att.gain
        bestX = cx
        bestZ = cz
      }
    }

    this._ambientPickedAnchor.x = bestX
    this._ambientPickedAnchor.y = y
    this._ambientPickedAnchor.z = bestZ
    return { pos: this._ambientPickedAnchor, anchorType }
  }

  /**
   * Synchronizes positional industrial ceiling-light ballast hums and restrained
   * irregular flicker/starter/fault cues with visual ceiling fixture states.
   */
  updateCeilingLights(ceilingLightsGroup, context = {}) {
    if (this.isDisposed || this.isPaused || this._isGameOver || this._hasWon) {
      this._silenceCeilingLightVoices(0.025)
      return
    }

    const ud = ceilingLightsGroup?.userData
    const fixtures = ud?.fixtures
    if (!ud || !Array.isArray(fixtures) || fixtures.length === 0) {
      this._silenceCeilingLightVoices(0.04)
      return
    }

    // Respect autoplay restrictions strictly: never instantiate or drive nodes before unlock
    if (!this.isUnlocked || !this.ctx || !this.effectsGain) {
      return
    }

    const reducedMotion = Boolean(context.reducedMotion ?? ud.reducedMotion)
    const highContrast = Boolean(context.highContrast ?? ud.highContrast)
    const lightScale = Number.isFinite(ud.currentLightScale)
      ? Math.max(0, Math.min(1.25, ud.currentLightScale))
      : 1
    const blackoutGainScale = Math.max(0, Math.min(1, (lightScale - 0.16) / 0.84))
    const canTriggerFlickerSfx = !reducedMotion && lightScale >= 0.45
    const contrastMult = highContrast ? 0.72 : 1.0

    const maxTransientDist = CEILING_LIGHT_AUDIO_CONFIG.transientMaxDistance
    const maxTransientDistSq = maxTransientDist * maxTransientDist
    const maxHumDist = CEILING_LIGHT_AUDIO_CONFIG.humMaxDistance
    const maxHumDistSq = maxHumDist * maxHumDist

    const lx = this._listenerPos.x
    const lz = this._listenerPos.z

    this._lightBestIndices[0] = -1
    this._lightBestIndices[1] = -1
    this._lightBestScores[0] = 0
    this._lightBestScores[1] = 0
    this._lightBestGains[0] = 0
    this._lightBestGains[1] = 0
    this._lightBestCutoffs[0] = 900
    this._lightBestCutoffs[1] = 900
    this._lightBestWallCounts[0] = 0
    this._lightBestWallCounts[1] = 0
    this._lightBestWarm[0] = 0
    this._lightBestWarm[1] = 0
    this._lightBestFixtures[0] = null
    this._lightBestFixtures[1] = null

    for (let i = 0; i < fixtures.length; i += 1) {
      const f = fixtures[i]
      if (!f || f.condition === 'burned_out') {
        continue
      }

      const dx = (Number(f.x) || 0) - lx
      const dz = (Number(f.z) || 0) - lz
      const dist2dSq = dx * dx + dz * dz
      if (dist2dSq > maxTransientDistSq) {
        continue
      }

      this._lightSourcePos.x = Number(f.x) || 0
      this._lightSourcePos.y = Number.isFinite(f.lightY) ? f.lightY : 3.4
      this._lightSourcePos.z = Number(f.z) || 0

      const att = computeSpatialAudioAttenuation(
        this._lightSourcePos,
        this._listenerPos,
        this.maze,
        this._lightTransientAttOpts
      )
      if (att.gain <= 0.001) {
        continue
      }

      const fKey = Number.isInteger(f.index) ? f.index : i
      let warmDip = 0

      if (f.condition === 'flickering') {
        const baseRef = Math.max(
          0.1,
          (Number(f.baseIntensity) || 1) * lightScale * contrastMult
        )
        const intensityDip = clamp01(1 - (Number(f._liveIntensity) || 0) / baseRef)
        warmDip = clamp01((Number(f._warmShift) || 0) / 0.85)
        const dipAmount = Math.max(warmDip, intensityDip > 0.14 ? intensityDip : 0)

        let tracker = this._fixtureAudioState.get(fKey)
        if (!tracker) {
          tracker = {
            wasInDip: dipAmount >= CEILING_LIGHT_AUDIO_CONFIG.dipEnterThreshold,
            lastSputterAt: -10 + (Math.abs(f.phase || 0) % 1.4),
            lastRecoveryAt: -10 + (Math.abs(f.phase || 0) % 1.4),
            lastFaultAt: -10,
            eventCounter: fKey,
          }
          this._fixtureAudioState.set(fKey, tracker)
        }

        if (!canTriggerFlickerSfx) {
          tracker.wasInDip = dipAmount >= CEILING_LIGHT_AUDIO_CONFIG.dipEnterThreshold
        } else {
          const perFixtureCooldown =
            CEILING_LIGHT_AUDIO_CONFIG.perFixtureCooldownMinSec +
            Math.abs(Math.sin((f.phase || 0) * 3.17)) *
              CEILING_LIGHT_AUDIO_CONFIG.perFixtureCooldownSpanSec
          const globalReady =
            this._elapsedSec - this._lastGlobalLightSputterAt >=
            CEILING_LIGHT_AUDIO_CONFIG.globalSputterCooldownSec
          const audibleForTransient =
            att.gain >= CEILING_LIGHT_AUDIO_CONFIG.minTransientGain && att.wallCount <= 2

          if (!tracker.wasInDip && dipAmount >= CEILING_LIGHT_AUDIO_CONFIG.dipEnterThreshold) {
            tracker.wasInDip = true
            if (
              audibleForTransient &&
              globalReady &&
              this._elapsedSec - tracker.lastSputterAt >= perFixtureCooldown
            ) {
              const isFault =
                dipAmount >= CEILING_LIGHT_AUDIO_CONFIG.faultDipThreshold &&
                tracker.eventCounter % 4 === 0 &&
                this._elapsedSec - tracker.lastFaultAt >= 7.5
              const pitchScale = 0.94 + ((fKey * 37) % 13) * 0.01
              const { dest } = this._createPositionalDestination(
                this._lightSourcePos,
                this._lightTransientAttOpts
              )
              if (dest) {
                if (isFault) {
                  tracker.lastFaultAt = this._elapsedSec
                  triggerCeilingLightFaultCue(this.ctx, dest, this.noiseBuffer, { pitchScale })
                  this._recordCue('ceiling_light_fault', {
                    fixtureIndex: fKey,
                    designType: f.designType,
                    gain: att.gain,
                    wallCount: att.wallCount,
                    dipAmount,
                    positional: this.spatialAudio,
                  })
                } else {
                  triggerCeilingLightSputterCue(this.ctx, dest, this.noiseBuffer, {
                    intensity: 0.55 + dipAmount * 0.55,
                    variant: tracker.eventCounter,
                    pitchScale,
                  })
                  this._recordCue('ceiling_light_sputter', {
                    fixtureIndex: fKey,
                    designType: f.designType,
                    gain: att.gain,
                    wallCount: att.wallCount,
                    dipAmount,
                    positional: this.spatialAudio,
                  })
                }
                tracker.lastSputterAt = this._elapsedSec
                tracker.eventCounter += 1
                this._lastGlobalLightSputterAt = this._elapsedSec
              }
            }
          } else if (
            tracker.wasInDip &&
            dipAmount <= CEILING_LIGHT_AUDIO_CONFIG.dipExitThreshold
          ) {
            tracker.wasInDip = false
            if (
              audibleForTransient &&
              globalReady &&
              tracker.eventCounter % 3 === 1 &&
              att.wallCount <= 1 &&
              this._elapsedSec - tracker.lastRecoveryAt >= 3.0
            ) {
              const pitchScale = 0.94 + ((fKey * 37) % 13) * 0.01
              const { dest } = this._createPositionalDestination(
                this._lightSourcePos,
                this._lightTransientAttOpts
              )
              if (dest) {
                triggerCeilingLightStarterCue(this.ctx, dest, this.noiseBuffer, { pitchScale })
                this._recordCue('ceiling_light_starter', {
                  fixtureIndex: fKey,
                  designType: f.designType,
                  gain: att.gain,
                  wallCount: att.wallCount,
                  positional: this.spatialAudio,
                })
                tracker.lastRecoveryAt = this._elapsedSec
                tracker.eventCounter += 1
                this._lastGlobalLightSputterAt = this._elapsedSec
              }
            }
          }
        }
      }

      if (blackoutGainScale <= 0.01 || dist2dSq > maxHumDistSq) {
        continue
      }

      const humDistGain = computeDistanceAttenuation(
        this._lightSourcePos,
        this._listenerPos,
        this._lightHumAttOpts
      )
      const humAttGain = humDistGain * att.occlusionMultiplier
      const isFlickering = f.condition === 'flickering'
      const baseHum = isFlickering
        ? CEILING_LIGHT_AUDIO_CONFIG.flickeringHumGain
        : CEILING_LIGHT_AUDIO_CONFIG.workingHumGain
      const modFactor =
        isFlickering && !reducedMotion ? 0.68 + 0.32 * (1 - warmDip) : 1.0
      const candidateGain = baseHum * humAttGain * blackoutGainScale * modFactor

      if (candidateGain < CEILING_LIGHT_AUDIO_CONFIG.minAudibleGain) {
        continue
      }

      const score = candidateGain * (isFlickering ? 1.15 : 1.0)
      if (score > this._lightBestScores[0]) {
        this._lightBestIndices[1] = this._lightBestIndices[0]
        this._lightBestScores[1] = this._lightBestScores[0]
        this._lightBestGains[1] = this._lightBestGains[0]
        this._lightBestCutoffs[1] = this._lightBestCutoffs[0]
        this._lightBestWallCounts[1] = this._lightBestWallCounts[0]
        this._lightBestWarm[1] = this._lightBestWarm[0]
        this._lightBestFixtures[1] = this._lightBestFixtures[0]

        this._lightBestIndices[0] = fKey
        this._lightBestScores[0] = score
        this._lightBestGains[0] = candidateGain
        this._lightBestCutoffs[0] = att.lowpassCutoff
        this._lightBestWallCounts[0] = att.wallCount
        this._lightBestWarm[0] = warmDip
        this._lightBestFixtures[0] = f
      } else if (score > this._lightBestScores[1]) {
        this._lightBestIndices[1] = fKey
        this._lightBestScores[1] = score
        this._lightBestGains[1] = candidateGain
        this._lightBestCutoffs[1] = att.lowpassCutoff
        this._lightBestWallCounts[1] = att.wallCount
        this._lightBestWarm[1] = warmDip
        this._lightBestFixtures[1] = f
      }
    }

    if (this._lightBestIndices[0] < 0) {
      this._silenceCeilingLightVoices(0.05)
      return
    }

    if (!this._ensureCeilingLightVoicePool()) {
      return
    }

    // Keep voice slot assignments sticky across frames to avoid stereo hopping
    const idxA = this._lightBestIndices[0]
    const idxB = this._lightBestIndices[1]
    const prev0 = this._lightVoiceAssigned[0]
    const prev1 = this._lightVoiceAssigned[1]

    let slotForA = 0
    let slotForB = 1
    if (prev1 === idxA || (idxB >= 0 && prev0 === idxB && prev0 !== idxA)) {
      slotForA = 1
      slotForB = 0
    }

    this._updateLightVoiceSlot(slotForA, 0, reducedMotion)
    if (idxB >= 0) {
      this._updateLightVoiceSlot(slotForB, 1, reducedMotion)
    } else if (this._lightVoicePool[slotForB]) {
      this._lightVoicePool[slotForB].silence(0.05)
      this._lightVoiceAssigned[slotForB] = -1
    }
  }

  _updateLightVoiceSlot(voiceSlot, candidateRank, reducedMotion) {
    const voice = this._lightVoicePool[voiceSlot]
    const f = this._lightBestFixtures[candidateRank]
    const fKey = this._lightBestIndices[candidateRank]
    if (!voice || !f || fKey < 0) {
      voice?.silence?.(0.05)
      this._lightVoiceAssigned[voiceSlot] = -1
      return
    }

    this._lightVoiceAssigned[voiceSlot] = fKey
    const timbreCutoff =
      f.designType === 'fluorescent_batten'
        ? 1020
        : f.designType === 'cage_bulkhead'
          ? 680
          : 820
    const wallCutoff = this._lightBestCutoffs[candidateRank]
    const warmDip = reducedMotion ? 0 : this._lightBestWarm[candidateRank]
    const humHz = 59.4 + ((fKey % 5) - 2) * 0.4
    const buzzHz =
      humHz * 2 - (f.condition === 'flickering' && !reducedMotion ? warmDip * 4.5 : 0)

    this._lightVoicePayload.x = Number(f.x) || 0
    this._lightVoicePayload.y = Number.isFinite(f.lightY) ? f.lightY : 3.4
    this._lightVoicePayload.z = Number(f.z) || 0
    this._lightVoicePayload.gain = this._lightBestGains[candidateRank]
    this._lightVoicePayload.cutoff = Math.min(timbreCutoff - warmDip * 140, wallCutoff)
    this._lightVoicePayload.humHz = humHz
    this._lightVoicePayload.buzzHz = buzzHz
    this._lightVoicePayload.buzzLevel =
      f.condition === 'flickering'
        ? reducedMotion
          ? 0.22
          : 0.27 + warmDip * 0.14
        : 0.18
    this._lightVoicePayload.tau = 0.045

    voice.update(this._lightVoicePayload)
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.isUnlocked = false

    this._stopActiveAmbientCues({ immediate: true })
    this._stopActiveThunderCues({ immediate: true })
    this._clearTransientTimers()
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()
    this._stopCeilingLightVoices()
    this._ambientLastTriggeredAt.clear()
    this._lastAmbientVariantByCategory.clear()
    this._ambientAnchors = { vents: [], ducts: [], corridors: [] }
    this._ambientEnemyList.length = 0

    if (this._ambientBed) {
      this._ambientBed.stop()
      this._ambientBed = null
    }
    this._stopThunderstormRainBed({ immediate: true })
    if (this._musicLayer) {
      this._musicLayer.stop()
      this._musicLayer = null
    }

    try {
      this._playerStepBus?.disconnect()
      this._reverbInput?.disconnect()
      this._reverbDelay?.disconnect()
      this._reverbFilter?.disconnect()
      this._reverbWetGain?.disconnect()
      this._ambientReverbInput?.disconnect()
      this._ambientReverbDelay?.disconnect()
      this._ambientReverbFilter?.disconnect()
      this._ambientReverbWetGain?.disconnect()
      this.ambienceGain?.disconnect()
      this.effectsGain?.disconnect()
      this.musicGain?.disconnect()
      this.masterGain?.disconnect()
      this.compressor?.disconnect()
    } catch {
      // Ignore disconnect errors on already-disposed nodes
    }

    if (this.ctx && this._ownsContext && typeof this.ctx.close === 'function') {
      try {
        this.ctx.close().catch?.(() => {})
      } catch {
        // Ignore close errors
      }
    }

    this.ctx = null
    this.masterGain = null
    this.ambienceGain = null
    this.effectsGain = null
    this.musicGain = null
    this.compressor = null
    this._reverbInput = null
    this._reverbDelay = null
    this._reverbFilter = null
    this._reverbWetGain = null
    this._ambientReverbInput = null
    this._ambientReverbDelay = null
    this._ambientReverbFilter = null
    this._ambientReverbWetGain = null
    this._playerStepBus = null
    this.noiseBuffer = null
    this._rainNoiseBuffer = null
    this.maze = null
    return true
  }
}
