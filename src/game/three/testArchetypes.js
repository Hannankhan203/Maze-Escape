import {
  ENEMY_ARCHETYPES,
  ENEMY_DIFFICULTY_SCALING,
  ENEMY_TYPES,
  getEnemyArchetypeConfig,
  placeEnemies,
} from '../generation/enemyPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { isCellWalkable } from '../world/gridCollision.js'
import { gridToWorld } from '../world/worldCoords.js'
import { buildEnemy, disposeEnemy, updateEnemyVisualState } from './buildEnemy.js'
import { ENEMY_STATES, EnemyAgent } from './EnemyAgent.js'
import { EnemyManager } from './EnemyManager.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createMockAudioContext() {
  function makeParam(initial = 0) {
    return {
      value: initial,
      setValueAtTime(v) {
        this.value = v
      },
      setTargetAtTime(v) {
        this.value = v
      },
      linearRampToValueAtTime(v) {
        this.value = v
      },
      exponentialRampToValueAtTime(v) {
        this.value = v
      },
    }
  }
  function makeNode(extra = {}) {
    return {
      connect() {},
      disconnect() {},
      ...extra,
    }
  }
  const ctx = {
    state: 'running',
    currentTime: 1.0,
    sampleRate: 44100,
    destination: makeNode(),
    listener: {
      positionX: makeParam(0),
      positionY: makeParam(0),
      positionZ: makeParam(0),
      forwardX: makeParam(0),
      forwardY: makeParam(0),
      forwardZ: makeParam(-1),
      upX: makeParam(0),
      upY: makeParam(1),
      upZ: makeParam(0),
    },
    async resume() {},
    async close() {},
    createGain: () => makeNode({ gain: makeParam(1) }),
    createDynamicsCompressor: () =>
      makeNode({
        threshold: makeParam(-14),
        knee: makeParam(18),
        ratio: makeParam(6),
      }),
    createBiquadFilter: () =>
      makeNode({ type: 'lowpass', frequency: makeParam(1000), Q: makeParam(1) }),
    createPanner: () =>
      makeNode({
        panningModel: 'HRTF',
        distanceModel: 'linear',
        refDistance: 1.8,
        maxDistance: 22,
        rolloffFactor: 0,
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
      }),
    createOscillator: () =>
      makeNode({
        type: 'sine',
        frequency: makeParam(220),
        start() {},
        stop() {},
        onended: null,
      }),
    createBuffer: (ch, len, sr) => ({
      duration: len / sr,
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () =>
      makeNode({
        buffer: null,
        loop: false,
        start() {},
        stop() {},
        onended: null,
      }),
  }
  return ctx
}

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

console.log('--- RUNNING ENEMY ARCHETYPE UNIT TESTS ---')

// Open corridor & room test maze
const arenaMaze = {
  width: 9,
  height: 9,
  rows: 9,
  cols: 9,
  seed: 7711,
  difficulty: 'medium',
  start: { row: 1, col: 1 },
  exit: { row: 7, col: 7 },
  grid: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 0, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 0, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 0, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],
}

// 1. Archetype Configuration & Override Support
console.log('Test 1: Archetype Configuration & Custom Overrides')
const stalkerCfg = getEnemyArchetypeConfig(ENEMY_TYPES.STALKER)
const hunterCfg = getEnemyArchetypeConfig(ENEMY_TYPES.HUNTER)
const bruteCfg = getEnemyArchetypeConfig(ENEMY_TYPES.BRUTE)

assert(
  stalkerCfg.chaseSpeed > hunterCfg.chaseSpeed &&
    hunterCfg.chaseSpeed > bruteCfg.chaseSpeed,
  'Stalker is fastest chaser and Brute is slowest'
)
assert(
  bruteCfg.attackDamage > stalkerCfg.attackDamage &&
    stalkerCfg.attackDamage > hunterCfg.attackDamage,
  'Brute deals highest attack damage'
)
assert(
  bruteCfg.attackRange > hunterCfg.attackRange &&
    bruteCfg.attackRange > stalkerCfg.attackRange,
  'Brute has greatest attack range'
)
assert(
  bruteCfg.attackCooldown > stalkerCfg.attackCooldown &&
    stalkerCfg.attackCooldown > hunterCfg.attackCooldown,
  'Attack cooldowns differ logically by archetype'
)
assert(
  hunterCfg.hearingSprintRange > stalkerCfg.hearingSprintRange &&
    hunterCfg.hearingWalkRange > stalkerCfg.hearingWalkRange &&
    hunterCfg.prioritizeHidingAreas === true,
  'Hunter has highest hearing range and prioritizes hiding areas'
)

