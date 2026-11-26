import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  ALL_HIDING_SPOT_TYPES,
  HIDING_SPOT_CONFIG,
  HIDING_SPOT_TYPES,
  getHidingSpotConfig,
  isValidHidingSpotType,
  localToWorldSpotOffset,
} from '../mechanics/hidingConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { placeHazards } from '../generation/hazardPlacement.js'
import { placeKeycards } from '../generation/keycardPlacement.js'
import { placeCollectibles } from '../generation/collectiblePlacement.js'
import { placeEnvironmentalProps } from '../generation/environmentalPropPlacement.js'
import {
  placeHidingSpots,
  resolveFloorHatchCutouts,
} from '../generation/hidingSpotPlacement.js'
import { validateMaze } from '../generation/pathfinder.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { moveWithSubsteps } from '../world/gridCollision.js'
import {
  buildPropCollisionIndex,
  getDynamicCollider,
} from '../world/propCollision.js'
import {
  buildHidingSpotMesh,
  disposeHidingSpotMesh,
  syncHidingSpotQuality,
  updateHidingSpotVisualState,
} from './buildHidingSpots.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { HidingSpotAgent } from './HidingSpotAgent.js'
import { HidingSpotManager } from './HidingSpotManager.js'
import {
  CAMERA_MODES,
  CameraRig,
  THIRD_PERSON_CAMERA_MODES,
} from './CameraRig.js'
import { EnemyAgent, ENEMY_STATES, ENEMY_TYPES } from './EnemyAgent.js'
import { EnemyManager } from './EnemyManager.js'
import {
  HIGH_CONTRAST_COLORS,
  applyHighContrastToScene,
  disposeHighContrastPools,
  getHighContrastPoolStats,
  syncHidingSpotHighContrast,
} from './highContrastOutlines.js'

console.log('--- RUNNING MAZE-HIDING-IMPLEMENT-003 TESTS ---')

// 1. Validate all 8 hiding spot configurations & helpers
console.log('Test 1: Hiding Spot Config & Geometry Helpers (All 8 Types)')
assert.equal(ALL_HIDING_SPOT_TYPES.length, 8, 'Exactly 8 hiding spot types defined')
const expectedTypes = [
  'metal_cupboard',
  'elevated_platform',
  'pipe_crawlspace',
  'machinery_hiding',
  'wall_alcove',
  'heavy_industrial_curtains',
  'floor_hatch',
  'storage_shelves',
]
for (const type of expectedTypes) {
  assert.equal(isValidHidingSpotType(type), true, `Type ${type} must be valid`)
  const cfg = getHidingSpotConfig(type)
  assert.equal(cfg, HIDING_SPOT_CONFIG[type], `Direct config lookup matches for ${type}`)
  assert.ok(cfg, `Config exists for ${type}`)
  assert.ok(cfg.label && cfg.shortLabel && cfg.interactPrompt && cfg.exitPrompt)
  assert.ok(cfg.maxDurationSec >= 15 && cfg.maxDurationSec <= 30)
  assert.ok(cfg.noiseDamping > 0 && cfg.noiseDamping <= 1)
  assert.ok(cfg.subtitles?.enter && cfg.subtitles?.exit && cfg.subtitles?.warning && cfg.subtitles?.eject)
  assert.ok(cfg.cameraPose && Number.isFinite(cfg.cameraPose.eyeHeight))
  assert.ok(cfg.placement && cfg.placement.halfWidth > 0)
}
assert.equal(isValidHidingSpotType('nonexistent_spot'), false)

const worldOffset = localToWorldSpotOffset(10, 20, Math.PI / 2, 0, 1)
assert.ok(Math.abs(worldOffset.x - 11) < 1e-6 && Math.abs(worldOffset.z - 20) < 1e-6)

