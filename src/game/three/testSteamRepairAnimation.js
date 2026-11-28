/**
 * End-to-End Automated Verification Suite for MAZE-HAZARD-STEAM-ANIM-001
 * Physical Steam Pipe Tape Repair Animation, Stance, Pipe-Height Kinematics,
 * Progressive Tape Visuals, WASD & Damage Interruption, Partial Progress Preservation,
 * Multi-Pipe Support, First-Person & Third-Person Camera Modes, and Valve Coexistence.
 */

import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { resolveGridCollision } from '../world/gridCollision.js'
import { PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { buildPlayer } from './buildPlayer.js'
import { CAMERA_MODES, THIRD_PERSON_CAMERA_MODES } from './CameraRig.js'
import { HAZARD_CONFIG, HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  STEAM_REPAIR_STATES,
  STEAM_REPAIR_ANIM_MODES,
  STEAM_REPAIR_CONFIG,
  SteamRepairController,
} from './SteamRepairController.js'
import { PlayerAnimator } from './PlayerAnimator.js'

const W = CELL_TYPES.WALL
const P = CELL_TYPES.PATH
const S = CELL_TYPES.START
const E = CELL_TYPES.EXIT

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createMockCanvasHost() {
  return {
    clientWidth: 960,
    clientHeight: 540,
    appendChild() {},
    removeChild() {},
  }
}

function createHeadlessEngine({
  cameraMode = CAMERA_MODES.THIRD_PERSON,
  thirdPersonCameraMode = THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
  audioEvents = null,
} = {}) {
  const grid = [
    [W, W, W, W, W, W, W, W, W],
    [W, W, W, W, W, W, W, W, W],
    [W, S, P, P, P, P, P, E, W],
    [W, W, W, W, W, W, W, W, W],
    [W, W, W, W, W, W, W, W, W],
  ]
  const maze = {
    grid,
    rows: grid.length,
    cols: grid[0].length,
    start: { row: 2, col: 1 },
    exit: { row: 2, col: 7 },
    level: 3,
    seed: 9104,
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
      audioEvents.push({ action, type, anchor })
      return origOnHazard?.(action, type, anchor)
    }
  }
  engine.setMaze(maze)
  engine.cancelSpawnSequence?.({ syncYaw: false })
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })
  return { engine, maze }
}

function activateSteamHazard(hazard, hazardCell, maze) {
  const cellW = gridToWorld(hazardCell.row, hazardCell.col, maze)
  const warnDur = HAZARD_CONFIG[HAZARD_TYPES.STEAM_PIPE_BURST].warningDuration
  hazard.update(0.05, { playerWorldPos: cellW, playerGridCell: hazardCell })
  hazard.update(warnDur + 0.05, {
    playerWorldPos: { x: cellW.x + 12, y: 0, z: cellW.z + 12 },
    playerGridCell: { row: 2, col: 1 },
  })
  assert(hazard.getState() === HAZARD_STATES.ACTIVE, 'Steam hazard transitions to ACTIVE')
}

console.log('=== RUNNING MAZE-HAZARD-STEAM-ANIM-001 AUTOMATED VERIFICATION SUITE ===')