const customBrute = new EnemyAgent('brute-custom', {
  maze: arenaMaze,
  type: ENEMY_TYPES.BRUTE,
  spawnCell: { row: 7, col: 7 },
  config: { attackDamage: 55, chaseSpeed: 4.1 },
})
assert(customBrute.getType() === ENEMY_TYPES.BRUTE, 'getType() returns brute')
assert(customBrute.config.attackDamage === 55, 'Custom config overrides archetype damage')
assert(customBrute.config.attackRange === ENEMY_ARCHETYPES.brute.attackRange, 'Unspecified archetype defaults remain intact')
customBrute.dispose()
console.log('✓ Archetype configuration and overrides verified')

// 2. Distinct Procedural 3D Appearances & Visual State Updates
console.log('Test 2: Distinct Procedural 3D Models & Disposal')
const stalkerMesh = buildEnemy({ id: 'vis-s', type: ENEMY_TYPES.STALKER, maze: arenaMaze, spawnCell: { row: 1, col: 3 } })
const hunterMesh = buildEnemy({ id: 'vis-h', type: ENEMY_TYPES.HUNTER, maze: arenaMaze, spawnCell: { row: 1, col: 5 } })
const bruteMesh = buildEnemy({ id: 'vis-b', type: ENEMY_TYPES.BRUTE, maze: arenaMaze, spawnCell: { row: 1, col: 7 } })

assert(stalkerMesh.userData.enemyType === 'stalker', 'Stalker mesh tagged')
assert(hunterMesh.userData.enemyType === 'hunter', 'Hunter mesh tagged')
assert(bruteMesh.userData.enemyType === 'brute', 'Brute mesh tagged')

const scaleS = stalkerMesh.userData.rig.scaleGroup.scale.y
const scaleH = hunterMesh.userData.rig.scaleGroup.scale.y
const scaleB = bruteMesh.userData.rig.scaleGroup.scale.y
assert(scaleB > scaleS && scaleS > scaleH, `Distinct physical scale silhouette (Brute ${scaleB} > Stalker ${scaleS} > Hunter ${scaleH})`)

assert(
  stalkerMesh.userData.typePalette.sensorNormal !== hunterMesh.userData.typePalette.sensorNormal &&
    hunterMesh.userData.typePalette.sensorNormal !== bruteMesh.userData.typePalette.sensorNormal,
  'Each archetype uses a distinct ocular color palette'
)

const countChildNames = (group, prefix) => {
  let count = 0
  group.traverse((obj) => {
    if (obj.name && obj.name.startsWith(prefix)) count += 1
  })
  return count
}
assert(countChildNames(hunterMesh, 'maze-enemy-acoustic-ear-') === 2, 'Hunter has dual acoustic ear horns')
assert(countChildNames(bruteMesh, 'maze-enemy-pauldron-') === 2, 'Brute has armored shoulder pauldrons')
assert(countChildNames(bruteMesh, 'maze-enemy-reactor-') === 2, 'Brute has dorsal exhaust reactors')
assert(countChildNames(stalkerMesh, 'maze-enemy-wraith-head') === 1, 'Wraith (Stalker) has sculpted humanoid head')
assert(countChildNames(stalkerMesh, 'maze-enemy-wraith-claw-hand-') === 2, 'Wraith (Stalker) has dual clawed hands')
assert(countChildNames(stalkerMesh, 'maze-enemy-wraith-mist-') === 3, 'Wraith (Stalker) dissolves into lower supernatural mist')
assert(countChildNames(stalkerMesh, 'maze-enemy-spine-') === 0, 'Wraith (Stalker) has no robotic dorsal spines')

updateEnemyVisualState(hunterMesh, ENEMY_STATES.CHASE)
assert(
  hunterMesh.userData.rig.sensorMesh.material.color.getHex() === hunterMesh.userData.typePalette.sensorChase,
  'updateEnemyVisualState adapts to archetype palette'
)

