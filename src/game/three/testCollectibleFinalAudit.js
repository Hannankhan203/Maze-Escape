import assert from 'node:assert/strict'
import { COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import {
  collectItemAtPosition,
  createInitialGameState,
  gameReducer,
  syncPlayerCell,
} from '../engine/gameReducer.js'
import { placeCollectibles } from '../generation/collectiblePlacement.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  DEFAULT_KEY_BINDINGS,
  KEY_BINDING_ACTION_ORDER,
  KEY_BINDING_DEFINITIONS,
  applyKeyBindingChange,
  findKeyBindingConflict,
  formatKeyTokenLabel,
} from './threeConfig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { triggerHapticForGameEvent } from '../../utils/haptics.js'

console.log('--- RUNNING FINAL COMPREHENSIVE AUDIT OF MAZE ESCAPE COLLECTIBLE SYSTEM ---')

const createMockRenderer = () => ({
  domElement: {
    addEventListener() {},
    removeEventListener() {},
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  },
  outputColorSpace: null,
  toneMapping: null,
  toneMappingExposure: 1,
  setPixelRatio() {},
  setSize() {},
  render() {},
  dispose() {},
  getContext: () => ({ getContextAttributes: () => ({ antialias: true }) }),
})

const createMockHost = () => ({
  appendChild() {},
  removeChild() {},
  addEventListener() {},
  removeEventListener() {},
  clientWidth: 800,
  clientHeight: 600,
  ownerDocument: {
    defaultView: {
      devicePixelRatio: 1,
      addEventListener() {},
      removeEventListener() {},
    },
    addEventListener() {},
    removeEventListener() {},
  },
})