// -------------------------------------------------------------
// Test 1: SteamRepairController Lifecycle, Target Selection & Reach
// -------------------------------------------------------------
console.log('Test 1: SteamRepairController Lifecycle, Target Selection & Reach')
{
  const mockPlayerPos = new THREE.Vector3(10, 0, 10)
  const mockPlayerGroup = new THREE.Group()
  mockPlayerGroup.rotation.y = 0

  const mockSteamHazard = {
    id: 'hazard_steam_001',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    state: HAZARD_STATES.ACTIVE,
    isDisposed: false,
    isAftermathCleared: false,
    repairProgress: 0,
    worldPos: new THREE.Vector3(10.8, 0, 10),
    originWorldPos: new THREE.Vector3(10.8, 1.38, 10),
    valveWorldPos: new THREE.Vector3(9.2, 1.28, 10),
    getInteractionAnchor() {
      return this.originWorldPos
    },
    setRepairProgress(p) {
      this.repairProgress = p
    },
    _syncColliderStates() {},
    mesh: {
      userData: {
        steamCloud: { visible: true },
        steamMat: { opacity: 0.74 },
        repairPatchGroup: { visible: false, scale: new THREE.Vector3(1, 1, 1) },
      },
    },
  }

  const mockEngine = {
    _playerWorldPos: mockPlayerPos,
    _playerGroup: mockPlayerGroup,
    cameraRig: {
      getCharacterDirection: () => ({ yaw: 0 }),
      getLookDirection: () => ({ yaw: 0 }),
      isFreeLookActive: () => false,
      setCharacterYaw(y) {
        this.yaw = y
      },
      setPlayerPosition() {},
    },
    hazardManager: {
      getHazards: () => [mockSteamHazard],
    },
    isGameOver: false,
    hasWon: false,
    isPaused: false,
    syncPlayerVisibility() {},
    _notifyStealthChange() {},
    emitSound() {},
    _syncHazardColliders() {},
  }

  const controller = new SteamRepairController(mockEngine)
  mockEngine.steamRepairController = controller
  assert(controller.getStateName() === STEAM_REPAIR_STATES.IDLE, 'Controller starts IDLE')
  assert(!controller.isActive(), 'Controller is not active initially')

  // Out of reach test
  mockPlayerPos.set(100, 0, 100)
  const outOfReachNoTarget = controller.tryStartRepair()
  assert(
    !outOfReachNoTarget.handled && outOfReachNoTarget.reason === 'no_target',
    'Rejects when no reachable hazard'
  )
  const outOfReachExplicit = controller.tryStartRepair(mockSteamHazard)
  assert(
    !outOfReachExplicit.handled && outOfReachExplicit.reason === 'out_of_range',
    'Rejects out-of-range explicit hazard'
  )

  // In reach test
  mockPlayerPos.set(10, 0, 10)
  const startRes = controller.tryStartRepair()
  assert(startRes.handled === true, 'Successfully starts repair when in reach')
  assert(startRes.action === 'seal_steam_pipe', 'Action matches seal_steam_pipe')
  assert(
    controller.getStateName() === STEAM_REPAIR_STATES.REPAIRING,
    'Controller transitions to REPAIRING'
  )
  assert(controller.isRepairing(), 'isRepairing() returns true')

  // Phase A positioning & progress
  controller.update(0.15)
  assert(
    mockSteamHazard.repairProgress === 0,
    'Tape progress stays 0 during initial Phase A approach/reach'
  )
  controller.update(0.6)
  const snap = controller.getInteractionSnapshot()
  assert(snap.isRepairing === true, 'Snapshot confirms active repairing')
  assert(snap.progress > 0.25 && snap.progress < 0.6, 'Progress advances smoothly')
  assert(mockSteamHazard.repairProgress > 0.1, 'Hazard received tape progress callback after reach')
  assert(Number.isFinite(mockPlayerGroup.rotation.y), 'Player yaw was updated toward rupture anchor')

  // Free look yaw sync check
  let characterYawSet = null
  mockEngine.cameraRig.isFreeLookActive = () => true
  mockEngine.cameraRig.setCharacterYaw = (y) => {
    characterYawSet = y
  }
  controller.reset()
  mockSteamHazard.repairProgress = 0
  controller.tryStartRepair()
  controller.update(0.1)
  assert(
    characterYawSet !== null,
    'Free look camera rig receives character yaw update during repair turn'
  )

  // Completion check
  controller.update(STEAM_REPAIR_CONFIG.repairDurationSec + 0.1)
  assert(controller.getStateName() === STEAM_REPAIR_STATES.REPAIRED, 'Transitions to REPAIRED')
  assert(mockSteamHazard.state === HAZARD_STATES.DISABLED, 'Hazard set DISABLED upon completion')
  assert(mockSteamHazard.isAftermathCleared === true, 'Hazard aftermath cleared')
  assert(mockSteamHazard.mesh.userData.steamCloud.visible === false, 'Steam cloud hidden')
  assert(mockSteamHazard.mesh.userData.steamMat.opacity === 0, 'Steam opacity set to 0')
  assert(mockSteamHazard.mesh.userData.repairPatchGroup.visible === true, 'Repair patch visible')

  controller.dispose()
}
console.log('✓ Test 1 Passed: SteamRepairController lifecycle, Phase A standoff & completion')

