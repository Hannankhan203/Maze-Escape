import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE, WALL_HEIGHT } from '../world/worldCoords.js'
import { CAMERA_MODES, MAX_THIRD_PERSON_HEIGHT } from './CameraRig.js'
import { HORROR_EVENT_TYPES } from './HorrorDirector.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  DEFAULT_ENVIRONMENT_CONFIG,
  buildEnvironment,
  disposeEnvironment,
} from './buildEnvironment.js'
import { getMazeSurfacePoolStats } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools } from './sharedResources.js'
import { getBackdropPoolStats } from './undergroundBackdrop.js'

console.log('--- RUNNING UNDERGROUND FACILITY SKY & ATMOSPHERE TESTS ---')

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
// 1. Subterranean Cavern Sky Dome Palette, Horizon-Fog Blend & Far Plane Safety
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Subterranean sky dome palette, fog horizon blend & far-plane safety')

  const hardcoreMaze = generateMaze({ difficulty: 'hardcore', seed: 101 })
  const env = buildEnvironment({ maze: hardcoreMaze })
  const backdrop = env.details.backdropGroup
  assert.ok(backdrop, 'Underground backdrop group built')

  const skyDome = backdrop.getObjectByName('maze-env-sky-dome')
  assert.ok(skyDome?.isMesh, 'Sky dome exists')
  assert.equal(skyDome.material.side, THREE.BackSide, 'Sky dome renders interior BackSide')
  assert.equal(skyDome.material.depthWrite, false, 'Sky dome does not write depth')
  assert.equal(skyDome.material.fog, false, 'Sky dome keeps crisp gradient un-crushed by fog')
  assert.ok(skyDome.renderOrder < 0, 'Sky dome renders behind geometry')

  const posAttr = skyDome.geometry.attributes.position
  const colAttr = skyDome.geometry.attributes.color
  assert.ok(colAttr, 'Sky dome uses vertex color gradient')

  const fogLinear = new THREE.Color(DEFAULT_ENVIRONMENT_CONFIG.fogColor)
  let zenithLum = 0
  let zenithCount = 0
  let horizonDeltaMax = 0
  let midMinR = 1
  let midMaxR = 0

  for (let i = 0; i < posAttr.count; i += 1) {
    const x = posAttr.getX(i)
    const y = posAttr.getY(i)
    const z = posAttr.getZ(i)
    const len = Math.hypot(x, y, z) || 1
    const ny = y / len

    const r = colAttr.getX(i)
    const g = colAttr.getY(i)
    const b = colAttr.getZ(i)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b

    if (ny > 0.92) {
      zenithLum += lum
      zenithCount += 1
    } else if (Math.abs(ny) < 0.02) {
      const d = Math.hypot(r - fogLinear.r, g - fogLinear.g, b - fogLinear.b)
      horizonDeltaMax = Math.max(horizonDeltaMax, d)
    } else if (ny > 0.18 && ny < 0.35) {
      midMinR = Math.min(midMinR, r)
      midMaxR = Math.max(midMaxR, r)
    }
  }

  const avgZenithLum = zenithLum / Math.max(1, zenithCount)
  assert.ok(avgZenithLum < 0.01, `Zenith remains cavernous charcoal-midnight (lum=${avgZenithLum.toFixed(5)})`)
  assert.ok(horizonDeltaMax < 0.015, `Horizon blends smoothly into scene.fog (delta=${horizonDeltaMax.toFixed(4)})`)
  assert.ok(midMaxR > midMinR, 'Mid-elevation cavern sky contains subtle directional depth variation')

  // Verify sky dome radius stays well inside camera.far (400m) even from Hardcore corners
  skyDome.geometry.computeBoundingSphere()
  const domeRadius = skyDome.geometry.boundingSphere.radius
  const cornerDist = Math.hypot(hardcoreMaze.cols * CELL_SIZE * 0.5, hardcoreMaze.rows * CELL_SIZE * 0.5)
  assert.ok(cornerDist + domeRadius < 380, `Sky dome far side (${(cornerDist + domeRadius).toFixed(1)}m) fits safely within 400m camera far`)

  disposeEnvironment(env)
  disposeAllSharedPools()
  console.log('✓ Subterranean cavern sky gradient, fog blend & far-plane bounds verified')
}

