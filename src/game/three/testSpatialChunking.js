import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { MAZE_CEILING_CONFIG } from './buildMazeCeiling.js'
import { getCeilingLightPoolStats } from './buildCeilingLights.js'
import { getCeilingVentPoolStats } from './buildCeilingVents.js'
import {
  NON_SHADOW_CASTING_PROP_PARTS,
  getEnvironmentalPropPoolStats,
} from './buildEnvironmentalProps.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { getStructuralDeteriorationPoolStats } from './buildStructuralDeterioration.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { getMazeSurfacePoolStats } from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'
import {
  DEFAULT_SPATIAL_CHUNKING_CONFIG,
  createMazeChunkLayout,
  getGeometryTriangleCount,
  getLayerMeshes,
  shouldChunkLayer,
  splitAxisAlignedBoxToChunks,
} from './spatialChunking.js'
import { getBackdropPoolStats } from './undergroundBackdrop.js'

console.log('--- RUNNING PHASE 4 SPATIAL CHUNKING & FRUSTUM CULLING TESTS ---')

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
// 1. Small Maze Non-Chunking & Scaled Chunk Grid Verification
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Small maze avoids chunk overhead; larger mazes chunk heavy layers cleanly')

  const smallMaze = generateMaze({ difficulty: 'small', seed: 4242 })
  const smallLayout = createMazeChunkLayout(smallMaze)
  assert.equal(smallLayout.isChunked, false, '11x11 small maze stays unchunked (1x1)')
  assert.equal(smallLayout.totalChunks, 1)

  const smallGroup = buildMazeMeshes(smallMaze)
  const chunkGroupsOnSmall = []
  smallGroup.traverse((n) => {
    if (n.userData?.isSpatialChunkGroup) chunkGroupsOnSmall.push(n.name)
  })
  assert.equal(
    chunkGroupsOnSmall.length,
    0,
    `Small maze creates zero spatial chunk groups (found: ${chunkGroupsOnSmall.join(', ')})`
  )

  const expectedSingleMeshLayers = [
    'maze-floor',
    'maze-walls',
    'maze-wall-caps',
    'maze-walls-imperfections',
    'maze-floor-imperfections',
    'maze-ceiling-imperfections',
    'maze-ceiling-deck',
    'maze-ceiling-beams',
    'maze-ceiling-pillars',
    'maze-ceiling-ducts',
    'maze-ceiling-duct-hardware',
    'maze-ceiling-vent-cavities',
    'maze-ceiling-light-housings',
    'maze-ceiling-light-diffusers',
    'maze-ceiling-light-halos',
    'maze-ceiling-conduits',
    'maze-ceiling-electrical-hardware',
    'maze-ceiling-cables',
    'deterioration-concrete-spall',
    'deterioration-cavity-core',
    'deterioration-crack-fissures',
    'deterioration-exposed-rebar',
  ]
  for (const layerName of expectedSingleMeshLayers) {
    const node = smallGroup.getObjectByName(layerName)
    assert.ok(node?.isMesh, `Small maze ${layerName} remains a single Mesh`)
    assert.equal(node.frustumCulled, true, `Small maze ${layerName} keeps frustumCulled=true`)
  }
  const smallGraffiti = smallGroup.getObjectByName('maze-walls-graffiti')
  if (smallGraffiti) {
    assert.ok(smallGraffiti.isMesh, 'Small maze graffiti remains a single Mesh')
  }
  const smallProps = smallGroup.getObjectByName('maze-environmental-props')
  if (smallProps) {
    for (const child of smallProps.children) {
      assert.equal(child.userData?.isSpatialChunk, false, `Small maze prop ${child.name} stays unchunked`)
    }
  }
  disposeMazeGroup(smallGroup)

  const expectedGridByDiff = [
    ['medium', 2, 2],
    ['large', 3, 3],
    ['hardcore', 4, 4],
  ]

  for (const [difficulty, expCols, expRows] of expectedGridByDiff) {
    const maze = generateMaze({ difficulty, seed: 4242 })
    const layout = createMazeChunkLayout(maze)
    assert.equal(layout.isChunked, true)
    assert.equal(layout.chunkCols, expCols, `${difficulty} uses ${expCols} chunk columns`)
    assert.equal(layout.chunkRows, expRows, `${difficulty} uses ${expRows} chunk rows`)

    const group = buildMazeMeshes(maze)
    group.updateMatrixWorld(true)

    const chunkedMeshLayers = [
      'maze-floor',
      'maze-walls-imperfections',
      'maze-walls-graffiti',
      'maze-floor-imperfections',
      'maze-ceiling-imperfections',
      'maze-ceiling-deck',
      'maze-ceiling-beams',
      'maze-ceiling-pillars',
      'maze-ceiling-ducts',
      'maze-ceiling-duct-hardware',
      'maze-ceiling-light-housings',
      'maze-ceiling-conduits',
      'maze-ceiling-electrical-hardware',
      'maze-ceiling-cables',
      'deterioration-concrete-spall',
      'deterioration-cavity-core',
      'deterioration-crack-fissures',
      'deterioration-exposed-rebar',
    ]
    for (const layerName of chunkedMeshLayers) {
      const node = group.getObjectByName(layerName)
      const chunks = getLayerMeshes(node)
      assert.ok(node?.isGroup && node.userData?.isSpatialChunkGroup, `${difficulty} ${layerName} is chunk Group`)
      assert.ok(chunks.length >= 2 && chunks.length <= expCols * expRows, `${difficulty} ${layerName} chunk count in range`)
      const sharedMat = chunks[0].material
      for (const ch of chunks) {
        assert.equal(ch.material, sharedMat, `${difficulty} ${ch.name} shares layer material`)
        assert.equal(ch.frustumCulled, true, `${ch.name} keeps frustumCulled=true`)
        assert.ok(ch.geometry.boundingBox && !ch.geometry.boundingBox.isEmpty(), `${ch.name} has boundingBox`)
        assert.ok(ch.geometry.boundingSphere && ch.geometry.boundingSphere.radius > 0, `${ch.name} has boundingSphere`)
      }
    }

    // Vent cavities avoid draw-call bloat when sparse (< 20 tris per added draw call)
    const ventNode = group.getObjectByName('maze-ceiling-vent-cavities')
    if (ventNode?.isMesh) {
      const tris = getGeometryTriangleCount(ventNode.geometry)
      assert.ok(tris < DEFAULT_SPATIAL_CHUNKING_CONFIG.minTrianglesToChunk)
    }

    // InstancedMesh behavior preserved inside spatial chunk groups for walls, caps, diffusers & halos
    for (const instLayerName of [
      'maze-walls',
      'maze-wall-caps',
      'maze-ceiling-light-diffusers',
      'maze-ceiling-light-halos',
    ]) {
      const node = group.getObjectByName(instLayerName)
      const chunks = getLayerMeshes(node)
      assert.ok(node?.isGroup && node.userData?.isSpatialChunkGroup, `${difficulty} ${instLayerName} is spatial chunk Group`)
      assert.ok(chunks.length >= 2 && chunks.length <= expCols * expRows, `${difficulty} ${instLayerName} has chunked InstancedMeshes`)
      for (const im of chunks) {
        assert.ok(im.isInstancedMesh, `${im.name} stays InstancedMesh`)
        assert.equal(im.frustumCulled, true, `${im.name} keeps frustumCulled=true`)
        assert.ok(im.boundingBox && !im.boundingBox.isEmpty(), `${im.name} computes world/local boundingBox`)
        assert.ok(im.boundingSphere && im.boundingSphere.radius > 0, `${im.name} computes boundingSphere`)
      }
    }

    // Props use 2x2 quadrant chunking when multi-quadrant without overflowing draw-call count
    const propsGroup = group.getObjectByName('maze-environmental-props')
    if (propsGroup) {
      const splitPropChunks = propsGroup.children.filter((c) => c.userData?.isSpatialChunk)
      assert.ok(splitPropChunks.length > 0, `${difficulty} props split multi-quadrant batches into spatial chunks`)
      for (const ch of propsGroup.children) {
        assert.ok(ch.isInstancedMesh, `${ch.name} remains a direct InstancedMesh child`)
        assert.equal(ch.frustumCulled, true, `${ch.name} keeps frustumCulled=true`)
        assert.ok(ch.boundingSphere && ch.boundingSphere.radius > 0, `${ch.name} retains boundingSphere`)
        if (ch.userData?.isSpatialChunk) {
          assert.ok(ch.userData.chunkBounds && Number.isFinite(ch.userData.chunkBounds.minX), `${ch.name} records chunkBounds`)
        }
      }
    }

    disposeMazeGroup(group)
  }

  // Small-but-spatially-extensive threshold fix: < 90 tris rebar across multiple chunks still chunks cleanly
  const layout17 = createMazeChunkLayout(generateMaze({ difficulty: 'medium', seed: 11 }))
  assert.equal(
    shouldChunkLayer({ layout: layout17, triangleCount: 40, occupiedChunks: 2 }),
    true,
    'shouldChunkLayer chunks low-triangle layers (< 90 tris) whenever multiple chunks are occupied'
  )
  assert.equal(
    shouldChunkLayer({ layout: layout17, triangleCount: 80, occupiedChunks: 1 }),
    false,
    'shouldChunkLayer skips chunking when all geometry sits in a single chunk'
  )

  for (const [difficulty, preset, seed] of [
    ['large', 'performance', 21],
    ['medium', 'balanced', 6],
    ['medium', 'high', 6],
  ]) {
    const rebarTestMaze = generateMaze({ difficulty, seed })
    const g = buildMazeMeshes(rebarTestMaze, { qualityPreset: preset })
    const rebarNode = g.getObjectByName('deterioration-exposed-rebar')
    const rebarChunks = getLayerMeshes(rebarNode)
    const rebarTris = rebarChunks.reduce((s, m) => s + getGeometryTriangleCount(m.geometry), 0)
    assert.ok(rebarTris < 90 && rebarTris >= 24, `${difficulty} seed=${seed} rebar (${preset}) has < 90 tris (${rebarTris})`)
    assert.ok(rebarNode?.isGroup && rebarNode.userData?.isSpatialChunkGroup, `${difficulty} seed=${seed} rebar (${preset}) chunks despite < 90 tris`)
    assert.ok(rebarChunks.length >= 2, `${difficulty} seed=${seed} rebar (${preset}) splits into >= 2 tight chunks`)
    for (const rc of rebarChunks) {
      assert.ok(rc.geometry.boundingSphere.radius < 3.0, `${rc.name} (${preset}) tight boundingSphere (${rc.geometry.boundingSphere.radius.toFixed(2)}m)`)
    }
    disposeMazeGroup(g)
  }

  // Single-chunk micro-layer regression: medium seed=5 (performance) has 1 rebar site -> skips chunk Group overhead
  {
    const singleChunkMaze = generateMaze({ difficulty: 'medium', seed: 5 })
    const g = buildMazeMeshes(singleChunkMaze, { qualityPreset: 'performance' })
    const rebarNode = g.getObjectByName('deterioration-exposed-rebar')
    assert.ok(rebarNode?.isMesh && !rebarNode.userData?.isSpatialChunkGroup, 'medium seed=5 rebar (performance) stays unchunked Mesh when all geometry fits in 1 chunk')
    disposeMazeGroup(g)
  }

  console.log('✓ Small-maze zero overhead, low-tri extensive rebar fix & multi-layer chunking verified')
}