// -------------------------------------------------------------
// Test 2: Real Player Rig 3D Kinematics — Hand Height, Reach, Wrap Orbit, Tension & Smooth
// -------------------------------------------------------------
console.log('Test 2: Real Player Rig 3D Kinematics & Coordinated Wrapping Animation')
{
  const playerRoot = buildPlayer({ visible: true })
  const rig = playerRoot.userData.rig
  const animator = new PlayerAnimator(playerRoot)
  assert(typeof animator.getSteamRepairState === 'function', 'Exposes getSteamRepairState()')

  const motionSample = {
    moved: false,
    actualSpeed: 0,
    walkSpeed: 3.2,
    sprintSpeed: 5.6,
    isSprinting: false,
    steamRepair: { mode: STEAM_REPAIR_ANIM_MODES.REPAIR, progress: 0 },
    isFirstPerson: false,
  }

  const leftWristWorld = new THREE.Vector3()
  const rightWristWorld = new THREE.Vector3()
  const sampleRig = (progress, dt = 0.25) => {
    motionSample.steamRepair = { mode: STEAM_REPAIR_ANIM_MODES.REPAIR, progress }
    for (let i = 0; i < 10; i += 1) {
      animator.update(dt / 10, motionSample)
    }
    playerRoot.updateMatrixWorld(true)
    rig.leftWristPivot.getWorldPosition(leftWristWorld)
    rig.rightWristPivot.getWorldPosition(rightWristWorld)
    return {
      left: leftWristWorld.clone(),
      right: rightWristWorld.clone(),
      state: animator.getSteamRepairState(),
    }
  }

  const sContact = sampleRig(0.18, 0.35)
  assert(sContact.state.steamRepairCrouch > 0.2, 'Light athletic repair stance engaged')
  assert(
    sContact.left.y > 1.25 && sContact.left.y < 1.5,
    `Left stabilizing wrist reaches pipe height (~1.38m), got y=${sContact.left.y.toFixed(3)}`
  )
  assert(
    sContact.left.z < -0.45,
    `Left stabilizing wrist extends toward pipe (-Z), got z=${sContact.left.z.toFixed(3)}`
  )
  assert(
    sContact.right.y > 1.25 && sContact.right.y < 1.52,
    `Right tape wrist reaches pipe height (~1.38m), got y=${sContact.right.y.toFixed(3)}`
  )

  // Sample across wrap orbit (0.24..0.41) — verify circular Y/Z orbit displacement!
  const orbitPositions = []
  for (const p of [0.24, 0.29, 0.34, 0.39]) {
    orbitPositions.push(sampleRig(p, 0.1).right)
  }
  const minOrbY = Math.min(...orbitPositions.map((v) => v.y))
  const maxOrbY = Math.max(...orbitPositions.map((v) => v.y))
  const minOrbZ = Math.min(...orbitPositions.map((v) => v.z))
  const maxOrbZ = Math.max(...orbitPositions.map((v) => v.z))
  assert(
    maxOrbY - minOrbY > 0.08 && maxOrbZ - minOrbZ > 0.06,
    `Right hand orbits pipe in Y-Z plane during wrapping (dY=${(maxOrbY - minOrbY).toFixed(3)}, dZ=${(maxOrbZ - minOrbZ).toFixed(3)})`
  )

  // Verify tension pull phase (0.46) pulls backward toward player compared to orbit contact
  const sTension = sampleRig(0.46, 0.1)
  assert(sTension.state.steamRepairTension > 0.3, 'Tension channel peaks during pull/tension phase')
  assert(
    sTension.right.z > minOrbZ + 0.04,
    'Right hand pulls back slightly during tension phase'
  )

  // Verify smoothing phase (0.83)
  const sSmooth = sampleRig(0.83, 0.1)
  assert(sSmooth.state.steamRepairSmooth > 0.3, 'Smoothing channel peaks during final press/smooth')
  assert(sSmooth.state.steamRepairEffort > 0.65, 'High effort applied during smoothing')

  // Verify withdrawal phase (0.98..none) returns hands smoothly toward neutral idle
  motionSample.steamRepair = { mode: STEAM_REPAIR_ANIM_MODES.NONE, progress: 0 }
  for (let i = 0; i < 20; i += 1) {
    animator.update(0.05, motionSample)
  }
  assert(animator.getSteamRepairState().steamRepairBlend < 0.05, 'Withdraws cleanly to idle')

  animator.dispose()
}
console.log('✓ Test 2 Passed: Real rig 3D hand height, orbit, tension, smoothing & withdraw verified')

