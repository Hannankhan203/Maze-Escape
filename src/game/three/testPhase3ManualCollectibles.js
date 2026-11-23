import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import {
  COLLECTIBLE_TYPES,
  MANUAL_COLLECTIBLE_TYPES,
} from '../mechanics/collectiblesConfig.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { gridToWorld } from '../world/worldCoords.js'
import { EnemyAgent, ENEMY_STATES } from './EnemyAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { HAPTIC_PATTERNS, triggerHapticForGameEvent } from '../../utils/haptics.js'
import { createContinuousInputController } from '../../hooks/useContinuousInput.js'
import { DEFAULT_KEY_BINDINGS } from './threeConfig.js'
import { SETTINGS_SCHEMA } from '../../components/settings/settingsConfig.js'
import { disposeAllSharedPools } from './sharedResources.js'

console.log('--- Running Phase 3 Manual Collectible Storage & Activation Regression Tests ---')

function createOpenCorridorMaze(rows = 15, cols = 29) {
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      r === 0 || r === rows - 1 || c === 0 || c === cols - 1
        ? CELL_TYPES.WALL
        : CELL_TYPES.PATH
    )
  )
  return {
    id: `manual-test-${rows}x${cols}`,
    rows,
    cols,
    grid,
    start: { row: 1, col: 1 },
    exit: { row: rows - 2, col: cols - 2 },
    collectibles: { items: [], keycards: [] },
    keycards: [],
  }
}

function createTestGameState(difficulty = 'medium', seed = 555, overrides = {}) {
  const maze = createOpenCorridorMaze(15, 29)
  const base = createInitialGameState(difficulty, seed)
  return {
    ...base,
    maze,
    playerPos: { row: 1, col: 1 },
    items: [],
    keycards: [],
    totalKeys: 0,
    isExitLocked: false,
    ...overrides,
  }
}

function createMockRenderer() {
  const renderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: null, needsUpdate: false },
    pixelRatio: 1,
    setPixelRatio(r) {
      renderer.pixelRatio = r
    },
    setSize() {},
    render() {},
    dispose() {},
    getContext() {
      return null
    },
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

function createMockAudioContext() {
  let oscStarted = 0
  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
    setTargetAtTime: () => {},
  })
  const makeNode = () => ({
    connect: () => {},
    disconnect: () => {},
    gain: makeParam(1),
    frequency: makeParam(440),
    Q: makeParam(1),
    type: 'sine',
    start: () => {
      oscStarted += 1
    },
    stop: () => {},
  })
  return {
    stats: {
      get oscillatorsStarted() {
        return oscStarted
      },
    },
    ctx: {
      currentTime: 0,
      state: 'running',
      createOscillator: makeNode,
      createGain: makeNode,
      createBiquadFilter: makeNode,
      createBufferSource: () => ({ ...makeNode(), buffer: null }),
    },
  }
}

// ===========================================================================
// PART 1: Pickup Stores All 4 Manual Collectibles Without Auto-Activation
// ===========================================================================
{
  console.log('Test 1: All 4 manual collectibles enter inventory on pickup without activating')
  assert.deepEqual(MANUAL_COLLECTIBLE_TYPES, [
    COLLECTIBLE_TYPES.PHANTOM_VEIL,
    COLLECTIBLE_TYPES.TIME_FRAGMENT,
    COLLECTIBLE_TYPES.WATCHERS_EYE,
    COLLECTIBLE_TYPES.ECHO_PULSE,
  ])

  let state = createTestGameState('medium', 1001, {
    items: [
      { id: 'pv-1', type: COLLECTIBLE_TYPES.PHANTOM_VEIL, row: 2, col: 2 },
      { id: 'pv-2', type: COLLECTIBLE_TYPES.PHANTOM_VEIL, row: 2, col: 3 },
      { id: 'tf-1', type: COLLECTIBLE_TYPES.TIME_FRAGMENT, row: 2, col: 4 },
      { id: 'we-1', type: COLLECTIBLE_TYPES.WATCHERS_EYE, row: 2, col: 5 },
      { id: 'ep-1', type: COLLECTIBLE_TYPES.ECHO_PULSE, row: 2, col: 6 },
      { id: 'ep-2', type: COLLECTIBLE_TYPES.ECHO_PULSE, row: 2, col: 7 },
    ],
  })

  // Step onto Phantom Veil x2
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 2 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 1)
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 0)
  assert.equal(state.lastEvent?.type, 'item_collected')

  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 3 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 2, 'Manual collectibles stack in inventory')
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 0)

  // Step onto Time Fragment
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 4 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 1)
  assert.equal(state.activeEffects.timeFragmentRemainingMs, 0)

  // Step onto Watcher's Eye
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 5 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE], 1)
  assert.equal(state.activeEffects.watchersEyeRemainingMs, 0)

  // Step onto Echo Pulse x2
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 6 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 1)
  assert.equal(state.lastEvent?.echoPulse, null, 'Echo Pulse pickup emits no shockwave payload')

  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 7 })
  assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 2)
  assert.equal(state.lastEvent?.echoPulse, null)
  assert.equal(state.items.length, 0)

  // COLLECT_ITEM path also stores without auto-activating
  let collectState = createTestGameState('medium', 1002, {
    items: [{ id: 'tf-collect', type: COLLECTIBLE_TYPES.TIME_FRAGMENT, row: 3, col: 3 }],
  })
  collectState = gameReducer(collectState, {
    type: 'COLLECT_ITEM',
    itemId: 'tf-collect',
    row: 3,
    col: 3,
  })
  assert.equal(collectState.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 1)
  assert.equal(collectState.activeEffects.timeFragmentRemainingMs, 0)

  console.log('✓ All 4 manual collectibles store in inventory on pickup without activating')
}