// ---------------------------------------------------------------------------
// 2. Floor & Ceiling Deck Continuity Across Chunk Borders, Splitting & Shadow Parity
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Boundary continuity (floor & ceiling deck UV/AO/area), girder splitting & shadow flags')

  const maze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const layout = createMazeChunkLayout(maze)
  const group = buildMazeMeshes(maze)
  group.updateMatrixWorld(true)

  const floorChunks = getLayerMeshes(group.getObjectByName('maze-floor'))
  assert.equal(floorChunks.length, layout.totalChunks)

  // Verify exact footprint coverage for both floor and ceiling deck chunks
  const byGrid = new Map()
  let totalTopArea = 0
  for (const fc of floorChunks) {
    fc.geometry.computeBoundingBox()
    const worldBox = fc.geometry.boundingBox.clone().translate(fc.position)
    const sx = worldBox.max.x - worldBox.min.x
    const sz = worldBox.max.z - worldBox.min.z
    totalTopArea += sx * sz
    byGrid.set(`${fc.userData.chunkX},${fc.userData.chunkZ}`, fc)
  }
  const expectedArea = maze.cols * CELL_SIZE * (maze.rows * CELL_SIZE)
  assert.ok(
    Math.abs(totalTopArea - expectedArea) < 1e-4,
    `Floor chunk area (${totalTopArea}) matches exact maze footprint (${expectedArea})`
  )

  const deckChunks = getLayerMeshes(group.getObjectByName('maze-ceiling-deck'))
  assert.equal(deckChunks.length, layout.totalChunks)
  let totalDeckArea = 0
  for (const dc of deckChunks) {
    dc.geometry.computeBoundingBox()
    const b = dc.geometry.boundingBox
    totalDeckArea += (b.max.x - b.min.x) * (b.max.z - b.min.z)
  }
  const paddedSpan = MAZE_CEILING_CONFIG.eaveOverhang
  const expectedDeckArea = (maze.cols * CELL_SIZE + paddedSpan * 2) * (maze.rows * CELL_SIZE + paddedSpan * 2)
  assert.ok(
    Math.abs(totalDeckArea - expectedDeckArea) < 1e-3,
    `Ceiling deck chunk area (${totalDeckArea.toFixed(2)}) matches continuous soffit slab (${expectedDeckArea.toFixed(2)})`
  )

  // Verify UVs, normals & vertex AO colors match bit-for-bit on shared boundary vertices (both splitXs & splitZs)
  const readSurfaceEdgeSamples = (chunkMesh, { axis, targetCoord, expectedNormalY, expectedWorldY }) => {
    const pos = chunkMesh.geometry.attributes.position
    const uv = chunkMesh.geometry.attributes.uv
    const col = chunkMesh.geometry.attributes.color
    const norm = chunkMesh.geometry.attributes.normal
    const map = new Map()
    for (let i = 0; i < pos.count; i += 1) {
      const ny = norm.getY(i)
      if (expectedNormalY > 0 ? ny <= 0.5 : ny >= -0.5) continue
      const wx = pos.getX(i) + chunkMesh.position.x
      const wy = pos.getY(i) + chunkMesh.position.y
      const wz = pos.getZ(i) + chunkMesh.position.z
      const coord = axis === 'x' ? wx : wz
      if (Math.abs(coord - targetCoord) < 1e-4 && Math.abs(wy - expectedWorldY) < 1e-4) {
        const key = `${wx.toFixed(3)}|${wy.toFixed(3)}|${wz.toFixed(3)}`
        map.set(key, {
          u: uv.getX(i),
          v: uv.getY(i),
          r: col.getX(i),
          g: col.getY(i),
          b: col.getZ(i),
        })
      }
    }
    return map
  }

  const assertSeamSamplesMatch = (leftSamples, rightSamples, label, minVertices = 2) => {
    assert.ok(leftSamples.size >= minVertices, `${label} has shared seam vertices (found ${leftSamples.size})`)
    assert.equal(leftSamples.size, rightSamples.size, `${label} seam vertex count matches`)
    for (const [k, lv] of leftSamples.entries()) {
      const rv = rightSamples.get(k)
      assert.ok(rv, `${label} matching vertex exists across border at ${k}`)
      assert.ok(Math.abs(lv.u - rv.u) < 1e-5, `${label} continuous U (${lv.u} vs ${rv.u})`)
      assert.ok(Math.abs(lv.v - rv.v) < 1e-5, `${label} continuous V (${lv.v} vs ${rv.v})`)
      assert.ok(Math.abs(lv.r - rv.r) < 1e-5, `${label} continuous AO R (${lv.r} vs ${rv.r})`)
      assert.ok(Math.abs(lv.g - rv.g) < 1e-5, `${label} continuous AO G (${lv.g} vs ${rv.g})`)
      assert.ok(Math.abs(lv.b - rv.b) < 1e-5, `${label} continuous AO B (${lv.b} vs ${rv.b})`)
    }
  }

  const deckByGrid = new Map()
  for (const dc of deckChunks) {
    deckByGrid.set(`${dc.userData.chunkX},${dc.userData.chunkZ}`, dc)
  }

  for (let cz = 0; cz < layout.chunkRows; cz += 1) {
    for (let cx = 0; cx < layout.chunkCols - 1; cx += 1) {
      const seamX = layout.splitXs[cx]
      assertSeamSamplesMatch(
        readSurfaceEdgeSamples(byGrid.get(`${cx},${cz}`), { axis: 'x', targetCoord: seamX, expectedNormalY: 1, expectedWorldY: 0 }),
        readSurfaceEdgeSamples(byGrid.get(`${cx + 1},${cz}`), { axis: 'x', targetCoord: seamX, expectedNormalY: 1, expectedWorldY: 0 }),
        `floor X-seam ${cx}->${cx + 1},${cz}`,
        8
      )
      assertSeamSamplesMatch(
        readSurfaceEdgeSamples(deckByGrid.get(`${cx},${cz}`), { axis: 'x', targetCoord: seamX, expectedNormalY: -1, expectedWorldY: MAZE_CEILING_CONFIG.soffitY }),
        readSurfaceEdgeSamples(deckByGrid.get(`${cx + 1},${cz}`), { axis: 'x', targetCoord: seamX, expectedNormalY: -1, expectedWorldY: MAZE_CEILING_CONFIG.soffitY }),
        `ceiling-deck X-seam ${cx}->${cx + 1},${cz}`,
        2
      )
    }
  }
  for (let cz = 0; cz < layout.chunkRows - 1; cz += 1) {
    const seamZ = layout.splitZs[cz]
    for (let cx = 0; cx < layout.chunkCols; cx += 1) {
      assertSeamSamplesMatch(
        readSurfaceEdgeSamples(byGrid.get(`${cx},${cz}`), { axis: 'z', targetCoord: seamZ, expectedNormalY: 1, expectedWorldY: 0 }),
        readSurfaceEdgeSamples(byGrid.get(`${cx},${cz + 1}`), { axis: 'z', targetCoord: seamZ, expectedNormalY: 1, expectedWorldY: 0 }),
        `floor Z-seam ${cx},${cz}->${cz + 1}`,
        8
      )
      assertSeamSamplesMatch(
        readSurfaceEdgeSamples(deckByGrid.get(`${cx},${cz}`), { axis: 'z', targetCoord: seamZ, expectedNormalY: -1, expectedWorldY: MAZE_CEILING_CONFIG.soffitY }),
        readSurfaceEdgeSamples(deckByGrid.get(`${cx},${cz + 1}`), { axis: 'z', targetCoord: seamZ, expectedNormalY: -1, expectedWorldY: MAZE_CEILING_CONFIG.soffitY }),
        `ceiling-deck Z-seam ${cx},${cz}->${cz + 1}`,
        2
      )
    }
  }

  // Axis-aligned girder splitting test: preserves total span with zero gaps or overlaps
  const sampleGirder = { cx: 0, cy: 3.32, cz: 0, sx: 120, sy: 0.56, sz: 0.78, shade: 0.95 }
  const splitPieces = splitAxisAlignedBoxToChunks(sampleGirder, layout)
  assert.equal(splitPieces.length, layout.chunkCols, 'Long girder splits across all X chunks')
  const summedLength = splitPieces.reduce((s, p) => s + p.item.sx, 0)
  assert.ok(Math.abs(summedLength - sampleGirder.sx) < 1e-5, 'Split girder segments sum to exact original span')

  // Shadow flag preservation across all chunked layers (including newly chunked ones)
  const expectedShadowMap = {
    'maze-floor': [false, true],
    'maze-walls': [true, true],
    'maze-wall-caps': [true, true],
    'maze-walls-imperfections': [false, true],
    'maze-walls-graffiti': [false, true],
    'maze-floor-imperfections': [false, true],
    'maze-ceiling-imperfections': [false, true],
    'maze-ceiling-deck': [false, true],
    'maze-ceiling-beams': [true, true],
    'maze-ceiling-beam-details': [false, true],
    'maze-ceiling-pillars': [true, true],
    'maze-ceiling-pillar-details': [false, true],
    'maze-ceiling-ducts': [true, true],
    'maze-ceiling-duct-hardware': [false, true],
    'maze-ceiling-light-housings': [false, true],
    'maze-ceiling-light-diffusers': [false, false],
    'maze-ceiling-light-halos': [false, false],
    'maze-ceiling-conduits': [false, true],
    'maze-ceiling-electrical-hardware': [false, true],
    'maze-ceiling-cables': [false, true],
    'deterioration-concrete-spall': [true, true],
    'deterioration-cavity-core': [false, true],
    'deterioration-crack-fissures': [false, true],
    'deterioration-exposed-rebar': [false, true],
  }
  for (const [layerName, [expCast, expReceive]] of Object.entries(expectedShadowMap)) {
    const meshes = getLayerMeshes(group.getObjectByName(layerName))
    assert.ok(meshes.length > 0, `${layerName} has meshes`)
    for (const m of meshes) {
      assert.equal(m.castShadow, expCast, `${m.name} preserves castShadow=${expCast}`)
      assert.equal(m.receiveShadow, expReceive, `${m.name} preserves receiveShadow=${expReceive}`)
    }
  }

  const propsGroup = group.getObjectByName('maze-environmental-props')
  for (const ch of propsGroup.children) {
    const expCast = !NON_SHADOW_CASTING_PROP_PARTS.has(ch.userData?.partName)
    assert.equal(ch.castShadow, expCast, `${ch.name} preserves castShadow=${expCast}`)
    assert.equal(ch.receiveShadow, true, `${ch.name} preserves receiveShadow=true`)
  }

  disposeMazeGroup(group)
  console.log('✓ X/Z border UV/AO continuity (floor & ceiling deck), girder splitting & shadow flags verified')
}

