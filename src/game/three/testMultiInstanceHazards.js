import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  HAZARD_TYPES,
  STANDARD_HAZARD_COUNT,
  STANDARD_HAZARD_TYPES,
  placeHazards,
  resolveFloorGrateCutouts,
  resolveWallCollapseMount,
  validateHazardPlacement,
} from '../generation/hazardPlacement.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  getDynamicCollider,
} from '../world/propCollision.js'
import { HAZARD_CONFIG, HAZARD_STATES, HazardAgent } from './HazardAgent.js'
import { HazardManager } from './HazardManager.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { getHazardPoolStats } from './buildHazards.js'

console.log('--- RUNNING MULTI-INSTANCE HAZARD PLACEMENT & LIFECYCLE TESTS ---')

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
    skipSpawnSequence: true,
    ...config,
  })
}

const W = CELL_TYPES.WALL
const P = CELL_TYPES.PATH

// Controlled asymmetric maze featuring:
// - straight wall-flanked corridors (row 1, cols 2..4; col 1, rows 2..4)
// - open 4-way intersection with ZERO adjacent walls at (4, 4)
// - open 3x3 chamber (rows 3..5, cols 3..5)
// - isolated unreachable/walled-in walkable cell at (1, 6) for directional rejection tests
const validationMaze = {
  id: 'multi-hazard-validation-maze',
  seed: 919293,
  rows: 7,
  cols: 8,
  start: { row: 1, col: 1 },
  exit: { row: 5, col: 6 },
  grid: [
    [W, W, W, W, W, W, W, W],
    [W, P, P, P, P, W, P, W],
    [W, P, W, W, P, W, W, W],
    [W, P, W, P, P, P, P, W],
    [W, P, P, P, P, P, P, W],
    [W, P, W, P, P, P, P, W],
    [W, W, W, W, W, W, W, W],
  ],
}

// ============================================================================
// 1. Default behavior unchanged: 10 standard hazards, deterministic, 1 of each
// ============================================================================
console.log('Test 1: Default placeHazards Behavior Preserved Unchanged')
{
  const m1 = generateMaze({ seed: 246810 })
  const m2 = generateMaze({ seed: 246810 })
  const h1 = placeHazards(m1)
  const h2 = placeHazards(m2)

  assert.equal(h1.length, STANDARD_HAZARD_COUNT, 'Default placeHazards still produces 10 hazards')
  assert.deepEqual(h1, h2, 'Default placement remains deterministic')
  const seenTypes = new Set(h1.map((h) => h.type))
  for (const t of STANDARD_HAZARD_TYPES) {
    assert.equal(seenTypes.has(t), true, `Default placement still includes ${t}`)
  }
}
console.log('✓ Default hazard count and type-selection behavior unchanged')

