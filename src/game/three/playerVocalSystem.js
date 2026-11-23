/**
 * Centralized Player Character Vocal Synthesis & Monophonic Playback Controller.
 *
 * Sole owner of:
 * - Foundational deep, mature, masculine, chest-resonant vocal synthesis
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

export const DEFAULT_PLAYER_VOICE_SPEC = Object.freeze({
  id: 'foundation_chest_voice',
  kind: 'vocal',
  priority: PLAYER_VOCAL_PRIORITIES.ELEVATOR_LANDING,
  durationSec: 0.42,
  attackSec: 0.028,
  releaseSec: 0.09,
  f0StartHz: 102,
  f0PeakHz: 106,
  f0EndHz: 84,
  f0PeakAt: 0.18,
  chestFundamentalWeight: 0.92,
  secondHarmonicWeight: 0.78,
  thirdHarmonicWeight: 0.56,
  upperGlottalWeight: 0.28,
  aspirationGain: 0.09,
  f1Hz: 520,
  f1Q: 2.0,
  f2Hz: 1040,
  f2Q: 2.1,
  warmLowpassHz: 1950,
  gain: 0.34,
  postVocalBreathHoldSec: 0.35,
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
 * Normalizes a partial vocal specification against foundational deep-male chest limits.
 */
export function normalizePlayerVocalSpec(spec = {}) {
  const merged = {
    ...DEFAULT_PLAYER_VOICE_SPEC,
    ...(spec && typeof spec === 'object' ? spec : {}),
  }

  const durationSec = clampNumber(merged.durationSec, 0.08, 2.5, DEFAULT_PLAYER_VOICE_SPEC.durationSec)
  const attackSec = clampNumber(merged.attackSec, 0.018, durationSec * 0.45, DEFAULT_PLAYER_VOICE_SPEC.attackSec)
  const releaseSec = clampNumber(merged.releaseSec, 0.035, durationSec * 0.65, DEFAULT_PLAYER_VOICE_SPEC.releaseSec)

  // Adult male chest fundamental clamped strictly to deep masculine range [72, 128] Hz
  const f0StartHz = clampNumber(merged.f0StartHz, 72, 128, DEFAULT_PLAYER_VOICE_SPEC.f0StartHz)
  const f0PeakHz = clampNumber(merged.f0PeakHz, 72, 132, Math.max(f0StartHz, DEFAULT_PLAYER_VOICE_SPEC.f0PeakHz))
  const f0EndHz = clampNumber(merged.f0EndHz, 70, 124, DEFAULT_PLAYER_VOICE_SPEC.f0EndHz)
  const f0PeakAt = clampNumber(merged.f0PeakAt, 0.08, 0.75, DEFAULT_PLAYER_VOICE_SPEC.f0PeakAt)

  return {
    id: String(merged.id || DEFAULT_PLAYER_VOICE_SPEC.id),
    kind: String(merged.kind || DEFAULT_PLAYER_VOICE_SPEC.kind),
    priority: clampNumber(
      merged.priority,
      PLAYER_VOCAL_PRIORITIES.IDLE,
      PLAYER_VOCAL_PRIORITIES.DEATH,
      DEFAULT_PLAYER_VOICE_SPEC.priority
    ),
    durationSec,
    attackSec,
    releaseSec,
    f0StartHz,
    f0PeakHz,
    f0EndHz,
    f0PeakAt,
    chestFundamentalWeight: clampNumber(
      merged.chestFundamentalWeight,
      0.2,
      1.2,
      DEFAULT_PLAYER_VOICE_SPEC.chestFundamentalWeight
    ),
    secondHarmonicWeight: clampNumber(
      merged.secondHarmonicWeight,
      0.25,
      1.1,
      DEFAULT_PLAYER_VOICE_SPEC.secondHarmonicWeight
    ),
    thirdHarmonicWeight: clampNumber(
      merged.thirdHarmonicWeight,
      0.15,
      0.95,
      DEFAULT_PLAYER_VOICE_SPEC.thirdHarmonicWeight
    ),
    upperGlottalWeight: clampNumber(
      merged.upperGlottalWeight,
      0.0,
      0.65,
      DEFAULT_PLAYER_VOICE_SPEC.upperGlottalWeight
    ),
    aspirationGain: clampNumber(merged.aspirationGain, 0.0, 0.35, DEFAULT_PLAYER_VOICE_SPEC.aspirationGain),
    f1Hz: clampNumber(merged.f1Hz, 340, 740, DEFAULT_PLAYER_VOICE_SPEC.f1Hz),
    f1Q: clampNumber(merged.f1Q, 1.1, 3.0, DEFAULT_PLAYER_VOICE_SPEC.f1Q),
    f2Hz: clampNumber(merged.f2Hz, 780, 1450, DEFAULT_PLAYER_VOICE_SPEC.f2Hz),
    f2Q: clampNumber(merged.f2Q, 1.1, 3.0, DEFAULT_PLAYER_VOICE_SPEC.f2Q),
    warmLowpassHz: clampNumber(merged.warmLowpassHz, 950, 2200, DEFAULT_PLAYER_VOICE_SPEC.warmLowpassHz),
    gain: clampNumber(merged.gain, 0.02, 0.85, DEFAULT_PLAYER_VOICE_SPEC.gain),
    postVocalBreathHoldSec: clampNumber(
      merged.postVocalBreathHoldSec,
      0.0,
      1.5,
      DEFAULT_PLAYER_VOICE_SPEC.postVocalBreathHoldSec
    ),
  }
}