// ---------------------------------------------------------------------------
// 3. Tight Bounding Spheres & Real THREE.Frustum Culling (Camera + Spotlight Shadow)
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Tight bounding spheres & THREE.Frustum culling (camera & shadow frustum) on hardcore maze')

  const maze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const group = buildMazeMeshes(maze)
  group.updateMatrixWorld(true)

  const fullDiagonalRadius =
    Math.hypot(maze.cols * CELL_SIZE, maze.rows * CELL_SIZE) * 0.5 // ~87.7m

  const frustumTestLayers = [
    'maze-floor',
    'maze-walls',
    'maze-wall-caps',
    'maze-walls-imperfections',
    'maze-walls-graffiti',
    'maze-floor-imperfections',
    'maze-ceiling-imperfections',
    'maze-ceiling-deck',
    'maze-ceiling-beams',
    'maze-ceiling-pillars',
    'maze-ceiling-ducts',
    'maze-ceiling-duct-hardware',
    'maze-ceiling-light-diffusers',
    'maze-ceiling-light-halos',
    'maze-ceiling-conduits',
    'deterioration-concrete-spall',
    'deterioration-exposed-rebar',
  ]

  // Camera near north-west corner facing inward down the NW quadrant (far=34)
  const cornerCell = gridToWorld(1, 1, maze)
  const midNWCell = gridToWorld(7, 7, maze)
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 34)
  camera.position.set(cornerCell.x, 1.65, cornerCell.z)
  camera.lookAt(midNWCell.x, 1.65, midNWCell.z)
  camera.updateMatrixWorld(true)

  const camFrustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  )

  // Flashlight shadow-camera frustum (fov=60, aspect=1, far=28)
  const shadowCam = new THREE.PerspectiveCamera(60, 1, 0.2, 28)
  shadowCam.position.set(cornerCell.x, 1.65, cornerCell.z)
  shadowCam.lookAt(midNWCell.x, 1.65, midNWCell.z)
  shadowCam.updateMatrixWorld(true)

  const shadowFrustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse)
  )

  for (const layerName of frustumTestLayers) {
    const chunks = getLayerMeshes(group.getObjectByName(layerName))
    const minChunks = layerName === 'deterioration-exposed-rebar' ? 4 : 9
    assert.ok(chunks.length >= minChunks, `${layerName} has >= ${minChunks} spatial chunks on hardcore (got ${chunks.length})`)

    let camVisible = 0
    let shadowVisible = 0
    let maxChunkRadius = 0
    for (const chunk of chunks) {
      const r = (chunk.boundingSphere || chunk.geometry.boundingSphere).radius
      maxChunkRadius = Math.max(maxChunkRadius, r)
      assert.ok(
        r < fullDiagonalRadius * 0.48,
        `${chunk.name} boundingSphere radius (${r.toFixed(1)}m) is tightly bounded vs monolithic (${fullDiagonalRadius.toFixed(1)}m)`
      )
      if (camFrustum.intersectsObject(chunk)) {
        camVisible += 1
      }
      if (shadowFrustum.intersectsObject(chunk)) {
        shadowVisible += 1
      }
    }

    if (
      layerName === 'deterioration-exposed-rebar' ||
      layerName === 'deterioration-concrete-spall' ||
      layerName === 'maze-walls-graffiti'
    ) {
      assert.ok(
        camVisible <= Math.ceil(chunks.length * 0.55),
        `${layerName} NW corner camera culls out-of-range chunks (${camVisible}/${chunks.length} visible, maxR=${maxChunkRadius.toFixed(1)}m)`
      )
      assert.ok(
        shadowVisible <= Math.ceil(chunks.length * 0.5),
        `${layerName} NW corner shadow culls out-of-range chunks (${shadowVisible}/${chunks.length} visible)`
      )
      const sampleCenter = chunks[0].geometry.boundingSphere.center
      const aimedCam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 24)
      aimedCam.position.set(sampleCenter.x - 6, 1.65, sampleCenter.z - 6)
      aimedCam.lookAt(sampleCenter.x, sampleCenter.y, sampleCenter.z)
      aimedCam.updateMatrixWorld(true)
      const aimedFrustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(aimedCam.projectionMatrix, aimedCam.matrixWorldInverse)
      )
      const aimedVisible = chunks.filter((c) => aimedFrustum.intersectsObject(c)).length
      assert.ok(
        aimedVisible >= 1 && aimedVisible < chunks.length,
        `${layerName} aimed frustum includes local chunk while culling distant ones (${aimedVisible}/${chunks.length} visible)`
      )
    } else {
      assert.ok(
        camVisible >= 1 && camVisible <= Math.ceil(chunks.length * 0.55),
        `${layerName} camera frustum rejects offscreen chunks (${camVisible}/${chunks.length} visible, maxR=${maxChunkRadius.toFixed(1)}m)`
      )
      assert.ok(
        shadowVisible >= 1 && shadowVisible <= Math.ceil(chunks.length * 0.5),
        `${layerName} shadow frustum rejects offscreen chunks (${shadowVisible}/${chunks.length} visible)`
      )
    }
  }

  // Props (2x2 quadrant chunks) reject distant quadrants in shadow frustum
  const propsGroup = group.getObjectByName('maze-environmental-props')
  const splitPropChunks = propsGroup.children.filter((c) => c.userData?.isSpatialChunk)
  let visiblePropChunks = 0
  for (const ch of splitPropChunks) {
    if (shadowFrustum.intersectsObject(ch)) visiblePropChunks += 1
  }
  assert.ok(
    visiblePropChunks < splitPropChunks.length * 0.65,
    `Shadow frustum culls out-of-range prop chunks (${visiblePropChunks}/${splitPropChunks.length} visible)`
  )

  disposeMazeGroup(group)
  console.log('✓ Tight chunk bounding spheres & camera/shadow frustum culling selectivity verified')
}

