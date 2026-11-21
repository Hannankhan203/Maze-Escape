import assert from 'node:assert/strict'
import { generateMaze } from '../generation/mazeGenerator.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { getGalvanizedMetalTextureSet } from './buildCeilingVents.js'
import { getEnvironmentalPropTextureSet } from './buildEnvironmentalProps.js'
import {
  TEXTURE_QUALITY_PRESETS,
  getMazeSurfacePoolStats,
  getMazeSurfaceTextureSet,
} from './mazeSurfaceTextures.js'
import {
  PLAYER_TEXTURE_QUALITY_PRESETS,
  getPlayerTexturePoolStats,
  getPlayerTexturePresetRefCount,
  getPlayerTextureSet,
} from './playerTextures.js'
import {
  disposeAllSharedPools,
  getActiveSharedPoolOwnerCount,
} from './sharedResources.js'
import { GRAPHICS_QUALITY_PRESETS } from './threeConfig.js'

function createMockHost() {
  return {
    clientWidth: 960,
    clientHeight: 540,
    children: [],
    appendChild(node) {
      node.parentNode = this
      this.children.push(node)
    },
    removeChild(node) {
      this.children = this.children.filter((c) => c !== node)
      node.parentNode = null
    },
  }
}

function createTrackedRendererFactory({ maxAniso = 16 } = {}) {
  const stats = {
    created: [],
    disposedCount: 0,
    renderCount: 0,
  }

  const createRenderer = (opts = {}) => {
    const domElement = { parentNode: null, style: {} }
    let antialiasState = Boolean(opts.antialias)
    const renderer = {
      isTrackedMockRenderer: true,
      opts: { ...opts },
      domElement,
      capabilities: {
        getMaxAnisotropy: () => maxAniso,
      },
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 1,
      shadowMap: {
        enabled: false,
        type: null,
        needsUpdate: false,
      },
      pixelRatio: 1,
      setPixelRatio(r) {
        this.pixelRatio = r
      },
      setSize() {},
      render() {
        stats.renderCount += 1
      },
      dispose() {
        stats.disposedCount += 1
      },
      getContext() {
        return {
          getContextAttributes: () => ({ antialias: antialiasState }),
        }
      },
    }
    stats.created.push(renderer)
    return renderer
  }

  return { createRenderer, stats }
}

function createEngine({
  graphics = undefined,
  lowPerformance = false,
  isSoftwareGl = false,
  maxAniso = 16,
  enemies = undefined,
} = {}) {
  const prevWindow = globalThis.window
  globalThis.window = { devicePixelRatio: 2 }
  const { createRenderer, stats } = createTrackedRendererFactory({ maxAniso })
  const host = createMockHost()

  const engine = new MazeSceneEngine(host, {
    isSoftwareGl,
    lowPerformance,
    ...(graphics ? { graphics } : {}),
    ...(enemies ? { enemies } : {}),
    createRenderer,
  })

  return {
    engine,
    host,
    stats,
    restoreWindow() {
      if (prevWindow === undefined) {
        delete globalThis.window
      } else {
        globalThis.window = prevWindow
      }
    },
  }
}

function getLayerMeshes(obj) {
  if (!obj) return []
  const out = []
  obj.traverse((n) => {
    if (n.isMesh) out.push(n)
  })
  return out
}

console.log('=== PHASE 7 QUALITY-PRESET CONSISTENCY & LIVE CONFIGURATION TESTS ===')

