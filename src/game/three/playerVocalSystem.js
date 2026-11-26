/**
 * Centralized Player Character Vocal Synthesis & Monophonic Playback Controller.
 *
 * Sole owner of:
 * - Foundational deep, mature, masculine, chest-resonant vocal synthesis
 * - One-shot player vocalization recipes (elevator landing, light/heavy damage with variant rotation, death)
 * - Continuous/cadenced player breathing profiles, priority state resolution, intensity smoothing, and cadence timers
 * - Strict monophonic active handle management (max 1 active cue at any moment)
 * - Priority evaluation and clean preemption
 * - Post-vocal breathing cadence hold timers and safe Web Audio node disposal
 *
 * Designed to route exclusively through `HorrorAudioEngine.playerVoiceGain -> effectsGain`
 * without ducking or altering enemy, hazard, or mechanical elevator audio buses.
 */

export const PLAYER_VOCAL_PRIORITIES = Object.freeze({
  IDLE: 0,
  BREATH: 1,
  EXERTION_BREATH: 2,
  ELEVATOR_LANDING: 3,
  DAMAGE: 4,
  DEATH: 5,
})

export const PLAYER_VOCAL_RECIPE_IDS = Object.freeze({
  ELEVATOR_LANDING: 'elevator_landing',
  DAMAGE_LIGHT: 'damage_light',
  DAMAGE_HEAVY: 'damage_heavy',
  DEATH: 'death',
})

export const PLAYER_BREATHING_STATES = Object.freeze({
  RESTING: 'resting',
  WALKING: 'walking',
  RUNNING: 'running',
  DANGER: 'danger',
  LOW_STAMINA: 'low_stamina',
  EXHAUSTED: 'exhausted',
  STRAINED: 'strained',
})

export const HEAVY_DAMAGE_THRESHOLD = 28
export const STRAINED_BREATHING_DURATION_SEC = 2.5
export const EXHAUSTED_STAMINA_THRESHOLD = 5
export const LOW_STAMINA_RATIO_THRESHOLD = 0.35
export const DANGER_ENEMY_DISTANCE_THRESHOLD = 8.5
export const MIN_SIGH_COOLDOWN_SEC = 10.0
export const EXERTION_RELIEF_THRESHOLD_SEC = 1.6

export const DEFAULT_PLAYER_VOICE_SPEC = Object.freeze({
  id: 'foundation_chest_voice',
  kind: 'vocal',
  recipeType: 'foundation',
  voiced: true,
  variantIndex: 0,
  priority: PLAYER_VOCAL_PRIORITIES.ELEVATOR_LANDING,
  startDelaySec: 0,
  durationSec: 0.42,
  attackSec: 0.028,
  releaseSec: 0.09,
  f0StartHz: 128,
  f0PeakHz: 134,
  f0EndHz: 110,
  f0PeakAt: 0.18,
  chestFundamentalWeight: 0.86,
  secondHarmonicWeight: 0.78,
  thirdHarmonicWeight: 0.54,
  upperGlottalWeight: 0.22,
  aspirationGain: 0.085,
  f1Hz: 545,
  f1Q: 1.85,
  f2Hz: 1110,
  f2Q: 1.9,
  warmLowpassHz: 1960,
  gain: 0.34,
  postVocalBreathHoldSec: 0.35,
})

/**
 * Centralized one-shot vocalization recipes sharing one consistent mature, masculine,
 * mid-low chest-resonant voice identity (F0 95–142 Hz, F1 498–562 Hz, F2 1015–1138 Hz).
 */
export const PLAYER_ONE_SHOT_RECIPES = Object.freeze({
  elevatorLanding: Object.freeze({
    id: 'elevator_landing',
    kind: 'elevator_landing',
    recipeType: PLAYER_VOCAL_RECIPE_IDS.ELEVATOR_LANDING,
    voiced: true,
    variantIndex: 0,
    priority: PLAYER_VOCAL_PRIORITIES.ELEVATOR_LANDING,
    startDelaySec: 0.055,
    durationSec: 0.36,
    attackSec: 0.026,
    releaseSec: 0.11,
    f0StartHz: 124,
    f0PeakHz: 130,
    f0EndHz: 106,
    f0PeakAt: 0.16,
    chestFundamentalWeight: 0.87,
    secondHarmonicWeight: 0.77,
    thirdHarmonicWeight: 0.54,
    upperGlottalWeight: 0.22,
    aspirationGain: 0.075,
    f1Hz: 535,
    f1Q: 1.85,
    f2Hz: 1085,
    f2Q: 1.9,
    warmLowpassHz: 1900,
    gain: 0.34,
    postVocalBreathHoldSec: 0.42,
  }),

  damageLightVariants: Object.freeze([
    Object.freeze({
      id: 'damage_light_0',
      kind: 'damage_light',
      recipeType: PLAYER_VOCAL_RECIPE_IDS.DAMAGE_LIGHT,
      voiced: true,
      variantIndex: 0,
      priority: PLAYER_VOCAL_PRIORITIES.DAMAGE,
      startDelaySec: 0,
      durationSec: 0.28,
      attackSec: 0.021,
      releaseSec: 0.084,
      f0StartHz: 132,
      f0PeakHz: 139,
      f0EndHz: 114,
      f0PeakAt: 0.15,
      chestFundamentalWeight: 0.85,
      secondHarmonicWeight: 0.79,
      thirdHarmonicWeight: 0.56,
      upperGlottalWeight: 0.24,
      aspirationGain: 0.076,
      f1Hz: 554,
      f1Q: 1.88,
      f2Hz: 1122,
      f2Q: 1.92,
      warmLowpassHz: 1980,
      gain: 0.35,
      postVocalBreathHoldSec: 0.38,
    }),
    Object.freeze({
      id: 'damage_light_1',
      kind: 'damage_light',
      recipeType: PLAYER_VOCAL_RECIPE_IDS.DAMAGE_LIGHT,
      voiced: true,
      variantIndex: 1,
      priority: PLAYER_VOCAL_PRIORITIES.DAMAGE,
      startDelaySec: 0,
      durationSec: 0.30,
      attackSec: 0.023,
      releaseSec: 0.090,
      f0StartHz: 129,
      f0PeakHz: 136,
      f0EndHz: 111,
      f0PeakAt: 0.17,
      chestFundamentalWeight: 0.86,
      secondHarmonicWeight: 0.78,
      thirdHarmonicWeight: 0.55,
      upperGlottalWeight: 0.23,
      aspirationGain: 0.080,
      f1Hz: 546,
      f1Q: 1.85,
      f2Hz: 1106,
      f2Q: 1.9,
      warmLowpassHz: 1960,
      gain: 0.35,
      postVocalBreathHoldSec: 0.38,
    }),
    Object.freeze({
      id: 'damage_light_2',
      kind: 'damage_light',
      recipeType: PLAYER_VOCAL_RECIPE_IDS.DAMAGE_LIGHT,
      voiced: true,
      variantIndex: 2,
      priority: PLAYER_VOCAL_PRIORITIES.DAMAGE,
      startDelaySec: 0,
      durationSec: 0.27,
      attackSec: 0.020,
      releaseSec: 0.080,
      f0StartHz: 135,
      f0PeakHz: 142,
      f0EndHz: 117,
      f0PeakAt: 0.14,
      chestFundamentalWeight: 0.84,
      secondHarmonicWeight: 0.80,
      thirdHarmonicWeight: 0.57,
      upperGlottalWeight: 0.25,
      aspirationGain: 0.074,
      f1Hz: 562,
      f1Q: 1.9,
      f2Hz: 1138,
      f2Q: 1.94,
      warmLowpassHz: 2010,
      gain: 0.35,
      postVocalBreathHoldSec: 0.38,
    }),
  ]),

  damageHeavyVariants: Object.freeze([
    Object.freeze({
      id: 'damage_heavy_0',
      kind: 'damage_heavy',
      recipeType: PLAYER_VOCAL_RECIPE_IDS.DAMAGE_HEAVY,
      voiced: true,
      variantIndex: 0,
      priority: PLAYER_VOCAL_PRIORITIES.DAMAGE,
      startDelaySec: 0,
      durationSec: 0.50,
      attackSec: 0.030,
      releaseSec: 0.165,
      f0StartHz: 119,
      f0PeakHz: 126,
      f0EndHz: 100,
      f0PeakAt: 0.21,
      chestFundamentalWeight: 0.89,
      secondHarmonicWeight: 0.77,
      thirdHarmonicWeight: 0.53,
      upperGlottalWeight: 0.21,
      aspirationGain: 0.090,
      f1Hz: 518,
      f1Q: 1.82,
      f2Hz: 1054,
      f2Q: 1.88,
      warmLowpassHz: 1840,
      gain: 0.37,
      postVocalBreathHoldSec: 0.48,
    }),
    Object.freeze({
      id: 'damage_heavy_1',
      kind: 'damage_heavy',
      recipeType: PLAYER_VOCAL_RECIPE_IDS.DAMAGE_HEAVY,
      voiced: true,
      variantIndex: 1,
      priority: PLAYER_VOCAL_PRIORITIES.DAMAGE,
      startDelaySec: 0,
      durationSec: 0.53,
      attackSec: 0.032,
      releaseSec: 0.175,
      f0StartHz: 117,
      f0PeakHz: 123,
      f0EndHz: 98,
      f0PeakAt: 0.23,
      chestFundamentalWeight: 0.90,
      secondHarmonicWeight: 0.76,
      thirdHarmonicWeight: 0.52,
      upperGlottalWeight: 0.20,
      aspirationGain: 0.094,
      f1Hz: 510,
      f1Q: 1.8,
      f2Hz: 1040,
      f2Q: 1.85,
      warmLowpassHz: 1820,
      gain: 0.37,
      postVocalBreathHoldSec: 0.48,
    }),
    Object.freeze({
      id: 'damage_heavy_2',
      kind: 'damage_heavy',
      recipeType: PLAYER_VOCAL_RECIPE_IDS.DAMAGE_HEAVY,
      voiced: true,
      variantIndex: 2,
      priority: PLAYER_VOCAL_PRIORITIES.DAMAGE,
      startDelaySec: 0,
      durationSec: 0.48,
      attackSec: 0.028,
      releaseSec: 0.155,
      f0StartHz: 121,
      f0PeakHz: 128,
      f0EndHz: 102,
      f0PeakAt: 0.20,
      chestFundamentalWeight: 0.88,
      secondHarmonicWeight: 0.78,
      thirdHarmonicWeight: 0.54,
      upperGlottalWeight: 0.22,
      aspirationGain: 0.088,
      f1Hz: 526,
      f1Q: 1.85,
      f2Hz: 1068,
      f2Q: 1.9,
      warmLowpassHz: 1865,
      gain: 0.37,
      postVocalBreathHoldSec: 0.48,
    }),
  ]),

  death: Object.freeze({
    id: 'death_collapse',
    kind: 'death',
    recipeType: PLAYER_VOCAL_RECIPE_IDS.DEATH,
    voiced: true,
    variantIndex: 0,
    priority: PLAYER_VOCAL_PRIORITIES.DEATH,
    startDelaySec: 0,
    durationSec: 0.86,
    attackSec: 0.036,
    releaseSec: 0.38,
    f0StartHz: 118,
    f0PeakHz: 122,
    f0EndHz: 95,
    f0PeakAt: 0.14,
    chestFundamentalWeight: 0.90,
    secondHarmonicWeight: 0.74,
    thirdHarmonicWeight: 0.50,
    upperGlottalWeight: 0.19,
    aspirationGain: 0.11,
    f1Hz: 498,
    f1Q: 1.78,
    f2Hz: 1015,
    f2Q: 1.84,
    warmLowpassHz: 1760,
    gain: 0.38,
    postVocalBreathHoldSec: 1.5,
  }),
})

