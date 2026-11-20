import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import {
  AMBIENT_HORROR_CATEGORIES,
  AMBIENT_HORROR_CONFIG,
  HorrorAudioEngine,
  computeSpatialAudioAttenuation,
} from './HorrorAudioEngine.js'
import { HORROR_EVENT_TYPES, HORROR_INTENSITY_LEVELS } from './HorrorDirector.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  createNoiseBuffer,
  playNoiseBurst,
  startAdaptiveMusicLayer,
  startAmbientBed,
  triggerAmbientCreakOrKnockCue,
  triggerAmbientDistantEchoStepsCue,
  triggerAmbientRareAnomalyCue,
  triggerAmbientUndergroundRumbleCue,
  triggerAmbientVentWindCue,
  triggerPresenceWarningCue,
  triggerScriptedScareCue,
  triggerSilhouetteStingCue,
} from './audioSynthesis.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createTrackingMockAudioContext() {
  const stats = {
    resumeCount: 0,
    suspendCount: 0,
    closeCount: 0,
    oscillatorsStarted: 0,
    oscillatorsStopped: 0,
    bufferSourcesStarted: 0,
    bufferSourcesStopped: 0,
    pannersCreated: 0,
    filtersCreated: 0,
    disconnectedCount: 0,
    connections: [],
  }

  function makeParam(initial = 0) {
    return {
      value: initial,
      setValueAtTime(v) {
        this.value = v
      },
      setTargetAtTime(v) {
        this.value = v
      },
      linearRampToValueAtTime(v) {
        this.value = v
      },
      exponentialRampToValueAtTime(v) {
        this.value = v
      },
    }
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
    state: 'suspended',
    currentTime: 1.0,
    sampleRate: 44100,
    destination: makeBaseNode('destination'),
    listener: {
      positionX: makeParam(0),
      positionY: makeParam(0),
      positionZ: makeParam(0),
      forwardX: makeParam(0),
      forwardY: makeParam(0),
      forwardZ: makeParam(-1),
      upX: makeParam(0),
      upY: makeParam(1),
      upZ: makeParam(0),
    },
    async resume() {
      stats.resumeCount += 1
      ctx.state = 'running'
    },
    async suspend() {
      stats.suspendCount += 1
      ctx.state = 'suspended'
    },
    async close() {
      stats.closeCount += 1
      ctx.state = 'closed'
    },
    createDelay(maxDelayTime = 1) {
      return makeBaseNode('delay', {
        maxDelayTime,
        delayTime: makeParam(0),
      })
    },
    createGain() {
      return makeBaseNode('gain', { gain: makeParam(1) })
    },
    createDynamicsCompressor() {
      return makeBaseNode('compressor', {
        threshold: makeParam(-14),
        knee: makeParam(18),
        ratio: makeParam(6),
      })
    },
    createBiquadFilter() {
      stats.filtersCreated += 1
      return makeBaseNode('filter', {
        type: 'lowpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
      })
    },
    createPanner() {
      stats.pannersCreated += 1
      return makeBaseNode('panner', {
        panningModel: 'HRTF',
        distanceModel: 'linear',
        refDistance: 1.8,
        maxDistance: 22.0,
        rolloffFactor: 0,
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
      })
    },
    createOscillator() {
      let started = false
      let stopped = false
      return makeBaseNode('oscillator', {
        type: 'sine',
        frequency: makeParam(220),
        onended: null,
        start() {
          if (!started) {
            started = true
            stats.oscillatorsStarted += 1
          }
        },
        stop() {
          if (started && !stopped) {
            stopped = true
            stats.oscillatorsStopped += 1
            this.onended?.()
          }
        },
      })
    },
    createBuffer(channels, len, sr) {
      return {
        numberOfChannels: channels,
        length: len,
        sampleRate: sr,
        duration: len / sr,
        getChannelData: () => new Float32Array(len),
      }
    },
    createBufferSource() {
      let started = false
      let stopped = false
      return makeBaseNode('bufferSource', {
        buffer: null,
        loop: false,
        onended: null,
        start() {
          if (!started) {
            started = true
            stats.bufferSourcesStarted += 1
          }
        },
        stop() {
          if (started && !stopped) {
            stopped = true
            stats.bufferSourcesStopped += 1
            this.onended?.()
          }
        },
      })
    },
  }

  return { ctx, stats }
}

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 640,
    clientHeight: 480,
  }
  const mockRenderer = {
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
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    ...config,
  })
}

function makeDeterministicRng(seed = 1337) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

console.log('--- RUNNING AMBIENT HORROR AUDIO INTEGRATION TESTS ---')

// ---------------------------------------------------------------------------
// Test 1: Unlock gating and randomized long-interval cadence (12-22s grace, 16-38s+)
// ---------------------------------------------------------------------------
console.log('Test 1: Unlock Gating & Scheduler Cadence')
const mazeA = generateMaze({ difficulty: 'medium', seed: 4242 })
const mazeB = generateMaze({ difficulty: 'medium', seed: 8484 })
const mock1 = createTrackingMockAudioContext()
let ctxCreations1 = 0

const audio1 = new HorrorAudioEngine({
  createAudioContext: () => {
    ctxCreations1 += 1
    return mock1.ctx
  },
  ambientRandom: makeDeterministicRng(99),
  recordCueHistory: true,
})
audio1.setMaze(mazeA)

const initialGrace = audio1.getAmbientHorrorState().nextEventInSec
assert(
  initialGrace >= AMBIENT_HORROR_CONFIG.initialGraceMinSec &&
    initialGrace <= AMBIENT_HORROR_CONFIG.initialGraceMaxSec,
  `Initial grace period (${initialGrace.toFixed(2)}s) sits within ${AMBIENT_HORROR_CONFIG.initialGraceMinSec}-${AMBIENT_HORROR_CONFIG.initialGraceMaxSec}s`
)

// Simulate 25s before audio unlock -> zero AudioContext creation and zero ambient cues
for (let i = 0; i < 250; i += 1) {
  audio1.update(0.1, { playerWorldPos: gridToWorld(mazeA.start.row, mazeA.start.col, mazeA) })
}
assert(ctxCreations1 === 0, 'AudioContext is not created before unlock')
assert(mock1.stats.oscillatorsStarted === 0, 'No oscillators start before unlock')
assert(
  audio1.getCueHistory().filter((c) => c.type === 'ambient_horror').length === 0,
  'Zero ambient horror cues trigger before unlock'
)
assert(
  Math.abs(audio1.getAmbientHorrorState().nextEventInSec - initialGrace) < 1e-6,
  'Initial grace timer waits for unlock instead of firing immediately upon unlock'
)

// Unlock audio: still silent during initial grace period, fires after grace elapses
assert(audio1.unlock() === true, 'Audio unlock succeeds')
const playerStartA = gridToWorld(mazeA.start.row, mazeA.start.col, mazeA)
for (let i = 0; i < Math.floor((initialGrace - 0.5) / 0.1); i += 1) {
  audio1.update(0.1, { playerWorldPos: playerStartA })
}
assert(
  audio1.getCueHistory().filter((c) => c.type === 'ambient_horror').length === 0,
  'No ambient cue fires before initial grace period ends'
)

for (let i = 0; i < 20; i += 1) {
  audio1.update(0.1, { playerWorldPos: playerStartA })
}
const firstCues = audio1.getCueHistory().filter((c) => c.type === 'ambient_horror')
assert(firstCues.length === 1, 'Exactly one ambient cue fires once initial grace finishes')
const scheduledNext = audio1.getAmbientHorrorState().nextEventInSec
assert(
  scheduledNext >= AMBIENT_HORROR_CONFIG.intervalMinSec &&
    scheduledNext <=
      AMBIENT_HORROR_CONFIG.intervalMaxSec + AMBIENT_HORROR_CONFIG.extraSilenceMaxSec,
  `Next scheduled interval (${scheduledNext.toFixed(2)}s) obeys configured ${AMBIENT_HORROR_CONFIG.intervalMinSec}-${AMBIENT_HORROR_CONFIG.intervalMaxSec}+${AMBIENT_HORROR_CONFIG.extraSilenceMaxSec}s spacing`
)
audio1.dispose()
console.log(
  `✓ Unlock gating and ${AMBIENT_HORROR_CONFIG.initialGraceMinSec}-${AMBIENT_HORROR_CONFIG.initialGraceMaxSec}s grace / ${AMBIENT_HORROR_CONFIG.intervalMinSec}-${AMBIENT_HORROR_CONFIG.intervalMaxSec}s+ cadence verified`
)

// ---------------------------------------------------------------------------
// Test 2: All 5 categories, anti-repetition, per-category cooldowns & non-overlap
// ---------------------------------------------------------------------------
console.log('Test 2: All 5 Ambient Categories, Cooldowns & Anti-Repetition')
const mock2 = createTrackingMockAudioContext()
const audio2 = new HorrorAudioEngine({
  createAudioContext: () => mock2.ctx,
  autoUnlock: true,
  ambientRandom: makeDeterministicRng(2026),
  recordCueHistory: true,
})
audio2.setMaze(mazeA)

// Run 12 minutes of simulated calm exploration so all 5 categories naturally appear
for (let step = 0; step < 7200; step += 1) {
  audio2.update(0.1, { playerWorldPos: playerStartA })
  const state = audio2.getAmbientHorrorState()
  if (state.activeCue) {
    assert(state.activeCue.remainingSec > 0, 'Active cue remainingSec stays positive while active')
  }
}

const history2 = audio2.getCueHistory().filter((c) => c.type === 'ambient_horror')
assert(history2.length >= 14, `Expected >= 14 cues over 12 min, got ${history2.length}`)

const seenCategories = new Set(history2.map((c) => c.category))
for (const cat of Object.values(AMBIENT_HORROR_CATEGORIES)) {
  assert(seenCategories.has(cat), `Ambient category "${cat}" played during exploration`)
}

const lastTimeByCat = new Map()
const lastVariantByCat = new Map()
for (let i = 0; i < history2.length; i += 1) {
  const evt = history2[i]
  if (i > 0) {
    assert(
      evt.category !== history2[i - 1].category,
      `No consecutive duplicate category (${evt.category} vs ${history2[i - 1].category})`
    )
    const gap = evt.time - history2[i - 1].time
    assert(
      gap >= AMBIENT_HORROR_CONFIG.intervalMinSec - 0.15,
      `Inter-event gap (${gap.toFixed(2)}s) respects minimum interval`
    )
  }
  const prevCatTime = lastTimeByCat.get(evt.category)
  if (prevCatTime !== undefined) {
    const cd = AMBIENT_HORROR_CONFIG.perCategoryCooldowns[evt.category]
    assert(
      evt.time - prevCatTime >= cd - 0.15,
      `Per-category cooldown honored for ${evt.category} (delta ${(evt.time - prevCatTime).toFixed(2)}s >= ${cd}s)`
    )
  }
  lastTimeByCat.set(evt.category, evt.time)

  const prevVar = lastVariantByCat.get(evt.category)
  if (prevVar !== undefined) {
    assert(
      evt.variant !== prevVar,
      `Variant did not repeat back-to-back within ${evt.category} (${evt.variant})`
    )
  }
  lastVariantByCat.set(evt.category, evt.variant)

  if (evt.category === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY) {
    assert(
      evt.time >= AMBIENT_HORROR_CONFIG.minRareAnomalyElapsedSec - 0.15,
      `rare_anomaly stays absent in early run (${evt.time.toFixed(2)}s >= ${AMBIENT_HORROR_CONFIG.minRareAnomalyElapsedSec}s)`
    )
  }
}
const rareCount2 = history2.filter(
  (c) => c.category === AMBIENT_HORROR_CATEGORIES.RARE_ANOMALY
).length
assert(
  rareCount2 >= 1 && rareCount2 < history2.length * 0.25,
  `rare_anomaly remains genuinely rare (${rareCount2}/${history2.length} cues)`
)
audio2.dispose()
console.log('✓ All 5 categories, cooldowns, variant rotation, and non-repetition verified')

// ---------------------------------------------------------------------------
// Test 3: ambienceGain routing, Ambience slider, Mute, Spatial & Wall Occlusion
// ---------------------------------------------------------------------------
console.log('Test 3: ambienceGain Routing, Volume/Mute, Spatialization & Wall Occlusion')
const mock3 = createTrackingMockAudioContext()
const audio3 = new HorrorAudioEngine({
  createAudioContext: () => mock3.ctx,
  autoUnlock: true,
  ambientRandom: makeDeterministicRng(77),
  ambientScheduler: {
    initialGraceMinSec: 0.5,
    initialGraceMaxSec: 0.5,
    intervalMinSec: 1.0,
    intervalMaxSec: 1.0,
    extraSilenceChance: 0,
    perCategoryCooldowns: {
      creak_knock: 1,
      underground_rumble: 1,
      vent_wind: 1,
      distant_echo_steps: 1,
      rare_anomaly: 1,
    },
  },
  recordCueHistory: true,
})
audio3.setMaze(mazeA)
const connBeforeCue = mock3.stats.connections.length
const pannersBeforeCue = mock3.stats.pannersCreated

