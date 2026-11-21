import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createContinuousInputController } from '../../hooks/useContinuousInput.js'
import {
  STORAGE_KEYS,
  getDefaultAllSettings,
  loadAllSettings,
  resetAllSettings,
  saveAllSettings,
} from '../../utils/persistence.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  CAMERA_MODES,
  CameraRig,
  MAX_THIRD_PERSON_HEIGHT,
  THIRD_PERSON_CAMERA_DISTANCES,
  THIRD_PERSON_CAMERA_MODES,
} from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools } from './sharedResources.js'
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_THIRD_PERSON_CAMERA_DISTANCE,
  THIRD_PERSON_CAMERA_DISTANCE_ORDER,
  THIRD_PERSON_CAMERA_DISTANCE_VALUES,
  formatKeyTokenLabel,
  getNextThirdPersonCameraDistance,
  getThirdPersonCameraDistanceValue,
  isValidCustomKeyToken,
  normalizeKeyBindings,
  normalizeThirdPersonCameraDistance,
} from './threeConfig.js'

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

function createOpenRoomMaze(size = 9) {
  const grid = []
  for (let r = 0; r < size; r += 1) {
    const row = []
    for (let c = 0; c < size; c += 1) {
      row.push(r === 0 || c === 0 || r === size - 1 || c === size - 1 ? 1 : 0)
    }
    grid.push(row)
  }
  const mid = Math.floor(size / 2)
  return {
    rows: size,
    cols: size,
    width: size,
    height: size,
    start: { row: mid, col: mid },
    exit: { row: size - 2, col: size - 2 },
    grid,
  }
}

function createCorridorMaze() {
  return {
    rows: 7,
    cols: 7,
    width: 7,
    height: 7,
    start: { row: 3, col: 1 },
    exit: { row: 3, col: 5 },
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 0, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 0, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ],
  }
}

function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

function stepRig(rig, frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i += 1) {
    rig.update(dt)
  }
}

console.log('--- Running GTA-Style Third-Person Camera Distance Cycling Tests ---')

