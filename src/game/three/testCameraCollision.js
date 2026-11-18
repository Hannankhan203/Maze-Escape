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

// Test 6: Third-Person height cap <= 2.75m across extreme look pitch
const tallConfigRig = new CameraRig(camera, {
  mode: CAMERA_MODES.THIRD_PERSON,
  followDistance: 4.2,
  followHeight: 3.4,
  maxCameraHeight: 4.0,
})
tallConfigRig.setMaze(mockMaze)
tallConfigRig.setPlayerPosition(centerWorld.x, 0, centerWorld.z)
for (const pitch of [-Math.PI / 2.2, -0.8, -0.35, 0, 0.35, 0.8, Math.PI / 2.2]) {
  tallConfigRig.setLookDirection(0, pitch)
  tallConfigRig.snap()
  assert(
    camera.position.y <= 2.75 + 1e-6 && camera.position.y >= 0.35 - 1e-6,
    `Third-person height stays in [0.35, 2.75] at pitch=${pitch.toFixed(2)} (got ${camera.position.y.toFixed(3)})`
  )
  for (let i = 0; i < 15; i += 1) {
    tallConfigRig.update(0.016)
    assert(
      camera.position.y <= 2.75 + 1e-6,
      `Damped height remains <= 2.75m at pitch=${pitch.toFixed(2)} (got ${camera.position.y.toFixed(3)})`
    )
  }
}
tallConfigRig.dispose()

// Test 7: Corner & corridor wall collision, backing against walls, and shoulderOffset clamping
const lBendMaze = {
  width: 7,
  height: 7,
  start: { row: 3, col: 3 },
  exit: { row: 1, col: 5 },
  grid: [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 0, 0, 0, 1],
    [1, 1, 1, 0, 1, 1, 1],
    [1, 0, 0, 0, 0, 1, 1],
    [1, 1, 1, 0, 1, 1, 1],
    [1, 1, 1, 0, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ],
}
const cornerCam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000)
const cornerRig = new CameraRig(cornerCam, {
  mode: CAMERA_MODES.THIRD_PERSON,
  followDistance: 4.2,
  shoulderOffset: 0.45,
})
cornerRig.setMaze(lBendMaze)
assert(cornerCam.rotation.order === 'YXZ', 'FIX 01 YXZ order preserved on collision rig')

// Backing flush against South wall of cell (3, 4) near corner (PLAYER_RADIUS = 0.75)
const cell34 = gridToWorld(3, 4, lBendMaze)
// Cell (3,4) bounds: East wall at col 5 (maxX of cell 3,4), South wall at row 4, North wall at row 2
// Place player 0.85m from East wall and 0.85m from South wall, facing West (looking down corridor)
cornerRig.setPlayerPosition(cell34.x + 1.15, 0, cell34.z + 1.15)
cornerRig.setLookDirection(Math.PI / 2, 0) // Facing West -> behind is East wall!
cornerRig.snap()
assert(
  cornerRig._isCircleClear(cornerCam.position.x, cornerCam.position.z, 0.3),
  'Backed against East wall: camera stays clear of East wall'
)
assert(
  cornerRig._currentFollowDistance < 1.2,
  `Follow distance reduces cleanly when backed against wall (got ${cornerRig._currentFollowDistance.toFixed(3)})`
)

// Smooth reduction when moving from open center into tight corner
const cell33 = gridToWorld(3, 3, lBendMaze)
cornerRig.setPlayerPosition(cell33.x, 0, cell33.z)
cornerRig.setLookDirection(0, -0.3) // Facing North along corridor (open behind at row 4 & 5!)
cornerRig.snap()
const openDist = cornerRig._currentFollowDistance
const openShoulder = cornerRig._currentShoulderOffset
assert(openDist > 3.5, `Open corridor maintains near-full followDistance (got ${openDist.toFixed(2)})`)
assert(openShoulder > 0.4, `Open corridor maintains near-full shoulderOffset (got ${openShoulder.toFixed(2)})`)

// Rotate yaw 360 degrees around the T-junction corner while updating smoothly
const worldUp = new THREE.Vector3()
for (let step = 0; step < 48; step += 1) {
  const yaw = (step / 48) * Math.PI * 2
  cornerRig.setLookDirection(yaw, (step % 5 - 2) * 0.25)
  cornerRig.update(0.016)
  assert(
    cornerRig._isCircleClear(cornerCam.position.x, cornerCam.position.z, 0.3),
    `Corner sweep step ${step} keeps camera outside walls/corners`
  )
  assert(
    cornerCam.position.y <= 2.75 + 1e-6,
    `Corner sweep step ${step} keeps camera <= 2.75m`
  )
  worldUp.set(0, 1, 0).applyQuaternion(cornerCam.quaternion)
  assert(worldUp.y > 0.5, `Corner sweep step ${step} keeps camera upright (worldUp.y=${worldUp.y.toFixed(3)})`)
}

// Gradual obstruction shrinks followDistance and shoulderOffset smoothly without popping
cornerRig.setPlayerPosition(cell33.x, 0, cell33.z)
cornerRig.setLookDirection(0, 0)
cornerRig.snap()
const distBefore = cornerRig._currentFollowDistance
const shoulderBefore = cornerRig._currentShoulderOffset
// Turn smoothly toward corner wall behind right shoulder (facing West-North-West so South-East wall is behind)
cornerRig.setLookDirection(Math.PI * 0.75, 0)
cornerRig.update(0.016)
const distStep1 = cornerRig._currentFollowDistance
const shoulderStep1 = cornerRig._currentShoulderOffset
assert(
  distStep1 < distBefore && shoulderStep1 < shoulderBefore,
  'Obstacle smoothly reduces both followDistance and shoulderOffset'
)

// Test 8: Look-at target never passes through forward walls
cornerRig.setPlayerPosition(cell34.x + 1.2, 0, cell34.z)
cornerRig.setLookDirection(-Math.PI / 2, 0) // Facing directly into East wall 0.8m ahead
cornerRig.snap()
assert(
  cornerRig._isCircleClear(cornerRig._targetLookAt.x, cornerRig._targetLookAt.z, 0.18),
  `Look-at target clamped before forward wall (lookAt=${cornerRig._targetLookAt.x.toFixed(2)}, ${cornerRig._targetLookAt.z.toFixed(2)})`
)

cornerRig.dispose()
rig.dispose()
assert(rig.isDisposed, 'Disposed cleanly')

console.log('ALL CAMERA TRANSITION & COLLISION TESTS PASSED SUCCESSFULLY!')
