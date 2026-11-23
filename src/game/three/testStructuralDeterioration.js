import assert from 'node:assert/strict'
import * as THREE from 'three'
import { placeEnvironmentalProps } from '../generation/environmentalPropPlacement.js'
import { placeHazards } from '../generation/hazardPlacement.js'
import { placeHidingSpots } from '../generation/hidingSpotPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE, WALL_HEIGHT, gridToWorld, worldToGrid } from '../world/worldCoords.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeEnvironmentalPropPools, getEnvironmentalPropTextureSet } from './buildEnvironmentalProps.js'
import { MAZE_MESH_PALETTE, buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import {
  DETERIORATION_PROFILES,
  buildStructuralDeterioration,
  disposeStructuralDeteriorationPools,
  getStructuralDeteriorationMaterials,
  getStructuralDeteriorationPoolStats,
} from './buildStructuralDeterioration.js'
import { disposeMazeSurfacePools, getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'
import { getLayerMeshes } from './spatialChunking.js'

console.log('--- RUNNING PHASE 3 STRUCTURAL DETERIORATION TESTS ---')

function createMockRenderer() {
  const renderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: null, needsUpdate: false },
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
// 1. Determinism, All 5 Profiles, Sparse Rebar & Draw-Call Contract
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Deterministic profiles, sparse exposed rebar & instanced draw-call contract')

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const mazeA = generateMaze({ difficulty, seed: 4242 })
    const mazeB = generateMaze({ difficulty, seed: 4242 })
    const mazeC = generateMaze({ difficulty, seed: 9191 })

    const groupA = buildMazeMeshes(mazeA)
    const groupB = buildMazeMeshes(mazeB)
    const groupC = buildMazeMeshes(mazeC)

    // Preserve instanced wall & cap contract (single InstancedMesh on small, chunked InstancedMeshes on larger mazes)
    const wallMeshes = getLayerMeshes(groupA.getObjectByName('maze-walls'))
    const capMeshes = getLayerMeshes(groupA.getObjectByName('maze-wall-caps'))
    assert.ok(
      wallMeshes.length >= 1 &&
        wallMeshes.every((m) => m.isInstancedMesh) &&
        capMeshes.length >= 1 &&
        capMeshes.every((m) => m.isInstancedMesh),
      `${difficulty} preserves InstancedMesh wall & cap layers`
    )

    const detA = groupA.getObjectByName('maze-structural-deterioration')
    const detB = groupB.getObjectByName('maze-structural-deterioration')
    const detC = groupC.getObjectByName('maze-structural-deterioration')

    assert.ok(detA && detA.isGroup, `Structural deterioration group built on ${difficulty}`)
    assert.ok(detA.children.length >= 3 && detA.children.length <= 4, `Merged into 3-4 static meshes on ${difficulty}`)
    assert.equal(detA.userData.totalSites, detB.userData.totalSites, 'Same seed produces identical deterioration site count')
    assert.deepEqual(detA.userData.profileCounts, detB.userData.profileCounts, 'Same seed produces identical profile counts')

    // Bit-identical positions for deterministic builds
    const spallA = getLayerMeshes(detA.getObjectByName('deterioration-concrete-spall'))
    const spallB = getLayerMeshes(detB.getObjectByName('deterioration-concrete-spall'))
    const spallC = getLayerMeshes(detC.getObjectByName('deterioration-concrete-spall'))
    assert.ok(spallA.length > 0 && spallB.length === spallA.length && spallC.length > 0)
    for (let ci = 0; ci < spallA.length; ci += 1) {
      assert.deepEqual(
        Array.from(spallA[ci].geometry.attributes.position.array),
        Array.from(spallB[ci].geometry.attributes.position.array),
        `Same seed produces identical vertex geometry on ${difficulty} chunk #${ci}`
      )
    }
    assert.notDeepEqual(
      Array.from(spallA[0].geometry.attributes.position.array).slice(0, 30),
      Array.from(spallC[0].geometry.attributes.position.array).slice(0, 30),
      `Different seeds produce distinct deterioration layouts on ${difficulty}`
    )

    // Verify all 5 profiles present and exposed rebar stays sparse
    for (const profile of Object.values(DETERIORATION_PROFILES)) {
      assert.ok(
        detA.userData.profileCounts[profile] >= 1,
        `${difficulty} includes deterioration profile ${profile}`
      )
    }
    const rebarCount = detA.userData.profileCounts[DETERIORATION_PROFILES.EXPOSED_REBAR_BREAK]
    if (detA.userData.totalSites >= 10) {
      assert.ok(
        rebarCount / detA.userData.totalSites <= 0.2,
        `Exposed rebar stays sparse on ${difficulty} (${rebarCount}/${detA.userData.totalSites})`
      )
    }

    // Verify intended shadow configuration: 3D spall casts shadows on non-performance presets,
    // while recessed micro-rebar, cavity pockets, and crack decals skip shadow casting
    const cavityA = getLayerMeshes(detA.getObjectByName('deterioration-cavity-core'))
    const crackA = getLayerMeshes(detA.getObjectByName('deterioration-crack-fissures'))
    const rebarA = getLayerMeshes(detA.getObjectByName('deterioration-exposed-rebar'))
    for (const sm of spallA) {
      assert.equal(sm.castShadow, true, `${difficulty} ${sm.name} retains castShadow on high preset`)
      assert.equal(sm.receiveShadow, true, `${difficulty} ${sm.name} receives shadows`)
    }
    for (const nonCaster of [...cavityA, ...crackA, ...rebarA]) {
      assert.equal(nonCaster.castShadow, false, `${difficulty} ${nonCaster.name} keeps castShadow = false`)
      assert.equal(nonCaster.receiveShadow, true, `${difficulty} ${nonCaster.name} keeps receiveShadow = true`)
    }

    const perfDet = buildStructuralDeterioration(mazeA, { qualityPreset: 'performance' })
    assert.ok(perfDet, `${difficulty} deterioration built under performance preset`)
    perfDet.traverse((mesh) => {
      if (!mesh.isMesh) return
      assert.equal(mesh.castShadow, false, `${difficulty} performance preset disables ${mesh.name} castShadow`)
      assert.equal(mesh.receiveShadow, true, `${difficulty} performance preset keeps ${mesh.name} receiveShadow`)
    })
    perfDet.traverse((n) => n.geometry?.dispose?.())

    disposeMazeGroup(groupA)
    disposeMazeGroup(groupB)
    disposeMazeGroup(groupC)
  }

  disposeAllSharedPools()
  console.log('✓ Deterministic 5-profile deterioration, sparse rebar & draw-call contracts verified')
}

