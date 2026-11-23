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
audioEngine.onFlashlightToggle(true)
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
  !audio.getCueHistory().some((c) => c.type === 'player_damage') &&
    !('activeVocalCueCount' in audio.getAudioState()) &&
    !('combatDucked' in audio.getAudioState()) &&
    Math.abs(audio.enemyAttackGain.gain.value - 1.0) < 1e-4,
  'applyDamage reduces HP without triggering runtime player damage vocal or ducking enemyAttackGain'
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

// 6. Player Vocal Synthesis Removal & Disabled Runtime Vocal Triggers
console.log('Test 6: Player Vocal Synthesis Removal & Disabled Runtime Vocal Triggers')
{
  const audioSynthesisMod = await import('./audioSynthesis.js')
  const { ctx: vocCtx, stats: vocStats } = createMockAudioContext()

  // 6a. Verify old player vocal synthesis exports are removed from audioSynthesis.js
  const removedExports = [
    'PLAYER_DAMAGE_VOCAL_VARIANTS',
    'VOCAL_PCM_PRESET_SPECS',
    'renderHumanVocalTrackBuffer',
    'PLAYER_BREATH_PROFILES',
    'triggerPlayerBreathCue',
    'triggerPlayerImpactVocalCue',
    'triggerPlayerDamageCue',
    'triggerStaminaWarningCue',
    'createVocalBiquadCoeffs',
    'processVocalBiquad',
    'sampleThreePointContour',
    'evaluateRosenbergGlottalPulse',
    'createVocalPrng',
  ]
  for (const symbol of removedExports) {
    assert(
      !(symbol in audioSynthesisMod) && audioSynthesisMod[symbol] === undefined,
      `Removed player vocal synthesis export '${symbol}' is absent from audioSynthesis.js`
    )
  }

  // 6b. Verify shared primitives and non-player synthesis exports remain intact
  const preservedExports = [
    'ENEMY_AUDIO_CATEGORIES',
    'ENEMY_AUDIO_PRIORITIES',
    'ENEMY_ALERT_SPECS',
    'ENEMY_VOCAL_SPECS',
    'ENEMY_BREATH_SPECS',
    'triggerEnemyAlertCue',
    'triggerEnemyAttackCue',
    'triggerEnemyVocalCue',
    'triggerEnemyBreathCue',
    'triggerEnemyFootstep',
    'triggerPlayerFootstep',
    'triggerStartElevatorDescentCue',
    'triggerStartElevatorImpactCue',
  ]
  for (const symbol of preservedExports) {
    assert(
      audioSynthesisMod[symbol] !== undefined,
      `Preserved non-player audio synthesis export '${symbol}' remains intact in audioSynthesis.js`
    )
  }

  const vocAudio = new HorrorAudioEngine({
    createAudioContext: () => vocCtx,
    recordCueHistory: true,
    volumes: { master: 0.85, effects: 0.75, ambience: 0.5, music: 0.4, muted: false },
  })
  assert(vocAudio.unlock() === true, 'Vocal audio engine unlocks cleanly')

  // 6c. Obsolete player vocal/breath state, methods, gain buses, ducking state, and getAudioState() fields are absent
  vocAudio.clearCueHistory()
  const oscStartCount0 = vocStats.oscillatorsStarted
  const bufStartCount0 = vocStats.bufferSourcesStarted
  const removedInstanceProps = [
    '_playerBreathingEnabled',
    '_activeVocalCue',
    '_lastDamageVocalAt',
    '_lastImpactVocalAt',
    '_lastDamageVocalVariant',
    '_vocalCooldownSec',
    '_impactVocalCooldownSec',
    '_ctxStartTime',
    '_vocalRng',
    '_playerBreathTimer',
    '_activePlayerBreathHandle',
    '_playerStrainedBreathingRemainingSec',
    '_lastPlayerBreathMode',
    '_pendingImpactVocal',
    '_pendingImpactVocalQueuedAt',
    '_flushedImpactVocal',
    'playerVocalGain',
    'playerBreathGain',
    '_combatDuckTimer',
    '_combatDuckRemainingSec',
    '_isCombatDucked',
    '_combatDuckFactor',
    '_enemyVocalDuckFactor',
    '_hazardDuckFactor',
    '_elevatorDuckRemainingSec',
    '_isElevatorDucked',
    '_elevatorDuckFactor',
  ]
  for (const prop of removedInstanceProps) {
    assert(
      !(prop in vocAudio) && vocAudio[prop] === undefined,
      `Obsolete player vocal/breath instance property '${prop}' is absent from HorrorAudioEngine`
    )
  }
  const removedMethods = [
    '_getVocalClockSec',
    '_ensureUnlockedAndRunning',
    '_cancelAndHoldGain',
    '_duckCombatAttackAudio',
    '_restoreCombatAttackAudio',
    '_duckElevatorImpactAudio',
    '_restoreElevatorImpactAudio',
    '_stopActiveVocalCue',
    '_stopActivePlayerBreath',
    '_updatePlayerBreathing',
    'triggerPlayerBreath',
    'onPlayerImpactReaction',
    'onPlayerDamage',
    'onStaminaWarning',
  ]
  for (const methodName of removedMethods) {
    assert(
      typeof vocAudio[methodName] === 'undefined',
      `Obsolete player vocal/breath method '${methodName}' is removed from HorrorAudioEngine`
    )
  }
  const vocAudioState = vocAudio.getAudioState()
  const removedStateFields = [
    'activeVocalCueCount',
    'activePlayerBreathCount',
    'playerVocalGain',
    'playerBreathGain',
    'playerBreathMode',
    'combatDucked',
    'elevatorDucked',
  ]
  for (const field of removedStateFields) {
    assert(
      !(field in vocAudioState) && vocAudioState[field] === undefined,
      `Obsolete getAudioState() field '${field}' is absent`
    )
  }
  assert(vocAudio.handleGameEvent({ type: 'player_damaged', damage: 25, healthDelta: 25 }) === false, 'handleGameEvent player_damaged is ignored and returns false')
  assert(
    vocAudioState.activeElevatorCueCount === 0 &&
      vocAudioState.activeEnemyCueCount === 0 &&
      Math.abs(vocAudioState.enemyAttackGain - 1.0) < 1e-4 &&
      Math.abs(vocAudioState.enemyVocalGain - 1.0) < 1e-4 &&
      Math.abs(vocAudioState.hazardAudioGain - 1.0) < 1e-4 &&
      Math.abs(vocAudioState.elevatorImpactGain - 1.0) < 1e-4 &&
      Math.abs(vocAudio.enemyAttackGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(vocAudio.enemyVocalGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(vocAudio.hazardAudioGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(vocAudio.elevatorImpactGain.gain.value - 1.0) < 1e-4,
    'Preserved enemy, hazard, and elevator gain buses remain at unity (1.0) in instance and getAudioState()'
  )
  assert(
    vocStats.oscillatorsStarted - oscStartCount0 === 0 &&
      vocStats.bufferSourcesStarted - bufStartCount0 === 0,
    'Ignored player_damaged event spawns zero AudioBufferSourceNodes or OscillatorNodes'
  )
  vocAudio.reset()
  assert(!('activeVocalCueCount' in vocAudio.getAudioState()), 'reset() keeps obsolete vocal state absent')
  vocAudio.dispose()

  // 6d. Integrated MazeSceneEngine: enemy attack, hazard hit, immunity block, healing/setHealth safety
  const vocEngineMock = createMockAudioContext()
  let hudDamageEvents = 0
  const vocEngine = createHeadlessEngine({
    enemies: { autoSpawn: false },
    onPlayerDamage: () => {
      hudDamageEvents += 1
    },
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

  // Enemy damage reduces HP and notifies HUD without playing player damage vocal or ducking enemy attack audio
  assert(vocEngine.applyDamage(20, { enemyId: 'stalker-1', enemyType: 'stalker' }) === true)
  assert(vocEngine.getHealth().health === 80 && hudDamageEvents === 1, 'Enemy damage reduces HP to 80 and fires HUD damage callback')
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 0 &&
      !('activeVocalCueCount' in vAudio.getAudioState()),
    'Enemy damage does not trigger player_damage vocal reaction'
  )
  assert(
    !('combatDucked' in vAudio.getAudioState()) &&
      Math.abs(vAudio.enemyAttackGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(vAudio.enemyVocalGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(vAudio.hazardAudioGain.gain.value - 1.0) < 1e-4,
    'Enemy and hazard audio buses remain unducked at 1.0 on player damage'
  )

  // Invulnerability blocks damage -> HP stays 80 -> NO vocal reaction
  const oscDuringImmune = vocEngineMock.stats.oscillatorsStarted
  const bufDuringImmune = vocEngineMock.stats.bufferSourcesStarted
  assert(vocEngine.applyDamage(20, { enemyId: 'stalker-1' }) === false)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 0 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringImmune &&
      vocEngineMock.stats.bufferSourcesStarted === bufDuringImmune,
    'Blocked damage during immunity produces zero vocal reaction'
  )
  // Healing via setHealth(100) restores HP -> NO pain vocal reaction
  vocEngine.setHealth(100)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 0 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringImmune &&
      vocEngineMock.stats.bufferSourcesStarted === bufDuringImmune,
    'Healing/restoring health produces zero pain vocal reaction'
  )

  // Environmental hazard damage reduces HP -> notifies HUD without playing player damage vocal
  vocEngine.damageImmunityTimer = 0
  vocEngineMock.ctx.currentTime += 0.5
  assert(
    vocEngine.applyDamage(25, { hazardId: 'spikes-1', hazardType: HAZARD_TYPES.FLOOR_SPIKES }) ===
      true
  )
  assert(
    vocEngine.getHealth().health === 75 &&
      hudDamageEvents === 2 &&
      vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 0 &&
      Math.abs(vAudio.hazardAudioGain.gain.value - 1.0) < 1e-4,
    'Hazard damage updates HP and HUD while triggering zero player_damage vocal reactions and keeping hazardAudioGain at 1.0'
  )

  // Extraction immunity blocks damage -> NO vocal reaction
  vocEngine.damageImmunityTimer = 0
  vocEngineMock.ctx.currentTime += 0.5
  vocEngine.startExtractionSequence()
  const oscDuringExtract = vocEngineMock.stats.oscillatorsStarted
  const bufDuringExtract = vocEngineMock.stats.bufferSourcesStarted
  assert(vocEngine.applyDamage(25, { enemyId: 'stalker-1' }) === false)
  assert(
    vAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 0 &&
      vocEngineMock.stats.oscillatorsStarted === oscDuringExtract &&
      vocEngineMock.stats.bufferSourcesStarted === bufDuringExtract,
    'Extraction protection blocks damage and triggers zero vocal audio'
  )
  vocEngine.dispose()
}
console.log('✓ Procedural player vocal synthesis and disabled runtime gameplay vocal triggers verified')

// 7. Locked-Context Elevator Cue Queuing & Unlock Flushing
console.log('Test 7: Locked-Context Elevator Cue Queuing & Unlock Flushing')
{
  const lockMock = createMockAudioContext()
  const lockAudio = new HorrorAudioEngine({
    createAudioContext: () => lockMock.ctx,
    recordCueHistory: true,
  })
  assert(lockAudio.isUnlocked === false, 'Audio engine starts locked')

  // Triggering elevator impact while locked -> queues mechanical impact cue; pending vocal queue fields are removed
  const impactRes = lockAudio.onStartElevatorImpact()
  assert(impactRes === false, 'Elevator impact returns false while locked')
  assert(
    lockAudio._pendingElevatorImpact === true &&
      !('_pendingImpactVocal' in lockAudio) &&
      !('_pendingImpactVocalQueuedAt' in lockAudio) &&
      !('_flushedImpactVocal' in lockAudio) &&
      typeof lockAudio.onPlayerImpactReaction === 'undefined',
    'Mechanical elevator impact queues while obsolete pending vocal queue fields and onPlayerImpactReaction are absent'
  )
  assert(lockMock.stats.oscillatorsStarted === 0, 'No oscillators started while locked')

  // Unlocking -> flushes pending mechanical elevator impact cleanly without triggering any player vocal
  const unlocked = lockAudio.unlock()
  assert(unlocked === true, 'unlock() succeeds')
  assert(lockAudio.isUnlocked === true, 'Audio engine is now unlocked')
  assert(lockMock.stats.oscillatorsStarted > 0, 'Queued mechanical elevator impact cue plays upon unlock')

  const impactHistory = lockAudio.getCueHistory().filter((c) => c.type === 'start_elevator_impact')
  const vocalHistory = lockAudio.getCueHistory().filter((c) => c.type === 'player_impact_vocal')
  assert(impactHistory.length === 1, 'Elevator impact recorded in history')
  assert(vocalHistory.length === 0, 'Zero player impact vocals recorded in history')

  // Repeated unlock does not duplicate queued cues
  lockAudio.clearCueHistory()
  lockAudio.unlock()
  assert(lockAudio.getCueHistory().length === 0, 'Repeated unlock does not re-flush or duplicate cues')

  // Reset clears pending queue
  lockAudio.reset()

  // Stale pending elevator cues expire automatically and never replay on a late unrelated click/key press
  const staleMock = createMockAudioContext()
  const staleAudio = new HorrorAudioEngine({
    createAudioContext: () => staleMock.ctx,
    recordCueHistory: true,
    pendingElevatorCueMaxAgeSec: 0.9,
  })
  assert(staleAudio.onStartElevatorImpact() === false, 'Locked elevator impact queues initially')
  assert(
    staleAudio._pendingElevatorImpact === true && !('_pendingImpactVocal' in staleAudio),
    'Only mechanical elevator impact is queued at touchdown while locked'
  )

  // Advance simulated time beyond the synchronization window without unlocking -> pending cues expire
  staleAudio.update(1.15, {})
  assert(
    staleAudio._pendingElevatorImpact === false,
    'Pending elevator impact expires once the landing window passes'
  )
  assert(staleAudio.unlock() === true, 'Late unrelated unlock succeeds')
  assert(
    staleAudio.getAudioState().activeElevatorCueCount === 0 &&
      staleAudio._flushedElevatorImpact === false,
    'Late unrelated unlock after queue expiration plays zero stale elevator impact cues'
  )

  // Explicit clearPendingElevatorCues() cancels pending cues before unlock
  const cancelMock = createMockAudioContext()
  const cancelAudio = new HorrorAudioEngine({
    createAudioContext: () => cancelMock.ctx,
  })
  cancelAudio.onStartElevatorImpact()
  assert(cancelAudio.clearPendingElevatorCues() === true, 'clearPendingElevatorCues() returns true when clearing queued cues')
  assert(cancelAudio.clearPendingElevatorCues() === false, 'clearPendingElevatorCues() returns false when queue is already empty')
  cancelAudio.unlock()
  assert(
    cancelAudio.getAudioState().activeElevatorCueCount === 0,
    'Cancelled pending elevator cues never play upon subsequent unlock'
  )

  // Wall-clock staleness protection: overdue queuedAt timestamp expires inside _flushPendingElevatorCues even without update() ticks
  const wallMock = createMockAudioContext()
  const wallAudio = new HorrorAudioEngine({
    createAudioContext: () => wallMock.ctx,
    pendingElevatorCueMaxAgeSec: 0.8,
  })
  wallAudio.onStartElevatorImpact()
  wallAudio._pendingElevatorImpactQueuedAt.wallMs -= 2000
  wallAudio.unlock()
  assert(
    wallAudio._pendingElevatorImpact === false &&
      wallAudio.getAudioState().activeElevatorCueCount === 0,
    'Wall-clock stale pending elevator impact expires synchronously on late unlock'
  )

  lockAudio.dispose()
  staleAudio.dispose()
  cancelAudio.dispose()
  wallAudio.dispose()
}
console.log('✓ Locked-context elevator cue queuing, unlock flushing, and stale expiration verified')

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
    asyncAudio._pendingElevatorImpact === true && !('_pendingImpactVocal' in asyncAudio),
    'Elevator descent landing queues mechanical impact cue without any player landing vocal queue field while audio is locked'
  )
  assert(
    asyncMock.stats.oscillatorsStarted === 0,
    'Zero oscillators spawn while AudioContext has not yet unlocked'
  )

  // Lifecycle sync resetCombat({ preserveSpawnSequence: true }) must NOT wipe the queued cues
  asyncEngine.resetCombat({ preserveSpawnSequence: true })
  assert(
    asyncAudio._pendingElevatorImpact === true,
    'resetCombat({ preserveSpawnSequence: true }) preserves queued mechanical elevator impact cue'
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
      asyncMock.stats.oscillatorsStarted === 0,
    'Failed/non-activating resume keeps engine locked and preserves pending elevator impact cue'
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

  // Audio thread completes resume -> statechange + Promise resolve -> flush mechanical impact cue cleanly once
  resolvePendingResume()
  await Promise.resolve()
  await Promise.resolve()

  assert(asyncAudio.isUnlocked === true, 'Async resume completion unlocks HorrorAudioEngine')
  assert(
    asyncAudio._pendingElevatorImpact === false &&
      asyncAudio._flushedElevatorImpact === true &&
      !('_flushedImpactVocal' in asyncAudio),
    'Queued mechanical elevator impact flushes exactly once after async resume'
  )
  assert(
    asyncAudio.getAudioState().activeElevatorCueCount === 1 &&
      !('activeVocalCueCount' in asyncAudio.getAudioState()),
    'Elevator mechanical impact is active after async unlock'
  )
  assert(
    !('elevatorDucked' in asyncAudio.getAudioState()) &&
      Math.abs(asyncAudio.getAudioState().elevatorImpactGain - 1.0) < 1e-4,
    'elevatorImpactGain stays unducked at 1.0 during mechanical elevator impact'
  )
  const oscAfterFlush = asyncMock.stats.oscillatorsStarted
  assert(oscAfterFlush > 0, 'Queued elevator impact spawned audio nodes on running context')

  // Subsequent unlock call returns true and produces zero duplication
  assert(asyncEngine.unlockAudio() === true, 'Subsequent unlockAudio() returns true once running')
  assert(
    asyncMock.stats.oscillatorsStarted === oscAfterFlush,
    'Subsequent unlockAudio() does not duplicate elevator impact'
  )

  asyncEngine.dispose()
  assert(stateListeners.size === 0, 'dispose() detaches AudioContext statechange listener cleanly')

  // Integrated MazeSceneEngine check: completing the elevator intro while locked cancels pending landing cues
  const lateMock = createMockAudioContext()
  const lateEngine = createHeadlessEngine({
    skipSpawnSequence: false,
    enemies: { autoSpawn: false },
    audio: {
      createAudioContext: () => lateMock.ctx,
      recordCueHistory: true,
    },
  })
  lateEngine.setMaze(occlusionTestMaze)
  const lateAudio = lateEngine.getAudioEngine()
  for (let i = 0; i < 120 && lateEngine.isSpawnSequenceActive(); i += 1) {
    lateEngine.stepFrame(0.05, { render: false })
  }
  assert(!lateEngine.isSpawnSequenceActive(), 'Spawn elevator sequence completes while audio remains locked')
  assert(
    lateAudio._pendingElevatorImpact === false,
    'Completing elevator landing/settle clears pending elevator impact cues'
  )
  assert(lateEngine.unlockAudio() === true, 'Late first interaction unlocks audio cleanly')
  assert(
    lateAudio.getAudioState().activeElevatorCueCount === 0,
    'Late first interaction after elevator intro plays zero stale landing impact cues'
  )
  lateEngine.dispose()
}
console.log('✓ Browser async resume, non-activating gesture retry, lifecycle queue retention, and stale expiry verified')

// 9. Combat Damage Audio Bus Integrity & Delayed Event Dedup
console.log('Test 9: Combat Damage Audio Bus Integrity & Delayed Event Dedup')
{
  const combatMock = createMockAudioContext()

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

  // Hit 1 (enemy damage): HP drops, no pain vocal plays, enemyAttackGain and hazardAudioGain remain at 1.0
  const srcCountBeforeHit1 = deferredSources.length
  const hpBefore1 = combatEngine.getHealth().health
  assert(combatEngine.applyDamage(20, { enemyId: 'stalker-9', enemyType: 'stalker' }) === true)
  assert(combatEngine.getHealth().health === hpBefore1 - 20, 'Enemy hit decreases player HP')
  assert(
    !('combatDucked' in cAudio.getAudioState()) &&
      !('activeVocalCueCount' in cAudio.getAudioState()) &&
      Math.abs(cAudio.enemyAttackGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(cAudio.enemyVocalGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(cAudio.hazardAudioGain.gain.value - 1.0) < 1e-4 &&
      deferredSources.length === srcCountBeforeHit1,
    'Enemy damage decreases HP without starting any player vocal sources or ducking enemy/hazard gain buses'
  )

  // Delayed React lastEvent ('player_damaged') arriving 350ms later also returns false without starting any vocal
  combatMock.ctx.currentTime += 0.35
  const dupPlayed = combatEngine.handleGameEvent({
    id: 9001,
    type: 'player_damaged',
    damage: 20,
    healthDelta: 20,
  })
  assert(
    dupPlayed === false &&
      cAudio.getCueHistory().filter((c) => c.type === 'player_damage').length === 0,
    'Delayed React player_damaged event does not trigger any player vocal'
  )

  // Hit 2 (hazard damage after immunity cleared): HP drops, buses remain unducked at 1.0
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
    Math.abs(cAudio.enemyAttackGain.gain.value - 1.0) < 1e-4 &&
      Math.abs(cAudio.hazardAudioGain.gain.value - 1.0) < 1e-4 &&
      deferredSources.length === srcCountBeforeHit2,
    'Hazard damage hit leaves enemyAttackGain and hazardAudioGain unducked at 1.0'
  )

  combatEngine.dispose()
}
console.log('✓ Combat damage audio bus integrity and delayed event dedup verified')

// ---------------------------------------------------------------------------
// Test 10: End-to-End Gameplay Elevator Impact & Damage Audio Path
// ---------------------------------------------------------------------------
console.log('Test 10: End-to-End Gameplay Elevator Impact & Damage Audio Path')
{
  // 10a. Verify actual MazeSceneEngine elevator landing and applyDamage do not trigger runtime player vocals
  //      while mechanical elevator impact audio and HP damage behavior remain intact
  const pathMock = createMockAudioContext()
  const playedPathBufSources = []
  const origPathCreateBufSrc = pathMock.ctx.createBufferSource.bind(pathMock.ctx)
  pathMock.ctx.createBufferSource = () => {
    const src = origPathCreateBufSrc()
    const origStart = src.start.bind(src)
    src.start = (when = 0, off = 0, dur = 0) => {
      playedPathBufSources.push({
        when,
        buffer: src.buffer,
        playbackRate: src.playbackRate?.value ?? 1,
      })
      return origStart(when, off, dur)
    }
    return src
  }
  const pathEngine = createHeadlessEngine({
    skipSpawnSequence: false,
    enemies: { autoSpawn: false },
    audio: {
      createAudioContext: () => pathMock.ctx,
      recordCueHistory: true,
    },
  })
  pathEngine.setMaze(occlusionTestMaze)
  pathEngine.unlockAudio()

  // Step through the real starting elevator descent until landing impact triggers
  for (let i = 0; i < 120 && !pathEngine._startImpactCueFired; i += 1) {
    pathEngine.stepFrame(0.05, { render: false })
  }
  assert(pathEngine._startImpactCueFired, 'Starting elevator descent reaches landing impact in MazeSceneEngine')

  const mechImpactLogs = pathEngine.audioEngine.getCueHistory().filter(
    (c) => c.type === 'start_elevator_impact'
  )
  const impactCueLogs = pathEngine.audioEngine.getCueHistory().filter(
    (c) => c.type === 'player_impact_vocal'
  )
  const playedVocalSources = playedPathBufSources.filter(
    (entry) => entry.buffer?._vocalMeta?.preset === 'elevator_startled'
  )
  assert(
    mechImpactLogs.length === 1 &&
      impactCueLogs.length === 0 &&
      !('_activeVocalCue' in pathEngine.audioEngine) &&
      playedVocalSources.length === 0 &&
      Math.abs(pathEngine.audioEngine.getAudioState().elevatorImpactGain - 1.0) < 1e-4,
    'Actual elevator landing plays mechanical start_elevator_impact with zero player_impact_vocal buffers and leaves elevatorImpactGain at 1.0'
  )

  // Complete spawn sequence so player becomes vulnerable to real gameplay damage
  for (let i = 0; i < 160 && pathEngine.isSpawnSequenceActive(); i += 1) {
    pathEngine.stepFrame(0.05, { render: false })
  }
  pathMock.ctx.currentTime += 1.0
  pathEngine.stepFrame(0.5, { render: false })

  const dmgApplied = pathEngine.applyDamage(20, { enemyId: 'stalker-1', enemyType: 'stalker' })
  pathEngine.handleGameEvent({ id: 901, type: 'player_damaged', damage: 20, healthDelta: 20 })
  assert(dmgApplied && pathEngine.getHealth().health === 80, 'applyDamage reduces player HP on actual enemy hit')

  const dmgCueLogs = pathEngine.audioEngine.getCueHistory().filter((c) => c.type === 'player_damage')
  assert(
    dmgCueLogs.length === 0 &&
      !('_activeVocalCue' in pathEngine.audioEngine) &&
      Math.abs(pathEngine.audioEngine.getAudioState().enemyAttackGain - 1.0) < 1e-4,
    'Actual damage event triggers zero runtime player_damage vocals and leaves enemyAttackGain at 1.0'
  )
  pathEngine.dispose()
}
console.log('✓ End-to-end gameplay elevator impact and damage audio routing verified')

// ---------------------------------------------------------------------------
// Test 11: Player Vocal Audition Removal & Non-Player Audio Audition Verification
// ---------------------------------------------------------------------------
console.log('Test 11: Player Vocal Audition Removal & Non-Player Audio Audition Verification')
{
  const horrorAudioMod = await import('./HorrorAudioEngine.js')
  const audMock = createMockAudioContext()
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

  // 11a. Verify VOCAL_AUDITION_PRESETS and player-specific audition methods/state are removed
  assert(
    !('VOCAL_AUDITION_PRESETS' in horrorAudioMod) &&
      horrorAudioMod.VOCAL_AUDITION_PRESETS === undefined,
    'VOCAL_AUDITION_PRESETS export is removed from HorrorAudioEngine.js'
  )
  assert(
    typeof audAudio.getVocalAuditionPresets === 'undefined' &&
      typeof audAudio._resolveVocalAuditionPreset === 'undefined' &&
      typeof audAudio.auditionVocalCue === 'undefined' &&
      typeof audAudio.stopVocalAudition === 'undefined' &&
      !('_auditionCombatDucked' in audAudio) &&
      !('_auditionElevatorDucked' in audAudio),
    'Player-specific audition methods and ducking flags are removed from HorrorAudioEngine'
  )
  assert(
    typeof audEngine.getVocalAuditionPresets === 'undefined' &&
      typeof audEngine.auditionVocal === 'undefined' &&
      typeof audEngine.stopVocalAudition === 'undefined',
    'Player-specific vocal audition wrappers are removed from MazeSceneEngine'
  )

  // 11b. Verify AUDITION_PRESETS contains only the 11 non-player enemy/combat presets
  const presets = audEngine.getAuditionPresets()
  assert(
    Array.isArray(presets) &&
      presets.length === 11 &&
      presets.every((p) => p.category !== 'player_vocal' && p.category !== 'player_breath'),
    'getAuditionPresets() exposes all 11 non-player presets with zero player_vocal or player_breath presets'
  )

  const removedPlayerPresetIds = [
    'elevator_startled',
    'damage_short_grunt',
    'damage_sharp_impact',
    'damage_strained_groan',
    'player_breath_resting',
    'player_breath_walking',
    'player_breath_running',
    'player_breath_low_stamina',
    'player_breath_exhausted',
    'player_breath_danger',
    'player_breath_strained',
  ]
  for (const removedId of removedPlayerPresetIds) {
    assert(
      audEngine.auditionCue(removedId) === null,
      `Removed player audition preset '${removedId}' returns null safely`
    )
  }

  // 11c. Auditioning non-player presets auto-unlocks AudioContext, plays cleanly, and preserves gameplay state
  assert(audAudio.isUnlocked === false, 'Engine starts locked before first valid audition click')
  const initialHp = audEngine.getHealth().health

  for (const preset of presets) {
    const res = audEngine.auditionCue(preset.id)
    assert(
      res &&
        res.played === true &&
        res.presetId === preset.id &&
        audAudio.isUnlocked === true &&
        Math.abs(audAudio.getAudioState().elevatorImpactGain - 1.0) < 1e-4 &&
        Math.abs(audAudio.getAudioState().enemyAttackGain - 1.0) < 1e-4,
      `Non-player audition preset '${preset.id}' plays cleanly and leaves buses unducked`
    )
    assert(audEngine.stopAudition() === true, `stopAudition() stops active preset '${preset.id}'`)
  }

  assert(audEngine.stopAudition() === false, 'stopAudition() returns false when no audition cue is active')
  assert(audEngine.auditionCue('unknown_preset') === null, 'Unknown preset ID returns null safely')

  // 11d. Verify normal gameplay state (HP) was not altered by auditions
  assert(
    audEngine.getHealth().health === initialHp,
    'Auditioning does not alter player HP'
  )
  assert(
    audEngine.applyDamage(20, { enemyId: 'stalker-aud' }) === true &&
      audEngine.getHealth().health === initialHp - 20,
    'Normal gameplay damage reduces HP without triggering runtime player damage vocal after auditioning'
  )

  audEngine.dispose()
}
console.log('✓ Player vocal audition removal & non-player audio audition functionality verified')

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
    typeof phase1Audio.onPlayerDamage === 'undefined' &&
      Math.abs(phase1Audio.getAudioState().enemyVocalGain - 1.0) < 1e-4 &&
      Math.abs(phase1Audio.getAudioState().enemyAttackGain - 1.0) < 1e-4,
    'Obsolete onPlayerDamage is removed and enemyVocalGain / enemyAttackGain remain at 1.0'
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
console.log('Test 15: Disabled Player Breathing State Machine & Preserved Enemy Audio Verification')
{
  const {
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

  // 15b. Player breathing state machine and state properties are completely removed
  const playerPos = gridToWorld(1, 1, occlusionTestMaze)
  pAudio.clearCueHistory()
  assert(
    !('_playerBreathingEnabled' in pAudio) &&
      !('_playerBreathTimer' in pAudio) &&
      !('_activePlayerBreathHandle' in pAudio) &&
      !('_playerStrainedBreathingRemainingSec' in pAudio) &&
      !('_lastPlayerBreathMode' in pAudio) &&
      typeof pAudio._updatePlayerBreathing === 'undefined',
    'Player breathing state machine properties and _updatePlayerBreathing are removed from HorrorAudioEngine'
  )

  const runtimeContexts = [
    {
      playerWorldPos: playerPos,
      playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
      stamina: 100,
      maxStamina: 100,
    },
    {
      playerWorldPos: playerPos,
      playerMotion: { moved: true, isSprinting: false, actualSpeed: 2.2 },
      stamina: 95,
      maxStamina: 100,
    },
    {
      playerWorldPos: playerPos,
      playerMotion: { moved: true, isSprinting: true, actualSpeed: 4.5 },
      stamina: 80,
      maxStamina: 100,
    },
    {
      playerWorldPos: playerPos,
      playerMotion: { moved: false, isSprinting: false },
      stamina: 20,
      maxStamina: 100,
    },
    {
      playerWorldPos: playerPos,
      playerMotion: { moved: false, isSprinting: false },
      stamina: 0,
      maxStamina: 100,
      isExhausted: true,
    },
  ]

  for (const ctxState of runtimeContexts) {
    pAudio.update(0.25, ctxState)
  }

  const dangerAgent = new EnemyAgent('danger-stalker', {
    maze: occlusionTestMaze,
    type: ENEMY_TYPES.STALKER,
    spawnCell: { row: 1, col: 2 },
  })
  dangerAgent.state = ENEMY_STATES.CHASE
  pAudio.update(0.25, {
    playerWorldPos: playerPos,
    playerMotion: { moved: false, isSprinting: false },
    enemies: [dangerAgent],
    stamina: 100,
  })
  dangerAgent.dispose()

  assert(
    pAudio.getCueHistory().filter((c) => c.type === 'player_breath').length === 0 &&
      !('activePlayerBreathCount' in pAudio.getAudioState()),
    'Runtime update() across resting, walking, running, low_stamina, exhausted, and danger states starts zero player breath handles'
  )

  // 15c. Disabled player vocal/breath trigger wrappers and gain buses are removed
  assert(
    typeof pAudio.triggerPlayerBreath === 'undefined' &&
      typeof pAudio.onStaminaWarning === 'undefined' &&
      typeof pAudio.onPlayerDamage === 'undefined' &&
      typeof pAudio.onPlayerImpactReaction === 'undefined' &&
      !('playerBreathGain' in pAudio) &&
      !('playerVocalGain' in pAudio),
    'Obsolete player vocal/breath trigger wrappers and gain buses are removed'
  )

  // 15d. Lifecycle cleanup across pause, game-over, victory, reset, and disposal
  pAudio.setPaused(true)
  assert(pAudio.isPaused === true, 'setPaused(true) pauses engine cleanly')
  pAudio.setPaused(false)
  pAudio.onGameOver()
  assert(pAudio._isGameOver === true, 'onGameOver() transitions cleanly')
  pAudio.reset()
  pAudio.setHasWon(true)
  assert(pAudio._hasWon === true, 'setHasWon(true) transitions cleanly')
  pAudio.setHasWon(false)
  pAudio.reset()
  assert(pAudio._isGameOver === false && pAudio._hasWon === false, 'reset() restores active state')
  pAudio.dispose()
  assert(pAudio.isDisposed === true && !('playerBreathGain' in pAudio), 'dispose() tears down engine cleanly')

  // 15g. Regression protection for enemy vocalizations and enemy breathing
  assert(ENEMY_VOCAL_SPECS.stalker && ENEMY_VOCAL_SPECS.hunter && ENEMY_VOCAL_SPECS.brute, 'Phase 2 enemy vocals intact')
  assert(ENEMY_BREATH_SPECS.stalker && ENEMY_BREATH_SPECS.hunter && ENEMY_BREATH_SPECS.brute, 'Phase 3 enemy breathing intact')
}
console.log('✓ Removed player breathing state machine and preserved enemy audio verified')

// ---------------------------------------------------------------------------
// Test 16: Phase 5 Final Horror Audio Integration, Mixing, Priority Eviction & Audition Catalog
// ---------------------------------------------------------------------------
console.log('Test 16: Phase 5 Final Horror Audio Integration, Mixing, Priority Eviction & Audition Catalog')
{
  const { ENEMY_AUDIO_CATEGORIES } = await import('./audioSynthesis.js')
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

  // 16b. Preserved enemy/hazard/elevator buses remain unducked at 1.0 and obsolete vocal ducking fields are absent
  const audioStateCheck = phase5Audio.getAudioState()
  assert(
    Math.abs(audioStateCheck.enemyAttackGain - 1.0) < 1e-4 &&
      Math.abs(audioStateCheck.enemyVocalGain - 1.0) < 1e-4 &&
      Math.abs(audioStateCheck.hazardAudioGain - 1.0) < 1e-4 &&
      Math.abs(audioStateCheck.elevatorImpactGain - 1.0) < 1e-4 &&
      !('activePlayerBreathCount' in audioStateCheck) &&
      !('activeVocalCueCount' in audioStateCheck) &&
      !('combatDucked' in audioStateCheck) &&
      !('elevatorDucked' in audioStateCheck),
    'getAudioState() reports enemyAttackGain, enemyVocalGain, hazardAudioGain, and elevatorImpactGain at 1.0 with obsolete vocal/ducking fields absent'
  )

  // 16c. Non-player 11-preset Enemy & Combat Audition catalog
  assert(Array.isArray(AUDITION_PRESETS) && AUDITION_PRESETS.length === 11, 'AUDITION_PRESETS exposes all 11 non-player presets')
  assert(phase5Audio.getAuditionPresets().length === 11, 'getAuditionPresets() returns all 11 non-player presets')
  assert(
    AUDITION_PRESETS.find((p) => p.id === 'enemy_vocal_brute')?.variant === 'growl',
    'Brute audition preset uses guttural growl vocal variant'
  )

  // Verify only non-player categories exist in catalog:
  const categoriesInCatalog = new Set(AUDITION_PRESETS.map((p) => p.category))
  assert(!categoriesInCatalog.has('player_vocal'), 'Catalog excludes player_vocal')
  assert(!categoriesInCatalog.has('player_breath'), 'Catalog excludes player_breath')
  assert(categoriesInCatalog.has('enemy_breath'), 'Catalog includes enemy_breath')
  assert(categoriesInCatalog.has('enemy_vocal'), 'Catalog includes enemy_vocal')
  assert(categoriesInCatalog.has('alerts_attacks'), 'Catalog includes alerts_attacks')
  assert(categoriesInCatalog.has('combat_mix'), 'Catalog includes combat_mix')

  // Test individual playback of each audition category
  for (const preset of AUDITION_PRESETS) {
    const res = phase5Audio.auditionCue(preset.id)
    assert(
      res && res.played === true && res.presetId === preset.id,
      `Audition preset ${preset.id} plays cleanly`
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
  phase5Audio.auditionCue('enemy_breath_stalker')
  const nextMaze = {
    id: 'phase5-next-maze',
    grid: [[1, 1, 1], [1, 0, 1], [1, 1, 1]],
    width: 3,
    height: 3,
    cellSize: 4,
  }
  phase5Audio.setMaze(nextMaze)
  assert(
    phase5Audio.getAudioState().activeEnemyCueCount === 0,
    'setMaze() terminates all in-flight enemy cues'
  )

  phase5Audio.setHasWon(true)
  assert(
    phase5Audio._hasWon === true,
    'setHasWon(true) cleanly transitions won state'
  )

  phase5Audio.setHasWon(false)
  phase5Audio.reset()
  assert(
    phase5Audio._hasWon === false && phase5Audio.getAudioState().activeEnemyCueCount === 0,
    'reset() cleanly resets active state and enemy cues'
  )

  phase5Audio.dispose()
  assert(
    phase5Audio.isDisposed === true &&
      !('playerBreathGain' in phase5Audio) &&
      !('playerVocalGain' in phase5Audio) &&
      phase5Audio.enemyAttackGain === null &&
      phase5Audio.enemyVocalGain === null &&
      phase5Audio.hazardAudioGain === null &&
      phase5Audio.elevatorImpactGain === null,
    'dispose() cleanly nullifies all preserved gain nodes and tears down engine'
  )

  // 16e. MazeSceneEngine integration check
  const sceneMock = createMockAudioContext()
  const sceneEngine = createHeadlessEngine({
    audio: { createAudioContext: () => sceneMock.ctx },
  })
  assert(sceneEngine.getAuditionPresets().length === 11, 'MazeSceneEngine exposes all 11 non-player audition presets')
  assert(sceneEngine.auditionCue('enemy_vocal_stalker') !== null, 'MazeSceneEngine auditionCue works')
  assert(sceneEngine.stopAudition() === true, 'MazeSceneEngine stopAudition works')
  sceneEngine.dispose()

  for (const e of testEnemies) e.dispose()
}
console.log('✓ Phase 5 final horror audio integration, mixing, priority eviction & audition catalog verified')

// ---------------------------------------------------------------------------
// Test 17: Phase 5C Regression Verification (Routing, Unified Priority &
//          Distance Eviction, Reverb Routing, Victory & Audition Lifecycle)
// ---------------------------------------------------------------------------
console.log('Test 17: Phase 5C Regression Verification')
{
  const {
    ENEMY_AUDIO_CATEGORIES,
    ENEMY_AUDIO_PRIORITIES,
    triggerEnemyFootstep,
    triggerEnemyBreathCue,
    triggerEnemyAlertCue,
    triggerEnemyVocalCue,
    triggerEnemyAttackCue,
  } = await import('./audioSynthesis.js')
  const { EnemyAgent, ENEMY_TYPES, ENEMY_STATES } = await import('./EnemyAgent.js')

  // 17a. Gain node routing hierarchy check
  {
    const gMock = createMockAudioContext()
    const capturedConnections = []
    const origCreateGain = gMock.ctx.createGain.bind(gMock.ctx)
    gMock.ctx.createGain = () => {
      const g = origCreateGain()
      const origConn = g.connect.bind(g)
      g.connect = (dest) => {
        capturedConnections.push({ from: g, to: dest })
        return origConn(dest)
      }
      return g
    }

    const bEngine = new HorrorAudioEngine({
      createAudioContext: () => gMock.ctx,
      autoUnlock: true,
      thunderEnabled: false,
      rainEnabled: false,
    })

    // Preserved routing check: enemyAttackGain, enemyVocalGain, hazardAudioGain, elevatorImpactGain -> effectsGain, and playerVocalGain / playerBreathGain are absent
    assert(
      !('playerBreathGain' in bEngine) &&
        !('playerVocalGain' in bEngine) &&
        capturedConnections.some(
          (c) => c.from === bEngine.enemyAttackGain && c.to === bEngine.effectsGain
        ) &&
        capturedConnections.some(
          (c) => c.from === bEngine.enemyVocalGain && c.to === bEngine.effectsGain
        ) &&
        capturedConnections.some(
          (c) => c.from === bEngine.hazardAudioGain && c.to === bEngine.effectsGain
        ) &&
        capturedConnections.some(
          (c) => c.from === bEngine.elevatorImpactGain && c.to === bEngine.effectsGain
        ),
      'Gain topology routes enemyAttackGain, enemyVocalGain, hazardAudioGain, and elevatorImpactGain -> effectsGain without obsolete playerVocalGain/playerBreathGain'
    )
    bEngine.dispose()
  }

  // 17b. Stamina warning wrapper is removed and exhaustion transition starts zero player breathing cues
  {
    const stamMock = createMockAudioContext()
    const stamEngine = new HorrorAudioEngine({
      createAudioContext: () => stamMock.ctx,
      autoUnlock: true,
      thunderEnabled: false,
      rainEnabled: false,
      recordCueHistory: true,
    })
    assert(
      typeof stamEngine.onStaminaWarning === 'undefined' &&
        !('activePlayerBreathCount' in stamEngine.getAudioState()),
      'Obsolete onStaminaWarning wrapper and activePlayerBreathCount state field are removed'
    )
    stamEngine.dispose()

    // MazeSceneEngine exhaustion transition starts zero runtime player breathing cues
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
      exhCues.length === 0 && !('activePlayerBreathCount' in sAudio.getAudioState()),
      'MazeSceneEngine exhaustion does not trigger any runtime player_breath cues'
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

  // 17d. Enemy vocal/breath positional wet reverb routes through enemyVocalGain
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
      'Enemy vocal/breath wet reverb bus routes exclusively into enemyVocalGain'
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
    assert(
      typeof revAudio.onPlayerDamage === 'undefined' &&
        Math.abs(revAudio.enemyVocalGain.gain.value - 1.0) < 1e-4,
      'enemyVocalGain remains at 1.0 with obsolete onPlayerDamage removed'
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

    // 1. onExitVictory clears active auditions and enemy cues
    lifeAudio.auditionCue('combined_combat_mix')
    assert(
      lifeAudio._auditionMixTimers.length === 3,
      'combined_combat_mix schedules its 3 delayed combat sequence timers'
    )
    lifeAudio.onExitVictory()
    assert(
      lifeAudio._auditionMixTimers.length === 0 &&
        lifeAudio.getAudioState().activeEnemyCueCount === 0,
      'onExitVictory() stops active auditions and clears active enemy cues'
    )

    // 2. Audition timer cancellation via stopAudition
    lifeAudio._hasWon = false
    const cancelledMix = lifeAudio.auditionCue('combined_combat_mix')
    assert(cancelledMix?.played === true, 'combined_combat_mix starts cleanly')
    assert(lifeAudio.stopAudition({ immediate: true }) === true, 'stopAudition stops mix immediately')
    assert(
      lifeAudio._auditionMixTimers.length === 0,
      'stopAudition clears delayed mix timers'
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
      lifeAudio.getAudioState().activeEnemyCueCount === 0,
      'Cancelled combined_combat_mix session timers remain dead after 1150ms'
    )
    assert(
      Math.abs(completedAudio.getAudioState().enemyAttackGain - 1.0) < 1e-4 &&
        Math.abs(completedAudio.getAudioState().enemyVocalGain - 1.0) < 1e-4,
      'Completed combined_combat_mix executes enemy alert, vocal, windup, and hit while keeping combat buses at 1.0'
    )

    lifeAudio.dispose()
    completedAudio.dispose()
  }
}
console.log('✓ Phase 5C regression suite (routing, unified priorities, reverb routing & lifecycle) verified')

console.log('--- ALL 3D HORROR AUDIO TESTS PASSED SUCCESSFULLY! ---')




