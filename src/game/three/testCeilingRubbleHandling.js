import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { resolveGridCollision } from '../world/gridCollision.js'
import {
  getDynamicCollider,
  registerDynamicCollider,
} from '../world/propCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES } from './CameraRig.js'
import { RUBBLE_CONTROLLER_STATES } from './CeilingRubbleController.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

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

function buildStraightCorridorMaze(orientation = 'ew') {
  if (orientation === 'ns') {
    // Vertical N-S corridor along col 2 (rows 1..7), with an adjacent room across a wall at col 4
    const grid = [
      [W, W, W, W, W, W],
      [W, W, S, W, P, W],
      [W, W, P, W, P, W],
      [W, W, P, W, P, W],
      [W, W, P, W, P, W],
      [W, W, P, W, P, W],
      [W, W, P, W, P, W],
      [W, W, E, W, P, W],
      [W, W, W, W, W, W],
    ]
    return {
      grid,
      rows: grid.length,
      cols: grid[0].length,
      start: { row: 1, col: 2 },
      exit: { row: 7, col: 2 },
      level: 3,
      seed: 4201,
    }
  }

  // Horizontal E-W corridor along row 2 (cols 1..7), with a parallel corridor behind wall at row 4
  const grid = [
    [W, W, W, W, W, W, W, W, W],
    [W, W, W, W, W, W, W, W, W],
    [W, S, P, P, P, P, P, E, W],
    [W, W, W, W, W, W, W, W, W],
    [W, P, P, P, P, P, P, P, W],
    [W, W, W, W, W, W, W, W, W],
  ]
  return {
    grid,
    rows: grid.length,
    cols: grid[0].length,
    start: { row: 2, col: 1 },
    exit: { row: 2, col: 7 },
    level: 3,
    seed: 4202,
  }
}

function createCollapsedCeilingEngine({
  orientation = 'ew',
  cameraMode = CAMERA_MODES.THIRD_PERSON,
} = {}) {
  const maze = buildStraightCorridorMaze(orientation)
  const hazardCell = orientation === 'ns' ? { row: 4, col: 2 } : { row: 2, col: 4 }
  const playerCell = orientation === 'ns' ? { row: 2, col: 2 } : { row: 2, col: 2 }

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
    cameraMode,
    enemies: { autoSpawn: false },
  })

  engine.setMaze(maze)
  engine.cancelSpawnSequence?.({ syncYaw: false })
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })

  const hazard = engine.hazardManager.addHazard({
    id: `cc-anim-${orientation}`,
    type: HAZARD_TYPES.CEILING_COLLAPSE,
    row: hazardCell.row,
    col: hazardCell.col,
  })
  assert.ok(hazard, 'Ceiling Collapse hazard mounted')

  // Trigger collapse via proximity, then step while player stands safely outside danger zone
  const hazWorld = gridToWorld(hazardCell.row, hazardCell.col, maze)
  hazard.update(0.05, {
    playerWorldPos: { x: hazWorld.x, y: 0, z: hazWorld.z },
    playerGridCell: hazardCell,
  })
  for (let i = 0; i < 45; i += 1) {
    hazard.update(0.06, {
      playerWorldPos: { x: hazWorld.x - 10, y: 0, z: hazWorld.z - 10 },
      playerGridCell: playerCell,
    })
  }
  assert.equal(hazard.state, HAZARD_STATES.DISABLED, 'Ceiling Collapse reaches collapsed state')
  assert.equal(hazard.isPermanentlyCollapsed, true, 'Ceiling Collapse is permanently collapsed')
  engine._syncHazardColliders({ allowPushOut: false })

  const pWorld = gridToWorld(playerCell.row, playerCell.col, maze)
  engine._playerWorldPos.x = pWorld.x
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = pWorld.z
  if (engine._playerGroup) {
    engine._playerGroup.position.set(pWorld.x, 0, pWorld.z)
  }
  engine.cameraRig?.setPlayerPosition(pWorld.x, 0, pWorld.z)
  engine.cameraRig?.snap?.()

  return { engine, maze, hazard, hazardCell, playerCell }
}

/**
 * Positions the player cleanly outside a target rubble piece and aims the active camera
 * directly at that exact slab's world center so Three.js raycast hits it deterministically.
 */
