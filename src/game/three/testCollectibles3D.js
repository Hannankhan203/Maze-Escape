import { gameReducer } from '../engine/gameReducer.js'
import {
  STANDARD_COLLECTIBLE_SPAWN_COUNTS,
  placeCollectibles,
} from '../generation/collectiblePlacement.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  COLLECTIBLE_TYPES,
  createInitialActiveEffects,
  createInitialInventory,
} from '../mechanics/collectiblesConfig.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  COLLECTIBLE_PALETTE,
  buildCollectibleItemMesh,
  buildEchoMarkerMesh,
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

console.log('--- RUNNING 3D COLLECTIBLES, ECHO PATH & AUDIO TESTS ---')

// 1. Procedural survival collectible & echo marker mesh construction
console.log('Test 1: Collectible Item & Echo Reveal Procedural 3D Mesh Creation')
const healthMesh = buildCollectibleItemMesh({
  id: 'item-health_capsule-1-2',
  type: COLLECTIBLE_TYPES.HEALTH_CAPSULE,
  row: 1,
  col: 2,
})
const shardMesh = buildCollectibleItemMesh({
  id: 'item-soul_shards-2-2',
  type: COLLECTIBLE_TYPES.SOUL_SHARDS,
  row: 2,
  col: 2,
})
const energyMesh = buildCollectibleItemMesh({
  id: 'item-energy_cell-2-3',
  type: COLLECTIBLE_TYPES.ENERGY_CELL,
  row: 2,
  col: 3,
})
const echoMesh = buildCollectibleItemMesh({
  id: 'item-echo_reveal-3-4',
  type: COLLECTIBLE_TYPES.ECHO_REVEAL,
  row: 3,
  col: 4,
})

assert(healthMesh.isGroup === true, 'Health Capsule mesh is a THREE.Group')
assert(healthMesh.children.length >= 6, 'Health Capsule mesh has vial, caps, core, cross & halo')
assert(healthMesh.userData.collectibleKind === 'item', 'Health Capsule userData kind set')
assert(healthMesh.userData.accentColor === COLLECTIBLE_PALETTE.healthPrimary, 'Health uses crimson palette')

assert(shardMesh.isGroup === true, 'Soul Shard mesh is a THREE.Group')
assert(shardMesh.children.length >= 5, 'Soul Shard mesh has spires, core & halo')
assert(shardMesh.userData.accentColor === COLLECTIBLE_PALETTE.soulPrimary, 'Soul Shard uses amethyst palette')

assert(energyMesh.isGroup === true, 'Energy Cell mesh is a THREE.Group')
assert(energyMesh.children.length >= 5, 'Energy Cell mesh has plasma core, caps, terminal, rib & halo')
assert(energyMesh.userData.accentColor === COLLECTIBLE_PALETTE.energyPrimary, 'Energy Cell uses emerald palette')

assert(echoMesh.isGroup === true, 'Echo Reveal mesh is a THREE.Group')
assert(echoMesh.children.length >= 4, 'Echo Reveal mesh is multi-part prism + dual halo group')
assert(
  healthMesh.userData.accentColor !== shardMesh.userData.accentColor &&
    shardMesh.userData.accentColor !== energyMesh.userData.accentColor &&
    energyMesh.userData.accentColor !== echoMesh.userData.accentColor,
  'All 4 active collectibles have distinct accent colors'
)

const stepMarker = buildEchoMarkerMesh({ row: 1, col: 2 }, 0, 4)
const goalMarker = buildEchoMarkerMesh({ row: 1, col: 5 }, 3, 4)
assert(stepMarker.userData.isGoal === false, 'Intermediate echo marker is not goal')
assert(goalMarker.userData.isGoal === true, 'Final echo marker is highlighted as goal')
console.log('✓ Procedural survival collectibles and echo breadcrumb meshes verified')

