import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import { HorrorAudioEngine, THUNDER_AUDIO_CONFIG } from './HorrorAudioEngine.js'
import { HORROR_EVENT_TYPES, HORROR_INTENSITY_LEVELS } from './HorrorDirector.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  THUNDERSTORM_RAIN_CONSTANTS,
  THUNDER_AUDIO_CONSTANTS,
  createNoiseBuffer,
  createRainNoiseBuffer,
  startThunderstormRainBed,
  triggerDistantThunderCue,
  triggerLightningCrackCue,
  triggerPlayerFootstep,
} from './audioSynthesis.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function makeDeterministicRng(seed = 2026) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function createEnvelopeRecordingContext() {
  const stats = {
    oscillatorsCreated: 0,
    bufferSourcesStarted: 0,
    bufferSourcesStopped: 0,
    gainsCreated: 0,
    filtersCreated: 0,
    disconnectedCount: 0,
    connections: [],
  }
  const recordedBursts = []
  const recordedFilters = []

  function makeGainParam(initial = 1) {
    const events = [{ type: 'init', value: initial, time: 0 }]
    const param = {
      value: initial,
      events,
      setValueAtTime(v, t = 0) {
        this.value = v
        events.push({ type: 'setValue', value: v, time: t })
      },
      linearRampToValueAtTime(v, t = 0) {
        this.value = v
        events.push({ type: 'linearRamp', value: v, time: t })
      },
      exponentialRampToValueAtTime(v, t = 0) {
        this.value = v
        events.push({ type: 'expRamp', value: v, time: t })
      },
      setTargetAtTime(v, t = 0, tau = 0.03) {
        this.value = v
        events.push({ type: 'setTarget', value: v, time: t, tau })
      },
      cancelScheduledValues(t = 0) {
        events.push({ type: 'cancel', time: t })
      },
    }
    return param
  }

  let nextId = 1
  function makeBaseNode(kind, extra = {}) {
    const node = {
      _id: nextId++,
      _kind: kind,
      connect(dest) {
        stats.connections.push({ from: node, to: dest })
      },
      disconnect() {
        stats.disconnectedCount += 1
      },
      ...extra,
    }
    return node
  }

  const ctx = {
    state: 'running',
    currentTime: 10.0,
    sampleRate: 44100,
    destination: makeBaseNode('destination'),
    listener: {
      positionX: makeGainParam(0),
      positionY: makeGainParam(0),
      positionZ: makeGainParam(0),
      forwardX: makeGainParam(0),
      forwardY: makeGainParam(0),
      forwardZ: makeGainParam(-1),
      upX: makeGainParam(0),
      upY: makeGainParam(1),
      upZ: makeGainParam(0),
    },
    async resume() {
      ctx.state = 'running'
    },
    async suspend() {
      ctx.state = 'suspended'
    },
    async close() {
      ctx.state = 'closed'
    },
    createDelay(maxDelayTime = 1) {
      return makeBaseNode('delay', { maxDelayTime, delayTime: makeGainParam(0) })
    },
    createGain() {
      stats.gainsCreated += 1
      return makeBaseNode('gain', { gain: makeGainParam(1) })
    },
    createDynamicsCompressor() {
      return makeBaseNode('compressor', {
        threshold: makeGainParam(-14),
        knee: makeGainParam(18),
        ratio: makeGainParam(6),
      })
    },
    createBiquadFilter() {
      stats.filtersCreated += 1
      const f = makeBaseNode('filter', {
        type: 'lowpass',
        frequency: makeGainParam(1000),
        Q: makeGainParam(1),
      })
      recordedFilters.push(f)
      return f
    },
    createPanner() {
      return makeBaseNode('panner', {
        panningModel: 'HRTF',
        distanceModel: 'linear',
        refDistance: 1.8,
        maxDistance: 22.0,
        rolloffFactor: 0,
        positionX: makeGainParam(0),
        positionY: makeGainParam(0),
        positionZ: makeGainParam(0),
      })
    },
    createOscillator() {
      stats.oscillatorsCreated += 1
      return makeBaseNode('oscillator', {
        type: 'sine',
        frequency: makeGainParam(220),
        start() {},
        stop() {},
      })
    },
    createBuffer(channels, len, sr) {
      const data = new Float32Array(len)
      return {
        numberOfChannels: channels,
        length: len,
        sampleRate: sr,
        duration: len / sr,
        getChannelData: () => data,
      }
    },
    createBufferSource() {
      let started = false
      let stopped = false
      const entry = {
        src: null,
        gainNode: null,
        filterNode: null,
        startAt: null,
        offset: null,
        duration: null,
        stopAt: null,
      }
      const src = makeBaseNode('bufferSource', {
        buffer: null,
        loop: false,
        onended: null,
        connect(dest) {
          stats.connections.push({ from: src, to: dest })
          if (dest?._kind === 'filter') {
            entry.filterNode = dest
            const origFilterConnect = dest.connect.bind(dest)
            dest.connect = (nextDest) => {
              if (nextDest?._kind === 'gain') {
                entry.gainNode = nextDest
              }
              origFilterConnect(nextDest)
            }
          } else if (dest?._kind === 'gain') {
            entry.gainNode = dest
          }
        },
        start(when = 0, offset = 0, duration = null) {
          if (!started) {
            started = true
            stats.bufferSourcesStarted += 1
            entry.startAt = when
            entry.offset = offset
            entry.duration = duration
            recordedBursts.push(entry)
          }
        },
        stop(when = 0) {
          if (started && !stopped) {
            stopped = true
            entry.stopAt = when
            if (entry.duration == null) {
              entry.duration = Math.max(0, when - entry.startAt)
            }
            stats.bufferSourcesStopped += 1
            this.onended?.()
          }
        },
      })
      entry.src = src
      return src
    },
  }

  return { ctx, stats, recordedBursts, recordedFilters }
}

/**
 * Evaluates a recorded Web Audio gain param automation curve at absolute time `t`.
 */
function evalGainEventsAt(events, t, startTime, stopTime) {
  if (t < startTime || (stopTime != null && t > stopTime)) {
    return 0
  }
  let curVal = events[0]?.value ?? 1
  let curTime = startTime
  for (let i = 1; i < events.length; i += 1) {
    const ev = events[i]
    if (ev.type === 'setValue') {
      if (t < ev.time) return curVal
      curVal = ev.value
      curTime = ev.time
    } else if (ev.type === 'linearRamp') {
      if (t <= ev.time) {
        const span = ev.time - curTime
        if (span <= 1e-9) return ev.value
        const frac = Math.max(0, Math.min(1, (t - curTime) / span))
        return curVal + (ev.value - curVal) * frac
      }
      curVal = ev.value
      curTime = ev.time
    } else if (ev.type === 'expRamp') {
      if (t <= ev.time) {
        const span = ev.time - curTime
        if (span <= 1e-9) return ev.value
        const frac = Math.max(0, Math.min(1, (t - curTime) / span))
        const a = Math.max(1e-6, curVal)
        const b = Math.max(1e-6, ev.value)
        return a * Math.pow(b / a, frac)
      }
      curVal = ev.value
      curTime = ev.time
    }
  }
  return curVal
}

function sampleCombinedGainCurve(recordedBursts, startAbs, endAbs, stepSec = 0.002) {
  let maxGain = 0
  let maxAtRelSec = 0
  for (let t = startAbs; t <= endAbs; t += stepSec) {
    let sum = 0
    for (let i = 0; i < recordedBursts.length; i += 1) {
      const b = recordedBursts[i]
      if (!b.gainNode) continue
      const g = evalGainEventsAt(
        b.gainNode.gain.events,
        t,
        b.startAt,
        b.stopAt ?? b.startAt + (b.duration || 0)
      )
      sum += g
    }
    if (sum > maxGain) {
      maxGain = sum
      maxAtRelSec = t - startAbs
    }
  }
  return { maxGain, maxAtRelSec }
}

console.log('--- RUNNING PHASE 2 THUNDER & LIGHTNING AUDIO TESTS ---')

// ---------------------------------------------------------------------------
// Test 1: Distant Rolling Thunder Synthesis, Variations, Speaker Presence & Gain Cap
// ---------------------------------------------------------------------------
console.log('Test 1: Distant Rolling Thunder Variations, Envelopes & <= 0.26 Peak Cap')

