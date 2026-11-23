import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import {
  ENEMY_AUDIO_CATEGORIES,
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
  triggerEnemyVocalCue,
  triggerEnemyBreathCue,
  triggerEnemyFootstep,
  triggerEnvironmentalDisturbanceCue,
  triggerExitVictoryCue,
  triggerGameOverCue,
  triggerHazardCue,
  triggerHidingSpotCue,
  PLAYER_DAMAGE_VOCAL_VARIANTS,
  PLAYER_BREATH_PROFILES,
  triggerLightFailureCue,
  triggerPlayerDamageCue,
  triggerPlayerImpactVocalCue,
  triggerPlayerBreathCue,
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
  triggerStartElevatorDescentCue,
  triggerStartElevatorImpactCue,
  triggerExtractionDoorCloseCue,
  triggerExtractionLockPauseCue,
  triggerExtractionDepartCue,
} from './audioSynthesis.js'
import { DEFAULT_AUDIO_VOLUMES } from './threeConfig.js'

export { DEFAULT_AUDIO_VOLUMES, PLAYER_BREATH_PROFILES, ENEMY_AUDIO_CATEGORIES }

export const ENEMY_AUDIO_LIMITS = Object.freeze({
  chaseAlertCooldownSec: 2.0,
  investigateAlertCooldownSec: 2.4,
  attackWindupCooldownSec: 0.4,
  vocalCooldownSec: 5.5,
  breathCooldownSec: 3.5,
  maxConcurrentAlerts: 2,
  maxConcurrentAttacks: 2,
  maxConcurrentVocals: 1,
  maxConcurrentBreaths: 2,
  maxConcurrentFootsteps: 3,
  maxActiveEnemyCues: 6,
})

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
  crackChanceWhenReady: 0.58,
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

export const AUDITION_PRESETS = Object.freeze([
  // Category 1: Player Vocals & Reactions (Preserves original 4 presets for Test 11 compatibility)
  Object.freeze({
    id: 'elevator_startled',
    category: 'player_vocal',
    label: 'Elevator Startled Exertion',
    kind: 'impact_grunt',
    variant: 'balance_shock',
    synthesizer: 'startled_exertion',
    profile: 'startled_breath',
  }),
  Object.freeze({
    id: 'damage_short_grunt',
    category: 'player_vocal',
    label: 'Damage Short Grunt',
    kind: 'damage_vocal',
    variant: 'short_grunt',
    variantIndex: 0,
    synthesizer: 'pain_reaction',
    profile: 'pain_pressed',
  }),
  Object.freeze({
    id: 'damage_sharp_impact',
    category: 'player_vocal',
    label: 'Damage Sharp Impact',
    kind: 'damage_vocal',
    variant: 'sharp_impact',
    variantIndex: 1,
    synthesizer: 'pain_reaction',
    profile: 'pain_pressed',
  }),
  Object.freeze({
    id: 'damage_strained_groan',
    category: 'player_vocal',
    label: 'Damage Strained Groan',
    kind: 'damage_vocal',
    variant: 'strained_groan',
    variantIndex: 2,
    synthesizer: 'pain_reaction',
    profile: 'pain_strained',
  }),
  // Category 2: Player Breathing (4 distinct modes)
  Object.freeze({
    id: 'player_breath_resting',
    category: 'player_breath',
    label: 'Player Breath: Resting',
    kind: 'player_breath',
    mode: 'resting',
    profile: 'resting',
  }),
  Object.freeze({
    id: 'player_breath_running',
    category: 'player_breath',
    label: 'Player Breath: Running',
    kind: 'player_breath',
    mode: 'running',
    profile: 'running',
  }),
  Object.freeze({
    id: 'player_breath_exhausted',
    category: 'player_breath',
    label: 'Player Breath: Exhausted',
    kind: 'player_breath',
    mode: 'exhausted',
    profile: 'exhausted',
  }),
  Object.freeze({
    id: 'player_breath_danger',
    category: 'player_breath',
    label: 'Player Breath: Danger / Tension',
    kind: 'player_breath',
    mode: 'danger',
    profile: 'danger',
  }),
  // Category 3: Enemy Breathing (All 3 archetypes)
  Object.freeze({
    id: 'enemy_breath_stalker',
    category: 'enemy_breath',
    label: 'Stalker Breath (Quiet / Airy)',
    kind: 'enemy_breath',
    enemyType: 'stalker',
    profile: 'stalker',
  }),
  Object.freeze({
    id: 'enemy_breath_hunter',
    category: 'enemy_breath',
    label: 'Hunter Breath (Rapid / Raspy)',
    kind: 'enemy_breath',
    enemyType: 'hunter',
    profile: 'hunter',
  }),
  Object.freeze({
    id: 'enemy_breath_brute',
    category: 'enemy_breath',
    label: 'Brute Breath (Deep / Heavy Chest)',
    kind: 'enemy_breath',
    enemyType: 'brute',
    profile: 'brute',
  }),
  // Category 4: Enemy Vocalizations (All 3 archetypes)
  Object.freeze({
    id: 'enemy_vocal_stalker',
    category: 'enemy_vocal',
    label: 'Stalker Vocal (Whisper Growl)',
    kind: 'enemy_vocal',
    enemyType: 'stalker',
    variant: 'growl',
    profile: 'stalker',
  }),
  Object.freeze({
    id: 'enemy_vocal_hunter',
    category: 'enemy_vocal',
    label: 'Hunter Vocal (Predatory Snarl)',
    kind: 'enemy_vocal',
    enemyType: 'hunter',
    variant: 'snarl',
    profile: 'hunter',
  }),
  Object.freeze({
    id: 'enemy_vocal_brute',
    category: 'enemy_vocal',
    label: 'Brute Vocal (Guttural Roar)',
    kind: 'enemy_vocal',
    enemyType: 'brute',
    variant: 'snarl',
    profile: 'brute',
  }),
  // Category 5: Enemy Alerts & Attacks
  Object.freeze({
    id: 'enemy_alert_investigate',
    category: 'alerts_attacks',
    label: 'Investigate Alert (Subtle)',
    kind: 'enemy_alert',
    enemyType: 'stalker',
    isChase: false,
  }),
  Object.freeze({
    id: 'enemy_alert_chase',
    category: 'alerts_attacks',
    label: 'Chase Alert (Sharp Warning)',
    kind: 'enemy_alert',
    enemyType: 'hunter',
    isChase: true,
  }),
  Object.freeze({
    id: 'enemy_attack_windup',
    category: 'alerts_attacks',
    label: 'Attack Windup (Telegraph)',
    kind: 'enemy_attack',
    enemyType: 'brute',
    isHit: false,
  }),
  Object.freeze({
    id: 'enemy_attack_hit',
    category: 'alerts_attacks',
    label: 'Attack Impact (Heavy Strike)',
    kind: 'enemy_attack',
    enemyType: 'brute',
    isHit: true,
  }),
  // Category 6: Combined Combat Mix
  Object.freeze({
    id: 'combined_combat_mix',
    category: 'combat_mix',
    label: 'Combined Combat Mix',
    kind: 'combined_mix',
  }),
])

export const VOCAL_AUDITION_PRESETS = Object.freeze(
  AUDITION_PRESETS.filter((p) => p.category === 'player_vocal')
)

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
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !fromPos || !toPos) return 0

  const firstRow = grid[0]
  if (!Array.isArray(firstRow) || firstRow.length === 0) return 0
  const rows = grid.length
  const cols = firstRow.length
  for (let r = 0; r < rows; r += 1) {
    if (!Array.isArray(grid[r]) || grid[r].length !== cols) return 0
  }

  const fx = Number(fromPos.x) || 0
  const fz = Number(fromPos.z) || 0
  const tx = Number(toPos.x) || 0
  const tz = Number(toPos.z) || 0
  const dx = tx - fx
  const dz = tz - fz
  const dist = Math.hypot(dx, dz)
  if (dist < 0.6) return 0

  if (
    typeof fromPos.x !== 'number' ||
    typeof fromPos.z !== 'number' ||
    !Number.isFinite(fromPos.x) ||
    !Number.isFinite(fromPos.z)
  ) {
    return 0
  }

  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2

  const startCol = Math.floor((fromPos.x - originX) / CELL_SIZE)
  const startRow = Math.floor((fromPos.z - originZ) / CELL_SIZE)
  const validStart =
    startRow >= 0 && startRow < rows && startCol >= 0 && startCol < cols

  const hasValidEnd =
    typeof toPos.x === 'number' &&
    typeof toPos.z === 'number' &&
    Number.isFinite(toPos.x) &&
    Number.isFinite(toPos.z)
  const endCol = hasValidEnd ? Math.floor((toPos.x - originX) / CELL_SIZE) : -1
  const endRow = hasValidEnd ? Math.floor((toPos.z - originZ) / CELL_SIZE) : -1
  const validEnd =
    hasValidEnd && endRow >= 0 && endRow < rows && endCol >= 0 && endCol < cols

  const step = 0.45
  const steps = Math.floor(dist / step)
  const ux = dx / dist
  const uz = dz / dist

  let wallCount = 0
  let lastWallRow = -1
  let lastWallCol = -1

  for (let i = 1; i < steps; i += 1) {
    const sx = fromPos.x + ux * (i * step)
    const sz = fromPos.z + uz * (i * step)
    const col = Math.floor((sx - originX) / CELL_SIZE)
    const row = Math.floor((sz - originZ) / CELL_SIZE)
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue
    if (
      (validStart && row === startRow && col === startCol) ||
      (validEnd && row === endRow && col === endCol)
    ) {
      continue
    }

    if (grid[row][col] !== CELL_TYPES.PATH) {
      if (row !== lastWallRow || col !== lastWallCol) {
        wallCount += 1
        lastWallRow = row
        lastWallCol = col
      }
    }
  }

  return wallCount
}

