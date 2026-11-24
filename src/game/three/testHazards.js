import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  HAZARD_TYPES,
  placeHazards,
  resolveElectricalMount,
  resolveFloorGrateOrientation,
  resolveWallCollapseMount,
} from '../generation/hazardPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { exploreReachableCells } from '../generation/pathfinder.js'
import { resolveGridCollision, moveWithSubsteps } from '../world/gridCollision.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import { getHazardPoolStats } from './buildHazards.js'
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

assert(hazardsA.length === 10, `Maze produces 10 hazards (got ${hazardsA.length})`)
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
assert(standardHazards.length === 10, `Maze places 10 hazards (got ${standardHazards.length})`)
const seenCoords = new Set()
const seenIds = new Set()
for (const h of standardHazards) {
  const key = `${h.row},${h.col}`
  assert(!seenCoords.has(key), `Duplicate hazard coordinate found at ${key}`)
  assert(!seenIds.has(h.id), `Duplicate hazard id found: ${h.id}`)
  seenCoords.add(key)
  seenIds.add(h.id)
}
const typesSeen = new Set(standardHazards.map((h) => h.type))
assert(typesSeen.has(HAZARD_TYPES.FLOOR_SPIKES), 'Includes floor spikes')
assert(typesSeen.has(HAZARD_TYPES.PRESSURE_PLATE), 'Includes pressure plates')
assert(typesSeen.has(HAZARD_TYPES.ELECTRIC_GRID), 'Includes electrical hazards')
assert(typesSeen.has(HAZARD_TYPES.CEILING_COLLAPSE), 'Includes ceiling collapse hazards')
assert(typesSeen.has(HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE), 'Includes rotten furniture collapse hazards')
assert(typesSeen.has(HAZARD_TYPES.FALLING_PIPES_FIXTURES), 'Includes falling pipes & fixtures hazards')
assert(typesSeen.has(HAZARD_TYPES.STEAM_PIPE_BURST), 'Includes steam pipe burst hazards')
assert(typesSeen.has(HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING), 'Includes exposed electrical wiring hazards')
assert(typesSeen.has(HAZARD_TYPES.COLLAPSING_FLOOR_GRATE), 'Includes collapsing floor grate hazards')
assert(typesSeen.has(HAZARD_TYPES.WALL_COLLAPSE), 'Includes wall collapse hazards')
console.log('✓ Zero overlapping hazards and all 10 hazard types placed')

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

// 4. Spike warning, activation, damage, and cooldown timing
console.log('Test 4: Spike Warning, Activation, Damage, and Cooldown Timing')
const spikeCell = { row: 1, col: 3 }
const spikeWorld = gridToWorld(spikeCell.row, spikeCell.col, testMaze)
const farWorld = gridToWorld(3, 1, testMaze)
const onSpikeCtx = {
  playerWorldPos: { x: spikeWorld.x, y: 0, z: spikeWorld.z },
  playerGridCell: spikeCell,
}
const offSpikeCtx = {
  playerWorldPos: { x: farWorld.x, y: 0, z: farWorld.z },
  playerGridCell: { row: 3, col: 1 },
}

const spikeAgent = new HazardAgent(
  { id: 'spike-test', type: HAZARD_TYPES.FLOOR_SPIKES, ...spikeCell },
  testMaze
)
const spikeCfg = HAZARD_CONFIG[HAZARD_TYPES.FLOOR_SPIKES]
assert(spikeAgent.getState() === HAZARD_STATES.DORMANT, 'Spikes start DORMANT')

// Advance through most of dormant phase (even with player standing on it -> no damage)
let hit = spikeAgent.update(spikeCfg.dormantDuration - 0.1, onSpikeCtx)
assert(spikeAgent.getState() === HAZARD_STATES.DORMANT, 'Spikes stay DORMANT before dormantDuration')
assert(hit === null, 'Dormant spikes deal no damage')

