import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  HAZARD_TYPES,
  placeHazards,
  resolveCeilingCollapseMount,
  resolveRottenFurnitureMount,
  resolveElectricalMount,
  resolveFloorGrateOrientation,
  resolveWallCollapseMount,
  resolveWaterTankMount,
  resolveSuspendedMachineryMount,
  resolveVentilationDuctMount,
} from '../generation/hazardPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { placeEnvironmentalProps } from '../generation/environmentalPropPlacement.js'
import { getEnvironmentalPropMaterials } from './buildEnvironmentalProps.js'
import { exploreReachableCells } from '../generation/pathfinder.js'
import { resolveGridCollision, moveWithSubsteps } from '../world/gridCollision.js'
import {
  getDynamicCollider,
  validateHazardColliderPlacement,
} from '../world/propCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import {
  buildHazardMesh,
  getHazardPoolStats,
  updateHazardVisualState,
} from './buildHazards.js'
import { MAZE_CEILING_CONFIG, MAZE_CEILING_PALETTE } from './buildMazeCeiling.js'
import { getCeilingVentPoolStats } from './buildCeilingVents.js'
import {
  HAZARD_CONFIG,
  HAZARD_STATES,
  HazardAgent,
} from './HazardAgent.js'
import { HazardManager } from './HazardManager.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { triggerHazardCue } from './audioSynthesis.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

console.log('--- RUNNING ENVIRONMENTAL HAZARDS AUDIT TESTS ---')

// Shared minimal headless host/renderer mocks for MazeSceneEngine tests
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
    createRenderer: () => mockRenderer,
    ...config,
  })
}

const mazeA = generateMaze({ seed: 771234 })
const mazeB = generateMaze({ seed: 771234 })
const mazeDifferentSeed = generateMaze({ seed: 112233 })
const mediumMazeA = generateMaze({ seed: 998877 })

// 1. Deterministic placement using identical seeds
console.log('Test 1: Deterministic Placement Using Identical Seeds')
const hazardsA = placeHazards(mazeA)
const hazardsB = placeHazards(mazeB)
const hazardsDiff = placeHazards(mazeDifferentSeed)

assert(hazardsA.length === 10, `Maze produces 10 realistic hazards (got ${hazardsA.length})`)
assert(
  JSON.stringify(hazardsA) === JSON.stringify(hazardsB),
  'Identical maze seeds yield identical hazard placements'
)
assert(
  JSON.stringify(hazardsA) !== JSON.stringify(hazardsDiff),
  'Different seeds yield different hazard placements'
)
console.log('✓ Deterministic seeded placement verified')

// 2. No placement inside walls, start, or exit
console.log('Test 2: No Placement Inside Walls, Start, or Exit')
{
  const maze = generateMaze({ seed: 445566 })
  const hazards = placeHazards(maze)
  const startKey = `${maze.start.row},${maze.start.col}`
  const exitKey = `${maze.exit.row},${maze.exit.col}`
  for (const h of hazards) {
    const key = `${h.row},${h.col}`
    assert(maze.grid[h.row]?.[h.col] === CELL_TYPES.PATH, `Hazard (${key}) must be on PATH`)
    assert(key !== startKey && key !== exitKey, 'Hazard must not overlap start or exit')
  }
}
console.log('✓ No hazards placed in walls, start, or exit; navigation preserved')

// 3. No overlapping hazards
console.log('Test 3: No Overlapping Hazards')
const standardMaze = generateMaze({ seed: 314159 })
const standardHazards = placeHazards(standardMaze)
assert(standardHazards.length === 10, `Maze places 10 realistic hazards (got ${standardHazards.length})`)
const seenCoords = new Set()
const seenIds = new Set()
for (const h of standardHazards) {
  const key = `${h.row},${h.col}`
  assert(!seenCoords.has(key), `Duplicate hazard coordinate found at ${key}`)
  assert(!seenIds.has(h.id), `Duplicate hazard id found: ${h.id}`)
  seenCoords.add(key)
  seenIds.add(h.id)
}
const REMOVED_LEGACY_HAZARD_TYPES = ['floor_spikes', 'pressure_plate', 'electric_grid']
const registeredHazardTypes = Object.values(HAZARD_TYPES)
assert(
  registeredHazardTypes.length === 10,
  `HAZARD_TYPES registers exactly 10 realistic environmental hazards (got ${registeredHazardTypes.length})`
)
assert(
  Object.keys(HAZARD_CONFIG).length === 10,
  `HAZARD_CONFIG configures exactly 10 realistic environmental hazards (got ${Object.keys(HAZARD_CONFIG).length})`
)
const typesSeen = new Set(standardHazards.map((h) => h.type))
for (const legacyType of REMOVED_LEGACY_HAZARD_TYPES) {
  assert(!registeredHazardTypes.includes(legacyType), `Removed legacy hazard "${legacyType}" must not exist in HAZARD_TYPES`)
  assert(!Object.prototype.hasOwnProperty.call(HAZARD_CONFIG, legacyType), `Removed legacy hazard "${legacyType}" must not exist in HAZARD_CONFIG`)
  assert(!typesSeen.has(legacyType), `Removed legacy hazard "${legacyType}" must never be placed in any maze`)
}
assert(typesSeen.has(HAZARD_TYPES.CEILING_COLLAPSE), 'Includes ceiling collapse hazards')
assert(typesSeen.has(HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE), 'Includes rotten furniture collapse hazards')
assert(typesSeen.has(HAZARD_TYPES.FALLING_PIPES_FIXTURES), 'Includes falling pipes & fixtures hazards')
assert(typesSeen.has(HAZARD_TYPES.STEAM_PIPE_BURST), 'Includes steam pipe burst hazards')
assert(typesSeen.has(HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING), 'Includes exposed electrical wiring hazards')
assert(typesSeen.has(HAZARD_TYPES.COLLAPSING_FLOOR_GRATE), 'Includes collapsing floor grate hazards')
assert(typesSeen.has(HAZARD_TYPES.WALL_COLLAPSE), 'Includes wall collapse hazards')
assert(typesSeen.has(HAZARD_TYPES.FALLING_WATER_TANK), 'Includes falling water tank hazards')
assert(typesSeen.has(HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY), 'Includes falling suspended machinery hazards')
assert(typesSeen.has(HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE), 'Includes ventilation duct collapse hazards')
console.log('✓ Zero overlapping hazards, all 10 realistic hazard types placed, and 0 legacy types registered')

// Test corridor grid for agent mechanics
const testMaze = {
  rows: 5,
  cols: 5,
  start: { row: 1, col: 1 },
  exit: { row: 3, col: 3 },
  seed: 55555,
  difficulty: 'small',
  grid: [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ],
}

// 4. Regression: Removed legacy hazard types cannot be generated, instantiated, rendered, or activated
console.log('Test 4: Removed Legacy Hazards Cannot Be Generated, Registered, Rendered, or Activated')
const farWorld = gridToWorld(3, 1, testMaze)
const farAwayCtx = {
  playerWorldPos: { x: farWorld.x, y: 0, z: farWorld.z },
  playerGridCell: { row: 3, col: 1 },
}

for (const seed of [1001, 2002, 3003, 4004, 5005]) {
  const m = generateMaze({ seed })
  const placed = placeHazards(m)
  assert(placed.length === 10, `Seed ${seed} places exactly 10 realistic hazards (got ${placed.length})`)
  for (const spec of placed) {
    assert(
      !REMOVED_LEGACY_HAZARD_TYPES.includes(spec.type),
      `Seed ${seed} must never generate removed legacy hazard "${spec.type}"`
    )
    assert(
      registeredHazardTypes.includes(spec.type),
      `Seed ${seed} generated unknown hazard type "${spec.type}"`
    )
  }
}

for (const invalidType of [...REMOVED_LEGACY_HAZARD_TYPES, undefined, '']) {
  let agentRejected = false
  try {
    new HazardAgent({ id: `reject-agent-${invalidType}`, type: invalidType, row: 1, col: 2 }, testMaze)
  } catch (err) {
    agentRejected = Boolean(err?.message?.includes('Unsupported hazard type'))
  }
  assert(agentRejected, `HazardAgent must reject unsupported/legacy type "${invalidType}"`)

  let meshRejected = false
  try {
    buildHazardMesh({ id: `reject-mesh-${invalidType}`, type: invalidType })
  } catch (err) {
    meshRejected = Boolean(err?.message?.includes('Unsupported hazard type'))
  }
  assert(meshRejected, `buildHazardMesh must reject unsupported/legacy type "${invalidType}"`)
}
console.log('✓ Removed legacy hazards cannot be generated, registered, rendered, or instantiated')

// 5. Realistic hazards remain DORMANT without player proximity (no autonomous legacy cycling)
console.log('Test 5: All 10 Realistic Hazards Remain Dormant Without Player Proximity')
{
  const checkScene = new THREE.Scene()
  const checkManager = new HazardManager(checkScene)
  checkManager.setMaze(standardMaze)
  const spawned = checkManager.getHazards()
  assert(spawned.length === 10, `HazardManager spawns exactly 10 realistic hazards (got ${spawned.length})`)
  for (const agent of spawned) {
    assert(agent.getState() === HAZARD_STATES.DORMANT, `${agent.type} starts DORMANT`)
    assert(agent.timer === 0, `${agent.type} starts with timer 0`)
  }
  // Tick 10 seconds with null player context -> no hazard activates autonomously
  for (let i = 0; i < 100; i += 1) {
    const res = checkManager.update(0.1, null)
    assert(res.hazardHits.length === 0, 'No hazard hits occur without player proximity')
  }
  for (const agent of spawned) {
    assert(
      agent.getState() === HAZARD_STATES.DORMANT,
      `${agent.type} stays DORMANT without player proximity (got ${agent.getState()})`
    )
  }
  checkManager.dispose()
}
console.log('✓ All 10 realistic hazards remain dormant until triggered by player proximity')

// 6. Fair warning dodge: stepping away during warning avoids damage on activation
console.log('Test 6: Fair Warning Dodge Prevents Damage Across Realistic Hazards')
{
  const dodgeCell = { row: 1, col: 3 }
  const dodgeWorld = gridToWorld(dodgeCell.row, dodgeCell.col, testMaze)
  const onTileCtx = {
    playerWorldPos: { x: dodgeWorld.x, y: 0, z: dodgeWorld.z },
    playerGridCell: dodgeCell,
  }
  const steamAgent = new HazardAgent(
    { id: 'steam-dodge-test', type: HAZARD_TYPES.STEAM_PIPE_BURST, ...dodgeCell },
    testMaze
  )
  const steamCfg = HAZARD_CONFIG[HAZARD_TYPES.STEAM_PIPE_BURST]
  assert(steamAgent.getState() === HAZARD_STATES.DORMANT, 'Steam pipe starts DORMANT')

  // Player approaches -> WARNING with 0 immediate damage
  const warnHit = steamAgent.update(0.05, onTileCtx)
  assert(steamAgent.getState() === HAZARD_STATES.WARNING, 'Steam pipe enters WARNING on player proximity')
  assert(warnHit === null, 'Steam pipe deals no damage during warning')

  // Player retreats before warning expires -> ACTIVE deals 0 damage
  const activeHit = steamAgent.update(steamCfg.warningDuration + 0.05, farAwayCtx)
  assert(steamAgent.getState() === HAZARD_STATES.ACTIVE, 'Steam pipe transitions to ACTIVE')
  assert(activeHit === null, 'Dodging out of impact zone during warning avoids damage')

  // Completes active duration -> permanently disabled
  steamAgent.update(steamCfg.activeDuration + 0.05, farAwayCtx)
  assert(steamAgent.getState() === HAZARD_STATES.DISABLED, 'Steam pipe transitions to DISABLED after burst')
  assert(steamAgent.isPermanentlyCollapsed === true, 'Steam pipe marks itself permanently spent')
  steamAgent.dispose()
}
console.log('✓ Fair warning dodge and single-activation lifecycle verified')

// 7. Ceiling Collapse Warning, Activation, Damage, and Permanent Collapse
console.log('Test 7: Ceiling Collapse Warning, Activation, Damage, and Permanent Collapse')
const ceilingCell = { row: 2, col: 2 }
const ceilingWorld = gridToWorld(ceilingCell.row, ceilingCell.col, testMaze)
const underCeilingCtx = {
  playerWorldPos: { x: ceilingWorld.x, y: 0, z: ceilingWorld.z },
  playerGridCell: ceilingCell,
}
const ceilingAgent = new HazardAgent(
  { id: 'ceiling-test', type: HAZARD_TYPES.CEILING_COLLAPSE, ...ceilingCell },
  testMaze
)
const ceilingCfg = HAZARD_CONFIG[HAZARD_TYPES.CEILING_COLLAPSE]
assert(ceilingAgent.getState() === HAZARD_STATES.DORMANT, 'Ceiling collapse starts DORMANT')

ceilingAgent.update(0.1, underCeilingCtx)
assert(ceilingAgent.getState() === HAZARD_STATES.WARNING, 'Ceiling collapse enters WARNING on player proximity')

const ceilingHit = ceilingAgent.update(ceilingCfg.warningDuration, underCeilingCtx)
assert(ceilingAgent.getState() === HAZARD_STATES.ACTIVE, 'Ceiling collapse enters ACTIVE')
assert(ceilingHit && ceilingHit.damage === ceilingCfg.damage, `Ceiling collapse deals ${ceilingCfg.damage} damage`)

ceilingAgent.update(ceilingCfg.activeDuration, underCeilingCtx)
assert(ceilingAgent.isPermanentlyCollapsed === true, 'Ceiling remains permanently collapsed with debris')
assert(ceilingAgent.update(1.0, underCeilingCtx) === null, 'Permanently collapsed ceiling produces no further updates or damage')
ceilingAgent.dispose()
console.log('✓ Ceiling collapse warning, proximity trigger, impact damage, and permanent debris verified')

// 8. Damage immunity integration with enemy attacks
console.log('Test 8: Damage Immunity Integration Between Hazards & Enemy Attacks')
const engine = createHeadlessEngine({
  initialHealth: 100,
  maxHealth: 100,
  damageImmunityDuration: 1.2,
  enemies: { autoSpawn: false },
})
const combatEvents = []
engine._onPlayerDamage = (ev) => combatEvents.push(ev)
engine.setMaze(testMaze)

// Place player on tile (1, 2)
engine.setPlayerGridPosition(1, 2, { immediate: true })
const pPos = engine.getPlayerWorldPosition()

// Case A: Enemy strikes player -> temporary immunity blocks simultaneous hazard damage
const enemyHitResult = engine.applyDamage(25, { enemyId: 'stalker-1' })
assert(enemyHitResult === true, 'Enemy attack applies initial 25 damage')
assert(engine.health === 75, 'Player HP drops to 75')
assert(engine.damageImmunityTimer > 0, 'Immunity active after enemy strike')

// Simulate active hazard hitting player during immunity
const blockedHazardRes = engine.applyDamage(20, {
  hazardId: 'ceiling-1',
  hazardType: HAZARD_TYPES.CEILING_COLLAPSE,
})
assert(blockedHazardRes === false, 'Hazard damage blocked by active enemy-triggered immunity')
assert(engine.health === 75, 'Player HP remains 75 during immunity')

// Case B: Expire immunity -> Hazard strikes player -> temporary immunity blocks immediate enemy attack
engine.damageImmunityTimer = 0
const hazardHitRes = engine.applyDamage(25, {
  hazardId: 'wiring-1',
  hazardType: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
})
assert(hazardHitRes === true, 'Hazard damage applies after immunity expires')
assert(engine.health === 50, 'Player HP drops to 50')
assert(combatEvents[combatEvents.length - 1].hazardId === 'wiring-1', 'Damage event records hazardId')

const blockedEnemyRes = engine.applyDamage(25, { enemyId: 'stalker-1' })
assert(blockedEnemyRes === false, 'Enemy attack blocked by hazard-triggered immunity')
assert(engine.health === 50, 'Player HP remains 50 during hazard-triggered immunity')

// Case C: Real EnemyAgent + HazardAgent simultaneous tick through engine loop
engine.damageImmunityTimer = 0
engine.clearHazards()
const simHazard = new HazardAgent(
  {
    id: 'sim-ceiling',
    type: HAZARD_TYPES.CEILING_COLLAPSE,
    row: 1,
    col: 2,
  },
  testMaze
)
engine.scene.add(simHazard.getMesh())
engine.hazardManager.hazards.set(simHazard.id, simHazard)

const simEnemy = engine.spawnEnemy({
  id: 'sim-stalker',
  spawnCell: { row: 1, col: 1 },
  config: { attackRange: 5, attackHitDelay: 0.05, attackCooldown: 1.5, attackDamage: 25 },
})
// Advance enemy & hazard together: whichever applies first grants immunity and blocks the second
simEnemy.state = ENEMY_STATES.ATTACK
simEnemy.attackTimer = 0.1
simHazard.state = HAZARD_STATES.ACTIVE
simHazard.timer = 0
const enemyRes = engine.enemyManager.update(0.05, {
  playerWorldPos: pPos,
  playerGridCell: { row: 1, col: 2 },
  playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
})
const hazardRes = engine.hazardManager.update(0.05, {
  playerWorldPos: pPos,
  playerGridCell: { row: 1, col: 2 },
})
assert(enemyRes.attackHits.length === 1, 'Simultaneous enemy strike produced hit')
assert(hazardRes.hazardHits.length === 1, 'Simultaneous active hazard produced hit')

for (const eh of enemyRes.attackHits) {
  engine.applyDamage(eh.damage, { enemyId: eh.enemyId })
}
for (const hh of hazardRes.hazardHits) {
  engine.applyDamage(hh.damage, { hazardId: hh.hazardId, hazardType: hh.type })
}
assert(engine.health === 25, `Only one of simultaneous hits damaged player (got HP: ${engine.health})`)

// Lethal hazard hit triggers game over cleanly and clamps at 0
engine.damageImmunityTimer = 0
const lethalRes = engine.applyDamage(50, {
  hazardId: 'sim-ceiling',
  hazardType: HAZARD_TYPES.CEILING_COLLAPSE,
})
assert(lethalRes === true, 'Lethal hazard damage applies')
assert(engine.health === 0, 'Health clamps at 0 on lethal hazard hit')
assert(engine.isGameOver === true, 'Game over triggered by lethal hazard damage')

// Reset combat resets both enemy and hazard states
engine.resetCombat()
assert(engine.health === 100, 'resetCombat restores 100 HP')
assert(engine.isGameOver === false, 'resetCombat clears game over')
assert(simHazard.getState() === HAZARD_STATES.DORMANT, 'resetCombat resets hazard states')
console.log('✓ Damage immunity integration between enemies and hazards verified')

// 8. Multiple hazards, maze replacement, and resource disposal
console.log('Test 8: Multiple Hazards, Maze Replacement & Resource Disposal')
const scene = new THREE.Scene()
const manager = new HazardManager(scene)
manager.setMaze(mediumMazeA)
const initialCount = manager.getHazards().length
assert(initialCount > 1, `HazardManager spawns multiple hazards (count: ${initialCount})`)
assert(scene.children.length === initialCount, 'Scene contains all spawned hazard meshes')

// Tick multiple hazards simultaneously
const updateRes = manager.update(0.016, {
  playerWorldPos: gridToWorld(mediumMazeA.start.row, mediumMazeA.start.col, mediumMazeA),
  playerGridCell: mediumMazeA.start,
})
assert(Array.isArray(updateRes.hazardHits), 'HazardManager update returns hazardHits array')

// Capture references to verify disposal
const previousAgents = manager.getHazards()

// Replace maze -> old hazards disposed & removed from scene, new hazards mounted
const hardcoreMaze = generateMaze({ seed: 314159 })
manager.setMaze(hardcoreMaze)
const nextCount = manager.getHazards().length
assert(nextCount > 0, `Maze spawns ${nextCount} hazards`)
assert(scene.children.length === nextCount, 'Scene cleanly replaces hazard meshes on setMaze')
for (const oldAgent of previousAgents) {
  assert(oldAgent.isDisposed === true, `Previous hazard ${oldAgent.id} disposed on maze replacement`)
  assert(oldAgent.getMesh() === null, `Previous hazard ${oldAgent.id} mesh nulled`)
}

// Clear & dispose
manager.dispose()
assert(manager.isDisposed === true, 'HazardManager marked disposed')
assert(manager.getHazards().length === 0, 'HazardManager cleared on dispose')
assert(scene.children.length === 0, 'All hazard meshes removed from scene on dispose')

// Verify MazeSceneEngine disposes its hazardManager
const engineRefManager = engine.getHazardManager()
engine.dispose()
assert(engine.isDisposed === true, 'MazeSceneEngine disposed')
assert(engineRefManager.isDisposed === true, 'MazeSceneEngine disposes hazardManager on dispose()')
console.log('✓ Multiple hazards, maze replacement, and leak-free disposal verified')

// 9. Clean Dormant State Restoration on Replay & Reset
console.log('Test 9: Clean Dormant State Restoration Across resetState() and resetCombat()')
const replayEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
replayEngine.setMaze(mediumMazeA)
const replayHazards = replayEngine.getHazardManager().getHazards()
assert(replayHazards.length === 10, `Replay maze spawns 10 realistic hazards (got ${replayHazards.length})`)

// Trigger several hazards into WARNING, ACTIVE, and DISABLED states
for (let i = 0; i < replayHazards.length; i += 1) {
  const h = replayHazards[i]
  const hPos = h.getDangerArea()?.center || gridToWorld(h.row, h.col, mediumMazeA)
  const nearCtx = {
    playerWorldPos: { x: hPos.x, y: 0, z: hPos.z },
    playerGridCell: { row: h.row, col: h.col },
  }
  h.update(0.05, nearCtx)
  assert(h.getState() === HAZARD_STATES.WARNING, `${h.type} triggered into WARNING`)
  if (i % 2 === 0) {
    h.update(h.config.warningDuration + 0.05, nearCtx)
    h.update(h.config.activeDuration + 0.05, nearCtx)
    assert(h.getState() === HAZARD_STATES.DISABLED && h.isPermanentlyCollapsed === true, `${h.type} collapsed into DISABLED`)
  }
}

replayEngine.resetCombat()
for (const h of replayHazards) {
  assert(
    h.getState() === HAZARD_STATES.DORMANT &&
      h.timer === 0 &&
      h.isPermanentlyCollapsed === false &&
      h.isDisabled === false,
    `Engine resetCombat restores hazard ${h.id} (${h.type}) cleanly to DORMANT`
  )
}
replayEngine.dispose()
console.log('✓ All 10 realistic hazards restore cleanly to DORMANT across resetState() and resetCombat()')

// 10. Rotten Furniture Collapse Warning, Tipping, Damage, and Permanent Collapse
console.log('Test 10: Rotten Furniture Collapse Warning, Tipping, Damage, and Permanent Collapse')
const furnitureCell = { row: 2, col: 2 }
const furnitureWorld = gridToWorld(furnitureCell.row, furnitureCell.col, testMaze)
const nearFurnitureCtx = {
  playerWorldPos: { x: furnitureWorld.x, y: 0, z: furnitureWorld.z },
  playerGridCell: furnitureCell,
}
const farCtx = {
  playerWorldPos: { x: furnitureWorld.x + 4, y: 0, z: furnitureWorld.z + 4 },
  playerGridCell: { row: 4, col: 4 },
}
const furnitureAgent = new HazardAgent(
  { id: 'furniture-test', type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE, ...furnitureCell },
  testMaze
)
const furnitureCfg = HAZARD_CONFIG[HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE]
assert(furnitureAgent.getState() === HAZARD_STATES.DORMANT, 'Rotten furniture starts DORMANT')

furnitureAgent.update(0.1, nearFurnitureCtx)
assert(furnitureAgent.getState() === HAZARD_STATES.WARNING, 'Rotten furniture enters WARNING on player proximity')

furnitureAgent.update(furnitureCfg.warningDuration, farCtx)
assert(furnitureAgent.getState() === HAZARD_STATES.ACTIVE, 'Rotten furniture enters ACTIVE')
const escapedHit = furnitureAgent.update(0.05, farCtx)
assert(escapedHit === null, 'Escaping impact area during warning avoids damage')

furnitureAgent.dispose()

const activeFurnitureAgent = new HazardAgent(
  { id: 'furniture-test-2', type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE, ...furnitureCell },
  testMaze
)
activeFurnitureAgent.update(0.1, nearFurnitureCtx)
const activeHit = activeFurnitureAgent.update(furnitureCfg.warningDuration, nearFurnitureCtx)
assert(activeHit && activeHit.damage === furnitureCfg.damage, `Rotten furniture deals ${furnitureCfg.damage} damage in impact area`)
activeFurnitureAgent.update(furnitureCfg.activeDuration, nearFurnitureCtx)
assert(activeFurnitureAgent.isPermanentlyCollapsed === true, 'Rotten furniture remains permanently collapsed')
assert(activeFurnitureAgent.update(1.0, nearFurnitureCtx) === null, 'Permanently collapsed furniture produces no further updates or damage')
activeFurnitureAgent.dispose()
console.log('✓ Rotten furniture collapse warning, proximity trigger, escape dodging, impact damage, and permanent collapse verified')

// 11. Falling Pipes & Metal Fixtures Warning, Detachment, Damage, and Permanent Collapse
console.log('Test 11: Falling Pipes & Metal Fixtures Warning, Detachment, Damage, and Permanent Collapse')
const pipeCell = { row: 2, col: 3 }
const pipeWorld = gridToWorld(pipeCell.row, pipeCell.col, testMaze)
const nearPipeCtx = {
  playerWorldPos: { x: pipeWorld.x, y: 0, z: pipeWorld.z },
  playerGridCell: pipeCell,
}
const pipeAgent = new HazardAgent(
  { id: 'pipe-test', type: HAZARD_TYPES.FALLING_PIPES_FIXTURES, ...pipeCell },
  testMaze
)
const pipeCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES]
assert(pipeAgent.getState() === HAZARD_STATES.DORMANT, 'Falling pipes start DORMANT')

pipeAgent.update(0.1, nearPipeCtx)
assert(pipeAgent.getState() === HAZARD_STATES.WARNING, 'Falling pipes enter WARNING on player proximity')

pipeAgent.update(pipeCfg.warningDuration, farCtx)
assert(pipeAgent.getState() === HAZARD_STATES.ACTIVE, 'Falling pipes enter ACTIVE')
const escapedPipeHit = pipeAgent.update(0.05, farCtx)
assert(escapedPipeHit === null, 'Escaping impact area during pipe warning avoids damage')
pipeAgent.dispose()

const activePipeAgent = new HazardAgent(
  { id: 'pipe-test-2', type: HAZARD_TYPES.FALLING_PIPES_FIXTURES, ...pipeCell },
  testMaze
)
activePipeAgent.update(0.1, nearPipeCtx)
const pipeHit = activePipeAgent.update(pipeCfg.warningDuration, nearPipeCtx)
assert(pipeHit && pipeHit.damage === pipeCfg.damage, `Falling pipes deal ${pipeCfg.damage} damage in impact area`)
activePipeAgent.update(pipeCfg.activeDuration, nearPipeCtx)
assert(activePipeAgent.isPermanentlyCollapsed === true, 'Falling pipes remain permanently collapsed')
assert(activePipeAgent.update(1.0, nearPipeCtx) === null, 'Permanently collapsed pipes produce no further updates or damage')
activePipeAgent.dispose()
console.log('✓ Falling pipes warning, proximity trigger, escape dodging, impact damage, and permanent collapse verified')

// 12. Steam Pipe Burst Warning, Pressure Buildup, Damage, and Permanent Safe State
console.log('Test 12: Steam Pipe Burst Warning, Pressure Buildup, Damage, and Permanent Safe State')
const steamCell = { row: 3, col: 2 }
const steamWorld = gridToWorld(steamCell.row, steamCell.col, testMaze)
const nearSteamCtx = {
  playerWorldPos: { x: steamWorld.x, y: 0, z: steamWorld.z },
  playerGridCell: steamCell,
}
const steamAgent = new HazardAgent(
  { id: 'steam-test', type: HAZARD_TYPES.STEAM_PIPE_BURST, ...steamCell },
  testMaze
)
const steamCfg = HAZARD_CONFIG[HAZARD_TYPES.STEAM_PIPE_BURST]
assert(steamAgent.getState() === HAZARD_STATES.DORMANT, 'Steam pipe starts DORMANT')

steamAgent.update(0.1, nearSteamCtx)
assert(steamAgent.getState() === HAZARD_STATES.WARNING, 'Steam pipe enters WARNING on player proximity')

steamAgent.update(steamCfg.warningDuration, farCtx)
assert(steamAgent.getState() === HAZARD_STATES.ACTIVE, 'Steam pipe enters ACTIVE')
const escapedSteamHit = steamAgent.update(0.05, farCtx)
assert(escapedSteamHit === null, 'Escaping impact area during steam warning avoids damage')
steamAgent.dispose()

