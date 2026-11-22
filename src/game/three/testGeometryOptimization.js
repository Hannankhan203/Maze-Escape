import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import { CEILING_ELECTRICAL_CLEARANCE_MIN_Y } from './buildCeilingElectrical.js'
import { MAZE_CEILING_CONFIG } from './buildMazeCeiling.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import {
  FACE_ALL,
  FACE_BOT,
  FACE_NEG_X,
  FACE_NEG_Z,
  FACE_POS_X,
  FACE_POS_Z,
  FACE_TOP,
  buildMergedBoxesWithCulling,
  buildOptimizedFloorGeometry,
  computeBoxBounds,
  countKeptBoxTriangles,
  countKeptFaces,
  mergeIndexedGeometries,
} from './geometryOptimization.js'
import { buildEnvironmentalProps } from './buildEnvironmentalProps.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools } from './sharedResources.js'
import {
  DEFAULT_SPATIAL_CHUNKING_CONFIG,
  createMazeChunkLayout,
  getGeometryTriangleCount,
  getLayerMeshes,
  splitAxisAlignedBoxToChunks,
} from './spatialChunking.js'
import {
  buildUndergroundBackdrop,
  disposeUndergroundBackdrop,
} from './undergroundBackdrop.js'

console.log('--- RUNNING PHASE 5 GEOMETRY OPTIMIZATION & HIDDEN-FACE REDUCTION TESTS ---')

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
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    isSoftwareGl: false,
    lowPerformance: false,
    ...config,
  })
}

function assertGeometryValid(geometry, label) {
  assert.ok(geometry, `${label} geometry exists`)
  const pos = geometry.attributes.position
  const norm = geometry.attributes.normal
  const uv = geometry.attributes.uv
  const idx = geometry.index

  assert.ok(pos && pos.count >= 3, `${label} has position vertices`)
  if (norm) {
    assert.equal(norm.count, pos.count, `${label} normal count matches position`)
  }
  if (uv) {
    assert.equal(uv.count, pos.count, `${label} uv count matches position`)
  }
  if (idx) {
    assert.ok(idx.count >= 3 && idx.count % 3 === 0, `${label} has valid triangle index`)
  } else {
    assert.ok(pos.count >= 3 && pos.count % 3 === 0, `${label} non-indexed triangle count valid`)
  }

  for (let i = 0; i < pos.count; i += 1) {
    assert.ok(
      Number.isFinite(pos.getX(i)) &&
        Number.isFinite(pos.getY(i)) &&
        Number.isFinite(pos.getZ(i)),
      `${label} position[${i}] finite`
    )
    if (norm) {
      const nx = norm.getX(i)
      const ny = norm.getY(i)
      const nz = norm.getZ(i)
      const nLen = Math.hypot(nx, ny, nz)
      assert.ok(
        Number.isFinite(nLen) && Math.abs(nLen - 1) < 0.02,
        `${label} normal[${i}] normalized (${nLen})`
      )
    }
    if (uv) {
      assert.ok(
        Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)),
        `${label} uv[${i}] finite`
      )
    }
  }

  const vA = new THREE.Vector3()
  const vB = new THREE.Vector3()
  const vC = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const cross = new THREE.Vector3()

  const triIndicesCount = idx ? idx.count : pos.count
  for (let t = 0; t < triIndicesCount; t += 3) {
    const a = idx ? idx.getX(t) : t
    const b = idx ? idx.getX(t + 1) : t + 1
    const c = idx ? idx.getX(t + 2) : t + 2
    assert.ok(a < pos.count && b < pos.count && c < pos.count, `${label} index in range`)
    vA.fromBufferAttribute(pos, a)
    vB.fromBufferAttribute(pos, b)
    vC.fromBufferAttribute(pos, c)
    e1.subVectors(vB, vA)
    e2.subVectors(vC, vA)
    cross.crossVectors(e1, e2)
    assert.ok(cross.lengthSq() > 1e-12, `${label} triangle ${t / 3} non-degenerate`)
  }

  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  assert.ok(geometry.boundingBox && !geometry.boundingBox.isEmpty(), `${label} valid boundingBox`)
  assert.ok(
    geometry.boundingSphere && Number.isFinite(geometry.boundingSphere.radius) && geometry.boundingSphere.radius > 0,
    `${label} valid boundingSphere`
  )
}

