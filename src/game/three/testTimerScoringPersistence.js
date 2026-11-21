import assert from 'node:assert/strict'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { createRunTimer, formatElapsedTime } from '../mechanics/runTimer.js'
import {
  calculateParTimeMs,
  calculateRunScore,
  calculateStarRating,
} from '../mechanics/scoring.js'
import * as persistence from '../../utils/persistence.js'

const {
  loadPreferences,
  savePreferences,
  STORAGE_KEYS,
} = persistence

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    dump() {
      return Object.fromEntries(store.entries())
    },
  }
}

console.log('--- Running Phase E Prompt 06 Tests: Timer, Scoring, Star Rating & Persistence ---')

// ---------------------------------------------------------------------------
// 1. Live Run Timer & Reducer runId Sync
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Run timer formatting, pause/resume without drift, tab hiding & reset')

  assert.equal(formatElapsedTime(0), '00:00.0')
  assert.equal(formatElapsedTime(-250), '00:00.0')
  assert.equal(formatElapsedTime(NaN), '00:00.0')
  assert.equal(formatElapsedTime(99), '00:00.0')
  assert.equal(formatElapsedTime(100), '00:00.1')
  assert.equal(formatElapsedTime(65432), '01:05.4')
  assert.equal(formatElapsedTime(602999), '10:02.9')

  let mockClock = 1000
  const timer = createRunTimer({ now: () => mockClock })

  assert.equal(timer.getElapsedMs(), 0)
  assert.equal(timer.getState().hasStarted, false)

  // Gameplay begins
  timer.start()
  mockClock += 2450
  assert.equal(timer.getElapsedMs(), 2450)
  assert.equal(timer.getFormattedTime(), '00:02.4')

  // Pause during modal / menu / tab hiding — advance clock while paused
  timer.pause()
  mockClock += 15000
  assert.equal(timer.getElapsedMs(), 2450)
  assert.equal(timer.getState().isPaused, true)
  assert.equal(timer.getState().isRunning, false)

  // Resume gameplay cleanly with zero drift
  timer.resume()
  mockClock += 1650
  assert.equal(timer.getElapsedMs(), 4100)
  assert.equal(timer.getFormattedTime(), '00:04.1')

  // sync() helper simulates modal/tab-hide/victory transitions
  timer.sync(false) // e.g., tab hidden or modal opened
  mockClock += 8000
  assert.equal(timer.getElapsedMs(), 4100)

  timer.sync(true) // resumed
  mockClock += 900
  assert.equal(timer.getElapsedMs(), 5000)
  assert.equal(timer.getFormattedTime(), '00:05.0')

  // Reset on replay / new maze
  timer.reset({ autoStart: false })
  assert.equal(timer.getElapsedMs(), 0)
  assert.equal(timer.getFormattedTime(), '00:00.0')
  assert.equal(timer.getState().hasStarted, false)

  // Reducer increments runId on replay, new maze, and difficulty switch
  let state = createInitialGameState('medium', 409217)
  const initialRunId = state.runId
  assert.equal(initialRunId, 1)

  state = gameReducer(state, { type: 'RESET_RUN' })
  assert.equal(state.runId, initialRunId + 1)

  state = gameReducer(state, { type: 'NEW_MAZE' })
  assert.equal(state.runId, initialRunId + 2)

  state = gameReducer(state, { type: 'SET_DIFFICULTY', difficulty: 'hard' })
  assert.equal(state.runId, initialRunId + 3)
  assert.equal(state.difficulty, 'hard')
  assert.equal(state.maze.rows, 23)

  state = gameReducer(state, { type: 'SET_DIFFICULTY', difficulty: 'hardcore' })
  assert.equal(state.runId, initialRunId + 4)
  assert.equal(state.difficulty, 'hardcore')
  assert.equal(state.maze.rows, 31)
  assert.equal(state.maze.cols, 31)

  // Legacy difficulty keys normalize cleanly without breaking
  state = gameReducer(state, { type: 'SET_DIFFICULTY', difficulty: 'small' })
  assert.equal(state.difficulty, 'easy')
  assert.equal(state.maze.rows, 11)
  state = gameReducer(state, { type: 'SET_DIFFICULTY', difficulty: 'large' })
  assert.equal(state.difficulty, 'hard')
  assert.equal(state.maze.rows, 23)

  console.log('✓ Timer formatting, pause/resume drift-free math, reset, and reducer runId verified')
}

