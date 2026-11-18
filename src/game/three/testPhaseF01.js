import { handleModalEscapeKey } from '../../components/common/modalEscape.js'
import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { POWERUP_TYPES } from '../mechanics/powerups.js'
import { calculateRunScore, resolveVictorySummary } from '../mechanics/scoring.js'
import { createContinuousInputController } from '../../hooks/useContinuousInput.js'
import { createKeyboardControlsHandler } from '../../hooks/useKeyboardControls.js'
import { CAMERA_MODES } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
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

console.log('--- RUNNING PHASE F PROMPT 01 VERIFICATION TESTS ---')

// 1. True Simulation Pause & Timestamp Reset
console.log('Test 1: True Simulation Pause & Resume Timestamp Reset')
const maze = generateMaze({ difficulty: 'small', seed: 9191 })
const engine = createHeadlessEngine({
  cameraMode: CAMERA_MODES.FIRST_PERSON,
  enemies: { autoSpawn: true },
})
engine.setMaze(maze)
engine.setPlayerGridPosition(maze.start.row, maze.start.col, { immediate: true })

engine.stamina = 60
engine.recoveryDelayTimer = 0
engine.battery = 80
engine.flashlightActive = true
const horrorDirector = engine.getHorrorDirector()
horrorDirector.nextEventCountdown = 1.0

const initialPos = engine.getPlayerWorldPosition()
const initialEnemies = engine
  .getEnemies()
  .map((enemy) => ({
    id: enemy.id,
    x: enemy.mesh?.position?.x ?? 0,
    z: enemy.mesh?.position?.z ?? 0,
    patrolProgress: enemy.patrolProgress,
  }))
const initialHazards = engine
  .getHazardManager()
  .getHazards()
  .map((hazard) => ({
    id: hazard.id,
    state: hazard.state,
    timer: hazard.timer,
  }))
const initialHorrorState = engine.getHorrorState()

engine.setInputSource({ forwardAxis: 1, strafeAxis: 0, sprint: true })
engine.setPaused(true)
assert(engine.getPaused() === true, 'Engine reports paused after setPaused(true)')
assert(horrorDirector.isPaused === true, 'HorrorDirector paused alongside engine')
assert(engine.audioEngine.isPaused === true, 'AudioEngine paused alongside engine')

const frameRanWhilePaused = engine.stepFrame(0.5)
const moveWhilePaused = engine.stepMovement(
  { forwardAxis: 1, strafeAxis: 0, sprint: true },
  0.5
)
assert(frameRanWhilePaused === false, 'stepFrame returns false and freezes simulation while paused')
assert(moveWhilePaused.moved === false, 'stepMovement freezes player while paused')
assert(
  engine.getPlayerWorldPosition().x === initialPos.x &&
    engine.getPlayerWorldPosition().z === initialPos.z,
  'Player position remains frozen during pause'
)
assert(engine.getStaminaState().stamina === 60, 'Stamina does not drain or recover while paused')
assert(engine.getFlashlightState().battery === 80, 'Flashlight battery does not drain while paused')

// Battery recharge must also freeze while paused
engine.flashlightActive = false
engine.stepFrame(0.5)
assert(engine.getFlashlightState().battery === 80, 'Flashlight battery does not recharge while paused')

for (const snap of initialEnemies) {
  const enemy = engine.getEnemies().find((item) => item.id === snap.id)
  assert(
    enemy.mesh.position.x === snap.x &&
      enemy.mesh.position.z === snap.z &&
      enemy.patrolProgress === snap.patrolProgress,
    `Enemy ${snap.id} remains frozen while paused`
  )
}
for (const snap of initialHazards) {
  const hazard = engine.getHazardManager().hazards.get(snap.id)
  assert(
    hazard.state === snap.state && hazard.timer === snap.timer,
    `Hazard ${snap.id} remains frozen while paused`
  )
}
assert(
  engine.getHorrorState().nextEventCountdown === initialHorrorState.nextEventCountdown,
  'HorrorDirector countdown remains frozen while paused'
)

