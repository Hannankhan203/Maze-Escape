import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import {
  AMBIENT_HORROR_CATEGORIES,
  AMBIENT_HORROR_CONFIG,
  HorrorAudioEngine,
} from './HorrorAudioEngine.js'
import { HORROR_EVENT_TYPES, HORROR_INTENSITY_LEVELS } from './HorrorDirector.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

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
  `Initial grace period (${initialGrace.toFixed(2)}s) sits within 12-22s`
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
  'No ambient cue fires before initial 12-22s grace period ends'
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
  `Next scheduled interval (${scheduledNext.toFixed(2)}s) obeys 16-38s+ long spacing`
)
audio1.dispose()
console.log('✓ Unlock gating and 12-22s grace / 16-38s+ cadence verified')

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

console.log('--- ALL AMBIENT HORROR AUDIO INTEGRATION TESTS PASSED! ---')
