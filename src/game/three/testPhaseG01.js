import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  VIEW_MODES,
  getWindowViewMode,
  readViewModeFromSearch,
  syncViewQueryParam,
} from '../../utils/viewMode.js'
import { getDefaultPreferences, sanitizePreferences } from '../../utils/persistence.js'
import { requestSafePointerLock } from './fullscreenController.js'
import { DEFAULT_AUDIO_VOLUMES as CONFIG_DEFAULT_VOLUMES } from './threeConfig.js'
import { DEFAULT_AUDIO_VOLUMES as ENGINE_DEFAULT_VOLUMES } from './HorrorAudioEngine.js'

console.log('--- Running Phase G Prompt 01 Bundle Isolation, 3D Entry & Compatibility Suite ---')

// ---------------------------------------------------------------------------
// 1. Eager 3D Audio Import Removal & Bundle Isolation Verification
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Audio config extraction & 2D entry bundle isolation')

  assert.deepEqual(
    CONFIG_DEFAULT_VOLUMES,
    {
      master: 0.85,
      ambience: 0.55,
      effects: 0.85,
      music: 0.6,
      muted: false,
    },
    'DEFAULT_AUDIO_VOLUMES in threeConfig.js matches expected defaults'
  )
  assert.strictEqual(
    ENGINE_DEFAULT_VOLUMES,
    CONFIG_DEFAULT_VOLUMES,
    'HorrorAudioEngine.js re-exports DEFAULT_AUDIO_VOLUMES from threeConfig.js'
  )

  const defaults = getDefaultPreferences()
  assert.deepEqual(defaults.audioVolumes, CONFIG_DEFAULT_VOLUMES)
  const sanitized = sanitizePreferences({ audioVolumes: { master: 2.5, muted: true } })
  assert.equal(sanitized.audioVolumes.master, 1)
  assert.equal(sanitized.audioVolumes.muted, true)

  const persistenceSrc = fs.readFileSync(path.resolve('src/utils/persistence.js'), 'utf8')
  assert.equal(
    persistenceSrc.includes('HorrorAudioEngine'),
    false,
    'persistence.js must not import HorrorAudioEngine.js'
  )
  assert.equal(
    persistenceSrc.includes('audioSynthesis'),
    false,
    'persistence.js must not import audioSynthesis.js'
  )
  assert.ok(
    persistenceSrc.includes("from '../game/three/threeConfig.js'"),
    'persistence.js imports shared defaults from threeConfig.js'
  )

  const distAssetsDir = path.resolve('dist/assets')
  if (fs.existsSync(distAssetsDir)) {
    const assetFiles = fs.readdirSync(distAssetsDir)
    const entryJs = assetFiles.find((f) => /^index-.*\.js$/.test(f))
    const viewportJs = assetFiles.find((f) => /^MazeViewport3D-.*\.js$/.test(f))
    assert.ok(entryJs && viewportJs, 'Both index-*.js and MazeViewport3D-*.js chunks exist in dist/assets')

    const entryBundle = fs.readFileSync(path.join(distAssetsDir, entryJs), 'utf8')
    const viewportBundle = fs.readFileSync(path.join(distAssetsDir, viewportJs), 'utf8')

    // Entry chunk must dynamically reference the lazy 3D chunk
    assert.ok(
      entryBundle.includes(viewportJs),
      `2D entry chunk dynamically references lazy 3D chunk (${viewportJs})`
    )

    // 2D entry chunk must NOT contain Three.js or HorrorAudioEngine/audioSynthesis
    for (const forbiddenToken of [
      'WebGLRenderer',
      'PerspectiveCamera',
      'BufferGeometry',
      'playHorrorDirectorCue',
      'onHidingSpotTransition',
      'enemy_detect_chase',
      'createBiquadFilter',
      'HRTF',
    ]) {
      assert.equal(
        entryBundle.includes(forbiddenToken),
        false,
        `2D entry chunk must not contain ${forbiddenToken}`
      )
      assert.ok(
        viewportBundle.includes(forbiddenToken),
        `Lazy 3D chunk must contain ${forbiddenToken}`
      )
    }
  }

  console.log('✓ 2D entry bundle isolated from Three.js, HorrorAudioEngine, and audioSynthesis')
}

