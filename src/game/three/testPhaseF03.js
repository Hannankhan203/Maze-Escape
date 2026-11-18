import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  MINIMAP_LOGICAL_SIZE,
  MINIMAP_MAX_DPR,
  createExplorationState,
  renderMinimapCanvas,
  resolveMinimapDpr,
  syncMinimapCanvasResolution,
} from '../mechanics/minimap.js'
import { buildGameOverSummary } from '../mechanics/scoring.js'
import { formatElapsedTime } from '../mechanics/runTimer.js'
import {
  applyEnvironmentToScene,
  buildEnvironment,
  disposeEnvironment,
} from './buildEnvironment.js'
import {
  detectTouchPrimaryInput,
  shouldShowPointerLockHint,
} from './fullscreenController.js'

console.log('--- Running Phase F Prompt 03 Tests: Visual Polish, HiDPI Minimap & Mobile HUD ---')

// ---------------------------------------------------------------------------
// 1. HiDPI Minimap Scaling (DPR capped at 2) & Logical Coordinate Fidelity
// ---------------------------------------------------------------------------
{
  console.log('Test 1: HiDPI minimap scaling capped at 2 with intact logical coordinates')

  assert.equal(MINIMAP_LOGICAL_SIZE, 156)
  assert.equal(MINIMAP_MAX_DPR, 2)
  assert.equal(resolveMinimapDpr(undefined), 1)
  assert.equal(resolveMinimapDpr(0), 1)
  assert.equal(resolveMinimapDpr(0.75), 1)
  assert.equal(resolveMinimapDpr(1), 1)
  assert.equal(resolveMinimapDpr(1.5), 1.5)
  assert.equal(resolveMinimapDpr(2), 2)
  assert.equal(resolveMinimapDpr(3), 2, 'DPR > 2 must cap at 2')
  assert.equal(resolveMinimapDpr(4), 2, 'DPR 4 must cap at 2')

  const maze = generateMaze({ difficulty: 'small', seed: 991122 })
  const exploration = createExplorationState(maze)

  function createSpyCanvas() {
    const ops = []
    const transforms = []
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      setTransform(a, b, c, d, e, f) {
        transforms.push([a, b, c, d, e, f])
      },
      fillRect(x, y, w, h) {
        ops.push({ op: 'fillRect', x, y, w, h })
      },
      strokeRect(x, y, w, h) {
        ops.push({ op: 'strokeRect', x, y, w, h })
      },
      beginPath() {},
      arc(x, y, r) {
        ops.push({ op: 'arc', x, y, r })
      },
      moveTo(x, y) {
        ops.push({ op: 'moveTo', x, y })
      },
      lineTo(x, y) {
        ops.push({ op: 'lineTo', x, y })
      },
      closePath() {},
      fill() {},
      stroke() {},
    }
    return {
      width: MINIMAP_LOGICAL_SIZE,
      height: MINIMAP_LOGICAL_SIZE,
      style: { width: '', height: '' },
      getContext(type) {
        return type === '2d' ? ctx : null
      },
      ops,
      transforms,
    }
  }

  for (const [rawDpr, expectedDpr] of [
    [1, 1],
    [2, 2],
    [3, 2],
  ]) {
    const canvas = createSpyCanvas()
    const syncInfo = syncMinimapCanvasResolution(
      canvas,
      MINIMAP_LOGICAL_SIZE,
      rawDpr
    )
    assert.equal(syncInfo.dpr, expectedDpr)
    assert.equal(syncInfo.logicalSize, 156)
    assert.equal(canvas.width, 156 * expectedDpr)
    assert.equal(canvas.height, 156 * expectedDpr)
    // CSS style dimensions must remain untouched so stylesheet responsive rules apply
    assert.equal(canvas.style.width, '')
    assert.equal(canvas.style.height, '')

    const ok = renderMinimapCanvas(canvas, {
      maze,
      exploration,
      playerCell: maze.start,
      yaw: 0,
      coins: maze.collectibles.coins,
      powerUps: maze.collectibles.powerUps,
      keycards: maze.keycards,
      objectivesEnabled: true,
      isExitLocked: true,
      logicalSize: MINIMAP_LOGICAL_SIZE,
      dpr: expectedDpr,
    })
    assert.equal(ok, true)
    assert.deepEqual(canvas.transforms.at(-1), [expectedDpr, 0, 0, expectedDpr, 0, 0])

    // Background fillRect and all geometry must stay in logical [0..156] coordinates
    const bgRect = canvas.ops[0]
    assert.deepEqual(bgRect, { op: 'fillRect', x: 0, y: 0, w: 156, h: 156 })
    for (const entry of canvas.ops) {
      if ('x' in entry && 'y' in entry) {
        assert.ok(
          entry.x >= -2 && entry.x <= 158 && entry.y >= -2 && entry.y <= 158,
          `Drawing coordinate (${entry.x}, ${entry.y}) escaped logical 156x156 bounds at DPR=${rawDpr}`
        )
      }
    }
  }

  console.log('✓ HiDPI minimap scaling, cap at 2, and logical drawing bounds verified')
}