function aimCameraAtPiece(engine, piece, standOffset = { dx: -1.45, dz: 0 }) {
  piece.mesh.updateMatrixWorld(true)
  const target = new THREE.Vector3()
  piece.mesh.getWorldPosition(target)

  const px = target.x + standOffset.dx
  const pz = target.z + standOffset.dz
  engine._playerWorldPos.x = px
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = pz
  if (engine._playerGroup) {
    engine._playerGroup.position.set(px, 0, pz)
  }
  engine.cameraRig?.setPlayerPosition(px, 0, pz)

  const dx = target.x - px
  const dz = target.z - pz
  const yaw = Math.atan2(-dx, -dz)
  if (engine._playerGroup) {
    engine._playerGroup.rotation.y = yaw
  }

  // First snap camera at yaw, then compute exact pitch from actual camera position to slab center
  engine.cameraRig?.setLookDirection(yaw, -0.35)
  engine.cameraRig?.snap?.()
  const cam = engine.cameraRig?.camera || engine.camera
  cam.updateMatrixWorld(true)
  const cdx = target.x - cam.position.x
  const cdy = target.y - cam.position.y
  const cdz = target.z - cam.position.z
  const horiz = Math.max(1e-4, Math.hypot(cdx, cdz))
  const exactYaw = Math.atan2(-cdx, -cdz)
  const exactPitch = Math.atan2(cdy, horiz)
  engine.cameraRig?.setLookDirection(exactYaw, exactPitch)
  engine.cameraRig?.snap?.()
  cam.updateMatrixWorld(true)
  return target
}

function findNearestPieceToPlayerSide(hazard, sideX, sideZ) {
  const pieces = hazard.getRubblePieces()
  let best = null
  let bestDist = Infinity
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i]
    const d = Math.hypot(p.worldPos.x - sideX, p.worldPos.z - sideZ)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

function getWorldPos(mesh) {
  mesh.updateMatrixWorld(true)
  const v = new THREE.Vector3()
  mesh.getWorldPosition(v)
  return v
}

function runSteps(engine, count, dt = 0.05, inputState = null) {
  for (let i = 0; i < count; i += 1) {
    if (inputState) {
      engine.stepMovement(inputState, dt, { updateAnimation: false })
    }
    engine.stepFrame(dt)
  }
}

console.log('Running MAZE-HAZARD-CEILING-ANIM-001 test suite...')

// ============================================================================
// TEST 1 & 4: Left-click raycast targeting, individual slab pickup, & F-key removal
// ============================================================================
{
  const { engine, hazard } = createCollapsedCeilingEngine({ orientation: 'ew' })
  const pieces = hazard.getRubblePieces()
  assert.ok(pieces.length >= 8, `Expected multiple individual large rubble slabs, got ${pieces.length}`)

  // Pick nearest slab on the west edge of the collapsed pile (player approaches from west)
  const westApproachX = hazard.dangerWorldPos.x - 4.0
  const targetPiece = findNearestPieceToPlayerSide(hazard, westApproachX, hazard.dangerWorldPos.z)
  aimCameraAtPiece(engine, targetPiece, { dx: -1.35, dz: 0 })

  // Verify F key no longer triggers or prompts for Ceiling Collapse
  assert.equal(hazard.getInteractionHandler(), null, 'Ceiling Collapse has no F-key interaction handler')
  assert.equal(
    hazard.canPlayerInteract(engine.getPlayerWorldPosition(), engine.getPlayerGridCell()),
    false,
    'Ceiling Collapse rejects F-key interaction check'
  )
  assert.equal(
    hazard.getInteractableDescriptor(engine.getPlayerWorldPosition()),
    null,
    'Ceiling Collapse exposes no F-key prompt descriptor'
  )
  assert.equal(typeof engine.interact, 'undefined', 'Legacy F-key engine.interact() is completely removed')
  assert.equal(hazard.isAftermathCleared, false, 'Ceiling Collapse aftermath stays uncleared until manually moved')

  // Verify raycast targeting highlights ONLY the targeted slab
  engine.stepFrame(0.016)
  const snap = engine.getRubbleInteractionState()
  assert.equal(snap.canPickup, true, 'Raycast targeting identifies valid reachable rubble slab')
  assert.equal(snap.targetedPieceId, targetPiece.pieceId, 'Targets the exact individual slab aimed at')
  assert.equal(
    targetPiece.mesh.material,
    targetPiece.mesh.userData.highlightMaterial,
    'Targeted slab displays subtle highlight material'
  )
  for (const other of pieces) {
    if (other.pieceId !== targetPiece.pieceId) {
      assert.equal(
        other.mesh.material,
        other.mesh.userData.baseMaterial,
        'Non-targeted slabs are NOT highlighted (no whole-pile selection)'
      )
    }
  }

  // Left-click initiates pickup sequence
  const pickRes = engine.handlePrimaryAction()
  assert.equal(pickRes.handled, true, 'Left-click initiates pickup on targeted slab')
  assert.equal(pickRes.pieceId, targetPiece.pieceId, 'Pickup targets only the clicked slab')
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.PICKING_UP,
    'Transitions into PICKING_UP state'
  )

  engine.dispose()
  console.log('  [PASS] 1 & 4: Left-click individual targeting/pickup & F-key removal verified')
}

