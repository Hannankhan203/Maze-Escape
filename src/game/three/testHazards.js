import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  HAZARD_TYPES,
  placeHazards,
  CEILING_COLLAPSE_CONSTANTS,
  placeCeilingCollapseDecoys,
  ELECTRICAL_WIRING_CONSTANTS,
  placeElectricalWiringDecoys,
  STEAM_PIPE_CONSTANTS,
  placeSteamPipeDecoys,
  FALLING_PIPES_CONSTANTS,
  placeFallingPipesDecoys,
  resolveCeilingCollapseMount,
  resolveRottenFurnitureMount,
  resolveFallingPipesMount,
  resolveSteamPipeMount,
  resolveElectricalMount,
  FLOOR_GRATE_CONSTANTS,
  resolveFloorGrateOrientation,
  resolveFloorGrateMount,
  getFloorGrateOpeningRect,
  placeFloorGrateDecoys,
  resolveFloorGrateCutouts,
  WALL_COLLAPSE_CONSTANTS,
  resolveWallCollapseMount,
  placeWallCollapseDecoys,
  WATER_TANK_CONSTANTS,
  resolveWaterTankMount,
  placeWaterTankDecoys,
  SUSPENDED_MACHINERY_CONSTANTS,
  resolveSuspendedMachineryMount,
  placeSuspendedMachineryDecoys,
  VENTILATION_DUCT_CONSTANTS,
  resolveVentilationDuctMount,
  placeVentilationDuctDecoys,
} from '../generation/hazardPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { placeEnvironmentalProps, PROP_TYPES } from '../generation/environmentalPropPlacement.js'
import { createEnvironmentalPropMesh, getEnvironmentalPropMaterials } from './buildEnvironmentalProps.js'
import { MAZE_MESH_PALETTE, buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { exploreReachableCells } from '../generation/pathfinder.js'
import {
  resolveGridCollision,
  moveWithSubsteps,
  resolveSafePushOut,
  sampleTraversableObstacleHeight,
} from '../world/gridCollision.js'
import {
  getDynamicCollider,
  registerDynamicCollider,
  unregisterDynamicCollider,
  validateHazardColliderPlacement,
} from '../world/propCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import {
  HAZARD_PALETTE,
  buildFallingPipesDecoys,
  buildHazardMesh,
  getHazardPoolStats,
  stepWaterTankDecoys,
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
assert(typesSeen.size === 5, `Level 1 selects exactly 5 distinct hazard types (got ${typesSeen.size})`)
for (const legacyType of REMOVED_LEGACY_HAZARD_TYPES) {
  assert(!registeredHazardTypes.includes(legacyType), `Removed legacy hazard "${legacyType}" must not exist in HAZARD_TYPES`)
  assert(!Object.prototype.hasOwnProperty.call(HAZARD_CONFIG, legacyType), `Removed legacy hazard "${legacyType}" must not exist in HAZARD_CONFIG`)
  assert(!typesSeen.has(legacyType), `Removed legacy hazard "${legacyType}" must never be placed in any maze`)
}
for (const selectedType of typesSeen) {
  const countForType = standardHazards.filter((h) => h.type === selectedType).length
  assert(countForType >= 2, `Level 1 selected type ${selectedType} has >= 2 instances (got ${countForType})`)
}
const all10Maze = generateMaze({ seed: 314159, level: 26 })
const all10TypesSeen = new Set(all10Maze.hazards.map((h) => h.type))
for (const expectedType of registeredHazardTypes) {
  assert(all10TypesSeen.has(expectedType), `Level 26 includes ${expectedType}`)
}
console.log('✓ Zero overlapping hazards, Level 1 5-of-10 budget, Level 26 all-10 coverage, and 0 legacy types verified')

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

  // Remains continuously ACTIVE across extended duration until explicitly neutralized
  steamAgent.update(steamCfg.activeDuration * 3.0, farAwayCtx)
  assert(
    steamAgent.getState() === HAZARD_STATES.ACTIVE && steamAgent.isPermanentlyCollapsed === false,
    'Steam pipe remains persistently ACTIVE without automatic expiration'
  )

  const sealAnchor = steamAgent.getInteractionAnchor()
  const sealRes = steamAgent.interact({
    playerWorldPos: { x: sealAnchor.x, y: 0, z: sealAnchor.z },
    playerGridCell: dodgeCell,
  })
  assert(sealRes.handled === true && sealRes.action === 'seal_steam_pipe', 'Steam pipe neutralized via Seal Steam Pipe')
  assert(steamAgent.getState() === HAZARD_STATES.DISABLED, 'Steam pipe transitions to DISABLED only after sealing')
  assert(steamAgent.isPermanentlyCollapsed === true, 'Neutralized steam pipe marks itself permanently safe')
  steamAgent.dispose()
}
console.log('✓ Fair warning dodge, persistent active steam, and explicit neutralization lifecycle verified')

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
    if (
      h.type === HAZARD_TYPES.STEAM_PIPE_BURST ||
      h.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING
    ) {
      assert(
        h.getState() === HAZARD_STATES.ACTIVE && h.isPermanentlyCollapsed === false,
        `${h.type} remains persistently ACTIVE until neutralized`
      )
      const anchor = h.getInteractionAnchor() || hPos
      const res = h.interact({
        playerWorldPos: { x: anchor.x, y: 0, z: anchor.z },
        playerGridCell: { row: h.row, col: h.col },
      })
      assert(res.handled === true, `${h.type} neutralized via interaction before reset`)
    }
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
const repeatSteamHit = activeSteamAgent.update(steamCfg.activeDuration * 2.0, nearSteamCtx)
assert(activeSteamAgent.getState() === HAZARD_STATES.ACTIVE && activeSteamAgent.isPermanentlyCollapsed === false, 'Steam pipe remains persistently active without player intervention')
assert(repeatSteamHit && repeatSteamHit.damage === steamCfg.damage, 'Continuous steam hazard continues producing danger hits while player stays inside')
const sealAnchor12 = activeSteamAgent.getInteractionAnchor()
const sealRes12 = activeSteamAgent.interact({
  playerWorldPos: { x: sealAnchor12.x, y: 0, z: sealAnchor12.z },
  playerGridCell: steamCell,
})
assert(sealRes12.handled === true && activeSteamAgent.isPermanentlyCollapsed === true, 'Steam pipe enters permanent safe state when sealed')
assert(activeSteamAgent.update(1.0, nearSteamCtx) === null, 'Neutralized steam pipe produces no further updates or damage')
activeSteamAgent.dispose()
console.log('✓ Steam pipe burst warning, proximity trigger, escape dodging, continuous damage, and neutralization verified')

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
    const placed = placeHazards(m, { hazardTypes: [HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING] })
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

  // Continues ACTIVE across extended time without auto-expiring, hitting player who steps inside
  const continuousHit = wallWiringAgent.update(wiringCfg.activeDuration * 3.0, insideDangerCtx)
  assert(continuousHit && continuousHit.damage === wiringCfg.damage, 'Active discharge hits player stepping into danger area at any time')
  assert(wallWiringAgent.getState() === HAZARD_STATES.ACTIVE, 'Wiring stays persistently ACTIVE without automatic expiration')
  assert(wData.arcGroup.visible === true && wData.sparkGroup.visible === true && wData.glowMesh.visible === true, 'Persistent electrical discharge keeps arcs, sparks, and glow active')
  assert(wData.tipMat.emissiveIntensity >= 2.0, 'Persistent electrical discharge maintains high conductor glow')

  // Neutralize via F interaction -> DISABLED (insulated safe visual state)
  const insulateAnchor14 = wallWiringAgent.getInteractionAnchor()
  const insRes14 = wallWiringAgent.interact({
    playerWorldPos: { x: insulateAnchor14.x, y: 0, z: insulateAnchor14.z },
    playerGridCell: wiringCell,
  })
  assert(insRes14.handled === true && insRes14.action === 'insulate_wiring', 'Wiring insulated via Insulate Exposed Wiring interaction')
  assert(wallWiringAgent.getState() === HAZARD_STATES.DISABLED, 'Wiring transitions to permanent DISABLED state after insulation')
  assert(wallWiringAgent.isDisabled === true && wallWiringAgent.isPermanentlyCollapsed === true, 'Permanent disabled flags set')
  assert(wData.arcGroup.visible === false && wData.sparkGroup.visible === false && wData.glowMesh.visible === false, 'Insulated wiring hides arcs, sparks, and glow')
  assert(wData.insulationGroup.visible === true, 'Insulated wiring displays visible insulating sleeves over copper tips')
  assert(wData.tipMat.emissiveIntensity === 0, 'Insulated wiring clears emissive glow')

  // Standing directly near insulated wires deals NO further damage
  assert(wallWiringAgent.update(0.5, insideDangerCtx) === null, 'Neutralized wiring never damages again')
  assert(wallWiringAgent.getState() === HAZARD_STATES.DISABLED, 'Stays permanently DISABLED')

  // resetState() cleanly restores DORMANT for replay
  wallWiringAgent.resetState()
  assert(wallWiringAgent.getState() === HAZARD_STATES.DORMANT, 'resetState restores DORMANT')
  assert(wallWiringAgent.isDisabled === false && wallWiringAgent.isPermanentlyCollapsed === false, 'resetState clears disabled flags')
  wallWiringAgent.dispose()

  // Case B: Player stays INSIDE world-space danger area -> continues taking active hits until neutralized
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
  const repeatHit = hitWiringAgent.update(1.5, insideDangerCtx)
  assert(repeatHit && repeatHit.damage === wiringCfg.damage, 'Active discharge remains live and produces follow-up hits')
  const insB = hitWiringAgent.interact({
    playerWorldPos: hitWiringAgent.getInteractionAnchor(),
    playerGridCell: wiringCell,
  })
  assert(insB.handled === true && hitWiringAgent.getState() === HAZARD_STATES.DISABLED, 'Hit test transitions to DISABLED once insulated')
  assert(hitWiringAgent.update(1.0, insideDangerCtx) === null, 'Insulated wiring never damages on subsequent frames')
  hitWiringAgent.dispose()
}
console.log('✓ Exposed electrical wiring warning, world-space collision, persistent active surge, and insulation verified')

// 15. Exposed Electrical Wiring — Engine Damage, Invulnerability & Game-Over Pipeline
console.log('Test 15: Exposed Electrical Wiring Engine Damage & Invulnerability Integration')
{
  const wiringEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 1.2,
    enemies: { autoSpawn: false },
    skipSpawnSequence: true,
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

  // Neutralize before resetCombat and verify restoration
  engineWiring.update(wCfg.activeDuration, ctx)
  assert(engineWiring.getState() === HAZARD_STATES.ACTIVE, 'Wiring persists in ACTIVE across activeDuration')
  engineWiring.interact({ playerWorldPos: engineWiring.getInteractionAnchor(), playerGridCell: { row: 1, col: 2 } })
  assert(engineWiring.getState() === HAZARD_STATES.DISABLED, 'Wiring disabled after insulation before resetCombat')
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

  // Transition to DISABLED via insulation -> emits NO extra subtitle
  wiringAudioAgent.interact({
    playerWorldPos: wiringAudioAgent.getInteractionAnchor(),
    playerGridCell: { row: 1, col: 2 },
  })
  assert(wiringAudioAgent.getState() === HAZARD_STATES.DISABLED, 'Agent enters DISABLED on insulation')
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
    const placed = placeHazards(m, { hazardTypes: [HAZARD_TYPES.COLLAPSING_FLOOR_GRATE] })
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

  // Verify floor-flush geometry, recessed 0.68m pit shaft, and bounded particle/debris counts
  const grateMountCheck = resolveFloorGrateMount(testMaze.grid, 1, 2)
  const grateCheck = new HazardAgent(
    { id: 'grate-align-check', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 1, col: 2 },
    testMaze
  )
  const gMesh = grateCheck.getMesh()
  const gData = gMesh.userData
  assert(gMesh.position.y === 0, 'Grate mesh root sits flush on floor y=0')
  assert(
    gData.grateRoot &&
      Math.abs(gData.grateRoot.position.x - grateMountCheck.localPitOffset.x) < 1e-6 &&
      Math.abs(gData.grateRoot.position.z - grateMountCheck.localPitOffset.z) < 1e-6,
    'Grate assembly applies wall/bay offset for corridor clearance'
  )
  assert(gData.shaftMesh && gData.subPipeMesh && gData.curbMesh, 'Real recessed concrete shaft, subfloor pipes, and curb exist')
  assert(
    gData.pitMesh && gData.pitMesh.position.y <= -0.60,
    `Recessed pit sump sits at full shaft depth (got y=${gData.pitMesh?.position?.y})`
  )
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
  assert(
    dangerArea &&
      dangerArea.halfW === FLOOR_GRATE_CONSTANTS.colliderHalfW &&
      dangerArea.halfD === FLOOR_GRATE_CONSTANTS.colliderHalfD &&
      dangerArea.pitDepth === FLOOR_GRATE_CONSTANTS.pitDepth &&
      dangerArea.floorY === 0,
    'Danger area matches recessed floor grate pit footprint'
  )

  // Far away -> stays DORMANT indefinitely (does not collapse before player steps on it)
  const farCtx = {
    playerWorldPos: { x: grateWorld.x + 6, y: 0, z: grateWorld.z + 6 },
    playerGridCell: { row: 3, col: 3 },
  }
  for (let i = 0; i < 20; i += 1) {
    assert(grateAgent.update(0.25, farCtx) === null, 'Dormant grate deals no damage')
    assert(grateAgent.getState() === HAZARD_STATES.DORMANT, 'Grate stays DORMANT until player steps onto trigger area')
  }

  // Player on SAME grid cell along the open opposite corridor walkway -> does NOT trigger
  const offZ = grateAgent.localPitOffset?.z || 0
  const offX = grateAgent.localPitOffset?.x || 0
  const safeLaneX =
    Math.abs(offX) >= Math.abs(offZ)
      ? grateWorld.x - Math.sign(offX || 1) * 1.4
      : dangerArea.center.x
  const safeLaneZ =
    Math.abs(offZ) > Math.abs(offX)
      ? grateWorld.z - Math.sign(offZ || 1) * 1.4
      : dangerArea.center.z
  const edgeSafeCtx = {
    playerWorldPos: { x: safeLaneX, y: 0, z: safeLaneZ },
    playerGridCell: grateCell,
  }
  assert(grateAgent.update(0.1, edgeSafeCtx) === null, 'Walking past grate in adjacent corridor lane does not damage')
  assert(grateAgent.getState() === HAZARD_STATES.DORMANT, 'Player on same tile outside grate trigger OBB does not prematurely trigger grate')

  // Step onto grate -> enters WARNING with vibration, bending, loosening bolts, and falling fragments
  const onGrateCtx = {
    playerWorldPos: { x: dangerArea.center.x + 0.12, y: 0, z: dangerArea.center.z - 0.1 },
    playerGridCell: grateCell,
  }
  const gMesh = grateAgent.getMesh()
  const gData = gMesh.userData
  const initialBoltY = gData.bolts[0].position.y
  const initialLeftRotZ = gData.leftLeafGroup.rotation.z

  assert(grateAgent.update(0.1, onGrateCtx) === null, 'Initial trigger deals no premature damage')
  assert(grateAgent.getState() === HAZARD_STATES.WARNING, 'Stepping onto grate enters WARNING')
  assert(grateAgent.update(grateCfg.warningDuration * 0.55, onGrateCtx) === null, 'Mid-warning deals no damage')
  assert(gData.warningFragGroup.visible === true, 'Warning phase emits falling rust fragments into pit')
  assert(gData.leftLeafGroup.rotation.z < initialLeftRotZ - 0.03, 'Grate bends downward visibly during warning')
  assert(gData.bolts[0].position.y > initialBoltY, 'Corner bolts vibrate and loosen upward during warning')

  // Player steps off grate to safe corridor lane of SAME grid cell before collapse -> ZERO damage!
  const escapeHit = grateAgent.update(grateCfg.warningDuration * 0.5, edgeSafeCtx)
  assert(grateAgent.getState() === HAZARD_STATES.ACTIVE, 'Grate transitions to ACTIVE collapse')
  assert(escapeHit === null, 'Escaping outside world-space grate pit opening prevents damage even on same grid cell')

  // Mid-collapse animation checks: leaves dropping downward, broken stubs, debris & dust active
  assert(grateAgent.update(grateCfg.activeDuration * 0.45, edgeSafeCtx) === null, 'Player outside grate opening stays safe during collapse')
  assert(gData.leftLeafGroup.position.y < gData.grateRestY - 0.02, 'Grate leaves drop downward during collapse')
  assert(gData.leftLeafGroup.rotation.z < -0.45 && gData.rightLeafGroup.rotation.z > 0.45, 'Grate leaves swing downward into pit')
  assert(gData.brokenStubsGroup.visible === true, 'Broken rim stubs appear during collapse')
  assert(gData.debrisGroup.visible === true, 'Collapse debris shards scatter into pit and around rim')
  assert(gData.dustGroup.visible === true && gData.dustMat.opacity > 0, 'Dust burst rises during collapse')

  // Complete collapse -> permanent broken/open-grate DISABLED state
  grateAgent.update(grateCfg.activeDuration * 0.65, edgeSafeCtx)
  assert(grateAgent.getState() === HAZARD_STATES.DISABLED, 'Grate transitions permanently to DISABLED broken state')
  assert(grateAgent.isDisabled === true && grateAgent.isPermanentlyCollapsed === true, 'Permanent collapse flags set')
  const leftTipY = gData.leftLeafGroup.position.y + Math.sin(gData.leftLeafGroup.rotation.z) * 0.55
  const rightTipY = gData.rightLeafGroup.position.y - Math.sin(gData.rightLeafGroup.rotation.z) * 0.55
  assert(
    leftTipY < -0.5 && leftTipY > -0.665 && rightTipY < -0.5 && rightTipY > -0.665,
    `Collapsed grate leaves hang down inside 0.68m pit above sump floor (leftTipY=${leftTipY.toFixed(3)}, rightTipY=${rightTipY.toFixed(3)})`
  )
  assert(gData.brokenStubsGroup.visible === true && gData.debrisGroup.visible === true, 'Permanent broken stubs and settled debris remain visible')
  assert(gData.dustGroup.visible === false && gData.dustMat.opacity === 0 && gData.warningFragGroup.visible === false, 'Temporary dust and warning fragments cleaned up')

  // Standing directly over the permanently broken grate never triggers or damages again
  assert(grateAgent.update(0.5, onGrateCtx) === null, 'Permanently broken grate never damages again')
  assert(grateAgent.getState() === HAZARD_STATES.DISABLED, 'Grate remains permanently DISABLED')

  // Reset restores intact floor-flush grate with zero duplicate children
  const childCountBeforeReset = gMesh.children.length
  const rootChildCountBeforeReset = gData.grateRoot.children.length
  grateAgent.resetState()
  assert(grateAgent.getState() === HAZARD_STATES.DORMANT, 'resetState restores DORMANT')
  assert(grateAgent.isDisabled === false && grateAgent.isPermanentlyCollapsed === false, 'resetState clears disabled flags')
  assert(Math.abs(gData.leftLeafGroup.position.y - gData.grateRestY) < 1e-6, 'resetState restores leaves flush with floor')
  assert(gData.brokenStubsGroup.visible === false && gData.debrisGroup.visible === false && gData.securedCoverGroup.visible === false, 'resetState hides broken stubs, debris, and cover plate')
  assert(
    gMesh.children.length === childCountBeforeReset &&
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
    skipSpawnSequence: true,
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
    const h1 = placeHazards(m1, { hazardTypes: [HAZARD_TYPES.WALL_COLLAPSE] })
    const h2 = placeHazards(m2, { hazardTypes: [HAZARD_TYPES.WALL_COLLAPSE] })

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

  const navHazards = placeHazards(navMaze, { hazardTypes: [HAZARD_TYPES.WALL_COLLAPSE] })
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
    skipSpawnSequence: true,
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
  manager.setMaze(generateMaze({ seed: 771234 }), { hazardTypes: [HAZARD_TYPES.WALL_COLLAPSE] })
  const firstWalls = Array.from(manager.hazards.values()).filter((a) => a.type === HAZARD_TYPES.WALL_COLLAPSE)
  assert(firstWalls.length >= 1, 'HazardManager spawns wall_collapse agent for first maze')
  manager.setMaze(generateMaze({ seed: 314159 }), { hazardTypes: [HAZARD_TYPES.WALL_COLLAPSE] })
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
    const h1 = placeHazards(m1, { hazardTypes: [HAZARD_TYPES.FALLING_WATER_TANK] })
    const h2 = placeHazards(m2, { hazardTypes: [HAZARD_TYPES.FALLING_WATER_TANK] })

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
    skipSpawnSequence: true,
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
  const navSpec = placeHazards(navMaze, { hazardTypes: [HAZARD_TYPES.FALLING_WATER_TANK] }).find((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK)
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
  manager.setMaze(generateMaze({ seed: 771234 }), { hazardTypes: [HAZARD_TYPES.FALLING_WATER_TANK] })
  const firstTanks = Array.from(manager.hazards.values()).filter((a) => a.type === HAZARD_TYPES.FALLING_WATER_TANK)
  assert(firstTanks.length >= 1, 'HazardManager spawns falling_water_tank agent for first maze')
  manager.setMaze(generateMaze({ seed: 314159 }), { hazardTypes: [HAZARD_TYPES.FALLING_WATER_TANK] })
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
    const h1 = placeHazards(m1, { hazardTypes: [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY] })
    const h2 = placeHazards(m2, { hazardTypes: [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY] })

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
    skipSpawnSequence: true,
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
  const navSpec = placeHazards(navMaze, { hazardTypes: [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY] }).find((h) => h.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY)
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
  manager.setMaze(generateMaze({ seed: 771234 }), { hazardTypes: [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY] })
  const firstMachs = Array.from(manager.hazards.values()).filter(
    (a) => a.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY
  )
  assert(firstMachs.length >= 1, 'HazardManager spawns falling_suspended_machinery agent for first maze')
  manager.setMaze(generateMaze({ seed: 314159 }), { hazardTypes: [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY] })
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
    const h1 = placeHazards(m1, { hazardTypes: [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE] })
    const h2 = placeHazards(m2, { hazardTypes: [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE] })

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
      const beamLimitY = Number.isFinite(dSpec.ceilingBeamY)
        ? dSpec.ceilingBeamY
        : MAZE_CEILING_CONFIG.ribBottomY
      const minExpectedRestY =
        beamLimitY >= MAZE_CEILING_CONFIG.ribBottomY - 0.01 ? 3.08 : 2.78
      assert(
        dSpec.ceilingAnchorY >= 3.5 &&
          dSpec.ductRestY >= minExpectedRestY &&
          dSpec.ductRestY + 0.17 <= beamLimitY - 0.01,
        `Vent duct anchors beneath ceiling structure without clipping (anchorY=${dSpec.ceilingAnchorY}, restY=${dSpec.ductRestY}, beamY=${beamLimitY})`
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
    skipSpawnSequence: true,
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
  const navSpec = placeHazards(navMaze, { hazardTypes: [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE] }).find((h) => h.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE)
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
  manager.setMaze(generateMaze({ seed: 771234 }), { hazardTypes: [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE] })
  const firstDucts = Array.from(manager.hazards.values()).filter(
    (a) => a.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE
  )
  assert(firstDucts.length >= 1, 'HazardManager spawns ventilation_duct_collapse agent for first maze')
  manager.setMaze(generateMaze({ seed: 314159 }), { hazardTypes: [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE] })
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
    const m = generateMaze({ seed, level: 26 })
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
  steamA.update(sCfg.activeDuration * 3.0, steamACtx)
  assert(
    steamA.isPermanentlyCollapsed === false &&
      steamA.getState() === HAZARD_STATES.ACTIVE &&
      steamDataA.steamMat.opacity >= 0.78,
    'steam_pipe_burst continues actively emitting steam past activeDuration until sealed'
  )
  steamA.interact({ playerWorldPos: steamA.getInteractionAnchor(), playerGridCell: { row: 1, col: 2 } })
  assert(
    steamA.isPermanentlyCollapsed === true &&
      steamA.getState() === HAZARD_STATES.DISABLED &&
      steamDataA.steamMat.opacity === 0,
    'Neutralized steam_pipe_burst transitions to DISABLED and stops cloud cleanly'
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
    const specsA = placeHazards(m, { hazardTypes: [HAZARD_TYPES.CEILING_COLLAPSE] })
    const specsB = placeHazards(m, { hazardTypes: [HAZARD_TYPES.CEILING_COLLAPSE] })
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
    const h1 = placeHazards(m1, { hazardTypes: [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE] })
    const h2 = placeHazards(m2, { hazardTypes: [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE] })
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

// 46. Refined Falling Pipes & Fixtures — Wall/Ceiling Structural Mounting, Continuous Detachment Physics, Aftermath Collision, Clearance & Interaction
console.log('Test 46: Refined Falling Pipes & Fixtures — Wall/Ceiling Structural Mounting, Continuous Detachment Physics, Aftermath Collision, Clearance & Interaction')
{
  const envMats = getEnvironmentalPropMaterials()
  const envMatSet = new Set(Object.values(envMats))

  // Verify resolveFallingPipesMount adapts orientation to all 4 wall directions and ceiling junctions (never forced into X)
  const observedYaws = new Set()
  for (const side of ['north', 'south', 'east', 'west']) {
    const m = resolveFallingPipesMount(testMaze.grid, 1, 2, null, side)
    assert(
      m.mountType === 'wall' && m.wallSide === side && Number.isFinite(m.pipeYaw),
      `resolveFallingPipesMount supports ${side} wall orientation`
    )
    observedYaws.add(Number(m.pipeYaw.toFixed(3)))
  }
  assert(
    observedYaws.size === 4,
    'resolveFallingPipesMount produces 4 distinct mounting orientations matching the actual wall/corridor geometry'
  )

  // Find a walkable cell in testMaze bordering at least one solid wall (without a static prop)
  const existingPropCells = new Set(
    placeEnvironmentalProps(testMaze).map((p) => `${p.row},${p.col}`)
  )
  let pipeCell = null
  let pipeMount = null
  for (let r = 1; r < testMaze.grid.length - 1 && !pipeCell; r += 1) {
    for (let c = 1; c < testMaze.grid[0].length - 1 && !pipeCell; c += 1) {
      const isStart = r === testMaze.start?.row && c === testMaze.start?.col
      const isExit = r === testMaze.exit?.row && c === testMaze.exit?.col
      if (
        isStart ||
        isExit ||
        testMaze.grid[r][c] !== CELL_TYPES.PATH ||
        existingPropCells.has(`${r},${c}`)
      ) {
        continue
      }
      const m = resolveFallingPipesMount(testMaze.grid, r, c)
      if (
        m &&
        m.mountType === 'wall' &&
        testMaze.grid[m.wallRow]?.[m.wallCol] === CELL_TYPES.WALL
      ) {
        pipeCell = { row: r, col: c }
        pipeMount = m
      }
    }
  }

  assert(
    pipeMount &&
      pipeMount.mountType === 'wall' &&
      ['north', 'south', 'east', 'west'].includes(pipeMount.wallSide) &&
      testMaze.grid[pipeMount.wallRow]?.[pipeMount.wallCol] === CELL_TYPES.WALL,
    'resolveFallingPipesMount anchors overhead pipe run against an actual solid maze wall'
  )

  const pAgent = new HazardAgent(
    {
      id: 'pipe-refined-test',
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      ...pipeCell,
      ...pipeMount,
    },
    testMaze
  )
  const pMesh = pAgent.getMesh()
  const pData = pMesh.userData
  const cellWorld = gridToWorld(pipeCell.row, pipeCell.col, testMaze)

  assert(
    pData.pipeMountGroup &&
      pData.ceilingRemnantGroup &&
      pData.pipeGroup &&
      pData.leftStrainRod &&
      pData.rightStrainRod &&
      pData.pipeWarnFlakeGroup &&
      pData.pipeWarnFlakes?.length === 6 &&
      pData.pipeDustGroup &&
      pData.pipeDustMeshes?.length === 5 &&
      pData.pipeDustMat,
    'Refined falling_pipes_fixtures builds ceiling/wall structural mounts, straining hangers, flanged pipe & valve assembly, 6 rust flakes, and 5 dust puffs'
  )

  // Verify material reuse with ordinary facility environmental props
  let sharedEnvMatMeshCount = 0
  pData.pipeMountGroup.traverse((node) => {
    if (node.isMesh && envMatSet.has(node.material)) {
      sharedEnvMatMeshCount += 1
    }
  })
  assert(
    sharedEnvMatMeshCount >= 18,
    `Refined falling_pipes_fixtures reuses shared facility materials across ${sharedEnvMatMeshCount} submeshes`
  )

  // Verify resolveFallingPipesMount also supports open 4-way ceiling junctions without adjacent walls
  const openGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.PATH],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
  ]
  const ceilingJunctionMount = resolveFallingPipesMount(openGrid, 1, 1)
  assert(
    ceilingJunctionMount.mountType === 'ceiling' &&
      ceilingJunctionMount.wallSide === null &&
      Number.isFinite(ceilingJunctionMount.pipeYaw),
    'resolveFallingPipesMount resolves ceiling mount in open 4-way junctions without adjacent walls'
  )

  // Verify dormant structural contact: ceiling deck flanges flush with soffitY (3.60m), risers connect with zero gap, no floating ends
  pMesh.updateMatrixWorld(true)
  const remnantBox = new THREE.Box3().setFromObject(pData.ceilingRemnantGroup)
  const pipeOnlyDormantBox = new THREE.Box3().setFromObject(pData.pipeGroup)
  const dormantBox = remnantBox.clone().union(pipeOnlyDormantBox)
  assert(
    Math.abs(dormantBox.max.y - MAZE_CEILING_CONFIG.soffitY) <= 0.025 &&
      dormantBox.min.y >= 2.85 &&
      remnantBox.min.y <= pipeOnlyDormantBox.max.y + 0.01,
    `Dormant overhead pipe assembly is structurally connected up to ceiling soffit (${MAZE_CEILING_CONFIG.soffitY}m) with zero bracket gap (minY=${dormantBox.min.y.toFixed(3)}, maxY=${dormantBox.max.y.toFixed(3)})`
  )

  // Verify dormant state has zero floor obstruction collider (overhead pipe is above head height)
  const pCollidersDormant = pAgent.getColliderSpecs()
  const aftermathPipeCol = pCollidersDormant.find((c) => c.phase === 'aftermath')
  assert(
    pCollidersDormant.length === 1 &&
      aftermathPipeCol &&
      aftermathPipeCol.enabled === false,
    'Dormant overhead pipe has no floor obstruction collider while suspended overhead'
  )

  // Verify continuous detachment & fall physics (DORMANT -> WARNING -> ACTIVE -> DISABLED)
  const pDanger = pAgent.getDangerArea()
  const approachCtx = {
    playerWorldPos: { x: pDanger.center.x, y: 0, z: pDanger.center.z },
    playerGridCell: pipeCell,
  }
  const travelDirX = Math.sin(pipeMount.pipeYaw)
  const travelDirZ = Math.cos(pipeMount.pipeYaw)
  const oppositeSideSameTilePos = {
    x: cellWorld.x + travelDirX * 1.45,
    y: 0,
    z: cellWorld.z + travelDirZ * 1.45,
  }
  const safeSameTileCtx = {
    playerWorldPos: oppositeSideSameTilePos,
    playerGridCell: pipeCell,
  }

  const dormantPipePos = pData.pipeGroup.position.clone()
  const dormantPipeRot = pData.pipeGroup.rotation.clone()

  // Verify DORMANT -> WARNING(0.0) has zero initial position/rotation jump
  updateHazardVisualState(pMesh, HAZARD_STATES.WARNING, 0.0)
  assert(
    pData.pipeGroup.position.distanceTo(dormantPipePos) < 1e-5 &&
      Math.abs(pData.pipeGroup.rotation.x - dormantPipeRot.x) < 1e-5 &&
      Math.abs(pData.pipeGroup.rotation.z - dormantPipeRot.z) < 1e-5,
    'Zero position or rotation jump at DORMANT -> WARNING(0.0) transition'
  )

  // Trigger warning
  pAgent.update(0.05, approachCtx)
  assert(
    pAgent.getState() === HAZARD_STATES.WARNING,
    'Approaching within triggerRadius transitions falling_pipes_fixtures to WARNING'
  )
  assert(
    pData.pipeWarnFlakeGroup.visible === true && pData.pipeDustGroup.visible === true,
    'Warning phase shows falling rust flakes and subtle bracket dust puffs'
  )

  // Sample end of warning right before ACTIVE handoff
  updateHazardVisualState(pMesh, HAZARD_STATES.WARNING, 1.0)
  const warnEndPos = pData.pipeGroup.position.clone()
  const warnEndRot = pData.pipeGroup.rotation.clone()
  const warnEndRightRodPos = pData.rightStrainRod.position.clone()
  const warnEndLeftRodPos = pData.leftStrainRod.position.clone()
  assert(
    warnEndPos.y < dormantPipePos.y - 0.04 &&
      warnEndRot.z < dormantPipeRot.z - 0.05,
    'During warning, right hanger visibly sags downward before shearing'
  )

  // Verify zero teleportation at WARNING(1.0) -> ACTIVE(0.0) boundary (for both pipe assembly and straining hanger rods)
  updateHazardVisualState(pMesh, HAZARD_STATES.ACTIVE, 0.0)
  const activeStartPos = pData.pipeGroup.position.clone()
  const activeStartRot = pData.pipeGroup.rotation.clone()
  assert(
    warnEndPos.distanceTo(activeStartPos) < 0.005 &&
      Math.abs(warnEndRot.x - activeStartRot.x) < 0.005 &&
      Math.abs(warnEndRot.z - activeStartRot.z) < 0.005 &&
      warnEndRightRodPos.distanceTo(pData.rightStrainRod.position) < 0.005 &&
      warnEndLeftRodPos.distanceTo(pData.leftStrainRod.position) < 0.005,
    'Zero position or rotation jump at WARNING(1.0) -> ACTIVE(0.0) handoff for pipe and straining rods'
  )

  // Step through ACTIVE detachment (p = 0.05..1.0): verify smooth motion, asymmetric hinge before drop, and zero floor/wall penetration
  let prevPipePos = activeStartPos.clone()
  let maxStepDelta = 0
  let minObservedWorldY = Infinity
  for (let step = 1; step <= 20; step += 1) {
    const p = step / 20
    updateHazardVisualState(pMesh, HAZARD_STATES.ACTIVE, p)
    pMesh.updateMatrixWorld(true)
    const curPos = pData.pipeGroup.position.clone()
    const stepDelta = curPos.distanceTo(prevPipePos)
    if (stepDelta > maxStepDelta) maxStepDelta = stepDelta
    prevPipePos = curPos

    if (Math.abs(p - 0.25) < 0.01) {
      assert(
        pData.pipeGroup.rotation.z < -0.3,
        `At p=0.25, right hanger has sheared and pipe hinges tilted downward (rotZ=${pData.pipeGroup.rotation.z.toFixed(3)})`
      )
    }

    const pipeBox = new THREE.Box3().setFromObject(pData.pipeGroup)
    if (pipeBox.min.y < minObservedWorldY) minObservedWorldY = pipeBox.min.y

    pData.pipeGroup.traverse((node) => {
      if (!node.isMesh) return
      const wp = new THREE.Vector3()
      node.getWorldPosition(wp)
      const relX = wp.x - cellWorld.x
      const relZ = wp.z - cellWorld.z
      assert(
        relX >= -1.85 && relX <= 1.85 && relZ >= -1.85 && relZ <= 1.85,
        `Detaching pipe submesh stays inside corridor wall envelope at p=${p.toFixed(2)} (relX=${relX.toFixed(2)}, relZ=${relZ.toFixed(2)})`
      )
    })
  }
  assert(
    maxStepDelta < 0.55,
    `Pipe detachment and fall trajectory is continuous without teleportation (maxStepDelta=${maxStepDelta.toFixed(3)})`
  )
  assert(
    minObservedWorldY >= -0.002,
    `Falling pipe assembly never penetrates below floor y=0 (minY=${minObservedWorldY.toFixed(4)})`
  )

  // Verify zero snap between ACTIVE(1.0) and DISABLED(1.0)
  const activeEndPos = pData.pipeGroup.position.clone()
  const activeEndRot = pData.pipeGroup.rotation.clone()
  const activeEndRightRodPos = pData.rightStrainRod.position.clone()
  const activeEndLeftRodPos = pData.leftStrainRod.position.clone()
  updateHazardVisualState(pMesh, HAZARD_STATES.DISABLED, 1.0)
  const disabledPos = pData.pipeGroup.position.clone()
  const disabledRot = pData.pipeGroup.rotation.clone()
  assert(
    activeEndPos.distanceTo(disabledPos) < 0.005 &&
      Math.abs(activeEndRot.x - disabledRot.x) < 0.005 &&
      Math.abs(activeEndRot.z - disabledRot.z) < 0.005 &&
      activeEndRightRodPos.distanceTo(pData.rightStrainRod.position) < 0.005 &&
      activeEndLeftRodPos.distanceTo(pData.leftStrainRod.position) < 0.005,
    'Zero position or rotation snap at ACTIVE(1.0) -> DISABLED handoff'
  )

  // Verify direct hit inside world-space danger zone deals exact single-hit damage (30) and never repeats
  pAgent.resetState()
  pAgent.update(0.05, approachCtx)
  const directHit = pAgent.update(
    HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].warningDuration + 0.05,
    approachCtx
  )
  assert(
    directHit &&
      directHit.damage === HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].damage &&
      pAgent.update(0.15, approachCtx) === null,
    'Standing inside falling pipe impact zone deals exact single-hit damage (30) without repeating'
  )

  // Verify intra-tile dodging: player on opposite side of the SAME corridor cell takes 0 damage
  pAgent.resetState()
  pAgent.update(0.05, approachCtx)
  const dodgeHit = pAgent.update(
    HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].warningDuration + 0.05,
    safeSameTileCtx
  )
  assert(
    pAgent.getState() === HAZARD_STATES.ACTIVE && dodgeHit === null,
    'Player dodging to opposite side of same corridor cell takes 0 damage from falling pipe'
  )
  // Late active phase (progress > 0.68): walking onto settled pipe deals 0 impact damage
  const lateWalkHit = pAgent.update(
    HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].activeDuration * 0.75,
    approachCtx
  )
  assert(
    lateWalkHit === null,
    'Settled pipe after impact window (progress > 0.68) does not deal late impact damage'
  )

  // Verify engine integration: aftermath OBB collider, corridor clearance, player push-out, and "Move Fallen Pipe" interaction
  const pipeEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  pipeEngine.setMaze(testMaze)
  pipeEngine.cancelSpawnSequence()
  pipeEngine.hazardManager.clear()
  pipeEngine.syncHazardColliders({ allowPushOut: false })

  const ePipe = pipeEngine.hazardManager.addHazard({
    id: 'engine-pipe-test',
    type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    ...pipeCell,
    ...pipeMount,
  })
  pipeEngine.syncHazardColliders({ allowPushOut: false })

  const aftermathColId = 'engine-pipe-test:aftermath-pipe'
  const aftermathColDormant = getDynamicCollider(pipeEngine._propCollisionIndex, aftermathColId)
  assert(
    aftermathColDormant && aftermathColDormant.enabled === false,
    'Engine disables aftermath pipe collider while pipe is suspended overhead'
  )

  // Place player inside impact zone and collapse pipe
  const ePipeDanger = ePipe.getDangerArea()
  pipeEngine.setPlayerWorldPosition(ePipeDanger.center.x, 0, ePipeDanger.center.z, {
    immediate: true,
  })
  ePipe.update(0.05, {
    playerWorldPos: ePipeDanger.center.x ? ePipeDanger.center : cellWorld,
    playerGridCell: pipeCell,
  })
  ePipe.update(
    HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].warningDuration + 0.02,
    {
      playerWorldPos: oppositeSideSameTilePos,
      playerGridCell: pipeCell,
    }
  )
  // Before activeProgress = 0.46: aftermath collider still disabled
  ePipe.update(
    HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].activeDuration * 0.25,
    {
      playerWorldPos: oppositeSideSameTilePos,
      playerGridCell: pipeCell,
    }
  )
  pipeEngine.syncHazardColliders({ allowPushOut: false })
  assert(
    getDynamicCollider(pipeEngine._propCollisionIndex, aftermathColId)?.enabled === false,
    'Before activeProgress=0.46, aftermath pipe collider remains disabled while pipe is still falling'
  )

  // Complete fall: aftermath collider enables and pushes player out safely
  ePipe.update(
    HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].activeDuration * 0.85,
    {
      playerWorldPos: oppositeSideSameTilePos,
      playerGridCell: pipeCell,
    }
  )
  const syncPushRes = pipeEngine.syncHazardColliders({ allowPushOut: true })
  const aftermathColAfter = getDynamicCollider(pipeEngine._propCollisionIndex, aftermathColId)
  assert(
    aftermathColAfter && aftermathColAfter.enabled === true,
    'Fallen pipe activates solid aftermath OBB collider on impact'
  )

  // Verify aftermath OBB collider aligns with actual fallen 3D pipe mesh
  ePipe.getMesh().updateMatrixWorld(true)
  const fallenPipeBox = new THREE.Box3().setFromObject(ePipe.getMesh().userData.pipeGroup)
  const fallenCenterX = (fallenPipeBox.min.x + fallenPipeBox.max.x) * 0.5
  const fallenCenterZ = (fallenPipeBox.min.z + fallenPipeBox.max.z) * 0.5
  assert(
    Math.hypot(aftermathColAfter.cx - fallenCenterX, aftermathColAfter.cz - fallenCenterZ) <= 0.14,
    'Aftermath pipe OBB collider center aligns closely with actual fallen 3D pipe assembly'
  )

  const aftermathClearance = validateHazardColliderPlacement(testMaze, aftermathColAfter, {
    index: pipeEngine._propCollisionIndex,
    ignoreOwnerId: ePipe.id,
  })
  assert(
    aftermathClearance.valid === true && aftermathColAfter.allowCorridorBlock === true,
    `Fallen transverse pipe collider stays cleanly inside walkable corridor bounds without wall penetration (reason=${aftermathClearance.reason})`
  )
  // Verify transverse fallen pipe blocks walking through left, center, and right lanes before Move Fallen Pipe (F)
  const pipeSpanDirX = Math.cos(pipeMount.pipeYaw)
  const pipeSpanDirZ = -Math.sin(pipeMount.pipeYaw)
  for (const laneOffset of [-1.1, 0, 1.1]) {
    const startX = cellWorld.x - travelDirX * 1.55 + pipeSpanDirX * laneOffset
    const startZ = cellWorld.z - travelDirZ * 1.55 + pipeSpanDirZ * laneOffset
    const walkAttempt = moveWithSubsteps(
      startX,
      startZ,
      travelDirX * 3.1,
      travelDirZ * 3.1,
      testMaze,
      {
        radius: PLAYER_RADIUS,
        propColliders: pipeEngine._propCollisionIndex,
      }
    )
    const progressAlongTravel =
      (walkAttempt.x - cellWorld.x) * travelDirX + (walkAttempt.z - cellWorld.z) * travelDirZ
    assert(
      walkAttempt.hitProp === true && progressAlongTravel < -0.5,
      `Fallen transverse pipe blocks lane offset ${laneOffset.toFixed(1)}m before interaction (progress=${progressAlongTravel.toFixed(2)})`
    )
  }

  const pushedPos = pipeEngine.getPlayerWorldPosition()
  const overlapAfterPush = resolveGridCollision(pushedPos.x, pushedPos.z, testMaze, {
    radius: pipeEngine.movementConfig.radius - 1e-3,
    propColliders: pipeEngine._propCollisionIndex,
  })
  assert(
    syncPushRes.pushed === true &&
      overlapAfterPush.collided === false &&
      overlapAfterPush.hitProp === false,
    'Player in fallen pipe footprint is safely pushed out without wall or prop clipping'
  )

  // Verify player physically collides with fallen pipe assembly
  const fallenPipeHitCheck = resolveGridCollision(
    ePipeDanger.center.x,
    ePipeDanger.center.z,
    testMaze,
    {
      radius: PLAYER_RADIUS,
      propColliders: pipeEngine._propCollisionIndex,
    }
  )
  assert(fallenPipeHitCheck.hitProp === true, 'Player physically collides with fallen pipe assembly')

  // Verify contextual interaction prompt "Move Fallen Pipe", visual roll to wall base, and collider disable
  pipeEngine.setPlayerWorldPosition(cellWorld.x, 0, cellWorld.z, { immediate: true })
  pipeEngine.stepFrame(0.016, { render: false })
  const pipePrompt = pipeEngine.getNearbyInteractable()
  assert(
    pipePrompt &&
      pipePrompt.kind === 'hazard' &&
      pipePrompt.label === 'Move Fallen Pipe' &&
      pipePrompt.shortLabel === 'Move',
    'Nearby fallen pipe surfaces Move Fallen Pipe interaction prompt'
  )

  const pipePosBeforeMove = ePipe.getMesh().userData.pipeGroup.position.clone()
  const pipeMoveRes = pipeEngine.interact()
  assert(
    pipeMoveRes.handled === true &&
      pipeMoveRes.action === 'clear_pipe' &&
      pipeMoveRes.clearAftermath === true,
    'Interacting executes clear_pipe and clears fallen pipe aftermath'
  )
  assert(
    getDynamicCollider(pipeEngine._propCollisionIndex, aftermathColId)?.enabled === false,
    'Moving fallen pipe disables its aftermath collider'
  )
  assert(
    ePipe.getMesh().userData.pipeGroup.position.distanceTo(pipePosBeforeMove) > 0.45,
    'Moving fallen pipe visibly rolls the pipe assembly flush against the wall base'
  )
  const clearedPassageCheck = resolveGridCollision(
    ePipeDanger.center.x,
    ePipeDanger.center.z,
    testMaze,
    {
      radius: PLAYER_RADIUS,
      propColliders: pipeEngine._propCollisionIndex,
    }
  )
  assert(
    clearedPassageCheck.hitProp === false && pipeEngine.getNearbyInteractable() === null,
    'After Move Fallen Pipe, corridor footprint is freely walkable and prompt is cleared'
  )

  // Verify resetCombat restores overhead dormant pipe and disables aftermath collider
  pipeEngine.resetCombat()
  assert(
    ePipe.getState() === HAZARD_STATES.DORMANT &&
      ePipe.isAftermathCleared === false &&
      ePipe.getMesh().userData.isAftermathCleared === false &&
      Math.abs(ePipe.getMesh().userData.pipeGroup.position.y - ePipe.pipeRestY) < 1e-4 &&
      getDynamicCollider(pipeEngine._propCollisionIndex, aftermathColId)?.enabled === false,
    'resetCombat restores dormant overhead pipe mount and disables aftermath collider'
  )

  // Verify maze replacement unregisters dynamic colliders
  const replacementMaze = generateMaze({ seed: 445566 })
  pipeEngine.setMaze(replacementMaze)
  assert(
    getDynamicCollider(pipeEngine._propCollisionIndex, aftermathColId) === null,
    'Maze replacement unregisters previous falling_pipes_fixtures dynamic collider'
  )

  // Verify disposal cleans up instance-owned pipeDustMat and preserves shared pools
  const pipeDustMat = pAgent.getMesh().userData.pipeDustMat
  let pipeDustDisposed = false
  const origPipeDustDispose = pipeDustMat.dispose.bind(pipeDustMat)
  pipeDustMat.dispose = () => {
    pipeDustDisposed = true
    origPipeDustDispose()
  }
  const poolsBeforePipeDispose = getHazardPoolStats()
  pAgent.dispose()
  pipeEngine.hazardManager.clear()
  const poolsAfterPipeDispose = getHazardPoolStats()
  assert(pipeDustDisposed === true, 'Instance-owned pipeDustMat disposed cleanly')
  assert(
    poolsAfterPipeDispose.geometries === poolsBeforePipeDispose.geometries &&
      poolsAfterPipeDispose.materials === poolsBeforePipeDispose.materials,
    'Shared hazard pools remain intact after falling_pipes_fixtures disposal'
  )
  for (const mat of envMatSet) {
    assert(mat && typeof mat.dispose === 'function', 'Shared environmental prop material preserved')
  }
  pipeEngine.dispose()
}
console.log('✓ Refined falling_pipes_fixtures wall/ceiling structural mounting, continuous detachment physics, collision, clearance, interaction & disposal verified')

// 47. Hazard 4/10 Refinement: Steam Pipe Burst — Wall/Ceiling Structural Integration, Continuous Plume Physics, Precise Plume Damage, Shut Off Steam Valve Interaction & Disposal
console.log('Test 47: Refined Steam Pipe Burst — Wall/Ceiling Structural Integration, Continuous Plume Physics, Precise Plume Damage, Shut Off Steam Valve Interaction & Disposal')
{
  const envMats = getEnvironmentalPropMaterials()
  const envMatSet = new Set([
    envMats.rustyMetal,
    envMats.darkSteel,
    envMats.cableBlack,
    envMats.warningYellow,
  ])

  // A. Deterministic wall/ceiling mounting alignment & structural integration across difficulty seeds
  for (const [difficulty, seed] of [
    ['easy', 11223],
    ['medium', 44556],
    ['hard', 77889],
  ]) {
    const m = generateMaze({ difficulty, seed })
    const specsA = placeHazards(m, { hazardTypes: [HAZARD_TYPES.STEAM_PIPE_BURST] })
    const specsB = placeHazards(m, { hazardTypes: [HAZARD_TYPES.STEAM_PIPE_BURST] })
    const steamA = specsA.find((s) => s.type === HAZARD_TYPES.STEAM_PIPE_BURST)
    const steamB = specsB.find((s) => s.type === HAZARD_TYPES.STEAM_PIPE_BURST)
    assert(steamA && steamB, `${difficulty} maze places a steam_pipe_burst hazard`)
    assert(
      steamA.row === steamB.row &&
        steamA.col === steamB.col &&
        steamA.mountType === steamB.mountType &&
        steamA.wallSide === steamB.wallSide &&
        steamA.steamYaw === steamB.steamYaw &&
        steamA.localRuptureOffset.x === steamB.localRuptureOffset.x &&
        steamA.localRuptureOffset.z === steamB.localRuptureOffset.z &&
        steamA.localValveOffset.x === steamB.localValveOffset.x &&
        steamA.localValveOffset.z === steamB.localValveOffset.z &&
        steamA.localImpactOffset.x === steamB.localImpactOffset.x &&
        steamA.localImpactOffset.z === steamB.localImpactOffset.z,
      `${difficulty} steam_pipe_burst placement, mountType, yaw, rupture, valve, and plume offsets are deterministic`
    )
    if (steamA.mountType === 'wall') {
      assert(
        m.grid[steamA.wallRow]?.[steamA.wallCol] === CELL_TYPES.WALL,
        `${difficulty} steam_pipe_burst wall mount attaches to an actual adjacent WALL cell (${steamA.wallRow},${steamA.wallCol})`
      )
    }
  }

  // Verify resolveSteamPipeMount handles both wall-backed corridor cells and open 4-way ceiling junctions
  const openJunctionGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.PATH],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
  ]
  const ceilingSteamMount = resolveSteamPipeMount(openJunctionGrid, 1, 1)
  assert(
    ceilingSteamMount.mountType === 'ceiling' && ceilingSteamMount.wallSide === null,
    'Open 4-way intersection falls back to ceiling-hung steam pipe manifold'
  )

  // Verify non-default corridor orientation (East-West wall side -> yaw = ±PI/2, not forced X orientation)
  const nsCorridorGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
  ]
  const nsSteamMount = resolveSteamPipeMount(nsCorridorGrid, 1, 1)
  assert(
    nsSteamMount.mountType === 'wall' &&
      (nsSteamMount.wallSide === 'west' || nsSteamMount.wallSide === 'east') &&
      Math.abs(Math.abs(nsSteamMount.steamYaw) - Math.PI * 0.5) < 1e-6,
    'North-South corridor mounts steam pipe along East/West wall with ±90deg yaw (never forced into X orientation)'
  )

  // B. Concealment, environmental material reuse, zero floating disconnected center pipe, and zero solid steam collider
  const steamSpec = {
    id: 'test-47-steam',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: 1,
    col: 2,
    wallSide: 'north',
  }
  const sAgent = new HazardAgent(steamSpec, testMaze)
  const sMesh = sAgent.getMesh()
  const sData = sMesh.userData

  assert(
    sAgent.getColliderSpecs().length === 0,
    'steam_pipe_burst registers zero solid colliders for the steam cloud'
  )
  assert(
    sData.steamMountGroup &&
      sData.steamSupportGroup &&
      sData.steamGroup &&
      sData.steamPipe &&
      sData.ruptureFlangeGroup &&
      sData.valveWheelMesh &&
      sData.condensationGroup &&
      sData.steamPlumeGroup &&
      sData.steamCloud,
    'steam_pipe_burst builds complete wall/ceiling risers, brackets, valve handwheel, bolted union flange, condensation, and plume hierarchy'
  )

  // Verify shared environmental material reuse on pipework and fittings
  let sharedEnvMatCount = 0
  sData.steamSupportGroup.traverse((node) => {
    if (node.isMesh && envMatSet.has(node.material)) {
      sharedEnvMatCount += 1
    }
  })
  sData.steamGroup.traverse((node) => {
    if (node.isMesh && envMatSet.has(node.material)) {
      sharedEnvMatCount += 1
    }
  })
  assert(
    sharedEnvMatCount >= 18,
    `steam_pipe_burst reuses shared environmental pipe materials across ${sharedEnvMatCount} meshes`
  )

  // Verify dormant geometry is anchored to the wall, floor, and ceiling soffit (not floating centered at z=0)
  sMesh.updateMatrixWorld(true)
  const supportBox = new THREE.Box3().setFromObject(sData.steamSupportGroup)
  const cellCenter = gridToWorld(1, 2, testMaze)
  const localMinZ = supportBox.min.z - cellCenter.z
  const localMaxZ = supportBox.max.z - cellCenter.z
  assert(
    supportBox.min.y <= 0.01 &&
      supportBox.max.y >= 3.58 &&
      localMinZ <= -1.94 &&
      localMaxZ <= -1.55,
    `Dormant steam pipework spans floor (${supportBox.min.y.toFixed(3)}m) to ceiling (${supportBox.max.y.toFixed(3)}m) flush against wall (${localMinZ.toFixed(3)}..${localMaxZ.toFixed(3)}m), leaving center corridor clear`
  )
  assert(
    sData.steamCloud.visible === false &&
      sData.steamMat.opacity === 0 &&
      sData.condensationGroup.visible === false,
    'Dormant steam_pipe_burst hides steam plume and condensation completely'
  )

  // C. Continuous C0 warning & burst physics, flange separation, condensation, and strict room/wall bounds
  updateHazardVisualState(sMesh, 'dormant', 0)
  const dormantPipePos = sData.steamGroup.position.clone()
  const dormantCloudPos = sData.steamCloud.position.clone()
  const dormantCloudScale = sData.steamCloud.scale.clone()
  const dormantLeftFlangeX = sData.leftUnionPlate.position.x
  const dormantRightFlangeX = sData.rightUnionPlate.position.x

  updateHazardVisualState(sMesh, 'warning', 0)
  assert(
    sData.steamGroup.position.distanceTo(dormantPipePos) < 1e-6 &&
      sData.steamCloud.position.distanceTo(dormantCloudPos) < 1e-6 &&
      sData.steamCloud.scale.distanceTo(dormantCloudScale) < 1e-6 &&
      Math.abs(sData.steamMat.opacity) < 1e-6,
    'Transition from DORMANT to WARNING(0.0) has zero position, scale, or opacity snap'
  )

  let prevCloudPos = sData.steamCloud.position.clone()
  let prevCloudScale = sData.steamCloud.scale.clone()
  let prevOpacity = sData.steamMat.opacity
  const warnSteps = 20
  for (let i = 1; i <= warnSteps; i += 1) {
    const p = i / warnSteps
    updateHazardVisualState(sMesh, 'warning', p)
    const curPos = sData.steamCloud.position
    const curScale = sData.steamCloud.scale
    assert(
      curPos.distanceTo(prevCloudPos) < 0.08 &&
        curScale.distanceTo(prevCloudScale) < 0.08 &&
        Math.abs(sData.steamMat.opacity - prevOpacity) < 0.08,
      `WARNING(${p.toFixed(2)}) advances steam leakage smoothly without snapping`
    )
    prevCloudPos = curPos.clone()
    prevCloudScale = curScale.clone()
    prevOpacity = sData.steamMat.opacity
  }

  assert(
    sData.leftUnionPlate.position.x < dormantLeftFlangeX - 0.004 &&
      sData.rightUnionPlate.position.x > dormantRightFlangeX + 0.004 &&
      sData.condensationGroup.visible === true,
    'Warning phase visibly separates union flange plates and emits dripping condensation'
  )

  const warnEndCloudPos = sData.steamCloud.position.clone()
  const warnEndCloudScale = sData.steamCloud.scale.clone()
  const warnEndOpacity = sData.steamMat.opacity
  const warnEndLobePos = sData.plumeLobeMeshes.map((l) => l.position.clone())
  const warnEndLobeScale = sData.plumeLobeMeshes.map((l) => l.scale.clone())

  updateHazardVisualState(sMesh, 'active', 0)
  assert(
    sData.steamCloud.position.distanceTo(warnEndCloudPos) < 1e-6 &&
      sData.steamCloud.scale.distanceTo(warnEndCloudScale) < 1e-6 &&
      Math.abs(sData.steamMat.opacity - warnEndOpacity) < 1e-6,
    'Transition from WARNING(1.0) to ACTIVE(0.0) is 100% C0 continuous (zero pop or jump)'
  )
  for (let i = 0; i < sData.plumeLobeMeshes.length; i += 1) {
    assert(
      sData.plumeLobeMeshes[i].position.distanceTo(warnEndLobePos[i]) < 1e-6 &&
        sData.plumeLobeMeshes[i].scale.distanceTo(warnEndLobeScale[i]) < 1e-6,
      `Plume lobe ${i} transitions from WARNING(1.0) to ACTIVE(0.0) with zero discontinuity`
    )
  }

  let peakOpacity = 0
  let minSustainedOpacity = Infinity
  let maxOutwardReachZ = -Infinity
  const activeSteps = 60
  for (let i = 1; i <= activeSteps; i += 1) {
    // Test through p = 0 -> 3.0 to prove continuous billowing indefinitely past activeDuration
    const p = (i / activeSteps) * 3.0
    updateHazardVisualState(sMesh, 'active', p)
    const curPos = sData.steamCloud.position
    const curScale = sData.steamCloud.scale
    assert(
      curPos.distanceTo(prevCloudPos) < 0.25 &&
        curScale.distanceTo(prevCloudScale) < 0.28 &&
        Math.abs(sData.steamMat.opacity - prevOpacity) < 0.14,
      `ACTIVE(${p.toFixed(2)}) advances continuous billowing plume smoothly without snaps`
    )
    if (sData.steamMat.opacity > peakOpacity) {
      peakOpacity = sData.steamMat.opacity
    }
    if (p >= 0.4 && sData.steamMat.opacity < minSustainedOpacity) {
      minSustainedOpacity = sData.steamMat.opacity
    }

    sMesh.updateMatrixWorld(true)
    const plumeBox = new THREE.Box3().setFromObject(sData.steamPlumeGroup)
    const relMinX = plumeBox.min.x - cellCenter.x
    const relMaxX = plumeBox.max.x - cellCenter.x
    const relMinZ = plumeBox.min.z - cellCenter.z
    const relMaxZ = plumeBox.max.z - cellCenter.z
    if (relMaxZ > maxOutwardReachZ) {
      maxOutwardReachZ = relMaxZ
    }
    assert(
      relMinX >= -1.85 &&
        relMaxX <= 1.85 &&
        relMinZ >= -1.85 &&
        relMaxZ <= 0.74 &&
        plumeBox.min.y >= 0.02 &&
        plumeBox.max.y <= 3.55,
      `ACTIVE(${p.toFixed(2)}) steam plume stays inside corridor bounds & leaves opposite lane clear (x:[${relMinX.toFixed(2)},${relMaxX.toFixed(2)}], z:[${relMinZ.toFixed(2)},${relMaxZ.toFixed(2)}])`
    )

    prevCloudPos = curPos.clone()
    prevCloudScale = curScale.clone()
    prevOpacity = sData.steamMat.opacity
  }

  assert(
    peakOpacity >= 0.84 && minSustainedOpacity >= 0.78 && maxOutwardReachZ >= 0.45,
    `Steam burst reaches continuous full coverage across corridor center (peak=${peakOpacity.toFixed(2)}, minSustained=${minSustainedOpacity.toFixed(2)}, maxZ=${maxOutwardReachZ.toFixed(2)})`
  )

  // Verify sealed aftermath shows bolted repair patch & clears steam completely
  sData.isAftermathCleared = true
  updateHazardVisualState(sMesh, 'disabled', 1)
  assert(
    sData.repairPatchGroup &&
      sData.repairPatchGroup.visible === true &&
      sData.steamCloud.visible === false &&
      sData.steamMat.opacity === 0 &&
      Math.abs(sData.valveWheelMesh.rotation.z + Math.PI * 0.75) < 1e-4,
    'Sealed steam pipe visually displays bolted repair patch clamp, closes handwheel, and hides steam'
  )
  sData.isAftermathCleared = false

  // D. Side-dependent corridor danger coverage (right-side vs left-side vs north vs south) & wall LOS
  sAgent.resetState()
  const dangerInfo = sAgent.getDangerArea()
  assert(
    dangerInfo &&
      dangerInfo.center &&
      dangerInfo.origin &&
      dangerInfo.valve &&
      Math.abs(dangerInfo.radius - 1.28) < 1e-6 &&
      Math.abs(dangerInfo.triggerRadius - 2.15) < 1e-6 &&
      dangerInfo.dangerMaxLocalZ === 0.74,
    'getDangerArea returns accurate world-space plume center, rupture origin, lane envelope bounds, and radii'
  )

  // Right-side N-S pipe ('east') covers right lane & center, leaving ONLY far-left ('west') safe;
  // Left-side N-S pipe ('west') covers left lane & center, leaving ONLY far-right ('east') safe.
  const nsCorridorTestGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
  ]
  const nsTestMaze = { ...testMaze, rows: 5, cols: 3, grid: nsCorridorTestGrid }
  const nsCellWorld = gridToWorld(2, 1, nsTestMaze)

  // 1) Right-side pipe ('east' wall, at x = +1.8m jetting west)
  const rightSideSteam = new HazardAgent(
    { id: 'steam-right-side', type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 2, col: 1, wallSide: 'east' },
    nsTestMaze
  )
  rightSideSteam.state = HAZARD_STATES.ACTIVE
  rightSideSteam.timer = 0.25
  assert(
    rightSideSteam.update(0.05, { playerWorldPos: { x: nsCellWorld.x + 1.15, y: 0, z: nsCellWorld.z }, playerGridCell: { row: 2, col: 1 } }) !== null,
    'Right-side steam pipe hits player in right-side walking lane'
  )
  assert(
    rightSideSteam.update(0.05, { playerWorldPos: { x: nsCellWorld.x, y: 0, z: nsCellWorld.z }, playerGridCell: { row: 2, col: 1 } }) !== null,
    'Right-side steam pipe hits player in corridor center'
  )
  assert(
    rightSideSteam.update(0.05, { playerWorldPos: { x: nsCellWorld.x - 1.15, y: 0, z: nsCellWorld.z }, playerGridCell: { row: 2, col: 1 } }) === null,
    'Right-side steam pipe leaves far-left lane safe'
  )
  rightSideSteam.dispose()

  // 2) Left-side pipe ('west' wall, at x = -1.8m jetting east)
  const leftSideSteam = new HazardAgent(
    { id: 'steam-left-side', type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 2, col: 1, wallSide: 'west' },
    nsTestMaze
  )
  leftSideSteam.state = HAZARD_STATES.ACTIVE
  leftSideSteam.timer = 0.25
  assert(
    leftSideSteam.update(0.05, { playerWorldPos: { x: nsCellWorld.x - 1.15, y: 0, z: nsCellWorld.z }, playerGridCell: { row: 2, col: 1 } }) !== null,
    'Left-side steam pipe hits player in left-side walking lane'
  )
  assert(
    leftSideSteam.update(0.05, { playerWorldPos: { x: nsCellWorld.x, y: 0, z: nsCellWorld.z }, playerGridCell: { row: 2, col: 1 } }) !== null,
    'Left-side steam pipe hits player in corridor center'
  )
  assert(
    leftSideSteam.update(0.05, { playerWorldPos: { x: nsCellWorld.x + 1.15, y: 0, z: nsCellWorld.z }, playerGridCell: { row: 2, col: 1 } }) === null,
    'Left-side steam pipe leaves far-right lane safe'
  )
  leftSideSteam.dispose()

  // 3) North-wall steam fair dodge to opposite South lane + persistent damage
  const triggerCtx = {
    playerWorldPos: { x: dangerInfo.center.x, y: 0, z: dangerInfo.center.z },
    playerGridCell: { row: 1, col: 2 },
  }
  const safeOppositeWallCtx = {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z + 1.15 },
    playerGridCell: { row: 1, col: 2 },
  }
  sAgent.update(0.05, triggerCtx)
  assert(sAgent.getState() === HAZARD_STATES.WARNING, 'Player approaching the steam line triggers WARNING state')

  const dodgeHit = sAgent.update(sAgent.config.warningDuration, safeOppositeWallCtx)
  assert(
    sAgent.getState() === HAZARD_STATES.ACTIVE && dodgeHit === null,
    'Player dodging to the far opposite lane of the same corridor tile takes 0 damage on steam burst'
  )

  const directBurstHit = sAgent.update(0.2, triggerCtx)
  assert(
    directBurstHit && directBurstHit.damage === 30 && directBurstHit.type === HAZARD_TYPES.STEAM_PIPE_BURST,
    'Player inside the active steam plume envelope takes 30 scalding damage'
  )
  // After activeDuration * 4, steam is STILL active and hitting center lane
  const persistentLaterHit = sAgent.update(sAgent.config.activeDuration * 4.0, {
    playerWorldPos: { x: cellCenter.x, y: 0, z: cellCenter.z },
    playerGridCell: { row: 1, col: 2 },
  })
  assert(
    sAgent.getState() === HAZARD_STATES.ACTIVE &&
      persistentLaterHit &&
      persistentLaterHit.damage === 30,
    'Persistent steam remains ACTIVE past nominal cycle duration and covers corridor center'
  )

  // E. "Seal Steam Pipe" post-activation interaction, engine damageImmunityTimer repeated-hit rules, re-entry vulnerability, wall occlusion & disposal
  const existingPropCells = new Set(
    placeEnvironmentalProps(testMaze).map((p) => `${p.row},${p.col}`)
  )
  const startKey = `${testMaze.start?.row},${testMaze.start?.col}`
  const exitKey = `${testMaze.exit?.row},${testMaze.exit?.col}`
  let steamCell = null
  for (let r = 1; r < testMaze.rows - 1; r += 1) {
    for (let c = 1; c < testMaze.cols - 1; c += 1) {
      if (testMaze.grid[r][c] !== CELL_TYPES.PATH) continue
      const key = `${r},${c}`
      if (key === startKey || key === exitKey || existingPropCells.has(key)) continue
      const m = resolveSteamPipeMount(testMaze.grid, r, c)
      if (m.mountType === 'wall' && m.wallSide) {
        steamCell = { row: r, col: c, wallSide: m.wallSide }
        break
      }
    }
    if (steamCell) break
  }
  if (!steamCell) {
    steamCell = { row: 1, col: 2, wallSide: 'north' }
  }

  const steamEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 0.6,
    enemies: { autoSpawn: false },
  })
  steamEngine.setMaze(testMaze)
  steamEngine.cancelSpawnSequence()
  steamEngine.hazardManager.clear()
  steamEngine.syncHazardColliders({ allowPushOut: false })

  const eSteam = steamEngine.hazardManager.addHazard({
    id: 'engine-steam-47',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: steamCell.row,
    col: steamCell.col,
    wallSide: steamCell.wallSide,
  })
  steamEngine.syncHazardColliders({ allowPushOut: false })

  const eDanger = eSteam.getDangerArea()
  const steamCellWorld = gridToWorld(steamCell.row, steamCell.col, testMaze)
  const safeLanePos = {
    x: steamCellWorld.x + eSteam.ruptureDir.x * 1.15,
    y: 0,
    z: steamCellWorld.z + eSteam.ruptureDir.z * 1.15,
  }

  // 1) DORMANT: no F prompt before activation
  steamEngine.setPlayerWorldPosition(steamCellWorld.x, 0, steamCellWorld.z, { immediate: true })
  assert(
    steamEngine.getNearbyInteractable() === null &&
      eSteam.canPlayerInteract(eDanger.origin, steamCell) === false,
    'Dormant steam_pipe_burst exposes zero F interaction before triggering'
  )

  // 2) WARNING: no F prompt before activation (pre-trigger neutralization removed)
  steamEngine.stepFrame(0.05, { render: false })
  assert(eSteam.getState() === HAZARD_STATES.WARNING, 'Approaching steam_pipe_burst triggers WARNING state')
  assert(
    steamEngine.getNearbyInteractable() === null &&
      eSteam.canPlayerInteract(eDanger.origin, steamCell) === false,
    'WARNING steam_pipe_burst exposes zero F interaction before activation'
  )

  // 3) Advance into ACTIVE while player stays inside center danger zone -> initial damage + immunity window
  steamEngine.stepFrame(eSteam.config.warningDuration + 0.05, { render: false })
  assert(eSteam.getState() === HAZARD_STATES.ACTIVE, 'Steam pipe activates after warning window')
  assert(steamEngine.health === 70, `First steam hit deals 30 damage (HP=${steamEngine.health})`)
  assert(steamEngine.damageImmunityTimer > 0, 'Engine activates damageImmunityTimer after steam hit')

  // Remaining inside danger zone during immunity window does NOT deal per-frame spam damage
  steamEngine.stepFrame(0.15, { render: false })
  steamEngine.stepFrame(0.15, { render: false })
  assert(steamEngine.health === 70, 'Immunity timer prevents per-frame damage while remaining inside active steam')

  // Remaining inside danger zone past immunity expiration deals repeated damage!
  steamEngine.stepFrame(0.35, { render: false })
  assert(steamEngine.health === 40, `Staying inside active steam deals repeated damage once immunity expires (HP=${steamEngine.health})`)

  // Leaving into far safe lane stops damage even past immunity, and re-entering causes damage again
  steamEngine.setPlayerWorldPosition(safeLanePos.x, 0, safeLanePos.z, { immediate: true })
  steamEngine.stepFrame(0.75, { render: false })
  assert(steamEngine.health === 40 && steamEngine.damageImmunityTimer === 0, 'Standing in far safe opposite lane takes 0 damage and lets immunity expire')

  steamEngine.setPlayerWorldPosition(steamCellWorld.x, 0, steamCellWorld.z, { immediate: true })
  steamEngine.stepFrame(0.05, { render: false })
  assert(steamEngine.health === 10, `Re-entering active steam zone makes player vulnerable again (HP=${steamEngine.health})`)

  // 4) Check wall occlusion & range checks for "Seal Steam Pipe" prompt during ACTIVE
  const behindWallPos = {
    x: eDanger.origin.x - eSteam.ruptureDir.x * 2.1,
    y: 0,
    z: eDanger.origin.z - eSteam.ruptureDir.z * 2.1,
  }
  assert(
    eSteam.canPlayerInteract(behindWallPos, null) === false,
    'Player cannot seal steam pipe through a solid maze wall'
  )
  const outOfRangePos = {
    x: eDanger.origin.x + eSteam.ruptureDir.x * 2.65,
    y: 0,
    z: eDanger.origin.z + eSteam.ruptureDir.z * 2.65,
  }
  assert(
    eSteam.canPlayerInteract(outOfRangePos, null) === false,
    'Player beyond 2.35m from the broken pipe cannot operate Seal Steam Pipe'
  )

  const activePrompt = steamEngine.getNearbyInteractable()
  const activeDesc = eSteam.getInteractableDescriptor(steamCellWorld, steamCell)
  assert(
    activePrompt &&
      activePrompt.kind === 'hazard' &&
      activePrompt.id === 'engine-steam-47' &&
      activePrompt.label === 'Seal Steam Pipe' &&
      activePrompt.shortLabel === 'Seal' &&
      activeDesc &&
      activeDesc.action === 'seal_steam_pipe',
    'Active steam pipe exposes "Seal Steam Pipe" ("Seal") prompt near broken pipe'
  )

  // Press F -> shows bolted patch clamp, immediately stops steam & damage, removes prompt
  const sealRes = steamEngine.interact()
  assert(
    sealRes &&
      sealRes.handled === true &&
      sealRes.action === 'seal_steam_pipe' &&
      eSteam.getState() === HAZARD_STATES.DISABLED &&
      eSteam.isAftermathCleared === true &&
      eSteam.getMesh().userData.repairPatchGroup.visible === true &&
      eSteam.getMesh().userData.steamCloud.visible === false &&
      eSteam.getMesh().userData.steamMat.opacity === 0 &&
      Math.abs(eSteam.getMesh().userData.valveWheelMesh.rotation.z + Math.PI * 0.75) < 1e-4 &&
      steamEngine.getNearbyInteractable() === null,
    'Sealing steam pipe displays repair patch clamp, stops steam emission immediately, and removes prompt'
  )

  // Remains permanently sealed with 0 damage across subsequent updates
  steamEngine.damageImmunityTimer = 0
  steamEngine.stepFrame(2.0, { render: false })
  assert(
    steamEngine.health === 10 &&
      eSteam.getState() === HAZARD_STATES.DISABLED &&
      eSteam.update(2.0, { playerWorldPos: eDanger.center, playerGridCell: steamCell }) === null,
    'Sealed steam pipe deals zero further damage and remains disabled'
  )

  // resetCombat restores clean dormant state and hides repair patch clamp
  steamEngine.resetCombat()
  assert(
    eSteam.getState() === HAZARD_STATES.DORMANT &&
      eSteam.isAftermathCleared === false &&
      eSteam.isPermanentlyCollapsed === false &&
      eSteam.getMesh().userData.isAftermathCleared === false &&
      eSteam.getMesh().userData.repairPatchGroup.visible === false &&
      eSteam.getMesh().userData.valveWheelMesh.rotation.z === 0 &&
      eSteam.getMesh().userData.steamMat.opacity === 0,
    'resetCombat restores dormant steam line, hides repair patch, and resets handwheel rotation'
  )

  // Verify maze replacement disposes previous steam hazard cleanly
  const replacementMaze = generateMaze({ seed: 556677 })
  steamEngine.setMaze(replacementMaze)
  assert(
    eSteam.isDisposed === true && eSteam.getMesh() === null,
    'Maze replacement disposes previous steam_pipe_burst agent and mesh cleanly'
  )

  // Verify disposal cleans up both instance-owned steamMat and condensationMat while preserving shared pools
  const sSteamMat = sAgent.getMesh().userData.steamMat
  const sCondMat = sAgent.getMesh().userData.condensationMat
  let sSteamDisposed = false
  let sCondDisposed = false
  const origSSteamDispose = sSteamMat.dispose.bind(sSteamMat)
  const origSCondDispose = sCondMat.dispose.bind(sCondMat)
  sSteamMat.dispose = () => {
    sSteamDisposed = true
    origSSteamDispose()
  }
  sCondMat.dispose = () => {
    sCondDisposed = true
    origSCondDispose()
  }

  const poolsBeforeSteam47Dispose = getHazardPoolStats()
  sAgent.dispose()
  steamEngine.hazardManager.clear()
  const poolsAfterSteam47Dispose = getHazardPoolStats()
  assert(
    sSteamDisposed === true && sCondDisposed === true,
    'Both instance-owned steamMat and condensationMat are disposed cleanly'
  )
  assert(
    poolsAfterSteam47Dispose.geometries === poolsBeforeSteam47Dispose.geometries &&
      poolsAfterSteam47Dispose.materials === poolsBeforeSteam47Dispose.materials,
    'Shared hazard geometry and material pools remain intact after steam_pipe_burst disposal'
  )
  for (const mat of envMatSet) {
    assert(mat && typeof mat.dispose === 'function', 'Shared environmental prop material preserved')
  }
  steamEngine.dispose()
}
console.log('✓ Refined steam_pipe_burst continuous emission, side-dependent lane coverage, immunity-gated damage, Seal Steam Pipe patch & disposal verified')

// 48. Hazard 5/10 Refinement: Exposed Electrical Wiring — Concealment, Continuous Surge, Immunity-Gated Repeated Damage, Insulate Exposed Wiring & Disposal
console.log('Test 48: Refined Exposed Electrical Wiring — Concealment, Continuous Surge, Repeated Damage, Insulation & Disposal')
{
  const envMats = getEnvironmentalPropMaterials()
  const envMatSet = new Set([
    envMats.darkSteel,
    envMats.lockerBlue,
    envMats.rustyMetal,
    envMats.cableBlack,
    envMats.warningYellow,
  ])

  // A. Deterministic wall/ceiling mounting alignment & non-forced orientation across seeds
  for (const [difficulty, seed] of [
    ['easy', 3],
    ['medium', 24681],
    ['hard', 98765],
  ]) {
    const m = generateMaze({ difficulty, seed })
    const specsA = placeHazards(m, { hazardTypes: [HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING] })
    const specsB = placeHazards(m, { hazardTypes: [HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING] })
    const wA = specsA.find((s) => s.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING)
    const wB = specsB.find((s) => s.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING)
    assert(wA && wB, `${difficulty} maze places an exposed_electrical_wiring hazard`)
    assert(
      wA.row === wB.row &&
        wA.col === wB.col &&
        wA.mountType === wB.mountType &&
        wA.wallSide === wB.wallSide &&
        wA.wallYaw === wB.wallYaw &&
        wA.localDischargeOffset.x === wB.localDischargeOffset.x &&
        wA.localDischargeOffset.z === wB.localDischargeOffset.z &&
        wA.localJunctionOffset.x === wB.localJunctionOffset.x &&
        wA.localJunctionOffset.z === wB.localJunctionOffset.z &&
        wA.localBreakerOffset.x === wB.localBreakerOffset.x &&
        wA.localBreakerOffset.z === wB.localBreakerOffset.z,
      `${difficulty} exposed_electrical_wiring placement, mountType, yaw, junction, breaker, and discharge offsets are deterministic`
    )
    if (wA.mountType === 'wall') {
      assert(
        m.grid[wA.wallRow]?.[wA.wallCol] === CELL_TYPES.WALL,
        `${difficulty} wall-mounted wiring attaches to an actual adjacent WALL cell (${wA.wallRow},${wA.wallCol})`
      )
    }

    const envProps = placeEnvironmentalProps(m, { hazardCells: specsA })
    const elecPanels = envProps.filter((p) => p.type === PROP_TYPES.ELECTRICAL_PANEL)
    assert(
      elecPanels.length >= 1,
      `${difficulty} maze includes electrical_panel decoys alongside wiring hazards (count=${elecPanels.length})`
    )
  }

  const openJunctionGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.PATH],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
  ]
  const ceilingWiringMount = resolveElectricalMount(openJunctionGrid, 1, 1)
  assert(
    ceilingWiringMount.mountType === 'ceiling' &&
      ceilingWiringMount.wallSide === null &&
      ceilingWiringMount.localBreakerOffset.y >= 1.2,
    'Open 4-way intersection mounts exposed wiring overhead on ceiling trapeze with pendant breaker'
  )

  const nsCorridorGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
  ]
  const nsWiringMount = resolveElectricalMount(nsCorridorGrid, 1, 1)
  assert(
    nsWiringMount.mountType === 'wall' &&
      (nsWiringMount.wallSide === 'west' || nsWiringMount.wallSide === 'east') &&
      Math.abs(Math.abs(nsWiringMount.wallYaw) - Math.PI * 0.5) < 1e-6,
    'North-South corridor aligns exposed wiring flush to East/West wall with ±90deg yaw'
  )

  // B. Concealment, environmental material reuse, zero bright caution stripe, insulation boots, zero solid colliders
  const wiringAgent = new HazardAgent(
    {
      id: 'test-48-wiring',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 1,
      col: 2,
      wallSide: 'north',
    },
    testMaze
  )
  const wMesh = wiringAgent.getMesh()
  const wData = wMesh.userData

  assert(
    wiringAgent.getColliderSpecs().length === 0,
    'exposed_electrical_wiring registers zero solid colliders for sparks, arcs, or flush boxes'
  )
  assert(
    wData.mountGroup &&
      wData.breakerHandleGroup &&
      wData.cableGroup &&
      wData.insulationGroup &&
      wData.dischargeGroup &&
      wData.arcGroup &&
      wData.sparkGroup &&
      wData.glowMesh,
    'exposed_electrical_wiring exposes complete junction, insulation boots, cable, arc, spark, and glow hierarchy'
  )
  assert(
    wData.insulationGroup.visible === false,
    'Insulating sleeves start hidden while wiring is exposed'
  )

  let sharedEnvMatCount = 0
  let hasBrightCautionMat = false
  wData.mountGroup.traverse((node) => {
    if (!node.isMesh || !node.material) return
    if (envMatSet.has(node.material)) sharedEnvMatCount += 1
    if (node.material.color?.getHex?.() === HAZARD_PALETTE.wiringCaution) {
      hasBrightCautionMat = true
    }
  })
  assert(
    sharedEnvMatCount >= 6 && !hasBrightCautionMat,
    `Wiring reuses shared environmental materials (${sharedEnvMatCount} merged meshes) without bright caution yellow`
  )

  wMesh.updateMatrixWorld(true)
  const wallBox = new THREE.Box3().setFromObject(wData.mountGroup)
  const cellCenter = gridToWorld(1, 2, testMaze)
  const relMinX = wallBox.min.x - cellCenter.x
  const relMaxX = wallBox.max.x - cellCenter.x
  const relMinZ = wallBox.min.z - cellCenter.z
  const relMaxZ = wallBox.max.z - cellCenter.z
  assert(
    wallBox.min.y <= 0.01 &&
      wallBox.max.y >= 3.58 &&
      relMinX > -1.3 &&
      relMaxX < 1.3 &&
      relMinZ >= -2.002 &&
      relMaxZ <= -1.1,
    `Wall wiring hardware spans floor (${wallBox.min.y.toFixed(2)}m) to ceiling (${wallBox.max.y.toFixed(2)}m), stays clear of pilasters (x=${relMinX.toFixed(2)}..${relMaxX.toFixed(2)}), and hugs wall (z=${relMinZ.toFixed(2)}..${relMaxZ.toFixed(2)})`
  )

  const ceilMesh = buildHazardMesh({
    id: 'test-48-ceil',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    mountType: 'ceiling',
  })
  ceilMesh.updateMatrixWorld(true)
  const ceilBox = new THREE.Box3().setFromObject(ceilMesh.userData.mountGroup)
  assert(
    ceilBox.max.y >= 3.58 &&
      ceilBox.min.y >= 1.25 &&
      Math.abs(ceilBox.min.z) <= 0.3 &&
      Math.abs(ceilBox.max.z) <= 0.3,
    `Ceiling trapeze wiring anchors at ceiling soffit (${ceilBox.max.y.toFixed(2)}m), keeps floor clear (${ceilBox.min.y.toFixed(2)}m), and stays clear of ceiling lights (z=${ceilBox.min.z.toFixed(2)}..${ceilBox.max.z.toFixed(2)})`
  )
  ceilMesh.userData.tipMat.dispose()
  ceilMesh.userData.arcMat.dispose()
  ceilMesh.userData.sparkMat.dispose()
  ceilMesh.userData.glowMat.dispose()

  // C. Continuous C0 transitions & persistent high-voltage active arcing
  updateHazardVisualState(wMesh, 'dormant', 0)
  const dormantCableY = wData.cableGroup.position.y
  const dormantCableRotZ = wData.cableGroup.rotation.z
  updateHazardVisualState(wMesh, 'warning', 0)
  assert(
    Math.abs(wData.cableGroup.position.y - dormantCableY) < 1e-6 &&
      Math.abs(wData.cableGroup.rotation.z - dormantCableRotZ) < 1e-6 &&
      wData.sparkGroup.visible === true &&
      wData.tipMat.emissiveIntensity > 0.5,
    'DORMANT -> WARNING(0.0) keeps zero geometry snap while initiating fault sparks'
  )

  updateHazardVisualState(wMesh, 'warning', 1.0)
  const warnEndCableY = wData.cableGroup.position.y
  const warnEndCableRotZ = wData.cableGroup.rotation.z
  const warnEndTipEmissive = wData.tipMat.emissiveIntensity
  const warnEndArcOp = wData.arcMat.opacity
  const warnEndSparkOp = wData.sparkMat.opacity
  const warnEndSparkPositions = wData.sparkMeshes.map((s) => s.position.clone())

  updateHazardVisualState(wMesh, 'active', 0.0)
  assert(
    Math.abs(wData.cableGroup.position.y - warnEndCableY) < 1e-5 &&
      Math.abs(wData.cableGroup.rotation.z - warnEndCableRotZ) < 1e-5 &&
      Math.abs(wData.tipMat.emissiveIntensity - warnEndTipEmissive) < 0.05 &&
      Math.abs(wData.arcMat.opacity - warnEndArcOp) < 0.05 &&
      Math.abs(wData.sparkMat.opacity - warnEndSparkOp) < 0.05,
    'WARNING(1.0) -> ACTIVE(0.0) transitions C0-continuously across cables, emissive, arcs, and sparks'
  )
  for (let i = 0; i < wData.sparkMeshes.length; i += 1) {
    assert(
      wData.sparkMeshes[i].position.distanceTo(warnEndSparkPositions[i]) < 0.08,
      `Spark ${i} transitions across WARNING(1)->ACTIVE(0) without teleportation`
    )
  }

  for (const p of [0.5, 1.0, 2.3, 4.7]) {
    updateHazardVisualState(wMesh, 'active', p)
    assert(
      wData.arcGroup.visible === true &&
        wData.sparkGroup.visible === true &&
        wData.glowMesh.visible === true &&
        wData.arcMat.opacity >= 0.7 &&
        wData.sparkMat.opacity >= 0.8 &&
        wData.tipMat.emissiveIntensity >= 2.3,
      `ACTIVE(${p}) keeps continuous arcs, sparks, glow, and emissive active indefinitely`
    )
  }

  // Insulated aftermath state hides electrical effects and displays rubber insulating boots cleanly
  wData.isAftermathCleared = true
  updateHazardVisualState(wMesh, 'disabled', 1.0)
  assert(
    wData.arcGroup.visible === false &&
      wData.sparkGroup.visible === false &&
      wData.glowMesh.visible === false &&
      wData.insulationGroup.visible === true &&
      wData.tipMat.emissiveIntensity === 0,
    'Insulated electrical wiring displays protective sleeves and clears arcs, sparks, and emissive glow'
  )
  wData.isAftermathCleared = false

  // D. Engine integration: pre-trigger lockout, danger bounds, repeated immunity-respecting shocks, Insulate Exposed Wiring, wall occlusion & disposal
  const wiringEngine = createHeadlessEngine({
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 0.6,
    enemies: { autoSpawn: false },
  })
  wiringEngine.setMaze(testMaze)
  wiringEngine.cancelSpawnSequence()
  wiringEngine.hazardManager.clear()
  wiringEngine.syncHazardColliders({ allowPushOut: false })

  const eWiring = wiringEngine.hazardManager.addHazard({
    id: 'engine-wiring-48',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row: 1,
    col: 2,
    wallSide: 'north',
  })
  const eDanger = eWiring.getDangerArea()
  const wiringCellWorld = gridToWorld(1, 2, testMaze)
  const nearSafePos = { x: eDanger.origin.x, y: 0, z: eDanger.center.z + eDanger.radius + 0.18 }
  const inShockPos = { x: eDanger.center.x, y: 0, z: eDanger.center.z + 0.15 }
  const triggerAtPos = { x: wiringCellWorld.x, y: 0, z: wiringCellWorld.z }

  // 1) DORMANT: no F prompt before triggering
  wiringEngine.setPlayerWorldPosition(triggerAtPos.x, 0, triggerAtPos.z, { immediate: true })
  assert(
    eWiring.canPlayerInteract(triggerAtPos, { row: 1, col: 2 }) === false &&
      wiringEngine.getNearbyInteractable() === null,
    'Dormant wiring exposes zero F interaction before triggering'
  )

  // 2) WARNING: triggers via normal proximity, exposes zero F prompt before activation
  wiringEngine.stepFrame(0.05, { render: false })
  assert(eWiring.getState() === HAZARD_STATES.WARNING, 'Approaching wiring triggers WARNING')
  assert(
    eWiring.canPlayerInteract(triggerAtPos, { row: 1, col: 2 }) === false &&
      wiringEngine.getNearbyInteractable() === null,
    'WARNING wiring exposes zero pre-activation neutralization prompt'
  )

  // 3) Advance into ACTIVE inside shock zone -> initial 30 shock + immunity window
  wiringEngine.setPlayerWorldPosition(inShockPos.x, 0, inShockPos.z, { immediate: true })
  wiringEngine.stepFrame(eWiring.config.warningDuration + 0.05, { render: false })
  assert(eWiring.getState() === HAZARD_STATES.ACTIVE, 'Wiring enters continuous ACTIVE discharge')
  assert(wiringEngine.health === 70, `First active shock deals 30 damage (HP=${wiringEngine.health})`)
  assert(wiringEngine.damageImmunityTimer > 0, 'Engine activates damageImmunityTimer after shock')

  // Immunity blocks per-frame damage while staying inside shock zone
  wiringEngine.stepFrame(0.15, { render: false })
  wiringEngine.stepFrame(0.15, { render: false })
  assert(wiringEngine.health === 70, 'Immunity prevents per-frame electrical damage while staying inside arc zone')

  // Remaining past immunity expiration deals repeated damage
  wiringEngine.stepFrame(0.35, { render: false })
  assert(wiringEngine.health === 40, `Remaining inside active electrical zone deals repeated damage once immunity expires (HP=${wiringEngine.health})`)

  // Leaving into safe distance stops damage and re-entering causes damage again
  wiringEngine.setPlayerWorldPosition(nearSafePos.x, 0, nearSafePos.z, { immediate: true })
  wiringEngine.stepFrame(0.75, { render: false })
  assert(wiringEngine.health === 40 && wiringEngine.damageImmunityTimer === 0, 'Stepping outside electrical dangerRadius deals 0 damage and lets immunity expire')

  wiringEngine.setPlayerWorldPosition(inShockPos.x, 0, inShockPos.z, { immediate: true })
  wiringEngine.stepFrame(0.05, { render: false })
  assert(wiringEngine.health === 10, `Re-entering active electrical hazard makes player vulnerable again (HP=${wiringEngine.health})`)

  // Verify wiring persists ACTIVE well past activeDuration without expiring
  wiringEngine.setPlayerWorldPosition(nearSafePos.x, 0, nearSafePos.z, { immediate: true })
  wiringEngine.stepFrame(eWiring.config.activeDuration * 3.0, { render: false })
  assert(eWiring.getState() === HAZARD_STATES.ACTIVE, 'Wiring remains persistently ACTIVE until insulated')

  // Wall occlusion & range check
  const behindWallPos = gridToWorld(3, 2, testMaze)
  assert(
    eWiring.canPlayerInteract({ x: behindWallPos.x, y: 0, z: behindWallPos.z }, { row: 3, col: 2 }) === false,
    'Solid maze wall blocks Insulate Exposed Wiring via LOS occlusion check'
  )
  assert(
    eWiring.canPlayerInteract({ x: eDanger.origin.x + 2.6, y: 0, z: eDanger.origin.z }, null) === false,
    'Player beyond 2.35m from exposed wiring cannot insulate it'
  )

  // 4) Approach exposed wiring safely outside shock radius -> shows Insulate Exposed Wiring
  const activePrompt = wiringEngine.getNearbyInteractable()
  const activeDesc = eWiring.getInteractableDescriptor(nearSafePos, { row: 1, col: 2 })
  assert(
    activePrompt &&
      activePrompt.kind === 'hazard' &&
      activePrompt.id === 'engine-wiring-48' &&
      activePrompt.label === 'Insulate Exposed Wiring' &&
      activePrompt.shortLabel === 'Insulate' &&
      activeDesc?.action === 'insulate_wiring',
    'Active exposed wiring surfaces "Insulate Exposed Wiring" ("Insulate") prompt safely outside shock zone'
  )

  // Press F -> visually insulates exposed tips, kills live arcs/sparks/glow & damage immediately, removes prompt
  const insulateRes = wiringEngine.interact()
  assert(
    insulateRes &&
      insulateRes.handled === true &&
      insulateRes.action === 'insulate_wiring' &&
      eWiring.getState() === HAZARD_STATES.DISABLED &&
      eWiring.isAftermathCleared === true &&
      eWiring.getMesh().userData.isAftermathCleared === true &&
      eWiring.getMesh().userData.insulationGroup.visible === true &&
      eWiring.getMesh().userData.sparkGroup.visible === false &&
      eWiring.getMesh().userData.arcGroup.visible === false &&
      eWiring.getMesh().userData.glowMesh.visible === false &&
      wiringEngine.getNearbyInteractable() === null,
    'Insulating exposed wiring displays protective sleeves, extinguishes arcs immediately, and clears prompt'
  )

  // Standing directly under insulated wires deals 0 damage and remains disabled
  wiringEngine.damageImmunityTimer = 0
  wiringEngine.setPlayerWorldPosition(eDanger.center.x, 0, eDanger.center.z + 0.15, { immediate: true })
  wiringEngine.stepFrame(2.0, { render: false })
  assert(wiringEngine.health === 10 && eWiring.getState() === HAZARD_STATES.DISABLED, 'Insulated electrical wiring deals 0 damage and stays disabled')

  // 5) resetCombat restores clean DORMANT state and hides insulating boots
  wiringEngine.resetCombat()
  assert(
    eWiring.getState() === HAZARD_STATES.DORMANT &&
      eWiring.isAftermathCleared === false &&
      eWiring.isPermanentlyCollapsed === false &&
      eWiring.getMesh().userData.insulationGroup.visible === false,
    'resetCombat restores DORMANT wiring and hides insulating sleeves'
  )

  // 6) Maze replacement and full disposal cleanup
  const replacementMaze = generateMaze({ seed: 667788 })
  wiringEngine.setMaze(replacementMaze)
  assert(
    eWiring.isDisposed === true && eWiring.getMesh() === null,
    'Maze replacement disposes previous exposed_electrical_wiring agent cleanly'
  )

  const wTipMat = wMesh.userData.tipMat
  const wArcMat = wMesh.userData.arcMat
  const wSparkMat = wMesh.userData.sparkMat
  const wGlowMat = wMesh.userData.glowMat
  let disposedCount = 0
  for (const m of [wTipMat, wArcMat, wSparkMat, wGlowMat]) {
    const orig = m.dispose.bind(m)
    m.dispose = () => {
      disposedCount += 1
      orig()
    }
  }
  const poolsBefore = getHazardPoolStats()
  wiringAgent.dispose()
  wiringEngine.hazardManager.clear()
  const poolsAfter = getHazardPoolStats()
  assert(disposedCount === 4, `All 4 instance-owned wiring materials disposed cleanly (got ${disposedCount})`)
  assert(
    poolsAfter.geometries === poolsBefore.geometries &&
      poolsAfter.materials === poolsBefore.materials,
    'Shared hazard geometry and material pools preserved after exposed_electrical_wiring disposal'
  )
  for (const mat of envMatSet) {
    assert(mat && typeof mat.dispose === 'function', 'Shared environmental prop material preserved')
  }
  wiringEngine.dispose()
}
console.log('✓ Refined exposed_electrical_wiring continuous surge, immunity-gated damage, Insulate Exposed Wiring & disposal verified')

// 49. Hazard 6/10 Refinement: Collapsing Floor Grate — Safe Decoys, Real Floor/Plinth Cutouts, C0 Pit Physics, Pit Collision, Clearance & Secure Floor Opening
console.log('Test 49: Refined Collapsing Floor Grate — Safe Decoys, Real Cutouts, C0 Pit Physics, Pit Collision & Secure Floor Opening')
{
  // Helper: verifies no +Y triangle on floorChunks has interior points strictly inside any cutout rect
  const assertRealFloorCutouts = (floorNode, cutouts, label) => {
    const meshes = floorNode?.isGroup ? floorNode.children : [floorNode]
    const vA = new THREE.Vector3()
    const vB = new THREE.Vector3()
    const vC = new THREE.Vector3()
    for (const cut of cutouts) {
      let overlappingTopTris = 0
      for (const m of meshes) {
        if (!m?.geometry) continue
        const pos = m.geometry.attributes.position
        const norm = m.geometry.attributes.normal
        const idx = m.geometry.index
        const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3)
        for (let t = 0; t < triCount; t += 1) {
          const ia = idx ? idx.getX(t * 3) : t * 3
          const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
          const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
          if (norm.getY(ia) < 0.9 || norm.getY(ib) < 0.9 || norm.getY(ic) < 0.9) continue
          vA.fromBufferAttribute(pos, ia).add(m.position)
          vB.fromBufferAttribute(pos, ib).add(m.position)
          vC.fromBufferAttribute(pos, ic).add(m.position)
          const minX = Math.min(vA.x, vB.x, vC.x)
          const maxX = Math.max(vA.x, vB.x, vC.x)
          const minZ = Math.min(vA.z, vB.z, vC.z)
          const maxZ = Math.max(vA.z, vB.z, vC.z)
          if (
            maxX > cut.minX + 0.01 &&
            minX < cut.maxX - 0.01 &&
            maxZ > cut.minZ + 0.01 &&
            minZ < cut.maxZ - 0.01
          ) {
            overlappingTopTris += 1
          }
        }
      }
      assert(
        overlappingTopTris === 0,
        `${label}: real floor opening ${cut.id} (${cut.kind}) has ZERO solid floor +Y triangles covering it (found ${overlappingTopTris})`
      )
    }
  }

  // A. Deterministic safe decoy placement, non-overlap & shared environmental materials
  const decoyMaze = generateMaze({ difficulty: 'medium', seed: 445566 })
  const decoyHazards = placeHazards(decoyMaze)
  const decoyProps = placeEnvironmentalProps(decoyMaze, { hazards: decoyHazards })
  const decoysA = placeFloorGrateDecoys(decoyMaze, { hazards: decoyHazards, placedProps: decoyProps })
  const decoysB = placeFloorGrateDecoys(decoyMaze, { hazards: decoyHazards, placedProps: decoyProps })
  assert(decoysA.length >= 2 && decoysA.length <= 8, `Safe decoy count bounded (${decoysA.length})`)
  assert(JSON.stringify(decoysA) === JSON.stringify(decoysB), 'Safe decoy grate placement is deterministic')
  const occupiedKeys = new Set([
    `${decoyMaze.start.row},${decoyMaze.start.col}`,
    `${decoyMaze.exit.row},${decoyMaze.exit.col}`,
    ...decoyHazards.map((h) => `${h.row},${h.col}`),
    ...decoyProps.map((p) => `${p.row},${p.col}`),
  ])
  for (const d of decoysA) {
    assert(decoyMaze.grid[d.row]?.[d.col] === CELL_TYPES.PATH, `Decoy (${d.row},${d.col}) sits on walkable corridor tile`)
    assert(!occupiedKeys.has(`${d.row},${d.col}`), `Decoy (${d.row},${d.col}) avoids start/exit/hazards/props`)
  }

  // Build full maze geometry & verify real cutouts in maze-floor, floor-imperfections & decoy visuals
  const mazeGroup49 = buildMazeMeshes(decoyMaze, {
    hazards: decoyHazards,
    qualityPreset: 'high',
  })
  const expectedCutouts = resolveFloorGrateCutouts(decoyMaze, {
    hazards: decoyHazards,
    placedProps: decoyProps,
  })
  const grateHazardCount49 = decoyHazards.filter(
    (h) => h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE
  ).length
  assert(
    grateHazardCount49 >= 1 &&
      expectedCutouts.length === grateHazardCount49 + decoysA.length &&
      expectedCutouts.some((c) => c.kind === 'hazard') &&
      expectedCutouts.some((c) => c.kind === 'decoy'),
    `Cutouts include ${grateHazardCount49} hazard opening(s) + ${decoysA.length} safe decoy openings`
  )
  assertRealFloorCutouts(mazeGroup49.getObjectByName('maze-floor'), expectedCutouts, 'Medium maze')

  const decoysGroup49 = mazeGroup49.getObjectByName(FLOOR_GRATE_CONSTANTS.decoyLayerName)
  assert(decoysGroup49 && decoysGroup49.children.length === 7, 'Safe decoy grates render via 7 instanced batches')
  const envMats49 = getEnvironmentalPropMaterials()
  const allowedDecoyMats = new Set([envMats49.debrisConcrete, envMats49.darkSteel, envMats49.rustyMetal])
  for (const inst of decoysGroup49.children) {
    assert(inst.isInstancedMesh, `${inst.name} is an InstancedMesh`)
    const hex = inst.material.color.getHex()
    assert(hex !== 0xeab308 && hex !== 0xfacc15, 'Decoy grates contain zero bright caution yellow')
    assert(
      allowedDecoyMats.has(inst.material) || inst.material.userData?.isShared === true,
      `Decoy ${inst.name} uses shared environmental/pooled materials`
    )
  }

  // Verify no floor imperfection decal quad straddles any cutout aperture
  const impMesh49 = mazeGroup49.getObjectByName('maze-floor-imperfections')
  if (impMesh49?.geometry?.attributes?.position) {
    const pos = impMesh49.geometry.attributes.position
    const idx = impMesh49.geometry.index
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3)
    const vA = new THREE.Vector3()
    const vB = new THREE.Vector3()
    const vC = new THREE.Vector3()
    for (let t = 0; t < triCount; t += 1) {
      const ia = idx ? idx.getX(t * 3) : t * 3
      const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
      const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
      vA.fromBufferAttribute(pos, ia)
      vB.fromBufferAttribute(pos, ib)
      vC.fromBufferAttribute(pos, ic)
      const cx = (vA.x + vB.x + vC.x) / 3
      const cz = (vA.z + vB.z + vC.z) / 3
      for (const cut of expectedCutouts) {
        const inside =
          cx >= cut.minX && cx <= cut.maxX && cz >= cut.minZ && cz <= cut.maxZ
        assert(!inside, `Floor imperfection decal center (${cx.toFixed(2)},${cz.toFixed(2)}) skips open pit ${cut.id}`)
      }
    }
  }
  disposeMazeGroup(mazeGroup49)

  // B. C0 continuity across dormant -> warning -> active -> disabled & zero pit-wall/sump clipping
  const grateCell49 = decoyHazards.find((h) => h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE)
  const grateAgent49 = new HazardAgent(grateCell49, decoyMaze)
  const gMesh49 = grateAgent49.getMesh()
  const gData49 = gMesh49.userData

  // Verify hazard shares facility materials with decoys/props
  assert(
    gData49.shaftMesh.material === envMats49.debrisConcrete &&
      gData49.curbMesh.material === envMats49.darkSteel &&
      gData49.leftLeafGroup.children[0].material === envMats49.darkSteel &&
      gData49.leftLeafGroup.children[1].material === envMats49.rustyMetal,
    'Collapsing grate reuses shared facility concrete, darkSteel, and rustyMetal materials'
  )

  updateHazardVisualState(gMesh49, 'dormant', 0)
  const dormLeftRot = gData49.leftLeafGroup.rotation.z
  const dormRightRot = gData49.rightLeafGroup.rotation.z
  const dormLeftY = gData49.leftLeafGroup.position.y
  const dormBoltYs = gData49.bolts.map((b) => b.position.y)
  const dormBoltRots = gData49.bolts.map((b) => b.rotation.z)

  updateHazardVisualState(gMesh49, 'warning', 0)
  assert(
    Math.abs(gData49.leftLeafGroup.rotation.z - dormLeftRot) < 1e-6 &&
      Math.abs(gData49.rightLeafGroup.rotation.z - dormRightRot) < 1e-6 &&
      Math.abs(gData49.leftLeafGroup.position.y - dormLeftY) < 1e-6,
    'DORMANT -> WARNING(0.0) keeps zero leaf snap'
  )
  for (let i = 0; i < gData49.bolts.length; i += 1) {
    assert(
      Math.abs(gData49.bolts[i].position.y - dormBoltYs[i]) < 1e-6 &&
        Math.abs(gData49.bolts[i].rotation.z - dormBoltRots[i]) < 1e-6,
      `Bolt ${i} transitions DORMANT -> WARNING(0.0) without snap`
    )
  }

  // Sweep warning and check warning fragments remain strictly inside shaft walls and above sump floor
  const sumpTopY = gData49.pitMesh.position.y + 0.009
  for (let s = 1; s <= 10; s += 1) {
    updateHazardVisualState(gMesh49, 'warning', s / 10)
    for (let i = 0; i < gData49.warningFragments.length; i += 1) {
      const chip = gData49.warningFragments[i]
      assert(
        chip.position.y - 0.009 > sumpTopY &&
          Math.abs(chip.position.x) < FLOOR_GRATE_CONSTANTS.pitInnerHalfW &&
          Math.abs(chip.position.z) < FLOOR_GRATE_CONSTANTS.pitInnerHalfD,
        `Warning fragment ${i} falls strictly inside 0.68m pit without floor/wall clipping`
      )
    }
  }

  updateHazardVisualState(gMesh49, 'warning', 1.0)
  const warnEndLeftRot = gData49.leftLeafGroup.rotation.z
  const warnEndRightRot = gData49.rightLeafGroup.rotation.z
  const warnEndLeftY = gData49.leftLeafGroup.position.y
  const warnEndBoltPos = gData49.bolts.map((b) => b.position.clone())
  const warnEndBoltRot = gData49.bolts.map((b) => b.rotation.z)

  updateHazardVisualState(gMesh49, 'active', 0.0)
  assert(
    Math.abs(gData49.leftLeafGroup.rotation.z - warnEndLeftRot) < 1e-5 &&
      Math.abs(gData49.rightLeafGroup.rotation.z - warnEndRightRot) < 1e-5 &&
      Math.abs(gData49.leftLeafGroup.position.y - warnEndLeftY) < 1e-5,
    'WARNING(1.0) -> ACTIVE(0.0) transitions leaves C0-continuously'
  )
  for (let i = 0; i < gData49.bolts.length; i += 1) {
    assert(
      gData49.bolts[i].position.distanceTo(warnEndBoltPos[i]) < 1e-4 &&
        Math.abs(gData49.bolts[i].rotation.z - warnEndBoltRot[i]) < 1e-4,
      `Bolt ${i} transitions WARNING(1.0) -> ACTIVE(0.0) C0-continuously`
    )
  }

  // Sweep active collapse & check leaf box bounds stay inside shaft & above sump floor
  let sawMidDrop = false
  const leafBox = new THREE.Box3()
  const invRootMat = new THREE.Matrix4()
  for (let s = 1; s <= 24; s += 1) {
    const p = s / 24
    updateHazardVisualState(gMesh49, 'active', p)
    gData49.grateRoot.updateMatrixWorld(true)
    invRootMat.copy(gData49.grateRoot.matrixWorld).invert()
    for (const lg of [gData49.leftLeafGroup, gData49.rightLeafGroup]) {
      leafBox.setFromObject(lg).applyMatrix4(invRootMat)
      if (leafBox.min.y < -0.25 && leafBox.min.y > -0.58) sawMidDrop = true
      assert(
        leafBox.min.y > sumpTopY - 0.002 &&
          leafBox.min.x > -FLOOR_GRATE_CONSTANTS.pitInnerHalfW &&
          leafBox.max.x < FLOOR_GRATE_CONSTANTS.pitInnerHalfW,
        `Active leaf stays inside pit shaft above sump floor at p=${p.toFixed(2)} (minY=${leafBox.min.y.toFixed(3)}, x=${leafBox.min.x.toFixed(3)}..${leafBox.max.x.toFixed(3)})`
      )
    }
    for (let i = 0; i < gData49.debrisMeshes.length; i += 1) {
      const shard = gData49.debrisMeshes[i]
      const cfg = gData49.debrisConfigs[i]
      if (cfg.inPit) {
        assert(shard.position.y - 0.012 > sumpTopY - 0.002, `Pit shard ${i} stays above sump floor`)
      } else {
        assert(shard.position.y - 0.012 >= 0, `Rim shard ${i} never penetrates solid floor`)
      }
    }
  }
  assert(sawMidDrop, 'Grate leaves visibly swing downward through mid-pit under gravity')

  updateHazardVisualState(gMesh49, 'active', 1.0)
  const actEndLeftRot = gData49.leftLeafGroup.rotation.z
  const actEndLeftY = gData49.leftLeafGroup.position.y
  updateHazardVisualState(gMesh49, 'disabled', 1.0)
  assert(
    Math.abs(gData49.leftLeafGroup.rotation.z - actEndLeftRot) < 1e-5 &&
      Math.abs(gData49.leftLeafGroup.position.y - actEndLeftY) < 1e-5,
    'ACTIVE(1.0) -> DISABLED matches settled leaf pose with zero snap'
  )
  grateAgent49.dispose()

  // C. Multi-topology corridor clearance >= 1.60m (target >= 2.08m) across straight, corner, T-junction & 4-way
  const topoGrid = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  topoGrid[1][1] = CELL_TYPES.PATH
  topoGrid[1][2] = CELL_TYPES.PATH
  topoGrid[1][3] = CELL_TYPES.PATH // EW straight at (1,2), corner at (1,1)
  topoGrid[2][1] = CELL_TYPES.PATH
  topoGrid[3][1] = CELL_TYPES.PATH
  topoGrid[3][2] = CELL_TYPES.PATH
  topoGrid[3][3] = CELL_TYPES.PATH
  topoGrid[3][4] = CELL_TYPES.PATH
  topoGrid[3][5] = CELL_TYPES.PATH
  topoGrid[2][3] = CELL_TYPES.PATH // T-junction at (1,3) & 4-way at (3,3)
  topoGrid[4][3] = CELL_TYPES.PATH
  topoGrid[5][3] = CELL_TYPES.PATH
  const topoMaze = { id: 'topo-49', seed: 4949, grid: topoGrid, start: { row: 5, col: 3 }, exit: { row: 1, col: 1 } }
  for (const [label, r, c] of [
    ['EW straight', 1, 2],
    ['NS straight', 2, 1],
    ['L-corner', 1, 1],
    ['T-junction', 1, 3],
    ['4-way junction', 3, 3],
  ]) {
    const topoHaz = new HazardAgent(
      { id: `topo-grate-${r}-${c}`, type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: r, col: c },
      topoMaze
    )
    const tmpl = topoHaz.getColliderSpecs()[0]
    const check = validateHazardColliderPlacement(
      topoMaze,
      { id: tmpl.id, kind: tmpl.kind, cx: tmpl.cx, cz: tmpl.cz, halfW: tmpl.halfW, halfD: tmpl.halfD, yaw: tmpl.baseYaw },
      { radius: PLAYER_RADIUS }
    )
    assert(check.valid, `${label} pit collider satisfies safe corridor clearance (min=${check.minCorridorWidth?.toFixed(2) ?? check.minPassage?.toFixed(2) ?? 'ok'}m)`)
    topoHaz.dispose()
  }

  // D. Engine end-to-end: Real plinth holes on setMaze + replacement, decoy safety, pit collision, push-out & "Secure Floor Opening"
  const gEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  gEngine.setMaze(decoyMaze)
  gEngine.cancelSpawnSequence()

  // Verify outer plinth has cutouts and zero residual solid pieces across openings
  const plinthA = gEngine._environment?.details?.plinthMesh
  assert(
    plinthA && plinthA.userData.cutoutCount === expectedCutouts.length,
    `Outer plinth subtracts all ${expectedCutouts.length} grate openings (got ${plinthA?.userData?.cutoutCount})`
  )

  // Standing directly on every safe decoy causes ZERO trigger, ZERO collider block, ZERO damage
  const engineDecoys = gEngine._mazeGroup?.userData?.floorGrateDecoysGroup?.userData?.decoys || []
  assert(engineDecoys.length >= 2, 'Engine scene attaches safe decoy grates')
  for (const d of engineDecoys) {
    const rect = getFloorGrateOpeningRect(d, decoyMaze)
    gEngine.setPlayerWorldPosition(rect.cx, 0, rect.cz, { immediate: true })
    for (let step = 0; step < 8; step += 1) {
      gEngine.stepFrame(0.3, { render: false })
    }
    assert(gEngine.health === 100, `Standing on safe decoy ${d.id} deals ZERO damage`)
    assert(gEngine.getNearbyInteractable() === null, `Safe decoy ${d.id} emits zero hazard interaction prompt`)
  }

  // Test Hazard grate lifecycle in live engine
  const liveGrate = gEngine.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE)
  assert(liveGrate, 'Engine spawns collapsing_floor_grate hazard')
  const pitColliderId = `${liveGrate.id}:aftermath-pit`
  assert(
    getDynamicCollider(gEngine._propCollisionIndex, pitColliderId)?.enabled === false,
    'Pit collider is disabled while grate is intact dormant'
  )

  const liveArea = liveGrate.getDangerArea()
  // Trigger warning by stepping onto grate, then dodge cleanly to open opposite corridor lane
  gEngine.setPlayerWorldPosition(liveArea.center.x, 0, liveArea.center.z, { immediate: true })
  gEngine.stepFrame(0.05, { render: false })
  assert(liveGrate.getState() === HAZARD_STATES.WARNING, 'Engine stepping onto grate triggers WARNING')
  assert(
    liveGrate.canPlayerInteract(gEngine.getPlayerWorldPosition(), decoyMaze.start) === false,
    'Secure Floor Opening is hidden until grate collapses into open pit'
  )

  // Dodge off onto walkable neighbor or safe lane beside pit
  const liveCellWorld = gridToWorld(liveGrate.row, liveGrate.col, decoyMaze)
  const offVecX = liveArea.center.x - liveCellWorld.x
  const offVecZ = liveArea.center.z - liveCellWorld.z
  const safeSpot = {
    x:
      Math.abs(offVecX) >= Math.abs(offVecZ)
        ? liveCellWorld.x - Math.sign(offVecX || 1) * 1.15
        : liveArea.center.x,
    z:
      Math.abs(offVecZ) > Math.abs(offVecX)
        ? liveCellWorld.z - Math.sign(offVecZ || 1) * 1.15
        : liveArea.center.z,
  }
  gEngine.setPlayerWorldPosition(safeSpot.x, 0, safeSpot.z, { immediate: true })
  gEngine.stepFrame(liveGrate.config.warningDuration + 0.08, { render: false })
  assert(liveGrate.getState() === HAZARD_STATES.ACTIVE, 'Grate collapses into ACTIVE')
  assert(gEngine.health === 100, 'Dodging into safe adjacent corridor lane takes ZERO damage')

  // Verify aftermath pit collider activates once collapse passes activateProgress (0.04)
  gEngine.stepFrame(0.08, { render: false })
  const pitColActive = getDynamicCollider(gEngine._propCollisionIndex, pitColliderId)
  assert(pitColActive && pitColActive.enabled === true, 'Open pit collider enables dynamically upon collapse')

  // Finish collapse into DISABLED open pit
  gEngine.stepFrame(liveGrate.config.activeDuration + 0.1, { render: false })
  assert(liveGrate.getState() === HAZARD_STATES.DISABLED && liveGrate.isPermanentlyCollapsed === true, 'Collapsed pit enters permanent DISABLED state')

  // Verify solid pit boundary blocks walking into open pit & resolveSafePushOut rescues overlap
  const dirToPitX = liveArea.center.x - safeSpot.x
  const dirToPitZ = liveArea.center.z - safeSpot.z
  const dirLen = Math.hypot(dirToPitX, dirToPitZ) || 1
  const blockedAttempt = moveWithSubsteps(
    safeSpot.x,
    safeSpot.z,
    (dirToPitX / dirLen) * 2.0,
    (dirToPitZ / dirLen) * 2.0,
    decoyMaze,
    { radius: PLAYER_RADIUS, propColliders: gEngine._propCollisionIndex }
  )
  assert(
    Math.hypot(blockedAttempt.x - liveArea.center.x, blockedAttempt.z - liveArea.center.z) > 0.6,
    'Open collapsed pit collider blocks player from walking across the open pit'
  )

  const pushedOut = resolveSafePushOut(
    liveArea.center.x + 0.05,
    liveArea.center.z - 0.05,
    decoyMaze,
    { radius: PLAYER_RADIUS, propColliders: gEngine._propCollisionIndex }
  )
  assert(
    pushedOut.pushed &&
      pushedOut.safe &&
      !liveGrate._isPointInGrateArea(pushedOut.x, pushedOut.z, 0.2),
    'resolveSafePushOut cleanly ejects player out onto solid corridor concrete around pit'
  )

  // Verify "Secure Floor Opening" rejects inside pit, rejects behind wall, rejects out of range, and succeeds beside pit
  assert(
    liveGrate.canPlayerInteract({ x: liveArea.center.x, y: 0, z: liveArea.center.z }, { row: liveGrate.row, col: liveGrate.col }) === false,
    'Cannot use Secure Floor Opening from inside the pit interior'
  )
  // Find a neighboring WALL cell on grid and test across-wall rejection when available
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const adjR = liveGrate.row + dr * 2
    const adjC = liveGrate.col + dc * 2
    if (
      decoyMaze.grid[liveGrate.row + dr]?.[liveGrate.col + dc] === CELL_TYPES.WALL &&
      decoyMaze.grid[adjR]?.[adjC] === CELL_TYPES.PATH
    ) {
      const acrossWall = gridToWorld(adjR, adjC, decoyMaze)
      assert(
        liveGrate.canPlayerInteract({ x: acrossWall.x, y: 0, z: acrossWall.z }, { row: adjR, col: adjC }) === false,
        'Solid maze wall blocks Secure Floor Opening via LOS occlusion check'
      )
      break
    }
  }
  assert(
    liveGrate.canPlayerInteract({ x: liveArea.center.x + 3.2, y: 0, z: liveArea.center.z }, null) === false,
    'Out of range (> 2.2m) blocks Secure Floor Opening'
  )

  gEngine.setPlayerWorldPosition(safeSpot.x, 0, safeSpot.z, { immediate: true })
  const prompt49 = gEngine.getNearbyInteractable()
  assert(
    prompt49 &&
      prompt49.kind === 'hazard' &&
      prompt49.id === liveGrate.id &&
      prompt49.label === 'Secure Floor Opening',
    'Standing safely beside collapsed pit surfaces "Secure Floor Opening" prompt'
  )
  const secureRes = gEngine.interact()
  assert(
    secureRes &&
      secureRes.handled === true &&
      secureRes.action === 'secure_floor_opening' &&
      liveGrate.isAftermathCleared === true &&
      liveGrate.getMesh().userData.securedCoverGroup.visible === true &&
      getDynamicCollider(gEngine._propCollisionIndex, pitColliderId)?.enabled === false &&
      gEngine.getNearbyInteractable() === null,
    'Secure Floor Opening installs trench cover plate, disables pit collider, and clears prompt'
  )

  // Verify player can now walk right over the secured steel trench plate
  const walkOverRes = moveWithSubsteps(
    safeSpot.x,
    safeSpot.z,
    liveArea.center.x - safeSpot.x,
    liveArea.center.z - safeSpot.z,
    decoyMaze,
    { radius: PLAYER_RADIUS, propColliders: gEngine._propCollisionIndex }
  )
  assert(
    Math.hypot(walkOverRes.x - liveArea.center.x, walkOverRes.z - liveArea.center.z) < 0.15,
    'Player walks freely over secured floor trench plate'
  )

  // Replay reset restores flush dormant grate and removes trench cover
  gEngine.resetCombat()
  assert(
    liveGrate.getState() === HAZARD_STATES.DORMANT &&
      liveGrate.isAftermathCleared === false &&
      liveGrate.getMesh().userData.securedCoverGroup.visible === false &&
      getDynamicCollider(gEngine._propCollisionIndex, pitColliderId)?.enabled === false,
    'resetCombat restores intact DORMANT floor grate and hides trench plate'
  )

  // Maze replacement cleanly updates maze-floor & outer plinth cutouts and disposes old hazard
  const nextMaze = generateMaze({ difficulty: 'medium', seed: 667788 })
  gEngine.setMaze(nextMaze)
  const nextCutouts = gEngine._mazeGroup?.userData?.floorCutouts || []
  const plinthB = gEngine._environment?.details?.plinthMesh
  assert(liveGrate.isDisposed === true && liveGrate.getMesh() === null, 'Maze replacement disposes previous floor grate agent cleanly')
  assert(nextCutouts.length >= 3, 'Replaced maze generates fresh floor grate cutouts')
  assertRealFloorCutouts(gEngine._mazeGroup.getObjectByName('maze-floor'), nextCutouts, 'Replaced medium maze')
  assert(
    plinthB && plinthB.userData.cutoutCount === nextCutouts.length,
    `Outer plinth rebuilds openings for replaced maze (${plinthB?.userData?.cutoutCount} === ${nextCutouts.length})`
  )

  const poolsBefore49 = getHazardPoolStats()
  gEngine.clearHazards()
  const poolsAfter49 = getHazardPoolStats()
  assert(
    poolsAfter49.geometries === poolsBefore49.geometries &&
      poolsAfter49.materials === poolsBefore49.materials,
    'Shared hazard geometry and material pools preserved across engine clearHazards()'
  )
  gEngine.dispose()
}
console.log('✓ Refined collapsing_floor_grate safe decoys, real floor/plinth cutouts, C0 pit physics, pit collision, clearance & Secure Floor Opening verified')

// 50. Refined Wall Collapse — Flush Concealment, Safe Decoys, C0 Physics, Oriented Damage, Clearance & "Clear Fallen Masonry"
console.log('Test 50: Refined Wall Collapse Concealment, Safe Decoys, C0 Physics, Oriented Bounds & Interaction')
{
  const wcMaze = generateMaze({ seed: 771234, level: 26 })
  const wcHazards = placeHazards(wcMaze)
  const wcDecoys1 = placeWallCollapseDecoys(wcMaze, { hazards: wcHazards })
  const wcDecoys2 = placeWallCollapseDecoys(wcMaze, { hazards: wcHazards })
  assert(wcDecoys1.length >= 2, `Generates >= 2 deterministic safe wall-deterioration decoys (got ${wcDecoys1.length})`)
  assert(
    JSON.stringify(wcDecoys1) === JSON.stringify(wcDecoys2),
    'Wall collapse decoy placement is deterministic across identical seeds'
  )

  const wallHazardFaces = new Set(
    wcHazards
      .filter((h) => Number.isFinite(h.wallRow) && Number.isFinite(h.wallCol) && h.wallSide)
      .map((h) => `${h.wallRow},${h.wallCol},${h.wallSide}`)
  )
  const wallPropFaces = new Set(
    placeEnvironmentalProps(wcMaze, { hazards: wcHazards })
      .filter((p) => Number.isFinite(p.wallRow) && Number.isFinite(p.wallCol) && p.wallSide)
      .map((p) => `${p.wallRow},${p.wallCol},${p.wallSide}`)
  )
  for (const d of wcDecoys1) {
    assert(wcMaze.grid[d.row]?.[d.col] === CELL_TYPES.PATH, 'Decoy sits on walkable PATH cell')
    assert(wcMaze.grid[d.wallRow]?.[d.wallCol] === CELL_TYPES.WALL, 'Decoy attaches to real WALL cell')
    const fKey = `${d.wallRow},${d.wallCol},${d.wallSide}`
    assert(!wallHazardFaces.has(fKey) && !wallPropFaces.has(fKey), 'Decoy avoids existing hazard & prop wall faces')
  }

  // A. Concealment, flush wall relief, pilaster/beam clearance, facility materials & identical decoy assets
  const wcMeta = wcHazards.find((h) => h.type === HAZARD_TYPES.WALL_COLLAPSE)
  assert(Boolean(wcMeta), 'Seed generates wall_collapse hazard')
  const wcAgent = new HazardAgent(wcMeta, wcMaze)
  const wcMesh = wcAgent.getMesh()
  const wcData = wcMesh.userData
  const wallZ = wcData.wallZ
  wcData.wallMountGroup.updateMatrixWorld(true)
  const invMountMat = new THREE.Matrix4().copy(wcData.wallMountGroup.matrixWorld).invert()
  const partBox = new THREE.Box3()

  assert(
    wcData.cavityMesh.visible === false && wcData.rebarGroup.visible === false,
    'Internal wall cavity & structural rebar stay hidden while wall is intact dormant'
  )
  for (const [partName, obj] of [
    ['rimGroup', wcData.rimGroup],
    ['slabGroup', wcData.slabGroup],
    ['crackGroup', wcData.crackGroup],
  ]) {
    partBox.setFromObject(obj).applyMatrix4(invMountMat)
    assert(
      partBox.max.z <= wallZ + 0.05 && partBox.min.z >= wallZ - 0.002,
      `Dormant ${partName} sits flush against wall face (z=${partBox.min.z.toFixed(3)}..${partBox.max.z.toFixed(3)}, wallZ=${wallZ})`
    )
    assert(
      partBox.min.x >= -1.18 && partBox.max.x <= 1.18 && partBox.min.y >= -0.001 && partBox.max.y <= 2.52,
      `Dormant ${partName} stays clear of corner pilasters & ceiling beams (x=${partBox.min.x.toFixed(2)}..${partBox.max.x.toFixed(2)}, y=${partBox.min.y.toFixed(2)}..${partBox.max.y.toFixed(2)})`
    )
  }

  const slabMat = wcData.slabMeshes[0].material
  assert(
    slabMat.color.getHex() === MAZE_MESH_PALETTE.wallBody &&
      Boolean(slabMat.map) &&
      Boolean(slabMat.bumpMap) &&
      Boolean(slabMat.roughnessMap) &&
      slabMat.onBeforeCompile === THREE.Material.prototype.onBeforeCompile,
    'Wall collapse veneer uses facility wall concrete palette & texture maps without exceeding shader budget'
  )

  const builtMaze50 = buildMazeMeshes(wcMaze, { hazards: wcHazards })
  const decoyGroup50 = builtMaze50.userData.wallCollapseDecoysGroup
  assert(
    decoyGroup50 &&
      decoyGroup50.name === WALL_COLLAPSE_CONSTANTS.decoyLayerName &&
      decoyGroup50.children.length === 4,
    'Maze meshes include instanced wall-collapse decoy layer matching wall veneer components'
  )
  const decoySlabInst = decoyGroup50.getObjectByName('wall-collapse-decoy-slabs-even')
  assert(
    decoySlabInst &&
      decoySlabInst.material === slabMat &&
      decoySlabInst.geometry === wcData.slabMeshes[0].geometry,
    'Safe decoys share identical material & geometry as dormant wall_collapse slabs'
  )
  disposeMazeGroup(builtMaze50)

  // B. C0 continuity & floor/wall containment across warning -> active -> disabled
  updateHazardVisualState(wcMesh, 'warning', 0.0)
  for (let i = 0; i < wcData.slabMeshes.length; i += 1) {
    assert(
      Math.abs(wcData.slabMeshes[i].position.z - wcData.slabConfigs[i].restZ) < 1e-4 &&
        Math.abs(wcData.slabMeshes[i].position.y - wcData.slabConfigs[i].restY) < 1e-4,
      `WARNING(0.0) matches DORMANT pose for slab ${i}`
    )
  }
  assert(wcData.dustMat.opacity < 1e-4, 'WARNING(0.0) dust starts at zero opacity')

  for (let s = 0; s <= 16; s += 1) {
    const p = s / 16
    updateHazardVisualState(wcMesh, 'warning', p)
    wcData.wallMountGroup.updateMatrixWorld(true)
    invMountMat.copy(wcData.wallMountGroup.matrixWorld).invert()
    for (let i = 0; i < wcData.slabMeshes.length; i += 1) {
      partBox.setFromObject(wcData.slabMeshes[i]).applyMatrix4(invMountMat)
      assert(
        partBox.min.y >= -0.005 && partBox.min.z >= wallZ - 0.005,
        `WARNING slab ${i} at p=${p.toFixed(2)} stays above floor and in front of wall (minY=${partBox.min.y.toFixed(3)}, minZ=${partBox.min.z.toFixed(3)})`
      )
    }
    for (let c = 0; c < wcData.warningChunks.length; c += 1) {
      partBox.setFromObject(wcData.warningChunks[c]).applyMatrix4(invMountMat)
      assert(
        partBox.min.y >= -0.005 && partBox.min.z >= wallZ - 0.005,
        `WARNING chip ${c} at p=${p.toFixed(2)} never clips floor or wall`
      )
    }
  }
  const warnEndSlabPos = wcData.slabMeshes.map((m) => m.position.clone())
  const warnEndSlabRot = wcData.slabMeshes.map((m) => m.rotation.clone())
  const warnEndDustOpacity = wcData.dustMat.opacity

  updateHazardVisualState(wcMesh, 'active', 0.0)
  for (let i = 0; i < wcData.slabMeshes.length; i += 1) {
    assert(
      wcData.slabMeshes[i].position.distanceTo(warnEndSlabPos[i]) < 1e-4 &&
        Math.abs(wcData.slabMeshes[i].rotation.x - warnEndSlabRot[i].x) < 1e-4 &&
        Math.abs(wcData.slabMeshes[i].rotation.z - warnEndSlabRot[i].z) < 1e-4,
      `WARNING(1.0) -> ACTIVE(0.0) slab ${i} continuity has zero teleport/snap`
    )
  }
  assert(
    Math.abs(wcData.dustMat.opacity - warnEndDustOpacity) < 1e-4,
    'WARNING(1.0) -> ACTIVE(0.0) dust opacity is C0 continuous'
  )

  let sawMidFall = false
  for (let s = 0; s <= 24; s += 1) {
    const p = s / 24
    updateHazardVisualState(wcMesh, 'active', p)
    wcData.wallMountGroup.updateMatrixWorld(true)
    invMountMat.copy(wcData.wallMountGroup.matrixWorld).invert()
    for (let i = 0; i < wcData.slabMeshes.length; i += 1) {
      partBox.setFromObject(wcData.slabMeshes[i]).applyMatrix4(invMountMat)
      if (i === 0 && partBox.min.y > 0.25 && partBox.min.y < 1.0) sawMidFall = true
      assert(
        partBox.min.y >= -0.005 &&
          partBox.min.z >= wallZ - 0.005 &&
          partBox.max.z <= wallZ + 1.25 &&
          partBox.min.x >= -1.25 &&
          partBox.max.x <= 1.25,
        `ACTIVE slab ${i} at p=${p.toFixed(2)} stays grounded/in-bounds (y>=${partBox.min.y.toFixed(3)}, z=${partBox.min.z.toFixed(3)}..${partBox.max.z.toFixed(3)})`
      )
    }
    for (let r = 0; r < wcData.wallRubbleMeshes.length; r += 1) {
      partBox.setFromObject(wcData.wallRubbleMeshes[r]).applyMatrix4(invMountMat)
      assert(
        partBox.min.y >= -0.005 &&
          partBox.min.z >= wallZ - 0.005 &&
          partBox.max.z <= wallZ + 1.2 &&
          partBox.min.x >= -1.25 &&
          partBox.max.x <= 1.25,
        `ACTIVE rubble ${r} at p=${p.toFixed(2)} never penetrates floor or wall (minY=${partBox.min.y.toFixed(3)}, minZ=${partBox.min.z.toFixed(3)})`
      )
    }
  }
  assert(sawMidFall, 'Slabs visibly fall continuously through mid-air under gravity')

  const activeEndSlabPos = wcData.slabMeshes.map((m) => m.position.clone())
  const activeEndDustOpacity = wcData.dustMat.opacity
  assert(activeEndDustOpacity < 1e-4, 'ACTIVE(1.0) dust fades smoothly to zero')
  updateHazardVisualState(wcMesh, 'disabled', 1.0)
  for (let i = 0; i < wcData.slabMeshes.length; i += 1) {
    assert(
      wcData.slabMeshes[i].position.distanceTo(activeEndSlabPos[i]) < 1e-4,
      `ACTIVE(1.0) -> DISABLED slab ${i} settles seamlessly without snapping`
    )
  }
  wcAgent.dispose()

  // C. All 4 wall orientations & oriented impact bounds (lateral safe, opposite safe, post-impact cutoff)
  const crossGrid = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  for (let r = 1; r <= 5; r += 1) crossGrid[r][3] = CELL_TYPES.PATH
  for (let c = 1; c <= 5; c += 1) crossGrid[3][c] = CELL_TYPES.PATH
  const crossMaze = { id: 'cross-50', seed: 5050, grid: crossGrid, start: { row: 5, col: 3 }, exit: { row: 1, col: 3 } }
  const sideChecks = [
    ['north', 1, 3],
    ['south', 5, 3],
    ['west', 3, 1],
    ['east', 3, 5],
  ]
  for (const [wallSide, r, c] of sideChecks) {
    const orientSpec = {
      id: `orient-${wallSide}`,
      type: HAZARD_TYPES.WALL_COLLAPSE,
      row: r,
      col: c,
      wallSide,
      wallRow:
        wallSide === 'north' ? r - 1 : wallSide === 'south' ? r + 1 : r,
      wallCol:
        wallSide === 'west' ? c - 1 : wallSide === 'east' ? c + 1 : c,
    }
    const oAgent = new HazardAgent(orientSpec, crossMaze)
    const oCell = gridToWorld(r, c, crossMaze)
    const yaw = oAgent.wallYaw
    const toWorld = (lx, lz) => ({
      x: oCell.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
      y: 0,
      z: oCell.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
    })
    const inPos = toWorld(0, -1.4)
    const latSafePos = toWorld(1.5, -1.4) // lateral > dangerHalfW (1.14m)
    const oppSafePos = toWorld(0, 0.8) // opposite side of same corridor cell

    assert(oAgent._isPointInWallCollapseArea(inPos.x, inPos.z), `${wallSide} in-zone check positive`)
    assert(!oAgent._isPointInWallCollapseArea(latSafePos.x, latSafePos.z), `${wallSide} lateral margin is outside danger zone`)
    assert(!oAgent._isPointInWallCollapseArea(oppSafePos.x, oppSafePos.z), `${wallSide} opposite lane is outside danger zone`)

    oAgent.update(0.05, { playerWorldPos: inPos, playerGridCell: { row: r, col: c } })
    oAgent.update(oAgent.config.warningDuration + 0.02, { playerWorldPos: latSafePos, playerGridCell: { row: r, col: c } })
    assert(oAgent.getState() === HAZARD_STATES.ACTIVE, `${wallSide} enters ACTIVE`)
    // Advance past impactWindowEndProgress (0.66) before stepping into rubble
    oAgent.update(oAgent.config.activeDuration * 0.72, { playerWorldPos: latSafePos, playerGridCell: { row: r, col: c } })
    const lateHit = oAgent.update(0.05, { playerWorldPos: inPos, playerGridCell: { row: r, col: c } })
    assert(lateHit === null, `${wallSide} deals ZERO phantom damage after active falling impact window passes`)
    oAgent.dispose()
  }

  // D. Multi-topology corridor clearance >= 1.60m across straight, L-corner, T-junction & 4-way
  const topoGrid50 = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  topoGrid50[1][1] = CELL_TYPES.PATH
  topoGrid50[1][2] = CELL_TYPES.PATH
  topoGrid50[1][3] = CELL_TYPES.PATH
  topoGrid50[2][1] = CELL_TYPES.PATH
  topoGrid50[3][1] = CELL_TYPES.PATH
  topoGrid50[3][2] = CELL_TYPES.PATH
  topoGrid50[3][3] = CELL_TYPES.PATH
  topoGrid50[3][4] = CELL_TYPES.PATH
  topoGrid50[3][5] = CELL_TYPES.PATH
  topoGrid50[2][3] = CELL_TYPES.PATH
  topoGrid50[4][3] = CELL_TYPES.PATH
  topoGrid50[5][3] = CELL_TYPES.PATH
  const topoMaze50 = { id: 'topo-50', seed: 5051, grid: topoGrid50, start: { row: 5, col: 3 }, exit: { row: 1, col: 1 } }
  for (const [label, r, c] of [
    ['EW straight', 1, 2],
    ['NS straight', 2, 1],
    ['L-corner', 1, 1],
    ['T-junction', 1, 3],
  ]) {
    const tHaz = new HazardAgent(
      { id: `topo-wall-${r}-${c}`, type: HAZARD_TYPES.WALL_COLLAPSE, row: r, col: c },
      topoMaze50
    )
    const tmpl = tHaz.getColliderSpecs()[0]
    const check = validateHazardColliderPlacement(
      topoMaze50,
      { id: tmpl.id, kind: tmpl.kind, cx: tmpl.cx, cz: tmpl.cz, halfW: tmpl.halfW, halfD: tmpl.halfD, yaw: tmpl.yaw },
      { radius: PLAYER_RADIUS }
    )
    assert(check.valid, `${label} wall_collapse collider keeps safe >=1.60m passage`)
    tHaz.dispose()
  }

  // E. End-to-End Engine: Safe decoys zero reaction, OBB rubble collision, Clear Fallen Masonry LOS/range & masonry clearing, reset, maze replace & pool check
  const wEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  wEngine.setMaze(wcMaze)
  wEngine.cancelSpawnSequence()

  const liveWallDecoys = wEngine._mazeGroup?.userData?.wallCollapseDecoysGroup?.userData?.decoys || []
  assert(liveWallDecoys.length >= 2, 'Engine maze spawns safe wall-collapse decoys')
  for (const d of liveWallDecoys) {
    const dcPos = gridToWorld(d.row, d.col, wcMaze)
    const testX = dcPos.x + (-1.3) * Math.sin(d.wallYaw)
    const testZ = dcPos.z + (-1.3) * Math.cos(d.wallYaw)
    wEngine.setPlayerWorldPosition(testX, 0, testZ, { immediate: true })
    for (let step = 0; step < 8; step += 1) {
      wEngine.stepFrame(0.3, { render: false })
    }
    assert(wEngine.health === 100, `Safe wall decoy ${d.id} deals ZERO damage`)
    assert(wEngine.getNearbyInteractable() === null, `Safe wall decoy ${d.id} emits zero hazard prompt`)
  }

  const liveWallHaz = wEngine.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.WALL_COLLAPSE)
  assert(liveWallHaz, 'Engine spawns live wall_collapse hazard')
  const rubbleColId = `${liveWallHaz.id}:aftermath-rubble`
  assert(
    getDynamicCollider(wEngine._propCollisionIndex, rubbleColId)?.enabled === false,
    'Aftermath rubble collider starts disabled while wall is intact dormant'
  )

  const liveArea50 = liveWallHaz.getDangerArea()
  wEngine.setPlayerWorldPosition(liveArea50.center.x, 0, liveArea50.center.z, { immediate: true })
  wEngine.stepFrame(0.05, { render: false })
  assert(liveWallHaz.getState() === HAZARD_STATES.WARNING, 'Approaching wall_collapse enters WARNING')
  assert(
    liveWallHaz.canPlayerInteract(wEngine.getPlayerWorldPosition(), { row: liveWallHaz.row, col: liveWallHaz.col }) === false,
    'Clear Fallen Masonry is unavailable while wall has not collapsed yet'
  )

  // Dodge cleanly to open side of corridor
  const oppX = liveArea50.center.x + liveWallHaz.collapseDir.x * 1.45
  const oppZ = liveArea50.center.z + liveWallHaz.collapseDir.z * 1.45
  wEngine.setPlayerWorldPosition(oppX, 0, oppZ, { immediate: true })
  wEngine.stepFrame(liveWallHaz.config.warningDuration + 0.08, { render: false })
  assert(liveWallHaz.getState() === HAZARD_STATES.ACTIVE, 'Wall enters ACTIVE collapse after warning')
  wEngine.stepFrame(liveWallHaz.config.activeDuration + 0.1, { render: false })
  assert(
    liveWallHaz.getState() === HAZARD_STATES.DISABLED &&
      liveWallHaz.isPermanentlyCollapsed === true &&
      wEngine.health === 100,
    'Dodging cleanly outside collapse apron avoids damage while wall finishes permanent collapse'
  )
  assert(
    getDynamicCollider(wEngine._propCollisionIndex, rubbleColId)?.enabled === true,
    'Aftermath rubble collider stays active after collapse completes'
  )

  // Verify rubble collider blocks entry & resolveSafePushOut rescues overlap
  const attemptWalk = moveWithSubsteps(
    oppX,
    oppZ,
    liveArea50.center.x - oppX,
    liveArea50.center.z - oppZ,
    wcMaze,
    { radius: PLAYER_RADIUS, propColliders: wEngine._propCollisionIndex }
  )
  assert(
    Math.hypot(attemptWalk.x - liveArea50.center.x, attemptWalk.z - liveArea50.center.z) > 0.35,
    'Collapsed masonry OBB blocks walking into fallen slabs'
  )
  const rescued50 = resolveSafePushOut(
    liveArea50.center.x,
    liveArea50.center.z,
    wcMaze,
    { radius: PLAYER_RADIUS, propColliders: wEngine._propCollisionIndex }
  )
  assert(rescued50.pushed && rescued50.safe, 'resolveSafePushOut resolves overlap with fallen masonry safely')

  // Verify LOS across solid wall & out-of-range block Clear Fallen Masonry
  const behindWallPos = gridToWorld(liveWallHaz.wallRow, liveWallHaz.wallCol, wcMaze)
  const beyondWallR = liveWallHaz.wallRow + (liveWallHaz.wallRow - liveWallHaz.row)
  const beyondWallC = liveWallHaz.wallCol + (liveWallHaz.wallCol - liveWallHaz.col)
  if (wcMaze.grid[beyondWallR]?.[beyondWallC] === CELL_TYPES.PATH) {
    const acrossWallWorld = gridToWorld(beyondWallR, beyondWallC, wcMaze)
    assert(
      liveWallHaz.canPlayerInteract({ x: acrossWallWorld.x, y: 0, z: acrossWallWorld.z }, { row: beyondWallR, col: beyondWallC }) === false,
      'Solid wall blocks Clear Fallen Masonry via LOS occlusion'
    )
  } else {
    assert(
      liveWallHaz.canPlayerInteract({ x: behindWallPos.x, y: 0, z: behindWallPos.z }, null) === false,
      'Out-of-cell/wall position cannot interact'
    )
  }
  assert(
    liveWallHaz.canPlayerInteract({ x: liveArea50.center.x + 3.2, y: 0, z: liveArea50.center.z }, null) === false,
    'Out-of-range (>2.25m) blocks Clear Fallen Masonry'
  )

  wEngine.setPlayerWorldPosition(oppX, 0, oppZ, { immediate: true })
  const prompt50 = wEngine.getNearbyInteractable()
  assert(
    prompt50 &&
      prompt50.kind === 'hazard' &&
      prompt50.id === liveWallHaz.id &&
      prompt50.label === 'Clear Fallen Masonry' &&
      liveWallHaz.getInteractableDescriptor(wEngine.getPlayerWorldPosition())?.action === 'clear_rubble',
    'Standing in corridor beside fallen masonry surfaces "Clear Fallen Masonry" prompt'
  )

  const clearRes50 = wEngine.interact()
  assert(
    clearRes50 &&
      clearRes50.handled === true &&
      clearRes50.action === 'clear_rubble' &&
      liveWallHaz.isAftermathCleared === true &&
      getDynamicCollider(wEngine._propCollisionIndex, rubbleColId)?.enabled === false &&
      wEngine.getNearbyInteractable() === null,
    'Clear Fallen Masonry clears aftermath collider and hides prompt'
  )

  // Verify physical fallen slabs & rubble chunks visibly move out of passage into <= 0.30m wall margin
  const clearedData = liveWallHaz.getMesh().userData
  clearedData.wallMountGroup.updateMatrixWorld(true)
  const invClearMat = new THREE.Matrix4().copy(clearedData.wallMountGroup.matrixWorld).invert()
  const clearBox = new THREE.Box3()
  for (let i = 0; i < clearedData.slabMeshes.length; i += 1) {
    clearBox.setFromObject(clearedData.slabMeshes[i]).applyMatrix4(invClearMat)
    assert(
      clearBox.max.z <= clearedData.wallZ + 0.3 && clearBox.min.y >= -0.005,
      `Cleared slab ${i} stacks flush near wall margin (maxZ-wallZ=${(clearBox.max.z - clearedData.wallZ).toFixed(3)}m)`
    )
  }
  for (let i = 0; i < clearedData.wallRubbleMeshes.length; i += 1) {
    clearBox.setFromObject(clearedData.wallRubbleMeshes[i]).applyMatrix4(invClearMat)
    assert(
      clearBox.max.z <= clearedData.wallZ + 0.3 && clearBox.min.y >= -0.005,
      `Cleared rubble ${i} clears corridor passage (maxZ-wallZ=${(clearBox.max.z - clearedData.wallZ).toFixed(3)}m)`
    )
  }

  // Reset restores dormant concealed wall cleanly
  wEngine.resetCombat()
  assert(
    liveWallHaz.getState() === HAZARD_STATES.DORMANT &&
      liveWallHaz.isAftermathCleared === false &&
      clearedData.cavityMesh.visible === false &&
      clearedData.rebarGroup.visible === false &&
      getDynamicCollider(wEngine._propCollisionIndex, rubbleColId)?.enabled === false,
    'resetCombat restores intact concealed wall_collapse bay cleanly'
  )

  // Maze replacement disposes previous wall hazard and spawns replacement decoys
  const nextMaze50 = generateMaze({ difficulty: 'medium', seed: 667788 })
  wEngine.setMaze(nextMaze50)
  assert(
    liveWallHaz.isDisposed === true &&
      liveWallHaz.getMesh() === null &&
      wEngine._mazeGroup?.userData?.wallCollapseDecoysGroup?.userData?.decoyCount >= 2,
    'Maze replacement disposes previous wall_collapse agent and rebuilds fresh safe decoys'
  )

  const poolsBefore50 = getHazardPoolStats()
  wEngine.clearHazards()
  const poolsAfter50 = getHazardPoolStats()
  assert(
    poolsAfter50.geometries === poolsBefore50.geometries &&
      poolsAfter50.materials === poolsBefore50.materials,
    'Shared hazard geometry and material pools preserved across engine clearHazards()'
  )
  wEngine.dispose()
}
console.log('✓ Refined wall_collapse concealment, decoys, C0 physics, oriented danger, collision clearance & Clear Fallen Masonry verified')

// 51. Refined Falling Water Tank — Ceiling/Wall Anchoring, Safe Decoys, C0 Physics, Impact-Before-Surge, Multi-Topology Clearance & Move Fallen Tank
console.log('Test 51: Refined Falling Water Tank — Anchoring, Decoys, C0 Physics, Impact-Gated Surge, Clearance & Move Fallen Tank')
{
  const wtMaze = generateMaze({ seed: 771234, level: 26 })
  const wtHazards = placeHazards(wtMaze)
  const wtSpec = wtHazards.find((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK)
  assert(Boolean(wtSpec), 'Seed 771234 produces a falling_water_tank placement')

  // A. Structural flush anchoring (ceiling 3.60m, wall -2.00m, grounded riser) & decoy determinism/exclusions
  const builtWt = buildMazeMeshes(wtMaze, { qualityPreset: 'high' })
  const decoysList = builtWt.userData?.waterTankDecoysGroup?.userData?.decoys || []
  assert(decoysList.length >= 2, `Built maze places >= 2 safe water tank decoys (got ${decoysList.length})`)
  const decoysCheck = placeWaterTankDecoys(wtMaze, {
    hazards: wtHazards,
    placedProps: builtWt.userData?.environmentalProps || [],
  })
  assert(decoysCheck.length === decoysList.length, 'placeWaterTankDecoys count matches built maze decoys')

  const forbiddenKeys = new Set([
    `${wtMaze.start.row},${wtMaze.start.col}`,
    `${wtMaze.exit.row},${wtMaze.exit.col}`,
    ...wtHazards.map((h) => `${h.row},${h.col}`),
    ...(builtWt.userData?.environmentalProps || []).map((p) => `${p.row},${p.col}`),
  ])
  for (const d of decoysList) {
    const dk = `${d.row},${d.col}`
    assert(wtMaze.grid[d.row][d.col] === CELL_TYPES.PATH, `Decoy (${dk}) sits on walkable PATH cell`)
    assert(!forbiddenKeys.has(dk), `Decoy (${dk}) does not overlap start, exit, hazards, or props`)
    assert(
      Math.abs(d.row - wtMaze.start.row) + Math.abs(d.col - wtMaze.start.col) > 2,
      `Decoy (${dk}) respects start safety radius > 2`
    )
  }
  const decoyInstances = builtWt.userData.waterTankDecoysGroup.children
  assert(
    decoyInstances.length >= 4 && decoyInstances.every((c) => c.isInstancedMesh === true),
    'Water tank decoys use InstancedMesh layers sharing geometry/materials'
  )
  disposeMazeGroup(builtWt)

  // Verify local structural flush connections in mount frame for wall-braced and ceiling-only rigs
  for (const mountVariant of [
    { id: 'wt-wall-struct', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 1, col: 1, flowSide: 'south' },
    { id: 'wt-ceil-struct', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 3, col: 3, mountType: 'ceiling_suspended', wallSide: null, flowSide: 'south' },
  ]) {
    const stMesh = buildHazardMesh(mountVariant)
    const stData = stMesh.userData
    stData.supportGroup.updateMatrixWorld(true)
    const invMount = new THREE.Matrix4().copy(stData.tankMountGroup.matrixWorld).invert()
    const ceilingBox = new THREE.Box3().setFromObject(
      stData.supportGroup.getObjectByName('water-tank-ceiling-rig')
    ).applyMatrix4(invMount)
    assert(
      Math.abs(ceilingBox.max.y - WATER_TANK_CONSTANTS.ceilingAnchorY) < 1e-3,
      `${mountVariant.id} ceiling anchor plates sit flush at y=${WATER_TANK_CONSTANTS.ceilingAnchorY}`
    )
    if (stData.wallBraceGroup) {
      const braceBox = new THREE.Box3().setFromObject(stData.wallBraceGroup).applyMatrix4(invMount)
      assert(
        Math.abs(braceBox.min.z - (-CELL_SIZE * 0.5)) < 1e-3,
        `${mountVariant.id} wall brace/riser anchors flush against corridor wall z=-2.00`
      )
      assert(
        braceBox.min.y >= -1e-3 && braceBox.min.y < 0.03,
        `${mountVariant.id} floor riser pipework rests grounded at y=0 (minY=${braceBox.min.y.toFixed(4)})`
      )
    }
  }

  // B. Gravity-driven dormant droplets + exact C0 continuity + floor/wall containment + impact-before-surge ordering
  const physAgent = new HazardAgent(
    { id: 'wt-phys-51', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 1, col: 1, flowSide: 'south' },
    wtMaze
  )
  const physMesh = physAgent.getMesh()
  const pData = physMesh.userData

  updateHazardVisualState(physMesh, 'dormant', 0.1)
  const dropY1 = pData.leakDrops[0].position.y
  updateHazardVisualState(physMesh, 'dormant', 0.45)
  const dropY2 = pData.leakDrops[0].position.y
  assert(
    dropY2 < dropY1 && Math.abs(pData.tankGroup.position.y - pData.tankRestY) < 1e-6,
    `Dormant droplets descend under gravity (${dropY1.toFixed(3)} -> ${dropY2.toFixed(3)}) while tank remains suspended`
  )

  updateHazardVisualState(physMesh, 'dormant', 0)
  const dPos = pData.tankGroup.position.clone()
  updateHazardVisualState(physMesh, 'warning', 0)
  assert(
    pData.tankGroup.position.distanceTo(dPos) < 1e-4 && pData.puddleMat.opacity < 1e-4,
    'DORMANT -> WARNING(0) is C0 continuous'
  )

  updateHazardVisualState(physMesh, 'warning', 1)
  const wEndPos = pData.tankGroup.position.clone()
  const wEndRot = pData.tankGroup.rotation.clone()
  const wEndPuddleOp = pData.puddleMat.opacity
  updateHazardVisualState(physMesh, 'active', 0)
  assert(
    pData.tankGroup.position.distanceTo(wEndPos) < 1e-4 &&
      Math.hypot(pData.tankGroup.rotation.x - wEndRot.x, pData.tankGroup.rotation.z - wEndRot.z) < 1e-4 &&
      Math.abs(pData.puddleMat.opacity - wEndPuddleOp) < 1e-4,
    'WARNING(1) -> ACTIVE(0) transitions seamlessly with zero pose jump'
  )

  const mountBox = new THREE.Box3()
  const invMountMat = new THREE.Matrix4()
  for (let i = 0; i <= 25; i += 1) {
    const p = i / 25
    updateHazardVisualState(physMesh, 'active', p)
    pData.tankMountGroup.updateMatrixWorld(true)
    invMountMat.copy(pData.tankMountGroup.matrixWorld).invert()
    mountBox.setFromObject(pData.tankGroup).applyMatrix4(invMountMat)
    assert(
      mountBox.min.y >= -0.005,
      `Tank never penetrates floor at active=${p.toFixed(2)} (minY=${mountBox.min.y.toFixed(4)})`
    )
    assert(
      mountBox.min.x >= -1.8 && mountBox.max.x <= 1.8 && mountBox.min.z >= -1.9,
      `Tank remains inside corridor cell wall clearance at active=${p.toFixed(2)}`
    )
    if (p <= WATER_TANK_CONSTANTS.surgeStartProgress) {
      assert(
        pData.surgeGroup.visible === false && pData.surgeMat.opacity === 0,
        `Surge strictly dormant before tank ground impact (p=${p.toFixed(2)} <= ${WATER_TANK_CONSTANTS.surgeStartProgress})`
      )
    } else if (p >= 0.36 && p <= 0.8) {
      assert(
        pData.surgeGroup.visible === true && pData.surgeMat.opacity > 0.05,
        `Directional surge wave active after tank ground impact (p=${p.toFixed(2)})`
      )
    }
  }

  updateHazardVisualState(physMesh, 'active', 1)
  const aEndPos = pData.tankGroup.position.clone()
  const aEndRy = pData.tankGroup.rotation.y
  updateHazardVisualState(physMesh, 'disabled', 1)
  assert(
    pData.tankGroup.position.distanceTo(aEndPos) < 1e-4 &&
      Math.abs(pData.tankGroup.rotation.y - aEndRy) < 1e-4,
    'ACTIVE(1) -> DISABLED settles cleanly without snapping'
  )
  physAgent.dispose()

  // C. Wall-LOS occlusion check (adjacent hallway separated by solid wall takes zero hit/slowdown)
  const wallLosGrid = Array.from({ length: 5 }, () => Array(5).fill(CELL_TYPES.WALL))
  wallLosGrid[1][1] = CELL_TYPES.PATH
  wallLosGrid[2][1] = CELL_TYPES.PATH
  wallLosGrid[1][2] = CELL_TYPES.WALL
  wallLosGrid[1][3] = CELL_TYPES.PATH
  wallLosGrid[2][3] = CELL_TYPES.PATH
  wallLosGrid[3][1] = CELL_TYPES.PATH
  wallLosGrid[3][2] = CELL_TYPES.PATH
  wallLosGrid[3][3] = CELL_TYPES.PATH
  const wallLosMaze = {
    id: 'wt-los-51',
    seed: 5151,
    grid: wallLosGrid,
    start: { row: 3, col: 3 },
    exit: { row: 1, col: 3 },
  }
  const losAgent = new HazardAgent(
    { id: 'wt-los', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 1, col: 1, flowSide: 'south' },
    wallLosMaze
  )
  const wtC = gridToWorld(1, 1, wallLosMaze)
  const wtCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_WATER_TANK]
  losAgent.update(0.05, { playerWorldPos: { x: wtC.x, y: 0, z: wtC.z }, playerGridCell: { row: 1, col: 1 } })
  const wallEdgeBehind = gridToWorld(1, 3, wallLosMaze)
  const blockedHit = losAgent.update(wtCfg.warningDuration + wtCfg.activeDuration * 0.5, {
    playerWorldPos: { x: wallEdgeBehind.x - 1.5, y: 0, z: wallEdgeBehind.z },
    playerGridCell: { row: 1, col: 3 },
  })
  assert(blockedHit === null && losAgent.lastMovementEffect === null, 'Wall LOS blocks water tank hit and surge slowdown')
  losAgent.dispose()

  // D. Multi-topology aftermath corridor clearance >= 1.60m across straight, L-corner, T-junction & 4-way
  const topoGrid51 = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  topoGrid51[1][1] = CELL_TYPES.PATH
  topoGrid51[1][2] = CELL_TYPES.PATH
  topoGrid51[1][3] = CELL_TYPES.PATH
  topoGrid51[2][1] = CELL_TYPES.PATH
  topoGrid51[3][1] = CELL_TYPES.PATH
  topoGrid51[3][2] = CELL_TYPES.PATH
  topoGrid51[3][3] = CELL_TYPES.PATH
  topoGrid51[3][4] = CELL_TYPES.PATH
  topoGrid51[3][5] = CELL_TYPES.PATH
  topoGrid51[2][3] = CELL_TYPES.PATH
  topoGrid51[4][3] = CELL_TYPES.PATH
  topoGrid51[5][3] = CELL_TYPES.PATH
  const topoMaze51 = { id: 'topo-51', seed: 5152, grid: topoGrid51, start: { row: 5, col: 3 }, exit: { row: 1, col: 1 } }
  for (const [label, r, c] of [
    ['EW straight', 1, 2],
    ['NS straight', 2, 1],
    ['L-corner', 1, 1],
    ['T-junction', 1, 3],
    ['4-way intersection', 3, 3],
  ]) {
    const tAgent = new HazardAgent(
      { id: `topo-wt-${r}-${c}`, type: HAZARD_TYPES.FALLING_WATER_TANK, row: r, col: c },
      topoMaze51
    )
    const tmpl = tAgent.getColliderSpecs()[0]
    assert(tmpl && tmpl.id.endsWith(':aftermath-tank'), `${label} tank provides aftermath-tank OBB collider`)
    const check = validateHazardColliderPlacement(
      topoMaze51,
      { id: tmpl.id, kind: tmpl.kind, cx: tmpl.cx, cz: tmpl.cz, halfW: tmpl.halfW, halfD: tmpl.halfD, yaw: tmpl.yaw },
      { radius: PLAYER_RADIUS }
    )
    assert(check.valid, `${label} aftermath-tank OBB preserves >=1.60m passage clearance`)
    tAgent.dispose()
  }

  // E. End-to-End Engine: Safe decoys zero reaction, aftermath OBB collision, Move Fallen Tank clearing, reset, setMaze & pools
  const wtEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  wtEngine.setMaze(wtMaze)
  wtEngine.cancelSpawnSequence()

  const liveDecoys = wtEngine._mazeGroup?.userData?.waterTankDecoysGroup?.userData?.decoys || []
  assert(liveDecoys.length >= 2, 'Engine maze spawns safe water tank decoys')
  for (const d of liveDecoys) {
    const dPosW = gridToWorld(d.row, d.col, wtMaze)
    wtEngine.setPlayerWorldPosition(dPosW.x, 0, dPosW.z, { immediate: true })
    for (let s = 0; s < 8; s += 1) wtEngine.stepFrame(0.3, { render: false })
    assert(wtEngine.health === 100, `Safe decoy tank ${d.id} deals ZERO damage`)
    assert(wtEngine.getNearbyInteractable() === null, `Safe decoy tank ${d.id} emits zero interaction prompt`)
  }

  const liveWt = wtEngine.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK)
  assert(liveWt, 'Engine spawns live falling_water_tank hazard')
  const tankColId = `${liveWt.id}:aftermath-tank`
  assert(
    getDynamicCollider(wtEngine._propCollisionIndex, tankColId)?.enabled === false,
    'aftermath-tank OBB starts disabled while tank hangs overhead'
  )

  const liveWtArea = liveWt.getDangerArea()
  wtEngine.setPlayerWorldPosition(liveWtArea.center.x, 0, liveWtArea.center.z, { immediate: true })
  wtEngine.stepFrame(0.05, { render: false })
  assert(liveWt.getState() === HAZARD_STATES.WARNING, 'Approaching falling_water_tank triggers WARNING')
  assert(
    liveWt.canPlayerInteract(wtEngine.getPlayerWorldPosition(), { row: liveWt.row, col: liveWt.col }) === false,
    'Move Fallen Tank unavailable while tank has not fallen yet'
  )

  // Step safely behind tank while it drops & finishes surge
  const safeBackX = liveWtArea.center.x - liveWt.flowDir.x * 1.45
  const safeBackZ = liveWtArea.center.z - liveWt.flowDir.z * 1.45
  wtEngine.setPlayerWorldPosition(safeBackX, 0, safeBackZ, { immediate: true })
  wtEngine.stepFrame(liveWt.config.warningDuration + 0.08, { render: false })
  assert(liveWt.getState() === HAZARD_STATES.ACTIVE, 'Tank enters ACTIVE fall')
  wtEngine.stepFrame(liveWt.config.activeDuration + 0.1, { render: false })
  assert(
    liveWt.getState() === HAZARD_STATES.DISABLED &&
      liveWt.isPermanentlyCollapsed === true &&
      wtEngine.health === 100,
    'Dodging behind tank avoids damage and finishes collapse cleanly'
  )
  assert(
    getDynamicCollider(wtEngine._propCollisionIndex, tankColId)?.enabled === true,
    'aftermath-tank OBB remains active after collapse'
  )

  // Verify aftermath OBB blocks entry into fallen tank & push-out rescues
  const ftWorld = liveWt.fallenTankWorldPos
  const walkRes = moveWithSubsteps(
    liveWtArea.center.x,
    liveWtArea.center.z,
    ftWorld.x - liveWtArea.center.x,
    ftWorld.z - liveWtArea.center.z,
    wtMaze,
    { radius: PLAYER_RADIUS, propColliders: wtEngine._propCollisionIndex }
  )
  assert(
    Math.hypot(walkRes.x - ftWorld.x, walkRes.z - ftWorld.z) > 0.35,
    'Collapsed tank OBB prevents walking through tank hull'
  )
  const rescueRes = resolveSafePushOut(
    ftWorld.x,
    ftWorld.z,
    wtMaze,
    { radius: PLAYER_RADIUS, propColliders: wtEngine._propCollisionIndex }
  )
  assert(rescueRes.pushed && rescueRes.safe, 'resolveSafePushOut safely extracts overlap with fallen tank')

  // Verify out-of-range blocks Move Fallen Tank, and standing within 2.25m surfaces & executes it
  assert(
    liveWt.canPlayerInteract({ x: ftWorld.x + 3.2, y: 0, z: ftWorld.z }, null) === false,
    'Out-of-range (>2.25m) blocks Move Fallen Tank'
  )
  wtEngine.setPlayerWorldPosition(liveWtArea.center.x, 0, liveWtArea.center.z, { immediate: true })
  const nearbyPrompt = wtEngine.getNearbyInteractable()
  assert(
    nearbyPrompt &&
      nearbyPrompt.kind === 'hazard' &&
      nearbyPrompt.id === liveWt.id &&
      nearbyPrompt.label === 'Move Fallen Tank' &&
      liveWt.getInteractableDescriptor(wtEngine.getPlayerWorldPosition())?.action === 'clear_tank',
    'Standing near collapsed water tank surfaces "Move Fallen Tank" prompt'
  )

  const clearRes = wtEngine.interact()
  assert(
    clearRes &&
      clearRes.handled === true &&
      clearRes.action === 'clear_tank' &&
      liveWt.isAftermathCleared === true &&
      getDynamicCollider(wtEngine._propCollisionIndex, tankColId)?.enabled === false &&
      wtEngine.getNearbyInteractable() === null,
    'Move Fallen Tank disables aftermath-tank collider and clears prompt'
  )

  const clearedTankData = liveWt.getMesh().userData
  const expectedClearX = (clearedTankData.sideSign || 1) * WATER_TANK_CONSTANTS.clearedLocalX
  assert(
    Math.abs(clearedTankData.tankGroup.position.x - expectedClearX) < 1e-4 &&
      Math.abs(clearedTankData.tankGroup.position.y - WATER_TANK_CONSTANTS.tankFallenY) < 1e-4 &&
      Math.abs(clearedTankData.tankGroup.position.z - WATER_TANK_CONSTANTS.clearedLocalZ) < 1e-4,
    'Move Fallen Tank visibly moves fallen hull & debris flush to wall clearance'
  )

  // Reset restores overhead dormant tank cleanly
  wtEngine.resetCombat()
  assert(
    liveWt.getState() === HAZARD_STATES.DORMANT &&
      liveWt.isAftermathCleared === false &&
      Math.abs(clearedTankData.tankGroup.position.y - WATER_TANK_CONSTANTS.tankRestY) < 1e-4 &&
      getDynamicCollider(wtEngine._propCollisionIndex, tankColId)?.enabled === false,
    'resetCombat restores suspended dormant tank and clears aftermath state'
  )

  // Maze replacement disposes previous water tank hazard and spawns fresh decoys
  const nextMaze51 = generateMaze({ difficulty: 'medium', seed: 556677 })
  wtEngine.setMaze(nextMaze51)
  assert(
    liveWt.isDisposed === true &&
      liveWt.getMesh() === null &&
      wtEngine._mazeGroup?.userData?.waterTankDecoysGroup?.userData?.decoyCount >= 2,
    'Maze replacement disposes previous falling_water_tank agent and rebuilds safe decoys'
  )

  const poolsBefore51 = getHazardPoolStats()
  wtEngine.clearHazards()
  const poolsAfter51 = getHazardPoolStats()
  assert(
    poolsAfter51.geometries === poolsBefore51.geometries &&
      poolsAfter51.materials === poolsBefore51.materials,
    'Shared hazard geometry and material pools preserved across engine clearHazards()'
  )
  wtEngine.dispose()
}
console.log('✓ Refined falling_water_tank anchoring, safe decoys, C0 physics, impact-gated surge, multi-topology clearance & Move Fallen Tank verified')

// 52. Refined Falling Suspended Machinery — Ceiling Mounting/No Conflicts, Zero Yellow Bumper, Decoys, C0 Cable/Drop Physics, Grounding, Damage Bounds, Multi-Topology >= 1.60m Clearance, Move Fallen Machinery & Lifecycle
console.log('Test 52: Refined Falling Suspended Machinery — Mounting, Decoys, C0 Physics, Damage Bounds, >=1.60m Clearance, Interaction & Lifecycle')
{
  // Helper: check no yellow bumper geometry or stripe material exists inside an object tree
  const assertNoYellowBumper = (obj, label) => {
    obj.traverse((child) => {
      const name = String(child.name || '').toLowerCase()
      assert(!name.includes('bumper') && !name.includes('stripe'), `${label} has no yellow bumper node (${child.name})`)
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        for (const m of mats) {
          if (m?.color) {
            const isBrightYellow = m.color.r > 0.72 && m.color.g > 0.55 && m.color.b < 0.25
            assert(!isBrightYellow, `${label} has no bright yellow safety stripe material`)
          }
        }
      }
    })
  }

  // A. Mounting across all 4 structural ceiling parity buckets & wall corbels, zero ceiling fixture conflicts, zero yellow bumper
  const smGrid = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  for (let r = 1; r <= 5; r += 1) {
    for (let c = 1; c <= 5; c += 1) smGrid[r][c] = CELL_TYPES.PATH
  }
  smGrid[2][0] = CELL_TYPES.WALL
  smGrid[2][2] = CELL_TYPES.WALL
  smGrid[1][1] = CELL_TYPES.PATH
  smGrid[3][1] = CELL_TYPES.PATH
  smGrid[0][2] = CELL_TYPES.WALL
  smGrid[2][4] = CELL_TYPES.PATH
  smGrid[2][5] = CELL_TYPES.PATH
  const smParityMaze = { id: 'sm-parity-52', seed: 5201, grid: smGrid, start: { row: 5, col: 5 }, exit: { row: 5, col: 1 } }

  const parityCases = [
    ['girder_saddle', 2, 1, 'south', 'wall_to_wall_gantry', 3.04],
    ['rib_hanger', 3, 1, 'south', 'ceiling_gantry_rail', 3.38],
    ['cross_girder_saddle', 2, 3, 'east', 'ceiling_gantry_rail', 3.04],
    ['cross_rib_truss', 3, 3, 'east', 'ceiling_gantry_rail', 3.38],
  ]
  for (const [expectedStruct, r, c, dir, expectedMount, expectedBeamY] of parityCases) {
    const resolvedMount = resolveSuspendedMachineryMount(smGrid, r, c, null, dir)
    assert(
      resolvedMount.ceilingStructureType === expectedStruct &&
        resolvedMount.mountType === expectedMount &&
        Math.abs(resolvedMount.ceilingBeamY - expectedBeamY) < 1e-4,
      `Cell (${r},${c},${dir}) resolves ${expectedStruct} / ${expectedMount} at beamY=${expectedBeamY} (got ${resolvedMount.ceilingStructureType}/${resolvedMount.mountType})`
    )

    const mAgent = new HazardAgent(
      { id: `sm-struct-${expectedStruct}`, type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: r, col: c, ...resolvedMount },
      smParityMaze
    )
    const mRoot = mAgent.getMesh()
    const mData = mRoot.userData
    assertNoYellowBumper(mRoot, `Machinery hazard (${expectedStruct})`)

    mData.machineryMountGroup.updateMatrixWorld(true)
    const invMount = new THREE.Matrix4().copy(mData.machineryMountGroup.matrixWorld).invert()
    const hangerBox = new THREE.Box3().setFromObject(mData.ceilingHangerGroup).applyMatrix4(invMount)
    const expectedCheekTopY = expectedBeamY === 3.04 ? 3.23 : 3.49
    assert(
      Math.abs(hangerBox.max.y - expectedCheekTopY) < 0.01 &&
        hangerBox.min.y <= SUSPENDED_MACHINERY_CONSTANTS.gantryBeamTopY + 0.01,
      `${expectedStruct} hanger grips monorail top (${hangerBox.min.y.toFixed(3)}) and embraces concrete beamY=${expectedBeamY} sides up to ${expectedCheekTopY} (${hangerBox.max.y.toFixed(3)})`
    )
    // Stay strictly clear of girder-flank electrical trays (|z| >= 0.44) and cell ceiling lights (|z| >= 0.55 on odd,odd)
    assert(
      Math.max(Math.abs(hangerBox.min.z), Math.abs(hangerBox.max.z)) < 0.435,
      `${expectedStruct} hanger stays clear of girder-flank electrical trays (|z| <= ${Math.max(Math.abs(hangerBox.min.z), Math.abs(hangerBox.max.z)).toFixed(3)} < 0.44)`
    )
    assert(
      Math.max(Math.abs(hangerBox.min.x), Math.abs(hangerBox.max.x)) < 0.95,
      `${expectedStruct} hanger stays centered inside corridor ceiling span`
    )
    if (expectedMount === 'wall_to_wall_gantry') {
      assert(mData.wallBracketsGroup !== null, `${expectedStruct} mounts flanking wall corbels`)
      const corbelBox = new THREE.Box3().setFromObject(mData.wallBracketsGroup).applyMatrix4(invMount)
      assert(
        Math.abs(corbelBox.min.x - (-CELL_SIZE * 0.5)) < 0.01 &&
          Math.abs(corbelBox.max.x - CELL_SIZE * 0.5) < 0.01,
        `Wall-to-wall corbel plates seat flush at +/-${CELL_SIZE * 0.5}m (got ${corbelBox.min.x.toFixed(3)}..${corbelBox.max.x.toFixed(3)})`
      )
    }
    mAgent.dispose()
  }

  // B. Deterministic safe decoys with full exclusions, shared facility materials/pools, and zero yellow bumper
  const smMaze = generateMaze({ seed: 771234, level: 26 })
  const smHazards = placeHazards(smMaze)
  const smSpec = smHazards.find((h) => h.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY)
  assert(Boolean(smSpec), 'Seed 771234 includes falling_suspended_machinery')

  const builtSm = buildMazeMeshes(smMaze, { qualityPreset: 'high' })
  assertNoYellowBumper(builtSm, 'Built maze + suspended machinery decoys')
  const decoyGroup = builtSm.userData?.suspendedMachineryDecoysGroup
  const smDecoys = decoyGroup?.userData?.decoys || []
  assert(smDecoys.length >= 2, `Built maze places >= 2 safe machinery decoys (got ${smDecoys.length})`)

  const smProps = placeEnvironmentalProps(smMaze, { hazards: smHazards })
  const excludedFloorDecoys = builtSm.userData?.floorGrateDecoysGroup?.userData?.decoys || []
  const excludedWallDecoys = builtSm.userData?.wallCollapseDecoysGroup?.userData?.decoys || []
  const excludedWaterDecoys = builtSm.userData?.waterTankDecoysGroup?.userData?.decoys || []
  const smDecoysCheck = placeSuspendedMachineryDecoys(smMaze, {
    hazards: smHazards,
    placedProps: smProps,
    excludedCells: [
      ...(smMaze.hidingSpots || []),
      ...excludedFloorDecoys,
      ...excludedWallDecoys,
      ...excludedWaterDecoys,
    ],
  })
  assert(
    JSON.stringify(smDecoysCheck) === JSON.stringify(smDecoys),
    'placeSuspendedMachineryDecoys is deterministic and matches maze decoy build'
  )

  const smForbidden = new Set([
    `${smMaze.start.row},${smMaze.start.col}`,
    `${smMaze.exit.row},${smMaze.exit.col}`,
    ...smHazards.map((h) => `${h.row},${h.col}`),
    ...smProps.map((p) => `${p.row},${p.col}`),
    ...excludedFloorDecoys.map((d) => `${d.row},${d.col}`),
    ...excludedWallDecoys.map((d) => `${d.row},${d.col}`),
    ...excludedWaterDecoys.map((d) => `${d.row},${d.col}`),
  ])
  for (const d of smDecoys) {
    const dk = `${d.row},${d.col}`
    assert(smMaze.grid[d.row][d.col] === CELL_TYPES.PATH, `Machinery decoy (${dk}) on PATH cell`)
    assert(!smForbidden.has(dk), `Machinery decoy (${dk}) avoids hazards, props, and other decoy layers`)
    assert(
      Math.abs(d.row - smMaze.start.row) + Math.abs(d.col - smMaze.start.col) > 2,
      `Machinery decoy (${dk}) respects start safety radius > 2`
    )
    const swingTargetRow = d.row + Math.round(d.swingDir.z)
    const swingTargetCol = d.col + Math.round(d.swingDir.x)
    assert(
      smMaze.grid[swingTargetRow]?.[swingTargetCol] === CELL_TYPES.PATH,
      `Machinery decoy (${dk}) orients down walkable corridor`
    )
  }
  assert(
    decoyGroup.children.length >= 4 && decoyGroup.children.every((c) => c.isInstancedMesh === true),
    'Suspended machinery decoys use pooled InstancedMesh layers'
  )
  disposeMazeGroup(builtSm)

  // C & D. Continuous C0 motion, progressive cable strain/snap, gravity fall, bounce settle, grounding & zero clipping
  const physAgent = new HazardAgent(
    { id: 'sm-phys-52', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: 2, col: 1, swingSide: 'south' },
    smParityMaze
  )
  const physMesh = physAgent.getMesh()
  const pd = physMesh.userData

  updateHazardVisualState(physMesh, 'dormant', 0)
  const dormPivotPos = pd.machinePivotGroup.position.clone()
  const dormBodyPos = pd.machineBodyGroup.position.clone()
  const dormTrolleyPos = pd.trolleyGroup.position.clone()
  const dormRearScaleY = pd.rearCable.scale.y

  updateHazardVisualState(physMesh, 'warning', 0)
  assert(
    pd.machinePivotGroup.position.distanceTo(dormPivotPos) < 1e-4 &&
      pd.machineBodyGroup.position.distanceTo(dormBodyPos) < 1e-4 &&
      pd.trolleyGroup.position.distanceTo(dormTrolleyPos) < 1e-4 &&
      Math.abs(pd.rearCable.scale.y - dormRearScaleY) < 1e-4,
    'DORMANT -> WARNING(0) is strictly C0 continuous across pivot, body, trolley, and cables'
  )

  updateHazardVisualState(physMesh, 'warning', 0.55)
  assert(
    pd.rearCable.scale.x < 1 &&
      pd.frontCable.scale.x < 1 &&
      pd.rearCable.scale.y > dormRearScaleY &&
      pd.rearCableStub.visible === false &&
      pd.frontCableStub.visible === false,
    'Warning phase progressively stretches/thins taut cables while remaining unbroken'
  )

  updateHazardVisualState(physMesh, 'warning', 1)
  const warn1PivotPos = pd.machinePivotGroup.position.clone()
  const warn1PivotRot = pd.machinePivotGroup.rotation.clone()
  const warn1BodyPos = pd.machineBodyGroup.position.clone()
  const warn1BodyRot = pd.machineBodyGroup.rotation.clone()
  const warn1TrolleyPos = pd.trolleyGroup.position.clone()
  const warn1RearRot = pd.rearCable.rotation.clone()
  const warn1FrontRot = pd.frontCable.rotation.clone()

  updateHazardVisualState(physMesh, 'active', 0)
  assert(
    pd.machinePivotGroup.position.distanceTo(warn1PivotPos) < 1e-4 &&
      Math.hypot(pd.machinePivotGroup.rotation.x - warn1PivotRot.x, pd.machinePivotGroup.rotation.z - warn1PivotRot.z) < 1e-4 &&
      pd.machineBodyGroup.position.distanceTo(warn1BodyPos) < 1e-4 &&
      Math.hypot(pd.machineBodyGroup.rotation.x - warn1BodyRot.x, pd.machineBodyGroup.rotation.z - warn1BodyRot.z) < 1e-4 &&
      pd.trolleyGroup.position.distanceTo(warn1TrolleyPos) < 1e-4 &&
      Math.hypot(pd.rearCable.rotation.x - warn1RearRot.x, pd.rearCable.rotation.z - warn1RearRot.z) < 1e-3 &&
      Math.hypot(pd.frontCable.rotation.x - warn1FrontRot.x, pd.frontCable.rotation.z - warn1FrontRot.z) < 1e-3,
    'WARNING(1) -> ACTIVE(0) hands off seamlessly across machinery, trolley, and dual cables'
  )

  // Verify asymmetric snap sequence: rear snaps first (0.04), front catches briefly until 0.16, stubs persist visibly
  updateHazardVisualState(physMesh, 'active', 0.08)
  assert(
    pd.rearCableStub.visible === true && pd.frontCableStub.visible === false && pd.rearCable.visible === true,
    'Rear cable detaches cleanly with lower stub before front cable snaps'
  )
  updateHazardVisualState(physMesh, 'active', 0.22)
  assert(
    pd.rearCableStub.visible === true &&
      pd.frontCableStub.visible === true &&
      pd.rearCable.visible === true &&
      pd.frontCable.visible === true,
    'Both snapped cables preserve upper whips and lower shackle stubs without vanishing'
  )

  // Sweep active 0..1 across 40 steps: verify no teleport jumps, gravity acceleration, zero floor/wall/ceiling clipping
  let prevY = warn1BodyPos.y
  let prevDropDelta = 0
  let sawBounce = false
  let minObservedY = Infinity
  const bodyBox = new THREE.Box3()
  const invM = new THREE.Matrix4()
  for (let i = 1; i <= 40; i += 1) {
    const p = i / 40
    updateHazardVisualState(physMesh, 'active', p)
    pd.machineryMountGroup.updateMatrixWorld(true)
    invM.copy(pd.machineryMountGroup.matrixWorld).invert()
    bodyBox.setFromObject(pd.machineBodyGroup).applyMatrix4(invM)
    minObservedY = Math.min(minObservedY, bodyBox.min.y)

    assert(bodyBox.min.y >= -0.005, `Machinery never penetrates floor at active=${p.toFixed(3)} (minY=${bodyBox.min.y.toFixed(4)})`)
    assert(
      bodyBox.min.x >= -1.88 && bodyBox.max.x <= 1.88,
      `Machinery stays inside corridor walls at active=${p.toFixed(3)} (x=${bodyBox.min.x.toFixed(2)}..${bodyBox.max.x.toFixed(2)})`
    )
    assert(
      bodyBox.max.y <= SUSPENDED_MACHINERY_CONSTANTS.gantryBeamTopY + 0.02,
      `Falling machinery does not clip ceiling girders at active=${p.toFixed(3)} (maxY=${bodyBox.max.y.toFixed(2)})`
    )

    if (p <= 0.45) {
      const dy = prevY - pd.machineBodyGroup.position.y
      if (i >= 4) {
        assert(dy >= prevDropDelta - 0.015, `Gravity fall speeds up during initial drop at p=${p.toFixed(3)}`)
      }
      prevDropDelta = dy
    } else if (p > 0.52 && p < 0.78 && pd.machineBodyGroup.position.y > SUSPENDED_MACHINERY_CONSTANTS.fallenY - SUSPENDED_MACHINERY_CONSTANTS.pivotY + 0.002) {
      sawBounce = true
    }
    prevY = pd.machineBodyGroup.position.y
  }
  assert(sawBounce, 'Impact includes realistic damped floor settle/bounce before resting flat')

  updateHazardVisualState(physMesh, 'active', 1)
  const act1BodyPos = pd.machineBodyGroup.position.clone()
  const act1BodyRot = pd.machineBodyGroup.rotation.clone()
  pd.machineryMountGroup.updateMatrixWorld(true)
  invM.copy(pd.machineryMountGroup.matrixWorld).invert()
  bodyBox.setFromObject(pd.machineBodyGroup).applyMatrix4(invM)
  assert(
    bodyBox.min.y >= -0.004 && bodyBox.min.y <= 0.04,
    `Grounded resting chassis sits directly on floor (minY=${bodyBox.min.y.toFixed(4)})`
  )
  updateHazardVisualState(physMesh, 'disabled', 1)
  assert(
    pd.machineBodyGroup.position.distanceTo(act1BodyPos) < 1e-4 &&
      Math.hypot(pd.machineBodyGroup.rotation.x - act1BodyRot.x, pd.machineBodyGroup.rotation.y - act1BodyRot.y) < 1e-4,
    'ACTIVE(1) -> DISABLED matches seamlessly without pose snap'
  )
  physAgent.dispose()

  // E. Precise danger timing, lateral wall dodge vs crash side, wall LOS occlusion & single-hit protection
  const dmgCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]
  const wallLosGrid52 = Array.from({ length: 5 }, () => Array(5).fill(CELL_TYPES.WALL))
  wallLosGrid52[1][1] = CELL_TYPES.PATH
  wallLosGrid52[2][1] = CELL_TYPES.PATH
  wallLosGrid52[3][1] = CELL_TYPES.PATH
  wallLosGrid52[1][2] = CELL_TYPES.WALL
  wallLosGrid52[2][2] = CELL_TYPES.WALL
  wallLosGrid52[3][2] = CELL_TYPES.PATH
  wallLosGrid52[1][3] = CELL_TYPES.PATH
  wallLosGrid52[2][3] = CELL_TYPES.PATH
  wallLosGrid52[3][3] = CELL_TYPES.PATH
  const wallLosMaze52 = { id: 'sm-los-52', seed: 5202, grid: wallLosGrid52, start: { row: 3, col: 3 }, exit: { row: 1, col: 3 } }

  // 1) Opposite safe lateral wall dodge during crash phase deals 0 damage
  const sideDodgeAgent = new HazardAgent(
    { id: 'sm-side-dodge', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: 2, col: 1, swingSide: 'south' },
    wallLosMaze52
  )
  const smOrigin = gridToWorld(2, 1, wallLosMaze52)
  sideDodgeAgent.update(0.05, { playerWorldPos: { x: smOrigin.x, y: 0, z: smOrigin.z }, playerGridCell: { row: 2, col: 1 } })
  // Stand at opposite lateral wall (-sideSign * 1.25, z = +0.72) across active fall -> safe!
  const oppX = smOrigin.x - (sideDodgeAgent.sideSign || 1) * 1.25
  const oppCtx = {
    playerWorldPos: { x: oppX, y: 0, z: smOrigin.z + 0.72 },
    playerGridCell: { row: 2, col: 1 },
  }
  assert(sideDodgeAgent.update(dmgCfg.warningDuration + 0.05, oppCtx) === null, 'Opposite wall takes 0 damage on swing release')
  const oppHit = sideDodgeAgent.update(dmgCfg.activeDuration * 0.45, oppCtx)
  assert(oppHit === null, 'Standing against opposite corridor wall away from crash side takes 0 damage')
  sideDodgeAgent.dispose()

  // 2) Settling tail (activeProgress > 0.72) deals 0 late damage
  const lateAgent = new HazardAgent(
    { id: 'sm-late-safe', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: 2, col: 1, swingSide: 'south' },
    wallLosMaze52
  )
  const fCrash = lateAgent.fallenMachineryWorldPos
  lateAgent.update(0.05, { playerWorldPos: { x: smOrigin.x, y: 0, z: smOrigin.z }, playerGridCell: { row: 2, col: 1 } })
  const safeAwayCtx = {
    playerWorldPos: { x: smOrigin.x + 3.0, y: 0, z: smOrigin.z },
    playerGridCell: { row: 3, col: 1 },
  }
  lateAgent.update(dmgCfg.warningDuration + 0.05, safeAwayCtx)
  lateAgent.update(dmgCfg.activeDuration * 0.78, safeAwayCtx)
  const lateEnter = lateAgent.update(0.05, {
    playerWorldPos: { x: fCrash.x, y: 0, z: fCrash.z },
    playerGridCell: { row: 2, col: 1 },
  })
  assert(lateEnter === null, 'Walking near already-grounded machinery after physical danger window (p>0.72) deals 0 damage')
  lateAgent.dispose()

  // 3) Solid maze wall blocks machinery impact LOS
  const losAgent52 = new HazardAgent(
    { id: 'sm-wall-los', type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: 2, col: 1, swingSide: 'south' },
    wallLosMaze52
  )
  losAgent52.update(0.05, { playerWorldPos: { x: smOrigin.x, y: 0, z: smOrigin.z }, playerGridCell: { row: 2, col: 1 } })
  const behindWallPos = gridToWorld(2, 3, wallLosMaze52)
  const wallBlocked = losAgent52.update(dmgCfg.warningDuration + 0.08, {
    playerWorldPos: { x: behindWallPos.x - 1.5, y: 0, z: behindWallPos.z },
    playerGridCell: { row: 2, col: 3 },
  })
  assert(wallBlocked === null, 'Solid intervening maze wall blocks falling machinery damage')
  losAgent52.dispose()

  // F. Multi-topology aftermath OBB alignment & >= 1.60m passage clearance across all 5 topologies
  const topoGrid52 = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  topoGrid52[1][1] = CELL_TYPES.PATH
  topoGrid52[1][2] = CELL_TYPES.PATH
  topoGrid52[1][3] = CELL_TYPES.PATH
  topoGrid52[2][1] = CELL_TYPES.PATH
  topoGrid52[3][1] = CELL_TYPES.PATH
  topoGrid52[3][2] = CELL_TYPES.PATH
  topoGrid52[3][3] = CELL_TYPES.PATH
  topoGrid52[3][4] = CELL_TYPES.PATH
  topoGrid52[3][5] = CELL_TYPES.PATH
  topoGrid52[2][3] = CELL_TYPES.PATH
  topoGrid52[4][3] = CELL_TYPES.PATH
  topoGrid52[5][3] = CELL_TYPES.PATH
  const topoMaze52 = { id: 'topo-52', seed: 5203, grid: topoGrid52, start: { row: 5, col: 3 }, exit: { row: 1, col: 1 } }

  for (const [label, r, c] of [
    ['EW straight', 1, 2],
    ['NS straight', 2, 1],
    ['L-corner', 1, 1],
    ['T-junction', 1, 3],
    ['4-way intersection', 3, 3],
  ]) {
    const tAgent = new HazardAgent(
      { id: `topo-sm-${r}-${c}`, type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, row: r, col: c },
      topoMaze52
    )
    const tmpl = tAgent.getColliderSpecs()[0]
    assert(tmpl && tmpl.id.endsWith(':aftermath-machinery'), `${label} machinery provides aftermath-machinery OBB`)
    assert(tmpl.enabled === false, `${label} aftermath-machinery OBB starts disabled while overhead`)

    const clearanceCheck = validateHazardColliderPlacement(
      topoMaze52,
      { id: tmpl.id, kind: tmpl.kind, cx: tmpl.cx, cz: tmpl.cz, halfW: tmpl.halfW, halfD: tmpl.halfD, yaw: tmpl.yaw },
      { radius: PLAYER_RADIUS, minClearance: 1.6 }
    )
    assert(
      clearanceCheck.valid === true,
      `${label} aftermath-machinery preserves >= 1.60m passage clearance (got valid=${clearanceCheck.valid}, clearance=${clearanceCheck.clearance?.toFixed?.(2)})`
    )

    // Verify collider OBB aligns accurately with grounded 3D machineBodyGroup world Box3
    updateHazardVisualState(tAgent.getMesh(), 'disabled', 1)
    tAgent.getMesh().updateMatrixWorld(true)
    const fallenBoxW = new THREE.Box3().setFromObject(tAgent.getMesh().userData.machineBodyGroup)
    const meshCx = (fallenBoxW.min.x + fallenBoxW.max.x) * 0.5
    const meshCz = (fallenBoxW.min.z + fallenBoxW.max.z) * 0.5
    assert(
      Math.hypot(tmpl.cx - meshCx, tmpl.cz - meshCz) < 0.12,
      `${label} aftermath-machinery OBB center (${tmpl.cx.toFixed(2)}, ${tmpl.cz.toFixed(2)}) matches fallen mesh (${meshCx.toFixed(2)}, ${meshCz.toFixed(2)})`
    )
    tAgent.dispose()
  }

  // G & H. End-to-End Engine: Safe decoys, aftermath OBB blocking, Move Fallen Machinery relocation, reset, setMaze, clearHazards & pools
  const smEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  smEngine.setMaze(smMaze)
  smEngine.cancelSpawnSequence()

  const liveSmDecoys = smEngine._mazeGroup?.userData?.suspendedMachineryDecoysGroup?.userData?.decoys || []
  assert(liveSmDecoys.length >= 2, 'Engine maze spawns safe suspended machinery decoys')
  for (const d of liveSmDecoys) {
    const dw = gridToWorld(d.row, d.col, smMaze)
    smEngine.setPlayerWorldPosition(dw.x, 0, dw.z, { immediate: true })
    for (let s = 0; s < 8; s += 1) smEngine.stepFrame(0.3, { render: false })
    assert(smEngine.health === 100, `Safe machinery decoy ${d.id} deals ZERO damage`)
    assert(smEngine.getNearbyInteractable() === null, `Safe machinery decoy ${d.id} emits zero prompt`)
  }

  const liveSm = smEngine.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY)
  assert(liveSm, 'Engine spawns live falling_suspended_machinery hazard')
  const machColId = `${liveSm.id}:aftermath-machinery`
  assert(
    getDynamicCollider(smEngine._propCollisionIndex, machColId)?.enabled === false,
    'aftermath-machinery OBB starts disabled while overhead'
  )

  const liveSmArea = liveSm.getDangerArea()
  smEngine.setPlayerWorldPosition(liveSmArea.center.x, 0, liveSmArea.center.z, { immediate: true })
  smEngine.stepFrame(0.05, { render: false })
  assert(liveSm.getState() === HAZARD_STATES.WARNING, 'Approaching falling_suspended_machinery triggers WARNING')
  assert(
    liveSm.canPlayerInteract(smEngine.getPlayerWorldPosition(), { row: liveSm.row, col: liveSm.col }) === false,
    'Move Fallen Machinery unavailable before machinery collapses'
  )

  // Dodge safely behind gantry while cables snap & unit crashes
  const smOriginLive = gridToWorld(liveSm.row, liveSm.col, smMaze)
  const safeBackSmX = smOriginLive.x - liveSm.swingDir.x * 1.45
  const safeBackSmZ = smOriginLive.z - liveSm.swingDir.z * 1.45
  smEngine.setPlayerWorldPosition(safeBackSmX, 0, safeBackSmZ, { immediate: true })
  smEngine.stepFrame(liveSm.config.warningDuration + 0.08, { render: false })
  assert(liveSm.getState() === HAZARD_STATES.ACTIVE, 'Machinery transitions into ACTIVE fall')
  smEngine.stepFrame(liveSm.config.activeDuration + 0.1, { render: false })
  assert(
    liveSm.getState() === HAZARD_STATES.DISABLED &&
      liveSm.isPermanentlyCollapsed === true &&
      smEngine.health === 100,
    'Dodging behind swing-drop avoids damage and finishes collapse cleanly'
  )
  assert(
    getDynamicCollider(smEngine._propCollisionIndex, machColId)?.enabled === true,
    'aftermath-machinery OBB activates after grounded collapse'
  )

  // Verify aftermath OBB physically blocks player & push-out extracts safely without wall clipping
  const fmWorld = liveSm.fallenMachineryWorldPos
  const walkBlocked = moveWithSubsteps(
    smOriginLive.x,
    smOriginLive.z,
    fmWorld.x - smOriginLive.x,
    fmWorld.z - smOriginLive.z,
    smMaze,
    { radius: PLAYER_RADIUS, propColliders: smEngine._propCollisionIndex }
  )
  assert(
    walkBlocked.hitProp === true && Math.hypot(walkBlocked.x - fmWorld.x, walkBlocked.z - fmWorld.z) > 0.3,
    'Grounded fallen machinery OBB physically blocks player movement'
  )
  const rescueSm = resolveSafePushOut(fmWorld.x, fmWorld.z, smMaze, {
    radius: PLAYER_RADIUS,
    propColliders: smEngine._propCollisionIndex,
  })
  assert(rescueSm.pushed && rescueSm.safe, 'resolveSafePushOut extracts overlap safely respecting wall priority')

  // Verify interaction range, prompt, and physical relocation via Move Fallen Machinery
  assert(
    liveSm.canPlayerInteract({ x: fmWorld.x + 3.2, y: 0, z: fmWorld.z }, null) === false,
    'Out-of-range (>2.25m) rejects Move Fallen Machinery'
  )
  smEngine.setPlayerWorldPosition(smOriginLive.x, 0, smOriginLive.z, { immediate: true })
  smEngine.stepFrame(0.016, { render: false })
  const smPrompt = smEngine.getNearbyInteractable()
  assert(
    smPrompt &&
      smPrompt.kind === 'hazard' &&
      smPrompt.id === liveSm.id &&
      smPrompt.label === 'Move Fallen Machinery' &&
      liveSm.getInteractableDescriptor(smEngine.getPlayerWorldPosition())?.action === 'clear_machinery',
    'Standing near collapsed machinery surfaces "Move Fallen Machinery" prompt'
  )

  const clearSmRes = smEngine.interact()
  assert(
    clearSmRes &&
      clearSmRes.handled === true &&
      clearSmRes.action === 'clear_machinery' &&
      liveSm.isAftermathCleared === true &&
      getDynamicCollider(smEngine._propCollisionIndex, machColId)?.enabled === false &&
      smEngine.getNearbyInteractable() === null,
    'Move Fallen Machinery disables aftermath-machinery collider and clears prompt'
  )

  const clearedSmData = liveSm.getMesh().userData
  assert(
    Math.abs(clearedSmData.machineBodyGroup.position.x - clearedSmData.clearedLocalX) < 1e-4 &&
      Math.abs(clearedSmData.machineBodyGroup.position.y - (SUSPENDED_MACHINERY_CONSTANTS.fallenY - clearedSmData.pivotY)) < 1e-4 &&
      Math.abs(clearedSmData.machineBodyGroup.position.z - clearedSmData.clearedLocalZ) < 1e-4,
    'Move Fallen Machinery physically relocates fallen chassis flush against wall/corner clearance'
  )
  const walkCleared = moveWithSubsteps(
    smOriginLive.x,
    smOriginLive.z,
    fmWorld.x - smOriginLive.x,
    fmWorld.z - smOriginLive.z,
    smMaze,
    { radius: PLAYER_RADIUS, propColliders: smEngine._propCollisionIndex }
  )
  assert(
    Math.hypot(walkCleared.x - fmWorld.x, walkCleared.z - fmWorld.z) < 0.08,
    'Corridor through prior crash footprint is physically navigable once machinery is moved aside'
  )

  // Reset restores suspended machinery overhead and resets aftermath state
  smEngine.resetCombat()
  assert(
    liveSm.getState() === HAZARD_STATES.DORMANT &&
      liveSm.isAftermathCleared === false &&
      Math.abs(clearedSmData.machineBodyGroup.position.y - clearedSmData.restDropY) < 1e-4 &&
      getDynamicCollider(smEngine._propCollisionIndex, machColId)?.enabled === false,
    'resetCombat restores suspended dormant machinery and clears aftermath state'
  )

  // Maze replacement disposes prior hazard and rebuilds safe decoys
  const nextMaze52 = generateMaze({ difficulty: 'medium', seed: 667788 })
  smEngine.setMaze(nextMaze52)
  assert(
    liveSm.isDisposed === true &&
      liveSm.getMesh() === null &&
      smEngine._mazeGroup?.userData?.suspendedMachineryDecoysGroup?.userData?.decoyCount >= 2,
    'Maze replacement disposes previous falling_suspended_machinery agent and rebuilds safe decoys'
  )

  const poolsBefore52 = getHazardPoolStats()
  smEngine.clearHazards()
  const poolsAfter52 = getHazardPoolStats()
  assert(
    poolsAfter52.geometries === poolsBefore52.geometries &&
      poolsAfter52.materials === poolsBefore52.materials,
    'Shared hazard geometry and material pools preserved across clearHazards()'
  )
  smEngine.dispose()
}
console.log('✓ Refined falling_suspended_machinery mounting, zero yellow bumper, decoys, C0 physics, damage bounds, >=1.60m clearance, Move Fallen Machinery & lifecycle verified')

// 53. Refined Ventilation Duct Collapse — Ceiling Clearance Parity, Decoys, C0 Warning/Drop Physics, Grounding, Wall LOS, >= 1.60m Clearance, Move Fallen Duct & Lifecycle
console.log('Test 53: Refined Ventilation Duct Collapse — Ceiling Parity, Decoys, C0 Physics, Damage Bounds, >=1.60m Clearance, Interaction & Lifecycle')
{
  const assertNoYellowTell = (obj, label) => {
    obj.traverse((child) => {
      const name = String(child.name || '').toLowerCase()
      assert(!name.includes('bumper') && !name.includes('caution'), `${label} has no yellow caution tell (${child.name})`)
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        for (const m of mats) {
          if (m?.color) {
            const isBrightYellow = m.color.r > 0.72 && m.color.g > 0.55 && m.color.b < 0.25
            assert(!isBrightYellow, `${label} has no bright yellow tell material`)
          }
        }
      }
    })
  }

  // A. Ceiling structural configurations across all 5 parity buckets without blind lowering or clipping
  const vdGrid = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  for (let r = 1; r <= 5; r += 1) {
    for (let c = 1; c <= 5; c += 1) vdGrid[r][c] = CELL_TYPES.PATH
  }
  const vdParityMaze = { id: 'vd-parity-53', seed: 5301, grid: vdGrid, start: { row: 5, col: 5 }, exit: { row: 5, col: 1 } }

  const ductParityCases = [
    ['girder_intersection', 2, 2, 'south', 3.04, 2.83],
    ['girder_saddle', 3, 2, 'south', 3.04, 2.83],
    ['cross_girder_saddle', 2, 3, 'south', 3.04, 2.83],
    ['rib_hanger', 3, 1, 'east', 3.38, 3.16],
    ['cross_rib_truss', 3, 3, 'south', 3.38, 3.16],
  ]
  const resolvedRestByType = {}
  for (const [expectedStruct, r, c, dir, expectedBeamY, expectedRestY] of ductParityCases) {
    const resolved = resolveVentilationDuctMount(vdGrid, r, c, null, dir)
    assert(
      resolved.ceilingStructureType === expectedStruct &&
        Math.abs(resolved.ceilingBeamY - expectedBeamY) < 1e-4 &&
        Math.abs(resolved.ductRestY - expectedRestY) < 1e-4,
      `Cell (${r},${c},${dir}) resolves ${expectedStruct} at beamY=${expectedBeamY}, restY=${expectedRestY} (got ${resolved.ceilingStructureType}, beamY=${resolved.ceilingBeamY}, restY=${resolved.ductRestY})`
    )
    resolvedRestByType[expectedStruct] = resolved.ductRestY

    const dAgent = new HazardAgent(
      { id: `vd-struct-${expectedStruct}`, type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: r, col: c, ...resolved },
      vdParityMaze
    )
    const dRoot = dAgent.getMesh()
    const dd = dRoot.userData
    assertNoYellowTell(dRoot, `Vent duct hazard (${expectedStruct})`)

    dRoot.updateMatrixWorld(true)
    dd.ductMountGroup.updateMatrixWorld(true)
    const invMount = new THREE.Matrix4().copy(dd.ductMountGroup.matrixWorld).invert()
    const ductBox = new THREE.Box3().setFromObject(dd.ductBodyGroup).applyMatrix4(invMount)
    const saddleBox = new THREE.Box3().setFromObject(dd.ceilingSaddleMesh).applyMatrix4(invMount)
    const frontHangerBox = new THREE.Box3().setFromObject(dd.frontHangerGroup).applyMatrix4(invMount)
    const rearHangerBox = new THREE.Box3().setFromObject(dd.rearHangerGroup).applyMatrix4(invMount)

    assert(
      ductBox.max.y <= expectedBeamY - 0.008,
      `${expectedStruct} dormant duct flange/body top (${ductBox.max.y.toFixed(3)}) clears concrete beamY=${expectedBeamY}`
    )
    assert(
      saddleBox.max.y <= MAZE_CEILING_CONFIG.soffitY + 0.005,
      `${expectedStruct} saddle stays at or below soffitY=${MAZE_CEILING_CONFIG.soffitY} (maxY=${saddleBox.max.y.toFixed(3)})`
    )
    assert(
      frontHangerBox.min.y < dd.ductRestY && rearHangerBox.min.y < dd.ductRestY,
      `${expectedStruct} trapeze cradles seat cleanly underneath duct body`
    )
    // Stay strictly clear of girder-flank electrical cable trays (|z| in [0.435, 0.715])
    assert(
      Math.max(Math.abs(saddleBox.min.x), Math.abs(saddleBox.max.x)) <= 0.435,
      `${expectedStruct} saddle lateral width stays clear of girder cable trays`
    )
    assert(
      Math.abs(dd.frontHangerGroup.position.z) >= 0.74 && Math.abs(dd.rearHangerGroup.position.z) >= 0.74,
      `${expectedStruct} hangers avoid girder cable-tray Z corridor [0.435..0.715]`
    )
    dAgent.dispose()
  }
  assert(
    resolvedRestByType.rib_hanger > resolvedRestByType.girder_saddle + 0.25 &&
      resolvedRestByType.cross_rib_truss > resolvedRestByType.cross_girder_saddle + 0.25,
    'Rib-bay ventilation ducts mount higher than girder-bay ducts instead of being blindly lowered'
  )

  // Bulkhead duct connects flush to real backing wall (-2.0m) without protruding through wall face
  const bhMaze = generateMaze({ seed: 771234, level: 26 })
  const bhSpec = placeHazards(bhMaze).find(
    (h) => h.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE && h.mountType === 'wall_bulkhead_duct'
  )
  if (bhSpec) {
    const bhAgent = new HazardAgent(bhSpec, bhMaze)
    const bhd = bhAgent.getMesh().userData
    bhd.ductMountGroup.updateMatrixWorld(true)
    const invBh = new THREE.Matrix4().copy(bhd.ductMountGroup.matrixWorld).invert()
    const bhBox = new THREE.Box3().setFromObject(bhd.wallBulkheadGroup).applyMatrix4(invBh)
    assert(
      bhBox.min.z >= -CELL_SIZE * 0.5 - 0.03 && bhBox.max.z < 0,
      `Bulkhead intake collar seats against backing wall face (minZ=${bhBox.min.z.toFixed(3)})`
    )
    bhAgent.dispose()
  }

  // B. Deterministic ventilation duct decoys in buildMazeMeshes + visual parity + disposal
  const vdMaze = bhMaze
  const vdHazards = placeHazards(vdMaze)
  const vdSpec = vdHazards.find((h) => h.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE)
  assert(Boolean(vdSpec), 'Seed 771234 includes ventilation_duct_collapse')

  const builtVd = buildMazeMeshes(vdMaze, { qualityPreset: 'high' })
  assertNoYellowTell(builtVd, 'Built maze + ventilation duct decoys')
  const decoyGroup = builtVd.userData?.ventilationDuctDecoysGroup
  const vdDecoys = decoyGroup?.userData?.decoys || []
  assert(vdDecoys.length >= 2, `Built maze places >= 2 safe ventilation duct decoys (got ${vdDecoys.length})`)

  const vdProps = placeEnvironmentalProps(vdMaze, { hazards: vdHazards })
  const exclFloor = builtVd.userData?.floorGrateDecoysGroup?.userData?.decoys || []
  const exclWall = builtVd.userData?.wallCollapseDecoysGroup?.userData?.decoys || []
  const exclWater = builtVd.userData?.waterTankDecoysGroup?.userData?.decoys || []
  const exclMach = builtVd.userData?.suspendedMachineryDecoysGroup?.userData?.decoys || []
  const vdDecoysCheck = placeVentilationDuctDecoys(vdMaze, {
    hazards: vdHazards,
    placedProps: vdProps,
    excludedCells: [
      ...(vdMaze.hidingSpots || []),
      ...exclFloor,
      ...exclWall,
      ...exclWater,
      ...exclMach,
    ],
  })
  assert(
    JSON.stringify(vdDecoysCheck) === JSON.stringify(vdDecoys),
    'placeVentilationDuctDecoys is deterministic and matches maze decoy build'
  )

  const vdForbidden = new Set([
    `${vdMaze.start.row},${vdMaze.start.col}`,
    `${vdMaze.exit.row},${vdMaze.exit.col}`,
    ...vdHazards.map((h) => `${h.row},${h.col}`),
    ...vdProps.map((p) => `${p.row},${p.col}`),
    ...exclFloor.map((d) => `${d.row},${d.col}`),
    ...exclWall.map((d) => `${d.row},${d.col}`),
    ...exclWater.map((d) => `${d.row},${d.col}`),
    ...exclMach.map((d) => `${d.row},${d.col}`),
  ])
  for (const d of vdDecoys) {
    const dk = `${d.row},${d.col}`
    assert(vdMaze.grid[d.row][d.col] === CELL_TYPES.PATH, `Vent duct decoy (${dk}) on PATH cell`)
    assert(!vdForbidden.has(dk), `Vent duct decoy (${dk}) avoids hazards, props, and other decoy layers`)
    assert(
      Math.abs(d.row - vdMaze.start.row) + Math.abs(d.col - vdMaze.start.col) > 2,
      `Vent duct decoy (${dk}) respects start safety radius > 2`
    )
    const aheadRow = d.row + Math.round(d.dropDir.z)
    const aheadCol = d.col + Math.round(d.dropDir.x)
    assert(
      vdMaze.grid[aheadRow]?.[aheadCol] === CELL_TYPES.PATH,
      `Vent duct decoy (${dk}) aligns down walkable corridor`
    )
  }
  assert(
    decoyGroup.children.length >= 5 && decoyGroup.children.every((c) => c.isInstancedMesh === true),
    'Ventilation duct decoys use pooled InstancedMesh layers'
  )
  // Verify decoy material parity (pooled galvanized steel texture maps)
  const decoyGalvMesh = decoyGroup.children.find((c) => c.name === 'vent-duct-decoy-galv')
  assert(
    Boolean(decoyGalvMesh?.material?.map && decoyGalvMesh.material.roughnessMap && decoyGalvMesh.material.bumpMap),
    'Ventilation duct decoys share pooled galvanized steel texture maps with hazardous ducts'
  )
  disposeMazeGroup(builtVd)

  // C & D. C0 continuity DORMANT -> WARNING -> ACTIVE -> DISABLED, zero ceiling/floor/wall clipping & gravity bounce
  const physDuctAgent = new HazardAgent(
    { id: 'vd-phys-53', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: 3, col: 1, dropSide: 'south' },
    vdParityMaze
  )
  const physMesh = physDuctAgent.getMesh()
  const pdd = physMesh.userData

  updateHazardVisualState(physMesh, 'dormant', 0)
  const dPivotPos = pdd.ductPivotGroup.position.clone()
  const dBodyPos = pdd.ductBodyGroup.position.clone()
  const dFrontRotZ = pdd.frontHangerGroup.rotation.z

  updateHazardVisualState(physMesh, 'warning', 0)
  assert(
    pdd.ductPivotGroup.position.distanceTo(dPivotPos) < 1e-4 &&
      pdd.ductBodyGroup.position.distanceTo(dBodyPos) < 1e-4 &&
      Math.abs(pdd.frontHangerGroup.rotation.z - dFrontRotZ) < 1e-4 &&
      Math.abs(pdd.ductPivotGroup.rotation.x) < 1e-5,
    'DORMANT -> WARNING(0) is strictly C0 continuous'
  )

  // Sweep warning 0..1: verify progressive sag never lifts any duct corner above ceilingBeamY
  const warnBox = new THREE.Box3()
  const invWarnM = new THREE.Matrix4()
  for (let i = 0; i <= 10; i += 1) {
    const wp = i / 10
    updateHazardVisualState(physMesh, 'warning', wp)
    pdd.ductMountGroup.updateMatrixWorld(true)
    invWarnM.copy(pdd.ductMountGroup.matrixWorld).invert()
    warnBox.setFromObject(pdd.ductBodyGroup).applyMatrix4(invWarnM)
    assert(
      warnBox.max.y <= pdd.ceilingBeamY - 0.005,
      `Warning sag never clips ceiling structure at wp=${wp.toFixed(2)} (maxY=${warnBox.max.y.toFixed(3)} <= ${pdd.ceilingBeamY})`
    )
  }

  updateHazardVisualState(physMesh, 'warning', 1)
  pdd.ductMountGroup.updateMatrixWorld(true)
  const warnEndWorldPos = new THREE.Vector3()
  const warnEndWorldQuat = new THREE.Quaternion()
  pdd.ductBodyGroup.getWorldPosition(warnEndWorldPos)
  pdd.ductBodyGroup.getWorldQuaternion(warnEndWorldQuat)

  updateHazardVisualState(physMesh, 'active', 0)
  pdd.ductMountGroup.updateMatrixWorld(true)
  const actStartWorldPos = new THREE.Vector3()
  const actStartWorldQuat = new THREE.Quaternion()
  pdd.ductBodyGroup.getWorldPosition(actStartWorldPos)
  pdd.ductBodyGroup.getWorldQuaternion(actStartWorldQuat)
  assert(
    warnEndWorldPos.distanceTo(actStartWorldPos) < 1e-3 &&
      warnEndWorldQuat.angleTo(actStartWorldQuat) < 1e-3,
    `WARNING(1) -> ACTIVE(0) preserves exact world transform (dPos=${warnEndWorldPos.distanceTo(actStartWorldPos).toFixed(5)}, dAng=${warnEndWorldQuat.angleTo(actStartWorldQuat).toFixed(5)})`
  )

  // Sweep active 0..1 across 40 steps: verify gravity drop acceleration, damped bounce, zero floor/wall/ceiling clipping
  let prevY = pdd.ductBodyGroup.position.y
  let prevDy = 0
  let sawBounce = false
  const ductSweepBox = new THREE.Box3()
  const frontSweepBox = new THREE.Box3()
  const invActM = new THREE.Matrix4()
  const expectedFinalLocalY = pdd.fallenY - pdd.ductRestY
  for (let i = 1; i <= 40; i += 1) {
    const p = i / 40
    updateHazardVisualState(physMesh, 'active', p)
    pdd.ductMountGroup.updateMatrixWorld(true)
    invActM.copy(pdd.ductMountGroup.matrixWorld).invert()
    ductSweepBox.setFromObject(pdd.ductBodyGroup).applyMatrix4(invActM)
    frontSweepBox.setFromObject(pdd.frontHangerGroup).applyMatrix4(invActM)

    assert(
      ductSweepBox.min.y >= -0.004,
      `Falling duct never penetrates floor at active=${p.toFixed(3)} (minY=${ductSweepBox.min.y.toFixed(4)})`
    )
    assert(
      ductSweepBox.min.x >= -1.92 && ductSweepBox.max.x <= 1.92 &&
        ductSweepBox.min.z >= -1.88 && ductSweepBox.max.z <= 1.88,
      `Falling duct stays inside corridor bounds at active=${p.toFixed(3)}`
    )
    assert(
      ductSweepBox.max.y <= pdd.ceilingBeamY - 0.005,
      `Falling duct stays below ceiling beam at active=${p.toFixed(3)} (maxY=${ductSweepBox.max.y.toFixed(3)})`
    )
    assert(
      frontSweepBox.max.y <= MAZE_CEILING_CONFIG.soffitY + 0.008,
      `Bent front hanger never pierces ceiling deck at active=${p.toFixed(3)} (maxY=${frontSweepBox.max.y.toFixed(3)})`
    )

    if (p <= 0.45) {
      const dy = prevY - pdd.ductBodyGroup.position.y
      if (i >= 4) {
        assert(dy >= prevDy - 0.015, `Gravity fall accelerates during primary drop at p=${p.toFixed(3)}`)
      }
      prevDy = dy
    } else if (p > 0.5 && p < 0.78 && pdd.ductBodyGroup.position.y > expectedFinalLocalY + 0.003) {
      sawBounce = true
    }
    prevY = pdd.ductBodyGroup.position.y
  }
  assert(sawBounce, 'Active duct collapse includes realistic damped floor bounce settle')

  updateHazardVisualState(physMesh, 'active', 1)
  const act1DuctPos = pdd.ductBodyGroup.position.clone()
  const act1DuctRot = pdd.ductBodyGroup.rotation.clone()
  pdd.ductMountGroup.updateMatrixWorld(true)
  invActM.copy(pdd.ductMountGroup.matrixWorld).invert()
  ductSweepBox.setFromObject(pdd.ductBodyGroup).applyMatrix4(invActM)
  assert(
    ductSweepBox.min.y >= -0.004 && ductSweepBox.min.y <= 0.04,
    `Grounded fallen duct sits cleanly on floor y=0 (minY=${ductSweepBox.min.y.toFixed(4)})`
  )
  updateHazardVisualState(physMesh, 'disabled', 1)
  assert(
    pdd.ductBodyGroup.position.distanceTo(act1DuctPos) < 1e-4 &&
      Math.hypot(pdd.ductBodyGroup.rotation.x - act1DuctRot.x, pdd.ductBodyGroup.rotation.y - act1DuctRot.y) < 1e-4,
    'ACTIVE(1) -> DISABLED(!cleared) matches seamlessly without snap'
  )
  physDuctAgent.dispose()

  // E. Wall LOS occlusion, lateral opposite-wall dodge & impact-window gating
  const dmgCfg = HAZARD_CONFIG[HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]
  const wallLosGrid53 = Array.from({ length: 5 }, () => Array(5).fill(CELL_TYPES.WALL))
  wallLosGrid53[1][1] = CELL_TYPES.PATH
  wallLosGrid53[2][1] = CELL_TYPES.PATH
  wallLosGrid53[3][1] = CELL_TYPES.PATH
  wallLosGrid53[3][2] = CELL_TYPES.PATH
  wallLosGrid53[1][3] = CELL_TYPES.PATH
  wallLosGrid53[2][3] = CELL_TYPES.PATH
  wallLosGrid53[3][3] = CELL_TYPES.PATH
  const wallLosMaze53 = { id: 'vd-los-53', seed: 5302, grid: wallLosGrid53, start: { row: 3, col: 3 }, exit: { row: 1, col: 3 } }
  const vdOrigin = gridToWorld(2, 1, wallLosMaze53)

  // 1) Lateral opposite-wall dodge avoids crash
  const sideDodgeAgent = new HazardAgent(
    { id: 'vd-side-dodge', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: 2, col: 1, dropSide: 'south' },
    wallLosMaze53
  )
  sideDodgeAgent.update(0.05, { playerWorldPos: { x: vdOrigin.x, y: 0, z: vdOrigin.z }, playerGridCell: { row: 2, col: 1 } })
  const oppX = vdOrigin.x - (sideDodgeAgent.sideSign || 1) * 1.28
  const oppCtx = { playerWorldPos: { x: oppX, y: 0, z: vdOrigin.z + 0.58 }, playerGridCell: { row: 2, col: 1 } }
  assert(sideDodgeAgent.update(dmgCfg.warningDuration + 0.05, oppCtx) === null, 'Opposite wall takes 0 damage on duct release')
  assert(sideDodgeAgent.update(dmgCfg.activeDuration * 0.45, oppCtx) === null, 'Opposite corridor side stays safe during duct fall')
  sideDodgeAgent.dispose()

  // 2) Settling tail (activeProgress > 0.72) deals 0 late damage
  const lateAgent53 = new HazardAgent(
    { id: 'vd-late-53', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: 2, col: 1, dropSide: 'south' },
    wallLosMaze53
  )
  const fDuctWorld = lateAgent53.fallenDuctWorldPos
  lateAgent53.update(0.05, { playerWorldPos: { x: vdOrigin.x, y: 0, z: vdOrigin.z }, playerGridCell: { row: 2, col: 1 } })
  const awayCtx53 = { playerWorldPos: { x: vdOrigin.x, y: 0, z: vdOrigin.z - 2.2 }, playerGridCell: { row: 1, col: 1 } }
  lateAgent53.update(dmgCfg.warningDuration + 0.05, awayCtx53)
  lateAgent53.update(dmgCfg.activeDuration * 0.78, awayCtx53)
  assert(
    lateAgent53.update(0.05, { playerWorldPos: { x: fDuctWorld.x, y: 0, z: fDuctWorld.z }, playerGridCell: { row: 2, col: 1 } }) === null,
    'Approaching grounded fallen duct after danger window (p>0.72) deals 0 damage'
  )
  lateAgent53.dispose()

  // 3) Intervening wall blocks duct impact LOS
  const losAgent53 = new HazardAgent(
    { id: 'vd-wall-los', type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: 2, col: 1, dropSide: 'south' },
    wallLosMaze53
  )
  losAgent53.update(0.05, { playerWorldPos: { x: vdOrigin.x, y: 0, z: vdOrigin.z }, playerGridCell: { row: 2, col: 1 } })
  const behindWallPos53 = gridToWorld(2, 3, wallLosMaze53)
  assert(
    losAgent53.update(dmgCfg.warningDuration + 0.08, {
      playerWorldPos: { x: behindWallPos53.x - 1.5, y: 0, z: behindWallPos53.z },
      playerGridCell: { row: 2, col: 3 },
    }) === null,
    'Solid maze wall blocks ventilation duct impact LOS'
  )
  losAgent53.dispose()

  // F. Multi-topology aftermath OBB alignment & >= 1.60m passage clearance across all 5 topologies
  const topoGrid53 = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  topoGrid53[1][1] = CELL_TYPES.PATH
  topoGrid53[1][2] = CELL_TYPES.PATH
  topoGrid53[1][3] = CELL_TYPES.PATH
  topoGrid53[2][1] = CELL_TYPES.PATH
  topoGrid53[3][1] = CELL_TYPES.PATH
  topoGrid53[3][2] = CELL_TYPES.PATH
  topoGrid53[3][3] = CELL_TYPES.PATH
  topoGrid53[3][4] = CELL_TYPES.PATH
  topoGrid53[3][5] = CELL_TYPES.PATH
  topoGrid53[2][3] = CELL_TYPES.PATH
  topoGrid53[4][3] = CELL_TYPES.PATH
  topoGrid53[5][3] = CELL_TYPES.PATH
  const topoMaze53 = { id: 'topo-53', seed: 5303, grid: topoGrid53, start: { row: 5, col: 3 }, exit: { row: 1, col: 1 } }

  for (const [label, r, c] of [
    ['EW straight', 1, 2],
    ['NS straight', 2, 1],
    ['L-corner', 1, 1],
    ['T-junction', 1, 3],
    ['4-way intersection', 3, 3],
  ]) {
    const tAgent = new HazardAgent(
      { id: `topo-vd-${r}-${c}`, type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, row: r, col: c },
      topoMaze53
    )
    const tmpl = tAgent.getColliderSpecs()[0]
    assert(tmpl && tmpl.id.endsWith(':aftermath-duct'), `${label} duct provides aftermath-duct OBB`)
    assert(tmpl.enabled === false, `${label} aftermath-duct OBB starts disabled while overhead`)

    const clearanceCheck = validateHazardColliderPlacement(
      topoMaze53,
      { id: tmpl.id, kind: tmpl.kind, cx: tmpl.cx, cz: tmpl.cz, halfW: tmpl.halfW, halfD: tmpl.halfD, yaw: tmpl.yaw },
      { radius: PLAYER_RADIUS, minClearance: 1.6 }
    )
    assert(
      clearanceCheck.valid === true,
      `${label} aftermath-duct preserves >= 1.60m passage clearance (got valid=${clearanceCheck.valid}, clearance=${clearanceCheck.clearance?.toFixed?.(2)})`
    )

    updateHazardVisualState(tAgent.getMesh(), 'disabled', 1)
    tAgent.getMesh().updateMatrixWorld(true)
    const fallenBoxW = new THREE.Box3().setFromObject(tAgent.getMesh().userData.ductBodyGroup)
    const meshCx = (fallenBoxW.min.x + fallenBoxW.max.x) * 0.5
    const meshCz = (fallenBoxW.min.z + fallenBoxW.max.z) * 0.5
    assert(
      Math.hypot(tmpl.cx - meshCx, tmpl.cz - meshCz) < 0.12,
      `${label} aftermath-duct OBB center (${tmpl.cx.toFixed(2)}, ${tmpl.cz.toFixed(2)}) aligns with fallen duct mesh (${meshCx.toFixed(2)}, ${meshCz.toFixed(2)})`
    )
    tAgent.dispose()
  }

  // G & H. End-to-End Engine: Safe decoys, aftermath OBB blocking, Move Fallen Duct relocation, reset, setMaze, clearHazards & pools
  const vdEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  vdEngine.setMaze(vdMaze)
  vdEngine.cancelSpawnSequence()

  const liveVdDecoys = vdEngine._mazeGroup?.userData?.ventilationDuctDecoysGroup?.userData?.decoys || []
  assert(liveVdDecoys.length >= 2, 'Engine maze spawns safe ventilation duct decoys')
  for (const d of liveVdDecoys) {
    const dw = gridToWorld(d.row, d.col, vdMaze)
    vdEngine.setPlayerWorldPosition(dw.x, 0, dw.z, { immediate: true })
    for (let s = 0; s < 8; s += 1) vdEngine.stepFrame(0.3, { render: false })
    assert(vdEngine.health === 100, `Safe vent duct decoy ${d.id} deals ZERO damage`)
    assert(vdEngine.getNearbyInteractable() === null, `Safe vent duct decoy ${d.id} emits zero prompt`)
  }

  const liveVd = vdEngine.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE)
  assert(liveVd, 'Engine spawns live ventilation_duct_collapse hazard')
  const ductColId = `${liveVd.id}:aftermath-duct`
  assert(
    getDynamicCollider(vdEngine._propCollisionIndex, ductColId)?.enabled === false,
    'aftermath-duct OBB starts disabled while overhead'
  )

  const liveVdArea = liveVd.getDangerArea()
  vdEngine.setPlayerWorldPosition(liveVdArea.center.x, 0, liveVdArea.center.z, { immediate: true })
  vdEngine.stepFrame(0.05, { render: false })
  assert(liveVd.getState() === HAZARD_STATES.WARNING, 'Approaching ventilation_duct_collapse triggers WARNING')
  assert(
    liveVd.canPlayerInteract(vdEngine.getPlayerWorldPosition(), { row: liveVd.row, col: liveVd.col }) === false,
    'Move Fallen Duct unavailable before duct collapses'
  )

  // Dodge behind rear plenum stub while hanger loosens and duct crashes to floor
  const vdOriginLive = gridToWorld(liveVd.row, liveVd.col, vdMaze)
  const safeBackVdX = vdOriginLive.x - liveVd.dropDir.x * 1.45
  const safeBackVdZ = vdOriginLive.z - liveVd.dropDir.z * 1.45
  vdEngine.setPlayerWorldPosition(safeBackVdX, 0, safeBackVdZ, { immediate: true })
  vdEngine.stepFrame(liveVd.config.warningDuration + 0.08, { render: false })
  assert(liveVd.getState() === HAZARD_STATES.ACTIVE, 'Vent duct transitions into ACTIVE collapse')
  vdEngine.stepFrame(liveVd.config.activeDuration + 0.1, { render: false })
  assert(
    liveVd.getState() === HAZARD_STATES.DISABLED &&
      liveVd.isPermanentlyCollapsed === true &&
      vdEngine.health === 100,
    'Dodging behind rear stub avoids damage and finishes collapse cleanly'
  )
  assert(
    getDynamicCollider(vdEngine._propCollisionIndex, ductColId)?.enabled === true,
    'aftermath-duct OBB activates after grounded collapse'
  )

  // Verify aftermath OBB physically blocks player & push-out extracts safely
  const fdWorld = liveVd.fallenDuctWorldPos
  const walkDuctBlocked = moveWithSubsteps(
    vdOriginLive.x,
    vdOriginLive.z,
    fdWorld.x - vdOriginLive.x,
    fdWorld.z - vdOriginLive.z,
    vdMaze,
    { radius: PLAYER_RADIUS, propColliders: vdEngine._propCollisionIndex }
  )
  assert(
    walkDuctBlocked.hitProp === true && Math.hypot(walkDuctBlocked.x - fdWorld.x, walkDuctBlocked.z - fdWorld.z) > 0.3,
    'Grounded fallen duct OBB physically blocks player movement'
  )
  const rescueVd = resolveSafePushOut(fdWorld.x, fdWorld.z, vdMaze, {
    radius: PLAYER_RADIUS,
    propColliders: vdEngine._propCollisionIndex,
  })
  assert(rescueVd.pushed && rescueVd.safe, 'resolveSafePushOut extracts overlap safely respecting walls')

  // Verify 2.25m interaction range, Move Fallen Duct / Move prompt, and physical relocation
  assert(
    liveVd.canPlayerInteract({ x: fdWorld.x + 3.2, y: 0, z: fdWorld.z }, null) === false,
    'Out-of-range (>2.25m) rejects Move Fallen Duct'
  )
  vdEngine.setPlayerWorldPosition(vdOriginLive.x, 0, vdOriginLive.z, { immediate: true })
  vdEngine.stepFrame(0.016, { render: false })
  const vdPrompt = vdEngine.getNearbyInteractable()
  assert(
    vdPrompt &&
      vdPrompt.kind === 'hazard' &&
      vdPrompt.id === liveVd.id &&
      vdPrompt.label === 'Move Fallen Duct' &&
      vdPrompt.shortLabel === 'Move' &&
      liveVd.getInteractableDescriptor(vdEngine.getPlayerWorldPosition())?.action === 'clear_duct',
    'Standing near collapsed duct surfaces "Move Fallen Duct" ("Move") prompt'
  )

  const clearVdRes = vdEngine.interact()
  assert(
    clearVdRes &&
      clearVdRes.handled === true &&
      clearVdRes.action === 'clear_duct' &&
      liveVd.isAftermathCleared === true &&
      getDynamicCollider(vdEngine._propCollisionIndex, ductColId)?.enabled === false &&
      vdEngine.getNearbyInteractable() === null,
    'Move Fallen Duct disables aftermath-duct collider and clears prompt'
  )

  const clearedVdData = liveVd.getMesh().userData
  assert(
    Math.abs(clearedVdData.ductBodyGroup.position.x - clearedVdData.clearedLocalX) < 1e-4 &&
      Math.abs(clearedVdData.ductBodyGroup.position.y - (VENTILATION_DUCT_CONSTANTS.fallenY - clearedVdData.ductRestY)) < 1e-4 &&
      Math.abs(
        clearedVdData.ductPivotGroup.position.z +
          clearedVdData.ductBodyGroup.position.z -
          clearedVdData.clearedLocalZ
      ) < 1e-4,
    'Move Fallen Duct physically relocates fallen duct flush toward corridor side'
  )
  const walkDuctCleared = moveWithSubsteps(
    vdOriginLive.x,
    vdOriginLive.z,
    fdWorld.x - vdOriginLive.x,
    fdWorld.z - vdOriginLive.z,
    vdMaze,
    { radius: PLAYER_RADIUS, propColliders: vdEngine._propCollisionIndex }
  )
  assert(
    Math.hypot(walkDuctCleared.x - fdWorld.x, walkDuctCleared.z - fdWorld.z) < 0.08,
    'Corridor through prior duct crash footprint is physically navigable once duct is moved aside'
  )

  // Reset restores suspended duct overhead and clears aftermath state
  vdEngine.resetCombat()
  assert(
    liveVd.getState() === HAZARD_STATES.DORMANT &&
      liveVd.isAftermathCleared === false &&
      Math.abs(clearedVdData.ductBodyGroup.position.y) < 1e-4 &&
      Math.abs(clearedVdData.ductBodyGroup.position.z - clearedVdData.bodyOffsetZ) < 1e-4 &&
      getDynamicCollider(vdEngine._propCollisionIndex, ductColId)?.enabled === false,
    'resetCombat restores suspended dormant duct and clears aftermath state'
  )

  // Maze replacement disposes prior hazard and rebuilds safe decoys
  const nextMaze53 = generateMaze({ difficulty: 'medium', seed: 778899 })
  vdEngine.setMaze(nextMaze53)
  assert(
    liveVd.isDisposed === true &&
      liveVd.getMesh() === null &&
      vdEngine._mazeGroup?.userData?.ventilationDuctDecoysGroup?.userData?.decoyCount >= 2,
    'Maze replacement disposes previous ventilation_duct_collapse agent and rebuilds safe decoys'
  )

  const poolsBefore53 = getHazardPoolStats()
  const ventPoolsBefore53 = getCeilingVentPoolStats()
  vdEngine.clearHazards()
  const poolsAfter53 = getHazardPoolStats()
  const ventPoolsAfter53 = getCeilingVentPoolStats()
  assert(
    poolsAfter53.geometries === poolsBefore53.geometries &&
      poolsAfter53.materials === poolsBefore53.materials &&
      ventPoolsAfter53.entries >= ventPoolsBefore53.entries,
    'Shared hazard geometry/material pools and ceiling vent pools preserved across clearHazards()'
  )
  vdEngine.dispose()
}
console.log('✓ Refined ventilation_duct_collapse ceiling clearance, decoys, C0 physics, damage bounds, >=1.60m clearance, Move Fallen Duct & lifecycle verified')

// 54. Water Tank Camouflage Refinement — Subdued Hazardous Drips, Deterministic Decoy Drips, Visual Parity & Cleanup
console.log('Test 54: Water Tank Camouflage Refinement — Dripping Cadence, Visual Parity, Determinism & Disposal')
{
  const camMazeA = generateMaze({ seed: 882244, level: 26 })
  const camMazeB = generateMaze({ seed: 882244, level: 26 })
  const camHazardsA = placeHazards(camMazeA)
  const camBuiltA = buildMazeMeshes(camMazeA, { qualityPreset: 'high' })
  const camBuiltB = buildMazeMeshes(camMazeB, { qualityPreset: 'high' })

  const decoyGroupA = camBuiltA.userData?.waterTankDecoysGroup
  const decoyGroupB = camBuiltB.userData?.waterTankDecoysGroup
  const decoysA = decoyGroupA?.userData?.decoys || []
  const decoysB = decoyGroupB?.userData?.decoys || []
  assert(decoysA.length >= 2, `Built maze places >= 2 water tank decoys for camouflage test (got ${decoysA.length})`)
  assert(
    JSON.stringify(decoysA) === JSON.stringify(decoysB),
    'Identical maze seed produces identical water tank decoy placement and deterministic drip schedules'
  )

  // A. Visual parity: decoys match hazardous hull, trim, straps, rustPatch, seam & InstancedMesh structure
  const decoyChildNames = new Set(decoyGroupA.children.map((c) => c.name))
  assert(
    decoyGroupA.children.every((c) => c.isInstancedMesh === true),
    'All water tank decoy layers including rust patch, seam, and drips remain InstancedMesh'
  )
  for (const requiredLayer of [
    'water-tank-decoy-ceiling-rig',
    'water-tank-decoy-straps',
    'water-tank-decoy-hull',
    'water-tank-decoy-trim',
    'water-tank-decoy-rust-patch',
    'water-tank-decoy-seam',
    'water-tank-decoy-drips',
  ]) {
    assert(decoyChildNames.has(requiredLayer), `Decoy tank group includes matching layer "${requiredLayer}"`)
  }

  const rustPatchMesh = decoyGroupA.getObjectByName('water-tank-decoy-rust-patch')
  const seamInstMesh = decoyGroupA.getObjectByName('water-tank-decoy-seam')
  const decoyDripsMesh = decoyGroupA.getObjectByName('water-tank-decoy-drips')
  const camWtSpec = camHazardsA.find((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK) || {
    id: 'cam-wt-fallback',
    type: HAZARD_TYPES.FALLING_WATER_TANK,
    row: 1,
    col: 1,
    flowSide: 'south',
  }
  const camAgent = new HazardAgent(camWtSpec, camMazeA)
  const camMesh = camAgent.getMesh()
  const camData = camMesh.userData
  assert(
    rustPatchMesh.geometry === camData.tankGroup.children.find((c) => c.geometry === rustPatchMesh.geometry)?.geometry &&
      seamInstMesh.geometry === camData.seamMesh.geometry &&
      seamInstMesh.material === camData.seamMesh.material,
    'Decoy rust patch and weld seam reuse identical shared geometry and material as dormant hazardous tank'
  )

  // B. Hazardous tank dormant dripping: subtle (single drop, lower opacity/scale, quiet dwell pause) & still active
  updateHazardVisualState(camMesh, 'dormant', 0.15)
  const visibleDormantDrops = camData.leakDrops.filter((d) => d.visible)
  assert(
    camData.leakGroup.visible === true &&
      visibleDormantDrops.length === 1 &&
      camData.leakMat.opacity === WATER_TANK_CONSTANTS.dormantDripOpacity &&
      camData.leakMat.opacity < 0.3,
    `Hazardous tank dormant dripping uses subtle single drop & subdued opacity (${camData.leakMat.opacity})`
  )
  assert(
    visibleDormantDrops[0].scale.x <= 0.56 + 1e-4 && visibleDormantDrops[0].scale.y <= 1.12 + 1e-4,
    'Hazardous dormant droplet scale is subtler than before'
  )
  updateHazardVisualState(camMesh, 'dormant', 0.85)
  assert(
    camData.leakDrops.every((d) => d.visible === false),
    'Hazardous dormant tank includes natural quiet dwell interval between drips'
  )

  // C. Decoy tank dripping: occasional, strictly slower & dimmer than hazardous tank, deterministic across seeds
  const hazardFreq = 1 / WATER_TANK_CONSTANTS.dormantDripPeriodSec
  assert(
    WATER_TANK_CONSTANTS.decoyDripOpacity < WATER_TANK_CONSTANTS.dormantDripOpacity,
    'Decoy drip opacity is subtly lower than hazardous dormant drip opacity'
  )
  assert(
    decoyDripsMesh.material.opacity === WATER_TANK_CONSTANTS.decoyDripOpacity,
    'Decoy drip InstancedMesh uses subtle decoyLeakMat opacity'
  )

  const decoyScaleCheckMat = new THREE.Matrix4()
  const decoyPosCheck = new THREE.Vector3()
  const decoyQuatCheck = new THREE.Quaternion()
  const decoyScaleVec = new THREE.Vector3()
  const observedDecoyDropActive = new Array(decoysA.length).fill(false)
  const observedDecoyRest = new Array(decoysA.length).fill(false)

  for (let i = 0; i < decoysA.length; i += 1) {
    const d = decoysA[i]
    const decoyFreq = 1 / d.dripIntervalSec
    assert(
      decoyFreq < hazardFreq &&
        d.dripIntervalSec >= WATER_TANK_CONSTANTS.decoyDripIntervalMinSec &&
        d.dripIntervalSec <= WATER_TANK_CONSTANTS.decoyDripIntervalMaxSec,
      `Decoy ${d.id} drip frequency (${decoyFreq.toFixed(3)} Hz) < hazard frequency (${hazardFreq.toFixed(3)} Hz)`
    )

    // Probe active drip phase and rest dwell phase for each decoy
    const duty = WATER_TANK_CONSTANTS.decoyDripDuty
    const activeTime = ((0.35 * duty - d.dripPhase + 1) % 1) * d.dripIntervalSec
    stepWaterTankDecoys(decoyGroupA, activeTime)
    decoyDripsMesh.getMatrixAt(i, decoyScaleCheckMat)
    decoyScaleCheckMat.decompose(decoyPosCheck, decoyQuatCheck, decoyScaleVec)
    if (decoyScaleVec.y > 0.1 && decoyPosCheck.y > 0.02 && decoyPosCheck.y < 2.2) {
      observedDecoyDropActive[i] = true
    }

    const restTime = ((0.75 - d.dripPhase + 1) % 1) * d.dripIntervalSec
    stepWaterTankDecoys(decoyGroupA, restTime)
    decoyDripsMesh.getMatrixAt(i, decoyScaleCheckMat)
    decoyScaleCheckMat.decompose(decoyPosCheck, decoyQuatCheck, decoyScaleVec)
    if (decoyScaleVec.y < 1e-4) {
      observedDecoyRest[i] = true
    }
  }
  assert(
    observedDecoyDropActive.every(Boolean) && observedDecoyRest.every(Boolean),
    'Every decoy tank occasionally drips under gravity and rests between drips'
  )

  // Deterministic output across identical seeds + skip redundant uploads + reducedMotion hiding
  const probeElapsed = 3.175
  stepWaterTankDecoys(decoyGroupA, probeElapsed)
  stepWaterTankDecoys(decoyGroupB, probeElapsed)
  const decoyDripsMeshB = decoyGroupB.getObjectByName('water-tank-decoy-drips')
  const matA = new THREE.Matrix4()
  const matB = new THREE.Matrix4()
  for (let i = 0; i < decoysA.length; i += 1) {
    decoyDripsMesh.getMatrixAt(i, matA)
    decoyDripsMeshB.getMatrixAt(i, matB)
    for (let e = 0; e < 16; e += 1) {
      assert(
        Math.abs(matA.elements[e] - matB.elements[e]) < 1e-6,
        `Seed-deterministic decoy drip matrix matches at index ${i} (el=${e})`
      )
    }
  }
  const repeatStepResult = stepWaterTankDecoys(decoyGroupA, probeElapsed)
  const matAfterRepeat = new THREE.Matrix4()
  decoyDripsMesh.getMatrixAt(0, matA)
  decoyDripsMeshB.getMatrixAt(0, matAfterRepeat)
  assert(
    typeof repeatStepResult === 'boolean' &&
      matA.elements.every((val, idx) => Math.abs(val - matAfterRepeat.elements[idx]) < 1e-6),
    'stepWaterTankDecoys handles steady state deterministically without matrix drift'
  )
  const restTime0 = ((0.75 - decoysA[0].dripPhase + 1) % 1) * decoysA[0].dripIntervalSec
  stepWaterTankDecoys(decoyGroupA, restTime0)
  stepWaterTankDecoys(decoyGroupA, restTime0, { reducedMotion: true })
  assert(
    stepWaterTankDecoys(decoyGroupA, restTime0, { reducedMotion: true }) === false,
    'Steady reducedMotion skips redundant decoy drip matrix uploads'
  )
  for (let i = 0; i < decoysA.length; i += 1) {
    decoyDripsMesh.getMatrixAt(i, matA)
    matA.decompose(decoyPosCheck, decoyQuatCheck, decoyScaleVec)
    assert(decoyScaleVec.lengthSq() < 1e-6, 'reducedMotion hides decoy drip instances cleanly')
  }

  // D. Engine stepFrame integration, preserved hazard behavior, reset & disposal cleanup
  camAgent.dispose()
  const poolsBefore54 = getHazardPoolStats()
  disposeMazeGroup(camBuiltA)
  disposeMazeGroup(camBuiltB)
  const poolsAfterDecoyDispose54 = getHazardPoolStats()
  assert(
    poolsAfterDecoyDispose54.geometries === poolsBefore54.geometries &&
      poolsAfterDecoyDispose54.materials === poolsBefore54.materials,
    'Shared hazard geometry and material pools preserved across decoy disposal'
  )
  assert(
    decoyGroupA.userData.dripStates === null && decoyGroupA.userData.decoyDripsInst === null,
    'disposeMazeGroup clears decoy dripping references cleanly'
  )

  const camEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
  camEngine.setMaze(camMazeA)
  camEngine.cancelSpawnSequence()
  const engDecoyGroup = camEngine._mazeGroup?.userData?.waterTankDecoysGroup
  assert(Boolean(engDecoyGroup?.userData?.decoyDripsInst), 'Engine maze mounts decoy dripping layer')
  for (let s = 0; s < 12; s += 1) {
    camEngine.stepFrame(0.18, { render: false })
  }
  const liveCamWt = camEngine.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK)
  assert(liveCamWt, 'Engine retains live falling_water_tank hazard alongside camouflaged decoys')
  const wtAreaCam = liveCamWt.getDangerArea()
  camEngine.setPlayerWorldPosition(wtAreaCam.center.x, 0, wtAreaCam.center.z, { immediate: true })
  camEngine.stepFrame(0.05, { render: false })
  assert(liveCamWt.getState() === HAZARD_STATES.WARNING, 'Triggering camouflaged tank still enters WARNING')
  camEngine.stepFrame(liveCamWt.config.warningDuration + 0.05, { render: false })
  assert(
    liveCamWt.getState() === HAZARD_STATES.ACTIVE && camEngine.health === 70,
    'Fallen tank collision & damage preserved'
  )
  camEngine.stepFrame(liveCamWt.config.activeDuration + 0.05, { render: false })
  const clearPromptCam = camEngine.getNearbyInteractable()
  assert(
    clearPromptCam && clearPromptCam.label === 'Move Fallen Tank',
    'Move Fallen Tank interaction preserved after collapse'
  )
  const moveResCam = camEngine.interact()
  assert(moveResCam?.handled === true && moveResCam.action === 'clear_tank', 'Move Fallen Tank executes cleanly')
  camEngine.setMaze(generateMaze({ seed: 991122 }))
  const poolsBeforeClear54 = getHazardPoolStats()
  camEngine.clearHazards()
  const poolsAfter54 = getHazardPoolStats()
  assert(
    poolsAfter54.geometries === poolsBeforeClear54.geometries &&
      poolsAfter54.materials === poolsBeforeClear54.materials,
    'Shared hazard geometry and material pools preserved across decoy disposal, replacement & clearHazards()'
  )
  camEngine.dispose()
}
console.log('✓ Water tank camouflage refinement (subdued hazard drips, deterministic decoy drips, visual parity & cleanup) verified')

// 55. Floor Grate & Furniture Camouflage Refinement (4/12)
console.log('Test 55: Floor Grate & Furniture Camouflage — Dormant Visual Parity, Collapse Recovery, Relocation, Reset & Pools')
{
  const camMaze4 = generateMaze({ seed: 448822, level: 26 })
  const camHazards4 = placeHazards(camMaze4)
  const camBuilt4 = buildMazeMeshes(camMaze4, { hazards: camHazards4, qualityPreset: 'high' })
  const envMats4 = getEnvironmentalPropMaterials()

  // A. Floor Grate dormant visual parity with decoys (zero unique tells, shared geometries/materials & consistent subtle rust wear)
  const decoyGroup4 = camBuilt4.getObjectByName(FLOOR_GRATE_CONSTANTS.decoyLayerName)
  assert(decoyGroup4 && decoyGroup4.children.length === 7, 'Floor grate decoys include all 7 matching instanced layers including seam rust wear')
  const decoyByName4 = new Map(decoyGroup4.children.map((c) => [c.name, c]))
  const fgHazSpec = camHazards4.find((h) => h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) || {
    id: 'fg-cam-test',
    type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
    row: 1,
    col: 1,
  }
  const fgAgent4 = new HazardAgent(fgHazSpec, camMaze4)
  const fgMesh4 = fgAgent4.getMesh()
  const fgData4 = fgMesh4.userData
  updateHazardVisualState(fgMesh4, 'dormant', 0)

  assert(
    Math.abs(fgData4.leftLeafGroup.rotation.z) < 1e-6 &&
      Math.abs(fgData4.rightLeafGroup.rotation.z) < 1e-6 &&
      Math.abs(fgData4.leftLeafGroup.position.y - fgData4.grateRestY) < 1e-6,
    'Dormant hazardous floor grate has zero pre-stress leaf sag'
  )
  assert(
    fgData4.curbGroup?.getObjectByName('floor-grate-spall-tell') == null,
    'Dormant hazardous floor grate removes unique curb concrete spall tell'
  )
  for (let i = 0; i < fgData4.bolts.length; i += 1) {
    assert(
      fgData4.bolts[i].material === envMats4.darkSteel &&
        fgData4.bolts[i].material === decoyByName4.get('floor-grate-decoy-bolts').material &&
        fgData4.bolts[i].geometry === decoyByName4.get('floor-grate-decoy-bolts').geometry,
      `Dormant corner bolt ${i} matches uniform decoy bolt material & geometry`
    )
  }
  assert(
    fgData4.curbMesh.geometry === decoyByName4.get('floor-grate-decoy-curbs').geometry &&
      fgData4.curbMesh.material === decoyByName4.get('floor-grate-decoy-curbs').material &&
      fgData4.shaftMesh.geometry === decoyByName4.get('floor-grate-decoy-shafts').geometry &&
      fgData4.shaftMesh.material === decoyByName4.get('floor-grate-decoy-shafts').material &&
      fgData4.pitMesh.geometry === decoyByName4.get('floor-grate-decoy-sumps').geometry &&
      fgData4.pitMesh.material === decoyByName4.get('floor-grate-decoy-sumps').material &&
      fgData4.subPipeMesh.geometry === decoyByName4.get('floor-grate-decoy-pipes').geometry &&
      fgData4.subPipeMesh.material === decoyByName4.get('floor-grate-decoy-pipes').material &&
      fgData4.leftLeafGroup.children[0].geometry === decoyByName4.get('floor-grate-decoy-leaves').geometry &&
      fgData4.leftLeafGroup.children[0].material === decoyByName4.get('floor-grate-decoy-leaves').material &&
      fgData4.leftLeafGroup.children[1].geometry === decoyByName4.get('floor-grate-decoy-seams').geometry &&
      fgData4.leftLeafGroup.children[1].material === decoyByName4.get('floor-grate-decoy-seams').material,
    'Dormant hazardous floor grate shares identical geometry and materials across curb, shaft, pit, subpipe, grate leaf, and rust seam with decoys'
  )
  fgAgent4.dispose()
  disposeMazeGroup(camBuilt4)

  // B. Floor Grate collapse damage, Secure Floor Opening (cover + collider + prompt removal + clean reset)
  const eng55 = createHeadlessEngine({ enemies: { autoSpawn: false } })
  eng55.setMaze(camMaze4)
  eng55.cancelSpawnSequence()
  const poolsBefore55 = getHazardPoolStats()

  const liveFg55 = eng55.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE)
  assert(liveFg55, 'Engine spawns collapsing_floor_grate hazard for recovery test')
  const fgArea55 = liveFg55.getDangerArea()
  assert(liveFg55.getMesh()?.userData?.securedCoverGroup?.visible === false, 'Floor grate cover starts hidden')

  eng55.setPlayerWorldPosition(fgArea55.center.x, 0, fgArea55.center.z, { immediate: true })
  eng55.stepFrame(0.05, { render: false })
  assert(liveFg55.getState() === HAZARD_STATES.WARNING, 'Stepping on camouflaged grate triggers WARNING')
  eng55.stepFrame(liveFg55.config.warningDuration + 0.08, { render: false })
  assert(
    liveFg55.getState() === HAZARD_STATES.ACTIVE && eng55.health < 100,
    'Collapsing grate drops player into open pit and deals damage'
  )
  eng55.stepFrame(liveFg55.config.activeDuration + 0.1, { render: false })
  assert(
    liveFg55.getState() === HAZARD_STATES.DISABLED &&
      getDynamicCollider(eng55._propCollisionIndex, `${liveFg55.id}:aftermath-pit`)?.enabled === true,
    'Collapsed pit persists with active collider'
  )

  const fgCellPos = gridToWorld(liveFg55.row, liveFg55.col, camMaze4)
  const edgeOffsetX = fgArea55.center.x - fgCellPos.x
  const edgeOffsetZ = fgArea55.center.z - fgCellPos.z
  const besidePit = {
    x: Math.abs(edgeOffsetX) >= Math.abs(edgeOffsetZ) ? fgCellPos.x - Math.sign(edgeOffsetX || 1) * 1.15 : fgArea55.center.x,
    z: Math.abs(edgeOffsetZ) > Math.abs(edgeOffsetX) ? fgCellPos.z - Math.sign(edgeOffsetZ || 1) * 1.15 : fgArea55.center.z,
  }
  eng55.setPlayerWorldPosition(besidePit.x, 0, besidePit.z, { immediate: true })
  eng55.stepFrame(0.02, { render: false })
  const securePrompt = eng55.getNearbyInteractable()
  assert(
    securePrompt &&
      securePrompt.kind === 'hazard' &&
      securePrompt.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE &&
      securePrompt.label === 'Secure Floor Opening' &&
      securePrompt.shortLabel === 'Secure',
    'Beside collapsed pit shows Secure Floor Opening (Secure) prompt'
  )
  const secureRes = eng55.interact()
  assert(secureRes?.handled === true && secureRes.action === 'secure_floor_opening', 'Pressing F secures floor opening')
  eng55.stepFrame(0.02, { render: false })
  assert(
    liveFg55.isAftermathCleared === true &&
      liveFg55.getMesh()?.userData?.securedCoverGroup?.visible === true &&
      getDynamicCollider(eng55._propCollisionIndex, `${liveFg55.id}:aftermath-pit`)?.enabled === false &&
      eng55.getNearbyInteractable() === null,
    'Securing pit visibly installs cover plate, disables pit collider, and removes prompt'
  )
  liveFg55.resetState()
  assert(
    liveFg55.state === HAZARD_STATES.DORMANT &&
      liveFg55.isAftermathCleared === false &&
      liveFg55.getMesh()?.userData?.isAftermathCleared === false &&
      liveFg55.getMesh()?.userData?.securedCoverGroup?.visible === false,
    'resetState() restores floor grate cover & repair flags cleanly'
  )

  // C. Furniture camouflage visual parity with ordinary STORAGE_SHELF prop & removal of dormant tells
  const refShelf = createEnvironmentalPropMesh(PROP_TYPES.STORAGE_SHELF, envMats4)
  refShelf.updateMatrixWorld(true)
  const refShelfBox = new THREE.Box3().setFromObject(refShelf)
  const refShelfSize = new THREE.Vector3()
  refShelfBox.getSize(refShelfSize)

  const rfHazSpec = camHazards4.find((h) => h.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE) || {
    id: 'rf-cam-test',
    type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    row: 1,
    col: 1,
  }
  const rfAgent55 = new HazardAgent(rfHazSpec, camMaze4)
  const rfMesh55 = rfAgent55.getMesh()
  const rfData55 = rfMesh55.userData
  updateHazardVisualState(rfMesh55, 'dormant', 0)
  rfData55.furnitureGroup.updateMatrixWorld(true)
  const rfLocalBox = new THREE.Box3().setFromObject(rfData55.furnitureGroup)
  const rfLocalSize = new THREE.Vector3()
  rfLocalBox.getSize(rfLocalSize)

  assert(
    Math.abs(rfData55.dormantPitch) < 1e-6 &&
      Math.abs(rfData55.dormantRoll) < 1e-6 &&
      Math.abs(rfData55.furnitureGroup.rotation.x) < 1e-6 &&
      Math.abs(rfData55.furnitureGroup.rotation.z) < 1e-6,
    'Dormant hazardous furniture stands upright with zero leaning tilt clue'
  )
  assert(
    rfData55.strainedStrapMesh === null &&
      rfData55.buckledLegMesh === null &&
      rfData55.ajarDoorMesh === null,
    'Dormant hazardous furniture removes unique strap, buckled leg, and ajar door tells'
  )
  assert(
    Math.abs(rfLocalSize.x - refShelfSize.x) < 0.04 &&
      Math.abs(rfLocalSize.y - refShelfSize.y) < 0.04 &&
      Math.abs(rfLocalSize.z - refShelfSize.z) < 0.06 &&
      Math.abs(rfLocalBox.min.y - refShelfBox.min.y) < 0.02,
    `Dormant hazardous furniture dimensions (${rfLocalSize.x.toFixed(2)}x${rfLocalSize.y.toFixed(2)}x${rfLocalSize.z.toFixed(2)}) match ordinary STORAGE_SHELF (${refShelfSize.x.toFixed(2)}x${refShelfSize.y.toFixed(2)}x${refShelfSize.z.toFixed(2)})`
  )
  const shelfChildMats = new Set()
  refShelf.traverse((n) => {
    if (n.isMesh) shelfChildMats.add(n.material)
  })
  const hazChildMats = new Set()
  rfData55.furnitureGroup.traverse((n) => {
    if (n.isMesh) hazChildMats.add(n.material)
  })
  for (const m of hazChildMats) {
    assert(shelfChildMats.has(m), 'Dormant hazardous furniture uses identical shared materials as STORAGE_SHELF')
  }
  rfAgent55.dispose()

  // D. Live engine furniture collapse, aftermath obstacle, F Clear Fallen Furniture geometry move & pool stability
  const liveRf55 = eng55.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE)
  assert(liveRf55, 'Engine spawns rotten_furniture_collapse hazard')
  const rfArea55 = liveRf55.getDangerArea()
  const rfColDormant = getDynamicCollider(eng55._propCollisionIndex, `${liveRf55.id}:dormant-furniture`)
  const rfColAfter = getDynamicCollider(eng55._propCollisionIndex, `${liveRf55.id}:aftermath-furniture`)
  assert(rfColDormant?.enabled === true && rfColAfter?.enabled === false, 'Dormant upright furniture blocks wall footprint before collapse')

  eng55.setPlayerWorldPosition(rfArea55.center.x, 0, rfArea55.center.z, { immediate: true })
  eng55.stepFrame(0.05, { render: false })
  assert(liveRf55.getState() === HAZARD_STATES.WARNING, 'Approaching camouflaged shelf triggers WARNING')
  eng55.stepFrame(liveRf55.config.warningDuration + 0.08, { render: false })
  eng55.stepFrame(liveRf55.config.activeDuration + 0.1, { render: false })
  assert(
    liveRf55.getState() === HAZARD_STATES.DISABLED &&
      liveRf55.isPermanentlyCollapsed === true &&
      rfColDormant.enabled === false &&
      rfColAfter.enabled === true,
    'Fallen furniture disables upright collider and enables fallen aftermath obstacle collider'
  )

  const rfMeshLive = liveRf55.getMesh()
  const fallenPosBefore = rfMeshLive.userData.furnitureGroup.position.clone()
  const fallenYawBefore = rfMeshLive.userData.furnitureGroup.rotation.y

  const clearPromptRf = eng55.getNearbyInteractable()
  assert(
    clearPromptRf &&
      clearPromptRf.kind === 'hazard' &&
      clearPromptRf.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE &&
      clearPromptRf.label === 'Clear Fallen Furniture' &&
      clearPromptRf.shortLabel === 'Clear',
    'Fallen furniture offers Clear Fallen Furniture (Clear) interaction'
  )
  const clearRfRes = eng55.interact()
  assert(clearRfRes?.handled === true && clearRfRes.action === 'clear_furniture', 'Pressing F clears fallen furniture')
  eng55.stepFrame(0.02, { render: false })

  const fallenPosAfter = rfMeshLive.userData.furnitureGroup.position
  assert(
    fallenPosAfter.distanceTo(fallenPosBefore) > 0.25 &&
      Math.abs(rfMeshLive.userData.furnitureGroup.rotation.y - fallenYawBefore) > 0.05 &&
      rfColAfter.enabled === false &&
      eng55.getNearbyInteractable() === null,
    'Clear Fallen Furniture visibly relocates geometry against wall side, disables collider, and removes prompt'
  )

  // Verify cleared furniture stays inside cell wall perimeter (no wall clipping) & leaves corridor navigable
  rfMeshLive.updateMatrixWorld(true)
  const clearedWorldBox = new THREE.Box3().setFromObject(rfMeshLive.userData.furnitureGroup)
  const cellCenterRf = gridToWorld(liveRf55.row, liveRf55.col, camMaze4)
  assert(
    clearedWorldBox.min.y >= -0.02 &&
      Math.abs(clearedWorldBox.min.x - cellCenterRf.x) <= CELL_SIZE * 0.5 + 0.02 &&
      Math.abs(clearedWorldBox.max.x - cellCenterRf.x) <= CELL_SIZE * 0.5 + 0.02 &&
      Math.abs(clearedWorldBox.min.z - cellCenterRf.z) <= CELL_SIZE * 0.5 + 0.02 &&
      Math.abs(clearedWorldBox.max.z - cellCenterRf.z) <= CELL_SIZE * 0.5 + 0.02,
    'Relocated furniture rests inside corridor wall bounds without wall or floor penetration'
  )

  // Reset, maze rebuild & shared pool stability
  eng55.setMaze(generateMaze({ seed: 117733 }))
  eng55.clearHazards()
  const poolsAfter55 = getHazardPoolStats()
  assert(
    poolsAfter55.geometries === poolsBefore55.geometries &&
      poolsAfter55.materials === poolsBefore55.materials,
    'Shared hazard geometry and material pools preserved across floor grate and furniture camouflage lifecycles'
  )
  eng55.dispose()
}
console.log('✓ Floor grate & furniture camouflage refinement (visual parity, collapse/recovery, reset & pool stability) verified')

// 56. Side-Wall Camouflage & Rubble Physics (Task 5/12)
console.log('Test 56: Side-Wall Camouflage Parity, Side-Wall Preference, Left/Right Rubble Spread, Opposite-Lane Passability & Clear Interaction')
{
  const poolsBefore56 = getHazardPoolStats()
  const wcMaze56 = generateMaze({ seed: 771234, level: 26 })
  const wcHazards56 = placeHazards(wcMaze56)
  const wcSpec56 = wcHazards56.find((h) => h.type === HAZARD_TYPES.WALL_COLLAPSE)
  assert(Boolean(wcSpec56), 'Seed 771234 spawns wall_collapse hazard')

  // A. Dormant visual parity between hazardous wall panel, safe decoys, and ordinary maze-walls
  const builtMaze56 = buildMazeMeshes(wcMaze56, { hazards: wcHazards56 })
  const wallLayer56 = builtMaze56.getObjectByName('maze-walls')
  let mazeWallMat = null
  wallLayer56?.traverse((n) => {
    if (!mazeWallMat && n.material) mazeWallMat = n.material
  })
  assert(Boolean(mazeWallMat), 'Built maze exposes ordinary maze-walls PBR material')

  const decoyGroup56 = builtMaze56.userData?.wallCollapseDecoysGroup
  assert(Boolean(decoyGroup56), 'Built maze exposes safe wall-collapse decoys layer')
  const decoyRim56 = decoyGroup56.getObjectByName('wall-collapse-decoy-rim')
  const decoyEven56 = decoyGroup56.getObjectByName('wall-collapse-decoy-slabs-even')
  const decoyOdd56 = decoyGroup56.getObjectByName('wall-collapse-decoy-slabs-odd')
  const decoyCracks56 = decoyGroup56.getObjectByName('wall-collapse-decoy-cracks')
  assert(
    decoyRim56 && decoyEven56 && decoyOdd56 && decoyCracks56,
    'Safe decoy layer provides rim, even/odd veneer slabs, and hairline cracks'
  )

  const dormAgent56 = new HazardAgent(wcSpec56, wcMaze56)
  const dormMesh56 = dormAgent56.getMesh()
  const dd56 = dormMesh56.userData

  // Subtle concrete palette & identical PBR properties (no loud 2x2 checkerboard contrast)
  assert(
    dd56.slabMeshes.length === 4 &&
      dd56.slabMeshes.every((s) => s.castShadow === false && s.receiveShadow === true) &&
      dd56.rimGroup.castShadow === false &&
      dd56.rimGroup.receiveShadow === true,
    'Dormant hazard veneer slabs & rim match shadow-receiving flags of decoys and maze-walls'
  )
  const matEven56 = dd56.slabMeshes[0].material
  const matOdd56 = dd56.slabMeshes[1].material
  assert(
    matEven56 === decoyEven56.material &&
      matOdd56 === decoyOdd56.material &&
      dd56.rimGroup.material === decoyRim56.material &&
      dd56.crackGroup.children[0].material === decoyCracks56.material,
    'Dormant hazardous wall shares exact pooled materials with safe decoys'
  )
  assert(
    dd56.rimGroup.geometry === decoyRim56.geometry &&
      dd56.slabMeshes[0].geometry === decoyEven56.geometry &&
      dd56.crackGroup.children[0].geometry === decoyCracks56.geometry,
    'Dormant hazardous wall shares exact pooled geometries with safe decoys'
  )
  for (const m of [matEven56, matOdd56]) {
    assert(
      m.map === mazeWallMat.map &&
        m.bumpMap === mazeWallMat.bumpMap &&
        m.roughnessMap === mazeWallMat.roughnessMap &&
        Math.abs(m.bumpScale - mazeWallMat.bumpScale) < 1e-5 &&
        Math.abs(m.roughness - mazeWallMat.roughness) < 1e-5 &&
        Math.abs(m.metalness - mazeWallMat.metalness) < 1e-5 &&
        Math.abs(m.envMapIntensity - mazeWallMat.envMapIntensity) < 1e-5,
      'Wall panel PBR texture maps, bumpScale, roughness, metalness & envMapIntensity match ordinary maze-walls'
    )
  }
  const cWall56 = new THREE.Color(MAZE_MESH_PALETTE.wallBody)
  const cRubble56 = new THREE.Color(HAZARD_PALETTE.wallRubble)
  assert(
    Math.abs(cWall56.r - cRubble56.r) < 0.03 &&
      Math.abs(cWall56.g - cRubble56.g) < 0.03 &&
      Math.abs(cWall56.b - cRubble56.b) < 0.03,
    'Odd concrete slab tone blends subtly with maze wallBody without checkerboard tell'
  )
  dd56.wallMountGroup.updateMatrixWorld(true)
  const invDorm56 = new THREE.Matrix4().copy(dd56.wallMountGroup.matrixWorld).invert()
  const crackStripBox56 = new THREE.Box3().setFromObject(dd56.crackGroup.children[0]).applyMatrix4(invDorm56)
  const crackWidth56 =
    (dd56.crackGroup.children[0].geometry?.parameters?.width ?? 0) * dd56.crackGroup.scale.x
  assert(
    crackWidth56 > 0 &&
      crackWidth56 <= 0.01 &&
      crackStripBox56.max.z - crackStripBox56.min.z <= 0.005 &&
      Math.abs(dd56.crackGroup.position.z - (dd56.wallZ + WALL_COLLAPSE_CONSTANTS.slabThickness)) < 1e-4,
    'Dormant hairline cracks stay thin and flush with panel face matching decoys'
  )
  dormAgent56.dispose()
  disposeMazeGroup(builtMaze56)

  // B. Corridor side-wall mount preference over dead-end end cap
  const deadEndGrid56 = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  deadEndGrid56[2][3] = CELL_TYPES.PATH // Dead-end bay: north (1,3) is end cap; west (2,2) & east (2,4) are side walls; south (3,3) is path
  deadEndGrid56[3][3] = CELL_TYPES.PATH
  deadEndGrid56[4][3] = CELL_TYPES.PATH
  deadEndGrid56[5][3] = CELL_TYPES.PATH
  for (let s = 0; s < 6; s += 1) {
    const resolvedDeadEnd = resolveWallCollapseMount(deadEndGrid56, 2, 3, () => s / 6)
    assert(
      resolvedDeadEnd &&
        (resolvedDeadEnd.wallSide === 'west' || resolvedDeadEnd.wallSide === 'east'),
      `Dead-end cell (2,3) prefers corridor side wall over north end-cap (got ${resolvedDeadEnd?.wallSide})`
    )
  }

  // C. Left-side ('west') & Right-side ('east') N-S corridor rubble spread, OBB alignment & opposite-lane passability
  const nsGrid56 = Array.from({ length: 7 }, () => Array(7).fill(CELL_TYPES.WALL))
  for (let r = 1; r <= 5; r += 1) nsGrid56[r][3] = CELL_TYPES.PATH
  const nsMaze56 = {
    id: 'ns-rubble-56',
    seed: 5601,
    grid: nsGrid56,
    start: { row: 5, col: 3 },
    exit: { row: 1, col: 3 },
  }
  const nsCenter56 = gridToWorld(3, 3, nsMaze56)
  const nsFromSouth = gridToWorld(4, 3, nsMaze56)
  const nsToNorth = gridToWorld(2, 3, nsMaze56)

  for (const [sideLabel, wallSide, wallCol, rubbleSideSign, safeLaneOffsetX, blockedLaneOffsetX] of [
    ['left-side', 'west', 2, -1, +0.95, -1.6],
    ['right-side', 'east', 4, +1, -0.95, +1.6],
  ]) {
    const sideEng = createHeadlessEngine({ enemies: { autoSpawn: false } })
    sideEng.setMaze(nsMaze56)
    sideEng.cancelSpawnSequence()
    sideEng.hazardManager.clear()
    sideEng.hidingSpotManager?.clear?.()
    for (const colEntry of sideEng._propCollisionIndex?.colliders || []) {
      if (colEntry && !colEntry.isDynamic) colEntry.enabled = false
    }

    const sideHaz = sideEng.hazardManager.addHazard({
      id: `wc-side-${wallSide}`,
      type: HAZARD_TYPES.WALL_COLLAPSE,
      row: 3,
      col: 3,
      wallSide,
      wallRow: 3,
      wallCol,
    })
    assert(Boolean(sideHaz), `Spawns ${sideLabel} wall_collapse hazard`)
    sideEng.stepFrame(0.016, { render: false })

    // Trigger warning -> full collapse -> aftermath disabled state
    const area56 = sideHaz.getDangerArea()
    sideEng.setPlayerWorldPosition(area56.center.x, 0, area56.center.z, { immediate: true })
    sideEng.stepFrame(0.05, { render: false })
    assert(sideHaz.getState() === HAZARD_STATES.WARNING, `${sideLabel} enters WARNING`)
    sideEng.setPlayerWorldPosition(nsCenter56.x + safeLaneOffsetX, 0, nsFromSouth.z, { immediate: true })
    sideEng.stepFrame(sideHaz.config.warningDuration + 0.08, { render: false })
    sideEng.stepFrame(sideHaz.config.activeDuration + 0.1, { render: false })
    assert(
      sideHaz.getState() === HAZARD_STATES.DISABLED && sideHaz.isPermanentlyCollapsed === true,
      `${sideLabel} finishes permanent collapse`
    )

    const sideColId = `${sideHaz.id}:aftermath-rubble`
    const sideCol = getDynamicCollider(sideEng._propCollisionIndex, sideColId)
    assert(sideCol?.enabled === true, `${sideLabel} aftermath-rubble OBB is enabled`)

    // Verify all fallen slabs & rubble chunks spread strictly from hazard wall toward center & stay inside OBB
    const sideMesh = sideHaz.getMesh()
    sideMesh.updateMatrixWorld(true)
    const worldBox56 = new THREE.Box3()
    const obbMinX = sideCol.minX - 0.08
    const obbMaxX = sideCol.maxX + 0.08
    const obbMinZ = sideCol.minZ - 0.08
    const obbMaxZ = sideCol.maxZ + 0.08

    for (const partList of [sideMesh.userData.slabMeshes, sideMesh.userData.wallRubbleMeshes]) {
      for (let i = 0; i < partList.length; i += 1) {
        worldBox56.setFromObject(partList[i])
        assert(worldBox56.min.y >= -0.005, `${sideLabel} debris piece ${i} rests on floor without clipping`)
        assert(
          worldBox56.min.x >= obbMinX &&
            worldBox56.max.x <= obbMaxX &&
            worldBox56.min.z >= obbMinZ &&
            worldBox56.max.z <= obbMaxZ,
          `${sideLabel} debris piece ${i} aligns cleanly inside aftermath-rubble OBB`
        )
        if (rubbleSideSign < 0) {
          assert(
            worldBox56.max.x <= nsCenter56.x - 0.72,
            `${sideLabel} rubble stays on left side leaving right lane clear (maxX=${worldBox56.max.x.toFixed(3)})`
          )
        } else {
          assert(
            worldBox56.min.x >= nsCenter56.x + 0.72,
            `${sideLabel} rubble stays on right side leaving left lane clear (minX=${worldBox56.min.x.toFixed(3)})`
          )
        }
      }
    }

    // Opposite lane outside damage zone & physically passable BEFORE clearing; hazard-side lane blocked
    assert(
      !sideHaz._isPointInWallCollapseArea(nsCenter56.x + safeLaneOffsetX, nsCenter56.z),
      `${sideLabel} opposite lane lies outside wall_collapse danger zone`
    )
    const oppPassBefore = moveWithSubsteps(
      nsCenter56.x + safeLaneOffsetX,
      nsFromSouth.z,
      0,
      nsToNorth.z - nsFromSouth.z,
      nsMaze56,
      { radius: PLAYER_RADIUS, propColliders: sideEng._propCollisionIndex }
    )
    assert(
      oppPassBefore.hitProp === false && Math.abs(oppPassBefore.z - nsToNorth.z) < 0.05,
      `${sideLabel} opposite lane is completely passable BEFORE clearing rubble`
    )

    const hazSideBlocked = moveWithSubsteps(
      nsCenter56.x + blockedLaneOffsetX,
      nsFromSouth.z,
      0,
      nsToNorth.z - nsFromSouth.z,
      nsMaze56,
      { radius: PLAYER_RADIUS, propColliders: sideEng._propCollisionIndex }
    )
    assert(
      hazSideBlocked.hitProp === true && hazSideBlocked.z > nsCenter56.z,
      `${sideLabel} hazard-side lane is physically blocked by aftermath-rubble OBB before clearing`
    )

    // Press F (Clear Fallen Masonry) -> moves rubble & slabs cleanly near wall without overlapping each other
    sideEng.setPlayerWorldPosition(nsCenter56.x - rubbleSideSign * 0.15, 0, nsCenter56.z, { immediate: true })
    sideEng.stepFrame(0.02, { render: false })
    const prompt56 = sideEng.getNearbyInteractable()
    assert(
      prompt56?.kind === 'hazard' &&
        prompt56.type === HAZARD_TYPES.WALL_COLLAPSE &&
        prompt56.label === 'Clear Fallen Masonry',
      `${sideLabel} offers Clear Fallen Masonry (F) interaction`
    )
    const clear56 = sideEng.interact()
    assert(
      clear56?.handled === true &&
        clear56.action === 'clear_rubble' &&
        sideCol.enabled === false &&
        sideEng.getNearbyInteractable() === null,
      `${sideLabel} Clear Fallen Masonry disables collider and removes prompt`
    )

    // Verify cleared slabs sit flush <= wallZ + 0.30m and do not overlap one another in mount local space
    sideMesh.userData.wallMountGroup.updateMatrixWorld(true)
    const invSideClear = new THREE.Matrix4().copy(sideMesh.userData.wallMountGroup.matrixWorld).invert()
    const clearedSlabBoxes = sideMesh.userData.slabMeshes.map((slab) =>
      new THREE.Box3().setFromObject(slab).applyMatrix4(invSideClear)
    )
    for (let i = 0; i < clearedSlabBoxes.length; i += 1) {
      assert(
        clearedSlabBoxes[i].max.z <= sideMesh.userData.wallZ + 0.3 &&
          clearedSlabBoxes[i].min.y >= -0.005,
        `${sideLabel} cleared slab ${i} stays flush inside <= 0.30m wall margin`
      )
      for (let j = i + 1; j < clearedSlabBoxes.length; j += 1) {
        assert(
          !clearedSlabBoxes[i].intersectsBox(clearedSlabBoxes[j]),
          `${sideLabel} cleared slabs ${i} and ${j} do not overlap each other`
        )
      }
    }

    // Opposite lane remains passable AFTER clearing, and prior rubble lane opens cleanly
    const oppPassAfter = moveWithSubsteps(
      nsCenter56.x + safeLaneOffsetX,
      nsFromSouth.z,
      0,
      nsToNorth.z - nsFromSouth.z,
      nsMaze56,
      { radius: PLAYER_RADIUS, propColliders: sideEng._propCollisionIndex }
    )
    const clearedLanePass = moveWithSubsteps(
      nsCenter56.x + blockedLaneOffsetX,
      nsFromSouth.z,
      0,
      nsToNorth.z - nsFromSouth.z,
      nsMaze56,
      { radius: PLAYER_RADIUS, propColliders: sideEng._propCollisionIndex }
    )
    assert(
      oppPassAfter.hitProp === false &&
        Math.abs(oppPassAfter.z - nsToNorth.z) < 0.05 &&
        clearedLanePass.hitProp === false &&
        Math.abs(clearedLanePass.z - nsToNorth.z) < 0.05,
      `${sideLabel} keeps opposite lane passable and opens prior rubble zone after F clear`
    )

    // Reset, maze rebuild & disposal lifecycle
    sideHaz.resetState()
    assert(
      sideHaz.getState() === HAZARD_STATES.DORMANT &&
        sideHaz.isAftermathCleared === false &&
        sideMesh.userData.cavityMesh.visible === false,
      `${sideLabel} resetState() restores dormant concealed wall`
    )
    sideEng.setMaze(generateMaze({ seed: 229944 }))
    const poolsBeforeClear56 = getHazardPoolStats()
    sideEng.clearHazards()
    const poolsAfterClear56 = getHazardPoolStats()
    assert(
      poolsBeforeClear56.geometries > 0 &&
        poolsAfterClear56.geometries === poolsBeforeClear56.geometries &&
        poolsAfterClear56.materials === poolsBeforeClear56.materials,
      `${sideLabel} preserves shared hazard pools across clearHazards()`
    )
    sideEng.dispose()
  }

  const poolsAfter56 = getHazardPoolStats()
  assert(
    poolsAfter56.geometries === poolsBefore56.geometries &&
      poolsAfter56.materials === poolsBefore56.materials,
    'Shared hazard geometry and material pools clean up cleanly after final engine dispose'
  )
}
console.log('✓ Side-wall camouflage parity, side-wall preference, left/right rubble spread, opposite-lane passability & clear interaction verified')

// 57. Environmental Hazard Camouflage 6/12 — Electrical Wiring, Ceiling Collapse, Steam Pipes & Falling Pipes
console.log('Test 57: Environmental Hazard Camouflage (6/12) — Dormant Parity, Pre/Post-Activation Rules, Decoys & Pool Lifecycle')
{
  const maze57A = generateMaze({ seed: 612026, level: 26 })
  const maze57B = generateMaze({ seed: 612026, level: 26 })
  const hazards57 = placeHazards(maze57A)
  const props57 = placeEnvironmentalProps(maze57A, { hazards: hazards57 })
  const decoyOpts57 = { hazards: hazards57, placedProps: props57 }

  // A. Deterministic decoy placement & zero overlap across walls/start/exit/hazards/props/other decoys
  const ccDecoysA = placeCeilingCollapseDecoys(maze57A, decoyOpts57)
  const ccDecoysB = placeCeilingCollapseDecoys(maze57B, {
    hazards: placeHazards(maze57B),
    placedProps: props57,
  })
  assert(ccDecoysA.length > 0 && JSON.stringify(ccDecoysA) === JSON.stringify(ccDecoysB), 'Ceiling collapse decoys are deterministic')

  const ewDecoysA = placeElectricalWiringDecoys(maze57A, {
    ...decoyOpts57,
    excludedCells: new Set(ccDecoysA.map((d) => `${d.row},${d.col}`)),
  })
  const ewDecoysB = placeElectricalWiringDecoys(maze57B, {
    hazards: placeHazards(maze57B),
    placedProps: props57,
    excludedCells: new Set(ccDecoysB.map((d) => `${d.row},${d.col}`)),
  })
  assert(ewDecoysA.length > 0 && JSON.stringify(ewDecoysA) === JSON.stringify(ewDecoysB), 'Electrical wiring decoys are deterministic')

  const spDecoysA = placeSteamPipeDecoys(maze57A, {
    ...decoyOpts57,
    excludedCells: new Set([...ccDecoysA, ...ewDecoysA].map((d) => `${d.row},${d.col}`)),
  })
  const spDecoysB = placeSteamPipeDecoys(maze57B, {
    hazards: placeHazards(maze57B),
    placedProps: props57,
    excludedCells: new Set([...ccDecoysB, ...ewDecoysB].map((d) => `${d.row},${d.col}`)),
  })
  assert(spDecoysA.length > 0 && JSON.stringify(spDecoysA) === JSON.stringify(spDecoysB), 'Steam pipe decoys are deterministic')

  const fpDecoysA = placeFallingPipesDecoys(maze57A, {
    ...decoyOpts57,
    excludedCells: new Set([...ccDecoysA, ...ewDecoysA, ...spDecoysA].map((d) => `${d.row},${d.col}`)),
  })
  const fpDecoysB = placeFallingPipesDecoys(maze57B, {
    hazards: placeHazards(maze57B),
    placedProps: props57,
    excludedCells: new Set([...ccDecoysB, ...ewDecoysB, ...spDecoysB].map((d) => `${d.row},${d.col}`)),
  })
  assert(fpDecoysA.length > 0 && JSON.stringify(fpDecoysA) === JSON.stringify(fpDecoysB), 'Falling pipes decoys are deterministic')

  const baseBlockedKeys57 = new Set([
    ...hazards57.map((h) => `${h.row},${h.col}`),
    ...props57.map((p) => `${p.row},${p.col}`),
    `${maze57A.exit.row},${maze57A.exit.col}`,
  ])
  const seenDecoyCells57 = new Set()
  for (const [label, list] of [
    ['ceiling_collapse', ccDecoysA],
    ['exposed_electrical_wiring', ewDecoysA],
    ['steam_pipe_burst', spDecoysA],
    ['falling_pipes_fixtures', fpDecoysA],
  ]) {
    for (const d of list) {
      const k = `${d.row},${d.col}`
      assert(maze57A.grid[d.row]?.[d.col] === CELL_TYPES.PATH, `${label} decoy stays inside PATH cell`)
      assert(
        Math.abs(d.row - maze57A.start.row) + Math.abs(d.col - maze57A.start.col) > 2,
        `${label} decoy respects start exclusion radius`
      )
      assert(!baseBlockedKeys57.has(k), `${label} decoy does not overlap hazard/prop/exit cell`)
      assert(!seenDecoyCells57.has(k), `${label} decoy does not overlap previous decoy layer cell`)
      seenDecoyCells57.add(k)
    }
  }

  // B. Built maze decoy InstancedMesh layers & Dormant Visual Parity (zero unique dormant tells)
  const built57 = buildMazeMeshes(maze57A, { hazards: hazards57, qualityPreset: 'high' })
  const envMats57 = getEnvironmentalPropMaterials({ qualityPreset: 'high' })
  const decoyLayers57 = [
    [CEILING_COLLAPSE_CONSTANTS.decoyLayerName, 'ceilingCollapseDecoyCount'],
    [ELECTRICAL_WIRING_CONSTANTS.decoyLayerName, 'electricalWiringDecoyCount'],
    [STEAM_PIPE_CONSTANTS.decoyLayerName, 'steamPipeDecoyCount'],
    [FALLING_PIPES_CONSTANTS.decoyLayerName, 'fallingPipesDecoyCount'],
  ]
  for (const [layerName, countKey] of decoyLayers57) {
    const grp = built57.getObjectByName(layerName)
    assert(
      grp && grp.children.length > 0 && built57.userData?.[countKey] > 0,
      `Maze builds instanced decoy group ${layerName}`
    )
    for (const inst of grp.children) {
      assert(inst.isInstancedMesh && inst.count > 0, `${layerName} child ${inst.name} is valid InstancedMesh`)
    }
  }

  // B1. EXPOSED_ELECTRICAL_WIRING dormant parity (wall & ceiling)
  const ewSharedMats57 = new Set([
    envMats57.darkSteel,
    envMats57.lockerBlue,
    envMats57.rustyMetal,
    envMats57.cableBlack,
    envMats57.warningYellow,
  ])
  const ewDecoyGrp57 = built57.getObjectByName(ELECTRICAL_WIRING_CONSTANTS.decoyLayerName)
  for (const inst of ewDecoyGrp57.children) {
    assert(ewSharedMats57.has(inst.material), `Electrical decoy ${inst.name} uses shared envMats material`)
  }
  for (const mountType of ['wall', 'ceiling']) {
    const ewAgent = new HazardAgent(
      { id: `ew-parity-${mountType}`, type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING, row: 1, col: 1, mountType, wallYaw: 0 },
      maze57A
    )
    const ewMesh = ewAgent.getMesh()
    const ewd = ewMesh.userData
    updateHazardVisualState(ewMesh, 'dormant', 0)
    assert(
      ewd.junctionDoorGroup.rotation.y === 0 &&
        Math.abs(ewd.breakerHandleGroup.rotation.x - -0.58) < 1e-6 &&
        ewd.tipMat.color.getHex() === HAZARD_PALETTE.wiringCable &&
        ewd.tipMat.emissiveIntensity === 0 &&
        ewd.arcGroup.visible === false &&
        ewd.sparkGroup.visible === false &&
        ewd.glowMesh.visible === false &&
        ewd.insulationGroup.visible === false,
      `Dormant ${mountType} electrical wiring has latched door, matte cable tips, and zero exposed arcs/sparks/insulation`
    )
    ewd.mountGroup.traverse((n) => {
      if (n.isMesh && !ewd.arcBolts.some((b) => b.children.includes(n)) && !ewd.sparkMeshes.includes(n) && n !== ewd.glowMesh && !ewd.insulationGroup.children.some((g) => g.children.includes(n)) && n.material !== ewd.tipMat) {
        assert(ewSharedMats57.has(n.material), `Dormant ${mountType} electrical hardware shares facility envMats material`)
      }
    })
    ewAgent.dispose()
  }

  // B2. CEILING_COLLAPSE dormant parity
  const ccDecoyGrp57 = built57.getObjectByName(CEILING_COLLAPSE_CONSTANTS.decoyLayerName)
  const ccDecoyPanel57 = ccDecoyGrp57.getObjectByName('ceiling-collapse-decoy-panels')
  const ccSpec57 = hazards57.find((h) => h.type === HAZARD_TYPES.CEILING_COLLAPSE)
  const ccAgent57 = new HazardAgent(ccSpec57, maze57A)
  const ccMesh57 = ccAgent57.getMesh()
  const ccd57 = ccMesh57.userData
  updateHazardVisualState(ccMesh57, 'dormant', 0)
  assert(
    ccd57.ceilingSoffitRimMesh.visible === true &&
      Math.abs(ccd57.ceilingSoffitRimMesh.position.y - (ccd57.soffitY - 0.007)) < 1e-6 &&
      ccd57.ceilingSoffitRimMesh.geometry === ccDecoyPanel57.geometry &&
      ccd57.ceilingSoffitRimMesh.material === ccDecoyPanel57.material &&
      ccd57.ceilingCrackGroup.visible === false &&
      ccd57.ceilingCavityGroup.visible === false &&
      ccd57.ceilingWarnPebbleGroup.visible === false &&
      ccd57.ceilingDustGroup.visible === false &&
      ccd57.ceilingDebrisMeshes.every(
        (m) => m.castShadow === false && m.scale.y <= 0.012 && Math.abs(m.position.y - (ccd57.soffitY - 0.006)) < 1e-6
      ),
    'Dormant ceiling collapse panel matches safe ceiling decoys identically with cracks/cavity/rubble concealed'
  )
  ccAgent57.dispose()

  // B3. STEAM_PIPE_BURST dormant parity (wall & ceiling)
  const spSharedMats57 = new Set([
    envMats57.rustyMetal,
    envMats57.darkSteel,
    envMats57.warningYellow,
    envMats57.cableBlack,
  ])
  const spDecoyGrp57 = built57.getObjectByName(STEAM_PIPE_CONSTANTS.decoyLayerName)
  for (const inst of spDecoyGrp57.children) {
    assert(spSharedMats57.has(inst.material), `Steam pipe decoy ${inst.name} uses shared envMats material`)
  }
  for (const mountType of ['wall', 'ceiling']) {
    const spAgent = new HazardAgent(
      { id: `sp-parity-${mountType}`, type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 1, col: 1, mountType, steamYaw: 0 },
      maze57A
    )
    const spMesh = spAgent.getMesh()
    const spd = spMesh.userData
    updateHazardVisualState(spMesh, 'dormant', 0)
    assert(
      spd.gasketRing.position.length() < 1e-6 &&
        Math.abs(spd.leftUnionPlate.position.x - -0.022) < 1e-6 &&
        Math.abs(spd.rightUnionPlate.position.x - 0.022) < 1e-6 &&
        spd.valveWheelMesh.rotation.z === 0 &&
        spd.condensationGroup.visible === false &&
        spd.steamCloud.visible === false &&
        spd.plumeLobeMeshes.every((l) => l.visible === false) &&
        spd.repairPatchGroup.visible === false &&
        spd.steamMat.opacity === 0,
      `Dormant ${mountType} steam pipe union is flush/unstrained with valve intact and plumes hidden`
    )
    for (const grp of [spd.steamSupportGroup, spd.steamGroup]) {
      grp.traverse((n) => {
        if (n.isMesh && !spd.repairPatchGroup.children.includes(n)) {
          assert(spSharedMats57.has(n.material), `Dormant ${mountType} steam hardware shares envMats material`)
        }
      })
    }
    spAgent.dispose()
  }

  // B4. FALLING_PIPES_FIXTURES dormant parity (wall & ceiling)
  const fpDecoyGrp57 = built57.getObjectByName(FALLING_PIPES_CONSTANTS.decoyLayerName)
  for (const inst of fpDecoyGrp57.children) {
    assert(spSharedMats57.has(inst.material), `Falling pipe decoy ${inst.name} uses shared envMats material`)
  }
  for (const mountType of ['wall', 'ceiling']) {
    const fpAgent = new HazardAgent(
      { id: `fp-parity-${mountType}`, type: HAZARD_TYPES.FALLING_PIPES_FIXTURES, row: 1, col: 1, mountType, pipeYaw: 0 },
      maze57A
    )
    const fpMesh = fpAgent.getMesh()
    const fpd = fpMesh.userData
    updateHazardVisualState(fpMesh, 'dormant', 0)
    assert(
      Math.abs(fpd.pipeGroup.position.x) < 1e-6 &&
        Math.abs(fpd.pipeGroup.position.y - fpd.pipeRestY) < 1e-6 &&
        Math.abs(fpd.pipeGroup.position.z - fpd.overheadZ) < 1e-6 &&
        fpd.pipeGroup.rotation.x === 0 &&
        fpd.pipeGroup.rotation.y === 0 &&
        fpd.pipeGroup.rotation.z === 0 &&
        fpd.leftStrainRod.rotation.x === 0 &&
        fpd.leftStrainRod.rotation.z === 0 &&
        Math.abs(fpd.leftStrainRod.scale.y - 1) < 1e-6 &&
        fpd.rightStrainRod.rotation.x === 0 &&
        fpd.rightStrainRod.rotation.z === 0 &&
        Math.abs(fpd.rightStrainRod.scale.y - 1) < 1e-6 &&
        fpd.pipeWarnFlakeGroup.visible === false &&
        fpd.pipeDustGroup.visible === false &&
        fpd.pipeDustMat.opacity === 0,
      `Dormant ${mountType} falling pipe sits flush overhead with straight hanger rods and zero flakes/dust`
    )
    for (const grp of [fpd.ceilingRemnantGroup, fpd.pipeGroup]) {
      grp.traverse((n) => {
        if (n.isMesh) {
          assert(spSharedMats57.has(n.material), `Dormant ${mountType} overhead pipe shares envMats material`)
        }
      })
    }
    fpAgent.dispose()
  }
  disposeMazeGroup(built57)

  // C. Live Engine Behavior: Harmless decoys, pre-activation lockout, repeated immunity-gated damage, post-activation F & aftermath clearing
  const eng57 = createHeadlessEngine({ enemies: { autoSpawn: false } })
  eng57.setMaze(maze57A)
  eng57.cancelSpawnSequence()

  // C1. All 4 decoy types are harmless & non-interactable
  const decoyCheckSets57 = [
    built57.userData?.ceilingCollapseDecoysGroup?.userData?.decoys || ccDecoysA,
    ewDecoysA,
    spDecoysA,
    fpDecoysA,
  ]
  for (const list of decoyCheckSets57) {
    for (const d of list.slice(0, 2)) {
      const w = gridToWorld(d.row, d.col, maze57A)
      eng57.setPlayerWorldPosition(w.x, 0, w.z, { immediate: true })
      eng57.stepFrame(0.05, { render: false })
      assert(
        eng57.health === 100 &&
          eng57.hazardManager.findNearestInteractable({ x: w.x, y: 0, z: w.z }, { row: d.row, col: d.col }) === null &&
          eng57.hazardManager.getHazards().every((h) => h.getState() === HAZARD_STATES.DORMANT),
        `Decoy ${d.id} deals zero damage, surfaces no hazard prompt, and triggers no hazards`
      )
    }
  }

  // C2. Exposed electrical wiring: cannot neutralize before active, deals repeated immunity-gated damage, F insulates & stops damage
  const liveEw57 = eng57.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING)
  assert(Boolean(liveEw57), 'Engine spawns exposed_electrical_wiring hazard')
  const ewArea57 = liveEw57.getDangerArea()
  assert(
    liveEw57.canPlayerInteract({ x: ewArea57.center.x, y: 0, z: ewArea57.center.z }, { row: liveEw57.row, col: liveEw57.col }) === false,
    'Electrical wiring cannot be insulated while dormant'
  )
  eng57.setPlayerWorldPosition(ewArea57.center.x, 0, ewArea57.center.z, { immediate: true })
  eng57.stepFrame(0.05, { render: false })
  assert(liveEw57.getState() === HAZARD_STATES.WARNING, 'Approaching camouflaged electrical wiring triggers WARNING')
  assert(
    liveEw57.canPlayerInteract({ x: ewArea57.center.x, y: 0, z: ewArea57.center.z }, { row: liveEw57.row, col: liveEw57.col }) === false,
    'Electrical wiring cannot be insulated before activation (during WARNING)'
  )
  eng57.stepFrame(liveEw57.config.warningDuration + 0.08, { render: false })
  const hpAfterFirstShock = eng57.health
  assert(
    liveEw57.getState() === HAZARD_STATES.ACTIVE && hpAfterFirstShock < 100,
    'Electrical wiring activates and deals initial shock damage'
  )
  // Immediate step during invulnerability cooldown must not stack damage
  eng57.stepFrame(0.05, { render: false })
  assert(eng57.health === hpAfterFirstShock, 'Electrical damage respects player immunity window')
  // Wait out immunity window -> repeated shock damage continues while active
  eng57.stepFrame(2.0, { render: false })
  assert(eng57.health < hpAfterFirstShock, 'Active electrical wiring deals repeated damage after immunity expires')

  eng57.stepFrame(0.02, { render: false })
  const ewPrompt57 = eng57.getNearbyInteractable()
  assert(
    ewPrompt57?.kind === 'hazard' &&
      ewPrompt57.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING &&
      ewPrompt57.label === 'Insulate Exposed Wiring',
    'Active electrical wiring offers Insulate Exposed Wiring (F) prompt'
  )
  const ewRes57 = eng57.interact()
  assert(
    ewRes57?.handled === true &&
      ewRes57.action === 'insulate_wiring' &&
      liveEw57.isAftermathCleared === true &&
      liveEw57.getState() === HAZARD_STATES.DISABLED &&
      liveEw57.getMesh().userData.insulationGroup.visible === true &&
      liveEw57.getMesh().userData.tipMat.emissiveIntensity === 0 &&
      liveEw57.getMesh().userData.arcGroup.visible === false &&
      eng57.getNearbyInteractable() === null,
    'Post-activation F insulates wiring, extinguishes arcs, disables hazard, and clears prompt'
  )
  const hpInsulated57 = eng57.health
  eng57.stepFrame(2.2, { render: false })
  assert(eng57.health === hpInsulated57, 'Insulated electrical wiring deals zero further damage')

  // C3. Steam pipe burst: cannot seal before active, deals repeated immunity-gated damage, F seals & stops damage
  eng57.resetCombat()
  const hpBeforeSteamCheck = eng57.health
  const liveSp57 = eng57.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.STEAM_PIPE_BURST)
  assert(Boolean(liveSp57), 'Engine spawns steam_pipe_burst hazard')
  const spArea57 = liveSp57.getDangerArea()
  assert(
    liveSp57.canPlayerInteract({ x: spArea57.center.x, y: 0, z: spArea57.center.z }, { row: liveSp57.row, col: liveSp57.col }) === false,
    'Steam pipe cannot be sealed while dormant'
  )
  eng57.setPlayerWorldPosition(spArea57.center.x, 0, spArea57.center.z, { immediate: true })
  eng57.stepFrame(0.05, { render: false })
  assert(liveSp57.getState() === HAZARD_STATES.WARNING, 'Approaching camouflaged steam pipe triggers WARNING')
  assert(
    liveSp57.canPlayerInteract({ x: spArea57.center.x, y: 0, z: spArea57.center.z }, { row: liveSp57.row, col: liveSp57.col }) === false,
    'Steam pipe cannot be sealed before activation (during WARNING)'
  )
  eng57.stepFrame(liveSp57.config.warningDuration + 0.08, { render: false })
  const hpAfterFirstSteam = eng57.health
  assert(
    liveSp57.getState() === HAZARD_STATES.ACTIVE && hpAfterFirstSteam < hpBeforeSteamCheck,
    'Steam pipe bursts into ACTIVE and deals initial steam damage'
  )
  eng57.stepFrame(0.05, { render: false })
  assert(eng57.health === hpAfterFirstSteam, 'Steam damage respects player immunity window')
  // Heal via temporary health bump or reset check after confirming repeated tick (health starts > 50, so verify drop)
  const hpBeforeSecondSteam = eng57.health
  eng57.stepFrame(2.0, { render: false })
  assert(eng57.health < hpBeforeSecondSteam, 'Active steam pipe deals repeated damage after immunity expires')

  eng57.stepFrame(0.02, { render: false })
  const spPrompt57 = eng57.getNearbyInteractable()
  assert(
    spPrompt57?.kind === 'hazard' &&
      spPrompt57.type === HAZARD_TYPES.STEAM_PIPE_BURST &&
      spPrompt57.label === 'Seal Steam Pipe',
    'Active steam pipe offers Seal Steam Pipe (F) prompt'
  )
  const spRes57 = eng57.interact()
  assert(
    spRes57?.handled === true &&
      spRes57.action === 'seal_steam_pipe' &&
      liveSp57.isAftermathCleared === true &&
      liveSp57.getState() === HAZARD_STATES.DISABLED &&
      liveSp57.getMesh().userData.repairPatchGroup.visible === true &&
      Math.abs(liveSp57.getMesh().userData.valveWheelMesh.rotation.z - -Math.PI * 0.75) < 1e-6 &&
      liveSp57.getMesh().userData.steamCloud.visible === false &&
      liveSp57.getMesh().userData.steamMat.opacity === 0 &&
      eng57.getNearbyInteractable() === null,
    'Post-activation F seals steam pipe, shuts valve, stops plume, and clears prompt'
  )
  const hpSealed57 = eng57.health
  eng57.stepFrame(2.2, { render: false })
  assert(eng57.health === hpSealed57, 'Sealed steam pipe deals zero further damage')

  // D. Ceiling collapse & Falling pipes preserved behavior (trigger, animation, damage, aftermath collider, F clear)
  eng57.resetCombat()
  assert(
    eng57.health === 100 &&
      liveEw57.getState() === HAZARD_STATES.DORMANT &&
      liveEw57.isAftermathCleared === false &&
      liveEw57.getMesh().userData.insulationGroup.visible === false &&
      liveSp57.getState() === HAZARD_STATES.DORMANT &&
      liveSp57.isAftermathCleared === false &&
      liveSp57.getMesh().userData.repairPatchGroup.visible === false,
    'resetCombat() cleanly restores electrical wiring & steam pipe to dormant camouflage'
  )

  const liveCc57 = eng57.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.CEILING_COLLAPSE)
  assert(Boolean(liveCc57), 'Engine spawns ceiling_collapse hazard')
  const ccArea57 = liveCc57.getDangerArea()
  eng57.setPlayerWorldPosition(ccArea57.center.x, 0, ccArea57.center.z, { immediate: true })
  eng57.stepFrame(0.05, { render: false })
  assert(liveCc57.getState() === HAZARD_STATES.WARNING, 'Camouflaged ceiling collapse enters WARNING')
  eng57.stepFrame(liveCc57.config.warningDuration + 0.08, { render: false })
  assert(liveCc57.getState() === HAZARD_STATES.ACTIVE && eng57.health < 100, 'Ceiling collapse activates and deals impact damage')
  eng57.stepFrame(liveCc57.config.activeDuration + 0.1, { render: false })
  const ccCol57 = getDynamicCollider(eng57._propCollisionIndex, `${liveCc57.id}:aftermath-rubble`)
  assert(
    liveCc57.getState() === HAZARD_STATES.DISABLED &&
      liveCc57.isPermanentlyCollapsed === true &&
      ccCol57?.enabled === true,
    'Ceiling collapse settles into permanent rubble with active OBB collider'
  )
  eng57.stepFrame(0.02, { render: false })
  const ccRes57 = eng57.interact()
  assert(
    ccRes57?.handled === true && ccRes57.action === 'clear_rubble' && ccCol57.enabled === false,
    'Clear Ceiling Rubble (F) disables ceiling aftermath collider'
  )

  const liveFp57 = eng57.hazardManager.getHazards().find((h) => h.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES)
  assert(Boolean(liveFp57), 'Engine spawns falling_pipes_fixtures hazard')
  const fpArea57 = liveFp57.getDangerArea()
  const hpBeforeFp57 = eng57.health
  eng57.stepFrame(2.0, { render: false })
  eng57.setPlayerWorldPosition(fpArea57.center.x, 0, fpArea57.center.z, { immediate: true })
  eng57.stepFrame(0.05, { render: false })
  assert(liveFp57.getState() === HAZARD_STATES.WARNING, 'Camouflaged falling pipes enter WARNING')
  eng57.stepFrame(liveFp57.config.warningDuration + 0.08, { render: false })
  assert(liveFp57.getState() === HAZARD_STATES.ACTIVE && eng57.health < hpBeforeFp57, 'Falling pipes detach into ACTIVE and deal damage')
  eng57.stepFrame(liveFp57.config.activeDuration + 0.1, { render: false })
  const fpCol57 = getDynamicCollider(eng57._propCollisionIndex, `${liveFp57.id}:aftermath-pipe`)
  assert(
    liveFp57.getState() === HAZARD_STATES.DISABLED &&
      liveFp57.isPermanentlyCollapsed === true &&
      fpCol57?.enabled === true,
    'Fallen pipe rests permanently on corridor floor with active OBB collider'
  )
  eng57.stepFrame(0.02, { render: false })
  const fpRes57 = eng57.interact()
  assert(
    fpRes57?.handled === true && fpRes57.action === 'clear_pipe' && fpCol57.enabled === false,
    'Move Fallen Pipe (F) disables pipe aftermath collider'
  )

  // E. Maze replacement, clearHazards(), pool preservation & final disposal cleanup
  eng57.setMaze(generateMaze({ seed: 612099 }))
  const poolsWarm57 = getHazardPoolStats()
  eng57.clearHazards()
  const poolsAfterClear57 = getHazardPoolStats()
  assert(
    poolsWarm57.geometries > 0 &&
      poolsAfterClear57.geometries === poolsWarm57.geometries &&
      poolsAfterClear57.materials === poolsWarm57.materials,
    'Shared hazard geometry and material pools preserved across maze replacement and clearHazards()'
  )
  eng57.dispose()
  const poolsFinal57 = getHazardPoolStats()
  assert(
    poolsFinal57.geometries === 0 && poolsFinal57.materials === 0,
    'Shared hazard pools dispose cleanly when last engine unmounts'
  )
}
console.log('✓ Environmental Hazard Camouflage (6/12) across wiring, ceiling collapse, steam pipes & falling pipes verified')

// 58. Falling Pipe Orientation & Transverse Obstacle (7/12)
console.log('Test 58: Falling Pipe Transverse Orientation, Blocking Obstacle, Alignment & Parity (7/12)...')
{
  // A. Synthetic N-S and E-W corridors: pipe MUST span transversely across the player's path
  const nsGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
  ]
  const ewGrid = [
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
  ]
  const nsMaze = {
    grid: nsGrid,
    width: 3,
    height: 5,
    seed: 71201,
    start: { row: 1, col: 1 },
    exit: { row: 3, col: 1 },
  }
  const ewMaze = {
    grid: ewGrid,
    width: 5,
    height: 3,
    seed: 71202,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 3 },
  }

  const nsMount = resolveFallingPipesMount(nsGrid, 2, 1)
  const ewMount = resolveFallingPipesMount(ewGrid, 1, 2)
  assert(
    nsMount.mountType === 'wall' &&
      nsMount.corridorAxis === 'ns' &&
      Math.abs(nsMount.pipeYaw) < 1e-6 &&
      nsMount.wallSide === 'west' &&
      nsMount.oppositeWallSide === 'east',
    `N-S corridor mounts pipe transversely West-to-East (yaw=${nsMount.pipeYaw}, axis=${nsMount.corridorAxis})`
  )
  assert(
    ewMount.mountType === 'wall' &&
      ewMount.corridorAxis === 'ew' &&
      Math.abs(ewMount.pipeYaw - Math.PI * 0.5) < 1e-6 &&
      ewMount.wallSide === 'north' &&
      ewMount.oppositeWallSide === 'south',
    `E-W corridor mounts pipe transversely North-to-South (yaw=${ewMount.pipeYaw}, axis=${ewMount.corridorAxis})`
  )

  // B. Verify dormant world geometry spans across corridor width (not lengthwise) & matches decoy bounds/materials
  for (const [label, mazeCase, cellCase, mountCase] of [
    ['N-S corridor', nsMaze, { row: 2, col: 1 }, nsMount],
    ['E-W corridor', ewMaze, { row: 1, col: 2 }, ewMount],
  ]) {
    const cellWorld58 = gridToWorld(cellCase.row, cellCase.col, mazeCase)
    const hazAgent = new HazardAgent(
      {
        id: `fp58-${label}`,
        type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
        ...cellCase,
        ...mountCase,
      },
      mazeCase
    )
    const hazMesh = hazAgent.getMesh()
    hazMesh.updateMatrixWorld(true)

    const dormantPipeBox = new THREE.Box3().setFromObject(hazMesh.userData.pipeGroup)
    const dormantWholeBox = new THREE.Box3()
      .setFromObject(hazMesh.userData.ceilingRemnantGroup)
      .union(dormantPipeBox)
    const spanX = dormantPipeBox.max.x - dormantPipeBox.min.x
    const spanZ = dormantPipeBox.max.z - dormantPipeBox.min.z
    const transverseSpan = mountCase.corridorAxis === 'ns' ? spanX : spanZ
    const longitudinalDepth = mountCase.corridorAxis === 'ns' ? spanZ : spanX

    assert(
      transverseSpan >= 3.7 && transverseSpan <= 3.96 && longitudinalDepth <= 0.42,
      `${label}: dormant pipe spans transversely across corridor (${transverseSpan.toFixed(2)}m wide x ${longitudinalDepth.toFixed(2)}m deep)`
    )
    assert(
      dormantWholeBox.min.x >= cellWorld58.x - CELL_SIZE * 0.5 - 0.005 &&
        dormantWholeBox.max.x <= cellWorld58.x + CELL_SIZE * 0.5 + 0.005 &&
        dormantWholeBox.min.z >= cellWorld58.z - CELL_SIZE * 0.5 - 0.005 &&
        dormantWholeBox.max.z <= cellWorld58.z + CELL_SIZE * 0.5 + 0.005,
      `${label}: dormant overhead pipe and wall collars stay cleanly inside corridor wall boundaries`
    )

    // Compare dormant hazard directly against safe overhead decoy built at same cell
    const decoyGroup = buildFallingPipesDecoys(
      mazeCase,
      [{ ...cellCase, ...mountCase }],
      { qualityPreset: 'high' }
    )
    assert(Boolean(decoyGroup), `${label}: safe decoy layer builds`)
    decoyGroup.updateMatrixWorld(true)
    const decoyBox = new THREE.Box3()
    const decoyMats = new Set()
    decoyGroup.traverse((n) => {
      if (n.isInstancedMesh) {
        decoyMats.add(n.material)
        const m = new THREE.Matrix4()
        n.getMatrixAt(0, m)
        n.geometry.computeBoundingBox()
        const b = n.geometry.boundingBox.clone().applyMatrix4(m)
        decoyBox.union(b)
      }
    })
    assert(
      Math.abs(decoyBox.min.x - dormantWholeBox.min.x) <= 0.02 &&
        Math.abs(decoyBox.max.x - dormantWholeBox.max.x) <= 0.02 &&
        Math.abs(decoyBox.min.y - dormantWholeBox.min.y) <= 0.02 &&
        Math.abs(decoyBox.max.y - dormantWholeBox.max.y) <= 0.02 &&
        Math.abs(decoyBox.min.z - dormantWholeBox.min.z) <= 0.02 &&
        Math.abs(decoyBox.max.z - dormantWholeBox.max.z) <= 0.02,
      `${label}: dormant hazard bounding box matches safe decoy identically`
    )
    const liveEnvMatSet58 = new Set(
      Object.values(getEnvironmentalPropMaterials({ qualityPreset: 'high' }))
    )
    for (const m of decoyMats) {
      assert(liveEnvMatSet58.has(m), `${label}: safe decoy reuses shared facility materials`)
    }
    const dormantHazMats = new Set()
    hazMesh.userData.pipeMountGroup.traverse((n) => {
      if (n.isMesh && n.visible && n.parent?.visible !== false) {
        dormantHazMats.add(n.material)
      }
    })
    assert(
      decoyMats.size === dormantHazMats.size &&
        [...dormantHazMats].every((m) => decoyMats.has(m)),
      `${label}: dormant hazard visible material set matches safe decoy identically`
    )

    // C. Fall animation continuity, horizontal settling, zero gap underneath, zero wall/floor clipping
    updateHazardVisualState(hazMesh, HAZARD_STATES.WARNING, 1.0)
    const warnEnd58 = hazMesh.userData.pipeGroup.position.clone()
    updateHazardVisualState(hazMesh, HAZARD_STATES.ACTIVE, 0.0)
    assert(
      warnEnd58.distanceTo(hazMesh.userData.pipeGroup.position) < 0.005,
      `${label}: continuous WARNING(1)->ACTIVE(0) handoff`
    )

    let minFallY = Infinity
    for (let s = 0; s <= 20; s += 1) {
      updateHazardVisualState(hazMesh, HAZARD_STATES.ACTIVE, s / 20)
      hazMesh.updateMatrixWorld(true)
      const stepBox = new THREE.Box3().setFromObject(hazMesh.userData.pipeGroup)
      if (stepBox.min.y < minFallY) minFallY = stepBox.min.y
      assert(
        stepBox.min.x >= cellWorld58.x - CELL_SIZE * 0.5 - 0.005 &&
          stepBox.max.x <= cellWorld58.x + CELL_SIZE * 0.5 + 0.005 &&
          stepBox.min.z >= cellWorld58.z - CELL_SIZE * 0.5 - 0.005 &&
          stepBox.max.z <= cellWorld58.z + CELL_SIZE * 0.5 + 0.005,
        `${label}: pipe never clips through corridor walls at p=${(s / 20).toFixed(2)}`
      )
    }
    assert(minFallY >= -0.002, `${label}: pipe never clips below floor y=0 (minY=${minFallY.toFixed(4)})`)

    updateHazardVisualState(hazMesh, HAZARD_STATES.DISABLED, 1.0)
    hazMesh.updateMatrixWorld(true)
    const fallenBox = new THREE.Box3().setFromObject(hazMesh.userData.pipeGroup)
    const fallenSpanX = fallenBox.max.x - fallenBox.min.x
    const fallenSpanZ = fallenBox.max.z - fallenBox.min.z
    const fallenTransverse = mountCase.corridorAxis === 'ns' ? fallenSpanX : fallenSpanZ
    const fallenDepth = mountCase.corridorAxis === 'ns' ? fallenSpanZ : fallenSpanX
    const barrelMesh = hazMesh.userData.pipeGroup.children[0]
    const barrelBox = new THREE.Box3().setFromObject(barrelMesh)

    assert(
      Math.abs(hazMesh.userData.pipeGroup.rotation.x) < 1e-4 &&
        Math.abs(hazMesh.userData.pipeGroup.rotation.y) < 1e-4 &&
        Math.abs(hazMesh.userData.pipeGroup.rotation.z) < 1e-4,
      `${label}: fallen pipe settles horizontally level across the corridor`
    )
    assert(
      fallenBox.min.y >= 0 && fallenBox.min.y <= 0.02 && barrelBox.min.y <= 0.06,
      `${label}: fallen pipe rests flush on floor with zero passable gap underneath (minY=${fallenBox.min.y.toFixed(4)}, barrelMinY=${barrelBox.min.y.toFixed(4)})`
    )
    assert(
      fallenTransverse >= 3.7 && fallenTransverse <= 3.96 && fallenDepth <= 0.42,
      `${label}: fallen pipe spans transversely across corridor (${fallenTransverse.toFixed(2)}m x ${fallenDepth.toFixed(2)}m)`
    )

    // D. Oriented damage zone alignment: hits across left/center/right span, misses lengthwise outside depth
    const transverseX = Math.cos(mountCase.pipeYaw)
    const transverseZ = -Math.sin(mountCase.pipeYaw)
    const travelX = Math.sin(mountCase.pipeYaw)
    const travelZ = Math.cos(mountCase.pipeYaw)

    for (const sideOffset of [-1.4, 0, 1.4]) {
      hazAgent.resetState()
      const hitPos = {
        x: cellWorld58.x + transverseX * sideOffset,
        y: 0,
        z: cellWorld58.z + transverseZ * sideOffset,
      }
      hazAgent.update(0.05, { playerWorldPos: hitPos, playerGridCell: cellCase })
      const hitRes = hazAgent.update(
        HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].warningDuration + 0.05,
        { playerWorldPos: hitPos, playerGridCell: cellCase }
      )
      assert(
        hitRes && hitRes.damage === HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].damage,
        `${label}: falling pipe impact hits player across corridor at transverse offset ${sideOffset}m`
      )
    }

    hazAgent.resetState()
    const dodgePos = {
      x: cellWorld58.x + travelX * 1.45,
      y: 0,
      z: cellWorld58.z + travelZ * 1.45,
    }
    hazAgent.update(0.05, { playerWorldPos: cellWorld58, playerGridCell: cellCase })
    const dodgeRes = hazAgent.update(
      HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].warningDuration + 0.05,
      { playerWorldPos: dodgePos, playerGridCell: cellCase }
    )
    assert(
      dodgeRes === null,
      `${label}: stepping lengthwise outside transverse danger band avoids impact damage`
    )

    // E. Collider alignment & full corridor blocking + F interaction + reset + disposal
    const eng58 = createHeadlessEngine({ enemies: { autoSpawn: false } })
    eng58.setMaze(mazeCase)
    eng58.cancelSpawnSequence()
    eng58.hazardManager.clear()
    eng58.syncHazardColliders({ allowPushOut: false })

    const livePipe = eng58.hazardManager.addHazard({
      id: `live-fp58-${label}`,
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      ...cellCase,
      ...mountCase,
    })
    eng58.syncHazardColliders({ allowPushOut: false })

    livePipe.update(0.05, { playerWorldPos: cellWorld58, playerGridCell: cellCase })
    livePipe.update(
      HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].warningDuration + 0.05,
      { playerWorldPos: dodgePos, playerGridCell: cellCase }
    )
    livePipe.update(
      HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].activeDuration + 0.05,
      { playerWorldPos: dodgePos, playerGridCell: cellCase }
    )
    eng58.syncHazardColliders({ allowPushOut: false })

    const col58 = getDynamicCollider(eng58._propCollisionIndex, `live-fp58-${label}:aftermath-pipe`)
    assert(
      col58 &&
        col58.enabled === true &&
        Math.hypot(col58.cx - cellWorld58.x, col58.cz - cellWorld58.z) < 0.05 &&
        Math.abs(col58.halfW - FALLING_PIPES_CONSTANTS.aftermathHalfW) < 1e-4 &&
        Math.abs(col58.halfD - FALLING_PIPES_CONSTANTS.aftermathHalfD) < 1e-4 &&
        Math.abs(col58.yaw - mountCase.pipeYaw) < 1e-4,
      `${label}: aftermath OBB collider aligns with fallen transverse pipe geometry`
    )

    // Verify player cannot sneak past on either wall edge or center
    for (const lane of [-1.2, -0.6, 0, 0.6, 1.2]) {
      const startX = cellWorld58.x - travelX * 1.55 + transverseX * lane
      const startZ = cellWorld58.z - travelZ * 1.55 + transverseZ * lane
      const attempt = moveWithSubsteps(
        startX,
        startZ,
        travelX * 3.1,
        travelZ * 3.1,
        mazeCase,
        {
          radius: PLAYER_RADIUS,
          propColliders: eng58._propCollisionIndex,
        }
      )
      const fwd = (attempt.x - cellWorld58.x) * travelX + (attempt.z - cellWorld58.z) * travelZ
      assert(
        attempt.hitProp === true && fwd < -0.5,
        `${label}: fallen pipe blocks passage at lane ${lane}m without clipping bypass (fwd=${fwd.toFixed(2)})`
      )
    }

    // Interact (F) to move fallen pipe aside lengthwise against left wall, restoring full corridor passage
    eng58.setPlayerWorldPosition(
      cellWorld58.x - travelX * 1.1,
      0,
      cellWorld58.z - travelZ * 1.1,
      { immediate: true }
    )
    eng58.stepFrame(0.016, { render: false })
    const clearRes58 = eng58.interact()
    assert(
      clearRes58?.handled === true && clearRes58.action === 'clear_pipe' && col58.enabled === false,
      `${label}: Move Fallen Pipe (F) clears transverse obstacle collider`
    )
    livePipe.getMesh().updateMatrixWorld(true)
    const clearedBox = new THREE.Box3().setFromObject(livePipe.getMesh().userData.pipeGroup)
    assert(
      clearedBox.min.y >= 0 &&
        clearedBox.min.x >= cellWorld58.x - CELL_SIZE * 0.5 - 0.005 &&
        clearedBox.max.x <= cellWorld58.x + CELL_SIZE * 0.5 + 0.005 &&
        clearedBox.min.z >= cellWorld58.z - CELL_SIZE * 0.5 - 0.005 &&
        clearedBox.max.z <= cellWorld58.z + CELL_SIZE * 0.5 + 0.005,
      `${label}: cleared pipe rests cleanly along corridor wall without floor or wall clipping`
    )
    const walkAfterClear = moveWithSubsteps(
      cellWorld58.x - travelX * 1.55,
      cellWorld58.z - travelZ * 1.55,
      travelX * 3.1,
      travelZ * 3.1,
      mazeCase,
      {
        radius: PLAYER_RADIUS,
        propColliders: eng58._propCollisionIndex,
      }
    )
    const fwdAfterClear =
      (walkAfterClear.x - cellWorld58.x) * travelX +
      (walkAfterClear.z - cellWorld58.z) * travelZ
    assert(
      walkAfterClear.hitProp === false && fwdAfterClear > 1.2,
      `${label}: corridor is freely walkable after Move Fallen Pipe (F)`
    )

    eng58.resetCombat()
    assert(
      livePipe.getState() === HAZARD_STATES.DORMANT &&
        Math.abs(livePipe.getMesh().userData.pipeGroup.position.y - livePipe.pipeRestY) < 1e-4 &&
        col58.enabled === false,
      `${label}: resetCombat restores dormant overhead transverse pipe`
    )

    hazAgent.dispose()
    eng58.dispose()
  }

  // F. Deterministic placement & safe decoys intact on generated maze
  const detMazeA = generateMaze({ seed: 712042 })
  const detMazeB = generateMaze({ seed: 712042 })
  const detHazA = placeHazards(detMazeA, { seed: 712042 })
  const detHazB = placeHazards(detMazeB, { seed: 712042 })
  const detDecA = placeFallingPipesDecoys(detMazeA, { seed: 712042, hazards: detHazA })
  const detDecB = placeFallingPipesDecoys(detMazeB, { seed: 712042, hazards: detHazB })
  assert(
    JSON.stringify(detHazA.filter((h) => h.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES)) ===
      JSON.stringify(detHazB.filter((h) => h.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES)) &&
      JSON.stringify(detDecA) === JSON.stringify(detDecB) &&
      detDecA.length >= 2,
    'Falling pipe hazards and safe overhead decoys remain deterministic and populated'
  )
}
console.log('✓ Falling Pipe Orientation (7/12) transverse mounting, decoy parity, flush blocking obstacle & alignment verified')

// 59. Fallen Pipe Traversal (8/12) — Step-Over Movement, Bidirectional & Angled Approaches, Grounding, Anti-Exploit, F-Clear & Lifecycle
console.log('Test 59: Fallen Pipe Traversal (8/12) — Step-Over Movement, Bidirectional & Angled Approaches, Grounding, Anti-Exploit, F-Clear & Lifecycle')
{
  const makeCorridorMaze59 = (axis, seed) => {
    const grid = [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 0, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ]
    if (axis === 'ns') {
      // Straight N-S corridor along col 3, rows 1..5
      grid[3][1] = 1
      grid[3][2] = 1
      grid[3][4] = 1
      grid[3][5] = 1
      return {
        seed,
        width: 7,
        height: 7,
        grid,
        start: { row: 1, col: 3 },
        exit: { row: 5, col: 3 },
        keycards: [],
      }
    }
    // Straight E-W corridor along row 3, cols 1..5
    grid[1][3] = 1
    grid[2][3] = 1
    grid[4][3] = 1
    grid[5][3] = 1
    return {
      seed,
      width: 7,
      height: 7,
      grid,
      start: { row: 3, col: 1 },
      exit: { row: 3, col: 5 },
      keycards: [],
    }
  }

  const corridorSpecs59 = [
    { label: 'NS', axis: 'ns', seed: 81201, cell: { row: 3, col: 3 } },
    { label: 'EW', axis: 'ew', seed: 81202, cell: { row: 3, col: 3 } },
  ]

  for (const spec of corridorSpecs59) {
    const maze59 = makeCorridorMaze59(spec.axis, spec.seed)
    const mount59 = resolveFallingPipesMount(maze59.grid, spec.cell.row, spec.cell.col)
    const cellWorld59 = gridToWorld(spec.cell.row, spec.cell.col, maze59)
    const transverseX = Math.cos(mount59.pipeYaw)
    const transverseZ = -Math.sin(mount59.pipeYaw)
    const travelX = Math.sin(mount59.pipeYaw)
    const travelZ = Math.cos(mount59.pipeYaw)

    const eng59 = createHeadlessEngine({ enemies: { autoSpawn: false } })
    eng59.setMaze(maze59)
    eng59.cancelSpawnSequence()
    eng59.hazardManager.clear()
    eng59.syncHazardColliders({ allowPushOut: false })

    const pipe59 = eng59.hazardManager.addHazard({
      id: `trav-pipe-${spec.label}`,
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      ...spec.cell,
      ...mount59,
    })
    eng59.syncHazardColliders({ allowPushOut: false })

    // Trigger and settle the pipe cleanly onto the floor
    const safeOutsidePos = {
      x: cellWorld59.x - travelX * 2.4,
      y: 0,
      z: cellWorld59.z - travelZ * 2.4,
    }
    pipe59.update(0.05, { playerWorldPos: cellWorld59, playerGridCell: spec.cell })
    pipe59.update(
      HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].warningDuration + 0.05,
      { playerWorldPos: safeOutsidePos, playerGridCell: spec.cell }
    )
    pipe59.update(
      HAZARD_CONFIG[HAZARD_TYPES.FALLING_PIPES_FIXTURES].activeDuration + 0.05,
      { playerWorldPos: safeOutsidePos, playerGridCell: spec.cell }
    )
    eng59.syncHazardColliders({ allowPushOut: false })

    const pipeCol59 = getDynamicCollider(
      eng59._propCollisionIndex,
      `trav-pipe-${spec.label}:aftermath-pipe`
    )
    assert(
      pipeCol59 &&
        pipeCol59.enabled === true &&
        pipeCol59.traversable === true &&
        Math.abs(pipeCol59.stepHeight - FALLING_PIPES_CONSTANTS.stepHeight) < 1e-5,
      `${spec.label}: fallen pipe aftermath collider is active and tagged traversable with stepHeight`
    )

    // Verify pipe STILL blocks non-traversal collision callers solidly
    const solidBlockCheck = moveWithSubsteps(
      cellWorld59.x - travelX * 1.5,
      cellWorld59.z - travelZ * 1.5,
      travelX * 3.0,
      travelZ * 3.0,
      maze59,
      {
        radius: PLAYER_RADIUS,
        propColliders: eng59._propCollisionIndex,
      }
    )
    assert(
      solidBlockCheck.hitProp === true,
      `${spec.label}: non-traversal collision still treats fallen pipe as a solid blocking obstacle`
    )

    // Helper: run a real stepMovement traversal trial across the pipe and verify kinematics
    const runTraversalTrial = ({
      name,
      startAlong,
      endAlong,
      laneOffset = 0,
      yaw,
      forwardAxis,
      strafeAxis = 0,
      sprint = false,
      maxSteps = 90,
      dt = 1 / 60,
    }) => {
      const sx = cellWorld59.x + travelX * startAlong + transverseX * laneOffset
      const sz = cellWorld59.z + travelZ * startAlong + transverseZ * laneOffset
      eng59.setPlayerWorldPosition(sx, 0, sz, { immediate: true, yaw })

      let peakY = 0
      let prevY = 0
      let maxDeltaY = 0
      let sawCrest = false
      let sawTraversing = false
      let signFlips = 0
      let prevDir = 0
      let stepsTaken = 0
      const targetSign = endAlong > startAlong ? 1 : -1

      for (let i = 0; i < maxSteps; i += 1) {
        const res = eng59.stepMovement(
          { forwardAxis, strafeAxis, sprint },
          dt,
          { updateAnimation: true }
        )
        stepsTaken += 1
        const pos = eng59.getPlayerWorldPosition()
        const tState = eng59.getPlayerTraversalState()
        const dy = pos.y - prevY
        if (Math.abs(dy) > maxDeltaY) maxDeltaY = Math.abs(dy)
        if (pos.y > peakY) peakY = pos.y
        if (tState.onCrest && pos.y >= 0.295) sawCrest = true
        if (res.traversingPipe) sawTraversing = true

        assert(
          pos.y >= -1e-5 && pos.y <= FALLING_PIPES_CONSTANTS.stepHeight + 1e-4,
          `${spec.label} (${name}): y stays within [0, stepHeight] (y=${pos.y.toFixed(4)})`
        )
        assert(
          tState.grounded === true,
          `${spec.label} (${name}): remains smoothly grounded while stepping over pipe`
        )

        // Track vertical direction reversals to guarantee zero bouncing/jitter
        if (Math.abs(dy) > 1e-4) {
          const dir = dy > 0 ? 1 : -1
          if (prevDir !== 0 && dir !== prevDir) {
            signFlips += 1
          }
          prevDir = dir
        }
        prevY = pos.y

        const along = (pos.x - cellWorld59.x) * travelX + (pos.z - cellWorld59.z) * travelZ
        if (targetSign > 0 ? along >= endAlong : along <= endAlong) {
          break
        }
      }

      // Hold still for 10 frames after crossing to confirm zero landing jitter/drift
      for (let k = 0; k < 10; k += 1) {
        eng59.stepMovement({ forwardAxis: 0, strafeAxis: 0, sprint: false }, dt)
      }
      const finalPos = eng59.getPlayerWorldPosition()
      const finalState = eng59.getPlayerTraversalState()
      const finalAlong =
        (finalPos.x - cellWorld59.x) * travelX + (finalPos.z - cellWorld59.z) * travelZ

      assert(
        targetSign > 0 ? finalAlong >= endAlong - 0.05 : finalAlong <= endAlong + 0.05,
        `${spec.label} (${name}): crossed completely to target side (along=${finalAlong.toFixed(2)}, target=${endAlong})`
      )
      assert(
        sawTraversing && sawCrest && peakY >= 0.30,
        `${spec.label} (${name}): physically stepped up over pipe crest (peakY=${peakY.toFixed(3)})`
      )
      assert(
        maxDeltaY <= 0.115,
        `${spec.label} (${name}): controlled step-up/down without teleport jump (maxDeltaY=${maxDeltaY.toFixed(4)})`
      )
      assert(
        signFlips <= 1,
        `${spec.label} (${name}): single clean up-then-down arc with zero bouncing/jitter (signFlips=${signFlips})`
      )
      assert(
        Math.abs(finalPos.y) < 1e-4 &&
          finalState.grounded === true &&
          Math.abs(finalState.verticalVelocity) < 1e-5 &&
          finalState.isTraversingPipe === false,
        `${spec.label} (${name}): landed cleanly on floor after crossing (y=${finalPos.y.toFixed(4)}, grounded=${finalState.grounded})`
      )
      return { stepsTaken, peakY, maxDeltaY }
    }

    // Forward yaw aligns camera forward (-sin(yaw), -cos(yaw)) with +travel
    const yawPlusTravel = Math.atan2(-travelX, -travelZ)
    const yawMinusTravel = Math.atan2(travelX, travelZ)

    // 1. Both directions: forward (+travel) and reverse (-travel)
    const walkAcrossPipe = runTraversalTrial({
      name: 'forward +travel center',
      startAlong: -1.65,
      endAlong: 1.65,
      laneOffset: 0,
      yaw: yawPlusTravel,
      forwardAxis: 1,
    })
    runTraversalTrial({
      name: 'forward -travel center',
      startAlong: 1.65,
      endAlong: -1.65,
      laneOffset: 0,
      yaw: yawMinusTravel,
      forwardAxis: 1,
    })

    // 2. Backward approach (facing opposite travel direction, holding S / forwardAxis: -1)
    runTraversalTrial({
      name: 'backward approach',
      startAlong: -1.65,
      endAlong: 1.65,
      laneOffset: 0,
      yaw: yawMinusTravel,
      forwardAxis: -1,
    })

    // 3. Sprint crossing stays grounded and controlled
    runTraversalTrial({
      name: 'sprint approach',
      startAlong: -1.65,
      endAlong: 1.65,
      laneOffset: 0,
      yaw: yawPlusTravel,
      forwardAxis: 1,
      sprint: true,
    })

    // 4. Across entire pipe width (left & right lanes near corridor walls)
    runTraversalTrial({
      name: 'left lane crossing',
      startAlong: -1.65,
      endAlong: 1.65,
      laneOffset: -1.1,
      yaw: yawPlusTravel,
      forwardAxis: 1,
    })
    runTraversalTrial({
      name: 'right lane crossing',
      startAlong: 1.65,
      endAlong: -1.65,
      laneOffset: 1.1,
      yaw: yawMinusTravel,
      forwardAxis: 1,
    })

    // 5. Angled / diagonal approach (forward + strafe, sliding cleanly against corridor wall without snagging)
    runTraversalTrial({
      name: 'angled forward+strafe approach',
      startAlong: -1.65,
      endAlong: 1.65,
      laneOffset: -0.95,
      yaw: yawPlusTravel,
      forwardAxis: 1,
      strafeAxis: 0.55,
      maxSteps: 130,
    })

    // 6. Anti-exploit: cannot push through corridor side walls even while elevated on pipe crest
    eng59.setPlayerWorldPosition(cellWorld59.x, 0, cellWorld59.z, {
      immediate: true,
      yaw: yawPlusTravel,
    })
    for (let i = 0; i < 12; i += 1) {
      eng59.stepMovement({ forwardAxis: 0, strafeAxis: 1, sprint: true }, 1 / 60)
    }
    const wallPushPos = eng59.getPlayerWorldPosition()
    const lateralFromCenter = Math.abs(
      (wallPushPos.x - cellWorld59.x) * transverseX +
        (wallPushPos.z - cellWorld59.z) * transverseZ
    )
    assert(
      lateralFromCenter <= CELL_SIZE * 0.5 - PLAYER_RADIUS + 0.02,
      `${spec.label}: elevated pipe traversal cannot bypass or clip into adjacent corridor walls (lateral=${lateralFromCenter.toFixed(3)}m)`
    )

    // 7. Stopping mid-crest stays completely steady with zero jitter/bounce
    eng59.setPlayerWorldPosition(cellWorld59.x, 0, cellWorld59.z, {
      immediate: true,
      yaw: yawPlusTravel,
    })
    for (let i = 0; i < 10; i += 1) {
      eng59.stepMovement({ forwardAxis: 0, strafeAxis: 0, sprint: false }, 1 / 60)
    }
    const settledCrestY = eng59.getPlayerWorldPosition().y
    assert(
      Math.abs(settledCrestY - FALLING_PIPES_CONSTANTS.stepHeight) < 1e-3,
      `${spec.label}: standing atop pipe crest settles cleanly at stepHeight (${settledCrestY.toFixed(4)}m)`
    )
    for (let i = 0; i < 15; i += 1) {
      eng59.stepMovement({ forwardAxis: 0, strafeAxis: 0, sprint: false }, 1 / 60)
      assert(
        Math.abs(eng59.getPlayerWorldPosition().y - settledCrestY) < 1e-5,
        `${spec.label}: zero vertical jitter while stationary on pipe crest`
      )
    }

    // 8. Pressing F while standing on top of the pipe clears pipe and smoothly lowers player under gravity
    eng59.stepFrame(1 / 60, { render: false })
    const prompt59 = eng59.getNearbyInteractable()
    assert(
      prompt59 && prompt59.kind === 'hazard' && prompt59.label === 'Move Fallen Pipe',
      `${spec.label}: Move Fallen Pipe (F) prompt remains available while fallen`
    )
    const clearRes59 = eng59.interact()
    assert(
      clearRes59?.handled === true && clearRes59.action === 'clear_pipe' && pipeCol59.enabled === false,
      `${spec.label}: F clears fallen pipe cleanly`
    )
    let sawGravityAirborne = false
    let prevDropY = eng59.getPlayerWorldPosition().y
    for (let i = 0; i < 25; i += 1) {
      eng59.stepFrame(1 / 60, { render: false })
      const curY = eng59.getPlayerWorldPosition().y
      const st = eng59.getPlayerTraversalState()
      assert(curY <= prevDropY + 1e-6 && curY >= -1e-6, `${spec.label}: monotonic gravity drop after F clear`)
      if (!st.grounded && curY > 0.01) sawGravityAirborne = true
      prevDropY = curY
    }
    const postClearState = eng59.getPlayerTraversalState()
    assert(
      sawGravityAirborne &&
        Math.abs(eng59.getPlayerWorldPosition().y) < 1e-5 &&
        postClearState.grounded === true &&
        Math.abs(postClearState.verticalVelocity) < 1e-5 &&
        postClearState.isTraversingPipe === false,
      `${spec.label}: clearing pipe underfoot settles smoothly to y=0 under gravity with zero bounce`
    )

    // 9. After F clears pipe, crossing same stretch is flat (y=0) and faster than stepping over the pipe
    eng59.setPlayerWorldPosition(
      cellWorld59.x - travelX * 1.65,
      0,
      cellWorld59.z - travelZ * 1.65,
      { immediate: true, yaw: yawPlusTravel }
    )
    let flatSteps = 0
    for (let i = 0; i < 90; i += 1) {
      const r = eng59.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 1 / 60)
      flatSteps += 1
      assert(
        Math.abs(eng59.getPlayerWorldPosition().y) < 1e-5 && r.traversingPipe === false,
        `${spec.label}: after F clear, normal flat corridor movement stays at y=0`
      )
      const along =
        (eng59.getPlayerWorldPosition().x - cellWorld59.x) * travelX +
        (eng59.getPlayerWorldPosition().z - cellWorld59.z) * travelZ
      if (along >= 1.65) break
    }
    assert(
      flatSteps < walkAcrossPipe.stepsTaken,
      `${spec.label}: stepping over fallen pipe is slower than walking cleared flat corridor (${walkAcrossPipe.stepsTaken} vs ${flatSteps} steps)`
    )

    // 10. Non-traversable hazard obstacle (WALL_COLLAPSE rubble) cannot be stepped over
    const wallMount59 = resolveWallCollapseMount(maze59.grid, spec.cell.row, spec.cell.col)
    if (wallMount59) {
      const rubble59 = eng59.hazardManager.addHazard({
        id: `nontrav-rubble-${spec.label}`,
        type: HAZARD_TYPES.WALL_COLLAPSE,
        ...spec.cell,
        ...wallMount59,
      })
      rubble59.update(0.05, { playerWorldPos: cellWorld59, playerGridCell: spec.cell })
      rubble59.update(
        HAZARD_CONFIG[HAZARD_TYPES.WALL_COLLAPSE].warningDuration + 0.05,
        { playerWorldPos: safeOutsidePos, playerGridCell: spec.cell }
      )
      rubble59.update(
        HAZARD_CONFIG[HAZARD_TYPES.WALL_COLLAPSE].activeDuration + 0.05,
        { playerWorldPos: safeOutsidePos, playerGridCell: spec.cell }
      )
      eng59.syncHazardColliders({ allowPushOut: false })
      const rubbleCol = getDynamicCollider(
        eng59._propCollisionIndex,
        `nontrav-rubble-${spec.label}:aftermath-rubble`
      )
      assert(
        rubbleCol && rubbleCol.enabled === true && rubbleCol.traversable === false,
        `${spec.label}: non-pipe aftermath colliders (WALL_COLLAPSE) are not traversable`
      )
      const rubbleSample = sampleTraversableObstacleHeight(
        rubbleCol.cx,
        rubbleCol.cz,
        PLAYER_RADIUS,
        eng59._propCollisionIndex
      )
      assert(
        rubbleSample.height === 0 && rubbleSample.onObstacle === false,
        `${spec.label}: sampleTraversableObstacleHeight ignores non-traversable obstacles`
      )
      const rubbleBlock = resolveGridCollision(rubbleCol.cx, rubbleCol.cz, maze59, {
        radius: PLAYER_RADIUS,
        propColliders: eng59._propCollisionIndex,
        allowStepOver: true,
      })
      assert(
        rubbleBlock.hitProp === true,
        `${spec.label}: even with allowStepOver=true, non-traversable obstacles still block solidly`
      )
    }

    // 11. resetCombat, maze replacement, and dispose reset traversal state and unregister colliders
    eng59.resetCombat()
    const resetTrav = eng59.getPlayerTraversalState()
    assert(
      resetTrav.grounded === true &&
        resetTrav.verticalVelocity === 0 &&
        resetTrav.isTraversingPipe === false &&
        Math.abs(resetTrav.playerY) < 1e-5,
      `${spec.label}: resetCombat resets vertical traversal state cleanly`
    )

    const replacementMaze59 = generateMaze({ seed: spec.seed + 500 })
    eng59.setMaze(replacementMaze59)
    assert(
      getDynamicCollider(eng59._propCollisionIndex, `trav-pipe-${spec.label}:aftermath-pipe`) ===
        null && eng59.getPlayerTraversalState().isTraversingPipe === false,
      `${spec.label}: maze replacement clears dynamic traversable colliders and traversal state`
    )

    eng59.dispose()
    assert(
      eng59.getPlayerTraversalState().isTraversingPipe === false &&
        eng59.getPlayerTraversalState().grounded === true,
      `${spec.label}: dispose resets traversal state cleanly`
    )
  }
}
console.log('✓ Fallen Pipe Traversal (8/12) step-over kinematics, bidirectional/angled crossing, grounding, anti-exploit, F-clear & lifecycle verified')

// ============================================================================
// Test 60: Hazard Aftermath Interactions (9/12) — All 10 Hazards, Prompts,
//          Angles/Control Points, Obstacle Non-Bypass, Audio/Subtitles,
//          Duplicate/Invalid Transition Guards, Stale Prompt & Lifecycle Audit
// ============================================================================
console.log(
  'Test 60: Hazard Aftermath Interactions (9/12) — All 10 Hazards, State/Collider/Audio/Subtitle Parity, Angles, Non-Bypass & Stale Prompt Audit'
)
{
  const W60 = CELL_TYPES.WALL
  const P60 = CELL_TYPES.PATH
  const auditMaze = {
    id: 'prompt9-aftermath-audit-maze',
    seed: 90912,
    difficulty: 'easy',
    rows: 5,
    cols: 7,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 5 },
    keycards: [],
    collectibles: { items: [] },
    grid: [
      [W60, W60, W60, W60, W60, W60, W60],
      [W60, P60, P60, P60, P60, P60, W60],
      [W60, P60, W60, W60, W60, P60, W60],
      [W60, P60, P60, P60, P60, P60, W60],
      [W60, W60, W60, W60, W60, W60, W60],
    ],
  }

  const c12 = gridToWorld(1, 2, auditMaze)
  const c32 = gridToWorld(3, 2, auditMaze)

  // 1. Exhaustive all-10-hazards end-to-end aftermath interaction audit
  const allHazardAuditCases = [
    {
      type: HAZARD_TYPES.CEILING_COLLAPSE,
      spec: { row: 1, col: 2, wallSide: 'north' },
      expectedAction: 'clear_rubble',
      expectedLabel: 'Clear Ceiling Rubble',
      expectedShort: 'Clear',
      expectedSubtitle: 'Ceiling rubble cleared',
      persistent: false,
      colliderSuffix: 'aftermath-rubble',
    },
    {
      type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
      spec: { row: 1, col: 2, wallSide: 'north' },
      expectedAction: 'clear_furniture',
      expectedLabel: 'Clear Fallen Furniture',
      expectedShort: 'Clear',
      expectedSubtitle: 'Fallen furniture cleared',
      persistent: false,
      colliderSuffix: 'aftermath-furniture',
      dormantColliderSuffix: 'dormant-furniture',
    },
    {
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      spec: { row: 1, col: 2, wallSide: 'north' },
      expectedAction: 'clear_pipe',
      expectedLabel: 'Move Fallen Pipe',
      expectedShort: 'Move',
      expectedSubtitle: 'Fallen pipe moved aside',
      persistent: false,
      colliderSuffix: 'aftermath-pipe',
    },
    {
      type: HAZARD_TYPES.STEAM_PIPE_BURST,
      spec: { row: 1, col: 2, wallSide: 'north' },
      expectedAction: 'seal_steam_pipe',
      expectedLabel: 'Seal Steam Pipe',
      expectedShort: 'Seal',
      expectedSubtitle: 'Steam pipe sealed',
      persistent: true,
      colliderSuffix: null,
    },
    {
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      spec: { row: 1, col: 2, wallSide: 'north' },
      expectedAction: 'insulate_wiring',
      expectedLabel: 'Insulate Exposed Wiring',
      expectedShort: 'Insulate',
      expectedSubtitle: 'Exposed wiring insulated',
      persistent: true,
      colliderSuffix: null,
    },
    {
      type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
      spec: { row: 1, col: 2 },
      expectedAction: 'secure_floor_opening',
      expectedLabel: 'Secure Floor Opening',
      expectedShort: 'Secure',
      expectedSubtitle: 'Floor opening secured',
      persistent: false,
      colliderSuffix: 'aftermath-pit',
    },
    {
      type: HAZARD_TYPES.WALL_COLLAPSE,
      spec: { row: 1, col: 2, wallSide: 'north' },
      expectedAction: 'clear_rubble',
      expectedLabel: 'Clear Fallen Masonry',
      expectedShort: 'Clear',
      expectedSubtitle: 'Fallen masonry cleared',
      persistent: false,
      colliderSuffix: 'aftermath-rubble',
    },
    {
      type: HAZARD_TYPES.FALLING_WATER_TANK,
      spec: { row: 1, col: 2, flowSide: 'east' },
      expectedAction: 'clear_tank',
      expectedLabel: 'Move Fallen Tank',
      expectedShort: 'Move',
      expectedSubtitle: 'Fallen tank moved aside',
      persistent: false,
      colliderSuffix: 'aftermath-tank',
    },
    {
      type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY,
      spec: { row: 1, col: 2, swingSide: 'east' },
      expectedAction: 'clear_machinery',
      expectedLabel: 'Move Fallen Machinery',
      expectedShort: 'Move',
      expectedSubtitle: 'Fallen machinery moved aside',
      persistent: false,
      colliderSuffix: 'aftermath-machinery',
    },
    {
      type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE,
      spec: { row: 1, col: 2, dropSide: 'east' },
      expectedAction: 'clear_duct',
      expectedLabel: 'Move Fallen Duct',
      expectedShort: 'Move',
      expectedSubtitle: 'Fallen duct moved aside',
      persistent: false,
      colliderSuffix: 'aftermath-duct',
    },
  ]

  for (const tc of allHazardAuditCases) {
    const subtitles = []
    const eng60 = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      damageImmunityDuration: 0.4,
      enemies: { autoSpawn: false },
      audio: {
        subtitles: true,
        recordCueHistory: true,
      },
    })
    eng60.audioEngine?.subscribeSubtitles?.((sub) => subtitles.push(sub))
    eng60.setMaze(auditMaze)
    eng60.cancelSpawnSequence()
    eng60.hazardManager.clear()
    // Remove static props from cell (1,2) so every hazard tests clean corridor geometry
    for (let i = 0; i < eng60._propCollisionIndex.colliders.length; i += 1) {
      const col = eng60._propCollisionIndex.colliders[i]
      if (col && col.row === 1 && col.col === 2) col.enabled = false
    }
    eng60.syncHazardColliders({ allowPushOut: false })

    const hazId = `audit60-${tc.type}`
    const haz = eng60.hazardManager.addHazard({
      id: hazId,
      type: tc.type,
      ...tc.spec,
    })
    eng60.syncHazardColliders({ allowPushOut: false })

    // A. Invalid state transitions rejected while DORMANT (with AND without playerWorldPos)
    assert(
      haz.interact().handled === false &&
        haz.clearAftermath() === false &&
        haz.isAftermathCleared === false &&
        haz.getState() === HAZARD_STATES.DORMANT,
      `${tc.type}: dormant hazard rejects contextless interact() and clearAftermath()`
    )
    if (tc.dormantColliderSuffix) {
      const dCol = getDynamicCollider(
        eng60._propCollisionIndex,
        `${hazId}:${tc.dormantColliderSuffix}`
      )
      assert(
        dCol && dCol.enabled === true,
        `${tc.type}: rejected dormant clearAftermath() preserves upright dormant collider`
      )
    }

    // Trigger into WARNING -> verify WARNING also rejects interaction
    const triggerTarget = haz.dangerWorldPos || c12
    eng60.setPlayerWorldPosition(triggerTarget.x, 0, triggerTarget.z, { immediate: true })
    eng60.stepFrame(0.05, { render: false })
    assert(
      haz.getState() === HAZARD_STATES.WARNING &&
        haz.interact().handled === false &&
        haz.clearAftermath() === false &&
        eng60.getNearbyInteractable() === null &&
        eng60.interact().handled === false,
      `${tc.type}: WARNING state suppresses prompt and rejects interact()/clearAftermath()`
    )

    // Advance to aftermath state (ACTIVE for persistent hazards, DISABLED for one-shot collapses)
    const stepsNeeded = tc.persistent
      ? Math.ceil((haz.config.warningDuration + 0.15) / 0.1)
      : Math.ceil((haz.config.warningDuration + haz.config.activeDuration + 0.25) / 0.1)
    for (let s = 0; s < stepsNeeded; s += 1) {
      eng60.stepFrame(0.1, { render: false })
    }
    const expectedAftermathState = tc.persistent ? HAZARD_STATES.ACTIVE : HAZARD_STATES.DISABLED
    assert(
      haz.getState() === expectedAftermathState,
      `${tc.type}: transitioned to expected aftermath state (${expectedAftermathState}, got ${haz.getState()})`
    )

    // For floor grate, verify standing inside pit rejects securing while standing at edge succeeds
    const anchor = haz.getInteractionAnchor()
    if (tc.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE) {
      assert(
        haz.canPlayerInteract({ x: anchor.x, y: 0, z: anchor.z }, { row: 1, col: 2 }) === false,
        'COLLAPSING_FLOOR_GRATE: standing inside open pit rejects Secure Floor Opening'
      )
      eng60.setPlayerWorldPosition(c12.x, 0, c12.z + 1.15, { immediate: true })
    } else if (tc.type === HAZARD_TYPES.STEAM_PIPE_BURST) {
      // Position safely near the shutoff valve outside the scalding plume
      const safeValvePos = { x: haz.valveWorldPos.x - 0.85, y: 0, z: haz.valveWorldPos.z + 0.35 }
      eng60.setPlayerWorldPosition(safeValvePos.x, 0, safeValvePos.z, { immediate: true })
    } else if (tc.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      // Position safely near the isolation breaker outside the electrical arc radius
      const safeBreakerPos = {
        x: haz.breakerWorldPos.x - 0.55,
        y: 0,
        z: haz.breakerWorldPos.z + 0.65,
      }
      eng60.setPlayerWorldPosition(safeBreakerPos.x, 0, safeBreakerPos.z, { immediate: true })
    } else {
      // Position near the aftermath collider/anchor cleanly within walkable corridor
      const safePos = {
        x: Math.max(c12.x - 1.4, Math.min(c12.x + 1.4, anchor.x)),
        z: Math.max(c12.z - 1.2, Math.min(c12.z + 1.2, anchor.z + 0.85)),
      }
      eng60.setPlayerWorldPosition(safePos.x, 0, safePos.z, { immediate: true })
    }
    eng60.stepFrame(0.016, { render: false })

    // B. Verify wall occlusion rejects interaction across solid row-2 wall
    assert(
      haz.canPlayerInteract({ x: c32.x, y: 0, z: c32.z }, { row: 3, col: 2 }) === false,
      `${tc.type}: solid wall blocks interaction via LOS`
    )

    // C. Verify active aftermath prompt matches exact expected contract
    const prompt = eng60.getNearbyInteractable()
    assert(
      prompt &&
        prompt.kind === 'hazard' &&
        prompt.id === hazId &&
        prompt.type === tc.type &&
        prompt.label === tc.expectedLabel &&
        prompt.shortLabel === tc.expectedShort,
      `${tc.type}: exposes exact aftermath prompt ("${tc.expectedLabel}" / "${tc.expectedShort}", got ${JSON.stringify(prompt)})`
    )

    // D. Execute F interaction -> verify state, collider, visual, audio cue, subtitle & prompt removal
    subtitles.length = 0
    const cuesBefore = eng60.audioEngine?.getCueHistory?.().length || 0
    const interactRes = eng60.interact()
    const cuesAfter = eng60.audioEngine?.getCueHistory?.() || []
    const newCues = cuesAfter.slice(cuesBefore)

    assert(
      interactRes &&
        interactRes.handled === true &&
        interactRes.action === tc.expectedAction &&
        interactRes.interactableKind === 'hazard' &&
        interactRes.clearAftermath === true &&
        haz.isAftermathCleared === true &&
        haz.getState() === HAZARD_STATES.DISABLED &&
        haz.getMesh()?.userData?.isAftermathCleared === true,
      `${tc.type}: F interaction updates hazard state, aftermath flag, and visual mesh userData consistently`
    )
    assert(
      newCues.some((c) => c.type === `hazard_interact_${tc.expectedAction}`),
      `${tc.type}: records audio cue hazard_interact_${tc.expectedAction}`
    )
    assert(
      subtitles.some((s) => s.text === tc.expectedSubtitle),
      `${tc.type}: emits accessibility subtitle "${tc.expectedSubtitle}" (got ${JSON.stringify(subtitles.map((s) => s.text))})`
    )
    assert(
      eng60.getNearbyInteractable() === null && eng60.getStealthState().canInteract === false,
      `${tc.type}: interaction prompt clears immediately upon aftermath resolution`
    )

    // Electrical wiring breaker handle visually flips to OFF when insulated
    if (tc.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      assert(
        Math.abs(haz.getMesh().userData.breakerHandleGroup.rotation.x - 0.52) < 1e-4,
        'EXPOSED_ELECTRICAL_WIRING: breaker handle flips visually to OFF (0.52 rad) when insulated'
      )
    }

    // Verify collider disabled & passage restored (or persistent damage stopped)
    if (tc.colliderSuffix) {
      const aftCol = getDynamicCollider(
        eng60._propCollisionIndex,
        `${hazId}:${tc.colliderSuffix}`
      )
      assert(
        aftCol && aftCol.enabled === false,
        `${tc.type}: aftermath collider ${tc.colliderSuffix} disabled immediately upon interaction`
      )
      const passCheck = resolveGridCollision(aftCol.cx, aftCol.cz, auditMaze, {
        radius: PLAYER_RADIUS,
        propColliders: eng60._propCollisionIndex,
      })
      assert(
        passCheck.hitProp === false,
        `${tc.type}: player passage unobstructed after clearing collider`
      )
    } else {
      eng60.damageImmunityTimer = 0
      const hpBefore = eng60.health
      const dmgPos = haz.dangerWorldPos || c12
      eng60.setPlayerWorldPosition(dmgPos.x, 0, dmgPos.z, { immediate: true })
      eng60.stepFrame(0.5, { render: false })
      assert(
        eng60.health === hpBefore &&
          haz.update(0.5, { playerWorldPos: dmgPos, playerGridCell: { row: 1, col: 2 } }) === null,
        `${tc.type}: neutralized persistent hazard deals zero further damage`
      )
    }

    // E. Duplicate interactions strictly rejected (engine, manager, and contextless agent)
    const cuesPreDup = eng60.audioEngine?.getCueHistory?.().length || 0
    assert(
      eng60.interact().handled === false &&
        haz.interact().handled === false &&
        eng60.hazardManager.interactWithHazard(hazId).handled === false &&
        (eng60.audioEngine?.getCueHistory?.().length || 0) === cuesPreDup,
      `${tc.type}: duplicate F/manager/agent interactions are strictly rejected with no extra audio`
    )

    // F. resetCombat restores clean dormant state, visuals, and colliders
    eng60.resetCombat()
    assert(
      haz.getState() === HAZARD_STATES.DORMANT &&
        haz.isAftermathCleared === false &&
        haz.isDisabled === false &&
        haz.getMesh()?.userData?.isAftermathCleared === false,
      `${tc.type}: resetCombat restores dormant state and clears aftermath flag`
    )
    if (tc.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      assert(
        Math.abs(haz.getMesh().userData.breakerHandleGroup.rotation.x - -0.58) < 1e-4,
        'EXPOSED_ELECTRICAL_WIRING: resetCombat restores breaker handle to dormant ON (-0.58 rad)'
      )
    }

    eng60.dispose()
  }

  // 2. Angle & lane reachability for transverse FALLING_PIPES_FIXTURES + control-point reachability
  {
    const engAngles = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
    })
    engAngles.setMaze(auditMaze)
    engAngles.cancelSpawnSequence()
    engAngles.hazardManager.clear()
    for (let i = 0; i < engAngles._propCollisionIndex.colliders.length; i += 1) {
      const col = engAngles._propCollisionIndex.colliders[i]
      if (col && col.row === 1 && (col.col === 2 || col.col === 3)) col.enabled = false
    }
    engAngles.syncHazardColliders({ allowPushOut: false })

    // Transverse fallen pipe in E-W corridor at (1,2) -> pipe runs N-S across Z in [-1.92, +1.92]
    const pipeHaz = engAngles.hazardManager.addHazard({
      id: 'audit60-angle-pipe',
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 1,
      col: 2,
      wallSide: 'north',
    })
    pipeHaz.state = HAZARD_STATES.DISABLED
    pipeHaz.isPermanentlyCollapsed = true
    pipeHaz.isDisabled = true
    pipeHaz._syncColliderStates(1)
    engAngles.syncHazardColliders({ allowPushOut: false })

    // Left lane (north side of corridor z = c12.z - 1.50), center (z = c12.z), right lane (z = c12.z + 1.50)
    // from BOTH west (x = c12.x - 1.75) and east (x = c12.x + 1.75) sides!
    // Note: hypot(1.75, 1.50) = 2.305m > 2.25m from center, so only transverse segment resolution succeeds!
    for (const sideX of [-1.75, 1.75]) {
      for (const laneZ of [-1.5, 0, 1.5]) {
        const testPos = { x: c12.x + sideX, y: 0, z: c12.z + laneZ }
        assert(
          pipeHaz.canPlayerInteract(testPos, { row: 1, col: 2 }, {
            propColliders: engAngles._propCollisionIndex,
          }) === true,
          `FALLING_PIPES_FIXTURES interactable from sideX=${sideX}, laneZ=${laneZ} across full pipe width`
        )
      }
    }
    // Out of range along corridor still strictly rejected
    assert(
      pipeHaz.canPlayerInteract({ x: c12.x + 2.6, y: 0, z: c12.z }, { row: 1, col: 3 }) === false,
      'FALLING_PIPES_FIXTURES still rejects out-of-range distance along corridor'
    )

    // Unrelated solid obstacle placed squarely between player and fallen pipe blocks interaction
    registerDynamicCollider(engAngles._propCollisionIndex, {
      id: 'audit60-blocker-crate',
      ownerId: 'audit60-unrelated-crate',
      kind: 'obb',
      cx: c12.x + 0.9,
      cz: c12.z,
      halfW: 0.35,
      halfD: 0.85,
      yaw: 0,
      enabled: true,
    })
    engAngles.setPlayerWorldPosition(c12.x + 1.7, 0, c12.z, { immediate: true })
    engAngles.stepFrame(0.016, { render: false })
    assert(
      engAngles.getNearbyInteractable() === null && engAngles.interact().handled === false,
      'Unrelated solid obstacle between player and hazard blocks prompt and F interaction'
    )
    // Removing obstacle immediately restores prompt and allows Move Fallen Pipe
    unregisterDynamicCollider(engAngles._propCollisionIndex, 'audit60-blocker-crate')
    engAngles.stepFrame(0.016, { render: false })
    assert(
      engAngles.getNearbyInteractable()?.id === 'audit60-angle-pipe' &&
        engAngles.interact().handled === true,
      'Removing unrelated obstacle restores Move Fallen Pipe interaction'
    )

    // Safe valve & breaker control-point reachability outside persistent damage zones
    engAngles.hazardManager.clear()
    engAngles.syncHazardColliders({ allowPushOut: false })
    const steamHaz = engAngles.hazardManager.addHazard({
      id: 'audit60-valve-steam',
      type: HAZARD_TYPES.STEAM_PIPE_BURST,
      row: 1,
      col: 3,
      wallSide: 'north',
    })
    steamHaz.state = HAZARD_STATES.ACTIVE
    const valveApproach = {
      x: steamHaz.valveWorldPos.x - 1.65,
      y: 0,
      z: steamHaz.valveWorldPos.z + 0.55,
    }
    assert(
      steamHaz._isPointInSteamPlumeArea(valveApproach.x, valveApproach.z) === false &&
        Math.hypot(
          valveApproach.x - steamHaz.originWorldPos.x,
          valveApproach.z - steamHaz.originWorldPos.z
        ) > 2.35 &&
        steamHaz.canPlayerInteract(valveApproach, { row: 1, col: 2 }) === true,
      'STEAM_PIPE_BURST allows sealing from safe approach beside shutoff valve outside steam plume'
    )

    const wireHaz = engAngles.hazardManager.addHazard({
      id: 'audit60-breaker-wire',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 1,
      col: 2,
      wallSide: 'north',
    })
    wireHaz.state = HAZARD_STATES.ACTIVE
    const breakerApproach = {
      x: wireHaz.breakerWorldPos.x - 1.35,
      y: 0,
      z: wireHaz.breakerWorldPos.z + 0.65,
    }
    assert(
      Math.hypot(
        breakerApproach.x - wireHaz.dangerWorldPos.x,
        breakerApproach.z - wireHaz.dangerWorldPos.z
      ) > wireHaz.dangerRadius &&
        Math.hypot(
          breakerApproach.x - wireHaz.originWorldPos.x,
          breakerApproach.z - wireHaz.originWorldPos.z
        ) > 2.35 &&
        wireHaz.canPlayerInteract(breakerApproach, { row: 1, col: 2 }) === true,
      'EXPOSED_ELECTRICAL_WIRING allows insulating from safe approach beside isolation breaker outside arc radius'
    )

    engAngles.dispose()
  }

  // 3. Stale prompt elimination & post-cleanup/destruction lockout audit
  {
    const engStale = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
    })
    engStale.setMaze(auditMaze)
    engStale.cancelSpawnSequence()
    engStale.hazardManager.clear()
    for (let i = 0; i < engStale._propCollisionIndex.colliders.length; i += 1) {
      const col = engStale._propCollisionIndex.colliders[i]
      if (col && col.row === 1 && (col.col === 2 || col.col === 3)) col.enabled = false
    }
    engStale.syncHazardColliders({ allowPushOut: false })

    const addCollapsedWall = (id, colIdx = 2) => {
      const h = engStale.hazardManager.addHazard({
        id,
        type: HAZARD_TYPES.WALL_COLLAPSE,
        row: 1,
        col: colIdx,
        wallSide: 'north',
      })
      h.state = HAZARD_STATES.DISABLED
      h.isPermanentlyCollapsed = true
      h.isDisabled = true
      h._syncColliderStates(1)
      engStale.syncHazardColliders({ allowPushOut: false })
      return h
    }

    // 3a. removeHazard() immediately invalidates getNearbyInteractable() even before next stepFrame()
    const hRemove = addCollapsedWall('stale-remove-haz', 2)
    engStale.setPlayerWorldPosition(c12.x, 0, c12.z - 0.25, { immediate: true })
    engStale.stepFrame(0.016, { render: false })
    assert(engStale.getNearbyInteractable()?.id === 'stale-remove-haz', 'Prompt active before removal')
    engStale.hazardManager.removeHazard('stale-remove-haz')
    assert(
      engStale.getNearbyInteractable() === null &&
        engStale.interact().handled === false &&
        hRemove.interact().handled === false,
      'removeHazard() immediately eliminates stale prompt and blocks post-removal interaction'
    )

    // 3b. External clearAftermath() immediately invalidates getNearbyInteractable() before next stepFrame()
    const hExtClear = addCollapsedWall('stale-extclear-haz', 2)
    engStale.stepFrame(0.016, { render: false })
    assert(engStale.getNearbyInteractable()?.id === 'stale-extclear-haz', 'Prompt active before external clear')
    hExtClear.clearAftermath()
    assert(
      engStale.getNearbyInteractable() === null && engStale.interact().handled === false,
      'External clearAftermath() immediately eliminates stale prompt'
    )

    // 3c. setHasWon(true) immediately clears prompt & blocks interaction
    engStale.hazardManager.clear()
    addCollapsedWall('stale-win-haz', 2)
    engStale.stepFrame(0.016, { render: false })
    assert(engStale.getNearbyInteractable()?.id === 'stale-win-haz', 'Prompt active before victory')
    engStale.setHasWon(true)
    assert(
      engStale.getNearbyInteractable() === null &&
        engStale.getStealthState().canInteract === false &&
        engStale.interact().handled === false,
      'setHasWon(true) immediately clears prompt and blocks interact()'
    )
    engStale.setHasWon(false)
    assert(
      engStale.getNearbyInteractable()?.id === 'stale-win-haz',
      'setHasWon(false) restores valid prompt'
    )

    // 3d. clearHazards() and clearMaze() immediately clear prompts
    engStale.clearHazards()
    assert(
      engStale.getNearbyInteractable() === null && engStale.getStealthState().canInteract === false,
      'clearHazards() immediately clears prompt'
    )
    addCollapsedWall('stale-clearmaze-haz', 2)
    engStale.stepFrame(0.016, { render: false })
    assert(engStale.getNearbyInteractable()?.id === 'stale-clearmaze-haz', 'Prompt active before clearMaze')
    engStale.clearMaze()
    assert(
      engStale.getNearbyInteractable() === null &&
        engStale.getStealthState().canInteract === false &&
        engStale.interact().handled === false,
      'clearMaze() immediately clears prompt and blocks interact()'
    )

    // 3e. setMaze() replacement + dispose() clear prompts and block post-dispose calls
    const replacementMaze60 = generateMaze({ seed: 90999 })
    engStale.setMaze(replacementMaze60)
    engStale.cancelSpawnSequence()
    engStale.dispose()
    assert(
      engStale.getNearbyInteractable() === null &&
        engStale.getStealthState().canInteract === false &&
        engStale.interact().handled === false,
      'dispose() clears prompt and blocks all post-disposal interaction calls'
    )
  }
}
console.log(
  '✓ Hazard Aftermath Interactions (9/12) across all 10 hazards, angles, obstacle non-bypass, audio/subtitles, duplicate guards & stale prompt lifecycle verified'
)

// ============================================================================
// Test 61: Comprehensive Environmental Hazard Integration & Safety Audit (10/12)
//          — All 10 Hazard Wall-Occlusion LOS (Trigger & Impact), Enemy Sound
//          Propagation on Activation & Aftermath, Concurrent Fallen-Pipe
//          Traversal + Hazard Collapse Push-Out Safety, Wall Pass Landing vs
//          Hazard Colliders, and clearHazards() Elevated State Recovery
// ============================================================================
console.log(
  'Test 61: Comprehensive Environmental Hazard Integration & Safety Audit (10/12) — Wall LOS, Enemy Sound Propagation, Concurrent Traversal & Wall Pass'
)
{
  const W61 = CELL_TYPES.WALL
  const P61 = CELL_TYPES.PATH
  // Row 1 and Row 3 are parallel corridors separated by a solid interior wall at Row 2 (cols 2..4),
  // with an interior wall at (2, 2) separating (1, 2) from (2, 1) around a corner.
  const auditMaze61 = {
    id: 'prompt10-integration-audit-maze',
    seed: 101012,
    difficulty: 'normal',
    rows: 5,
    cols: 7,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 5 },
    keycards: [],
    collectibles: { items: [] },
    grid: [
      [W61, W61, W61, W61, W61, W61, W61],
      [W61, P61, P61, P61, P61, P61, W61],
      [W61, P61, W61, W61, W61, P61, W61],
      [W61, P61, P61, P61, P61, P61, W61],
      [W61, W61, W61, W61, W61, W61, W61],
    ],
  }

  const c11 = gridToWorld(1, 1, auditMaze61)
  const c12 = gridToWorld(1, 2, auditMaze61)
  const c13 = gridToWorld(1, 3, auditMaze61)
  const c14 = gridToWorld(1, 4, auditMaze61)
  const c21 = gridToWorld(2, 1, auditMaze61)
  const c32 = gridToWorld(3, 2, auditMaze61)

  // --------------------------------------------------------------------------
  // 1. All 10 Hazards: Wall Line-of-Sight Blocks Trigger (DORMANT -> WARNING)
  //    AND Blocks Impact Damage (ACTIVE) Across Corner/Adjacent Walls
  // --------------------------------------------------------------------------
  const all10Specs = [
    { type: HAZARD_TYPES.CEILING_COLLAPSE, spec: { row: 1, col: 2, wallSide: 'south' } },
    { type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE, spec: { row: 1, col: 2, wallSide: 'south' } },
    { type: HAZARD_TYPES.FALLING_PIPES_FIXTURES, spec: { row: 1, col: 2, wallSide: 'north' } },
    { type: HAZARD_TYPES.STEAM_PIPE_BURST, spec: { row: 1, col: 2, wallSide: 'south' } },
    { type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING, spec: { row: 1, col: 2, wallSide: 'south' } },
    { type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, spec: { row: 1, col: 2 } },
    { type: HAZARD_TYPES.WALL_COLLAPSE, spec: { row: 1, col: 2, wallSide: 'south' } },
    { type: HAZARD_TYPES.FALLING_WATER_TANK, spec: { row: 1, col: 2, flowSide: 'west' } },
    { type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY, spec: { row: 1, col: 2, swingSide: 'west' } },
    { type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE, spec: { row: 1, col: 2, dropSide: 'west' } },
  ]

  for (const item of all10Specs) {
    const agent = new HazardAgent(
      {
        id: `los61-${item.type}`,
        type: item.type,
        ...item.spec,
      },
      auditMaze61
    )
    assert(
      Number.isFinite(agent.config.activationSoundRange) && agent.config.activationSoundRange >= 9,
      `${item.type}: defines explicit activationSoundRange (${agent.config.activationSoundRange})`
    )

    // Place player in walkable cell (2, 1) tucked near the corner wall (2, 2) so Euclidean distance
    // to cell (1, 2)'s south-west corner is < triggerRadius, but LOS is blocked by wall (2, 2)!
    const cornerBlockedPos = { x: c21.x + 1.55, y: 0, z: c21.z - 0.35 }
    const parallelBlockedPos = { x: c32.x, y: 0, z: c32.z - 1.65 }

    agent.update(0.1, { playerWorldPos: cornerBlockedPos, playerGridCell: { row: 2, col: 1 } })
    agent.update(0.1, { playerWorldPos: parallelBlockedPos, playerGridCell: { row: 3, col: 2 } })
    assert(
      agent.getState() === HAZARD_STATES.DORMANT,
      `${item.type}: wall-occluded player within Euclidean radius does NOT trigger DORMANT -> WARNING`
    )

    // Force ACTIVE at peak impact window and verify wall-occluded player takes zero damage
    agent.state = HAZARD_STATES.ACTIVE
    agent.timer = agent.config.activeDuration * 0.3
    agent.hasDealtDamage = false
    const hitCorner = agent.update(0.05, {
      playerWorldPos: cornerBlockedPos,
      playerGridCell: { row: 2, col: 1 },
    })
    const hitParallel = agent.update(0.05, {
      playerWorldPos: parallelBlockedPos,
      playerGridCell: { row: 3, col: 2 },
    })
    assert(
      hitCorner === null && hitParallel === null && agent.hasDealtDamage === false,
      `${item.type}: wall-occluded player takes zero impact damage during ACTIVE phase`
    )
    agent.dispose()
  }

  // --------------------------------------------------------------------------
  // 2. Enemy Perception & Sound Propagation From Hazard Activation (WARNING -> ACTIVE)
  //    (Both Normal & Hidden Player) and Aftermath Interaction (F)
  // --------------------------------------------------------------------------
  {
    const engSound = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
    })
    engSound.setMaze(auditMaze61)
    engSound.cancelSpawnSequence()
    engSound.hazardManager.clear()
    engSound.enemyManager.clear()
    for (let i = 0; i < engSound._propCollisionIndex.colliders.length; i += 1) {
      const col = engSound._propCollisionIndex.colliders[i]
      if (col && col.row === 1) col.enabled = false
    }
    engSound.syncHazardColliders({ allowPushOut: false })

    // Spawn a patrolling enemy at (1, 3) facing EAST (away from cell (1, 2) so vision is false)
    const enemy = engSound.enemyManager.spawnEnemy({
      id: 'audit61-patrol-enemy',
      type: 'stalker',
      spawnCell: { row: 1, col: 3 },
      yaw: -Math.PI * 0.5,
      patrolRoute: [
        { row: 1, col: 3 },
        { row: 1, col: 4 },
      ],
    })
    assert(enemy.getState() === 'patrol', 'Enemy starts in PATROL state facing away')

    // Spawn a ceiling collapse hazard at (1, 2) (distance to (1, 3) = ~4.0m <= 12.5m activationSoundRange)
    const ceilHaz = engSound.hazardManager.addHazard({
      id: 'audit61-sound-ceil',
      type: HAZARD_TYPES.CEILING_COLLAPSE,
      row: 1,
      col: 2,
      wallSide: 'north',
    })
    engSound.syncHazardColliders({ allowPushOut: false })

    // Trigger hazard into WARNING while player is at (1, 2)
    const trigPos = ceilHaz.dangerWorldPos || c12
    engSound.setPlayerWorldPosition(trigPos.x, 0, trigPos.z, { immediate: true })
    engSound.stepFrame(0.05, { render: false })
    assert(ceilHaz.getState() === HAZARD_STATES.WARNING, 'Hazard enters WARNING')

    // Move player back to (1, 1) and stand still so player footsteps emit no sound
    engSound.setPlayerWorldPosition(c11.x, 0, c11.z, { immediate: true })
    // Reset enemy to clean PATROL at (1, 3) facing east before hazard activates
    enemy.state = 'patrol'
    enemy.investigateTarget = null
    enemy.worldPos.x = c13.x
    enemy.worldPos.z = c13.z
    enemy.yaw = -Math.PI * 0.5

    // Advance past warningDuration so hazard transitions WARNING -> ACTIVE
    const warnSteps = Math.ceil((ceilHaz.config.warningDuration + 0.1) / 0.1)
    let sawActivationSound = false
    for (let s = 0; s < warnSteps; s += 1) {
      engSound.stepFrame(0.1, { render: false })
      if (
        engSound._soundEvent &&
        Math.abs(engSound._soundEvent.range - ceilHaz.config.activationSoundRange) < 1e-4
      ) {
        sawActivationSound = true
      }
    }
    // Step one more frame so enemy processes the newly emitted _soundEvent
    engSound.stepFrame(0.05, { render: false })
    assert(
      sawActivationSound &&
        ceilHaz.getState() === HAZARD_STATES.ACTIVE &&
        enemy.getState() === 'investigate' &&
        enemy.investigateTarget?.row === 1 &&
        enemy.investigateTarget?.col === 2,
      `Hazard activation (WARNING -> ACTIVE) propagates sound event and alerts patrolling enemy to investigate hazard cell (1,2) (state=${enemy.getState()}, target=${JSON.stringify(enemy.investigateTarget)})`
    )

    // Advance hazard to DISABLED aftermath, reset enemy back to PATROL at (1, 4) facing away,
    // and verify aftermath interaction (F) ALSO propagates sound to alert the enemy
    for (let s = 0; s < 15; s += 1) {
      engSound.stepFrame(0.1, { render: false })
    }
    assert(ceilHaz.getState() === HAZARD_STATES.DISABLED, 'Ceiling collapse reaches DISABLED aftermath')
    engSound._soundEvent = null
    engSound._soundTimer = 0
    enemy.state = 'patrol'
    enemy.investigateTarget = null
    enemy.currentPathWaypoints = []
    enemy.currentPathIndex = 0
    enemy.worldPos.x = c14.x
    enemy.worldPos.z = c14.z
    enemy.yaw = -Math.PI * 0.5
    assert(enemy.getState() === 'patrol', 'Enemy reset to PATROL facing away')

    const anchor = ceilHaz.getInteractionAnchor()
    engSound.setPlayerWorldPosition(anchor.x - 1.15, 0, anchor.z, { immediate: true })
    engSound.stepFrame(0.016, { render: false })
    enemy.state = 'patrol'
    enemy.awareness = 0
    enemy.investigateTarget = null
    enemy.worldPos.x = c13.x - 1.2
    enemy.worldPos.z = c13.z
    enemy.yaw = -Math.PI * 0.5
    const clearRes = engSound.interact()
    assert(
      clearRes.handled === true &&
        clearRes.emitSoundRange > 0 &&
        engSound._soundEvent &&
        Math.abs(engSound._soundEvent.range - clearRes.emitSoundRange) < 1e-4,
      'Aftermath F interaction emits expected sound event range'
    )
    engSound.stepFrame(0.05, { render: false })
    assert(
      enemy.getState() === 'investigate' &&
        enemy.investigateTarget?.row === 1 &&
        enemy.investigateTarget?.col === 2,
      `Aftermath F interaction sound alerts nearby patrolling enemy to investigate interaction cell (state=${enemy.getState()}, target=${JSON.stringify(enemy.investigateTarget)})`
    )

    engSound.dispose()
  }

  // --------------------------------------------------------------------------
  // 3. Concurrent Fallen Pipe Traversal + Unrelated Hazard Collapse Push-Out Safety
  //    & clearHazards() Vertical State Recovery
  // --------------------------------------------------------------------------
  {
    const engTrav = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
    })
    engTrav.setMaze(auditMaze61)
    engTrav.cancelSpawnSequence()
    engTrav.hazardManager.clear()
    for (let i = 0; i < engTrav._propCollisionIndex.colliders.length; i += 1) {
      const col = engTrav._propCollisionIndex.colliders[i]
      if (col && col.row === 1) col.enabled = false
    }
    engTrav.syncHazardColliders({ allowPushOut: false })

    // Fallen transverse pipe at (1, 2)
    const pipeA = engTrav.hazardManager.addHazard({
      id: 'audit61-pipe-a',
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 1,
      col: 2,
      wallSide: 'north',
    })
    pipeA.state = HAZARD_STATES.DISABLED
    pipeA.isPermanentlyCollapsed = true
    pipeA.isDisabled = true
    pipeA._syncColliderStates(1)
    engTrav.syncHazardColliders({ allowPushOut: false })

    // Walk player onto the crest of Fallen Pipe A at (1, 2)
    engTrav.setPlayerWorldPosition(c12.x - 1.1, 0, c12.z, { immediate: true, yaw: -Math.PI * 0.5 })
    for (let i = 0; i < 35; i += 1) {
      engTrav.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 1 / 60)
      if (Math.abs(engTrav.getPlayerWorldPosition().x - c12.x) < 0.08) break
    }
    const onPipeState = engTrav.getPlayerTraversalState()
    assert(
      onPipeState.isTraversingPipe === true &&
        onPipeState.grounded === true &&
        Math.abs(engTrav.getPlayerWorldPosition().y - FALLING_PIPES_CONSTANTS.stepHeight) < 0.03,
      `Player is grounded on crest of Fallen Pipe A (y=${engTrav.getPlayerWorldPosition().y.toFixed(3)})`
    )
    const preCollapseX = engTrav.getPlayerWorldPosition().x
    const preCollapseY = engTrav.getPlayerWorldPosition().y
    const preCollapseZ = engTrav.getPlayerWorldPosition().z

    // Now add a second hazard (WALL_COLLAPSE) at (1, 4) in ACTIVE state right before its aftermath collider enables
    const wallB = engTrav.hazardManager.addHazard({
      id: 'audit61-wall-b',
      type: HAZARD_TYPES.WALL_COLLAPSE,
      row: 1,
      col: 4,
      wallSide: 'north',
    })
    wallB.state = HAZARD_STATES.ACTIVE
    wallB.timer = wallB.config.activeDuration * 0.5
    engTrav.stepFrame(1 / 60, { render: false })

    // Verify wallB's aftermath collider newly enabled, and player on Pipe A was NOT ejected or snapped to y=0!
    const wallBCol = getDynamicCollider(
      engTrav._propCollisionIndex,
      'audit61-wall-b:aftermath-rubble'
    )
    const postCollapsePos = engTrav.getPlayerWorldPosition()
    const postCollapseTrav = engTrav.getPlayerTraversalState()
    assert(
      wallBCol &&
        wallBCol.enabled === true &&
        postCollapseTrav.isTraversingPipe === true &&
        Math.abs(postCollapsePos.x - preCollapseX) < 1e-4 &&
        Math.abs(postCollapsePos.y - preCollapseY) < 0.02 &&
        Math.abs(postCollapsePos.z - preCollapseZ) < 1e-4,
      'Enabling an unrelated hazard aftermath collider does NOT eject player off active traversable fallen pipe'
    )

    // Verify clearHazards() while standing on Pipe A immediately restores player to floor y=0 and clears prompt
    engTrav.clearHazards()
    const afterClearHazTrav = engTrav.getPlayerTraversalState()
    assert(
      afterClearHazTrav.isTraversingPipe === false &&
        afterClearHazTrav.grounded === true &&
        Math.abs(engTrav.getPlayerWorldPosition().y) < 1e-5 &&
        engTrav.getNearbyInteractable() === null &&
        engTrav.getStealthState().canInteract === false,
      'clearHazards() while elevated on fallen pipe immediately resets player to floor y=0 and clears prompt'
    )

    engTrav.dispose()
  }

  // --------------------------------------------------------------------------
  // 4. Wall Pass Landing Integration With Active Hazard Aftermath & Fallen Pipe
  // --------------------------------------------------------------------------
  {
    const engWP = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
    })
    engWP.setMaze(auditMaze61)
    engWP.cancelSpawnSequence()
    engWP.hazardManager.clear()
    for (let i = 0; i < engWP._propCollisionIndex.colliders.length; i += 1) {
      const col = engWP._propCollisionIndex.colliders[i]
      if (col && (col.row === 1 || col.row === 3)) col.enabled = false
    }
    engWP.syncHazardColliders({ allowPushOut: false })

    // Place a collapsed non-traversable hazard collider overlapping the center of landing cell (1, 2)
    // while leaving a valid >=1.60m south corridor lane (z = -0.5, halfD = 0.88 -> spans [-1.38, +0.38])
    const centerRubble = engWP.hazardManager.addHazard({
      id: 'audit61-wp-rubble',
      type: HAZARD_TYPES.CEILING_COLLAPSE,
      row: 1,
      col: 2,
      wallSide: 'north',
      localPatchOffset: { x: 0, y: 3.6, z: -0.5 },
    })
    centerRubble.state = HAZARD_STATES.DISABLED
    centerRubble.isPermanentlyCollapsed = true
    centerRubble.isDisabled = true
    centerRubble._syncColliderStates(1)
    engWP.syncHazardColliders({ allowPushOut: false })
    const centerCol = getDynamicCollider(
      engWP._propCollisionIndex,
      'audit61-wp-rubble:aftermath-rubble'
    )
    assert(centerCol && centerCol.enabled === true, 'Center rubble collider active in (1, 2)')

    // Enable Wall Pass and phase north through interior wall (2, 2) from (3, 2) into (1, 2)
    engWP.setPlayerWorldPosition(c32.x, 0, c32.z - 1.25, { immediate: true, yaw: 0 })
    for (let i = 0; i < 15; i += 1) {
      engWP.stepMovement(
        { forwardAxis: 1, strafeAxis: 0, sprint: false },
        1 / 60,
        { wallPassArmed: true }
      )
      const g = engWP.getPlayerGridCell()
      if (g && g.row === 1 && g.col === 2) break
    }
    const wpPosA = engWP.getPlayerWorldPosition()
    const wpCellA = engWP.getPlayerGridCell()
    const wpResolveCheck = resolveGridCollision(wpPosA.x, wpPosA.z, auditMaze61, {
      radius: PLAYER_RADIUS,
      propColliders: engWP._propCollisionIndex,
    })
    assert(
      wpCellA?.row === 1 &&
        wpCellA?.col === 2 &&
        wpResolveCheck.hitProp === false &&
        Math.hypot(wpResolveCheck.x - wpPosA.x, wpResolveCheck.z - wpPosA.z) < 1e-4,
      'Wall Pass landing safely pushes player clear of non-traversable hazard collider in landing cell'
    )

    // Replace non-traversable rubble with a traversable fallen pipe at (1, 2) center and Wall Pass into (1, 2)
    engWP.hazardManager.clear()
    const centerPipe = engWP.hazardManager.addHazard({
      id: 'audit61-wp-pipe',
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 1,
      col: 2,
      wallSide: 'north',
    })
    centerPipe.state = HAZARD_STATES.DISABLED
    centerPipe.isPermanentlyCollapsed = true
    centerPipe.isDisabled = true
    centerPipe._syncColliderStates(1)
    engWP.syncHazardColliders({ allowPushOut: false })

    engWP.setPlayerWorldPosition(c32.x, 0, c32.z - 1.25, { immediate: true, yaw: 0 })
    for (let i = 0; i < 15; i += 1) {
      engWP.stepMovement(
        { forwardAxis: 1, strafeAxis: 0, sprint: false },
        1 / 60,
        { wallPassArmed: true }
      )
      const g = engWP.getPlayerGridCell()
      if (g && g.row === 1 && g.col === 2) break
    }
    assert(
      engWP.getPlayerTraversalState().isTraversingPipe === true &&
        Math.abs(engWP.getPlayerWorldPosition().y - FALLING_PIPES_CONSTANTS.stepHeight) < 0.03,
      'Wall Pass landing onto a traversable fallen pipe immediately grounds player atop the pipe'
    )

    engWP.dispose()
  }
}
console.log(
  '✓ Comprehensive Environmental Hazard Integration & Safety Audit (10/12) verified across all 10 hazards and 9 integration systems'
)

// ============================================================================
// Test 62: Prompt 11/12 Regression Alignment & Expansion — All-10 Activation &
// Aftermath Sound Propagation Boundary Matrix, All-10 Warning/Trigger Audio &
// Subtitles, Water-Tank Slowdown Kinematics, and Game-Over / Sequence Protection
// ============================================================================
console.log(
  'Test 62: Prompt 11/12 Regression Alignment & Expansion — All-10 Sound Boundaries, Audio/Subtitles, Slowdown & Lockouts'
)
{
  // Open 11-column corridor so we can place enemies both inside and outside activationSoundRange (9.5m - 13.0m)
  const testMaze62 = {
    rows: 5,
    cols: 11,
    start: { row: 1, col: 1 },
    exit: { row: 3, col: 9 },
    seed: 626262,
    difficulty: 'medium',
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  }
  const c11_62 = gridToWorld(1, 1, testMaze62)
  const c12_62 = gridToWorld(1, 2, testMaze62)
  const c13_62 = gridToWorld(1, 3, testMaze62)

  const allTenSoundSpecs = [
    {
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      expectedActivationRange: 9.5,
      expectedAftermathSoundRange: 4.0,
      expectedAction: 'insulate_wiring',
      isPersistent: true,
    },
    {
      type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
      expectedActivationRange: 9.5,
      expectedAftermathSoundRange: 4.5,
      expectedAction: 'clear_furniture',
      isPersistent: false,
    },
    {
      type: HAZARD_TYPES.STEAM_PIPE_BURST,
      expectedActivationRange: 11.0,
      expectedAftermathSoundRange: 4.0,
      expectedAction: 'seal_steam_pipe',
      isPersistent: true,
    },
    {
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      expectedActivationRange: 11.0,
      expectedAftermathSoundRange: 4.5,
      expectedAction: 'clear_pipe',
      isPersistent: false,
    },
    {
      type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
      expectedActivationRange: 11.0,
      expectedAftermathSoundRange: 4.5,
      expectedAction: 'secure_floor_opening',
      isPersistent: false,
    },
    {
      type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE,
      expectedActivationRange: 12.0,
      expectedAftermathSoundRange: 4.5,
      expectedAction: 'clear_duct',
      isPersistent: false,
    },
    {
      type: HAZARD_TYPES.CEILING_COLLAPSE,
      expectedActivationRange: 12.5,
      expectedAftermathSoundRange: 4.5,
      expectedAction: 'clear_rubble',
      isPersistent: false,
    },
    {
      type: HAZARD_TYPES.WALL_COLLAPSE,
      expectedActivationRange: 12.5,
      expectedAftermathSoundRange: 4.5,
      expectedAction: 'clear_rubble',
      isPersistent: false,
    },
    {
      type: HAZARD_TYPES.FALLING_WATER_TANK,
      expectedActivationRange: 12.5,
      expectedAftermathSoundRange: 4.5,
      expectedAction: 'clear_tank',
      isPersistent: false,
    },
    {
      type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY,
      expectedActivationRange: 13.0,
      expectedAftermathSoundRange: 4.5,
      expectedAction: 'clear_machinery',
      isPersistent: false,
    },
  ]

  // --------------------------------------------------------------------------
  // 1. All-10-Hazards Activation & Aftermath Sound Propagation + Range Boundary Matrix
  // --------------------------------------------------------------------------
  {
    const engSound62 = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
    })
    engSound62.setMaze(testMaze62)
    engSound62.cancelSpawnSequence()
    for (let i = 0; i < engSound62._propCollisionIndex.colliders.length; i += 1) {
      const col = engSound62._propCollisionIndex.colliders[i]
      if (col && col.row === 1) col.enabled = false
    }

    // Spawn two patrolling enemies Facing EAST (+X) away from cell (1,2) so vision cannot see player:
    // - inRangeEnemy placed inside activationSoundRange
    // - outRangeEnemy placed outside activationSoundRange
    const inRangeEnemy = engSound62.spawnEnemy({
      id: 'sound62-in-range',
      type: 'stalker',
      spawnCell: { row: 1, col: 4 },
      patrolRoute: [
        { row: 1, col: 4 },
        { row: 1, col: 5 },
      ],
      config: { visionRange: 1.5, closeProximityRange: 0.8, patrolSpeed: 0 },
    })
    const outRangeEnemy = engSound62.spawnEnemy({
      id: 'sound62-out-range',
      type: 'stalker',
      spawnCell: { row: 1, col: 7 },
      patrolRoute: [
        { row: 1, col: 7 },
        { row: 1, col: 8 },
      ],
      config: { visionRange: 1.5, closeProximityRange: 0.8, patrolSpeed: 0 },
    })

    for (let idx = 0; idx < allTenSoundSpecs.length; idx += 1) {
      const spec = allTenSoundSpecs[idx]
      engSound62.hazardManager.clear()

      const haz = engSound62.hazardManager.addHazard({
        id: `sound62-${spec.type}`,
        type: spec.type,
        row: 1,
        col: 2,
        wallSide: 'north',
      })
      engSound62.syncHazardColliders({ allowPushOut: false })
      assert(
        Math.abs(haz.config.activationSoundRange - spec.expectedActivationRange) < 1e-4,
        `${spec.type} activationSoundRange === ${spec.expectedActivationRange}m (got ${haz.config.activationSoundRange})`
      )

      // Trigger WARNING at haz.dangerWorldPos
      engSound62.setPlayerWorldPosition(haz.dangerWorldPos.x, 0, haz.dangerWorldPos.z, {
        immediate: true,
      })
      engSound62.stepFrame(0.05, { render: false })
      assert(
        haz.getState() === HAZARD_STATES.WARNING,
        `${spec.type} enters WARNING when player approaches`
      )

      engSound62.setPlayerWorldPosition(c11_62.x, 0, c11_62.z, { immediate: true })

      // Position inRangeEnemy at (activationSoundRange - 1.0m) east of hazard dangerWorldPos, and outRangeEnemy at (activationSoundRange + 1.5m) east
      const actPos = haz.dangerWorldPos || haz.worldPos
      inRangeEnemy.setPosition(
        actPos.x + (spec.expectedActivationRange - 1.0),
        0,
        c12_62.z,
        Math.PI * 0.5
      )
      inRangeEnemy.state = ENEMY_STATES.PATROL
      inRangeEnemy.investigateTarget = null

      outRangeEnemy.setPosition(
        actPos.x + (spec.expectedActivationRange + 1.5),
        0,
        c12_62.z,
        Math.PI * 0.5
      )
      outRangeEnemy.state = ENEMY_STATES.PATROL
      outRangeEnemy.investigateTarget = null

      // Step until hazard transitions WARNING -> ACTIVE
      let inRangeAlertedOnActivation = false
      let outRangeAlertedOnActivation = false
      for (let s = 0; s < 25; s += 1) {
        engSound62.stepFrame(0.08, { render: false })
        if (inRangeEnemy.state === ENEMY_STATES.INVESTIGATE) {
          inRangeAlertedOnActivation = true
        }
        if (outRangeEnemy.state === ENEMY_STATES.INVESTIGATE) {
          outRangeAlertedOnActivation = true
        }
        if (
          haz.getState() === HAZARD_STATES.ACTIVE ||
          haz.getState() === HAZARD_STATES.DISABLED
        ) {
          // One extra step if needed
          if (!inRangeAlertedOnActivation) {
            engSound62.stepFrame(0.05, { render: false })
            if (inRangeEnemy.state === ENEMY_STATES.INVESTIGATE) {
              inRangeAlertedOnActivation = true
            }
            if (outRangeEnemy.state === ENEMY_STATES.INVESTIGATE) {
              outRangeAlertedOnActivation = true
            }
          }
          break
        }
      }
      assert(
        inRangeAlertedOnActivation === true &&
          inRangeEnemy.investigateTarget?.row === 1 &&
          inRangeEnemy.investigateTarget?.col === 2,
        `${spec.type} WARNING -> ACTIVE alerts in-range enemy at ${(spec.expectedActivationRange - 1.0).toFixed(1)}m`
      )
      assert(
        outRangeAlertedOnActivation === false && outRangeEnemy.state === ENEMY_STATES.PATROL,
        `${spec.type} WARNING -> ACTIVE does NOT alert out-of-range enemy at ${(spec.expectedActivationRange + 1.5).toFixed(1)}m`
      )

      // Advance collapse hazards to DISABLED aftermath if still in ACTIVE fall animation
      if (!spec.isPersistent && haz.getState() === HAZARD_STATES.ACTIVE) {
        for (let s = 0; s < 30; s += 1) {
          engSound62.stepFrame(0.08, { render: false })
          if (haz.getState() === HAZARD_STATES.DISABLED) break
        }
      }

      // Now test aftermath F interaction sound range (4.0m for persistent, 4.5m for collapse)
      // Stand in open corridor within interaction range of pivot and expire any remaining activation sound timer first
      engSound62.setPlayerWorldPosition(c12_62.x - 1.15, 0, c12_62.z + 0.35, { immediate: true })
      engSound62._soundEvent = null
      engSound62._soundTimer = 0
      engSound62.stepFrame(0.016, { render: false })

      const pivot = haz.getInteractionAnchor()
      inRangeEnemy.setPosition(
        pivot.x + (spec.expectedAftermathSoundRange - 0.6),
        0,
        c12_62.z,
        Math.PI * 0.5
      )
      inRangeEnemy.state = ENEMY_STATES.PATROL
      inRangeEnemy.investigateTarget = null

      outRangeEnemy.setPosition(
        pivot.x + (spec.expectedAftermathSoundRange + 1.2),
        0,
        c12_62.z,
        Math.PI * 0.5
      )
      outRangeEnemy.state = ENEMY_STATES.PATROL
      outRangeEnemy.investigateTarget = null

      const fRes = engSound62.interact()
      assert(
        fRes.handled === true &&
          fRes.action === spec.expectedAction &&
          Math.abs(fRes.emitSoundRange - spec.expectedAftermathSoundRange) < 1e-4,
        `${spec.type} aftermath F interaction returns action=${spec.expectedAction} and emitSoundRange=${spec.expectedAftermathSoundRange}m`
      )

      engSound62.stepFrame(0.05, { render: false })
      assert(
        inRangeEnemy.state === ENEMY_STATES.INVESTIGATE,
        `${spec.type} aftermath F interaction alerts enemy inside ${spec.expectedAftermathSoundRange}m sound radius`
      )
      assert(
        outRangeEnemy.state === ENEMY_STATES.PATROL,
        `${spec.type} aftermath F interaction does NOT alert enemy outside ${spec.expectedAftermathSoundRange}m sound radius`
      )
    }

    engSound62.dispose()
  }

  // --------------------------------------------------------------------------
  // 2. All-10-Hazards End-to-End DORMANT -> WARNING -> ACTIVE Audio Cues & Subtitles
  // --------------------------------------------------------------------------
  {
    const subtitlesReceived62 = []
    const engAudio62 = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
      audio: {
        subtitles: true,
        recordCueHistory: true,
      },
    })
    engAudio62.setMaze(testMaze62)
    engAudio62.cancelSpawnSequence()
    const audio62 = engAudio62.getAudioEngine()
    const unsub62 = audio62.subscribeSubtitles((entry) => {
      subtitlesReceived62.push(entry)
    })

    for (const spec of allTenSoundSpecs) {
      engAudio62.hazardManager.clear()
      audio62.clearCueHistory()
      audio62.reset()
      subtitlesReceived62.length = 0

      const haz = engAudio62.hazardManager.addHazard({
        id: `audio62-${spec.type}`,
        type: spec.type,
        row: 1,
        col: 2,
        wallSide: 'north',
      })
      // Step once while DORMANT so HorrorAudioEngine registers initial state = DORMANT
      engAudio62.setPlayerWorldPosition(c11_62.x, 0, c11_62.z, { immediate: true })
      engAudio62.stepFrame(0.02, { render: false })
      assert(haz.getState() === HAZARD_STATES.DORMANT, `${spec.type} starts DORMANT`)

      // Move into trigger radius at haz.dangerWorldPos to transition DORMANT -> WARNING
      engAudio62.setPlayerWorldPosition(haz.dangerWorldPos.x, 0, haz.dangerWorldPos.z, {
        immediate: true,
      })
      engAudio62.stepFrame(0.05, { render: false })
      assert(haz.getState() === HAZARD_STATES.WARNING, `${spec.type} transitions to WARNING`)

      // Step back to (1,1) and advance until WARNING -> ACTIVE
      engAudio62.setPlayerWorldPosition(c11_62.x, 0, c11_62.z, { immediate: true })
      for (let s = 0; s < 25; s += 1) {
        engAudio62.stepFrame(0.08, { render: false })
        if (
          haz.getState() === HAZARD_STATES.ACTIVE ||
          haz.getState() === HAZARD_STATES.DISABLED
        ) {
          break
        }
      }

      const history = audio62.getCueHistory()
      const warnCueType = `hazard_${spec.type}_warning`
      const activeCueType = `hazard_${spec.type}_active`
      assert(
        history.some((c) => c.type === warnCueType),
        `${spec.type} records 3D audio cue '${warnCueType}' on DORMANT -> WARNING`
      )
      assert(
        history.some((c) => c.type === activeCueType),
        `${spec.type} records 3D audio cue '${activeCueType}' on WARNING -> ACTIVE`
      )
      assert(
        subtitlesReceived62.filter((s) => s.source === 'hazard').length >= 2,
        `${spec.type} emits both warning and active accessibility subtitles via MazeSceneEngine (got ${subtitlesReceived62.length})`
      )
    }

    unsub62()
    engAudio62.dispose()
  }

  // --------------------------------------------------------------------------
  // 3. FALLING_WATER_TANK Active Surge Slowdown Kinematics & Expiration/Reset
  // --------------------------------------------------------------------------
  {
    const engSlow = createHeadlessEngine({
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
    })
    engSlow.setMaze(testMaze62)
    engSlow.cancelSpawnSequence()
    engSlow.hazardManager.clear()
    for (let i = 0; i < engSlow._propCollisionIndex.colliders.length; i += 1) {
      const col = engSlow._propCollisionIndex.colliders[i]
      if (col && col.row === 1) col.enabled = false
    }
    engSlow.syncHazardColliders({ allowPushOut: false })

    // Measure baseline 1-frame east (+X, yaw = -PI/2) displacement without slowdown
    engSlow.setPlayerWorldPosition(c11_62.x, 0, c11_62.z, {
      immediate: true,
      yaw: -Math.PI * 0.5,
    })
    const startBaseX = engSlow.getPlayerWorldPosition().x
    engSlow.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.05)
    const baseDeltaX = engSlow.getPlayerWorldPosition().x - startBaseX
    assert(baseDeltaX > 0.15, `Baseline movement advances player east (deltaX=${baseDeltaX.toFixed(4)})`)

    // Spawn FALLING_WATER_TANK at (1, 3) and trigger its water surge while player stands in surge zone
    engSlow.hazardManager.addHazard({
      id: 'slow62-tank',
      type: HAZARD_TYPES.FALLING_WATER_TANK,
      row: 1,
      col: 3,
      wallSide: 'north',
    })
    engSlow.syncHazardColliders({ allowPushOut: false })
    engSlow.setPlayerWorldPosition(c13_62.x, 0, c13_62.z + 0.15, {
      immediate: true,
      yaw: -Math.PI * 0.5,
    })

    // Step through WARNING -> ACTIVE surge hit so engine.applyHazardSlowdown(0.62, 1.8) fires
    let surgeSlowdownApplied = false
    for (let s = 0; s < 35; s += 1) {
      engSlow.stepFrame(0.06, { render: false })
      if (engSlow._hazardSlowdownMultiplier < 1 && engSlow._hazardSlowdownTimer > 0) {
        surgeSlowdownApplied = true
        break
      }
    }
    assert(
      surgeSlowdownApplied === true &&
        Math.abs(engSlow.getMovementSpeedMultiplier() - 0.62) < 1e-4 &&
        engSlow._hazardSlowdownTimer > 1.0 &&
        engSlow.health === 70,
      `FALLING_WATER_TANK active surge applies 30 damage and 0.62x slowdown (mult=${engSlow.getMovementSpeedMultiplier()}, timer=${engSlow._hazardSlowdownTimer.toFixed(2)}, hp=${engSlow.health})`
    )

    // Measure slowed 1-frame east (+X) displacement in open corridor at (1, 1)
    engSlow.setPlayerWorldPosition(c11_62.x, 0, c11_62.z, {
      immediate: true,
      yaw: -Math.PI * 0.5,
    })
    const startSlowX = engSlow.getPlayerWorldPosition().x
    engSlow.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.05)
    const slowDeltaX = engSlow.getPlayerWorldPosition().x - startSlowX
    assert(
      Math.abs(slowDeltaX / baseDeltaX - 0.62) < 0.02,
      `Water tank slowdown scales player movement displacement by 0.62x (ratio=${(slowDeltaX / baseDeltaX).toFixed(3)})`
    )

    // Advance > 1.85s and verify slowdown expires back to 1.0x
    for (let s = 0; s < 20; s += 1) {
      engSlow.stepFrame(0.1, { render: false })
    }
    assert(
      engSlow._hazardSlowdownTimer === 0 &&
        engSlow._hazardSlowdownMultiplier === 1 &&
        engSlow.getMovementSpeedMultiplier() === 1,
      'Water tank slowdown expires cleanly back to 1.0x after duration'
    )

    // Re-apply slowdown and verify resetCombat() immediately clears it
    engSlow.applyHazardSlowdown(0.62, 1.8)
    assert(
      engSlow.getMovementSpeedMultiplier() === 0.62 && engSlow._hazardSlowdownTimer === 1.8,
      'Slowdown re-armed'
    )
    engSlow.resetCombat()
    assert(
      engSlow._hazardSlowdownTimer === 0 &&
        engSlow._hazardSlowdownMultiplier === 1 &&
        engSlow.getMovementSpeedMultiplier() === 1,
      'resetCombat() immediately clears active hazard slowdown timer and multiplier'
    )

    engSlow.dispose()
  }

  // --------------------------------------------------------------------------
  // 4. Lethal Hazard Damage -> isGameOver Lockout & Spawn/Extraction Sequence Protection
  // --------------------------------------------------------------------------
  {
    let gameOverCount62 = 0
    const engLethal = createHeadlessEngine({
      initialHealth: 20,
      maxHealth: 100,
      enemies: { autoSpawn: false },
      onGameOver: () => {
        gameOverCount62 += 1
      },
    })
    engLethal.setMaze(testMaze62)
    engLethal.hazardManager.clear()
    engLethal.health = 20

    // Spawn a persistent EXPOSED_ELECTRICAL_WIRING hazard at start cell (1, 1) (30 damage >= 20 HP)
    const wiringHaz = engLethal.hazardManager.addHazard({
      id: 'lethal62-wiring',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 1,
      col: 1,
      wallSide: 'north',
    })

    // First verify active spawn sequence protection completely suppresses hazard triggers and damage
    assert(
      engLethal.isSpawnSequenceActive() === true,
      'Spawn sequence is active after setMaze'
    )
    engLethal.setPlayerWorldPosition(
      wiringHaz.dangerWorldPos.x,
      0,
      wiringHaz.dangerWorldPos.z,
      { immediate: true, preserveSpawnSequence: true }
    )
    engLethal.stepFrame(0.1, { render: false })
    assert(
      wiringHaz.getState() === HAZARD_STATES.DORMANT && engLethal.health === 20,
      'Active spawn sequence protection suppresses hazard trigger and damage'
    )

    // Cancel spawn sequence and step at wiringHaz.dangerWorldPos so wiring triggers WARNING -> ACTIVE and deals lethal 30 damage
    engLethal.cancelSpawnSequence()
    engLethal.setPlayerWorldPosition(
      wiringHaz.dangerWorldPos.x,
      0,
      wiringHaz.dangerWorldPos.z,
      { immediate: true }
    )
    for (let s = 0; s < 30; s += 1) {
      engLethal.stepFrame(0.06, { render: false })
      if (engLethal.isGameOver) break
    }
    assert(
      engLethal.isGameOver === true &&
        engLethal.health === 0 &&
        gameOverCount62 === 1 &&
        wiringHaz.getState() === HAZARD_STATES.ACTIVE,
      `Lethal hazard damage transitions player to isGameOver=true at 0 HP (hp=${engLethal.health}, gameOver=${engLethal.isGameOver})`
    )

    // While isGameOver is true, aftermath interaction prompt and interact() must be suppressed
    engLethal.stepFrame(0.05, { render: false })
    assert(
      engLethal.getNearbyInteractable() === null &&
        engLethal.getStealthState().canInteract === false &&
        engLethal.interact().handled === false,
      'isGameOver suppresses hazard aftermath prompt and blocks interact()'
    )

    // resetCombat() restores full health, clears isGameOver, resets hazard back to DORMANT
    engLethal.resetCombat()
    assert(
      engLethal.isGameOver === false &&
        engLethal.health === 100 &&
        wiringHaz.getState() === HAZARD_STATES.DORMANT &&
        wiringHaz.isAftermathCleared === false,
      'resetCombat() recovers cleanly from lethal hazard game-over and resets hazard to DORMANT'
    )

    // Also verify active extraction sequence protection suppresses hazard trigger and damage
    engLethal.cancelSpawnSequence()
    engLethal.isExitLocked = false
    const startedExtraction = engLethal.startExtractionSequence()
    assert(
      startedExtraction === true && engLethal.isExtractionSequenceActive() === true,
      'Extraction sequence starts cleanly when exit is unlocked'
    )
    engLethal.stepFrame(0.1, { render: false })
    assert(
      wiringHaz.getState() === HAZARD_STATES.DORMANT && engLethal.health === 100,
      'Active extraction sequence protection suppresses hazard trigger and damage'
    )

    engLethal.dispose()
  }

  // --------------------------------------------------------------------------
  // 5. Pool & Ownership Zero-Leak Check After Test 62 Disposal
  // --------------------------------------------------------------------------
  const poolsFinal62 = getHazardPoolStats()
  assert(
    poolsFinal62.geometries === 0 && poolsFinal62.materials === 0,
    'All Test 62 engines disposed with zero shared pool leaks'
  )
}
console.log(
  '✓ Prompt 11/12 Environmental Hazards Regression Alignment & Expansion (Test 62) verified'
)

console.log('--- ALL ENVIRONMENTAL HAZARDS AUDIT TESTS PASSED SUCCESSFULLY! ---')