// ---------------------------------------------------------------------------
// 2. Outer Architecture Clearance, Overhead Clearance, Markings & Non-Shadow Cost
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Concrete piers, overhead gantries/ducts/cables clearance & front-facing markings')

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 4444 })
    const env = buildEnvironment({ maze, config: { qualityPreset: 'high' } })
    const backdrop = env.details.backdropGroup

    const mazeHalfW = (maze.cols * CELL_SIZE) * 0.5
    const mazeHalfD = (maze.rows * CELL_SIZE) * 0.5

    // Plinth & outer concrete apron separation (no Z-fighting)
    const plinth = env.details.plinthMesh
    const apron = backdrop.getObjectByName('maze-env-apron')
    assert.ok(plinth?.isMesh && apron?.isMesh, `Apron & plinth exist on ${difficulty}`)
    assert.ok(apron.position.y < plinth.position.y - 0.2, 'Apron sits strictly below plinth bottom')

    // Outer concrete pillars sit well outside maze boundary and never cast shadow maps
    const pillarsMesh = backdrop.getObjectByName('maze-env-pillars')
    assert.ok(pillarsMesh?.isInstancedMesh, `Outer concrete pillars exist on ${difficulty}`)
    assert.equal(pillarsMesh.castShadow, false)

    const mat4 = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    for (let i = 0; i < pillarsMesh.count; i += 1) {
      pillarsMesh.getMatrixAt(i, mat4)
      pos.setFromMatrixPosition(mat4)
      const clearX = Math.abs(pos.x) - mazeHalfW
      const clearZ = Math.abs(pos.z) - mazeHalfD
      assert.ok(
        Math.max(clearX, clearZ) >= 9.0,
        `Outer pillar #${i} keeps >= 9m clearance outside ${difficulty} maze walls`
      )
    }

    // Overhead gantries, HVAC ventilation ducts & catenary cables clear walls & 3rd-person camera
    for (const name of ['maze-env-gantries', 'maze-env-vents', 'maze-env-cables']) {
      const overhead = backdrop.getObjectByName(name)
      assert.ok(overhead?.isMesh, `${name} exists on ${difficulty}`)
      assert.equal(overhead.castShadow, false)
      if (name !== 'maze-env-vents') {
        // Gantries & cables crossing over maze must stay above 8.5m (walls = 3m, 3rd-person = 2.75m)
        overhead.geometry.computeBoundingBox()
        assert.ok(
          overhead.geometry.boundingBox.min.y >= Math.max(8.5, WALL_HEIGHT + 5.0, MAX_THIRD_PERSON_HEIGHT + 5.0),
          `${name} min Y (${overhead.geometry.boundingBox.min.y.toFixed(2)}m) clears maze walls and 3rd-person camera`
        )
      }
    }

    // Distant concrete pillar markings have front-facing outward normals (T x +Y == N)
    const markings = backdrop.getObjectByName('maze-env-bg-markings')
    assert.ok(markings?.isMesh, `Distant sector markings exist on ${difficulty}`)
    const mPos = markings.geometry.attributes.position
    const mNorm = markings.geometry.attributes.normal
    const p0 = new THREE.Vector3()
    const p1 = new THREE.Vector3()
    const p2 = new THREE.Vector3()
    const e1 = new THREE.Vector3()
    const e2 = new THREE.Vector3()
    const triNorm = new THREE.Vector3()
    const storedNorm = new THREE.Vector3()
    for (let v = 0; v < mPos.count; v += 4) {
      p0.fromBufferAttribute(mPos, v)
      p1.fromBufferAttribute(mPos, v + 1)
      p2.fromBufferAttribute(mPos, v + 2)
      storedNorm.fromBufferAttribute(mNorm, v)
      e1.subVectors(p1, p0)
      e2.subVectors(p2, p0)
      triNorm.crossVectors(e1, e2).normalize()
      assert.ok(triNorm.dot(storedNorm) > 0.99, 'Distant concrete pillar marking has front-facing CCW winding')
    }

    disposeEnvironment(env)
  }

  disposeAllSharedPools()
  console.log('✓ Outer pillars, high overhead infrastructure clearance & markings verified across all 4 difficulties')
}

