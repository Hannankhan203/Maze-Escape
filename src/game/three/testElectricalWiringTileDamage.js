/**
 * Automated Regression Verification Suite for MAZE-HAZARD-WIRING-001
 * Exposed Electrical Wiring Full-Tile Damage Coverage
 */

import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  ELECTRICAL_WIRING_CONSTANTS,
  HAZARD_TYPES,
  resolveElectricalMount,
} from '../generation/hazardPlacement.js'
import { moveWithSubsteps } from '../world/gridCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES } from './CameraRig.js'
import { HAZARD_CONFIG, HAZARD_STATES, HazardAgent } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { DEFAULT_KEY_BINDINGS, KEY_BINDING_ACTION_ORDER } from './threeConfig.js'

const W = CELL_TYPES.WALL
const P = CELL_TYPES.PATH
const S = CELL_TYPES.START
const E = CELL_TYPES.EXIT

function createMockCanvasHost() {
  return {
    clientWidth: 960,
    clientHeight: 540,
    appendChild() {},
    removeChild() {},
  }
}

function createHeadlessEngine(maze, options = {}) {
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
  const engine = new MazeSceneEngine(createMockCanvasHost(), {
    createRenderer: () => mockRenderer,
    skipSpawnSequence: true,
    initialHealth: 100,
    maxHealth: 100,
    damageImmunityDuration: 0.6,
    enemies: { autoSpawn: false },
    ...options,
  })
  engine.setMaze(maze)
  engine.cancelSpawnSequence()
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })
  return engine
}

function createEwCorridorMaze() {
  const grid = [
    [W, W, W, W, W, W, W],
    [W, S, P, P, P, E, W],
    [W, W, W, W, W, W, W],
    [W, P, P, P, P, P, W],
    [W, W, W, W, W, W, W],
  ]
  return {
    grid,
    rows: grid.length,
    cols: grid[0].length,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 5 },
    level: 2,
    seed: 41001,
  }
}

function createNsCorridorMaze() {
  const grid = [
    [W, W, W, W, W],
    [W, S, W, P, W],
    [W, P, W, P, W],
    [W, P, W, P, W],
    [W, P, W, P, W],
    [W, E, W, P, W],
    [W, W, W, W, W],
  ]
  return {
    grid,
    rows: grid.length,
    cols: grid[0].length,
    start: { row: 1, col: 1 },
    exit: { row: 5, col: 1 },
    level: 2,
    seed: 41002,
  }
}

function createOpenIntersectionMaze() {
  const grid = [
    [W, W, W, W, W],
    [W, W, P, W, W],
    [W, S, P, E, W],
    [W, W, P, W, W],
    [W, W, W, W, W],
  ]
  return {
    grid,
    rows: grid.length,
    cols: grid[0].length,
    start: { row: 2, col: 1 },
    exit: { row: 2, col: 3 },
    level: 2,
    seed: 41003,
  }
}