// ---------------------------------------------------------------------------
// 2. HUD Blur Removal & Mobile Layout Ergonomics (375x667 & 844x390)
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Performance HUD styling & mobile ergonomics CSS rules')

  const cssPath = path.resolve('src/styles/maze.css')
  const css = fs.readFileSync(cssPath, 'utf8')

  const extractRuleBlock = (selector) => {
    const idx = css.indexOf(`${selector} {`)
    assert.ok(idx !== -1, `Expected CSS rule for ${selector}`)
    const endIdx = css.indexOf('}', idx)
    return css.slice(idx, endIdx + 1)
  }

  for (const selector of [
    '.maze-vitals-hud',
    '.maze-fullscreen-btn',
    '.maze-fullscreen-hint',
  ]) {
    const block = extractRuleBlock(selector)
    assert.equal(
      /backdrop-filter\s*:/.test(block),
      false,
      `${selector} must not use expensive backdrop-filter`
    )
    assert.ok(
      /background-color\s*:/.test(block) && /border\s*:/.test(block),
      `${selector} must retain translucent background and border`
    )
  }

  // Verify portrait 375x667 and landscape 844x390 media blocks exist and keep bounds non-overlapping
  assert.ok(
    css.includes('@media (max-width: 479px)') &&
      css.includes('width: 90px;') &&
      css.includes('top: 2.35rem;'),
    'Expected compact portrait mobile minimap & HUD rules for 375x667'
  )
  assert.ok(
    css.includes('@media (max-height: 540px) and (orientation: landscape)') &&
      css.includes('right: 8rem;') &&
      css.includes('width: 84px;'),
    'Expected side-by-side landscape mobile minimap & HUD rules for 844x390'
  )

  console.log('✓ Backdrop-filter removal and 375x667 / 844x390 CSS rules verified')
}

