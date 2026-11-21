import assert from 'node:assert/strict'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { buildEnemy } from './buildEnemy.js'
import { NON_SHADOW_CASTING_PROP_PARTS } from './buildEnvironmentalProps.js'
import { buildHidingSpotMesh } from './buildHidingSpots.js'
import { disposeMazeGroup } from './buildMazeMeshes.js'
import {
  buildCeilingLights,
  invalidateOverheadShadowCache,
  stepCeilingLights,
} from './buildCeilingLights.js'
import { disposeAllSharedPools } from './sharedResources.js'

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

/**
 * Mirrors Three.js WebGLShadowMap.render() lifecycle in headless Node tests:
 * renders shadow map when enabled && (shadow.autoUpdate || shadow.needsUpdate),
 * allocates/reuses mock RenderTarget on light.shadow.map, and resets shadow.needsUpdate = false.
 */
function createShadowCountingRendererFactory() {
  const stats = {
    framesRendered: 0,
    flashlightShadowPasses: 0,
    overheadShadowPasses: 0,
    totalShadowPasses: 0,
    shadowMapsCreated: 0,
    shadowMapsDisposed: 0,
    resetCounts() {
      this.framesRendered = 0
      this.flashlightShadowPasses = 0
      this.overheadShadowPasses = 0
      this.totalShadowPasses = 0
    },
  }

  const createRenderer = () => {
    const renderer = {
      domElement: { parentNode: null, style: {} },
      capabilities: { getMaxAnisotropy: () => 16 },
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 1,
      shadowMap: { enabled: true, type: null, needsUpdate: false },
      pixelRatio: 1,
      setPixelRatio(r) {
        this.pixelRatio = r
      },
      setSize() {},
      getContext() {
        return { getContextAttributes: () => ({ antialias: true }) }
      },
      render(scene) {
        stats.framesRendered += 1
        if (!scene || !this.shadowMap?.enabled) return
        scene.traverse((obj) => {
          if (!obj.isLight || !obj.visible || !obj.castShadow || !obj.shadow) return
          const shadow = obj.shadow
          if (!shadow.autoUpdate && !shadow.needsUpdate) return
          if (!shadow.map) {
            stats.shadowMapsCreated += 1
            shadow.map = {
              width: shadow.mapSize?.width || 512,
              height: shadow.mapSize?.height || 512,
              dispose() {
                stats.shadowMapsDisposed += 1
              },
            }
          }
          shadow.needsUpdate = false
          stats.totalShadowPasses += 1
          if (String(obj.name || '').startsWith('maze-ceiling-overhead-spot')) {
            stats.overheadShadowPasses += 1
          } else {
            stats.flashlightShadowPasses += 1
          }
        })
      },
      dispose() {},
    }
    return renderer
  }

  return { createRenderer, stats }
}

function findOpenNeighbor(maze, cell) {
  const dirs = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ]
  for (const [dr, dc] of dirs) {
    const r = cell.row + dr
    const c = cell.col + dc
    if (maze.grid[r]?.[c] === CELL_TYPES.PATH) {
      return { row: r, col: c }
    }
  }
  return cell
}

console.log('--- RUNNING PHASE 6A SHADOW PASS REDUCTION & CASTER PRUNING TESTS ---')