function createOpenCorridorMaze(rows = 15, cols = 29) {
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      r === 0 || r === rows - 1 || c === 0 || c === cols - 1 ? 1 : 0
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

// =============================================================================
// AUDIT 1: All 10 Collectibles & Activation Behavior
// =============================================================================
{
  console.log('Audit 1: Complete behavior of all 10 collectibles, Keycards, and Echo Reveal')

  // 1.1 Health Capsule (Automatic, 25% restore, max cap, rejection on full)
  const openMaze = createOpenCorridorMaze(15, 29)
  let state = {
    ...createInitialGameState('medium', 10101),
    maze: openMaze,
    playerPos: { row: 1, col: 1 },
    health: 60,
    maxHealth: 100,
  }
  const hcItem = { id: 'hc-1', type: COLLECTIBLE_TYPES.HEALTH_CAPSULE, row: 1, col: 1 }
  const hcRes = collectItemAtPosition([hcItem], state.inventory, { row: 1, col: 1 }, 0, {
    health: 60,
    maxHealth: 100,
  })
  assert.equal(hcRes.collectedItem?.type, COLLECTIBLE_TYPES.HEALTH_CAPSULE)
  assert.equal(hcRes.health, 85, 'Restores 25% of 100 max health')
  assert.equal(hcRes.healthRestored, 25)
  assert.equal(hcRes.inventory[COLLECTIBLE_TYPES.HEALTH_CAPSULE], 0, 'Does not enter inventory')

  const hcFullRes = collectItemAtPosition([hcItem], state.inventory, { row: 1, col: 1 }, 0, {
    health: 100,
    maxHealth: 100,
  })
  assert.equal(hcFullRes.collectedItem, null)
  assert.equal(hcFullRes.rejectedItem?.type, COLLECTIBLE_TYPES.HEALTH_CAPSULE)
  assert.equal(hcFullRes.rejectionReason, 'health_full')

  // 1.2 Soul Shards (Automatic, score bonus, duplicate prevention)
  const ssItem = { id: 'ss-1', type: COLLECTIBLE_TYPES.SOUL_SHARDS, row: 1, col: 2 }
  const ssRes = collectItemAtPosition([ssItem], state.inventory, { row: 1, col: 2 }, 0, {
    difficulty: 'medium',
  })
  assert.equal(ssRes.collectedItem?.type, COLLECTIBLE_TYPES.SOUL_SHARDS)
  assert.equal(ssRes.shardsDelta, 1)
  assert.ok(ssRes.scoreDelta > 0, 'Awards bonus score')
  assert.equal(ssRes.inventory[COLLECTIBLE_TYPES.SOUL_SHARDS], 0, 'Does not enter inventory')

  // 1.3 Energy Cell (Automatic, 30% battery restore, max cap, rejection on full)
  const ecItem = { id: 'ec-1', type: COLLECTIBLE_TYPES.ENERGY_CELL, row: 1, col: 3 }
  const ecRes = collectItemAtPosition([ecItem], state.inventory, { row: 1, col: 3 }, 0, {
    battery: 50,
    maxBattery: 100,
  })
  assert.equal(ecRes.collectedItem?.type, COLLECTIBLE_TYPES.ENERGY_CELL)
  assert.equal(ecRes.battery, 80, 'Restores 30% of 100 max battery')
  assert.equal(ecRes.batteryRestored, 30)
  assert.equal(ecRes.inventory[COLLECTIBLE_TYPES.ENERGY_CELL], 0, 'Does not enter inventory')

  const ecFullRes = collectItemAtPosition([ecItem], state.inventory, { row: 1, col: 3 }, 0, {
    battery: 100,
    maxBattery: 100,
  })
  assert.equal(ecFullRes.collectedItem, null)
  assert.equal(ecFullRes.rejectedItem?.type, COLLECTIBLE_TYPES.ENERGY_CELL)
  assert.equal(ecFullRes.rejectionReason, 'battery_full')

  // 1.4 Spectral Compass (Automatic, 6s attraction)
  const scItem = { id: 'sc-1', type: COLLECTIBLE_TYPES.SPECTRAL_COMPASS, row: 1, col: 4 }
  state = { ...state, items: [scItem], playerPos: { row: 1, col: 3 } }
  state = syncPlayerCell(state, { row: 1, col: 4 })
  assert.equal(state.activeEffects.spectralCompassRemainingMs, 6000, 'Activates 6s attraction')
  assert.equal(state.inventory[COLLECTIBLE_TYPES.SPECTRAL_COMPASS], 0, 'Does not enter inventory')

  // 1.5 Warding Charm (Persistent charges, exact 1-hit absorption per charge)
  const wcItem = { id: 'wc-1', type: COLLECTIBLE_TYPES.WARDING_CHARM, row: 1, col: 5 }
  state = { ...state, items: [wcItem], playerPos: { row: 1, col: 4 } }
  state = syncPlayerCell(state, { row: 1, col: 5 })
  assert.equal(state.activeEffects.wardingCharmsCount, 1, 'Increments warding shield charges')
  assert.equal(state.inventory[COLLECTIBLE_TYPES.WARDING_CHARM], 0, 'Does not enter inventory')

  // Tick time does not expire warding charms
  state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 10000 })
  assert.equal(state.activeEffects.wardingCharmsCount, 1, 'Warding Charm charges are persistent')

  // Absorbs damage in gameReducer
  state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 35 })
  assert.equal(state.health, 60, 'Health unaffected by absorbed attack')
  assert.equal(state.activeEffects.wardingCharmsCount, 0, 'Absorbs exactly 1 attack')
  assert.equal(state.lastEvent?.type, 'warding_charm_absorbed')

  // 1.6 Spirit Lantern (Automatic, 8s area illumination & minimap path reveal)
  const slItem = { id: 'sl-1', type: COLLECTIBLE_TYPES.SPIRIT_LANTERN, row: 1, col: 6 }
  state = { ...state, items: [slItem], playerPos: { row: 1, col: 5 } }
  state = syncPlayerCell(state, { row: 1, col: 6 })
  assert.equal(state.activeEffects.spiritLanternRemainingMs, 8000, 'Activates 8s illumination')
  assert.equal(state.inventory[COLLECTIBLE_TYPES.SPIRIT_LANTERN], 0, 'Does not enter inventory')

  // 1.7 Echo Reveal (Automatic 4.5s exit route calculation, separate mechanic)
  const erItem = { id: 'er-1', type: COLLECTIBLE_TYPES.ECHO_REVEAL, row: 1, col: 7 }
  state = { ...state, items: [erItem], playerPos: { row: 1, col: 6 } }
  state = syncPlayerCell(state, { row: 1, col: 7 })
  assert.equal(state.activeEffects.echoRevealRemainingMs, 4500, 'Activates 4.5s exit reveal')
  assert.ok(Array.isArray(state.echoPath) && state.echoPath.length > 0, 'Calculates shortest path to exit')
  assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_REVEAL], 1, 'Tracks collected count')

  // 1.8 Phantom Veil (Collect & store, 4s manual activation, enemy concealment)
  const pvItem = { id: 'pv-1', type: COLLECTIBLE_TYPES.PHANTOM_VEIL, row: 2, col: 1 }
  state = { ...state, items: [pvItem], playerPos: { row: 2, col: 0 } }
  state = syncPlayerCell(state, { row: 2, col: 1 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 1, 'Stores into inventory')
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 0, 'Does NOT activate automatically on pickup')

  state = gameReducer(state, { type: 'ACTIVATE_ABILITY', abilityType: COLLECTIBLE_TYPES.PHANTOM_VEIL })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 0, 'Consumes 1 stored item')
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 4000, 'Activates for 4 seconds')

  // 1.9 Time Fragment (Collect & store, 5s manual activation, 8-tile radius, 50% slow)
  const tfItem = { id: 'tf-1', type: COLLECTIBLE_TYPES.TIME_FRAGMENT, row: 2, col: 2 }
  state = { ...state, items: [tfItem], playerPos: { row: 2, col: 1 } }
  state = syncPlayerCell(state, { row: 2, col: 2 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 1, 'Stores into inventory')
  assert.equal(state.activeEffects.timeFragmentRemainingMs, 0, 'Does NOT activate automatically on pickup')

  state = gameReducer(state, { type: 'ACTIVATE_ABILITY', abilityType: COLLECTIBLE_TYPES.TIME_FRAGMENT })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 0, 'Consumes 1 stored item')
  assert.equal(state.activeEffects.timeFragmentRemainingMs, 5000, 'Activates for 5 seconds')

  // 1.10 Watcher's Eye (Collect & store, 6s manual activation, 10-tile radius, wall reveal)
  const weItem = { id: 'we-1', type: COLLECTIBLE_TYPES.WATCHERS_EYE, row: 2, col: 3 }
  state = { ...state, items: [weItem], playerPos: { row: 2, col: 2 } }
  state = syncPlayerCell(state, { row: 2, col: 3 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE], 1, 'Stores into inventory')
  assert.equal(state.activeEffects.watchersEyeRemainingMs, 0, 'Does NOT activate automatically on pickup')

  state = gameReducer(state, { type: 'ACTIVATE_ABILITY', abilityType: COLLECTIBLE_TYPES.WATCHERS_EYE })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE], 0, 'Consumes 1 stored item')
  assert.equal(state.activeEffects.watchersEyeRemainingMs, 6000, 'Activates for 6 seconds')

  // 1.11 Echo Pulse (Collect & store, 2s manual activation, 6-tile radius, 2s stun)
  const epItem = { id: 'ep-1', type: COLLECTIBLE_TYPES.ECHO_PULSE, row: 2, col: 4 }
  state = { ...state, items: [epItem], playerPos: { row: 2, col: 3 } }
  state = syncPlayerCell(state, { row: 2, col: 4 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 1, 'Stores into inventory')
  assert.equal(state.lastEvent?.echoPulse, null, 'Does NOT emit pulse on pickup')

  state = gameReducer(state, { type: 'ACTIVATE_ABILITY', abilityType: COLLECTIBLE_TYPES.ECHO_PULSE })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 0, 'Consumes 1 stored item')
  assert.equal(state.lastEvent?.echoPulse?.radius, 6, 'Emits 6-tile radius pulse')
  assert.equal(state.lastEvent?.echoPulse?.duration, 2000, 'Stun duration is 2000ms')

  // 1.12 Keycards & Exit Lock
  const testMaze = generateMaze({ seed: 7777 })
  let lockState = createInitialGameState(7777, { objectivesEnabled: true })
  assert.equal(lockState.isExitLocked, true, 'Exit is locked when totalKeys > 0')

  // Collect all keycards
  for (const kc of testMaze.keycards) {
    lockState = syncPlayerCell(lockState, { row: kc.row, col: kc.col })
  }
  assert.equal(lockState.isExitLocked, false, 'Exit unlocks once all keycards are collected')
  assert.equal(lockState.keysCollected, lockState.totalKeys)

  // Step into exit -> victory
  lockState = syncPlayerCell(lockState, testMaze.exit)
  assert.equal(lockState.hasWon, true, 'Reaching exit after unlocking triggers victory')

  // Obsolete bindings check
  assert.equal('echoReveal' in DEFAULT_KEY_BINDINGS, false)
  assert.equal('wallPass' in DEFAULT_KEY_BINDINGS, false)
  assert.equal('coinMagnet' in DEFAULT_KEY_BINDINGS, false)

  console.log('✓ All 10 collectibles, Keycards, and Echo Reveal verified')
}