for (let variant = 0; variant < 4; variant += 1) {
  const mock = createEnvelopeRecordingContext()
  const dest = mock.ctx.createGain()
  const rainBuf = createRainNoiseBuffer(mock.ctx, THUNDERSTORM_RAIN_CONSTANTS.bufferDurationSec)
  const t0 = mock.ctx.currentTime

  const handle = triggerDistantThunderCue(mock.ctx, dest, rainBuf, {
    variant,
    random: makeDeterministicRng(100 + variant * 37),
  })

  assert(
    mock.stats.oscillatorsCreated === 0,
    `Distant thunder variant ${variant} uses zero oscillators/musical tones (got ${mock.stats.oscillatorsCreated})`
  )
  assert(
    mock.recordedBursts.length === 3 &&
      mock.recordedBursts.every((b) => b.stopAt != null || (b.duration != null && b.duration > 0)),
    `Distant thunder variant ${variant} spawns 3 finite noise layers`
  )

  const maxStop = Math.max(
    ...mock.recordedBursts.map((b) => (b.stopAt ?? (b.startAt + (b.duration || 0))) - t0)
  )
  assert(
    maxStop >= THUNDER_AUDIO_CONSTANTS.distantMinDurationSec - 0.08 &&
      maxStop <= THUNDER_AUDIO_CONSTANTS.distantMaxDurationSec + 0.35,
    `Distant thunder variant ${variant} total burst span ~3.5–6.0s (got ${maxStop.toFixed(2)}s)`
  )

  // Verify mid-low warmth for ordinary laptop speakers (>= 250 Hz filter energy alongside sub-200 Hz roll)
  const filterFreqs = mock.recordedFilters.flatMap((f) =>
    f.frequency.events.map((e) => e.value)
  )
  assert(
    filterFreqs.some((hz) => hz < 200) && filterFreqs.some((hz) => hz >= 280),
    `Distant thunder variant ${variant} pairs deep sub-200Hz roll with laptop-speaker audible >=280Hz body`
  )

  // Verify natural swells & decay and combined source gain <= 0.26
  const sampled = sampleCombinedGainCurve(mock.recordedBursts, t0, t0 + maxStop + 0.05, 0.01)
  assert(
    sampled.maxGain >= 0.14 &&
      sampled.maxGain <= THUNDER_AUDIO_CONSTANTS.distantMaxCombinedGain + 1e-6,
    `Distant thunder variant ${variant} combined gain in [0.14, 0.26] (peak=${sampled.maxGain.toFixed(4)})`
  )

  // Check irregular swell profile: gain has >= 2 local maxima on primary lowpass layer
  const primarySteps = mock.recordedBursts[0].gainNode.gain.events.filter(
    (e) => e.type === 'linearRamp'
  )
  assert(
    primarySteps.length >= 4 &&
      primarySteps.some((e, i) => i > 0 && e.value < primarySteps[i - 1].value) &&
      primarySteps.some((e, i) => i >= 2 && e.value > primarySteps[i - 1].value),
    `Distant thunder variant ${variant} exhibits irregular rolling swells before decay`
  )

  handle.stop({ immediate: true })
}

// Duration clamping boundaries + reducedMotion softening
{
  const mockLow = createEnvelopeRecordingContext()
  const bufLow = createRainNoiseBuffer(mockLow.ctx, 4.8)
  const destLow = mockLow.ctx.createGain()
  const hLow = triggerDistantThunderCue(mockLow.ctx, destLow, bufLow, {
    durationSec: 1.0,
    reducedMotion: true,
    random: makeDeterministicRng(55),
  })
  const spanLow = Math.max(
    ...mockLow.recordedBursts.map(
      (b) => (b.stopAt ?? (b.startAt + (b.duration || 0))) - mockLow.ctx.currentTime
    )
  )
  assert(
    hLow.durationSec >= THUNDER_AUDIO_CONSTANTS.distantMinDurationSec && spanLow >= 3.42,
    `Distant thunder clamps overly short durations >= 3.5s (handle=${hLow.durationSec.toFixed(2)}s, burst=${spanLow.toFixed(2)}s)`
  )
  const sampledRM = sampleCombinedGainCurve(
    mockLow.recordedBursts,
    mockLow.ctx.currentTime,
    mockLow.ctx.currentTime + spanLow + 0.05,
    0.01
  )
  assert(
    sampledRM.maxGain <=
      THUNDER_AUDIO_CONSTANTS.distantMaxCombinedGain *
        THUNDER_AUDIO_CONSTANTS.distantReducedMotionScale +
        1e-6,
    `reducedMotion softens distant thunder peak gain (peak=${sampledRM.maxGain.toFixed(4)})`
  )
  hLow.stop({ immediate: true })
}
console.log('✓ Distant rolling thunder (4 variants, 3.5-6s, zero oscillators, <= 0.26 cap, reducedMotion softening) verified')

// ---------------------------------------------------------------------------
// Test 2: Lightning Thunder Crack Synthesis, Staggered Reflections & Peak Caps
// ---------------------------------------------------------------------------
console.log('Test 2: Lightning Thunder Crack (50-90ms Transient <= 0.30, 2.8-4.5s Tail <= 0.22)')

for (let variant = 0; variant < 3; variant += 1) {
  for (const tailOverride of [2.8, 4.5]) {
    const mock = createEnvelopeRecordingContext()
    const dest = mock.ctx.createGain()
    const rainBuf = createRainNoiseBuffer(mock.ctx, THUNDERSTORM_RAIN_CONSTANTS.bufferDurationSec)
    const t0 = mock.ctx.currentTime

    const handle = triggerLightningCrackCue(mock.ctx, dest, rainBuf, {
      variant,
      tailDurationSec: tailOverride,
      random: makeDeterministicRng(700 + variant * 19 + Math.round(tailOverride * 10)),
    })

    assert(
      mock.stats.oscillatorsCreated === 0,
      `Lightning crack variant ${variant} uses zero oscillators`
    )
    assert(
      handle.transientDurationSec >= THUNDER_AUDIO_CONSTANTS.crackTransientMinSec &&
        handle.transientDurationSec <= THUNDER_AUDIO_CONSTANTS.crackTransientMaxSec,
      `Lightning crack transient within 50-90ms (got ${(handle.transientDurationSec * 1000).toFixed(1)}ms)`
    )
    assert(
      handle.tailDurationSec >= THUNDER_AUDIO_CONSTANTS.crackTailMinSec &&
        handle.tailDurationSec <= THUNDER_AUDIO_CONSTANTS.crackTailMaxSec,
      `Lightning crack tail within 2.8-4.5s (got ${handle.tailDurationSec.toFixed(2)}s)`
    )

    // Verify first 2 bursts are the 50-90ms crack transient starting at t0
    const transientBursts = mock.recordedBursts.slice(0, 2)
    assert(
      transientBursts.every(
        (b) =>
          Math.abs(b.startAt - t0) < 1e-6 &&
          b.duration >= 0.045 &&
          b.duration <= THUNDER_AUDIO_CONSTANTS.crackTransientMaxSec + 1e-6
      ),
      'Initial crack transient layers fire immediately within 50-90ms'
    )

    // Verify reflections are staggered AFTER transient finishes
    const reflectionBursts = mock.recordedBursts.slice(2, mock.recordedBursts.length - 3)
    assert(
      reflectionBursts.length >= 3 &&
        reflectionBursts.every((b) => b.startAt - t0 >= handle.transientDurationSec + 0.02),
      `Crack variant ${variant} schedules >=3 staggered reflections after transient`
    )
    for (let i = 1; i < reflectionBursts.length; i += 1) {
      assert(
        reflectionBursts[i].startAt > reflectionBursts[i - 1].startAt + 0.05,
        `Crack variant ${variant} reflection ${i} is distinctly staggered`
      )
    }

    // Measure exact sampled instantaneous combined gain during transient [0, transientDur]
    const transientSample = sampleCombinedGainCurve(
      mock.recordedBursts,
      t0,
      t0 + handle.transientDurationSec,
      0.001
    )
    assert(
      transientSample.maxGain >= 0.18 &&
        transientSample.maxGain <= THUNDER_AUDIO_CONSTANTS.crackMaxTransientGain + 1e-6,
      `Crack transient peak in [0.18, 0.30] (got ${transientSample.maxGain.toFixed(4)})`
    )

    // Measure exact sampled instantaneous combined gain across all reflections + tail AFTER transient
    const laterSample = sampleCombinedGainCurve(
      mock.recordedBursts,
      t0 + handle.transientDurationSec + 0.005,
      t0 + handle.durationSec,
      0.005
    )
    assert(
      laterSample.maxGain > 0.08 &&
        laterSample.maxGain <= THUNDER_AUDIO_CONSTANTS.crackMaxTailAndReflectionGain + 1e-6,
      `Crack reflections & tail combined peak never exceeds 0.22 (variant=${variant}, tail=${tailOverride}s, got=${laterSample.maxGain.toFixed(4)} at +${laterSample.maxAtRelSec.toFixed(2)}s)`
    )

    handle.stop({ immediate: true })
  }
}
console.log('✓ Lightning thunder crack (3 variants, 50-90ms <= 0.30, staggered reflections + 2.8-4.5s tail <= 0.22) verified')

// ---------------------------------------------------------------------------
// Test 3: Independent Scheduling, Grace Period, Intervals, Cooldown & Ambient Isolation
// ---------------------------------------------------------------------------
console.log('Test 3: Thunder Scheduling, Initial Grace (6-11s), Intervals (16-36s), Crack Cooldown (48-88s) & Ambient Isolation')

const mazeA = generateMaze({ difficulty: 'medium', seed: 4242 })
const mazeB = generateMaze({ difficulty: 'medium', seed: 8484 })
const playerStartA = gridToWorld(mazeA.start.row, mazeA.start.col, mazeA)

