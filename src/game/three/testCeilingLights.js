import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { WALL_HEIGHT, gridToWorld } from '../world/worldCoords.js'
import {
  CEILING_LIGHT_CLEARANCE_MIN_Y,
  CEILING_LIGHT_PALETTE,
  CEILING_LIGHT_STATES,
  CEILING_LIGHT_TYPES,
  getCeilingLightPoolStats,
  resolveOverheadPointLightBudget,
  stepCeilingLights,
} from './buildCeilingLights.js'
import { getCeilingVentPoolStats } from './buildCeilingVents.js'
import { MAZE_CEILING_CONFIG } from './buildMazeCeiling.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { CAMERA_MODES, MAX_THIRD_PERSON_HEIGHT } from './CameraRig.js'
import { HORROR_EVENT_TYPES } from './HorrorDirector.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { getMazeSurfacePoolStats, getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'
import { getBackdropPoolStats } from './undergroundBackdrop.js'

console.log('--- RUNNING FACILITY OVERHEAD INDUSTRIAL LIGHTING TESTS ---')

function createMockRenderer() {
  const renderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: {
      enabled: false,
      type: null,
      needsUpdate: false,
    },
    pixelRatio: 1,
    setPixelRatio: (r) => {
      renderer.pixelRatio = r
    },
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  return renderer
}

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  const mockRenderer = createMockRenderer()
  const engine = new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    isSoftwareGl: false,
    lowPerformance: false,
    ...config,
  })
  return { engine, mockRenderer }
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Fixture Types, Placement, Bay Alignment, Beam/Vent Non-Obstruction & Clearances
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Fixture designs, placement, structural clearances & vent non-obstruction')

  const BRUTE_MAX_HEIGHT = 2.15 * 1.24 // 2.666m
  const EXIT_GATE_TOP_Y = 2.91
  const WALL_OUTLINE_TOP_Y = WALL_HEIGHT + 0.012 // 3.012m
  const MIN_REQUIRED_CLEARANCE = Math.max(
    1.8,
    BRUTE_MAX_HEIGHT,
    MAX_THIRD_PERSON_HEIGHT,
    EXIT_GATE_TOP_Y,
    WALL_OUTLINE_TOP_Y,
    MAZE_CEILING_CONFIG.beamBottomY
  )

  getMazeSurfaceTextureSet()

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 6464 })
    const t0 = performance.now()
    const group = buildMazeMeshes(maze)
    const buildMs = performance.now() - t0
    assert.ok(buildMs < 500, `buildMazeMeshes(${difficulty}) stays < 500ms with overhead lights (${buildMs.toFixed(1)}ms)`)

    // Preserve root instanced mesh count (2: walls & caps) & ceiling slab height
    assert.equal(group.children.filter((c) => c.isInstancedMesh).length, 2)
    assert.equal(group.userData.ceilingGroup.userData.soffitY, MAZE_CEILING_CONFIG.soffitY)

    const lightsGroup = group.getObjectByName('maze-ceiling-lights-group')
    const housingMesh = group.getObjectByName('maze-ceiling-light-housings')
    const diffuserMesh = group.getObjectByName('maze-ceiling-light-diffusers')
    const haloMesh = group.getObjectByName('maze-ceiling-light-halos')
    assert.ok(lightsGroup && housingMesh && diffuserMesh && haloMesh, `Overhead light meshes exist on ${difficulty}`)

    // All fixture meshes & pooled overhead PointLights keep castShadow = false (no extra shadow maps)
    for (const mesh of [housingMesh, diffuserMesh, haloMesh]) {
      assert.equal(mesh.castShadow, false, `${mesh.name} never casts corridor-blocking shadows`)
    }
    assert.equal(housingMesh.receiveShadow, true, 'Fixture metal housings receive flashlight shadows')
    for (const pt of lightsGroup.userData.pointLightPool) {
      assert.equal(pt.castShadow, false, `${pt.name} avoids expensive real-time shadow maps`)
    }

    // Check shared pool usage on unit geometries / halo texture
    assert.equal(isSharedResource(diffuserMesh.geometry), true)
    assert.equal(isSharedResource(haloMesh.geometry), true)
    assert.equal(isSharedResource(haloMesh.material.map), true)

    // Verify strict vertical clearance (>= 3.30m) & non-overlap with concrete beams/ribs
    housingMesh.geometry.computeBoundingBox()
    const hBox = housingMesh.geometry.boundingBox
    assert.ok(
      hBox.min.y >= CEILING_LIGHT_CLEARANCE_MIN_Y && hBox.min.y > MIN_REQUIRED_CLEARANCE,
      `Fixture housings on ${difficulty} clear beams/camera/actors (minY=${hBox.min.y.toFixed(3)}m > ${MIN_REQUIRED_CLEARANCE.toFixed(3)}m)`
    )
    assert.ok(
      hBox.max.y <= MAZE_CEILING_CONFIG.soffitY + 0.01,
      `Fixture housings sit flush against ceiling soffit (${hBox.max.y.toFixed(3)}m)`
    )

    const evenRowZs = []
    for (let r = 2; r <= maze.rows - 3; r += 2) evenRowZs.push(gridToWorld(r, 0, maze).z)
    const evenColXs = []
    for (let c = 2; c <= maze.cols - 3; c += 2) evenColXs.push(gridToWorld(0, c, maze).x)
    const oddRowZs = []
    for (let r = 1; r <= maze.rows - 2; r += 2) oddRowZs.push(gridToWorld(r, 0, maze).z)

    const beamHalf = MAZE_CEILING_CONFIG.beamWidth * 0.5
    const ribHalf = MAZE_CEILING_CONFIG.ribWidth * 0.5
    const pos = housingMesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i += 1) {
      const vx = pos.getX(i)
      const vz = pos.getZ(i)
      for (const rz of evenRowZs) {
        assert.ok(Math.abs(vz - rz) >= beamHalf, `Fixture housing avoids evenRowZ girder on ${difficulty}`)
      }
      for (const cx of evenColXs) {
        assert.ok(Math.abs(vx - cx) >= beamHalf, `Fixture housing avoids evenColX girder on ${difficulty}`)
      }
      for (const orz of oddRowZs) {
        assert.ok(Math.abs(vz - orz) >= ribHalf, `Fixture housing avoids oddRowZ rib on ${difficulty}`)
      }
    }

    // Check fixture types, condition distribution, walkable corridor alignment & zero vent overlap
    const ud = lightsGroup.userData
    const vents = group.userData.ceilingVentsGroup?.userData?.ventMetadata || []
    const typesSeen = new Set()
    const statesSeen = new Set()

    assert.ok(ud.fixtureCount >= 4, `${difficulty} places multiple overhead fixtures (${ud.fixtureCount})`)
    assert.ok(
      ud.workingCount >= Math.ceil(ud.fixtureCount * 0.5),
      `${difficulty} keeps majority working fixtures (${ud.workingCount}/${ud.fixtureCount})`
    )

    for (const f of ud.fixtures) {
      assert.equal(maze.grid[f.cellRow][f.cellCol], CELL_TYPES.PATH, 'Fixture sits over walkable PATH cell')
      assert.ok(CEILING_LIGHT_TYPES.includes(f.designType))
      typesSeen.add(f.designType)
      statesSeen.add(f.condition)

      for (const vm of vents) {
        const dist = Math.hypot(f.x - vm.cx, f.z - vm.cz)
        assert.ok(dist >= 0.45, `Fixture clears ceiling vent cleanly (dist=${dist.toFixed(2)}m)`)
      }
    }

    assert.equal(typesSeen.size, 3, `${difficulty} uses all 3 industrial fixture designs`)
    if (difficulty !== 'small') {
      assert.ok(statesSeen.size >= 2, `${difficulty} includes multiple deterministic light states`)
    }

    // Verify deterministic parity across identical maze/seed rebuilds
    const groupB = buildMazeMeshes(maze)
    const fA = lightsGroup.userData.fixtures.map((f) => `${f.cellRow},${f.cellCol}:${f.designType}:${f.condition}`)
    const fB = groupB.getObjectByName('maze-ceiling-lights-group').userData.fixtures.map(
      (f) => `${f.cellRow},${f.cellCol}:${f.designType}:${f.condition}`
    )
    assert.deepEqual(fA, fB, `Fixture placement & states deterministic on ${difficulty}`)

    disposeMazeGroup(group)
    disposeMazeGroup(groupB)
  }

  disposeAllSharedPools()
  console.log('✓ All 4 difficulties preserve headroom, avoid beams/vents & include varied fixtures')
}

