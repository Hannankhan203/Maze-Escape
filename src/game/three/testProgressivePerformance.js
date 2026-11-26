import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  computeWayfinderHint,
  formatWayfinderHintFromResolved,
  resolveWayfinderObjectiveTarget,
} from '../mechanics/wayfinder.js'
import { gridToWorld } from '../world/worldCoords.js'
import { getHidingSpotPoolStats } from './buildHidingSpots.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  disposeAllSharedPools,
  getActiveSharedPoolOwnerCount,
} from './sharedResources.js'
import { getLayerMeshes } from './spatialChunking.js'

console.log('--- RUNNING PROGRESSIVE PERFORMANCE & OPTIMIZATION REGRESSION TESTS ---')

function createInstrumentedMockRenderer() {
  const stats = {
    renderDrawItems: 0,
    renderShadows: 0,
  }
  const renderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: true, type: null, needsUpdate: false },
    pixelRatio: 1,
    info: {
      render: { calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
    },
    setPixelRatio: (r) => {
      renderer.pixelRatio = r
    },
    setSize: () => {},
    render: (scene) => {
      let drawItems = 0
      let shadows = 0
      scene.traverseVisible((obj) => {
        if (!obj.isMesh && !obj.isInstancedMesh) return
        drawItems += 1
        if (obj.castShadow) shadows += 1
      })
      stats.renderDrawItems = drawItems
      stats.renderShadows = shadows
      renderer.info.render.calls = drawItems
    },
    dispose: () => {},
    getContext: () => null,
  }
  return { renderer, stats }
}

function createHeadlessEngine(config = {}) {
  const { renderer, stats } = createInstrumentedMockRenderer()
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  const engine = new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => renderer,
    isSoftwareGl: false,
    lowPerformance: false,
    skipSpawnSequence: true,
    skipExtractionSequence: true,
    graphics: {
      qualityPreset: 'high',
      antialias: true,
      volumetricFog: true,
      particlesEnabled: true,
      highContrast: false,
    },
    ...config,
  })
  return { engine, renderer, stats }
}

function countVisibleSceneItems(scene) {
  let drawItems = 0
  let shadows = 0
  scene.traverseVisible((obj) => {
    if (!obj.isMesh && !obj.isInstancedMesh) return
    drawItems += 1
    if (obj.castShadow) shadows += 1
  })
  return { drawItems, shadows }
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Progressive Levels 1..5000 Scaling, Pool Reuse & Build/Step Budgets
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Progressive levels 1..5000 generation, hiding pool reuse & step budgets')
  const testLevels = [1, 5, 10, 25, 50, 100, 500, 5000]

  for (const level of testLevels) {
    disposeAllSharedPools()
    const tGen0 = performance.now()
    const maze = generateMaze({ level, seed: 20000 + level })
    const genMs = performance.now() - tGen0

    assert.ok(maze.rows <= 51 && maze.cols <= 51, `Level ${level} grid dimensions capped <= 51x51`)
    assert.ok(genMs < 2000, `Level ${level} procedural generation completed promptly (${genMs.toFixed(1)}ms)`)

    const { engine } = createHeadlessEngine()
    engine.setMaze(maze)

    const poolStats = getHidingSpotPoolStats()
    assert.ok(
      poolStats.geometries <= 60,
      `Level ${level} hiding spot shared geometry pool stays compact (${poolStats.geometries})`
    )
    assert.ok(
      poolStats.materials <= 25,
      `Level ${level} hiding spot shared material pool stays compact (${poolStats.materials})`
    )

    // Verify detail parts tagged noShadowCaster stay excluded from shadow casting
    for (const spot of engine.hidingSpotManager.getHidingSpots()) {
      spot.mesh?.traverse((child) => {
        if (child.userData?.noShadowCaster) {
          assert.equal(
            child.castShadow,
            false,
            `Hiding detail part ${child.name} does not cast shadows`
          )
        }
      })
    }

    for (let f = 0; f < 20; f += 1) {
      engine.stepFrame(0.016, { render: false })
    }
    engine.renderFrame()

    const metrics = engine.getPerformanceMetrics()
    assert.equal(metrics.qualityPreset, 'high')
    assert.equal(metrics.frame.frameCount, 20)
    assert.ok(metrics.frame.avgStepMs >= 0 && metrics.frame.avgStepMs < 50)
    assert.ok(metrics.counts.enemies >= 1)
    assert.ok(metrics.pools.activeSharedPoolOwners >= 1)

    engine.dispose()
  }

  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'All shared pool owners released')
  assert.deepEqual(getHidingSpotPoolStats(), { geometries: 0, materials: 0 }, 'Hiding spot pools emptied')
  console.log('✓ Progressive scaling (L1..L5000) & shared pool caps verified')
}