disposeEnemy(stalkerMesh)
disposeEnemy(hunterMesh)
disposeEnemy(bruteMesh)
console.log('✓ Distinct 3D models, silhouettes, and clean disposal verified')

// 3. Brute vs Stalker Combat Range, Damage & Attack Animation Differences
console.log('Test 3: Brute Long-Range High-Damage Attack & Distinct Animation')
const bruteAgent = new EnemyAgent('brute-combat', {
  maze: arenaMaze,
  type: ENEMY_TYPES.BRUTE,
  spawnCell: { row: 3, col: 3 },
})
const stalkerAgent = new EnemyAgent('stalker-combat', {
  maze: arenaMaze,
  type: ENEMY_TYPES.STALKER,
  spawnCell: { row: 3, col: 3 },
})

const originWorld = bruteAgent.getPosition()
// Place player 1.75m away — inside Brute attackRange (2.05m) but outside Stalker attackRange (1.35m)
const midRangePlayerPos = { x: originWorld.x + 1.75, y: 0, z: originWorld.z }
const midRangeCtx = {
  playerWorldPos: midRangePlayerPos,
  playerGridCell: { row: 3, col: 4 },
  playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
}

// Orient both toward +X (yaw = -PI/2)
bruteAgent.yaw = -Math.PI / 2
stalkerAgent.yaw = -Math.PI / 2

bruteAgent.update(0.05, midRangeCtx)
stalkerAgent.update(0.05, midRangeCtx)

assert(bruteAgent.getState() === ENEMY_STATES.ATTACK, 'Brute initiates attack from 1.75m range')
assert(stalkerAgent.getState() !== ENEMY_STATES.ATTACK, 'Stalker does NOT attack from 1.75m outside its 1.35m range')

// Advance Brute through strike delay to confirm 40 HP damage and symmetric overhead slam pose
let bruteHits = []
for (let i = 0; i < 12; i += 1) {
  const res = bruteAgent.update(0.05, midRangeCtx)
  if (res?.attackHit) bruteHits.push(res.attackHit)
}
assert(bruteHits.length === 1, 'Brute produces exactly one attack hit per swing')
assert(bruteHits[0].damage === 40, `Brute deals 40 damage (got ${bruteHits[0].damage})`)
assert(bruteHits[0].enemyType === ENEMY_TYPES.BRUTE, 'Attack hit tags enemyType as brute')

// Test Brute symmetric double-arm windup animation vs Hunter alternating cross-slash
const hunterAnim = new EnemyAgent('hunter-anim', { maze: arenaMaze, type: ENEMY_TYPES.HUNTER, spawnCell: { row: 3, col: 3 } })
bruteAgent.resetAttackState()
bruteAgent.state = ENEMY_STATES.ATTACK
bruteAgent.attackTimer = 0
bruteAgent._animateAttack(0.35)
const bRig = bruteAgent.mesh.userData.rig
assert(
  Math.abs(bRig.leftArmPivot.rotation.x - bRig.rightArmPivot.rotation.x) < 1e-4 &&
    bRig.leftArmPivot.rotation.x < -1.0,
  'Brute raises both arms symmetrically in overhead slam windup'
)

hunterAnim.state = ENEMY_STATES.ATTACK
hunterAnim._animateAttack(0.2)
const hRig = hunterAnim.mesh.userData.rig
assert(
  hRig.leftArmPivot.rotation.x < 0 && hRig.rightArmPivot.rotation.x > 0,
  'Hunter uses opposing twin-claw cross-slash windup'
)

bruteAgent.dispose()
stalkerAgent.dispose()
hunterAnim.dispose()
console.log('✓ Brute combat range/damage and archetype attack animations verified')

// 4. Hunter Acoustic Investigation & Hiding-Spot Search Intelligence
console.log('Test 4: Hunter Hearing & Hiding-Area Search Behavior')
const hunter = new EnemyAgent('hunter-scout', {
  maze: arenaMaze,
  type: ENEMY_TYPES.HUNTER,
  spawnCell: { row: 1, col: 1 },
  patrolRoute: [{ row: 3, col: 1 }, { row: 5, col: 1 }],
})
const bruteDeaf = new EnemyAgent('brute-scout', {
  maze: arenaMaze,
  type: ENEMY_TYPES.BRUTE,
  spawnCell: { row: 1, col: 1 },
  patrolRoute: [{ row: 3, col: 1 }, { row: 5, col: 1 }],
})