// 2. Stable-ID reconciliation, animation updates, removal bursts & disposal
console.log('Test 2: Stable-ID Reconciliation, Animation & Removal Bursts')
const openMaze = {
  id: 'collectible-test-maze',
  rows: 5,
  cols: 7,
  start: { row: 2, col: 1 },
  exit: { row: 2, col: 5 },
  seed: 777,
  difficulty: 'easy',
  grid: [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ],
  collectibles: {
    items: [
      { id: 'item-soul_shards-2-2', type: COLLECTIBLE_TYPES.SOUL_SHARDS, row: 2, col: 2 },
      { id: 'item-soul_shards-2-3', type: COLLECTIBLE_TYPES.SOUL_SHARDS, row: 2, col: 3 },
      { id: 'item-health_capsule-1-3', type: COLLECTIBLE_TYPES.HEALTH_CAPSULE, row: 1, col: 3 },
      { id: 'item-energy_cell-3-2', type: COLLECTIBLE_TYPES.ENERGY_CELL, row: 3, col: 2 },
      { id: 'item-echo_reveal-3-3', type: COLLECTIBLE_TYPES.ECHO_REVEAL, row: 3, col: 3 },
    ],
    coins: [],
    powerUps: [],
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
  items: openMaze.collectibles.items,
  echoPath: [],
  spawnBursts: false,
})

assert(manager.getCounts().items === 5, 'All 5 initial collectible items mounted')

const keptShardEntry = manager.items.get('item-soul_shards-2-3')
const expectedWorld23 = gridToWorld(2, 3, openMaze)
assert(
  Math.abs(keptShardEntry.mesh.position.x - expectedWorld23.x) < 1e-6 &&
    Math.abs(keptShardEntry.mesh.position.z - expectedWorld23.z) < 1e-6,
  'Collectible mesh placed at canonical gridToWorld position'
)

const initialRotY = keptShardEntry.mesh.rotation.y
manager.update(0.25)
assert(keptShardEntry.mesh.rotation.y > initialRotY, 'Collectible rotates smoothly during update()')

// Collect item-soul_shards-2-2 while keeping remaining items
manager.syncItems(
  openMaze.collectibles.items.filter((c) => c.id !== 'item-soul_shards-2-2'),
  openMaze,
  { spawnBursts: true }
)
assert(manager.getCounts().items === 4, 'Collected item removed immediately')
assert(!manager.items.has('item-soul_shards-2-2'), 'Removed item ID deleted from manager')
assert(
  manager.items.get('item-soul_shards-2-3') === keptShardEntry,
  'Untouched item mesh preserved by stable ID without rebuild'
)
assert(manager.getCounts().bursts === 1, 'Removal spawned 1 procedural collection burst')
assert(manager.disposedMeshCount >= 1, 'Removed item mesh was disposed')

// Advance past burst duration (0.46s) to verify burst auto-disposal
manager.update(0.6)
assert(manager.getCounts().bursts === 0, 'Completed collection burst removed and disposed')
console.log('✓ Stable-ID reconciliation, rotation/bob animation, and burst disposal verified')

// 3. Survival collectible pickup lifecycle, clamping, rejection, and duplicate prevention
console.log('Test 3: Health Capsule, Energy Cell, Soul Shards & Rejection Lifecycle')
let reducerState = {
  difficulty: 'easy',
  seed: 777,
  maze: openMaze,
  playerPos: { row: 2, col: 1 },
  hasWon: false,
  isGameOver: false,
  health: 100,
  maxHealth: 100,
  battery: 100,
  maxBattery: 100,
  lastDirection: 'right',
  blockedBump: null,
  items: [...openMaze.collectibles.items],
  totalItems: openMaze.collectibles.items.length,
  itemsCollected: 0,
  shardsCollected: 0,
  totalShards: 2,
  shardBonus: 0,
  objectivesEnabled: false,
  keycards: [],
  totalKeys: 0,
  keysCollected: 0,
  isExitLocked: false,
  inventory: createInitialInventory(),
  activeEffects: createInitialActiveEffects(),
  echoPath: [],
  effects: [],
  eventCounter: 0,
  lastEvent: null,
}