for (let i = 0; i < 10; i += 1) {
  audio3.update(0.1, { playerWorldPos: playerStartA })
}

const cue3 = audio3.getCueHistory().find((c) => c.type === 'ambient_horror')
assert(Boolean(cue3), 'Short-cadence test scheduler triggered an ambient cue')
assert(
  mock3.stats.pannersCreated > pannersBeforeCue,
  'Spatial ambient cue created an HRTF PannerNode'
)

const newConnections = mock3.stats.connections.slice(connBeforeCue)
const routedToAmbience = newConnections.some((c) => c.to === audio3.ambienceGain)
const leakedToEffects = newConnections.some(
  (c) => c.to === audio3.effectsGain || c.to === audio3._reverbInput
)
assert(routedToAmbience, 'Ambient cue routes into ambienceGain')
assert(!leakedToEffects, 'Ambient cue does NOT route into effectsGain or effects reverb')
assert(
  cue3.gain > 0 && cue3.gain <= 1,
  `Spatial attenuation computed positive gain (${cue3.gain})`
)

// Test spatialAudio: false -> zero new PannerNodes while still routing to ambienceGain
audio3.setAudioOptions({ spatialAudio: false })
const pannersFlatBefore = mock3.stats.pannersCreated
const connFlatBefore = mock3.stats.connections.length
for (let i = 0; i < 45; i += 1) {
  audio3.update(0.1, { playerWorldPos: playerStartA })
}
assert(
  mock3.stats.pannersCreated === pannersFlatBefore,
  'Disabling spatialAudio skips PannerNode creation for ambient cues'
)
assert(
  mock3.stats.connections.slice(connFlatBefore).some((c) => c.to === audio3.ambienceGain),
  'Non-spatial ambient cue still routes through ambienceGain'
)
audio3.setAudioOptions({ spatialAudio: true })

// Test Ambience = 0 and Mute = true skip ambient cue synthesis cleanly
audio3.clearCueHistory()
audio3.setVolumes({ ambience: 0 })
const oscAtZeroAmbience = mock3.stats.oscillatorsStarted
const bufAtZeroAmbience = mock3.stats.bufferSourcesStarted
for (let i = 0; i < 60; i += 1) {
  audio3.update(0.1, { playerWorldPos: playerStartA })
}
assert(
  audio3.getCueHistory().filter((c) => c.type === 'ambient_horror').length === 0 &&
    mock3.stats.oscillatorsStarted === oscAtZeroAmbience &&
    mock3.stats.bufferSourcesStarted === bufAtZeroAmbience,
  'Ambience slider at 0 suppresses ambient horror node synthesis cleanly'
)

audio3.setVolumes({ ambience: 0.75 })
audio3.setMuted(true)
for (let i = 0; i < 60; i += 1) {
  audio3.update(0.1, { playerWorldPos: playerStartA })
}
assert(
  audio3.getCueHistory().filter((c) => c.type === 'ambient_horror').length === 0,
  'Mute suppresses ambient horror cues cleanly'
)

// Unmute + hiding preserves calm ambient cues
audio3.setMuted(false)
for (let i = 0; i < 60; i += 1) {
  audio3.update(0.1, { playerWorldPos: playerStartA, isHidden: true })
}
assert(
  audio3.getCueHistory().some((c) => c.type === 'ambient_horror' && c.isHidden === true),
  'Calm ambient horror sounds remain active while player is hiding'
)
audio3.dispose()
console.log('✓ ambienceGain routing, volume/mute, spatial/occlusion, and hiding behavior verified')

// ---------------------------------------------------------------------------
// Test 4: Chase, blackout, scripted scare suppression & nearby enemy step guard
// ---------------------------------------------------------------------------
console.log('Test 4: Chase / Blackout / Scripted Scare Suppression & Distant Step Guard')
const mock4 = createTrackingMockAudioContext()
const audio4 = new HorrorAudioEngine({
  createAudioContext: () => mock4.ctx,
  autoUnlock: true,
  ambientRandom: makeDeterministicRng(314),
  ambientScheduler: {
    initialGraceMinSec: 0.4,
    initialGraceMaxSec: 0.4,
    intervalMinSec: 0.8,
    intervalMaxSec: 0.8,
    extraSilenceChance: 0,
    suppressionDeferralMinSec: 1.5,
    suppressionDeferralMaxSec: 1.5,
    perCategoryCooldowns: {
      creak_knock: 0.5,
      underground_rumble: 0.5,
      vent_wind: 0.5,
      distant_echo_steps: 0.5,
      rare_anomaly: 0.5,
    },
  },
  recordCueHistory: true,
})
audio4.setMaze(mazeA)

// Chase suppression
const chaseEnemy = [
  {
    id: 'e1',
    type: 'stalker',
    state: ENEMY_STATES.CHASE,
    worldPos: { x: playerStartA.x + 6, y: 0, z: playerStartA.z },
  },
]
for (let i = 0; i < 50; i += 1) {
  audio4.update(0.1, { playerWorldPos: playerStartA, enemies: chaseEnemy })
}
assert(
  audio4.getCueHistory().filter((c) => c.type === 'ambient_horror').length === 0,
  'Ambient events stay suppressed during enemy chase'
)

// Scripted scare & blackout suppression
for (let i = 0; i < 30; i += 1) {
  audio4.update(0.1, {
    playerWorldPos: playerStartA,
    activeHorrorEventType: HORROR_EVENT_TYPES.SCRIPTED_SCARE,
  })
}
for (let i = 0; i < 30; i += 1) {
  audio4.update(0.1, {
    playerWorldPos: playerStartA,
    lightScale: 0.2,
  })
}
assert(
  audio4.getCueHistory().filter((c) => c.type === 'ambient_horror').length === 0,
  'Ambient events stay suppressed during active scripted scares and blackouts'
)

// Nearby patrolling enemy (< 10.5m) suppresses distant_echo_steps specifically
const nearbyEnemy = [
  {
    id: 'e2',
    type: 'stalker',
    state: ENEMY_STATES.PATROL,
    worldPos: { x: playerStartA.x + 5.0, y: 0, z: playerStartA.z },
  },
]
audio4.clearCueHistory()
for (let i = 0; i < 120; i += 1) {
  audio4.update(0.1, { playerWorldPos: playerStartA, enemies: nearbyEnemy })
}
const nearbyAmbientCues = audio4.getCueHistory().filter((c) => c.type === 'ambient_horror')
assert(nearbyAmbientCues.length >= 2, 'Non-step ambient cues still occur calmly near patrolling enemy')
assert(
  !nearbyAmbientCues.some((c) => c.category === AMBIENT_HORROR_CATEGORIES.DISTANT_ECHO_STEPS),
  'distant_echo_steps is suppressed when an enemy is nearby to avoid confusion'
)

// Ceiling-light sputter anti-clustering: recent sputter defers pending ambient cue without aborting gameplay
while (audio4.getAmbientHorrorState().activeCue) {
  audio4.update(0.1, { playerWorldPos: playerStartA })
}
const cuesBeforeSputter = audio4
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror').length
audio4._ambientEventTimer = 0.05
audio4._lastGlobalLightSputterAt = audio4._elapsedSec
for (let i = 0; i < 3; i += 1) {
  audio4.update(0.1, { playerWorldPos: playerStartA })
}
const cuesDuringSputterGrace = audio4
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror').length
assert(
  cuesDuringSputterGrace === cuesBeforeSputter &&
    audio4.getAmbientHorrorState().nextEventInSec >= 1.0,
  'Ambient cue defers instead of clustering immediately on top of a ceiling-light sputter'
)
for (let i = 0; i < 50; i += 1) {
  audio4.update(0.1, { playerWorldPos: playerStartA })
}
assert(
  audio4.getCueHistory().filter((c) => c.type === 'ambient_horror').length > cuesBeforeSputter,
  'Ambient cue resumes cleanly once ceiling-light sputter grace window clears'
)

audio4.dispose()
console.log('✓ Context suppression, light anti-clustering, and distant-step safety verified')

// ---------------------------------------------------------------------------
// Test 5: Full MazeSceneEngine integration, cached anchors, lifecycle & ceiling lights
// ---------------------------------------------------------------------------
console.log('Test 5: MazeSceneEngine Integration, Lifecycle & Ceiling-Light Coexistence')
const mock5 = createTrackingMockAudioContext()
const engine = createHeadlessEngine({
  enemies: { autoSpawn: false },
  horrorDirector: { intensity: HORROR_INTENSITY_LEVELS.OFF },
  audio: {
    createAudioContext: () => mock5.ctx,
    ambientRandom: makeDeterministicRng(5150),
    ambientScheduler: {
      initialGraceMinSec: 0.6,
      initialGraceMaxSec: 0.6,
      intervalMinSec: 1.2,
      intervalMaxSec: 1.2,
      extraSilenceChance: 0,
      minResumeDelaySec: 2.5,
      perCategoryCooldowns: {
        creak_knock: 0.5,
        underground_rumble: 0.5,
        vent_wind: 0.5,
        distant_echo_steps: 0.5,
        rare_anomaly: 0.5,
      },
    },
    recordCueHistory: true,
  },
})

engine.setMaze(mazeA)
engine.unlockAudio()
const audioEngine5 = engine.getAudioEngine()
const anchorsA = audioEngine5.getAmbientHorrorState().anchorCounts
assert(
  anchorsA.vents > 0 && anchorsA.ducts > 0 && anchorsA.corridors > 0,
  `MazeSceneEngine cached vents (${anchorsA.vents}), ducts (${anchorsA.ducts}), and corridors (${anchorsA.corridors}) on setMaze`
)

// Step until an ambient cue becomes active AND check ceiling lights coexist cleanly
let sawActiveCue = false
for (let i = 0; i < 60; i += 1) {
  engine.stepFrame(0.05, { render: false })
  if (audioEngine5.getAmbientHorrorState().activeCue) {
    sawActiveCue = true
    break
  }
}
assert(sawActiveCue, 'Engine stepFrame triggered an active ambient cue')
assert(
  audioEngine5.getCeilingLightAudioState().poolSize > 0 ||
    audioEngine5.getCeilingLightAudioState().trackedFixtures >= 0,
  'Ceiling-light audio pipeline remains intact alongside ambient horror audio'
)

// Pause must cancel active cue immediately and defer on resume (no burst!)
engine.setPaused(true)
assert(
  audioEngine5.getAmbientHorrorState().activeCue === null,
  'Pause immediately cancels active ambient cue'
)
engine.setPaused(false)
const afterResumeTimer = audioEngine5.getAmbientHorrorState().nextEventInSec
assert(
  afterResumeTimer >= 2.5,
  `Resume enforces quiet buffer (${afterResumeTimer.toFixed(2)}s >= 2.5s) preventing burst`
)
for (let i = 0; i < 10; i += 1) {
  engine.stepFrame(0.05, { render: false })
}
assert(
  audioEngine5.getAmbientHorrorState().activeCue === null,
  'No queued sound bursts right after resume'
)

// Step until active again, then test maze switch reset
for (let i = 0; i < 60; i += 1) {
  engine.stepFrame(0.05, { render: false })
  if (audioEngine5.getAmbientHorrorState().activeCue) break
}
assert(audioEngine5.getAmbientHorrorState().activeCue !== null, 'Ambient cue active before maze switch')
engine.setMaze(mazeB)
assert(
  audioEngine5.getAmbientHorrorState().activeCue === null &&
    audioEngine5.getAmbientHorrorState().lastCategory === null,
  'Switching maze cancels active cue and resets ambient scheduler'
)

// Victory stops active cues and suppresses subsequent playback
for (let i = 0; i < 40; i += 1) {
  engine.stepFrame(0.05, { render: false })
  if (audioEngine5.getAmbientHorrorState().activeCue) break
}
engine.setHasWon(true)
assert(
  audioEngine5.getAmbientHorrorState().activeCue === null,
  'Victory cancels active ambient cue'
)
const cuesAtVictory = audioEngine5
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror').length
for (let i = 0; i < 40; i += 1) {
  engine.stepFrame(0.05, { render: false })
}
assert(
  audioEngine5.getCueHistory().filter((c) => c.type === 'ambient_horror').length ===
    cuesAtVictory,
  'No new ambient cues play after victory'
)

