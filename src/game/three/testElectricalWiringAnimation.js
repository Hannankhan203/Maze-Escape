/**
 * End-to-End Automated Verification Suite for MAZE-HAZARD-WIRING-002
 * Physical Electrical Wiring Neutralization Animation:
 *  - Safe upstream breaker approach (zero overlap with active full-tile damage volume)
 *  - Collision-aware wall & prop avoidance + safe rejection from inside danger zone
 *  - 5-phase procedural PlayerAnimator rig kinematics (grounded stance, reach, grip,
 *    spring-detent breaker lever throw, release & withdrawal)
 *  - Visible breakerHandleGroup rotation (-0.58 -> +0.52 rad) synchronized to animation
 *  - Atomic neutralization completion at >= 0.78 progress (single audio/subtitle cue,
 *    no premature disable, full-tile damage deactivation only upon completion)
 *  - Zero temporary invulnerability (voluntary entry & incoming damage remain live)
 *  - Clean interruption on WASD/sprint, incoming damage, pause, game over, resetCombat
 *  - Duplicate left-click protection, right-click safety, F-key removal
 *  - First-Person, Third-Person Character Follow, and Third-Person Free Look camera modes
 *  - Pointer-lock & pointer-unlocked left-click targeting
 *  - Rotated wall mounts (north/south/west/east) and ceiling mount support
 *  - MAZE-HAZARD-WIRING-001 visual wire preservation & full-tile boundary preservation
 */

import assert from 'node:assert/strict'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  ELECTRICAL_WIRING_CONSTANTS,
  HAZARD_TYPES,
} from '../generation/hazardPlacement.js'
import {
  DEFAULT_KEY_BINDINGS,
  KEY_BINDING_ACTION_ORDER,
  resolveLookInputConfig,
} from './threeConfig.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import {
  buildPropCollisionIndex,
  registerDynamicCollider,
} from '../world/propCollision.js'
import { buildPlayer } from './buildPlayer.js'
import { CAMERA_MODES, THIRD_PERSON_CAMERA_MODES } from './CameraRig.js'
import { HAZARD_CONFIG, HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  ELECTRICAL_WIRING_ANIM_CONFIG,
  ELECTRICAL_WIRING_ANIM_MODES,
  ELECTRICAL_WIRING_STATES,
} from './ElectricalWiringController.js'
import { PlayerAnimator } from './PlayerAnimator.js'
import { createViewportPointerController } from './viewportPointerCapture.js'

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

function createTwoTileCorridorGrid() {
  return [
    [W, W, W, W, W, W, W],
    [W, S, P, P, P, E, W],
    [W, P, P, P, P, P, W],
    [W, W, W, W, W, W, W],
  ]
}

function createOpenRoomGrid() {
  return [
    [W, W, W, W, W, W, W],
    [W, S, P, P, P, P, W],
    [W, P, P, P, P, P, W],
    [W, P, P, P, P, P, W],
    [W, P, P, P, P, E, W],
    [W, W, W, W, W, W, W],
  ]
}

function createHeadlessEngine({
  grid = createTwoTileCorridorGrid(),
  cameraMode = CAMERA_MODES.THIRD_PERSON,
  thirdPersonCameraMode = THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
  audioEvents = null,
} = {}) {
  const rows = grid.length
  const cols = grid[0].length
  const maze = {
    grid,
    rows,
    cols,
    start: { row: 1, col: 1 },
    exit: { row: rows - 2, col: cols - 2 },
    level: 3,
    seed: 9402,
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
  const engine = new MazeSceneEngine(createMockCanvasHost(), {
    createRenderer: () => mockRenderer,
    skipSpawnSequence: true,
    cameraMode,
    thirdPersonCameraMode,
    initialHealth: 100,
    maxHealth: 100,
    enemies: { autoSpawn: false },
  })
  if (audioEvents && engine.audioEngine) {
    const origOnHazard = engine.audioEngine.onHazardInteraction?.bind(engine.audioEngine)
    engine.audioEngine.onHazardInteraction = (action, type, anchor) => {
      audioEvents.push({
        action,
        type,
        anchor: anchor ? { x: anchor.x, y: anchor.y, z: anchor.z } : null,
      })
      return origOnHazard?.(action, type, anchor)
    }
  }
  engine.setMaze(maze)
  engine.cancelSpawnSequence?.({ syncYaw: false })
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })
  return { engine, maze }
}

function addElectricalWiringHazard(engine, maze, {
  id = 'wiring-anim-test',
  row = 1,
  col = 3,
  wallDirection = 'north',
  mountType = 'wall',
} = {}) {
  const placement = {
    id,
    type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
    row,
    col,
    wallDirection,
    mountType,
    corridorAxis: wallDirection === 'north' || wallDirection === 'south' ? 'east-west' : 'north-south',
    seed: 777,
    level: 3,
  }
  const agent = engine.hazardManager.addHazard(placement, maze)
  engine.syncHazardColliders({ allowPushOut: false })
  return agent
}

function activateWiring(agent, maze) {
  const cell = gridToWorld(agent.row, agent.col, maze)
  const warnDur =
    HAZARD_CONFIG[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]?.warningDuration ?? 1.5
  agent.update(0.05, {
    playerWorldPos: { x: cell.x, y: 0, z: cell.z },
    playerGridCell: { row: agent.row, col: agent.col },
  })
  agent.update(warnDur + 0.15, {
    playerWorldPos: { x: cell.x + 14, y: 0, z: cell.z + 14 },
    playerGridCell: { row: 1, col: 1 },
  })
  assert.equal(agent.getState(), HAZARD_STATES.ACTIVE, 'Wiring reaches ACTIVE state')
}

function localToWorld(cellWorld, wallYaw, lx, lz) {
  const c = Math.cos(wallYaw)
  const s = Math.sin(wallYaw)
  return {
    x: cellWorld.x + lx * c + lz * s,
    z: cellWorld.z - lx * s + lz * c,
  }
}

console.log('=== RUNNING MAZE-HAZARD-WIRING-002 ANIMATION & SAFETY VERIFICATION SUITE ===')