// ---------------------------------------------------------------------------
// 1. Stationary Flashlight Caching & First-Render / Activation Transitions
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Stationary flashlight shadow caching, first render & activation/deactivation')
  disposeAllSharedPools()

  const maze = generateMaze({ difficulty: 'small', seed: 6101 })
  const { createRenderer, stats } = createShadowCountingRendererFactory()
  const engine = new MazeSceneEngine(createMockHost(), {
    createRenderer,
    graphics: { qualityPreset: 'high' },
    enemies: { autoSpawn: false },
  })

  try {
    engine.setMaze(maze)
    assert.equal(engine.spotlight.shadow.autoUpdate, false, 'Flashlight shadow.autoUpdate is disabled')
    assert.equal(engine.spotlight.visible, false, 'Flashlight starts inactive')

    // Frame with flashlight OFF renders 0 flashlight shadow passes
    stats.resetCounts()
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 0, 'Inactive flashlight renders 0 shadow passes')

    // Toggle flashlight ON -> triggers exactly 1 shadow pass on next rendered frame
    engine.toggleFlashlight()
    assert.equal(engine.spotlight.visible, true)
    assert.equal(engine.spotlight.shadow.needsUpdate, true, 'Activating flashlight marks shadow dirty')
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, 'First active render computes flashlight shadow map once')
    assert.equal(engine.spotlight.shadow.needsUpdate, false, 'Renderer consumes needsUpdate')

    // Stationary loop for 60 frames -> ZERO additional flashlight shadow passes!
    stats.resetCounts()
    for (let i = 0; i < 60; i += 1) {
      engine.stepFrame(0.016)
    }
    assert.equal(
      stats.flashlightShadowPasses,
      0,
      'Stationary flashlight stays cached across 60 frames with 0 shadow passes'
    )

    // Deactivate & reactivate flashlight -> clean single refresh on reactivation
    engine.toggleFlashlight()
    assert.equal(engine.spotlight.visible, false)
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 0)

    engine.toggleFlashlight()
    assert.equal(engine.spotlight.visible, true)
    assert.equal(engine.spotlight.shadow.needsUpdate, true, 'Reactivating flashlight triggers fresh shadow update')
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, 'Reactivation renders 1 shadow pass then caches again')

    stats.resetCounts()
    for (let i = 0; i < 15; i += 1) {
      engine.stepFrame(0.016)
    }
    assert.equal(stats.flashlightShadowPasses, 0, 'Remains cached after reactivation settles')

    // Low battery flicker modulates intensity without re-rendering static shadow map!
    engine.battery = 15
    stats.resetCounts()
    for (let i = 0; i < 10; i += 1) {
      engine.stepFrame(0.05)
    }
    assert.equal(
      stats.flashlightShadowPasses,
      0,
      'Low-battery intensity flicker preserves cached static shadow map'
    )
  } finally {
    engine.dispose()
    disposeAllSharedPools()
  }
  console.log('✓ Stationary caching, first-render & flashlight toggle transitions verified')
}

// ---------------------------------------------------------------------------
// 2. Position, Orientation, Camera Mode & Paused Render Invalidation
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Movement, yaw/pitch rotation, 1P/3P switch & paused render invalidation')
  disposeAllSharedPools()

  const maze = generateMaze({ difficulty: 'small', seed: 6102 })
  const { createRenderer, stats } = createShadowCountingRendererFactory()
  const engine = new MazeSceneEngine(createMockHost(), {
    createRenderer,
    graphics: { qualityPreset: 'high' },
    enemies: { autoSpawn: false },
  })

  try {
    engine.setMaze(maze)
    engine.toggleFlashlight()
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1)

    // Look rotation invalidates
    stats.resetCounts()
    engine.applyLookDelta(25, 0)
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, 'Camera yaw rotation invalidates flashlight shadow')

    // Let camera damping settle and verify cache re-stabilizes
    for (let i = 0; i < 40; i += 1) {
      engine.stepFrame(0.016)
    }
    stats.resetCounts()
    for (let i = 0; i < 20; i += 1) {
      engine.stepFrame(0.016)
    }
    assert.equal(stats.flashlightShadowPasses, 0, 'Flashlight shadow stops updating once camera damping settles')

    // Movement invalidates every moved frame
    const neighbor = findOpenNeighbor(maze, maze.start)
    const startW = gridToWorld(maze.start.row, maze.start.col, maze)
    const neighW = gridToWorld(neighbor.row, neighbor.col, maze)
    const dirX = Math.sign(neighW.x - startW.x)
    const dirZ = Math.sign(neighW.z - startW.z)
    engine.setLookDirection(
      dirX > 0 ? -Math.PI / 2 : dirX < 0 ? Math.PI / 2 : dirZ > 0 ? Math.PI : 0,
      0
    )
    engine.cameraRig.snap()
    engine.stepFrame(0.016)

    stats.resetCounts()
    engine.stepMovement({ forwardAxis: 1, strafeAxis: 0 }, 0.05)
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, 'Player translation invalidates flashlight shadow')

    // Camera mode switch (1st-person -> 3rd-person) shifts spotlight rig origin
    for (let i = 0; i < 40; i += 1) engine.stepFrame(0.016)
    stats.resetCounts()
    engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
    engine.cameraRig.snap()
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, '1P->3P mode switch updates flashlight shadow')

    // Stationary in 3rd-person settles to 0 updates
    for (let i = 0; i < 40; i += 1) engine.stepFrame(0.016)
    stats.resetCounts()
    for (let i = 0; i < 15; i += 1) engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 0, 'Stationary 3rd-person flashlight stays cached')

    // Paused look delta + renderFrame() immediately updates shadow map
    engine.setPaused(true)
    stats.resetCounts()
    engine.setLookDirection(engine.cameraRig.getLookDirection().yaw + 0.5, 0)
    engine.cameraRig.snap()
    engine.renderFrame()
    assert.equal(stats.flashlightShadowPasses, 1, 'Paused pose change + renderFrame() refreshes shadow')
  } finally {
    engine.dispose()
    disposeAllSharedPools()
  }
  console.log('✓ Position, rotation, camera-mode & paused render invalidation verified')
}