// ===========================================================================
// PART 2: Manual Activation, Inventory Consumption, Zero-Fail & Single-Event Dedup
// ===========================================================================
{
  console.log('Test 2: Explicit reducer actions, zero-inventory rejection, and single-event deduplication')
  let state = createTestGameState('medium', 1010)

  // All 4 fail safely at 0 inventory
  for (const [actionType, abilityType] of [
    ['ACTIVATE_PHANTOM_VEIL', COLLECTIBLE_TYPES.PHANTOM_VEIL],
    ['ACTIVATE_TIME_FRAGMENT', COLLECTIBLE_TYPES.TIME_FRAGMENT],
    ['ACTIVATE_WATCHERS_EYE', COLLECTIBLE_TYPES.WATCHERS_EYE],
    ['ACTIVATE_ECHO_PULSE', COLLECTIBLE_TYPES.ECHO_PULSE],
  ]) {
    const res1 = gameReducer(state, { type: actionType })
    assert.equal(res1, state, `${actionType} returns exact state reference when inventory is 0`)
    const res2 = gameReducer(state, { type: 'ACTIVATE_ABILITY', abilityType })
    assert.equal(res2, state, `ACTIVATE_ABILITY(${abilityType}) returns exact state reference when inventory is 0`)
  }

  // Stock 2 of each
  state = {
    ...state,
    inventory: {
      ...state.inventory,
      [COLLECTIBLE_TYPES.PHANTOM_VEIL]: 2,
      [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 2,
      [COLLECTIBLE_TYPES.WATCHERS_EYE]: 2,
      [COLLECTIBLE_TYPES.ECHO_PULSE]: 2,
    },
  }

  // Duplicate inputEventId cannot consume 2 charges from one event
  const veilActivated = gameReducer(state, {
    type: 'ACTIVATE_PHANTOM_VEIL',
    inputEventId: 'evt-veil-1',
  })
  assert.equal(veilActivated.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 1)
  assert.equal(veilActivated.activeEffects.phantomVeilRemainingMs, 4000)

  const veilDupSameEvent = gameReducer(veilActivated, {
    type: 'ACTIVATE_PHANTOM_VEIL',
    inputEventId: 'evt-veil-1',
  })
  assert.equal(veilDupSameEvent, veilActivated, 'Duplicate inputEventId is rejected')

  // Active timed effect blocks duplicate activation even with a new event
  const veilWhileActive = gameReducer(veilActivated, {
    type: 'ACTIVATE_ABILITY',
    abilityType: COLLECTIBLE_TYPES.PHANTOM_VEIL,
    inputEventId: 'evt-veil-2',
  })
  assert.equal(veilWhileActive, veilActivated, 'Active Phantom Veil cannot be consumed twice before expiry')
  assert.equal(veilWhileActive.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 1)

  // Echo Pulse: single inputEventId cannot consume 2 charges
  const pulse1 = gameReducer(veilActivated, {
    type: 'ACTIVATE_ECHO_PULSE',
    inputEventId: 'evt-pulse-1',
  })
  assert.equal(pulse1.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 1)
  assert.equal(pulse1.lastEvent?.type, 'ability_activated')
  assert.equal(pulse1.lastEvent?.abilityType, COLLECTIBLE_TYPES.ECHO_PULSE)
  assert.deepEqual(pulse1.lastEvent?.echoPulse, {
    radius: 6,
    duration: 2000,
    position: pulse1.playerPos,
  })

  const pulseDupSameEvent = gameReducer(pulse1, {
    type: 'ACTIVATE_ABILITY',
    abilityType: COLLECTIBLE_TYPES.ECHO_PULSE,
    inputEventId: 'evt-pulse-1',
  })
  assert.equal(pulseDupSameEvent, pulse1, 'Single Echo Pulse input event cannot consume duplicate quantity')

  // Distinct second Echo Pulse event consumes the 2nd charge -> 0, then 3rd fails
  const pulse2 = gameReducer(pulse1, {
    type: 'ACTIVATE_ECHO_PULSE',
    inputEventId: 'evt-pulse-2',
  })
  assert.equal(pulse2.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 0)
  const pulseEmpty = gameReducer(pulse2, {
    type: 'ACTIVATE_ECHO_PULSE',
    inputEventId: 'evt-pulse-3',
  })
  assert.equal(pulseEmpty, pulse2, 'Echo Pulse activation fails safely once inventory reaches 0')

  // Activate Time Fragment & Watcher's Eye via ACTIVATE_ABILITY
  const tfState = gameReducer(pulse2, {
    type: 'ACTIVATE_ABILITY',
    abilityType: COLLECTIBLE_TYPES.TIME_FRAGMENT,
    inputEventId: 'evt-tf-1',
  })
  assert.equal(tfState.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 1)
  assert.equal(tfState.activeEffects.timeFragmentRemainingMs, 5000)

  const eyeState = gameReducer(tfState, {
    type: 'ACTIVATE_ABILITY',
    abilityType: COLLECTIBLE_TYPES.WATCHERS_EYE,
    inputEventId: 'evt-eye-1',
  })
  assert.equal(eyeState.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE], 1)
  assert.equal(eyeState.activeEffects.watchersEyeRemainingMs, 6000)

  console.log('✓ Manual activation, consumption, zero-inventory rejection & dedup verified')
}