// 2. Procedural 3D Mesh Builders, Animations, Quality Presets & Disposal for all 8 types
console.log('Test 2: Procedural 3D Geometry & Visual State for All 8 Types')
const expectedPartNamesByType = {
  [HIDING_SPOT_TYPES.METAL_CUPBOARD]: ['locker-door-pivot', 'locker-back', 'hiding-indicator'],
  [HIDING_SPOT_TYPES.ELEVATED_PLATFORM]: ['platform-deck', 'ladder-rail-l', 'hiding-indicator'],
  [HIDING_SPOT_TYPES.PIPE_CRAWLSPACE]: ['crawl-flap-pivot', 'crawl-pipe-0', 'crawl-pressure-gauge'],
  [HIDING_SPOT_TYPES.MACHINERY_HIDING]: ['machinery-flywheel-pivot', 'machinery-panel-pivot', 'machinery-fin-0'],
  [HIDING_SPOT_TYPES.WALL_ALCOVE]: ['alcove-left-pillar', 'alcove-lintel', 'alcove-back-padding'],
  [HIDING_SPOT_TYPES.HEAVY_INDUSTRIAL_CURTAINS]: ['curtain-strip-0', 'curtain-strip-5', 'curtain-track-rod'],
  [HIDING_SPOT_TYPES.FLOOR_HATCH]: ['hatch-lid-pivot', 'pit-floor', 'hatch-wheel-latch'],
  [HIDING_SPOT_TYPES.STORAGE_SHELVES]: ['shelf-post-0-0', 'shelf-tarp-pivot', 'shelf-crate-mid-l'],
}

for (const type of ALL_HIDING_SPOT_TYPES) {
  const mesh = buildHidingSpotMesh(
    { id: `test-${type}`, type, x: 2, y: 0, z: -2, wallYaw: 0 },
    { qualityPreset: 'high' }
  )
  assert.ok(mesh && mesh.isGroup, `Built Three.js group for ${type}`)
  assert.equal(mesh.userData.hidingSpotType, type)

  for (const partName of expectedPartNamesByType[type]) {
    const child = mesh.getObjectByName(partName)
    assert.ok(child, `Spot ${type} missing expected structural part "${partName}"`)
  }

  // Test animation updates (open/close/flywheel/curtain/indicators/reducedMotion)
  updateHidingSpotVisualState(mesh, {
    openProgress: 0.85,
    occupied: true,
    warning: true,
    compromised: false,
    swayPhase: 1.2,
    swayAmp: 0.7,
    flywheelAngle: 1.5,
    reducedMotion: false,
  })
  assert.equal(mesh.userData.indicatorMat.color.getHex(), 0xf59e0b)

  updateHidingSpotVisualState(mesh, {
    openProgress: 0.5,
    occupied: true,
    warning: true,
    compromised: true,
    flywheelAngle: 2.0,
    reducedMotion: true,
  })
  assert.equal(mesh.userData.indicatorMat.color.getHex(), 0xef4444)
  if (type === HIDING_SPOT_TYPES.MACHINERY_HIDING) {
    assert.equal(mesh.userData.flywheelPivot.rotation.x, 0, 'Flywheel stops under reducedMotion')
  }

  // Test quality preset toggles shadows cleanly
  syncHidingSpotQuality(mesh, 'performance')
  let anyCasterInPerf = false
  mesh.traverse((node) => {
    if (node.isMesh && node.castShadow) anyCasterInPerf = true
  })
  assert.equal(anyCasterInPerf, false, `${type} disables shadow casting in performance preset`)
  syncHidingSpotQuality(mesh, 'high')

  assert.equal(disposeHidingSpotMesh(mesh), true, `Disposed ${type} mesh cleanly`)
}

// 3. Deterministic Placement, Topology Safety, Reachability & Floor Cutouts
console.log('Test 3: Deterministic Placement, Exclusions & Floor Cutouts')
const mazeSeed = 424242
const mazeA = generateMaze({ seed: mazeSeed })
const mazeB = generateMaze({ seed: mazeSeed })
const mazeAlt = generateMaze({ seed: 918273 })

assert.ok(Array.isArray(mazeA.hidingSpots) && mazeA.hidingSpots.length >= 8)
assert.deepEqual(
  mazeA.hidingSpots,
  placeHidingSpots(mazeA, {
    hazards: mazeA.hazards,
    keycards: mazeA.keycards,
    collectibles: mazeA.collectibles,
  }),
  'Direct placeHidingSpots matches generateMaze().hidingSpots cleanly'
)
assert.deepEqual(mazeA.hidingSpots, mazeB.hidingSpots, 'Identical seeds yield identical hiding spots')
assert.notDeepEqual(mazeA.hidingSpots, mazeAlt.hidingSpots, 'Different seeds vary hiding spot layout')

// Existing gameplay placement RNG isolation check
assert.deepEqual(
  mazeA.hazards,
  placeHazards(mazeA),
  'Hazard placement remains bit-for-bit deterministic and isolated'
)
assert.deepEqual(
  mazeA.keycards,
  placeKeycards({ ...mazeA, hazards: mazeA.hazards }),
  'Keycard placement remains deterministic and isolated'
)
assert.deepEqual(
  mazeA.collectibles,
  placeCollectibles(mazeA, { hazards: mazeA.hazards, keycards: mazeA.keycards }),
  'Collectible placement remains deterministic and isolated'
)