/**
 * Centralized sigh-only player breathing profiles.
 * Zero voiced vocalization, zero pitched hum, zero chest-tone oscillators,
 * and zero continuous loops — purely soft airflow/noise triggered only on
 * meaningful transitions with generous cooldowns.
 */
export const PLAYER_BREATHING_PROFILES = Object.freeze({
  [PLAYER_BREATHING_STATES.RESTING]: Object.freeze({
    id: 'breath_resting',
    state: PLAYER_BREATHING_STATES.RESTING,
    kind: 'breath',
    recipeType: 'breath_resting',
    voiced: false,
    continuous: false,
    priority: PLAYER_VOCAL_PRIORITIES.BREATH,
    intervalSec: 12.0,
    cooldownSec: 12.0,
    intensity: 0.18,
    muffled: false,
    canSilenceWhenCalm: true,
    durationSec: 0.72,
    attackSec: 0.18,
    releaseSec: 0.38,
    f0StartHz: 0,
    f0PeakHz: 0,
    f0EndHz: 0,
    f0PeakAt: 0.25,
    chestFundamentalWeight: 0,
    secondHarmonicWeight: 0,
    thirdHarmonicWeight: 0,
    upperGlottalWeight: 0,
    aspirationGain: 0.24,
    f1Hz: 420,
    f1Q: 0.95,
    f2Hz: 860,
    f2Q: 0.9,
    warmLowpassHz: 920,
    gain: 0.055,
    postVocalBreathHoldSec: 0.0,
  }),

  [PLAYER_BREATHING_STATES.WALKING]: Object.freeze({
    id: 'breath_walking',
    state: PLAYER_BREATHING_STATES.WALKING,
    kind: 'breath',
    recipeType: 'breath_walking',
    voiced: false,
    continuous: false,
    priority: PLAYER_VOCAL_PRIORITIES.BREATH,
    intervalSec: 12.0,
    cooldownSec: 12.0,
    intensity: 0.24,
    muffled: false,
    canSilenceWhenCalm: true,
    durationSec: 0.66,
    attackSec: 0.16,
    releaseSec: 0.34,
    f0StartHz: 0,
    f0PeakHz: 0,
    f0EndHz: 0,
    f0PeakAt: 0.24,
    chestFundamentalWeight: 0,
    secondHarmonicWeight: 0,
    thirdHarmonicWeight: 0,
    upperGlottalWeight: 0,
    aspirationGain: 0.26,
    f1Hz: 440,
    f1Q: 0.95,
    f2Hz: 900,
    f2Q: 0.9,
    warmLowpassHz: 980,
    gain: 0.060,
    postVocalBreathHoldSec: 0.0,
  }),

  [PLAYER_BREATHING_STATES.RUNNING]: Object.freeze({
    id: 'breath_running',
    state: PLAYER_BREATHING_STATES.RUNNING,
    kind: 'breath',
    recipeType: 'breath_running',
    voiced: false,
    continuous: false,
    priority: PLAYER_VOCAL_PRIORITIES.BREATH,
    intervalSec: 12.0,
    cooldownSec: 12.0,
    intensity: 0.42,
    muffled: false,
    canSilenceWhenCalm: false,
    durationSec: 0.60,
    attackSec: 0.13,
    releaseSec: 0.31,
    f0StartHz: 0,
    f0PeakHz: 0,
    f0EndHz: 0,
    f0PeakAt: 0.22,
    chestFundamentalWeight: 0,
    secondHarmonicWeight: 0,
    thirdHarmonicWeight: 0,
    upperGlottalWeight: 0,
    aspirationGain: 0.30,
    f1Hz: 465,
    f1Q: 1.0,
    f2Hz: 960,
    f2Q: 0.95,
    warmLowpassHz: 1080,
    gain: 0.075,
    postVocalBreathHoldSec: 0.0,
  }),

  [PLAYER_BREATHING_STATES.DANGER]: Object.freeze({
    id: 'breath_danger',
    state: PLAYER_BREATHING_STATES.DANGER,
    kind: 'breath',
    recipeType: 'breath_danger',
    voiced: false,
    continuous: false,
    priority: PLAYER_VOCAL_PRIORITIES.BREATH,
    intervalSec: 12.0,
    cooldownSec: 12.0,
    intensity: 0.48,
    muffled: false,
    canSilenceWhenCalm: false,
    durationSec: 0.58,
    attackSec: 0.12,
    releaseSec: 0.30,
    f0StartHz: 0,
    f0PeakHz: 0,
    f0EndHz: 0,
    f0PeakAt: 0.22,
    chestFundamentalWeight: 0,
    secondHarmonicWeight: 0,
    thirdHarmonicWeight: 0,
    upperGlottalWeight: 0,
    aspirationGain: 0.31,
    f1Hz: 475,
    f1Q: 1.0,
    f2Hz: 980,
    f2Q: 0.95,
    warmLowpassHz: 1120,
    gain: 0.080,
    postVocalBreathHoldSec: 0.0,
  }),

  [PLAYER_BREATHING_STATES.LOW_STAMINA]: Object.freeze({
    id: 'breath_low_stamina',
    state: PLAYER_BREATHING_STATES.LOW_STAMINA,
    kind: 'breath',
    recipeType: 'breath_low_stamina',
    voiced: false,
    continuous: false,
    priority: PLAYER_VOCAL_PRIORITIES.EXERTION_BREATH,
    intervalSec: 12.0,
    cooldownSec: 12.0,
    intensity: 0.62,
    muffled: false,
    canSilenceWhenCalm: false,
    durationSec: 0.64,
    attackSec: 0.13,
    releaseSec: 0.34,
    f0StartHz: 0,
    f0PeakHz: 0,
    f0EndHz: 0,
    f0PeakAt: 0.22,
    chestFundamentalWeight: 0,
    secondHarmonicWeight: 0,
    thirdHarmonicWeight: 0,
    upperGlottalWeight: 0,
    aspirationGain: 0.32,
    f1Hz: 480,
    f1Q: 1.0,
    f2Hz: 990,
    f2Q: 0.95,
    warmLowpassHz: 1140,
    gain: 0.085,
    postVocalBreathHoldSec: 0.0,
  }),

  [PLAYER_BREATHING_STATES.EXHAUSTED]: Object.freeze({
    id: 'breath_exhausted',
    state: PLAYER_BREATHING_STATES.EXHAUSTED,
    kind: 'breath',
    recipeType: 'breath_exhausted',
    voiced: false,
    continuous: false,
    priority: PLAYER_VOCAL_PRIORITIES.EXERTION_BREATH,
    intervalSec: 14.0,
    cooldownSec: 14.0,
    intensity: 0.82,
    muffled: false,
    canSilenceWhenCalm: false,
    durationSec: 0.76,
    attackSec: 0.14,
    releaseSec: 0.42,
    f0StartHz: 0,
    f0PeakHz: 0,
    f0EndHz: 0,
    f0PeakAt: 0.20,
    chestFundamentalWeight: 0,
    secondHarmonicWeight: 0,
    thirdHarmonicWeight: 0,
    upperGlottalWeight: 0,
    aspirationGain: 0.35,
    f1Hz: 490,
    f1Q: 1.0,
    f2Hz: 1020,
    f2Q: 0.95,
    warmLowpassHz: 1180,
    gain: 0.10,
    postVocalBreathHoldSec: 0.0,
  }),

  [PLAYER_BREATHING_STATES.STRAINED]: Object.freeze({
    id: 'breath_strained',
    state: PLAYER_BREATHING_STATES.STRAINED,
    kind: 'breath',
    recipeType: 'breath_strained',
    voiced: false,
    continuous: false,
    priority: PLAYER_VOCAL_PRIORITIES.EXERTION_BREATH,
    intervalSec: 10.0,
    cooldownSec: 10.0,
    intensity: 0.74,
    muffled: false,
    canSilenceWhenCalm: false,
    durationSec: 0.70,
    attackSec: 0.12,
    releaseSec: 0.38,
    f0StartHz: 0,
    f0PeakHz: 0,
    f0EndHz: 0,
    f0PeakAt: 0.20,
    chestFundamentalWeight: 0,
    secondHarmonicWeight: 0,
    thirdHarmonicWeight: 0,
    upperGlottalWeight: 0,
    aspirationGain: 0.33,
    f1Hz: 470,
    f1Q: 0.98,
    f2Hz: 960,
    f2Q: 0.92,
    warmLowpassHz: 1120,
    gain: 0.095,
    postVocalBreathHoldSec: 0.0,
  }),
})

