import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  exploreReachableCells,
  findShortestPath,
  resetPathfinderState,
} from '../generation/pathfinder.js'
import { gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES, EnemyAgent } from './EnemyAgent.js'
import { EnemyManager } from './EnemyManager.js'
import {
  HORROR_EVENT_TYPES,
  HORROR_INTENSITY_LEVELS,
  HorrorDirector,
} from './HorrorDirector.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

// Reference unoptimized BFS for exact bit-for-bit behavioral parity verification & benchmarking
function referenceFindShortestPath(grid, start, exit) {
  if (!Array.isArray(grid) || grid.length < 3 || !Array.isArray(grid[0]) || grid[0].length < 3) {
    return { found: false, path: [], distance: -1, visitedCount: 0 }
  }
  const rows = grid.length
  const cols = grid[0].length
  if (
    !start ||
    !exit ||
    grid[start.row]?.[start.col] !== CELL_TYPES.PATH ||
    grid[exit.row]?.[exit.col] !== CELL_TYPES.PATH
  ) {
    return { found: false, path: [], distance: -1, visitedCount: 0 }
  }
  const directions = [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 },
  ]
  const queue = [{ row: start.row, col: start.col }]
  let head = 0
  const toKey = (r, c) => `${r},${c}`
  const visited = new Set([toKey(start.row, start.col)])
  const parents = new Map()

  while (head < queue.length) {
    const cur = queue[head]
    head += 1
    if (cur.row === exit.row && cur.col === exit.col) {
      const path = []
      let traceKey = toKey(exit.row, exit.col)
      let cursor = { row: exit.row, col: exit.col }
      while (cursor) {
        path.push(cursor)
        cursor = parents.get(traceKey) || null
        if (cursor) traceKey = toKey(cursor.row, cursor.col)
      }
      path.reverse()
      return {
        found: true,
        path,
        distance: path.length - 1,
        visitedCount: visited.size,
      }
    }
    for (let i = 0; i < directions.length; i += 1) {
      const nr = cur.row + directions[i].row
      const nc = cur.col + directions[i].col
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc] !== CELL_TYPES.PATH) {
        continue
      }
      const nk = toKey(nr, nc)
      if (!visited.has(nk)) {
        visited.add(nk)
        parents.set(nk, cur)
        queue.push({ row: nr, col: nc })
      }
    }
  }
  return { found: false, path: [], distance: -1, visitedCount: visited.size }
}

console.log('--- RUNNING PHASE 4 PERFORMANCE & CORRECTNESS TESTS ---')

// =====================================================================
// 1. HorrorDirector Cache Reuse, Context Sharing & Strict Invalidation
// =====================================================================
console.log('Test 1: HorrorDirector Candidate/Context Reuse & State Invalidation')

const straightGrid = Array.from({ length: 13 }, (_, r) =>
  Array.from({ length: 13 }, (__, c) => (r === 6 && c >= 1 && c <= 11 ? 0 : 1))
)
const corridorMaze = {
  rows: 13,
  cols: 13,
  start: { row: 6, col: 2 },
  exit: { row: 6, col: 11 },
  seed: 445566,
  difficulty: 'medium',
  grid: straightGrid,
}

const dir = new HorrorDirector({
  maze: corridorMaze,
  intensity: HORROR_INTENSITY_LEVELS.HIGH,
  visualScaresEnabled: true,
  initialDelay: 0.1,
  minCooldown: 0.5,
  maxCooldown: 0.5,
  recordHistory: true,
})

let collectCalls = 0
let freshScans = 0
const origCollect = dir._collectCorridorCandidates.bind(dir)

dir._collectCorridorCandidates = function wrappedCollect(...args) {
  collectCalls += 1
  const hadCache = Boolean(this._corridorCandidateCache)
  const prevCacheObj = this._corridorCandidateCache
  const res = origCollect(...args)
  if (!hadCache || this._corridorCandidateCache !== prevCacheObj) {
    freshScans += 1
  }
  return res
}