// ---------------------------------------------------------------------------
// 3. Dynamic Casters Inside vs Behind Flashlight Beam
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Moving casters in beam invalidate; behind-player/stationary casters stay cached')
  disposeAllSharedPools()

  const maze = generateMaze({ difficulty: 'medium', seed: 6103 })
  const { createRenderer, stats } = createShadowCountingRendererFactory()
  const engine = new MazeSceneEngine(createMockHost(), {
    createRenderer,
    graphics: { qualityPreset: 'high' },
    enemies: { autoSpawn: false },
  })

  try {
    engine.setMaze(maze)
    engine.setPlayerGridPosition(maze.start.row, maze.start.col, { immediate: true })
    engine.setLookDirection(0, 0) // facing -Z
    engine.cameraRig.snap()
    engine.toggleFlashlight()
    engine.stepFrame(0.016)

    const p = engine._playerWorldPos
    // Spawn an enemy directly ahead in the beam (-Z)
    const enemy = engine.spawnEnemy({
      id: 'beam-stalker',
      type: 'stalker',
      position: { x: p.x, y: 0, z: p.z - 6 },
      patrolWaypoints: [],
    })
    assert.ok(enemy, 'Spawned test enemy ahead of player')

    // First frame noticing new enemy in beam invalidates
    stats.resetCounts()
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, 'Enemy entering beam invalidates flashlight shadow')

    // Stationary enemy -> 0 shadow passes
    stats.resetCounts()
    engine.stepFrame(0.016)
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 0, 'Stationary enemy in beam stays cached')

    // Moving enemy inside beam invalidates
    stats.resetCounts()
    enemy.mesh.position.x += 0.25
    engine.renderFrame()
    assert.equal(stats.flashlightShadowPasses, 1, 'Moving enemy in beam invalidates flashlight shadow')

    // Enemy patrolling well BEHIND player (+Z) is outside cone -> ignored!
    enemy.mesh.position.set(p.x, 0, p.z + 10)
    engine.renderFrame() // updates caster snapshot once as it exits cone
    stats.resetCounts()
    for (let i = 0; i < 10; i += 1) {
      enemy.mesh.position.x += 0.3
      engine.renderFrame()
    }
    assert.equal(
      stats.flashlightShadowPasses,
      0,
      'Enemy moving behind player outside spotlight cone does not re-render flashlight shadow'
    )

    // Hiding spot door swinging inside beam invalidates while moving, then caches
    const spots = engine.getHidingSpots()
    if (spots.length > 0) {
      const spot = spots[0]
      engine.setPlayerWorldPosition(spot.worldPos.x, 0, spot.worldPos.z + 4, { yaw: 0, immediate: true })
      engine.cameraRig.snap()
      engine.renderFrame()

      stats.resetCounts()
      spot.mesh.userData.doorPivot.rotation.y = -0.34
      engine.renderFrame()
      assert.equal(stats.flashlightShadowPasses, 1, 'Swinging hiding-spot door in beam refreshes shadow')

      stats.resetCounts()
      engine.renderFrame()
      assert.equal(stats.flashlightShadowPasses, 0, 'Static open hiding-spot door remains cached')
    }
  } finally {
    engine.dispose()
    disposeAllSharedPools()
  }
  console.log('✓ In-beam dynamic caster tracking & out-of-cone exclusion verified')
}