// ============================================================================
// TEST 2 & 3: Rejection of invalid targets, out-of-range, and wall/prop occlusion
// ============================================================================
{
  const { engine, maze, hazard } = createCollapsedCeilingEngine({ orientation: 'ew' })
  const westApproachX = hazard.dangerWorldPos.x - 4.0
  const targetPiece = findNearestPieceToPlayerSide(hazard, westApproachX, hazard.dangerWorldPos.z)

  // 2a. Aim away at empty wall/ceiling -> rejected
  aimCameraAtPiece(engine, targetPiece, { dx: -1.35, dz: 0 })
  engine.cameraRig.setLookDirection(Math.PI, 0.5) // looking away and up at ceiling
  engine.cameraRig.snap()
  engine.stepFrame(0.016)
  assert.equal(engine.handlePrimaryAction().handled, false, 'Looking away at ceiling/wall cannot pick up rubble')

  // 2b. Out-of-range slab (> interactionRange) -> rejected
  aimCameraAtPiece(engine, targetPiece, { dx: -3.6, dz: 0 })
  engine.stepFrame(0.016)
  assert.equal(engine.getRubbleInteractionState().canPickup, false, 'Out-of-range rubble is not targetable')
  assert.equal(engine.handlePrimaryAction().handled, false, 'Out-of-range left-click is rejected')

  // 3a. Behind a solid maze wall (parallel corridor row 4 separated by wall row 3) -> rejected!
  const behindWallPos = gridToWorld(4, 4, maze)
  engine._playerWorldPos.x = behindWallPos.x
  engine._playerWorldPos.z = behindWallPos.z
  engine._playerGroup.position.set(behindWallPos.x, 0, behindWallPos.z)
  engine.cameraRig.setPlayerPosition(behindWallPos.x, 0, behindWallPos.z)
  const slabPos = getWorldPos(targetPiece.mesh)
  const wallYaw = Math.atan2(-(slabPos.x - behindWallPos.x), -(slabPos.z - behindWallPos.z))
  engine.cameraRig.setLookDirection(wallYaw, -0.25)
  engine.cameraRig.snap()
  engine.stepFrame(0.016)
  assert.equal(engine.getRubbleInteractionState().canPickup, false, 'Wall blocks rubble targeting')
  assert.equal(engine.handlePrimaryAction().handled, false, 'Cannot pick up rubble through solid wall')

  // 3b. Blocked by a solid prop placed between player and slab -> rejected!
  const aimPos = aimCameraAtPiece(engine, targetPiece, { dx: -1.85, dz: 0 })
  const midX = (engine._playerWorldPos.x + aimPos.x) * 0.5
  const midZ = (engine._playerWorldPos.z + aimPos.z) * 0.5
  const blockerMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.8, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x555555 })
  )
  blockerMesh.position.set(midX, 0.9, midZ)
  engine._mazeGroup.add(blockerMesh)
  engine.getRubbleController()._lastOcclMazeRef = null // refresh occluder cache
  registerDynamicCollider(engine._propCollisionIndex, {
    id: 'test-solid-blocker-prop',
    ownerId: 'test-blocker',
    kind: 'obb',
    cx: midX,
    cz: midZ,
    halfW: 0.45,
    halfD: 0.45,
    yaw: 0,
    enabled: true,
  })
  engine.stepFrame(0.016)
  assert.equal(engine.getRubbleInteractionState().canPickup, false, 'Solid prop blocks rubble targeting')
  assert.equal(engine.handlePrimaryAction().handled, false, 'Cannot pick up rubble through solid prop')

  engine.dispose()
  console.log('  [PASS] 2 & 3: Invalid targets, out-of-range, and wall/prop occlusion verified')
}