// Re-sync manager cleanly to full reducer state
manager.syncState({
  maze: openMaze,
  items: reducerState.items,
  echoPath: reducerState.echoPath,
  spawnBursts: false,
  isReset: true,
})
assert(manager.getCounts().items === 5, 'Reset restores all 5 collectibles')

// 3a. Step onto Health Capsule at full HP -> rejected & item remains
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 1, col: 3 },
})
assert(
  reducerState.lastEvent?.type === 'item_pickup_rejected' &&
    reducerState.lastEvent?.reason === 'health_full',
  'Health Capsule rejected when health is full'
)
assert(
  reducerState.items.some((i) => i.id === 'item-health_capsule-1-3'),
  'Rejected Health Capsule remains in maze'
)

// Move off, take damage to 90 HP, step back onto Health Capsule -> restores 25% capped at 100
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 1, col: 2 },
})
reducerState = gameReducer(reducerState, { type: 'DAMAGE_PLAYER', damage: 10 })
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 1, col: 3 },
})
assert(reducerState.lastEvent?.type === 'item_collected', 'Damaged player collects Health Capsule')
assert(reducerState.health === 100, `Health clamped to maxHealth (got ${reducerState.health})`)
assert(
  !reducerState.items.some((i) => i.id === 'item-health_capsule-1-3'),
  'Collected Health Capsule removed'
)

// 3b. Step onto Energy Cell at full battery -> rejected & item remains
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 3, col: 2 },
})
assert(
  reducerState.lastEvent?.type === 'item_pickup_rejected' &&
    reducerState.lastEvent?.reason === 'battery_full',
  'Energy Cell rejected when battery is full'
)
assert(
  reducerState.items.some((i) => i.id === 'item-energy_cell-3-2'),
  'Rejected Energy Cell remains in maze'
)

// Drain battery to 50%, move off & step back -> restores +30% (to 80) and cannot exceed max
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 3, col: 1 },
  battery: 50,
  maxBattery: 100,
})
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 3, col: 2 },
  battery: 50,
  maxBattery: 100,
})
assert(reducerState.lastEvent?.type === 'item_collected', 'Drained battery collects Energy Cell')
assert(reducerState.battery === 80, `Energy Cell restores 30% battery (got ${reducerState.battery})`)
assert(
  !reducerState.items.some((i) => i.id === 'item-energy_cell-3-2'),
  'Collected Energy Cell removed'
)

// 3c. Collect Soul Shard at (2, 2) -> score increases, stepping back does not re-collect
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 2, col: 2 },
})
assert(reducerState.shardsCollected === 1 && reducerState.shardBonus > 0, 'Soul Shard increments count and bonus score')
const scoreAfterShard1 = reducerState.shardBonus
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 2, col: 1 },
})
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 2, col: 2 },
})
assert(reducerState.shardsCollected === 1 && reducerState.shardBonus === scoreAfterShard1, 'Collected Soul Shard cannot be collected twice')

// 3d. Collect Echo Reveal at (3, 3) -> enters inventory without auto-activating
reducerState = gameReducer(reducerState, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: 3, col: 3 },
})
assert(
  reducerState.inventory[COLLECTIBLE_TYPES.ECHO_REVEAL] === 1,
  'Echo Reveal added to inventory on pickup'
)
manager.syncItems(reducerState.items, openMaze, { spawnBursts: true })
assert(manager.getCounts().items === 1, 'CollectibleManager removes all 4 picked-up items, leaving 1 Soul Shard')
assert(manager.getCounts().bursts === 4, `Removed items spawned 4 bursts (got ${manager.getCounts().bursts})`)
console.log('✓ Survival collectible pickup, clamping, rejection, and manager sync verified')