// Walk noise at ~6.4m away: within Hunter walk hearing (7.8m) but outside Brute (3.5m) and Stalker (4.5m)
const hStartPos = hunter.getPosition()
const distantWalkPos = { x: hStartPos.x + 6.4, y: 0, z: hStartPos.z }
const walkNoiseCtx = {
  playerWorldPos: distantWalkPos,
  playerGridCell: { row: 1, col: 4 },
  playerMotion: { moved: true, isSprinting: false, actualSpeed: 5.5 },
  hidingSpotCells: [
    { id: 'spot-near-1', row: 1, col: 5 },
    { id: 'spot-near-2', row: 3, col: 4 },
  ],
}

hunter.yaw = Math.PI / 2 // Facing away (-X) so vision is not used
bruteDeaf.yaw = Math.PI / 2

hunter.update(0.05, walkNoiseCtx)
bruteDeaf.update(0.05, walkNoiseCtx)

assert(
  hunter.getState() === ENEMY_STATES.INVESTIGATE,
  `Hunter hears distant walking footsteps and investigates (state: ${hunter.getState()})`
)
assert(
  bruteDeaf.getState() === ENEMY_STATES.PATROL,
  `Brute does not hear walking footsteps beyond its 3.5m range (state: ${bruteDeaf.getState()})`
)
assert(
  hunter._hidingSearchQueue.length === 2,
  `Hunter queues nearby hiding spot cells to sweep (queued: ${hunter._hidingSearchQueue.length})`
)

// Confirm Hunter advances to investigate target and sweeps hiding spots in SEARCH state
const stealthHidingCtx = {
  playerWorldPos: gridToWorld(1, 5, arenaMaze),
  playerGridCell: { row: 1, col: 5 },
  playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
  playerHidden: true,
  hidingSpotCells: [
    { id: 'spot-near-1', row: 1, col: 5 },
    { id: 'spot-near-2', row: 3, col: 4 },
  ],
}

let enteredSearch = false
for (let i = 0; i < 80; i += 1) {
  hunter.update(0.05, stealthHidingCtx)
  if (hunter.getState() === ENEMY_STATES.SEARCH) {
    enteredSearch = true
  }
  // Hunter must NEVER transition to CHASE or ATTACK while player is hidden!
  assert(
    hunter.getState() !== ENEMY_STATES.CHASE &&
      hunter.getState() !== ENEMY_STATES.ATTACK,
    'Hunter sweeping hiding spots does NOT auto-discover hidden player'
  )
}
assert(enteredSearch === true, 'Hunter transitioned from INVESTIGATE into SEARCH while sweeping hiding areas')

hunter.dispose()
bruteDeaf.dispose()
console.log('✓ Hunter acoustic sensitivity, hiding-area search, and stealth protection verified')

// 5. Stealth & Hiding Consistency Across ALL Enemy Archetypes
console.log('Test 5: Stealth Consistency Across Stalker, Hunter, and Brute')
for (const type of [ENEMY_TYPES.STALKER, ENEMY_TYPES.HUNTER, ENEMY_TYPES.BRUTE]) {
  const enemy = new EnemyAgent(`stealth-${type}`, {
    maze: arenaMaze,
    type,
    spawnCell: { row: 3, col: 3 },
  })
  const pos = enemy.getPosition()
  // Hidden player standing directly 0.8m in front inside unobstructed corridor
  const hiddenCtx = {
    playerWorldPos: { x: pos.x, y: 0, z: pos.z - 0.8 },
    playerGridCell: { row: 3, col: 3 },
    playerMotion: { moved: false, isSprinting: false, actualSpeed: 0 },
    playerHidden: true,
  }
  enemy.yaw = 0 // looking directly towards -Z at player

  for (let i = 0; i < 30; i += 1) {
    const res = enemy.update(0.05, hiddenCtx)
    assert(!res?.attackHit, `${type} cannot strike hidden player`)
    assert(
      enemy.getState() !== ENEMY_STATES.CHASE && enemy.getState() !== ENEMY_STATES.ATTACK,
      `${type} cannot detect hidden player via vision or proximity (state: ${enemy.getState()})`
    )
  }

  // Once player exits hiding spot in plain sight, enemy immediately perceives and engages
  const exposedCtx = { ...hiddenCtx, playerHidden: false }
  enemy.update(0.05, exposedCtx)
  assert(
    enemy.getState() === ENEMY_STATES.ATTACK || enemy.getState() === ENEMY_STATES.CHASE,
    `${type} detects player once no longer hidden (state: ${enemy.getState()})`
  )
  enemy.dispose()
}
console.log('✓ Stealth protection verified uniformly for Stalker, Hunter, and Brute')