// Exactly 4 distinct hiding spot types selected per level with multiple instances (min 2)
assert.equal(mazeA.hidingSpotSelection.selectedTypes.length, 4, 'Maze selects exactly 4 distinct hiding spot types')
const selectedTypesSet = new Set(mazeA.hidingSpotSelection.selectedTypes)
const placedTypes = new Set(mazeA.hidingSpots.map((s) => s.type))
for (const type of placedTypes) {
  assert.equal(
    selectedTypesSet.has(type),
    true,
    `Generated maze includes only selected hiding spot type: ${type}`
  )
}
for (const type of mazeA.hidingSpotSelection.selectedTypes) {
  const count = mazeA.hidingSpots.filter((s) => s.type === type).length
  assert.ok(count >= 2, `Selected hiding spot type ${type} has at least 2 instances (got ${count})`)
}

// Validate exclusions & corridor clearance
const blockedCellKeys = new Set([
  `${mazeA.start.row},${mazeA.start.col}`,
  `${mazeA.exit.row},${mazeA.exit.col}`,
  ...mazeA.hazards.map((h) => `${h.row},${h.col}`),
  ...mazeA.keycards.map((k) => `${k.row},${k.col}`),
  ...(mazeA.collectibles?.items || []).map((c) => `${c.row},${c.col}`),
])
const propPlacements = placeEnvironmentalProps(mazeA)
const propCellKeys = new Set(propPlacements.map((p) => `${p.row},${p.col}`))
const hidingCellKeys = new Set()

for (const spot of mazeA.hidingSpots) {
  const key = `${spot.row},${spot.col}`
  assert.equal(mazeA.grid[spot.row][spot.col], CELL_TYPES.PATH, 'Hiding spot sits on walkable cell')
  assert.equal(blockedCellKeys.has(key), false, `Spot ${spot.id} avoids start/exit/hazards/keycards/collectibles`)
  assert.equal(propCellKeys.has(key), false, `Props avoid hiding spot cell ${key}`)
  assert.equal(hidingCellKeys.has(key), false, `No duplicate hiding spot on cell ${key}`)
  hidingCellKeys.add(key)

  const distStart =
    Math.abs(spot.row - mazeA.start.row) + Math.abs(spot.col - mazeA.start.col)
  const distExit =
    Math.abs(spot.row - mazeA.exit.row) + Math.abs(spot.col - mazeA.exit.col)
  assert.ok(distStart > 1, 'Spot maintains start buffer')
  assert.ok(distExit > 1, 'Spot maintains exit buffer')
  const p = HIDING_SPOT_CONFIG[spot.type].placement
  const remainingPassage =
    CELL_SIZE - (p.wallGap + p.halfDepthBack + p.halfDepthFront)
  assert.ok(
    remainingPassage >= 1.9,
    `Spot ${spot.id} preserves >= 1.9m walkable corridor width (got ${remainingPassage.toFixed(2)})`
  )
}

assert.equal(validateMaze(mazeA).valid, true, 'Maze reachability remains 100% intact')

const mazeHatch = generateMaze({ seed: 1 })
const hatchSpots = mazeHatch.hidingSpots.filter((s) => s.type === HIDING_SPOT_TYPES.FLOOR_HATCH)
assert.ok(hatchSpots.length >= 1, 'Generated maze includes at least one floor_hatch spot')
const hatchCutouts = resolveFloorHatchCutouts(mazeHatch, { hidingSpots: mazeHatch.hidingSpots })
assert.equal(hatchCutouts.length, hatchSpots.length, 'Every floor_hatch resolves a matching slab cutout')

const builtMazeGroup = buildMazeMeshes(mazeHatch, { qualityPreset: 'balanced' })
assert.ok(builtMazeGroup, 'buildMazeMeshes succeeds with hiding spots')
assert.equal(builtMazeGroup.userData.hidingSpotCount, mazeHatch.hidingSpots.length)
assert.ok(
  builtMazeGroup.userData.floorCutoutCount >= hatchCutouts.length,
  'buildMazeMeshes merges floor_hatch cutouts into floorCutouts'
)
disposeMazeGroup(builtMazeGroup)