// ===========================================================================
// PART 3: Full 3D Effect Semantics After Manual Activation & Cleanup
// ===========================================================================
{
  console.log('Test 3: Manual activation 3D effects (concealment, slow, reveal, stun) & cleanup')
  disposeAllSharedPools()
  const openMaze = createOpenCorridorMaze(15, 31)

  // 3a. Phantom Veil (4s concealment, perception suppression, expiration restores detection)
  let state = createTestGameState('medium', 2001, {
    maze: openMaze,
    playerPos: { row: 7, col: 4 },
    items: [{ id: 'pv-3d', type: COLLECTIBLE_TYPES.PHANTOM_VEIL, row: 7, col: 5 }],
  })
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 7, col: 5 })
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 0)

  const enemy = new EnemyAgent('manual-pv-enemy', {
    maze: openMaze,
    spawnCell: { row: 7, col: 7 },
    patrolRoute: [{ row: 7, col: 7 }, { row: 7, col: 10 }],
  })
  const playerWorld = gridToWorld(7, 5, openMaze)
  const beforeVeilPerception = enemy._checkPerception({
    playerWorldPos: playerWorld,
    activeEffects: state.activeEffects,
  })
  assert.equal(beforeVeilPerception.isHidden, false, 'Picking up Phantom Veil does NOT conceal player')

  state = gameReducer(state, { type: 'ACTIVATE_PHANTOM_VEIL' })
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 4000)
  const duringVeilPerception = enemy._checkPerception({
    playerWorldPos: playerWorld,
    activeEffects: state.activeEffects,
  })
  assert.equal(duringVeilPerception.isHidden, true, 'Manual Phantom Veil conceals player')

  state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 4000 })
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 0)
  const afterVeilPerception = enemy._checkPerception({
    playerWorldPos: playerWorld,
    activeEffects: state.activeEffects,
  })
  assert.equal(afterVeilPerception.isHidden, false, 'Concealment ends cleanly after 4s')
  enemy.dispose()

  // 3b. Time Fragment (5s, 50% slow within 8 tiles, dynamic radius, safe speed restoration)
  let tfState = createTestGameState('medium', 2002, {
    maze: openMaze,
    playerPos: { row: 7, col: 2 },
    items: [{ id: 'tf-3d', type: COLLECTIBLE_TYPES.TIME_FRAGMENT, row: 7, col: 3 }],
  })
  tfState = gameReducer(tfState, { type: 'SYNC_PLAYER_CELL', row: 7, col: 3 })
  const tfEnemy = new EnemyAgent('manual-tf-enemy', {
    maze: openMaze,
    spawnCell: { row: 7, col: 9 }, // 6 tiles from player (< 8)
    patrolRoute: [{ row: 7, col: 25 }, { row: 7, col: 9 }],
  })
  tfEnemy.update(0.05, {
    playerWorldPos: gridToWorld(7, 3, openMaze),
    playerHidden: true,
    activeEffects: tfState.activeEffects,
  })
  assert.equal(tfEnemy.isTimeSlowed, false, 'Pickup alone does not slow enemy')
  assert.equal(tfEnemy.speedMultiplier, 1)

  tfState = gameReducer(tfState, { type: 'ACTIVATE_TIME_FRAGMENT' })
  assert.equal(tfState.activeEffects.timeFragmentRemainingMs, 5000)
  tfEnemy.update(0.05, {
    playerWorldPos: gridToWorld(7, 3, openMaze),
    playerHidden: true,
    activeEffects: tfState.activeEffects,
  })
  assert.equal(tfEnemy.isTimeSlowed, true, 'Manual Time Fragment slows enemy within 8 tiles')
  assert.equal(tfEnemy.speedMultiplier, 0.5)

  tfState = gameReducer(tfState, { type: 'TICK_ABILITIES', deltaMs: 5000 })
  tfEnemy.update(0.05, {
    playerWorldPos: gridToWorld(7, 3, openMaze),
    playerHidden: true,
    activeEffects: tfState.activeEffects,
  })
  assert.equal(tfEnemy.isTimeSlowed, false)
  assert.equal(tfEnemy.speedMultiplier, 1)
  tfEnemy.dispose()

  // 3c. Watcher's Eye (6s, 10-tile through-wall reveal, cleanup on expiry)
  let eyeState = createTestGameState('medium', 2003, {
    maze: openMaze,
    playerPos: { row: 7, col: 2 },
    items: [{ id: 'we-3d', type: COLLECTIBLE_TYPES.WATCHERS_EYE, row: 7, col: 3 }],
  })
  eyeState = gameReducer(eyeState, { type: 'SYNC_PLAYER_CELL', row: 7, col: 3 })
  const eyeEnemy = new EnemyAgent('manual-we-enemy', {
    maze: openMaze,
    spawnCell: { row: 7, col: 11 }, // 8 tiles (< 10)
  })
  eyeEnemy.update(0.05, {
    playerWorldPos: gridToWorld(7, 3, openMaze),
    playerHidden: true,
    activeEffects: eyeState.activeEffects,
  })
  assert.equal(eyeEnemy.isWatchersEyeRevealed, false, 'Pickup alone does not reveal enemy')

  eyeState = gameReducer(eyeState, { type: 'ACTIVATE_WATCHERS_EYE' })
  assert.equal(eyeState.activeEffects.watchersEyeRemainingMs, 6000)
  eyeEnemy.update(0.05, {
    playerWorldPos: gridToWorld(7, 3, openMaze),
    playerHidden: true,
    activeEffects: eyeState.activeEffects,
  })
  assert.equal(eyeEnemy.isWatchersEyeRevealed, true, "Manual Watcher's Eye reveals enemy within 10 tiles")
  assert.equal(eyeEnemy.getMesh().userData.watchersEyeReveal.visible, true)

  eyeState = gameReducer(eyeState, { type: 'TICK_ABILITIES', deltaMs: 6000 })
  eyeEnemy.update(0.05, {
    playerWorldPos: gridToWorld(7, 3, openMaze),
    playerHidden: true,
    activeEffects: eyeState.activeEffects,
  })
  assert.equal(eyeEnemy.isWatchersEyeRevealed, false)
  assert.equal(eyeEnemy.getMesh().userData.watchersEyeReveal.visible, false)
  eyeEnemy.dispose()

  // 3d. Echo Pulse (2s stun within 6 tiles, attack interruption, AI recovery, wave visual & dedup)
  const engine = createHeadlessEngine()
  engine.setMaze(openMaze)
  const pOrigin = gridToWorld(7, 5, openMaze)
  engine.setPlayerWorldPosition(pOrigin.x, 0, pOrigin.z, { immediate: true })
  const attacker = engine.enemyManager.spawnEnemy({
    id: 'manual-ep-attacker',
    spawnCell: { row: 7, col: 7 }, // 2 tiles (< 6)
  })
  attacker.state = ENEMY_STATES.ATTACK
  const farEnemy = engine.enemyManager.spawnEnemy({
    id: 'manual-ep-far',
    spawnCell: { row: 7, col: 14 }, // 9 tiles (> 6)
  })

  let epState = createTestGameState('medium', 2004, {
    maze: openMaze,
    playerPos: { row: 7, col: 4 },
    items: [{ id: 'ep-3d', type: COLLECTIBLE_TYPES.ECHO_PULSE, row: 7, col: 5 }],
  })
  epState = gameReducer(epState, { type: 'SYNC_PLAYER_CELL', row: 7, col: 5 })
  const pickupHandled = engine.handleGameEvent(epState.lastEvent)
  assert.equal(attacker.isStunned, false, 'Pickup event must never stun enemies')
  assert.equal(attacker.state, ENEMY_STATES.ATTACK)
  assert.equal(engine.collectibleManager.getCounts().echoPulses, 0)
  assert.equal(typeof pickupHandled, 'boolean')

  epState = gameReducer(epState, { type: 'ACTIVATE_ECHO_PULSE', inputEventId: 'ep-manual-1' })
  const manualHandled = engine.handleGameEvent(epState.lastEvent)
  assert.equal(manualHandled, true)
  assert.equal(attacker.isStunned, true, 'Manual Echo Pulse interrupts ATTACK and stuns enemy')
  assert.equal(attacker.state, ENEMY_STATES.CHASE)
  assert.equal(farEnemy.isStunned, false, 'Enemy outside 6 tiles unaffected')
  assert.equal(engine.collectibleManager.getCounts().echoPulses, 1)

  // Replaying same reducer event ID in MazeSceneEngine must be deduplicated
  const dupEngineHandled = engine.handleGameEvent(epState.lastEvent)
  assert.equal(dupEngineHandled, false, 'Duplicate event ID does not re-trigger Echo Pulse')

  for (let i = 0; i < 45; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }
  assert.equal(attacker.isStunned, false, 'Enemy recovers cleanly after 2s stun')
  assert.equal(engine.collectibleManager.getCounts().echoPulses, 0, 'Wave ring cleans up')
  engine.dispose()

  console.log('✓ Full 3D manual activation effects, durations, radii, interruption & cleanup verified')
}