// ============================================================================
// 2. Multiple instances of every hazard type placed cleanly with unique IDs
// ============================================================================
console.log('Test 2: Multiple Instances of Each Hazard Type & Unique IDs')
{
  const mediumMaze = generateMaze({ seed: 135791, level: 8 })
  for (const hazardType of Object.values(HAZARD_TYPES)) {
    const requested = [hazardType, hazardType, hazardType, hazardType]
    const placedA = placeHazards(mediumMaze, { hazardTypes: requested })
    const placedB = placeHazards(mediumMaze, { hazardTypes: requested })

    assert.equal(
      placedA.length,
      4,
      `Places all 4 instances of ${hazardType} in a medium maze (got ${placedA.length})`
    )
    assert.deepEqual(placedA, placedB, `Multi-instance placement of ${hazardType} is deterministic`)

    const idSet = new Set(placedA.map((h) => h.id))
    const coordSet = new Set(placedA.map((h) => `${h.row},${h.col}`))
    assert.equal(idSet.size, 4, `All 4 ${hazardType} instances have unique IDs`)
    assert.equal(coordSet.size, 4, `All 4 ${hazardType} instances occupy unique cells`)

    for (const spec of placedA) {
      assert.equal(spec.type, hazardType, `Spec records exact type ${hazardType}`)
      const v = validateHazardPlacement(mediumMaze, spec, { allowStartExit: false })
      assert.equal(
        v.valid,
        true,
        `${hazardType} instance ${spec.id} at (${spec.row},${spec.col}) passes validation (${v.reason})`
      )
      if (
        hazardType === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE ||
        hazardType === HAZARD_TYPES.WALL_COLLAPSE
      ) {
        assert.equal(
          mediumMaze.grid[spec.wallRow]?.[spec.wallCol],
          CELL_TYPES.WALL,
          `All ${hazardType} instances mount to solid walls (fixing types.indexOf bug)`
        )
      }
      if (
        hazardType === HAZARD_TYPES.FALLING_WATER_TANK ||
        hazardType === HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY ||
        hazardType === HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE
      ) {
        const dir = spec.flowDir || spec.swingDir || spec.dropDir
        assert.equal(
          mediumMaze.grid[spec.row + dir.z]?.[spec.col + dir.x],
          CELL_TYPES.PATH,
          `All ${hazardType} instances orient toward walkable PATH cells`
        )
      }
    }
  }

  // Mixed duplicate batch combining multiple wall, dual, floor, and ceiling hazards
  const mixedBatch = [
    HAZARD_TYPES.WALL_COLLAPSE,
    HAZARD_TYPES.WALL_COLLAPSE,
    HAZARD_TYPES.WALL_COLLAPSE,
    HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    HAZARD_TYPES.STEAM_PIPE_BURST,
    HAZARD_TYPES.STEAM_PIPE_BURST,
    HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
    HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
    HAZARD_TYPES.CEILING_COLLAPSE,
    HAZARD_TYPES.CEILING_COLLAPSE,
  ]
  const mixedPlaced = placeHazards(mediumMaze, { types: mixedBatch })
  assert.equal(mixedPlaced.length, mixedBatch.length, 'Placed full mixed duplicate batch')
  assert.equal(
    new Set(mixedPlaced.map((h) => h.id)).size,
    mixedBatch.length,
    'Every instance in mixed duplicate batch has a unique ID'
  )
  assert.equal(
    new Set(mixedPlaced.map((h) => `${h.row},${h.col}`)).size,
    mixedBatch.length,
    'Every instance in mixed duplicate batch occupies a distinct cell'
  )

  // Floor grate cutouts handle multiple COLLAPSING_FLOOR_GRATE hazards without overlap
  const cutouts = resolveFloorGrateCutouts(mediumMaze, {
    hazards: mixedPlaced,
    decoys: [],
  })
  const grateHazards = mixedPlaced.filter((h) => h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE)
  assert.equal(cutouts.length, grateHazards.length, 'Cutout generated for each floor grate instance')
}
console.log('✓ Multiple instances of every hazard type placed with unique IDs and validated mounts')