// ---------------------------------------------------------------------------
// 4. Maze Lifecycle, Exit Gate Unlock & Quality Preset Matrix
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Maze switches, exit gate unlock & quality preset shadow behavior')
  disposeAllSharedPools()

  const mazeA = generateMaze({ difficulty: 'small', seed: 6104 })
  const mazeB = generateMaze({ difficulty: 'medium', seed: 6105 })
  const { createRenderer, stats } = createShadowCountingRendererFactory()
  const engine = new MazeSceneEngine(createMockHost(), {
    createRenderer,
    graphics: { qualityPreset: 'high' },
    enemies: { autoSpawn: false },
  })

  try {
    engine.setMaze(mazeA)
    engine.toggleFlashlight()
    engine.stepFrame(0.016)

    // Exit lock state change invalidates static shadows
    stats.resetCounts()
    engine.setExitLocked(!engine.getIsExitLocked(), { animate: false })
    engine.renderFrame()
    assert.equal(stats.flashlightShadowPasses, 1, 'Exit gate state change invalidates flashlight shadow')

    // Maze switch resets cache cleanly and triggers fresh render on new maze
    stats.resetCounts()
    engine.setMaze(mazeB)
    engine.toggleFlashlight()
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, 'setMaze triggers initial flashlight shadow render')

    // Orthogonal toggle (volumetricFog / particlesEnabled) must NOT force overhead cache invalidation
    const ceilingLights = engine.getMazeGroup().userData.ceilingLightsGroup
    const verBefore = ceilingLights.userData._shadowCacheVersion
    stats.resetCounts()
    engine.updateGraphicsConfig({ volumetricFog: false, particlesEnabled: false })
    assert.equal(
      ceilingLights.userData._shadowCacheVersion,
      verBefore,
      'Orthogonal fog/particle toggles do not needlessly invalidate overhead shadow cache'
    )

    // Switch to Balanced: keeps 512px flashlight shadow cached; disables overhead shadow passes
    engine.updateGraphicsConfig({ qualityPreset: 'balanced' })
    assert.equal(engine.spotlight.castShadow, true)
    assert.equal(engine.spotlight.shadow.mapSize.width, 512)
    stats.resetCounts()
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, 'Preset resize to Balanced triggers single 512px shadow render')
    assert.equal(stats.overheadShadowPasses, 0, 'Balanced disables overhead shadow passes')

    stats.resetCounts()
    for (let i = 0; i < 15; i += 1) engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 0, 'Balanced stationary flashlight stays cached')

    // Switch to Performance: disables all shadow passes cleanly
    engine.updateGraphicsConfig({ qualityPreset: 'performance' })
    assert.equal(engine.spotlight.castShadow, false)
    assert.equal(engine.renderer.shadowMap.enabled, false)
    stats.resetCounts()
    for (let i = 0; i < 10; i += 1) engine.stepFrame(0.016)
    assert.equal(stats.totalShadowPasses, 0, 'Performance preset emits 0 shadow passes')

    // Restore High
    engine.updateGraphicsConfig({ qualityPreset: 'high' })
    assert.equal(engine.spotlight.castShadow, true)
    assert.equal(engine.spotlight.shadow.mapSize.width, 1024)
    stats.resetCounts()
    engine.stepFrame(0.016)
    assert.equal(stats.flashlightShadowPasses, 1, 'Returning to High triggers single 1024px shadow render')
  } finally {
    engine.dispose()
    disposeAllSharedPools()
  }
  console.log('✓ Maze reset, gate toggle, orthogonal config & preset matrix verified')
}