// ---------------------------------------------------------------------------
// 2. Performance Scoring & 1–3 Star Rating
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Scoring breakdown, star rating boundaries, 2D/3D objectives & fairness')

  const easyMaze = generateMaze({ difficulty: 'easy', seed: 101010 })
  const mediumMaze = generateMaze({ difficulty: 'medium', seed: 202020 })
  const hardMaze = generateMaze({ difficulty: 'hard', seed: 303030 })
  const hardcoreMaze = generateMaze({ difficulty: 'hardcore', seed: 404040 })

  assert.equal(easyMaze.rows, 11)
  assert.equal(mediumMaze.rows, 17)
  assert.equal(hardMaze.rows, 23)
  assert.equal(hardcoreMaze.rows, 31)
  assert.equal(hardcoreMaze.cols, 31)

  const easyParNoObj = calculateParTimeMs({
    difficulty: 'easy',
    parMoves: easyMaze.parMoves,
    objectivesEnabled: false,
  })
  const easyParWithObj = calculateParTimeMs({
    difficulty: 'easy',
    parMoves: easyMaze.parMoves,
    objectivesEnabled: true,
    totalKeys: easyMaze.keycards.length,
  })
  assert.ok(
    easyParWithObj > easyParNoObj,
    'Par time should allow extra time when Resonance Keycards are enabled'
  )

  const hardParWithObj = calculateParTimeMs({
    difficulty: 'hard',
    parMoves: hardMaze.parMoves,
    objectivesEnabled: true,
    totalKeys: hardMaze.keycards.length,
  })
  const hardcoreParWithObj = calculateParTimeMs({
    difficulty: 'hardcore',
    parMoves: hardcoreMaze.parMoves,
    objectivesEnabled: true,
    totalKeys: hardcoreMaze.keycards.length,
  })
  assert.ok(
    hardcoreParWithObj > hardParWithObj,
    'Hardcore par time scales above Hard par time for 31×31 and 4 keycards'
  )

  // Star boundaries
  assert.equal(calculateStarRating(0.95), 3)
  assert.equal(calculateStarRating(0.72), 3)
  assert.equal(calculateStarRating(0.719), 2)
  assert.equal(calculateStarRating(0.42), 2)
  assert.equal(calculateStarRating(0.419), 1)
  assert.equal(calculateStarRating(0), 1)

  // Strong 3-star run vs 2-star run vs 1-star run
  const parMs = calculateParTimeMs({
    difficulty: 'medium',
    parMoves: mediumMaze.parMoves,
    objectivesEnabled: true,
    totalKeys: 2,
  })

  const threeStarRun = calculateRunScore({
    difficulty: 'medium',
    maze: mediumMaze,
    completionTimeMs: Math.round(parMs * 0.7),
    coinsCollected: mediumMaze.collectibles.coins.length,
    totalCoins: mediumMaze.collectibles.coins.length,
    health: 100,
    maxHealth: 100,
    keysCollected: 2,
    totalKeys: 2,
    objectivesEnabled: true,
  })
  assert.equal(threeStarRun.stars, 3)
  assert.equal(threeStarRun.beatPar, true)
  assert.ok(threeStarRun.breakdown.keycardBonus > 0)
  assert.equal(
    threeStarRun.score,
    threeStarRun.breakdown.baseScore +
      threeStarRun.breakdown.timeBonus +
      threeStarRun.breakdown.coinBonus +
      threeStarRun.breakdown.healthBonus +
      threeStarRun.breakdown.keycardBonus
  )

  const twoStarRun = calculateRunScore({
    difficulty: 'medium',
    maze: mediumMaze,
    completionTimeMs: Math.round(parMs * 1.45),
    coinsCollected: Math.floor(mediumMaze.collectibles.coins.length * 0.5),
    totalCoins: mediumMaze.collectibles.coins.length,
    health: 60,
    maxHealth: 100,
    keysCollected: 2,
    totalKeys: 2,
    objectivesEnabled: true,
  })
  assert.equal(twoStarRun.stars, 2)
  assert.equal(twoStarRun.beatPar, false)
  assert.ok(threeStarRun.score > twoStarRun.score)

  const oneStarRun = calculateRunScore({
    difficulty: 'medium',
    maze: mediumMaze,
    completionTimeMs: Math.round(parMs * 3.0),
    coinsCollected: 0,
    totalCoins: mediumMaze.collectibles.coins.length,
    health: 20,
    maxHealth: 100,
    keysCollected: 2,
    totalKeys: 2,
    objectivesEnabled: true,
  })
  assert.equal(oneStarRun.stars, 1)
  assert.ok(twoStarRun.score > oneStarRun.score)

  // Difficulty fairness: identical relative skill yields consistent 3-star rating across Easy/Medium/Hard/Hardcore
  let previousScore = 0
  for (const [diff, mazeObj] of [
    ['easy', easyMaze],
    ['medium', mediumMaze],
    ['hard', hardMaze],
    ['hardcore', hardcoreMaze],
  ]) {
    const objKeys = mazeObj.keycards.length
    const fairPar = calculateParTimeMs({
      difficulty: diff,
      parMoves: mazeObj.parMoves,
      objectivesEnabled: true,
      totalKeys: objKeys,
    })
    const res3D = calculateRunScore({
      difficulty: diff,
      maze: mazeObj,
      completionTimeMs: Math.round(fairPar * 0.8),
      coinsCollected: Math.round(mazeObj.collectibles.coins.length * 0.75),
      totalCoins: mazeObj.collectibles.coins.length,
      health: 90,
      maxHealth: 100,
      keysCollected: objKeys,
      totalKeys: objKeys,
      objectivesEnabled: true,
    })
    assert.equal(res3D.stars, 3, `Expected 3 stars on ${diff} 3D at 80% par / 75% coins / 90% HP`)
    assert.ok(
      res3D.score > previousScore,
      `Expected ${diff} score (${res3D.score}) to exceed prior tier (${previousScore})`
    )
    previousScore = res3D.score

    // 2D mode without keycards at same relative quality also earns 3 stars
    const fairPar2D = calculateParTimeMs({
      difficulty: diff,
      parMoves: mazeObj.parMoves,
      objectivesEnabled: false,
    })
    const res2D = calculateRunScore({
      difficulty: diff,
      maze: mazeObj,
      completionTimeMs: Math.round(fairPar2D * 0.8),
      coinsCollected: Math.round(mazeObj.collectibles.coins.length * 0.75),
      totalCoins: mazeObj.collectibles.coins.length,
      health: 100,
      maxHealth: 100,
      objectivesEnabled: false,
    })
    assert.equal(res2D.stars, 3, `Expected 3 stars on ${diff} 2D`)
    assert.equal(res2D.breakdown.keycardBonus, 0)
  }

  console.log('✓ Scoring calculation, star boundaries, 2D/3D support, and difficulty fairness verified')
}