// -----------------------------------------------------------------------------
// Suite 1: Core 5-Phase Neutralization, Full-Tile Safety Guarantee, Breaker Lever
//          Kinematics, Atomic Completion, Single Audio Cue, & Wire Preservation
// -----------------------------------------------------------------------------
{
  const audioEvents = []
  const { engine, maze } = createHeadlessEngine({ audioEvents })
  const wiring = addElectricalWiringHazard(engine, maze, {
    id: 'wiring-core',
    row: 1,
    col: 3,
    wallDirection: 'north',
    mountType: 'wall',
  })
  activateWiring(wiring, maze)

  const cell = gridToWorld(1, 3, maze)
  const ctrl = engine.getElectricalWiringController()
  assert.ok(ctrl, 'Engine exposes ElectricalWiringController')
  assert.equal(ctrl.getStateName(), ELECTRICAL_WIRING_STATES.IDLE, 'Controller starts IDLE')

  // Capture initial visible wire transform to verify MAZE-HAZARD-WIRING-001 preservation
  const cableGroup = wiring.mesh?.userData?.cableGroup
  const breakerHandle = wiring.mesh?.userData?.breakerHandleGroup
  assert.ok(cableGroup, 'Visible cableGroup exists on electrical wiring mesh')
  assert.ok(breakerHandle, 'Visible breakerHandleGroup exists on electrical wiring mesh')
  const initCablePos = cableGroup.position.clone()
  const initCableScale = cableGroup.scale.clone()
  assert.ok(
    Math.abs(breakerHandle.rotation.x - -0.58) < 1e-3,
    `Initial breaker handle angle is ON (-0.58 rad), got ${breakerHandle.rotation.x}`
  )

  // Place player safely upstream of the affected tile (within 2.35m breaker reach, completely outside tile)
  const startPos = localToWorld(cell, wiring.wallYaw, -2.92, -1.06)
  engine.setPlayerWorldPosition(startPos.x, 0, startPos.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  assert.equal(engine.health, 100, 'Starting upstream position is strictly outside active electrical tile')
  assert.equal(
    wiring._isFootprintInElectricalTileArea(startPos.x, startPos.z, PLAYER_RADIUS),
    false,
    'Starting player footprint does not overlap affected electrical tile'
  )

  // Requirement 11 & 12: Right-click does nothing & F-key remains removed
  assert.equal(typeof engine.interact, 'undefined', 'Legacy F-key engine.interact remains removed')
  assert.equal(Object.values(DEFAULT_KEY_BINDINGS).includes('KeyF'), false, 'No KeyF binding in DEFAULT_KEY_BINDINGS')
  assert.equal(KEY_BINDING_ACTION_ORDER.includes('interact'), false, 'No interact action in KEY_BINDING_ACTION_ORDER')

  const rightRes = engine.handleSecondaryAction()
  assert.ok(!rightRes || rightRes.action !== 'insulate_wiring', 'Right-click does not trigger electrical neutralization')
  assert.equal(ctrl.isActive(), false, 'Right-click leaves ElectricalWiringController IDLE')
  assert.equal(wiring.getState(), HAZARD_STATES.ACTIVE, 'Right-click leaves wiring ACTIVE')

  // Requirement 1: Left-click initiates physical neutralization
  const leftRes = engine.handlePrimaryAction()
  assert.equal(leftRes.handled, true, 'Left-click initiates electrical neutralization')
  assert.equal(leftRes.action, 'insulate_wiring', 'Left-click dispatches insulate_wiring')
  assert.equal(leftRes.isNeutralizing, true, 'Left-click reports isNeutralizing = true')
  assert.equal(ctrl.isActive(), true, 'Controller enters NEUTRALIZING state')
  assert.equal(wiring.getState(), HAZARD_STATES.ACTIVE, 'Hazard remains ACTIVE immediately after click')
  assert.equal(audioEvents.length, 0, 'Neutralization completion audio does NOT fire prematurely on click')

  // Requirement 20: Duplicate left-click while active is cleanly ignored
  const dupRes = engine.handlePrimaryAction()
  assert.equal(dupRes.handled, false, 'Duplicate left-click during active neutralization is ignored')
  assert.equal(dupRes.reason, 'already_handling', 'Duplicate left-click returns already_handling reason')
  assert.equal(audioEvents.length, 0, 'Duplicate left-click triggers zero audio cues')

  // Step frame-by-frame across the full 5-phase animation and verify:
  // - Smooth non-teleporting approach
  // - ZERO overlap with active electrical tile on EVERY frame
  // - Zero electrical damage (with zero invulnerability!)
  // - Breaker lever moves progressively from -0.58 -> +0.52 during Phase C
  // - Hazard remains ACTIVE prior to 0.78 and commits atomically at >= 0.78
  let prevPos = { ...engine.getPlayerWorldPosition() }
  let maxSingleFrameStep = 0
  let sawIntermediateLeverAngle = false
  let sawActiveAtMidPull = false
  let committedFrame = -1
  let sawAnimatorPullPeak = 0
  let sawAnimatorReachPeak = 0

  for (let frame = 0; frame < 60; frame += 1) {
    engine.stepFrame(0.04, { render: false })
    const curPos = { ...engine.getPlayerWorldPosition() }
    const stepDist = Math.hypot(curPos.x - prevPos.x, curPos.z - prevPos.z)
    if (stepDist > maxSingleFrameStep) maxSingleFrameStep = stepDist
    prevPos = curPos

    // Requirements 4 & 5: NEVER overlap active electrical damage volume on any frame!
    if (wiring.getState() === HAZARD_STATES.ACTIVE) {
      assert.equal(
        wiring._isFootprintInElectricalTileArea(curPos.x, curPos.z, PLAYER_RADIUS),
        false,
        `Frame ${frame}: Player footprint must NEVER overlap active electrical damage tile (pos=${curPos.x.toFixed(3)},${curPos.z.toFixed(3)})`
      )
    }

    // Must never take damage during valid safe neutralization
    assert.equal(engine.health, 100, `Frame ${frame}: Health remains 100 without invulnerability`)

    const animState = engine._playerAnimator?.getElectricalNeutralizeState?.()
    if (animState && animState.electricalMode === ELECTRICAL_WIRING_ANIM_MODES.NEUTRALIZE) {
      if (animState.electricalReach > sawAnimatorReachPeak) sawAnimatorReachPeak = animState.electricalReach
      if (animState.electricalPull > sawAnimatorPullPeak) sawAnimatorPullPeak = animState.electricalPull
    }

    const leverX = breakerHandle.rotation.x
    if (leverX > -0.45 && leverX < 0.42) {
      sawIntermediateLeverAngle = true
    }

    const p = ctrl.getInteractionSnapshot().progress
    if (ctrl.isActive() && p > 0.45 && p < ELECTRICAL_WIRING_ANIM_CONFIG.completionProgress - 0.03) {
      assert.equal(wiring.getState(), HAZARD_STATES.ACTIVE, `Frame ${frame}: Wiring stays ACTIVE mid-throw (p=${p.toFixed(2)})`)
      assert.equal(audioEvents.length, 0, `Frame ${frame}: Audio cue does not fire before completion threshold`)
      sawActiveAtMidPull = true
    }

    if (committedFrame < 0 && wiring.getState() === HAZARD_STATES.DISABLED) {
      committedFrame = frame
      assert.equal(audioEvents.length, 1, 'Completion audio cue fires strictly ONCE at neutralization commit')
      assert.equal(audioEvents[0].action, 'insulate_wiring', 'Audio cue uses insulate_wiring action')
    }
  }

  assert.ok(maxSingleFrameStep < 0.35, `Approach is smooth without teleporting (max step=${maxSingleFrameStep.toFixed(3)}m)`)
  assert.ok(sawActiveAtMidPull, 'Verified wiring remained ACTIVE during mid-throw before completion point')
  assert.ok(sawIntermediateLeverAngle, 'Verified breaker lever rotated smoothly through intermediate angles')
  assert.ok(committedFrame >= 0, 'Verified wiring committed to DISABLED during animation')
  assert.ok(sawAnimatorReachPeak > 0.7, `PlayerAnimator reached toward breaker (peak=${sawAnimatorReachPeak.toFixed(2)})`)
  assert.ok(sawAnimatorPullPeak > 0.7, `PlayerAnimator pulled breaker lever downward (peak=${sawAnimatorPullPeak.toFixed(2)})`)
  assert.equal(ctrl.isActive(), false, 'Controller exits NEUTRALIZING cleanly after withdrawal')
  assert.equal(ctrl.getStateName(), ELECTRICAL_WIRING_STATES.NEUTRALIZED, 'Controller ends in NEUTRALIZED state')
  assert.equal(wiring.getState(), HAZARD_STATES.DISABLED, 'Wiring is permanently DISABLED')
  assert.equal(wiring.isAftermathCleared, true, 'Wiring aftermath marked cleared')
  assert.equal(audioEvents.length, 1, 'Exactly one completion audio event emitted across entire animation')
  assert.ok(
    Math.abs(breakerHandle.rotation.x - 0.52) < 1e-3,
    `Final breaker handle angle locked at OFF (+0.52 rad), got ${breakerHandle.rotation.x}`
  )

  // Requirement 21: Visible electrical wires remained completely unchanged and unstretched
  assert.ok(cableGroup.position.distanceTo(initCablePos) < 1e-6, 'Visible wire cableGroup position unchanged')
  assert.ok(cableGroup.scale.distanceTo(initCableScale) < 1e-6, 'Visible wire cableGroup scale unchanged (unstretched)')

  // Requirement 9: Full-tile electrical damage is completely disabled after completion
  for (const [lx, lz] of [
    [-1.9, -1.9],
    [0.0, -1.0],
    [1.9, -0.05],
  ]) {
    const p = localToWorld(cell, wiring.wallYaw, lx, lz)
    engine.setPlayerWorldPosition(p.x, 0, p.z, { immediate: true })
    engine.stepFrame(0.25, { render: false })
    assert.equal(engine.health, 100, `Neutralized tile deals 0 damage at (${lx},${lz})`)
  }

  engine.dispose()
  console.log('  [PASS] Suite 1: 5-phase neutralization, safety, lever throw, atomic commit & wire preservation')
}

// -----------------------------------------------------------------------------
// Suite 2: PlayerAnimator Rig Kinematics (Grounded Boots, Right-Arm Reach/Throw,
//          Left-Arm Guard, Spine Twist/Lean, Gaze, First-Person Arms Alignment)
// -----------------------------------------------------------------------------
{
  const player = buildPlayer()
  const animator = new PlayerAnimator(player)
  const rig = player.userData.rig

  // Sample neutral baseline
  animator.update(0.05, {
    speed: 0,
    maxSpeed: 5.5,
    electricalNeutralize: {
      active: false,
      mode: ELECTRICAL_WIRING_ANIM_MODES.NONE,
      progress: 0,
    },
  })
  const rightShoulder = rig.rightShoulderPivot || rig.rightArmPivot
  const spine = rig.spinePivot || rig.upperBodyPivot
  const pelvis = rig.pelvisPivot

  const baseRightArmX = rightShoulder.rotation.x
  const baseTorsoX = spine.rotation.x
  const baseBodyY = pelvis.position.y

  // Sample Phase C peak lever throw (progress = 0.65)
  for (let i = 0; i < 12; i += 1) {
    animator.update(0.05, {
      speed: 0,
      maxSpeed: 5.5,
      isFirstPerson: false,
      electricalNeutralize: {
        active: true,
        mode: ELECTRICAL_WIRING_ANIM_MODES.NEUTRALIZE,
        progress: 0.65,
        hardwareWorldY: 1.32,
      },
    })
  }
  const st = animator.getElectricalNeutralizeState()
  assert.equal(st.electricalMode, ELECTRICAL_WIRING_ANIM_MODES.NEUTRALIZE, 'PlayerAnimator reports electricalNeutralize active')
  assert.ok(st.electricalBlend > 0.85, `Electrical animation blend ramps smoothly (got ${st.electricalBlend.toFixed(2)})`)
  assert.ok(st.electricalReach > 0.8, `Right arm reaches forward during throw (got ${st.electricalReach.toFixed(2)})`)
  assert.ok(st.electricalPull > 0.5, `Pull curve drives lever throw (got ${st.electricalPull.toFixed(2)})`)
  assert.ok(
    Math.abs(rightShoulder.rotation.x - baseRightArmX) > 0.35,
    'Right arm shoulder noticeably elevates/pulls during breaker throw'
  )
  assert.ok(
    spine.rotation.x < baseTorsoX - 0.12,
    `Torso leans forward into breaker hardware (spine.x=${spine.rotation.x.toFixed(3)})`
  )
  assert.ok(
    Math.abs(pelvis.rotation.y) > 0.05,
    `Pelvis rotates naturally into breaker stance (pelvis.y=${pelvis.rotation.y.toFixed(3)})`
  )
  assert.ok(
    pelvis.position.y < baseBodyY,
    'Grounded crouch lowers pelvis while maintaining floor contact'
  )
  assert.ok(
    rig.leftKneePivot.rotation.x < -0.12 && rig.rightKneePivot.rotation.x < -0.12,
    `Both knees flex into braced grounded stance (L=${rig.leftKneePivot.rotation.x.toFixed(3)}, R=${rig.rightKneePivot.rotation.x.toFixed(3)})`
  )

  // Verify First-Person arm lift & forward shift activates in FP mode
  const fpOffsetBefore = rightShoulder.position.z
  animator.update(0.05, {
    speed: 0,
    maxSpeed: 5.5,
    isFirstPerson: true,
    electricalNeutralize: {
      active: true,
      mode: ELECTRICAL_WIRING_ANIM_MODES.NEUTRALIZE,
      progress: 0.65,
      hardwareWorldY: 1.32,
    },
  })
  assert.ok(
    rightShoulder.position.z < fpOffsetBefore - 0.05,
    'First-Person mode shifts procedural arms forward into FP camera view during neutralization'
  )

  // Verify reset clears all channels cleanly
  animator.reset()
  const cleared = animator.getElectricalNeutralizeState()
  assert.equal(cleared.electricalMode, ELECTRICAL_WIRING_ANIM_MODES.NONE, 'PlayerAnimator.reset() clears electricalNeutralize mode')
  assert.equal(cleared.electricalBlend, 0, 'PlayerAnimator.reset() zeroes electricalNeutralize blend')

  console.log('  [PASS] Suite 2: PlayerAnimator rig kinematics, grounded stance & FP arm offset')
}

// -----------------------------------------------------------------------------
// Suite 3: Interruption Handling — WASD/Sprint, Incoming Damage (Zero Invuln),
//          Pause, Game Over, & Safe Rejection From Inside Danger Zone
// -----------------------------------------------------------------------------
{
  const audioEvents = []
  const { engine, maze } = createHeadlessEngine({ audioEvents })
  const wiring = addElectricalWiringHazard(engine, maze, {
    id: 'wiring-interrupt',
    row: 1,
    col: 3,
    wallDirection: 'north',
    mountType: 'wall',
  })
  activateWiring(wiring, maze)
  const cell = gridToWorld(1, 3, maze)
  const ctrl = engine.getElectricalWiringController()
  const breakerHandle = wiring.mesh.userData.breakerHandleGroup

  // 3a. Requirement 10: Voluntary entry into active tile before neutralization still deals 30 damage
  const dangerPos = localToWorld(cell, wiring.wallYaw, 1.5, -0.1)
  engine.setPlayerWorldPosition(dangerPos.x, 0, dangerPos.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  assert.equal(engine.health, 70, 'Voluntary entry into active electrical tile deals 30 damage')

  // Reject neutralization attempt if player is currently standing inside active electrical tile!
  const unsafeRes = engine.handlePrimaryAction()
  assert.equal(ctrl.isActive(), false, 'Cannot start neutralization while standing inside active electrical tile')
  assert.ok(!unsafeRes.isNeutralizing, 'Unsafe start inside danger tile does not begin animation')

  // Move player to safe upstream position & restore health
  engine.health = 100
  engine.damageImmunityTimer = 0
  const safeStart = localToWorld(cell, wiring.wallYaw, -2.88, -1.1)
  engine.setPlayerWorldPosition(safeStart.x, 0, safeStart.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })

  // 3b. Requirement 17: WASD / Sprint interruption mid-throw
  const startRes1 = engine.handlePrimaryAction()
  assert.equal(startRes1.isNeutralizing, true, 'Starts neutralization before WASD test')
  for (let i = 0; i < 26; i += 1) {
    engine.stepFrame(0.04, { render: false }) // ~1.04s -> progress ~0.53 (mid lever throw, < 0.78)
  }
  assert.equal(ctrl.isActive(), true, 'Still neutralizing mid-throw')
  assert.ok(breakerHandle.rotation.x > -0.5, 'Breaker lever has started rotating mid-throw')
  const posBeforeInterrupt = { ...engine.getPlayerWorldPosition() }

  // Player presses backward movement key (WASD + sprint)
  engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprinting: true }, 0.05)
  assert.equal(ctrl.isActive(), false, 'WASD/sprint immediately interrupts neutralization')
  assert.equal(wiring.getState(), HAZARD_STATES.ACTIVE, 'Interrupted wiring remains ACTIVE (no unsafe partial disable)')
  assert.ok(
    Math.abs(breakerHandle.rotation.x - -0.58) < 1e-3,
    'Interrupted breaker lever springs cleanly back to ON (-0.58 rad)'
  )
  const posAfterInterrupt = { ...engine.getPlayerWorldPosition() }
  assert.ok(
    Math.hypot(
      posAfterInterrupt.x - posBeforeInterrupt.x,
      posAfterInterrupt.z - posBeforeInterrupt.z
    ) < 0.5,
    'WASD interruption does not teleport or snap player back to start'
  )
  assert.equal(audioEvents.length, 0, 'Interrupted neutralization emits zero completion audio cues')

  // 3c. Requirement 18: Incoming damage interrupts cleanly WITHOUT invulnerability
  engine.setPlayerWorldPosition(safeStart.x, 0, safeStart.z, { immediate: true })
  engine.damageImmunityTimer = 0
  const startRes2 = engine.handlePrimaryAction()
  assert.equal(startRes2.isNeutralizing, true, 'Starts neutralization before incoming damage test')
  for (let i = 0; i < 18; i += 1) {
    engine.stepFrame(0.04, { render: false })
  }
  assert.equal(ctrl.isActive(), true, 'Active prior to incoming damage')
  const dmgRes = engine.applyDamage(25, { source: 'enemy_attack' })
  assert.equal(dmgRes, true, 'Incoming damage applies normally (zero invulnerability during neutralization)')
  assert.equal(engine.health, 75, 'Player health drops by full incoming damage')
  assert.equal(ctrl.isActive(), false, 'Incoming damage interrupts neutralization cleanly')
  assert.equal(wiring.getState(), HAZARD_STATES.ACTIVE, 'Damage-interrupted wiring stays ACTIVE')
  assert.ok(Math.abs(breakerHandle.rotation.x - -0.58) < 1e-3, 'Breaker lever resets on damage interruption')

  // 3d. Requirement 19a: Pause interrupts cleanly
  engine.health = 100
  engine.damageImmunityTimer = 0
  engine.setPlayerWorldPosition(safeStart.x, 0, safeStart.z, { immediate: true })
  assert.equal(engine.handlePrimaryAction().isNeutralizing, true, 'Starts neutralization before pause test')
  engine.stepFrame(0.2, { render: false })
  engine.setPaused(true)
  assert.equal(ctrl.isActive(), false, 'Pause cleanly interrupts active neutralization')
  assert.equal(wiring.getState(), HAZARD_STATES.ACTIVE, 'Pause-interrupted wiring remains ACTIVE')
  engine.setPaused(false)

  // 3e. Requirement 19b: Game Over (health -> 0) interrupts & clears animation state cleanly
  engine.setPlayerWorldPosition(safeStart.x, 0, safeStart.z, { immediate: true })
  assert.equal(engine.handlePrimaryAction().isNeutralizing, true, 'Starts neutralization before game-over test')
  engine.stepFrame(0.2, { render: false })
  engine.setHealth(0)
  assert.equal(ctrl.isActive(), false, 'Game over clears active neutralization')
  assert.equal(
    engine._playerAnimator?.getElectricalNeutralizeState?.().electricalMode,
    ELECTRICAL_WIRING_ANIM_MODES.NONE,
    'Game over clears stale PlayerAnimator electrical state'
  )

  engine.dispose()
  console.log('  [PASS] Suite 3: WASD/sprint, incoming damage, pause, game-over, and unsafe-zone rejection')
}