// ===========================================================================
// PART 4: Lifecycle Transitions (Reset, Death, Game Over, Victory, Maze Switch)
// ===========================================================================
{
  console.log('Test 4: Lifecycle handling across reset, death/game over, victory, and maze switch')
  let state = createTestGameState('medium', 3001, {
    items: [
      { id: 'pv-lc', type: COLLECTIBLE_TYPES.PHANTOM_VEIL, row: 2, col: 2 },
      { id: 'tf-lc', type: COLLECTIBLE_TYPES.TIME_FRAGMENT, row: 2, col: 3 },
      { id: 'we-lc', type: COLLECTIBLE_TYPES.WATCHERS_EYE, row: 2, col: 4 },
      { id: 'ep-lc', type: COLLECTIBLE_TYPES.ECHO_PULSE, row: 2, col: 5 },
    ],
  })
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 2 })
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 3 })
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 4 })
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: 2, col: 5 })
  state = gameReducer(state, { type: 'ACTIVATE_PHANTOM_VEIL' })

  // Reset run clears both stored inventory and active effects
  const resetState = gameReducer(state, { type: 'RESET_RUN' })
  for (const type of MANUAL_COLLECTIBLE_TYPES) {
    assert.equal(resetState.inventory[type], 0, `RESET_RUN clears ${type} inventory`)
  }
  assert.equal(resetState.activeEffects.phantomVeilRemainingMs, 0)

  // New maze clears stored inventory & active effects
  const newMazeState = gameReducer(state, { type: 'NEW_MAZE' })
  for (const type of MANUAL_COLLECTIBLE_TYPES) {
    assert.equal(newMazeState.inventory[type], 0, `NEW_MAZE clears ${type} inventory`)
  }
  assert.equal(newMazeState.activeEffects.phantomVeilRemainingMs, 0)

  // Difficulty switch clears stored inventory & active effects
  const diffState = gameReducer(state, { type: 'SET_DIFFICULTY', difficulty: 'hard' })
  for (const type of MANUAL_COLLECTIBLE_TYPES) {
    assert.equal(diffState.inventory[type], 0, `SET_DIFFICULTY clears ${type} inventory`)
  }

  // Death / Game Over clears active effects and blocks further activation
  const deadState = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 999 })
  assert.equal(deadState.isGameOver, true)
  assert.equal(deadState.activeEffects.phantomVeilRemainingMs, 0)
  assert.equal(
    gameReducer(deadState, { type: 'ACTIVATE_TIME_FRAGMENT' }),
    deadState,
    'Stored items cannot be activated after game over'
  )

  // Victory clears active effects and blocks further activation
  const wonState = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    position: state.maze.exit,
  })
  assert.equal(wonState.hasWon, true)
  assert.equal(wonState.activeEffects.phantomVeilRemainingMs, 0)
  assert.equal(
    gameReducer(wonState, { type: 'ACTIVATE_WATCHERS_EYE' }),
    wonState,
    'Stored items cannot be activated after victory'
  )

  console.log('✓ Lifecycle transitions verified')
}

