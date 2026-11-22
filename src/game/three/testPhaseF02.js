import { generateMaze } from '../generation/mazeGenerator.js'
import {
  buildCoinMesh,
  buildEchoMarkerMesh,
  buildKeycardMesh,
  buildPowerUpMesh,
  disposeCollectiblePools,
  disposeObject3D,
  getCollectiblePoolStats,
} from './buildCollectibles.js'
import {
  buildEnemy,
  disposeEnemy,
  disposeEnemyPools,
  getEnemyPoolStats,
  updateEnemyVisualState,
} from './buildEnemy.js'
import {
  buildHazardMesh,
  disposeHazardMesh,
  disposeHazardPools,
  getHazardPoolStats,
} from './buildHazards.js'
import {
  buildHidingSpotMesh,
  disposeHidingSpotMesh,
  disposeHidingSpotPools,
  getHidingSpotPoolStats,
} from './buildHidingSpots.js'
import {
  MAZE_MESH_PALETTE,
  buildMazeMeshes,
  disposeMazeGroup,
  setExitGateState,
  updateExitGate,
} from './buildMazeMeshes.js'
import { getLayerMeshes } from './spatialChunking.js'
import {
  MazeSceneEngine,
  computeAdaptiveFrameDelayMs,
} from './MazeSceneEngine.js'
import {
  disposeAllSharedPools,
  getActiveSharedPoolOwnerCount,
  isSharedResource,
} from './sharedResources.js'
import { resolveLookInputConfig } from './threeConfig.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 640,
    clientHeight: 480,
  }
  const mockRenderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    pixelRatio: 1,
    setPixelRatio: (r) => {
      mockRenderer.pixelRatio = r
    },
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  const engine = new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    ...config,
  })
  return { engine, mockRenderer }
}

console.log('--- RUNNING PHASE F PROMPT 02 VERIFICATION TESTS ---')

// Clean slate before running pool assertions
disposeAllSharedPools()

// 1. Shared geometry & material pooling + safe per-instance disposal
console.log('Test 1: Shared Geometry & Material Pools and Safe Disposal')

const coinA = buildCoinMesh({ id: 'coin-a', row: 1, col: 1 })
const coinB = buildCoinMesh({ id: 'coin-b', row: 1, col: 2 })
const coinMeshA = coinA.children[0]
const coinMeshB = coinB.children[0]
assert(coinMeshA.geometry === coinMeshB.geometry, 'Coins share pooled geometry')
assert(coinMeshA.material === coinMeshB.material, 'Coins share pooled static material')
assert(isSharedResource(coinMeshA.geometry), 'Coin geometry marked shared')
assert(isSharedResource(coinMeshA.material), 'Coin material marked shared')

let coinSharedGeoDisposed = 0
let coinSharedMatDisposed = 0
const origCoinGeoDispose = coinMeshA.geometry.dispose.bind(coinMeshA.geometry)
const origCoinMatDispose = coinMeshA.material.dispose.bind(coinMeshA.material)
coinMeshA.geometry.dispose = () => {
  coinSharedGeoDisposed += 1
  origCoinGeoDispose()
}
coinMeshA.material.dispose = () => {
  coinSharedMatDisposed += 1
  origCoinMatDispose()
}
disposeObject3D(coinA)
assert(coinSharedGeoDisposed === 0, 'Disposing single coin must not dispose shared geometry')
assert(coinSharedMatDisposed === 0, 'Disposing single coin must not dispose shared material')
disposeObject3D(coinB)

const puA = buildPowerUpMesh({ id: 'pu-a', type: 'echo_reveal', row: 1, col: 1 })
const puB = buildPowerUpMesh({ id: 'pu-b', type: 'echo_reveal', row: 1, col: 2 })
assert(puA.children[0].geometry === puB.children[0].geometry, 'Same-type powerups share core geometry')
assert(puA.children[1].geometry === puB.children[1].geometry, 'Powerups share ring geometry')
disposeObject3D(puA)
disposeObject3D(puB)