function assertOutwardCCWWinding(geometry, label) {
  const pos = geometry.attributes.position
  const norm = geometry.attributes.normal
  const idx = geometry.index
  const vA = new THREE.Vector3()
  const vB = new THREE.Vector3()
  const vC = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const triN = new THREE.Vector3()
  const vN = new THREE.Vector3()

  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t)
    const b = idx.getX(t + 1)
    const c = idx.getX(t + 2)
    vA.fromBufferAttribute(pos, a)
    vB.fromBufferAttribute(pos, b)
    vC.fromBufferAttribute(pos, c)
    e1.subVectors(vB, vA)
    e2.subVectors(vC, vA)
    triN.crossVectors(e1, e2).normalize()
    vN.fromBufferAttribute(norm, a).normalize()
    assert.ok(
      triN.dot(vN) > 0.99,
      `${label} triangle ${t / 3} CCW outward winding matches vertex normal (dot=${triN.dot(vN)})`
    )
  }
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Unit Invariants: Face Culling, Outward Winding, UVs, Bounds & Splitting
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Face-mask culling, outward winding, UVs, boxBounds & chunk seam reopening')

  assert.equal(countKeptFaces(0), 6)
  assert.equal(countKeptFaces(FACE_TOP | FACE_BOT), 4)
  assert.equal(countKeptFaces(FACE_ALL & ~FACE_BOT), 1)
  assert.equal(countKeptFaces(FACE_ALL), 0)
  assert.equal(
    countKeptBoxTriangles([
      { cullFaces: FACE_TOP | FACE_POS_X | FACE_NEG_X },
      { cullFaces: FACE_ALL & ~FACE_BOT },
    ]),
    8
  )

  const boxOnlyBot = {
    cx: 4.2,
    cy: 3.5,
    cz: -2.6,
    sx: 0.8,
    sy: 0.24,
    sz: 0.5,
    shade: 0.9,
    cullFaces: FACE_ALL & ~FACE_BOT,
  }
  const geo = buildMergedBoxesWithCulling([boxOnlyBot], {
    tileUnits: 1.6,
    worldTileUVs: true,
    storeBoxBounds: true,
  })
  assertGeometryValid(geo, 'culled-single-face-box')
  assertOutwardCCWWinding(geo, 'culled-single-face-box')
  assert.equal(geo.attributes.position.count, 4, 'Only 1 face (4 verts) emitted')
  assert.equal(geo.index.count, 6, 'Only 1 face (2 tris / 6 indices) emitted')
  assert.equal(geo.attributes.normal.getY(0), -1, 'Kept face is -Y soffit')
  assert.ok(Array.isArray(geo.userData.boxBounds) && geo.userData.boxBounds.length === 1)
  const expectedBounds = computeBoxBounds(boxOnlyBot)
  assert.deepEqual(geo.userData.boxBounds[0], expectedBounds, 'boxBounds records full 3D volume')
  geo.dispose()

  const rotatedBox = {
    cx: 1.5,
    cy: 3.2,
    cz: 2.5,
    sx: 0.4,
    sy: 0.2,
    sz: 0.3,
    rx: 0.25,
    ry: -0.4,
    rz: 0.15,
    r: 0.8,
    g: 0.7,
    b: 0.6,
    cullFaces: FACE_TOP,
  }
  const rotGeo = buildMergedBoxesWithCulling([rotatedBox], {
    tileUnits: 1.2,
    worldTileUVs: false,
  })
  assertGeometryValid(rotGeo, 'rotated-culled-box')
  assertOutwardCCWWinding(rotGeo, 'rotated-culled-box')
  assert.equal(rotGeo.attributes.position.count, 20, '5 unculled faces = 20 verts')
  rotGeo.dispose()

  // Verify splitAxisAlignedBoxToChunks clears internal X/Z seam culls while preserving top/bot culls
  const testLayout = {
    isChunked: true,
    chunkCols: 2,
    chunkRows: 2,
    totalChunks: 4,
    splitXs: [0],
    splitZs: [0],
    getChunkX: (x) => (x < 0 ? 0 : 1),
    getChunkZ: (z) => (z < 0 ? 0 : 1),
    getChunkCoords: (x, z) => [x < 0 ? 0 : 1, z < 0 ? 0 : 1],
    getChunkIndex: (x, z) => (z < 0 ? 0 : 1) * 2 + (x < 0 ? 0 : 1),
  }
  const girder = {
    cx: 0,
    cy: 3.3,
    cz: -4,
    sx: 10,
    sy: 0.56,
    sz: 0.78,
    cullFaces: FACE_TOP | FACE_POS_X | FACE_NEG_X,
  }
  const splitPieces = splitAxisAlignedBoxToChunks(girder, testLayout)
  assert.equal(splitPieces.length, 2, 'Girder splits into 2 chunks across x=0')
  assert.equal(
    splitPieces[0].item.cullFaces,
    FACE_TOP | FACE_NEG_X,
    'Left chunk keeps FACE_NEG_X culled and clears FACE_POS_X at seam'
  )
  assert.equal(
    splitPieces[1].item.cullFaces,
    FACE_TOP | FACE_POS_X,
    'Right chunk keeps FACE_POS_X culled and clears FACE_NEG_X at seam'
  )

  // Verify buildOptimizedFloorGeometry emits exact top grid + simplified underside/skirts & skips seams
  const floorAllFaces = buildOptimizedFloorGeometry({
    width: 10,
    depth: 8,
    thickness: 0.4,
    segX: 5,
    segZ: 4,
    skipFaces: 0,
  })
  assertGeometryValid(floorAllFaces, 'floor-all-faces')
  assertOutwardCCWWinding(floorAllFaces, 'floor-all-faces')
  assert.equal(floorAllFaces.attributes.position.count, 6 * 5 + 5 * 4, '30 top verts + 20 side/bot verts')
  assert.equal(floorAllFaces.index.count / 3, 5 * 4 * 2 + 5 * 2, '40 top tris + 10 side/bot tris')
  floorAllFaces.dispose()

  const floorInteriorChunk = buildOptimizedFloorGeometry({
    width: 10,
    depth: 8,
    thickness: 0.4,
    segX: 5,
    segZ: 4,
    skipFaces: FACE_POS_X | FACE_NEG_X | FACE_POS_Z | FACE_NEG_Z,
  })
  assertGeometryValid(floorInteriorChunk, 'floor-interior-chunk')
  assertOutwardCCWWinding(floorInteriorChunk, 'floor-interior-chunk')
  assert.equal(floorInteriorChunk.attributes.position.count, 6 * 5 + 4, 'Top grid + 1 bottom quad only')
  assert.equal(floorInteriorChunk.index.count / 3, 40 + 2, '40 top tris + 2 bottom tris')
  floorInteriorChunk.dispose()

  // Verify mergeIndexedGeometries preserves index buffers, harmonizes attributes, and strips tangents
  const indexedBox = new THREE.BoxGeometry(1, 1, 1)
  indexedBox.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(24 * 4), 4))
  indexedBox.setAttribute('color', new THREE.BufferAttribute(new Float32Array(24 * 3).fill(1), 3))
  const cyl = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8)
  cyl.deleteAttribute('uv')
  const merged = mergeIndexedGeometries([indexedBox, cyl])
  assertGeometryValid(merged, 'mergeIndexedGeometries-mixed')
  assert.ok(merged.index, 'mergeIndexedGeometries preserves index buffer')
  assert.equal(merged.attributes.tangent, undefined, 'mergeIndexedGeometries strips tangent attribute')
  assert.equal(merged.attributes.color, undefined, 'mergeIndexedGeometries drops partial color attribute')
  assert.equal(
    merged.attributes.position.count,
    indexedBox.attributes.position.count + cyl.attributes.position.count,
    'mergeIndexedGeometries avoids .toNonIndexed() vertex bloat'
  )
  indexedBox.dispose()
  cyl.dispose()
  merged.dispose()

  console.log('✓ Unit invariants passed')
}

