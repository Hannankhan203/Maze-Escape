import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { WALL_HEIGHT, gridToWorld, worldToGrid } from '../world/worldCoords.js'
import {
  CEILING_VENT_CLEARANCE_MIN_Y,
  CEILING_VENT_PALETTE,
  getCeilingVentPoolStats,
  getGalvanizedMetalTextureSet,
} from './buildCeilingVents.js'
import { MAZE_CEILING_CONFIG } from './buildMazeCeiling.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { CAMERA_MODES, MAX_THIRD_PERSON_HEIGHT } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { getMazeSurfacePoolStats, getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'
import { getBackdropPoolStats } from './undergroundBackdrop.js'

console.log('--- RUNNING FACILITY CEILING VENTILATION DUCT & GRILLE TESTS ---')

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
// 1. Procedural Galvanized Steel Textures & Material Realism
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Procedural galvanized steel spangle/roughness/bump maps & pooling')

  const t0 = performance.now()
  const metalTex = getGalvanizedMetalTextureSet()
  const genMs = performance.now() - t0
  assert.ok(genMs < 250, `Galvanized steel texture generation fast (${genMs.toFixed(1)}ms)`)

  assert.equal(metalTex.size, 256)
  assert.equal(metalTex.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(metalTex.roughnessMap.colorSpace, THREE.NoColorSpace)
  assert.equal(metalTex.bumpMap.colorSpace, THREE.NoColorSpace)
  assert.equal(isSharedResource(metalTex.map), true)
  assert.equal(isSharedResource(metalTex.roughnessMap), true)
  assert.equal(isSharedResource(metalTex.bumpMap), true)
  assert.equal(getCeilingVentPoolStats().entries, 1)

  // Validate roughness stays weathered industrial galvanized steel (0.54..0.93, never chrome)
  const rData = metalTex.roughnessMap.image.data
  const count = 256 * 256
  let rMin = 1
  let rMax = 0
  let rSum = 0
  for (let i = 0; i < count; i += 1) {
    const val = rData[i * 4] / 255
    if (val < rMin) rMin = val
    if (val > rMax) rMax = val
    rSum += val
  }
  const rAvg = rSum / count
  assert.ok(
    rMin >= 0.52 && rMax <= 0.95 && rAvg >= 0.6 && rAvg <= 0.85,
    `Aged galvanized roughness stays matte-satin (min=${rMin.toFixed(2)}, avg=${rAvg.toFixed(2)}, max=${rMax.toFixed(2)})`
  )

  // Validate albedo spangle/dust/rust variation
  const aData = metalTex.map.image.data
  let aMin = 255
  let aMax = 0
  for (let i = 0; i < count; i += 1) {
    const l = aData[i * 4]
    if (l < aMin) aMin = l
    if (l > aMax) aMax = l
  }
  assert.ok(aMax - aMin >= 45, `Galvanized map carries spangle, seam & dust contrast (range=${aMax - aMin})`)

  disposeAllSharedPools()
  assert.equal(getCeilingVentPoolStats().entries, 0, 'Vent texture pool disposes cleanly')
  console.log('✓ Procedural aged galvanized steel materials verified')
}