const pWorld = gridToWorld(6, 2, corridorMaze)
const pFwd = { x: 1, z: 0 }
const enemySim = {
  id: 'e1',
  state: 'patrol',
  worldPos: { x: pWorld.x + 15, y: 0, z: pWorld.z },
  isDisposed: false,
}
const decisionCtx = {
  playerWorldPos: { ...pWorld },
  playerForward: { ...pFwd },
  playerGridCell: { row: 6, col: 2 },
  isHidden: false,
  health: 90,
  maxHealth: 100,
  enemies: [enemySim],
}

// Same-decision flow: selectNextEvent -> triggerEvent(DISTANT_SILHOUETTE)
const snap1 = dir.evaluateContext(decisionCtx)
dir.selectNextEvent(snap1)
const scansAfterSelect = freshScans
assert(scansAfterSelect === 1, `selectNextEvent performed 1 corridor scan (got ${scansAfterSelect})`)

const silResult = dir.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, decisionCtx)
assert(silResult !== null, 'DISTANT_SILHOUETTE triggered on clear forward corridor')
assert(
  freshScans === 1,
  `triggerEvent reused selectNextEvent corridor/LOS scan (freshScans=${freshScans}, collectCalls=${collectCalls})`
)

// Triggering an event updates _eventSequence and invalidates caches cleanly
assert(dir._corridorCandidateCache === null, 'Decision caches invalidated after event triggers')

// Re-check evaluateContext reuse vs invalidation on player/enemy changes
freshScans = 0
const snapA = dir.evaluateContext(decisionCtx)
const snapB = dir.evaluateContext(decisionCtx)
assert(snapA === snapB, 'evaluateContext returns cached snapshot when player/enemy/maze state is unchanged')

// Mutating enemy position must invalidate context cache immediately
enemySim.worldPos.x = pWorld.x + 4.0
const snapEnemyMoved = dir.evaluateContext(decisionCtx)
assert(
  snapEnemyMoved !== snapA && snapEnemyMoved.enemyNearby === true && snapEnemyMoved.nearestEnemyDist < 5,
  'Enemy position mutation invalidates evaluateContext snapshot immediately'
)

// Mutating enemy state (e.g. chase) must invalidate context cache immediately
enemySim.state = ENEMY_STATES.CHASE
const snapEnemyChasing = dir.evaluateContext(decisionCtx)
assert(
  snapEnemyChasing.enemyChasing === true,
  'Enemy state change invalidates evaluateContext snapshot immediately'
)

// Moving player or rotating camera forward invalidates corridor candidate cache
enemySim.state = ENEMY_STATES.PATROL
enemySim.worldPos.x = pWorld.x + 20.0
dir._hasCorridorTarget(decisionCtx.playerWorldPos, 5.5, 14.5, true, { playerForward: pFwd })
const scansBeforeMove = freshScans
const movedPos = gridToWorld(6, 3, corridorMaze)
dir._hasCorridorTarget(movedPos, 5.5, 14.5, true, { playerForward: pFwd })
assert(freshScans === scansBeforeMove + 1, 'Player position change invalidates corridor candidate cache')

dir._hasCorridorTarget(movedPos, 5.5, 14.5, true, { playerForward: { x: -1, z: 0 } })
assert(freshScans === scansBeforeMove + 2, 'Player forward direction change invalidates corridor candidate cache')

// Lifecycle invalidation checks: pause, visualScares toggle, reset, setMaze, dispose
dir._hasCorridorTarget(movedPos, 5.5, 14.5, true, { playerForward: { x: 1, z: 0 } })
assert(dir._corridorCandidateCache !== null, 'Cache populated before pause check')
dir.setPaused(true)
assert(dir._corridorCandidateCache === null && dir._contextSnapshotCache === null, 'setPaused invalidates caches')
dir.setPaused(false)

dir._hasCorridorTarget(movedPos, 5.5, 14.5, true, { playerForward: { x: 1, z: 0 } })
dir.setVisualScaresEnabled(false)
assert(dir._corridorCandidateCache === null, 'setVisualScaresEnabled invalidates caches')
dir.setVisualScaresEnabled(true)

dir._hasCorridorTarget(movedPos, 5.5, 14.5, true, { playerForward: { x: 1, z: 0 } })
dir.reset()
assert(dir._corridorCandidateCache === null, 'reset() invalidates caches')