const keyA = buildKeycardMesh({ id: 'key-a', row: 1, col: 1 })
const keyB = buildKeycardMesh({ id: 'key-b', row: 1, col: 2 })
assert(keyA.children[0].geometry === keyB.children[0].geometry, 'Keycards share core geometry')
assert(keyA.children[1].geometry === keyB.children[1].geometry, 'Keycards share halo geometry')
assert(keyA.userData.coreMat !== keyB.userData.coreMat, 'Keycards retain instance-owned pulsing core material')
let keyCoreDisposed = 0
const origKeyCoreDispose = keyA.userData.coreMat.dispose.bind(keyA.userData.coreMat)
keyA.userData.coreMat.dispose = () => {
  keyCoreDisposed += 1
  origKeyCoreDispose()
}
disposeObject3D(keyA)
assert(keyCoreDisposed === 1, 'Instance-owned keycard material disposed cleanly')
disposeObject3D(keyB)

const echoA = buildEchoMarkerMesh({ row: 1, col: 1 }, 0, 2)
const echoB = buildEchoMarkerMesh({ row: 1, col: 2 }, 0, 2)
assert(echoA.children[0].geometry === echoB.children[0].geometry, 'Echo beacons share ring geometry')
assert(echoA.userData.ringMat !== echoB.userData.ringMat, 'Echo beacons retain instance-owned fade material')
disposeObject3D(echoA)
disposeObject3D(echoB)

const hazA = buildHazardMesh({ id: 'haz-a', type: 'pressure_plate' })
const hazB = buildHazardMesh({ id: 'haz-b', type: 'pressure_plate' })
assert(hazA.children[0].geometry === hazB.children[0].geometry, 'Same-type hazards share base geometry')
assert(hazA.children[0].material === hazB.children[0].material, 'Same-type hazards share static material')
assert(hazA.userData.plateMat !== hazB.userData.plateMat, 'Hazards keep instance-owned alert plate material')
disposeHazardMesh(hazA)
disposeHazardMesh(hazB)

const hideA = buildHidingSpotMesh({ id: 'h-1', type: 'locker', worldPos: { x: 0, z: 0 } })
const hideB = buildHidingSpotMesh({ id: 'h-2', type: 'locker', worldPos: { x: 2, z: 0 } })
assert(hideA.children[0].geometry === hideB.children[0].geometry, 'Hiding spots share cabinet body geometry')
assert(hideA.userData.indicatorMat !== hideB.userData.indicatorMat, 'Hiding spots keep instance-owned indicator material')
disposeHidingSpotMesh(hideA)
disposeHidingSpotMesh(hideB)

const enemyA = buildEnemy({ id: 'e-1', type: 'stalker' })
const enemyB = buildEnemy({ id: 'e-2', type: 'stalker' })
assert(
  enemyA.userData.rig.materials.chassis === enemyB.userData.rig.materials.chassis,
  'Enemies of same archetype share chassis material'
)
assert(
  enemyA.userData.rig.materials.sensor !== enemyB.userData.rig.materials.sensor,
  'Enemies retain instance-owned ocular sensor material'
)
let enemyChassisDisposed = 0
const origEnemyChassisDispose = enemyA.userData.rig.materials.chassis.dispose.bind(
  enemyA.userData.rig.materials.chassis
)
enemyA.userData.rig.materials.chassis.dispose = () => {
  enemyChassisDisposed += 1
  origEnemyChassisDispose()
}
let enemySensorDisposed = 0
const origEnemySensorDispose = enemyA.userData.rig.materials.sensor.dispose.bind(
  enemyA.userData.rig.materials.sensor
)
enemyA.userData.rig.materials.sensor.dispose = () => {
  enemySensorDisposed += 1
  origEnemySensorDispose()
}
disposeEnemy(enemyA)
assert(enemyChassisDisposed === 0, 'Disposing one enemy must not dispose shared archetype material')
assert(enemySensorDisposed === 1, 'Disposing enemy disposes its instance-owned sensor material')
disposeEnemy(enemyB)

// Clean direct test pools before engine lifecycle test
disposeCollectiblePools()
disposeHazardPools()
disposeHidingSpotPools()
disposeEnemyPools()