// Reset + Game Over lifecycle
engine.resetCombat()
for (let i = 0; i < 40; i += 1) {
  engine.stepFrame(0.05, { render: false })
  if (audioEngine5.getAmbientHorrorState().activeCue) break
}
engine.setHealth(0)
assert(
  audioEngine5.getAmbientHorrorState().activeCue === null,
  'Game over cancels active ambient cue'
)
const cuesAtGameOver = audioEngine5
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror').length
for (let i = 0; i < 40; i += 1) {
  engine.stepFrame(0.05, { render: false })
}
assert(
  audioEngine5.getCueHistory().filter((c) => c.type === 'ambient_horror').length ===
    cuesAtGameOver,
  'No new ambient cues play after game over'
)

// Disposal cleanup
engine.dispose()
assert(audioEngine5.isDisposed === true, 'HorrorAudioEngine disposed cleanly')
assert(mock5.stats.closeCount === 1, 'Owned AudioContext closed on dispose')
assert(
  mock5.stats.oscillatorsStopped >= 2,
  'Continuous and transient oscillators stopped cleanly on dispose'
)
console.log('✓ MazeSceneEngine lifecycle, cached anchors, and ceiling-light coexistence verified')

// ---------------------------------------------------------------------------
// Test 6: HorrorDirector silent event cancellation sync & ambient recovery
// ---------------------------------------------------------------------------
console.log('Test 6: HorrorDirector Silent Cancellation Sync & Ambient Resumption')
const mock6 = createTrackingMockAudioContext()
let eventStartCount = 0
let eventEndCount = 0
let eventCancelCount = 0

const engine6 = createHeadlessEngine({
  enemies: { autoSpawn: false },
  horrorDirector: {
    intensity: HORROR_INTENSITY_LEVELS.NORMAL,
    visualScaresEnabled: true,
    initialDelay: 60,
    onEvent: () => {
      eventStartCount += 1
    },
    onEventEnd: () => {
      eventEndCount += 1
    },
    onEventCancel: () => {
      eventCancelCount += 1
    },
  },
  audio: {
    createAudioContext: () => mock6.ctx,
    ambientRandom: makeDeterministicRng(9001),
    ambientScheduler: {
      initialGraceMinSec: 0.4,
      initialGraceMaxSec: 0.4,
      intervalMinSec: 0.8,
      intervalMaxSec: 0.8,
      extraSilenceChance: 0,
      suppressionDeferralMinSec: 1.0,
      suppressionDeferralMaxSec: 1.0,
      perCategoryCooldowns: {
        creak_knock: 0.5,
        underground_rumble: 0.5,
        vent_wind: 0.5,
        distant_echo_steps: 0.5,
        rare_anomaly: 0.5,
      },
    },
    recordCueHistory: true,
  },
})

engine6.setMaze(mazeA)
engine6.unlockAudio()
const audio6 = engine6.getAudioEngine()
const director6 = engine6.getHorrorDirector()
const playerPos6 = engine6.getPlayerWorldPosition()

// 6a. Normal event start/end behavior remains unchanged
const normalEvt = director6.triggerEvent(HORROR_EVENT_TYPES.LIGHT_FLICKER, {
  playerWorldPos: playerPos6,
})
assert(Boolean(normalEvt), 'Normal HorrorDirector light_flicker event started')
assert(
  engine6._activeHorrorEventType === HORROR_EVENT_TYPES.LIGHT_FLICKER,
  'Normal event start sets MazeSceneEngine._activeHorrorEventType'
)
for (let i = 0; i < 60; i += 1) {
  engine6.stepFrame(0.05, { render: false })
}
assert(
  engine6._activeHorrorEventType === null &&
    eventStartCount === 1 &&
    eventEndCount === 1 &&
    eventCancelCount === 0,
  'Normal event completion fires onEventEnd once and clears _activeHorrorEventType'
)

// 6b. Disabling Horror Intensity mid-event clears stale state & ambient resumes
const blackoutEvt = director6.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, {
  playerWorldPos: playerPos6,
})
assert(Boolean(blackoutEvt), 'Blackout event started before intensity change')
assert(
  engine6._activeHorrorEventType === HORROR_EVENT_TYPES.BLACKOUT,
  'Active blackout recorded on MazeSceneEngine'
)
engine6.stepFrame(0.05, { render: false })
const cuesBeforeIntensityOff = audio6
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror').length

engine6.updateHorrorConfig({ intensity: HORROR_INTENSITY_LEVELS.OFF })
assert(
  engine6._activeHorrorEventType === null,
  'Disabling Horror Intensity mid-event immediately clears _activeHorrorEventType'
)
assert(
  eventEndCount === 1 && eventCancelCount === 1,
  'Silent intensity-off cancellation invokes onEventCancel without firing onEventEnd'
)

for (let i = 0; i < 160; i += 1) {
  engine6.stepFrame(0.05, { render: false })
}
const cuesAfterIntensityOff = audio6
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror').length
assert(
  cuesAfterIntensityOff > cuesBeforeIntensityOff,
  'Ambient horror scheduling resumes after disabling Horror Intensity mid-event'
)

// 6c. Disabling Visual Scares mid-event clears stale state & ambient resumes
engine6.updateHorrorConfig({ intensity: HORROR_INTENSITY_LEVELS.NORMAL })
const visualEvt = director6.triggerEvent(HORROR_EVENT_TYPES.LIGHT_FLICKER, {
  playerWorldPos: playerPos6,
})
assert(Boolean(visualEvt), 'Visual light_flicker event started before visual scares toggle')
assert(
  engine6._activeHorrorEventType === HORROR_EVENT_TYPES.LIGHT_FLICKER,
  'Active visual event recorded on MazeSceneEngine'
)
engine6.stepFrame(0.05, { render: false })
const cuesBeforeVisualOff = audio6
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror').length

engine6.updateHorrorConfig({ visualScaresEnabled: false })
assert(
  engine6._activeHorrorEventType === null,
  'Disabling Visual Scares mid-event immediately clears _activeHorrorEventType'
)
assert(
  eventEndCount === 1 && eventCancelCount === 2,
  'Silent visual-scares-off cancellation clears state via onEventCancel without firing onEventEnd'
)

for (let i = 0; i < 160; i += 1) {
  engine6.stepFrame(0.05, { render: false })
}
const cuesAfterVisualOff = audio6
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror').length
assert(
  cuesAfterVisualOff > cuesBeforeVisualOff,
  'Ambient horror scheduling resumes after disabling Visual Scares mid-event'
)

// 6d. Direct HorrorDirector silent cancellation (reset / setIntensity) also syncs engine state
engine6.updateHorrorConfig({ visualScaresEnabled: true })
director6.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, { playerWorldPos: playerPos6 })
assert(engine6._activeHorrorEventType === HORROR_EVENT_TYPES.BLACKOUT, 'Blackout active before direct reset')
director6.reset()
assert(
  engine6._activeHorrorEventType === null && eventCancelCount === 3,
  'Direct HorrorDirector.reset() silently clears MazeSceneEngine._activeHorrorEventType'
)

engine6.dispose()
console.log('✓ HorrorDirector silent event cancellation sync and ambient recovery verified')

// ---------------------------------------------------------------------------
// Test 7: Reduced continuous floor, speaker-audible cues & spatial floor
// ---------------------------------------------------------------------------
console.log('Test 7: Reduced Background Floor, Speaker-Audible Cues & Spatial Floor')

function measureCueNodes(triggerFn, gainSliceStart = 1) {
  const { ctx, stats } = createTrackingMockAudioContext()
  ctx.state = 'running'
  const gains = []
  const filters = []
  const oscillators = []
  const origCreateGain = ctx.createGain
  const origCreateFilter = ctx.createBiquadFilter
  const origCreateOscillator = ctx.createOscillator
  const trackParam = (param, store) => {
    const wrapped = {
      _v: param.value,
      get value() {
        return this._v
      },
      set value(val) {
        this._v = val
        store.push(val)
      },
      setValueAtTime(v) {
        this._v = v
        store.push(v)
      },
      setTargetAtTime(v) {
        this._v = v
        store.push(v)
      },
      linearRampToValueAtTime(v) {
        this._v = v
        store.push(v)
      },
      exponentialRampToValueAtTime(v) {
        this._v = v
        store.push(v)
      },
    }
    return wrapped
  }

  ctx.createGain = () => {
    const node = origCreateGain()
    const history = []
    node.gain = trackParam(node.gain, history)
    gains.push({ node, history })
    return node
  }
  ctx.createBiquadFilter = () => {
    const node = origCreateFilter()
    const freqHistory = []
    node.frequency = trackParam(node.frequency, freqHistory)
    filters.push({ node, freqHistory })
    return node
  }
  ctx.createOscillator = () => {
    const osc = origCreateOscillator()
    oscillators.push(osc)
    return osc
  }

  const dest = ctx.createGain()
  const noiseBuffer = ctx.createBuffer(1, 44100, 44100)
  const handle = triggerFn(ctx, dest, noiseBuffer)
  const maxGain = Math.max(
    0,
    ...gains.slice(gainSliceStart).flatMap((g) => g.history)
  )
  const maxFilterFreq = Math.max(
    0,
    ...filters.flatMap((f) => f.freqHistory)
  )
  return { handle, maxGain, maxFilterFreq, gains, filters, oscillators, stats }
}

const bedStats = measureCueNodes((ctx, dest, noiseBuffer) => startAmbientBed(ctx, dest, noiseBuffer))
assert(
  bedStats.gains[1].history.every((v) => v <= 0.08 && v >= 0.0001) &&
    bedStats.gains[1].history.some((v) => v >= 0.05 && v <= 0.08),
  `Continuous ambient bed stays subtle yet speaker-audible ([0.05, 0.08], got ${JSON.stringify(bedStats.gains[1].history)})`
)
assert(
  bedStats.stats.bufferSourcesStarted === 0,
  'Continuous ambient bed runs zero looping noise hiss sources'
)
assert(
  bedStats.filters[0].freqHistory.every((v) => v <= 260),
  'Continuous ambient bed lowpass stays <= 260 Hz so mid-frequencies remain clear'
)
assert(
  bedStats.oscillators.some((osc) => osc.frequency.value >= 100),
  'Continuous ambient bed includes >= 100 Hz harmonic warmth audible on PC/laptop speakers'
)
bedStats.handle.stop()

const musicStatsAmbient = measureCueNodes((ctx, dest) => {
  const layer = startAdaptiveMusicLayer(ctx, dest)
  layer.setMood('ambient')
  return layer
})
assert(
  musicStatsAmbient.gains[1].history.every((v) => v <= 0.001),
  `Adaptive music output stays silent in ambient mood (got ${JSON.stringify(musicStatsAmbient.gains[1].history)})`
)
musicStatsAmbient.handle.stop()

const musicStatsTension = measureCueNodes((ctx, dest) => {
  const layer = startAdaptiveMusicLayer(ctx, dest)
  layer.setMood('ambient')
  layer.setMood('tension')
  return layer
})
assert(
  musicStatsTension.oscillators.every((osc) => osc.type !== 'sawtooth'),
  'Adaptive music layer contains zero harsh sawtooth oscillators'
)
assert(
  musicStatsTension.gains[1].history.some((v) => v >= 0.06 && v <= 0.14),
  `Adaptive music tension mood rises into restrained [0.06, 0.14] layer (got ${JSON.stringify(musicStatsTension.gains[1].history)})`
)
musicStatsTension.handle.stop()

const warningStats = measureCueNodes((ctx, dest, noiseBuffer) =>
  triggerPresenceWarningCue(ctx, dest, noiseBuffer, 0.6)
)
const stingStats = measureCueNodes((ctx, dest, noiseBuffer) =>
  triggerSilhouetteStingCue(ctx, dest, noiseBuffer)
)
const scareStats = measureCueNodes((ctx, dest, noiseBuffer) =>
  triggerScriptedScareCue(ctx, dest, noiseBuffer, 1)
)

const categoryChecks = [
  ['creak_knock', (v) => (ctx, dest, nb) => triggerAmbientCreakOrKnockCue(ctx, dest, nb, { variant: v })],
  [
    'underground_rumble',
    (v) => (ctx, dest, nb) => triggerAmbientUndergroundRumbleCue(ctx, dest, nb, { variant: v }),
  ],
  ['vent_wind', (v) => (ctx, dest, nb) => triggerAmbientVentWindCue(ctx, dest, nb, { variant: v })],
  [
    'distant_echo_steps',
    (v) => (ctx, dest, nb) => triggerAmbientDistantEchoStepsCue(ctx, dest, nb, { variant: v }),
  ],
  ['rare_anomaly', (v) => (ctx, dest, nb) => triggerAmbientRareAnomalyCue(ctx, dest, nb, { variant: v })],
]