// ---------------------------------------------------------------------------
// 2. Scoped Fog-Distance Culling, Visibility Restoration & Quality Preset Integrity
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Scoped renderFrame() fog culling reduces draw items/shadows and restores visibility')
  const maze = generateMaze({ level: 100, seed: 10100 })
  const { engine, stats } = createHeadlessEngine({
    graphics: {
      qualityPreset: 'high',
      antialias: true,
      volumetricFog: true,
      particlesEnabled: true,
      highContrast: false,
    },
  })
  engine.setMaze(maze)

  const unculled = countVisibleSceneItems(engine.scene)
  engine.renderFrame()
  const metrics = engine.getPerformanceMetrics()

  assert.equal(metrics.culling.active, true, 'Fog-distance culling active on Level 100')
  assert.ok(metrics.culling.cullDistance >= 50, 'Fog cull distance exceeds dense visibility horizon')
  assert.ok(metrics.culling.totalChunks > 100, 'Large 51x51 maze exposes spatial chunk nodes')
  assert.ok(metrics.culling.culledChunks > metrics.culling.totalChunks * 0.5, 'Majority of distant chunks culled')
  assert.ok(metrics.culling.culledEntities > 20, 'Distant entities culled beyond fog distance')
  assert.ok(
    stats.renderDrawItems < unculled.drawItems * 0.45,
    `Rendered draw items reduced significantly (${stats.renderDrawItems} vs ${unculled.drawItems})`
  )
  assert.ok(
    stats.renderShadows < unculled.shadows * 0.45,
    `Rendered shadow casters reduced significantly (${stats.renderShadows} vs ${unculled.shadows})`
  )

  // Verify ALL spatial chunks and entity meshes are restored immediately after renderFrame()
  const afterRender = countVisibleSceneItems(engine.scene)
  assert.equal(
    afterRender.drawItems,
    unculled.drawItems,
    'Visible draw items restored bit-for-bit after renderFrame()'
  )
  assert.equal(
    afterRender.shadows,
    unculled.shadows,
    'Visible shadow casters restored bit-for-bit after renderFrame()'
  )

  // Performance preset hides ceiling light halos; renderFrame() restoration must NOT unhide them
  engine.updateGraphicsConfig({ qualityPreset: 'performance' })
  const haloNode = engine.getMazeGroup().getObjectByName('maze-ceiling-light-halos')
  const haloMeshes = getLayerMeshes(haloNode)
  assert.ok(haloMeshes.length > 0 && haloMeshes.every((h) => h.visible === false))

  engine.renderFrame()
  assert.ok(
    haloMeshes.every((h) => h.visible === false),
    'Performance-preset hidden halos remain hidden after renderFrame() culling restore'
  )

  // Disabling volumetricFog disables fog-distance culling cleanly
  engine.updateGraphicsConfig({ volumetricFog: false })
  engine.renderFrame()
  const noFogMetrics = engine.getPerformanceMetrics()
  assert.equal(noFogMetrics.culling.active, false, 'Culling disables when volumetricFog=false')
  assert.equal(noFogMetrics.culling.totalCulled, 0)

  // Elevated player position (> 2.2m during shaft extraction) skips fog culling
  engine.updateGraphicsConfig({ volumetricFog: true })
  const curPos = engine.getPlayerWorldPosition()
  engine.setPlayerWorldPosition({ x: curPos.x, y: 4.5, z: curPos.z })
  engine.renderFrame()
  const elevatedMetrics = engine.getPerformanceMetrics()
  assert.equal(elevatedMetrics.culling.active, false, 'Culling skips during elevated extraction shaft ascent')

  engine.dispose()
  console.log('✓ Scoped fog culling, preset visibility preservation & elevation guard verified')
}