// ============================================================================
// 3. Per-category mounting constraints & individual invalid rejection
// ============================================================================
console.log('Test 3: Per-Category Placement Constraints & Individual Rejection')
{
  // (4,4) has 0 adjacent walls; (1,3) has walls N+S; (4,2) has walls N+S; (1,6) has 0 open paths
  // A. Wall-mounted constraints (WALL_COLLAPSE, ROTTEN_FURNITURE_COLLAPSE)
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.WALL_COLLAPSE,
      row: 4,
      col: 4,
    }).valid,
    false,
    'WALL_COLLAPSE rejected at open 4-way cell (4,4) with no adjacent wall'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.WALL_COLLAPSE,
      row: 1,
      col: 3,
      wallSide: 'west', // (1,2) is PATH, not WALL
    }).valid,
    false,
    'WALL_COLLAPSE rejected when explicit wallSide points at open PATH'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
      row: 4,
      col: 4,
    }).valid,
    false,
    'ROTTEN_FURNITURE_COLLAPSE rejected at open 4-way cell (4,4) with no adjacent wall'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
      row: 1,
      col: 3,
      wallSide: 'north',
    }).valid,
    true,
    'ROTTEN_FURNITURE_COLLAPSE valid when explicit wallSide targets solid WALL'
  )

  // B. Dual wall/ceiling constraints (STEAM_PIPE_BURST, EXPOSED_ELECTRICAL_WIRING, FALLING_PIPES_FIXTURES)
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.STEAM_PIPE_BURST,
      row: 4,
      col: 4,
      mountType: 'wall',
    }).valid,
    false,
    'STEAM_PIPE_BURST wall mount rejected where no adjacent wall exists'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.STEAM_PIPE_BURST,
      row: 4,
      col: 4,
      mountType: 'ceiling',
    }).valid,
    true,
    'STEAM_PIPE_BURST ceiling mount valid at open 4-way intersection'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 4,
      col: 4,
      mountType: 'wall',
    }).valid,
    false,
    'EXPOSED_ELECTRICAL_WIRING wall mount rejected without adjacent wall'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 4,
      col: 4,
      mountType: 'ceiling',
    }).valid,
    true,
    'EXPOSED_ELECTRICAL_WIRING ceiling mount valid at open intersection'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 3,
      col: 3, // has N wall and W wall, NOT opposite pair
      mountType: 'wall',
    }).valid,
    false,
    'FALLING_PIPES_FIXTURES wall mount rejected when opposite flanking walls are absent'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
      row: 1,
      col: 3, // N and S walls both exist
      mountType: 'wall',
    }).valid,
    true,
    'FALLING_PIPES_FIXTURES wall mount valid across straight N/S-walled corridor'
  )

  // C. Floor-mounted constraints (COLLAPSING_FLOOR_GRATE)
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
      row: 2,
      col: 2, // solid WALL
    }).valid,
    false,
    'COLLAPSING_FLOOR_GRATE rejected on solid wall tile'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
      row: 1,
      col: 3,
      localPitOffset: { x: 1.8, y: 0, z: 0 },
    }).valid,
    false,
    'COLLAPSING_FLOOR_GRATE rejected when pit offset overflows cell boundary'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
      row: 4,
      col: 4,
    }).valid,
    true,
    'COLLAPSING_FLOOR_GRATE valid on walkable tile within cell bounds'
  )

  // D. Ceiling / directional constraints (CEILING_COLLAPSE, WATER_TANK, MACHINERY, DUCT)
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.CEILING_COLLAPSE,
      row: 1,
      col: 3,
      localPatchOffset: { x: 2.5, y: 3.6, z: 0 },
    }).valid,
    false,
    'CEILING_COLLAPSE rejected when patch offset exits cell bounds'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.FALLING_WATER_TANK,
      row: 1,
      col: 6, // walled in on all 4 sides
    }).valid,
    false,
    'FALLING_WATER_TANK rejected when cell has zero open corridor directions'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.FALLING_WATER_TANK,
      row: 1,
      col: 3,
      flowSide: 'north', // wall at (0,3)
    }).valid,
    false,
    'FALLING_WATER_TANK rejected when explicit flowSide aims into a wall'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY,
      row: 1,
      col: 3,
      swingSide: 'north',
    }).valid,
    false,
    'FALLING_SUSPENDED_MACHINERY rejected when explicit swingSide aims into a wall'
  )
  assert.equal(
    validateHazardPlacement(validationMaze, {
      type: HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE,
      row: 1,
      col: 3,
      dropSide: 'south',
    }).valid,
    false,
    'VENTILATION_DUCT_COLLAPSE rejected when explicit dropSide aims into a wall'
  )

  // E. Mixed explicit placements: invalid instances rejected individually WITHOUT dropping valid same-type siblings
  const explicitPlaced = placeHazards(validationMaze, {
    placements: [
      { id: 'dup-id', type: HAZARD_TYPES.WALL_COLLAPSE, row: 1, col: 3, wallSide: 'north' }, // VALID
      { type: HAZARD_TYPES.WALL_COLLAPSE, row: 4, col: 4 }, // INVALID: 0 adjacent walls
      { type: HAZARD_TYPES.WALL_COLLAPSE, row: 1, col: 2, wallSide: 'west' }, // INVALID: west is PATH
      { id: 'dup-id', type: HAZARD_TYPES.WALL_COLLAPSE, row: 3, col: 1, wallSide: 'west' }, // VALID (same type + collided id deduplicated)
      { type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE, row: 1, col: 1 }, // INVALID: start cell
      { type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE, row: 4, col: 4 }, // INVALID: open 4-way
      { type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE, row: 5, col: 1 }, // VALID
      { type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE, row: 5, col: 3 }, // VALID
      { type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 5, col: 3 }, // INVALID: cell already occupied!
      { type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 4, col: 5 }, // VALID
      { type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 3, col: 5 }, // VALID
      { type: HAZARD_TYPES.FALLING_WATER_TANK, row: 1, col: 4, flowSide: 'east' }, // INVALID: east wall
      { type: HAZARD_TYPES.FALLING_WATER_TANK, row: 4, col: 2, flowSide: 'east' }, // VALID
      { type: HAZARD_TYPES.FALLING_WATER_TANK, row: 3, col: 4, flowSide: 'south' }, // VALID
    ],
  })

  assert.equal(explicitPlaced.length, 8, `Expected exactly 8 valid specs kept, got ${explicitPlaced.length}`)
  const validWalls = explicitPlaced.filter((h) => h.type === HAZARD_TYPES.WALL_COLLAPSE)
  const validFurn = explicitPlaced.filter((h) => h.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE)
  const validGrates = explicitPlaced.filter((h) => h.type === HAZARD_TYPES.COLLAPSING_FLOOR_GRATE)
  const validTanks = explicitPlaced.filter((h) => h.type === HAZARD_TYPES.FALLING_WATER_TANK)
  assert.equal(validWalls.length, 2, '2 valid WALL_COLLAPSE kept despite 2 invalid siblings')
  assert.equal(validFurn.length, 2, '2 valid ROTTEN_FURNITURE_COLLAPSE kept despite 2 invalid siblings')
  assert.equal(validGrates.length, 2, '2 valid COLLAPSING_FLOOR_GRATE kept despite 1 occupied sibling')
  assert.equal(validTanks.length, 2, '2 valid FALLING_WATER_TANK kept despite 1 wall-blocked sibling')
  assert.equal(new Set(explicitPlaced.map((h) => h.id)).size, 8, 'Duplicate explicit IDs deduplicated cleanly')

  // F. Impossible mount scarcity in open-chamber grid with 0 interior walls
  const openRoomMaze = {
    id: 'open-chamber-room',
    seed: 1212,
    rows: 9,
    cols: 9,
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 7 },
    grid: [
      [W, W, W, W, W, W, W, W, W],
      [W, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, W],
      [W, P, P, P, P, P, P, P, W],
      [W, W, W, W, W, W, W, W, W],
    ],
  }
  // Every cell bordering perimeter has a boundary wall; center 5x5 cells (25 cells) have 0 walls.
  // Total walkable cells at manhattan>=3 = 49 - 6 (start corner) - 1 (exit) = 42, only 20 border walls!
  // Requesting 30 WALL_COLLAPSE instances must place ONLY the wall-adjacent ones & reject the rest individually!
  const wallOverRequest = placeHazards(openRoomMaze, {
    hazardTypes: Array(30).fill(HAZARD_TYPES.WALL_COLLAPSE),
  })
  assert.ok(
    wallOverRequest.length > 0 && wallOverRequest.length < 30,
    `Places only wall-adjacent WALL_COLLAPSE instances and rejects open-floor excesses (placed ${wallOverRequest.length})`
  )
  for (const spec of wallOverRequest) {
    assert.ok(resolveWallCollapseMount(openRoomMaze.grid, spec.row, spec.col) !== null)
    assert.equal(openRoomMaze.grid[spec.wallRow][spec.wallCol], CELL_TYPES.WALL)
  }
}
console.log('✓ Per-category placement constraints and individual invalid rejections verified')