// -----------------------------------------------------------------------------
// Suite 4: Camera Modes (First-Person, Third-Person Character Follow,
//          Third-Person Free Look) & Pointer-Lock / Unlocked Targeting
// -----------------------------------------------------------------------------
{
  const modes = [
    {
      name: 'First-Person',
      cameraMode: CAMERA_MODES.FIRST_PERSON,
      thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
      ndc: { x: 0, y: 0 }, // pointer-lock center crosshair
    },
    {
      name: 'Third-Person Character Follow',
      cameraMode: CAMERA_MODES.THIRD_PERSON,
      thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
      ndc: null, // pointer-unlocked fallback
    },
    {
      name: 'Third-Person Free Look',
      cameraMode: CAMERA_MODES.THIRD_PERSON,
      thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
      ndc: { x: 0, y: 0 },
    },
  ]

  for (const cfg of modes) {
    const audioEvents = []
    const { engine, maze } = createHeadlessEngine({
      cameraMode: cfg.cameraMode,
      thirdPersonCameraMode: cfg.thirdPersonCameraMode,
      audioEvents,
    })
    const wiring = addElectricalWiringHazard(engine, maze, {
      id: `wiring-${cfg.name}`,
      row: 1,
      col: 3,
      wallDirection: 'north',
      mountType: 'wall',
    })
    activateWiring(wiring, maze)
    const cell = gridToWorld(1, 3, maze)
    const safeStart = localToWorld(cell, wiring.wallYaw, -2.86, -1.15)
    engine.setPlayerWorldPosition(safeStart.x, 0, safeStart.z, { immediate: true })
    // Aim camera directly toward breaker hardware so reticle raycast hits in pointer-lock mode too
    const brk = wiring.breakerWorldPos
    const dx = brk.x - safeStart.x
    const dz = brk.z - safeStart.z
    const yawToBreaker = Math.atan2(-dx, -dz)
    engine.setCameraYaw?.(yawToBreaker)
    engine.stepFrame(0.05, { render: false })

    const res = cfg.ndc
      ? engine.handlePrimaryAction({ ndc: cfg.ndc })
      : engine.handlePrimaryAction()
    assert.equal(res.handled, true, `${cfg.name}: left-click initiates neutralization`)
    assert.equal(res.isNeutralizing, true, `${cfg.name}: enters neutralizing animation`)

    let sawFPArmsVisible = false
    for (let i = 0; i < 55; i += 1) {
      engine.stepFrame(0.04, { render: false })
      if (cfg.cameraMode === CAMERA_MODES.FIRST_PERSON && engine.isNeutralizingElectricalWiring()) {
        if (engine._playerGroup?.visible === true) {
          sawFPArmsVisible = true
        }
      }
      if (wiring.getState() === HAZARD_STATES.ACTIVE) {
        const p = engine.getPlayerWorldPosition()
        assert.equal(
          wiring._isFootprintInElectricalTileArea(p.x, p.z, PLAYER_RADIUS),
          false,
          `${cfg.name}: player stays outside active electrical tile on step ${i}`
        )
      }
    }

    if (cfg.cameraMode === CAMERA_MODES.FIRST_PERSON) {
      assert.equal(sawFPArmsVisible, true, 'First-Person mode renders procedural arms during neutralization')
    }
    assert.equal(wiring.getState(), HAZARD_STATES.DISABLED, `${cfg.name}: completes neutralization`)
    assert.equal(engine.health, 100, `${cfg.name}: zero electrical damage taken`)
    assert.equal(audioEvents.length, 1, `${cfg.name}: fires exactly one completion audio cue`)
    engine.dispose()
  }

  console.log('  [PASS] Suite 4: First-Person, Third-Person Character Follow, Free Look & pointer-lock/unlocked')
}

