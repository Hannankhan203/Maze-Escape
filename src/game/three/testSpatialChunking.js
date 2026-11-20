import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { getCeilingLightPoolStats } from './buildCeilingLights.js'
import { getCeilingVentPoolStats } from './buildCeilingVents.js'
import { getEnvironmentalPropPoolStats } from './buildEnvironmentalProps.js'
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
    'maze-ceiling-deck',
    'maze-ceiling-beams',
    'maze-ceiling-pillars',
    'maze-ceiling-ducts',
    'maze-ceiling-duct-hardware',
    'maze-ceiling-vent-cavities',
    'maze-ceiling-light-housings',
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

    const heavyLayers = [
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
    ]
    for (const layerName of heavyLayers) {
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

    // Small decal & deck & sparse micro-rebar layers stay unchunked
    const lightLayers = [
      'maze-ceiling-deck',
      'maze-ceiling-vent-cavities',
      'maze-walls-imperfections',
      'maze-floor-imperfections',
      'maze-ceiling-imperfections',
      'maze-walls-graffiti',
      'deterioration-exposed-rebar',
    ]
    for (const layerName of lightLayers) {
      const node = group.getObjectByName(layerName)
      if (!node) continue
      const tris = getGeometryTriangleCount(node.geometry)
      if (tris < DEFAULT_SPATIAL_CHUNKING_CONFIG.minTrianglesToChunk) {
        assert.ok(node.isMesh, `${difficulty} light layer ${layerName} (${tris} tris) avoids chunking overhead`)
      }
    }

    // InstancedMesh behavior preserved untouched
    const walls = group.getObjectByName('maze-walls')
    const caps = group.getObjectByName('maze-wall-caps')
    const diffusers = group.getObjectByName('maze-ceiling-light-diffusers')
    const halos = group.getObjectByName('maze-ceiling-light-halos')
    for (const im of [walls, caps, diffusers, halos]) {
      assert.ok(im?.isInstancedMesh, `${im?.name} stays InstancedMesh on ${difficulty}`)
      assert.ok(im.boundingSphere && im.boundingSphere.radius > 0, `${im.name} retains boundingSphere`)
    }

    disposeMazeGroup(group)
  }

  console.log('✓ Small-maze zero overhead, heavy-layer chunking & InstancedMesh preservation verified')
}