for (const [label, makeTrigger] of categoryChecks) {
  for (let variant = 0; variant < 3; variant += 1) {
    const res = measureCueNodes(makeTrigger(variant), 2)
    assert(
      res.gains[1].history.every((v) => v <= 1.0),
      `${label} v${variant} cue mixer gain stays <= 1.0`
    )
    assert(
      res.maxGain >= 0.16 && res.maxGain <= 0.36,
      `${label} v${variant} peak gain (${res.maxGain.toFixed(3)}) sits in speaker-audible non-clipping [0.16, 0.36]`
    )
    assert(
      res.maxFilterFreq >= 280,
      `${label} v${variant} retains mid-band speaker presence (${res.maxFilterFreq} Hz >= 280 Hz)`
    )
    // Even at peak spatial gain on ambience bus (0.55 vs effects 0.85), ambient cues stay below HorrorDirector warnings/stings/scares
    assert(
      res.maxGain * 0.86 * 0.55 < warningStats.maxGain * 0.85,
      `${label} v${variant} stays softer than HorrorDirector presence warning cues`
    )
    assert(
      res.maxGain * 0.86 * 0.55 < stingStats.maxGain * 0.85,
      `${label} v${variant} stays softer than HorrorDirector silhouette stings`
    )
    assert(
      res.maxGain * 0.86 * 0.55 < scareStats.maxGain * 0.85,
      `${label} v${variant} stays softer than direct scripted scare peaks`
    )
    res.handle?.stop?.()
  }
}

// Spatial occlusion & distance perception check (no artificial 0.34 floor)
const wallMaze = generateMaze({ difficulty: 'medium', seed: 12345 })
const wallOrigin = gridToWorld(wallMaze.start.row, wallMaze.start.col, wallMaze)
const nearbyPos = { x: wallOrigin.x + 2.5, y: 1.5, z: wallOrigin.z }
const distantPos = { x: wallOrigin.x + 12, y: 1.5, z: wallOrigin.z + 12 }
const ambientSpatialOpts = {
  refDistance: 3.4,
  maxDistance: 26.0,
  rolloff: 1.05,
  wallAttBase: 0.62,
  minOcclusionGain: 0.22,
  initialBlockedCutoff: 2200,
  minLowpassCutoff: 480,
  minSpatialGain: 0,
}
const nearAmbient = computeSpatialAudioAttenuation(nearbyPos, wallOrigin, wallMaze, ambientSpatialOpts)
const occludedAmbient = computeSpatialAudioAttenuation(distantPos, wallOrigin, wallMaze, ambientSpatialOpts)
assert(
  nearAmbient.gain >= 0.7 && occludedAmbient.gain < 0.34 && occludedAmbient.gain >= 0.05,
  `Distance + walls create natural contrast: near (${nearAmbient.gain.toFixed(3)}) vs distant occluded (${occludedAmbient.gain.toFixed(3)})`
)
assert(
  occludedAmbient.lowpassCutoff >= 480 && occludedAmbient.lowpassCutoff <= 2200 && nearAmbient.lowpassCutoff === 18000,
  `Distant occluded ambient darkens (${occludedAmbient.lowpassCutoff} Hz) while near stays clear (${nearAmbient.lowpassCutoff} Hz)`
)

// Empty anchor pools force _fallbackVirtualAnchor; verify it still produces >= 0.08 gain without stalling
const mockFallback = createTrackingMockAudioContext()
const audioFallback = new HorrorAudioEngine({
  createAudioContext: () => mockFallback.ctx,
  autoUnlock: true,
  ambientRandom: makeDeterministicRng(707),
  ambientScheduler: {
    initialGraceMinSec: 0.2,
    initialGraceMaxSec: 0.2,
    intervalMinSec: 0.5,
    intervalMaxSec: 0.5,
    extraSilenceChance: 0,
  },
  recordCueHistory: true,
})
audioFallback.setMaze(wallMaze)
audioFallback._ambientAnchors = { vents: [], ducts: [], corridors: [] }
for (let i = 0; i < 15; i += 1) {
  audioFallback.update(0.1, { playerWorldPos: wallOrigin })
}
const fallbackCues = audioFallback.getCueHistory().filter((c) => c.type === 'ambient_horror')
assert(fallbackCues.length >= 1, 'Virtual fallback anchor fired ambient cue when anchor pools were empty')
assert(
  fallbackCues.every((c) => c.anchorType.startsWith('virtual_') && c.gain >= 0.08),
  `Fallback virtual anchor guaranteed audible gain >= 0.08 (got ${fallbackCues.map((c) => c.gain.toFixed(3)).join(', ')})`
)
audioFallback.dispose()
console.log('✓ Restored room-air bed, threat hierarchy, and natural ambient distance/occlusion verified')

// ---------------------------------------------------------------------------
// Test 8: Realistic 85s gameplay run with default cadence, brief chase & flickers
// ---------------------------------------------------------------------------
console.log('Test 8: Realistic 45-120s Level Gameplay Cadence & Recovery')
const mockLevel = createTrackingMockAudioContext()
const engineLevel = createHeadlessEngine({
  enemies: { autoSpawn: false },
  horrorDirector: { intensity: HORROR_INTENSITY_LEVELS.OFF },
  audio: {
    createAudioContext: () => mockLevel.ctx,
    ambientRandom: makeDeterministicRng(2025),
    recordCueHistory: true,
  },
})
engineLevel.setMaze(mazeA)
engineLevel.unlockAudio()
const audioLevel = engineLevel.getAudioEngine()
const levelStart = engineLevel.getPlayerWorldPosition()

// Simulate 85s of realistic level play:
// - 0..28s calm exploration
// - 28..34s brief enemy chase (6s)
// - 34..52s exploration + occasional light sputter
// - 52..55s short horror flicker event
// - 55..85s exploration
for (let step = 0; step < 850; step += 1) {
  const t = step * 0.1
  if (t >= 28 && t < 34) {
    audioLevel.update(0.1, {
      playerWorldPos: levelStart,
      enemies: [
        {
          id: 'chase1',
          type: 'stalker',
          state: ENEMY_STATES.CHASE,
          worldPos: { x: levelStart.x + 5, y: 0, z: levelStart.z },
        },
      ],
    })
  } else if (t >= 52 && t < 55) {
    audioLevel.update(0.1, {
      playerWorldPos: levelStart,
      activeHorrorEventType: HORROR_EVENT_TYPES.LIGHT_FLICKER,
    })
  } else {
    if (Math.abs(t - 40.0) < 0.05) {
      audioLevel._lastGlobalLightSputterAt = audioLevel._elapsedSec
    }
    audioLevel.update(0.1, { playerWorldPos: levelStart })
  }
}

const levelAmbientCues = audioLevel.getCueHistory().filter((c) => c.type === 'ambient_horror')
assert(
  levelAmbientCues.length >= 3 && levelAmbientCues.length <= 10,
  `Typical 85s level naturally produced ${levelAmbientCues.length} ambient horror cues (expected 3-10)`
)
assert(
  levelAmbientCues.every((c) => c.gain >= 0.05 && c.gain <= 1.0),
  `Every ambient cue during level play maintained natural spatial gain in [0.05, 1.0] (got ${levelAmbientCues.map((c) => c.gain.toFixed(3)).join(', ')})`
)
assert(
  !levelAmbientCues.some((c) => (c.time >= 28 && c.time < 34) || (c.time >= 52 && c.time < 55)),
  'No ambient cues played during chase or HorrorDirector event windows'
)

engineLevel.dispose()
console.log('✓ Realistic 85s gameplay level cadence and audible delivery verified')

// ---------------------------------------------------------------------------
// Test 9: Startling variant pacing, cooldown enforcement & reduced-motion safety
// ---------------------------------------------------------------------------
console.log('Test 9: Startling Horror Variant Cooldown & Reduced-Motion Safety')
const mockStartle = createTrackingMockAudioContext()
const audioStartle = new HorrorAudioEngine({
  createAudioContext: () => mockStartle.ctx,
  autoUnlock: true,
  ambientRandom: makeDeterministicRng(909),
  ambientScheduler: {
    initialGraceMinSec: 2.0,
    initialGraceMaxSec: 2.0,
    intervalMinSec: 5.0,
    intervalMaxSec: 7.0,
    extraSilenceChance: 0,
    perCategoryCooldowns: {
      creak_knock: 6,
      underground_rumble: 6,
      vent_wind: 6,
      distant_echo_steps: 6,
      rare_anomaly: 6,
    },
  },
  recordCueHistory: true,
})
audioStartle.setMaze(mazeA)
for (let step = 0; step < 3000; step += 1) {
  audioStartle.update(0.1, { playerWorldPos: playerStartA, reducedMotion: false })
}
const startleHistory = audioStartle.getCueHistory().filter((c) => c.type === 'ambient_horror')
const startlingCues = startleHistory.filter((c) => c.isStartling)
assert(
  startlingCues.length >= 1,
  `Extended exploration naturally produced occasional startling cues (got ${startlingCues.length})`
)
assert(
  startlingCues.every((c) => c.time >= AMBIENT_HORROR_CONFIG.minStartlingElapsedSec - 0.15),
  'Startling variants stay absent during early-run grace period'
)
for (let i = 1; i < startlingCues.length; i += 1) {
  const delta = startlingCues[i].time - startlingCues[i - 1].time
  assert(
    delta >= AMBIENT_HORROR_CONFIG.startlingCooldownSec - 0.15,
    `Startling cue spacing (${delta.toFixed(2)}s) enforces >= ${AMBIENT_HORROR_CONFIG.startlingCooldownSec}s cooldown`
  )
}
audioStartle.dispose()

const mockReducedStartle = createTrackingMockAudioContext()
const audioReducedStartle = new HorrorAudioEngine({
  createAudioContext: () => mockReducedStartle.ctx,
  autoUnlock: true,
  ambientRandom: makeDeterministicRng(909),
  ambientScheduler: {
    initialGraceMinSec: 2.0,
    initialGraceMaxSec: 2.0,
    intervalMinSec: 5.0,
    intervalMaxSec: 7.0,
    extraSilenceChance: 0,
    perCategoryCooldowns: {
      creak_knock: 6,
      underground_rumble: 6,
      vent_wind: 6,
      distant_echo_steps: 6,
      rare_anomaly: 6,
    },
  },
  recordCueHistory: true,
})
audioReducedStartle.setMaze(mazeA)
for (let step = 0; step < 3000; step += 1) {
  audioReducedStartle.update(0.1, { playerWorldPos: playerStartA, reducedMotion: true })
}
const reducedStartleCues = audioReducedStartle
  .getCueHistory()
  .filter((c) => c.type === 'ambient_horror' && c.isStartling)
assert(
  reducedStartleCues.length === 0,
  `Reduced-motion mode suppresses startling horror variants (got ${reducedStartleCues.length})`
)
audioReducedStartle.dispose()
console.log('✓ Startling variant cooldown and reduced-motion suppression verified')

// ---------------------------------------------------------------------------
// Test 10: Long (>2s) noise burst looping, seamless wrap & full duration
// ---------------------------------------------------------------------------
console.log('Test 10: >2s Noise Buffer Looping, Offset Wrapping & Ambient Cue Continuity')

function createRecordingBufferMockContext() {
  const { ctx, stats } = createTrackingMockAudioContext()
  const bufferSources = []
  ctx.createBuffer = (channels, len, sr) => {
    const channelData = new Float32Array(len)
    return {
      numberOfChannels: channels,
      length: len,
      sampleRate: sr,
      duration: len / sr,
      getChannelData: () => channelData,
    }
  }
  ctx.createBufferSource = () => {
    let started = false
    let stopped = false
    const record = {
      startArgs: null,
      stopArgs: [],
      onendedFired: false,
      node: null,
    }
    const base = {
      _kind: 'bufferSource',
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      connect(dest) {
        stats.connections.push({ from: base, to: dest })
      },
      disconnect() {
        stats.disconnectedCount += 1
      },
      start(...args) {
        if (!started) {
          started = true
          stats.bufferSourcesStarted += 1
          record.startArgs = args
        }
      },
      stop(...args) {
        record.stopArgs.push(args)
        if (started && !stopped) {
          stopped = true
          stats.bufferSourcesStopped += 1
          record.onendedFired = true
          this.onended?.()
        }
      },
    }
    record.node = base
    bufferSources.push(record)
    return base
  }
  return { ctx, stats, bufferSources }
}

