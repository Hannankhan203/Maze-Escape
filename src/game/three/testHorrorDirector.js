import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { isCellWalkable } from '../world/gridCollision.js'
import { gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES, checkLineOfSight } from './EnemyAgent.js'
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

// Trigger blackout + scripted_scare while player is concealed and verify zero damage & preserved concealment
const prevHealth = engine.getHealth().health
const concealedCtx = {
  playerWorldPos: playerPos,
  playerGridCell: engine.getPlayerGridCell(),
  health: prevHealth,
  maxHealth: 100,
  enemies: [enemy],
}
director._elapsedSec = 35
const scripted = director.triggerEvent(HORROR_EVENT_TYPES.SCRIPTED_SCARE, concealedCtx)
assert(scripted !== null, 'Rare scripted scare sequence starts cleanly')

let lightsDimmedDuringScript = false
for (let i = 0; i < 40; i += 1) {
  director.update(0.1, concealedCtx)
  if (env.lights.ambientLight.intensity < baselineAmbient * 0.9) {
    lightsDimmedDuringScript = true
  }
  // Verify enemy never discovers concealed player from horror events
  enemy.update(0.05, {
    playerWorldPos: playerPos,
    playerGridCell: engine.getPlayerGridCell(),
    playerHidden: true,
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
  })
  assert(
    enemy.getState() !== ENEMY_STATES.CHASE && enemy.getState() !== ENEMY_STATES.ATTACK,
    'Horror events never bypass concealment rules'
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

// 7. Apparition Forward-Cone Spawn Positioning & Safe Skip When Blocked
console.log('Test 7: Apparition Forward-Cone Spawn Positioning & Blocked-Corridor Safe Skip')
// 11x11 maze with a straight horizontal corridor on row 5 from col 1..9 (2.8m cells)
const spawnGrid = Array.from({ length: 11 }, (_, r) =>
  Array.from({ length: 11 }, (__, c) => {
    if (r === 5 && c >= 1 && c <= 9) return CELL_TYPES.PATH
    return CELL_TYPES.WALL
  })
)
const spawnMaze = {
  rows: 11,
  cols: 11,
  start: { row: 5, col: 4 },
  exit: { row: 5, col: 9 },
  seed: 424242,
  difficulty: 'medium',
  grid: spawnGrid,
}

const spawnEngine = createHeadlessEngine({
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
spawnEngine.setMaze(spawnMaze)
const spawnDir = spawnEngine.getHorrorDirector()
const spawnAudio = spawnEngine.getAudioEngine()

// Player at center (row 5, col 4): col 1..2 is 5.6..8.4m behind (-X), col 6..9 is 5.6..14.0m ahead (+X)
const centerPlayerPos = gridToWorld(5, 4, spawnMaze)
const forwardPlusX = { x: 1, z: 0 }
for (let i = 0; i < 12; i += 1) {
  spawnAudio.clearCueHistory()
  const picked = spawnDir._pickCorridorTarget(centerPlayerPos, 5.5, 14.5, true, {
    playerForward: forwardPlusX,
  })
  assert(picked !== null, 'Forward corridor target resolves when ahead LOS corridor exists')
  assert(
    isCellWalkable(picked.row, picked.col, spawnMaze) &&
      spawnMaze.grid[picked.row][picked.col] === CELL_TYPES.PATH,
    'Picked silhouette target is a valid walkable PATH cell'
  )
  assert(
    checkLineOfSight(centerPlayerPos, picked, spawnMaze),
    'Picked silhouette target has unobstructed line of sight'
  )
  const dx = picked.x - centerPlayerPos.x
  const dz = picked.z - centerPlayerPos.z
  const dist = Math.hypot(dx, dz)
  const dot = (dx * forwardPlusX.x + dz * forwardPlusX.z) / dist
  assert(
    dist >= 5.5 && dist <= 14.5 && dot >= 0.25,
    `Target lies in front view cone and [5.5, 14.5]m (dx=${dx.toFixed(2)}, dist=${dist.toFixed(2)}, dot=${dot.toFixed(2)})`
  )
}

const triggeredForward = spawnDir.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, {
  playerWorldPos: centerPlayerPos,
  playerForward: forwardPlusX,
})
assert(
  triggeredForward !== null &&
    spawnDir._silhouetteGroup.visible === true &&
    spawnDir._silhouetteWorldPos.x > centerPlayerPos.x,
  'triggerEvent(DISTANT_SILHOUETTE) spawns silhouette ahead of player when forward LOS exists'
)
spawnDir._stopActiveEvent(true)

// Now place player at (row 5, col 8) facing +X directly toward the dead-end wall at col 10 (only col 9 = 2.8m < 5.5m ahead),
// while col 1..5 behind has plenty of 8.4..19.6m clear LOS behind the player.
const deadEndPos = gridToWorld(5, 8, spawnMaze)
spawnAudio.clearCueHistory()
const pickedBlocked = spawnDir._pickCorridorTarget(deadEndPos, 5.5, 14.5, true, {
  playerForward: forwardPlusX,
})
assert(
  pickedBlocked === null,
  'When facing dead-end wall with only behind-player LOS cells, _pickCorridorTarget returns null instead of spawning behind player'
)

const snapBlocked = spawnDir.evaluateContext({
  playerWorldPos: deadEndPos,
  playerForward: forwardPlusX,
  health: 60,
  maxHealth: 100,
})
for (let i = 0; i < 20; i += 1) {
  const candidate = spawnDir.selectNextEvent(snapBlocked)
  assert(
    candidate !== HORROR_EVENT_TYPES.DISTANT_SILHOUETTE,
    'selectNextEvent excludes DISTANT_SILHOUETTE when no forward LOS corridor exists'
  )
}

const skippedEvt = spawnDir.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, {
  playerWorldPos: deadEndPos,
  playerForward: forwardPlusX,
})
assert(
  skippedEvt === null &&
    spawnDir._silhouetteGroup.visible === false &&
    !spawnAudio.getCueHistory().some((c) => c.type === 'director_distant_silhouette'),
  'triggerEvent(DISTANT_SILHOUETTE) skips safely without visual mesh or audio when no forward LOS corridor exists'
)

// 8. Pause/Resume Cancellation for Standalone Silhouette & Scripted Scare Silhouette Beat
console.log('Test 8: Pause/Resume Silhouette Cancellation & Scripted Scare Beat Safety')
spawnAudio.clearCueHistory()
const pauseSilEvt = spawnDir.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, {
  playerWorldPos: centerPlayerPos,
  playerForward: forwardPlusX,
})
assert(pauseSilEvt !== null, 'Standalone distant_silhouette starts before pause')
spawnDir.update(0.45, {
  playerWorldPos: centerPlayerPos,
  playerForward: forwardPlusX,
})
assert(
  spawnDir._silhouetteGroup.visible === true &&
    spawnEngine._activeHorrorEventType === HORROR_EVENT_TYPES.DISTANT_SILHOUETTE,
  'Silhouette visible and active event tracked in MazeSceneEngine before pause'
)

spawnEngine.setPaused(true)
assert(
  spawnDir.getState().activeEvent === null &&
    spawnDir._silhouetteGroup.visible === false &&
    spawnDir._silhouetteWorldPos === null &&
    spawnEngine._activeHorrorEventType === null,
  'Pausing cancels active DISTANT_SILHOUETTE, hides silhouette, and clears ambient suppression state'
)

spawnEngine.setPaused(false)
spawnAudio.clearCueHistory()
for (let i = 0; i < 15; i += 1) {
  spawnDir.update(0.1, {
    playerWorldPos: centerPlayerPos,
    playerForward: forwardPlusX,
  })
}
assert(
  spawnDir._silhouetteGroup.visible === false &&
    spawnEngine._activeHorrorEventType === null &&
    !spawnAudio.getCueHistory().some((c) => c.type === 'director_distant_silhouette'),
  'Resuming does not resurrect cancelled DISTANT_SILHOUETTE or leave invisible ambient suppression active'
)

// Verify SCRIPTED_SCARE Beat 2 protection when paused during Beat 1 or Beat 2
spawnAudio.clearCueHistory()
spawnDir._elapsedSec = 45
const scriptedForPause = spawnDir.triggerEvent(HORROR_EVENT_TYPES.SCRIPTED_SCARE, {
  playerWorldPos: centerPlayerPos,
  playerForward: forwardPlusX,
  health: 50,
  maxHealth: 100,
})
assert(scriptedForPause !== null, 'scripted_scare starts cleanly before pause')
spawnDir.update(0.4, {
  playerWorldPos: centerPlayerPos,
  playerForward: forwardPlusX,
})
spawnEngine.setPaused(true)
assert(
  spawnDir._activeEvent?.silhouetteCancelled === true &&
    spawnDir._silhouetteGroup.visible === false,
  'Pausing during scripted_scare marks silhouetteCancelled and hides silhouette'
)
spawnEngine.setPaused(false)
let sawSilhouetteAfterResume = false
for (let i = 0; i < 34; i += 1) {
  spawnDir.update(0.1, {
    playerWorldPos: centerPlayerPos,
    playerForward: forwardPlusX,
  })
  if (spawnDir._silhouetteGroup?.visible) {
    sawSilhouetteAfterResume = true
  }
}
const scriptedBeatsAfterResume = spawnAudio
  .getCueHistory()
  .filter((c) => c.type === 'director_scripted_scare')
  .map((c) => c.beat)
assert(
  !sawSilhouetteAfterResume &&
    scriptedBeatsAfterResume.includes(2) &&
    scriptedBeatsAfterResume.includes(3) &&
    spawnDir.getState().activeEvent === null,
  `scripted_scare completes Beat 2/3 audio & recovery cleanly without re-showing cancelled silhouette (beats=${JSON.stringify(scriptedBeatsAfterResume)})`
)

// Also test pausing mid-Beat 2 while the silhouette IS already visible
spawnAudio.clearCueHistory()
spawnDir._elapsedSec = 95
spawnDir._typeCooldowns.delete(HORROR_EVENT_TYPES.SCRIPTED_SCARE)
const scriptedMidBeat2 = spawnDir.triggerEvent(HORROR_EVENT_TYPES.SCRIPTED_SCARE, {
  playerWorldPos: centerPlayerPos,
  playerForward: forwardPlusX,
  health: 50,
  maxHealth: 100,
})
assert(scriptedMidBeat2 !== null, 'scripted_scare starts for Beat 2 pause check')
for (let i = 0; i < 14; i += 1) {
  spawnDir.update(0.1, {
    playerWorldPos: centerPlayerPos,
    playerForward: forwardPlusX,
  })
}
assert(
  spawnDir._silhouetteGroup.visible === true,
  'Silhouette is visible during scripted_scare Beat 2 before pause'
)
spawnEngine.setPaused(true)
assert(
  spawnDir._silhouetteGroup.visible === false &&
    spawnDir._activeEvent?.silhouetteCancelled === true,
  'Pausing mid-Beat 2 immediately hides visible silhouette and marks silhouetteCancelled'
)
spawnEngine.setPaused(false)
let sawSilhouetteAfterMidPause = false
for (let i = 0; i < 24; i += 1) {
  spawnDir.update(0.1, {
    playerWorldPos: centerPlayerPos,
    playerForward: forwardPlusX,
  })
  if (spawnDir._silhouetteGroup?.visible) {
    sawSilhouetteAfterMidPause = true
  }
}
const midPauseBeats = spawnAudio
  .getCueHistory()
  .filter((c) => c.type === 'director_scripted_scare')
  .map((c) => c.beat)
assert(
  !sawSilhouetteAfterMidPause &&
    midPauseBeats.includes(3) &&
    spawnDir.getState().activeEvent === null,
  'Resuming after Beat 2 pause keeps silhouette hidden and finishes Beat 3 cleanly'
)

// 9. Floor Clipping Prevention Across Full Hover Animation & Reduced Motion
console.log('Test 9: Silhouette World Bounding Box Stays Above Floor (y >= 0) Across Hover Cycle')
spawnDir.setReducedMotion(false)
const hoverEvt = spawnDir.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, {
  playerWorldPos: centerPlayerPos,
  playerForward: forwardPlusX,
})
assert(hoverEvt !== null, 'Silhouette event starts for hover floor-clipping check')