// ---------------------------------------------------------------------------
// 3. Graphics Presets, Fog Toggling, Beacon Animation & Reduced Motion
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Graphics presets, Volumetric Fog toggle, beacons & Reduced Motion')

  const maze = generateMaze({ difficulty: 'medium', seed: 9876 })
  const { engine } = createHeadlessEngine({ cameraMode: CAMERA_MODES.THIRD_PERSON })
  engine.setMaze(maze)

  const mazeGroupBefore = engine.getMazeGroup()
  const highBackdrop = engine.getEnvironment().details.backdropGroup
  assert.equal(highBackdrop.userData.qualityTier, 'high')
  const highBeacons = highBackdrop.userData.beaconCount
  const highPillars = highBackdrop.userData.pillarCount
  assert.ok(highBackdrop.getObjectByName('maze-env-beacon-halos'), 'High preset renders soft beacon glow halos')

  const verifyBackdropConcreteDetail = (backdrop, expectedDetail, expectedTier) => {
    const targets = [
      ['maze-env-pillars', 'ceiling'],
      ['maze-env-pillar-collars', 'cap'],
      ['maze-env-ceiling-vault', 'ceiling'],
    ]
    for (const [objName, expectedMode] of targets) {
      const obj = backdrop.getObjectByName(objName)
      assert.ok(obj?.material, `${objName} exists with concrete material in ${expectedTier}`)
      const mat = obj.material
      assert.equal(mat.userData.concreteWeatherMode, expectedMode, `${objName} uses ${expectedMode} shader mode`)
      assert.equal(
        mat.userData.concreteWeatherUniforms?.uConcreteDetail?.value,
        expectedDetail,
        `${objName} sets uConcreteDetail=${expectedDetail} on ${expectedTier}`
      )
      assert.equal(
        mat.customProgramCacheKey(),
        `maze-concrete-world-v7:${expectedMode}`,
        `${objName} keeps invariant cache key across quality presets`
      )
      const mockShader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      }
      mat.onBeforeCompile(mockShader)
      assert.ok(mockShader.uniforms.uWeatherSeed !== undefined, `${objName} binds uWeatherSeed`)
      assert.ok(mockShader.uniforms.uConcreteDetail !== undefined, `${objName} binds uConcreteDetail`)
    }
  }
  verifyBackdropConcreteDetail(highBackdrop, 1.0, 'high')

  engine.updateGraphicsConfig({ qualityPreset: 'balanced' })
  const balancedBackdrop = engine.getEnvironment().details.backdropGroup
  assert.equal(balancedBackdrop.userData.qualityTier, 'balanced')
  assert.ok(balancedBackdrop.userData.pillarCount < highPillars, 'Balanced preset trims outer pillar count')
  assert.equal(engine.getMazeGroup(), mazeGroupBefore, 'Quality switch keeps mazeGroup intact')
  verifyBackdropConcreteDetail(balancedBackdrop, 0.5, 'balanced')

  engine.updateGraphicsConfig({ qualityPreset: 'performance' })
  const perfBackdrop = engine.getEnvironment().details.backdropGroup
  assert.equal(perfBackdrop.userData.qualityTier, 'performance')
  assert.ok(perfBackdrop.userData.beaconCount < highBeacons, 'Performance preset reduces warning beacons')
  assert.equal(perfBackdrop.getObjectByName('maze-env-beacon-halos'), undefined, 'Performance preset omits additive beacon halos')
  assert.equal(perfBackdrop.getObjectByName('maze-env-bg-markings'), undefined, 'Performance preset omits distant markings')
  verifyBackdropConcreteDetail(perfBackdrop, 0.0, 'performance')

  // Toggling volumetricFog off preserves underground backdrop & dome
  engine.updateGraphicsConfig({ qualityPreset: 'high', volumetricFog: false })
  assert.equal(engine.scene.fog, null, 'Fog disabled when volumetricFog is false')
  assert.ok(engine.getEnvironment().details.backdropGroup.getObjectByName('maze-env-sky-dome'), 'Sky dome persists when fog toggled off')

  // First-person & Third-person + HorrorDirector blackouts modulate warning beacons cleanly
  engine.setCameraMode(CAMERA_MODES.FIRST_PERSON, { immediate: true })
  engine.stepFrame(0.016, { render: false })
  const bulbsMesh = engine.getEnvironment().details.backdropGroup.getObjectByName('maze-env-beacon-bulbs')
  const colorDay = new THREE.Color()
  const colorBlackout = new THREE.Color()
  bulbsMesh.getColorAt(0, colorDay)

  engine.horrorDirector.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: [],
  })
  engine.stepFrame(0.6, { render: false })
  bulbsMesh.getColorAt(0, colorBlackout)
  assert.ok(
    colorBlackout.getHSL({}).l < colorDay.getHSL({}).l,
    'Distant warning beacons dim cohesively during HorrorDirector blackout'
  )

  // Dispose cleans up both backdrop and surface shared pools when last engine closes
  engine.dispose()
  assert.equal(getBackdropPoolStats().entries, 0, 'Backdrop texture pool disposed cleanly')
  assert.equal(getMazeSurfacePoolStats().entries, 0, 'Surface texture pool disposed cleanly')
  console.log('✓ Graphics presets, fog toggling, camera modes, beacon pulse & disposal verified')
}

console.log('=== ALL UNDERGROUND FACILITY SKY & ATMOSPHERE TESTS PASSED! ===')