// -----------------------------------------------------------------------------
// Suite 5: Collision-Aware Alternate Safe Position When Primary Blocked by Prop
//          + Rotated Wall Placements (N/S/W/E) & Ceiling Mount Support + Reset
// -----------------------------------------------------------------------------
{
  // 5a. Prop blocking primary upstream position -> controller selects alternate safe upstream stance
  const { engine, maze } = createHeadlessEngine({ grid: createOpenRoomGrid() })
  const wiring = addElectricalWiringHazard(engine, maze, {
    id: 'wiring-prop-avoid',
    row: 2,
    col: 3,
    wallDirection: 'north',
    mountType: 'wall',
  })
  activateWiring(wiring, maze)
  const cell = gridToWorld(2, 3, maze)

  // Ensure prop collision index exists and place a solid prop blocking the primary upstream spot (-2.81, -1.22)
  if (!engine._propCollisionIndex) {
    engine._propCollisionIndex = buildPropCollisionIndex(maze, [], { allowEmpty: true })
  }
  const primaryBlocked = localToWorld(cell, wiring.wallYaw, -2.81, -1.85)
  const crateRadius = 0.25
  registerDynamicCollider(engine._propCollisionIndex, {
    id: 'blocker-crate',
    ownerId: 'blocker-crate',
    kind: 'circle',
    cx: primaryBlocked.x,
    cz: primaryBlocked.z,
    radius: crateRadius,
    enabled: true,
  })

  // Stand safely on the upstream side clear of the crate and within breaker reach so an alternate safe spot (-2.81, -0.76) is used
  const altStart = localToWorld(cell, wiring.wallYaw, -2.86, -0.82)
  engine.setPlayerWorldPosition(altStart.x, 0, altStart.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })

  const res = engine.handlePrimaryAction()
  assert.equal(res.handled, true, 'Controller finds collision-free alternate safe position when primary is blocked by prop')
  assert.equal(res.isNeutralizing, true, 'Alternate safe stance starts physical neutralization')

  for (let i = 0; i < 55; i += 1) {
    engine.stepFrame(0.04, { render: false })
    const p = engine.getPlayerWorldPosition()
    // Must not penetrate the blocking crate collider
    const distToCrate = Math.hypot(p.x - primaryBlocked.x, p.z - primaryBlocked.z)
    assert.ok(
      distToCrate >= PLAYER_RADIUS + crateRadius - 0.05,
      `Player respects blocking prop collider during approach (dist=${distToCrate.toFixed(3)}m)`
    )
    if (wiring.getState() === HAZARD_STATES.ACTIVE) {
      assert.equal(
        wiring._isFootprintInElectricalTileArea(p.x, p.z, PLAYER_RADIUS),
        false,
        'Alternate approach stays completely outside active electrical tile'
      )
    }
  }
  assert.equal(wiring.getState(), HAZARD_STATES.DISABLED, 'Alternate safe stance completes neutralization')
  assert.equal(engine.health, 100, 'Zero electrical damage with alternate safe stance')

  // Verify resetCombat cleanly resets wiring and controller
  engine.resetCombat()
  assert.equal(wiring.getState(), HAZARD_STATES.DORMANT, 'resetCombat resets wiring to DORMANT')
  assert.equal(wiring.breakerLeverProgress, 0, 'resetCombat resets breakerLeverProgress to 0')
  assert.equal(
    engine.getElectricalWiringController().getStateName(),
    ELECTRICAL_WIRING_STATES.IDLE,
    'resetCombat resets ElectricalWiringController to IDLE'
  )
  engine.dispose()

  // 5b. Rotated wall mounts (north, south, west, east) AND ceiling mount in open intersection
  const orientations = [
    { wallDirection: 'north', mountType: 'wall', startLocal: [-2.88, -1.1] },
    { wallDirection: 'south', mountType: 'wall', startLocal: [-2.88, -1.1] },
    { wallDirection: 'west', mountType: 'wall', startLocal: [-2.88, -1.1] },
    { wallDirection: 'east', mountType: 'wall', startLocal: [-2.88, -1.1] },
    { wallDirection: 'north', mountType: 'ceiling', startLocal: [-2.88, 0.0] },
  ]

  for (const orient of orientations) {
    const { engine: oEngine, maze: oMaze } = createHeadlessEngine({ grid: createOpenRoomGrid() })
    const w = addElectricalWiringHazard(oEngine, oMaze, {
      id: `wiring-${orient.mountType}-${orient.wallDirection}`,
      row: 2,
      col: 3,
      wallDirection: orient.wallDirection,
      mountType: orient.mountType,
    })
    activateWiring(w, oMaze)
    const c = gridToWorld(2, 3, oMaze)
    const sp = localToWorld(c, w.wallYaw, orient.startLocal[0], orient.startLocal[1])
    oEngine.setPlayerWorldPosition(sp.x, 0, sp.z, { immediate: true })
    oEngine.stepFrame(0.05, { render: false })

    assert.equal(
      w._isFootprintInElectricalTileArea(sp.x, sp.z, PLAYER_RADIUS),
      false,
      `${orient.mountType}/${orient.wallDirection}: upstream start is outside active tile`
    )

    const r = oEngine.handlePrimaryAction()
    assert.equal(r.isNeutralizing, true, `${orient.mountType}/${orient.wallDirection}: initiates physical neutralization`)

    for (let i = 0; i < 55; i += 1) {
      oEngine.stepFrame(0.04, { render: false })
      if (w.getState() === HAZARD_STATES.ACTIVE) {
        const p = oEngine.getPlayerWorldPosition()
        assert.equal(
          w._isFootprintInElectricalTileArea(p.x, p.z, PLAYER_RADIUS),
          false,
          `${orient.mountType}/${orient.wallDirection}: step ${i} stays strictly outside active electrical tile`
        )
      }
    }

    assert.equal(w.getState(), HAZARD_STATES.DISABLED, `${orient.mountType}/${orient.wallDirection}: neutralized cleanly`)
    assert.equal(oEngine.health, 100, `${orient.mountType}/${orient.wallDirection}: zero damage taken`)
    oEngine.dispose()
  }

  // Confirm MAZE-HAZARD-WIRING-001 constants untouched
  assert.equal(ELECTRICAL_WIRING_CONSTANTS.wallDischargeLocalX, 0.26, 'Visible wire localX constant unchanged')
  assert.equal(ELECTRICAL_WIRING_CONSTANTS.wallDischargeLocalZ, -1.38, 'Visible wire localZ constant unchanged')
  assert.equal(ELECTRICAL_WIRING_CONSTANTS.wallDangerMinLocalX, -CELL_SIZE / 2, 'Full-tile min localX preserved')
  assert.equal(ELECTRICAL_WIRING_CONSTANTS.wallDangerMaxLocalX, CELL_SIZE / 2, 'Full-tile max localX preserved')
  assert.equal(ELECTRICAL_WIRING_CONSTANTS.wallDangerMinLocalZ, -CELL_SIZE / 2, 'Full-tile min localZ preserved')
  assert.equal(ELECTRICAL_WIRING_CONSTANTS.wallDangerMaxLocalZ, 0, 'Full-tile max localZ preserved')

  console.log('  [PASS] Suite 5: Prop avoidance, rotated mounts (N/S/W/E), ceiling mount, & resetCombat')
}