// ---------------------------------------------------------------------------
// 2. Lighting States, Eye-Safe Flicker, Graphics Presets & Reduced Motion
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Lighting states, comfortable flicker modulation, presets & reduced motion')

  const maze = generateMaze({ difficulty: 'large', seed: 3131 })
  const group = buildMazeMeshes(maze, { qualityPreset: 'high', dynamicLights: true })
  const lightsGroup = group.getObjectByName('maze-ceiling-lights-group')
  const { fixtures, pointLightPool, diffuserEntries, diffuserMesh, haloMesh } = lightsGroup.userData

  // Check active/burned-out separation
  const workingFixture = fixtures.find((f) => f.condition === CEILING_LIGHT_STATES.WORKING)
  const flickerFixture = fixtures.find((f) => f.condition === CEILING_LIGHT_STATES.FLICKERING)
  const burnedFixture = fixtures.find((f) => f.condition === CEILING_LIGHT_STATES.BURNED_OUT)
  assert.ok(workingFixture && flickerFixture && burnedFixture, 'Large maze contains working, flickering & burned_out states')

  // Sample flickering behavior over time: irregular dips stay comfortable (>= 0.38 * base, never extreme strobe)
  const flickerSamples = []
  for (let s = 0; s < 40; s += 1) {
    const t = s * 0.12
    stepCeilingLights(lightsGroup, t, {
      playerWorldPos: { x: flickerFixture.x, z: flickerFixture.z },
      lightScale: 1,
      reducedMotion: false,
      qualityPreset: 'high',
      dynamicLights: true,
    })
    flickerSamples.push(flickerFixture._liveIntensity)
    assert.equal(burnedFixture._liveIntensity, 0, 'Burned-out fixture never emits live light')
    assert.ok(
      flickerFixture._liveIntensity >= flickerFixture.baseIntensity * 0.35 &&
        flickerFixture._liveIntensity <= flickerFixture.baseIntensity * 1.05,
      'Flicker stays within comfortable restrained range (no jarring flash)'
    )
  }
  const fMin = Math.min(...flickerSamples)
  const fMax = Math.max(...flickerSamples)
  assert.ok(fMax - fMin > 0.12, `Flickering fixture exhibits subtle irregular modulation (${fMin.toFixed(2)}..${fMax.toFixed(2)})`)

  // Verify Burned-out diffuser stays darkened compared to lit fixture diffuser
  const burnedDiffIdx = diffuserEntries.findIndex((d) => d.fixtureIndex === burnedFixture.index)
  const workingDiffIdx = diffuserEntries.findIndex((d) => d.fixtureIndex === workingFixture.index)
  const cBurn = new THREE.Color()
  const cWork = new THREE.Color()
  diffuserMesh.getColorAt(burnedDiffIdx, cBurn)
  diffuserMesh.getColorAt(workingDiffIdx, cWork)
  assert.ok(cWork.b > cBurn.b * 3, 'Lit diffuser glows clearly brighter than burned-out diffuser')

  // Reduced motion: flickering fixtures lock calmly without oscillatory changes
  stepCeilingLights(lightsGroup, 0.4, { reducedMotion: true, qualityPreset: 'high' })
  const rmLevelA = flickerFixture._liveIntensity
  stepCeilingLights(lightsGroup, 2.7, { reducedMotion: true, qualityPreset: 'high' })
  const rmLevelB = flickerFixture._liveIntensity
  assert.equal(rmLevelA, rmLevelB, 'Reduced motion eliminates flicker oscillation completely')

  // Graphics presets strictly enforce dynamic PointLight & halo budgets
  assert.equal(resolveOverheadPointLightBudget({ qualityPreset: 'performance' }), 0)
  assert.equal(resolveOverheadPointLightBudget({ qualityPreset: 'balanced' }), 2)
  assert.equal(resolveOverheadPointLightBudget({ qualityPreset: 'high' }), 4)

  stepCeilingLights(lightsGroup, 0.5, { qualityPreset: 'performance', dynamicLights: true })
  assert.equal(pointLightPool.filter((p) => p.visible).length, 0, 'Performance preset disables overhead PointLights')
  assert.equal(haloMesh.visible, false, 'Performance preset hides additive diffuser halos')

  stepCeilingLights(lightsGroup, 0.5, { qualityPreset: 'balanced', dynamicLights: true })
  assert.ok(pointLightPool.filter((p) => p.visible).length <= 2, 'Balanced preset caps overhead PointLights <= 2')
  assert.equal(haloMesh.visible, true)

  stepCeilingLights(lightsGroup, 0.5, { qualityPreset: 'high', dynamicLights: true })
  assert.ok(pointLightPool.filter((p) => p.visible).length <= 4, 'High preset caps overhead PointLights <= 4')

  stepCeilingLights(lightsGroup, 0.5, { qualityPreset: 'high', dynamicLights: false })
  assert.equal(pointLightPool.filter((p) => p.visible).length, 0, 'dynamicLights=false disables overhead PointLights')

  disposeMazeGroup(group)
  disposeAllSharedPools()
  console.log('✓ Lighting states, gentle flicker, reduced motion & preset budgets verified')
}