// ---------------------------------------------------------------------------
// 3. Pointer-Lock Hint Visibility & Touch Input Detection
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Pointer-lock hint visibility & touch input detection')

  // Disabled pointer lock -> hidden
  assert.equal(
    shouldShowPointerLockHint({
      pointerLockEnabled: false,
      touchControlsMode: 'auto',
      isTouchDevice: false,
      hasUsedTouchControls: false,
      isInteractive: true,
    }),
    false
  )

  // Always-on touch controls -> hidden
  assert.equal(
    shouldShowPointerLockHint({
      pointerLockEnabled: true,
      touchControlsMode: 'always',
      isTouchDevice: false,
      hasUsedTouchControls: false,
      isInteractive: true,
    }),
    false
  )

  // Touch primary device -> hidden unless touchControlsMode === 'off'
  assert.equal(
    shouldShowPointerLockHint({
      pointerLockEnabled: true,
      touchControlsMode: 'auto',
      isTouchDevice: true,
      hasUsedTouchControls: false,
      isInteractive: true,
    }),
    false
  )

  // Active touch usage on hybrid device -> hidden
  assert.equal(
    shouldShowPointerLockHint({
      pointerLockEnabled: true,
      touchControlsMode: 'auto',
      isTouchDevice: false,
      hasUsedTouchControls: true,
      isInteractive: true,
    }),
    false
  )

  // Desktop mouse user with pointer lock enabled -> shown
  assert.equal(
    shouldShowPointerLockHint({
      pointerLockEnabled: true,
      touchControlsMode: 'auto',
      isTouchDevice: false,
      hasUsedTouchControls: false,
      isInteractive: true,
    }),
    true
  )

  // Hybrid desktop reporting fine hover pointer + maxTouchPoints must NOT auto-mark as touch-primary
  assert.equal(
    detectTouchPrimaryInput(
      {
        ontouchstart: null,
        matchMedia(query) {
          return { matches: query === '(hover: hover) and (pointer: fine)' }
        },
      },
      { maxTouchPoints: 5 }
    ),
    false
  )

  // Mobile coarse/no-hover viewport reports touch primary
  assert.equal(
    detectTouchPrimaryInput(
      {
        matchMedia(query) {
          return { matches: query === '(hover: none) and (pointer: coarse)' }
        },
      },
      { maxTouchPoints: 5 }
    ),
    true
  )

  console.log('✓ Pointer-lock hint visibility rules verified')
}

// ---------------------------------------------------------------------------
// 4. Flashlight Touch Button PointerDown Guard, Game Over Summary, Metadata & Env
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Flashlight touch handlers, Game Over summary, tooltip & metadata')

  const touchControlsSrc = fs.readFileSync(
    path.resolve('src/components/game/TouchControls3D.jsx'),
    'utf8'
  )
  assert.ok(
    touchControlsSrc.includes('handleFlashlightPointerDown') &&
      touchControlsSrc.includes('onPointerDown={handleFlashlightPointerDown}') &&
      touchControlsSrc.includes('flashlightStateRef'),
    'TouchControls3D must bind onPointerDown with duplicate-activation guard on flashlight button'
  )

  const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
  assert.equal(
    appSrc.includes('before Phase C'),
    false,
    'Stale "before Phase C" tooltip must be removed from App.jsx'
  )
  assert.ok(
    appSrc.includes('Survival Time') && appSrc.includes('Keycards Collected'),
    'Game Over modal must render Survival Time and Keycards Collected'
  )

  const summary = buildGameOverSummary({
    runId: 7,
    survivalTimeMs: 42350,
    moves: 31,
    coinsCollected: 4,
    totalCoins: 9,
    keysCollected: 2,
    totalKeys: 3,
    objectivesEnabled: true,
  })
  assert.deepEqual(summary, {
    runId: 7,
    survivalTimeMs: 42350,
    moves: 31,
    coinsCollected: 4,
    totalCoins: 9,
    keysCollected: 2,
    totalKeys: 3,
    objectivesEnabled: true,
  })
  assert.equal(formatElapsedTime(summary.survivalTimeMs), '00:42.3')

  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8')
  const metadata = JSON.parse(fs.readFileSync(path.resolve('metadata.json'), 'utf8'))
  assert.ok(indexHtml.includes(`<title>${metadata.name}</title>`))
  assert.ok(indexHtml.includes(metadata.description))
  assert.ok(indexHtml.includes('property="og:title"'))
  assert.ok(indexHtml.includes('property="og:description"'))
  assert.ok(indexHtml.includes('name="theme-color"'))

  // Headless environment lighting verification
  const env = buildEnvironment({ maze: generateMaze({ difficulty: 'small', seed: 1234 }) })
  const scene = new THREE.Scene()
  applyEnvironmentToScene(scene, env)
  assert.ok(env.lights.hemiLight.intensity > 0.72)
  assert.equal(disposeEnvironment(env, scene), true)

  console.log('✓ Flashlight touch guard, Game Over summary, metadata, and environment verified')
}

console.log('=== All Phase F Prompt 03 Tests Passed ===')
