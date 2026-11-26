import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import {
  formatHudLevelAriaLabel,
  formatHudLevelDisplay,
  resolveAuthoritativeHudLevel,
} from '../../components/game/levelHudFormat.js'
import { resolveVictoryModalViewModel } from '../../components/game/victoryModalState.js'
import {
  ELEVATOR_TRANSITION_PHASES,
  advanceElevatorTransitionToOpening,
  advanceElevatorTransitionToTraveling,
  beginElevatorTransitionState,
  createIdleElevatorTransitionState,
  finishElevatorTransitionState,
  markElevatorTransitionMazeCommitted,
  markElevatorTransitionSceneReady,
} from '../engine/elevatorLevelTransition.js'
import {
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  createSetLevelAction,
  gameReducer,
  generateFreshBaseSeed,
} from '../engine/gameReducer.js'
import {
  ARRIVAL_ENTRY_PATHS,
  ARRIVAL_SEQUENCE_PHASES,
  beginArrivalSequenceState,
  cancelArrivalSequenceState,
  computeInterLevelArrivalCameraPose,
  createIdleArrivalState,
  finishArrivalSequenceState,
  resolveArrivalConfig,
  resolveInterLevelArrivalPhase,
  updateArrivalPhaseState,
} from '../engine/levelArrivalSequence.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { getLevelConfig, getLevelSeed } from '../mechanics/levelProgression.js'
import {
  applyMinimapRevealEffects,
  buildMinimapSnapshot,
  createExplorationState,
} from '../mechanics/minimap.js'
import {
  calculateParTimeMs,
  calculateRunScore,
  resolveAuthoritativeHudScore,
} from '../mechanics/scoring.js'
import { computeWayfinderHint } from '../mechanics/wayfinder.js'
import { getEnemyPoolStats } from './buildEnemy.js'
import { getHazardPoolStats } from './buildHazards.js'
import { getCollectiblePoolStats } from './buildCollectibles.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { getMazeSurfacePoolStats } from './mazeSurfaceTextures.js'
import {
  disposeAllSharedPools,
  getActiveSharedPoolOwnerCount,
} from './sharedResources.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SRC_ROOT = path.resolve(__dirname, '../..')

const LEVEL_MILESTONES = Object.freeze([
  1, 2, 5, 6, 10, 11, 15, 16, 20, 21, 25, 26, 50, 100, 500, 1000, 5000, 5001, 100000,
])

function createMockRenderer() {
  return {
    domElement: { style: {} },
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    pixelRatio: 1,
    shadowMap: { enabled: false, type: null, needsUpdate: false },
    info: {
      memory: { geometries: 0, textures: 0 },
      render: { calls: 0, triangles: 0 },
    },
    setPixelRatio(r) {
      this.pixelRatio = r
    },
    setSize() {},
    render() {},
    dispose() {},
    getContext() {
      return null
    },
  }
}

function createHeadlessEngine(config = {}) {
  const host = {
    appendChild() {},
    removeChild() {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  const renderer = createMockRenderer()
  const engine = new MazeSceneEngine(host, {
    createRenderer: () => renderer,
    isSoftwareGl: false,
    lowPerformance: false,
    ...config,
  })
  return { engine, renderer }
}

function completeLevelViaReducer(state, completionTimeMs = 45000) {
  let cur = state
  for (const kc of cur.keycards || []) {
    cur = gameReducer(cur, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: kc.row, col: kc.col },
    })
  }
  cur = gameReducer(cur, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: cur.maze.exit.row, col: cur.maze.exit.col },
    completionTimeMs,
  })
  cur = gameReducer(cur, {
    type: 'COMPLETE_EXIT_EXTRACTION',
    completionTimeMs,
  })
  cur = gameReducer(cur, {
    type: 'FINALIZE_LEVEL_SCORE',
    runId: cur.runId,
    completionTimeMs,
  })
  return cur
}

