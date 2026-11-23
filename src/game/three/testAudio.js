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
  AUDITION_PRESETS,
  VOCAL_AUDITION_PRESETS,
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
  mockAudio.stats.delayNodesCreated === 3,
  'Effects, enemy vocal/breath, and ambient corridor reverb delay nodes created when supported'
)
assert(
  Boolean(
    audioEngine._reverbDelay &&
      audioEngine._enemyVocalReverbDelay &&
      audioEngine._ambientReverbDelay
  ),
  'Dedicated effects, enemyVocal, and ambient corridor reverb chains initialized separately'
)
assert(
  Math.abs(audioEngine._reverbWetGain.gain.value - 0.16) < 1e-6 &&
    Math.abs(audioEngine._enemyVocalReverbWetGain.gain.value - 0.16) < 1e-6,
  'Corridor and enemy vocal reverb wet gains enabled by default'
)
audioEngine.setAudioOptions({ footstepEchoes: false, spatialAudio: false })
assert(
  audioEngine._reverbWetGain.gain.value === 0 &&
    audioEngine._enemyVocalReverbWetGain.gain.value === 0,
  'Disabling footstepEchoes mutes corridor and enemy vocal reverb wet sends'
)
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

  // 6a. Verify elevator impact vocal synthesis topology (direct PCM AudioBufferSourceNode, 0 OscillatorNodes, 50-120ms delay)
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
  assert(
    impOscs.length === 0 && impSrcs.length === 1 && Boolean(impHandle.pcmBuffer),
    'Impact vocal uses 0 OscillatorNodes and 1 sample-level PCM AudioBufferSourceNode'
  )
  assert(
    Math.abs(impSrcs[0].startAt - (vocCtx.currentTime + 0.08)) < 1e-4,
    'Impact vocal schedules ~80ms after elevator touchdown (inside 50-120ms)'
  )
  assert(
    impFilters.length === 2 &&
      impFilters.some((f) => f.node.type === 'highpass' && f.node.frequency.value === 100) &&
      impFilters.some((f) => f.node.type === 'lowpass' && f.node.frequency.value === 8400),
    'Impact vocal routes PCM buffer through clean cue-bus highpass(100Hz)/lowpass(8400Hz) without parallel biquad formant cancellation'
  )
  impHandle.stop({ immediate: true })
  assert(
    impSrcs.every((s) => s.disconnected) && impFilters.every((f) => f.disconnected),
    'Stopping impact vocal disconnects PCM AudioBufferSourceNode and cue-bus filters'
  )

  // 6b. Verify all 3 damage vocal variations differ in pitch/formant/duration
  assert(PLAYER_DAMAGE_VOCAL_VARIANTS.length === 3, 'Three damage vocal variations defined')
  const dmgHandles = PLAYER_DAMAGE_VOCAL_VARIANTS.map((variant) =>
    triggerPlayerDamageCue(vocCtx, vocAudio.effectsGain, vocAudio.noiseBuffer, { variant })
  )
  assert(
    dmgHandles.every((h) => h && h.kind === 'damage_vocal' && Boolean(h.pcmBuffer)) &&
      dmgHandles[2].durationSec > dmgHandles[1].durationSec &&
      dmgHandles[1].durationSec > dmgHandles[0].durationSec,
    'Damage variants create distinct PCM durations (strained_groan > sharp_impact > short_grunt)'
  )
  dmgHandles.forEach((h) => h.stop({ immediate: true }))

  // 6c. Cooldown, anti-repetition variation & voice priority inside HorrorAudioEngine
  vocAudio.clearCueHistory()
  const oscStartCount0 = vocStats.oscillatorsStarted
  const bufStartCount0 = vocStats.bufferSourcesStarted
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
    vocStats.oscillatorsStarted - oscStartCount0 === 0 &&
      vocStats.bufferSourcesStarted - bufStartCount0 === 1,
    'Only the first valid damage vocal spawned 1 PCM AudioBufferSourceNode (and 0 oscillators) during cooldown window'
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
  const bufDuringImmune = vocEngineMock.stats.bufferSourcesStarted
  assert(vocEngine.applyDamage(20, { enemyId: 'stalker-1' }) === false)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 1 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringImmune &&
      vocEngineMock.stats.bufferSourcesStarted === bufDuringImmune,
    'Blocked damage during immunity produces zero vocal reaction'
  )
  // Healing via setHealth(100) restores HP -> NO pain vocal reaction
  vocEngine.setHealth(100)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 1 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringImmune &&
      vocEngineMock.stats.bufferSourcesStarted === bufDuringImmune,
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
  const bufDuringExtract = vocEngineMock.stats.bufferSourcesStarted
  assert(vocEngine.applyDamage(25, { enemyId: 'stalker-1' }) === false)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 2 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringExtract &&
      vocEngineMock.stats.bufferSourcesStarted === bufDuringExtract,
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

// 8. Browser Async AudioContext.resume(), Non-Activating Gesture Retry & preserveSpawnSequence Queue Retention
console.log('Test 8: Browser Async Resume, Non-Activating Gesture Retry & Lifecycle Queue Retention')
{
  const asyncMock = createMockAudioContext()
  const stateListeners = new Set()
  let allowResume = false
  let resolvePendingResume = null

  asyncMock.ctx.addEventListener = (type, fn) => {
    if (type === 'statechange' && typeof fn === 'function') stateListeners.add(fn)
  }
  asyncMock.ctx.removeEventListener = (type, fn) => {
    if (type === 'statechange') stateListeners.delete(fn)
  }
  asyncMock.ctx.resume = () => {
    asyncMock.stats.resumeCount += 1
    if (!allowResume) {
      // Simulate non-activating first gesture (e.g., modifier key or iOS pointerdown): stays suspended
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      resolvePendingResume = () => {
        asyncMock.ctx.state = 'running'
        for (const fn of stateListeners) fn()
        resolve()
      }
    })
  }

  const asyncEngine = createHeadlessEngine({
    enemies: { autoSpawn: false },
    audio: {
      createAudioContext: () => asyncMock.ctx,
      recordCueHistory: true,
    },
  })
  asyncEngine.setMaze(occlusionTestMaze)
  const asyncAudio = asyncEngine.getAudioEngine()

  // Simulate full starting elevator descent -> landing touchdown while audio is locked
  for (let i = 0; i < 40; i += 1) {
    asyncEngine.stepFrame(0.05, { render: false })
  }
  assert(
    asyncAudio._pendingElevatorImpact === true && asyncAudio._pendingImpactVocal === true,
    'Elevator descent landing queues both impact cue and balance-shock grunt while audio is locked'
  )
  assert(
    asyncMock.stats.oscillatorsStarted === 0,
    'Zero oscillators spawn while AudioContext has not yet unlocked'
  )

  // Lifecycle sync resetCombat({ preserveSpawnSequence: true }) must NOT wipe the queued cues
  asyncEngine.resetCombat({ preserveSpawnSequence: true })
  assert(
    asyncAudio._pendingElevatorImpact === true && asyncAudio._pendingImpactVocal === true,
    'resetCombat({ preserveSpawnSequence: true }) preserves queued elevator impact and vocal cues'
  )

  // First non-activating gesture leaves context suspended: unlock returns false & queue stays intact
  assert(
    asyncEngine.unlockAudio() === false,
    'Non-activating gesture keeping context suspended returns false from unlockAudio()'
  )
  await Promise.resolve()
  assert(
    asyncAudio.isUnlocked === false &&
      asyncAudio._pendingElevatorImpact === true &&
      asyncAudio._pendingImpactVocal === true &&
      asyncMock.stats.oscillatorsStarted === 0,
    'Failed/non-activating resume keeps engine locked and preserves pending elevator cues'
  )

  // Second legitimate gesture triggers real async AudioContext.resume()
  allowResume = true
  const syncReturn = asyncEngine.unlockAudio()
  assert(
    syncReturn === false && asyncAudio.isUnlocked === false,
    'Async resume does not mark unlocked or flush cues before AudioContext enters running state'
  )
  assert(
    asyncMock.stats.oscillatorsStarted === 0,
    'No cues flush onto a still-suspended AudioContext'
  )

  // Audio thread completes resume -> statechange + Promise resolve -> flush cues cleanly once
  resolvePendingResume()
  await Promise.resolve()
  await Promise.resolve()

  assert(asyncAudio.isUnlocked === true, 'Async resume completion unlocks HorrorAudioEngine')
  assert(
    asyncAudio._pendingElevatorImpact === false &&
      asyncAudio._pendingImpactVocal === false &&
      asyncAudio._flushedElevatorImpact === true &&
      asyncAudio._flushedImpactVocal === true,
    'Queued elevator impact and balance-shock grunt flush exactly once after async resume'
  )
  assert(
    asyncAudio.getAudioState().activeElevatorCueCount === 1 &&
      asyncAudio.getAudioState().activeVocalCueCount === 1,
    'Both elevator impact and balance-shock grunt are active after async unlock'
  )
  assert(
    Math.abs(asyncAudio.getAudioState().playerVocalGain - 0.84) < 1e-4 &&
      asyncAudio.getAudioState().elevatorDucked === true &&
      Math.abs(asyncAudio.getAudioState().elevatorImpactGain - 0.58) < 1e-4,
    'Flushed balance-shock grunt routes through natural playerVocalGain (0.84) and gently ducks elevatorImpactGain to 0.58'
  )
  const oscAfterFlush = asyncMock.stats.oscillatorsStarted
  assert(oscAfterFlush > 0, 'Queued elevator impact and vocal spawned audio nodes on running context')

  // Subsequent unlock call returns true and produces zero duplication
  assert(asyncEngine.unlockAudio() === true, 'Subsequent unlockAudio() returns true once running')
  assert(
    asyncMock.stats.oscillatorsStarted === oscAfterFlush,
    'Subsequent unlockAudio() does not duplicate elevator impact or balance-shock grunt'
  )

  // Advancing past the landing grunt restores elevatorImpactGain smoothly to 1.0 for shaft echo tail
  asyncAudio.update(0.75, {})
  assert(
    asyncAudio.getAudioState().elevatorDucked === false &&
      Math.abs(asyncAudio.getAudioState().elevatorImpactGain - 1.0) < 1e-4,
    'elevatorImpactGain restores smoothly to 1.0 after landing grunt completes'
  )

  asyncEngine.dispose()
  assert(stateListeners.size === 0, 'dispose() detaches AudioContext statechange listener cleanly')
}
console.log('✓ Browser async resume, non-activating gesture retry, and lifecycle queue retention verified')

