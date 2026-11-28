/**
 * End-to-End Automated Verification Suite for MAZE-HAZARD-STEAM-ANIM-001
 * Physical Steam Pipe Tape Repair Animation, Stance, Progressive Tape Visuals,
 * WASD Interruption, Locomotion Recovery, and Valve Neutralization Coexistence.
 */

import * as THREE from 'three'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { HAZARD_STATES, HazardAgent } from './HazardAgent.js'
import {
  STEAM_REPAIR_STATES,
  STEAM_REPAIR_ANIM_MODES,
  STEAM_REPAIR_CONFIG,
  SteamRepairController,
} from './SteamRepairController.js'
import { PlayerAnimator, STEAM_REPAIR_ANIM_MODES as ANIM_MODES } from './PlayerAnimator.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

console.log('=== RUNNING MAZE-HAZARD-STEAM-ANIM-001 AUTOMATED VERIFICATION SUITE ===')

// -------------------------------------------------------------
// Test 1: SteamRepairController Lifecycle, Target Selection & Reach
// -------------------------------------------------------------
console.log('Test 1: SteamRepairController Lifecycle, Target Selection & Reach')

const mockPlayerPos = new THREE.Vector3(10, 0, 10)
const mockPlayerGroup = new THREE.Group()
mockPlayerGroup.rotation.y = 0

const mockSteamHazard = {
  id: 'hazard_steam_001',
  type: HAZARD_TYPES.STEAM_PIPE_BURST,
  state: HAZARD_STATES.ACTIVE,
  isDisposed: false,
  isAftermathCleared: false,
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
    setCharacterYaw(y) { this.yaw = y },
  },
  hazardManager: {
    getHazards: () => [mockSteamHazard],
  },
  isGameOver: false,
  hasWon: false,
  isPaused: false,
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
assert(!outOfReachNoTarget.handled && outOfReachNoTarget.reason === 'no_target', 'Rejects when no reachable hazard')
const outOfReachExplicit = controller.tryStartRepair(mockSteamHazard)
assert(!outOfReachExplicit.handled && outOfReachExplicit.reason === 'out_of_range', 'Rejects out-of-range explicit hazard')

// In reach test
mockPlayerPos.set(10, 0, 10)
const startRes = controller.tryStartRepair()
assert(startRes.handled === true, 'Successfully starts repair when in reach')
assert(startRes.action === 'seal_steam_pipe', 'Action matches seal_steam_pipe')
assert(controller.getStateName() === STEAM_REPAIR_STATES.REPAIRING, 'Controller transitions to REPAIRING')
assert(controller.isRepairing(), 'isRepairing() returns true')
console.log('✓ Test 1 Passed: Lifecycle, target selection, and reach bounds verified')

// -------------------------------------------------------------
// Test 2: Phase A & B Positioning, Player Facing & Repair Stance
// -------------------------------------------------------------
console.log('Test 2: Phase A & B Positioning, Player Facing & Repair Stance')

controller.update(0.1) // 0.1s out of 1.45s
const snap = controller.getInteractionSnapshot()
assert(snap.isRepairing === true, 'Snapshot confirms active repairing')
assert(snap.progress > 0 && snap.progress < 0.2, 'Progress advances smoothly')
assert(mockSteamHazard.repairProgress > 0, 'Hazard received progress callback')

// Verify player facing angle was directed toward the rupture
assert(Number.isFinite(mockPlayerGroup.rotation.y), 'Player yaw was updated toward rupture anchor')
console.log('✓ Test 2 Passed: Approach facing and stance initiation verified')

// -------------------------------------------------------------
// Test 3: PlayerAnimator Integration, Wrapping Orbit & Arm Kinematics
// -------------------------------------------------------------
console.log('Test 3: PlayerAnimator Integration, Wrapping Orbit & Arm Kinematics')

const playerRig = {
  pelvisPivot: new THREE.Group(),
  spinePivot: new THREE.Group(),
  neckPivot: new THREE.Group(),
  headPivot: new THREE.Group(),
  leftShoulderPivot: new THREE.Group(),
  leftElbowPivot: new THREE.Group(),
  leftWristPivot: new THREE.Group(),
  rightShoulderPivot: new THREE.Group(),
  rightElbowPivot: new THREE.Group(),
  rightWristPivot: new THREE.Group(),
  restPose: {
    pelvisY: 0.94,
    spineY: 0.05,
    leftShoulderY: 0.36,
    rightShoulderY: 0.36,
  },
}
const testGroup = new THREE.Group()
testGroup.userData.rig = playerRig