// ============================================================================
// TEST 5, 6, 7, 10, 13: Full pickup animation timing, carry stability, walking/turning/stopping,
//                       right-click placement timing, collision sync, & neighboring pieces intact
// ============================================================================
{
  const { engine, hazard } = createCollapsedCeilingEngine({ orientation: 'ew' })
  const pieces = hazard.getRubblePieces()
  const westApproachX = hazard.dangerWorldPos.x - 4.0
  const targetPiece = findNearestPieceToPlayerSide(hazard, westApproachX, hazard.dangerWorldPos.z)
  const neighborsBefore = pieces
    .filter((p) => p.pieceId !== targetPiece.pieceId)
    .map((p) => ({
      pieceId: p.pieceId,
      pos: getWorldPos(p.mesh),
      col: { ...getDynamicCollider(engine._propCollisionIndex, p.colliderId) },
    }))

  const baseWalkSpeed = engine.getMovementConfig().walkSpeed
  const baseSprintSpeed = engine.getMovementConfig().sprintSpeed

  // Before pickup: target slab's solid collider is ENABLED
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, targetPiece.colliderId)?.enabled,
    true,
    'Target slab has enabled solid collider before pickup'
  )

  const initialWorldPos = getWorldPos(targetPiece.mesh)
  aimCameraAtPiece(engine, targetPiece, { dx: -1.35, dz: 0 })
  engine.stepFrame(0.016)
  assert.equal(engine.handlePrimaryAction().handled, true)

  // Step to ~49% of pickup (just BEFORE attach threshold 0.52):
  // Character must be in deep crouch & reach, while slab MUST NOT teleport off floor yet!
  runSteps(engine, 9, 0.05) // 0.45s / 0.92s ≈ 0.489 < 0.52
  const midPickupState = engine.getRubbleInteractionState()
  assert.equal(midPickupState.state, RUBBLE_CONTROLLER_STATES.PICKING_UP)
  assert.equal(midPickupState.attached, false, 'Slab NOT attached prematurely before lift-contact point')
  const posBeforeAttach = getWorldPos(targetPiece.mesh)
  assert.ok(
    posBeforeAttach.distanceTo(initialWorldPos) < 0.02,
    'Slab remains stationary on floor prior to hand-contact attach point (no instant teleport)'
  )
  const animMidPickup = engine._playerAnimator.getRubbleState()
  assert.ok(animMidPickup.rubbleCrouch > 0.55, `Character crouches during reach (crouch=${animMidPickup.rubbleCrouch})`)
  assert.ok(animMidPickup.rubbleReach > 0.55, `Character arms reach down (reach=${animMidPickup.rubbleReach})`)
  assert.ok(
    engine._playerGroup.userData.rig.pelvisPivot.position.y < 0.85,
    `Pelvis lowers analytically during deep crouch (y=${engine._playerGroup.userData.rig.pelvisPivot.position.y.toFixed(3)})`
  )
  assert.ok(
    engine._playerGroup.userData.rig.leftKneePivot.rotation.x < -0.6,
    'Knees flex deeply during pickup crouch'
  )

  // Step past attach threshold (0.52) and through completion of pickup lift (1.0)
  runSteps(engine, 13, 0.05) // +0.65s -> total 1.10s > 0.92s
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.CARRYING,
    'Transitions cleanly to CARRYING after lift recovery'
  )
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, targetPiece.colliderId)?.enabled,
    false,
    'Carried slab floor collider disabled while held in hands'
  )

  // Verify slab is lifted cleanly to hand height & global base walk/sprint speeds unchanged
  const carriedPosIdle = getWorldPos(targetPiece.mesh)
  assert.ok(
    carriedPosIdle.y > initialWorldPos.y + 0.5,
    `Carried slab lifted up to hand height (y=${carriedPosIdle.y.toFixed(2)})`
  )
  assert.equal(engine.getMovementConfig().walkSpeed, baseWalkSpeed, 'Global walkSpeed unchanged')
  assert.equal(engine.getMovementConfig().sprintSpeed, baseSprintSpeed, 'Global sprintSpeed unchanged')

  // Test 6: Stable hand attachment while walking, turning, and stopping + heavy carry speed slowdown
  const startWalkX = engine._playerWorldPos.x
  // Face west (away from pile down open corridor) and walk with sprint held (sprint must be suppressed!)
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0) // -sin(pi/2) = -1 (-X west)
  engine.cameraRig.snap()
  engine.stepFrame(0.016)

  const carryWalkSamples = []
  for (let i = 0; i < 12; i += 1) {
    engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: true }, 0.05, {
      updateAnimation: false,
    })
    engine.stepFrame(0.05)
    const p = engine.getPlayerWorldPosition()
    const s = getWorldPos(targetPiece.mesh)
    carryWalkSamples.push(Math.hypot(s.x - p.x, s.z - p.z))
  }
  const distWalkedCarry = Math.abs(engine._playerWorldPos.x - startWalkX)
  const expectedNormalWalk = baseWalkSpeed * (12 * 0.05)
  assert.ok(
    distWalkedCarry > 0.5 && distWalkedCarry < expectedNormalWalk * 0.8,
    `Carrying applies heavy speed reduction without blocking movement (walked=${distWalkedCarry.toFixed(2)}m vs normal=${expectedNormalWalk.toFixed(2)}m)`
  )
  assert.equal(engine._isSprintingThisTick, false, 'Sprint suppressed while carrying heavy rubble')
  const maxHandSpread = Math.max(...carryWalkSamples) - Math.min(...carryWalkSamples)
  assert.ok(
    maxHandSpread < 0.25,
    `Carried slab stays stably attached while walking (radial variance=${maxHandSpread.toFixed(3)}m)`
  )

  // Turn 90 deg toward North corridor wall (-Z) and stop: slab must rotate smoothly with hands
  engine.cameraRig.setLookDirection(0, 0) // faces -Z (North wall)
  engine.cameraRig.snap()
  runSteps(engine, 5, 0.05, { forwardAxis: 0, strafeAxis: 0, sprint: false })
  const pTurned = engine.getPlayerWorldPosition()
  const sTurned = getWorldPos(targetPiece.mesh)
  assert.ok(
    sTurned.z < pTurned.z - 0.15,
    'Carried slab follows player heading cleanly when turning toward North wall'
  )

  // Test 7 & 8: Right-click placement near corridor wall
  const placeRes = engine.handleSecondaryAction()
  assert.equal(placeRes.handled, true, 'Right-click starts placement near North corridor wall')
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.PLACING,
    'Transitions into PLACING state'
  )

  // Before release threshold (0.55): slab NOT yet released, floor collider still disabled
  runSteps(engine, 5, 0.05) // 0.25s / 0.84s ≈ 0.30
  assert.equal(engine.getRubbleInteractionState().released, false, 'Slab not released prematurely during lowering')
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, targetPiece.colliderId)?.enabled,
    false,
    'Collider stays disabled until release moment'
  )

  // Advance through release (0.55) and completion (1.0)
  runSteps(engine, 16, 0.05)
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.IDLE,
    'Returns cleanly to IDLE after controlled placement rise'
  )
  assert.equal(targetPiece.state, 'placed', 'Piece marked placed')

  const placedPos = getWorldPos(targetPiece.mesh)
  assert.ok(placedPos.y > 0.04 && placedPos.y < 0.28, `Placed slab rests grounded on floor (y=${placedPos.y.toFixed(3)})`)
  assert.ok(
    placedPos.distanceTo(initialWorldPos) > 1.0,
    'Placed slab physically relocated to new wall-side spot'
  )

  // Test 10: Solid world-space collision restored at placed location -> player CANNOT walk through it!
  const placedCol = getDynamicCollider(engine._propCollisionIndex, targetPiece.colliderId)
  assert.equal(placedCol?.enabled, true, 'Placed slab re-enables solid world-space collider')
  assert.ok(
    Math.hypot(placedCol.cx - placedPos.x, placedCol.cz - placedPos.z) < 0.05,
    'Placed collider center matches rendered slab world transform'
  )
  const hitCheck = resolveGridCollision(
    placedCol.cx,
    placedCol.cz,
    engine._currentMaze,
    {
      radius: PLAYER_RADIUS,
      propColliders: engine._propCollisionIndex,
    }
  )
  assert.equal(hitCheck.collided, true, 'Player footprint collides solidly with wall-placed rubble')

  // Test 13: Verify moving one slab NEVER moved or deleted any neighboring large slabs!
  for (const nb of neighborsBefore) {
    const pieceNow = hazard.getRubblePiece(nb.pieceId)
    assert.ok(pieceNow, `Neighboring slab ${nb.pieceId} still exists`)
    const posNow = getWorldPos(pieceNow.mesh)
    assert.ok(
      posNow.distanceTo(nb.pos) < 1e-3,
      `Neighboring slab ${nb.pieceId} did not shift when another slab was moved`
    )
    const colNow = getDynamicCollider(engine._propCollisionIndex, nb.pieceId)
    assert.equal(colNow?.enabled, true, `Neighboring slab ${nb.pieceId} collider remains solid`)
    assert.ok(
      Math.hypot(colNow.cx - nb.col.cx, colNow.cz - nb.col.cz) < 1e-3,
      `Neighboring slab ${nb.pieceId} collider position unchanged`
    )
  }

  engine.dispose()
  console.log('  [PASS] 5, 6, 7, 8, 10 & 13: Pickup/carry/place animation, wall placement, solid collision & neighbor isolation verified')
}

