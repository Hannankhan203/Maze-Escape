import assert from 'node:assert/strict'
import * as THREE from 'three'

import {
  checkGridLineOfSight,
  ENEMY_TYPES,
  getStartCorridorDirection,
} from '../generation/enemyPlacement.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { exploreReachableCells } from '../generation/pathfinder.js'
import {
  allocateEnemyQuantitiesForLevel,
  DEFAULT_ENEMY_PROGRESSION_CONFIG,
  getLevelSeed,
  INITIAL_BASE_SEED,
} from '../mechanics/levelProgression.js'
import { generateDefaultPatrolRoute } from './EnemyAgent.js'
import { EnemyManager } from './EnemyManager.js'

console.log('======================================================================')
console.log('MAZE-ENEMY-SPAWN-001: ENEMY SPAWN SAFETY & LEVEL INITIALIZATION AUDIT')
console.log('======================================================================\n')

// ---------------------------------------------------------------------------
// TEST 1: Guaranteed Player Spawn Exclusion Zone (Start Cell & Vicinity)
// ---------------------------------------------------------------------------
console.log('Test 1: Guaranteed Player Spawn Exclusion Zone')
{
  const testSeeds = [
    409217, 101010, 202020, 303030, 445566, 778899, 123456, 654321, 999888, 112233,
    500001, 500002, 500003, 500004, 500005, 500006, 500007, 500008, 500009, 500010,
    500011, 500012, 500013, 500014, 500015, 500016, 500017, 500018, 500019, 500020,
    600001, 600002, 600003, 600004, 600005, 600006, 600007, 600008, 600009, 600010,
    700001, 700002, 700003, 700004, 700005, 700006, 700007, 700008, 700009, 700010,
  ]

  let totalMazesTested = 0
  let totalEnemiesVerified = 0

  for (const seed of testSeeds) {
    const maze = generateMaze({ level: 1, seed })
    const reach = exploreReachableCells(maze.grid, maze.start)
    assert.ok(reach.valid, `Maze with seed ${seed} is valid`)

    const { start } = maze
    assert.ok(start, `Maze has start cell`)

    totalMazesTested += 1

    for (const enemy of maze.enemies) {
      totalEnemiesVerified += 1
      const { row, col } = enemy.spawnCell
      const manhattan = Math.abs(row - start.row) + Math.abs(col - start.col)
      const chebyshev = Math.max(Math.abs(row - start.row), Math.abs(col - start.col))
      const pathDist = reach.distances.get(`${row},${col}`) ?? 0

      // Invariant 1: Enemy never spawns on player start
      assert.notEqual(
        `${row},${col}`,
        `${start.row},${start.col}`,
        `Enemy ${enemy.id} in seed ${seed} must not spawn on start cell (${start.row},${start.col})`
      )

      // Invariant 2: Enemy never spawns on immediately adjacent cells (Manhattan distance <= 1)
      assert.ok(
        manhattan > 1,
        `Enemy ${enemy.id} in seed ${seed} must not spawn adjacent to start (got Manhattan distance ${manhattan})`
      )

      // Invariant 3: Enemy never spawns in immediate vicinity (Manhattan <= 2 or Chebyshev <= 2)
      assert.ok(
        manhattan > 2 || chebyshev > 2,
        `Enemy ${enemy.id} in seed ${seed} must be outside start vicinity (got Manhattan ${manhattan}, Chebyshev ${chebyshev})`
      )

      // Invariant 4: Minimum safe path distance from start is >= 3
      assert.ok(
        pathDist >= 3,
        `Enemy ${enemy.id} in seed ${seed} must have path distance >= 3 from start (got ${pathDist})`
      )
    }
  }

  console.log(
    `  ✓ Verified across ${totalMazesTested} Level 1 mazes and ${totalEnemiesVerified} enemies:`
  )
  console.log('    - Zero enemies spawned on player start cell')
  console.log('    - Zero enemies spawned on adjacent cells (Manhattan <= 1)')
  console.log('    - Zero enemies spawned in immediate start vicinity')
  console.log('    - All enemies satisfy path distance >= 3 from start')
}

