import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { placeHazards } from '../generation/hazardPlacement.js'
import { placeHidingSpots } from '../generation/hidingSpotPlacement.js'
import { placeKeycards } from '../generation/keycardPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { exploreReachableCells } from '../generation/pathfinder.js'
import {
  buildKeycardMesh,
} from './buildCollectibles.js'
import {
  buildMazeMeshes,
  MAZE_MESH_PALETTE,
  setExitGateState,
  updateExitGate,
} from './buildMazeMeshes.js'
import { CollectibleManager } from './CollectibleManager.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createMockAudioContext() {
  const stats = {
    oscillatorsStarted: 0,
    bufferSourcesStarted: 0,
  }

  function makeParam(initial = 0) {
    return {
      value: initial,
      setValueAtTime(v) {
        this.value = v
      },
      setTargetAtTime(v) {
        this.value = v
      },
      linearRampToValueAtTime(v) {
        this.value = v
      },
      exponentialRampToValueAtTime(v) {
        this.value = v
      },
    }
  }

  function makeBaseNode(extra = {}) {
    return {
      connect() {},
      disconnect() {},
      ...extra,
    }
  }

  const ctx = {
    state: 'running',
    currentTime: 1.0,
    sampleRate: 44100,
    destination: makeBaseNode(),
    listener: {
      positionX: makeParam(0),
      positionY: makeParam(0),
      positionZ: makeParam(0),
      forwardX: makeParam(0),
      forwardY: makeParam(0),
      forwardZ: makeParam(-1),
      upX: makeParam(0),
      upY: makeParam(1),
      upZ: makeParam(0),
    },
    async resume() {},
    async close() {},
    createGain() {
      return makeBaseNode({ gain: makeParam(1) })
    },
    createDynamicsCompressor() {
      return makeBaseNode({
        threshold: makeParam(-24),
        knee: makeParam(30),
        ratio: makeParam(12),
      })
    },
    createBiquadFilter() {
      return makeBaseNode({
        type: 'lowpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
      })
    },
    createOscillator() {
      return makeBaseNode({
        type: 'sine',
        frequency: makeParam(440),
        onended: null,
        start() {
          stats.oscillatorsStarted += 1
        },
        stop() {},
      })
    },
    createBuffer(channels, length, sampleRate) {
      const channelData = new Float32Array(length)
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData() {
          return channelData
        },
      }
    },
    createBufferSource() {
      return makeBaseNode({
        buffer: null,
        loop: false,
        onended: null,
        start() {
          stats.bufferSourcesStarted += 1
        },
        stop() {},
      })
    },
    createPanner() {
      return makeBaseNode({
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
      })
    },
  }

  return { ctx, stats }
}

function createHeadlessCanvasHost() {
  return {
    clientWidth: 800,
    clientHeight: 500,
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
  }
}

function createFakeRendererFactory() {
  return () => ({
    domElement: {
      style: {},
      remove() {},
    },
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: '',
    setPixelRatio() {},
    setSize() {},
    render() {},
    dispose() {},
  })
}

console.log('--- RUNNING RESONANCE KEYCARDS & LOCKED EXIT GATE TESTS ---')

// Test 1: Deterministic objective placement
console.log('Test 1: Deterministic Objective Placement')
{
  const mazeA = generateMaze({ seed: 551199 })
  const mazeB = generateMaze({ seed: 551199 })
  const mazeDiff = generateMaze({ seed: 991155 })

  assert(
    Array.isArray(mazeA.keycards) && mazeA.keycards.length === 2,
    `Maze generates 2 keycards (got ${mazeA.keycards?.length})`
  )
  assert(
    JSON.stringify(mazeA.keycards) === JSON.stringify(mazeB.keycards),
    'Maze keycard placement is deterministic for identical seeds'
  )
  assert(
    JSON.stringify(mazeA.keycards) !== JSON.stringify(mazeDiff.keycards),
    'Maze keycard placement varies with different seeds'
  )
}
console.log('✓ Deterministic keycard counts and seed reproducibility verified')

