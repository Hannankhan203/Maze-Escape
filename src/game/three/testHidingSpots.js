import * as THREE from 'three'
import {
  HIDING_SPOT_TYPES,
  placeHidingSpots,
} from '../generation/hidingSpotPlacement.js'
import { placeHazards } from '../generation/hazardPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  buildHidingSpotMesh,
  disposeHidingSpotMesh,
  updateHidingSpotVisualState,
} from './buildHidingSpots.js'
import { CAMERA_MODES } from './CameraRig.js'
import { ENEMY_STATES } from './EnemyAgent.js'
import { HidingSpotAgent } from './HidingSpotAgent.js'
import { HidingSpotManager } from './HidingSpotManager.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

console.log('--- RUNNING HIDING SPOTS & STEALTH TESTS ---')

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

const easyMazeA = generateMaze({ difficulty: 'easy', seed: 424242 })
const easyMazeB = generateMaze({ difficulty: 'easy', seed: 424242 })
const mediumMazeA = generateMaze({ difficulty: 'medium', seed: 8675309 })
const mediumMazeB = generateMaze({ difficulty: 'medium', seed: 8675309 })
const mediumMazeDiff = generateMaze({ difficulty: 'medium', seed: 1357911 })
const hardMaze = generateMaze({ difficulty: 'hard', seed: 246810 })
const hardcoreMaze = generateMaze({ difficulty: 'hardcore', seed: 135792 })

// 1. Deterministic placement using identical seeds & explicit count options
console.log('Test 1: Deterministic Seeded Hiding Spot Placement')
const spotsEasyA = placeHidingSpots(easyMazeA, { count: 3 })
const spotsEasyDefault = placeHidingSpots(easyMazeA)
const spotsEasyB = placeHidingSpots(easyMazeB, { count: 3 })
const spotsMedA = placeHidingSpots(mediumMazeA)
const spotsMedB = placeHidingSpots(mediumMazeB)
const spotsMedDiff = placeHidingSpots(mediumMazeDiff)
const spotsHard = placeHidingSpots(hardMaze, { count: 10 })
const spotsHardDefault = placeHidingSpots(hardMaze)
const spotsHardcore = placeHidingSpots(hardcoreMaze, { count: 16 })
const spotsHardcoreDefault = placeHidingSpots(hardcoreMaze)

assert(spotsEasyDefault.length === 6, `Default hiding spot count is 6 on 11x11 maze (got ${spotsEasyDefault.length})`)
assert(spotsMedA.length === 6, `Default hiding spot count is 6 on 17x17 maze (got ${spotsMedA.length})`)
assert(spotsHardDefault.length === 6, `Default hiding spot count is 6 on 23x23 maze (got ${spotsHardDefault.length})`)
assert(spotsHardcoreDefault.length === 6, `Default hiding spot count is 6 on 31x31 maze (got ${spotsHardcoreDefault.length})`)
assert(spotsEasyA.length === 3, `Explicit count=3 places 3 hiding spots (got ${spotsEasyA.length})`)
assert(spotsHard.length === 10, `Explicit count=10 places 10 hiding spots (got ${spotsHard.length})`)
assert(spotsHardcore.length === 16, `Explicit count=16 places 16 hiding spots (got ${spotsHardcore.length})`)
assert(
  JSON.stringify(spotsEasyA) === JSON.stringify(spotsEasyB),
  'Identical 11x11 maze seeds yield identical hiding spots'
)
assert(
  JSON.stringify(spotsMedA) === JSON.stringify(spotsMedB),
  'Identical 17x17 maze seeds yield identical hiding spots'
)
assert(
  JSON.stringify(spotsMedA) !== JSON.stringify(spotsMedDiff),
  'Different seeds yield different hiding spots'
)
console.log('✓ Deterministic seeded placement verified')

// 2. Excludes walls, start, exit, hazards, unreachable cells; no overlaps
console.log('Test 2: Exclusions, Navigation & Overlap Checks')
const mazeWithUnreachablePocket = {
  rows: 7,
  cols: 7,
  seed: 9001,
  difficulty: 'easy',
  start: { row: 1, col: 1 },
  exit: { row: 5, col: 5 },
  grid: [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1, 0, 1], // (1,5) is an isolated unreachable pocket
    [1, 0, 1, 0, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 1], // (5,1) is also unreachable
    [1, 1, 1, 1, 1, 1, 1],
  ],
}
const pocketSpots = placeHidingSpots(mazeWithUnreachablePocket, { count: 12 })
for (const s of pocketSpots) {
  assert(
    !(s.row === 1 && s.col === 5) && !(s.row === 5 && s.col === 1),
    `Never places in unreachable pocket (${s.row}, ${s.col})`
  )
}