// ---------------------------------------------------------------------------
// TEST 2: All 19 Milestone Levels Comprehensive Verification (L1..L100000)
// ---------------------------------------------------------------------------
console.log('\nTest 2: All 19 Milestone Levels Comprehensive Verification (L1..L100000)')
{
  const milestoneLevels = [
    1, 2, 5, 6, 10, 11, 15, 16, 20, 21, 25, 26, 50, 100, 500, 1000, 5000, 5001, 100000,
  ]

  for (const level of milestoneLevels) {
    const expectedSeed = getLevelSeed(level, INITIAL_BASE_SEED)
    const maze = generateMaze({ level, seed: expectedSeed })
    assert.ok(maze?.grid, `Level ${level} generates valid maze grid`)
    assert.equal(maze.seed, expectedSeed, `Level ${level} seed matches authoritative derivation`)

    const reach = exploreReachableCells(maze.grid, maze.start)
    assert.ok(reach.valid, `Level ${level} maze is reachable from start`)

    const { start } = maze
    const startDir = getStartCorridorDirection(maze)

    assert.ok(startDir, `Level ${level} has resolvable start corridor direction`)
    const { dRow, dCol, direction } = startDir

    // Doorway threshold cell
    const doorwayCell = { row: start.row + dRow, col: start.col + dCol }
    const doorwayKey = `${doorwayCell.row},${doorwayCell.col}`

    // Compute forward corridor cells
    const forwardCorridorKeys = new Set()
    let step = 1
    while (true) {
      const cr = start.row + step * dRow
      const cc = start.col + step * dCol
      if (
        cr < 0 ||
        cr >= maze.grid.length ||
        cc < 0 ||
        cc >= maze.grid[0].length ||
        maze.grid[cr][cc] !== 0
      ) {
        break
      }
      forwardCorridorKeys.add(`${cr},${cc}`)
      step += 1
    }

    assert.ok(maze.enemies.length >= 2, `Level ${level} places at least 2 enemies`)
    assert.ok(
      maze.enemies.length <= DEFAULT_ENEMY_PROGRESSION_CONFIG.maxTotalEnemies,
      `Level ${level} enemy count respects maxTotalEnemies cap`
    )

    const occupiedEnemyKeys = new Set()

    for (const enemy of maze.enemies) {
      const eKey = `${enemy.spawnCell.row},${enemy.spawnCell.col}`
      const { row, col } = enemy.spawnCell

      // Invariant: coordinates within bounds
      assert.ok(
        row >= 0 && row < maze.grid.length && col >= 0 && col < maze.grid[0].length,
        `Level ${level} enemy ${enemy.id} coordinates within bounds`
      )

      // Invariant: walkable path
      assert.equal(
        maze.grid[row][col],
        0,
        `Level ${level} enemy ${enemy.id} is placed on a walkable PATH cell`
      )

      // Invariant: reachable from start
      assert.ok(
        reach.distances.has(eKey),
        `Level ${level} enemy ${enemy.id} is reachable via pathfinding`
      )

      // Invariant: no duplicates
      assert.equal(
        occupiedEnemyKeys.has(eKey),
        false,
        `Level ${level} enemy ${enemy.id} spawn cell is mutually unique`
      )
      occupiedEnemyKeys.add(eKey)

      // Invariant: not start cell
      assert.notEqual(
        eKey,
        `${start.row},${start.col}`,
        `Level ${level} enemy ${enemy.id} must not spawn on start cell`
      )

      // Invariant: safe distance from start
      const manhattan = Math.abs(row - start.row) + Math.abs(col - start.col)
      assert.ok(
        manhattan > 1,
        `Level ${level} enemy ${enemy.id} must not spawn adjacent to start (Manhattan ${manhattan})`
      )

      // Invariant: doorway clearance
      assert.notEqual(
        eKey,
        doorwayKey,
        `Level ${level} enemy ${enemy.id} must not spawn in doorway cell (${doorwayKey})`
      )

      // Invariant: forward corridor clearance
      assert.equal(
        forwardCorridorKeys.has(eKey),
        false,
        `Level ${level} enemy ${enemy.id} must not spawn in forward corridor facing ${direction}`
      )

      // Invariant: line-of-sight raycast from start cell
      const hasLos = checkGridLineOfSight(start, enemy.spawnCell, maze.grid)
      assert.equal(
        hasLos,
        false,
        `Level ${level} enemy ${enemy.id} at (${eKey}) must have NO direct line-of-sight to start (${start.row},${start.col})`
      )
    }
  }

  console.log(
    `  ✓ Verified across all 19 requested milestone levels [1..100000]:`
  )
  console.log('    - Correct maze generation & authoritative seed derivation')
  console.log('    - Valid enemy counts within progression bounds')
  console.log('    - Safe player spawn, forward-view and doorway exclusions')
  console.log('    - Valid navigation, reachability and mutual exclusivity')
}