// ---------------------------------------------------------------------------
// 2. Full Maze Verification Across All 4 Difficulties
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Full maze geometry validation, clearances & chunking across all difficulties')

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 42 })
    const group = buildMazeMeshes(maze)
    group.updateMatrixWorld(true)

    let validatedMeshes = 0
    group.traverse((node) => {
      if (!node.isMesh || node.isInstancedMesh) return
      // Static merged / chunked geometry checks
      assert.equal(node.frustumCulled, true, `${difficulty} ${node.name} frustumCulled=true`)
      assertGeometryValid(node.geometry, `${difficulty}:${node.name}`)
      validatedMeshes += 1
    })
    assert.ok(validatedMeshes >= 10, `${difficulty} validated static meshes (${validatedMeshes})`)

    // Verify floor continuity & absence of internal side skirts between adjacent chunks on chunked mazes
    const layout = createMazeChunkLayout(maze)
    const floorMeshes = getLayerMeshes(group.getObjectByName('maze-floor'))
    if (layout.isChunked) {
      assert.equal(floorMeshes.length, layout.totalChunks)
      for (const fm of floorMeshes) {
        const { chunkX, chunkZ } = fm.userData
        const norm = fm.geometry.attributes.normal
        let hasPosX = false
        let hasNegX = false
        let hasPosZ = false
        let hasNegZ = false
        for (let i = 0; i < norm.count; i += 1) {
          if (norm.getX(i) > 0.5) hasPosX = true
          if (norm.getX(i) < -0.5) hasNegX = true
          if (norm.getZ(i) > 0.5) hasPosZ = true
          if (norm.getZ(i) < -0.5) hasNegZ = true
        }
        assert.equal(hasNegX, chunkX === 0, `${difficulty} floor(${chunkX},${chunkZ}) -X edge matches perimeter`)
        assert.equal(hasPosX, chunkX === layout.chunkCols - 1, `${difficulty} floor(${chunkX},${chunkZ}) +X edge matches perimeter`)
        assert.equal(hasNegZ, chunkZ === 0, `${difficulty} floor(${chunkX},${chunkZ}) -Z edge matches perimeter`)
        assert.equal(hasPosZ, chunkZ === layout.chunkRows - 1, `${difficulty} floor(${chunkX},${chunkZ}) +Z edge matches perimeter`)
      }
    }

    // Verify ceiling structural & electrical vertical clearances remain intact
    for (const cNode of getLayerMeshes(group.getObjectByName('maze-ceiling-beams'))) {
      cNode.geometry.computeBoundingBox()
      assert.ok(
        cNode.geometry.boundingBox.min.y >= MAZE_CEILING_CONFIG.beamBottomY - 0.005,
        `${difficulty} beams maintain >= ${MAZE_CEILING_CONFIG.beamBottomY}m clearance`
      )
    }
    for (const layerName of [
      'maze-ceiling-conduits',
      'maze-ceiling-electrical-hardware',
      'maze-ceiling-cables',
    ]) {
      for (const eMesh of getLayerMeshes(group.getObjectByName(layerName))) {
        eMesh.geometry.computeBoundingBox()
        assert.ok(
          eMesh.geometry.boundingBox.min.y >= CEILING_ELECTRICAL_CLEARANCE_MIN_Y - 1e-4,
          `${difficulty} ${layerName} maintains >= ${CEILING_ELECTRICAL_CLEARANCE_MIN_Y}m clearance`
        )
      }
    }

    // Verify shadow flags preserved cleanly
    const beamsMeshes = getLayerMeshes(group.getObjectByName('maze-ceiling-beams'))
    const deckMeshes = getLayerMeshes(group.getObjectByName('maze-ceiling-deck'))
    assert.equal(beamsMeshes[0].castShadow, true, `${difficulty} beams castShadow preserved`)
    assert.equal(deckMeshes[0].castShadow, false, `${difficulty} ceiling deck skips shadow casting`)

    // Verify walls and wall caps omit concealed -Y bottom faces while keeping valid normals & UVs
    const wallsMeshes = getLayerMeshes(group.getObjectByName('maze-walls'))
    const capsMeshes = getLayerMeshes(group.getObjectByName('maze-wall-caps'))
    assert.ok(wallsMeshes.length >= 1 && wallsMeshes.every((m) => m.isInstancedMesh))
    assert.ok(capsMeshes.length >= 1 && capsMeshes.every((m) => m.isInstancedMesh))
    for (const [mLabel, mObj] of [
      ['maze-walls', wallsMeshes[0]],
      ['maze-wall-caps', capsMeshes[0]],
    ]) {
      assertGeometryValid(mObj.geometry, `${difficulty}:${mLabel}`)
      assertOutwardCCWWinding(mObj.geometry, `${difficulty}:${mLabel}`)
      assert.equal(getGeometryTriangleCount(mObj.geometry), 10, `${difficulty} ${mLabel} emits 5 faces (10 tris)`)
      const nAttr = mObj.geometry.attributes.normal
      for (let i = 0; i < nAttr.count; i += 1) {
        assert.ok(nAttr.getY(i) >= -0.5, `${difficulty} ${mLabel} omits concealed -Y face`)
      }
    }

    // Verify deterioration spall keeps shared-vertex quad efficiency
    const spallMeshes = getLayerMeshes(group.getObjectByName('deterioration-concrete-spall'))
    for (const sm of spallMeshes) {
      assert.ok(
        sm.geometry.attributes.position.count < sm.geometry.index.count * 0.72,
        `${difficulty} spall mesh preserves shared quad vertex efficiency`
      )
    }

    disposeMazeGroup(group)
  }

  // Verify medium (seed=4242) heavy layers still meet spatial chunking threshold (>= 900 tris)
  const medMaze = generateMaze({ difficulty: 'medium', seed: 4242 })
  const medGroup = buildMazeMeshes(medMaze)
  for (const heavyLayer of [
    'maze-floor',
    'maze-ceiling-beams',
    'maze-ceiling-pillars',
    'maze-ceiling-ducts',
    'maze-ceiling-duct-hardware',
    'maze-ceiling-light-housings',
    'maze-ceiling-conduits',
    'maze-ceiling-electrical-hardware',
    'maze-ceiling-cables',
    'deterioration-concrete-spall',
  ]) {
    const node = medGroup.getObjectByName(heavyLayer)
    assert.ok(node?.isGroup && node.userData?.isSpatialChunkGroup, `medium ${heavyLayer} stays chunked`)
    let totalTris = 0
    for (const ch of getLayerMeshes(node)) {
      totalTris += getGeometryTriangleCount(ch.geometry)
    }
    assert.ok(
      totalTris >= DEFAULT_SPATIAL_CHUNKING_CONFIG.minTrianglesToChunk,
      `medium ${heavyLayer} tris (${totalTris}) >= chunking threshold`
    )
  }

  // Verify ceiling deck, beam, vent, and cable reductions
  const smallDeckMaze = generateMaze({ difficulty: 'small', seed: 4242 })
  const smallDeckGroup = buildMazeMeshes(smallDeckMaze)
  const smallDeckGeo = smallDeckGroup.getObjectByName('maze-ceiling-deck').geometry
  const smallDeckTris = getGeometryTriangleCount(smallDeckGeo)
  const smallDeckUnculled = (smallDeckGeo.userData?.boxBounds?.length || 0) * 12
  assert.ok(
    smallDeckUnculled >= 108 && smallDeckTris <= smallDeckUnculled - 32,
    `Unchunked small ceiling deck omits concealed parapet/spandrel faces (${smallDeckTris} tris vs ${smallDeckUnculled} unculled)`
  )
  disposeMazeGroup(smallDeckGroup)

  const deckMeshes = getLayerMeshes(medGroup.getObjectByName('maze-ceiling-deck'))
  const totalDeckTris = deckMeshes.reduce((s, m) => s + getGeometryTriangleCount(m.geometry), 0)
  const totalDeckUnculled = deckMeshes.reduce(
    (s, m) => s + (m.geometry.userData?.boxBounds?.length || 0) * 12,
    0
  )
  assert.ok(
    totalDeckUnculled >= 240 &&
      totalDeckTris <= totalDeckUnculled - 40 &&
      totalDeckTris / deckMeshes.length <= 80,
    `Chunked ceiling deck omits concealed parapet/spandrel faces (${totalDeckTris} tris across ${deckMeshes.length} chunks vs ${totalDeckUnculled} unculled)`
  )
  for (const bm of getLayerMeshes(medGroup.getObjectByName('maze-ceiling-beams'))) {
    const bNorm = bm.geometry.attributes.normal
    for (let i = 0; i < bNorm.count; i += 1) {
      assert.ok(bNorm.getY(i) <= 0.5, 'Ceiling beams omit all concealed +Y top soffit-flush faces')
    }
  }
  const cableMeshes = getLayerMeshes(medGroup.getObjectByName('maze-ceiling-cables'))
  for (const cm of cableMeshes) {
    assert.ok(cm.geometry.index, 'Ceiling cables preserve indexed geometry')
    assert.ok(
      cm.geometry.attributes.position.count < cm.geometry.index.count,
      'Ceiling cables preserve shared ring vertices'
    )
  }
  const spallSites = medGroup.getObjectByName('maze-structural-deterioration')?.userData?.totalSites
  assert.ok(spallSites > 0)
  const expectedMinExtent = medMaze.cols * CELL_SIZE * 0.5
  assert.ok(expectedMinExtent > 10)

  // Verify environmental props preserve indexed geometry & valid normals/UVs
  const propsGroup = buildEnvironmentalProps(medMaze)
  assert.ok(propsGroup && propsGroup.children.length > 0)
  for (const propMesh of propsGroup.children) {
    assert.equal(propMesh.isInstancedMesh, true)
    assert.ok(propMesh.geometry.index, `Prop ${propMesh.name} keeps indexed BufferGeometry`)
    assertGeometryValid(propMesh.geometry, `props:${propMesh.name}`)
    assert.ok(
      propMesh.geometry.attributes.position.count <= propMesh.geometry.index.count,
      `Prop ${propMesh.name} shares vertices via index buffer`
    )
  }
  disposeMazeGroup(propsGroup)
  disposeMazeGroup(medGroup)

  // Verify underground backdrop retains indexed geometry, hidden-face culls & outward winding
  const hcMaze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const backdrop = buildUndergroundBackdrop({
    span: {
      rows: hcMaze.rows,
      cols: hcMaze.cols,
      width: hcMaze.cols * CELL_SIZE,
      depth: hcMaze.rows * CELL_SIZE,
    },
    qualityPreset: 'high',
  })
  for (const bdName of [
    'maze-env-ceiling-vault',
    'maze-env-gantries',
    'maze-env-vents',
    'maze-env-cables',
  ]) {
    const mesh = backdrop.getObjectByName(bdName)
    assert.ok(mesh?.isMesh, `Backdrop ${bdName} built`)
    assert.ok(mesh.geometry.index, `Backdrop ${bdName} uses indexed geometry`)
    assertGeometryValid(mesh.geometry, `backdrop:${bdName}`)
    if (bdName !== 'maze-env-cables') {
      assertOutwardCCWWinding(mesh.geometry, `backdrop:${bdName}`)
    }
  }
  const vaultNorm = backdrop.getObjectByName('maze-env-ceiling-vault').geometry.attributes.normal
  for (let i = 0; i < vaultNorm.count; i += 1) {
    assert.ok(vaultNorm.getY(i) <= 0.5, 'Vault ceiling omits upward +Y faces above soffit')
  }
  const envCables = backdrop.getObjectByName('maze-env-cables').geometry
  assert.ok(
    envCables.attributes.position.count < envCables.index.count,
    'Backdrop catenary cables avoid .toNonIndexed() vertex duplication'
  )
  disposeUndergroundBackdrop(backdrop)

  console.log('✓ Full maze, props & backdrop validation passed across all 4 difficulties')
}