// ============================================================================
// TEST 9: Invalid placement rejection without losing carried piece
// ============================================================================
{
  const { engine, maze, hazard } = createCollapsedCeilingEngine({ orientation: 'ew' })
  const westApproachX = hazard.dangerWorldPos.x - 4.0
  const targetPiece = findNearestPieceToPlayerSide(hazard, westApproachX, hazard.dangerWorldPos.z)

  aimCameraAtPiece(engine, targetPiece, { dx: -1.35, dz: 0 })
  engine.stepFrame(0.016)
  assert.equal(engine.handlePrimaryAction().handled, true)
  runSteps(engine, 22, 0.05)
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.CARRYING)

  // Stand right against the North wall looking straight into the solid wall, AND surround the local
  // forward drop zone with temporary solid colliders so NO valid local spot exists
  const cellWorld = gridToWorld(2, 2, maze)
  engine._playerWorldPos.x = cellWorld.x
  engine._playerWorldPos.z = cellWorld.z - 1.2 // hugging North wall
  engine._playerGroup.position.set(engine._playerWorldPos.x, 0, engine._playerWorldPos.z)
  engine.cameraRig.setPlayerPosition(engine._playerWorldPos.x, 0, engine._playerWorldPos.z)
  engine.cameraRig.setLookDirection(0, 0) // facing straight into solid North wall
  engine.cameraRig.snap()

  // Also test validatePlacementCandidate directly for wall intersection & player overlap
  const ctrl = engine.getRubbleController()
  const wallCandidate = ctrl.validatePlacementCandidate(
    cellWorld.x,
    cellWorld.z - CELL_SIZE * 0.5 - 0.5, // inside North wall cell
    0,
    targetPiece
  )
  assert.equal(wallCandidate.valid, false, 'Rejects placement inside solid maze wall')

  const playerOverlapCandidate = ctrl.validatePlacementCandidate(
    engine._playerWorldPos.x,
    engine._playerWorldPos.z,
    0,
    targetPiece
  )
  assert.equal(playerOverlapCandidate.valid, false, 'Rejects placement overlapping player')

  const badPlaceRes = engine.handleSecondaryAction()
  assert.equal(badPlaceRes.handled, false, 'Right-click refuses invalid placement into solid wall')
  assert.equal(
    ctrl.getStateName(),
    RUBBLE_CONTROLLER_STATES.CARRYING,
    'Carried slab is NOT lost when placement is refused'
  )
  assert.equal(
    engine.getRubbleInteractionState().carriedPieceId,
    targetPiece.pieceId,
    'Player still holds the exact same rubble slab after rejected placement'
  )

  engine.dispose()
  console.log('  [PASS] 9: Invalid placement rejection preserves carried slab')
}