// ============================================================================
// 4. Independent runtime state, colliders, interaction, audio & rendering for same-type hazards
// ============================================================================
console.log('Test 4: Independent Runtime State, Colliders, Interaction, Audio & 3D Meshes')
{
  // Omitted IDs in HazardAgent & duplicate IDs in HazardManager.setMaze
  const noIdA = new HazardAgent({ type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 1, col: 2 }, validationMaze)
  const noIdB = new HazardAgent({ type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 1, col: 3 }, validationMaze)
  assert.notEqual(noIdA.id, noIdB.id, 'Omitted HazardAgent spec IDs produce unique IDs')
  noIdA.dispose()
  noIdB.dispose()

  const dupScene = new THREE.Scene()
  const dupManager = new HazardManager(dupScene)
  dupManager.setMaze(validationMaze, {
    hazards: [
      { id: 'same-id', type: HAZARD_TYPES.WALL_COLLAPSE, row: 1, col: 3, wallSide: 'north' },
      { id: 'same-id', type: HAZARD_TYPES.WALL_COLLAPSE, row: 1, col: 4, wallSide: 'north' },
    ],
  })
  assert.equal(dupManager.getHazards().length, 2, 'HazardManager preserves both hazards on duplicate ID input')
  assert.notEqual(
    dupManager.getHazards()[0].id,
    dupManager.getHazards()[1].id,
    'HazardManager assigns distinct IDs in map'
  )
  dupManager.dispose()

  // Full engine integration with pairs of same-type hazards across categories
  const engine = createHeadlessEngine({ enemies: { autoSpawn: false }, initialHealth: 100 })
  const damageEvents = []
  engine._onPlayerDamage = (ev) => damageEvents.push(ev)

  const multiSpecs = placeHazards(validationMaze, {
    placements: [
      { id: 'steam-a', type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 1, col: 2, wallSide: 'north' },
      { id: 'steam-b', type: HAZARD_TYPES.STEAM_PIPE_BURST, row: 1, col: 4, wallSide: 'north' },
      { id: 'wall-a', type: HAZARD_TYPES.WALL_COLLAPSE, row: 5, col: 1, wallSide: 'west' },
      { id: 'wall-b', type: HAZARD_TYPES.WALL_COLLAPSE, row: 3, col: 1, wallSide: 'west' },
      { id: 'grate-a', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 4, col: 4 },
      { id: 'grate-b', type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 4, col: 5 },
      { id: 'tank-a', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 5, col: 3, flowSide: 'east' },
      { id: 'tank-b', type: HAZARD_TYPES.FALLING_WATER_TANK, row: 5, col: 4, flowSide: 'east' },
    ],
  })
  assert.equal(multiSpecs.length, 8, 'All 8 paired same-type hazards validated and placed')

  engine.setMaze({ ...validationMaze, hazards: undefined })
  engine.hazardManager.setMaze(validationMaze, { hazards: multiSpecs })
  engine.syncHazardColliders({ allowPushOut: false })

  const steamA = engine.hazardManager.getHazard('steam-a')
  const steamB = engine.hazardManager.getHazard('steam-b')
  const wallA = engine.hazardManager.getHazard('wall-a')
  const wallB = engine.hazardManager.getHazard('wall-b')
  const grateA = engine.hazardManager.getHazard('grate-a')
  const grateB = engine.hazardManager.getHazard('grate-b')
  const tankA = engine.hazardManager.getHazard('tank-a')
  const tankB = engine.hazardManager.getHazard('tank-b')

  assert.ok(steamA && steamB && wallA && wallB && grateA && grateB && tankA && tankB)
  assert.notEqual(steamA.mesh, steamB.mesh, 'Each same-type hazard owns its own 3D mesh group')

  // Setup spatial audio tracker
  const audioEngine = new HorrorAudioEngine({
    volumes: { master: 0, effects: 0, ambience: 0, music: 0, muted: true },
    debugHistory: true,
  })
  audioEngine._debugHistoryEnabled = true
  audioEngine.setMaze(validationMaze)
  audioEngine.setAudioOptions({ subtitles: true })

  // Baseline dormant tick so _hazardStateMap records initial DORMANT state per hazard ID
  const farPlayerPos = gridToWorld(4, 4, validationMaze)
  audioEngine.update(0.016, {
    playerWorldPos: farPlayerPos,
    hazards: engine.hazardManager.getHazards(),
  })

  // A. Trigger ONLY steam-a while steam-b stays completely DORMANT
  const steamACenter = steamA.getDangerArea().center
  const steamADangerZ = steamACenter.z
  const resA1 = engine.hazardManager.update(0.05, {
    playerWorldPos: { x: steamACenter.x, y: 0, z: steamADangerZ },
    playerGridCell: { row: steamA.row, col: steamA.col },
  })
  assert.equal(resA1.hazardHits.length, 0, 'steam-a WARNING deals no immediate damage')
  assert.equal(steamA.getState(), HAZARD_STATES.WARNING, 'steam-a enters WARNING')
  assert.equal(steamB.getState(), HAZARD_STATES.DORMANT, 'steam-b remains DORMANT independently')

  audioEngine.update(0.016, {
    playerWorldPos: { x: steamACenter.x, y: 0, z: steamADangerZ },
    hazards: engine.hazardManager.getHazards(),
  })
  audioEngine.update(0.016, {
    playerWorldPos: { x: steamACenter.x, y: 0, z: steamADangerZ },
    hazards: engine.hazardManager.getHazards(),
  })

  // Advance steam-a to ACTIVE & deal hit; steam-b still DORMANT
  const steamCfg = HAZARD_CONFIG[HAZARD_TYPES.STEAM_PIPE_BURST]
  const resA2 = engine.hazardManager.update(steamCfg.warningDuration + 0.05, {
    playerWorldPos: { x: steamACenter.x, y: 0, z: steamADangerZ },
    playerGridCell: { row: steamA.row, col: steamA.col },
  })
  assert.equal(steamA.getState(), HAZARD_STATES.ACTIVE, 'steam-a transitions to ACTIVE')
  assert.equal(steamB.getState(), HAZARD_STATES.DORMANT, 'steam-b still DORMANT when steam-a is ACTIVE')
  assert.equal(resA2.hazardHits.length, 1, 'steam-a emits hit')
  assert.equal(resA2.hazardHits[0].hazardId, 'steam-a', 'Hit records exact steam-a hazardId')
  engine.applyDamage(resA2.hazardHits[0].damage, {
    hazardId: resA2.hazardHits[0].hazardId,
    hazardType: resA2.hazardHits[0].type,
  })
  assert.equal(damageEvents[damageEvents.length - 1].hazardId, 'steam-a')

  audioEngine.update(0.016, {
    playerWorldPos: { x: steamACenter.x, y: 0, z: steamADangerZ },
    hazards: engine.hazardManager.getHazards(),
  })

  // Now independently trigger steam-b!
  const steamBCenter = steamB.getDangerArea().center
  engine.hazardManager.update(0.05, {
    playerWorldPos: { x: steamBCenter.x, y: 0, z: steamBCenter.z },
    playerGridCell: { row: steamB.row, col: steamB.col },
  })
  assert.equal(steamB.getState(), HAZARD_STATES.WARNING, 'steam-b triggers independently')
  audioEngine.update(0.016, {
    playerWorldPos: { x: steamBCenter.x, y: 0, z: steamBCenter.z },
    hazards: engine.hazardManager.getHazards(),
  })
  const cueHistory = audioEngine.getCueHistory()
  assert.ok(
    cueHistory.some((c) => c.hazardId === 'steam-a' && c.type === 'hazard_steam_pipe_burst_warning'),
    'Audio cue recorded for steam-a warning'
  )
  assert.ok(
    cueHistory.some((c) => c.hazardId === 'steam-a' && c.type === 'hazard_steam_pipe_burst_active'),
    'Audio cue recorded for steam-a active'
  )
  assert.ok(
    cueHistory.some((c) => c.hazardId === 'steam-b' && c.type === 'hazard_steam_pipe_burst_warning'),
    'Audio cue recorded independently for steam-b warning'
  )

  // Seal ONLY steam-a; steam-b transitions cleanly to ACTIVE without interference
  const sealAnchorA = steamA.getInteractionAnchor()
  const sealRes = engine.hazardManager.interactWithHazard(null, {
    playerWorldPos: sealAnchorA,
    playerGridCell: { row: steamA.row, col: steamA.col },
  })
  assert.equal(sealRes.handled, true)
  assert.equal(sealRes.hazard.id, 'steam-a', 'Interaction targets nearest steam-a instance')
  assert.equal(steamA.getState(), HAZARD_STATES.DISABLED, 'steam-a neutralized')
  assert.equal(steamB.getState(), HAZARD_STATES.WARNING, 'steam-b unaffected by neutralizing steam-a')

  // B. Collapse BOTH wall-a & wall-b independently, verify separate dynamic colliders & aftermath clearing
  const farPos = gridToWorld(4, 4, validationMaze)
  const wallCfg = HAZARD_CONFIG[HAZARD_TYPES.WALL_COLLAPSE]
  const wallAPos = wallA.getDangerArea().center
  const wallBPos = wallB.getDangerArea().center

  wallA.update(0.05, { playerWorldPos: wallAPos, playerGridCell: { row: wallA.row, col: wallA.col } })
  wallA.update(wallCfg.warningDuration + 0.05, {
    playerWorldPos: farPos,
    playerGridCell: { row: 4, col: 4 },
  })
  wallA.update(wallCfg.activeDuration + 0.05, {
    playerWorldPos: farPos,
    playerGridCell: { row: 4, col: 4 },
  })
  assert.equal(wallA.getState(), HAZARD_STATES.DISABLED)
  assert.equal(wallB.getState(), HAZARD_STATES.DORMANT, 'wall-b stays dormant until triggered')

  wallB.update(0.05, { playerWorldPos: wallBPos, playerGridCell: { row: wallB.row, col: wallB.col } })
  wallB.update(wallCfg.warningDuration + 0.05, {
    playerWorldPos: farPos,
    playerGridCell: { row: 4, col: 4 },
  })
  wallB.update(wallCfg.activeDuration + 0.05, {
    playerWorldPos: farPos,
    playerGridCell: { row: 4, col: 4 },
  })
  assert.equal(wallB.getState(), HAZARD_STATES.DISABLED)

  engine.syncHazardColliders({ allowPushOut: false })
  const colWallA = getDynamicCollider(engine._propCollisionIndex, 'wall-a:aftermath-rubble')
  const colWallB = getDynamicCollider(engine._propCollisionIndex, 'wall-b:aftermath-rubble')
  assert.ok(colWallA && colWallA.enabled === true, 'wall-a aftermath collider registered & enabled')
  assert.ok(colWallB && colWallB.enabled === true, 'wall-b aftermath collider registered & enabled')
  assert.notEqual(colWallA.cz, colWallB.cz, 'Same-type aftermath colliders occupy distinct world positions')

  // Clear ONLY wall-a aftermath; wall-b remains blocking
  const wallAInteract = wallA.getInteractionAnchor()
  const clearWallA = engine.hazardManager.interactWithHazard('wall-a', {
    playerWorldPos: wallAInteract,
    playerGridCell: { row: wallA.row, col: wallA.col },
  })
  assert.equal(clearWallA.handled, true)
  assert.equal(wallA.isAftermathCleared, true)
  assert.equal(wallB.isAftermathCleared, false, 'Clearing wall-a does NOT clear wall-b')
  assert.equal(getDynamicCollider(engine._propCollisionIndex, 'wall-a:aftermath-rubble').enabled, false)
  assert.equal(getDynamicCollider(engine._propCollisionIndex, 'wall-b:aftermath-rubble').enabled, true)

  // C. Collapse grate-a only; grate-b stays flush & uncollapsed
  const grateCfg = HAZARD_CONFIG[HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]
  const grateACenter = grateA.getDangerArea().center
  grateA.update(0.05, { playerWorldPos: grateACenter, playerGridCell: { row: grateA.row, col: grateA.col } })
  grateA.update(grateCfg.warningDuration + 0.05, {
    playerWorldPos: farPos,
    playerGridCell: { row: 4, col: 4 },
  })
  grateA.update(grateCfg.activeDuration + 0.05, {
    playerWorldPos: farPos,
    playerGridCell: { row: 4, col: 4 },
  })
  engine.syncHazardColliders({ allowPushOut: false })
  assert.equal(grateA.getState(), HAZARD_STATES.DISABLED)
  assert.equal(grateB.getState(), HAZARD_STATES.DORMANT)
  assert.equal(grateA.mesh.userData.isPermanentlyCollapsed, true)
  assert.equal(Boolean(grateB.mesh.userData.isPermanentlyCollapsed), false)
  assert.equal(getDynamicCollider(engine._propCollisionIndex, 'grate-a:aftermath-pit').enabled, true)

  // D. Movement effect emitted from tank-a preserves tank-a hazardId while tank-b stays dormant
  const tankACenter = tankA.getDangerArea().center
  const tankCfg = HAZARD_CONFIG[HAZARD_TYPES.FALLING_WATER_TANK]
  engine.hazardManager.update(0.05, {
    playerWorldPos: tankACenter,
    playerGridCell: { row: tankA.row, col: tankA.col },
  })
  engine.hazardManager.update(tankCfg.warningDuration + 0.05, {
    playerWorldPos: tankACenter,
    playerGridCell: { row: tankA.row, col: tankA.col },
  })
  const tankUpdate = engine.hazardManager.update(tankCfg.activeDuration * 0.4, {
    playerWorldPos: tankACenter,
    playerGridCell: { row: tankA.row, col: tankA.col },
  })
  assert.equal(tankA.getState(), HAZARD_STATES.ACTIVE)
  assert.equal(tankB.getState(), HAZARD_STATES.DORMANT)
  assert.equal(tankUpdate.movementEffects?.hazardId, 'tank-a')

  // Clean disposal preserves shared asset pools
  const poolsBeforeDispose = getHazardPoolStats()
  audioEngine.dispose()
  engine.dispose()
  assert.equal(engine.isDisposed, true)
  const poolsAfterDispose = getHazardPoolStats()
  assert.equal(
    poolsAfterDispose.geometries <= poolsBeforeDispose.geometries &&
      poolsAfterDispose.materials <= poolsBeforeDispose.materials,
    true,
    'Shared hazard pools remain clean on multi-instance disposal'
  )
}
console.log('✓ Independent state, colliders, interactions, audio cues, and 3D disposal verified across same-type instances')
console.log('--- ALL MULTI-INSTANCE HAZARD TESTS PASSED ---')
