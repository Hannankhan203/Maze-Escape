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
  GRAFFITI_ATLAS_UVS,
  IMPERFECTION_ATLAS_UVS,
  disposeMazeSurfacePools,
  getMazeSurfacePoolStats,
  getMazeSurfaceTextureSet,
  normalizeWeatherSeed,
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
// 1. Procedural Surface Texture Color Spaces, Clean Base Maps & 3x3 Atlases
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Clean base concrete maps, 3x3 atlases, color spaces & shared pooling')

  const t0 = performance.now()
  const setA = getMazeSurfaceTextureSet()
  const coldGenMs = performance.now() - t0
  const setB = getMazeSurfaceTextureSet()

  assert.equal(setA.floor.map, setB.floor.map, 'Floor textures pooled across calls')
  assert.equal(setA.wall.map, setB.wall.map, 'Wall textures pooled across calls')
  assert.equal(setA.cap.map, setB.cap.map, 'Cap textures pooled across calls')
  assert.equal(
    setA.graffitiMaterial,
    setB.graffitiMaterial,
    'Graffiti atlas material pooled across calls'
  )
  assert.equal(
    setA.imperfectionMaterial,
    setB.imperfectionMaterial,
    'Imperfection atlas material pooled across calls'
  )

  // Verify sRGB vs linear data color space settings
  assert.equal(setA.floor.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(setA.wall.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(setA.cap.map.colorSpace, THREE.SRGBColorSpace)
  assert.equal(setA.graffitiAtlas.colorSpace, THREE.SRGBColorSpace)
  assert.equal(setA.imperfectionAtlas.colorSpace, THREE.SRGBColorSpace)

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
  assert.equal(setA.imperfectionAtlas.image.width, 512)

  // Verify non-trivial surface variation & readable albedo mean on base floor
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
  assert.ok(maxLum - minLum >= 45, 'Floor texture contains real slab joint/grain contrast')
  assert.ok(avgLum >= 195 && avgLum <= 245, `Floor albedo multiplier (${avgLum.toFixed(1)}) keeps floor clear`)

  // Verify base wall map has NO repeating 2-row form-tie dot pits at legacy socket coordinates
  const wallData = setA.wall.map.image.data
  const sampleWallLum = (u, v) => {
    const x = Math.min(511, Math.max(0, Math.round(u * 511)))
    const y = Math.min(511, Math.max(0, Math.round(v * 511)))
    return wallData[(y * 512 + x) * 4]
  }
  for (const vTie of [0.26, 0.62]) {
    let rowSum = 0
    for (let x = 0; x < 512; x += 1) {
      rowSum += sampleWallLum(x / 511, vTie)
    }
    const rowAvg = rowSum / 512
    for (const uTie of [0.14, 0.36, 0.64, 0.86]) {
      const pitLum = sampleWallLum(uTie, vTie)
      assert.ok(
        Math.abs(rowAvg - pitLum) < 28,
        `Legacy form-tie dot (${uTie}, ${vTie}) removed cleanly (delta=${Math.abs(rowAvg - pitLum).toFixed(1)})`
      )
    }
  }

  // Verify every cell in both 3x3 atlases contains painted alpha content & safe padding
  const checkAtlasCells = (atlas, uvBoundsList, label) => {
    assert.equal(uvBoundsList.length, 9, `${label} has 9 distinct variants`)
    const data = atlas.image.data
    const w = atlas.image.width
    const h = atlas.image.height
    for (let idx = 0; idx < uvBoundsList.length; idx += 1) {
      const [u0, v0, u1, v1] = uvBoundsList[idx]
      assert.ok(u0 < u1 && v0 < v1, `${label} cell #${idx} has valid UV bounds`)
      const x0 = Math.floor(u0 * w)
      const x1 = Math.ceil(u1 * w)
      const y0 = Math.floor(v0 * h)
      const y1 = Math.ceil(v1 * h)
      let opaquePixels = 0
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) {
          if (data[(py * w + px) * 4 + 3] > 20) {
            opaquePixels += 1
          }
        }
      }
      assert.ok(
        opaquePixels >= 120,
        `${label} cell #${idx} has painted detail (${opaquePixels} opaque pixels)`
      )
    }
  }
  checkAtlasCells(setA.graffitiAtlas, GRAFFITI_ATLAS_UVS, 'Graffiti 3x3 atlas')
  checkAtlasCells(setA.imperfectionAtlas, IMPERFECTION_ATLAS_UVS, 'Imperfection 3x3 atlas')

  assert.equal(isSharedResource(setA.floor.map), true)
  assert.equal(isSharedResource(setA.wall.map), true)
  assert.equal(isSharedResource(setA.graffitiMaterial), true)
  assert.equal(isSharedResource(setA.imperfectionMaterial), true)
  assert.ok(coldGenMs < 2000, `Cold procedural texture generation stays fast (${coldGenMs.toFixed(1)}ms)`)

  disposeMazeSurfacePools()
  assert.equal(getMazeSurfacePoolStats().entries, 0)
  console.log(`✓ Clean substrates, 3x3 atlases & pooling verified (cold gen ${coldGenMs.toFixed(0)}ms)`)
}

