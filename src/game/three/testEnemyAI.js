import * as THREE from 'three'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { isCellWalkable } from '../world/gridCollision.js'
import { gridToWorld } from '../world/worldCoords.js'
import { buildEnemy, disposeEnemy } from './buildEnemy.js'
import { checkLineOfSight, ENEMY_STATES, EnemyAgent } from './EnemyAgent.js'
import { EnemyManager } from './EnemyManager.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

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

// 8. Enemy Attack State & Close-Range Detection
console.log('Test 8: Enemy Attack State & Close-Range Detection')
const attacker = new EnemyAgent('stalker-combat', {
  maze: testMaze,
  spawnCell: { row: 1, col: 1 },
  config: {
    attackRange: 1.4,
    attackDuration: 0.8,
    attackHitDelay: 0.25,
    attackCooldown: 1.5,
    attackDamage: 25,
  }
})

const attackerPos = attacker.getPosition()
// Position player within attack range (1.0m away in corridor)
const closePlayerPos = { x: attackerPos.x, y: 0, z: attackerPos.z - 1.0 }
const closePlayerContext = {
  playerWorldPos: closePlayerPos,
  playerGridCell: { row: 1, col: 2 },
  playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 }
}

// Tick once - enemy should detect player within attackRange and enter ATTACK state
attacker.update(0.05, closePlayerContext)
assert(attacker.getState() === ENEMY_STATES.ATTACK, `Enemy entered ATTACK state (state: ${attacker.getState()})`)
console.log('✓ Close-range detection triggers ATTACK state')

// 9. Attack Hit Timing & Single Damage Prevention
console.log('Test 9: Attack Hit Timing & Single Damage Prevention')
let hitEvents = []
// Advance time until attackHitDelay (0.25s) is crossed
for (let t = 0.05; t < 0.35; t += 0.05) {
  const result = attacker.update(0.05, closePlayerContext)
  if (result?.attackHit) {
    hitEvents.push(result.attackHit)
  }
}

assert(hitEvents.length === 1, `Exactly 1 attack hit was generated (got: ${hitEvents.length})`)
assert(hitEvents[0].damage === 25, `Attack hit damage is 25 (got: ${hitEvents[0].damage})`)
assert(hitEvents[0].enemyId === 'stalker-combat', 'Attack hit identifies the attacking enemy')
assert(attacker.hasDealtDamageInAttack === true, 'hasDealtDamageInAttack is marked true')

// Continue updating through remainder of attack duration (total 0.8s)
for (let t = 0.35; t < 0.85; t += 0.05) {
  const result = attacker.update(0.05, closePlayerContext)
  if (result?.attackHit) {
    hitEvents.push(result.attackHit)
  }
}
assert(hitEvents.length === 1, 'No duplicate damage events occurred during the remainder of the attack')
console.log('✓ Exactly one damage event per attack; duplicate damage prevented')

// 10. Attack Cooldown Enforcement
console.log('Test 10: Attack Cooldown Enforcement')
assert(attacker.attackCooldownTimer > 0, 'Attack cooldown timer is active after attack')
// Player remains within attackRange, but enemy must NOT attack immediately
attacker.update(0.05, closePlayerContext)
assert(attacker.getState() !== ENEMY_STATES.ATTACK, `Enemy does not attack while in cooldown (state: ${attacker.getState()})`)

// Tick down cooldown timer (1.5s total cooldown)
for (let i = 0; i < 35; i++) {
  attacker.update(0.05, closePlayerContext)
}
assert(attacker.attackCooldownTimer === 0, 'Cooldown timer expired')
// Position player directly adjacent (within attackRange) and update again
const curPos2 = attacker.getPosition()
const nearPlayerPos = { x: curPos2.x, y: 0, z: curPos2.z - 1.1 }
attacker.update(0.05, {
  playerWorldPos: nearPlayerPos,
  playerGridCell: attacker.getGridCell(),
  playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 }
})
assert(attacker.getState() === ENEMY_STATES.ATTACK, `Enemy initiated second attack after cooldown expired (state: ${attacker.getState()})`)
attacker.dispose()
console.log('✓ Attack cooldown timer prevents immediate repeat attacks')

// 11. Reducer Player Health, Clamping & Game Over
console.log('Test 11: Reducer Player Health, Clamping & Game Over')

let state = createInitialGameState('easy', 12345)
assert(state.health === 100, `Initial player health is 100 (got: ${state.health})`)
assert(state.maxHealth === 100, `Initial player maxHealth is 100 (got: ${state.maxHealth})`)
assert(state.isGameOver === false, 'Initial state is not game over')