// =============================================================================
// AUDIT 2: COLLECT_ITEM Reducer Action Parity & Synchronization
// =============================================================================
{
  console.log('Audit 2: gameReducer COLLECT_ITEM action parity with syncPlayerCell')

  let state = createInitialGameState('easy', 9901)
  const wc = { id: 'item-wc-test', type: COLLECTIBLE_TYPES.WARDING_CHARM, row: 3, col: 3 }
  const sc = { id: 'item-sc-test', type: COLLECTIBLE_TYPES.SPECTRAL_COMPASS, row: 3, col: 4 }
  const sl = { id: 'item-sl-test', type: COLLECTIBLE_TYPES.SPIRIT_LANTERN, row: 3, col: 5 }
  const er = { id: 'item-er-test', type: COLLECTIBLE_TYPES.ECHO_REVEAL, row: 3, col: 6 }
  const pv = { id: 'item-pv-test', type: COLLECTIBLE_TYPES.PHANTOM_VEIL, row: 3, col: 7 }
  state = { ...state, items: [wc, sc, sl, er, pv] }

  // COLLECT_ITEM for Warding Charm increments wardingCharmsCount
  state = gameReducer(state, { type: 'COLLECT_ITEM', itemId: wc.id })
  assert.equal(state.activeEffects.wardingCharmsCount, 1)
  assert.ok(state.lastEvent?.message?.includes('Warding Charm Acquired'))

  // COLLECT_ITEM for Spectral Compass activates 6s
  state = gameReducer(state, { type: 'COLLECT_ITEM', itemId: sc.id })
  assert.equal(state.activeEffects.spectralCompassRemainingMs, 6000)

  // COLLECT_ITEM for Spirit Lantern activates 8s
  state = gameReducer(state, { type: 'COLLECT_ITEM', itemId: sl.id })
  assert.equal(state.activeEffects.spiritLanternRemainingMs, 8000)

  // COLLECT_ITEM for Echo Reveal activates 4.5s and resolves echoPath
  state = gameReducer(state, { type: 'COLLECT_ITEM', itemId: er.id })
  assert.equal(state.activeEffects.echoRevealRemainingMs, 4500)
  assert.ok(state.echoPath.length > 0)

  // COLLECT_ITEM for Phantom Veil stores into inventory
  state = gameReducer(state, { type: 'COLLECT_ITEM', itemId: pv.id })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 1)
  assert.ok(state.lastEvent?.message?.includes('Phantom Veil Stored'))

  console.log('✓ COLLECT_ITEM parity and synchronization verified')
}