function clampNumber(value, min, max, fallback = min) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

function setAudioParamAtTime(param, value, time) {
  if (!param) return
  const safeVal = Number.isFinite(value) ? value : 0
  if (typeof param.setValueAtTime === 'function') {
    param.setValueAtTime(safeVal, time)
  } else {
    param.value = safeVal
  }
}

function createBiquadBandpassCoeffs(sampleRate, centerHz, q = 2.0) {
  const sr = Math.max(8000, Number(sampleRate) || 44100)
  const f0 = clampNumber(centerHz, 60, sr * 0.42, 500)
  const safeQ = clampNumber(q, 0.5, 4.0, 2.0)
  const w0 = (2 * Math.PI * f0) / sr
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * safeQ)
  const a0 = 1 + alpha
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  }
}

function createBiquadLowpassCoeffs(sampleRate, cutoffHz, q = 0.707) {
  const sr = Math.max(8000, Number(sampleRate) || 44100)
  const f0 = clampNumber(cutoffHz, 120, sr * 0.45, 1950)
  const safeQ = clampNumber(q, 0.5, 2.5, 0.707)
  const w0 = (2 * Math.PI * f0) / sr
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * safeQ)
  const oneMinusCos = 1 - cosW0
  const a0 = 1 + alpha
  return {
    b0: (oneMinusCos * 0.5) / a0,
    b1: oneMinusCos / a0,
    b2: (oneMinusCos * 0.5) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  }
}

function stepBiquad(sample, coeffs, state) {
  const y =
    coeffs.b0 * sample +
    coeffs.b1 * state.x1 +
    coeffs.b2 * state.x2 -
    coeffs.a1 * state.y1 -
    coeffs.a2 * state.y2
  state.x2 = state.x1
  state.x1 = sample
  state.y2 = state.y1
  state.y1 = y
  return y
}

function evaluateSmoothContour(normT, startVal, peakVal, endVal, peakAt = 0.2) {
  const t = clampNumber(normT, 0, 1, 0)
  const split = clampNumber(peakAt, 0.05, 0.85, 0.2)
  if (t <= split) {
    const local = t / split
    const smooth = 0.5 - 0.5 * Math.cos(Math.PI * local)
    return startVal + (peakVal - startVal) * smooth
  }
  const local = (t - split) / Math.max(1e-5, 1 - split)
  const smooth = 0.5 - 0.5 * Math.cos(Math.PI * local)
  return peakVal + (endVal - peakVal) * smooth
}

function evaluateContinuousEnvelope(timeSec, durationSec, attackSec, releaseSec) {
  const dur = Math.max(0.06, durationSec)
  const t = clampNumber(timeSec, 0, dur, 0)
  const att = clampNumber(attackSec, 0.018, dur * 0.45, 0.028)
  const rel = clampNumber(releaseSec, 0.035, dur * 0.65, 0.09)
  const releaseStart = Math.max(att, dur - rel)

  let env = 1.0
  if (t < att) {
    const u = t / Math.max(1e-5, att)
    env = 0.5 - 0.5 * Math.cos(Math.PI * u)
  } else if (t > releaseStart) {
    const u = (t - releaseStart) / Math.max(1e-5, dur - releaseStart)
    env = 0.5 + 0.5 * Math.cos(Math.PI * clampNumber(u, 0, 1, 1))
  }

  // Gentle organic body taper across the middle so chest energy decays naturally without dropping out
  const normT = t / dur
  const bodyContour = 1.0 - 0.22 * (0.5 - 0.5 * Math.cos(Math.PI * normT))
  return env * bodyContour
}

/**
 * Normalizes a vocal or non-voiced sigh specification against adult masculine mid-low limits.
 */
export function normalizePlayerVocalSpec(spec = {}) {
  const merged = {
    ...DEFAULT_PLAYER_VOICE_SPEC,
    ...(spec && typeof spec === 'object' ? spec : {}),
  }

  const kindStr = String(merged.kind || DEFAULT_PLAYER_VOICE_SPEC.kind)
  const recipeTypeStr = String(merged.recipeType || kindStr || DEFAULT_PLAYER_VOICE_SPEC.recipeType)
  const isNonVoicedSigh =
    merged.voiced === false ||
    kindStr === 'breath' ||
    kindStr === 'sigh' ||
    recipeTypeStr.startsWith('breath_') ||
    recipeTypeStr.startsWith('sigh_')

  const startDelaySec = clampNumber(merged.startDelaySec, 0, 0.25, 0)
  const durationSec = clampNumber(merged.durationSec, 0.08, 2.5, DEFAULT_PLAYER_VOICE_SPEC.durationSec)
  const attackSec = clampNumber(merged.attackSec, 0.018, durationSec * 0.45, DEFAULT_PLAYER_VOICE_SPEC.attackSec)
  const releaseSec = clampNumber(merged.releaseSec, 0.035, durationSec * 0.65, DEFAULT_PLAYER_VOICE_SPEC.releaseSec)

  // Adult male mid-low register clamped cleanly to [88, 168] Hz for voiced cues; 0 Hz for sigh-only cues
  const f0StartHz = isNonVoicedSigh
    ? 0
    : clampNumber(merged.f0StartHz, 92, 160, DEFAULT_PLAYER_VOICE_SPEC.f0StartHz)
  const f0PeakHz = isNonVoicedSigh
    ? 0
    : clampNumber(merged.f0PeakHz, 95, 168, Math.max(f0StartHz, DEFAULT_PLAYER_VOICE_SPEC.f0PeakHz))
  const f0EndHz = isNonVoicedSigh
    ? 0
    : clampNumber(merged.f0EndHz, 85, 152, DEFAULT_PLAYER_VOICE_SPEC.f0EndHz)
  const f0PeakAt = clampNumber(merged.f0PeakAt, 0.08, 0.75, DEFAULT_PLAYER_VOICE_SPEC.f0PeakAt)

  return {
    id: String(merged.id || DEFAULT_PLAYER_VOICE_SPEC.id),
    kind: kindStr,
    recipeType: recipeTypeStr,
    voiced: !isNonVoicedSigh,
    variantIndex: Math.max(0, Math.floor(Number(merged.variantIndex) || 0)),
    priority: clampNumber(
      merged.priority,
      PLAYER_VOCAL_PRIORITIES.IDLE,
      PLAYER_VOCAL_PRIORITIES.DEATH,
      DEFAULT_PLAYER_VOICE_SPEC.priority
    ),
    startDelaySec,
    durationSec,
    attackSec,
    releaseSec,
    f0StartHz,
    f0PeakHz,
    f0EndHz,
    f0PeakAt,
    chestFundamentalWeight: isNonVoicedSigh
      ? 0
      : clampNumber(
          merged.chestFundamentalWeight,
          0.2,
          1.2,
          DEFAULT_PLAYER_VOICE_SPEC.chestFundamentalWeight
        ),
    secondHarmonicWeight: isNonVoicedSigh
      ? 0
      : clampNumber(
          merged.secondHarmonicWeight,
          0.25,
          1.1,
          DEFAULT_PLAYER_VOICE_SPEC.secondHarmonicWeight
        ),
    thirdHarmonicWeight: isNonVoicedSigh
      ? 0
      : clampNumber(
          merged.thirdHarmonicWeight,
          0.15,
          0.95,
          DEFAULT_PLAYER_VOICE_SPEC.thirdHarmonicWeight
        ),
    upperGlottalWeight: isNonVoicedSigh
      ? 0
      : clampNumber(
          merged.upperGlottalWeight,
          0.0,
          0.65,
          DEFAULT_PLAYER_VOICE_SPEC.upperGlottalWeight
        ),
    aspirationGain: clampNumber(
      merged.aspirationGain,
      0.0,
      isNonVoicedSigh ? 0.55 : 0.35,
      DEFAULT_PLAYER_VOICE_SPEC.aspirationGain
    ),
    f1Hz: clampNumber(merged.f1Hz, 320, 740, DEFAULT_PLAYER_VOICE_SPEC.f1Hz),
    f1Q: clampNumber(merged.f1Q, isNonVoicedSigh ? 0.65 : 1.1, isNonVoicedSigh ? 1.3 : 2.8, DEFAULT_PLAYER_VOICE_SPEC.f1Q),
    f2Hz: clampNumber(merged.f2Hz, 640, 1450, DEFAULT_PLAYER_VOICE_SPEC.f2Hz),
    f2Q: clampNumber(merged.f2Q, isNonVoicedSigh ? 0.65 : 1.1, isNonVoicedSigh ? 1.3 : 2.8, DEFAULT_PLAYER_VOICE_SPEC.f2Q),
    warmLowpassHz: clampNumber(
      merged.warmLowpassHz,
      650,
      isNonVoicedSigh ? 1350 : 2200,
      DEFAULT_PLAYER_VOICE_SPEC.warmLowpassHz
    ),
    gain: clampNumber(
      merged.gain,
      0.02,
      isNonVoicedSigh ? 0.16 : 0.85,
      DEFAULT_PLAYER_VOICE_SPEC.gain
    ),
    postVocalBreathHoldSec: clampNumber(
      merged.postVocalBreathHoldSec,
      0.0,
      1.5,
      DEFAULT_PLAYER_VOICE_SPEC.postVocalBreathHoldSec
    ),
  }
}

/**
 * Resolves the elevator landing impact-absorption grunt recipe.
 */
export function getElevatorLandingVocalRecipe(overrides = {}) {
  return normalizePlayerVocalSpec({
    ...PLAYER_ONE_SHOT_RECIPES.elevatorLanding,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
    voiced: true,
    priority: PLAYER_VOCAL_PRIORITIES.ELEVATOR_LANDING,
    recipeType: PLAYER_VOCAL_RECIPE_IDS.ELEVATOR_LANDING,
  })
}