// ---------------------------------------------------------------------------
// 3. Cached Wayfinder Route Formatting Parity
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Wayfinder cached route formatting matches computeWayfinderHint across yaw & sub-cell moves')
  const maze = generateMaze({ level: 100, seed: 4242 })
  const playerCell = { ...maze.start }
  const playerWorld = gridToWorld(playerCell.row, playerCell.col, maze)

  for (const mode of [
    { keycards: maze.keycards || [], objectivesEnabled: true, isExitLocked: true },
    { keycards: [], objectivesEnabled: true, isExitLocked: false },
  ]) {
    const resolved = resolveWayfinderObjectiveTarget({
      maze,
      playerCell,
      ...mode,
    })

    for (const yaw of [0, 0.75, -Math.PI / 2, Math.PI]) {
      const worldOffset = { x: playerWorld.x + 0.35, y: 0, z: playerWorld.z - 0.25 }
      const fullHint = computeWayfinderHint({
        maze,
        playerCell,
        playerWorldPos: worldOffset,
        yaw,
        ...mode,
      })
      const cachedHint = formatWayfinderHintFromResolved(resolved, {
        maze,
        playerCell,
        playerWorldPos: worldOffset,
        yaw,
        ...mode,
      })
      assert.deepEqual(cachedHint, fullHint, `Cached formatter matches full computeWayfinderHint (yaw=${yaw})`)
    }
  }
  console.log('✓ Wayfinder O(1) cached route formatting parity verified')
}

