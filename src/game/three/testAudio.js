import * as THREE from 'three'
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

assert(
  mockAudio.stats.delayNodesCreated === 2,
  'Effects and ambient corridor reverb delay nodes created when supported'
)
assert(
  Boolean(audioEngine._reverbDelay && audioEngine._ambientReverbDelay),
  'Dedicated effects and ambient corridor reverb chains initialized separately'
)
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

// Nearby PATROL enemy (<= 8.5m) must NOT trigger TENSION / proximity "BRRRR" buzz
enemy.state = ENEMY_STATES.PATROL
const playerPosTest = engine.getPlayerWorldPosition()
enemy.worldPos = { x: playerPosTest.x + 3.5, y: playerPosTest.y, z: playerPosTest.z }
for (let i = 0; i < 6; i += 1) {
  audio.update(0.016, {
    camera: engine.camera,
    playerWorldPos: playerPosTest,
    enemies: engine.enemyManager.enemies.values(),
    hazards: engine.hazardManager.hazards.values(),
  })
}
assert(
  audio.getAudioState().musicMood === MUSIC_MOODS.AMBIENT &&
    !audio
      .getCueHistory()
      .some((c) => c.type === 'music_mood_change' && c.mood === MUSIC_MOODS.TENSION),
  'Nearby patrolling enemy does NOT trigger TENSION proximity buzz'
)

// INVESTIGATE / SEARCH enemy activates restrained TENSION mood cleanly (step >2.0s after alert cooldown before CHASE)
enemy.state = ENEMY_STATES.INVESTIGATE
for (let i = 0; i < 5; i += 1) {
  audio.update(0.6, {
    camera: engine.camera,
    playerWorldPos: playerPosTest,
    enemies: engine.enemyManager.enemies.values(),
    hazards: engine.hazardManager.hazards.values(),
  })
}
assert(
  audio.getAudioState().musicMood === MUSIC_MOODS.TENSION,
  'Enemy INVESTIGATE state transitions adaptive music cleanly to TENSION'
)

// Hold CHASE for multiple frames -> enemy_detect_chase & chase music MUST trigger only once (no frame spam)
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

// Listener orientation quaternion math matches Three.js camera forward/up vectors under pitch + roll
const qAudioMock = createMockAudioContext()
const qAudio = new HorrorAudioEngine({
  createAudioContext: () => qAudioMock.ctx,
})
qAudio.unlock()
const euler = new THREE.Euler(Math.PI / 4, -Math.PI / 6, Math.PI / 12, 'YXZ')
const quat = new THREE.Quaternion().setFromEuler(euler)
const expectedForward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat)
const expectedUp = new THREE.Vector3(0, 1, 0).applyQuaternion(quat)
qAudio.updateListener({ position: { x: 4, y: 1.65, z: 6 }, quaternion: quat })
const f = qAudio._listenerForward
const u = qAudio._listenerUp
const dotFU = f.x * u.x + f.y * u.y + f.z * u.z
assert(
  Math.abs(dotFU) < 1e-6 &&
    Math.abs(f.x - expectedForward.x) < 1e-6 &&
    Math.abs(f.y - expectedForward.y) < 1e-6 &&
    Math.abs(f.z - expectedForward.z) < 1e-6 &&
    Math.abs(u.x - expectedUp.x) < 1e-6 &&
    Math.abs(u.y - expectedUp.y) < 1e-6 &&
    Math.abs(u.z - expectedUp.z) < 1e-6,
  'updateListener forward and up vectors remain orthonormal and match Three.js quaternion rotation under pitch/roll'
)

// In-flight positional AudioNode chains disconnect immediately on reset() and setMaze()
const beforeResetDisc = qAudioMock.stats.disconnectedCount
qAudio.playHorrorDirectorCue('environmental_sound', { x: 5, y: 1.5, z: 6 }, { variant: 0 })
assert(
  qAudio._activePositionalCleanups.size >= 1,
  'Positional cue registers active cleanup handle while in flight'
)
qAudio.reset()
assert(
  qAudio._activePositionalCleanups.size === 0 &&
    qAudioMock.stats.disconnectedCount > beforeResetDisc,
  'reset() immediately disconnects in-flight positional AudioNode chains'
)

