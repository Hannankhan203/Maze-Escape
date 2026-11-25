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
      items: maze.collectibles.items,
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

  // Rectangular GTA San Andreas radar backing resolution (154x124) preserves aspect ratio without stretching
  const rectCanvas = createSpyCanvas()
  const rectSync = syncMinimapCanvasResolution(rectCanvas, { width: 154, height: 124 }, 2)
  assert.equal(rectSync.dpr, 2)
  assert.equal(rectSync.logicalWidth, 154)
  assert.equal(rectSync.logicalHeight, 124)
  assert.equal(rectCanvas.width, 308)
  assert.equal(rectCanvas.height, 248)
  const rectOk = renderMinimapCanvas(rectCanvas, {
    maze,
    exploration,
    playerCell: maze.start,
    yaw: 0,
    logicalWidth: 154,
    logicalHeight: 124,
    dpr: 2,
  })
  assert.equal(rectOk, true)
  assert.deepEqual(rectCanvas.ops[0], { op: 'fillRect', x: 0, y: 0, w: 154, h: 124 })

  console.log('✓ HiDPI minimap scaling, cap at 2, rectangular aspect ratio, and logical drawing bounds verified')
}

// ---------------------------------------------------------------------------
// 2. HUD Blur Removal, Stage Canvas Scoping & Classic GTA Radar Dimensions
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Performance HUD styling, stage canvas specificity fix & classic GTA minimap dimensions')

  const cssPath = path.resolve('src/styles/maze.css')
  const css = fs.readFileSync(cssPath, 'utf8')

  const extractRuleBlock = (selector, source = css) => {
    const idx = source.indexOf(`${selector} {`)
    assert.ok(idx !== -1, `Expected CSS rule for ${selector}`)
    const endIdx = source.indexOf('}', idx)
    return source.slice(idx, endIdx + 1)
  }

  const extractMediaSection = (header) => {
    const sections = []
    let searchFrom = 0
    while (searchFrom < css.length) {
      const startIdx = css.indexOf(header, searchFrom)
      if (startIdx === -1) break
      const openBrace = css.indexOf('{', startIdx)
      assert.ok(openBrace !== -1, `Expected opening brace for ${header}`)
      let depth = 0
      let closedAt = -1
      for (let i = openBrace; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1
        else if (css[i] === '}') {
          depth -= 1
          if (depth === 0) {
            sections.push(css.slice(openBrace + 1, i))
            closedAt = i + 1
            break
          }
        }
      }
      assert.ok(closedAt !== -1, `Unclosed media query block: ${header}`)
      searchFrom = closedAt
    }
    assert.ok(sections.length > 0, `Expected media query ${header}`)
    return sections.join('\n')
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

  const vitalsHudBlock = extractRuleBlock('.maze-vitals-hud')
  assert.ok(
    /display\s*:\s*grid/.test(vitalsHudBlock) &&
      /grid-template-columns\s*:\s*repeat\(2\b/.test(vitalsHudBlock),
    '.maze-vitals-hud must use a compact 2-column grid layout'
  )

  // Root cause fix: stage canvas rule MUST use direct child combinator (>) so it never overrides .maze-minimap__canvas
  assert.equal(
    /\.maze-viewport-3d__stage\s+canvas\s*\{/.test(css),
    false,
    'Descendant `.maze-viewport-3d__stage canvas` selector must NOT exist (was overriding minimap canvas size)'
  )
  const stageCanvasBlock = extractRuleBlock('.maze-viewport-3d__stage > canvas')
  assert.ok(
    stageCanvasBlock.includes('width: 100%;') && stageCanvasBlock.includes('height: 100%;'),
    '.maze-viewport-3d__stage > canvas must target only the direct WebGL canvas child'
  )

  // Desktop (>= 1024px): 160x130 outer, 154x124 canvas (2px padding + 1px border each side = 6px)
  const minimapBlock = extractRuleBlock('.maze-minimap')
  assert.ok(
    /left\s*:/.test(minimapBlock) &&
      /bottom\s*:/.test(minimapBlock) &&
      minimapBlock.includes('env(safe-area-inset-left') &&
      minimapBlock.includes('env(safe-area-inset-bottom') &&
      minimapBlock.includes('box-sizing: border-box;') &&
      minimapBlock.includes('width: 160px;') &&
      minimapBlock.includes('height: 130px;') &&
      minimapBlock.includes('max-width: 160px;') &&
      minimapBlock.includes('max-height: 130px;') &&
      /pointer-events\s*:\s*none/.test(minimapBlock),
    '.maze-minimap desktop outer container must be strictly 160x130px at bottom-left with safe-area insets'
  )

  const minimapBodyBlock = extractRuleBlock('.maze-minimap__body')
  assert.ok(
    minimapBodyBlock.includes('box-sizing: border-box;') &&
      minimapBodyBlock.includes('width: 100%;') &&
      minimapBodyBlock.includes('height: 100%;') &&
      minimapBodyBlock.includes('padding: 2px;') &&
      minimapBodyBlock.includes('border: 1px solid') &&
      minimapBodyBlock.includes('border-radius: 9px;') &&
      minimapBodyBlock.includes('overflow: hidden;'),
    '.maze-minimap__body must fit 100% of outer container using border-box with 2px padding + 1px border'
  )

  const minimapCanvasBlock = extractRuleBlock('.maze-minimap__body > .maze-minimap__canvas,\n.maze-minimap__canvas')
  assert.ok(
    minimapCanvasBlock.includes('box-sizing: border-box;') &&
      minimapCanvasBlock.includes('width: 154px;') &&
      minimapCanvasBlock.includes('height: 124px;') &&
      minimapCanvasBlock.includes('max-width: 100%;') &&
      minimapCanvasBlock.includes('max-height: 100%;') &&
      minimapCanvasBlock.includes('border: 0;') &&
      minimapCanvasBlock.includes('border-radius: 6px;'),
    '.maze-minimap__canvas must be strictly 154x124px inside 160x130px desktop outer frame'
  )

  const hintBannerBlock = extractRuleBlock('.maze-minimap__hint-banner')
  assert.ok(
    hintBannerBlock.includes('position: absolute;') &&
      hintBannerBlock.includes('bottom: calc(100% + 0.25rem);'),
    'Wayfinder hint banner must float out-of-flow above minimap so it never expands outer container'
  )

  // Verify exact responsive overrides in cascade order across Tablet, Mobile Portrait, and Mobile Landscape
  const tabletMedia = extractMediaSection('@media (max-width: 1023px)')
  const tabletOuter = extractRuleBlock('.maze-minimap', tabletMedia)
  const tabletCanvas = extractRuleBlock('.maze-minimap__body > .maze-minimap__canvas,\n  .maze-minimap__canvas', tabletMedia)
  assert.ok(
    tabletOuter.includes('width: 140px;') &&
      tabletOuter.includes('height: 114px;') &&
      tabletOuter.includes('max-width: 140px;') &&
      tabletOuter.includes('max-height: 114px;') &&
      tabletCanvas.includes('width: 134px;') &&
      tabletCanvas.includes('height: 108px;'),
    'Tablet (<= 1023px) must constrain minimap outer to 140x114px and canvas to 134x108px'
  )

  const small640Media = extractMediaSection('@media (max-width: 640px)')
  assert.equal(
    small640Media.includes('.maze-minimap__canvas'),
    false,
    '@media (max-width: 640px) must not override tablet 140x114 / 134x108 dimensions'
  )

  const portraitMedia = extractMediaSection('@media (max-width: 479px)')
  const portraitOuter = extractRuleBlock('.maze-minimap', portraitMedia)
  const portraitCanvas = extractRuleBlock('.maze-minimap__body > .maze-minimap__canvas,\n  .maze-minimap__canvas', portraitMedia)
  assert.ok(
    portraitOuter.includes('width: 120px;') &&
      portraitOuter.includes('height: 98px;') &&
      portraitOuter.includes('max-width: 120px;') &&
      portraitOuter.includes('max-height: 98px;') &&
      portraitCanvas.includes('width: 114px;') &&
      portraitCanvas.includes('height: 92px;') &&
      portraitMedia.includes('+ 5.45rem'),
    'Mobile portrait (375x667, <= 479px) must constrain minimap outer to 120x98px and canvas to 114x92px above joystick'
  )

  const landscapeMedia = extractMediaSection('@media (max-height: 540px) and (orientation: landscape)')
  const landscapeOuter = extractRuleBlock('.maze-minimap', landscapeMedia)
  const landscapeCanvas = extractRuleBlock('.maze-minimap__body > .maze-minimap__canvas,\n  .maze-minimap__canvas', landscapeMedia)
  assert.ok(
    landscapeOuter.includes('width: 112px;') &&
      landscapeOuter.includes('height: 90px;') &&
      landscapeOuter.includes('max-width: 112px;') &&
      landscapeOuter.includes('max-height: 90px;') &&
      landscapeCanvas.includes('width: 106px;') &&
      landscapeCanvas.includes('height: 84px;') &&
      landscapeMedia.includes('+ 5.25rem') &&
      landscapeMedia.includes('.maze-fullscreen-btn') &&
      landscapeMedia.includes('width: 2rem;'),
    'Mobile landscape (844x390) must constrain minimap outer to 112x90px and canvas to 106x84px beside joystick'
  )

  // Verify cascade order: base (Desktop 160px) -> Tablet (140px) -> Portrait (120px) -> Landscape (112px)
  const idxBase = css.indexOf('max-width: 160px;')
  const idxTablet = css.indexOf('max-width: 140px;')
  const idxPortrait = css.indexOf('max-width: 120px;')
  const idxLandscape = css.indexOf('max-width: 112px;')
  assert.ok(
    idxBase < idxTablet && idxTablet < idxPortrait && idxPortrait < idxLandscape,
    'Minimap responsive breakpoints must cascade in strict priority order'
  )

  // Programmatically resolve active outer & canvas CSS sizes at all 4 target viewports
  const resolveViewportMinimapSizes = (vw, vh) => {
    const outer = { width: null, height: null, maxWidth: null, maxHeight: null }
    const canvas = { width: null, height: null }
    const applyBlock = (block, target) => {
      const w = block.match(/(?:^|[\s;{])width:\s*(\d+)px;/)
      const h = block.match(/(?:^|[\s;{])height:\s*(\d+)px;/)
      const mw = block.match(/max-width:\s*(\d+)px;/)
      const mh = block.match(/max-height:\s*(\d+)px;/)
      if (w) target.width = Number(w[1])
      if (h) target.height = Number(h[1])
      if (mw) target.maxWidth = Number(mw[1])
      if (mh) target.maxHeight = Number(mh[1])
    }
    applyBlock(minimapBlock, outer)
    applyBlock(minimapCanvasBlock, canvas)
    if (vw <= 1023) {
      applyBlock(tabletOuter, outer)
      applyBlock(tabletCanvas, canvas)
    }
    if (vw <= 479) {
      applyBlock(portraitOuter, outer)
      applyBlock(portraitCanvas, canvas)
    }
    if (vh <= 540 && vw > vh) {
      applyBlock(landscapeOuter, outer)
      applyBlock(landscapeCanvas, canvas)
    }
    return { outer, canvas }
  }

  for (const [label, vw, vh, expOuterW, expOuterH, expCanvasW, expCanvasH] of [
    ['Desktop', 1280, 800, 160, 130, 154, 124],
    ['Tablet', 768, 1024, 140, 114, 134, 108],
    ['Mobile Portrait', 375, 667, 120, 98, 114, 92],
    ['Mobile Landscape', 844, 390, 112, 90, 106, 84],
  ]) {
    const res = resolveViewportMinimapSizes(vw, vh)
    assert.equal(res.outer.width, expOuterW, `${label} outer width = ${expOuterW}px`)
    assert.equal(res.outer.height, expOuterH, `${label} outer height = ${expOuterH}px`)
    assert.equal(res.outer.maxWidth, expOuterW, `${label} outer max-width = ${expOuterW}px`)
    assert.equal(res.outer.maxHeight, expOuterH, `${label} outer max-height = ${expOuterH}px`)
    assert.ok(res.outer.width > res.outer.height, `${label} preserves wider-than-tall GTA San Andreas proportion`)
    assert.equal(res.canvas.width, expCanvasW, `${label} canvas width = ${expCanvasW}px`)
    assert.equal(res.canvas.height, expCanvasH, `${label} canvas height = ${expCanvasH}px`)
    assert.equal(res.canvas.width + 6, res.outer.width, `${label} canvas width + chrome fits exactly inside outer`)
    assert.equal(res.canvas.height + 6, res.outer.height, `${label} canvas height + chrome fits exactly inside outer`)
  }

  console.log('✓ Stage canvas specificity fix and GTA San Andreas 160x130 / 140x114 / 120x98 / 112x90 minimap CSS rules verified')
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
    appSrc.includes('Claimed by the Dark') &&
      appSrc.includes('Keycards Collected') &&
      appSrc.includes('Soul Shards') &&
      appSrc.includes('Try Again'),
    'Game Over modal must render atmospheric title, Keycards Collected, Soul Shards, and Try Again'
  )
  assert.equal(
    appSrc.includes('Vault Breached') ||
      appSrc.includes('Survival Time') ||
      appSrc.includes('>Moves<') ||
      appSrc.includes('Moves / Par'),
    false,
    'Vault Breached, Survival Time, and Moves must be removed from App.jsx'
  )

  const summary = buildGameOverSummary({
    runId: 7,
    survivalTimeMs: 42350,
    moves: 31,
    shardsCollected: 4,
    totalShards: 9,
    keysCollected: 2,
    totalKeys: 3,
    objectivesEnabled: true,
  })
  assert.deepEqual(summary, {
    runId: 7,
    shardsCollected: 4,
    totalShards: 9,
    keysCollected: 2,
    totalKeys: 3,
    objectivesEnabled: true,
  })
  assert.equal(summary.survivalTimeMs, undefined)
  assert.equal(summary.moves, undefined)

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
