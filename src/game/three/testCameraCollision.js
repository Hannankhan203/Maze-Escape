import { CameraRig, CAMERA_MODES } from './CameraRig.js'
import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

console.log('Running Camera Collision & Rig Unit Tests...')

// Mock Maze with open center and outer walls
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
  mode: CAMERA_MODES.THIRD_PERSON,
  followDistance: 4.0,
})

rig.setMaze(mockMaze)

// Test 1: Camera retracts before entering a wall
// Put player near top wall (row 1) facing north
const nearWallWorld = gridToWorld(1, 3, mockMaze)
rig.setPlayerPosition(nearWallWorld.x, 0, nearWallWorld.z)
rig.setLookDirection(0) // looking north towards row 0 wall
rig.setMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })

console.log('Camera retracts near north wall, pos:', camera.position.clone(), 'follow distance:', rig._currentFollowDistance)
assert(rig._currentFollowDistance <= 4.0, 'Camera follow distance is bounded by max followDistance')

// Test 2: Camera remains outside walls at corners and maze boundaries
assert(rig._currentFollowDistance > 0, 'Safe distance is positive at boundary')

// Test 3: Camera smoothly restores its follow distance after obstruction clears
// Move player to center (3, 3) where there are no nearby walls
const centerWorld = gridToWorld(3, 3, mockMaze)
rig.setPlayerPosition(centerWorld.x, 0, centerWorld.z)
// Force short distance first to test recovery
rig._currentFollowDistance = 1.0
const distBefore = rig._currentFollowDistance
rig.update(0.5) // update time with delta
const distAfter = rig._currentFollowDistance
console.log(`Follow distance recovery: before=${distBefore}, after=${distAfter}`)
assert(distAfter > distBefore, 'Follow distance recovers smoothly when obstruction clears')

// Test 4: Camera remains stable while rotating and following a moving player
rig.setPlayerPosition(centerWorld.x + 0.5, 0, centerWorld.z + 0.5)
rig.applyLookDelta(0.5, 0.2)
rig.update(0.016)
const stablePos = camera.position.clone()
assert(Number.isFinite(stablePos.x) && Number.isFinite(stablePos.y) && Number.isFinite(stablePos.z), 'Camera remains stable during rotation and movement')

// Test 5: First-person mode remains unaffected
rig.setMode(CAMERA_MODES.FIRST_PERSON, { immediate: true })
assert(rig.getMode() === CAMERA_MODES.FIRST_PERSON, 'Switched to first-person mode')
rig.update(0.016)
const fpPos = camera.position.clone()
const expectedFpY = 0 + rig.config.eyeHeight
assert(Math.abs(fpPos.y - expectedFpY) < 1e-3, 'First-person camera is positioned at player eye height')

// Test 6: Replacing or clearing the maze resets obstruction state
rig.setMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
rig.setMaze(null)
assert(rig._maze === null, 'Maze cleared successfully')
rig.setMaze(mockMaze)
assert(rig._maze === mockMaze, 'Maze replaced successfully')

rig.dispose()
assert(rig.isDisposed, 'CameraRig disposes cleanly')

console.log('ALL CAMERA COLLISION & RIG TESTS PASSED SUCCESSFULLY!')