// ---------------------------------------------------------------------------
// 2. World-Space Concrete Shader Hook Integrity Across Floor, Wall & Cap
// ---------------------------------------------------------------------------
{
  console.log('Test 2: World-space concrete weathering onBeforeCompile shader hooks')

  const mazeA = generateMaze({ difficulty: 'small', seed: 1234 })
  const mazeB = generateMaze({ difficulty: 'small', seed: 5678 })
  const groupA = buildMazeMeshes(mazeA)
  const groupB = buildMazeMeshes(mazeB)

  assert.notEqual(
    normalizeWeatherSeed(mazeA.seed),
    normalizeWeatherSeed(mazeB.seed),
    'Distinct maze seeds produce distinct world-weather seed offsets'
  )

  for (const [label, mat, expectedMode] of [
    ['floorMat', groupA.userData.floorMat, 'floor'],
    ['wallMat', groupA.userData.wallMat, 'wall'],
    ['capMat', groupA.userData.capMat, 'cap'],
  ]) {
    assert.equal(mat.userData.concreteWeatherMode, expectedMode, `${label} stores expected weather mode`)
    assert.ok(mat.userData.concreteWeatherUniforms?.uWeatherSeed, `${label} exposes uWeatherSeed uniform`)

    const mockShader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }
    mat.onBeforeCompile(mockShader)

    assert.ok(
      mockShader.uniforms.uWeatherSeed !== undefined,
      `${label} binds uWeatherSeed into shader uniforms`
    )
    assert.ok(
      mockShader.vertexShader.includes('vConcreteWorldPos') &&
        mockShader.vertexShader.includes('vConcreteWorldNormal') &&
        mockShader.vertexShader.includes('#ifdef USE_INSTANCING'),
      `${label} vertex shader transforms world position/normal with instancing support`
    )
    assert.ok(
      mockShader.fragmentShader.includes('cHash21') &&
        mockShader.fragmentShader.includes('diffuseColor.rgb') &&
        mockShader.fragmentShader.includes('roughnessFactor = clamp(roughnessFactor + concreteRoughDelta'),
      `${label} fragment shader injects non-periodic noise, albedo & roughness modulation`
    )
  }

  disposeMazeGroup(groupA)
  disposeMazeGroup(groupB)
  disposeAllSharedPools()
  console.log('✓ World-space procedural shader hooks verified for floor, wall & coping cap')
}