for (const [label, maze, spots] of [
  ['11x11', easyMazeA, spotsEasyA],
  ['17x17', mediumMazeA, spotsMedA],
  ['23x23', hardMaze, spotsHard],
  ['31x31', hardcoreMaze, spotsHardcore],
]) {
  const hazards = placeHazards(maze)
  const hazardCoords = new Set(hazards.map((h) => `${h.row},${h.col}`))
  const seenCoords = new Set()
  const seenIds = new Set()

  for (const s of spots) {
    const key = `${s.row},${s.col}`
    assert(
      maze.grid[s.row]?.[s.col] === CELL_TYPES.PATH,
      `${label} spot ${s.id} is on walkable PATH cell`
    )
    assert(
      !(s.row === maze.start.row && s.col === maze.start.col),
      `${label} spot ${s.id} excluded from start`
    )
    assert(
      !(s.row === maze.exit.row && s.col === maze.exit.col),
      `${label} spot ${s.id} excluded from exit`
    )
    assert(
      !hazardCoords.has(key),
      `${label} spot ${s.id} does not overlap hazard at ${key}`
    )
    assert(!seenCoords.has(key), `${label} spot coordinate unique at ${key}`)
    assert(!seenIds.has(s.id), `${label} spot id unique: ${s.id}`)
    seenCoords.add(key)
    seenIds.add(s.id)

    const reach = findShortestPath(maze.grid, maze.start, { row: s.row, col: s.col })
    assert(reach.found, `${label} spot ${s.id} is reachable from start`)
  }

  const nav = findShortestPath(maze.grid, maze.start, maze.exit)
  assert(nav.found, `${label} start-to-exit path stays intact`)
}
console.log('✓ Exclusions, reachability, and zero-overlap rules verified')

// 3. Procedural 3D hiding-spot visuals & state updates
console.log('Test 3: Procedural 3D Visuals & State Transitions')
for (const spotType of [
  HIDING_SPOT_TYPES.CONTAINMENT_LOCKER,
  HIDING_SPOT_TYPES.SUPPLY_CABINET,
]) {
  const meshGroup = buildHidingSpotMesh({ id: `vis-${spotType}`, type: spotType })
  assert(meshGroup && meshGroup.isGroup, `Builds Three.js Group for ${spotType}`)
  assert(meshGroup.userData.doorPivot, `${spotType} has articulated doorPivot`)
  assert(
    meshGroup.userData.indicatorMat,
    `${spotType} has stealth indicatorMat`
  )

  updateHidingSpotVisualState(meshGroup, {
    isHighlighted: true,
    isOccupied: false,
    delta: 0.5,
  })
  const highlightedEmissive =
    meshGroup.userData.indicatorMat.emissiveIntensity
  assert(
    highlightedEmissive > 0.45,
    `${spotType} indicator brightens when highlighted`
  )
  assert(
    meshGroup.userData.doorPivot.rotation.y < -0.1,
    `${spotType} door swings ajar when highlighted`
  )

  for (let i = 0; i < 20; i += 1) {
    updateHidingSpotVisualState(meshGroup, {
      isHighlighted: false,
      isOccupied: true,
      delta: 0.05,
    })
  }
  assert(
    Math.abs(meshGroup.userData.doorPivot.rotation.y - -0.08) < 1e-3,
    `${spotType} door settles to stealth peek slit (-0.08 rad) when occupied`
  )

  disposeHidingSpotMesh(meshGroup)
  assert(
    meshGroup.children.length === 0,
    `${spotType} mesh children cleared cleanly on dispose`
  )
}
console.log('✓ Procedural 3D locker & cabinet meshes verified')

// Test corridor grid for stealth, interaction, and enemy AI
const testMaze = {
  rows: 5,
  cols: 5,
  start: { row: 1, col: 1 },
  exit: { row: 3, col: 3 },
  seed: 5150,
  difficulty: 'small',
  grid: [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ],
}

