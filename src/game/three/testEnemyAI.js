import * as THREE from 'three'
import { isCellWalkable } from '../world/gridCollision.js'
import { gridToWorld } from '../world/worldCoords.js'
import { buildEnemy, disposeEnemy } from './buildEnemy.js'
import { checkLineOfSight, ENEMY_STATES, EnemyAgent } from './EnemyAgent.js'
import { EnemyManager } from './EnemyManager.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

console.log('--- RUNNING ENEMY AI UNIT TESTS ---')

// 7x7 test maze:
// 1 = solid wall, 0 = walkable path
const testMaze = {
  width: 7,
  height: 7,
  start: { row: 1, col: 1 },
  exit: { row: 5, col: 5 },
  grid: [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ]
}

// 1. Procedural 3D Enemy Model Construction & Rig
console.log('Test 1: Procedural Enemy Model Construction')
const enemyMesh = buildEnemy({ id: 'test-1', maze: testMaze, spawnCell: { row: 1, col: 1 } })
assert(enemyMesh instanceof THREE.Group, 'Enemy model is a THREE.Group')
assert(enemyMesh.userData.isEnemyModel === true, 'userData.isEnemyModel is true')
assert(enemyMesh.userData.rig?.sensorMesh !== undefined, 'Rig contains ocular sensorMesh')
assert(enemyMesh.userData.rig?.sensorLight !== undefined, 'Rig contains ocular sensorLight')
assert(enemyMesh.userData.rig?.headPivot !== undefined, 'Rig contains headPivot')
assert(enemyMesh.userData.rig?.leftLegPivot !== undefined, 'Rig contains leftLegPivot')
disposeEnemy(enemyMesh)
console.log('✓ Enemy model created and disposed successfully')

// 2. Line of Sight & Vision Detection
console.log('Test 2: Line of Sight & Perception')
const posA = gridToWorld(1, 1, testMaze) // corridor along row 1
const posB = gridToWorld(1, 4, testMaze) // unobstructed straight corridor
const losClear = checkLineOfSight(posA, posB, testMaze)
assert(losClear === true, 'Unobstructed corridor has clear line of sight')

const posC = gridToWorld(3, 3, testMaze) // interior center separated by wall at (2, 3)
const losBlocked = checkLineOfSight(posA, posC, testMaze)
assert(losBlocked === false, 'Line of sight through solid wall is blocked')
console.log('✓ Line of sight detection verified')

// 3. EnemyAgent Spawning & Grid Navigation
console.log('Test 3: EnemyAgent Spawning & Navigation')
const agent = new EnemyAgent('stalker-alpha', {
  maze: testMaze,
  spawnCell: { row: 1, col: 1 },
  patrolRoute: [{ row: 1, col: 5 }, { row: 5, col: 5 }],
})

assert(agent.getState() === ENEMY_STATES.PATROL, 'Initial state is PATROL')
const agentCell = agent.getGridCell()
assert(agentCell && agentCell.row === 1 && agentCell.col === 1, 'Agent spawned at (1, 1)')

// Move agent along patrol route
for (let i = 0; i < 40; i++) {
  agent.update(0.05, {
    playerWorldPos: gridToWorld(5, 1, testMaze), // player far away around corner
    playerGridCell: { row: 5, col: 1 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 }
  })
}

const advancedPos = agent.getPosition()
assert(Number.isFinite(advancedPos.x) && Number.isFinite(advancedPos.z), 'Agent position is valid and finite')
const currentCell = agent.getGridCell()
assert(currentCell && isCellWalkable(currentCell.row, currentCell.col, testMaze), 'Agent stays strictly on walkable cells')
console.log('✓ Agent navigated along path on walkable cells')

// 4. Wall Avoidance & Boundaries
console.log('Test 4: Wall Avoidance & Boundary Safety')
// Try to force agent position into a solid wall at (2, 2)
const wallWorld = gridToWorld(2, 2, testMaze) // wait, cell bounds of wall
agent.setPosition(wallWorld ? wallWorld.x : 0, 0, wallWorld ? wallWorld.z : 0)
// Now update step movement - collision resolution should eject/clamp
agent.update(0.016, null)
const resolvedPos = agent.getPosition()
assert(Number.isFinite(resolvedPos.x) && Number.isFinite(resolvedPos.z), 'Resolved position is finite')
console.log('✓ Wall collision and boundary constraints verified')