// ---------------------------------------------------------------------------
// 4. MazeSceneEngine Reset & Dispose Hygiene Without Shared Resource Leaks
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Engine reset & teardown disposes chunk geometries safely without freeing shared pools')

  const { engine } = createHeadlessEngine()
  const trackedChunkGeos = []
  let sharedResourceDisposed = 0

  const trackMazeGroupResources = (root) => {
    const seen = new Set()
    root.traverse((node) => {
      if (node.userData?.isSpatialChunk && node.geometry && !seen.has(node.geometry) && !isSharedResource(node.geometry)) {
        seen.add(node.geometry)
        let disposed = false
        node.geometry.addEventListener('dispose', () => {
          disposed = true
        })
        trackedChunkGeos.push({
          name: node.name,
          isDisposed: () => disposed,
        })
      }
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material]
        for (const m of mats) {
          if (isSharedResource(m)) {
            m.addEventListener('dispose', () => {
              sharedResourceDisposed += 1
            })
          }
        }
      }
    })
  }

  engine.setMaze(generateMaze({ difficulty: 'hardcore', seed: 101 }))
  const firstRunCountStart = trackedChunkGeos.length
  trackMazeGroupResources(engine.getMazeGroup())
  const firstRunCountEnd = trackedChunkGeos.length
  assert.ok(firstRunCountEnd > firstRunCountStart + 100, 'Tracked chunk geometries from first hardcore maze')
  assert.ok(
    trackedChunkGeos.slice(firstRunCountStart, firstRunCountEnd).some((g) => g.name.startsWith('deterioration-exposed-rebar')),
    'Tracked rebar chunk geometries for disposal'
  )

  // Verify shared pooled prop geometries remain untouched across reset while mesh wrappers clean up
  const propPoolBeforeReset = getEnvironmentalPropPoolStats()
  assert.ok(propPoolBeforeReset.geometries > 0 && propPoolBeforeReset.materials > 0)

  // Reset to a different maze: every chunk geometry from maze 1 must dispose, shared pools must stay intact
  engine.setMaze(generateMaze({ difficulty: 'medium', seed: 202 }))
  for (let i = firstRunCountStart; i < firstRunCountEnd; i += 1) {
    assert.equal(
      trackedChunkGeos[i].isDisposed(),
      true,
      `Chunk geometry ${trackedChunkGeos[i].name} disposed on maze reset`
    )
  }
  assert.equal(sharedResourceDisposed, 0, 'Shared pooled materials survive maze reset')
  assert.equal(
    getEnvironmentalPropPoolStats().geometries,
    propPoolBeforeReset.geometries,
    'Shared prop geometries survive maze reset'
  )

  const secondStart = trackedChunkGeos.length
  trackMazeGroupResources(engine.getMazeGroup())
  const secondEnd = trackedChunkGeos.length
  assert.ok(secondEnd > secondStart, 'Tracked chunk geometries from second medium maze')

  // Final engine dispose frees active maze chunk geometries and releases shared pools cleanly
  engine.dispose()
  for (let i = secondStart; i < secondEnd; i += 1) {
    assert.equal(
      trackedChunkGeos[i].isDisposed(),
      true,
      `Active chunk geometry ${trackedChunkGeos[i].name} disposed on engine teardown`
    )
  }

  assert.equal(getMazeSurfacePoolStats().entries, 0, 'Maze surface pool emptied on engine teardown')
  assert.equal(getCeilingVentPoolStats().entries, 0, 'Ceiling vent pool emptied on engine teardown')
  assert.equal(getCeilingLightPoolStats().entries, 0, 'Ceiling light pool emptied on engine teardown')
  const propStats = getEnvironmentalPropPoolStats()
  assert.equal(propStats.materials, 0, 'Env prop material pool emptied on engine teardown')
  assert.equal(propStats.textureSets, 0, 'Env prop texture pool emptied on engine teardown')
  assert.equal(propStats.geometries, 0, 'Env prop geometry pool emptied on engine teardown')
  assert.equal(getStructuralDeteriorationPoolStats().materials, 0, 'Deterioration pool emptied on teardown')
  assert.equal(getBackdropPoolStats().entries, 0, 'Backdrop pool emptied on teardown')
  console.log('✓ Maze reset & engine teardown disposal verified with zero shared-pool leaks')
}