// ---------------------------------------------------------------------------
// 5. Overhead Shadow Flicker-Dip Preservation & Budget-0 Caster Skip
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Overhead shadow preserves cache across flicker dip & refreshes if caster moved')
  disposeAllSharedPools()

  const maze = generateMaze({ difficulty: 'small', seed: 6106 })
  const lightsGroup = buildCeilingLights(maze, { qualityPreset: 'high', dynamicLights: true })
  const ud = lightsGroup.userData
  const spot = ud.shadowSpotPool[0]
  const working = ud.fixtures.find((f) => f.condition === 'working')
  assert.ok(working, 'Test maze has working ceiling fixture')

  // Initial lock under fixture
  stepCeilingLights(lightsGroup, 0.1, {
    playerWorldPos: { x: working.x, z: working.z },
    qualityPreset: 'high',
    dynamicLights: true,
    dynamicShadowCasters: [],
  })
  assert.equal(spot.visible, true)
  assert.equal(spot.shadow.needsUpdate, true)
  spot.shadow.needsUpdate = false

  // Simulate temporary blackout/flicker dip where intensity drops below 0.01 on the same fixture
  const origCond = working.condition
  const origBase = working.baseIntensity
  working.baseIntensity = 0.0001
  stepCeilingLights(lightsGroup, 0.2, {
    playerWorldPos: { x: working.x, z: working.z },
    qualityPreset: 'high',
    dynamicLights: true,
    dynamicShadowCasters: [],
  })
  assert.equal(spot.visible, false, 'Dimmed fixture hides overhead spot temporarily')
  assert.equal(spot.shadow.needsUpdate, false, 'Hidden spot does not queue unnecessary update')

  // Restore intensity on SAME fixture with NO caster movement -> cached shadow remains valid!
  working.condition = origCond
  working.baseIntensity = origBase
  stepCeilingLights(lightsGroup, 0.3, {
    playerWorldPos: { x: working.x, z: working.z },
    qualityPreset: 'high',
    dynamicLights: true,
    dynamicShadowCasters: [],
  })
  assert.equal(spot.visible, true)
  assert.equal(
    spot.shadow.needsUpdate,
    false,
    'Recovering visibility on same fixture with static scene preserves cached shadow map'
  )

  // Now dim again, move a caster under the fixture while hidden, and recover -> MUST refresh!
  working.baseIntensity = 0.0001
  stepCeilingLights(lightsGroup, 0.4, {
    playerWorldPos: { x: working.x, z: working.z },
    qualityPreset: 'high',
    dynamicLights: true,
    dynamicShadowCasters: [{ x: working.x + 1.0, y: 0, z: working.z, ry: 0 }],
  })
  working.baseIntensity = origBase
  stepCeilingLights(lightsGroup, 0.5, {
    playerWorldPos: { x: working.x, z: working.z },
    qualityPreset: 'high',
    dynamicLights: true,
    dynamicShadowCasters: [{ x: working.x + 1.0, y: 0, z: working.z, ry: 0 }],
  })
  assert.equal(
    spot.shadow.needsUpdate,
    true,
    'Caster entering cone while spot was temporarily hidden refreshes shadow on recovery'
  )

  // Verify explicit invalidation still sets needsUpdate = true
  spot.shadow.needsUpdate = false
  invalidateOverheadShadowCache(lightsGroup)
  assert.equal(spot.shadow.needsUpdate, true)

  disposeAllSharedPools()
  console.log('✓ Overhead flicker-dip cache preservation & hidden-caster tracking verified')
}