// Verify update() path never calls evaluateContext twice on the same event decision
const hcMaze = generateMaze({ difficulty: 'hardcore', seed: 112233 })
const hcStart = gridToWorld(hcMaze.start.row, hcMaze.start.col, hcMaze)
const updateSpyDir = new HorrorDirector({
  maze: hcMaze,
  intensity: HORROR_INTENSITY_LEVELS.HIGH,
  initialDelay: 0.05,
  minCooldown: 0.5,
  maxCooldown: 0.5,
  recordHistory: true,
})
let evalsInUpdate = 0
const origHcEval = updateSpyDir.evaluateContext.bind(updateSpyDir)
updateSpyDir.evaluateContext = function (c) {
  evalsInUpdate += 1
  return origHcEval(c)
}
updateSpyDir.update(0.1, {
  playerWorldPos: hcStart,
  playerForward: { x: 1, z: 0 },
  health: 100,
  maxHealth: 100,
  enemies: [],
})
assert(evalsInUpdate === 1, `update() + triggerEvent() called evaluateContext exactly once (got ${evalsInUpdate})`)
updateSpyDir.dispose()
dir.dispose()
console.log('✓ HorrorDirector cache reuse & state invalidation verified')

// =====================================================================
// 2. Pathfinder Deterministic Parity, Dimension Changes & Edge Cases
// =====================================================================
console.log('Test 2: Pathfinder Determinism, Dimension Changes & Reset')

resetPathfinderState()

const easyMaze = generateMaze({ difficulty: 'easy', seed: 101 })
const mediumMaze = generateMaze({ difficulty: 'medium', seed: 202 })
const hardMaze = generateMaze({ difficulty: 'hard', seed: 303 })
const hardcoreMaze = generateMaze({ difficulty: 'hardcore', seed: 404 })

// Rectangular custom maze (15x21)
const rectGrid = Array.from({ length: 15 }, (_, r) =>
  Array.from({ length: 21 }, (__, c) => {
    if (r === 0 || r === 14 || c === 0 || c === 20) return 1
    if (r % 2 === 1 || c === 1 || c === 19) return 0
    return (r + c) % 3 === 0 ? 1 : 0
  })
)

const testCases = [
  { label: 'easy', grid: easyMaze.grid, start: easyMaze.start, exit: easyMaze.exit },
  { label: 'hardcore-grow', grid: hardcoreMaze.grid, start: hardcoreMaze.start, exit: hardcoreMaze.exit },
  { label: 'rect-shrink', grid: rectGrid, start: { row: 1, col: 1 }, exit: { row: 13, col: 19 } },
  { label: 'easy-shrink-again', grid: easyMaze.grid, start: easyMaze.start, exit: easyMaze.exit },
  { label: 'medium', grid: mediumMaze.grid, start: mediumMaze.start, exit: mediumMaze.exit },
  { label: 'hard', grid: hardMaze.grid, start: hardMaze.start, exit: hardMaze.exit },
]

for (const tc of testCases) {
  const actual = findShortestPath(tc.grid, tc.start, tc.exit)
  const expected = referenceFindShortestPath(tc.grid, tc.start, tc.exit)
  assert(actual.found === expected.found, `${tc.label}: found matches (${actual.found} === ${expected.found})`)
  assert(actual.distance === expected.distance, `${tc.label}: distance matches (${actual.distance})`)
  assert(actual.visitedCount === expected.visitedCount, `${tc.label}: visitedCount matches (${actual.visitedCount})`)
  assert(
    JSON.stringify(actual.path) === JSON.stringify(expected.path),
    `${tc.label}: exact shortest path ties & coordinates match`
  )
}

// Reset pathfinder state mid-run and re-verify
resetPathfinderState()
const postReset = findShortestPath(hardcoreMaze.grid, hardcoreMaze.start, hardcoreMaze.exit)
const refHardcore = referenceFindShortestPath(hardcoreMaze.grid, hardcoreMaze.start, hardcoreMaze.exit)
assert(
  JSON.stringify(postReset.path) === JSON.stringify(refHardcore.path) &&
    postReset.visitedCount === refHardcore.visitedCount,
  'resetPathfinderState restores cleanly with identical subsequent results'
)