// 6. Procedural Audio Cues Differ by Enemy Archetype
console.log('Test 6: Archetype-Specific Procedural Audio Cues')
const audioEngine = new HorrorAudioEngine({
  createAudioContext: () => createMockAudioContext(),
  autoUnlock: true,
  recordCueHistory: true,
})
audioEngine.setMaze(arenaMaze)
const sAudio = new EnemyAgent('s-aud', { maze: arenaMaze, type: ENEMY_TYPES.STALKER, spawnCell: { row: 1, col: 2 } })
const hAudio = new EnemyAgent('h-aud', { maze: arenaMaze, type: ENEMY_TYPES.HUNTER, spawnCell: { row: 1, col: 3 } })
const bAudio = new EnemyAgent('b-aud', { maze: arenaMaze, type: ENEMY_TYPES.BRUTE, spawnCell: { row: 1, col: 4 } })

// Patrol footsteps over 1.2s: Hunter (0.42s) > Stalker (0.56s) > Brute (0.78s)
for (let i = 0; i < 12; i += 1) {
  audioEngine.update(0.1, {
    playerWorldPos: gridToWorld(1, 3, arenaMaze),
    enemies: [sAudio, hAudio, bAudio],
  })
}
const history = audioEngine.getCueHistory()
const stepCounts = { stalker: 0, hunter: 0, brute: 0 }
for (const cue of history) {
  if (cue.type === 'enemy_footstep' && cue.enemyType in stepCounts) {
    stepCounts[cue.enemyType] += 1
  }
}
assert(
  stepCounts.hunter >= stepCounts.stalker && stepCounts.stalker >= stepCounts.brute && stepCounts.brute >= 1,
  `Step cadence differs by archetype (hunter=${stepCounts.hunter}, stalker=${stepCounts.stalker}, brute=${stepCounts.brute})`
)

// Trigger archetype chase alerts & attack hit
sAudio.state = ENEMY_STATES.CHASE
hAudio.state = ENEMY_STATES.CHASE
bAudio.state = ENEMY_STATES.ATTACK
audioEngine.update(0.05, {
  playerWorldPos: gridToWorld(1, 3, arenaMaze),
  enemies: [sAudio, hAudio, bAudio],
  attackHits: [{ enemyId: bAudio.id, enemyType: ENEMY_TYPES.BRUTE, damage: 40, position: bAudio.worldPos }],
})

const afterCues = audioEngine.getCueHistory()
assert(
  afterCues.some((c) => c.type === 'enemy_detect_chase' && c.enemyType === 'hunter'),
  'Records hunter chase alert cue'
)
assert(
  afterCues.some((c) => c.type === 'enemy_attack_hit' && c.enemyType === 'brute'),
  'Records brute attack impact cue'
)

sAudio.dispose()
hAudio.dispose()
bAudio.dispose()
audioEngine.dispose()
console.log('✓ Procedural audio footsteps, alerts, and impacts verified per archetype')

// 7. Deterministic Multi-Archetype Seeded Placement & Difficulty Scaling
console.log('Test 7: Deterministic Seeded Multi-Archetype Placement & Difficulty Scaling')
const easyA = generateMaze({ difficulty: 'easy', seed: 919191 })
const medA = generateMaze({ difficulty: 'medium', seed: 552233 })
const medB = generateMaze({ difficulty: 'medium', seed: 552233 })
const medDiff = generateMaze({ difficulty: 'medium', seed: 998877 })
const hardA = generateMaze({ difficulty: 'hard', seed: 121212 })
const hardcoreA = generateMaze({ difficulty: 'hardcore', seed: 343434 })

