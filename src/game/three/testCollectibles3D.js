import { gameReducer } from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { POWERUP_TYPES } from '../mechanics/powerups.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  COLLECTIBLE_PALETTE,
  buildCoinMesh,
  buildEchoMarkerMesh,
  buildPowerUpMesh,
} from './buildCollectibles.js'
import { CollectibleManager } from './CollectibleManager.js'
import { HorrorAudioEngine, MUSIC_MOODS } from './HorrorAudioEngine.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createMockAudioContext() {
  const stats = {
    resumeCount: 0,
    closeCount: 0,
    oscillatorsStarted: 0,
    oscillatorsStopped: 0,
    bufferSourcesStarted: 0,
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
      disconnect() {},
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
    async close() {
      stats.closeCount += 1
      ctx.state = 'closed'
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
      return makeBaseNode({
        type: 'lowpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
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
    enemies: { autoSpawn: false },
    createRenderer: () => mockRenderer,
    ...config,
  })
}

console.log('--- RUNNING 3D COLLECTIBLES, POWER-UPS, ECHO PATH & AUDIO TESTS ---')

// 1. Procedural coin, power-up, and echo marker mesh construction
console.log('Test 1: Collectible & Power-Up Procedural 3D Mesh Creation')
const coinMesh = buildCoinMesh({ id: 'coin-1-2', row: 1, col: 2 })
assert(coinMesh.isGroup === true, 'Coin mesh is a THREE.Group')
assert(coinMesh.children.length === 3, 'Coin mesh has rim, face, and core gem parts')
assert(coinMesh.userData.collectibleKind === 'coin', 'Coin userData kind set')
assert(coinMesh.userData.accentColor === COLLECTIBLE_PALETTE.coinGlow, 'Coin uses gold palette')

const wallPassMesh = buildPowerUpMesh({ id: 'pu-wp', type: POWERUP_TYPES.WALL_PASS, row: 2, col: 3 })
const echoMesh = buildPowerUpMesh({ id: 'pu-er', type: POWERUP_TYPES.ECHO_REVEAL, row: 3, col: 4 })
const magnetMesh = buildPowerUpMesh({ id: 'pu-cm', type: POWERUP_TYPES.COIN_MAGNET, row: 4, col: 5 })

assert(wallPassMesh.children.length >= 3, 'Wall Pass mesh is multi-part group')
assert(echoMesh.children.length >= 3, 'Echo Reveal mesh is multi-part group')
assert(magnetMesh.children.length >= 5, 'Coin Magnet mesh is multi-part horseshoe magnet group')
assert(
  wallPassMesh.userData.accentColor !== echoMesh.userData.accentColor &&
    echoMesh.userData.accentColor !== magnetMesh.userData.accentColor,
  'All 3 power-ups have distinct accent colors'
)

const stepMarker = buildEchoMarkerMesh({ row: 1, col: 2 }, 0, 4)
const goalMarker = buildEchoMarkerMesh({ row: 1, col: 5 }, 3, 4)
assert(stepMarker.userData.isGoal === false, 'Intermediate echo marker is not goal')
assert(goalMarker.userData.isGoal === true, 'Final echo marker is highlighted as goal')
console.log('✓ Procedural coin, power-up, and echo breadcrumb meshes verified')

// 2. Stable-ID reconciliation, animation updates, removal bursts & disposal
console.log('Test 2: Stable-ID Reconciliation, Animation & Removal Bursts')
const openMaze = {
  id: 'collectible-test-maze',
  rows: 5,
  cols: 7,
  start: { row: 2, col: 1 },
  exit: { row: 2, col: 5 },
  seed: 777,
  difficulty: 'small',
  grid: [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ],
  collectibles: {
    coins: [
      { id: 'coin-2-2', row: 2, col: 2 },
      { id: 'coin-2-3', row: 2, col: 3 },
      { id: 'coin-1-3', row: 1, col: 3 },
    ],
    powerUps: [
      { id: 'pu-wall_pass-3-2', type: POWERUP_TYPES.WALL_PASS, row: 3, col: 2 },
      { id: 'pu-coin_magnet-3-3', type: POWERUP_TYPES.COIN_MAGNET, row: 3, col: 3 },
    ],
  },
}

const fakeScene = {
  children: [],
  add(obj) {
    this.children.push(obj)
  },
  remove(obj) {
    const idx = this.children.indexOf(obj)
    if (idx !== -1) this.children.splice(idx, 1)
  },
}
const manager = new CollectibleManager(fakeScene)
manager.syncState({
  maze: openMaze,
  coins: openMaze.collectibles.coins,
  powerUps: openMaze.collectibles.powerUps,
  echoPath: [],
  spawnBursts: false,
})

assert(manager.getCounts().coins === 3, 'All 3 initial coins mounted')
assert(manager.getCounts().powerUps === 2, 'Both initial power-ups mounted')

const keptCoinEntry = manager.coins.get('coin-2-3')
const expectedWorld23 = gridToWorld(2, 3, openMaze)
assert(
  Math.abs(keptCoinEntry.mesh.position.x - expectedWorld23.x) < 1e-6 &&
    Math.abs(keptCoinEntry.mesh.position.z - expectedWorld23.z) < 1e-6,
  'Coin mesh placed at canonical gridToWorld position'
)

const initialRotY = keptCoinEntry.mesh.rotation.y
manager.update(0.25)
assert(keptCoinEntry.mesh.rotation.y > initialRotY, 'Coin rotates smoothly during update()')

// Collect coin-2-2 while keeping coin-2-3 and coin-1-3
manager.syncCoins(
  openMaze.collectibles.coins.filter((c) => c.id !== 'coin-2-2'),
  openMaze,
  { spawnBursts: true }
)
assert(manager.getCounts().coins === 2, 'Collected coin removed immediately')
assert(!manager.coins.has('coin-2-2'), 'Removed coin ID deleted from manager')
assert(
  manager.coins.get('coin-2-3') === keptCoinEntry,
  'Untouched coin mesh preserved by stable ID without rebuild'
)
assert(manager.getCounts().bursts === 1, 'Removal spawned 1 procedural collection burst')
assert(manager.disposedMeshCount >= 1, 'Removed coin mesh was disposed')

// Advance past burst duration (0.46s) to verify burst auto-disposal
manager.update(0.6)
assert(manager.getCounts().bursts === 0, 'Completed collection burst removed and disposed')
console.log('✓ Stable-ID reconciliation, rotation/bob animation, and burst disposal verified')

// 3. Coin Magnet synchronization with reducer state
console.log('Test 3: Coin Magnet Multi-Coin Synchronization')
let reducerState = {
  difficulty: 'small',
  seed: 777,
  maze: openMaze,
  playerPos: { row: 2, col: 1 },
  moves: 0,
  hasWon: false,
  isGameOver: false,
  health: 100,
  maxHealth: 100,
  lastDirection: 'right',
  blockedBump: null,
  coins: [...openMaze.collectibles.coins],
  totalCoins: openMaze.collectibles.coins.length,
  coinsCollected: 0,
  powerUps: [...openMaze.collectibles.powerUps],
  inventory: {
    [POWERUP_TYPES.WALL_PASS]: 1,
    [POWERUP_TYPES.ECHO_REVEAL]: 1,
    [POWERUP_TYPES.COIN_MAGNET]: 1,
  },
  activeEffects: {
    wallPassArmed: false,
    echoRevealRemainingMs: 0,
    magnetRemainingMs: 0,
  },
  echoPath: [],
  effects: [],
  eventCounter: 0,
  lastEvent: null,
}

// Re-sync manager cleanly to full reducer state
manager.syncState({
  maze: openMaze,
  coins: reducerState.coins,
  powerUps: reducerState.powerUps,
  echoPath: reducerState.echoPath,
  spawnBursts: false,
  isReset: true,
})
assert(manager.getCounts().coins === 3, 'Reset restores all 3 coins before magnet sweep')

// Move to (2, 2) -> direct pickup of coin-2-2
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 2, col: 2 },
})
assert(reducerState.coins.length === 2, 'Direct step leaves 2 coins')
manager.syncCoins(reducerState.coins, openMaze, { spawnBursts: true })
assert(manager.getCounts().coins === 2, 'Manager mirrors direct pickup')

