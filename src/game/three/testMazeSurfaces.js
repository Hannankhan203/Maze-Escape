import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { CELL_SIZE, WALL_HEIGHT, worldToGrid } from '../world/worldCoords.js'
import { CAMERA_MODES } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  MAZE_MESH_PALETTE,
  buildMazeMeshes,
  disposeMazeGroup,
} from './buildMazeMeshes.js'
import {
  disposeMazeSurfacePools,
  getMazeSurfacePoolStats,
  getMazeSurfaceTextureSet,
} from './mazeSurfaceTextures.js'
import { disposeAllSharedPools, isSharedResource } from './sharedResources.js'

console.log('--- RUNNING ABANDONED FACILITY WALL & FLOOR SURFACE TESTS ---')

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
// 1. Procedural Surface Texture Color Spaces, Sizes & Shared Pooling
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Procedural concrete textures, color spaces & shared pooling')

  const setA = getMazeSurfaceTextureSet()
  const setB = getMazeSurfaceTextureSet()
  assert.equal(setA.floor.map, setB.floor.map, 'Floor textures pooled across calls')
  assert.equal(setA.wall.map, setB.wall.map, 'Wall textures pooled across calls')
  assert.equal(setA.cap.map, setB.cap.map, 'Cap textures pooled across calls')
  assert.equal(
    setA.graffitiMaterial,
    setB.graffitiMaterial,
    'Graffiti atlas material pooled across calls'
  )

  // Verify sRGB vs linear data color space settings
  assert.equal(setA.floor.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(setA.wall.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(setA.cap.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(setA.graffitiAtlas.colorSpace, THREE.SRGBColorSpace)

  assert.equal(setA.floor.roughnessMap.colorSpace, THREE.NoColorSpace)
  assert.equal(setA.floor.bumpMap.colorSpace, THREE.NoColorSpace)
  assert.equal(setA.wall.roughnessMap.colorSpace, THREE.NoColorSpace)
  assert.equal(setA.wall.bumpMap.colorSpace, THREE.NoColorSpace)
  assert.equal(setA.cap.bumpMap.colorSpace, THREE.NoColorSpace)

  // Compact power-of-2 sizes (<= 512x512)
  assert.equal(setA.floor.map.image.width, 512)
  assert.equal(setA.floor.roughnessMap.image.width, 256)
  assert.equal(setA.wall.map.image.width, 512)
  assert.equal(setA.wall.bumpMap.image.width, 256)
  assert.equal(setA.graffitiAtlas.image.width, 512)

  // Verify non-trivial surface variation & readable albedo mean
  const floorData = setA.floor.map.image.data
  let minLum = 255
  let maxLum = 0
  let sumLum = 0
  const pxCount = 512 * 512
  for (let i = 0; i < pxCount; i += 1) {
    const l = floorData[i * 4]
    if (l < minLum) minLum = l
    if (l > maxLum) maxLum = l
    sumLum += l
  }
  const avgLum = sumLum / pxCount
  assert.ok(maxLum - minLum >= 45, 'Floor texture contains real seam/stain/crack variation')
  assert.ok(avgLum >= 195 && avgLum <= 245, `Floor albedo multiplier (${avgLum.toFixed(1)}) keeps floor clear`)

  assert.equal(isSharedResource(setA.floor.map), true)
  assert.equal(isSharedResource(setA.wall.map), true)
  assert.equal(isSharedResource(setA.graffitiMaterial), true)

  disposeMazeSurfacePools()
  assert.equal(getMazeSurfacePoolStats().entries, 0)
  console.log('✓ Procedural PBR texture formats, sizes & pooling verified')
}

// ---------------------------------------------------------------------------
// 2. Floor UVs, Contact AO, Per-Wall Variation & Draw Calls Across Difficulties
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Floor UV scaling, contact AO, instanced wall variation & draw calls')

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 7788 })
    const group = buildMazeMeshes(maze)

    const floorMesh = group.getObjectByName('maze-floor')
    const wallsMesh = group.getObjectByName('maze-walls')
    const capsMesh = group.getObjectByName('maze-wall-caps')
    const graffitiMesh = group.getObjectByName('maze-walls-graffiti')

    assert.ok(floorMesh?.isMesh, `Floor exists for ${difficulty}`)
    assert.ok(wallsMesh?.isInstancedMesh, `Walls instanced mesh exists for ${difficulty}`)
    assert.ok(capsMesh?.isInstancedMesh, `Caps instanced mesh exists for ${difficulty}`)
    assert.ok(graffitiMesh?.isMesh, `Selective graffiti mesh exists for ${difficulty}`)

    // Keep exact 2 direct InstancedMesh children on root (matching performance test contract)
    const directInstanced = group.children.filter((c) => c.isInstancedMesh)
    assert.equal(directInstanced.length, 2, `${difficulty} uses 2 instanced draw calls for walls/caps`)

    // Consistent world-space UV scaling across all maze sizes (cols/2, rows/2)
    const uvAttr = floorMesh.geometry.attributes.uv
    let maxU = -Infinity
    let maxV = -Infinity
    for (let i = 0; i < uvAttr.count; i += 1) {
      maxU = Math.max(maxU, uvAttr.getX(i))
      maxV = Math.max(maxV, uvAttr.getY(i))
    }
    assert.ok(
      Math.abs(maxU - maze.cols / 2) < 0.05 && Math.abs(maxV - maze.rows / 2) < 0.05,
      `Floor UVs (${maxU.toFixed(2)}, ${maxV.toFixed(2)}) match 2x2-cell world tiling on ${difficulty}`
    )

    // Vertex colors present with subtle AO contrast (not crushed)
    const colorAttr = floorMesh.geometry.attributes.color
    assert.ok(colorAttr, `Floor contact AO vertex colors exist for ${difficulty}`)
    let minColor = Infinity
    let maxColor = -Infinity
    for (let i = 0; i < colorAttr.count; i += 1) {
      const r = colorAttr.getX(i)
      minColor = Math.min(minColor, r)
      maxColor = Math.max(maxColor, r)
    }
    assert.ok(minColor >= 0.7 && maxColor <= 1.08 && maxColor - minColor >= 0.1)

    // Per-instance wall tint variation populated cleanly
    assert.ok(wallsMesh.instanceColor, `Wall instance colors exist on ${difficulty}`)
    assert.ok(capsMesh.instanceColor, `Cap instance colors exist on ${difficulty}`)

    disposeMazeGroup(group)
  }

  disposeAllSharedPools()
  console.log('✓ Floor tiling, contact AO, wall variation & draw-call budget verified')
}