// ---------------------------------------------------------------------------
// 3. Floor UVs, Contact AO, Imperfection Overlays & Draw Calls Across Sizes
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Floor UV tiling, contact AO, wall/floor imperfection overlays & draw calls')

  // Warm shared surface pool once before benchmarking per-maze geometry build
  getMazeSurfaceTextureSet()

  for (const difficulty of ['small', 'medium', 'large', 'hardcore']) {
    const maze = generateMaze({ difficulty, seed: 7788 })
    const tBuild = performance.now()
    const group = buildMazeMeshes(maze)
    const buildMs = performance.now() - tBuild

    const floorMesh = group.getObjectByName('maze-floor')
    const wallsMesh = group.getObjectByName('maze-walls')
    const capsMesh = group.getObjectByName('maze-wall-caps')
    const wallImpMesh = group.getObjectByName('maze-walls-imperfections')
    const floorImpMesh = group.getObjectByName('maze-floor-imperfections')
    const graffitiMesh = group.getObjectByName('maze-walls-graffiti')

    assert.ok(floorMesh?.isMesh, `Floor exists for ${difficulty}`)
    assert.ok(wallsMesh?.isInstancedMesh, `Walls instanced mesh exists for ${difficulty}`)
    assert.ok(capsMesh?.isInstancedMesh, `Caps instanced mesh exists for ${difficulty}`)
    assert.ok(wallImpMesh?.isMesh, `Wall imperfections overlay exists for ${difficulty}`)
    assert.ok(floorImpMesh?.isMesh, `Floor imperfections overlay exists for ${difficulty}`)
    assert.ok(graffitiMesh?.isMesh, `Selective graffiti mesh exists for ${difficulty}`)

    // Exact 2 direct InstancedMesh children on root (matching performance test contract)
    const directInstanced = group.children.filter((c) => c.isInstancedMesh)
    assert.equal(directInstanced.length, 2, `${difficulty} keeps exactly 2 instanced draw calls`)

    // Floor imperfection quads: upward CCW normals, strictly inside PATH cells, RGBA alpha variety
    {
      const posAttr = floorImpMesh.geometry.attributes.position
      const normAttr = floorImpMesh.geometry.attributes.normal
      const colAttr = floorImpMesh.geometry.attributes.color
      assert.equal(colAttr.itemSize, 4, `Floor imperfections use RGBA vertex colors on ${difficulty}`)

      const count = floorImpMesh.userData.decalCount
      assert.ok(count >= 4, `${difficulty} places multiple floor imperfections (got ${count})`)

      const p0 = new THREE.Vector3()
      const p1 = new THREE.Vector3()
      const p2 = new THREE.Vector3()
      const e1 = new THREE.Vector3()
      const e2 = new THREE.Vector3()
      const triNorm = new THREE.Vector3()
      let minA = 1
      let maxA = 0
      const usedVariants = new Set()

      for (let i = 0; i < count; i += 1) {
        const v0 = i * 4
        p0.fromBufferAttribute(posAttr, v0)
        p1.fromBufferAttribute(posAttr, v0 + 1)
        p2.fromBufferAttribute(posAttr, v0 + 2)
        e1.subVectors(p1, p0)
        e2.subVectors(p2, p0)
        triNorm.crossVectors(e1, e2).normalize()
        assert.ok(
          triNorm.y > 0.99 && normAttr.getY(v0) === 1,
          `Floor imperfection #${i} faces strictly +Y upward on ${difficulty}`
        )

        const center = new THREE.Vector3().addVectors(p0, p2).multiplyScalar(0.5)
        const cell = worldToGrid(center.x, center.z, maze)
        assert.ok(cell, `Floor imperfection #${i} lands on valid cell`)
        assert.equal(
          maze.grid[cell.row][cell.col],
          CELL_TYPES.PATH,
          `Floor imperfection #${i} sits on walkable corridor cell`
        )

        const a = colAttr.getW(v0)
        minA = Math.min(minA, a)
        maxA = Math.max(maxA, a)
        usedVariants.add(floorImpMesh.userData.variantIndices[i])
      }
      assert.ok(maxA - minA >= 0.14, `Floor imperfections vary opacity on ${difficulty}`)
      assert.ok(
        usedVariants.size >= (difficulty === 'small' ? 4 : 7),
        `Floor uses diverse imperfection archetypes on ${difficulty} (got ${usedVariants.size})`
      )
    }

    // Wall imperfection quads: outward CCW normals, RGBA alpha variety, multiple archetypes
    {
      const posAttr = wallImpMesh.geometry.attributes.position
      const normAttr = wallImpMesh.geometry.attributes.normal
      const colAttr = wallImpMesh.geometry.attributes.color
      assert.equal(colAttr.itemSize, 4, `Wall imperfections use RGBA vertex colors on ${difficulty}`)

      const count = wallImpMesh.userData.decalCount
      assert.ok(count >= 6, `${difficulty} places varied wall imperfections (got ${count})`)

      const p0 = new THREE.Vector3()
      const p1 = new THREE.Vector3()
      const p2 = new THREE.Vector3()
      const e1 = new THREE.Vector3()
      const e2 = new THREE.Vector3()
      const triNorm = new THREE.Vector3()
      const storedNorm = new THREE.Vector3()
      let minA = 1
      let maxA = 0
      const usedVariants = new Set()

      for (let i = 0; i < count; i += 1) {
        const v0 = i * 4
        p0.fromBufferAttribute(posAttr, v0)
        p1.fromBufferAttribute(posAttr, v0 + 1)
        p2.fromBufferAttribute(posAttr, v0 + 2)
        storedNorm.fromBufferAttribute(normAttr, v0)
        e1.subVectors(p1, p0)
        e2.subVectors(p2, p0)
        triNorm.crossVectors(e1, e2).normalize()
        assert.ok(
          triNorm.dot(storedNorm) > 0.99,
          `Wall imperfection #${i} front-facing winding matches normal on ${difficulty}`
        )
        const a = colAttr.getW(v0)
        minA = Math.min(minA, a)
        maxA = Math.max(maxA, a)
        usedVariants.add(wallImpMesh.userData.variantIndices[i])
      }
      assert.ok(maxA - minA >= 0.14, `Wall imperfections vary opacity on ${difficulty}`)
      assert.ok(
        usedVariants.size >= (difficulty === 'small' ? 5 : 7),
        `Walls use diverse imperfection archetypes on ${difficulty} (got ${usedVariants.size})`
      )
    }

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

    // Vertex colors present with subtle AO contrast
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
    assert.ok(buildMs < 500, `buildMazeMeshes(${difficulty}) stays fast (${buildMs.toFixed(1)}ms)`)

    disposeMazeGroup(group)
  }

  disposeAllSharedPools()
  console.log('✓ Floor/wall imperfection overlays, UVs, contact AO & draw-call budget verified')
}