const beforeMazeDisc = qAudioMock.stats.disconnectedCount
qAudio.playHorrorDirectorCue('distant_silhouette', { x: 5, y: 1.5, z: 6 })
assert(qAudio._activePositionalCleanups.size >= 1, 'Silhouette cue registers positional cleanup')
qAudio.setMaze(occlusionTestMaze)
assert(
  qAudio._activePositionalCleanups.size === 0 &&
    qAudioMock.stats.disconnectedCount > beforeMazeDisc,
  'setMaze() immediately disconnects in-flight positional AudioNode chains'
)
qAudio.dispose()

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

// 5. Heavy Elevator Landing Sound: dominant impact + underground shaft echo/reverb & node cleanup
console.log('Test 5: Cinematic Heavy Elevator Landing Sound Impact, Shaft Echo & Cleanup')
{
  const { triggerStartElevatorImpactCue } = await import('./audioSynthesis.js')
  const { ctx: elevCtx, stats: elevStats } = createMockAudioContext()
  const activeOscs = []
  const activeSrcs = []
  const createdBiquads = []
  const createdDelays = []
  const createdGains = []
  const origCreateOsc = elevCtx.createOscillator.bind(elevCtx)
  const origCreateSrc = elevCtx.createBufferSource.bind(elevCtx)
  const origCreateFilter = elevCtx.createBiquadFilter.bind(elevCtx)
  const origCreateDelay = elevCtx.createDelay.bind(elevCtx)
  const origCreateGain = elevCtx.createGain.bind(elevCtx)

  elevCtx.createOscillator = () => {
    const osc = origCreateOsc()
    const entry = { node: osc, startAt: null, stopAt: null, disconnected: false }
    const origStart = osc.start.bind(osc)
    const origStop = osc.stop.bind(osc)
    const origDisc = osc.disconnect.bind(osc)
    osc.start = (when = 0) => {
      entry.startAt = when
      return origStart(when)
    }
    osc.stop = (when = 0) => {
      entry.stopAt = when
      return origStop(when)
    }
    osc.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    activeOscs.push(entry)
    return osc
  }
  elevCtx.createBufferSource = () => {
    const src = origCreateSrc()
    const entry = { node: src, startAt: null, stopAt: null, dur: 0, disconnected: false }
    const origStart = src.start.bind(src)
    const origStop = src.stop.bind(src)
    const origDisc = src.disconnect.bind(src)
    src.start = (when = 0, off = 0, dur = 0) => {
      entry.startAt = when
      entry.dur = dur
      return origStart(when, off, dur)
    }
    src.stop = (when = 0) => {
      entry.stopAt = when
      return origStop(when)
    }
    src.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    activeSrcs.push(entry)
    return src
  }
  elevCtx.createBiquadFilter = () => {
    const f = origCreateFilter()
    createdBiquads.push(f)
    return f
  }
  elevCtx.createDelay = (maxDelayTime = 1) => {
    const d = origCreateDelay(maxDelayTime)
    const entry = { node: d, disconnected: false }
    const origDisc = d.disconnect.bind(d)
    d.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    createdDelays.push(entry)
    return d
  }
  elevCtx.createGain = () => {
    const g = origCreateGain()
    const entry = { node: g, maxGainScheduled: 0, disconnected: false }
    const origSet = g.gain.setValueAtTime.bind(g.gain)
    const origLin = g.gain.linearRampToValueAtTime.bind(g.gain)
    g.gain.setValueAtTime = (v, t) => {
      entry.maxGainScheduled = Math.max(entry.maxGainScheduled, Number(v) || 0)
      return origSet(v, t)
    }
    g.gain.linearRampToValueAtTime = (v, t) => {
      entry.maxGainScheduled = Math.max(entry.maxGainScheduled, Number(v) || 0)
      return origLin(v, t)
    }
    const origDisc = g.disconnect.bind(g)
    g.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    createdGains.push(entry)
    return g
  }

  const elevAudio = new HorrorAudioEngine({
    createAudioContext: () => elevCtx,
    recordCueHistory: true,
    volumes: { master: 0.85, effects: 0.65, ambience: 0.5, music: 0.4, muted: false },
  })
  assert(elevAudio.unlock() === true, 'Elevator audio engine unlocks cleanly')

  // Verify synthesis layer structure, dominant direct impact, shaft delay network & cue-bus filtering
  let directCompleteCalled = false
  const oscOffset = activeOscs.length
  const srcOffset = activeSrcs.length
  const delayOffset = createdDelays.length
  const gainOffset = createdGains.length
  const filterOffset = createdBiquads.length
  const directDest = elevAudio.effectsGain
  const directHandle = triggerStartElevatorImpactCue(
    elevCtx,
    directDest,
    elevAudio.noiseBuffer,
    {
      onComplete: () => {
        directCompleteCalled = true
      },
    }
  )
  const impactOscs = activeOscs.slice(oscOffset)
  const impactSrcs = activeSrcs.slice(srcOffset)
  const impactDelays = createdDelays.slice(delayOffset)
  const impactGains = createdGains.slice(gainOffset)
  const impactFilters = createdBiquads.slice(filterOffset)

  assert(Boolean(directHandle), 'triggerStartElevatorImpactCue returns valid handle')
  assert(
    directHandle.getNodeCount() >= 14,
    `Heavy landing cue builds multi-layer osc+noise+reverb structure (got ${directHandle.getNodeCount()} sources)`
  )
  assert(
    directHandle.durationSec >= 1.8 && directHandle.durationSec <= 3.0,
    `Heavy landing cue duration spans impact + 1.5-3s underground shaft echo tail (got ${directHandle.durationSec}s)`
  )
  assert(
    impactFilters.some((f) => f.type === 'highpass' && f.frequency.value >= 20 && f.frequency.value <= 30) &&
      impactFilters.some((f) => f.type === 'lowpass' && f.frequency.value >= 7000),
    'Cue bus preserves sub-30Hz impact weight while filtering ultrasonic fizz'
  )

  // Verify dominant direct impact peaks (not buried below 0.5 gain)
  const peakDirectGain = Math.max(...impactGains.map((g) => g.maxGainScheduled))
  assert(
    peakDirectGain >= 0.7 && peakDirectGain <= 1.0,
    `Main impact layers drive cue cleanly at strong foreground gain (peak=${peakDirectGain.toFixed(2)})`
  )

  // Verify dedicated underground shaft echo network: >=5 distinct DelayNodes + concrete air-damping filters
  const delayTimes = impactDelays.map((d) => Number(d.node.delayTime.value.toFixed(3)))
  const distinctDelayTimes = new Set(delayTimes)
  assert(
    impactDelays.length >= 5 && distinctDelayTimes.size >= 5,
    `Underground shaft echo network creates >=5 distinct DelayNodes (got ${impactDelays.length}: [${delayTimes.join(', ')}])`
  )
  assert(
    impactFilters.some((f) => f.type === 'lowpass' && f.frequency.value >= 900 && f.frequency.value <= 2800),
    'Underground shaft echoes apply progressive concrete lowpass damping'
  )

  const minStart = Math.min(...impactOscs.map((o) => o.startAt), ...impactSrcs.map((s) => s.startAt))
  const maxStart = Math.max(...impactOscs.map((o) => o.startAt), ...impactSrcs.map((s) => s.startAt))
  const maxEnd = Math.max(
    ...impactOscs.map((o) => o.stopAt || o.startAt),
    ...impactSrcs.map((s) => s.stopAt || s.startAt + s.dur)
  )
  assert(
    Math.abs(minStart - elevCtx.currentTime) < 1e-4,
    'Primary thud/collision layers start immediately at touchdown'
  )
  assert(
    maxStart - elevCtx.currentTime >= 0.65,
    `Secondary rattle & settling layers extend across settling phase (latestStart=${(maxStart - elevCtx.currentTime).toFixed(3)}s)`
  )
  assert(
    maxEnd - elevCtx.currentTime >= 2.1,
    `Diffuse underground concrete shaft reverberation tail extends smoothly >2.1s (tailEnd=${(maxEnd - elevCtx.currentTime).toFixed(3)}s)`
  )

  // Immediate stop disconnects every scheduled source, delay, and gain node and triggers completion callback
  const oscStoppedBefore = elevStats.oscillatorsStopped
  const bufStoppedBefore = elevStats.bufferSourcesStopped
  directHandle.stop({ immediate: true })
  assert(directCompleteCalled === true, 'Immediate stop notifies cue completion cleanup')
  assert(directHandle.isActive() === false, 'Cue handle reports inactive after immediate stop')
  assert(
    elevStats.oscillatorsStopped > oscStoppedBefore &&
      elevStats.bufferSourcesStopped > bufStoppedBefore &&
      impactOscs.every((o) => o.disconnected) &&
      impactSrcs.every((s) => s.disconnected) &&
      impactDelays.every((d) => d.disconnected),
    'Stopping landing cue stops and disconnects all oscillator, noise source, and shaft DelayNodes'
  )

  // Verify HorrorAudioEngine tracking, volume/mute respect, stopElevatorCues, reset & dispose
  assert(elevAudio.onStartElevatorImpact() === true, 'onStartElevatorImpact returns true when unlocked')
  assert(
    elevAudio.getAudioState().activeElevatorCueCount === 1,
    'Active elevator cue tracked cleanly in HorrorAudioEngine'
  )
  assert(
    elevAudio.getEffectiveVolumes().effects === 0.85 * 0.65,
    'Master & effects volume scaling governs impact output bus'
  )
  elevAudio.setMuted(true)
  assert(elevAudio.masterGain.gain.value === 0, 'Mute silences master bus cleanly for elevator impact')
  elevAudio.setMuted(false)

  elevAudio.stopElevatorCues({ immediate: true })
  assert(
    elevAudio.getAudioState().activeElevatorCueCount === 0,
    'stopElevatorCues({ immediate: true }) clears all tracked elevator cue handles'
  )

  elevAudio.onStartElevatorImpact()
  assert(elevAudio.getAudioState().activeElevatorCueCount === 1, 'Re-triggered cue tracked')
  elevAudio.reset()
  assert(
    elevAudio.getAudioState().activeElevatorCueCount === 0,
    'HorrorAudioEngine.reset() clears active elevator cues without leaving nodes'
  )

  elevAudio.onStartElevatorImpact()
  elevAudio.dispose()
  assert(
    elevAudio.getAudioState().activeElevatorCueCount === 0 && elevAudio.isDisposed === true,
    'HorrorAudioEngine.dispose() shuts down active elevator cues cleanly'
  )

  // Verify browser ConvolverNode + WaveShaperNode shaft path builds IR buffer and cleans it on stop
  const { ctx: richCtx } = createMockAudioContext()
  const richConvolvers = []
  const richShapers = []
  richCtx.createWaveShaper = () => {
    const entry = { curve: null, oversample: 'none', disconnected: false }
    const node = {
      ...entry,
      connect() {},
      disconnect() {
        entry.disconnected = true
      },
    }
    Object.defineProperty(node, 'curve', {
      get: () => entry.curve,
      set: (v) => {
        entry.curve = v
      },
    })
    richShapers.push(entry)
    return node
  }
  richCtx.createConvolver = () => {
    const entry = { buffer: null, disconnected: false }
    const node = {
      connect() {},
      disconnect() {
        entry.disconnected = true
      },
    }
    Object.defineProperty(node, 'buffer', {
      get: () => entry.buffer,
      set: (v) => {
        entry.buffer = v
      },
    })
    richConvolvers.push(entry)
    return node
  }
  const richEngine = new HorrorAudioEngine({ createAudioContext: () => richCtx })
  richEngine.unlock()
  const richHandle = triggerStartElevatorImpactCue(
    richCtx,
    richEngine.effectsGain,
    richEngine.noiseBuffer
  )
  assert(
    richShapers.length === 1 &&
      richShapers[0].curve instanceof Float32Array &&
      richConvolvers.length === 1 &&
      richConvolvers[0].buffer &&
      richConvolvers[0].buffer.duration >= 1.5,
    'Browser WaveShaper saturation & ConvolverNode concrete-shaft IR created when supported'
  )
  richHandle.stop({ immediate: true })
  assert(
    richShapers[0].disconnected &&
      richConvolvers[0].disconnected &&
      richConvolvers[0].buffer === null,
    'Stopping cue clears ConvolverNode buffer and disconnects optional browser nodes cleanly'
  )
  richEngine.dispose()
}
console.log('✓ Heavy elevator landing sound layers, filtering, volumes, and cleanup verified')

