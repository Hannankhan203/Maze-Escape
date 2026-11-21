import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  CAMERA_MODES,
  CameraRig,
  THIRD_PERSON_CAMERA_MODES,
} from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools } from './sharedResources.js'
import {
  DEFAULT_THIRD_PERSON_CAMERA_MODE,
  normalizeThirdPersonCameraMode,
} from './threeConfig.js'
import {
  STORAGE_KEYS,
  getDefaultAllSettings,
  loadAllSettings,
  resetAllSettings,
  saveAllSettings,
} from '../../utils/persistence.js'

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

function normalizeAngleDiff(a, b) {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

console.log('--- Running Third-Person Camera Modes (Character Follow & Free Look) Tests ---')

// ---------------------------------------------------------------------------
// 1. Constants & Config Normalization
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Third-person mode constants & persistence normalization')
  assert.equal(THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW, 'character-follow')
  assert.equal(THIRD_PERSON_CAMERA_MODES.FREE_LOOK, 'free-look')
  assert.equal(DEFAULT_THIRD_PERSON_CAMERA_MODE, 'character-follow')
  assert.equal(normalizeThirdPersonCameraMode('free-look'), 'free-look')
  assert.equal(normalizeThirdPersonCameraMode('character-follow'), 'character-follow')
  assert.equal(normalizeThirdPersonCameraMode('invalid'), 'character-follow')

  const mem = new Map()
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  }

  const defaults = getDefaultAllSettings()
  assert.equal(defaults.gameplay.thirdPersonCameraMode, 'character-follow')

  const saved = saveAllSettings(
    {
      ...defaults,
      gameplay: {
        ...defaults.gameplay,
        cameraMode: CAMERA_MODES.THIRD_PERSON,
        thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
      },
    },
    storage
  )
  assert.equal(saved.saved, true)
  const reloaded = loadAllSettings(storage)
  assert.equal(reloaded.gameplay.cameraMode, CAMERA_MODES.THIRD_PERSON)
  assert.equal(reloaded.gameplay.thirdPersonCameraMode, THIRD_PERSON_CAMERA_MODES.FREE_LOOK)

  mem.set(
    STORAGE_KEYS.SETTINGS,
    JSON.stringify({
      gameplay: {
        cameraMode: CAMERA_MODES.THIRD_PERSON,
        thirdPersonCameraMode: 'bogus-mode',
      },
    })
  )
  assert.equal(
    loadAllSettings(storage).gameplay.thirdPersonCameraMode,
    THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW
  )

  const resetRes = resetAllSettings(storage)
  assert.equal(
    resetRes.settings.gameplay.thirdPersonCameraMode,
    THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW
  )
  console.log('✓ Third-person mode constants and persistence verified')
}

// ---------------------------------------------------------------------------
// 2. Character Follow Mode (Existing behavior preserved)
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Character Follow mode rotates camera and character together')
  const openMaze = {
    width: 11,
    height: 11,
    start: { row: 5, col: 5 },
    exit: { row: 9, col: 9 },
    grid: Array.from({ length: 11 }, (_, r) =>
      Array.from({ length: 11 }, (_, c) =>
        r === 0 || r === 10 || c === 0 || c === 10 ? 1 : 0
      )
    ),
  }

  const engine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
    enemies: { autoSpawn: false },
    audio: { enabled: false },
  })
  engine.setMaze(openMaze)
  engine.clearHazards()

  const center = gridToWorld(5, 5, openMaze)
  engine.setPlayerWorldPosition(center.x, 0, center.z, { yaw: 0, pitch: 0, immediate: true })

  const player = engine.getPlayer()
  assert.ok(player, 'Player mesh exists in 3D engine')
  assert.equal(player.visible, true, 'Player visible in third-person mode')
  assert.equal(
    engine.getThirdPersonCameraMode(),
    THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW
  )

  const initialYaw = player.rotation.y
  engine.applyLookDelta(200, -40, { sensitivity: 0.0022 })
  stepFrames(engine, 40, 0.016)

  const afterYaw = player.rotation.y
  const lookDir = engine.cameraRig.getLookDirection()
  const camDir = engine.cameraRig.getCameraLookDirection()

  assert.ok(
    Math.abs(normalizeAngleDiff(afterYaw, initialYaw)) > 0.35,
    'Character Follow rotates player yaw with mouse look delta'
  )
  assert.ok(
    Math.abs(normalizeAngleDiff(afterYaw, lookDir.yaw)) < 1e-5,
    'Player mesh yaw stays synced with look yaw'
  )
  assert.ok(
    Math.abs(normalizeAngleDiff(camDir.yaw, lookDir.yaw)) < 1e-5,
    'Camera yaw matches character yaw in Character Follow mode'
  )
  assert.ok(
    engine.camera.position.y >= 0.35 - 1e-5 && engine.camera.position.y <= 2.75 + 1e-5,
    'Character Follow preserves vertical height bounds [0.35, 2.75]'
  )

  engine.dispose()
  disposeAllSharedPools()
  console.log('✓ Character Follow mode behavior preserved')
}

