/**
 * End-to-End Automated Verification Suite for MAZE-HAZARD-FURNITURE-ANIM-001
 * Physical Rotten Furniture Collapse Clearing, Coupled Player-Furniture Movement,
 * Multi-Phase Procedural Character Animation & Camera Perspective Parity.
 */

import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { moveWithSubsteps, resolveGridCollision } from '../world/gridCollision.js'
import { getDynamicCollider } from '../world/propCollision.js'
import { CAMERA_MODES } from './CameraRig.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  FURNITURE_ANIM_MODES,
  FURNITURE_HANDLING_STATES,
} from './RottenFurnitureController.js'
import {
  CROSSHAIR_TARGET_STATES,
  resolveCrosshairFeedbackState,
} from '../../components/game/centerCrosshairState.js'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    console.error(`  ✗ FAIL: ${message}`)
  }
}

function createMockHost(width = 960, height = 540) {
  return {
    clientWidth: width,
    clientHeight: height,
    children: [],
    appendChild(child) {
      this.children.push(child)
      child.parentNode = this
    },
    removeChild(child) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) this.children.splice(idx, 1)
      child.parentNode = null
    },
  }
}

function createHeadlessEngine(config = {}) {
  const host = createMockHost()
  return new MazeSceneEngine(host, {
    isSoftwareGl: true,
    skipSpawnSequence: true,
    enemies: { autoSpawn: false },
    createRenderer: () => ({
      domElement: { style: {}, parentNode: null },
      shadowMap: { enabled: false, type: null, needsUpdate: false },
      info: {
        render: { calls: 0, triangles: 0 },
        memory: { geometries: 0, textures: 0 },
      },
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 1.0,
      setPixelRatio() {},
      setSize() {},
      render() {},
      dispose() {},
    }),
    ...config,
  })
}

function buildTwoTileCorridorMaze() {
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  // Straight East-West corridor in row 1 (4.0m wide = two 2.0m walking lanes: localZ in [-2.0, +2.0])
  // plus isolated parallel corridor in row 3 separated by solid wall in row 2
  return {
    rows: 5,
    cols: 9,
    cellSize: CELL_SIZE,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 7 },
    grid: [
      [W, W, W, W, W, W, W, W, W],
      [W, P, P, P, P, P, P, P, W],
      [W, W, W, W, W, W, W, W, W],
      [W, P, P, P, P, P, P, P, W],
      [W, W, W, W, W, W, W, W, W],
    ],
  }
}