// ============================================================================
// TEST 11 & 12: Safe WASD interruption (all 4 phases) & persistence until level reset
// ============================================================================
{
  const { engine, maze, hazard } = createCollapsedCeilingEngine({ orientation: 'ew' })
  const westApproachX = hazard.dangerWorldPos.x - 4.0
  const targetPiece = findNearestPieceToPlayerSide(hazard, westApproachX, hazard.dangerWorldPos.z)
  const initialPos = getWorldPos(targetPiece.mesh)

  // 11a. Interrupt PICKUP before attach (t < 0.52) -> piece remains untouched in world
  aimCameraAtPiece(engine, targetPiece, { dx: -1.35, dz: 0 })
  engine.stepFrame(0.016)
  assert.equal(engine.handlePrimaryAction().handled, true)
  runSteps(engine, 5, 0.05) // 0.25s < 0.48s attach
  assert.equal(engine.getRubbleInteractionState().attached, false)
  engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.05)
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.IDLE,
    'WASD before attach cancels pickup cleanly to IDLE'
  )
  assert.equal(targetPiece.state, 'fallen', 'Piece restored cleanly to fallen state')
  assert.ok(
    getWorldPos(targetPiece.mesh).distanceTo(initialPos) < 0.02,
    'Cancelled pickup leaves slab untouched at original position'
  )
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, targetPiece.colliderId)?.enabled,
    true,
    'Cancelled pickup preserves solid floor collider'
  )

  // 11b. Interrupt PICKUP after attach (t >= 0.52) -> transitions smoothly into CARRYING
  aimCameraAtPiece(engine, targetPiece, { dx: -1.35, dz: 0 })
  engine.stepFrame(0.016)
  assert.equal(engine.handlePrimaryAction().handled, true)
  runSteps(engine, 12, 0.05) // 0.60s > 0.48s attach, < 0.92s full
  assert.equal(engine.getRubbleInteractionState().attached, true, 'Piece attached at lift point')
  engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.05)
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.CARRYING,
    'WASD after attach transitions smoothly straight into CARRYING'
  )
  assert.equal(engine.getRubbleInteractionState().carriedPieceId, targetPiece.pieceId)

  // Walk to open cell (row 2, col 2) and test placement interruptions
  const openPos = gridToWorld(2, 2, maze)
  engine._playerWorldPos.x = openPos.x
  engine._playerWorldPos.z = openPos.z
  engine._playerGroup.position.set(openPos.x, 0, openPos.z)
  engine.cameraRig.setPlayerPosition(openPos.x, 0, openPos.z)
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0) // facing west open corridor
  engine.cameraRig.snap()
  engine.stepFrame(0.016)

  // 11c. Interrupt PLACEMENT before release (t < 0.55) -> slab stays in hands (CARRYING)
  assert.equal(engine.handleSecondaryAction().handled, true)
  runSteps(engine, 4, 0.05) // 0.20s < 0.46s release
  assert.equal(engine.getRubbleInteractionState().released, false)
  engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.05)
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.CARRYING,
    'WASD before release cancels placement and keeps slab in hands'
  )
  assert.equal(engine.getRubbleInteractionState().carriedPieceId, targetPiece.pieceId)

  // 11d. Interrupt PLACEMENT after release (t >= 0.55) -> placed slab stays permanently at placed spot!
  engine._playerWorldPos.x = openPos.x
  engine._playerWorldPos.z = openPos.z
  engine._playerGroup.position.set(openPos.x, 0, openPos.z)
  engine.cameraRig.setPlayerPosition(openPos.x, 0, openPos.z)
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0)
  engine.cameraRig.snap()
  engine.stepFrame(0.016)
  assert.equal(engine.handleSecondaryAction().handled, true)
  runSteps(engine, 11, 0.05) // 0.55s > 0.46s release, < 0.84s full
  assert.equal(engine.getRubbleInteractionState().released, true, 'Piece released onto floor')
  const placedSpot = getWorldPos(targetPiece.mesh)

  engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.05)
  assert.equal(
    engine.getRubbleController().getStateName(),
    RUBBLE_CONTROLLER_STATES.IDLE,
    'WASD after release exits placement cleanly to IDLE'
  )
  assert.equal(targetPiece.state, 'placed')
  assert.ok(
    getWorldPos(targetPiece.mesh).distanceTo(placedSpot) < 0.02,
    'Released slab remains at placed position after WASD interruption (never resets!)'
  )

  // 12. Persistence across ticks and subsequent interactions until resetCombat()
  runSteps(engine, 30, 0.05)
  assert.ok(
    getWorldPos(targetPiece.mesh).distanceTo(placedSpot) < 0.02,
    'Placed slab persists across simulation frames'
  )
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, targetPiece.colliderId)?.enabled,
    true,
    'Placed slab collision persists across frames'
  )

  // Full reset restores hazard & rubble pieces to dormant default
  engine.resetCombat()
  assert.equal(hazard.state, HAZARD_STATES.DORMANT, 'resetCombat resets hazard to dormant')
  assert.equal(targetPiece.state, 'fallen', 'resetCombat resets piece state')
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, targetPiece.colliderId)?.enabled,
    false,
    'resetCombat disables collapsed rubble colliders'
  )

  engine.dispose()
  console.log('  [PASS] 11 & 12: Safe WASD interruption (all 4 phases) & persistence/reset verified')
}