// ---------------------------------------------------------------------------
// 2. Floor Continuity Across Chunk Borders, Beam Splitting & Shadow Parity
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Boundary continuity (positions, UVs, normals, vertex AO), girder splitting & shadow flags')

  const maze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const layout = createMazeChunkLayout(maze)
  const group = buildMazeMeshes(maze)
  group.updateMatrixWorld(true)

  const floorChunks = getLayerMeshes(group.getObjectByName('maze-floor'))
  assert.equal(floorChunks.length, layout.totalChunks)

  // Verify exact footprint coverage with zero gaps or overlaps
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

  // Verify UVs, normals & vertex AO colors match bit-for-bit on shared boundary vertices (x = splitX)
  const readTopEdgeSamples = (chunkMesh, targetWorldX) => {
    const pos = chunkMesh.geometry.attributes.position
    const uv = chunkMesh.geometry.attributes.uv
    const col = chunkMesh.geometry.attributes.color
    const norm = chunkMesh.geometry.attributes.normal
    const map = new Map()
    for (let i = 0; i < pos.count; i += 1) {
      if (norm.getY(i) <= 0.5) continue
      const wx = pos.getX(i) + chunkMesh.position.x
      const wy = pos.getY(i) + chunkMesh.position.y
      const wz = pos.getZ(i) + chunkMesh.position.z
      if (Math.abs(wx - targetWorldX) < 1e-4 && Math.abs(wy) < 1e-4) {
        const key = `${wx.toFixed(3)}|${wz.toFixed(3)}`
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

  for (let cz = 0; cz < layout.chunkRows; cz += 1) {
    for (let cx = 0; cx < layout.chunkCols - 1; cx += 1) {
      const left = byGrid.get(`${cx},${cz}`)
      const right = byGrid.get(`${cx + 1},${cz}`)
      const seamX = layout.splitXs[cx]
      const leftSamples = readTopEdgeSamples(left, seamX)
      const rightSamples = readTopEdgeSamples(right, seamX)
      assert.ok(leftSamples.size >= 8, `Shared border x=${seamX} has seam vertices`)
      assert.equal(leftSamples.size, rightSamples.size)
      for (const [k, lv] of leftSamples.entries()) {
        const rv = rightSamples.get(k)
        assert.ok(rv, `Matching vertex exists across floor border at ${k}`)
        assert.ok(Math.abs(lv.u - rv.u) < 1e-5, `Continuous U across border (${lv.u} vs ${rv.u})`)
        assert.ok(Math.abs(lv.v - rv.v) < 1e-5, `Continuous V across border (${lv.v} vs ${rv.v})`)
        assert.ok(Math.abs(lv.r - rv.r) < 1e-5, `Continuous AO R across border (${lv.r} vs ${rv.r})`)
        assert.ok(Math.abs(lv.g - rv.g) < 1e-5, `Continuous AO G across border (${lv.g} vs ${rv.g})`)
        assert.ok(Math.abs(lv.b - rv.b) < 1e-5, `Continuous AO B across border (${lv.b} vs ${rv.b})`)
      }
    }
  }

  // Axis-aligned girder splitting test: preserves total span with zero gaps or overlaps
  const sampleGirder = { cx: 0, cy: 3.32, cz: 0, sx: 120, sy: 0.56, sz: 0.78, shade: 0.95 }
  const splitPieces = splitAxisAlignedBoxToChunks(sampleGirder, layout)
  assert.equal(splitPieces.length, layout.chunkCols, 'Long girder splits across all X chunks')
  const summedLength = splitPieces.reduce((s, p) => s + p.item.sx, 0)
  assert.ok(Math.abs(summedLength - sampleGirder.sx) < 1e-5, 'Split girder segments sum to exact original span')

  // Shadow flag preservation across all chunked layers
  const expectedShadowMap = {
    'maze-floor': [false, true],
    'maze-ceiling-beams': [true, true],
    'maze-ceiling-pillars': [true, true],
    'maze-ceiling-ducts': [true, true],
    'maze-ceiling-duct-hardware': [false, true],
    'maze-ceiling-light-housings': [false, true],
    'maze-ceiling-conduits': [false, true],
    'maze-ceiling-electrical-hardware': [false, true],
    'maze-ceiling-cables': [false, true],
    'deterioration-concrete-spall': [true, true],
    'deterioration-cavity-core': [false, true],
    'deterioration-crack-fissures': [false, true],
  }
  for (const [layerName, [expCast, expReceive]] of Object.entries(expectedShadowMap)) {
    const meshes = getLayerMeshes(group.getObjectByName(layerName))
    assert.ok(meshes.length > 0, `${layerName} has meshes`)
    for (const m of meshes) {
      assert.equal(m.castShadow, expCast, `${m.name} preserves castShadow=${expCast}`)
      assert.equal(m.receiveShadow, expReceive, `${m.name} preserves receiveShadow=${expReceive}`)
    }
  }

  disposeMazeGroup(group)
  console.log('✓ Border UV/AO continuity, girder splitting & shadow flags verified')
}

// ---------------------------------------------------------------------------
// 3. Tight Bounding Spheres & Real THREE.Frustum Culling Effectiveness
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Tight bounding spheres & THREE.Frustum culling on hardcore maze')

  const maze = generateMaze({ difficulty: 'hardcore', seed: 4242 })
  const group = buildMazeMeshes(maze)
  group.updateMatrixWorld(true)

  const fullDiagonalRadius =
    Math.hypot(maze.cols * CELL_SIZE, maze.rows * CELL_SIZE) * 0.5 // ~87.7m

  const frustumTestLayers = [
    'maze-floor',
    'maze-ceiling-beams',
    'maze-ceiling-pillars',
    'maze-ceiling-ducts',
    'maze-ceiling-duct-hardware',
    'maze-ceiling-conduits',
    'deterioration-concrete-spall',
  ]

  // Camera near north-west corner facing inward down the NW quadrant (only nearby NW chunks intersect frustum)
  const cornerCell = gridToWorld(1, 1, maze)
  const midNWCell = gridToWorld(7, 7, maze)
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 34)
  camera.position.set(cornerCell.x, 1.65, cornerCell.z)
  camera.lookAt(midNWCell.x, 1.65, midNWCell.z)
  camera.updateMatrixWorld(true)

  const projScreenMatrix = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  )
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projScreenMatrix)

  for (const layerName of frustumTestLayers) {
    const chunks = getLayerMeshes(group.getObjectByName(layerName))
    assert.ok(chunks.length >= 9, `${layerName} has >= 9 spatial chunks on hardcore`)

    let visibleChunks = 0
    let maxChunkRadius = 0
    for (const chunk of chunks) {
      const r = chunk.geometry.boundingSphere.radius
      maxChunkRadius = Math.max(maxChunkRadius, r)
      assert.ok(
        r < fullDiagonalRadius * 0.48,
        `${chunk.name} boundingSphere radius (${r.toFixed(1)}m) is tightly bounded vs monolithic (${fullDiagonalRadius.toFixed(1)}m)`
      )
      if (frustum.intersectsObject(chunk)) {
        visibleChunks += 1
      }
    }

    assert.ok(
      visibleChunks >= 1 && visibleChunks <= Math.ceil(chunks.length * 0.5),
      `${layerName} frustum culling rejects offscreen chunks (${visibleChunks}/${chunks.length} visible, maxR=${maxChunkRadius.toFixed(1)}m)`
    )
  }

  disposeMazeGroup(group)
  console.log('✓ Tight chunk bounding spheres & frustum culling selectivity verified')
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
      if (node.userData?.isSpatialChunk && node.geometry && !seen.has(node.geometry)) {
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
  assert.ok(firstRunCountEnd > firstRunCountStart + 80, 'Tracked chunk geometries from first hardcore maze')

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

console.log('=== ALL PHASE 4 SPATIAL CHUNKING & FRUSTUM CULLING TESTS PASSED! ===')