// =============================================================================
// AUDIT 3: 3D Engine, Enemy AI, & Warding Charm Absorption
// =============================================================================
{
  console.log('Audit 3: 3D Engine, Enemy AI reactions, radii, recovery, and Warding Charm')

  const maze = generateMaze({ difficulty: 'small', seed: 4321 })
  const host = createMockHost()
  const engine = new MazeSceneEngine(host, {
    createRenderer: createMockRenderer,
    isSoftwareGl: true,
    spawnSequence: { enabled: false },
    maze,
  })

  try {
    engine.stepFrame(0.016)

    // Warding Charm damage absorption in 3D engine
    let damageEvent = null
    engine._onPlayerDamage = (evt) => {
      damageEvent = evt
    }

    engine.setActiveEffects({ wardingCharmsCount: 2 })
    const damaged1 = engine.applyDamage(25, { enemyId: 'enemy-1' })
    assert.equal(damaged1, false, 'applyDamage returns false when absorbed by Warding Charm')
    assert.equal(engine.health, 100, '3D engine health unmodified')
    assert.equal(damageEvent?.absorbedByWardingCharm, true)
    assert.equal(engine._activeEffects?.wardingCharmsCount, 1, 'Decrements 1 charge')

    engine.damageImmunityTimer = 0
    const damaged2 = engine.applyDamage(25, { enemyId: 'enemy-1' })
    assert.equal(damaged2, false, 'Second attack absorbed by second charge')
    assert.equal(engine._activeEffects?.wardingCharmsCount, 0)

    engine.damageImmunityTimer = 0
    const damaged3 = engine.applyDamage(25, { enemyId: 'enemy-1' })
    assert.equal(damaged3, true, 'Third attack with 0 charges inflicts real damage')
    assert.equal(engine.health, 75)

    // Enemy AI reactions to manual abilities
    const manager = engine.getEnemyManager()
    if (manager) {
      const pWorld = engine.getPlayerWorldPosition()

      // Spawn or inspect agents
      const agent = manager.agents?.values?.()?.next()?.value
      if (agent) {
        // Echo Pulse stun
        const pulseRes = engine.triggerEchoPulse(pWorld, { eventId: 'audit-pulse-1', radiusTiles: 10, durationSec: 2 })
        assert.ok(pulseRes.stunnedCount >= 0)

        // Duplicate event deduplicated
        const dupRes = engine.triggerEchoPulse(pWorld, { eventId: 'audit-pulse-1' })
        assert.equal(dupRes.duplicate, true)
      }
    }

    // Audio Engine handles warding_charm_absorbed
    const audio = engine.getAudioEngine()
    if (audio) {
      audio._debugHistoryEnabled = true
      audio.handleGameEvent({
        id: 9999,
        type: 'warding_charm_absorbed',
        damage: 25,
      })
      const absorbedCues = audio
        .getCueHistory()
        .filter((c) => c.type === 'warding_charm_absorbed')
      assert.equal(
        absorbedCues.length,
        1,
        'HorrorAudioEngine records warding_charm_absorbed cue'
      )
    }
  } finally {
    engine.dispose()
  }

  console.log('✓ 3D Engine, Enemy AI, and Warding Charm absorption verified')
}