function probeElectricalDamage(engine, hazard, x, z, opts = {}) {
  engine.health = engine.maxHealth
  engine.damageImmunityTimer = 0
  engine.isGameOver = false
  hazard.state = HAZARD_STATES.ACTIVE
  hazard.timer = 0.25
  hazard.isDisabled = false
  hazard.isAftermathCleared = false
  hazard.isPermanentlyCollapsed = false
  if (Number.isFinite(opts.playerYaw)) {
    engine.playerYaw = opts.playerYaw
    if (engine.cameraRig) {
      engine.cameraRig.yaw = opts.playerYaw
    }
  }
  engine.setPlayerWorldPosition(x, 0, z, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  return engine.maxHealth - engine.health
}

console.log('=== RUNNING MAZE-HAZARD-WIRING-001 ELECTRICAL WIRING FULL-TILE DAMAGE SUITE ===')

// ---------------------------------------------------------------------------
// 1–4. Left edge, center, right edge, and full longitudinal extent of affected tile
// ---------------------------------------------------------------------------
{
  const ewMaze = createEwCorridorMaze()
  const engine = createHeadlessEngine(ewMaze)
  const cell = gridToWorld(1, 3, ewMaze)

  // North wall = left tile when facing east (+X): world Z in [cell.z - 2.0, cell.z], X in [cell.x - 2.0, cell.x + 2.0]
  const northWiring = engine.hazardManager.addHazard({
    id: 'wiring-north-left-tile',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row: 1,
    col: 3,
    wallSide: 'north',
  })

  const dangerArea = northWiring.getDangerArea()
  assert.equal(dangerArea.dangerMinLocalX, -2.0, 'Wall wiring local minX spans full cell (-2.0)')
  assert.equal(dangerArea.dangerMaxLocalX, 2.0, 'Wall wiring local maxX spans full cell (+2.0)')
  assert.equal(dangerArea.dangerMinLocalZ, -2.0, 'Wall wiring local minZ reaches mounting wall (-2.0)')
  assert.equal(dangerArea.dangerMaxLocalZ, 0.0, 'Wall wiring local maxZ ends cleanly at tile centerline seam (0.0)')
  assert.ok(
    dangerArea.boundaryTolerance > 0 && dangerArea.boundaryTolerance <= 0.05,
    `Boundary tolerance is small and controlled (${dangerArea.boundaryTolerance})`
  )

  // 1. Extreme left edge of the affected tile (wall-side edge: localZ = -2.0 and walkable wall-clamped -1.25)
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z - 1.98),
    30,
    'Extreme wall-side edge (left edge) of affected tile causes electrical damage'
  )
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z - 1.25),
    30,
    'Walkable wall-clamped left edge of affected tile causes electrical damage'
  )

  // 2. Center of the affected tile (localZ = -1.0), including far from visible wire tips (localX = -1.5, +1.5)
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z - 1.0),
    30,
    'Center of affected tile causes electrical damage'
  )
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x - 1.5, cell.z - 1.0),
    30,
    'Affected tile center well west of visible wires causes electrical damage'
  )
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x + 1.5, cell.z - 1.0),
    30,
    'Affected tile center well east of visible wires causes electrical damage'
  )

  // 3. Extreme right edge of the affected tile (corridor centerline seam: localZ = -0.02 and localZ = 0.0)
  // Previously missed by narrow dangerRadius = 0.98 around localZ = -1.38!
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z - 0.02),
    30,
    'Inner edge just inside affected tile seam causes electrical damage'
  )
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z),
    30,
    'Extreme right edge (exact corridor seam localZ = 0.0) of affected tile causes electrical damage'
  )

  // 4. Full longitudinal walkable extent of the affected tile (localX from -2.0 to +2.0 across all transverse lanes)
  const longitudinalSamples = [-2.0, -1.95, -1.5, -0.75, 0.0, 0.75, 1.5, 1.95, 2.0]
  const transverseSamples = [-1.95, -1.25, -1.0, -0.25, 0.0]
  for (const lx of longitudinalSamples) {
    for (const lz of transverseSamples) {
      const dmg = probeElectricalDamage(engine, northWiring, cell.x + lx, cell.z + lz)
      assert.equal(
        dmg,
        30,
        `Affected tile point (localX=${lx}, localZ=${lz}) must cause 30 electrical damage (got ${dmg})`
      )
    }
  }

  // Dormant wiring also arms when stepping onto far longitudinal edge of affected tile (beyond circular triggerRadius)
  engine.resetCombat()
  engine.health = 100
  engine.damageImmunityTimer = 0
  engine.setPlayerWorldPosition(cell.x - 1.95, 0, cell.z - 0.05, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  assert.equal(
    northWiring.getState(),
    HAZARD_STATES.WARNING,
    'Stepping onto far longitudinal corner of affected tile triggers DORMANT -> WARNING'
  )

  engine.dispose()
}

