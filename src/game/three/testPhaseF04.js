import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { handleModalEscapeKey } from '../../components/common/modalEscape.js'
import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  MINIMAP_LOGICAL_SIZE,
  MINIMAP_MAX_DPR,
  createExplorationState,
  renderMinimapCanvas,
  resolveMinimapDpr,
  syncMinimapCanvasResolution,
} from '../mechanics/minimap.js'
import { POWERUP_TYPES } from '../mechanics/powerups.js'
import { formatElapsedTime } from '../mechanics/runTimer.js'
import { buildGameOverSummary } from '../mechanics/scoring.js'
import { CAMERA_MODES } from './CameraRig.js'
import {
  MazeSceneEngine,
  computeAdaptiveFrameDelayMs,
  resolvePerformanceProfile,
} from './MazeSceneEngine.js'
import {
  disposeAllSharedPools,
  getActiveSharedPoolOwnerCount,
} from './sharedResources.js'
import { getCollectiblePoolStats } from './buildCollectibles.js'
import { getEnemyPoolStats } from './buildEnemy.js'
import { getHazardPoolStats } from './buildHazards.js'
import { getHidingSpotPoolStats } from './buildHidingSpots.js'

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
  const engine = new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    ...config,
  })
  return { engine, mockRenderer }
}

console.log('--- Running Phase F Prompt 04 Hardening & Release Audit Regression Suite ---')