const activeSteamAgent = new HazardAgent(
  { id: 'steam-test-2', type: HAZARD_TYPES.STEAM_PIPE_BURST, ...steamCell },
  testMaze
)
activeSteamAgent.update(0.1, nearSteamCtx)
const steamHit = activeSteamAgent.update(steamCfg.warningDuration, nearSteamCtx)
assert(steamHit && steamHit.damage === steamCfg.damage, `Steam pipe burst deals ${steamCfg.damage} damage in impact area`)
activeSteamAgent.update(steamCfg.activeDuration, nearSteamCtx)
assert(activeSteamAgent.isPermanentlyCollapsed === true, 'Steam pipe remains permanently safe / disabled')
assert(activeSteamAgent.update(1.0, nearSteamCtx) === null, 'Permanently safe steam pipe produces no further updates or damage')
activeSteamAgent.dispose()
console.log('✓ Steam pipe burst warning, proximity trigger, escape dodging, impact damage, and permanent safe state verified')

// 13. Exposed Electrical Wiring — Deterministic Placement & Believable Wall/Ceiling Mounting
console.log('Test 13: Exposed Electrical Wiring Placement & Wall/Ceiling Mounting')
{
  const wallDirOffsets = {
    north: [-1, 0],
    south: [1, 0],
    west: [0, -1],
    east: [0, 1],
  }
  for (const seed of [771234, 314159, 445566, 998877]) {
    const m = generateMaze({ seed })
    const placed = placeHazards(m)
    const wiringSpecs = placed.filter((h) => h.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING)
    assert(wiringSpecs.length >= 1, `Seed ${seed} places exposed_electrical_wiring`)
    for (const spec of wiringSpecs) {
      assert(
        spec.mountType === 'wall' || spec.mountType === 'ceiling',
        `Exposed wiring must be wall or ceiling mounted (got ${spec.mountType})`
      )
      if (spec.mountType === 'wall') {
        const [dr, dc] = wallDirOffsets[spec.wallSide] || [0, 0]
        assert(
          m.grid[spec.row + dr]?.[spec.col + dc] === CELL_TYPES.WALL,
          `Wall-mounted wiring at (${spec.row},${spec.col}) side ${spec.wallSide} must attach to an actual WALL cell`
        )
      }
      assert(
        spec.localDischargeOffset && spec.localDischargeOffset.y >= 1.2,
        'Exposed wiring discharge is elevated (wall/ceiling), never an arbitrary floor object'
      )
    }
  }

  // Open 4-way cell with no adjacent walls must mount to ceiling (never floor)
  const openGrid = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ]
  const openMount = resolveElectricalMount(openGrid, 2, 2)
  assert(openMount.mountType === 'ceiling', 'Open cell mounts exposed wiring to ceiling soffit')
  assert(openMount.localDischargeOffset.y >= 1.5, 'Ceiling-mounted wiring hangs from overhead')

  // Verify bounded spark count & structural groups on both wall and ceiling builds
  const ceilingWiringAgent = new HazardAgent(
    {
      id: 'wiring-ceiling-check',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 2,
      col: 2,
    },
    { ...testMaze, grid: openGrid }
  )
  const cData = ceilingWiringAgent.getMesh().userData
  assert(cData.mountType === 'ceiling', 'Ceiling agent builds ceiling-mounted mesh')
  assert(Array.isArray(cData.sparkMeshes) && cData.sparkMeshes.length <= 8, 'Spark count is bounded for mobile performance')
  assert(Array.isArray(cData.arcBolts) && cData.arcBolts.length === 3, 'Arc bolt count is bounded')
  ceilingWiringAgent.dispose()
}
console.log('✓ Exposed electrical wiring deterministic placement and wall/ceiling mounting verified')

// 14. Exposed Electrical Wiring — Warning, World-Space Danger Area Collision, Escape & Permanent Disabled State
console.log('Test 14: Exposed Electrical Wiring Lifecycle, World-Space Collision & Permanent Disable')
{
  // Cell (1, 2) in testMaze has a WALL directly to the north (0, 2) and south (2, 2)
  const wiringCell = { row: 1, col: 2 }
  const wiringCellWorld = gridToWorld(wiringCell.row, wiringCell.col, testMaze)
  const wiringCfg = HAZARD_CONFIG[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]

  // Case A: Same grid cell, but player stands OUTSIDE world-space danger area -> 0 damage!
  const wallWiringAgent = new HazardAgent(
    {
      id: 'wiring-worldspace-test',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: wiringCell.row,
      col: wiringCell.col,
      wallSide: 'north',
    },
    testMaze
  )
  const dangerArea = wallWiringAgent.getDangerArea()
  assert(dangerArea && dangerArea.mountType === 'wall' && dangerArea.wallSide === 'north', 'Mounted to north wall')
  assert(dangerArea.center.z < wiringCellWorld.z, 'North-wall discharge center sits toward north wall')

  // Far away -> stays DORMANT indefinitely (does not burn out before player arrives)
  const farPlayerCtx = {
    playerWorldPos: { x: wiringCellWorld.x + 8, y: 0, z: wiringCellWorld.z + 8 },
    playerGridCell: { row: 3, col: 3 },
  }
  for (let i = 0; i < 20; i += 1) {
    assert(wallWiringAgent.update(0.25, farPlayerCtx) === null, 'Dormant wiring deals no damage')
    assert(wallWiringAgent.getState() === HAZARD_STATES.DORMANT, 'Wiring waits in DORMANT until player approaches')
  }

  // Approach near discharge -> enters WARNING
  const insideDangerCtx = {
    playerWorldPos: { x: dangerArea.center.x, y: 0, z: dangerArea.center.z + 0.35 },
    playerGridCell: wiringCell,
  }
  let hitRes = wallWiringAgent.update(0.1, insideDangerCtx)
  assert(wallWiringAgent.getState() === HAZARD_STATES.WARNING, 'Wiring enters WARNING on approach')
  assert(hitRes === null, 'Warning phase deals no premature damage')
  const wData = wallWiringAgent.getMesh().userData
  assert(wData.sparkGroup.visible === true, 'Warning phase displays visible sparks')
  assert(wData.tipMat.emissiveIntensity > 0.5, 'Warning phase increases flickering tip emissive')

  // Player moves to opposite side of the SAME grid cell (1, 2), outside world-space dangerRadius
  const sameCellSafeCtx = {
    playerWorldPos: { x: wiringCellWorld.x, y: 0, z: wiringCellWorld.z + 1.55 },
    playerGridCell: wiringCell,
  }
  const distSafe = Math.hypot(
    sameCellSafeCtx.playerWorldPos.x - dangerArea.center.x,
    sameCellSafeCtx.playerWorldPos.z - dangerArea.center.z
  )
  assert(distSafe > dangerArea.radius, `Safe position on same tile (${distSafe.toFixed(2)}m) is outside dangerRadius (${dangerArea.radius}m)`)

  // Remain in WARNING until just before discharge
  assert(wallWiringAgent.update(wiringCfg.warningDuration - 0.15, sameCellSafeCtx) === null, 'No damage during late warning')
  assert(wallWiringAgent.getState() === HAZARD_STATES.WARNING, 'Fair warning window maintained before discharge')

  // Cross into ACTIVE while standing on SAME grid cell but OUTSIDE world-space danger radius
  hitRes = wallWiringAgent.update(0.2, sameCellSafeCtx)
  assert(wallWiringAgent.getState() === HAZARD_STATES.ACTIVE, 'Wiring enters ACTIVE electrical discharge')
  assert(hitRes === null, 'Player outside world-space danger area takes 0 damage even on same grid cell')
  assert(wData.arcGroup.visible === true, 'Active discharge displays visible electrical arcs')
  assert(wData.sparkGroup.visible === true, 'Active discharge displays visible sparks')

  // Finish ACTIVE duration -> permanently DISABLED (burned-out safe visual state)
  const disableHit = wallWiringAgent.update(wiringCfg.activeDuration, insideDangerCtx)
  assert(disableHit && disableHit.damage === wiringCfg.damage, 'Active discharge hits player who steps inside before finishing')
  assert(wallWiringAgent.getState() === HAZARD_STATES.DISABLED, 'Wiring transitions to permanent DISABLED state')
  assert(wallWiringAgent.isDisabled === true && wallWiringAgent.isPermanentlyCollapsed === true, 'Permanent disabled flags set')
  assert(wData.arcGroup.visible === false && wData.sparkGroup.visible === false && wData.glowMesh.visible === false, 'Disabled wiring hides arcs, sparks, and glow')
  assert(wData.tipMat.emissiveIntensity === 0, 'Disabled wiring clears emissive glow (charred)')

  // Standing directly on burned-out wires deals NO further damage
  assert(wallWiringAgent.update(0.5, insideDangerCtx) === null, 'Permanently disabled wiring never damages again')
  assert(wallWiringAgent.getState() === HAZARD_STATES.DISABLED, 'Stays permanently DISABLED')

  // resetState() cleanly restores DORMANT for replay
  wallWiringAgent.resetState()
  assert(wallWiringAgent.getState() === HAZARD_STATES.DORMANT, 'resetState restores DORMANT')
  assert(wallWiringAgent.isDisabled === false && wallWiringAgent.isPermanentlyCollapsed === false, 'resetState clears disabled flags')
  wallWiringAgent.dispose()

  // Case B: Player stays INSIDE world-space danger area -> takes exact damage once, then disables
  const hitWiringAgent = new HazardAgent(
    {
      id: 'wiring-hit-test',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: wiringCell.row,
      col: wiringCell.col,
      wallSide: 'north',
    },
    testMaze
  )
  hitWiringAgent.update(0.05, insideDangerCtx)
  assert(hitWiringAgent.getState() === HAZARD_STATES.WARNING, 'Hit test enters WARNING')
  const dischargeHit = hitWiringAgent.update(wiringCfg.warningDuration + 0.05, insideDangerCtx)
  assert(hitWiringAgent.getState() === HAZARD_STATES.ACTIVE, 'Hit test enters ACTIVE')
  assert(dischargeHit && dischargeHit.damage === wiringCfg.damage, `Active discharge deals ${wiringCfg.damage} damage inside danger area`)
  assert(hitWiringAgent.update(0.15, insideDangerCtx) === null, 'Active discharge deals damage only once')
  hitWiringAgent.update(wiringCfg.activeDuration, insideDangerCtx)
  assert(hitWiringAgent.getState() === HAZARD_STATES.DISABLED, 'Hit test transitions to permanent DISABLED after discharge')
  assert(hitWiringAgent.update(1.0, insideDangerCtx) === null, 'Disabled wiring never damages on subsequent frames')
  hitWiringAgent.dispose()
}
console.log('✓ Exposed electrical wiring warning, world-space collision, escape, single-hit damage, and permanent disabled state verified')

// 15. Exposed Electrical Wiring — Engine Damage, Invulnerability & Game-Over Pipeline
console.log('Test 15: Exposed Electrical Wiring Engine Damage & Invulnerability Integration')
{
  const wiringEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 1.2,
    enemies: { autoSpawn: false },
  })
  const damageLog = []
  wiringEngine._onPlayerDamage = (ev) => damageLog.push(ev)
  wiringEngine.setMaze(testMaze)
  wiringEngine.clearHazards()

  const engineWiring = new HazardAgent(
    {
      id: 'engine-wiring-1',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 1,
      col: 2,
      wallSide: 'north',
    },
    testMaze
  )
  wiringEngine.scene.add(engineWiring.getMesh())
  wiringEngine.hazardManager.hazards.set(engineWiring.id, engineWiring)

  const dangerPos = engineWiring.getDangerArea().center
  const ctx = {
    playerWorldPos: { x: dangerPos.x, y: 0, z: dangerPos.z },
    playerGridCell: { row: 1, col: 2 },
  }
  const wCfg = HAZARD_CONFIG[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]

  // Trigger warning -> active via HazardManager -> MazeSceneEngine.applyDamage
  wiringEngine.hazardManager.update(0.05, ctx)
  const mgrRes = wiringEngine.hazardManager.update(wCfg.warningDuration + 0.05, ctx)
  assert(mgrRes.hazardHits.length === 1, 'HazardManager reports exposed wiring hit')
  const applied = wiringEngine.applyDamage(mgrRes.hazardHits[0].damage, {
    hazardId: mgrRes.hazardHits[0].hazardId,
    hazardType: mgrRes.hazardHits[0].type,
  })
  assert(applied === true, 'Engine applies exposed wiring damage')
  assert(wiringEngine.health === 70, `HP drops from 100 to 70 (got ${wiringEngine.health})`)
  assert(wiringEngine.damageImmunityTimer > 0, 'Invulnerability activated after electrical shock')
  assert(damageLog[damageLog.length - 1].hazardType === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING, 'Damage event records exposed_electrical_wiring')

  // Invulnerability blocks simultaneous enemy hit
  assert(wiringEngine.applyDamage(25, { enemyId: 'stalker-x' }) === false, 'Invulnerability blocks follow-up damage')

  // Lethal hit after immunity expires triggers game over cleanly
  wiringEngine.damageImmunityTimer = 0
  wiringEngine.applyDamage(70, { hazardId: 'engine-wiring-1', hazardType: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING })
  assert(wiringEngine.health === 0 && wiringEngine.isGameOver === true, 'Lethal electrical damage triggers game over')

  // Reset combat restores health & hazard state
  engineWiring.update(wCfg.activeDuration, ctx)
  assert(engineWiring.getState() === HAZARD_STATES.DISABLED, 'Wiring disabled before resetCombat')
  wiringEngine.resetCombat()
  assert(wiringEngine.health === 100 && wiringEngine.isGameOver === false, 'resetCombat restores HP and clears game over')
  assert(engineWiring.getState() === HAZARD_STATES.DORMANT, 'resetCombat restores disabled wiring to DORMANT')

  wiringEngine.dispose()
}
console.log('✓ Exposed electrical wiring damage, invulnerability, game-over, and resetCombat verified')