// Test 2: Reachability and exclusion rules
console.log('Test 2: Reachability & Exclusion Validation')
{
  const maze = generateMaze({ seed: 733142 })
  const reachInfo = exploreReachableCells(maze.grid, maze.start)
  const hazards = placeHazards(maze)
  const hidingSpots = placeHidingSpots(maze, { hazards })
  const hazardKeys = new Set(hazards.map((h) => `${h.row},${h.col}`))
  const spotKeys = new Set(hidingSpots.map((s) => `${s.row},${s.col}`))
  const seenKeys = new Set()

  for (const keycard of maze.keycards) {
    const key = `${keycard.row},${keycard.col}`
    assert(
      maze.grid[keycard.row]?.[keycard.col] === CELL_TYPES.PATH,
      `Keycard (${key}) must be on a walkable PATH tile`
    )
    assert(
      reachInfo.distances.has(key),
      `Keycard (${key}) must be reachable from start via BFS`
    )
    assert(
      !(keycard.row === maze.start.row && keycard.col === maze.start.col),
      `Keycard (${key}) must not overlap player start`
    )
    assert(
      !(keycard.row === maze.exit.row && keycard.col === maze.exit.col),
      `Keycard (${key}) must not overlap exit`
    )
    assert(!hazardKeys.has(key), `Keycard (${key}) must not overlap hazards`)
    assert(!spotKeys.has(key), `Keycard (${key}) must not overlap hiding spots`)
    assert(!seenKeys.has(key), `Keycard (${key}) must not overlap another keycard`)
    seenKeys.add(key)
  }

  // Standalone placeKeycards matches maze.keycards
  const directPlacement = placeKeycards(maze)
  assert(
    JSON.stringify(directPlacement) === JSON.stringify(maze.keycards),
    'Standalone placeKeycards matches generated maze.keycards'
  )
}
console.log('✓ Reachability via BFS and strict exclusions verified')

// Test 3: Objective collection, locked exit blocking victory, final unlock, and victory after unlock
console.log('Test 3: Collection, Locked Exit Blocking, Unlock & Victory Flow')
let state = createInitialGameState(884422)
assert(state.totalKeys === 2, `Run requires 2 keys (got ${state.totalKeys})`)
assert(state.keysCollected === 0, 'Initial keysCollected is 0')
assert(state.isExitLocked === true, 'Exit starts locked when keys are required')
assert(state.hasWon === false, 'Initial hasWon is false')

// Attempt to reach exit BEFORE collecting keycards -> blocked!
state = gameReducer(state, {
  type: 'SYNC_PLAYER_CELL',
  position: state.maze.exit,
})
assert(state.hasWon === false, 'Locked exit prevents victory when 0/2 keys collected')
assert(state.isExitLocked === true, 'Exit remains locked after touching locked exit')
assert(
  state.lastEvent?.type === 'locked_exit' &&
    typeof state.lastEvent?.message === 'string' &&
    state.lastEvent.message.includes('Locked'),
  'Touching locked exit emits locked_exit event with user-facing message'
)

// Collect first keycard (1/2)
const firstKey = state.keycards[0]
state = gameReducer(state, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: firstKey.row, col: firstKey.col },
})
assert(state.keysCollected === 1, 'Collecting first keycard increments keysCollected to 1')
assert(state.keycards.length === 1, '1 keycard remains after collecting first')
assert(state.isExitLocked === true, 'Exit stays locked at 1/2 keys')
assert(
  state.lastEvent?.type === 'keycard_collected',
  `First keycard emits keycard_collected (got ${state.lastEvent?.type})`
)

// Attempt exit again with 1/2 keys -> still blocked!
state = gameReducer(state, {
  type: 'SYNC_PLAYER_CELL',
  position: state.maze.exit,
})
assert(state.hasWon === false, 'Locked exit prevents victory when 1/2 keys collected')
assert(state.lastEvent?.type === 'locked_exit', 'Still emits locked_exit at 1/2 keys')

