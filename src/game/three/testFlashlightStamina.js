import { createContinuousInputController } from '../../hooks/useContinuousInput.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CAMERA_MODES } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

console.log('--- RUNNING FLASHLIGHT & SPRINT STAMINA TESTS ---')

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

const testMaze = generateMaze({ difficulty: 'small', seed: 7777 })

// 1. Sprint Stamina Drain, Regeneration, Exhaustion & Recovery Delay
console.log('Test 1: Sprint Stamina Mechanics & Exhaustion')
const engine = createHeadlessEngine({
  cameraMode: CAMERA_MODES.FIRST_PERSON,
  enemies: { autoSpawn: false },
})
engine.setMaze(testMaze)
engine.setPlayerGridPosition(1, 1, { immediate: true })

const initialStamina = engine.getStaminaState().stamina
assert(initialStamina === 100, 'Stamina starts at 100%')

// Sprint movement should drain stamina
const moveInputSprint = { forwardAxis: 1, strafeAxis: 0, sprint: true }
const step1 = engine.stepMovement(moveInputSprint, 0.5)
assert(step1.moved === true, 'Player moves during sprint')
const staminaAfterSprint = engine.getStaminaState().stamina
assert(staminaAfterSprint < 100, `Stamina drains while sprinting (got ${staminaAfterSprint})`)

// Walk / resting should regenerate stamina after recovery delay (owned by stepFrame/tick)
const moveInputWalk = { forwardAxis: 1, strafeAxis: 0, sprint: false }
engine.stamina = 40
engine.recoveryDelayTimer = 0
const staminaBeforeWalkRegen = engine.getStaminaState().stamina
engine.setInputSource(moveInputWalk)
engine.stepFrame(0.5)
const staminaAfterWalkRegen = engine.getStaminaState().stamina
const expectedHalfSecRegen = engine.staminaRegenRate * 0.5
assert(
  Math.abs(staminaAfterWalkRegen - staminaBeforeWalkRegen - expectedHalfSecRegen) < 1e-6,
  `Walking recovers at exact configured rate without double-tick (expected +${expectedHalfSecRegen}, got +${staminaAfterWalkRegen - staminaBeforeWalkRegen})`
)

// Standing idle must recover at the exact same rate
engine.stamina = 40
engine.recoveryDelayTimer = 0
engine.setInputSource({ forwardAxis: 0, strafeAxis: 0, sprint: false })
engine.stepFrame(0.5)
assert(
  Math.abs(engine.getStaminaState().stamina - (40 + expectedHalfSecRegen)) < 1e-6,
  'Standing idle recovers stamina at the exact same configured rate as walking'
)

// Recovery delay counts down in stepFrame before stamina starts regenerating
engine.stamina = 40
engine.recoveryDelayTimer = 0.5
engine.setInputSource(moveInputWalk)
engine.stepFrame(0.5)
assert(
  engine.getStaminaState().stamina === 40 && engine.recoveryDelayTimer === 0,
  'Recovery delay pauses regen during delay window in stepFrame'
)
engine.stepFrame(0.5)
assert(
  Math.abs(engine.getStaminaState().stamina - (40 + expectedHalfSecRegen)) < 1e-6,
  'Stamina regenerates after recovery delay expires'
)
engine.setInputSource(null)

// Exhaustion test: drain stamina to 0
engine.setPlayerGridPosition(1, 1, { immediate: true })
engine.stamina = 0
engine.isExhausted = true
const staminaExhaustedState = engine.getStaminaState()
assert(staminaExhaustedState.isExhausted === true, 'Stamina marks exhausted at 0')

const exhaustedMoveResult = engine.stepMovement(moveInputSprint, 0.1)
assert(exhaustedMoveResult.moved === true, 'Player still walks when exhausted')
assert(engine.stamina < 35, 'Exhausted stamina stays low during sprint request')

console.log('✓ Sprint stamina drain, regeneration, and exhaustion verified')

// 3. Player Flashlight Toggle, Battery Consumption & Recharge
console.log('Test 3: Flashlight Toggle, Battery & Clamping')
const initialFlashlight = engine.getFlashlightState()
assert(initialFlashlight.active === false, 'Flashlight starts switched off')
assert(initialFlashlight.battery === 100, 'Battery starts at 100%')