/**
 * Renders a continuous, phase-coherent, deep-male vocal waveform into a Float32Array.
 *
 * Guarantees:
 * - Continuous phase integration without sudden resets, frame boundaries, or amplitude chopping
 * - Adult male chest fundamental F0 (70–132 Hz) plus strong 2nd & 3rd harmonics (150–360 Hz)
 *   for natural clarity on both headphones and laptop speakers
 * - Restrained vocal-tract formants (F1/F2) and warm low-pass roll-off (<= 2200 Hz)
 * - Smooth raised-cosine attack and release envelopes
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
    Math.min(1150, normalized.f1Hz * 1.45),
    1.45
  )
  const warmLpCoeffs = createBiquadLowpassCoeffs(sampleRate, normalized.warmLowpassHz, 0.74)

  const f1State = { x1: 0, x2: 0, y1: 0, y2: 0 }
  const f2State = { x1: 0, x2: 0, y1: 0, y2: 0 }
  const breathState = { x1: 0, x2: 0, y1: 0, y2: 0 }
  const warmLpState = { x1: 0, x2: 0, y1: 0, y2: 0 }

  let phase = 0
  let pink0 = 0
  let pink1 = 0
  let pink2 = 0
  let peakAbs = 0

  for (let i = 0; i < frameCount; i += 1) {
    const timeSec = i / sampleRate
    const normT = i / Math.max(1, frameCount - 1)
    const env = evaluateContinuousEnvelope(
      timeSec,
      normalized.durationSec,
      normalized.attackSec,
      normalized.releaseSec
    )

    // Smooth continuous F0 contour with subtle low-rate natural drift (no high-rate buzz or random jitter)
    const baseF0 = evaluateSmoothContour(
      normT,
      normalized.f0StartHz,
      normalized.f0PeakHz,
      normalized.f0EndHz,
      normalized.f0PeakAt
    )
    const lowRateDrift = 1 + 0.003 * Math.sin(2 * Math.PI * 3.1 * timeSec)
    const instF0 = clampNumber(baseF0 * lowRateDrift, 70, 132, baseF0)

    phase += (2 * Math.PI * instF0) / sampleRate
    if (phase > Math.PI * 2) {
      phase -= Math.PI * 2
    }

    // Continuous phase-locked harmonic chest source:
    // 1*F0 (chest weight), 2*F0 & 3*F0 (laptop speaker body & presence), 4*F0-5*F0 (soft warm vocal fold edge)
    const h1 = Math.sin(phase) * normalized.chestFundamentalWeight
    const h2 = Math.sin(2 * phase + 0.28) * normalized.secondHarmonicWeight
    const h3 = Math.sin(3 * phase + 0.55) * normalized.thirdHarmonicWeight
    const h4 = Math.sin(4 * phase + 0.82) * (normalized.upperGlottalWeight * 0.65)
    const h5 = Math.sin(5 * phase + 1.08) * (normalized.upperGlottalWeight * 0.35)

    const rawGlottal = Math.tanh((h1 + h2 + h3 + h4 + h5) * 0.72)

    // Parallel chest fundamental + vocal tract formants (F1 + F2)
    const f1Out = stepBiquad(rawGlottal, f1Coeffs, f1State)
    const f2Out = stepBiquad(rawGlottal, f2Coeffs, f2State)
    const voicedBody =
      (h1 * 0.42 + h2 * 0.34 + h3 * 0.18) +
      f1Out * 0.68 +
      f2Out * 0.36

    // Continuous organic airflow/aspiration layer (never pulsed or chopped)
    let rawNoise
    if (noiseLength > 0) {
      rawNoise = noiseChannelData[i % noiseLength]
    } else {
      const deterministicSeed = Math.sin(i * 12.9898 + 78.233) * 43758.5453
      const white = (deterministicSeed - Math.floor(deterministicSeed)) * 2 - 1
      pink0 = 0.997 * pink0 + white * 0.029
      pink1 = 0.985 * pink1 + white * 0.032
      pink2 = 0.95 * pink2 + white * 0.048
      rawNoise = (pink0 + pink1 + pink2 + white * 0.16) * 0.7
    }
    const aspiration = stepBiquad(rawNoise, breathFormantCoeffs, breathState) * normalized.aspirationGain

    const combined = (voicedBody + aspiration) * env
    const warmFiltered = stepBiquad(combined, warmLpCoeffs, warmLpState)
    const outSample = Math.tanh(warmFiltered * 0.92)

    samples[i] = outSample
    const absVal = Math.abs(outSample)
    if (absVal > peakAbs) {
      peakAbs = absVal
    }
  }

  // Normalize peak to target spec gain while preserving smooth dynamic contour
  const targetPeak = clampNumber(normalized.gain, 0.02, 0.85, DEFAULT_PLAYER_VOICE_SPEC.gain)
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
 * Computes deterministic DSP quality metrics on a rendered player vocal waveform
 * for automated test verification (continuity, envelope smoothness, fundamental & harmonic band presence).
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

  // Measure body continuity across 25 ms windows inside the central 20%..72% sustain region
  // to prove there are zero "dot-dot-dot" / pulsed amplitude dropouts.
  const bodyStart = Math.floor(n * 0.2)
  const bodyEnd = Math.floor(n * 0.72)
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

  // Short-time Fourier probe across target frequency bands inside the active vocal core
  const measureBandEnergy = (freqs) => {
    const probeWin = Math.max(256, Math.min(n, Math.floor(sampleRate * 0.045)))
    const probeStart = Math.max(0, Math.min(n - probeWin, Math.floor(n * 0.22)))
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

  const f0Min = Math.min(spec.f0StartHz, spec.f0PeakHz, spec.f0EndHz)
  const f0Max = Math.max(spec.f0StartHz, spec.f0PeakHz, spec.f0EndHz)
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
  const harshHighBandEnergy = measureBandEnergy([3400, 4200, 5200])
  const harshHighFreqEnergyRatio =
    chestFundamentalBandEnergy + upperBassHarmonicBandEnergy > 1e-6
      ? harshHighBandEnergy / (chestFundamentalBandEnergy + upperBassHarmonicBandEnergy)
      : 0

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

  const now = ctx.currentTime || 0
  const source = ctx.createBufferSource()
  source.buffer = audioBuffer

  const warmFilter = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (warmFilter) {
    warmFilter.type = 'lowpass'
    setAudioParamAtTime(warmFilter.frequency, normalized.warmLowpassHz, now)
    setAudioParamAtTime(warmFilter.Q, 0.72, now)
  }

  const outputGain = ctx.createGain()
  setAudioParamAtTime(outputGain.gain, 1.0, now)

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
    const safeFadeSec = immediate ? 0 : clampNumber(fadeSec, 0.008, 0.12, 0.024)

    if (!immediate && safeFadeSec > 0 && outputGain?.gain) {
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

  source.start(now)

  return {
    id: normalized.id,
    kind: normalized.kind,
    priority: normalized.priority,
    durationSec: normalized.durationSec,
    startedAtSec: now,
    endsAtSec: now + normalized.durationSec,
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
 * Strict monophonic controller for all player-character vocalizations.
 * Guarantees at most one active vocal handle at any time, deterministic priority preemption,
 * post-vocal breathing cadence hold tracking, and leak-free node disposal.
 */