console.log('--- RUNNING INFINITE PROGRESSION COMPLETE REGRESSION AUDIT (MAZE-PROGRESSION-REGRESSION-001) ---')
disposeAllSharedPools()

// =============================================================================
// 1. Core Progression State Machine, Anti-Farming Replay & Unbounded Scaling
// =============================================================================
{
  console.log('Section 1: Core progression lifecycle, Replay anti-farming & Level 5000 -> 5001 -> 100001')
  const baseSeed = 884213
  let state = createInitialGameState({ level: 1, baseSeed, objectivesEnabled: true })
  assert.equal(state.currentLevel, 1, 'New Game always starts at Level 1')
  assert.equal(state.maze.level, 1, 'Generated maze reflects Level 1')
  assert.equal(state.levelsCompleted, 0, 'Fresh run starts with 0 completed levels')
  assert.equal(state.cumulativeScore, 0, 'Fresh run starts with 0 cumulativeScore')
  assert.equal(state.hasWon, false)

  // Keycard gating: reaching exit while keys remain must not trigger victory
  if (state.totalKeys > 0) {
    const lockedAttempt = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: state.maze.exit.row, col: state.maze.exit.col },
    })
    assert.equal(lockedAttempt.hasWon, false, 'Exit stays locked before collecting all keycards')
    assert.equal(lockedAttempt.levelsCompleted, 0)
  }

  // Advance guard: cannot advance without victory when requireVictory=true
  const blockedAdvance = gameReducer(
    state,
    createAdvanceLevelAction(state, { requireVictory: true })
  )
  assert.equal(blockedAdvance.currentLevel, 1, 'ADVANCE_LEVEL blocked before victory')

  // Win Level 1 cleanly
  const won1 = completeLevelViaReducer(state, 32000)
  assert.equal(won1.hasWon, true)
  assert.equal(won1.levelsCompleted, 1, 'levelsCompleted increments once on victory')
  const scoreAfterL1 = won1.cumulativeScore
  assert.ok(scoreAfterL1 > 0, 'Winning Level 1 awards positive cumulativeScore')

  // Replay Level 1 after victory MUST roll back levelsCompleted and cumulativeScore cleanly (anti-farming)
  const replayedL1 = gameReducer(won1, createReplayLevelAction(won1, { guardRunId: true }))
  assert.equal(replayedL1.currentLevel, 1, 'REPLAY_LEVEL preserves currentLevel 1')
  assert.equal(replayedL1.seed, won1.seed, 'REPLAY_LEVEL preserves level seed')
  assert.equal(replayedL1.hasWon, false)
  assert.equal(replayedL1.levelsCompleted, 0, 'REPLAY_LEVEL rolls back levelsCompleted for won run (no double count)')
  assert.equal(replayedL1.cumulativeScore, 0, 'REPLAY_LEVEL rolls back cumulativeScore to levelBaseCumulativeScore')
  assert.equal(replayedL1.completedLevelScores[1], undefined, 'REPLAY_LEVEL clears prior completedLevelScores[1]')

  // Re-winning replayed Level 1 restores levelsCompleted === 1 (not 2!)
  const rewon1 = completeLevelViaReducer(replayedL1, 31000)
  assert.equal(rewon1.levelsCompleted, 1, 'Re-winning replayed Level 1 yields exact levelsCompleted === 1')
  const rewonL1Score = rewon1.cumulativeScore

  // Advance Level 1 -> Level 2 -> Level 3 and verify cumulative progression
  const stateL2 = gameReducer(rewon1, createAdvanceLevelAction(rewon1, { requireVictory: true }))
  assert.equal(stateL2.currentLevel, 2)
  assert.equal(stateL2.maze.level, 2)
  assert.equal(stateL2.levelsCompleted, 1)
  assert.equal(stateL2.levelBaseCumulativeScore, rewonL1Score)
  assert.equal(stateL2.cumulativeScore, rewonL1Score)

  // Mid-level restart (before winning) preserves levelsCompleted and base score
  const midRestartL2 = gameReducer(stateL2, createReplayLevelAction(stateL2))
  assert.equal(midRestartL2.currentLevel, 2)
  assert.equal(midRestartL2.levelsCompleted, 1, 'Mid-level restart keeps completed count intact')
  assert.equal(midRestartL2.cumulativeScore, rewonL1Score)

  const won2 = completeLevelViaReducer(midRestartL2, 41000)
  assert.equal(won2.levelsCompleted, 2)
  assert.ok(won2.cumulativeScore > rewonL1Score, 'Level 2 adds to cumulativeScore')

  // Unbounded advancement across 5000 -> 5001 and 100000 -> 100001
  for (const jumpStart of [5000, 100000]) {
    let highState = gameReducer(won2, createSetLevelAction(won2, jumpStart))
    assert.equal(highState.currentLevel, jumpStart)
    assert.equal(highState.maze.level, jumpStart)
    const highWon = completeLevelViaReducer(highState, 60000)
    assert.equal(highWon.hasWon, true)
    const highNext = gameReducer(
      highWon,
      createAdvanceLevelAction(highWon, { requireVictory: true })
    )
    assert.equal(highNext.currentLevel, jumpStart + 1, `Progression continues cleanly past Level ${jumpStart}`)
    assert.equal(highNext.maze.level, jumpStart + 1)
  }

  // New Game resets everything completely back to Level 1
  const freshBase = generateFreshBaseSeed(won2.baseSeed)
  const freshRun = gameReducer(
    won2,
    createNewGameAction({ baseSeed: freshBase })
  )
  assert.equal(freshRun.currentLevel, 1)
  assert.equal(freshRun.levelsCompleted, 0)
  assert.equal(freshRun.highestLevelReached, 1)
  assert.equal(freshRun.cumulativeScore, 0)
  assert.equal(freshRun.levelBaseCumulativeScore, 0)
  assert.deepEqual(freshRun.completedLevelScores, {})
  assert.equal(freshRun.lastLevelScoreSummary, null)
  assert.equal(freshRun.hasWon, false)
  console.log('✓ Section 1 passed')
}