function collapseFurnitureHazard(engine, hazard) {
  const triggerPos = hazard.dangerWorldPos || hazard.worldPos
  engine.setPlayerWorldPosition(triggerPos.x, 0, triggerPos.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  // Move player back to safe side while furniture collapses
  const safeCell = gridToWorld(1, 2, engine.getMaze())
  engine.setPlayerWorldPosition(safeCell.x - 1.2, 0, safeCell.z, {
    immediate: true,
  })
  const totalCollapseSec =
    (hazard.config?.warningDuration || 0.85) +
    (hazard.config?.activeDuration || 0.9) +
    0.35
  const steps = Math.ceil(totalCollapseSec / 0.05)
  for (let i = 0; i < steps; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }
}

function computeRigBootMinWorldY(playerGroup) {
  playerGroup.updateMatrixWorld(true)
  const rig = playerGroup.userData?.rig
  let minY = Infinity
  for (const ankle of [rig?.leftAnklePivot, rig?.rightAnklePivot]) {
    if (!ankle) continue
    const box = new THREE.Box3().setFromObject(ankle)
    if (box.min.y < minY) minY = box.min.y
  }
  return minY
}

function aimCameraAtFurniture(engine, hazard, px, pz) {
  const pose = hazard.getFurniturePose()
  const targetLx = pose.centerLocalX - pose.halfW * 0.45
  const targetLz = pose.centerLocalZ
  const targetX = pose.baseX + targetLx * pose.cosYaw + targetLz * pose.sinYaw
  const targetZ = pose.baseZ - targetLx * pose.sinYaw + targetLz * pose.cosYaw
  const targetY = Math.max(0.28, pose.gripHeightY * 0.72)

  engine.setPlayerWorldPosition(px, 0, pz, { immediate: true })
  const dx = targetX - px
  const dz = targetZ - pz
  const initYaw = Math.atan2(-dx, -dz)
  engine.setLookDirection(initYaw, -0.35)
  engine.cameraRig?.snap?.()

  const cam = engine.camera
  cam.updateMatrixWorld(true)
  const cdx = targetX - cam.position.x
  const cdy = targetY - cam.position.y
  const cdz = targetZ - cam.position.z
  const horiz = Math.max(1e-4, Math.hypot(cdx, cdz))
  const exactYaw = Math.atan2(-cdx, -cdz)
  const exactPitch = Math.atan2(cdy, horiz)
  engine.setLookDirection(exactYaw, exactPitch)
  engine.cameraRig?.snap?.()
  cam.updateMatrixWorld(true)
}

function runSuite() {
  console.log('=== MAZE-HAZARD-FURNITURE-ANIM-001 Automated Test Suite ===')

  const maze = buildTwoTileCorridorMaze()
  const engine = createHeadlessEngine()
  engine.setMaze(maze)
  engine.cancelSpawnSequence()
  engine.hazardManager.clear()
  engine.hidingSpotManager?.clear?.()

  // Disable any static props so collision tests measure the furniture hazard purely
  for (let i = 0; i < engine._propCollisionIndex.colliders.length; i += 1) {
    const col = engine._propCollisionIndex.colliders[i]
    if (col) {
      col.enabled = false
    }
  }
  engine.syncHidingSpotColliders?.()
  engine.syncHazardColliders({ allowPushOut: false })

  const hazard = engine.hazardManager.addHazard({
    id: 'test-rotten-furniture-001',
    type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
    row: 1,
    col: 4,
    wallSide: 'north',
  })
  engine.syncHazardColliders({ allowPushOut: false })

  // Collapse the furniture hazard into its aftermath state
  collapseFurnitureHazard(engine, hazard)
  assert(
    hazard.getState() === HAZARD_STATES.DISABLED &&
      hazard.isCollapsedForFurnitureHandling() === true,
    '1a. Rotten Furniture Collapse reaches collapsed aftermath state and is ready for physical handling'
  )

  const cell14 = gridToWorld(1, 4, maze)
  const northLaneZ = cell14.z - 1.0
  const centerLaneZ = cell14.z
  const southLaneZ = cell14.z + 1.0

  // Verify initial fallen aftermath blocks both corridor lanes
  for (const laneZ of [northLaneZ, centerLaneZ, southLaneZ]) {
    const startX = cell14.x - 3.6
    const endX = cell14.x + 3.6
    const res = moveWithSubsteps(
      startX,
      laneZ,
      endX - startX,
      0,
      maze,
      { radius: PLAYER_RADIUS, propColliders: engine._propCollisionIndex }
    )
    assert(
      res.hitProp === true && res.x < cell14.x - 1.5,
      `1b. Initial fallen furniture solidly blocks corridor passage at laneZ=${laneZ.toFixed(2)}`
    )
  }

  // Verify old instant F-key clear_furniture interaction is completely disabled
  const initialPose = hazard.getFurniturePose()
  const approachX = cell14.x + initialPose.minLocalX - (PLAYER_RADIUS + 0.14)
  const approachZ = cell14.z + 0.35
  aimCameraAtFurniture(engine, hazard, approachX, approachZ)
  engine.stepFrame(0.016, { render: false })

  assert(
    engine.getNearbyInteractable() === null &&
      typeof engine.interact === 'undefined' &&
      hazard.getInteractionHandler() === null,
    '1c. Instant F-key Clear Fallen Furniture prompt and handler are disabled'
  )

  // ---------------------------------------------------------------------------
  // 1 & 2. Center-Screen Crosshair Targeting & Rejection Rules
  // ---------------------------------------------------------------------------
  const furnCtrl = engine.getFurnitureController()
  const targetHit = furnCtrl.updateTargeting()
  assert(
    targetHit !== null &&
      targetHit.hazard === hazard &&
      furnCtrl.getInteractionSnapshot().canGrip === true,
    '2a. Center-screen crosshair raycast targets reachable fallen furniture within interaction range'
  )

  // Verify emissive highlight is applied to interactive furniture meshes when targeted
  const interactiveMeshes = hazard.getFurnitureInteractiveMeshes()
  assert(
    interactiveMeshes.length >= 10 &&
      interactiveMeshes.some((m) => m.material !== m.userData?.baseMaterial),
    '2b. Targeted fallen furniture receives subtle emissive highlight material'
  )

  // Verify crosshair feedback state shows VALID_TARGET and Left-Click Grip & push furniture hint
  const xhairTargeted = resolveCrosshairFeedbackState(engine.getStealthState())
  assert(
    xhairTargeted.targetState === CROSSHAIR_TARGET_STATES.VALID_TARGET &&
      xhairTargeted.hintKey === 'Left-Click' &&
      xhairTargeted.hintText === 'Grip & push furniture',
    '2c. Persistent center crosshair resolves VALID_TARGET state and Left-Click Grip & push furniture hint'
  )

  // Test rejection when looking away
  engine.setLookDirection(Math.PI / 2, 0) // Look West (-X) away from furniture
  engine.cameraRig?.snap?.()
  engine.stepFrame(0.016, { render: false })
  assert(
    furnCtrl.updateTargeting() === null &&
      furnCtrl.getInteractionSnapshot().canGrip === false &&
      engine.handlePrimaryAction().handled === false,
    '2d. Looking away clears furniture target highlight and rejects primary action'
  )

  // Test rejection when out of range
  const farCell = gridToWorld(1, 1, maze)
  engine.setPlayerWorldPosition(farCell.x, 0, farCell.z, { immediate: true })
  engine.setLookDirection(-Math.PI / 2, -0.1)
  engine.cameraRig?.snap?.()
  engine.stepFrame(0.016, { render: false })
  assert(
    furnCtrl.updateTargeting() === null &&
      engine.handlePrimaryAction().handled === false,
    '2e. Standing out of interaction range rejects furniture targeting and gripping'
  )

  // Test rejection when occluded by solid wall (row 3 is behind row 2 wall)
  const behindWallCell = gridToWorld(3, 4, maze)
  engine.setPlayerWorldPosition(behindWallCell.x, 0, behindWallCell.z, {
    immediate: true,
  })
  engine.setLookDirection(0, -0.1) // Look North (-Z) through row 2 wall
  engine.cameraRig?.snap?.()
  engine.stepFrame(0.016, { render: false })
  assert(
    furnCtrl.updateTargeting() === null &&
      engine.handlePrimaryAction().handled === false,
    '2f. Solid wall between player and fallen furniture blocks targeting and gripping'
  )

  // Verify approaching fallen furniture without clicking does NOT automatically move it
  const poseBeforeApproach = hazard.getFurniturePose()
  aimCameraAtFurniture(engine, hazard, approachX, approachZ)
  engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.1)
  const poseAfterApproach = hazard.getFurniturePose()
  assert(
    Math.abs(poseAfterApproach.dispLocalX - poseBeforeApproach.dispLocalX) < 1e-6 &&
      Math.abs(poseAfterApproach.dispLocalZ - poseBeforeApproach.dispLocalZ) < 1e-6 &&
      furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.IDLE,
    '2g. Approaching or pushing against fallen furniture without Left-Click does not move furniture'
  )

  // ---------------------------------------------------------------------------
  // 3 & 4. Entering Grip State & Pre-Contact Stationary Rule
  // ---------------------------------------------------------------------------
  aimCameraAtFurniture(engine, hazard, approachX, approachZ)
  engine.stepFrame(0.016, { render: false })

  const startGripRes = engine.handlePrimaryAction()
  assert(
    startGripRes.handled === true &&
      furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.GRIPPING &&
      furnCtrl.getInteractionSnapshot().gripAttached === false,
    '3a. Left-Click starts GRIPPING state with gripAttached initially false'
  )

  // Step 0.12s into GRIPPING (progress < 0.56, so hands are still reaching and gripAttached === false)
  engine.stepFrame(0.12, { render: false })
  const snapEarlyGrip = furnCtrl.getInteractionSnapshot()
  assert(
    snapEarlyGrip.state === FURNITURE_HANDLING_STATES.GRIPPING &&
      snapEarlyGrip.gripAttached === false,
    '3b. During early GRIPPING (0.12s), hands are reaching and gripAttached is still false'
  )

  // Attempt WASD movement before gripAttached is true -> furniture and player must remain stationary
  const posBeforeEarlyMove = { ...engine.getPlayerWorldPosition() }
  const furnPoseBeforeEarlyMove = hazard.getFurniturePose()
  engine.stepMovement({ forwardAxis: 1, strafeAxis: -1, sprint: true }, 0.08)
  const posAfterEarlyMove = engine.getPlayerWorldPosition()
  const furnPoseAfterEarlyMove = hazard.getFurniturePose()
  assert(
    Math.hypot(
      posAfterEarlyMove.x - posBeforeEarlyMove.x,
      posAfterEarlyMove.z - posBeforeEarlyMove.z
    ) < 1e-5 &&
      Math.abs(
        furnPoseAfterEarlyMove.dispLocalZ - furnPoseBeforeEarlyMove.dispLocalZ
      ) < 1e-6,
    '4a. Furniture and player remain stationary before physical hand contact (gripAttached) is established'
  )

  // Step through the remainder of GRIPPING so physical contact is established and state transitions to HANDLING
  for (let i = 0; i < 10; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }
  const snapAttached = furnCtrl.getInteractionSnapshot()
  const animStateGrip = engine.getPlayerAnimator().getFurnitureState()
  const rig = engine.getPlayer().userData.rig
  assert(
    snapAttached.state === FURNITURE_HANDLING_STATES.HANDLING &&
      snapAttached.gripAttached === true &&
      animStateGrip.furnitureMode === FURNITURE_ANIM_MODES.PUSH_DRAG &&
      animStateGrip.furnitureBlend > 0.7 &&
      animStateGrip.furnitureCrouch > 0.4 &&
      animStateGrip.furnitureReach > 0.75 &&
      rig.leftKneePivot.rotation.x < -0.35 &&
      rig.rightKneePivot.rotation.x < -0.35 &&
      rig.spinePivot.rotation.x < -0.25 &&
      rig.leftShoulderPivot.rotation.x > 0.65 &&
      rig.rightShoulderPivot.rotation.x > 0.65,
    '4b. Character completes GRIPPING into braced HANDLING posture with flexed knees, forward torso lean, and both arms reaching the rack'
  )

  // Verify crosshair shows CARRYING/HANDLING state with WASD Push/Drag • Release hint
  const xhairHandling = resolveCrosshairFeedbackState(engine.getStealthState())
  assert(
    xhairHandling.targetState === CROSSHAIR_TARGET_STATES.CARRYING &&
      xhairHandling.hintKey === 'Right-Click' &&
      xhairHandling.hintText.includes('WASD Push/Drag'),
    '4c. Center crosshair updates to handling state with WASD Push/Drag • Release hint'
  )

  // ---------------------------------------------------------------------------
  // 5 & 6. Coupled WASD Pushing/Dragging, Heavy Weight Speed, Sprinting Disabled & Animation Progression
  // ---------------------------------------------------------------------------
  // Look East (-PI/2): strafeAxis = -1 (A key) pushes North (-Z, toward the north mounting wall where localZ decreases)
  const playerBeforePush = { ...engine.getPlayerWorldPosition() }
  const poseBeforePush = hazard.getFurniturePose()
  let minBootYDuringPush = Infinity

  for (let step = 0; step < 12; step += 1) {
    const moveRes = engine.stepMovement(
      { forwardAxis: 0, strafeAxis: -1, sprint: true },
      0.05
    )
    const stepSpeed = engine._motionSample.actualSpeed
    const stepSprinting = engine._motionSample.isSprinting
    engine.stepFrame(0.05, { render: false })
    const bootMinY = computeRigBootMinWorldY(engine.getPlayer())
    if (bootMinY < minBootYDuringPush) minBootYDuringPush = bootMinY
    assert(
      stepSprinting === false,
      `5a. Sprinting is disabled while handling heavy furniture (tick ${step})`
    )
    if (step === 5) {
      const expectedHeavySpeed = engine.movementConfig.walkSpeed * 0.44
      assert(
        moveRes.moved === true &&
          stepSpeed > 0.5 &&
          stepSpeed <= expectedHeavySpeed + 0.15,
        `5b. Coupled movement speed reflects heavy furniture weight (${stepSpeed.toFixed(2)} m/s <= ${(expectedHeavySpeed + 0.15).toFixed(2)} m/s)`
      )
    }
  }

  const playerAfterPush1 = engine.getPlayerWorldPosition()
  const poseAfterPush1 = hazard.getFurniturePose()
  const playerDeltaZ1 = playerAfterPush1.z - playerBeforePush.z
  const centerDeltaZ1 = poseAfterPush1.centerLocalZ - poseBeforePush.centerLocalZ
  const furnDeltaZ1 = poseAfterPush1.dispLocalZ - poseBeforePush.dispLocalZ

  assert(
    furnDeltaZ1 < -0.55 &&
      Math.abs(playerDeltaZ1 - centerDeltaZ1) < 1e-4,
    `5c. Player and furniture move together continuously toward the north wall (playerDeltaZ=${playerDeltaZ1.toFixed(3)}, centerDeltaZ=${centerDeltaZ1.toFixed(3)}, furnDeltaZ=${furnDeltaZ1.toFixed(3)})`
  )
  assert(
    minBootYDuringPush >= -0.008 && minBootYDuringPush <= 0.025,
    `6a. Character boots remain grounded on the floor during heavy pushing (minBootY=${minBootYDuringPush.toFixed(4)}m)`
  )

  const animDuringPush = engine.getPlayerAnimator().getFurnitureState()
  assert(
    animDuringPush.furnitureMode === FURNITURE_ANIM_MODES.PUSH_DRAG &&
      animDuringPush.furnitureEffort > 0.35 &&
      Math.abs(rig.pelvisPivot.position.x) > 0.001 &&
      Math.abs(rig.spinePivot.rotation.y) > 0.005,
    '6b. Pushing animation exhibits active effort, lateral hip weight transfer, and torso stabilization'
  )

  // Test changing direction while gripping (pulling/dragging slightly South + longitudinal shift)
  const poseBeforePull = hazard.getFurniturePose()
  for (let step = 0; step < 5; step += 1) {
    engine.stepMovement({ forwardAxis: -0.5, strafeAxis: 1, sprint: false }, 0.05)
    engine.stepFrame(0.05, { render: false })
  }
  const poseAfterPull = hazard.getFurniturePose()
  assert(
    poseAfterPull.dispLocalZ > poseBeforePull.dispLocalZ + 0.1 &&
      poseAfterPull.dispLocalX < poseBeforePull.dispLocalX - 0.05,
    '6c. Changing WASD direction smoothly transitions between pushing, pulling/dragging, and lateral adjustment'
  )

  // ---------------------------------------------------------------------------
  // 7 & 8. Releasing at an Intermediate Position & Resuming Interaction
  // ---------------------------------------------------------------------------
  const intermediatePose = hazard.getFurniturePose()
  const releaseRes = engine.handleSecondaryAction()
  assert(
    releaseRes.handled === true &&
      furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.RELEASING,
    '7a. Right-Click initiates RELEASING transition'
  )

  for (let i = 0; i < 10; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }
  const poseAfterRelease = hazard.getFurniturePose()
  const aftColliderIntermediate = getDynamicCollider(
    engine._propCollisionIndex,
    `${hazard.id}:aftermath-furniture`
  )
  assert(
    furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.IDLE &&
      Math.abs(poseAfterRelease.dispLocalZ - intermediatePose.dispLocalZ) < 1e-5 &&
      Math.abs(poseAfterRelease.dispLocalX - intermediatePose.dispLocalX) < 1e-5 &&
      aftColliderIntermediate?.enabled === true &&
      Math.abs(
        aftColliderIntermediate.cz - (cell14.z + poseAfterRelease.centerLocalZ)
      ) < 1e-3,
    '7b. Released furniture remains at its exact intermediate position with synchronized solid OBB collider'
  )

  // Verify the player can now walk away freely after releasing while furniture stays stationary
  const walkAwayBefore = hazard.getFurniturePose()
  engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.08)
  const walkAwayAfter = hazard.getFurniturePose()
  assert(
    Math.abs(walkAwayAfter.dispLocalZ - walkAwayBefore.dispLocalZ) < 1e-6,
    '7c. After releasing, player moves independently while furniture stays stationary'
  )

  // Step back in, re-target, and resume handling from the exact intermediate position
  engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.08)
  const curPosResume = engine.getPlayerWorldPosition()
  aimCameraAtFurniture(engine, hazard, curPosResume.x, curPosResume.z)
  engine.stepFrame(0.016, { render: false })
  const resumeRes = engine.handlePrimaryAction()
  assert(
    resumeRes.handled === true &&
      furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.GRIPPING,
    '8a. Player can re-target and resume handling fallen furniture from its intermediate position'
  )
  for (let i = 0; i < 10; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }
  assert(
    furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.HANDLING &&
      Math.abs(
        hazard.getFurniturePose().dispLocalZ - intermediatePose.dispLocalZ
      ) < 1e-5,
    '8b. Resuming handling preserves exact intermediate furniture displacement without snapping'
  )

  // ---------------------------------------------------------------------------
  // 9 & 10. Pushing Furniture Flush Against Wall to Open Corridor & Solid Wall Aftermath
  // ---------------------------------------------------------------------------
  // Continue pushing toward the North mounting wall (strafeAxis = -1 while facing East)
  for (let step = 0; step < 65; step += 1) {
    engine.stepMovement({ forwardAxis: 0, strafeAxis: -1, sprint: false }, 0.05)
    engine.stepFrame(0.05, { render: false })
  }

  const clearedPose = hazard.getFurniturePose()
  assert(
    clearedPose.dispLocalZ <= -2.8 &&
      clearedPose.corridorClearance >= 3.1 &&
      clearedPose.minLocalZ >= -1.99 &&
      clearedPose.maxY < 3.04,
    `9a. Furniture pushed flush against mounting wall opens corridor (dispLocalZ=${clearedPose.dispLocalZ.toFixed(2)}, clearance=${clearedPose.corridorClearance.toFixed(2)}m, minLocalZ=${clearedPose.minLocalZ.toFixed(2)})`
  )

  // Release furniture against the wall
  engine.handleSecondaryAction()
  for (let i = 0; i < 10; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }

  // Verify the player can now walk freely all the way through the opened South corridor lane (centerLaneZ and southLaneZ)
  for (const openLaneZ of [centerLaneZ, southLaneZ]) {
    const startX = cell14.x - 3.6
    const endX = cell14.x + 3.6
    const walkRes = moveWithSubsteps(
      startX,
      openLaneZ,
      endX - startX,
      0,
      maze,
      { radius: PLAYER_RADIUS, propColliders: engine._propCollisionIndex }
    )
    assert(
      walkRes.hitProp === false && walkRes.x >= endX - 0.05,
      `9b. Opened corridor passage at laneZ=${openLaneZ.toFixed(2)} is completely unobstructed (reached x=${walkRes.x.toFixed(2)})`
    )
  }

  // Verify the pushed furniture against the North wall REMAINS SOLID and prevents player clipping
  const activeCol =
    getDynamicCollider(engine._propCollisionIndex, `${hazard.id}:cleared-furniture`)?.enabled
      ? getDynamicCollider(engine._propCollisionIndex, `${hazard.id}:cleared-furniture`)
      : getDynamicCollider(engine._propCollisionIndex, `${hazard.id}:aftermath-furniture`)
  assert(
    activeCol && activeCol.enabled === true,
    '10a. Relocated furniture against the wall maintains an active solid dynamic collider'
  )
  const intoFurnitureCheck = resolveGridCollision(
    activeCol.cx,
    activeCol.cz,
    maze,
    { radius: PLAYER_RADIUS, propColliders: engine._propCollisionIndex }
  )
  assert(
    intoFurnitureCheck.hitProp === true,
    '10b. Relocated furniture against the wall solidly blocks player clipping'
  )

  // ---------------------------------------------------------------------------
  // 11. First-Person & Third-Person Camera Perspective Parity + Interruption Handling
  // ---------------------------------------------------------------------------
  // Reset hazard to test First-Person arms-only visibility and damage interruption
  engine.resetCombat()
  collapseFurnitureHazard(engine, hazard)
  engine.cameraRig.setMode(CAMERA_MODES.FIRST_PERSON, { immediate: true })
  aimCameraAtFurniture(engine, hazard, approachX, approachZ)
  engine.syncPlayerVisibility()
  engine.stepFrame(0.016, { render: false })

  assert(
    engine.getPlayer().visible === false,
    '11a. In First-Person IDLE state, player mesh is hidden'
  )

  engine.handlePrimaryAction()
  for (let i = 0; i < 8; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }
  const fpEyeOffset = furnCtrl.getFirstPersonEyeOffsetY()
  assert(
    engine.getPlayer().visible === true &&
      rig.leftShoulderPivot.visible === true &&
      rig.rightShoulderPivot.visible === true &&
      fpEyeOffset < -0.08,
    `11b. In First-Person HANDLING state, arms-only mode is visible and camera crouches naturally (eyeOffsetY=${fpEyeOffset.toFixed(3)}m)`
  )

  // Switch to Third-Person and verify full-body mesh visibility
  engine.cameraRig.setMode(CAMERA_MODES.THIRD_PERSON)
  engine.syncPlayerVisibility()
  engine.stepFrame(0.05, { render: false })
  let torsoMeshVisible = false
  rig.spinePivot.traverse((obj) => {
    if (obj.isMesh && obj !== rig.leftShoulderPivot && obj !== rig.rightShoulderPivot) {
      if (obj.visible) torsoMeshVisible = true
    }
  })
  assert(
    engine.getPlayer().visible === true && torsoMeshVisible === true,
    '11c. In Third-Person HANDLING state, full-body character rig is visible'
  )

  // Test damage interruption while handling furniture
  const poseBeforeDamage = hazard.getFurniturePose()
  engine.applyDamage(15, { enemyId: 'test-stalker' })
  assert(
    furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.IDLE &&
      Math.abs(
        hazard.getFurniturePose().dispLocalZ - poseBeforeDamage.dispLocalZ
      ) < 1e-6,
    '11d. Taking damage while handling furniture immediately interrupts grip and leaves furniture solid in place'
  )

  // ---------------------------------------------------------------------------
  // 12. Third-Person Follow & Free Look + Front/South-Face Push-toward-Wall
  // ---------------------------------------------------------------------------
  engine.resetCombat()
  collapseFurnitureHazard(engine, hazard)
  const southPose0 = hazard.getFurniturePose()
  // Stand near South-center edge of collapsed rack (maxLocalZ ~ +1.85 -> place player at z ~ +2.85, x ~ cell14.x + 1.55 inside South corridor opening? Wait: South wall is +2.0, so let's place player in corridor cell (1,4) just South-West or push from front edge inside corridor)
  // Actually let's test from cell (1, 5) or (1, 3) approaching front/South edge at localX = -2.2, localZ = +1.15 -> world x = cell14.x - 1.0, z = cell14.z + 1.15 if open, or test South-side grip at localX = -2.0, localZ = +1.25 (inside corridor, since corridor spans localZ in [-2, +2])
  // Wait: fallen rack spans localZ [-0.4, +1.85], so South-edge is at +1.85 near South wall (+2.0). Look at cell (1, 3) which is West end, or push Northward from West-South corner? Wait: let's test Free Look on the standard West end, AND test Free Look yaw lock & release!
  engine.cameraRig.setMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.cameraRig.setThirdPersonMode('free-look')
  assert(
    engine.cameraRig.isFreeLookActive() === true,
    '12a. Free Look third-person camera mode activates cleanly'
  )

  // Aim at furniture from West approach in Free Look and grip it
  aimCameraAtFurniture(engine, hazard, approachX, approachZ)
  engine.syncPlayerVisibility()
  engine.stepFrame(0.016, { render: false })
  const freeLookGrip = engine.handlePrimaryAction()
  assert(
    freeLookGrip.handled === true &&
      furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.GRIPPING,
    '12b. Free Look mode supports crosshair targeting and gripping fallen furniture'
  )

  for (let i = 0; i < 10; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }
  const lockedGripYaw = engine.cameraRig.getCharacterDirection().yaw
  // Push toward North wall while in Free Look; character yaw must remain locked toward gripped rack instead of turning away with movement input
  engine.stepMovement({ forwardAxis: 0, strafeAxis: -1, sprint: false }, 0.08)
  engine.stepFrame(0.05, { render: false })
  const afterFreeLookPushYaw = engine.cameraRig.getCharacterDirection().yaw
  const freeLookPose = hazard.getFurniturePose()
  assert(
    furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.HANDLING &&
      freeLookPose.dispLocalZ < southPose0.dispLocalZ - 0.03 &&
      Math.abs(
        Math.atan2(
          Math.sin(afterFreeLookPushYaw - lockedGripYaw),
          Math.cos(afterFreeLookPushYaw - lockedGripYaw)
        )
      ) < 0.25,
    `12c. In Free Look, coupled pushing moves furniture and keeps character yaw facing rack (dispDelta=${(freeLookPose.dispLocalZ - southPose0.dispLocalZ).toFixed(3)})`
  )

  // Switch to Character Follow while handling and continue pushing cleanly
  engine.cameraRig.setThirdPersonMode('character-follow')
  engine.stepMovement({ forwardAxis: 0, strafeAxis: -1, sprint: false }, 0.08)
  engine.stepFrame(0.05, { render: false })
  const followPose = hazard.getFurniturePose()
  assert(
    engine.cameraRig.isFreeLookActive() === false &&
      followPose.dispLocalZ < freeLookPose.dispLocalZ - 0.03,
    `12d. Character Follow mode continues coupled pushing seamlessly (dispDelta=${(followPose.dispLocalZ - freeLookPose.dispLocalZ).toFixed(3)})`
  )

  engine.handleSecondaryAction()
  for (let i = 0; i < 10; i += 1) {
    engine.stepFrame(0.05, { render: false })
  }
  assert(
    furnCtrl.getStateName() === FURNITURE_HANDLING_STATES.IDLE,
    '12e. Third-Person Follow/Free Look release returns cleanly to IDLE'
  )

  engine.dispose()

  console.log(`\nResults: ${passed} passed, ${failed} failed.`)
  if (failed > 0) {
    globalThis.process.exit(1)
  }
}

runSuite()
