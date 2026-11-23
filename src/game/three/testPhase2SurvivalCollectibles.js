import * as THREE from 'three'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { COLLECTIBLE_SPAWN_COUNTS } from '../generation/collectiblePlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { exploreReachableCells } from '../generation/pathfinder.js'
import {
  COLLECTIBLE_CONFIG,
  COLLECTIBLE_TYPES,
} from '../mechanics/collectiblesConfig.js'
import {
  buildMinimapSnapshot,
  createExplorationState,
  renderMinimapCanvas,
  revealAroundCell,
} from '../mechanics/minimap.js'
import {
  buildGameOverSummary,
  calculateRunScore,
  getShardBonusValue,
} from '../mechanics/scoring.js'
import { HAPTIC_PATTERNS, triggerHapticForGameEvent } from '../../utils/haptics.js'
import {
  COLLECTIBLE_PALETTE,
  buildCollectibleItemMesh,
  disposeCollectiblePools,
  getCollectiblePoolStats,
} from './buildCollectibles.js'
import { CollectibleManager } from './CollectibleManager.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
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
  function makeNode(extra = {}) {
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
    async resume() {
      stats.resumeCount += 1
      ctx.state = 'running'
    },
    async close() {
      stats.closeCount += 1
      ctx.state = 'closed'
    },
    createGain() {
      return makeNode({ gain: makeParam(1) })
    },
    createDynamicsCompressor() {
      return makeNode({
        threshold: makeParam(-24),
        knee: makeParam(30),
        ratio: makeParam(12),
      })
    },
    createBiquadFilter() {
      return makeNode({
        type: 'lowpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
      })
    },
    createOscillator() {
      return makeNode({
        type: 'sine',
        frequency: makeParam(440),
        onended: null,
        start() {
          stats.oscillatorsStarted += 1
        },
        stop() {
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
      return makeNode({
        buffer: null,
        loop: false,
        onended: null,
        start() {},
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

console.log('--- RUNNING PHASE 2 CORE SURVIVAL COLLECTIBLES VERIFICATION TESTS ---')

// ---------------------------------------------------------------------------
// 1. Spawn Quantities, Placement Validity & Overlap Prevention Across All Difficulties
// ---------------------------------------------------------------------------
console.log('Test 1: Difficulty Spawn Counts, BFS Reachability & Strict Non-Overlap')
const DEFERRED_TYPES = new Set([
  // All 10 collectibles are implemented across Phases 1-4
])

for (const difficulty of ['easy', 'medium', 'hard', 'hardcore']) {
  const expectedCounts = COLLECTIBLE_SPAWN_COUNTS[difficulty]
  const maze = generateMaze({ difficulty, seed: 424242 })
  const items = maze.collectibles?.items || []
  const reach = exploreReachableCells(maze.grid, maze.start)

  assert(
    Array.isArray(maze.collectibles?.coins) && maze.collectibles.coins.length === 0,
    `${difficulty}: legacy coins array remains retired and empty`
  )

  const countsByType = {}
  const occupiedKeys = new Set()
  const seenIds = new Set()
  const blockedKeys = new Set([
    `${maze.start.row},${maze.start.col}`,
    `${maze.exit.row},${maze.exit.col}`,
    ...(maze.hazards || []).map((h) => `${h.row},${h.col}`),
    ...(maze.hidingSpots || []).map((s) => `${s.row},${s.col}`),
    ...(maze.keycards || []).map((k) => `${k.row},${k.col}`),
  ])

  for (const item of items) {
    assert(
      !DEFERRED_TYPES.has(item.type),
      `${difficulty}: deferred collectible type "${item.type}" must not spawn in Phase 2`
    )
    countsByType[item.type] = (countsByType[item.type] || 0) + 1

    const key = `${item.row},${item.col}`
    assert(!seenIds.has(item.id), `${difficulty}: duplicate item id ${item.id}`)
    seenIds.add(item.id)

    assert(
      maze.grid[item.row]?.[item.col] === CELL_TYPES.PATH,
      `${difficulty}: item ${item.id} must be on a walkable PATH cell`
    )
    assert(
      reach.distances.has(key),
      `${difficulty}: item ${item.id} at (${key}) must be reachable from start via BFS`
    )
    assert(
      !blockedKeys.has(key),
      `${difficulty}: item ${item.id} must not overlap start, exit, hazard, hiding spot, or keycard`
    )
    assert(
      !occupiedKeys.has(key),
      `${difficulty}: item ${item.id} must not overlap another collectible`
    )
    occupiedKeys.add(key)
  }

  for (const type of [
    COLLECTIBLE_TYPES.HEALTH_CAPSULE,
    COLLECTIBLE_TYPES.ENERGY_CELL,
    COLLECTIBLE_TYPES.ECHO_REVEAL,
    COLLECTIBLE_TYPES.SOUL_SHARDS,
  ]) {
    assert(
      (countsByType[type] || 0) === expectedCounts[type],
      `${difficulty}: expected ${expectedCounts[type]} ${type}, got ${countsByType[type] || 0}`
    )
  }
}
console.log('✓ Spawn counts, BFS reachability, and zero overlaps verified for all 4 difficulties')

// ---------------------------------------------------------------------------
// 2. Health Capsule: 25% Restoration, Clamping, Full-Health Rejection & Immediate Use
// ---------------------------------------------------------------------------
console.log('Test 2: Health Capsule 25% Healing, Max Cap & Full-Health Rejection')
{
  const stateBase = createInitialGameState('medium', 9191)
  const healthItem = stateBase.items.find(
    (i) => i.type === COLLECTIBLE_TYPES.HEALTH_CAPSULE
  )
  assert(Boolean(healthItem), 'Medium maze contains Health Capsule')
  assert(
    COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.HEALTH_CAPSULE].restorePercent === 25,
    'Health Capsule configured for 25% max health restoration'
  )

  // Step onto Health Capsule while full -> rejected, stays in maze, not in inventory
  let s = gameReducer(stateBase, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: healthItem.row, col: healthItem.col },
  })
  assert(s.lastEvent?.type === 'item_pickup_rejected', 'Full health rejects Health Capsule')
  assert(s.lastEvent?.reason === 'health_full', 'Rejection reason is health_full')
  assert(s.health === 100, 'Full health stays 100')
  assert(
    s.items.some((i) => i.id === healthItem.id),
    'Rejected Health Capsule remains in maze'
  )
  assert(
    (s.inventory[COLLECTIBLE_TYPES.HEALTH_CAPSULE] || 0) === 0,
    'Health Capsule never enters inventory'
  )

  // Step away to start, suffer damage down to 50 HP, return to Health Capsule -> +25 HP = 75 HP
  s = gameReducer(s, { type: 'SYNC_PLAYER_CELL', position: stateBase.maze.start })
  s = gameReducer(s, { type: 'DAMAGE_PLAYER', damage: 50 })
  assert(s.health === 50, 'Damage reduces health to 50')

  s = gameReducer(s, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: healthItem.row, col: healthItem.col },
  })
  assert(s.lastEvent?.type === 'item_collected', 'Damaged player collects Health Capsule')
  assert(s.lastEvent?.healthRestored === 25, 'Restores exact 25% of 100 maxHealth (+25)')
  assert(s.health === 75, `Health updates to 75 (got ${s.health})`)
  assert(
    !s.items.some((i) => i.id === healthItem.id),
    'Collected Health Capsule disappears from items'
  )
  assert(
    (s.inventory[COLLECTIBLE_TYPES.HEALTH_CAPSULE] || 0) === 0,
    'Immediate activation does not add to inventory'
  )

  // Custom maxHealth scaling (80 maxHP -> +20 HP) & clamping (75 -> 80)
  const secondCapsule = s.items.find((i) => i.type === COLLECTIBLE_TYPES.HEALTH_CAPSULE)
  assert(Boolean(secondCapsule), 'Medium maze has 2nd Health Capsule')
  let scaledState = {
    ...s,
    health: 40,
    maxHealth: 80,
    playerPos: stateBase.maze.start,
  }
  scaledState = gameReducer(scaledState, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: secondCapsule.row, col: secondCapsule.col },
  })
  assert(scaledState.health === 60, `25% of 80 maxHealth restores 20 HP -> 60 (got ${scaledState.health})`)

  // Partial clamp test (90/100 + 25 -> 100/100)
  let clampState = createInitialGameState('easy', 1515, { health: 90, maxHealth: 100 })
  const easyCap = clampState.items.find((i) => i.type === COLLECTIBLE_TYPES.HEALTH_CAPSULE)
  clampState = gameReducer(clampState, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: easyCap.row, col: easyCap.col },
  })
  assert(clampState.health === 100, 'Health Capsule never exceeds maxHealth')
  assert(clampState.lastEvent?.healthRestored === 10, 'Partial heal reports actual +10 HP gained')

  // Stepping back onto cleared capsule cell cannot double-heal
  clampState = gameReducer(clampState, { type: 'DAMAGE_PLAYER', damage: 40 })
  clampState = gameReducer(clampState, { type: 'SYNC_PLAYER_CELL', position: clampState.maze.start })
  clampState = gameReducer(clampState, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: easyCap.row, col: easyCap.col },
  })
  assert(clampState.health === 60, 'Collected Health Capsule cannot be picked up a second time')
}
console.log('✓ Health Capsule 25% restoration, clamping, rejection, and single-use verified')