// 2. Multi-engine shared pool ownership & 12 consecutive runs / Echo Reveal cycles
console.log('Test 2: Multi-Engine Pool Refcounting & 12 Consecutive Runs + Echo Reveal')
const { engine: engineA } = createHeadlessEngine({ isSoftwareGl: false })
const { engine: engineB } = createHeadlessEngine({ isSoftwareGl: false })
assert(getActiveSharedPoolOwnerCount() === 2, 'Two active engines hold 2 shared pool ownership refs')

const initialMaze = generateMaze({ difficulty: 'medium', seed: 1001 })
engineA.setMaze(initialMaze)
engineB.setMaze(initialMaze)

let midRunStats = null
// Run 12 consecutive maze regenerations + Echo Reveal + pickups on engineA
for (let run = 0; run < 12; run += 1) {
  const m = generateMaze({
    difficulty: run % 2 === 0 ? 'small' : 'medium',
    seed: 2000 + run,
    includeObjectives: true,
  })
  engineA.setMaze(m)
  engineA.syncCollectibles({
    coins: m.collectibles.coins,
    powerUps: m.collectibles.powerUps,
    keycards: m.keycards,
    echoPath: [m.start, m.exit],
    spawnBursts: false,
    isReset: true,
  })
  // Simulate picking up a coin & keycard burst, plus clearing Echo Reveal
  const firstCoin = m.collectibles.coins[0]
  if (firstCoin) {
    engineA.syncCollectibles({
      coins: m.collectibles.coins.slice(1),
      powerUps: m.collectibles.powerUps,
      keycards: m.keycards,
      echoPath: [],
      spawnBursts: true,
      isReset: false,
    })
  }
  engineA.stepFrame(0.05, { render: false })
  if (run === 5) {
    midRunStats = {
      collectibles: getCollectiblePoolStats().geometries,
      enemies: getEnemyPoolStats().geometries,
      hazards: getHazardPoolStats().geometries,
      hidingSpots: getHidingSpotPoolStats().geometries,
    }
  }
}

const poolStatsBeforeDispose = {
  collectibles: getCollectiblePoolStats(),
  hazards: getHazardPoolStats(),
  hidingSpots: getHidingSpotPoolStats(),
  enemies: getEnemyPoolStats(),
}
assert(
  poolStatsBeforeDispose.collectibles.geometries === midRunStats.collectibles &&
    poolStatsBeforeDispose.collectibles.geometries <= 25,
  `Collectible geometry pool stops growing after archetypes cached (${midRunStats.collectibles} -> ${poolStatsBeforeDispose.collectibles.geometries})`
)
assert(
  poolStatsBeforeDispose.enemies.geometries === midRunStats.enemies &&
    poolStatsBeforeDispose.enemies.geometries <= 45,
  `Enemy geometry pool stops growing after archetypes cached (${midRunStats.enemies} -> ${poolStatsBeforeDispose.enemies.geometries})`
)
assert(
  poolStatsBeforeDispose.hazards.geometries === midRunStats.hazards &&
    poolStatsBeforeDispose.hazards.geometries <= 20,
  `Hazard geometry pool stops growing after types cached (${midRunStats.hazards} -> ${poolStatsBeforeDispose.hazards.geometries})`
)
assert(
  poolStatsBeforeDispose.hidingSpots.geometries === midRunStats.hidingSpots &&
    poolStatsBeforeDispose.hidingSpots.geometries <= 24,
  `Hiding spot geometry pool stops growing after types cached (${midRunStats.hidingSpots} -> ${poolStatsBeforeDispose.hidingSpots.geometries})`
)

// Spy on a shared collectible geometry in use by engineB
let engineBSharedGeo = null
for (const entry of engineB.getCollectibleManager().coins.values()) {
  const coinMesh = entry?.mesh || entry
  engineBSharedGeo = coinMesh?.children?.[0]?.geometry || null
  if (engineBSharedGeo) break
}
assert(engineBSharedGeo !== null && isSharedResource(engineBSharedGeo), 'EngineB uses shared collectible geometry')
let sharedDisposedEarly = 0
const origBGeoDispose = engineBSharedGeo.dispose.bind(engineBSharedGeo)
engineBSharedGeo.dispose = () => {
  sharedDisposedEarly += 1
  origBGeoDispose()
}