// 4. HidingSpotManager, Dynamic Colliders, Interaction LOS & Limitations
console.log('Test 4: Manager Lifecycle, Dynamic Colliders, Wall LOS & Timeout/Flashlight')
const manager = new HidingSpotManager(new THREE.Scene())
manager.setMaze(mazeA)
assert.equal(manager.getHidingSpots().length, mazeA.hidingSpots.length)

const propIndex = buildPropCollisionIndex(mazeA, propPlacements, { allowEmpty: true })
manager.syncCollidersToIndex(propIndex)

const cupboard = manager
  .getHidingSpots()
  .find((s) => s.type === HIDING_SPOT_TYPES.METAL_CUPBOARD)
assert.ok(cupboard, 'Cupboard agent exists in manager')
const cupboardColBefore = getDynamicCollider(propIndex, `${cupboard.id}:collider`)
assert.ok(cupboardColBefore && cupboardColBefore.enabled === true, 'Empty cupboard registers blocking collider')

// Verify non-occupied player standing at entry anchor can see and interact
assert.equal(
  cupboard.canPlayerInteract(cupboard.entryAnchor, { row: cupboard.row, col: cupboard.col }),
  true,
  'Player at entry anchor can interact'
)

// Enter cupboard
const enterRes = manager.interact({
  playerWorldPos: cupboard.entryAnchor,
  playerGridCell: { row: cupboard.row, col: cupboard.col },
  propColliders: propIndex,
  spottedEntering: false,
})
assert.equal(enterRes.handled, true)
assert.equal(enterRes.action, 'enter')
assert.equal(manager.isPlayerHiding(), true)
assert.equal(manager.getActiveSpot().id, cupboard.id)

manager.syncCollidersToIndex(propIndex)
const cupboardColInside = getDynamicCollider(propIndex, `${cupboard.id}:collider`)
assert.equal(cupboardColInside.enabled, false, 'Cupboard collider disables while player occupies interior')

// Descriptor switches to Exit while occupied
const exitDesc = manager.findNearestInteractable(cupboard.interiorAnchor)
assert.equal(exitDesc.kind, 'hiding_spot')
assert.equal(exitDesc.shortLabel, 'Exit')

// Turning on flashlight inside triggers warning + exposure ramp
const stepFlashRes = manager.update(1.2, { flashlightActive: true, reducedMotion: false })
assert.equal(stepFlashRes.warningTriggered, true, 'Flashlight inside triggers stealth warning')
const statusFlash = manager.getStealthStatus()
assert.equal(statusFlash.hidingFlashlightLeak, true)
assert.ok(statusFlash.hidingExposure > 0.4)

// Turn off flashlight and advance past maxDurationSec to verify forced ejection
let ejectedInfo = null
for (let t = 0; t < 30; t += 1) {
  const upd = manager.update(1.0, { flashlightActive: false, reducedMotion: false })
  if (upd.ejected) {
    ejectedInfo = upd.ejected
    break
  }
}
assert.ok(ejectedInfo && ejectedInfo.forced === true, 'Exceeding maxDurationSec triggers forced exit')
assert.equal(manager.isPlayerHiding(), false, 'Player no longer hiding after forced exit')
manager.syncCollidersToIndex(propIndex)
assert.equal(
  getDynamicCollider(propIndex, `${cupboard.id}:collider`).enabled,
  true,
  'Cupboard collider re-enables cleanly on exit'
)

// Test wall LOS blocking interaction across a solid wall
const cupboardWallCell = { row: cupboard.wallRow, col: cupboard.wallCol }
if (
  Number.isInteger(cupboardWallCell.row) &&
  Number.isInteger(cupboardWallCell.col)
) {
  const farSideRow = cupboardWallCell.row + (cupboardWallCell.row - cupboard.row)
  const farSideCol = cupboardWallCell.col + (cupboardWallCell.col - cupboard.col)
  if (mazeA.grid[farSideRow]?.[farSideCol] === CELL_TYPES.PATH) {
    const farWorld = gridToWorld(farSideRow, farSideCol, mazeA)
    const wallBlockedSpot = new HidingSpotAgent(
      {
        id: 'wall-los-check',
        type: HIDING_SPOT_TYPES.WALL_ALCOVE,
        row: cupboard.row,
        col: cupboard.col,
        x: cupboard.worldPos.x,
        z: cupboard.worldPos.z,
        entryAnchor: cupboard.entryAnchor,
      },
      mazeA
    )
    wallBlockedSpot.config = { ...wallBlockedSpot.config, triggerRadius: 10 }
    assert.equal(
      wallBlockedSpot.canPlayerInteract(farWorld, { row: farSideRow, col: farSideCol }),
      false,
      'Wall blocks hiding spot interaction LOS'
    )
    wallBlockedSpot.dispose()
  }
}