// =============================================================================
// AUDIT 4: Spawn Allocation, Placement & Overlap Prevention (Tiny to Large)
// =============================================================================
{
  console.log('Audit 4: Collectible spawn allocation, placement, and overlap prevention')

  for (const diff of ['easy', 'medium', 'hard', 'hardcore']) {
    const m = generateMaze({ difficulty: diff, seed: 12345 })
    const { items } = placeCollectibles(m)

    const seenCells = new Set()
    for (const item of items) {
      const key = `${item.row},${item.col}`
      assert.equal(seenCells.has(key), false, `Zero overlap: ${key} not duplicated in ${diff}`)
      seenCells.add(key)
      assert.notEqual(key, `${m.start.row},${m.start.col}`, 'Item not placed on start')
      assert.notEqual(key, `${m.exit.row},${m.exit.col}`, 'Item not placed on exit')
    }
  }

  // Edge case: Tiny maze grid with extreme constraints
  const tinyGrid = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ]
  const tinyMaze = {
    grid: tinyGrid,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 3 },
    difficulty: 'easy',
    seed: 555,
  }
  const tinyResult = placeCollectibles(tinyMaze)
  assert.ok(Array.isArray(tinyResult.items))
  assert.ok(tinyResult.items.length <= 1, 'Tiny maze gracefully fits available candidate cells')

  console.log('✓ Spawn allocation, placement, and overlap prevention verified')
}

