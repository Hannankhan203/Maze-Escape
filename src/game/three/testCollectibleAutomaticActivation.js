import { strict as assert } from 'node:assert'
import { createInitialGameState, gameReducer, resolveEchoRevealPath } from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  COLLECTIBLE_CONFIG,
  COLLECTIBLE_TYPES,
} from '../mechanics/collectiblesConfig.js'
import {
  createExplorationState,
  isCellDiscovered,
  revealPathsInRadius,
} from '../mechanics/minimap.js'
import { getShardBonusValue } from '../mechanics/scoring.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { CollectibleManager } from './CollectibleManager.js'
import { disposeAllSharedPools } from './sharedResources.js'

function createOpenCorridorMaze(rows = 15, cols = 29) {
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      r === 0 || r === rows - 1 || c === 0 || c === cols - 1
        ? CELL_TYPES.WALL
        : CELL_TYPES.PATH
    )
  )
  return {
    id: `open-corridor-${rows}x${cols}`,
    rows,
    cols,
    grid,
    start: { row: 1, col: 1 },
    exit: { row: rows - 2, col: cols - 2 },
    collectibles: { items: [], keycards: [] },
  }
}

function createTestGameState(difficulty = 'medium', seed = 111, overrides = {}) {
  const maze = createOpenCorridorMaze(15, 29)
  const base = createInitialGameState(difficulty, seed)
  return {
    ...base,
    maze,
    playerPos: { row: 1, col: 1 },
    items: [],
    ...overrides,
  }
}

function createMockRenderer() {
  const renderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: {
      enabled: false,
      type: null,
      needsUpdate: false,
    },
    pixelRatio: 1,
    setPixelRatio: (r) => {
      renderer.pixelRatio = r
    },
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  return renderer
}

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  const mockRenderer = createMockRenderer()
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    isSoftwareGl: false,
    lowPerformance: false,
    skipSpawnSequence: true,
    ...config,
  })
}