/**
 * Resolves a light or heavy damage reaction recipe for the given deterministic variant index.
 */
export function getDamageVocalRecipe({
  heavy = false,
  damageAmount = 15,
  tier = null,
  variantIndex = 0,
  overrides = {},
} = {}) {
  const isHeavy =
    Boolean(heavy) ||
    tier === 'heavy' ||
    tier === PLAYER_VOCAL_RECIPE_IDS.DAMAGE_HEAVY ||
    (Number.isFinite(Number(damageAmount)) && Number(damageAmount) >= HEAVY_DAMAGE_THRESHOLD)

  const variants = isHeavy
    ? PLAYER_ONE_SHOT_RECIPES.damageHeavyVariants
    : PLAYER_ONE_SHOT_RECIPES.damageLightVariants
  const safeIdx = ((Math.floor(Number(variantIndex) || 0) % variants.length) + variants.length) % variants.length
  const baseRecipe = variants[safeIdx]

  return normalizePlayerVocalSpec({
    ...baseRecipe,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
    voiced: true,
    variantIndex: safeIdx,
    priority: PLAYER_VOCAL_PRIORITIES.DAMAGE,
    recipeType: isHeavy
      ? PLAYER_VOCAL_RECIPE_IDS.DAMAGE_HEAVY
      : PLAYER_VOCAL_RECIPE_IDS.DAMAGE_LIGHT,
  })
}

/**
 * Resolves the final collapsing death exhale/groan recipe (highest priority).
 */
export function getDeathVocalRecipe(overrides = {}) {
  return normalizePlayerVocalSpec({
    ...PLAYER_ONE_SHOT_RECIPES.death,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
    voiced: true,
    priority: PLAYER_VOCAL_PRIORITIES.DEATH,
    recipeType: PLAYER_VOCAL_RECIPE_IDS.DEATH,
  })
}

/**
 * Resolves a normalized non-voiced airflow sigh spec for the given state and deterministic variant index.
 */
export function getPlayerBreathingProfile(
  profileIdOrState = PLAYER_BREATHING_STATES.RESTING,
  { variantIndex = 0, overrides = {} } = {}
) {
  const key = String(profileIdOrState || PLAYER_BREATHING_STATES.RESTING)
    .trim()
    .toLowerCase()
  const baseProfile =
    PLAYER_BREATHING_PROFILES[key] ||
    PLAYER_BREATHING_PROFILES[PLAYER_BREATHING_STATES.RESTING]

  const safeVariant = ((Math.floor(Number(variantIndex) || 0) % 3) + 3) % 3
  // Subtle airflow shaping & duration variation across consecutive sighs (strictly unpitched / non-voiced)
  const durScale = safeVariant === 1 ? 1.05 : safeVariant === 2 ? 0.95 : 1.0
  const airDelta = safeVariant === 1 ? -22 : safeVariant === 2 ? 22 : 0

  const spec = normalizePlayerVocalSpec({
    ...baseProfile,
    id: `${baseProfile.id}_${safeVariant}`,
    variantIndex: safeVariant,
    durationSec: baseProfile.durationSec * durScale,
    f1Hz: baseProfile.f1Hz + airDelta,
    f2Hz: baseProfile.f2Hz + airDelta * 1.4,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
    voiced: false,
    f0StartHz: 0,
    f0PeakHz: 0,
    f0EndHz: 0,
    chestFundamentalWeight: 0,
    secondHarmonicWeight: 0,
    thirdHarmonicWeight: 0,
    upperGlottalWeight: 0,
    kind: 'breath',
    recipeType: baseProfile.recipeType,
    priority: baseProfile.priority,
  })

  return {
    ...spec,
    state: baseProfile.state,
    continuous: false,
    intervalSec: baseProfile.intervalSec,
    cooldownSec: baseProfile.cooldownSec || MIN_SIGH_COOLDOWN_SEC,
    intensity: baseProfile.intensity,
    muffled: Boolean(baseProfile.muffled),
    canSilenceWhenCalm: Boolean(baseProfile.canSilenceWhenCalm),
  }
}

function evaluateEnemyDangerFromContext(context = {}) {
  let anyChaseOrAttack = Boolean(
    context?.anyChaseOrAttack || context?.inDanger || context?.enemyChasing || context?.enemyAttacking
  )
  let nearestEnemyDist = Number.isFinite(Number(context?.nearestEnemyDist))
    ? Number(context.nearestEnemyDist)
    : Infinity

  const enemies = Array.isArray(context?.enemies) ? context.enemies : null
  const playerPos = context?.playerWorldPos || context?.listenerPos || null

  if (enemies && enemies.length > 0) {
    const px = Number(playerPos?.x)
    const pz = Number(playerPos?.z)
    const hasPlayerCoords = Number.isFinite(px) && Number.isFinite(pz)

    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = enemies[i]
      if (!enemy || enemy.isDisposed) continue
      const st = String(enemy.state || '').toLowerCase()
      if (st === 'chase' || st === 'attack') {
        anyChaseOrAttack = true
      }
      if (hasPlayerCoords && enemy.worldPos) {
        const ex = Number(enemy.worldPos.x)
        const ez = Number(enemy.worldPos.z)
        if (Number.isFinite(ex) && Number.isFinite(ez)) {
          const dist = Math.hypot(ex - px, ez - pz)
          if (dist < nearestEnemyDist) {
            nearestEnemyDist = dist
          }
        }
      }
    }
  }

  const isDangerActive =
    anyChaseOrAttack || nearestEnemyDist < DANGER_ENEMY_DISTANCE_THRESHOLD

  return {
    anyChaseOrAttack,
    nearestEnemyDist,
    isDangerActive,
  }
}

/**
 * Resolves the player's current breathing state according to the strict priority hierarchy:
 * 1. Strained (~2.5s after non-lethal damage)
 * 2. Exhausted (stamina <= 5 or isExhausted)
 * 3. Low stamina (stamina / maxStamina < 0.35)
 * 4. Danger (enemy chase/attack active or nearestEnemyDist < 8.5)
 * 5. Running (player moving while sprinting)
 * 6. Walking (player moving without sprinting)
 * 7. Resting (otherwise; subtle and silenced during sustained calm, full-stamina conditions)
 */
export function resolvePlayerBreathingState(
  context = {},
  {
    strainedRemainingSec = 0,
    restingRecoveryBreathsRemaining = 0,
  } = {}
) {
  const safeContext = context && typeof context === 'object' ? context : {}
  const maxStamina = Math.max(
    1,
    Number.isFinite(Number(safeContext.maxStamina)) ? Number(safeContext.maxStamina) : 100
  )
  const stamina = clampNumber(
    safeContext.stamina !== undefined ? safeContext.stamina : maxStamina,
    0,
    maxStamina,
    maxStamina
  )
  const staminaRatio = stamina / maxStamina
  const isExhausted =
    Boolean(safeContext.isExhausted) || stamina <= EXHAUSTED_STAMINA_THRESHOLD
  const isLowStamina = !isExhausted && staminaRatio < LOW_STAMINA_RATIO_THRESHOLD

  const effectiveStrainedSec = Math.max(
    Number(strainedRemainingSec) || 0,
    Number(safeContext.strainedRemainingSec) || 0,
    safeContext.isStrained === true ? STRAINED_BREATHING_DURATION_SEC : 0
  )
  const isStrained = effectiveStrainedSec > 0

  const { anyChaseOrAttack, nearestEnemyDist, isDangerActive } =
    evaluateEnemyDangerFromContext(safeContext)

  const motion = safeContext.playerMotion && typeof safeContext.playerMotion === 'object'
    ? safeContext.playerMotion
    : null
  const isMoving = Boolean(
    motion ? motion.moved : safeContext.isMoving ?? safeContext.moved
  )
  const isSprinting = Boolean(
    motion ? motion.isSprinting : safeContext.isSprinting
  )

  let state = PLAYER_BREATHING_STATES.RESTING
  let profileId = PLAYER_BREATHING_STATES.RESTING

  if (isStrained) {
    state = PLAYER_BREATHING_STATES.STRAINED
    profileId = PLAYER_BREATHING_STATES.STRAINED
  } else if (isExhausted) {
    state = PLAYER_BREATHING_STATES.EXHAUSTED
    profileId = PLAYER_BREATHING_STATES.EXHAUSTED
  } else if (isLowStamina) {
    state = PLAYER_BREATHING_STATES.LOW_STAMINA
    profileId = PLAYER_BREATHING_STATES.LOW_STAMINA
  } else if (isDangerActive) {
    state = PLAYER_BREATHING_STATES.DANGER
    profileId = PLAYER_BREATHING_STATES.DANGER
  } else if (isMoving && isSprinting) {
    state = PLAYER_BREATHING_STATES.RUNNING
    profileId = PLAYER_BREATHING_STATES.RUNNING
  } else if (isMoving) {
    state = PLAYER_BREATHING_STATES.WALKING
    profileId = PLAYER_BREATHING_STATES.WALKING
  }

  const baseProfile =
    PLAYER_BREATHING_PROFILES[profileId] ||
    PLAYER_BREATHING_PROFILES[PLAYER_BREATHING_STATES.RESTING]

  const isCalmFullStamina =
    state === PLAYER_BREATHING_STATES.RESTING &&
    !isDangerActive &&
    !isMoving &&
    staminaRatio >= 0.98
  const isRestingSilenced =
    state === PLAYER_BREATHING_STATES.RESTING &&
    isCalmFullStamina &&
    restingRecoveryBreathsRemaining <= 0 &&
    safeContext.forceRestingBreath !== true

  return {
    state,
    profileId,
    priority: baseProfile.priority,
    intervalSec: baseProfile.intervalSec,
    intensity: baseProfile.intensity,
    muffled: Boolean(baseProfile.muffled),
    isRestingSilenced,
    stamina,
    maxStamina,
    staminaRatio,
    strainedRemainingSec: effectiveStrainedSec,
    nearestEnemyDist,
    anyChaseOrAttack,
  }
}