// ---------------------------------------------------------------------------
// 2. Duct Routing, Beam Clearance, Grille Variety & Connectivity Across All 4 Difficulties
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Duct alignment, non-intersection with beams/ribs, headroom & grille variety')

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

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 7177 })
    const t0 = performance.now()
    const group = buildMazeMeshes(maze)
    const buildMs = performance.now() - t0
    assert.ok(buildMs < 500, `buildMazeMeshes(${difficulty}) stays < 500ms (${buildMs.toFixed(1)}ms)`)

    // Contract check: 2 root instanced meshes untouched, ceiling height untouched
    assert.equal(group.children.filter((c) => c.isInstancedMesh).length, 2)
    assert.equal(group.userData.ceilingGroup.userData.soffitY, MAZE_CEILING_CONFIG.soffitY)

    const ventsGroup = group.getObjectByName('maze-ceiling-vents-group')
    const ductMesh = group.getObjectByName('maze-ceiling-ducts')
    const hardwareMesh = group.getObjectByName('maze-ceiling-duct-hardware')
    const cavityMesh = group.getObjectByName('maze-ceiling-vent-cavities')
    assert.ok(ventsGroup && ductMesh && hardwareMesh && cavityMesh, `All 3 vent/duct meshes exist on ${difficulty}`)

    // Galvanized ducts & brackets cast local overhead shadows; interior cavities do not
    assert.equal(ductMesh.castShadow, true, `${ductMesh.name} has castShadow = true`)
    assert.equal(hardwareMesh.castShadow, true, `${hardwareMesh.name} has castShadow = true`)
    assert.equal(cavityMesh.castShadow, false, `${cavityMesh.name} has castShadow = false`)
    assert.equal(ductMesh.receiveShadow, true, 'Ducts receive flashlight & fixture shadows')
    assert.equal(hardwareMesh.receiveShadow, true, 'Duct hardware & grilles receive shadows')

    // Material realism checks
    assert.ok(ductMesh.material.metalness >= 0.45 && ductMesh.material.metalness <= 0.65)
    assert.ok(ductMesh.material.roughness >= 0.8)
    assert.equal(ductMesh.material.color.getHex(), CEILING_VENT_PALETTE.ductSteel)

    // Build concrete beam/rib coordinate tables for geometric non-intersection checks
    const evenRowZs = []
    for (let r = 2; r <= maze.rows - 3; r += 2) {
      evenRowZs.push(gridToWorld(r, 0, maze).z)
    }
    const evenColXs = []
    for (let c = 2; c <= maze.cols - 3; c += 2) {
      evenColXs.push(gridToWorld(0, c, maze).x)
    }
    const oddRowZs = []
    for (let r = 1; r <= maze.rows - 2; r += 2) {
      oddRowZs.push(gridToWorld(r, 0, maze).z)
    }

    const beamHalf = MAZE_CEILING_CONFIG.beamWidth * 0.5 // 0.39m
    const ribHalf = MAZE_CEILING_CONFIG.ribWidth * 0.5 // 0.21m

    // Check strict headroom (>= 3.06m) and zero penetration into concrete beams/ribs across EVERY vertex
    for (const mesh of [ductMesh, hardwareMesh, cavityMesh]) {
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      assert.ok(
        box.min.y >= CEILING_VENT_CLEARANCE_MIN_Y - 1e-3 && box.min.y > MIN_REQUIRED_CLEARANCE,
        `${mesh.name} on ${difficulty} clears all actors/outlines/beams (minY=${box.min.y.toFixed(3)}m > ${MIN_REQUIRED_CLEARANCE.toFixed(3)}m)`
      )
      assert.ok(
        box.max.y <= MAZE_CEILING_CONFIG.soffitY + 0.015,
        `${mesh.name} on ${difficulty} stays below/flush with concrete roof slab (${box.max.y.toFixed(3)}m)`
      )

      const pos = mesh.geometry.attributes.position
      for (let i = 0; i < pos.count; i += 1) {
        const vx = pos.getX(i)
        const vy = pos.getY(i)
        const vz = pos.getZ(i)

        // Must never penetrate strictly inside any primary evenRowZ girder
        if (vy > MAZE_CEILING_CONFIG.beamBottomY + 0.015) {
          for (const rz of evenRowZs) {
            assert.ok(
              Math.abs(vz - rz) >= beamHalf - 0.015,
              `${mesh.name} on ${difficulty} avoids intersecting evenRowZ girder (${vz.toFixed(3)} vs ${rz.toFixed(3)})`
            )
          }
          for (const cx of evenColXs) {
            assert.ok(
              Math.abs(vx - cx) >= beamHalf - 0.015,
              `${mesh.name} on ${difficulty} avoids intersecting evenColX girder (${vx.toFixed(3)} vs ${cx.toFixed(3)})`
            )
          }
        }

        // Must never penetrate strictly inside any secondary oddRowZ coffer rib (y = 3.38..3.60)
        if (vy > MAZE_CEILING_CONFIG.ribBottomY + 0.015) {
          for (const orz of oddRowZs) {
            assert.ok(
              Math.abs(vz - orz) >= ribHalf - 0.01,
              `${mesh.name} on ${difficulty} clears oddRowZ concrete rib at y=${vy.toFixed(2)} (${vz.toFixed(3)} vs ${orz.toFixed(3)})`
            )
          }
        }
      }
    }

    // Check trunks, vents, grille designs, condition variety & duct connections
    const ud = ventsGroup.userData
    assert.ok(ud.xTrunkCount >= 2, `${difficulty} includes multiple horizontal main duct trunks (${ud.xTrunkCount})`)
    assert.ok(ud.zTrunkCount >= 1, `${difficulty} includes cross collector duct trunks (${ud.zTrunkCount})`)
    assert.ok(ud.ventCount >= 2, `${difficulty} places connected ceiling vents (${ud.ventCount})`)

    const designsSeen = new Set()
    const conditionsSeen = new Set()
    for (const vm of ud.ventMetadata) {
      assert.equal(vm.connectedToDuct, true, 'Every ceiling vent is wired directly to duct network')
      assert.equal(maze.grid[vm.cellRow][vm.cellCol], CELL_TYPES.PATH, 'Ceiling vents sit overhead walkable PATH corridors')
      const ventCell = worldToGrid(vm.cx, vm.cz, maze)
      assert.ok(ventCell && maze.grid[ventCell.row][ventCell.col] === CELL_TYPES.PATH, 'Vent world (cx, cz) sits over PATH corridor')
      assert.ok(vm.frameBottomY >= CEILING_VENT_CLEARANCE_MIN_Y, 'Vent frame meets minimum clearance')
      assert.ok(vm.plenumTopY > vm.frameBottomY + 0.04, 'Vent has real vertical plenum depth')
      assert.ok(vm.renderedBlades >= 1, 'Vent includes louver blades')
      designsSeen.add(vm.designType)
      conditionsSeen.add(vm.condition)
    }

    if (difficulty !== 'small') {
      assert.ok(designsSeen.size >= 3, `${difficulty} features varied grille designs (${[...designsSeen].join(', ')})`)
      assert.ok(conditionsSeen.size >= 2, `${difficulty} includes varied vent conditions (${[...conditionsSeen].join(', ')})`)
    }

    disposeMazeGroup(group)
  }

  disposeAllSharedPools()
  console.log('✓ All 4 difficulties clear beams/ribs, keep headroom & provide connected varied vents')
}