// ---------------------------------------------------------------------------
// 3. Selective Graffiti Placement, Outward Winding & Exclusion Rules
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Selective graffiti placement, outward normals & corridor visibility')

  const maze = generateMaze({ difficulty: 'large', seed: 55123 })
  const groupA = buildMazeMeshes(maze)
  const groupB = buildMazeMeshes(maze)

  const gMeshA = groupA.getObjectByName('maze-walls-graffiti')
  const gMeshB = groupB.getObjectByName('maze-walls-graffiti')
  const count = gMeshA.userData.decalCount

  // Selective (not plastered everywhere) and capped cleanly
  assert.ok(count >= 2 && count <= 16, `Graffiti count (${count}) is selective and restrained`)
  assert.equal(count, gMeshB.userData.decalCount, 'Graffiti count deterministic for same seed')

  const posAttr = gMeshA.geometry.attributes.position
  const normAttr = gMeshA.geometry.attributes.normal
  const idxAttr = gMeshA.geometry.index

  assert.equal(posAttr.count, count * 4)
  assert.equal(idxAttr.count, count * 6)

  const p0 = new THREE.Vector3()
  const p1 = new THREE.Vector3()
  const p2 = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const triNorm = new THREE.Vector3()
  const storedNorm = new THREE.Vector3()

  for (let i = 0; i < count; i += 1) {
    const v0 = i * 4
    p0.fromBufferAttribute(posAttr, v0)
    p1.fromBufferAttribute(posAttr, v0 + 1)
    p2.fromBufferAttribute(posAttr, v0 + 2)
    storedNorm.fromBufferAttribute(normAttr, v0)

    // Outward winding matches normal for FrontSide visibility
    e1.subVectors(p1, p0)
    e2.subVectors(p2, p0)
    triNorm.crossVectors(e1, e2).normalize()
    assert.ok(
      triNorm.dot(storedNorm) > 0.99,
      `Graffiti decal #${i} front-facing winding matches outward normal`
    )

    // Stepping ~0.5m along normal lands inside an exposed walkable PATH cell (not start/exit)
    const center = new THREE.Vector3().addVectors(p0, p2).multiplyScalar(0.5)
    assert.ok(center.y > 0.4 && center.y < WALL_HEIGHT - 0.3, 'Graffiti sits at realistic wall height')
    const corridorPoint = center.clone().addScaledVector(storedNorm, CELL_SIZE * 0.35)
    const cell = worldToGrid(corridorPoint.x, corridorPoint.z, maze)
    assert.ok(cell, 'Graffiti faces valid grid cell')
    assert.equal(
      maze.grid[cell.row][cell.col],
      CELL_TYPES.PATH,
      'Graffiti faces strictly into walkable corridor path'
    )
    const isStart = maze.start && cell.row === maze.start.row && cell.col === maze.start.col
    const isExit = maze.exit && cell.row === maze.exit.row && cell.col === maze.exit.col
    assert.equal(isStart || isExit, false, 'Graffiti never overlaps start or exit threshold')
  }

  disposeMazeGroup(groupA)
  disposeMazeGroup(groupB)
  disposeAllSharedPools()
  console.log('✓ Selective graffiti placement, outward winding & corridor exclusions verified')
}

// ---------------------------------------------------------------------------
// 4. Engine Integration, Presets, Camera Modes & Clean Pool Cleanup
// ---------------------------------------------------------------------------
{
  console.log('Test 4: MazeSceneEngine integration, camera modes, High Contrast & pool cleanup')

  const maze = generateMaze({ difficulty: 'medium', seed: 9900 })
  const { engine } = createHeadlessEngine({ cameraMode: CAMERA_MODES.FIRST_PERSON })
  engine.setMaze(maze)

  const mazeGroup = engine.getMazeGroup()
  assert.ok(mazeGroup.userData.floorMat.map, 'Engine maze floor carries procedural texture')
  assert.ok(mazeGroup.userData.wallMat.map, 'Engine maze wall carries procedural texture')

  // Switching camera modes & graphics presets keeps surface textures intact
  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.updateGraphicsConfig({ qualityPreset: 'performance' })
  assert.ok(mazeGroup.getObjectByName('maze-walls-graffiti').visible)

  // High contrast toggle restores wall palette cleanly
  engine.setHighContrast(true)
  engine.setHighContrast(false)
  assert.equal(mazeGroup.userData.wallMat.color.getHex(), MAZE_MESH_PALETTE.wallBody)

  engine.dispose()
  assert.equal(
    getMazeSurfacePoolStats().entries,
    0,
    'Surface texture pool disposes completely when final engine disposes'
  )
  console.log('✓ Engine lifecycle, presets, High Contrast & pool disposal verified')
}

console.log('=== ALL ABANDONED FACILITY WALL & FLOOR SURFACE TESTS PASSED! ===')