// ===========================================================================
// PART 5: Preserved 7 Automatic Collectibles & Keycards + Audio/Haptics + No Keybind Regression
// ===========================================================================
{
  console.log('Test 5: Automatic collectibles, keycards, audio/haptics, and Phase 4 keybinding boundary preserved')
  // Confirm no Phase 4 keyboard bindings were prematurely added
  assert.equal(Object.keys(DEFAULT_KEY_BINDINGS).length, 13, 'Existing 13 keybindings preserved untouched')
  const keybindItem = SETTINGS_SCHEMA.controls.flatMap((g) => g.items).find((i) => i.id === 'keybinds')
  assert.equal(keybindItem.bindings.length, 13, 'Settings keybindings schema untouched for Phase 4')

  // triggerAbility forwards all 4 manual collectibles cleanly
  const activated = []
  const ctrl = createContinuousInputController({
    onActivateAbility: (type, meta) => activated.push({ type, meta }),
  })
  for (const type of MANUAL_COLLECTIBLE_TYPES) {
    ctrl.triggerAbility(type, { inputEventId: `test-${type}` })
  }
  assert.deepEqual(
    activated.map((x) => x.type),
    MANUAL_COLLECTIBLE_TYPES,
    'useContinuousInput triggerAbility supports all 4 manual collectibles'
  )

  // Audio & haptics support ability_activated
  const mockAudio = createMockAudioContext()
  const audioEngine = new HorrorAudioEngine({
    createAudioContext: () => mockAudio.ctx,
    recordCueHistory: true,
  })
  audioEngine.unlock()
  const startOsc = mockAudio.stats.oscillatorsStarted
  assert.equal(
    audioEngine.handleGameEvent({
      id: 401,
      type: 'ability_activated',
      abilityType: COLLECTIBLE_TYPES.ECHO_PULSE,
    }),
    true
  )
  assert.ok(mockAudio.stats.oscillatorsStarted > startOsc, 'Manual ability_activated triggers Web Audio cue')
  assert.equal(
    audioEngine.handleGameEvent({
      id: 401,
      type: 'ability_activated',
      abilityType: COLLECTIBLE_TYPES.ECHO_PULSE,
    }),
    false,
    'Audio engine deduplicates ability_activated event IDs'
  )
  audioEngine.dispose()

  const vibrated = []
  const mockNav = { vibrate: (p) => { vibrated.push(p); return true } }
  triggerHapticForGameEvent(
    { id: 501, type: 'ability_activated', abilityType: COLLECTIBLE_TYPES.PHANTOM_VEIL },
    { enabled: true, navigator: mockNav }
  )
  triggerHapticForGameEvent(
    { id: 502, type: 'ability_activated', abilityType: COLLECTIBLE_TYPES.TIME_FRAGMENT },
    { enabled: true, navigator: mockNav }
  )
  triggerHapticForGameEvent(
    { id: 503, type: 'ability_activated', abilityType: COLLECTIBLE_TYPES.WATCHERS_EYE },
    { enabled: true, navigator: mockNav }
  )
  triggerHapticForGameEvent(
    { id: 504, type: 'ability_activated', abilityType: COLLECTIBLE_TYPES.ECHO_PULSE },
    { enabled: true, navigator: mockNav }
  )
  assert.deepEqual(vibrated, [
    HAPTIC_PATTERNS.ABILITY,
    HAPTIC_PATTERNS.TIME_FRAGMENT,
    HAPTIC_PATTERNS.WATCHERS_EYE,
    HAPTIC_PATTERNS.ECHO_PULSE,
  ])

  // Keycard gate lock + Echo Reveal 4.5s automatic activation preserved
  let regState = createInitialGameState('easy', 7070, { objectivesEnabled: true })
  assert.equal(regState.isExitLocked, true)
  const echoItem = regState.items.find((i) => i.type === COLLECTIBLE_TYPES.ECHO_REVEAL)
  assert.ok(echoItem)
  regState = gameReducer(regState, { type: 'SYNC_PLAYER_CELL', row: echoItem.row, col: echoItem.col })
  assert.equal(regState.activeEffects.echoRevealRemainingMs, 4500, 'Echo Reveal automatic 4.5s route reveal preserved')
  assert.ok(regState.echoPath.length >= 2)
  const kc = regState.keycards[0]
  regState = gameReducer(regState, { type: 'SYNC_PLAYER_CELL', row: kc.row, col: kc.col })
  assert.equal(regState.isExitLocked, false, 'Keycard gate unlock preserved')

  console.log('✓ Preserved automatic collectibles, keycards, audio/haptics & keybinding boundary verified')
}