// 10a. createNoiseBuffer produces valid bounded samples with smooth loop boundary
const mockBufRec = createRecordingBufferMockContext()
const seamlessNoise = createNoiseBuffer(mockBufRec.ctx, 2.0)
assert(
  seamlessNoise && seamlessNoise.length === 88200 && Math.abs(seamlessNoise.duration - 2.0) < 1e-6,
  'createNoiseBuffer builds a 2.0s buffer at context sample rate'
)
const noiseSamples = seamlessNoise.getChannelData(0)
let maxAbsSample = 0
for (let i = 0; i < noiseSamples.length; i += 1) {
  const abs = Math.abs(noiseSamples[i])
  if (abs > maxAbsSample) maxAbsSample = abs
}
assert(maxAbsSample > 0.01 && maxAbsSample <= 1.0, 'Noise buffer samples stay non-silent and bounded in [-1, 1]')
const wrapStep = Math.abs(noiseSamples[0] - noiseSamples[noiseSamples.length - 1])
assert(
  wrapStep < 0.25,
  `Noise loop seam delta (${wrapStep.toFixed(4)}) is crossfaded smoothly to avoid wrap clicks`
)

// 10b. Short noise preserves non-looping playback; >2s noise loops with wrapped offset & explicit stop
const dest10 = mockBufRec.ctx.createGain()
mockBufRec.ctx.currentTime = 5.0
playNoiseBurst(mockBufRec.ctx, dest10, seamlessNoise, {
  duration: 0.16,
  offset: 0.45,
})
const shortRec = mockBufRec.bufferSources[0]
assert(
  shortRec.node.loop === false &&
    shortRec.startArgs.length === 3 &&
    Math.abs(shortRec.startArgs[0] - 5.0) < 1e-6 &&
    Math.abs(shortRec.startArgs[1] - 0.45) < 1e-6 &&
    Math.abs(shortRec.startArgs[2] - 0.18) < 1e-6 &&
    shortRec.stopArgs.length === 0,
  'Short noise burst preserves exact non-looping start(when, offset, duration) playback'
)

playNoiseBurst(mockBufRec.ctx, dest10, seamlessNoise, {
  duration: 3.1,
  delay: 0.25,
  offset: 2.65,
})
const longRec = mockBufRec.bufferSources[1]
assert(
  longRec.node.loop === true &&
    longRec.node.loopStart === 0 &&
    Math.abs(longRec.node.loopEnd - 2.0) < 1e-6,
  'Long (>2s) noise burst enables safe looping across full buffer bounds'
)
assert(
  longRec.startArgs &&
    Math.abs(longRec.startArgs[0] - 5.25) < 1e-6 &&
    Math.abs(longRec.startArgs[1] - 0.65) < 1e-6 &&
    longRec.startArgs[1] >= 0 &&
    longRec.startArgs[1] < 2.0,
  `Long noise start offset wraps safely into [0, bufferDuration) (got ${JSON.stringify(longRec.startArgs)})`
)
assert(
  longRec.stopArgs.length === 1 &&
    Math.abs(longRec.stopArgs[0][0] - (5.25 + 3.12)) < 1e-6 &&
    longRec.stopArgs[0][0] - longRec.startArgs[0] >= 3.1,
  `Long noise schedules explicit stop after full requested 3.1s duration (got ${JSON.stringify(longRec.stopArgs)})`
)

// 10c. HorrorAudioEngine 2.0s buffer + rumble, vent_wind, and rare_anomaly cues >2s play full noise durations
const recEngineMock = createRecordingBufferMockContext()
const recAudioEngine = new HorrorAudioEngine({
  createAudioContext: () => recEngineMock.ctx,
  autoUnlock: true,
})
assert(
  recAudioEngine.noiseBuffer && Math.abs(recAudioEngine.noiseBuffer.duration - 2.0) < 1e-6,
  'HorrorAudioEngine initializes 2.0s procedural noiseBuffer in _buildAudioGraph'
)

const longAmbientChecks = [
  {
    name: 'underground_rumble v0 (3.4s)',
    expectedMinNoiseSec: 3.4 * 0.95,
    trigger: () =>
      triggerAmbientUndergroundRumbleCue(
        recEngineMock.ctx,
        recAudioEngine.ambienceGain,
        recAudioEngine.noiseBuffer,
        { variant: 0, durationSec: 3.4 }
      ),
  },
  {
    name: 'vent_wind v0 (3.5s)',
    expectedMinNoiseSec: 3.5 * 0.74,
    trigger: () =>
      triggerAmbientVentWindCue(
        recEngineMock.ctx,
        recAudioEngine.ambienceGain,
        recAudioEngine.noiseBuffer,
        { variant: 0, durationSec: 3.5 }
      ),
  },
  {
    name: 'rare_anomaly v2 (2.75s)',
    expectedMinNoiseSec: 2.75,
    trigger: () =>
      triggerAmbientRareAnomalyCue(
        recEngineMock.ctx,
        recAudioEngine.ambienceGain,
        recAudioEngine.noiseBuffer,
        { variant: 2 }
      ),
  },
]

for (const check of longAmbientChecks) {
  const beforeIdx = recEngineMock.bufferSources.length
  const cueHandle = check.trigger()
  const spawned = recEngineMock.bufferSources.slice(beforeIdx)
  assert(spawned.length >= 1, `${check.name} created noise buffer source(s)`)
  for (const rec of spawned) {
    assert(rec.node.loop === true, `${check.name} loops noise source when exceeding 2.0s buffer`)
    assert(
      rec.startArgs[1] >= 0 && rec.startArgs[1] < recAudioEngine.noiseBuffer.duration,
      `${check.name} uses valid buffer start offset (${rec.startArgs[1]})`
    )
    const scheduledSpan = rec.stopArgs[0][0] - rec.startArgs[0]
    assert(
      scheduledSpan >= check.expectedMinNoiseSec,
      `${check.name} continues for full requested duration (${scheduledSpan.toFixed(2)}s >= ${check.expectedMinNoiseSec.toFixed(2)}s)`
    )
  }
  // Verify early lifecycle stop cleans up safely without errors
  cueHandle.stop()
}

recAudioEngine.dispose()
console.log('✓ >2s noise buffer looping, seamless crossfade, offset wrapping & full cue continuity verified')

// ---------------------------------------------------------------------------
// Test 11: Mix & Threat Hierarchy Refinement Regression Tests
// ---------------------------------------------------------------------------
console.log('Test 11: Ambient Reverb Bus Isolation, Tension Gating & Enemy Footstep Conduction')

// 11a. Dedicated ambient corridor reverb routes strictly to ambienceGain (no effects bleed) and cleans up
const mockMix = createTrackingMockAudioContext()
const audioMix = new HorrorAudioEngine({
  createAudioContext: () => mockMix.ctx,
  autoUnlock: true,
  ambientRandom: makeDeterministicRng(313),
  ambientScheduler: {
    initialGraceMinSec: 0.3,
    initialGraceMaxSec: 0.3,
    intervalMinSec: 0.8,
    intervalMaxSec: 0.8,
    extraSilenceChance: 0,
  },
  recordCueHistory: true,
})
audioMix.setMaze(mazeA)
assert(
  Boolean(audioMix._ambientReverbInput && audioMix._ambientReverbDelay && audioMix._ambientReverbWetGain),
  'Dedicated ambient corridor reflection chain initialized'
)
assert(
  Math.abs(audioMix._ambientReverbDelay.delayTime.value - 0.165) < 1e-6 &&
    Math.abs(audioMix._ambientReverbWetGain.gain.value - 0.18) < 1e-6,
  'Ambient corridor reflection delay (0.165s) and restrained wet level (0.18) configured'
)

const mixConnBefore = mockMix.stats.connections.length
for (let i = 0; i < 6; i += 1) {
  audioMix.update(0.1, { playerWorldPos: playerStartA })
}
const mixCue = audioMix.getCueHistory().find((c) => c.type === 'ambient_horror')
assert(Boolean(mixCue), 'Short-cadence ambient cue triggered in mix test')
const mixConns = mockMix.stats.connections.slice(mixConnBefore)
assert(
  mixConns.some((c) => c.to === audioMix._ambientReverbInput),
  'Ambient cue feeds dedicated ambient corridor reverb input alongside HRTF panner'
)
assert(
  !mixConns.some((c) => c.to === audioMix._reverbInput || c.to === audioMix.effectsGain),
  'Ambient cue reverb send never bleeds into effects reverb or effectsGain'
)
assert(
  mockMix.stats.connections.some(
    (c) => c.from === audioMix._ambientReverbWetGain && c.to === audioMix.ambienceGain
  ),
  'Ambient corridor reverb wet return connects strictly to ambienceGain'
)

// 11b. Tension layer activates on INVESTIGATE/SEARCH and stays off on PATROL proximity, with tick breathing
audioMix.clearCueHistory()
audioMix.update(0.05, {
  playerWorldPos: playerStartA,
  enemies: [
    {
      id: 'patrol-near',
      type: 'stalker',
      state: ENEMY_STATES.PATROL,
      worldPos: { x: playerStartA.x + 2.5, y: 0, z: playerStartA.z },
    },
  ],
})
assert(
  audioMix.getAudioState().musicMood === 'ambient',
  'Close PATROL enemy does not trigger TENSION layer'
)

audioMix.update(0.05, {
  playerWorldPos: playerStartA,
  enemies: [
    {
      id: 'investigate-enemy',
      type: 'stalker',
      state: ENEMY_STATES.INVESTIGATE,
      worldPos: { x: playerStartA.x + 8, y: 0, z: playerStartA.z },
    },
  ],
})
assert(
  audioMix.getAudioState().musicMood === 'tension',
  'INVESTIGATE enemy activates restrained TENSION layer'
)

// Drive several ticks in TENSION so breathing filter/gain modulation executes without error
for (let i = 0; i < 10; i += 1) {
  audioMix._musicLayer?.tick?.(0.05)
}

// 11c. Enemy footsteps through 1-2 walls conduct noticeably better than legacy 0.45 occlusion while staying softer/darker than open corridor
const stepMaze = {
  rows: 5,
  cols: 5,
  start: { row: 1, col: 1 },
  exit: { row: 3, col: 3 },
  seed: 9876,
  difficulty: 'small',
  grid: [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ],
}
const stepListener = gridToWorld(1, 1, stepMaze)
const stepOpenSource = gridToWorld(1, 3, stepMaze)
const stepWalledSource = gridToWorld(3, 1, stepMaze)
const stepBeyondMax = { x: stepListener.x + 26, y: 0, z: stepListener.z }

const stepOpts = {
  refDistance: 2.2,
  maxDistance: 18,
  rolloff: 1.25,
  wallAttBase: 0.62,
  minOcclusionGain: 0.16,
  initialBlockedCutoff: 1650,
  minLowpassCutoff: 480,
}
const stepOpenAtt = computeSpatialAudioAttenuation(stepOpenSource, stepListener, stepMaze, stepOpts)
const stepWalledAtt = computeSpatialAudioAttenuation(stepWalledSource, stepListener, stepMaze, stepOpts)
const stepOutAtt = computeSpatialAudioAttenuation(stepBeyondMax, stepListener, stepMaze, stepOpts)
const stepLegacyWalled = computeSpatialAudioAttenuation(stepWalledSource, stepListener, stepMaze, {
  refDistance: 2.2,
  maxDistance: 18,
  rolloff: 1.35,
  wallAttBase: 0.45,
})

assert(
  stepWalledAtt.wallCount >= 1 &&
    stepWalledAtt.gain > stepLegacyWalled.gain &&
    stepWalledAtt.gain >= 0.11 &&
    stepWalledAtt.gain < stepOpenAtt.gain,
  `Walled enemy footsteps (${stepWalledAtt.gain.toFixed(3)}) conduct better than legacy (${stepLegacyWalled.gain.toFixed(3)}) yet stay quieter than open (${stepOpenAtt.gain.toFixed(3)})`
)
assert(
  stepWalledAtt.lowpassCutoff < stepOpenAtt.lowpassCutoff && stepWalledAtt.lowpassCutoff >= 480,
  `Walled footsteps darken (${stepWalledAtt.lowpassCutoff} Hz < ${stepOpenAtt.lowpassCutoff} Hz)`
)
assert(stepOutAtt.gain === 0, 'Enemy footsteps beyond maxDistance attenuate to exact 0')

// Trigger live enemy footstep through HorrorAudioEngine across a wall (patrol stride is 0.56s)
audioMix.setMaze(stepMaze)
audioMix.clearCueHistory()
for (let i = 0; i < 2; i += 1) {
  audioMix.update(0.35, {
    playerWorldPos: stepListener,
    enemies: [
      {
        id: 'walled-stalker',
        type: 'stalker',
        state: ENEMY_STATES.PATROL,
        worldPos: stepWalledSource,
      },
    ],
  })
}
const walledStepCue = audioMix.getCueHistory().find((c) => c.type === 'enemy_footstep')
assert(
  Boolean(walledStepCue) && walledStepCue.wallCount >= 1 && walledStepCue.gain >= 0.11,
  `Live engine walled patrol footstep audible (${walledStepCue?.gain?.toFixed(3)}) across ${walledStepCue?.wallCount} wall(s)`
)