// ---------------------------------------------------------------------------
// 2. Wall Integration, Bounds, Pilaster Clearance, Zero Penetration & Exclusions
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Wall bounds, zero Z-fighting/penetration, pilaster clearance & gameplay exclusions')

  const bodyHeight = WALL_HEIGHT - 0.14
  const cellHalf = CELL_SIZE * 0.5

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 7373 })
    const hazards = placeHazards(maze)
    const hidingSpots = placeHidingSpots(maze)
    const props = placeEnvironmentalProps(maze, { hazards, hidingSpots })
    const group = buildMazeMeshes(maze, { hazards, hidingSpots })
    const det = group.getObjectByName('maze-structural-deterioration')

    assert.ok(det, `Structural deterioration built for ${difficulty}`)

    // Build cell lookup sets for start/exit/hidingSpots/props/hazards
    const protectedWallAdjacents = new Set()
    const markPathAdjacents = (r, c) => {
      protectedWallAdjacents.add(`${r},${c}`)
    }
    if (maze.start) markPathAdjacents(maze.start.row, maze.start.col)
    if (maze.exit) markPathAdjacents(maze.exit.row, maze.exit.col)
    for (const hs of hidingSpots) markPathAdjacents(hs.row, hs.col)

    const propFaces = new Set()
    for (const p of props) {
      propFaces.add(`${p.row},${p.col},${p.wallSide}`)
    }

    const floorExcludedCells = new Set()
    if (maze.start) floorExcludedCells.add(`${maze.start.row},${maze.start.col}`)
    if (maze.exit) floorExcludedCells.add(`${maze.exit.row},${maze.exit.col}`)
    for (const h of hazards) floorExcludedCells.add(`${h.row},${h.col}`)
    for (const item of maze.collectibles?.items || []) floorExcludedCells.add(`${item.row},${item.col}`)
    for (const k of maze.keycards || []) floorExcludedCells.add(`${k.row},${k.col}`)

    det.traverse((node) => {
      if (!node.isMesh) return
      const pos = node.geometry.attributes.position
      const norm = node.geometry.attributes.normal
      assert.ok(pos && norm && pos.count > 0, `${node.name} has non-empty attributes`)

      for (let i = 0; i < pos.count; i += 1) {
        const vx = pos.getX(i)
        const vy = pos.getY(i)
        const vz = pos.getZ(i)
        const nx = norm.getX(i)
        const ny = norm.getY(i)
        const nz = norm.getZ(i)

        assert.ok(
          Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz),
          `${node.name} vertex #${i} finite`
        )
        const nLen = Math.hypot(nx, ny, nz)
        assert.ok(Math.abs(nLen - 1) < 0.02, `${node.name} normal #${i} unit length`)

        // Vertical bounds: strictly grounded >= 0 and clear below wall cap overhang
        assert.ok(vy >= -1e-5, `${node.name} vertex #${i} never drops below floor (${vy.toFixed(4)}m)`)
        assert.ok(vy <= bodyHeight - 0.05, `${node.name} vertex #${i} stays clear below wall cap (${vy.toFixed(4)}m)`)

        const cell = worldToGrid(vx, vz, maze)
        assert.ok(cell, `${node.name} vertex #${i} inside maze grid`)
        const cellType = maze.grid[cell.row][cell.col]
        const center = gridToWorld(cell.row, cell.col, maze)
        const dx = Math.abs(vx - center.x)
        const dz = Math.abs(vz - center.z)

        if (cellType === CELL_TYPES.WALL) {
          // Anchored strictly at exposed outer skin (within 0.015m of wall face), NEVER penetrating into wall interior
          assert.ok(
            Math.max(dx, dz) >= cellHalf - 0.015,
            `${node.name} vertex anchored near wall skin, no penetration (maxDist=${Math.max(dx, dz).toFixed(4)})`
          )
        } else {
          // In walkable PATH cell: strictly tucked near wall face (no mid-corridor floating or obstruction)
          const distFromBoundary = Math.min(cellHalf - dx, cellHalf - dz)
          const maxAllowed = vy <= 0.06 ? 0.145 : 0.052
          assert.ok(
            distFromBoundary <= maxAllowed,
            `${node.name} vertex (${vx.toFixed(2)}, ${vy.toFixed(2)}, ${vz.toFixed(2)}) hugs wall cleanly (dist=${distFromBoundary.toFixed(4)}m <= ${maxAllowed}m)`
          )

          // Never placed on floor of gameplay cells when floor rubble chip
          if (vy <= 0.05 && (node.userData?.layerName || node.name) === 'deterioration-concrete-spall') {
            assert.equal(
              floorExcludedCells.has(`${cell.row},${cell.col}`),
              false,
              `Floor spall chip avoids start/exit/hazard/collectible/keycard cell (${cell.row},${cell.col})`
            )
          }

          // Never on start/exit/hiding spot corridor boundary
          assert.equal(
            protectedWallAdjacents.has(`${cell.row},${cell.col}`),
            false,
            `Structural deterioration avoids start/exit/hiding spot cell (${cell.row},${cell.col})`
          )

          // Identify which wall side of PATH cell this vertex clings to and verify no prop occupies it
          const dNorth = cellHalf - (center.z - vz)
          const dSouth = cellHalf - (vz - center.z)
          const dWest = cellHalf - (center.x - vx)
          const dEast = cellHalf - (vx - center.x)
          const minSideDist = Math.min(dNorth, dSouth, dWest, dEast)
          let sideName = 'north'
          if (minSideDist === dSouth) sideName = 'south'
          else if (minSideDist === dWest) sideName = 'west'
          else if (minSideDist === dEast) sideName = 'east'

          assert.equal(
            propFaces.has(`${cell.row},${cell.col},${sideName}`),
            false,
            `Structural deterioration on (${cell.row},${cell.col},${sideName}) never overlaps environmental prop`
          )
        }
      }
    })

    // Check quality preset scaling reduces density cleanly on performance mode
    const perfGroup = buildStructuralDeterioration(maze, { qualityPreset: 'performance' })
    assert.ok(perfGroup)
    assert.ok(
      perfGroup.userData.totalSites <= det.userData.totalSites,
      `Performance preset keeps site count <= high preset (${perfGroup.userData.totalSites} <= ${det.userData.totalSites})`
    )
    perfGroup.traverse((n) => n.geometry?.dispose?.())

    disposeMazeGroup(group)
  }

  disposeAllSharedPools()
  console.log('✓ Wall bounds, zero penetration, pilaster & prop/navigation exclusions verified')
}