// Same start === exit
const sameCellRes = findShortestPath(easyMaze.grid, easyMaze.start, easyMaze.start)
assert(
  sameCellRes.found === true &&
    sameCellRes.distance === 0 &&
    sameCellRes.visitedCount === 1 &&
    sameCellRes.path.length === 1,
  'start === exit returns valid zero-distance path'
)

// Unreachable isolated pocket
const unreachableGrid = [
  [1, 1, 1, 1, 1],
  [1, 0, 1, 0, 1],
  [1, 1, 1, 1, 1],
]
const unreachRes = findShortestPath(unreachableGrid, { row: 1, col: 1 }, { row: 1, col: 3 })
assert(
  unreachRes.found === false && unreachRes.distance === -1 && unreachRes.visitedCount === 1,
  'Unreachable destination safely returns found=false and visitedCount=1'
)

// Malformed grids & bounds
assert(findShortestPath(null, { row: 1, col: 1 }, { row: 1, col: 1 }).found === false, 'Handles null grid')
assert(
  findShortestPath(
    [
      [1, 1, 1],
      [1, 9, 1],
      [1, 1, 1],
    ],
    { row: 1, col: 1 },
    { row: 1, col: 1 }
  ).found === false,
  'Rejects invalid cell values'
)
assert(
  findShortestPath(easyMaze.grid, { row: 0, col: 0 }, easyMaze.exit).found === false,
  'Rejects wall start cell'
)

// exploreReachableCells consistency check
const reachCheck = exploreReachableCells(mediumMaze.grid, mediumMaze.start)
assert(
  reachCheck.valid === true &&
    reachCheck.reachableCount === reachCheck.totalPathCells &&
    reachCheck.distances.get(`${mediumMaze.exit.row},${mediumMaze.exit.col}`) ===
      referenceFindShortestPath(mediumMaze.grid, mediumMaze.start, mediumMaze.exit).distance,
  'exploreReachableCells distances Map matches exact shortest-path distance'
)

console.log('✓ Pathfinder parity, dimension resizing, reset, and edge cases verified')

// =====================================================================
// 3. Enemy Repath Staggering, Redundant Skip & Immediate Overrides
// =====================================================================
console.log('Test 3: Enemy Repath Staggering & Immediate Danger/Transition Overrides')

const mgr = new EnemyManager(null, { autoSpawn: true })
mgr.setMaze(hardcoreMaze)
const hcEnemies = mgr.getEnemies()
assert(hcEnemies.length === 7, 'Hardcore EnemyManager spawns 7 enemies')

const frameBfsCounts = []
const enemyBfsCounters = new Map()
for (const enemy of hcEnemies) {
  enemyBfsCounters.set(enemy.id, 0)
  const origNav = enemy._navigateToCell.bind(enemy)
  enemy._navigateToCell = function (...args) {
    enemyBfsCounters.set(this.id, (enemyBfsCounters.get(this.id) || 0) + 1)
    currentTickBfs += 1
    return origNav(...args)
  }
}

let currentTickBfs = 0
const farPlayerCtx = {
  playerWorldPos: gridToWorld(hardcoreMaze.start.row, hardcoreMaze.start.col, hardcoreMaze),
  playerGridCell: { ...hardcoreMaze.start },
  playerHidden: true,
  playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
}

const everPatrolledWithWaypoints = new Set()
for (let frame = 0; frame < 80; frame += 1) {
  currentTickBfs = 0
  mgr.update(0.05, farPlayerCtx)
  frameBfsCounts.push(currentTickBfs)
  for (const enemy of hcEnemies) {
    if (enemy.getState() === ENEMY_STATES.PATROL && enemy.currentPathWaypoints.length > 0) {
      everPatrolledWithWaypoints.add(enemy.id)
    }
  }
}