// ---------------------------------------------------------------------------
// 2. 3D Entry Button Visibility & URL Query Synchronization
// ---------------------------------------------------------------------------
{
  console.log('Test 2: 3D entry button flow & ?view=3d URL synchronization')

  const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
  assert.equal(
    appSrc.includes('hasOptedInto3D'),
    false,
    '3D Preview entry button must not be hidden behind hasOptedInto3D on initial 2D load'
  )
  assert.ok(
    appSrc.includes('{!is3DPreviewActive ? (') &&
      appSrc.includes('onClick={handleSwitchTo3D}') &&
      appSrc.includes('3D Preview'),
    'App.jsx renders a 3D Preview entry button in 2D mode wired to handleSwitchTo3D'
  )
  assert.ok(
    appSrc.includes("lazy(() => import('./components/game/MazeViewport3D'))") &&
      appSrc.includes('<Suspense') &&
      appSrc.includes('Switch to 2D') &&
      appSrc.includes('Retry 3D') &&
      appSrc.includes("addEventListener('popstate'"),
    'App.jsx preserves React.lazy + Suspense loading, fallback recovery, and popstate handling'
  )

  // Query parsing tests
  assert.equal(readViewModeFromSearch(''), VIEW_MODES.MODE_2D)
  assert.equal(readViewModeFromSearch(null), VIEW_MODES.MODE_2D)
  assert.equal(readViewModeFromSearch('?view=2d'), VIEW_MODES.MODE_2D)
  assert.equal(readViewModeFromSearch('?difficulty=large'), VIEW_MODES.MODE_2D)
  assert.equal(readViewModeFromSearch('?view=3d'), VIEW_MODES.MODE_3D)
  assert.equal(readViewModeFromSearch('?difficulty=small&view=3D'), VIEW_MODES.MODE_3D)

  assert.equal(getWindowViewMode(null), VIEW_MODES.MODE_2D)
  assert.equal(
    getWindowViewMode({ location: { search: '?view=3d' } }),
    VIEW_MODES.MODE_3D
  )

  // Query synchronization via history.replaceState
  let currentHref = 'https://example.com/?difficulty=medium'
  const historyCalls = []
  const mockWin = {
    location: {
      get href() {
        return currentHref
      },
      get search() {
        return new URL(currentHref).search
      },
    },
    history: {
      state: { scrollY: 42 },
      replaceState(state, _title, nextUrl) {
        historyCalls.push({ state, nextUrl })
        currentHref = nextUrl
      },
    },
  }

  assert.equal(syncViewQueryParam(VIEW_MODES.MODE_3D, mockWin), true)
  assert.equal(currentHref, 'https://example.com/?difficulty=medium&view=3d')
  assert.equal(getWindowViewMode(mockWin), VIEW_MODES.MODE_3D)
  assert.deepEqual(historyCalls[0].state, { scrollY: 42 })

  assert.equal(syncViewQueryParam(VIEW_MODES.MODE_2D, mockWin), true)
  assert.equal(currentHref, 'https://example.com/?difficulty=medium')
  assert.equal(getWindowViewMode(mockWin), VIEW_MODES.MODE_2D)

  // Defensive fallback when replaceState throws
  const restrictedWin = {
    location: { href: 'https://example.com/' },
    history: {
      state: null,
      replaceState() {
        throw new Error('SecurityError')
      },
    },
  }
  assert.equal(syncViewQueryParam(VIEW_MODES.MODE_3D, restrictedWin), false)

  console.log('✓ 3D entry button & URL query synchronization verified')
}

// ---------------------------------------------------------------------------
// 3. Pointer Lock Synchronous Throw & Asynchronous Promise Rejection Safety
// ---------------------------------------------------------------------------
{
  console.log('Test 3: requestSafePointerLock async Promise rejection & sync error safety')

  const unhandled = []
  const onUnhandled = (reason) => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    assert.equal(await requestSafePointerLock(null), false, 'Null element returns false')
    assert.equal(await requestSafePointerLock({}), false, 'Missing requestPointerLock returns false')

    const syncThrowEl = {
      requestPointerLock() {
        throw new Error('PointerLockNotAllowedError')
      },
    }
    assert.equal(
      await requestSafePointerLock(syncThrowEl),
      false,
      'Synchronous throw is caught and resolves to false'
    )

    const asyncRejectEl = {
      requestPointerLock() {
        return Promise.reject(
          new Error('The user has exited the lock before this request was completed.')
        )
      },
    }
    assert.equal(
      await requestSafePointerLock(asyncRejectEl),
      false,
      'Async Promise rejection is caught cleanly and resolves to false'
    )

    // Allow a tick so any unhandledRejection event would fire if unattached
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(
      unhandled.length,
      0,
      'Zero unhandledRejection events emitted when requestPointerLock rejects asynchronously'
    )

    const asyncResolveEl = {
      requestPointerLock() {
        return Promise.resolve()
      },
    }
    assert.equal(
      await requestSafePointerLock(asyncResolveEl),
      true,
      'Resolved Promise returns true'
    )

    const voidReturnEl = {
      requestPointerLock() {
        return undefined
      },
    }
    assert.equal(
      await requestSafePointerLock(voidReturnEl),
      true,
      'Legacy void return returns true'
    )

    const viewportSrc = fs.readFileSync(
      path.resolve('src/components/game/MazeViewport3D.jsx'),
      'utf8'
    )
    assert.ok(
      viewportSrc.includes('requestSafePointerLock(canvasHost)'),
      'MazeViewport3D.jsx uses requestSafePointerLock in click handler'
    )
    assert.ok(
      viewportSrc.includes('document.exitPointerLock'),
      'MazeViewport3D.jsx preserves existing exitPointerLock release logic'
    )
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }

  console.log('✓ Pointer Lock Promise rejection and sync error handling verified')
}

console.log('=== ALL PHASE G PROMPT 01 HARDENING TESTS PASSED! ===')