const placedEasy = placeEnemies(easyA)
const placedMedA = placeEnemies(medA)
const placedMedB = placeEnemies(medB)
const placedMedDiff = placeEnemies(medDiff)
const placedHard = placeEnemies(hardA)
const placedHardcore = placeEnemies(hardcoreA)

assert(placedEasy.length === 2, 'Easy difficulty places 2 enemies')
assert(placedMedA.length === 3, 'Medium difficulty places 3 enemies')
assert(placedHard.length === 5, 'Hard difficulty places 5 enemies')
assert(placedHardcore.length === 7, 'Hardcore difficulty places 7 enemies')
assert(
  JSON.stringify(placedMedA) === JSON.stringify(placedMedB),
  'Identical maze seeds yield identical enemy placements and patrol routes'
)
assert(
  JSON.stringify(placedMedA) !== JSON.stringify(placedMedDiff),
  'Different seeds yield different enemy placements'
)

const medTypes = new Set(placedMedA.map((p) => p.type))
assert(
  medTypes.has(ENEMY_TYPES.STALKER) &&
    medTypes.has(ENEMY_TYPES.HUNTER) &&
    medTypes.has(ENEMY_TYPES.BRUTE),
  'Medium maze contains Stalker, Hunter, and Brute archetypes together'
)

const hardTypes = new Set(placedHard.map((p) => p.type))
assert(
  hardTypes.has(ENEMY_TYPES.STALKER) &&
    hardTypes.has(ENEMY_TYPES.HUNTER) &&
    hardTypes.has(ENEMY_TYPES.BRUTE),
  'Hard maze contains all 3 enemy archetypes'
)

const hardcoreTypes = new Set(placedHardcore.map((p) => p.type))
assert(
  hardcoreTypes.has(ENEMY_TYPES.STALKER) &&
    hardcoreTypes.has(ENEMY_TYPES.HUNTER) &&
    hardcoreTypes.has(ENEMY_TYPES.BRUTE),
  'Hardcore 31x31 maze contains all 3 enemy archetypes'
)

// Difficulty scaling checks: Easy softer, Medium baseline, Hard & Hardcore faster/sharper yet outrunnable
const easyStalker = getEnemyArchetypeConfig(ENEMY_TYPES.STALKER, 'easy')
const medStalker = getEnemyArchetypeConfig(ENEMY_TYPES.STALKER, 'medium')
const hardcoreStalker = getEnemyArchetypeConfig(ENEMY_TYPES.STALKER, 'hardcore')
assert(
  ENEMY_DIFFICULTY_SCALING.hardcore.chaseSpeed > 1 &&
    easyStalker.chaseSpeed < medStalker.chaseSpeed &&
    hardcoreStalker.chaseSpeed > medStalker.chaseSpeed,
  'Enemy chase speed scales upward from Easy -> Medium -> Hardcore'
)
assert(
  hardcoreStalker.visionRange > easyStalker.visionRange &&
    hardcoreStalker.detectionDelay < easyStalker.detectionDelay,
  'Hardcore enemy senses detect faster and farther than Easy'
)
assert(
  hardcoreStalker.chaseSpeed < 9.0,
  `Hardcore fastest enemy chase (${hardcoreStalker.chaseSpeed}) stays slower than player sprint (9.0 m/s)`
)

for (const [label, maze, list] of [
  ['easy', easyA, placedEasy],
  ['medium', medA, placedMedA],
  ['hard', hardA, placedHard],
  ['hardcore', hardcoreA, placedHardcore],
]) {
  const seenCoords = new Set()
  for (const p of list) {
    assert(
      maze.grid[p.spawnCell.row]?.[p.spawnCell.col] === CELL_TYPES.PATH,
      `${label} ${p.id} spawns on walkable path`
    )
    assert(
      !(p.spawnCell.row === maze.start.row && p.spawnCell.col === maze.start.col),
      `${label} ${p.id} never spawns on player start cell`
    )
    const key = `${p.spawnCell.row},${p.spawnCell.col}`
    assert(!seenCoords.has(key), `${label} spawns do not overlap at (${key})`)
    seenCoords.add(key)

    const path = findShortestPath(maze.grid, maze.start, p.spawnCell)
    assert(path.found === true, `${label} ${p.id} spawn cell is reachable from start`)
  }
}
console.log('✓ Deterministic multi-archetype placement, difficulty scaling, and walkability verified')