// 16. Exposed Electrical Wiring — Spatial Audio & Subtitles (Muted, Zero Volume, No Duplicates)
console.log('Test 16: Exposed Electrical Wiring Spatial Audio & Subtitles (Muted & Zero-Volume Safe)')
{
  const audioEngine = new HorrorAudioEngine({
    volumes: { master: 0, effects: 0, ambience: 0, music: 0, muted: true },
    debugHistory: true,
  })
  audioEngine._debugHistoryEnabled = true
  audioEngine.setMaze(testMaze)
  audioEngine.setAudioOptions({ subtitles: true })

  const subtitles = []
  const unsub = audioEngine.subscribeSubtitles((entry) => subtitles.push(entry))

  const wiringAudioAgent = new HazardAgent(
    {
      id: 'audio-wiring-1',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 1,
      col: 2,
      wallSide: 'north',
    },
    testMaze
  )
  const wPos = wiringAudioAgent.worldPos
  assert(wPos && Number.isFinite(wPos.x) && Number.isFinite(wPos.z), 'Exposed wiring agent exposes valid worldPos for spatial audio')

  const audioCtx = {
    playerWorldPos: { x: wPos.x, y: 0, z: wPos.z + 0.5 },
    hazards: [wiringAudioAgent],
  }
  const wCfg = HAZARD_CONFIG[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]

  // Frame 1: DORMANT baseline (no subtitle)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 0, 'No subtitle emitted while dormant')

  // Transition to WARNING -> emits warning subtitle even while muted & master=0
  wiringAudioAgent.update(0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(wiringAudioAgent.getState() === HAZARD_STATES.WARNING, 'Agent enters WARNING')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx) // Repeated frame in WARNING must NOT duplicate
  assert(subtitles.length === 1, `Warning subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[0].text === 'Exposed wiring buzzing and sparking',
    `Expected warning subtitle, got "${subtitles[0].text}"`
  )

  // Transition to ACTIVE -> emits active discharge subtitle once even while muted & master=0
  wiringAudioAgent.update(wCfg.warningDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(wiringAudioAgent.getState() === HAZARD_STATES.ACTIVE, 'Agent enters ACTIVE')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx) // Repeated frame in ACTIVE must NOT duplicate
  assert(subtitles.length === 2, `Active subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[1].text === 'Electrical discharge crackling',
    `Expected active subtitle, got "${subtitles[1].text}"`
  )

  // Transition to DISABLED -> emits NO extra subtitle
  wiringAudioAgent.update(wCfg.activeDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(wiringAudioAgent.getState() === HAZARD_STATES.DISABLED, 'Agent enters DISABLED')
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, 'Disabled transition emits no duplicate or extra subtitle')

  // Verify cue recording for both transitions
  const cueTypes = audioEngine.getCueHistory().map((c) => c.type)
  assert(cueTypes.includes('hazard_exposed_electrical_wiring_warning'), 'Warning spatial audio cue recorded')
  assert(cueTypes.includes('hazard_exposed_electrical_wiring_active'), 'Active spatial audio cue recorded')

  // Verify procedural WebAudio synthesis executes cleanly for exposed_electrical_wiring
  let oscCount = 0
  let noiseCount = 0
  const makeParam = () => ({
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  })
  const mockCtx = {
    currentTime: 1.0,
    createOscillator: () => {
      oscCount += 1
      return {
        type: 'sawtooth',
        frequency: makeParam(),
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createBufferSource: () => {
      noiseCount += 1
      return {
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createGain: () => ({ gain: makeParam(), connect: () => {}, disconnect: () => {} }),
    createBiquadFilter: () => ({
      type: 'bandpass',
      frequency: makeParam(),
      Q: makeParam(),
      connect: () => {},
      disconnect: () => {},
    }),
  }
  const mockDest = {}
  const mockNoiseBuffer = {}
  triggerHazardCue(mockCtx, mockDest, mockNoiseBuffer, HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING, 'warning')
  triggerHazardCue(mockCtx, mockDest, mockNoiseBuffer, HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING, 'active')
  assert(oscCount >= 3 && noiseCount >= 3, `Exposed wiring audio synthesis triggers buzz + crackle layers (osc=${oscCount}, noise=${noiseCount})`)

  unsub()
  wiringAudioAgent.dispose()
  audioEngine.dispose()
}
console.log('✓ Exposed electrical wiring spatial cues and muted/zero-volume subtitles verified without duplicates')

// 17. Exposed Electrical Wiring — Instance Resource Cleanup & Shared Pool Integrity
console.log('Test 17: Exposed Electrical Wiring Disposal & Shared Pool Integrity')
{
  const disposeAgent = new HazardAgent(
    {
      id: 'wiring-dispose-check',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 1,
      col: 2,
      wallSide: 'north',
    },
    testMaze
  )
  const mesh = disposeAgent.getMesh()
  const { tipMat, arcMat, sparkMat, glowMat } = mesh.userData
  const disposedMats = []
  for (const [label, mat] of [
    ['tipMat', tipMat],
    ['arcMat', arcMat],
    ['sparkMat', sparkMat],
    ['glowMat', glowMat],
  ]) {
    const origDispose = mat.dispose.bind(mat)
    mat.dispose = () => {
      disposedMats.push(label)
      origDispose()
    }
  }

  const poolStatsBefore = getHazardPoolStats()
  disposeAgent.dispose()
  const poolStatsAfter = getHazardPoolStats()

  assert(disposedMats.length === 4, `All 4 instance-owned materials disposed (got ${disposedMats.join(', ')})`)
  assert(disposeAgent.isDisposed === true && disposeAgent.getMesh() === null, 'Agent marked disposed and mesh nulled')
  assert(mesh.userData.tipMat === null && mesh.userData.sparkMeshes === null, 'Mesh userData references cleared')
  assert(
    poolStatsAfter.geometries === poolStatsBefore.geometries &&
      poolStatsAfter.materials === poolStatsBefore.materials,
    'Shared hazard pools preserved after single-instance disposal'
  )
}
console.log('✓ Exposed electrical wiring instance-owned disposal and shared pool preservation verified')

// 18. Collapsing Floor Grate — Deterministic Placement & Floor-Flush Alignment
console.log('Test 18: Collapsing Floor Grate Placement & Floor-Flush Alignment')
{
  for (const seed of [771234, 314159, 445566, 998877]) {
    const m = generateMaze({ seed })
    const placed = placeHazards(m)
    const grateSpecs = placed.filter((h) => h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE)
    assert(grateSpecs.length >= 1, `Seed ${seed} places collapsing_floor_grate`)
    const startKey = `${m.start.row},${m.start.col}`
    const exitKey = `${m.exit.row},${m.exit.col}`
    for (const spec of grateSpecs) {
      const key = `${spec.row},${spec.col}`
      assert(m.grid[spec.row]?.[spec.col] === CELL_TYPES.PATH, `Grate (${key}) must be on PATH`)
      assert(key !== startKey && key !== exitKey, 'Grate must not overlap start or exit')
      assert(spec.floorY === 0, `Grate floorY must sit flush at y=0 (got ${spec.floorY})`)
      assert(
        spec.corridorAxis === 'ns' || spec.corridorAxis === 'ew',
        `Grate corridorAxis must be ns or ew (got ${spec.corridorAxis})`
      )
    }
  }

  // Verify corridor axis orientation resolution for EW vs NS corridor
  const ewOrient = resolveFloorGrateOrientation(testMaze.grid, 1, 2)
  const nsOrient = resolveFloorGrateOrientation(testMaze.grid, 2, 1)
  assert(ewOrient.corridorAxis === 'ew' && Math.abs(ewOrient.grateYaw - Math.PI * 0.5) < 1e-6, 'EW corridor aligns grate along EW')
  assert(nsOrient.corridorAxis === 'ns' && nsOrient.grateYaw === 0, 'NS corridor aligns grate along NS')

  // Verify floor-flush geometry and bounded particle/debris counts
  const grateCheck = new HazardAgent(
    { id: 'grate-align-check', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 1, col: 2 },
    testMaze
  )
  const gMesh = grateCheck.getMesh()
  const gData = gMesh.userData
  assert(gMesh.position.y === 0, 'Grate mesh root sits flush on floor y=0')
  assert(gData.pitMesh && gData.pitMesh.position.y > 0 && gData.pitMesh.position.y < 0.01, 'Recessed pit flush at floor surface without floating')
  assert(gData.leftLeafGroup.position.y <= 0.02 && gData.rightLeafGroup.position.y <= 0.02, 'Grate leaves sit flush inside floor curb')
  assert(gData.warningFragments.length <= 6 && gData.debrisMeshes.length <= 8 && gData.dustMeshes.length <= 6, 'Debris, fragment, and dust counts are bounded')
  grateCheck.dispose()
}
console.log('✓ Collapsing floor grate deterministic placement, floor-flush alignment, and bounded effects verified')

// 19. Collapsing Floor Grate — Trigger, Warning Vibration/Bending, Collapse, World-Space Collision, Escape & Permanent Broken State
console.log('Test 19: Collapsing Floor Grate Lifecycle, World-Space Collision, Escape & Permanent Broken State')
{
  const grateCell = { row: 1, col: 2 }
  const grateWorld = gridToWorld(grateCell.row, grateCell.col, testMaze)
  const grateCfg = HAZARD_CONFIG[HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]

  const grateAgent = new HazardAgent(
    { id: 'grate-escape-test', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, ...grateCell },
    testMaze
  )
  const dangerArea = grateAgent.getDangerArea()
  assert(dangerArea && dangerArea.radius === grateCfg.dangerRadius && dangerArea.floorY === 0, 'Danger area matches floor grate footprint')

  // Far away -> stays DORMANT indefinitely (does not collapse before player steps on it)
  const farCtx = {
    playerWorldPos: { x: grateWorld.x + 6, y: 0, z: grateWorld.z + 6 },
    playerGridCell: { row: 3, col: 3 },
  }
  for (let i = 0; i < 20; i += 1) {
    assert(grateAgent.update(0.25, farCtx) === null, 'Dormant grate deals no damage')
    assert(grateAgent.getState() === HAZARD_STATES.DORMANT, 'Grate stays DORMANT until player steps onto trigger area')
  }

  // Player on SAME grid cell but outside triggerRadius (hugging far edge of 4m cell) -> does NOT trigger
  const edgeSafeCtx = {
    playerWorldPos: { x: grateWorld.x + 1.65, y: 0, z: grateWorld.z },
    playerGridCell: grateCell,
  }
  assert(grateAgent.update(0.1, edgeSafeCtx) === null, 'Outside triggerRadius does not damage')
  assert(grateAgent.getState() === HAZARD_STATES.DORMANT, 'Player on same tile outside triggerRadius does not prematurely trigger grate')

  // Step onto grate -> enters WARNING with vibration, bending, loosening bolts, and falling fragments
  const onGrateCtx = {
    playerWorldPos: { x: grateWorld.x + 0.2, y: 0, z: grateWorld.z - 0.15 },
    playerGridCell: grateCell,
  }
  const gData = grateAgent.getMesh().userData
  const initialBoltY = gData.bolts[0].position.y
  const initialLeftRotZ = gData.leftLeafGroup.rotation.z

  assert(grateAgent.update(0.1, onGrateCtx) === null, 'Initial trigger deals no premature damage')
  assert(grateAgent.getState() === HAZARD_STATES.WARNING, 'Stepping onto grate enters WARNING')
  assert(grateAgent.update(grateCfg.warningDuration * 0.55, onGrateCtx) === null, 'Mid-warning deals no damage')
  assert(gData.warningFragGroup.visible === true, 'Warning phase emits falling rust fragments')
  assert(gData.leftLeafGroup.rotation.z < initialLeftRotZ - 0.04, 'Grate bends downward visibly during warning')
  assert(gData.bolts[0].position.y > initialBoltY, 'Corner bolts vibrate and loosen upward during warning')

  // Player steps off grate to edge of SAME grid cell (outside dangerRadius 1.15m) before collapse -> ZERO damage!
  const escapeHit = grateAgent.update(grateCfg.warningDuration * 0.5, edgeSafeCtx)
  assert(grateAgent.getState() === HAZARD_STATES.ACTIVE, 'Grate transitions to ACTIVE collapse')
  assert(escapeHit === null, 'Escaping outside world-space dangerRadius prevents damage even on same grid cell')

  // Mid-collapse animation checks: leaves dropping downward, broken stubs, debris & dust active
  assert(grateAgent.update(grateCfg.activeDuration * 0.45, edgeSafeCtx) === null, 'Player outside dangerRadius stays safe during collapse')
  assert(gData.leftLeafGroup.position.y < gData.grateRestY - 0.04, 'Grate leaves drop downward during collapse')
  assert(gData.leftLeafGroup.rotation.z < -0.35 && gData.rightLeafGroup.rotation.z > 0.35, 'Grate leaves break downward into pit')
  assert(gData.brokenStubsGroup.visible === true, 'Broken rim stubs appear during collapse')
  assert(gData.debrisGroup.visible === true, 'Collapse debris shards scatter around rim')
  assert(gData.dustGroup.visible === true && gData.dustMat.opacity > 0, 'Dust burst rises during collapse')

  // Complete collapse -> permanent broken/open-grate DISABLED state
  grateAgent.update(grateCfg.activeDuration * 0.65, edgeSafeCtx)
  assert(grateAgent.getState() === HAZARD_STATES.DISABLED, 'Grate transitions permanently to DISABLED broken state')
  assert(grateAgent.isDisabled === true && grateAgent.isPermanentlyCollapsed === true, 'Permanent collapse flags set')
  assert(gData.leftLeafGroup.position.y < -0.25 && gData.rightLeafGroup.position.y < -0.25, 'Collapsed grate leaves stay dropped open')
  assert(gData.brokenStubsGroup.visible === true && gData.debrisGroup.visible === true, 'Permanent broken stubs and settled debris remain visible')
  assert(gData.dustGroup.visible === false && gData.dustMat.opacity === 0 && gData.warningFragGroup.visible === false, 'Temporary dust and warning fragments cleaned up')

  // Standing directly over the permanently broken grate never triggers or damages again
  assert(grateAgent.update(0.5, onGrateCtx) === null, 'Permanently broken grate never damages again')
  assert(grateAgent.getState() === HAZARD_STATES.DISABLED, 'Grate remains permanently DISABLED')

  // Reset restores intact floor-flush grate with zero duplicate children
  const childCountBeforeReset = grateAgent.getMesh().children.length
  const rootChildCountBeforeReset = gData.grateRoot.children.length
  grateAgent.resetState()
  assert(grateAgent.getState() === HAZARD_STATES.DORMANT, 'resetState restores DORMANT')
  assert(grateAgent.isDisabled === false && grateAgent.isPermanentlyCollapsed === false, 'resetState clears disabled flags')
  assert(Math.abs(gData.leftLeafGroup.position.y - gData.grateRestY) < 1e-6, 'resetState restores leaves flush with floor')
  assert(gData.brokenStubsGroup.visible === false && gData.debrisGroup.visible === false, 'resetState hides broken stubs and debris')
  assert(
    grateAgent.getMesh().children.length === childCountBeforeReset &&
      gData.grateRoot.children.length === rootChildCountBeforeReset,
    'resetState restores grate cleanly without duplicate meshes'
  )
  grateAgent.dispose()

  // Case B: Player remains ON the grate through collapse -> takes exact single-hit damage
  const hitGrateAgent = new HazardAgent(
    { id: 'grate-hit-test', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, ...grateCell },
    testMaze
  )
  hitGrateAgent.update(0.05, onGrateCtx)
  assert(hitGrateAgent.getState() === HAZARD_STATES.WARNING, 'Hit grate enters WARNING')
  const collapseHit = hitGrateAgent.update(grateCfg.warningDuration + 0.05, onGrateCtx)
  assert(hitGrateAgent.getState() === HAZARD_STATES.ACTIVE, 'Hit grate enters ACTIVE')
  assert(collapseHit && collapseHit.damage === grateCfg.damage, `Collapsing grate deals ${grateCfg.damage} damage when player stays on grate`)
  assert(hitGrateAgent.update(0.15, onGrateCtx) === null, 'Collapsing grate deals damage only once')
  hitGrateAgent.update(grateCfg.activeDuration, onGrateCtx)
  assert(hitGrateAgent.getState() === HAZARD_STATES.DISABLED, 'Hit grate transitions permanently to DISABLED')
  assert(hitGrateAgent.update(1.0, onGrateCtx) === null, 'Disabled grate never deals repeated damage')
  hitGrateAgent.dispose()
}
console.log('✓ Collapsing floor grate trigger, warning, collapse animation, escape, world-space collision, and permanent broken state verified')

// 20. Collapsing Floor Grate — Engine Damage, Invulnerability, Game-Over & Replay Reset
console.log('Test 20: Collapsing Floor Grate Engine Damage, Invulnerability & Replay Reset')
{
  const grateEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 1.2,
    enemies: { autoSpawn: false },
  })
  const damageEvents = []
  grateEngine._onPlayerDamage = (ev) => damageEvents.push(ev)
  grateEngine.setMaze(testMaze)
  grateEngine.clearHazards()

  const engGrate = new HazardAgent(
    { id: 'engine-grate-1', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 1, col: 2 },
    testMaze
  )
  grateEngine.scene.add(engGrate.getMesh())
  grateEngine.hazardManager.hazards.set(engGrate.id, engGrate)

  const gCenter = engGrate.getDangerArea().center
  const onCtx = {
    playerWorldPos: { x: gCenter.x, y: 0, z: gCenter.z },
    playerGridCell: { row: 1, col: 2 },
  }
  const gCfg = HAZARD_CONFIG[HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]

  grateEngine.hazardManager.update(0.05, onCtx)
  const mgrRes = grateEngine.hazardManager.update(gCfg.warningDuration + 0.05, onCtx)
  assert(mgrRes.hazardHits.length === 1, 'HazardManager reports collapsing_floor_grate hit')
  const applied = grateEngine.applyDamage(mgrRes.hazardHits[0].damage, {
    hazardId: mgrRes.hazardHits[0].hazardId,
    hazardType: mgrRes.hazardHits[0].type,
  })
  assert(applied === true, 'MazeSceneEngine applies floor grate damage')
  assert(grateEngine.health === 70, `HP drops from 100 to 70 (got ${grateEngine.health})`)
  assert(grateEngine.damageImmunityTimer > 0, 'Invulnerability activated after grate collapse damage')
  assert(damageEvents[damageEvents.length - 1].hazardType === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, 'Damage event records collapsing_floor_grate')
  assert(grateEngine.applyDamage(25, { enemyId: 'stalker-g' }) === false, 'Invulnerability blocks immediate follow-up attack')

  grateEngine.damageImmunityTimer = 0
  grateEngine.applyDamage(70, { hazardId: 'engine-grate-1', hazardType: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE })
  assert(grateEngine.health === 0 && grateEngine.isGameOver === true, 'Lethal floor grate hit triggers game over')

  engGrate.update(gCfg.activeDuration, onCtx)
  assert(engGrate.getState() === HAZARD_STATES.DISABLED, 'Grate disabled before resetCombat')
  grateEngine.resetCombat()
  assert(grateEngine.health === 100 && grateEngine.isGameOver === false, 'resetCombat restores HP and clears game over')
  assert(engGrate.getState() === HAZARD_STATES.DORMANT, 'resetCombat restores floor grate to intact DORMANT state')
  grateEngine.dispose()
}
console.log('✓ Collapsing floor grate damage, invulnerability, game-over, and resetCombat verified')

// 21. Collapsing Floor Grate — Spatial Audio & Subtitles (Muted, Zero Volume, No Duplicates)
console.log('Test 21: Collapsing Floor Grate Spatial Audio & Subtitles (Muted & Zero-Volume Safe)')
{
  const audioEngine = new HorrorAudioEngine({
    volumes: { master: 0, effects: 0, ambience: 0, music: 0, muted: true },
    debugHistory: true,
  })
  audioEngine._debugHistoryEnabled = true
  audioEngine.setMaze(testMaze)
  audioEngine.setAudioOptions({ subtitles: true })

  const subtitles = []
  const unsub = audioEngine.subscribeSubtitles((entry) => subtitles.push(entry))

  const grateAudioAgent = new HazardAgent(
    { id: 'audio-grate-1', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 1, col: 2 },
    testMaze
  )
  const gPos = grateAudioAgent.worldPos
  assert(gPos && Number.isFinite(gPos.x) && Number.isFinite(gPos.z), 'Floor grate exposes valid worldPos for spatial audio')

  const audioCtx = {
    playerWorldPos: { x: gPos.x, y: 0, z: gPos.z + 0.3 },
    hazards: [grateAudioAgent],
  }
  const gCfg = HAZARD_CONFIG[HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]

  // Frame 1: DORMANT baseline (no subtitle)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 0, 'No subtitle while floor grate is dormant')

  // Transition to WARNING -> emits subtitle once even while muted & master=0
  grateAudioAgent.update(0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(grateAudioAgent.getState() === HAZARD_STATES.WARNING, 'Grate enters WARNING')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 1, `Warning subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[0].text === 'Floor grate creaking and bending',
    `Expected warning subtitle, got "${subtitles[0].text}"`
  )

  // Transition to ACTIVE -> emits collapse subtitle once even while muted & master=0
  grateAudioAgent.update(gCfg.warningDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(grateAudioAgent.getState() === HAZARD_STATES.ACTIVE, 'Grate enters ACTIVE')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, `Collapse subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[1].text === 'Metal grate collapsing',
    `Expected collapse subtitle, got "${subtitles[1].text}"`
  )

  // Transition to DISABLED -> no extra subtitle
  grateAudioAgent.update(gCfg.activeDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(grateAudioAgent.getState() === HAZARD_STATES.DISABLED, 'Grate enters DISABLED')
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, 'Disabled state emits no extra or duplicate subtitle')

  const cueTypes = audioEngine.getCueHistory().map((c) => c.type)
  assert(cueTypes.includes('hazard_collapsing_floor_grate_warning'), 'Warning spatial audio cue recorded')
  assert(cueTypes.includes('hazard_collapsing_floor_grate_active'), 'Active collapse spatial audio cue recorded')

  // Verify WebAudio synthesis executes cleanly for collapsing_floor_grate warning and active cues
  let oscCount = 0
  let noiseCount = 0
  const makeParam = () => ({
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  })
  const mockCtx = {
    currentTime: 1.0,
    createOscillator: () => {
      oscCount += 1
      return {
        type: 'sawtooth',
        frequency: makeParam(),
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createBufferSource: () => {
      noiseCount += 1
      return {
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createGain: () => ({ gain: makeParam(), connect: () => {}, disconnect: () => {} }),
    createBiquadFilter: () => ({
      type: 'bandpass',
      frequency: makeParam(),
      Q: makeParam(),
      connect: () => {},
      disconnect: () => {},
    }),
  }
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, 'warning')
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, 'active')
  assert(oscCount >= 4 && noiseCount >= 2, `Floor grate audio synthesis triggers groan/creak + crash layers (osc=${oscCount}, noise=${noiseCount})`)

  unsub()
  grateAudioAgent.dispose()
  audioEngine.dispose()
}
console.log('✓ Collapsing floor grate spatial audio and muted/zero-volume subtitles verified without duplicates')

// 22. Collapsing Floor Grate — Instance Resource Cleanup & Shared Pool Integrity
console.log('Test 22: Collapsing Floor Grate Disposal & Shared Pool Integrity')
{
  const disposeGrate = new HazardAgent(
    { id: 'grate-dispose-check', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 1, col: 2 },
    testMaze
  )
  const mesh = disposeGrate.getMesh()
  const { dustMat } = mesh.userData
  let dustDisposed = false
  const origDispose = dustMat.dispose.bind(dustMat)
  dustMat.dispose = () => {
    dustDisposed = true
    origDispose()
  }

  const poolStatsBefore = getHazardPoolStats()
  disposeGrate.dispose()
  const poolStatsAfter = getHazardPoolStats()

  assert(dustDisposed === true, 'Instance-owned dustMat disposed on grate cleanup')
  assert(disposeGrate.isDisposed === true && disposeGrate.getMesh() === null, 'Grate agent disposed and mesh nulled')
  assert(
    mesh.userData.dustMat === null &&
      mesh.userData.leftLeafGroup === null &&
      mesh.userData.debrisMeshes === null,
    'Grate userData references cleanly nulled'
  )
  assert(
    poolStatsAfter.geometries === poolStatsBefore.geometries &&
      poolStatsAfter.materials === poolStatsBefore.materials,
    'Shared hazard pools preserved after grate disposal'
  )
}
console.log('✓ Collapsing floor grate instance-owned disposal and shared pool preservation verified')

// 23. Wall Collapse — Deterministic Wall Attachment, Interior Preference & Bounded Geometry
console.log('Test 23: Wall Collapse Deterministic Placement, Wall Attachment & Bounded Structure')
{
  const seeds = [771234, 314159, 445566, 998877]
  for (const seed of seeds) {
    const m1 = generateMaze({ seed })
    const m2 = generateMaze({ seed })
    const h1 = placeHazards(m1)
    const h2 = placeHazards(m2)

    const wc1 = h1.filter((h) => h.type === HAZARD_TYPES.WALL_COLLAPSE)
    const wc2 = h2.filter((h) => h.type === HAZARD_TYPES.WALL_COLLAPSE)
    assert(wc1.length >= 1, `Seed ${seed} places at least one wall_collapse hazard`)
    assert(
      JSON.stringify(wc1) === JSON.stringify(wc2),
      `Seed ${seed} wall_collapse placement is deterministic`
    )

    const startKey = `${m1.start.row},${m1.start.col}`
    const exitKey = `${m1.exit.row},${m1.exit.col}`
    for (const w of wc1) {
      const key = `${w.row},${w.col}`
      assert(m1.grid[w.row][w.col] === CELL_TYPES.PATH, `Wall collapse (${key}) must sit on reachable PATH cell`)
      assert(key !== startKey && key !== exitKey, 'Wall collapse must not overlap start or exit')
      assert(
        Math.abs(w.row - m1.start.row) + Math.abs(w.col - m1.start.col) >= 3,
        'Wall collapse respects spawn safety clearance'
      )
      assert(
        ['north', 'south', 'east', 'west'].includes(w.wallSide),
        `Wall collapse has valid wallSide (got ${w.wallSide})`
      )
      assert(
        m1.grid[w.wallRow]?.[w.wallCol] === CELL_TYPES.WALL,
        `Wall collapse attached cell (${w.wallRow},${w.wallCol}) must be an actual CELL_TYPES.WALL`
      )
      assert(
        w.collapseDir &&
          Math.abs(Math.hypot(w.collapseDir.x, w.collapseDir.z) - 1) < 1e-6,
        'Wall collapse defines unit collapseDir into walkable corridor'
      )
      // Verify mount points from attached wall into the walkable cell
      const expectedRow = w.wallRow + w.collapseDir.z
      const expectedCol = w.wallCol + w.collapseDir.x
      assert(
        expectedRow === w.row && expectedCol === w.col,
        `collapseDir points from wall (${w.wallRow},${w.wallCol}) into corridor (${w.row},${w.col})`
      )

      const agent = new HazardAgent(w, m1)
      const data = agent.getMesh().userData
      assert(data.wallMountGroup && data.cavityMesh && data.rebarGroup, 'Wall collapse builds flush recessed cavity and exposed rebar')
      assert(data.slabMeshes.length === 4, `Wall collapse builds 4 fractured masonry slabs (got ${data.slabMeshes.length})`)
      assert(data.crackGroup && data.crackGroup.children.length >= 4, 'Wall collapse includes visible structural crack network')
      assert(data.warningChunks.length <= 6 && data.warningChunks.length >= 4, `Bounded warning chips (got ${data.warningChunks.length})`)
      assert(data.wallRubbleMeshes.length <= 8 && data.wallRubbleMeshes.length >= 4, `Bounded rubble chunks (got ${data.wallRubbleMeshes.length})`)
      assert(data.wallDustMeshes.length <= 6 && data.wallDustMeshes.length >= 4, `Bounded dust puffs (got ${data.wallDustMeshes.length})`)
      // Check rubble apron remains controlled within ~1.06m of the wall face (leaving ~2.9m corridor open)
      for (const rc of data.wallRubbleConfigs) {
        const distFromWallFace = rc.endZ - (-CELL_SIZE / 2)
        assert(
          distFromWallFace >= 0.2 && distFromWallFace <= 1.2,
          `Rubble settles in controlled apron near wall face (got ${distFromWallFace.toFixed(2)}m)`
        )
      }
      agent.dispose()
    }
  }

  // Interior-wall preference: cell (1, 2) in testMaze borders outer north wall (0, 2) AND interior south wall (2, 2)
  const preferredMount = resolveWallCollapseMount(testMaze.grid, 1, 2, null)
  assert(preferredMount !== null, 'resolveWallCollapseMount resolves wall mount for cell bordering both outer and interior walls')
  assert(
    preferredMount.wallSide === 'south' && preferredMount.isBoundaryWall === false,
    `Prefers interior wall over outer boundary wall (got side=${preferredMount.wallSide}, boundary=${preferredMount.isBoundaryWall})`
  )
}
console.log('✓ Wall collapse deterministic placement, interior-wall preference, and bounded geometry verified')

// 24. Wall Collapse — Proximity Trigger, Warning Cracks/Vibration, Escape, World-Space Impact, Permanent Broken State & Reset
console.log('Test 24: Wall Collapse Lifecycle, Escape Window, World-Space Impact & Reset')
{
  const wallCell = { row: 1, col: 2 } // interior south wall at (2, 2), collapseDir = (0, -1)
  const wallCfg = HAZARD_CONFIG[HAZARD_TYPES.WALL_COLLAPSE]
  assert(wallCfg.warningDuration >= 1.2 && wallCfg.damage === 35, 'Wall collapse has fair reaction window and configured damage')

  const wallAgent = new HazardAgent(
    { id: 'wall-collapse-test', type: HAZARD_TYPES.WALL_COLLAPSE, ...wallCell },
    testMaze
  )
  const wData = wallAgent.getMesh().userData
  const dangerArea = wallAgent.getDangerArea()
  const cellCenter = gridToWorld(wallCell.row, wallCell.col, testMaze)

  assert(wallAgent.wallSide === 'south' && wallAgent.isBoundaryWall === false, 'Agent attaches to interior south wall')
  assert(
    Math.hypot(dangerArea.center.x - cellCenter.x, dangerArea.center.z - cellCenter.z) > 0.8,
    'Danger area center is offset toward the collapsing wall face rather than generic cell center'
  )

  const nearWallPos = { x: dangerArea.center.x, y: 0, z: dangerArea.center.z }
  const inDangerCtx = { playerWorldPos: nearWallPos, playerGridCell: wallCell }
  // Opposite side of the SAME 4m corridor cell — outside world-space dangerRadius (1.15m)
  const sameCellSafePos = {
    x: cellCenter.x,
    y: 0,
    z: cellCenter.z + wallAgent.collapseDir.z * 1.45,
  }
  const sameCellSafeDist = Math.hypot(
    sameCellSafePos.x - dangerArea.center.x,
    sameCellSafePos.z - dangerArea.center.z
  )
  assert(
    sameCellSafeDist > dangerArea.radius + 0.5,
    `Safe side of same grid cell is outside dangerRadius (dist=${sameCellSafeDist.toFixed(2)}, r=${dangerArea.radius})`
  )
  const sameCellSafeCtx = { playerWorldPos: sameCellSafePos, playerGridCell: wallCell }
  const farCtx = { playerWorldPos: { x: farWorld.x, y: 0, z: farWorld.z }, playerGridCell: { row: 3, col: 1 } }

  // Stays DORMANT when player is far away
  for (let i = 0; i < 20; i += 1) {
    assert(wallAgent.update(0.1, farCtx) === null, 'Dormant wall deals no damage')
    assert(wallAgent.getState() === HAZARD_STATES.DORMANT, 'Wall remains DORMANT until player approaches')
  }
  assert(wData.warningGroup.visible === false && wData.wallRubbleGroup.visible === false, 'No premature debris while dormant')

  // Player approaches within triggerRadius -> enters WARNING
  assert(wallAgent.update(0.05, inDangerCtx) === null, 'Warning start deals no damage')
  assert(wallAgent.getState() === HAZARD_STATES.WARNING, 'Approaching unstable wall triggers WARNING')

  // Mid-warning: cracks widen, wall slabs vibrate/bulge, early masonry chips & dust appear, 0 damage
  assert(wallAgent.update(wallCfg.warningDuration * 0.6, inDangerCtx) === null, 'No premature damage during warning')
  assert(wallAgent.getState() === HAZARD_STATES.WARNING, 'Remains in WARNING during reaction window')
  assert(wData.crackGroup.scale.x > 1.05 && wData.crackGroup.scale.y > 1.05, 'Structural cracks widen during warning')
  assert(wData.warningGroup.visible === true, 'Loose warning masonry chips fall during warning')
  assert(wData.wallDustGroup.visible === true && wData.dustMat.opacity > 0, 'Early warning dust visible')
  const slabBulged = wData.slabMeshes.some((s, idx) => s.position.z > wData.slabConfigs[idx].restZ + 0.005)
  assert(slabBulged, 'Damaged wall slabs visibly bulge/vibrate outward during warning')

  // Case A: Player escapes to the safe side of the SAME corridor cell before collapse -> 0 damage
  const escapeHit = wallAgent.update(wallCfg.warningDuration * 0.45, sameCellSafeCtx)
  assert(wallAgent.getState() === HAZARD_STATES.ACTIVE, 'Wall transitions to ACTIVE collapse')
  assert(escapeHit === null, 'Escaping outside world-space dangerRadius prevents damage even on same grid cell')

  // Mid-collapse: slabs tumble outward, rubble scatters, dust billows
  assert(wallAgent.update(wallCfg.activeDuration * 0.5, sameCellSafeCtx) === null, 'Safe player takes no damage during collapse')
  assert(wData.wallRubbleGroup.visible === true, 'Collapse rubble chunks visible during active collapse')
  assert(wData.wallDustGroup.visible === true && wData.dustMat.opacity > 0.1, 'Dust cloud billows during collapse')
  assert(wData.slabMeshes[0].position.z > wData.slabConfigs[0].restZ + 0.15, 'Masonry slabs fall outward along collapse direction')

  // Finish collapse -> permanent DISABLED broken wall state
  wallAgent.update(wallCfg.activeDuration * 0.6, sameCellSafeCtx)
  assert(wallAgent.getState() === HAZARD_STATES.DISABLED, 'Wall transitions permanently to DISABLED broken state')
  assert(wallAgent.isDisabled === true && wallAgent.isPermanentlyCollapsed === true, 'Permanent collapse flags set')
  assert(wData.wallRubbleGroup.visible === true && wData.rebarGroup.visible === true, 'Settled rubble and broken cavity/rebar remain visible')
  assert(wData.wallDustGroup.visible === false && wData.dustMat.opacity === 0 && wData.warningGroup.visible === false, 'Temporary dust and warning chips cleaned up')

  // Standing directly in collapsed rubble never triggers or damages again
  assert(wallAgent.update(0.5, inDangerCtx) === null, 'Permanently collapsed wall never deals repeated damage')
  assert(wallAgent.getState() === HAZARD_STATES.DISABLED, 'Collapsed wall stays permanently DISABLED')

  // Reset restores intact wall cleanly with zero duplicate meshes
  const rootChildrenBefore = wallAgent.getMesh().children.length
  const mountChildrenBefore = wData.wallMountGroup.children.length
  wallAgent.resetState()
  assert(wallAgent.getState() === HAZARD_STATES.DORMANT, 'resetState restores DORMANT')
  assert(wallAgent.isDisabled === false && wallAgent.isPermanentlyCollapsed === false, 'resetState clears permanent collapse flags')
  assert(
    Math.abs(wData.slabMeshes[0].position.z - wData.slabConfigs[0].restZ) < 1e-6 &&
      Math.abs(wData.slabMeshes[0].position.y - wData.slabConfigs[0].restY) < 1e-6,
    'resetState restores wall slabs to intact vertical position'
  )
  assert(wData.wallRubbleGroup.visible === false && wData.wallDustGroup.visible === false, 'resetState hides rubble and dust')
  assert(
    wallAgent.getMesh().children.length === rootChildrenBefore &&
      wData.wallMountGroup.children.length === mountChildrenBefore,
    'resetState creates zero duplicate meshes'
  )
  wallAgent.dispose()

  // Case B: Player remains inside world-space impact area -> exact single-hit damage
  const hitWallAgent = new HazardAgent(
    { id: 'wall-collapse-hit', type: HAZARD_TYPES.WALL_COLLAPSE, ...wallCell },
    testMaze
  )
  hitWallAgent.update(0.05, inDangerCtx)
  assert(hitWallAgent.getState() === HAZARD_STATES.WARNING, 'Hit wall enters WARNING')
  const impactHit = hitWallAgent.update(wallCfg.warningDuration + 0.05, inDangerCtx)
  assert(hitWallAgent.getState() === HAZARD_STATES.ACTIVE, 'Hit wall enters ACTIVE')
  assert(impactHit && impactHit.damage === wallCfg.damage, `Wall collapse deals ${wallCfg.damage} single-hit damage`)
  assert(hitWallAgent.update(0.15, inDangerCtx) === null, 'Wall collapse does not deal duplicate damage in same collapse')
  hitWallAgent.update(wallCfg.activeDuration, inDangerCtx)
  assert(hitWallAgent.getState() === HAZARD_STATES.DISABLED, 'Hit wall transitions permanently to DISABLED')
  assert(hitWallAgent.update(1.0, inDangerCtx) === null, 'Disabled wall never deals damage again')
  hitWallAgent.dispose()
}
console.log('✓ Wall collapse trigger, warning, escape, world-space impact, permanent broken state, and reset verified')

// 25. Wall Collapse — Maze Geometry, Outer Boundary & Navigation Safety After Collapse
console.log('Test 25: Wall Collapse Maze Integrity, Boundary Preservation & Navigation Safety')
{
  const navMaze = generateMaze({ seed: 771234 })
  const gridSnapshot = navMaze.grid.map((row) => row.slice())
  const reachBefore = exploreReachableCells(navMaze.grid, navMaze.start)
  assert(reachBefore.valid === true, 'Baseline maze reachability valid')

  const navHazards = placeHazards(navMaze)
  const wcMeta = navHazards.find((h) => h.type === HAZARD_TYPES.WALL_COLLAPSE)
  assert(Boolean(wcMeta), 'Found wall_collapse placement in generated maze')

  const navWallAgent = new HazardAgent(wcMeta, navMaze)
  const navDanger = navWallAgent.getDangerArea()
  const navCfg = HAZARD_CONFIG[HAZARD_TYPES.WALL_COLLAPSE]
  const triggerCtx = {
    playerWorldPos: { x: navDanger.center.x, y: 0, z: navDanger.center.z },
    playerGridCell: { row: wcMeta.row, col: wcMeta.col },
  }

  // Collapse the wall completely into DISABLED state
  navWallAgent.update(0.05, triggerCtx)
  navWallAgent.update(navCfg.warningDuration + 0.05, triggerCtx)
  navWallAgent.update(navCfg.activeDuration + 0.05, triggerCtx)
  assert(navWallAgent.getState() === HAZARD_STATES.DISABLED, 'Wall collapse completed cleanly')

  // Verify maze.grid is completely unmodified (no broken/missing walls or outer boundary breaches)
  for (let r = 0; r < navMaze.rows; r += 1) {
    for (let c = 0; c < navMaze.cols; c += 1) {
      assert(
        navMaze.grid[r][c] === gridSnapshot[r][c],
        `Maze grid cell (${r},${c}) must remain unmodified after wall collapse`
      )
    }
  }
  for (let r = 0; r < navMaze.rows; r += 1) {
    assert(navMaze.grid[r][0] === CELL_TYPES.WALL && navMaze.grid[r][navMaze.cols - 1] === CELL_TYPES.WALL, 'Left/right outer boundaries stay sealed')
  }
  for (let c = 0; c < navMaze.cols; c += 1) {
    assert(navMaze.grid[0][c] === CELL_TYPES.WALL && navMaze.grid[navMaze.rows - 1][c] === CELL_TYPES.WALL, 'Top/bottom outer boundaries stay sealed')
  }

  // Verify reachability from start to exit is 100% preserved
  const reachAfter = exploreReachableCells(navMaze.grid, navMaze.start)
  assert(
    reachAfter.valid === true &&
      reachAfter.reachableCount === reachBefore.reachableCount &&
      reachAfter.distances.has(`${navMaze.exit.row},${navMaze.exit.col}`),
    'Exit and all reachable cells remain fully navigable after wall collapse'
  )

  // Verify player collision along the open side of the corridor never traps player or penetrates the collapsed wall
  const cellPos = gridToWorld(wcMeta.row, wcMeta.col, navMaze)
  const openSideX = cellPos.x + navWallAgent.collapseDir.x * 0.6
  const openSideZ = cellPos.z + navWallAgent.collapseDir.z * 0.6
  const colCheck = resolveGridCollision(openSideX, openSideZ, navMaze)
  assert(
    Math.hypot(colCheck.x - openSideX, colCheck.z - openSideZ) < 0.05,
    'Open corridor lane past collapsed wall remains freely walkable'
  )
  // Pushing directly into the collapsed wall face must still block the player from entering the solid wall cell
  const wallCenter = gridToWorld(wcMeta.wallRow, wcMeta.wallCol, navMaze)
  const pushRes = moveWithSubsteps(
    cellPos.x,
    cellPos.z,
    (wallCenter.x - cellPos.x) * 0.85,
    (wallCenter.z - cellPos.z) * 0.85,
    navMaze
  )
  assert(pushRes.collided === true, 'Collapsed wall still blocks player from clipping through solid maze wall')

  navWallAgent.dispose()
}
console.log('✓ Wall collapse maze geometry, outer boundary integrity, and corridor navigation safety verified')

// 26. Wall Collapse — Engine Damage, Invulnerability, Game-Over, Spatial Audio & Muted Subtitles
console.log('Test 26: Wall Collapse Engine Damage Pipeline, Spatial Audio & Subtitles')
{
  const wallEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 1.2,
    enemies: { autoSpawn: false },
  })
  const damageEvents = []
  wallEngine._onPlayerDamage = (ev) => damageEvents.push(ev)
  wallEngine.setMaze(testMaze)
  wallEngine.clearHazards()

  const engWall = new HazardAgent(
    { id: 'engine-wall-1', type: HAZARD_TYPES.WALL_COLLAPSE, row: 1, col: 2 },
    testMaze
  )
  wallEngine.scene.add(engWall.getMesh())
  wallEngine.hazardManager.hazards.set(engWall.id, engWall)

  const wCenter = engWall.getDangerArea().center
  const onCtx = {
    playerWorldPos: { x: wCenter.x, y: 0, z: wCenter.z },
    playerGridCell: { row: 1, col: 2 },
  }
  const wCfg = HAZARD_CONFIG[HAZARD_TYPES.WALL_COLLAPSE]

  wallEngine.hazardManager.update(0.05, onCtx)
  const mgrRes = wallEngine.hazardManager.update(wCfg.warningDuration + 0.05, onCtx)
  assert(mgrRes.hazardHits.length === 1, 'HazardManager reports wall_collapse impact hit')
  const applied = wallEngine.applyDamage(mgrRes.hazardHits[0].damage, {
    hazardId: mgrRes.hazardHits[0].hazardId,
    hazardType: mgrRes.hazardHits[0].type,
  })
  assert(applied === true, 'MazeSceneEngine applies wall collapse damage')
  assert(wallEngine.health === 65, `HP drops from 100 to 65 (got ${wallEngine.health})`)
  assert(wallEngine.damageImmunityTimer > 0, 'Invulnerability activated after wall collapse damage')
  assert(
    damageEvents[damageEvents.length - 1].hazardType === HAZARD_TYPES.WALL_COLLAPSE,
    'Damage event records wall_collapse'
  )
  assert(wallEngine.applyDamage(20, { enemyId: 'stalker-w' }) === false, 'Invulnerability blocks follow-up damage')

  wallEngine.damageImmunityTimer = 0
  wallEngine.applyDamage(65, { hazardId: 'engine-wall-1', hazardType: HAZARD_TYPES.WALL_COLLAPSE })
  assert(wallEngine.health === 0 && wallEngine.isGameOver === true, 'Lethal wall collapse triggers game over')

  engWall.update(wCfg.activeDuration, onCtx)
  assert(engWall.getState() === HAZARD_STATES.DISABLED, 'Wall disabled before resetCombat')
  wallEngine.resetCombat()
  assert(wallEngine.health === 100 && wallEngine.isGameOver === false, 'resetCombat restores HP and clears game over')
  assert(engWall.getState() === HAZARD_STATES.DORMANT, 'resetCombat restores wall collapse to intact DORMANT state')
  wallEngine.dispose()

  // Spatial audio & muted/zero-volume subtitle checks
  const audioEngine = new HorrorAudioEngine({
    volumes: { master: 0, effects: 0, ambience: 0, music: 0, muted: true },
    debugHistory: true,
  })
  audioEngine._debugHistoryEnabled = true
  audioEngine.setMaze(testMaze)
  audioEngine.setAudioOptions({ subtitles: true })

  const subtitles = []
  const unsub = audioEngine.subscribeSubtitles((entry) => subtitles.push(entry))

  const wallAudioAgent = new HazardAgent(
    { id: 'audio-wall-1', type: HAZARD_TYPES.WALL_COLLAPSE, row: 1, col: 2 },
    testMaze
  )
  const wPos = wallAudioAgent.worldPos
  assert(wPos && Number.isFinite(wPos.x) && Number.isFinite(wPos.z), 'Wall collapse exposes valid worldPos for spatial audio')

  const audioCtx = {
    playerWorldPos: { x: wPos.x, y: 0, z: wPos.z },
    hazards: [wallAudioAgent],
  }

  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 0, 'No subtitle while wall is dormant')

  wallAudioAgent.update(0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(wallAudioAgent.getState() === HAZARD_STATES.WARNING, 'Wall enters WARNING')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 1, `Warning subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[0].text === 'Structural wall cracking and groaning',
    `Expected warning subtitle, got "${subtitles[0].text}"`
  )

  wallAudioAgent.update(wCfg.warningDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(wallAudioAgent.getState() === HAZARD_STATES.ACTIVE, 'Wall enters ACTIVE')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, `Active subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[1].text === 'Wall collapsing with falling rubble',
    `Expected active subtitle, got "${subtitles[1].text}"`
  )

  wallAudioAgent.update(wCfg.activeDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 2 } })
  assert(wallAudioAgent.getState() === HAZARD_STATES.DISABLED, 'Wall enters DISABLED')
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, 'Disabled state emits no duplicate or extra subtitle')

  const cueTypes = audioEngine.getCueHistory().map((c) => c.type)
  assert(cueTypes.includes('hazard_wall_collapse_warning'), 'Warning spatial audio cue recorded')
  assert(cueTypes.includes('hazard_wall_collapse_active'), 'Active spatial audio cue recorded')

  // Verify WebAudio synthesis executes cleanly for wall_collapse warning and active cues
  let oscCount = 0
  let noiseCount = 0
  const makeParam = () => ({
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  })
  const mockCtx = {
    currentTime: 2.0,
    createOscillator: () => {
      oscCount += 1
      return {
        type: 'sawtooth',
        frequency: makeParam(),
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createBufferSource: () => {
      noiseCount += 1
      return {
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createGain: () => ({ gain: makeParam(), connect: () => {}, disconnect: () => {} }),
    createBiquadFilter: () => ({
      type: 'bandpass',
      frequency: makeParam(),
      Q: makeParam(),
      connect: () => {},
      disconnect: () => {},
    }),
  }
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.WALL_COLLAPSE, 'warning')
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.WALL_COLLAPSE, 'active')
  assert(oscCount >= 3 && noiseCount >= 3, `Wall collapse audio synthesis triggers groan/crack + rumble/rubble layers (osc=${oscCount}, noise=${noiseCount})`)

  unsub()
  wallAudioAgent.dispose()
  audioEngine.dispose()
}
console.log('✓ Wall collapse engine damage, invulnerability, game-over, spatial audio, and muted subtitles verified')

// 27. Wall Collapse — Resource Disposal, Shared Pool Integrity & Maze Replacement Cleanup
console.log('Test 27: Wall Collapse Disposal, Shared Pool Preservation & Maze Replacement Cleanup')
{
  const disposeWall = new HazardAgent(
    { id: 'wall-dispose-check', type: HAZARD_TYPES.WALL_COLLAPSE, row: 1, col: 2 },
    testMaze
  )
  const mesh = disposeWall.getMesh()
  const { dustMat } = mesh.userData
  let dustDisposed = false
  const origDispose = dustMat.dispose.bind(dustMat)
  dustMat.dispose = () => {
    dustDisposed = true
    origDispose()
  }

  const poolStatsBefore = getHazardPoolStats()
  disposeWall.dispose()
  const poolStatsAfter = getHazardPoolStats()

  assert(dustDisposed === true, 'Instance-owned dustMat disposed on wall collapse cleanup')
  assert(disposeWall.isDisposed === true && disposeWall.getMesh() === null && disposeWall.collapseDir === null, 'Wall agent disposed and references nulled')
  assert(
    mesh.userData.dustMat === null &&
      mesh.userData.wallMountGroup === null &&
      mesh.userData.slabMeshes === null &&
      mesh.userData.wallRubbleMeshes === null &&
      mesh.userData.wallDustMeshes === null,
    'Wall collapse userData references cleanly nulled'
  )
  assert(
    poolStatsAfter.geometries === poolStatsBefore.geometries &&
      poolStatsAfter.materials === poolStatsBefore.materials,
    'Shared hazard pools preserved after wall collapse disposal'
  )

  // HazardManager maze replacement cleanup
  const scene = new THREE.Scene()
  const manager = new HazardManager(scene)
  manager.setMaze(generateMaze({ seed: 771234 }))
  const firstWalls = Array.from(manager.hazards.values()).filter((a) => a.type === HAZARD_TYPES.WALL_COLLAPSE)
  assert(firstWalls.length >= 1, 'HazardManager spawns wall_collapse agent for first maze')
  manager.setMaze(generateMaze({ seed: 314159 }))
  assert(firstWalls.every((a) => a.isDisposed === true), 'Previous maze wall_collapse agents disposed on setMaze replacement')
  const secondWalls = Array.from(manager.hazards.values()).filter((a) => a.type === HAZARD_TYPES.WALL_COLLAPSE)
  assert(secondWalls.length >= 1, 'HazardManager spawns new wall_collapse agent for replacement maze')
  manager.dispose()
  assert(secondWalls.every((a) => a.isDisposed === true) && scene.children.length === 0, 'Manager dispose cleans up all wall_collapse meshes')
}
console.log('✓ Wall collapse disposal, shared pool preservation, and maze replacement cleanup verified')

// 28. Falling Water Tank — Deterministic Placement, Overhead Structural Support & Bounded Geometry
console.log('Test 28: Falling Water Tank Deterministic Placement, Structural Support & Bounded Geometry')
{
  const seeds = [771234, 314159, 445566, 998877]
  for (const seed of seeds) {
    const m1 = generateMaze({ seed })
    const m2 = generateMaze({ seed })
    const h1 = placeHazards(m1)
    const h2 = placeHazards(m2)

    const wt1 = h1.filter((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK)
    const wt2 = h2.filter((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK)
    assert(wt1.length >= 1, `Seed ${seed} places at least one falling_water_tank hazard`)
    assert(
      JSON.stringify(wt1) === JSON.stringify(wt2),
      `Seed ${seed} falling_water_tank placement is deterministic`
    )

    const startKey = `${m1.start.row},${m1.start.col}`
    const exitKey = `${m1.exit.row},${m1.exit.col}`
    for (const t of wt1) {
      const key = `${t.row},${t.col}`
      assert(m1.grid[t.row][t.col] === CELL_TYPES.PATH, `Water tank (${key}) must sit above reachable PATH cell`)
      assert(key !== startKey && key !== exitKey, 'Water tank must not overlap start or exit')
      assert(
        Math.abs(t.row - m1.start.row) + Math.abs(t.col - m1.start.col) >= 3,
        'Water tank respects spawn safety clearance'
      )
      assert(
        t.mountType === 'ceiling_suspended' || t.mountType === 'ceiling_wall_brace',
        `Water tank uses structural overhead mount (got ${t.mountType})`
      )
      assert(
        t.flowDir && Math.abs(Math.hypot(t.flowDir.x, t.flowDir.z) - 1) < 1e-6,
        'Water tank defines unit directional surge flowDir'
      )
      assert(
        t.surgeLength > 1.2 && t.surgeLength <= 2.75 && t.surgeHalfWidth > 0.8 && t.surgeHalfWidth <= 1.2,
        `Water surge area is bounded (len=${t.surgeLength}, halfW=${t.surgeHalfWidth})`
      )
      // Verify directional surge aims into an open walkable corridor cell when available
      const aheadRow = t.row + t.flowDir.z
      const aheadCol = t.col + t.flowDir.x
      assert(
        m1.grid[aheadRow]?.[aheadCol] === CELL_TYPES.PATH,
        `Water surge flowDir points into open walkable corridor (${aheadRow},${aheadCol})`
      )
      if (t.mountType === 'ceiling_wall_brace') {
        assert(
          m1.grid[t.wallRow]?.[t.wallCol] === CELL_TYPES.WALL,
          `Wall-braced water tank attaches brace to real wall (${t.wallRow},${t.wallCol})`
        )
      }

      const agent = new HazardAgent(t, m1)
      const data = agent.getMesh().userData
      assert(data.supportGroup && data.tankGroup && data.seamMesh, 'Water tank builds overhead support rig and composite deteriorated tank body')
      assert(data.ceilingAnchorY >= 3.5 && data.tankRestY > 2.2, 'Tank is suspended cleanly beneath ceiling deck, not floating on floor')
      assert(data.brokenStraps.length === 2, 'Dual ceiling hanger straps built')
      assert(data.leakDrops.length <= 6 && data.leakStreams.length <= 2, 'Bounded leak droplets and streams')
      assert(data.tankDebrisMeshes.length <= 4, 'Bounded tank fall debris')
      assert(data.sprayMeshes.length <= 8, 'Bounded water surge spray particles')
      assert(data.surgeSheetMesh && data.crestMesh && data.puddleMesh, 'Directional surge sheet, crest, and permanent wet puddle built')
      agent.dispose()
    }
  }

  // Verify wall-backed preference in testMaze corner (1, 1): north/west are walls, south/east are open corridors
  const cornerMount = resolveWaterTankMount(testMaze.grid, 1, 1, null)
  assert(
    cornerMount.mountType === 'ceiling_wall_brace' &&
      (cornerMount.flowSide === 'south' || cornerMount.flowSide === 'east'),
    `Corner mount braces against wall and aims surge down open corridor (got mount=${cornerMount.mountType}, flow=${cornerMount.flowSide})`
  )
}
console.log('✓ Falling water tank deterministic placement, overhead support, and bounded geometry verified')

// 29. Falling Water Tank — Warning Leaks/Vibration, Escape, Directional World-Space Surge, Permanent Rupture & Reset
console.log('Test 29: Falling Water Tank Warning, Escape, Directional Surge Collision, Permanent State & Reset')
{
  // Cell (1, 1) in testMaze: north wall (0,1), west wall (1,0), open south (2,1) & east (1,2)
  const tankCell = { row: 1, col: 1 }
  const tankCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_WATER_TANK]
  assert(tankCfg.warningDuration >= 1.2 && tankCfg.damage === 30, 'Water tank has fair reaction window and configured damage')

  const tankAgent = new HazardAgent(
    { id: 'water-tank-test', type: HAZARD_TYPES.FALLING_WATER_TANK, ...tankCell, flowSide: 'south' },
    testMaze
  )
  const tData = tankAgent.getMesh().userData
  const dangerArea = tankAgent.getDangerArea()
  const cellCenter = gridToWorld(tankCell.row, tankCell.col, testMaze)

  assert(tankAgent.flowSide === 'south' && tankAgent.flowDir.z === 1 && tankAgent.flowDir.x === 0, 'Flow direction aims south (+Z)')
  assert(tankAgent.mountType === 'ceiling_wall_brace' && tData.wallBraceGroup !== null, 'Wall-braced support active against north wall')

  const underTankCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z },
    playerGridCell: tankCell,
  }
  // Safe position perpendicular to surge flow (x offset 1.5m > surgeHalfWidth 1.05m & > dangerRadius 1.15m)
  const sideSafeCtx = {
    playerWorldPos: { x: cellCenter.x + 1.55, y: 0, z: cellCenter.z + 0.8 },
    playerGridCell: tankCell,
  }
  // Safe position behind tank opposite to surge direction (z offset -1.5m < -0.58 & > dangerRadius 1.15m)
  const behindSafeCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z - 1.5 },
    playerGridCell: tankCell,
  }
  // Safe position downstream BEYOND bounded surgeLength (2.55m -> test at +3.1m)
  const beyondSurgeSafeCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z + 3.1 },
    playerGridCell: { row: 2, col: 1 },
  }
  const farCtx = {
    playerWorldPos: { x: farWorld.x, y: 0, z: farWorld.z },
    playerGridCell: { row: 3, col: 1 },
  }

  // Dormant checks: stays dormant while player is far away, shows faint leak trickle only
  for (let i = 0; i < 15; i += 1) {
    assert(tankAgent.update(0.1, farCtx) === null, 'Dormant water tank deals no damage')
    assert(tankAgent.getState() === HAZARD_STATES.DORMANT, 'Tank stays DORMANT until player approaches')
  }
  assert(tData.surgeGroup.visible === false && tData.tankDebrisGroup.visible === false, 'No surge or debris while dormant')
  assert(Math.abs(tData.tankGroup.position.y - tData.tankRestY) < 1e-6, 'Dormant tank stays suspended overhead')

  // Player approaches -> WARNING
  assert(tankAgent.update(0.05, underTankCtx) === null, 'Warning start deals no damage')
  assert(tankAgent.getState() === HAZARD_STATES.WARNING, 'Approaching unstable water tank triggers WARNING')

  // Mid-warning: vibration/sway, accelerating leaks, visible streams, pre-collapse warning puddle, 0 damage
  assert(tankAgent.update(tankCfg.warningDuration * 0.6, underTankCtx) === null, 'No premature damage during warning')
  assert(tankAgent.getState() === HAZARD_STATES.WARNING, 'Remains in WARNING during reaction window')
  assert(
    Math.abs(tData.tankGroup.rotation.z) > 0.001 || Math.abs(tData.tankGroup.position.y - tData.tankRestY) > 0.01,
    'Tank visibly vibrates/strains during warning'
  )
  assert(tData.leakGroup.visible === true && tData.leakMat.opacity > 0.5, 'Leaking drips intensify during warning')
  assert(tData.leakStreams.some((s) => s.visible), 'Visible water leak streams pour during warning')
  assert(tData.puddleMesh.visible === true && tData.puddleMat.opacity > 0.1, 'Warning puddle forms beneath leaking tank')

  // Case A: Player escapes perpendicular/behind before activation -> 0 damage & 0 slowdown
  const escapeHit = tankAgent.update(tankCfg.warningDuration * 0.45, sideSafeCtx)
  assert(tankAgent.getState() === HAZARD_STATES.ACTIVE, 'Tank transitions to ACTIVE rupture')
  assert(escapeHit === null && tankAgent.lastMovementEffect === null, 'Escaping outside danger area prevents damage and slowdown')

  // Mid-active: tank has fallen, surge sheet & crest advancing along +Z, player outside surge stays safe
  assert(tankAgent.update(tankCfg.activeDuration * 0.5, behindSafeCtx) === null, 'Player behind tank avoids directional surge')
  assert(tankAgent.lastMovementEffect === null, 'Player behind tank receives no slowdown')
  assert(tData.tankGroup.position.y < tData.tankRestY - 1.2, 'Tank drops rapidly during active rupture')
  assert(tData.surgeGroup.visible === true && tData.surgeMat.opacity > 0.1, 'Directional water surge visible during active phase')
  assert(tData.crestMesh.position.z > 0.8, `Surge wave crest advances along flowDir (+Z, got ${tData.crestMesh.position.z.toFixed(2)})`)
  assert(tData.tankDebrisGroup.visible === true, 'Broken hanger debris scatters during tank drop')

  // Beyond surgeLength stays safe even directly in front of flowDir
  assert(tankAgent.update(tankCfg.activeDuration * 0.25, beyondSurgeSafeCtx) === null, 'Player beyond bounded surgeLength takes no damage')
  assert(tankAgent.lastMovementEffect === null, 'Player beyond bounded surgeLength receives no slowdown')

  // Finish active -> permanent DISABLED ruptured tank + wet puddle
  tankAgent.update(tankCfg.activeDuration * 0.35, sideSafeCtx)
  assert(tankAgent.getState() === HAZARD_STATES.DISABLED, 'Water tank transitions permanently to DISABLED state')
  assert(tankAgent.isDisabled === true && tankAgent.isPermanentlyCollapsed === true, 'Permanent collapse flags set')
  assert(Math.abs(tData.tankGroup.position.y - tData.tankFallenY) < 1e-4, 'Fallen ruptured tank rests permanently on floor')
  assert(tData.puddleMesh.visible === true && tData.puddleMat.opacity > 0.4, 'Permanent wet floor area remains visible')
  assert(tData.surgeGroup.visible === false && tData.surgeMat.opacity === 0 && tData.leakGroup.visible === false, 'Temporary surge and warning leaks cleaned up')

  // Standing in permanent puddle never damages or slows again
  assert(tankAgent.update(0.5, underTankCtx) === null && tankAgent.lastMovementEffect === null, 'Permanently collapsed tank never repeats damage or traps player')
  assert(tankAgent.getState() === HAZARD_STATES.DISABLED, 'Collapsed tank stays permanently DISABLED')

  // Reset restores suspended intact tank with zero duplicate meshes
  const rootCountBefore = tankAgent.getMesh().children.length
  const mountCountBefore = tData.tankMountGroup.children.length
  tankAgent.resetState()
  assert(tankAgent.getState() === HAZARD_STATES.DORMANT, 'resetState restores DORMANT')
  assert(tankAgent.isDisabled === false && tankAgent.isPermanentlyCollapsed === false, 'resetState clears permanent flags')
  assert(Math.abs(tData.tankGroup.position.y - tData.tankRestY) < 1e-6, 'resetState lifts tank back to suspended ceiling mount')
  assert(tData.puddleMesh.visible === false && tData.surgeGroup.visible === false && tData.tankDebrisGroup.visible === false, 'resetState clears temporary flood and debris')
  assert(
    tankAgent.getMesh().children.length === rootCountBefore &&
      tData.tankMountGroup.children.length === mountCountBefore,
    'resetState creates zero duplicate meshes'
  )
  tankAgent.dispose()

  // Case B: Player stays directly under falling tank -> exact single-hit damage
  const dropHitAgent = new HazardAgent(
    { id: 'water-tank-drop-hit', type: HAZARD_TYPES.FALLING_WATER_TANK, ...tankCell, flowSide: 'south' },
    testMaze
  )
  dropHitAgent.update(0.05, underTankCtx)
  const dropHit = dropHitAgent.update(tankCfg.warningDuration + 0.05, underTankCtx)
  assert(dropHitAgent.getState() === HAZARD_STATES.ACTIVE, 'Drop-hit tank enters ACTIVE')
  assert(dropHit && dropHit.damage === tankCfg.damage, `Falling tank deals ${tankCfg.damage} single-hit damage`)
  assert(dropHitAgent.update(0.2, underTankCtx) === null, 'Falling tank does not deal duplicate damage in same rupture')
  dropHitAgent.dispose()

  // Case C: Player stands downstream inside the bounded directional water surge (outside under-tank radius!) -> hit + bounded slowdown
  const surgeHitAgent = new HazardAgent(
    { id: 'water-tank-surge-hit', type: HAZARD_TYPES.FALLING_WATER_TANK, ...tankCell, flowSide: 'south' },
    testMaze
  )
  const downstreamInSurgeCtx = {
    playerWorldPos: { x: cellCenter.x + 0.3, y: 0, z: cellCenter.z + 1.85 },
    playerGridCell: tankCell,
  }
  assert(
    Math.hypot(
      downstreamInSurgeCtx.playerWorldPos.x - dangerArea.center.x,
      downstreamInSurgeCtx.playerWorldPos.z - dangerArea.center.z
    ) > dangerArea.radius + 0.5,
    'Downstream test position is outside tank drop radius but inside directional water surge'
  )
  surgeHitAgent.update(0.05, underTankCtx)
  // Enter active while player is downstream (tank hasn't surged yet at t=0.05 -> no hit yet)
  const preSurgeHit = surgeHitAgent.update(tankCfg.warningDuration + 0.05, downstreamInSurgeCtx)
  assert(preSurgeHit === null, 'Player downstream is not hit before surge wave arrives')
  // Advance into surge sweep -> wave reaches localZ = 1.85 -> single-hit damage + bounded slowdown!
  const surgeHit = surgeHitAgent.update(tankCfg.activeDuration * 0.55, downstreamInSurgeCtx)
  assert(surgeHit && surgeHit.damage === tankCfg.damage, 'Directional water surge damages player inside visible wave envelope')
  assert(
    surgeHitAgent.lastMovementEffect &&
      surgeHitAgent.lastMovementEffect.speedMultiplier === tankCfg.surgeSpeedMultiplier &&
      surgeHitAgent.lastMovementEffect.duration === tankCfg.surgeSlowdownDuration,
    'Active water surge emits bounded movement slowdown effect'
  )
  surgeHitAgent.dispose()
}
console.log('✓ Falling water tank warning, escape, directional surge collision, slowdown emission, permanent state, and reset verified')

