import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  CEILING_LIGHT_STATES,
  stepCeilingLights,
} from './buildCeilingLights.js'
import {
  buildHazardMesh,
  disposeHazardMesh,
  updateHazardVisualState,
} from './buildHazards.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools } from './sharedResources.js'
import {
  buildUndergroundBackdrop,
  disposeUndergroundBackdrop,
  updateUndergroundBackdrop,
} from './undergroundBackdrop.js'

console.log('--- RUNNING PHASE 6 INSTANCE-COLOR & PER-FRAME OPTIMIZATION TESTS ---')

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  const mockRenderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: null, needsUpdate: false },
    pixelRatio: 1,
    setPixelRatio: (r) => {
      mockRenderer.pixelRatio = r
    },
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    isSoftwareGl: false,
    lowPerformance: false,
    ...config,
  })
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Ceiling Lights: Steady-state skips setColorAt & instanceColor uploads
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Ceiling lights skip redundant setColorAt & instanceColor uploads when unchanged')
  const maze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const mazeGroup = buildMazeMeshes(maze, { qualityPreset: 'high' })
  const lightsGroup = mazeGroup.userData.ceilingLightsGroup
  const ud = lightsGroup.userData
  const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)

  let diffSetCalls = 0
  let haloSetCalls = 0
  let spotMatrixCalls = 0

  for (const dm of ud.diffuserMeshes) {
    const origDiffSet = dm.setColorAt.bind(dm)
    dm.setColorAt = (i, c) => {
      diffSetCalls += 1
      return origDiffSet(i, c)
    }
  }
  for (const hm of ud.haloMeshes) {
    const origHaloSet = hm.setColorAt.bind(hm)
    hm.setColorAt = (i, c) => {
      haloSetCalls += 1
      return origHaloSet(i, c)
    }
  }
  for (const spot of ud.shadowSpotPool) {
    const origUpdate = spot.target.updateMatrixWorld?.bind(spot.target)
    spot.target.updateMatrixWorld = (...args) => {
      spotMatrixCalls += 1
      return origUpdate?.(...args)
    }
  }

  // First reducedMotion frame switches flickering fixtures to calm steady level
  stepCeilingLights(lightsGroup, 1.0, {
    playerWorldPos: startWorld,
    lightScale: 1,
    reducedMotion: true,
    highContrast: false,
    qualityPreset: 'high',
  })

  diffSetCalls = 0
  haloSetCalls = 0
  spotMatrixCalls = 0
  const diffVerBefore = ud.diffuserMeshes.map((m) => m.instanceColor.version)
  const haloVerBefore = ud.haloMeshes.map((m) => m.instanceColor.version)

  for (let f = 0; f < 60; f += 1) {
    stepCeilingLights(lightsGroup, 2.0 + f * 0.016, {
      playerWorldPos: startWorld,
      lightScale: 1,
      reducedMotion: true,
      highContrast: false,
      qualityPreset: 'high',
    })
  }

  assert.equal(diffSetCalls, 0, 'Steady reducedMotion frames trigger 0 diffuser setColorAt calls')
  assert.equal(haloSetCalls, 0, 'Steady reducedMotion frames trigger 0 halo setColorAt calls')
  assert.deepEqual(
    ud.diffuserMeshes.map((m) => m.instanceColor.version),
    diffVerBefore,
    'Steady reducedMotion frames do not increment any diffuser chunk instanceColor.version'
  )
  assert.deepEqual(
    ud.haloMeshes.map((m) => m.instanceColor.version),
    haloVerBefore,
    'Steady reducedMotion frames do not increment any halo chunk instanceColor.version'
  )
  assert.equal(
    spotMatrixCalls,
    0,
    'Steady spotlight binding does not redundantly call spot.target.updateMatrixWorld'
  )

  disposeMazeGroup(mazeGroup)
  assert.equal(ud._diffuserColorCache, null, 'disposeMazeGroup clears diffuser color cache')
  assert.equal(ud._haloColorCache, null, 'disposeMazeGroup clears halo color cache')
  assert.equal(ud._diffuserColorsInitialized, false, 'disposeMazeGroup resets diffuser init flag')
}