// Cross into WARNING phase
hit = spikeAgent.update(0.15, onSpikeCtx)
assert(spikeAgent.getState() === HAZARD_STATES.WARNING, `Spikes enter WARNING (got: ${spikeAgent.getState()})`)
assert(hit === null, 'Warning spikes deal no damage')

// Remain in WARNING until just before activation
hit = spikeAgent.update(spikeCfg.warningDuration - 0.1, onSpikeCtx)
assert(spikeAgent.getState() === HAZARD_STATES.WARNING, 'Spikes remain in WARNING before activation')
assert(hit === null, 'Spikes do not damage prematurely during warning')

// Cross into ACTIVE phase -> must deal damage once
hit = spikeAgent.update(0.1, onSpikeCtx)
assert(spikeAgent.getState() === HAZARD_STATES.ACTIVE, `Spikes enter ACTIVE (got: ${spikeAgent.getState()})`)
assert(hit && hit.damage === spikeCfg.damage, `Active spikes deal ${spikeCfg.damage} damage`)

// Subsequent tick while still ACTIVE -> must NOT deal duplicate damage
const secondHitSameCycle = spikeAgent.update(0.2, onSpikeCtx)
assert(spikeAgent.getState() === HAZARD_STATES.ACTIVE, 'Spikes remain ACTIVE')
assert(secondHitSameCycle === null, 'Spikes do not repeat damage during same active cycle')

// Finish ACTIVE duration -> return to DORMANT (cooldown)
hit = spikeAgent.update(spikeCfg.activeDuration, onSpikeCtx)
assert(spikeAgent.getState() === HAZARD_STATES.DORMANT, `Spikes return to DORMANT cooldown (got: ${spikeAgent.getState()})`)
assert(hit === null, 'No damage upon entering cooldown')

// Advance through another full dormant + warning cycle to verify re-activation
spikeAgent.update(spikeCfg.dormantDuration + 0.05, offSpikeCtx)
assert(spikeAgent.getState() === HAZARD_STATES.WARNING, 'Spikes re-enter WARNING after cooldown')
spikeAgent.update(spikeCfg.warningDuration + 0.05, offSpikeCtx)
assert(spikeAgent.getState() === HAZARD_STATES.ACTIVE, 'Spikes re-enter ACTIVE after cooldown')
const hitCycle2 = spikeAgent.update(0.05, onSpikeCtx)
assert(hitCycle2 && hitCycle2.damage === spikeCfg.damage, 'Spikes deal damage again in next active cycle')
spikeAgent.dispose()
console.log('✓ Floor spikes warning, activation, single-hit damage, and cooldown verified')

// 5. Pressure plate triggering conditions
console.log('Test 5: Pressure Plate Triggering Conditions')
const plateCell = { row: 3, col: 3 }
const plateWorld = gridToWorld(plateCell.row, plateCell.col, testMaze)
const onPlateCtx = {
  playerWorldPos: { x: plateWorld.x, y: 0, z: plateWorld.z },
  playerGridCell: plateCell,
}
const plateAgent = new HazardAgent(
  { id: 'plate-test', type: HAZARD_TYPES.PRESSURE_PLATE, ...plateCell },
  testMaze
)
const plateCfg = HAZARD_CONFIG[HAZARD_TYPES.PRESSURE_PLATE]

// Must remain DORMANT indefinitely when NOT stepped on
for (let i = 0; i < 60; i += 1) {
  const h = plateAgent.update(0.1, offSpikeCtx)
  assert(h === null, 'Pressure plate deals no damage when unstepped')
  assert(
    plateAgent.getState() === HAZARD_STATES.DORMANT,
    `Pressure plate stays DORMANT when player is away (got: ${plateAgent.getState()})`
  )
}

// Step onto plate -> triggers WARNING immediately
hit = plateAgent.update(0.05, onPlateCtx)
assert(
  plateAgent.getState() === HAZARD_STATES.WARNING,
  `Pressure plate enters WARNING when stepped on (got: ${plateAgent.getState()})`
)
assert(hit === null, 'Pressure plate does not damage immediately during warning')