export class PlayerVocalController {
  constructor({
    getContext,
    getDestination,
    getNoiseBuffer = () => null,
    scheduleFadeCleanup = null,
    random = Math.random,
  } = {}) {
    this._getContext = typeof getContext === 'function' ? getContext : () => null
    this._getDestination = typeof getDestination === 'function' ? getDestination : () => null
    this._getNoiseBuffer = typeof getNoiseBuffer === 'function' ? getNoiseBuffer : () => null
    this._scheduleFadeCleanup = typeof scheduleFadeCleanup === 'function' ? scheduleFadeCleanup : null
    this._random = typeof random === 'function' ? random : Math.random

    this._activeHandle = null
    this._clockSec = 0
    this._breathHoldUntilSec = 0
    this._nextBreathDueAtSec = 0
    this._disposed = false
  }

  _resolveNowSec() {
    const ctx = this._getContext()
    if (ctx && Number.isFinite(ctx.currentTime)) {
      return Math.max(this._clockSec, ctx.currentTime)
    }
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
   * Plays a prioritized player vocal cue using strict monophonic preemption rules:
   * - If an active cue has strictly higher priority than the incoming cue (and `force !== true`),
   *   the incoming cue is rejected (`null`) so low-priority breathing never interrupts high-priority vocals.
   * - If the incoming cue has equal or higher priority (or `force === true`), any active cue is
   *   immediately preempted and cleaned up before starting the new cue.
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

    let createdHandle = null
    createdHandle = synthesizePlayerVocalCue(ctx, destination, normalized, {
      noiseBuffer: this._getNoiseBuffer(),
      scheduleFadeCleanup: this._scheduleFadeCleanup,
      onEnded: () => {
        if (this._activeHandle && this._activeHandle === createdHandle) {
          this._activeHandle = null
        }
      },
    })

    if (!createdHandle) return null

    this._activeHandle = createdHandle
    const nowSec = this._resolveNowSec()
    if (normalized.priority >= PLAYER_VOCAL_PRIORITIES.ELEVATOR_LANDING) {
      this._breathHoldUntilSec = Math.max(
        this._breathHoldUntilSec,
        nowSec + normalized.durationSec + normalized.postVocalBreathHoldSec
      )
    }

    return createdHandle
  }