// ---------------------------------------------------------------------------
// 3. Free Look Mode: Full 360 horizontal + above/below views, zero character rotation
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Free Look mode orbits full sphere around centered character without rotating player')
  const openCam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 200)
  const rig = new CameraRig(openCam, {
    mode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonMode: THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
    followDistance: 4.2,
    freeLookTargetHeight: 1.05,
  })
  rig.setPlayerPosition(2, 0, -3)
  rig.setLookDirection(0.4, 0)
  rig.snap()

  const pivot = new THREE.Vector3(2, 1.05, -3)

  // Viewpoints: back (relative 0), right (+pi/2), front (+pi), left (-pi/2), above, below
  const orbitCases = [
    { name: 'Back (0 deg)', dYaw: 0, dPitch: 0 },
    { name: 'Right (90 deg)', dYaw: Math.PI / 2, dPitch: 0 },
    { name: 'Front (180 deg)', dYaw: Math.PI, dPitch: 0 },
    { name: 'Left (270 deg)', dYaw: (3 * Math.PI) / 2, dPitch: 0 },
    { name: 'Above (near vertical down)', dYaw: Math.PI * 0.25, dPitch: -1.5 },
    { name: 'Below (near vertical up)', dYaw: -Math.PI * 0.65, dPitch: 1.5 },
  ]

  for (const testCase of orbitCases) {
    // Reset orbit to baseline then apply delta via applyLookDelta
    rig.setLookDirection(0.4, 0)
    rig.snap()

    const sens = 0.01
    // Negative deltaX increases yaw; negative deltaY increases pitch
    rig.applyLookDelta(-testCase.dYaw / sens, -testCase.dPitch / sens, {
      sensitivity: sens,
    })

    for (let i = 0; i < 60; i += 1) {
      rig.update(0.016)
    }

    // 1. Character orientation must NEVER change from orbit input
    const charDir = rig.getCharacterDirection()
    const lookDir = rig.getLookDirection()
    assert.ok(
      Math.abs(charDir.yaw - 0.4) < 1e-6 && Math.abs(lookDir.yaw - 0.4) < 1e-6,
      `${testCase.name}: character orientation stayed invariant (got ${charDir.yaw})`
    )

    // 2. Character stays centered: vector from camera -> pivot aligns with camera forward
    const toPivot = pivot.clone().sub(openCam.position)
    const dist = toPivot.length()
    assert.ok(
      Math.abs(dist - 4.2) < 0.05,
      `${testCase.name}: camera maintains followDistance ~4.2m (got ${dist.toFixed(3)})`
    )
    toPivot.normalize()
    const { worldFwd, worldRight, worldUp } = getCameraBasis(openCam)
    const centerDot = toPivot.dot(worldFwd)
    assert.ok(
      centerDot > 0.999,
      `${testCase.name}: character center remains centered in viewport (dot=${centerDot.toFixed(6)})`
    )
    assert.ok(
      Math.abs(worldRight.y) < 1e-5 && worldUp.y > 0,
      `${testCase.name}: camera maintains zero roll and upright worldUp.y (rightY=${worldRight.y}, upY=${worldUp.y})`
    )
  }

  // Explicitly verify above has camera.y >> pivot.y and below has camera.y << pivot.y
  rig.setLookDirection(0, 0)
  rig.snap()
  rig.applyLookDelta(0, 1500, { sensitivity: 0.001 }) // dy > 0 decreases pitch -> above character looking down
  for (let i = 0; i < 60; i += 1) rig.update(0.016)
  assert.ok(
    openCam.position.y > pivot.y + 3.8,
    `Above view places camera high overhead (y=${openCam.position.y.toFixed(2)})`
  )

  rig.setLookDirection(0, 0)
  rig.snap()
  rig.applyLookDelta(0, -1500, { sensitivity: 0.001 }) // dy < 0 increases pitch -> below character looking up
  for (let i = 0; i < 60; i += 1) rig.update(0.016)
  assert.ok(
    openCam.position.y < pivot.y - 3.8,
    `Below view places camera beneath character looking up (y=${openCam.position.y.toFixed(2)})`
  )

  rig.dispose()
  console.log('✓ Free Look 360° & above/below centered orbit verified')
}

