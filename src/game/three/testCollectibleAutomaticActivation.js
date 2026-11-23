import { strict as assert } from 'node:assert'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  COLLECTIBLE_TYPES,
} from '../mechanics/collectiblesConfig.js'
import {
  createExplorationState,
  isCellDiscovered,
  revealPathsInRadius,
} from '../mechanics/minimap.js'
import { getShardBonusValue } from '../mechanics/scoring.js'
import { gridToWorld } from '../world/worldCoords.js'
import { HAPTIC_PATTERNS, triggerHapticForGameEvent } from '../../utils/haptics.js'
import { EnemyAgent, ENEMY_STATES } from './EnemyAgent.js'
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

    // Attracts soul shards in CollectibleManager and forwards collection via MazeSceneEngine & COLLECT_ITEM
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

    const attractedItems = []
    const compassEngine = createHeadlessEngine({
      onCollectItem: (collected) => attractedItems.push(collected),
    })
    compassEngine.setMaze(openMaze)
    const compassShard = { id: 'shard-engine-attract', type: COLLECTIBLE_TYPES.SOUL_SHARDS, row: 2, col: 7 }
    compassEngine.syncCollectibles({ items: [compassShard], spawnBursts: false, isReset: true })
    const enginePlayerPos = compassEngine.getPlayerWorldPosition()
    const engineEntry = compassEngine.getCollectibleManager().items.get('shard-engine-attract')
    engineEntry.mesh.position.set(enginePlayerPos.x, 0.9, enginePlayerPos.z)
    compassEngine.setActiveEffects({ spectralCompassRemainingMs: 5000 })
    compassEngine.stepFrame(0.016, { render: false })
    compassEngine.stepFrame(0.016, { render: false })
    assert.equal(attractedItems.length, 1, 'MazeSceneEngine forwards attracted shard once without duplicate callbacks')
    assert.equal(attractedItems[0].id, 'shard-engine-attract')
    compassEngine.dispose()

    // COLLECT_ITEM collects attracted shard without moving playerPos
    const prevPlayerPos = { ...state.playerPos }
    state = { ...state, items: [compassShard] }
    state = gameReducer(state, { type: 'COLLECT_ITEM', itemId: 'shard-engine-attract', row: 2, col: 7 })
    assert.deepEqual(state.playerPos, prevPlayerPos, 'COLLECT_ITEM does not teleport playerPos')
    assert.equal(state.shardsCollected, 1, 'COLLECT_ITEM awards attracted Soul Shard')
    assert.equal(state.items.length, 0, 'COLLECT_ITEM removes collected shard')

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

    // 3D Engine Warding Charm protection: absorbs lethal & non-lethal hits without triggering Game Over
    const damageEvents = []
    let gameOverCalls = 0
    const wardingEngine = createHeadlessEngine({
      initialHealth: 25,
      maxHealth: 100,
      damageImmunityDuration: 0.5,
      onPlayerDamage: (evt) => damageEvents.push(evt),
      onGameOver: () => {
        gameOverCalls += 1
      },
    })
    wardingEngine.setMaze(createOpenCorridorMaze(15, 29))
    wardingEngine.setHealth(25)
    wardingEngine.setActiveEffects({ wardingCharmsCount: 2 })

    // Lethal 35 damage while at 25 HP -> absorbed by Warding Charm #1
    const applied1 = wardingEngine.applyDamage(35, { enemyId: 'stalker-engine-1' })
    assert.equal(applied1, false, 'Engine applyDamage returns false when Warding Charm absorbs hit')
    assert.equal(wardingEngine.getHealth().health, 25, 'Engine HP preserved during lethal hit absorption')
    assert.equal(wardingEngine.getHealth().isGameOver, false, 'Engine does not trigger game over on absorbed lethal hit')
    assert.equal(gameOverCalls, 0, 'onGameOver not invoked when Warding Charm absorbs lethal hit')
    assert.equal(damageEvents.length, 1)
    assert.equal(damageEvents[0].absorbedByWardingCharm, true)

    // Immediate duplicate hit during immunity window does not consume charge #2
    const blockedDup = wardingEngine.applyDamage(35, { enemyId: 'stalker-engine-1' })
    assert.equal(blockedDup, false)
    assert.equal(damageEvents.length, 1, 'Post-absorption immunity window prevents duplicate charge drain')

    // Advance past immunity -> hit #2 absorbs with Warding Charm #2
    wardingEngine.stepFrame(0.6, { render: false })
    const applied2 = wardingEngine.applyDamage(35, { enemyId: 'stalker-engine-1' })
    assert.equal(applied2, false)
    assert.equal(wardingEngine.getHealth().health, 25)
    assert.equal(gameOverCalls, 0)
    assert.equal(damageEvents.length, 2)
    assert.equal(damageEvents[1].absorbedByWardingCharm, true)

    // Advance past immunity -> hit #3 has 0 charges and applies real lethal damage
    wardingEngine.stepFrame(0.6, { render: false })
    const applied3 = wardingEngine.applyDamage(35, { enemyId: 'stalker-engine-1' })
    assert.equal(applied3, true, 'Engine applies normal damage after all Warding Charm charges are consumed')
    assert.equal(wardingEngine.getHealth().health, 0)
    assert.equal(wardingEngine.getHealth().isGameOver, true)
    assert.equal(gameOverCalls, 1)
    wardingEngine.dispose()

    // Haptics support for warding_charm_absorbed
    const wardHaptics = []
    triggerHapticForGameEvent(
      { id: 999, type: 'warding_charm_absorbed', damage: 35 },
      { enabled: true, navigator: { vibrate: (p) => { wardHaptics.push(p); return true } } }
    )
    assert.equal(wardHaptics[0], HAPTIC_PATTERNS.ABILITY, 'Warding Charm absorption triggers haptic feedback')
  }
  console.log('✓ Warding Charm indefinite retention, exact single absorption, 3D engine protection & multi-charge defense verified')

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
        phantomVeilRemainingMs: 2000,
        timeFragmentRemainingMs: 2500,
        watchersEyeRemainingMs: 3500,
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
    assert.equal(state.activeEffects.phantomVeilRemainingMs, 0)
    assert.equal(state.activeEffects.timeFragmentRemainingMs, 0)
    assert.equal(state.activeEffects.watchersEyeRemainingMs, 0)
    assert.equal(state.activeEffects.wardingCharmsCount, 0)

    // Reset run restores pristine state
    state = gameReducer(state, { type: 'RESET_RUN' })
    assert.equal(state.isGameOver, false)
    assert.equal(state.health, state.maxHealth)
    assert.equal(state.activeEffects.echoRevealRemainingMs, 0)
    assert.equal(state.activeEffects.wardingCharmsCount, 0)

    // Victory cleanup clears all active effects and echoPath
    let victoryState = createTestGameState('easy', 889, { objectivesEnabled: false, isExitLocked: false })
    victoryState = {
      ...victoryState,
      activeEffects: {
        echoRevealRemainingMs: 3000,
        spectralCompassRemainingMs: 4000,
        spiritLanternRemainingMs: 5000,
        phantomVeilRemainingMs: 2000,
        timeFragmentRemainingMs: 2500,
        watchersEyeRemainingMs: 3500,
        wardingCharmsCount: 2,
      },
      echoPath: [victoryState.maze.start, victoryState.maze.exit],
    }
    victoryState = gameReducer(victoryState, {
      type: 'SYNC_PLAYER_CELL',
      position: victoryState.maze.exit,
    })
    assert.equal(victoryState.hasWon, true, 'Reaching unlocked exit sets hasWon')
    assert.equal(victoryState.echoPath.length, 0, 'Victory clears echoPath')
    assert.equal(victoryState.activeEffects.echoRevealRemainingMs, 0)
    assert.equal(victoryState.activeEffects.spectralCompassRemainingMs, 0)
    assert.equal(victoryState.activeEffects.spiritLanternRemainingMs, 0)
    assert.equal(victoryState.activeEffects.phantomVeilRemainingMs, 0)
    assert.equal(victoryState.activeEffects.timeFragmentRemainingMs, 0)
    assert.equal(victoryState.activeEffects.watchersEyeRemainingMs, 0)
    assert.equal(victoryState.activeEffects.wardingCharmsCount, 0)
  }
  console.log('✓ Lifecycle transitions (death, game over, reset, victory) verified')

  // =========================================================================
  // 9. Manual Collectibles Do NOT Auto-Activate: Phantom Veil, Time Fragment, Watcher's Eye, Echo Pulse
  // =========================================================================
  console.log("Test 9: Phantom Veil, Time Fragment, Watcher's Eye & Echo Pulse Store on Pickup & Activate Manually")
  {
    const openMaze = createOpenCorridorMaze(15, 29)

    // 9a. Phantom Veil (stores on pickup, manual activation -> 4000ms & enemy concealment)
    let state = createTestGameState('medium', 901)
    state = {
      ...state,
      items: [{ id: 'veil-manual-1', type: COLLECTIBLE_TYPES.PHANTOM_VEIL, row: 2, col: 2 }],
    }
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 2 })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 1, 'Phantom Veil stored on pickup')
    assert.equal(state.activeEffects.phantomVeilRemainingMs, 0, 'Phantom Veil does not activate on pickup')
    assert.equal(state.items.length, 0)

    state = gameReducer(state, { type: 'ACTIVATE_PHANTOM_VEIL' })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 0, 'Phantom Veil consumes 1 charge on manual activation')
    assert.equal(state.activeEffects.phantomVeilRemainingMs, 4000, 'Phantom Veil activates manually for 4000ms')
    const veilEnemy = new EnemyAgent('veil-check', { maze: openMaze, spawnCell: openMaze.start })
    const perception = veilEnemy._checkPerception({
      playerWorldPos: gridToWorld(2, 2, openMaze),
      activeEffects: state.activeEffects,
    })
    assert.equal(perception.isHidden, true, 'Phantom Veil conceals player from enemy perception')
    veilEnemy.dispose()
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 4000 })
    assert.equal(state.activeEffects.phantomVeilRemainingMs, 0, 'Phantom Veil expires after 4s')

    // 9b. Time Fragment (stores on pickup, manual activation -> 5000ms & 50% speed reduction within 8 tiles)
    state = createTestGameState('medium', 902)
    state = {
      ...state,
      items: [{ id: 'tf-manual-1', type: COLLECTIBLE_TYPES.TIME_FRAGMENT, row: 2, col: 3 }],
    }
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 3 })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 1, 'Time Fragment stored on pickup')
    assert.equal(state.activeEffects.timeFragmentRemainingMs, 0, 'Time Fragment does not activate on pickup')
    assert.equal(state.items.length, 0)

    state = gameReducer(state, { type: 'ACTIVATE_TIME_FRAGMENT' })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 0)
    assert.equal(state.activeEffects.timeFragmentRemainingMs, 5000, 'Time Fragment activates manually for 5000ms')
    const slowEnemy = new EnemyAgent('tf-check', { maze: openMaze, spawnCell: { row: 2, col: 6 } })
    slowEnemy.update(0.05, {
      playerWorldPos: gridToWorld(2, 3, openMaze),
      playerHidden: true,
      activeEffects: state.activeEffects,
    })
    assert.equal(slowEnemy.isTimeSlowed, true, 'Time Fragment slows nearby enemy within 8 tiles')
    assert.equal(slowEnemy.speedMultiplier, 0.5)
    slowEnemy.dispose()
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 5000 })
    assert.equal(state.activeEffects.timeFragmentRemainingMs, 0, 'Time Fragment expires after 5s')

    // 9c. Watcher's Eye (stores on pickup, manual activation -> 6000ms & through-wall reveal within 10 tiles)
    state = createTestGameState('medium', 903)
    state = {
      ...state,
      items: [{ id: 'eye-manual-1', type: COLLECTIBLE_TYPES.WATCHERS_EYE, row: 2, col: 4 }],
    }
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 4 })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE], 1, "Watcher's Eye stored on pickup")
    assert.equal(state.activeEffects.watchersEyeRemainingMs, 0, "Watcher's Eye does not activate on pickup")
    assert.equal(state.items.length, 0)

    state = gameReducer(state, { type: 'ACTIVATE_WATCHERS_EYE' })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE], 0)
    assert.equal(state.activeEffects.watchersEyeRemainingMs, 6000, "Watcher's Eye activates manually for 6000ms")
    const eyeEnemy = new EnemyAgent('eye-check', { maze: openMaze, spawnCell: { row: 2, col: 10 } })
    eyeEnemy.update(0.05, {
      playerWorldPos: gridToWorld(2, 4, openMaze),
      playerHidden: true,
      activeEffects: state.activeEffects,
    })
    assert.equal(eyeEnemy.isWatchersEyeRevealed, true, "Watcher's Eye reveals nearby enemy within 10 tiles")
    eyeEnemy.dispose()
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 6000 })
    assert.equal(state.activeEffects.watchersEyeRemainingMs, 0, "Watcher's Eye expires after 6s")

    // 9d. Echo Pulse (stores on pickup without shockwave, manual activation -> 6-tile 2000ms stun)
    state = createTestGameState('medium', 904)
    state = {
      ...state,
      items: [{ id: 'pulse-manual-1', type: COLLECTIBLE_TYPES.ECHO_PULSE, row: 2, col: 5 }],
    }
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 5 })
    assert.equal(state.lastEvent?.type, 'item_collected')
    assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 1, 'Echo Pulse stored on pickup')
    assert.equal(state.lastEvent?.echoPulse, null, 'Echo Pulse pickup does not emit shockwave')
    assert.equal(state.items.length, 0)

    const pulseEngine = createHeadlessEngine()
    pulseEngine.setMaze(openMaze)
    const pulsePos = gridToWorld(2, 5, openMaze)
    pulseEngine.setPlayerWorldPosition(pulsePos.x, 0, pulsePos.z, { immediate: true })
    const stunnedEnemy = pulseEngine.enemyManager.spawnEnemy({
      id: 'pulse-target',
      spawnCell: { row: 2, col: 8 },
    })
    stunnedEnemy.state = ENEMY_STATES.CHASE
    pulseEngine.handleGameEvent(state.lastEvent)
    assert.equal(stunnedEnemy.isStunned, false, 'Pickup event must not stun enemies')

    state = gameReducer(state, { type: 'ACTIVATE_ECHO_PULSE' })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 0)
    assert.equal(state.lastEvent?.type, 'ability_activated')
    assert.equal(state.lastEvent?.echoPulse?.radius, 6)
    assert.equal(state.lastEvent?.echoPulse?.duration, 2000)
    pulseEngine.handleGameEvent(state.lastEvent)
    assert.equal(stunnedEnemy.isStunned, true, 'Echo Pulse stuns nearby enemy on manual activation event')
    pulseEngine.dispose()
  }
  console.log("✓ Phantom Veil, Time Fragment, Watcher's Eye & Echo Pulse manual storage and activation verified")

  disposeAllSharedPools()
  console.log('--- ALL COLLECTIBLE AUTOMATIC ACTIVATION & WARDING TESTS PASSED! ---')
}

if (typeof window === 'undefined') {
  runCollectibleAutomaticActivationTests()
}