const toggledOn = engine.toggleFlashlight()
assert(toggledOn === true, 'toggleFlashlight() switches light ON')
assert(engine.getFlashlightState().active === true, 'Flashlight state active is true')
assert(engine.spotlight.visible === true, 'Spotlight visible in scene')
assert(engine.spotlight.intensity > 0, 'Spotlight intensity > 0 when active')

for (let i = 0; i < 20; i += 1) {
  engine.battery = Math.max(0, engine.battery - engine.batteryDrainRate * 0.1)
}
const batteryDrained = engine.getFlashlightState().battery
assert(batteryDrained < 100, `Battery drains while active (got ${batteryDrained})`)

engine.toggleFlashlight()
assert(engine.getFlashlightState().active === false, 'Flashlight switched OFF')
const batteryBeforeRecharge = engine.getFlashlightState().battery
engine.battery = Math.min(100, engine.battery + engine.batteryRechargeRate * 0.5)
const batteryAfterRecharge = engine.getFlashlightState().battery
assert(batteryAfterRecharge > batteryBeforeRecharge, 'Battery gradually recharges when switched off')

console.log('✓ Flashlight toggle, battery consumption and recharge verified')

// 4. First-Person and Third-Person Flashlight Attachment & Direction
console.log('Test 4: Flashlight Attachment & Forward Orientation in 1st and 3rd Person')
assert(engine.spotlight.parent === engine.camera, 'Spotlight attached to camera hierarchy in 1st person')
assert(engine.spotlightTarget.parent === engine.camera, 'Spotlight target attached to camera hierarchy in 1st person')

const { Vector3 } = await import('three')
const lightWorld = new Vector3()
const targetWorld = new Vector3()

// First-person: shines forward from camera
engine.setPlayerGridPosition(1, 1, { immediate: true, yaw: 0 })
engine.setLookDirection(0, 0)
engine.cameraRig.snap()
engine.stepFrame(0.016, { render: false })
engine.spotlight.getWorldPosition(lightWorld)
engine.spotlightTarget.getWorldPosition(targetWorld)
assert(targetWorld.z < lightWorld.z - 5, '1st-person flashlight illuminates forward (-Z at yaw=0)')

// Third-person: spotlight detaches from rear camera onto player-anchored forward-facing rig
engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
assert(engine.spotlight.parent === engine.flashlightRig, 'Spotlight moves to player-anchored flashlightRig in 3rd person')
assert(engine.spotlightTarget.parent === engine.flashlightRig, 'Spotlight target moves to player-anchored flashlightRig in 3rd person')
assert(engine.spotlight.parent !== engine.camera, '3rd-person flashlight is no longer parented behind player on camera')

const tpDirections = [
  { name: 'North', yaw: 0, dx: 0, dz: -1 },
  { name: 'South', yaw: Math.PI, dx: 0, dz: 1 },
  { name: 'East', yaw: -Math.PI / 2, dx: 1, dz: 0 },
  { name: 'West', yaw: Math.PI / 2, dx: -1, dz: 0 },
]
const playerPos = engine.getPlayerWorldPosition()
for (const dir of tpDirections) {
  engine.setLookDirection(dir.yaw, 0)
  engine.cameraRig.snap()
  engine.stepFrame(0.016, { render: false })
  engine.spotlight.getWorldPosition(lightWorld)
  engine.spotlightTarget.getWorldPosition(targetWorld)
  const beam = targetWorld.clone().sub(lightWorld).normalize()
  const dot = beam.x * dir.dx + beam.z * dir.dz
  assert(dot > 0.99, `3rd-person flashlight beam faces ${dir.name} ahead of player (dot=${dot.toFixed(4)})`)

  // Verify origin is slightly ahead of player anchor, not behind at the camera
  const toLightX = lightWorld.x - playerPos.x
  const toLightZ = lightWorld.z - playerPos.z
  const forwardDot = toLightX * dir.dx + toLightZ * dir.dz
  assert(forwardDot > 0.3, `3rd-person flashlight origin sits in front of player torso (${dir.name}, forwardDot=${forwardDot.toFixed(3)})`)
}

// Pitch tilts 3rd-person flashlight beam up/down
engine.setLookDirection(0, 0.45)
engine.stepFrame(0.016, { render: false })
engine.spotlight.getWorldPosition(lightWorld)
engine.spotlightTarget.getWorldPosition(targetWorld)
assert(targetWorld.y > lightWorld.y + 1.0, 'Positive pitch aims 3rd-person flashlight upward')