// ---------------------------------------------------------------------------
// 4. Free Look inside Maze: Engine invariance, movement, animation, & environment collision
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Free Look engine integration, wall/floor/ceiling clipping prevention & movement')
  const openRoomMaze = {
    width: 11,
    height: 11,
    start: { row: 5, col: 5 },
    exit: { row: 9, col: 9 },
    grid: Array.from({ length: 11 }, (_, r) =>
      Array.from({ length: 11 }, (_, c) =>
        r === 0 || r === 10 || c === 0 || c === 10 ? 1 : 0
      )
    ),
  }

  const engine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
    enemies: { autoSpawn: false },
    audio: { enabled: false },
  })
  engine.setMaze(openRoomMaze)
  engine.clearHazards()

  const center = gridToWorld(5, 5, openRoomMaze)
  const initialYaw = -Math.PI / 2 // Facing East (+X)
  engine.setPlayerWorldPosition(center.x, 0, center.z, {
    yaw: initialYaw,
    pitch: 0,
    immediate: true,
  })

  const player = engine.getPlayer()
  const posBeforeOrbit = { ...engine.getPlayerWorldPosition() }

  // Orbit 180° around to look directly at the character's FRONT, then tilt up & down
  engine.applyLookDelta(-Math.PI / 0.0022, 0, { sensitivity: 0.0022 })
  stepFrames(engine, 50, 0.016)

  assert.ok(
    Math.abs(player.rotation.y - initialYaw) < 1e-6,
    'Front orbit does not rotate player mesh'
  )
  const posAfterOrbit = engine.getPlayerWorldPosition()
  assert.deepEqual(
    posAfterOrbit,
    posBeforeOrbit,
    'Orbiting camera does not move player position'
  )

  // Camera must be sitting IN FRONT (+X side) of player looking toward -X
  assert.ok(
    engine.camera.position.x > posBeforeOrbit.x + 3.0,
    `Front orbit places camera in front (+X) of East-facing player (camX=${engine.camera.position.x.toFixed(2)}, px=${posBeforeOrbit.x.toFixed(2)})`
  )
  const { worldFwd } = getCameraBasis(engine.camera)
  assert.ok(
    worldFwd.x < -0.9,
    `Camera looks back toward character front (-X) (fwdX=${worldFwd.x.toFixed(2)})`
  )

  // Pitch down (above) and pitch up (below) inside enclosed maze -> stays clear of floor & ceiling
  for (const dy of [1200, -2400]) {
    engine.applyLookDelta(0, dy, { sensitivity: 0.002 })
    stepFrames(engine, 40, 0.016)
    assert.ok(
      engine.camera.position.y >= 0.16 - 1e-5,
      `Free Look inside maze never clips below floor (camY=${engine.camera.position.y.toFixed(3)})`
    )
    assert.ok(
      engine.camera.position.y <= 2.75 + 1e-5,
      `Free Look inside maze never clips into ceiling (camY=${engine.camera.position.y.toFixed(3)})`
    )
    assert.ok(
      engine.cameraRig._isCircleClear(
        engine.camera.position.x,
        engine.camera.position.z,
        0.3
      ),
      'Free Look inside maze remains clear of all walls vertically tilted'
    )
  }

  // Test wall collision avoidance when player stands close to North perimeter wall (row 1)
  const nearWall = gridToWorld(1, 5, openRoomMaze)
  engine.setPlayerWorldPosition(nearWall.x, 0, nearWall.z, {
    yaw: Math.PI, // Facing South (+Z)
    pitch: 0,
    immediate: true,
  })
  // Orbit behind (to North wall side, -Z) and check wall clearance
  for (let s = 0; s < 16; s += 1) {
    engine.applyLookDelta(Math.PI / 8 / 0.01, 0, { sensitivity: 0.01 })
    stepFrames(engine, 12, 0.016)
    assert.ok(
      engine.cameraRig._isCircleClear(
        engine.camera.position.x,
        engine.camera.position.z,
        0.3
      ),
      `Near-wall Free Look orbit step ${s} prevents wall clipping`
    )
  }

  // Test movement, animation & collision while camera is viewing character from front/side
  engine.setPlayerWorldPosition(center.x, 0, center.z, {
    yaw: 0, // Facing North (-Z)
    pitch: 0,
    immediate: true,
  })
  // Orbit 180 deg to view character from the FRONT while they walk North
  engine.applyLookDelta(-Math.PI / 0.01, 0, { sensitivity: 0.01 })
  stepFrames(engine, 30, 0.016)
  assert.ok(Math.abs(player.rotation.y) < 1e-6, 'Player still faces North (0)')

  let animMovedSteps = 0
  for (let i = 0; i < 20; i += 1) {
    const moveRes = engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.016)
    engine.cameraRig.update(0.016)
    assert.ok(moveRes.moved, 'Character walks forward in Free Look mode')
    const animState = engine.getPlayerAnimationState()
    if (animState?.state === 'walk' && animState?.locomotionWeight > 0) {
      animMovedSteps += 1
    }
  }
  assert.ok(animMovedSteps > 0, 'PlayerAnimator animates walking while in Free Look')
  const walkedPos = engine.getPlayerWorldPosition()
  assert.ok(
    walkedPos.z < center.z - 1.0,
    `Pressing W walks North along character facing even while camera looks from front (z=${walkedPos.z.toFixed(2)})`
  )
  assert.ok(
    Math.abs(player.rotation.y) < 1e-6,
    'Walking forward preserves character facing in Free Look'
  )

  engine.dispose()
  disposeAllSharedPools()
  console.log('✓ Free Look engine integration, movement, animation & clipping prevention verified')
}