// ---------------------------------------------------------------------------
// TEST 3: Enemy Patrol Route Safety
// ---------------------------------------------------------------------------
console.log('\nTest 3: Enemy Patrol Route Safety')
{
  for (let s = 200000; s < 200020; s += 1) {
    const maze = generateMaze({ level: 1, seed: s })
    const { start } = maze
    const startDir = getStartCorridorDirection(maze)
    const doorwayKey = startDir ? `${start.row + startDir.dRow},${start.col + startDir.dCol}` : null

    for (const enemy of maze.enemies) {
      assert.ok(Array.isArray(enemy.patrolRoute), `Enemy ${enemy.id} has patrolRoute array`)
      assert.ok(enemy.patrolRoute.length >= 1, `Enemy ${enemy.id} has at least 1 waypoint`)

      for (const wp of enemy.patrolRoute) {
        const wpKey = `${wp.row},${wp.col}`

        // Patrol waypoints must never be player start
        assert.notEqual(
          wpKey,
          `${start.row},${start.col}`,
          `Patrol waypoint for ${enemy.id} must not be player start`
        )

        // Patrol waypoints must not be doorway threshold
        if (doorwayKey) {
          assert.notEqual(
            wpKey,
            doorwayKey,
            `Patrol waypoint for ${enemy.id} must not be elevator doorway`
          )
        }

        // Patrol waypoints must be walkable
        assert.equal(
          maze.grid[wp.row]?.[wp.col],
          0,
          `Patrol waypoint (${wpKey}) for ${enemy.id} must be walkable path`
        )
      }
    }
  }

  // Also verify generateDefaultPatrolRoute
  const sampleMaze = generateMaze({ level: 1, seed: 409217 })
  const defaultRoute = generateDefaultPatrolRoute(sampleMaze, { row: 5, col: 5 })
  assert.ok(defaultRoute.length >= 2, 'Default patrol route contains at least 2 waypoints')
  for (const wp of defaultRoute) {
    const distToStart =
      Math.abs(wp.row - sampleMaze.start.row) + Math.abs(wp.col - sampleMaze.start.col)
    assert.ok(distToStart > 1, 'Default patrol route excludes player start and immediate neighbors')
  }

  console.log('  ✓ Verified patrol route safety:')
  console.log('    - Patrol waypoints never route into start elevator deck')
  console.log('    - Patrol waypoints avoid elevator doorway clearance cell')
  console.log('    - Default fallback patrol route generator excludes start vicinity')
}

// ---------------------------------------------------------------------------
// TEST 4: Enemy Count Discrepancy Audit (Intended vs Alloc vs Placed vs Active)
// ---------------------------------------------------------------------------
console.log('\nTest 4: Enemy Count Discrepancy Audit (Intended vs Alloc vs Placed vs Active)')
{
  // Audit the schedule tier for Level 1:
  const tier1 = DEFAULT_ENEMY_PROGRESSION_CONFIG.schedule[0]
  assert.equal(tier1.minLevel, 1)
  assert.equal(tier1.maxLevel, 5)
  assert.equal(tier1.minCount, 2, 'Intended tier minCount is 2')
  assert.equal(tier1.maxCount, 5, 'Intended tier maxCount is 5')

  // Sample across 30 distinct Level 1 seeds
  const observedTargetCounts = new Set()
  const observedPlacedCounts = new Set()

  for (let s = 100000; s < 100030; s += 1) {
    const alloc = allocateEnemyQuantitiesForLevel({ level: 1, seed: s })
    observedTargetCounts.add(alloc.targetCount)

    // targetCount is in [2, 5]
    assert.ok(
      alloc.targetCount >= 2 && alloc.targetCount <= 5,
      `Level 1 targetCount (${alloc.targetCount}) is bounded in [2, 5]`
    )

    const maze = generateMaze({ level: 1, seed: s })
    observedPlacedCounts.add(maze.enemies.length)

    // Placed enemies must be bounded in [2, 5]
    assert.ok(
      maze.enemies.length >= 2 && maze.enemies.length <= 5,
      `Level 1 placed count (${maze.enemies.length}) is bounded in [2, 5]`
    )

    // Three.js scene instantiation via EnemyManager
    const scene = new THREE.Scene()
    const mgr = new EnemyManager(scene, { autoSpawn: true })
    mgr.setMaze(maze)

    assert.equal(
      mgr.enemies.size,
      maze.enemies.length,
      `EnemyManager active instances match maze.enemies.length`
    )
    mgr.dispose()
  }

  assert.ok(
    observedTargetCounts.size >= 3,
    `Target count varies dynamically across seeds (observed: ${Array.from(observedTargetCounts).join(', ')})`
  )

  console.log('  ✓ Clarified enemy count discrepancy:')
  console.log(`    - Tier schedule defines minCount: ${tier1.minCount}, maxCount: ${tier1.maxCount}`)
  console.log(
    `    - Target count rolled dynamically in [2, 5] (observed: ${Array.from(observedTargetCounts).sort().join(', ')})`
  )
  console.log(
    `    - Placed count bounded safely in [2, 5] (observed: ${Array.from(observedPlacedCounts).sort().join(', ')})`
  )
  console.log('    - 100% 1:1 match between placed enemies and active Three.js EnemyManager instances')
  console.log('    - Reason gameplay earlier showed 3 vs documented 2: Level 1 schedule rolls 2..5 enemies by design')
}

