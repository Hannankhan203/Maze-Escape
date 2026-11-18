import assert from 'node:assert/strict'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { createRunTimer, formatElapsedTime } from '../mechanics/runTimer.js'
import {
  calculateParTimeMs,
  calculateRunScore,
  calculateStarRating,
} from '../mechanics/scoring.js'
import {
  clearRecords,
  loadPreferences,
  loadRecords,
  savePersonalBest,
  savePreferences,
  STORAGE_KEYS,
} from '../../utils/persistence.js'

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

  state = gameReducer(state, { type: 'SET_DIFFICULTY', difficulty: 'large' })
  assert.equal(state.runId, initialRunId + 3)

  console.log('✓ Timer formatting, pause/resume drift-free math, reset, and reducer runId verified')
}

// ---------------------------------------------------------------------------
// 2. Performance Scoring & 1–3 Star Rating
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Scoring breakdown, star rating boundaries, 2D/3D objectives & fairness')

  const smallMaze = generateMaze({ difficulty: 'small', seed: 101010 })
  const mediumMaze = generateMaze({ difficulty: 'medium', seed: 202020 })
  const largeMaze = generateMaze({ difficulty: 'large', seed: 303030 })

  const smallParNoObj = calculateParTimeMs({
    difficulty: 'small',
    parMoves: smallMaze.parMoves,
    objectivesEnabled: false,
  })
  const smallParWithObj = calculateParTimeMs({
    difficulty: 'small',
    parMoves: smallMaze.parMoves,
    objectivesEnabled: true,
    totalKeys: smallMaze.keycards.length,
  })
  assert.ok(
    smallParWithObj > smallParNoObj,
    'Par time should allow extra time when Resonance Keycards are enabled'
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

  // Difficulty fairness: identical relative skill yields consistent 3-star rating across Small/Medium/Large
  for (const [diff, mazeObj] of [
    ['small', smallMaze],
    ['medium', mediumMaze],
    ['large', largeMaze],
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
// 3. Local Persistence: Personal Bests & Non-Overwrite Rule
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Personal best records persist per difficulty and never overwrite with worse results')

  const storage = createMockStorage()

  // Initial empty state
  const empty = loadRecords(storage)
  assert.deepEqual(empty, { small: null, medium: null, large: null })

  // Save first record on small
  const first = savePersonalBest(
    'small',
    { timeMs: 28400, score: 2650, stars: 3 },
    storage
  )
  assert.equal(first.saved, true)
  assert.equal(first.isNewBestTime, true)
  assert.equal(first.isNewBestScore, true)
  assert.equal(first.isNewBestStars, true)
  assert.equal(first.record.bestTimeMs, 28400)
  assert.equal(first.record.bestScore, 2650)
  assert.equal(first.record.bestStars, 3)
  assert.equal(first.record.completions, 1)

  // Worse run on small must NOT overwrite faster time, higher score, or higher stars
  const worse = savePersonalBest(
    'small',
    { timeMs: 54000, score: 1500, stars: 1 },
    storage
  )
  assert.equal(worse.isNewBestTime, false)
  assert.equal(worse.isNewBestScore, false)
  assert.equal(worse.isNewBestStars, false)
  assert.equal(worse.record.bestTimeMs, 28400)
  assert.equal(worse.record.bestScore, 2650)
  assert.equal(worse.record.bestStars, 3)
  assert.equal(worse.record.completions, 2)

  // Mixed run (faster time ONLY, lower score) updates only bestTimeMs
  const fasterOnly = savePersonalBest(
    'small',
    { timeMs: 22100, score: 2400, stars: 2 },
    storage
  )
  assert.equal(fasterOnly.isNewBestTime, true)
  assert.equal(fasterOnly.isNewBestScore, false)
  assert.equal(fasterOnly.isNewBestStars, false)
  assert.equal(fasterOnly.record.bestTimeMs, 22100)
  assert.equal(fasterOnly.record.bestScore, 2650)
  assert.equal(fasterOnly.record.bestStars, 3)

  // Separate difficulty records remain independent
  savePersonalBest('large', { timeMs: 91200, score: 4200, stars: 2 }, storage)
  const reloaded = loadRecords(storage)
  assert.equal(reloaded.small.bestTimeMs, 22100)
  assert.equal(reloaded.medium, null)
  assert.equal(reloaded.large.bestScore, 4200)

  clearRecords(storage)
  assert.deepEqual(loadRecords(storage), { small: null, medium: null, large: null })

  console.log('✓ Personal best persistence and better-record preservation verified')
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
    [STORAGE_KEYS.RECORDS]: 'not-an-object',
  })
  const fallbackPrefs = loadPreferences(corruptStorage)
  assert.equal(fallbackPrefs.cameraMode, 'first-person')
  assert.equal(fallbackPrefs.audioVolumes.muted, false)
  assert.deepEqual(loadRecords(corruptStorage), {
    small: null,
    medium: null,
    large: null,
  })

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
  assert.deepEqual(loadRecords(null), { small: null, medium: null, large: null })
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
  assert.deepEqual(loadRecords(throwingStorage), {
    small: null,
    medium: null,
    large: null,
  })
  const failedSaveRec = savePersonalBest(
    'medium',
    { timeMs: 30000, score: 2000, stars: 2 },
    throwingStorage
  )
  assert.equal(failedSaveRec.saved, false)
  assert.equal(failedSaveRec.record.bestScore, 2000)

  const failedSavePrefs = savePreferences(customPrefs, throwingStorage)
  assert.equal(failedSavePrefs.saved, false)
  assert.equal(failedSavePrefs.preferences.cameraMode, 'third-person')

  console.log('✓ Preferences persistence, sanitization, and unavailable storage fallback verified')
}

console.log('=== All Phase E Prompt 06 Tests Passed ===')