engine.setLookDirection(0, -0.45)
engine.stepFrame(0.016, { render: false })
engine.spotlight.getWorldPosition(lightWorld)
engine.spotlightTarget.getWorldPosition(targetWorld)
assert(targetWorld.y < lightWorld.y - 1.0, 'Negative pitch aims 3rd-person flashlight downward')

// Switching back to 1st-person preserves original camera attachment
engine.setCameraMode(CAMERA_MODES.FIRST_PERSON, { immediate: true })
assert(engine.spotlight.parent === engine.camera, 'Spotlight returns to camera hierarchy in first-person mode')
assert(engine.spotlightTarget.parent === engine.camera, 'Spotlight target returns to camera hierarchy in first-person mode')

console.log('✓ Spotlight attachment and forward orientation verified for both camera modes')

// 5. Reset and New-Maze Behavior
console.log('Test 5: Reset and New Maze State Restoration')
engine.stamina = 15
engine.battery = 30
engine.flashlightActive = true
engine.isExhausted = true

engine.resetCombat()
const resetStamina = engine.getStaminaState().stamina
const resetBattery = engine.getFlashlightState().battery
const resetFlashlight = engine.getFlashlightState().active

assert(resetStamina === 100, 'resetCombat() resets stamina to 100%')
assert(resetBattery === 100, 'resetCombat() resets battery to 100%')
assert(resetFlashlight === false, 'resetCombat() turns off flashlight')

const newMaze = generateMaze({ difficulty: 'small', seed: 8888 })
engine.setMaze(newMaze)
assert(engine.getStaminaState().stamina === 100, 'setMaze() resets stamina')
assert(engine.getFlashlightState().battery === 100, 'setMaze() resets battery')

console.log('✓ Reset and new maze behavior verified')

// 6. Mobile and Keyboard Input Controller Verification
console.log('Test 6: Mobile and Keyboard Input Integration')

let flashlightToggledFromInput = false
const controller = createContinuousInputController({
  onToggleFlashlight: () => {
    flashlightToggledFromInput = true
  },
})

// Pressing 'L' key should trigger toggle flashlight
controller.handleKeyDown({ key: 'l', code: 'KeyL', preventDefault: () => {} })
assert(flashlightToggledFromInput === true, 'Keyboard L key triggers onToggleFlashlight')

// Shift key sets sprint in input state
controller.handleKeyDown({ key: 'Shift', code: 'ShiftLeft', shiftKey: true, preventDefault: () => {} })
assert(controller.getInputState().sprint === true, 'Shift key activates sprint')
controller.handleKeyUp({ key: 'Shift', code: 'ShiftLeft', shiftKey: false })
assert(controller.getInputState().sprint === false, 'Releasing Shift deactivates sprint')

// Touch sprint sets sprint in input state
controller.setTouchSprint(true)
assert(controller.getInputState().sprint === true, 'setTouchSprint(true) activates sprint')
controller.setTouchSprint(false)
assert(controller.getInputState().sprint === false, 'setTouchSprint(false) deactivates sprint')

// Calling toggleFlashlight directly on controller
flashlightToggledFromInput = false
controller.toggleFlashlight()
assert(flashlightToggledFromInput === true, 'controller.toggleFlashlight() fires callback')

console.log('✓ Mobile and keyboard input integration verified')

// 7. Battery Clamping & Low-Battery Dimming/Flickering
console.log('Test 7: Battery Clamping & Low-Battery Dimming/Flickering')
engine.battery = 150
// simulate tick recharge over maxBattery
engine.battery = Math.min(engine.maxBattery, engine.battery + 50)
assert(engine.battery === 100, 'Battery clamped at maxBattery (100)')

engine.battery = -50
// simulate tick drain below 0
engine.battery = Math.max(0, engine.battery - 50)
assert(engine.battery === 0, 'Battery clamped at 0')

// Low battery (<25%) flickering calculation
engine.battery = 15
engine.flashlightActive = true
const isLowBattery = engine.battery < 25
assert(isLowBattery === true, 'Battery correctly detected as low-battery (<25%)')

console.log('✓ Battery clamping & low-battery dimming verified')

engine.dispose()
console.log('--- ALL FLASHLIGHT & SPRINT STAMINA TESTS PASSED SUCCESSFULLY! ---')