// ---------------------------------------------------------------------------
// 3. Engine Rebuild & Resource Disposal Lifecycle
// ---------------------------------------------------------------------------
{
  console.log('Test 3: MazeSceneEngine rebuild & clean geometry/pool disposal')

  const engine = createHeadlessEngine()
  const mazeA = generateMaze({ difficulty: 'medium', seed: 777 })
  engine.setMaze(mazeA)
  const groupA = engine.getMazeGroup()
  assert.ok(groupA)
  const firstConduit = groupA.getObjectByName('maze-ceiling-conduits')
  assert.ok(firstConduit)

  let disposedA = 0
  groupA.traverse((node) => {
    if (node.isMesh && !node.isInstancedMesh && node.geometry) {
      node.geometry.addEventListener('dispose', () => {
        disposedA += 1
      })
    }
  })

  const mazeB = generateMaze({ difficulty: 'hardcore', seed: 888 })
  engine.setMaze(mazeB)
  assert.ok(disposedA >= 10, `First maze static geometries disposed on reset (${disposedA})`)

  const groupB = engine.getMazeGroup()
  assert.ok(groupB)
  const secondBeams = groupB.getObjectByName('maze-ceiling-beams')
  assert.ok(secondBeams?.isGroup)

  let disposedB = 0
  groupB.traverse((node) => {
    if (node.isMesh && !node.isInstancedMesh && node.geometry) {
      node.geometry.addEventListener('dispose', () => {
        disposedB += 1
      })
    }
  })

  engine.dispose()
  assert.ok(disposedB >= 10, `Active maze static geometries disposed on engine teardown (${disposedB})`)
  disposeAllSharedPools()

  console.log('✓ Lifecycle & disposal checks passed')
}

console.log('ALL PHASE 5 GEOMETRY OPTIMIZATION TESTS PASSED.')