// Player dodges off plate before activation -> activates safely with 0 damage
plateAgent.update(plateCfg.warningDuration + 0.05, offSpikeCtx)
assert(plateAgent.getState() === HAZARD_STATES.ACTIVE, 'Pressure plate transitions to ACTIVE')
hit = plateAgent.update(0.1, offSpikeCtx)
assert(hit === null, 'Dodging off pressure plate avoids damage')

// Finish ACTIVE duration -> enters DORMANT cooldown
plateAgent.update(plateCfg.activeDuration, offSpikeCtx)
assert(plateAgent.getState() === HAZARD_STATES.DORMANT, 'Pressure plate returns to DORMANT after activation')

// Stepping back on during cooldown does NOT re-trigger
plateAgent.update(0.1, onPlateCtx)
assert(
  plateAgent.getState() === HAZARD_STATES.DORMANT,
  'Pressure plate respects post-activation cooldown'
)

// Expire cooldown, then step on and stay -> deals damage on activation
plateAgent.update(plateCfg.cooldownDuration + 0.1, offSpikeCtx)
plateAgent.update(0.05, onPlateCtx)
assert(plateAgent.getState() === HAZARD_STATES.WARNING, 'Pressure plate arms again after cooldown')
hit = plateAgent.update(plateCfg.warningDuration + 0.05, onPlateCtx)
assert(plateAgent.getState() === HAZARD_STATES.ACTIVE, 'Pressure plate activates')
assert(hit && hit.damage === plateCfg.damage, `Pressure plate deals ${plateCfg.damage} damage when player remains on tile`)
plateAgent.dispose()
console.log('✓ Pressure plate step-trigger, dodge, cooldown, and damage verified')

// 6. Electrical hazard activation and damage
console.log('Test 6: Electrical Hazard Activation & Damage')
const electricCell = { row: 1, col: 2 }
const electricWorld = gridToWorld(electricCell.row, electricCell.col, testMaze)
const onElectricCtx = {
  playerWorldPos: { x: electricWorld.x, y: 0, z: electricWorld.z },
  playerGridCell: electricCell,
}
const electricAgent = new HazardAgent(
  { id: 'electric-test', type: HAZARD_TYPES.ELECTRIC_GRID, ...electricCell },
  testMaze
)
const electricCfg = HAZARD_CONFIG[HAZARD_TYPES.ELECTRIC_GRID]

assert(electricAgent.getState() === HAZARD_STATES.DORMANT, 'Electric grid starts DORMANT')
electricAgent.update(electricCfg.dormantDuration, onElectricCtx)
assert(electricAgent.getState() === HAZARD_STATES.WARNING, 'Electric grid enters WARNING')
hit = electricAgent.update(electricCfg.warningDuration, onElectricCtx)
assert(electricAgent.getState() === HAZARD_STATES.ACTIVE, 'Electric grid enters ACTIVE')
assert(hit && hit.damage === electricCfg.damage, `Electric grid deals ${electricCfg.damage} damage`)
assert(electricAgent.update(0.2, onElectricCtx) === null, 'Electric grid hits only once per active cycle')
electricAgent.update(electricCfg.activeDuration, onElectricCtx)
assert(electricAgent.getState() === HAZARD_STATES.DORMANT, 'Electric grid cycles back to DORMANT')
electricAgent.dispose()
console.log('✓ Electrical hazard warning, activation, and damage verified')

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
  hazardId: 'spike-1',
  hazardType: HAZARD_TYPES.FLOOR_SPIKES,
})
assert(blockedHazardRes === false, 'Hazard damage blocked by active enemy-triggered immunity')
assert(engine.health === 75, 'Player HP remains 75 during immunity')

// Case B: Expire immunity -> Hazard strikes player -> temporary immunity blocks immediate enemy attack
engine.damageImmunityTimer = 0
const hazardHitRes = engine.applyDamage(25, {
  hazardId: 'electric-1',
  hazardType: HAZARD_TYPES.ELECTRIC_GRID,
})
assert(hazardHitRes === true, 'Hazard damage applies after immunity expires')
assert(engine.health === 50, 'Player HP drops to 50')
assert(combatEvents[combatEvents.length - 1].hazardId === 'electric-1', 'Damage event records hazardId')