// ---------------------------------------------------------------------------
// 5, 6, 7, 8. Opposite tile safety, partial footprint overlap, full outside safety, and boundary tolerance
// ---------------------------------------------------------------------------
{
  const ewMaze = createEwCorridorMaze()
  const engine = createHeadlessEngine(ewMaze)
  const cell = gridToWorld(1, 3, ewMaze)

  const northWiring = engine.hazardManager.addHazard({
    id: 'wiring-north-safe-check',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row: 1,
    col: 3,
    wallSide: 'north',
  })

  // 5. Opposite tile (south tile: localZ in (0, +2.0]) remains safe across full corridor walk-through
  for (const lx of [-2.5, -2.0, -1.0, 0.0, 1.0, 2.0, 2.5]) {
    assert.equal(
      probeElectricalDamage(engine, northWiring, cell.x + lx, cell.z + 1.0),
      0,
      `Opposite tile center (localX=${lx}, localZ=+1.0) remains completely safe`
    )
    assert.equal(
      probeElectricalDamage(engine, northWiring, cell.x + lx, cell.z + 1.25),
      0,
      `Opposite wall-hugging lane (localX=${lx}, localZ=+1.25) remains completely safe`
    )
  }

  // Simulate realistic player walk-through along opposite tile using moveWithSubsteps
  engine.health = 100
  engine.damageImmunityTimer = 0
  northWiring.state = HAZARD_STATES.ACTIVE
  northWiring.timer = 0.5
  let walkX = cell.x - 3.0
  let walkZ = cell.z + 1.15
  engine.setPlayerWorldPosition(walkX, 0, walkZ, { immediate: true })
  for (let step = 0; step < 30; step += 1) {
    const res = moveWithSubsteps(walkX, walkZ, walkX + 0.22, walkZ, ewMaze, {
      radius: PLAYER_RADIUS,
      propColliders: engine._propCollisionIndex,
    })
    walkX = res.x
    walkZ = res.z
    engine.setPlayerWorldPosition(walkX, 0, walkZ, { immediate: true })
    engine.stepFrame(0.05, { render: false })
  }
  assert.equal(
    engine.health,
    100,
    'Walking completely past active wiring along opposite tile via moveWithSubsteps deals 0 damage'
  )

  // 6. Partial player collision-footprint overlap IS detected and causes damage
  // Player center at localZ = +0.50 -> grounded footprint spans [-0.25, +1.25] (overlaps affected tile by 0.25m)
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z + 0.5),
    30,
    'Partial lateral footprint overlap from opposite tile (localZ=+0.50) causes electrical damage'
  )
  // Player center at localZ = +0.74 -> footprint spans [-0.01, +1.49] (subtle 1cm edge overlap)
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z + 0.74),
    30,
    'Subtle edge overlap of player collision footprint (localZ=+0.74) prevents edge-of-tile exploit'
  )
  // Partial longitudinal footprint overlap from adjacent open corridor cell (1,2) into (1,3)
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x - 2.5, cell.z - 1.0),
    30,
    'Partial longitudinal footprint overlap from west adjacent cell (localX=-2.50) causes electrical damage'
  )
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x + 2.5, cell.z - 1.0),
    30,
    'Partial longitudinal footprint overlap from east adjacent cell (localX=+2.50) causes electrical damage'
  )

  // 7 & 8. Boundary tolerance prevents numerical seam gaps without substantially extending into opposite tile
  const tol = ELECTRICAL_WIRING_CONSTANTS.boundaryTolerance
  // Exactly at radius + tol * 0.5 -> inside tolerance -> damaged
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z + PLAYER_RADIUS + tol * 0.5),
    30,
    'Boundary tolerance prevents numerical gap right at player footprint edge touching tile seam'
  )
  // Clearly outside radius + tol (footprint entirely inside opposite tile with small clearance) -> safe!
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x, cell.z + PLAYER_RADIUS + tol + 0.03),
    0,
    'Player whose collision footprint is entirely inside opposite tile (+0.03m beyond tolerance) receives 0 damage'
  )
  // Longitudinally outside affected tile (footprint entirely in adjacent cell) -> safe!
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x - 2.0 - PLAYER_RADIUS - tol - 0.05, cell.z - 1.0),
    0,
    'Player whose collision footprint is entirely west of affected tile receives 0 damage'
  )
  assert.equal(
    probeElectricalDamage(engine, northWiring, cell.x + 2.0 + PLAYER_RADIUS + tol + 0.05, cell.z - 1.0),
    0,
    'Player whose collision footprint is entirely east of affected tile receives 0 damage'
  )
  // Behind solid maze wall (row 3, col 3 separated by row 2 wall) -> safe!
  const behindWall = gridToWorld(3, 3, ewMaze)
  assert.equal(
    probeElectricalDamage(engine, northWiring, behindWall.x, behindWall.z),
    0,
    'Player behind solid maze wall receives 0 electrical damage'
  )

  // Now verify right-tile wiring (south wall) in the same two-tile corridor:
  // South tile (dz in [0, +2.0]) dangerous; north opposite tile (dz in [-2.0, 0]) safe!
  engine.hazardManager.clear()
  const southWiring = engine.hazardManager.addHazard({
    id: 'wiring-south-right-tile',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row: 1,
    col: 3,
    wallSide: 'south',
  })
  assert.equal(
    probeElectricalDamage(engine, southWiring, cell.x, cell.z + 1.98),
    30,
    'South-mounted wiring covers extreme south wall edge'
  )
  assert.equal(
    probeElectricalDamage(engine, southWiring, cell.x, cell.z + 1.0),
    30,
    'South-mounted wiring covers south tile center'
  )
  assert.equal(
    probeElectricalDamage(engine, southWiring, cell.x, cell.z),
    30,
    'South-mounted wiring covers centerline seam edge'
  )
  assert.equal(
    probeElectricalDamage(engine, southWiring, cell.x - 1.95, cell.z + 0.05),
    30,
    'South-mounted wiring covers west longitudinal corner'
  )
  assert.equal(
    probeElectricalDamage(engine, southWiring, cell.x + 1.95, cell.z + 0.05),
    30,
    'South-mounted wiring covers east longitudinal corner'
  )
  assert.equal(
    probeElectricalDamage(engine, southWiring, cell.x, cell.z - 0.5),
    30,
    'South-mounted wiring detects partial footprint overlap from opposite north tile'
  )
  assert.equal(
    probeElectricalDamage(engine, southWiring, cell.x, cell.z - 1.0),
    0,
    'South-mounted wiring keeps opposite north tile center completely safe'
  )
  assert.equal(
    probeElectricalDamage(engine, southWiring, cell.x, cell.z - 1.25),
    0,
    'South-mounted wiring keeps opposite north wall lane completely safe'
  )

  engine.dispose()
}