// Activate Coin Magnet at (2, 2): should pull BOTH remaining coins within radius 2!
reducerState = gameReducer(reducerState, {
  type: 'ACTIVATE_ABILITY',
  abilityType: POWERUP_TYPES.COIN_MAGNET,
})
assert(
  reducerState.lastEvent?.type === 'coin_magnet_activated' &&
    reducerState.lastEvent?.coinsGained === 2,
  'Reducer reports coin_magnet_activated with 2 pulled coins'
)
assert(reducerState.coins.length === 0, 'All nearby unobstructed coins pulled by Coin Magnet')
manager.clearBursts()
manager.syncCoins(reducerState.coins, openMaze, { spawnBursts: true })
assert(manager.getCounts().coins === 0, 'CollectibleManager removes all magnetized coins')
assert(
  manager.getCounts().bursts === 2,
  `Magnetized multi-coin sweep spawns 2 bursts (got ${manager.getCounts().bursts})`
)
console.log('✓ Coin Magnet collection synchronization verified')

// 4. Echo Reveal path creation, updating, and clearing
console.log('Test 4: Echo Reveal Breadcrumb Creation, Updates & Clearing')
reducerState = gameReducer(reducerState, {
  type: 'ACTIVATE_ABILITY',
  abilityType: POWERUP_TYPES.ECHO_REVEAL,
})
assert(reducerState.echoPath.length >= 3, 'Echo Reveal computes shortest path to exit')
manager.syncEchoPath(reducerState.echoPath, openMaze)
const initialEchoCount = manager.getCounts().echoMarkers
assert(
  initialEchoCount === reducerState.echoPath.length,
  `Echo markers count (${initialEchoCount}) matches echoPath length (${reducerState.echoPath.length})`
)