// Verify default grace (6-11s) across 15 random seeds
for (let s = 1; s <= 15; s += 1) {
  const m = createEnvelopeRecordingContext()
  const eng = new HorrorAudioEngine({
    createAudioContext: () => m.ctx,
    autoUnlock: true,
    thunderRandom: makeDeterministicRng(s * 977),
    ambientRandom: makeDeterministicRng(123),
  })
  eng.setMaze(mazeA)
  const initialTimer = eng.getThunderAudioState().nextEventInSec
  assert(
    initialTimer >= THUNDER_AUDIO_CONFIG.initialGraceMinSec - 1e-6 &&
      initialTimer <= THUNDER_AUDIO_CONFIG.initialGraceMaxSec + 1e-6,
    `Initial thunder grace within 6-11s for seed ${s} (got ${initialTimer.toFixed(2)}s)`
  )
  eng.dispose()
}

// Long 240s run with biased-low thunderRandom to verify:
// - First trigger >= 6s
// - No lightning crack before 20s elapsed
// - Consecutive lightning cracks spaced >= 48s
// - Intervals between triggers stay within [16, 36]s (+ active duration waiting)
// - Max 1 active thunder cue at any time (never overlaps)
{
  const mSched = createEnvelopeRecordingContext()
  // Always return 0.12 so crackChanceWhenReady (0.38) ALWAYS tries to pick a crack when allowed
  let lowRngStep = 0
  const crackBiasedRng = () => {
    lowRngStep += 1
    return (lowRngStep % 5) * 0.05 // cycles 0.00, 0.05, 0.10, 0.15, 0.20 (all < 0.38)
  }
  const eng = new HorrorAudioEngine({
    createAudioContext: () => mSched.ctx,
    autoUnlock: true,
    rainEnabled: true,
    thunderRandom: crackBiasedRng,
    ambientRandom: makeDeterministicRng(333),
    recordCueHistory: true,
  })
  eng.setMaze(mazeA)

  let overlappingDetected = false
  for (let i = 0; i < 2400; i += 1) {
    eng.update(0.1, { playerWorldPos: playerStartA })
    const activeThunder = eng.getThunderAudioState().activeCue
    if (activeThunder && eng._thunderClockSec - eng._thunderLastTriggerAtSec > 6.5) {
      overlappingDetected = true
    }
  }
  assert(!overlappingDetected, 'Thunder cues never overlap or exceed expected active duration')

  const cues = eng.getCueHistory()
  const distantCues = cues.filter((c) => c.type === 'thunder_distant')
  const crackCues = cues.filter((c) => c.type === 'thunder_crack')
  const allThunderCues = cues.filter(
    (c) => c.type === 'thunder_distant' || c.type === 'thunder_crack'
  )

  assert(
    allThunderCues.length >= 6 &&
      allThunderCues[0].time >= THUNDER_AUDIO_CONFIG.initialGraceMinSec - 0.11 &&
      allThunderCues[0].time <= THUNDER_AUDIO_CONFIG.initialGraceMaxSec + 0.11,
    `First thunder fires cleanly inside 6-11s grace window (first=${allThunderCues[0]?.time?.toFixed(2)}s)`
  )
  assert(
    distantCues.length >= 1 && crackCues.length >= 2,
    `Long run produces both distant thunder (${distantCues.length}) and lightning cracks (${crackCues.length})`
  )
  assert(
    crackCues.every((c) => c.time >= THUNDER_AUDIO_CONFIG.minCrackElapsedSec - 0.11),
    `Zero lightning cracks occur before 20s elapsed (earliest=${crackCues[0]?.time?.toFixed(2)}s)`
  )

  for (let i = 1; i < crackCues.length; i += 1) {
    const gap = crackCues[i].time - crackCues[i - 1].time
    assert(
      gap >= THUNDER_AUDIO_CONFIG.crackCooldownMinSec - 0.25,
      `Lightning crack cooldown >= 48s respected (gap=${gap.toFixed(2)}s)`
    )
  }

  for (let i = 1; i < allThunderCues.length; i += 1) {
    const gap = allThunderCues[i].time - allThunderCues[i - 1].time
    assert(
      gap >= THUNDER_AUDIO_CONFIG.distantIntervalMinSec - 0.2 &&
        gap <= THUNDER_AUDIO_CONFIG.distantIntervalMaxSec + 6.5,
      `Thunder interval stays inside 16-36s cadence window (gap=${gap.toFixed(2)}s)`
    )
  }
  eng.dispose()
}

// Verify ZERO interference with ambient horror scheduler, _ambientRng(), or startAmbientBed()
{
  const runAmbientIsolationCheck = (thunderEnabled) => {
    const mock = createEnvelopeRecordingContext()
    let ambientRngCalls = 0
    const baseRng = makeDeterministicRng(9191)
    const eng = new HorrorAudioEngine({
      createAudioContext: () => mock.ctx,
      autoUnlock: true,
      rainEnabled: true,
      thunderEnabled,
      ambientRandom: () => {
        ambientRngCalls += 1
        return baseRng()
      },
      thunderRandom: makeDeterministicRng(4444),
      recordCueHistory: true,
    })
    eng.setMaze(mazeA)
    for (let i = 0; i < 1200; i += 1) {
      eng.update(0.1, { playerWorldPos: playerStartA })
    }
    const ambientCues = eng
      .getCueHistory()
      .filter((c) => c.type === 'ambient_horror')
      .map((c) => `${c.time.toFixed(3)}:${c.category}:${c.variant}`)
    const ambientState = eng.getAmbientHorrorState()
    const hasAmbientBed = Boolean(eng._ambientBed)
    eng.dispose()
    return { ambientRngCalls, ambientCues, ambientState, hasAmbientBed }
  }

  const withoutThunder = runAmbientIsolationCheck(false)
  const withThunder = runAmbientIsolationCheck(true)
  assert(
    withoutThunder.hasAmbientBed &&
      withThunder.hasAmbientBed &&
      withoutThunder.ambientRngCalls === withThunder.ambientRngCalls &&
      JSON.stringify(withoutThunder.ambientCues) === JSON.stringify(withThunder.ambientCues),
    'Thunder scheduler leaves _ambientRng call count, ambient horror cue timing/selection, and ambientBed untouched'
  )
}
console.log('✓ Thunder scheduling, cooldowns, non-overlap & complete ambient horror isolation verified')

// ---------------------------------------------------------------------------
// Test 4: Reduced Motion Crack Suppression & Mid-Crack Interruption
// ---------------------------------------------------------------------------
console.log('Test 4: Reduced Motion Crack Suppression & Softened Distant Thunder')
{
  const mockRM = createEnvelopeRecordingContext()
  let rngStep = 0
  const engRM = new HorrorAudioEngine({
    createAudioContext: () => mockRM.ctx,
    autoUnlock: true,
    thunderRandom: () => {
      rngStep += 1
      return 0.05 + ((rngStep % 4) * 0.04) // always < 0.38 so cracks would fire if allowed
    },
    ambientRandom: makeDeterministicRng(77),
    recordCueHistory: true,
  })
  engRM.setMaze(mazeA)

  for (let i = 0; i < 3000; i += 1) {
    engRM.update(0.1, { playerWorldPos: playerStartA, reducedMotion: true })
  }
  const rmCues = engRM.getCueHistory()
  const rmCracks = rmCues.filter((c) => c.type === 'thunder_crack')
  const rmDistant = rmCues.filter((c) => c.type === 'thunder_distant')
  assert(
    rmCracks.length === 0 && rmDistant.length >= 6,
    `reducedMotion suppresses ALL lightning cracks (${rmCracks.length}) while permitting softened distant thunder (${rmDistant.length})`
  )

  // Now trigger an active crack without reducedMotion, then toggle reducedMotion: true mid-crack
  engRM._thunderNextCrackAllowedAtSec = 0
  engRM._thunderEventTimer = 0.05
  engRM.update(0.1, { playerWorldPos: playerStartA, reducedMotion: false })
  assert(
    engRM.getThunderAudioState().activeCue?.kind === 'crack',
    'Lightning crack starts when reducedMotion is disabled'
  )
  engRM.update(0.05, { playerWorldPos: playerStartA, reducedMotion: true })
  assert(
    engRM.getThunderAudioState().activeCue === null &&
      engRM._pendingFadeCleanups.size >= 1,
    'Enabling reducedMotion mid-crack soft-fades and stops active crack cleanly'
  )
  await new Promise((resolve) => setTimeout(resolve, 130))
  assert(
    engRM._pendingFadeCleanups.size === 0,
    'Deferred soft-fade cleanup finishes cleanly after crack interruption'
  )
  engRM.dispose()
}
console.log('✓ ReducedMotion crack suppression and mid-crack fade verified')