// Disposing engineA while engineB is still running must keep shared pools intact
engineA.dispose()
assert(getActiveSharedPoolOwnerCount() === 1, 'Pool owner count decrements to 1 when engineA disposes')
assert(sharedDisposedEarly === 0, 'Disposing engineA must not destroy shared resources still used by engineB')
assert(getCollectiblePoolStats().geometries > 0, 'Shared pools stay populated while engineB is active')

// Disposing last engineB must release and clear all shared pools cleanly
engineB.dispose()
assert(getActiveSharedPoolOwnerCount() === 0, 'Pool owner count reaches 0 after last engine disposes')
assert(sharedDisposedEarly === 1, 'Shared pool resource is disposed cleanly when last engine disposes')
assert(getCollectiblePoolStats().geometries === 0 && getCollectiblePoolStats().materials === 0, 'Collectible pool cleared after last engine dispose')
assert(getHazardPoolStats().geometries === 0 && getHazardPoolStats().materials === 0, 'Hazard pool cleared after last engine dispose')
assert(getHidingSpotPoolStats().geometries === 0 && getHidingSpotPoolStats().materials === 0, 'Hiding spot pool cleared after last engine dispose')
assert(getEnemyPoolStats().geometries === 0 && getEnemyPoolStats().materials === 0, 'Enemy pool cleared after last engine dispose')

// 3. Exit Gate Performance Optimization (skip unchanged material writes)
console.log('Test 3: Exit Gate Avoids Redundant Unchanged Material Writes')
const gateMaze = generateMaze({ difficulty: 'small', seed: 3030, includeObjectives: true })
const gateMazeGroup = buildMazeMeshes(gateMaze)
const gateGroup = gateMazeGroup.userData.exitGate
setExitGateState(gateGroup, true, { animate: false })

let frameColorSetHexCount = 0
let portalOpacityWrites = 0
const origFrameColorSetHex = gateGroup.userData.frameMat.color.setHex.bind(gateGroup.userData.frameMat.color)
gateGroup.userData.frameMat.color.setHex = (...args) => {
  frameColorSetHexCount += 1
  return origFrameColorSetHex(...args)
}
let trackedPortalOpacity = gateGroup.userData.statusMat.opacity
Object.defineProperty(gateGroup.userData.statusMat, 'opacity', {
  get: () => trackedPortalOpacity,
  set: (v) => {
    portalOpacityWrites += 1
    trackedPortalOpacity = v
  },
})

let trackedIntensity = gateGroup.userData.frameMat.emissiveIntensity
let intensityWrites = 0
Object.defineProperty(gateGroup.userData.frameMat, 'emissiveIntensity', {
  get: () => trackedIntensity,
  set: (v) => {
    intensityWrites += 1
    trackedIntensity = v
  },
})

// Simulate 10 idle frames at same elapsedSec (unchanged steady pulse)
for (let i = 0; i < 10; i += 1) {
  updateExitGate(gateGroup, 0.016, 1.0)
}
assert(frameColorSetHexCount === 0, 'Unchanged locked state never re-calls color.setHex across frames')
assert(portalOpacityWrites === 0, 'Unchanged locked state never re-writes statusMat.opacity across frames')
assert(intensityWrites === 1, `Unchanged steady pulse writes emissiveIntensity only once (got ${intensityWrites})`)

// Unlocking immediately updates palette + door/lock animation
setExitGateState(gateGroup, false, { animate: true })
assert(frameColorSetHexCount === 1, 'State change triggers color.setHex once')
assert(portalOpacityWrites === 1, 'State change triggers statusMat.opacity update once')
assert(
  gateGroup.userData.frameMat.color.getHex() === MAZE_MESH_PALETTE.exitAccent,
  'Unlocked elevator switches frame beacons to emergency emerald'
)