/**
 * Renders either:
 * - A phase-coherent voiced adult male mid-low vocal waveform (`spec.voiced !== false`), or
 * - A purely non-voiced, unpitched organic airflow sigh (`spec.voiced === false`, zero oscillators/glottal tone).
 */
export function renderPlayerVocalWaveform(spec = {}, options = {}) {
  const normalized = normalizePlayerVocalSpec(spec)
  const sampleRate = clampNumber(options.sampleRate, 22050, 96000, 44100)
  const frameCount = Math.max(64, Math.floor(sampleRate * normalized.durationSec))
  const samples = new Float32Array(frameCount)

  const noiseChannelData =
    options.noiseBuffer && typeof options.noiseBuffer.getChannelData === 'function'
      ? options.noiseBuffer.getChannelData(0)
      : null
  const noiseLength = noiseChannelData ? noiseChannelData.length : 0

  const f1Coeffs = createBiquadBandpassCoeffs(sampleRate, normalized.f1Hz, normalized.f1Q)
  const f2Coeffs = createBiquadBandpassCoeffs(sampleRate, normalized.f2Hz, normalized.f2Q)
  const breathFormantCoeffs = createBiquadBandpassCoeffs(
    sampleRate,
    normalized.voiced ? Math.min(1150, normalized.f1Hz * 1.45) : normalized.f1Hz,
    normalized.voiced ? 1.45 : 0.85
  )
  const warmLpCoeffs = createBiquadLowpassCoeffs(sampleRate, normalized.warmLowpassHz, 0.72)

  const f1State = { x1: 0, x2: 0, y1: 0, y2: 0 }
  const f2State = { x1: 0, x2: 0, y1: 0, y2: 0 }
  const breathState = { x1: 0, x2: 0, y1: 0, y2: 0 }
  const warmLpState = { x1: 0, x2: 0, y1: 0, y2: 0 }

  let phase = 0
  let pink0 = 0
  let pink1 = 0
  let pink2 = 0
  let peakAbs = 0

  // Deterministic variant noise seed offset so variants have subtle organic airflow distinction
  const seedOffset = (normalized.variantIndex + 1) * 19.17

  for (let i = 0; i < frameCount; i += 1) {
    const timeSec = i / sampleRate
    const normT = i / Math.max(1, frameCount - 1)
    const env = evaluateContinuousEnvelope(
      timeSec,
      normalized.durationSec,
      normalized.attackSec,
      normalized.releaseSec
    )

    // Continuous organic pink/airflow noise layer
    let rawNoise
    if (noiseLength > 0) {
      const idx = (i + normalized.variantIndex * 4099) % noiseLength
      rawNoise = noiseChannelData[idx]
    } else {
      const deterministicSeed = Math.sin((i + seedOffset) * 12.9898 + 78.233) * 43758.5453
      const white = (deterministicSeed - Math.floor(deterministicSeed)) * 2 - 1
      pink0 = 0.997 * pink0 + white * 0.029
      pink1 = 0.985 * pink1 + white * 0.032
      pink2 = 0.95 * pink2 + white * 0.048
      rawNoise = (pink0 + pink1 + pink2 + white * 0.16) * 0.7
    }

    let combined
    if (normalized.voiced) {
      // Smooth continuous F0 contour in adult masculine mid-low register [85, 168] Hz
      const baseF0 = evaluateSmoothContour(
        normT,
        normalized.f0StartHz,
        normalized.f0PeakHz,
        normalized.f0EndHz,
        normalized.f0PeakAt
      )
      const lowRateDrift = 1 + 0.0025 * Math.sin(2 * Math.PI * 3.1 * timeSec)
      const instF0 = clampNumber(baseF0 * lowRateDrift, 85, 168, baseF0)

      phase += (2 * Math.PI * instF0) / sampleRate
      if (phase > Math.PI * 2) {
        phase -= Math.PI * 2
      }

      const h1 = Math.sin(phase) * normalized.chestFundamentalWeight
      const h2 = Math.sin(2 * phase + 0.28) * normalized.secondHarmonicWeight
      const h3 = Math.sin(3 * phase + 0.55) * normalized.thirdHarmonicWeight
      const h4 = Math.sin(4 * phase + 0.82) * (normalized.upperGlottalWeight * 0.62)
      const h5 = Math.sin(5 * phase + 1.08) * (normalized.upperGlottalWeight * 0.32)

      const rawGlottal = Math.tanh((h1 + h2 + h3 + h4 + h5) * 0.70)

      const f1Out = stepBiquad(rawGlottal, f1Coeffs, f1State)
      const f2Out = stepBiquad(rawGlottal, f2Coeffs, f2State)
      const voicedBody =
        (h1 * 0.36 + h2 * 0.36 + h3 * 0.18) +
        f1Out * 0.64 +
        f2Out * 0.32

      const aspiration = stepBiquad(rawNoise, breathFormantCoeffs, breathState) * normalized.aspirationGain
      combined = (voicedBody + aspiration) * env
    } else {
      // Pure soft non-voiced sigh: zero glottal/harmonic oscillators, clean dual-bandpass air passage (no sub-bass rumble)
      const warmAir = stepBiquad(rawNoise, breathFormantCoeffs, breathState)
      const softAir = stepBiquad(rawNoise, f2Coeffs, f2State)
      const sighExhaleContour = 1.0 - 0.18 * normT
      combined =
        (warmAir * 0.72 + softAir * 0.42) *
        Math.max(0.1, normalized.aspirationGain) *
        env *
        sighExhaleContour
    }

    const warmFiltered = stepBiquad(combined, warmLpCoeffs, warmLpState)
    const outSample = Math.tanh(warmFiltered * 0.88)

    samples[i] = outSample
    const absVal = Math.abs(outSample)
    if (absVal > peakAbs) {
      peakAbs = absVal
    }
  }

  // Normalize peak to target spec gain while preserving smooth dynamic contour
  const targetPeak = clampNumber(
    normalized.gain,
    0.02,
    normalized.voiced ? 0.85 : 0.16,
    DEFAULT_PLAYER_VOICE_SPEC.gain
  )
  if (peakAbs > 1e-5) {
    const scale = targetPeak / peakAbs
    for (let i = 0; i < frameCount; i += 1) {
      samples[i] *= scale
    }
  }

  return {
    samples,
    sampleRate,
    durationSec: normalized.durationSec,
    spec: normalized,
  }
}

/**
 * Computes deterministic DSP quality metrics on a rendered player vocal/sigh waveform
 * for automated test verification (continuity, envelope smoothness, fundamental & harmonic band presence,
 * and absence of tonal oscillators in non-voiced sighs).
 */
export function analyzePlayerVocalWaveform(samples, sampleRate = 44100, spec = DEFAULT_PLAYER_VOICE_SPEC) {
  if (!samples || samples.length === 0) {
    return {
      frameCount: 0,
      peak: 0,
      rms: 0,
      attackHeadRms: 0,
      tailEndRms: 0,
      bodyWindowMinToMeanRatio: 0,
      maxSampleStep: 0,
      chestFundamentalBandEnergy: 0,
      upperBassHarmonicBandEnergy: 0,
      maxVoicedTonalBandEnergy: 0,
      harshHighFreqEnergyRatio: 1,
    }
  }

  const n = samples.length
  let sumSq = 0
  let peak = 0
  let maxSampleStep = 0

  for (let i = 0; i < n; i += 1) {
    const s = samples[i]
    const abs = Math.abs(s)
    if (abs > peak) peak = abs
    sumSq += s * s
    if (i > 0) {
      const step = Math.abs(s - samples[i - 1])
      if (step > maxSampleStep) maxSampleStep = step
    }
  }
  const rms = Math.sqrt(sumSq / n)

  // Check attack start and release tail smoothness (first 2 ms and last 2 ms should be near zero)
  const edgeCount = Math.max(4, Math.floor(sampleRate * 0.002))
  let headSq = 0
  let tailSq = 0
  for (let i = 0; i < edgeCount && i < n; i += 1) {
    headSq += samples[i] * samples[i]
    const tailIdx = n - 1 - i
    tailSq += samples[tailIdx] * samples[tailIdx]
  }
  const attackHeadRms = Math.sqrt(headSq / edgeCount)
  const tailEndRms = Math.sqrt(tailSq / edgeCount)

  // Measure body continuity across 25 ms windows inside the central 24%..64% sustain region
  const bodyStart = Math.floor(n * 0.24)
  const bodyEnd = Math.floor(n * 0.64)
  const winSize = Math.max(64, Math.floor(sampleRate * 0.025))
  const hop = Math.max(32, Math.floor(winSize / 2))
  const windowRmsList = []

  for (let start = bodyStart; start + winSize <= bodyEnd; start += hop) {
    let wSq = 0
    for (let j = 0; j < winSize; j += 1) {
      const v = samples[start + j]
      wSq += v * v
    }
    windowRmsList.push(Math.sqrt(wSq / winSize))
  }

  let bodyWindowMinToMeanRatio = 1
  if (windowRmsList.length > 0) {
    const minWin = Math.min(...windowRmsList)
    const meanWin = windowRmsList.reduce((acc, v) => acc + v, 0) / windowRmsList.length
    bodyWindowMinToMeanRatio = meanWin > 1e-6 ? minWin / meanWin : 0
  }

  const measureBandEnergy = (freqs) => {
    const probeWin = Math.max(256, Math.min(n, Math.floor(sampleRate * 0.045)))
    const probeStart = Math.max(0, Math.min(n - probeWin, Math.floor(n * 0.28)))
    let peakBandMag = 0

    for (let fIdx = 0; fIdx < freqs.length; fIdx += 1) {
      const freq = freqs[fIdx]
      let re = 0
      let im = 0
      const omega = (2 * Math.PI * freq) / sampleRate
      for (let i = 0; i < probeWin; i += 1) {
        const angle = omega * i
        const s = samples[probeStart + i]
        re += s * Math.cos(angle)
        im -= s * Math.sin(angle)
      }
      const mag = (2 * Math.sqrt(re * re + im * im)) / probeWin
      if (mag > peakBandMag) {
        peakBandMag = mag
      }
    }
    return peakBandMag
  }

  const hasPitchSpec = spec.voiced !== false && Number(spec.f0StartHz) > 0
  const f0Min = hasPitchSpec ? Math.min(spec.f0StartHz, spec.f0PeakHz, spec.f0EndHz) : 85
  const f0Max = hasPitchSpec ? Math.max(spec.f0StartHz, spec.f0PeakHz, spec.f0EndHz) : 145
  const f0Mid = 0.5 * (f0Min + f0Max)

  const chestFundamentalBandEnergy = measureBandEnergy([
    f0Min,
    0.5 * (f0Min + f0Mid),
    f0Mid,
    0.5 * (f0Mid + f0Max),
    f0Max,
  ])
  const upperBassHarmonicBandEnergy = measureBandEnergy([
    f0Min * 2,
    f0Mid * 2,
    f0Max * 2,
    f0Min * 3,
    f0Mid * 3,
    f0Max * 3,
  ])
  const maxVoicedTonalBandEnergy = measureBandEnergy([
    80, 95, 110, 125, 140, 160, 190, 220, 250, 280, 320,
  ])
  const harshHighBandEnergy = measureBandEnergy([3400, 4200, 5200])
  const baselineEnergy = Math.max(rms * 0.25, chestFundamentalBandEnergy + upperBassHarmonicBandEnergy)
  const harshHighFreqEnergyRatio =
    baselineEnergy > 1e-6 ? harshHighBandEnergy / baselineEnergy : 0

  return {
    frameCount: n,
    peak,
    rms,
    attackHeadRms,
    tailEndRms,
    bodyWindowMinToMeanRatio,
    maxSampleStep,
    chestFundamentalBandEnergy,
    upperBassHarmonicBandEnergy,
    maxVoicedTonalBandEnergy,
    harshHighFreqEnergyRatio,
  }
}