// Resume resets _lastTimestamp so no delta spike occurs
engine._lastTimestamp = 0
engine.setPaused(false)
assert(engine.getPaused() === false, 'Engine resumes cleanly on setPaused(false)')
assert(engine._lastTimestamp > 0, '_lastTimestamp reset on resume to prevent delta spikes')

// Held continuous inputs clear cleanly on reset / tab hide
const inputController = createContinuousInputController({})
inputController.handleKeyDown({ key: 'w', code: 'KeyW', preventDefault: () => {} })
inputController.handleKeyDown({ key: 'Shift', code: 'ShiftLeft', shiftKey: true, preventDefault: () => {} })
assert(inputController.getInputState().forwardAxis === 1 && inputController.getInputState().sprint === true, 'Continuous inputs active before pause reset')
inputController.reset()
assert(
  inputController.getInputState().forwardAxis === 0 &&
    inputController.getInputState().strafeAxis === 0 &&
    inputController.getInputState().sprint === false,
  'Continuous inputs cleared on pause/hide reset'
)

engine.dispose()
console.log('✓ True simulation pause, timestamp reset, and input clear verified')

// 2. Modal Escape Safety
console.log('Test 2: Modal Escape Safety')
let standardClosed = false
const escapedStandard = handleModalEscapeKey(
  { key: 'Escape' },
  {
    closeOnEscape: true,
    onClose: () => {
      standardClosed = true
    },
  }
)
assert(escapedStandard === true && standardClosed === true, 'Standard modal (Records / Maze Info) closes on Escape')

let endModalClosed = false
const escapedEndModal = handleModalEscapeKey(
  { key: 'Escape' },
  {
    closeOnEscape: false,
    onClose: () => {
      endModalClosed = true
    },
  }
)
assert(
  escapedEndModal === false && endModalClosed === false,
  'Victory / Game Over modal with closeOnEscape=false ignores Escape key'
)

let nonEscapeClosed = false
handleModalEscapeKey(
  { key: 'Enter' },
  {
    closeOnEscape: true,
    onClose: () => {
      nonEscapeClosed = true
    },
  }
)
assert(nonEscapeClosed === false, 'Non-Escape keys do not close modal')
console.log('✓ Modal Escape safety verified')

// 3. 2D Ability Shortcuts & Unavailable Ability Safety
console.log('Test 3: 2D Ability Shortcuts & Unavailable Ability Safety')
const moves = []
const abilities = []
let preventCount = 0
let enabled = true

const keyHandler = createKeyboardControlsHandler({
  getEnabled: () => enabled,
  onMove: (dir) => moves.push(dir),
  onActivateAbility: (type) => abilities.push(type),
})

const mkEvent = (key, code, extra = {}) => ({
  key,
  code,
  defaultPrevented: false,
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: { tagName: 'DIV', isContentEditable: false },
  preventDefault: () => {
    preventCount += 1
  },
  ...extra,
})

assert(keyHandler(mkEvent(' ', 'Space')) === true, 'Space activates Wall Pass shortcut')
assert(keyHandler(mkEvent('e', 'KeyE')) === true, 'E activates Echo Reveal shortcut')
assert(keyHandler(mkEvent('Q', 'KeyQ')) === true, 'Q activates Coin Magnet shortcut')
assert(
  abilities[0] === POWERUP_TYPES.WALL_PASS &&
    abilities[1] === POWERUP_TYPES.ECHO_REVEAL &&
    abilities[2] === POWERUP_TYPES.COIN_MAGNET,
  'Shortcuts map cleanly to WALL_PASS, ECHO_REVEAL, and COIN_MAGNET'
)
assert(preventCount === 3, 'preventDefault called on ability shortcuts')

assert(keyHandler(mkEvent('w', 'KeyW')) === true && moves[0] === 'up', 'W movement preserved')
assert(keyHandler(mkEvent('ArrowRight', 'ArrowRight')) === true && moves[1] === 'right', 'Arrow movement preserved')