// ---------------------------------------------------------------------------
// Test 5: Suppression (Chase/Attack, HorrorDirector, Blackout, Pause, Victory, GameOver) & Soft Fade
// ---------------------------------------------------------------------------
console.log('Test 5: Threat/Event Suppression & Soft-Fade Interruption Cleanup')
{
  const mockSup = createEnvelopeRecordingContext()
  const engSup = new HorrorAudioEngine({
    createAudioContext: () => mockSup.ctx,
    autoUnlock: true,
    thunderRandom: makeDeterministicRng(303),
    ambientRandom: makeDeterministicRng(304),
    thunderScheduler: {
      initialGraceMinSec: 0.4,
      initialGraceMaxSec: 0.4,
      distantIntervalMinSec: 0.8,
      distantIntervalMaxSec: 0.8,
      crackCooldownMinSec: 1.0,
      crackCooldownMaxSec: 1.0,
      minCrackElapsedSec: 1.5,
    },
    recordCueHistory: true,
  })
  engSup.setMaze(mazeA)

  const chasingEnemy = [
    {
      id: 'chaser',
      type: 'stalker',
      state: ENEMY_STATES.CHASE,
      worldPos: { x: playerStartA.x + 4, y: 0, z: playerStartA.z },
    },
  ]
  const attackingEnemy = [
    {
      id: 'attacker',
      type: 'stalker',
      state: ENEMY_STATES.ATTACK,
      worldPos: { x: playerStartA.x + 2, y: 0, z: playerStartA.z },
    },
  ]

  // Suppress during CHASE, ATTACK, HorrorDirector event, blackout
  for (let i = 0; i < 30; i += 1) {
    engSup.update(0.1, { playerWorldPos: playerStartA, enemies: chasingEnemy })
    engSup.update(0.1, { playerWorldPos: playerStartA, enemies: attackingEnemy })
    engSup.update(0.1, {
      playerWorldPos: playerStartA,
      activeHorrorEventType: HORROR_EVENT_TYPES.SCRIPTED_SCARE,
    })
    engSup.update(0.1, { playerWorldPos: playerStartA, lightScale: 0.2 })
  }
  assert(
    engSup.getCueHistory().filter((c) => c.type.startsWith('thunder_')).length === 0,
    'New thunder stays completely suppressed during CHASE, ATTACK, HorrorDirector events & blackout'
  )

  // Now clear suppression and wait until distant thunder becomes active
  let sawActive = false
  for (let i = 0; i < 60; i += 1) {
    engSup.update(0.1, { playerWorldPos: playerStartA })
    if (engSup.getThunderAudioState().activeCue) {
      sawActive = true
      break
    }
  }
  assert(sawActive, 'Thunder starts cleanly once threat/suppression clears')

  // Interrupt active thunder with CHASE: must soft-fade via setTargetAtTime(0, ...) and schedule disconnect
  const discBeforeFade = mockSup.stats.disconnectedCount
  engSup.update(0.05, { playerWorldPos: playerStartA, enemies: chasingEnemy })
  assert(
    engSup.getThunderAudioState().activeCue === null &&
      engSup._pendingFadeCleanups.size >= 1,
    'Active thunder cue immediately enters soft-fade cleanup when interrupted by enemy chase'
  )
  await new Promise((resolve) => setTimeout(resolve, 130))
  assert(
    engSup._pendingFadeCleanups.size === 0 &&
      mockSup.stats.disconnectedCount > discBeforeFade,
    'Soft-faded thunder nodes complete deferred disconnect cleanly'
  )

  // Test playHorrorDirectorCue triggers soft-fade of active thunder too
  for (let i = 0; i < 60; i += 1) {
    engSup.update(0.1, { playerWorldPos: playerStartA })
    if (engSup.getThunderAudioState().activeCue) break
  }
  assert(engSup.getThunderAudioState().activeCue !== null, 'Thunder active before HorrorDirector cue')
  engSup.playHorrorDirectorCue('scripted_scare', playerStartA)
  assert(
    engSup.getThunderAudioState().activeCue === null,
    'playHorrorDirectorCue soft-fades and clears active thunder cue'
  )

  await new Promise((resolve) => setTimeout(resolve, 130))
  engSup.dispose()
}
console.log('✓ Suppression & soft-fade interruption cleanup verified')

// ---------------------------------------------------------------------------
// Test 6: Rain + Thunder Coexistence, Buffer Reuse & Ducking Behavior
// ---------------------------------------------------------------------------
console.log('Test 6: Rain + Thunder Coexistence, Buffer Reuse & Crack Rain-Ducking')
{
  const mockRain = createEnvelopeRecordingContext()
  const engRain = new HorrorAudioEngine({
    createAudioContext: () => mockRain.ctx,
    autoUnlock: true,
    rainEnabled: true,
    thunderEnabled: true,
    thunderRandom: () => 0.1,
    ambientRandom: makeDeterministicRng(88),
    thunderScheduler: {
      initialGraceMinSec: 0.4,
      initialGraceMaxSec: 0.4,
      distantIntervalMinSec: 1.0,
      distantIntervalMaxSec: 1.0,
      crackCooldownMinSec: 10.0,
      crackCooldownMaxSec: 10.0,
      minCrackElapsedSec: 2.0,
      crackChanceWhenReady: 1.0,
    },
    recordCueHistory: true,
  })
  engRain.setMaze(mazeA)

  const rainStartBursts = mockRain.recordedBursts.length
  assert(
    rainStartBursts === 1 && engRain._rainNoiseBuffer !== null,
    'Rain bed initialized with 1 mono-safe looping source and shared _rainNoiseBuffer'
  )

  // Trigger distant thunder (< minCrackElapsedSec = 2.0s)
  for (let i = 0; i < 10; i += 1) {
    engRain.update(0.05, { playerWorldPos: playerStartA })
    if (engRain.getThunderAudioState().activeCue) break
  }
  const distantState = engRain.getAudioState()
  assert(
    distantState.thunder.activeCue?.kind === 'distant' &&
      distantState.thunder.duckingRain === false &&
      distantState.rain.active === true &&
      distantState.rain.ducked === false &&
      Math.abs(distantState.rain.targetGain - THUNDERSTORM_RAIN_CONSTANTS.normalGain) < 1e-6,
    'Distant thunder plays alongside full-level rain without unnecessarily ducking rain'
  )

  // Verify thunder reused engRain._rainNoiseBuffer
  const distantBursts = mockRain.recordedBursts.slice(rainStartBursts)
  assert(
    distantBursts.length === 3 &&
      distantBursts.every((b) => b.src.buffer === engRain._rainNoiseBuffer),
    'Thunder reuses engine._rainNoiseBuffer without allocating extra noise buffers'
  )

  // Advance past distant thunder & minCrackElapsedSec until lightning crack fires
  let crackSeen = false
  for (let i = 0; i < 160; i += 1) {
    engRain.update(0.05, { playerWorldPos: playerStartA })
    if (engRain.getThunderAudioState().activeCue?.kind === 'crack') {
      crackSeen = true
      break
    }
  }
  assert(crackSeen, 'Lightning crack triggered cleanly alongside active rain bed')
  const crackState = engRain.getAudioState()
  assert(
    crackState.thunder.duckingRain === true &&
      crackState.rain.active === true &&
      crackState.rain.ducked === true &&
      Math.abs(crackState.rain.targetGain - THUNDERSTORM_RAIN_CONSTANTS.duckedGain) < 1e-6,
    `Active lightning crack ducks rain bed to duckedGain (${THUNDERSTORM_RAIN_CONSTANTS.duckedGain})`
  )

  // Advance past rainDuckHoldSec (2.6s) and verify rain recovers cleanly
  for (let i = 0; i < 60; i += 1) {
    engRain.update(0.05, { playerWorldPos: playerStartA })
  }
  const recoveredState = engRain.getAudioState()
  assert(
    recoveredState.thunder.duckingRain === false &&
      recoveredState.rain.ducked === false &&
      Math.abs(recoveredState.rain.targetGain - THUNDERSTORM_RAIN_CONSTANTS.normalGain) < 1e-6,
    'Rain recovers smoothly back to normalGain after intense crack duck window expires'
  )

  // Combined gain margin sanity: worst-case crack (0.30) + ducked rain (<= 0.038) << 1.0
  assert(
    THUNDER_AUDIO_CONSTANTS.crackMaxTransientGain + THUNDERSTORM_RAIN_CONSTANTS.duckedGain < 0.35 &&
      THUNDER_AUDIO_CONSTANTS.distantMaxCombinedGain + THUNDERSTORM_RAIN_CONSTANTS.normalGain < 0.36,
    'Combined rain + thunder gain maintains huge headroom well below 1.0'
  )

  engRain.dispose()
}

