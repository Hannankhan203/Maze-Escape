import assert from 'node:assert'
import {
  INITIAL_SEED,
  LEVEL_TRANSITION_ACTIONS,
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  createSetLevelAction,
  gameReducer,
  generateFreshBaseSeed,
} from '../engine/gameReducer.js'
import { COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import {
  getLevelConfig,
} from '../mechanics/levelProgression.js'
import { createRunTimer } from '../mechanics/runTimer.js'
import { calculateRunScore, resolveVictorySummary } from '../mechanics/scoring.js'
import { gridToWorld } from '../world/worldCoords.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { HAZARD_STATES } from './HazardAgent.js'

console.log('--- RUNNING LEVEL TRANSITION STATE MANAGEMENT TESTS ---')

function dirtyGameplayState(state) {
  let dirty = {
    ...state,
    playerPos: { ...state.maze.exit },
    lastDirection: 'right',
    blockedBump: { row: 0, col: 0 },
    hasWon: true,
    isGameOver: false,
    health: 35,
    battery: 18,
    items: state.items.slice(1),
    itemsCollected: 3,
    shardsCollected: 2,
    shardBonus: 250,
    keycards: [],
    keysCollected: state.totalKeys,
    isExitLocked: false,
    inventory: {
      ...state.inventory,
      [COLLECTIBLE_TYPES.ECHO_PULSE]: 2,
      [COLLECTIBLE_TYPES.PHANTOM_VEIL]: 1,
      [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 1,
    },
    activeEffects: {
      ...state.activeEffects,
      echoRevealRemainingMs: 2500,
      phantomVeilRemainingMs: 4000,
      wardingCharmsCount: 2,
    },
    echoPath: [state.maze.start, state.maze.exit],
    effects: [{ id: 'fx-1', type: 'test' }],
    recentActivationEventIds: ['evt-1', 'evt-2'],
    lastEvent: { id: 99, type: 'victory' },
  }
  return dirty
}

function assertTransientStateReset(state, contextLabel) {
  assert.deepStrictEqual(state.playerPos, state.maze.start, `${contextLabel}: playerPos reset to maze.start`)
  assert.equal(state.hasWon, false, `${contextLabel}: hasWon reset to false`)
  assert.equal(state.isGameOver, false, `${contextLabel}: isGameOver reset to false`)
  assert.equal(state.health, state.maxHealth, `${contextLabel}: health reset to maxHealth`)
  assert.equal(state.battery, state.maxBattery, `${contextLabel}: battery reset to maxBattery`)
  assert.equal(state.lastDirection, 'down', `${contextLabel}: lastDirection reset`)
  assert.equal(state.blockedBump, null, `${contextLabel}: blockedBump cleared`)
  assert.equal(state.items.length, state.maze.collectibles.items.length, `${contextLabel}: items restored`)
  assert.equal(state.itemsCollected, 0, `${contextLabel}: itemsCollected reset`)
  assert.equal(state.shardsCollected, 0, `${contextLabel}: shardsCollected reset`)
  assert.equal(state.shardBonus, 0, `${contextLabel}: shardBonus reset`)
  assert.equal(state.keysCollected, 0, `${contextLabel}: keysCollected reset`)
  const expectedKeyCount = state.objectivesEnabled ? state.maze.keycards.length : 0
  assert.equal(state.keycards.length, expectedKeyCount, `${contextLabel}: keycards synced`)
  assert.equal(state.totalKeys, expectedKeyCount, `${contextLabel}: totalKeys synced`)
  assert.equal(state.isExitLocked, state.objectivesEnabled && expectedKeyCount > 0, `${contextLabel}: isExitLocked synced`)
  for (const [k, count] of Object.entries(state.inventory)) {
    assert.equal(count, 0, `${contextLabel}: inventory.${k} reset to 0`)
  }
  assert.equal(state.activeEffects.echoRevealRemainingMs, 0, `${contextLabel}: echoRevealRemainingMs reset`)
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 0, `${contextLabel}: phantomVeilRemainingMs reset`)
  assert.equal(state.activeEffects.wardingCharmsCount, 0, `${contextLabel}: wardingCharmsCount reset`)
  assert.deepStrictEqual(state.echoPath, [], `${contextLabel}: echoPath cleared`)
  assert.deepStrictEqual(state.effects, [], `${contextLabel}: visual effects cleared`)
  assert.deepStrictEqual(state.recentActivationEventIds, [], `${contextLabel}: activation history cleared`)
  assert.equal(state.lastEvent, null, `${contextLabel}: lastEvent cleared`)
}

function assertSynchronizedLevelMetadata(state, expectedLevel, expectedBaseSeed, label) {
  const cfg = getLevelConfig(expectedLevel, expectedBaseSeed)
  assert.equal(state.currentLevel, expectedLevel, `${label}: currentLevel=${expectedLevel}`)
  assert.equal(state.baseSeed, expectedBaseSeed, `${label}: baseSeed=${expectedBaseSeed}`)
  assert.equal(state.seed, cfg.seed, `${label}: seed matches deterministic getLevelSeed`)
  assert.equal(state.maze.level, expectedLevel, `${label}: maze.level=${expectedLevel}`)
  assert.equal(state.maze.currentLevel, expectedLevel, `${label}: maze.currentLevel=${expectedLevel}`)
  assert.equal(state.maze.seed, cfg.seed, `${label}: maze.seed matches state.seed`)
  assert.equal(state.maze.baseSeed, expectedBaseSeed, `${label}: maze.baseSeed matches state.baseSeed`)
  assert.equal(state.maze.rows, cfg.rows, `${label}: maze.rows=${cfg.rows}`)
  assert.equal(state.maze.cols, cfg.cols, `${label}: maze.cols=${cfg.cols}`)
  assert.deepStrictEqual(state.maze.dimensions, cfg.dimensions, `${label}: maze.dimensions synchronized`)
  assert.equal(state.maze.braidFactor, cfg.braidFactor, `${label}: maze.braidFactor synchronized`)
  assert.equal(state.maze.id, `maze-L${expectedLevel}-${cfg.rows}x${cfg.cols}-${cfg.seed}`, `${label}: maze.id synchronized`)
}

// ---------------------------------------------------------------------------
// 1. ADVANCE_LEVEL: Level 1 -> 2 and multiple consecutive levels
// ---------------------------------------------------------------------------
console.log('Test 1: ADVANCE_LEVEL from 1 -> 2 and consecutive levels 2 -> 6')
const baseSeed = 771234
let state = createInitialGameState({ currentLevel: 1, baseSeed, maxHealth: 120, maxBattery: 110 })
assertSynchronizedLevelMetadata(state, 1, baseSeed, 'Initial L1')

// Dirty transient state before advancing
state = dirtyGameplayState(state)
const advanceAction12 = createAdvanceLevelAction(state)
assert.equal(advanceAction12.type, LEVEL_TRANSITION_ACTIONS.ADVANCE_LEVEL, 'Action creator emits ADVANCE_LEVEL')
assert.equal(advanceAction12.level, 2, 'Action targets Level 2')
assert.ok(advanceAction12.maze && Array.isArray(advanceAction12.maze.grid), 'Maze generated outside reducer')

const level2State = gameReducer(state, advanceAction12)
assert.equal(level2State.maze, advanceAction12.maze, 'Reducer reuses pre-generated maze without regenerating')
assert.equal(level2State.runId, state.runId + 1, 'ADVANCE_LEVEL increments runId')
assert.equal(level2State.maxHealth, 120, 'ADVANCE_LEVEL preserves maxHealth')
assert.equal(level2State.maxBattery, 110, 'ADVANCE_LEVEL preserves maxBattery')
assertSynchronizedLevelMetadata(level2State, 2, baseSeed, 'L1->L2')
assertTransientStateReset(level2State, 'L1->L2')

// Advance consecutively through Levels 3, 4, 5, 6 (reaching 17x17 at Level 6)
let cur = level2State
for (const expectedLevel of [3, 4, 5, 6]) {
  cur = dirtyGameplayState(cur)
  const action = createAdvanceLevelAction(cur)
  const next = gameReducer(cur, action)
  assert.equal(next.runId, cur.runId + 1, `L${expectedLevel}: runId increments`)
  assertSynchronizedLevelMetadata(next, expectedLevel, baseSeed, `L${expectedLevel - 1}->L${expectedLevel}`)
  assertTransientStateReset(next, `L${expectedLevel - 1}->L${expectedLevel}`)
  cur = next
}
assert.equal(cur.maze.rows, 17, 'Level 6 reaches 17x17 progressive dimensions')
assert.equal(cur.maze.cols, 17, 'Level 6 reaches 17x17 progressive dimensions')

// Attempting to pass an arbitrary level on ADVANCE_LEVEL still strictly advances by +1
const forcedNext = gameReducer(level2State, { type: 'ADVANCE_LEVEL', level: 99 })
assert.equal(forcedNext.currentLevel, 3, 'ADVANCE_LEVEL strictly advances to currentLevel + 1 (3), ignoring skip')

// ---------------------------------------------------------------------------
// 2. REPLAY_LEVEL: Preserves level, baseSeed, seed, maze identity & resets run state
// ---------------------------------------------------------------------------
console.log('Test 2: REPLAY_LEVEL preserves level and maze identity while resetting run state')
const scoreBeforeReplay = calculateRunScore({
  maze: cur.maze,
  completionTimeMs: 25000,
  shardsCollected: 2,
  totalShards: cur.totalShards,
  health: cur.health,
  maxHealth: cur.maxHealth,
  keysCollected: cur.keysCollected,
  totalKeys: cur.totalKeys,
  objectivesEnabled: cur.objectivesEnabled,
})
const priorVictorySummary = { ...scoreBeforeReplay, runId: cur.runId }
const dirtyLevel6 = dirtyGameplayState({
  ...cur,
  isGameOver: true,
  hasWon: false,
})

const replayAction = createReplayLevelAction(dirtyLevel6)
assert.equal(replayAction.type, LEVEL_TRANSITION_ACTIONS.REPLAY_LEVEL, 'Action creator emits REPLAY_LEVEL')

const replayedState = gameReducer(dirtyLevel6, replayAction)
assert.equal(replayedState.currentLevel, 6, 'REPLAY_LEVEL preserves currentLevel 6')
assert.equal(replayedState.baseSeed, baseSeed, 'REPLAY_LEVEL preserves baseSeed')
assert.equal(replayedState.seed, cur.seed, 'REPLAY_LEVEL preserves level seed')
assert.equal(replayedState.maze, cur.maze, 'REPLAY_LEVEL preserves exact maze object identity')
assert.equal(replayedState.maze.id, cur.maze.id, 'REPLAY_LEVEL preserves maze.id')
assert.equal(replayedState.runId, cur.runId + 1, 'REPLAY_LEVEL increments runId')
assert.equal(replayedState.maxHealth, 120, 'REPLAY_LEVEL preserves maxHealth')
assert.equal(replayedState.maxBattery, 110, 'REPLAY_LEVEL preserves maxBattery')
assertTransientStateReset(replayedState, 'REPLAY_LEVEL')
assert.equal(
  resolveVictorySummary(priorVictorySummary, replayedState.runId, replayedState.hasWon),
  null,
  'Old victory summary is invalidated after REPLAY_LEVEL'
)

// Timer resets when runId changes
let clockMs = 1000
const runTimer = createRunTimer({ now: () => clockMs })
runTimer.start()
clockMs = 5500
assert.ok(runTimer.getElapsedMs() >= 4500, 'Timer accumulates elapsed time during run')
runTimer.reset({ autoStart: false })
clockMs = 6000
assert.equal(runTimer.getElapsedMs(), 0, 'Timer resets to 0 on level transition/replay')

// ---------------------------------------------------------------------------
// 3. NEW_GAME: Fresh game at Level 1 with newly established baseSeed
// ---------------------------------------------------------------------------
console.log('Test 3: NEW_GAME starts fresh at Level 1 with a new baseSeed')
const generatedSeed1 = generateFreshBaseSeed(baseSeed)
assert.ok(Number.isInteger(generatedSeed1) && generatedSeed1 > 0, 'generateFreshBaseSeed produces positive integer')
assert.notEqual(generatedSeed1, baseSeed, 'generateFreshBaseSeed avoids repeating previousBaseSeed')

const newGameAction = createNewGameAction(cur)
assert.equal(newGameAction.type, LEVEL_TRANSITION_ACTIONS.NEW_GAME, 'Action creator emits NEW_GAME')
assert.equal(newGameAction.level, 1, 'NEW_GAME targets Level 1')
assert.notEqual(newGameAction.baseSeed, cur.baseSeed, 'NEW_GAME establishes a new baseSeed')
assert.equal(newGameAction.seed, newGameAction.baseSeed, 'NEW_GAME Level 1 seed equals its new baseSeed')
assert.ok(newGameAction.maze && newGameAction.maze.rows === 11, 'NEW_GAME generates Level 1 11x11 maze outside reducer')

const newGameState = gameReducer(dirtyLevel6, newGameAction)
assert.equal(newGameState.maze, newGameAction.maze, 'Reducer uses pre-generated NEW_GAME maze')
assert.equal(newGameState.runId, dirtyLevel6.runId + 1, 'NEW_GAME advances runId monotonically so hooks reset')
assert.equal(newGameState.maxHealth, 100, 'NEW_GAME restores default maxHealth 100')
assert.equal(newGameState.maxBattery, 100, 'NEW_GAME restores default maxBattery 100')
assertSynchronizedLevelMetadata(newGameState, 1, newGameAction.baseSeed, 'NEW_GAME')
assertTransientStateReset(newGameState, 'NEW_GAME')

// Sequential NEW_GAME invocations generate distinct fresh baseSeeds
const newGameAction2 = createNewGameAction({ previousBaseSeed: newGameState.baseSeed })
assert.notEqual(newGameAction2.baseSeed, newGameState.baseSeed, 'Subsequent NEW_GAME establishes another new baseSeed')

// ---------------------------------------------------------------------------
// 4. Reducer purity (React StrictMode double-invocation & deterministic fallback)
// ---------------------------------------------------------------------------
console.log('Test 4: Reducer purity across double-invocations')
const advAction = createAdvanceLevelAction(newGameState)
const advA = gameReducer(newGameState, advAction)
const advB = gameReducer(newGameState, advAction)
assert.deepStrictEqual(advA, advB, 'ADVANCE_LEVEL with identical state & action is 100% pure/deterministic')
assert.equal(advA.maze, advB.maze, 'Both StrictMode calls share identical maze reference')

const ngPureA = gameReducer(cur, { type: 'NEW_GAME' })
const ngPureB = gameReducer(cur, { type: 'NEW_GAME' })
assert.deepStrictEqual(ngPureA, ngPureB, 'Direct NEW_GAME dispatch without random side effect is 100% pure/deterministic')
assert.equal(ngPureA.currentLevel, 1, 'Direct NEW_GAME starts at Level 1')
assert.notEqual(ngPureA.baseSeed, cur.baseSeed, 'Direct NEW_GAME establishes a new baseSeed')

// ---------------------------------------------------------------------------
// 5. Legacy compatibility (NEW_MAZE, RESET_RUN, SET_LEVEL)
// ---------------------------------------------------------------------------
console.log('Test 5: Legacy action compatibility (NEW_MAZE, RESET_RUN, SET_LEVEL)')
const l1Default = createInitialGameState(INITIAL_SEED)
const viaNewMaze = gameReducer(l1Default, { type: 'NEW_MAZE' })
assertSynchronizedLevelMetadata(viaNewMaze, 2, INITIAL_SEED, 'Legacy NEW_MAZE')

const viaResetRun = gameReducer(dirtyGameplayState(viaNewMaze), { type: 'RESET_RUN' })
assert.equal(viaResetRun.currentLevel, 2, 'Legacy RESET_RUN preserves level 2')
assert.equal(viaResetRun.maze, viaNewMaze.maze, 'Legacy RESET_RUN preserves maze identity')
assertTransientStateReset(viaResetRun, 'Legacy RESET_RUN')

const setLvlAction = createSetLevelAction(l1Default, 25)
const viaSetLevel = gameReducer(l1Default, setLvlAction)
assertSynchronizedLevelMetadata(viaSetLevel, 25, INITIAL_SEED, 'createSetLevelAction(25)')
assert.equal(viaSetLevel.maze.rows, 31, 'Level 25 has 31x31 maze')

const viaDirectSetLevel = gameReducer(l1Default, { type: 'SET_LEVEL', level: 5000 })
assertSynchronizedLevelMetadata(viaDirectSetLevel, 5000, INITIAL_SEED, 'Direct SET_LEVEL(5000)')
assert.equal(viaDirectSetLevel.maze.rows, 51, 'Level 5000 respects 51x51 ceiling')

// ---------------------------------------------------------------------------
// 6. Three.js MazeSceneEngine integration for REPLAY_LEVEL, ADVANCE_LEVEL, NEW_GAME
// ---------------------------------------------------------------------------
console.log('Test 6: MazeSceneEngine reset & transition integration')
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
    enemies: { autoSpawn: true },
    createRenderer: () => mockRenderer,
    skipSpawnSequence: true,
    ...config,
  })
}

