import assert from 'node:assert/strict'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { HIDING_SPOT_TYPES } from '../generation/hidingSpotPlacement.js'
import { PROP_TYPES } from '../generation/environmentalPropPlacement.js'
import {
  hasLineOfSightInMaze,
  isCellWalkable,
  moveWithSubsteps,
  resolveGridCollision,
  resolveSafePushOut,
} from '../world/gridCollision.js'
import {
  MIN_HAZARD_NAVIGABLE_CLEARANCE,
  buildPropCollisionIndex,
  clearDynamicColliders,
  getDynamicCollider,
  getDynamicColliderCount,
  registerDynamicCollider,
  setDynamicColliderEnabled,
  unregisterDynamicCollider,
  unregisterDynamicCollidersByOwner,
  updateDynamicCollider,
  validateHazardColliderPlacement,
} from '../world/propCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld, worldToGrid } from '../world/worldCoords.js'
import { HAZARD_STATES, HazardAgent } from './HazardAgent.js'
import { HazardManager } from './HazardManager.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

console.log('--- RUNNING DYNAMIC HAZARD COLLISION & INTERACTION FOUNDATION TESTS ---')

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

function makeMaze(grid, { start = { row: 1, col: 1 }, exit = { row: 1, col: 3 }, seed = 101 } = {}) {
  return {
    id: `test-maze-${seed}`,
    seed,
    difficulty: 'easy',
    rows: grid.length,
    cols: grid[0].length,
    grid,
    start,
    exit,
    keycards: [],
    collectibles: { items: [] },
  }
}

const W = CELL_TYPES.WALL
const P = CELL_TYPES.PATH

// Corridor + parallel corridor separated by a wall + L-corner for thorough testing
const testMaze = makeMaze(
  [
    [W, W, W, W, W, W, W],
    [W, P, P, P, P, P, W], // Row 1: long E-W corridor (cols 1..5)
    [W, P, W, W, W, P, W], // Row 2: wall divider between row 1 & row 3 at cols 2..4
    [W, P, P, P, P, P, W], // Row 3: parallel E-W corridor
    [W, W, W, W, W, W, W],
  ],
  { start: { row: 1, col: 1 }, exit: { row: 1, col: 5 }, seed: 777 }
)

// ============================================================================
// 1. Dynamic collider registration, removal, static preservation & slot reuse
// ============================================================================
console.log('Test 1: Dynamic Collider Registration, Removal & Static Prop Preservation')
{
  const staticProps = [
    {
      id: 'static-crate-1',
      type: PROP_TYPES.WOODEN_CRATE,
      row: 1,
      col: 1,
      offsetX: -1.4,
      offsetZ: -1.4,
      rotationYaw: 0,
      scale: 1,
    },
  ]
  const index = buildPropCollisionIndex(testMaze, staticProps)
  assert.ok(index, 'Static prop index built')
  const staticCountBefore = index.staticCount
  assert.equal(staticCountBefore, 1, 'Static count recorded as 1')
  const staticSnap = { ...index.colliders[0] }

  const c12 = gridToWorld(1, 2, testMaze)
  const reg = registerDynamicCollider(index, {
    id: 'dyn-1',
    ownerId: 'haz-1',
    kind: 'obb',
    cx: c12.x,
    cz: c12.z,
    halfW: 0.5,
    halfD: 0.4,
    yaw: 0,
    row: 1,
    col: 2,
    enabled: true,
  })
  assert.ok(reg, 'Dynamic OBB registered')
  assert.equal(getDynamicColliderCount(index), 1)
  assert.equal(index.staticCount, staticCountBefore, 'Static count unchanged')
  assert.deepEqual(
    { cx: index.colliders[0].cx, cz: index.colliders[0].cz, halfW: index.colliders[0].halfW },
    { cx: staticSnap.cx, cz: staticSnap.cz, halfW: staticSnap.halfW },
    'Static prop collider untouched'
  )

  // Verify static prop still collides while dynamic collider is present
  const staticHit = resolveGridCollision(
    staticSnap.cx + staticSnap.halfW + PLAYER_RADIUS - 0.12,
    staticSnap.cz,
    testMaze,
    { radius: PLAYER_RADIUS, propColliders: index }
  )
  assert.equal(staticHit.hitProp, true, 'Static prop still resolves collision')

  // Unregister & verify slot reuse
  assert.equal(unregisterDynamicCollider(index, 'dyn-1'), true)
  assert.equal(getDynamicColliderCount(index), 0)
  assert.equal(getDynamicCollider(index, 'dyn-1'), null)

  const reg2 = registerDynamicCollider(index, {
    id: 'dyn-2',
    ownerId: 'haz-2',
    kind: 'circle',
    cx: c12.x,
    cz: c12.z,
    radius: 0.5,
    row: 1,
    col: 2,
    enabled: true,
  })
  assert.ok(reg2)
  assert.equal(index.colliders.length, staticCountBefore + 1, 'Freed slot reused without array growth')

  // Unregister by owner & clearDynamicColliders preserve static props
  assert.equal(unregisterDynamicCollidersByOwner(index, 'haz-2'), 1)
  assert.equal(getDynamicColliderCount(index), 0)
  assert.equal(index.colliders[0].enabled, true, 'Static collider preserved after dynamic removal')

  registerDynamicCollider(index, {
    id: 'dyn-3',
    ownerId: 'haz-3',
    kind: 'circle',
    cx: c12.x,
    cz: c12.z,
    radius: 0.4,
    enabled: true,
  })
  assert.equal(clearDynamicColliders(index), 1)
  assert.equal(getDynamicColliderCount(index), 0)
  assert.ok(index.colliders[0], 'Static prop survives clearDynamicColliders')
}