// -------------------------------------------------------------
// Test 3: Real Engine Approach, Progressive Tape Meshes, Damage Before Complete, Double-Tap Anti-Exploit & Completion
// -------------------------------------------------------------
console.log('Test 3: Real Engine Approach, Progressive Tape Meshes, Anti-Exploit & Completion')
{
  const audioEvents = []
  const { engine, maze } = createHeadlessEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
    audioEvents,
  })
  const hazardCell = { row: 2, col: 4 }
  const hazard = engine.hazardManager.addHazard({
    id: 'steam-real-1',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: hazardCell.row,
    col: hazardCell.col,
    wallSide: 'north',
  })
  activateSteamHazard(hazard, hazardCell, maze)

  const anchor = hazard.getInteractionAnchor()
  // Stand in front of the broken pipe at 1.4m standoff (outside wall, closer to rupture than valve)
  const startStand = {
    x: anchor.x + hazard.ruptureDir.x * 1.45,
    y: 0,
    z: anchor.z + hazard.ruptureDir.z * 1.45,
  }
  engine.setPlayerWorldPosition(startStand.x, 0, startStand.z, { immediate: true })
  engine._notifyStealthChange(true)

  const promptBefore = engine.getNearbyInteractable()
  assert(
    promptBefore && promptBefore.id === hazard.id && promptBefore.label === 'Apply Repair Tape',
    `Prompt near rupture says "Apply Repair Tape", got ${promptBefore?.label}`
  )

  assert(typeof engine.interact === 'undefined', 'Legacy F-key engine.interact() method is removed')

  const interactStart = engine.handlePrimaryAction()
  assert(
    interactStart.handled === true && interactStart.isRepairing === true,
    'Left-click (handlePrimaryAction) near rupture initiates physical tape repair'
  )
  assert(audioEvents.length === 0, 'Completion audio does NOT fire prematurely on start')
  assert(engine.getNearbyInteractable() === null, 'Interact prompt hides while actively repairing')

  // Double-click Left-Click exploit check: clicking again mid-repair must NOT instantly complete or bypass!
  const doubleTapRes = engine.handlePrimaryAction()
  assert(doubleTapRes.handled === false, 'Second Left-Click during active repair cannot instant-seal')
  const rightClickRes = engine.handleSecondaryAction()
  assert(rightClickRes.handled === false, 'Right-click does not cancel or complete active steam repair')
  assert(hazard.getState() === HAZARD_STATES.ACTIVE, 'Hazard remains ACTIVE after extra clicks')

  // Advance into active wrapping (approx ~50% through)
  for (let i = 0; i < 11; i += 1) {
    engine.stepFrame(0.1, { render: false })
  }
  const midSnap = engine.steamRepairController.getInteractionSnapshot()
  assert(midSnap.isRepairing === true, 'Still repairing mid-animation')
  assert(midSnap.tapeProgress > 0.3 && midSnap.tapeProgress < 0.85, 'Tape progress partially applied')

  const pPosMid = engine.getPlayerWorldPosition()
  const midDist = Math.hypot(pPosMid.x - anchor.x, pPosMid.z - anchor.z)
  assert(
    Math.abs(midDist - STEAM_REPAIR_CONFIG.standoffDistance) < 0.18,
    `Player moved into reachable standoff distance (~0.68m), got ${midDist.toFixed(3)}m`
  )
  const colCheck = resolveGridCollision(pPosMid.x, pPosMid.z, maze, { radius: PLAYER_RADIUS })
  assert(!colCheck.collided, 'Player standoff position has zero wall clipping')

  const hData = hazard.getMesh().userData
  assert(hData.repairPatchGroup.visible === true, 'Repair group visible during wrapping')
  assert(
    hData.clampHardwareMeshes.every((m) => m.visible === false),
    'Steel valve clamp hardware stays hidden during tape repair'
  )
  const visibleBandsMid = hData.tapeWrapBandMeshes.filter((m) => m.visible).length
  assert(
    visibleBandsMid >= 1 && visibleBandsMid < hData.tapeWrapBandMeshes.length,
    `Tape bands appear progressively (mid visible=${visibleBandsMid}/${hData.tapeWrapBandMeshes.length})`
  )
  assert(
    hData.steamCloud.visible === true && hData.steamMat.opacity > 0.5,
    'Steam remains active until tape repair completes'
  )
  assert(engine.health < 100, 'Standing in active steam before repair finishes still deals hazard damage')

  // Complete remaining repair duration
  for (let i = 0; i < 16; i += 1) {
    engine.stepFrame(0.1, { render: false })
  }
  assert(
    engine.steamRepairController.getStateName() === STEAM_REPAIR_STATES.REPAIRED,
    'Controller completes to REPAIRED'
  )
  assert(hazard.getState() === HAZARD_STATES.DISABLED, 'Hazard disabled after physical repair completes')
  assert(hazard.isAftermathCleared === true, 'Hazard aftermath cleared')
  assert(hData.steamCloud.visible === false && hData.steamMat.opacity === 0, 'Steam stopped on completion')
  assert(
    hData.tapeWrapBandMeshes.every((m) => m.visible === true),
    'All tape bands visible and attached after completion'
  )
  assert(hData.repairCompletedByTape === true, 'Tape completion flag set')
  assert(Math.abs(hData.valveWheelMesh.rotation.z) < 1e-4, 'Handwheel stayed unrotated on tape repair')
  assert(audioEvents.length === 1 && audioEvents[0].action === 'seal_steam_pipe', 'Audio fired on completion')

  // Walk past repaired pipe -> zero further damage!
  engine.health = 100
  engine.damageImmunityTimer = 0
  const walkPast = gridToWorld(hazardCell.row, hazardCell.col, maze)
  engine.setPlayerWorldPosition(walkPast.x, 0, walkPast.z, { immediate: true })
  engine.stepFrame(0.4, { render: false })
  assert(engine.health === 100, 'Repaired steam pipe deals 0 damage afterward')

  // Test resetCombat restores clean DORMANT state and hides tape
  engine.resetCombat()
  assert(hazard.getState() === HAZARD_STATES.DORMANT, 'resetCombat restores DORMANT')
  assert(hazard.repairProgress === 0, 'resetCombat resets repairProgress to 0')
  assert(hData.repairPatchGroup.visible === false, 'resetCombat hides repairPatchGroup')
  assert(hData.repairCompletedByTape === false, 'resetCombat clears repairCompletedByTape')

  engine.dispose()
}
console.log('✓ Test 3 Passed: Real engine approach, anti-exploit, progressive tape, completion & resetCombat')