// ---------------------------------------------------------------------------
// 3. Material Calibration, Resource Lifecycle & Decal Blending Subtlety
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Material PBR calibration, shared resource lifecycle & decal blending')

  const matsA = getStructuralDeteriorationMaterials()
  const matsB = getStructuralDeteriorationMaterials()
  assert.equal(getStructuralDeteriorationPoolStats().materials, 4, 'Exactly 4 deterioration materials pooled')

  const disposeEvents = []
  for (const [key, mat] of Object.entries(matsA)) {
    assert.equal(mat, matsB[key], `Material ${key} is pooled and reused`)
    assert.equal(isSharedResource(mat), true, `Material ${key} marked shared`)
    assert.ok(mat.roughness >= 0.92 && mat.roughness <= 0.99, `${key} stays matte concrete/oxide`)
    assert.ok(mat.envMapIntensity <= 0.4, `${key} keeps subdued IBL intensity`)
    mat.addEventListener('dispose', () => disposeEvents.push(key))
  }
  assert.ok(matsA.exposedRebar.metalness <= 0.2, 'Exposed rebar oxidized matte steel')
  assert.equal(matsA.spallConcrete.polygonOffset, true, 'spallConcrete uses polygonOffset against wall plane')
  assert.equal(matsA.cavityInterior.polygonOffset, true, 'cavityInterior uses polygonOffset')
  assert.equal(matsA.fracturedCrack.polygonOffset, true, 'fracturedCrack uses polygonOffset')

  // Shares textures from existing pools rather than duplicating
  const surfaceSet = getMazeSurfaceTextureSet()
  const propTexSet = getEnvironmentalPropTextureSet()
  assert.equal(matsA.spallConcrete.map, surfaceSet.wall.map)
  assert.equal(matsA.cavityInterior.map, surfaceSet.wall.map)
  assert.equal(matsA.exposedRebar.map, propTexSet.rustMetal.map)

  // Verify MazeSceneEngine lifecycle across resets and difficulty switches
  const { engine } = createHeadlessEngine()
  engine.setMaze(generateMaze({ difficulty: 'small', seed: 11 }))
  engine.setMaze(generateMaze({ difficulty: 'medium', seed: 22 }))
  engine.setMaze(generateMaze({ difficulty: 'hardcore', seed: 33 }))
  engine.clearMaze()
  engine.setMaze(generateMaze({ difficulty: 'large', seed: 44 }))

  assert.equal(disposeEvents.length, 0, 'Shared deterioration materials never dispose across maze switches')

  const detGroup = engine.getMazeGroup()?.getObjectByName('maze-structural-deterioration')
  assert.ok(detGroup, 'Active engine maze includes structural deterioration')
  const spallGeo = getLayerMeshes(detGroup.getObjectByName('deterioration-concrete-spall'))[0].geometry
  let geoDisposed = false
  spallGeo.addEventListener('dispose', () => {
    geoDisposed = true
  })

  engine.dispose()
  assert.equal(geoDisposed, true, 'Maze-owned merged deterioration geometry disposes on engine teardown')
  assert.equal(disposeEvents.length, 4, 'Shared deterioration materials dispose on final owner teardown')
  assert.equal(getStructuralDeteriorationPoolStats().materials, 0, 'Pool empties on teardown')

  // Verify independent sub-pool clear rebinds fresh textures cleanly
  const freshMats = getStructuralDeteriorationMaterials()
  const oldWallMap = freshMats.spallConcrete.map
  const oldRustMap = freshMats.exposedRebar.map
  disposeMazeSurfacePools()
  disposeEnvironmentalPropPools()
  const reboundMats = getStructuralDeteriorationMaterials()
  assert.notEqual(reboundMats.spallConcrete.map, oldWallMap, 'spallConcrete rebinds fresh wall map after surface clear')
  assert.notEqual(reboundMats.exposedRebar.map, oldRustMap, 'exposedRebar rebinds fresh rust map after prop pool clear')

  // Verify refined wall & floor detail atlases eliminated bright chalk/sticker outlines
  const surf = getMazeSurfaceTextureSet()
  const wallColorRef = new THREE.Color(MAZE_MESH_PALETTE.wallBody)
  assert.ok(surf.wallDetailMaterial.envMapIntensity <= 0.36, 'Wall decal material envMapIntensity subdued')
  assert.ok(surf.floorDetailMaterial.envMapIntensity <= 0.36, 'Floor decal material envMapIntensity subdued')
  assert.ok(wallColorRef.r < 0.25)

  for (const [label, atlas] of [
    ['wallDetailAtlas', surf.wallDetailAtlas],
    ['floorDetailAtlas', surf.floorDetailAtlas],
  ]) {
    const data = atlas.image.data
    let maxChan = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 25) {
        maxChan = Math.max(maxChan, data[i], data[i + 1], data[i + 2])
      }
    }
    assert.ok(
      maxChan <= 145,
      `${label} tames bright sticker-like outline luminance (max visible channel=${maxChan})`
    )
  }

  disposeStructuralDeteriorationPools()
  disposeAllSharedPools()
  console.log('✓ Material calibration, pool lifecycle, rebinding & decal blending verified')
}