/**
 * Synthesizes and starts a cancellable player vocal cue on the provided Web Audio graph.
 * Returns a handle with deterministic stop/preempt and node-cleanup guarantees.
 */
export function synthesizePlayerVocalCue(
  ctx,
  destination,
  spec = {},
  {
    noiseBuffer = null,
    scheduleFadeCleanup = null,
    onEnded = null,
    nowSec = null,
  } = {}
) {
  if (
    !ctx ||
    !destination ||
    typeof ctx.createBuffer !== 'function' ||
    typeof ctx.createBufferSource !== 'function' ||
    typeof ctx.createGain !== 'function'
  ) {
    return null
  }

  const normalized = normalizePlayerVocalSpec(spec)
  const sampleRate = ctx.sampleRate || 44100
  const rendered = renderPlayerVocalWaveform(normalized, {
    sampleRate,
    noiseBuffer,
  })

  const audioBuffer = ctx.createBuffer(1, rendered.samples.length, sampleRate)
  const channelData = audioBuffer.getChannelData(0)
  channelData.set(rendered.samples)

  const audioNow = ctx.currentTime || 0
  const clockNow = Number.isFinite(nowSec) ? nowSec : audioNow
  const audioStartAtSec = audioNow + normalized.startDelaySec
  const clockStartAtSec = clockNow + normalized.startDelaySec
  const source = ctx.createBufferSource()
  source.buffer = audioBuffer

  const warmFilter = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (warmFilter) {
    warmFilter.type = 'lowpass'
    setAudioParamAtTime(warmFilter.frequency, normalized.warmLowpassHz, audioNow)
    setAudioParamAtTime(warmFilter.Q, 0.72, audioNow)
  }

  const outputGain = ctx.createGain()
  setAudioParamAtTime(outputGain.gain, 1.0, audioNow)

  if (warmFilter) {
    source.connect(warmFilter)
    warmFilter.connect(outputGain)
  } else {
    source.connect(outputGain)
  }
  outputGain.connect(destination)

  let active = true
  let cleanedUp = false

  const disconnectAllNodes = () => {
    if (cleanedUp) return
    cleanedUp = true
    active = false
    try {
      source.onended = null
    } catch {
      // ignore
    }
    try {
      source.disconnect()
    } catch {
      // ignore
    }
    if (warmFilter) {
      try {
        warmFilter.disconnect()
      } catch {
        // ignore
      }
    }
    try {
      outputGain.disconnect()
    } catch {
      // ignore
    }
    if (typeof onEnded === 'function') {
      onEnded()
    }
  }

  source.onended = () => {
    disconnectAllNodes()
  }

  const stop = ({ immediate = false, fadeSec = 0.024 } = {}) => {
    if (cleanedUp) return
    active = false
    const stopNow = ctx.currentTime || 0
    const beforeScheduledOnset = stopNow < audioStartAtSec
    const safeFadeSec =
      immediate || beforeScheduledOnset ? 0 : clampNumber(fadeSec, 0.008, 0.12, 0.024)

    if (!immediate && !beforeScheduledOnset && safeFadeSec > 0 && outputGain?.gain) {
      const currentVal = Number.isFinite(outputGain.gain.value) ? outputGain.gain.value : 1.0
      setAudioParamAtTime(outputGain.gain, Math.max(0.0001, currentVal), stopNow)
      if (typeof outputGain.gain.linearRampToValueAtTime === 'function') {
        outputGain.gain.linearRampToValueAtTime(0.0001, stopNow + safeFadeSec)
      } else {
        setAudioParamAtTime(outputGain.gain, 0.0001, stopNow + safeFadeSec)
      }
      try {
        source.stop(stopNow + safeFadeSec + 0.004)
      } catch {
        // ignore if already stopped
      }
      if (typeof scheduleFadeCleanup === 'function') {
        scheduleFadeCleanup(() => {
          disconnectAllNodes()
        }, Math.ceil((safeFadeSec + 0.01) * 1000))
      } else {
        disconnectAllNodes()
      }
      return
    }

    try {
      source.stop(stopNow)
    } catch {
      // ignore if already stopped
    }
    disconnectAllNodes()
  }

  source.start(audioStartAtSec)

  return {
    id: normalized.id,
    kind: normalized.kind,
    recipeType: normalized.recipeType,
    variantIndex: normalized.variantIndex,
    priority: normalized.priority,
    startDelaySec: normalized.startDelaySec,
    durationSec: normalized.durationSec,
    scheduledAtSec: clockNow,
    startedAtSec: clockStartAtSec,
    endsAtSec: clockStartAtSec + normalized.durationSec,
    spec: normalized,
    buffer: audioBuffer,
    nodes: {
      source,
      warmFilter,
      outputGain,
    },
    isActive: () => active && !cleanedUp,
    isDisposed: () => cleanedUp,
    stop,
  }
}

/**
 * Strict monophonic controller for all player-character vocalizations and breathing cadence.
 * Guarantees at most one active vocal handle at any time, deterministic priority preemption,
 * deterministic variant rotation, smooth breathing state transitions, post-vocal breathing
 * cadence holds, and leak-free node disposal.
 */
export class PlayerVocalController {
  constructor({
    getContext,
    getDestination,
    getNoiseBuffer = () => null,
    scheduleFadeCleanup = null,
    breathingEnabled = true,
  } = {}) {
    this._getContext = typeof getContext === 'function' ? getContext : () => null
    this._getDestination = typeof getDestination === 'function' ? getDestination : () => null
    this._getNoiseBuffer = typeof getNoiseBuffer === 'function' ? getNoiseBuffer : () => null
    this._scheduleFadeCleanup = typeof scheduleFadeCleanup === 'function' ? scheduleFadeCleanup : null
    this._breathingEnabled = breathingEnabled !== false

    this._activeHandle = null
    this._clockSec = 0
    this._lastCtxTime = null
    this._breathHoldUntilSec = 0
    this._nextBreathDueAtSec = 0
    this._nextSighAllowedAtSec = 0
    this._strainedRemainingSec = 0
    this._exertionAccumSec = 0
    this._exhaustedSighLatched = false
    this._strainedSighPending = false
    this._reliefSighPending = false
    this._lastSighReason = null
    this._totalSighsTriggered = 0
    this._currentBreathingState = PLAYER_BREATHING_STATES.RESTING
    this._currentBreathingProfileId = PLAYER_BREATHING_STATES.RESTING
    this._smoothedBreathIntensity = PLAYER_BREATHING_PROFILES[PLAYER_BREATHING_STATES.RESTING].intensity
    this._restingRecoveryBreathsRemaining = 0
    this._isRestingSilenced = true
    this._breathVariantIndices = new Map()
    this._lightDamageVariantIndex = 0
    this._heavyDamageVariantIndex = 0
    this._lastPlayedRecipeId = null
    this._disposed = false
  }

  _resolveNowSec() {
    const ctx = this._getContext()
    if (ctx && Number.isFinite(ctx.currentTime)) {
      if (this._lastCtxTime === null) {
        this._lastCtxTime = ctx.currentTime
        this._clockSec = Math.max(this._clockSec, ctx.currentTime)
      } else if (ctx.currentTime > this._lastCtxTime) {
        this._clockSec += ctx.currentTime - this._lastCtxTime
        this._lastCtxTime = ctx.currentTime
      }
      return Math.max(this._clockSec, ctx.currentTime)
    }
    return this._clockSec
  }

  _advanceClock(deltaSec = 0) {
    const dt = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 0
    const ctx = this._getContext()
    if (ctx && Number.isFinite(ctx.currentTime)) {
      if (this._lastCtxTime === null) {
        this._lastCtxTime = ctx.currentTime
        this._clockSec = Math.max(this._clockSec, ctx.currentTime) + dt
      } else {
        const ctxDelta = Math.max(0, ctx.currentTime - this._lastCtxTime)
        this._lastCtxTime = ctx.currentTime
        this._clockSec = Math.max(this._clockSec + Math.max(dt, ctxDelta), ctx.currentTime)
      }
      return this._clockSec
    }
    this._clockSec += dt
    return this._clockSec
  }