// 1. Verify all 3 presets across every subsystem & cross-pool anisotropy
{
  console.log('Test 1: Preset resource matrix & cross-pool anisotropy caps (performance / balanced / high)')
  disposeAllSharedPools()

  const mediumMaze = generateMaze({ difficulty: 'medium', seed: 7071 })
  const snapshots = {}

  for (const preset of ['performance', 'balanced', 'high']) {
    const { engine, restoreWindow } = createEngine({
      graphics: { qualityPreset: preset },
      maxAniso: 16,
    })
    try {
      engine.setMaze(mediumMaze)
      engine.stepFrame(0.016, { render: false })

      const mazeGroup = engine.getMazeGroup()
      const env = engine.getEnvironment()
      const ceilingLights = mazeGroup.getObjectByName('maze-ceiling-lights-group')
      const lightsUd = ceilingLights.userData
      const spallMeshes = getLayerMeshes(mazeGroup.getObjectByName('deterioration-concrete-spall'))
      const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset: preset })
      const ventTex = getGalvanizedMetalTextureSet({ qualityPreset: preset })
      const propTex = getEnvironmentalPropTextureSet({ qualityPreset: preset })
      const playerTex = getPlayerTextureSet({ qualityPreset: preset })
      const playerObj = engine.getPlayer()
      const playerJacket = playerObj?.getObjectByName?.('maze-player-torso-jacket')
      const profile = engine.getPerformanceProfile()
      const backdrop = env.details.backdropGroup

      snapshots[preset] = {
        pixelRatioCap: profile.pixelRatioCap,
        actualPixelRatio: engine.renderer.pixelRatio,
        shadowMapEnabled: engine.renderer.shadowMap.enabled,
        flashlightCastShadow: engine.spotlight.castShadow,
        flashlightShadowSize: engine.spotlight.shadow.mapSize.width,
        particleCount: env.details.dustPoints?.geometry?.attributes?.position?.count || 0,
        maxEnemyLights: profile.maxEnemyLights,
        activeEnemyLights: engine.getEnemies().filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length,
        overheadPointsVisible: lightsUd.pointLightPool.filter((l) => l.visible).length,
        overheadSpotsVisible: lightsUd.shadowSpotPool.filter((l) => l.visible).length,
        haloVisible: lightsUd.haloMesh.visible,
        concreteDetail: mazeGroup.userData.wallMat.userData.concreteWeatherUniforms.uConcreteDetail.value,
        surfaceAlbedoWidth: surfaceSet.wall.map.image.width,
        ventWidth: ventTex.map.image.width,
        propWidth: propTex.rustMetal.map.image.width,
        playerPreset: playerObj?.userData?.qualityPreset,
        playerWidth: playerJacket?.material?.map?.image?.width,
        surfaceAniso: surfaceSet.wall.map.anisotropy,
        ventAniso: ventTex.map.anisotropy,
        propAniso: propTex.rustMetal.map.anisotropy,
        playerAniso: playerTex.jacket.map.anisotropy,
        backdropPillars: backdrop.userData.pillarCount,
        backdropBeacons: backdrop.userData.beaconCount,
        backdropHasHalos: Boolean(backdrop.getObjectByName('maze-env-beacon-halos')),
        backdropHasMarkings: Boolean(backdrop.getObjectByName('maze-env-bg-markings')),
        spallCastShadow: spallMeshes.every((m) => m.castShadow),
        deteriorationSites: mazeGroup.getObjectByName('maze-structural-deterioration').userData.totalSites,
      }

      const spec = TEXTURE_QUALITY_PRESETS[preset]
      const expectedAniso = preset === 'high' ? 16 : spec.anisotropyCap
      const expectedPlayerWidth = PLAYER_TEXTURE_QUALITY_PRESETS[preset].albedoSize
      assert.equal(snapshots[preset].surfaceAniso, expectedAniso, `${preset} wall texture anisotropy`)
      assert.equal(snapshots[preset].ventAniso, expectedAniso, `${preset} galvanized vent texture anisotropy synced on setMaze`)
      assert.equal(snapshots[preset].propAniso, expectedAniso, `${preset} prop texture anisotropy synced on setMaze`)
      assert.equal(snapshots[preset].playerAniso, expectedAniso, `${preset} player texture anisotropy synced on setMaze`)
      assert.equal(snapshots[preset].playerPreset, preset, `${preset} player qualityPreset synced on setMaze`)
      assert.equal(snapshots[preset].playerWidth, expectedPlayerWidth, `${preset} player texture resolution matches preset`)
    } finally {
      engine.dispose()
      restoreWindow()
    }
  }

  assert.equal(snapshots.performance.pixelRatioCap, 1.0)
  assert.equal(snapshots.performance.actualPixelRatio, 1)
  assert.equal(snapshots.performance.shadowMapEnabled, false)
  assert.equal(snapshots.performance.flashlightCastShadow, false)
  assert.equal(snapshots.performance.particleCount, GRAPHICS_QUALITY_PRESETS.performance.particleCount)
  assert.equal(snapshots.performance.maxEnemyLights, 0)
  assert.equal(snapshots.performance.activeEnemyLights, 0)
  assert.equal(snapshots.performance.overheadPointsVisible, 0)
  assert.equal(snapshots.performance.overheadSpotsVisible, 0)
  assert.equal(snapshots.performance.haloVisible, false)
  assert.equal(snapshots.performance.concreteDetail, 0.0)
  assert.equal(snapshots.performance.surfaceAlbedoWidth, 128)
  assert.equal(snapshots.performance.ventWidth, 64)
  assert.equal(snapshots.performance.propWidth, 64)
  assert.equal(snapshots.performance.backdropHasHalos, false)
  assert.equal(snapshots.performance.backdropHasMarkings, false)
  assert.equal(snapshots.performance.spallCastShadow, false)

  assert.equal(snapshots.balanced.pixelRatioCap, 1.5)
  assert.equal(snapshots.balanced.actualPixelRatio, 1.5)
  assert.equal(snapshots.balanced.shadowMapEnabled, true)
  assert.equal(snapshots.balanced.flashlightCastShadow, true)
  assert.equal(snapshots.balanced.flashlightShadowSize, 512)
  assert.equal(snapshots.balanced.particleCount, GRAPHICS_QUALITY_PRESETS.balanced.particleCount)
  assert.equal(snapshots.balanced.maxEnemyLights, 1)
  assert.ok(snapshots.balanced.activeEnemyLights <= 1)
  assert.ok(snapshots.balanced.overheadPointsVisible <= 2)
  assert.ok(snapshots.balanced.overheadSpotsVisible <= 1)
  assert.equal(snapshots.balanced.haloVisible, true)
  assert.equal(snapshots.balanced.concreteDetail, 0.5)
  assert.equal(snapshots.balanced.surfaceAlbedoWidth, 256)
  assert.equal(snapshots.balanced.ventWidth, 128)
  assert.equal(snapshots.balanced.propWidth, 128)
  assert.equal(snapshots.balanced.backdropHasHalos, true)
  assert.equal(snapshots.balanced.backdropHasMarkings, true)
  assert.equal(snapshots.balanced.spallCastShadow, true)

  assert.equal(snapshots.high.pixelRatioCap, 2.0)
  assert.equal(snapshots.high.actualPixelRatio, 2)
  assert.equal(snapshots.high.shadowMapEnabled, true)
  assert.equal(snapshots.high.flashlightCastShadow, true)
  assert.equal(snapshots.high.flashlightShadowSize, 1024)
  assert.equal(snapshots.high.particleCount, GRAPHICS_QUALITY_PRESETS.high.particleCount)
  assert.equal(snapshots.high.maxEnemyLights, 2)
  assert.ok(snapshots.high.activeEnemyLights <= 2)
  assert.ok(snapshots.high.overheadPointsVisible <= 4)
  assert.ok(snapshots.high.overheadSpotsVisible <= 2)
  assert.equal(snapshots.high.haloVisible, true)
  assert.equal(snapshots.high.concreteDetail, 1.0)
  assert.equal(snapshots.high.surfaceAlbedoWidth, 512)
  assert.equal(snapshots.high.ventWidth, 256)
  assert.equal(snapshots.high.propWidth, 256)
  assert.equal(snapshots.high.backdropHasHalos, true)
  assert.equal(snapshots.high.backdropHasMarkings, true)
  assert.equal(snapshots.high.spallCastShadow, true)

  assert.ok(
    snapshots.performance.backdropPillars < snapshots.balanced.backdropPillars &&
      snapshots.balanced.backdropPillars < snapshots.high.backdropPillars,
    'Backdrop pillars scale monotonically across presets'
  )
  assert.ok(
    snapshots.performance.deteriorationSites < snapshots.balanced.deteriorationSites &&
      snapshots.balanced.deteriorationSites < snapshots.high.deteriorationSites,
    'Structural deterioration density scales monotonically across presets'
  )
  assert.equal(getActiveSharedPoolOwnerCount(), 0)
  console.log('✓ All 3 preset matrices and cross-pool anisotropy verified')
}