// 4. Echo Reveal path creation, updating, and clearing
console.log('Test 4: Echo Reveal Breadcrumb Creation, Updates & Clearing')
reducerState = gameReducer(reducerState, {
  type: 'ACTIVATE_ABILITY',
  abilityType: COLLECTIBLE_TYPES.ECHO_REVEAL,
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
reducerState.inventory[COLLECTIBLE_TYPES.ECHO_REVEAL] = 1
reducerState = gameReducer(reducerState, {
  type: 'ACTIVATE_ABILITY',
  abilityType: COLLECTIBLE_TYPES.ECHO_REVEAL,
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
console.log('Test 5: Collectible, Rejection, Ability & Victory Audio Cues & Deduplication')
const mockAudio = createMockAudioContext()
const audio = new HorrorAudioEngine({
  createAudioContext: () => mockAudio.ctx,
  recordCueHistory: true,
})

// Locked before user gesture: no oscillators started
audio.handleGameEvent({
  id: 1,
  type: 'item_collected',
  item: { type: COLLECTIBLE_TYPES.SOUL_SHARDS },
})
assert(mockAudio.stats.oscillatorsStarted === 0, 'No audio nodes play prior to unlock()')

audio.unlock()
audio.clearCueHistory()
const oscAfterUnlock = mockAudio.stats.oscillatorsStarted

// Event ID 10: Soul Shard pickup; duplicate delivery with same ID MUST be ignored
assert(
  audio.handleGameEvent({
    id: 10,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.SOUL_SHARDS },
  }) === true
)
const oscAfterShard = mockAudio.stats.oscillatorsStarted
assert(oscAfterShard > oscAfterUnlock, 'Soul Shard pickup plays Web Audio oscillators')
assert(
  audio.handleGameEvent({
    id: 10,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.SOUL_SHARDS },
  }) === false,
  'Duplicate event ID is rejected'
)
assert(
  mockAudio.stats.oscillatorsStarted === oscAfterShard,
  'Duplicate event ID does not re-trigger Web Audio nodes'
)

// Health Capsule, Energy Cell & Echo Reveal pickups + Rejection cues
assert(
  audio.handleGameEvent({
    id: 11,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.HEALTH_CAPSULE },
  }) === true,
  'Health Capsule pickup triggers audio'
)
assert(
  audio.handleGameEvent({
    id: 12,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.ENERGY_CELL },
  }) === true,
  'Energy Cell pickup triggers audio'
)
assert(
  audio.handleGameEvent({
    id: 13,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.ECHO_REVEAL },
  }) === true,
  'Echo Reveal pickup triggers audio'
)
assert(
  audio.handleGameEvent({
    id: 14,
    type: 'item_pickup_rejected',
    item: { type: COLLECTIBLE_TYPES.HEALTH_CAPSULE },
    reason: 'health_full',
  }) === true,
  'Pickup rejection triggers audio'
)
assert(audio.handleGameEvent({ id: 15, type: 'echo_reveal_activated' }) === true)

const cues = audio.getCueHistory()
assert(
  cues.filter((c) => c.type === 'item_collected').length === 3,
  'Item pickup cue recorded for shard, health capsule & energy cell'
)
assert(
  cues.filter((c) => c.type === 'powerup_collected').length === 1,
  'Echo Reveal pickup cue recorded'
)
assert(
  cues.filter((c) => c.type === 'item_pickup_rejected').length === 1,
  'Rejected pickup cue recorded'
)
assert(
  cues.filter((c) => c.type === 'ability_activate').length === 1,
  'Echo Reveal ability activation cue recorded'
)

// Paused audio blocks oscillator playback cleanly
audio.setPaused(true)
const oscBeforePauseAttempt = mockAudio.stats.oscillatorsStarted
assert(
  audio.handleGameEvent({
    id: 16,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.SOUL_SHARDS },
  }) === false,
  'Paused audio suppresses collectible cue'
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
console.log('✓ Collectible, rejection, ability & victory audio cues and deduplication verified')

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

const mazeA = generateMaze({ difficulty: 'easy', seed: 1001 })
const mazeB = generateMaze({ difficulty: 'easy', seed: 2002 })

engine.setMaze(mazeA)
const cm = engine.getCollectibleManager()
assert(cm !== null, 'MazeSceneEngine exposes CollectibleManager')
assert(
  cm.getCounts().items === mazeA.collectibles.items.length,
  'setMaze mounts maze.collectibles items'
)

