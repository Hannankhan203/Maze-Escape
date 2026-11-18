import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { HIDING_SPOT_TYPES } from '../generation/hidingSpotPlacement.js'
import { gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import { HAZARD_STATES, HazardAgent } from './HazardAgent.js'
import {
  DEFAULT_AUDIO_VOLUMES,
  HorrorAudioEngine,
  MUSIC_MOODS,
  computeDistanceAttenuation,
  computeOcclusionFactors,
  computeSpatialAudioAttenuation,
  countOccludingWalls,
} from './HorrorAudioEngine.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

console.log('--- RUNNING 3D HORROR AUDIO SYSTEM TESTS ---')

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
    delayNodesCreated: 0,
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
      stats.delayNodesCreated += 1
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
        threshold: makeParam(-24),
        knee: makeParam(30),
        ratio: makeParam(12),
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
        refDistance: 1,
        maxDistance: 100,
        rolloffFactor: 1,
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
      })
    },
    createOscillator() {
      return makeBaseNode({
        type: 'sine',
        frequency: makeParam(440),
        onended: null,
        start() {
          stats.oscillatorsStarted += 1
        },
        stop() {
          stats.oscillatorsStopped += 1
          this.onended?.()
        },
      })
    },
    createBuffer(channels, length, sampleRate) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData() {
          return new Float32Array(length)
        },
      }
    },
    createBufferSource() {
      return makeBaseNode({
        buffer: null,
        loop: false,
        onended: null,
        start() {
          stats.bufferSourcesStarted += 1
        },
        stop() {
          stats.bufferSourcesStopped += 1
          this.onended?.()
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

// 1. Browser audio autoplay restriction & deferred initialization
console.log('Test 1: Browser Autoplay Restriction & Deferred Initialization')
let contextCreateCalls = 0
const mockAudio = createMockAudioContext()
const audioEngine = new HorrorAudioEngine({
  createAudioContext: () => {
    contextCreateCalls += 1
    return mockAudio.ctx
  },
  recordCueHistory: true,
})

assert(contextCreateCalls === 0, 'AudioContext is NOT created before user interaction')
assert(audioEngine.isUnlocked === false, 'Audio engine starts locked before gesture')
assert(
  audioEngine.getAudioState().contextState === 'uninitialized',
  'Audio state reports uninitialized before unlock'
)

// Triggering cues before user gesture must never throw or touch Web Audio
audioEngine.onPlayerDamage()
assert(mockAudio.stats.oscillatorsStarted === 0, 'No oscillators start while locked')

// First user interaction unlocks and resumes AudioContext cleanly
const unlocked = audioEngine.unlock()
assert(unlocked === true, 'unlock() returns true')
assert(contextCreateCalls === 1, 'AudioContext created strictly on first unlock()')
assert(mockAudio.stats.resumeCount === 1, 'Suspended AudioContext resumed on unlock')
assert(audioEngine.isUnlocked === true, 'Audio engine reports unlocked')
assert(mockAudio.stats.oscillatorsStarted >= 2, 'Ambient drone and music layers start after unlock')

// Idempotent second unlock
audioEngine.unlock()
assert(contextCreateCalls === 1, 'Repeated unlock() does not create duplicate AudioContext')
console.log('✓ Browser autoplay restrictions & clean unlock verified')

// 2. Volume controls and sensible defaults
console.log('Test 2: Volume Controls, Clamping & Mute')
const defaults = audioEngine.getVolumeConfig()
assert(defaults.master === DEFAULT_AUDIO_VOLUMES.master, 'Default master volume matches')
assert(defaults.ambience === DEFAULT_AUDIO_VOLUMES.ambience, 'Default ambience volume matches')
assert(defaults.effects === DEFAULT_AUDIO_VOLUMES.effects, 'Default effects volume matches')
assert(defaults.music === DEFAULT_AUDIO_VOLUMES.music, 'Default music volume matches')
assert(defaults.muted === false, 'Default muted state is false')

audioEngine.setVolumes({ master: 1.5, ambience: -0.2, effects: 0.4, music: 0.7 })
const updatedVols = audioEngine.getVolumeConfig()
assert(updatedVols.master === 1, 'Master volume clamped to max 1')
assert(updatedVols.ambience === 0, 'Ambience volume clamped to min 0')
assert(updatedVols.effects === 0.4, 'Effects volume updated cleanly')
assert(updatedVols.music === 0.7, 'Music volume updated cleanly')
assert(audioEngine.effectsGain.gain.value === 0.4, 'Effects GainNode reflects configured level')
assert(audioEngine.musicGain.gain.value === 0.7, 'Music GainNode reflects configured level')

audioEngine.setMuted(true)
assert(audioEngine.masterGain.gain.value === 0, 'Muting drives master GainNode to 0')
const mutedEffective = audioEngine.getEffectiveVolumes()
assert(
  mutedEffective.master === 0 &&
    mutedEffective.ambience === 0 &&
    mutedEffective.effects === 0 &&
    mutedEffective.music === 0,
  'Muting scales all effective channel volumes to 0'
)
audioEngine.setMuted(false)
assert(audioEngine.masterGain.gain.value === 1, 'Unmuting restores master GainNode level')

audioEngine.setVolumes({ master: 0.5, ambience: 0.4, effects: 0.8, music: 0.6 })
const scaledEffective = audioEngine.getEffectiveVolumes()
assert(Math.abs(scaledEffective.ambience - 0.2) < 1e-6, 'Master volume scales ambience proportionally')
assert(Math.abs(scaledEffective.effects - 0.4) < 1e-6, 'Master volume scales effects proportionally')
assert(Math.abs(scaledEffective.music - 0.3) < 1e-6, 'Master volume scales music proportionally')

assert(mockAudio.stats.delayNodesCreated === 1, 'Corridor reverb delay node created when supported')
assert(
  Math.abs(audioEngine._reverbWetGain.gain.value - 0.16) < 1e-6,
  'Corridor reverb wet gain enabled by default'
)
audioEngine.setAudioOptions({ footstepEchoes: false, spatialAudio: false })
assert(audioEngine._reverbWetGain.gain.value === 0, 'Disabling footstepEchoes mutes corridor reverb wet send')
const pannersBeforeFlat = mockAudio.stats.pannersCreated
audioEngine.onHidingSpotTransition('enter', { x: 1, y: 0, z: 1 })
assert(
  mockAudio.stats.pannersCreated === pannersBeforeFlat,
  'Disabling spatialAudio bypasses HRTF PannerNode creation'
)
audioEngine.setAudioOptions({ footstepEchoes: true, spatialAudio: true })
audioEngine.onHidingSpotTransition('exit', { x: 1, y: 0, z: 1 })
assert(
  mockAudio.stats.pannersCreated === pannersBeforeFlat + 1,
  'Re-enabling spatialAudio restores HRTF PannerNode spatialization'
)
assert(
  Math.abs(audioEngine._reverbWetGain.gain.value - 0.16) < 1e-6,
  'Re-enabling footstepEchoes restores corridor reverb wet send'
)
console.log('✓ Volume buses, master scaling, spatial/reverb options, and muting verified')

// 3. Distance-based attenuation and wall occlusion
console.log('Test 3: Distance Attenuation & Wall Occlusion')
const listenerPos = { x: 0, y: 0, z: 0 }
const nearGain = computeDistanceAttenuation({ x: 1, y: 0, z: 0 }, listenerPos)
const midGain = computeDistanceAttenuation({ x: 6, y: 0, z: 0 }, listenerPos)
const farGain = computeDistanceAttenuation({ x: 14, y: 0, z: 0 }, listenerPos)
const outGain = computeDistanceAttenuation({ x: 25, y: 0, z: 0 }, listenerPos)

assert(nearGain === 1, `Near distance stays 1.0 (got ${nearGain})`)
assert(midGain < nearGain && midGain > farGain, 'Mid distance strictly softer than near and louder than far')
assert(farGain > 0 && farGain < midGain, 'Far distance softly audible within maxDistance')
assert(outGain === 0, 'Beyond maxDistance returns exact 0 attenuation')

const occlusionTestMaze = {
  rows: 5,
  cols: 5,
  start: { row: 1, col: 1 },
  exit: { row: 3, col: 3 },
  seed: 1010,
  difficulty: 'small',
  grid: [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ],
}
const cell11 = gridToWorld(1, 1, occlusionTestMaze)
const cell13 = gridToWorld(1, 3, occlusionTestMaze) // Same open corridor as (1,1)
const cell31 = gridToWorld(3, 1, occlusionTestMaze) // Separated by wall at row 2!

const openWalls = countOccludingWalls(cell11, cell13, occlusionTestMaze)
const blockedWalls = countOccludingWalls(cell11, cell31, occlusionTestMaze)
assert(openWalls === 0, `Open corridor has 0 occluding walls (got ${openWalls})`)
assert(blockedWalls >= 1, `Walled corridor counts >= 1 occluding wall (got ${blockedWalls})`)

const openOcc = computeOcclusionFactors(cell11, cell13, occlusionTestMaze)
const blockedOcc = computeOcclusionFactors(cell11, cell31, occlusionTestMaze)
assert(openOcc.gainMultiplier === 1 && openOcc.lowpassCutoff === 18000, 'Open corridor unmuffled')
assert(
  blockedOcc.gainMultiplier < openOcc.gainMultiplier && blockedOcc.lowpassCutoff < 2500,
  'Wall barrier reduces gainMultiplier and lowers lowpass muffling cutoff'
)

const spatialOpen = computeSpatialAudioAttenuation(cell13, cell11, occlusionTestMaze)
const spatialBlocked = computeSpatialAudioAttenuation(cell31, cell11, occlusionTestMaze)
assert(
  spatialBlocked.gain < spatialOpen.gain,
  'Same grid distance through a wall has lower spatial gain than open corridor'
)
console.log('✓ Distance rolloff and grid wall-occlusion attenuation verified')

audioEngine.dispose()

// 4. Integrated MazeSceneEngine: state-triggered playback, enemy/hazard/hiding cues, lifecycle cleanup
console.log('Test 4: Integrated Engine State-Triggered Playback & Lifecycle')
let engineCtxCalls = 0
const engineMockAudio = createMockAudioContext()
const engine = createHeadlessEngine({
  enemies: { autoSpawn: false },
  audio: {
    createAudioContext: () => {
      engineCtxCalls += 1
      return engineMockAudio.ctx
    },
    recordCueHistory: true,
  },
})

assert(engineCtxCalls === 0, 'MazeSceneEngine constructor does not auto-create AudioContext')
assert(engine.unlockAudio() === true, 'engine.unlockAudio() unlocks audio on user interaction')
assert(engineCtxCalls === 1, 'AudioContext initialized upon unlockAudio()')

engine.setMaze(occlusionTestMaze)
engine.clearHidingSpots()
engine.setPlayerGridPosition(1, 1, { immediate: true })

const audio = engine.getAudioEngine()
audio.clearCueHistory()

const enemy = engine.spawnEnemy({
  id: 'stalker-audio-test',
  spawnCell: { row: 1, col: 3 },
  config: {
    visionRange: 25,
    attackRange: 5,
    attackHitDelay: 0.05,
    attackDamage: 25,
  },
})

// Hold CHASE for multiple frames -> enemy_detect_chase & chase music MUST trigger only once (no frame spam)
enemy.state = ENEMY_STATES.PATROL
audio.update(0.016, {
  camera: engine.camera,
  playerWorldPos: engine.getPlayerWorldPosition(),
  enemies: engine.enemyManager.enemies.values(),
  hazards: engine.hazardManager.hazards.values(),
})

enemy.state = ENEMY_STATES.CHASE
for (let i = 0; i < 12; i += 1) {
  audio.update(0.016, {
    camera: engine.camera,
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: engine.enemyManager.enemies.values(),
    hazards: engine.hazardManager.hazards.values(),
  })
}

const chaseCues = audio.getCueHistory().filter((c) => c.type === 'enemy_detect_chase')
const chaseMoodChanges = audio
  .getCueHistory()
  .filter((c) => c.type === 'music_mood_change' && c.mood === MUSIC_MOODS.CHASE)
assert(
  chaseCues.length === 1,
  `enemy_detect_chase fires strictly once per CHASE transition (got ${chaseCues.length})`
)
assert(
  chaseMoodChanges.length === 1,
  `Chase music mood activates once without restarting every frame (got ${chaseMoodChanges.length})`
)
assert(audio.getAudioState().musicMood === MUSIC_MOODS.CHASE, 'Music mood tracks CHASE')

// Advance >= 0.3s to verify positional enemy footsteps during CHASE
audio.update(0.32, {
  camera: engine.camera,
  playerWorldPos: engine.getPlayerWorldPosition(),
  enemies: engine.enemyManager.enemies.values(),
  hazards: engine.hazardManager.hazards.values(),
})
const stepCues = audio.getCueHistory().filter((c) => c.type === 'enemy_footstep')
assert(stepCues.length >= 1, 'Enemy footsteps trigger on stride cadence')
assert(engineMockAudio.stats.pannersCreated >= 1, 'Positional PannerNodes used for 3D audio')

// Transition to ATTACK triggers enemy_attack_windup once; applying damage triggers player_damage
enemy.state = ENEMY_STATES.ATTACK
audio.update(0.016, {
  camera: engine.camera,
  playerWorldPos: engine.getPlayerWorldPosition(),
  enemies: engine.enemyManager.enemies.values(),
  hazards: engine.hazardManager.hazards.values(),
  attackHits: [{ enemyId: enemy.id, damage: 25, position: enemy.worldPos }],
})
audio.update(0.016, {
  camera: engine.camera,
  playerWorldPos: engine.getPlayerWorldPosition(),
  enemies: engine.enemyManager.enemies.values(),
  hazards: engine.hazardManager.hazards.values(),
})
const attackWindups = audio.getCueHistory().filter((c) => c.type === 'enemy_attack_windup')
const attackHits = audio.getCueHistory().filter((c) => c.type === 'enemy_attack_hit')
assert(attackWindups.length === 1, 'Attack windup fires once per ATTACK transition')
assert(attackHits.length === 1, 'Attack hit audio triggers cleanly')

engine.applyDamage(25, { enemyId: enemy.id })
assert(
  audio.getCueHistory().some((c) => c.type === 'player_damage'),
  'applyDamage triggers player damage audio cue'
)

// Hiding spot enter/exit cues
const spot = engine.hidingSpotManager.addHidingSpot({
  id: 'hide-audio-test',
  type: HIDING_SPOT_TYPES.CONTAINMENT_LOCKER,
  row: 1,
  col: 1,
  facingYaw: 0,
})
assert(engine.enterHidingSpot(spot).entered === true, 'Player enters hiding spot')
assert(
  audio.getCueHistory().some((c) => c.type === 'hiding_enter'),
  'Entering hiding spot triggers positional locker cue'
)
assert(engine.exitHidingSpot().exited === true, 'Player exits hiding spot')
assert(
  audio.getCueHistory().some((c) => c.type === 'hiding_exit'),
  'Exiting hiding spot triggers positional locker exit cue'
)

// Environmental hazard discrete transition cues
const spikeHazard = new HazardAgent(
  { id: 'spike-audio-test', type: HAZARD_TYPES.FLOOR_SPIKES, row: 1, col: 2 },
  occlusionTestMaze
)
engine.hazardManager.hazards.set(spikeHazard.id, spikeHazard)
audio.update(0.016, {
  camera: engine.camera,
  playerWorldPos: engine.getPlayerWorldPosition(),
  hazards: engine.hazardManager.hazards.values(),
})
spikeHazard.state = HAZARD_STATES.WARNING
audio.update(0.016, {
  camera: engine.camera,
  playerWorldPos: engine.getPlayerWorldPosition(),
  hazards: engine.hazardManager.hazards.values(),
})
spikeHazard.state = HAZARD_STATES.ACTIVE
audio.update(0.016, {
  camera: engine.camera,
  playerWorldPos: engine.getPlayerWorldPosition(),
  hazards: engine.hazardManager.hazards.values(),
})
assert(
  audio.getCueHistory().some((c) => c.type === 'hazard_floor_spikes_warning'),
  'Floor spikes warning transition triggers audio cue'
)
assert(
  audio.getCueHistory().some((c) => c.type === 'hazard_floor_spikes_active'),
  'Floor spikes active transition triggers audio cue'
)

// Lethal damage / Game Over transitions music to SILENT and fires game_over cue
engine.damageImmunityTimer = 0
engine.applyDamage(100, { enemyId: enemy.id })
assert(engine.isGameOver === true, 'Game over reached')
assert(
  audio.getAudioState().musicMood === MUSIC_MOODS.SILENT,
  'Music transitions to SILENT on game over'
)
assert(
  audio.getCueHistory().some((c) => c.type === 'game_over'),
  'Game over triggers horror sting'
)

// Reset combat restores AMBIENT mood and clears state trackers
engine.resetCombat()
assert(
  audio.getAudioState().musicMood === MUSIC_MOODS.AMBIENT,
  'resetCombat restores AMBIENT music mood'
)

// Pause mode silences master gain, suspends AudioContext, and blocks unexpected playback
engine.setAudioPaused(true)
assert(audio.masterGain.gain.value === 0, 'Pausing silences master bus')
assert(
  audio.getAudioState().musicMood === MUSIC_MOODS.AMBIENT,
  'Internal music mood state preserved while paused'
)
assert(engineMockAudio.stats.suspendCount === 1, 'Pausing suspends running AudioContext')
const oscBeforePausedPickup = engineMockAudio.stats.oscillatorsStarted
const playedWhilePaused = audio.onCoinPickup(1)
assert(
  playedWhilePaused === false &&
    engineMockAudio.stats.oscillatorsStarted === oscBeforePausedPickup,
  'Audio cues do not synthesize or play while paused'
)
engine.setAudioPaused(false)
assert(
  audio.masterGain.gain.value === audio.volumes.master,
  'Resuming restores master bus volume'
)
assert(
  engineMockAudio.stats.resumeCount >= 2,
  'Resuming from pause calls ctx.resume() on suspended AudioContext'
)

// Paused HorrorAudioEngine must not create/unlock AudioContext prematurely
const pausedMockAudio = createMockAudioContext()
let pausedCtxCreated = 0
const pausedAudioEngine = new HorrorAudioEngine({
  createAudioContext: () => {
    pausedCtxCreated += 1
    return pausedMockAudio.ctx
  },
})
pausedAudioEngine.setPaused(true)
assert(
  pausedAudioEngine.unlock() === false && pausedCtxCreated === 0,
  'unlock() refuses to initialize AudioContext while paused'
)
pausedAudioEngine.setPaused(false)
assert(
  pausedAudioEngine.unlock() === true && pausedCtxCreated === 1,
  'unlock() initializes AudioContext cleanly after unpausing'
)
pausedAudioEngine.dispose()

// Disposal shuts down oscillators, buffer sources, and closes owned AudioContext
engine.dispose()
assert(audio.isDisposed === true, 'HorrorAudioEngine disposed on engine.dispose()')
assert(engine.getAudioEngine() === null, 'MazeSceneEngine clears audioEngine reference')
assert(engineMockAudio.stats.closeCount === 1, 'Owned AudioContext closed cleanly on dispose')
assert(
  engineMockAudio.stats.oscillatorsStopped >= 2,
  'Continuous ambient and music oscillators stopped on dispose'
)
console.log('✓ State-triggered cues, hiding/hazard audio, reset, and disposal verified')

console.log('--- ALL 3D HORROR AUDIO TESTS PASSED SUCCESSFULLY! ---')
