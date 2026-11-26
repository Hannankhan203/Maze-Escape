import assert from 'node:assert/strict'
import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { ENEMY_TYPES } from '../generation/enemyPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { exploreReachableCells, validateMaze } from '../generation/pathfinder.js'
import {
  INITIAL_BASE_SEED,
  getLevelConfig,
} from '../mechanics/levelProgression.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

const TEST_LEVELS = [1, 2, 5, 6, 10, 11, 15, 16, 20, 25, 26, 50, 100, 5000]

function createHeadlessCanvasHost() {
  return {
    clientWidth: 800,
    clientHeight: 500,
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
  }
}

function createFakeRendererFactory() {
  return () => ({
    domElement: {
      style: {},
      remove() {},
    },
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: '',
    setPixelRatio() {},
    setSize() {},
    render() {},
    dispose() {},
  })
}

console.log('--- RUNNING LEVEL-BASED ENEMY PROGRESSION & PLACEMENT TESTS ---')

// ---------------------------------------------------------------------------
// 1. Milestone Levels & Milestone Roster/Count Rules
// ---------------------------------------------------------------------------
console.log('Test 1: Milestone levels enemy roster, Brute introduction rule & count bounds')
{
  for (const level of TEST_LEVELS) {
    const levelCfg = getLevelConfig(level, INITIAL_BASE_SEED)
    const maze = generateMaze({ level, baseSeed: INITIAL_BASE_SEED })

    assert.ok(maze.enemySelection, `Level ${level} records enemySelection`)
    assert.ok(maze.enemyAllocation, `Level ${level} records enemyAllocation`)
    assert.ok(maze.enemyPlacementReport, `Level ${level} records enemyPlacementReport`)
    assert.ok(Array.isArray(maze.enemies), `Level ${level} records enemies array`)

    assert.deepEqual(
      maze.enemySelection,
      levelCfg.enemySelection,
      `Level ${level} maze.enemySelection matches getLevelConfig`
    )
    assert.deepEqual(
      maze.enemyAllocation,
      levelCfg.enemyAllocation,
      `Level ${level} maze.enemyAllocation matches getLevelConfig`
    )

    const roster = maze.enemyAllocation.roster
    const counts = maze.enemyAllocation.archetypeCounts

    // Rule A: Levels 1–5 contain only Stalkers and Hunters; NO Brutes before Level 11
    if (level <= 10) {
      assert.equal(
        maze.enemySelection.hasBrute,
        false,
        `Level ${level} roster excludes Brute`
      )
      assert.equal(counts[ENEMY_TYPES.BRUTE] || 0, 0, `Level ${level} places 0 Brutes`)
      assert.ok(
        roster.every((t) => t === ENEMY_TYPES.STALKER || t === ENEMY_TYPES.HUNTER),
        `Level ${level} has only Stalkers and Hunters`
      )
    }

    // Rule B: Brutes introduced gradually at Level 11
    if (level === 11) {
      assert.equal(maze.enemySelection.hasBrute, true, 'Level 11 introduces Brutes')
      assert.ok(
        (counts[ENEMY_TYPES.BRUTE] || 0) >= 1 && (counts[ENEMY_TYPES.BRUTE] || 0) <= 2,
        `Level 11 introduces Brutes gradually (got ${counts[ENEMY_TYPES.BRUTE]} Brute(s))`
      )
    }

    // Rule C: Level 1 never exceeds 5 enemies
    if (level === 1) {
      assert.ok(
        maze.enemies.length <= 5,
        `Level 1 enemy count (${maze.enemies.length}) never exceeds 5`
      )
      assert.ok(maze.enemies.length >= 2, 'Level 1 has at least 2 enemies')
    }

    // Rule D: High-level infinite scaling caps & memory bounds
    if (level >= 5000) {
      assert.ok(
        maze.enemies.length <= maze.enemyAllocation.capacityCap,
        'High level enemy count respects capacity cap'
      )
      assert.ok(maze.enemies.length >= 10, 'High level maintains high challenge')
    }

    assert.equal(
      maze.enemies.length,
      maze.enemyAllocation.targetCount,
      `Level ${level} placed enemies count matches targetCount`
    )
    assert.equal(
      maze.enemyPlacementReport.fullySatisfied,
      true,
      `Level ${level} satisfies enemy placement fully`
    )
  }
}
console.log('✓ Milestone roster, Brute timing rules, and quantity bounds verified')