// 6. Procedural Player Vocal Reactions: Impact Shock Grunt & Damage Pain Variations
console.log('Test 6: Procedural Player Vocal Reactions (Impact Grunt & Damage Pain)')
{
  const {
    PLAYER_DAMAGE_VOCAL_VARIANTS,
    triggerPlayerDamageCue,
    triggerPlayerImpactVocalCue,
  } = await import('./audioSynthesis.js')
  const { ctx: vocCtx, stats: vocStats } = createMockAudioContext()
  const vocalOscs = []
  const vocalSrcs = []
  const vocalFilters = []
  const origOsc = vocCtx.createOscillator.bind(vocCtx)
  const origSrc = vocCtx.createBufferSource.bind(vocCtx)
  const origFilter = vocCtx.createBiquadFilter.bind(vocCtx)

  vocCtx.createOscillator = () => {
    const osc = origOsc()
    const entry = { node: osc, startAt: null, stopAt: null, freq: null, disconnected: false }
    const s = osc.start.bind(osc)
    const st = osc.stop.bind(osc)
    const d = osc.disconnect.bind(osc)
    osc.start = (when = 0) => {
      entry.startAt = when
      return s(when)
    }
    osc.stop = (when = 0) => {
      entry.stopAt = when
      return st(when)
    }
    osc.disconnect = () => {
      entry.disconnected = true
      return d()
    }
    vocalOscs.push(entry)
    return osc
  }
  vocCtx.createBufferSource = () => {
    const src = origSrc()
    const entry = { node: src, startAt: null, dur: 0, disconnected: false }
    const s = src.start.bind(src)
    const d = src.disconnect.bind(src)
    src.start = (when = 0, off = 0, dur = 0) => {
      entry.startAt = when
      entry.dur = dur
      return s(when, off, dur)
    }
    src.disconnect = () => {
      entry.disconnected = true
      return d()
    }
    vocalSrcs.push(entry)
    return src
  }
  vocCtx.createBiquadFilter = () => {
    const f = origFilter()
    const entry = { node: f, freqs: [], disconnected: false }
    const origSet = f.frequency.setValueAtTime.bind(f.frequency)
    const origDisc = f.disconnect.bind(f)
    f.frequency.setValueAtTime = (v, t) => {
      entry.freqs.push(v)
      return origSet(v, t)
    }
    f.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    vocalFilters.push(entry)
    return f
  }

  const vocAudio = new HorrorAudioEngine({
    createAudioContext: () => vocCtx,
    recordCueHistory: true,
    volumes: { master: 0.85, effects: 0.75, ambience: 0.5, music: 0.4, muted: false },
  })
  assert(vocAudio.unlock() === true, 'Vocal audio engine unlocks cleanly')

  // 6a. Verify elevator impact vocal synthesis topology (glottal pitch + F1/F2/F3 formants + breath, 50-120ms delay)
  const o0 = vocalOscs.length
  const s0 = vocalSrcs.length
  const f0 = vocalFilters.length
  const impHandle = triggerPlayerImpactVocalCue(vocCtx, vocAudio.effectsGain, vocAudio.noiseBuffer, {
    delaySec: 0.08,
  })
  const impOscs = vocalOscs.slice(o0)
  const impSrcs = vocalSrcs.slice(s0)
  const impFilters = vocalFilters.slice(f0)
  assert(Boolean(impHandle) && impHandle.kind === 'impact_grunt', 'Impact vocal returns valid handle')
  assert(impOscs.length >= 3 && impSrcs.length >= 2, 'Impact vocal uses glottal+chest+vibrato oscs and breath noise')
  assert(
    impOscs.every((o) => Math.abs(o.startAt - (vocCtx.currentTime + 0.08)) < 1e-4),
    'Impact vocal schedules ~80ms after elevator touchdown (inside 50-120ms)'
  )
  assert(
    impFilters.some((f) => f.node.type === 'bandpass' && f.freqs.some((hz) => hz >= 450 && hz <= 750)) &&
      impFilters.some((f) => f.node.type === 'bandpass' && f.freqs.some((hz) => hz >= 950 && hz <= 1450)) &&
      impFilters.some((f) => f.node.type === 'bandpass' && f.freqs.some((hz) => hz >= 2000 && hz <= 2700)),
    'Impact vocal routes through parallel F1/F2/F3 male vocal-tract formant bandpass filters'
  )
  impHandle.stop({ immediate: true })
  assert(
    impOscs.every((o) => o.disconnected) &&
      impSrcs.every((s) => s.disconnected) &&
      impFilters.every((f) => f.disconnected),
    'Stopping impact vocal disconnects every oscillator, breath source, and formant filter'
  )

  // 6b. Verify all 3 damage vocal variations differ in pitch/formant/duration
  assert(PLAYER_DAMAGE_VOCAL_VARIANTS.length === 3, 'Three damage vocal variations defined')
  const dmgHandles = PLAYER_DAMAGE_VOCAL_VARIANTS.map((variant) =>
    triggerPlayerDamageCue(vocCtx, vocAudio.effectsGain, vocAudio.noiseBuffer, { variant })
  )
  assert(
    dmgHandles.every((h) => h && h.kind === 'damage_vocal') &&
      dmgHandles[2].durationSec > dmgHandles[1].durationSec,
    'Damage variants create distinct durations (strained_groan longer than sharp_impact)'
  )
  dmgHandles.forEach((h) => h.stop({ immediate: true }))

  // 6c. Cooldown, anti-repetition variation & voice priority inside HorrorAudioEngine
  vocAudio.clearCueHistory()
  const oscStartCount0 = vocStats.oscillatorsStarted
  assert(vocAudio.onPlayerDamage({ damage: 20, healthDelta: 20 }) === true, 'First damage vocal plays')
  assert(vocAudio.getAudioState().activeVocalCueCount === 1, 'Active vocal cue tracked')
  // Verify combat audio priority: enemy attack impact audio is temporarily ducked by 30-40% (0.65 gain)
  assert(vocAudio.getAudioState().combatDucked === true, 'Combat ducking activated on damage vocal')
  assert(
    Math.abs(vocAudio.enemyAttackGain.gain.value - 0.65) < 1e-4,
    `Enemy attack impact audio ducked to 0.65 (-35%, in 30-40% range) (got ${vocAudio.enemyAttackGain.gain.value})`
  )

  // Duplicate call within cooldown (< 0.28s) must NOT double-trigger or create overlapping voice
  assert(
    vocAudio.onPlayerDamage({ damage: 20, healthDelta: 20 }) === false,
    'Duplicate damage call within cooldown is suppressed cleanly'
  )
  // Blocking / 0-damage / healing calls must NEVER trigger damage vocal or ducking
  assert(vocAudio.onPlayerDamage({ damage: 0, healthDelta: 0 }) === false, 'Zero damage does not trigger vocal')
  assert(vocAudio.onPlayerDamage({ damage: 25, healthDelta: 0 }) === false, 'Zero healthDelta does not trigger vocal')
  assert(vocAudio.onPlayerDamage({ damage: 25, blocked: true }) === false, 'Blocked damage does not trigger vocal')
  assert(vocAudio.onPlayerDamage({ damage: 25, immune: true }) === false, 'Immune damage does not trigger vocal')
  assert(vocAudio.onPlayerDamage({ damage: 25, healing: true }) === false, 'Healing flag does not trigger vocal')

  // Elevator impact grunt has lower priority than an active damage vocal
  assert(vocAudio.onPlayerImpactReaction() === false, 'Impact grunt does not cut off active damage vocal')
  assert(
    vocStats.oscillatorsStarted - oscStartCount0 === 3,
    'Only the first valid damage vocal spawned oscillators during cooldown window'
  )

  // Step audio time past vocal duration -> ducking smoothly restores to 1.0
  vocCtx.currentTime += 0.6
  vocAudio.update(0.6)
  assert(
    vocAudio.getAudioState().combatDucked === false &&
      Math.abs(vocAudio.enemyAttackGain.gain.value - 1.0) < 1e-4,
    'Combat ducking smoothly restores enemy attack audio back to 1.0 after vocal completes'
  )

  // Advance past cooldown -> plays a DIFFERENT variation from the previous hit
  assert(vocAudio.onPlayerDamage({ damage: 22, healthDelta: 22 }) === true, 'Damage vocal plays again after cooldown')
  const damageHistory = vocAudio.getCueHistory().filter((c) => c.type === 'player_damage')
  assert(
    damageHistory.length === 2 && damageHistory[0].variant !== damageHistory[1].variant,
    `Consecutive damage reactions rotate variants (${damageHistory[0]?.variant} -> ${damageHistory[1]?.variant})`
  )

  // Voice priority: damage vocal overrides an active elevator impact grunt cleanly with 0 overlap
  vocCtx.currentTime += 0.65
  assert(vocAudio.onPlayerImpactReaction({ delaySec: 0.08 }) === true, 'Impact reaction plays after cooldown')
  assert(vocAudio.onPlayerDamage({ damage: 30, healthDelta: 30 }) === true, 'Damage vocal overrides active impact grunt')
  assert(vocAudio.getAudioState().activeVocalCueCount === 1, 'Only 1 vocal cue active after priority replacement')

  // Pause, reset & dispose cleanup
  vocAudio.setPaused(true)
  assert(vocAudio.onPlayerDamage({ damage: 20, healthDelta: 20 }) === false, 'Paused audio refuses vocal synthesis')
  vocAudio.setPaused(false)
  vocCtx.currentTime += 0.5
  assert(vocAudio.onPlayerDamage({ damage: 20, healthDelta: 20 }) === true, 'Unpaused vocal plays cleanly')
  vocAudio.reset()
  assert(vocAudio.getAudioState().activeVocalCueCount === 0, 'reset() stops and clears active vocal cue')
  assert(
    vocAudio.getAudioState().combatDucked === false &&
      Math.abs(vocAudio.enemyAttackGain.gain.value - 1.0) < 1e-4,
    'reset() restores enemy attack gain back to 1.0'
  )
  vocAudio.dispose()

  // 6d. Integrated MazeSceneEngine: enemy attack, hazard hit, immunity block, healing/setHealth safety
  const vocEngineMock = createMockAudioContext()
  const vocEngine = createHeadlessEngine({
    enemies: { autoSpawn: false },
    audio: {
      createAudioContext: () => vocEngineMock.ctx,
      recordCueHistory: true,
    },
  })
  assert(vocEngine.unlockAudio() === true, 'Integrated vocal engine unlocks cleanly')
  vocEngine.setMaze(occlusionTestMaze)
  vocEngine.cancelSpawnSequence()
  const vAudio = vocEngine.getAudioEngine()
  vAudio.clearCueHistory()

  // Enemy damage reduces HP -> plays damage vocal and ducks competing enemy attack audio
  assert(vocEngine.applyDamage(20, { enemyId: 'stalker-1', enemyType: 'stalker' }) === true)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 1,
    'Enemy damage triggers player_damage vocal reaction'
  )
  assert(
    vAudio.getAudioState().combatDucked === true,
    'Enemy damage immediately ducks combat attack audio'
  )
  assert(
    Math.abs(vAudio.enemyAttackGain.gain.value - 0.65) < 1e-4,
    'Enemy attack audio bus is reduced by 35% (0.65)'
  )

  // Step engine frame forward past vocal duration -> ducking smoothly restores
  vocEngineMock.ctx.currentTime += 0.6
  vocEngine.stepFrame(0.6, { render: false })
  assert(
    vAudio.getAudioState().combatDucked === false &&
      Math.abs(vAudio.enemyAttackGain.gain.value - 1.0) < 1e-4,
    'Enemy attack bus restores to 1.0 after vocal finishes'
  )

  // Invulnerability blocks damage -> HP stays 80 -> NO vocal reaction
  const oscDuringImmune = vocEngineMock.stats.oscillatorsStarted
  assert(vocEngine.applyDamage(20, { enemyId: 'stalker-1' }) === false)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 1 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringImmune,
    'Blocked damage during immunity produces zero vocal reaction'
  )
  // Healing via setHealth(100) restores HP -> NO pain vocal reaction
  vocEngine.setHealth(100)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 1 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringImmune,
    'Healing/restoring health produces zero pain vocal reaction'
  )

  // Environmental hazard damage reduces HP -> plays damage vocal through centralized path
  vocEngine.damageImmunityTimer = 0
  vocEngineMock.ctx.currentTime += 0.5
  assert(
    vocEngine.applyDamage(25, { hazardId: 'spikes-1', hazardType: HAZARD_TYPES.FLOOR_SPIKES }) ===
      true
  )
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 2,
    'Hazard damage triggers centralized player_damage vocal reaction'
  )

  // Extraction immunity blocks damage -> NO vocal reaction
  vocEngine.damageImmunityTimer = 0
  vocEngineMock.ctx.currentTime += 0.5
  vocEngine.startExtractionSequence()
  const oscDuringExtract = vocEngineMock.stats.oscillatorsStarted
  assert(vocEngine.applyDamage(25, { enemyId: 'stalker-1' }) === false)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 2 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringExtract,
    'Extraction protection blocks damage and triggers zero vocal audio'
  )
  vocEngine.dispose()
}
console.log('✓ Procedural player vocal reactions (elevator shock grunt & damage pain variants) verified')