// ---------------------------------------------------------------------------
// 9. Rotated placements (N-S corridor west/east walls, arbitrary yaw, ceiling)
//    AND verification that visual electrical wires remain unchanged & decoupled
// ---------------------------------------------------------------------------
{
  const nsMaze = createNsCorridorMaze()
  const engine = createHeadlessEngine(nsMaze)
  const cell = gridToWorld(3, 1, nsMaze)

  // West-wall mount (wallYaw = +Math.PI/2): affected tile is dx in [-2.0, 0.0], dz in [-2.0, +2.0]
  const westWiring = engine.hazardManager.addHazard({
    id: 'wiring-west-ns',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row: 3,
    col: 1,
    wallSide: 'west',
  })
  assert.ok(
    Math.abs(westWiring.wallYaw - Math.PI * 0.5) < 1e-6,
    'West-mounted wiring uses +PI/2 wallYaw'
  )
  assert.equal(probeElectricalDamage(engine, westWiring, cell.x - 1.98, cell.z), 30, 'West mount: west wall edge damaged')
  assert.equal(probeElectricalDamage(engine, westWiring, cell.x - 1.0, cell.z), 30, 'West mount: tile center damaged')
  assert.equal(probeElectricalDamage(engine, westWiring, cell.x, cell.z), 30, 'West mount: centerline seam damaged')
  assert.equal(probeElectricalDamage(engine, westWiring, cell.x - 0.1, cell.z - 1.95), 30, 'West mount: north longitudinal edge damaged')
  assert.equal(probeElectricalDamage(engine, westWiring, cell.x - 0.1, cell.z + 1.95), 30, 'West mount: south longitudinal edge damaged')
  assert.equal(probeElectricalDamage(engine, westWiring, cell.x + 0.5, cell.z), 30, 'West mount: partial overlap from east tile damaged')
  assert.equal(probeElectricalDamage(engine, westWiring, cell.x + 1.0, cell.z), 0, 'West mount: opposite east tile center safe')
  assert.equal(probeElectricalDamage(engine, westWiring, cell.x + 1.25, cell.z), 0, 'West mount: opposite east wall lane safe')

  // East-wall mount (wallYaw = -Math.PI/2): affected tile is dx in [0.0, +2.0], dz in [-2.0, +2.0]
  engine.hazardManager.clear()
  const eastWiring = engine.hazardManager.addHazard({
    id: 'wiring-east-ns',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row: 3,
    col: 1,
    wallSide: 'east',
  })
  assert.ok(
    Math.abs(eastWiring.wallYaw - -Math.PI * 0.5) < 1e-6,
    'East-mounted wiring uses -PI/2 wallYaw'
  )
  assert.equal(probeElectricalDamage(engine, eastWiring, cell.x + 1.98, cell.z), 30, 'East mount: east wall edge damaged')
  assert.equal(probeElectricalDamage(engine, eastWiring, cell.x + 1.0, cell.z), 30, 'East mount: tile center damaged')
  assert.equal(probeElectricalDamage(engine, eastWiring, cell.x, cell.z), 30, 'East mount: centerline seam damaged')
  assert.equal(probeElectricalDamage(engine, eastWiring, cell.x + 0.1, cell.z - 1.95), 30, 'East mount: north longitudinal edge damaged')
  assert.equal(probeElectricalDamage(engine, eastWiring, cell.x + 0.1, cell.z + 1.95), 30, 'East mount: south longitudinal edge damaged')
  assert.equal(probeElectricalDamage(engine, eastWiring, cell.x - 0.5, cell.z), 30, 'East mount: partial overlap from west tile damaged')
  assert.equal(probeElectricalDamage(engine, eastWiring, cell.x - 1.0, cell.z), 0, 'East mount: opposite west tile center safe')
  assert.equal(probeElectricalDamage(engine, eastWiring, cell.x - 1.25, cell.z), 0, 'East mount: opposite west wall lane safe')

  // Visual geometry remains untouched & strictly decoupled from damage volume
  const mesh = eastWiring.getMesh()
  mesh.updateMatrixWorld(true)
  const mountGroup = mesh.userData.mountGroup
  const cableGroup = mesh.userData.cableGroup
  const localBox = new THREE.Box3().setFromObject(cableGroup)
  const widthX = localBox.max.x - localBox.min.x
  const widthZ = localBox.max.z - localBox.min.z
  assert.ok(
    widthX < 1.2 && widthZ < 1.2,
    `Visible electrical cables remain compact and unstretched (widthX=${widthX.toFixed(2)}m, widthZ=${widthZ.toFixed(2)}m)`
  )
  assert.equal(
    mountGroup.userData?.damageVolumeMesh,
    undefined,
    'No visual mesh added to disguise damage volume'
  )
  assert.equal(
    ELECTRICAL_WIRING_CONSTANTS.wallDischargeLocalX,
    0.26,
    'Visual discharge localX offset unchanged'
  )
  assert.equal(
    ELECTRICAL_WIRING_CONSTANTS.wallDischargeLocalZ,
    -1.38,
    'Visual discharge localZ offset unchanged'
  )

  // Verify visual wire cluster does not span the full 4m longitudinal tile even though damage does
  const bounds = eastWiring.getElectricalDamageBounds()
  assert.ok(
    Math.abs(bounds.worldMaxZ - bounds.worldMinZ - CELL_SIZE) < 1e-6 &&
      Math.abs(bounds.worldMaxX - bounds.worldMinX - CELL_SIZE * 0.5) < 1e-6,
    'East wall world-space damage bounds match exact 2m x 4m affected floor tile'
  )

  engine.dispose()

  // Ceiling-mounted open 4-way intersection covers the full 4m x 4m intersection tile
  const openMaze = createOpenIntersectionMaze()
  const openMount = resolveElectricalMount(openMaze.grid, 2, 2)
  assert.equal(openMount.mountType, 'ceiling', 'Open intersection resolves ceiling mount')
  assert.equal(openMount.dangerMinLocalZ, -2.0)
  assert.equal(openMount.dangerMaxLocalZ, 2.0)
  const ceilAgent = new HazardAgent(
    {
      id: 'wiring-ceiling-intersection',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      row: 2,
      col: 2,
    },
    openMaze
  )
  const openCell = gridToWorld(2, 2, openMaze)
  assert.equal(
    ceilAgent._isFootprintInElectricalTileArea(openCell.x - 1.9, openCell.z + 1.9, PLAYER_RADIUS),
    true,
    'Ceiling intersection wiring covers all four quadrants of its tile'
  )
  ceilAgent.dispose()
}