const engine = createHeadlessEngine()

const startState = createInitialGameState({ currentLevel: 1, baseSeed: 314159 })
engine.setMaze(startState.maze)

const startWorld = gridToWorld(startState.maze.start.row, startState.maze.start.col, startState.maze)
const exitWorld = gridToWorld(startState.maze.exit.row, startState.maze.exit.col, startState.maze)

// Mutate player position, battery, stamina, flashlight, health, hazards, enemies, collectibles
engine.setPlayerWorldPosition(exitWorld.x, 0, exitWorld.z, { immediate: true })
engine.stamina = 12
engine.isExhausted = true
engine.setBattery(15)
engine.toggleFlashlight()
engine.health = 25
engine.isGameOver = true
engine.hasWon = true
const hazards = engine.hazardManager?.getHazards?.() || []
if (hazards.length > 0 && typeof hazards[0].disable === 'function') {
  hazards[0].disable()
}
engine.syncCollectibles({
  items: startState.items.slice(1),
  echoPath: [startState.maze.start, startState.maze.exit],
  spawnBursts: false,
})

// REPLAY_LEVEL transition on engine
const replayedEngineState = gameReducer(startState, createReplayLevelAction(startState))
engine.syncCollectibles({
  items: replayedEngineState.items,
  keycards: replayedEngineState.keycards,
  echoPath: replayedEngineState.echoPath,
  spawnBursts: false,
  isReset: true,
})
engine.setExitLocked(replayedEngineState.isExitLocked, { animate: false })
engine.resetCombat({
  preserveSpawnSequence: true,
  restartSpawnSequence: !engine.config?.skipSpawnSequence,
  resetPlayerPosition: true,
})