// 4. Interaction, movement blocking, third-person visibility, and safe exit
console.log('Test 4: Interaction, Movement Lock & Third-Person Visibility')
const stealthNotifications = []
const engine = createHeadlessEngine({
  cameraMode: CAMERA_MODES.THIRD_PERSON,
  enemies: { autoSpawn: false },
  onStealthChange: (state) => stealthNotifications.push(state),
})
engine.setMaze(testMaze)
engine.clearHidingSpots()

const addedSpot = engine.hidingSpotManager.addHidingSpot({
  id: 'hide-test-1-2',
  type: HIDING_SPOT_TYPES.CONTAINMENT_LOCKER,
  row: 1,
  col: 2,
  facingYaw: Math.PI,
  offsetDir: { dRow: -1, dCol: 0 },
})
assert(addedSpot instanceof HidingSpotAgent, 'HidingSpotAgent spawned cleanly')

// Player far away from hiding spot (1,2) and not on exit gate (3,3) -> interact fails
engine.setPlayerGridPosition(3, 1, { immediate: true })
assert(
  engine.interact().handled === false,
  'Out-of-range interact() refuses to enter distant hiding spot'
)
assert(engine.isPlayerHidden() === false, 'Player stays unhidden when out of range')

// Player approaches spot -> third-person mesh visible, canInteract true
engine.setPlayerGridPosition(1, 2, { immediate: true })
const playerGroup = engine.getPlayer()
assert(playerGroup.visible === true, 'Player mesh visible in THIRD_PERSON before hiding')

const nearCheck = engine.hidingSpotManager.update(0.016, {
  playerWorldPos: engine.getPlayerWorldPosition(),
  playerGridCell: engine.getPlayerGridCell(),
})
assert(nearCheck.canInteract === true, 'canInteract true near hiding spot')
assert(
  nearCheck.nearbySpotId === 'hide-test-1-2',
  'Nearest hiding spot targeted correctly'
)

// Trigger onStealthChange once when proximity begins, NOT repeatedly on same state
stealthNotifications.length = 0
engine._notifyStealthChange(false, nearCheck)
engine._notifyStealthChange(false, nearCheck)
assert(
  stealthNotifications.length === 1,
  `onStealthChange fires once on discrete transition (got ${stealthNotifications.length})`
)

// Enter hiding spot via interact()
const enterRes = engine.interact()
assert(enterRes.handled === true && enterRes.action === 'enter', 'interact() enters hiding spot')
assert(engine.isPlayerHidden() === true, 'Engine reports player is hidden')
assert(addedSpot.isOccupied === true, 'Hiding spot marked occupied')
assert(playerGroup.visible === false, 'Player third-person mesh hidden while inside locker')

// Switching camera modes while hidden must keep mesh hidden
engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
assert(playerGroup.visible === false, 'Player mesh hidden in FIRST_PERSON while hidden')
engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
assert(playerGroup.visible === false, 'Player mesh remains hidden in THIRD_PERSON while inside locker')

// Normal movement blocked while hidden
const posWhileHidden = engine.getPlayerWorldPosition()
const moveAttempt = engine.stepMovement(
  { forwardAxis: 1, strafeAxis: 0.5, sprint: true },
  0.1
)
assert(moveAttempt.moved === false, 'stepMovement blocked while hidden')
const posAfterBlockedMove = engine.getPlayerWorldPosition()
assert(
  posAfterBlockedMove.x === posWhileHidden.x &&
    posAfterBlockedMove.z === posWhileHidden.z,
  'Player position remains locked inside hiding spot'
)

// Exit hiding spot via interact()
const exitRes = engine.interact()
assert(exitRes.handled === true && exitRes.action === 'exit', 'interact() exits hiding spot')
assert(engine.isPlayerHidden() === false, 'Player no longer hidden after exit')
assert(addedSpot.isOccupied === false, 'Hiding spot unmarked occupied after exit')
assert(playerGroup.visible === true, 'Third-person player mesh restored upon exiting hiding spot')

// Movement resumes normally after exit
const moveAfterExit = engine.stepMovement({ forwardAxis: 1, strafeAxis: 0 }, 0.05)
assert(moveAfterExit.moved === true, 'Normal player movement resumes after exiting hiding spot')
console.log('✓ Interaction, movement lock, camera visibility, and exit verified')