// ============================================================================
// TEST 14: North-South corridor orientation parity
// ============================================================================
{
  const { engine, hazard } = createCollapsedCeilingEngine({ orientation: 'ns' })
  const northApproachZ = hazard.dangerWorldPos.z - 4.0
  const targetPiece = findNearestPieceToPlayerSide(hazard, hazard.dangerWorldPos.x, northApproachZ)

  aimCameraAtPiece(engine, targetPiece, { dx: 0, dz: -1.35 })
  engine.stepFrame(0.016)
  assert.equal(engine.getRubbleInteractionState().canPickup, true, 'NS corridor targeting succeeds')
  assert.equal(engine.handlePrimaryAction().handled, true, 'NS corridor pickup succeeds')

  runSteps(engine, 22, 0.05)
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.CARRYING)

  // Carry north along N-S corridor and place flush near East wall
  engine.cameraRig.setLookDirection(0, 0) // -Z north
  engine.cameraRig.snap()
  runSteps(engine, 14, 0.05, { forwardAxis: 1, strafeAxis: 0, sprint: false })
  engine.cameraRig.setLookDirection(-Math.PI * 0.5, 0) // +X east wall
  engine.cameraRig.snap()
  engine.stepFrame(0.016)

  const placeRes = engine.handleSecondaryAction()
  assert.equal(placeRes.handled, true, 'NS corridor right-click placement near wall succeeds')
  runSteps(engine, 22, 0.05)
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.IDLE)
  assert.equal(targetPiece.state, 'placed')
  assert.equal(
    getDynamicCollider(engine._propCollisionIndex, targetPiece.colliderId)?.enabled,
    true,
    'NS placed slab restores solid world-space collision'
  )

  engine.dispose()
  console.log('  [PASS] 14: North-South corridor orientation parity verified')
}