// Verify thunder still works cleanly when rainEnabled: false
{
  const mockNoRain = createEnvelopeRecordingContext()
  const engNoRain = new HorrorAudioEngine({
    createAudioContext: () => mockNoRain.ctx,
    autoUnlock: true,
    rainEnabled: false,
    thunderEnabled: true,
    thunderScheduler: {
      initialGraceMinSec: 0.2,
      initialGraceMaxSec: 0.2,
      distantIntervalMinSec: 1.0,
      distantIntervalMaxSec: 1.0,
      minCrackElapsedSec: 10.0,
    },
    recordCueHistory: true,
  })
  engNoRain.setMaze(mazeA)
  for (let i = 0; i < 10; i += 1) {
    engNoRain.update(0.05, { playerWorldPos: playerStartA })
  }
  assert(
    engNoRain.getAudioState().rain.active === false &&
      engNoRain.getCueHistory().some((c) => c.type === 'thunder_distant'),
    'Thunder triggers cleanly even when rainEnabled is false'
  )
  engNoRain.dispose()
}
console.log('✓ Rain + thunder coexistence, buffer reuse & crack ducking verified')

// ---------------------------------------------------------------------------
// Test 7: Exclusive ambienceGain Routing, Volume/Mute Gating & Zero-Allocation Idle Frames
// ---------------------------------------------------------------------------
console.log('Test 7: Exclusive ambienceGain Bus Routing, Mute/Zero-Volume & Zero Per-Frame Allocations')
{
  const mockBus = createEnvelopeRecordingContext()
  const engBus = new HorrorAudioEngine({
    createAudioContext: () => mockBus.ctx,
    autoUnlock: true,
    rainEnabled: false,
    thunderEnabled: true,
    thunderRandom: makeDeterministicRng(12),
    ambientRandom: makeDeterministicRng(13),
    thunderScheduler: {
      initialGraceMinSec: 0.3,
      initialGraceMaxSec: 0.3,
      distantIntervalMinSec: 0.8,
      distantIntervalMaxSec: 0.8,
      minCrackElapsedSec: 0.2,
      crackChanceWhenReady: 0.5,
    },
    recordCueHistory: true,
  })
  engBus.setMaze(mazeA)

  // Check zero per-frame allocations during idle frames before initial grace
  const allocSnapshot = { ...mockBus.stats }
  for (let i = 0; i < 4; i += 1) {
    engBus.update(0.05, { playerWorldPos: playerStartA })
  }
  assert(
    mockBus.stats.gainsCreated === allocSnapshot.gainsCreated &&
      mockBus.stats.filtersCreated === allocSnapshot.filtersCreated &&
      mockBus.stats.bufferSourcesStarted === allocSnapshot.bufferSourcesStarted &&
      mockBus.stats.oscillatorsCreated === allocSnapshot.oscillatorsCreated,
    'Zero per-frame audio node allocations during idle thunder scheduler frames'
  )

  // Check exclusive routing to ambienceGain when thunder triggers
  const connBeforeThunder = mockBus.stats.connections.length
  for (let i = 0; i < 5; i += 1) {
    engBus.update(0.05, { playerWorldPos: playerStartA })
  }
  const thunderConns = mockBus.stats.connections.slice(connBeforeThunder)
  assert(
    thunderConns.some((c) => c.to === engBus.ambienceGain) &&
      !thunderConns.some(
        (c) =>
          c.to === engBus.effectsGain ||
          c.to === engBus.musicGain ||
          c.to === engBus._reverbInput ||
          c.to === engBus._ambientReverbInput
      ),
    'Thunder routes exclusively to ambienceGain (never effectsGain, musicGain, or reverb buses)'
  )

  // Verify mute / master=0 / ambience=0 spawn zero thunder BufferSources
  while (engBus.getThunderAudioState().activeCue) {
    engBus.update(0.2, { playerWorldPos: playerStartA })
  }
  for (const mode of ['muted', 'masterZero', 'ambienceZero']) {
    engBus.setVolumes({ master: 0.8, ambience: 0.8, effects: 0.8, music: 0.5, muted: false })
    if (mode === 'muted') engBus.setVolumes({ muted: true })
    if (mode === 'masterZero') engBus.setVolumes({ master: 0 })
    if (mode === 'ambienceZero') engBus.setVolumes({ ambience: 0 })

    engBus._thunderEventTimer = 0.05
    const burstsBefore = mockBus.stats.bufferSourcesStarted
    engBus.update(0.1, { playerWorldPos: playerStartA })
    assert(
      mockBus.stats.bufferSourcesStarted === burstsBefore &&
        engBus.getThunderAudioState().activeCue === null,
      `Zero thunder buffer sources created when ${mode}`
    )
  }
  engBus.dispose()
}
console.log('✓ Exclusive ambienceGain routing, mute/volume gating & zero per-frame allocations verified')

// ---------------------------------------------------------------------------
// Test 8: Full Lifecycle Cleanup (Pause/Resume Delay, Reset, Maze Switch, Victory, Game Over, Dispose)
// ---------------------------------------------------------------------------
console.log('Test 8: Full Lifecycle Cleanup & No Duplicate Schedulers')
{
  const mockLife = createEnvelopeRecordingContext()
  const engLife = new HorrorAudioEngine({
    createAudioContext: () => mockLife.ctx,
    autoUnlock: true,
    rainEnabled: true,
    thunderEnabled: true,
    thunderRandom: makeDeterministicRng(606),
    ambientRandom: makeDeterministicRng(607),
    thunderScheduler: {
      initialGraceMinSec: 0.3,
      initialGraceMaxSec: 0.3,
      distantIntervalMinSec: 0.8,
      distantIntervalMaxSec: 0.8,
      minResumeDelaySec: 2.5,
    },
    recordCueHistory: true,
  })
  engLife.setMaze(mazeA)

  const triggerActiveThunder = () => {
    for (let i = 0; i < 40; i += 1) {
      engLife.update(0.1, { playerWorldPos: playerStartA })
      if (engLife.getThunderAudioState().activeCue) return true
    }
    return false
  }

  // Pause & resume delay
  assert(triggerActiveThunder(), 'Thunder activates before pause test')
  engLife.setPaused(true)
  assert(
    engLife.getThunderAudioState().activeCue === null,
    'setPaused(true) stops active thunder cue'
  )
  engLife.setPaused(false)
  assert(
    engLife.getThunderAudioState().nextEventInSec >= 2.5,
    `Resume enforces >= 2.5s delay preventing thunder bursts (got ${engLife.getThunderAudioState().nextEventInSec.toFixed(2)}s)`
  )
  for (let i = 0; i < 20; i += 1) {
    engLife.update(0.05, { playerWorldPos: playerStartA })
  }
  assert(
    engLife.getThunderAudioState().activeCue === null,
    'No queued thunder burst fires during first 1s after resume'
  )

  // Maze switch
  engLife._thunderEventTimer = 0.05
  assert(triggerActiveThunder(), 'Thunder activates before maze switch')
  engLife.setMaze(mazeB)
  assert(
    engLife.getThunderAudioState().activeCue === null &&
      engLife.getThunderAudioState().lastKind === null &&
      engLife.getThunderAudioState().clockSec === 0,
    'setMaze() cancels active thunder and resets thunder scheduler'
  )

  // Reset
  engLife._thunderEventTimer = 0.05
  assert(triggerActiveThunder(), 'Thunder activates before reset()')
  engLife.reset()
  assert(
    engLife.getThunderAudioState().activeCue === null &&
      engLife.getThunderAudioState().lastKind === null &&
      engLife.getThunderAudioState().clockSec === 0,
    'reset() cancels active thunder and resets thunder scheduler'
  )

  // Victory (onExitVictory & setHasWon)
  engLife._thunderEventTimer = 0.05
  assert(triggerActiveThunder(), 'Thunder activates before onExitVictory()')
  engLife.onExitVictory()
  assert(engLife.getThunderAudioState().activeCue === null, 'onExitVictory() clears active thunder')
  const countAtVictory = engLife.getCueHistory().filter((c) => c.type.startsWith('thunder_')).length
  for (let i = 0; i < 30; i += 1) {
    engLife.update(0.1, { playerWorldPos: playerStartA })
  }
  assert(
    engLife.getCueHistory().filter((c) => c.type.startsWith('thunder_')).length === countAtVictory,
    'No thunder fires after onExitVictory()'
  )

  engLife.reset()
  engLife._thunderEventTimer = 0.05
  assert(triggerActiveThunder(), 'Thunder activates before setHasWon(true)')
  engLife.setHasWon(true)
  assert(engLife.getThunderAudioState().activeCue === null, 'setHasWon(true) clears active thunder')

  // Game Over
  engLife.reset()
  engLife._thunderEventTimer = 0.05
  assert(triggerActiveThunder(), 'Thunder activates before onGameOver()')
  engLife.onGameOver()
  assert(engLife.getThunderAudioState().activeCue === null, 'onGameOver() clears active thunder')
  const countAtGameOver = engLife.getCueHistory().filter((c) => c.type.startsWith('thunder_')).length
  for (let i = 0; i < 30; i += 1) {
    engLife.update(0.1, { playerWorldPos: playerStartA })
  }
  assert(
    engLife.getCueHistory().filter((c) => c.type.startsWith('thunder_')).length === countAtGameOver,
    'No thunder fires after onGameOver()'
  )

  // Dispose
  engLife.reset()
  engLife._thunderEventTimer = 0.05
  assert(triggerActiveThunder(), 'Thunder activates before dispose()')
  const stoppedBeforeDispose = mockLife.stats.bufferSourcesStopped
  engLife.dispose()
  assert(
    engLife.isDisposed === true &&
      engLife.getThunderAudioState().activeCue === null &&
      mockLife.stats.bufferSourcesStopped > stoppedBeforeDispose,
    'dispose() immediately stops/cleans active thunder nodes'
  )
}
console.log('✓ Full lifecycle cleanup (pause, resume delay, maze switch, reset, victory, gameOver, dispose) verified')