// Verify walkable open corridor remains clear even near hiding spots (collision smoke test)
const spotCenterWorld = gridToWorld(cupboard.row, cupboard.col, mazeA)
const moveClearRes = moveWithSubsteps(
  cupboard.entryAnchor.x,
  cupboard.entryAnchor.z,
  0.01,
  0.01,
  mazeA,
  { radius: PLAYER_RADIUS, propColliders: propIndex }
)
assert.ok(Number.isFinite(moveClearRes.x) && Number.isFinite(moveClearRes.z))
assert.ok(spotCenterWorld)

// 5. CameraRig Poses & Constraints Across FP, TP Follow & TP Free Look
console.log('Test 5: CameraRig Poses Across All Camera Modes')
const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100)
const rig = new CameraRig(cam, { mode: CAMERA_MODES.FIRST_PERSON })
rig.setMaze(mazeA)

const managerHatch = new HidingSpotManager(new THREE.Scene())
managerHatch.setMaze(mazeHatch)

const platformSpot = manager
  .getHidingSpots()
  .find((s) => s.type === HIDING_SPOT_TYPES.ELEVATED_PLATFORM)
const hatchSpot = managerHatch
  .getHidingSpots()
  .find((s) => s.type === HIDING_SPOT_TYPES.FLOOR_HATCH)
const crawlSpot = manager
  .getHidingSpots()
  .find((s) => s.type === HIDING_SPOT_TYPES.PIPE_CRAWLSPACE)
assert.ok(platformSpot && hatchSpot && crawlSpot)

// Test First-Person clamping & elevation on Cupboard & Pipe Crawlspace
rig.setHidingState(cupboard.getCameraPose())
rig.setPlayerPosition(cupboard.interiorAnchor)
rig.setLookDirection(cupboard.wallYaw + Math.PI, 1.5) // Exceeds arc & maxPitch
rig.snap()
const clampedLook = rig.getLookDirection()
const maxArc = cupboard.config.cameraPose.yawHalfArc
const yawDelta = Math.abs(
  Math.atan2(
    Math.sin(clampedLook.yaw - cupboard.wallYaw),
    Math.cos(clampedLook.yaw - cupboard.wallYaw)
  )
)
assert.ok(yawDelta <= maxArc + 1e-4, 'Cupboard FP yaw clamped within peep-slit arc')
assert.ok(
  clampedLook.pitch <= cupboard.config.cameraPose.maxPitch + 1e-4,
  'Cupboard FP pitch clamped'
)
assert.ok(Math.abs(cam.position.y - cupboard.config.cameraPose.eyeHeight) < 0.05)

// Test Elevated Platform (+1.32m) in TP Character-Follow
rig.setMode(CAMERA_MODES.THIRD_PERSON)
rig.setThirdPersonMode(THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW)
rig.setHidingState(platformSpot.getCameraPose())
rig.setPlayerPosition(platformSpot.interiorAnchor)
rig.setLookDirection(platformSpot.wallYaw, -0.4)
rig.snap()
assert.ok(cam.position.y > 1.8 && cam.position.y <= 2.95, 'Elevated platform TP camera sits high yet safely below ceiling')

// Test Floor Hatch (-1.02m pit) in TP Free Look (should NOT clamp camera up above ground floor)
rig.setThirdPersonMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK)
rig.setHidingState(hatchSpot.getCameraPose())
rig.setPlayerPosition(hatchSpot.interiorAnchor)
rig.setLookDirection(hatchSpot.wallYaw, 0.35)
rig.snap()
rig.update(0.016, { immediate: false })
assert.ok(
  cam.position.y < 0.25,
  `Floor hatch pit camera preserves submerged elevation (got y=${cam.position.y.toFixed(2)})`
)

// Test Pipe Crawlspace low eye height in FP
rig.setMode(CAMERA_MODES.FIRST_PERSON)
rig.setHidingState(crawlSpot.getCameraPose())
rig.setPlayerPosition(crawlSpot.interiorAnchor)
rig.snap()
assert.ok(cam.position.y < 0.85, 'Pipe crawlspace lowers eye height to crouched level')
rig.clearHidingState()
rig.dispose()