// 30. Falling Water Tank — Engine Damage, Bounded Slowdown Restoration, Invulnerability & Maze Navigation Safety
console.log('Test 30: Falling Water Tank Engine Damage, Bounded Slowdown Restoration & Navigation Safety')
{
  const tankEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 1.2,
    enemies: { autoSpawn: false },
  })
  const damageEvents = []
  tankEngine._onPlayerDamage = (ev) => damageEvents.push(ev)
  tankEngine.setMaze(testMaze)
  tankEngine.clearHazards()

  const engTank = new HazardAgent(
    { id: 'engine-tank-1', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 1, col: 1, flowSide: 'south' },
    testMaze
  )
  tankEngine.scene.add(engTank.getMesh())
  tankEngine.hazardManager.hazards.set(engTank.id, engTank)

  const tCenter = engTank.getDangerArea().center
  const onCtx = {
    playerWorldPos: { x: tCenter.x, y: 0, z: tCenter.z },
    playerGridCell: { row: 1, col: 1 },
  }
  const tCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_WATER_TANK]

  // Trigger warning -> advance into active surge
  tankEngine.hazardManager.update(0.05, onCtx)
  const mgrRes1 = tankEngine.hazardManager.update(tCfg.warningDuration + 0.05, onCtx)
  assert(mgrRes1.hazardHits.length === 1, 'HazardManager reports falling_water_tank hit')
  const applied = tankEngine.applyDamage(mgrRes1.hazardHits[0].damage, {
    hazardId: mgrRes1.hazardHits[0].hazardId,
    hazardType: mgrRes1.hazardHits[0].type,
  })
  assert(applied === true && tankEngine.health === 70, `HP drops from 100 to 70 (got ${tankEngine.health})`)
  assert(tankEngine.damageImmunityTimer > 0, 'Invulnerability activated after tank damage')
  assert(damageEvents[damageEvents.length - 1].hazardType === HAZARD_TYPES.FALLING_WATER_TANK, 'Damage event records falling_water_tank')
  assert(tankEngine.applyDamage(20, { enemyId: 'stalker-t' }) === false, 'Invulnerability blocks follow-up attack')

  // Advance into water surge to trigger bounded slowdown via HazardManager -> MazeSceneEngine
  const mgrRes2 = tankEngine.hazardManager.update(tCfg.activeDuration * 0.45, onCtx)
  assert(mgrRes2.movementEffects && mgrRes2.movementEffects.speedMultiplier < 1, 'HazardManager surfaces bounded water surge slowdown')
  tankEngine.applyHazardSlowdown(mgrRes2.movementEffects.speedMultiplier, mgrRes2.movementEffects.duration)
  assert(
    tankEngine.getMovementSpeedMultiplier() === tCfg.surgeSpeedMultiplier,
    `Engine applies bounded slowdown multiplier (${tankEngine.getMovementSpeedMultiplier()})`
  )
  // Extreme values are safely clamped so player can never be trapped
  tankEngine.applyHazardSlowdown(0.0, 999)
  assert(
    tankEngine.getMovementSpeedMultiplier() >= 0.5 && tankEngine._hazardSlowdownTimer <= 2.5,
    'Slowdown multiplier and duration are strictly bounded against trapping'
  )

  // Countdown slowdown timer -> movement speed cleanly restores to 1.0
  tankEngine._playerWorldPos.x = farWorld.x
  tankEngine._playerWorldPos.z = farWorld.z
  tankEngine._hazardSlowdownTimer = 0.2
  tankEngine.stepFrame(0.25)
  assert(tankEngine.getMovementSpeedMultiplier() === 1.0, 'Movement speed cleanly restores to 1.0 after bounded slowdown expires')

  // Lethal hit -> game over -> resetCombat clears slowdown, HP, and restores tank
  tankEngine.applyHazardSlowdown(0.62, 1.8)
  tankEngine.damageImmunityTimer = 0
  tankEngine.applyDamage(70, { hazardId: 'engine-tank-1', hazardType: HAZARD_TYPES.FALLING_WATER_TANK })
  assert(tankEngine.health === 0 && tankEngine.isGameOver === true, 'Lethal water tank hit triggers game over')
  engTank.update(tCfg.activeDuration, onCtx)
  assert(engTank.getState() === HAZARD_STATES.DISABLED, 'Tank disabled before resetCombat')

  tankEngine.resetCombat()
  assert(tankEngine.health === 100 && tankEngine.isGameOver === false, 'resetCombat restores HP and clears game over')
  assert(tankEngine.getMovementSpeedMultiplier() === 1.0 && tankEngine._hazardSlowdownTimer === 0, 'resetCombat clears active water slowdown')
  assert(engTank.getState() === HAZARD_STATES.DORMANT, 'resetCombat restores water tank to suspended DORMANT state')
  tankEngine.dispose()

  // Maze topology, reachability & normal collision safety after collapse
  const navMaze = generateMaze({ seed: 771234 })
  const gridSnapshot = navMaze.grid.map((row) => row.slice())
  const reachBefore = exploreReachableCells(navMaze.grid, navMaze.start)
  const navSpec = placeHazards(navMaze).find((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK)
  assert(Boolean(navSpec), 'Found falling_water_tank placement in generated maze')
  const navAgent = new HazardAgent(navSpec, navMaze)
  const navCenter = navAgent.getDangerArea().center
  const navCtx = { playerWorldPos: navCenter, playerGridCell: { row: navSpec.row, col: navSpec.col } }
  navAgent.update(0.05, navCtx)
  navAgent.update(tCfg.warningDuration + 0.05, navCtx)
  navAgent.update(tCfg.activeDuration + 0.05, navCtx)
  assert(navAgent.getState() === HAZARD_STATES.DISABLED, 'Generated maze tank collapsed cleanly')

  for (let r = 0; r < navMaze.rows; r += 1) {
    for (let c = 0; c < navMaze.cols; c += 1) {
      assert(navMaze.grid[r][c] === gridSnapshot[r][c], `Maze grid (${r},${c}) unmodified by water tank`)
    }
  }
  const reachAfter = exploreReachableCells(navMaze.grid, navMaze.start)
  assert(
    reachAfter.valid === true &&
      reachAfter.reachableCount === reachBefore.reachableCount &&
      reachAfter.distances.has(`${navMaze.exit.row},${navMaze.exit.col}`),
    'Maze reachability from start to exit preserved after water surge'
  )
  const colRes = resolveGridCollision(navCenter.x, navCenter.z, navMaze)
  assert(Math.hypot(colRes.x - navCenter.x, colRes.z - navCenter.z) < 0.05, 'Collapsed tank corridor remains freely walkable')
  navAgent.dispose()
}
console.log('✓ Falling water tank engine damage, bounded slowdown restoration, and maze navigation safety verified')