// ---------------------------------------------------------------------------
// 1. Lazy 3D Loading & Static Import Boundary Verification
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Lazy 3D loading & 2D entry bundle isolation')

  const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
  assert.ok(
    appSrc.includes("lazy(() => import('./components/game/MazeViewport3D'))"),
    'App.jsx must lazy-load MazeViewport3D via React.lazy'
  )
  assert.equal(
    /from\s+['"]three['"]/.test(appSrc),
    false,
    'App.jsx must not eagerly import Three.js'
  )
  assert.equal(
    /import\s+[^'"]*MazeViewport3D/.test(appSrc),
    false,
    'App.jsx must not statically import MazeViewport3D'
  )

  const entryModules = [
    'src/main.jsx',
    'src/App.jsx',
    'src/components/game/MazeBoard.jsx',
    'src/components/game/GameHUD.jsx',
    'src/components/game/Player.jsx',
    'src/components/layout/GameShell.jsx',
    'src/components/layout/ScreenHeader.jsx',
    'src/game/engine/gameReducer.js',
    'src/game/three/threeConfig.js',
  ]
  for (const modPath of entryModules) {
    const src = fs.readFileSync(path.resolve(modPath), 'utf8')
    assert.equal(
      /from\s+['"]three['"]/.test(src),
      false,
      `${modPath} must not statically import Three.js`
    )
  }

  // If production dist/ artifacts exist, verify Three.js is absent from entry chunk
  const distAssetsDir = path.resolve('dist/assets')
  if (fs.existsSync(distAssetsDir)) {
    const assetFiles = fs.readdirSync(distAssetsDir)
    const entryJs = assetFiles.find((f) => /^index-.*\.js$/.test(f))
    const viewportJs = assetFiles.find((f) => /^MazeViewport3D-.*\.js$/.test(f))
    if (entryJs && viewportJs) {
      const entryBundle = fs.readFileSync(path.join(distAssetsDir, entryJs), 'utf8')
      const viewportBundle = fs.readFileSync(
        path.join(distAssetsDir, viewportJs),
        'utf8'
      )
      assert.equal(
        entryBundle.includes('WebGLRenderer'),
        false,
        'Built entry JS chunk must not contain Three.js WebGLRenderer'
      )
      assert.ok(
        viewportBundle.includes('WebGLRenderer'),
        'Lazy MazeViewport3D chunk must contain Three.js WebGLRenderer'
      )
    }
  }

  console.log('✓ Lazy 3D loading and 2D entry isolation verified')
}

// ---------------------------------------------------------------------------
// 2. Pause/Resume, Stamina Exhaustion & Hazard/Combat Resets
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Pause/resume freeze, stamina recovery & hazard reset parity')

  disposeAllSharedPools()
  const maze = generateMaze({ difficulty: 'small', seed: 4455, includeObjectives: true })
  const { engine, mockRenderer } = createHeadlessEngine({
    cameraMode: CAMERA_MODES.FIRST_PERSON,
    enemies: { autoSpawn: true },
  })
  engine.setMaze(maze)

  // Exhaust stamina by sprinting
  engine.stamina = 10
  engine.staminaDrainRate = 40
  engine.setInputSource({ forwardAxis: 1, strafeAxis: 0, sprint: true })
  engine.stepFrame(0.5, { render: false })
  assert.equal(engine.isExhausted, true, 'Stamina depletion triggers exhaustion')
  assert.equal(engine.stamina, 0, 'Stamina clamps at 0')

  // Freeze during pause: damage immunity, camera shake, stamina recovery, elapsed time must not advance
  engine.damageImmunityTimer = 0.8
  engine.cameraShakeIntensity = 0.25
  engine._elapsedSec = 12.5
  engine.setInputSource(null)
  engine.setPaused(true)

  const ranPaused = engine.stepFrame(0.5, { render: false })
  assert.equal(ranPaused, false, 'stepFrame returns false when paused')
  assert.equal(engine.stamina, 0, 'Exhausted stamina stays frozen during pause')
  assert.equal(engine.damageImmunityTimer, 0.8, 'Immunity timer frozen during pause')
  assert.equal(engine.cameraShakeIntensity, 0.25, 'Camera shake frozen during pause')
  assert.equal(engine._elapsedSec, 12.5, 'Elapsed simulation clock frozen during pause')

  // Resize while paused still triggers a single frame redraw
  const rendersBeforeResize = mockRenderer.renderCalls
  engine.resize(640, 480)
  assert.equal(
    mockRenderer.renderCalls,
    rendersBeforeResize + 1,
    'Resizing while paused redraws current frame cleanly'
  )

  // Resume and let stamina recover above threshold
  engine.setPaused(false)
  engine.recoveryDelayTimer = 0
  engine.stepFrame(1.0, { render: false })
  assert.ok(engine.stamina >= 35, 'Stamina recovers after resume')
  assert.equal(engine.isExhausted, false, 'Exhaustion clears once stamina >= 35')

  // Hazard reset & damage immunity clearing across resetCombat()
  const hazards = engine.getHazardManager().getHazards()
  assert.ok(hazards.length > 0, 'Hazards spawned for maze')
  const initialPhases = hazards.map((h) => h.initialTimer)
  for (const h of hazards) {
    h.state = 'active'
    h.timer = 1.1
    h.cooldownRemaining = 2.5
    h.hasDealtDamage = true
  }
  engine.damageImmunityTimer = 1.0
  assert.equal(
    engine.applyDamage(100, { hazardId: hazards[0].id, hazardType: hazards[0].type }),
    false,
    'Active damage immunity blocks hazard damage'
  )
  engine.damageImmunityTimer = 0
  assert.equal(
    engine.applyDamage(100, { hazardId: hazards[0].id, hazardType: hazards[0].type }),
    true,
    'Lethal damage applies once immunity expires'
  )
  assert.equal(engine.isGameOver, true, 'Lethal damage enters Game Over')

  engine.resetCombat()
  assert.equal(engine.isGameOver, false, 'resetCombat clears Game Over')
  assert.equal(engine.health, engine.maxHealth, 'resetCombat restores full health')
  assert.equal(engine.stamina, engine.maxStamina, 'resetCombat restores full stamina')
  assert.equal(engine.isExhausted, false, 'resetCombat clears exhaustion')
  assert.equal(engine.damageImmunityTimer, 0, 'resetCombat clears damage immunity')
  assert.equal(engine.flashlightActive, false, 'resetCombat turns flashlight off')
  assert.equal(engine.battery, engine.maxBattery, 'resetCombat recharges battery')

  hazards.forEach((h, idx) => {
    assert.equal(h.hasDealtDamage, false, 'Hazard hit flag resets on combat reset')
    assert.equal(h.cooldownRemaining, 0, 'Hazard cooldown resets on combat reset')
    assert.equal(
      h.initialTimer,
      initialPhases[idx],
      'Hazard staggered initialTimer phase preserved across reset'
    )
  })

  // First-person & third-person camera switching
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
  assert.equal(engine.getPlayer().visible, true, 'Player mesh visible in third-person')
  engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
  assert.equal(engine.getPlayer().visible, false, 'Player mesh hidden in first-person')

  engine.dispose()
  assert.equal(getActiveSharedPoolOwnerCount(), 0)
  console.log('✓ Pause/resume, stamina, hazard resets & camera modes verified')
}

// ---------------------------------------------------------------------------
// 3. Repeated Maze Regeneration, Shared-Resource Disposal & Adaptive Rendering
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Repeated regeneration disposal & adaptive rendering profiles')

  disposeAllSharedPools()
  const { engine } = createHeadlessEngine({
    isSoftwareGl: true,
    cameraMode: CAMERA_MODES.THIRD_PERSON,
  })

  for (const difficulty of ['small', 'medium', 'large', 'small']) {
    const m = generateMaze({ difficulty, seed: 777, includeObjectives: true })
    engine.setMaze(m)
    engine.stepFrame(0.016, { render: false })
  }

  assert.equal(engine.getPerformanceProfile().pixelRatioCap, 1)
  assert.equal(engine.getPerformanceProfile().maxEnemyLights, 0)
  assert.equal(engine.getPerformanceProfile().particlesEnabled, false)
  assert.equal(engine.getPerformanceProfile().antialias, false)
  assert.equal(computeAdaptiveFrameDelayMs(10, false), 32)
  assert.equal(computeAdaptiveFrameDelayMs(120, false), 180)
  assert.equal(computeAdaptiveFrameDelayMs(0, true), 200)

  const lowProf = resolvePerformanceProfile({}, false, true)
  assert.equal(lowProf.pixelRatioCap, 1.5)
  assert.equal(lowProf.maxEnemyLights, 1)
  assert.equal(lowProf.particleCount, 45)

  const hiProf = resolvePerformanceProfile({}, false, false)
  assert.equal(hiProf.pixelRatioCap, 2)
  assert.equal(hiProf.maxEnemyLights, 2)
  assert.equal(hiProf.antialias, true)

  engine.dispose()
  assert.equal(getActiveSharedPoolOwnerCount(), 0)
  assert.equal(getCollectiblePoolStats().geometries, 0)
  assert.equal(getEnemyPoolStats().geometries, 0)
  assert.equal(getHazardPoolStats().geometries, 0)
  assert.equal(getHidingSpotPoolStats().geometries, 0)
  console.log('✓ Shared-resource disposal and adaptive rendering verified')
}

