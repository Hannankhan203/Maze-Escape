import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { HAZARD_TYPES, placeHazards } from '../generation/hazardPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { gridToWorld } from '../world/worldCoords.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import {
  HAZARD_CONFIG,
  HAZARD_STATES,
  HazardAgent,
} from './HazardAgent.js'
import { HazardManager } from './HazardManager.js'
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

assert(hazardsA.length === 6, `Maze produces 6 hazards (got ${hazardsA.length})`)
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
assert(standardHazards.length === 6, `Maze places 6 hazards (got ${standardHazards.length})`)
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
console.log('✓ Zero overlapping hazards and all 4 hazard types placed')

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

console.log('--- ALL ENVIRONMENTAL HAZARDS AUDIT TESTS PASSED SUCCESSFULLY! ---')