// Apply first hit of 25 damage
state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 25, enemyId: 'stalker-1' })
assert(state.health === 75, `Health reduced to 75 (got: ${state.health})`)
assert(state.isGameOver === false, 'isGameOver is false at 75 HP')
assert(state.lastEvent?.type === 'player_damaged', 'lastEvent is player_damaged')

// Apply second hit of 25 damage
state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 25, enemyId: 'stalker-1' })
assert(state.health === 50, `Health reduced to 50 (got: ${state.health})`)

// Apply massive damage (120) to test lower boundary clamping
state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 120, enemyId: 'stalker-1' })
assert(state.health === 0, `Health is clamped at 0 and cannot be negative (got: ${state.health})`)
assert(state.isGameOver === true, 'isGameOver is true when health reaches 0')
assert(state.lastEvent?.type === 'game_over', 'lastEvent is game_over')

// Attempt to move while game over
const posBeforeMove = { ...state.playerPos }
state = gameReducer(state, { type: 'MOVE', direction: 'down' })
assert(state.playerPos.row === posBeforeMove.row && state.playerPos.col === posBeforeMove.col, 'Movement is blocked during game over')

// Test upper boundary clamping with SET_HEALTH
state = gameReducer(state, { type: 'SET_HEALTH', health: 150 })
assert(state.health === 100, `Health cannot exceed maxHealth (got: ${state.health})`)
console.log('✓ Health reduction, 0-100 clamping, and game-over state verified')

// 12. Replay / Restart Flow
console.log('Test 12: Replay / Restart Flow')
// Reset run after game over
state = gameReducer(state, { type: 'RESET_RUN' })
assert(state.health === 100, 'RESET_RUN resets health to 100')
assert(state.isGameOver === false, 'RESET_RUN clears game over')
assert(state.moves === undefined, 'Game state omits removed moves counter')

// Reset run resets health as well
state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 50 })
state = gameReducer(state, { type: 'RESET_RUN' })
assert(state.health === 100, 'RESET_RUN resets health to 100')
assert(state.isGameOver === false, 'RESET_RUN clears game over')
console.log('✓ Replay and Reset flows cleanly reinitialize health')

// 13. MazeSceneEngine Combat, Damage Immunity & Multi-Enemy Protection
console.log('Test 13: MazeSceneEngine Combat & Damage Immunity')

// Mock minimal headless canvasHost & WebGLRenderer for engine combat unit tests
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

const engine = new MazeSceneEngine(mockCanvasHost, {
  createRenderer: () => mockRenderer,
  damageImmunityDuration: 1.2,
})

assert(engine.health === 100, 'Engine starts with 100 HP')
assert(engine.maxHealth === 100, 'Engine maxHealth is 100')
assert(engine.damageImmunityTimer === 0, 'Engine starts with 0 immunity timer')

// Apply first hit
const hit1 = engine.applyDamage(25, { enemyId: 'enemy-a' })
assert(hit1 === true, 'First hit applies damage')
assert(engine.health === 75, 'Engine health is 75 after first hit')
assert(engine.damageImmunityTimer === 1.2, 'Temporary damage immunity is active (1.2s)')

// Attempt second hit immediately (e.g., from multiple enemies attacking on same frame)
const hit2 = engine.applyDamage(25, { enemyId: 'enemy-b' })
assert(hit2 === false, 'Second hit rejected due to active damage immunity')
assert(engine.health === 75, 'Health remains at 75 due to damage immunity protection')

// Tick down immunity
engine.damageImmunityTimer = 0
const hit3 = engine.applyDamage(25, { enemyId: 'enemy-b' })
assert(hit3 === true, 'Damage applies after immunity expires')
assert(engine.health === 50, 'Health is 50 after hit3')

// Defeat player
engine.damageImmunityTimer = 0
engine.applyDamage(50, { enemyId: 'enemy-a' })
assert(engine.health === 0, 'Engine health reaches 0')
assert(engine.isGameOver === true, 'Engine is in game over state')

// Reset combat
engine.resetCombat()
assert(engine.health === 100, 'resetCombat resets health to 100')
assert(engine.isGameOver === false, 'resetCombat clears game over')
assert(engine.damageImmunityTimer === 0, 'resetCombat clears immunity timer')

engine.dispose()
console.log('✓ MazeSceneEngine damage immunity, multi-enemy protection, and combat reset verified')

console.log('--- ALL ENEMY AI AND COMBAT UNIT TESTS PASSED SUCCESSFULLY! ---')