// 31. Falling Water Tank — Spatial Audio & Subtitles (Muted, Zero Volume, No Duplicates)
console.log('Test 31: Falling Water Tank Spatial Audio & Subtitles (Muted & Zero-Volume Safe)')
{
  const audioEngine = new HorrorAudioEngine({
    volumes: { master: 0, effects: 0, ambience: 0, music: 0, muted: true },
    debugHistory: true,
  })
  audioEngine._debugHistoryEnabled = true
  audioEngine.setMaze(testMaze)
  audioEngine.setAudioOptions({ subtitles: true })

  const subtitles = []
  const unsub = audioEngine.subscribeSubtitles((entry) => subtitles.push(entry))

  const tankAudioAgent = new HazardAgent(
    { id: 'audio-tank-1', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 1, col: 1, flowSide: 'south' },
    testMaze
  )
  const tPos = tankAudioAgent.worldPos
  assert(tPos && Number.isFinite(tPos.x) && Number.isFinite(tPos.z), 'Water tank exposes valid worldPos for spatial audio')

  const audioCtx = {
    playerWorldPos: { x: tPos.x, y: 0, z: tPos.z },
    hazards: [tankAudioAgent],
  }
  const tCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_WATER_TANK]

  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 0, 'No subtitle while water tank is dormant')

  tankAudioAgent.update(0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 1 } })
  assert(tankAudioAgent.getState() === HAZARD_STATES.WARNING, 'Tank enters WARNING')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 1, `Warning subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[0].text === 'Water tank creaking and leaking',
    `Expected warning subtitle, got "${subtitles[0].text}"`
  )

  tankAudioAgent.update(tCfg.warningDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 1 } })
  assert(tankAudioAgent.getState() === HAZARD_STATES.ACTIVE, 'Tank enters ACTIVE')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, `Active subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[1].text === 'Tank rupturing with rushing water',
    `Expected active subtitle, got "${subtitles[1].text}"`
  )

  tankAudioAgent.update(tCfg.activeDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 1, col: 1 } })
  assert(tankAudioAgent.getState() === HAZARD_STATES.DISABLED, 'Tank enters DISABLED')
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, 'Disabled state emits no extra or duplicate subtitle')

  const cueTypes = audioEngine.getCueHistory().map((c) => c.type)
  assert(cueTypes.includes('hazard_falling_water_tank_warning'), 'Warning spatial audio cue recorded')
  assert(cueTypes.includes('hazard_falling_water_tank_active'), 'Active rupture/surge spatial audio cue recorded')

  let oscCount = 0
  let noiseCount = 0
  const makeParam = () => ({
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  })
  const mockCtx = {
    currentTime: 3.0,
    createOscillator: () => {
      oscCount += 1
      return {
        type: 'sawtooth',
        frequency: makeParam(),
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createBufferSource: () => {
      noiseCount += 1
      return {
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createGain: () => ({ gain: makeParam(), connect: () => {}, disconnect: () => {} }),
    createBiquadFilter: () => ({
      type: 'bandpass',
      frequency: makeParam(),
      Q: makeParam(),
      connect: () => {},
      disconnect: () => {},
    }),
  }
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.FALLING_WATER_TANK, 'warning')
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.FALLING_WATER_TANK, 'active')
  assert(oscCount >= 4 && noiseCount >= 3, `Water tank audio synthesis triggers creak/impact + leak/surge layers (osc=${oscCount}, noise=${noiseCount})`)

  unsub()
  tankAudioAgent.dispose()
  audioEngine.dispose()
}
console.log('✓ Falling water tank spatial audio and muted/zero-volume subtitles verified without duplicates')

// 32. Falling Water Tank — Instance Resource Disposal, Shared Pool Integrity & Maze Replacement Cleanup
console.log('Test 32: Falling Water Tank Disposal, Shared Pool Preservation & Maze Replacement Cleanup')
{
  const disposeTank = new HazardAgent(
    { id: 'tank-dispose-check', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 1, col: 1, flowSide: 'south' },
    testMaze
  )
  const mesh = disposeTank.getMesh()
  const { leakMat, surgeMat, puddleMat } = mesh.userData
  let leakDisposed = false
  let surgeDisposed = false
  let puddleDisposed = false
  const origLeak = leakMat.dispose.bind(leakMat)
  const origSurge = surgeMat.dispose.bind(surgeMat)
  const origPuddle = puddleMat.dispose.bind(puddleMat)
  leakMat.dispose = () => {
    leakDisposed = true
    origLeak()
  }
  surgeMat.dispose = () => {
    surgeDisposed = true
    origSurge()
  }
  puddleMat.dispose = () => {
    puddleDisposed = true
    origPuddle()
  }

  const poolStatsBefore = getHazardPoolStats()
  disposeTank.dispose()
  const poolStatsAfter = getHazardPoolStats()

  assert(
    leakDisposed && surgeDisposed && puddleDisposed,
    'All instance-owned water materials (leakMat, surgeMat, puddleMat) disposed on cleanup'
  )
  assert(
    disposeTank.isDisposed === true &&
      disposeTank.getMesh() === null &&
      disposeTank.flowDir === null &&
      disposeTank.lastMovementEffect === null,
    'Tank agent disposed and references cleanly nulled'
  )
  assert(
    mesh.userData.leakMat === null &&
      mesh.userData.surgeMat === null &&
      mesh.userData.puddleMat === null &&
      mesh.userData.tankGroup === null &&
      mesh.userData.surgeGroup === null &&
      mesh.userData.puddleMesh === null,
    'Water tank userData references cleanly nulled'
  )
  assert(
    poolStatsAfter.geometries === poolStatsBefore.geometries &&
      poolStatsAfter.materials === poolStatsBefore.materials,
    'Shared hazard pools preserved after water tank disposal'
  )

  const scene = new THREE.Scene()
  const manager = new HazardManager(scene)
  manager.setMaze(generateMaze({ seed: 771234 }))
  const firstTanks = Array.from(manager.hazards.values()).filter((a) => a.type === HAZARD_TYPES.FALLING_WATER_TANK)
  assert(firstTanks.length >= 1, 'HazardManager spawns falling_water_tank agent for first maze')
  manager.setMaze(generateMaze({ seed: 314159 }))
  assert(firstTanks.every((a) => a.isDisposed === true), 'Previous maze water tank agents disposed on setMaze replacement')
  const secondTanks = Array.from(manager.hazards.values()).filter((a) => a.type === HAZARD_TYPES.FALLING_WATER_TANK)
  assert(secondTanks.length >= 1, 'HazardManager spawns new falling_water_tank agent for replacement maze')
  manager.dispose()
  assert(secondTanks.every((a) => a.isDisposed === true) && scene.children.length === 0, 'Manager dispose cleans up all water tank meshes')
}
console.log('✓ Falling water tank disposal, shared pool preservation, and maze replacement cleanup verified')

// 33. Falling Suspended Machinery — Deterministic Placement, Overhead Gantry Support & Bounded Geometry
console.log('Test 33: Falling Suspended Machinery Deterministic Placement, Gantry Support & Bounded Geometry')
{
  const seeds = [771234, 314159, 445566, 998877]
  for (const seed of seeds) {
    const m1 = generateMaze({ seed })
    const m2 = generateMaze({ seed })
    const h1 = placeHazards(m1)
    const h2 = placeHazards(m2)

    const mach1 = h1.filter((h) => h.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY)
    const mach2 = h2.filter((h) => h.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY)
    assert(mach1.length >= 1, `Seed ${seed} places at least one falling_suspended_machinery hazard`)
    assert(
      JSON.stringify(mach1) === JSON.stringify(mach2),
      `Seed ${seed} falling_suspended_machinery placement is deterministic`
    )

    const startKey = `${m1.start.row},${m1.start.col}`
    const exitKey = `${m1.exit.row},${m1.exit.col}`
    for (const mSpec of mach1) {
      const key = `${mSpec.row},${mSpec.col}`
      assert(m1.grid[mSpec.row][mSpec.col] === CELL_TYPES.PATH, `Machinery (${key}) must sit above reachable PATH cell`)
      assert(key !== startKey && key !== exitKey, 'Machinery must not overlap start or exit')
      assert(
        Math.abs(mSpec.row - m1.start.row) + Math.abs(mSpec.col - m1.start.col) >= 3,
        'Machinery respects spawn safety clearance'
      )
      assert(
        mSpec.mountType === 'wall_to_wall_gantry' || mSpec.mountType === 'ceiling_gantry_rail',
        `Machinery uses structural gantry support (got ${mSpec.mountType})`
      )
      assert(
        mSpec.swingDir && Math.abs(Math.hypot(mSpec.swingDir.x, mSpec.swingDir.z) - 1) < 1e-6,
        'Machinery defines unit swing direction'
      )
      const aheadRow = mSpec.row + mSpec.swingDir.z
      const aheadCol = mSpec.col + mSpec.swingDir.x
      assert(
        m1.grid[aheadRow]?.[aheadCol] === CELL_TYPES.PATH,
        `Machinery swingDir aims into open walkable corridor (${aheadRow},${aheadCol})`
      )
      assert(
        mSpec.ceilingAnchorY >= 3.5 && mSpec.machineryRestY > 2.2,
        `Machinery anchors to overhead structure (anchorY=${mSpec.ceilingAnchorY}, restY=${mSpec.machineryRestY})`
      )

      const agent = new HazardAgent(mSpec, m1)
      const data = agent.getMesh().userData
      assert(
        data.gantryGroup && data.trolleyGroup && data.rearCable && data.frontCable && data.machineBodyGroup,
        'Machinery builds structural gantry rail, hoist trolley, dual hoist cables, and machinery housing'
      )
      if (mSpec.mountType === 'wall_to_wall_gantry') {
        assert(data.wallBracketsGroup !== null, 'Wall-to-wall gantry includes flanking wall corbel brackets')
      }
      assert(data.warnBoltMeshes.length <= 6, `Bounded warning loose bolts (got ${data.warnBoltMeshes.length})`)
      assert(data.impactDebrisMeshes.length <= 6, `Bounded sheared impact fragments (got ${data.impactDebrisMeshes.length})`)
      assert(data.impactDustMeshes.length <= 6, `Bounded impact dust puffs (got ${data.impactDustMeshes.length})`)
      agent.dispose()
    }
  }

  // Verify flanked corridor in testMaze cell (2, 1): walls on west (2,0) & east (2,2), open north (1,1) & south (3,1)
  const flankedMount = resolveSuspendedMachineryMount(testMaze.grid, 2, 1, null)
  assert(
    flankedMount.mountType === 'wall_to_wall_gantry' &&
      (flankedMount.swingSide === 'north' || flankedMount.swingSide === 'south'),
    `Flanked corridor resolves wall_to_wall_gantry along open axis (got mount=${flankedMount.mountType}, swing=${flankedMount.swingSide})`
  )
}
console.log('✓ Falling suspended machinery deterministic placement, overhead gantry support, and bounded geometry verified')

// 34. Falling Suspended Machinery — Warning Sway/Bolts, Escape, World-Space Swing-Drop Impact, Permanent State & Reset
console.log('Test 34: Falling Suspended Machinery Warning, Escape, World-Space Impact Collision, Permanent State & Reset')
{
  // Cell (2, 1) in testMaze: flanked west (2,0) & east (2,2), open north (1,1) & south (3,1)
  const machCell = { row: 2, col: 1 }
  const machCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]
  assert(machCfg.warningDuration >= 1.2 && machCfg.damage === 40, 'Suspended machinery has fair warning window and configured damage')

  const machAgent = new HazardAgent(
    { id: 'machinery-test', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, ...machCell, swingSide: 'south' },
    testMaze
  )
  const mData = machAgent.getMesh().userData
  const dangerArea = machAgent.getDangerArea()
  const cellCenter = gridToWorld(machCell.row, machCell.col, testMaze)

  assert(machAgent.swingSide === 'south' && machAgent.swingDir.z === 1 && machAgent.swingDir.x === 0, 'Swing direction aims south (+Z)')
  assert(machAgent.mountType === 'wall_to_wall_gantry' && mData.wallBracketsGroup !== null, 'Wall-to-wall gantry brackets mounted across corridor walls')
  assert(
    Math.abs(dangerArea.center.z - (cellCenter.z + 0.72)) < 1e-4 && Math.abs(dangerArea.center.x - cellCenter.x) < 1e-4,
    'Impact center offsets 0.72m forward along swingDir matching visual swing-drop landing zone'
  )

  const impactCenterCtx = {
    playerWorldPos: { x: dangerArea.center.x, y: 0, z: dangerArea.center.z },
    playerGridCell: machCell,
  }
  const underOriginCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z },
    playerGridCell: machCell,
  }
  // Safe position BEHIND swing on the SAME grid cell (localZ = -1.15 -> distToOrigin=1.15 > 0.95, distToImpact=1.87 > 1.25)
  const behindSameCellSafeCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z - 1.15 },
    playerGridCell: machCell,
  }
  // Safe position BEYOND swing landing zone (localZ = +2.15 -> distToImpact=1.43 > 1.25, distToOrigin=2.15 > 0.95)
  const beyondSwingSafeCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z + 2.15 },
    playerGridCell: { row: 3, col: 1 },
  }
  const farCtx = {
    playerWorldPos: { x: farWorld.x + 4, y: 0, z: farWorld.z },
    playerGridCell: { row: 3, col: 3 },
  }

  // Dormant checks: stays dormant while player is far away
  for (let i = 0; i < 12; i += 1) {
    assert(machAgent.update(0.1, farCtx) === null, 'Dormant machinery deals no damage')
    assert(machAgent.getState() === HAZARD_STATES.DORMANT, 'Machinery stays DORMANT until player approaches')
  }
  assert(
    mData.warnBoltGroup.visible === false &&
      mData.impactDebrisGroup.visible === false &&
      mData.impactDustGroup.visible === false,
    'No falling bolts, debris, or dust while dormant'
  )
  assert(Math.abs(mData.machineBodyGroup.position.y - mData.restDropY) < 1e-6, 'Dormant machinery stays suspended overhead')

  // Player approaches -> WARNING
  assert(machAgent.update(0.05, impactCenterCtx) === null, 'Entering warning deals no damage')
  assert(machAgent.getState() === HAZARD_STATES.WARNING, 'Approaching unstable machinery triggers WARNING')

  // Mid-warning: progressive sway, vibration, and falling loose bolts with 0 premature damage
  assert(machAgent.update(machCfg.warningDuration * 0.55, impactCenterCtx) === null, 'No premature damage during warning')
  assert(machAgent.getState() === HAZARD_STATES.WARNING, 'Machinery stays in WARNING during reaction window')
  assert(
    Math.abs(mData.machinePivotGroup.rotation.x) > 0.01 || Math.abs(mData.machinePivotGroup.rotation.z) > 0.005,
    'Suspended machinery visibly sways during warning'
  )
  assert(mData.warnBoltGroup.visible === true, 'Loose bolts fall during mechanical strain warning')
  assert(mData.impactDebrisGroup.visible === false && mData.impactDustGroup.visible === false, 'Impact debris/dust wait until fall')

  // Case A: Player escapes behind swing (even on same grid cell) before activation -> 0 damage
  const escapeHit = machAgent.update(machCfg.warningDuration * 0.5, behindSameCellSafeCtx)
  assert(machAgent.getState() === HAZARD_STATES.ACTIVE, 'Machinery transitions to ACTIVE swing-drop')
  assert(escapeHit === null, 'Escaping outside world-space impact area prevents damage (even on same grid cell)')

  // Mid-active: machinery swings forward (+Z) and drops down, cables snap, debris & dust burst, player beyond swing stays safe
  assert(machAgent.update(machCfg.activeDuration * 0.55, beyondSwingSafeCtx) === null, 'Player beyond swing landing radius takes no damage')
  assert(mData.machineBodyGroup.position.y < mData.restDropY - 1.5, 'Machinery drops down toward floor during active release')
  assert(mData.machineBodyGroup.position.z > 0.5, `Machinery swings forward along +Z (got ${mData.machineBodyGroup.position.z.toFixed(2)})`)
  assert(Math.abs(mData.rearCable.rotation.x) > 0.3, 'Snapped rear hoist cable whips upward during release')
  assert(mData.impactDebrisGroup.visible === true, 'Sheared metal fragments scatter on impact')
  assert(mData.impactDustGroup.visible === true && mData.dustMat.opacity > 0.05, 'Impact dust billows on crash')

  // Complete active -> permanent DISABLED collapsed wreckage
  machAgent.update(machCfg.activeDuration * 0.55, behindSameCellSafeCtx)
  assert(machAgent.getState() === HAZARD_STATES.DISABLED, 'Machinery enters permanent DISABLED crashed state')
  assert(machAgent.isDisabled === true && machAgent.isPermanentlyCollapsed === true, 'Permanent collapse flags set')
  const expectedFallenLocalY = mData.fallenY - mData.pivotY
  assert(Math.abs(mData.machineBodyGroup.position.y - expectedFallenLocalY) < 1e-4, 'Crashed machinery rests permanently on floor')
  assert(mData.impactDebrisGroup.visible === true, 'Fallen sheared debris persists as wreckage')
  assert(mData.impactDustGroup.visible === false && mData.dustMat.opacity === 0 && mData.warnBoltGroup.visible === false, 'Temporary dust and warning bolts cleaned up')

  // Collapsed wreckage never deals repeated damage
  assert(machAgent.update(0.5, impactCenterCtx) === null, 'Permanently crashed machinery never repeats damage')
  assert(machAgent.getState() === HAZARD_STATES.DISABLED, 'Collapsed machinery stays DISABLED')

  // Reset restores suspended intact machinery with zero duplicate meshes
  const rootCountBefore = machAgent.getMesh().children.length
  const mountCountBefore = mData.machineryMountGroup.children.length
  machAgent.resetState()
  assert(machAgent.getState() === HAZARD_STATES.DORMANT, 'resetState restores DORMANT')
  assert(machAgent.isDisabled === false && machAgent.isPermanentlyCollapsed === false, 'resetState clears permanent collapse flags')
  assert(Math.abs(mData.machineBodyGroup.position.y - mData.restDropY) < 1e-6, 'resetState lifts machinery back onto overhead hoist')
  assert(mData.impactDebrisGroup.visible === false && mData.impactDustGroup.visible === false && mData.warnBoltGroup.visible === false, 'resetState hides debris, dust, and warning bolts')
  assert(
    machAgent.getMesh().children.length === rootCountBefore &&
      mData.machineryMountGroup.children.length === mountCountBefore,
    'resetState creates zero duplicate meshes'
  )
  machAgent.dispose()

  // Case B: Player stays inside world-space impact center -> exact 40 single-hit damage, no repeat
  const impactHitAgent = new HazardAgent(
    { id: 'machinery-impact-hit', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, ...machCell, swingSide: 'south' },
    testMaze
  )
  impactHitAgent.update(0.05, impactCenterCtx)
  const impactHit = impactHitAgent.update(machCfg.warningDuration + 0.05, impactCenterCtx)
  assert(impactHitAgent.getState() === HAZARD_STATES.ACTIVE, 'Impact-hit machinery enters ACTIVE')
  assert(impactHit && impactHit.damage === machCfg.damage, `Machinery crash deals exact ${machCfg.damage} single-hit damage`)
  assert(impactHitAgent.update(0.2, impactCenterCtx) === null, 'Machinery crash does not repeat damage during same fall')
  impactHitAgent.dispose()

  // Case C: Player stands directly under hoist origin during early drop -> hit once
  const originHitAgent = new HazardAgent(
    { id: 'machinery-origin-hit', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, ...machCell, swingSide: 'south' },
    testMaze
  )
  originHitAgent.update(0.05, underOriginCtx)
  const originHit = originHitAgent.update(machCfg.warningDuration + 0.05, underOriginCtx)
  assert(originHit && originHit.damage === machCfg.damage, 'Player directly underneath falling machinery receives single-hit impact damage')
  originHitAgent.dispose()
}
console.log('✓ Falling suspended machinery warning, escape, world-space swing-drop collision, permanent state, and reset verified')

// 35. Falling Suspended Machinery — Engine Damage, Invulnerability, Game Over, Reset & Navigation Safety
console.log('Test 35: Falling Suspended Machinery Engine Damage, Invulnerability, Game Over & Navigation Safety')
{
  const machEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 1.2,
    enemies: { autoSpawn: false },
  })
  const damageEvents = []
  machEngine._onPlayerDamage = (ev) => damageEvents.push(ev)
  machEngine.setMaze(testMaze)
  machEngine.clearHazards()

  const engMach = new HazardAgent(
    { id: 'engine-mach-1', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: 2, col: 1, swingSide: 'south' },
    testMaze
  )
  machEngine.scene.add(engMach.getMesh())
  machEngine.hazardManager.hazards.set(engMach.id, engMach)

  const mCenter = engMach.getDangerArea().center
  const onCtx = {
    playerWorldPos: { x: mCenter.x, y: 0, z: mCenter.z },
    playerGridCell: { row: 2, col: 1 },
  }
  const mCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]

  machEngine.hazardManager.update(0.05, onCtx)
  const mgrRes = machEngine.hazardManager.update(mCfg.warningDuration + 0.05, onCtx)
  assert(mgrRes.hazardHits.length === 1, 'HazardManager reports falling_suspended_machinery hit')
  const applied = machEngine.applyDamage(mgrRes.hazardHits[0].damage, {
    hazardId: mgrRes.hazardHits[0].hazardId,
    hazardType: mgrRes.hazardHits[0].type,
  })
  assert(applied === true && machEngine.health === 60, `HP drops from 100 to 60 (got ${machEngine.health})`)
  assert(machEngine.damageImmunityTimer > 0, 'Invulnerability activated after machinery crash')
  assert(damageEvents[damageEvents.length - 1].hazardType === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, 'Damage event records falling_suspended_machinery')
  assert(machEngine.applyDamage(20, { enemyId: 'stalker-m' }) === false, 'Invulnerability blocks follow-up attack')

  // Lethal hit -> game over -> resetCombat restores health and suspended machinery
  machEngine.damageImmunityTimer = 0
  machEngine.applyDamage(60, { hazardId: 'engine-mach-1', hazardType: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY })
  assert(machEngine.health === 0 && machEngine.isGameOver === true, 'Lethal machinery crash triggers game over')
  engMach.update(mCfg.activeDuration + 0.05, onCtx)
  assert(engMach.getState() === HAZARD_STATES.DISABLED, 'Machinery disabled before resetCombat')

  machEngine.resetCombat()
  assert(machEngine.health === 100 && machEngine.isGameOver === false, 'resetCombat restores HP and clears game over')
  assert(engMach.getState() === HAZARD_STATES.DORMANT, 'resetCombat restores suspended machinery to intact DORMANT state')
  machEngine.dispose()

  // Maze topology, reachability & ordinary collision safety after collapse
  const navMaze = generateMaze({ seed: 771234 })
  const gridSnapshot = navMaze.grid.map((row) => row.slice())
  const reachBefore = exploreReachableCells(navMaze.grid, navMaze.start)
  const navSpec = placeHazards(navMaze).find((h) => h.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY)
  assert(Boolean(navSpec), 'Found falling_suspended_machinery placement in generated maze')
  const navAgent = new HazardAgent(navSpec, navMaze)
  const navCenter = navAgent.getDangerArea().center
  const navCtx = { playerWorldPos: navCenter, playerGridCell: { row: navSpec.row, col: navSpec.col } }
  navAgent.update(0.05, navCtx)
  navAgent.update(mCfg.warningDuration + 0.05, navCtx)
  navAgent.update(mCfg.activeDuration + 0.05, navCtx)
  assert(navAgent.getState() === HAZARD_STATES.DISABLED, 'Generated maze machinery collapsed cleanly')

  for (let r = 0; r < navMaze.rows; r += 1) {
    for (let c = 0; c < navMaze.cols; c += 1) {
      assert(navMaze.grid[r][c] === gridSnapshot[r][c], `Maze grid (${r},${c}) unmodified by suspended machinery`)
    }
  }
  const reachAfter = exploreReachableCells(navMaze.grid, navMaze.start)
  assert(
    reachAfter.valid === true &&
      reachAfter.reachableCount === reachBefore.reachableCount &&
      reachAfter.distances.has(`${navMaze.exit.row},${navMaze.exit.col}`),
    'Maze reachability from start to exit preserved after machinery collapse'
  )
  const colRes = resolveGridCollision(navCenter.x, navCenter.z, navMaze)
  assert(Math.hypot(colRes.x - navCenter.x, colRes.z - navCenter.z) < 0.05, 'Collapsed machinery corridor remains freely walkable')
  navAgent.dispose()
}
console.log('✓ Falling suspended machinery engine damage, invulnerability, game-over, and maze navigation safety verified')