try {
  // 1. Default C key binding, distance order/values & validation
  {
    console.log('Test 1: Default C binding, preset order, distance values, and validation')

    assert.equal(DEFAULT_KEY_BINDINGS.cycleCameraDistance, 'c')
    assert.deepEqual(THIRD_PERSON_CAMERA_DISTANCE_ORDER, ['close', 'medium', 'far'])
    assert.equal(DEFAULT_THIRD_PERSON_CAMERA_DISTANCE, 'medium')

    const dClose = getThirdPersonCameraDistanceValue(THIRD_PERSON_CAMERA_DISTANCES.CLOSE)
    const dMedium = getThirdPersonCameraDistanceValue(THIRD_PERSON_CAMERA_DISTANCES.MEDIUM)
    const dFar = getThirdPersonCameraDistanceValue(THIRD_PERSON_CAMERA_DISTANCES.FAR)

    assert.equal(dClose, 2.4)
    assert.equal(dMedium, 4.2)
    assert.equal(dFar, 6.2)
    assert.ok(dClose < dMedium && dMedium < dFar, 'Close < Medium < Far distances are distinct')
    assert.deepEqual(THIRD_PERSON_CAMERA_DISTANCE_VALUES, {
      close: 2.4,
      medium: 4.2,
      far: 6.2,
    })

    // Helper cycle order: close -> medium -> far -> close
    assert.equal(getNextThirdPersonCameraDistance('close'), 'medium')
    assert.equal(getNextThirdPersonCameraDistance('medium'), 'far')
    assert.equal(getNextThirdPersonCameraDistance('far'), 'close')
    assert.equal(normalizeThirdPersonCameraDistance('invalid'), 'medium')

    // Validation & normalization of custom key bindings
    assert.equal(isValidCustomKeyToken('c'), true)
    assert.equal(isValidCustomKeyToken('v'), true)
    assert.equal(isValidCustomKeyToken('tab'), true)
    assert.equal(isValidCustomKeyToken('w'), true, 'Gameplay key W is customizable across actions')
    assert.equal(isValidCustomKeyToken('shiftleft'), true, 'Shift is customizable across actions')
    assert.equal(isValidCustomKeyToken('space'), true, 'Space is customizable across actions')
    assert.equal(isValidCustomKeyToken('f'), true, 'Interact key F is customizable across actions')
    assert.equal(isValidCustomKeyToken('l'), true, 'Flashlight key L is customizable across actions')
    assert.equal(isValidCustomKeyToken('m'), true, 'M is customizable across actions')
    assert.equal(isValidCustomKeyToken('h'), true, 'Wayfinder key H is customizable across actions')
    assert.equal(isValidCustomKeyToken('p'), true, 'Pause key P is customizable across actions')
    assert.equal(isValidCustomKeyToken('escape'), false, 'Escape key cannot be bound')
    assert.equal(isValidCustomKeyToken('control'), false, 'Modifier Control cannot be bound')
    assert.equal(isValidCustomKeyToken('alt'), false, 'Modifier Alt cannot be bound')
    assert.equal(isValidCustomKeyToken('meta'), false, 'Modifier Meta cannot be bound')
    assert.equal(isValidCustomKeyToken('f5'), false, 'Browser reload key F5 cannot be bound')
    assert.equal(isValidCustomKeyToken('f12'), false, 'DevTools key F12 cannot be bound')
    assert.equal(isValidCustomKeyToken('capslock'), false, 'CapsLock cannot be bound')
    assert.equal(formatKeyTokenLabel('c'), 'C')
    assert.equal(formatKeyTokenLabel('v'), 'V')
    assert.equal(formatKeyTokenLabel('tab'), 'Tab')

    // Conflict resolution without creating duplicates: if moveForward holds W, cycleCameraDistance falls back to C
    assert.deepEqual(normalizeKeyBindings({ cycleCameraDistance: 'W' }), {
      ...DEFAULT_KEY_BINDINGS,
      cycleCameraDistance: 'c',
    })
    // Valid free key overrides cleanly
    assert.deepEqual(normalizeKeyBindings({ cycleCameraDistance: ' V ' }), {
      ...DEFAULT_KEY_BINDINGS,
      cycleCameraDistance: 'v',
    })
    // Assigning W to cycleCameraDistance succeeds when moveForward moves to another key
    assert.deepEqual(
      normalizeKeyBindings({ moveForward: 'i', cycleCameraDistance: 'w' }),
      {
        ...DEFAULT_KEY_BINDINGS,
        moveForward: 'i',
        cycleCameraDistance: 'w',
      }
    )
  }

  // 2. Close -> Medium -> Far -> Close cycling & settled distances in both 3P modes
  {
    console.log('Test 2: Close -> Medium -> Far -> Close cycling in Character Follow and Free Look')

    for (const tpMode of [
      THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
      THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
    ]) {
      const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 400)
      const rig = new CameraRig(camera, {
        mode: CAMERA_MODES.THIRD_PERSON,
        thirdPersonCameraMode: tpMode,
        cameraDistancePreset: THIRD_PERSON_CAMERA_DISTANCES.CLOSE,
      })
      rig.setPlayerPosition(0, 0, 0)
      rig.setLookDirection(0, 0)
      rig.snap()

      assert.equal(rig.getCameraDistancePreset(), 'close')
      assert.equal(rig.getFollowDistance(), 2.4)

      const sequence = ['medium', 'far', 'close', 'medium', 'far', 'close']
      const settledPlanarDist = {}

      for (const expected of sequence) {
        const next = rig.cycleCameraDistance()
        assert.equal(next, expected, `[${tpMode}] cycles cleanly to ${expected}`)
        assert.equal(rig.getCameraDistancePreset(), expected)
        stepRig(rig, 90, 1 / 60)

        const horizDist = Math.hypot(camera.position.x, camera.position.z)
        settledPlanarDist[expected] = horizDist
      }

      assert.ok(
        settledPlanarDist.close < settledPlanarDist.medium - 1.2 &&
          settledPlanarDist.medium < settledPlanarDist.far - 1.4,
        `[${tpMode}] three camera distances are clearly distinct (${settledPlanarDist.close.toFixed(2)}m < ${settledPlanarDist.medium.toFixed(2)}m < ${settledPlanarDist.far.toFixed(2)}m)`
      )
      assert.ok(
        Math.abs(settledPlanarDist.close - 2.4) < 0.15 ||
          tpMode === THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
        `[${tpMode}] settled Close matches target`
      )
      rig.dispose()
    }
  }

  // 3. Smooth transitions (no abrupt single-frame snap, monotonic easing, rapid cycles)
  {
    console.log('Test 3: Smooth multi-frame transitions without snapping')

    for (const tpMode of [
      THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
      THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
    ]) {
      const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 400)
      const rig = new CameraRig(camera, {
        mode: CAMERA_MODES.THIRD_PERSON,
        thirdPersonCameraMode: tpMode,
        cameraDistancePreset: THIRD_PERSON_CAMERA_DISTANCES.CLOSE,
      })
      rig.setPlayerPosition(0, 0, 0)
      rig.setLookDirection(0, 0)
      rig.snap()

      const distAtClose = camera.position.z

      // Close -> Medium
      rig.cycleCameraDistance()
      const samples = [distAtClose]
      for (let i = 0; i < 30; i += 1) {
        rig.update(1 / 60)
        samples.push(camera.position.z)
      }

      const firstStepDelta = samples[1] - samples[0]
      const totalDelta = samples[samples.length - 1] - samples[0]
      assert.ok(firstStepDelta > 0.01, `[${tpMode}] immediately begins moving after cycling`)
      assert.ok(
        firstStepDelta < totalDelta * 0.3,
        `[${tpMode}] does not snap abruptly on frame 1 (${firstStepDelta.toFixed(3)} vs ${totalDelta.toFixed(3)})`
      )
      for (let i = 1; i < samples.length; i += 1) {
        assert.ok(
          samples[i] >= samples[i - 1] - 1e-6,
          `[${tpMode}] Close -> Medium distance increases monotonically at frame ${i}`
        )
      }

      // Settle at Far, then test Far -> Close smooth contraction
      rig.cycleCameraDistance()
      stepRig(rig, 90, 1 / 60)
      const distAtFar = camera.position.z

      rig.cycleCameraDistance() // far -> close
      const shrinkSamples = [distAtFar]
      for (let i = 0; i < 30; i += 1) {
        rig.update(1 / 60)
        shrinkSamples.push(camera.position.z)
      }
      const firstShrinkDelta = shrinkSamples[0] - shrinkSamples[1]
      const totalShrinkDelta = shrinkSamples[0] - shrinkSamples[shrinkSamples.length - 1]
      assert.ok(firstShrinkDelta > 0.01, `[${tpMode}] Far -> Close begins contracting`)
      assert.ok(
        firstShrinkDelta < totalShrinkDelta * 0.3,
        `[${tpMode}] Far -> Close transitions smoothly instead of snapping`
      )
      for (let i = 1; i < shrinkSamples.length; i += 1) {
        assert.ok(
          shrinkSamples[i] <= shrinkSamples[i - 1] + 1e-6,
          `[${tpMode}] Far -> Close distance decreases monotonically at frame ${i}`
        )
      }

      // Rapid mid-transition cycling remains finite and converges to final target
      rig.cycleCameraDistance() // close -> medium
      stepRig(rig, 3, 1 / 60)
      rig.cycleCameraDistance() // medium -> far
      stepRig(rig, 3, 1 / 60)
      assert.equal(rig.getCameraDistancePreset(), 'far')
      stepRig(rig, 90, 1 / 60)
      assert.ok(Number.isFinite(camera.position.z) && camera.position.z > 5.8)

      rig.dispose()
    }
  }

  // 4. Wall, corner & ceiling collision safety across Close / Medium / Far
  {
    console.log('Test 4: Wall, corner, and height collision clamping across all 3 distances')

    const maze = createCorridorMaze()
    const cornerMaze = createOpenRoomMaze(9)
    const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 400)

    for (const tpMode of [
      THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
      THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
    ]) {
      const rig = new CameraRig(camera, {
        mode: CAMERA_MODES.THIRD_PERSON,
        thirdPersonCameraMode: tpMode,
      })

      // Narrow corridor dead-end test
      rig.setMaze(maze)
      const corridorCenter = gridToWorld(3, 1, maze)
      rig.setPlayerPosition(corridorCenter.x, 0, corridorCenter.z)
      rig.setLookDirection(-Math.PI / 2, 0.15) // Facing East with West wall right behind player
      rig.snap()

      for (const preset of ['close', 'medium', 'far', 'close']) {
        rig.setCameraDistancePreset(preset)
        for (let frame = 0; frame < 45; frame += 1) {
          rig.update(1 / 60)
          assert.equal(
            rig._isCircleClear(
              camera.position.x,
              camera.position.z,
              rig._getCameraCollisionRadius()
            ),
            true,
            `[${tpMode}] preset=${preset} frame=${frame} never clips into corridor walls`
          )
          assert.ok(
            camera.position.y <= MAX_THIRD_PERSON_HEIGHT + 1e-4,
            `[${tpMode}] preset=${preset} frame=${frame} stays <= ceiling height`
          )
        }
      }

      // Corner & rotated walking test across all 3 presets
      rig.setMaze(cornerMaze)
      const nearCorner = gridToWorld(1, 1, cornerMaze)
      for (const preset of ['close', 'medium', 'far']) {
        rig.setCameraDistancePreset(preset)
        for (let step = 0; step < 36; step += 1) {
          const t = step / 36
          rig.setPlayerPosition(nearCorner.x + t * 2.0, 0, nearCorner.z + t * 1.5)
          rig.applyLookDelta(25, (step % 4 === 0 ? -15 : 8))
          rig.update(1 / 60)
          assert.equal(
            rig._isCircleClear(
              camera.position.x,
              camera.position.z,
              rig._getCameraCollisionRadius()
            ),
            true,
            `[${tpMode}] moving near corner at ${preset} step=${step} remains collision-free`
          )
          assert.ok(
            camera.position.y >= 0.15 && camera.position.y <= MAX_THIRD_PERSON_HEIGHT + 1e-4,
            `[${tpMode}] camera height valid (${camera.position.y.toFixed(2)})`
          )
        }
      }

      rig.dispose()
    }
  }

  // 5. Preserving camera modes, animations & movement while cycling C and custom keys
  {
    console.log('Test 5: Input controller C/custom key handling & non-interference with controls')

    let cycleCalls = 0
    let flashlightCalls = 0
    let wayfinderCalls = 0
    let interactCalls = 0
    const abilityCalls = []

    const ctrl = createContinuousInputController({
      onCycleCameraDistance: () => {
        cycleCalls += 1
      },
      onToggleFlashlight: () => {
        flashlightCalls += 1
      },
      onTriggerWayfinder: () => {
        wayfinderCalls += 1
      },
      onInteract: () => {
        interactCalls += 1
      },
      onActivateAbility: (type) => {
        abilityCalls.push(type)
      },
    })

    // Hold W + ShiftLeft to sprint forward
    ctrl.handleKeyDown({ key: 'w', code: 'KeyW' })
    ctrl.handleKeyDown({ key: 'Shift', code: 'ShiftLeft' })
    assert.equal(ctrl.state.forward, true)
    assert.equal(ctrl.state.sprint, true)

    // Press C while sprinting (browser sends uppercase 'C' with shiftKey: true)
    ctrl.handleKeyDown({ key: 'C', code: 'KeyC', shiftKey: true, repeat: false })
    assert.equal(cycleCalls, 1, 'Pressing C while sprinting triggers camera distance cycle')
    assert.equal(ctrl.state.forward, true, 'Walking/forward input stays uninterrupted')
    assert.equal(ctrl.state.sprint, true, 'Sprint input stays uninterrupted')

    // Held auto-repeat C must NOT spam cycles
    ctrl.handleKeyDown({ key: 'C', code: 'KeyC', shiftKey: true, repeat: true })
    assert.equal(cycleCalls, 1, 'Keydown auto-repeat ignored for camera distance cycle')

    // Ctrl+C / Meta+C / editable targets ignored
    ctrl.handleKeyDown({ key: 'c', ctrlKey: true })
    ctrl.handleKeyDown({ key: 'c', metaKey: true })
    ctrl.handleKeyDown({ key: 'c', target: { tagName: 'INPUT' } })
    assert.equal(cycleCalls, 1, 'Modifier shortcuts and text inputs do not trigger cycle')

    // Existing controls still work untouched (and M has no minimap side effect)
    ctrl.handleKeyDown({ key: 'l', shiftKey: true })
    ctrl.handleKeyDown({ key: 'm', shiftKey: true })
    ctrl.handleKeyDown({ key: 'h', shiftKey: true })
    ctrl.handleKeyDown({ key: 'f', shiftKey: true })
    ctrl.handleKeyDown({ key: 'e', shiftKey: true })
    assert.equal(flashlightCalls, 1)
    assert.equal(wayfinderCalls, 1)
    assert.equal(interactCalls, 1)
    assert.equal(abilityCalls.length, 1)

    // Release sprint/forward
    ctrl.handleKeyUp({ key: 'Shift', code: 'ShiftLeft', shiftKey: false })
    ctrl.handleKeyUp({ key: 'w', code: 'KeyW', shiftKey: false })
    assert.equal(ctrl.state.sprint, false)
    assert.equal(ctrl.state.forward, false)

    // Custom key binding update ('v')
    ctrl.setKeyBindings({ cycleCameraDistance: 'v' })
    ctrl.handleKeyDown({ key: 'c', repeat: false })
    assert.equal(cycleCalls, 1, 'Default C stops firing after rebinding to V')
    ctrl.handleKeyDown({ key: 'v', repeat: false })
    assert.equal(cycleCalls, 2, 'Custom binding V triggers camera distance cycle')
    ctrl.handleKeyDown({ key: 'V', shiftKey: true, repeat: false })
    assert.equal(cycleCalls, 3, 'Uppercase V with Shift triggers custom binding')
  }

  // 6. MazeSceneEngine mode preservation, unrelated config preservation & player/maze stability
  {
    console.log('Test 6: MazeSceneEngine distance cycling & mode/character/config preservation')

    const maze = createOpenRoomMaze(9)
    const callbacks = []
    const engine = createHeadlessEngine({
      cameraMode: CAMERA_MODES.THIRD_PERSON,
      thirdPersonCameraMode: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
      onCameraDistanceChange: (preset, dist) => callbacks.push({ preset, dist }),
    })
    engine.setMaze(maze)

    const initialPlayerGroup = engine.getPlayer()
    const initialWorldPos = engine.getPlayerWorldPosition()

    assert.equal(engine.getCameraDistancePreset(), 'medium')
    assert.equal(engine.getCameraFollowDistance(), 4.2)

    assert.equal(engine.cycleCameraDistance(), 'far')
    assert.equal(engine.cycleCameraDistance(), 'close')
    assert.equal(engine.getCameraDistancePreset(), 'close')
    assert.equal(engine.getCameraFollowDistance(), 2.4)
    assert.deepEqual(callbacks, [
      { preset: 'far', dist: 6.2 },
      { preset: 'close', dist: 2.4 },
    ])

    // Unrelated camera config updates (FOV, invertY, sensitivity, shake) must NOT clobber active distance
    engine.updateCameraConfig({
      fov: 75,
      invertY: true,
      sensitivity: 0.003,
      cameraShake: false,
    })
    assert.equal(engine.getCameraDistancePreset(), 'close')
    assert.equal(engine.getCameraFollowDistance(), 2.4)

    // Toggling First-Person and back to Third-Person preserves chosen Close distance
    engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
    assert.equal(engine.getCameraRig().getMode(), CAMERA_MODES.FIRST_PERSON)
    engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
    assert.equal(engine.getCameraRig().getMode(), CAMERA_MODES.THIRD_PERSON)
    assert.equal(engine.getCameraDistancePreset(), 'close')
    assert.equal(engine.getCameraFollowDistance(), 2.4)

    // Player group & position remain untouched
    assert.equal(engine.getPlayer(), initialPlayerGroup)
    assert.deepEqual(engine.getPlayerWorldPosition(), initialWorldPos)

    engine.dispose()
  }

  // 7. Persistence round-trip for keyBindings in maze-escape:settings:v1
  {
    console.log('Test 7: Persistence round-trip and Reset Defaults for keyBindings')

    const storage = createMemoryStorage()
    const defaults = getDefaultAllSettings()
    assert.deepEqual(defaults.controls.keyBindings, DEFAULT_KEY_BINDINGS)

    const custom = {
      ...defaults,
      controls: {
        ...defaults.controls,
        keyBindings: { cycleCameraDistance: 'g' },
      },
    }
    const saved = saveAllSettings(custom, storage)
    assert.equal(saved.saved, true)
    assert.equal(saved.settings.controls.keyBindings.cycleCameraDistance, 'g')

    const loaded = loadAllSettings(storage)
    assert.equal(loaded.controls.keyBindings.cycleCameraDistance, 'g')

    // Invalid/reserved key in raw storage is sanitized safely back to C
    storage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        version: 2,
        controls: { keyBindings: { cycleCameraDistance: 'w' } },
      })
    )
    assert.equal(
      loadAllSettings(storage).controls.keyBindings.cycleCameraDistance,
      'c',
      'Reserved key in storage sanitizes safely back to C'
    )

    const reset = resetAllSettings(storage)
    assert.equal(reset.settings.controls.keyBindings.cycleCameraDistance, 'c')
  }

  console.log('=== ALL CAMERA DISTANCE CYCLING TESTS PASSED! ===')
} finally {
  disposeAllSharedPools()
}