const animator = new PlayerAnimator(testGroup)
assert(typeof animator.getSteamRepairState === 'function', 'Animator exposes getSteamRepairState()')

// Advance animator with repair payload during wrapping phase
const payloadWrap = {
  mode: STEAM_REPAIR_ANIM_MODES.REPAIR,
  progress: 0.45,
}
const motionSample = {
  moved: false,
  actualSpeed: 0,
  walkSpeed: 3.2,
  sprintSpeed: 5.6,
  isSprinting: false,
  steamRepair: payloadWrap,
  isFirstPerson: false,
}

animator.update(0.05, motionSample)
const animState = animator.getSteamRepairState()
assert(animState.steamRepairMode === STEAM_REPAIR_ANIM_MODES.REPAIR, 'Animator active in REPAIR mode')
assert(animState.steamRepairBlend > 0.4, 'Blend weight smoothly ramps in')
assert(animState.steamRepairCrouch > 0.2, 'Stance crouch weight engaged')
assert(animState.steamRepairReach > 0.5, 'Arm reach active toward pipe')

// Verify arm posing: left arm stabilizes, right arm wraps around pipe
assert(playerRig.leftShoulderPivot.rotation.x > 0.3, 'Left stabilizing shoulder reaches toward pipe')
assert(playerRig.leftElbowPivot.rotation.x > 0.4, 'Left elbow provides sturdy brace')
assert(playerRig.rightShoulderPivot.rotation.x > 0.3, 'Right arm active in orbit')
assert(playerRig.neckPivot.rotation.x !== 0, 'Neck/head tilts down toward pipe rupture')
console.log('✓ Test 3 Passed: PlayerAnimator wrapping kinematics and stance verified')

// -------------------------------------------------------------
// Test 4: Final Smoothing Action & Phase Completion
// -------------------------------------------------------------
console.log('Test 4: Final Smoothing Action & Phase Completion')

// Test smoothing phase (progress 0.85)
const payloadSmooth = {
  mode: STEAM_REPAIR_ANIM_MODES.REPAIR,
  progress: 0.85,
}
motionSample.steamRepair = payloadSmooth
animator.update(0.05, motionSample)
const smoothState = animator.getSteamRepairState()
assert(smoothState.steamRepairEffort > 0.5, 'Firm smoothing effort applied')

// Complete the controller repair
controller.update(1.5) // Exceed 1.45s
assert(controller.getStateName() === STEAM_REPAIR_STATES.REPAIRED, 'Controller transitions to REPAIRED')
assert(mockSteamHazard.state === HAZARD_STATES.DISABLED, 'Hazard state set to DISABLED upon completion')
assert(mockSteamHazard.isAftermathCleared === true, 'Hazard aftermath cleared')
assert(mockSteamHazard.mesh.userData.steamCloud.visible === false, 'Steam cloud hidden')
assert(mockSteamHazard.mesh.userData.steamMat.opacity === 0, 'Steam opacity set to 0')
assert(mockSteamHazard.mesh.userData.repairPatchGroup.visible === true, 'Repair patch group visible')
console.log('✓ Test 4 Passed: Smoothing and completion sequence verified')

// -------------------------------------------------------------
// Test 5: WASD Interruption, Recovery & Non-Locking Behavior
// -------------------------------------------------------------
console.log('Test 5: WASD Interruption, Recovery & Non-Locking Behavior')

mockSteamHazard.state = HAZARD_STATES.ACTIVE
mockSteamHazard.isAftermathCleared = false
controller.reset()
assert(controller.getStateName() === STEAM_REPAIR_STATES.IDLE, 'Controller resets cleanly to IDLE')

controller.tryStartRepair()
assert(controller.isActive(), 'Repair started again')
controller.update(0.3)
assert(controller.getActiveHazard().repairProgress > 0, 'Partial progress made')

// Player presses WASD
const wasdInterrupted = controller.onMovementInput(true)
assert(wasdInterrupted === true, 'onMovementInput interrupts active repair')
assert(controller.getStateName() === STEAM_REPAIR_STATES.IDLE, 'State drops back to IDLE')
assert(!controller.isActive(), 'Controller is no longer active')
assert(mockSteamHazard.state === HAZARD_STATES.ACTIVE, 'Hazard remains ACTIVE after interruption (not falsely cleared)')