// ---------------------------------------------------------------------------
// 5. Instance/Transform/Color Preservation, Flicker Dirty-Chunk Isolation & Preset Sync
// ---------------------------------------------------------------------------
{
  console.log('Test 5: Instance/transform preservation, flicker dirty-chunk isolation & preset sync')

  const maze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  let expectedWallCount = 0
  for (let r = 0; r < maze.rows; r += 1) {
    for (let c = 0; c < maze.cols; c += 1) {
      if (maze.grid[r][c] === 1) expectedWallCount += 1
    }
  }

  const group = buildMazeMeshes(maze, { qualityPreset: 'high' })
  const wallChunks = getLayerMeshes(group.getObjectByName('maze-walls'))
  const capChunks = getLayerMeshes(group.getObjectByName('maze-wall-caps'))
  const totalWallInstances = wallChunks.reduce((s, m) => s + m.count, 0)
  const totalCapInstances = capChunks.reduce((s, m) => s + m.count, 0)
  assert.equal(totalWallInstances, expectedWallCount, 'Chunked wall instances match exact wall cell count')
  assert.equal(totalCapInstances, expectedWallCount, 'Chunked wall cap instances match exact wall cell count')

  // Every wall chunk retains per-instance matrix and deterministic vertex color
  const m4 = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const col = new THREE.Color()
  for (const wc of wallChunks) {
    assert.ok(wc.instanceColor, `${wc.name} retains instanceColor buffer`)
    const b = wc.userData.chunkBounds
    for (let i = 0; i < wc.count; i += 1) {
      wc.getMatrixAt(i, m4)
      pos.setFromMatrixPosition(m4)
      assert.ok(
        pos.x >= b.minX - 1e-3 && pos.x <= b.maxX + 1e-3 && pos.z >= b.minZ - 1e-3 && pos.z <= b.maxZ + 1e-3,
        `${wc.name} instance ${i} (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) resides inside chunk bounds`
      )
      wc.getColorAt(i, col)
      assert.ok(col.r > 0 && col.g > 0 && col.b > 0, `${wc.name} preserves wall color tint`)
    }
  }

  // Flicker dirty-chunk isolation & live preset transition via MazeSceneEngine
  const { engine } = createHeadlessEngine({ qualityPreset: 'high' })
  engine.setMaze(maze)
  const lightsGroup = engine.getMazeGroup().getObjectByName('maze-ceiling-lights-group')
  const { fixtures, diffuserMeshes, diffuserTargets } = lightsGroup.userData

  // Identify chunks containing NO flickering fixtures vs chunks WITH flickering fixtures
  const flickeringChunkIndices = new Set()
  for (let i = 0; i < lightsGroup.userData.diffuserEntries.length; i += 1) {
    const d = lightsGroup.userData.diffuserEntries[i]
    if (fixtures[d.fixtureIndex].condition === 'flickering') {
      flickeringChunkIndices.add(diffuserTargets[i].meshIndex)
    }
  }
  const versionsBefore = diffuserMeshes.map((m) => m.instanceColor.version)

  engine.setPlayerWorldPosition(gridToWorld(1, 1, maze))
  engine.stepFrame(0.25, { render: false })
  engine.stepFrame(0.35, { render: false })

  let dirtyChunkCount = 0
  let cleanStaticChunkCount = 0
  for (let m = 0; m < diffuserMeshes.length; m += 1) {
    const afterVer = diffuserMeshes[m].instanceColor.version
    if (flickeringChunkIndices.has(m)) {
      if (afterVer > versionsBefore[m]) dirtyChunkCount += 1
    } else {
      assert.equal(
        afterVer,
        versionsBefore[m],
        `Static ceiling-light chunk ${m} skips instanceColor buffer upload during flicker`
      )
      cleanStaticChunkCount += 1
    }
  }
  assert.ok(dirtyChunkCount >= 1, 'At least one flickering ceiling-light chunk increments version')
  assert.ok(cleanStaticChunkCount >= 1, 'At least one static ceiling-light chunk avoids upload during flicker')

  // Verify diffuser, halo & environmental-prop instance counts + bounds match canonical source entries
  const lightsMeta = lightsGroup.userData
  const sumDiffuserInstances = lightsMeta.diffuserMeshes.reduce((s, m) => s + m.count, 0)
  const sumHaloInstances = lightsMeta.haloMeshes.reduce((s, m) => s + m.count, 0)
  assert.equal(sumDiffuserInstances, lightsMeta.diffuserEntries.length, 'Chunked diffuser instances match light entries')
  assert.equal(sumHaloInstances, lightsMeta.fixtures.length, 'Chunked halo instances match fixtures')

  const propsGroup = engine.getMazeGroup().getObjectByName('maze-environmental-props')
  const sumPropInstances = propsGroup.children.reduce((s, m) => s + m.count, 0)
  assert.equal(sumPropInstances, propsGroup.userData.instanceCount, 'Chunked prop sub-instances match source total')
  for (const ch of propsGroup.children) {
    if (!ch.userData?.isSpatialChunk) continue
    const cb = ch.userData.chunkBounds
    for (let i = 0; i < ch.count; i += 1) {
      ch.getMatrixAt(i, m4)
      pos.setFromMatrixPosition(m4)
      // Sub-parts have small local offsets around the parent prop pivot assigned to the chunk
      assert.ok(
        pos.x >= cb.minX - 2.0 && pos.x <= cb.maxX + 2.0 && pos.z >= cb.minZ - 2.0 && pos.z <= cb.maxZ + 2.0,
        `${ch.name} instance ${i} near assigned chunkBounds`
      )
    }
  }

  // Live qualityPreset & highContrast toggling preserves chunked layers & wall outlines
  engine.updateGraphicsConfig({ qualityPreset: 'performance', highContrast: true })
  const haloNode = engine.getMazeGroup().getObjectByName('maze-ceiling-light-halos')
  for (const hm of getLayerMeshes(haloNode)) {
    assert.equal(hm.visible, false, `Performance preset hides chunked halo ${hm.name}`)
  }
  const wallOutline = engine.getMazeGroup().getObjectByName('maze-walls-outline')
  assert.ok(wallOutline && wallOutline.visible === true, 'High-contrast outline attaches cleanly alongside chunked walls')
  assert.equal(engine.getMazeGroup().userData.wallMat.color.getHex(), 0x2d3f59)

  engine.updateGraphicsConfig({ qualityPreset: 'balanced', highContrast: false })
  for (const hm of getLayerMeshes(haloNode)) {
    assert.equal(hm.visible, true, `Balanced preset restores chunked halo ${hm.name}`)
  }
  assert.equal(wallOutline.visible, false, 'High-contrast outline hides cleanly when disabled')

  engine.dispose()
  disposeMazeGroup(group)
  console.log('✓ Instance/transform preservation, dirty-chunk isolation, preset & highContrast sync verified')
}