// Repeat & modifier & editable target & disabled safety
assert(keyHandler(mkEvent('e', 'KeyE', { repeat: true })) === false, 'Key-repeat ignored for abilities')
assert(keyHandler(mkEvent('q', 'KeyQ', { ctrlKey: true })) === false, 'Modifier shortcut ignored')
assert(
  keyHandler(mkEvent(' ', 'Space', { target: { tagName: 'INPUT', isContentEditable: false } })) === false,
  'Editable target ignores shortcut'
)
enabled = false
assert(keyHandler(mkEvent('e', 'KeyE')) === false, 'Disabled state ignores shortcuts')

// gameReducer ignores ACTIVATE_ABILITY safely when unavailable or already active
const baseState = createInitialGameState('small', 3232)
const noWallPassState = gameReducer(baseState, {
  type: 'ACTIVATE_ABILITY',
  abilityType: POWERUP_TYPES.WALL_PASS,
})
assert(noWallPassState === baseState, 'Unavailable Wall Pass shortcut is safely ignored by gameReducer')

const noEchoState = gameReducer(baseState, {
  type: 'ACTIVATE_ABILITY',
  abilityType: POWERUP_TYPES.ECHO_REVEAL,
})
assert(noEchoState === baseState, 'Unavailable Echo Reveal shortcut is safely ignored by gameReducer')

const noMagnetState = gameReducer(baseState, {
  type: 'ACTIVATE_ABILITY',
  abilityType: POWERUP_TYPES.COIN_MAGNET,
})
assert(noMagnetState === baseState, 'Unavailable Coin Magnet shortcut is safely ignored by gameReducer')

// When available in inventory, ACTIVATE_ABILITY activates cleanly and ignores re-trigger while active
const withInventory = {
  ...baseState,
  inventory: {
    ...baseState.inventory,
    [POWERUP_TYPES.ECHO_REVEAL]: 1,
  },
}
const echoActivated = gameReducer(withInventory, {
  type: 'ACTIVATE_ABILITY',
  abilityType: POWERUP_TYPES.ECHO_REVEAL,
})
assert(echoActivated.activeEffects.echoRevealRemainingMs > 0, 'Echo Reveal activates via ACTIVATE_ABILITY')
const echoDuplicate = gameReducer(echoActivated, {
  type: 'ACTIVATE_ABILITY',
  abilityType: POWERUP_TYPES.ECHO_REVEAL,
})
assert(echoDuplicate === echoActivated, 'Duplicate Echo Reveal safely ignored while active')
console.log('✓ 2D ability keyboard shortcuts verified')

// 4. Victory Timer Initialization
console.log('Test 4: Victory Timer Initialization & runId Guard')
assert(
  resolveVictorySummary(null, 5, true) === null,
  'Null victorySummary does not fall back to temporary 00:00.0 completionTimeMs'
)
const sampleScore = calculateRunScore({
  difficulty: 'small',
  completionTimeMs: 18450,
  parMoves: 18,
  coinsCollected: 4,
  totalCoins: 5,
  health: 100,
  maxHealth: 100,
})
const validSummary = {
  ...sampleScore,
  runId: 5,
}
assert(
  resolveVictorySummary(validSummary, 5, true) === validSummary,
  'Matching runId with finite completionTimeMs resolves victorySummary'
)
assert(
  resolveVictorySummary({ ...sampleScore, runId: 4 }, 5, true) === null,
  'Mismatched runId rejected even when hasWon is true'
)
assert(
  resolveVictorySummary({ ...sampleScore, runId: 5, completionTimeMs: NaN }, 5, true) === null,
  'Non-finite completionTimeMs rejected'
)
assert(
  resolveVictorySummary(validSummary, 5, false) === null,
  'Victory summary hidden when hasWon is false'
)
console.log('✓ Victory timer initialization verified')

console.log('--- ALL PHASE F PROMPT 01 VERIFICATION TESTS PASSED SUCCESSFULLY! ---')