// ---------------------------------------------------------------------------
// 4. Modal Escape Safety, Flashlight Pointer Handling, Minimap & Game Over Stats
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Modal Escape, flashlight pointer handling, HiDPI minimap & Game Over stats')

  const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
  assert.ok(
    appSrc.includes('title="Maze Escaped"') &&
      appSrc.includes('title="Vault Breached"') &&
      appSrc.includes('closeOnEscape={false}'),
    'Victory and Game Over modals disable Escape dismissal'
  )

  let closed = false
  assert.equal(
    handleModalEscapeKey({ key: 'Escape' }, { closeOnEscape: false, onClose: () => { closed = true } }),
    false
  )
  assert.equal(closed, false)
  assert.equal(
    handleModalEscapeKey({ key: 'Escape' }, { closeOnEscape: true, onClose: () => { closed = true } }),
    true
  )
  assert.equal(closed, true)

  // Verify TouchControls3D flashlight pointerdown + pointerup + click deduplication
  const touchSrc = fs.readFileSync(
    path.resolve('src/components/game/TouchControls3D.jsx'),
    'utf8'
  )
  assert.ok(
    touchSrc.includes('handleFlashlightPointerDown') &&
      touchSrc.includes('handleFlashlightPointerEnd') &&
      touchSrc.includes('handleFlashlightClick') &&
      touchSrc.includes("if (event.type === 'pointercancel')"),
    'TouchControls3D guards flashlight button against duplicate pointerdown+click and resets on pointercancel'
  )

  // Verify Viewport defaults minimap collapsed on narrow mobile (<=640px)
  const viewportSrc = fs.readFileSync(
    path.resolve('src/components/game/MazeViewport3D.jsx'),
    'utf8'
  )
  assert.ok(
    viewportSrc.includes('window.innerWidth > 640'),
    'MazeViewport3D collapses minimap by default on <=640px mobile viewports'
  )

  // Fractional DPR & capped DPR minimap verification
  assert.equal(resolveMinimapDpr(1.25), 1.25)
  assert.equal(resolveMinimapDpr(3.5), MINIMAP_MAX_DPR)
  const smallMaze = generateMaze({ difficulty: 'small', seed: 101 })
  const exploration = createExplorationState(smallMaze)
  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: () => ({
      setTransform() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      arc() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      stroke() {},
    }),
  }
  const sync = syncMinimapCanvasResolution(canvas, MINIMAP_LOGICAL_SIZE, 2.5)
  assert.equal(sync.dpr, 2)
  assert.equal(canvas.width, MINIMAP_LOGICAL_SIZE * 2)
  assert.equal(canvas.height, MINIMAP_LOGICAL_SIZE * 2)
  assert.equal(
    renderMinimapCanvas(canvas, {
      maze: smallMaze,
      exploration,
      playerCell: smallMaze.start,
      yaw: 0,
      coins: [],
      powerUps: [],
      keycards: [],
      objectivesEnabled: false,
      isExitLocked: false,
      dpr: sync.dpr,
    }),
    true
  )

  // Game Over statistics (both 2D and 3D objectives modes + reducer reset/replay)
  const summary2D = buildGameOverSummary({
    runId: 2,
    survivalTimeMs: -50,
    moves: 14,
    coinsCollected: 99,
    totalCoins: 5,
    keysCollected: 2,
    totalKeys: 3,
    objectivesEnabled: false,
  })
  assert.deepEqual(summary2D, {
    runId: 2,
    survivalTimeMs: 0,
    moves: 14,
    coinsCollected: 5,
    totalCoins: 5,
    keysCollected: 0,
    totalKeys: 0,
    objectivesEnabled: false,
  })

  const summary3D = buildGameOverSummary({
    runId: 3,
    survivalTimeMs: 19240,
    moves: 28,
    coinsCollected: 3,
    totalCoins: 6,
    keysCollected: 1,
    totalKeys: 2,
    objectivesEnabled: true,
  })
  assert.equal(formatElapsedTime(summary3D.survivalTimeMs), '00:19.2')
  assert.equal(summary3D.keysCollected, 1)
  assert.equal(summary3D.totalKeys, 2)

  // Reducer Collectible/Power-up/Keycard -> Victory -> Game Over -> Replay -> New Maze cycle
  let gs = createInitialGameState('small', 808, { objectivesEnabled: true })
  const originalSeed = gs.maze.seed
  if (gs.coins.length > 0) {
    const coinTarget = gs.coins[0]
    gs = gameReducer(gs, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: coinTarget.row, col: coinTarget.col },
    })
    assert.equal(gs.coinsCollected, 1, 'Coin collected on cell sync')
  }
  if (gs.powerUps.length > 0) {
    const puTarget = gs.powerUps[0]
    gs = gameReducer(gs, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: puTarget.row, col: puTarget.col },
    })
    assert.equal(gs.inventory[puTarget.type], 1, 'Power-up added to inventory')
    if (puTarget.type === POWERUP_TYPES.WALL_PASS) {
      gs = gameReducer(gs, {
        type: 'ACTIVATE_ABILITY',
        abilityType: POWERUP_TYPES.WALL_PASS,
      })
      assert.equal(gs.activeEffects.wallPassArmed, true)
    } else if (puTarget.type === POWERUP_TYPES.ECHO_REVEAL) {
      gs = gameReducer(gs, {
        type: 'ACTIVATE_ABILITY',
        abilityType: POWERUP_TYPES.ECHO_REVEAL,
      })
      assert.ok(gs.activeEffects.echoRevealRemainingMs > 0)
    } else if (puTarget.type === POWERUP_TYPES.COIN_MAGNET) {
      gs = gameReducer(gs, {
        type: 'ACTIVATE_ABILITY',
        abilityType: POWERUP_TYPES.COIN_MAGNET,
      })
      assert.ok(gs.activeEffects.magnetRemainingMs > 0)
    }
  }
  for (const keycard of [...gs.keycards]) {
    gs = gameReducer(gs, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: keycard.row, col: keycard.col },
    })
  }
  assert.equal(gs.isExitLocked, false, 'Exit unlocks once all keycards collected')
  const wonState = gameReducer(gs, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: gs.maze.exit.row, col: gs.maze.exit.col },
  })
  assert.equal(wonState.hasWon, true, 'Reaching unlocked exit triggers victory')

  const deadState = gameReducer(gs, { type: 'DAMAGE_PLAYER', damage: 100, enemyId: 'e-1' })
  assert.equal(deadState.isGameOver, true)
  const replayed = gameReducer(deadState, { type: 'RESET_RUN' })
  assert.equal(replayed.isGameOver, false)
  assert.equal(replayed.health, replayed.maxHealth)
  assert.equal(replayed.maze.seed, originalSeed)
  assert.equal(replayed.runId, deadState.runId + 1)

  const newMazeState = gameReducer(deadState, { type: 'NEW_MAZE' })
  assert.equal(newMazeState.isGameOver, false)
  assert.equal(newMazeState.runId, deadState.runId + 1)
  assert.ok(newMazeState.maze.seed !== originalSeed)

  console.log('✓ Modal Escape, flashlight guard, minimap, and Game Over flow verified')
}

console.log('=== ALL PHASE F PROMPT 04 HARDENING & RELEASE AUDIT TESTS PASSED! ===')