function computeOcclusionFactorsInto(fromPos, toPos, maze, options, out) {
  const wallCount = countOccludingWalls(fromPos, toPos, maze)
  if (wallCount <= 0) {
    out.wallCount = 0
    out.occlusionMultiplier = 1.0
    out.lowpassCutoff = 18000
    return out
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

  out.wallCount = wallCount
  out.occlusionMultiplier = Math.max(minOcclusionGain, Math.pow(wallAttBase, wallCount))
  out.lowpassCutoff = Math.max(
    minLowpassCutoff,
    Math.round(initialBlockedCutoff / Math.pow(1.75, wallCount - 1))
  )
  return out
}

function computeSpatialAudioAttenuationInto(sourcePos, listenerPos, maze, options, out) {
  const distanceGain = computeDistanceAttenuation(sourcePos, listenerPos, options)
  const minSpatialGain = Math.max(0, Math.min(1, Number(options?.minSpatialGain) || 0))
  if (distanceGain <= 0.001 && minSpatialGain <= 0) {
    out.gain = 0
    out.distanceGain = 0
    out.wallCount = 0
    out.occlusionMultiplier = 1
    out.lowpassCutoff = 18000
    return out
  }

  computeOcclusionFactorsInto(listenerPos, sourcePos, maze, options, out)
  const rawGain = distanceGain * out.occlusionMultiplier
  out.gain = minSpatialGain > 0 ? Math.max(minSpatialGain, rawGain) : rawGain
  out.distanceGain = distanceGain
  return out
}

/**
 * Maps crossed wall barriers to gain reduction and low-pass muffling frequency.
 */
export function computeOcclusionFactors(fromPos, toPos, maze, options = {}) {
  const tmp = {
    wallCount: 0,
    occlusionMultiplier: 1.0,
    lowpassCutoff: 18000,
  }
  computeOcclusionFactorsInto(fromPos, toPos, maze, options, tmp)
  return {
    wallCount: tmp.wallCount,
    gainMultiplier: tmp.occlusionMultiplier,
    lowpassCutoff: tmp.lowpassCutoff,
  }
}

/**
 * Combined distance + wall occlusion gain helper.
 */
export function computeSpatialAudioAttenuation(sourcePos, listenerPos, maze, options = {}) {
  return computeSpatialAudioAttenuationInto(sourcePos, listenerPos, maze, options, {
    gain: 0,
    distanceGain: 0,
    wallCount: 0,
    occlusionMultiplier: 1,
    lowpassCutoff: 18000,
  })
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
    this._activeElevatorCues = new Set()
    this._activeEnemyCues = new Set()
    this._activeVocalCue = null
    this._lastDamageVocalAt = -10
    this._lastImpactVocalAt = -10
    this._lastDamageVocalVariant = -1
    this._vocalCooldownSec = 0.28
    this._impactVocalCooldownSec = 0.4
    this._ctxStartTime = 0
    this._vocalRng =
      typeof options.vocalRandom === 'function' ? options.vocalRandom : Math.random
    this._pendingFadeCleanups = new Set()
    this._activeAuditionHandles = []
    this._auditionMixTimers = []

    this.playerVocalGain = null
    this.playerBreathGain = null
    this.enemyAttackGain = null
    this.enemyVocalGain = null
    this.hazardAudioGain = null
    this.elevatorImpactGain = null
    this._combatDuckTimer = 0
    this._combatDuckRemainingSec = 0
    this._isCombatDucked = false
    this._combatDuckFactor = 0.65
    this._enemyVocalDuckFactor = 0.55
    this._hazardDuckFactor = 0.6
    this._elevatorDuckRemainingSec = 0
    this._isElevatorDucked = false
    this._elevatorDuckFactor = 0.58

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
    this._lightVoiceSilenced = [true, true]
    this._lightVoiceLastSilenceTau = [0, 0]
    this._lightVoiceLastState = [
      {
        fixtureKey: -1,
        x: NaN,
        y: NaN,
        z: NaN,
        gain: 0,
        cutoff: 780,
        humHz: 60,
        buzzHz: 120,
        buzzLevel: 0.22,
      },
      {
        fixtureKey: -1,
        x: NaN,
        y: NaN,
        z: NaN,
        gain: 0,
        cutoff: 780,
        humHz: 60,
        buzzHz: 120,
        buzzLevel: 0.22,
      },
    ]
    this._tmpAttenuation = {
      gain: 0,
      distanceGain: 0,
      wallCount: 0,
      occlusionMultiplier: 1,
      lowpassCutoff: 18000,
    }
    this._sampleAnchorAttOpts = {
      refDistance: 3.4,
      maxDistance: 24,
      rolloff: 1.05,
      wallAttBase: 0.62,
      minOcclusionGain: 0.22,
      initialBlockedCutoff: 2200,
      minLowpassCutoff: 480,
    }
    this._fallbackAnchorAttOpts = {
      refDistance: 3.5,
      maxDistance: 26.0,
      rolloff: 1.05,
      wallAttBase: 0.62,
      minOcclusionGain: 0.22,
      initialBlockedCutoff: 2200,
      minLowpassCutoff: 480,
      minSpatialGain: 0,
    }

    this._playerStepTimer = 0
    this._playerBreathTimer = 0
    this._activePlayerBreathHandle = null
    this._playerStrainedBreathingRemainingSec = 0
    this._lastPlayerBreathMode = 'resting'
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
    this._sortedEnemiesScratch = []
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
    this._pendingElevatorImpact = false
    this._pendingImpactVocal = false
    this._flushedElevatorImpact = false
    this._flushedImpactVocal = false
    this._boundContextStateChange = null

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

  _isContextRunning() {
    if (!this.ctx) return false
    return typeof this.ctx.state !== 'string' || this.ctx.state === 'running'
  }

  _attachContextStateListener() {
    if (!this.ctx || typeof this.ctx.addEventListener !== 'function') return
    if (this._boundContextStateChange) return
    this._boundContextStateChange = () => {
      if (this.isDisposed || this.isPaused) return
      if (this._isContextRunning()) {
        this._finalizeUnlock()
      }
    }
    try {
      this.ctx.addEventListener('statechange', this._boundContextStateChange)
    } catch {
      // Ignore environments with non-standard AudioContext event targets
    }
  }

  _detachContextStateListener() {
    if (!this._boundContextStateChange) return
    if (this.ctx && typeof this.ctx.removeEventListener === 'function') {
      try {
        this.ctx.removeEventListener('statechange', this._boundContextStateChange)
      } catch {
        // Ignore cleanup errors
      }
    }
    this._boundContextStateChange = null
  }

  _finalizeUnlock() {
    if (this.isDisposed || this.isPaused || !this.ctx || !this._isContextRunning()) {
      return false
    }
    this.isUnlocked = true
    this._syncBusGains()
    this._ensureContinuousLayers()
    this._flushPendingElevatorCues()
    return true
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
      this._attachContextStateListener()
    }

    if (!this.isPaused && this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
      try {
        const resumeResult = this.ctx.resume()
        if (resumeResult && typeof resumeResult.then === 'function') {
          resumeResult
            .then(() => {
              this._finalizeUnlock()
            })
            .catch(() => {})
        }
      } catch {
        // Ignore resume errors in restricted contexts
      }
    }

    if (!this._isContextRunning()) {
      return false
    }

    return this._finalizeUnlock()
  }

  _flushPendingElevatorCues() {
    if (
      this.isDisposed ||
      this.isPaused ||
      !this.isUnlocked ||
      !this._isContextRunning() ||
      !this.effectsGain
    ) {
      return
    }
    if (this._pendingElevatorImpact && !this._flushedElevatorImpact) {
      const played = this.onStartElevatorImpact({ recordCue: false })
      if (played) {
        this._pendingElevatorImpact = false
        this._flushedElevatorImpact = true
      }
    }
    if (this._pendingImpactVocal && !this._flushedImpactVocal) {
      const played = this.onPlayerImpactReaction({ delaySec: 0.08, recordCue: false })
      if (played) {
        this._pendingImpactVocal = false
        this._flushedImpactVocal = true
      }
    }
  }

  _buildAudioGraph() {
    if (!this.ctx || typeof this.ctx.createGain !== 'function') return
    this._ctxStartTime = this.ctx.currentTime || 0

    this.masterGain = this.ctx.createGain()
    this.ambienceGain = this.ctx.createGain()
    this.effectsGain = this.ctx.createGain()
    this.musicGain = this.ctx.createGain()

    this.playerVocalGain = this.ctx.createGain()
    if (this.playerVocalGain.gain) {
      this.playerVocalGain.gain.value = 0.84
    }
    this.playerVocalGain.connect(this.effectsGain)

    this.playerBreathGain = this.ctx.createGain()
    if (this.playerBreathGain.gain) {
      this.playerBreathGain.gain.value = 1.0
    }
    this.playerBreathGain.connect(this.playerVocalGain || this.effectsGain)

    this.enemyAttackGain = this.ctx.createGain()
    if (this.enemyAttackGain.gain) {
      this.enemyAttackGain.gain.value = 1.0
    }
    this.enemyAttackGain.connect(this.effectsGain)

    this.enemyVocalGain = this.ctx.createGain()
    if (this.enemyVocalGain.gain) {
      this.enemyVocalGain.gain.value = 1.0
    }
    this.enemyVocalGain.connect(this.effectsGain)

    this.hazardAudioGain = this.ctx.createGain()
    if (this.hazardAudioGain.gain) {
      this.hazardAudioGain.gain.value = 1.0
    }
    this.hazardAudioGain.connect(this.effectsGain)

    this.elevatorImpactGain = this.ctx.createGain()
    if (this.elevatorImpactGain.gain) {
      this.elevatorImpactGain.gain.value = 1.0
    }
    this.elevatorImpactGain.connect(this.effectsGain)

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
      activeElevatorCueCount: this._activeElevatorCues?.size || 0,
      activeEnemyCueCount: this._getActiveEnemyCueCount(),
      activeVocalCueCount: this._activeVocalCue?.isActive?.() ? 1 : 0,
      activePlayerBreathCount: this._activePlayerBreathHandle?.isActive?.() ? 1 : 0,
      combatDucked: Boolean(this._isCombatDucked),
      enemyAttackGain: this.enemyAttackGain?.gain?.value ?? 1.0,
      enemyVocalGain: this.enemyVocalGain?.gain?.value ?? 1.0,
      hazardAudioGain: this.hazardAudioGain?.gain?.value ?? 1.0,
      elevatorDucked: Boolean(this._isElevatorDucked),
      elevatorImpactGain: this.elevatorImpactGain?.gain?.value ?? 1.0,
      playerVocalGain: this.playerVocalGain?.gain?.value ?? 0.84,
      playerBreathGain: this.playerBreathGain?.gain?.value ?? 1.0,
      playerBreathMode: this._lastPlayerBreathMode || 'resting',
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
      if (!this._lightVoiceSilenced[i] || tau < this._lightVoiceLastSilenceTau[i]) {
        this._lightVoicePool[i]?.silence?.(tau)
        this._lightVoiceSilenced[i] = true
        this._lightVoiceLastSilenceTau[i] = tau
        this._lightVoiceLastState[i].gain = 0
        this._lightVoiceLastState[i].fixtureKey = -1
      }
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
    for (let i = 0; i < this._lightVoiceSilenced.length; i += 1) {
      this._lightVoiceSilenced[i] = true
      this._lightVoiceLastSilenceTau[i] = 0
      const slotState = this._lightVoiceLastState[i]
      slotState.fixtureKey = -1
      slotState.x = NaN
      slotState.y = NaN
      slotState.z = NaN
      slotState.gain = 0
      slotState.cutoff = 780
      slotState.humHz = 60
      slotState.buzzHz = 120
      slotState.buzzLevel = 0.22
    }
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
      this._stopActiveEnemyCues({ immediate: true })
      this._stopActivePlayerBreath({ immediate: true })
      this._playerStrainedBreathingRemainingSec = 0
      this._playerBreathTimer = 0
      this.stopAudition({ immediate: true })
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
      this._stopActiveEnemyCues({ immediate: false })
      this._stopActiveElevatorCues({ immediate: false })
      this._stopActiveVocalCue({ immediate: false })
      this._stopActivePlayerBreath({ immediate: false })
      this.stopAudition({ immediate: true })
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

    if (this.ctx) {
      if (this.isUnlocked && this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        try {
          const resumeResult = this.ctx.resume()
          if (resumeResult && typeof resumeResult.then === 'function') {
            resumeResult
              .then(() => {
                if (this.isDisposed || this.isPaused || !this._isContextRunning()) return
                this._finalizeUnlock()
                this._thunderstormRainBed?.setPaused?.(false)
                if (this._musicLayer) {
                  this._musicLayer.setMood?.(
                    this._isGameOver || this._hasWon ? MUSIC_MOODS.SILENT : this._musicMood
                  )
                }
              })
              .catch(() => {})
          }
        } catch {
          // Ignore resume errors in restricted contexts
        }
      }
      if (this.isUnlocked && this._isContextRunning()) {
        this._ensureContinuousLayers()
        this._thunderstormRainBed?.setPaused?.(false)
        this._syncBusGains()
        this._flushPendingElevatorCues()
        if (this._musicLayer) {
          this._musicLayer.setMood?.(
            this._isGameOver || this._hasWon ? MUSIC_MOODS.SILENT : this._musicMood
          )
        }
      }
    }
  }

  setMaze(maze, ambientAnchors = null) {
    this.maze = maze || null
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()
    this._stopCeilingLightVoices()
    this._stopActiveEnemyCues({ immediate: true })
    this._stopActiveElevatorCues({ immediate: true })
    this._stopActiveVocalCue({ immediate: true })
    this._stopActivePlayerBreath({ immediate: true })
    this._playerBreathTimer = 0
    this._playerStrainedBreathingRemainingSec = 0
    this._lastPlayerBreathMode = 'resting'
    this.stopAudition({ immediate: true })
    this._restoreCombatAttackAudio({ immediate: true })
    this._restoreElevatorImpactAudio({ immediate: true })
    this._lastDamageVocalAt = -10
    this._lastImpactVocalAt = -10
    this._lastDamageVocalVariant = -1
    this._pendingElevatorImpact = false
    this._pendingImpactVocal = false
    this._flushedElevatorImpact = false
    this._flushedImpactVocal = false
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

  reset(options = {}) {
    const preserveElevatorQueue = Boolean(options?.preserveElevatorQueue)
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()
    this._sortedEnemiesScratch.length = 0
    this._stopCeilingLightVoices()
    this._stopActiveEnemyCues({ immediate: true })
    if (!preserveElevatorQueue) {
      this._stopActiveElevatorCues({ immediate: true })
      this._stopActiveVocalCue({ immediate: true })
      this._restoreElevatorImpactAudio({ immediate: true })
      this._lastImpactVocalAt = -10
      this._pendingElevatorImpact = false
      this._pendingImpactVocal = false
      this._flushedElevatorImpact = false
      this._flushedImpactVocal = false
    } else if (this._activeVocalCue?.kind !== 'impact_grunt') {
      this._stopActiveVocalCue({ immediate: true })
    }
    this._restoreCombatAttackAudio({ immediate: true })
    this._lastDamageVocalAt = -10
    this._lastDamageVocalVariant = -1
    this._stopActivePlayerBreath({ immediate: true })
    this._playerBreathTimer = 0
    this._playerStrainedBreathingRemainingSec = 0
    this._lastPlayerBreathMode = 'resting'
    this.stopAudition({ immediate: true })
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

  _ensureUnlockedAndRunning() {
    if (this.isDisposed || this.isPaused) return false
    if (!this.isUnlocked || !this.ctx || !this.effectsGain) {
      this.unlock()
    }
    if (this.ctx?.state === 'suspended' && typeof this.ctx.resume === 'function') {
      try {
        this.ctx.resume().catch?.(() => {})
      } catch {
        // Ignore resume errors
      }
    }
    return Boolean(this.isUnlocked && this.ctx && this.effectsGain && !this.isPaused)
  }

  _getVocalClockSec() {
    const audioNow = this.ctx
      ? Math.max(0, (this.ctx.currentTime || 0) - (this._ctxStartTime || 0))
      : 0
    return Math.max(this._elapsedSec || 0, audioNow)
  }

  _cancelAndHoldGain(gainNode, time) {
    const param = gainNode?.gain
    if (!param) return
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(time)
    } else if (typeof param.cancelScheduledValues === 'function') {
      param.cancelScheduledValues(time)
      param.setValueAtTime?.(param.value, time)
    }
  }

  _duckCombatAttackAudio(durationSec = 0.45) {
    if (!this.ctx) return
    const now = this.ctx.currentTime || 0
    this._isCombatDucked = true
    this._combatDuckRemainingSec = Math.min(0.55, Math.max(0.32, Number(durationSec) || 0.45))
    if (this.enemyAttackGain) {
      this._cancelAndHoldGain(this.enemyAttackGain, now)
      setGainSmooth(this.enemyAttackGain, this._combatDuckFactor, now, 0.005)
    }
    if (this.enemyVocalGain) {
      this._cancelAndHoldGain(this.enemyVocalGain, now)
      setGainSmooth(this.enemyVocalGain, this._enemyVocalDuckFactor, now, 0.005)
    }
    if (this.hazardAudioGain) {
      this._cancelAndHoldGain(this.hazardAudioGain, now)
      setGainSmooth(this.hazardAudioGain, this._hazardDuckFactor, now, 0.005)
    }
  }

  _restoreCombatAttackAudio({ immediate = false } = {}) {
    if (!this.ctx) return
    this._isCombatDucked = false
    this._combatDuckRemainingSec = 0
    const now = this.ctx.currentTime || 0
    const tau = immediate ? 0.005 : 0.08
    if (this.enemyAttackGain) {
      this._cancelAndHoldGain(this.enemyAttackGain, now)
      setGainSmooth(this.enemyAttackGain, 1.0, now, tau)
    }
    if (this.enemyVocalGain) {
      this._cancelAndHoldGain(this.enemyVocalGain, now)
      setGainSmooth(this.enemyVocalGain, 1.0, now, tau)
    }
    if (this.hazardAudioGain) {
      this._cancelAndHoldGain(this.hazardAudioGain, now)
      setGainSmooth(this.hazardAudioGain, 1.0, now, tau)
    }
  }

  _duckElevatorImpactAudio(durationSec = 0.36, delaySec = 0.08) {
    if (!this.elevatorImpactGain || !this.ctx) return
    const now = this.ctx.currentTime || 0
    const safeDelay = Math.max(0, Number(delaySec) || 0)
    const startAt = now + safeDelay
    this._isElevatorDucked = true
    this._elevatorDuckRemainingSec = Math.min(0.55, Math.max(0.24, Number(durationSec) || 0.36))
    this._cancelAndHoldGain(this.elevatorImpactGain, now)
    setGainSmooth(this.elevatorImpactGain, this._elevatorDuckFactor, startAt, 0.012)
  }

  _restoreElevatorImpactAudio({ immediate = false } = {}) {
    if (!this.elevatorImpactGain || !this.ctx) return
    this._isElevatorDucked = false
    this._elevatorDuckRemainingSec = 0
    const now = this.ctx.currentTime || 0
    this._cancelAndHoldGain(this.elevatorImpactGain, now)
    const tau = immediate ? 0.005 : 0.12
    setGainSmooth(this.elevatorImpactGain, 1.0, now, tau)
  }

  _stopActiveVocalCue({ immediate = false } = {}) {
    if (!this._activeVocalCue) return
    const active = this._activeVocalCue
    this._activeVocalCue = null
    const isImm = Boolean(immediate || this.isDisposed)
    if (active.kind === 'damage_vocal') {
      this._restoreCombatAttackAudio({ immediate: isImm })
    } else if (active.kind === 'impact_grunt') {
      this._restoreElevatorImpactAudio({ immediate: isImm })
    }
    try {
      active.stop?.({
        immediate: isImm,
        delayMs: 45,
        scheduleDisconnect: isImm
          ? null
          : (disconnectFn, delayMs) => {
              this._scheduleFadeCleanup(disconnectFn, delayMs)
            },
      })
    } catch {
      // Ignore already-stopped vocal cue errors
    }
  }

  _stopActivePlayerBreath({ immediate = false } = {}) {
    if (!this._activePlayerBreathHandle) return
    const active = this._activePlayerBreathHandle
    this._activePlayerBreathHandle = null
    const isImm = Boolean(immediate || this.isDisposed)
    try {
      active.stop?.({
        immediate: isImm,
        delayMs: 40,
        scheduleDisconnect: isImm
          ? null
          : (disconnectFn, delayMs) => {
              this._scheduleFadeCleanup(disconnectFn, delayMs)
            },
      })
    } catch {
      // Ignore already-stopped breath errors
    }
  }

  triggerPlayerBreath(options = {}) {
    if (this.isDisposed || this.isPaused || !this.isUnlocked || !this.ctx) return null
    if (this._activeVocalCue?.isActive?.()) return null
    this._stopActivePlayerBreath({ immediate: true })
    const destBus = this.playerBreathGain || this.playerVocalGain || this.effectsGain
    const handle = triggerPlayerBreathCue(this.ctx, destBus, this.noiseBuffer, {
      ...options,
      onComplete: () => {
        options?.onComplete?.()
        if (this._activePlayerBreathHandle === handle) {
          this._activePlayerBreathHandle = null
        }
      },
    })
    if (handle) {
      this._activePlayerBreathHandle = handle
      this._lastPlayerBreathMode = handle.mode || options?.mode || 'resting'
      this._recordCue('player_breath', {
        mode: this._lastPlayerBreathMode,
        phase: handle.phase || options?.phase || 'cycle',
        stamina: options?.stamina ?? 100,
        manual: true,
      })
    }
    return handle
  }

  _pickDamageVocalVariant(healthDelta = 20, isGameOver = false) {
    const count = PLAYER_DAMAGE_VOCAL_VARIANTS.length
    if (count <= 1) return 0
    if ((isGameOver || healthDelta >= 35) && this._lastDamageVocalVariant !== 2) {
      return 2
    }
    if (this._lastDamageVocalVariant < 0 || this._lastDamageVocalVariant >= count) {
      return Math.floor(this._vocalRng() * count) % count
    }
    const pick = Math.floor(this._vocalRng() * (count - 1)) % (count - 1)
    return pick >= this._lastDamageVocalVariant ? pick + 1 : pick
  }

  onPlayerImpactReaction(options = {}) {
    if (this.isDisposed || this._isGameOver || this._hasWon) return false
    const clockSec = this._getVocalClockSec()
    if (clockSec - this._lastImpactVocalAt < this._impactVocalCooldownSec) {
      return false
    }
    const delaySec = Number.isFinite(Number(options?.delaySec))
      ? Math.max(0.05, Math.min(0.12, Number(options.delaySec)))
      : 0.08
    if (this._activeVocalCue?.isActive?.() && this._activeVocalCue.kind === 'damage_vocal') {
      return false
    }

    const record = options.recordCue !== false
    if (record) {
      this._recordCue('player_impact_vocal', {
        gain: 1,
        delaySec,
        synthesizer: 'startled_exertion',
        profile: 'startled_breath',
      })
    }

    if (!this.isUnlocked || !this._isContextRunning() || !this.effectsGain || this.isPaused) {
      this._pendingImpactVocal = true
      return false
    }

    this._stopActiveVocalCue({ immediate: true })
    this._stopActivePlayerBreath({ immediate: true })
    this._lastImpactVocalAt = clockSec
    const vocalBus = this.playerVocalGain || this.effectsGain
    let handle = null
    handle = triggerPlayerImpactVocalCue(this.ctx, vocalBus, this.noiseBuffer, {
      delaySec,
      onComplete: () => {
        if (this._activeVocalCue === handle) {
          this._activeVocalCue = null
          this._restoreElevatorImpactAudio()
        }
      },
    })
    this._activeVocalCue = handle
    if (handle) {
      this._duckElevatorImpactAudio(handle.durationSec || 0.5, delaySec)
    }
    return Boolean(handle)
  }

  onPlayerDamage(meta = {}) {
    if (this.isDisposed) return false
    if (meta && typeof meta === 'object') {
      if (meta.blocked === true || meta.immune === true || meta.healing === true) {
        return false
      }
      if ('healthDelta' in meta && !(Number(meta.healthDelta) > 0)) {
        return false
      }
      if ('damage' in meta && !(Number(meta.damage) > 0)) {
        return false
      }
    }

    const clockSec = this._getVocalClockSec()
    if (clockSec - this._lastDamageVocalAt < this._vocalCooldownSec) {
      return false
    }

    const healthDelta = Number(meta?.healthDelta ?? meta?.damage) || 20
    const isGameOver = Boolean(meta?.isGameOver)
    const variantIndex = this._pickDamageVocalVariant(healthDelta, isGameOver)
    const variant = PLAYER_DAMAGE_VOCAL_VARIANTS[variantIndex]
    const glottalProfile = variant === 'strained_groan' ? 'pain_strained' : 'pain_pressed'

    this._recordCue('player_damage', {
      gain: 1,
      variant,
      healthDelta,
      synthesizer: 'pain_reaction',
      profile: glottalProfile,
    })
    if (!this.isUnlocked || !this._isContextRunning() || !this.effectsGain || this.isPaused) {
      return false
    }

    this._stopActiveVocalCue({ immediate: true })
    this._stopActivePlayerBreath({ immediate: true })
    this._playerStrainedBreathingRemainingSec = 4.0
    this._lastDamageVocalAt = clockSec
    this._lastDamageVocalVariant = variantIndex

    const intensity =
      isGameOver || healthDelta >= 35 ? 1.12 : healthDelta >= 20 ? 1.0 : 0.94
    const vocalBus = this.playerVocalGain || this.effectsGain
    let handle = null
    handle = triggerPlayerDamageCue(this.ctx, vocalBus, this.noiseBuffer, {
      variant: variantIndex,
      intensity,
      onComplete: () => {
        if (this._activeVocalCue === handle) {
          this._activeVocalCue = null
          this._restoreCombatAttackAudio()
        }
      },
    })
    this._activeVocalCue = handle
    this._duckCombatAttackAudio(handle?.durationSec || 0.5)
    return Boolean(handle)
  }

  getVocalAuditionPresets() {
    return VOCAL_AUDITION_PRESETS
  }

  getAuditionPresets() {
    return AUDITION_PRESETS
  }

  _resolveAuditionPreset(presetId) {
    const key = typeof presetId === 'string' ? presetId.trim().toLowerCase() : ''
    if (!key) return null
    for (let i = 0; i < AUDITION_PRESETS.length; i += 1) {
      const preset = AUDITION_PRESETS[i]
      if (
        preset.id === key ||
        preset.variant === key ||
        (preset.id === 'elevator_startled' &&
          (key === 'impact_grunt' || key === 'elevator_impact' || key === 'startled_exertion'))
      ) {
        return preset
      }
    }
    return null
  }

  _resolveVocalAuditionPreset(presetId) {
    const key = typeof presetId === 'string' ? presetId.trim().toLowerCase() : ''
    if (!key) return null
    for (let i = 0; i < VOCAL_AUDITION_PRESETS.length; i += 1) {
      const preset = VOCAL_AUDITION_PRESETS[i]
      if (
        preset.id === key ||
        preset.variant === key ||
        (preset.id === 'elevator_startled' &&
          (key === 'impact_grunt' || key === 'elevator_impact' || key === 'startled_exertion'))
      ) {
        return preset
      }
    }
    return this._resolveAuditionPreset(presetId)
  }

  stopAudition({ immediate = true } = {}) {
    if (this.isDisposed) return false
    let hadActive = false
    if (this._activeVocalCue?.isActive?.()) {
      hadActive = true
      this._stopActiveVocalCue({ immediate: Boolean(immediate) })
    }
    if (this._activePlayerBreathHandle?.isActive?.()) {
      hadActive = true
      this._stopActivePlayerBreath({ immediate: Boolean(immediate) })
    }
    if (this._activeAuditionHandles?.length > 0) {
      hadActive = true
      for (const h of this._activeAuditionHandles) {
        try {
          h.stop?.({ immediate: Boolean(immediate) })
        } catch {
          // Ignore audition handle stop errors
        }
      }
      this._activeAuditionHandles.length = 0
    }
    if (this._auditionMixTimers?.length > 0) {
      for (const t of this._auditionMixTimers) {
        clearTimeout(t)
      }
      this._auditionMixTimers.length = 0
    }
    return hadActive
  }

  stopVocalAudition({ immediate = true } = {}) {
    return this.stopAudition({ immediate })
  }

  _triggerCombinedCombatMixAudition() {
    this.stopAudition({ immediate: true })

    // 1. Initial Hunter chase alert (t = 0)
    const alertHandle = triggerEnemyAlertCue(this.ctx, this.effectsGain, true, 'hunter')
    if (alertHandle) this._activeAuditionHandles.push(alertHandle)

    // 2. Hunter vocalization snarl (t = 0.35s)
    const t1 = setTimeout(() => {
      if (this.isDisposed || this.isPaused) return
      const vocalHandle = triggerEnemyVocalCue(
        this.ctx,
        this.enemyVocalGain || this.effectsGain,
        this.noiseBuffer,
        'hunter',
        'snarl'
      )
      if (vocalHandle) this._activeAuditionHandles.push(vocalHandle)
    }, 350)
    this._auditionMixTimers.push(t1)

    // 3. Enemy attack windup (t = 0.70s)
    const t2 = setTimeout(() => {
      if (this.isDisposed || this.isPaused) return
      const windupHandle = triggerEnemyAttackCue(
        this.ctx,
        this.enemyAttackGain || this.effectsGain,
        this.noiseBuffer,
        false,
        'hunter'
      )
      if (windupHandle) this._activeAuditionHandles.push(windupHandle)
    }, 700)
    this._auditionMixTimers.push(t2)

    // 4. Enemy attack hit & Player damage reaction with smooth combat ducking (t = 1.05s)
    const t3 = setTimeout(() => {
      if (this.isDisposed || this.isPaused) return
      const hitHandle = triggerEnemyAttackCue(
        this.ctx,
        this.enemyAttackGain || this.effectsGain,
        this.noiseBuffer,
        true,
        'hunter'
      )
      if (hitHandle) this._activeAuditionHandles.push(hitHandle)

      const damageHandle = triggerPlayerDamageCue(
        this.ctx,
        this.playerVocalGain || this.effectsGain,
        this.noiseBuffer,
        { variant: 1, intensity: 1.05 }
      )
      this._activeVocalCue = damageHandle
      this._duckCombatAttackAudio(0.5)

      this._playerStrainedBreathingRemainingSec = 4.0
    }, 1050)
    this._auditionMixTimers.push(t3)

    return {
      played: true,
      presetId: 'combined_combat_mix',
      kind: 'combined_mix',
      category: 'combat_mix',
      synthesizer: 'integrated_pipeline',
      profile: 'chase_snarl_attack_damage_ducking',
      durationSec: 1.8,
    }
  }

  auditionCue(presetId = 'elevator_startled', options = {}) {
    if (this.isDisposed) return null
    const preset = this._resolveAuditionPreset(presetId)
    if (!preset) return null

    if (!this.isUnlocked || !this._isContextRunning()) {
      this.unlock()
    }
    if (!this.isUnlocked || !this._isContextRunning() || !this.effectsGain || this.isPaused) {
      return {
        played: false,
        presetId: preset.id,
        kind: preset.kind,
        variant: preset.variant || preset.mode || '',
        synthesizer: preset.synthesizer || preset.kind,
        profile: preset.profile || preset.id,
        durationSec: 0,
      }
    }

    if (preset.category === 'player_vocal') {
      return this.auditionVocalCue(preset.id, options)
    }

    this.stopAudition({ immediate: true })

    if (preset.id === 'combined_combat_mix') {
      return this._triggerCombinedCombatMixAudition()
    }

    if (preset.category === 'player_breath') {
      const mode = preset.mode || 'resting'
      const handle = triggerPlayerBreathCue(
        this.ctx,
        this.playerBreathGain || this.effectsGain,
        this.noiseBuffer,
        { mode, phase: 'cycle' }
      )
      this._activePlayerBreathHandle = handle
      this._recordCue('player_breath', {
        mode,
        audition: true,
        presetId: preset.id,
      })
      return {
        played: Boolean(handle),
        presetId: preset.id,
        kind: 'player_breath',
        variant: mode,
        synthesizer: 'player_breath_cycle',
        profile: mode,
        durationSec: handle?.durationSec || 1.2,
      }
    }

    if (preset.category === 'enemy_breath') {
      const enemyType = preset.enemyType || 'stalker'
      const handle = triggerEnemyBreathCue(
        this.ctx,
        this.enemyVocalGain || this.effectsGain,
        this.noiseBuffer,
        enemyType
      )
      if (handle) this._activeAuditionHandles.push(handle)
      this._recordCue('enemy_breath', {
        enemyType,
        audition: true,
        presetId: preset.id,
      })
      return {
        played: Boolean(handle),
        presetId: preset.id,
        kind: 'enemy_breath',
        variant: enemyType,
        synthesizer: 'enemy_breath_cycle',
        profile: enemyType,
        durationSec: handle?.durationSec || 1.1,
      }
    }

    if (preset.category === 'enemy_vocal') {
      const enemyType = preset.enemyType || 'stalker'
      const variant = preset.variant || 'snarl'
      const handle = triggerEnemyVocalCue(
        this.ctx,
        this.enemyVocalGain || this.effectsGain,
        this.noiseBuffer,
        enemyType,
        variant
      )
      if (handle) this._activeAuditionHandles.push(handle)
      this._recordCue('enemy_vocal', {
        enemyType,
        variant,
        audition: true,
        presetId: preset.id,
      })
      return {
        played: Boolean(handle),
        presetId: preset.id,
        kind: 'enemy_vocal',
        variant,
        synthesizer: 'enemy_vocal',
        profile: `${enemyType}_${variant}`,
        durationSec: handle?.durationSec || 0.8,
      }
    }

    if (preset.category === 'alerts_attacks') {
      if (preset.kind === 'enemy_alert') {
        const isChase = Boolean(preset.isChase)
        const enemyType = preset.enemyType || 'hunter'
        const handle = triggerEnemyAlertCue(this.ctx, this.effectsGain, isChase, enemyType)
        if (handle) this._activeAuditionHandles.push(handle)
        this._recordCue(isChase ? 'enemy_detect_chase' : 'enemy_detect_investigate', {
          enemyType,
          audition: true,
          presetId: preset.id,
        })
        return {
          played: Boolean(handle),
          presetId: preset.id,
          kind: 'enemy_alert',
          variant: isChase ? 'chase' : 'investigate',
          synthesizer: 'enemy_alert',
          profile: `${enemyType}_${isChase ? 'chase' : 'investigate'}`,
          durationSec: handle?.durationSec || 0.4,
        }
      }
      if (preset.kind === 'enemy_attack') {
        const isHit = Boolean(preset.isHit)
        const enemyType = preset.enemyType || 'brute'
        const handle = triggerEnemyAttackCue(
          this.ctx,
          this.enemyAttackGain || this.effectsGain,
          this.noiseBuffer,
          isHit,
          enemyType
        )
        if (handle) this._activeAuditionHandles.push(handle)
        this._recordCue(isHit ? 'enemy_attack_hit' : 'enemy_attack_windup', {
          enemyType,
          audition: true,
          presetId: preset.id,
        })
        return {
          played: Boolean(handle),
          presetId: preset.id,
          kind: 'enemy_attack',
          variant: isHit ? 'hit' : 'windup',
          synthesizer: 'enemy_attack',
          profile: `${enemyType}_${isHit ? 'hit' : 'windup'}`,
          durationSec: handle?.durationSec || 0.45,
        }
      }
    }

    return null
  }

  /**
   * Development-only browser audition entrypoint that plays one of the four
   * production player vocal reactions through the exact production synthesizer,
   * glottal PeriodicWave profile, playerVocalGain -> effectsGain -> masterGain ->
   * compressor -> destination routing, and ducking envelopes while guaranteeing
   * non-overlapping playback and preserving normal gameplay cooldown/HP state.
   */
  auditionVocalCue(presetId = 'elevator_startled', options = {}) {
    if (this.isDisposed) return null
    const preset = this._resolveVocalAuditionPreset(presetId)
    if (!preset) return null

    if (preset.category && preset.category !== 'player_vocal') {
      return this.auditionCue(preset.id, options)
    }

    if (!this.isUnlocked || !this._isContextRunning()) {
      this.unlock()
    }
    if (!this.isUnlocked || !this._isContextRunning() || !this.effectsGain || this.isPaused) {
      return {
        played: false,
        presetId: preset.id,
        kind: preset.kind,
        variant: preset.variant,
        synthesizer: preset.synthesizer,
        profile: preset.profile,
        durationSec: 0,
      }
    }

    // Prevent overlapping audition playback by cleanly stopping any active vocal cue first
    this.stopAudition({ immediate: true })

    const vocalBus = this.playerVocalGain || this.effectsGain
    let handle = null

    if (preset.id === 'elevator_startled') {
      const delaySec =
        options?.immediate === true
          ? 0
          : Number.isFinite(Number(options?.delaySec))
            ? Math.max(0, Math.min(0.12, Number(options.delaySec)))
            : 0.08
      this._recordCue('player_impact_vocal', {
        gain: 1,
        delaySec,
        variant: preset.variant,
        synthesizer: preset.synthesizer,
        profile: preset.profile,
        audition: true,
        presetId: preset.id,
      })
      handle = triggerPlayerImpactVocalCue(this.ctx, vocalBus, this.noiseBuffer, {
        delaySec,
        onComplete: () => {
          if (this._activeVocalCue === handle) {
            this._activeVocalCue = null
            this._restoreElevatorImpactAudio()
          }
        },
      })
      this._activeVocalCue = handle
      if (handle) {
        this._duckElevatorImpactAudio(handle.durationSec || 0.5, delaySec)
      }
    } else {
      const intensity = Number.isFinite(Number(options?.intensity))
        ? Math.max(0.5, Math.min(1.3, Number(options.intensity)))
        : preset.variant === 'strained_groan'
          ? 1.12
          : 1.0
      this._recordCue('player_damage', {
        gain: 1,
        variant: preset.variant,
        healthDelta: preset.variant === 'strained_groan' ? 35 : 20,
        synthesizer: preset.synthesizer,
        profile: preset.profile,
        audition: true,
        presetId: preset.id,
      })
      handle = triggerPlayerDamageCue(this.ctx, vocalBus, this.noiseBuffer, {
        variant: preset.variantIndex,
        intensity,
        onComplete: () => {
          if (this._activeVocalCue === handle) {
            this._activeVocalCue = null
            this._restoreCombatAttackAudio()
          }
        },
      })
      this._activeVocalCue = handle
      if (handle) {
        this._duckCombatAttackAudio(handle.durationSec || 0.5)
      }
    }

    return {
      played: Boolean(handle),
      presetId: preset.id,
      kind: handle?.kind || preset.kind,
      variant: handle?.variant || preset.variant,
      synthesizer: handle?.synthesizer || preset.synthesizer,
      profile: handle?.profile || preset.profile,
      durationSec: handle?.durationSec || 0,
    }
  }

  onGameOver() {
    if (this.isDisposed) return
    this._isGameOver = true
    this._isHidden = false
    this._stopCeilingLightVoices()
    this._stopActiveAmbientCues({ immediate: true })
    this._stopActiveThunderCues({ immediate: true })
    this._stopActiveSilhouetteAudio({ immediate: true })
    this._stopActiveEnemyCues({ immediate: true })
    this._stopActivePlayerBreath({ immediate: true })
    this._playerStrainedBreathingRemainingSec = 0
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
    this._stopActiveEnemyCues({ immediate: true })
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

  _trackElevatorCue(handle) {
    if (!handle || !this._activeElevatorCues) return handle
    if (this._activeElevatorCues.size >= 16) {
      this._stopActiveElevatorCues({ immediate: true })
    }
    this._activeElevatorCues.add(handle)
    return handle
  }

  _stopActiveElevatorCues({ immediate = false } = {}) {
    if (!this._activeElevatorCues || this._activeElevatorCues.size === 0) return
    const handles = Array.from(this._activeElevatorCues)
    this._activeElevatorCues.clear()
    const isImm = Boolean(immediate || this.isDisposed)
    for (let i = 0; i < handles.length; i += 1) {
      try {
        handles[i]?.stop?.({
          immediate: isImm,
          delayMs: 60,
          scheduleDisconnect: isImm
            ? null
            : (disconnectFn, delayMs) => {
                this._scheduleFadeCleanup(disconnectFn, delayMs)
              },
        })
      } catch {
        // Ignore already-stopped elevator cue handles
      }
    }
  }

  stopElevatorCues({ immediate = true } = {}) {
    if (this.isDisposed) return false
    const isImm = Boolean(immediate)
    this._stopActiveElevatorCues({ immediate: isImm })
    if (this._activeVocalCue?.kind === 'impact_grunt') {
      this._stopActiveVocalCue({ immediate: isImm })
    }
    this._restoreElevatorImpactAudio({ immediate: isImm })
    this._pendingElevatorImpact = false
    this._pendingImpactVocal = false
    this._flushedElevatorImpact = false
    this._flushedImpactVocal = false
    return true
  }

  onStartElevatorDescent(duration = 1.45) {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('start_elevator_descent', { duration })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    let handle = null
    handle = triggerStartElevatorDescentCue(
      this.ctx,
      this.effectsGain,
      this.noiseBuffer,
      duration,
      {
        onComplete: () => {
          if (handle) this._activeElevatorCues?.delete(handle)
        },
      }
    )
    this._trackElevatorCue(handle)
    return true
  }

  onStartElevatorImpact(options = {}) {
    if (this.isDisposed || this._isGameOver) return false
    const record = options.recordCue !== false
    if (record) {
      this._recordCue('start_elevator_impact', {
        gain: 1,
        layers: 6,
        echo: true,
        durationSec: 2.52,
      })
    }
    if (!this.isUnlocked || !this._isContextRunning() || !this.effectsGain || this.isPaused) {
      this._pendingElevatorImpact = true
      return false
    }
    const impactBus = this.elevatorImpactGain || this.effectsGain
    let handle = null
    handle = triggerStartElevatorImpactCue(this.ctx, impactBus, this.noiseBuffer, {
      onComplete: () => {
        if (handle) this._activeElevatorCues?.delete(handle)
      },
    })
    this._trackElevatorCue(handle)
    return true
  }

  onExtractionDoorsClose() {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('extraction_doors_close', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    this._trackElevatorCue(
      triggerExtractionDoorCloseCue(this.ctx, this.effectsGain, this.noiseBuffer)
    )
    return true
  }

  onExtractionLockPause() {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('extraction_lock_pause', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    this._trackElevatorCue(
      triggerExtractionLockPauseCue(this.ctx, this.effectsGain, this.noiseBuffer)
    )
    return true
  }

  onExtractionDepart(duration = 2.35) {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('extraction_depart', { gain: 1, duration })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    this._trackElevatorCue(
      triggerExtractionDepartCue(this.ctx, this.effectsGain, this.noiseBuffer, duration)
    )
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

      case 'player_damaged':
        return this.onPlayerDamage(event)

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
    if (this._combatDuckRemainingSec > 0) {
      this._combatDuckRemainingSec = Math.max(0, this._combatDuckRemainingSec - delta)
      if (this._combatDuckRemainingSec <= 0 && this._isCombatDucked) {
        this._restoreCombatAttackAudio()
      }
    }
    if (this._elevatorDuckRemainingSec > 0) {
      this._elevatorDuckRemainingSec = Math.max(0, this._elevatorDuckRemainingSec - delta)
      if (this._elevatorDuckRemainingSec <= 0 && this._isElevatorDucked) {
        this._restoreElevatorImpactAudio()
      }
    }
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
      this._stopActivePlayerBreath({ immediate: true })
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
    this._sortedEnemiesScratch.length = 0

    if (enemies) {
      for (const enemy of enemies) {
        if (!enemy || enemy.isDisposed) continue
        this._ambientEnemyList.push(enemy)
        this._sortedEnemiesScratch.push(enemy)
      }

      if (this._sortedEnemiesScratch.length > 1) {
        const lx = this._listenerPos.x
        const lz = this._listenerPos.z
        this._sortedEnemiesScratch.sort((a, b) => {
          const ap = a.worldPos
          const bp = b.worldPos
          const ad = ap ? (ap.x - lx) * (ap.x - lx) + (ap.z - lz) * (ap.z - lz) : Infinity
          const bd = bp ? (bp.x - lx) * (bp.x - lx) + (bp.z - lz) * (bp.z - lz) : Infinity
          return ad - bd
        })
      }

      for (let ei = 0; ei < this._sortedEnemiesScratch.length; ei += 1) {
        const enemy = this._sortedEnemiesScratch[ei]
        const enemyId = enemy.id
        const enemyType = enemy.type || 'stalker'
        const state = enemy.state
        const worldPos = enemy.worldPos

        let tracker = this._enemyStateMap.get(enemyId)
        if (!tracker) {
          tracker = {
            lastState: state,
            stepTimer: 0,
            lastChaseAlertAt: -10,
            lastInvestigateAlertAt: -10,
            lastAttackAt: -10,
            lastVocalAt: -10,
            lastBreathAt: -10,
          }
          this._enemyStateMap.set(enemyId, tracker)
        }

        let distToListener = Infinity
        if (worldPos) {
          distToListener = Math.hypot(
            worldPos.x - this._listenerPos.x,
            worldPos.z - this._listenerPos.z
          )
          if (distToListener < nearestEnemyDist) nearestEnemyDist = distToListener
        }

        if (state === 'chase' || state === 'attack') {
          anyChaseOrAttack = true
        } else if (state === 'investigate' || state === 'search') {
          anyInvestigateOrClose = true
        }

        // Edge-triggered state transition cues (never restarted every frame)
        if (state !== tracker.lastState) {
          if (
            state === 'chase' &&
            tracker.lastState !== 'attack' &&
            this._elapsedSec - tracker.lastChaseAlertAt >=
              ENEMY_AUDIO_LIMITS.chaseAlertCooldownSec
          ) {
            tracker.lastChaseAlertAt = this._elapsedSec
            this._dispatchEnemyCue({
              category: ENEMY_AUDIO_CATEGORIES.ALERT_CHASE,
              enemyId,
              enemyType,
              worldPos,
              spatialOptions: { maxDistance: 24, ttlMs: 650 },
              cueName: 'enemy_detect_chase',
              cueMeta: { enemyId, enemyType },
              priority: 2,
              triggerCue: (dest, onComplete) =>
                triggerEnemyAlertCue(this.ctx, dest, true, enemyType, {
                  enemyId,
                  onComplete,
                }),
            })
          } else if (
            state === 'investigate' &&
            (tracker.lastState === 'patrol' || tracker.lastState === 'idle') &&
            this._elapsedSec - tracker.lastInvestigateAlertAt >=
              ENEMY_AUDIO_LIMITS.investigateAlertCooldownSec
          ) {
            tracker.lastInvestigateAlertAt = this._elapsedSec
            this._dispatchEnemyCue({
              category: ENEMY_AUDIO_CATEGORIES.ALERT_INVESTIGATE,
              enemyId,
              enemyType,
              worldPos,
              spatialOptions: { maxDistance: 18, ttlMs: 500 },
              cueName: 'enemy_detect_investigate',
              cueMeta: { enemyId, enemyType },
              priority: 2,
              triggerCue: (dest, onComplete) =>
                triggerEnemyAlertCue(this.ctx, dest, false, enemyType, {
                  enemyId,
                  onComplete,
                }),
            })
          } else if (
            state === 'attack' &&
            this._elapsedSec - tracker.lastAttackAt >=
              ENEMY_AUDIO_LIMITS.attackWindupCooldownSec
          ) {
            tracker.lastAttackAt = this._elapsedSec
            this._dispatchEnemyCue({
              category: ENEMY_AUDIO_CATEGORIES.ATTACK_WINDUP,
              enemyId,
              enemyType,
              worldPos,
              spatialOptions: {
                maxDistance: 16,
                ttlMs: 700,
                targetBus: this.enemyAttackGain || this.effectsGain,
                sendToReverb: false,
              },
              cueName: 'enemy_attack_windup',
              cueMeta: { enemyId, enemyType },
              priority: 4,
              triggerCue: (dest, onComplete) =>
                triggerEnemyAttackCue(this.ctx, dest, this.noiseBuffer, false, enemyType, {
                  enemyId,
                  onComplete,
                }),
            })
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
            this._dispatchEnemyCue({
              category: ENEMY_AUDIO_CATEGORIES.FOOTSTEP,
              enemyId,
              enemyType,
              worldPos,
              spatialOptions: {
                refDistance: 2.2,
                maxDistance: isChasing ? 24 : 18,
                rolloff: 1.25,
                wallAttBase: 0.62,
                minOcclusionGain: 0.16,
                initialBlockedCutoff: 1650,
                minLowpassCutoff: 480,
                ttlMs: 500,
              },
              cueName: 'enemy_footstep',
              cueMeta: { enemyId, enemyType, isChasing },
              priority: 1,
              triggerCue: (dest, onComplete) =>
                triggerEnemyFootstep(this.ctx, dest, this.noiseBuffer, isChasing, enemyType, {
                  enemyId,
                  onComplete,
                }),
            })
          }
        }

        // Occasional enemy vocalizations during investigate, search, chase, or attack states
        if (
          (state === 'investigate' || state === 'search' || state === 'chase' || state === 'attack') &&
          worldPos &&
          distToListener <= 20.0
        ) {
          const isCombat = state === 'chase' || state === 'attack'
          const vocalCooldown = isCombat
            ? ENEMY_AUDIO_LIMITS.vocalCooldownSec * 0.55
            : ENEMY_AUDIO_LIMITS.vocalCooldownSec * 1.1
          if (
            this._elapsedSec - tracker.lastVocalAt >= vocalCooldown &&
            this._getActiveEnemyCueCount(ENEMY_AUDIO_CATEGORIES.VOCAL) < ENEMY_AUDIO_LIMITS.maxConcurrentVocals
          ) {
            const vocalChance = (isCombat ? 0.05 : 0.025) * Math.max(0.2, 1.0 - distToListener / 20.0)
            if (this._ambientRng() < vocalChance) {
              tracker.lastVocalAt = this._elapsedSec
              const variantList = isCombat ? ['snarl', 'burst'] : ['growl', 'snarl']
              const variantIdx = Math.floor(this._ambientRng() * variantList.length)
              const variant = variantList[Math.max(0, Math.min(variantList.length - 1, variantIdx))]
              this._dispatchEnemyCue({
                category: ENEMY_AUDIO_CATEGORIES.VOCAL,
                enemyId,
                enemyType,
                worldPos,
                spatialOptions: {
                  refDistance: 2.0,
                  maxDistance: 20,
                  rolloff: 1.35,
                  ttlMs: 800,
                  targetBus: this.enemyVocalGain || this.effectsGain,
                  sendToReverb: true,
                },
                cueName: 'enemy_vocal',
                cueMeta: { enemyId, enemyType, variant },
                priority: 3,
                triggerCue: (dest, onComplete) =>
                  triggerEnemyVocalCue(this.ctx, dest, this.noiseBuffer, enemyType, variant, {
                    enemyId,
                    onComplete,
                  }),
              })
            }
          }
        }

        // Occasional enemy breathing during patrol, investigate, search, chase, or attack states
        if (
          worldPos &&
          distToListener <= 16.0 &&
          (state === 'patrol' || state === 'investigate' || state === 'search' || state === 'chase')
        ) {
          const isCombat = state === 'chase'
          const breathCooldown = isCombat
            ? ENEMY_AUDIO_LIMITS.breathCooldownSec * 0.65
            : ENEMY_AUDIO_LIMITS.breathCooldownSec * 1.35
          const timeSinceVocal = this._elapsedSec - tracker.lastVocalAt
          const hasActiveVocal = Array.from(this._activeEnemyCues).some(
            (e) => e.enemyId === enemyId && e.category === ENEMY_AUDIO_CATEGORIES.VOCAL && e?.handle?.isActive?.()
          )
          if (
            timeSinceVocal >= 2.0 &&
            !hasActiveVocal &&
            this._elapsedSec - (tracker.lastBreathAt || -10) >= breathCooldown &&
            this._getActiveEnemyCueCount(ENEMY_AUDIO_CATEGORIES.BREATH) < ENEMY_AUDIO_LIMITS.maxConcurrentBreaths
          ) {
            const breathChance = (isCombat ? 0.08 : 0.035) * Math.max(0.2, 1.0 - distToListener / 16.0)
            if (this._ambientRng() < breathChance) {
              tracker.lastBreathAt = this._elapsedSec
              this._dispatchEnemyCue({
                category: ENEMY_AUDIO_CATEGORIES.BREATH,
                enemyId,
                enemyType,
                worldPos,
                spatialOptions: {
                  refDistance: 1.8,
                  maxDistance: 16,
                  rolloff: 1.4,
                  ttlMs: 700,
                  targetBus: this.enemyVocalGain || this.effectsGain,
                  sendToReverb: true,
                },
                cueName: 'enemy_breath',
                cueMeta: { enemyId, enemyType },
                priority: 1,
                triggerCue: (dest, onComplete) =>
                  triggerEnemyBreathCue(this.ctx, dest, this.noiseBuffer, enemyType, {
                    enemyId,
                    onComplete,
                  }),
              })
            }
          }
        }
      }
      this._sortedEnemiesScratch.length = 0
    }

    // Discrete attack hits
    if (context.attackHits?.length > 0) {
      for (let i = 0; i < context.attackHits.length; i += 1) {
        const hit = context.attackHits[i]
        const hitType = hit.enemyType || 'stalker'
        this._dispatchEnemyCue({
          category: ENEMY_AUDIO_CATEGORIES.ATTACK_HIT,
          enemyId: hit.enemyId,
          enemyType: hitType,
          worldPos: hit.position || this._listenerPos,
          spatialOptions: {
            maxDistance: 16,
            ttlMs: 600,
            targetBus: this.enemyAttackGain || this.effectsGain,
            sendToReverb: false,
          },
          cueName: 'enemy_attack_hit',
          cueMeta: { enemyId: hit.enemyId, enemyType: hitType },
          priority: 5,
          triggerCue: (dest, onComplete) =>
            triggerEnemyAttackCue(this.ctx, dest, this.noiseBuffer, true, hitType, {
              enemyId: hit.enemyId,
              onComplete,
            }),
        })
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
              targetBus: this.hazardAudioGain || this.effectsGain,
              sendToReverb: false,
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

    // 4a. Procedural Player Breathing (adaptive cadence and intensity)
    this._updatePlayerBreathing(delta, context, anyChaseOrAttack, nearestEnemyDist)

    // 4b. Overhead industrial ceiling light ballast hum & synchronized flicker SFX
    if (context.ceilingLightsGroup) {
      this.updateCeilingLights(context.ceilingLightsGroup, context)
    }

    // 4c. Unified procedural ambient horror scheduler (calm, spatialized, context-aware)
    this._updateAmbientHorror(delta, context, anyChaseOrAttack, anyInvestigateOrClose, nearestEnemyDist)

    // 4d. Independent procedural distant thunder & lightning crack scheduler
    this._updateThunderAtmosphere(delta, context, anyChaseOrAttack)

    // 4e. Continuous enclosed subterranean rainfall bed contextual ducking & subtle breath drift
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

  _getEnemyConcurrencyBucket(category) {
    if (
      category === ENEMY_AUDIO_CATEGORIES.ALERT_CHASE ||
      category === ENEMY_AUDIO_CATEGORIES.ALERT_INVESTIGATE
    ) {
      return 'alert'
    }
    if (
      category === ENEMY_AUDIO_CATEGORIES.ATTACK_WINDUP ||
      category === ENEMY_AUDIO_CATEGORIES.ATTACK_HIT
    ) {
      return 'attack'
    }
    if (category === ENEMY_AUDIO_CATEGORIES.VOCAL) {
      return 'vocal'
    }
    if (category === ENEMY_AUDIO_CATEGORIES.BREATH) {
      return 'breath'
    }
    return 'footstep'
  }

  _getEnemyBucketLimit(bucket) {
    if (bucket === 'alert') return ENEMY_AUDIO_LIMITS.maxConcurrentAlerts
    if (bucket === 'attack') return ENEMY_AUDIO_LIMITS.maxConcurrentAttacks
    if (bucket === 'vocal') return ENEMY_AUDIO_LIMITS.maxConcurrentVocals
    if (bucket === 'breath') return ENEMY_AUDIO_LIMITS.maxConcurrentBreaths
    return ENEMY_AUDIO_LIMITS.maxConcurrentFootsteps
  }

  _pruneActiveEnemyCues() {
    if (!this._activeEnemyCues || this._activeEnemyCues.size === 0) return
    for (const entry of Array.from(this._activeEnemyCues)) {
      if (!entry?.handle?.isActive?.()) {
        this._stopEnemyCueEntry(entry, { immediate: true })
      }
    }
  }

  _getActiveEnemyCueCount(category = null) {
    this._pruneActiveEnemyCues()
    if (!category) return this._activeEnemyCues.size
    let count = 0
    for (const entry of this._activeEnemyCues) {
      if (entry.category === category) count += 1
    }
    return count
  }

  _evictLowestPriorityEnemyCue(candidates, incomingGain, incomingPriority) {
    let victim = null
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i]
      if (!victim) {
        victim = c
        continue
      }
      if (c.priority < victim.priority) {
        victim = c
      } else if (c.priority === victim.priority && c.gain < victim.gain - 1e-4) {
        victim = c
      } else if (
        c.priority === victim.priority &&
        Math.abs(c.gain - victim.gain) <= 1e-4 &&
        c.startedAt < victim.startedAt
      ) {
        victim = c
      }
    }
    if (!victim) return false
    const beatsVictim =
      incomingPriority > victim.priority ||
      (incomingPriority === victim.priority && incomingGain > victim.gain + 0.02)
    if (!beatsVictim) return false

    this._stopEnemyCueEntry(victim, { immediate: true })
    return true
  }

  _acquireEnemyCueSlot(category, gain = 1, priority = 1) {
    this._pruneActiveEnemyCues()
    const bucket = this._getEnemyConcurrencyBucket(category)
    const bucketLimit = this._getEnemyBucketLimit(bucket)

    const bucketEntries = []
    for (const entry of this._activeEnemyCues) {
      if (this._getEnemyConcurrencyBucket(entry.category) === bucket) {
        bucketEntries.push(entry)
      }
    }
    if (bucketEntries.length >= bucketLimit) {
      if (!this._evictLowestPriorityEnemyCue(bucketEntries, gain, priority)) {
        return false
      }
    }

    if (this._activeEnemyCues.size >= ENEMY_AUDIO_LIMITS.maxActiveEnemyCues) {
      if (
        !this._evictLowestPriorityEnemyCue(
          Array.from(this._activeEnemyCues),
          gain,
          priority
        )
      ) {
        return false
      }
    }

    return true
  }

  _stopEnemyCueEntry(entry, { immediate = false } = {}) {
    if (!entry || entry.cleaned) return
    entry.cleaned = true
    this._activeEnemyCues.delete(entry)
    const isImm = Boolean(immediate || this.isDisposed)
    try {
      entry.handle?.stop?.({
        immediate: isImm,
        delayMs: 45,
        scheduleDisconnect: isImm
          ? null
          : (disconnectFn, delayMs) => {
              this._scheduleFadeCleanup(disconnectFn, delayMs)
            },
      })
    } catch {
      // Ignore already-stopped enemy cue handle errors
    }
    if (typeof entry.cleanup === 'function') {
      if (isImm) {
        try {
          entry.cleanup()
        } catch {
          // Ignore already-cleaned positional destination errors
        }
      } else {
        this._scheduleFadeCleanup(entry.cleanup, 45)
      }
    }
  }

  _stopActiveEnemyCues({ immediate = false, category = null } = {}) {
    if (!this._activeEnemyCues || this._activeEnemyCues.size === 0) return
    const entries = Array.from(this._activeEnemyCues)
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (category && entry.category !== category) continue
      this._stopEnemyCueEntry(entry, { immediate })
    }
  }

  _dispatchEnemyCue({
    category,
    enemyId,
    enemyType,
    worldPos,
    spatialOptions = {},
    cueName,
    cueMeta = {},
    priority = 1,
    triggerCue,
  }) {
    const previewAttenuation = computeSpatialAudioAttenuation(
      worldPos,
      this._listenerPos,
      this.maze,
      spatialOptions
    )

    const canSynthesize =
      this.isUnlocked &&
      this.ctx &&
      !this.isPaused &&
      !this._isGameOver &&
      !this._hasWon &&
      previewAttenuation.gain > 0.005

    if (canSynthesize && !this._acquireEnemyCueSlot(category, previewAttenuation.gain, priority)) {
      return false
    }

    const entry = {
      handle: null,
      cleanup: null,
      category,
      enemyId,
      enemyType,
      priority,
      gain: previewAttenuation.gain,
      startedAt: this._elapsedSec,
      cleaned: false,
    }

    const spatial = this._createPositionalDestination(worldPos, {
      ...spatialOptions,
      onCleanup: () => {
        if (entry.cleaned) return
        entry.cleaned = true
        this._activeEnemyCues.delete(entry)
        try {
          entry.handle?.stop?.({ immediate: true })
        } catch {
          // Ignore cleanup stop errors
        }
      },
    })

    const recordedGain = spatial.attenuation?.gain ?? previewAttenuation.gain
    const recordedWalls = spatial.attenuation?.wallCount ?? previewAttenuation.wallCount

    if (!spatial.dest) {
      this._recordCue(cueName, {
        ...cueMeta,
        gain: recordedGain,
        wallCount: recordedWalls,
      })
      return false
    }

    entry.cleanup = spatial.cleanup
    const handle = triggerCue?.(spatial.dest, () => {
      if (entry.cleaned) return
      entry.cleaned = true
      this._activeEnemyCues.delete(entry)
      if (typeof entry.cleanup === 'function') {
        try {
          entry.cleanup()
        } catch {
          // Ignore positional cleanup errors
        }
      }
    })
    if (handle) {
      entry.handle = handle
      entry.gain = recordedGain
      this._activeEnemyCues.add(entry)
    }

    this._recordCue(cueName, {
      ...cueMeta,
      gain: recordedGain,
      wallCount: recordedWalls,
    })
    return Boolean(handle)
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
      this._elapsedSec - this._lastGlobalLightSputterAt >= 0.45 &&
      this._thunderClockSec >= minCrackElapsed &&
      this._thunderClockSec >= this._thunderNextCrackAllowedAtSec
    const crackChance = Math.max(
      0,
      Math.min(1, Number(this._thunderConfig.crackChanceWhenReady ?? 0.58))
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

  _updatePlayerBreathing(delta, context, anyChaseOrAttack, nearestEnemyDist) {
    if (this._playerStrainedBreathingRemainingSec > 0) {
      this._playerStrainedBreathingRemainingSec = Math.max(
        0,
        this._playerStrainedBreathingRemainingSec - delta
      )
    }

    if (this._activePlayerBreathHandle && !this._activePlayerBreathHandle.isActive?.()) {
      this._activePlayerBreathHandle = null
    }

    // Coordinate with player vocal reactions: breathing never overlaps vocal reactions
    const hasActiveVocal = Boolean(this._activeVocalCue?.isActive?.())
    if (hasActiveVocal) {
      if (this._activePlayerBreathHandle?.isActive?.()) {
        this._stopActivePlayerBreath({ immediate: true })
      }
      this._playerBreathTimer = 0.35
      return
    }

    if (
      this.isDisposed ||
      this.isPaused ||
      this._isGameOver ||
      this._hasWon ||
      !this.isUnlocked ||
      !this.ctx ||
      (!this.playerBreathGain && !this.effectsGain)
    ) {
      return
    }

    const stamina = typeof context.stamina === 'number' ? context.stamina : 100
    const maxStamina = typeof context.maxStamina === 'number' ? context.maxStamina : 100
    const staminaRatio = Math.max(0, Math.min(1, stamina / (maxStamina || 100)))
    const isExhausted = Boolean(context.isExhausted || staminaRatio <= 0.05)
    const isLowStamina = staminaRatio < 0.35
    const motion = context.playerMotion
    const isRunning = Boolean(motion?.isSprinting && motion?.moved && !this._isHidden)
    const isWalking = Boolean(motion?.moved && !motion?.isSprinting && !this._isHidden)
    const isDanger = Boolean(
      anyChaseOrAttack ||
      (Number.isFinite(nearestEnemyDist) && nearestEnemyDist <= 10.0) ||
      context.activeHorrorEventType
    )
    const isStrained = this._playerStrainedBreathingRemainingSec > 0

    // Determine dynamic mode
    let breathMode
    if (isStrained) {
      breathMode = 'strained'
    } else if (isExhausted) {
      breathMode = 'exhausted'
    } else if (isLowStamina) {
      breathMode = 'low_stamina'
    } else if (isDanger) {
      breathMode = 'danger'
    } else if (isRunning) {
      breathMode = 'running'
    } else if (isWalking) {
      breathMode = 'walking'
    } else {
      breathMode = 'resting'
    }
    this._lastPlayerBreathMode = breathMode

    // Determine dynamic cadence (breath interval in seconds)
    let targetInterval
    if (isStrained) {
      targetInterval = 1.45
    } else if (isExhausted) {
      targetInterval = 1.15
    } else if (isLowStamina) {
      targetInterval = 1.2 + (staminaRatio / 0.35) * 0.75
    } else if (isDanger) {
      targetInterval = isRunning ? 1.35 : isWalking ? 1.85 : 2.4
    } else if (isRunning) {
      targetInterval = 1.85
    } else if (isWalking) {
      targetInterval = 2.9
    } else {
      targetInterval = 4.2
    }

    this._playerBreathTimer += delta
    if (
      this._playerBreathTimer >= targetInterval &&
      !this._activePlayerBreathHandle?.isActive?.()
    ) {
      this._playerBreathTimer = 0
      const destBus = this.playerBreathGain || this.playerVocalGain || this.effectsGain
      const handle = triggerPlayerBreathCue(this.ctx, destBus, this.noiseBuffer, {
        mode: breathMode,
        phase: 'cycle',
        isExhausted,
        isRunning,
        isWalking,
        isDanger,
        isStrained,
        stamina: Math.round(staminaRatio * 100),
        onComplete: () => {
          if (this._activePlayerBreathHandle === handle) {
            this._activePlayerBreathHandle = null
          }
        },
      })
      if (handle) {
        this._activePlayerBreathHandle = handle
        this._recordCue('player_breath', {
          mode: breathMode,
          stamina: Math.round(staminaRatio * 100),
          isExhausted,
          isRunning,
          isDanger,
          isStrained,
        })
      }
    }
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
    const attOpts = this._sampleAnchorAttOpts
    attOpts.maxDistance = maxDist + 4
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
        const att = computeSpatialAudioAttenuationInto(
          probePos,
          this._listenerPos,
          this.maze,
          attOpts,
          this._tmpAttenuation
        )
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
        const att = computeSpatialAudioAttenuationInto(
          probePos,
          this._listenerPos,
          this.maze,
          attOpts,
          this._tmpAttenuation
        )
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
    const attOpts = this._fallbackAnchorAttOpts
    attOpts.maxDistance = Math.max(26.0, radius + 14.0)
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
      const att = computeSpatialAudioAttenuationInto(
        probePos,
        this._listenerPos,
        this.maze,
        attOpts,
        this._tmpAttenuation
      )
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

      const att = computeSpatialAudioAttenuationInto(
        this._lightSourcePos,
        this._listenerPos,
        this.maze,
        this._lightTransientAttOpts,
        this._tmpAttenuation
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
      if (!this._lightVoiceSilenced[slotForB] || 0.05 < this._lightVoiceLastSilenceTau[slotForB]) {
        this._lightVoicePool[slotForB].silence(0.05)
        this._lightVoiceSilenced[slotForB] = true
        this._lightVoiceLastSilenceTau[slotForB] = 0.05
        this._lightVoiceLastState[slotForB].gain = 0
        this._lightVoiceLastState[slotForB].fixtureKey = -1
      }
      this._lightVoiceAssigned[slotForB] = -1
    }
  }

  _updateLightVoiceSlot(voiceSlot, candidateRank, reducedMotion) {
    const voice = this._lightVoicePool[voiceSlot]
    const f = this._lightBestFixtures[candidateRank]
    const fKey = this._lightBestIndices[candidateRank]
    if (!voice || !f || fKey < 0) {
      if (voice && (!this._lightVoiceSilenced[voiceSlot] || 0.05 < this._lightVoiceLastSilenceTau[voiceSlot])) {
        voice.silence?.(0.05)
        this._lightVoiceSilenced[voiceSlot] = true
        this._lightVoiceLastSilenceTau[voiceSlot] = 0.05
        this._lightVoiceLastState[voiceSlot].gain = 0
        this._lightVoiceLastState[voiceSlot].fixtureKey = -1
      }
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

    const x = Number(f.x) || 0
    const y = Number.isFinite(f.lightY) ? f.lightY : 3.4
    const z = Number(f.z) || 0
    const gain = this._lightBestGains[candidateRank]
    const cutoff = Math.min(timbreCutoff - warmDip * 140, wallCutoff)
    const buzzLevel =
      f.condition === 'flickering'
        ? reducedMotion
          ? 0.22
          : 0.27 + warmDip * 0.14
        : 0.18

    const prev = this._lightVoiceLastState[voiceSlot]
    if (
      !this._lightVoiceSilenced[voiceSlot] &&
      prev.fixtureKey === fKey &&
      Math.abs(x - prev.x) <= 1e-4 &&
      Math.abs(y - prev.y) <= 1e-4 &&
      Math.abs(z - prev.z) <= 1e-4 &&
      Math.abs(gain - prev.gain) <= 1e-5 &&
      Math.abs(cutoff - prev.cutoff) <= 0.5 &&
      Math.abs(humHz - prev.humHz) <= 1e-3 &&
      Math.abs(buzzHz - prev.buzzHz) <= 1e-3 &&
      Math.abs(buzzLevel - prev.buzzLevel) <= 1e-4
    ) {
      return
    }

    this._lightVoicePayload.x = x
    this._lightVoicePayload.y = y
    this._lightVoicePayload.z = z
    this._lightVoicePayload.gain = gain
    this._lightVoicePayload.cutoff = cutoff
    this._lightVoicePayload.humHz = humHz
    this._lightVoicePayload.buzzHz = buzzHz
    this._lightVoicePayload.buzzLevel = buzzLevel
    this._lightVoicePayload.tau = 0.045

    voice.update(this._lightVoicePayload)

    prev.fixtureKey = fKey
    prev.x = x
    prev.y = y
    prev.z = z
    prev.gain = gain
    prev.cutoff = cutoff
    prev.humHz = humHz
    prev.buzzHz = buzzHz
    prev.buzzLevel = buzzLevel
    this._lightVoiceSilenced[voiceSlot] = gain <= 0
    this._lightVoiceLastSilenceTau[voiceSlot] = Infinity
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.isUnlocked = false

    this._stopActiveAmbientCues({ immediate: true })
    this._stopActiveThunderCues({ immediate: true })
    this._stopActiveEnemyCues({ immediate: true })
    this._stopActiveElevatorCues({ immediate: true })
    this._stopActiveVocalCue({ immediate: true })
    this._stopActivePlayerBreath({ immediate: true })
    this.stopAudition({ immediate: true })
    this._clearTransientTimers()
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()
    this._stopCeilingLightVoices()
    this._ambientLastTriggeredAt.clear()
    this._lastAmbientVariantByCategory.clear()
    this._ambientAnchors = { vents: [], ducts: [], corridors: [] }
    this._ambientEnemyList.length = 0
    this._sortedEnemiesScratch.length = 0

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
      this.playerVocalGain?.disconnect()
      this.playerBreathGain?.disconnect()
      this.enemyAttackGain?.disconnect()
      this.enemyVocalGain?.disconnect()
      this.hazardAudioGain?.disconnect()
      this.elevatorImpactGain?.disconnect()
      this.ambienceGain?.disconnect()
      this.effectsGain?.disconnect()
      this.musicGain?.disconnect()
      this.masterGain?.disconnect()
      this.compressor?.disconnect()
    } catch {
      // Ignore disconnect errors on already-disposed nodes
    }

    this._detachContextStateListener()

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
    this.playerVocalGain = null
    this.playerBreathGain = null
    this.enemyAttackGain = null
    this.enemyVocalGain = null
    this.hazardAudioGain = null
    this.elevatorImpactGain = null
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
    this._activeAuditionHandles = null
    this._auditionMixTimers = null
    this.maze = null
    return true
  }
}
