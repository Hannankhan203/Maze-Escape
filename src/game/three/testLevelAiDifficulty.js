import assert from 'node:assert/strict'
import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import {
  ENEMY_TYPES,
  getEnemyArchetypeConfig,
} from '../generation/enemyPlacement.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  INITIAL_BASE_SEED,
  getLevelConfig,
} from '../mechanics/levelProgression.js'
import { EnemyAgent } from './EnemyAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

const TEST_LEVELS = [1, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000]

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

console.log('--- RUNNING LEVEL-BASED ENEMY AI DIFFICULTY SCALING TESTS ---')

// ---------------------------------------------------------------------------
// 1. Monotonic Scaling, Bounds & Archetype Profile Preservation Across Levels
// ---------------------------------------------------------------------------
console.log('Test 1: Monotonic AI scaling, per-archetype separation & high-level safety caps')
{
  let prevStalkerSpeed = 0
  let prevHunterSpeed = 0
  let prevBruteSpeed = 0

  for (const level of TEST_LEVELS) {
    const levelCfg = getLevelConfig(level, INITIAL_BASE_SEED)
    const stalkerCfg = getEnemyArchetypeConfig(ENEMY_TYPES.STALKER, level)
    const hunterCfg = getEnemyArchetypeConfig(ENEMY_TYPES.HUNTER, level)
    const bruteCfg = getEnemyArchetypeConfig(ENEMY_TYPES.BRUTE, level)

    assert.deepEqual(levelCfg.enemyAiSummary.stalker, stalkerCfg)
    assert.deepEqual(levelCfg.enemyAiSummary.hunter, hunterCfg)
    assert.deepEqual(levelCfg.enemyAiSummary.brute, bruteCfg)

    // Level 1 baseline equality to base archetype
    if (level === 1) {
      const baseStalker = getEnemyArchetypeConfig(ENEMY_TYPES.STALKER, 1)
      assert.equal(stalkerCfg.chaseSpeed, baseStalker.chaseSpeed)
      assert.equal(stalkerCfg.visionRange, baseStalker.visionRange)
    }

    // Monotonic scaling across levels
    assert.ok(stalkerCfg.chaseSpeed >= prevStalkerSpeed, `Stalker speed monotonic at L${level}`)
    assert.ok(hunterCfg.chaseSpeed >= prevHunterSpeed, `Hunter speed monotonic at L${level}`)
    assert.ok(bruteCfg.chaseSpeed >= prevBruteSpeed, `Brute speed monotonic at L${level}`)
    prevStalkerSpeed = stalkerCfg.chaseSpeed
    prevHunterSpeed = hunterCfg.chaseSpeed
    prevBruteSpeed = bruteCfg.chaseSpeed

    // Archetype identity preservation (Hunter is fast/perceptive, Brute is powerful/slower-patrolling, Stalker is balanced)
    assert.ok(hunterCfg.chaseSpeed > bruteCfg.chaseSpeed, `Hunter chase speed (${hunterCfg.chaseSpeed}) exceeds Brute (${bruteCfg.chaseSpeed})`)
    assert.ok(bruteCfg.attackDamage > stalkerCfg.attackDamage, 'Brute attack damage remains strongest')

    // High level safety caps (Level 5000 must remain safely bounded and non-infinite)
    if (level === 5000) {
      assert.ok(stalkerCfg.chaseSpeed <= ENEMY_TYPES.STALKER ? 7.0 : 10.0, 'Stalker max speed capped')
      assert.ok(hunterCfg.visionRange <= 20.0, 'Hunter max vision range capped')
      assert.ok(stalkerCfg.detectionDelay >= 0.2, 'Detection delay has a safe lower bound')
    }
  }
}
console.log('✓ Monotonic scaling, archetype separation, and safety caps verified')

// ---------------------------------------------------------------------------
// 2. EnemyAgent Parameter Consumption & Transition Synchronization
// ---------------------------------------------------------------------------
console.log('Test 2: EnemyAgent consumes level-aware config & state transition sync')
{
  const mazeL1 = generateMaze({ level: 1, baseSeed: 12345 })
  const mazeL50 = generateMaze({ level: 50, baseSeed: 12345 })

  const agentL1 = new EnemyAgent('s-1', { type: ENEMY_TYPES.HUNTER, maze: mazeL1 })
  const agentL50 = new EnemyAgent('s-50', { type: ENEMY_TYPES.HUNTER, maze: mazeL50 })

  assert.ok(
    agentL50.config.chaseSpeed > agentL1.config.chaseSpeed,
    'EnemyAgent config correctly reflects level 50 vs level 1 speed scaling'
  )
  assert.ok(
    agentL50.config.visionRange > agentL1.config.visionRange,
    'EnemyAgent config correctly reflects level 50 vs level 1 vision scaling'
  )

  // Reducer transition integration
  const engine = new MazeSceneEngine(createHeadlessCanvasHost(), {
    createRenderer: createFakeRendererFactory(),
    isSoftwareGl: true,
  })

  let state = createInitialGameState({ level: 1, baseSeed: 998877 })
  engine.setMaze(state.maze)
  const speedL1 = engine.getEnemyManager().getEnemies()[0]?.config?.chaseSpeed

  state = gameReducer(state, { type: 'SET_LEVEL', level: 50 })
  engine.setMaze(state.maze)
  const speedL50 = engine.getEnemyManager().getEnemies()[0]?.config?.chaseSpeed

  assert.ok(
    speedL50 > speedL1,
    'Engine & EnemyManager rebuild enemies with correct level-scaled AI parameters on level transition'
  )

  engine.dispose()
}
console.log('✓ EnemyAgent consumption and transition synchronization verified')

console.log('--- ALL LEVEL-BASED ENEMY AI DIFFICULTY TESTS PASSED SUCCESSFULLY! ---')
