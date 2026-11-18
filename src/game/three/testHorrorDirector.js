import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import {
  HORROR_EVENT_TYPES,
  HORROR_INTENSITY_LEVELS,
  HorrorDirector,
} from './HorrorDirector.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createMockAudioContext() {
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
  function makeNode(extra = {}) {
    return {
      connect() {},
      disconnect() {},
      ...extra,
    }
  }
  return {
    state: 'running',
    currentTime: 1.0,
    sampleRate: 44100,
    destination: makeNode(),
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
    async resume() {},
    async close() {},
    createGain: () => makeNode({ gain: makeParam(1) }),
    createDynamicsCompressor: () =>
      makeNode({
        threshold: makeParam(-14),
        knee: makeParam(18),
        ratio: makeParam(6),
      }),
    createBiquadFilter: () =>
      makeNode({ type: 'lowpass', frequency: makeParam(1000), Q: makeParam(1) }),
    createPanner: () =>
      makeNode({
        panningModel: 'HRTF',
        distanceModel: 'linear',
        refDistance: 1.8,
        maxDistance: 22,
        rolloffFactor: 0,
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
      }),
    createOscillator: () =>
      makeNode({
        type: 'sine',
        frequency: makeParam(220),
        start() {},
        stop() {},
        onended: null,
      }),
    createBuffer: (ch, len, sr) => ({
      duration: len / sr,
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () =>
      makeNode({
        buffer: null,
        loop: false,
        start() {},
        stop() {},
        onended: null,
      }),
  }
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

console.log('--- RUNNING HORROR DIRECTOR & DYNAMIC SCARE TESTS ---')

const mazeA = generateMaze({ difficulty: 'medium', seed: 314159 })
const mazeB = generateMaze({ difficulty: 'medium', seed: 314159 })
const mazeDiff = generateMaze({ difficulty: 'medium', seed: 987654 })

// 1. Seeded Deterministic Event Scheduling & Anti-Repetition
console.log('Test 1: Deterministic Seeded Scheduling & Anti-Repetition')
const dir1 = new HorrorDirector({
  maze: mazeA,
  intensity: HORROR_INTENSITY_LEVELS.HIGH,
  initialDelay: 1.0,
  minCooldown: 2.0,
  maxCooldown: 3.0,
  recordHistory: true,
})
const dir2 = new HorrorDirector({
  maze: mazeB,
  intensity: HORROR_INTENSITY_LEVELS.HIGH,
  initialDelay: 1.0,
  minCooldown: 2.0,
  maxCooldown: 3.0,
  recordHistory: true,
})
const dirDiff = new HorrorDirector({
  maze: mazeDiff,
  intensity: HORROR_INTENSITY_LEVELS.HIGH,
  initialDelay: 1.0,
  minCooldown: 2.0,
  maxCooldown: 3.0,
  recordHistory: true,
})

const startWorld = gridToWorld(mazeA.start.row, mazeA.start.col, mazeA)
const simEnemy = {
  id: 'stalker-1',
  state: ENEMY_STATES.PATROL,
  worldPos: { x: startWorld.x + 6.5, y: 0, z: startWorld.z },
  isDisposed: false,
}
const baseCtx = {
  playerWorldPos: startWorld,
  playerGridCell: mazeA.start,
  isHidden: false,
  health: 80,
  maxHealth: 100,
  enemies: [simEnemy],
}

for (let i = 0; i < 400; i += 1) {
  dir1.update(0.1, baseCtx)
  dir2.update(0.1, baseCtx)
  dirDiff.update(0.1, {
    ...baseCtx,
    playerWorldPos: gridToWorld(mazeDiff.start.row, mazeDiff.start.col, mazeDiff),
  })
}

const hist1 = dir1.getEventHistory()
const hist2 = dir2.getEventHistory()
const histDiff = dirDiff.getEventHistory()

assert(hist1.length >= 4, `Scheduled multiple horror events (count: ${hist1.length})`)
assert(
  JSON.stringify(hist1.map((e) => e.type)) === JSON.stringify(hist2.map((e) => e.type)),
  'Identical maze seeds yield identical event schedules'
)
assert(
  JSON.stringify(hist1) !== JSON.stringify(histDiff),
  'Different maze seeds diverge cleanly'
)

for (let i = 1; i < hist1.length; i += 1) {
  assert(
    hist1[i].type !== hist1[i - 1].type,
    `No back-to-back repetitive event (${hist1[i].type} after ${hist1[i - 1].type})`
  )
}

dir1.dispose()
dir2.dispose()
dirDiff.dispose()
console.log('✓ Seeded determinism and anti-repetition verified')

// 2. Intensity Settings & Cooldown Enforcement
console.log('Test 2: Intensity Presets & Cooldown Enforcement')
const offDir = new HorrorDirector({
  maze: mazeA,
  intensity: HORROR_INTENSITY_LEVELS.OFF,
  recordHistory: true,
})
for (let i = 0; i < 200; i += 1) {
  offDir.update(0.25, baseCtx)
}
assert(
  offDir.getEventHistory().length === 0,
  'Intensity OFF schedules zero automatic horror events'
)
offDir.dispose()

const lowDir = new HorrorDirector({
  maze: mazeA,
  intensity: HORROR_INTENSITY_LEVELS.LOW,
  recordHistory: true,
})
const highDir = new HorrorDirector({
  maze: mazeA,
  intensity: HORROR_INTENSITY_LEVELS.HIGH,
  recordHistory: true,
})
for (let i = 0; i < 300; i += 1) {
  lowDir.update(0.1, baseCtx)
  highDir.update(0.1, baseCtx)
}
assert(
  highDir.getEventHistory().length > lowDir.getEventHistory().length,
  `HIGH intensity triggers more frequently than LOW (high=${highDir.getEventHistory().length}, low=${lowDir.getEventHistory().length})`
)
lowDir.dispose()
highDir.dispose()
console.log('✓ Intensity levels and cooldown pacing verified')

// 3. Context Evaluation, Stealth Safety & Non-Directional Presence Warnings
console.log('Test 3: Context Sensitivity, Stealth Invisibility & Safe Non-Damage Rules')
const engine = createHeadlessEngine({
  enemies: { autoSpawn: false },
  audio: {
    createAudioContext: () => createMockAudioContext(),
    autoUnlock: true,
    recordCueHistory: true,
  },
  horrorDirector: {
    intensity: HORROR_INTENSITY_LEVELS.HIGH,
    reducedMotion: false,
    visualScaresEnabled: true,
    recordHistory: true,
  },
})
engine.setMaze(mazeA)

const audioEngine = engine.getAudioEngine()
const director = engine.getHorrorDirector()
const env = engine.getEnvironment()
const baselineAmbient = env.config.ambientIntensity
const baselineDirectional = env.config.directionalIntensity

// Spawn an enemy 7m away and check hidden player protection during horror events
const enemy = engine.enemyManager.spawnEnemy({
  id: 'stalker-safe',
  spawnCell: mazeA.exit,
})
const playerPos = engine.getPlayerWorldPosition()
enemy.setPosition(playerPos.x + 7.0, 0, playerPos.z)

// Trigger presence_warning & verify non-positional cue (does not reveal enemy location)
audioEngine.clearCueHistory()
const presenceEvt = director.triggerEvent(HORROR_EVENT_TYPES.PRESENCE_WARNING, {
  playerWorldPos: playerPos,
  enemies: [enemy],
  health: 100,
  maxHealth: 100,
})
assert(presenceEvt !== null, 'presence_warning triggered cleanly')
const presenceCue = audioEngine
  .getCueHistory()
  .find((c) => c.type === 'director_presence_warning')
assert(presenceCue && presenceCue.positional === false, 'Presence warning audio is non-directional so enemy position is never leaked')

// Trigger blackout + scripted_scare while player is hidden and verify zero damage & preserved stealth
const prevHealth = engine.getHealth().health
const hiddenCtx = {
  playerWorldPos: playerPos,
  playerGridCell: engine.getPlayerGridCell(),
  isHidden: true,
  health: prevHealth,
  maxHealth: 100,
  enemies: [enemy],
}
director._elapsedSec = 35
const scripted = director.triggerEvent(HORROR_EVENT_TYPES.SCRIPTED_SCARE, hiddenCtx)
assert(scripted !== null, 'Rare scripted scare sequence starts cleanly')

let lightsDimmedDuringScript = false
for (let i = 0; i < 40; i += 1) {
  director.update(0.1, hiddenCtx)
  if (env.lights.ambientLight.intensity < baselineAmbient * 0.9) {
    lightsDimmedDuringScript = true
  }
  // Verify enemy never discovers hidden player from horror events
  enemy.update(0.05, {
    playerWorldPos: playerPos,
    playerGridCell: engine.getPlayerGridCell(),
    playerHidden: true,
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
  })
  assert(
    enemy.getState() !== ENEMY_STATES.CHASE && enemy.getState() !== ENEMY_STATES.ATTACK,
    'Horror events never bypass stealth hiding rules'
  )
}

assert(lightsDimmedDuringScript === true, 'Scripted scare temporarily dims vault lighting')
assert(
  Math.abs(env.lights.ambientLight.intensity - baselineAmbient) < 1e-4 &&
    Math.abs(env.lights.directionalLight.intensity - baselineDirectional) < 1e-4,
  'Baseline lights are restored cleanly after scripted scare finishes'
)
assert(engine.getHealth().health === prevHealth, 'Horror events never damage the player')

const cueTypes = new Set(audioEngine.getCueHistory().map((c) => c.type))
assert(cueTypes.has('director_scripted_scare'), 'Scripted scare cues routed to HorrorAudioEngine')
console.log('✓ Context, stealth safety, zero damage, lighting restore, and audio integration verified')

// 4. Distant Silhouette & Positional Environmental Sound
console.log('Test 4: Silhouette Mesh Visuals & Positional Environmental Sound')
audioEngine.clearCueHistory()
const silTarget = { x: playerPos.x + 8.0, y: 0, z: playerPos.z }
const silEvt = director.triggerEvent(
  HORROR_EVENT_TYPES.DISTANT_SILHOUETTE,
  { playerWorldPos: playerPos },
  { targetPos: silTarget }
)
assert(silEvt !== null, 'distant_silhouette triggered')
assert(
  director._silhouetteGroup && director._silhouetteGroup.visible === true,
  'Silhouette mesh added to scene and made visible'
)
director.update(0.5, { playerWorldPos: playerPos })
assert(
  director._silhouetteGroup.userData.cloakMat.opacity > 0,
  'Silhouette fades in smoothly during active window'
)
for (let i = 0; i < 25; i += 1) {
  director.update(0.1, { playerWorldPos: playerPos })
}
assert(
  director._silhouetteGroup.visible === false,
  'Silhouette hides cleanly after event completes'
)

audioEngine.updateListener(playerPos)
const soundEvt = director.triggerEvent(
  HORROR_EVENT_TYPES.ENVIRONMENTAL_SOUND,
  { playerWorldPos: playerPos },
  { targetPos: { x: playerPos.x + 6.0, y: 0, z: playerPos.z } }
)
assert(soundEvt !== null, 'environmental_sound triggered')
const envSoundCue = audioEngine
  .getCueHistory()
  .find((c) => c.type === 'director_environmental_sound')
assert(
  envSoundCue && envSoundCue.positional === true && envSoundCue.gain > 0 && envSoundCue.gain < 1,
  `Environmental sound uses positional attenuation (got gain=${envSoundCue?.gain})`
)
console.log('✓ Silhouette lifecycle and positional environmental disturbance verified')

// 5. Reduced Motion & Visual Scares Disabled Controls
console.log('Test 5: Reduced Motion & Visual Scares Accessibility Controls')
director.setVisualScaresEnabled(false)
const blockedSilhouette = director.triggerEvent(
  HORROR_EVENT_TYPES.DISTANT_SILHOUETTE,
  { playerWorldPos: playerPos }
)
const blockedFlicker = director.triggerEvent(
  HORROR_EVENT_TYPES.LIGHT_FLICKER,
  { playerWorldPos: playerPos }
)
assert(blockedSilhouette === null, 'distant_silhouette blocked when visualScaresEnabled is false')
assert(blockedFlicker === null, 'light_flicker blocked when visualScaresEnabled is false')

const audioOnlyDisturbance = director.triggerEvent(
  HORROR_EVENT_TYPES.ENVIRONMENTAL_SOUND,
  { playerWorldPos: playerPos }
)
assert(audioOnlyDisturbance !== null, 'Non-visual environmental sound still works when visual scares are disabled')

director.setVisualScaresEnabled(true)
director.setReducedMotion(true)
director.triggerEvent(HORROR_EVENT_TYPES.LIGHT_FLICKER, { playerWorldPos: playerPos })
let minScaleSeen = 1
for (let i = 0; i < 20; i += 1) {
  director.update(0.1, { playerWorldPos: playerPos })
  const ratio = env.lights.ambientLight.intensity / baselineAmbient
  if (ratio < minScaleSeen) minScaleSeen = ratio
}
assert(
  minScaleSeen >= 0.54,
  `Reduced motion keeps light dip smooth and non-strobing (min ratio: ${minScaleSeen.toFixed(2)})`
)

// Verify camera shake is also suppressed under reducedMotion
engine.cameraShakeIntensity = 0.28
engine.horrorDirector.setReducedMotion(true)
engine.start()
engine.stop()
assert(engine.camera.rotation.z === 0, 'Camera trauma shake suppressed when reducedMotion is enabled')
console.log('✓ Reduced motion and visual-scare opt-out verified')

// 6. Pause, Game-Over, Reset, Maze Replacement & Disposal Lifecycle
console.log('Test 6: Pause, Game-Over, Reset, Maze Replacement & Clean Disposal')
director.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, { playerWorldPos: playerPos })
director.update(0.4, { playerWorldPos: playerPos })
assert(env.lights.ambientLight.intensity < baselineAmbient, 'Blackout dims lights before pause')

engine.setPaused(true)
assert(
  Math.abs(env.lights.ambientLight.intensity - baselineAmbient) < 1e-4,
  'Pausing restores baseline lights cleanly'
)
const elapsedBeforePause = director.getState().elapsedTime
director.update(1.0, { playerWorldPos: playerPos })
assert(
  director.getState().elapsedTime === elapsedBeforePause,
  'Director timer does not advance while paused'
)

engine.setPaused(false)
engine.setHealth(0)
assert(engine.getHealth().isGameOver === true && director.getState().isGameOver === true, 'Game-over syncs to HorrorDirector')

engine.resetCombat()
assert(director.getState().isGameOver === false && director.getState().eventCount === 0, 'resetCombat resets HorrorDirector cleanly')

engine.setMaze(mazeDiff)
assert(director.maze === mazeDiff, 'Maze replacement updates HorrorDirector maze reference')

const sceneRef = engine.scene
engine.dispose()
assert(director.isDisposed === true, 'HorrorDirector disposes with MazeSceneEngine')
assert(sceneRef.children.length === 0, 'All Three.js scene children (including silhouettes) cleared cleanly on dispose')
console.log('✓ Pause, game-over, reset, maze replacement, and leak-free disposal verified')

console.log('ALL HORROR DIRECTOR & DYNAMIC SCARE TESTS PASSED SUCCESSFULLY!')