// 36. Falling Suspended Machinery — Spatial Audio & Subtitles (Muted, Zero Volume, No Duplicates)
console.log('Test 36: Falling Suspended Machinery Spatial Audio & Subtitles (Muted & Zero-Volume Safe)')
{
  const audioEngine = new HorrorAudioEngine({
    volumes: { master: 0, effects: 0, ambience: 0, music: 0, muted: true },
    debugHistory: true,
  })
  audioEngine._debugHistoryEnabled = true
  audioEngine.setMaze(testMaze)
  audioEngine.setAudioOptions({ subtitles: true })

  const subtitles = []
  const unsub = audioEngine.subscribeSubtitles((entry) => subtitles.push(entry))

  const machAudioAgent = new HazardAgent(
    { id: 'audio-mach-1', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: 2, col: 1, swingSide: 'south' },
    testMaze
  )
  const mPos = machAudioAgent.worldPos
  assert(mPos && Number.isFinite(mPos.x) && Number.isFinite(mPos.z), 'Suspended machinery exposes valid worldPos for spatial audio')

  const audioCtx = {
    playerWorldPos: { x: mPos.x, y: 0, z: mPos.z },
    hazards: [machAudioAgent],
  }
  const mCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]

  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 0, 'No subtitle while machinery is dormant')

  machAudioAgent.update(0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 2, col: 1 } })
  assert(machAudioAgent.getState() === HAZARD_STATES.WARNING, 'Machinery enters WARNING')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 1, `Warning subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[0].text === 'Suspended machinery creaking and swaying',
    `Expected warning subtitle, got "${subtitles[0].text}"`
  )

  machAudioAgent.update(mCfg.warningDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 2, col: 1 } })
  assert(machAudioAgent.getState() === HAZARD_STATES.ACTIVE, 'Machinery enters ACTIVE')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, `Active subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[1].text === 'Heavy machinery crashing down',
    `Expected active subtitle, got "${subtitles[1].text}"`
  )

  machAudioAgent.update(mCfg.activeDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 2, col: 1 } })
  assert(machAudioAgent.getState() === HAZARD_STATES.DISABLED, 'Machinery enters DISABLED')
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, 'Disabled state emits no extra or duplicate subtitle')

  const cueTypes = audioEngine.getCueHistory().map((c) => c.type)
  assert(cueTypes.includes('hazard_falling_suspended_machinery_warning'), 'Warning spatial audio cue recorded')
  assert(cueTypes.includes('hazard_falling_suspended_machinery_active'), 'Active crash spatial audio cue recorded')

  let oscCount = 0
  let noiseCount = 0
  const makeParam = () => ({
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  })
  const mockCtx = {
    currentTime: 4.0,
    createOscillator: () => {
      oscCount += 1
      return {
        type: 'sawtooth',
        frequency: makeParam(),
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createBufferSource: () => {
      noiseCount += 1
      return {
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createGain: () => ({ gain: makeParam(), connect: () => {}, disconnect: () => {} }),
    createBiquadFilter: () => ({
      type: 'bandpass',
      frequency: makeParam(),
      Q: makeParam(),
      connect: () => {},
      disconnect: () => {},
    }),
  }
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, 'warning')
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, 'active')
  assert(
    oscCount >= 4 && noiseCount >= 3,
    `Suspended machinery audio synthesis triggers cable groan/creak + snap/slam/crunch layers (osc=${oscCount}, noise=${noiseCount})`
  )

  unsub()
  machAudioAgent.dispose()
  audioEngine.dispose()
}
console.log('✓ Falling suspended machinery spatial audio and muted/zero-volume subtitles verified without duplicates')

// 37. Falling Suspended Machinery — Instance Resource Disposal, Shared Pool Integrity & Maze Replacement Cleanup
console.log('Test 37: Falling Suspended Machinery Disposal, Shared Pool Preservation & Maze Replacement Cleanup')
{
  const disposeMach = new HazardAgent(
    { id: 'mach-dispose-check', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: 2, col: 1, swingSide: 'south' },
    testMaze
  )
  const mesh = disposeMach.getMesh()
  const { dustMat } = mesh.userData
  let dustDisposed = false
  const origDust = dustMat.dispose.bind(dustMat)
  dustMat.dispose = () => {
    dustDisposed = true
    origDust()
  }

  const poolStatsBefore = getHazardPoolStats()
  disposeMach.dispose()
  const poolStatsAfter = getHazardPoolStats()

  assert(dustDisposed === true, 'Instance-owned dustMat disposed on suspended machinery cleanup')
  assert(
    disposeMach.isDisposed === true &&
      disposeMach.getMesh() === null &&
      disposeMach.swingDir === null &&
      disposeMach.originWorldPos === null,
    'Machinery agent disposed and references cleanly nulled'
  )
  assert(
    mesh.userData.dustMat === null &&
      mesh.userData.machineryMountGroup === null &&
      mesh.userData.gantryGroup === null &&
      mesh.userData.machineBodyGroup === null &&
      mesh.userData.warnBoltGroup === null &&
      mesh.userData.impactDebrisGroup === null &&
      mesh.userData.impactDustGroup === null,
    'Suspended machinery userData references cleanly nulled'
  )
  assert(
    poolStatsAfter.geometries === poolStatsBefore.geometries &&
      poolStatsAfter.materials === poolStatsBefore.materials,
    'Shared hazard pools preserved after suspended machinery disposal'
  )

  const scene = new THREE.Scene()
  const manager = new HazardManager(scene)
  manager.setMaze(generateMaze({ seed: 771234 }))
  const firstMachs = Array.from(manager.hazards.values()).filter(
    (a) => a.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY
  )
  assert(firstMachs.length >= 1, 'HazardManager spawns falling_suspended_machinery agent for first maze')
  manager.setMaze(generateMaze({ seed: 314159 }))
  assert(
    firstMachs.every((a) => a.isDisposed === true),
    'Previous maze suspended machinery agents disposed on setMaze replacement'
  )
  const secondMachs = Array.from(manager.hazards.values()).filter(
    (a) => a.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY
  )
  assert(secondMachs.length >= 1, 'HazardManager spawns new falling_suspended_machinery agent for replacement maze')
  manager.dispose()
  assert(
    secondMachs.every((a) => a.isDisposed === true) && scene.children.length === 0,
    'Manager dispose cleans up all suspended machinery meshes'
  )
}
console.log('✓ Falling suspended machinery disposal, shared pool preservation, and maze replacement cleanup verified')

// 38. Ventilation Duct Collapse — Deterministic Placement, Ceiling Support, Asset Reuse & Bounded Geometry
console.log('Test 38: Ventilation Duct Collapse Deterministic Placement, Ceiling Support & Bounded Geometry')
{
  const seeds = [771234, 314159, 445566, 998877]
  for (const seed of seeds) {
    const m1 = generateMaze({ seed })
    const m2 = generateMaze({ seed })
    const h1 = placeHazards(m1)
    const h2 = placeHazards(m2)

    const ducts1 = h1.filter((h) => h.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE)
    const ducts2 = h2.filter((h) => h.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE)
    assert(ducts1.length >= 1, `Seed ${seed} places at least one ventilation_duct_collapse hazard`)
    assert(
      JSON.stringify(ducts1) === JSON.stringify(ducts2),
      `Seed ${seed} ventilation_duct_collapse placement is deterministic`
    )

    const startKey = `${m1.start.row},${m1.start.col}`
    const exitKey = `${m1.exit.row},${m1.exit.col}`
    for (const dSpec of ducts1) {
      const key = `${dSpec.row},${dSpec.col}`
      assert(m1.grid[dSpec.row][dSpec.col] === CELL_TYPES.PATH, `Vent duct (${key}) must sit above reachable PATH cell`)
      assert(key !== startKey && key !== exitKey, 'Vent duct must not overlap start or exit')
      assert(
        Math.abs(dSpec.row - m1.start.row) + Math.abs(dSpec.col - m1.start.col) >= 3,
        'Vent duct respects spawn safety clearance'
      )
      assert(
        dSpec.mountType === 'ceiling_duct_run' || dSpec.mountType === 'wall_bulkhead_duct',
        `Vent duct uses structural ceiling/bulkhead mount (got ${dSpec.mountType})`
      )
      assert(
        dSpec.dropDir && Math.abs(Math.hypot(dSpec.dropDir.x, dSpec.dropDir.z) - 1) < 1e-6,
        'Vent duct defines unit drop direction'
      )
      const aheadRow = dSpec.row + dSpec.dropDir.z
      const aheadCol = dSpec.col + dSpec.dropDir.x
      assert(
        m1.grid[aheadRow]?.[aheadCol] === CELL_TYPES.PATH,
        `Vent duct dropDir aims into open walkable corridor (${aheadRow},${aheadCol})`
      )
      assert(
        dSpec.ceilingAnchorY >= 3.5 && dSpec.ductRestY >= 3.0,
        `Vent duct anchors beneath ceiling deck (anchorY=${dSpec.ceilingAnchorY}, restY=${dSpec.ductRestY})`
      )
      if (dSpec.mountType === 'wall_bulkhead_duct') {
        assert(
          m1.grid[dSpec.wallRow]?.[dSpec.wallCol] === CELL_TYPES.WALL,
          `Bulkhead duct connects to real backing wall (${dSpec.wallRow},${dSpec.wallCol})`
        )
      }

      const agent = new HazardAgent(dSpec, m1)
      const data = agent.getMesh().userData
      assert(
        data.ceilingRigGroup &&
          data.rearHangerGroup &&
          data.frontHangerGroup &&
          data.ductPivotGroup &&
          data.ductBodyGroup,
        'Vent duct builds overhead plenum rig, rear/front trapeze hangers, and collapsible duct section'
      )
      if (dSpec.mountType === 'wall_bulkhead_duct') {
        assert(data.wallBulkheadGroup !== null, 'Wall-bulkhead duct includes rear bulkhead intake collar')
      }
      // Verify reuse of pooled galvanized steel texture maps from buildCeilingVents.js
      const mainDuctMesh = data.ductBodyGroup.children[0]
      assert(
        mainDuctMesh?.material?.map && mainDuctMesh.material.roughnessMap && mainDuctMesh.material.bumpMap,
        'Vent duct reuses pooled galvanized steel textures from buildCeilingVents.js'
      )
      assert(data.warnScrewMeshes.length <= 6, `Bounded warning loose screws (got ${data.warnScrewMeshes.length})`)
      assert(data.warnDustMeshes.length <= 5, `Bounded warning sifting dust (got ${data.warnDustMeshes.length})`)
      assert(data.ductDebrisMeshes.length <= 6, `Bounded impact metal shards (got ${data.ductDebrisMeshes.length})`)
      assert(data.ductImpactDustMeshes.length <= 6, `Bounded impact dust clouds (got ${data.ductImpactDustMeshes.length})`)
      agent.dispose()
    }
  }

  // Verify straight corridor run vs wall-backed bulkhead in testMaze:
  // Cell (2, 1) has open north (1,1) & south (3,1) -> ceiling_duct_run
  const runMount = resolveVentilationDuctMount(testMaze.grid, 2, 1, null)
  assert(
    runMount.mountType === 'ceiling_duct_run' &&
      (runMount.dropSide === 'north' || runMount.dropSide === 'south'),
    `Straight corridor resolves ceiling_duct_run along open axis (got mount=${runMount.mountType}, drop=${runMount.dropSide})`
  )
  // Cell (1, 1) has north wall (0,1) and open south (2,1) -> wall_bulkhead_duct when dropSide='south'
  const bulkheadMount = resolveVentilationDuctMount(testMaze.grid, 1, 1, null, 'south')
  assert(
    bulkheadMount.mountType === 'wall_bulkhead_duct' && bulkheadMount.wallSide === 'north',
    `Wall-backed cell resolves wall_bulkhead_duct (got mount=${bulkheadMount.mountType}, wall=${bulkheadMount.wallSide})`
  )
}
console.log('✓ Ventilation duct deterministic placement, ceiling/bulkhead support, asset reuse, and bounded geometry verified')

// 39. Ventilation Duct Collapse — Warning Sag/Rattle/Screws/Dust, Escape, World-Space Impact, Permanent State & Reset
console.log('Test 39: Ventilation Duct Collapse Warning, Escape, World-Space Impact Collision, Permanent State & Reset')
{
  const ductCell = { row: 2, col: 1 }
  const ductCfg = HAZARD_CONFIG[HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]
  assert(ductCfg.warningDuration >= 1.2 && ductCfg.damage === 35, 'Ventilation duct has fair warning window and configured damage')

  const ductAgent = new HazardAgent(
    { id: 'duct-test', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, ...ductCell, dropSide: 'south' },
    testMaze
  )
  const dData = ductAgent.getMesh().userData
  const dangerArea = ductAgent.getDangerArea()
  const cellCenter = gridToWorld(ductCell.row, ductCell.col, testMaze)

  assert(ductAgent.dropSide === 'south' && ductAgent.dropDir.z === 1 && ductAgent.dropDir.x === 0, 'Drop direction aims south (+Z)')
  assert(
    Math.abs(dangerArea.center.z - (cellCenter.z + 0.56)) < 1e-4 && Math.abs(dangerArea.center.x - cellCenter.x) < 1e-4,
    'Impact center offsets 0.56m along dropDir matching visual duct landing footprint'
  )

  const impactCenterCtx = {
    playerWorldPos: { x: dangerArea.center.x, y: 0, z: dangerArea.center.z },
    playerGridCell: ductCell,
  }
  // Directly under rear-center of overhead sagging duct (localZ = -0.75 -> hit during early detachment)
  const underSpanCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z - 0.75 },
    playerGridCell: ductCell,
  }
  // Safe position LATERALLY beside duct on the SAME grid cell (|localX| = 1.25 > halfWidth 0.88)
  const lateralSameCellSafeCtx = {
    playerWorldPos: { x: cellCenter.x + 1.25, y: 0, z: cellCenter.z + 0.56 },
    playerGridCell: ductCell,
  }
  // Safe position BEHIND rear duct stub on the SAME grid cell (localZ = -1.25 < -0.95)
  const behindSameCellSafeCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z - 1.25 },
    playerGridCell: ductCell,
  }
  // Safe position AHEAD beyond landed duct footprint (localZ = +1.95 > maxLocalZ 1.68)
  const aheadBeyondSafeCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z + 1.95 },
    playerGridCell: { row: 3, col: 1 },
  }
  const farCtx = {
    playerWorldPos: { x: farWorld.x + 4, y: 0, z: farWorld.z },
    playerGridCell: { row: 3, col: 3 },
  }

  // Dormant checks: stays dormant while player is far away
  for (let i = 0; i < 12; i += 1) {
    assert(ductAgent.update(0.1, farCtx) === null, 'Dormant vent duct deals no damage')
    assert(ductAgent.getState() === HAZARD_STATES.DORMANT, 'Vent duct stays DORMANT until player approaches')
  }
  assert(
    dData.warnScrewGroup.visible === false &&
      dData.warnDustGroup.visible === false &&
      dData.ductDebrisGroup.visible === false &&
      dData.ductImpactDustGroup.visible === false,
    'No screws, dust, or debris while dormant'
  )
  assert(Math.abs(dData.ductPivotGroup.rotation.x) < 1e-6 && Math.abs(dData.ductBodyGroup.position.y) < 1e-6, 'Dormant duct stays level and suspended')

  // Player approaches -> WARNING
  assert(ductAgent.update(0.05, impactCenterCtx) === null, 'Entering warning deals no damage')
  assert(ductAgent.getState() === HAZARD_STATES.WARNING, 'Approaching unstable duct triggers WARNING')

  // Mid-warning: rattling, progressive nose-down sag, loosening front bracket, falling screws, sifting dust, 0 damage
  assert(ductAgent.update(ductCfg.warningDuration * 0.6, impactCenterCtx) === null, 'No premature damage during warning')
  assert(ductAgent.getState() === HAZARD_STATES.WARNING, 'Remains in WARNING during reaction window')
  assert(dData.ductPivotGroup.rotation.x > 0.08, `Duct visibly sags downward during warning (rotX=${dData.ductPivotGroup.rotation.x.toFixed(3)})`)
  assert(Math.abs(dData.frontHangerGroup.rotation.z) > 0.04, 'Front trapeze hanger visibly loosens/tilts during warning')
  assert(dData.warnScrewGroup.visible === true, 'Loose screws fall from strained duct joints during warning')
  assert(dData.warnDustGroup.visible === true && dData.warnDustMat.opacity > 0.2, 'Dust sifts from ceiling duct seam during warning')
  assert(dData.ductDebrisGroup.visible === false && dData.ductImpactDustGroup.visible === false, 'Impact debris/dust wait until fall')

  // Case A: Player escapes laterally beside duct (even on same grid cell) before activation -> 0 damage
  const escapeHit = ductAgent.update(ductCfg.warningDuration * 0.45, lateralSameCellSafeCtx)
  assert(ductAgent.getState() === HAZARD_STATES.ACTIVE, 'Vent duct transitions to ACTIVE detachment and fall')
  assert(escapeHit === null, 'Escaping laterally outside rectangular duct footprint avoids damage even on same grid cell')

  // Mid-active: duct detaches & drops to floor, front hanger snaps aside, debris & impact dust burst; behind/beyond stay safe
  assert(ductAgent.update(ductCfg.activeDuration * 0.3, behindSameCellSafeCtx) === null, 'Player behind rear duct stub takes no damage')
  assert(ductAgent.update(ductCfg.activeDuration * 0.3, aheadBeyondSafeCtx) === null, 'Player beyond landed duct takes no damage')
  const expectedFallenLocalY = dData.fallenY - dData.ductRestY
  assert(dData.ductBodyGroup.position.y < expectedFallenLocalY * 0.85, 'Detached duct drops cleanly onto corridor floor during active fall')
  assert(Math.abs(dData.frontHangerGroup.rotation.z) > 0.35, 'Front trapeze hanger snaps free during collapse')
  assert(dData.ductDebrisGroup.visible === true, 'Bent louver/bracket shards scatter on impact')
  assert(dData.ductImpactDustGroup.visible === true && dData.ductImpactDustMat.opacity > 0.05, 'Impact dust billows on crash')
  assert(dData.warnScrewGroup.visible === false && dData.warnDustGroup.visible === false, 'Warning screws & dust turn off during collapse')

  // Complete active -> permanent DISABLED collapsed wreckage
  ductAgent.update(ductCfg.activeDuration * 0.5, lateralSameCellSafeCtx)
  assert(ductAgent.getState() === HAZARD_STATES.DISABLED, 'Vent duct enters permanent DISABLED crashed state')
  assert(ductAgent.isDisabled === true && ductAgent.isPermanentlyCollapsed === true, 'Permanent collapse flags set')
  assert(Math.abs(dData.ductBodyGroup.position.y - expectedFallenLocalY) < 1e-4, 'Fallen duct rests permanently on corridor floor')
  assert(dData.ductDebrisGroup.visible === true, 'Fallen duct debris persists as environmental wreckage')
  assert(
    dData.ductImpactDustGroup.visible === false &&
      dData.ductImpactDustMat.opacity === 0 &&
      dData.warnDustMat.opacity === 0,
    'Temporary impact and warning dust cleanly hidden in collapsed state'
  )

  // Collapsed duct never repeats damage
  assert(ductAgent.update(0.5, impactCenterCtx) === null, 'Permanently collapsed duct never repeats damage')
  assert(ductAgent.getState() === HAZARD_STATES.DISABLED, 'Collapsed duct remains DISABLED')

  // Reset restores suspended intact duct with zero duplicate meshes
  const rootCountBefore = ductAgent.getMesh().children.length
  const mountCountBefore = dData.ductMountGroup.children.length
  ductAgent.resetState()
  assert(ductAgent.getState() === HAZARD_STATES.DORMANT, 'resetState restores DORMANT')
  assert(ductAgent.isDisabled === false && ductAgent.isPermanentlyCollapsed === false, 'resetState clears permanent collapse flags')
  assert(Math.abs(dData.ductBodyGroup.position.y) < 1e-6 && Math.abs(dData.ductPivotGroup.rotation.x) < 1e-6, 'resetState restores duct to level overhead mount')
  assert(Math.abs(dData.frontHangerGroup.rotation.z) < 1e-6, 'resetState restores intact front trapeze hanger')
  assert(
    dData.ductDebrisGroup.visible === false &&
      dData.ductImpactDustGroup.visible === false &&
      dData.warnScrewGroup.visible === false &&
      dData.warnDustGroup.visible === false,
    'resetState hides debris, dust, and warning screws'
  )
  assert(
    ductAgent.getMesh().children.length === rootCountBefore &&
      dData.ductMountGroup.children.length === mountCountBefore,
    'resetState creates zero duplicate meshes'
  )
  ductAgent.dispose()

  // Case B: Player stays inside rectangular duct impact center -> exact 35 single-hit damage, no repeat
  const impactHitAgent = new HazardAgent(
    { id: 'duct-impact-hit', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, ...ductCell, dropSide: 'south' },
    testMaze
  )
  impactHitAgent.update(0.05, impactCenterCtx)
  const impactHit = impactHitAgent.update(ductCfg.warningDuration + 0.05, impactCenterCtx)
  assert(impactHitAgent.getState() === HAZARD_STATES.ACTIVE, 'Impact-hit duct enters ACTIVE')
  assert(impactHit && impactHit.damage === ductCfg.damage, `Vent duct crash deals exact ${ductCfg.damage} single-hit damage`)
  assert(impactHitAgent.update(0.2, impactCenterCtx) === null, 'Vent duct crash does not repeat damage during same fall')
  impactHitAgent.dispose()

  // Case C: Player stands directly under rear-center of detaching overhead duct span -> hit once during early drop
  const spanHitAgent = new HazardAgent(
    { id: 'duct-span-hit', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, ...ductCell, dropSide: 'south' },
    testMaze
  )
  spanHitAgent.update(0.05, underSpanCtx)
  const spanHit = spanHitAgent.update(ductCfg.warningDuration + 0.05, underSpanCtx)
  assert(spanHit && spanHit.damage === ductCfg.damage, 'Player directly underneath detaching overhead duct receives single-hit impact damage')
  spanHitAgent.dispose()
}
console.log('✓ Ventilation duct warning, escape, rectangular world-space collision, permanent state, and reset verified')

// 40. Ventilation Duct Collapse — Engine Damage, Invulnerability, Game Over, Reset & Navigation Safety
console.log('Test 40: Ventilation Duct Collapse Engine Damage, Invulnerability, Game Over & Navigation Safety')
{
  const ductEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 1.2,
    enemies: { autoSpawn: false },
  })
  const damageEvents = []
  ductEngine._onPlayerDamage = (ev) => damageEvents.push(ev)
  ductEngine.setMaze(testMaze)
  ductEngine.clearHazards()

  const engDuct = new HazardAgent(
    { id: 'engine-duct-1', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: 2, col: 1, dropSide: 'south' },
    testMaze
  )
  ductEngine.scene.add(engDuct.getMesh())
  ductEngine.hazardManager.hazards.set(engDuct.id, engDuct)

  const dCenter = engDuct.getDangerArea().center
  const onCtx = {
    playerWorldPos: { x: dCenter.x, y: 0, z: dCenter.z },
    playerGridCell: { row: 2, col: 1 },
  }
  const dCfg = HAZARD_CONFIG[HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]

  ductEngine.hazardManager.update(0.05, onCtx)
  const mgrRes = ductEngine.hazardManager.update(dCfg.warningDuration + 0.05, onCtx)
  assert(mgrRes.hazardHits.length === 1, 'HazardManager reports ventilation_duct_collapse hit')
  const applied = ductEngine.applyDamage(mgrRes.hazardHits[0].damage, {
    hazardId: mgrRes.hazardHits[0].hazardId,
    hazardType: mgrRes.hazardHits[0].type,
  })
  assert(applied === true && ductEngine.health === 65, `HP drops from 100 to 65 (got ${ductEngine.health})`)
  assert(ductEngine.damageImmunityTimer > 0, 'Invulnerability activated after ventilation duct crash')
  assert(damageEvents[damageEvents.length - 1].hazardType === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, 'Damage event records ventilation_duct_collapse')
  assert(ductEngine.applyDamage(20, { enemyId: 'stalker-d' }) === false, 'Invulnerability blocks follow-up attack')

  // Lethal hit -> game over -> resetCombat restores HP and suspended duct
  ductEngine.damageImmunityTimer = 0
  ductEngine.applyDamage(65, { hazardId: 'engine-duct-1', hazardType: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE })
  assert(ductEngine.health === 0 && ductEngine.isGameOver === true, 'Lethal ventilation duct crash triggers game over')
  engDuct.update(dCfg.activeDuration + 0.05, onCtx)
  assert(engDuct.getState() === HAZARD_STATES.DISABLED, 'Vent duct disabled before resetCombat')

  ductEngine.resetCombat()
  assert(ductEngine.health === 100 && ductEngine.isGameOver === false, 'resetCombat restores HP and clears game over')
  assert(engDuct.getState() === HAZARD_STATES.DORMANT, 'resetCombat restores ventilation duct to intact DORMANT state')
  ductEngine.dispose()

  // Maze topology, reachability & ordinary collision safety after collapse
  const navMaze = generateMaze({ seed: 771234 })
  const gridSnapshot = navMaze.grid.map((row) => row.slice())
  const reachBefore = exploreReachableCells(navMaze.grid, navMaze.start)
  const navSpec = placeHazards(navMaze).find((h) => h.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE)
  assert(Boolean(navSpec), 'Found ventilation_duct_collapse placement in generated maze')
  const navAgent = new HazardAgent(navSpec, navMaze)
  const navCenter = navAgent.getDangerArea().center
  const navCtx = { playerWorldPos: navCenter, playerGridCell: { row: navSpec.row, col: navSpec.col } }
  navAgent.update(0.05, navCtx)
  navAgent.update(dCfg.warningDuration + 0.05, navCtx)
  navAgent.update(dCfg.activeDuration + 0.05, navCtx)
  assert(navAgent.getState() === HAZARD_STATES.DISABLED, 'Generated maze ventilation duct collapsed cleanly')

  for (let r = 0; r < navMaze.rows; r += 1) {
    for (let c = 0; c < navMaze.cols; c += 1) {
      assert(navMaze.grid[r][c] === gridSnapshot[r][c], `Maze grid (${r},${c}) unmodified by ventilation duct`)
    }
  }
  const reachAfter = exploreReachableCells(navMaze.grid, navMaze.start)
  assert(
    reachAfter.valid === true &&
      reachAfter.reachableCount === reachBefore.reachableCount &&
      reachAfter.distances.has(`${navMaze.exit.row},${navMaze.exit.col}`),
    'Maze reachability from start to exit preserved after ventilation duct collapse'
  )
  const colRes = resolveGridCollision(navCenter.x, navCenter.z, navMaze)
  assert(Math.hypot(colRes.x - navCenter.x, colRes.z - navCenter.z) < 0.05, 'Collapsed ventilation duct corridor remains freely walkable')
  navAgent.dispose()
}
console.log('✓ Ventilation duct engine damage, invulnerability, game-over, and maze navigation safety verified')