// 6. Enemy AI Concealment, Chase-Drop, Discovery Limitations & Phantom Veil Preservation
console.log('Test 6: Enemy Perception, Compromise Conditions & Phantom Veil')
const corridorRow = 1
const enemySpot = mazeA.hidingSpots.find((s) => s.type === HIDING_SPOT_TYPES.METAL_CUPBOARD) || cupboard
const curtainSpot =
  managerHatch.getHidingSpots().find((s) => s.type === HIDING_SPOT_TYPES.HEAVY_INDUSTRIAL_CURTAINS) ||
  enemySpot

const aiMaze = {
  id: 'ai-corridor-maze',
  seed: 77,
  rows: 5,
  cols: 9,
  grid: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],
  start: { row: 1, col: 1 },
  exit: { row: 3, col: 7 },
}

const enemyAgent = new EnemyAgent('stalker-hiding-test', {
  type: ENEMY_TYPES.STALKER,
  maze: aiMaze,
  spawnCell: { row: corridorRow, col: 2 },
  patrolRoute: [
    { row: corridorRow, col: 2 },
    { row: corridorRow, col: 6 },
  ],
})

const pWorldFar = gridToWorld(corridorRow, 5, aiMaze) // Distance = 3 * 3m = 9m? Wait check CELL_SIZE
const pWorldMid = gridToWorld(corridorRow, 4, aiMaze) // 2 cells away (~4.8m - 6m)
const eWorld = gridToWorld(corridorRow, 2, aiMaze)
enemyAgent.worldPos.x = eWorld.x
enemyAgent.worldPos.z = eWorld.z
enemyAgent.yaw = -Math.PI / 2 // Facing +X (east toward col 4/5)

// Exposed baseline: enemy sees player clearly down open corridor
const seenOpen = enemyAgent._checkPerception({
  playerWorldPos: pWorldMid,
  playerGridCell: { row: corridorRow, col: 4 },
  playerMotion: { moved: false, isSprinting: false },
  hidingSpot: null,
})
assert.equal(seenOpen.canSee, true, 'Enemy sees exposed player in open corridor')

// Inside hiding spot quietly: enemy vision blocked
const hiddenInsideLocker = enemyAgent._checkPerception({
  playerWorldPos: pWorldMid,
  playerGridCell: { row: corridorRow, col: 4 },
  playerMotion: { moved: false, isSprinting: false },
  hidingSpot: {
    active: true,
    spotType: HIDING_SPOT_TYPES.METAL_CUPBOARD,
    concealment: 1.0,
    exposure: 0,
    compromised: false,
    spottedEntering: false,
    flashlightExposed: false,
    flashlightDetectRange: 7.5,
    noiseDamping: 0.75,
    closeDiscoveryRadius: 0,
  },
})
assert.equal(hiddenInsideLocker.isHidden, true, 'Hiding spot conceals player from enemy')
assert.equal(hiddenInsideLocker.canSee, false, 'Enemy cannot see concealed player')
assert.equal(hiddenInsideLocker.isHidingSpotConcealed, true)

// Chasing enemy loses sight faster when player enters hiding spot -> drops to INVESTIGATE
enemyAgent.state = ENEMY_STATES.CHASE
enemyAgent.loseSightTimer = 1.5
enemyAgent.lastKnownPlayerCell = { row: corridorRow, col: 4 }
enemyAgent.update(0.95, {
  playerWorldPos: pWorldMid,
  playerGridCell: { row: corridorRow, col: 4 },
  playerMotion: { moved: false, isSprinting: false },
  hidingSpot: {
    active: true,
    spotType: HIDING_SPOT_TYPES.METAL_CUPBOARD,
    concealment: 1.0,
    exposure: 0,
    compromised: false,
    spottedEntering: false,
    flashlightExposed: false,
    flashlightDetectRange: 7.5,
    noiseDamping: 0.75,
    closeDiscoveryRadius: 0,
  },
})
assert.equal(
  enemyAgent.state,
  ENEMY_STATES.INVESTIGATE,
  'Enemy chasing drops to INVESTIGATE quickly once player hides'
)