// ---------------------------------------------------------------------------
// 3. Energy Cell: 30% Restoration, Clamping, Full-Battery Rejection & Engine Flashlight Sync
// ---------------------------------------------------------------------------
console.log('Test 3: Energy Cell 30% Battery Restoration, Full-Battery Rejection & Flashlight Sync')
{
  assert(
    COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ENERGY_CELL].restorePercent === 30,
    'Energy Cell configured for 30% max battery restoration'
  )

  const stateBase = createInitialGameState('medium', 9292)
  const cellA = stateBase.items.find((i) => i.type === COLLECTIBLE_TYPES.ENERGY_CELL)
  assert(Boolean(cellA), 'Medium maze contains Energy Cell')

  // Full battery -> rejected
  let s = gameReducer(stateBase, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: cellA.row, col: cellA.col },
    battery: 100,
    maxBattery: 100,
  })
  assert(s.lastEvent?.type === 'item_pickup_rejected', 'Full battery rejects Energy Cell')
  assert(s.lastEvent?.reason === 'battery_full', 'Rejection reason is battery_full')
  assert(s.items.some((i) => i.id === cellA.id), 'Rejected Energy Cell remains in maze')
  assert(
    (s.inventory[COLLECTIBLE_TYPES.ENERGY_CELL] || 0) === 0,
    'Energy Cell never enters inventory'
  )

  // Drain battery in MazeSceneEngine to 0 -> flashlight shuts off -> collect Energy Cell -> restores 30% -> flashlight turns back ON cleanly
  const engine = createHeadlessEngine()
  engine.setMaze(stateBase.maze)
  engine.toggleFlashlight()
  engine.setBattery(0)
  assert(engine.getFlashlightState().active === false, 'Empty battery switches flashlight OFF')
  assert(engine.spotlight.visible === false, 'Spotlight hides at 0 battery')

  s = gameReducer(s, {
    type: 'SYNC_PLAYER_CELL',
    position: stateBase.maze.start,
    battery: 0,
    maxBattery: 100,
  })
  s = gameReducer(s, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: cellA.row, col: cellA.col },
    battery: engine.getFlashlightState().battery,
    maxBattery: engine.getFlashlightState().maxBattery,
  })
  assert(s.lastEvent?.type === 'item_collected', 'Depleted battery collects Energy Cell')
  assert(s.battery === 30, `30% of 100 battery restores to 30 (got ${s.battery})`)
  assert(s.lastEvent?.batteryRestored === 30, 'Event reports batteryRestored === 30')
  assert(!s.items.some((i) => i.id === cellA.id), 'Collected Energy Cell disappears')

  // Apply Viewport battery sync contract (engineRef.current?.setBattery(lastEvent.battery))
  engine.setBattery(s.lastEvent.battery)
  assert(engine.getFlashlightState().battery === 30, 'Engine battery synchronized to 30')
  const relit = engine.toggleFlashlight()
  assert(relit === true && engine.spotlight.visible === true, 'Flashlight can relight immediately after Energy Cell')

  // Clamp at maxBattery (e.g. 85 + 30 -> 100) + engine.restoreBattery clamp
  const cellB = s.items.find((i) => i.type === COLLECTIBLE_TYPES.ENERGY_CELL)
  s = gameReducer(s, {
    type: 'SYNC_PLAYER_CELL',
    position: stateBase.maze.start,
    battery: 85,
    maxBattery: 100,
  })
  s = gameReducer(s, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: cellB.row, col: cellB.col },
    battery: 85,
    maxBattery: 100,
  })
  assert(s.battery === 100, 'Energy Cell battery clamped at maxBattery 100')
  assert(s.lastEvent?.batteryRestored === 15, 'Partial recharge reports +15 gained')

  engine.setBattery(85)
  engine.restoreBattery(30)
  assert(engine.getFlashlightState().battery === 100, 'Engine restoreBattery clamps cleanly at maxBattery')
  engine.dispose()
}
console.log('✓ Energy Cell 30% battery recharge, clamping, rejection, and flashlight sync verified')