// 41. Ventilation Duct Collapse — Spatial Audio & Subtitles (Muted, Zero Volume, No Duplicates)
console.log('Test 41: Ventilation Duct Collapse Spatial Audio & Subtitles (Muted & Zero-Volume Safe)')
{
  const audioEngine = new HorrorAudioEngine({
    volumes: { master: 0, effects: 0, ambience: 0, music: 0, muted: true },
    debugHistory: true,
  })
  audioEngine._debugHistoryEnabled = true
  audioEngine.setMaze(testMaze)
  audioEngine.setAudioOptions({ subtitles: true })

  const subtitles = []
  const unsub = audioEngine.subscribeSubtitles((entry) => subtitles.push(entry))

  const ductAudioAgent = new HazardAgent(
    { id: 'audio-duct-1', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: 2, col: 1, dropSide: 'south' },
    testMaze
  )
  const dPos = ductAudioAgent.worldPos
  assert(dPos && Number.isFinite(dPos.x) && Number.isFinite(dPos.z), 'Ventilation duct exposes valid worldPos for spatial audio')

  const audioCtx = {
    playerWorldPos: { x: dPos.x, y: 0, z: dPos.z },
    hazards: [ductAudioAgent],
  }
  const dCfg = HAZARD_CONFIG[HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]

  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 0, 'No subtitle while ventilation duct is dormant')

  ductAudioAgent.update(0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 2, col: 1 } })
  assert(ductAudioAgent.getState() === HAZARD_STATES.WARNING, 'Ventilation duct enters WARNING')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 1, `Warning subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[0].text === 'Ventilation duct rattling and sagging',
    `Expected warning subtitle, got "${subtitles[0].text}"`
  )

  ductAudioAgent.update(dCfg.warningDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 2, col: 1 } })
  assert(ductAudioAgent.getState() === HAZARD_STATES.ACTIVE, 'Ventilation duct enters ACTIVE')
  audioEngine.update(0.016, audioCtx)
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, `Active subtitle emitted once while muted (got ${subtitles.length})`)
  assert(
    subtitles[1].text === 'Ventilation duct crashing down',
    `Expected active subtitle, got "${subtitles[1].text}"`
  )

  ductAudioAgent.update(dCfg.activeDuration + 0.05, { playerWorldPos: audioCtx.playerWorldPos, playerGridCell: { row: 2, col: 1 } })
  assert(ductAudioAgent.getState() === HAZARD_STATES.DISABLED, 'Ventilation duct enters DISABLED')
  audioEngine.update(0.016, audioCtx)
  assert(subtitles.length === 2, 'Disabled state emits no extra or duplicate subtitle')

  const cueTypes = audioEngine.getCueHistory().map((c) => c.type)
  assert(cueTypes.includes('hazard_ventilation_duct_collapse_warning'), 'Warning spatial audio cue recorded')
  assert(cueTypes.includes('hazard_ventilation_duct_collapse_active'), 'Active crash spatial audio cue recorded')

  let oscCount = 0
  let noiseCount = 0
  const makeParam = () => ({
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  })
  const mockCtx = {
    currentTime: 5.0,
    createOscillator: () => {
      oscCount += 1
      return {
        type: 'sawtooth',
        frequency: makeParam(),
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createBufferSource: () => {
      noiseCount += 1
      return {
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {},
      }
    },
    createGain: () => ({ gain: makeParam(), connect: () => {}, disconnect: () => {} }),
    createBiquadFilter: () => ({
      type: 'bandpass',
      frequency: makeParam(),
      Q: makeParam(),
      connect: () => {},
      disconnect: () => {},
    }),
  }
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, 'warning')
  triggerHazardCue(mockCtx, {}, {}, HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, 'active')
  assert(
    oscCount >= 4 && noiseCount >= 3,
    `Ventilation duct audio synthesis triggers rattle/creak + snap/crash/clatter layers (osc=${oscCount}, noise=${noiseCount})`
  )

  unsub()
  ductAudioAgent.dispose()
  audioEngine.dispose()
}
console.log('✓ Ventilation duct spatial audio and muted/zero-volume subtitles verified without duplicates')

// 42. Ventilation Duct Collapse — Instance Resource Disposal, Shared Pool Integrity & Maze Replacement Cleanup
console.log('Test 42: Ventilation Duct Collapse Disposal, Shared Pool Preservation & Maze Replacement Cleanup')
{
  const disposeDuct = new HazardAgent(
    { id: 'duct-dispose-check', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: 2, col: 1, dropSide: 'south' },
    testMaze
  )
  const mesh = disposeDuct.getMesh()
  const { warnDustMat, ductImpactDustMat } = mesh.userData
  let warnDustDisposed = false
  let impactDustDisposed = false
  const origWarnDust = warnDustMat.dispose.bind(warnDustMat)
  const origImpactDust = ductImpactDustMat.dispose.bind(ductImpactDustMat)
  warnDustMat.dispose = () => {
    warnDustDisposed = true
    origWarnDust()
  }
  ductImpactDustMat.dispose = () => {
    impactDustDisposed = true
    origImpactDust()
  }

  const hazardPoolsBefore = getHazardPoolStats()
  const ventPoolsBefore = getCeilingVentPoolStats()
  disposeDuct.dispose()
  const hazardPoolsAfter = getHazardPoolStats()
  const ventPoolsAfter = getCeilingVentPoolStats()

  assert(
    warnDustDisposed === true && impactDustDisposed === true,
    'Instance-owned dust materials (warnDustMat, ductImpactDustMat) disposed on ventilation duct cleanup'
  )
  assert(
    disposeDuct.isDisposed === true &&
      disposeDuct.getMesh() === null &&
      disposeDuct.dropDir === null &&
      disposeDuct.originWorldPos === null,
    'Ventilation duct agent disposed and references cleanly nulled'
  )
  assert(
    mesh.userData.warnDustMat === null &&
      mesh.userData.ductImpactDustMat === null &&
      mesh.userData.ductMountGroup === null &&
      mesh.userData.ceilingRigGroup === null &&
      mesh.userData.ductPivotGroup === null &&
      mesh.userData.ductBodyGroup === null &&
      mesh.userData.warnScrewGroup === null &&
      mesh.userData.ductDebrisGroup === null &&
      mesh.userData.ductImpactDustGroup === null,
    'Ventilation duct userData references cleanly nulled'
  )
  assert(
    hazardPoolsAfter.geometries === hazardPoolsBefore.geometries &&
      hazardPoolsAfter.materials === hazardPoolsBefore.materials &&
      ventPoolsAfter.entries === ventPoolsBefore.entries,
    'Shared hazard pools and ceiling vent galvanized texture pool preserved after duct disposal'
  )

  const scene = new THREE.Scene()
  const manager = new HazardManager(scene)
  manager.setMaze(generateMaze({ seed: 771234 }))
  const firstDucts = Array.from(manager.hazards.values()).filter(
    (a) => a.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE
  )
  assert(firstDucts.length >= 1, 'HazardManager spawns ventilation_duct_collapse agent for first maze')
  manager.setMaze(generateMaze({ seed: 314159 }))
  assert(
    firstDucts.every((a) => a.isDisposed === true),
    'Previous maze ventilation duct agents disposed on setMaze replacement'
  )
  const secondDucts = Array.from(manager.hazards.values()).filter(
    (a) => a.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE
  )
  assert(secondDucts.length >= 1, 'HazardManager spawns new ventilation_duct_collapse agent for replacement maze')
  manager.dispose()
  assert(
    secondDucts.every((a) => a.isDisposed === true) && scene.children.length === 0,
    'Manager dispose cleans up all ventilation duct meshes'
  )
}
console.log('✓ Ventilation duct disposal, shared pool preservation, and maze replacement cleanup verified')

// 43. Final Comprehensive Audit — All 10 Realistic Hazards Uniform Integration Verification
console.log('Test 43: Final Comprehensive Audit — All 10 Realistic Hazards Uniform Integration')
{
  const TEN_REALISTIC_HAZARDS = [
    HAZARD_TYPES.CEILING_COLLAPSE,
    HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    HAZARD_TYPES.STEAM_PIPE_BURST,
    HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
    HAZARD_TYPES.WALL_COLLAPSE,
    HAZARD_TYPES.FALLING_WATER_TANK,
    HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY,
    HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE,
  ]

  // 43a. Registration, determinism, prop non-overlap & BFS immutability across multiple seeds
  for (const seed of [10101, 20202, 771234, 998877]) {
    const m = generateMaze({ seed })
    const gridBefore = JSON.stringify(m.grid)
    const reachBefore = exploreReachableCells(m.grid, m.start)
    const placedA = placeHazards(m)
    const placedB = placeHazards(m)
    assert(
      JSON.stringify(placedA) === JSON.stringify(placedB),
      `Seed ${seed}: deterministic hazard placement verified`
    )
    const placedTypes = new Set(placedA.map((h) => h.type))
    for (const reqType of TEN_REALISTIC_HAZARDS) {
      assert(placedTypes.has(reqType), `Seed ${seed}: includes required realistic hazard ${reqType}`)
      assert(HAZARD_CONFIG[reqType], `HAZARD_CONFIG defines ${reqType}`)
      assert(
        HAZARD_CONFIG[reqType].warningDuration >= 0.9,
        `${reqType} provides fair warning window (>= 0.9s)`
      )
    }

    const hazardCoordKeys = new Set(placedA.map((h) => `${h.row},${h.col}`))
    const props = placeEnvironmentalProps(m, { hazards: placedA })
    for (const p of props) {
      const key = `${p.row},${p.col}`
      assert(!hazardCoordKeys.has(key), `Seed ${seed}: environmental prop at (${key}) never overlaps any hazard`)
    }

    // Verify none of the 10 realistic hazards auto-trigger during spawn elevator / player absence (10s)
    const mgrScene = new THREE.Scene()
    const mgr = new HazardManager(mgrScene)
    mgr.setMaze(m)
    for (let step = 0; step < 50; step += 1) {
      mgr.update(0.2, null)
    }
    for (const agent of mgr.getHazards()) {
      if (TEN_REALISTIC_HAZARDS.includes(agent.type)) {
        assert(
          agent.getState() === HAZARD_STATES.DORMANT && !agent.isPermanentlyCollapsed,
          `Seed ${seed}: ${agent.type} stays DORMANT without player proximity (no premature elevator collapse)`
        )
      }
    }
    mgr.dispose()

    const reachAfter = exploreReachableCells(m.grid, m.start)
    assert(JSON.stringify(m.grid) === gridBefore, `Seed ${seed}: maze.grid immutable`)
    assert(
      reachAfter.distances.size === reachBefore.distances.size,
      `Seed ${seed}: BFS reachability immutable`
    )
  }

  // 43b. Dedicated audio synthesis for ALL 10 realistic hazards & zero synthesis for removed legacy types
  const createAudioProbeCtx = () => {
    const profile = { oscTypes: [], filterFreqs: [], noiseCount: 0 }
    const makeParam = () => ({
      value: 0,
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
      cancelScheduledValues: () => {},
    })
    const ctx = {
      currentTime: 0,
      createOscillator: () => {
        const osc = {
          type: 'sine',
          frequency: makeParam(),
          connect: () => {},
          start: () => {
            profile.oscTypes.push(osc.type)
          },
          stop: () => {},
          disconnect: () => {},
          onended: null,
        }
        return osc
      },
      createBufferSource: () => ({
        buffer: null,
        loop: false,
        playbackRate: makeParam(),
        connect: () => {},
        start: () => {
          profile.noiseCount += 1
        },
        stop: () => {},
        disconnect: () => {},
        onended: null,
      }),
      createBiquadFilter: () => {
        const filter = {
          type: 'lowpass',
          frequency: {
            ...makeParam(),
            setValueAtTime: (v) => {
              profile.filterFreqs.push(v)
            },
          },
          Q: makeParam(),
          connect: () => {},
          disconnect: () => {},
        }
        return filter
      },
      createGain: () => ({
        gain: makeParam(),
        connect: () => {},
        disconnect: () => {},
      }),
    }
    return { ctx, profile }
  }
  const probeDest = { connect: () => {} }
  const dummyNoise = { duration: 1.0 }

  for (const removedType of REMOVED_LEGACY_HAZARD_TYPES) {
    const removedWarn = createAudioProbeCtx()
    triggerHazardCue(removedWarn.ctx, probeDest, dummyNoise, removedType, 'warning')
    assert(
      removedWarn.profile.oscTypes.length === 0 && removedWarn.profile.noiseCount === 0,
      `Removed legacy hazard "${removedType}" warning must synthesize zero audio`
    )
    const removedAct = createAudioProbeCtx()
    triggerHazardCue(removedAct.ctx, probeDest, dummyNoise, removedType, 'active')
    assert(
      removedAct.profile.oscTypes.length === 0 && removedAct.profile.noiseCount === 0,
      `Removed legacy hazard "${removedType}" active must synthesize zero audio`
    )
  }

  for (const hType of TEN_REALISTIC_HAZARDS) {
    const warnProbe = createAudioProbeCtx()
    triggerHazardCue(warnProbe.ctx, probeDest, dummyNoise, hType, 'warning')
    const actProbe = createAudioProbeCtx()
    triggerHazardCue(actProbe.ctx, probeDest, dummyNoise, hType, 'active')

    assert(
      warnProbe.profile.oscTypes.length + warnProbe.profile.noiseCount >= 2,
      `${hType} warning triggers layered procedural synthesis`
    )
    assert(
      actProbe.profile.oscTypes.length + actProbe.profile.noiseCount >= 2,
      `${hType} active triggers layered procedural synthesis`
    )
  }

  // 43c. Muted & 0%-volume subtitles, zero duplicates, reset cleanup, and pause/game-over/victory suppression for ALL 10
  const subtitleLog = []
  const auditAudio = new HorrorAudioEngine({
    volumes: { master: 0, effects: 0, ambience: 0, music: 0, muted: true },
  })
  auditAudio.setMaze(testMaze)
  auditAudio.setAudioOptions({ subtitles: true })
  const unsubAuditSubtitles = auditAudio.subscribeSubtitles((ev) => subtitleLog.push(ev))

  const playerOrigin = gridToWorld(1, 2, testMaze)
  const syntheticHazards = TEN_REALISTIC_HAZARDS.map((hType, idx) => ({
    id: `audit-h-${idx}`,
    type: hType,
    state: HAZARD_STATES.DORMANT,
    isDisposed: false,
    worldPos: { x: playerOrigin.x, y: 1.0, z: playerOrigin.z },
  }))

  // Seed initial dormant state
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards })
  assert(subtitleLog.length === 0, 'Dormant hazards emit zero subtitles')

  // Transition all 10 to WARNING -> 10 subtitles
  for (const h of syntheticHazards) h.state = HAZARD_STATES.WARNING
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards })
  assert(
    subtitleLog.length === 10,
    `All 10 realistic hazards emit distinct warning subtitles while muted/0% volume (got ${subtitleLog.length})`
  )
  // Holding WARNING must emit zero duplicates
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards })
  assert(subtitleLog.length === 10, 'Steady WARNING produces zero duplicate subtitles')

  // Transition all 10 to ACTIVE -> +10 subtitles (total 20)
  for (const h of syntheticHazards) h.state = HAZARD_STATES.ACTIVE
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards })
  assert(
    subtitleLog.length === 20,
    `All 10 realistic hazards emit distinct active subtitles while muted/0% volume (got ${subtitleLog.length})`
  )

  // Pause / GameOver / Victory must suppress all hazard subtitles
  for (const h of syntheticHazards) h.state = HAZARD_STATES.DORMANT
  auditAudio.reset()
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards })
  for (const h of syntheticHazards) h.state = HAZARD_STATES.WARNING
  auditAudio.setPaused(true)
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards })
  assert(subtitleLog.length === 20, 'Paused audio engine emits zero hazard subtitles')
  auditAudio.setPaused(false)
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards, isGameOver: true })
  assert(subtitleLog.length === 20, 'Game-over audio engine emits zero hazard subtitles')
  auditAudio.reset()
  for (const h of syntheticHazards) h.state = HAZARD_STATES.DORMANT
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards })
  for (const h of syntheticHazards) h.state = HAZARD_STATES.WARNING
  auditAudio.update(0.016, { playerWorldPos: playerOrigin, hazards: syntheticHazards, hasWon: true })
  assert(subtitleLog.length === 20, 'Victory audio engine emits zero hazard subtitles')
  unsubAuditSubtitles()
  auditAudio.dispose()

  // 43d. Steam Pipe Burst instance-owned material isolation, pipe scale integrity, and clean permanent dissipation
  const steamA = new HazardAgent(
    { id: 'audit-steam-a', type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 1, col: 2 },
    testMaze
  )
  const steamB = new HazardAgent(
    { id: 'audit-steam-b', type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 3, col: 2 },
    testMaze
  )
  const steamDataA = steamA.getMesh().userData
  const steamDataB = steamB.getMesh().userData
  assert(
    steamDataA.steamMat !== steamDataB.steamMat,
    'Each steam_pipe_burst instance owns an independent steamMat (no shared pooled material mutation)'
  )
  assert(
    steamDataA.steamPipe && steamDataA.steamPipe.scale.x === 1,
    'Steam pipe mesh stays full scale (not shrunk when dormant)'
  )
  const steamACtx = {
    playerWorldPos: gridToWorld(1, 2, testMaze),
    playerGridCell: { row: 1, col: 2 },
  }
  const sCfg = HAZARD_CONFIG[HAZARD_TYPES.STEAM_PIPE_BURST]
  steamA.update(0.05, steamACtx)
  steamA.update(sCfg.warningDuration, steamACtx)
  assert(steamDataA.steamMat.opacity > 0.7 && steamDataB.steamMat.opacity === 0, 'Active steamA does not mutate dormant steamB opacity')
  assert(steamDataA.steamPipe.scale.x === 1, 'Steam pipe mesh stays unscaled during active burst')
  steamA.update(sCfg.activeDuration, steamACtx)
  assert(
    steamA.isPermanentlyCollapsed === true &&
      steamA.getState() === HAZARD_STATES.DISABLED &&
      steamDataA.steamMat.opacity <= 0.06,
    'Permanently collapsed steam_pipe_burst transitions to DISABLED and dissipates cloud cleanly'
  )
  steamA.resetState()
  assert(
    steamA.getState() === HAZARD_STATES.DORMANT &&
      steamA.isPermanentlyCollapsed === false &&
      steamDataA.steamMat.opacity === 0,
    'steam_pipe_burst resetState restores dormant state and zero cloud opacity'
  )

  let steamMatADisposed = false
  const origSteamDispose = steamDataA.steamMat.dispose.bind(steamDataA.steamMat)
  steamDataA.steamMat.dispose = () => {
    steamMatADisposed = true
    origSteamDispose()
  }
  const poolsBeforeSteamDispose = getHazardPoolStats()
  steamA.dispose()
  steamB.dispose()
  const poolsAfterSteamDispose = getHazardPoolStats()
  assert(steamMatADisposed === true, 'Instance-owned steamMat disposed cleanly on hazard dispose')
  assert(
    steamDataA.steamMat === null && steamDataA.steamCloud === null && steamDataA.steamPipe === null,
    'steam_pipe_burst userData refs nulled on dispose'
  )
  assert(
    poolsAfterSteamDispose.geometries === poolsBeforeSteamDispose.geometries &&
      poolsAfterSteamDispose.materials === poolsBeforeSteamDispose.materials,
    'Shared hazard pools intact after steam_pipe_burst disposal'
  )
}
console.log('✓ Final comprehensive 10-hazard audit verified')

// 44. Hazard 1/10 Refinement: Ceiling Collapse Concealment, Physics, Collision & Interaction
console.log('Test 44: Refined Ceiling Collapse — Concealment, Continuous Physics, Collision, Clearance & Interaction')
{
  // A. Deterministic parity-aware placement avoids girders, ribs, center lights, and walls
  for (const [difficulty, seed] of [
    ['easy', 11223],
    ['medium', 44556],
    ['hard', 77889],
  ]) {
    const m = generateMaze({ difficulty, seed })
    const specsA = placeHazards(m)
    const specsB = placeHazards(m)
    const ceilA = specsA.find((s) => s.type === HAZARD_TYPES.CEILING_COLLAPSE)
    const ceilB = specsB.find((s) => s.type === HAZARD_TYPES.CEILING_COLLAPSE)
    assert(ceilA && ceilB, `${difficulty} maze places a ceiling_collapse hazard`)
    assert(
      ceilA.row === ceilB.row &&
        ceilA.col === ceilB.col &&
        ceilA.localPatchOffset.x === ceilB.localPatchOffset.x &&
        ceilA.localPatchOffset.z === ceilB.localPatchOffset.z,
      `${difficulty} ceiling_collapse placement & coffer bay offset are deterministic`
    )
    const offX = ceilA.localPatchOffset.x
    const offZ = ceilA.localPatchOffset.z
    const hw = ceilA.rubbleHalfW
    const hd = ceilA.rubbleHalfD
    assert(
      Math.abs(offX) + hw <= 1.78 && Math.abs(offZ) + hd <= 1.78,
      `${difficulty} ceiling_collapse stays clear of walls & pilasters`
    )
    const rowEven = ceilA.row % 2 === 0
    const colEven = ceilA.col % 2 === 0
    if (colEven) {
      assert(Math.abs(offX) - hw >= 0.39, `${difficulty} even-col ceiling_collapse avoids Z-girder`)
    }
    if (rowEven) {
      assert(Math.abs(offZ) - hd >= 0.39, `${difficulty} even-row ceiling_collapse avoids X-girder`)
    } else {
      assert(Math.abs(offZ) - hd >= 0.21, `${difficulty} odd-row ceiling_collapse avoids X-rib`)
    }
    assert(
      Math.abs(offX) - hw >= 0.41 || Math.abs(offZ) - hd >= 0.41,
      `${difficulty} ceiling_collapse avoids centered ceiling light fixture`
    )
  }

  // B. Concealment verification: NO floor marker, NO floating mid-air cubes, flush at soffitY = 3.60m
  const refineCell = { row: 1, col: 2 }
  const refineWorld = gridToWorld(refineCell.row, refineCell.col, testMaze)
  const mount = resolveCeilingCollapseMount(testMaze.grid, refineCell.row, refineCell.col)
  const cAgent = new HazardAgent(
    { id: 'ceiling-refine-1', type: HAZARD_TYPES.CEILING_COLLAPSE, ...refineCell },
    testMaze
  )
  const cMesh = cAgent.getMesh()
  const cData = cMesh.userData

  // Verify NO floor warning marker exists anywhere under the mesh when dormant
  let hasFloorMarker = false
  cMesh.updateMatrixWorld(true)
  cMesh.traverse((node) => {
    if (node.isMesh && node.visible) {
      const box = new THREE.Box3().setFromObject(node)
      if (box.min.y < 0.25 && box.max.y < 0.25) {
        hasFloorMarker = true
      }
    }
  })
  assert(!hasFloorMarker, 'Dormant ceiling_collapse has ZERO visible floor warning markers')
  assert(cData.ceilingCavityGroup.visible === false, 'Recessed ceiling cavity hidden while dormant')
  assert(cData.ceilingWarnPebbleGroup.visible === false, 'Warning pebbles hidden while dormant')
  assert(cData.ceilingDustGroup.visible === false && cData.ceilingDustMat.opacity === 0, 'Dust hidden while dormant')
  assert(
    cData.ceilingDebrisMeshes.length === 8 && cData.ceilingWarnPebbles.length === 6 && cData.ceilingDustMeshes.length === 6,
    'Debris, warning pebble, and dust counts are strictly bounded'
  )

  for (let i = 0; i < cData.ceilingDebrisMeshes.length; i += 1) {
    const dm = cData.ceilingDebrisMeshes[i]
    assert(
      dm.position.y >= MAZE_CEILING_CONFIG.soffitY - 0.12 &&
        dm.position.y <= MAZE_CEILING_CONFIG.soffitY,
      `Dormant slab ${i} sits flush at ceiling soffit (y=${dm.position.y.toFixed(3)}m, not floating at 2.4m)`
    )
    const matColor = dm.material.color.getHex()
    assert(
      matColor === MAZE_CEILING_PALETTE.deck || matColor === 0x2f405b,
      `Dormant slab ${i} matches facility concrete ceiling/deterioration palette`
    )
  }

  // C. Warning cues & continuous zero-snap transition across dormant -> warning -> active -> disabled
  updateHazardVisualState(cMesh, HAZARD_STATES.WARNING, 0.5)
  assert(cData.ceilingWarnPebbleGroup.visible === true, 'Warning pebbles activate during warning')
  assert(
    cData.ceilingDustMat.opacity > 0 && cData.ceilingDustMat.opacity <= 0.3,
    'Warning dust veil stays subtle and localized'
  )
  for (let i = 0; i < cData.ceilingWarnPebbles.length; i += 1) {
    assert(
      cData.ceilingWarnPebbles[i].position.y >= 0.01,
      `Warning pebble ${i} never passes through floor`
    )
  }

  updateHazardVisualState(cMesh, HAZARD_STATES.WARNING, 1.0)
  const endWarnYs = cData.ceilingDebrisMeshes.map((m) => m.position.y)
  updateHazardVisualState(cMesh, HAZARD_STATES.ACTIVE, 0.0)
  const startActiveYs = cData.ceilingDebrisMeshes.map((m) => m.position.y)
  for (let i = 0; i < endWarnYs.length; i += 1) {
    assert(
      Math.abs(endWarnYs[i] - startActiveYs[i]) < 0.015,
      `Slab ${i} transitions continuously from WARNING(1.0) to ACTIVE(0.0) without teleporting`
    )
  }

  // Step continuously through ACTIVE and verify no teleportation, no floor clipping, no wall clipping
  let prevSlab0Y = startActiveYs[0]
  let sawMidAirFall = false
  let minWorldVertY = Infinity
  let maxCellLocalReach = 0
  const worldBox = new THREE.Box3()
  for (let step = 1; step <= 40; step += 1) {
    const p = step / 40
    updateHazardVisualState(cMesh, HAZARD_STATES.ACTIVE, p)
    cMesh.updateMatrixWorld(true)
    const curY = cData.ceilingDebrisMeshes[0].position.y
    assert(
      Math.abs(curY - prevSlab0Y) < 0.45,
      `Slab 0 falls continuously without teleporting at p=${p.toFixed(2)} (deltaY=${Math.abs(curY - prevSlab0Y).toFixed(3)})`
    )
    if (curY > 0.6 && curY < 2.8) sawMidAirFall = true
    prevSlab0Y = curY

    for (let i = 0; i < cData.ceilingDebrisMeshes.length; i += 1) {
      const dm = cData.ceilingDebrisMeshes[i]
      worldBox.setFromObject(dm)
      if (worldBox.min.y < minWorldVertY) minWorldVertY = worldBox.min.y
      const rx = Math.max(
        Math.abs(worldBox.min.x - refineWorld.x),
        Math.abs(worldBox.max.x - refineWorld.x)
      )
      const rz = Math.max(
        Math.abs(worldBox.min.z - refineWorld.z),
        Math.abs(worldBox.max.z - refineWorld.z)
      )
      maxCellLocalReach = Math.max(maxCellLocalReach, rx, rz)
    }
  }
  assert(sawMidAirFall, 'Debris visibly falls through mid-air under gravity instead of snapping to floor')
  assert(minWorldVertY >= -0.005, `Debris vertices never penetrate floor (minY=${minWorldVertY.toFixed(4)})`)
  assert(
    maxCellLocalReach <= CELL_SIZE * 0.5 - 0.05,
    `Debris never clips adjacent corridor walls (maxReach=${maxCellLocalReach.toFixed(3)}m)`
  )

  // Verify seamless transition from ACTIVE(1.0) -> DISABLED
  const endActiveYs = cData.ceilingDebrisMeshes.map((m) => m.position.y)
  updateHazardVisualState(cMesh, HAZARD_STATES.DISABLED, 1.0)
  const disabledYs = cData.ceilingDebrisMeshes.map((m) => m.position.y)
  for (let i = 0; i < endActiveYs.length; i += 1) {
    assert(
      Math.abs(endActiveYs[i] - disabledYs[i]) < 0.01,
      `Slab ${i} transitions seamlessly from ACTIVE(1.0) to DISABLED`
    )
  }
  assert(cData.ceilingCavityGroup.visible === true, 'Exposed ceiling cavity & rebar stay visible after collapse')
  assert(cData.ceilingDustMat.opacity === 0, 'Impact dust clears once settled in DISABLED')

  // D. Precise world-space danger zone (safe on opposite side of SAME 4m tile!)
  cAgent.resetState()
  const danger = cAgent.getDangerArea()
  assert(danger && danger.radius === HAZARD_CONFIG[HAZARD_TYPES.CEILING_COLLAPSE].dangerRadius, 'getDangerArea returns precise world-space danger radius')

  // Trigger warning from directly underneath
  const directUnderPos = { x: danger.center.x, y: 0, z: danger.center.z }
  const oppositeSameTilePos = {
    x: refineWorld.x - Math.sign(mount.localPatchOffset.x || 1) * 1.15,
    y: 0,
    z: refineWorld.z - Math.sign(mount.localPatchOffset.z || -1) * 1.15,
  }
  const distOpposite = Math.hypot(
    oppositeSameTilePos.x - danger.center.x,
    oppositeSameTilePos.z - danger.center.z
  )
  assert(distOpposite > danger.radius + 0.4, 'Opposite corner of SAME 4m tile is outside precise danger radius')

  cAgent.update(0.05, { playerWorldPos: directUnderPos, playerGridCell: refineCell })
  assert(cAgent.getState() === HAZARD_STATES.WARNING, 'Approaching danger zone triggers warning')
  // Dodge to opposite side of SAME tile before warning expires -> ZERO damage!
  const dodgedHit = cAgent.update(HAZARD_CONFIG[HAZARD_TYPES.CEILING_COLLAPSE].warningDuration + 0.05, {
    playerWorldPos: oppositeSameTilePos,
    playerGridCell: refineCell,
  })
  assert(cAgent.getState() === HAZARD_STATES.ACTIVE, 'Enters ACTIVE after fair warning window')
  assert(dodgedHit === null, 'Player on opposite side of SAME 4m tile takes ZERO damage')

  // Walk onto settled rubble late in ACTIVE (after impact window) -> ZERO falling impact damage!
  const lateHit = cAgent.update(HAZARD_CONFIG[HAZARD_TYPES.CEILING_COLLAPSE].activeDuration * 0.78, {
    playerWorldPos: directUnderPos,
    playerGridCell: refineCell,
  })
  assert(lateHit === null, 'Walking into settled rubble late in ACTIVE deals ZERO falling damage')
  cAgent.update(0.5, { playerWorldPos: oppositeSameTilePos, playerGridCell: refineCell })
  assert(cAgent.getState() === HAZARD_STATES.DISABLED && cAgent.isPermanentlyCollapsed === true, 'Settles into permanent DISABLED aftermath')

  // E. Dynamic aftermath collision, >= 1.60m clearance, interaction & clearing via MazeSceneEngine
  const ceilEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  ceilEngine.setMaze(testMaze)
  ceilEngine.cancelSpawnSequence()
  ceilEngine.hazardManager.clear()
  ceilEngine.hidingSpotManager.clear()
  ceilEngine.syncHazardColliders({ allowPushOut: false })

  const eHaz = ceilEngine.hazardManager.addHazard({
    id: 'e2e-ceiling-refine',
    type: HAZARD_TYPES.CEILING_COLLAPSE,
    row: 1,
    col: 2,
  })
  ceilEngine.syncHazardColliders({ allowPushOut: false })
  const colId = 'e2e-ceiling-refine:aftermath-rubble'
  assert(
    getDynamicCollider(ceilEngine._propCollisionIndex, colId)?.enabled === false,
    'Aftermath rubble collider starts disabled while dormant'
  )

  const eDanger = eHaz.getDangerArea()
  const eSafeSide = {
    x: refineWorld.x - Math.sign(eDanger.localPatchOffset.x || 1) * 1.15,
    y: 0,
    z: refineWorld.z - Math.sign(eDanger.localPatchOffset.z || -1) * 1.15,
  }
  ceilEngine.setPlayerWorldPosition(eSafeSide.x, 0, eSafeSide.z, { immediate: true })

  // Collapse hazard and verify collider activates and meets >= 1.60m navigable clearance
  eHaz.update(0.05, { playerWorldPos: eDanger.center, playerGridCell: refineCell })
  eHaz.update(HAZARD_CONFIG[HAZARD_TYPES.CEILING_COLLAPSE].warningDuration + 0.05, {
    playerWorldPos: eSafeSide,
    playerGridCell: refineCell,
  })
  eHaz.update(HAZARD_CONFIG[HAZARD_TYPES.CEILING_COLLAPSE].activeDuration + 0.1, {
    playerWorldPos: eSafeSide,
    playerGridCell: refineCell,
  })
  ceilEngine.syncHazardColliders({ allowPushOut: true })

  const activeRubbleCol = getDynamicCollider(ceilEngine._propCollisionIndex, colId)
  assert(activeRubbleCol && activeRubbleCol.enabled === true, 'Fallen ceiling rubble registers solid dynamic collider')
  const clearanceCheck = validateHazardColliderPlacement(testMaze, activeRubbleCol, {
    index: ceilEngine._propCollisionIndex,
    ignoreOwnerId: eHaz.id,
  })
  assert(
    clearanceCheck.valid && clearanceCheck.clearance >= 2.0,
    `Ceiling rubble preserves generous corridor clearance (${clearanceCheck.clearance.toFixed(2)}m >= 2.0m)`
  )

  // Verify solid collision against fallen rubble and free passage on opposite corridor lane
  const rubbleColCheck = resolveGridCollision(eDanger.center.x, eDanger.center.z, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: ceilEngine._propCollisionIndex,
  })
  assert(rubbleColCheck.hitProp === true, 'Player physically collides with fallen ceiling rubble')

  const openPassZ = refineWorld.z - Math.sign(eDanger.localPatchOffset.z || -1) * 1.0
  const passMove = moveWithSubsteps(refineWorld.x - 1.5, openPassZ, 3.0, 0, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: ceilEngine._propCollisionIndex,
  })
  assert(passMove.hitProp === false, 'Player walks smoothly past ceiling rubble on open corridor side')

  // Verify interaction discovery, contextual prompt, wall rejection, clearing, and collider disable
  const nearRubble = { x: eDanger.center.x, y: 0, z: eDanger.center.z - Math.sign(eDanger.localPatchOffset.z || -1) * 1.25 }
  ceilEngine.setPlayerWorldPosition(nearRubble.x, 0, nearRubble.z, { immediate: true })
  ceilEngine.stepFrame(0.016, { render: false })
  const nearbyDesc = ceilEngine.getNearbyInteractable()
  assert(
    nearbyDesc &&
      nearbyDesc.kind === 'hazard' &&
      nearbyDesc.label === 'Clear Ceiling Rubble' &&
      nearbyDesc.shortLabel === 'Clear',
    'Nearby collapsed ceiling rubble surfaces Clear Ceiling Rubble prompt'
  )

  const rubblePosBeforeClear = eHaz.getMesh().userData.ceilingDebrisMeshes[0].position.clone()
  const clearRes = ceilEngine.interact()
  assert(clearRes.handled === true && clearRes.action === 'clear_rubble' && clearRes.clearAftermath === true, 'Interacting clears ceiling rubble aftermath')
  assert(
    getDynamicCollider(ceilEngine._propCollisionIndex, colId)?.enabled === false,
    'Clearing ceiling rubble disables its dynamic collider'
  )
  assert(
    eHaz.getMesh().userData.ceilingDebrisMeshes[0].position.distanceTo(rubblePosBeforeClear) > 0.1,
    'Clearing ceiling rubble visibly shifts rubble aside'
  )
  assert(ceilEngine.getNearbyInteractable() === null, 'Interaction prompt disappears once rubble is cleared')

  // Reset restores concealed ceiling & dormant collider cleanly
  ceilEngine.resetCombat()
  assert(
    eHaz.getState() === HAZARD_STATES.DORMANT &&
      eHaz.isAftermathCleared === false &&
      eHaz.getMesh().userData.isAftermathCleared === false &&
      eHaz.getMesh().userData.ceilingCavityGroup.visible === false &&
      eHaz.getMesh().userData.ceilingDebrisMeshes[0].position.y >= MAZE_CEILING_CONFIG.soffitY - 0.12 &&
      getDynamicCollider(ceilEngine._propCollisionIndex, colId)?.enabled === false,
    'resetCombat cleanly restores concealed ceiling slabs, hides cavity, and disables rubble collider'
  )

  // Disposal cleans up instance-owned dust material and preserves shared pools
  const dustMatRef = cAgent.getMesh().userData.ceilingDustMat
  let dustDisposed = false
  const origDustDispose = dustMatRef.dispose.bind(dustMatRef)
  dustMatRef.dispose = () => {
    dustDisposed = true
    origDustDispose()
  }
  const poolsBeforeCeilDispose = getHazardPoolStats()
  cAgent.dispose()
  ceilEngine.hazardManager.clear()
  const poolsAfterCeilDispose = getHazardPoolStats()
  assert(dustDisposed === true, 'Instance-owned ceilingDustMat disposed cleanly')
  assert(
    poolsAfterCeilDispose.geometries === poolsBeforeCeilDispose.geometries &&
      poolsAfterCeilDispose.materials === poolsBeforeCeilDispose.materials,
    'Shared hazard pools intact after ceiling_collapse disposal'
  )
  ceilEngine.dispose()
}
console.log('✓ Refined ceiling_collapse concealment, continuous physics, collision, clearance, interaction & disposal verified')

// 45. Refined Rotten Furniture Collapse — Wall-Side Concealment, Continuous Tipping Physics, Dormant & Aftermath Collision, Clearance & Interaction
console.log('Test 45: Refined Rotten Furniture Collapse — Wall-Side Concealment, Continuous Tipping Physics, Dormant & Aftermath Collision, Clearance & Interaction')
{
  const testMaze = generateMaze({ seed: 771234 })
  const envMats = getEnvironmentalPropMaterials()
  const envMatSet = new Set(Object.values(envMats))

  // A. Deterministic wall-side placement & structural attachment across easy, medium, and hard mazes
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const m1 = generateMaze({ seed: 551199, difficulty })
    const m2 = generateMaze({ seed: 551199, difficulty })
    const h1 = placeHazards(m1)
    const h2 = placeHazards(m2)
    const furn1 = h1.find((h) => h.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE)
    const furn2 = h2.find((h) => h.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE)
    assert(furn1 && furn2, `rotten_furniture_collapse placed in ${difficulty} maze`)
    assert(
      JSON.stringify(furn1) === JSON.stringify(furn2),
      `${difficulty} rotten_furniture_collapse placement & wall mount are deterministic`
    )
    assert(
      m1.grid[furn1.wallRow]?.[furn1.wallCol] === CELL_TYPES.WALL,
      `${difficulty} rotten_furniture_collapse mounts against an actual solid CELL_TYPES.WALL (${furn1.wallSide})`
    )
    assert(
      Math.abs(furn1.lateralOffset) + furn1.aftermathHalfW <= 1.48,
      `${difficulty} rotten_furniture_collapse stays clear of corner pilasters (±1.54m)`
    )
  }

  // B. Wall-side concealment, environmental prop material reuse, floor contact & wall contact
  const existingPropCells = new Set(
    placeEnvironmentalProps(testMaze).map((p) => `${p.row},${p.col}`)
  )
  let furnitureCell = null
  for (let r = 1; r < testMaze.grid.length - 1 && !furnitureCell; r += 1) {
    for (let c = 1; c < testMaze.grid[r].length - 1 && !furnitureCell; c += 1) {
      const isStart = r === testMaze.start?.row && c === testMaze.start?.col
      const isExit = r === testMaze.exit?.row && c === testMaze.exit?.col
      if (
        !isStart &&
        !isExit &&
        testMaze.grid[r][c] === CELL_TYPES.PATH &&
        !existingPropCells.has(`${r},${c}`)
      ) {
        const m = resolveRottenFurnitureMount(testMaze.grid, r, c)
        if (m) furnitureCell = { row: r, col: c, mount: m }
      }
    }
  }
  assert(furnitureCell !== null, 'Found valid floor cell bordering a solid wall')

  const cellWorld = gridToWorld(furnitureCell.row, furnitureCell.col, testMaze)
  const fAgent = new HazardAgent(
    {
      id: 'furniture-refine-1',
      type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
      row: furnitureCell.row,
      col: furnitureCell.col,
    },
    testMaze
  )
  const fMesh = fAgent.getMesh()
  const fData = fMesh.userData

  // Verify shared environmental prop materials are reused on cabinet & cargo meshes
  let sharedEnvMatMeshCount = 0
  fMesh.traverse((node) => {
    if (node.isMesh && envMatSet.has(node.material)) {
      sharedEnvMatMeshCount += 1
    }
  })
  assert(
    sharedEnvMatMeshCount >= 18,
    `rotten_furniture_collapse reuses shared environmental prop materials (${sharedEnvMatMeshCount} meshes)`
  )
  assert(
    fData.looseCargoMeshes.length === 4 &&
      fData.furnitureWarnSplinters.length === 6 &&
      fData.furnitureDustMeshes.length === 5,
    'Secondary cargo, warning splinter, and dust puff counts are strictly bounded'
  )
  assert(
    fData.furnitureWarnSplinterGroup.visible === false &&
      fData.furnitureDustGroup.visible === false &&
      fData.furnitureDustMat.opacity === 0,
    'Warning splinters and dust hidden while dormant'
  )

  // Verify dormant cabinet sits flush against the wall (not in corridor center!) and grounded on floor (y >= 0)
  fMesh.updateMatrixWorld(true)
  const dormantBox = new THREE.Box3()
    .setFromObject(fData.wallRemnantGroup)
    .union(new THREE.Box3().setFromObject(fData.furnitureGroup))
    .union(new THREE.Box3().setFromObject(fData.looseCargoGroup))
  assert(
    dormantBox.min.y >= -0.004 && dormantBox.min.y <= 0.025,
    `Dormant cabinet makes firm floor contact at y=0 (minY=${dormantBox.min.y.toFixed(4)}m)`
  )
  assert(
    dormantBox.max.y >= 1.28 && dormantBox.max.y <= 1.48,
    `Dormant cabinet has realistic shelving rack height (maxY=${dormantBox.max.y.toFixed(3)}m)`
  )
  const distFromCenterToOrigin = Math.hypot(
    fAgent.originWorldPos.x - cellWorld.x,
    fAgent.originWorldPos.z - cellWorld.z
  )
  assert(
    distFromCenterToOrigin >= 1.65,
    `Dormant cabinet is positioned against the wall, not in corridor center (offset=${distFromCenterToOrigin.toFixed(2)}m)`
  )

  // C. Warning cues & continuous zero-snap tipping animation across dormant -> warning -> active -> disabled
  const dormantPitch0 = fData.furnitureGroup.rotation.x
  const dormantRoll0 = fData.furnitureGroup.rotation.z

  updateHazardVisualState(fMesh, HAZARD_STATES.WARNING, 0.0)
  assert(
    Math.abs(fData.furnitureGroup.rotation.x - dormantPitch0) < 0.005 &&
      Math.abs(fData.furnitureGroup.rotation.z - dormantRoll0) < 0.005,
    'DORMANT -> WARNING(0.0) starts continuously from exact dormant support pose'
  )

  updateHazardVisualState(fMesh, HAZARD_STATES.WARNING, 0.5)
  assert(
    fData.furnitureWarnSplinterGroup.visible === true,
    'Wood splinters and rust flakes fall during warning'
  )
  assert(
    fData.furnitureDustMat.opacity > 0 && fData.furnitureDustMat.opacity <= 0.25,
    'Dry-rot dust veil stays restrained during warning'
  )
  for (let i = 0; i < fData.furnitureWarnSplinters.length; i += 1) {
    assert(
      fData.furnitureWarnSplinters[i].position.y >= 0.01,
      `Warning splinter ${i} never dips below floor`
    )
  }

  updateHazardVisualState(fMesh, HAZARD_STATES.WARNING, 1.0)
  const warnEndRotX = fData.furnitureGroup.rotation.x
  const warnEndRotZ = fData.furnitureGroup.rotation.z
  const warnEndCargoPos = fData.looseCargoMeshes.map((m) => m.position.clone())
  assert(
    warnEndRotX > dormantPitch0 + 0.05,
    'Cabinet visibly creeps forward under dry-rot strain during warning'
  )

  updateHazardVisualState(fMesh, HAZARD_STATES.ACTIVE, 0.0)
  assert(
    Math.abs(fData.furnitureGroup.rotation.x - warnEndRotX) < 0.005 &&
      Math.abs(fData.furnitureGroup.rotation.z - warnEndRotZ) < 0.005,
    'WARNING(1.0) -> ACTIVE(0.0) cabinet rotation transitions continuously without snapping'
  )
  for (let i = 0; i < warnEndCargoPos.length; i += 1) {
    assert(
      fData.looseCargoMeshes[i].position.distanceTo(warnEndCargoPos[i]) < 0.01,
      `Cargo item ${i} transitions continuously from WARNING(1.0) to ACTIVE(0.0)`
    )
  }

  // Step through ACTIVE and verify smooth tipping, cargo slide, zero floor penetration, and zero wall clipping
  let prevPitch = fData.furnitureGroup.rotation.x
  let prevCargo0Pos = fData.looseCargoMeshes[0].position.clone()
  let minFurnitureY = Infinity
  let maxWallReach = 0
  const stepBox = new THREE.Box3()
  for (let step = 1; step <= 32; step += 1) {
    const p = step / 32
    updateHazardVisualState(fMesh, HAZARD_STATES.ACTIVE, p)
    fMesh.updateMatrixWorld(true)

    const curPitch = fData.furnitureGroup.rotation.x
    assert(
      Math.abs(curPitch - prevPitch) < 0.22,
      `Cabinet tips smoothly without rotation snapping at p=${p.toFixed(2)} (dPitch=${Math.abs(curPitch - prevPitch).toFixed(3)})`
    )
    prevPitch = curPitch

    const curCargo0 = fData.looseCargoMeshes[0].position
    assert(
      curCargo0.distanceTo(prevCargo0Pos) < 0.25,
      `Cargo item 0 slides continuously without teleporting at p=${p.toFixed(2)}`
    )
    prevCargo0Pos.copy(curCargo0)

    stepBox.setFromObject(fData.furnitureGroup)
    if (stepBox.min.y < minFurnitureY) minFurnitureY = stepBox.min.y
    for (let i = 0; i < fData.looseCargoMeshes.length; i += 1) {
      stepBox.setFromObject(fData.looseCargoMeshes[i])
      if (stepBox.min.y < minFurnitureY) minFurnitureY = stepBox.min.y
      const rx = Math.max(
        Math.abs(stepBox.min.x - cellWorld.x),
        Math.abs(stepBox.max.x - cellWorld.x)
      )
      const rz = Math.max(
        Math.abs(stepBox.min.z - cellWorld.z),
        Math.abs(stepBox.max.z - cellWorld.z)
      )
      maxWallReach = Math.max(maxWallReach, rx, rz)
    }
  }
  assert(
    minFurnitureY >= -0.005,
    `Tipping cabinet and tumbling cargo never penetrate floor (minY=${minFurnitureY.toFixed(4)}m)`
  )
  assert(
    maxWallReach <= CELL_SIZE * 0.5 - 0.04,
    `Tumbling cargo stays inside corridor wall bounds (maxReach=${maxWallReach.toFixed(3)}m)`
  )

  const activeEndPitch = fData.furnitureGroup.rotation.x
  const activeEndCargoPos = fData.looseCargoMeshes.map((m) => m.position.clone())
  updateHazardVisualState(fMesh, HAZARD_STATES.DISABLED, 1.0)
  assert(
    Math.abs(fData.furnitureGroup.rotation.x - activeEndPitch) < 0.005,
    'ACTIVE(1.0) -> DISABLED cabinet rotation settles seamlessly'
  )
  for (let i = 0; i < activeEndCargoPos.length; i += 1) {
    assert(
      fData.looseCargoMeshes[i].position.distanceTo(activeEndCargoPos[i]) < 0.01,
      `Cargo item ${i} settles seamlessly from ACTIVE(1.0) into DISABLED`
    )
  }

  // D. Precise world-space danger zone (dodging to opposite side of SAME 4m tile takes 0 damage)
  fAgent.resetState()
  const fDanger = fAgent.getDangerArea()
  assert(
    fDanger && fDanger.radius === HAZARD_CONFIG[HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE].dangerRadius,
    'getDangerArea returns precise world-space danger zone matching falling furniture sweep'
  )
  const inFrontOfCabinetPos = { x: fDanger.center.x, y: 0, z: fDanger.center.z }
  const oppositeSideSameTilePos = {
    x: cellWorld.x - (fDanger.center.x - cellWorld.x),
    y: 0,
    z: cellWorld.z - (fDanger.center.z - cellWorld.z),
  }
  const distOppositeSide = Math.hypot(
    oppositeSideSameTilePos.x - fDanger.center.x,
    oppositeSideSameTilePos.z - fDanger.center.z
  )
  assert(
    distOppositeSide > fDanger.radius + 0.45,
    'Opposite side of SAME 4m corridor tile is outside falling furniture danger radius'
  )

  fAgent.update(0.05, { playerWorldPos: inFrontOfCabinetPos, playerGridCell: furnitureCell })
  assert(fAgent.getState() === HAZARD_STATES.WARNING, 'Approaching cabinet triggers warning creaks')
  const dodgeHit = fAgent.update(
    HAZARD_CONFIG[HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE].warningDuration + 0.05,
    {
      playerWorldPos: oppositeSideSameTilePos,
      playerGridCell: furnitureCell,
    }
  )
  assert(fAgent.getState() === HAZARD_STATES.ACTIVE, 'Enters ACTIVE after warning period')
  assert(dodgeHit === null, 'Stepping aside within the SAME 4m tile avoids falling furniture damage')

  // Walking onto settled fallen furniture late in ACTIVE deals 0 falling impact damage
  const settledWalkHit = fAgent.update(
    HAZARD_CONFIG[HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE].activeDuration * 0.78,
    {
      playerWorldPos: inFrontOfCabinetPos,
      playerGridCell: furnitureCell,
    }
  )
  assert(
    settledWalkHit === null,
    'Walking onto settled fallen furniture late in ACTIVE deals ZERO impact damage'
  )
  fAgent.update(0.4, { playerWorldPos: oppositeSideSameTilePos, playerGridCell: furnitureCell })
  assert(
    fAgent.getState() === HAZARD_STATES.DISABLED && fAgent.isPermanentlyCollapsed === true,
    'Settles into permanent DISABLED aftermath'
  )

  // E. Dormant & aftermath dynamic OBB colliders, >= 2.0m clearance, player push-out & Clear Fallen Furniture interaction
  const furnEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  furnEngine.setMaze(testMaze)
  furnEngine.cancelSpawnSequence()
  furnEngine.hazardManager.clear()
  furnEngine.hidingSpotManager.clear()
  furnEngine.syncHazardColliders({ allowPushOut: false })

  const eFurn = furnEngine.hazardManager.addHazard({
    id: 'e2e-furniture-refine',
    type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    row: furnitureCell.row,
    col: furnitureCell.col,
  })
  furnEngine.syncHazardColliders({ allowPushOut: false })

  const dormantColId = 'e2e-furniture-refine:dormant-furniture'
  const aftermathColId = 'e2e-furniture-refine:aftermath-furniture'
  const dormantCol = getDynamicCollider(furnEngine._propCollisionIndex, dormantColId)
  const aftermathColBefore = getDynamicCollider(furnEngine._propCollisionIndex, aftermathColId)
  assert(
    dormantCol && dormantCol.enabled === true,
    'Upright dormant furniture registers solid dynamic OBB collider so player cannot walk through it'
  )
  assert(
    aftermathColBefore && aftermathColBefore.enabled === false,
    'Aftermath furniture collider starts disabled while cabinet is upright'
  )

  // Verify dormant OBB collider matches actual upright 3D furniture footprint
  eFurn.getMesh().updateMatrixWorld(true)
  const uprightMeshBox = new THREE.Box3()
    .setFromObject(eFurn.getMesh().userData.furnitureGroup)
    .union(new THREE.Box3().setFromObject(eFurn.getMesh().userData.wallRemnantGroup))
  const uprightMeshCenterX = (uprightMeshBox.min.x + uprightMeshBox.max.x) * 0.5
  const uprightMeshCenterZ = (uprightMeshBox.min.z + uprightMeshBox.max.z) * 0.5
  assert(
    Math.hypot(dormantCol.cx - uprightMeshCenterX, dormantCol.cz - uprightMeshCenterZ) <= 0.14,
    'Dormant OBB collider center aligns closely with actual upright 3D cabinet mesh footprint'
  )

  // Verify player physically collides with upright wall-side cabinet
  const uprightHitCheck = resolveGridCollision(
    eFurn.originWorldPos.x,
    eFurn.originWorldPos.z,
    testMaze,
    {
      radius: PLAYER_RADIUS,
      propColliders: furnEngine._propCollisionIndex,
    }
  )
  assert(uprightHitCheck.hitProp === true, 'Player cannot walk through upright wall-side cabinet')

  const dormantClearance = validateHazardColliderPlacement(testMaze, dormantCol, {
    index: furnEngine._propCollisionIndex,
    ignoreOwnerId: eFurn.id,
  })
  assert(
    dormantClearance.valid && dormantClearance.clearance >= 2.0,
    `Dormant wall-side cabinet leaves generous corridor clearance (${dormantClearance.clearance.toFixed(2)}m)`
  )

  // Place player inside the falling footprint (in front of the upright cabinet) to verify safe push-out when aftermath collider activates
  const eFurnDanger = eFurn.getDangerArea()
  const frontFallFootprintPos = {
    x: cellWorld.x + (eFurnDanger.center.x - cellWorld.x) * 0.45,
    y: 0,
    z: cellWorld.z + (eFurnDanger.center.z - cellWorld.z) * 0.45,
  }
  furnEngine.setPlayerWorldPosition(
    frontFallFootprintPos.x,
    0,
    frontFallFootprintPos.z,
    { immediate: true }
  )
  eFurn.update(0.05, { playerWorldPos: eFurnDanger.center, playerGridCell: furnitureCell })
  eFurn.update(
    HAZARD_CONFIG[HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE].warningDuration + 0.05,
    {
      playerWorldPos: oppositeSideSameTilePos,
      playerGridCell: furnitureCell,
    }
  )
  // Step to activeProgress = 0.25 (< 0.42 switchover): dormant collider still active, aftermath still disabled
  eFurn.update(
    HAZARD_CONFIG[HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE].activeDuration * 0.25,
    {
      playerWorldPos: oppositeSideSameTilePos,
      playerGridCell: furnitureCell,
    }
  )
  furnEngine.syncHazardColliders({ allowPushOut: false })
  assert(
    getDynamicCollider(furnEngine._propCollisionIndex, dormantColId)?.enabled === true &&
      getDynamicCollider(furnEngine._propCollisionIndex, aftermathColId)?.enabled === false,
    'Before activeProgress=0.42, dormant collider remains enabled and aftermath collider remains disabled'
  )

  // Step past activeProgress = 0.42 to completion: dormant disables, aftermath enables and pushes player out
  eFurn.update(
    HAZARD_CONFIG[HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE].activeDuration * 0.85,
    {
      playerWorldPos: oppositeSideSameTilePos,
      playerGridCell: furnitureCell,
    }
  )
  const syncPushRes = furnEngine.syncHazardColliders({ allowPushOut: true })

  const dormantColAfter = getDynamicCollider(furnEngine._propCollisionIndex, dormantColId)
  const aftermathColAfter = getDynamicCollider(furnEngine._propCollisionIndex, aftermathColId)
  assert(
    dormantColAfter?.enabled === false && aftermathColAfter?.enabled === true,
    'Collapsing transitions solid collision from dormant upright footprint to fallen aftermath footprint'
  )

  // Verify aftermath OBB collider aligns with actual fallen 3D cabinet mesh footprint
  eFurn.getMesh().updateMatrixWorld(true)
  const fallenMeshBox = new THREE.Box3().setFromObject(
    eFurn.getMesh().userData.furnitureGroup
  )
  const fallenMeshCenterX = (fallenMeshBox.min.x + fallenMeshBox.max.x) * 0.5
  const fallenMeshCenterZ = (fallenMeshBox.min.z + fallenMeshBox.max.z) * 0.5
  assert(
    Math.hypot(aftermathColAfter.cx - fallenMeshCenterX, aftermathColAfter.cz - fallenMeshCenterZ) <=
      0.16,
    'Aftermath OBB collider center aligns closely with actual fallen 3D cabinet carcass'
  )

  const aftermathClearance = validateHazardColliderPlacement(testMaze, aftermathColAfter, {
    index: furnEngine._propCollisionIndex,
    ignoreOwnerId: eFurn.id,
  })
  const wallOnlyAftermathClearance = validateHazardColliderPlacement(testMaze, aftermathColAfter)
  assert(
    aftermathClearance.valid &&
      aftermathClearance.clearance >= 1.6 &&
      wallOnlyAftermathClearance.clearance >= 2.0,
    `Fallen furniture aftermath preserves generous navigable clearance (${aftermathClearance.clearance.toFixed(2)}m with props, ${wallOnlyAftermathClearance.clearance.toFixed(2)}m corridor)`
  )

  // Verify pushed-out player is not trapped inside collider or wall
  const pushedPlayerPos = furnEngine.getPlayerWorldPosition()
  const overlapAfterPush = resolveGridCollision(
    pushedPlayerPos.x,
    pushedPlayerPos.z,
    testMaze,
    {
      radius: furnEngine.movementConfig.radius - 1e-3,
      propColliders: furnEngine._propCollisionIndex,
    }
  )
  assert(
    syncPushRes.pushed === true &&
      overlapAfterPush.collided === false &&
      overlapAfterPush.hitProp === false,
    `Player standing in collapse footprint is safely pushed out without wall or prop clipping (pushed=${syncPushRes.pushed}, collided=${overlapAfterPush.collided}, hitProp=${overlapAfterPush.hitProp})`
  )

  // Verify player physically collides with fallen cabinet wreckage
  const fallenHitCheck = resolveGridCollision(
    eFurnDanger.center.x,
    eFurnDanger.center.z,
    testMaze,
    {
      radius: PLAYER_RADIUS,
      propColliders: furnEngine._propCollisionIndex,
    }
  )
  assert(fallenHitCheck.hitProp === true, 'Player physically collides with fallen furniture wreckage')

  // Verify contextual interaction prompt, clearing behavior, and collider disable
  const nearFallenPos = {
    x: cellWorld.x,
    y: 0,
    z: cellWorld.z,
  }
  furnEngine.setPlayerWorldPosition(nearFallenPos.x, 0, nearFallenPos.z, { immediate: true })
  furnEngine.stepFrame(0.016, { render: false })
  const furnPrompt = furnEngine.getNearbyInteractable()
  assert(
    furnPrompt &&
      furnPrompt.kind === 'hazard' &&
      furnPrompt.label === 'Clear Fallen Furniture' &&
      furnPrompt.shortLabel === 'Clear',
    'Nearby fallen furniture surfaces Clear Fallen Furniture prompt'
  )

  const carcassPosBeforeClear = eFurn.getMesh().userData.furnitureGroup.position.clone()
  const cargo0PosBeforeClear = eFurn.getMesh().userData.looseCargoMeshes[0].position.clone()
  const furnClearRes = furnEngine.interact()
  assert(
    furnClearRes.handled === true &&
      furnClearRes.action === 'clear_furniture' &&
      furnClearRes.clearAftermath === true,
    'Interacting clears fallen furniture aftermath'
  )
  assert(
    getDynamicCollider(furnEngine._propCollisionIndex, aftermathColId)?.enabled === false &&
      getDynamicCollider(furnEngine._propCollisionIndex, dormantColId)?.enabled === false,
    'Clearing fallen furniture disables its aftermath collider'
  )
  assert(
    eFurn.getMesh().userData.furnitureGroup.position.distanceTo(carcassPosBeforeClear) > 0.15 &&
      eFurn.getMesh().userData.looseCargoMeshes[0].position.distanceTo(cargo0PosBeforeClear) > 0.2,
    'Clearing fallen furniture visibly shoves cabinet carcass and spilled cargo against the wall base'
  )
  // Verify the cleared passage at eFurnDanger.center is now completely free to walk through
  const clearedPassageCheck = resolveGridCollision(
    eFurnDanger.center.x,
    eFurnDanger.center.z,
    testMaze,
    {
      radius: PLAYER_RADIUS,
      propColliders: furnEngine._propCollisionIndex,
    }
  )
  assert(
    clearedPassageCheck.hitProp === false,
    'After Clear Fallen Furniture, player can walk freely through the cleared corridor footprint'
  )
  assert(
    furnEngine.getNearbyInteractable() === null,
    'Interaction prompt disappears once fallen furniture is cleared'
  )

  // Verify resetCombat restores upright dormant cabinet and re-enables dormant collider
  furnEngine.resetCombat()
  assert(
    eFurn.getState() === HAZARD_STATES.DORMANT &&
      eFurn.isAftermathCleared === false &&
      eFurn.getMesh().userData.isAftermathCleared === false &&
      Math.abs(
        eFurn.getMesh().userData.furnitureGroup.rotation.x -
          eFurn.getMesh().userData.dormantPitch
      ) < 0.005 &&
      getDynamicCollider(furnEngine._propCollisionIndex, dormantColId)?.enabled === true &&
      getDynamicCollider(furnEngine._propCollisionIndex, aftermathColId)?.enabled === false,
    'resetCombat restores upright dormant cabinet and re-enables dormant collider'
  )

  // Verify maze replacement unregisters dynamic colliders cleanly
  const replacementMaze = generateMaze({ seed: 112233 })
  furnEngine.setMaze(replacementMaze)
  assert(
    getDynamicCollider(furnEngine._propCollisionIndex, dormantColId) === null &&
      getDynamicCollider(furnEngine._propCollisionIndex, aftermathColId) === null,
    'Maze replacement unregisters previous rotten_furniture_collapse dynamic colliders'
  )

  // Verify disposal cleans up instance-owned dust material and preserves shared hazard & environmental prop pools
  const furnDustMat = fAgent.getMesh().userData.furnitureDustMat
  let furnDustDisposed = false
  const origFurnDustDispose = furnDustMat.dispose.bind(furnDustMat)
  furnDustMat.dispose = () => {
    furnDustDisposed = true
    origFurnDustDispose()
  }
  const poolsBeforeFurnDispose = getHazardPoolStats()
  fAgent.dispose()
  furnEngine.hazardManager.clear()
  const poolsAfterFurnDispose = getHazardPoolStats()
  assert(furnDustDisposed === true, 'Instance-owned furnitureDustMat disposed cleanly')
  assert(
    poolsAfterFurnDispose.geometries === poolsBeforeFurnDispose.geometries &&
      poolsAfterFurnDispose.materials === poolsBeforeFurnDispose.materials,
    'Shared hazard pools remain intact after rotten_furniture_collapse disposal'
  )
  for (const mat of envMatSet) {
    assert(mat && typeof mat.dispose === 'function', 'Shared environmental prop material preserved')
  }
  furnEngine.dispose()
}
console.log('✓ Refined rotten_furniture_collapse wall-side concealment, continuous tipping physics, collision, clearance, interaction & disposal verified')

console.log('--- ALL ENVIRONMENTAL HAZARDS AUDIT TESTS PASSED SUCCESSFULLY! ---')