// ============================================================================
// TEST 15: First-person and third-person camera mode compatibility
// ============================================================================
{
  const { engine, hazard } = createCollapsedCeilingEngine({
    orientation: 'ew',
    cameraMode: CAMERA_MODES.FIRST_PERSON,
  })
  assert.equal(engine._playerGroup.visible, false, 'First-person hides full player body while idle')

  const westApproachX = hazard.dangerWorldPos.x - 4.0
  const targetPiece = findNearestPieceToPlayerSide(hazard, westApproachX, hazard.dangerWorldPos.z)
  aimCameraAtPiece(engine, targetPiece, { dx: -1.35, dz: 0 })
  engine.stepFrame(0.016)

  assert.equal(engine.getRubbleInteractionState().canPickup, true, 'First-person raycast targets rubble')
  assert.equal(engine.handlePrimaryAction().handled, true, 'First-person left-click pickup succeeds')

  // During pickup/carry in first-person: arms are visible while head/torso remain hidden (zero camera clip!)
  assert.equal(engine._playerGroup.visible, true, 'First-person shows player group in arms-only mode while handling rubble')
  const headPivot = engine._playerGroup.userData.rig.headPivot
  let anyHeadMeshVisible = false
  headPivot.traverse((o) => {
    if (o.isMesh && o.visible) anyHeadMeshVisible = true
  })
  assert.equal(anyHeadMeshVisible, false, 'First-person keeps head meshes hidden so camera never clips inside head')

  const leftArmPivot = engine._playerGroup.userData.rig.leftShoulderPivot
  let anyArmMeshVisible = false
  leftArmPivot.traverse((o) => {
    if (o.isMesh && o.visible) anyArmMeshVisible = true
  })
  assert.equal(anyArmMeshVisible, true, 'First-person displays character arms/hands while lifting & carrying rubble')

  runSteps(engine, 22, 0.05)
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.CARRYING)

  // Verify carried slab sits cleanly in front of first-person camera
  const cam = engine.cameraRig.camera
  cam.updateMatrixWorld(true)
  const slabFpPos = getWorldPos(targetPiece.mesh)
  const distFromCam = slabFpPos.distanceTo(cam.position)
  assert.ok(
    distFromCam > 0.35 && distFromCam < 1.2,
    `First-person carried slab stays comfortably in front of camera (dist=${distFromCam.toFixed(2)}m)`
  )

  // Switch dynamically from first-person to third-person mid-carry -> full character body appears cleanly!
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
  engine.stepFrame(0.016)
  let headVisibleInThird = false
  headPivot.traverse((o) => {
    if (o.isMesh && o.visible) headVisibleInThird = true
  })
  assert.equal(headVisibleInThird, true, 'Switching to third-person mid-carry restores full player rig visibility')

  // Switch back to first-person, walk back to clear space, and place rubble
  engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
  engine.cameraRig.setLookDirection(Math.PI * 0.5, 0) // face west open corridor
  engine.cameraRig.snap()
  runSteps(engine, 10, 0.05, { forwardAxis: 1, strafeAxis: 0, sprint: false })
  assert.equal(engine.handleSecondaryAction().handled, true, 'First-person right-click placement succeeds')
  runSteps(engine, 22, 0.05)
  assert.equal(engine.getRubbleController().getStateName(), RUBBLE_CONTROLLER_STATES.IDLE)
  assert.equal(
    engine._playerGroup.visible,
    false,
    'First-person restores hidden player mesh once rubble placement completes'
  )

  engine.dispose()
  console.log('  [PASS] 15: First-person & third-person camera compatibility verified')
}

console.log('ALL 15 MAZE-HAZARD-CEILING-ANIM-001 TESTS PASSED!')