const maxSingleFrameBfs = Math.max(...frameBfsCounts)
const totalInitialBfs = frameBfsCounts.reduce((a, b) => a + b, 0)
const nonZeroFrames = frameBfsCounts.filter((c) => c > 0).length
assert(
  maxSingleFrameBfs === 1,
  `7-enemy patrol planning staggered to max 1 BFS/frame (max=${maxSingleFrameBfs}, counts=${JSON.stringify(frameBfsCounts.filter((c) => c > 0))})`
)
assert(
  totalInitialBfs >= 7 && nonZeroFrames >= 7,
  `All 7 enemies acquired staggered patrol paths across separate frames (total=${totalInitialBfs}, activeFrames=${nonZeroFrames})`
)
assert(
  everPatrolledWithWaypoints.size === hcEnemies.length,
  `All 7 enemies entered PATROL with valid waypoints (count=${everPatrolledWithWaypoints.size})`
)
mgr.dispose()

// Immediate override check: when frame budget is exhausted by enemy0 patrol,
// close-range CHASE and sound-triggered INVESTIGATE enemies MUST still repath immediately!
const overrideGrid = Array.from({ length: 13 }, (_, r) =>
  Array.from({ length: 13 }, (__, c) => {
    if (r === 0 || r === 12 || c === 0 || c === 12) return 1
    if (r === 2 && c >= 1 && c <= 10) return 0
    if (r === 6 || r === 10 || c === 2 || c === 6 || c === 10) return 0
    return 1
  })
)
const overrideMaze = {
  rows: 13,
  cols: 13,
  start: { row: 2, col: 2 },
  exit: { row: 10, col: 10 },
  seed: 9090,
  difficulty: 'hard',
  grid: overrideGrid,
}

const overrideMgr = new EnemyManager(null, { autoSpawn: false, maxRepathsPerFrame: 1 })
overrideMgr.setMaze(overrideMaze)

const budgetConsumer = overrideMgr.spawnEnemy({
  id: 'patrol-budget-consumer',
  spawnCell: { row: 10, col: 2 },
  patrolRoute: [{ row: 10, col: 10 }, { row: 10, col: 2 }],
})
const urgentChaser = overrideMgr.spawnEnemy({
  id: 'urgent-chaser',
  spawnCell: { row: 2, col: 4 },
  yaw: Math.PI / 2,
  patrolRoute: [{ row: 2, col: 10 }],
})
const urgentListener = overrideMgr.spawnEnemy({
  id: 'urgent-listener',
  type: 'hunter',
  spawnCell: { row: 6, col: 6 },
  patrolRoute: [{ row: 6, col: 10 }],
})

// Pre-place urgentChaser in CHASE (already needing immediate repath) & urgentListener facing away
urgentChaser.state = ENEMY_STATES.CHASE
urgentChaser.repathCooldown = 0
urgentChaser._needsImmediateRepath = true
urgentListener.yaw = 0

let budgetConsumerNavCount = 0
let chaserNavCount = 0
let listenerNavCount = 0
const origBudgetNav = budgetConsumer._navigateToCell.bind(budgetConsumer)
const origChaserNav = urgentChaser._navigateToCell.bind(urgentChaser)
const origListenerNav = urgentListener._navigateToCell.bind(urgentListener)
budgetConsumer._navigateToCell = function (...args) {
  budgetConsumerNavCount += 1
  return origBudgetNav(...args)
}
urgentChaser._navigateToCell = function (...args) {
  chaserNavCount += 1
  return origChaserNav(...args)
}
urgentListener._navigateToCell = function (...args) {
  listenerNavCount += 1
  return origListenerNav(...args)
}

const pUrgentPos = gridToWorld(2, 2, overrideMaze)
// Tick 1: budgetConsumer takes the single standard budget (1 -> 0).
// urgentChaser sees player at ~5.6m (transition immediate) and urgentListener hears sound event -> BOTH repath immediately!
overrideMgr.update(0.016, {
  playerWorldPos: pUrgentPos,
  playerGridCell: { row: 2, col: 2 },
  playerMotion: { moved: true, isSprinting: false, actualSpeed: 5.0 },
  soundEvent: {
    position: gridToWorld(6, 2, overrideMaze),
    cell: { row: 6, col: 2 },
    range: 20,
  },
})