// 9. Combat Damage Vocal Integrity & Phase 7 Procedural Human Vocal PCM Engine Verification
console.log('Test 9: Combat Damage Vocal Variants, Delayed Event Dedup, Stale onComplete Guard & Phase 7 PCM Engine')
{
  const {
    VOCAL_PCM_PRESET_SPECS,
    renderHumanVocalTrackBuffer,
    triggerPlayerDamageCue,
    triggerPlayerImpactVocalCue,
  } = await import('./audioSynthesis.js')

  const combatMock = createMockAudioContext()
  let cancelAndHoldCalls = 0
  const origCreateGain = combatMock.ctx.createGain.bind(combatMock.ctx)
  combatMock.ctx.createGain = () => {
    const node = origCreateGain()
    node.gain.cancelAndHoldAtTime = () => {
      cancelAndHoldCalls += 1
    }
    return node
  }

  // Track oscillator & buffer source onended callbacks without firing them synchronously on stop() so we can test real-browser async onended races
  const deferredSources = []
  const origCreateOsc = combatMock.ctx.createOscillator.bind(combatMock.ctx)
  combatMock.ctx.createOscillator = () => {
    const osc = origCreateOsc()
    osc.stop = () => {
      combatMock.stats.oscillatorsStopped += 1
    }
    deferredSources.push(osc)
    return osc
  }
  const origCreateBuf = combatMock.ctx.createBufferSource.bind(combatMock.ctx)
  combatMock.ctx.createBufferSource = () => {
    const src = origCreateBuf()
    src.stop = () => {
      combatMock.stats.bufferSourcesStopped += 1
    }
    deferredSources.push(src)
    return src
  }

  const combatEngine = createHeadlessEngine({
    enemies: { autoSpawn: false },
    audio: {
      createAudioContext: () => combatMock.ctx,
      recordCueHistory: true,
    },
  })
  assert(combatEngine.unlockAudio() === true, 'Combat test engine unlocks cleanly')
  combatEngine.setMaze(occlusionTestMaze)
  combatEngine.cancelSpawnSequence()
  const cAudio = combatEngine.getAudioEngine()
  cAudio.clearCueHistory()

  // Hit 1 (enemy damage): HP drops, pain vocal plays, enemyAttackGain ducks to 0.65 with cancelAndHoldAtTime
  const srcCountBeforeHit1 = deferredSources.length
  const hpBefore1 = combatEngine.getHealth().health
  assert(combatEngine.applyDamage(20, { enemyId: 'stalker-9', enemyType: 'stalker' }) === true)
  assert(combatEngine.getHealth().health === hpBefore1 - 20, 'Enemy hit decreases player HP')
  assert(
    cAudio.getAudioState().combatDucked === true &&
      Math.abs(cAudio.getAudioState().playerVocalGain - 0.84) < 1e-4 &&
      Math.abs(cAudio.enemyAttackGain.gain.value - 0.65) < 1e-4 &&
      Math.abs(cAudio.hazardAudioGain.gain.value - 0.6) < 1e-4 &&
      cancelAndHoldCalls >= 1,
    'Enemy damage uses natural vocal bus (0.84), cancels prior automation, and ducks enemyAttackGain (0.65) and hazardAudioGain (0.60)'
  )
  const hit1Sources = deferredSources.slice(srcCountBeforeHit1)

  // Delayed React lastEvent ('player_damaged') arriving 350ms later (past 280ms vocal cooldown, inside 1.2s immunity) MUST NOT double-trigger
  combatMock.ctx.currentTime += 0.35
  const dupPlayed = combatEngine.handleGameEvent({
    id: 9001,
    type: 'player_damaged',
    damage: 20,
    healthDelta: 20,
  })
  assert(
    dupPlayed === false &&
      cAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 1,
    'Delayed React player_damaged event during immunity window does not double-trigger vocal'
  )

  // Hit 2 (hazard damage after immunity cleared): triggers a second vocal while Hit 1 onended hasn't fired yet
  combatEngine.damageImmunityTimer = 0
  combatMock.ctx.currentTime += 0.4
  const srcCountBeforeHit2 = deferredSources.length
  const hpBefore2 = combatEngine.getHealth().health
  assert(
    combatEngine.applyDamage(20, {
      hazardId: 'spikes-9',
      hazardType: HAZARD_TYPES.FLOOR_SPIKES,
    }) === true
  )
  assert(combatEngine.getHealth().health === hpBefore2 - 20, 'Hazard hit decreases player HP')
  assert(
    cAudio.getAudioState().combatDucked === true &&
      Math.abs(cAudio.enemyAttackGain.gain.value - 0.65) < 1e-4 &&
      Math.abs(cAudio.hazardAudioGain.gain.value - 0.6) < 1e-4,
    'Second damage hit keeps enemyAttackGain (0.65) and hazardAudioGain (0.60) ducked'
  )
  const hit2Sources = deferredSources.slice(srcCountBeforeHit2)

  // Stale Hit 1 onended callbacks fire late -> MUST NOT prematurely restore combat ducking for active Hit 2!
  hit1Sources.forEach((s) => s.onended?.())
  assert(
    cAudio.getAudioState().combatDucked === true &&
      Math.abs(cAudio.enemyAttackGain.gain.value - 0.65) < 1e-4 &&
      Math.abs(cAudio.hazardAudioGain.gain.value - 0.6) < 1e-4,
    'Stale onended callback from previous vocal does not prematurely unduck active damage vocal'
  )

  // Current Hit 2 finishes -> smoothly restores enemyAttackGain and hazardAudioGain to 1.0
  hit2Sources.forEach((s) => s.onended?.())
  assert(
    cAudio.getAudioState().combatDucked === false &&
      Math.abs(cAudio.enemyAttackGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(cAudio.hazardAudioGain.gain.value - 1.0) < 1e-4,
    'Active damage vocal completion smoothly restores enemyAttackGain and hazardAudioGain back to 1.0'
  )

  // Verify all 3 vocal variants (short_grunt, sharp_impact, strained_groan) are reachable in gameplay
  const seenVariants = new Set(
    cAudio
      .getCueHistory()
      .filter((c) => c.type === 'player_damage')
      .map((c) => c.variant)
  )
  for (let i = 0; i < 8 && seenVariants.size < 3; i += 1) {
    combatEngine.setHealth(100)
    combatEngine.damageImmunityTimer = 0
    combatMock.ctx.currentTime += 0.5
    combatEngine.applyDamage(i === 0 ? 40 : 20, { enemyId: 'stalker-9' })
    cAudio
      .getCueHistory()
      .filter((c) => c.type === 'player_damage')
      .forEach((c) => seenVariants.add(c.variant))
  }
  assert(
    seenVariants.has('short_grunt') &&
      seenVariants.has('sharp_impact') &&
      seenVariants.has('strained_groan'),
    `All 3 damage vocal variants remain functional (seen: ${Array.from(seenVariants).join(', ')})`
  )

  // -------------------------------------------------------------------------
  // Phase 7 Direct PCM Synthesis Engine Verification (Requirements 1 - 9)
  // -------------------------------------------------------------------------
  const synthMock = createMockAudioContext()
  const synthDest = synthMock.ctx.createGain()
  const createdOscs = []
  const createdWaves = []
  const createdBufSources = []
  const createdFilters = []
  let waveShaperCount = 0

  synthMock.ctx.createPeriodicWave = (real, imag) => {
    const wave = { real: new Float32Array(real), imag: new Float32Array(imag) }
    createdWaves.push(wave)
    return wave
  }
  const origSynthOsc = synthMock.ctx.createOscillator.bind(synthMock.ctx)
  synthMock.ctx.createOscillator = () => {
    const osc = origSynthOsc()
    createdOscs.push(osc)
    return osc
  }
  const origSynthSrc = synthMock.ctx.createBufferSource.bind(synthMock.ctx)
  synthMock.ctx.createBufferSource = () => {
    const src = origSynthSrc()
    createdBufSources.push(src)
    return src
  }
  const origSynthFilter = synthMock.ctx.createBiquadFilter.bind(synthMock.ctx)
  synthMock.ctx.createBiquadFilter = () => {
    const flt = origSynthFilter()
    createdFilters.push(flt)
    return flt
  }
  synthMock.ctx.createWaveShaper = () => {
    waveShaperCount += 1
    return { connect() {}, disconnect() {}, curve: null, oversample: 'none' }
  }
  const noiseBuf = synthMock.ctx.createBuffer(1, 22050, 44100)

  // Requirement 9: Zero OscillatorNodes, zero PeriodicWaves, zero chest sine oscillators, and zero bandpass/parallel formant biquads
  const impactHandle = triggerPlayerImpactVocalCue(synthMock.ctx, synthDest, noiseBuf, {
    delaySec: 0.08,
    seed: 77701,
  })
  const impactVocalDur = impactHandle.durationSec - 0.08
  assert(
    impactHandle &&
      impactHandle.synthesizer === 'startled_exertion' &&
      impactHandle.profile === 'startled_breath' &&
      impactHandle.preset === 'elevator_startled' &&
      impactVocalDur >= 0.22 &&
      impactVocalDur <= 0.3,
    `Elevator landing vocal selects startled_exertion/startled_breath/elevator_startled and lasts 220-300ms (got ${(impactVocalDur * 1000).toFixed(0)}ms)`
  )

  const dmgHandles = [0, 1, 2].map((v) =>
    triggerPlayerDamageCue(synthMock.ctx, synthDest, noiseBuf, {
      variant: v,
      intensity: 1.0,
      seed: 88801 + v,
    })
  )
  assert(
    createdOscs.length === 0 &&
      createdWaves.length === 0 &&
      waveShaperCount === 0 &&
      createdBufSources.length === 4 &&
      createdFilters.every((f) => f.type === 'highpass' || f.type === 'lowpass'),
    'Production vocal triggers use 0 OscillatorNodes, 0 PeriodicWaves, 0 parallel bandpass biquads, and 1 PCM AudioBufferSourceNode per cue'
  )

  // Requirement 2: Duration bounds for all 4 reactions
  assert(
    dmgHandles[0].preset === 'damage_short_grunt' &&
      dmgHandles[0].durationSec >= 0.18 &&
      dmgHandles[0].durationSec <= 0.25 &&
      dmgHandles[1].preset === 'damage_sharp_impact' &&
      dmgHandles[1].durationSec >= 0.23 &&
      dmgHandles[1].durationSec <= 0.3 &&
      dmgHandles[2].preset === 'damage_strained_groan' &&
      dmgHandles[2].durationSec >= 0.35 &&
      dmgHandles[2].durationSec <= 0.45,
    `Damage vocal presets match exact Phase 7 duration windows: short_grunt=${(dmgHandles[0].durationSec * 1000).toFixed(0)}ms, sharp_impact=${(dmgHandles[1].durationSec * 1000).toFixed(0)}ms, strained_groan=${(dmgHandles[2].durationSec * 1000).toFixed(0)}ms`
  )

  // Requirement 1 & 7: Sample-rate compliance & cascade resonator stability across 22050 Hz, 44100 Hz, 48000 Hz
  for (const sr of [22050, 44100, 48000]) {
    const srCtx = {
      sampleRate: sr,
      createBuffer(ch, len, rate) {
        const arr = new Float32Array(len)
        return {
          numberOfChannels: ch,
          length: len,
          sampleRate: rate,
          duration: len / rate,
          getChannelData: () => arr,
        }
      },
    }
    for (const preset of Object.keys(VOCAL_PCM_PRESET_SPECS)) {
      const buf = renderHumanVocalTrackBuffer(srCtx, { preset, seed: 4242 })
      const samples = buf.getChannelData(0)
      let allFinite = true
      let maxAbs = 0
      for (let i = 0; i < samples.length; i += 1) {
        const v = samples[i]
        if (!Number.isFinite(v)) {
          allFinite = false
          break
        }
        const a = Math.abs(v)
        if (a > maxAbs) maxAbs = a
      }
      assert(
        buf.sampleRate === sr &&
          samples.length === Math.round(sr * VOCAL_PCM_PRESET_SPECS[preset].durationSec) &&
          allFinite &&
          maxAbs > 0.45 &&
          maxAbs <= 0.95,
        `PCM buffer for ${preset} at ${sr}Hz is finite, stable, and unclipped (peak=${maxAbs.toFixed(3)})`
      )
    }
  }

  // Requirement 3 & 4: Deterministic output with identical seeds & different output with different seeds
  for (const preset of Object.keys(VOCAL_PCM_PRESET_SPECS)) {
    const b1 = renderHumanVocalTrackBuffer(synthMock.ctx, { preset, seed: 13579 })
    const b2 = renderHumanVocalTrackBuffer(synthMock.ctx, { preset, seed: 13579 })
    const b3 = renderHumanVocalTrackBuffer(synthMock.ctx, { preset, seed: 24680 })
    const d1 = b1.getChannelData(0)
    const d2 = b2.getChannelData(0)
    const d3 = b3.getChannelData(0)
    let identicalSameSeed = d1.length === d2.length
    let diffCountOtherSeed = 0
    for (let i = 0; i < d1.length; i += 1) {
      if (d1[i] !== d2[i]) identicalSameSeed = false
      if (Math.abs(d1[i] - d3[i]) > 1e-5) diffCountOtherSeed += 1
    }
    assert(
      identicalSameSeed && diffCountOtherSeed > d1.length * 0.5,
      `renderHumanVocalTrackBuffer(${preset}) is bit-identical for same seed and distinct for different seeds`
    )
  }

  // Requirement 5 & 6: Organic non-alternating cycle-to-cycle micro-jitter (0.25-1.5%),
  // natural micro-shimmer (1.8-8%), zero-DC glottal source, zero period-2 F0/2 lock,
  // and pitch-synchronous aspiration modulation
  const metaByPreset = {}
  for (const preset of Object.keys(VOCAL_PCM_PRESET_SPECS)) {
    const buf = renderHumanVocalTrackBuffer(synthMock.ctx, { preset, seed: 90210 })
    const meta = buf._vocalMeta
    metaByPreset[preset] = meta
    assert(
      meta &&
        meta.voicedCycleCount >= 12 &&
        meta.meanPitchJitterRatio >= 0.002 &&
        meta.meanPitchJitterRatio <= 0.018 &&
        meta.meanAmplitudeShimmerRatio >= 0.015 &&
        meta.meanAmplitudeShimmerRatio <= 0.09,
      `${preset} exhibits natural organic cycle-to-cycle micro-jitter (${(meta.meanPitchJitterRatio * 100).toFixed(2)}%) and shimmer (${(meta.meanAmplitudeShimmerRatio * 100).toFixed(2)}%)`
    )
    assert(
      Math.abs(meta.glottalDcMean) <= 0.025 && meta.subharmonicAlternationRatio <= 0.12,
      `${preset} preserves zero-DC glottal balance (dcMean=${meta.glottalDcMean.toFixed(4)}) and avoids artificial period-2 alternation (altRatio=${(meta.subharmonicAlternationRatio * 100).toFixed(2)}%)`
    )
    assert(
      meta.openClosedAspirationRatio >= 8.0,
      `${preset} modulates aspiration pitch-synchronously with glottal opening (open/closed RMS ratio=${meta.openClosedAspirationRatio.toFixed(2)}x)`
    )
  }

  combatEngine.dispose()
}
console.log('✓ Combat damage vocal variants, delayed event dedup, stale onComplete guard, and Phase 12 PCM engine verified')

// ---------------------------------------------------------------------------
// Test 10: End-to-End Gameplay Vocal Path & Distinct 44.1kHz PCM Acoustic Signatures
// ---------------------------------------------------------------------------
console.log('Test 10: End-to-End Gameplay Vocal Path & Distinct 44.1kHz PCM Acoustic Signatures')
{
  const { VOCAL_PCM_PRESET_SPECS, renderHumanVocalTrackBuffer } = await import(
    './audioSynthesis.js'
  )

  // 10a. Verify actual MazeSceneEngine elevator landing -> startled_exertion/startled_breath
  //      and actual MazeSceneEngine applyDamage -> pain_reaction/pain_pressed|pain_strained with zero duplication
  const pathMock = createMockAudioContext()
  const pathEngine = createHeadlessEngine({
    skipSpawnSequence: false,
    enemies: { autoSpawn: false },
    audio: {
      createAudioContext: () => pathMock.ctx,
      recordCueHistory: true,
      vocalRandom: () => 0.1,
    },
  })
  pathEngine.setMaze(occlusionTestMaze)
  pathEngine.unlockAudio()

  // Step through the real starting elevator descent until landing impact triggers
  for (let i = 0; i < 120 && !pathEngine._startImpactCueFired; i += 1) {
    pathEngine.stepFrame(0.05, { render: false })
  }
  assert(pathEngine._startImpactCueFired, 'Starting elevator descent reaches landing impact in MazeSceneEngine')

  const impactCueLogs = pathEngine.audioEngine.getCueHistory().filter(
    (c) => c.type === 'player_impact_vocal'
  )
  const activeImpactCue = pathEngine.audioEngine._activeVocalCue
  assert(
    impactCueLogs.length === 1 &&
      impactCueLogs[0].synthesizer === 'startled_exertion' &&
      impactCueLogs[0].profile === 'startled_breath' &&
      activeImpactCue?.synthesizer === 'startled_exertion' &&
      activeImpactCue?.profile === 'startled_breath' &&
      activeImpactCue?.preset === 'elevator_startled' &&
      Boolean(activeImpactCue?.pcmBuffer),
    'Actual elevator landing event routes exclusively to startled_exertion PCM synthesizer without duplication'
  )
  const elevPcmBuffer = activeImpactCue.pcmBuffer

  // Complete spawn sequence so player becomes vulnerable to real gameplay damage
  for (let i = 0; i < 160 && pathEngine.isSpawnSequenceActive(); i += 1) {
    pathEngine.stepFrame(0.05, { render: false })
  }
  pathMock.ctx.currentTime += 1.0
  pathEngine.stepFrame(0.5, { render: false })

  const dmgApplied = pathEngine.applyDamage(20, { enemyId: 'stalker-1', enemyType: 'stalker' })
  // Simulate delayed React reducer player_damaged event arriving immediately after applyDamage
  pathEngine.handleGameEvent({ id: 901, type: 'player_damaged', damage: 20, healthDelta: 20 })
  assert(dmgApplied, 'applyDamage reduces player HP on actual enemy hit')

  const dmgCueLogs = pathEngine.audioEngine.getCueHistory().filter((c) => c.type === 'player_damage')
  const activeDmgCue = pathEngine.audioEngine._activeVocalCue
  assert(
    dmgCueLogs.length === 1 &&
      dmgCueLogs[0].synthesizer === 'pain_reaction' &&
      (dmgCueLogs[0].profile === 'pain_pressed' || dmgCueLogs[0].profile === 'pain_strained') &&
      activeDmgCue?.synthesizer === 'pain_reaction' &&
      activeDmgCue?.profile === dmgCueLogs[0].profile &&
      Boolean(activeDmgCue?.pcmBuffer),
    'Actual damage event routes exclusively to pain_reaction PCM synthesizer and deduplicates reducer echo'
  )
  assert(
    elevPcmBuffer !== activeDmgCue.pcmBuffer && elevPcmBuffer.length !== activeDmgCue.pcmBuffer.length,
    'Runtime elevator landing and player damage generate distinct PCM AudioBuffers on the live AudioContext'
  )
  pathEngine.dispose()

  // 10b. Verify distinct 44.1kHz PCM temporal & spectral signatures, Phase 10 hybrid upper-formant
  //      preservation, single-source preset propagation, and dynamic amplitude normalization
  const SR = 44100
  const analyzePcmBuffer = (preset) => {
    const spec = VOCAL_PCM_PRESET_SPECS[preset]
    const buf = renderHumanVocalTrackBuffer({ sampleRate: SR }, { preset, seed: 54321 })
    const data = buf.getChannelData(0)
    const n = data.length
    const rmsSlice = (f0, f1) => {
      const i0 = Math.max(0, Math.floor(n * f0))
      const i1 = Math.min(n, Math.ceil(n * f1))
      let sum = 0
      for (let i = i0; i < i1; i += 1) sum += data[i] * data[i]
      return Math.sqrt(sum / Math.max(1, i1 - i0))
    }
    const intakeRms = rmsSlice(0.02, 0.18)
    const attackRms = rmsSlice(0.06, 0.24)
    const coreRms = rmsSlice(0.28, 0.58)
    const lateCoreRms = rmsSlice(0.55, 0.78)
    const tailRms = rmsSlice(0.84, 0.98)

    // Measure voiced-core spectral energy across Low/Fundamental (70-650Hz) vs Open-Pharyngeal F1/F2 (650-2200Hz) vs Upper (1350-3600Hz)
    const cStart = Math.floor(n * 0.25)
    const cEnd = Math.floor(n * 0.72)
    let lowBandE = 0
    let f1F2BandE = 0
    let highBandE = 0
    let wFreqSum = 0
    let wMagSum = 0
    for (let f = 80; f <= 3600; f += 35) {
      let re = 0
      let im = 0
      const w = (2 * Math.PI * f) / SR
      for (let i = cStart; i < cEnd; i += 2) {
        re += data[i] * Math.cos(w * i)
        im -= data[i] * Math.sin(w * i)
      }
      const e = re * re + im * im
      const mag = Math.sqrt(e)
      wFreqSum += f * mag
      wMagSum += mag
      if (f < 650) lowBandE += e
      if (f >= 650 && f <= 2200) f1F2BandE += e
      if (f >= 1350 && f <= 3600) highBandE += e
    }
    const totalE = lowBandE + f1F2BandE || 1

    // Exact voiced-core DFT band shares across 50-5000 Hz to verify reduced 400-1050 Hz dominance
    // and strong F2 (1050-2200 Hz) + F3/F4 (2200-5000 Hz) upper-formant preservation
    const i0 = Math.floor(n * spec.catchEndFrac)
    const i1 = Math.floor(n * spec.voicedEndFrac)
    const N = Math.max(1, i1 - i0)
    const kMinAll = Math.max(1, Math.floor((50 * N) / SR))
    const kMaxAll = Math.min(Math.floor(N / 2), Math.ceil((5000 * N) / SR))
    let dftTotal = 0
    let dftChest200_900 = 0
    let dftF1_400_1050 = 0
    let dftF2_1050_2200 = 0
    let dftF3F4_2200_5000 = 0
    for (let k = kMinAll; k <= kMaxAll; k += 1) {
      let re = 0
      let im = 0
      const w = (2 * Math.PI * k) / N
      for (let m = 0; m < N; m += 1) {
        const s = data[i0 + m]
        re += s * Math.cos(w * m)
        im -= s * Math.sin(w * m)
      }
      const binEnergy = (2 * (re * re + im * im)) / (N * N)
      const freqHz = (k * SR) / N
      dftTotal += binEnergy
      if (freqHz >= 200 && freqHz <= 900) dftChest200_900 += binEnergy
      if (freqHz >= 400 && freqHz <= 1050) dftF1_400_1050 += binEnergy
      if (freqHz > 1050 && freqHz <= 2200) dftF2_1050_2200 += binEnergy
      if (freqHz > 2200 && freqHz <= 5000) dftF3F4_2200_5000 += binEnergy
    }
    const safeDftTotal = dftTotal || 1

    return {
      preset,
      durMs: (n / SR) * 1000,
      intakeRms,
      attackRms,
      coreRms,
      lateCoreRms,
      tailRms,
      centroidHz: wFreqSum / Math.max(1e-9, wMagSum),
      f1F2Share: f1F2BandE / totalE,
      highShare: highBandE / totalE,
      chest200_900Share: dftChest200_900 / safeDftTotal,
      f1BandShare: dftF1_400_1050 / safeDftTotal,
      f2BandShare: dftF2_1050_2200 / safeDftTotal,
      f3F4BandShare: dftF3F4_2200_5000 / safeDftTotal,
      upperFormantShare: (dftF2_1050_2200 + dftF3F4_2200_5000) / safeDftTotal,
      meta: buf._vocalMeta,
    }
  }

  const sigElev = analyzePcmBuffer('elevator_startled')
  const sigShort = analyzePcmBuffer('damage_short_grunt')
  const sigSharp = analyzePcmBuffer('damage_sharp_impact')
  const sigGroan = analyzePcmBuffer('damage_strained_groan')

  // 1) elevator_startled has a distinct unvoiced inhalation gasp prior to its voiced catch at ~26.5%
  assert(
    sigElev.intakeRms > 0.05 && sigElev.coreRms > sigElev.intakeRms * 1.8,
    `elevator_startled has audible intake breath before voiced catch (intakeRms=${sigElev.intakeRms.toFixed(3)}, coreRms=${sigElev.coreRms.toFixed(3)})`
  )
  // 2) damage_short_grunt has an immediate hard attack and fast decay into early release
  assert(
    sigShort.attackRms > sigElev.intakeRms * 2.2 && sigShort.tailRms < sigShort.attackRms * 0.35,
    `damage_short_grunt has immediate burst onset and rapid ballistic decay (attackRms=${sigShort.attackRms.toFixed(3)}, tailRms=${sigShort.tailRms.toFixed(3)})`
  )
  // 3) damage_sharp_impact has brighter open-pharyngeal F1/F2 spectral centroid than damage_short_grunt and damage_strained_groan
  assert(
    sigSharp.centroidHz > sigShort.centroidHz + 70 &&
      sigSharp.centroidHz > sigGroan.centroidHz + 90,
    `damage_sharp_impact has brighter open-pharyngeal projection (centroid=${sigSharp.centroidHz.toFixed(0)}Hz vs short=${sigShort.centroidHz.toFixed(0)}Hz, groan=${sigGroan.centroidHz.toFixed(0)}Hz)`
  )
  // 4) damage_strained_groan is prevented from collapsing into a low-frequency (<450Hz) "OO" tone:
  //    its open-central F1/F2 band (650-2200 Hz) dominates (>65% of total energy) and its late core sustains strained effort
  assert(
    VOCAL_PCM_PRESET_SPECS.damage_strained_groan.f1End >= 600 &&
      VOCAL_PCM_PRESET_SPECS.damage_strained_groan.f2End >= 1200 &&
      sigGroan.f1F2Share >= 0.65 &&
      sigGroan.durMs >= 350,
    `damage_strained_groan preserves open-central F1/F2 energy (${(sigGroan.f1F2Share * 100).toFixed(1)}% in 650-2200Hz) and never collapses into a low-frequency "OO" drone`
  )
  // 5) Phase 12 single-path vocal-tract & lighter glottal-balance checks:
  //    - Verify zero-DC softer glottal adduction (positive H1-H2 tilt), elimination of F0/2 period-2
  //      subharmonic growl (Hsub-H1 <= -32 dB), gentle chest-to-upper formant distribution without a
  //      parallel cancellation notch, and higher-pole upper-formant boost vs an uncompensated cascade.
  for (const sig of [sigElev, sigShort, sigSharp, sigGroan]) {
    const spec = VOCAL_PCM_PRESET_SPECS[sig.preset]
    const rawBuf = renderHumanVocalTrackBuffer({ sampleRate: SR }, { preset: sig.preset, seed: 54321 })
    const rData = rawBuf.getChannelData(0)
    const uncompBuf = renderHumanVocalTrackBuffer(
      { sampleRate: SR },
      {
        preset: sig.preset,
        seed: 54321,
        openQuotient: 0.56,
        returnQuotient: 0.042,
        closingEmphasis: 2.35,
        b2Start: 165,
        b2End: 195,
        b3Start: 225,
        b3End: 265,
        shelf1GainDb: 0,
        shelf2GainDb: 0,
        chestDipDb: 0,
        airBypassGain: 0,
      }
    )
    const uData = uncompBuf.getChannelData(0)
    const i0 = Math.floor(uData.length * spec.catchEndFrac)
    const i1 = Math.floor(uData.length * spec.voicedEndFrac)
    const N = Math.max(1, i1 - i0)
    const kMinAll = Math.max(1, Math.floor((50 * N) / SR))
    const kMaxAll = Math.min(Math.floor(N / 2), Math.ceil((5000 * N) / SR))
    let uTot = 0
    let uUpper = 0
    let uF3F4 = 0
    for (let k = kMinAll; k <= kMaxAll; k += 1) {
      let re = 0
      let im = 0
      const w = (2 * Math.PI * k) / N
      for (let m = 0; m < N; m += 1) {
        const s = uData[i0 + m]
        re += s * Math.cos(w * m)
        im -= s * Math.sin(w * m)
      }
      const e = (2 * (re * re + im * im)) / (N * N)
      const fHz = (k * SR) / N
      uTot += e
      if (fHz > 1050 && fHz <= 5000) uUpper += e
      if (fHz > 2200 && fHz <= 5000) uF3F4 += e
    }
    const uncompUpperShare = uUpper / (uTot || 1)
    const uncompF3F4Share = uF3F4 / (uTot || 1)

    // Measure H1, H2, and F0/2 subharmonic amplitude across the voiced core
    const centerF0 = (spec.pitchStart + spec.pitchPeak + spec.pitchMid) / 3
    const peakBandDb = (fLo, fHi) => {
      const k0 = Math.max(1, Math.floor((fLo * N) / SR))
      const k1 = Math.min(Math.floor(N / 2) - 1, Math.ceil((fHi * N) / SR))
      let bestE = 1e-18
      let bestF = fLo
      for (let k = k0; k <= k1; k += 1) {
        let re = 0
        let im = 0
        const w = (2 * Math.PI * k) / N
        for (let m = 0; m < N; m += 1) {
          const s = rData[i0 + m] * (0.5 - 0.5 * Math.cos((2 * Math.PI * m) / Math.max(1, N - 1)))
          re += s * Math.cos(w * m)
          im -= s * Math.sin(w * m)
        }
        const e = re * re + im * im
        if (e > bestE) {
          bestE = e
          bestF = (k * SR) / N
        }
      }
      return { db: 10 * Math.log10(bestE), freq: bestF }
    }
    const h1 = peakBandDb(centerF0 * 0.72, centerF0 * 1.32)
    const h2 = peakBandDb(h1.freq * 1.75, h1.freq * 2.25)
    const hsub = peakBandDb(h1.freq * 0.42, h1.freq * 0.62)
    const h1MinusH2 = h1.db - h2.db
    const hSubMinusH1 = hsub.db - h1.db

    // Full-buffer >5 kHz breath air presence (before cue-bus LP)
    let airE = 0
    let fullBandE = 0
    const nf = rData.length
    const kAirMin = Math.floor((50 * nf) / SR)
    const kAirSplit = Math.floor((5000 * nf) / SR)
    const kAirMax = Math.min(Math.floor(nf / 2), Math.ceil((12000 * nf) / SR))
    for (let k = kAirMin; k <= kAirMax; k += 2) {
      let re = 0
      let im = 0
      const w = (2 * Math.PI * k) / nf
      for (let m = 0; m < nf; m += 2) {
        const s = rData[m]
        re += s * Math.cos(w * m)
        im -= s * Math.sin(w * m)
      }
      const e = re * re + im * im
      fullBandE += e
      if (k >= kAirSplit) airE += e
    }
    const airShare = airE / (fullBandE || 1)

    assert(
      spec.pitchStart >= 155 &&
        spec.pitchStart <= 220 &&
        spec.pitchEnd >= 130 &&
        spec.pitchPeak <= 255 &&
        spec.openQuotient >= 0.6 &&
        spec.returnQuotient >= 0.055 &&
        spec.closingEmphasis <= 1.75 &&
        spec.subharmonicDepth === 0 &&
        spec.lowCutHz >= 100 &&
        spec.lowCutHz <= 125 &&
        sig.f1BandShare <= 0.52 &&
        sig.upperFormantShare >= 0.34 &&
        sig.upperFormantShare > uncompUpperShare * 2.0 &&
        sig.f3F4BandShare > uncompF3F4Share * 6.0 &&
        h1MinusH2 > 0 &&
        hSubMinusH1 <= -32 &&
        airShare >= 0.004,
      `Phase 12 preset ${sig.preset} delivers lighter voice (H1-H2=${h1MinusH2.toFixed(1)}dB, Hsub-H1=${hSubMinusH1.toFixed(1)}dB, 400-1050Hz=${(sig.f1BandShare * 100).toFixed(1)}%, F2-F4=${(sig.upperFormantShare * 100).toFixed(1)}% vs ${(uncompUpperShare * 100).toFixed(1)}% uncomp, >5kHz air=${(airShare * 100).toFixed(2)}%)`
    )
  }

  // 6) Phase 10 single-source preset configuration & parameter propagation test:
  //    Verify triggerPlayerImpactVocalCue and triggerPlayerDamageCue read durationSec and pitch trajectory
  //    directly from VOCAL_PCM_PRESET_SPECS without duplicated hardcoded overrides, and custom overrides
  //    passed to renderHumanVocalTrackBuffer propagate accurately into _vocalMeta and the rendered waveform.
  const { triggerPlayerImpactVocalCue, triggerPlayerDamageCue } = await import(
    './audioSynthesis.js'
  )
  const propMock = createMockAudioContext()
  const propDest = propMock.ctx.createGain()
  const impactCue = triggerPlayerImpactVocalCue(propMock.ctx, propDest, null, {
    delaySec: 0,
    seed: 112233,
  })
  assert(
    impactCue?.vocalMeta &&
      Math.abs(impactCue.vocalMeta.durationSec - VOCAL_PCM_PRESET_SPECS.elevator_startled.durationSec) < 1e-3 &&
      impactCue.vocalMeta.pitchStart === VOCAL_PCM_PRESET_SPECS.elevator_startled.pitchStart &&
      impactCue.vocalMeta.pitchPeakAt === VOCAL_PCM_PRESET_SPECS.elevator_startled.pitchPeakAt &&
      impactCue.vocalMeta.pitchPeak === VOCAL_PCM_PRESET_SPECS.elevator_startled.pitchPeak &&
      impactCue.vocalMeta.pitchMidAt === VOCAL_PCM_PRESET_SPECS.elevator_startled.pitchMidAt &&
      impactCue.vocalMeta.pitchMid === VOCAL_PCM_PRESET_SPECS.elevator_startled.pitchMid &&
      impactCue.vocalMeta.pitchEnd === VOCAL_PCM_PRESET_SPECS.elevator_startled.pitchEnd,
    'triggerPlayerImpactVocalCue reads durationSec and all pitch contour points directly from VOCAL_PCM_PRESET_SPECS.elevator_startled'
  )

  const variantToPreset = [
    [0, 'damage_short_grunt'],
    [1, 'damage_sharp_impact'],
    [2, 'damage_strained_groan'],
  ]
  for (const [vIdx, pKey] of variantToPreset) {
    const pSpec = VOCAL_PCM_PRESET_SPECS[pKey]
    const dmgCue = triggerPlayerDamageCue(propMock.ctx, propDest, null, {
      variant: vIdx,
      intensity: 1.0,
      seed: 223344 + vIdx,
    })
    assert(
      dmgCue?.vocalMeta &&
        Math.abs(dmgCue.vocalMeta.durationSec - pSpec.durationSec) < 1e-3 &&
        dmgCue.vocalMeta.pitchStart === pSpec.pitchStart &&
        dmgCue.vocalMeta.pitchPeakAt === pSpec.pitchPeakAt &&
        dmgCue.vocalMeta.pitchPeak === pSpec.pitchPeak &&
        dmgCue.vocalMeta.pitchMidAt === pSpec.pitchMidAt &&
        dmgCue.vocalMeta.pitchMid === pSpec.pitchMid &&
        dmgCue.vocalMeta.pitchEnd === pSpec.pitchEnd,
      `triggerPlayerDamageCue(variant=${vIdx}) reads durationSec and all pitch contour points directly from VOCAL_PCM_PRESET_SPECS.${pKey}`
    )
  }

  // 7) Phase 10 amplitude normalization & dynamic headroom test:
  //    Verify that lowering targetPeak or softClipDrive or rendering a weaker signal produces a measurably
  //    quieter output buffer rather than automatically normalizing every signal back to the same peak.
  const normBaseBuf = renderHumanVocalTrackBuffer(
    { sampleRate: SR },
    { preset: 'damage_short_grunt', seed: 778899, targetPeak: 0.76, softClipDrive: 1.08 }
  )
  const normQuietPeakBuf = renderHumanVocalTrackBuffer(
    { sampleRate: SR },
    { preset: 'damage_short_grunt', seed: 778899, targetPeak: 0.48, softClipDrive: 1.08 }
  )
  const normSoftDriveBuf = renderHumanVocalTrackBuffer(
    { sampleRate: SR },
    { preset: 'damage_short_grunt', seed: 778899, targetPeak: 0.76, softClipDrive: 0.62 }
  )
  const normWeakSourceBuf = renderHumanVocalTrackBuffer(
    { sampleRate: SR },
    {
      preset: 'damage_short_grunt',
      seed: 778899,
      excitationGain: 0.25,
    }
  )
  const calcRms = (b) => {
    const arr = b.getChannelData(0)
    let s = 0
    for (let i = 0; i < arr.length; i += 1) s += arr[i] * arr[i]
    return Math.sqrt(s / Math.max(1, arr.length))
  }
  assert(
    normQuietPeakBuf._vocalMeta.peakSample < normBaseBuf._vocalMeta.peakSample * 0.7 &&
      calcRms(normQuietPeakBuf) < calcRms(normBaseBuf) * 0.7 &&
      normSoftDriveBuf._vocalMeta.peakSample < normBaseBuf._vocalMeta.peakSample * 0.85 &&
      calcRms(normSoftDriveBuf) < calcRms(normBaseBuf) * 0.85 &&
      normWeakSourceBuf._vocalMeta.peakSample < normBaseBuf._vocalMeta.peakSample * 0.65,
    `Phase 10 normalization preserves dynamic differences (basePeak=${normBaseBuf._vocalMeta.peakSample.toFixed(3)}, quietTargetPeak=${normQuietPeakBuf._vocalMeta.peakSample.toFixed(3)}, softDrivePeak=${normSoftDriveBuf._vocalMeta.peakSample.toFixed(3)}, weakSourcePeak=${normWeakSourceBuf._vocalMeta.peakSample.toFixed(3)})`
  )
}
console.log('✓ End-to-end gameplay vocal routing and distinct 44.1kHz PCM acoustic signatures verified')

// ---------------------------------------------------------------------------
// Test 11: Phase 5B & Phase 7 In-Browser Vocal Audition Mechanism with PCM Synthesis
// ---------------------------------------------------------------------------
console.log('Test 11: In-Browser Vocal Audition Mechanism, Non-Overlapping PCM Playback & Cleanup')
{
  const audMock = createMockAudioContext()
  const trackedOscs = []
  const trackedBufSources = []
  const origAudOsc = audMock.ctx.createOscillator.bind(audMock.ctx)
  audMock.ctx.createOscillator = () => {
    const osc = origAudOsc()
    trackedOscs.push(osc)
    return osc
  }
  const origAudBuf = audMock.ctx.createBufferSource.bind(audMock.ctx)
  audMock.ctx.createBufferSource = () => {
    const src = origAudBuf()
    const entry = { node: src, stopped: false, disconnected: false }
    const origStop = src.stop.bind(src)
    const origDisc = src.disconnect.bind(src)
    src.stop = (when = 0) => {
      entry.stopped = true
      return origStop(when)
    }
    src.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    trackedBufSources.push(entry)
    return src
  }

  const audEngine = createHeadlessEngine({
    skipSpawnSequence: true,
    enemies: { autoSpawn: false },
    audio: {
      createAudioContext: () => audMock.ctx,
      recordCueHistory: true,
    },
  })
  audEngine.setMaze(occlusionTestMaze)
  const audAudio = audEngine.getAudioEngine()

  // 11a. Preset registry exposes all 4 production vocal reactions
  const presets = audEngine.getVocalAuditionPresets()
  assert(
    Array.isArray(presets) &&
      presets.length === 4 &&
      presets.map((p) => p.id).join(',') ===
        'elevator_startled,damage_short_grunt,damage_sharp_impact,damage_strained_groan',
    'getVocalAuditionPresets() exposes all 4 required vocal audition presets'
  )

  // 11b. Auditioning auto-unlocks AudioContext on user gesture, preserves player HP & gameplay cooldowns,
  //      and routes each preset through the new Phase 7 production PCM synthesizer, gain bus, and ducking
  assert(audAudio.isUnlocked === false, 'Engine starts locked before first audition click')
  const initialHp = audEngine.getHealth().health

  const resElev = audEngine.auditionVocal('elevator_startled')
  assert(
    resElev &&
      resElev.played === true &&
      resElev.presetId === 'elevator_startled' &&
      resElev.synthesizer === 'startled_exertion' &&
      resElev.profile === 'startled_breath' &&
      audAudio.isUnlocked === true &&
      audAudio.getAudioState().activeVocalCueCount === 1 &&
      audAudio.getAudioState().elevatorDucked === true &&
      Math.abs(audAudio.getAudioState().elevatorImpactGain - 0.58) < 1e-4 &&
      Math.abs(audAudio.getAudioState().playerVocalGain - 0.84) < 1e-4,
    'Auditioning elevator_startled unlocks audio, uses startled_exertion/startled_breath PCM engine, routes via playerVocalGain (0.84), and ducks elevatorImpactGain (0.58)'
  )
  const elevBufEntry = trackedBufSources[trackedBufSources.length - 1]
  assert(
    Boolean(elevBufEntry?.node?.buffer?._vocalMeta) &&
      elevBufEntry.node.buffer._vocalMeta.preset === 'elevator_startled',
    'Elevator audition plays a PCM AudioBuffer generated by renderHumanVocalTrackBuffer(elevator_startled)'
  )
  const oscCountAfterUnlock = trackedOscs.length

  // 11c. Non-overlapping playback: triggering damage_short_grunt while elevator_startled is active
  //      immediately stops & disconnects the first audition and switches to pain_reaction/pain_pressed
  const resShort = audEngine.auditionVocal('damage_short_grunt')
  assert(
    elevBufEntry.stopped && elevBufEntry.disconnected,
    'Starting a new audition immediately stops and disconnects the previous active PCM AudioBufferSourceNode (zero overlap)'
  )
  assert(
    resShort &&
      resShort.played === true &&
      resShort.presetId === 'damage_short_grunt' &&
      resShort.variant === 'short_grunt' &&
      resShort.synthesizer === 'pain_reaction' &&
      resShort.profile === 'pain_pressed' &&
      audAudio.getAudioState().activeVocalCueCount === 1 &&
      audAudio.getAudioState().elevatorDucked === false &&
      Math.abs(audAudio.getAudioState().elevatorImpactGain - 1.0) < 1e-4 &&
      audAudio.getAudioState().combatDucked === true &&
      Math.abs(audAudio.getAudioState().enemyAttackGain - 0.65) < 1e-4,
    'Auditioning damage_short_grunt restores elevator bus, activates combat ducking (0.65), and plays pain_reaction/pain_pressed PCM buffer'
  )
  const shortBufEntry = trackedBufSources[trackedBufSources.length - 1]
  assert(
    shortBufEntry?.node?.buffer?._vocalMeta?.preset === 'damage_short_grunt',
    'Damage short_grunt audition plays PCM AudioBuffer for damage_short_grunt'
  )

  // Triggering damage_sharp_impact stops damage_short_grunt and plays sharp_impact
  const resSharp = audEngine.auditionVocal('damage_sharp_impact')
  assert(
    shortBufEntry.stopped &&
      shortBufEntry.disconnected &&
      resSharp &&
      resSharp.played === true &&
      resSharp.presetId === 'damage_sharp_impact' &&
      resSharp.variant === 'sharp_impact' &&
      resSharp.synthesizer === 'pain_reaction' &&
      resSharp.profile === 'pain_pressed' &&
      audAudio.getAudioState().activeVocalCueCount === 1,
    'Auditioning damage_sharp_impact stops prior cue and plays sharp_impact via pain_reaction/pain_pressed PCM buffer'
  )
  const sharpBufEntry = trackedBufSources[trackedBufSources.length - 1]
  assert(
    sharpBufEntry?.node?.buffer?._vocalMeta?.preset === 'damage_sharp_impact',
    'Damage sharp_impact audition plays PCM AudioBuffer for damage_sharp_impact'
  )

  // Triggering damage_strained_groan stops damage_sharp_impact and plays strained_groan (pain_strained profile)
  const resGroan = audEngine.auditionVocal('damage_strained_groan')
  assert(
    sharpBufEntry.stopped &&
      sharpBufEntry.disconnected &&
      resGroan &&
      resGroan.played === true &&
      resGroan.presetId === 'damage_strained_groan' &&
      resGroan.variant === 'strained_groan' &&
      resGroan.synthesizer === 'pain_reaction' &&
      resGroan.profile === 'pain_strained' &&
      resGroan.durationSec > resSharp.durationSec &&
      audAudio.getAudioState().activeVocalCueCount === 1,
    'Auditioning damage_strained_groan stops prior cue and plays strained_groan via pain_reaction/pain_strained PCM buffer'
  )
  const groanBufEntry = trackedBufSources[trackedBufSources.length - 1]
  assert(
    groanBufEntry?.node?.buffer?._vocalMeta?.preset === 'damage_strained_groan' &&
      trackedOscs.length === oscCountAfterUnlock,
    'All 4 audition presets execute through the Phase 7 PCM engine without spawning any OscillatorNodes'
  )

  // 11d. Explicit stopVocalAudition() stops active playback and restores ducked buses
  assert(audEngine.stopVocalAudition() === true, 'stopVocalAudition() returns true when stopping active audition')
  assert(
    groanBufEntry.stopped &&
      groanBufEntry.disconnected &&
      audAudio.getAudioState().activeVocalCueCount === 0 &&
      audAudio.getAudioState().combatDucked === false &&
      Math.abs(audAudio.getAudioState().enemyAttackGain - 1.0) < 1e-4 &&
      Math.abs(audAudio.getAudioState().hazardAudioGain - 1.0) < 1e-4,
    'stopVocalAudition() disconnects active PCM source node and restores ducked combat buses to 1.0'
  )
  assert(audEngine.stopVocalAudition() === false, 'stopVocalAudition() returns false when no vocal is active')
  assert(audEngine.auditionVocal('unknown_preset') === null, 'Unknown preset ID returns null safely')

  // 11e. Verify normal gameplay state (HP and damage vocal cooldown) was not altered by auditions
  assert(
    audEngine.getHealth().health === initialHp &&
      audAudio._lastDamageVocalAt < 0 &&
      audAudio._lastImpactVocalAt < 0,
    'Auditioning does not alter player HP or consume normal gameplay vocal cooldown timestamps'
  )
  assert(
    audEngine.applyDamage(20, { enemyId: 'stalker-aud' }) === true &&
      audAudio.getAudioState().activeVocalCueCount === 1,
    'Normal gameplay damage immediately triggers player damage vocal after auditioning'
  )

  audEngine.dispose()
}
console.log('✓ In-browser vocal audition mechanism, non-overlapping PCM playback, and cleanup verified')

// ---------------------------------------------------------------------------
// Test 12: Phase 1 Enemy Alert Subtlety, Non-Vocal Chase Distinction,
//          ATTACK->CHASE Deduplication, Independent Cooldowns & Lifecycle
// ---------------------------------------------------------------------------
console.log('Test 12: Phase 1 Enemy Alerts, Deduplication, Independent Cooldowns & Concurrency Cleanup')
{
  const {
    ENEMY_AUDIO_CATEGORIES,
    ENEMY_ALERT_SPECS,
    triggerEnemyAlertCue,
    triggerEnemyAttackCue,
    playEnemyPcmBufferCue,
  } = await import('./audioSynthesis.js')
  const { ENEMY_AUDIO_LIMITS } = await import('./HorrorAudioEngine.js')
  const { EnemyAgent, ENEMY_TYPES } = await import('./EnemyAgent.js')

  const enemyTestMock = createMockAudioContext()
  const spawnedOscDetails = []
  const spawnedGainDetails = []
  const spawnedFilterDetails = []
  const origOscFn = enemyTestMock.ctx.createOscillator.bind(enemyTestMock.ctx)
  const origGainFn = enemyTestMock.ctx.createGain.bind(enemyTestMock.ctx)
  const origFilterFn = enemyTestMock.ctx.createBiquadFilter.bind(enemyTestMock.ctx)

  enemyTestMock.ctx.createOscillator = () => {
    const osc = origOscFn()
    const entry = {
      node: osc,
      typeHistory: [],
      freqValues: [],
      stopped: false,
      disconnected: false,
    }
    let curType = osc.type
    Object.defineProperty(osc, 'type', {
      get: () => curType,
      set: (v) => {
        curType = v
        entry.typeHistory.push(v)
      },
    })
    const origSetFreq = osc.frequency.setValueAtTime.bind(osc.frequency)
    osc.frequency.setValueAtTime = (v, t) => {
      entry.freqValues.push(v)
      return origSetFreq(v, t)
    }
    const origStop = osc.stop.bind(osc)
    const origDisc = osc.disconnect.bind(osc)
    osc.stop = (when = 0) => {
      entry.stopped = true
      return origStop(when)
    }
    osc.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    spawnedOscDetails.push(entry)
    return osc
  }
  enemyTestMock.ctx.createGain = () => {
    const g = origGainFn()
    const entry = { node: g, maxGain: 0, disconnected: false }
    const origLin = g.gain.linearRampToValueAtTime.bind(g.gain)
    g.gain.linearRampToValueAtTime = (v, t) => {
      entry.maxGain = Math.max(entry.maxGain, Number(v) || 0)
      return origLin(v, t)
    }
    const origDisc = g.disconnect.bind(g)
    g.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    spawnedGainDetails.push(entry)
    return g
  }
  enemyTestMock.ctx.createBiquadFilter = () => {
    const f = origFilterFn()
    const entry = { node: f, disconnected: false }
    const origDisc = f.disconnect.bind(f)
    f.disconnect = () => {
      entry.disconnected = true
      return origDisc()
    }
    spawnedFilterDetails.push(entry)
    return f
  }

  const phase1Audio = new HorrorAudioEngine({
    createAudioContext: () => enemyTestMock.ctx,
    autoUnlock: true,
    recordCueHistory: true,
  })
  phase1Audio.setMaze(occlusionTestMaze)

  // 12a. Investigation alert subtlety & non-vocal waveform audit across all 3 enemy types
  const invIdentities = new Set()
  for (const enemyType of ['stalker', 'hunter', 'brute']) {
    const spec = ENEMY_ALERT_SPECS[enemyType]
    invIdentities.add(spec.identity)
    const oscIdx0 = spawnedOscDetails.length
    const gainIdx0 = spawnedGainDetails.length
    const handle = triggerEnemyAlertCue(enemyTestMock.ctx, phase1Audio.effectsGain, false, enemyType, {
      enemyId: `${enemyType}-inv`,
    })
    const oscs = spawnedOscDetails.slice(oscIdx0)
    const gains = spawnedGainDetails.slice(gainIdx0)
    const maxInvGain = Math.max(...gains.map((g) => g.maxGain))
    assert(
      Boolean(handle) &&
        handle.category === ENEMY_AUDIO_CATEGORIES.ALERT_INVESTIGATE &&
        handle.durationSec <= 0.18 &&
        oscs.length >= 1 &&
        oscs.every((o) => o.node.type === 'sine') &&
        maxInvGain <= 0.08,
      `${enemyType} investigation alert is subtle pure sine (gain=${maxInvGain.toFixed(3)}, dur=${handle.durationSec}s)`
    )
    handle.stop({ immediate: true })
    assert(
      oscs.every((o) => o.stopped && o.disconnected),
      `${enemyType} investigation alert stop() cleanly disconnects all oscillators`
    )
  }
  assert(invIdentities.size === 3, 'All three enemies define distinct alert identities')

  // 12b. Chase alert distinction & non-vocal / non-growl / non-roar character across all 3 enemy types
  const chaseProfiles = {}
  for (const enemyType of ['stalker', 'hunter', 'brute']) {
    const oscIdx0 = spawnedOscDetails.length
    const gainIdx0 = spawnedGainDetails.length
    const handle = triggerEnemyAlertCue(enemyTestMock.ctx, phase1Audio.effectsGain, true, enemyType, {
      enemyId: `${enemyType}-chase`,
    })
    const oscs = spawnedOscDetails.slice(oscIdx0)
    const gains = spawnedGainDetails.slice(gainIdx0)
    const freqs = oscs.flatMap((o) => o.freqValues)
    const maxChaseGain = Math.max(...gains.map((g) => g.maxGain))
    chaseProfiles[enemyType] = {
      duration: handle.durationSec,
      identity: handle.identity,
      minFreq: Math.min(...freqs),
      maxFreq: Math.max(...freqs),
    }
    assert(
      Boolean(handle) &&
        handle.category === ENEMY_AUDIO_CATEGORIES.ALERT_CHASE &&
        handle.durationSec >= 0.22 &&
        handle.durationSec <= 0.36 &&
        oscs.every((o) => o.node.type === 'sine' || o.node.type === 'triangle') &&
        maxChaseGain <= 0.28,
      `${enemyType} chase alert is a short crisp non-sawtooth/non-square effect (dur=${handle.durationSec}s, maxGain=${maxChaseGain.toFixed(2)})`
    )
    handle.stop({ immediate: true })
  }
  assert(
    chaseProfiles.hunter.minFreq > chaseProfiles.stalker.minFreq &&
      chaseProfiles.stalker.minFreq > chaseProfiles.brute.minFreq &&
      chaseProfiles.hunter.maxFreq > chaseProfiles.stalker.maxFreq &&
      chaseProfiles.stalker.maxFreq > chaseProfiles.brute.maxFreq,
    `Chase alerts occupy distinct frequency bands across Hunter (${chaseProfiles.hunter.minFreq}-${chaseProfiles.hunter.maxFreq}Hz), Stalker (${chaseProfiles.stalker.minFreq}-${chaseProfiles.stalker.maxFreq}Hz), and Brute (${chaseProfiles.brute.minFreq}-${chaseProfiles.brute.maxFreq}Hz)`
  )

  // 12c. Independent investigate & chase cooldowns: PATROL -> INVESTIGATE followed immediately (<0.2s)
  //      by INVESTIGATE -> CHASE must NOT suppress enemy_detect_chase!
  const indepMaze = {
    rows: 5,
    cols: 5,
    start: { row: 1, col: 1 },
    exit: { row: 3, col: 3 },
    seed: 5511,
    difficulty: 'medium',
    grid: [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ],
  }
  phase1Audio.setMaze(indepMaze)
  phase1Audio.clearCueHistory()
  const playerPosIndep = gridToWorld(1, 1, indepMaze)
  const testAgent = new EnemyAgent('indep-stalker', {
    maze: indepMaze,
    type: ENEMY_TYPES.STALKER,
    spawnCell: { row: 1, col: 3 },
  })
  phase1Audio.update(0.016, { playerWorldPos: playerPosIndep, enemies: [testAgent] })

  // Patrol -> Investigate
  testAgent.state = ENEMY_STATES.INVESTIGATE
  phase1Audio.update(0.05, { playerWorldPos: playerPosIndep, enemies: [testAgent] })
  // Only 0.1s later: Investigate -> Chase
  enemyTestMock.ctx.currentTime += 0.1
  testAgent.state = ENEMY_STATES.CHASE
  phase1Audio.update(0.1, { playerWorldPos: playerPosIndep, enemies: [testAgent] })

  const indepHistory = phase1Audio.getCueHistory()
  assert(
    indepHistory.filter((c) => c.type === 'enemy_detect_investigate').length === 1 &&
      indepHistory.filter((c) => c.type === 'enemy_detect_chase').length === 1,
    'Investigate alert does not suppress an immediately following Investigate -> Chase alert'
  )

  // 12d. ATTACK -> CHASE transition deduplication across multiple attack cycles
  phase1Audio.clearCueHistory()
  for (let cycle = 0; cycle < 3; cycle += 1) {
    enemyTestMock.ctx.currentTime += 2.5
    testAgent.state = ENEMY_STATES.ATTACK
    phase1Audio.update(2.5, {
      playerWorldPos: playerPosIndep,
      enemies: [testAgent],
      attackHits: [{ enemyId: testAgent.id, enemyType: testAgent.type, position: testAgent.worldPos }],
    })
    enemyTestMock.ctx.currentTime += 2.5
    testAgent.state = ENEMY_STATES.CHASE
    phase1Audio.update(2.5, { playerWorldPos: playerPosIndep, enemies: [testAgent] })
  }
  const postAttackHistory = phase1Audio.getCueHistory()
  assert(
    postAttackHistory.filter((c) => c.type === 'enemy_attack_windup').length === 3 &&
      postAttackHistory.filter((c) => c.type === 'enemy_attack_hit').length === 3 &&
      postAttackHistory.filter((c) => c.type === 'enemy_detect_chase').length === 0,
    'ATTACK -> CHASE recovery across 3 attack cycles triggers 0 duplicate chase alerts'
  )
  testAgent.dispose()

  // 12e. Excessive simultaneous enemy audio cap + lifecycle cleanup + enemyVocalGain bus ducking
  phase1Audio.setMaze(indepMaze)
  phase1Audio.clearCueHistory()
  const swarm = []
  for (let i = 0; i < 6; i += 1) {
    const e = new EnemyAgent(`swarm-${i}`, {
      maze: indepMaze,
      type: i % 3 === 0 ? ENEMY_TYPES.BRUTE : i % 3 === 1 ? ENEMY_TYPES.HUNTER : ENEMY_TYPES.STALKER,
      spawnCell: { row: 1 + (i % 3), col: 2 + (i % 2) },
    })
    swarm.push(e)
  }
  phase1Audio.update(0.016, { playerWorldPos: playerPosIndep, enemies: swarm })
  swarm.forEach((e) => {
    e.state = ENEMY_STATES.CHASE
  })
  phase1Audio.update(0.016, { playerWorldPos: playerPosIndep, enemies: swarm })

  const swarmChaseCues = phase1Audio.getCueHistory().filter((c) => c.type === 'enemy_detect_chase')
  assert(
    swarmChaseCues.length <= ENEMY_AUDIO_LIMITS.maxConcurrentAlerts &&
      phase1Audio.getAudioState().activeEnemyCueCount <= ENEMY_AUDIO_LIMITS.maxActiveEnemyCues,
    `Simultaneous swarm chase alerts capped cleanly (${swarmChaseCues.length} <= ${ENEMY_AUDIO_LIMITS.maxConcurrentAlerts}, active=${phase1Audio.getAudioState().activeEnemyCueCount})`
  )

  // Verify pause & reset stop active enemy cues immediately/safely
  phase1Audio.setPaused(true)
  assert(phase1Audio.getAudioState().activeEnemyCueCount === 0, 'setPaused(true) clears active enemy cues')
  phase1Audio.setPaused(false)

  // Verify reusable Phase 2-5 enemyVocalGain bus + playEnemyPcmBufferCue + combat ducking
  const mockEnemyPcm = enemyTestMock.ctx.createBuffer(1, 4410, 44100)
  const vocalHandle = playEnemyPcmBufferCue(enemyTestMock.ctx, phase1Audio.enemyVocalGain, mockEnemyPcm, {
    enemyId: 'swarm-0',
    enemyType: 'brute',
  })
  assert(
    Boolean(vocalHandle) && vocalHandle.category === ENEMY_AUDIO_CATEGORIES.VOCAL && vocalHandle.isActive(),
    'playEnemyPcmBufferCue creates active lifecycle handle on enemyVocalGain bus'
  )
  enemyTestMock.ctx.currentTime += 1.0
  assert(
    phase1Audio.onPlayerDamage({ damage: 25, healthDelta: 25 }) === true &&
      Math.abs(phase1Audio.getAudioState().enemyVocalGain - 0.55) < 1e-4,
    'Player damage vocal smoothly ducks enemyVocalGain bus alongside enemyAttackGain'
  )
  vocalHandle.stop({ immediate: true })

  // Verify attack handles also stop cleanly on onGameOver()
  const atkHandle = triggerEnemyAttackCue(
    enemyTestMock.ctx,
    phase1Audio.enemyAttackGain,
    phase1Audio.noiseBuffer,
    false,
    'stalker',
    { enemyId: 'swarm-0' }
  )
  assert(Boolean(atkHandle) && atkHandle.isActive(), 'triggerEnemyAttackCue returns active handle')
  atkHandle.stop({ immediate: true })

  swarm.forEach((e) => {
    e.state = ENEMY_STATES.ATTACK
  })
  enemyTestMock.ctx.currentTime += 1.0
  phase1Audio.update(1.0, { playerWorldPos: playerPosIndep, enemies: swarm })
  const activeAttackCues = Array.from(phase1Audio._activeEnemyCues).filter(
    (entry) =>
      entry.category === ENEMY_AUDIO_CATEGORIES.ATTACK_WINDUP ||
      entry.category === ENEMY_AUDIO_CATEGORIES.ATTACK_HIT
  )
  assert(
    activeAttackCues.length > 0 &&
      activeAttackCues.length <= ENEMY_AUDIO_LIMITS.maxConcurrentAttacks &&
      phase1Audio.getAudioState().activeEnemyCueCount <= ENEMY_AUDIO_LIMITS.maxActiveEnemyCues,
    'Simultaneous enemy attack cues bounded by maxConcurrentAttacks'
  )
  phase1Audio.onGameOver()
  assert(
    phase1Audio.getAudioState().activeEnemyCueCount === 0,
    'onGameOver() stops and disconnects all in-flight enemy audio cues'
  )

  swarm.forEach((e) => e.dispose())
  phase1Audio.dispose()
}
console.log('✓ Phase 1 enemy alert redesign, deduplication, independent cooldowns, concurrency limits, and cleanup verified')

// ---------------------------------------------------------------------------
// Test 13: Phase 2 Enemy Vocalizations (Profiles, Scheduling, Cooldowns, Concurrency & Cleanup)
// ---------------------------------------------------------------------------
console.log('Test 13: Phase 2 Enemy Vocalizations, Profiles, Scheduling & Concurrency')
{
  const {
    ENEMY_AUDIO_CATEGORIES,
    ENEMY_VOCAL_SPECS,
    triggerEnemyVocalCue,
  } = await import('./audioSynthesis.js')
  const { EnemyAgent, ENEMY_TYPES } = await import('./EnemyAgent.js')
  const { ENEMY_AUDIO_LIMITS } = await import('./HorrorAudioEngine.js')

  const vocalMock = createMockAudioContext()
  const vocalAudio = new HorrorAudioEngine({
    createAudioContext: () => vocalMock.ctx,
    autoUnlock: true,
    recordCueHistory: true,
  })
  vocalAudio.setMaze(occlusionTestMaze)

  // 13a. Verify all 3 enemy types define distinct vocal identities and variants
  const vocalIdentities = new Set()
  for (const enemyType of ['stalker', 'hunter', 'brute']) {
    const spec = ENEMY_VOCAL_SPECS[enemyType]
    vocalIdentities.add(spec.identity)
    assert(spec.variants && spec.variants.growl && spec.variants.snarl && spec.variants.burst, `${enemyType} defines growl, snarl, and burst vocal variants`)
    const handle = triggerEnemyVocalCue(vocalMock.ctx, vocalAudio.enemyVocalGain, vocalAudio.noiseBuffer, enemyType, 'growl', {
      enemyId: `${enemyType}-vocal`,
    })
    assert(
      Boolean(handle) && handle.category === ENEMY_AUDIO_CATEGORIES.VOCAL && handle.durationSec > 0.2 && handle.isActive(),
      `${enemyType} vocal cue triggers successfully with active handle`
    )
    handle.stop({ immediate: true })
  }
  assert(vocalIdentities.size === 3, 'All three enemy types define distinct vocal profile identities')

  // 13b. Verify state-triggered enemy vocalizations in engine update with maxConcurrentVocals: 1 cap
  vocalAudio.clearCueHistory()
  const vocalAgent = new EnemyAgent('vocal-stalker', {
    maze: occlusionTestMaze,
    type: ENEMY_TYPES.STALKER,
    spawnCell: { row: 1, col: 2 },
  })
  vocalAgent.state = ENEMY_STATES.CHASE

  // Force deterministic rng for testing
  vocalAudio._ambientRng = () => 0.01

  const playerPosVocal = gridToWorld(1, 1, occlusionTestMaze)
  for (let t = 0; t < 10; t += 1) {
    vocalMock.ctx.currentTime += 0.5
    vocalAudio.update(0.5, { playerWorldPos: playerPosVocal, enemies: [vocalAgent] })
  }

  const vocalHistory = vocalAudio.getCueHistory().filter((c) => c.type === 'enemy_vocal')
  assert(
    vocalHistory.length >= 1 && vocalAudio.getAudioState().activeEnemyCueCount <= ENEMY_AUDIO_LIMITS.maxConcurrentVocals,
    `Engine schedules enemy vocalizations during chase with concurrency cap (${vocalAudio.getAudioState().activeEnemyCueCount} <= ${ENEMY_AUDIO_LIMITS.maxConcurrentVocals})`
  )

  vocalAgent.dispose()
  vocalAudio.dispose()
}
console.log('✓ Phase 2 enemy vocalizations, profiles, scheduling, concurrency and cleanup verified')

// ---------------------------------------------------------------------------
// Test 14: Phase 3 Enemy Breathing (Profiles, Coordination, Concurrency & Cleanup)
// ---------------------------------------------------------------------------
console.log('Test 14: Phase 3 Enemy Breathing, Profiles, Coordination & Concurrency')
{
  const {
    ENEMY_AUDIO_CATEGORIES,
    ENEMY_BREATH_SPECS,
    triggerEnemyBreathCue,
  } = await import('./audioSynthesis.js')
  const { EnemyAgent, ENEMY_TYPES } = await import('./EnemyAgent.js')
  const { ENEMY_AUDIO_LIMITS } = await import('./HorrorAudioEngine.js')

  const breathMock = createMockAudioContext()
  const breathAudio = new HorrorAudioEngine({
    createAudioContext: () => breathMock.ctx,
    autoUnlock: true,
    recordCueHistory: true,
  })
  breathAudio.setMaze(occlusionTestMaze)

  // 14a. Verify all 3 enemy types define distinct breathing profiles
  for (const enemyType of ['stalker', 'hunter', 'brute']) {
    const spec = ENEMY_BREATH_SPECS[enemyType]
    assert(spec && spec.durationSec > 0 && spec.layers.length > 0, `${enemyType} defines valid breathing spec`)
    const handle = triggerEnemyBreathCue(breathMock.ctx, breathAudio.enemyVocalGain, breathAudio.noiseBuffer, enemyType, {
      enemyId: `${enemyType}-breath`,
    })
    assert(
      Boolean(handle) && handle.category === ENEMY_AUDIO_CATEGORIES.BREATH && handle.durationSec > 0.3 && handle.isActive(),
      `${enemyType} breathing cue triggers successfully with active handle`
    )
    handle.stop({ immediate: true })
  }

  // 14b. Verify engine updates schedule breathing with maxConcurrentBreaths cap and zero overlap with vocalizations
  breathAudio.clearCueHistory()
  const breathAgent = new EnemyAgent('breath-stalker', {
    maze: occlusionTestMaze,
    type: ENEMY_TYPES.STALKER,
    spawnCell: { row: 1, col: 2 },
  })
  breathAgent.state = ENEMY_STATES.PATROL

  breathAudio._ambientRng = () => 0.025
  const playerPosBreath = gridToWorld(1, 1, occlusionTestMaze)
  for (let t = 0; t < 12; t += 1) {
    breathMock.ctx.currentTime += 0.5
    breathAudio.update(0.5, { playerWorldPos: playerPosBreath, enemies: [breathAgent] })
  }

  const breathHistory = breathAudio.getCueHistory().filter((c) => c.type === 'enemy_breath')
  assert(
    breathHistory.length >= 1 && breathAudio.getAudioState().activeEnemyCueCount <= ENEMY_AUDIO_LIMITS.maxConcurrentBreaths,
    `Engine schedules enemy breathing with concurrency cap (${breathAudio.getAudioState().activeEnemyCueCount} <= ${ENEMY_AUDIO_LIMITS.maxConcurrentBreaths})`
  )

  breathAgent.dispose()
  breathAudio.dispose()
}
console.log('✓ Phase 3 enemy breathing, profiles, coordination, concurrency and cleanup verified')

// ---------------------------------------------------------------------------
// Test 15: Phase 4 Procedural Player Breathing (Profiles, Stamina, Cadence, Danger & Vocal Coordination)
// ---------------------------------------------------------------------------
console.log('Test 15: Phase 4 Procedural Player Breathing, Stamina, Cadence, Danger & Coordination')
{
  const {
    PLAYER_BREATH_PROFILES,
    triggerPlayerBreathCue,
    ENEMY_BREATH_SPECS,
    ENEMY_VOCAL_SPECS,
  } = await import('./audioSynthesis.js')
  const { EnemyAgent, ENEMY_TYPES } = await import('./EnemyAgent.js')
  const { HorrorAudioEngine } = await import('./HorrorAudioEngine.js')

  const playerMock = createMockAudioContext()
  const pAudio = new HorrorAudioEngine({
    createAudioContext: () => playerMock.ctx,
    autoUnlock: true,
    recordCueHistory: true,
  })
  pAudio.setMaze(occlusionTestMaze)

  // 15a. Verify all 7 player breath profiles and inhale/exhale/cycle phases
  const expectedModes = ['resting', 'walking', 'running', 'low_stamina', 'exhausted', 'danger', 'strained']
  for (const m of expectedModes) {
    const prof = PLAYER_BREATH_PROFILES[m]
    assert(
      prof && prof.inhaleDuration > 0 && prof.exhaleDuration > 0 && prof.inhaleGain > 0 && prof.exhaleGain > 0,
      `PLAYER_BREATH_PROFILES.${m} defines valid durations and gains`
    )
    // Inhale phase
    const hInhale = triggerPlayerBreathCue(playerMock.ctx, pAudio.playerBreathGain, pAudio.noiseBuffer, {
      mode: m,
      phase: 'inhale',
    })
    assert(
      Boolean(hInhale) && hInhale.kind === 'player_breath' && hInhale.phase === 'inhale' && hInhale.isActive(),
      `${m} inhale cue triggers active handle`
    )
    hInhale.stop({ immediate: true })

    // Full cycle phase
    const hCycle = triggerPlayerBreathCue(playerMock.ctx, pAudio.playerBreathGain, pAudio.noiseBuffer, {
      mode: m,
      phase: 'cycle',
    })
    assert(
      Boolean(hCycle) && hCycle.kind === 'player_breath' && hCycle.phase === 'cycle' && hCycle.isActive(),
      `${m} cycle cue triggers active handle`
    )
    hCycle.stop({ immediate: true })
  }

  // 15b. Resting, walking, and running breathing cadence via engine update
  const playerPos = gridToWorld(1, 1, occlusionTestMaze)

  // Resting
  pAudio.clearCueHistory()
  pAudio._playerBreathTimer = 4.25 // advance timer past resting interval (4.2s)
  pAudio.update(0.1, {
    playerWorldPos: playerPos,
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
    stamina: 100,
    maxStamina: 100,
  })
  let breathHistory = pAudio.getCueHistory().filter((c) => c.type === 'player_breath')
  assert(
    breathHistory.length === 1 && (breathHistory[0].mode || breathHistory[0].meta?.mode) === 'resting',
    'Resting player schedules quiet resting breathing cycle'
  )
  assert(pAudio.getAudioState().activePlayerBreathCount === 1, 'Resting breath handle is actively tracked')
  pAudio._stopActivePlayerBreath({ immediate: true })

  // Walking
  pAudio.clearCueHistory()
  pAudio._playerBreathTimer = 2.95 // past walking interval (2.9s)
  pAudio.update(0.1, {
    playerWorldPos: playerPos,
    playerMotion: { moved: true, isSprinting: false, actualSpeed: 2.2 },
    stamina: 95,
    maxStamina: 100,
  })
  breathHistory = pAudio.getCueHistory().filter((c) => c.type === 'player_breath')
  assert(
    breathHistory.length === 1 && (breathHistory[0].mode || breathHistory[0].meta?.mode) === 'walking',
    'Walking player schedules walking breathing cadence'
  )
  pAudio._stopActivePlayerBreath({ immediate: true })

  // Running
  pAudio.clearCueHistory()
  pAudio._playerBreathTimer = 1.9 // past running interval (1.85s)
  pAudio.update(0.1, {
    playerWorldPos: playerPos,
    playerMotion: { moved: true, isSprinting: true, actualSpeed: 4.5 },
    stamina: 80,
    maxStamina: 100,
  })
  breathHistory = pAudio.getCueHistory().filter((c) => c.type === 'player_breath')
  assert(
    breathHistory.length === 1 && (breathHistory[0].mode || breathHistory[0].meta?.mode) === 'running',
    'Sprinting player schedules running breathing cadence'
  )
  pAudio._stopActivePlayerBreath({ immediate: true })

  // 15c. Low stamina and exhaustion transitions
  // Low stamina (20%)
  pAudio.clearCueHistory()
  pAudio._playerBreathTimer = 1.8
  pAudio.update(0.1, {
    playerWorldPos: playerPos,
    playerMotion: { moved: false, isSprinting: false },
    stamina: 20,
    maxStamina: 100,
  })
  breathHistory = pAudio.getCueHistory().filter((c) => c.type === 'player_breath')
  assert(
    breathHistory.length === 1 && (breathHistory[0].mode || breathHistory[0].meta?.mode) === 'low_stamina',
    'Low stamina player transitions to low_stamina breathing mode'
  )
  pAudio._stopActivePlayerBreath({ immediate: true })

  // Exhausted (0%)
  pAudio.clearCueHistory()
  pAudio._playerBreathTimer = 1.2
  pAudio.update(0.1, {
    playerWorldPos: playerPos,
    playerMotion: { moved: false, isSprinting: false },
    stamina: 0,
    maxStamina: 100,
    isExhausted: true,
  })
  breathHistory = pAudio.getCueHistory().filter((c) => c.type === 'player_breath')
  assert(
    breathHistory.length === 1 && (breathHistory[0].mode || breathHistory[0].meta?.mode) === 'exhausted',
    'Exhausted player transitions to heavy exhausted breathing mode'
  )
  pAudio._stopActivePlayerBreath({ immediate: true })

  // Stamina recovery: back to 100%
  pAudio.clearCueHistory()
  pAudio._playerBreathTimer = 4.3
  pAudio.update(0.1, {
    playerWorldPos: playerPos,
    playerMotion: { moved: false, isSprinting: false },
    stamina: 100,
    maxStamina: 100,
    isExhausted: false,
  })
  breathHistory = pAudio.getCueHistory().filter((c) => c.type === 'player_breath')
  assert(
    breathHistory.length === 1 && (breathHistory[0].mode || breathHistory[0].meta?.mode) === 'resting',
    'Stamina recovery smoothly restores resting breathing mode'
  )
  pAudio._stopActivePlayerBreath({ immediate: true })

  // 15d. Horror and danger responsiveness
  const dangerAgent = new EnemyAgent('danger-stalker', {
    maze: occlusionTestMaze,
    type: ENEMY_TYPES.STALKER,
    spawnCell: { row: 1, col: 2 },
  })
  dangerAgent.state = ENEMY_STATES.CHASE
  pAudio.clearCueHistory()
  pAudio._playerBreathTimer = 2.45
  pAudio.update(0.1, {
    playerWorldPos: playerPos,
    playerMotion: { moved: false, isSprinting: false },
    enemies: [dangerAgent],
    stamina: 100,
  })
  breathHistory = pAudio.getCueHistory().filter((c) => c.type === 'player_breath')
  assert(
    breathHistory.length === 1 && (breathHistory[0].mode || breathHistory[0].meta?.mode) === 'danger',
    'Nearby chasing enemy triggers tense danger breathing mode'
  )
  pAudio._stopActivePlayerBreath({ immediate: true })
  dangerAgent.dispose()

  // 15e. Coordination with player vocal reactions & damage recovery
  // Trigger a player breath
  pAudio.triggerPlayerBreath({ mode: 'resting' })
  assert(pAudio.getAudioState().activePlayerBreathCount === 1, 'Breath is active before damage')

  // Taking damage immediately stops active breath and initiates strained breathing
  pAudio.onPlayerDamage({ damage: 25, healthDelta: 25 })
  assert(pAudio.getAudioState().activePlayerBreathCount === 0, 'onPlayerDamage immediately cuts active breathing')
  assert(pAudio.getAudioState().activeVocalCueCount === 1, 'Damage vocal reaction is currently active')

  // While vocal is active, breathing does NOT play
  pAudio._playerBreathTimer = 5.0
  pAudio.update(0.1, { playerWorldPos: playerPos, stamina: 100 })
  assert(pAudio.getAudioState().activePlayerBreathCount === 0, 'Breathing never overlaps active player vocal reaction')

  // Once vocal finishes, strained breathing takes effect
  pAudio._stopActiveVocalCue({ immediate: true })
  pAudio._playerBreathTimer = 1.5
  pAudio.update(0.1, { playerWorldPos: playerPos, stamina: 100 })
  breathHistory = pAudio.getCueHistory().filter((c) => c.type === 'player_breath')
  const lastBreath = breathHistory[breathHistory.length - 1]
  assert(
    lastBreath && (lastBreath.mode || lastBreath.meta?.mode) === 'strained',
    'Post-damage strained breathing activates after vocal completes'
  )

  // 15f. Lifecycle cleanup: pause, game-over, victory, reset, and disposal
  pAudio.setPaused(true)
  assert(pAudio.getAudioState().activePlayerBreathCount === 0, 'setPaused(true) stops player breath')
  pAudio.setPaused(false)

  pAudio.triggerPlayerBreath({ mode: 'walking' })
  assert(pAudio.getAudioState().activePlayerBreathCount === 1, 'Breath restarts after unpause')
  pAudio.onGameOver()
  assert(pAudio.getAudioState().activePlayerBreathCount === 0, 'onGameOver() clears active player breath')

  pAudio.triggerPlayerBreath({ mode: 'walking' })
  pAudio.setHasWon(true)
  assert(pAudio.getAudioState().activePlayerBreathCount === 0, 'setHasWon(true) clears active player breath')

  pAudio.triggerPlayerBreath({ mode: 'walking' })
  pAudio.reset()
  assert(pAudio.getAudioState().activePlayerBreathCount === 0, 'reset() clears active player breath')

  pAudio.triggerPlayerBreath({ mode: 'walking' })
  pAudio.dispose()
  assert(pAudio.getAudioState().activePlayerBreathCount === 0 && pAudio.playerBreathGain === null, 'dispose() cleans up breath and nulls node')

  // 15g. Regression protection for enemy vocalizations and enemy breathing
  assert(ENEMY_VOCAL_SPECS.stalker && ENEMY_VOCAL_SPECS.hunter && ENEMY_VOCAL_SPECS.brute, 'Phase 2 enemy vocals intact')
  assert(ENEMY_BREATH_SPECS.stalker && ENEMY_BREATH_SPECS.hunter && ENEMY_BREATH_SPECS.brute, 'Phase 3 enemy breathing intact')
}
console.log('✓ Phase 4 procedural player breathing, stamina, cadence, danger, coordination and cleanup verified')

// ---------------------------------------------------------------------------
// Test 16: Phase 5 Final Horror Audio Integration, Mixing, Priority Eviction & Audition Catalog
// ---------------------------------------------------------------------------
console.log('Test 16: Phase 5 Final Horror Audio Integration, Mixing, Priority Eviction & Audition Catalog')
{
  const { ENEMY_AUDIO_CATEGORIES, PLAYER_BREATH_PROFILES } = await import('./audioSynthesis.js')
  const { ENEMY_AUDIO_LIMITS } = await import('./HorrorAudioEngine.js')
  const { EnemyAgent, ENEMY_TYPES, ENEMY_STATES } = await import('./EnemyAgent.js')

  const phase5Mock = createMockAudioContext()
  const phase5Audio = new HorrorAudioEngine({
    createAudioContext: () => phase5Mock.ctx,
  })
  phase5Audio.unlock()

  const phase5Maze = {
    id: 'phase5-audit-maze',
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ],
    width: 7,
    height: 5,
    cellSize: 4,
  }
  phase5Audio.setMaze(phase5Maze)

  // 16a. Priority hierarchy and eviction verification
  // Active cue limit is 6. Fill slots with level-4 cues (priority 1 footsteps/breaths)
  const playerPos = new THREE.Vector3(8, 1.65, 8)
  const testEnemies = []
  for (let i = 0; i < 6; i += 1) {
    const e = new EnemyAgent(`priority-test-${i}`, {
      maze: phase5Maze,
      type: i % 2 === 0 ? ENEMY_TYPES.STALKER : ENEMY_TYPES.HUNTER,
      spawnCell: { row: 1 + (i % 3), col: 2 + (i % 2) },
    })
    e.state = ENEMY_STATES.PATROL
    testEnemies.push(e)
  }

  // Dispatch 3 footsteps (priority 1, limit 3)
  for (let i = 0; i < 3; i += 1) {
    phase5Audio._dispatchEnemyCue({
      category: ENEMY_AUDIO_CATEGORIES.FOOTSTEP,
      enemyId: `priority-test-${i}`,
      enemyType: 'stalker',
      worldPos: playerPos,
      priority: 1,
      triggerCue: () => ({ isActive: () => true, stop: () => {} }),
    })
  }
  // Dispatch 2 breaths (priority 1, limit 2)
  for (let i = 3; i < 5; i += 1) {
    phase5Audio._dispatchEnemyCue({
      category: ENEMY_AUDIO_CATEGORIES.BREATH,
      enemyId: `priority-test-${i}`,
      enemyType: 'hunter',
      worldPos: playerPos,
      priority: 1,
      triggerCue: () => ({ isActive: () => true, stop: () => {} }),
    })
  }
  // Dispatch 1 alert (priority 2, limit 2)
  phase5Audio._dispatchEnemyCue({
    category: ENEMY_AUDIO_CATEGORIES.ALERT_INVESTIGATE,
    enemyId: 'priority-test-5',
    enemyType: 'stalker',
    worldPos: playerPos,
    priority: 2,
    triggerCue: () => ({ isActive: () => true, stop: () => {} }),
  })

  assert(
    phase5Audio.getAudioState().activeEnemyCueCount === 6,
    'All 6 active enemy cue slots populated across categories within bucket limits'
  )

  // Incoming Level 3 sound: VOCAL (priority 3). Must evict a priority 1 sound!
  const vocalDispatched = phase5Audio._dispatchEnemyCue({
    category: ENEMY_AUDIO_CATEGORIES.VOCAL,
    enemyId: 'priority-test-0',
    enemyType: 'stalker',
    worldPos: playerPos,
    priority: 3,
    triggerCue: () => ({ isActive: () => true, stop: () => {} }),
  })
  assert(vocalDispatched === true, 'Level 3 vocal (priority 3) successfully evicts lower-priority sound')
  assert(
    phase5Audio.getAudioState().activeEnemyCueCount <= ENEMY_AUDIO_LIMITS.maxActiveEnemyCues,
    'Active enemy cues remain strictly bounded by maxActiveEnemyCues after priority eviction'
  )

  // Incoming Level 2 sound: ATTACK_WINDUP (priority 4). Must evict a lower-priority sound!
  const windupDispatched = phase5Audio._dispatchEnemyCue({
    category: ENEMY_AUDIO_CATEGORIES.ATTACK_WINDUP,
    enemyId: 'priority-test-1',
    enemyType: 'hunter',
    worldPos: playerPos,
    priority: 4,
    triggerCue: () => ({ isActive: () => true, stop: () => {} }),
  })
  assert(windupDispatched === true, 'Level 2 attack windup (priority 4) successfully evicts lower-priority sound')

  // Incoming Level 2 sound: ATTACK_HIT (priority 5). Must succeed with highest priority!
  const hitDispatched = phase5Audio._dispatchEnemyCue({
    category: ENEMY_AUDIO_CATEGORIES.ATTACK_HIT,
    enemyId: 'priority-test-2',
    enemyType: 'brute',
    worldPos: playerPos,
    priority: 5,
    triggerCue: () => ({ isActive: () => true, stop: () => {} }),
  })
  assert(hitDispatched === true, 'Level 2 attack hit (priority 5) successfully plays with top priority')

  // Attempting to dispatch a low-priority footstep (priority 1) when bucket or global limit is full
  // of higher-priority sounds must NOT evict high priority sounds!
  const lowFootstepDispatched = phase5Audio._acquireEnemyCueSlot(
    ENEMY_AUDIO_CATEGORIES.FOOTSTEP,
    0.1, // low gain
    1 // low priority
  )
  assert(
    lowFootstepDispatched === false,
    'Low-priority footstep cannot evict high-priority attacks or vocals'
  )

  // 16b. Mixing, dynamic ducking & ambient suppression
  assert(
    phase5Audio.onPlayerDamage({ damage: 25, healthDelta: 25 }) === true,
    'Player damage event triggers priority #1 reaction'
  )
  const audioStateAfterDamage = phase5Audio.getAudioState()
  assert(
    Math.abs(audioStateAfterDamage.enemyAttackGain - 0.65) < 1e-4,
    'Player damage vocal smoothly ducks enemyAttackGain bus to 0.65'
  )
  assert(
    Math.abs(audioStateAfterDamage.enemyVocalGain - 0.55) < 1e-4,
    'Player damage vocal smoothly ducks enemyVocalGain bus to 0.55'
  )
  assert(
    Math.abs(audioStateAfterDamage.hazardAudioGain - 0.6) < 1e-4,
    'Player damage vocal smoothly ducks hazardAudioGain bus to 0.60'
  )
  assert(
    audioStateAfterDamage.activePlayerBreathCount === 0,
    'Player damage vocal immediately cuts active player breathing'
  )

  // 16c. Comprehensive 22-preset Audition catalog
  assert(Array.isArray(AUDITION_PRESETS) && AUDITION_PRESETS.length === 22, 'AUDITION_PRESETS exposes all 22 presets')
  assert(
    Array.isArray(VOCAL_AUDITION_PRESETS) && VOCAL_AUDITION_PRESETS.length === 4,
    'VOCAL_AUDITION_PRESETS preserves 4-element backward compatibility for Test 11'
  )
  assert(phase5Audio.getAuditionPresets().length === 22, 'getAuditionPresets() returns all 22 presets')
  assert(phase5Audio.getVocalAuditionPresets().length === 4, 'getVocalAuditionPresets() returns 4 presets')
  assert(
    AUDITION_PRESETS.find((p) => p.id === 'enemy_vocal_brute')?.variant === 'growl',
    'Brute audition preset uses guttural growl vocal variant'
  )

  // Verify all categories exist in catalog:
  const categoriesInCatalog = new Set(AUDITION_PRESETS.map((p) => p.category))
  assert(categoriesInCatalog.has('player_vocal'), 'Catalog includes player_vocal')
  assert(categoriesInCatalog.has('player_breath'), 'Catalog includes player_breath')
  assert(categoriesInCatalog.has('enemy_breath'), 'Catalog includes enemy_breath')
  assert(categoriesInCatalog.has('enemy_vocal'), 'Catalog includes enemy_vocal')
  assert(categoriesInCatalog.has('alerts_attacks'), 'Catalog includes alerts_attacks')
  assert(categoriesInCatalog.has('combat_mix'), 'Catalog includes combat_mix')
  const breathModesInCatalog = new Set(
    AUDITION_PRESETS.filter((p) => p.category === 'player_breath').map((p) => p.mode)
  )
  for (const mode of Object.keys(PLAYER_BREATH_PROFILES)) {
    assert(breathModesInCatalog.has(mode), `AUDITION_PRESETS covers player breath profile '${mode}'`)
  }

  // Test individual playback of each audition category
  for (const preset of AUDITION_PRESETS) {
    const res = phase5Audio.auditionCue(preset.id)
    assert(
      res && res.played === true && res.presetId === preset.id,
      `Audition preset ${preset.id} plays cleanly through production pipeline`
    )
    phase5Audio.stopAudition({ immediate: true })
  }

  // Combined combat mix test
  const mixRes = phase5Audio.auditionCue('combined_combat_mix')
  assert(
    mixRes && mixRes.played === true && mixRes.presetId === 'combined_combat_mix',
    'combined_combat_mix audition sequence initializes smoothly'
  )
  assert(phase5Audio.stopAudition({ immediate: true }) === true, 'stopAudition cancels active combat mix')

  // 16d. Full lifecycle stability across maze transitions, victory, restart & disposal
  phase5Audio.triggerPlayerBreath({ mode: 'running' })
  assert(phase5Audio.getAudioState().activePlayerBreathCount === 1, 'Player breath active before maze switch')

  const nextMaze = {
    id: 'phase5-next-maze',
    grid: [[1, 1, 1], [1, 0, 1], [1, 1, 1]],
    width: 3,
    height: 3,
    cellSize: 4,
  }
  phase5Audio.setMaze(nextMaze)
  assert(
    phase5Audio.getAudioState().activePlayerBreathCount === 0,
    'setMaze() terminates in-flight player breath without lingering audio nodes'
  )
  assert(
    phase5Audio.getAudioState().activeEnemyCueCount === 0,
    'setMaze() terminates all in-flight enemy cues'
  )

  phase5Audio.triggerPlayerBreath({ mode: 'exhausted' })
  phase5Audio.setHasWon(true)
  assert(
    phase5Audio.getAudioState().activePlayerBreathCount === 0,
    'setHasWon(true) cleanly stops player breath'
  )

  phase5Audio.setHasWon(false)
  phase5Audio.triggerPlayerBreath({ mode: 'resting' })
  phase5Audio.reset()
  assert(
    phase5Audio.getAudioState().activePlayerBreathCount === 0,
    'reset() cleanly resets player breath and timers'
  )

  phase5Audio.triggerPlayerBreath({ mode: 'resting' })
  phase5Audio.dispose()
  assert(
    phase5Audio.isDisposed === true &&
      phase5Audio.playerBreathGain === null &&
      phase5Audio.playerVocalGain === null &&
      phase5Audio.enemyAttackGain === null &&
      phase5Audio.enemyVocalGain === null,
    'dispose() cleanly nullifies all gain nodes and tears down engine'
  )

  // 16e. MazeSceneEngine integration check
  const sceneMock = createMockAudioContext()
  const sceneEngine = createHeadlessEngine({
    audio: { createAudioContext: () => sceneMock.ctx },
  })
  assert(sceneEngine.getAuditionPresets().length === 22, 'MazeSceneEngine exposes all 22 audition presets')
  assert(sceneEngine.getVocalAuditionPresets().length === 4, 'MazeSceneEngine exposes 4 vocal presets')
  assert(sceneEngine.auditionCue('elevator_startled') !== null, 'MazeSceneEngine auditionCue works')
  assert(sceneEngine.stopAudition() === true, 'MazeSceneEngine stopAudition works')
  sceneEngine.dispose()

  for (const e of testEnemies) e.dispose()
}
console.log('✓ Phase 5 final horror audio integration, mixing, priority eviction & audition catalog verified')