// ---------------------------------------------------------------------------
// 3. Engine Lifecycle, Camera Modes, Quality Presets, High Contrast & Zero-Leak Disposal
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Engine integration across cameras, graphics presets, High Contrast & clean disposal')

  const maze = generateMaze({ difficulty: 'large', seed: 4242 })
  const { engine } = createHeadlessEngine({ cameraMode: CAMERA_MODES.FIRST_PERSON })
  engine.setMaze(maze)

  const mazeGroup = engine.getMazeGroup()
  const ductMesh = mazeGroup.getObjectByName('maze-ceiling-ducts')
  const hardwareMesh = mazeGroup.getObjectByName('maze-ceiling-duct-hardware')
  assert.ok(ductMesh && hardwareMesh, 'Engine scene contains ceiling duct & grille hardware meshes')

  // Step frames in both camera modes
  engine.stepFrame(0.016, { render: false })
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.stepFrame(0.016, { render: false })

  // High contrast mode preserves duct steel colors & maze visibility
  engine.setHighContrast(true)
  assert.equal(ductMesh.material.color.getHex(), CEILING_VENT_PALETTE.ductSteel)
  assert.equal(mazeGroup.getObjectByName('maze-walls-outline')?.visible, true)
  engine.setHighContrast(false)

  // Quality presets keep ceiling ventilation intact
  for (const preset of ['performance', 'balanced', 'high']) {
    engine.updateGraphicsConfig({ qualityPreset: preset })
    assert.ok(engine.getMazeGroup().getObjectByName('maze-ceiling-ducts'), `Ducts active on ${preset} preset`)
    assert.ok(engine.getMazeGroup().getObjectByName('maze-ceiling-duct-hardware'), `Grilles active on ${preset} preset`)
  }

  engine.dispose()
  assert.equal(getCeilingVentPoolStats().entries, 0, 'Ceiling vent pool disposed cleanly (0 entries)')
  assert.equal(getMazeSurfacePoolStats().entries, 0, 'Maze surface pool disposed cleanly (0 entries)')
  assert.equal(getBackdropPoolStats().entries, 0, 'Backdrop pool disposed cleanly (0 entries)')
  console.log('✓ Engine lifecycle, camera modes, presets, High Contrast & clean disposal verified')
}

console.log('=== ALL CEILING VENTILATION DUCT & GRILLE TESTS PASSED! ===')