const box = new THREE.Box3()
let minBottomY = Infinity
const observedYPositions = new Set()
for (let step = 0; step < 41; step += 1) {
  spawnDir._silhouetteGroup.updateWorldMatrix(true, true)
  box.setFromObject(spawnDir._silhouetteGroup)
  if (box.min.y < minBottomY) {
    minBottomY = box.min.y
  }
  observedYPositions.add(Number(spawnDir._silhouetteGroup.position.y.toFixed(4)))
  assert(
    box.min.y >= 0.005,
    `Silhouette world min.y stays strictly above floor y=0 at step ${step} (got ${box.min.y.toFixed(4)})`
  )
  spawnDir.update(0.05, {
    playerWorldPos: centerPlayerPos,
    playerForward: forwardPlusX,
  })
}
assert(
  observedYPositions.size > 5,
  `Silhouette preserves subtle hover motion when reducedMotion is false (samples=${observedYPositions.size})`
)

spawnDir.setReducedMotion(true)
const staticEvt = spawnDir.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, {
  playerWorldPos: centerPlayerPos,
  playerForward: forwardPlusX,
})
assert(staticEvt !== null, 'Silhouette event starts with reducedMotion enabled')
for (let step = 0; step < 20; step += 1) {
  spawnDir.update(0.05, {
    playerWorldPos: centerPlayerPos,
    playerForward: forwardPlusX,
  })
  if (spawnDir._silhouetteGroup.visible) {
    spawnDir._silhouetteGroup.updateWorldMatrix(true, true)
    box.setFromObject(spawnDir._silhouetteGroup)
    assert(
      spawnDir._silhouetteGroup.position.y === 0 && box.min.y >= 0.04,
      `Reduced motion freezes hover at y=0 with safe floor clearance (minY=${box.min.y.toFixed(4)})`
    )
  }
}

spawnEngine.dispose()
console.log('✓ Forward-cone spawn, pause/resume safety, and hover floor clearance verified')

console.log('ALL HORROR DIRECTOR & DYNAMIC SCARE TESTS PASSED SUCCESSFULLY!')
