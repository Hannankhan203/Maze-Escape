import * as THREE from 'three'
import {
  createFullscreenController,
  getFullscreenElement,
  isFullscreenSupported,
  resolveShowTouchControls,
} from './fullscreenController.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createFakeEventTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, fn, options) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add({ fn, capture: Boolean(options === true || options?.capture) })
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type)
      if (!set) return
      for (const entry of set) {
        if (entry.fn === fn) set.delete(entry)
      }
    },
    dispatchEvent(event) {
      const set = listeners.get(event?.type)
      if (!set) return
      for (const entry of [...set]) {
        entry.fn(event)
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0
    },
  }
}

function createFakeFullscreenEnv({
  supported = true,
  initialWidth = 800,
  initialHeight = 500,
  fullscreenWidth = 1920,
  fullscreenHeight = 1080,
} = {}) {
  const docTarget = createFakeEventTarget()
  const winTarget = createFakeEventTarget()

  const canvasHost = {
    clientWidth: initialWidth,
    clientHeight: initialHeight,
    appendChild() {},
    removeChild() {},
  }

  const rootEl = {
    clientWidth: initialWidth,
    clientHeight: initialHeight,
    contains(node) {
      return node === rootEl || node === canvasHost
    },
  }

  const unrelatedEl = {
    clientWidth: 300,
    clientHeight: 200,
    contains(node) {
      return node === unrelatedEl
    },
  }

  const doc = {
    fullscreenEnabled: supported,
    fullscreenElement: null,
    pointerLockElement: null,
    exitPointerLockCalls: 0,
    exitFullscreenCalls: 0,
    addEventListener: docTarget.addEventListener,
    removeEventListener: docTarget.removeEventListener,
    dispatchEvent: docTarget.dispatchEvent,
    listenerCount: docTarget.listenerCount,
    exitPointerLock() {
      doc.exitPointerLockCalls += 1
      doc.pointerLockElement = null
      doc.dispatchEvent({ type: 'pointerlockchange' })
    },
  }

  const win = {
    addEventListener: winTarget.addEventListener,
    removeEventListener: winTarget.removeEventListener,
    dispatchEvent: winTarget.dispatchEvent,
    listenerCount: winTarget.listenerCount,
  }

  if (supported) {
    rootEl.requestFullscreen = async () => {
      doc.fullscreenElement = rootEl
      rootEl.clientWidth = fullscreenWidth
      rootEl.clientHeight = fullscreenHeight
      canvasHost.clientWidth = fullscreenWidth
      canvasHost.clientHeight = fullscreenHeight
      doc.dispatchEvent({ type: 'fullscreenchange' })
    }
    doc.exitFullscreen = async () => {
      doc.exitFullscreenCalls += 1
      doc.fullscreenElement = null
      rootEl.clientWidth = initialWidth
      rootEl.clientHeight = initialHeight
      canvasHost.clientWidth = initialWidth
      canvasHost.clientHeight = initialHeight
      doc.dispatchEvent({ type: 'fullscreenchange' })
    }
  }

  return { doc, win, rootEl, canvasHost, unrelatedEl }
}

