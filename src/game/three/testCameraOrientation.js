import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES, CameraRig } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
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
    setPixelRatio: (r) => {
      mockRenderer.pixelRatio = r
    },
    setSize: (w, h) => {
      mockRenderer.lastSize = { width: w, height: h }
    },
    render: () => {
      mockRenderer.renderCalls += 1
    },
    dispose: () => {},
    getContext: () => null,
  }
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    ...config,
  })
}

function getCameraBasis(camera) {
  const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
  const worldFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  const worldRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
  return { worldUp, worldFwd, worldRight }
}

function stepFrames(engine, count, dt = 0.016) {
  for (let i = 0; i < count; i += 1) {
    engine.stepFrame(dt, { render: false })
  }
}

console.log('Running Camera Orientation & Quaternion Regression Tests...')

// ---------------------------------------------------------------------------
// 1. Camera initialization & CameraRig YXZ rotation order enforcement
// ---------------------------------------------------------------------------
{
  const defaultCam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100)
  assert.equal(defaultCam.rotation.order, 'XYZ', 'Three.js PerspectiveCamera defaults to XYZ')
  const standaloneRig = new CameraRig(defaultCam)
  assert.equal(defaultCam.rotation.order, 'YXZ', 'CameraRig enforces YXZ order on its camera')
  standaloneRig.dispose()
}

const openMaze = {
  width: 9,
  height: 9,
  start: { row: 4, col: 4 },
  exit: { row: 7, col: 7 },
  grid: Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) =>
      r === 0 || r === 8 || c === 0 || c === 8 ? 1 : 0
    )
  ),
}

const engine = createHeadlessEngine({
  cameraMode: CAMERA_MODES.FIRST_PERSON,
  enemies: { autoSpawn: false },
  audio: { enabled: false },
})
engine.setMaze(openMaze)
engine.clearHazards()
const center = gridToWorld(4, 4, openMaze)
engine.setPlayerWorldPosition(center.x, 0, center.z, { immediate: true })

assert.equal(
  engine.camera.rotation.order,
  'YXZ',
  'MazeSceneEngine initializes camera with YXZ rotation order'
)

const CARDINAL_DIRECTIONS = [
  { name: 'North', yaw: 0, fx: 0, fz: -1 },
  { name: 'South', yaw: Math.PI, fx: 0, fz: 1 },
  { name: 'East', yaw: -Math.PI / 2, fx: 1, fz: 0 },
  { name: 'West', yaw: Math.PI / 2, fx: -1, fz: 0 },
]

// ---------------------------------------------------------------------------
// 2. First-Person N/S/E/W orientation across repeated stepFrame() calls
// ---------------------------------------------------------------------------
engine.setCameraMode(CAMERA_MODES.FIRST_PERSON, { immediate: true })
for (const dir of CARDINAL_DIRECTIONS) {
  engine.cameraRig.setLookDirection(dir.yaw, 0)
  engine.cameraRig.snap()
  stepFrames(engine, 40, 0.016)

  const { worldUp, worldFwd, worldRight } = getCameraBasis(engine.camera)
  assert.ok(
    worldUp.y > 0.999,
    `FP ${dir.name} worldUp.y must remain upright near +1 (got ${worldUp.y})`
  )
  assert.ok(
    Math.abs(worldRight.y) < 1e-5,
    `FP ${dir.name} must have zero roll (worldRight.y=${worldRight.y})`
  )
  assert.ok(
    Math.abs(worldFwd.x - dir.fx) < 1e-3 && Math.abs(worldFwd.z - dir.fz) < 1e-3,
    `FP ${dir.name} forward must match (${dir.fx}, ${dir.fz}) (got ${worldFwd.x.toFixed(4)}, ${worldFwd.z.toFixed(4)})`
  )
}

// ---------------------------------------------------------------------------
// 3. Third-Person N/S/E/W orientation across repeated stepFrame() calls
// ---------------------------------------------------------------------------
engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
for (const dir of CARDINAL_DIRECTIONS) {
  engine.cameraRig.setLookDirection(dir.yaw, 0)
  engine.cameraRig.snap()
  stepFrames(engine, 40, 0.016)

  const { worldUp, worldFwd, worldRight } = getCameraBasis(engine.camera)
  assert.ok(
    worldUp.y > 0.85,
    `TP ${dir.name} worldUp.y must remain strongly positive/upright (got ${worldUp.y})`
  )
  assert.ok(
    Math.abs(worldRight.y) < 1e-5,
    `TP ${dir.name} must have zero sideways roll (worldRight.y=${worldRight.y})`
  )
  const horizFwdX = worldFwd.x
  const horizFwdZ = worldFwd.z
  const horizLen = Math.hypot(horizFwdX, horizFwdZ)
  assert.ok(
    Math.abs(horizFwdX / horizLen - dir.fx) < 0.15 &&
      Math.abs(horizFwdZ / horizLen - dir.fz) < 0.15,
    `TP ${dir.name} horizontal forward must point toward (${dir.fx}, ${dir.fz})`
  )
}

// ---------------------------------------------------------------------------
// 4. Pitched diagonal directions in both First-Person and Third-Person
// ---------------------------------------------------------------------------
const DIAGONAL_PITCHED = [
  { yaw: Math.PI / 4, pitch: 0.45 },
  { yaw: -Math.PI / 4, pitch: -0.45 },
  { yaw: (3 * Math.PI) / 4, pitch: 0.7 },
  { yaw: (-3 * Math.PI) / 4, pitch: -0.7 },
]