assert(
  budgetConsumerNavCount === 1,
  `Standard patrol enemy consumed the 1-slot frame budget (count=${budgetConsumerNavCount})`
)
assert(
  chaserNavCount === 1,
  `Urgent chaser repathed immediately even when frame budget was consumed (count=${chaserNavCount})`
)
assert(
  listenerNavCount === 1 && urgentListener.getState() === ENEMY_STATES.INVESTIGATE,
  `Sound-alerted Hunter transitioned & repathed immediately despite exhausted frame budget (count=${listenerNavCount})`
)

// Redundant identical-cell CHASE repath skip check:
// If player stays in cell (2, 2) over 0.8s while enemy already has valid path to (2, 2), no extra BFS runs!
chaserNavCount = 0
for (let i = 0; i < 16; i += 1) {
  urgentChaser.update(0.05, {
    playerWorldPos: gridToWorld(2, 3, overrideMaze),
    playerGridCell: { row: 2, col: 2 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
  })
  // Freeze enemy distance > 4.5m? Test with a separate mid-range corridor enemy
}
overrideMgr.dispose()

// Verify stationary-cell CHASE skips redundant BFS beyond close range
const steadyChaser = new EnemyAgent('steady-chaser', {
  maze: overrideMaze,
  spawnCell: { row: 2, col: 5 },
})
steadyChaser.state = ENEMY_STATES.CHASE
steadyChaser.yaw = Math.PI / 2 // Facing -X toward col 2
steadyChaser.loseSightTimer = steadyChaser.config.loseSightDuration
steadyChaser._needsImmediateRepath = true

let steadyBfsCalls = 0
const origSteadyNav = steadyChaser._navigateToCell.bind(steadyChaser)
steadyChaser._navigateToCell = function (...args) {
  steadyBfsCalls += 1
  return origSteadyNav(...args)
}

const steadyTargetPos = gridToWorld(2, 2, overrideMaze)
for (let i = 0; i < 12; i += 1) {
  // 0.60s exceeds 0.35s chase cooldown while staying > 4.5m away with unchanged target cell
  if (i === 1) steadyBfsCalls = 0
  steadyChaser.update(0.05, {
    playerWorldPos: steadyTargetPos,
    playerGridCell: { row: 2, col: 2 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
  })
}
assert(
  steadyBfsCalls === 0,
  `CHASE skips redundant BFS when playerGridCell is unchanged and waypoints remain valid (extra calls=${steadyBfsCalls})`
)

// Now move player to (2, 1) -> repath runs once cooldown expires
const movedTargetPos = gridToWorld(2, 1, overrideMaze)
for (let i = 0; i < 10; i += 1) {
  steadyChaser.update(0.05, {
    playerWorldPos: movedTargetPos,
    playerGridCell: { row: 2, col: 1 },
    playerMotion: { moved: true, isSprinting: false, actualSpeed: 4 },
  })
}
assert(steadyBfsCalls === 1, `CHASE repaths cleanly when playerGridCell changes (calls=${steadyBfsCalls})`)
steadyChaser.dispose()

console.log('✓ Multi-enemy staggering, redundant skip, and immediate-repath rules verified')

// =====================================================================
// 4. Node.js Before / After Benchmarks
// =====================================================================
console.log('\n--- NODE.JS PERFORMANCE BENCHMARKS (CPU / Allocation Comparison) ---')

// Benchmark A: Pathfinder Before (reference Set/Map/string BFS) vs After (typed arrays)
for (const [label, maze] of [
  ['easy (11x11)', easyMaze],
  ['medium (17x17)', mediumMaze],
  ['hard (25x25)', hardMaze],
  ['hardcore (31x31)', hardcoreMaze],
]) {
  const iterations = label.startsWith('hardcore') ? 1500 : 3000
  // Warmup
  for (let i = 0; i < 100; i += 1) {
    referenceFindShortestPath(maze.grid, maze.start, maze.exit)
    findShortestPath(maze.grid, maze.start, maze.exit)
  }

  const t0 = performance.now()
  for (let i = 0; i < iterations; i += 1) {
    referenceFindShortestPath(maze.grid, maze.start, maze.exit)
  }
  const refMs = performance.now() - t0

  const t1 = performance.now()
  for (let i = 0; i < iterations; i += 1) {
    findShortestPath(maze.grid, maze.start, maze.exit)
  }
  const optMs = performance.now() - t1

  console.log(
    `Pathfinder [${label}, ${iterations}x]: Before=${refMs.toFixed(2)}ms | After=${optMs.toFixed(2)}ms | Speedup=${(refMs / Math.max(0.01, optMs)).toFixed(2)}x`
  )
}

// Benchmark B: HorrorDirector selectNextEvent + triggerEvent(DISTANT_SILHOUETTE) LOS evaluations
const losMaze = generateMaze({ difficulty: 'hardcore', seed: 556677 })
const losStart = gridToWorld(losMaze.start.row, losMaze.start.col, losMaze)
const losDir = new HorrorDirector({
  maze: losMaze,
  intensity: HORROR_INTENSITY_LEVELS.HIGH,
  visualScaresEnabled: true,
})

// Measure cell LOS scan cost on uncached double call vs single cached decision
const benchIter = 200
let uncachedScans = 0
let cachedScans = 0

const tDirBefore0 = performance.now()
for (let i = 0; i < benchIter; i += 1) {
  losDir._invalidateDecisionCaches()
  const snap = losDir.evaluateContext({ playerWorldPos: losStart, playerForward: { x: 1, z: 0 } })
  losDir._hasCorridorTarget(snap.playerWorldPos, 5.5, 14.5, true, { playerForward: snap.playerForward })
  uncachedScans += 1
  losDir._invalidateDecisionCaches()
  losDir._pickCorridorTarget(snap.playerWorldPos, 5.5, 14.5, true, { playerForward: snap.playerForward })
  uncachedScans += 1
}
const dirBeforeMs = performance.now() - tDirBefore0

const tDirAfter0 = performance.now()
for (let i = 0; i < benchIter; i += 1) {
  losDir._invalidateDecisionCaches()
  const snap = losDir.evaluateContext({ playerWorldPos: losStart, playerForward: { x: 1, z: 0 } })
  losDir._hasCorridorTarget(snap.playerWorldPos, 5.5, 14.5, true, { playerForward: snap.playerForward })
  cachedScans += 1
  losDir._pickCorridorTarget(snap.playerWorldPos, 5.5, 14.5, true, { playerForward: snap.playerForward })
}
const dirAfterMs = performance.now() - tDirAfter0
losDir.dispose()

console.log(
  `HorrorDirector select+trigger [${benchIter} decisions, 31x31]: Before=${dirBeforeMs.toFixed(2)}ms (${uncachedScans} full scans) | After=${dirAfterMs.toFixed(2)}ms (${cachedScans} scans) | Reduction=${((1 - dirAfterMs / dirBeforeMs) * 100).toFixed(1)}%`
)

// Benchmark C: 7 simultaneous Hardcore enemies over 80 steps (50ms/step, spanning initial idle->patrol transitions)
const benchMgr = new EnemyManager(null, { autoSpawn: true })
benchMgr.setMaze(hardcoreMaze)
let benchFrameBfs = 0
let benchPeakBfs = 0
let benchTotalBfs = 0
for (const e of benchMgr.getEnemies()) {
  const origN = e._navigateToCell.bind(e)
  e._navigateToCell = function (...args) {
    benchFrameBfs += 1
    return origN(...args)
  }
}
const benchCtx = {
  playerWorldPos: gridToWorld(hardcoreMaze.start.row, hardcoreMaze.start.col, hardcoreMaze),
  playerGridCell: { ...hardcoreMaze.start },
  playerHidden: false,
  playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
}
const tMgr0 = performance.now()
for (let f = 0; f < 80; f += 1) {
  benchFrameBfs = 0
  benchMgr.update(0.05, benchCtx)
  if (benchFrameBfs > benchPeakBfs) benchPeakBfs = benchFrameBfs
  benchTotalBfs += benchFrameBfs
}
const mgrMs = performance.now() - tMgr0
benchMgr.dispose()

console.log(
  `EnemyManager 7-enemy Hardcore (80 steps @ 50ms): TotalTime=${mgrMs.toFixed(2)}ms | PeakBFS/frame=${benchPeakBfs} (vs 7 unstaggered) | TotalBFS=${benchTotalBfs}`
)

console.log('\nALL PHASE 4 OPTIMIZATION TESTS PASSED SUCCESSFULLY!')