// =============================================================================
// 2. Complete Level Milestone Matrix & Maze Generation Audit
// =============================================================================
const milestoneResults = []
{
  console.log('Section 2: Verifying Level Milestone Matrix [1..100000]')
  const matrixBaseSeed = 515051
  const seenLevelSeeds = new Set()

  for (const level of LEVEL_MILESTONES) {
    const cfg = getLevelConfig(level, matrixBaseSeed)
    const seed = getLevelSeed(level, matrixBaseSeed)
    assert.equal(cfg.level, level)
    assert.equal(cfg.seed, seed)
    assert.equal(seenLevelSeeds.has(seed), false, `Unique deterministic seed at Level ${level}`)
    seenLevelSeeds.add(seed)

    assert.ok(cfg.rows >= 11 && cfg.cols >= 11, `Level ${level} minimum dimensions >= 11x11`)
    assert.equal(cfg.rows % 2, 1, `Level ${level} rows odd`)
    assert.equal(cfg.cols % 2, 1, `Level ${level} cols odd`)
    assert.ok(cfg.rows <= 55 && cfg.cols <= 55, `Level ${level} bounded under safety cap (${cfg.rows}x${cfg.cols})`)

    const mazeA = generateMaze({ level, baseSeed: matrixBaseSeed })
    const mazeB = generateMaze({ level, baseSeed: matrixBaseSeed })
    assert.equal(mazeA.level, level)
    assert.equal(mazeA.rows, cfg.rows)
    assert.equal(mazeA.cols, cfg.cols)
    assert.deepEqual(mazeA.grid, mazeB.grid, `Level ${level} maze grid deterministic`)
    assert.deepEqual(mazeA.keycards, mazeB.keycards, `Level ${level} keycards deterministic`)
    assert.deepEqual(mazeA.enemies, mazeB.enemies, `Level ${level} enemies deterministic`)
    assert.deepEqual(mazeA.hazards, mazeB.hazards, `Level ${level} hazards deterministic`)
    assert.deepEqual(mazeA.hidingSpots, mazeB.hidingSpots, `Level ${level} hidingSpots deterministic`)

    // Reachability: start -> every keycard -> exit
    const startToExit = findShortestPath(mazeA.grid, mazeA.start, mazeA.exit)
    assert.equal(startToExit.found, true, `Level ${level} start -> exit reachable`)
    for (const kc of mazeA.keycards || []) {
      const pKey = findShortestPath(mazeA.grid, mazeA.start, kc)
      assert.equal(pKey.found, true, `Level ${level} keycard reachable from start`)
    }

    // No entity overlapping start or exit
    const isStartOrExit = (r, c) =>
      (r === mazeA.start.row && c === mazeA.start.col) ||
      (r === mazeA.exit.row && c === mazeA.exit.col)
    for (const h of mazeA.hazards || []) {
      assert.equal(isStartOrExit(h.row, h.col), false, `Level ${level} hazard clear of start/exit`)
    }
    for (const e of mazeA.enemies || []) {
      assert.equal(
        e.row === mazeA.start.row && e.col === mazeA.start.col,
        false,
        `Level ${level} enemy clear of start cell`
      )
    }

    const parTimeMs = calculateParTimeMs({
      maze: mazeA,
      level,
      optimalPathLength: startToExit.distance,
    })
    assert.ok(Number.isFinite(parTimeMs) && parTimeMs > 0, `Level ${level} finite parTimeMs`)

    const scoreSummary = calculateRunScore({
      maze: mazeA,
      level,
      completionTimeMs: Math.round(parTimeMs * 0.85),
      shardsCollected: mazeA.collectibles?.items?.filter((i) => i.type === 'soul_shards').length || 0,
      totalShards: mazeA.collectibles?.items?.filter((i) => i.type === 'soul_shards').length || 0,
      health: 100,
      maxHealth: 100,
      keysCollected: mazeA.keycards?.length || 0,
      totalKeys: mazeA.keycards?.length || 0,
      objectivesEnabled: true,
    })
    assert.ok(Number.isFinite(scoreSummary.score) && scoreSummary.score > 0)
    assert.ok(scoreSummary.stars >= 1 && scoreSummary.stars <= 3)

    // HUD formatting check at every milestone
    const hudLabel = formatHudLevelDisplay(level)
    if (level < 10) {
      assert.equal(hudLabel, `LEVEL 0${level}`)
    } else {
      assert.equal(hudLabel, `LEVEL ${level}`)
    }
    assert.equal(formatHudLevelAriaLabel(level), `Current level: Level ${level}`)

    // Minimap + Wayfinder check at every milestone
    const exp = createExplorationState(mazeA, { revealStart: false })
    assert.equal(exp.discoveredCount, 0)
    const rev = applyMinimapRevealEffects(exp, mazeA, {
      playerCell: mazeA.start,
      items: mazeA.collectibles?.items || [],
      keycards: mazeA.keycards || [],
    })
    assert.ok(rev.newlyRevealed > 0, `Level ${level} minimap discovers start neighborhood`)
    assert.ok(exp.discoveredCount >= 9)
    const wfLocked = computeWayfinderHint({
      maze: mazeA,
      playerCell: mazeA.start,
      keycards: mazeA.keycards || [],
      objectivesEnabled: true,
      isExitLocked: (mazeA.keycards?.length || 0) > 0,
    })
    assert.equal(wfLocked.found, true, `Level ${level} wayfinder finds objective`)
    const snap = buildMinimapSnapshot({
      maze: mazeA,
      exploration: exp,
      playerCell: mazeA.start,
      items: mazeA.collectibles?.items || [],
      keycards: mazeA.keycards || [],
      objectivesEnabled: true,
      isExitLocked: (mazeA.keycards?.length || 0) > 0,
    })
    assert.equal(snap.rows, mazeA.rows)
    assert.equal(snap.cols, mazeA.cols)

    milestoneResults.push({
      level,
      dims: `${mazeA.rows}x${mazeA.cols}`,
      keycards: mazeA.keycards?.length || 0,
      enemies: mazeA.enemies?.length || 0,
      hazards: mazeA.hazards?.length || 0,
      hidingSpots: mazeA.hidingSpots?.length || 0,
      parTimeSec: Math.round(parTimeMs / 1000),
      hudLabel,
    })
  }
  console.log('✓ Section 2 milestone matrix passed for all', LEVEL_MILESTONES.length, 'milestones')
}