// Collect final keycard (2/2) -> unlocks gate immediately!
const secondKey = state.keycards[0]
state = gameReducer(state, {
  type: 'SYNC_PLAYER_CELL',
  position: { row: secondKey.row, col: secondKey.col },
})
assert(state.keysCollected === 2, 'Collecting final keycard reaches 2/2')
assert(state.keycards.length === 0, '0 keycards remain uncollected')
assert(state.isExitLocked === false, 'Final keycard immediately unlocks exit gate')
assert(
  state.lastEvent?.type === 'gate_unlocked' && state.lastEvent?.gateUnlocked === true,
  `Final keycard emits gate_unlocked event (got ${state.lastEvent?.type})`
)
assert(
  state.effects.some((fx) => fx.kind === 'gate_unlock'),
  'Gate unlock spawns visual effect entry at exit'
)

// Reach exit after unlocking -> victory granted!
state = gameReducer(state, {
  type: 'SYNC_PLAYER_CELL',
  position: state.maze.exit,
})
assert(state.hasWon === true, 'Victory succeeds after collecting all keycards and unlocking exit')
assert(state.lastEvent?.type === 'exit', 'Reaching unlocked exit emits exit event')
console.log('✓ Locked exit rejection, keycard progress, unlock transition, and victory verified')

// Test 4: Reset, replay, difficulty switch & new-maze synchronization
console.log('Test 4: Reset, Replay, Difficulty Switch & New Maze Sync')
state = gameReducer(state, { type: 'RESET_RUN' })
assert(state.hasWon === false, 'RESET_RUN clears hasWon')
assert(state.keysCollected === 0, 'RESET_RUN resets keysCollected to 0')
assert(state.keycards.length === 2, 'RESET_RUN restores all 2 keycards')
assert(state.isExitLocked === true, 'RESET_RUN re-locks exit gate')

console.log('✓ Reset and keycard synchronization verified')

// Test 5: 2D compatibility & configurable objectives toggle
console.log('Test 5: 2D Compatibility & Objectives Toggle')
let state2D = createInitialGameState(441122, { objectivesEnabled: false })
assert(state2D.objectivesEnabled === false, '2D config disables keycard objectives')
assert(state2D.isExitLocked === false, '2D mode exit is unlocked by default')
assert(state2D.totalKeys === 0 && state2D.keycards.length === 0, '2D mode has 0 required keys')

state2D = gameReducer(state2D, {
  type: 'SYNC_PLAYER_CELL',
  position: state2D.maze.exit,
})
assert(state2D.hasWon === true, '2D mode reaches victory directly at exit without keycards')

let toggled = createInitialGameState(441122, { objectivesEnabled: false })
toggled = gameReducer(toggled, { type: 'SET_OBJECTIVES_ENABLED', enabled: true })
assert(
  toggled.objectivesEnabled === true && toggled.totalKeys === 2 && toggled.isExitLocked === true,
  'SET_OBJECTIVES_ENABLED activates keycard objectives cleanly'
)
console.log('✓ 2D backward compatibility and configurable objective mode verified')

// Test 6: 3D Procedural Keycard Mesh, Exit Gate States, Audio Cues & MazeSceneEngine
console.log('Test 6: 3D Visuals, Audio Cues & MazeSceneEngine Integration')
const keycardMesh = buildKeycardMesh({ id: 'test-kc', row: 3, col: 3 })
assert(keycardMesh.children.length >= 4, 'Keycard mesh is a multi-part procedural Three.js Group')
assert(keycardMesh.userData.collectibleKind === 'keycard', 'Keycard mesh carries keycard metadata')

const testMaze = generateMaze({ difficulty: 'small', seed: 90210 })
const mazeGroup = buildMazeMeshes(testMaze)
const exitGate = mazeGroup?.userData?.exitGate
assert(Boolean(exitGate), 'buildMazeMeshes attaches procedural 3D exitGate')

setExitGateState(exitGate, true, { animate: false })
assert(exitGate.userData.isLocked === true, 'Exit gate enters locked state')
assert(exitGate.userData.lockBarGroup.visible === true, 'Locked elevator security crossbar is visible')
assert(
  Math.abs(exitGate.userData.doors.leftInner.position.x) < 0.65 &&
    Math.abs(exitGate.userData.doors.rightInner.position.x) < 0.65,
  'Locked extraction elevator doors seal the entrance'
)
assert(
  exitGate.userData.frameMat.color.getHex() === MAZE_MESH_PALETTE.exitLocked,
  'Locked exit gate displays locked crimson accent color'
)