// 5. Enemy vision stealth & sound investigation behavior
console.log('Test 5: Enemy Vision Blocking & Sound Investigation While Hidden')
const stealthEnemy = engine.spawnEnemy({
  id: 'stalker-stealth-test',
  spawnCell: { row: 1, col: 1 },
  patrolRoute: [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
  ],
  config: {
    visionRange: 25,
    visionFov: Math.PI,
    closeProximityRange: 4.5,
    attackRange: 5.0,
    attackHitDelay: 0.05,
    attackDamage: 25,
    loseSightDuration: 1.5,
    searchDuration: 0.5,
  },
})

// Move player near locker (1, 2) and enter hiding spot
engine.setPlayerGridPosition(1, 2, { immediate: true })
const stealthEnter = engine.enterHidingSpot(addedSpot)
assert(stealthEnter.entered === true, 'Player hides in locker at (1,2)')

const hiddenWorldPos = engine.getPlayerWorldPosition()
const enemyStartWorld = gridToWorld(1, 1, testMaze)
stealthEnemy.setPosition(enemyStartWorld.x, 0, enemyStartWorld.z, -Math.PI / 2)
stealthEnemy.state = ENEMY_STATES.PATROL

// Even right next to the locker within closeProximityRange & full LOS, enemy must NOT see or attack hidden player
for (let i = 0; i < 15; i += 1) {
  const ctxHidden = {
    playerWorldPos: hiddenWorldPos,
    playerGridCell: { row: 1, col: 2 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
    playerHidden: true,
    soundEvent: null,
  }
  const perc = stealthEnemy._checkPerception(ctxHidden)
  assert(perc.canSee === false, 'Enemy cannot see hidden player through vision or proximity')
  const res = stealthEnemy.update(0.05, ctxHidden)
  assert(
    res.state !== ENEMY_STATES.CHASE && res.state !== ENEMY_STATES.ATTACK,
    `Enemy does not enter CHASE or ATTACK against hidden player (state=${res.state})`
  )
  assert(res.attackHit === null, 'Enemy deals zero attack hits to hidden player')
}

// If enemy was ALREADY chasing before player entered hiding spot, entering stops attack and lets enemy lose sight cleanly
stealthEnemy.state = ENEMY_STATES.CHASE
stealthEnemy.loseSightTimer = 0.2
const chaseCtxHidden = {
  playerWorldPos: hiddenWorldPos,
  playerGridCell: { row: 1, col: 2 },
  playerHidden: true,
  soundEvent: null,
}
assert(
  stealthEnemy._checkPerception(chaseCtxHidden).canSee === false,
  'Chasing enemy cannot re-acquire vision on hidden player'
)
const chaseRes = stealthEnemy.update(0.05, chaseCtxHidden)
assert(chaseRes.attackHit === null, 'Chasing enemy cannot attack hidden player')

// Emit relevant sound near (3, 1) while player remains hidden -> enemy investigates sound without discovering player
stealthEnemy.state = ENEMY_STATES.PATROL
const soundWorld = gridToWorld(3, 1, testMaze)
const soundUpdate = stealthEnemy.update(0.05, {
  playerWorldPos: hiddenWorldPos,
  playerGridCell: { row: 1, col: 2 },
  playerHidden: true,
  soundEvent: {
    position: { x: soundWorld.x, y: 0, z: soundWorld.z },
    cell: { row: 3, col: 1 },
    range: 20,
  },
})
assert(
  soundUpdate.state === ENEMY_STATES.INVESTIGATE,
  `Enemy investigates sound while player is hidden (got: ${soundUpdate.state})`
)
assert(
  stealthEnemy.investigateTarget &&
    stealthEnemy.investigateTarget.row === 3 &&
    stealthEnemy.investigateTarget.col === 1,
  'Enemy records sound cell target for investigation'
)

// Walk enemy through investigate & search while player stays hidden -> never auto-discovers hidden player
let sawPlayerDuringSearch = false
let attackedDuringSearch = false
for (let i = 0; i < 60; i += 1) {
  const tickCtx = {
    playerWorldPos: hiddenWorldPos,
    playerGridCell: { row: 1, col: 2 },
    playerHidden: true,
    soundEvent: null,
  }
  const tickPerc = stealthEnemy._checkPerception(tickCtx)
  const tickRes = stealthEnemy.update(0.1, tickCtx)
  if (tickPerc.canSee || tickRes.state === ENEMY_STATES.CHASE) {
    sawPlayerDuringSearch = true
  }
  if (tickRes.attackHit || tickRes.state === ENEMY_STATES.ATTACK) {
    attackedDuringSearch = true
  }
}
assert(!sawPlayerDuringSearch, 'Investigating enemy never automatically discovers hidden player')
assert(!attackedDuringSearch, 'Investigating enemy never attacks hidden player')

// Once player exits right in front of close enemy, vision resumes normally
engine.exitHidingSpot()
const exposedCtx = {
  playerWorldPos: engine.getPlayerWorldPosition(),
  playerGridCell: engine.getPlayerGridCell(),
  playerHidden: false,
  soundEvent: null,
}
const exposedPerc = stealthEnemy._checkPerception(exposedCtx)
const exposedRes = stealthEnemy.update(0.05, exposedCtx)
assert(
  exposedPerc.canSee === true ||
    exposedRes.state === ENEMY_STATES.CHASE ||
    exposedRes.state === ENEMY_STATES.ATTACK,
  'Enemy detects player again once player exits hiding spot'
)
console.log('✓ Enemy vision blocking, chase interruption, and sound investigation verified')

// 6. Edge cases: game over, resetCombat, maze replacement, disposal
console.log('Test 6: Edge Cases, Maze Replacement & Leak-Free Disposal')
// Game over while hidden cleanly exits hiding spot & blocks re-entry
engine.setPlayerGridPosition(1, 2, { immediate: true })
assert(engine.enterHidingSpot(addedSpot).entered === true, 'Re-entered locker before game over')
engine.applyDamage(100, { enemyId: 'stalker-stealth-test' })
assert(engine.isGameOver === true, 'Player reaches game over')
assert(engine.isPlayerHidden() === false, 'Game over forces clean exit from hidden state')
assert(addedSpot.isOccupied === false, 'Locker unoccupied after game over')
assert(engine.interact().handled === false, 'Cannot interact/hide while game over')

// resetCombat restores health and clears hidden state safely
engine.resetCombat()
assert(engine.health === 100 && engine.isGameOver === false, 'resetCombat restores health & clears game over')
assert(engine.isPlayerHidden() === false, 'resetCombat ensures unhidden state')

// setMaze disposes previous hiding spots and mounts deterministic new ones
const oldSpots = engine.getHidingSpots()
engine.setMaze(mediumMazeA)
const medSpotsFromEngine = engine.getHidingSpots()
assert(
  medSpotsFromEngine.length === spotsMedA.length,
  `Engine mounts all ${spotsMedA.length} medium maze hiding spots`
)
for (const oldSpot of oldSpots) {
  assert(oldSpot.isDisposed === true, `Previous spot ${oldSpot.id} disposed on maze change`)
  assert(oldSpot.getMesh() === null, `Previous spot ${oldSpot.id} mesh nulled`)
}

// Verify HidingSpotManager standalone maze replacement & disposal
const standaloneScene = new THREE.Scene()
const spotMgr = new HidingSpotManager(standaloneScene)
spotMgr.setMaze(easyMazeA)
const sCount = spotMgr.getHidingSpots().length
assert(sCount > 0 && standaloneScene.children.length === sCount, 'Standalone manager adds meshes to scene')
spotMgr.dispose()
assert(spotMgr.isDisposed === true, 'Standalone manager marked disposed')
assert(spotMgr.getHidingSpots().length === 0, 'Standalone manager clears spots on dispose')
assert(standaloneScene.children.length === 0, 'Standalone scene cleared of hiding spot meshes on dispose')

// Verify MazeSceneEngine disposes hidingSpotManager and removes meshes
const engineSpotMgr = engine.getHidingSpotManager()
const engineSceneRef = engine.scene
engine.dispose()
assert(engine.isDisposed === true, 'MazeSceneEngine disposed')
assert(engineSpotMgr.isDisposed === true, 'MazeSceneEngine disposes hidingSpotManager on dispose()')
assert(engine.scene === null, 'MazeSceneEngine nulls scene reference on dispose()')
assert(engineSceneRef.children.length === 0, 'Scene has 0 remaining children after engine.dispose()')
console.log('✓ Edge cases, maze replacement, and leak-free disposal verified')

console.log('--- ALL HIDING SPOTS & STEALTH TESTS PASSED SUCCESSFULLY! ---')