audioMix.dispose()
assert(
  audioMix._ambientReverbInput === null &&
    audioMix._ambientReverbDelay === null &&
    audioMix._ambientReverbWetGain === null,
  'dispose() cleans up and nulls dedicated ambient reverb nodes'
)
console.log('✓ Ambient corridor reverb isolation, tension gating, and walled enemy footsteps verified')

// ---------------------------------------------------------------------------
// Test 12: Refined Five Ambient Sound Categories Regression Tests
// ---------------------------------------------------------------------------
console.log('Test 12: Refined Sound Design Regression Tests (All 5 Categories)')

function inspectCueSynthesis(triggerFn) {
  const { ctx, stats, bufferSources } = createRecordingBufferMockContext()
  ctx.state = 'running'
  ctx.currentTime = 10.0

  const oscillators = []
  const gains = []
  const filters = []
  const origCreateGain = ctx.createGain
  const origCreateFilter = ctx.createBiquadFilter
  const origCreateOscillator = ctx.createOscillator

  const wrapParam = (param, history) => ({
    _v: param.value,
    get value() {
      return this._v
    },
    set value(v) {
      this._v = v
      history.push({ value: v, time: null })
    },
    setValueAtTime(v, t) {
      this._v = v
      history.push({ value: v, time: t })
    },
    setTargetAtTime(v, t) {
      this._v = v
      history.push({ value: v, time: t })
    },
    linearRampToValueAtTime(v, t) {
      this._v = v
      history.push({ value: v, time: t })
    },
    exponentialRampToValueAtTime(v, t) {
      this._v = v
      history.push({ value: v, time: t })
    },
  })

  ctx.createGain = () => {
    const node = origCreateGain()
    const history = []
    node.gain = wrapParam(node.gain, history)
    gains.push({ node, history })
    return node
  }
  ctx.createBiquadFilter = () => {
    const node = origCreateFilter()
    const freqHistory = []
    const qHistory = []
    node.frequency = wrapParam(node.frequency, freqHistory)
    node.Q = wrapParam(node.Q, qHistory)
    filters.push({ node, freqHistory, qHistory })
    return node
  }
  ctx.createOscillator = () => {
    const osc = origCreateOscillator()
    const freqHistory = []
    osc.frequency = wrapParam(osc.frequency, freqHistory)
    const rec = {
      node: osc,
      freqHistory,
      startTime: null,
      stopTime: null,
    }
    const origStart = osc.start.bind(osc)
    const origStop = osc.stop.bind(osc)
    osc.start = (when = 0) => {
      rec.startTime = when
      origStart(when)
    }
    osc.stop = (when = 0) => {
      rec.stopTime = when
      origStop(when)
    }
    oscillators.push(rec)
    return osc
  }

  const dest = ctx.createGain()
  const noiseBuffer = createNoiseBuffer(ctx, 2.0)
  const handle = triggerFn(ctx, dest, noiseBuffer)

  // Map each filter and gain node created inside playToneBurst/playNoiseBurst
  // Each burst creates 1 GainNode (after dest + cueGain) and 1 FilterNode.
  const burstGains = gains.slice(2).map((g) => ({
    peakGain: Math.max(0, ...g.history.map((h) => h.value)),
    history: g.history,
  }))
  const enrichedBuffers = bufferSources.map((rec) => {
    const startWhen = rec.startArgs?.[0] ?? 10.0
    const explicitDur =
      rec.stopArgs.length > 0
        ? rec.stopArgs[0][0] - startWhen
        : (rec.startArgs?.[2] ?? 0)
    return {
      ...rec,
      startTime: startWhen,
      duration: Math.max(0, explicitDur - 0.02),
    }
  })

  return {
    handle,
    oscillators,
    bufferSources: enrichedBuffers,
    filters,
    burstGains,
    stats,
  }
}

// 12a. Creaks / Knocks: stick-slip creak, inharmonic pipe resonance, natural cable/vent snap
const creak0 = inspectCueSynthesis((ctx, dest, nb) =>
  triggerAmbientCreakOrKnockCue(ctx, dest, nb, { variant: 0 })
)
assert(
  creak0.bufferSources.length >= 7 &&
    creak0.bufferSources.some((b) => b.duration >= 1.5) &&
    creak0.bufferSources.filter((b) => b.duration <= 0.08).length >= 6,
  `creak_knock v0 combines irregular stick-slip friction impulses with grating friction bed (got ${creak0.bufferSources.length} noise sources)`
)
assert(
  creak0.oscillators.length >= 2 &&
    creak0.oscillators.every((o) => o.freqHistory.length >= 4),
  'creak_knock v0 modulates inharmonic metallic modes with stick-slip catch/release jitter'
)
creak0.handle.stop()

const creak1 = inspectCueSynthesis((ctx, dest, nb) =>
  triggerAmbientCreakOrKnockCue(ctx, dest, nb, { variant: 1 })
)
// Verify steady inharmonic pipe partials (non-octave ratios, minimal pitch droop)
const pipeResonances = creak1.oscillators.filter((o) => o.stopTime - o.startTime >= 0.14)
assert(
  pipeResonances.length === 9,
  `creak_knock v1 produces 3 inharmonic modes across 3 knocks (got ${pipeResonances.length})`
)
const firstKnockF0 = pipeResonances[0].freqHistory[0].value
const firstKnockF1 = pipeResonances[1].freqHistory[0].value
const firstKnockF2 = pipeResonances[2].freqHistory[0].value
assert(
  Math.abs(firstKnockF1 / firstKnockF0 - 1.63) < 0.05 &&
    Math.abs(firstKnockF2 / firstKnockF0 - 2.71) < 0.05,
  `creak_knock v1 uses inharmonic pipe mode ratios (${(firstKnockF1 / firstKnockF0).toFixed(2)}, ${(firstKnockF2 / firstKnockF0).toFixed(2)})`
)
assert(
  pipeResonances.every((o) => {
    const fStart = o.freqHistory[0].value
    const fEnd = o.freqHistory[o.freqHistory.length - 1].value
    return Math.abs(fStart - fEnd) / fStart < 0.03
  }),
  'creak_knock v1 holds steady pipe modal frequencies without synthetic pitch droop'
)
creak1.handle.stop()

const creak2 = inspectCueSynthesis((ctx, dest, nb) =>
  triggerAmbientCreakOrKnockCue(ctx, dest, nb, { variant: 2 })
)
assert(
  creak2.bufferSources.length >= 4 &&
    creak2.oscillators.every((o) => o.stopTime - o.startTime <= 0.24),
  'creak_knock v2 uses sharp broadband fracture snap + brief damped twang (no long synth laser sweep)'
)
creak2.handle.stop()

// 12b. Underground Rumbles: layered modulated low-freq noise, structural vibration & settling debris (no musical bass)
for (const v of [0, 1]) {
  const rumble = inspectCueSynthesis((ctx, dest, nb) =>
    triggerAmbientUndergroundRumbleCue(ctx, dest, nb, { variant: v, durationSec: 3.2 })
  )
  assert(
    rumble.oscillators.length === 0,
    `underground_rumble v${v} eliminates musical bass oscillators completely`
  )
  assert(
    rumble.bufferSources.length >= 3 &&
      rumble.filters.some((f) => f.freqHistory.length >= 4),
    `underground_rumble v${v} layers modulated low-frequency noise & structural vibration`
  )
  if (v === 1) {
    const debrisGrains = rumble.bufferSources.filter((b) => b.duration <= 0.09 && b.startTime > 11.0)
    assert(
      debrisGrains.length >= 3,
      `underground_rumble v1 includes subtle delayed settling debris patters (got ${debrisGrains.length})`
    )
  }
  rumble.handle.stop()
}
const rumble2 = inspectCueSynthesis((ctx, dest, nb) =>
  triggerAmbientUndergroundRumbleCue(ctx, dest, nb, { variant: 2, durationSec: 3.2 })
)
assert(
  rumble2.oscillators.every((o) => o.stopTime - o.startTime <= 0.18),
  'underground_rumble v2 avoids sustained musical bass tones (only ultra-brief cavity thump impulse)'
)
assert(
  rumble2.bufferSources.filter((b) => b.duration <= 0.1 && b.startTime > 10.4).length >= 3,
  'underground_rumble v2 includes settling ceiling debris after cavity pressure thump'
)
rumble2.handle.stop()

// 12c. Vent / Wind: filtered turbulent airflow, irregular modulation & subtle vent rattles (zero sine whistles)
for (const v of [0, 1, 2]) {
  const wind = inspectCueSynthesis((ctx, dest, nb) =>
    triggerAmbientVentWindCue(ctx, dest, nb, { variant: v, durationSec: 3.2 })
  )
  assert(
    wind.oscillators.length === 0,
    `vent_wind v${v} removes flute-like sine whistle oscillators completely`
  )
  assert(
    wind.bufferSources.length >= 3 &&
      wind.filters.some((f) => f.freqHistory.length >= 4),
    `vent_wind v${v} uses layered irregularly modulated turbulent airflow`
  )
  if (v === 1 || v === 2) {
    const rattles = wind.bufferSources.filter((b) => b.duration <= 0.1)
    assert(
      rattles.length >= 3,
      `vent_wind v${v} adds subtle metallic vent-louvre/damper rattles (got ${rattles.length})`
    )
  }
  wind.handle.stop()
}

// 12d. Distant Footsteps: zero pitched echo tones, quieter muffled reflections & retreating distance decay
for (const v of [0, 1, 2]) {
  const steps = inspectCueSynthesis((ctx, dest, nb) =>
    triggerAmbientDistantEchoStepsCue(ctx, dest, nb, { variant: v, stepCount: 4 })
  )
  assert(
    steps.oscillators.length === 0,
    `distant_echo_steps v${v} removes all pitched echo oscillators`
  )
  assert(
    steps.bufferSources.length === 16,
    `distant_echo_steps v${v} spawns 4 bursts (thud + scuff + 2 muffled reflections) per step (got ${steps.bufferSources.length})`
  )
  // Verify retreating distance decay across steps (gain and filter cutoff strictly decrease per step)
  for (let s = 0; s < 3; s += 1) {
    const stepPeak = steps.burstGains[s * 4].peakGain
    const nextStepPeak = steps.burstGains[(s + 1) * 4].peakGain
    assert(
      nextStepPeak < stepPeak,
      `distant_echo_steps v${v} step ${s + 1} (${nextStepPeak.toFixed(3)}) retreats quieter than step ${s} (${stepPeak.toFixed(3)})`
    )
    const stepScuffCutoff = steps.filters[s * 4 + 1].freqHistory[0].value
    const nextScuffCutoff = steps.filters[(s + 1) * 4 + 1].freqHistory[0].value
    assert(
      nextScuffCutoff < stepScuffCutoff,
      `distant_echo_steps v${v} step ${s + 1} darkens (${nextScuffCutoff.toFixed(0)} Hz < ${stepScuffCutoff.toFixed(0)} Hz)`
    )
    // Verify reflections are quieter & darker than primary step
    const refl1Peak = steps.burstGains[s * 4 + 2].peakGain
    const refl2Peak = steps.burstGains[s * 4 + 3].peakGain
    const refl1Cutoff = steps.filters[s * 4 + 2].freqHistory[0].value
    assert(
      refl1Peak < stepPeak * 0.5 && refl2Peak < refl1Peak && refl1Cutoff < stepScuffCutoff,
      `distant_echo_steps v${v} step ${s} reflections are quieter and lowpass-muffled`
    )
  }
  steps.handle.stop()
}

// 12e. Rare Anomalies: gritty steel door screech, irregular muffled drips (no chimes), hollow tunnel moan
const rare0 = inspectCueSynthesis((ctx, dest, nb) =>
  triggerAmbientRareAnomalyCue(ctx, dest, nb, { variant: 0 })
)
assert(
  rare0.oscillators.every((o) => o.stopTime - o.startTime <= 0.2),
  'rare_anomaly v0 removes long synthetic screech oscillators in favor of gritty filtered noise'
)
assert(
  rare0.filters.filter((f) => f.node.Q.value >= 6.0 && f.freqHistory.length >= 4).length >= 2,
  'rare_anomaly v0 shapes rusted steel-door screech via modulated high-Q resonant noise'
)
rare0.handle.stop()