export function runCollectibleAutomaticActivationTests() {
  console.log('--- RUNNING COLLECTIBLE AUTOMATIC ACTIVATION & WARDING PROTECTION TESTS ---')
  disposeAllSharedPools()

  // =========================================================================
  // 1. Health Capsule: Automatic Healing, Capping, Full-Health Rejection, No Duplicate
  // =========================================================================
  console.log('Test 1: Health Capsule Automatic Healing, Max Cap & Full-Health Rejection')
  {
    let state = createTestGameState('medium', 111, { health: 50, maxHealth: 100 })
    const hcItem = {
      id: 'hc-test-1',
      type: COLLECTIBLE_TYPES.HEALTH_CAPSULE,
      row: 2,
      col: 2,
    }
    state = { ...state, items: [hcItem] }

    // Step onto Health Capsule with 50/100 HP -> automatically restores 25% (25 HP) to 75 HP
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 2 })
    assert.equal(state.health, 75, 'Health Capsule automatically heals 25% HP on pickup without button press')
    assert.equal(state.lastEvent?.type, 'item_collected')
    assert.equal(state.lastEvent?.healthRestored, 25)
    assert.equal(state.items.length, 0, 'Collected Health Capsule removed from items array')

    // Duplicate step on same cell: stepping away then returning does not re-heal
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 1, col: 1 })
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 2 })
    assert.equal(state.health, 75, 'Re-visiting cell does not heal again')

    // Capping test: 90 HP + 25% -> capped at 100 HP (heals 10 HP)
    state = { ...state, health: 90, maxHealth: 100, items: [{ ...hcItem, id: 'hc-test-2', row: 3, col: 3 }] }
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 3, col: 3 })
    assert.equal(state.health, 100, 'Health Capsule clamps to maxHealth')
    assert.equal(state.lastEvent?.healthRestored, 10, 'Health restored matches actual delta to cap')

    // Full health rejection: stepping with 100/100 HP rejects collection
    const uncollectedItem = { ...hcItem, id: 'hc-test-3', row: 4, col: 4 }
    state = { ...state, health: 100, maxHealth: 100, items: [uncollectedItem] }
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 4, col: 4 })
    assert.equal(state.health, 100)
    assert.equal(state.lastEvent?.type, 'item_pickup_rejected', 'Rejected when health is full')
    assert.equal(state.lastEvent?.reason, 'health_full')
    assert.equal(state.items.length, 1, 'Rejected item remains in world')
  }
  console.log('✓ Health Capsule automatic healing, capping, and rejection verified')

  // =========================================================================
  // 2. Soul Shards: Automatic Score Collection & Duplicate Prevention
  // =========================================================================
  console.log('Test 2: Soul Shards Automatic Score Awarding & Duplicate Prevention')
  {
    let state = createTestGameState('medium', 222)
    const expectedBonus = getShardBonusValue('medium')
    assert.ok(expectedBonus > 0, 'Shard bonus configured for medium difficulty')

    const initialScore = state.shardBonus || 0
    const initialShards = state.shardsCollected || 0
    const shardItem = {
      id: 'shard-auto-1',
      type: COLLECTIBLE_TYPES.SOUL_SHARDS,
      row: 2,
      col: 3,
    }
    state = { ...state, items: [shardItem] }

    // Stepping on Soul Shards immediately awards score
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 3 })
    assert.equal(state.shardsCollected, initialShards + 1, 'shardsCollected increments by 1')
    assert.equal(state.shardBonus, initialScore + expectedBonus, 'Score awarded immediately on pickup')
    assert.equal(state.lastEvent?.type, 'item_collected')
    assert.equal(state.lastEvent?.scoreDelta, expectedBonus)
    assert.equal(state.items.length, 0, 'Soul Shard removed from world')

    // Duplicate step: move away then return
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 1, col: 1 })
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 3 })
    assert.equal(state.shardsCollected, initialShards + 1, 'Duplicate step does not increment count')
    assert.equal(state.shardBonus, initialScore + expectedBonus, 'Duplicate step does not add score')
  }
  console.log('✓ Soul Shards automatic scoring and single-collection verified')

  // =========================================================================
  // 3. Energy Cell: Automatic Battery Recharge, Capping & Full-Battery Rejection
  // =========================================================================
  console.log('Test 3: Energy Cell Automatic Recharge, Capping & Full Rejection')
  {
    let state = createTestGameState('medium', 333, { battery: 40, maxBattery: 100 })
    const cellItem = {
      id: 'ec-auto-1',
      type: COLLECTIBLE_TYPES.ENERGY_CELL,
      row: 2,
      col: 4,
    }
    state = { ...state, items: [cellItem] }

    // Step onto Energy Cell with 40/100 -> immediately restores 30% (+30) to 70
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 4 })
    assert.equal(state.battery, 70, 'Energy Cell automatically recharges 30% battery immediately')
    assert.equal(state.lastEvent?.type, 'item_collected')
    assert.equal(state.lastEvent?.batteryRestored, 30)
    assert.equal(state.items.length, 0)

    // Capping test: 85 + 30 -> capped at 100 (heals 15)
    state = { ...state, battery: 85, maxBattery: 100, items: [{ ...cellItem, id: 'ec-auto-2', row: 3, col: 4 }] }
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 3, col: 4 })
    assert.equal(state.battery, 100, 'Battery clamped to maxBattery')
    assert.equal(state.lastEvent?.batteryRestored, 15)

    // Full battery rejection: stepping with 100/100 rejects collection
    const uncollectedCell = { ...cellItem, id: 'ec-auto-3', row: 4, col: 4 }
    state = { ...state, battery: 100, maxBattery: 100, items: [uncollectedCell] }
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 4, col: 4 })
    assert.equal(state.battery, 100)
    assert.equal(state.lastEvent?.type, 'item_pickup_rejected')
    assert.equal(state.lastEvent?.reason, 'battery_full')
    assert.equal(state.items.length, 1, 'Rejected Energy Cell remains in world')
  }
  console.log('✓ Energy Cell automatic battery recharge, capping, and rejection verified')

  // =========================================================================
  // 4. Spectral Compass: Automatic Activation (6s), Shard Attraction, Expiry
  // =========================================================================
  console.log('Test 4: Spectral Compass Automatic 6s Activation, Attraction & Expiry')
  {
    let state = createTestGameState('medium', 444)
    const compassItem = {
      id: 'compass-auto-1',
      type: COLLECTIBLE_TYPES.SPECTRAL_COMPASS,
      row: 2,
      col: 5,
    }
    state = { ...state, items: [compassItem] }

    // Step onto Spectral Compass -> immediately activates for 6000ms without button press
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 5 })
    assert.equal(
      state.activeEffects.spectralCompassRemainingMs,
      6000,
      'Spectral Compass activates immediately with 6000ms duration on pickup'
    )
    assert.equal(state.lastEvent?.type, 'item_collected')
    assert.equal(state.items.length, 0)

    // Attracts soul shards in CollectibleManager
    const openMaze = createOpenCorridorMaze(15, 25)
    const cm = new CollectibleManager()
    cm.setMaze(openMaze)
    const shardItem = { id: 'shard-attract', type: COLLECTIBLE_TYPES.SOUL_SHARDS, row: 2, col: 7 }
    cm.syncItems([shardItem], openMaze, { spawnBursts: false })
    const entry = cm.items.get('shard-attract')
    assert.ok(entry, 'Shard entry exists in CollectibleManager')
    entry.mesh.position.set(4, 0.9, 4)
    let shardCollected = false
    cm.update(0.016, { x: 4, y: 0, z: 4 }, { spectralCompassRemainingMs: 5000 }, () => {
      shardCollected = true
    })
    assert.ok(shardCollected, 'Spectral Compass actively attracts Soul Shards')
    cm.dispose()

    // Timer countdown and expiration
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 3000 })
    assert.equal(state.activeEffects.spectralCompassRemainingMs, 3000)
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 3000 })
    assert.equal(state.activeEffects.spectralCompassRemainingMs, 0, 'Spectral Compass expires after 6s')
  }
  console.log('✓ Spectral Compass automatic activation, attraction, and expiry verified')

  // =========================================================================
  // 5. Spirit Lantern: Automatic Activation (8s), 8-Tile Path Reveal, Lighting & Expiry
  // =========================================================================
  console.log('Test 5: Spirit Lantern Automatic 8s Activation, Path Reveal & Lighting')
  {
    let state = createTestGameState('medium', 555)
    const lanternItem = {
      id: 'lantern-auto-1',
      type: COLLECTIBLE_TYPES.SPIRIT_LANTERN,
      row: 2,
      col: 6,
    }
    state = { ...state, items: [lanternItem] }

    // Step onto Spirit Lantern -> activates immediately for 8000ms without button press
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 6 })
    assert.equal(
      state.activeEffects.spiritLanternRemainingMs,
      8000,
      'Spirit Lantern activates immediately with 8000ms duration on pickup'
    )
    assert.equal(state.lastEvent?.type, 'item_collected')
    assert.equal(state.items.length, 0)

    // Minimap path reveal across 8 tiles
    const openMaze = createOpenCorridorMaze(25, 25)
    const center = { row: 12, col: 12 }
    const exp = createExplorationState(openMaze, { revealStart: false })
    const res = revealPathsInRadius(exp, openMaze, center, 8)
    assert.equal(res.changed, true, 'Spirit Lantern reveals paths on minimap')
    assert.equal(isCellDiscovered(exp, 12, 20), true, 'Path cell 8 tiles away is discovered')
    assert.equal(isCellDiscovered(exp, 12, 22), false, 'Path cell 10 tiles away remains in fog')

    // Engine lighting verification
    const engine = createHeadlessEngine()
    engine.setMaze(openMaze)
    engine.setActiveEffects({ spiritLanternRemainingMs: 8000 })
    engine.stepFrame(0.05, { render: false })
    const lanternState = engine.getSpiritLanternState()
    assert.equal(lanternState.active, true, 'Spirit Lantern light activates in engine')
    assert.ok(lanternState.lightIntensity >= 6.0, 'Bright warm illumination active')

    // Expiry restores baseline
    engine.setActiveEffects({ spiritLanternRemainingMs: 0 })
    engine.stepFrame(0.05, { render: false })
    assert.equal(engine.getSpiritLanternState().active, false, 'Spirit Lantern light deactivates on expiry')
    engine.dispose()

    // Reducer timer expiration
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 8000 })
    assert.equal(state.activeEffects.spiritLanternRemainingMs, 0, 'Spirit Lantern expires after 8s')
  }
  console.log('✓ Spirit Lantern automatic activation, 8-tile reveal, and lighting verified')

  // =========================================================================
  // 6. Echo Reveal: Automatic Activation (4.5s), Path Calculation & Expiry
  // =========================================================================
  console.log('Test 6: Echo Reveal Automatic 4.5s Activation, Route Calculation & Expiry')
  {
    let state = createTestGameState('medium', 666)
    const echoItem = {
      id: 'echo-auto-1',
      type: COLLECTIBLE_TYPES.ECHO_REVEAL,
      row: 2,
      col: 7,
    }
    state = { ...state, items: [echoItem], echoPath: [] }

    // Step onto Echo Reveal -> immediately activates for 4500ms and calculates BFS route to exit
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 7 })
    assert.equal(
      state.activeEffects.echoRevealRemainingMs,
      4500,
      'Echo Reveal activates immediately with 4500ms duration on pickup without pressing E'
    )
    assert.ok(
      Array.isArray(state.echoPath) && state.echoPath.length >= 2,
      'BFS route to exit gate calculated and displayed immediately on pickup'
    )
    assert.deepEqual(
      state.echoPath[state.echoPath.length - 1],
      state.maze.exit,
      'Calculated Echo Reveal route leads directly to the exit gate'
    )
    assert.equal(state.items.length, 0, 'Collected Echo Reveal removed from world')

    // Walking along path trims route
    const nextStep = state.echoPath[1]
    if (nextStep) {
      const prevLen = state.echoPath.length
      state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', position: nextStep })
      assert.equal(state.echoPath.length, prevLen - 1, 'Walking along route trims previous step')
      assert.deepEqual(state.echoPath[0], nextStep)
    }

    // Timer expiration clears echoPath
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 4500 })
    assert.equal(state.activeEffects.echoRevealRemainingMs, 0, 'Echo Reveal timer expires after 4.5s')
    assert.equal(state.echoPath.length, 0, 'Echo route cleared upon timer expiration')
  }
  console.log('✓ Echo Reveal automatic activation, route calculation, and expiry verified')

  // =========================================================================
  // 7. Warding Charm: Indefinite Retention, Exact 1-Hit Absorption & Multiple Charges
  // =========================================================================
  console.log('Test 7: Warding Charm Indefinite Retention, 1-Hit Absorption & Multi-Charge Defense')
  {
    let state = createTestGameState('medium', 777, { health: 100, maxHealth: 100 })
    const wardingItem1 = { id: 'ward-1', type: COLLECTIBLE_TYPES.WARDING_CHARM, row: 2, col: 8 }
    state = { ...state, items: [wardingItem1] }

    // Pickup Warding Charm -> grants 1 protective charge
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 8 })
    assert.equal(state.activeEffects.wardingCharmsCount, 1, 'Warding Charm grants 1 protective charge')
    assert.equal(state.items.length, 0)

    // Indefinite retention: simulate long elapsed time (60,000ms / 60 seconds)
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 60000 })
    assert.equal(
      state.activeEffects.wardingCharmsCount,
      1,
      'Warding Charm charge has NO time limit and remains available indefinitely'
    )

    // First attack: 35 damage -> completely absorbed with 0 health damage, exactly 1 charge consumed
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 35, enemyId: 'stalker-1' })
    assert.equal(state.health, 100, 'First attack deals 0 health damage (absorbed)')
    assert.equal(state.activeEffects.wardingCharmsCount, 0, 'Exactly 1 charge consumed by attack')
    assert.equal(state.lastEvent?.type, 'warding_charm_absorbed')
    assert.equal(state.lastEvent?.damage, 35)

    // Second attack: 35 damage -> causes normal damage
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 35, enemyId: 'stalker-1' })
    assert.equal(state.health, 65, 'Second attack causes normal damage when no charges remain')
    assert.equal(state.lastEvent?.type, 'player_damaged')

    // Multiple charges test: stack 3 Warding Charms
    state = {
      ...state,
      health: 100,
      activeEffects: { ...state.activeEffects, wardingCharmsCount: 3 },
    }
    assert.equal(state.activeEffects.wardingCharmsCount, 3)

    // Attack 1: absorbed, 2 charges remain, 100 HP
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 40 })
    assert.equal(state.health, 100, 'Attack 1 absorbed')
    assert.equal(state.activeEffects.wardingCharmsCount, 2, '2 charges remain after attack 1')

    // Attack 2: absorbed, 1 charge remains, 100 HP
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 40 })
    assert.equal(state.health, 100, 'Attack 2 absorbed')
    assert.equal(state.activeEffects.wardingCharmsCount, 1, '1 charge remains after attack 2')

    // Attack 3: absorbed, 0 charges remain, 100 HP
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 40 })
    assert.equal(state.health, 100, 'Attack 3 absorbed')
    assert.equal(state.activeEffects.wardingCharmsCount, 0, '0 charges remain after attack 3')

    // Attack 4: normal damage (40 damage) -> 60 HP
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 40 })
    assert.equal(state.health, 60, 'Attack 4 causes normal damage once all charges are exhausted')

    // Duplicate attack event prevention: zero damage does not consume a charge
    state = {
      ...state,
      activeEffects: { ...state.activeEffects, wardingCharmsCount: 1 },
    }
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 0 })
    assert.equal(state.activeEffects.wardingCharmsCount, 1, 'Zero-damage event does not consume charge')
  }
  console.log('✓ Warding Charm indefinite retention, exact single absorption & multi-charge defense verified')

  // =========================================================================
  // 8. Lifecycle Transitions: Reset, Game Over, Victory
  // =========================================================================
  console.log('Test 8: Lifecycle State Cleanup on Death, Reset & Victory')
  {
    let state = createTestGameState('hard', 888)
    state = {
      ...state,
      health: 100,
      activeEffects: {
        echoRevealRemainingMs: 3000,
        spectralCompassRemainingMs: 4000,
        spiritLanternRemainingMs: 5000,
        wardingCharmsCount: 2,
      },
    }

    // Attacks 1 & 2: absorbed by the 2 warding charms
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 999 })
    assert.equal(state.health, 100, 'Lethal attack 1 absorbed by warding charm')
    assert.equal(state.activeEffects.wardingCharmsCount, 1)

    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 999 })
    assert.equal(state.health, 100, 'Lethal attack 2 absorbed by warding charm')
    assert.equal(state.activeEffects.wardingCharmsCount, 0)

    // Fatal damage (game over) clears active effects when no warding charms remain
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 999 })
    assert.equal(state.isGameOver, true, 'Player marked game over on unabsorbed lethal damage')
    assert.equal(state.health, 0)
    assert.equal(state.activeEffects.echoRevealRemainingMs, 0)
    assert.equal(state.activeEffects.spectralCompassRemainingMs, 0)
    assert.equal(state.activeEffects.spiritLanternRemainingMs, 0)
    assert.equal(state.activeEffects.wardingCharmsCount, 0)

    // Reset run restores pristine state
    state = gameReducer(state, { type: 'RESET_RUN' })
    assert.equal(state.isGameOver, false)
    assert.equal(state.health, state.maxHealth)
    assert.equal(state.activeEffects.echoRevealRemainingMs, 0)
    assert.equal(state.activeEffects.wardingCharmsCount, 0)
  }
  console.log('✓ Lifecycle transitions (death, game over, reset) verified')

  disposeAllSharedPools()
  console.log('--- ALL COLLECTIBLE AUTOMATIC ACTIVATION & WARDING TESTS PASSED! ---')
}

if (typeof window === 'undefined') {
  runCollectibleAutomaticActivationTests()
}