// ---------------------------------------------------------------------------
// 4. Phase 5: Indexed Quad Savings, Shared Placement Reuse & Multi-Cycle Teardown
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Phase 5 indexed quad reduction, shared placement consistency & multi-cycle lifecycle')

  disposeAllSharedPools()

  const maze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const standalone = buildStructuralDeterioration(maze)
  const fullMaze = buildMazeMeshes(maze)
  const integrated = fullMaze.getObjectByName('maze-structural-deterioration')

  assert.ok(standalone && integrated)
  assert.equal(integrated.userData.totalSites, standalone.userData.totalSites)
  assert.deepEqual(integrated.userData.profileCounts, standalone.userData.profileCounts)

  // Verify shared-placement path in buildMazeMeshes produces bit-identical geometry
  for (const meshName of [
    'deterioration-concrete-spall',
    'deterioration-cavity-core',
    'deterioration-crack-fissures',
    'deterioration-exposed-rebar',
  ]) {
    const aMeshes = getLayerMeshes(standalone.getObjectByName(meshName))
    const bMeshes = getLayerMeshes(integrated.getObjectByName(meshName))
    assert.ok(aMeshes.length > 0 && aMeshes.length === bMeshes.length, `${meshName} built in both paths`)
    for (let ci = 0; ci < aMeshes.length; ci += 1) {
      assert.deepEqual(
        Array.from(aMeshes[ci].geometry.attributes.position.array),
        Array.from(bMeshes[ci].geometry.attributes.position.array),
        `${meshName} chunk #${ci} positions identical when sharing precomputed placement`
      )
      assert.deepEqual(
        Array.from(aMeshes[ci].geometry.index.array),
        Array.from(bMeshes[ci].geometry.index.array),
        `${meshName} chunk #${ci} index buffers identical when sharing precomputed placement`
      )
    }
  }

  // Verify indexed quad sharing meaningfully reduces vertex count relative to unindexed triangles (3 verts/tri)
  const spallMeshes = getLayerMeshes(integrated.getObjectByName('deterioration-concrete-spall'))
  const crackMeshes = getLayerMeshes(integrated.getObjectByName('deterioration-crack-fissures'))
  const spallVerts = spallMeshes.reduce((s, m) => s + m.geometry.attributes.position.count, 0)
  const spallIdx = spallMeshes.reduce((s, m) => s + m.geometry.index.count, 0)
  const crackVerts = crackMeshes.reduce((s, m) => s + m.geometry.attributes.position.count, 0)
  const crackIdx = crackMeshes.reduce((s, m) => s + m.geometry.index.count, 0)
  assert.ok(
    spallVerts < spallIdx * 0.72,
    `Spall geometry shares quad vertices cleanly (${spallVerts} verts for ${spallIdx / 3} tris vs ${spallIdx} unindexed)`
  )
  assert.ok(
    crackVerts < crackIdx * 0.7,
    `Crack geometry shares quad vertices cleanly (${crackVerts} verts for ${crackIdx / 3} tris vs ${crackIdx} unindexed)`
  )

  standalone.traverse((n) => n.geometry?.dispose?.())
  disposeMazeGroup(fullMaze)

  // Multi-cycle engine teardown + pool clear + rebuild check
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const { engine } = createHeadlessEngine()
    engine.setMaze(generateMaze({ difficulty: 'small', seed: 500 + cycle }))
    engine.setMaze(generateMaze({ difficulty: 'hardcore', seed: 4242 }))
    const det = engine.getMazeGroup()?.getObjectByName('maze-structural-deterioration')
    assert.ok(det && det.children.length === 4)
    assert.equal(getStructuralDeteriorationPoolStats().materials, 4)

    engine.dispose()
    assert.equal(getStructuralDeteriorationPoolStats().materials, 0, `Cycle ${cycle}: deterioration materials cleaned`)
  }

  disposeAllSharedPools()
  console.log('✓ Phase 5 indexed quad savings, shared placement reuse & multi-cycle lifecycle verified')
}

console.log('=== ALL PHASE 3 STRUCTURAL DETERIORATION TESTS PASSED! ===')
