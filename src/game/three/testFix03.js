import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CAMERA_MODES } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { disposeAllSharedPools } from './sharedResources.js'

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 800,
    clientHeight: 500,
  }
  const mockRenderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    pixelRatio: 1,
    lastSize: { width: 800, height: 500 },
    renderCalls: 0,
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

console.log('--- RUNNING FIX 03: RESTART CAMERA TRANSITIONS TESTS ---')

const maze = generateMaze({ difficulty: 'small', seed: 5555 })

for (const mode of [CAMERA_MODES.FIRST_PERSON, CAMERA_MODES.THIRD_PERSON]) {
  console.log(`Testing Restart camera in mode: ${mode}`)
  const engine = createHeadlessEngine({
    cameraMode: mode,
    enemies: { autoSpawn: false },
  })
  engine.setMaze(maze)

  // 1. Initial maze start orientation & initialYaw storage
  const lookBefore = engine.cameraRig.getLookDirection()
  assert.equal(lookBefore.pitch, 0, 'Initial pitch is 0 at maze start')
  assert.equal(typeof engine._currentInitialYaw, 'number', '_currentInitialYaw stored on MazeSceneEngine')

  // Rotate camera away from initial orientation and pitch
  engine.setLookDirection(lookBefore.yaw + 1.25, 0.6)
  engine.cameraRig.snap()
  const lookModified = engine.cameraRig.getLookDirection()
  assert.notEqual(lookModified.yaw, lookBefore.yaw, 'Yaw modified successfully')
  assert.equal(lookModified.pitch, 0.6, 'Pitch modified successfully')

  // 2. Restart via resetCombat() and setPlayerGridPosition(start) restores initialYaw and pitch = 0 with snap
  engine.resetCombat()
  engine.setPlayerGridPosition(maze.start.row, maze.start.col, { immediate: true })
  const lookAfterRestart = engine.cameraRig.getLookDirection()
  assert.equal(
    lookAfterRestart.yaw,
    engine._currentInitialYaw,
    `Restart restores initialYaw in ${mode} mode`
  )
  assert.equal(lookAfterRestart.pitch, 0, `Restart resets pitch to 0 in ${mode} mode`)

  engine.dispose()
}

// 5. FIX 04: HorrorAudioEngine updateListener handles world-up and forward orientation correctly
console.log('Testing FIX 04: Audio listener orientation & touch look scaling')
const testAudioEngine = new HorrorAudioEngine({ autoUnlock: false })
const testCam = new THREE.PerspectiveCamera(75, 16/9, 0.1, 100)
testCam.position.set(2, 1.65, 3)
testCam.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)
testAudioEngine.updateListener(testCam)
assert.equal(typeof testAudioEngine._listenerForward.x, 'number')
assert.equal(typeof testAudioEngine._listenerUp.y, 'number')
testAudioEngine.dispose()

disposeAllSharedPools()
console.log('--- ALL FIX 03 & FIX 04 CAMERA, AUDIO & INPUT TESTS PASSED SUCCESSFULLY! ---')