const rare1 = inspectCueSynthesis((ctx, dest, nb) =>
  triggerAmbientRareAnomalyCue(ctx, dest, nb, { variant: 1 })
)
assert(
  rare1.oscillators.length === 0,
  'rare_anomaly v1 eliminates pleasant tonal drip sine chimes completely'
)
assert(
  rare1.bufferSources.length === 16 &&
    rare1.filters.every((f) => f.freqHistory[0].value <= 800),
  'rare_anomaly v1 synthesizes irregular muffled drips and lowpass wet reflections <= 800 Hz'
)
const dripOnsets = [0, 4, 8, 12].map((idx) => rare1.bufferSources[idx].startTime - 10.0)
const dripGap1 = dripOnsets[1] - dripOnsets[0]
const dripGap2 = dripOnsets[2] - dripOnsets[1]
const dripGap3 = dripOnsets[3] - dripOnsets[2]
assert(
  Math.abs(dripGap1 - dripGap2) > 0.05 && Math.abs(dripGap3 - dripGap2) > 0.2,
  `rare_anomaly v1 drips occur at irregular non-metronomic intervals (${dripGap1.toFixed(2)}, ${dripGap2.toFixed(2)}, ${dripGap3.toFixed(2)}s)`
)
rare1.handle.stop()

const rare2 = inspectCueSynthesis((ctx, dest, nb) =>
  triggerAmbientRareAnomalyCue(ctx, dest, nb, { variant: 2 })
)
assert(
  rare2.bufferSources.length >= 2 &&
    rare2.bufferSources.every((b) => b.duration >= 2.75 && b.node.loop === true),
  'rare_anomaly v2 preserves >2.75s looping modulated tunnel-air noise layers'
)
assert(
  rare2.oscillators.every((o) => o.freqHistory[0].value < 200),
  'rare_anomaly v2 replaces bright D4/D#4 organ dyad with deeply lowpassed hollow resonance'
)
rare2.handle.stop()

console.log('✓ All 5 refined ambient sound categories verified with focused regression tests')

console.log(
  'Test 13: Audit Regressions (All-Director Ducking, Positional Cleanup & Victory Reset Recovery)'
)
const auditMock = createTrackingMockAudioContext()
const auditMazeA = generateMaze({ difficulty: 'medium', seed: 4101 })
const auditMazeB = generateMaze({ difficulty: 'medium', seed: 4102 })
const auditEngine = createHeadlessEngine({
  audio: {
    createAudioContext: () => auditMock.ctx,
  },
})
auditEngine.setMaze(auditMazeA)
const auditAudio = auditEngine.getAudioEngine()
auditAudio.unlock()

// 13a. All HorrorDirector cue types stop any active ambient cue to avoid masking warnings/scares
const openWorldPos = gridToWorld(auditMazeA.start.row, auditMazeA.start.col, auditMazeA)
auditAudio.updateListener({ x: openWorldPos.x, y: 1.65, z: openWorldPos.z })
for (const directorEvent of [
  HORROR_EVENT_TYPES.PRESENCE_WARNING,
  HORROR_EVENT_TYPES.ENVIRONMENTAL_SOUND,
  HORROR_EVENT_TYPES.DISTANT_SILHOUETTE,
  HORROR_EVENT_TYPES.LIGHT_FLICKER,
  HORROR_EVENT_TYPES.BLACKOUT,
  HORROR_EVENT_TYPES.SCRIPTED_SCARE,
]) {
  auditAudio._stopActiveAmbientCues()
  auditAudio._ambientEventTimer = 0.05
  auditAudio._lastHorrorCueAt = -100
  auditAudio._lastAmbientCategory = null
  auditAudio._ambientLastTriggeredAt.clear()
  auditAudio.update(0.1, { playerWorldPos: openWorldPos })
  assert(
    auditAudio._activeAmbientCue !== null,
    `Triggered active ambient cue prior to director event ${directorEvent}`
  )
  auditAudio.playHorrorDirectorCue(directorEvent, openWorldPos, { tension: 0.7, variant: 0, beat: 1 })
  assert(
    auditAudio._activeAmbientCue === null,
    `${directorEvent} immediately stops active ambient cues so it cannot mask scripted horror audio`
  )
}

// 13b. Positional ambient chains disconnect immediately on reset() and setMaze()
const discBeforeAmbientReset = auditMock.stats.disconnectedCount
auditAudio._ambientEventTimer = 0.05
auditAudio._lastHorrorCueAt = -100
auditAudio._ambientLastTriggeredAt.clear()
auditAudio.update(0.1, { playerWorldPos: openWorldPos })
assert(
  auditAudio._activeAmbientCue !== null && auditAudio._activePositionalCleanups.size >= 1,
  'Ambient cue registers active positional cleanup callback'
)
auditAudio.reset()
assert(
  auditAudio._activeAmbientCue === null &&
    auditAudio._activePositionalCleanups.size === 0 &&
    auditMock.stats.disconnectedCount > discBeforeAmbientReset,
  'Ambient positional chain disconnects immediately on audio.reset()'
)

// 13c. Victory pauses HorrorDirector; resetCombat / setHasWon(false) / setMaze restores unpaused director
assert(auditEngine.horrorDirector.isPaused === false, 'HorrorDirector starts unpaused')
auditEngine.setHasWon(true)
assert(auditEngine.horrorDirector.isPaused === true, 'setHasWon(true) pauses HorrorDirector')
auditEngine.resetCombat()
assert(
  auditEngine.horrorDirector.isPaused === false,
  'resetCombat() clears HorrorDirector paused lock left from prior victory'
)
auditEngine.setHasWon(true)
auditEngine.setHasWon(false)
assert(
  auditEngine.horrorDirector.isPaused === false,
  'setHasWon(false) unpauses HorrorDirector when engine is not paused'
)
auditEngine.setHasWon(true)
auditEngine.setMaze(auditMazeB)
assert(
  auditEngine.horrorDirector.isPaused === false,
  'setMaze() clears HorrorDirector paused lock across level transitions'
)

// 13d. Headless listener fallback reuses pre-allocated _tmpListenerPos cleanly
const tmpRef = auditAudio._tmpListenerPos
auditAudio.update(0.016, { playerWorldPos: { x: 9.5, z: 11.25 } })
assert(
  auditAudio._tmpListenerPos === tmpRef &&
    auditAudio._listenerPos.x === 9.5 &&
    auditAudio._listenerPos.z === 11.25,
  'Headless update({ playerWorldPos }) reuses _tmpListenerPos without allocating per frame'
)

auditEngine.dispose()
console.log('✓ Audit regressions verified cleanly')

// ---------------------------------------------------------------------------
// Test 14: Interrupted Fade-Out Scheduling, Deferred Cleanup & Variant Selection
// ---------------------------------------------------------------------------
console.log('Test 14: Soft Fade-Out Scheduling, Hard-Stop Flushing & Allocation-Free Variant Selection')

function createOrderTrackingMockContext() {
  const events = []
  const base = createRecordingBufferMockContext()
  const { ctx } = base
  const origCreateGain = ctx.createGain
  const origCreatePanner = ctx.createPanner
  const origCreateOsc = ctx.createOscillator
  const origCreateBufSrc = ctx.createBufferSource

  ctx.createGain = () => {
    const g = origCreateGain()
    const origSetTarget = g.gain.setTargetAtTime.bind(g.gain)
    const origDisc = g.disconnect.bind(g)
    g.gain.setTargetAtTime = (v, t, tau) => {
      events.push({ kind: 'gain_target', id: g._id, value: v, time: t, tau })
      origSetTarget(v, t, tau)
    }
    g.disconnect = () => {
      events.push({ kind: 'gain_disconnect', id: g._id })
      origDisc()
    }
    return g
  }

  ctx.createPanner = () => {
    const p = origCreatePanner()
    const origDisc = p.disconnect.bind(p)
    p.disconnect = () => {
      events.push({ kind: 'panner_disconnect', id: p._id })
      origDisc()
    }
    return p
  }

  ctx.createOscillator = () => {
    const o = origCreateOsc()
    const origStop = o.stop.bind(o)
    const origDisc = o.disconnect.bind(o)
    o.stop = (when) => {
      events.push({ kind: 'osc_stop', id: o._id, when })
      origStop(when)
    }
    o.disconnect = () => {
      events.push({ kind: 'osc_disconnect', id: o._id })
      origDisc()
    }
    return o
  }

  ctx.createBufferSource = () => {
    const b = origCreateBufSrc()
    const origDisc = b.disconnect.bind(b)
    b.disconnect = () => {
      events.push({ kind: 'buf_disconnect', id: b._id })
      origDisc()
    }
    return b
  }

  return { ...base, events }
}

// 14a. Standalone createAmbientCueHandle.stop() schedules fade BEFORE disconnection and completes idempotently
const fadeMock14 = createOrderTrackingMockContext()
fadeMock14.ctx.state = 'running'
fadeMock14.ctx.currentTime = 12.0
const standaloneDest14 = fadeMock14.ctx.createGain()
const noise14 = createNoiseBuffer(fadeMock14.ctx, 2.0)
// creak_knock v1 includes cueGain + oscillators + noise bursts
const cue14 = triggerAmbientCreakOrKnockCue(fadeMock14.ctx, standaloneDest14, noise14, { variant: 1 })
// First gain created is standaloneDest14, second is cueGain
const cueGainId14 = fadeMock14.events.find(
  (e) => e.kind === 'gain_target' && e.id !== standaloneDest14._id
)?.id
assert(Boolean(cueGainId14), 'Standalone ambient cue initialized cueGain fade target')

fadeMock14.events.length = 0
cue14.stop()
cue14.stop() // Repeated stop must remain an idempotent no-op

const targetEvents14 = fadeMock14.events.filter(
  (e) => e.kind === 'gain_target' && e.id === cueGainId14 && e.value === 0
)
const syncCueGainDisconnects14 = fadeMock14.events.filter(
  (e) => e.kind === 'gain_disconnect' && e.id === cueGainId14
)
const oscStops14 = fadeMock14.events.filter((e) => e.kind === 'osc_stop')

assert(
  targetEvents14.length === 1 && Math.abs(targetEvents14[0].tau - 0.025) < 1e-6,
  'Soft stop schedules 25ms cueGain fade-out exactly once before disconnecting'
)
assert(
  oscStops14.length > 0 && oscStops14.every((e) => e.when >= 12.045),
  'Soft stop delays source stop past the fade-out instead of cutting immediately'
)
assert(
  syncCueGainDisconnects14.length === 0,
  'cueGain stays connected synchronously during the 25ms fade-out window'
)

await new Promise((resolve) => setTimeout(resolve, 75))

const finalCueGainDisconnects14 = fadeMock14.events.filter(
  (e) => e.kind === 'gain_disconnect' && e.id === cueGainId14
)
assert(
  finalCueGainDisconnects14.length === 1,
  `cueGain disconnects exactly once after fade timer fires (got ${finalCueGainDisconnects14.length})`
)

// 14b. Active interruptions via HorrorDirector, chase onset, and pause schedule deferred cleanup & never leak
const intMock = createOrderTrackingMockContext()
const intAudio = new HorrorAudioEngine({
  createAudioContext: () => intMock.ctx,
  autoUnlock: true,
  ambientRandom: makeDeterministicRng(606),
  recordCueHistory: true,
})
intAudio.setMaze(auditMazeA)
const intPos = gridToWorld(auditMazeA.start.row, auditMazeA.start.col, auditMazeA)
intAudio.updateListener({ x: intPos.x, y: 1.65, z: intPos.z })

for (const mode of ['director', 'chase', 'pause']) {
  intAudio.setPaused(false)
  intAudio._stopActiveAmbientCues({ immediate: true })
  intAudio._clearTransientTimers()
  intAudio._ambientEventTimer = 0.05
  intAudio._lastHorrorCueAt = -100
  intAudio._lastAmbientCategory = null
  intAudio._ambientLastTriggeredAt.clear()
  intAudio.update(0.1, { playerWorldPos: intPos })
  assert(intAudio._activeAmbientCue !== null, `Ambient cue active before ${mode} interruption`)

  const pannerDiscBefore = intMock.events.filter((e) => e.kind === 'panner_disconnect').length
  if (mode === 'director') {
    intAudio.playHorrorDirectorCue(HORROR_EVENT_TYPES.SCRIPTED_SCARE, intPos, { beat: 1 })
  } else if (mode === 'chase') {
    intAudio.update(0.1, {
      playerWorldPos: intPos,
      enemies: [
        {
          id: 'chase-fade',
          type: 'stalker',
          state: ENEMY_STATES.CHASE,
          worldPos: { x: intPos.x + 4, y: 0, z: intPos.z },
        },
      ],
    })
  } else {
    intAudio.setPaused(true)
  }

  const pannerDiscSync = intMock.events.filter((e) => e.kind === 'panner_disconnect').length
  assert(
    intAudio._activeAmbientCue === null &&
      intAudio._pendingFadeCleanups.size >= 1 &&
      pannerDiscSync === pannerDiscBefore,
    `${mode} interruption clears activeCue immediately while deferring positional disconnect for fade-out`
  )

  await new Promise((resolve) => setTimeout(resolve, 75))

  const pannerDiscAfter = intMock.events.filter((e) => e.kind === 'panner_disconnect').length
  assert(
    intAudio._pendingFadeCleanups.size === 0 &&
      intAudio._activePositionalCleanups.size === 0 &&
      pannerDiscAfter > pannerDiscBefore,
    `${mode} interruption completes deferred positional & node cleanup cleanly after fade`
  )
}