// ---------------------------------------------------------------------------
// 5. Seamless Mode Switching & First-Person -> Third-Person Activation
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Seamless mode switching & FP -> TP activation with selected mode')
  const genMaze = generateMaze(11, 11, { seed: 77 })
  const engine = createHeadlessEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
    thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
    enemies: { autoSpawn: false },
    audio: { enabled: false },
  })
  engine.setMaze(genMaze)
  engine.clearHazards()

  const startWorld = gridToWorld(genMaze.start.row, genMaze.start.col, genMaze)
  engine.setPlayerWorldPosition(startWorld.x, 0, startWorld.z, {
    yaw: 0.5,
    pitch: 0.1,
    immediate: true,
  })

  // Step forward a bit first
  for (let i = 0; i < 8; i += 1) {
    engine.stepMovement({ forwardAxis: 1, strafeAxis: 0, sprint: false }, 0.016)
  }
  const savedPos = engine.getPlayerWorldPosition()
  const savedCell = engine.getPlayerGridCell()

  // Activate Third-Person while Free Look is selected -> Free Look must be active immediately!
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
  assert.equal(engine.cameraRig.getMode(), CAMERA_MODES.THIRD_PERSON)
  assert.equal(engine.getThirdPersonCameraMode(), THIRD_PERSON_CAMERA_MODES.FREE_LOOK)
  assert.equal(engine.cameraRig.isFreeLookActive(), true)
  stepFrames(engine, 35, 0.016)

  // Rotate camera independently -> player yaw remains 0.5, position unchanged
  engine.applyLookDelta(180, -30, { sensitivity: 0.0022 })
  stepFrames(engine, 30, 0.016)
  assert.ok(
    Math.abs(engine.getPlayer().rotation.y - 0.5) < 1e-6,
    'After FP->TP activation in Free Look, mouse orbits camera without rotating player'
  )
  assert.deepEqual(engine.getPlayerWorldPosition(), savedPos)

  // Seamlessly switch to Character Follow mid-run -> no position/maze reset, smooth transition
  engine.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW)
  assert.equal(
    engine.getThirdPersonCameraMode(),
    THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW
  )
  assert.equal(engine.cameraRig._transitioning, true, 'Smooth camera transition engaged on switch')
  assert.deepEqual(engine.getPlayerWorldPosition(), savedPos, 'Player world pos preserved on mode switch')
  assert.deepEqual(engine.getPlayerGridCell(), savedCell, 'Player cell preserved on mode switch')
  assert.equal(engine._currentMaze, genMaze, 'Maze instance preserved without reset')

  stepFrames(engine, 35, 0.016)
  assert.equal(engine.cameraRig._transitioning, false, 'Seamless transition completes')

  // In Character Follow, look delta now rotates BOTH camera & character together
  engine.applyLookDelta(150, 0, { sensitivity: 0.0022 })
  stepFrames(engine, 25, 0.016)
  assert.ok(
    Math.abs(engine.getPlayer().rotation.y - 0.5) > 0.2,
    'After switching back to Character Follow, mouse rotates character with camera'
  )

  // Seamlessly switch back to Free Look mid-run
  const yawBeforeFreeLook = engine.getPlayer().rotation.y
  engine.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK)
  assert.equal(engine.cameraRig.isFreeLookActive(), true)
  stepFrames(engine, 30, 0.016)
  engine.applyLookDelta(200, 20, { sensitivity: 0.0022 })
  stepFrames(engine, 20, 0.016)
  assert.ok(
    Math.abs(engine.getPlayer().rotation.y - yawBeforeFreeLook) < 1e-6,
    'After seamless switch back to Free Look, character maintains its orientation'
  )

  engine.dispose()
  disposeAllSharedPools()
  console.log('✓ Seamless mode switching & FP -> TP activation verified')
}

console.log('=== ALL THIRD-PERSON CAMERA MODES TESTS PASSED! ===')