// ---------------------------------------------------------------------------
// 4. Soul Shards: Bonus Score Across Difficulties, Duplicate Prevention & Preserved Scoring Rules
// ---------------------------------------------------------------------------
console.log('Test 4: Soul Shards Bonus Scoring Across Difficulties & Duplicate Prevention')
{
  const expectedPerShard = {
    easy: 100,
    medium: 125,
    hard: 150,
    hardcore: 200,
  }

  for (const [difficulty, perShard] of Object.entries(expectedPerShard)) {
    assert(
      getShardBonusValue(difficulty) === perShard,
      `${difficulty}: shard score delta should be ${perShard}`
    )
    let state = createInitialGameState(difficulty, 3131)
    const shards = state.items.filter((i) => i.type === COLLECTIBLE_TYPES.SOUL_SHARDS)
    assert(shards.length >= 6, `${difficulty}: multiple shards placed (${shards.length})`)
    assert(state.totalShards === shards.length, `${difficulty}: totalShards matches spawned shards`)

    // Collect first 3 shards
    for (let idx = 0; idx < 3; idx += 1) {
      const shard = shards[idx]
      state = gameReducer(state, {
        type: 'SYNC_PLAYER_CELL',
        position: { row: shard.row, col: shard.col },
      })
      assert(state.lastEvent?.type === 'item_collected', `Shard #${idx + 1} emits item_collected`)
      assert(state.lastEvent?.scoreDelta === perShard, `Shard #${idx + 1} scoreDelta === ${perShard}`)
    }
    assert(state.shardsCollected === 3, `${difficulty}: 3 shards collected`)
    assert(state.shardBonus === perShard * 3, `${difficulty}: shardBonus === ${perShard * 3}`)

    // Re-stepping onto an already collected shard never duplicates score
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', position: state.maze.start })
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: shards[0].row, col: shards[0].col },
    })
    assert(state.shardsCollected === 3, 'Collected shard cannot increment shardsCollected twice')
    assert(state.shardBonus === perShard * 3, 'Collected shard cannot increment shardBonus twice')

    // Verify calculateRunScore adds shardBonus cleanly without altering star rating or unrelated bonuses
    const baseScoreResult = calculateRunScore({
      difficulty,
      maze: state.maze,
      completionTimeMs: 20000,
      shardsCollected: 0,
      totalShards: state.totalShards,
      health: 100,
      maxHealth: 100,
      keysCollected: state.totalKeys,
      totalKeys: state.totalKeys,
      objectivesEnabled: true,
    })
    const withShardsResult = calculateRunScore({
      difficulty,
      maze: state.maze,
      completionTimeMs: 20000,
      shardsCollected: 3,
      totalShards: state.totalShards,
      health: 100,
      maxHealth: 100,
      keysCollected: state.totalKeys,
      totalKeys: state.totalKeys,
      objectivesEnabled: true,
    })
    assert(
      withShardsResult.breakdown.shardBonus === perShard * 3,
      `${difficulty}: calculateRunScore breakdown.shardBonus === ${perShard * 3}`
    )
    assert(
      withShardsResult.score - baseScoreResult.score === perShard * 3,
      `${difficulty}: shard score addition leaves base/time/health/keycard rules untouched`
    )
    assert(
      withShardsResult.stars === baseScoreResult.stars,
      `${difficulty}: unrelated star rating rules unchanged`
    )

    const overSummary = buildGameOverSummary({
      runId: state.runId,
      survivalTimeMs: 12000,
      moves: state.moves,
      shardsCollected: state.shardsCollected,
      totalShards: state.totalShards,
      keysCollected: state.keysCollected,
      totalKeys: state.totalKeys,
      objectivesEnabled: true,
    })
    assert(
      overSummary.shardsCollected === 3 && overSummary.totalShards === shards.length,
      `${difficulty}: buildGameOverSummary preserves shard counts`
    )
  }
}
console.log('✓ Soul Shards bonus score, duplicate prevention, and scoring compatibility verified')