// ---------------------------------------------------------------------------
// 3. Engine Integration, HorrorDirector Blackout, High Contrast & Zero-Leak Disposal
// ---------------------------------------------------------------------------
{
  console.log('Test 3: HorrorDirector blackout sync, High Contrast mode, presets & clean disposal')

  const maze = generateMaze({ difficulty: 'medium', seed: 5050 })
  const { engine } = createHeadlessEngine({ cameraMode: CAMERA_MODES.FIRST_PERSON })
  engine.setMaze(maze)

  const mazeGroup = engine.getMazeGroup()
  const lightsGroup = mazeGroup.getObjectByName('maze-ceiling-lights-group')
  const { pointLightPool, haloMesh } = lightsGroup.userData

  engine.stepFrame(0.016, { render: false })
  const baselineLitIntensity = pointLightPool.reduce((sum, pt) => sum + (pt.visible ? pt.intensity : 0), 0)
  assert.ok(baselineLitIntensity > 0, 'Active overhead PointLights illuminate nearby ceiling bay at rest')

  // HorrorDirector blackout must dim ceiling lights & diffusers and restore cleanly afterward
  const director = engine.getHorrorDirector()
  director.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: engine.getEnemies(),
  })
  director.update(0.7, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: engine.getEnemies(),
  })
  const blackoutIntensity = pointLightPool.reduce((sum, pt) => sum + (pt.visible ? pt.intensity : 0), 0)
  assert.ok(
    blackoutIntensity < baselineLitIntensity * 0.4,
    `Overhead PointLights dim during HorrorDirector blackout (${blackoutIntensity.toFixed(2)} < ${baselineLitIntensity.toFixed(2)})`
  )

  // End blackout -> lights cleanly restore
  director.update(4.5, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: engine.getEnemies(),
  })
  const restoredIntensity = pointLightPool.reduce((sum, pt) => sum + (pt.visible ? pt.intensity : 0), 0)
  assert.ok(
    Math.abs(restoredIntensity - baselineLitIntensity) < 0.2,
    `Overhead PointLights restore after blackout (${restoredIntensity.toFixed(2)} vs ${baselineLitIntensity.toFixed(2)})`
  )

  // High Contrast mode hides distracting halos & keeps subdued diffusers while preserving housings
  engine.setHighContrast(true)
  assert.equal(haloMesh.visible, false, 'High Contrast disables additive diffuser halos')
  assert.equal(lightsGroup.userData.housingMat.color.getHex(), CEILING_LIGHT_PALETTE.housingMetal)
  engine.setHighContrast(false)
  assert.equal(haloMesh.visible, true, 'Disabling High Contrast restores overhead halos on High preset')

  // Switch camera mode + graphics presets safely
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.stepFrame(0.016, { render: false })
  for (const preset of ['performance', 'balanced', 'high']) {
    engine.updateGraphicsConfig({ qualityPreset: preset })
    engine.stepFrame(0.016, { render: false })
    const expectedCap = preset === 'performance' ? 0 : preset === 'balanced' ? 2 : 4
    assert.ok(pointLightPool.filter((p) => p.visible).length <= expectedCap, `Preset ${preset} enforces light cap ${expectedCap}`)
  }

  engine.dispose()
  assert.equal(getCeilingLightPoolStats().entries, 0, 'Ceiling light pool disposed cleanly')
  assert.equal(getCeilingVentPoolStats().entries, 0, 'Ceiling vent pool disposed cleanly')
  assert.equal(getMazeSurfacePoolStats().entries, 0, 'Maze surface pool disposed cleanly')
  assert.equal(getBackdropPoolStats().entries, 0, 'Backdrop pool disposed cleanly')
  console.log('✓ HorrorDirector blackout, High Contrast, cameras, presets & clean disposal verified')
}

console.log('=== ALL OVERHEAD INDUSTRIAL LIGHTING TESTS PASSED! ===')