// ---------------------------------------------------------------------------
// 10, 11, 12. Neutralization, damage timing/intensity, player rotation & camera modes,
//             and preserved mouse interaction + F-key removal
// ---------------------------------------------------------------------------
{
  const ewMaze = createEwCorridorMaze()
  const engine = createHeadlessEngine(ewMaze, {
    cameraMode: CAMERA_MODES.FIRST_PERSON,
  })
  const cell = gridToWorld(1, 3, ewMaze)

  const wiring = engine.hazardManager.addHazard({
    id: 'wiring-lifecycle-check',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row: 1,
    col: 3,
    wallSide: 'north',
  })

  // 11a. Existing damage timing & intensity preserved
  assert.equal(HAZARD_CONFIG[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING].damage, 30, 'Electrical damage remains 30')
  assert.equal(HAZARD_CONFIG[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING].warningDuration, 1.3, 'Warning duration remains 1.3s')
  assert.equal(HAZARD_CONFIG[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING].activeDuration, 0.9, 'Active phase cycle remains 0.9s')

  // Verify damage consistency across player yaw orientations AND both camera modes (FIRST_PERSON & THIRD_PERSON)
  for (const mode of [CAMERA_MODES.FIRST_PERSON, CAMERA_MODES.THIRD_PERSON]) {
    engine.setCameraMode(mode)
    for (const yaw of [0, Math.PI * 0.25, Math.PI * 0.5, Math.PI, -Math.PI * 0.75]) {
      assert.equal(
        probeElectricalDamage(engine, wiring, cell.x - 1.4, cell.z - 0.1, { playerYaw: yaw }),
        30,
        `Affected tile edge causes 30 damage in ${mode} at yaw=${yaw.toFixed(2)}`
      )
      assert.equal(
        probeElectricalDamage(engine, wiring, cell.x, cell.z + 1.15, { playerYaw: yaw }),
        0,
        `Opposite safe tile deals 0 damage in ${mode} at yaw=${yaw.toFixed(2)}`
      )
    }
  }

  // Verify timing: DORMANT -> WARNING (1.3s) -> ACTIVE -> 30 dmg -> immunity blocks -> next 30 dmg after immunity
  engine.resetCombat()
  engine.health = 100
  engine.damageImmunityTimer = 0
  engine.setPlayerWorldPosition(cell.x - 1.2, 0, cell.z - 0.2, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  assert.equal(wiring.getState(), HAZARD_STATES.WARNING, 'Enters WARNING on tile entry')
  assert.equal(engine.health, 100, 'No damage during WARNING phase')
  engine.stepFrame(1.0, { render: false })
  assert.equal(wiring.getState(), HAZARD_STATES.WARNING, 'Still WARNING before 1.3s')
  assert.equal(engine.health, 100, 'Still 0 damage before WARNING completes')
  engine.stepFrame(0.35, { render: false })
  assert.equal(wiring.getState(), HAZARD_STATES.ACTIVE, 'Enters ACTIVE after 1.3s warningDuration')
  assert.equal(engine.health, 70, 'Deals 30 damage immediately upon activation on affected tile')
  engine.stepFrame(0.25, { render: false })
  assert.equal(engine.health, 70, 'Respects existing damageImmunityTimer')
  engine.stepFrame(0.45, { render: false })
  assert.equal(engine.health, 40, 'Deals repeated 30 damage once immunity expires')

  // 12. Preserved mouse interaction (left-click neutralizes, right-click does not) & F-key removal
  assert.equal(typeof engine.interact, 'undefined', 'Legacy F-key engine.interact remains removed')
  assert.equal(
    Object.values(DEFAULT_KEY_BINDINGS).includes('KeyF'),
    false,
    'No KeyF gameplay binding exists in DEFAULT_KEY_BINDINGS'
  )
  assert.equal(
    KEY_BINDING_ACTION_ORDER.includes('interact'),
    false,
    'No interact key action exists in KEY_BINDING_ACTION_ORDER'
  )

  // Stand safely outside affected tile near breaker (localX = -2.86, localZ = -1.25)
  const dArea = wiring.getDangerArea()
  const safeBreakerApproach = {
    x: dArea.breaker.x - 2.08,
    y: 0,
    z: dArea.breaker.z + 0.63,
  }
  engine.damageImmunityTimer = 0
  engine.health = 100
  engine.setPlayerWorldPosition(safeBreakerApproach.x, 0, safeBreakerApproach.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  assert.equal(engine.health, 100, 'Safe upstream breaker approach outside affected tile deals 0 damage')

  const prompt = engine.getNearbyInteractable()
  assert.ok(
    prompt &&
      prompt.kind === 'hazard' &&
      prompt.id === 'wiring-lifecycle-check' &&
      prompt.label === 'Insulate Exposed Wiring',
    'Crosshair/nearby interaction prompt remains intact for active wiring'
  )

  // Right-click (handleSecondaryAction) must NOT neutralize or trigger electrical interaction
  const rightClickRes = engine.handleSecondaryAction()
  assert.equal(
    wiring.getState(),
    HAZARD_STATES.ACTIVE,
    'Right-click does not neutralize or disable electrical wiring'
  )
  assert.ok(
    !rightClickRes || rightClickRes.action !== 'insulate_wiring',
    'Right-click never dispatches insulate_wiring'
  )

  // 10. Left-click (handlePrimaryAction) neutralizes wiring and immediately disables full-tile damage volume
  const leftClickRes = engine.handlePrimaryAction()
  assert.equal(leftClickRes.handled, true, 'Left-click handles electrical wiring neutralization')
  assert.equal(leftClickRes.action, 'insulate_wiring', 'Left-click dispatches existing insulate_wiring action')
  assert.equal(wiring.getState(), HAZARD_STATES.DISABLED, 'Wiring enters DISABLED state immediately')
  assert.equal(wiring.isAftermathCleared, true, 'Wiring marks aftermath cleared immediately')

  // Walking across EVERY part of the previously electrified tile now deals 0 damage
  for (const [lx, lz] of [
    [-1.95, -1.95],
    [0.0, -1.95],
    [1.95, -1.95],
    [-1.5, -1.0],
    [0.0, -1.0],
    [1.5, -1.0],
    [-1.95, 0.0],
    [0.0, 0.0],
    [1.95, 0.0],
  ]) {
    engine.health = 100
    engine.damageImmunityTimer = 0
    engine.setPlayerWorldPosition(cell.x + lx, 0, cell.z + lz, { immediate: true })
    engine.stepFrame(0.25, { render: false })
    assert.equal(
      engine.health,
      100,
      `Neutralized wiring deals 0 damage across entire tile (localX=${lx}, localZ=${lz})`
    )
  }

  // Lifecycle reset restores clean DORMANT state and re-enables full-tile detection
  engine.resetCombat()
  assert.equal(wiring.getState(), HAZARD_STATES.DORMANT, 'resetCombat restores wiring to DORMANT')
  assert.equal(wiring.isDisabled, false, 'resetCombat clears isDisabled')
  assert.equal(wiring.isAftermathCleared, false, 'resetCombat clears isAftermathCleared')
  assert.equal(
    probeElectricalDamage(engine, wiring, cell.x - 1.6, cell.z - 0.05),
    30,
    'Re-armed wiring after resetCombat covers full affected tile again'
  )

  engine.dispose()
}

console.log('ALL MAZE-HAZARD-WIRING-001 ELECTRICAL WIRING FULL-TILE DAMAGE TESTS PASSED!')
