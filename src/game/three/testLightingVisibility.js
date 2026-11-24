import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import { CAMERA_MODES } from './CameraRig.js'
import { HORROR_EVENT_TYPES } from './HorrorDirector.js'
import {
  ACTIVE_FLASHLIGHT_INTENSITY,
  MazeSceneEngine,
} from './MazeSceneEngine.js'
import { DEFAULT_ENVIRONMENT_CONFIG } from './buildEnvironment.js'
import { ENEMY_PALETTE, ENEMY_VISUAL_PRESETS } from './buildEnemy.js'
import { HAZARD_PALETTE } from './buildHazards.js'
import { HIDING_SPOT_PALETTE } from './buildHidingSpots.js'
import { MAZE_MESH_PALETTE } from './buildMazeMeshes.js'
import { PLAYER_PALETTE } from './buildPlayer.js'
import { disposeAllSharedPools } from './sharedResources.js'

console.log('--- RUNNING LIGHTING & VISIBILITY VERIFICATION TESTS ---')

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

function getLinearLuminance(hex) {
  const color = new THREE.Color(hex)
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Lighting Balance, Exposure, Fog & Shadow Rig Across All 4 Difficulties
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Lighting rig balance & dynamic shadow bounds across all 4 difficulties')

  const { engine, mockRenderer } = createHeadlessEngine()
  assert.equal(mockRenderer.outputColorSpace, THREE.SRGBColorSpace)
  assert.equal(mockRenderer.toneMapping, THREE.ACESFilmicToneMapping)
  assert.ok(
    mockRenderer.toneMappingExposure >= 1.2 && mockRenderer.toneMappingExposure <= 1.35,
    `Exposure ${mockRenderer.toneMappingExposure} should lift visibility moderately without washing out`
  )
  assert.equal(mockRenderer.shadowMap.enabled, true)
  assert.equal(mockRenderer.shadowMap.type, THREE.PCFSoftShadowMap)

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 4242 })
    engine.setMaze(maze)

    const env = engine.getEnvironment()
    assert.ok(env?.lights, `Environment lights exist for ${difficulty}`)
    const {
      ambientLight,
      hemiLight,
      directionalLight,
      fillLight,
    } = env.lights

    // Rebalanced underground atmospheric hierarchy (subdued ambient/fill so lit vs unlit zones contrast clearly)
    assert.ok(ambientLight.intensity >= 0.18 && ambientLight.intensity <= 0.36)
    assert.ok(hemiLight.intensity >= 0.65 && hemiLight.intensity <= 0.9)
    assert.ok(directionalLight.intensity > fillLight.intensity)
    assert.ok(fillLight.intensity >= 0.18 && fillLight.intensity <= 0.42)
    assert.equal(env.lights.startLight, undefined, 'No artificial start chamber PointLight exists')
    assert.equal(env.lights.exitLight, undefined, 'No artificial exit chamber PointLight exists')
    assert.equal(env.group.getObjectByName('maze-env-light-start'), undefined)
    assert.equal(env.group.getObjectByName('maze-env-light-exit'), undefined)

    // Opposite directional vector from key to fill for readable dark wall faces
    assert.ok(
      directionalLight.position.x * fillLight.position.x < 0 &&
        directionalLight.position.z * fillLight.position.z < 0,
      'Fill light opposes key light horizontally to define corridor edges'
    )

    // Atmospheric fog remains present and readable (not crushing near corridors)
    assert.ok(env.fog instanceof THREE.FogExp2)
    assert.ok(
      env.fog.density <= DEFAULT_ENVIRONMENT_CONFIG.fogDensity + 1e-6 &&
        env.fog.density > 0.004,
      `Fog density (${env.fog.density}) should keep dark depth without blinding short corridors`
    )

    // Overhead directional fill never casts fake sunlight shadows through closed ceiling deck
    assert.equal(directionalLight.castShadow, false)
    const spanX = maze.cols * CELL_SIZE
    const spanZ = maze.rows * CELL_SIZE
    const halfMax = Math.max(spanX, spanZ) * 0.5
    const cam = directionalLight.shadow.camera
    assert.ok(
      cam.right >= halfMax && cam.left <= -halfMax && cam.top >= halfMax && cam.bottom <= -halfMax,
      `Shadow camera bounds (${cam.right}) remain sized for ${difficulty} maze half-span (${halfMax})`
    )
  }

  engine.dispose()
  console.log('✓ Lighting hierarchy, fog balance, and dynamic shadow bounds verified for all difficulties')
}