// ---------------------------------------------------------------------------
// Test 9: Phase 3 Thunderstorm Integration & Refinement (Anti-Pumping, Anti-Collision & MazeSceneEngine)
// ---------------------------------------------------------------------------
console.log('Test 9: Phase 3 Rain Recovery Asymmetry, Crack Anti-Collision, Fade Flush & MazeSceneEngine')

// 9a. Asymmetrical rain duck/recovery tau (0.16s duck-in vs 0.48s slow recovery) + seamless director transition
{
  const mockP3 = createEnvelopeRecordingContext()
  const engP3 = new HorrorAudioEngine({
    createAudioContext: () => mockP3.ctx,
    autoUnlock: true,
    rainEnabled: true,
    thunderEnabled: true,
    thunderRandom: () => 0.1,
    ambientRandom: makeDeterministicRng(909),
    thunderScheduler: {
      initialGraceMinSec: 0.2,
      initialGraceMaxSec: 0.2,
      distantIntervalMinSec: 0.8,
      distantIntervalMaxSec: 0.8,
      minCrackElapsedSec: 0.1,
      crackCooldownMinSec: 0.2,
      crackCooldownMaxSec: 0.2,
      crackChanceWhenReady: 1.0,
    },
    recordCueHistory: true,
  })
  engP3.setMaze(mazeA)

  const setContextCalls = []
  const origSetContext = engP3._thunderstormRainBed.setContext.bind(engP3._thunderstormRainBed)
  engP3._thunderstormRainBed.setContext = (payload, tau) => {
    setContextCalls.push({ ducked: payload.ducked, hidden: payload.hidden, tau })
    origSetContext(payload, tau)
  }

  // Trigger lightning crack -> duck-in uses quick smooth tau (0.16)
  for (let i = 0; i < 10; i += 1) {
    engP3.update(0.05, { playerWorldPos: playerStartA })
    if (engP3.getThunderAudioState().activeCue?.kind === 'crack') break
  }
  const duckEnter = setContextCalls.find((c) => c.ducked === true)
  assert(
    duckEnter && duckEnter.tau <= 0.2,
    `Rain enters ducking smoothly (tau=${duckEnter?.tau})`
  )

  // Interrupt mid-crack with HorrorDirector cue: rain stays ducked seamlessly without pumping up/down
  const callsBeforeDirector = setContextCalls.length
  engP3.playHorrorDirectorCue('presence_warning', playerStartA, { tension: 0.7 })
  engP3.update(0.05, { playerWorldPos: playerStartA })
  assert(
    engP3.getAudioState().rain.ducked === true &&
      setContextCalls.slice(callsBeforeDirector).every((c) => c.ducked === true),
    'Rain remains ducked seamlessly across crack -> HorrorDirector cue transition without pumping'
  )

  // Clear horror busy grace window -> rain recovery uses slower non-pumping release tau (>= 0.45)
  for (let i = 0; i < 60; i += 1) {
    engP3.update(0.05, { playerWorldPos: playerStartA, enemies: [] })
    if (!engP3.getAudioState().rain.ducked) break
  }
  const duckExit = setContextCalls[setContextCalls.length - 1]
  assert(
    duckExit && duckExit.ducked === false && duckExit.tau >= 0.45,
    `Rain recovers gradually without pumping (release tau=${duckExit?.tau})`
  )

  // Verify startling ambient cue / recent light sputter prevents simultaneous lightning crack double-slam
  while (engP3.getThunderAudioState().activeCue) {
    engP3.update(0.2, { playerWorldPos: playerStartA })
  }
  engP3.clearCueHistory()
  engP3._thunderClockSec = 30.0
  engP3._thunderNextCrackAllowedAtSec = 0
  engP3._thunderEventTimer = 0.05
  engP3._activeAmbientCue = {
    category: 'creak_knock',
    variant: 2,
    isStartling: true,
    remainingSec: 2.0,
    stop: () => {},
  }
  engP3.update(0.1, { playerWorldPos: playerStartA })
  const latestCue = engP3.getCueHistory().filter((c) => c.type.startsWith('thunder_')).pop()
  assert(
    latestCue?.type === 'thunder_distant',
    'Startling ambient cue downgrades simultaneous crack to distant thunder instead of double-slamming'
  )

  // Verify pending soft-fade flush on onGameOver/onExitVictory without disturbing unrelated positional cues
  engP3.playHorrorDirectorCue('environmental_sound', { x: playerStartA.x + 4, y: 0, z: playerStartA.z })
  const posCountBeforeEnd = engP3._activePositionalCleanups.size
  engP3.update(0.05, {
    playerWorldPos: playerStartA,
    enemies: [{ id: 'c1', type: 'stalker', state: ENEMY_STATES.CHASE, worldPos: playerStartA }],
  })
  assert(engP3._pendingFadeCleanups.size >= 1, 'Pending fade exists after chase interrupts thunder')
  engP3.onExitVictory()
  assert(
    engP3._pendingFadeCleanups.size === 0 && engP3._activePositionalCleanups.size === posCountBeforeEnd,
    'onExitVictory() flushes fading thunder nodes immediately while preserving unrelated positional cues'
  )

  engP3.dispose()
}

// 9b. Full MazeSceneEngine coexistence (rain, thunder, ceiling lights, chase, reducedMotion, pause, dispose)
{
  const mockScene = createEnvelopeRecordingContext()
  const host = { appendChild: () => {}, removeChild: () => {}, clientWidth: 640, clientHeight: 480 }
  const renderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  const sceneEngine = new MazeSceneEngine(host, {
    createRenderer: () => renderer,
    enemies: { autoSpawn: false },
    horrorDirector: { intensity: HORROR_INTENSITY_LEVELS.OFF },
    audio: {
      createAudioContext: () => mockScene.ctx,
      thunderRandom: makeDeterministicRng(2027),
      ambientRandom: makeDeterministicRng(2028),
      thunderScheduler: {
        initialGraceMinSec: 0.5,
        initialGraceMaxSec: 0.5,
        distantIntervalMinSec: 1.0,
        distantIntervalMaxSec: 1.0,
        minCrackElapsedSec: 1.5,
        crackCooldownMinSec: 2.0,
        crackCooldownMaxSec: 2.0,
        crackChanceWhenReady: 0.5,
      },
      recordCueHistory: true,
    },
  })
  sceneEngine.setMaze(mazeA)
  sceneEngine.unlockAudio()
  const ae = sceneEngine.getAudioEngine()
  for (let i = 0; i < 80; i += 1) {
    sceneEngine.stepFrame(0.05, { render: false })
  }
  const state = ae.getAudioState()
  assert(
    state.rain.active === true &&
      ae.getCueHistory().some((c) => c.type.startsWith('thunder_')),
    'MazeSceneEngine runs rain bed and thunder cues cleanly alongside ceiling lights and ambient bed'
  )
  sceneEngine.setPaused(true)
  assert(ae.getAudioState().rain.paused === true && ae.getAudioState().thunder.activeCue === null)
  sceneEngine.setPaused(false)
  assert(ae.getAudioState().rain.paused === false && ae.getAudioState().thunder.nextEventInSec >= 2.5)
  sceneEngine.dispose()
  assert(ae.isDisposed === true && ae.getAudioState().rain.active === false)
}
console.log('✓ Phase 3 asymmetric rain recovery, anti-collision, fade flush & MazeSceneEngine integration verified')