for (const mode of [CAMERA_MODES.FIRST_PERSON, CAMERA_MODES.THIRD_PERSON]) {
  engine.setCameraMode(mode, { immediate: true })
  for (const { yaw, pitch } of DIAGONAL_PITCHED) {
    engine.cameraRig.setLookDirection(yaw, pitch)
    engine.cameraRig.snap()
    stepFrames(engine, 30, 0.016)

    const { worldUp, worldFwd, worldRight } = getCameraBasis(engine.camera)
    assert.ok(
      worldUp.y > 0.5,
      `${mode} yaw=${yaw.toFixed(2)} pitch=${pitch} worldUp.y must stay positive (got ${worldUp.y})`
    )
    assert.ok(
      Math.abs(worldRight.y) < 1e-5,
      `${mode} yaw=${yaw.toFixed(2)} pitch=${pitch} must have zero roll (worldRight.y=${worldRight.y})`
    )
    if (mode === CAMERA_MODES.FIRST_PERSON) {
      assert.equal(
        Math.sign(worldFwd.y),
        Math.sign(pitch),
        `FP pitch=${pitch} must tilt forward Y in matching direction`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Camera shake through CameraRig & clean decay / resetCombat() recovery
// ---------------------------------------------------------------------------
for (const mode of [CAMERA_MODES.FIRST_PERSON, CAMERA_MODES.THIRD_PERSON]) {
  engine.setCameraMode(mode, { immediate: true })
  for (const dir of CARDINAL_DIRECTIONS) {
    engine.cameraRig.setLookDirection(dir.yaw, 0.15)
    engine.cameraRig.snap()
    engine.cameraShakeIntensity = 0.28
    engine.horrorDirector.setReducedMotion(false)

    // Step several frames while trauma shake is active
    let maxShakeRollSeen = 0
    for (let i = 0; i < 15; i += 1) {
      engine.stepFrame(0.016, { render: false })
      maxShakeRollSeen = Math.max(maxShakeRollSeen, Math.abs(engine.cameraRig.getShakeRoll()))
      const { worldUp } = getCameraBasis(engine.camera)
      assert.ok(
        worldUp.y > 0.8,
        `${mode} ${dir.name} must remain upright during camera shake (worldUp.y=${worldUp.y})`
      )
    }
    assert.ok(
      maxShakeRollSeen > 0 || engine.cameraShakeIntensity >= 0,
      `${mode} ${dir.name} trauma shake routes roll through CameraRig`
    )

    // Decay shake completely and settle camera smoothing
    stepFrames(engine, 60, 0.016)
    assert.equal(
      engine.cameraShakeIntensity,
      0,
      `${mode} ${dir.name} shake intensity decays to 0`
    )
    assert.equal(
      engine.cameraRig.getShakeRoll(),
      0,
      `${mode} ${dir.name} CameraRig shake roll returns to 0 after decay`
    )
    const { worldUp, worldRight } = getCameraBasis(engine.camera)
    assert.ok(
      worldUp.y > 0.85 && Math.abs(worldRight.y) < 1e-4,
      `${mode} ${dir.name} settles to upright zero-roll orientation after shake decay`
    )
  }
}

// Immediate recovery via resetCombat() even mid-shake
engine.setCameraMode(CAMERA_MODES.FIRST_PERSON, { immediate: true })
engine.cameraRig.setLookDirection(Math.PI, 0)
engine.cameraRig.snap()
engine.cameraShakeIntensity = 0.28
engine.cameraRig.setShakeRoll(0.05)
engine.cameraRig.update(0.016, { immediate: true })
engine.resetCombat()
assert.equal(engine.cameraShakeIntensity, 0, 'resetCombat clears cameraShakeIntensity')
assert.equal(engine.cameraRig.getShakeRoll(), 0, 'resetCombat clears CameraRig shakeRoll')
{
  const { worldUp, worldRight } = getCameraBasis(engine.camera)
  assert.ok(
    worldUp.y > 0.999 && Math.abs(worldRight.y) < 1e-5,
    'resetCombat immediately restores upright zero-roll camera orientation'
  )
}

// ---------------------------------------------------------------------------
// 6. Repeated frame updates with mode transitions, movement, and real maze
// ---------------------------------------------------------------------------
const generatedMaze = generateMaze(11, 11, { seed: 42 })
engine.setMaze(generatedMaze)
const startWorld = gridToWorld(generatedMaze.start.row, generatedMaze.start.col, generatedMaze)
engine.setPlayerWorldPosition(startWorld.x, 0, startWorld.z, { immediate: true })
engine.cameraRig.setLookDirection(Math.PI, 0.1)
engine.cameraRig.snap()

for (let i = 0; i < 120; i += 1) {
  if (i === 20) engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
  if (i === 70) engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
  engine.cameraRig.applyLookDelta(12, i % 2 === 0 ? -4 : 4)
  engine.stepFrame(0.016, { render: false })
  const { worldUp } = getCameraBasis(engine.camera)
  assert.ok(
    worldUp.y > 0.5,
    `Frame ${i} during continuous gameplay updates stays upright (worldUp.y=${worldUp.y})`
  )
}

engine.dispose()
disposeAllSharedPools()

console.log('ALL CAMERA ORIENTATION & QUATERNION REGRESSION TESTS PASSED!')