  _pruneExpiredHandle() {
    if (!this._activeHandle) return
    const nowSec = this._resolveNowSec()
    if (!this._activeHandle.isActive() || nowSec >= this._activeHandle.endsAtSec) {
      const stale = this._activeHandle
      this._activeHandle = null
      if (!stale.isDisposed()) {
        stale.stop({ immediate: true })
      }
    }
  }

  /**
   * Plays a prioritized player vocal or sigh cue using strict monophonic preemption rules.
   */
  playCue(spec = {}, options = {}) {
    if (this._disposed) return null
    const ctx = this._getContext()
    const destination = this._getDestination()
    if (!ctx || !destination) return null

    this._pruneExpiredHandle()
    const normalized = normalizePlayerVocalSpec(spec)
    const force = options?.force === true

    if (this._activeHandle && this._activeHandle.isActive()) {
      const currentPriority = this._activeHandle.priority
      if (!force && normalized.priority < currentPriority) {
        return null
      }
      this.stopActiveCue({
        immediate: options?.immediatePreempt === true,
        fadeSec: options?.preemptFadeSec ?? 0.022,
      })
    }

    const nowSec = this._resolveNowSec()
    let createdHandle = null
    createdHandle = synthesizePlayerVocalCue(ctx, destination, normalized, {
      noiseBuffer: this._getNoiseBuffer(),
      scheduleFadeCleanup: this._scheduleFadeCleanup,
      nowSec,
      onEnded: () => {
        if (this._activeHandle && this._activeHandle === createdHandle) {
          this._activeHandle = null
        }
      },
    })

    if (!createdHandle) return null

    this._activeHandle = createdHandle
    this._lastPlayedRecipeId = createdHandle.id
    if (normalized.priority >= PLAYER_VOCAL_PRIORITIES.ELEVATOR_LANDING) {
      const holdUntil =
        nowSec + normalized.startDelaySec + normalized.durationSec + normalized.postVocalBreathHoldSec
      this._breathHoldUntilSec = Math.max(this._breathHoldUntilSec, holdUntil)
      this._nextBreathDueAtSec = Math.max(this._nextBreathDueAtSec, holdUntil)
      this._nextSighAllowedAtSec = Math.max(this._nextSighAllowedAtSec, holdUntil)
    }

    return createdHandle
  }

  /**
   * Plays the one-shot elevator landing exertion grunt (slightly delayed relative to mechanical impact).
   */
  playElevatorLandingVocal(options = {}) {
    const overrides = {}
    if (Number.isFinite(Number(options?.startDelaySec))) {
      overrides.startDelaySec = Number(options.startDelaySec)
    }
    if (Number.isFinite(Number(options?.gain))) {
      overrides.gain = Number(options.gain)
    }
    const recipe = getElevatorLandingVocalRecipe(overrides)
    return this.playCue(recipe, options)
  }

  /**
   * Marks the player as recently damaged for ~2.5s strained state tracking (at most 1 recovery sigh).
   */
  notifyNonLethalDamage(durationSec = STRAINED_BREATHING_DURATION_SEC) {
    if (this._disposed) return 0
    const safeDur = clampNumber(durationSec, 0, 8.0, STRAINED_BREATHING_DURATION_SEC)
    this._strainedRemainingSec = Math.max(this._strainedRemainingSec, safeDur)
    this._strainedSighPending = safeDur > 0
    this._restingRecoveryBreathsRemaining = 0
    return this._strainedRemainingSec
  }

  /**
   * Plays a light or heavy damage vocal reaction with deterministic variant rotation.
   */
  playDamageVocal(options = {}) {
    const isHeavy =
      Boolean(options?.heavy) ||
      options?.tier === 'heavy' ||
      options?.tier === PLAYER_VOCAL_RECIPE_IDS.DAMAGE_HEAVY ||
      (Number.isFinite(Number(options?.damageAmount)) &&
        Number(options.damageAmount) >= HEAVY_DAMAGE_THRESHOLD)

    const variants = isHeavy
      ? PLAYER_ONE_SHOT_RECIPES.damageHeavyVariants
      : PLAYER_ONE_SHOT_RECIPES.damageLightVariants
    const variantCount = variants.length

    let chosenIndex
    if (Number.isInteger(options?.variantIndex) && options.variantIndex >= 0) {
      chosenIndex = options.variantIndex % variantCount
    } else if (isHeavy) {
      chosenIndex = this._heavyDamageVariantIndex % variantCount
    } else {
      chosenIndex = this._lightDamageVariantIndex % variantCount
    }

    const overrides = {}
    if (Number.isFinite(Number(options?.gain))) {
      overrides.gain = Number(options.gain)
    }

    const recipe = getDamageVocalRecipe({
      heavy: isHeavy,
      variantIndex: chosenIndex,
      overrides,
    })

    const handle = this.playCue(recipe, options)
    if (handle) {
      if (isHeavy) {
        this._heavyDamageVariantIndex = (chosenIndex + 1) % variantCount
      } else {
        this._lightDamageVariantIndex = (chosenIndex + 1) % variantCount
      }
      if (options?.strained !== false) {
        const strainedHold = Number.isFinite(Number(options?.strainedDurationSec))
          ? Number(options.strainedDurationSec)
          : STRAINED_BREATHING_DURATION_SEC
        this.notifyNonLethalDamage(strainedHold + recipe.durationSec)
      }
    }
    return handle
  }

  /**
   * Plays the highest-priority collapsing death exhale/groan, preempting any active player vocal.
   */
  playDeathVocal(options = {}) {
    const overrides = {}
    if (Number.isFinite(Number(options?.gain))) {
      overrides.gain = Number(options.gain)
    }
    const recipe = getDeathVocalRecipe(overrides)
    this._strainedRemainingSec = 0
    this._strainedSighPending = false
    this._reliefSighPending = false
    return this.playCue(recipe, {
      immediatePreempt: true,
      ...options,
    })
  }

  /**
   * Resolves the current physiological state/profile using controller timers and gameplay context.
   */
  resolveBreathingState(context = {}) {
    return resolvePlayerBreathingState(context, {
      strainedRemainingSec: this._strainedRemainingSec,
      restingRecoveryBreathsRemaining: this._restingRecoveryBreathsRemaining,
    })
  }

  /**
   * Plays a single non-voiced airflow sigh for the specified profile/state.
   * Respects one-shot vocal priorities, post-vocal hold timers, and active cue continuity.
   */
  playBreathingCue(profileIdOrState = PLAYER_BREATHING_STATES.RESTING, options = {}) {
    if (this._disposed) return null
    this._pruneExpiredHandle()

    if (!this.canTriggerBreathing() && options?.force !== true) {
      return null
    }

    if (
      this._activeHandle &&
      this._activeHandle.isActive() &&
      options?.preemptActiveBreath !== true &&
      options?.force !== true
    ) {
      return null
    }

    const key = String(profileIdOrState || PLAYER_BREATHING_STATES.RESTING)
      .trim()
      .toLowerCase()
    const baseProfile =
      PLAYER_BREATHING_PROFILES[key] ||
      PLAYER_BREATHING_PROFILES[PLAYER_BREATHING_STATES.RESTING]
    const profileKey = baseProfile.state

    let variantIndex
    if (Number.isInteger(options?.variantIndex) && options.variantIndex >= 0) {
      variantIndex = options.variantIndex % 3
    } else {
      variantIndex = (this._breathVariantIndices.get(profileKey) || 0) % 3
    }

    const overrides = {}
    if (Number.isFinite(Number(options?.gain))) {
      overrides.gain = Number(options.gain)
    } else if (Number.isFinite(Number(options?.intensityScale))) {
      overrides.gain = clampNumber(
        baseProfile.gain * Number(options.intensityScale),
        0.02,
        0.16,
        baseProfile.gain
      )
    }

    const profileSpec = getPlayerBreathingProfile(profileKey, {
      variantIndex,
      overrides,
    })

    const handle = this.playCue(profileSpec, options)
    if (handle) {
      this._breathVariantIndices.set(profileKey, (variantIndex + 1) % 3)
      const nowSec = this._resolveNowSec()
      const cooldownSec = Number.isFinite(Number(options?.cooldownSec))
        ? Math.max(MIN_SIGH_COOLDOWN_SEC, Number(options.cooldownSec))
        : Math.max(MIN_SIGH_COOLDOWN_SEC, profileSpec.cooldownSec || MIN_SIGH_COOLDOWN_SEC)
      this._nextSighAllowedAtSec = nowSec + cooldownSec
      this._nextBreathDueAtSec = this._nextSighAllowedAtSec
      this._lastSighReason = options?.reason || profileKey
      this._totalSighsTriggered += 1
    }
    return handle
  }