// ---------------------------------------------------------------------------
// 5. Minimap Snapshot & Canvas Icon Rendering (Fog-of-War + Distinct Visuals)
// ---------------------------------------------------------------------------
console.log('Test 5: Minimap Discovery & Distinct Survival Collectible Icons')
{
  const maze = generateMaze({ difficulty: 'easy', seed: 5555 })
  const exploration = createExplorationState(maze)
  const snapshotBefore = buildMinimapSnapshot({
    maze,
    exploration,
    playerCell: maze.start,
    items: maze.collectibles.items,
  })
  const unexploredItem = maze.collectibles.items.find(
    (item) => !snapshotBefore.items.some((v) => v.id === item.id)
  )
  assert(Boolean(unexploredItem), 'Undiscovered items are hidden by fog of war on minimap')

  // Discover one of each survival type + echo_reveal
  for (const item of maze.collectibles.items) {
    revealAroundCell(exploration, maze, { row: item.row, col: item.col })
  }

  const drawOps = { fillRects: [], diamonds: 0, arcs: 0 }
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    setTransform() {},
    fillRect(x, y, w, h) {
      drawOps.fillRects.push({ x, y, w, h, fillStyle: String(ctx.fillStyle).toLowerCase() })
    },
    strokeRect(x, y, w, h) {
      drawOps.fillRects.push({ x, y, w, h, strokeStyle: String(ctx.strokeStyle).toLowerCase(), strokeOnly: true })
    },
    beginPath() {},
    arc() {
      drawOps.arcs += 1
    },
    moveTo() {},
    lineTo() {},
    closePath() {
      drawOps.diamonds += 1
    },
    fill() {},
    stroke() {},
  }
  const fakeCanvas = {
    width: 144,
    height: 144,
    getContext: () => ctx,
  }
  renderMinimapCanvas(fakeCanvas, {
    maze,
    exploration,
    playerCell: maze.start,
    items: maze.collectibles.items,
    logicalSize: 144,
    dpr: 1,
  })

  assert(
    drawOps.fillRects.some((op) => op.fillStyle === '#f43f5e'),
    'Minimap draws crimson cross rects (#f43f5e) for Health Capsule'
  )
  assert(
    drawOps.fillRects.some((op) => op.fillStyle === '#10b981') &&
      drawOps.fillRects.some((op) => op.fillStyle === '#fbbf24'),
    'Minimap draws emerald body (#10b981) + gold terminal (#fbbf24) for Energy Cell'
  )
  assert(drawOps.diamonds >= 1, 'Minimap draws polygon path for Soul Shards / player')
}
console.log('✓ Minimap fog-of-war filtering and distinct icons verified')