// -----------------------------------------------------------------------------
// Suite 6: Final Integration Audit (MAZE-HAZARD-WIRING-003) —
//          Multi-Hazard Isolation, Mid-Animation Camera Mode Switching,
//          Pause / Fatal Combat Damage / resetCombat / setMaze Cleanup,
//          getNearbyInteractable Suppression, & Cross-Controller Mutual Exclusion
// -----------------------------------------------------------------------------
{
  const audioEvents = []
  const { engine, maze } = createHeadlessEngine({
    grid: createOpenRoomGrid(),
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
    audioEvents,
  })
  const ctrl = engine.getElectricalWiringController()

  // Place TWO independent exposed electrical wiring hazards in the same maze (upstream tiles col 2 & col 4 are open PATH)
  const wiringA = addElectricalWiringHazard(engine, maze, {
    id: 'wiring-multi-A',
    row: 1,
    col: 3,
    wallDirection: 'north',
    mountType: 'wall',
  })
  const wiringB = addElectricalWiringHazard(engine, maze, {
    id: 'wiring-multi-B',
    row: 1,
    col: 5,
    wallDirection: 'north',
    mountType: 'wall',
  })
  activateWiring(wiringA, maze)
  activateWiring(wiringB, maze)

  const cellA = gridToWorld(1, 3, maze)
  const cellB = gridToWorld(1, 5, maze)

  // 6a. Start neutralizing Wiring A -> verify getNearbyInteractable suppresses stale prompt,
  //     verify ALL other hazard controllers reject activation (mutual exclusion),
  //     and switch camera modes mid-animation (TP Follow -> FP -> TP Free Look -> TP Follow)
  const startA = localToWorld(cellA, wiringA.wallYaw, -2.86, -1.12)
  engine.setPlayerWorldPosition(startA.x, 0, startA.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })

  const resA = engine.handlePrimaryAction()
  assert.equal(resA.isNeutralizing, true, 'Starts neutralization on Wiring A')
  assert.equal(
    engine.getNearbyInteractable(),
    null,
    'getNearbyInteractable returns null (no stale wiring prompt) during active neutralization'
  )

  // Cross-controller mutual exclusion while neutralizing electrical wiring
  assert.equal(
    engine.rubbleController.tryPickup().handled,
    false,
    'CeilingRubbleController rejects pickup during electrical neutralization'
  )
  assert.equal(
    engine.furnitureController.tryStartHandling().handled,
    false,
    'RottenFurnitureController rejects handling during electrical neutralization'
  )
  assert.equal(
    engine.pipesController.tryStartHandling().handled,
    false,
    'FallingPipesController rejects handling during electrical neutralization'
  )
  assert.equal(
    engine.steamRepairController.tryStartRepair().handled,
    false,
    'SteamRepairController rejects repair during electrical neutralization'
  )

  // Switch camera modes mid-animation and verify continuous progression & visibility sync
  for (let i = 0; i < 12; i += 1) engine.stepFrame(0.04, { render: false })
  engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
  assert.equal(
    engine._playerGroup.visible,
    true,
    'Switching to First-Person mid-neutralization immediately keeps procedural arms visible'
  )
  assert.equal(ctrl.isActive(), true, 'Switching to First-Person does not abort neutralization')

  for (let i = 0; i < 12; i += 1) engine.stepFrame(0.04, { render: false })
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
  engine.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK)
  assert.equal(ctrl.isActive(), true, 'Switching to Third-Person Free Look mid-neutralization continues smoothly')

  for (let i = 0; i < 36; i += 1) engine.stepFrame(0.04, { render: false })
  assert.equal(wiringA.getState(), HAZARD_STATES.DISABLED, 'Wiring A completes neutralization after mid-animation camera switches')
  assert.equal(wiringB.getState(), HAZARD_STATES.ACTIVE, 'Wiring B remains unaffected & ACTIVE while Wiring A is neutralized')
  assert.equal(audioEvents.length, 1, 'Exactly 1 completion audio cue fired for Wiring A')

  // 6b. Neutralize Wiring B sequentially from controller NEUTRALIZED state
  const startB = localToWorld(cellB, wiringB.wallYaw, -2.86, -1.12)
  engine.setPlayerWorldPosition(startB.x, 0, startB.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  const resB = engine.handlePrimaryAction()
  assert.equal(resB.isNeutralizing, true, 'Controller cleanly initiates neutralization on second wiring hazard (Wiring B)')
  for (let i = 0; i < 55; i += 1) engine.stepFrame(0.04, { render: false })
  assert.equal(wiringB.getState(), HAZARD_STATES.DISABLED, 'Wiring B completes neutralization cleanly')
  assert.equal(audioEvents.length, 2, 'Exactly 1 additional completion audio cue fired for Wiring B')

  // 6c. Full hardware & visual restoration on resetCombat()
  engine.resetCombat()
  for (const [label, w] of [['A', wiringA], ['B', wiringB]]) {
    const ud = w.mesh.userData
    assert.equal(w.getState(), HAZARD_STATES.DORMANT, `Wiring ${label} restored to DORMANT after resetCombat`)
    assert.equal(w.breakerLeverProgress, 0, `Wiring ${label} breakerLeverProgress reset to 0`)
    assert.ok(
      Math.abs(ud.breakerHandleGroup.rotation.x - -0.58) < 1e-3,
      `Wiring ${label} breakerHandleGroup restored to ON (-0.58 rad)`
    )
    assert.ok(
      Math.abs(ud.junctionDoorGroup.rotation.y) < 1e-3,
      `Wiring ${label} junctionDoorGroup closed (0 rad) in DORMANT`
    )
    assert.equal(ud.insulationGroup.visible, false, `Wiring ${label} insulationGroup hidden after resetCombat`)
    assert.equal(ud.arcGroup.visible, false, `Wiring ${label} arcGroup hidden in DORMANT`)
    assert.equal(ud.sparkGroup.visible, false, `Wiring ${label} sparkGroup hidden in DORMANT`)
  }
  assert.equal(
    engine._playerAnimator.getElectricalNeutralizeState().electricalMode,
    ELECTRICAL_WIRING_ANIM_MODES.NONE,
    'resetCombat clears PlayerAnimator electrical state'
  )

  // 6d. Pause mid-neutralization immediately clears PlayerAnimator electrical state
  activateWiring(wiringA, maze)
  engine.setPlayerWorldPosition(startA.x, 0, startA.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  assert.equal(engine.handlePrimaryAction().isNeutralizing, true, 'Starts neutralization prior to pause check')
  for (let i = 0; i < 12; i += 1) engine.stepFrame(0.04, { render: false })
  engine.setPaused(true)
  assert.equal(ctrl.isActive(), false, 'Pause interrupts controller')
  assert.equal(
    engine._playerAnimator.getElectricalNeutralizeState().electricalMode,
    ELECTRICAL_WIRING_ANIM_MODES.NONE,
    'Pause immediately clears stale PlayerAnimator electrical state'
  )
  engine.setPaused(false)

  // 6e. Fatal combat damage (applyDamage -> 0 HP) mid-neutralization clears PlayerAnimator electrical state
  engine.setPlayerWorldPosition(startA.x, 0, startA.z, { immediate: true })
  engine.damageImmunityTimer = 0
  engine.stepFrame(0.05, { render: false })
  assert.equal(engine.handlePrimaryAction().isNeutralizing, true, 'Starts neutralization prior to fatal damage check')
  for (let i = 0; i < 14; i += 1) engine.stepFrame(0.04, { render: false })
  engine.applyDamage(100, { source: 'enemy_attack' })
  assert.equal(engine.isGameOver, true, 'Fatal combat damage triggers game over')
  assert.equal(ctrl.isActive(), false, 'Fatal combat damage resets controller')
  assert.equal(
    engine._playerAnimator.getElectricalNeutralizeState().electricalMode,
    ELECTRICAL_WIRING_ANIM_MODES.NONE,
    'Fatal combat damage clears stale PlayerAnimator electrical state'
  )

  // 6f. New maze replacement (setMaze) mid-neutralization cleanly resets controller & animator
  engine.resetCombat()
  activateWiring(wiringA, maze)
  engine.setPlayerWorldPosition(startA.x, 0, startA.z, { immediate: true })
  engine.stepFrame(0.05, { render: false })
  assert.equal(engine.handlePrimaryAction().isNeutralizing, true, 'Starts neutralization prior to setMaze check')
  for (let i = 0; i < 10; i += 1) engine.stepFrame(0.04, { render: false })

  const newGrid = createTwoTileCorridorGrid()
  const newMaze = {
    grid: newGrid,
    rows: newGrid.length,
    cols: newGrid[0].length,
    start: { row: 1, col: 1 },
    exit: { row: 1, col: 5 },
    level: 4,
    seed: 9904,
  }
  engine.setMaze(newMaze)
  engine.cancelSpawnSequence?.({ syncYaw: false })
  assert.equal(ctrl.isActive(), false, 'setMaze resets active electrical neutralization cleanly')
  assert.equal(ctrl.getActiveHazard(), null, 'setMaze clears activeHazard reference (no stale reference)')
  assert.equal(
    engine._playerAnimator.getElectricalNeutralizeState().electricalMode,
    ELECTRICAL_WIRING_ANIM_MODES.NONE,
    'setMaze clears PlayerAnimator electrical state'
  )

  engine.dispose()
  console.log('  [PASS] Suite 6: Multi-wiring, mid-anim camera switch, pause/death/reset/setMaze cleanup & mutual exclusion')
}

// -----------------------------------------------------------------------------
// Suite 7: MAZE-HAZARD-WIRING-004 — Real Pointer Click Dispatch, Prompt-to-Click
//          Parity Invariant, Opposite-Lane Safe Perimeter Route, Comfortable
//          Upstream Reach, Pointer-Lock & Unlocked Mouse Jitter Clicks
// -----------------------------------------------------------------------------
{
  function createPointerDispatchEnv() {
    const listeners = new Map()
    const docListeners = new Map()
    const activePointers = new Set()
    const capturedPointers = new Set()

    const doc = {
      pointerLockElement: null,
      addEventListener(type, fn) {
        if (!docListeners.has(type)) docListeners.set(type, new Set())
        docListeners.get(type).add(fn)
      },
      removeEventListener(type, fn) {
        docListeners.get(type)?.delete(fn)
      },
      dispatchEvent(event) {
        const set = docListeners.get(event.type)
        if (!set) return
        for (const fn of [...set]) fn(event)
      },
    }

    const canvasHost = {
      clientWidth: 960,
      clientHeight: 540,
      isConnected: true,
      ownerDocument: doc,
      appendChild() {},
      removeChild() {},
      contains(el) {
        return el === canvasHost
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 960, height: 540 }
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type).add(fn)
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn)
      },
      dispatchEvent(event) {
        const set = listeners.get(event.type)
        if (!set) return
        for (const fn of [...set]) fn(event)
      },
      hasPointerCapture(pointerId) {
        return capturedPointers.has(pointerId)
      },
      setPointerCapture(pointerId) {
        if (doc.pointerLockElement !== null) {
          const err = new Error('InvalidStateError')
          err.name = 'InvalidStateError'
          throw err
        }
        if (!activePointers.has(pointerId)) {
          const err = new Error('NotFoundError')
          err.name = 'NotFoundError'
          throw err
        }
        capturedPointers.add(pointerId)
      },
      releasePointerCapture(pointerId) {
        capturedPointers.delete(pointerId)
      },
    }

    return { doc, canvasHost, activePointers, capturedPointers }
  }

  function createPointerWiringHarness({
    grid = createTwoTileCorridorGrid(),
    cameraMode = CAMERA_MODES.FIRST_PERSON,
    thirdPersonCameraMode = THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
  } = {}) {
    const env = createPointerDispatchEnv()
    const rows = grid.length
    const cols = grid[0].length
    const maze = {
      grid,
      rows,
      cols,
      start: { row: 1, col: 1 },
      exit: { row: rows - 2, col: cols - 2 },
      level: 3,
      seed: 9404,
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
    const engine = new MazeSceneEngine(env.canvasHost, {
      createRenderer: () => mockRenderer,
      skipSpawnSequence: true,
      cameraMode,
      thirdPersonCameraMode,
      initialHealth: 100,
      maxHealth: 100,
      enemies: { autoSpawn: false },
    })
    engine.setMaze(maze)
    engine.cancelSpawnSequence?.({ syncYaw: false })
    engine.hazardManager.clear()
    engine.syncHazardColliders({ allowPushOut: false })

    const latestProps = {
      controlsEnabled: true,
      hasWon: false,
      isGameOver: false,
      isArrivalLocked: false,
      showDiagnosticsModal: false,
      engineConfig: {},
    }
    const pointerController = createViewportPointerController({
      canvasHost: env.canvasHost,
      doc: env.doc,
      getEngine: () => engine,
      getLatestProps: () => latestProps,
      resolveLookInputConfig,
    })
    pointerController.attach()

    return { env, engine, maze, pointerController }
  }

  function aimCameraAt(engine, targetWorldPos) {
    const pos = engine.getPlayerWorldPosition()
    const dx = targetWorldPos.x - pos.x
    const dz = targetWorldPos.z - pos.z
    const yaw = Math.atan2(-dx, -dz)
    engine.setCameraYaw?.(yaw)
    engine.cameraRig?.setLookDirection?.(yaw, -0.05)
    engine.cameraRig?.snap?.()
    engine.cameraRig?.camera?.updateMatrixWorld?.(true)
  }

  // 7a. Prompt-to-Click Parity Invariant across safe upstream, safe opposite lane, AND inside-danger-zone positions
  {
    const { engine, maze, pointerController } = createPointerWiringHarness()
    const wiring = addElectricalWiringHazard(engine, maze, {
      id: 'wiring-parity',
      row: 1,
      col: 3,
      wallDirection: 'north',
      mountType: 'wall',
    })
    activateWiring(wiring, maze)
    const cell = gridToWorld(1, 3, maze)
    const ctrl = engine.getElectricalWiringController()

    // Standing INSIDE active electrical damage tile (previously showed prompt then rejected click!)
    const insideTilePos = localToWorld(cell, wiring.wallYaw, -2.4, -1.1)
    assert.equal(
      wiring._isFootprintInElectricalTileArea(insideTilePos.x, insideTilePos.z, PLAYER_RADIUS),
      true,
      'Test position (-2.4, -1.1) overlaps active electrical tile footprint'
    )
    engine.setPlayerWorldPosition(insideTilePos.x, 0, insideTilePos.z, { immediate: true })
    engine.stepFrame(0.05, { render: false })
    assert.equal(
      engine.getNearbyInteractable(),
      null,
      'Prompt is NOT falsely displayed while standing inside active electrical damage tile'
    )
    assert.equal(engine.health, 70, 'Standing inside active electrical tile still deals full 30 electrical damage')
    const rejectedInside = engine.handlePrimaryAction()
    assert.equal(ctrl.isActive(), false, 'Left-click inside active electrical tile never starts neutralization')
    assert.ok(!rejectedInside.isNeutralizing, 'Primary action inside danger zone rejects neutralization')

    // Sweep a dense grid of positions around the hazard: EVERY position where prompt appears MUST start neutralization on click!
    let verifiedPromptMatches = 0
    for (const lx of [-3.4, -3.15, -2.9, -2.82, -2.5, -1.6, -0.5, 0.2, 1.5, 2.9]) {
      for (const lz of [-1.2, -0.85, -0.2, 0.4, 0.88, 1.15]) {
        const pt = localToWorld(cell, wiring.wallYaw, lx, lz)
        const overlapsTile = wiring._isFootprintInElectricalTileArea(pt.x, pt.z, PLAYER_RADIUS)
        engine.health = 100
        engine.damageImmunityTimer = 0
        engine.setPlayerWorldPosition(pt.x, 0, pt.z, { immediate: true })
        engine.stepFrame(0.02, { render: false })
        const prompt = engine.getNearbyInteractable()
        if (overlapsTile) {
          assert.equal(
            prompt,
            null,
            `No prompt when overlapping active electrical tile at local (${lx}, ${lz})`
          )
        } else if (prompt && prompt.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
          const clickRes = engine.handlePrimaryAction()
          assert.equal(
            clickRes.handled && clickRes.isNeutralizing,
            true,
            `Prompt-to-click parity: prompt shown at local (${lx}, ${lz}) MUST start neutralization on left-click`
          )
          // Step one frame to confirm NO Frame-1 out_of_range abort occurs!
          engine.stepFrame(0.04, { render: false })
          assert.equal(
            ctrl.isActive(),
            true,
            `Neutralization stays active past Frame 1 from local (${lx}, ${lz}) (lastInterrupt=${ctrl.getInteractionSnapshot().lastInterruptReason})`
          )
          ctrl.interruptNeutralize({ immediate: true, reason: 'parity_reset' })
          verifiedPromptMatches += 1
        }
      }
    }
    assert.ok(
      verifiedPromptMatches >= 12,
      `Verified prompt-to-click parity across ${verifiedPromptMatches} safe upstream & opposite-lane positions`
    )

    pointerController.detach()
    engine.dispose()
  }

  // 7b. Safe Opposite Corridor Lane Click -> Smooth 2-Waypoint Perimeter Route Around Live Tile -> Completion
  {
    const { env, engine, maze, pointerController } = createPointerWiringHarness({
      cameraMode: CAMERA_MODES.THIRD_PERSON,
      thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
    })
    const wiring = addElectricalWiringHazard(engine, maze, {
      id: 'wiring-opposite-lane',
      row: 1,
      col: 3,
      wallDirection: 'north',
      mountType: 'wall',
    })
    activateWiring(wiring, maze)
    const cell = gridToWorld(1, 3, maze)
    const ctrl = engine.getElectricalWiringController()

    // Stand safely in the opposite corridor lane (localX = 0.0, localZ = +0.90)
    const oppPos = localToWorld(cell, wiring.wallYaw, 0.0, 0.9)
    engine.setPlayerWorldPosition(oppPos.x, 0, oppPos.z, { immediate: true })
    aimCameraAt(engine, wiring.breakerWorldPos)
    engine.stepFrame(0.05, { render: false })
    assert.equal(engine.health, 100, 'Opposite corridor lane is strictly outside active electrical tile')

    const prompt = engine.getNearbyInteractable()
    assert.ok(
      prompt && prompt.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      'Prompt displays cleanly from safe opposite corridor lane'
    )

    // Real pointer-unlocked left-click WITH 12px mouse jitter before pointerup!
    env.activePointers.add(7)
    env.canvasHost.dispatchEvent({
      type: 'pointerdown',
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 480,
      clientY: 270,
    })
    env.canvasHost.dispatchEvent({
      type: 'pointermove',
      pointerId: 7,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 492,
      clientY: 274,
    })
    env.canvasHost.dispatchEvent({
      type: 'pointerup',
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 492,
      clientY: 274,
    })
    env.activePointers.delete(7)

    assert.equal(
      ctrl.isActive(),
      true,
      'Unlocked left-click with 12px jitter immediately starts neutralization from opposite lane'
    )

    let prevPos = { ...engine.getPlayerWorldPosition() }
    let maxStep = 0
    for (let f = 0; f < 100; f += 1) {
      engine.stepFrame(0.04, { render: false })
      const cur = { ...engine.getPlayerWorldPosition() }
      const d = Math.hypot(cur.x - prevPos.x, cur.z - prevPos.z)
      if (d > maxStep) maxStep = d
      prevPos = cur
      if (wiring.getState() === HAZARD_STATES.ACTIVE) {
        assert.equal(
          wiring._isFootprintInElectricalTileArea(cur.x, cur.z, PLAYER_RADIUS),
          false,
          `Opposite-lane perimeter route frame ${f}: ZERO overlap with active electrical tile`
        )
      }
      assert.equal(engine.health, 100, `Opposite-lane perimeter route frame ${f}: ZERO electrical damage`)
    }

    assert.ok(maxStep < 0.35, `Perimeter route around live tile is smooth without teleporting (maxStep=${maxStep.toFixed(3)}m)`)
    assert.equal(wiring.getState(), HAZARD_STATES.DISABLED, 'Opposite-lane click completes full neutralization')
    assert.equal(wiring.isAftermathCleared, true, 'Opposite-lane neutralization clears wiring hazard')

    pointerController.detach()
    engine.dispose()
  }

  // 7c. Pointer-Locked Left-Click From Comfortable Safe Upstream Tile + Unlocked Drag-Look Preservation
  {
    const { env, engine, maze, pointerController } = createPointerWiringHarness({
      cameraMode: CAMERA_MODES.FIRST_PERSON,
    })
    const wiring = addElectricalWiringHazard(engine, maze, {
      id: 'wiring-locked-click',
      row: 1,
      col: 3,
      wallDirection: 'north',
      mountType: 'wall',
    })
    activateWiring(wiring, maze)
    const cell = gridToWorld(1, 3, maze)
    const ctrl = engine.getElectricalWiringController()

    // Comfortable safe upstream standing position (-3.15, -0.85) — previously failed out_of_range!
    const upPos = localToWorld(cell, wiring.wallYaw, -3.15, -0.85)
    engine.setPlayerWorldPosition(upPos.x, 0, upPos.z, { immediate: true })
    // First face AWAY from wiring in unlocked mode and drag-look -> must rotate camera without starting repair!
    engine.setCameraYaw?.(Math.PI * 0.5)
    engine.cameraRig?.setLookDirection?.(Math.PI * 0.5, 0)
    engine.cameraRig?.snap?.()
    engine.stepFrame(0.05, { render: false })
    const yawBeforeDrag = engine.cameraRig.getLookDirection().yaw

    env.activePointers.add(11)
    env.canvasHost.dispatchEvent({
      type: 'pointerdown',
      pointerId: 11,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 480,
      clientY: 270,
    })
    env.canvasHost.dispatchEvent({
      type: 'pointermove',
      pointerId: 11,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 560,
      clientY: 270,
    })
    env.canvasHost.dispatchEvent({
      type: 'pointerup',
      pointerId: 11,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 560,
      clientY: 270,
    })
    env.activePointers.delete(11)
    assert.equal(ctrl.isActive(), false, 'Unlocked drag-look while facing away from wiring does not accidentally trigger repair')
    assert.notEqual(
      engine.cameraRig.getLookDirection().yaw,
      yawBeforeDrag,
      'Unlocked drag-look still rotates camera cleanly'
    )

    // Now engage Pointer Lock, aim at breaker, verify prompt, and press left mouse button
    env.doc.pointerLockElement = env.canvasHost
    aimCameraAt(engine, wiring.breakerWorldPos)
    engine.stepFrame(0.05, { render: false })
    const prompt = engine.getNearbyInteractable()
    assert.ok(
      prompt && prompt.type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      'Prompt displays cleanly from comfortable safe upstream stance (-3.15, -0.85)'
    )

    env.canvasHost.dispatchEvent({
      type: 'pointerdown',
      pointerId: 12,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 480,
      clientY: 270,
    })
    assert.equal(ctrl.isActive(), true, 'Pointer-locked left-click immediately starts physical neutralization')

    // Right-click during active neutralization does nothing
    env.canvasHost.dispatchEvent({
      type: 'pointerdown',
      pointerId: 13,
      pointerType: 'mouse',
      button: 2,
      buttons: 2,
      clientX: 480,
      clientY: 270,
    })
    assert.equal(ctrl.isActive(), true, 'Right-click never aborts or duplicates electrical neutralization')

    for (let i = 0; i < 65; i += 1) {
      engine.stepFrame(0.04, { render: false })
    }
    assert.equal(wiring.getState(), HAZARD_STATES.DISABLED, 'Pointer-locked click completes full neutralization')
    assert.equal(engine.health, 100, 'Zero damage taken during pointer-locked safe upstream neutralization')

    pointerController.detach()
    engine.dispose()
  }

  console.log('  [PASS] Suite 7: MAZE-HAZARD-WIRING-004 real pointer click dispatch, prompt parity, opposite-lane perimeter & locked/unlocked modes')
}

console.log('ALL MAZE-HAZARD-WIRING-002 / 003 / 004 PHYSICAL ELECTRICAL WIRING ANIMATION & CLICK DISPATCH TESTS PASSED!')