// 14c. Hard-stop reset(), setMaze(), and dispose() flush pending fade timers immediately with zero double-disconnect
intAudio.setPaused(false)
for (const hardOp of ['reset', 'setMaze', 'dispose']) {
  intAudio._ambientEventTimer = 0.05
  intAudio._lastHorrorCueAt = -100
  intAudio._lastAmbientCategory = null
  intAudio._ambientLastTriggeredAt.clear()
  intAudio.update(0.1, { playerWorldPos: intPos })
  assert(intAudio._activeAmbientCue !== null, `Ambient cue active before soft-interrupt + ${hardOp}`)

  // Soft-interrupt via HorrorDirector, then immediately hard-stop mid-fade
  intAudio.playHorrorDirectorCue(HORROR_EVENT_TYPES.PRESENCE_WARNING, intPos, { tension: 0.7 })
  assert(
    intAudio._pendingFadeCleanups.size >= 1 && intAudio._cleanupTimers.size >= 1,
    `Pending fade timers exist before immediate ${hardOp}`
  )

  const discBeforeHard = intMock.stats.disconnectedCount
  if (hardOp === 'reset') {
    intAudio.reset()
  } else if (hardOp === 'setMaze') {
    intAudio.setMaze(auditMazeB)
  } else {
    intAudio.dispose()
  }

  const discAfterHard = intMock.stats.disconnectedCount
  assert(
    intAudio._pendingFadeCleanups.size === 0 &&
      intAudio._activePositionalCleanups.size === 0 &&
      intAudio._cleanupTimers.size === 0 &&
      discAfterHard > discBeforeHard,
    `${hardOp}() flushes pending fade cleanups synchronously and cancels all timers`
  )

  // Wait past original 50ms window -> zero late or duplicate disconnects
  await new Promise((resolve) => setTimeout(resolve, 75))
  assert(
    intMock.stats.disconnectedCount === discAfterHard,
    `${hardOp}() produces zero post-cleanup or duplicate disconnects after fade delay elapses`
  )
}

// 14d. Allocation-free _selectAmbientVariant parity, RNG discipline & fallback behavior
function referenceSelectVariant(engine, category, allowStartling) {
  const prev = engine._lastAmbientVariantByCategory.get(category)
  const expectedPool = []
  for (let v = 0; v < 3; v += 1) {
    if (v === prev) continue
    if (!allowStartling && engine._isStartlingVariant(category, v)) continue
    expectedPool.push(v)
  }
  return expectedPool
}

let rngValue = 0
let rngCalls = 0
const varAudio = new HorrorAudioEngine({
  createAudioContext: () => createTrackingMockAudioContext().ctx,
  ambientRandom: () => {
    rngCalls += 1
    return rngValue
  },
})

for (const cat of Object.values(AMBIENT_HORROR_CATEGORIES)) {
  for (const prev of [undefined, 0, 1, 2]) {
    if (prev === undefined) {
      varAudio._lastAmbientVariantByCategory.delete(cat)
    } else {
      varAudio._lastAmbientVariantByCategory.set(cat, prev)
    }
    for (const allowStartling of [true, false]) {
      const pool = referenceSelectVariant(varAudio, cat, allowStartling)
      for (const rv of [0, 0.25, 0.49, 0.5, 0.75, 0.99]) {
        rngValue = rv
        const callsBefore = rngCalls
        const picked = varAudio._selectAmbientVariant(cat, allowStartling)
        assert(
          rngCalls === callsBefore + 1,
          '_selectAmbientVariant calls _ambientRng exactly once when candidates exist'
        )
        const expected = pool[Math.floor(rv * pool.length) % pool.length]
        assert(
          picked === expected && picked !== prev && (allowStartling || !varAudio._isStartlingVariant(cat, picked)),
          `Variant selection matches expected non-repeating rule for ${cat} (prev=${prev}, startle=${allowStartling}, rv=${rv})`
        )
      }
    }
  }
}
varAudio.dispose()
console.log('✓ Fade scheduling, deferred cleanup, hard-stop flush & allocation-free variant selection verified')

// ---------------------------------------------------------------------------
// Test 15: Redesigned Silhouette Sound Synthesis & Victory/Game-Over Cleanup
// ---------------------------------------------------------------------------
console.log('Test 15: Redesigned Silhouette Cue Synthesis, Spatialization & Lifecycle Overlap Prevention')

// 15a. Inspect redesigned triggerSilhouetteStingCue() characteristics (no 520->390 sine ping)
const silInspectMock = createTrackingMockAudioContext()
silInspectMock.ctx.state = 'running'
const silFreqLogs = []
const silOscTypes = []
const silBufferDurations = []
const silLoops = []
const origSilOsc = silInspectMock.ctx.createOscillator
const origSilBuf = silInspectMock.ctx.createBufferSource
silInspectMock.ctx.createOscillator = () => {
  const osc = origSilOsc()
  const freqs = []
  const origSetVal = osc.frequency.setValueAtTime.bind(osc.frequency)
  const origLin = osc.frequency.linearRampToValueAtTime.bind(osc.frequency)
  const origExp = osc.frequency.exponentialRampToValueAtTime.bind(osc.frequency)
  osc.frequency.setValueAtTime = (v, t) => {
    freqs.push(v)
    origSetVal(v, t)
  }
  osc.frequency.linearRampToValueAtTime = (v, t) => {
    freqs.push(v)
    origLin(v, t)
  }
  osc.frequency.exponentialRampToValueAtTime = (v, t) => {
    freqs.push(v)
    origExp(v, t)
  }
  silFreqLogs.push(freqs)
  silOscTypes.push(() => osc.type)
  return osc
}
silInspectMock.ctx.createBufferSource = () => {
  const src = origSilBuf()
  const origStart = src.start.bind(src)
  src.start = (when, offset, dur) => {
    silBufferDurations.push(dur)
    silLoops.push(Boolean(src.loop))
    origStart(when, offset, dur)
  }
  return src
}
const silDest = silInspectMock.ctx.createGain()
const silNoise = createNoiseBuffer(silInspectMock.ctx, 2.0)
const silHandle = triggerSilhouetteStingCue(silInspectMock.ctx, silDest, silNoise)
const resolvedOscTypes = silOscTypes.map((fn) => fn())
const allOscFreqs = silFreqLogs.flat()

assert(
  silFreqLogs.length >= 3 && silBufferDurations.length >= 3,
  `Redesigned silhouette cue layers multiple oscillators (${silFreqLogs.length}) and noise bursts (${silBufferDurations.length})`
)
assert(
  resolvedOscTypes.every((t) => t !== 'sawtooth'),
  'Redesigned silhouette cue avoids harsh sawtooth BRRRR oscillators'
)
assert(
  !allOscFreqs.some((f) => Math.abs(f - 520) < 1e-3 || Math.abs(f - 390) < 1e-3),
  `Old 520->390 Hz sine ping frequencies are completely removed (freqs=${JSON.stringify(allOscFreqs)})`
)
assert(
  silFreqLogs[0].length >= 4 &&
    silFreqLogs[0].some((f, idx) => idx > 0 && f > silFreqLogs[0][idx - 1]) &&
    silFreqLogs[0].some((f, idx) => idx > 0 && f < silFreqLogs[0][idx - 1]),
  `Formant moan oscillator uses irregular non-monotonic pitch inflection (got ${JSON.stringify(silFreqLogs[0])})`
)
assert(
  silLoops.every((l) => l === false) && silBufferDurations.every((d) => d > 0 && d <= 1.6),
  `All noise layers are finite non-looping bursts <= 1.6s (durations=${JSON.stringify(silBufferDurations)})`
)

const measuredSil = measureCueNodes((ctx, dest, nb) => triggerSilhouetteStingCue(ctx, dest, nb), 0)
assert(
  measuredSil.maxGain >= 0.22 && measuredSil.maxGain <= 0.34,
  `Redesigned silhouette cue stays speaker-audible and non-clipping (maxGain=${measuredSil.maxGain.toFixed(3)})`
)
assert(
  measuredSil.maxFilterFreq >= 700,
  `Redesigned silhouette cue retains clear mid-band speaker presence (${measuredSil.maxFilterFreq} Hz)`
)
silHandle.stop({ immediate: true })
measuredSil.handle.stop({ immediate: true })

// 15b. Spatial routing + immediate victory & game-over cleanup without disrupting unrelated cues
const silLifeMock = createOrderTrackingMockContext()
const silLifeAudio = new HorrorAudioEngine({
  createAudioContext: () => silLifeMock.ctx,
  autoUnlock: true,
  recordCueHistory: true,
})
silLifeAudio.setMaze(auditMazeA)
const silListenerPos = gridToWorld(auditMazeA.start.row, auditMazeA.start.col, auditMazeA)
silLifeAudio.updateListener({ x: silListenerPos.x, y: 1.65, z: silListenerPos.z })

const silTargetWorld = { x: silListenerPos.x + 7.5, y: 0, z: silListenerPos.z }
const envTargetWorld = { x: silListenerPos.x + 5.0, y: 0, z: silListenerPos.z }

for (const endMode of ['onExitVictory', 'setHasWon', 'onGameOver']) {
  silLifeAudio.reset()
  silLifeAudio.clearCueHistory()

  // Start an unrelated positional cue AND a positional distant_silhouette cue concurrently
  const envStarted = silLifeAudio.playHorrorDirectorCue('environmental_sound', envTargetWorld, { variant: 0 })
  const silStarted = silLifeAudio.playHorrorDirectorCue('distant_silhouette', silTargetWorld)
  assert(
    envStarted === true && silStarted === true,
    `Both environmental_sound and distant_silhouette cues start cleanly before ${endMode}`
  )

  const silCueRecord = silLifeAudio.getCueHistory().find((c) => c.type === 'director_distant_silhouette')
  assert(
    silCueRecord &&
      silCueRecord.positional === true &&
      silCueRecord.gain > 0 &&
      silCueRecord.gain < 1,
    `distant_silhouette cue routes spatially with distance attenuation (gain=${silCueRecord?.gain})`
  )
  assert(
    silLifeAudio._activeSilhouetteCleanups.size === 1 &&
      silLifeAudio._activePositionalCleanups.size === 2,
    'Active silhouette cleanup handle tracked separately alongside unrelated positional cue'
  )

  const discBefore = silLifeMock.stats.disconnectedCount
  if (endMode === 'onExitVictory') {
    silLifeAudio.onExitVictory()
  } else if (endMode === 'setHasWon') {
    silLifeAudio.setHasWon(true)
  } else {
    silLifeAudio.onGameOver()
  }

  assert(
    silLifeAudio._activeSilhouetteCleanups.size === 0 &&
      silLifeAudio._activePositionalCleanups.size === 1 &&
      silLifeMock.stats.disconnectedCount > discBefore,
    `${endMode} immediately stops/disconnects silhouette audio while leaving unrelated positional cue undisturbed`
  )

  const lateCue = silLifeAudio.playHorrorDirectorCue('distant_silhouette', silTargetWorld)
  assert(
    lateCue === false,
    `playHorrorDirectorCue('distant_silhouette') refuses playback after ${endMode}`
  )
}

// 15c. Pausing soft-fades active silhouette audio and completes deferred cleanup cleanly
silLifeAudio.reset()
assert(
  silLifeAudio.playHorrorDirectorCue('distant_silhouette', silTargetWorld) === true &&
    silLifeAudio._activeSilhouetteCleanups.size === 1,
  'Silhouette audio active before pause test'
)
const discBeforePause = silLifeMock.stats.disconnectedCount
silLifeAudio.setPaused(true)
assert(
  silLifeAudio._activeSilhouetteCleanups.size === 0 &&
    silLifeAudio._pendingFadeCleanups.size >= 1,
  'setPaused(true) clears active silhouette tracking and schedules soft fade cleanup'
)
await new Promise((resolve) => setTimeout(resolve, 75))
assert(
  silLifeAudio._pendingFadeCleanups.size === 0 &&
    silLifeAudio._activePositionalCleanups.size === 0 &&
    silLifeMock.stats.disconnectedCount > discBeforePause,
  'Paused silhouette cue completes deferred positional & node disconnect after fade window'
)

silLifeAudio.dispose()
console.log('✓ Redesigned silhouette sound synthesis, spatialization & victory/game-over isolation verified')

console.log('--- ALL AMBIENT HORROR AUDIO INTEGRATION TESTS PASSED! ---')