// ---------------------------------------------------------------------------
// 2. Ceiling Lights: Active flicker updates ONLY flickering fixtures; blackout/HC/preset changes upload accurately
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Ceiling lights active flicker, blackout scaling, highContrast & preset transitions')
  const maze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const mazeGroup = buildMazeMeshes(maze, { qualityPreset: 'performance' })
  const lightsGroup = mazeGroup.userData.ceilingLightsGroup
  const ud = lightsGroup.userData

  assert.ok(ud.haloMeshes.every((m) => m.visible === false), 'Halos hidden on performance preset')

  // Switching performance -> high must initialize and upload halo colors cleanly
  let haloCallsOnUpgrade = 0
  for (const hm of ud.haloMeshes) {
    const origHaloSet = hm.setColorAt.bind(hm)
    hm.setColorAt = (i, c) => {
      haloCallsOnUpgrade += 1
      return origHaloSet(i, c)
    }
  }

  stepCeilingLights(lightsGroup, 0.5, {
    lightScale: 1,
    reducedMotion: false,
    highContrast: false,
    qualityPreset: 'high',
  })
  assert.ok(ud.haloMeshes.every((m) => m.visible === true), 'Halos become visible when upgraded to high')
  assert.equal(
    haloCallsOnUpgrade,
    ud.fixtureCount,
    'Upgrading from performance to high populates all halo instance colors'
  )
  assert.ok(
    ud.haloMeshes.every((m) => m.instanceColor.version >= 1),
    'All halo chunk instanceColor versions increment on upgrade'
  )

  // Active flicker across frames: ONLY flickering diffusers should call setColorAt
  const diffUpdatedGlobal = []
  for (let mIdx = 0; mIdx < ud.diffuserMeshes.length; mIdx += 1) {
    const dm = ud.diffuserMeshes[mIdx]
    const origDiffSet = dm.setColorAt.bind(dm)
    dm.setColorAt = (localIdx, c) => {
      const globalIdx = ud.diffuserTargets.findIndex(
        (t) => t.meshIndex === mIdx && t.localIndex === localIdx
      )
      diffUpdatedGlobal.push(globalIdx)
      return origDiffSet(localIdx, c)
    }
  }

  const diffVer0 = ud.diffuserMeshes.reduce((s, m) => s + m.instanceColor.version, 0)
  for (let f = 1; f <= 10; f += 1) {
    stepCeilingLights(lightsGroup, 1.0 + f * 0.05, {
      lightScale: 1,
      reducedMotion: false,
      highContrast: false,
      qualityPreset: 'high',
    })
  }
  const diffVerAfterFlicker = ud.diffuserMeshes.reduce((s, m) => s + m.instanceColor.version, 0)
  assert.ok(
    diffVerAfterFlicker > diffVer0,
    'Active flickering increments diffuser instanceColor.version'
  )
  for (const idx of new Set(diffUpdatedGlobal)) {
    const f = ud.fixtures[ud.diffuserEntries[idx].fixtureIndex]
    assert.equal(
      f.condition,
      CEILING_LIGHT_STATES.FLICKERING,
      'Non-flickering diffusers are skipped during active flicker frames'
    )
  }

  // Same timestamp with reducedMotion=false & unchanged config triggers 0 uploads
  diffUpdatedGlobal.length = 0
  const diffVerSameT = ud.diffuserMeshes.map((m) => m.instanceColor.version)
  const haloCountBeforeSameT = haloCallsOnUpgrade
  stepCeilingLights(lightsGroup, 1.5, {
    lightScale: 1,
    reducedMotion: false,
    highContrast: false,
    qualityPreset: 'high',
  })
  assert.equal(diffUpdatedGlobal.length, 0, 'Duplicate timestamp performs 0 diffuser updates')
  assert.equal(haloCallsOnUpgrade, haloCountBeforeSameT, 'Duplicate timestamp performs 0 halo updates')
  assert.deepEqual(
    ud.diffuserMeshes.map((m) => m.instanceColor.version),
    diffVerSameT
  )

  // Blackout lightScale drop must update ALL diffusers (working, flickering, burned out)
  diffUpdatedGlobal.length = 0
  const diffVerBeforeBlackout = ud.diffuserMeshes.map((m) => m.instanceColor.version)
  stepCeilingLights(lightsGroup, 1.5, {
    lightScale: 0.25,
    reducedMotion: false,
    highContrast: false,
    qualityPreset: 'high',
  })
  assert.equal(
    new Set(diffUpdatedGlobal).size,
    ud.diffuserEntries.length,
    'Blackout lightScale drop updates all diffuser instances across all chunks'
  )
  for (let mIdx = 0; mIdx < ud.diffuserMeshes.length; mIdx += 1) {
    assert.ok(ud.diffuserMeshes[mIdx].instanceColor.version > diffVerBeforeBlackout[mIdx])
  }

  const dimmedColor = new THREE.Color()
  ud.diffuserTargets[0].mesh.getColorAt(ud.diffuserTargets[0].localIndex, dimmedColor)
  assert.ok(dimmedColor.r < 0.5 && dimmedColor.b < 0.5, 'Diffuser color reflects blackout dimming')

  // HighContrast toggle restores contrast-restrained colors & hides halos
  diffUpdatedGlobal.length = 0
  stepCeilingLights(lightsGroup, 1.5, {
    lightScale: 1,
    reducedMotion: false,
    highContrast: true,
    qualityPreset: 'high',
  })
  assert.ok(ud.haloMeshes.every((m) => m.visible === false), 'High contrast hides overhead halos')
  assert.ok(diffUpdatedGlobal.length > 0, 'Toggling highContrast updates diffuser colors')

  disposeMazeGroup(mazeGroup)
}