  /**
   * Transition-only, cooldown-gated sigh scheduler.
   *
   * Guarantees:
   * - Never triggers continuous breathing in resting, walking, running, danger, exhausted, or strained states
   * - Triggers at most 1 subtle non-voiced airflow sigh on meaningful state transitions:
   *   1. Strained recovery (single sigh after non-lethal damage vocal/hold completes)
   *   2. Exhaustion onset (single tired exhale sigh upon depleting stamina; latched until recovery >= 35%)
   *   3. Exertion relief (single settling sigh when stopping into resting after sustained exertion/danger)
   * - Strictly separated by generous silence (`>= MIN_SIGH_COOLDOWN_SEC`)
   */
  updateBreathing(deltaSec = 0, context = {}) {
    if (this._disposed) return null
    const dt = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 0
    const nowSec = this._advanceClock(dt)
    if (dt > 0 && this._strainedRemainingSec > 0) {
      this._strainedRemainingSec = Math.max(0, this._strainedRemainingSec - dt)
      if (this._strainedRemainingSec <= 0) {
        this._strainedSighPending = false
      }
    }

    this._pruneExpiredHandle()

    const resolved = this.resolveBreathingState(context)

    this._currentBreathingState = resolved.state
    this._currentBreathingProfileId = resolved.profileId
    this._isRestingSilenced = true

    const targetProfile =
      PLAYER_BREATHING_PROFILES[resolved.profileId] ||
      PLAYER_BREATHING_PROFILES[PLAYER_BREATHING_STATES.RESTING]

    const targetIntensity =
      resolved.state === PLAYER_BREATHING_STATES.RESTING ? 0.12 : targetProfile.intensity
    const tau = targetIntensity > this._smoothedBreathIntensity ? 0.32 : 0.62
    const alpha = dt > 0 ? 1 - Math.exp(-dt / tau) : 1
    this._smoothedBreathIntensity += (targetIntensity - this._smoothedBreathIntensity) * alpha

    // Track cumulative exertion/danger time so only sustained activity earns a settling relief sigh
    if (
      resolved.state === PLAYER_BREATHING_STATES.RUNNING ||
      resolved.state === PLAYER_BREATHING_STATES.DANGER ||
      resolved.state === PLAYER_BREATHING_STATES.LOW_STAMINA ||
      resolved.state === PLAYER_BREATHING_STATES.EXHAUSTED ||
      resolved.state === PLAYER_BREATHING_STATES.STRAINED
    ) {
      this._exertionAccumSec = Math.min(30, this._exertionAccumSec + dt)
      if (
        this._exertionAccumSec >= EXERTION_RELIEF_THRESHOLD_SEC ||
        resolved.state === PLAYER_BREATHING_STATES.EXHAUSTED ||
        resolved.state === PLAYER_BREATHING_STATES.STRAINED
      ) {
        this._reliefSighPending = true
      }
    } else if (resolved.state === PLAYER_BREATHING_STATES.RESTING && !this._reliefSighPending) {
      this._exertionAccumSec = Math.max(0, this._exertionAccumSec - dt)
    }

    // Rearm exhaustion episode latch only after recovering cleanly
    if (resolved.staminaRatio >= LOW_STAMINA_RATIO_THRESHOLD && resolved.state !== PLAYER_BREATHING_STATES.EXHAUSTED) {
      this._exhaustedSighLatched = false
    }

    const cooldownReady = nowSec >= this._nextSighAllowedAtSec
    const canPlaySighNow =
      this._breathingEnabled &&
      cooldownReady &&
      this.canTriggerBreathing() &&
      !(this._activeHandle && this._activeHandle.isActive())

    // Evaluate meaningful transition triggers (at most 1 sigh; latches clear immediately so states never loop)
    if (resolved.state === PLAYER_BREATHING_STATES.STRAINED) {
      if (this._strainedSighPending && canPlaySighNow) {
        this._strainedSighPending = false
        this._reliefSighPending = false
        this._exertionAccumSec = 0
        return this.playBreathingCue(PLAYER_BREATHING_STATES.STRAINED, {
          reason: 'strained_recovery',
        })
      }
      return null
    }

    if (resolved.state === PLAYER_BREATHING_STATES.EXHAUSTED) {
      if (!this._exhaustedSighLatched) {
        // Latch on exhaustion episode entry so staying exhausted never triggers delayed or repeated sighs
        this._exhaustedSighLatched = true
        if (canPlaySighNow) {
          this._reliefSighPending = false
          this._exertionAccumSec = 0
          return this.playBreathingCue(PLAYER_BREATHING_STATES.EXHAUSTED, {
            reason: 'exhaustion_onset',
          })
        }
      }
      return null
    }

    if (resolved.state === PLAYER_BREATHING_STATES.RESTING && this._reliefSighPending) {
      const hadSustainedExertion = this._exertionAccumSec >= EXERTION_RELIEF_THRESHOLD_SEC
      this._reliefSighPending = false
      this._exertionAccumSec = 0
      if (hadSustainedExertion && canPlaySighNow) {
        return this.playBreathingCue(PLAYER_BREATHING_STATES.RESTING, {
          reason: 'exertion_relief',
        })
      }
    }

    return null
  }

  /**
   * Stops and disconnects the currently active player vocal or sigh handle, if any.
   * When `preserveDeath === true`, an active DEATH vocal is allowed to complete its natural decay.
   */
  stopActiveCue({ immediate = false, fadeSec = 0.024, preserveDeath = false } = {}) {
    this._pruneExpiredHandle()
    const handle = this._activeHandle
    if (!handle) return false
    if (
      preserveDeath &&
      handle.isActive() &&
      handle.priority === PLAYER_VOCAL_PRIORITIES.DEATH
    ) {
      return false
    }
    this._activeHandle = null
    handle.stop({ immediate, fadeSec })
    return true
  }

  /**
   * Advances internal controller clock, decays strained timer, and prunes completed handles.
   */
  update(deltaSec = 0, context = null) {
    if (this._disposed) return null
    if (context && typeof context === 'object') {
      return this.updateBreathing(deltaSec, context)
    }
    const dt = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 0
    this._advanceClock(dt)
    if (dt > 0 && this._strainedRemainingSec > 0) {
      this._strainedRemainingSec = Math.max(0, this._strainedRemainingSec - dt)
      if (this._strainedRemainingSec <= 0) {
        this._strainedSighPending = false
      }
    }
    this._pruneExpiredHandle()
    return null
  }

  /**
   * Extends the post-vocal breathing/sigh hold window by `holdSec`.
   */
  holdBreathing(holdSec = 0.35) {
    const safeHold = clampNumber(holdSec, 0, 5.0, 0.35)
    const nowSec = this._resolveNowSec()
    this._breathHoldUntilSec = Math.max(this._breathHoldUntilSec, nowSec + safeHold)
    this._nextBreathDueAtSec = Math.max(this._nextBreathDueAtSec, this._breathHoldUntilSec)
    this._nextSighAllowedAtSec = Math.max(this._nextSighAllowedAtSec, this._breathHoldUntilSec)
  }

  /**
   * Returns true only when no higher-priority vocal is active and the post-vocal hold window has elapsed.
   */
  canTriggerBreathing() {
    if (this._disposed) return false
    this._pruneExpiredHandle()
    const nowSec = this._resolveNowSec()
    if (nowSec < this._breathHoldUntilSec) return false
    if (
      this._activeHandle &&
      this._activeHandle.isActive() &&
      this._activeHandle.priority > PLAYER_VOCAL_PRIORITIES.EXERTION_BREATH
    ) {
      return false
    }
    return true
  }

  getActiveHandle() {
    this._pruneExpiredHandle()
    return this._activeHandle
  }

  getActiveCount() {
    this._pruneExpiredHandle()
    return this._activeHandle && this._activeHandle.isActive() ? 1 : 0
  }

  getState() {
    this._pruneExpiredHandle()
    const active = this._activeHandle && this._activeHandle.isActive() ? this._activeHandle : null
    return {
      activeCount: active ? 1 : 0,
      activeCueId: active ? active.id : null,
      activeRecipeType: active ? active.recipeType : null,
      activePriority: active ? active.priority : PLAYER_VOCAL_PRIORITIES.IDLE,
      breathingState: this._currentBreathingState,
      breathingProfileId: this._currentBreathingProfileId,
      smoothedBreathIntensity: this._smoothedBreathIntensity,
      isRestingSilenced: this._isRestingSilenced,
      strainedRemainingSec: this._strainedRemainingSec,
      nextBreathDueAtSec: this._nextBreathDueAtSec,
      nextSighAllowedAtSec: this._nextSighAllowedAtSec,
      lastSighReason: this._lastSighReason,
      totalSighsTriggered: this._totalSighsTriggered,
      lightDamageVariantIndex: this._lightDamageVariantIndex,
      heavyDamageVariantIndex: this._heavyDamageVariantIndex,
      lastPlayedRecipeId: this._lastPlayedRecipeId,
      breathHoldUntilSec: this._breathHoldUntilSec,
      canTriggerBreathing: this.canTriggerBreathing(),
    }
  }

  reset() {
    this.stopActiveCue({ immediate: true })
    const ctx = this._getContext()
    const ctxTime = ctx && Number.isFinite(ctx.currentTime) ? ctx.currentTime : 0
    this._clockSec = ctxTime
    this._lastCtxTime = ctx && Number.isFinite(ctx.currentTime) ? ctx.currentTime : null
    this._breathHoldUntilSec = 0
    this._nextBreathDueAtSec = 0
    this._nextSighAllowedAtSec = 0
    this._strainedRemainingSec = 0
    this._exertionAccumSec = 0
    this._exhaustedSighLatched = false
    this._strainedSighPending = false
    this._reliefSighPending = false
    this._lastSighReason = null
    this._totalSighsTriggered = 0
    this._currentBreathingState = PLAYER_BREATHING_STATES.RESTING
    this._currentBreathingProfileId = PLAYER_BREATHING_STATES.RESTING
    this._smoothedBreathIntensity = PLAYER_BREATHING_PROFILES[PLAYER_BREATHING_STATES.RESTING].intensity
    this._restingRecoveryBreathsRemaining = 0
    this._isRestingSilenced = true
    this._breathVariantIndices.clear()
    this._lightDamageVariantIndex = 0
    this._heavyDamageVariantIndex = 0
    this._lastPlayedRecipeId = null
  }

  dispose() {
    this.stopActiveCue({ immediate: true })
    this._breathHoldUntilSec = 0
    this._nextBreathDueAtSec = 0
    this._nextSighAllowedAtSec = 0
    this._strainedRemainingSec = 0
    this._exertionAccumSec = 0
    this._exhaustedSighLatched = false
    this._strainedSighPending = false
    this._reliefSighPending = false
    this._lastCtxTime = null
    this._breathVariantIndices.clear()
    this._disposed = true
  }
}

export function createPlayerVocalController(options = {}) {
  return new PlayerVocalController(options)
}