// ---------------------------------------------------------------------------
// Test 17: Phase 5C Regression Verification (Breathing Audibility, Routing,
//          Unified Priority & Distance Eviction, Ducking, Victory & Audition)
// ---------------------------------------------------------------------------
console.log('Test 17: Phase 5C Regression Verification')
{
  const {
    ENEMY_AUDIO_CATEGORIES,
    ENEMY_AUDIO_PRIORITIES,
    PLAYER_BREATH_PROFILES,
    triggerPlayerBreathCue,
    triggerEnemyFootstep,
    triggerEnemyBreathCue,
    triggerEnemyAlertCue,
    triggerEnemyVocalCue,
    triggerEnemyAttackCue,
    triggerStaminaWarningCue,
  } = await import('./audioSynthesis.js')
  const { EnemyAgent, ENEMY_TYPES, ENEMY_STATES } = await import('./EnemyAgent.js')

  // 17a. Non-squared player breathing gain & preserved profile hierarchy
  {
    const gMock = createMockAudioContext()
    const capturedGains = []
    const capturedConnections = []
    const origCreateGain = gMock.ctx.createGain.bind(gMock.ctx)
    gMock.ctx.createGain = () => {
      const g = origCreateGain()
      const rec = {
        node: g,
        initialSetValue: null,
        peakRampValue: 0,
        connectedTo: [],
      }
      const origSet = g.gain.setValueAtTime.bind(g.gain)
      g.gain.setValueAtTime = (v, t) => {
        if (rec.initialSetValue === null && Number.isFinite(Number(v))) {
          rec.initialSetValue = Number(v)
        }
        return origSet(v, t)
      }
      const origRamp = g.gain.linearRampToValueAtTime.bind(g.gain)
      g.gain.linearRampToValueAtTime = (v, t) => {
        rec.peakRampValue = Math.max(rec.peakRampValue, Number(v) || 0)
        return origRamp(v, t)
      }
      const origConn = g.connect.bind(g)
      g.connect = (dest) => {
        rec.connectedTo.push(dest)
        capturedConnections.push({ from: g, to: dest })
        return origConn(dest)
      }
      capturedGains.push(rec)
      return g
    }

    const bEngine = new HorrorAudioEngine({
      createAudioContext: () => gMock.ctx,
      autoUnlock: true,
      thunderEnabled: false,
      rainEnabled: false,
    })

    // Routing check: playerBreathGain -> playerVocalGain -> effectsGain
    assert(
      capturedConnections.some(
        (c) => c.from === bEngine.playerBreathGain && c.to === bEngine.playerVocalGain
      ) &&
        capturedConnections.some(
          (c) => c.from === bEngine.playerVocalGain && c.to === bEngine.effectsGain
        ),
      'Player breathing routes playerBreathGain -> playerVocalGain -> effectsGain'
    )

    const measuredModePeaks = {}
    for (const mode of ['resting', 'walking', 'danger', 'running', 'strained', 'low_stamina', 'exhausted']) {
      const gStart = capturedGains.length
      const h = triggerPlayerBreathCue(gMock.ctx, bEngine.playerBreathGain, bEngine.noiseBuffer, {
        mode,
        phase: 'cycle',
        seed: 1,
      })
      const spawned = capturedGains.slice(gStart)
      const cueBusRec = spawned[0]
      const layerPeak = Math.max(...spawned.slice(1).map((r) => r.peakRampValue))
      assert(
        Math.abs(cueBusRec.initialSetValue - 1.0) < 1e-6,
        `${mode} breath cue bus gain is 1.0 (no squared attenuation)`
      )
      assert(
        Math.abs(layerPeak - PLAYER_BREATH_PROFILES[mode].exhaleGain) < 1e-6,
        `${mode} peak layer gain matches profile.exhaleGain (${PLAYER_BREATH_PROFILES[mode].exhaleGain})`
      )
      measuredModePeaks[mode] = cueBusRec.initialSetValue * layerPeak
      h.stop({ immediate: true })
    }
    assert(
      measuredModePeaks.resting < measuredModePeaks.walking &&
        measuredModePeaks.walking < measuredModePeaks.danger &&
        measuredModePeaks.danger < measuredModePeaks.running &&
        measuredModePeaks.running < measuredModePeaks.strained &&
        measuredModePeaks.strained < measuredModePeaks.low_stamina &&
        measuredModePeaks.low_stamina < measuredModePeaks.exhausted,
      'Breath profile loudness ordering preserved: resting < walking < danger < running < strained < low_stamina < exhausted'
    )
    bEngine.dispose()
  }

  // 17b. Legacy stamina warning integrated through playerBreathGain (no effectsGain bypass)
  {
    const stamMock = createMockAudioContext()
    const stamEngine = new HorrorAudioEngine({
      createAudioContext: () => stamMock.ctx,
      autoUnlock: true,
      thunderEnabled: false,
      rainEnabled: false,
      recordCueHistory: true,
    })
    const directWarn = triggerStaminaWarningCue(
      stamMock.ctx,
      stamEngine.playerBreathGain,
      stamEngine.noiseBuffer,
      'heartbeat'
    )
    assert(
      directWarn && directWarn.kind === 'player_breath' && directWarn.mode === 'exhausted',
      'triggerStaminaWarningCue delegates cleanly to triggerPlayerBreathCue'
    )
    directWarn.stop({ immediate: true })

    stamEngine.clearCueHistory()
    const hBreath = stamEngine.onStaminaWarning('breathing')
    assert(
      Boolean(hBreath) && hBreath.mode === 'low_stamina' && stamEngine.getAudioState().activePlayerBreathCount === 1,
      'onStaminaWarning("breathing") triggers low_stamina breath via playerBreathGain'
    )
    // Blocked by active damage vocal
    stamEngine.onPlayerDamage({ damage: 20, healthDelta: 20 })
    assert(
      stamEngine.onStaminaWarning('heartbeat') === null,
      'onStaminaWarning cannot bypass or overlap active damage vocal'
    )
    stamEngine.dispose()

    // MazeSceneEngine exhaustion transition uses integrated player breathing (no competing legacy cue)
    const sceneStamMock = createMockAudioContext()
    const sceneStamEngine = createHeadlessEngine({
      skipSpawnSequence: true,
      enemies: { autoSpawn: false },
      audio: {
        createAudioContext: () => sceneStamMock.ctx,
        autoUnlock: true,
        thunderEnabled: false,
        rainEnabled: false,
        recordCueHistory: true,
      },
    })
    sceneStamEngine.setMaze(occlusionTestMaze)
    const sAudio = sceneStamEngine.getAudioEngine()
    sAudio.clearCueHistory()
    sceneStamEngine.stamina = 0
    sceneStamEngine.isExhausted = true
    sceneStamEngine.stepFrame(0.05)
    const exhCues = sAudio.getCueHistory().filter((c) => c.type === 'player_breath')
    assert(
      exhCues.length === 1 && exhCues[0].mode === 'exhausted',
      'MazeSceneEngine exhaustion triggers single exhausted breath via playerBreathGain without competing bypass'
    )
    sceneStamEngine.dispose()
  }

  // 17c. Unified priority metadata & distance-based live eviction without pre-dispatch count gate
  {
    const priMock = createMockAudioContext()
    const priAudio = new HorrorAudioEngine({
      createAudioContext: () => priMock.ctx,
      autoUnlock: true,
      thunderEnabled: false,
      rainEnabled: false,
    })
    const corridorMaze = {
      id: 'pri-corridor',
      grid: [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ],
      width: 7,
      height: 3,
      cellSize: 4,
    }
    priAudio.setMaze(corridorMaze)

    // Verify synthesis handle priority matches ENEMY_AUDIO_PRIORITIES
    const fH = triggerEnemyFootstep(priMock.ctx, priAudio.effectsGain, priAudio.noiseBuffer, false, 'stalker')
    const bH = triggerEnemyBreathCue(priMock.ctx, priAudio.enemyVocalGain, priAudio.noiseBuffer, 'stalker')
    const aInvH = triggerEnemyAlertCue(priMock.ctx, priAudio.effectsGain, false, 'stalker')
    const aChaH = triggerEnemyAlertCue(priMock.ctx, priAudio.effectsGain, true, 'hunter')
    const vH = triggerEnemyVocalCue(priMock.ctx, priAudio.enemyVocalGain, priAudio.noiseBuffer, 'brute', 'growl')
    const wH = triggerEnemyAttackCue(priMock.ctx, priAudio.enemyAttackGain, priAudio.noiseBuffer, false, 'brute')
    const hH = triggerEnemyAttackCue(priMock.ctx, priAudio.enemyAttackGain, priAudio.noiseBuffer, true, 'brute')
    assert(
      fH.priority === ENEMY_AUDIO_PRIORITIES.footstep &&
        bH.priority === ENEMY_AUDIO_PRIORITIES.breath &&
        aInvH.priority === ENEMY_AUDIO_PRIORITIES.alert_investigate &&
        aChaH.priority === ENEMY_AUDIO_PRIORITIES.alert_chase &&
        vH.priority === ENEMY_AUDIO_PRIORITIES.vocal &&
        wH.priority === ENEMY_AUDIO_PRIORITIES.attack_windup &&
        hH.priority === ENEMY_AUDIO_PRIORITIES.attack_hit &&
        hH.priority > wH.priority &&
        wH.priority > vH.priority &&
        vH.priority > aChaH.priority &&
        aChaH.priority === aInvH.priority &&
        aInvH.priority > bH.priority &&
        bH.priority === fH.priority,
      'All enemy synthesis handles strictly enforce 6-tier priority ordering'
    )
    ;[fH, bH, aInvH, aChaH, vH, wH, hH].forEach((x) => x.stop({ immediate: true }))

    // Live update() distance eviction for VOCAL (cap = 1)
    const pPos = gridToWorld(1, 1, corridorMaze)
    const farEnemy = new EnemyAgent('far-vocal', {
      maze: corridorMaze,
      type: ENEMY_TYPES.STALKER,
      spawnCell: { row: 1, col: 5 },
    })
    farEnemy.state = ENEMY_STATES.CHASE
    farEnemy.worldPos.x = pPos.x + 14
    farEnemy.worldPos.z = pPos.z

    const nearEnemy = new EnemyAgent('near-vocal', {
      maze: corridorMaze,
      type: ENEMY_TYPES.BRUTE,
      spawnCell: { row: 1, col: 1 },
    })
    nearEnemy.state = ENEMY_STATES.PATROL
    nearEnemy.worldPos.x = pPos.x + 1.5
    nearEnemy.worldPos.z = pPos.z

    priAudio._ambientRng = () => 0.001
    priAudio.update(0.05, { playerWorldPos: pPos, enemies: [farEnemy, nearEnemy] })
    assert(
      Array.from(priAudio._activeEnemyCues).some(
        (e) => e.enemyId === 'far-vocal' && e.category === ENEMY_AUDIO_CATEGORIES.VOCAL
      ),
      'Distant enemy occupies the 1 vocal slot when alone in vocal state'
    )

    // Next frame: closer enemy enters CHASE and must evict the distant vocal despite maxConcurrentVocals=1
    nearEnemy.state = ENEMY_STATES.CHASE
    priMock.ctx.currentTime += 0.05
    priAudio.update(0.05, { playerWorldPos: pPos, enemies: [farEnemy, nearEnemy] })
    const activeVocals = Array.from(priAudio._activeEnemyCues).filter(
      (e) => e.category === ENEMY_AUDIO_CATEGORIES.VOCAL
    )
    assert(
      activeVocals.length === 1 && activeVocals[0].enemyId === 'near-vocal',
      'Closer enemy vocal evicts distant vocal across live update() without pre-dispatch block'
    )
    farEnemy.dispose()
    nearEnemy.dispose()
    priAudio.dispose()
  }

  // 17d. Enemy vocal/breath positional wet reverb routes through enemyVocalGain for ducking
  {
    const revMock = createMockAudioContext()
    const revConnections = []
    const origGainFn = revMock.ctx.createGain.bind(revMock.ctx)
    revMock.ctx.createGain = () => {
      const g = origGainFn()
      const origConn = g.connect.bind(g)
      g.connect = (dest) => {
        revConnections.push({ from: g, to: dest })
        return origConn(dest)
      }
      return g
    }

    const revAudio = new HorrorAudioEngine({
      createAudioContext: () => revMock.ctx,
      autoUnlock: true,
      thunderEnabled: false,
      rainEnabled: false,
    })
    assert(
      revConnections.some(
        (c) => c.from === revAudio._enemyVocalReverbWetGain && c.to === revAudio.enemyVocalGain
      ) &&
        !revConnections.some(
          (c) => c.from === revAudio._enemyVocalReverbWetGain && c.to === revAudio.effectsGain
        ),
      'Enemy vocal/breath wet reverb bus routes exclusively into enemyVocalGain (never bypassing ducking)'
    )
    const spatialPos = { x: 4, y: 1.65, z: 4 }
    revAudio.updateListener({ x: 4, y: 1.65, z: 5 })
    const destObj = revAudio._createPositionalDestination(spatialPos, {
      targetBus: revAudio.enemyVocalGain,
      sendToReverb: true,
    })
    assert(
      revConnections.some(
        (c) => c.to === revAudio._enemyVocalReverbInput
      ) &&
        !revConnections.some(
          (c) => c.from === destObj.dest && c.to === revAudio._reverbInput
        ),
      'Positional enemy vocal/breath send connects wet branch to _enemyVocalReverbInput'
    )
    destObj.cleanup()
    revAudio.onPlayerDamage({ damage: 25, healthDelta: 25 })
    assert(
      Math.abs(revAudio.enemyVocalGain.gain.value - 0.55) < 1e-4,
      'Player damage ducks enemyVocalGain (shared parent of both dry and wet vocal/breath paths) to 0.55'
    )
    revAudio.dispose()
  }

  // 17e. onExitVictory(), combined_combat_mix isolation, timer cancellation, and stopAudition()
  {
    const lifeMock = createMockAudioContext()
    const lifeAudio = new HorrorAudioEngine({
      createAudioContext: () => lifeMock.ctx,
      autoUnlock: true,
      thunderEnabled: false,
      rainEnabled: false,
    })

    // 1. onExitVictory clears player breath, strained timer, and auditions
    lifeAudio.triggerPlayerBreath({ mode: 'exhausted' })
    lifeAudio._playerStrainedBreathingRemainingSec = 3.5
    lifeAudio._playerBreathTimer = 2.0
    lifeAudio.auditionCue('combined_combat_mix')
    assert(
      lifeAudio._auditionMixTimers.length === 3,
      'combined_combat_mix schedules its 3 delayed combat sequence timers'
    )
    lifeAudio.onExitVictory()
    assert(
      lifeAudio.getAudioState().activePlayerBreathCount === 0 &&
        lifeAudio._playerStrainedBreathingRemainingSec === 0 &&
        lifeAudio._playerBreathTimer === 0 &&
        lifeAudio._auditionMixTimers.length === 0 &&
        lifeAudio.getAudioState().activeEnemyCueCount === 0,
      'onExitVictory() stops breathing & active auditions and resets breath timers'
    )

    // 2. Audition isolation: combined_combat_mix never mutates _playerStrainedBreathingRemainingSec
    lifeAudio._hasWon = false
    const cancelledMix = lifeAudio.auditionCue('combined_combat_mix')
    assert(cancelledMix?.played === true, 'combined_combat_mix starts cleanly')
    assert(lifeAudio.stopAudition({ immediate: true }) === true, 'stopAudition stops mix immediately')
    assert(
      lifeAudio._auditionMixTimers.length === 0 &&
        lifeAudio._playerStrainedBreathingRemainingSec === 0,
      'stopAudition clears timers and leaves gameplay strained timer untouched'
    )

    // Wait 1.15s to confirm cancelled session timers do NOT fire late AND test full non-cancelled mix completion
    const completedAudio = new HorrorAudioEngine({
      createAudioContext: () => lifeMock.ctx,
      autoUnlock: true,
      thunderEnabled: false,
      rainEnabled: false,
    })
    completedAudio.auditionCue('combined_combat_mix')
    await new Promise((resolve) => setTimeout(resolve, 1150))
    assert(
      lifeAudio.getAudioState().activeEnemyCueCount === 0 &&
        lifeAudio.getAudioState().activeVocalCueCount === 0,
      'Cancelled combined_combat_mix session timers remain dead after 1150ms'
    )
    assert(
      completedAudio.getAudioState().combatDucked === true &&
        completedAudio._playerStrainedBreathingRemainingSec === 0,
      'Completed combined_combat_mix ducks combat buses on damage hit without mutating live strained breathing state'
    )
    // Simulate vocal handle completion restoring ducking
    completedAudio._activeVocalCue?.stop?.({ immediate: true })
    assert(
      completedAudio.getAudioState().combatDucked === false &&
        Math.abs(completedAudio.getAudioState().enemyAttackGain - 1.0) < 1e-4 &&
        Math.abs(completedAudio.getAudioState().enemyVocalGain - 1.0) < 1e-4,
      'combined_combat_mix damage vocal completion/stop cleanly restores ducked buses'
    )

    lifeAudio.dispose()
    completedAudio.dispose()
  }
}
console.log('✓ Phase 5C regression suite (breathing audibility, unified priorities, reverb ducking & lifecycle) verified')

console.log('--- ALL 3D HORROR AUDIO TESTS PASSED SUCCESSFULLY! ---')