// ---------------------------------------------------------------------------
// 3. Underground Backdrop: Dirty-checked beacon bulbs & halos + blackout response
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Underground backdrop beacons dirty-check colors and respond to lightScale/time')
  const backdrop = buildUndergroundBackdrop({
    span: { rows: 21, cols: 21, width: 84, depth: 84 },
    qualityPreset: 'high',
  })
  const bc = backdrop.userData.beaconController
  assert.ok(bc?.entries?.length > 0, 'Beacon controller created')

  let bulbCalls = 0
  let haloCalls = 0
  const origBulbSet = bc.bulbMesh.setColorAt.bind(bc.bulbMesh)
  bc.bulbMesh.setColorAt = (i, c) => {
    bulbCalls += 1
    return origBulbSet(i, c)
  }
  const origHaloSet = bc.haloMesh.setColorAt.bind(bc.haloMesh)
  bc.haloMesh.setColorAt = (i, c) => {
    haloCalls += 1
    return origHaloSet(i, c)
  }

  // Initial steady reducedMotion at lightScale=1 matches initial build colors -> 0 uploads
  const vb0 = bc.bulbMesh.instanceColor.version
  const vh0 = bc.haloMesh.instanceColor.version
  for (let f = 0; f < 30; f += 1) {
    updateUndergroundBackdrop(backdrop, f * 0.016, {
      lightScale: 1,
      reducedMotion: true,
    })
  }
  assert.equal(bulbCalls, 0, 'Backdrop steady reducedMotion at scale 1 triggers 0 bulb setColorAt calls')
  assert.equal(haloCalls, 0, 'Backdrop steady reducedMotion at scale 1 triggers 0 halo setColorAt calls')
  assert.equal(bc.bulbMesh.instanceColor.version, vb0)
  assert.equal(bc.haloMesh.instanceColor.version, vh0)

  // Blackout lightScale triggers updates once, then remains steady on subsequent frames
  updateUndergroundBackdrop(backdrop, 1.0, { lightScale: 0.3, reducedMotion: true })
  assert.equal(bulbCalls, bc.entries.length, 'Blackout dip updates all backdrop bulbs once')
  assert.equal(haloCalls, bc.entries.length, 'Blackout dip updates all backdrop halos once')
  assert.equal(bc.bulbMesh.instanceColor.version, vb0 + 1)
  assert.equal(bc.haloMesh.instanceColor.version, vh0 + 1)

  bulbCalls = 0
  haloCalls = 0
  for (let f = 0; f < 20; f += 1) {
    updateUndergroundBackdrop(backdrop, 2.0 + f * 0.016, { lightScale: 0.3, reducedMotion: true })
  }
  assert.equal(bulbCalls, 0, 'Steady dimmed reducedMotion frames perform 0 redundant uploads')
  assert.equal(haloCalls, 0)

  // Active pulse (!reducedMotion) updates with advancing time, skips duplicate timestamp
  updateUndergroundBackdrop(backdrop, 3.0, { lightScale: 1, reducedMotion: false })
  const callsAfterStep = bulbCalls
  assert.ok(callsAfterStep > 0, 'Active backdrop pulse updates bulb colors')
  updateUndergroundBackdrop(backdrop, 3.0, { lightScale: 1, reducedMotion: false })
  assert.equal(bulbCalls, callsAfterStep, 'Duplicate timestamp skips redundant backdrop upload')

  disposeUndergroundBackdrop(backdrop)
  assert.equal(backdrop.userData.beaconController, null, 'disposeUndergroundBackdrop clears controller')
}