  /**
   * Stops and disconnects the currently active player vocal handle, if any.
   */
  stopActiveCue({ immediate = false, fadeSec = 0.024 } = {}) {
    const handle = this._activeHandle
    this._activeHandle = null
    if (!handle) return false
    handle.stop({ immediate, fadeSec })
    return true
  }

  /**
   * Advances internal controller clock and prunes completed handles.
   */
  update(deltaSec = 0) {
    if (this._disposed) return
    const dt = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 0
    this._clockSec += dt
    const ctx = this._getContext()
    if (ctx && Number.isFinite(ctx.currentTime) && ctx.currentTime > this._clockSec) {
      this._clockSec = ctx.currentTime
    }
    this._pruneExpiredHandle()
  }

  /**
   * Extends the post-vocal breathing hold window by `holdSec`.
   */
  holdBreathing(holdSec = 0.35) {
    const safeHold = clampNumber(holdSec, 0, 5.0, 0.35)
    const nowSec = this._resolveNowSec()
    this._breathHoldUntilSec = Math.max(this._breathHoldUntilSec, nowSec + safeHold)
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
      activePriority: active ? active.priority : PLAYER_VOCAL_PRIORITIES.IDLE,
      breathHoldUntilSec: this._breathHoldUntilSec,
      canTriggerBreathing: this.canTriggerBreathing(),
    }
  }

  reset() {
    this.stopActiveCue({ immediate: true })
    this._breathHoldUntilSec = 0
    this._nextBreathDueAtSec = 0
  }

  dispose() {
    this.stopActiveCue({ immediate: true })
    this._breathHoldUntilSec = 0
    this._nextBreathDueAtSec = 0
    this._disposed = true
  }
}

export function createPlayerVocalController(options = {}) {
  return new PlayerVocalController(options)
}