// ---------------------------------------------------------------------------
// TEST 5: Archetype Progression Across Milestones
// ---------------------------------------------------------------------------
console.log('\nTest 5: Archetype Progression Across Milestones')
{
  // Levels 1-10: Stalker & Hunter only (0 Brutes)
  for (const lvl of [1, 2, 5, 10]) {
    const maze = generateMaze({ level: lvl, baseSeed: INITIAL_BASE_SEED })
    for (const e of maze.enemies) {
      assert.ok(
        e.type === ENEMY_TYPES.STALKER || e.type === ENEMY_TYPES.HUNTER,
        `Level ${lvl} enemy must be Stalker or Hunter, got ${e.type}`
      )
    }
  }

  // Level 11 introduces Brute (Phantom visual rig)
  const l11 = generateMaze({ level: 11, baseSeed: INITIAL_BASE_SEED })
  const hasBrute11 = l11.enemies.some((e) => e.type === ENEMY_TYPES.BRUTE)
  assert.equal(hasBrute11, true, 'Level 11 introduces Brute')

  // Level 5000 infinite scaling
  const l5000 = generateMaze({ level: 5000, baseSeed: INITIAL_BASE_SEED })
  assert.ok(l5000.enemies.length >= 16, 'Level 5000 has high enemy density')
  assert.ok(l5000.enemies.length <= 24, 'Level 5000 bounded by maxTotalEnemies (24)')

  console.log('  ✓ Verified archetype progression across milestones:')
  console.log('    - Levels 1..10 strictly exclude Brute')
  console.log('    - Level 11 introduces Brute gradually')
  console.log('    - Level 5000 satisfies high-level density and memory cap bounds')
}

// ---------------------------------------------------------------------------
// TEST 6: Arrival Sequence Protection & Damage Immunity
// ---------------------------------------------------------------------------
console.log('\nTest 6: Arrival Sequence Protection & Damage Immunity')
{
  const scene = new THREE.Scene()
  const mgr = new EnemyManager(scene, { autoSpawn: false })
  const maze = generateMaze({ level: 1, seed: 409217 })
  mgr.setMaze(maze)

  // Spawn an enemy close to test point
  const agent = mgr.spawnEnemy({
    type: ENEMY_TYPES.STALKER,
    position: { x: 0, y: 0, z: 1.0 },
    spawnCell: { row: 2, col: 1 },
  })
  assert.ok(agent, 'Agent spawned')

  // Context with sequenceProtected / playerHidden = true (as during elevator arrival)
  const arrivalContext = {
    playerWorldPos: { x: 0, y: 0, z: 0 },
    playerGridCell: { row: 1, col: 1 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
    playerHidden: true, // Arrival protection active
    hidingSpot: null,
    activeEffects: null,
    soundEvent: null,
  }

  // Update enemy while arrival sequence is active
  const result = mgr.update(0.1, arrivalContext)
  assert.equal(
    result.attackHits.length,
    0,
    'No enemy attack hits are generated during arrival sequence'
  )

  // Verify agent state did not transition to ATTACK or deal damage
  assert.notEqual(
    agent.getState(),
    'attack',
    'Enemy cannot transition to attack state while arrival protection is active'
  )

  mgr.dispose()

  console.log('  ✓ Verified arrival sequence protection:')
  console.log('    - Enemies cannot deal damage or trigger attack hits during arrival')
  console.log('    - playerHidden flag completely shields player during elevator arrival')
}

console.log('\n======================================================================')
console.log('ALL ENEMY SPAWN SAFETY TESTS PASSED (100% SUCCESS)')
console.log('======================================================================\n')