// ---------------------------------------------------------------------------
// 6. Selective Shadow Caster Pruning & Hardcore Budget Verification
// ---------------------------------------------------------------------------
{
  console.log('Test 6: Selective shadow pruning across props, hiding spots, enemies & ceiling')
  disposeAllSharedPools()

  // A) Hiding spot: structural shell/doors cast shadows; plinth/grille/latch/indicators do not
  const hs = buildHidingSpotMesh({ id: 'test-hs', type: 'containment_locker' })
  const hsNonCasters = []
  const hsCasters = []
  hs.traverse((n) => {
    if (!n.isMesh) return
    if (n.castShadow) hsCasters.push(n.name)
    else hsNonCasters.push(n.name)
  })
  assert.equal(hsCasters.length, 10, 'Hiding spot retains 10 structural/door shadow casters')
  assert.equal(hsNonCasters.length, 7, 'Hiding spot prunes 7 tiny decorative sub-meshes')
  assert.ok(hsCasters.includes('hiding-spot-lower-door') && hsCasters.includes('hiding-spot-back-wall'))
  assert.ok(hsNonCasters.includes('hiding-spot-plinth') && hsNonCasters.includes('hiding-spot-latch'))

  // B) Enemies:
  // Wraith (stalker): gaunt skin & inner shadow robes cast shadows; translucent mist, veil & glowing eyes pruned
  {
    const wraith = buildEnemy({ type: 'stalker', id: 'test-stalker' })
    const nonCasters = []
    const casters = []
    wraith.traverse((n) => {
      if (!n.isMesh) return
      if (n.castShadow) casters.push(n.name)
      else nonCasters.push(n.name)
    })
    assert.ok(
      casters.includes('maze-enemy-wraith-torso') &&
        casters.includes('maze-enemy-wraith-head') &&
        casters.includes('maze-enemy-wraith-robe-skirt') &&
        casters.includes('maze-enemy-wraith-claw-hand-left')
    )
    assert.equal(
      nonCasters.length,
      5,
      'Wraith prunes 5 translucent/glowing meshes (upper veil, mist skirt, 2 mist tendrils, recessed eyes)'
    )
  }

  // Revenant (hunter): decayed body, head, ragged clothes, and limbs cast shadows; sparse hair & recessed dead eyes pruned
  {
    const revenant = buildEnemy({ type: 'hunter', id: 'test-hunter' })
    const nonCasters = []
    const casters = []
    revenant.traverse((n) => {
      if (!n.isMesh) return
      if (n.castShadow) casters.push(n.name)
      else nonCasters.push(n.name)
    })
    assert.ok(
      casters.includes('maze-enemy-revenant-torso') &&
        casters.includes('maze-enemy-revenant-flesh') &&
        casters.includes('maze-enemy-revenant-head') &&
        casters.includes('maze-enemy-revenant-hand-left')
    )
    assert.equal(
      nonCasters.length,
      2,
      'Revenant prunes 2 detail meshes (matted scalp hair and recessed dead eyes)'
    )
  }

  // Phantom (brute): primary shadow body/head/legs/arms/hands cast shadows; translucent shroud/veil/shoulder rags/eyes pruned
  {
    const phantom = buildEnemy({ type: 'brute', id: 'test-brute' })
    const nonCasters = []
    const casters = []
    phantom.traverse((n) => {
      if (!n.isMesh) return
      if (n.castShadow) casters.push(n.name)
      else nonCasters.push(n.name)
    })
    assert.ok(
      casters.includes('maze-enemy-phantom-torso') &&
        casters.includes('maze-enemy-phantom-head') &&
        casters.includes('maze-enemy-phantom-leg-left') &&
        casters.includes('maze-enemy-phantom-hand-left')
    )
    assert.equal(
      nonCasters.length,
      5,
      'Phantom prunes 5 translucent/glowing meshes (torso shroud, head veil, 2 shoulder rags, faint eyes)'
    )
  }

  // C) Full Hardcore Maze: verify ceiling details pruned + props selectively pruned
  const hardcore = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const { createRenderer } = createShadowCountingRendererFactory()
  const engine = new MazeSceneEngine(createMockHost(), {
    createRenderer,
    graphics: { qualityPreset: 'high' },
  })
  try {
    engine.setMaze(hardcore)
    const root = engine.getMazeGroup()
    const propsGroup = root.getObjectByName('maze-environmental-props')
    let prunedPropBatches = 0
    let keptPropBatches = 0
    for (const child of propsGroup.children) {
      if (NON_SHADOW_CASTING_PROP_PARTS.has(child.userData?.partName)) {
        assert.equal(child.castShadow, false, `Decorative prop batch ${child.name} skips shadow casting`)
        prunedPropBatches += 1
      } else {
        assert.equal(child.castShadow, true, `Structural prop batch ${child.name} retains shadow casting`)
        keptPropBatches += 1
      }
    }
    assert.ok(prunedPropBatches >= 30 && keptPropBatches >= 50, 'Selective prop pruning preserves primary silhouettes')

    for (const detailLayer of ['maze-ceiling-beam-details', 'maze-ceiling-pillar-details']) {
      const node = root.getObjectByName(detailLayer)
      assert.ok(node, `${detailLayer} exists`)
      node.traverse((n) => {
        if (n.isMesh) {
          assert.equal(n.castShadow, false, `${detailLayer} mesh ${n.name} skips shadow casting`)
          assert.equal(n.receiveShadow, true, `${detailLayer} mesh ${n.name} still receives shadows`)
        }
      })
    }

    // Primary structural walls/beams/pillars still cast shadows
    for (const primaryLayer of ['maze-walls', 'maze-ceiling-beams', 'maze-ceiling-pillars']) {
      const node = root.getObjectByName(primaryLayer)
      let found = 0
      node.traverse((n) => {
        if (n.isMesh || n.isInstancedMesh) {
          assert.equal(n.castShadow, true, `${primaryLayer} retains shadow casting`)
          found += 1
        }
      })
      assert.ok(found > 0)
    }

    disposeMazeGroup(hs)
  } finally {
    // D) Clean disposal verification
    let disposedShadowMaps = 0
    engine.toggleFlashlight()
    engine.stepFrame(0.016)
    if (engine.spotlight.shadow.map) {
      const origDispose = engine.spotlight.shadow.map.dispose
      engine.spotlight.shadow.map.dispose = () => {
        disposedShadowMaps += 1
        origDispose?.()
      }
    }
    engine.dispose()
    assert.equal(disposedShadowMaps, 1, 'Engine dispose frees spotlight shadow map cleanly')
    assert.equal(engine._flashlightShadowCache, null, 'Engine dispose clears flashlight shadow cache state')
    disposeAllSharedPools()
  }
  console.log('✓ Selective shadow caster pruning & clean disposal verified')
}

console.log('=== ALL PHASE 6A SHADOW REDUCTION & CASTER PRUNING TESTS PASSED! ===')