async function runTests() {
  console.log('Running Phase E 3D Fullscreen Mode Tests...')

  // 1. Fullscreen enter/exit state synchronization via fullscreenchange
  {
    const env = createFakeFullscreenEnv({ supported: true })
    const snapshots = []
    const resizes = []

    const controller = createFullscreenController({
      getElement: () => env.rootEl,
      getCanvasHost: () => env.canvasHost,
      doc: env.doc,
      win: env.win,
      escHintDurationMs: 3000,
      onStateChange: (state) => snapshots.push(state),
      onResize: (dims) => resizes.push(dims),
    })

    assert(controller.getState().supported === true, 'Test 1: Supported is true')
    assert(controller.getState().isFullscreen === false, 'Test 1: Initially not fullscreen')
    assert(controller.getState().showEscHint === false, 'Test 1: Initially no ESC hint')

    // Another unrelated element entering fullscreen should NOT mark our viewport fullscreen
    env.doc.fullscreenElement = env.unrelatedEl
    env.doc.dispatchEvent({ type: 'fullscreenchange' })
    assert(
      controller.getState().isFullscreen === false,
      'Test 1: Unrelated fullscreenElement keeps viewport isFullscreen=false'
    )
    env.doc.fullscreenElement = null
    env.doc.dispatchEvent({ type: 'fullscreenchange' })

    // Enter fullscreen via toggle
    const enterRes = await controller.toggleFullscreen()
    assert(enterRes.ok === true, 'Test 1: toggleFullscreen enters fullscreen cleanly')
    assert(controller.getState().isFullscreen === true, 'Test 1: State synced to fullscreen=true')
    assert(controller.getState().showEscHint === true, 'Test 1: ESC hint enabled on enter')
    assert(snapshots.at(-1).isFullscreen === true, 'Test 1: React listener received isFullscreen=true')

    // External browser fullscreenchange exit (e.g. native browser ESC) syncs state back
    env.doc.fullscreenElement = null
    env.rootEl.clientWidth = 800
    env.rootEl.clientHeight = 500
    env.canvasHost.clientWidth = 800
    env.canvasHost.clientHeight = 500
    env.doc.dispatchEvent({ type: 'fullscreenchange' })

    assert(controller.getState().isFullscreen === false, 'Test 1: External fullscreenchange resets isFullscreen=false')
    assert(controller.getState().showEscHint === false, 'Test 1: External exit clears ESC hint immediately')
    assert(resizes.length >= 2, 'Test 1: Resize emitted on enter and exit')

    controller.dispose()
    assert(env.doc.listenerCount('fullscreenchange') === 0, 'Test 1: Document listeners cleaned up on dispose')
    assert(env.win.listenerCount('keydown') === 0, 'Test 1: Window listeners cleaned up on dispose')
    console.log('✓ Test 1 passed: Fullscreen enter/exit synchronization & cleanup')
  }

  // 2. Touch controls hiding during fullscreen and immediate restoration on exit
  {
    assert(
      resolveShowTouchControls({ touchControlsMode: 'auto', isInteractive: true, isFullscreen: false }) === true,
      'Test 2: Touch controls shown in auto mode when interactive and not fullscreen'
    )
    assert(
      resolveShowTouchControls({ touchControlsMode: 'always', isInteractive: true, isFullscreen: false }) === true,
      'Test 2: Touch controls shown in always mode when interactive and not fullscreen'
    )
    assert(
      resolveShowTouchControls({ touchControlsMode: 'auto', isInteractive: true, isFullscreen: true }) === false,
      'Test 2: Touch controls hidden in auto mode while fullscreen'
    )
    assert(
      resolveShowTouchControls({ touchControlsMode: 'always', isInteractive: true, isFullscreen: true }) === false,
      'Test 2: Touch controls hidden even in always mode while fullscreen'
    )
    assert(
      resolveShowTouchControls({ touchControlsMode: 'off', isInteractive: true, isFullscreen: false }) === false,
      'Test 2: Touch controls remain hidden when mode is off after exiting fullscreen'
    )
    assert(
      resolveShowTouchControls({ touchControlsMode: 'auto', isInteractive: false, isFullscreen: false }) === false,
      'Test 2: Touch controls remain hidden when not interactive after exiting fullscreen'
    )
    console.log('✓ Test 2 passed: Touch controls hide during fullscreen & restore per settings')
  }

  // 3. ESC hint visibility timing and timer cleanup on dispose
  {
    const env = createFakeFullscreenEnv({ supported: true })
    const snapshots = []

    const controller = createFullscreenController({
      getElement: () => env.rootEl,
      getCanvasHost: () => env.canvasHost,
      doc: env.doc,
      win: env.win,
      escHintDurationMs: 45,
      onStateChange: (state) => snapshots.push(state),
    })

    await controller.enterFullscreen()
    assert(controller.getState().showEscHint === true, 'Test 3: ESC hint visible immediately upon entering')

    await new Promise((resolve) => setTimeout(resolve, 90))
    assert(controller.getState().isFullscreen === true, 'Test 3: Still fullscreen after ESC hint expires')
    assert(controller.getState().showEscHint === false, 'Test 3: ESC hint clears automatically after duration')

    // Re-enter and dispose before timer expires -> no callback should fire after dispose
    await controller.exitFullscreen()
    await controller.enterFullscreen()
    assert(controller.getState().showEscHint === true, 'Test 3: ESC hint visible on second entry')
    const countAtDispose = snapshots.length
    controller.dispose()

    await new Promise((resolve) => setTimeout(resolve, 90))
    assert(
      snapshots.length === countAtDispose,
      'Test 3: Disposing clears pending ESC hint timer with zero post-dispose emissions'
    )
    console.log('✓ Test 3 passed: ESC hint timing & timer cleanup')
  }

  // 4. Unsupported Fullscreen API defensive fallback
  {
    const env = createFakeFullscreenEnv({ supported: false })
    assert(
      isFullscreenSupported(env.rootEl, env.doc) === false,
      'Test 4: isFullscreenSupported returns false when API missing/disabled'
    )
    assert(getFullscreenElement(null) === null, 'Test 4: getFullscreenElement handles null doc safely')

    const controller = createFullscreenController({
      getElement: () => env.rootEl,
      getCanvasHost: () => env.canvasHost,
      doc: env.doc,
      win: env.win,
    })

    assert(controller.getState().supported === false, 'Test 4: Controller reports supported=false')
    const res = await controller.toggleFullscreen()
    assert(res.ok === false && res.reason === 'unsupported', 'Test 4: Toggle returns unsupported safely')
    assert(controller.getState().isFullscreen === false, 'Test 4: Remains non-fullscreen')
    controller.dispose()
    console.log('✓ Test 4 passed: Unsupported Fullscreen API fallback')
  }

  // 5. Pointer Lock + Escape interaction
  {
    const env = createFakeFullscreenEnv({ supported: true })
    const controller = createFullscreenController({
      getElement: () => env.rootEl,
      getCanvasHost: () => env.canvasHost,
      doc: env.doc,
      win: env.win,
    })

    // Outside fullscreen: Escape must NOT interfere with pointer lock
    env.doc.pointerLockElement = env.canvasHost
    env.win.dispatchEvent({ key: 'Escape', code: 'Escape', type: 'keydown' })
    assert(
      env.doc.exitPointerLockCalls === 0,
      'Test 5: Escape outside fullscreen does not interfere with pointer lock'
    )
    assert(
      env.doc.fullscreenElement === null,
      'Test 5: Outside fullscreen remains non-fullscreen on Escape'
    )

    // Inside fullscreen with Pointer Lock active: Escape releases pointer lock AND exits fullscreen
    await controller.enterFullscreen()
    env.doc.pointerLockElement = env.canvasHost
    env.win.dispatchEvent({ key: 'Escape', code: 'Escape', type: 'keydown' })
    await Promise.resolve()

    assert(
      env.doc.exitPointerLockCalls === 1,
      'Test 5: Escape during fullscreen + pointer lock exits pointer lock'
    )
    assert(
      env.doc.exitFullscreenCalls === 1,
      'Test 5: Escape during fullscreen + pointer lock exits fullscreen'
    )
    assert(
      controller.getState().isFullscreen === false,
      'Test 5: Controller state synced back to non-fullscreen after Escape'
    )

    controller.dispose()
    console.log('✓ Test 5 passed: Pointer Lock & Escape interaction')
  }

  // 6. Renderer & Camera aspect ratio resize handling on fullscreen transitions
  {
    const env = createFakeFullscreenEnv({
      supported: true,
      initialWidth: 800,
      initialHeight: 500,
      fullscreenWidth: 1600,
      fullscreenHeight: 900,
    })

    const rendererSizes = []
    const fakeRenderer = {
      domElement: { parentNode: null },
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1,
      setPixelRatio() {},
      setSize(w, h, updateStyle) {
        rendererSizes.push({ w, h, updateStyle })
      },
      render() {},
      dispose() {},
    }

    const engine = new MazeSceneEngine(env.canvasHost, {
      isSoftwareGl: true,
      createRenderer: () => fakeRenderer,
    })

    const controller = createFullscreenController({
      getElement: () => env.rootEl,
      getCanvasHost: () => env.canvasHost,
      doc: env.doc,
      win: env.win,
      onResize: ({ width, height }) => {
        engine.resize(width, height)
      },
    })

    const initialAspect = engine.camera.aspect
    assert(Math.abs(initialAspect - 800 / 500) < 1e-5, 'Test 6: Initial aspect is 1.6')

    await controller.enterFullscreen()
    const fsAspect = engine.camera.aspect
    const lastEnterSize = rendererSizes.at(-1)
    assert(
      Math.abs(fsAspect - 1600 / 900) < 1e-5,
      `Test 6: Camera aspect updated on fullscreen enter (got ${fsAspect})`
    )
    assert(
      lastEnterSize?.w === 1600 && lastEnterSize?.h === 900,
      'Test 6: Renderer resized to fullscreen dimensions'
    )

    await controller.exitFullscreen()
    const restoredAspect = engine.camera.aspect
    const lastExitSize = rendererSizes.at(-1)
    assert(
      Math.abs(restoredAspect - 800 / 500) < 1e-5,
      `Test 6: Camera aspect restored on fullscreen exit (got ${restoredAspect})`
    )
    assert(
      lastExitSize?.w === 800 && lastExitSize?.h === 500,
      'Test 6: Renderer restored to viewport dimensions'
    )

    controller.dispose()
    engine.dispose()
    console.log('✓ Test 6 passed: Renderer & camera aspect resize on fullscreen enter/exit')
  }

  console.log('ALL 6 FULLSCREEN MODE TEST SUITES PASSED SUCCESSFULLY!')
}

await runTests()