// ============================================================================
// 2. Enabled/Disabled state, OBB rotation, Circle transforms & incremental buckets
// ============================================================================
console.log('Test 2: Enabled/Disabled State, OBB/Circle Transforms, Rotation & Bucket Updates')
{
  const index = buildPropCollisionIndex(testMaze, [], { allowEmpty: true })
  const c12 = gridToWorld(1, 2, testMaze)
  const c13 = gridToWorld(1, 3, testMaze)

  // Register rotated 45deg OBB disabled initially
  registerDynamicCollider(index, {
    id: 'rot-obb',
    ownerId: 'haz-rot',
    kind: 'obb',
    cx: c12.x,
    cz: c12.z,
    halfW: 0.85,
    halfD: 0.35,
    yaw: Math.PI / 4,
    row: 1,
    col: 2,
    enabled: false,
  })

  // Disabled collider must NOT block movement
  const passThrough = moveWithSubsteps(c12.x - 1.5, c12.z, 3.0, 0, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(passThrough.hitProp, false, 'Disabled collider allows free movement')
  assert.ok(Math.abs(passThrough.x - (c12.x + 1.5)) < 1e-4)

  // Enable collider -> now blocks movement and inserts into buckets
  const enableRes = setDynamicColliderEnabled(index, 'rot-obb', true)
  assert.equal(enableRes.updated, true)
  assert.equal(enableRes.bucketChanged, true)
  assert.equal(enableRes.enabledChanged, true)

  const blocked = moveWithSubsteps(c12.x - 1.5, c12.z, 3.0, 0, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(blocked.hitProp, true, 'Enabled rotated OBB blocks movement')

  // No-op update must NOT mutate buckets or bump version
  const verBefore = index.version
  const noopRes = updateDynamicCollider(index, 'rot-obb', {
    cx: c12.x,
    cz: c12.z,
    yaw: Math.PI / 4,
    enabled: true,
  })
  assert.equal(noopRes.updated, false)
  assert.equal(noopRes.bucketChanged, false)
  assert.equal(index.version, verBefore, 'Version unchanged on no-op update')

  // Small in-cell rotation/transform updates geometry WITHOUT re-bucketing when bucket span unchanged
  const rotRes = updateDynamicCollider(index, 'rot-obb', {
    yaw: Math.PI / 2,
    halfW: 0.4,
    halfD: 0.9,
  })
  assert.equal(rotRes.updated, true)
  assert.equal(rotRes.bucketChanged, false, 'In-cell rotation avoids bucket churn')

  // Moving collider to neighboring cell updates buckets incrementally
  const moveRes = updateDynamicCollider(index, 'rot-obb', {
    cx: c13.x,
    cz: c13.z,
    row: 1,
    col: 3,
  })
  assert.equal(moveRes.updated, true)
  assert.equal(moveRes.bucketChanged, true, 'Cross-cell move updates buckets')

  // Old cell (1,2) is now clear; new cell (1,3) blocks
  const oldCellCheck = resolveGridCollision(c12.x, c12.z, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(oldCellCheck.hitProp, false, 'Old bucket cleared after move')

  const newCellCheck = resolveGridCollision(c13.x, c13.z, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(newCellCheck.hitProp, true, 'New bucket collides after move')

  // Switch shape to circle and verify circular distance
  updateDynamicCollider(index, 'rot-obb', {
    kind: 'circle',
    radius: 0.55,
  })
  const diagDist = (0.55 + PLAYER_RADIUS - 0.08) / Math.SQRT2
  const circleHit = resolveGridCollision(c13.x + diagDist, c13.z + diagDist, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(circleHit.hitProp, true, 'Circle collider resolves diagonal overlap')
  const circleDistAfter = Math.hypot(circleHit.x - c13.x, circleHit.z - c13.z)
  assert.ok(circleDistAfter >= 0.55 + PLAYER_RADIUS - 1e-3, 'Player pushed outside circle radius')
}

// ============================================================================
// 3. Wall-priority preservation & Player push-out safety
// ============================================================================
console.log('Test 3: Wall-Priority Preservation & Safe Player Push-Out')
{
  const index = buildPropCollisionIndex(testMaze, [], { allowEmpty: true })
  const c12 = gridToWorld(1, 2, testMaze)
  const cellMinZ = c12.z - CELL_SIZE * 0.5 // North wall face at row 0

  // Place dynamic collider close to the north wall, pinning player against north wall
  registerDynamicCollider(index, {
    id: 'pinch-obb',
    ownerId: 'haz-pinch',
    kind: 'obb',
    cx: c12.x,
    cz: cellMinZ + 0.9,
    halfW: 0.8,
    halfD: 0.55,
    yaw: 0,
    row: 1,
    col: 2,
    enabled: true,
  })

  // Wall-priority check during normal collision: player squeezed between wall and collider never enters wall
  const squeezed = resolveGridCollision(c12.x, cellMinZ + 0.25, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.ok(
    squeezed.z >= cellMinZ + PLAYER_RADIUS - 1e-3,
    `Wall-priority preserved: z=${squeezed.z} >= ${cellMinZ + PLAYER_RADIUS}`
  )

  // Safe push-out when collider spawns directly around player near wall
  const pushOut = resolveSafePushOut(c12.x, cellMinZ + 0.65, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(pushOut.pushed, true, 'Overlapped player was safely pushed out')
  assert.equal(pushOut.safe, true, 'Push-out found clean collision-free position')
  assert.ok(
    pushOut.z >= cellMinZ + PLAYER_RADIUS - 1e-3,
    'Push-out never pushes player into north wall'
  )
  const pushedCell = worldToGrid(pushOut.x, pushOut.z, testMaze)
  assert.ok(
    pushedCell && isCellWalkable(pushedCell.row, pushedCell.col, testMaze),
    'Push-out keeps player on a walkable maze tile'
  )
  assert.equal(
    hasLineOfSightInMaze(c12.x, cellMinZ + 0.65, pushOut.x, pushOut.z, testMaze),
    true,
    'Push-out never teleports player through a wall'
  )
  // Verify pushed position no longer overlaps collider
  const verifyClear = resolveGridCollision(pushOut.x, pushOut.z, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(verifyClear.hitProp, false, 'Post push-out position is free of collider overlap')
}

// ============================================================================
// 4. Corridor clearance validation
// ============================================================================
console.log('Test 4: Corridor Clearance Validation (>= 1.25m & Wall/Neighbor Safety)')
{
  const index = buildPropCollisionIndex(testMaze, [], { allowEmpty: true })
  const c12 = gridToWorld(1, 2, testMaze) // E-W corridor (walls on N & S)

  // Valid obstacle leaving 2.8m clearance along Z
  const okCheck = validateHazardColliderPlacement(
    testMaze,
    {
      id: 'valid-rubble',
      ownerId: 'h-ok',
      kind: 'obb',
      cx: c12.x,
      cz: c12.z - 1.4,
      halfW: 1.0,
      halfD: 0.45,
      yaw: 0,
      row: 1,
      col: 2,
    },
    { index }
  )
  assert.equal(okCheck.valid, true)
  assert.ok(okCheck.clearance >= MIN_HAZARD_NAVIGABLE_CLEARANCE)

  // Oversized obstacle blocking entire 4m E-W corridor (< 1.25m left on both N and S sides)
  const blockedCorridorCheck = validateHazardColliderPlacement(
    testMaze,
    {
      id: 'too-wide',
      ownerId: 'h-bad',
      kind: 'obb',
      cx: c12.x,
      cz: c12.z,
      halfW: 0.6,
      halfD: 1.6, // leaves only 0.4m on north and 0.4m on south!
      yaw: 0,
      row: 1,
      col: 2,
    },
    { index }
  )
  assert.equal(blockedCorridorCheck.valid, false, 'Oversized corridor-blocking collider rejected')
  assert.equal(blockedCorridorCheck.reason, 'insufficient_corridor_clearance')

  // Centered 1.36m-wide obstacle leaves only 1.32m per side (< 1.50m player diameter) -> rejected
  const centeredTankWidthCheck = validateHazardColliderPlacement(
    testMaze,
    {
      id: 'centered-too-wide-for-player',
      ownerId: 'h-centered-tank',
      kind: 'obb',
      cx: c12.x,
      cz: c12.z,
      halfW: 0.44,
      halfD: 0.68, // leaves only 1.32m on N and S (< 2 * PLAYER_RADIUS + 0.1 = 1.60m)
      yaw: 0,
      row: 1,
      col: 2,
    },
    { index }
  )
  assert.equal(centeredTankWidthCheck.valid, false, 'Centered 1.36m obstacle rejected to prevent 0.75m-radius player soft-lock')
  assert.equal(centeredTankWidthCheck.reason, 'insufficient_corridor_clearance')

  // L-corner cell (1,1) [open S and E, walls N and W]: rubble tucked flush on closed N wall preserves 3.0m open turn band
  const c11 = gridToWorld(1, 1, testMaze)
  const cornerWallTuckedCheck = validateHazardColliderPlacement(
    testMaze,
    {
      id: 'corner-north-rubble',
      ownerId: 'h-corner',
      kind: 'obb',
      cx: c11.x,
      cz: c11.z - 1.48,
      halfW: 1.05,
      halfD: 0.48,
      yaw: 0,
      row: 1,
      col: 1,
    },
    { index }
  )
  assert.equal(cornerWallTuckedCheck.valid, true, 'L-corner wall-tucked rubble preserves open turn band')
  assert.ok(cornerWallTuckedCheck.clearance >= 2.9, `Expected ~3.0m open turn band (got ${cornerWallTuckedCheck.clearance.toFixed(2)}m)`)

  // Collider intruding into north wall rejected
  const wallIntrude = validateHazardColliderPlacement(
    testMaze,
    {
      id: 'wall-intrude',
      ownerId: 'h-wall',
      kind: 'obb',
      cx: c12.x,
      cz: c12.z - 1.9,
      halfW: 0.5,
      halfD: 0.4,
      yaw: 0,
      row: 1,
      col: 2,
    },
    { index }
  )
  assert.equal(wallIntrude.valid, false, 'Wall-overlapping collider rejected')

  // Neighboring obstacle pinch check: add valid obstacle on north side, then try adding large south obstacle
  registerDynamicCollider(index, {
    id: 'north-obstacle',
    ownerId: 'prop-north',
    kind: 'obb',
    cx: c12.x,
    cz: c12.z - 1.2,
    halfW: 0.8,
    halfD: 0.7, // occupies [-1.9, -0.5]
    row: 1,
    col: 2,
    enabled: true,
  })
  const pinchCheck = validateHazardColliderPlacement(
    testMaze,
    {
      id: 'south-pinch',
      ownerId: 'haz-south',
      kind: 'obb',
      cx: c12.x,
      cz: c12.z + 1.0,
      halfW: 0.8,
      halfD: 0.8, // occupies [+0.2, +1.8] -> leaves only 0.7m gap in middle!
      row: 1,
      col: 2,
    },
    { index }
  )
  assert.equal(pinchCheck.valid, false, 'Pinch against neighboring obstacle rejected')
}

// ============================================================================
// 5. Hazard state transitions -> aftermath activation, dormant obstacles & clearing
// ============================================================================
console.log('Test 5: Hazard State Lifecycle -> Aftermath & Dormant Collider Transitions')
{
  const mgr = new HazardManager(null)
  mgr.maze = testMaze
  const index = buildPropCollisionIndex(testMaze, [], { allowEmpty: true })

  // A. Aligned hazard (#7 wall_collapse) at (1,2) mounted on north wall
  const wallHaz = mgr.addHazard({
    id: 'test-wall-collapse',
    type: HAZARD_TYPES.WALL_COLLAPSE,
    row: 1,
    col: 2,
    wallSide: 'north',
  })
  // B. Pending-refinement hazard (#3 falling_pipes_fixtures) at (1,4) must NOT blindly register colliders
  const pendingHaz = mgr.addHazard({
    id: 'test-pipes-pending',
    type: HAZARD_TYPES.FALLING_PIPES_FIXTURES,
    row: 1,
    col: 4,
  })
  // C. Custom dormant + aftermath hazard proving reusable dormant obstacle interface
  const c13 = gridToWorld(1, 3, testMaze)
  const dormantHaz = mgr.addHazard({
    id: 'test-dormant-custom',
    type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    row: 1,
    col: 3,
    colliders: [
      {
        id: 'test-dormant-custom:upright',
        phase: 'dormant',
        activateProgress: 0.5,
        kind: 'obb',
        cx: c13.x,
        cz: c13.z - 1.35,
        halfW: 0.55,
        halfD: 0.35,
        yaw: 0,
      },
      {
        id: 'test-dormant-custom:wreckage',
        phase: 'aftermath',
        activateProgress: 0.5,
        kind: 'circle',
        cx: c13.x,
        cz: c13.z - 1.1,
        radius: 0.48,
      },
    ],
  })

  const sync0 = mgr.syncCollidersToIndex(index, testMaze)
  assert.equal(sync0.changed, true)
  assert.equal(pendingHaz.getColliderSpecs().length, 0, 'Pending-refinement hazard has no premature colliders')
  assert.equal(getDynamicCollider(index, 'test-wall-collapse:aftermath-rubble')?.enabled, false, 'Wall rubble disabled while dormant')
  assert.equal(getDynamicCollider(index, 'test-dormant-custom:upright')?.enabled, true, 'Dormant obstacle enabled while upright')
  assert.equal(getDynamicCollider(index, 'test-dormant-custom:wreckage')?.enabled, false, 'Aftermath obstacle disabled while upright')

  // Repeated sync with no state change must be a strict no-op
  const verBefore = index.version
  const noopSync = mgr.syncCollidersToIndex(index, testMaze)
  assert.equal(noopSync.changed, false)
  assert.equal(index.version, verBefore, 'No redundant index writes on idle frames')

  // Trigger wall_collapse and step through warning -> active -> disabled
  const c12 = gridToWorld(1, 2, testMaze)
  mgr.update(0.05, { playerWorldPos: { x: c12.x, y: 0, z: c12.z - 0.5 }, playerGridCell: { row: 1, col: 2 } })
  assert.equal(wallHaz.getState(), HAZARD_STATES.WARNING)
  mgr.update(wallHaz.config.warningDuration + 0.05, { playerWorldPos: { x: c12.x, y: 0, z: c12.z + 1.4 }, playerGridCell: { row: 1, col: 2 } })
  assert.equal(wallHaz.getState(), HAZARD_STATES.ACTIVE)
  mgr.update(wallHaz.config.activeDuration + 0.1, { playerWorldPos: { x: c12.x, y: 0, z: c12.z + 1.4 }, playerGridCell: { row: 1, col: 2 } })
  assert.equal(wallHaz.getState(), HAZARD_STATES.DISABLED)

  const syncAfterCollapse = mgr.syncCollidersToIndex(index, testMaze)
  assert.equal(syncAfterCollapse.changed, true)
  assert.equal(syncAfterCollapse.anyNewlyEnabled, true)
  const rubbleCol = getDynamicCollider(index, 'test-wall-collapse:aftermath-rubble')
  assert.equal(rubbleCol?.enabled, true, 'Wall collapse aftermath collider active after collapse')

  // Verify player collides with fallen rubble near north wall, yet passes freely on south side
  const rubbleHit = resolveGridCollision(c12.x, c12.z - 1.35, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(rubbleHit.hitProp, true, 'Fallen wall rubble physically blocks player')
  const southLane = moveWithSubsteps(c12.x - 1.6, c12.z + 1.0, 3.2, 0, testMaze, {
    radius: PLAYER_RADIUS,
    propColliders: index,
  })
  assert.equal(southLane.hitProp, false, 'Opposite corridor lane remains freely navigable')

  // Collapse custom dormant hazard -> dormant collider disables, aftermath collider enables
  mgr.update(0.05, { playerWorldPos: { x: c13.x, y: 0, z: c13.z }, playerGridCell: { row: 1, col: 3 } })
  mgr.update(dormantHaz.config.warningDuration + 0.05, { playerWorldPos: { x: c13.x, y: 0, z: c13.z + 1.5 }, playerGridCell: { row: 1, col: 3 } })
  mgr.update(dormantHaz.config.activeDuration + 0.1, { playerWorldPos: { x: c13.x, y: 0, z: c13.z + 1.5 }, playerGridCell: { row: 1, col: 3 } })
  mgr.syncCollidersToIndex(index, testMaze)
  assert.equal(getDynamicCollider(index, 'test-dormant-custom:upright')?.enabled, false, 'Dormant collider disabled after collapse')
  assert.equal(getDynamicCollider(index, 'test-dormant-custom:wreckage')?.enabled, true, 'Aftermath collider enabled after collapse')

  // Clear aftermath -> collider disabled
  wallHaz.clearAftermath()
  mgr.syncCollidersToIndex(index, testMaze)
  assert.equal(getDynamicCollider(index, 'test-wall-collapse:aftermath-rubble')?.enabled, false, 'Cleared aftermath disables collider')

  // Reset states -> restores dormant collider and keeps aftermath disabled
  mgr.resetHazardStates()
  mgr.syncCollidersToIndex(index, testMaze)
  assert.equal(getDynamicCollider(index, 'test-wall-collapse:aftermath-rubble')?.enabled, false)
  assert.equal(getDynamicCollider(index, 'test-dormant-custom:upright')?.enabled, true, 'Reset restores dormant collider')
  assert.equal(getDynamicCollider(index, 'test-dormant-custom:wreckage')?.enabled, false, 'Reset disables aftermath collider')

  mgr.dispose()
  assert.equal(getDynamicColliderCount(index), 0, 'HazardManager.dispose() unregisters all dynamic colliders')
}

// ============================================================================
// 6. Wall occlusion (hasLineOfSightInMaze) & Interaction discovery / wall rejection
// ============================================================================
console.log('Test 6: Interaction Discovery, Range, Wall Rejection & Aftermath Clearing')
{
  const c12 = gridToWorld(1, 2, testMaze) // North corridor cell (1,2)
  const c32 = gridToWorld(3, 2, testMaze) // South corridor cell (3,2) across solid wall row 2
  const c13 = gridToWorld(1, 3, testMaze) // Adjacent open corridor cell (1,3)
  const c21 = gridToWorld(2, 1, testMaze) // Open vertical connector at col 1

  // Direct LOS checks
  assert.equal(hasLineOfSightInMaze(c12.x, c12.z, c13.x, c13.z, testMaze), true, 'Open corridor has LOS')
  assert.equal(hasLineOfSightInMaze(c12.x, c12.z, c32.x, c32.z, testMaze), false, 'Wall blocks LOS across parallel corridors')
  assert.equal(hasLineOfSightInMaze(c21.x, c21.z, c12.x, c12.z, testMaze), false, 'Solid corner wall blocks diagonal corner LOS')

  // Place interactable hazard at (1,2) near south edge of cell (closer to row 2 wall)
  const agent = new HazardAgent(
    {
      id: 'interact-wall-test',
      type: HAZARD_TYPES.WALL_COLLAPSE,
      row: 1,
      col: 2,
      wallSide: 'south',
      interaction: {
        range: 9.0, // Intentionally large enough to span the 4m wall cell if wall check failed!
        canInteract: (hz) => hz.state === HAZARD_STATES.DISABLED && !hz.isAftermathCleared,
        getPrompt: () => ({
          action: 'clear_rubble',
          label: 'Clear Wall Rubble',
          shortLabel: 'Clear',
        }),
        onInteract: () => ({
          handled: true,
          action: 'clear_rubble',
          clearAftermath: true,
          emitSoundRange: 4.5,
        }),
      },
    },
    testMaze
  )

  // Collapse it so it becomes interactable
  agent.state = HAZARD_STATES.DISABLED
  agent.isPermanentlyCollapsed = true
  agent.isDisabled = true
  agent._syncColliderStates(1)

  // Across the wall at (3,2) near the wall face -> Euclidean distance < 9.0m, MUST BE REJECTED due to wall!
  const anchor = agent.getInteractionAnchor()
  const acrossWallPos = { x: c32.x, y: 0, z: c32.z - 1.2 }
  const distAcrossWall = Math.hypot(acrossWallPos.x - anchor.x, acrossWallPos.z - anchor.z)
  assert.ok(distAcrossWall < 9.0, `Across-wall test point (${distAcrossWall.toFixed(2)}m) is within raw distance range`)
  assert.equal(
    agent.canPlayerInteract(acrossWallPos, { row: 3, col: 2 }),
    false,
    'Interaction rejected through solid wall even within distance range'
  )
  assert.equal(agent.getInteractableDescriptor(acrossWallPos, { row: 3, col: 2 }), null)
  assert.equal(agent.interact({ playerWorldPos: acrossWallPos, playerGridCell: { row: 3, col: 2 } }).handled, false)

  // Out of range along open corridor (use small range)
  agent.setInteractionHandler({
    ...agent.getInteractionHandler(),
    range: 1.8,
  })
  assert.equal(
    agent.canPlayerInteract({ x: anchor.x + 2.5, y: 0, z: anchor.z }, { row: 1, col: 3 }),
    false,
    'Interaction rejected when out of range'
  )

  // Within range and unobstructed -> discovered with contextual labels
  const nearPos = { x: anchor.x + 1.0, y: 0, z: anchor.z }
  const desc = agent.getInteractableDescriptor(nearPos, { row: 1, col: 2 })
  assert.ok(desc, 'Unobstructed nearby hazard interactable discovered')
  assert.equal(desc.kind, 'hazard')
  assert.equal(desc.label, 'Clear Wall Rubble')
  assert.equal(desc.shortLabel, 'Clear')

  // Execute interaction -> clears aftermath and disables collider
  const res = agent.interact({ playerWorldPos: nearPos, playerGridCell: { row: 1, col: 2 } })
  assert.equal(res.handled, true)
  assert.equal(res.clearAftermath, true)
  assert.equal(agent.isAftermathCleared, true)
  assert.equal(agent.getColliderSpecs()[0].enabled, false)
  assert.equal(agent.getInteractableDescriptor(nearPos, { row: 1, col: 2 }), null, 'Prompt disappears after clearing')

  agent.dispose()
}

// ============================================================================
// 7. End-to-End MazeSceneEngine Integration: Priorities, Push-Out, Pause, Reset, Replace, Dispose
// ============================================================================
console.log('Test 7: End-to-End Engine Integration, Priorities, Push-Out, Pause, Reset, Replace & Dispose')
{
  const engine = createHeadlessEngine()
  engine.setMaze(testMaze)

  // Clear random hazards/spots for deterministic test setup
  engine.hazardManager.clear()
  engine.hidingSpotManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })

  const c12 = gridToWorld(1, 2, testMaze)
  const c13 = gridToWorld(1, 3, testMaze)
  const c15 = gridToWorld(1, 5, testMaze) // Exit cell

  // Add interactable wall_collapse at (1,2)
  let clearedCount = 0
  const haz = engine.hazardManager.addHazard({
    id: 'e2e-wall-haz',
    type: HAZARD_TYPES.WALL_COLLAPSE,
    row: 1,
    col: 2,
    wallSide: 'north',
    interaction: {
      range: 2.4,
      canInteract: (agent) => agent.state === HAZARD_STATES.DISABLED && !agent.isAftermathCleared,
      getPrompt: () => ({
        action: 'clear_debris',
        label: 'Shove Rubble Aside',
        shortLabel: 'Clear',
      }),
      onInteract: () => {
        clearedCount += 1
        return {
          handled: true,
          action: 'clear_debris',
          clearAftermath: true,
          emitSoundRange: 5.0,
        }
      },
    },
  })
  engine.syncHazardColliders({ allowPushOut: false })

  // Place player directly where the north-wall rubble will land (c12.x, c12.z - 1.4)
  engine.setPlayerWorldPosition(c12.x, 0, c12.z - 1.4, { immediate: true })
  assert.equal(engine.getStealthState().canInteract, false, 'Not interactable while dormant')

  // Step through warning + active collapse -> engine automatically enables aftermath collider AND safely pushes player out!
  engine.stepFrame(0.05, { render: false })
  assert.equal(haz.getState(), HAZARD_STATES.WARNING)
  for (let i = 0; i < 30; i += 1) {
    engine.stepFrame(0.1, { render: false })
  }
  assert.equal(haz.getState(), HAZARD_STATES.DISABLED)

  // Verify player was safely pushed south out of the newly activated rubble collider and NOT into north wall
  const pAfter = engine.getPlayerWorldPosition()
  assert.ok(
    pAfter.z > c12.z - 1.0 + PLAYER_RADIUS - 0.05,
    `Player safely pushed south of rubble (z=${pAfter.z}, rubble south edge=${c12.z - 1.0})`
  )
  const pCell = worldToGrid(pAfter.x, pAfter.z, testMaze)
  assert.ok(pCell && isCellWalkable(pCell.row, pCell.col, testMaze), 'Player remains on walkable cell after push-out')

  // Contextual hazard prompt is now active in stealthState / getNearbyInteractable()
  const stealth = engine.getStealthState()
  assert.equal(stealth.canInteract, true, 'canInteract true for nearby collapsed hazard')
  assert.equal(stealth.nearbyInteractableKind, 'hazard')
  assert.equal(stealth.nearbyInteractableId, 'e2e-wall-haz')
  assert.equal(stealth.nearbyInteractableLabel, 'Shove Rubble Aside')
  assert.equal(stealth.nearbyInteractableShortLabel, 'Clear')
  assert.equal(stealth.nearbySpotId, null, 'Hiding spot fields stay null for hazard prompt')
  assert.equal(engine.getNearbyInteractable()?.kind, 'hazard')

  // Pause suppresses prompt and blocks interact()
  engine.setPaused(true)
  assert.equal(engine.getStealthState().canInteract, false, 'Pause suppresses interaction prompt')
  assert.equal(engine.interact().handled, false, 'interact() blocked while paused')
  engine.setPaused(false)
  assert.equal(engine.getStealthState().canInteract, true, 'Unpause restores interaction prompt')

  // Priority check: add a hiding spot right next to the player -> hiding spot MUST take priority over hazard!
  engine.hidingSpotManager.addHidingSpot({
    id: 'priority-locker',
    type: HIDING_SPOT_TYPES.CONTAINMENT_LOCKER,
    row: 1,
    col: 2,
    offsetDir: { dRow: 1, dCol: 0 },
    facingYaw: Math.PI,
  })
  engine.stepFrame(0.016, { render: false })
  assert.equal(engine.getStealthState().nearbyInteractableKind, 'hiding_spot', 'Hiding spot takes prompt priority over hazard')
  assert.equal(engine.getStealthState().nearbySpotId, 'priority-locker')
  const enterRes = engine.interact()
  assert.equal(enterRes.handled, true)
  assert.equal(enterRes.action, 'enter', 'Hiding spot enter takes interact() priority over hazard')
  const exitRes = engine.interact()
  assert.equal(exitRes.handled, true)
  assert.equal(exitRes.action, 'exit', 'Hiding spot exit takes interact() priority')

  // Remove hiding spot -> now interact() dispatches to hazard and clears its aftermath collider!
  engine.hidingSpotManager.clear()
  engine.setPlayerWorldPosition(c12.x, 0, c12.z - 0.3, { immediate: true })
  engine.stepFrame(0.016, { render: false })
  const hazInteract = engine.interact()
  assert.equal(hazInteract.handled, true)
  assert.equal(hazInteract.action, 'clear_debris')
  assert.equal(hazInteract.interactableKind, 'hazard')
  assert.equal(clearedCount, 1)
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, 'e2e-wall-haz:aftermath-rubble')?.enabled,
    false,
    'Aftermath collider disabled immediately upon clearing interaction'
  )

  // Elevator extraction priority check: place an interactable hazard right next to locked exit
  engine.setExitLocked(true, { animate: false })
  engine.hazardManager.addHazard({
    id: 'exit-nearby-haz',
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row: 1,
    col: 4,
    interaction: {
      range: 4.5,
      canInteract: () => true,
      getPrompt: () => ({ action: 'toggle', label: 'Toggle Switch', shortLabel: 'Flip' }),
      onInteract: () => ({ handled: true, action: 'toggle' }),
    },
  })
  engine.setPlayerWorldPosition(c15.x - 0.8, 0, c15.z, { immediate: true })
  const exitPriority = engine.interact()
  assert.equal(exitPriority.handled, true)
  assert.equal(exitPriority.action, 'locked_exit', 'Extraction elevator retains priority over hazard interaction')

  // Game-over suppresses interaction
  engine.setPlayerWorldPosition(c13.x, 0, c13.z, { immediate: true })
  engine.applyDamage(999, { hazardId: 'test' })
  assert.equal(engine.isGameOver, true)
  assert.equal(engine.interact().handled, false, 'interact() blocked on game over')

  // Reset combat restores hazard dormant state and collider state
  engine.resetCombat()
  assert.equal(engine.isGameOver, false)
  assert.equal(haz.getState(), HAZARD_STATES.DORMANT)
  assert.equal(haz.isAftermathCleared, false)
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, 'e2e-wall-haz:aftermath-rubble')?.enabled,
    false,
    'Reset restores dormant aftermath collider disabled state'
  )

  // Maze replacement cleanly replaces dynamic colliders without leaking previous maze entries
  const secondMaze = generateMaze({ difficulty: 'easy', seed: 90909 })
  engine.setMaze(secondMaze)
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, 'e2e-wall-haz:aftermath-rubble'),
    null,
    'Old hazard colliders cleared on maze replacement'
  )

  // Verify across easy/medium/hard generated mazes that collapsing all hazards and syncing
  // NEVER enables a dynamic collider that violates navigable clearance or wall bounds
  for (const [difficulty, seed] of [
    ['easy', 90909],
    ['medium', 42424],
    ['hard', 77777],
  ]) {
    const genMaze = generateMaze({ difficulty, seed })
    engine.setMaze(genMaze)
    for (const h of engine.hazardManager.getHazards()) {
      h.state = HAZARD_STATES.DISABLED
      h.isPermanentlyCollapsed = true
      h.isDisabled = true
      h._syncColliderStates(1)
    }
    engine.syncHazardColliders({ allowPushOut: false })
    for (const [, slotIdx] of engine._propCollisionIndex.dynamicSlotsById.entries()) {
      const col = engine._propCollisionIndex.colliders[slotIdx]
      if (!col || !col.enabled) continue
      const check = validateHazardColliderPlacement(genMaze, col, {
        index: engine._propCollisionIndex,
        ignoreOwnerId: col.ownerId,
      })
      assert.equal(
        check.valid,
        true,
        `Enabled dynamic collider ${col.id} (${difficulty}) passes clearance (got ${check.clearance.toFixed(2)}m, reason=${check.reason})`
      )
    }
  }

  // Disposal cleans up all dynamic colliders cleanly
  engine.dispose()
  assert.equal(engine._propCollisionIndex, null, 'Engine disposal clears collision index')
  assert.equal(engine.hazardManager, null, 'Engine disposal clears hazardManager')
}

console.log('ALL DYNAMIC HAZARD COLLISION & INTERACTION FOUNDATION TESTS PASSED!')