// ---------------------------------------------------------------------------
// 6. Haptics, Audio Cues, Distinct 3D Meshes, Cleanup & Regression Checks
// ---------------------------------------------------------------------------
console.log('Test 6: Haptics, Audio Cues, 3D Visuals, Cleanup & Regressions')
{
  const vibrated = []
  const mockNav = {
    vibrate(pattern) {
      vibrated.push(pattern)
      return true
    },
  }
  triggerHapticForGameEvent(
    { id: 1, type: 'item_collected', item: { type: COLLECTIBLE_TYPES.HEALTH_CAPSULE } },
    { navigator: mockNav }
  )
  triggerHapticForGameEvent(
    { id: 2, type: 'item_collected', item: { type: COLLECTIBLE_TYPES.SOUL_SHARDS } },
    { navigator: mockNav }
  )
  triggerHapticForGameEvent(
    { id: 3, type: 'item_collected', item: { type: COLLECTIBLE_TYPES.ENERGY_CELL } },
    { navigator: mockNav }
  )
  triggerHapticForGameEvent(
    { id: 4, type: 'item_pickup_rejected', item: { type: COLLECTIBLE_TYPES.HEALTH_CAPSULE } },
    { navigator: mockNav }
  )
  assert(vibrated[0] === HAPTIC_PATTERNS.ABILITY, 'Health Capsule uses ABILITY haptic')
  assert(
    JSON.stringify(vibrated[1]) === JSON.stringify(HAPTIC_PATTERNS.SHARD),
    'Soul Shard uses SHARD haptic pattern'
  )
  assert(vibrated[2] === HAPTIC_PATTERNS.ABILITY, 'Energy Cell uses ABILITY haptic')
  assert(vibrated[3] === HAPTIC_PATTERNS.REJECTED, 'Rejected pickup uses REJECTED haptic')

  const mockAudio = createMockAudioContext()
  const audio = new HorrorAudioEngine({
    audioContext: mockAudio.ctx,
    autoUnlock: true,
    recordCueHistory: true,
  })
  audio.handleGameEvent({
    id: 201,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.HEALTH_CAPSULE },
  })
  audio.handleGameEvent({
    id: 202,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.SOUL_SHARDS },
    shardsCollected: 2,
  })
  audio.handleGameEvent({
    id: 203,
    type: 'item_collected',
    item: { type: COLLECTIBLE_TYPES.ENERGY_CELL },
  })
  audio.handleGameEvent({
    id: 204,
    type: 'item_pickup_rejected',
    item: { type: COLLECTIBLE_TYPES.ENERGY_CELL },
    reason: 'battery_full',
  })
  const history = audio.getCueHistory()
  assert(history.filter((c) => c.type === 'item_collected').length === 3, 'Audio records all 3 pickup cues')
  assert(history.filter((c) => c.type === 'item_pickup_rejected').length === 1, 'Audio records rejection cue')
  assert(mockAudio.stats.oscillatorsStarted >= 9, 'Synthesizer plays multi-oscillator collectible cues')
  audio.dispose()

  // Distinct 3D meshes & clean disposal
  disposeCollectiblePools()
  const mHealth = buildCollectibleItemMesh({ id: 'h1', type: COLLECTIBLE_TYPES.HEALTH_CAPSULE, row: 1, col: 1 })
  const mShard = buildCollectibleItemMesh({ id: 's1', type: COLLECTIBLE_TYPES.SOUL_SHARDS, row: 1, col: 2 })
  const mEnergy = buildCollectibleItemMesh({ id: 'e1', type: COLLECTIBLE_TYPES.ENERGY_CELL, row: 1, col: 3 })
  assert(mHealth.userData.accentColor === COLLECTIBLE_PALETTE.healthPrimary)
  assert(mShard.userData.accentColor === COLLECTIBLE_PALETTE.soulPrimary)
  assert(mEnergy.userData.accentColor === COLLECTIBLE_PALETTE.energyPrimary)

  const maze = generateMaze({ difficulty: 'easy', seed: 7070 })
  const scene = new THREE.Scene()
  const cm = new CollectibleManager(scene)
  cm.syncState({ maze, items: maze.collectibles.items, keycards: maze.keycards, spawnBursts: false, isReset: true })
  cm.update(0.1)
  cm.syncItems([], maze, { spawnBursts: true })
  assert(cm.getCounts().items === 0 && cm.getCounts().bursts === maze.collectibles.items.length, 'Burst particles spawned for every removed item')
  cm.update(0.6)
  assert(cm.getCounts().bursts === 0, 'Burst particles parked/cleaned up cleanly')
  cm.dispose()
  assert(scene.children.length === 0, 'CollectibleManager removes rootGroup from scene on dispose')
  disposeCollectiblePools()
  assert(getCollectiblePoolStats().geometries === 0 && getCollectiblePoolStats().materials === 0, 'Shared collectible pools clear completely')

  // Regression check: Keycard gate lock & Echo Reveal unaffected
  let regState = createInitialGameState('easy', 7070, { objectivesEnabled: true })
  assert(regState.isExitLocked === true && regState.keycards.length === 1, 'Keycard & Exit lock intact')
  const echoItem = regState.items.find((i) => i.type === COLLECTIBLE_TYPES.ECHO_REVEAL)
  assert(Boolean(echoItem), 'Echo Reveal collectible present')
  regState = gameReducer(regState, { type: 'SYNC_PLAYER_CELL', position: { row: echoItem.row, col: echoItem.col } })
  assert(regState.inventory[COLLECTIBLE_TYPES.ECHO_REVEAL] === 1, 'Echo Reveal still uses inventory')
  regState = gameReducer(regState, { type: 'ACTIVATE_ABILITY', abilityType: COLLECTIBLE_TYPES.ECHO_REVEAL })
  assert(regState.echoPath.length > 0, 'Echo Reveal pathfinding works')
  regState = gameReducer(regState, { type: 'SYNC_PLAYER_CELL', position: regState.maze.exit })
  assert(regState.hasWon === false && regState.lastEvent?.type === 'locked_exit', 'Locked exit still blocks premature win')
  const kc = regState.keycards[0]
  regState = gameReducer(regState, { type: 'SYNC_PLAYER_CELL', position: { row: kc.row, col: kc.col } })
  assert(regState.isExitLocked === false && regState.lastEvent?.type === 'gate_unlocked', 'Keycard unlocks exit gate')
  regState = gameReducer(regState, { type: 'SYNC_PLAYER_CELL', position: regState.maze.exit })
  assert(regState.hasWon === true, 'Unlocked exit completes run')
}
console.log('✓ Haptics, audio, 3D visuals, pool cleanup, and regression checks verified')
console.log('--- ALL PHASE 2 CORE SURVIVAL COLLECTIBLES TESTS PASSED! ---')