// 7. Locked-Context Elevator Cue Queuing & Unlock Flushing
console.log('Test 7: Locked-Context Elevator Cue Queuing & Unlock Flushing')
{
  const lockMock = createMockAudioContext()
  const lockAudio = new HorrorAudioEngine({
    createAudioContext: () => lockMock.ctx,
    recordCueHistory: true,
  })
  assert(lockAudio.isUnlocked === false, 'Audio engine starts locked')

  // Triggering elevator impact and impact reaction while locked -> queues cues, plays nothing yet
  const impactRes = lockAudio.onStartElevatorImpact()
  const vocalRes = lockAudio.onPlayerImpactReaction({ delaySec: 0.08 })
  assert(impactRes === false, 'Elevator impact returns false while locked')
  assert(vocalRes === false, 'Impact reaction returns false while locked')
  assert(lockMock.stats.oscillatorsStarted === 0, 'No oscillators started while locked')

  // Unlocking -> flushes pending elevator impact and impact vocal cues cleanly
  const unlocked = lockAudio.unlock()
  assert(unlocked === true, 'unlock() succeeds')
  assert(lockAudio.isUnlocked === true, 'Audio engine is now unlocked')
  assert(lockMock.stats.oscillatorsStarted > 0, 'Queued elevator and vocal audio cues play upon unlock')

  const impactHistory = lockAudio.getCueHistory().filter((c) => c.type === 'start_elevator_impact')
  const vocalHistory = lockAudio.getCueHistory().filter((c) => c.type === 'player_impact_vocal')
  assert(impactHistory.length === 1, 'Elevator impact recorded in history')
  assert(vocalHistory.length === 1, 'Player impact vocal recorded in history')

  // Repeated unlock does not duplicate queued cues
  lockAudio.clearCueHistory()
  lockAudio.unlock()
  assert(lockAudio.getCueHistory().length === 0, 'Repeated unlock does not re-flush or duplicate cues')

  // Reset clears pending queue
  lockAudio.reset()
  lockAudio.dispose()
}
console.log('✓ Locked-context elevator cue queuing and unlock flushing verified')

console.log('--- ALL 3D HORROR AUDIO TESTS PASSED SUCCESSFULLY! ---')