const posAfterReplay = engine.getPlayerWorldPosition()
assert.ok(
  Math.abs(posAfterReplay.x - startWorld.x) < 1e-4 &&
    Math.abs(posAfterReplay.z - startWorld.z) < 1e-4,
  'Engine REPLAY_LEVEL returns player to maze.start even when skipSpawnSequence is true'
)
assert.equal(engine.health, engine.maxHealth, 'Engine REPLAY_LEVEL restores health')
assert.equal(engine.stamina, engine.maxStamina, 'Engine REPLAY_LEVEL restores stamina')
assert.equal(engine.isExhausted, false, 'Engine REPLAY_LEVEL clears exhaustion')
assert.equal(engine.battery, engine.maxBattery, 'Engine REPLAY_LEVEL restores battery')
assert.equal(engine.flashlightActive, false, 'Engine REPLAY_LEVEL turns flashlight off')
assert.equal(engine.isGameOver, false, 'Engine REPLAY_LEVEL clears isGameOver')
assert.equal(engine.hasWon, false, 'Engine REPLAY_LEVEL clears hasWon')
assert.equal(
  engine.getCollectibleManager().getCounts().items,
  replayedEngineState.maze.collectibles.items.length,
  'Engine REPLAY_LEVEL restores all collectibles'
)
assert.equal(
  engine.getCollectibleManager().getCounts().echoMarkers,
  0,
  'Engine REPLAY_LEVEL clears echo path markers'
)
if (hazards.length > 0) {
  assert.equal(hazards[0].getState(), HAZARD_STATES.DORMANT, 'Engine REPLAY_LEVEL restores hazards to DORMANT')
}