const preservedTargetMarker = manager.echoMarkers.get('2,5')
assert(preservedTargetMarker?.isGoal === true, 'Exit step marker marked as goal')

// Step forward along path -> (2, 3) -> echoPath shrinks and 3D markers update
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 2, col: 3 },
})
manager.syncEchoPath(reducerState.echoPath, openMaze)
assert(
  manager.getCounts().echoMarkers === reducerState.echoPath.length &&
    manager.getCounts().echoMarkers < initialEchoCount,
  'Stepping forward shrinks Echo Reveal markers to match updated path'
)
assert(
  manager.echoMarkers.get('2,5') === preservedTargetMarker,
  'Remaining Echo Reveal markers are preserved cleanly without flicker'
)

// Expire Echo Reveal timer -> clears all 3D breadcrumb markers
reducerState = gameReducer(reducerState, {
  type: 'TICK_ABILITIES',
  deltaMs: 10000,
})
assert(reducerState.echoPath.length === 0, 'Echo path cleared upon timer expiry')
manager.syncEchoPath(reducerState.echoPath, openMaze)
assert(manager.getCounts().echoMarkers === 0, '3D echo markers removed upon expiry')

// Re-activate Echo Reveal, then step onto exit -> victory clears echoPath cleanly
reducerState.inventory[POWERUP_TYPES.ECHO_REVEAL] = 1
reducerState = gameReducer(reducerState, {
  type: 'ACTIVATE_ABILITY',
  abilityType: POWERUP_TYPES.ECHO_REVEAL,
})
manager.syncEchoPath(reducerState.echoPath, openMaze)
assert(manager.getCounts().echoMarkers > 0, 'Echo markers rebuilt on second activation')

reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: openMaze.exit,
})
assert(reducerState.hasWon === true && reducerState.echoPath.length === 0, 'Victory clears echoPath')
manager.syncEchoPath(reducerState.echoPath, openMaze)
assert(manager.getCounts().echoMarkers === 0, 'Victory clears 3D echo breadcrumb markers')
manager.dispose()
console.log('✓ Echo Reveal breadcrumb lifecycle verified')

// 5. Audio cues & deduplication without duplicates
console.log('Test 5: Collectible, Ability & Victory Audio Cues & Deduplication')
const mockAudio = createMockAudioContext()
const audio = new HorrorAudioEngine({
  createAudioContext: () => mockAudio.ctx,
  recordCueHistory: true,
})

// Locked before user gesture: no oscillators started
audio.handleGameEvent({ id: 1, type: 'coin_collected', coinsGained: 1 })
assert(mockAudio.stats.oscillatorsStarted === 0, 'No audio nodes play prior to unlock()')

audio.unlock()
audio.clearCueHistory()
const oscAfterUnlock = mockAudio.stats.oscillatorsStarted

// Event ID 10: coin pickup; duplicate delivery with same ID MUST be ignored
assert(audio.handleGameEvent({ id: 10, type: 'coin_collected', coinsGained: 1 }) === true)
const oscAfterCoin = mockAudio.stats.oscillatorsStarted
assert(oscAfterCoin > oscAfterUnlock, 'Coin pickup plays Web Audio oscillators')
assert(
  audio.handleGameEvent({ id: 10, type: 'coin_collected', coinsGained: 1 }) === false,
  'Duplicate event ID is rejected'
)
assert(
  mockAudio.stats.oscillatorsStarted === oscAfterCoin,
  'Duplicate event ID does not re-trigger Web Audio nodes'
)

// Power-up pickup
assert(
  audio.handleGameEvent({
    id: 11,
    type: 'powerup_collected',
    powerUpType: POWERUP_TYPES.ECHO_REVEAL,
    coinsGained: 0,
  }) === true,
  'Power-up pickup triggers audio'
)

// Ability activations
assert(audio.handleGameEvent({ id: 12, type: 'wall_pass_armed' }) === true)
assert(audio.handleGameEvent({ id: 13, type: 'wall_pass_used' }) === true)
assert(audio.handleGameEvent({ id: 14, type: 'echo_reveal_activated' }) === true)
assert(
  audio.handleGameEvent({ id: 15, type: 'coin_magnet_activated', coinsGained: 2 }) === true
)