// ---------------------------------------------------------------------------
// 3. Records Feature Removal Regression Check
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Dedicated Records persistence APIs and storage keys are removed')

  assert.equal(persistence.STORAGE_KEYS.RECORDS, undefined)
  assert.equal(persistence.loadRecords, undefined)
  assert.equal(persistence.savePersonalBest, undefined)
  assert.equal(persistence.clearRecords, undefined)
  assert.equal(persistence.createEmptyRecords, undefined)

  console.log('✓ Dedicated Records persistence exports and storage key confirmed removed')
}

// ---------------------------------------------------------------------------
// 4. User Preferences Persistence & Corrupted / Unavailable Storage Handling
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Preference persistence and corrupted / unavailable localStorage resilience')

  const storage = createMockStorage()

  const customPrefs = {
    audioVolumes: {
      master: 0.65,
      ambience: 0.3,
      effects: 0.9,
      music: 0.4,
      muted: true,
    },
    cameraMode: 'third-person',
    horrorConfig: {
      intensity: 'high',
      visualScaresEnabled: false,
      reducedMotion: true,
    },
    controlSettings: {
      mouseSensitivity: 0.0033,
      touchLookSensitivity: 2.7,
      invertY: true,
      touchControls: 'always',
    },
  }

  const saveRes = savePreferences(customPrefs, storage)
  assert.equal(saveRes.saved, true)

  const loaded = loadPreferences(storage)
  assert.deepEqual(loaded, customPrefs)

  // Corrupted JSON falls back cleanly without crashing
  const corruptStorage = createMockStorage({
    [STORAGE_KEYS.PREFERENCES]: '{corrupt-json!!!',
  })
  const fallbackPrefs = loadPreferences(corruptStorage)
  assert.equal(fallbackPrefs.cameraMode, 'first-person')
  assert.equal(fallbackPrefs.audioVolumes.muted, false)

  // Partial field corruption preserves valid fields and repairs invalid ones
  const partialCorruptStorage = createMockStorage({
    [STORAGE_KEYS.PREFERENCES]: JSON.stringify({
      audioVolumes: { master: 99, ambience: 'broken', muted: true },
      cameraMode: 'invalid-camera',
      horrorConfig: { intensity: 'extreme', reducedMotion: true },
      controlSettings: { mouseSensitivity: -10, invertY: true, touchControls: 'invalid' },
    }),
  })
  const repaired = loadPreferences(partialCorruptStorage)
  assert.equal(repaired.audioVolumes.master, 1) // clamped to 1
  assert.equal(repaired.audioVolumes.ambience, 0.55) // default restored
  assert.equal(repaired.audioVolumes.muted, true) // valid boolean kept
  assert.equal(repaired.cameraMode, 'first-person') // default restored
  assert.equal(repaired.horrorConfig.intensity, 'medium') // default restored
  assert.equal(repaired.horrorConfig.reducedMotion, true) // valid boolean kept
  assert.equal(repaired.controlSettings.mouseSensitivity, 0.0005) // clamped min
  assert.equal(repaired.controlSettings.invertY, true) // valid boolean kept
  assert.equal(repaired.controlSettings.touchControls, 'auto') // default restored

  // Unavailable or throwing storage never crashes gameplay
  assert.equal(loadPreferences(null).cameraMode, 'first-person')

  const throwingStorage = {
    getItem() {
      throw new Error('SecurityError: storage blocked')
    },
    setItem() {
      throw new Error('QuotaExceededError: storage full')
    },
    removeItem() {
      throw new Error('SecurityError')
    },
  }

  const failedSavePrefs = savePreferences(customPrefs, throwingStorage)
  assert.equal(failedSavePrefs.saved, false)
  assert.equal(failedSavePrefs.preferences.cameraMode, 'third-person')

  console.log('✓ Preferences persistence, sanitization, and unavailable storage fallback verified')
}

console.log('=== All Phase E Prompt 06 Tests Passed ===')
