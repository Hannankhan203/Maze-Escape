import { CameraRig, CAMERA_MODES } from './CameraRig.js'
import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

console.log('Running Camera Collision, Rig & Smooth Transition Unit Tests...')

const mockMaze = {
  width: 7,
  height: 7,
  start: { row: 3, col: 3 },
  exit: { row: 5, col: 5 },
  grid: [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ]
}

const camera = new THREE.PerspectiveCamera(75, 16/9, 0.1, 1000)
const rig = new CameraRig(camera, {
  mode: CAMERA_MODES.FIRST_PERSON,
  followDistance: 4.0,
})

rig.setMaze(mockMaze)

const centerWorld = gridToWorld(3, 3, mockMaze)
rig.setPlayerPosition(centerWorld.x, 0, centerWorld.z)
rig.snap()

// Test 1: Start in First-Person
assert(rig.getMode() === CAMERA_MODES.FIRST_PERSON, 'Starts in first-person mode')

// Test 2: Switch to Third-Person smoothly
rig.setMode(CAMERA_MODES.THIRD_PERSON)
assert(rig.getMode() === CAMERA_MODES.THIRD_PERSON, 'Switched mode to third-person')
assert(rig._transitioning === true, 'Transitioning flag is active')

// Update rig over transition duration
for (let i = 0; i < 25; i++) {
  rig.update(0.016)
}
assert(rig._transitioning === false, 'Transition completes successfully')

// Test 3: Switch back to First-Person smoothly during movement / rotation
rig.setLookDirection(1.2, 0.3)
rig.setMode(CAMERA_MODES.FIRST_PERSON)
assert(rig.getMode() === CAMERA_MODES.FIRST_PERSON, 'Switched mode to first-person')
assert(rig._transitioning === true, 'Transitioning to first-person is active')

for (let i = 0; i < 25; i++) {
  rig.update(0.016)
}
assert(rig._transitioning === false, 'Transition to first-person completes successfully')

// Test 4: Rapid repeated switching without unstable states
rig.setMode(CAMERA_MODES.THIRD_PERSON)
rig.setMode(CAMERA_MODES.FIRST_PERSON)
rig.setMode(CAMERA_MODES.THIRD_PERSON)
assert(rig.getMode() === CAMERA_MODES.THIRD_PERSON, 'Handles rapid mode switching robustly')
rig.update(0.1)
assert(Number.isFinite(camera.position.x), 'Camera position is finite after rapid switching')

// Test 5: Maze replacement / clear resets state
rig.setMaze(null)
assert(rig._maze === null, 'Maze cleared')
rig.setMaze(mockMaze)
assert(rig._maze === mockMaze, 'Maze replaced')

rig.dispose()
assert(rig.isDisposed, 'Disposed cleanly')

console.log('ALL CAMERA TRANSITION & COLLISION TESTS PASSED SUCCESSFULLY!')