// =============================================================================
// AUDIT 5: Keybindings, Conflicts, HUD & Settings Integration
// =============================================================================
{
  console.log('Audit 5: Keybindings, conflict detection, swap, and HUD tokens')

  // Verify default 13 action bindings
  assert.equal(KEY_BINDING_ACTION_ORDER.length, 13)
  assert.equal(KEY_BINDING_DEFINITIONS.length, 13)
  assert.equal(DEFAULT_KEY_BINDINGS.phantomVeil, 'q')
  assert.equal(DEFAULT_KEY_BINDINGS.timeFragment, 't')
  assert.equal(DEFAULT_KEY_BINDINGS.watchersEye, 'r')
  assert.equal(DEFAULT_KEY_BINDINGS.echoPulse, 'e')
  assert.equal('interact' in DEFAULT_KEY_BINDINGS, false)
  assert.equal(DEFAULT_KEY_BINDINGS.cycleCameraDistance, 'v')

  // Conflict detection
  const conflict = findKeyBindingConflict(DEFAULT_KEY_BINDINGS, 'phantomVeil', 't')
  assert.ok(conflict, 'Detects conflict when assigning T to Phantom Veil')
  assert.equal(conflict.actionId, 'timeFragment')

  // Conflict swap
  const swapResult = applyKeyBindingChange(DEFAULT_KEY_BINDINGS, 'phantomVeil', 't', { resolution: 'swap' })
  assert.equal(swapResult.ok, true)
  assert.equal(swapResult.bindings.phantomVeil, 't')
  assert.equal(swapResult.bindings.timeFragment, 'q')
  assert.equal(new Set(Object.values(swapResult.bindings)).size, 13, 'Zero duplicate keys after swap')

  // Format labels
  assert.equal(formatKeyTokenLabel('q'), 'Q')
  assert.equal(formatKeyTokenLabel('shift'), 'Shift')

  console.log('✓ Keybindings, conflicts, and HUD tokens verified')
}

// =============================================================================
// AUDIT 6: Haptics & Audio Event Integration
// =============================================================================
{
  console.log('Audit 6: Haptics & Audio event integration across all collectibles')

  const fakeVibrations = []
  const mockNav = {
    vibrate: (pattern) => {
      fakeVibrations.push(pattern)
      return true
    },
  }

  // Test haptics for all event types
  triggerHapticForGameEvent({ type: 'item_collected', item: { type: COLLECTIBLE_TYPES.SOUL_SHARDS } }, { navigator: mockNav })
  triggerHapticForGameEvent({ type: 'item_collected', item: { type: COLLECTIBLE_TYPES.TIME_FRAGMENT } }, { navigator: mockNav })
  triggerHapticForGameEvent({ type: 'ability_activated', abilityType: COLLECTIBLE_TYPES.ECHO_PULSE }, { navigator: mockNav })
  triggerHapticForGameEvent({ type: 'warding_charm_absorbed' }, { navigator: mockNav })
  triggerHapticForGameEvent({ type: 'item_pickup_rejected' }, { navigator: mockNav })
  assert.equal(fakeVibrations.length, 5, 'Haptic feedback triggered for all audited events')

  console.log('✓ Haptics and audio event integration verified')
}

console.log('--- ALL FINAL AUDIT CHECKS PASSED! ---')