// ---------------------------------------------------------------------------
// Test 10: Real-World Playback Refinement (Acoustic Balance, Non-Masking, Mono & Crack Reliability)
// ---------------------------------------------------------------------------
console.log('Test 10: Real-World Acoustic Balance (RBJ Biquad + A-Weighting), Mono Safety & Crack Reliability')
{
  function makeDspContext(sampleRate = 48000) {
    const base = createEnvelopeRecordingContext()
    base.ctx.sampleRate = sampleRate
    const recordedOscs = []
    const origOsc = base.ctx.createOscillator
    base.ctx.createOscillator = () => {
      const osc = origOsc()
      const origStart = osc.start
      const origStop = osc.stop
      const entry = { osc, startAt: 0, stopAt: null }
      osc.start = (when = 0) => {
        entry.startAt = when
        origStart.call(osc, when)
      }
      osc.stop = (when = 0) => {
        entry.stopAt = when
        origStop.call(osc, when)
      }
      recordedOscs.push(entry)
      return osc
    }
    return { ...base, recordedOscs, sampleRate }
  }

  function evalBiquadCoeffs(type, freqHz, qVal, sampleRate) {
    const f0 = Math.max(20, Math.min(sampleRate * 0.45, freqHz))
    const q = Math.max(0.1, qVal || 0.707)
    const w0 = (2 * Math.PI * f0) / sampleRate
    const cosW = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * q)
    let b0 = 1
    let b1 = 0
    let b2 = 0
    let a0 = 1
    let a1 = 0
    let a2 = 0
    if (type === 'lowpass') {
      b0 = (1 - cosW) * 0.5
      b1 = 1 - cosW
      b2 = (1 - cosW) * 0.5
      a0 = 1 + alpha
      a1 = -2 * cosW
      a2 = 1 - alpha
    } else if (type === 'highpass') {
      b0 = (1 + cosW) * 0.5
      b1 = -(1 + cosW)
      b2 = (1 + cosW) * 0.5
      a0 = 1 + alpha
      a1 = -2 * cosW
      a2 = 1 - alpha
    } else if (type === 'bandpass') {
      b0 = alpha
      b1 = 0
      b2 = -alpha
      a0 = 1 + alpha
      a1 = -2 * cosW
      a2 = 1 - alpha
    }
    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0,
    }
  }

  function evalParamAt(param, t, defaultStartTime) {
    if (!param?.events?.length) return param?.value ?? 1
    const events = param.events
    let curVal = events[0].value
    let curTime = defaultStartTime
    for (let i = 1; i < events.length; i += 1) {
      const ev = events[i]
      if (ev.type === 'setValue') {
        if (t < ev.time - 1e-9) return curVal
        curVal = ev.value
        curTime = ev.time
      } else if (ev.type === 'linearRamp') {
        if (t <= ev.time) {
          const span = Math.max(1e-9, ev.time - curTime)
          const frac = Math.max(0, Math.min(1, (t - curTime) / span))
          return curVal + (ev.value - curVal) * frac
        }
        curVal = ev.value
        curTime = ev.time
      } else if (ev.type === 'expRamp') {
        if (t <= ev.time) {
          const span = Math.max(1e-9, ev.time - curTime)
          const frac = Math.max(0, Math.min(1, (t - curTime) / span))
          const a = Math.max(1e-6, curVal)
          const b = Math.max(1e-6, ev.value)
          return a * Math.pow(b / a, frac)
        }
        curVal = ev.value
        curTime = ev.time
      } else if (ev.type === 'setTarget') {
        if (t >= ev.time) {
          const tau = Math.max(1e-4, ev.tau || 0.03)
          curVal = ev.value + (curVal - ev.value) * Math.exp(-(t - ev.time) / tau)
          curTime = t
        }
      }
    }
    return curVal
  }

  function traceChainFrom(node, connections) {
    const filters = []
    const gains = []
    const visited = new Set()
    let cursor = node
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor)
      const edge = connections.find((c) => c.from === cursor)
      if (!edge) break
      const next = edge.to
      if (next._kind === 'filter') filters.push(next)
      if (next._kind === 'gain') gains.push(next)
      cursor = next
    }
    return { filters, gains }
  }

  function renderDspBuffer(dsp, destBusGain, totalSec) {
    const sr = dsp.sampleRate
    const nSamples = Math.ceil(totalSec * sr)
    const out = new Float32Array(nSamples)
    const t0 = dsp.ctx.currentTime

    for (const burst of dsp.recordedBursts) {
      const bufData = burst.src.buffer?.getChannelData(0)
      if (!bufData || bufData.length === 0) continue
      const { filters, gains } = traceChainFrom(burst.src, dsp.stats.connections)
      const startSample = Math.max(0, Math.ceil((burst.startAt - t0) * sr - 1e-6))
      const stopTime = burst.stopAt != null ? burst.stopAt : burst.startAt + (burst.duration || totalSec)
      const endSample = Math.min(nSamples, Math.ceil((stopTime - t0) * sr))
      const offsetSamples = Math.floor((burst.offset || 0) * sr) % bufData.length
      const fStates = filters.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0, coeffs: null }))

      for (let i = startSample; i < endSample; i += 1) {
        const t = Math.max(burst.startAt, t0 + i / sr)
        const rel = i - startSample
        const rawIdx = (offsetSamples + rel) % bufData.length
        let x = bufData[rawIdx]

        for (let fi = 0; fi < filters.length; fi += 1) {
          const f = filters[fi]
          const st = fStates[fi]
          if (rel % 16 === 0 || !st.coeffs) {
            const freq = evalParamAt(f.frequency, t, burst.startAt)
            st.coeffs = evalBiquadCoeffs(f.type, freq, f.Q.value, sr)
          }
          const c = st.coeffs
          const y = c.b0 * x + c.b1 * st.x1 + c.b2 * st.x2 - c.a1 * st.y1 - c.a2 * st.y2
          st.x2 = st.x1
          st.x1 = x
          st.y2 = st.y1
          st.y1 = y
          x = y
        }

        let g = destBusGain
        for (const gn of gains) {
          if (gn.gain) {
            const hasSetTarget = gn.gain.events.some((e) => e.type === 'setTarget')
            g *= hasSetTarget
              ? evalParamAt(gn.gain, t, burst.startAt)
              : evalGainEventsAt(gn.gain.events, t, burst.startAt, stopTime)
          }
        }
        out[i] += x * g
      }
    }

    for (const oscEntry of dsp.recordedOscs) {
      const { osc } = oscEntry
      const { filters, gains } = traceChainFrom(osc, dsp.stats.connections)
      const startSample = Math.max(0, Math.floor((oscEntry.startAt - t0) * sr))
      const stopTime = oscEntry.stopAt ?? t0 + totalSec
      const endSample = Math.min(nSamples, Math.ceil((stopTime - t0) * sr))
      const fStates = filters.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0, coeffs: null }))
      let phase = 0
      for (let i = startSample; i < endSample; i += 1) {
        const t = t0 + i / sr
        const freq = evalParamAt(osc.frequency, t, oscEntry.startAt)
        phase += (2 * Math.PI * freq) / sr
        let x = Math.sin(phase)
        if (osc.type === 'triangle') {
          x = (2 / Math.PI) * Math.asin(Math.sin(phase))
        }
        for (let fi = 0; fi < filters.length; fi += 1) {
          const f = filters[fi]
          const st = fStates[fi]
          if ((i - startSample) % 16 === 0 || !st.coeffs) {
            st.coeffs = evalBiquadCoeffs(f.type, evalParamAt(f.frequency, t, oscEntry.startAt), f.Q.value, sr)
          }
          const c = st.coeffs
          const y = c.b0 * x + c.b1 * st.x1 + c.b2 * st.x2 - c.a1 * st.y1 - c.a2 * st.y2
          st.x2 = st.x1
          st.x1 = x
          st.y2 = st.y1
          st.y1 = y
          x = y
        }
        let g = destBusGain
        for (const gn of gains) {
          if (gn.gain) {
            g *= evalGainEventsAt(gn.gain.events, t, oscEntry.startAt, stopTime)
          }
        }
        out[i] += x * g
      }
    }
    return out
  }

  function aWeightDb(freqHz) {
    const f2 = freqHz * freqHz
    const num = 12194 * 12194 * f2 * f2
    const den =
      (f2 + 20.6 * 20.6) *
      Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
      (f2 + 12194 * 12194)
    return 20 * Math.log10(num / Math.max(1e-20, den)) + 2.0
  }

  function analyzeSignal(samples, sampleRate, windowStartSec = 0, windowEndSec = samples.length / sampleRate) {
    const start = Math.max(0, Math.floor(windowStartSec * sampleRate))
    const end = Math.min(samples.length, Math.floor(windowEndSec * sampleRate))
    let peak = 0
    let sumSq = 0
    for (let i = start; i < end; i += 1) {
      const s = samples[i]
      if (Math.abs(s) > peak) peak = Math.abs(s)
      sumSq += s * s
    }
    const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / Math.max(1, end - start)) + 1e-9)

    // Measure 50ms sliding peak A-weighted loudness & HF ratio via Goertzel bank across speech/earbud bands
    const probeFreqs = [80, 140, 220, 350, 550, 850, 1300, 2000, 3200]
    const winLen = Math.min(end - start, Math.floor(sampleRate * 0.05))
    let bestRmsA = 0
    let hfSum = 0
    let bodySum = 0
    for (let offset = start; offset + winLen <= end; offset += Math.max(1, Math.floor(winLen / 2))) {
      let winEnergy = 0
      for (let i = offset; i < offset + winLen; i += 1) {
        winEnergy += samples[i] * samples[i]
      }
      // Compute band energy decomposition
      let bandWeights = 0
      let weightedSum = 0
      for (const freq of probeFreqs) {
        const w = (2 * Math.PI * freq) / sampleRate
        const coeff = 2 * Math.cos(w)
        let q1 = 0
        let q2 = 0
        for (let i = offset; i < offset + winLen; i += 1) {
          const q0 = coeff * q1 - q2 + samples[i]
          q2 = q1
          q1 = q0
        }
        const power = Math.max(0, q1 * q1 + q2 * q2 - q1 * q2 * coeff) / (winLen * winLen)
        const linWeightA = Math.pow(10, aWeightDb(freq) / 10)
        weightedSum += power * linWeightA
        bandWeights += power
        if (freq >= 1200) hfSum += power
        else bodySum += power
      }
      const rmsWin = Math.sqrt(winEnergy / Math.max(1, winLen))
      const aRatio = bandWeights > 1e-18 ? Math.sqrt(weightedSum / bandWeights) : 1
      const effA = rmsWin * aRatio
      if (effA > bestRmsA) bestRmsA = effA
    }
    const max50msDbA = 20 * Math.log10(bestRmsA + 1e-9)
    return {
      peak,
      rmsDb,
      max50msDbA,
      hfRatioDb: 10 * Math.log10((hfSum + 1e-18) / (bodySum + 1e-18)),
    }
  }

  const ambienceBusGain = 0.85 * 0.55
  const effectsBusGain = 0.85 * 0.85

  // 10a. Render & measure underground rain bed vs player footsteps
  const dspRain = makeDspContext(48000)
  dspRain.ctx.currentTime = 0
  const rainBuf = createRainNoiseBuffer(dspRain.ctx, THUNDERSTORM_RAIN_CONSTANTS.bufferDurationSec)
  const rainDest = dspRain.ctx.createGain()
  const rainHandle = startThunderstormRainBed(dspRain.ctx, rainDest, rainBuf)
  const rainPcm = renderDspBuffer(dspRain, ambienceBusGain, 3.0)
  const rainStats = analyzeSignal(rainPcm, 48000, 1.5, 3.0)
  rainHandle.stop({ immediate: true })

  const dspStep = makeDspContext(48000)
  dspStep.ctx.currentTime = 0
  const stepBuf = createNoiseBuffer(dspStep.ctx, 2.0)
  const stepDest = dspStep.ctx.createGain()
  triggerPlayerFootstep(dspStep.ctx, stepDest, stepBuf, false)
  const stepPcm = renderDspBuffer(dspStep, effectsBusGain, 0.25)
  const stepStats = analyzeSignal(stepPcm, 48000, 0, 0.12)

  assert(
    rainStats.max50msDbA <= -62 &&
      stepStats.max50msDbA - rainStats.max50msDbA >= 8 &&
      rainStats.hfRatioDb < -12,
    `Enclosed underground rain stays subtle & muffled vs footsteps (rain=${rainStats.max50msDbA.toFixed(1)} dBA, step=${stepStats.max50msDbA.toFixed(1)} dBA, hfRatio=${rainStats.hfRatioDb.toFixed(1)} dB)`
  )

  // 10b. Verify distant thunder variants stand clearly above muffled rain with safe peak < 0.25
  for (let variant = 0; variant < 4; variant += 1) {
    const dspDist = makeDspContext(48000)
    dspDist.ctx.currentTime = 0
    const dest = dspDist.ctx.createGain()
    const h = triggerDistantThunderCue(dspDist.ctx, dest, rainBuf, {
      variant,
      random: makeDeterministicRng(500 + variant * 11),
    })
    const pcm = renderDspBuffer(dspDist, ambienceBusGain, h.durationSec + 0.1)
    const st = analyzeSignal(pcm, 48000, 0, h.durationSec)
    h.stop({ immediate: true })
    assert(
      st.peak < 0.25 && st.max50msDbA - rainStats.max50msDbA >= 10,
      `Distant thunder variant ${variant} clears rain bed comfortably (thunder=${st.max50msDbA.toFixed(1)} dBA, rain=${rainStats.max50msDbA.toFixed(1)} dBA, peak=${st.peak.toFixed(4)})`
    )
  }

  // 10c. Verify lightning crack variants punch decisively through earbuds with non-clipping headroom
  for (let variant = 0; variant < 3; variant += 1) {
    const dspCrack = makeDspContext(48000)
    dspCrack.ctx.currentTime = 0
    const dest = dspCrack.ctx.createGain()
    const h = triggerLightningCrackCue(dspCrack.ctx, dest, rainBuf, {
      variant,
      random: makeDeterministicRng(800 + variant * 17),
    })
    const pcm = renderDspBuffer(dspCrack, ambienceBusGain, h.durationSec + 0.1)
    const transientStats = analyzeSignal(pcm, 48000, 0, 0.12)
    const tailStats = analyzeSignal(pcm, 48000, 0.4, 2.6)
    h.stop({ immediate: true })
    assert(
      transientStats.peak < 0.25 &&
        transientStats.max50msDbA - rainStats.max50msDbA >= 16 &&
        tailStats.max50msDbA - rainStats.max50msDbA >= 8,
      `Lightning crack variant ${variant} transient & tail cut cleanly above muffled rain (crack=${transientStats.max50msDbA.toFixed(1)} dBA, tail=${tailStats.max50msDbA.toFixed(1)} dBA, peak=${transientStats.peak.toFixed(4)})`
    )
  }

  // 10d. Verify default MazeSceneEngine configuration reliably delivers distant thunder AND lightning cracks
  let totalCracksAcrossSeeds = 0
  let seedsWithCrack = 0
  const sceneSeeds = [101, 202, 303, 404, 505, 606]
  for (const seed of sceneSeeds) {
    const mockDef = createEnvelopeRecordingContext()
    const host = { appendChild: () => {}, removeChild: () => {}, clientWidth: 640, clientHeight: 480 }
    const renderer = {
      domElement: { style: {} },
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 1,
      setPixelRatio: () => {},
      setSize: () => {},
      render: () => {},
      dispose: () => {},
      getContext: () => null,
    }
    const mazeSeed = generateMaze({ difficulty: 'medium', seed })
    const sceneEng = new MazeSceneEngine(host, {
      createRenderer: () => renderer,
      enemies: { autoSpawn: false },
      horrorDirector: { intensity: HORROR_INTENSITY_LEVELS.MEDIUM },
      audio: {
        createAudioContext: () => mockDef.ctx,
        thunderRandom: makeDeterministicRng(seed * 31),
        ambientRandom: makeDeterministicRng(seed * 17),
        recordCueHistory: true,
      },
    })
    sceneEng.setMaze(mazeSeed)
    sceneEng.unlockAudio()
    const ae = sceneEng.getAudioEngine()
    const thunderCues = []
    const origRec = ae._recordCue.bind(ae)
    ae._recordCue = (type, meta) => {
      if (type === 'thunder_distant' || type === 'thunder_crack') {
        thunderCues.push({ type, time: ae._elapsedSec, ...meta })
      }
      origRec(type, meta)
    }
    for (let i = 0; i < 1200; i += 1) {
      sceneEng.stepFrame(0.1, { render: false })
    }
    const cracks = thunderCues.filter((c) => c.type === 'thunder_crack')
    const distant = thunderCues.filter((c) => c.type === 'thunder_distant')
    assert(distant.length >= 1, `Default MazeSceneEngine seed ${seed} fires distant thunder`)
    assert(
      cracks.every((c) => c.time >= THUNDER_AUDIO_CONFIG.minCrackElapsedSec - 0.11),
      `Default MazeSceneEngine seed ${seed} never triggers crack before 20s`
    )
    if (cracks.length > 0) {
      seedsWithCrack += 1
      totalCracksAcrossSeeds += cracks.length
    }
    sceneEng.dispose()
  }
  assert(
    seedsWithCrack >= 4 && totalCracksAcrossSeeds >= 4,
    `Default MazeSceneEngine reliably produces occasional lightning cracks across runs (seeds=${seedsWithCrack}/6, cracks=${totalCracksAcrossSeeds})`
  )

  // 10e. Verify ceiling light sputter 0.5s prior does NOT starve ready lightning crack
  {
    const mockSputter = createEnvelopeRecordingContext()
    const engSp = new HorrorAudioEngine({
      createAudioContext: () => mockSputter.ctx,
      autoUnlock: true,
      rainEnabled: true,
      thunderEnabled: true,
      thunderRandom: () => 0.1,
      ambientRandom: makeDeterministicRng(111),
      recordCueHistory: true,
    })
    engSp.setMaze(mazeA)
    engSp._thunderClockSec = 30.0
    engSp._elapsedSec = 30.0
    engSp._lastGlobalLightSputterAt = 29.5
    engSp._thunderNextCrackAllowedAtSec = 0
    engSp._thunderEventTimer = 0.05
    engSp.update(0.1, { playerWorldPos: playerStartA })
    const latestSp = engSp.getCueHistory().filter((c) => c.type.startsWith('thunder_')).pop()
    assert(
      latestSp?.type === 'thunder_crack',
      'Ceiling light sputter >= 0.45s earlier no longer starves ready lightning crack'
    )
    engSp.dispose()
  }
}
console.log('✓ Real-world RBJ acoustic balance, muffled underground rain, audible thunder/cracks & default crack reliability verified')

console.log('--- ALL PHASE 2 & PHASE 3 THUNDERSTORM AUDIO TESTS PASSED! ---')