for (let i = 0; i < 60; i += 1) {
  updateExitGate(gateGroup, 0.02, 1.0 + i * 0.02)
}
assert(gateGroup.userData.lockBarGroup.visible === false, 'Lock bar hides after unlock animation finishes')
assert(
  Math.abs(gateGroup.userData.doors.leftInner.position.x) >= 0.94 &&
    Math.abs(gateGroup.userData.doors.rightInner.position.x) >= 0.94,
  'Extraction elevator doors slide fully open after unlock animation finishes'
)
assert(frameColorSetHexCount === 1, 'Unlock animation ticks never re-apply color.setHex when state stays unlocked')

disposeMazeGroup(gateMazeGroup)

// 4. Enemy PointLight Budget, Low-Perf Rendering & Adaptive Frame Pacing
console.log('Test 4: Enemy PointLight Budget, Low-Perf Scaling & Adaptive Frame Pacing')
const noLightEnemy = buildEnemy({ id: 'e-nolight', type: 'hunter', sensorLightEnabled: false })
assert(noLightEnemy.userData.rig.sensorLight === null, 'Enemy omits PointLight when sensorLightEnabled=false')
updateEnemyVisualState(noLightEnemy, 'chase')
assert(
  noLightEnemy.userData.rig.sensorMesh.material.color.getHex() === noLightEnemy.userData.typePalette.sensorChase,
  'Enemy ocular material still updates without sensorLight'
)
disposeEnemy(noLightEnemy)

const hardcoreMaze = generateMaze({ difficulty: 'hardcore', seed: 4040 })
const hardcoreMeshGroup = buildMazeMeshes(hardcoreMaze)
const hardcoreWallMeshes = getLayerMeshes(hardcoreMeshGroup.getObjectByName('maze-walls'))
const hardcoreCapMeshes = getLayerMeshes(hardcoreMeshGroup.getObjectByName('maze-wall-caps'))
const wallInstanceSum = hardcoreWallMeshes.reduce((s, m) => s + m.count, 0)
const capInstanceSum = hardcoreCapMeshes.reduce((s, m) => s + m.count, 0)
assert(
  hardcoreWallMeshes.length > 1 &&
    hardcoreWallMeshes.every((m) => m.isInstancedMesh) &&
    wallInstanceSum === hardcoreMeshGroup.userData.wallCount,
  `Hardcore 31x31 walls preserve ${hardcoreMeshGroup.userData.wallCount} instances across ${hardcoreWallMeshes.length} chunked InstancedMeshes`
)
assert(
  hardcoreCapMeshes.length > 1 &&
    hardcoreCapMeshes.every((m) => m.isInstancedMesh) &&
    capInstanceSum === hardcoreMeshGroup.userData.wallCount,
  `Hardcore 31x31 caps preserve ${hardcoreMeshGroup.userData.wallCount} instances across ${hardcoreCapMeshes.length} chunked InstancedMeshes`
)
disposeMazeGroup(hardcoreMeshGroup)

const { engine: swEngine, mockRenderer: swRenderer } = createHeadlessEngine({
  isSoftwareGl: true,
})
swEngine.setMaze(hardcoreMaze)
const swEnemyLights = swEngine.getEnemies().filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length
assert(swEnemyLights === 0, `Software GL disables enemy PointLights (got ${swEnemyLights})`)
assert(swRenderer.pixelRatio === 1, 'Software GL caps pixel ratio to 1')
assert(swEngine.getPerformanceProfile().particlesEnabled === false, 'Software GL disables dust particles')
assert(swEngine.getPerformanceProfile().antialias === false, 'Software GL disables antialias')
swEngine.dispose()

const { engine: lowEngine } = createHeadlessEngine({
  isSoftwareGl: false,
  lowPerformance: true,
})
lowEngine.setMaze(hardcoreMaze)
const lowEnemies = lowEngine.getEnemies()
const lowEnemyLights = lowEnemies.filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length
assert(lowEnemies.length === 7, 'Hardcore 31x31 maze spawns 7 enemies')
assert(lowEnemyLights <= 1, `Low-performance device caps enemy PointLights to <= 1 (got ${lowEnemyLights})`)
assert(lowEngine.getPerformanceProfile().pixelRatioCap <= 1.5, 'Low-performance device caps pixel ratio <= 1.5')
assert(lowEngine.getPerformanceProfile().particleCount <= 45, 'Low-performance device reduces particle count')
lowEngine.dispose()