// =============================================================================
// 3. Elevator Transition & Arrival State Machines + Headless Scene Engine
// =============================================================================
{
  console.log('Section 3: Elevator transitions, arrival handoff & 3D scene resource lifecycle')

  // State machine transitions
  for (const [fromLevel, toLevel] of [[1, 2], [10, 11], [5000, 5001]]) {
    let t = createIdleElevatorTransitionState()
    t = beginElevatorTransitionState(t, { fromLevel, toLevel, sourceRunId: 1, transitionId: 1 })
    assert.equal(t.phase, ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS)
    t = advanceElevatorTransitionToTraveling(t)
    assert.equal(t.phase, ELEVATOR_TRANSITION_PHASES.TRAVELING)
    t = markElevatorTransitionMazeCommitted(t)
    t = markElevatorTransitionSceneReady(t)
    t = advanceElevatorTransitionToOpening(t)
    assert.equal(t.phase, ELEVATOR_TRANSITION_PHASES.OPENING_DOORS)
    t = finishElevatorTransitionState(t)
    assert.equal(t.active, false)
    assert.equal(t.phase, ELEVATOR_TRANSITION_PHASES.IDLE)

    const arrivalCfg = resolveArrivalConfig({ startOverlayMinMs: 40 }, false)
    let arr = createIdleArrivalState()
    arr = beginArrivalSequenceState(arr, {
      entryPath: ARRIVAL_ENTRY_PATHS.NEXT_LEVEL,
      phase: resolveInterLevelArrivalPhase(t, arrivalCfg),
      level: toLevel,
      runId: 2,
      arrivalId: 1,
    })
    arr = updateArrivalPhaseState(arr, ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF, {
      cameraHandoffProgress: 0.65,
    })
    const pose = computeInterLevelArrivalCameraPose({
      active: true,
      phase: ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF,
      doorProgress: 0.3,
    })
    assert.equal(pose.active, true)
    assert.ok(Number.isFinite(pose.handoffProgress))
    arr = cancelArrivalSequenceState(arr, { timedOut: false })
    assert.equal(arr.active, false)
    arr = finishArrivalSequenceState(arr)
    assert.equal(arr.active, false)
  }

  // Headless MazeSceneEngine across Level 1 -> 2 -> 6 -> 16 -> 5000 -> 5001
  const { engine } = createHeadlessEngine({
    graphics: { qualityPreset: 'performance' },
  })
  try {
    let baselinePoolEntries = null
    for (const level of [1, 2, 6, 16, 5000, 5001]) {
      const maze = generateMaze({ level, baseSeed: 777111 })
      engine.setMaze(maze)
      assert.equal(engine._currentMaze.level, level)
      assert.equal(engine.isSpawnSequenceActive(), true, `Level ${level} starts arrival spawn protection`)
      assert.equal(engine.applyDamage(20, { enemyId: 'test' }), false, 'Arrival protection blocks damage')

      const pCell = engine.getPlayerGridCell()
      assert.deepEqual(pCell, maze.start, `Level ${level} spawns player at elevator start cell`)

      engine.cancelSpawnSequence()
      assert.equal(engine.isSpawnSequenceActive(), false)
      engine.stepFrame(0.016, { render: false })

      const poolStats = getMazeSurfacePoolStats()
      if (baselinePoolEntries === null) {
        baselinePoolEntries = poolStats.entries
      } else {
        // Note: ceiling_collapse uses performance preset cleanly (no 'balanced' leak!)
        assert.equal(
          poolStats.entries,
          baselinePoolEntries,
          `Level ${level} performance preset preserves exact surface pool count (${poolStats.entries} === ${baselinePoolEntries})`
        )
      }
    }

    // Confirm performance-preset buildMazeMeshes leaves zero leak on manual disposal
    const extraMaze = generateMaze({ level: 100000, baseSeed: 99999 })
    const extraGroup = buildMazeMeshes(extraMaze, { qualityPreset: 'performance' })
    assert.ok(extraGroup)
    disposeMazeGroup(extraGroup)
  } finally {
    engine.dispose()
  }

  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'All shared pools released cleanly')
  assert.equal(getMazeSurfacePoolStats().entries, 0, 'Surface texture pool empty after dispose')
  assert.equal(getHazardPoolStats().geometries, 0, 'Hazard geometry pool empty after dispose')
  assert.equal(getEnemyPoolStats().geometries, 0, 'Enemy geometry pool empty after dispose')
  assert.equal(getCollectiblePoolStats().geometries, 0, 'Collectible geometry pool empty after dispose')
  console.log('✓ Section 3 engine lifecycle & zero-leak checks passed')
}