// -------------------------------------------------------------
// Test 4: WASD Interruption, Damage Interruption, Locomotion Recovery, Partial Progress Resume & Multi-Pipe
// -------------------------------------------------------------
console.log('Test 4: WASD & Damage Interruption, Partial Progress Resume & Multi-Pipe')
{
  const { engine, maze } = createHeadlessEngine()
  const cellA = { row: 2, col: 3 }
  const cellB = { row: 2, col: 5 }
  const hazA = engine.hazardManager.addHazard({
    id: 'steam-multi-a',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: cellA.row,
    col: cellA.col,
    wallSide: 'north',
  })
  const hazB = engine.hazardManager.addHazard({
    id: 'steam-multi-b',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: cellB.row,
    col: cellB.col,
    wallSide: 'north',
  })
  activateSteamHazard(hazA, cellA, maze)
  activateSteamHazard(hazB, cellB, maze)

  const anchorA = hazA.getInteractionAnchor()
  engine.setPlayerWorldPosition(anchorA.x, 0, anchorA.z + 0.9, { immediate: true })
  const resStartA = engine.handlePrimaryAction()
  assert(resStartA.handled && resStartA.isRepairing, 'Starts repairing pipe A via Left-Click')

  for (let i = 0; i < 10; i += 1) {
    engine.stepFrame(0.1, { render: false })
  }
  const partialProgress = hazA.repairProgress
  assert(partialProgress > 0.25 && partialProgress < 0.85, 'Partial tape progress recorded')

  // Interrupt via WASD stepMovement!
  const beforeMove = engine.getPlayerWorldPosition()
  const moveRes = engine.stepMovement({ forwardAxis: 0, strafeAxis: 1 }, 0.15)
  assert(moveRes.moved === true, 'Player moves immediately on WASD without lock')
  const afterMove = engine.getPlayerWorldPosition()
  assert(
    Math.hypot(afterMove.x - beforeMove.x, afterMove.z - beforeMove.z) > 0.05,
    'Player position translates freely after interruption'
  )
  assert(!engine.isRepairingSteamPipe(), 'Controller stops repairing on WASD')
  assert(hazA.getState() === HAZARD_STATES.ACTIVE, 'Pipe A stays ACTIVE after WASD interruption')
  assert(
    Math.abs(hazA.repairProgress - partialProgress) < 1e-4,
    'Partial tape progress preserved after interruption'
  )
  assert(
    hazA.getMesh().userData.repairPatchGroup.visible === true,
    'Partially applied tape stays visible on pipe after interruption'
  )

  // Resume pipe A and complete it
  engine.setPlayerWorldPosition(anchorA.x, 0, anchorA.z + 0.9, { immediate: true })
  const resumeRes = engine.handlePrimaryAction()
  assert(resumeRes.handled && resumeRes.isRepairing, 'Resumes pipe A repair via Left-Click')
  assert(
    engine.steamRepairController._resumeTapeBase >= partialProgress - 1e-4,
    'Resumes from preserved partial progress'
  )
  for (let i = 0; i < 20; i += 1) {
    engine.stepFrame(0.1, { render: false })
  }
  assert(hazA.getState() === HAZARD_STATES.DISABLED, 'Pipe A completes cleanly after resume')

  // Now test second steam pipe B + non-fatal damage interruption!
  engine.health = 100
  engine.damageImmunityTimer = 0
  const anchorB = hazB.getInteractionAnchor()
  engine.setPlayerWorldPosition(anchorB.x, 0, anchorB.z + 0.9, { immediate: true })
  const startB = engine.handlePrimaryAction()
  assert(startB.handled && startB.isRepairing, 'Multi-pipe: starts repairing second pipe B after REPAIRED state')
  for (let i = 0; i < 8; i += 1) {
    engine.stepFrame(0.1, { render: false })
  }
  engine.damageImmunityTimer = 0
  engine.applyDamage(15, { enemyId: 'phantom-test' })
  assert(!engine.isRepairingSteamPipe(), 'Damage interrupts active tape repair cleanly')
  assert(hazB.getState() === HAZARD_STATES.ACTIVE, 'Pipe B remains incomplete after attack interruption')
  assert(
    engine.stepMovement({ forwardAxis: 0, strafeAxis: -1 }, 0.1).moved === true,
    'Player is not movement-locked after damage interruption'
  )

  engine.dispose()
}
console.log('✓ Test 4 Passed: WASD & damage interruption, partial progress resume & multi-pipe verified')