const { engine: hiEngine } = createHeadlessEngine({
  isSoftwareGl: false,
  lowPerformance: false,
})
hiEngine.setMaze(hardcoreMaze)
const hiEnemyLights = hiEngine.getEnemies().filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length
assert(hiEnemyLights <= 2, `Capable hardware caps dynamic enemy PointLights to <= 2 (got ${hiEnemyLights})`)
assert(hiEngine.getPerformanceProfile().antialias === true, 'Capable hardware preserves antialias')
hiEngine.dispose()

const fastDelay = computeAdaptiveFrameDelayMs(4, false)
const slowDelay = computeAdaptiveFrameDelayMs(60, false)
const pausedDelay = computeAdaptiveFrameDelayMs(4, true)
assert(fastDelay >= 32 && fastDelay < slowDelay, 'Adaptive frame delay increases with measured render duration')
assert(slowDelay <= 180, 'Adaptive frame delay stays bounded <= 180ms')
assert(pausedDelay === 200, 'Paused frame delay relaxes to 200ms idle cadence')

// 5. Engine Dispose Callback Cleanup & Look Invert-Y Consistency
console.log('Test 5: Engine Dispose Callback Cleanup & Pointer-Lock Invert-Y Consistency')
const { engine: lifecycleEngine } = createHeadlessEngine({
  isSoftwareGl: true,
  onPlayerDamage: () => {},
  onGameOver: () => {},
  onFlashlightChange: () => {},
  onFrame: () => {},
  onStealthChange: () => {},
  onHorrorEvent: () => {},
})
lifecycleEngine.setMaze(gateMaze)
lifecycleEngine.start()
assert(lifecycleEngine.isRunning === true, 'Lifecycle engine starts running')
lifecycleEngine.dispose()
assert(lifecycleEngine.isDisposed === true, 'Lifecycle engine marked disposed')
assert(lifecycleEngine.isRunning === false, 'Lifecycle engine stops on dispose')
assert(lifecycleEngine._timeoutId === null && lifecycleEngine._frameId === null, 'Loop timers cleared on dispose')
assert(lifecycleEngine._onPlayerDamage === null, '_onPlayerDamage cleared on dispose')
assert(lifecycleEngine._onGameOver === null, '_onGameOver cleared on dispose')
assert(lifecycleEngine._onFlashlightChange === null, '_onFlashlightChange cleared on dispose')
assert(lifecycleEngine._onFrame === null, '_onFrame cleared on dispose')
assert(lifecycleEngine._onStealthChange === null, '_onStealthChange cleared on dispose')
assert(lifecycleEngine._onHorrorEvent === null, '_onHorrorEvent cleared on dispose')
assert(lifecycleEngine.spotlight === null && lifecycleEngine.spotlightTarget === null, 'Flashlight refs cleared on dispose')
assert(lifecycleEngine.scene === null && lifecycleEngine.renderer === null, 'Scene and renderer nulled on dispose')
assert(getActiveSharedPoolOwnerCount() === 0, 'No dangling shared pool owners after dispose')

const lookTopLevel = resolveLookInputConfig({
  mouseSensitivity: 0.004,
  invertY: true,
})
const lookNestedCamera = resolveLookInputConfig({
  camera: { sensitivity: 0.004, invertY: true },
})
const lookFallback = resolveLookInputConfig({
  invertY: undefined,
  camera: { invertY: true },
})
assert(
  lookTopLevel.invertY === true &&
    lookNestedCamera.invertY === true &&
    lookFallback.invertY === true,
  'Pointer-lock, drag-look, and touch-look resolve invertY identically from cfg.invertY or cfg.camera.invertY'
)
assert(
  lookTopLevel.sensitivity === 0.004 && lookNestedCamera.sensitivity === 0.004,
  'Pointer-lock and drag-look resolve sensitivity identically'
)

console.log('ALL PHASE F PROMPT 02 TESTS PASSED!')