// 2. Live preset transitions, orthogonal toggles without unnecessary rebuilds & shadow/plinth sync
{
  console.log('Test 2: Live updateGraphicsConfig transitions & selective rebuild avoidance')
  disposeAllSharedPools()

  const { engine, stats, restoreWindow } = createEngine({
    graphics: { qualityPreset: 'high' },
    maxAniso: 8,
  })
  try {
    const maze = generateMaze({ difficulty: 'medium', seed: 7072 })
    engine.setMaze(maze)

    const initialMazeGroup = engine.getMazeGroup()
    const env = engine.getEnvironment()
    const initialBackdrop = env.details.backdropGroup
    const initialPlinth = env.details.plinthMesh
    const initialDust = env.details.dustPoints

    let backdropDisposedCount = 0
    initialBackdrop.getObjectByName('maze-env-sky-dome').geometry.addEventListener('dispose', () => {
      backdropDisposedCount += 1
    })

    // A) Orthogonal toggles (fog, dynamicLights, highContrast, redundant same-preset) MUST NOT rebuild backdrop/plinth/dust/mazeGroup
    engine.setPaused(true)
    const rendersBeforePausedToggle = stats.renderCount

    engine.updateGraphicsConfig({ qualityPreset: 'high' })
    engine.updateGraphicsConfig({ volumetricFog: false })
    engine.updateGraphicsConfig({ dynamicLights: false })
    engine.updateGraphicsConfig({ highContrast: true })

    assert.equal(engine.getMazeGroup(), initialMazeGroup, 'Orthogonal toggles preserve mazeGroup')
    assert.equal(env.details.backdropGroup, initialBackdrop, 'Orthogonal toggles do NOT rebuild undergroundBackdrop')
    assert.equal(env.details.plinthMesh, initialPlinth, 'Orthogonal toggles do NOT rebuild plinthMesh')
    assert.equal(env.details.dustPoints, initialDust, 'Orthogonal toggles do NOT rebuild dustPoints')
    assert.equal(backdropDisposedCount, 0, 'No unnecessary backdrop geometry disposal on orthogonal toggles')
    assert.equal(
      stats.renderCount - rendersBeforePausedToggle,
      4,
      'Each paused updateGraphicsConfig call renders exactly 1 unified frame (not double render via resize)'
    )
    assert.equal(engine.scene.fog, null)
    assert.equal(env.lights.startLight.intensity, 0)
    assert.equal(engine.getPerformanceProfile().maxEnemyLights, 0)

    // Restore toggles before testing preset switch
    engine.updateGraphicsConfig({ volumetricFog: true, dynamicLights: true, highContrast: false })
    assert.equal(env.details.backdropGroup, initialBackdrop, 'Re-enabling fog/lights/contrast preserves backdropGroup')

    // Track spotlight shadow map disposal on size transition 1024 -> 512
    let shadowMapDisposed = 0
    engine.spotlight.shadow.map = {
      dispose() {
        shadowMapDisposed += 1
      },
    }

    // B) Live switch: high -> performance
    engine.updateGraphicsConfig({ qualityPreset: 'performance' })
    assert.equal(engine.getMazeGroup(), initialMazeGroup, 'Preset switch preserves mazeGroup without rebuilding maze')
    assert.notEqual(env.details.backdropGroup, initialBackdrop, 'Preset change rebuilds backdrop to performance tier')
    assert.equal(backdropDisposedCount, 1, 'Previous high-tier backdrop was cleanly disposed')
    assert.equal(env.details.backdropGroup.userData.qualityTier, 'performance')
    assert.equal(env.details.plinthMesh, initialPlinth, 'Plinth mesh reuses geometry and updates cap texture in-place')
    assert.equal(env.details.plinthMesh.material.map.image.width, 64, 'Plinth cap texture swapped to 64px in-place')
    assert.equal(engine.renderer.pixelRatio, 1)
    assert.equal(engine.renderer.shadowMap.enabled, false)
    assert.equal(engine.spotlight.castShadow, false)
    assert.equal(shadowMapDisposed, 1, 'Resizing flashlight shadow map disposes previous RenderTarget')

    const spallPerf = getLayerMeshes(initialMazeGroup.getObjectByName('deterioration-concrete-spall'))
    for (const sm of spallPerf) {
      assert.equal(sm.castShadow, false, 'Live switch to performance disables spallMesh.castShadow')
    }

    // Check cross-pool & player quality updates for performance preset
    assert.equal(getGalvanizedMetalTextureSet({ qualityPreset: 'performance' }).map.anisotropy, 1)
    assert.equal(getEnvironmentalPropTextureSet({ qualityPreset: 'performance' }).rustMetal.map.anisotropy, 1)
    assert.equal(engine.getPlayer().userData.qualityPreset, 'performance')
    assert.equal(engine.getPlayer().getObjectByName('maze-player-torso-jacket').material.map.image.width, 64)
    assert.equal(getPlayerTextureSet({ qualityPreset: 'performance' }).jacket.map.anisotropy, 1)
    assert.deepEqual(
      getPlayerTexturePoolStats(),
      { presetsCached: 1, textures: 15 },
      'Single-engine preset switch prunes obsolete player texture pool'
    )

    // C) Live switch: performance -> balanced -> high
    engine.updateGraphicsConfig({ qualityPreset: 'balanced' })
    assert.equal(env.details.backdropGroup.userData.qualityTier, 'balanced')
    assert.equal(env.details.plinthMesh.material.map.image.width, 128)
    assert.equal(engine.getPlayer().userData.qualityPreset, 'balanced')
    assert.equal(engine.getPlayer().getObjectByName('maze-player-torso-jacket').material.map.image.width, 128)
    assert.equal(getPlayerTextureSet({ qualityPreset: 'balanced' }).jacket.map.anisotropy, 4)
    assert.equal(engine.renderer.pixelRatio, 1.5)
    assert.equal(engine.renderer.shadowMap.enabled, true)
    assert.equal(engine.spotlight.castShadow, true)
    assert.equal(engine.spotlight.shadow.mapSize.width, 512)
    assert.equal(getGalvanizedMetalTextureSet({ qualityPreset: 'balanced' }).map.anisotropy, 4)
    assert.equal(getEnvironmentalPropTextureSet({ qualityPreset: 'balanced' }).rustMetal.map.anisotropy, 4)
    for (const sm of spallPerf) {
      assert.equal(sm.castShadow, true, 'Live switch to balanced enables spallMesh.castShadow')
    }

    // Switching only particlesEnabled=false must NOT rebuild backdropGroup!
    const balancedBackdrop = env.details.backdropGroup
    engine.updateGraphicsConfig({ particlesEnabled: false })
    assert.equal(env.details.dustPoints, null, 'Disabling particles removes dustPoints')
    assert.equal(env.details.backdropGroup, balancedBackdrop, 'Disabling particles does NOT rebuild backdropGroup')

    // D) Live antialias toggle recreates WebGLRenderer cleanly
    const prevRendererCount = stats.created.length
    engine.updateGraphicsConfig({ qualityPreset: 'high', antialias: false, particlesEnabled: true })
    assert.equal(stats.created.length, prevRendererCount + 1, 'Toggling antialias recreates renderer once')
    assert.equal(stats.disposedCount, 1, 'Old renderer disposed when recreated')
    assert.equal(engine.getRendererCapabilities().antialiasActive, false)
    assert.equal(engine.renderer.shadowMap.enabled, true)
    assert.equal(engine.spotlight.shadow.mapSize.width, 1024)
    assert.equal(getGalvanizedMetalTextureSet({ qualityPreset: 'high' }).map.anisotropy, 8)
    assert.equal(getEnvironmentalPropTextureSet({ qualityPreset: 'high' }).rustMetal.map.anisotropy, 8)
    assert.equal(engine.getPlayer().userData.qualityPreset, 'high')
    assert.equal(engine.getPlayer().getObjectByName('maze-player-torso-jacket').material.map.image.width, 256)
    assert.equal(getPlayerTextureSet({ qualityPreset: 'high' }).jacket.map.anisotropy, 8)
  } finally {
    engine.dispose()
    restoreWindow()
  }
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })
  console.log('✓ Live preset transitions, selective rebuilds & antialias renderer swap verified')
}