// =============================================================================
// 4. Legacy Difficulty Removal Check & Victory / HUD Summary Consistency
// =============================================================================
{
  console.log('Section 4: Difficulty selector removal & Victory/HUD ViewModel checks')
  const startScreenSrc = fs.readFileSync(path.join(SRC_ROOT, 'components/game/StartScreen.jsx'), 'utf8')
  const settingsConfigSrc = fs.readFileSync(path.join(SRC_ROOT, 'components/settings/settingsConfig.js'), 'utf8')
  const pauseScreenSrc = fs.readFileSync(path.join(SRC_ROOT, 'components/game/PauseScreen.jsx'), 'utf8')

  assert.equal(startScreenSrc.includes('data-difficulty'), false, 'StartScreen has zero difficulty selector')
  assert.equal(settingsConfigSrc.includes("id: 'difficulty'"), false, 'Settings schema has zero difficulty option')
  assert.equal(pauseScreenSrc.includes('data-difficulty'), false, 'PauseScreen has zero difficulty selector')

  // Authoritative HUD & Victory modal view model check at Level 5000 -> 5001
  const state5000 = completeLevelViaReducer(
    createInitialGameState({ level: 5000, baseSeed: 12345, objectivesEnabled: true }),
    48000
  )
  const vm = resolveVictoryModalViewModel({
    isPlaying: true,
    isLevelTransitioning: false,
    state: state5000,
    victorySummary: state5000.lastLevelScoreSummary,
    formattedTime: '00:48',
  })
  assert.equal(vm.isOpen, true)
  assert.equal(vm.completedLevel, 5000)
  assert.equal(vm.nextLevel, 5001)
  assert.equal(resolveAuthoritativeHudLevel({ currentLevel: 5000, maze: state5000.maze }), 5000)
  assert.equal(resolveAuthoritativeHudScore({ state: state5000 }), state5000.cumulativeScore)
  console.log('✓ Section 4 UI & ViewModel checks passed')
}

console.log('\n--- LEVEL MILESTONE MATRIX SUMMARY ---')
for (const row of milestoneResults) {
  console.log(
    `L${String(row.level).padEnd(6)} | ${row.hudLabel.padEnd(12)} | dims=${row.dims.padEnd(5)} | keys=${row.keycards} | enemies=${String(row.enemies).padEnd(2)} | hazards=${String(row.hazards).padEnd(2)} | hiding=${String(row.hidingSpots).padEnd(2)} | par=${row.parTimeSec}s`
  )
}
console.log('\nALL MAZE-PROGRESSION-REGRESSION-001 CHECKS PASSED!')