// ---------------------------------------------------------------------------
// 4. Distant-Entity Culling Preserves Close Interaction, Hazards, Magnets & Distant AI
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Distant CPU culling preserves close interactions, hazard LOS, soul-shards magnet & distant AI')
  const maze = generateMaze({ level: 100, seed: 7777 })
  const { engine } = createHeadlessEngine()
  engine.setMaze(maze)

  // A) Hiding Spot close interaction vs distant culling
  const spots = engine.hidingSpotManager.getHidingSpots()
  assert.ok(spots.length > 5)
  const targetSpot = spots[spots.length - 1]
  const farAwayOrigin = engine.getPlayerWorldPosition()
  assert.equal(
    engine.hidingSpotManager.findNearestInteractable(farAwayOrigin, maze.start),
    null,
    'Distant hiding spots outside 5m pre-filter are not returned'
  )

  const approachPos = targetSpot.approachWorldPos || targetSpot.worldPos
  engine.setPlayerWorldPosition({ x: approachPos.x, y: 0, z: approachPos.z })
  engine.stepFrame(0.016, { render: false })
  const nearSpot = engine.hidingSpotManager.findNearestInteractable(
    engine.getPlayerWorldPosition(),
    engine.getPlayerGridCell()
  )
  assert.ok(nearSpot && nearSpot.id === targetSpot.id, 'Close hiding spot remains interactable')

  // B) Hazard close detection & update vs distant skip
  const hazards = engine.hazardManager.getHazards()
  assert.ok(hazards.length > 5)
  const targetHazard = hazards.find((h) => h.canPlayerInteract) || hazards[0]
  const farPos = { x: targetHazard.worldPos.x + 80, y: 0, z: targetHazard.worldPos.z + 80 }
  assert.equal(
    engine.hazardManager.findNearestInteractable(farPos, maze.start),
    null,
    'Distant hazards outside 5.5m pre-filter are skipped'
  )
  const nearHazardPos = targetHazard.dangerWorldPos || targetHazard.worldPos
  engine.setPlayerWorldPosition({ x: nearHazardPos.x, y: 0, z: nearHazardPos.z })
  const hazUpdateRes = engine.hazardManager.update(0.05, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    playerGridCell: engine.getPlayerGridCell(),
  })
  assert.ok(hazUpdateRes !== null && typeof hazUpdateRes === 'object', 'Close hazard updates normally')

  // C) Collectible soul_shards 6m magnet vs >36m animation skip
  const items = Array.from(engine.collectibleManager.items.values())
  assert.ok(items.length >= 2)
  const nearItem = items.find((it) => it.type === 'soul_shards') || items[0]
  assert.equal(nearItem.type, 'soul_shards', 'Found a soul_shards item for magnet test')
  const farItem = items.reduce((best, cur) => {
    const dCur = Math.hypot(cur.worldPos.x - nearItem.worldPos.x, cur.worldPos.z - nearItem.worldPos.z)
    const dBest = best ? Math.hypot(best.worldPos.x - nearItem.worldPos.x, best.worldPos.z - nearItem.worldPos.z) : -1
    return dCur > dBest ? cur : best
  }, null)
  assert.ok(
    Math.hypot(farItem.worldPos.x - nearItem.worldPos.x, farItem.worldPos.z - nearItem.worldPos.z) > 36,
    'Test setup found an item > 36m away on 51x51 maze'
  )
  const farItemRotBefore = farItem.mesh.rotation.y
  const targetPlayerPos = { x: nearItem.worldPos.x + 2.5, y: 0, z: nearItem.worldPos.z }
  let attractedCollected = 0
  engine.collectibleManager.update(
    0.1,
    targetPlayerPos,
    { spectralCompassRemainingMs: 5000 },
    () => {
      attractedCollected += 1
    }
  )
  assert.equal(
    farItem.mesh.rotation.y,
    farItemRotBefore,
    'Distant collectible (>36m) skips redundant per-frame rotation update'
  )
  // Step further so attracted nearItem finishes pulling within pickup radius
  for (let s = 0; s < 15 && attractedCollected === 0; s += 1) {
    engine.collectibleManager.update(
      0.1,
      targetPlayerPos,
      { spectralCompassRemainingMs: 5000 },
      () => {
        attractedCollected += 1
      }
    )
  }
  assert.ok(attractedCollected >= 1, 'Soul Shards 6m magnet collects nearby item cleanly')

  // D) Distant enemies (>34m) skip limb articulation while keeping AI/position updates intact
  const startCellPos = gridToWorld(maze.start.row, maze.start.col, maze)
  engine.setPlayerWorldPosition({ x: startCellPos.x, y: 0, z: startCellPos.z })
  const farEnemy = engine.enemyManager.getEnemies().find((e) => {
    const d = Math.hypot(e.worldPos.x - startCellPos.x, e.worldPos.z - startCellPos.z)
    return d > 38
  })
  assert.ok(farEnemy, 'Found enemy > 38m from start on 51x51 maze')
  const enemyPosBefore = { ...farEnemy.worldPos }
  for (let f = 0; f < 90; f += 1) {
    engine.stepFrame(0.033, { render: false })
  }
  const movedDist = Math.hypot(
    farEnemy.worldPos.x - enemyPosBefore.x,
    farEnemy.worldPos.z - enemyPosBefore.z
  )
  assert.ok(movedDist > 0.05, `Distant enemy still advances patrol AI (${movedDist.toFixed(2)}m)`)

  engine.dispose()
  console.log('✓ Close interactions, hazards, Soul Shards magnet & distant enemy AI preserved')
}

// ---------------------------------------------------------------------------
// 5. Multi-Level Sequential Transition Cleanup (Levels 1..12)
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Multi-level transition (1..12) cleans up chunk/entity resources with zero pool leaks')
  disposeAllSharedPools()
  const { engine } = createHeadlessEngine()
  for (let lvl = 1; lvl <= 12; lvl += 1) {
    const maze = generateMaze({ level: lvl, seed: 9000 + lvl })
    engine.setMaze(maze)
    for (let s = 0; s < 5; s += 1) {
      engine.stepFrame(0.016, { render: false })
    }
    engine.renderFrame()
  }
  engine.dispose()

  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Active shared pool owners = 0 after 12-level run + dispose')
  assert.deepEqual(
    getHidingSpotPoolStats(),
    { geometries: 0, materials: 0 },
    'Hiding spot pool stats = { geometries: 0, materials: 0 } after dispose'
  )
  console.log('✓ Multi-level transition disposal & zero pool leaks verified')
}

disposeAllSharedPools()
console.log('=== ALL PROGRESSIVE PERFORMANCE & OPTIMIZATION REGRESSION TESTS PASSED! ===')