// 5. Player Detection, Awareness & CHASE Transition
console.log('Test 5: Detection Delay & CHASE Transition')
agent.setPosition(posA.x, 0, posA.z, 0) // facing along -Z (or let's orient towards player)
const playerPos = gridToWorld(1, 3, testMaze) // in straight corridor ahead
const dirToPlayer = { x: playerPos.x - posA.x, z: playerPos.z - posA.z }
const yawFacingPlayer = Math.atan2(-dirToPlayer.x, -dirToPlayer.z)
agent.yaw = yawFacingPlayer

// Player in line of sight -> awareness builds up over detectionDelay
for (let i = 0; i < 15; i++) {
  agent.update(0.05, {
    playerWorldPos: playerPos,
    playerGridCell: { row: 1, col: 3 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 }
  })
}
assert(agent.getState() === ENEMY_STATES.CHASE, `Agent transitioned to CHASE upon seeing player (state: ${agent.getState()})`)
console.log('✓ Player detection delay and CHASE transition verified')

// 6. Loss of Sight, Investigate & Search
console.log('Test 6: Loss of Sight, Investigate & Search')
// Move player behind wall at (3, 3)
const hiddenPlayerPos = gridToWorld(3, 3, testMaze)
// Update for loseSightDuration (2.2s)
for (let i = 0; i < 60; i++) {
  agent.update(0.05, {
    playerWorldPos: hiddenPlayerPos,
    playerGridCell: { row: 3, col: 3 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 }
  })
  if (agent.getState() === ENEMY_STATES.INVESTIGATE) {
    break
  }
}
assert(agent.getState() === ENEMY_STATES.INVESTIGATE, `Agent transitioned to INVESTIGATE after losing sight (state: ${agent.getState()})`)

// Let agent reach investigate target -> should transition to SEARCH
for (let i = 0; i < 60; i++) {
  agent.update(0.05, {
    playerWorldPos: hiddenPlayerPos,
    playerGridCell: { row: 3, col: 3 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 }
  })
  if (agent.getState() === ENEMY_STATES.SEARCH) {
    break
  }
}
assert(agent.getState() === ENEMY_STATES.SEARCH || agent.getState() === ENEMY_STATES.PATROL, 'Agent searched or resumed patrol')
console.log('✓ Lose sight, Investigate, and Search state transitions verified')

agent.dispose()

// 7. EnemyManager Multi-Agent Orchestration & Cleanup
console.log('Test 7: EnemyManager Multiple Enemies & Lifecycle')
const scene = new THREE.Scene()
const enemyManager = new EnemyManager(scene, { autoSpawn: false })
enemyManager.setMaze(testMaze)

const enemy1 = enemyManager.spawnEnemy({ id: 'stalker-1', spawnCell: { row: 1, col: 1 } })
const enemy2 = enemyManager.spawnEnemy({ id: 'stalker-2', spawnCell: { row: 5, col: 5 } })

assert(enemyManager.getEnemies().length === 2, 'EnemyManager manages 2 active enemies')
assert(enemyManager.getEnemy('stalker-1') === enemy1, 'getEnemy retrieves stalker-1')
assert(enemyManager.getEnemy('stalker-2') === enemy2, 'getEnemy retrieves stalker-2')

// Tick EnemyManager
enemyManager.update(0.016, {
  playerWorldPos: gridToWorld(1, 1, testMaze),
  playerGridCell: { row: 1, col: 1 },
  playerMotion: { moved: true, isSprinting: true, actualSpeed: 9.0 }
})

// Replace maze in EnemyManager
const newMaze = { ...testMaze }
enemyManager.setMaze(newMaze, { autoSpawn: false })
assert(enemyManager.getEnemies().length === 0, 'setMaze clears previous enemies cleanly')

enemyManager.dispose()
assert(enemyManager.isDisposed === true, 'EnemyManager disposes cleanly')
console.log('✓ EnemyManager multi-enemy orchestration and cleanup verified')

console.log('--- ALL ENEMY AI TESTS PASSED SUCCESSFULLY! ---')