// ---------------------------------------------------------------------------
// 2. Safe Placement, Reachability & Collision Avoidance
// ---------------------------------------------------------------------------
console.log('Test 2: Enemy spawn safety, reachability, path validation & exclusions')
{
  for (const level of [1, 6, 11, 26, 100]) {
    const maze = generateMaze({ level, baseSeed: INITIAL_BASE_SEED })
    const reach = exploreReachableCells(maze.grid, maze.start)
    assert.equal(validateMaze(maze).valid, true, `Level ${level} maze stays solvable`)

    const occupiedKeys = new Set()
    const hazardKeys = new Set(maze.hazards.map((h) => `${h.row},${h.col}`))
    const keycardKeys = new Set(maze.keycards.map((kc) => `${kc.row},${kc.col}`))
    const collectibleKeys = new Set(maze.collectibles.items.map((i) => `${i.row},${i.col}`))

    for (const enemy of maze.enemies) {
      const key = `${enemy.spawnCell.row},${enemy.spawnCell.col}`
      assert.equal(maze.grid[enemy.spawnCell.row]?.[enemy.spawnCell.col], CELL_TYPES.PATH, 'Enemy on PATH')
      assert.equal(reach.distances.has(key), true, 'Enemy reachable via BFS')
      
      const distFromStart = reach.distances.get(key) || 0
      assert.ok(
        distFromStart >= 1,
        'Enemy spawn distance is reachable and away from start'
      )

      assert.equal(
        enemy.spawnCell.row === maze.start.row && enemy.spawnCell.col === maze.start.col,
        false,
        'Enemy never spawns on player start'
      )
      assert.equal(
        enemy.spawnCell.row === maze.exit.row && enemy.spawnCell.col === maze.exit.col,
        false,
        'Enemy never spawns on exit'
      )
      assert.equal(hazardKeys.has(key), false, 'Enemy avoids hazards')
      assert.equal(keycardKeys.has(key), false, 'Enemy avoids keycards')
      assert.equal(collectibleKeys.has(key), false, 'Enemy avoids collectible items')
      assert.equal(occupiedKeys.has(key), false, 'Enemy spawn cells are mutually unique')
      occupiedKeys.add(key)

      assert.ok(Array.isArray(enemy.patrolRoute) && enemy.patrolRoute.length >= 1, 'Enemy has valid patrol route')
    }
  }
}
console.log('✓ Enemy spawn safety, reachability and strict exclusions verified')

// ---------------------------------------------------------------------------
// 3. Determinism, Seed Reproducibility & RNG Isolation
// ---------------------------------------------------------------------------
console.log('Test 3: Deterministic placement & RNG stream isolation')
{
  const mA = generateMaze({ level: 15, baseSeed: 777888 })
  const mB = generateMaze({ level: 15, baseSeed: 777888 })
  const mOther = generateMaze({ level: 15, baseSeed: 111222 })

  assert.deepEqual(mA.enemySelection, mB.enemySelection, 'Identical seed yields identical enemy selection')
  assert.deepEqual(mA.enemyAllocation, mB.enemyAllocation, 'Identical seed yields identical enemy allocation')
  assert.deepEqual(mA.enemies, mB.enemies, 'Identical seed yields identical enemy placements and patrol routes')

  assert.notDeepEqual(mA.enemies, mOther.enemies, 'Different base seeds produce different enemy placements')

  // RNG isolation check: custom enemy config does not alter maze grid or hazards
  const mCustom = generateMaze({
    level: 15,
    baseSeed: 777888,
    enemyConfig: { maxTotalEnemies: 4 },
  })
  assert.deepEqual(mA.grid, mCustom.grid, 'Enemy config change never perturbs maze grid')
  assert.deepEqual(mA.start, mCustom.start)
  assert.deepEqual(mA.exit, mCustom.exit)
  assert.deepEqual(mA.hazards, mCustom.hazards, 'Enemy config change never perturbs hazards')
}
console.log('✓ Determinism and RNG stream isolation verified')

// ---------------------------------------------------------------------------
// 4. Gameplay Integration, EnemyManager, MazeSceneEngine & Transitions
// ---------------------------------------------------------------------------
console.log('Test 4: EnemyManager, MazeSceneEngine & state transition synchronization')
{
  const engine = new MazeSceneEngine(createHeadlessCanvasHost(), {
    createRenderer: createFakeRendererFactory(),
    isSoftwareGl: true,
  })

  let state = createInitialGameState({
    level: 6,
    baseSeed: 554433,
  })
  engine.setMaze(state.maze)

  const enemyMgr = engine.getEnemyManager()
  assert.ok(enemyMgr, 'MazeSceneEngine instantiates EnemyManager')
  assert.equal(
    enemyMgr.getEnemies().length,
    state.maze.enemies.length,
    'EnemyManager mounts exact pre-generated maze enemies into active gameplay'
  )
  assert.ok(
    enemyMgr.getEnemies().every((agent) => agent.getMesh()),
    'All managed enemies successfully instantiate 3D procedural meshes'
  )

  // ADVANCE_LEVEL transition
  state = gameReducer(state, { type: 'ADVANCE_LEVEL' })
  engine.setMaze(state.maze)
  assert.equal(state.currentLevel, 7)
  assert.equal(
    enemyMgr.getEnemies().length,
    state.maze.enemies.length,
    'ADVANCE_LEVEL re-synchronizes EnemyManager with Level 7 enemies'
  )

  // REPLAY_LEVEL transition
  const prevMazeId = state.maze.id
  state = gameReducer(state, { type: 'REPLAY_LEVEL' })
  engine.setMaze(state.maze)
  assert.equal(state.maze.id, prevMazeId)
  assert.equal(
    enemyMgr.getEnemies().length,
    state.maze.enemies.length,
    'REPLAY_LEVEL correctly rebuilds level enemies'
  )

  // NEW_GAME transition
  state = gameReducer(state, { type: 'NEW_GAME', baseSeed: 991122 })
  engine.setMaze(state.maze)
  assert.equal(state.currentLevel, 1)
  assert.equal(
    enemyMgr.getEnemies().length,
    state.maze.enemies.length,
    'NEW_GAME resets to Level 1 with Level 1 enemy count'
  )
  assert.ok(
    enemyMgr.getEnemies().length <= 5,
    'New game level 1 enemy count does not exceed 5'
  )

  engine.dispose()
}
console.log('✓ EnemyManager active gameplay integration and transition synchronization verified')

console.log('--- ALL LEVEL-BASED ENEMY PROGRESSION TESTS PASSED SUCCESSFULLY! ---')