// -------------------------------------------------------------
// Test 5: First-Person Arms Visibility, Free Look Orbit Preservation & Valve Shutoff Coexistence
// -------------------------------------------------------------
console.log('Test 5: 1P Arms Visibility, Free Look Camera Sync & Valve Coexistence')
{
  const { engine, maze } = createHeadlessEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
  })
  const cell = { row: 2, col: 4 }
  const haz = engine.hazardManager.addHazard({
    id: 'steam-fp-valve',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: cell.row,
    col: cell.col,
    wallSide: 'north',
  })
  activateSteamHazard(haz, cell, maze)

  const anchor = haz.getInteractionAnchor()
  engine.setPlayerWorldPosition(anchor.x, 0, anchor.z + 0.9, { immediate: true })
  assert(engine._playerGroup.visible === false, 'Player group hidden in 1P idle before repair')

  engine.handlePrimaryAction()
  assert(engine._playerGroup.visible === true, '1P interaction arms made visible when repair starts')
  const armMesh = engine._playerGroup.getObjectByName('maze-player-hand-right')
  const torsoMesh = engine._playerGroup.getObjectByName('maze-player-torso-jacket')
  assert(armMesh?.visible === true && torsoMesh?.visible === false, '1P shows arms only, hides torso')

  for (let i = 0; i < 25; i += 1) {
    engine.stepFrame(0.1, { render: false })
  }
  assert(engine._playerGroup.visible === false, '1P arms hide cleanly once repair completes')

  // Free Look camera preservation + Valve shutoff coexistence on reset
  engine.resetCombat()
  engine.cameraRig.setMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.cameraRig.setThirdPersonMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK, { immediate: true })
  engine.cameraRig.applyLookDelta(120, 0)
  const freeOrbitYawBefore = engine.cameraRig.getCameraLookDirection().yaw

  activateSteamHazard(haz, cell, maze)
  engine.setPlayerWorldPosition(anchor.x, 0, anchor.z + 0.9, { immediate: true })
  engine.handlePrimaryAction()
  engine.stepFrame(0.3, { render: false })
  assert(
    Math.abs(engine.cameraRig.getCameraLookDirection().yaw - freeOrbitYawBefore) < 1e-4,
    'Free Look camera orbit yaw remains independent while character turns toward pipe'
  )

  // Valve coexistence check
  engine.steamRepairController.interruptRepair()
  const safeValvePos = {
    x: haz.valveWorldPos.x - 1.0,
    y: 0,
    z: haz.valveWorldPos.z + 0.85,
  }
  engine.setPlayerWorldPosition(safeValvePos.x, 0, safeValvePos.z, { immediate: true })
  engine._notifyStealthChange(true)
  const valvePrompt = engine.getNearbyInteractable()
  assert(
    valvePrompt && valvePrompt.label === 'Seal Steam Pipe',
    `Upstream valve still shows "Seal Steam Pipe", got ${valvePrompt?.label}`
  )
  const valveRes = engine.handlePrimaryAction()
  assert(
    valveRes.handled && !valveRes.isRepairing && haz.getState() === HAZARD_STATES.DISABLED,
    'Valve approach uses existing shutoff interaction via Left-Click'
  )
  const vData = haz.getMesh().userData
  assert(
    Math.abs(vData.valveWheelMesh.rotation.z + Math.PI * 0.75) < 1e-4,
    'Valve shutoff rotates handwheel -0.75*PI'
  )
  assert(
    vData.clampHardwareMeshes.every((m) => m.visible === true),
    'Valve shutoff mounts steel bolted clamp hardware'
  )

  engine.dispose()
}
console.log('✓ Test 5 Passed: 1P arms visibility, Free Look yaw preservation & valve coexistence')

console.log('\n=============================================================')
console.log('ALL 5 COMPREHENSIVE MAZE-HAZARD-STEAM-ANIM-001 SUITES PASSED!')
console.log('=============================================================')