// ---------------------------------------------------------------------------
// 4. Selective 3x3 Graffiti Non-Repetition, Winding & Exclusion Rules
// ---------------------------------------------------------------------------
{
  console.log('Test 4: Selective 3x3 graffiti diversity, outward normals & corridor visibility')

  const maze = generateMaze({ difficulty: 'hardcore', seed: 55123 })
  const groupA = buildMazeMeshes(maze)
  const groupB = buildMazeMeshes(maze)

  const gMeshA = groupA.getObjectByName('maze-walls-graffiti')
  const gMeshB = groupB.getObjectByName('maze-walls-graffiti')
  const count = gMeshA.userData.decalCount

  // Selective (not plastered everywhere) and capped cleanly
  assert.ok(count >= 9 && count <= 16, `Hardcore graffiti count (${count}) is selective and restrained`)
  assert.equal(count, gMeshB.userData.decalCount, 'Graffiti count deterministic for same seed')

  // First 9 markings on Hardcore must use all 9 unique variants before any repeats
  const firstNine = new Set(Array.from(gMeshA.userData.variantIndices).slice(0, 9))
  assert.equal(firstNine.size, 9, 'Graffiti cycles through all 9 distinct variants before repeating')

  const posAttr = gMeshA.geometry.attributes.position
  const normAttr = gMeshA.geometry.attributes.normal
  const colAttr = gMeshA.geometry.attributes.color
  const idxAttr = gMeshA.geometry.index

  assert.equal(posAttr.count, count * 4)
  assert.equal(colAttr.itemSize, 4)
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

    e1.subVectors(p1, p0)
    e2.subVectors(p2, p0)
    triNorm.crossVectors(e1, e2).normalize()
    assert.ok(
      triNorm.dot(storedNorm) > 0.99,
      `Graffiti decal #${i} front-facing winding matches outward normal`
    )

    const center = new THREE.Vector3().addVectors(p0, p2).multiplyScalar(0.5)
    assert.ok(center.y > 0.35 && center.y < WALL_HEIGHT - 0.3, 'Graffiti sits at realistic wall height')
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
  console.log('✓ Selective 3x3 graffiti non-repetition, winding & exclusions verified')
}

// ---------------------------------------------------------------------------
// 5. Engine Integration, Presets, Camera Modes & Clean Pool Cleanup
// ---------------------------------------------------------------------------
{
  console.log('Test 5: MazeSceneEngine integration, camera modes, High Contrast & pool cleanup')

  const maze = generateMaze({ difficulty: 'medium', seed: 9900 })
  const { engine } = createHeadlessEngine({ cameraMode: CAMERA_MODES.FIRST_PERSON })
  engine.setMaze(maze)

  const mazeGroup = engine.getMazeGroup()
  assert.ok(mazeGroup.userData.floorMat.map, 'Engine maze floor carries procedural texture')
  assert.ok(mazeGroup.userData.wallMat.map, 'Engine maze wall carries procedural texture')
  assert.ok(mazeGroup.getObjectByName('maze-walls-imperfections'), 'Engine exposes wall imperfections overlay')
  assert.ok(mazeGroup.getObjectByName('maze-floor-imperfections'), 'Engine exposes floor imperfections overlay')

  engine.setCameraMode(CAMERA_MODES.THIRD_PERSON, { immediate: true })
  engine.updateGraphicsConfig({ qualityPreset: 'performance' })
  assert.ok(mazeGroup.getObjectByName('maze-walls-graffiti').visible)
  assert.ok(mazeGroup.getObjectByName('maze-walls-imperfections').visible)

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