setExitGateState(exitGate, false, { animate: true })
assert(exitGate.userData.isLocked === false, 'Exit gate transitions to unlocked state')
assert(exitGate.userData.unlockFlashTimer > 0, 'Gate unlock triggers celebratory glow flash')
for (let i = 0; i < 40; i += 1) {
  updateExitGate(exitGate, 0.05, i * 0.05)
}
assert(
  exitGate.userData.lockBarGroup.visible === false &&
    Math.abs(exitGate.userData.doors.leftInner.position.x) >= 0.94 &&
    Math.abs(exitGate.userData.doors.rightInner.position.x) >= 0.94,
  'Unlocked extraction elevator retracts lock bar and slides doors wide open'
)

const cm = new CollectibleManager(null)
cm.syncState({
  maze: testMaze,
  items: testMaze.collectibles.items,
  keycards: testMaze.keycards,
  spawnBursts: false,
  isReset: true,
})
assert(cm.getCounts().keycards === 2, 'CollectibleManager mounts all 2 standard keycard meshes')
cm.update(0.05)
cm.syncKeycards(testMaze.keycards.slice(1), testMaze, { spawnBursts: true })
assert(cm.getCounts().keycards === 1, 'CollectibleManager removes single collected keycard')
assert(cm.getCounts().bursts === 1, 'Removing one keycard spawns 1 procedural collection burst')
cm.syncKeycards([], testMaze, { spawnBursts: true })
assert(cm.getCounts().keycards === 0, 'CollectibleManager removes remaining collected keycard')
assert(cm.getCounts().bursts === 2, 'Removing both keycards spawns 2 procedural collection bursts')
cm.dispose()

const mockAudio = createMockAudioContext()
const audio = new HorrorAudioEngine({
  audioContext: mockAudio.ctx,
  autoUnlock: true,
  recordCueHistory: true,
})
const oscBefore = mockAudio.stats.oscillatorsStarted
audio.handleGameEvent({ id: 101, type: 'locked_exit' })
audio.handleGameEvent({ id: 102, type: 'keycard_collected', keysCollected: 1, totalKeys: 2 })
audio.handleGameEvent({
  id: 103,
  type: 'gate_unlocked',
  keycard: { id: 'k2' },
  keysCollected: 2,
  totalKeys: 2,
})
audio.handleGameEvent({ id: 103, type: 'gate_unlocked' }) // duplicate ID should be ignored
const cues = audio.getCueHistory().map((c) => c.type)
assert(cues.includes('locked_exit'), 'Audio engine records locked_exit cue')
assert(cues.includes('keycard_collected'), 'Audio engine records keycard_collected cue')
assert(cues.includes('gate_unlocked'), 'Audio engine records gate_unlocked cue')
assert(
  cues.filter((c) => c === 'gate_unlocked').length === 1,
  'Duplicate event IDs are deduplicated for gate_unlocked cue'
)
assert(mockAudio.stats.oscillatorsStarted > oscBefore, 'Procedural Web Audio nodes synthesize keycard/gate cues')
audio.dispose()

const engine = new MazeSceneEngine(createHeadlessCanvasHost(), {
  createRenderer: createFakeRendererFactory(),
  isSoftwareGl: true,
})
engine.setMaze(testMaze)
assert(engine.getIsExitLocked() === true, 'Engine defaults exit gate to locked for maze with keycards')
assert(engine.getCollectibleManager().getCounts().keycards === 2, 'Engine mounts all 2 maze keycards')
engine.setExitLocked(false, { animate: true })
assert(engine.getIsExitLocked() === false, 'Engine unlocks exit gate')
assert(
  engine.getCollectibleManager().getCounts().bursts >= 1,
  'Engine unlock spawns gate_unlock burst at exit'
)
engine.dispose()

console.log('✓ 3D keycard meshes, exit gate lock/unlock visuals, audio cues, and engine sync verified')
console.log('--- ALL RESONANCE KEYCARDS & LOCKED EXIT GATE TESTS PASSED SUCCESSFULLY! ---')