// 8. EnemyManager, MazeSceneEngine, Health/Immunity, Reset & Disposal Integration
console.log('Test 8: EnemyManager & Scene Engine Lifecycle, Immunity & Disposal')
const directMgr = new EnemyManager(null, { autoSpawn: true })
directMgr.setMaze(medA)
assert(directMgr.getEnemies().length === 3, 'EnemyManager spawns 3 archetypes on medium maze')
directMgr.dispose()
assert(directMgr.isDisposed === true, 'Direct EnemyManager disposes cleanly')

const engine = createHeadlessEngine()
engine.setMaze(medA)
const spawned = engine.getEnemies()
assert(spawned.length === 3, `MazeSceneEngine spawned 3 multi-type enemies (got ${spawned.length})`)
const spawnedTypes = new Set(spawned.map((e) => e.getType()))
assert(spawnedTypes.size === 3, 'All 3 enemy archetypes active simultaneously in scene engine')

for (const enemy of spawned) {
  const c = enemy.getGridCell()
  assert(c && isCellWalkable(c.row, c.col, medA), `Active ${enemy.id} is on walkable cell`)
}

// Verify Brute damage + immunity window integration via MazeSceneEngine.applyDamage
const hitApplied1 = engine.applyDamage(ENEMY_ARCHETYPES.brute.attackDamage, {
  enemyId: 'brute-1',
  enemyType: ENEMY_TYPES.BRUTE,
})
assert(hitApplied1 === true, 'Brute attack hit applied cleanly')
assert(engine.getHealth().health === 60, `Player health reduced by 40 to 60 HP (got ${engine.getHealth().health})`)
assert(engine.getHealth().isImmune === true, 'Damage immunity active after Brute strike')

const blockedDuplicate = engine.applyDamage(ENEMY_ARCHETYPES.stalker.attackDamage, {
  enemyId: 'stalker-1',
  enemyType: ENEMY_TYPES.STALKER,
})
assert(blockedDuplicate === false, 'Duplicate hit during immunity window blocked')
assert(engine.getHealth().health === 60, 'Health preserved during immunity window')

// Game-over trigger from high damage
engine.damageImmunityTimer = 0
engine.applyDamage(40, { enemyId: 'brute-1', enemyType: ENEMY_TYPES.BRUTE })
engine.damageImmunityTimer = 0
engine.applyDamage(40, { enemyId: 'brute-1', enemyType: ENEMY_TYPES.BRUTE })
assert(engine.getHealth().health === 0 && engine.getHealth().isGameOver === true, 'Game over reached at 0 HP without negative health')

// Reset combat restores health & resets all enemy states
engine.resetCombat()
assert(engine.getHealth().health === 100 && engine.getHealth().isGameOver === false, 'resetCombat restores health and clears game over')
for (const enemy of engine.getEnemies()) {
  assert(enemy.getState() === ENEMY_STATES.PATROL, `resetCombat restores ${enemy.id} to PATROL`)
}

// Replace maze cleanly across Hardcore (31x31) and Easy (11x11)
engine.setMaze(hardcoreA)
assert(engine.getEnemies().length === 7, 'Replacing maze spawns 7 scaled enemies for Hardcore 31x31 maze')
assert(
  engine.getEnemies().find((e) => e.getType() === ENEMY_TYPES.STALKER)?.config.chaseSpeed === hardcoreStalker.chaseSpeed,
  'EnemyAgent applies Hardcore difficulty scaling inside scene engine'
)
engine.setMaze(easyA)
assert(engine.getEnemies().length === 2, 'Replacing maze replaces enemy roster cleanly (2 for easy maze)')

// Full disposal check
const sceneRef = engine.scene
engine.dispose()
assert(engine.isDisposed === true, 'MazeSceneEngine disposed cleanly')
assert(engine.getEnemies().length === 0, 'No enemies remain after MazeSceneEngine dispose')
assert(sceneRef.children.length === 0, 'Scene children cleared cleanly on dispose')

console.log('ALL ENEMY ARCHETYPE TESTS PASSED SUCCESSFULLY!')