const blockedEnemyRes = engine.applyDamage(25, { enemyId: 'stalker-1' })
assert(blockedEnemyRes === false, 'Enemy attack blocked by hazard-triggered immunity')
assert(engine.health === 50, 'Player HP remains 50 during hazard-triggered immunity')

// Case C: Real EnemyAgent + HazardAgent simultaneous tick through engine loop
engine.damageImmunityTimer = 0
engine.clearHazards()
const simHazard = new HazardAgent(
  {
    id: 'sim-spikes',
    type: HAZARD_TYPES.FLOOR_SPIKES,
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
  hazardId: 'sim-spikes',
  hazardType: HAZARD_TYPES.FLOOR_SPIKES,
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

// 9. Staggered initialTimer Phase Preservation on Replay
console.log('Test 9: Staggered initialTimer Phase Preservation on Replay')
const staggeredDormant = new HazardAgent(
  {
    id: 'stagger-dormant',
    type: HAZARD_TYPES.FLOOR_SPIKES,
    row: 1,
    col: 2,
    initialTimer: 1.35,
  },
  testMaze
)
const staggeredWarning = new HazardAgent(
  {
    id: 'stagger-warning',
    type: HAZARD_TYPES.ELECTRIC_GRID,
    row: 1,
    col: 3,
    initialTimer: electricCfg.dormantDuration + 0.4,
  },
  testMaze
)
assert(staggeredDormant.initialTimer === 1.35, 'HazardAgent preserves initialTimer property')
assert(
  staggeredDormant.getState() === HAZARD_STATES.DORMANT &&
    Math.abs(staggeredDormant.timer - 1.35) < 1e-6,
  'Dormant offset initialized cleanly'
)
assert(
  staggeredWarning.getState() === HAZARD_STATES.WARNING &&
    Math.abs(staggeredWarning.timer - 0.4) < 1e-6,
  'Warning offset initialized cleanly'
)

staggeredDormant.update(3.0, offSpikeCtx)
staggeredWarning.update(2.0, offSpikeCtx)
staggeredDormant.resetState()
staggeredWarning.resetState()

assert(
  staggeredDormant.getState() === HAZARD_STATES.DORMANT &&
    Math.abs(staggeredDormant.timer - 1.35) < 1e-6,
  'resetState restores original staggered DORMANT timer instead of 0'
)
assert(
  staggeredWarning.getState() === HAZARD_STATES.WARNING &&
    Math.abs(staggeredWarning.timer - 0.4) < 1e-6,
  'resetState restores original staggered WARNING state & offset'
)

const replayEngine = createHeadlessEngine({ enemies: { autoSpawn: false } })
replayEngine.setMaze(mediumMazeA)
const initialSnapshots = replayEngine
  .getHazardManager()
  .getHazards()
  .map((agent) => ({
    id: agent.id,
    type: agent.type,
    state: agent.state,
    timer: agent.timer,
    initialTimer: agent.initialTimer,
  }))
replayEngine.hazardManager.update(2.2, {
  playerWorldPos: gridToWorld(mediumMazeA.start.row, mediumMazeA.start.col, mediumMazeA),
  playerGridCell: mediumMazeA.start,
})
replayEngine.resetCombat()
for (const snap of initialSnapshots) {
  const restored = replayEngine.getHazardManager().hazards.get(snap.id)
  assert(
    restored.state === snap.state && Math.abs(restored.timer - snap.timer) < 1e-6,
    `Engine resetCombat restores hazard ${snap.id} (${snap.type}) to its original staggered phase`
  )
}
staggeredDormant.dispose()
staggeredWarning.dispose()
replayEngine.dispose()
console.log('✓ Staggered hazard phases preserved across resetState() and resetCombat()')

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

console.log('--- ALL ENVIRONMENTAL HAZARDS AUDIT TESTS PASSED SUCCESSFULLY! ---')