// ---------------------------------------------------------------------------
// 6. Corner, Edge & Center Culling Reduction Across All 4 Difficulties
// ---------------------------------------------------------------------------
{
  console.log('Test 6: Corner, edge & center THREE.Frustum culling across all 4 difficulties')

  const getAllRenderableLeafMeshes = (root) => {
    const out = []
    root.traverse((n) => {
      if ((n.isMesh || n.isInstancedMesh) && n.visible) out.push(n)
    })
    return out
  }

  const getLeafTris = (mesh) => {
    const g = mesh.geometry
    const base = g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3
    return mesh.isInstancedMesh ? base * mesh.count : base
  }

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 4242 })
    const group = buildMazeMeshes(maze, { qualityPreset: 'high' })
    group.updateMatrixWorld(true)

    const leaves = getAllRenderableLeafMeshes(group)
    const totalTris = leaves.reduce((s, m) => s + getLeafTris(m), 0)

    const cornerW = gridToWorld(1, 1, maze)
    const cornerOut = { x: cornerW.x - 4, z: cornerW.z - 4 }
    const cornerIn = gridToWorld(Math.min(maze.rows - 2, 7), Math.min(maze.cols - 2, 7), maze)
    const edgeW = gridToWorld(1, Math.floor(maze.cols / 2), maze)
    const edgeLook = gridToWorld(1, Math.min(maze.cols - 2, Math.floor(maze.cols / 2) + 5), maze)
    const centerW = gridToWorld(Math.floor(maze.rows / 2), Math.floor(maze.cols / 2), maze)
    const centerLook = gridToWorld(Math.floor(maze.rows / 2), Math.min(maze.cols - 2, Math.floor(maze.cols / 2) + 6), maze)

    const views = [
      ['corner-outward-cam', 65, 16 / 9, 400, cornerW, cornerOut, 0.70],
      ['corner-inward-spot', 60, 1, 28, cornerW, cornerIn, 0.25],
      ['edge-cam', 65, 16 / 9, 400, edgeW, edgeLook, 0.35],
      ['center-cam', 65, 16 / 9, 400, centerW, centerLook, 0.35],
    ]

    for (const [label, fov, aspect, far, origin, target, minCulledFrac] of views) {
      const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, far)
      cam.position.set(origin.x, 1.65, origin.z)
      cam.lookAt(target.x, 1.65, target.z)
      cam.updateMatrixWorld(true)
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
      )

      let visDrawCalls = 0
      let visTris = 0
      for (const m of leaves) {
        if (frustum.intersectsObject(m)) {
          visDrawCalls += 1
          visTris += getLeafTris(m)
        }
      }

      if (difficulty === 'small') {
        assert.ok(visDrawCalls > 0 && visDrawCalls <= leaves.length)
      } else {
        const culledFrac = 1 - visTris / totalTris
        assert.ok(
          culledFrac >= minCulledFrac,
          `${difficulty} ${label} culls >= ${(minCulledFrac * 100).toFixed(0)}% triangles (culled ${(culledFrac * 100).toFixed(1)}%, visDC=${visDrawCalls}/${leaves.length})`
        )
      }
    }

    disposeMazeGroup(group)
  }

  console.log('✓ Corner, edge & center frustum culling verified across small, medium, large & hardcore')
}

console.log('=== ALL PHASE 4 SPATIAL CHUNKING & FRUSTUM CULLING TESTS PASSED! ===')