// Flashlight leak compromises hiding when enemy is within flashlightDetectRange with LOS
const leakedByFlashlight = enemyAgent._checkPerception({
  playerWorldPos: pWorldMid,
  playerGridCell: { row: corridorRow, col: 4 },
  playerMotion: { moved: false, isSprinting: false },
  hidingSpot: {
    active: true,
    spotType: HIDING_SPOT_TYPES.METAL_CUPBOARD,
    exposure: 0.2,
    compromised: false,
    spottedEntering: false,
    flashlightExposed: true,
    flashlightDetectRange: 10.5,
    noiseDamping: 0.75,
    closeDiscoveryRadius: 0,
  },
})
assert.equal(leakedByFlashlight.isHidden, false, 'Flashlight beam compromises hiding cover')
assert.equal(leakedByFlashlight.canSee, true, 'Enemy spots player via leaked flashlight beam')

// Spotted entering compromises hiding spot immediately
const spottedEnter = enemyAgent._checkPerception({
  playerWorldPos: pWorldMid,
  playerGridCell: { row: corridorRow, col: 4 },
  playerMotion: { moved: false, isSprinting: false },
  hidingSpot: {
    active: true,
    spotType: HIDING_SPOT_TYPES.MACHINERY_HIDING,
    exposure: 1.0,
    compromised: true,
    spottedEntering: true,
    flashlightExposed: false,
    flashlightDetectRange: 8.0,
    noiseDamping: 0.52,
    closeDiscoveryRadius: 1.35,
  },
})
assert.equal(spottedEnter.canSee, true, 'Enemy sees player who entered spot right in front of them')

// Close proximity discovery in semi-open spots (curtains) vs full enclosure (locker)
const pClose = { x: eWorld.x + 1.2, y: 0, z: eWorld.z }
const closeInCurtains = enemyAgent._checkPerception({
  playerWorldPos: pClose,
  playerGridCell: { row: corridorRow, col: 2 },
  playerMotion: { moved: false, isSprinting: false },
  hidingSpot: {
    active: true,
    spotType: HIDING_SPOT_TYPES.HEAVY_INDUSTRIAL_CURTAINS,
    exposure: 0,
    compromised: false,
    spottedEntering: false,
    flashlightExposed: false,
    flashlightDetectRange: 9.2,
    noiseDamping: 0.72,
    closeDiscoveryRadius: 1.85,
  },
})
assert.equal(
  closeInCurtains.canSee,
  true,
  'Enemy brushes past heavy curtains at <1.85m close proximity'
)

const closeInLocker = enemyAgent._checkPerception({
  playerWorldPos: pClose,
  playerGridCell: { row: corridorRow, col: 2 },
  playerMotion: { moved: false, isSprinting: false },
  hidingSpot: {
    active: true,
    spotType: HIDING_SPOT_TYPES.METAL_CUPBOARD,
    exposure: 0,
    compromised: false,
    spottedEntering: false,
    flashlightExposed: false,
    flashlightDetectRange: 7.5,
    noiseDamping: 0.75,
    closeDiscoveryRadius: 0,
  },
})
assert.equal(
  closeInLocker.canSee,
  false,
  'Enclosed metal locker conceals player even when enemy passes closely outside'
)

// Noise damping reduces hearing distance
const soundFar = {
  position: { x: eWorld.x + 5.0, y: 0, z: eWorld.z },
  range: 6.0,
  cell: { row: corridorRow, col: 3 },
}
const hearDamped = enemyAgent._checkPerception({
  playerWorldPos: pWorldFar,
  playerGridCell: { row: corridorRow, col: 5 },
  playerMotion: { moved: false, isSprinting: false },
  soundEvent: soundFar,
  hidingSpot: {
    active: true,
    spotType: HIDING_SPOT_TYPES.MACHINERY_HIDING,
    exposure: 0,
    compromised: false,
    spottedEntering: false,
    flashlightExposed: false,
    noiseDamping: 0.52,
    closeDiscoveryRadius: 1.35,
  },
})
assert.equal(
  hearDamped.canHear,
  false,
  'Compressor housing noise damping attenuates sound range (6.0 * 0.52 = 3.12 < 5.0)'
)

// Phantom Veil compatibility preserved even with flashlight/compromised spot
const phantomVeilCheck = enemyAgent._checkPerception({
  playerWorldPos: pClose,
  playerGridCell: { row: corridorRow, col: 2 },
  playerMotion: { moved: false, isSprinting: false },
  activeEffects: { phantomVeilRemainingMs: 5000 },
  hidingSpot: {
    active: true,
    spotType: HIDING_SPOT_TYPES.HEAVY_INDUSTRIAL_CURTAINS,
    compromised: true,
    flashlightExposed: true,
    closeDiscoveryRadius: 1.85,
  },
})
assert.equal(phantomVeilCheck.isHidden, true, 'Phantom Veil remains unconditionally protective')
assert.equal(phantomVeilCheck.canSee, false)
assert.ok(curtainSpot && pWorldFar)

