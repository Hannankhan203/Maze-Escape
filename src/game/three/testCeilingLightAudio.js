import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import { HORROR_EVENT_TYPES, HORROR_INTENSITY_LEVELS } from './HorrorDirector.js'
import { CEILING_LIGHT_AUDIO_CONFIG } from './HorrorAudioEngine.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { CEILING_LIGHT_STATES } from './buildCeilingLights.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createMockAudioContext() {
  const stats = {
    createdCount: 0,
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

  function makeBaseNode(extra = {}) {
    return {
      connect() {},
      disconnect() {
        stats.disconnectedCount += 1
      },
      ...extra,
    }
  }

  const ctx = {
    state: 'suspended',
    currentTime: 1.0,
    sampleRate: 44100,
    destination: makeBaseNode(),
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
      return makeBaseNode({
        maxDelayTime,
        delayTime: makeParam(0),
      })
    },
    createGain() {
      return makeBaseNode({ gain: makeParam(1) })
    },
    createDynamicsCompressor() {
      return makeBaseNode({
        threshold: makeParam(-14),
        knee: makeParam(18),
        ratio: makeParam(6),
      })
    },
    createBiquadFilter() {
      stats.filtersCreated += 1
      return makeBaseNode({
        type: 'lowpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
      })
    },
    createPanner() {
      stats.pannersCreated += 1
      return makeBaseNode({
        panningModel: 'HRTF',
        distanceModel: 'linear',
        refDistance: 1.9,
        maxDistance: 13.5,
        rolloffFactor: 0,
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
      })
    },
    createOscillator() {
      let started = false
      let stopped = false
      return makeBaseNode({
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
      return makeBaseNode({
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

function makeSyntheticLightsGroup(fixtures = [], currentLightScale = 1) {
  return {
    userData: {
      isMazeCeilingLights: true,
      currentLightScale,
      reducedMotion: false,
      highContrast: false,
      fixtures,
    },
  }
}

console.log('--- RUNNING INDUSTRIAL CEILING LIGHT AUDIO TESTS ---')

// 1. Autoplay guard: zero AudioContext/nodes created before user unlock
console.log('Test 1: Pre-Unlock Autoplay Guard with Live Ceiling Lights')
const mazeA = generateMaze({ difficulty: 'medium', seed: 13579 })
const mazeB = generateMaze({ difficulty: 'medium', seed: 24680 })
const mockAudio1 = createMockAudioContext()
let ctxCreations1 = 0
const engine1 = createHeadlessEngine({
  enemies: { autoSpawn: false },
  horrorDirector: { intensity: HORROR_INTENSITY_LEVELS.OFF },
  audio: {
    createAudioContext: () => {
      ctxCreations1 += 1
      return mockAudio1.ctx
    },
    autoUnlock: false,
    recordCueHistory: true,
  },
})
engine1.setMaze(mazeA)
for (let i = 0; i < 20; i += 1) {
  engine1.stepFrame(0.05, { render: false })
}
assert(ctxCreations1 === 0, 'AudioContext is not created during frame steps before unlock')
assert(mockAudio1.stats.oscillatorsStarted === 0, 'Zero oscillators start before unlock')
assert(
  engine1.getAudioEngine().getCueHistory().filter((c) => c.type.startsWith('ceiling_light_'))
    .length === 0,
  'Zero ceiling light SFX cues recorded before unlock'
)

assert(engine1.unlockAudio() === true, 'unlockAudio succeeds cleanly')
assert(ctxCreations1 === 1, 'AudioContext initializes cleanly on unlock')
console.log('✓ Pre-unlock autoplay guard verified')

// 2. Working vs. Burned-Out vs. Flickering fixture behavior & steady-frame zero allocation
console.log('Test 2: Working vs. Burned-Out vs. Flickering & Voice Pool Cap')
const audio1 = engine1.getAudioEngine()
const playerPos1 = engine1.getPlayerWorldPosition()

// Burned-out fixture right overhead must NEVER acquire a voice or trigger cues
const burnedOutOnlyGroup = makeSyntheticLightsGroup([
  {
    index: 0,
    designType: 'fluorescent_batten',
    condition: CEILING_LIGHT_STATES.BURNED_OUT,
    x: playerPos1.x,
    z: playerPos1.z,
    lightY: 3.4,
    phase: 0.4,
    baseIntensity: 0,
    _liveIntensity: 0,
    _warmShift: 0,
  },
])
audio1.clearCueHistory()
for (let i = 0; i < 10; i += 1) {
  audio1.update(0.05, {
    playerWorldPos: playerPos1,
    ceilingLightsGroup: burnedOutOnlyGroup,
  })
}
const burnedOutState = audio1.getCeilingLightAudioState()
assert(
  burnedOutState.activeVoiceCount === 0,
  `Burned-out fixture acquires 0 hum voices (got ${burnedOutState.activeVoiceCount})`
)
assert(
  audio1.getCueHistory().filter((c) => c.type.startsWith('ceiling_light_')).length === 0,
  'Burned-out fixture produces zero sputter/starter/fault cues'
)

// Working fixture overhead acquires 1 hum voice and zero flicker SFX
const workingOnlyGroup = makeSyntheticLightsGroup([
  {
    index: 1,
    designType: 'recessed_panel',
    condition: CEILING_LIGHT_STATES.WORKING,
    x: playerPos1.x,
    z: playerPos1.z,
    lightY: 3.4,
    phase: 0.2,
    baseIntensity: 1.0,
    _liveIntensity: 1.0,
    _warmShift: 0,
  },
])
for (let i = 0; i < 15; i += 1) {
  audio1.update(0.05, {
    playerWorldPos: playerPos1,
    ceilingLightsGroup: workingOnlyGroup,
  })
}
const workingState = audio1.getCeilingLightAudioState()
assert(workingState.activeVoiceCount === 1, 'Working fixture acquires 1 subtle hum voice')
assert(
  workingState.assignedFixtures.includes(1),
  'Working fixture index 1 assigned to pooled voice'
)
assert(
  audio1.getCueHistory().filter((c) => c.type.startsWith('ceiling_light_')).length === 0,
  'Steady working fixture produces zero flicker/fault cues'
)

// Zero per-frame oscillator allocations across steady hum updates
const oscAfterPoolWarm = mockAudio1.stats.oscillatorsStarted
for (let i = 0; i < 40; i += 1) {
  audio1.update(0.05, {
    playerWorldPos: playerPos1,
    ceilingLightsGroup: workingOnlyGroup,
  })
}
assert(
  mockAudio1.stats.oscillatorsStarted === oscAfterPoolWarm,
  'Steady ceiling hum updates allocate zero new oscillators per frame'
)

// Multiple nearby fixtures (8 working/flickering + 2 burned out) strictly capped at maxHumVoices (2)
const crowdedFixtures = []
for (let k = 0; k < 8; k += 1) {
  crowdedFixtures.push({
    index: k,
    designType: k % 2 === 0 ? 'fluorescent_batten' : 'cage_bulkhead',
    condition: k < 2 ? CEILING_LIGHT_STATES.BURNED_OUT : CEILING_LIGHT_STATES.WORKING,
    x: playerPos1.x + (k - 3) * 0.8,
    z: playerPos1.z,
    lightY: 3.4,
    phase: k * 0.5,
    baseIntensity: k < 2 ? 0 : 1.0,
    _liveIntensity: k < 2 ? 0 : 1.0,
    _warmShift: 0,
  })
}
audio1.update(0.05, {
  playerWorldPos: playerPos1,
  ceilingLightsGroup: makeSyntheticLightsGroup(crowdedFixtures),
})
const crowdedState = audio1.getCeilingLightAudioState()
assert(
  crowdedState.poolSize <= CEILING_LIGHT_AUDIO_CONFIG.maxHumVoices &&
    crowdedState.activeVoiceCount <= CEILING_LIGHT_AUDIO_CONFIG.maxHumVoices,
  `Active ceiling hum voices capped at ${CEILING_LIGHT_AUDIO_CONFIG.maxHumVoices} (pool=${crowdedState.poolSize}, active=${crowdedState.activeVoiceCount})`
)
assert(
  !crowdedState.assignedFixtures.includes(0) && !crowdedState.assignedFixtures.includes(1),
  'Burned-out fixtures excluded even in crowded corridor'
)
console.log('✓ Working vs. burned-out fixture behavior, zero per-frame allocations, and 2-voice cap verified')

// 3. Synchronized flicker sputter/starter/fault cues & cooldown discipline
console.log('Test 3: Synchronized Flicker Dip/Recovery Edges & Cooldowns')
audio1.clearCueHistory()
const syncFlickerFixture = {
  index: 4,
  designType: 'fluorescent_batten',
  condition: CEILING_LIGHT_STATES.FLICKERING,
  x: playerPos1.x,
  z: playerPos1.z,
  lightY: 3.4,
  phase: 0.0,
  baseIntensity: 1.0,
  _liveIntensity: 1.0,
  _warmShift: 0.0,
}
const syncGroup = makeSyntheticLightsGroup([syncFlickerFixture])

// Start steady (bright)
audio1.update(0.05, { playerWorldPos: playerPos1, ceilingLightsGroup: syncGroup })
// Enter visual dip and STAY in dip for 10 consecutive frames -> triggers ONCE, NOT every frame
syncFlickerFixture._liveIntensity = 0.45
syncFlickerFixture._warmShift = 0.72
for (let i = 0; i < 10; i += 1) {
  audio1.update(0.05, { playerWorldPos: playerPos1, ceilingLightsGroup: syncGroup })
}
const dipCues = audio1
  .getCueHistory()
  .filter((c) => c.type === 'ceiling_light_sputter' || c.type === 'ceiling_light_fault')
assert(
  dipCues.length === 1,
  `Entering & holding a visual dip triggers exactly 1 sputter/fault cue (got ${dipCues.length})`
)

// Rapid micro-oscillation inside cooldown window must be suppressed by per-fixture cooldown
syncFlickerFixture._liveIntensity = 1.0
syncFlickerFixture._warmShift = 0.0
audio1.update(0.05, { playerWorldPos: playerPos1, ceilingLightsGroup: syncGroup })
syncFlickerFixture._liveIntensity = 0.48
syncFlickerFixture._warmShift = 0.68
audio1.update(0.05, { playerWorldPos: playerPos1, ceilingLightsGroup: syncGroup })
const dipCuesAfterRapidReenter = audio1
  .getCueHistory()
  .filter((c) => c.type === 'ceiling_light_sputter' || c.type === 'ceiling_light_fault')
assert(
  dipCuesAfterRapidReenter.length === 1,
  'Cooldown prevents sputter spam on rapid consecutive flicker dips'
)

// Advance past cooldown and test recovery starter + multiple cycles
let starterSeen = false
let faultOrSputterCount = 0
for (let cycle = 0; cycle < 8; cycle += 1) {
  // Steady bright for 3.6s (exceeds perFixtureCooldown)
  syncFlickerFixture._liveIntensity = 1.0
  syncFlickerFixture._warmShift = 0.0
  for (let s = 0; s < 36; s += 1) {
    audio1.update(0.1, { playerWorldPos: playerPos1, ceilingLightsGroup: syncGroup })
  }
  // Dip deep for 0.6s
  syncFlickerFixture._liveIntensity = 0.42
  syncFlickerFixture._warmShift = 0.82
  for (let d = 0; d < 6; d += 1) {
    audio1.update(0.1, { playerWorldPos: playerPos1, ceilingLightsGroup: syncGroup })
  }
  // Recover back to bright
  syncFlickerFixture._liveIntensity = 1.0
  syncFlickerFixture._warmShift = 0.0
  audio1.update(0.1, { playerWorldPos: playerPos1, ceilingLightsGroup: syncGroup })
}
for (const cue of audio1.getCueHistory()) {
  if (cue.type === 'ceiling_light_starter') starterSeen = true
  if (cue.type === 'ceiling_light_sputter' || cue.type === 'ceiling_light_fault') {
    faultOrSputterCount += 1
  }
}
assert(
  faultOrSputterCount >= 4 && faultOrSputterCount <= 10,
  `Controlled sputter/fault count across 8 slow cycles (got ${faultOrSputterCount})`
)
assert(starterSeen, 'Starter relay click cue triggers intermittently on visual recovery')

// Also test real buildCeilingLights fixtures in MazeSceneEngine over elapsed time
audio1.clearCueHistory()
for (let i = 0; i < 160; i += 1) {
  engine1.stepFrame(0.08, { render: false })
}
const realMazeLightCues = audio1
  .getCueHistory()
  .filter((c) => c.type.startsWith('ceiling_light_'))
assert(
  realMazeLightCues.length < 30,
  `Real maze flickering remains restrained and not noisy (cues=${realMazeLightCues.length})`
)
console.log('✓ Synchronized dip/recovery edges, cooldowns, and restrained cadence verified')

// 4. Spatial distance rolloff, wall occlusion, spatialAudio option & volume controls
console.log('Test 4: Spatial Distance, Wall Occlusion, Volumes & Mute')
// Build small walled maze to guarantee wall occlusion separation
const cellMaze = {
  rows: 5,
  cols: 5,
  cellSize: 4,
  start: { row: 1, col: 1 },
  exit: { row: 3, col: 3 },
  grid: [
    [1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ],
}
const pA = gridToWorld(1, 1, cellMaze)
const pBehindWall = gridToWorld(1, 3, cellMaze)
audio1.setMaze(cellMaze)
audio1.updateListener({ x: pA.x, y: 1.65, z: pA.z })

const farFixture = {
  index: 9,
  designType: 'fluorescent_batten',
  condition: CEILING_LIGHT_STATES.FLICKERING,
  x: pA.x + 22,
  z: pA.z,
  lightY: 3.4,
  phase: 0,
  baseIntensity: 1.0,
  _liveIntensity: 0.4,
  _warmShift: 0.8,
}
audio1.clearCueHistory()
audio1.update(0.1, {
  playerWorldPos: pA,
  ceilingLightsGroup: makeSyntheticLightsGroup([farFixture]),
})
assert(
  audio1.getCeilingLightAudioState().activeVoiceCount === 0,
  'Distant fixture (>12.5m) acquires 0 hum voices'
)
assert(
  audio1.getCueHistory().filter((c) => c.type.startsWith('ceiling_light_')).length === 0,
  'Distant fixture (>15.5m) produces zero sputter cues'
)

// Occluded fixture behind thick concrete walls (row 1 col 3 vs listener at row 1 col 1)
const occludedFixture = {
  index: 10,
  designType: 'fluorescent_batten',
  condition: CEILING_LIGHT_STATES.FLICKERING,
  x: pBehindWall.x,
  z: pBehindWall.z,
  lightY: 3.4,
  phase: 0,
  baseIntensity: 1.0,
  _liveIntensity: 1.0,
  _warmShift: 0,
}
// Advance past cooldown cleanly then dip
for (let i = 0; i < 40; i += 1) {
  audio1.update(0.1, {
    playerWorldPos: pA,
    ceilingLightsGroup: makeSyntheticLightsGroup([occludedFixture]),
  })
}
occludedFixture._liveIntensity = 0.4
occludedFixture._warmShift = 0.8
audio1.clearCueHistory()
audio1.update(0.1, {
  playerWorldPos: pA,
  ceilingLightsGroup: makeSyntheticLightsGroup([occludedFixture]),
})
const occSputter = audio1.getCueHistory().find((c) => c.type === 'ceiling_light_sputter' || c.type === 'ceiling_light_fault')
if (occSputter) {
  assert(
    occSputter.wallCount >= 1 && occSputter.gain < 0.5,
    `Occluded light sputter is strongly attenuated (wallCount=${occSputter.wallCount}, gain=${occSputter.gain})`
  )
}

// Verify spatialAudio toggle cleanly rebuilds active pool without leaking oscillators
const localWork = {
  index: 11,
  designType: 'cage_bulkhead',
  condition: CEILING_LIGHT_STATES.WORKING,
  x: pA.x,
  z: pA.z,
  lightY: 3.4,
  phase: 0,
  baseIntensity: 1.0,
  _liveIntensity: 1.0,
  _warmShift: 0,
}
audio1.update(0.1, {
  playerWorldPos: pA,
  ceilingLightsGroup: makeSyntheticLightsGroup([localWork]),
})
assert(
  audio1.getCeilingLightAudioState().poolSize === CEILING_LIGHT_AUDIO_CONFIG.maxHumVoices,
  'Spatial hum pool activates when fixture is nearby'
)
const oscStoppedBeforeSpatialToggle = mockAudio1.stats.oscillatorsStopped
const pannersBeforeNoSpatial = mockAudio1.stats.pannersCreated
audio1.setAudioOptions({ spatialAudio: false })
assert(
  mockAudio1.stats.oscillatorsStopped > oscStoppedBeforeSpatialToggle,
  'Toggling spatialAudio cleanly stops previous pooled voice oscillators'
)
audio1.update(0.1, {
  playerWorldPos: pA,
  ceilingLightsGroup: makeSyntheticLightsGroup([localWork]),
})
assert(
  mockAudio1.stats.pannersCreated === pannersBeforeNoSpatial,
  'When spatialAudio is disabled, light hum pool runs cleanly without creating PannerNodes'
)
audio1.setAudioOptions({ spatialAudio: true })

// Volume & Mute controls affect bus GainNodes (ceiling lights route via effectsGain -> masterGain)
audio1.setVolumes({ master: 0.75, effects: 0.35 })
assert(audio1.effectsGain.gain.value === 0.35, 'Effects bus scales ceiling light audio')
assert(audio1.masterGain.gain.value === 0.75, 'Master bus scales ceiling light audio')
audio1.setMuted(true)
assert(audio1.masterGain.gain.value === 0, 'Muted master bus silences all ceiling light audio')
audio1.setMuted(false)
audio1.setVolumes({ master: 0.8, effects: 0.85 })
console.log('✓ Spatial distance, wall occlusion, spatialAudio toggle, and volume/mute controls verified')

// 5. Reduced Motion mode suppresses flicker-specific sound events
console.log('Test 5: Reduced Motion Suppresses Flicker-Specific Sound Events')
audio1.setMaze(mazeA)
const posA = gridToWorld(mazeA.start.row, mazeA.start.col, mazeA)
const rmFixture = {
  index: 20,
  designType: 'fluorescent_batten',
  condition: CEILING_LIGHT_STATES.FLICKERING,
  x: posA.x,
  z: posA.z,
  lightY: 3.4,
  phase: 0,
  baseIntensity: 1.0,
  _liveIntensity: 1.0,
  _warmShift: 0,
}
const rmGroup = makeSyntheticLightsGroup([rmFixture])
audio1.clearCueHistory()
for (let cycle = 0; cycle < 5; cycle += 1) {
  rmFixture._liveIntensity = 1.0
  rmFixture._warmShift = 0.0
  for (let s = 0; s < 35; s += 1) {
    audio1.update(0.1, {
      playerWorldPos: posA,
      ceilingLightsGroup: rmGroup,
      reducedMotion: true,
    })
  }
  rmFixture._liveIntensity = 0.35
  rmFixture._warmShift = 0.85
  for (let d = 0; d < 5; d += 1) {
    audio1.update(0.1, {
      playerWorldPos: posA,
      ceilingLightsGroup: rmGroup,
      reducedMotion: true,
    })
  }
}
const rmFlickerCues = audio1
  .getCueHistory()
  .filter((c) => c.type.startsWith('ceiling_light_'))
assert(
  rmFlickerCues.length === 0,
  `Reduced Motion suppresses all flicker sputter/starter/fault cues (got ${rmFlickerCues.length})`
)
console.log('✓ Reduced Motion suppression verified')

// 6. Pause/Resume, HorrorDirector Blackout & Recovery, Game Over & Victory
console.log('Test 6: Pause/Resume, HorrorDirector Blackout/Recovery, Game Over & Victory')
engine1.setMaze(mazeA)
for (let i = 0; i < 5; i += 1) {
  engine1.stepFrame(0.05, { render: false })
}

// Pause/Resume
engine1.setPaused(true)
assert(
  audio1.getCeilingLightAudioState().activeVoiceCount === 0,
  'Pausing silences active ceiling light voices'
)
const oscAtPause = mockAudio1.stats.oscillatorsStarted
engine1.stepFrame(0.05, { render: false })
assert(
  mockAudio1.stats.oscillatorsStarted === oscAtPause,
  'Paused engine spawns zero ceiling light oscillators'
)
engine1.setPaused(false)
engine1.stepFrame(0.05, { render: false })
assert(
  audio1.getCeilingLightAudioState().poolSize <= CEILING_LIGHT_AUDIO_CONFIG.maxHumVoices,
  'Unpausing resumes ceiling light pool cleanly without duplicate voices'
)

// HorrorDirector Blackout & Recovery
const director = engine1.getHorrorDirector()
director.updateConfig({ intensity: HORROR_INTENSITY_LEVELS.HIGH, reducedMotion: false })
const playerBlackoutPos = engine1.getPlayerWorldPosition()
audio1.clearCueHistory()
director.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, { playerWorldPos: playerBlackoutPos })
for (let i = 0; i < 12; i += 1) {
  engine1.stepFrame(0.08, { render: false })
}
// Wait for blackout to complete (typical duration ~2.5-3.5s) and recover cleanly
for (let i = 0; i < 55; i += 1) {
  engine1.stepFrame(0.08, { render: false })
}
assert(
  audio1.getCeilingLightAudioState().poolSize <= CEILING_LIGHT_AUDIO_CONFIG.maxHumVoices,
  'HorrorDirector blackout & recovery preserves bounded voice pool with zero duplication'
)

// Victory stops ceiling light voices cleanly
engine1.setHasWon(true)
assert(
  audio1.getCeilingLightAudioState().poolSize === 0,
  'Setting hasWon stops and releases ceiling light voice pool'
)

// Reset & Game Over stop ceiling light voices cleanly
engine1.resetCombat()
engine1.stepFrame(0.05, { render: false })
engine1.setHealth(0)
assert(engine1.isGameOver === true, 'Game over reached')
assert(
  audio1.getCeilingLightAudioState().poolSize === 0,
  'Game over stops and releases ceiling light voice pool'
)
console.log('✓ Pause/resume, HorrorDirector blackout/recovery, victory, and game over verified')

// 7. Maze Switching, StrictMode Remounts & Leak-Free Disposal
console.log('Test 7: Maze Switching, StrictMode Remounts & Disposal')
const mockStrictAudio = createMockAudioContext()
// Mount 1 -> run -> unmount (StrictMode cleanup)
const strictEngine1 = createHeadlessEngine({
  enemies: { autoSpawn: false },
  audio: {
    createAudioContext: () => mockStrictAudio.ctx,
    autoUnlock: true,
    recordCueHistory: true,
  },
})
strictEngine1.setMaze(mazeA)
const activeFixA = strictEngine1._ceilingLightsGroup?.userData?.fixtures?.find(
  (f) => f.condition !== CEILING_LIGHT_STATES.BURNED_OUT
)
assert(Boolean(activeFixA), 'Generated mazeA has at least one active ceiling fixture')
strictEngine1.setPlayerWorldPosition(activeFixA.x, 0, activeFixA.z, { immediate: true })
for (let i = 0; i < 8; i += 1) {
  strictEngine1.stepFrame(0.05, { render: false })
}
const poolSizeBeforeSwitch = strictEngine1.getAudioEngine().getCeilingLightAudioState().poolSize
assert(
  poolSizeBeforeSwitch > 0 && poolSizeBeforeSwitch <= 2,
  `Initial maze activates bounded pooled light voices (poolSize=${poolSizeBeforeSwitch})`
)

// Switch to mazeB
const stoppedBeforeMazeSwitch = mockStrictAudio.stats.oscillatorsStopped
strictEngine1.setMaze(mazeB)
assert(
  mockStrictAudio.stats.oscillatorsStopped > stoppedBeforeMazeSwitch,
  'Switching mazes stops previous maze ceiling light oscillators'
)
const activeFixB = strictEngine1._ceilingLightsGroup?.userData?.fixtures?.find(
  (f) => f.condition !== CEILING_LIGHT_STATES.BURNED_OUT
)
if (activeFixB) {
  strictEngine1.setPlayerWorldPosition(activeFixB.x, 0, activeFixB.z, { immediate: true })
}
strictEngine1.stepFrame(0.05, { render: false })
assert(
  strictEngine1.getAudioEngine().getCeilingLightAudioState().poolSize <= 2,
  'New maze re-allocates at most 2 pooled light voices (no accumulation)'
)

// Dispose mount 1
strictEngine1.dispose()
assert(
  mockStrictAudio.stats.oscillatorsStopped === mockStrictAudio.stats.oscillatorsStarted,
  `StrictMode first dispose stops every started oscillator (started=${mockStrictAudio.stats.oscillatorsStarted}, stopped=${mockStrictAudio.stats.oscillatorsStopped})`
)

// Mount 2 (StrictMode second mount with fresh MockAudioContext)
const mockStrictAudio2 = createMockAudioContext()
const strictEngine2 = createHeadlessEngine({
  enemies: { autoSpawn: false },
  audio: {
    createAudioContext: () => mockStrictAudio2.ctx,
    autoUnlock: true,
    recordCueHistory: true,
  },
})
strictEngine2.setMaze(mazeA)
for (let i = 0; i < 8; i += 1) {
  strictEngine2.stepFrame(0.05, { render: false })
}
assert(
  strictEngine2.getAudioEngine().getCeilingLightAudioState().poolSize <= 2,
  'Second StrictMode mount operates with single <=2 voice pool'
)
strictEngine2.dispose()
assert(
  mockStrictAudio2.stats.oscillatorsStopped === mockStrictAudio2.stats.oscillatorsStarted,
  `StrictMode second dispose stops every started oscillator (started=${mockStrictAudio2.stats.oscillatorsStarted}, stopped=${mockStrictAudio2.stats.oscillatorsStopped})`
)

engine1.dispose()
assert(
  mockAudio1.stats.oscillatorsStopped === mockAudio1.stats.oscillatorsStarted,
  `Main test engine dispose stops all started oscillators cleanly (started=${mockAudio1.stats.oscillatorsStarted}, stopped=${mockAudio1.stats.oscillatorsStopped})`
)

console.log('✓ Maze switching, StrictMode remounts, and leak-free disposal verified')
console.log('--- ALL INDUSTRIAL CEILING LIGHT AUDIO TESTS PASSED SUCCESSFULLY! ---')