// ADVANCE_LEVEL transition on engine (Level 1 -> Level 2)
const advEngineAction = createAdvanceLevelAction(replayedEngineState)
const advEngineState = gameReducer(replayedEngineState, advEngineAction)
engine.setMaze(advEngineState.maze)
const l2StartWorld = gridToWorld(advEngineState.maze.start.row, advEngineState.maze.start.col, advEngineState.maze)
const posAfterAdvance = engine.getPlayerWorldPosition()
assert.ok(
  Math.abs(posAfterAdvance.x - l2StartWorld.x) < 1e-4 &&
    Math.abs(posAfterAdvance.z - l2StartWorld.z) < 1e-4,
  'Engine ADVANCE_LEVEL spawns player at Level 2 start'
)
assert.equal(
  engine.getCollectibleManager().getCounts().items,
  advEngineState.maze.collectibles.items.length,
  'Engine ADVANCE_LEVEL mounts Level 2 collectibles cleanly'
)

// NEW_GAME transition on engine
const ngEngineAction = createNewGameAction(advEngineState)
const ngEngineState = gameReducer(advEngineState, ngEngineAction)
engine.setMaze(ngEngineState.maze)
assert.equal(ngEngineState.currentLevel, 1, 'Engine NEW_GAME returns to Level 1')
assert.notEqual(ngEngineState.baseSeed, advEngineState.baseSeed, 'Engine NEW_GAME uses fresh baseSeed')
assert.equal(
  engine.getCollectibleManager().getCounts().items,
  ngEngineState.maze.collectibles.items.length,
  'Engine NEW_GAME mounts fresh Level 1 collectibles'
)

engine.dispose()
console.log('--- ALL LEVEL TRANSITION TESTS PASSED! ---')