// Simulate pickup + RESET_RUN (items restored without burst)
const subsetItems = mazeA.collectibles.items.slice(1)
engine.syncCollectibles({
  items: subsetItems,
  echoPath: [mazeA.start, mazeA.exit],
  spawnBursts: true,
})
assert(cm.getCounts().items === subsetItems.length, 'Subset items synced cleanly')
assert(cm.getCounts().bursts === 1, 'Pickup spawns burst')
assert(cm.getCounts().echoMarkers === 2, 'Echo path markers mounted')

engine.resetCombat()
engine.syncCollectibles({
  items: mazeA.collectibles.items,
  echoPath: [],
  spawnBursts: false,
  isReset: true,
})
assert(
  cm.getCounts().items === mazeA.collectibles.items.length,
  'RESET_RUN restores all maze items without stale removals'
)
assert(cm.getCounts().echoMarkers === 0, 'RESET_RUN clears echo markers')

// Switch to mazeB (setMaze) -> no stale items from mazeA
engine.setMaze(mazeB)
const expectedMazeBItemIds = new Set(mazeB.collectibles.items.map((c) => c.id))
for (const id of cm.getItemIds()) {
  assert(expectedMazeBItemIds.has(id), `No stale item IDs remain after setMaze (found ${id})`)
}
assert(cm.getCounts().bursts === 0, 'setMaze clears active bursts')

// Switch to a 31x31 maze -> mounts allocated collectible distribution cleanly in items,
// and still preserves explicit STANDARD_COLLECTIBLE_SPAWN_COUNTS override compatibility
const hardcoreMaze = generateMaze({ difficulty: 'hardcore', seed: 3003 })
const expectedAllocatedTotal = hardcoreMaze.collectibleAllocation.totalTargetItems
assert(
  hardcoreMaze.collectibles.coins.length === 0 && hardcoreMaze.collectibles.powerUps.length === 0,
  'Legacy coins and powerUps arrays remain empty while all collectibles mount via items'
)
assert(
  hardcoreMaze.collectibleSelection?.activeCategoryCount === 8,
  '31x31 maze selects 8 active collectible categories (4 permanent + 4 optional)'
)
assert(
  hardcoreMaze.collectibles.items.length === expectedAllocatedTotal,
  `31x31 maze places all ${expectedAllocatedTotal} allocated collectible items`
)
for (const [type, expectedCount] of Object.entries(hardcoreMaze.collectibleAllocation.itemQuantities)) {
  const actualCount = hardcoreMaze.collectibles.items.filter((i) => i.type === type).length
  assert(
    actualCount === expectedCount,
    `31x31 maze places ${expectedCount} of ${type} in items (got ${actualCount})`
  )
}
const legacyOverridePlacement = placeCollectibles(hardcoreMaze, {
  spawnCounts: STANDARD_COLLECTIBLE_SPAWN_COUNTS,
})
const expectedLegacyTotal = Object.values(STANDARD_COLLECTIBLE_SPAWN_COUNTS).reduce((sum, n) => sum + n, 0)
assert(
  legacyOverridePlacement.items.length === expectedLegacyTotal,
  `Explicit spawnCounts override still places all ${expectedLegacyTotal} standard items`
)
engine.setMaze(hardcoreMaze)
assert(
  cm.getCounts().items === expectedAllocatedTotal,
  `CollectibleManager mounts all ${expectedAllocatedTotal} items cleanly`
)

// Disposal cleans manager and stops leaks
engine.dispose()
assert(cm.isDisposed === true, 'CollectibleManager disposed on engine.dispose()')
assert(engine.getCollectibleManager() === null, 'Engine clears CollectibleManager reference')
assert(engineAudioMock.stats.closeCount === 1, 'Engine closes owned AudioContext on dispose')

console.log('--- ALL 3D COLLECTIBLES, ECHO PATH & AUDIO TESTS PASSED! ---')