// ---------------------------------------------------------------------------
// 2. Consistent Visibility & Flashlight Rig Across 1st & 3rd Person Cameras
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Flashlight rig, shadows & player visibility across 1st and 3rd person views')

  const maze = generateMaze({ difficulty: 'medium', seed: 1337 })
  const { engine } = createHeadlessEngine({ cameraMode: CAMERA_MODES.FIRST_PERSON })
  engine.setMaze(maze)

  // First-person verification
  assert.equal(engine.cameraRig.getMode(), CAMERA_MODES.FIRST_PERSON)
  assert.equal(engine.getPlayer().visible, false, 'Player mesh hidden in first-person')
  const active = engine.toggleFlashlight()
  assert.equal(active, true)
  assert.equal(engine.spotlight.visible, true)
  assert.equal(engine.spotlight.intensity, ACTIVE_FLASHLIGHT_INTENSITY)
  assert.equal(engine.spotlight.parent, engine.camera, 'Flashlight attached to camera in 1st person')
  assert.ok(engine.spotlight.distance >= 40, 'Flashlight reaches down corridors cleanly')

  // Third-person verification
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  assert.equal(engine.cameraRig.getMode(), CAMERA_MODES.THIRD_PERSON)
  assert.equal(engine.getPlayer().visible, true, 'Player mesh visible in third-person')
  assert.equal(engine.spotlight.parent, engine.flashlightRig, 'Flashlight attached to body rig in 3rd person')

  engine.stepFrame(0.016, { render: false })
  assert.equal(engine.spotlight.visible, true)
  assert.ok(engine.spotlight.intensity > 8)

  // Verify player character meshes cast & receive shadows in 3rd-person
  let playerShadowCasters = 0
  engine.getPlayer().traverse((node) => {
    if (node.isMesh && node.castShadow && node.receiveShadow) {
      playerShadowCasters += 1
    }
  })
  assert.ok(playerShadowCasters > 0, 'Player model casts and receives shadows for 3rd-person depth')

  // Verify maze architecture, enemies, and hiding spots have shadow/visibility flags
  let mazeShadowCasters = 0
  let mazeShadowReceivers = 0
  engine.getMazeGroup().traverse((node) => {
    if (node.isMesh) {
      if (node.castShadow) mazeShadowCasters += 1
      if (node.receiveShadow) mazeShadowReceivers += 1
    }
  })
  assert.ok(mazeShadowCasters >= 2, 'Maze walls & caps cast shadows')
  assert.ok(mazeShadowReceivers >= 3, 'Maze floor & walls receive shadows')

  const enemies = engine.getEnemies()
  assert.ok(enemies.length > 0)
  for (const enemy of enemies) {
    const preset = ENEMY_VISUAL_PRESETS[enemy.type]
    assert.ok(preset.lightIntensity >= 2.0 && preset.lightDistance >= 7.5)
    let enemyMeshesWithShadow = 0
    enemy.getMesh().traverse((node) => {
      if (node.isMesh && node.castShadow) enemyMeshesWithShadow += 1
    })
    assert.ok(enemyMeshesWithShadow > 0, `Enemy ${enemy.type} casts shadows`)
  }

  engine.dispose()
  console.log('✓ 1st/3rd person flashlight rig, shadows, and actor visibility verified')
}