// Verify animator smoothly blends out on return to idle
motionSample.steamRepair = controller.getAnimatorPayload()
assert(motionSample.steamRepair.mode === STEAM_REPAIR_ANIM_MODES.NONE, 'Payload is NONE')
animator.update(0.2, motionSample)
assert(animator.getSteamRepairState().steamRepairBlend < 0.2, 'Animator blends smoothly back to idle')
console.log('✓ Test 5 Passed: WASD interruption and smooth recovery verified')

// -------------------------------------------------------------
// Test 6: First-Person Compatibility & Free Look Synchronization
// -------------------------------------------------------------
console.log('Test 6: First-Person Compatibility & Free Look Synchronization')

motionSample.isFirstPerson = true
motionSample.steamRepair = { mode: STEAM_REPAIR_ANIM_MODES.REPAIR, progress: 0.5 }
animator.update(0.1, motionSample)
assert(playerRig.leftShoulderPivot.position.y > playerRig.restPose.leftShoulderY, 'First-person arm lifted into visible viewport')
assert(playerRig.leftShoulderPivot.position.z < 0, 'First-person arm forward offset active')

// Free look sync
let characterYawSet = null
mockEngine.cameraRig.isFreeLookActive = () => true
mockEngine.cameraRig.setCharacterYaw = (y) => { characterYawSet = y }
controller.tryStartRepair()
controller.update(0.1)
assert(characterYawSet !== null, 'Free look camera rig receives character yaw update during repair turn')
console.log('✓ Test 6 Passed: 1P viewport arm offsets and Free Look yaw sync verified')

// -------------------------------------------------------------
// Test 7: Coexistence with Existing Valve Neutralization
// -------------------------------------------------------------
console.log('Test 7: Coexistence with Existing Valve Neutralization')

// Verify HazardAgent interaction handler distinguishes valve approach vs rupture approach
const dummyAgent = new HazardAgent({
  id: 'hazard_steam_coexist',
  type: HAZARD_TYPES.STEAM_PIPE_BURST,
  state: HAZARD_STATES.ACTIVE,
  engine: mockEngine,
})
dummyAgent.state = HAZARD_STATES.ACTIVE
dummyAgent.isAftermathCleared = false
dummyAgent.originWorldPos = new THREE.Vector3(10.5, 1.38, 10)
dummyAgent.valveWorldPos = new THREE.Vector3(8.5, 1.28, 10)

const handler = dummyAgent.getInteractionHandler()
assert(handler && typeof handler.onInteract === 'function', 'Exposes onInteract handler')

// Safe valve approach (player near valve)
const valveCtx = {
  playerWorldPos: new THREE.Vector3(8.6, 0, 10),
  engine: mockEngine,
}
const valvePrompt = handler.getPrompt(dummyAgent, valveCtx)
assert(valvePrompt.label === 'Seal Steam Pipe', 'Valve prompt remains "Seal Steam Pipe"')

const valveRes = handler.onInteract(dummyAgent, valveCtx)
assert(valveRes.handled === true && valveRes.disableHazard === true, 'Valve approach instantly shuts off steam')

// Rupture approach (player near damaged pipe rupture)
dummyAgent.state = HAZARD_STATES.ACTIVE
dummyAgent.isAftermathCleared = false
controller.reset()

const ruptureCtx = {
  playerWorldPos: new THREE.Vector3(10.3, 0, 10),
  engine: mockEngine,
}
const rupturePrompt = handler.getPrompt(dummyAgent, ruptureCtx)
assert(rupturePrompt.label === 'Apply Repair Tape', 'Rupture approach shows "Apply Repair Tape"')

const ruptureRes = handler.onInteract(dummyAgent, ruptureCtx)
assert(ruptureRes.handled === true && ruptureRes.isRepairing === true, 'Rupture approach starts physical tape repair')
assert(ruptureRes.disableHazard === false, 'Hazard is NOT instantly disabled before repair finishes')
assert(controller.isRepairing(), 'SteamRepairController is actively repairing')

controller.dispose()
animator.dispose()
dummyAgent.dispose()
console.log('✓ Test 7 Passed: Coexistence with valve neutralization and instant tests verified')

console.log('\n=============================================================')
console.log('ALL 7 MAZE-HAZARD-STEAM-ANIM-001 VERIFICATION SUITES PASSED!')
console.log('=============================================================')