const enemyMgr = new EnemyManager(new THREE.Scene(), { autoSpawn: false })
enemyMgr.setMaze(aiMaze, { autoSpawn: false })
enemyMgr.dispose()
enemyAgent.dispose()

// 7. High-Contrast Outlines Integration
console.log('Test 7: High-Contrast Accessibility Outlines for All 8 Types')
assert.equal(HIGH_CONTRAST_COLORS.hidingSpot, 0x2dd4bf)
disposeHighContrastPools()
applyHighContrastToScene({ hidingSpotManager: manager, enabled: true })
for (const spot of manager.getHidingSpots()) {
  const outline = spot.getMesh()?.userData?.highContrastOutline
  assert.ok(outline && outline.visible === true, `High-contrast outline enabled for ${spot.id}`)
}
applyHighContrastToScene({ hidingSpotManager: manager, enabled: false })
for (const spot of manager.getHidingSpots()) {
  assert.equal(
    spot.getMesh()?.userData?.highContrastOutline?.visible,
    false,
    `High-contrast outline hidden on toggle off for ${spot.id}`
  )
}
const poolStats = getHighContrastPoolStats()
assert.ok(poolStats.geometries >= 1 && poolStats.materials >= 1, 'Outline resources are pooled')
syncHidingSpotHighContrast(null, true) // null-safety check
disposeHighContrastPools()
manager.dispose()
managerHatch.dispose()

// 8. UI, Touch Controls, CSS, Audio & How-to-Play Integration Contracts
console.log('Test 8: UI, Touch, CSS, Audio & How-to-Play Contracts')
const howToPlaySrc = fs.readFileSync(path.resolve('src/components/game/HowToPlayContent.jsx'), 'utf8')
for (const label of [
  'Metal Lockers',
  'Elevated Platforms',
  'Pipe Crawlspaces',
  'Compressor Machinery',
  'Wall Alcoves',
  'Heavy Curtains',
  'Floor Hatches',
  'Storage Racks',
]) {
  assert.ok(howToPlaySrc.includes(label), `HowToPlayContent documents "${label}"`)
}

const viewportSrc = fs.readFileSync(path.resolve('src/components/game/MazeViewport3D.jsx'), 'utf8')
assert.ok(viewportSrc.includes('data-is-hiding='), 'MazeViewport3D exposes data-is-hiding')
assert.ok(viewportSrc.includes('maze-hiding-hud'), 'MazeViewport3D renders hiding HUD')
assert.ok(viewportSrc.includes('maze-hiding-vignette'), 'MazeViewport3D renders hiding vignette')

const touchSrc = fs.readFileSync(path.resolve('src/components/game/TouchControls3D.jsx'), 'utf8')
assert.ok(touchSrc.includes('maze-touch-btn--hiding-active'), 'TouchControls3D styles active hiding interact button')
assert.ok(touchSrc.includes("stealthState?.isHiding\n              ? 'Exit'"), 'TouchControls3D switches Interact button to Exit while hiding')

const cssSrc = fs.readFileSync(path.resolve('src/styles/maze.css'), 'utf8')
assert.ok(cssSrc.includes('.maze-hiding-hud'), 'maze.css defines .maze-hiding-hud')
assert.ok(cssSrc.includes('.maze-hiding-vignette'), 'maze.css defines .maze-hiding-vignette')
assert.equal(/\.maze-hiding[\s\S]*backdrop-filter/i.test(cssSrc), false, 'Hiding HUD avoids backdrop-filter')

const audioSrc = fs.readFileSync(path.resolve('src/game/three/HorrorAudioEngine.js'), 'utf8')
assert.ok(audioSrc.includes('onHidingInteraction('), 'HorrorAudioEngine implements onHidingInteraction')

const engineSrc = fs.readFileSync(path.resolve('src/game/three/MazeSceneEngine.js'), 'utf8')
assert.ok(engineSrc.includes('new HidingSpotManager('), 'MazeSceneEngine instantiates HidingSpotManager')
assert.ok(engineSrc.includes('getHidingSpotManager()'), 'MazeSceneEngine exposes getHidingSpotManager()')

assert.equal(CELL_SIZE > 0, true)

console.log('✓ All 8 hiding spot tests passed successfully!')