// 3. Difficulty switch / maze reset persistence, lowPerformance init, software WebGL fallback & reinit
{
  console.log('Test 3: Maze reset/difficulty persistence, lowPerformance init, software WebGL fallback & reinit')
  disposeAllSharedPools()

  // A) lowPerformance default init without explicit config.graphics
  const { engine: lowEngine, restoreWindow: restoreLow } = createEngine({
    lowPerformance: true,
    maxAniso: 8,
  })
  try {
    assert.equal(lowEngine.getGraphicsConfig().qualityPreset, 'balanced', 'lowPerformance aligns graphicsConfig.qualityPreset to balanced')
    assert.equal(lowEngine.getPerformanceProfile().qualityPreset, 'balanced')
    lowEngine.setMaze(generateMaze({ difficulty: 'small', seed: 7073 }))
    assert.equal(
      lowEngine.getMazeGroup().userData.wallMat.userData.concreteWeatherUniforms.uConcreteDetail.value,
      0.5,
      'lowPerformance maze builds balanced 0.5 shader detail'
    )
    assert.equal(lowEngine.spotlight.shadow.mapSize.width, 512, 'lowPerformance uses balanced 512 shadow map')
    // Toggling orthogonal option keeps balanced qualityPreset!
    lowEngine.updateGraphicsConfig({ volumetricFog: false })
    assert.equal(lowEngine.getPerformanceProfile().qualityPreset, 'balanced')
  } finally {
    lowEngine.dispose()
    restoreLow()
  }

  // B) Switching difficulty / maze reset preserves live preset updates (even if constructor had config.enemies.maxEnemyLights)
  const { engine: resetEngine, restoreWindow: restoreReset } = createEngine({
    graphics: { qualityPreset: 'high' },
    enemies: { maxEnemyLights: 2 },
  })
  try {
    resetEngine.setMaze(generateMaze({ difficulty: 'small', seed: 7074 }))
    assert.equal(resetEngine.getPerformanceProfile().maxEnemyLights, 2)

    resetEngine.updateGraphicsConfig({ qualityPreset: 'performance' })
    assert.equal(resetEngine.getPerformanceProfile().maxEnemyLights, 0)

    // Switch difficulty to hardcore (7 enemies) -> live preset MUST persist instead of reverting to config.enemies.maxEnemyLights!
    resetEngine.setMaze(generateMaze({ difficulty: 'hardcore', seed: 7075 }))
    assert.equal(resetEngine.getGraphicsConfig().qualityPreset, 'performance')
    assert.equal(resetEngine.getPerformanceProfile().maxEnemyLights, 0)
    const hardcoreEnemyLights = resetEngine.getEnemies().filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length
    assert.equal(hardcoreEnemyLights, 0, 'Enemy PointLights stay disabled after difficulty switch under performance preset')

    const poolEntriesBeforeReset = getMazeSurfacePoolStats().entries
    resetEngine.setMaze(generateMaze({ difficulty: 'medium', seed: 7076 }))
    assert.equal(getMazeSurfacePoolStats().entries, poolEntriesBeforeReset, 'Same-preset maze reset causes zero surface pool growth')
  } finally {
    resetEngine.dispose()
    restoreReset()
  }

  // C) Software WebGL fallback resists high preset & antialias toggles
  const { engine: swEngine, stats: swStats, restoreWindow: restoreSw } = createEngine({
    isSoftwareGl: true,
    maxAniso: 1,
  })
  try {
    swEngine.setMaze(generateMaze({ difficulty: 'large', seed: 7077 }))
    const initialRendererCount = swStats.created.length

    swEngine.updateGraphicsConfig({
      qualityPreset: 'high',
      antialias: true,
      dynamicLights: true,
      particlesEnabled: true,
    })

    assert.equal(swStats.created.length, initialRendererCount, 'Software WebGL ignores antialias=true without recreating renderer')
    assert.equal(swEngine.renderer.pixelRatio, 1, 'Software WebGL forces pixelRatio = 1')
    assert.equal(swEngine.renderer.shadowMap.enabled, false, 'Software WebGL keeps shadowMap disabled')
    assert.equal(swEngine.spotlight.castShadow, false, 'Software WebGL keeps flashlight shadow disabled')
    assert.equal(swEngine.getPerformanceProfile().maxEnemyLights, 0, 'Software WebGL keeps enemy lights disabled')
    assert.equal(swEngine.getPerformanceProfile().antialias, false)
    assert.equal(getGalvanizedMetalTextureSet({ qualityPreset: 'high' }).map.anisotropy, 1)

    const swLights = swEngine.getMazeGroup().getObjectByName('maze-ceiling-lights-group').userData
    swEngine.stepFrame(0.016, { render: false })
    assert.equal(swLights.pointLightPool.filter((l) => l.visible).length, 0)
    assert.equal(swLights.shadowSpotPool.filter((l) => l.visible).length, 0)
  } finally {
    swEngine.dispose()
    restoreSw()
  }

  // D) Disposal & clean reinitialization
  assert.equal(getActiveSharedPoolOwnerCount(), 0)
  assert.equal(getMazeSurfacePoolStats().entries, 0)
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  const { engine: reinitEngine, restoreWindow: restoreReinit } = createEngine({
    graphics: { qualityPreset: 'balanced' },
  })
  try {
    reinitEngine.setMaze(generateMaze({ difficulty: 'small', seed: 7078 }))
    assert.equal(reinitEngine.getGraphicsConfig().qualityPreset, 'balanced')
    assert.equal(reinitEngine.getMazeGroup().userData.wallMat.map.image.width, 256)
    assert.equal(reinitEngine.getPlayer().userData.qualityPreset, 'balanced')
    assert.equal(reinitEngine.getPlayer().getObjectByName('maze-player-torso-jacket').material.map.image.width, 128)
    reinitEngine.stepFrame(0.016, { render: false })
  } finally {
    reinitEngine.dispose()
    restoreReinit()
  }
  assert.equal(getActiveSharedPoolOwnerCount(), 0)
  assert.equal(getMazeSurfacePoolStats().entries, 0)
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  // E) Multi-engine isolation & constructor initialization-failure cleanup
  const { engine: engineA, restoreWindow: restoreA } = createEngine({
    graphics: { qualityPreset: 'high' },
  })
  const { engine: engineB, restoreWindow: restoreB } = createEngine({
    graphics: { qualityPreset: 'high' },
  })
  try {
    const sharedMaze = generateMaze({ difficulty: 'small', seed: 7079 })
    engineA.setMaze(sharedMaze)
    engineB.setMaze(sharedMaze)
    assert.equal(getPlayerTexturePresetRefCount('high'), 2)

    engineA.updateGraphicsConfig({ qualityPreset: 'performance' })
    assert.equal(engineA.getPlayer().userData.qualityPreset, 'performance')
    assert.equal(engineB.getPlayer().userData.qualityPreset, 'high')
    assert.equal(getPlayerTexturePresetRefCount('high'), 1)
    assert.equal(getPlayerTexturePresetRefCount('performance'), 1)

    engineA.dispose()
    assert.equal(getPlayerTexturePresetRefCount('performance'), 0)
    assert.equal(getPlayerTexturePresetRefCount('high'), 1)
    assert.ok(getPlayerTexturePoolStats().presetsCached >= 1, 'Remaining engine keeps its player textures cached')
  } finally {
    engineA.dispose()
    engineB.dispose()
    restoreA()
    restoreB()
  }
  assert.equal(getActiveSharedPoolOwnerCount(), 0)
  assert.deepEqual(getPlayerTexturePoolStats(), { presetsCached: 0, textures: 0 })

  // Constructor renderer failure releases shared pool owner cleanly
  const hostFail = createMockHost()
  assert.throws(() => {
    new MazeSceneEngine(hostFail, {
      createRenderer: () => {
        throw new Error('Simulated WebGL failure')
      },
    })
  }, /Simulated WebGL failure/)
  assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Failed constructor releases shared pool ownership')

  console.log('✓ Reset persistence, lowPerformance alignment, software WebGL fallback & reinitialization verified')
}

console.log('=== ALL PHASE 7 QUALITY-PRESET & LIVE CONFIG TESTS PASSED! ===')