const cues = audio.getCueHistory()
assert(
  cues.filter((c) => c.type === 'coin_collected').length === 2,
  'Coin cue recorded for direct pickup + magnet sweep coins'
)
assert(
  cues.filter((c) => c.type === 'powerup_collected').length === 1,
  'Power-up pickup cue recorded'
)
assert(
  cues.filter((c) => c.type === 'ability_activate').length === 4,
  'All 4 ability activation/usage cues recorded'
)

// Paused audio blocks oscillator playback cleanly
audio.setPaused(true)
const oscBeforePauseAttempt = mockAudio.stats.oscillatorsStarted
assert(
  audio.handleGameEvent({ id: 16, type: 'coin_collected', coinsGained: 1 }) === false,
  'Paused audio suppresses coin cue'
)
assert(
  mockAudio.stats.oscillatorsStarted === oscBeforePauseAttempt,
  'Paused audio creates zero oscillators'
)
audio.setPaused(false)

// Muted volume keeps master gain at 0
audio.setMuted(true)
assert(audio.masterGain.gain.value === 0, 'Muted setting drops master gain to 0')
audio.setMuted(false)

// Exit victory transitions music to SILENT and fires victory cue once
assert(audio.handleGameEvent({ id: 17, type: 'exit' }) === true, 'Exit event triggers victory audio')
assert(
  audio.handleGameEvent({ id: 17, type: 'exit' }) === false,
  'Duplicate exit event does not replay victory audio'
)
assert(
  audio.getAudioState().musicMood === MUSIC_MOODS.SILENT,
  'Exit victory transitions music mood to SILENT'
)
assert(
  audio.getCueHistory().some((c) => c.type === 'exit_victory'),
  'Exit victory cue recorded'
)
audio.dispose()
console.log('✓ Collectible, power-up, ability & victory audio cues and deduplication verified')

// 6. MazeSceneEngine integration: RESET_RUN, NEW_MAZE & clean disposal
console.log('Test 6: Engine Integration, RESET_RUN, NEW_MAZE & Disposal')
const engineAudioMock = createMockAudioContext()
const engine = createHeadlessEngine({
  audio: {
    createAudioContext: () => engineAudioMock.ctx,
    recordCueHistory: true,
  },
})
engine.unlockAudio()

const mazeA = generateMaze({ difficulty: 'small', seed: 1001 })
const mazeB = generateMaze({ difficulty: 'small', seed: 2002 })

engine.setMaze(mazeA)
const cm = engine.getCollectibleManager()
assert(cm !== null, 'MazeSceneEngine exposes CollectibleManager')
assert(
  cm.getCounts().coins === mazeA.collectibles.coins.length,
  'setMaze mounts maze.collectibles coins'
)
assert(
  cm.getCounts().powerUps === mazeA.collectibles.powerUps.length,
  'setMaze mounts maze.collectibles power-ups'
)

// Simulate pickup + RESET_RUN (coins restored without burst)
const subsetCoins = mazeA.collectibles.coins.slice(1)
engine.syncCollectibles({
  coins: subsetCoins,
  powerUps: mazeA.collectibles.powerUps,
  echoPath: [mazeA.start, mazeA.exit],
  spawnBursts: true,
})
assert(cm.getCounts().coins === subsetCoins.length, 'Subset coins synced cleanly')
assert(cm.getCounts().bursts === 1, 'Pickup spawns burst')
assert(cm.getCounts().echoMarkers === 2, 'Echo path markers mounted')

engine.resetCombat()
engine.syncCollectibles({
  coins: mazeA.collectibles.coins,
  powerUps: mazeA.collectibles.powerUps,
  echoPath: [],
  spawnBursts: false,
  isReset: true,
})
assert(
  cm.getCounts().coins === mazeA.collectibles.coins.length,
  'RESET_RUN restores all maze coins without stale removals'
)
assert(cm.getCounts().echoMarkers === 0, 'RESET_RUN clears echo markers')

// Switch to mazeB (NEW_MAZE) -> no stale coins/power-ups from mazeA
engine.setMaze(mazeB)
const expectedMazeBCoinIds = new Set(mazeB.collectibles.coins.map((c) => c.id))
for (const id of cm.getCoinIds()) {
  assert(expectedMazeBCoinIds.has(id), `No stale coin IDs remain after NEW_MAZE (found ${id})`)
}
assert(cm.getCounts().bursts === 0, 'NEW_MAZE clears active bursts')

// Disposal cleans manager and stops leaks
engine.dispose()
assert(cm.isDisposed === true, 'CollectibleManager disposed on engine.dispose()')
assert(engine.getCollectibleManager() === null, 'Engine clears CollectibleManager reference')
assert(engineAudioMock.stats.closeCount === 1, 'Engine closes owned AudioContext on dispose')

console.log('--- ALL 3D COLLECTIBLES, POWER-UPS, ECHO PATH & AUDIO TESTS PASSED! ---')