// ===========================================================================
// PART 6: Live React DOM HUD & TouchControls3D Manual Activation Verification
// ===========================================================================
function createMiniDomEnv() {
  const createEventEmitter = () => {
    const map = new Map()
    return {
      addEventListener(type, fn, opts) {
        if (typeof fn !== 'function') return
        if (!map.has(type)) map.set(type, [])
        const capture = Boolean(opts === true || opts?.capture)
        const list = map.get(type)
        if (!list.some((x) => x.fn === fn && x.capture === capture)) list.push({ fn, capture })
      },
      removeEventListener(type, fn, opts) {
        const list = map.get(type)
        if (!list) return
        const capture = Boolean(opts === true || opts?.capture)
        map.set(type, list.filter((x) => !(x.fn === fn && x.capture === capture)))
      },
      getListeners(type, capture) {
        return (map.get(type) || []).filter((x) => x.capture === capture).map((x) => x.fn)
      },
    }
  }

  const matchesSingle = (el, rawSel) => {
    if (!el || el.nodeType !== 1) return false
    let sel = rawSel.trim()
    if (!sel) return false
    const attrFilters = []
    sel = sel.replace(/\[([^\]=*~|^$]+)(?:([*^$|~]?=)["']?([^"'\]]*)["']?)?\]/g, (_m, name, op, val) => {
      attrFilters.push({ name: name.trim(), op: op || null, val: val ?? '' })
      return ''
    })
    for (const af of attrFilters) {
      const actual = el.getAttribute(af.name)
      if (af.op === null) {
        if (!el.hasAttribute(af.name)) return false
      } else if (actual === null) {
        return false
      } else if (af.op === '=' && actual !== af.val) {
        return false
      }
    }
    const classes = []
    sel = sel.replace(/\.([A-Za-z0-9_-]+)/g, (_m, c) => {
      classes.push(c)
      return ''
    })
    const tag = sel.trim().toLowerCase()
    if (tag && el.tagName.toLowerCase() !== tag) return false
    for (const c of classes) {
      if (!el.classList.contains(c)) return false
    }
    return true
  }

  const matchesSelector = (el, sel) =>
    sel.split(',').some((part) => matchesSingle(el, part.trim()))

  class MiniNode {
    constructor(nodeType, ownerDocument) {
      this.nodeType = nodeType
      this.ownerDocument = ownerDocument
      this.parentNode = null
      this.childNodes = []
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      this.childNodes.push(child)
      return child
    }
    insertBefore(child, ref) {
      if (!ref) return this.appendChild(child)
      if (child.parentNode) child.parentNode.removeChild(child)
      const idx = this.childNodes.indexOf(ref)
      child.parentNode = this
      if (idx === -1) this.childNodes.push(child)
      else this.childNodes.splice(idx, 0, child)
      return child
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child)
      if (idx !== -1) {
        this.childNodes.splice(idx, 1)
        child.parentNode = null
      }
      return child
    }
    get firstChild() {
      return this.childNodes[0] || null
    }
    get textContent() {
      return this.childNodes.map((c) => c.textContent).join('')
    }
    set textContent(v) {
      this.childNodes = []
      if (v !== '' && v !== null && v !== undefined) {
        this.appendChild(new MiniText(String(v), this.ownerDocument))
      }
    }
  }

  class MiniText extends MiniNode {
    constructor(data, doc) {
      super(3, doc)
      this.data = data
    }
    get textContent() {
      return this.data
    }
    set textContent(v) {
      this.data = String(v ?? '')
    }
    set nodeValue(v) {
      this.data = String(v ?? '')
    }
    get nodeValue() {
      return this.data
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName, doc) {
      super(1, doc)
      this.tagName = String(tagName).toUpperCase()
      this._attrs = new Map()
      this._emitter = createEventEmitter()
      this.style = { setProperty() {}, removeProperty() {} }
      this.dataset = new Proxy({}, {
        get: (_t, prop) => this.getAttribute(`data-${String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`) ?? undefined,
        set: (_t, prop, val) => {
          this.setAttribute(`data-${String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, String(val))
          return true
        },
      })
      this.clientWidth = 1280
      this.clientHeight = 720
      this.classList = {
        contains: (c) => this.className.split(/\s+/).includes(c),
        add: (c) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean))
          set.add(c)
          this.className = Array.from(set).join(' ')
        },
        remove: (c) => {
          this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' ')
        },
      }
    }
    get className() {
      return this._attrs.get('class') || ''
    }
    set className(v) {
      this._attrs.set('class', String(v || ''))
    }
    get disabled() {
      return this.hasAttribute('disabled')
    }
    set disabled(v) {
      if (v) this.setAttribute('disabled', '')
      else this.removeAttribute('disabled')
    }
    setAttribute(k, v) {
      this._attrs.set(String(k), String(v))
    }
    setAttributeNS(_ns, k, v) {
      this.setAttribute(k, v)
    }
    getAttribute(k) {
      const key = String(k)
      return this._attrs.has(key) ? this._attrs.get(key) : null
    }
    hasAttribute(k) {
      return this._attrs.has(String(k))
    }
    removeAttribute(k) {
      this._attrs.delete(String(k))
    }
    addEventListener(type, fn, opts) {
      this._emitter.addEventListener(type, fn, opts)
    }
    removeEventListener(type, fn, opts) {
      this._emitter.removeEventListener(type, fn, opts)
    }
    closest(sel) {
      let cur = this
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, sel)) return cur
        cur = cur.parentNode
      }
      return null
    }
    querySelectorAll(sel) {
      const out = []
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1) {
            if (matchesSelector(c, sel)) out.push(c)
            walk(c)
          }
        }
      }
      walk(this)
      return out
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }
    }
    setPointerCapture() {}
    releasePointerCapture() {}
    hasPointerCapture() {
      return false
    }
    dispatchEvent(rawEvt) {
      const evt = rawEvt || {}
      if (!evt.target) evt.target = this
      if (typeof evt.defaultPrevented !== 'boolean') evt.defaultPrevented = false
      if (typeof evt.preventDefault !== 'function') evt.preventDefault = () => { evt.defaultPrevented = true }
      let stopped = false
      if (typeof evt.stopPropagation !== 'function') evt.stopPropagation = () => { stopped = true }
      const path = []
      let cur = this
      while (cur) {
        path.push(cur)
        cur = cur.parentNode
      }
      for (let i = path.length - 1; i >= 0 && !stopped; i -= 1) {
        evt.currentTarget = path[i]
        for (const fn of path[i]._emitter?.getListeners?.(evt.type, true) || []) {
          fn.call(path[i], evt)
        }
      }
      for (let i = 0; i < path.length && !stopped; i += 1) {
        evt.currentTarget = path[i]
        for (const fn of path[i]._emitter?.getListeners?.(evt.type, false) || []) {
          fn.call(path[i], evt)
        }
        if (evt.bubbles === false) break
      }
      return !evt.defaultPrevented
    }
  }

  class MiniCanvas extends MiniElement {
    constructor(doc) {
      super('canvas', doc)
    }
    getContext() {
      return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        setTransform() {},
        fillRect() {},
        strokeRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        ellipse() {},
        fill() {},
        stroke() {},
      }
    }
  }

  class MiniIFrame extends MiniElement {}

  const winEmitter = createEventEmitter()
  const docEmitter = createEventEmitter()
  const docObj = {
    nodeType: 9,
    hidden: false,
    visibilityState: 'visible',
    activeElement: null,
    pointerLockElement: null,
    _emitter: docEmitter,
    createElement: (t) => (t.toLowerCase() === 'canvas' ? new MiniCanvas(docObj) : new MiniElement(t, docObj)),
    createElementNS: (_ns, t) => new MiniElement(t, docObj),
    createTextNode: (t) => new MiniText(String(t ?? ''), docObj),
    addEventListener: (t, fn, o) => docEmitter.addEventListener(t, fn, o),
    removeEventListener: (t, fn, o) => docEmitter.removeEventListener(t, fn, o),
    querySelectorAll: (s) => docObj.body.querySelectorAll(s),
    querySelector: (s) => docObj.body.querySelector(s),
  }
  docObj.documentElement = new MiniElement('html', docObj)
  docObj.body = new MiniElement('body', docObj)
  docObj.documentElement.appendChild(docObj.body)
  docObj.activeElement = docObj.body

  const winObj = {
    document: docObj,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvas,
    HTMLIFrameElement: MiniIFrame,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    location: { href: 'http://localhost:3000/' },
    localStorage: {
      _map: new Map(),
      getItem(k) { return this._map.has(k) ? this._map.get(k) : null },
      setItem(k, v) { this._map.set(k, String(v)) },
      removeItem(k) { this._map.delete(k) },
      clear() { this._map.clear() },
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener: (t, fn, o) => winEmitter.addEventListener(t, fn, o),
    removeEventListener: (t, fn, o) => winEmitter.removeEventListener(t, fn, o),
  }
  docObj.defaultView = winObj

  return {
    window: winObj,
    document: docObj,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvas,
    HTMLIFrameElement: MiniIFrame,
    ResizeObserver: class { observe() {} disconnect() {} },
  }
}

{
  console.log('Test 6: Live React DOM HUD stored counts, activation clicks, and pointer/click deduplication')
  const domEnv = createMiniDomEnv()
  const prevGlobals = new Map()
  const install = (k, v) => {
    prevGlobals.set(k, Object.getOwnPropertyDescriptor(globalThis, k))
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  }
  install('IS_REACT_ACT_ENVIRONMENT', true)
  install('window', domEnv.window)
  install('document', domEnv.document)
  install('Node', domEnv.Node)
  install('Element', domEnv.Element)
  install('HTMLElement', domEnv.HTMLElement)
  install('HTMLCanvasElement', domEnv.HTMLCanvasElement)
  install('HTMLIFrameElement', domEnv.HTMLIFrameElement)
  install('ResizeObserver', domEnv.ResizeObserver)
  install('localStorage', domEnv.window.localStorage)

  const viteServer = await createServer({
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })

  try {
    const { default: MazeViewport3D } = await viteServer.ssrLoadModule('/src/components/game/MazeViewport3D.jsx')
    const { default: TouchControls3D } = await viteServer.ssrLoadModule('/src/components/game/TouchControls3D.jsx')
    const { generateMaze } = await viteServer.ssrLoadModule('/src/game/generation/mazeGenerator.js')

    const maze = generateMaze({ difficulty: 'small', seed: 4040 })
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    const activations = []

    const renderViewport = async (inventory, activeEffects = {}) => {
      await act(async () => {
        root.render(
          createElement(MazeViewport3D, {
            maze,
            runId: 1,
            playerCell: maze.start,
            items: [],
            keycards: [],
            inventory,
            activeEffects,
            controlsEnabled: true,
            onActivateAbility: (type, meta) => activations.push({ type, meta }),
            engineConfig: {
              createRenderer: createMockRenderer,
              isSoftwareGl: true,
              pointerLockEnabled: false,
              spawnSequence: { enabled: false },
            },
          })
        )
      })
    }

    // Empty inventory -> all 4 slots display x0 and are disabled
    await renderViewport({
      [COLLECTIBLE_TYPES.PHANTOM_VEIL]: 0,
      [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 0,
      [COLLECTIBLE_TYPES.WATCHERS_EYE]: 0,
      [COLLECTIBLE_TYPES.ECHO_PULSE]: 0,
    })

    const bar = container.querySelector('.maze-manual-inventory')
    assert.ok(bar, 'Manual collectible inventory bar rendered on viewport HUD')
    for (const type of MANUAL_COLLECTIBLE_TYPES) {
      const btn = bar.querySelector(`[data-manual-collectible="${type}"]`)
      assert.ok(btn, `HUD slot rendered for ${type}`)
      assert.equal(btn.getAttribute('data-stored-count'), '0')
      assert.equal(btn.disabled, true, `HUD slot for ${type} is disabled when count is 0`)
      await act(async () => {
        btn.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
      })
    }
    assert.equal(activations.length, 0, 'Clicking disabled 0-count HUD slots triggers zero activations')

    // Populated inventory -> displays counts & pointerdown+click activates at most once
    await renderViewport({
      [COLLECTIBLE_TYPES.PHANTOM_VEIL]: 2,
      [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 1,
      [COLLECTIBLE_TYPES.WATCHERS_EYE]: 1,
      [COLLECTIBLE_TYPES.ECHO_PULSE]: 3,
    })
    const veilBtn = container.querySelector('[data-manual-collectible="phantom_veil"]')
    assert.equal(veilBtn.getAttribute('data-stored-count'), '2')
    assert.equal(veilBtn.disabled, false)
    assert.ok(veilBtn.textContent.includes('x2'))

    await act(async () => {
      veilBtn.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 1, bubbles: true })
      veilBtn.dispatchEvent({ type: 'pointerup', pointerId: 1, bubbles: true })
      veilBtn.dispatchEvent({ type: 'click', detail: 1, bubbles: true })
    })
    assert.equal(activations.length, 1, 'Pointerdown + click on HUD slot fires exactly once')
    assert.equal(activations[0].type, COLLECTIBLE_TYPES.PHANTOM_VEIL)
    assert.ok(activations[0].meta?.inputEventId, 'HUD activation attaches inputEventId')

    // Click on Echo Pulse slot fires cleanly
    const pulseBtn = container.querySelector('[data-manual-collectible="echo_pulse"]')
    assert.ok(pulseBtn.textContent.includes('x3'))
    await act(async () => {
      pulseBtn.dispatchEvent({ type: 'click', detail: 1, bubbles: true })
    })
    assert.equal(activations.length, 2)
    assert.equal(activations[1].type, COLLECTIBLE_TYPES.ECHO_PULSE)

    // Active countdown state disables slot & shows seconds
    await renderViewport(
      {
        [COLLECTIBLE_TYPES.PHANTOM_VEIL]: 1,
        [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 1,
        [COLLECTIBLE_TYPES.WATCHERS_EYE]: 1,
        [COLLECTIBLE_TYPES.ECHO_PULSE]: 2,
      },
      { phantomVeilRemainingMs: 3400 }
    )
    const activeVeilBtn = container.querySelector('[data-manual-collectible="phantom_veil"]')
    assert.equal(activeVeilBtn.getAttribute('data-active'), 'true')
    assert.equal(activeVeilBtn.disabled, true)
    assert.ok(activeVeilBtn.textContent.includes('3.4s'))

    await act(async () => {
      root.unmount()
    })

    // TouchControls3D renders stored manual collectibles and deduplicates tap
    const touchRoot = createRoot(container)
    const touchCalls = []
    await act(async () => {
      touchRoot.render(
        createElement(TouchControls3D, {
          enabled: true,
          mode: 'always',
          inventory: {
            [COLLECTIBLE_TYPES.ECHO_REVEAL]: 1,
            [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 2,
            [COLLECTIBLE_TYPES.ECHO_PULSE]: 1,
          },
          activeEffects: {},
          onActivateAbility: (type) => touchCalls.push(type),
        })
      )
    })
    const tfTouchBtn = container.querySelector('[data-touch-action="time_fragment"]')
    const epTouchBtn = container.querySelector('[data-touch-action="echo_pulse"]')
    assert.ok(tfTouchBtn, 'TouchControls3D exposes stored Time Fragment button')
    assert.ok(epTouchBtn, 'TouchControls3D exposes stored Echo Pulse button')
    await act(async () => {
      tfTouchBtn.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 9, bubbles: true })
      tfTouchBtn.dispatchEvent({ type: 'pointerup', pointerId: 9, bubbles: true })
      tfTouchBtn.dispatchEvent({ type: 'click', detail: 1, bubbles: true })
    })
    assert.deepEqual(touchCalls, [COLLECTIBLE_TYPES.TIME_FRAGMENT])

    await act(async () => {
      touchRoot.unmount()
    })
    container.parentNode?.removeChild(container)
    console.log('✓ Live React DOM HUD & TouchControls3D manual activation verified')
  } finally {
    await viteServer.close()
    for (const [k, desc] of prevGlobals.entries()) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  }
}

disposeAllSharedPools()
console.log('--- ALL PHASE 3 MANUAL COLLECTIBLE STORAGE & ACTIVATION TESTS PASSED! ---')
