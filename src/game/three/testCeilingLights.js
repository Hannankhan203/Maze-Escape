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
  resolveOverheadShadowLightBudget,
  stepCeilingLights,
} from './buildCeilingLights.js'
import {
  getCeilingVentPoolStats,
  getGalvanizedMetalTextureSet,
} from './buildCeilingVents.js'
import { getEnvironmentalPropTextureSet } from './buildEnvironmentalProps.js'
import { MAZE_CEILING_CONFIG } from './buildMazeCeiling.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { CAMERA_MODES, MAX_THIRD_PERSON_HEIGHT } from './CameraRig.js'
import { HORROR_EVENT_TYPES } from './HorrorDirector.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { getMazeSurfacePoolStats, getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'
import { getLayerMeshes } from './spatialChunking.js'
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
  getGalvanizedMetalTextureSet()
  getEnvironmentalPropTextureSet()

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
    const housingNode = group.getObjectByName('maze-ceiling-light-housings')
    const housingMeshes = getLayerMeshes(housingNode)
    const diffuserMesh = group.getObjectByName('maze-ceiling-light-diffusers')
    const haloMesh = group.getObjectByName('maze-ceiling-light-halos')
    assert.ok(
      lightsGroup && housingMeshes.length > 0 && diffuserMesh && haloMesh,
      `Overhead light meshes exist on ${difficulty}`
    )

    // Flush fixture housings skip shadow casting; diffusers/halos/PointLights stay non-casting; dedicated shadowSpotPool handles capped overhead shadows
    for (const hm of housingMeshes) {
      assert.equal(hm.castShadow, false, `${hm.name} skips shadow casting`)
      assert.equal(hm.receiveShadow, true, 'Fixture metal housings receive flashlight shadows')
    }
    assert.equal(diffuserMesh.castShadow, false, `${diffuserMesh.name} does not self-shadow diffusers`)
    assert.equal(haloMesh.castShadow, false, `${haloMesh.name} does not cast shadows`)
    for (const pt of lightsGroup.userData.pointLightPool) {
      assert.equal(pt.castShadow, false, `${pt.name} avoids expensive cube shadow maps`)
    }
    const shadowSpotPool = lightsGroup.userData.shadowSpotPool
    assert.ok(Array.isArray(shadowSpotPool) && shadowSpotPool.length >= 2, 'Shadow SpotLight pool pre-allocated')
    for (const sp of shadowSpotPool) {
      assert.equal(sp.castShadow, true, `${sp.name} casts localized overhead fixture shadows`)
      assert.ok(sp.target && sp.target.parent === lightsGroup, `${sp.name} target attached inside lightsGroup`)
    }

    // Check shared pool usage on unit geometries / halo texture
    assert.equal(isSharedResource(diffuserMesh.geometry), true)
    assert.equal(isSharedResource(haloMesh.geometry), true)
    assert.equal(isSharedResource(haloMesh.material.map), true)

    // Verify strict vertical clearance (>= 3.30m) & non-overlap with concrete beams/ribs
    const hBox = new THREE.Box3()
    for (const hm of housingMeshes) {
      hm.geometry.computeBoundingBox()
      hBox.union(hm.geometry.boundingBox)
    }
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
    for (const hm of housingMeshes) {
      const pos = hm.geometry.attributes.position
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
  const {
    fixtures,
    pointLightPool,
    shadowSpotPool,
    diffuserEntries,
    diffuserMesh,
    haloMesh,
  } = lightsGroup.userData

  // Check active/burned-out separation
  const workingFixture = fixtures.find((f) => f.condition === CEILING_LIGHT_STATES.WORKING)
  const flickerFixture = fixtures.find((f) => f.condition === CEILING_LIGHT_STATES.FLICKERING)
  const burnedFixture = fixtures.find((f) => f.condition === CEILING_LIGHT_STATES.BURNED_OUT)
  assert.ok(workingFixture && flickerFixture && burnedFixture, 'Large maze contains working, flickering & burned_out states')

  // Sample flickering behavior over time: irregular dips stay comfortable (>= 0.42 * base, never extreme strobe)
  // AND synchronize diffuser color + pooled PointLight + pooled SpotLight cleanly
  const flickerSamples = []
  const spotSamples = []
  const diffBlueSamples = []
  const flickerDiffIdx = diffuserEntries.findIndex((d) => d.fixtureIndex === flickerFixture.index)
  const cFlick = new THREE.Color()
  for (let s = 0; s < 40; s += 1) {
    const t = s * 0.14
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
      flickerFixture._liveIntensity >= flickerFixture.baseIntensity * 0.4 &&
        flickerFixture._liveIntensity <= flickerFixture.baseIntensity * 1.05,
      'Flicker stays within comfortable restrained range (no jarring flash)'
    )

    // Ensure nearest shadow SpotLight tracks the flickering fixture directly when standing under it
    const activeSpots = shadowSpotPool.filter((sp) => sp.visible)
    const activePts = pointLightPool.filter((pt) => pt.visible)
    assert.ok(activeSpots.length >= 1 && activePts.length >= 1, 'Working/flickering fixture receives active PointLight + shadow SpotLight')

    for (const sp of activeSpots) {
      const dBurnSpot = Math.hypot(sp.position.x - burnedFixture.x, sp.position.z - burnedFixture.z)
      assert.ok(
        dBurnSpot > 0.25 || burnedFixture._liveIntensity === 0,
        'Burned-out fixture never triggers shadow-casting emission'
      )
    }

    const matchingSpot = activeSpots.find(
      (sp) => Math.hypot(sp.position.x - flickerFixture.x, sp.position.z - flickerFixture.z) < 0.1
    )
    assert.ok(matchingSpot, 'Overhead shadow SpotLight centers on nearby flickering fixture & faces straight down')
    assert.ok(Math.abs(matchingSpot.target.position.x - flickerFixture.x) < 1e-4)
    assert.ok(Math.abs(matchingSpot.target.position.z - flickerFixture.z) < 1e-4)
    assert.ok(matchingSpot.target.position.y < matchingSpot.position.y - 2.0)

    spotSamples.push(matchingSpot.intensity)
    diffuserMesh.getColorAt(flickerDiffIdx, cFlick)
    diffBlueSamples.push(cFlick.b)
  }
  const fMin = Math.min(...flickerSamples)
  const fMax = Math.max(...flickerSamples)
  assert.ok(fMax - fMin > 0.1, `Flickering fixture exhibits subtle irregular modulation (${fMin.toFixed(2)}..${fMax.toFixed(2)})`)
  assert.ok(
    Math.max(...spotSamples) - Math.min(...spotSamples) > 0.25,
    'Shadow SpotLight intensity fluctuates smoothly in lockstep with flickering fixture'
  )
  assert.ok(
    Math.max(...diffBlueSamples) - Math.min(...diffBlueSamples) > 0.04,
    'Diffuser emissive brightness modulates smoothly in lockstep with flickering light output'
  )

  // Verify Burned-out zone vs Working lit zone contrast & burned-out exclusion from light pools
  stepCeilingLights(lightsGroup, 0.5, {
    playerWorldPos: { x: workingFixture.x, z: workingFixture.z },
    lightScale: 1,
    reducedMotion: false,
    qualityPreset: 'high',
    dynamicLights: true,
  })
  const litZonePointSum = pointLightPool.reduce((sum, pt) => {
    if (!pt.visible) return sum
    const d = Math.hypot(pt.position.x - workingFixture.x, pt.position.z - workingFixture.z)
    return sum + pt.intensity / (1 + d * d * 0.2)
  }, 0)

  // Stand directly under burned-out fixture (where nearest working light is farther/attenuated/wall-occluded)
  stepCeilingLights(lightsGroup, 0.5, {
    playerWorldPos: { x: burnedFixture.x, z: burnedFixture.z },
    lightScale: 1,
    reducedMotion: false,
    qualityPreset: 'high',
    dynamicLights: true,
  })
  for (const pt of pointLightPool) {
    if (pt.visible) {
      assert.ok(
        Math.hypot(pt.position.x - burnedFixture.x, pt.position.z - burnedFixture.z) > 0.2,
        'Burned-out fixture never acquires a pooled PointLight even when standing right underneath it'
      )
    }
  }
  for (const sp of shadowSpotPool) {
    if (sp.visible) {
      assert.ok(
        Math.hypot(sp.position.x - burnedFixture.x, sp.position.z - burnedFixture.z) > 0.2,
        'Burned-out fixture never acquires a shadow-casting SpotLight even when standing right underneath it'
      )
    }
  }
  const darkZonePointSum = pointLightPool.reduce((sum, pt) => {
    if (!pt.visible) return sum
    const d = Math.hypot(pt.position.x - burnedFixture.x, pt.position.z - burnedFixture.z)
    return sum + pt.intensity / (1 + d * d * 0.2)
  }, 0)
  assert.ok(
    litZonePointSum > darkZonePointSum * 1.45,
    `Working fixture zone (${litZonePointSum.toFixed(2)}) visibly brighter than burned-out dark zone (${darkZonePointSum.toFixed(2)})`
  )

  // Verify Burned-out diffuser stays darkened compared to lit fixture diffuser
  const burnedDiffIdx = diffuserEntries.findIndex((d) => d.fixtureIndex === burnedFixture.index)
  const workingDiffIdx = diffuserEntries.findIndex((d) => d.fixtureIndex === workingFixture.index)
  const cBurn = new THREE.Color()
  const cWork = new THREE.Color()
  diffuserMesh.getColorAt(burnedDiffIdx, cBurn)
  diffuserMesh.getColorAt(workingDiffIdx, cWork)
  assert.ok(cWork.b > cBurn.b * 3, 'Lit diffuser glows clearly brighter than burned-out diffuser')

  // Reduced motion: flickering fixtures lock calmly without oscillatory changes across PointLight + SpotLight + diffuser
  stepCeilingLights(lightsGroup, 0.4, {
    playerWorldPos: { x: flickerFixture.x, z: flickerFixture.z },
    reducedMotion: true,
    qualityPreset: 'high',
  })
  const rmLevelA = flickerFixture._liveIntensity
  const rmSpotA = shadowSpotPool.find((sp) => sp.visible)?.intensity ?? 0
  stepCeilingLights(lightsGroup, 2.7, {
    playerWorldPos: { x: flickerFixture.x, z: flickerFixture.z },
    reducedMotion: true,
    qualityPreset: 'high',
  })
  const rmLevelB = flickerFixture._liveIntensity
  const rmSpotB = shadowSpotPool.find((sp) => sp.visible)?.intensity ?? 0
  assert.equal(rmLevelA, rmLevelB, 'Reduced motion eliminates flicker oscillation completely')
  assert.equal(rmSpotA, rmSpotB, 'Reduced motion stabilizes shadow SpotLight intensity completely')

  // Graphics presets strictly enforce dynamic PointLight, shadow SpotLight & halo budgets
  assert.equal(resolveOverheadPointLightBudget({ qualityPreset: 'performance' }), 0)
  assert.equal(resolveOverheadPointLightBudget({ qualityPreset: 'balanced' }), 2)
  assert.equal(resolveOverheadPointLightBudget({ qualityPreset: 'high' }), 4)

  assert.equal(resolveOverheadShadowLightBudget({ qualityPreset: 'performance' }), 0)
  assert.equal(resolveOverheadShadowLightBudget({ qualityPreset: 'balanced' }), 1)
  assert.equal(resolveOverheadShadowLightBudget({ qualityPreset: 'high' }), 2)
  assert.equal(resolveOverheadShadowLightBudget({ qualityPreset: 'high', dynamicLights: false }), 0)
  assert.equal(resolveOverheadShadowLightBudget({ qualityPreset: 'high', isSoftwareGl: true }), 0)

  stepCeilingLights(lightsGroup, 0.5, { qualityPreset: 'performance', dynamicLights: true })
  assert.equal(pointLightPool.filter((p) => p.visible).length, 0, 'Performance preset disables overhead PointLights')
  assert.equal(shadowSpotPool.filter((s) => s.visible).length, 0, 'Performance preset disables overhead shadow SpotLights')
  assert.equal(haloMesh.visible, false, 'Performance preset hides additive diffuser halos')

  stepCeilingLights(lightsGroup, 0.5, { qualityPreset: 'balanced', dynamicLights: true })
  assert.ok(pointLightPool.filter((p) => p.visible).length <= 2, 'Balanced preset caps overhead PointLights <= 2')
  assert.ok(shadowSpotPool.filter((s) => s.visible).length <= 1, 'Balanced preset caps overhead shadow SpotLights <= 1')
  assert.equal(haloMesh.visible, true)

  stepCeilingLights(lightsGroup, 0.5, { qualityPreset: 'high', dynamicLights: true })
  assert.ok(pointLightPool.filter((p) => p.visible).length <= 4, 'High preset caps overhead PointLights <= 4')
  assert.ok(shadowSpotPool.filter((s) => s.visible).length <= 2, 'High preset caps overhead shadow SpotLights <= 2')

  stepCeilingLights(lightsGroup, 0.5, { qualityPreset: 'high', dynamicLights: false })
  assert.equal(pointLightPool.filter((p) => p.visible).length, 0, 'dynamicLights=false disables overhead PointLights')
  assert.equal(shadowSpotPool.filter((s) => s.visible).length, 0, 'dynamicLights=false disables overhead shadow SpotLights')

  disposeMazeGroup(group)
  disposeAllSharedPools()
  console.log('✓ Lighting states, gentle flicker sync, dark/lit contrast, reduced motion & preset budgets verified')
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
  const { pointLightPool, shadowSpotPool, haloMesh } = lightsGroup.userData

  engine.stepFrame(0.016, { render: false })
  const baselineLitIntensity = pointLightPool.reduce((sum, pt) => sum + (pt.visible ? pt.intensity : 0), 0)
  const baselineSpotIntensity = shadowSpotPool.reduce((sum, sp) => sum + (sp.visible ? sp.intensity : 0), 0)
  assert.ok(baselineLitIntensity > 0, 'Active overhead PointLights illuminate nearby ceiling bay at rest')
  assert.ok(baselineSpotIntensity > 0, 'Active overhead shadow SpotLights illuminate nearby ceiling bay at rest')

  // HorrorDirector blackout must dim ceiling lights, shadow SpotLights & diffusers and restore cleanly afterward
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
  const blackoutSpotIntensity = shadowSpotPool.reduce((sum, sp) => sum + (sp.visible ? sp.intensity : 0), 0)
  assert.ok(
    blackoutIntensity < baselineLitIntensity * 0.4,
    `Overhead PointLights dim during HorrorDirector blackout (${blackoutIntensity.toFixed(2)} < ${baselineLitIntensity.toFixed(2)})`
  )
  assert.ok(
    blackoutSpotIntensity < baselineSpotIntensity * 0.4,
    `Overhead shadow SpotLights dim during HorrorDirector blackout (${blackoutSpotIntensity.toFixed(2)} < ${baselineSpotIntensity.toFixed(2)})`
  )

  // End blackout -> lights cleanly restore
  director.update(4.5, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: engine.getEnemies(),
  })
  const restoredIntensity = pointLightPool.reduce((sum, pt) => sum + (pt.visible ? pt.intensity : 0), 0)
  const restoredSpotIntensity = shadowSpotPool.reduce((sum, sp) => sum + (sp.visible ? sp.intensity : 0), 0)
  assert.ok(
    Math.abs(restoredIntensity - baselineLitIntensity) < 0.25,
    `Overhead PointLights restore after blackout (${restoredIntensity.toFixed(2)} vs ${baselineLitIntensity.toFixed(2)})`
  )
  assert.ok(
    Math.abs(restoredSpotIntensity - baselineSpotIntensity) < 0.25,
    `Overhead shadow SpotLights restore after blackout (${restoredSpotIntensity.toFixed(2)} vs ${baselineSpotIntensity.toFixed(2)})`
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
    const expectedSpotCap = preset === 'performance' ? 0 : preset === 'balanced' ? 1 : 2
    assert.ok(pointLightPool.filter((p) => p.visible).length <= expectedCap, `Preset ${preset} enforces light cap ${expectedCap}`)
    assert.ok(shadowSpotPool.filter((s) => s.visible).length <= expectedSpotCap, `Preset ${preset} enforces shadow SpotLight cap ${expectedSpotCap}`)
    if (preset === 'performance') {
      assert.equal(shadowSpotPool.filter((s) => s.visible).length, 0, 'Performance preset activates zero overhead shadow SpotLights')
    }
  }

  // Software GL keeps all dynamic/shadow overhead lights disabled even on high preset
  {
    const { engine: swEngine } = createHeadlessEngine({ isSoftwareGl: true })
    swEngine.setMaze(generateMaze({ difficulty: 'medium', seed: 9099 }))
    swEngine.updateGraphicsConfig({ qualityPreset: 'high' })
    swEngine.stepFrame(0.016, { render: false })
    const swLightsGroup = swEngine.getMazeGroup()?.getObjectByName('maze-ceiling-lights-group')
    assert.ok(swLightsGroup)
    assert.equal(
      swLightsGroup.userData.pointLightPool.filter((p) => p.visible).length,
      0,
      'Software GL activates zero overhead PointLights'
    )
    assert.equal(
      swLightsGroup.userData.shadowSpotPool.filter((s) => s.visible).length,
      0,
      'Software GL activates zero overhead shadow SpotLights'
    )
    swEngine.dispose()
  }

  // Repeated maze create/dispose cycles across difficulties verify zero resource leaks
  const diffs = ['small', 'medium', 'large', 'hardcore']
  for (let i = 0; i < 10; i += 1) {
    const nextMaze = generateMaze({ difficulty: diffs[i % diffs.length], seed: 9100 + i })
    engine.setMaze(nextMaze)
    engine.stepFrame(0.016, { render: false })
  }
  assert.equal(getCeilingLightPoolStats().entries, 3, 'Shared ceiling light pool holds fixed entry count across 10 maze rebuilds')

  engine.dispose()
  assert.equal(getCeilingLightPoolStats().entries, 0, 'Ceiling light pool disposed cleanly')
  assert.equal(getCeilingVentPoolStats().entries, 0, 'Ceiling vent pool disposed cleanly')
  assert.equal(getMazeSurfacePoolStats().entries, 0, 'Maze surface pool disposed cleanly')
  assert.equal(getBackdropPoolStats().entries, 0, 'Backdrop pool disposed cleanly')
  console.log('✓ HorrorDirector blackout, High Contrast, cameras, presets & 10x clean disposal verified')
}

console.log('=== ALL OVERHEAD INDUSTRIAL LIGHTING TESTS PASSED! ===')