// ---------------------------------------------------------------------------
// 4. Hazards skip steady-state material/transform mutations
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Hazards skip steady-state visual updates and respond to state changes')
  const wiringMesh = buildHazardMesh({ id: 'test-wiring', type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING })
  let wiringEmissiveSetHexCount = 0
  const origTipEmissiveSetHex = wiringMesh.userData.tipMat.emissive.setHex.bind(wiringMesh.userData.tipMat.emissive)
  wiringMesh.userData.tipMat.emissive.setHex = (hex) => {
    wiringEmissiveSetHexCount += 1
    return origTipEmissiveSetHex(hex)
  }
  updateHazardVisualState(wiringMesh, 'dormant', 0)
  wiringEmissiveSetHexCount = 0
  for (let i = 0; i < 30; i += 1) {
    updateHazardVisualState(wiringMesh, 'dormant', 0)
  }
  assert.equal(wiringEmissiveSetHexCount, 0, 'Steady dormant electrical wiring skips redundant material writes')
  updateHazardVisualState(wiringMesh, 'active', 0)
  assert.equal(wiringEmissiveSetHexCount, 1, 'Active electrical wiring updates emissive material color once')
  disposeHazardMesh(wiringMesh)
}

// ---------------------------------------------------------------------------
// 5. MazeSceneEngine.stepFrame deduplicates grid lookup, reuses payload & resets cleanly
// ---------------------------------------------------------------------------
{
  console.log('Test 5: MazeSceneEngine.stepFrame caches grid lookup & reuses frame payload cleanly')
  const engine = createHeadlessEngine()
  const mazeA = generateMaze({ difficulty: 'medium', seed: 101 })
  engine.setMaze(mazeA)

  let gridCalls = 0
  const origGetGrid = engine.getPlayerGridCell.bind(engine)
  engine.getPlayerGridCell = () => {
    gridCalls += 1
    return origGetGrid()
  }

  const seenPayloads = new Set()
  engine.setFrameCallback((payload) => {
    seenPayloads.add(payload)
  })

  for (let f = 0; f < 20; f += 1) {
    engine.stepFrame(0.016, { render: false })
  }
  assert.equal(gridCalls, 20, 'stepFrame calls getPlayerGridCell at most once per frame (20 frames = 20 calls)')
  assert.equal(seenPayloads.size, 1, 'stepFrame reuses _framePayload without allocating per frame')

  // Resetting to a new maze properly initializes the new ceiling lights group
  const mazeB = generateMaze({ difficulty: 'medium', seed: 202 })
  engine.setMaze(mazeB)
  const newLightsGroup = engine._ceilingLightsGroup
  assert.ok(newLightsGroup?.userData?._diffuserColorsInitialized, 'Maze reset initializes new ceiling light color cache')

  engine.dispose()
  assert.equal(engine._framePayload, null, 'dispose clears _framePayload reference')
}

disposeAllSharedPools()
console.log('✓ All Phase 6 instance-color & per-frame optimization tests passed')