// ---------------------------------------------------------------------------
// 3. Moderate Dark-Palette Contrast & HorrorDirector / High-Contrast Compat
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Dark atmospheric material separation, Graphics presets, High-Contrast & HorrorDirector')

  // Ensure materials remain dark-toned (non-washed-out) while clearly above linear black crush
  const floorLum = getLinearLuminance(MAZE_MESH_PALETTE.floor)
  const wallLum = getLinearLuminance(MAZE_MESH_PALETTE.wallBody)
  const capLum = getLinearLuminance(MAZE_MESH_PALETTE.wallBevel)
  assert.ok(floorLum > 0.01 && floorLum < 0.06, `Floor lum ${floorLum.toFixed(4)} stays dark yet readable`)
  assert.ok(wallLum > floorLum * 1.8 && wallLum < 0.1, `Wall lum ${wallLum.toFixed(4)} separates from floor`)
  assert.ok(capLum > wallLum * 1.5 && capLum < 0.2, `Bevel cap lum ${capLum.toFixed(4)} frames top edges`)

  assert.ok(getLinearLuminance(PLAYER_PALETTE.coat) > floorLum)
  assert.ok(getLinearLuminance(ENEMY_PALETTE.armor) > floorLum)
  assert.ok(getLinearLuminance(HIDING_SPOT_PALETTE.bodySteel) > floorLum)
  assert.ok(getLinearLuminance(HAZARD_PALETTE.wiringConduit) > floorLum)

  const maze = generateMaze({ difficulty: 'small', seed: 9001 })
  const { engine, mockRenderer } = createHeadlessEngine()
  engine.setMaze(maze)

  const { ambientLight, fillLight, directionalLight } = engine.getEnvironment().lights
  const baseAmbient = ambientLight.intensity
  const baseFill = fillLight.intensity
  const baseDir = directionalLight.intensity

  // Graphics presets toggle shadows & scale flashlight shadow resolution cleanly
  engine.updateGraphicsConfig({ qualityPreset: 'performance' })
  assert.equal(mockRenderer.shadowMap.enabled, false, 'Performance preset disables shadow maps')
  assert.equal(engine.spotlight.castShadow, false, 'Performance preset disables flashlight shadows')
  engine.updateGraphicsConfig({ qualityPreset: 'balanced' })
  assert.equal(mockRenderer.shadowMap.enabled, true, 'Balanced preset enables shadow maps')
  assert.equal(engine.spotlight.castShadow, true, 'Balanced preset enables flashlight shadows')
  assert.equal(engine.spotlight.shadow.mapSize.width, 512, 'Balanced preset uses 512x512 flashlight shadow map')
  engine.updateGraphicsConfig({ qualityPreset: 'high' })
  assert.equal(engine.spotlight.castShadow, true, 'High preset enables flashlight shadows')
  assert.equal(engine.spotlight.shadow.mapSize.width, 1024, 'High preset uses 1024x1024 flashlight shadow map')

  // Software GL rendering keeps shadow maps and flashlight shadow casting disabled regardless of quality preset
  {
    const { engine: swEngine, mockRenderer: swRenderer } = createHeadlessEngine({ isSoftwareGl: true })
    swEngine.setMaze(maze)
    swEngine.updateGraphicsConfig({ qualityPreset: 'high' })
    assert.equal(swRenderer.shadowMap.enabled, false, 'Software GL disables renderer shadow maps even on high preset')
    assert.equal(swEngine.spotlight.castShadow, false, 'Software GL disables flashlight shadows even on high preset')
    swEngine.dispose()
  }

  // High Contrast toggles on and cleanly restores updated MAZE_MESH_PALETTE
  engine.setHighContrast(true)
  assert.equal(engine.getMazeGroup().userData.wallOutline.visible, true)
  engine.setHighContrast(false)
  assert.equal(engine.getMazeGroup().userData.wallOutline.visible, false)
  assert.equal(
    engine.getMazeGroup().userData.wallMat.color.getHex(),
    MAZE_MESH_PALETTE.wallBody
  )

  // HorrorDirector dims & restores ALL lights including fillLight cleanly
  const director = engine.getHorrorDirector()
  director.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: engine.getEnemies(),
  })
  director.update(0.6, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: engine.getEnemies(),
  })
  assert.ok(fillLight.intensity < baseFill, 'Fill light dims during HorrorDirector blackout')
  director.update(4.0, {
    playerWorldPos: engine.getPlayerWorldPosition(),
    enemies: engine.getEnemies(),
  })
  assert.ok(Math.abs(ambientLight.intensity - baseAmbient) < 1e-6)
  assert.ok(Math.abs(fillLight.intensity - baseFill) < 1e-6)
  assert.ok(Math.abs(directionalLight.intensity - baseDir) < 1e-6)

  engine.dispose()
  console.log('✓ Dark material separation, Graphics presets, High-Contrast & HorrorDirector verified')
}

disposeAllSharedPools()
console.log('=== ALL LIGHTING & VISIBILITY TESTS PASSED! ===')
